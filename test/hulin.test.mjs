// The Hu–Lin variable gain (design/research/hu-lin.md): its design against an
// independent computation, its law keeping u inside the limits along the
// trajectories the theory covers, its refusals, and the library example.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDiagram, compileDiagram } from '../src/core/diagram.js';
import { CONTROLLERS, normalizeVariant, makeLaw, huLinLevel } from '../src/core/controllers.js';
import { simulateSystem } from '../src/core/sim.js';
import { SYSTEM_LIBRARY } from '../src/core/systems.js';

const Ts = 0.01;
// A chain of n integrators from u to x1, every state measured (x1, x2, … the
// last the first integrator's output), u limited to ±1.
function chain(n, variant, Tc = Ts) {
  const ints = Array.from({ length: n }, (_, i) => ({ id: `x${n - i}`, type: 'integrator', name: `x${n - i}`, params: { K: 1 }, x: 100 * i, y: 0 }));
  return normalizeDiagram({
    blocks: [
      { id: 'r', type: 'source', params: { signal: 'r' }, x: 0, y: 0 },
      { id: 'ctrl', type: 'controller', name: 'controller', params: { inputs: n + 1, Ts: Tc }, variants: [variant], variant: 0, x: 0, y: 0 },
      ...ints,
      { id: 'sx', type: 'sink', params: { name: 'x' }, x: 0, y: 0 }, { id: 'su', type: 'sink', params: { name: 'u' }, x: 0, y: 0 },
    ],
    wires: [
      { from: 'r', to: 'ctrl' }, { from: 'ctrl', to: `x${n}` },
      ...ints.slice(1).map((b, i) => ({ from: ints[i].id, to: b.id })),
      ...Array.from({ length: n }, (_, i) => ({ from: `x${i + 1}`, to: `ctrl:${i + 1}` })),
      { from: 'x1', to: 'sx' }, { from: 'ctrl', to: 'su' },
    ],
  });
}
const huLin = (params) => ({ name: 'HL', type: 'huLin', params: { R: 1, umin: -1, umax: 1, ...params } });
const statusOf = (d) => compileDiagram(d, 'plant', { standalone: true }).designs[0];

// ---- An independent computation, for the double integrator ẋ1 = x2, ẋ2 = u
// held over Ts (Grognard, Sepulchre and Bastin's example): its exact
// discretisation, the Riccati difference equation iterated to its fixed
// point, the gain and the ellipsoid's level, by plain 2×2 arithmetic.
const Ad = [[1, Ts], [0, 1]], Bd = [Ts * Ts / 2, Ts];
function riccati(q) {
  let P = [[1, 0], [0, 1]];
  for (let it = 0; it < 2e6; it++) {
    const PB = [P[0][0] * Bd[0] + P[0][1] * Bd[1], P[1][0] * Bd[0] + P[1][1] * Bd[1]];
    const s = 1 + Bd[0] * PB[0] + Bd[1] * PB[1];
    const BPA = [PB[0] * Ad[0][0] + PB[1] * Ad[1][0], PB[0] * Ad[0][1] + PB[1] * Ad[1][1]];
    const APA = [0, 1].map((i) => [0, 1].map((j) => Ad[0][i] * (P[0][0] * Ad[0][j] + P[0][1] * Ad[1][j]) + Ad[1][i] * (P[1][0] * Ad[0][j] + P[1][1] * Ad[1][j])));
    const N = [0, 1].map((i) => [0, 1].map((j) => APA[i][j] - (BPA[i] * BPA[j]) / s + (i === j ? q[i] : 0)));
    const change = Math.max(...N.flat().map((v, k) => Math.abs(v - P.flat()[k])));
    P = N;
    if (change < 1e-13 * Math.max(...P.flat().map(Math.abs))) {
      const K = BPA.map((v) => v / s);
      // max |K·x| on xᵀPx ≤ 1 is √(K P⁻¹ Kᵀ).
      const det = P[0][0] * P[1][1] - P[0][1] * P[1][0];
      const w = (K[0] * K[0] * P[1][1] - 2 * K[0] * K[1] * P[0][1] + K[1] * K[1] * P[0][0]) / det;
      return { K, P, w };
    }
  }
  throw new Error('no fixed point');
}
// Megretski's schedule, exactly: the largest ε in [low, 1] with xᵀP(ε)x·w(ε) ≤ ū², by bisection.
function megretski(x, q, low, room = 1) {
  const g = (e) => { const { P, w } = riccati(q.map((v) => v * e)); return (x[0] * (P[0][0] * x[0] + P[0][1] * x[1]) + x[1] * (P[1][0] * x[0] + P[1][1] * x[1])) * w; };
  if (g(1) <= room * room) return 1;
  let lo = Math.log(low), hi = 0;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (g(Math.exp(mid)) <= room * room) lo = mid; else hi = mid; }
  return Math.exp(lo);
}

