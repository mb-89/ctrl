// For the tests that run the real plant script (hil/hil_plant.py): a free
// port, the script started on it (python3 with websockets, else uv from its
// cache, no network), and a page's side of the link. Not a test file itself.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { rpcRequest } from '../src/core/hil.js';

export const SCRIPT = fileURLToPath(new URL('../hil/hil_plant.py', import.meta.url));

// A port nobody listens on now (the system picks it).
export const freePort = () => new Promise((resolve) => { const srv = createServer(); srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); }); });

// Starts the plant in console mode, stdin a pipe (its keys), on a free port.
// Resolves { proc, port, out(), err(), key(k), exited } or null where it cannot
// run here.
export async function startPlant(extra = []) {
  const port = await freePort();
  const ways = [['python3', ['-I', SCRIPT, '--no-gui', '--port', String(port), ...extra]], ['uv', ['run', '--offline', '--quiet', SCRIPT, '--no-gui', '--port', String(port), ...extra]]];
  for (const [cmd, args] of ways) {
    const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let text = '', err = '';
    proc.stdout.on('data', (b) => { text += b; });
    proc.stderr.on('data', (b) => { err += b; });
    const exited = new Promise((r) => proc.on('exit', (code) => r(code)));
    const up = await new Promise((resolve) => {
      const done = (v) => { clearTimeout(timer); resolve(v); };
      const timer = setTimeout(() => done(false), 20000);
      proc.on('error', () => done(false));
      proc.on('exit', () => done(false));
      proc.stdout.on('data', () => { if (/listening on/.test(text)) done(true); });
    });
    if (up) return { proc, port, out: () => text, err: () => err, key: (k) => proc.stdin.write(`${k}\n`), exited };
    proc.kill();
  }
  return null;
}

// The page's side: every frame the plant sends in `frames` (in order of
// arrival), `notes` without the replies, call(method, params) resolves the
// reply, raw(text) sends anything, until(pred) polls. answer(u) sets what each
// y is answered with (null: no answer).
export async function connectPlant(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const frames = [], notes = [], waiting = new Map();
  let id = 0, u = [0, 0], closed = null;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    frames.push(m);
    if (m.id !== undefined && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); return; }
    notes.push(m);
    if (m.method === 'y' && u) ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'u', params: { seq: m.params.seq, u } }));
  };
  ws.onclose = (e) => { closed = e; };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const call = (method, params) => new Promise((resolve) => { const i = ++id; waiting.set(i, resolve); ws.send(rpcRequest(i, method, params)); });
  const until = (pred, ms = 3000) => new Promise((resolve, reject) => {
    const t0 = Date.now();
    const check = () => { const hit = pred(); if (hit) resolve(hit); else if (Date.now() - t0 > ms) reject(new Error('timed out')); else setTimeout(check, 5); };
    check();
  });
  return { ws, frames, notes, call, raw: (text) => ws.send(text), until, answer: (next) => { u = next; }, closed: () => closed };
}
