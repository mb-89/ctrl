// Live (HIL) mode and traces: protocol messages, the page's watchdog, a
// diagram stepped against an external plant, and CSV/JSON round trips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { rpcRequest, uMessage, parseMessage, checkDescription, externalParams, sameDescription, pageWatchdog, createLinkStats, EXTERNAL_BLOCK, HIL_URL } from '../src/core/hil.js';
import { createLiveRunner, createLiveLoop } from '../src/core/live.js';
import { normalizeDiagram, compileDiagram, blockPorts } from '../src/core/diagram.js';
import { normalizeVariant, makeLaw } from '../src/core/controllers.js';
import { normalizeReference } from '../src/core/signals.js';
import { normalizeProject, evaluateSystem } from '../src/core/project.js';
import { createRecorder, traceToCsv, traceToJson, parseTrace } from '../src/core/trace.js';
import { bundleScript } from '../build.mjs';

const DESC = {
  protocol: 'loop-tuner-hil/1', name: 'motor', rate_hz: 100, watchdog_cycles: 10,
  inputs: [{ name: 'V', unit: 'V', min: -12, max: 12, safe: 0 }, { name: 'load', unit: 'N·m', min: -0.2, max: 0.2, safe: 0 }],
  outputs: [{ name: 'angle', unit: 'rad' }, { name: 'speed', unit: 'rad/s' }],
  estop: null, running: false,
};

test('protocol messages: requests, u answers, and what the plant sends', () => {
  assert.deepEqual(JSON.parse(rpcRequest(3, 'describe')), { jsonrpc: '2.0', id: 3, method: 'describe' });
  assert.deepEqual(JSON.parse(uMessage(42, [1.23456789012, NaN])), { jsonrpc: '2.0', method: 'u', params: { seq: 42, u: [1.23456789, null] } });
  assert.deepEqual(parseMessage('{"jsonrpc":"2.0","method":"y","params":{"seq":7,"t":0.07,"y":[1,"x",2]}}'), { kind: 'y', seq: 7, t: 0.07, y: [1, NaN, 2] });
  assert.equal(parseMessage('{"jsonrpc":"2.0","method":"y","params":{"t":0.07,"y":[1]}}').kind, 'invalid', 'a y needs its seq');
  assert.deepEqual(parseMessage('{"jsonrpc":"2.0","method":"estop","params":{"reason":"no u for 10 cycles","t":3.1}}'), { kind: 'estop', reason: 'no u for 10 cycles', t: 3.1 });
  assert.deepEqual(parseMessage('{"jsonrpc":"2.0","id":2,"result":{"rate_hz":100}}'), { kind: 'result', id: 2, result: { rate_hz: 100 } });
  assert.equal(parseMessage('{"jsonrpc":"2.0","id":4,"error":{"code":-32000,"message":"E-stop latched"}}').error, 'E-stop latched');
  assert.equal(parseMessage('not json').kind, 'invalid');
  assert.equal(parseMessage('{"jsonrpc":"1.0","method":"y"}').kind, 'invalid');
});

test('a plant description is checked and becomes the External block\'s ports', () => {
  const d = checkDescription(DESC);
  assert.equal(d.rate_hz, 100);
  assert.deepEqual(d.inputs.map((p) => p.name), ['V', 'load']);
  assert.throws(() => checkDescription({ ...DESC, rate_hz: 0 }), /rate_hz/);
  assert.throws(() => checkDescription({ ...DESC, inputs: [{ name: 'V', unit: 'V', min: -1, max: 1, safe: 5 }] }), /safe/);
  assert.throws(() => checkDescription({ ...DESC, outputs: [{ name: '2bad' }] }), /outputs\[0\]\.name/);
  const p = externalParams(d);
  assert.equal(p.url, HIL_URL);
  assert.deepEqual(p.outputs, ['angle', 'speed']);
  assert.deepEqual(blockPorts({ type: 'external', params: p }), [2, 2]);
  assert.ok(sameDescription(p, d));
  assert.ok(!sameDescription({ ...p, outputs: ['angle'] }, d));
  // Typed in the Plant tab as comma lists; missing limits are filled in, the safe value kept within them.
  const typed = EXTERNAL_BLOCK.normalize({ inputs: 'V, load', min: '-12', max: '12', safe: '-5, 3', outputs: 'x' });
  assert.deepEqual([typed.inputs, typed.min, typed.max, typed.safe], [['V', 'load'], [-12, -1], [12, 1], [-5, 1]]);
  assert.throws(() => EXTERNAL_BLOCK.normalize({ url: 'http://x' }), /WebSocket address/);
  assert.throws(() => normalizeDiagram({ blocks: [{ id: 'p', type: 'external', params: { outputs: 'a b' } }], wires: [] }), /\(p\)\.outputs: "a b" is not a name/);
});

