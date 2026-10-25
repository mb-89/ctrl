// Identify's numerics (design/output/identification.md §6–7, tests 6, 7, 8
// and 11 of §17): the structures, exact discretisation with a fractional
// dead time, Levenberg–Marquardt, fits on noise-free data, the choice rule,
// fit %, whiteness and cross-correlation. Each routine is checked against an
// independent computation: a fine-step simulation of the transfer function
// (test/fixtures/continuous.mjs), known optima, LU, an FFT.
// The noisy fits (coverage, bias under feedback, choice on clean data) are
// in fit-noise.test.mjs, which runs beside this file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRUCTURES, discretise, simulateSegment, lm, fitStructure, fitPercent, noiseCeiling, whiteness, crossCorrelation, Z99, chooseStructure, unsupported, CHOICE } from '../src/core/fit.js';
import { freqResp, solve } from '../src/core/linalg.js';
import { fft, nextPow2 } from '../src/core/spectrum.js';
import { gaussAt } from '../src/core/signals.js';
import { contSim, runPlant, piLaw, doublets, square } from './fixtures/continuous.mjs';

const Ts = 0.01;
// One plant per structure, each with a dead time that is not a whole number
// of samples (intRes: none).
const TRUTH = {
  lag: { K: 2, tau: 0.3, theta: 0.0237 },
  lags: { K: -1.5, tau1: 0.4, tau2: 0.12, theta: 0.053 },
  resonance: { K: 0.5, f: 1.2, zeta: 0.2, theta: 0.013 },
  intLag: { kp: 3, tau: 0.15, theta: 0.031 },
  intRes: { kp: 1.2, f: 2, zeta: 0.3, theta: 0 },
};
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);

// A piecewise-constant input with seeded levels and holds.
function steps(N, seed) {
  const u = new Float64Array(N);
  let v = 0;
  for (let k = 0; k < N; k++) {
    if (k % 23 === 0) v = gaussAt(seed, k);
    u[k] = v;
  }
  return u;
}

test('6. discretise: exact zero-order hold with a fractional dead time equals a fine-step simulation of each transfer function', () => {
  const N = 400, u = steps(N, 3);
  for (const [name, p] of Object.entries(TRUTH)) {
    // Whole samples, fractions, under one sample, just under a whole one.
    for (const theta of [0, p.theta, 0.03, 0.005, 0.0999, 0.0237]) {
      const q = { ...p, theta };
      const d = discretise(name, q, Ts);
      assert.ok(Math.abs((d.m + d.f) * Ts - theta) < 1e-15 && d.f >= 0 && d.f < 1, `${name} θ ${theta}: m ${d.m}, f ${d.f}`);
      const { y } = simulateSegment(d, { u, n: N });
      const tf = STRUCTURES[name].tf(q);
      const cs = contSim(tf.num, tf.den, theta, Ts, 60);
      let err = 0, amp = 0;
      for (let k = 0; k < N; k++) {
        const yc = cs.output();
        err = Math.max(err, Math.abs(yc - y[k]));
        amp = Math.max(amp, Math.abs(yc));
        cs.advance(u[k]);
      }
      assert.ok(amp > 0.1 && err < 1e-10 * amp, `${name} θ ${theta}: ${err} against ${amp}`);
    }
  }
});

test('6. discretise: a segment replays at rest about its start, driven by u − uStart, and a closed-loop law reads the model', () => {
  const d = discretise('lag', { K: 2, tau: 0.3, theta: 0.02 }, Ts);
  const u = Float64Array.from({ length: 50 }, () => 3);
  const { y } = simulateSegment(d, { u, n: 50, yStart: 1.5, uStart: 3 });
  assert.ok(y.every((v) => v === 1.5), 'u held at uStart: y stays at yStart');
  // The law reads ŷ: a P law around 1.5 → the loop settles where the P law says.
  const law = () => (k, yh) => 3 + 0.5 * (2 - yh);
  const s = simulateSegment(d, { law, n: 2000, yStart: 1.5, uStart: 3 });
  // Δy = 2·Δu, Δu = 0.5(2 − 1.5 − Δy) → Δy = 0.25.
  assert.ok(Math.abs(s.y[1999] - 1.75) < 1e-9, `${s.y[1999]}`);
  assert.ok(Math.abs(s.u[1999] - 3.125) < 1e-9, `${s.u[1999]}`);
});

