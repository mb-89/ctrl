// Identify's Shake numerics (design/output/identification.md §5.6 and §6.7,
// tests 8 and 9 of §17): the random-odd multisine and its lines; the
// frequency response from whole periods, exact on a linear plant in closed
// loop, its bars under noise with the U–Y covariance feedback brings; a
// period with a seq gap dropped; the nonlinear distortion at the detection
// lines. Plants are simulated in fine steps, independently of fit.js
// (test/fixtures/continuous.mjs); spectra are checked against direct DFT sums.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frf, multisine, multisineLines, crestFactor, wholePeriods, discretise, STRUCTURES, MULTISINE } from '../src/core/fit.js';
import { csolve } from '../src/core/linalg.js';
import { runPlant, white } from './fixtures/continuous.mjs';

const Ts = 0.01;
const dft = (x, k) => {
  let re = 0, im = 0;
  for (let t = 0; t < x.length; t++) { const a = (-2 * Math.PI * k * t) / x.length; re += x[t] * Math.cos(a); im += x[t] * Math.sin(a); }
  return { re, im };
};
const cabs = (z) => Math.hypot(z.re, z.im);
const cdiv = (a, b) => { const q = b.re * b.re + b.im * b.im; return { re: (a.re * b.re + a.im * b.im) / q, im: (a.im * b.re - a.re * b.im) / q }; };

// The exact discrete transfer function of a structure under the zero-order
// hold at harmonic k of the period N: C (zI − Φ)⁻¹ (Γ0 + Γ1 z⁻¹) z^(−m).
function Gd(name, p, N, k) {
  const d = discretise(name, p, Ts), n = d.n, w = (2 * Math.PI * k) / N, c = Math.cos(w), s = Math.sin(w);
  const x = csolve(d.Phi.map((r, i) => r.map((v, j) => (i === j ? c : 0) - v)), d.Phi.map((r, i) => r.map((_, j) => (i === j ? s : 0))), d.G0.map((g, i) => g + d.G1[i] * c), d.G1.map((g) => -g * s));
  let re = 0, im = 0;
  for (let i = 0; i < n; i++) { re += d.C[i] * x.xr[i]; im += d.C[i] * x.xi[i]; }
  const a = -w * d.m;
  return { re: re * Math.cos(a) - im * Math.sin(a), im: re * Math.sin(a) + im * Math.cos(a) };
}

// A PI on r − y with the multisine s added to its output, as the Shake rides it.
const shakeLaw = (Kp, Ki, r, s) => () => {
  let I = 0;
  return (k, y) => { const e = r - y; const u = Kp * e + I + s[k % s.length]; I += Ki * Ts * e; return u; };
};
const periods = (run, N, idx) => [idx.map((i) => run.u.slice(i * N, (i + 1) * N)), idx.map((i) => run.y.slice(i * N, (i + 1) * N))];