test('the page watchdog trips after 10 silent cycles; link statistics count gaps and jitter', () => {
  assert.deepEqual(pageWatchdog({ now: 1095, lastY: 1000, rateHz: 100 }), { silent: 9, trip: false });
  assert.deepEqual(pageWatchdog({ now: 1100, lastY: 1000, rateHz: 100 }), { silent: 10, trip: true });
  assert.equal(pageWatchdog({ now: 1100, lastY: 1000, rateHz: 50, cycles: 5 }).trip, true);
  assert.equal(pageWatchdog({ now: 1000, lastY: 1000, rateHz: 100 }).silent, 0);
  const s = createLinkStats(100);
  [0, 10, 20.4, 30, 50].forEach((at, i) => s.add(at, [0, 1, 2, 3, 5][i], 0.1));
  const r = s.read();
  assert.equal(r.missed, 1, 'seq 4 never came');
  assert.ok(Math.abs(r.jitter - 0.4) < 1e-9);
  assert.ok(Math.abs(r.rate - 80) < 1e-9, '4 intervals in 50 ms');
  assert.ok(Math.abs(r.compute - 0.1) < 1e-12);
});

// r -> Controller (PID on r and angle) -> External (V, load <- d) -> sinks.
const LOOP = (variant = { name: 'PID', type: 'pid', params: { Kp: 3, Ki: 2, Kd: 0.1, Tf: 0.02, umin: -12, umax: 12 } }) => normalizeDiagram({
  blocks: [
    { id: 'r', type: 'source', params: { signal: 'r' } },
    { id: 'd', type: 'source', params: { signal: 'd' } },
    { id: 'c', type: 'controller', params: { inputs: 2, Ts: 0.01 }, variants: [variant, { name: 'Off', type: 'off' }], variant: 0 },
    { id: 'p', type: 'external', params: externalParams(checkDescription(DESC)) },
    { id: 'angle', type: 'sink', params: { name: 'angle' } },
    { id: 'V', type: 'sink', params: { name: 'V' } },
  ],
  wires: [{ from: 'r', to: 'c' }, { from: 'c', to: 'p' }, { from: 'd', to: 'p:1' }, { from: 'p', to: 'c:1' }, { from: 'p', to: 'angle' }, { from: 'c', to: 'V' }],
});
const SIGNALS = {
  r: normalizeReference({ period: 10, components: [{ type: 'step', params: { amplitude: 1, time: 0.05 } }] }),
  d: normalizeReference({ period: 10, components: [{ type: 'dc', params: { level: 0.05 } }] }),
};

test('live stepping: the u sent is what the controller law gives for the y received', () => {
  const runner = createLiveRunner(LOOP(), SIGNALS);
  assert.deepEqual(runner.names(), ['r', 'd', 'angle', 'V']);
  const law = makeLaw(normalizeVariant({ type: 'pid', params: { Kp: 3, Ki: 2, Kd: 0.1, Tf: 0.02, umin: -12, umax: 12 } }), 0.01);
  for (let k = 0; k < 40; k++) {
    const t = k * 0.01, angle = 0.3 * Math.sin(k / 5);
    const { u, values } = runner.step(t, [angle, 0.1]);
    const want = law.step([t >= 0.05 ? 1 : 0, angle]);
    assert.ok(Math.abs(u[0] - want) < 1e-12, `cycle ${k}: ${u[0]} vs ${want}`);
    assert.equal(u[1], 0.05, 'the load input plays d');
    assert.deepEqual(values.slice(2), [angle, u[0]]);
  }
  // Out of range or not a number: clamped, or the safe value.
  const wild = createLiveRunner(LOOP({ name: 'P', type: 'pid', params: { Kp: 1000 } }), SIGNALS);
  assert.equal(wild.step(0.1, [-1, 0]).u[0], 12);
  assert.equal(wild.step(0.11, [NaN, 0]).u[0], 12, 'a y that is not a number reads 0');
});

