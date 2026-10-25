// Live (HIL), third round: the scope's keys through the plant (nothing runs
// by itself; Single finishes the run under way), the page's own guide for
// agents, a reset at the plant's key, and the plant script's modes, plants,
// stop keys, log file and bench. See design/output/hil.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { liveKey, liveScales, createLiveLoop } from '../src/core/live.js';
import { singleFrom } from '../src/core/speed.js';
import { GUIDE, apiList, guideText } from '../src/core/guide.js';
import { checkDescription, sameDescription, rpcRequest, uMessage, startParams } from '../src/core/hil.js';
import { normalizeDiagram } from '../src/core/diagram.js';
import { normalizeReference } from '../src/core/signals.js';
import { bundleScript } from '../build.mjs';

const SCRIPT = fileURLToPath(new URL('../hil/hil_plant.py', import.meta.url));

test('the scope keys with an External plant: nothing runs by itself, Run and Stop go through the plant', () => {
  // Offline or connecting: Run and Single are refused, the scope stays stopped.
  for (const link of ['offline', 'connecting']) {
    for (const k of ['run', 'single']) {
      const a = liveKey(k, { link, display: 'stop' });
      assert.equal(a.display, 'stop');
      assert.equal(a.plant, null);
      assert.match(a.why, link === 'offline' ? /Offline: connect the plant first/ : /connecting/);
    }
  }
  // Connected and stopped: Run starts the plant and a fresh sweep.
  assert.deepEqual(liveKey('run', { link: 'open', display: 'stop' }), { display: 'run', restart: true, plant: 'start', why: null });
  assert.deepEqual(liveKey('single', { link: 'open', display: 'stop' }), { display: 'single', restart: true, plant: 'start', why: null });
  // Running: Stop stops both; Single lets the sweep under way finish and
  // starts nothing; when that sweep has ended, the plant stops.
  assert.deepEqual(liveKey('stop', { link: 'running', display: 'run' }), { display: 'stop', restart: false, plant: 'stop', why: null });
  assert.deepEqual(liveKey('single', { link: 'running', display: 'run' }), { display: 'single', restart: false, plant: null, why: null });
  assert.deepEqual(liveKey('swept', { link: 'running', display: 'single' }), { display: 'stop', restart: false, plant: 'stop', why: null });
  assert.equal(liveKey('run', { link: 'running', display: 'single' }).display, 'run', 'Run during a pending Single keeps running');
  assert.equal(liveKey('run', { link: 'running', display: 'single' }).plant, null);
  // Latched: refused until Reset, and a running plant is stopped.
  assert.match(liveKey('run', { link: 'open', latched: true }).why, /E-STOP is latched: Reset first/);
  assert.equal(liveKey('single', { link: 'open', latched: true }).plant, null);
  assert.equal(liveKey('stop', { link: 'open' }).plant, null, 'Stop on a stopped plant sends nothing');
});

test('Single pressed while running finishes the sweep under way; from Stop it starts one', () => {
  assert.deepEqual(singleFrom('run'), { mode: 'single', restart: false });
  assert.deepEqual(singleFrom('single'), { mode: 'single', restart: false }, 'pressed again: still finishing');
  assert.deepEqual(singleFrom('stop'), { mode: 'single', restart: true });
});