test('6. lm: known optima (Rosenbrock, an exponential decay, linear least squares as LU solves it), a bound, bit for bit', () => {
  // Rosenbrock as least squares: r = (10 (y − x²), 1 − x), minimum (1, 1).
  const rosen = (p) => Float64Array.of(10 * (p[1] - p[0] * p[0]), 1 - p[0]);
  const a = lm(rosen, [-1.2, 1], { maxIter: 200 });
  assert.ok(a.converged && Math.abs(a.p[0] - 1) < 1e-8 && Math.abs(a.p[1] - 1) < 1e-8 && a.cost < 1e-16, `${a.p} ${a.cost} ${a.why}`);
  // y = 3 e^(−0.7 t) + 0.4, noise-free, from far away.
  const t = Float64Array.from({ length: 60 }, (_, i) => i * 0.1);
  const yd = t.map((x) => 3 * Math.exp(-0.7 * x) + 0.4);
  const b = lm((p) => yd.map((v, i) => v - (p[0] * Math.exp(-p[1] * t[i]) + p[2])), [1, 2, 0], { maxIter: 100 });
  assert.ok(rel(b.p[0], 3) < 1e-9 && rel(b.p[1], 0.7) < 1e-9 && rel(b.p[2], 0.4) < 1e-9, `${b.p}`);
  // A linear problem: the optimum is the normal equations' solution (LU).
  const X = Array.from({ length: 30 }, (_, i) => [1, i / 10, Math.sin(i)]);
  const z = X.map((row, i) => 0.3 + 0.2 * row[1] - 1.1 * row[2] + 0.05 * gaussAt(5, i));
  const XtX = [0, 1, 2].map((i) => [0, 1, 2].map((j) => X.reduce((s, r) => s + r[i] * r[j], 0)));
  const Xtz = [0, 1, 2].map((i) => X.reduce((s, r, k) => s + r[i] * z[k], 0));
  const exact = solve(XtX, Xtz);
  const c = lm((p) => Float64Array.from(z, (v, i) => v - (p[0] * X[i][0] + p[1] * X[i][1] + p[2] * X[i][2])), [0, 0, 0]);
  exact.forEach((v, i) => assert.ok(Math.abs(c.p[i] - v) < 1e-9, `${c.p} vs ${exact}`));
  // A bound: min (p + 1)² with p ≥ 0 sits at the bound, held there.
  const d = lm((p) => Float64Array.of(p[0] + 1), [2], { lower: [0] });
  assert.equal(d.p[0], 0);
  assert.ok(d.converged, d.why);
  // Deterministic: the same call gives the same bits.
  const a2 = lm(rosen, [-1.2, 1], { maxIter: 200 });
  assert.deepEqual(a2.p, a.p);
  assert.equal(a2.iterations, a.iterations);
  // The cap holds.
  assert.equal(lm(rosen, [-1.2, 1], { maxIter: 3 }).iterations, 3);
});

// Starts as a first look would give them: the gain 30 % off, the time scale
// 60 % long, no dead time; and a second one the other way.
function startsFor(name, p) {
  const S = STRUCTURES[name];
  const scale = p.tau ?? p.tau1 ?? 1 / (2 * Math.PI * p.f);
  const gain = S.integrating ? { kp: 0.7 * p.kp } : { K: 0.7 * p.K };
  return [
    S.start({ ...gain, tau: 1.6 * scale, f: p.f ? 1.2 * p.f : undefined, zeta: p.zeta ? 0.5 : undefined, theta: 0 }),
    S.start({ ...(S.integrating ? { kp: 1.4 * p.kp } : { K: 1.4 * p.K }), tau: 0.6 * scale, f: p.f ? 0.85 * p.f : undefined, zeta: p.zeta ? 1.5 * p.zeta : undefined, theta: 2 * (p.theta || Ts) }),
  ];
}

