// The designed Kalman observer (designs-in-the-page.md §6.3, test 14): its
// model and gain come from the plant the Observer sees, R from the sensor
// blocks; Copy as numbers gives a Luenberger observer that runs the same; a
// Controller designed on its estimates looks through them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDiagram, compileDiagram } from '../src/core/diagram.js';
import { normalizeVariant } from '../src/core/controllers.js';
import { OBSERVERS } from '../src/core/observers.js';
import { createDesignStore } from '../src/core/design.js';
import { normalizeProject, evaluateSystem, autoTimebase } from '../src/core/project.js';
import { SYSTEM_LIBRARY, applySystem } from '../src/core/systems.js';
import { DEFAULT_PROJECT } from '../src/core/examples.js';

const rel = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${what}: ${a}, not ${b}`);
const same = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

// A lag K/(τs + 1) under a PI, measured through noise and a quantizer; an
// Observer gets the controller's output and the measurement.
// bare: no sensor blocks, the lag measured directly.
function lagProject({ std = 0.05, q = 0.01, Q = [0.5], R = null, outputs = 1, bare = false } = {}) {
  const p = normalizeProject(structuredClone(DEFAULT_PROJECT));
  p.system.signals = { r: { period: 2, components: [{ type: 'step', params: { amplitude: 1, time: 0.2 } }] } };
  p.system.plant = {
    type: 'diagram',
    diagram: normalizeDiagram({
      blocks: [
        { id: 'r', type: 'source', params: { signal: 'r' }, x: 0, y: 0 },
        { id: 'ctrl', type: 'controller', name: 'controller', params: { inputs: 2, Ts: 0.01 }, variants: [{ type: 'pid', params: { Kp: 0.5, Ki: 2 } }], x: 100, y: 0 },
        { id: 'lag', type: 'firstOrder', name: 'lag', params: { K: 2, tau: 0.5 }, x: 200, y: 0 },
        { id: 'noise', type: 'noise', name: 'noise', params: { std, seed: 3 }, x: 300, y: 0 },
        { id: 'quant', type: 'quantizer', name: 'encoder', params: { q }, x: 400, y: 0 },
        { id: 'y', type: 'sink', params: { name: 'y' }, x: 500, y: 0 },
        { id: 'obs', type: 'observer', name: 'estimator', params: { inputs: 2, outputs, Ts: 0.01 }, variants: [{ type: 'kalman', params: { Q, R } }], x: 300, y: 100 },
        { id: 'xh', type: 'sink', params: { name: 'xhat' }, x: 400, y: 100 },
        { id: 'u', type: 'sink', params: { name: 'u' }, x: 200, y: 100 },
      ],
      wires: [
        { from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'lag' }, { from: 'lag', to: 'noise' }, { from: 'noise', to: 'quant' }, { from: 'quant', to: 'y' },
        { from: 'quant', to: 'ctrl:1' }, { from: 'ctrl', to: 'u' }, { from: 'ctrl', to: 'obs' }, { from: 'quant', to: 'obs:1' }, { from: 'obs', to: 'xh' },
      ],
    }),
  };
  if (bare) {
    const d = p.system.plant.diagram;
    d.blocks = d.blocks.filter((b) => b.id !== 'noise' && b.id !== 'quant');
    d.wires = d.wires.filter((w) => !/^(noise|quant)/.test(w.from) && !/^(noise|quant)/.test(w.to)).concat([{ from: 'lag', to: 'y' }, { from: 'lag', to: 'ctrl:1' }, { from: 'lag', to: 'obs:1' }]);
    p.system.plant.diagram = normalizeDiagram(d);
  }
  p.scope.timebase = autoTimebase(p);
  return p;
}
const obsOf = (p) => p.system.plant.diagram.blocks.find((b) => b.id === 'obs');

test('kalman: a scalar plant gives the closed-form steady-state gain; R comes from the sensor blocks', () => {
  const p = lagProject();
  const res = evaluateSystem(p, { designs: createDesignStore() });
  const [st] = res.info.designs;
  assert.deepEqual([st.path, st.type, st.status, st.error], ['obs', 'kalman', 'ok', null]);
  assert.equal(st.seen, 'u → encoder · 1 state (lag)');
  // R = σ² + q²/12 from the noise and the quantizer on the measurement's way.
  const r = 0.05 ** 2 + 0.01 ** 2 / 12;
  const R = st.rows.find((row) => row.label === 'R');
  rel(R.value[0], r, 1e-12, 'R');
  assert.equal(R.note, "from noise 'noise' σ 0.05 and quantizer 'encoder' step 0.01");
  // They are where R comes from, not faults: no note about them.
  assert.ok(!st.warnings.some((w) => /noise|quantizer/.test(w)), st.warnings.join(' | '));
  // ẋ = −x/τ + (K/τ) u, y = x; held over Ts: Ad = e^(−Ts/τ), Bd = K (1 − Ad).
  const Ad = Math.exp(-0.01 / 0.5), Bd = 2 * (1 - Ad), Qw = 0.5 * Bd * Bd;
  // The a-priori covariance solves P = Ad² P r / (P + r) + Qw; L = P / (P + r).
  const b = r * (1 - Ad * Ad) - Qw;
  const P = (-b + Math.sqrt(b * b + 4 * Qw * r)) / 2;
  rel(st.values.L[0], P / (P + r), 1e-9, 'L');
  rel(st.values.A[0], -2, 1e-6, 'A');
  rel(st.values.B[0], 4, 1e-6, 'B');
  assert.deepEqual([st.values.C, st.values.stateIndex], [[1], [0]]);
  assert.deepEqual(st.rows.map((row) => row.label), ['estimates', 'L', 'R', 'Q', 'slowest pole']);
  assert.deepEqual(st.rows[0], { label: 'estimates', value: ['lag'], labels: ['x̂1'] });
  assert.ok(!st.warnings.some((w) => /no sensor block/.test(w)), st.warnings.join(' | '));
  // The estimate follows the lag's output; the measurement is noisy and quantised.
  const k = res.t.length - 1;
  assert.ok(Math.abs(res.signals.xhat[k] - 1) < 0.05, `x̂ ${res.signals.xhat[k]}`);
  // R given: used as given, one value for all.
  const given = evaluateSystem(lagProject({ R: [0.01] }), { designs: createDesignStore() }).info.designs[0];
  assert.deepEqual(given.rows.find((row) => row.label === 'R').value, [0.01]);
  // No sensor block: R = 1, said so.
  const bare = evaluateSystem(lagProject({ bare: true }), { designs: createDesignStore() }).info.designs[0];
  assert.ok(bare.warnings.includes('no sensor block on lag: R = 1'), bare.warnings.join(' | '));
  assert.deepEqual(bare.rows.find((row) => row.label === 'R').value, [1]);
});

test('kalman: inputs only in a file; the Luenberger twin runs bit for bit; refusals in sentences', () => {
  // In a file: Q and R only. A hand model on kalman is refused.
  const p = lagProject();
  const v = obsOf(p).variants[0];
  assert.deepEqual(v.params, { Q: [0.5], R: null });
  assert.deepEqual(normalizeVariant({ type: 'kalman', params: { R: '' } }, 'variant', OBSERVERS).params.R, null);
  assert.throws(() => normalizeVariant({ type: 'kalman', params: { A: [0, 1, 0, 0], B: [0, 1], C: [1, 0] } }, 'variant', OBSERVERS), /variant\.params\.A: kalman computes A, B, C and L from the plant and Q and R; to set them by hand use Copy as numbers \(a Luenberger observer variant\)/);
  assert.throws(() => normalizeVariant({ type: 'kalman', params: { R: [1, 0] } }, 'variant', OBSERVERS), /R: each above 0/);
  assert.ok(!/"(A|B|C|L)"/.test(JSON.stringify(p.system.plant)), 'no model in the file');

  // Copy as numbers: a Luenberger observer with the same A, B, C, L, running the same.
  const store = createDesignStore();
  const designed = evaluateSystem(p, { designs: store });
  const [st] = designed.info.designs;
  const twin = OBSERVERS.kalman.manual(v.params, st.values);
  assert.equal(twin.type, 'luenberger');
  const o = obsOf(p);
  o.variants.push(normalizeVariant({ name: 'Kalman (numbers)', ...twin }, 'variant', OBSERVERS));
  o.variant = 1;
  const copied = evaluateSystem(normalizeProject(JSON.parse(JSON.stringify(p))), { designs: store });
  assert.deepEqual(copied.info.designs, []);
  for (const name of Object.keys(designed.signals)) assert.ok(same(copied.signals[name], designed.signals[name]), name);

  // More estimates than states: the extra ones are 0, and a warning says how many there should be.
  const two = evaluateSystem(lagProject({ outputs: 2 }), { designs: createDesignStore() });
  const [w] = two.info.designs;
  assert.equal(w.status, 'warn');
  assert.ok(w.warnings.includes('the plant seen has 1 state (lag); set Estimates to 1'), w.warnings.join(' | '));
  assert.deepEqual(w.values.stateIndex, [0, -1]);
  assert.deepEqual(w.rows[0].value, ['lag', '0']);
  // Q of the wrong length, and an Observer with nothing on u.
  const q2 = evaluateSystem(lagProject({ Q: [1, 2] }), { designs: createDesignStore() }).info.designs[0];
  assert.equal(q2.error.code, 'q-length');
  assert.match(q2.error.message, /^Q has 2 values; the plant this observer sees has 1 state \(lag\)$/);
  const cut = lagProject();
  cut.system.plant.diagram.wires = cut.system.plant.diagram.wires.filter((wi) => wi.to !== 'obs');
  const nc = evaluateSystem(cut, { designs: createDesignStore() });
  assert.equal(nc.info.designs[0].error.code, 'no-cut');
  assert.ok(nc.signals.xhat.every((x) => x === 0), 'no design: zero estimates');
});

test('kalman look-through: LQR on the estimates designs the same K as on the states, and the loop holds', () => {
  // The cart–pole: the Observer measures x and θ and estimates x, v, θ, ω;
  // the Controller runs LQR on the four estimates (state order).
  const p = normalizeProject(applySystem(DEFAULT_PROJECT, SYSTEM_LIBRARY.find((s) => s.name.startsWith('Pendulum')), ['input', 'plant']));
  p.scope.timebase = autoTimebase(p);
  const d = p.system.plant.diagram;
  const ctrl = d.blocks.find((b) => b.id === 'ctrl');
  const direct = (Q) => {
    ctrl.variants = [normalizeVariant({ name: 'LQR', type: 'lqr', params: { Q, R: 0.1, umin: -25, umax: 25 } })];
    ctrl.variant = 0;
    return compileDiagram(p.system.plant.diagram, 'plant', { standalone: true, designs: createDesignStore() }).designs[0];
  };
  const onStates = direct([10, 50, 1, 1]);   // measurements x, θ, v, ω
  ctrl.variants = [normalizeVariant({ name: 'LQR', type: 'lqr', params: { Q: [10, 1, 50, 1], R: 0.1, umin: -25, umax: 25 } })];
  d.blocks.find((b) => b.id === 'cart').params.theta0 = 0.1;
  d.blocks.push({ id: 'obs', type: 'observer', name: 'estimator', params: { inputs: 3, outputs: 4, Ts: 0.01 }, variants: [{ type: 'kalman', params: { Q: [1] } }], x: 200, y: 300 });
  d.wires = d.wires.filter((w) => !w.to.startsWith('ctrl:'));
  d.wires.push({ from: 'ctrl', to: 'obs' }, { from: 'cart', to: 'obs:1' }, { from: 'cart:1', to: 'obs:2' },
    ...[0, 1, 2, 3].map((j) => ({ from: j ? `obs:${j}` : 'obs', to: `ctrl:${j + 1}` })));
  p.system.plant.diagram = normalizeDiagram(d);
  const res = evaluateSystem(p, { designs: createDesignStore() });
  const [obs, lqr] = res.info.designs;
  assert.deepEqual([obs.path, obs.status, lqr.path, lqr.status], ['obs', 'ok', 'ctrl', 'ok']);
  assert.deepEqual(obs.rows[0].value, ['x', 'v', 'θ', 'ω']);
  assert.equal(lqr.seen, 'F → x̂1, x̂2, x̂3, x̂4 · 4 states (x, v, θ, ω)');
  assert.ok(obs.warnings.includes('no sensor block on x: R = 1'));
  // The same gains, in the estimates' order (x, v, θ, ω) instead of x, θ, v, ω.
  const K = onStates.values.K;
  [K[0], K[2], K[1], K[3]].forEach((k, i) => rel(lqr.values.K[i], k, 1e-9, `K[${i}]`));
  rel(lqr.values.kr, onStates.values.kr, 1e-9, 'kr');
  // From 0.1 rad off upright, the loop on the estimates holds the pole.
  const n = res.t.length - 1;
  assert.ok(Math.abs(res.signals.theta[n]) < 0.05 && Math.abs(res.signals.x[n]) < 0.2, `θ ${res.signals.theta[n]}, x ${res.signals.x[n]}`);
});

test('kalman with two sensors on one state: the filter that runs is the one designed, x̂ = x̂⁻ + L (y − C x̂⁻)', () => {
  // A lag measured twice (R = 1e-4 each). The gain is designed for both
  // measurements at once, so every innovation is taken from the prediction
  // before any correction; one at a time the error ran nine times slower.
  const p = lagProject({ bare: true, R: [1e-4, 1e-4], Q: [0.5] });
  const d = p.system.plant.diagram;
  obsOf(p).params.inputs = 3;
  d.wires.push({ from: 'lag', to: 'obs:2' });
  p.system.plant.diagram = normalizeDiagram(d);
  const [st] = evaluateSystem(p, { designs: createDesignStore() }).info.designs;
  assert.equal(st.status, 'ok', JSON.stringify(st.error));
  const { A, B, C, L } = st.values;
  assert.deepEqual(C, [1, 1]);
  const Ts = 0.01, Ad = Math.exp(A[0] * Ts), Bd = (B[0] / A[0]) * (Ad - 1);
  const law = OBSERVERS.kalman.make(obsOf(p).variants[0].params, Ts, st.values);
  // The first sample corrects the zero estimate with both measurements at once.
  const x0 = law.step([0, 1, 1])[0];
  assert.equal(x0, 0 + (L[0] * (1 - 0) + L[1] * (1 - 0)));
  assert.ok(x0 > 0.9, `one step: ${x0}`);   // one measurement at a time: L1 + L2 − L1 L2, about 0.72
  // Then predict and correct: the error shrinks by (1 − L C) Ad per sample, exactly as designed.
  let x = 1, xh = x0, e = x - xh;
  const factor = (1 - L[0] - L[1]) * Ad;
  for (let k = 0; k < 20; k++) {
    const u = 0.3 * Math.sin(k);
    x = Ad * x + Bd * u;
    const before = law.step([u, x, x])[0];
    xh = Ad * xh + Bd * u;
    xh += L[0] * (x - xh) + L[1] * (x - xh);
    assert.ok(Math.abs(before - xh) <= 1e-12, `sample ${k}: ${before}, designed ${xh}`);
    const en = x - before;
    if (Math.abs(e) > 1e-9) assert.ok(Math.abs(en / e - factor) < 1e-6, `sample ${k}: the error shrinks by ${en / e}, designed ${factor}`);
    e = en;
  }
  assert.ok(factor < 0.1, `the designed factor ${factor}`);
});

test('kalman: Q = 0 on a plant that does not decay by itself is refused, saying why', () => {
  // The cart–pole upright: its falling mode gets no process noise, so the
  // filter would trust its model there for ever.
  const p = normalizeProject(applySystem(DEFAULT_PROJECT, SYSTEM_LIBRARY.find((s) => s.name.startsWith('Pendulum')), ['input', 'plant']));
  const d = p.system.plant.diagram;
  d.blocks.push({ id: 'obs', type: 'observer', name: 'estimator', params: { inputs: 3, outputs: 4, Ts: 0.01 }, variants: [{ type: 'kalman', params: { Q: [0], R: [1e-4] } }], x: 200, y: 300 });
  d.wires.push({ from: 'ctrl', to: 'obs' }, { from: 'cart', to: 'obs:1' }, { from: 'cart:1', to: 'obs:2' });
  p.system.plant.diagram = normalizeDiagram(d);
  const st = compileDiagram(p.system.plant.diagram, 'plant', { standalone: true, designs: createDesignStore() }).designs.find((s) => s.path === 'obs');
  assert.equal(st.error.code, 'not-detectable');
  assert.match(st.error.message, /^the estimate's error would not die out: Q gives no process noise to a mode that does not decay by itself \(\|z\| = 1\.0\d+\), so the filter would trust its model there for ever$/);
  assert.equal(st.error.hint, 'give Q a value above 0');
});
