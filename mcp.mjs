#!/usr/bin/env node
// Loop Tuner as an MCP server (Model Context Protocol) over stdio: the core the
// page runs, as tools an agent calls. Node 18 or later, no dependencies.
//
//   node mcp.mjs [--port 8766] [--no-page]
//
// Register the command `node /path/to/mcp.mjs` with the agent's client (an
// MCP server over stdio). One JSON-RPC 2.0 message per line on stdin and
// stdout; logs go to stderr. It serves both eras of the protocol: the
// stateless one, where every request carries its version in _meta and
// server/discover describes the server, and the earlier revisions that open
// with initialize.
//
// The agentic mode: it also serves the page at http://127.0.0.1:<port>/ (the
// port is printed on stderr, and page_status tells it). A page served from
// here connects back over a WebSocket, and the page_ tools act on that page
// through its own agent API (window.loopTuner), so the agent and the user
// see the same page. The other tools run the core alone, on projects kept in
// this process's memory under names; the one loaded last is the default.
//
// It runs in two places: in the tool's source (the modules under src/, the
// page built by build.mjs), and from the download the page offers, where the
// page's own core (loop-tuner-core.js) and the page (loop-tuner.html) lie
// beside it.

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = { name: 'loop-tuner', title: 'Loop Tuner', version: '0.2.0' };
const MODERN = ['2026-07-28'];
const LEGACY = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const CAPABILITIES = { tools: { listChanged: false } };
const INSTRUCTIONS = 'Loop Tuner simulates and tunes control loops. Two sets of tools: those that run the core alone (list_systems, load_system, run, autotune, analyze, designs, …) on projects kept by name, and the page_ tools, which act on the Loop Tuner page a person has open (the agentic mode: call page_status for its address and give it to the user, or page_open to open it), so you both see the same page; read its data with page_signals, page_live and autotune_history before you change things, and say what you do. Start with list_systems and load_system, then run, autotune, analyze; save_project or export_html hand the result back.';
const TERMINAL = !!process.stdin.isTTY;

const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const log = (...a) => process.stderr.write(`loop-tuner mcp: ${a.join(' ')}\n`);
const ME = fileURLToPath(import.meta.url);

// What it is and how to connect an agent, for someone who has never used
// MCP (input 36): printed when it starts (on stderr: stdout is the protocol)
// and by --help; README.md says the same. url: where the page is.
function explain(url) {
  const cfg = (key, extra = {}) => JSON.stringify({ [key]: { 'loop-tuner': { ...extra, command: 'node', args: [ME] } } });
  return `Loop Tuner's MCP server
=======================
An MCP server gives an AI agent tools: MCP, the Model Context Protocol, is how
agent apps (MCP clients) start a program like this one and call what it offers.
This one lets an agent load, run, measure, tune and analyse control loops, and
work on the Loop Tuner page you have open, so you both see the same page.

Connect an agent: register this server once with your MCP client.
  Claude Code:     claude mcp add loop-tuner -- node "${ME}"
  Claude Desktop:  Settings > Developer > Edit Config (claude_desktop_config.json), add
                   ${cfg('mcpServers')}
  VS Code:         .vscode/mcp.json in your folder:
                   ${cfg('servers', { type: 'stdio' })}
  Cursor:          ~/.cursor/mcp.json:
                   ${cfg('mcpServers')}
  Any other client: an MCP server over stdio, the command
                   node "${ME}"
The client then starts this server by itself whenever the agent needs it.

${url ? `The page: ${url}\n  Open it in a browser; the agent works on the same page (or ask it to open it).\n\n` : ''}Ask the agent, for example: "help me tune this system", "let's look at this
identification together", "why does this loop ring?".

Options (none is needed): --port N (the page's port, default 8766; a free one
if it is taken), --no-page (no page), --no-open (from a terminal: do not open
the browser), --help.
`;
}
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(`node mcp.mjs [options]\n\n${explain('http://127.0.0.1:8766/ (or the port it prints)')}`);
  process.exit(0);
}

// ---- The core: the download's (the page's own, cut from its script) or the source's

async function loadCore() {
  const coreFile = join(HERE, 'loop-tuner-core.js');
  if (existsSync(coreFile)) {
    vm.runInThisContext(readFileSync(coreFile, 'utf8'), { filename: 'loop-tuner-core.js' });
    return { mods: globalThis.LoopTunerCore, page: () => readFileSync(join(HERE, 'loop-tuner.html'), 'utf8') };
  }
  const mods = {};
  for (const m of ['project', 'signals', 'autotune', 'ops', 'trace']) mods[`core/${m}.js`] = await import(pathToFileURL(join(HERE, 'src/core', `${m}.js`)).href);
  const { buildHtml } = await import(pathToFileURL(join(HERE, 'build.mjs')).href);
  return { mods, page: buildHtml };
}
const CORE = await loadCore();
const { normalizeProject } = CORE.mods['core/project.js'];
const { normalizeComponent, SIGNALS } = CORE.mods['core/signals.js'];
const { autotuneSteps, tuneReport, placeVariant, controllerBlocks } = CORE.mods['core/autotune.js'];
const { parseTrace } = CORE.mods['core/trace.js'];
const { parseProject, embedProject, listSystems, findSystem, systemProject, allBlocks, findBlock, projectDesigns, runProject, analyzeProject, autotuneOptions, traceSummary } = CORE.mods['core/ops.js'];
let basePage = null;
const pageHtml = (project) => { basePage ??= CORE.page(); return project ? embedProject(basePage, project) : basePage; };

// ---- Projects, in memory, by name; Auto-tune's runs, in order

const projects = new Map();
let current = null;
const history = [];

