#!/usr/bin/env node
// Loop Tuner as an MCP server (Model Context Protocol) over stdio: the same
// core the page and cli.mjs run, as tools an agent calls. No dependencies.
//
//   claude mcp add loop-tuner -- node /path/to/mcp.mjs
//
// One JSON-RPC 2.0 message per line on stdin and stdout; logs go to stderr.
// It serves both eras of the protocol (design/research/mcp.md): 2026-07-28,
// where every request carries its version in _meta and server/discover
// describes the server, and the earlier revisions that open with initialize.
// Projects live in this process's memory, each under a name; the one loaded
// last is the default. design/output/mcp.md says what each tool does.

import { resolve, basename } from 'node:path';
import { writeFileSync } from 'node:fs';
import { buildHtml } from './build.mjs';
import { normalizeProject } from './src/core/project.js';
import { normalizeComponent, SIGNALS } from './src/core/signals.js';
import { autotuneSteps, tuneReport, placeVariant, controllerBlocks } from './src/core/autotune.js';
import { readProject, writeProject, listSystems, findSystem, systemProject, allBlocks, findBlock, projectDesigns, runProject, analyzeProject, autotuneOptions } from './src/node/ops.mjs';

const SERVER = { name: 'loop-tuner', title: 'Loop Tuner', version: '0.1.0' };
const MODERN = ['2026-07-28'];
const LEGACY = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const CAPABILITIES = { tools: { listChanged: false } };
const INSTRUCTIONS = 'Loop Tuner simulates and tunes control loops. Start with list_systems and load_system (or load_system with a path to a project file), then run to measure the loop, autotune to improve a Controller block, analyze for margins and poles at an operating point, and save_project or export_html to hand the result back. Every tool takes an optional project name; the project loaded last is the default.';

// ---- Projects, in memory, by name

const projects = new Map();
let current = null;

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

// ---- Tools: name, description, input schema, and what it does

const projectArg = { type: 'string', description: 'The name of a project in memory (load_system returns it); default: the project loaded last.' };
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