test('live edits: parameters change at the next cycle and keep the state; a new variant restarts', () => {
  const p = { Kp: 3, Ki: 2, Kd: 0, umin: -12, umax: 12 };
  const runner = createLiveRunner(LOOP({ name: 'PI', type: 'pid', params: p }), SIGNALS);
  // The same law, its parameters changed in place at the same cycle.
  const lawParams = { ...normalizeVariant({ type: 'pid', params: p }).params };
  const ref = makeLaw({ type: 'pid', params: lawParams }, 0.01);
  let k = 0;
  const cycle = () => { const t = k * 0.01; const y = 0.2; k++; return [runner.step(t, [y, 0]).u[0], ref.step([t >= 0.05 ? 1 : 0, y])]; };
  for (let i = 0; i < 20; i++) cycle();
  const edited = LOOP({ name: 'PI', type: 'pid', params: { ...p, Kp: 5 } });
  edited.blocks.find((b) => b.id === 'c').x = 999;   // moving a block changes nothing
  assert.equal(runner.update(edited, SIGNALS), 'kept');
  lawParams.Kp = 5;
  for (let i = 0; i < 20; i++) { const [got, want] = cycle(); assert.ok(Math.abs(got - want) < 1e-12, `${got} vs ${want}: the integral carried over`); }
  const flipped = structuredClone(edited);
  flipped.blocks.find((b) => b.id === 'c').variant = 1;
  assert.equal(runner.update(flipped, SIGNALS), 'rebuilt');
  assert.equal(runner.step(k * 0.01, [0.2, 0]).u[0], 0, 'Off runs');
});

test('offline, an External plant holds 0 and the rest of the system still runs', () => {
  const p = normalizeProject({ system: { signals: SIGNALS, plant: { type: 'diagram', diagram: LOOP() } }, scope: { timebase: { scale: 0.05, position: 0 } } });
  const { signals } = evaluateSystem(p);
  assert.equal(Math.max(...signals.angle.map(Math.abs)), 0);
  assert.ok(Math.abs(signals.V.at(-1) - (3 + 2 * 0.45)) < 0.05, 'the PI sees angle 0 and pushes: Kp·1 + Ki·0.45 s');
  const el = compileDiagram(LOOP(), 'plant', { standalone: true, sources: { r: () => 1, d: () => 0 } });
  assert.equal(el.externals.length, 1);
  assert.deepEqual(Array.from(el.externals[0].y), [0, 0]);
});

test('the loop answers each y at once, stops answering on its own watchdog, and restarts on Reset', async () => {
  // A fake plant behind a fake WebSocket; time is driven by hand.
  let clock = 0;
  const timers = [];
  const sent = [];
  class FakeSocket {
    constructor(url) { this.url = url; this.readyState = 1; sock = this; setTimeout(() => this.onopen?.(), 0); }
    send(text) {
      const m = JSON.parse(text);
      sent.push(m);
      if (m.id !== undefined) {
        const result = m.method === 'describe' ? DESC : {};
        setTimeout(() => this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) }), 0);
      }
    }
    close() { this.readyState = 3; this.onclose?.({ code: 1000, reason: '' }); }
  }
  let sock = null;
  const env = {
    WebSocket: FakeSocket, performance: { now: () => clock },
    setInterval: (f) => { timers.push(f); return timers.length; }, clearInterval: () => {}, setTimeout,
  };
  const out = [];
  const loop = createLiveLoop((m) => out.push(m), env);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  loop.handle({ type: 'connect', url: HIL_URL });
  await tick(); await tick(); await tick();
  assert.ok(out.some((m) => m.type === 'described' && m.desc.rate_hz === 100));
  loop.handle({ type: 'program', diagram: LOOP(), signals: SIGNALS });
  loop.handle({ type: 'start' });
  await tick(); await tick();
  assert.ok(sent.some((m) => m.method === 'start'));
  const y = (seq) => { clock = seq * 10; sock.onmessage({ data: JSON.stringify({ jsonrpc: '2.0', method: 'y', params: { seq, t: seq / 100, y: [0.1, 0] } }) }); };
  for (let s = 0; s < 5; s++) y(s);
  const us = sent.filter((m) => m.method === 'u');
  assert.deepEqual(us.map((m) => m.params.seq), [0, 1, 2, 3, 4], 'one u per y, with its seq');
  // Silence: after 10 cycles the page latches and stops answering.
  clock = 40 + 100;
  timers.forEach((f) => f());
  assert.ok(out.some((m) => m.type === 'estop' && m.by === 'page' && /silent/.test(m.reason)));
  y(15);
  assert.equal(sent.filter((m) => m.method === 'u').length, 5, 'no u while E-stopped');
  loop.handle({ type: 'reset' });
  await tick(); await tick();
  y(16);
  assert.equal(sent.filter((m) => m.method === 'u').at(-1).params.seq, 16, 'answers again after Reset');
});

