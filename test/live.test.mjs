// Live (HIL) mode and traces: protocol messages, the page's watchdog, a
// diagram stepped against an external plant (and edited while it runs), the
// loop against a fake plant, where live and saved time lands on the screen,
// the live record, CSV/JSON round trips, and the real plant script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rpcRequest, uMessage, parseMessage, checkDescription, externalParams, sameDescription, pageWatchdog, createLinkStats, EXTERNAL_BLOCK, HIL_URL } from '../src/core/hil.js';
import { createLiveRunner, createLiveLoop } from '../src/core/live.js';
import { normalizeDiagram, compileDiagram, blockPorts } from '../src/core/diagram.js';
import { normalizeVariant, makeLaw, CONTROLLERS, CONTROLLER_TYPES } from '../src/core/controllers.js';
import { OBSERVERS, OBSERVER_TYPES } from '../src/core/observers.js';
import { normalizeReference } from '../src/core/signals.js';
import { normalizeProject, evaluateSystem } from '../src/core/project.js';
import { createRecorder, traceToCsv, traceToJson, traceToCsvParts, traceToJsonParts, parseTrace, traceWindow, sweepStart, refShift, refSteps } from '../src/core/trace.js';
import { zipFiles, crc32 } from '../src/core/zip.js';
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
  // d is 0 (the load's safe value) at its first instant, so these runs start
  // without a ramp-in; the ramp-in has tests of its own.
  d: normalizeReference({ period: 10, components: [{ type: 'step', params: { amplitude: 0.05, time: 0.001 } }] }),
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
    assert.equal(u[1], k ? 0.05 : 0, 'the load input plays d');
    assert.deepEqual(values.slice(2), [angle, u[0]]);
  }
  // Out of range or not a number: clamped, or the safe value.
  const wild = createLiveRunner(LOOP({ name: 'P', type: 'pid', params: { Kp: 1000 } }), SIGNALS);
  wild.step(0, [0, 0]);
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
  // y is 0 at the first cycle, where r starts: no ramp-in.
  const cycle = () => { const t = k * 0.01; const y = k ? 0.2 : 0; k++; return [runner.step(t, [y, 0]).u[0], ref.step([t >= 0.05 ? 1 : 0, y])]; };
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

// A fake plant behind a fake WebSocket, time driven by hand. opts.early: the
// plant streams a y before it answers start; opts.desc: its description.
function fakeLoop(opts = {}) {
  let clock = 0, sock = null;
  const timers = [], sent = [], out = [];
  class FakeSocket {
    constructor(url) { this.url = url; this.readyState = 1; sock = this; setTimeout(() => this.onopen?.(), 0); }
    send(text) {
      const m = JSON.parse(text);
      sent.push(m);
      if (m.id === undefined) return;
      if (m.method === 'start' && opts.early) this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', method: 'y', params: { seq: 0, t: 0, y: [0.1, 0] } }) });
      const result = m.method === 'describe' ? (opts.desc ?? DESC) : {};
      setTimeout(() => this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) }), 0);
    }
    close() { this.readyState = 3; this.onclose?.({ code: 1000, reason: '' }); }
  }
  const env = {
    WebSocket: FakeSocket, performance: { now: () => clock },
    setInterval: (f) => { timers.push(f); return timers.length; }, clearInterval: () => {}, setTimeout,
  };
  const loop = createLiveLoop((m) => out.push(m), env);
  const tick = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
  const y = (seq, t = seq / 100) => { clock = seq * 10; sock.onmessage({ data: JSON.stringify({ jsonrpc: '2.0', method: 'y', params: { seq, t, y: [0.1, 0] } }) }); };
  const us = () => sent.filter((m) => m.method === 'u');
  return { loop, sent, out, tick, y, us, timers, setClock: (c) => { clock = c; } };
}

