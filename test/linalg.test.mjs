import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zeros, eye, mul, add, transpose, solve, inv, det, cholesky, cholSolve, eigSym, expm, c2d, eig, dare, dlqr, dlqe, freqResp, bode, logspace, margins, rootLocus, tzeros, ctrb, rank } from '../src/core/linalg.js';
import { polyMul } from '../src/core/poly.js';

const close = (actual, expected, tol, what = '') => assert.ok(Math.abs(actual - expected) <= tol, `${what} ${actual} vs ${expected} (tol ${tol})`);
const closeM = (A, B, tol, what = '') => A.forEach((r, i) => r.forEach((v, j) => close(v, B[i][j], tol, `${what}[${i}][${j}]`)));
const diag = (v) => v.map((x, i) => v.map((_, j) => (i === j ? x : 0)));
const spectralRadius = (A) => Math.max(...eig(A).map((z) => Math.hypot(z.re, z.im)));
// Deterministic pseudo-random numbers in [−1, 1) (a linear congruential generator).
const lcg = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 31) - 1;
const DEG = 180 / Math.PI;

// The cart–pole at the upright rest, states (x, v, θ, ω), as in the system library.
const CART_POLE = {
  A: [[0, 1, 0, 0], [0, -0.1, -1.962, 0], [0, 0, 0, 1], [0, 0.2, 23.544, 0]],
  B: [[0], [1], [0], [-2]],
};

// L(s) = 2 / (s (s + 1) (0.5 s + 1)) = 4 / (s³ + 3 s² + 2 s), controllable canonical form.
const L3 = { A: [[-3, -2, 0], [1, 0, 0], [0, 1, 0]], B: [1, 0, 0], C: [0, 0, 4], D: 0 };
const L3at = (w) => {
  // 4 / ((jw)³ + 3 (jw)² + 2 jw) = 4 / (−3w² + j (2w − w³))
  const re = -3 * w * w, im = 2 * w - w ** 3, d = re * re + im * im;
  return { re: (4 * re) / d, im: (-4 * im) / d };
};

test('matrix basics: mul, solve, inv, det, transpose', () => {
  const A = [[4, -2, 1], [3, 6, -4], [2, 1, 8]];
  const x = [1, -2, 3];
  const b = mul(A, x);
  solve(A, b).forEach((v, i) => close(v, x[i], 1e-12, 'solve'));
  closeM(mul(A, inv(A)), eye(3), 1e-12, 'A·inv(A)');
  close(det(A), 4 * (48 + 4) + 2 * (24 + 8) + 1 * (3 - 12), 1e-9, 'det');
  assert.deepEqual(transpose([[1, 2, 3], [4, 5, 6]]), [[1, 4], [2, 5], [3, 6]]);
  assert.deepEqual(add([[1, 2]], [[3, 4]], -1), [[-2, -2]]);
  assert.deepEqual(zeros(2, 3), [[0, 0, 0], [0, 0, 0]]);
  assert.equal(det([[1, 2], [2, 4]]), 0);
  assert.throws(() => solve([[1, 2], [2, 4]], [1, 1]), /singular/);
});

test('cholesky: L·Lᵀ = A with L lower; cholSolve equals LU\'s solve; a matrix that is not positive definite is refused', () => {
  // A = M·Mᵀ + I from pseudo-random M: symmetric positive definite.
  const rnd = lcg(17);
  const M = Array.from({ length: 6 }, () => Array.from({ length: 6 }, rnd));
  const A = add(mul(M, transpose(M)), eye(6));
  const L = cholesky(A);
  L.forEach((r, i) => r.forEach((v, j) => { if (j > i) assert.equal(v, 0, `L[${i}][${j}]`); }));
  closeM(mul(L, transpose(L)), A, 1e-12, 'L·Lᵀ');
  const b = Array.from({ length: 6 }, rnd);
  const x = cholSolve(L, b), xl = solve(A, b);
  x.forEach((v, i) => close(v, xl[i], 1e-10, 'x'));
  // A matrix right-hand side: the inverse.
  closeM(mul(A, cholSolve(L, eye(6))), eye(6), 1e-10, 'A·A⁻¹');
  // log det from the diagonal.
  close(2 * L.reduce((s, r, i) => s + Math.log(r[i]), 0), Math.log(det(A)), 1e-9, 'log det');
  assert.deepEqual(cholesky([[4]]), [[2]]);
  assert.throws(() => cholesky([[1, 2], [2, 1]]), /not positive definite/);
  assert.throws(() => cholesky([[0, 0], [0, 1]]), /not positive definite/);
});

