// The physics must be right whatever the controller does: a bad loop may do
// strange things, but only things the real system would do. These tests hold
// each physics block to conservation laws and textbook results, and the
// System library's pictures to the model (they draw the state as it is).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagramBlockDef, normalizeDiagram, compileDiagram } from '../src/core/diagram.js';
import { SYSTEM_LIBRARY } from '../src/core/systems.js';
import { conicalTank } from '../src/core/physics.js';

const params = (type, over = {}) => ({ ...Object.fromEntries(diagramBlockDef(type).params.map((s) => [s.key, s.default])), ...over });

// An open model (a masked subsystem from physics.js) compiled as the plant
// alone: In → model → Out (its first output). { el, f(t, X, u, dX), y(t, X) }.
function compiled(sub) {
  const el = compileDiagram(normalizeDiagram({
    blocks: [{ id: 'in', type: 'inport', params: { port: 1 } }, { id: 'sub', name: 'model', ...sub }, { id: 'out', type: 'outport', params: { port: 1 } }],
    wires: [{ from: 'in', to: 'sub' }, { from: 'sub', to: 'out' }],
  }));
  return { el, f: (t, x, uu, d) => el.eval(t, x, 0, uu, d), y: (t, x) => el.eval(t, x, 0, 0, null) };
}

// Integrates one physics model with RK4 at step h for T seconds under the
// input u(t, X); calls watch(t, X) at every step. type: an old block type
// (its ode), or an open model, a masked subsystem (compiled, its In driven by u).
function run(type, p, { T, h = 1e-3, u = () => 0, X0, watch }) {
  let n, init, f;
  if (typeof type === 'string') {
    const { ode } = diagramBlockDef(type);
    n = typeof ode.n === 'function' ? ode.n(p) : ode.n;
    init = ode.init(p);
    // The rate function the compile uses: ode.make computes the constants once.
    const rates = ode.make(p);
    f = (t, x, d) => rates(x, 0, u(t, x), d);
  } else {
    const c = compiled(type);
    n = c.el.n; init = new Float64Array(n); c.el.init(init, 0);
    f = (t, x, d) => c.f(t, x, u(t, x), d);
  }
  const X = Float64Array.from(X0 ?? init), Xt = new Float64Array(n);
  const k = [1, 2, 3, 4].map(() => new Float64Array(n));
  for (let i = 0, t = 0; i < Math.round(T / h); i++, t += h) {
    watch?.(t, X);
    f(t, X, k[0]);
    for (let j = 0; j < n; j++) Xt[j] = X[j] + 0.5 * h * k[0][j];
    f(t + h / 2, Xt, k[1]);
    for (let j = 0; j < n; j++) Xt[j] = X[j] + 0.5 * h * k[1][j];
    f(t + h / 2, Xt, k[2]);
    for (let j = 0; j < n; j++) Xt[j] = X[j] + h * k[2][j];
    f(t + h, Xt, k[3]);
    for (let j = 0; j < n; j++) X[j] += (h / 6) * (k[0][j] + 2 * k[1][j] + 2 * k[2][j] + k[3][j]);
  }
  watch?.(T, X);
  return X;
}

// Cart–pole, state [x, v, θ, ω]: energy and horizontal momentum.
const cpEnergy = (p, X) => { const [, v, th, w] = X; return 0.5 * (p.M + p.m) * v * v + p.m * p.l * v * w * Math.cos(th) + 0.5 * p.m * p.l * p.l * w * w + p.m * p.g * p.l * Math.cos(th); };
const cpMomentum = (p, X) => (p.M + p.m) * X[1] + p.m * p.l * X[3] * Math.cos(X[2]);

// Pendulum chain on a cart, state [x, θ1…θn, v, ω1…ωn]: point masses at the rod ends.
function chainBodies(p, X) {
  const n = p.links, v = X[n + 1];
  let px = 0, py = 0, vx = v, vy = 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    const th = X[1 + i], w = X[n + 2 + i], l = p[`l${i + 1}`];
    px += l * Math.sin(th); py += l * Math.cos(th); vx += l * w * Math.cos(th); vy -= l * w * Math.sin(th);
    out.push({ m: p[`m${i + 1}`], py, vx, vy });
  }
  return { v, out };
}
const chainEnergy = (p, X) => { const { v, out } = chainBodies(p, X); return 0.5 * p.M * v * v + out.reduce((s, b) => s + b.m * (0.5 * (b.vx ** 2 + b.vy ** 2) + p.g * b.py), 0); };
const chainMomentum = (p, X) => { const { v, out } = chainBodies(p, X); return p.M * v + out.reduce((s, b) => s + b.m * b.vx, 0); };