test('the loop answers each y at once, stops answering on its own watchdog, and restarts on Reset', async () => {
  const f = fakeLoop();
  f.loop.handle({ type: 'connect', url: HIL_URL });
  await f.tick();
  assert.ok(f.out.some((m) => m.type === 'described' && m.desc.rate_hz === 100));
  assert.ok(!f.out.some((m) => m.type === 'error'), 'the same protocol: no warning');
  f.loop.handle({ type: 'program', diagram: LOOP(), signals: SIGNALS });
  f.loop.handle({ type: 'start' });
  await f.tick();
  assert.ok(f.sent.some((m) => m.method === 'start'));
  assert.ok(f.out.some((m) => m.type === 'run'), 'a new run is announced before its samples');
  for (let s = 0; s < 5; s++) f.y(s);
  assert.deepEqual(f.us().map((m) => m.params.seq), [0, 1, 2, 3, 4], 'one u per y, with its seq');
  // Silence: after 10 cycles the page latches and stops answering.
  f.setClock(40 + 100);
  f.timers.forEach((fn) => fn());
  assert.ok(f.out.some((m) => m.type === 'estop' && m.by === 'page' && /silent/.test(m.reason)));
  f.y(15);
  assert.equal(f.us().length, 5, 'no u while E-stopped');
  f.loop.handle({ type: 'reset' });
  await f.tick();
  f.y(16);
  assert.equal(f.us().length, 5, 'Reset clears the latch; nothing runs until Run');
  f.loop.handle({ type: 'start' });
  await f.tick();
  f.y(17);
  assert.equal(f.us().at(-1).params.seq, 17, 'answers again after Run');
});

test('the loop: y before start\'s answer, Run as a fresh run, Stop, and a plant speaking another protocol', async () => {
  const f = fakeLoop({ early: true, desc: { ...DESC, protocol: 'other-hil/2' } });
  f.loop.handle({ type: 'connect', url: HIL_URL });
  await f.tick();
  assert.ok(f.out.some((m) => m.type === 'error' && /other-hil\/2.*may not work/.test(m.message)), 'a protocol mismatch is said');
  f.loop.handle({ type: 'program', diagram: LOOP(), signals: SIGNALS });
  f.loop.handle({ type: 'start' });
  await f.tick();
  assert.equal(f.out.filter((m) => m.type === 'error').length, 1, 'a y before the start result is no error');
  assert.deepEqual(f.us().map((m) => m.params.seq), [0], 'and it is answered');
  assert.equal(f.out.filter((m) => m.type === 'state').at(-1).state, 'running');
  for (let s = 1; s < 4; s++) f.y(s);
  // Run again (Single): stop, then start: the plant's clock and the controllers restart.
  const before = f.sent.length;
  f.loop.handle({ type: 'start' });
  await f.tick();
  assert.deepEqual(f.sent.slice(before).filter((m) => m.id !== undefined).map((m) => m.method), ['stop', 'start']);
  assert.equal(f.out.filter((m) => m.type === 'run').length, 2);
  f.loop.handle({ type: 'stop' });
  await f.tick();
  assert.equal(f.sent.filter((m) => m.method === 'stop').length, 2);
  assert.deepEqual(f.out.filter((m) => m.type === 'state').at(-1), { type: 'state', state: 'open', detail: 'stopped' });
  const n = f.us().length;
  f.y(9);
  assert.equal(f.us().length, n, 'a stopped loop sends no u');
});

test('live sweeps and references land in the window the way a simulated run does', () => {
  // Window 1 … 6 s (position 1 s, 0.5 s/div): the first sweep shows plant time
  // 1 … 6 s where the axis says so; the next, 6 … 11 s, again at 1 … 6.
  const drawnAt = (t, w0 = 1, W = 5) => w0 + (t - sweepStart(t, w0, W));
  assert.equal(sweepStart(1, 1, 5), 1);
  assert.equal(drawnAt(3), 3, 'r falls at 3 s: drawn at 3 s');
  assert.equal(drawnAt(4.6), 4.6);
  assert.equal(sweepStart(6, 1, 5), 6);
  assert.ok(Math.abs(drawnAt(8) - 3) < 1e-12);
  assert.equal(sweepStart(0.5, 1, 5), -4, 'before the window: the sweep before');
  assert.equal(sweepStart(0, 0, 5), 0);
  assert.equal(sweepStart(4.999, 0, 5), 0);
  assert.equal(sweepStart(5, 0, 5), 5);
  // A reference from the same screen lines up; one recorded later is folded in.
  assert.equal(refShift(0, 5, 1, 5), 0);
  assert.equal(refShift(300, 310, 0, 2), -300, 'a live record from minute 5 starts at the left edge');
  assert.equal(refShift(300, 310, 0, 2, 2), -304, 'two screens on');
  assert.deepEqual(refSteps(300, 310, 0, 2), { min: 0, max: 4 });
  assert.deepEqual(refSteps(0, 5, 1, 5), { min: -1, max: 0 });
  assert.deepEqual(refSteps(0, 1, 0, 5), { min: 0, max: 0 });
});

