// Identify's fits with noise (design/output/identification.md §6.3–6.5, tests
// 6 and 7 of §17): the ±2σ bars against the truth over 40 seeds, open loop
// and closed loop; a closed loop with coloured noise, where a direct
// output-error fit is biased and the replay is not; the structure chosen on
// clean data. The plants are simulated in fine steps, independently of
// fit.js (test/fixtures/continuous.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRUCTURES, discretise, simulateSegment, fitStructure, fitPercent, chooseStructure, unsupported, noiseColour, noiseTransfer, whiteness } from '../src/core/fit.js';
import { runPlant, piLaw, doublets, square, white, ar1 } from './fixtures/continuous.mjs';

const Ts = 0.01;

// The share of seeds in which |p̂ − p| ≤ 2σ̂, per parameter.
function coverage(name, p, { closed, sigma, Kp, Ki, N = 1500, seeds = 40 }) {
  const S = STRUCTURES[name], tf = S.tf(p);
  const law = closed ? piLaw(Kp, Ki, square(N, 0, 0.5, 300), Ts) : null;
  const u = closed ? null : doublets(N);
  const hit = Object.fromEntries(S.params.map((k) => [k, 0]));
  for (let seed = 1; seed <= seeds; seed++) {
    const run = runPlant(tf, Ts, N, { u, law, noise: white(sigma, seed) });
    // The plant rests at 0 before the segment; yStart is that level, as the
    // settled mean before a segment gives it (not one noisy sample).
    const seg = closed ? { y: run.y, law, yStart: 0, weight: 1 / sigma ** 2 } : { y: run.y, u: run.u, yStart: 0, weight: 1 / sigma ** 2 };
    const start = S.start(S.integrating ? { kp: 1.3 * p.kp, tau: 0.7 * (p.tau ?? 0.2), f: p.f && 1.1 * p.f, zeta: p.zeta && 1.5 * p.zeta, theta: p.theta / 2 } : { K: 1.3 * p.K, tau: 0.7 * (p.tau ?? 0.2), f: p.f && 1.1 * p.f, zeta: p.zeta && 1.5 * p.zeta, theta: p.theta / 2 });
    const f = fitStructure([seg], name, [start], { Ts });
    assert.ok(f.chi2dof > 0.85 && f.chi2dof < 1.15, `${name} seed ${seed}: χ²/dof ${f.chi2dof}`);
    for (const k of S.params) if (Math.abs(f.p[k] - p[k]) <= 2 * f.sd[k]) hit[k]++;
  }
  return hit;
}

test('6. with noise, the ±2σ bars cover the truth in at least 90 % of 40 seeds: open loop, and closed loop where the loop shapes the noise', () => {
  const resonance = { K: 0.5, f: 1.2, zeta: 0.2, theta: 0.013 };
  const cases = [
    ['resonance', resonance, { closed: false, sigma: 0.01 }],
    // A brisk PI: the loop lifts the noise near the resonance and removes it
    // at low frequencies. The plain σ̂²(JᵀJ)⁻¹ would cover f in 31 of 40 and
    // overstate K's bar 1.6×; the bars follow the loop's noise transfer.
    ['resonance', resonance, { closed: true, sigma: 0.005, Kp: 0.6, Ki: 2 }],
    ['intLag', { kp: 3, tau: 0.15, theta: 0.031 }, { closed: true, sigma: 0.005, Kp: 0.1, Ki: 0.05 / 3 }],
  ];
  for (const [name, p, opts] of cases) {
    const hit = coverage(name, p, opts);
    for (const [k, n] of Object.entries(hit)) assert.ok(n >= 36, `${name} ${opts.closed ? 'closed' : 'open'} loop: ${k} covered in ${n} of 40`);
  }
});