test('9. multisine: random-odd lines (one in three odd left out, even lines out, log-spaced past about 60), one period with equal lines and nothing between, the peak bound, a lowered crest factor; it depends only on its seed', () => {
  // Every odd harmonic up to 101 is a candidate: groups of three, one left out of each.
  const L = multisineLines({ N: 512, kmax: 101, seed: 4 });
  const odd = Array.from({ length: 51 }, (_, i) => 2 * i + 1);
  assert.ok(L.excited.every((k) => k % 2 === 1));
  for (let g = 0; g + 3 <= odd.length; g += 3) assert.equal(odd.slice(g, g + 3).filter((k) => L.excited.includes(k)).length, 2, `group ${odd.slice(g, g + 3)}`);
  const all = [...L.excited, ...L.detect.odd, ...L.detect.even].sort((a, b) => a - b);
  assert.deepEqual(all, Array.from({ length: L.excited.at(-1) }, (_, i) => i + 1), 'excited and detection lines cover 1 … the top once');
  assert.ok(L.detect.even.every((k) => k % 2 === 0) && L.detect.odd.every((k) => k % 2 === 1));
  assert.deepEqual(multisineLines({ N: 512, kmax: 101, seed: 4 }), L, 'the same seed, the same lines');
  assert.notDeepEqual(multisineLines({ N: 512, kmax: 101, seed: 5 }).excited, L.excited, 'another seed leaves out other lines');
  // Many candidates: at most about 60 lines, log-spaced (each at least the ratio above the last, until spacing 2).
  const W = multisineLines({ N: 8192, kmax: 3000, seed: 1 });
  assert.ok(W.excited.length <= 60 && W.excited.length >= 55, `${W.excited.length} lines`);
  const ratios = W.excited.slice(1).map((k, i) => k / W.excited[i]).filter((r, i) => W.excited[i + 1] - W.excited[i] > 6);
  assert.ok(Math.max(...ratios) / Math.min(...ratios) < 2.2, `log spacing: ratios ${Math.min(...ratios)} … ${Math.max(...ratios)}`);

  for (const phases of ['random', 'schroeder']) {
    const N = 512, x = multisine({ N, lines: L.excited, peak: 0.7, seed: 9, phases });
    assert.equal(x.length, N);
    assert.ok(Math.abs(Math.max(...x.map(Math.abs)) - 0.7) < 1e-12, `${phases}: the peak`);
    const amps = Array.from({ length: N / 2 }, (_, k) => cabs(dft(x, k)));
    const a0 = amps[L.excited[0]];
    for (const k of L.excited) assert.ok(Math.abs(amps[k] / a0 - 1) < 1e-9, `${phases}: line ${k} ${amps[k]} vs ${a0}`);
    for (let k = 0; k < N / 2; k++) if (!L.excited.includes(k)) assert.ok(amps[k] < 1e-12 * a0, `${phases}: line ${k} is not empty: ${amps[k]}`);
    // Clip and restore lowers the crest factor below the starting phases'.
    const raw = multisine({ N, lines: L.excited, peak: 0.7, seed: 9, phases, iterations: 0 });
    assert.ok(crestFactor(x) < crestFactor(raw) - 0.3 && crestFactor(x) < 2.3, `${phases}: crest factor ${crestFactor(x)} from ${crestFactor(raw)}`);
  }
  // Bit for bit from the seed; another seed, other phases.
  const a = multisine({ N: 256, lines: [1, 3, 7, 9], seed: 3 }), b = multisine({ N: 256, lines: [1, 3, 7, 9], seed: 3 });
  assert.ok(a.every((v, i) => Object.is(v, b[i])));
  assert.ok(multisine({ N: 256, lines: [1, 3, 7, 9], seed: 4 }).some((v, i) => v !== a[i]));
  assert.equal(MULTISINE.iterations, 20);
  assert.throws(() => multisine({ N: 300, lines: [1] }), /power of two/);
  assert.throws(() => multisine({ N: 256, lines: [128] }), /harmonics/);
});

test('9. multisine lines: the first excited line is the smallest odd harmonic at or above kmin, also for a kmin between whole numbers', () => {
  for (const kmin of [1, 1.5, 2, 3, 3.5, 7.5, 8]) {
    // (As first built, kmin 1.5 excited 2, 6, 10, …: even lines, which the
    // even distortion is read at.)
    const L = multisineLines({ N: 1024, kmax: 200, kmin, count: 30, seed: 2 });
    assert.ok(L.excited.every((k) => k % 2 === 1 && k >= kmin), `kmin ${kmin}: ${L.excited.filter((k) => k % 2 === 0 || k < kmin)}`);
    assert.ok(L.detect.even.every((k) => k % 2 === 0) && L.detect.odd.every((k) => k % 2 === 1));
    const first = Math.ceil(kmin) % 2 ? Math.ceil(kmin) : Math.ceil(kmin) + 1;
    assert.ok(L.excited[0] === first || L.excited[0] === first + 2, `kmin ${kmin}: starts at ${L.excited[0]}`);
    assert.ok([...L.excited, ...L.detect.odd].includes(first), `kmin ${kmin}: ${first} is a line`);
  }
});

