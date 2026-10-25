// Live (HIL), second round: the two modes (control: the page sends u, with r
// and e for the plant's log; reference: the plant runs its own controller), a
// plant with no inputs (logging), full scales, the ramp-in before every loop,
// the plant's own Run/Stop, an E-stop that ends the run, and nothing that
// starts by itself. See design/output/hil.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uMessage, startParams, parseMessage, checkDescription, externalParams, sameDescription, fullScales, fullScaleChannel, blockMode, modeOf, EXTERNAL_BLOCK, HIL_URL, RAMP_DEFAULT } from '../src/core/hil.js';
import { createRampIn, fallbackScale } from '../src/core/ramp.js';
import { createLiveRunner, createLiveLoop } from '../src/core/live.js';
import { normalizeDiagram, compileDiagram } from '../src/core/diagram.js';
import { normalizeReference, referenceFn } from '../src/core/signals.js';

const CONTROL = {
  protocol: 'loop-tuner-hil/1', name: 'motor', rate_hz: 100, watchdog_cycles: 10,
  inputs: [{ name: 'V', unit: 'V', min: -12, max: 12, safe: 0 }, { name: 'load', unit: 'N·m', min: -0.2, max: 0.2, safe: 0, kind: 'disturbance' }],
  outputs: [{ name: 'angle', unit: 'rad', min: -3.2, max: 3.2 }, { name: 'speed', unit: 'rad/s', min: -150, max: 150 }],
};
const REFERENCE = {
  ...CONTROL, mode: 'reference',
  inputs: [{ name: 'r', unit: 'rad', min: -2.5, max: 2.5, safe: 0, measures: 'angle' }, { name: 'load', unit: 'N·m', min: -0.2, max: 0.2, safe: 0, kind: 'disturbance' }],
  outputs: [...CONTROL.outputs, { name: 'V', unit: 'V', min: -12, max: 12, kind: 'effort' }],
};
const LOGGER = { ...CONTROL, inputs: [], outputs: [{ name: 'T', unit: '°C', min: 0, max: 100 }] };

test('describe: input kinds make the mode; outputs carry their full scale; a plant may take no inputs', () => {
  const c = checkDescription(CONTROL);
  assert.equal(c.mode, 'control');
  assert.deepEqual(c.inputs.map((p) => p.kind), ['effort', 'disturbance']);
  assert.deepEqual([c.outputs[0].min, c.outputs[0].max], [-3.2, 3.2]);
  const r = checkDescription(REFERENCE);
  assert.equal(r.mode, 'reference');
  assert.deepEqual(r.inputs.map((p) => [p.kind, p.measures]), [['reference', 'angle'], ['disturbance', '']]);
  assert.equal(r.outputs[2].kind, 'effort', 'the plant reports its own u');
  const l = checkDescription(LOGGER);
  assert.equal(l.mode, 'log');
  assert.deepEqual(l.inputs, []);
  assert.equal(checkDescription({ ...CONTROL, outputs: [{ name: 'y' }] }).outputs[0].min, null, 'a full scale is optional');
  assert.throws(() => checkDescription({ ...CONTROL, outputs: [{ name: 'y', min: 1, max: 1 }] }), /min < max/);
  assert.throws(() => checkDescription({ ...REFERENCE, inputs: [{ ...REFERENCE.inputs[0], measures: 'nope' }] }), /measures: "nope" is not an output/);
  assert.throws(() => checkDescription({ ...CONTROL, inputs: [{ ...CONTROL.inputs[0], kind: 'wish' }] }), /kind: one of effort, reference, disturbance/);
  assert.equal(modeOf([]), 'log');
});