test('eigSym: the eigenvalues eig finds, A·V = V·Λ with VᵀV = I, and Vᵀb without forming V; graded and repeated eigenvalues', () => {
  const rnd = lcg(31);
  for (const n of [1, 2, 3, 9, 40]) {
    const M = Array.from({ length: n }, () => Array.from({ length: n }, rnd));
    const A = add(M, transpose(M));
    const b = Array.from({ length: n }, rnd), c = Array.from({ length: n }, rnd);
    const r = eigSym(A, { vectors: true, project: [b, c] });
    const ev = eig(A).map((z) => z.re).sort((x, y) => x - y);
    r.values.forEach((v, i) => close(v, ev[i], 1e-12 * n, `n ${n} λ${i}`));
    for (let i = 1; i < n; i++) assert.ok(r.values[i - 1] <= r.values[i], 'ascending');
    const V = r.vectors;
    closeM(mul(A, V), V.map((row) => row.map((v, j) => v * r.values[j])), 1e-12 * n, `n ${n} A·V`);
    closeM(mul(transpose(V), V), eye(n), 1e-13 * n, `n ${n} VᵀV`);
    [b, c].forEach((x, q) => mul(transpose(V), x.map((v) => [v])).forEach(([v], j) => close(r.projected[q][j], v, 1e-13 * n, `n ${n} Vᵀb`)));
    // Without vectors: the same values and projections.
    const r2 = eigSym(A, { project: [b] });
    assert.deepEqual(r2.values, r.values);
    assert.deepEqual(r2.projected[0], r.projected[0]);
    assert.equal(r2.vectors, undefined);
  }
  // Graded (entries from 1 down to 1e-24, as a kernel's W) and a repeated eigenvalue.
  const g = Array.from({ length: 12 }, (_, i) => 10 ** (-i));
  const G = g.map((a, i) => g.map((b, j) => a * b * (i === j ? 2 : 1)));
  const rg = eigSym(G, { vectors: true });
  closeM(mul(G, rg.vectors), rg.vectors.map((row) => row.map((v, j) => v * rg.values[j])), 1e-15, 'graded');
  close(rg.values.reduce((s, v) => s + v, 0), G.reduce((s, r, i) => s + r[i], 0), 1e-15, 'graded: the sum is the trace');
  const rep = eigSym([[2, 0, 0], [0, 2, 0], [0, 0, 5]]);
  assert.deepEqual(rep.values, [2, 2, 5]);
  assert.throws(() => eigSym([[1, NaN], [NaN, 1]]), /non-finite/);
});

test('expm matches a rotation and a diagonal', () => {
  for (const th of [0.7, 40]) {
    const E = expm([[0, th], [-th, 0]]);
    closeM(E, [[Math.cos(th), Math.sin(th)], [-Math.sin(th), Math.cos(th)]], 1e-12, `rotation ${th}`);
  }
  const d = [-50, -1, 0, 0.5, 3];
  const E = expm(diag(d));
  E.forEach((r, i) => r.forEach((v, j) => {
    if (i === j) close(v / Math.exp(d[i]), 1, 1e-13, `exp(${d[i]})`);
    else assert.equal(v, 0);
  }));
  assert.deepEqual(expm([]), []);
});

