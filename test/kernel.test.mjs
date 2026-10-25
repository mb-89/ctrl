// Identify's kernel reference (design/output/identification.md §6.8, test 10
// of §17): the TC kernel's tridiagonal inverse; the marginal likelihood and
// the posterior against the direct N×N formulas; the research's example; at
// most 40 evaluations; consistency under feedback, and why an integrator is
// fitted as a rate rather than on Δy; start values and the step response.
// The plants are simulated in fine steps, independently of fit.js
// (test/fixtures/continuous.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tcInverse, tcKernel, tcKernelSteps, kernelStep, kernelGuess, KERNEL, STRUCTURES } from '../src/core/fit.js';
import { inv, cholesky, cholSolve } from '../src/core/linalg.js';
import { gaussAt } from '../src/core/signals.js';
import { runPlant, piLaw, square, white } from './fixtures/continuous.mjs';

const Ts = 0.01;
// A seeded random binary input ±1, switching each sample at random.
const binary = (N, seed) => Float64Array.from({ length: N }, (_, k) => (gaussAt(seed, k) > 0 ? 1 : -1));
const tcK = (n, l) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => l ** (Math.max(i, j) + 1)));
const fitOf = (est, truth) => {
  const m = truth.reduce((s, v) => s + v, 0) / truth.length;
  let e = 0, d = 0;
  for (let i = 0; i < truth.length; i++) { e += (est[i] - truth[i]) ** 2; d += (truth[i] - m) ** 2; }
  return 100 * (1 - Math.sqrt(e / d));
};

test('10. kernel: the TC kernel\'s tridiagonal inverse equals the inverse, also where K is far too ill-conditioned to invert', () => {
  for (const [n, l] of [[1, 0.5], [2, 0.7], [20, 0.5], [20, 0.9], [30, 0.99]]) {
    const { diag, off } = tcInverse(n, l);
    const Ki = inv(tcK(n, l));
    const scale = Math.max(...diag);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const q = i === j ? diag[i] : Math.abs(i - j) === 1 ? off[Math.min(i, j)] : 0;
        assert.ok(Math.abs(q - Ki[i][j]) <= 1e-9 * scale, `n ${n} λ ${l} [${i}][${j}]: ${q} vs ${Ki[i][j]}`);
      }
    }
  }
  // 150 taps at λ 0.8: λ^150 ≈ 3e-15, so K's condition number is beyond 1e16;
  // K·K⁻¹ = I from the three bands alone.
  const n = 150, l = 0.8, K = tcK(n, l), { diag, off } = tcInverse(n, l);
  let worst = 0;
  for (let r = 0; r < n; r++) {
    for (let j = 0; j < n; j++) {
      let v = K[r][j] * diag[j];
      if (j > 0) v += K[r][j - 1] * off[j - 1];
      if (j < n - 1) v += K[r][j + 1] * off[j];
      worst = Math.max(worst, Math.abs(v - (r === j ? 1 : 0)));
    }
  }
  assert.ok(worst < 1e-12, `K·K⁻¹ − I: ${worst}`);
  assert.throws(() => tcInverse(5, 1), /λ/);
});