test('the External block keeps the plant\'s kinds and full scales, and its own ramp-in and full scales across a reconnect', () => {
  const p = externalParams(checkDescription(REFERENCE));
  assert.deepEqual(p.kinds, ['reference', 'disturbance']);
  assert.deepEqual(p.measures, ['angle', '']);
  assert.deepEqual([p.outMin, p.outMax], [[-3.2, -150, -12], [3.2, 150, 12]]);
  assert.equal(p.ramp, RAMP_DEFAULT);
  assert.equal(blockMode(p), 'reference');
  const mine = { ...p, url: 'ws://127.0.0.1:9000', ramp: 5, scales: { r: [-1, 1] } };
  const again = externalParams(checkDescription(REFERENCE), mine);
  assert.deepEqual([again.url, again.ramp, again.scales], ['ws://127.0.0.1:9000', 5, { r: [-1, 1] }]);
  assert.ok(sameDescription(mine, checkDescription(REFERENCE)), 'the page\'s own settings are not the plant\'s ports');
  // Typed in the Plant tab: empty places in a list stay empty.
  const typed = EXTERNAL_BLOCK.normalize({ inputs: 'V', outputs: 'a, b', outMin: '-1, ', outMax: '1, ', kinds: 'effort', measures: '' });
  assert.deepEqual([typed.outMin, typed.outMax], [[-1, null], [1, null]]);
  assert.throws(() => EXTERNAL_BLOCK.normalize({ ramp: 0 }), /ramp/);
  assert.throws(() => EXTERNAL_BLOCK.normalize({ scales: { r: [1, 0] } }), /scales\.r/);
  const none = EXTERNAL_BLOCK.normalize({ inputs: [], outputs: ['T'] });
  assert.deepEqual(none.inputs, []);
  assert.equal(blockMode(none), 'log');
  assert.equal(EXTERNAL_BLOCK.ports(none)[0], 0);
});

test('protocol: u carries the plant\'s log, start declares it, the plant says when it runs or stops by itself', () => {
  assert.deepEqual(JSON.parse(uMessage(3, [1.5], [0.25, -0.125])).params, { seq: 3, u: [1.5], log: [0.25, -0.125] });
  assert.deepEqual(JSON.parse(uMessage(3, [], [])).params, { seq: 3, u: [] }, 'a plant without inputs gets an empty u');
  assert.deepEqual(startParams([{ name: 'r', unit: 'rad', probe: 'ctrl.r' }]), { log: [{ name: 'r', unit: 'rad' }] });
  assert.equal(startParams([]), undefined);
  assert.deepEqual(parseMessage('{"jsonrpc":"2.0","method":"running","params":{"running":false,"by":"plant","reason":"stop pressed at the plant"}}'), { kind: 'running', running: false, by: 'plant', reason: 'stop pressed at the plant' });
  assert.equal(parseMessage('{"jsonrpc":"2.0","method":"running","params":{}}').kind, 'invalid');
});

// ---- The ramp-in (core/ramp.js)
const wave = (components, period) => referenceFn(normalizeReference({ period, components }), { sampleTime: 0.01 });

test('the ramp-in: to the first value at no more than the rate, then the loop starts there', () => {
  // r starts at 1.5 (a DC level); the plant is at 0; full scale 2π, 10 %/s.
  const fn = wave([{ type: 'dc', params: { level: 1.5 } }], 5);
  const fs = 2 * Math.PI, rate = 0.1;
  const ramp = createRampIn({ refs: [{ name: 'r', fn, fs }], period: 5, rate });
  ramp.start(0, { r: 0 });
  const dt = 0.01;
  let last = ramp.value('r', 0), t = 0, loopAt = null;
  assert.equal(last, 0, 'it starts where the plant is');
  while (t < 5) {
    t = Number((t + dt).toFixed(10));
    ramp.advance(t);
    const v = ramp.value('r', t);
    assert.ok(Math.abs(v - last) <= rate * fs * dt * (1 + 1e-9), `t ${t}: a step of ${v - last}`);
    const st = ramp.state();
    if (st.phase === 'loop' && loopAt === null) { loopAt = t; assert.equal(v, 1.5, 'the loop starts at its first value'); assert.equal(st.tau, 0); }
    if (st.phase === 'ramp') { assert.equal(st.runT, null, 'the loop\'s time has not started'); assert.ok(st.first); assert.ok(st.left > 0); }
    last = v;
  }
  const expected = 1.5 / (rate * fs);
  assert.ok(Math.abs(loopAt - Math.ceil(expected / dt) * dt) < 1e-9, `the loop starts when r arrives: ${loopAt} s vs ${expected} s`);
  assert.ok(Math.abs(ramp.state().runT - (t - loopAt)) < 1e-9);
});

