// The swing-up planner (src/core/planner.js; designs-in-the-page.md §8.3,
// test 9): a plan for the library's triple pendulum from hanging to
// upright, time-varying LQR along it, and the closed loop that follows it.
// The robustness matrix is in planner.slow.mjs (npm run test:slow).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTransfer, runPlan, alongPlan, tvlqrGains, planLaw, verifyLoop } from '../src/core/planner.js';
import { linearize } from '../src/core/linearize.js';
import { c2d } from '../src/core/linalg.js';
import { tripleModel, swingUp, HANGING } from './triple.mjs';

const OPTS = { T: 2.4, Ts: 0.01, segments: 12, Fmax: 30 };
const same = (a, b) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

// The nominal plan, made once by the first test and used by the next.
let nominal = null;
const planned = () => (nominal ??= runPlan(planTransfer(tripleModel(), OPTS)));

// Drains a plan as the page would, measuring the CPU time of each slice
// between yields (CPU, not wall-clock: other processes do not count).
function drain(gen) {
  const progress = [];
  let slice = 0, cpu = process.cpuUsage();
  for (;;) {
    const s = gen.next();
    const c = process.cpuUsage(cpu);
    slice = Math.max(slice, (c.user + c.system) / 1000);
    cpu = process.cpuUsage();
    if (s.done) return { plan: s.value, progress, slice };
    if (s.value) progress.push(s.value);
  }
}

test('the triple pendulum swing-up: a plan in ≤ 300 iterations, in short slices, the same bit for bit', (t) => {
  const model = tripleModel();
  assert.deepEqual(Array.from(model.x0), HANGING);
  // The budget is CPU time: the other test files run beside this one, and
  // on a loaded machine the wall clock counts their work too.
  const t0 = performance.now(), c0 = process.cpuUsage();
  const { plan, progress } = drain(planTransfer(model, OPTS));
  const ms = performance.now() - t0, cpu = process.cpuUsage(c0), cpuMs = (cpu.user + cpu.system) / 1000;
  assert.ok(plan.ok, plan.message);
  assert.deepEqual([plan.code, plan.message, plan.hint], [null, '', '']);
  assert.ok(plan.iterations <= 300, `${plan.iterations} iterations`);
  assert.ok(cpuMs < 10000, `${cpuMs} ms of CPU`);
  // One progress object per iteration, counting up; the rest are ticks.
  assert.equal(progress.length, plan.iterations);
  progress.forEach((p, i) => {
    assert.equal(p.iteration, i + 1);
    assert.ok(p.fraction >= 0 && p.fraction <= 1 && p.stage >= 1 && p.stage <= p.stages && p.start === 1 && p.starts === 3);
  });
  // The sample grid: 12 segments of 20 samples of 10 ms, 2 RK4 substeps each.
  assert.ok(Math.abs(plan.T - 2.4) < 1e-12);
  assert.deepEqual([plan.segments, plan.perSegment, plan.sub, plan.F.length, plan.S.length], [12, 20, 2, 240, 12]);
  assert.deepEqual(Array.from(plan.S[0]), HANGING);
  // It ends upright and at rest, its segments join, and it keeps to its share of the force.
  assert.ok(plan.defect < 1e-4, `defect ${plan.defect}`);
  model.states.forEach((s, i) => assert.ok(Math.abs(plan.terminal[i]) < (/\/s$/.test(s.unit) ? 0.5 : 0.02), `${s.name} ends ${plan.terminal[i]} off`));
  assert.ok(plan.Fpeak <= 1.05 * 30 && Math.max(...plan.F.map(Math.abs)) === plan.Fpeak);
  nominal = plan;

  // Again, from a fresh model: the same plan, bit for bit (no clock, no
  // randomness). The code is warm now, so the slices count only the plan's
  // own work (the first run's also count V8 compiling it on other threads).
  const again = drain(planTransfer(tripleModel(), OPTS));
  t.diagnostic(`planned in ${Math.round(ms)} ms (${Math.round(cpuMs)} ms of CPU): ${plan.iterations} iterations from start ${plan.start}, peak ${plan.Fpeak.toFixed(1)} N; longest slice ${again.slice.toFixed(1)} ms of CPU`);
  assert.ok(same(again.plan.F, plan.F) && same(again.plan.z, plan.z), 'the same plan');
  assert.equal(again.plan.iterations, plan.iterations);
  assert.ok(again.slice < 30, `a slice of ${again.slice} ms`);
});

