// The observer example (design/output/system-library.md): a DC motor's speed
// loop that measures only a quantised, noisy encoder angle, its speed made by
// an Observer block. The raw difference, the Luenberger observer with placed
// poles and the designed Kalman filter, each held to what the notes say; and
// the placed-poles design itself (design.js, placedDesign).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDiagram } from '../src/core/diagram.js';
import { normalizeVariant } from '../src/core/controllers.js';
import { OBSERVERS } from '../src/core/observers.js';
import { createDesignStore } from '../src/core/design.js';
import { eig, c2d } from '../src/core/linalg.js';
import { normalizeProject, evaluateSystem, autoTimebase } from '../src/core/project.js';
import { SYSTEM_LIBRARY, applySystem } from '../src/core/systems.js';
import { DEFAULT_PROJECT } from '../src/core/examples.js';

const NAME = 'DC motor, speed from an encoder';
const entry = SYSTEM_LIBRARY.find((s) => s.name === NAME);
const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
const std = (a) => { const m = a.reduce((s, x) => s + x, 0) / a.length; return rms(a.map((x) => x - m)); };
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

function project(variant) {
  const p = normalizeProject(applySystem(DEFAULT_PROJECT, entry, ['input', 'plant', 'controller']));
  p.scope.timebase = autoTimebase(p);
  p.system.plant.diagram.blocks.find((b) => b.id === 'obs').variant = variant;
  return p;
}
// One run of a variant, with what the notes quote: the estimate's error over
// the run past 0.3 s, V's spread and the speed while r holds 10 rad/s (1 to
// 2.4 s), the estimate's error under the load (3.9 to 4.3 s).
function run(variant) {
  const res = evaluateSystem(project(variant), { designs: createDesignStore() });
  const { t, signals: s } = res;
  const win = (name, a, b) => s[name].filter((_, k) => t[k] >= a && t[k] < b);
  return {
    res, design: res.info.designs[0],
    err: rms(win('est_error', 0.3, 5)), worst: Math.max(...win('est_error', 0.3, 5).map(Math.abs)),
    V: std(win('V', 1, 2.4)), speed: mean(win('speed', 1, 2.4)), load: mean(win('est_error', 3.9, 4.3)),
  };
}
const runs = [0, 1, 2].map(run);
const [diff, placed, kalman] = runs;

test('observer example: it loads and runs whole, at its own record step, on every variant', () => {
  const obs = entry.plant.diagram.blocks.find((b) => b.type === 'observer');
  assert.deepEqual(obs.variants.map((v) => v.type), ['difference', 'luenbergerPlaced', 'kalman']);
  assert.equal(entry.sim.sampleTime, 0.001);
  for (const r of runs) {
    assert.equal(r.res.t.length, 5001);
    for (const [name, v] of Object.entries(r.res.signals)) assert.ok(v.every(Number.isFinite), `${name} finite`);
  }
  assert.equal(diff.design, undefined, 'the difference is a hand observer');
  for (const r of [placed, kalman]) {
    assert.equal(r.design.status, 'ok', r.design.error?.message);
    assert.equal(r.design.seen, 'V → encoder 1024 counts/turn · 3 states (armature 1/(L·s + R), rotor 1/Jm, rotor angle)');
    // x̂2 is the rotor's speed, which the PI is wired to.
    assert.deepEqual(r.design.rows[0].value, ['armature 1/(L·s + R)', 'rotor 1/Jm', 'rotor angle']);
  }
  // R from the encoder's blocks: σ² + q²/12.
  const R = kalman.design.rows.find((row) => row.label === 'R');
  assert.ok(Math.abs(R.value[0] - (0.001 ** 2 + (2 * Math.PI / 1024) ** 2 / 12)) < 1e-15);
  const tags = entry.tags.map((t) => t.label);
  for (const t of ['PID', 'Finite difference', 'Luenberger observer', 'Kalman filter', 'Disturbance']) assert.ok(tags.includes(t), tags.join(', '));
});

