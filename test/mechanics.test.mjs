// Mechanics parts (design/output/transparent-models.md §1.1), held to the
// tests of §8.2: the fast form against a general Jacobian solver
// (mech-oracle.mjs), energy, the Christoffel terms, textbook results, the
// hinge torque's reaction, and every refusal with its sentence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDiagram, compileDiagram } from '../src/core/diagram.js';
import { oracle } from './mech-oracle.mjs';

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

// A diagram of parts, normalised (wires: In → part inputs); an Out reads the
// first joint's coordinate.
const part = (id, type, params = {}) => ({ id, type, params });
function level(blocks, joins, wires = []) {
  const joint = blocks.find((b) => b.type === 'rail' || b.type === 'hinge');
  const out = joint ? [part('out', 'outport', { port: 1 })] : [];
  return normalizeDiagram({ blocks: [...blocks, ...out], wires: [...wires, ...(joint ? [{ from: joint.id, to: 'out' }] : [])], joins });
}
const compile = (d) => compileDiagram(d);
// The compiled mechanism: { el, ode, n, f(X, u, dX) } (its In is u).
function mech(d) {
  const el = compile(d), [m] = el.mechanisms;
  assert.equal(m.offset, 0);
  return { el, ode: m.ode, N: m.ode.n / 2, f: (X, u, dX) => el.eval(0, X, 0, u, dX) };
}

// A random mechanism: 0–2 rails (inclined, on the World, a rail or a fixed
// rod), 0–4 hinges on any frame (branches: two hinges on a frame, two rods on
// a hinge), uniform and tip rods, masses, friction, damping, inputs (each
// through a Gain from the one In), blocks shuffled. { d, gains }.
function randomMechanism(r) {
  const int = (lo, hi) => Math.floor(r(lo, hi + 1));
  const pick = (list) => list[Math.floor(r() * list.length)];
  const blocks = [part('w', 'world', { g: r(5, 15) })], frames = [{ ports: ['w:W'], turns: false }];
  const add = (b, at, made) => { blocks.push(b); at.ports.push(`${b.id}:${made[0]}`); return made.slice(1).map((P) => { const f = { ports: [`${b.id}:${P}`], turns: at.turns }; frames.push(f); return f; }); };
  let nr = int(0, 2), nh = int(0, 4);
  if (nr + nh === 0) nh = 1;
  const order = [...Array(nr).fill('rail'), ...Array(nh).fill('hinge')];
  let k = 0;
  for (const kind of order.sort(() => r() - 0.5)) {
    k++;
    if (kind === 'rail') {
      let base = pick(frames.filter((f) => !f.turns));
      if (r() < 0.25) [base] = add(part(`fixed${k}`, 'rod', { l: r(0.2, 1), m: r() < 0.5 ? 0 : r(0.1, 1) }), base, ['B', 'T']);
      const [fol] = add(part(`rail${k}`, 'rail', { name: `x${k}`, rate: `v${k}`, b: r() < 0.5 ? 0 : r(0, 2), incline: r(-1.2, 1.2), force: r() < 0.7 ? 1 : 0 }), base, ['B', 'F']);
      add(part(`cart${k}`, 'mass', { m: r(0.3, 3) }), fol, ['F']);
    } else {
      const base = pick(frames), [fol] = add(part(`hinge${k}`, 'hinge', { name: `θ${k}`, rate: `ω${k}`, c: r() < 0.5 ? 0 : r(0, 1), torque: r() < 0.6 ? 1 : 0 }), base, ['B', 'F']);
      fol.turns = true;
      for (let i = 0, n = r() < 0.2 ? 2 : 1; i < n; i++) {
        const [tip] = add(part(`rod${k}${i}`, 'rod', { l: r(0.2, 1.5), m: r(0.1, 2), at: r() < 0.5 ? 'uniform' : 'tip' }), fol, ['B', 'T']);
        if (r() < 0.2) add(part(`bob${k}${i}`, 'mass', { m: r(0.1, 1) }), tip, ['F']);
      }
    }
  }
  for (let i = blocks.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [blocks[i], blocks[j]] = [blocks[j], blocks[i]]; }
  const gains = [], wires = [];
  for (const b of blocks.slice()) {
    if (!((b.type === 'rail' && b.params.force) || (b.type === 'hinge' && b.params.torque))) continue;
    const K = r(-3, 3);
    gains.push([b.id, K]);
    blocks.push(part(`k_${b.id}`, 'gain', { K }));
    wires.push({ from: 'in', to: `k_${b.id}` }, { from: `k_${b.id}`, to: b.id });
  }
  blocks.push(part('in', 'inport', { port: 1 }));
  return { d: level(blocks, frames.filter((f) => f.ports.length > 1).map((f) => f.ports), wires), gains: new Map(gains) };
}