test('c2d of a double integrator gives the analytic Ad and Bd', () => {
  const Ts = 0.05;
  const { Ad, Bd } = c2d([[0, 1], [0, 0]], [[0], [1]], Ts);
  closeM(Ad, [[1, Ts], [0, 1]], 1e-15, 'Ad');
  closeM(Bd, [[Ts * Ts / 2], [Ts]], 1e-15, 'Bd');
  // A plain vector B is one input; a first-order lag discretises to e^(−Ts/τ).
  const lag = c2d([[-2]], [2], 0.1);
  close(lag.Ad[0][0], Math.exp(-0.2), 1e-15, 'lag Ad');
  close(lag.Bd[0][0], 1 - Math.exp(-0.2), 1e-15, 'lag Bd');
});

test('eig of a companion matrix returns its known roots, complex pair included', () => {
  // Roots 3, 0.5 ± 2j, −1, −2: (s − 3)(s² − s + 4.25)(s + 1)(s + 2).
  const p = [[1, -3], [1, -1, 4.25], [1, 1], [1, 2]].reduce(polyMul, [1]);
  const n = p.length - 1;
  const A = zeros(n, n);
  for (let j = 0; j < n; j++) A[0][j] = -p[j + 1];
  for (let i = 1; i < n; i++) A[i][i - 1] = 1;
  const expected = [[3, 0], [0.5, 2], [0.5, -2], [-1, 0], [-2, 0]];
  const ev = eig(A);
  assert.equal(ev.length, 5);
  ev.forEach((z, i) => {
    close(z.re, expected[i][0], 1e-10, `re ${i}`);
    close(z.im, expected[i][1], 1e-10, `im ${i}`);
  });
  assert.equal(ev[1].re, ev[2].re, 'a conjugate pair shares its real part');
});

test('eig handles integrators, repeated eigenvalues and tiny matrices', () => {
  // An integrator in a chain: eigenvalues 0, −1, −2.
  const ev = eig([[0, 1, 0], [0, 0, 1], [0, -2, -3]]);
  [0, -1, -2].forEach((v, i) => { close(ev[i].re, v, 1e-12); close(ev[i].im, 0, 0); });
  // The cart–pole: the cart position is an integrator.
  const cp = eig(CART_POLE.A);
  assert.ok(cp.some((z) => Math.hypot(z.re, z.im) < 1e-12));
  assert.deepEqual(eig([[0, 1], [0, 0]]), [{ re: 0, im: 0 }, { re: 0, im: 0 }]);
  // A defective double eigenvalue −1 in a general basis: accurate to ~sqrt(eps).
  const T = [[1, 2], [3, 4]];
  for (const z of eig(mul(mul(T, [[-1, 1], [0, -1]]), inv(T)))) close(Math.hypot(z.re + 1, z.im), 0, 1e-6, 'Jordan');
  // A cyclic permutation (cube roots of 1) needs the exceptional shifts.
  const roots = eig([[0, 0, 1], [1, 0, 0], [0, 1, 0]]);
  [[1, 0], [-0.5, Math.sqrt(3) / 2], [-0.5, -Math.sqrt(3) / 2]].forEach(([re, im], i) => { close(roots[i].re, re, 1e-12); close(roots[i].im, im, 1e-12); });
  assert.deepEqual(eig([[5]]), [{ re: 5, im: 0 }]);
  assert.deepEqual(eig([]), []);
});

test('eig of a 10×10 pseudo-random matrix: sum is the trace, product the determinant', () => {
  const rnd = lcg(2026);
  const A = Array.from({ length: 10 }, () => Array.from({ length: 10 }, rnd));
  const ev = eig(A);
  assert.equal(ev.length, 10);
  const sum = ev.reduce((s, z) => ({ re: s.re + z.re, im: s.im + z.im }), { re: 0, im: 0 });
  const prod = ev.reduce((p, z) => ({ re: p.re * z.re - p.im * z.im, im: p.re * z.im + p.im * z.re }), { re: 1, im: 0 });
  const trace = A.reduce((s, r, i) => s + r[i], 0);
  const d = det(A);
  close(sum.re, trace, 1e-12, 'sum');
  close(sum.im, 0, 1e-12, 'sum im');
  close(prod.re / d, 1, 1e-11, 'product');
  close(prod.im / d, 0, 1e-11, 'product im');
  assert.ok(ev.some((z) => z.im !== 0), 'the test matrix has complex eigenvalues');
  for (let i = 1; i < ev.length; i++) assert.ok(ev[i - 1].re >= ev[i].re, 'sorted by real part');
});

