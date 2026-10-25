// Operating points, trim, linearisation and the first-order fit on the plant
// a block sees: design/output/designs.md, tests 3 and 4 of
// designs-in-the-page.md §11.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDiagram, compileDiagram } from '../src/core/diagram.js';
import { EXAMPLE_PLANTS } from '../src/core/plants.js';
import { DesignError, parseOp, opLabel, operatingPoint, trim, linearize, firstOrderFit } from '../src/core/linearize.js';
import { lqrDesign, kalmanDesign, createDesignStore } from '../src/core/design.js';

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
  assert.match(enc.warnings[0], /^the origin is not at rest: Motor\/speed from angle moves at/);
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

  // The motor's speed: armature and rotor in a loop, K = 5 / 3.5 and
  // τ = C A⁻² B / K = 0.21 / 3.5 (from G(s) = Kt / ((Ls + R)(Js + b) + Kt Ke)
  // = 0.5 / ((0.01 s + 1)(0.02 s + 0.1) + 0.25)).
  const motor = system('DC motor');
  motor.wires = motor.wires.map((w) => (w.to === 'ctrl:1' ? wire('motor:3', 'ctrl:1') : w));
  const speed = linearize(modelOf(normalizeDiagram(motor)));
  assert.deepEqual(speed.states.map((s) => s.label), ['Motor/armature 1/(L·s + R)', 'Motor/rotor 1/Jm']);
  const sf = firstOrderFit(speed);
  close(sf.K, 5 / 3.5, 1e-9, 'K');
  close(sf.tau, 0.21 / 3.5, 1e-9, 'τ');

  // The tank's fit carries the pipe's dead time.
  assert.equal(firstOrderFit(linearize(modelOf(system('Conical')), { y: [0.45] })).theta, 0.1);

  // The motor's angle integrates: no static gain, so no pole cancellation.
  refusal(() => firstOrderFit(linearize(modelOf(system('DC motor')))), 'integrating-plant', /θ measured \(Motor\) integrates V/);

  // The cart–pole at the origin: C picks the states (x, θ, v, ω from x, v, θ, ω), D = 0.
  const cp = linearize(modelOf(system('Pendulum swing-up')));
  assert.deepEqual(cp.C, [[1, 0, 0, 0], [0, 0, 1, 0], [0, 1, 0, 0], [0, 0, 0, 1]]);
  assert.deepEqual(cp.D, [[0], [0], [0], [0]]);
  assert.equal(cp.op.label, 'origin (all states 0, u = 0)');
  assert.deepEqual(cp.outputs.map((o) => o.unit), ['m', 'rad', 'm/s', 'rad/s']);
});

// A library system's diagram, editable before it is normalised.
const raw = (name) => structuredClone(EXAMPLE_PLANTS.find((e) => e.name.startsWith(name)).diagram);

test('kinks: a saturation at its limit, one narrower than the step and the empty tank are named; LQR and the Kalman filter refuse them', () => {
  // A one-way actuator, 0 to 25 N, between the controller and the cart–pole:
  // at u = 0 it is at its limit, and the slope differs left and right.
  const oneWay = (lo, hi) => {
    const d = raw('Pendulum swing-up');
    d.blocks.push({ id: 'amp', type: 'saturation', name: 'amp', params: { min: lo, max: hi }, x: 0, y: 0 });
    d.wires = d.wires.map((w) => (w.from === 'ctrl' && w.to === 'sum' ? { from: 'amp', to: 'sum' } : w)).concat([{ from: 'ctrl', to: 'amp' }]);
    return linearize(modelOf(normalizeDiagram(d)));
  };
  const lin = oneWay(0, 25);
  assert.match(lin.kinks[0], /^'amp' is at its limit at the operating point \(input 0, limits 0 to 25\): the slope differs left and right$/);
  assert.ok(lin.kinks.some((k) => /^the slope of the rate of cart and pole\.v along F differs left and right/.test(k)), lin.kinks.join(' | '));
  refusal(() => lqrDesign(lin, { Q: [10, 50, 1, 1], R: 0.1, Ts: 0.01 }), 'kink', /^LQR needs slopes, and the plant has a kink at origin \(all states 0, u = 0\): 'amp' is at its limit/);
  // Narrower than the difference step: one-sided slopes agree (both a tenth), the limit check does not.
  refusal(() => lqrDesign(oneWay(-1e-7, 1e-7), { Q: [10, 50, 1, 1], R: 0.1, Ts: 0.01 }), 'kink', /'amp' is at its limit/);
  // Well inside its limits the saturation is a wire: no kink, the library's gains.
  const inside = oneWay(-25, 25);
  assert.deepEqual(inside.kinks, []);
  assert.ok(Math.abs(lqrDesign(inside, { Q: [10, 50, 1, 1], R: 0.1, Ts: 0.01 }).K[1] + 63.18) < 0.01);

  // The tank at h = 0: √h has no slope there, and the pump cannot run backwards.
  const tank = linearize(modelOf(system('Conical')), 'origin');
  assert.ok(tank.kinks.some((k) => /^the slope of the rate of tank\.h along tank\.h differs left and right/.test(k)), tank.kinks.join(' | '));
  assert.ok(tank.kinks.some((k) => /along q differs left and right/.test(k)), tank.kinks.join(' | '));
  refusal(() => kalmanDesign(tank, { Q: [1], R: [1e-4], Ts: 0.02 }), 'kink', /^the Kalman filter needs slopes/);

  // The tank at its brim, h = H = 1 m: above it the water overflows, so the
  // level's rate has its slope below the brim and none above (the library's
  // schedule tops out at 0.95 m for this; decisions.md).
  const tm = modelOf(system('Conical'));
  assert.ok(linearize(tm, { y: [1] }).kinks.some((k) => /^the slope of the rate of tank\.h along tank\.h differs left and right/.test(k)));
  // Smooth plants have none: the carts hanging and upright, the tank at its
  // levels below the brim, the encoder with its resonance.
  for (const h of [0.1, 0.45, 0.95, 0.999]) assert.deepEqual(linearize(tm, { y: [h] }).kinks, [], `tank at ${h}`);
  const pend = modelOf(system('Pendulum swing-up'));
  assert.deepEqual(linearize(pend, 'origin').kinks, []);
  assert.deepEqual(linearize(pend, 'initial').kinks, []);
  assert.deepEqual(linearize(modelOf(system('Encoder')), 'origin').kinks, []);
  assert.deepEqual(linearize(modelOf(system('Triple')), 'origin').kinks, []);
  // The encoder in the middle of its sweep (the Analysis tab at the scope's
  // time): the shaft's x2 is badly scaled (the angle is wn²·x2), so a step
  // of it moves the angle 0.19 rad and the encoder's sines bend within ten
  // steps; the one-sided slopes then differ by the curvature (0.5 %), which
  // shrinks with a shorter step: no kink. It read as one before the merge.
  const enc = modelOf(system('Encoder'));
  const x = Float64Array.from(enc.x0);
  enc.states.forEach((s, i) => { x[i] = { angle: 8.405, 'shaft resonance 70 Hz.x1': 1.841e-4, 'shaft resonance 70 Hz.x2': 4.343e-5, 'speed from angle': -8367 }[s.label] ?? [2.683, 35.63][i] ?? 0; });
  assert.deepEqual(linearize(enc, { x, u: 10, label: 'mid-sweep', warnings: [] }).kinks, []);
});