test('observer example: the estimates track the true speed; the Kalman filter beats the raw difference by 20 times', () => {
  // Bands over the whole run past 0.3 s, both steps and the load included.
  assert.ok(kalman.worst < 0.3, `Kalman: |estimate − speed| up to ${kalman.worst}`);
  assert.ok(placed.worst < 2, `Luenberger: up to ${placed.worst}`);
  assert.ok(diff.worst > 6, `the difference jumps by a count (6.1 rad/s): up to ${diff.worst}`);
  // The notes' numbers: error rms 3.1, 0.47, 0.056 rad/s; V σ 6.1, 0.96, 0.080 V.
  const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 0.05 * b, `${what}: ${a}, not about ${b}`);
  near(diff.err, 3.1, 'difference error'); near(placed.err, 0.47, 'Luenberger error'); near(kalman.err, 0.056, 'Kalman error');
  near(diff.V, 6.1, 'difference V'); near(placed.V, 0.96, 'Luenberger V'); near(kalman.V, 0.080, 'Kalman V');
  assert.ok(diff.err / kalman.err > 20, `speed error: ${diff.err / kalman.err} times`);
  assert.ok(diff.V / kalman.V > 20, `u noise: ${diff.V / kalman.V} times`);
  assert.ok(diff.V > placed.V && placed.V > kalman.V, 'the Luenberger at 400 1/s lies between');
  // What it does for the loop: the clipped chatter leaves the motor slow.
  assert.ok(Math.abs(diff.speed - 10) > 0.8, `difference: ${diff.speed} rad/s`);
  for (const r of [placed, kalman]) assert.ok(Math.abs(r.speed - 10) < 0.01, `${r.speed} rad/s`);
  // Neither model knows the load: the slow Kalman filter reads high under it, the fast Luenberger hardly.
  assert.ok(kalman.load > 0.08 && kalman.load < 0.13, `Kalman under the load: ${kalman.load}`);
  assert.ok(Math.abs(placed.load) < 0.03, `Luenberger under the load: ${placed.load}`);
});

test('placed poles: the error dies out at s = −w; Copy as numbers runs bit for bit', () => {
  const st = placed.design;
  const v = st.values, n = v.B.length, Ts = 0.001;
  const rowsOf = (flat, c) => Array.from({ length: flat.length / c }, (_, i) => flat.slice(i * c, i * c + c));
  const A = rowsOf(v.A, n), C = [v.C], L = rowsOf(v.L, 1);
  const { Ad } = c2d(A, v.B.map((b) => [b]), Ts);
  const ILC = L.map((row, i) => C[0].map((_, j) => (i === j ? 1 : 0) - row[0] * C[0][j]));
  const M = ILC.map((row) => Ad[0].map((_, j) => row.reduce((s, x, k) => s + x * Ad[k][j], 0)));
  for (const z of eig(M)) assert.ok(Math.hypot(z.re - Math.exp(-400 * Ts), z.im) < 1e-3, `pole ${z.re} ${z.im}`);
  assert.equal(st.rows.find((row) => row.label === 'slowest pole').value, '400 rad/s, ζ 1');
  // The file holds w only; the computed model and L are refused with the Copy sentence.
  assert.throws(() => normalizeVariant({ type: 'luenbergerPlaced', params: { w: [1], L: [1] } }, 'variant', OBSERVERS), /luenbergerPlaced computes A, B, C and L from the plant and w; to set them by hand use Copy as numbers \(a Luenberger observer variant\)/);
  assert.throws(() => normalizeVariant({ type: 'luenbergerPlaced', params: { w: [0] } }, 'variant', OBSERVERS), /w: each above 0/);
  // Copy as numbers: the Luenberger observer, running the same.
  const p = project(1), store = createDesignStore();
  const designed = evaluateSystem(p, { designs: store });
  const o = p.system.plant.diagram.blocks.find((b) => b.id === 'obs');
  o.variants.push(normalizeVariant({ name: 'copy', ...OBSERVERS.luenbergerPlaced.manual(o.variants[1].params, designed.info.designs[0].values) }, 'variant', OBSERVERS));
  o.variant = 3;
  assert.equal(o.variants[3].type, 'luenberger');
  const copied = evaluateSystem(normalizeProject(JSON.parse(JSON.stringify(p))), { designs: store });
  assert.deepEqual(copied.info.designs, []);
  for (const name of Object.keys(designed.signals)) assert.deepEqual(copied.signals[name], designed.signals[name], name);
});