const TOOLS = [
  {
    name: 'list_systems', title: 'List the System library',
    description: 'The System library: every ready-made system (plant, controllers and input) with its tags and notes. Load one with load_system.',
    inputSchema: obj({ tag: { type: 'string', description: 'Only the systems with this tag, as "PID" or "Nonlinear".' } }),
    run: ({ tag }) => ({ systems: listSystems().filter((s) => !tag || s.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) }),
  },
  {
    name: 'list_projects', title: 'List the projects in memory',
    description: 'The projects this server holds, by name, and which one is the default.',
    inputSchema: obj({}),
    run: () => ({ default: current, projects: [...projects.entries()].map(([name, p]) => ({ project: name, title: p.title })) }),
  },
  {
    name: 'load_system', title: 'Load a system or a project file',
    description: 'Loads a System library entry by name (or the start of its name), or a project file (.json, or an exported .html page with the project inside), into memory under a name, and makes it the default. Returns its Controller blocks, their variants and the signals.',
    inputSchema: obj({
      system: { type: 'string', description: 'A System library name, as "DC motor, position control" (list_systems lists them).' },
      path: { type: 'string', description: 'A project file: .json, or an exported .html page.' },
      as: { type: 'string', description: 'The name to keep it under; default: the system\'s name or the file\'s.' },
    }),
    run: ({ system, path, as }) => {
      if ((system === undefined) === (path === undefined)) throw new Error('give either system (a library name) or path (a project file)');
      if (system !== undefined) { const e = findSystem(system); return summary(keep(as ?? e.name, systemProject(e)), projects.get(as ?? e.name)); }
      const p = readProject(resolve(path)), name = as ?? basename(path).replace(/\.(json|html?)$/i, '');
      return summary(keep(name, p), p);
    },
  },
  {
    name: 'get_project', title: 'Get the project as JSON',
    description: 'The whole project as the file stores it (format loop-tuner/2): system.signals (the inputs), system.plant.diagram (the block diagram, Controller blocks with their variants), scope, sim. Change it and give it back with set_project.',
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
        out = () => ({ signal: a.signal, ...p2.system.signals[a.signal] });
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
        out = () => { const nb = findBlock(p2, a.block); return nb.variants ? { block: a.block, running: nb.variants[nb.variant ?? 0].name, variant: nb.variants[i], params: nb.params } : { block: a.block, params: nb.params }; };
      } else throw new Error('give block (with params, blockParams, variant, select) or signal (with components, period)');
      const p2 = normalizeProject(next);
      keep(name, p2);
      return { project: name, ...out() };
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
      cost: { type: 'string', enum: ['IAE', 'ITAE', 'ISE'] }, effort: { type: 'number' }, overshoot: { type: 'number', description: 'The overshoot the goal allows, %.' },
    }),
    run: (a) => {
      const { name, project } = take(a.project);
      const { goal } = autotuneOptions(project, { cost: a.cost, effort: a.effort, overshoot: a.overshoot }).opts;
      return { project: name, ...runProject(project, { duration: a.duration, goal, signals: a.signals ?? [], points: a.points }) };
    },
  },
  {
    name: 'autotune', title: 'Auto-tune a Controller block',
    description: 'Improves a Controller block\'s running variant by simulation, as the page\'s Auto-tune tab and `node cli.mjs autotune --json` do. method iterate: Nelder–Mead on the goal; relay: a relay experiment (Ku, Pu), then a rule; step: an open-loop step, a model fit, SIMC. Returns the report: before and after (variant, cost, overshoot), better, why it is worse when it is, what the experiment measured, notes. With apply, the result goes into the block as a variant of its own, "<name> · auto-tuned" (or "· relay T–L", "· SIMC"), and runs if it scores better; the original stays. Reports progress when the request carries a progress token; can be cancelled.',
    inputSchema: obj({
      project: projectArg,
      block: { type: 'string', description: 'A Controller block\'s id path; default the first.' },
      method: { type: 'string', enum: ['iterate', 'relay', 'step'], description: 'Default iterate.' },
      rule: { type: 'string', enum: ['tl', 'zn', 'calm'], description: 'relay: Tyreus–Luyben (default), Ziegler–Nichols, or calm.' },
      simc: { type: 'string', enum: ['tight', 'smooth'], description: 'step: τc = θ (tight, default) or 3θ (smooth).' },
      cost: { type: 'string', enum: ['IAE', 'ITAE', 'ISE'], description: 'The goal\'s error measure; default IAE.' },
      effort: { type: 'number', description: 'The weight of u\'s swing; default 0.05.' },
      overshoot: { type: 'number', description: 'The overshoot the goal allows, %; default 10.' },
      iterations: { type: 'integer', description: 'iterate: at most this many iterations (default 60).' },
      ff: { type: 'boolean', description: 'iterate: also tune the feedforward gains that are 0.' },
      amplitude: { type: 'number', description: 'relay, step: the experiment\'s size, % of the actuator range.' },
      apply: { type: 'boolean', description: 'Put the result into the project (default false).' },
    }),
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
      if (!res.ok) throw new Error(`could not tune ${rep.block}: ${res.why}`);
      return { project: name, applied: !!a.apply, ...rep };
    },
  },
  {
    name: 'analyze', title: 'Analyse a loop at an operating point',
    description: 'The Analysis tab\'s numbers for a Controller block\'s loop, linearised at an operating point: stable or not (closed-loop poles outside the unit circle), the gain margins (factors up and down; null: none), the phase margin and crossover, the delay margin, Ms and Mt, the least damping and the closed-loop poles (s-plane, with ωn and ζ), and the linear step (overshoot, settling time). Where there is no linear loop (a relay, a kink at the point, a design not made, a plant outside the page) it is refused with the reason and a hint.',
    inputSchema: obj({
      project: projectArg,
      block: { type: 'string', description: 'A Controller block\'s id path; default the first.' },
      at: {
        description: '"origin" (all states 0, u = 0; default), "initial" (where the run starts), { "y": [levels] } (an equilibrium at these measurement levels, null leaves one free) or { "t": seconds } (a moment of the run).',
        anyOf: [{ type: 'string', enum: ['origin', 'initial'] }, obj({ y: { type: 'array', items: { type: ['number', 'null'] } } }, ['y']), obj({ t: { type: 'number' } }, ['t'])],
      },
    }),
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
    description: 'NOT BUILT YET: identifying a plant from a recorded experiment (Identify) is designed (design/output/identification.md) but its core is not on main yet. This tool says so; it will run the core once it lands.',
    inputSchema: obj({ project: projectArg }),
    run: () => { throw new Error('identify is not built yet: the Identify core (design/output/identification.md) has not landed; tune a simulated plant with autotune, or tune an External plant live in the page'); },
  },
  {
    name: 'save_project', title: 'Save the project to a file',
    description: 'Writes a project to a file: .json for the project, .html for the standalone page with the project inside (a person opens it in a browser). Returns the absolute path.',
    inputSchema: obj({ project: projectArg, path: { type: 'string', description: 'The file, .json or .html; relative paths are from the server\'s working directory.' } }, ['path']),
    run: ({ project, path }) => { const { name, project: p } = take(project); const file = resolve(path); writeProject(file, p); return { project: name, path: file }; },
  },
  {
    name: 'export_html', title: 'Export the standalone page',
    description: 'Writes the standalone Loop Tuner page with the project inside, for a person to open in a browser (it loads nothing from anywhere). Returns the absolute path.',
    inputSchema: obj({ project: projectArg, path: { type: 'string', description: 'The .html file to write.' } }, ['path']),
    run: ({ project, path }) => { const { name, project: p } = take(project); const file = resolve(path); writeFileSync(file, buildHtml({ project: p })); return { project: name, path: file }; },
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
const log = (...a) => process.stderr.write(`loop-tuner mcp: ${a.join(' ')}\n`);
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
  log(`ready (protocol ${[...MODERN, ...LEGACY].join(', ')})`);
}

serve();