test('the live record keeps the last N seconds of every signal by name, growing as it fills', () => {
  const rec = createRecorder(1);
  const nm = ['r', 'y'];
  rec.setUnits({ r: 'rad', y: 'm' });
  for (let k = 0; k < 250; k++) rec.push(k / 100, nm, [k, k % 7 === 0 ? NaN : -k]);
  let s = rec.snapshot();
  assert.equal(s.t.length, 101, 'one second at 100 Hz, both ends');
  assert.equal(s.t[0], 1.49);
  assert.equal(s.signals.r[100], 249);
  assert.ok(Math.abs(rec.span() - 1) < 1e-9);
  // A Sink added while live: a new column, NaN before it came; nothing is lost.
  rec.push(2.5, ['r', 'y', 'V'], [250, -250, 3]);
  s = rec.snapshot();
  assert.deepEqual(Object.keys(s.signals), ['r', 'y', 'V']);
  assert.deepEqual(s.units, { r: 'rad', y: 'm', V: '1' });
  assert.equal(s.t.length, 101, '1.49 s has aged out');
  assert.equal(s.t[0], 1.5);
  assert.ok(Number.isNaN(s.signals.V[0]));
  assert.equal(s.signals.V.at(-1), 3);
  // A shorter length keeps the newest; a gap ages everything out by time.
  rec.setLength(0.5);
  assert.equal(rec.snapshot().t[0], 2);
  rec.push(10, ['r'], [1]);
  assert.equal(rec.length, 1);
  assert.ok(Number.isNaN(rec.snapshot().signals.y[0]), 'a signal that did not come is empty');
  // The memory: room for 30 numbers is 10 samples of t, a, b; the oldest go first.
  const small = createRecorder(100, 30);
  for (let k = 0; k < 20; k++) small.push(k, ['a', 'b'], [k, 2 * k]);
  assert.equal(small.length, 10);
  assert.equal(small.snapshot().t[0], 10);
  assert.equal(small.snapshot().signals.b[9], 38);
  assert.equal(small.longest(), 10, 'it holds 10 s at this rate');
});

test('traces round-trip through CSV and JSON, written in parts', () => {
  const t = Float64Array.from({ length: 45001 }, (_, i) => i / 1000);
  const tr = { t, signals: { r: t.map((x) => Math.sin(x)), y: t.map((x, i) => (i % 9 ? -x : NaN)) }, units: { r: 'rad', y: 'N·m' } };
  const parts = traceToCsvParts(tr, { title: 'motor', source: 'live' });
  assert.ok(parts.length > 3, 'a long trace is written piece by piece');
  assert.equal(parts.join(''), traceToCsv(tr, { title: 'motor', source: 'live' }));
  assert.match(parts[0].split('\n')[1], /^t \[s\],r \[rad\],y \[N·m\]$/);
  for (const text of ['\uFEFF' + parts.join(''), traceToJsonParts(tr, { title: 'motor' }).join('')]) {
    const back = parseTrace(text);
    assert.equal(back.t.length, t.length);
    assert.equal(back.t[45000], 45);
    assert.deepEqual(back.units, { r: 'rad', y: 'N·m' });
    for (const nm of ['r', 'y']) assert.deepEqual(Array.from(back.signals[nm].subarray(0, 50)).map(String), Array.from(tr.signals[nm].subarray(0, 50), (v) => String(Number.isFinite(v) ? Number(v.toPrecision(9)) : NaN)), nm);
  }
  assert.equal(JSON.parse(traceToJson(tr)).signals.y[0], null);
  const w = traceWindow(tr, 1, 2);
  assert.equal(w.t[0], 1);
  assert.equal(w.t.at(-1), 2);
  const other = parseTrace('time,pos\n0,1\n0.5,2\n');
  assert.deepEqual(Object.keys(other.signals), ['pos']);
  assert.throws(() => parseTrace('t,x\nzero,1\n'), /first column/);
});