// RK4 at step h for T seconds; watch(t, X) at every step.
function rk4(f, X0, { T, h = 1e-3, u = () => 0, watch }) {
  const n = X0.length, X = Float64Array.from(X0), Xt = new Float64Array(n), k = [0, 1, 2, 3].map(() => new Float64Array(n));
  for (let i = 0, t = 0; i < Math.round(T / h); i++, t += h) {
    watch?.(t, X);
    f(X, u(t), k[0]);
    for (let j = 0; j < n; j++) Xt[j] = X[j] + 0.5 * h * k[0][j];
    f(Xt, u(t + h / 2), k[1]);
    for (let j = 0; j < n; j++) Xt[j] = X[j] + 0.5 * h * k[1][j];
    f(Xt, u(t + h / 2), k[2]);
    for (let j = 0; j < n; j++) Xt[j] = X[j] + h * k[2][j];
    f(Xt, u(t + h), k[3]);
    for (let j = 0; j < n; j++) X[j] += (h / 6) * (k[0][j] + 2 * k[1][j] + 2 * k[2][j] + k[3][j]);
  }
  watch?.(T, X);
  return X;
}

// The bodies' velocities from pose() by finite differences of positions
// (along q̇, fourth order): [{ m, I, y, vx, vy, w }].
function motion(ode, X) {
  const N = ode.n / 2, e = 1e-4, at = (s) => ode.pose(Float64Array.from(X, (v, i) => (i < N ? v + s * e * X[N + i] : v)));
  const P = [at(-2), at(-1), at(1), at(2)], d = (f) => (8 * (f(P[2]) - f(P[1])) - (f(P[3]) - f(P[0]))) / (12 * e);
  return ode.pose(X).map((b, i) => ({ m: b.m, I: b.I, y: b.at[1], vx: d((p) => p[i].at[0]), vy: d((p) => p[i].at[1]), w: d((p) => p[i].angle) }));
}
const energy = (ode, X) => motion(ode, X).reduce((s, b) => s + 0.5 * b.m * (b.vx ** 2 + b.vy ** 2) + 0.5 * b.I * b.w ** 2 + b.m * ode.constants.g * b.y, 0);
const momentumX = (ode, X) => motion(ode, X).reduce((s, b) => s + b.m * b.vx, 0);

test('the fast form equals the general Jacobian solver on 200 random mechanisms', () => {
  const r = rng(20261025);
  let worst = 0, branched = 0, inclined = 0, uniform = 0, torques = 0;
  for (let n = 0; n < 200; n++) {
    const { d, gains } = randomMechanism(r);
    const { f, N } = mech(d), ref = oracle(d.blocks, d.joins);
    assert.equal(ref.N, N);
    const parts = d.blocks;
    branched += d.joins.some((j) => j.filter((e) => /^(hinge|rail)/.test(e) && e.endsWith(':B')).length > 1) ? 1 : 0;
    inclined += parts.some((b) => b.type === 'rail' && b.params.incline) ? 1 : 0;
    uniform += parts.some((b) => b.type === 'rod' && b.params.at === 'uniform') ? 1 : 0;
    torques += ref.inputs.filter((b) => b.type === 'hinge').length > 1 ? 1 : 0;
    const dX = new Float64Array(2 * N), dR = new Float64Array(2 * N);
    for (let s = 0; s < 5; s++) {
      const X = Float64Array.from({ length: 2 * N }, (_, i) => (i < N ? r(-Math.PI, Math.PI) : r(-3, 3))), u = r(-5, 5);
      f(X, u, dX);
      ref.rates(X, ref.inputs.map((b) => gains.get(b.id) * u), dR);
      for (let i = 0; i < 2 * N; i++) worst = Math.max(worst, Math.abs(dX[i] - dR[i]) / Math.max(1, Math.abs(dR[i])));
    }
  }
  assert.ok(worst < 1e-12, `worst relative difference ${worst}`);
  // The draw covers what it should.
  for (const [what, count] of [['branched', branched], ['inclined', inclined], ['uniform', uniform], ['two torques', torques]]) assert.ok(count >= 20, `${what}: ${count} of 200`);
});

// Mechanisms outside the library (no friction, no inputs).
const doublePendulum = () => level([part('w', 'world'), part('h1', 'hinge', { name: 'θ1', rate: 'ω1' }), part('r1', 'rod', { l: 0.7, m: 1.2 }), part('h2', 'hinge', { name: 'θ2', rate: 'ω2' }), part('r2', 'rod', { l: 0.5, m: 0.8, at: 'uniform' })],
  [['w:W', 'h1:B'], ['h1:F', 'r1:B'], ['r1:T', 'h2:B'], ['h2:F', 'r2:B']]);