// The direct formulas on a small problem: Φ built by its definition (tap i
// is the mean of u over the lags iD + 1 … (i + 1)D), Σ = cΦKΦᵀ + σ²I (N×N).
function direct(u, y, n, D, { integrating = false } = {}) {
  const N = y.length;
  const Phi = Array.from({ length: N }, (_, k) => Array.from({ length: n }, (_, i) => {
    let s = 0;
    for (let l = i * D + 1; l <= (i + 1) * D; l++) s += k - l >= 0 ? u[k - l] : 0;
    return s / D;
  }));
  const x = Float64Array.from({ length: N }, (_, k) => { let s = 0; for (let t = 0; t < k; t++) s += u[t]; return s; });
  const parts = (c, lambda, s2) => {
    const K = tcK(n, lambda).map((r) => r.map((v) => c * v));
    const PK = Phi.map((row) => K.map((_, j) => row.reduce((s, v, i) => s + v * K[i][j], 0)));   // ΦcK
    const Sig = Phi.map((row, a) => Phi.map((row2, b) => PK[a].reduce((s, v, j) => s + v * row2[j], 0) + (a === b ? s2 : 0)));
    const L = cholesky(Sig);
    const logdet = 2 * L.reduce((s, r, i) => s + Math.log(r[i]), 0);
    return { K, PK, L, logdet };
  };
  const m2logL = (c, lambda, s2) => {
    const { L, logdet } = parts(c, lambda, s2);
    const Siy = cholSolve(L, Array.from(y));
    if (!integrating) return logdet + y.reduce((s, v, k) => s + v * Siy[k], 0) + N * Math.log(2 * Math.PI);
    const Six = cholSolve(L, Array.from(x));
    const xSx = x.reduce((s, v, k) => s + v * Six[k], 0), xSy = x.reduce((s, v, k) => s + v * Siy[k], 0);
    const r = xSy / xSx;
    const quad = y.reduce((s, v, k) => s + (v - r * x[k]) * (Siy[k] - r * Six[k]), 0);
    return logdet + Math.log(xSx) + quad + (N - 1) * Math.log(2 * Math.PI);
  };
  // The posterior mean and covariance of g (with the rate r: g = g̃ + D·r).
  const posterior = (c, lambda, s2) => {
    const { K, PK, L } = parts(c, lambda, s2);
    const Siy = cholSolve(L, Array.from(y)), Six = cholSolve(L, Array.from(x));
    let r = 0, V = 0, dm = new Array(n).fill(0);
    if (integrating) {
      const xSx = x.reduce((s, v, k) => s + v * Six[k], 0);
      r = x.reduce((s, v, k) => s + v * Siy[k], 0) / xSx;
      V = 1 / xSx;
      dm = K.map((_, i) => -PK.reduce((s, row, k) => s + row[i] * Six[k], 0));   // −cKΦᵀΣ⁻¹x
    }
    const res = Array.from(y, (v, k) => v - r * x[k]);
    const Sr = cholSolve(L, res);
    const gt = K.map((_, i) => PK.reduce((s, row, k) => s + row[i] * Sr[k], 0));   // cKΦᵀΣ⁻¹(y − xr)
    const SPK = cholSolve(L, PK);                                                     // Σ⁻¹ΦcK
    const P0 = K.map((row, i) => row.map((v, j) => v - PK.reduce((s, prow, k) => s + prow[i] * SPK[k][j], 0)));
    const g = gt.map((v) => v + D * r);
    const cov = P0.map((row, i) => row.map((v, j) => v + dm[i] * V * dm[j] + D * (dm[i] * V + dm[j] * V) + D * D * V));
    return { g, cov, r, V };
  };
  return { m2logL, posterior };
}