function take(name) {
  const key = name ?? current;
  if (key === null) throw new Error('no project loaded yet: call load_system first');
  const p = projects.get(key);
  if (!p) throw new Error(`no project "${key}"; projects: ${[...projects.keys()].join(', ') || 'none'}`);
  return { name: key, project: p };
}
function keep(name, project) {
  projects.set(name, project);
  current = name;
  return name;
}
function remember(where, project, rep, applied) {
  history.push({
    index: history.length, where, project, at: new Date().toISOString(), method: rep.method, block: rep.block, ok: rep.ok,
    ...(rep.ok ? { before: { variant: rep.before.variant.name, J: rep.before.cost.J }, after: { variant: rep.after.variant.name, J: rep.after.cost.J, overshoot: rep.after.cost.overshoot }, better: rep.better } : { why: rep.why }),
    applied, report: rep,
  });
}

// What a tool says about a project after loading or changing it.
function summary(name, project) {
  const plant = project.system.plant;
  const ctrls = plant?.type === 'diagram' ? controllerBlocks(plant.diagram) : [];
  return {
    project: name, title: project.title,
    controllers: ctrls.map((c) => ({ block: c.key, where: c.where, running: c.block.variants[c.block.variant ?? 0]?.name, variants: c.block.variants.map((v) => ({ name: v.name, type: v.type })) })),
    signals: Object.fromEntries(Object.entries(project.system.signals).map(([k, s]) => [k, { period: s.period, components: s.components.length }])),
    timebase: project.scope.timebase,
    ...(project.notes ? { notes: project.notes } : {}),
  };
}

// ---- The page: served here, connected back over a WebSocket

const page = { url: null, conn: null, info: null, next: 1, waiting: new Map() };

// Calls a method of the page's window.loopTuner ("record.screen", …) with
// these arguments; resolves to its result (awaited on the page).
function pageCall(method, params = [], timeout = 60000) {
  if (!page.conn) throw new Error(page.url ? `no page is connected: open ${page.url} in a browser on this computer (page_open opens it), and it connects by itself` : 'the page is not served (the server was started with --no-page)');
  const id = page.next++;
  return new Promise((res, rej) => {
    const timer = setTimeout(() => { page.waiting.delete(id); rej(new Error(`the page did not answer ${method} within ${timeout / 1000} s`)); }, timeout);
    page.waiting.set(id, { res, rej, timer });
    page.conn.send(JSON.stringify({ id, method, params }));
  });
}

// A WebSocket (RFC 6455) on an upgraded socket: text frames, ping, close.
function websocket(req, socket) {
  const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const frame = (op, payload) => {
    const n = payload.length;
    let head;
    if (n < 126) head = Buffer.from([0x80 | op, n]);
    else if (n < 65536) head = Buffer.from([0x80 | op, 126, n >> 8, n & 255]);
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
    if (!socket.destroyed) socket.write(Buffer.concat([head, payload]));
  };
  const conn = {
    send: (text) => frame(1, Buffer.from(text, 'utf8')),
    close: (code = 1000) => { const b = Buffer.alloc(2); b.writeUInt16BE(code); frame(8, b); socket.end(); },
    onmessage: null, onclose: null,
  };
  let buf = Buffer.alloc(0), parts = [];
  socket.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const maskAt = off;
      if (masked) off += 4;
      if (buf.length < off + len) return;
      const payload = Buffer.from(buf.subarray(off, off + len));
      if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= buf[maskAt + (i & 3)];
      buf = buf.subarray(off + len);
      if (op === 8) { socket.end(); return; }
      if (op === 9) { frame(10, payload); continue; }
      if (op === 10) continue;
      parts.push(payload);
      if (fin) { const text = Buffer.concat(parts).toString('utf8'); parts = []; conn.onmessage?.(text); }
    }
  });
  socket.on('close', () => conn.onclose?.());
  socket.on('error', () => {});
  return conn;
}

function servePage(port) {
  const server = createServer((req, res) => {
    if (req.method !== 'GET' || !['/', '/index.html'].includes(req.url.split('?')[0])) { res.writeHead(404).end(); return; }
    // The page, with one line that tells it where to connect back: only a
    // page served from here has it.
    const html = pageHtml().replace('<head>', `<head>\n<meta name="loop-tuner-bridge" content="ws://127.0.0.1:${server.address().port}/bridge">`);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(html);
  });
  server.on('upgrade', (req, socket) => {
    const origin = req.headers.origin ?? '', p = server.address().port;
    if (req.url !== '/bridge' || ![`http://127.0.0.1:${p}`, `http://localhost:${p}`].includes(origin)) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const conn = websocket(req, socket);
    // One page at a time: the newest; the one before is told and closed.
    if (page.conn) page.conn.close(4000);
    page.conn = conn;
    page.info = null;
    log(`a page connected from ${origin}`);
    conn.onmessage = (text) => {
      let m;
      try { m = JSON.parse(text); } catch { return; }
      if (m.hello) { page.info = m.hello; return; }
      const w = page.waiting.get(m.id);
      if (!w) return;
      page.waiting.delete(m.id);
      clearTimeout(w.timer);
      if (m.error !== undefined) w.rej(new Error(m.error)); else w.res(m.result);
    };
    conn.onclose = () => {
      if (page.conn !== conn) return;
      page.conn = null;
      for (const w of page.waiting.values()) { clearTimeout(w.timer); w.rej(new Error('the page went away')); }
      page.waiting.clear();
      log('the page disconnected');
    };
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && port !== 0) { log(`port ${port} is in use; taking a free one`); port = 0; server.listen(0, '127.0.0.1'); } else log(`the page is not served: ${e.message}`);
  });
  server.on('listening', () => {
    page.url = `http://127.0.0.1:${server.address().port}/`;
    process.stderr.write(`\n${explain(page.url)}\n`);
    // Run by a person (runme): the page opens in the default browser.
    if (TERMINAL && !process.argv.includes('--no-open')) openBrowser(page.url);
  });
  server.listen(port, '127.0.0.1');
  // Under an agent's client, stdin keeps the server alive; it ends with it.
  if (!TERMINAL) server.unref();
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();
}