test('a waveform that ends away from its start never steps between loops; one that ends where it starts goes on', () => {
  // A ramp 0 → 1 over the period: it ends at 1, the next loop starts at 0.
  const saw = wave([{ type: 'ramp', params: { amplitude: 1, time: 0, rise: 2 } }], 2);
  const fs = 1, rate = 0.1, dt = 0.01;
  const ramp = createRampIn({ refs: [{ name: 'r', fn: saw, fs }], period: 2, rate });
  ramp.start(0, { r: 0 });
  let last = 0, t = 0, ramps = 0, wasRamp = false, inLoopMax = 0;
  for (let k = 1; k <= 3000; k++) {
    t = k * dt;
    ramp.advance(t);
    const v = ramp.value('r', t), st = ramp.state();
    const step = Math.abs(v - last);
    if (st.phase === 'ramp') { assert.ok(step <= rate * fs * dt * (1 + 1e-9), `t ${t}: ${step} in a ramp`); if (!wasRamp) ramps++; }
    else inLoopMax = Math.max(inLoopMax, step);
    wasRamp = st.phase === 'ramp';
    last = v;
  }
  assert.ok(ramps >= 2, `ramps between loops: ${ramps}`);
  assert.ok(inLoopMax <= 0.5 * dt + 1e-9, 'within a loop the waveform plays as it is (slope 0.5/s)');
  // A sine of whole periods ends where it starts: no ramp, the loop time runs on.
  const sine = wave([{ type: 'sine', params: { amplitude: 1, frequency: 1 } }], 2);
  const s = createRampIn({ refs: [{ name: 'r', fn: sine, fs: 2 }], period: 2, rate });
  s.start(0, { r: 0 });
  for (let k = 1; k <= 1000; k++) { s.advance(k * dt); assert.equal(s.state().phase, 'loop'); }
  assert.equal(s.state().loop, 4, 'four loops of 2 s in 10 s');
  assert.ok(Math.abs(s.state().runT - 10) < 1e-9);
});

test('the ramp-in: an eased circle eases once and its loops follow on, as the page plays it', () => {
  // The PUMA's circle (0.4 Hz in 5 s, eased over 0.5 s): it ends a period
  // where its steady phase starts the next, not where its first, eased
  // period starts. Before, each loop played the first period again: the
  // loop ended away from fn(0), a ramp of about 3 s went back to the start
  // point and the circle eased in again, in every loop.
  const sine = (phase) => ({ type: 'sine', params: { amplitude: 0.15, frequency: 0.4, phase, ease: 0.5 } });
  const a = wave([sine(90), { type: 'dc', params: { level: -0.15 } }], 5), b = wave([sine(0)], 5);
  const ramp = createRampIn({ refs: [{ name: 'a', fn: a, fs: 0.3 }, { name: 'b', fn: b, fs: 0.3 }], period: 5, rate: 0.1 });
  ramp.start(0, { a: 0, b: 0 });
  const dt = 0.01;
  let lastA = ramp.value('a', 0), lastB = ramp.value('b', 0);
  for (let k = 1; k <= 2000; k++) {
    const t = k * dt;
    ramp.advance(t);
    assert.equal(ramp.state().phase, 'loop', `t ${t}: no ramp between loops`);
    // It plays the waveform in the run's own time, as the page does.
    const va = ramp.value('a', t), vb = ramp.value('b', t);
    assert.ok(Math.abs(va - a(t)) < 1e-12 && Math.abs(vb - b(t)) < 1e-12, `t ${t}: ${va}, ${vb} against ${a(t)}, ${b(t)}`);
    // No step anywhere: at most the circle's speed (0.38 m/s) a step.
    assert.ok(Math.hypot(va - lastA, vb - lastB) <= 0.15 * 2 * Math.PI * 0.4 * dt * 1.001, `t ${t}: a step of ${Math.hypot(va - lastA, vb - lastB)}`);
    lastA = va; lastB = vb;
  }
  assert.equal(ramp.state().loop, 3, 'four loops in 20 s, the first counted 0');
  // A waveform that ends away from its start still ramps, and starts again
  // from its first period after the ramp.
  const saw = wave([{ type: 'ramp', params: { amplitude: 1, time: 0, rise: 2 } }], 2);
  const s = createRampIn({ refs: [{ name: 'r', fn: saw, fs: 1 }], period: 2, rate: 0.5 });
  s.start(0, { r: 0 });
  let t = 0;
  while (s.state().loop < 1 || s.state().phase !== 'loop') { t += dt; s.advance(t); }
  assert.ok(Math.abs(s.value('r', t + 0.5) - 0.25) < 1e-9, 'the second loop plays the waveform from its start');
});

