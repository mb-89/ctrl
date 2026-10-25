// The physics blocks' rate functions and the plant a block sees (model mode):
// design/output/designs.md, tests 1 and 2 of designs-in-the-page.md §11.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ELEMENTS, normalizeDiagram, compileDiagram, blockInputNames } from '../src/core/diagram.js';
import { EXAMPLE_PLANTS } from '../src/core/plants.js';
import { CONTROLLERS } from '../src/core/controllers.js';
import { simulateSystem } from '../src/core/sim.js';
import { normalizeReference } from '../src/core/signals.js';

// Seeded uniform numbers (mulberry32), so a failure can be reproduced.
function rng(seed) {
  let a = seed >>> 0;
  return (lo = 0, hi = 1) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return lo + (hi - lo) * (((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}

// The rate functions as they were before ode.make (straight from the
// equations, Gaussian elimination with pivoting): the reference.
const REFERENCE = {
  cartPole(X, u, p, dX) {
    const v = X[1], th = X[2], w = X[3];
    const s = Math.sin(th), c = Math.cos(th);
    const a = (u - p.b * v + p.m * p.l * w * w * s - p.m * p.g * s * c) / (p.M + p.m * s * s);
    dX[0] = v; dX[1] = a; dX[2] = w; dX[3] = (p.g * s - a * c) / p.l;
  },
  pendulumCart(X, u, p, dX) {
    const n = p.links, N = n + 1;
    const m = [], l = [], mu = [], th = [], w = [];
    for (let i = 0; i < n; i++) { m[i] = p[`m${i + 1}`]; l[i] = p[`l${i + 1}`]; th[i] = X[1 + i]; w[i] = X[n + 2 + i]; }
    for (let i = n - 1, acc = 0; i >= 0; i--) { acc += m[i]; mu[i] = acc; }
    const A = Array.from({ length: N }, () => new Array(N + 1).fill(0));
    A[0][0] = p.M + mu[0];
    A[0][N] = u - p.b * X[n + 1];
    for (let j = 0; j < n; j++) {
      A[0][j + 1] = A[j + 1][0] = mu[j] * l[j] * Math.cos(th[j]);
      A[0][N] += mu[j] * l[j] * Math.sin(th[j]) * w[j] * w[j];
      let r = mu[j] * p.g * l[j] * Math.sin(th[j]);
      for (let k = 0; k < n; k++) {
        const mk = mu[Math.max(j, k)] * l[j] * l[k];
        A[j + 1][k + 1] = mk * Math.cos(th[j] - th[k]);
        r -= mk * Math.sin(th[j] - th[k]) * w[k] * w[k];
      }
      A[j + 1][N] = r;
    }
    for (let c = 0; c < N; c++) {
      let piv = c;
      for (let r = c + 1; r < N; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]];
      for (let r = c + 1; r < N; r++) { const f = A[r][c] / A[c][c]; for (let k = c; k <= N; k++) A[r][k] -= f * A[c][k]; }
    }
    const q = new Array(N);
    for (let r = N - 1; r >= 0; r--) { let s = A[r][N]; for (let k = r + 1; k < N; k++) s -= A[r][k] * q[k]; q[r] = s / A[r][r]; }
    dX[0] = X[n + 1];
    for (let j = 0; j < n; j++) { dX[1 + j] = w[j]; dX[n + 2 + j] = q[j + 1]; }
    dX[n + 1] = q[0];
  },
  // It cannot run dry below 0 or hold more than H: beyond the brim it overflows.
  conicalTank(X, u, p, dX) {
    const h = Math.min(p.H, Math.max(0, X[0]));
    const r = p.r0 + ((p.R - p.r0) * h) / p.H;
    const flow = u - p.a * Math.sqrt(2 * p.g * h);
    dX[0] = (h <= 0 && flow < 0) || (h >= p.H && flow > 0) ? 0 : flow / (Math.PI * r * r);
  },
};

// A block's parameters as the diagram normalises them.
const paramsOf = (type, params) => normalizeDiagram({ blocks: [{ id: 'b', type, params }], wires: [] }).blocks[0].params;

test('physics: ode.make equals the equations on 1000 seeded states; states are labelled', () => {
  const cases = [
    ['cartPole', paramsOf('cartPole', { M: 1, m: 0.2, l: 0.5, b: 0.1 })],
    ['pendulumCart', paramsOf('pendulumCart', { links: 1, M: 1.3, m1: 0.4, l1: 0.6, b: 0.2 })],
    ['pendulumCart', paramsOf('pendulumCart', { links: 2, M: 0.8, m1: 0.2, l1: 0.3, m2: 0.15, l2: 0.25 })],
    ['pendulumCart', paramsOf('pendulumCart', { links: 3, M: 1, m1: 0.1, l1: 0.25, m2: 0.1, l2: 0.25, m3: 0.1, l3: 0.25, b: 0.1 })],
    ['conicalTank', paramsOf('conicalTank', { r0: 0.05, R: 0.5, H: 1, a: 0.1 })],
  ];
  const rand = rng(42);
  for (const [type, p] of cases) {
    const { ode } = ELEMENTS[type];
    const n = typeof ode.n === 'function' ? ode.n(p) : ode.n;
    const f = ode.make(p), o = 3;   // an offset, as inside a larger diagram
    const X = new Float64Array(n + o), dX = new Float64Array(n + o), ref = new Float64Array(n);
    const states = ode.states(p);
    assert.equal(states.length, n);
    for (let trial = 0; trial < 1000; trial++) {
      for (let i = 0; i < n; i++) X[o + i] = states[i].angle ? rand(-2 * Math.PI, 2 * Math.PI) : states[i].unit === 'm' ? rand(-1.2, 1.2) : rand(-8, 8);
      const u = rand(-40, 40);
      f(X, o, u, dX);
      REFERENCE[type](X.subarray(o), u, p, ref);
      const scale = Math.max(1, ...ref.map(Math.abs));
      for (let i = 0; i < n; i++) assert.ok(Math.abs(dX[o + i] - ref[i]) <= 1e-12 * scale, `${type} (${p.links ?? ''}) state ${states[i].name}: ${dX[o + i]} vs ${ref[i]}`);
    }
  }
  const label = (type, p) => ELEMENTS[type].ode.states(p).map((s) => `${s.name}${s.angle ? '∠' : ''}`).join(' ');
  assert.equal(label('cartPole', cases[0][1]), 'x v θ∠ ω');
  assert.equal(label('pendulumCart', cases[3][1]), 'x θ1∠ θ2∠ θ3∠ v ω1 ω2 ω3');
  assert.equal(label('conicalTank', cases[4][1]), 'h');
  assert.deepEqual(ELEMENTS.cartPole.ode.states(cases[0][1]).map((s) => s.unit), ['m', 'm/s', 'rad', 'rad/s']);
});

// A library system's diagram, normalised, to change freely.
const system = (name) => normalizeDiagram(structuredClone(EXAMPLE_PLANTS.find((e) => e.name.startsWith(name)).diagram));
const modelOf = (d, id = 'ctrl', at) => compileDiagram(d, 'plant', { mode: 'model' }).seen(id, at);
// A, B of a Model by central differences at (x, u).
function jacobian(mdl, x, u) {
  const n = mdl.n, xs = Float64Array.from(x), fp = new Float64Array(n), fm = new Float64Array(n);
  const A = Array.from({ length: n }, () => new Array(n).fill(0)), B = new Array(n).fill(0), h = 1e-6;
  for (let j = 0; j < n; j++) {
    xs[j] = x[j] + h; mdl.f(xs, u, fp);
    xs[j] = x[j] - h; mdl.f(xs, u, fm);
    xs[j] = x[j];
    for (let i = 0; i < n; i++) A[i][j] = (fp[i] - fm[i]) / (2 * h);
  }
  mdl.f(xs, u + h, fp); mdl.f(xs, u - h, fm);
  for (let i = 0; i < n; i++) B[i] = (fp[i] - fm[i]) / (2 * h);
  return { A, B };
}
const block = (id, type, params = {}, extra = {}) => ({ id, type, params, ...extra });
const wire = (from, to) => ({ from, to });

test('model mode: the plant a block sees, reduced to what u moves and the measurements show', () => {
  // Cart–pole: states x, v, θ, ω; measurements x, θ, v, ω; A and B at the
  // upright origin equal the analytic Jacobian (with friction).
  const pend = system('Pendulum swing-up');
  const { M, m, l, g, b } = pend.blocks.find((x) => x.type === 'cartPole').params;
  const cp = modelOf(pend);
  assert.deepEqual(cp.states.map((s) => s.name), ['x', 'v', 'θ', 'ω']);
  assert.deepEqual(cp.states.map((s) => s.label), ['x', 'v', 'θ', 'ω'].map((s) => `cart and pole.${s}`));
  assert.deepEqual(cp.outputs.map((o) => o.label), ['x', 'θ', 'v', 'ω']);
  assert.deepEqual(cp.outputs.map((o) => o.angle), [false, true, false, false]);
  assert.equal(cp.input.label, 'F');
  assert.deepEqual(Array.from(cp.x0), [0, 0, Math.PI, 0], 'it starts hanging');
  const { A, B } = jacobian(cp, [0, 0, 0, 0], 0);
  const Aref = [[0, 1, 0, 0], [0, -b / M, -m * g / M, 0], [0, 0, 0, 1], [0, b / (M * l), (g * (M + m)) / (M * l), 0]];
  const Bref = [0, 1 / M, 0, -1 / (M * l)];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) assert.ok(Math.abs(A[i][j] - Aref[i][j]) < 1e-6, `A[${i}][${j}] = ${A[i][j]}, not ${Aref[i][j]}`);
    assert.ok(Math.abs(B[i] - Bref[i]) < 1e-6, `B[${i}] = ${B[i]}, not ${Bref[i]}`);
  }
  assert.deepEqual(cp.warnings, []);
  const pel = compileDiagram(pend, 'plant', { mode: 'model' });
  assert.equal(pel.seen('ctrl'), pel.seen('ctrl', { held: {} }), 'memoised per block and operating point');
  assert.notEqual(pel.seen('ctrl'), pel.seen('ctrl', { sources: { d: 1 } }));

  // Motor position: armature (its state the current i), rotor (the speed)
  // and angle are kept; an integrator fed by a Source and one that only
  // feeds a Sink are dropped.
  const motor = system('DC motor');
  motor.blocks.push(block('drift', 'integrator', { K: 1 }), block('dsum', 'sink', { name: 'dsum' }), block('odo', 'integrator', { K: 1 }), block('turns', 'sink', { name: 'turns' }));
  motor.wires.push(wire('d', 'drift'), wire('drift', 'dsum'), wire('motor:3', 'odo'), wire('odo', 'turns'));
  const mm = modelOf(normalizeDiagram(motor));
  assert.deepEqual(mm.states.map((s) => s.label), ['Motor/armature 1/(L·s + R)', 'Motor/rotor 1/Jm', 'Motor/rotor angle']);
  assert.deepEqual(mm.outputs.map((o) => o.label), ['θ measured (Motor)']);
  const dx = new Float64Array(3), y = new Float64Array(1);
  mm.f([0, 0, 0], 1, dx);
  assert.deepEqual(Array.from(dx), [100, 0, 0], 'the armature 1/(Ls + R) with L = 10 mH, R = 1 Ω, C = 1');
  mm.y([0, 0, 0.7], 0, y);
  assert.equal(y[0], 0.7, 'a first-order block is realised with C = 1: its state is its output');
  // The same state order in a run, so a snapshot fits; the rotor's state is the speed.
  const run = compileDiagram(normalizeDiagram(motor), 'plant', { standalone: true });
  assert.deepEqual(run.states, compileDiagram(normalizeDiagram(motor), 'plant', { mode: 'model' }).states);
  const X = new Float64Array(run.n).map((_, i) => 0.1 * (i + 1));
  run.eval(0, X, 0, 0, null);
  const probe = Object.fromEntries(run.probes());
  assert.equal(probe.speed, X[mm.states[1].index]);
  assert.equal(probe.angle, X[mm.states[2].index]);
  assert.deepEqual(Array.from(modelOf(normalizeDiagram(motor), 'ctrl', { X }).x0), [0.1, 0.2, 0.3].map((v, i) => X[mm.states[i].index]), 'a snapshot is the base state');

  // Tank: the pipe's dead time passes straight through and is reported.
  const tank = modelOf(system('Conical tank'));
  assert.deepEqual(tank.states.map((s) => s.label), ['tank.h']);
  assert.deepEqual(tank.delay, [0.1]);
  assert.deepEqual(Array.from(tank.x0), [0.15]);

  // A quantizer is the identity and noise adds 0; both go into the sensor
  // of the measurement they sit on (what the Kalman filter's R is made of),
  // not into the notes.
  const sensed = normalizeDiagram({
    blocks: [block('r', 'source', { signal: 'r' }), block('c', 'controller', { inputs: 2, Ts: 0.01 }, { variants: [{ type: 'pid' }] }),
      block('p', 'integrator', { K: 1 }, { name: 'plant' }), block('q', 'quantizer', { q: 0.25 }, { name: 'encoder' }), block('n', 'noise', { std: 0.01, seed: 3 }, { name: 'jitter' }),
      block('y', 'sink', { name: 'y' })],
    wires: [wire('r', 'c'), wire('c', 'p'), wire('p', 'q'), wire('q', 'n'), wire('n', 'c:1'), wire('n', 'y')],
  });
  const sm = modelOf(sensed, 'c');
  sm.y([0.3], 0, y);
  assert.equal(y[0], 0.3);
  assert.deepEqual(sm.sensors, [{ std: 0.01, q: 0.25, parts: ["quantizer 'encoder' step 0.25", "noise 'jitter' σ 0.01"] }]);
  assert.ok(!sm.warnings.some((w) => /encoder|jitter/.test(w)), sm.warnings.join('; '));
  // Each counts with what reaches the measurement: a unit conversion after
  // the noise scales its σ, one before the quantizer its step. Noise on the
  // way in (a push on the plant) is on no measurement's way: a note.
  const scaled = normalizeDiagram({
    blocks: [block('r', 'source', { signal: 'r' }), block('c', 'controller', { inputs: 2, Ts: 0.01 }, { variants: [{ type: 'pid' }] }),
      block('w', 'noise', { std: 0.3, seed: 1 }, { name: 'push' }), block('p', 'firstOrder', { K: 1, tau: 1 }, { name: 'plant' }),
      block('n', 'noise', { std: 0.05, seed: 3 }, { name: 'jitter' }), block('k', 'gain', { K: 1000 }, { name: 'to mm' }),
      block('q', 'quantizer', { q: 0.01 }, { name: 'encoder' }), block('h', 'gain', { K: 0.5 }, { name: 'half' }), block('y', 'sink', { name: 'y' })],
    wires: [wire('r', 'c'), wire('c', 'w'), wire('w', 'p'), wire('p', 'n'), wire('n', 'k'), wire('k', 'q'), wire('q', 'h'), wire('h', 'c:1'), wire('h', 'y')],
  });
  const sc = modelOf(scaled, 'c');
  assert.ok(Math.abs(sc.sensors[0].std - 25) < 1e-6, `σ ${sc.sensors[0].std}: 0.05 × 1000 × 0.5`);
  assert.ok(Math.abs(sc.sensors[0].q - 0.005) < 1e-12, `q ${sc.sensors[0].q}: 0.01 × 0.5`);
  assert.deepEqual(sc.sensors[0].parts, ["noise 'jitter' σ 0.05 × 500", "quantizer 'encoder' step 0.01 × 0.5"]);
  assert.ok(sc.warnings.some((w) => /^noise 'push' adds 0 in the model \(σ 0\.3\): it is on no measurement's way$/.test(w)), sc.warnings.join('; '));

  // Two Controllers on one plant: each one's model holds the other's output.
  const two = normalizeDiagram({
    blocks: [block('r', 'source', { signal: 'r' }), block('c1', 'controller', { inputs: 2, Ts: 0.01 }, { name: 'first', variants: [{ type: 'pid' }] }),
      block('c2', 'controller', { inputs: 2, Ts: 0.01 }, { name: 'second', variants: [{ type: 'pid' }] }), block('s', 'sum', { signs: '++' }), block('p', 'integrator'), block('y', 'sink', { name: 'y' })],
    wires: [wire('r', 'c1'), wire('r', 'c2'), wire('c1', 's'), wire('c2', 's:1'), wire('s', 'p'), wire('p', 'y'), wire('p', 'c1:1'), wire('p', 'c2:1')],
  });
  const second = modelOf(two, 'c2');
  const d1 = new Float64Array(1);
  second.f([0], 0, d1); assert.equal(d1[0], 0, 'the first holds 0');
  second.f([0], 1, d1); assert.equal(d1[0], 1);
  assert.ok(second.warnings.some((w) => /controller 'first' holds its output at 0/.test(w)), second.warnings.join('; '));
  modelOf(two, 'c2', { held: { c1: 0.5 } }).f([0], 0, d1);
  assert.equal(d1[0], 0.5, 'or its value at a snapshot');

  // laws: false makes no laws (the Plant tab's check never designs); model mode neither.
  const make = CONTROLLERS.pid.make;
  let made = 0;
  CONTROLLERS.pid.make = (...a) => { made++; return make(...a); };
  try {
    const d = system('DC motor');
    compileDiagram(d, 'plant', { standalone: true, laws: false });
    compileDiagram(d, 'plant', { mode: 'model' }).seen('ctrl');
    assert.equal(made, 0);
    compileDiagram(d, 'plant', { standalone: true });
    assert.equal(made, 1);
  } finally { CONTROLLERS.pid.make = make; }
  const quiet = compileDiagram(system('DC motor'), 'plant', { standalone: true, laws: false, sources: { r: () => 2, d: () => 0 } });
  const X0 = new Float64Array(quiet.n);
  quiet.eval(0, X0, 0, 0, null); quiet.sample(0, X0, 0, 0);
  assert.equal(Object.fromEntries(quiet.probes()).V, 0, 'a block without a law puts out 0');
});

test('model mode: observers, dead times on the way, saturation, input names, Dead time output before L', () => {
  // A double integrator; an Observer sees u and x, and the Controller feeds back its estimate x̂1.
  const d = normalizeDiagram({
    blocks: [block('r', 'source', { signal: 'r' }), block('c', 'controller', { inputs: 2, Ts: 0.01 }, { name: 'ctl', variants: [{ type: 'pid' }] }),
      block('v', 'integrator', {}, { name: 'speed' }), block('x', 'integrator', {}, { name: 'position' }),
      block('o', 'observer', { inputs: 2, outputs: 2, Ts: 0.01 }, { name: 'obs' }), block('xs', 'sink', { name: 'xs' })],
    wires: [wire('r', 'c'), wire('c', 'v'), wire('v', 'x'), wire('x', 'xs'), wire('c', 'o'), wire('x', 'o:1'), wire('o', 'c:1')],
  });
  const el = compileDiagram(d, 'plant', { mode: 'model' });
  const om = el.seen('o');
  assert.equal(om.kind, 'observer');
  assert.deepEqual(om.states.map((s) => s.label), ['speed', 'position'], 'the observer sees u → x');
  assert.deepEqual(om.outputs.map((o) => o.label), ['position']);
  const held = el.seen('c');
  assert.equal(held.n, 0);
  assert.ok(held.warnings.some((w) => /estimates of 'obs' are held/.test(w)), held.warnings.join('; '));
  assert.ok(held.warnings.some((w) => /reaches none of the measurements/.test(w)), held.warnings.join('; '));
  const through = el.seen('c', { seeThrough: new Map([['o', [om.states[1].index, om.states[0].index]]]) });
  assert.deepEqual(through.states.map((s) => s.label), ['speed', 'position'], 'looking through, x̂1 is the position');
  const y = new Float64Array(1);
  through.y([2, 3], 0, y);
  assert.equal(y[0], 3);
  assert.deepEqual(through.warnings, []);
  assert.throws(() => compileDiagram(normalizeDiagram({ blocks: [block('o', 'observer', { inputs: 2, outputs: 1 })], wires: [] }), 'plant', { mode: 'model' }).seen('o'), /input 1 \(u\)/);

  // Dead time after a state adds up; dead time on one of two parallel paths is left out, with a warning.
  const lagged = normalizeDiagram({
    blocks: [block('r', 'source', { signal: 'r' }), block('c', 'controller', { inputs: 3, Ts: 0.01 }, { variants: [{ type: 'pid' }] }),
      block('p', 'integrator'), block('L', 'delay', { L: 0.3 }), block('L2', 'delay', { L: 0.2 }), block('s', 'sum', { signs: '++' }), block('q', 'firstOrder', { K: 1, tau: 0.5 }),
      block('sat', 'saturation', { min: -1, max: 1 }, { name: 'limit' })],
    wires: [wire('r', 'c'), wire('c', 'sat'), wire('sat', 'p'), wire('p', 'L'), wire('L', 'c:1'), wire('c', 'L2'), wire('L2', 's'), wire('c', 's:1'), wire('s', 'q'), wire('q', 'c:2')],
  });
  const lm = modelOf(lagged, 'c');
  assert.deepEqual(lm.delay, [0.3, 0]);
  assert.ok(lm.warnings.some((w) => /differs between paths \(0 to 0\.2 s\)/.test(w)), lm.warnings.join('; '));
  assert.equal(lm.atLimits([0, 0], 0.5).length, 0);
  assert.match(lm.atLimits([0, 0], 2)[0], /'limit' is saturated at the operating point/);

  // What feeds each input, as the Controller tab shows it.
  assert.deepEqual(blockInputNames(system('Pendulum swing-up'), 'ctrl'), ['r', 'x', 'θ', 'v', 'ω']);
  assert.deepEqual(blockInputNames(system('DC motor'), ['ctrl']), ['r', 'θ measured (Motor)']);
  assert.deepEqual(blockInputNames(d, 'o'), ['ctl', 'position']);

  // Dead time with an empty output before L: its input at t = 0 (a pipe already flowing).
  const pipe = (y0) => normalizeDiagram({ blocks: [block('r', 'source', { signal: 'r' }), block('L', 'delay', { L: 0.1, y0 }), block('y', 'sink', { name: 'y' })], wires: [wire('r', 'L'), wire('L', 'y')] });
  assert.equal(pipe(null).blocks[1].params.y0, null);
  assert.equal(pipe('').blocks[1].params.y0, null);
  assert.equal(pipe(undefined).blocks[1].params.y0, 0, 'missing: the default 0');
  assert.equal(JSON.parse(JSON.stringify(pipe(null))).blocks[1].params.y0, null);
  const r = { r: normalizeReference({ period: 10, components: [{ type: 'dc', params: { level: 1 } }, { type: 'step', params: { amplitude: 1, time: 0.05 } }] }) };
  const out = (y0) => simulateSystem(pipe(y0), r, { duration: 0.3, sampleTime: 0.01 }).signals.y;
  assert.deepEqual([5, 12, 20].map((k) => out(null)[k]), [1, 1, 2]);
  assert.deepEqual([5, 12, 20].map((k) => out(0)[k]), [0, 1, 2]);
  const tankPipe = EXAMPLE_PLANTS.find((e) => e.name.startsWith('Conical')).diagram.blocks.find((x) => x.id === 'pipe');
  assert.equal(tankPipe.params.y0, null, 'the tank keeps no start flow');
});