test('6. lm: the damping has no units, so a uniform weight (1/floor²) leaves the path unchanged', () => {
  // The same lag fitted with the weights a noisy plant (1), a quiet one and
  // a noise-free simulation (floor 1e-5 of the band) give; powers of two, so
  // the scaling itself is exact and the paths must be the same bit for bit.
  // (With the damping scaled by max diag(JᵀJ), as first built, the second
  // start took 11, 29 and 1 iterations, the last stuck where it started.)
  const p = { K: 2, tau: 0.3, theta: 0.0237 }, N = 600;
  const run = runPlant(STRUCTURES.lag.tf(p), Ts, N, { u: doublets(N) });
  const noisy = Float64Array.from(run.y, (v, k) => v + 0.01 * gaussAt(4, k));
  for (const start of [{ K: 1, tau: 0.8, theta: 0.01 }, { K: 4, tau: 0.05, theta: 0.1 }]) {
    const fits = [1, 2 ** 20, 2 ** 40].map((weight) => fitStructure([{ y: noisy, u: run.u, yStart: 0, uStart: 0, weight }], 'lag', [start], { Ts }));
    for (const f of fits.slice(1)) {
      assert.equal(f.iterations, fits[0].iterations, `iterations ${fits.map((x) => x.iterations)}`);
      for (const k of ['K', 'tau', 'theta']) assert.ok(Object.is(f.p[k], fits[0].p[k]), `${k}: ${f.p[k]} against ${fits[0].p[k]}`);
    }
    assert.ok(Math.abs(fits[0].p.K - p.K) < 0.01 && Math.abs(fits[0].p.tau - p.tau) < 0.01, JSON.stringify(fits[0].p));
  }
});

test('6. fits: each structure recovers known parameters from noise-free data, open loop and closed loop (the replay)', () => {
  const N = 1500;
  for (const [name, p] of Object.entries(TRUTH)) {
    const S = STRUCTURES[name], tf = S.tf(p);
    const open = runPlant(tf, Ts, N, { u: doublets(N) });
    const fo = fitStructure([{ y: open.y, u: open.u }], name, startsFor(name, p), { Ts });
    // Closed loop: a PI on reference steps, replayed with the same law.
    const g = S.integrating ? p.kp : p.K;
    const law = piLaw(0.3 / g, (S.integrating ? 0.05 : 1) / g, square(N, 0, 0.5, 300), Ts);
    const closed = runPlant(tf, Ts, N, { law });
    const fc = fitStructure([{ y: closed.y, law }], name, startsFor(name, p), { Ts });
    for (const [how, f] of [['open', fo], ['closed', fc]]) {
      // The design asks 1 %; the replay is exact, so it lands at rounding.
      for (const k of S.params) assert.ok(p[k] === 0 ? Math.abs(f.p[k]) < 1e-9 : rel(f.p[k], p[k]) < 1e-6, `${name} ${how}: ${k} ${f.p[k]} vs ${p[k]}`);
      assert.ok(f.cost < 1e-12 * N, `${name} ${how}: cost ${f.cost}`);
    }
  }
});