test('10. kernel: −2 log L equals the direct N×N formula at the hyperparameters found, they are its optimum, and the posterior is the direct one (a lag; an integrator with its rate integrated out)', () => {
  const N = 140, n = 12, D = 2, u = binary(N, 5);
  for (const [name, p, integrating] of [['lag', { K: 1, tau: 0.05, theta: 0.02 }, false], ['intLag', { kp: 3, tau: 0.04, theta: 0.01 }, true]]) {
    const clean = runPlant(STRUCTURES[name].tf(p), Ts, N, { u }).y;
    const y = Float64Array.from(clean, (v, k) => v + 0.05 * gaussAt(9, k));
    const k = tcKernel(u, y, { n, decimate: D, integrating });
    const { c, lambda, sigma2 } = k.hyper;
    const dr = direct(u, y, n, D, { integrating });
    const at = dr.m2logL(c, lambda, sigma2);
    assert.ok(Math.abs(at - k.logLik) < 1e-9 * Math.abs(at), `${name}: −2 log L ${k.logLik} vs direct ${at}`);
    // A local optimum: 1 % changes of c, σ² and of λ's decay all raise it.
    const a = -n * Math.log(lambda);
    for (const f of [0.99, 1.01]) {
      for (const q of [dr.m2logL(c * f, lambda, sigma2), dr.m2logL(c, lambda, sigma2 * f), dr.m2logL(c, Math.exp(-(a * f) / n), sigma2)]) {
        assert.ok(q >= at - 1e-7, `${name}: a 1 % change lowers −2 log L: ${q} < ${at}`);
      }
    }
    const post = dr.posterior(c, lambda, sigma2);
    const gs = Math.max(...post.g.map(Math.abs));
    post.g.forEach((v, i) => assert.ok(Math.abs(v - k.g[i]) < 1e-8 * gs, `${name}: g[${i}] ${k.g[i]} vs ${v}`));
    const cs = Math.max(...post.cov.map((r, i) => r[i]));
    post.cov.forEach((row, i) => row.forEach((v, j) => assert.ok(Math.abs(v - k.cov[i][j]) < 1e-7 * cs, `${name}: cov[${i}][${j}] ${k.cov[i][j]} vs ${v}`)));
    if (integrating) {
      assert.ok(Math.abs(k.rate.value - post.r) < 1e-9 * Math.abs(post.r), `rate ${k.rate.value} vs ${post.r}`);
      assert.ok(Math.abs(k.rate.sd - Math.sqrt(post.V)) < 1e-7 * Math.sqrt(post.V), `rate sd ${k.rate.sd} vs ${Math.sqrt(post.V)}`);
      assert.ok(Math.abs(k.rate.value / Ts - p.kp) < 0.05 * p.kp, `k′ ${k.rate.value / Ts}`);
    }
  }
});

test('10. kernel: the research\'s example 2e^(−0.1s)/((0.5s + 1)(0.1s + 1)), 30 s, SNR 3: the impulse response fits to at least 94 %, in at most 40 evaluations', (t) => {
  // Ts 10 ms, a random binary input ±1, 3000 samples; SNR 3: the noise-free
  // y's standard deviation is 3 × the noise's. 150 taps of 20 ms cover 3 s.
  // The truth per tap is the step response's rise over the tap's lags (the
  // exact zero-order-hold impulse response, summed), from the analytic step.
  const S = (t) => (t <= 0.1 ? 0 : 2 * (1 - (0.5 * Math.exp(-(t - 0.1) / 0.5) - 0.1 * Math.exp(-(t - 0.1) / 0.1)) / 0.4));
  const N = 3000, n = 150, D = 2;
  const truth = Array.from({ length: n }, (_, i) => S((i + 1) * D * Ts) - S(i * D * Ts));
  const tf = { num: [2], den: [0.05, 0.6, 1], delay: 0.1 };
  const fits = [];
  for (let seed = 1; seed <= 10; seed++) {
    const u = binary(N, 100 + seed);
    const clean = runPlant(tf, Ts, N, { u }).y;
    const m = clean.reduce((s, v) => s + v, 0) / N;
    const sigma = Math.sqrt(clean.reduce((s, v) => s + (v - m) ** 2, 0) / N) / 3;
    const y = Float64Array.from(clean, (v, k) => v + sigma * gaussAt(seed, k));
    const k = tcKernel(u, y, { cover: 300, Ts });
    assert.equal(k.n, n);
    assert.equal(k.decimate, D);
    assert.ok(k.evaluations <= KERNEL.maxEvaluations, `seed ${seed}: ${k.evaluations} evaluations`);
    const fit = fitOf(k.g, truth);
    fits.push(fit);
    assert.ok(fit >= 94, `seed ${seed}: the impulse response fits ${fit.toFixed(2)} %`);
    // The gain within its ±3σ (1.93 … 2.05 over these seeds).
    const st = kernelStep(k);
    assert.ok(Math.abs(st.s[n] - 2) < 3 * st.sd[n] && Math.abs(st.s[n] - 2) < 0.08, `seed ${seed}: gain ${st.s[n]} ± ${st.sd[n]}`);
    // The noise variance the marginal likelihood finds is the noise's.
    assert.ok(Math.abs(Math.sqrt(k.hyper.sigma2) / sigma - 1) < 0.06, `seed ${seed}: σ ${Math.sqrt(k.hyper.sigma2)} vs ${sigma}`);
  }
  const mean = fits.reduce((s, v) => s + v, 0) / fits.length;
  t.diagnostic(`impulse-response fit ${Math.min(...fits).toFixed(2)} … ${Math.max(...fits).toFixed(2)} %, mean ${mean.toFixed(2)} %`);
  assert.ok(mean >= 94.5, `mean fit ${mean}`);
});