test('the design is the low-gain LQR family: gains and ellipsoids as an independent Riccati iteration gives them', () => {
  const st = statusOf(chain(2, huLin({ Q: [1, 0], low: 1e-3, levels: 4 })));
  assert.equal(st.status, 'ok', st.error?.message);
  const v = st.values;
  v.eps.forEach((e, j) => {
    const { K, P, w } = riccati([e, 0]);
    K.forEach((k, i) => assert.ok(Math.abs(v.K[j * 2 + i] - k) <= 1e-7 * Math.abs(k), `level ${j}: K${i + 1} ${v.K[j * 2 + i]} against ${k}`));
    // S = P·w: inside while eᵀ S e ≤ ū².
    P.flat().forEach((p, i) => assert.ok(Math.abs(v.S[j * 4 + i] - p * w) <= 1e-6 * Math.abs(p * w) + 1e-12, `level ${j}: S ${v.S[j * 4 + i]} against ${p * w}`));
  });
  // Nested: the higher the gain, the smaller the ellipsoid.
  for (let j = 1; j < v.N; j++) assert.ok(v.S[j * 4] > v.S[(j - 1) * 4]);
  assert.deepEqual(v.ys, [1, 0]);
  assert.equal(v.us, 0);
});

test('on the boundary of a level\'s ellipsoid its linear law reaches the limit exactly, and nowhere inside', () => {
  const v = statusOf(chain(2, huLin({ Q: [1, 0], low: 1e-3, levels: 4 }))).values;
  for (let j = 0; j < v.N; j++) {
    const S = v.S.slice(j * 4, j * 4 + 4), K = v.K.slice(j * 2, j * 2 + 2);
    let worst = 0;
    for (let a = 0; a < 2000; a++) {
      const d = [Math.cos(a * Math.PI / 1000), Math.sin(a * Math.PI / 1000)];
      const s = Math.sqrt(d[0] * (S[0] * d[0] + S[1] * d[1]) + d[1] * (S[2] * d[0] + S[3] * d[1]));
      worst = Math.max(worst, Math.abs(K[0] * d[0] + K[1] * d[1]) / s);
    }
    assert.ok(worst <= 1 + 1e-9 && worst > 1 - 1e-5, `level ${j}: the largest |u| on the boundary is ${worst}`);
  }
});

test('the law is Megretski\'s schedule: the gain of the largest ε whose ellipsoid holds the error, to the levels\' spacing', () => {
  const low = 1e-4, v = statusOf(chain(2, huLin({ Q: [1, 0], low, levels: 200 }))).values;
  for (const x of [[-10, 0], [3, -1], [0.5, 0.5], [-1, 2], [20, 0]]) {
    const e = megretski(x, [1, 0], low), { K } = riccati([e, 0]);
    const { j, lam } = huLinLevel(v, x, 1);
    const ours = [0, 1].map((i) => v.K[j * 2 + i] + lam * ((v.K[(j + 1) * 2 + i] ?? 0) - v.K[j * 2 + i]));
    // 200 levels over four decades: neighbours differ by 4.7 % in ε.
    K.forEach((k, i) => assert.ok(Math.abs(ours[i] - k) <= 0.03 * Math.abs(k), `x = ${x}: K${i + 1} ${ours[i]} against ${k} at ε = ${e}`));
  }
});