test('placed poles: a scalar plant gives the closed form; refusals in sentences', () => {
  // A lag K/(τs + 1) measured directly: e⁺ = (1 − L) Ad e = z e, so L = 1 − z/Ad.
  const lag = (blocks, wires, w = [50], inputs = 2) => {
    const p = normalizeProject(structuredClone(DEFAULT_PROJECT));
    p.system.signals = { r: { period: 1, components: [{ type: 'step', params: { amplitude: 1, time: 0.1 } }] } };
    p.system.plant = { type: 'diagram', diagram: normalizeDiagram({
      blocks: [
        { id: 'r', type: 'source', params: { signal: 'r' }, x: 0, y: 0 },
        { id: 'ctrl', type: 'controller', name: 'controller', params: { inputs: 2, Ts: 0.01 }, variants: [{ type: 'pid', params: { Kp: 0.5, Ki: 2 } }], x: 100, y: 0 },
        { id: 'obs', type: 'observer', name: 'estimator', params: { inputs, outputs: 1, Ts: 0.01 }, variants: [{ type: 'luenbergerPlaced', params: { w } }], x: 300, y: 100 },
        { id: 'xh', type: 'sink', params: { name: 'xhat' }, x: 400, y: 100 },
        ...blocks,
      ],
      wires: [{ from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'obs' }, { from: 'obs', to: 'xh' }, ...wires],
    }) };
    p.scope.timebase = autoTimebase(p);
    return evaluateSystem(p, { designs: createDesignStore() }).info.designs[0];
  };
  const one = [{ id: 'lag', type: 'firstOrder', name: 'lag', params: { K: 2, tau: 0.5 }, x: 200, y: 0 }];
  const st = lag(one, [{ from: 'ctrl', to: 'lag' }, { from: 'lag', to: 'ctrl:1' }, { from: 'lag', to: 'obs:1' }]);
  assert.equal(st.status, 'ok');
  const Ad = Math.exp(-0.01 / 0.5), z = Math.exp(-50 * 0.01);
  assert.ok(Math.abs(st.values.L[0] - (1 - z / Ad)) < 1e-12, `L ${st.values.L[0]}`);
  assert.deepEqual(st.rows.map((row) => row.label), ['estimates', 'L', 'w', 'slowest pole']);
  // Two measurements: the poles do not fix L.
  const two = lag(one, [{ from: 'ctrl', to: 'lag' }, { from: 'lag', to: 'ctrl:1' }, { from: 'lag', to: 'obs:1' }, { from: 'lag', to: 'obs:2' }], [50], 3);
  assert.equal(two.error.code, 'one-measurement');
  assert.equal(two.error.message, 'placing the poles fixes L for one measurement; this observer has 2 (lag, lag)');
  // Two equal lags side by side, summed: the sum cannot tell them apart.
  const twin = [...one, { id: 'lag2', type: 'firstOrder', name: 'lag2', params: { K: 2, tau: 0.5 }, x: 200, y: 50 }, { id: 'sum', type: 'sum', params: { signs: '++' }, x: 250, y: 0 }, { id: 'y', type: 'sink', params: { name: 'y' }, x: 300, y: 0 }];
  const un = lag(twin, [{ from: 'ctrl', to: 'lag' }, { from: 'ctrl', to: 'lag2' }, { from: 'lag', to: 'sum' }, { from: 'lag2', to: 'sum:1' }, { from: 'sum', to: 'y' }, { from: 'sum', to: 'ctrl:1' }, { from: 'sum', to: 'obs:1' }], [50, 60]);
  assert.equal(un.error.code, 'not-observable');
  assert.equal(un.error.message, 'sum does not show every state of the plant this observer sees (lag, lag2), so no L places all 2 poles');
  const len = lag(one, [{ from: 'ctrl', to: 'lag' }, { from: 'lag', to: 'ctrl:1' }, { from: 'lag', to: 'obs:1' }], [50, 60]);
  assert.equal(len.error.message, 'w has 2 values; the plant this observer sees has 1 state (lag)');
});