test('6. fits: segments end to end, weights, two lags come out slower first, and the gain keeps its sign', () => {
  const N = 600, p = TRUTH.lags, tf = STRUCTURES.lags.tf(p);
  const a = runPlant(tf, Ts, N, { u: doublets(N) }), b = runPlant(tf, Ts, N, { u: doublets(N, -0.5, 8) });
  // Start with τ₁ < τ₂: the result is still τ₁ ≥ τ₂.
  const f = fitStructure([{ y: a.y, u: a.u, weight: 4 }, { y: b.y, u: b.u }], 'lags', [{ K: -1, tau1: 0.1, tau2: 0.5, theta: 0 }], { Ts });
  assert.ok(f.p.tau1 >= f.p.tau2 && rel(f.p.tau1, p.tau1) < 1e-6 && rel(f.p.tau2, p.tau2) < 1e-6, JSON.stringify(f.p));
  assert.ok(f.p.K < 0 && rel(f.p.K, p.K) < 1e-6);
  assert.equal(f.n, 2 * (N - 1));
  assert.throws(() => fitStructure([{ y: a.y, u: a.u }], 'lags', [{ K: 0, tau1: 1, tau2: 1 }], { Ts }), /needs K ≠ 0/);
  assert.throws(() => fitStructure([{ y: a.y, u: a.u }], 'nope', [{}], { Ts }), /unknown structure/);
});

test('7. choice rule: the fewest parameters within 1 point of the best Check fit; BIC among those; ✕ fits are passed over', () => {
  const c = (structure, fit, bic, un = null) => ({ structure, fit, bic, unsupported: un });
  // Two lags is 0.7 below the best and has 4 parameters, like the resonance; lag is 1.5 below.
  let ch = chooseStructure([c('lag', 95.0, 100), c('lags', 95.8, 90), c('resonance', 96.5, 70)]);
  assert.equal(ch.index, 2, 'same size: the lower BIC (the resonance)');
  ch = chooseStructure([c('lag', 95.6, 100), c('lags', 95.8, 90), c('resonance', 96.5, 70)]);
  assert.equal(ch.index, 0, 'lag is within 1 point and has the fewest parameters');
  assert.match(ch.why, /simplest within 1 point/);
  // A BIC difference below CHOICE.bicTie decides nothing: the earlier structure.
  ch = chooseStructure([c('resonance', 99.6, 30.5), c('lags', 99.6, 31)]);
  assert.equal(ch.index, 1);
  ch = chooseStructure([c('resonance', 99.6, 30.5 - CHOICE.bicTie - 1), c('lags', 99.6, 31)]);
  assert.equal(ch.index, 0);
  // The best but not supported: the next one.
  ch = chooseStructure([c('lag', 90, 10), c('resonance', 99, 5, 'ζ 7 is above 5')]);
  assert.equal(ch.index, 0);
  // None supported: the rule still picks, and says so.
  ch = chooseStructure([c('lag', 90, 10, 'x'), c('resonance', 99, 5, 'y')]);
  assert.equal(ch.index, 1);
  assert.match(ch.why, /none is supported/);
  // What is not supported: ζ above 5, a time constant beyond 10 test lengths.
  assert.match(unsupported('resonance', { K: 1, f: 1, zeta: 6, theta: 0 }), /ζ 6\.0 is above 5/);
  assert.match(unsupported('lag', { K: 1, tau: 2000, theta: 0 }, { length: 120 }), /more than 10 × the test's length/);
  assert.match(unsupported('intRes', { kp: 1, f: 0.0001, zeta: 0.5, theta: 0 }, { length: 120 }), /time constant/);
  assert.equal(unsupported('intLag', { kp: 1, tau: 0.2, theta: 0 }, { length: 120 }), null, 'the integrator itself is fine');
  assert.equal(unsupported('lags', { K: 1, tau1: 1, tau2: 0.1, theta: 0.1 }, { length: 120 }), null);
});

test('8. fit %: MATLAB compare\'s definition, 100 (1 − ‖y − ŷ‖ / ‖y − ȳ‖), and the noise ceiling', () => {
  // By hand: y = (1, 2, 3), ŷ = (1, 2, 4): ‖e‖ = 1, ‖y − ȳ‖ = √2.
  assert.ok(Math.abs(fitPercent([1, 2, 3], [1, 2, 4]) - 100 * (1 - 1 / Math.SQRT2)) < 1e-12);
  assert.equal(fitPercent([1, 2, 3], [1, 2, 3]), 100);
  assert.ok(Math.abs(fitPercent([1, 2, 3], [2, 2, 2])) < 1e-12, 'the mean scores 0');
  assert.ok(fitPercent([1, 2, 3], [3, 2, 1]) < 0, 'worse than the mean is negative');
  // Against the formula written out once more, on a long record.
  const y = Float64Array.from({ length: 999 }, (_, k) => Math.sin(k / 30) + 0.1 * gaussAt(1, k));
  const yh = Float64Array.from({ length: 999 }, (_, k) => Math.sin(k / 30));
  const m = y.reduce((s, v) => s + v, 0) / y.length;
  const nrmse = Math.hypot(...y.map((v, k) => v - yh[k])) / Math.hypot(...y.map((v) => v - m));
  assert.ok(Math.abs(fitPercent(y, yh) - 100 * (1 - nrmse)) < 1e-9);
  // The ceiling: a model that leaves exactly the noise reaches it, near enough.
  assert.ok(Math.abs(noiseCeiling(y, 0.1) - fitPercent(y, yh)) < 0.5, `${noiseCeiling(y, 0.1)} vs ${fitPercent(y, yh)}`);
  assert.throws(() => fitPercent([1, 2], [1]), /differ in length/);
});

// The correlation Σ a[k] b[k−τ] for τ = 0 … L by a zero-padded FFT: the
// independent check of whiteness and crossCorrelation.
function fftCorr(a, b, L) {
  const n = nextPow2(2 * a.length);
  const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n);
  ar.set(a); br.set(b);
  fft(ar, ai); fft(br, bi);
  // A·conj(B), then the inverse transform as conj(fft(conj(·)))/n.
  const zr = new Float64Array(n), zi = new Float64Array(n);
  for (let k = 0; k < n; k++) { zr[k] = ar[k] * br[k] + ai[k] * bi[k]; zi[k] = -(ai[k] * br[k] - ar[k] * bi[k]); }
  fft(zr, zi);
  return Float64Array.from({ length: L + 1 }, (_, t) => zr[t] / n);
}