// A value other than v for a parameter, of the same shape; for a choice
// (anti-windup), the next option.
const other = (v, spec = {}) => {
  if (spec.kind === 'choice') { const keys = Object.keys(spec.options); return keys[(keys.indexOf(v) + 1) % keys.length]; }
  return Array.isArray(v) ? v.map((x, i) => (x === 0 ? 0.05 * (i + 1) : x * 1.5)) : v === 0 ? 0.05 : v * 1.5;
};
// Test values that make every law do something (finite limits, a filter on r).
const LAW_PARAMS = {
  pid: { Kp: 2, Ki: 1, Kd: 0.1, Tf: 0.02, Tr: 0.1, umin: -5, umax: 5 },
  stateFeedback: { K: [2, 0.3], kr: 2, Tr: 0.1, umin: -5, umax: 5 },
  gainScheduled: { at: [0, 1], Kp: [2, 4], Ki: [1, 2], Tr: 0.1, umin: -5, umax: 5 },
  swingUp: { kE: 1, kx: 0.5, kv: 0.5, thetaS: 0.4, umin: -5, umax: 5 },
  difference: { Tf: 0.02 },
};

test('every controller and observer law reads its parameters at every step (so a live edit takes effect)', () => {
  const libs = [[CONTROLLERS, CONTROLLER_TYPES], [OBSERVERS, OBSERVER_TYPES]];
  for (const [lib, types] of libs) {
    for (const type of types) {
      const base = normalizeVariant({ type, params: LAW_PARAMS[type] ?? {} }, type, lib).params;
      for (const spec of lib[type].params) {
        if (spec.key === 'u0') continue;  // the integral at the start: it waits for the next start
        const next = other(base[spec.key], spec);
        const edited = { ...base }, fresh = { ...base, [spec.key]: next };
        // Made with the old value and changed before the first step, a law
        // that reads its parameters as it runs matches one made with the new.
        const a = lib[type].make(edited, 0.01);
        edited[spec.key] = next;
        const b = lib[type].make(fresh, 0.01);
        for (let k = 0; k < 40; k++) {
          const x = [Math.sin(k / 7), 0.3 * Math.cos(k / 5), 0.2 * Math.sin(k / 3), 0.1, -0.1];
          const arr = (v) => (typeof v === 'number' ? [v] : Array.from(v));
          assert.deepEqual(arr(a.step(x)), arr(b.step(x)), `${type}.${spec.key} at step ${k}`);
        }
      }
    }
  }
});