test('dlqr stabilises a double integrator; doubling and iteration agree', () => {
  const { Ad, Bd } = c2d([[0, 1], [0, 0]], [[0], [1]], 0.1);
  const Q = diag([1, 0.1]);
  const { K, P, converged } = dlqr(Ad, Bd, Q, 1);
  assert.ok(converged);
  assert.equal(K.length, 1);
  assert.equal(K[0].length, 2);
  assert.ok(spectralRadius(add(Ad, mul(Bd, K), -1)) < 1);
  // P solves the Riccati equation.
  const At = transpose(Ad), Bt = transpose(Bd);
  const rhs = add(add(mul(At, mul(P, Ad)), mul(mul(At, mul(P, Bd)), K), -1), Q);
  closeM(rhs, P, 1e-10, 'DARE residual');
  const sda = dare(Ad, Bd, Q, 1), iter = dare(Ad, Bd, Q, 1, { method: 'iteration' });
  assert.equal(sda.method, 'sda');
  assert.equal(iter.method, 'iteration');
  assert.ok(sda.iterations < iter.iterations);
  closeM(sda.P, iter.P, 1e-9 * Math.max(...P.flat()), 'sda vs iteration');
});

test('dlqr on the cart–pole matches the gains in the system library', () => {
  const { Ad, Bd } = c2d(CART_POLE.A, CART_POLE.B, 0.01);
  const Q = diag([10, 1, 50, 1]);
  const { K, converged } = dlqr(Ad, Bd, Q, 0.1);
  assert.ok(converged);
  const expected = [-9.177, -10.33, -63.18, -13.34];
  K[0].forEach((k, i) => close(k, expected[i], 1e-3 * Math.abs(expected[i]), `K[${i}]`));
  assert.ok(spectralRadius(add(Ad, mul(Bd, K), -1)) < 1);
  // The symmetrised iteration (the fallback) reaches the same solution.
  const iter = dare(Ad, Bd, Q, 0.1, { method: 'iteration' });
  assert.ok(iter.converged);
  const Kit = solve(add([[0.1]], mul(transpose(Bd), mul(iter.P, Bd))), mul(transpose(Bd), mul(iter.P, Ad)));
  Kit[0].forEach((k, i) => close(k, K[0][i], 1e-7 * Math.abs(K[0][i]), `iteration K[${i}]`));
});

test('dlqe gives a stable estimator; its predictor gain is the dual LQR gain', () => {
  const { Ad } = c2d(CART_POLE.A, CART_POLE.B, 0.01);
  const C = [[1, 0, 0, 0], [0, 0, 1, 0]];
  const Qw = diag([1e-6, 1e-4, 1e-6, 1e-4]), Rv = diag([1e-4, 1e-5]);
  const { L, P, converged } = dlqe(Ad, C, Qw, Rv);
  assert.ok(converged);
  assert.equal(L.length, 4);
  assert.equal(L[0].length, 2);
  closeM(P, transpose(P), 0, 'P symmetric');
  assert.ok(spectralRadius(mul(add(eye(4), mul(L, C), -1), Ad)) < 1);
  // By duality, dlqr(Adᵀ, Cᵀ) gives Kᵀ = Ad L, the one-step predictor gain.
  const { K } = dlqr(transpose(Ad), transpose(C), Qw, Rv);
  closeM(transpose(K), mul(Ad, L), 1e-9 * Math.max(...K.flat().map(Math.abs)), 'Ad L');
  // One output: C a plain vector, Rv a number.
  const one = dlqe(Ad, [1, 0, 0, 0], Qw, 1e-4);
  assert.ok(one.converged);
  assert.ok(spectralRadius(mul(add(eye(4), mul(one.L, [[1, 0, 0, 0]]), -1), Ad)) < 1);
});