test('8. whiteness: the band is ±2.58/√N, the correlations equal an FFT\'s, white noise passes, a pattern or an offset does not', () => {
  const N = 2000;
  const e = Float64Array.from({ length: N }, (_, k) => gaussAt(11, k));
  const w = whiteness(e);
  assert.equal(w.band, 2.58 / Math.sqrt(N));
  assert.equal(Z99, 2.58);
  assert.equal(w.r.length, 25);
  const c = fftCorr(e, e, 25);
  for (let t = 1; t <= 25; t++) assert.ok(Math.abs(w.r[t - 1] - c[t] / c[0]) < 1e-12, `lag ${t}`);
  // White noise: at most one lag of 25 outside, in nearly every seed (P ≈ 0.97 each).
  let white = 0;
  for (let seed = 1; seed <= 40; seed++) if (whiteness(Float64Array.from({ length: N }, (_, k) => gaussAt(seed, k))).white) white++;
  assert.ok(white >= 36, `${white} of 40 white`);
  // A pattern: AR(1) noise, and white noise riding on an offset (no mean is removed).
  const ar = new Float64Array(N);
  for (let k = 1; k < N; k++) ar[k] = 0.5 * ar[k - 1] + gaussAt(12, k);
  assert.equal(whiteness(ar).white, false);
  assert.ok(Math.abs(whiteness(ar).r[0] - 0.5) < 0.05, `${whiteness(ar).r[0]}`);
  assert.equal(whiteness(e.map((v) => v + 0.5)).white, false);
  // One lag far outside is a pattern too (an echo 3 samples later).
  const echo = whiteness(e.map((v, k) => v + (k >= 3 ? 0.3 * e[k - 3] : 0)));
  assert.equal(echo.outside, 1);
  assert.equal(echo.white, false);
});

