// Operating points, trim, linearisation and the first-order fit on the plant
// a block sees: design/output/designs.md, tests 3 and 4 of
// designs-in-the-page.md §11.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDiagram, compileDiagram } from '../src/core/diagram.js';
import { EXAMPLE_PLANTS } from '../src/core/plants.js';
import { DesignError, parseOp, opLabel, operatingPoint, trim, linearize, firstOrderFit } from '../src/core/linearize.js';

const system = (name) => normalizeDiagram(structuredClone(EXAMPLE_PLANTS.find((e) => e.name.startsWith(name)).diagram));
const modelOf = (d, id = 'ctrl') => compileDiagram(d, 'plant', { mode: 'model' }).seen(id);
const close = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a}, not ${b}`);
const refusal = (fn, code, pattern) => {
  try { fn(); } catch (e) {
    assert.ok(e instanceof DesignError, `a DesignError, not ${e}`);
    assert.equal(e.code, code, e.message);
    if (pattern) assert.match(e.message, pattern);
    assert.ok(e.hint, 'with a hint');
    return e;
  }
  assert.fail(`expected ${code}`);
};

test('operating points: parsing and labels', () => {
  assert.deepEqual(parseOp('origin'), { kind: 'origin' });
  assert.deepEqual(parseOp(undefined), { kind: 'origin' });
  assert.deepEqual(parseOp('initial'), { kind: 'initial' });
  assert.deepEqual(parseOp({ y: 0.45 }), { kind: 'y', y: [0.45] });
  assert.deepEqual(parseOp({ y: [null, 1] }), { kind: 'y', y: [null, 1] });
  assert.deepEqual(parseOp({ t: 2.1 }), { kind: 't', t: 2.1, u: 0 });
  assert.throws(() => parseOp('upright'), (e) => e.code === 'bad-op');
  assert.throws(() => parseOp({ y: ['a'] }), (e) => e.code === 'bad-op');
  const tank = modelOf(system('Conical'));
  assert.equal(opLabel({ y: [0.45] }, tank), 'h = 0.45 m');
  assert.equal(opLabel({ t: 2.1 }), 't = 2.10 s of the run');
  assert.equal(opLabel('origin'), 'origin (all states 0, u = 0)');
});

test('trim: the tank holds a level; a level beyond the pump is refused with a sentence', () => {
  const tank = modelOf(system('Conical'));
  const { a, g } = system('Conical').blocks.find((b) => b.type === 'conicalTank').params;
  // Test 3: at y = 0.45 the level is 0.45 and the inflow balances the outlet, a √(2g h).
  const op = operatingPoint(tank, { y: [0.45] });
  close(op.x[0], 0.45, 1e-9, 'h');
  close(op.u, a * Math.sqrt(2 * g * 0.45), 1e-9, 'u');
  assert.ok(op.rest && op.drift < 1e-12);
  assert.equal(op.label, 'h = 0.45 m, q = 0.297');
  for (const h of [0.1, 0.25, 0.5, 0.75, 1]) close(trim(tank, [h]).u, a * Math.sqrt(2 * g * h), 1e-9, `u at h = ${h}`);
  const e = refusal(() => trim(tank, [0.98], { umax: 0.3 }), 'u-limit', /holding h = 0\.98 m needs q = 0\.438, above u max 0\.3/);
  assert.match(e.hint, /raise u max/);
  // The start level: the inflow that holds it (the PI's u0, computed, not stored).
  close(operatingPoint(tank, 'initial').u, a * Math.sqrt(2 * g * 0.15), 1e-12, 'u at the start level');

  // A free coordinate stays where it starts: the cart moves to x = 0.3, the
  // pendulum keeps hanging; a pole held tilted is no equilibrium.
  const pend = modelOf(system('Pendulum swing-up'));
  const moved = trim(pend, [0.3]);
  assert.deepEqual(Array.from(moved.x, (v) => Number(v.toFixed(9))), [0.3, 0, Number(Math.PI.toFixed(9)), 0]);
  close(moved.u, 0, 1e-12, 'u');
  refusal(() => trim(pend, [0.3, 0.5]), 'trim-failed', /no equilibrium with x = 0\.3 m, θ = 0\.5 rad/);
  refusal(() => trim(pend, [1, 2, 3, 4, 5]), 'bad-op', /5 levels for 4 measurements \(x, θ, v, ω\)/);
});

test('operating points: origin, initial state and their warnings', () => {
  const pend = modelOf(system('Pendulum swing-up'));
  const up = operatingPoint(pend, 'origin');
  assert.ok(up.rest);
  assert.deepEqual(Array.from(up.x), [0, 0, 0, 0]);
  assert.deepEqual(up.warnings, []);
  const hanging = operatingPoint(pend, 'initial');
  assert.ok(hanging.rest);
  close(hanging.u, 0, 1e-12, 'u');
  assert.equal(hanging.x[2], Math.PI);
  // The encoder example's origin is not at rest: the encoder's error is not 0 at angle 0.
  const enc = operatingPoint(modelOf(system('Encoder')), 'origin');
  assert.ok(!enc.rest);
  assert.match(enc.warnings[0], /^the origin is not at rest: speed from angle moves at/);
  // A saturation outside its limits there is named; a level beyond it has no equilibrium.
  const d = normalizeDiagram({
    blocks: [{ id: 'r', type: 'source', params: { signal: 'r' } }, { id: 'c', type: 'controller', params: { inputs: 2 }, variants: [{ type: 'pid' }] },
      { id: 's', type: 'saturation', name: 'valve', params: { min: 0.5, max: 1 } }, { id: 'p', type: 'firstOrder', name: 'flow', params: { K: 1, tau: 1 } }],
    wires: [{ from: 'r', to: 'c' }, { from: 'c', to: 's' }, { from: 's', to: 'p' }, { from: 'p', to: 'c:1' }],
  });
  const valve = modelOf(d, 'c');
  assert.ok(operatingPoint(valve, 'origin').warnings.some((w) => /'valve' is saturated at the operating point \(input 0, limits 0\.5 to 1\)/.test(w)));
  refusal(() => trim(valve, [2]), 'trim-failed', /no equilibrium with flow = 2/);
});

test('linearize and the first-order fit: exact on a lag; mean residence time on the motor; integrators refused', () => {
  const block = (id, type, params = {}, extra = {}) => ({ id, type, params, ...extra });
  const wire = (from, to) => ({ from, to });
  // Test 4: a first-order block's K and τ come out exactly.
  const lag = normalizeDiagram({
    blocks: [block('r', 'source', { signal: 'r' }), block('c', 'controller', { inputs: 2 }, { variants: [{ type: 'pid' }] }), block('p', 'firstOrder', { K: 2.5, tau: 0.7 }, { name: 'lag' })],
    wires: [wire('r', 'c'), wire('c', 'p'), wire('p', 'c:1')],
  });
  const lin = linearize(modelOf(lag, 'c'));
  assert.deepEqual(lin.D, [[0]]);
  assert.deepEqual(lin.C, [[1]]);
  const fit = firstOrderFit(lin);
  close(fit.K, 2.5, 1e-9, 'K');
  close(fit.tau, 0.7, 1e-9, 'τ');
  assert.equal(fit.theta, 0);

  // The motor's speed: two lags in a loop, K = 5 / 3.5 and τ = C A⁻² B / K =
  // (τa + τm) / 3.5 (from G(s) = 5 / ((τa s + 1)(τm s + 1) + 2.5)).
  const motor = system('DC motor');
  motor.wires = motor.wires.map((w) => (w.to === 'ctrl:1' ? wire('motor', 'ctrl:1') : w));
  const speed = linearize(modelOf(normalizeDiagram(motor)));
  assert.deepEqual(speed.states.map((s) => s.label), ['Motor/armature', 'Motor/load']);
  const sf = firstOrderFit(speed);
  close(sf.K, 5 / 3.5, 1e-9, 'K');
  close(sf.tau, 0.21 / 3.5, 1e-9, 'τ');

  // The tank's fit carries the pipe's dead time.
  assert.equal(firstOrderFit(linearize(modelOf(system('Conical')), { y: [0.45] })).theta, 0.1);

  // The motor's angle integrates: no static gain, so no pole cancellation.
  refusal(() => firstOrderFit(linearize(modelOf(system('DC motor')))), 'integrating-plant', /angle integrates V/);

  // The cart–pole at the origin: C picks the states (x, θ, v, ω from x, v, θ, ω), D = 0.
  const cp = linearize(modelOf(system('Pendulum swing-up')));
  assert.deepEqual(cp.C, [[1, 0, 0, 0], [0, 0, 1, 0], [0, 1, 0, 0], [0, 0, 0, 1]]);
  assert.deepEqual(cp.D, [[0], [0], [0], [0]]);
  assert.equal(cp.op.label, 'origin (all states 0, u = 0)');
  assert.deepEqual(cp.outputs.map((o) => o.unit), ['m', 'rad', 'm/s', 'rad/s']);
});