test('live edits of any variant parameter are taken in place; names are cosmetic; a stop shows the safe inputs', () => {
  // The review's case: a gain-scheduled PI's output limit, lowered while running.
  const gs = { name: 'GS', type: 'gainScheduled', params: { at: [0, 1], Kp: [5, 5], Ki: [1, 1], umin: -12, umax: 12 } };
  const runner = createLiveRunner(LOOP(gs), SIGNALS);
  for (let k = 0; k < 10; k++) runner.step(k * 0.01, [0, 0]);
  const lowered = LOOP({ ...gs, params: { ...gs.params, umax: 2 } });
  assert.equal(runner.update(lowered, SIGNALS), 'kept');
  assert.equal(runner.step(0.1, [0, 0]).u[0], 2, 'the new limit holds at the next sample');
  const renamed = structuredClone(lowered);
  renamed.blocks.find((b) => b.id === 'c').variants[0].name = 'Scheduled';
  assert.equal(runner.update(renamed, SIGNALS), 'kept', 'renaming a variant restarts nothing');
  // A project restored by Undo carries open limits as null (JSON): edits are
  // still taken in place, and the limits stay open.
  const restored = JSON.parse(JSON.stringify(LOOP({ name: 'P', type: 'pid', params: { Kp: 3 } })));
  const r2 = createLiveRunner(restored, SIGNALS);
  r2.step(0, [0, 0]);
  restored.blocks.find((b) => b.id === 'c').variants[0].params.Kp = 30;
  assert.equal(r2.update(restored, SIGNALS), 'kept');
  const out = r2.step(0.1, [0, 0]);
  assert.equal(out.values[3], 30, 'V: Kp 30 on r = 1, no limit');
  assert.equal(out.u[0], 12, 'sent within the plant\'s 12 V');
  // Every parameter of every controller type.
  for (const type of CONTROLLER_TYPES) {
    const v = { name: type, type, params: LAW_PARAMS[type] ?? {} };
    const r = createLiveRunner(LOOP(v), SIGNALS);
    r.step(0, [0.1, 0]);
    for (const spec of CONTROLLERS[type].params) {
      const d = LOOP(v), c = d.blocks.find((b) => b.id === 'c');
      c.variants[0].params[spec.key] = other(c.variants[0].params[spec.key], spec);
      assert.equal(r.update(normalizeDiagram(d), SIGNALS), 'kept', `${type}.${spec.key}`);
    }
  }
  // E-stop latched: the plant applies its safe inputs, and the Sink on the
  // controller's output shows them, not what the controller computes.
  const held = createLiveRunner(LOOP(), SIGNALS);
  held.step(0, [0, 0]);
  const free = held.step(0.1, [0.1, 0]);
  assert.ok(Math.abs(free.u[0]) > 0.5);
  const stopped = held.step(0.11, [0.1, 0], true);
  assert.deepEqual(stopped.u, [0, 0]);
  assert.deepEqual(stopped.values.slice(2), [0.1, 0], 'angle as measured, V as applied (safe)');
  assert.equal(stopped.values[0], 1, 'r plays on');
});

test('an observer in a live loop takes parameter edits in place and keeps its estimate', () => {
  const kalman = { name: 'KF', type: 'kalman', params: { A: [0, 1, 0, 0], B: [0, 1], C: [1, 0], Q: [1, 1], R: [1] } };
  const diagram = () => normalizeDiagram({
    blocks: [
      { id: 'r', type: 'source', params: { signal: 'r' } },
      { id: 'd', type: 'source', params: { signal: 'd' } },
      { id: 'o', type: 'observer', params: { inputs: 2, outputs: 2, Ts: 0.01 }, variants: [kalman, { name: 'FD', type: 'difference' }], variant: 0 },
      { id: 'c', type: 'controller', params: { inputs: 3, Ts: 0.01 }, variants: [{ name: 'SF', type: 'stateFeedback', params: { K: [2, 0.5], kr: 2, umin: -12, umax: 12 } }], variant: 0 },
      { id: 'p', type: 'external', params: externalParams(checkDescription(DESC)) },
      { id: 'xh', type: 'sink', params: { name: 'xh' } },
    ],
    wires: [{ from: 'r', to: 'c' }, { from: 'o', to: 'c:1' }, { from: 'o:1', to: 'c:2' }, { from: 'c', to: 'p' }, { from: 'd', to: 'p:1' },
      { from: 'c', to: 'o' }, { from: 'p', to: 'o:1' }, { from: 'o', to: 'xh' }],
  });
  // Two runners alike; one takes an edit of Q. The estimate carries on (a
  // restart would begin again from 0, as a fresh runner shows).
  const edited = createLiveRunner(diagram(), SIGNALS), same = createLiveRunner(diagram(), SIGNALS);
  for (let k = 0; k < 30; k++) { edited.step(k * 0.01, [0.5, 0]); same.step(k * 0.01, [0.5, 0]); }
  const d = diagram();
  d.blocks.find((b) => b.id === 'o').variants[0].params.Q = [1.2, 1.2];
  assert.equal(edited.update(d, SIGNALS), 'kept');
  const xa = edited.step(0.3, [0.5, 0]).values[2], xb = same.step(0.3, [0.5, 0]).values[2];
  const xc = createLiveRunner(diagram(), SIGNALS).step(0.3, [0.5, 0]).values[2];
  assert.ok(Math.abs(xa - xb) < 0.02, `kept: ${xa} vs ${xb}`);
  assert.ok(Math.abs(xc - xb) > 0.1, `a restart would show: ${xc} vs ${xb}`);
});