test('8. cross-correlation with past u: equals an FFT\'s; a residual that carries u from 7 samples before shows it there', () => {
  const N = 2000;
  const u = Float64Array.from({ length: N }, (_, k) => 2 + gaussAt(21, k));
  const e = Float64Array.from({ length: N }, (_, k) => gaussAt(22, k));
  const x = crossCorrelation(e, u);
  assert.equal(x.r.length, 26);
  assert.equal(x.band, 2.58 / Math.sqrt(N));
  const ut = u.map((v) => v - u.reduce((s, q) => s + q, 0) / N);
  const c = fftCorr(e, ut, 25), ee = fftCorr(e, e, 0)[0], uu = fftCorr(ut, ut, 0)[0];
  for (let t = 0; t <= 25; t++) assert.ok(Math.abs(x.r[t] - c[t] / Math.sqrt(ee * uu)) < 1e-12, `lag ${t}`);
  assert.ok(x.independent, `${x.outside} outside`);
  const e2 = e.map((v, k) => v + (k >= 7 ? 0.3 * (u[k - 7] - 2) : 0));
  const x2 = crossCorrelation(e2, u);
  assert.equal(x2.independent, false);
  const worst = x2.r.reduce((m, v, i) => (Math.abs(v) > Math.abs(x2.r[m]) ? i : m), 0);
  assert.equal(worst, 7);
});

test('11 (part). each structure\'s state space realises its transfer function; chain, start and times', () => {
  // linearModel(model) wraps STRUCTURES[s].ss in identify.js (step 5); here
  // the realisation itself, against the polynomials evaluated at jω.
  const cdiv = (a, b) => { const d = b.re * b.re + b.im * b.im; return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }; };
  const horner = (c, w) => c.reduce((acc, v) => ({ re: acc.re * 0 - acc.im * w + v, im: acc.re * w + acc.im * 0 }), { re: 0, im: 0 });
  for (const [name, p] of Object.entries(TRUTH)) {
    const S = STRUCTURES[name];
    const { A, B, C, D, states } = S.ss(p);
    assert.equal(states.length, A.length);
    const tf = S.tf(p);
    assert.equal(tf.delay, p.theta);
    for (const w of [0.05, 0.7, 3, 7.54, 20, 300]) {
      const g = freqResp({ A, B, C, D: D[0][0] }, w), h = cdiv(horner(tf.num, w), horner(tf.den, w));
      assert.ok(Math.hypot(g.re - h.re, g.im - h.im) < 1e-9 * Math.hypot(h.re, h.im), `${name} at ${w}: ${JSON.stringify(g)} vs ${JSON.stringify(h)}`);
    }
    // The chain names every parameter once, with its unit, the gain first.
    const chain = S.chain(p, { units: { u: 'V', y: 'rad' } });
    assert.deepEqual(chain.filter((e) => e.key).map((e) => e.key).sort(), [...S.params].sort());
    assert.equal(chain[0].kind, 'gain');
    assert.equal(chain[0].unit, S.integrating ? 'rad/(V·s)' : 'rad/V');
    assert.equal(chain.some((e) => e.kind === 'integrator'), S.integrating);
    assert.ok(chain.every((e) => typeof e.tip === 'string' && e.tip.length > 10));
    // Starts from a first look carry the gain's sign and fill what it lacks.
    const st = S.start({ K: -2, tau: 0.5, theta: 0.01 });
    assert.ok(S.params.every((k) => Number.isFinite(st[k])), JSON.stringify(st));
    assert.ok((st.K ?? st.kp) < 0);
    assert.ok(S.times(p).every((t) => t > 0));
  }
  // The resonance's time constants: the envelope when it swings, two lags when it does not.
  assert.ok(Math.abs(STRUCTURES.resonance.times({ f: 1, zeta: 0.5 })[0] - 1 / (0.5 * 2 * Math.PI)) < 1e-12);
  const [slow, fast] = STRUCTURES.resonance.times({ f: 1 / (2 * Math.PI), zeta: 1.25 });   // poles −0.5, −2
  assert.ok(Math.abs(slow - 2) < 1e-12 && Math.abs(fast - 0.5) < 1e-12, `${slow} ${fast}`);
});
