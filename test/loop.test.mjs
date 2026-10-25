// Analysis hooks (designs-in-the-page.md §12, step 12): snapshots of a run,
// the plant a block sees linearised at an operating point (linearizeBlock),
// and the loop a Controller closes (loopModel: the plant and the law's own
// linear model), checked against the nonlinear simulation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDiagram, compileDiagram } from '../src/core/diagram.js';
import { simulateSystem } from '../src/core/sim.js';
import { CONTROLLERS, normalizeVariant } from '../src/core/controllers.js';
import { planLaw } from '../src/core/planner.js';
import { createDesignStore, lqrDesign } from '../src/core/design.js';
import { c2d, eig } from '../src/core/linalg.js';
import { normalizeProject, evaluateSystem, designSystem, autoTimebase, simOf, linearizeBlock, loopModel } from '../src/core/project.js';
import { SYSTEM_LIBRARY, applySystem } from '../src/core/systems.js';
import { DEFAULT_PROJECT } from '../src/core/examples.js';

function project(name, variant = 0) {
  const p = normalizeProject(applySystem(DEFAULT_PROJECT, SYSTEM_LIBRARY.find((s) => s.name.startsWith(name)), ['input', 'plant']));
  p.scope.timebase = autoTimebase(p);
  blk(p, 'ctrl').variant = variant;
  return p;
}
const blk = (p, id) => p.system.plant.diagram.blocks.find((b) => b.id === id);
const same = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
const close = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a}, not ${b}`);
const refusal = (fn, code, pattern) => assert.throws(fn, (err) => err.code === code && pattern.test(err.message) && !!err.hint, `expected ${code}`);
const byMagnitude = (zs) => zs.map((z) => [z.re, z.im]).sort((a, b) => Math.hypot(...a) - Math.hypot(...b) || a[1] - b[1]);

// The linear closed loop as the Analysis tab forms it: the plant discretised
// with a zero-order hold at Ts, each measurement's dead time as whole
// samples, the law's own state space from [r, y…] to u. Runs K samples of
// deviations from the operating point with r(k); returns y1 and u.
function linearLoop(m, r, K, x0 = null) {
  const { plant, ctrl, Ts } = m;
  const { Ad, Bd } = c2d(plant.A, plant.B, Ts);
  const n = plant.n, nm = plant.m, nc = ctrl.A.length;
  const lag = plant.delay.map((d) => Math.round(d / Ts)), fifo = lag.map((l) => new Array(l).fill(0));
  let x = x0 ? Array.from(x0) : new Array(n).fill(0), xc = new Array(nc).fill(0);
  const y1 = [], us = [];
  for (let k = 0; k < K; k++) {
    const y = plant.C.map((row, i) => {
      const now = row.reduce((s, c, j) => s + c * x[j], 0);
      if (!lag[i]) return now;
      fifo[i].push(now);
      return fifo[i].shift();
    });
    const inp = [r(k), ...y];
    let u = ctrl.D[0].reduce((s, d, i) => s + d * (inp[i] ?? 0), 0);
    for (let j = 0; j < nc; j++) u += ctrl.C[0][j] * xc[j];
    y1.push(y[0]); us.push(u);
    xc = ctrl.A.map((row, i) => row.reduce((s, a, j) => s + a * xc[j], 0) + ctrl.B[i].reduce((s, b, j) => s + b * (inp[j] ?? 0), 0));
    x = Ad.map((row, i) => row.reduce((s, a, j) => s + a * x[j], 0) + Bd[i][0] * u);
  }
  return { y1, u: us };
}
// The closed loop's poles: the plant (no dead time) with a static law u = D·[r, y].
function staticPoles(m) {
  const { Ad, Bd } = c2d(m.plant.A, m.plant.B, m.Ts);
  const Dy = m.ctrl.D[0].slice(1);
  return eig(Ad.map((row, i) => row.map((v, j) => v + Bd[i][0] * Dy.reduce((s, d, k) => s + d * m.plant.C[k][j], 0))));
}

test('snapshots: a run stopped at t holds what a model at that moment needs', () => {
  const p = project('Conical tank');
  const d = p.system.plant.diagram, sim = simOf(p);
  const full = simulateSystem(d, p.system.signals, sim);
  const part = simulateSystem(d, p.system.signals, sim, { until: 1.7013 });
  const k = Math.round(1.7013 / sim.sampleTime);
  assert.equal(part.t.length, k + 1);
  assert.equal(full.snapshot, undefined);
  const snap = part.snapshot;
  close(snap.t, k * sim.sampleTime, 1e-12, 't on the grid');
  // The run so far is the full run's, bit for bit.
  for (const name of Object.keys(full.signals)) assert.ok(same(part.signals[name], full.signals[name].subarray(0, k + 1)), name);
  // The state, what the controller holds, what it read, and the Sources.
  const el = compileDiagram(d, 'plant', { mode: 'model' });
  const h = el.states.find((s) => s.name === 'h').index;
  assert.equal(snap.X[h], full.signals.h[k]);
  assert.equal(snap.held.ctrl, full.signals.q[k]);
  assert.equal(snap.sources.r, full.signals.r[k]);
  assert.equal(snap.sources.d, full.signals.d[k]);
  assert.equal(snap.inputs.ctrl.length, 2);
  close(snap.inputs.ctrl[0], 0.45, 1e-12, 'r at the last sample');
  // The snapshot fits a model: its state is the model's start.
  assert.deepEqual(Array.from(el.seen('ctrl', { X: snap.X, held: snap.held, sources: snap.sources, t: snap.t }).x0), [snap.X[h]]);
  // until 0 is the start; a run that diverges has no snapshot.
  assert.equal(simulateSystem(d, p.system.signals, sim, { until: 0 }).snapshot.t, 0);
  const blow = normalizeDiagram({
    blocks: [{ id: 'r', type: 'source', params: { signal: 'r' } }, { id: 'ctrl', type: 'controller', params: { inputs: 2, Ts: 0.01 }, variants: [{ type: 'off' }] },
      { id: 's', type: 'sum', params: { signs: '+++' } }, { id: 'i', type: 'integrator', params: { K: 1 } }, { id: 'g', type: 'gain', params: { K: 100 } }, { id: 'y', type: 'sink', params: { name: 'y' } }],
    wires: [{ from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 's' }, { from: 'r', to: 's:1' }, { from: 'g', to: 's:2' }, { from: 's', to: 'i' }, { from: 'i', to: 'g' }, { from: 'i', to: 'y' }, { from: 'i', to: 'ctrl:1' }],
  });
  const r = { r: { period: 1, components: [{ type: 'dc', params: { level: 1 } }] } };
  assert.equal(simulateSystem(blow, r, { duration: 1, sampleTime: 0.01 }, { until: 0.9 }).snapshot, null);
  assert.throws(() => simulateSystem(d, p.system.signals, sim, { until: -1 }), /until/);
});

test('linearizeBlock: the plant a block sees at rest, at a level, and at a moment of the run', () => {
  const p = project('Conical tank');
  // At 1.2 s the tank rests at its start level (u0 holds it): the snapshot
  // gives the model a trim at that level gives.
  const atT = linearizeBlock(p, 'ctrl', { t: 1.2 });
  const atY = linearizeBlock(p, 'ctrl', { y: [0.15] });
  assert.equal(atT.t, 1.2);
  assert.equal(atT.Ts, 0.02);
  assert.equal(atT.idPath, 'ctrl');
  assert.equal(atT.op.label, 't = 1.20 s of the run');
  assert.ok(atT.op.drift < 1e-9, `drift ${atT.op.drift}`);
  close(atT.op.u, atY.op.u, 1e-9, 'u at rest');
  close(atT.A[0][0], atY.A[0][0], 1e-6 * Math.abs(atY.A[0][0]), 'A');
  close(atT.B[0][0], atY.B[0][0], 1e-6 * Math.abs(atY.B[0][0]), 'B');
  assert.deepEqual(atT.delay, [0.1]);
  // While the level climbs, the snapshot is not an equilibrium: the drift is
  // reported, and the slope is the tank's at h(t), with the pump's q(t).
  const tk = blk(p, 'tank').params, c = tk.a * Math.sqrt(2 * tk.g), s = (tk.R - tk.r0) / tk.H;
  const climbing = linearizeBlock(p, 'ctrl', { t: 1.7 });
  const h = climbing.op.x[0], q = climbing.op.u, rr = tk.r0 + s * h, area = Math.PI * rr * rr;
  const slope = (-c / (2 * Math.sqrt(h))) / area - ((q - c * Math.sqrt(h)) * 2 * Math.PI * rr * s) / (area * area);
  assert.ok(climbing.op.drift > 0.01 && climbing.warnings.some((w) => /t = 1\.70 s is not an equilibrium: tank\.h moves at/.test(w)), climbing.warnings.join(' / '));
  close(climbing.A[0][0], slope, 1e-6 * Math.abs(slope), 'slope at h(t)');
  close(climbing.B[0][0], 1 / area, 1e-6 / area, 'B at h(t)');
  // Refusals, in sentences.
  refusal(() => linearizeBlock(p, 'nothing'), 'no-block', /no Controller or Observer "nothing"/);
  const single = normalizeProject({ system: { signals: { r: { period: 1, components: [] } }, plant: { type: 'firstOrder', params: { K: 1, tau: 1 } } } });
  refusal(() => linearizeBlock(single, 'ctrl'), 'no-diagram', /not a block diagram/);
});

test('every law\'s linear model reproduces its step() about an operating point', () => {
  const Ts = 0.01, inf = { umin: -Infinity, umax: Infinity };
  const norm = (type, params) => normalizeVariant({ type, params }).params;
  const cases = [
    ['pid', norm('pid', { Kp: 2, Ki: 3, Kd: 0.4, Tf: 0.02, b: 0.7 }), null, 1],
    ['pid', norm('pid', { Kp: 1.5 }), null, 1],
    ['stateFeedback', norm('stateFeedback', { K: [1, -2, 0.5], kr: 3 }), null, 3],
    ['gainScheduled', norm('gainScheduled', { at: [0, 1], Kp: [1, 3], Ki: [0.5, 2] }), null, 1],
    ['swingUp', norm('swingUp', { K: [-1, -30, -2, -5], kr: -1 }), null, 4],
    ['lqr', norm('lqr', { Q: [1], R: 1, ...inf }), { K: [-1, -30, -2, -5], kr: -1 }, 4],
    ['swingUpLqr', norm('swingUpLqr', { Q: [1], R: 1 }), { K: [-2, -40, -3, -6], kr: -2 }, 4],
    ['scheduledPI', norm('scheduledPI', { at: [0.5] }), { at: [0.5], Kp: [1.2], Ki: [3], u0: 0 }, 1],
    ['scheduledPI', norm('scheduledPI', { at: [0, 0.4, 1] }), { at: [0, 0.4, 1], Kp: [1, 2, 4], Ki: [0.5, 1, 3], u0: 0 }, 1],
  ];
  for (const [type, p, values, m] of cases) {
    // About an operating point: the scheduled PIs at y = 0.5 see small moves only.
    const y0 = /cheduled/.test(type) ? 0.5 : 0;
    const law = CONTROLLERS[type].make(p, Ts, values), lin = CONTROLLERS[type].linear(p, Ts, { y: new Array(m).fill(y0) }, values);
    const n = lin.A.length;
    let x = new Array(n).fill(0), worst = 0, u0 = null;
    for (let k = 0; k < 200; k++) {
      const v = k === 0 ? new Array(m + 1).fill(0) : Array.from({ length: m + 1 }, (_, i) => 1e-3 * Math.sin(0.3 * k * (i + 1) + i));
      const uLaw = law.step(v.map((dv) => dv + y0));
      u0 ??= uLaw;   // the law's output at the operating point
      let u = lin.D[0].reduce((s, dd, i) => s + dd * v[i], 0);
      for (let j = 0; j < n; j++) u += lin.C[0][j] * x[j];
      x = lin.A.map((row, i) => row.reduce((s, a, j) => s + a * x[j], 0) + lin.B[i].reduce((s, b, j) => s + b * v[j], 0));
      worst = Math.max(worst, Math.abs(uLaw - u0 - u));
    }
    // A scheduled PI's slope term is second order in the small moves.
    assert.ok(worst < (/cheduled/.test(type) ? 1e-5 : 1e-12), `${type}: worst ${worst}`);
  }
  // A designed variant without values has nothing to analyse; the swing-up
  // is linear only where it catches.
  refusal(() => CONTROLLERS.lqr.linear(norm('lqr', {}), Ts, { y: [0] }, null), 'no-design', /LQR has no design/);
  assert.throws(() => CONTROLLERS.swingUpLqr.linear(cases[6][1], Ts, { y: [0, Math.PI, 0, 0] }, cases[6][2]), /pumps energy/);

  // The planned swing-up at the sample at.t is at: u = 0 before its start,
  // the plan's gains along it (r unused), the upright LQR after it and at rest.
  const plan = { F: Float64Array.from([1, 2, 3]), Y: Float64Array.from([0.1, 3, 0.2, 2, 0.3, 1]), K: Float64Array.from([1, 2, 3, 4, 5, 6]), Kup: [7, 8], kr: 9, angle: [false, true] };
  const tp = norm('trajectory', { start: 0.02, umin: -40, umax: 40 });
  const L = (t) => CONTROLLERS.trajectory.linear(tp, Ts, { y: [0, 0], ...(t === undefined ? {} : { t }) }, plan);
  assert.deepEqual(L(0.01).D, [[0, -0, -0]]);
  assert.match(L(0.01).note, /before the plan starts/);
  assert.deepEqual(L(0.035).D, [[0, -3, -4]]);
  assert.match(L(0.035).note, /sample 1 of 3 \(t = 0\.03 s\)/);
  assert.deepEqual(L(0.05).D, [[9, -7, -8]]);
  assert.deepEqual(L(undefined).D, [[9, -7, -8]]);
  // ... as planLaw runs it: at sample j = 1, u = F_1 − K_1 (y − Y_1).
  const law = planLaw(plan, Ts, tp);
  for (let k = 0; k < 3; k++) law.step([0, 0, 0]);
  close(law.step([0, 0.2 + 1e-3, 2 - 2e-3]), 2 - 3 * 1e-3 - 4 * -2e-3, 1e-12, 'u at sample 1');
  refusal(() => CONTROLLERS.trajectory.linear(tp, Ts, { y: [0, 0] }, null), 'no-design', /no design/);
});

test('loopModel: the linear loop of the plant seen and the law reproduces the simulation, as designed', () => {
  // The cart–pole on "LQR only", 0.01 rad off upright, no push: the linear
  // loop (the plant with a zero-order hold, the law's model) follows the run.
  const p = project('Pendulum', 1);
  blk(p, 'cart').params.theta0 = 0.01;
  p.system.signals.d = { period: p.system.signals.d.period, components: [] };
  const m = loopModel(p, 'ctrl', 'origin');
  assert.deepEqual([m.Ts, m.variantName, m.type, m.opLabel, m.t], [0.01, 'LQR only', 'lqr', 'origin (all states 0, u = 0)', undefined]);
  assert.deepEqual(m.warnings, []);
  assert.deepEqual(m.plant.outputs.map((o) => o.label), ['x', 'θ', 'v', 'ω']);
  // Its closed-loop poles are the ones LQR designed.
  const d = lqrDesign(m.plant, { Q: [10, 50, 1, 1], R: 0.1, track: 1, Ts: 0.01 });
  byMagnitude(staticPoles(m)).forEach(([re, im], i) => { const [r2, i2] = byMagnitude(d.poles)[i]; close(re, r2, 1e-9, `pole ${i}`); close(im, i2, 1e-9, `pole ${i}`); });
  const run = evaluateSystem(p, { designs: createDesignStore() });
  const step = Math.round(m.Ts / (run.t[1] - run.t[0]));
  const x0 = [0, 0, 0.01, 0];   // x, v, θ, ω
  const lin = linearLoop(m, () => 0, 300, x0);
  let worst = 0;
  for (let k = 0; k < 300; k++) worst = Math.max(worst, Math.abs(run.signals.x[k * step] - lin.y1[k]), Math.abs(run.signals.F[k * step] - lin.u[k]) / 100);
  assert.ok(worst < 1e-5, `worst ${worst} (x in m, F/100 in N)`);

  // The tank on the gain-scheduled PI about 0.45 m: a small step a in r
  // (between two samples, so both loops see it first at 0.52 s), less the
  // run without it, over a; the pipe's dead time as whole samples, the PI
  // from the plant. What is left is the tank's own nonlinearity: the pipe's
  // Dead time delays the held u exactly (it came out half an integration
  // step early, 2.8·10⁻³ of the step).
  const t = project('Conical tank'), a = 1e-5;
  blk(t, 'tank').params.h0 = 0.45;
  const r = (amp) => ({ period: 5, components: [{ type: 'dc', params: { level: 0.45 } }, { type: 'step', params: { amplitude: amp, time: 0.505 } }] });
  t.system.signals.r = r(a);
  t.system.signals.d = { period: 5, components: [] };
  blk(t, 'ctrl').variants[0].params.Tr = 0;   // the prefilter lies outside the loop
  const mt = loopModel(t, 'ctrl', 'initial');
  assert.equal(mt.opLabel, 'the initial state, q = 0.297');
  assert.equal(mt.t, 0);
  assert.deepEqual(mt.plant.delay, [0.1]);
  assert.equal(mt.ctrl.A.length, 1);   // a PI: its integral
  const runT = evaluateSystem(t, { designs: createDesignStore() });
  const baseT = evaluateSystem({ ...t, system: { ...t.system, signals: { ...t.system.signals, r: r(0) } } }, { designs: createDesignStore() });
  const sT = Math.round(mt.Ts / (runT.t[1] - runT.t[0]));
  const linT = linearLoop(mt, (k) => (k * mt.Ts >= 0.505 ? 1 : 0), 200);
  let worstT = 0;
  for (let k = 0; k < 200; k++) worstT = Math.max(worstT, Math.abs((runT.signals.h[k * sT] - baseT.signals.h[k * sT]) / a - linT.y1[k]));
  assert.ok(worstT < 5e-5, `tank: worst ${worstT} of the step`);
  assert.ok(Math.max(...linT.y1) > 0.95, 'the step is followed');
});

test('loopModel: refusals and notes: a law not linear there, no design yet, an Observer, a look-through', () => {
  const p = project('Pendulum');
  refusal(() => loopModel(p, 'ctrl', 'initial'), 'not-linear', /Swing-up \+ LQR catch: the swing-up pumps energy at θ = -3\.14 rad/);
  const m = loopModel(p, 'ctrl', 'origin');
  assert.equal(m.ctrl.D[0].length, 5);
  // The triple pendulum's plan is not made yet in a page's store.
  const tp = project('Triple');
  refusal(() => loopModel(tp, 'ctrl', 'origin', { designs: createDesignStore({ mode: 'async' }) }), 'no-design', /Planned swing-up \+ TV-LQR has no design to analyse: its plan is not made yet/);
  // The tank at the origin (empty, q = 0) is a kink: the central slope is
  // neither side's and depends on the difference step (A from −2.8·10³ to
  // −2.8·10⁵ 1/s), so the loop is refused there, as a design refuses it (the
  // tab read "✓ stable, ×4840 good" from it).
  refusal(() => loopModel(project('Conical tank'), 'ctrl', 'origin'), 'kink', /kink at origin .*tank\.h/);
  // At the start, no kink and u = 0 is no limit: no such note.
  const start = loopModel(project('Conical tank'), 'ctrl', 'initial');
  assert.equal(start.atLimit, false);
  assert.deepEqual(start.plant.kinks, []);
  assert.ok(!start.warnings.some((w) => /at its limit/.test(w)));
  // u at a limit (the oven's heater at rest) is flagged, not refused: the
  // linear plant holds, the controller's saturation opens the loop.
  const oven = loopModel(project('Oven'), 'ctrl', 'origin');
  assert.equal(oven.atLimit, true);
  assert.ok(oven.warnings.some((w) => /is at its limit .* there: the controller saturates/.test(w)));
  // A Controller on a Kalman filter's estimates: the loop reads them as the
  // states, and says the filter's dynamics are left out.
  const k = project('Pendulum', 1);
  const d = k.system.plant.diagram, ctrl = blk(k, 'ctrl');
  ctrl.variants = [normalizeVariant({ name: 'LQR', type: 'lqr', params: { Q: [10, 1, 50, 1], R: 0.1, umin: -25, umax: 25 } })];
  ctrl.variant = 0;
  d.blocks.push({ id: 'obs', type: 'observer', name: 'estimator', params: { inputs: 3, outputs: 4, Ts: 0.01 }, variants: [{ type: 'kalman', params: { Q: [1] } }], x: 200, y: 300 });
  d.wires = d.wires.filter((w) => !w.to.startsWith('ctrl:'));
  d.wires.push({ from: 'ctrl', to: 'obs' }, { from: 'cart', to: 'obs:1' }, { from: 'cart:1', to: 'obs:2' }, ...[0, 1, 2, 3].map((j) => ({ from: j ? `obs:${j}` : 'obs', to: `ctrl:${j + 1}` })));
  k.system.plant.diagram = normalizeDiagram(d);
  const mk = loopModel(k, 'ctrl', 'origin');
  assert.ok(mk.warnings.includes('the estimates of \'estimator\' are read as the states they stand for: the filter\'s own dynamics are not in this loop'), mk.warnings.join(' / '));
  assert.ok(byMagnitude(staticPoles(mk)).every(([re, im]) => Math.hypot(re, im) < 1), 'stable');
  refusal(() => loopModel(k, 'obs', 'origin'), 'not-a-controller', /'estimator' is an Observer/);
  // The Observer's own plant: u is what feeds its input 1.
  const lo = linearizeBlock(k, 'obs', { t: 0.5 });
  assert.deepEqual(lo.outputs.map((o) => o.label), ['x', 'θ']);
  assert.equal(lo.input.label, 'F');
});

test('loopModel on main\'s systems: sliding mode linear only in its boundary layer; an External plant has no model', () => {
  // The sliding modes: the boundary layer is a PD inside |s| < φ; the ideal
  // relay and super-twisting have no slope at s = 0, and say so.
  const smc = project('DC motor, sliding');
  const names = blk(smc, 'ctrl').variants.map((v) => v.name);
  blk(smc, 'ctrl').variant = names.indexOf('Relay (theory)');
  refusal(() => loopModel(smc, 'ctrl', 'origin'), 'not-linear', /an ideal sliding mode switches: it has no linear model/);
  blk(smc, 'ctrl').variant = names.indexOf('Super-twisting');
  refusal(() => loopModel(smc, 'ctrl', 'origin'), 'not-linear', /super-twisting has no linear model/);
  blk(smc, 'ctrl').variant = names.indexOf('Boundary layer');
  const bl = loopModel(smc, 'ctrl', 'origin');
  const { lambda, K, phi } = blk(smc, 'ctrl').variants[blk(smc, 'ctrl').variant].params;
  assert.deepEqual(bl.ctrl.D[0], [K * lambda / phi, -K * lambda / phi, -K / phi]);
  assert.deepEqual(bl.plant.outputs.map((o) => o.label), ['angle', 'speed (Motor)']);
  // A plant outside the page (Live mode): what u drives runs elsewhere, so
  // neither a design nor the Analysis tab has a model of it.
  const hil = project('HIL');
  refusal(() => loopModel(hil, 'ctrl', 'origin'), 'external-plant', /^the plant runs outside the page \(External plant 'plant'\): the page has no model of it/);
  blk(hil, 'ctrl').variants = [normalizeVariant({ name: 'LQR', type: 'lqr', params: { Q: [1], R: 1 } })];
  blk(hil, 'ctrl').variant = 0;
  const st = evaluateSystem(hil).info.designs[0];
  assert.equal(st.status, 'error');
  assert.equal(st.error.code, 'external-plant');
  // The page does not simulate it offline; the design still says why.
  const [off] = designSystem(hil);
  assert.equal(off.status, 'error');
  assert.equal(off.error.code, 'external-plant');
});

test('Ms and Mt are the peaks of |S| and |T| on L itself, not on the frequency grid', async () => {
  const { analyzeLoop, respondAt } = await import('../src/core/analysis.js');
  // The encoder's 70 Hz shaft is a peak narrower than the grid: Ms read 5.78
  // against 5.93 at 420 rad/s.
  for (const [name, at] of [['Encoder', 'origin'], ['DC motor, position', 'origin'], ['Oven', 'initial'], ['Following a sine', 'origin']]) {
    const m = loopModel(project(name), 'ctrl', at);
    const res = analyzeLoop(m.plant, m.ctrl, m.Ts), L = res.L;
    // A dense scan of 1/|1 + L| and |L|/|1 + L| over the band the tab draws
    // (its lowest frequency up to Nyquist), then a finer one about each
    // scan's peak. (Below the band, an integrating loop's |T| still rises
    // towards 1 at DC: the sine example's Mt reads 0.992.)
    const w0 = res.fd.w[0], wN = res.fd.w.at(-1), N = 40000, S = (w) => { const v = respondAt(L, w); return 1 / Math.hypot(1 + v.re, v.im); };
    const T = (w) => { const v = respondAt(L, w); return Math.hypot(v.re, v.im) / Math.hypot(1 + v.re, v.im); };
    const peak = (f) => {
      const w = (i) => w0 * (wN / w0) ** (i / N);
      let best = 0, at = 0;
      for (let i = 0; i <= N; i++) { const v = f(w(i)); if (v > best) { best = v; at = i; } }
      const lo = w(Math.max(0, at - 1)), hi = w(Math.min(N, at + 1));
      for (let j = 0; j <= 4000; j++) best = Math.max(best, f(lo + ((hi - lo) * j) / 4000));
      return best;
    };
    const ms = peak(S), mt = peak(T);
    assert.ok(res.margins.ms >= ms * (1 - 1e-6) && res.margins.ms <= ms * (1 + 1e-4), `${name}: Ms ${res.margins.ms}, the scan ${ms}`);
    assert.ok(res.margins.mt >= mt * (1 - 1e-6) && res.margins.mt <= mt * (1 + 1e-4), `${name}: Mt ${res.margins.mt}, the scan ${mt}`);
  }
});