test('the ramp-in: several references each at its own rate; the loop waits for the last', () => {
  const a = wave([{ type: 'dc', params: { level: 1 } }], 5), b = wave([{ type: 'dc', params: { level: 10 } }], 5);
  const ramp = createRampIn({ refs: [{ name: 'a', fn: a, fs: 1 }, { name: 'b', fn: b, fs: 100 }], period: 5, rate: 0.1 });
  ramp.start(0, { a: 0, b: 0 });
  // a needs 10 s at 0.1/s, b 1 s at 10/s.
  ramp.advance(2);
  assert.equal(ramp.value('b', 2), 10, 'b has arrived and waits');
  assert.ok(Math.abs(ramp.value('a', 2) - 0.2) < 1e-12);
  assert.ok(Math.abs(ramp.state().left - 8) < 1e-9);
  ramp.advance(10);
  assert.equal(ramp.state().phase, 'loop');
  // Without a full scale, the waveform's own span (or its size) stands in.
  assert.equal(fallbackScale(wave([{ type: 'square', params: { amplitude: 2, time: 0, width: 1, period: 2 } }], 2), 2), 2);
  assert.equal(fallbackScale(() => 0, 2), 1);
});

// ---- The runner in both modes
const SIG = (r, d = []) => ({
  r: normalizeReference({ period: 5, components: r }),
  d: normalizeReference({ period: 5, components: d }),
});
const controlLoop = () => normalizeDiagram({
  blocks: [
    { id: 'r', type: 'source', params: { signal: 'r', unit: 'rad' } },
    { id: 'd', type: 'source', params: { signal: 'd' } },
    { id: 'ctrl', type: 'controller', params: { inputs: 2, Ts: 0.01 }, variants: [{ name: 'P', type: 'pid', params: { Kp: 4, umin: -12, umax: 12 } }], variant: 0 },
    { id: 'm', type: 'external', params: externalParams(checkDescription(CONTROL)) },
    { id: 'angle', type: 'sink', params: { name: 'angle' } }, { id: 'V', type: 'sink', params: { name: 'V' } },
  ],
  wires: [{ from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'm' }, { from: 'd', to: 'm:1' }, { from: 'm', to: 'ctrl:1' }, { from: 'm', to: 'angle' }, { from: 'ctrl', to: 'V' }],
});
const referenceLoop = () => normalizeDiagram({
  blocks: [
    { id: 'r', type: 'source', params: { signal: 'r', unit: 'rad' } },
    { id: 'd', type: 'source', params: { signal: 'd' } },
    { id: 'm', type: 'external', params: externalParams(checkDescription(REFERENCE)) },
    { id: 'angle', type: 'sink', params: { name: 'angle' } }, { id: 'V', type: 'sink', params: { name: 'V' } },
  ],
  wires: [{ from: 'r', to: 'm' }, { from: 'd', to: 'm:1' }, { from: 'm', to: 'angle' }, { from: 'm:2', to: 'V' }],
});

test('who feeds what, and the full scales that follow from it', () => {
  const el = compileDiagram(controlLoop(), 'plant', { standalone: true, sources: { r: () => 0, d: () => 0 } });
  const links = el.links();
  assert.deepEqual(links.sources, { d: { input: 1 }, r: { ctrl: 'ctrl', measured: 0 } });
  assert.deepEqual(links.sinks, { angle: { output: 0 }, V: { input: 0 } });
  const p = externalParams(checkDescription(CONTROL));
  assert.deepEqual(fullScales(p, links), { angle: [-3.2, 3.2], V: [-12, 12], d: [-0.2, 0.2], r: [-3.2, 3.2] });
  assert.deepEqual(fullScales({ ...p, scales: { r: [-1, 1] } }, links).r, [-1, 1], 'a full scale set in the page wins');
  const ref = compileDiagram(referenceLoop(), 'plant', { standalone: true, sources: { r: () => 0, d: () => 0 } }).links();
  assert.deepEqual(fullScales(externalParams(checkDescription(REFERENCE)), ref), { angle: [-3.2, 3.2], V: [-12, 12], r: [-3.2, 3.2], d: [-0.2, 0.2] }, 'a reference input that measures angle has angle\'s full scale');
  assert.deepEqual(fullScaleChannel([-3.2, 3.2]), { scale: 0.8, offset: 0 });
  assert.deepEqual(fullScaleChannel([0, 100]), { scale: 12.5, offset: -50 });
});