function drift(type, p, X0, energy, momentum, T = 5) {
  let e0 = null, m0 = null, de = 0, dm = 0;
  run(type, p, { T, X0, watch: (t, X) => { const e = energy(p, X), m = momentum(p, X); e0 ??= e; m0 ??= m; de = Math.max(de, Math.abs(e - e0)); dm = Math.max(dm, Math.abs(m - m0)); } });
  return { de, dm, e0 };
}

test('cart–pole without friction or force keeps its energy and horizontal momentum', () => {
  const p = params('cartPole', { b: 0 });
  for (const X0 of [[0, 0, 2.5, 0], [0, 0.7, Math.PI - 0.3, 4], [0, -1, 0.1, -2]]) {
    const { de, dm } = drift('cartPole', p, X0, cpEnergy, cpMomentum);
    assert.ok(de < 1e-7, `energy drift ${de}`);
    assert.ok(dm < 1e-9, `momentum drift ${dm}`);
  }
});

test('cart–pole: friction only takes energy out, and a force changes momentum by its impulse', () => {
  const p = params('cartPole', { b: 0.5 });
  let prev = Infinity, rose = 0;
  run('cartPole', p, { T: 5, X0: [0, 1, 2, 3], watch: (t, X) => { const e = cpEnergy(p, X); if (e > prev + 1e-12) rose++; prev = e; } });
  assert.equal(rose, 0, 'energy rose under friction alone');
  const q = params('cartPole', { b: 0 }), F = 3;
  const X = run('cartPole', q, { T: 2, X0: [0, 0, 2, 0], u: () => F });
  assert.ok(Math.abs(cpMomentum(q, X) - F * 2) < 1e-8);
});

test('a hanging pole swings at the textbook frequency √(g (M + m) / (M l))', () => {
  const p = params('cartPole', { b: 0 });
  const crossings = [];
  let last = 0;
  run('cartPole', p, { T: 10, h: 2e-4, X0: [0, 0, Math.PI + 1e-3, 0], watch: (t, X) => { const d = X[2] - Math.PI; if (last < 0 && d >= 0) crossings.push(t); last = d; } });
  const period = (crossings.at(-1) - crossings[0]) / (crossings.length - 1);
  const expected = 2 * Math.PI / Math.sqrt((p.g * (p.M + p.m)) / (p.M * p.l));
  assert.ok(Math.abs(period - expected) / expected < 1e-3, `${period} vs ${expected}`);
});

test('pushed with a constant force, a pole that trails at atan(a/g) stays there while everything accelerates at F/(M + m)', () => {
  // What the pendulum example shows with a saturated controller: in the
  // accelerating cart's frame "down" leans back, and the pole swings about that.
  const p = params('cartPole', { b: 0 }), F = 25, a = F / (p.M + p.m), th = Math.PI + Math.atan(a / p.g);
  let worst = 0;
  const X = run('cartPole', p, { T: 2, X0: [0, 0, th, 0], u: () => F, watch: (t, x) => { worst = Math.max(worst, Math.abs(x[2] - th)); } });
  assert.ok(worst < 1e-6, `pole moved ${worst} rad`);
  assert.ok(Math.abs(X[0] - 0.5 * a * 4) < 1e-6, `x = ${X[0]}`);
});

test('pendulum chains of 1–3 rods keep energy and horizontal momentum', () => {
  for (const links of [1, 2, 3]) {
    const p = params('pendulumCart', { links, b: 0, m1: 0.3, m2: 0.2, m3: 0.1, l1: 0.4, l2: 0.3, l3: 0.25 });
    const X0 = [0, ...[2.8, -1, 0.5].slice(0, links), 0.3, ...[1, -2, 3].slice(0, links)];
    const { de, dm, e0 } = drift('pendulumCart', p, X0, chainEnergy, chainMomentum);
    assert.ok(de < 1e-6 * Math.max(1, Math.abs(e0)), `${links} links: energy drift ${de}`);
    assert.ok(dm < 1e-7, `${links} links: momentum drift ${dm}`);   // RK4 truncation, not physics
  }
});