test('bode of 1/(s + 1) is −3.01 dB and −45° at w = 1; the phase unwraps', () => {
  const lag = { A: [[-1]], B: [[1]], C: [[1]], D: 0 };
  const g = freqResp(lag, 1);
  close(g.re, 0.5, 1e-15);
  close(g.im, -0.5, 1e-15);
  const b = bode(lag, [0.1, 1, 10]);
  close(b.magDb[1], -3.0103, 1e-4, 'magDb');
  close(b.phaseDeg[1], -45, 1e-12, 'phase');
  close(b.mag[1], Math.SQRT1_2, 1e-15, 'mag');
  assert.deepEqual(b.w, [0.1, 1, 10]);
  // 1/(s + 1)³ goes continuously to −270°, past where atan2 would wrap.
  const cube = { A: [[-3, -3, -1], [1, 0, 0], [0, 1, 0]], B: [1, 0, 0], C: [0, 0, 1] };
  const ph = bode(cube, logspace(-2, 3, 60)).phaseDeg;
  for (let i = 1; i < ph.length; i++) assert.ok(ph[i] < ph[i - 1] && ph[i - 1] - ph[i] < 30);
  close(ph.at(-1), -270, 0.2, 'final phase');
  // A double integrator starts at −180°, not +180°.
  close(bode({ A: [[0, 1], [0, 0]], B: [0, 1], C: [1, 0] }, [1]).phaseDeg[0], -180, 1e-12, 'double integrator');
  const ls = logspace(-1, 2, 4);
  [0.1, 1, 10, 100].forEach((v, i) => close(ls[i], v, 1e-12 * v));
});

test('margins of 2/(s(s + 1)(0.5 s + 1)) match brute force', () => {
  const m = margins(L3, logspace(-2, 2, 200));
  // Brute force on a dense grid, with the transfer function evaluated directly.
  const ws = logspace(-1, 1, 200001);
  const mag = (w) => Math.hypot(L3at(w).re, L3at(w).im);
  const phase = (w) => -90 - Math.atan(w) * DEG - Math.atan(0.5 * w) * DEG;
  const argmin = (f) => ws.reduce((best, w) => (f(w) < f(best) ? w : best), ws[0]);
  const wc = argmin((w) => Math.abs(mag(w) - 1));
  const w180 = argmin((w) => Math.abs(phase(w) + 180));
  const sens = (w) => { const z = L3at(w); return 1 / Math.hypot(1 + z.re, z.im); };
  const wMs = ws.reduce((best, w) => (sens(w) > sens(best) ? w : best), ws[0]);
  close(m.wc, wc, 1e-4, 'wc');
  close(m.pm, 180 + phase(wc), 1e-3, 'pm');
  close(m.w180, w180, 1e-4, 'w180');
  close(m.w180, Math.SQRT2, 1e-9, 'w180 analytic');
  close(m.gm, 1 / mag(w180), 1e-4, 'gm');
  close(m.gm, 1.5, 1e-9, 'gm analytic');
  close(m.gmDb, 20 * Math.log10(1.5), 1e-8, 'gmDb');
  close(m.ms, sens(wMs), 1e-6, 'ms');
  close(m.wMs, wMs, 1e-3, 'wMs');
  assert.equal(m.gainCrossings.length, 1);
  assert.equal(m.phaseCrossings.length, 1);
  // A loop that never reaches −180°: no gain margin.
  const lag = margins({ A: [[-1]], B: [1], C: [2] }, logspace(-2, 2, 100));
  assert.equal(lag.gm, Infinity);
  assert.ok(Number.isNaN(lag.w180));
  close(lag.pm, 180 - Math.atan(Math.sqrt(3)) * DEG, 1e-9, 'first-order pm');
});