// ---- Tools: name, description, input schema, and what it does

const projectArg = { type: 'string', description: 'The name of a project in memory (load_system returns it); default: the project loaded last.' };
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const goalArgs = {
  cost: { type: 'string', enum: ['IAE', 'ITAE', 'ISE'], description: 'The goal\'s error measure; default IAE.' },
  effort: { type: 'number', description: 'The weight of u\'s swing; default 0.05.' },
  overshoot: { type: 'number', description: 'The overshoot the goal allows, %; default 10.' },
};
const tuneArgs = {
  block: { type: 'string', description: 'A Controller block\'s id path; default the first.' },
  method: { type: 'string', enum: ['iterate', 'relay', 'step'], description: 'Default iterate.' },
  rule: { type: 'string', enum: ['tl', 'zn', 'calm'], description: 'relay: Tyreus–Luyben (default), Ziegler–Nichols, or calm.' },
  simc: { type: 'string', enum: ['tight', 'smooth'], description: 'step: τc = θ (tight, default) or 3θ (smooth).' },
  ...goalArgs,
  iterations: { type: 'integer', description: 'iterate: at most this many iterations (default 60).' },
  ff: { type: 'boolean', description: 'iterate: also tune the feedforward gains that are 0.' },
  amplitude: { type: 'number', description: 'relay, step: the experiment\'s size, % of the actuator range.' },
};
const atArg = {
  description: '"origin" (all states 0, u = 0; default), "initial" (where the run starts), { "y": [levels] } (an equilibrium at these measurement levels, null leaves one free) or { "t": seconds } (a moment of the run).',
  anyOf: [{ type: 'string', enum: ['origin', 'initial'] }, obj({ y: { type: 'array', items: { type: ['number', 'null'] } } }, ['y']), obj({ t: { type: 'number' } }, ['t'])],
};
const windowArgs = {
  from: { type: 'number', description: 'Only from this time, s.' },
  to: { type: 'number', description: 'Only up to this time, s.' },
  signals: { type: 'array', items: { type: 'string' }, description: 'Signals to return as traces, downsampled; without, only the summary.' },
  points: { type: 'integer', description: 'Samples per trace, 2 to 2000 (default 200).' },
};