test('the guide for agents: every method with its arguments and an example, the DOM it names exists, one text', () => {
  const names = GUIDE.api.map((m) => m.name);
  assert.equal(new Set(names).size, names.length, 'each method once');
  for (const m of GUIDE.api) {
    assert.match(m.name, /^loopTuner\./);
    assert.ok(m.does.length > 10 && m.example.startsWith('loopTuner.') || m.example.startsWith('await loopTuner.') || m.example.startsWith('const p = loopTuner.'), m.name);
  }
  for (const want of ['help', 'api', 'systems', 'loadSystem', 'setGains', 'run', 'stop', 'single', 'live.connect', 'live.estop', 'live.reset', 'live.hold', 'live.state', 'live.downloadPlant', 'live.plantFiles', 'live.settings', 'record.save', 'record.screenshot', 'record.live', 'record.screen']) {
    assert.ok(names.some((n) => n.startsWith(`loopTuner.${want}`)), `the guide has ${want}`);
  }
  assert.deepEqual(apiList().map((m) => m.name), names);
  const text = guideText();
  for (const n of names) assert.ok(text.includes(n), `${n} in the text`);
  for (const part of ['Setup, step by step', 'Protocol.', 'Safety.', 'What messages mean', 'Modes.']) assert.ok(text.includes(part), part);
  assert.ok(GUIDE.live.setup.length >= 6, 'the whole setup, step by step');
  // Every id the guide names is one the page makes.
  const page = bundleScript() + readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');
  for (const id of new Set(GUIDE.dom.join(' ').match(/#[a-z][a-z-]*[a-z]/g))) {
    const bare = id.slice(1);
    if (bare === 'live-scale' || bare === 'display') continue;  // (#live-scale-NAME: one per reference)
    assert.ok(page.includes(`id="${bare}"`) || page.includes(`id: '${bare}'`) || page.includes(`.id = '${bare}'`), `the page has ${id}`);
  }
  // The guide's own methods are in the page's API (app.js) or its parts.
  const app = readFileSync(new URL('../src/ui/app.js', import.meta.url), 'utf8') + readFileSync(new URL('../src/ui/live.js', import.meta.url), 'utf8') + readFileSync(new URL('../src/ui/record.js', import.meta.url), 'utf8');
  for (const n of names) {
    const key = n.replace(/^loopTuner\.(live\.|record\.)?/, '').replace(/\(.*$/, '');
    assert.ok(new RegExp(`\\b${key}: `).test(app), `${n} is defined`);
  }
});

const HIL_DIAGRAM = async () => {
  const { SYSTEM_LIBRARY } = await import('../src/core/systems.js');
  return SYSTEM_LIBRARY.find((s) => s.name === 'HIL: external motor');
};

test('full scales around the library plant: the channels and the references take them', async () => {
  const sys = await HIL_DIAGRAM();
  const { scales, refs } = liveScales(sys.plant.diagram);
  assert.deepEqual(refs.sort(), ['d', 'r']);
  assert.deepEqual(scales.angle.map((v) => Number(v.toFixed(4))), [-3.1416, 3.1416]);
  assert.deepEqual(scales.r, scales.angle, 'r is compared with angle: its full scale');
  assert.deepEqual(scales.V, [-12, 12]);
  assert.deepEqual(scales.d, [-0.2, 0.2], 'd drives the load input');
  assert.deepEqual(liveScales(null), { scales: {}, refs: [] });
});

// A fake plant for the loop: records what the page sends.
function fakePlant() {
  const sent = [];
  let ws = null;
  class FakeWS {
    constructor() { ws = this; this.readyState = 0; setTimeout(() => { this.readyState = 1; this.onopen?.(); }); }
    send(text) {
      const m = JSON.parse(text);
      sent.push(m);
      if (m.method === 'describe') this.reply(m.id, { protocol: 'loop-tuner-hil/1', name: 'fake', rate_hz: 100, inputs: [{ name: 'V', unit: 'V', min: -12, max: 12, safe: 0 }, { name: 'load', unit: 'N·m', min: -0.2, max: 0.2, safe: 0, kind: 'disturbance' }], outputs: [{ name: 'angle', unit: 'rad', min: -3.14, max: 3.14 }, { name: 'speed', unit: 'rad/s' }, { name: 'current', unit: 'A' }], running: false, estop: null });
      else if (m.id !== undefined) this.reply(m.id, m.method === 'start' ? { rate_hz: 100 } : {});
    }
    reply(id, result) { setTimeout(() => this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id, result }) })); }
    close() { this.readyState = 3; setTimeout(() => this.onclose?.({ code: 1000, reason: '' })); }
  }
  const env = { WebSocket: FakeWS, performance, setInterval, clearInterval, setTimeout };
  return { env, sent, notify: (method, params) => ws.onmessage({ data: JSON.stringify({ jsonrpc: '2.0', method, params }) }) };
}

test('the loop: a reset at the plant\'s own key clears an E-stop the plant latched, not one the page latched', async () => {
  const sys = await HIL_DIAGRAM();
  const plant = fakePlant();
  const out = [];
  const loop = createLiveLoop((m) => out.push(m), plant.env);
  const tick = () => new Promise((r) => setTimeout(r, 5));
  loop.handle({ type: 'program', diagram: normalizeDiagram(sys.plant.diagram), signals: Object.fromEntries(Object.entries(sys.input.signals).map(([k, v]) => [k, normalizeReference(v)])) });
  loop.handle({ type: 'connect', url: 'ws://x' });
  for (let i = 0; i < 5; i++) await tick();
  plant.notify('estop', { reason: 'STOP pressed at the plant', t: 1 });
  assert.equal(out.filter((m) => m.type === 'estop').length, 1);
  assert.deepEqual(out.at(-1), { type: 'state', state: 'open', detail: 'e-stop' }, 'still connected, stopped, latched');
  plant.notify('status', { estop: null, running: false });
  assert.ok(out.some((m) => m.type === 'cleared' && m.by === 'plant'));
  assert.deepEqual(out.at(-1), { type: 'state', state: 'open', detail: 'reset' });
  // The page's own E-STOP waits for the page's Reset.
  loop.handle({ type: 'estop' });
  await tick();
  const n = out.length;
  plant.notify('status', { estop: null, running: false });
  assert.ok(!out.slice(n).some((m) => m.type === 'cleared'), 'a page latch stays');
  loop.handle({ type: 'start' });
  await tick();
  assert.ok(out.some((m) => m.type === 'refused' && /E-STOP is latched/.test(m.message)));
  assert.ok(!plant.sent.some((m) => m.method === 'start'), 'nothing started');
});

