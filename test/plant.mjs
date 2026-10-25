// For the tests that run the real plant script (hil/hil_plant.py): the page's
// core as the zip carries it, the script run with uv from its cache (no
// network) as the runme scripts run it, a free port, and a page's side of
// the link. Not a test file itself.
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rpcRequest } from '../src/core/hil.js';
import { simulatorCore } from '../src/core/hilsim.js';
import { bundleScript } from '../tools/build.mjs';

export const SCRIPT = fileURLToPath(new URL('../hil/hil_plant.py', import.meta.url));

// loop-tuner-core.js as the page puts it in the zip, written once per process.
let core = null;
export function coreFile() {
  if (!core || !existsSync(core)) {
    core = join(tmpdir(), `loop-tuner-core-${process.pid}.js`);
    writeFileSync(core, simulatorCore(bundleScript()));
  }
  return core;
}

// The script's arguments with the core, run by uv offline (its dependencies
// from uv's cache).
export const UV = ['run', '--offline', '--quiet'];
export const plantArgs = (args) => [...UV, SCRIPT, ...args, '--core', coreFile()];

// Runs the script and returns what it printed, or null where uv cannot run it
// here (no uv, or websockets and mini-racer not in its cache).
let usable;
export function runPlant(args, opts = {}) {
  if (usable === false) return null;
  try {
    const out = execFileSync('uv', plantArgs(args), { stdio: 'pipe', ...opts }).toString();
    usable = true;
    return out;
  } catch (err) {
    if (usable === undefined && (err.code === 'ENOENT' || /mini-racer|websockets|offline|No solution/i.test(String(err.stderr)))) { usable = false; return null; }
    throw err;
  }
}

// Python code that imports the script as module m (with say silenced) and the
// arguments a plant takes, for probes of its insides. Run by pyProbe.
export const PROBE_HEAD = `
import importlib.util, json, sys, types
spec = importlib.util.spec_from_file_location('hp', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.say = lambda text: None
def args(**kw):
    a = dict(rate=100.0, model=m.DEFAULT_MODEL, random=False, detail='all', mode='control', setpoint=None, log=None, bench=0, watchdog=10, slew=0.0, vary=0.0, seed=1, set=[], allow_origin=[], strict_origin=False, dyno=False, core=sys.argv[2])
    a.update(kw)
    return types.SimpleNamespace(**a)
`;
export function pyProbe(code) {
  if (usable === false) return null;
  try {
    return execFileSync('uv', [...UV, '--with', 'websockets>=13', '--with', 'mini-racer>=0.12', 'python', '-I', '-B', '-c', PROBE_HEAD + code, SCRIPT, coreFile()], { stdio: 'pipe' }).toString();
  } catch (err) {
    if (err.code === 'ENOENT' || /No solution|offline/i.test(String(err.stderr))) { usable = false; return null; }
    throw err;
  }
}

// A port nobody listens on now (the system picks it).
export const freePort = () => new Promise((resolve) => { const srv = createServer(); srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); }); });

// Starts the plant in console mode, stdin a pipe (its keys), on a free port.
// Resolves { proc, port, out(), err(), key(k), exited } or null where it cannot
// run here.
export async function startPlant(extra = []) {
  const port = await freePort();
  const proc = spawn('uv', plantArgs(['--no-gui', '--port', String(port), ...extra]), { stdio: ['pipe', 'pipe', 'pipe'] });
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
  return null;
}

// The page's side: every frame the plant sends in `frames` (in order of
// arrival), `notes` without the replies, call(method, params) resolves the
// reply, raw(text) sends anything, until(pred) polls. answer(u) sets what each
// y is answered with (null: no answer; by default the safe inputs the plant
// described, once it has).
export async function connectPlant(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const frames = [], notes = [], waiting = new Map();
  let id = 0, u = 'safe', safe = [0], closed = null;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    frames.push(m);
    if (Array.isArray(m.result?.inputs)) safe = m.result.inputs.map((p) => p.safe ?? 0);
    if (m.id !== undefined && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); return; }
    notes.push(m);
    if (m.method === 'y' && u) ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'u', params: { seq: m.params.seq, u: u === 'safe' ? safe : u } }));
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