const TOOLS = [
  // -- the core alone
  {
    name: 'list_systems', title: 'List the System library',
    description: 'The System library: every ready-made system (plant, controllers and input) with its tags and notes. Load one with load_system (the core alone) or page_load_system (the page).',
    inputSchema: obj({ tag: { type: 'string', description: 'Only the systems with this tag, as "PID" or "Nonlinear".' } }),
    run: ({ tag }) => ({ systems: listSystems().filter((s) => !tag || s.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) }),
  },
  {
    name: 'list_projects', title: 'List the projects in memory',
    description: 'The projects this server holds for the core-alone tools, by name, and which one is the default.',
    inputSchema: obj({}),
    run: () => ({ default: current, projects: [...projects.entries()].map(([name, p]) => ({ project: name, title: p.title })) }),
  },
  {
    name: 'load_system', title: 'Load a system or a project file',
    description: 'Loads a System library entry by name (or the start of its name), or a project file (.json, or an exported .html page with the project inside), into memory under a name, and makes it the default. Returns its Controller blocks, their variants and the signals. page_get_project brings the page\'s project here.',
    inputSchema: obj({
      system: { type: 'string', description: 'A System library name, as "DC motor, position control" (list_systems lists them).' },
      path: { type: 'string', description: 'A project file: .json, or an exported .html page.' },
      as: { type: 'string', description: 'The name to keep it under; default: the system\'s name or the file\'s.' },
    }),
    run: ({ system, path, as }) => {
      if ((system === undefined) === (path === undefined)) throw new Error('give either system (a library name) or path (a project file)');
      if (system !== undefined) { const e = findSystem(system), name = as ?? e.name; return summary(keep(name, systemProject(e)), projects.get(name)); }
      let text;
      try { text = readFileSync(resolve(path), 'utf8'); } catch { throw new Error(`cannot read ${path}`); }
      const p = parseProject(text, path), name = as ?? basename(path).replace(/\.(json|html?)$/i, '');
      return summary(keep(name, p), p);
    },
  },
  {
    name: 'get_project', title: 'Get the project as JSON',
    description: 'The whole project as the file stores it (format loop-tuner/2): system.signals (the inputs), system.plant.diagram (the block diagram, Controller blocks with their variants), scope, sim. Change it and give it back with set_project (page_set_project for the page).',
    inputSchema: obj({ project: projectArg }),
    run: ({ project }) => take(project).project,
  },
  {
    name: 'set_project', title: 'Replace the project',
    description: 'Replaces a project with this JSON (normalised as the page loads a file; a designed variant holding numbers the page computes, such as K or Kp, is refused). With a new name it is kept beside the others.',
    inputSchema: obj({ project: projectArg, json: { type: 'object', description: 'The project, as get_project returns it.' } }, ['json']),
    run: ({ project, json }) => {
      const name = project ?? current ?? 'project';
      const p = normalizeProject(structuredClone(json));
      return summary(keep(name, p), p);
    },
  },
  {
    name: 'list_blocks', title: 'List the blocks',
    description: 'Every block of the plant\'s diagram at any depth, by id path ("ctrl", "motor/ctrl"): its type and name; for a Controller or Observer, its variants and the one that runs. Read one whole with get_block.',
    inputSchema: obj({ project: projectArg }),
    run: ({ project }) => ({
      blocks: allBlocks(take(project).project).map(({ path, block: b }) => ({
        path, type: b.type, ...(b.name ? { name: b.name } : {}),
        ...(b.variants ? { running: b.variants[b.variant ?? 0]?.name, variants: b.variants.map((v) => ({ name: v.name, type: v.type })) } : {}),
      })),
    }),
  },
  {
    name: 'get_block', title: 'Get one block',
    description: 'One block by its id path, as the file stores it: its parameters and, for a Controller or Observer, every variant with its parameters.',
    inputSchema: obj({ project: projectArg, block: { type: 'string', description: 'The block\'s id path, as "ctrl" or "motor/ctrl".' } }, ['block']),
    run: ({ project, block }) => findBlock(take(project).project, block),
  },
  {
    name: 'set_params', title: 'Change parameters or an input signal',
    description: 'Changes a project in place. With block: params go to a Controller\'s or Observer\'s variant (the running one, or the one named by variant) or, for any other block, to the block itself; blockParams go to a Controller\'s own parameters (Ts, inputs); select makes the named variant run. A name the target does not have is refused, listing the names it has. With signal: replaces that input signal\'s components and/or period (types: step, sine, square, ramp, ...; see the signal generator). Returns what changed.',
    inputSchema: obj({
      project: projectArg,
      block: { type: 'string', description: 'A block\'s id path.' },
      variant: { type: ['string', 'integer'], description: 'A variant\'s name or index; default the running one.' },
      params: { type: 'object', description: 'Parameters and their new values, as { "Kp": 8, "Kd": 0.5 }.' },
      blockParams: { type: 'object', description: 'A Controller\'s or Observer\'s own parameters, as { "Ts": 0.005 }.' },
      select: { type: 'boolean', description: 'Make the variant run.' },
      signal: { type: 'string', description: 'An input signal\'s name, as "r" or "d".' },
      components: { type: 'array', items: { type: 'object' }, description: 'The signal\'s components, each { type, params }, as { "type": "step", "params": { "amplitude": 1, "time": 0.5 } }.' },
      period: { type: 'number', description: 'The signal\'s period in seconds.' },
    }),
    run: (a) => {
      const { name, project } = take(a.project);
      const next = structuredClone(project);
      let out;
      if (a.signal !== undefined) {
        if (a.block !== undefined) throw new Error('give block or signal, not both');
        const s = next.system.signals[a.signal];
        if (!s) throw new Error(`no signal "${a.signal}"; signals: ${Object.keys(next.system.signals).join(', ')}`);
        if (a.components) s.components = a.components.map((c) => { if (!SIGNALS[c.type]) throw new Error(`unknown waveform "${c.type}"; types: ${Object.keys(SIGNALS).join(', ')}`); return normalizeComponent(c); });
        if (a.period !== undefined) { if (!(a.period > 0)) throw new Error('period: seconds, above 0'); s.period = a.period; }
        out = (p) => ({ signal: a.signal, ...p.system.signals[a.signal] });
      } else if (a.block !== undefined) {
        const b = findBlock(next, a.block);
        const check = (target, params, what) => {
          const unknown = Object.keys(params).filter((k) => !(k in target));
          if (unknown.length) throw new Error(`${what} has no ${unknown.join(', ')}; its parameters: ${Object.keys(target).join(', ')}`);
          Object.assign(target, params);
        };
        let i = b.variant ?? 0;
        if (b.variants) {
          if (a.variant !== undefined) {
            const names = b.variants.map((v) => v.name);
            i = Number.isInteger(a.variant) ? a.variant : names.indexOf(String(a.variant));
            if (i < 0) i = names.findIndex((n) => n.toLowerCase() === String(a.variant).toLowerCase());
            if (!(i >= 0 && i < names.length)) throw new Error(`"${a.block}" has no variant ${JSON.stringify(a.variant)}; its variants: ${names.map((n) => JSON.stringify(n)).join(', ')}`);
          }
          if (a.params) check(b.variants[i].params, a.params, `${b.variants[i].name} (${b.variants[i].type})`);
          if (a.select) b.variant = i;
        } else if (a.variant !== undefined || a.select) throw new Error(`"${a.block}" (${b.type}) has no variants`);
        else if (a.params) check(b.params, a.params, `${a.block} (${b.type})`);
        if (a.blockParams) check(b.params, a.blockParams, `${a.block} (${b.type})`);
        out = (p) => { const nb = findBlock(p, a.block); return nb.variants ? { block: a.block, running: nb.variants[nb.variant ?? 0].name, variant: nb.variants[i], params: nb.params } : { block: a.block, params: nb.params }; };
      } else throw new Error('give block (with params, blockParams, variant, select) or signal (with components, period)');
      const p = normalizeProject(next);
      keep(name, p);
      return { project: name, ...out(p) };
    },
  },
  {
    name: 'run', title: 'Run the project and measure it',
    description: 'Simulates the project for its timebase (the page\'s run: one period of the input on the screen) or for duration seconds, and measures each Controller block\'s loop: Auto-tune\'s cost J (the goal: IAE, ITAE or ISE + effort + overshoot beyond the bound + saturation, scaled from this run) and overshoot, settling time, rise time, IAE, peak and variation of u, time saturated. Lists every signal; traces gives the signals named, downsampled to points samples (default 200, at most 2000), never the whole run. An older project with candidates returns its candidates ranked against its goal.',
    inputSchema: obj({
      project: projectArg,
      duration: { type: 'number', description: 'Seconds to simulate; default the project\'s timebase.' },
      signals: { type: 'array', items: { type: 'string' }, description: 'Signals to return as traces, as ["r", "y", "ctrl.u"].' },
      points: { type: 'integer', description: 'Samples per trace, 2 to 2000 (default 200).' },
      ...goalArgs,
    }),
    run: (a) => {
      const { name, project } = take(a.project);
      const { goal } = autotuneOptions(project, { cost: a.cost, effort: a.effort, overshoot: a.overshoot }).opts;
      return { project: name, ...runProject(project, { duration: a.duration, goal, signals: a.signals ?? [], points: a.points }) };
    },
  },
  {
    name: 'autotune', title: 'Auto-tune a Controller block',
    description: 'Improves a Controller block\'s running variant by simulation, as the page\'s Auto-tune tab does. method iterate: Nelder–Mead on the goal; relay: a relay experiment (Ku, Pu), then a rule; step: an open-loop step, a model fit, SIMC. Returns the report: before and after (variant, cost, overshoot), better, why it is worse when it is, what the experiment measured, notes. With apply, the result goes into the block as a variant of its own, "<name> · auto-tuned" (or "· relay T–L", "· SIMC"), and runs if it scores better; the original stays. Reports progress when the request carries a progress token; can be cancelled. Every run is kept in autotune_history.',
    inputSchema: obj({ project: projectArg, ...tuneArgs, apply: { type: 'boolean', description: 'Put the result into the project (default false).' } }),
    run: async (a, ctx) => {
      const { name, project } = take(a.project);
      const { path, opts } = autotuneOptions(project, a);
      const gen = autotuneSteps(project, path, opts);
      let step, n = 0, last = Date.now();
      for (;;) {
        step = gen.next();
        if (step.done) break;
        n++;
        if (Date.now() - last > 50) {
          await new Promise((r) => setImmediate(r));
          ctx.check();
          const v = step.value ?? {};
          ctx.progress(n, opts.method === 'iterate' && v.iteration !== undefined ? `iteration ${v.iteration}, cost ${Number(v.cost).toPrecision(3)}` : `${v.phase ?? opts.method}: ${n} runs`);
          last = Date.now();
        }
      }
      const res = step.value;
      if (res.ok && a.apply) { const p = structuredClone(project); placeVariant(p, res.path, res.variant, { run: res.better }); keep(name, normalizeProject(p)); }
      const rep = tuneReport(res);
      remember('core', name, rep, !!(res.ok && a.apply));
      if (!res.ok) throw new Error(`could not tune ${rep.block}: ${res.why}`);
      return { project: name, applied: !!a.apply, ...rep };
    },
  },
  {
    name: 'autotune_history', title: 'The Auto-tune runs so far',
    description: 'Every Auto-tune run since the server started, on the core (autotune) and on the page (page_autotune), oldest first, in brief: where, which project, method, block, cost before and after, better, applied. index gives one run\'s whole report.',
    inputSchema: obj({ index: { type: 'integer', description: 'One run\'s whole report.' } }),
    run: ({ index }) => {
      if (index === undefined) return { runs: history.map(({ report, ...brief }) => brief) };
      if (!history[index]) throw new Error(history.length ? `no run ${index}; runs 0 to ${history.length - 1}` : 'no Auto-tune run yet');
      return history[index];
    },
  },
  {
    name: 'analyze', title: 'Analyse a loop at an operating point',
    description: 'The Analysis tab\'s numbers for a Controller block\'s loop, linearised at an operating point: stable or not (closed-loop poles outside the unit circle), the gain margins (factors up and down; null: none), the phase margin and crossover, the delay margin, Ms and Mt, the least damping and the closed-loop poles (s-plane, with ωn and ζ), and the linear step (overshoot, settling time). Where there is no linear loop (a relay, a kink at the point, a design not made, a plant outside the page) it is refused with the reason and a hint.',
    inputSchema: obj({ project: projectArg, block: { type: 'string', description: 'A Controller block\'s id path; default the first.' }, at: atArg }),
    run: ({ project, block, at }) => { const { name, project: p } = take(project); return { project: name, ...analyzeProject(p, { block, at: at ?? 'origin' }) }; },
  },
  {
    name: 'designs', title: 'The computed designs',
    description: 'What each running variant computed from the plant (LQR, PI from the plant, a PID\'s feedforward, the swing-ups, a planned swing-up, a Kalman filter) holds now: its status (ok, warn, error), the computed rows (gains, plans), warnings, and why a design was refused (error: { code, message, hint }; the block then puts out u = 0). Empty when no designed variant runs. A plan can take a few seconds.',
    inputSchema: obj({ project: projectArg, block: { type: 'string', description: 'Only this block\'s id path.' } }),
    run: ({ project, block }) => { const { name, project: p } = take(project); return { project: name, designs: projectDesigns(p, block) }; },
  },
  {
    name: 'identify', title: 'Identify a plant (not built yet)',
    description: 'NOT BUILT YET: identifying a plant from a recorded experiment, with the fitted model, its uncertainty and validation (Identify, design/output/identification.md), is designed but its core is not built. This tool says so; it will run the core once it lands. Meanwhile read the data with page_signals (source "record" for a live plant).',
    inputSchema: obj({ project: projectArg }),
    run: () => { throw new Error('identify is not built yet: the Identify core (design/output/identification.md) has not landed. Meanwhile, read the experiment\'s data with page_signals (source "record" for a live plant) and reason about it; tune a simulated plant with autotune'); },
  },
  {
    name: 'save_project', title: 'Save the project to a file',
    description: 'Writes a project to a file: .json for the project, .html for the standalone page with the project inside (a person opens it in a browser). Returns the absolute path.',
    inputSchema: obj({ project: projectArg, path: { type: 'string', description: 'The file, .json or .html; relative paths are from the server\'s working directory.' } }, ['path']),
    run: ({ project, path }) => {
      const { name, project: p } = take(project), file = resolve(path);
      writeFileSync(file, /\.html?$/i.test(file) ? pageHtml(p) : `${JSON.stringify(p, null, 2)}\n`);
      return { project: name, path: file };
    },
  },
  {
    name: 'export_html', title: 'Export the standalone page',
    description: 'Writes the standalone Loop Tuner page with the project inside, for a person to open in a browser (it loads nothing from anywhere). Returns the absolute path.',
    inputSchema: obj({ project: projectArg, path: { type: 'string', description: 'The .html file to write.' } }, ['path']),
    run: ({ project, path }) => { const { name, project: p } = take(project); const file = resolve(path); writeFileSync(file, pageHtml(p)); return { project: name, path: file }; },
  },

  // -- the page a person has open (the agentic mode)
  {
    name: 'page_status', title: 'The page: where and what',
    description: 'The agentic mode: the address where this server serves the Loop Tuner page (give it to the user, or call page_open), whether a page is connected, and if so what it shows: the project\'s title, its Controller blocks, the live plant\'s link. The page_ tools act on that page, so the user sees what you do.',
    inputSchema: obj({}),
    run: async () => {
      const out = { url: page.url, connected: !!page.conn };
      if (!page.conn) return { ...out, how: page.url ? `open ${page.url} in a browser on this computer (page_open does it); the page connects by itself` : 'the page is not served (--no-page)' };
      const p = await pageCall('getProject');
      const live = await pageCall('live.state');
      return { ...out, ...summary('page', p), live: live ? { state: live.state, mode: live.mode, message: live.message, estop: live.estop } : null };
    },
  },
  {
    name: 'page_open', title: 'Open the page in a browser',
    description: 'Opens the page this server serves in the default browser of this computer, where the user can see it; it connects back by itself.',
    inputSchema: obj({}),
    run: () => { if (!page.url) throw new Error('the page is not served (the server was started with --no-page)'); openBrowser(page.url); return { url: page.url, opened: true }; },
  },
  {
    name: 'page_load_system', title: 'Load a system on the page',
    description: 'Loads a System library entry on the page, as its System library does (one undo step for the user).',
    inputSchema: obj({ system: { type: 'string', description: 'A System library name (list_systems lists them).' } }, ['system']),
    run: async ({ system }) => { const name = await pageCall('loadSystem', [findSystem(system).name]); return { loaded: name, ...summary('page', await pageCall('getProject')) }; },
  },
  {
    name: 'page_get_project', title: 'The page\'s project',
    description: 'The project the page shows, as JSON. With as, it is also kept in memory under that name, for the core-alone tools (run, analyze, autotune without disturbing the page).',
    inputSchema: obj({ as: { type: 'string', description: 'Also keep it under this name.' } }),
    run: async ({ as }) => { const p = normalizeProject(await pageCall('getProject')); if (as) keep(as, p); return p; },
  },
  {
    name: 'page_set_project', title: 'Put a project on the page',
    description: 'Loads this project JSON on the page (or, with project, a project from memory), replacing what it shows.',
    inputSchema: obj({ json: { type: 'object', description: 'A project, as get_project returns it.' }, project: projectArg }),
    run: async ({ json, project }) => summary('page', await pageCall('setProject', [json ?? take(project).project])),
  },
  {
    name: 'page_set_gains', title: 'Change a controller\'s gains on the page',
    description: 'Changes the running variant\'s parameters of a Controller block on the page (one undo step). While a live plant runs, they act at the next sample and the controller keeps its state. A name the variant does not have is refused, listing the names it has.',
    inputSchema: obj({ block: { type: 'string', description: 'A Controller block\'s id path; default "ctrl".' }, params: { type: 'object', description: 'As { "Kp": 8, "Kd": 0.5 }.' } }, ['params']),
    run: ({ block, params }) => pageCall('setGains', [block ?? 'ctrl', params]),
  },
  {
    name: 'page_set_variant', title: 'Pick the variant that runs on the page',
    description: 'Picks which variant of a Controller block runs on the page, by name or index (one undo step); live, it starts afresh.',
    inputSchema: obj({ block: { type: 'string', description: 'A Controller block\'s id path; default "ctrl".' }, variant: { type: ['string', 'integer'] } }, ['variant']),
    run: ({ block, variant }) => pageCall('setVariant', [block ?? 'ctrl', variant]),
  },
  {
    name: 'page_control', title: 'The scope\'s keys on the page',
    description: 'Presses a key of the page\'s scope: run, stop, single (one sweep), or auto_scale. With a live plant, run and stop start and stop the plant (the references ramp in first). Returns whether it was refused and why.',
    inputSchema: obj({ action: { type: 'string', enum: ['run', 'stop', 'single', 'auto_scale'] } }, ['action']),
    run: async ({ action }) => (action === 'auto_scale' ? (await pageCall('autoScale'), { ok: true }) : pageCall(action)),
  },
  {
    name: 'page_signals', title: 'Read the page\'s signals',
    description: 'The signals the page has, in brief first: source "screen" is every signal of the run on the screen (simulated, or the live sweep), "record" the live record (the last minutes of every live signal, across runs). Without signals: the span and, per signal, its unit, min, max, mean and last value (within from … to). With signals: those downsampled to points samples. The same numbers as Save › CSV.',
    inputSchema: obj({ source: { type: 'string', enum: ['screen', 'record'], description: 'Default screen.' }, ...windowArgs }),
    run: async ({ source = 'screen', from, to, signals = [], points }) => {
      const text = await pageCall(source === 'record' ? 'record.live' : 'record.screen', ['json']);
      if (!text) return { source, samples: 0, note: source === 'record' ? 'the live record is empty: it fills while a live plant runs' : 'nothing on the screen yet: page_control run' };
      const tr = parseTrace(text);
      return { source, title: tr.title, ...traceSummary(tr, { from, to, signals, points }) };
    },
  },
  {
    name: 'page_autotune', title: 'Auto-tune on the page',
    description: 'Auto-tunes a Controller block of the page\'s project, as its Auto-tune tab does, and by default applies the result (a variant of its own, running if it scores better; one undo step the user can take back). Refused for an External plant: the page knows only its interface (identify it first). Kept in autotune_history.',
    inputSchema: obj({ ...tuneArgs, apply: { type: 'boolean', description: 'Put the result into the page\'s project (default true).' } }),
    run: async (a) => {
      const goal = Object.fromEntries(['cost', 'effort', 'overshoot'].filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));
      const rep = await pageCall('autotune', [{ block: a.block, method: a.method, goal, rule: a.rule, simc: a.simc, amplitude: a.amplitude === undefined ? undefined : a.amplitude / 100, maxIter: a.iterations, feedforward: !!a.ff, apply: a.apply !== false }], 600000);
      remember('page', 'page', rep, !!(rep.ok && a.apply !== false));
      if (!rep.ok) throw new Error(`could not tune${rep.block ? ` ${rep.block}` : ''}: ${rep.why}`);
      return { applied: a.apply !== false, ...rep };
    },
  },
  {
    name: 'page_analyze', title: 'Analyse the page\'s loop',
    description: 'The Analysis tab\'s numbers for a Controller block of the project the page shows, at an operating point (as analyze, computed by the same core from the page\'s project).',
    inputSchema: obj({ block: { type: 'string', description: 'A Controller block\'s id path; default the first.' }, at: atArg }),
    run: async ({ block, at }) => analyzeProject(normalizeProject(await pageCall('getProject')), { block, at: at ?? 'origin' }),
  },
  {
    name: 'page_designs', title: 'The page\'s computed designs',
    description: 'What the designed variants on the page computed (once no design is still being computed): status, rows, warnings, refusals.',
    inputSchema: obj({}),
    run: async () => ({ designs: await pageCall('whenDesigned', [], 120000) }),
  },
  {
    name: 'page_live', title: 'The live plant on the page',
    description: 'The page\'s link to an external (HIL) plant: action "state" (default) gives the connection, the mode, the plant\'s interface (its inputs and outputs: names, units, full scales, hard ranges), the ramp-in, the link\'s figures, any E-stop and who latched it, the last message; "connect" (url optional), "disconnect", "estop", "reset"; "mode" with mode "control" (the page\'s Controller drives the plant) or "reference" (the plant runs its own controller, the page sends r and records), while the plant is stopped. The plant is real time: stop it (page_control stop) or E-stop it when in doubt.',
    inputSchema: obj({ action: { type: 'string', enum: ['state', 'connect', 'disconnect', 'estop', 'reset', 'mode'] }, url: { type: 'string', description: 'connect: where the plant listens; default the block\'s.' }, mode: { type: 'string', enum: ['control', 'reference'], description: 'mode: who controls the plant.' } }),
    run: ({ action = 'state', url, mode }) => {
      if (action === 'mode') { if (!mode) throw new Error('mode: "control" or "reference"'); return pageCall('live.setMode', [mode], 30000); }
      return pageCall(`live.${action}`, action === 'connect' && url ? [url] : [], 30000);
    },
  },
  {
    name: 'page_screenshot', title: 'A picture of the page\'s scope',
    description: 'A PNG of the page\'s scope as it is: the status line, the screen, the channel keys.',
    inputSchema: obj({}),
    run: async () => {
      const url = await pageCall('record.screenshot');
      const m = /^data:(image\/png);base64,(.*)$/.exec(url ?? '');
      if (!m) throw new Error('the page gave no picture');
      return { content: [{ type: 'image', data: m[2], mimeType: m[1] }, { type: 'text', text: 'The page\'s scope.' }] };
    },
  },
];
const TOOL = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