test('9. frequency response: exact at the excited lines on a linear plant in closed loop, against the exact discrete transfer function; the detection lines stay empty', () => {
  // 10 periods (51 s) settle the slowest loop (the integrator's) to rounding.
  const N = 512, T = 10, P = 4;
  const L = multisineLines({ N, kmax: 100, seed: 2 });
  const s = multisine({ N, lines: L.excited, peak: 0.3, seed: 2 });
  for (const [name, p, Kp, Ki] of [['lag', { K: 2, tau: 0.3, theta: 0.0237 }, 0.4, 1.5], ['resonance', { K: 0.5, f: 1.2, zeta: 0.2, theta: 0.013 }, 0.6, 2], ['intLag', { kp: 3, tau: 0.15, theta: 0.031 }, 0.3, 0.1]]) {
    const run = runPlant(STRUCTURES[name].tf(p), Ts, (T + P) * N, { law: shakeLaw(Kp, Ki, 0.5, s) });
    const [U, Y] = periods(run, N, [T, T + 1, T + 2, T + 3]);
    const r = frf(U, Y, { excited: L.excited, detect: L.detect, Ts });
    assert.deepEqual(r.lines, L.excited);
    r.lines.forEach((k, i) => {
      const g = Gd(name, p, N, k);
      assert.ok(cabs({ re: r.G[i].re - g.re, im: r.G[i].im - g.im }) < 1e-8 * cabs(g), `${name} line ${k}: ${JSON.stringify(r.G[i])} vs ${JSON.stringify(g)}`);
      assert.ok(Math.abs(r.f[i] - k / (N * Ts)) < 1e-12);
    });
    assert.ok(r.distortion.share < 1e-5, `${name}: distortion ${r.distortion.share} %`);
    assert.equal(r.periods, P);
  }
});

test('9. frequency response with noise in closed loop: Ĝ is the averaged DFTs\' ratio; the ±2σ bars cover the truth; near crossover they hold only with the U–Y covariance', (t) => {
  // A lag under a brisk PI (crossover near 1.2 Hz), white measurement noise
  // the loop feeds back into u. The truth is the noise-free run's Ĝ.
  const N = 256, T = 6, P = 4, Kp = 1, Ki = 8, p = { K: 2, tau: 0.3, theta: 0.0237 };
  const tf = STRUCTURES.lag.tf(p);
  const L = multisineLines({ N, kmax: 60, seed: 2 });
  const s = multisine({ N, lines: L.excited, peak: 0.5, seed: 2 });
  const law = shakeLaw(Kp, Ki, 0, s);
  const G0 = frf(...periods(runPlant(tf, Ts, (T + P) * N, { law }), N, [T, T + 1, T + 2, T + 3]), { excited: L.excited }).G;
  // The loop gain GC at each line (C(z) = Kp + Ki·Ts/(z − 1), the law's integral).
  const GC = L.excited.map((k, i) => {
    const w = (2 * Math.PI * k) / N, zr = Math.cos(w) - 1, zi = Math.sin(w), dd = zr * zr + zi * zi;
    const C = { re: Kp + (Ki * Ts * zr) / dd, im: (-Ki * Ts * zi) / dd }, g = G0[i];
    return { re: g.re * C.re - g.im * C.im, im: g.re * C.im + g.im * C.re };
  });
  const near = L.excited.map((_, i) => cabs(GC[i]) >= 0.25 && cabs(GC[i]) <= 4);
  let inside = 0, count = 0, err = 0, withCov = 0, without = 0;
  const seeds = 40;
  for (let seed = 1; seed <= seeds; seed++) {
    const [U, Y] = periods(runPlant(tf, Ts, (T + P) * N, { law, noise: white(0.02, seed) }), N, [T, T + 1, T + 2, T + 3]);
    const r = frf(U, Y, { excited: L.excited });
    r.lines.forEach((k, i) => {
      // By direct DFT sums: the means, the ratio, the spreads without the covariance.
      const Us = U.map((x) => dft(x, k)), Ys = Y.map((x) => dft(x, k));
      const mean = (zs) => ({ re: zs.reduce((a, z) => a + z.re, 0) / P, im: zs.reduce((a, z) => a + z.im, 0) / P });
      const mu = mean(Us), my = mean(Ys), g = cdiv(my, mu);
      assert.ok(cabs({ re: g.re - r.G[i].re, im: g.im - r.G[i].im }) < 1e-11 * cabs(g), `line ${k}: Ĝ is not Ȳ/Ū`);
      const spread = (zs, m) => zs.reduce((a, z) => a + (z.re - m.re) ** 2 + (z.im - m.im) ** 2, 0) / (P - 1) / P;
      const noCov = cabs(g) ** 2 * (spread(Ys, my) / cabs(my) ** 2 + spread(Us, mu) / cabs(mu) ** 2);
      const e2 = (r.G[i].re - G0[i].re) ** 2 + (r.G[i].im - G0[i].im) ** 2;
      count++;
      if (Math.sqrt(e2) <= 2 * r.sd[i]) inside++;
      if (near[i]) { err += e2; withCov += r.sd[i] ** 2; without += noCov; }
    });
  }
  t.diagnostic(`within ±2σ: ${((100 * inside) / count).toFixed(1)} % of ${count}; near crossover E|ΔG|²/sd²: ${(err / withCov).toFixed(2)} with the covariance, ${(err / without).toFixed(2)} without`);
  // |ΔG|²/sd̂² follows F(2, 6) with 4 periods: 92 % within 2σ.
  assert.ok(inside / count >= 0.88, `the ±2σ bars cover the truth at ${((100 * inside) / count).toFixed(1)} % of ${count} lines`);
  assert.ok(near.filter(Boolean).length >= 2, 'lines near crossover');
  // Near crossover: the mean squared error matches the variance with the covariance, and the plain formula overstates it.
  assert.ok(err / withCov > 0.75 && err / withCov < 1.35, `with the covariance: E|ΔG|² / sd² = ${(err / withCov).toFixed(2)}`);
  assert.ok(err / without < 0.75, `without it: ${(err / without).toFixed(2)}`);
});

