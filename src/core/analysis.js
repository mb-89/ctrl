// Loop analysis for the Analysis tab: from the plant a Controller block sees
// (linearised, continuous) and the controller's own discrete model, the open
// loop L(z) cut at the actuator, and what control engineers read from it:
// closed-loop poles (with ζ and ωn), the root locus, the frequency response
// (Bode, Nyquist / Ortskurve), and the margins. Everything is discrete-time,
// as the simulation samples (zero-order hold at the controller's Ts), so the
// margins include the sampling delay. Research and sources:
// design/research/analysis.md.
//
// Conventions: a state-space model is { A, B, C, D } with matrices as arrays
// of rows. The plant has one input u and m outputs (the controller's
// measurement inputs, in port order). The controller model has inputs
// [r, y1 … ym] and one output u. L is SISO with negative feedback: the loop is
// stable when 1 + L(z) has no zero on or outside the unit circle.

import { c2d, eig, csolve } from './linalg.js';

const zerosM = (r, c) => Array.from({ length: r }, () => new Array(c).fill(0));
const col = (M, j) => M.map((row) => row[j]);

// The plant as the controller samples it: discretised with a zero-order hold
// at Ts, with each measurement's dead time (plant.delay[k], seconds) as a
// chain of round(delay / Ts) unit delays, exact in discrete time.
export function discretePlant(plant, Ts) {
  const { Ad, Bd } = c2d(plant.A, plant.B, Ts);
  const n = Ad.length, m = plant.C.length, D0 = plant.D ?? zerosM(m, 1);
  const d = Array.from({ length: m }, (_, k) => Math.max(0, Math.round((plant.delay?.[k] ?? 0) / Ts)));
  const N = n + d.reduce((a, b) => a + b, 0);
  const A = zerosM(N, N), B = zerosM(N, 1), C = zerosM(m, N), D = zerosM(m, 1);
  for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) A[i][j] = Ad[i][j]; B[i][0] = Bd[i][0]; }
  let o = n;
  for (let k = 0; k < m; k++) {
    if (!d[k]) { for (let j = 0; j < n; j++) C[k][j] = plant.C[k][j]; D[k][0] = D0[k][0]; continue; }
    // The first delay state takes this sample's measurement, each next one the one before.
    for (let j = 0; j < n; j++) A[o][j] = plant.C[k][j];
    B[o][0] = D0[k][0];
    for (let i = 1; i < d[k]; i++) A[o + i][o + i - 1] = 1;
    C[k][o + d[k] - 1] = 1;
    o += d[k];
  }
  return { A, B, C, D, delaySamples: d };
}

// The open loop cut at u (u_p = v, the controller output u_c read but not
// applied): L(z) = −u_c / v with r = 0. Plant discretised with a ZOH at Ts.
export function openLoop(plant, ctrl, Ts) {
  const P = discretePlant(plant, Ts);
  const Ad = P.A, Bd = P.B, Cp = P.C, Dp = P.D;
  const n = Ad.length, m = Cp.length, nc = ctrl.A.length;
  // Controller columns that act on the measurements (inputs 1 … m); a law
  // with fewer gains than measurements ignores the rest.
  const cols = (row) => Array.from({ length: m }, (_, k) => row[1 + k] ?? 0);
  const Bcy = ctrl.B.map(cols), Dcy = cols(ctrl.D[0]);
  const N = n + nc;
  const A = zerosM(N, N), B = zerosM(N, 1), C = [new Array(N).fill(0)];
  for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) A[i][j] = Ad[i][j]; B[i][0] = Bd[i][0]; }
  for (let i = 0; i < nc; i++) {
    for (let j = 0; j < nc; j++) A[n + i][n + j] = ctrl.A[i][j];
    for (let j = 0; j < n; j++) { let s = 0; for (let k = 0; k < m; k++) s += Bcy[i][k] * Cp[k][j]; A[n + i][j] = s; }
    let s = 0; for (let k = 0; k < m; k++) s += Bcy[i][k] * Dp[k][0]; B[n + i][0] = s;
  }
  for (let j = 0; j < n; j++) { let s = 0; for (let k = 0; k < m; k++) s += Dcy[k] * Cp[k][j]; C[0][j] = -s; }
  for (let j = 0; j < nc; j++) C[0][n + j] = -ctrl.C[0][j];
  let D = 0; for (let k = 0; k < m; k++) D -= Dcy[k] * Dp[k][0];
  return { A, B, C, D, Ts, n: N, delaySamples: P.delaySamples };
}