// ---- Arguments: the small part of JSON Schema the tools use

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
function checkArgs(schema, v, where = 'arguments') {
  if (schema.anyOf) {
    const errs = schema.anyOf.map((s) => checkArgs(s, v, where)).filter(Boolean);
    return errs.length < schema.anyOf.length ? null : `${where}: ${schema.description ?? errs.join('; or ')}`;
  }
  if (schema.type) {
    const types = [].concat(schema.type), t = typeOf(v);
    if (!types.includes(t) && !(t === 'integer' && types.includes('number'))) return `${where}: expected ${types.join(' or ')}, got ${t}`;
  }
  if (schema.enum && !schema.enum.includes(v)) return `${where}: one of ${schema.enum.join(', ')}`;
  if (typeOf(v) === 'object' && schema.properties) {
    for (const k of schema.required ?? []) if (!(k in v)) return `${where}: ${k} is required`;
    for (const [k, x] of Object.entries(v)) {
      if (!schema.properties[k]) { if (schema.additionalProperties === false) return `${where}: unknown ${k}; it takes ${Object.keys(schema.properties).join(', ') || 'nothing'}`; continue; }
      const e = checkArgs(schema.properties[k], x, k);
      if (e) return e;
    }
  }
  if (typeOf(v) === 'array' && schema.items) for (const [i, x] of v.entries()) { const e = checkArgs(schema.items, x, `${where}[${i}]`); if (e) return e; }
  return null;
}