test('a short sample time or many segments: the work per iteration stays that of the default, in short slices', () => {
  // At Ts = 1 ms the force is held over 5 samples (steps of 5 ms on the
  // controller's grid), and 40 segments solve by a banded Cholesky: neither
  // costs much more per iteration than the default (before: 13.7 s and
  // 25.8 s per plan, slices of 13 and 150 ms). Four iterations each, warm.
  const perIteration = (opts) => {
    const gen = planTransfer(tripleModel(), { ...OPTS, ...opts });
    let slice = 0, its = 0, cpu = process.cpuUsage();
    const c0 = process.cpuUsage();
    while (its < 4) {
      const s = gen.next();
      const c = process.cpuUsage(cpu);
      slice = Math.max(slice, (c.user + c.system) / 1000);
      cpu = process.cpuUsage();
      if (s.done) break;
      if (s.value) its++;
    }
    const all = process.cpuUsage(c0);
    return { ms: (all.user + all.system) / 1000 / its, slice };
  };
  const base = perIteration({});
  for (const opts of [{ Ts: 0.001 }, { segments: 40 }]) {
    const r = perIteration(opts);
    assert.ok(r.slice < 30, `${JSON.stringify(opts)}: a slice of ${r.slice} ms`);
    assert.ok(r.ms < 3 * base.ms + 20, `${JSON.stringify(opts)}: ${r.ms} ms per iteration, the default ${base.ms}`);
  }
});

test('along the plan: the step map\'s Jacobians; TV-LQR meets dlqr at rest; the loop swings up and holds', () => {
  const model = tripleModel(), plan = planned();
  const { along, up, Qx, values } = swingUp(model, { plan });
  const n = model.n;
  assert.deepEqual([along.K, along.xs.length, along.Ad.length, along.Bd.length], [240, 241 * n, 240 * n * n, 240 * n]);
  assert.deepEqual(Array.from(along.xs.subarray(0, n)), HANGING);
  assert.ok(along.Ad.every(Number.isFinite) && along.Bd.every(Number.isFinite));
  // Ad_k, Bd_k are the Jacobians of the one-sample map. Where the plant
  // rests they equal c2d of its linearisation, up to RK4's error (moving,
  // they differ from c2d at the sample's start, as they should).
  const rest = alongPlan(model, { segments: 1, perSegment: 4, Ts: 0.01, sub: plan.sub, F: new Float64Array(4), S: [Float64Array.from(HANGING)] });
  const lin = linearize(model, { x: Float64Array.from(HANGING), u: 0, warnings: [] });
  const { Ad, Bd } = c2d(lin.A, lin.B, 0.01);
  for (let k = 0; k < 4; k++) {
    rest.xs.subarray(k * n, (k + 1) * n).forEach((v, i) => assert.ok(Math.abs(v - HANGING[i]) < 1e-12, 'it stays'));
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) assert.ok(Math.abs(rest.Ad[k * n * n + r * n + c] - Ad[r][c]) < 1e-6, `Ad_${k}[${r}][${c}] = ${rest.Ad[k * n * n + r * n + c]}, c2d ${Ad[r][c]}`);
      assert.ok(Math.abs(rest.Bd[k * n + r] - Bd[r][0]) < 1e-7, `Bd_${k}[${r}]`);
    }
  }
  // At rest at the origin with the upright P as its end, every TV-LQR gain is dlqr's.
  const still = { n, K: 30, Ad: new Float64Array(30 * n * n), Bd: new Float64Array(30 * n) };
  for (let k = 0; k < 30; k++) { still.Ad.set(up.Ad.flat(), k * n * n); still.Bd.set(up.Bd.map((b) => b[0]), k * n); }
  const Ks = tvlqrGains(still, { Q: Qx, R: 0.1, Pend: up.P });
  for (let k = 0; k < 30; k++) for (let c = 0; c < n; c++) assert.ok(Math.abs(Ks[k * n + c] - up.Kx[c]) < 1e-6 * Math.abs(up.Kx[c]) + 1e-9, `K_${k}[${c}] = ${Ks[k * n + c]}, dlqr ${up.Kx[c]}`);
  // The law along the plan: upright 1 s after it, within the actuator's ±40 N.
  const v = verifyLoop(model, planLaw(values, 0.01), { Ts: 0.01, sub: plan.sub, duration: plan.T + 1, umin: -40, umax: 40 });
  assert.ok(v.ok, JSON.stringify(v.endError));
  assert.ok(v.Fpeak < 40 && v.xmax < 1, `peak ${v.Fpeak} N, cart ${v.xmax} m`);
  // Without it the chain hangs: the check says which state is off, and by how much.
  const idle = verifyLoop(model, { step: () => 0 }, { Ts: 0.01, duration: 1 });
  assert.equal(idle.ok, false);
  assert.equal(idle.endError.label, 'θ1');
  assert.ok(Math.abs(Math.abs(idle.endError.value) - Math.PI) < 1e-9);
});