test('6. closed loop with coloured noise: a direct output-error fit is biased, the replay of the law is not', () => {
  // A lag with dead time under a PI; the measurement noise is AR(1) (a 0.9 at
  // 20 ms, σ 0.3), fed back by the controller into u.
  const T = 0.02, N = 3000, p = { K: 1, tau: 1, theta: 0.1 }, tf = STRUCTURES.lag.tf(p);
  const law = piLaw(3, 3, square(N, 0, 1, 250), T);
  const starts = [{ K: 0.7, tau: 0.6, theta: 0.05 }, { K: 1.4, tau: 1.6, theta: 0.2 }];
  const direct = [], replay = [];
  for (let seed = 1; seed <= 10; seed++) {
    const run = runPlant(tf, T, N, { law, noise: ar1(0.9, 0.3, seed) });
    // Direct: the model driven by the measured u, as if it were open loop.
    direct.push(fitStructure([{ y: run.y, u: run.u, yStart: 0, uStart: 0 }], 'lag', starts, { Ts: T }).p);
    // The replay: the law driven by the model's own output, from r alone.
    replay.push(fitStructure([{ y: run.y, law, yStart: 0 }], 'lag', starts, { Ts: T }).p);
  }
  const stats = (xs, k) => {
    const m = xs.reduce((s, q) => s + q[k], 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, q) => s + (q[k] - m) ** 2, 0) / (xs.length - 1));
    return { m, se: sd / Math.sqrt(xs.length) };
  };
  // The direct fit puts the noise the loop fed back into the plant: the dead time comes out 70 % long.
  const d = stats(direct, 'theta');
  assert.ok(d.m - p.theta > 0.05 && (d.m - p.theta) / d.se > 5, `direct θ ${d.m} ± ${d.se}`);
  for (const k of ['K', 'tau', 'theta']) {
    const r = stats(replay, k);
    assert.ok(Math.abs(r.m - p[k]) < 2.5 * r.se, `replay ${k} ${r.m} ± ${r.se} vs ${p[k]}`);
  }
});

test('6. coloured noise: with its colour read from a rest record (Listen\'s 150 samples, no model involved) the ±2σ bars hold; without it they are several times too narrow', () => {
  // A lag under a brisk PI, the measurement noise AR(1) at 0.95 (σ 0.02).
  const p = { K: 2, tau: 0.5, theta: 0.083 }, S = STRUCTURES.lag, N = 1500, sigma = 0.02;
  const hit = { white: { K: 0, tau: 0, theta: 0 }, coloured: { K: 0, tau: 0, theta: 0 } };
  for (let seed = 1; seed <= 40; seed++) {
    const law = piLaw(1.2, 3, square(N, 0, 0.5, 300), Ts);
    const nz = ar1(0.95, sigma, seed), rz = ar1(0.95, sigma, 5000 + seed);
    const run = runPlant(S.tf(p), Ts, N, { law, noise: (k) => nz(k + 500) });
    const seg = { y: run.y, law, yStart: 0, weight: 1 / sigma ** 2 };
    const colour = noiseColour(Array.from({ length: 150 }, (_, k) => rz(k + 800)));
    for (const [kind, noise] of [['white', null], ['coloured', colour]]) {
      const f = fitStructure([seg], 'lag', [p], { Ts, noise });
      for (const k of S.params) if (Math.abs(f.p[k] - p[k]) <= 2 * f.sd[k]) hit[kind][k]++;
    }
  }
  // Measured: as white, K 13, τ 16, θ 16 of 40; with the colour, 33, 38, 40.
  for (const k of S.params) assert.ok(hit.coloured[k] >= 32, `with the colour: ${k} covered in ${hit.coloured[k]} of 40`);
  assert.ok(hit.white.K <= 20, `as white: K covered in ${hit.white.K} of 40`);
  // White noise reads white: the colour is [1] (no AR term beats AIC) on most seeds.
  let plain = 0;
  for (let seed = 1; seed <= 40; seed++) if (noiseColour(Array.from({ length: 150 }, (_, k) => sigma * white(1, 900 + seed)(k))).length === 1) plain++;
  assert.ok(plain >= 25, `white noise read as white on ${plain} of 40`);
  // An AR(1) at 0.95 reads as a slow decay.
  const c = noiseColour(Array.from({ length: 2000 }, (_, k) => ar1(0.95, 1, 3)(k + 500)));
  assert.ok(Math.abs(c[1] - 0.95) < 0.03 && c.length > 200, `h[1] ${c[1]}, ${c.length} taps`);
});