// ---- The protocol

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const PV = 'io.modelcontextprotocol/protocolVersion', CAPS = 'io.modelcontextprotocol/clientCapabilities';
let legacy = null;   // the version initialize agreed on, for clients of the earlier revisions
const running = new Map();   // request id → { cancelled }, from its arrival to its answer

class RpcError extends Error { constructor(code, message, data) { super(message); this.code = code; this.data = data; } }
class Cancelled extends Error { }

const toolList = () => TOOLS.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema }));

async function callTool(params, id, token) {
  const t = TOOL[params?.name];
  if (!t) throw new RpcError(-32602, `Unknown tool: ${params?.name}; tools: ${TOOLS.map((x) => x.name).join(', ')}`);
  const args = params.arguments ?? {};
  const bad = checkArgs(t.inputSchema, args);
  const fail = (text) => ({ content: [{ type: 'text', text }], isError: true });
  if (bad) return fail(bad);
  const state = running.get(id);
  let progress = 0;
  const ctx = {
    check: () => { if (state?.cancelled) throw new Cancelled(); },
    progress: (n, message) => { if (token !== undefined && n > progress) { progress = n; send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: token, progress: n, message } }); } },
  };
  try {
    const out = await t.run(args, ctx);
    if (Array.isArray(out?.content)) return out;   // a picture: content of its own
    return { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out };
  } catch (e) {
    if (e instanceof Cancelled) throw e;
    return fail(e.message);
  }
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  if (!isRequest) {
    if (method === 'notifications/cancelled') { const s = running.get(params?.requestId); if (s) { s.cancelled = true; log(`cancelled ${params.requestId}${params.reason ? `: ${params.reason}` : ''}`); } }
    return;   // notifications/initialized and the rest need no answer
  }
  if (running.get(id)?.cancelled) return;   // cancelled while it waited its turn
  const meta = params?._meta ?? {};
  const modern = meta[PV] !== undefined;
  const reply = (result) => send({ jsonrpc: '2.0', id, result: modern ? { resultType: 'complete', ...result, _meta: { 'io.modelcontextprotocol/serverInfo': SERVER } } : result });
  try {
    if (method === 'initialize') {
      const asked = params?.protocolVersion;
      legacy = LEGACY.includes(asked) ? asked : LEGACY[0];
      return send({ jsonrpc: '2.0', id, result: { protocolVersion: legacy, capabilities: CAPABILITIES, serverInfo: SERVER, instructions: INSTRUCTIONS } });
    }
    if (method === 'ping') return reply({});
    if (modern) {
      if (!MODERN.includes(meta[PV])) throw new RpcError(-32022, 'Unsupported protocol version', { supported: [...MODERN, ...LEGACY], requested: meta[PV] });
      if (typeof meta[CAPS] !== 'object' || meta[CAPS] === null) throw new RpcError(-32602, `_meta["${CAPS}"] is required`);
    } else if (!legacy) throw new RpcError(-32602, `the request has no _meta["${PV}"] (protocol ${MODERN[0]}) and no initialize came first (protocol ${LEGACY[0]} and earlier); supported: ${[...MODERN, ...LEGACY].join(', ')}`);
    switch (method) {
      case 'server/discover': return reply({ supportedVersions: [...MODERN, ...LEGACY], capabilities: CAPABILITIES, instructions: INSTRUCTIONS });
      case 'tools/list': return reply({ tools: toolList() });
      case 'tools/call': {
        try { return reply(await callTool(params, id, meta.progressToken)); } catch (e) {
          if (e instanceof Cancelled) return undefined;   // no answer for a cancelled request
          throw e;
        }
      }
      default: throw new RpcError(-32601, `Method not found: ${method}`);
    }
  } catch (e) {
    if (e instanceof RpcError) return send({ jsonrpc: '2.0', id, error: { code: e.code, message: e.message, ...(e.data ? { data: e.data } : {}) } });
    log(e.stack ?? e.message);
    return send({ jsonrpc: '2.0', id, error: { code: -32603, message: `Internal error: ${e.message}` } });
  }
}