test('control mode: the page sends u, and r and e go along for the plant\'s log', () => {
  const runner = createLiveRunner(controlLoop(), SIG([{ type: 'step', params: { amplitude: 1, time: 0.05 } }]));
  assert.deepEqual(runner.log, [{ name: 'r', unit: 'rad' }, { name: 'e', unit: 'rad' }]);
  runner.step(0, [0, 0]);
  const out = runner.step(0.1, [0.25, 0]);
  assert.deepEqual(out.log, [1, 0.75]);
  assert.equal(out.u[0], 4 * 0.75, 'u is the controller\'s');
});

test('reference mode: the page sends the references; nothing is logged beside them; the plant\'s own u is a signal', () => {
  const runner = createLiveRunner(referenceLoop(), SIG([{ type: 'step', params: { amplitude: 1, time: 0.05 } }]));
  assert.deepEqual(runner.log, []);
  assert.deepEqual(runner.names(), ['r', 'd', 'angle', 'V']);
  runner.step(0, [0, 0, 0]);
  const out = runner.step(0.1, [0.2, 0, 3]);
  assert.deepEqual(out.u, [1, 0], 'r and the load go to the plant');
  assert.deepEqual(out.values, [1, 0, 0.2, 3]);
});

test('the runner ramps in from where the plant is: a reference on a Controller from its measurement, a reference input from what it measures', () => {
  // r starts at 1 rad; the arm hangs at 0.5 rad; full scale 6.4 rad, 10 %/s:
  // the reference moves 0.64 rad/s, so 0.5 rad take 0.78 s (79 cycles).
  for (const [diagram, y] of [[controlLoop(), [0.5, 0]], [referenceLoop(), [0.5, 0, 0]]]) {
    const runner = createLiveRunner(diagram, SIG([{ type: 'dc', params: { level: 1 } }]));
    const first = runner.step(0, y);
    assert.equal(first.values[0], 0.5, 'r starts where the arm is');
    let k = 0, last = 0.5, out;
    do { k++; out = runner.step(k * 0.01, y); assert.ok(out.values[0] - last <= 0.0064 + 1e-12); last = out.values[0]; } while (out.ramp.phase === 'ramp' && k < 1000);
    assert.equal(k, 79);
    assert.equal(out.values[0], 1);
    assert.equal(out.ramp.tau, 0, 'the loop\'s time starts when r has arrived');
  }
});

test('a plant with no inputs (logging): each y is answered with an empty u', () => {
  const d = normalizeDiagram({ blocks: [{ id: 'p', type: 'external', params: externalParams(checkDescription(LOGGER)) }, { id: 'T', type: 'sink', params: { name: 'T' } }], wires: [{ from: 'p', to: 'T' }] });
  const runner = createLiveRunner(d, {});
  const out = runner.step(0, [21.5]);
  assert.deepEqual(out.u, []);
  assert.deepEqual(out.values, [21.5]);
});

// ---- The loop against a fake plant
function fakeLoop(desc) {
  let clock = 0, sock = null;
  const sent = [], out = [];
  class FakeSocket {
    constructor() { this.readyState = 1; sock = this; setTimeout(() => this.onopen?.(), 0); }
    send(text) {
      const m = JSON.parse(text);
      sent.push(m);
      if (m.id === undefined) return;
      const result = m.method === 'describe' ? desc : m.method === 'start' ? { rate_hz: 100 } : {};
      setTimeout(() => this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) }), 0);
    }
    close() { this.readyState = 3; this.onclose?.({ code: 1000, reason: '' }); }
  }
  const env = { WebSocket: FakeSocket, performance: { now: () => clock }, setInterval: () => 1, clearInterval: () => {}, setTimeout };
  const loop = createLiveLoop((m) => out.push(m), env);
  const tick = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
  const from = (method, params) => sock.onmessage({ data: JSON.stringify({ jsonrpc: '2.0', method, params }) });
  const y = (seq, vals) => { clock = seq * 10; from('y', { seq, t: seq / 100, y: vals }); };
  return { loop, sent, out, tick, from, y, us: () => sent.filter((m) => m.method === 'u') };
}