test('a chain of one rod moves as the cart–pole with the same masses', () => {
  const cp = params('cartPole', { b: 0.1, M: 1, m: 0.2, l: 0.5 });
  const ch = params('pendulumCart', { links: 1, b: 0.1, M: 1, m1: 0.2, l1: 0.5 });
  const u = (t) => 3 * Math.sin(5 * t);
  const A = run('cartPole', cp, { T: 3, X0: [0, 0, 2, 0], u });
  const B = run('pendulumCart', ch, { T: 3, X0: [0, 2, 0, 0], u });
  // [x, v, θ, ω] against [x, θ, v, ω]
  for (const [i, j] of [[0, 0], [1, 2], [2, 1], [3, 3]]) assert.ok(Math.abs(A[i] - B[j]) < 1e-9, `state ${i}: ${A[i]} vs ${B[j]}`);
});

test('the conical tank keeps its water: volume in equals volume stored, never below empty or above full', () => {
  const p = { ...conicalTank().params, a: 0, h0: 0 }, q = 0.02;
  const vol = (h) => { const r = p.r0 + ((p.R - p.r0) * h) / p.H; return (Math.PI * h * (p.r0 * p.r0 + p.r0 * r + r * r)) / 3; };
  let X = run(conicalTank(p), p, { T: 2, u: () => q });
  assert.ok(Math.abs(vol(X[0]) - q * 2) < 1e-9, `${vol(X[0])} vs ${q * 2}`);
  // Filled far beyond its volume, it overflows at H; drained, it stops at 0.
  // The level it reports (its output) stays inside the tank.
  const level = (pp, x) => compiled(conicalTank(pp)).y(0, x);
  X = run(conicalTank(p), p, { T: 60, h: 1e-2, u: () => 1 });
  assert.ok(X[0] < p.H + 1e-2, `state ${X[0]} ran past the overflow`);
  assert.equal(level(p, X), p.H);
  const d = { ...conicalTank().params, h0: 0.5 };
  X = run(conicalTank(d), d, { T: 60, h: 1e-3 });
  assert.ok(level(d, X) >= 0 && level(d, X) < 1e-3, `h = ${level(d, X)}`);
});