const twoOnCart = (extra = {}) => level([part('w', 'world'), part('rail', 'rail', { force: 0 }), part('cart', 'mass', { m: 1.5 }),
  part('h1', 'hinge', { name: 'θ1', rate: 'ω1', ...extra.h1 }), part('r1', 'rod', { l: 0.6, m: 0.4 }), part('h2', 'hinge', { name: 'θ2', rate: 'ω2', ...extra.h2 }), part('r2', 'rod', { l: 0.3, m: 0.7, at: 'uniform' })],
[['w:W', 'rail:B'], ['rail:F', 'cart:F', 'h1:B', 'h2:B'], ['h1:F', 'r1:B'], ['h2:F', 'r2:B']]);
const rodOnIncline = () => level([part('w', 'world'), part('rail', 'rail', { force: 0, incline: 0.4 }), part('cart', 'mass', { m: 0.8 }), part('h', 'hinge'), part('rod', 'rod', { l: 0.9, m: 1.1, at: 'uniform' })],
  [['w:W', 'rail:B'], ['rail:F', 'cart:F', 'h:B'], ['h:F', 'rod:B']]);

test('T + V is conserved without friction or inputs (energy from pose, not the equations)', () => {
  for (const [d, X0] of [[doublePendulum(), [2.5, -1, 0, 3]], [twoOnCart(), [0, 2.8, -0.5, 0.4, 1, -2]], [rodOnIncline(), [0, 2, 1, -2]]]) {
    const { f, ode } = mech(d);
    const e0 = energy(ode, X0);
    let de = 0;
    rk4(f, X0, { T: 5, watch: (t, X) => { de = Math.max(de, Math.abs(energy(ode, X) - e0)); } });
    assert.ok(de / Math.abs(e0) < 1e-6, `relative drift ${de / Math.abs(e0)} (E = ${e0})`);
  }
});

// M(q) as §1.1 builds it from the mechanism's constants.
function massMatrix(K, q) {
  const { np, nh, d, Mpp, Cpr, Crr, I } = K, N = np + nh, M = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let p = 0; p < np; p++) {
    for (let k = 0; k < np; k++) M[p][k] = Mpp[p * np + k];
    for (let j = 0; j < nh; j++) M[p][np + j] = M[np + j][p] = Cpr[p * nh + j] * (d[p][0] * Math.cos(q[np + j]) - d[p][1] * Math.sin(q[np + j]));
  }
  for (let j = 0; j < nh; j++) for (let k = 0; k < nh; k++) M[np + j][np + k] = Crr[j * nh + k] * Math.cos(q[np + j] - q[np + k]) + (j === k ? I[j] : 0);
  return M;
}

test('the velocity terms equal the Christoffel terms of M(q)', () => {
  const r = rng(7);
  let worst = 0;
  for (let n = 0; n < 30; n++) {
    const { d } = randomMechanism(r);
    for (const b of d.blocks) { if (b.type === 'rail') b.params.b = 0; if (b.type === 'hinge') b.params.c = 0; }
    const { f, ode, N } = mech(d), K = ode.constants;
    const X = Float64Array.from({ length: 2 * N }, (_, i) => (i < N ? r(-Math.PI, Math.PI) : r(-3, 3))), X0 = Float64Array.from(X, (v, i) => (i < N ? v : 0));
    const a = new Float64Array(2 * N), a0 = new Float64Array(2 * N);
    f(X, 0, a); f(X0, 0, a0);
    // −c = M·(q̈(q, q̇) − q̈(q, 0)).
    const q = Array.from(X.subarray(0, N)), qd = X.subarray(N), M = massMatrix(K, q), h = 1e-6;
    const dM = Array.from({ length: N }, (_, j) => { const up = massMatrix(K, q.map((v, i) => v + (i === j ? h : 0))), dn = massMatrix(K, q.map((v, i) => v - (i === j ? h : 0))); return up.map((row, i) => row.map((v, l) => (v - dn[i][l]) / (2 * h))); });
    for (let k = 0; k < N; k++) {
      let c = 0, mc = 0;
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) c += (dM[j][k][i] - 0.5 * dM[k][i][j]) * qd[i] * qd[j];
      for (let i = 0; i < N; i++) mc -= M[k][i] * (a[N + i] - a0[N + i]);
      worst = Math.max(worst, Math.abs(mc - c) / Math.max(1, Math.abs(c)));
    }
  }
  assert.ok(worst < 1e-7, `worst relative difference ${worst}`);
});