test('the plant ships in the bundle; the worker part of the bundle runs on its own', () => {
  const bundle = bundleScript();
  assert.ok(bundle.includes('const __HIL_FILES = {"hil_plant.py":"#!/usr/bin/env python3'));
  for (const f of ['runme.sh', 'runme.ps1', 'README.txt']) assert.ok(bundle.includes(`"${f}":`), f);
  // The worker gets the core modules only: no DOM is touched.
  const cut = bundle.indexOf('\n// ---- ui/');
  const core = new Function(`return ${bundle.slice(0, cut)}\nreturn __mods;\n})();`)();
  assert.equal(typeof core['core/live.js'].liveWorker, 'function');
  const text = readFileSync(new URL('../hil/hil_plant.py', import.meta.url), 'utf8');
  assert.match(text, /# \/\/\/ script\n# requires-python = ">=3\.9"\n# dependencies = \["websockets>=13"\]\n# \/\/\//, 'PEP 723 metadata, for uv run');
  assert.ok(statSync(new URL('../hil/runme.sh', import.meta.url)).mode & 0o100, 'runme.sh is executable');
});

test('hil-plant.zip: the plant with its runme scripts, read back as a zip (by Python when it is here)', (t) => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926, 'the standard CRC-32 check value');
  const names = ['hil_plant.py', 'runme.sh', 'runme.ps1', 'README.txt'];
  const files = names.map((f) => ({ name: `hil-plant/${f}`, data: readFileSync(new URL(`../hil/${f}`, import.meta.url), 'utf8'), mode: f.endsWith('.sh') ? 0o755 : 0o644 }));
  const zip = zipFiles(files, new Date(2026, 9, 24, 12, 0, 0));
  const v = new DataView(zip.buffer);
  assert.equal(v.getUint32(0, true), 0x04034b50, 'starts with a local file header');
  assert.equal(v.getUint16(zip.length - 12, true), 4, 'four files in the directory');
  const path = join(tmpdir(), `hil-plant-${process.pid}.zip`);
  writeFileSync(path, zip);
  let out;
  try {
    out = execFileSync('python3', ['-I', '-c', 'import zipfile,sys,json; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps([[i.filename, oct(i.external_attr >> 16), z.read(i).decode()[:12]] for i in z.infolist()]))', path]).toString();
  } catch (err) {
    if (err.code === 'ENOENT') { t.skip('no python3'); return; }
    throw err;
  } finally { rmSync(path, { force: true }); }
  assert.deepEqual(JSON.parse(out), [
    ['hil-plant/hil_plant.py', '0o100644', '#!/usr/bin/e'],
    ['hil-plant/runme.sh', '0o100755', '#!/bin/sh\n# '],
    ['hil-plant/runme.ps1', '0o100644', "# Loop Tuner"],
    ['hil-plant/README.txt', '0o100644', 'Loop Tuner: '],
  ]);
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
  // The plant the page is not told: within ±15 % of nominal, the same for a
  // seed, a parameter fixed with --set.
  const script = new URL('../hil/hil_plant.py', import.meta.url).pathname;
  const probe = "import importlib.util, sys, types; spec = importlib.util.spec_from_file_location('hp', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); a = types.SimpleNamespace(vary=0.15, seed=7, set=['J=0.003']); p = m.plant_params(a); print(p == m.plant_params(a), p['J'], all(abs(p[n] / getattr(m.Motor, n) - 1) <= 0.15 for n in m.Motor.PHYSICS if n != 'J'), len(set(p.values())) == len(p))";
  assert.equal(execFileSync('python3', ['-I', '-B', '-c', probe, script]).toString().trim(), 'True 0.003 True True');
  assert.throws(() => execFileSync('python3', ['-I', script, '--set', 'X=1', '--describe'], { stdio: 'pipe' }), /--set X=1: one of R, L, k, J, b, Tc, mgl/);
});