test('the recorder keeps the last N seconds; traces round-trip through CSV and JSON', () => {
  const rec = createRecorder(1);
  rec.reset(['r', 'y'], { r: 'rad', y: 'm' }, 100);
  for (let k = 0; k < 250; k++) rec.push(k / 100, [k, k % 7 === 0 ? NaN : -k]);
  const s = rec.snapshot();
  assert.equal(s.t.length, 101, 'one second at 100 Hz, both ends');
  assert.equal(s.t[0], 1.49);
  assert.equal(s.signals.r[100], 249);
  assert.ok(Math.abs(rec.span() - 1) < 1e-9);
  assert.ok(rec.fits(['r', 'y'], 100) && !rec.fits(['r'], 100) && !rec.fits(['r', 'y'], 50));
  const csv = traceToCsv(s, { title: 'motor', source: 'live' });
  assert.match(csv.split('\n')[1], /^t \[s\],r \[rad\],y \[m\]$/);
  for (const text of [csv, traceToJson(s, { title: 'motor' })]) {
    const back = parseTrace(text);
    assert.deepEqual(Array.from(back.t), Array.from(s.t));
    assert.deepEqual(back.units, { r: 'rad', y: 'm' });
    for (const nm of ['r', 'y']) assert.deepEqual(Array.from(back.signals[nm]).map(String), Array.from(s.signals[nm]).map(String), nm);
  }
  rec.setLength(0.5);
  assert.equal(rec.snapshot().t.length, 51);
  assert.equal(rec.snapshot().t.at(-1), 2.49, 'a shorter record keeps the newest');
  const other = parseTrace('time,pos\n0,1\n0.5,2\n');
  assert.deepEqual(Object.keys(other.signals), ['pos']);
  assert.throws(() => parseTrace('t,x\nzero,1\n'), /first column/);
});

test('the plant script ships in the bundle; the worker part of the bundle runs on its own', () => {
  const bundle = bundleScript();
  assert.ok(bundle.includes('const __HIL_PLANT_PY = "#!/usr/bin/env python3'));
  // The worker gets the core modules only: no DOM is touched.
  const cut = bundle.indexOf('\n// ---- ui/');
  const core = new Function(`return ${bundle.slice(0, cut)}\nreturn __mods;\n})();`)();
  assert.equal(typeof core['core/live.js'].liveWorker, 'function');
  const text = readFileSync(new URL('../hil/hil_plant.py', import.meta.url), 'utf8');
  assert.match(text, /# \/\/\/ script\n# requires-python = ">=3\.9"\n# dependencies = \["websockets>=13"\]\n# \/\/\//, 'PEP 723 metadata, for uv run');
});

test('the plant script runs its physics and describes itself as the HIL system expects (when python3 is here)', async (t) => {
  const py = (arg) => execFileSync('python3', [new URL('../hil/hil_plant.py', import.meta.url).pathname, arg]).toString();
  let out;
  try { out = py('--check'); } catch (err) {
    if (err.code === 'ENOENT') { t.skip('no python3'); return; }
    throw err;
  }
  assert.match(out, /^angle 1\.\d+ rad/);
  const desc = checkDescription(JSON.parse(py('--describe')));
  const { SYSTEM_LIBRARY } = await import('../src/core/systems.js');
  const hil = SYSTEM_LIBRARY.find((s) => s.name === 'HIL: external motor');
  const block = normalizeDiagram(hil.plant.diagram).blocks.find((b) => b.type === 'external');
  assert.ok(sameDescription(block.params, desc), 'connecting changes nothing in the library system');
  assert.equal(desc.watchdog, 10);
});