test('9. a period with a seq gap is dropped and repeated: the DFT is never taken across it', () => {
  const N = 512, T = 6;
  const tf = STRUCTURES.lag.tf({ K: 2, tau: 0.3, theta: 0.0237 });
  const L = multisineLines({ N, kmax: 100, seed: 5 });
  const s = multisine({ N, lines: L.excited, peak: 0.3, seed: 5 });
  const law = shakeLaw(0.4, 1.5, 0.5, s);
  const truth = L.excited.map((k) => Gd('lag', { K: 2, tau: 0.3, theta: 0.0237 }, N, k));
  // Three plant cycles lost inside the second measured period; the experiment plays a fifth.
  const gap = [(T + 1) * N + 200, 3];
  const run = runPlant(tf, Ts, (T + 5) * N, { law, gaps: [gap] });
  const w = wholePeriods({ start: T * N, N, count: 5, gaps: [gap] });
  assert.deepEqual(w, { kept: [0, 2, 3, 4], dropped: [1], starts: [T * N, (T + 2) * N, (T + 3) * N, (T + 4) * N] });
  const worst = (r) => Math.max(...r.G.map((g, i) => cabs({ re: g.re - truth[i].re, im: g.im - truth[i].im }) / cabs(truth[i])));
  const kept = frf(...periods(run, N, w.kept.map((i) => T + i)), { excited: L.excited });
  const across = frf(...periods(run, N, [T, T + 1, T + 2, T + 3]), { excited: L.excited });
  // The period after the gap still carries a little of its transient (≈ 1e-5).
  assert.ok(worst(kept) < 1e-4, `the gap dropped: ${worst(kept)}`);
  assert.ok(worst(across) > 1e-2, `across the gap: ${worst(across)}`);
  // A gap just before a period's first sample breaks it too; one after its last does not; a guard event counts as a gap.
  assert.deepEqual(wholePeriods({ start: 0, N: 10, count: 3, gaps: [[10, 2]] }).dropped, [1]);
  assert.deepEqual(wholePeriods({ start: 0, N: 10, count: 3, gaps: [[30, 2]] }).dropped, []);
  assert.deepEqual(wholePeriods({ start: 0, N: 10, count: 3, breaks: [25] }).dropped, [2]);
});