// ---- The plant script (when Python is here; the server parts with uv).
function py(args, opts = {}) { return execFileSync('python3', ['-I', SCRIPT, ...args], { stdio: 'pipe', ...opts }).toString(); }

test('the plant script: both modes describe the library systems, a second plant, and never the physics', async (t) => {
  try { py(['--check']); } catch (err) { if (err.code === 'ENOENT') { t.skip('no python3'); return; } throw err; }
  const { SYSTEM_LIBRARY } = await import('../src/core/systems.js');
  const block = (name) => normalizeDiagram(SYSTEM_LIBRARY.find((s) => s.name === name).plant.diagram).blocks.find((b) => b.type === 'external');
  const control = checkDescription(JSON.parse(py(['--describe'])));
  assert.equal(control.mode, 'control');
  assert.ok(sameDescription(block('HIL: external motor').params, control), 'control mode: the library entry as described');
  const reference = checkDescription(JSON.parse(py(['--describe', '--mode', 'reference'])));
  assert.equal(reference.mode, 'reference');
  assert.deepEqual(reference.inputs.map((p) => [p.name, p.kind, p.measures]), [['r', 'reference', 'angle'], ['load', 'disturbance', '']]);
  assert.equal(reference.outputs.at(-1).name, 'V', 'the plant reports its own effort');
  assert.ok(sameDescription(block('HIL: external motor, reference mode').params, reference), 'reference mode: the library entry as described');
  const logger = checkDescription(JSON.parse(py(['--describe', '--mode', 'log'])));
  assert.equal(logger.mode, 'log');
  assert.equal(logger.inputs.length, 0);
  const heater = checkDescription(JSON.parse(py(['--describe', '--plant', 'heater'])));
  assert.deepEqual([heater.inputs[0].name, heater.outputs[0].name, heater.outputs[0].unit], ['P', 'T', '°C']);
  assert.match(py(['--check', '--plant', 'heater']), /°C after 30 s/);
  // Full scales for every port, no physics in the description.
  for (const d of [control, reference, heater]) for (const p of [...d.inputs, ...d.outputs]) assert.ok(Number.isFinite(p.min) && Number.isFinite(p.max), `${p.name} has a full scale`);
  const raw = py(['--describe', '--seed', '3']);
  for (const name of ['"R"', '"J"', '"mgl"', '"Tc"', 'seed']) assert.ok(!raw.includes(name), `describe does not say ${name}`);
  // --show-params and the seed are for the person at the plant, in --help.
  const help = py(['--help']);
  for (const opt of ['--plant', '--mode', '--vary', '--seed', '--show-params', '--log', '--bench', '--no-gui', '--slew']) assert.ok(help.includes(opt), opt);
});

// A port nobody listens on now (the system picks it).
const freePort = () => new Promise((resolve) => { const srv = createServer(); srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); }); });


// Starts hil_plant.py (console mode, stdin a pipe) on a free port: with
// python3 if it has websockets, else with uv from its cache (no network).
async function startPlant(extra = []) {
  const port = await freePort();
  const ways = [['python3', ['-I', SCRIPT, '--no-gui', '--port', String(port), ...extra]], ['uv', ['run', '--offline', '--quiet', SCRIPT, '--no-gui', '--port', String(port), ...extra]]];
  for (const [cmd, args] of ways) {
    const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let text = '';
    proc.stdout.on('data', (b) => { text += b; });
    const up = await new Promise((resolve) => {
      const done = (v) => { clearTimeout(timer); resolve(v); };
      const timer = setTimeout(() => done(false), 20000);
      proc.on('error', () => done(false));
      proc.on('exit', () => done(false));
      proc.stdout.on('data', () => { if (/listening on/.test(text)) done(true); });
    });
    if (up) return { proc, port, out: () => text };
    proc.kill();
  }
  return null;
}