test('textbook: a uniform rod on a fixed hinge swings at √(3g/2l); a mass on an incline accelerates at g·sin α down it', () => {
  const l = 0.8, g = 9.81;
  const { f } = mech(level([part('w', 'world', { g }), part('h', 'hinge'), part('rod', 'rod', { l, m: 1.3, at: 'uniform' })], [['w:W', 'h:B'], ['h:F', 'rod:B']]));
  const crossings = [];
  let last = 0;
  rk4(f, [Math.PI + 1e-3, 0], { T: 6, h: 2e-4, watch: (t, X) => { const e = X[0] - Math.PI; if (last < 0 && e >= 0) crossings.push(t - (e / (e - last)) * 2e-4); last = e; } });
  const period = (crossings.at(-1) - crossings[0]) / (crossings.length - 1), expected = (2 * Math.PI) / Math.sqrt((3 * g) / (2 * l));
  assert.ok(Math.abs(period - expected) / expected < 1e-3, `${period} vs ${expected}`);
  for (const alpha of [0.3, -0.7, 1.2]) {
    const { f: fi, ode } = mech(level([part('w', 'world', { g }), part('rail', 'rail', { incline: alpha, force: 0 }), part('m', 'mass', { m: 2 })], [['w:W', 'rail:B'], ['rail:F', 'm:F']]));
    const dX = new Float64Array(2);
    fi([0.4, 1], 0, dX);
    assert.ok(Math.abs(dX[1] + g * Math.sin(alpha)) < 1e-12, `${dX[1]} vs ${-g * Math.sin(alpha)}`);
    // The rail runs along (cos α, sin α): uphill for α > 0, against gravity.
    const [b] = ode.pose([1, 0]);
    assert.ok(Math.abs(b.at[0] - Math.cos(alpha)) < 1e-15 && Math.abs(b.at[1] - Math.sin(alpha)) < 1e-15);
  }
});

test('a hinge torque is internal: horizontal momentum stays; damping alone only removes energy', () => {
  // A chain of two rods on a cart, b = 0, a torque on hinge 2 alone.
  const chain = (h1, h2) => level([part('w', 'world'), part('rail', 'rail', { force: 0 }), part('cart', 'mass', { m: 1 }),
    part('h1', 'hinge', { name: 'θ1', rate: 'ω1', ...h1 }), part('r1', 'rod', { l: 0.5, m: 0.3 }), part('h2', 'hinge', { name: 'θ2', rate: 'ω2', ...h2 }), part('r2', 'rod', { l: 0.4, m: 0.2, at: 'uniform' }), part('in', 'inport', { port: 1 })],
  [['w:W', 'rail:B'], ['rail:F', 'cart:F', 'h1:B'], ['h1:F', 'r1:B'], ['r1:T', 'h2:B'], ['h2:F', 'r2:B']], h2.torque ? [{ from: 'in', to: 'h2' }] : []);
  const { f, ode } = mech(chain({}, { torque: 1 })), X0 = [0.2, 0.3, -0.4, 0.5, 1, -1];
  // At any state the torque's accelerations Δq̈ carry no horizontal momentum:
  // Σ m·(∂x/∂q)·Δq̈ = 0 (momentumX with Δq̈ in place of q̇).
  const r = rng(5), a = new Float64Array(6), a0 = new Float64Array(6);
  let worst = 0;
  for (let i = 0; i < 50; i++) {
    const X = Array.from({ length: 6 }, () => r(-3, 3)), u = r(-5, 5);
    f(X, u, a); f(X, 0, a0);
    const dq = [0, 1, 2].map((j) => a[3 + j] - a0[3 + j]), n = Math.hypot(...dq);
    worst = Math.max(worst, Math.abs(momentumX(ode, [...X.slice(0, 3), ...dq.map((v) => v / n)])));
  }
  assert.ok(worst < 1e-10, `the torque moved the momentum at ${worst}`);
  // A couple moves no momentum with or without its reaction; the power shows
  // the reaction: the torque's Δq̈ changes dE/dt by τ·(ω2 − ω1), not τ·ω2.
  worst = 0;
  for (let i = 0; i < 50; i++) {
    const X = Array.from({ length: 6 }, () => r(-3, 3)), u = r(-5, 5), e = 1e-3;
    f(X, u, a); f(X, 0, a0);
    const at = (s) => energy(ode, X.map((v, j) => (j < 3 ? v : v + s * e * (a[j] - a0[j]))));
    const power = (at(1) - at(-1)) / (2 * e), expected = u * (X[5] - X[4]);
    worst = Math.max(worst, Math.abs(power - expected) / Math.max(1, Math.abs(expected)));
  }
  assert.ok(worst < 1e-6, `the torque's power is off by ${worst}`);
  // And along a run (RK4's own error, h⁴, aside).
  const p0 = momentumX(ode, X0), free = rk4(f, X0, { T: 2 });
  let dp = 0;
  const X = rk4(f, X0, { T: 2, h: 5e-4, u: (t) => 0.5 * Math.sin(3 * t), watch: (t, x) => { dp = Math.max(dp, Math.abs(momentumX(ode, x) - p0)); } });
  assert.ok(dp < 1e-8, `momentum moved ${dp}`);
  assert.ok(Math.abs(X[2] - free[2]) > 1e-2, 'the torque did nothing');
  // Damping on both hinges, no inputs.
  const damped = mech(chain({ c: 0.3 }, { c: 0.2 }));
  let prev = Infinity, rose = 0, e0;
  rk4(damped.f, [0, 0.1, 2.5, 0, 0, 3], { T: 3, watch: (t, x) => { const e = energy(damped.ode, x); e0 ??= e; if (e > prev + 1e-12) rose++; prev = e; } });
  assert.equal(rose, 0, 'energy rose under damping alone');
  assert.ok(prev < e0 - 0.1, 'damping took no energy');
});