// Starts hil_plant.py on a free port: with python3 if it has websockets, else
// with uv from its cache (no network). Resolves { proc, port } or null.
async function startPlant() {
  const script = fileURLToPath(new URL('../hil/hil_plant.py', import.meta.url));
  const port = 20000 + (process.pid % 20000);
  const ways = [['python3', ['-I', script, '--port', String(port)]], ['uv', ['run', '--offline', '--quiet', script, '--port', String(port)]]];
  for (const [cmd, args] of ways) {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const up = await new Promise((resolve) => {
      let text = '';
      const done = (v) => { clearTimeout(timer); resolve(v); };
      const timer = setTimeout(() => done(false), 20000);
      proc.on('error', () => done(false));
      proc.on('exit', () => done(false));
      proc.stdout.on('data', (b) => { text += b; if (/listening on/.test(text)) done(true); });
    });
    if (up) return { proc, port };
    proc.kill();
  }
  return null;
}

test('hil_plant.py speaks the protocol: describe, the y/u cycle, its watchdog, Reset, Stop and Ctrl+C (when it can run here)', async (t) => {
  if (typeof WebSocket !== 'function') { t.skip('no WebSocket in this Node'); return; }
  const plant = await startPlant();
  if (!plant) { t.skip('neither python3 with websockets nor uv with websockets in its cache'); return; }
  const ws = new WebSocket(`ws://127.0.0.1:${plant.port}`);
  const notes = [], waiting = new Map();
  let id = 0, answer = true, closed = null;
  const call = (method, params) => new Promise((resolve) => { const i = ++id; waiting.set(i, resolve); ws.send(rpcRequest(i, method, params)); });
  const until = (pred, ms = 2000) => new Promise((resolve, reject) => {
    const t0 = Date.now();
    const check = () => { const hit = pred(); if (hit) resolve(hit); else if (Date.now() - t0 > ms) reject(new Error('timed out')); else setTimeout(check, 5); };
    check();
  });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id !== undefined && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); return; }
    notes.push(m);
    if (m.method === 'y' && answer) ws.send(uMessage(m.params.seq, [0, 0]));
  };
  ws.onclose = (e) => { closed = e; };
  try {
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    const desc = checkDescription((await call('describe')).result);
    assert.equal(desc.protocol, 'loop-tuner-hil/1');
    assert.deepEqual(desc.outputs.map((p) => p.name), ['angle', 'speed', 'current']);
    assert.equal((await call('start')).result.rate_hz, 100);
    const ys = await until(() => { const y = notes.filter((m) => m.method === 'y'); return y.length >= 30 && y; });
    assert.deepEqual(ys.slice(0, 30).map((m) => m.params.seq), Array.from({ length: 30 }, (_, i) => i), 'seq counts cycles from 0');
    assert.ok(ys.every((m) => Math.abs(m.params.t - m.params.seq / 100) < 1e-9), 't = seq / rate');
    assert.ok(!notes.some((m) => m.method === 'estop'), 'answered: no E-stop');
    // Silence: the plant's watchdog latches after 10 unanswered cycles.
    answer = false;
    const stop = await until(() => notes.find((m) => m.method === 'estop'), 1000);
    assert.match(stop.params.reason, /no u for 10 cycles/);
    assert.equal((await call('start')).error.code, -32000, 'latched: start is refused');
    assert.deepEqual((await call('reset')).result, {});
    answer = true;
    assert.deepEqual((await call('stop')).result, {});
    const n = notes.length;
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(!notes.slice(n).some((m) => m.method === 'y'), 'stopped: no y');
    // Running again, Ctrl+C on the plant: the page hears why, then the close.
    await call('start');
    await until(() => notes.slice(n).some((m) => m.method === 'y'));
    plant.proc.kill('SIGINT');
    const bye = await until(() => notes.find((m) => m.method === 'estop' && /shut down/.test(m.params.reason)), 3000);
    assert.ok(bye);
    await until(() => closed, 3000);
    assert.equal(closed.code, 1001);
  } finally {
    ws.close();
    plant.proc.kill();
  }
});