test("the System library's pictures draw the state as it is (no clamped positions)", () => {
  for (const e of SYSTEM_LIBRARY) {
    const views = e.plant?.views ?? [];
    const text = JSON.stringify(views);
    assert.ok(!/clamp\(/.test(text), `${e.name}: a view clamps a position, so it can show what the model does not do`);
  }
});

test("the mass–spring–damper's energies on the scope balance the work done and the damper's loss", async () => {
  const { SYSTEM_PARTS, applySystem } = await import('../src/core/systems.js');
  const { normalizeProject, evaluateSystem, autoTimebase } = await import('../src/core/project.js');
  const { DEFAULT_PROJECT } = await import('../src/core/examples.js');
  const entry = SYSTEM_LIBRARY.find((e) => e.name.startsWith('Mass–spring–damper'));
  const p = normalizeProject(applySystem(DEFAULT_PROJECT, entry, SYSTEM_PARTS));
  p.scope.timebase = autoTimebase(p);
  const { t, signals: s } = evaluateSystem(p);
  const c = 0.5, dt = t[1] - t[0];
  let work = 0;
  for (let k = 1; k < t.length; k++) {
    const pw = (j) => s.F[j] * s.v[j] - c * s.v[j] ** 2;
    work += 0.5 * dt * (pw(k - 1) + pw(k));
    const E = s.Ekin[k] + s.Epot[k], E0 = s.Ekin[0] + s.Epot[0];
    assert.ok(Math.abs(E - E0 - work) < 2e-4 * Math.max(1e-3, Math.abs(E)) + 1e-6, `t ${t[k]}: E ${E} vs work ${work}`);
  }
  assert.ok(Math.abs(s.Ekin[100] - 0.5 * s.v[100] ** 2) < 1e-12 && Math.abs(s.Epot[100] - 0.5 * 25 * s.x[100] ** 2) < 1e-12);
});

test('a Dead time delays its input by exactly L: a held u, and a smooth one', async () => {
  const { simulateSystem } = await import('../src/core/sim.js');
  // A Controller's u is held between its samples: it steps at 0.04 s, comes
  // out of a 0.1 s dead time at 0.14 s, and integrates to 0.16 by 0.3 s. The
  // history was interpolated across each integration step, which moved the
  // step half a step early (0.170 at a 20 ms step, 0.1625 at 5 ms).
  const held = {
    blocks: [
      { id: 'r', type: 'source', params: { signal: 'r', unit: '1' } },
      { id: 'c', type: 'controller', params: { inputs: 2, Ts: 0.02 }, variants: [{ name: 'P', type: 'pid', params: { Kp: 1 } }] },
      { id: 'del', type: 'delay', params: { L: 0.1, y0: 0 } },
      { id: 'int', type: 'integrator', params: { K: 1 } },
      { id: 'y', type: 'sink', params: { name: 'y', unit: '1' } },
    ],
    wires: [{ from: 'r', to: 'c' }, { from: 'c', to: 'del' }, { from: 'del', to: 'int' }, { from: 'int', to: 'y' }],
  };
  const step = { r: { period: 5, components: [{ type: 'step', params: { amplitude: 1, time: 0.04 } }] } };
  for (const sampleTime of [0.02, 0.005]) {
    const res = simulateSystem(held, step, { duration: 0.4, sampleTime });
    const at = (t) => res.signals.y[res.t.findIndex((x) => x >= t - 1e-9)];
    assert.ok(Math.abs(at(0.3) - 0.16) < 1e-9, `step ${sampleTime}: ${at(0.3)}, not 0.16`);
    assert.ok(Math.abs(at(0.14)) < 1e-9, `step ${sampleTime}: nothing before 0.14 s (${at(0.14)})`);
  }
  // A smooth input (a ramp from a Source) comes out the same ramp L later.
  const ramp = {
    blocks: [
      { id: 'r', type: 'source', params: { signal: 'r', unit: '1' } },
      { id: 'del', type: 'delay', params: { L: 0.1, y0: 0 } },
      { id: 'int', type: 'integrator', params: { K: 1 } },
      { id: 'y', type: 'sink', params: { name: 'y', unit: '1' } },
    ],
    wires: [{ from: 'r', to: 'del' }, { from: 'del', to: 'int' }, { from: 'int', to: 'y' }],
  };
  const res = simulateSystem(ramp, { r: { period: 5, components: [{ type: 'ramp', params: { amplitude: 1, time: 0, rise: 1 } }] } }, { duration: 0.4, sampleTime: 0.01 });
  const k = res.t.findIndex((x) => x >= 0.3 - 1e-9);
  // ∫ from 0.1 to 0.3 of (t − 0.1) dt = 0.02
  assert.ok(Math.abs(res.signals.y[k] - 0.02) < 1e-9, `ramp: ${res.signals.y[k]}, not 0.02`);
  // The older loop (a project with candidates: controller, actuator, plant
  // with its dead time, sensor) took its record before the new u, so its
  // held step came half a step late (0.150 at Ts = 20 ms).
  const { simulate } = await import('../src/core/sim.js');
  const { normalizeReference } = await import('../src/core/signals.js');
  const loop = {
    reference: normalizeReference(step.r),
    controller: { type: 'PID', params: { Kp: 1, Ki: 0, Kd: 0, Tf: 0.05, b: 1, c: 0 } },
    actuator: { type: 'ideal', params: {} }, disturbance: { type: 'none', params: {} },
    plant: { type: 'tf', params: { num: [1], den: [1, 0], delay: 0.1 } },
    sensor: { type: 'ideal', params: {} }, noise: { type: 'none', params: {} },
  };
  for (const Ts of [0.02, 0.005]) {
    const v1 = simulate(loop, { duration: 0.4, sampleTime: Ts }, { openLoop: true });
    assert.ok(Math.abs(v1.y[Math.round(0.3 / Ts)] - 0.16) < 1e-9, `older loop, Ts ${Ts}: ${v1.y[Math.round(0.3 / Ts)]}, not 0.16`);
  }
});

test('the conical tank drains when more is drawn off than pumped in, until it is empty', () => {
  // The tank takes the net flow q (pump less draw-off): a draw-off above the
  // pump's flow was dropped (max(0, q)).
  const p = { ...conicalTank().params, a: 0, h0: 0.5 }, q = -0.01;
  const vol = (h) => { const r = p.r0 + ((p.R - p.r0) * h) / p.H; return (Math.PI * h * (p.r0 * p.r0 + p.r0 * r + r * r)) / 3; };
  let X = run(conicalTank(p), p, { T: 2, u: () => q });
  assert.ok(Math.abs(vol(0.5) - vol(X[0]) - 0.02) < 1e-9, `drained ${vol(0.5) - vol(X[0])} m³, not 0.02`);
  X = run(conicalTank(p), p, { T: 60, h: 1e-2, u: () => q });
  const y = compiled(conicalTank(p)).y(0, X);
  assert.ok(y >= 0 && y < 1e-3, `empty, not below: h = ${y}`);
});