test('planLaw: rests until the plan starts, follows it with angles modulo 2π, then holds upright', () => {
  const values = { F: [1, 2], Y: [0, 3, 0, 3.1], K: [1, 10, 2, 20], Kup: [3, 30], kr: 5, angle: [false, true] };
  const law = planLaw(values, 0.1, { start: 0.2, umin: -50, umax: 50 });
  const run = (inputs) => law.step(inputs);
  assert.equal(run([1, 7, 7]), 0, 'before the start');
  assert.equal(run([1, 7, 7]), 0);
  // u = F − K (y − Y): the angle error 3 + 2π − 3 counts as 0.
  assert.ok(Math.abs(run([1, 0.5, 3 + 2 * Math.PI]) - (1 - 0.5)) < 1e-12);
  assert.ok(Math.abs(run([1, 0, 3.0]) - (2 - 20 * wrap(3.0 - 3.1))) < 1e-12);
  // After the plan: u = kr r − Kup y, the angle wrapped; then clamped.
  assert.ok(Math.abs(run([1, 0.1, 2 * Math.PI + 0.01]) - (5 - 0.3 - 0.3)) < 1e-9);
  assert.equal(run([1, -100, 0]), 50);
});

test('a plan that cannot be: with 2 N the planner says so, with a hint, and still returns its attempt', () => {
  const plan = runPlan(planTransfer(tripleModel(), { ...OPTS, Fmax: 2 }));
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'plan-not-converged');
  assert.match(plan.message, /^no plan found/);
  assert.match(plan.message, /F/);
  assert.equal(plan.hint, 'needs more force or a longer T (now 2.4 s)');
  assert.ok(plan.iterations <= 300);
  assert.equal(plan.F.length, 240, 'the attempt, so it can be seen');
});

test('a sensor whose slope changes along the swing: the gains are mapped with its slope at each sample', async () => {
  // The cart–pole, its angle read through y = θ + 0.2 sin θ (slope 0.8
  // hanging, 1.2 upright): K_k = Kx_k C_k⁻¹ with C_k = ∂y/∂x at the plan's
  // state, not at the origin.
  const { normalizeDiagram, compileDiagram } = await import('../src/core/diagram.js');
  const { SYSTEM_LIBRARY } = await import('../src/core/systems.js');
  const { operatingPoint } = await import('../src/core/linearize.js');
  const { lqrDesign } = await import('../src/core/design.js');
  const { planValues } = await import('../src/core/planner.js');
  const d = structuredClone(SYSTEM_LIBRARY.find((s) => s.name.startsWith('Pendulum')).plant.diagram);
  d.blocks.push({ id: 'enc', type: 'fcn', name: 'encoder', params: { expr: 'u + 0.2*sin(u)' }, x: 0, y: 0 });
  d.wires = d.wires.map((w) => (w.from === 'cart:1' && w.to === 'ctrl:2' ? { from: 'enc', to: 'ctrl:2' } : w)).concat([{ from: 'cart:1', to: 'enc' }]);
  const model = compileDiagram(normalizeDiagram(d), 'plant', { mode: 'model' }).seen('ctrl');
  const plan = runPlan(planTransfer(model, { T: 2.4, Ts: 0.01, segments: 12, Fmax: 18.75 }));
  assert.ok(plan.ok, plan.message);
  const along = alongPlan(model, plan);
  const lin = linearize(model, operatingPoint(model, 'origin'));
  assert.ok(Math.abs(lin.C[1][2] - 1.2) < 1e-9, 'the angle\'s slope upright');
  const Q = [10, 50, 1, 1];
  const up = lqrDesign(lin, { Q, R: 0.1, track: 1, Ts: 0.01 });
  const Kx = tvlqrGains(along, { Q: up.Qx, R: 0.1, Pend: up.P });
  const values = planValues(model, along, Kx, { K: up.K, kr: up.kr });
  const n = 4, m = 4, k = 30;   // early in the swing: the pole still near hanging
  const theta = along.xs[k * n + 2];
  assert.ok(Math.abs(Math.cos(theta)) > 0.5, `θ ${theta}`);
  const slope = along.Cy[(k * m + 1) * n + 2];
  assert.ok(Math.abs(slope - (1 + 0.2 * Math.cos(theta))) < 1e-6, `slope ${slope}`);
  // K_k C_k = Kx_k: the feedback in states is the one TV-LQR designed.
  for (let c = 0; c < n; c++) {
    let s = 0;
    for (let i = 0; i < m; i++) s += values.K[k * m + i] * along.Cy[(k * m + i) * n + c];
    assert.ok(Math.abs(s - Kx[k * n + c]) < 1e-9 * Math.max(1, Math.abs(Kx[k * n + c])), `K C [${c}] = ${s}, Kx ${Kx[k * n + c]}`);
  }
});