test('trim starts from the levels: an empty tank trims at 0.1 m and its PI designs; levels of millimetres', () => {
  const { a, g } = system('Conical').blocks.find((b) => b.type === 'conicalTank').params;
  const d = raw('Conical');
  d.blocks.find((b) => b.type === 'conicalTank').params.h0 = 0;
  const empty = modelOf(normalizeDiagram(d));
  for (const h of [0.05, 0.1, 0.5, 1]) close(trim(empty, [h]).u, a * Math.sqrt(2 * g * h), 1e-9, `u at h = ${h} from empty`);
  assert.equal(operatingPoint(empty, 'initial').u, 0, 'an empty tank rests with the pump off');
  // From the default start (0.15 m), a level of a few millimetres.
  const tank = modelOf(system('Conical'));
  for (const h of [0.001, 0.003]) close(trim(tank, [h]).u, a * Math.sqrt(2 * g * h), 1e-9, `u at h = ${h}`);
  // The gain-scheduled PI of the library, on the empty tank: designed, u0 = 0.
  const st = compileDiagram(normalizeDiagram(d), 'plant', { standalone: true, designs: createDesignStore() }).designs[0];
  assert.equal(st.status, 'ok', JSON.stringify(st.error ?? st.warnings));
  assert.equal(st.values.u0, 0);
  // Its gains do not depend on where the tank starts; only u0 does.
  const full = compileDiagram(system('Conical'), 'plant', { standalone: true, designs: createDesignStore() }).designs[0];
  st.values.Kp.forEach((k, i) => close(k, full.values.Kp[i], 1e-9 * Math.abs(k), `Kp at ${st.values.at[i]}`));
  assert.ok(full.values.u0 > 0.17);
});

test('a stiff plant (the encoder: a 70 Hz shaft and a 1 ms filter beside a slow motor) trims and fits; an unstable path and a cancelled integrator are told apart', () => {
  // A has entries of 10¹¹ beside 1: the residuals are scaled row by row, so
  // the stiff filter's rate no longer drowns the rest. The equilibrium found
  // is the one nearest the start: the angle where the encoder reads 0.
  const enc = modelOf(system('Encoder'));
  const pt = trim(enc, [0]);
  const y = new Float64Array(1), f = new Float64Array(enc.n);
  enc.y(pt.x, pt.u, y); enc.f(pt.x, pt.u, f);
  assert.ok(Math.abs(y[0]) < 1e-6, `speed ${y[0]}`);
  f.forEach((v, i) => assert.ok(Math.abs(v) < 1e-7, `${enc.states[i].label} moves at ${v}`));
  // The ripple torque, 0.05 sin(6θ), pushes the rotor away from θ = 0: the
  // path from V to the speed is unstable there, and pole cancellation says so.
  refusal(() => firstOrderFit(linearize(enc, 'origin')), 'unstable-plant', /^the path from V to ω measured \(Motor\) is unstable: a pole at 11\.4 rad\/s$/);
  // Without it the angle's integrator is cancelled by the derivative after
  // it (a pole and a zero at s = 0): the speed has a static gain,
  // 20/3 V⁻¹·rad/s through the motor times the encoder's slope there.
  const d = raw('Encoder');
  Object.assign(d.blocks.find((b) => b.id === 'motor').params, { ripple: 0, torqueNoise: 0 });
  const smooth = modelOf(normalizeDiagram(d));
  const lin = linearize(smooth, 'origin');
  const slope = lin.C[0][4] / 1000 / 439.8 ** 2;
  const fit = firstOrderFit(lin);
  close(fit.K, (20 / 3) * slope, 1e-6, 'K');
  assert.ok(fit.tau > 0.05 && fit.tau < 0.1, `τ ${fit.tau}`);
  assert.ok(Math.abs(slope - 1.0284) < 1e-3, `the encoder's slope ${slope}`);
  // The motor's angle alone still integrates.
  refusal(() => firstOrderFit(linearize(modelOf(system('DC motor')))), 'integrating-plant', /θ measured \(Motor\) integrates V/);
});