test('10. kernel: at most 40 evaluations whatever the data, one yield per evaluation; a u that never moves is refused', () => {
  const N = 1200, u = binary(N, 3);
  const cases = [
    ['noise only', Float64Array.from({ length: N }, (_, k) => 0.1 * gaussAt(4, k)), {}],
    ['a pure delay', Float64Array.from({ length: N }, (_, k) => (k >= 7 ? u[k - 7] : 0) + 0.01 * gaussAt(5, k)), {}],
    ['far slower than the taps', runPlant({ num: [1], den: [20, 1], delay: 0 }, Ts, N, { u }).y, {}],
    ['an integrator', runPlant({ num: [2], den: [0.1, 1, 0], delay: 0.02 }, Ts, N, { u, noise: white(0.01, 6) }).y, { integrating: true }],
  ];
  for (const [what, y, opts] of cases) {
    let yields = 0;
    const gen = tcKernelSteps(u, y, { n: 60, ...opts });
    let s;
    while (!(s = gen.next()).done) yields++;
    assert.ok(s.value.evaluations <= KERNEL.maxEvaluations && s.value.evaluations >= KERNEL.grid.length, `${what}: ${s.value.evaluations} evaluations`);
    assert.equal(yields, s.value.evaluations, `${what}: a yield per evaluation`);
    assert.ok(s.value.g.every(Number.isFinite) && s.value.sd.every(Number.isFinite), what);
  }
  // Noise only: nothing found (every tap within 3σ of 0).
  const k = tcKernel(u, cases[0][1], { n: 60 });
  assert.ok(k.g.every((v, i) => Math.abs(v) <= 3 * k.sd[i] + 1e-12), 'noise only: the taps are 0 within their bars');
  assert.throws(() => tcKernel(new Float64Array(N), cases[0][1], { n: 60, integrating: true }), /does not move/);
  assert.throws(() => tcKernel(u, cases[0][1], { n: 151 }), /taps/);
});