test('every refusal of a mechanism, with its sentence and the parts named', () => {
  const W = part('w', 'world'), cart = (id = 'cart') => part(id, 'mass');
  const refused = (blocks, joins, re, names) => {
    assert.throws(() => compile(level(blocks, joins)), (e) => {
      assert.match(e.message, re);
      assert.equal(e.code, 'mechanism');
      assert.deepEqual([...e.blocks].sort(), [...names].sort());
      return true;
    });
  };
  // Two rails from the World whose followers are joined.
  refused([W, part('r1', 'rail', { force: 0 }), part('r2', 'rail', { name: 'y', rate: 'vy', force: 0 }), cart()], [['w:W', 'r1:B', 'r2:B'], ['r1:F', 'r2:F', 'cart:F']], /must be a tree: 'r2' closes a loop/, ['r2']);
  refused([W, part('r1', 'rail', { force: 0 }), cart(), cart('lost')], [['w:W', 'r1:B'], ['r1:F', 'cart:F']], /'lost' is not joined to a World/, ['lost']);
  refused([W, part('w2', 'world'), part('r1', 'rail', { force: 0 }), cart()], [['w:W', 'w2:W', 'r1:B'], ['r1:F', 'cart:F']], /'w' and 'w2' are joined: one World per mechanism/, ['w', 'w2']);
  refused([W, part('h', 'hinge'), part('rod', 'rod', { m: 1 })], [['w:W', 'h:F'], ['h:B', 'rod:B']], /'h' is joined the wrong way round: its base \(B\) goes on the World's side/, ['h']);
  refused([W, part('h', 'hinge'), part('rod', 'rod', { m: 1 }), part('r1', 'rail', { force: 0 }), cart()], [['w:W', 'h:B'], ['h:F', 'rod:B'], ['rod:T', 'r1:B'], ['r1:F', 'cart:F']], /'r1' sits on a part that turns \('h'\)/, ['r1', 'h']);
  refused([W, part('r1', 'rail', { force: 0 })], [['w:W', 'r1:B']], /'r1' moves no mass: put a Mass on it/, ['r1']);
  refused([W, part('h', 'hinge'), part('rod', 'rod', { m: 0 })], [['w:W', 'h:B'], ['h:F', 'rod:B']], /'h' moves no mass: put a Rod with a mass, or a Mass, on it/, ['h']);
  refused([W, part('r1', 'rail', { force: 0 }), part('r2', 'rail', { force: 0 }), cart(), cart('c2')], [['w:W', 'r1:B'], ['r1:F', 'cart:F', 'r2:B'], ['r2:F', 'c2:F']], /'r1' and 'r2' both name a coordinate or rate x/, ['r1', 'r2']);
  // The joins themselves (normalizeDiagram).
  const blocks = [W, part('r1', 'rail', { force: 0 }), cart()];
  assert.throws(() => level(blocks, [['w:W', 'r1:X']]), /plant\.joins\[0\]: 'r1' has no frame port "X" \(its frame ports: B, F\)/);
  assert.throws(() => level(blocks, [['w:W', 'r1:B'], ['r1:B', 'cart:F']]), /plant\.joins\[1\]: r1:B is already in join 1; a port is in one join/);
  assert.throws(() => level(blocks, [['w:W']]), /plant\.joins\[0\]: a join holds two frame ports or more/);
});