// Closed-loop poles in z for the loop gain multiplied by k (k = 1: as tuned).
export function closedLoop(L, k = 1) {
  const den = 1 + k * L.D;
  if (Math.abs(den) < 1e-12) return [];
  return eig(L.A.map((row, i) => row.map((v, j) => v - (k * L.B[i][0] * L.C[0][j]) / den)));
}

// A z-plane pole as its continuous equivalent s = ln(z)/Ts, with ωn and ζ.
export function sOf(z, Ts) {
  const r = Math.hypot(z.re, z.im);
  if (r < 1e-300) return { re: -Infinity, im: 0, wn: Infinity, zeta: 1 };
  const re = Math.log(r) / Ts, im = Math.atan2(z.im, z.re) / Ts, wn = Math.hypot(re, im);
  return { re, im, wn, zeta: wn > 0 ? -re / wn : 1 };
}

// L(e^{jωTs}) at one angular frequency ω (rad/s).
export function respondAt(L, w) {
  const N = L.A.length, zr = Math.cos(w * L.Ts), zi = Math.sin(w * L.Ts);
  if (!N) return { re: L.D, im: 0 };
  const Mr = L.A.map((row, i) => row.map((v, j) => (i === j ? zr : 0) - v));
  const Mi = L.A.map((row, i) => row.map((_, j) => (i === j ? zi : 0)));
  const x = csolve(Mr, Mi, col(L.B, 0), new Array(N).fill(0));
  if (!x) return { re: NaN, im: NaN };
  let re = L.D, im = 0;
  for (let i = 0; i < N; i++) { re += L.C[0][i] * x.xr[i]; im += L.C[0][i] * x.xi[i]; }
  return { re, im };
}

// Frequency response on a log grid up to just below Nyquist (π/Ts), with the
// phase unwrapped along the grid (dense enough that it moves less than 180°
// between points; refined where it moves fast).
export function frequencyData(L, { points = 400, wmin } = {}) {
  const wN = Math.PI / L.Ts, lo = wmin ?? wN * 1e-4;
  const w = [];
  for (let i = 0; i < points; i++) w.push(lo * (0.999 * wN / lo) ** (i / (points - 1)));
  const G = w.map((x) => respondAt(L, x));
  const mag = G.map((g) => Math.hypot(g.re, g.im));
  const phase = [];
  for (let i = 0; i < G.length; i++) {
    let ph = (Math.atan2(G[i].im, G[i].re) * 180) / Math.PI;
    if (i) ph += 360 * Math.round((phase[i - 1] - ph) / 360);
    else if (ph > 0) ph -= 360;   // start on the lagging branch, as an engineer reads it
    phase.push(ph);
  }
  return { w, re: G.map((g) => g.re), im: G.map((g) => g.im), mag, phase };
}

// Margins from the frequency data. Gain crossings |L| = 1 give phase margins
// and delay margins ((∠L + 180°) mod 360° / ωc, valid for unstable loops too);
// phase crossings ∠L = −180° (mod 360°) give the gain factors at which the
// loop would cross −1. Ms = max |S| = max 1/|1 + L|, Mt = max |T| = max |L/(1+L)|.
export function loopMargins(fd, Ts) {
  const { w, mag, phase, re, im } = fd;
  const lerp = (a, b, f) => a + (b - a) * f;
  const gainCrossings = [], phaseCrossings = [];
  for (let i = 1; i < w.length; i++) {
    const a = Math.log(mag[i - 1]), b = Math.log(mag[i]);
    if (Number.isFinite(a) && Number.isFinite(b) && a * b <= 0 && a !== b) {
      const f = a / (a - b), wc = Math.exp(lerp(Math.log(w[i - 1]), Math.log(w[i]), f)), ph = lerp(phase[i - 1], phase[i], f);
      const pm = ((((ph + 180) % 360) + 540) % 360) - 180;
      const dm = ((((ph + 180) % 360) + 360) % 360) * (Math.PI / 180) / wc;
      gainCrossings.push({ w: wc, pm, dm, dmSamples: dm / Ts });
    }
    const pa = phase[i - 1] + 180, pb = phase[i] + 180;
    const ka = Math.floor(pa / 360), kb = Math.floor(pb / 360);
    if (ka !== kb) {
      const target = 360 * Math.max(ka, kb) - 180;
      const f = (target - phase[i - 1]) / (phase[i] - phase[i - 1]);
      const wx = Math.exp(lerp(Math.log(w[i - 1]), Math.log(w[i]), f)), mx = Math.exp(lerp(Math.log(mag[i - 1]), Math.log(mag[i]), f));
      phaseCrossings.push({ w: wx, mag: mx, gm: 1 / mx, gmDb: -20 * Math.log10(mx) });
    }
  }
  let ms = 0, wMs = NaN, mt = 0, wMt = NaN;
  for (let i = 0; i < w.length; i++) {
    const d = Math.hypot(1 + re[i], im[i]);
    if (1 / d > ms) { ms = 1 / d; wMs = w[i]; }
    if (mag[i] / d > mt) { mt = mag[i] / d; wMt = w[i]; }
  }
  // The gain interval that keeps the loop where it is: the nearest crossings
  // of −1 above and below the present gain.
  const up = phaseCrossings.filter((c) => c.gm > 1).map((c) => c.gm), down = phaseCrossings.filter((c) => c.gm < 1).map((c) => c.gm);
  const main = gainCrossings.reduce((best, c) => (!best || Math.abs(c.pm) < Math.abs(best.pm) ? c : best), null);
  return {
    gainCrossings, phaseCrossings,
    wc: main?.w ?? NaN, pm: main?.pm ?? Infinity, dm: main ? Math.min(...gainCrossings.map((c) => c.dm)) : Infinity,
    get dmSamples() { return this.dm / Ts; },
    gmUp: up.length ? Math.min(...up) : Infinity, gmDown: down.length ? Math.max(...down) : 0,
    ms, wMs, mt, wMt,
  };
}