test('10. kernel under feedback: consistent with white noise (every regressor is in the past); an integrator is fitted as a rate, where Δy would be biased', (t) => {
  const N = 6000;
  const cases = [
    ['lag', { K: 2, tau: 0.3, theta: 0.0237 }, 0.4, 1.5, false],
    ['intLag', { kp: 3, tau: 0.15, theta: 0.031 }, 0.3, 0.1, true],
  ];
  for (const [name, p, Kp, Ki, integrating] of cases) {
    const tf = STRUCTURES[name].tf(p);
    const law = piLaw(Kp, Ki, square(N, 0, 0.5, 300), Ts);
    const steady = [], direct = [];
    for (let seed = 1; seed <= 4; seed++) {
      const run = runPlant(tf, Ts, N, { law, noise: white(0.02, seed) });
      const k = tcKernel(run.u, run.y, { cover: 300, integrating, Ts });
      if (integrating) {
        steady.push((k.rate.value / Ts - p.kp) / (k.rate.sd / Ts));
        // The same record on Δy, as a plant that settles: its sum is the rate per sample.
        const dy = Float64Array.from(run.y, (v, i) => v - (i ? run.y[i - 1] : 0));
        const kd = tcKernel(run.u, dy, { cover: 300, Ts });
        direct.push(kd.g.reduce((s, v) => s + v, 0) / Ts);
      } else {
        const st = kernelStep(k);
        steady.push((st.s[k.n] - p.K) / st.sd[k.n]);
      }
    }
    for (const z of steady) assert.ok(Math.abs(z) < 3, `${name}: the steady gain is ${z.toFixed(2)} σ from the truth`);
    if (integrating) {
      // Δy's noise is coloured (v[k] − v[k−1]) and the loop feeds it back: k′ comes out 10–20 % high.
      const mean = direct.reduce((s, v) => s + v, 0) / direct.length;
      t.diagnostic(`${name}: as a rate, k′ within ${steady.map((z) => z.toFixed(2)).join(', ')} σ; on Δy, k′ ${direct.map((v) => v.toFixed(2)).join(', ')} (true ${p.kp})`);
      assert.ok(mean > 1.08 * p.kp, `on Δy: k′ ${mean}`);
    }
  }
});

test('10. kernel: the step response sums the taps with its band from the covariance; start values from the kernel', () => {
  const N = 4000;
  const cases = [
    ['lags', { K: 2, tau1: 0.5, tau2: 0.1, theta: 0.1 }, false],
    ['resonance', { K: 0.5, f: 1.2, zeta: 0.2, theta: 0.013 }, false],
    ['intLag', { kp: 3, tau: 0.15, theta: 0.031 }, true],
  ];
  for (const [name, p, integrating] of cases) {
    const u = binary(N, 8);
    const y = runPlant(STRUCTURES[name].tf(p), Ts, N, { u, noise: white(0.01, 2) }).y;
    const k = tcKernel(u, y, { cover: 400, integrating, Ts });
    const st = kernelStep(k, k.n + 20);
    // The sums, and the variance of a sum from the covariance, by their definitions.
    for (const I of [1, 17, k.n]) {
      let s = 0, v = 0;
      for (let i = 0; i < I; i++) { s += k.g[i]; for (let j = 0; j < I; j++) v += k.cov[i][j]; }
      assert.ok(Math.abs(st.s[I] - s) < 1e-12 * Math.max(1, Math.abs(s)), `${name} s[${I}]`);
      assert.ok(Math.abs(st.sd[I] - Math.sqrt(v)) < 1e-9 * Math.sqrt(v), `${name} sd[${I}]`);
    }
    assert.ok(Math.abs(st.t[k.n] - k.n * k.decimate * Ts) < 1e-12);
    // Past the last tap: flat, or rising by D·r per tap for an integrator.
    const past = st.s[k.n + 20] - st.s[k.n];
    if (integrating) assert.ok(Math.abs(past - 20 * k.decimate * k.rate.value) < 1e-12 * Math.abs(past));
    else assert.equal(past, 0);
    const g = kernelGuess(k, Ts);
    if (name === 'lags') {
      assert.ok(Math.abs(g.K - 2) < 0.04 && g.theta > 0.1 && g.theta < 0.2 && g.tau > 0.4 && g.tau < 0.7, JSON.stringify(g));
      assert.equal(g.zeta, undefined, 'two lags do not overshoot');
    }
    if (name === 'resonance') assert.ok(Math.abs(g.K - 0.5) < 0.02 && Math.abs(g.f / p.f - 1) < 0.15 && Math.abs(g.zeta / p.zeta - 1) < 0.3, JSON.stringify(g));
    if (name === 'intLag') assert.ok(Math.abs(g.kp / p.kp - 1) < 0.02 && g.tau > 0.08 && g.tau < 0.3 && g.theta < 0.08, JSON.stringify(g));
    // The guess is a start the structures take.
    assert.ok(Object.values(STRUCTURES[name].start(g)).every(Number.isFinite));
  }
});