test('8. distortion: a cubic under the Shake shows at the detection lines, as much as lands on the excited lines; a linear plant shows none', (t) => {
  const N = 512, T = 4, P = 4, Kp = 0.4, Ki = 1.5;
  const tf = STRUCTURES.lag.tf({ K: 2, tau: 0.3, theta: 0.0237 });
  const L = multisineLines({ N, kmax: 100, seed: 5 });
  const shake = (a, peak, { r = 0, sigma = 0.005 } = {}) => {
    const s = multisine({ N, lines: L.excited, peak, seed: 5 });
    const run = runPlant(tf, Ts, (T + P) * N, { law: shakeLaw(Kp, Ki, r, s), input: (v) => v + a * v ** 3, noise: sigma ? white(sigma, 3) : null });
    return frf(...periods(run, N, [T, T + 1, T + 2, T + 3]), { excited: L.excited, detect: L.detect }).distortion;
  };
  // Linear: nothing at the detection lines, noise-free or with noise (its level is removed).
  const lin0 = shake(0, 1, { sigma: 0 }), lin = shake(0, 1);
  assert.ok(lin0.share < 1e-9 && lin0.level.odd < 1e-12, `linear, noise-free: ${lin0.share} %`);
  assert.ok(lin.share < 0.5 && lin.level.noise > 1e-4, `linear with noise: ${lin.share} % (noise ${lin.level.noise})`);
  // A cubic actuator v = u + a·u³ about u = 0: odd distortion only.
  const c1 = shake(1, 1), half = shake(1, 0.5), strong = shake(6, 1);
  assert.ok(c1.odd > 5 && c1.even < 0.1 && c1.share === Math.hypot(c1.odd, c1.even), `cubic: odd ${c1.odd} %, even ${c1.even} %`);
  assert.ok(c1.level.odd > 10 * c1.level.noise, 'well above the noise');
  // Half the push, a quarter of the distortion relative to the response (a cubic).
  assert.ok(c1.odd / half.odd > 3.5 && c1.odd / half.odd < 4.5, `halving the push: ${c1.odd} → ${half.odd}`);
  // A strong cubic passes 30 % (the grade's ✕ comes with the Shake, step 8).
  assert.ok(strong.share > 30, `strong cubic: ${strong.share} %`);
  // Away from the cubic's centre (held at r = 0.5, u ≈ 0.25) it also bends one way: even distortion appears.
  const off = shake(1, 1, { r: 0.5 });
  assert.ok(off.even > 3 && off.odd > 3, `off centre: odd ${off.odd} %, even ${off.even} %`);
  // What the odd detection lines show is what lands on the excited lines (open loop, noise-free): the
  // spread of Ĝ·Ū over 30 phase realizations of the same lines.
  const M = 30, Gs = [], Us = [];
  let det = 0;
  for (let seed = 1; seed <= M; seed++) {
    const s = multisine({ N, lines: L.excited, peak: 1, seed: 100 + seed });
    const run = runPlant(tf, Ts, 5 * N, { u: Float64Array.from({ length: 5 * N }, (_, k) => s[k % N]), input: (v) => v + v ** 3 });
    const r = frf(...periods(run, N, [3, 4]), { excited: L.excited, detect: L.detect });
    Gs.push(r.G); Us.push(r.U); det += r.distortion.level.odd ** 2 / M;
  }
  let exc = 0;
  L.excited.forEach((_, i) => {
    const m = { re: Gs.reduce((q, g) => q + g[i].re, 0) / M, im: Gs.reduce((q, g) => q + g[i].im, 0) / M };
    for (let j = 0; j < M; j++) exc += ((Gs[j][i].re - m.re) ** 2 + (Gs[j][i].im - m.im) ** 2) * Us[j][i] ** 2 / (M - 1) / L.excited.length;
  });
  t.diagnostic(`linear ${lin.share.toFixed(3)} %; cubic a 1: odd ${c1.odd.toFixed(2)} %, even ${c1.even.toFixed(3)} %; half the push ${half.odd.toFixed(2)} %; a 6: ${strong.share.toFixed(1)} %; off centre: odd ${off.odd.toFixed(2)} %, even ${off.even.toFixed(2)} %; excited/detection ${(exc / det).toFixed(3)}`);
  assert.ok(exc / det > 0.7 && exc / det < 1.3, `the excited lines' nonlinear part ${exc} against the detection lines' ${det}`);
});