test('8. the pattern test on a closed-loop replay reads each lag against what the loop gives white noise: the true model passes, a model that misses does not', () => {
  // A lag under its SIMC PI with τc = θ: the loop colours the noise it feeds back.
  const p = { K: 2, tau: 0.5, theta: 0.083 }, N = 1000;
  const Kc = p.tau / (p.K * (2 * p.theta)), Ti = Math.min(p.tau, 8 * p.theta);
  const count = { plain: 0, loop: 0, tau: 0 };
  for (let seed = 1; seed <= 100; seed++) {
    const law = piLaw(Kc, Kc / Ti, square(N, 0, 0.25, 250), Ts);
    const run = runPlant(STRUCTURES.lag.tf(p), Ts, N, { law, noise: white(0.01, seed) });
    const seg = { y: run.y, law, yStart: 0 };
    for (const [key, q] of [['loop', p], ['tau', { ...p, tau: 0.4 }]]) {
      const d = discretise('lag', q, Ts), yh = simulateSegment(d, seg).y;
      const res = Array.from(run.y, (v, k) => v - yh[k]);
      if (!whiteness(res, 25, noiseTransfer(d, seg)).white) count[key]++;
      if (key === 'loop' && !whiteness(res).white) count.plain++;
    }
  }
  // Measured: read as if white, the true model shows "a pattern" in 68 of 100; about the loop's own colour in 6.
  assert.ok(count.plain >= 50, `as if white: ${count.plain} of 100`);
  assert.ok(count.loop <= 10, `the true model: a pattern in ${count.loop} of 100`);
  assert.ok(count.tau >= 95, `τ 20 % off: a pattern in ${count.tau} of 100`);
  // Without h (open loop) nothing changes: the band and the rule are the same.
  const w = whiteness(Array.from({ length: 400 }, (_, k) => white(1, 3)(k)), 25, Float64Array.of(1));
  assert.deepEqual([w.outside, w.white, w.expected.every((v) => v === 0)], [whiteness(Array.from({ length: 400 }, (_, k) => white(1, 3)(k))).outside, true, true]);
});

test('7. choice: on clean data the true structure is chosen, by the fewest parameters within 1 point of the best Check fit', () => {
  const TRUTH = {
    lag: { K: 2, tau: 0.3, theta: 0.0237 },
    lags: { K: 1.5, tau1: 0.4, tau2: 0.2, theta: 0.03 },
    resonance: { K: 0.5, f: 1.2, zeta: 0.25, theta: 0.013 },
    intLag: { kp: 3, tau: 0.15, theta: 0.031 },
    intRes: { kp: 1.2, f: 1, zeta: 0.15, theta: 0.017 },
  };
  const sigma = 1e-3, N = 1200;
  for (const [name, p] of Object.entries(TRUTH)) {
    const S = STRUCTURES[name], g = S.integrating ? p.kp : p.K;
    const Kp = (S.integrating ? 0.4 : 0.5) / g, Ki = (S.integrating ? 0.3 : 1.5) / g;
    // Fitted on the reference 0 ↔ 1, checked on 0.25 ↔ 0.75 (the steps halved), another noise.
    const lawF = piLaw(Kp, Ki, square(N, 0, 1, 300), Ts), lawC = piLaw(Kp, Ki, square(N, 0.25, 0.75, 300), Ts);
    const fitRun = runPlant(S.tf(p), Ts, N, { law: lawF, noise: white(sigma, 1) });
    const checkRun = runPlant(S.tf(p), Ts, N, { law: lawC, noise: white(sigma, 2) });
    // Starts as a first look gives them: a gain 20 % off, a time scale, no dead time.
    const look = S.integrating ? { kp: 1.2 * p.kp, tau: 0.2, theta: 0 } : { K: 0.8 * p.K, tau: 0.4, theta: 0 };
    const cands = Object.entries(STRUCTURES).map(([cn, C]) => {
      const f = fitStructure([{ y: fitRun.y, law: lawF, yStart: 0, weight: 1 / sigma ** 2 }], cn, [C.start(look), C.start({ ...look, tau: 2.5 * look.tau, theta: 0.02 })], { Ts });
      const yh = simulateSegment(discretise(cn, f.p, Ts), { y: checkRun.y, law: lawC, yStart: 0 }).y;
      return { structure: cn, fit: fitPercent(checkRun.y, yh), bic: f.bic, unsupported: unsupported(cn, f.p, { length: N * Ts }) };
    });
    const ch = chooseStructure(cands);
    const show = cands.map((c) => `${c.structure} ${c.fit.toFixed(2)}${c.unsupported ? ' ✕' : ''}`).join(', ');
    assert.equal(cands[ch.index].structure, name, `${name}: chose ${cands[ch.index].structure} (${ch.why}) from ${show}`);
    // The rule itself: nothing with fewer parameters is within 1 point of the best supported fit.
    const best = Math.max(...cands.filter((c) => !c.unsupported).map((c) => c.fit));
    assert.ok(cands[ch.index].fit >= best - 1);
    const np = (c) => STRUCTURES[c.structure].params.length;
    assert.ok(!cands.some((c) => !c.unsupported && c.fit >= best - 1 && np(c) < np(cands[ch.index])), show);
    assert.ok(cands[ch.index].fit > 99, `${name}: ${show}`);
  }
});