test('Megretski\'s scheduling variable reproduces the published double integrator: from (−10, 0) to the local ellipsoid in about 10.25 s', () => {
  // Grognard, Sepulchre and Bastin (Automatica 2002, sect. 5): ẋ1 = x2,
  // ẋ2 = u, |u| ≤ 1, Q(ε) = diag(ε⁴, ε²), R = 1, so P(ε) = [[√3ε³, ε²], [ε², √3ε]]
  // and u = −ε²x1 − √3ε x2; ε(x) the largest ε ≤ 1 with (xᵀP(ε)x)(bᵀP(ε)b) ≤ 1.
  // They report 10.25 s to reach T(1) = {ε(x) = 1}; with their exact setup
  // unknown, 10.52 s here (design/research/hu-lin.md).
  const s3 = Math.sqrt(3);
  const g = (x, e) => (s3 * e ** 3 * x[0] ** 2 + 2 * e * e * x[0] * x[1] + s3 * e * x[1] ** 2) * s3 * e;
  const eps = (x) => { if (g(x, 1) <= 1) return 1; let lo = 1e-9, hi = 1; for (let i = 0; i < 60; i++) { const m = Math.sqrt(lo * hi); if (g(x, m) <= 1) lo = m; else hi = m; } return lo; };
  const f = (x) => { const e = eps(x); return [x[1], -e * e * x[0] - s3 * e * x[1]]; };
  let x = [-10, 0], t = 0, last = 0, umax = 0;
  const dt = 0.002;
  while (eps(x) < 1 && t < 30) {
    const k1 = f(x), k2 = f([x[0] + dt / 2 * k1[0], x[1] + dt / 2 * k1[1]]), k3 = f([x[0] + dt / 2 * k2[0], x[1] + dt / 2 * k2[1]]), k4 = f([x[0] + dt * k3[0], x[1] + dt * k3[1]]);
    x = [x[0] + dt / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]), x[1] + dt / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])];
    t += dt;
    const e = eps(x);
    assert.ok(e >= last - 1e-12, `ε falls at t = ${t}`);
    last = e; umax = Math.max(umax, Math.abs(k1[1]));
  }
  assert.ok(Math.abs(t / 10.25 - 1) < 0.03, `reaches T(1) at ${t.toFixed(2)} s`);
  assert.ok(umax < 1, 'u inside the limit');
});

test('the gain changes continuously with the error, and grows as it shrinks', () => {
  const v = statusOf(chain(2, huLin({ Q: [1, 0], low: 1e-4 }))).values;
  const gain = (x) => { const { j, lam } = huLinLevel(v, x, 1); return v.K[j * 2] + lam * ((v.K[(j + 1) * 2] ?? v.K[j * 2]) - v.K[j * 2]); };
  let before = 0;
  for (let a = 50; a >= 0.01; a *= 0.99) {
    const k = gain([a, 0]);
    assert.ok(k >= before - 1e-12, `the gain falls at x1 = ${a}`);
    assert.ok(Math.abs(gain([a * 1.0001, 0]) - k) <= 2e-3 * k, `a jump in the gain at x1 = ${a}`);
    before = k;
  }
  assert.equal(before, v.K[(v.N - 1) * 2], 'near r the full gain');
});

test('along every trajectory from inside the lowest ellipsoid u stays inside the limits and the error dies away', () => {
  // The design's own model: the double and the triple integrator, held over Ts.
  for (const n of [2, 3]) {
    const variant = normalizeVariant(huLin({ Q: [1, ...new Array(n - 1).fill(0)], low: 1e-4 }));
    const v = statusOf(chain(n, variant)).values;
    const S0 = v.S.slice(0, n * n);
    for (let trial = 0; trial < 40; trial++) {
      // A direction, scaled to 0.99 of the lowest ellipsoid's boundary.
      let x = Array.from({ length: n }, (_, i) => Math.sin(1.7 * trial + 2.3 * i + 0.4));
      const g = x.reduce((s, a, i) => s + a * x.reduce((t, b, j) => t + S0[i * n + j] * b, 0), 0);
      x = x.map((a) => (0.99 * a) / Math.sqrt(g));
      const law = makeLaw(variant, Ts, CONTROLLERS, v);
      let worst = 0;
      for (let k = 0; k < 20000; k++) {
        const u = law.step([0, ...x]);
        worst = Math.max(worst, Math.abs(u));
        // Exact zero-order hold of the chain: x_i gains the integrals of those after it.
        const fact = (m) => (m <= 1 ? 1 : m * fact(m - 1));
        x = x.map((_, i) => x.slice(i).reduce((s, b, j) => s + (b * Ts ** j) / fact(j), 0) + (u * Ts ** (n - i)) / fact(n - i));
      }
      assert.ok(worst < 1, `chain of ${n}, trial ${trial}: |u| reached ${worst}`);
      assert.ok(Math.hypot(...x) < 1e-3, `chain of ${n}, trial ${trial}: it ends at ${x}`);
    }
  }
});