// Requests are served one at a time, in the order they came, so a change is
// seen by the call after it; a notification (a cancellation) acts at once,
// also while a long request (autotune) runs. At the end of stdin the
// requests under way finish, then the server exits.
function serve() {
  let buf = '', queue = Promise.resolve();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
      if (typeof msg !== 'object' || msg === null || Array.isArray(msg) || msg.jsonrpc !== '2.0') { send({ jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32600, message: 'Invalid Request: one JSON-RPC 2.0 object per line' } }); continue; }
      if (msg.id === undefined || msg.id === null) { handle(msg); continue; }
      const id = msg.id;
      running.set(id, { cancelled: false });
      queue = queue.then(() => handle(msg)).finally(() => running.delete(id));
    }
  });
  process.stdin.on('end', () => queue.then(() => process.exit(0)));
}

// Started from a terminal (runme) rather than by an agent's client: no agent
// talks to this window; it serves the page and says how to connect one.
if (TERMINAL) process.stderr.write('Started from a terminal: this window serves the page; an agent connects through its own MCP client (below). Ctrl+C ends it.\n');
if (process.argv.includes('--no-page')) process.stderr.write(`\n${explain(null)}\n`);
if (!process.argv.includes('--no-page')) servePage(Number(arg('--port') ?? process.env.LOOP_TUNER_PORT ?? 8766));
if (!TERMINAL) serve();
log(`ready (protocol ${[...MODERN, ...LEGACY].join(', ')})`);