test('hil_plant.py: STOP, reset, run and stop at its own keys reach the page; r and e go to its log file (when it can run here)', async (t) => {
  if (typeof WebSocket !== 'function') { t.skip('no WebSocket in this Node'); return; }
  const logPath = join(tmpdir(), `hil-log-${process.pid}.csv`);
  const plant = await startPlant(['--log', logPath, '--seed', '1']);
  if (!plant) { t.skip('neither python3 with websockets nor uv with websockets in its cache'); return; }
  const ws = new WebSocket(`ws://127.0.0.1:${plant.port}`);
  const notes = [], waiting = new Map();
  let id = 0;
  const call = (method, params) => new Promise((resolve) => { const i = ++id; waiting.set(i, resolve); ws.send(rpcRequest(i, method, params)); });
  const until = (pred, ms = 3000) => new Promise((resolve, reject) => {
    const t0 = Date.now();
    const check = () => { const hit = pred(); if (hit) resolve(hit); else if (Date.now() - t0 > ms) reject(new Error('timed out')); else setTimeout(check, 5); };
    check();
  });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id !== undefined && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); return; }
    notes.push(m);
    if (m.method === 'y') ws.send(uMessage(m.params.seq, [1.5, 0], [0.4, 0.4 - m.params.y[0]]));
  };
  const key = (k) => plant.proc.stdin.write(`${k}\n`);
  try {
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    await call('describe');
    assert.deepEqual((await call('start', startParams([{ name: 'r', unit: 'rad' }, { name: 'e', unit: 'rad' }]))).result, { rate_hz: 100 });
    await until(() => notes.filter((m) => m.method === 'y').length >= 20);
    // STOP at the plant: an E-stop the page hears, and running false.
    key('e');
    const stop = await until(() => notes.find((m) => m.method === 'estop'));
    assert.equal(stop.params.reason, 'STOP pressed at the plant');
    const off = await until(() => notes.find((m) => m.method === 'running' && m.params.running === false));
    assert.equal(off.params.by, 'plant');
    // Reset at the plant: a status at once, its E-stop gone.
    const n = notes.length;
    key('x');
    await until(() => notes.slice(n).find((m) => m.method === 'status' && m.params.estop === null), 1500);
    // Run at the plant (a page is connected): running true, y again from seq 0.
    key('r');
    const on = await until(() => notes.find((m) => m.method === 'running' && m.params.running === true && m.params.by === 'plant'));
    assert.ok(on);
    const k = notes.indexOf(on);
    await until(() => notes.slice(k).filter((m) => m.method === 'y').length >= 5);
    assert.equal(notes.slice(k).find((m) => m.method === 'y').params.seq, 0, 'a fresh run');
    key('s');
    await until(() => notes.slice(k).find((m) => m.method === 'running' && m.params.running === false));
  } finally {
    ws.close();
    plant.proc.kill('SIGINT');
    await new Promise((r) => { plant.proc.on('exit', r); setTimeout(r, 3000); });
  }
  const log = readFileSync(logPath, 'utf8');
  rmSync(logPath, { force: true });
  assert.match(log, /^t \[s\],angle \[rad\],speed \[rad\/s\],current \[A\],V \[V\],load \[N·m\],r \[rad\],e \[rad\],event/m, 'the log names r and e, declared at start');
  for (const ev of ['start by the page', 'E-STOP: STOP pressed at the plant', 'reset by the plant', 'start by the plant', 'stop by the plant']) assert.ok(log.includes(ev), ev);
  assert.match(log, /\n0\.\d+,[-\d.e]+,[-\d.e]+,[-\d.e]+,1\.5,0,0\.4,[-\d.e]+,\r?\n/, 'cycles with u and the page\'s r and e');
});

test('hil_plant.py --bench measures a run and ends (when it can run here)', async (t) => {
  if (typeof WebSocket !== 'function') { t.skip('no WebSocket in this Node'); return; }
  const plant = await startPlant(['--bench', '0.5', '--rate', '200']);
  if (!plant) { t.skip('neither python3 with websockets nor uv with websockets in its cache'); return; }
  const ws = new WebSocket(`ws://127.0.0.1:${plant.port}`);
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === 'y') ws.send(uMessage(m.params.seq, [0, 0])); };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.send(rpcRequest(1, 'start'));
  const code = await new Promise((r) => { plant.proc.on('exit', r); setTimeout(() => r('timeout'), 20000); });
  ws.close();
  assert.equal(code, 0, plant.out());
  const m = /bench-json: (.*)/.exec(plant.out());
  assert.ok(m, plant.out());
  const res = JSON.parse(m[1]);
  assert.equal(res.rate_set_hz, 200);
  for (const k of ['rate_hz', 'jitter_ms', 'rtt_ms', 'late', 'dropped', 'answered', 'cycles']) assert.ok(k in res, k);
  assert.ok(res.cycles >= 40 && res.answered >= 0.8 * res.cycles, `${res.answered} of ${res.cycles} answered`);
  assert.match(plant.out(), /bench: [\d.]+ Hz of 200 over/);
});