test('a chain of three integrators: clipped LQR opens the loop and diverges; the variable gain with the same weights settles', () => {
  const r = { r: { period: 20, components: [{ type: 'step', params: { amplitude: 5, time: 0.1 } }] } };
  const run = (variant) => simulateSystem(chain(3, variant), r, { duration: 20, sampleTime: 0.01 }).signals;
  const lqr = run({ name: 'LQR', type: 'lqr', params: { Q: [100, 0, 0], R: 1, umin: -1, umax: 1 } });
  const hl = run(huLin({ Q: [100, 0, 0] }));
  assert.ok(Math.max(...lqr.x.map(Math.abs)) > 50, `clipped LQR stays within ${Math.max(...lqr.x.map(Math.abs))}`);
  assert.ok(Math.abs(hl.x.at(-1) - 5) < 1e-3 && Math.max(...hl.x) < 5 * 1.01, `the variable gain ends at ${hl.x.at(-1)}, peaks at ${Math.max(...hl.x)}`);
  assert.ok(Math.max(...hl.u.map(Math.abs)) < 1, 'and never reaches the limit');
});

test('refusals: no limits, a state not measured', () => {
  const free = statusOf(chain(2, { name: 'HL', type: 'huLin', params: { Q: [1, 0], R: 1 } }));
  assert.equal(free.error?.code, 'no-limits');
  const d = chain(2, huLin({ Q: [1] }));
  d.blocks.find((b) => b.id === 'ctrl').params.inputs = 2;
  d.wires = d.wires.filter((w) => w.to !== 'ctrl:2');
  assert.equal(statusOf(normalizeDiagram(d)).error?.code, 'states-not-measured');
});

test('its linear model is the LQR near r, times k; a file never holds its gains', () => {
  const variant = normalizeVariant(huLin({ Q: [1, 0], k: 2 }));
  const v = statusOf(chain(2, variant)).values;
  const lin = CONTROLLERS.huLin.linear(variant.params, Ts, { y: [0, 0] }, v);
  const K = v.K.slice((v.N - 1) * 2).map((g) => 2 * g);
  assert.deepEqual(lin.D[0].map((x) => +x.toPrecision(12)), [K[0], -K[0], -K[1]].map((x) => +x.toPrecision(12)));
  assert.throws(() => normalizeVariant({ type: 'huLin', params: { K: [1, 2] } }), /computes K/);
  assert.throws(() => CONTROLLERS.huLin.linear(variant.params, Ts, {}, null), /no design/);
});

test('the library example: the variable gain stays inside the limit without overshoot; clipped LQR overshoots; clamping beats no anti-windup', () => {
  const e = SYSTEM_LIBRARY.find((s) => s.name === 'Variable gain against anti-windup');
  const runs = e.plant.diagram.blocks.find((b) => b.id === 'ctrl').variants.map((_, i) => {
    const d = structuredClone(e.plant.diagram);
    d.blocks.find((b) => b.id === 'ctrl').variant = i;
    const { t, signals: s } = simulateSystem(normalizeDiagram(d), e.input.signals, { duration: 2.75, sampleTime: 0.0005 });
    const over = Math.max(...s.angle) / 5 - 1, umax = Math.max(...s.u.map(Math.abs));
    let settle = 0;
    t.forEach((tk, k) => { if (Math.abs(s.angle[k] - 5) > 0.1) settle = tk - 0.25; });
    return { over, umax, settle };
  });
  const [hl, hk, lqr, clamp, , off] = runs;
  assert.ok(hl.umax < 5 && hl.over < 0.01 && hl.settle < 0.4, JSON.stringify(hl));
  assert.ok(hk.umax === 6 && hk.over < 0.001 && hk.settle < hl.settle, JSON.stringify(hk));
  assert.ok(lqr.over > 0.08, JSON.stringify(lqr));
  assert.ok(clamp.over < off.over && clamp.settle < off.settle, `${JSON.stringify(clamp)} ${JSON.stringify(off)}`);
});