// The closed loop's response to a unit step in r (prefilter left out): the
// first measurement y and the controller output u at each sample, for K
// samples. The plant must not pass u straight to a measurement (D = 0), as
// physical plants do not.
export function stepResponse(plant, ctrl, Ts, K = 200) {
  const P = discretePlant(plant, Ts), n = P.A.length, m = P.C.length, nc = ctrl.A.length;
  const col = (row, j) => row[j] ?? 0;
  let xp = new Array(n).fill(0), xc = new Array(nc).fill(0);
  const t = [], y = [], u = [];
  for (let k = 0; k <= K; k++) {
    const ym = P.C.map((row) => row.reduce((s, c, j) => s + c * xp[j], 0));
    let uk = col(ctrl.D[0], 0);
    for (let j = 0; j < m; j++) uk += col(ctrl.D[0], 1 + j) * ym[j];
    for (let j = 0; j < nc; j++) uk += ctrl.C[0][j] * xc[j];
    t.push(k * Ts); y.push(ym[0]); u.push(uk);
    xp = P.A.map((row, i) => row.reduce((s, a, j) => s + a * xp[j], 0) + P.B[i][0] * uk);
    xc = ctrl.A.map((row, i) => row.reduce((s, a, j) => s + a * xc[j], 0) + col(ctrl.B[i], 0) + ym.reduce((s, v, j) => s + col(ctrl.B[i], 1 + j) * v, 0));
  }
  return { t, y, u };
}

// Root locus: closed-loop poles for the loop gain scaled by each k.
export function locus(L, ks) { return ks.map((k) => ({ k, poles: closedLoop(L, k) })); }

// Everything the tab shows, from the plant and controller models.
export function analyzeLoop(plant, ctrl, Ts, { points = 400 } = {}) {
  const L = openLoop(plant, ctrl, Ts);
  const olPoles = eig(L.A), clPoles = closedLoop(L, 1);
  const outside = (ps) => ps.filter((p) => Math.hypot(p.re, p.im) > 1 + 1e-9).length;
  const P = outside(olPoles), Z = outside(clPoles);
  const fd = frequencyData(L, { points });
  const margins = loopMargins(fd, Ts);
  const cl = clPoles.map((z) => ({ z, s: sOf(z, Ts) }));
  const oscillating = cl.filter((p) => Math.abs(p.s.im) > 1e-6);
  const zetaMin = oscillating.length ? Math.min(...oscillating.map((p) => p.s.zeta)) : 1;
  const slowest = cl.filter((p) => Number.isFinite(p.s.re)).reduce((a, p) => (!a || p.s.re > a.s.re ? p : a), null);
  const ks = Array.from({ length: 121 }, (_, i) => 10 ** (-2 + (4 * i) / 120));
  return {
    L, Ts, olPoles, clPoles: cl, stable: Z === 0, P, Z, N: Z - P, zetaMin, slowest,
    fd, margins, locus: locus(L, ks),
  };
}