test('rootLocus starts at the open-loop poles and crosses the imaginary axis at the Routh–Hurwitz gain', () => {
  const [start] = rootLocus(L3, [1e-9]);
  [0, -1, -2].forEach((p, i) => { close(start[i].re, p, 1e-6); close(start[i].im, 0, 1e-6); });
  // Closed loop s³ + 3 s² + 2 s + 4k: Routh–Hurwitz gives k = 6/4 = 1.5, at w = √2.
  const ks = logspace(-2, 2, 81);
  const loci = rootLocus(L3, ks);
  const i = loci.findIndex((ev) => ev[0].re > 0);
  assert.ok(i > 0);
  let lo = ks[i - 1], hi = ks[i];
  for (let it = 0; it < 60; it++) {
    const mid = (lo + hi) / 2;
    if (rootLocus(L3, [mid])[0][0].re > 0) hi = mid; else lo = mid;
  }
  close(lo, 1.5, 1e-9, 'k at crossing');
  close(Math.abs(rootLocus(L3, [1.5])[0][0].im), Math.SQRT2, 1e-6, 'crossing frequency');
  // u = −k y with feedthrough: A − k B (1 + k D)⁻¹ C.
  const [[pole]] = rootLocus({ A: [[-1]], B: [1], C: [1], D: 1 }, [1]);
  close(pole.re, -1.5, 1e-15);
});

test('tzeros finds the zeros of SISO models', () => {
  const re = (zs) => zs.map((z) => z.re);
  // (s + 3) / ((s + 1)(s + 2)), relative degree 1.
  close(re(tzeros({ A: [[-3, -2], [1, 0]], B: [1, 0], C: [1, 3] }))[0], -3, 1e-12);
  // 2 (s − 1)(s + 4) / ((s + 1)(s + 2)(s + 3)(s + 5)) in a general basis: relative degree 2.
  const den = [[1, 1], [1, 2], [1, 3], [1, 5]].reduce(polyMul, [1]);
  const num = polyMul([2, -2], [1, 4]);
  const A0 = zeros(4, 4);
  for (let j = 0; j < 4; j++) A0[0][j] = -den[j + 1];
  for (let i = 1; i < 4; i++) A0[i][i - 1] = 1;
  const c0 = [0, ...num];
  const T = [[1, 0.2, 0, 0.1], [0, 1, 0.3, 0], [0.1, 0, 1, 0.2], [0, 0.1, 0, 1]], Ti = inv(T);
  const zs = re(tzeros({ A: mul(mul(T, A0), Ti), B: mul(T, [1, 0, 0, 0]), C: mul([c0], Ti)[0] }));
  assert.equal(zs.length, 2);
  close(zs[0], 1, 1e-9);
  close(zs[1], -4, 1e-9);
  // With feedthrough: (s + 3)/(s + 1) = 1 + 2/(s + 1).
  close(re(tzeros({ A: [[-1]], B: [1], C: [2], D: 1 }))[0], -3, 1e-15);
  // A zero at the origin: s / (s + 1)².
  const origin = tzeros({ A: [[-2, -1], [1, 0]], B: [1, 0], C: [1, 0] });
  assert.equal(origin.length, 1);
  close(origin[0].re, 0, 1e-15);
  // No finite zeros: 1 / (s + 1)³, and G ≡ 0.
  assert.deepEqual(tzeros({ A: [[-3, -3, -1], [1, 0, 0], [0, 1, 0]], B: [1, 0, 0], C: [0, 0, 1] }), []);
  assert.deepEqual(tzeros({ A: [[-1]], B: [1], C: [0] }), []);
});

test('ctrb and rank', () => {
  const Cm = ctrb([[0, 1], [0, 0]], [[0], [1]]);
  assert.deepEqual(Cm, [[0, 1], [1, 0]]);
  assert.equal(rank(Cm), 2);
  assert.equal(rank(ctrb(CART_POLE.A, CART_POLE.B)), 4);
  // Two decoupled modes, input on one only: not controllable.
  assert.equal(rank(ctrb([[-1, 0], [0, -2]], [1, 0])), 1);
  assert.equal(rank([[1, 2, 3], [2, 4, 6], [1, 0, 1]]), 2);
  assert.equal(rank(zeros(3, 3)), 0);
  assert.equal(rank([[1, 1e-20]], 0), 1);
});