test('the loop: Connect starts nothing; start declares the log; the plant\'s Stop and Run are followed; an E-stop ends the run', async () => {
  const f = fakeLoop({ ...CONTROL, running: false });
  f.loop.handle({ type: 'connect', url: HIL_URL });
  await f.tick();
  f.loop.handle({ type: 'program', diagram: controlLoop(), signals: SIG([]) });
  await f.tick();
  assert.ok(!f.sent.some((m) => m.method === 'start'), 'Connect only reads the description');
  f.y(0, [0, 0]);
  assert.equal(f.us().length, 0, 'not running: no u');
  f.loop.handle({ type: 'start' });
  await f.tick();
  assert.deepEqual(f.sent.find((m) => m.method === 'start').params, { log: [{ name: 'r', unit: 'rad' }, { name: 'e', unit: 'rad' }] });
  f.y(0, [0.1, 0]);
  assert.deepEqual(f.us().at(-1).params, { seq: 0, u: [0, 0], log: [0.1, 0] }, 'r starts where the arm is (0.1 rad) and ramps in: no kick');
  // The plant's own Stop: the page stops answering and says so.
  f.from('running', { running: false, by: 'plant', reason: 'stop pressed at the plant' });
  assert.ok(f.out.some((m) => m.type === 'stopped' && m.reason === 'stop pressed at the plant'));
  f.y(1, [0.1, 0]);
  assert.equal(f.us().length, 1);
  // The plant's own Run: a fresh run on the page too.
  const runs = f.out.filter((m) => m.type === 'run').length;
  f.from('running', { running: true, by: 'plant' });
  assert.equal(f.out.filter((m) => m.type === 'run').length, runs + 1);
  assert.equal(f.out.filter((m) => m.type === 'run').at(-1).by, 'plant');
  f.y(0, [0, 0]);
  assert.equal(f.us().length, 2);
  // An E-stop from the plant: latched, the run is over, Run is refused until Reset.
  f.from('estop', { reason: 'stop pressed at the plant', t: 1 });
  f.y(1, [0, 0]);
  assert.equal(f.us().length, 2, 'no u after an E-stop');
  const starts = f.sent.filter((m) => m.method === 'start').length;
  f.loop.handle({ type: 'start' });
  await f.tick();
  assert.equal(f.sent.filter((m) => m.method === 'start').length, starts, 'Run is refused while latched');
  assert.ok(f.out.some((m) => m.type === 'refused' && /Reset first/.test(m.message)));
  f.loop.handle({ type: 'reset' });
  await f.tick();
  assert.equal(f.sent.filter((m) => m.method === 'start').length, starts, 'Reset starts nothing');
  f.loop.handle({ type: 'start' });
  await f.tick();
  assert.equal(f.sent.filter((m) => m.method === 'start').length, starts + 1, 'Run after Reset');
});

test('the loop: a plant left running by a page that went away is stopped on Connect', async () => {
  const f = fakeLoop({ ...CONTROL, running: true });
  f.loop.handle({ type: 'connect', url: HIL_URL });
  await f.tick(5);
  assert.ok(f.sent.some((m) => m.method === 'stop'));
  assert.ok(!f.sent.some((m) => m.method === 'start'));
});

test('the loop: samples carry the run\'s time and the ramp-in\'s state', async () => {
  const f = fakeLoop({ ...CONTROL, running: false });
  f.loop.handle({ type: 'connect', url: HIL_URL });
  await f.tick();
  f.loop.handle({ type: 'program', diagram: controlLoop(), signals: SIG([{ type: 'dc', params: { level: 1 } }]) });
  f.loop.handle({ type: 'start' });
  await f.tick();
  for (let s = 0; s < 120; s++) f.y(s, [0, 0]);
  f.loop.handle({ type: 'stop' });
  await f.tick();
  const batches = f.out.filter((m) => m.type === 'samples');
  const rt = batches.flatMap((b) => b.rt);
  // 1 rad at 0.64 rad/s: 157 cycles; the run's time has not started in 120.
  assert.ok(rt.every((x) => Number.isNaN(x)));
  assert.ok(batches.at(-1).ramp.first);
  assert.ok(Math.abs(batches.at(-1).ramp.left - (1 - 1.19 * 0.64) / 0.64) < 0.02);
});
