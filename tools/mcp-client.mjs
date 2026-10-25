// A small MCP client for mcp.mjs, as a real client speaks to it: it starts the
// server as a child process and exchanges one JSON-RPC message per line over
// its stdin and stdout. test/mcp.test.mjs uses it; run on its own, it plays
// the example session of design/output/mcp.md and prints the transcript:
//
//   node tools/mcp-client.mjs [legacy]      (legacy: open with initialize)

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MODERN = '2026-07-28';
const children = new Set();

// Ends every server still running (a test that failed half-way leaves some).
export const stopAll = () => { for (const c of children) c.kill(); };

// Starts the server. → { request, notify, call, notes, close, ready }; with
// modern, every request carries the 2026-07-28 _meta, else ready is the
// answer to initialize (unless initialize is false). onMessage sees every
// message, both ways; args go to the server (default: the page on a free
// port), script is the server to start (default this repository's).
export function startServer({ modern = true, initialize = true, onMessage = () => {}, args = ['--port', '0'], script = join(ROOT, 'mcp.mjs') } = {}) {
  const child = spawn(process.execPath, [script, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(child);
  child.on('exit', () => children.delete(child));
  const waiting = new Map(), notes = [];
  let buf = '', next = 1;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      onMessage('<', msg);
      if (msg.id !== undefined && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); } else notes.push(msg);
    }
  });
  child.stderr.resume();
  const write = (msg) => { onMessage('>', msg); child.stdin.write(JSON.stringify(msg) + '\n'); };
  const meta = (extra = {}) => (modern ? { 'io.modelcontextprotocol/protocolVersion': MODERN, 'io.modelcontextprotocol/clientInfo': { name: 'mcp-client', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': {}, ...extra } : extra);
  const request = (method, params = {}, { id = next++, extraMeta } = {}) => new Promise((res) => {
    waiting.set(id, res);
    const m = meta(extraMeta);
    write({ jsonrpc: '2.0', id, method, params: Object.keys(m).length ? { ...params, _meta: m } : params });
  });
  const notify = (method, params = {}) => write({ jsonrpc: '2.0', method, params });
  // A tool's result: its structured content, or an Error with its text.
  const call = async (name, args = {}, opts) => {
    const r = await request('tools/call', { name, arguments: args }, opts);
    if (r.error) throw Object.assign(new Error(r.error.message), { rpc: r.error });
    if (r.result.isError) throw Object.assign(new Error(r.result.content[0].text), { tool: true });
    return r.result.structuredContent;
  };
  const close = () => new Promise((res) => { child.on('exit', res); child.stdin.end(); });
  const ready = modern || !initialize ? Promise.resolve() : request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'mcp-client', version: '1' } }).then((r) => { notify('notifications/initialized'); return r; });
  return { request, notify, call, notes, close, ready, child };
}

// The example session: load the DC motor, run, autotune, analyse.
async function exampleSession(modern) {
  // Shortened: the request's method and arguments (not its _meta), a tool's
  // structured result, at most 600 characters a line.
  const short = (v) => { const s = JSON.stringify(v); return s.length > 600 ? `${s.slice(0, 600)}…` : s; };
  const show = (dir, m) => {
    if (dir === '>') { const { _meta, ...p } = m.params ?? {}; console.log(`> ${m.method}${m.id !== undefined ? ` #${m.id}` : ''} ${short(p)}${_meta?.progressToken ? `  (progressToken ${_meta.progressToken})` : ''}`); }
    else if (m.method) console.log(`< ${m.method} ${short(m.params)}`);
    else console.log(`< #${m.id} ${short(m.error ?? m.result.structuredContent ?? m.result)}`);
  };
  const s = startServer({ modern, onMessage: show });
  await s.ready;
  if (modern) await s.request('server/discover');
  await s.request('tools/list');
  await s.call('load_system', { system: 'DC motor, position control' });
  await s.call('run', { signals: ['r', 'ctrl.y'], points: 6 });
  await s.call('autotune', { method: 'iterate', apply: true }, { extraMeta: { progressToken: 'tune-1' } });
  await s.call('run');
  await s.call('analyze', { at: 'initial' });
  await s.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) exampleSession(process.argv[2] !== 'legacy');
