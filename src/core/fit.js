// Small continuous-time models fitted to a measured record (Identify,
// design/output/identification.md §6–7): the structures (a gain with lags, a
// resonance, an integrator, each with a dead time), their exact zero-order-
// hold discretisation with a fractional dead time, a deterministic
// Levenberg–Marquardt, the fit of a structure to segments of a record, the
// choice between structures, and the measures of validation (fit %, the
// residuals' whiteness and their cross-correlation with u). Pure functions,
// no DOM, no clock and no randomness: shared by the page, Node and the CLI.
//
// A segment is a stretch of the record that starts at rest (§6.1):
//   { y,        the measured y, samples k = 0 … N−1 (y[0] at the start)
//     yStart,   the level y rests at when it starts: a mean over the settle
//               before, not one noisy sample (default y[0]); an error here is
//               an offset the replay carries until the law's integral removes it
//     uStart,   the u that held it there; the model is driven by u − uStart
//     u,        open loop: the u the plant applied at each sample, or
//     law,      closed loop: () => (k, ŷ) => u, a fresh causal law per replay,
//               fed the model's own output (the closed-loop output error)
//     weight }  1/floor², the weight of each squared residual (default 1)
// The model replays a segment at rest from its start: ŷ = yStart + Δŷ.
// Residuals count from k = 1 (ŷ[0] is yStart whatever the parameters).

import { c2d, cholesky, cholSolve } from './linalg.js';
import { fft, nextPow2 } from './spectrum.js';

const TWO_PI = 2 * Math.PI;

// ---- Structures

// The parameters and what they mean in plain words (the chain's tooltips).
// kind: 'signed' (a gain; its sign is fixed by the start), 'positive' (fitted
// in logs) or 'delay' (θ ≥ 0, fitted in samples).
const PARAMS = {
  K: { key: 'K', label: 'K', kind: 'signed', tip: 'gain: how much y changes per unit of u, once it has settled' },
  kp: { key: 'kp', label: 'k′', kind: 'signed', tip: 'rate: how fast y moves per unit of u; y keeps moving as long as u is held (it integrates)' },
  tau: { key: 'tau', label: 'τ', kind: 'positive', unit: 's', tip: 'time constant: y covers 63 % of a change in this time' },
  tau1: { key: 'tau1', label: 'τ₁', kind: 'positive', unit: 's', tip: 'the slower time constant: y covers 63 % of a change in about τ₁ + τ₂' },
  tau2: { key: 'tau2', label: 'τ₂', kind: 'positive', unit: 's', tip: 'the faster time constant: it rounds the start of a change' },
  f: { key: 'f', label: 'f', kind: 'positive', unit: 'Hz', tip: 'the frequency it swings at, undamped' },
  zeta: { key: 'zeta', label: 'ζ', kind: 'positive', tip: 'how quickly a swing dies out: 0.7 swings once, 0.1 rings for a long time' },
  theta: { key: 'theta', label: 'θ', kind: 'delay', unit: 's', tip: 'dead time: how long before y starts to respond' },
};
const INTEGRATOR_TIP = 'integrator: y keeps moving as long as it is pushed';

const rows = (...r) => r;

// The time constants of a second-order pair ωn, ζ (s): one envelope 1/(ζωn)
// when it swings, else the two real poles' (the slow one first).
function pairTimes(f, zeta) {
  const wn = TWO_PI * f;
  if (zeta < 1) return [1 / (zeta * wn)];
  const r = Math.sqrt(zeta * zeta - 1);
  // ζ − √(ζ² − 1) = 1 / (ζ + √(ζ² − 1)), without cancellation.
  return [(zeta + r) / wn, 1 / ((zeta + r) * wn)];
}

const gainUnit = (units) => (units.y || units.u ? `${units.y || '1'}/${units.u || '1'}` : '');
const rateUnit = (units) => `${units.y || '1'}/(${units.u || '1'}·s)`;

// A chain entry per parameter, in the order the signal passes them.
function entry(kind, key, p, sd, unit) {
  const d = PARAMS[key];
  return { kind, key, label: d.label, value: p[key], sd: sd?.[key] ?? null, unit: unit ?? d.unit ?? '', tip: d.tip };
}
const integratorEntry = () => ({ kind: 'integrator', key: null, label: '∫', value: null, sd: null, unit: '', tip: INTEGRATOR_TIP });

// Start values from a guess (the first look or the kernel estimate):
// { K | kp, tau, theta, f, zeta }; what a guess lacks is made from the rest.
function scaleOf(g) {
  if (g.tau > 0) return g.tau;
  if (g.f > 0) return 1 / (TWO_PI * g.f);
  return 1;
}
const gainOf = (g) => (Number.isFinite(g.K) && g.K !== 0 ? g.K : Number.isFinite(g.kp) && g.kp !== 0 ? g.kp * scaleOf(g) : 1);
const rateOf = (g) => (Number.isFinite(g.kp) && g.kp !== 0 ? g.kp : gainOf(g) / scaleOf(g));
const thetaOf = (g) => (g.theta > 0 ? g.theta : 0);

// Each structure: its parameters, G(s) as polynomials (highest power first)
// with its dead time, a state-space realisation whose states are named by
// the chain, the chain itself, start values, and its time constants (the
// integrator's excluded).
export const STRUCTURES = {
  lag: {
    name: 'lag', label: 'lag', glyph: 'gain · lag · dead time', integrating: false,
    params: ['K', 'tau', 'theta'],
    tf: (p) => ({ num: [p.K], den: [p.tau, 1], delay: p.theta }),
    ss: (p) => ({
      A: rows([-1 / p.tau]), B: rows([p.K / p.tau]), C: rows([1]), D: rows([0]),
      states: [{ label: 'lag' }],
    }),
    chain: (p, { sd, units = {} } = {}) => [entry('gain', 'K', p, sd, gainUnit(units)), entry('delay', 'theta', p, sd), entry('lag', 'tau', p, sd)],
    start: (g) => ({ K: gainOf(g), tau: scaleOf(g), theta: thetaOf(g) }),
    times: (p) => [p.tau],
  },
  lags: {
    name: 'lags', label: 'two lags', glyph: 'gain · two lags · dead time', integrating: false,
    params: ['K', 'tau1', 'tau2', 'theta'],
    tf: (p) => ({ num: [p.K], den: [p.tau1 * p.tau2, p.tau1 + p.tau2, 1], delay: p.theta }),
    // Lag 1 (gain K) feeds lag 2.
    ss: (p) => ({
      A: rows([-1 / p.tau1, 0], [1 / p.tau2, -1 / p.tau2]), B: rows([p.K / p.tau1], [0]), C: rows([0, 1]), D: rows([0]),
      states: [{ label: 'lag 1' }, { label: 'lag 2' }],
    }),
    chain: (p, { sd, units = {} } = {}) => [entry('gain', 'K', p, sd, gainUnit(units)), entry('delay', 'theta', p, sd), entry('lag', 'tau1', p, sd), entry('lag', 'tau2', p, sd)],
    // The same first-order time scale: τ₁ + τ₂/2 = τ (the half rule).
    start: (g) => { const t = scaleOf(g); return { K: gainOf(g), tau1: 0.875 * t, tau2: 0.25 * t, theta: thetaOf(g) }; },
    times: (p) => [p.tau1, p.tau2],
    // The model is the same with τ₁ and τ₂ swapped; the slower is τ₁.
    order: (p) => (p.tau1 < p.tau2 ? [0, 2, 1, 3] : null),
  },
  resonance: {
    name: 'resonance', label: 'resonance', glyph: 'gain · resonance · dead time', integrating: false,
    params: ['K', 'f', 'zeta', 'theta'],
    tf: (p) => { const w = TWO_PI * p.f; return { num: [p.K * w * w], den: [1, 2 * p.zeta * w, w * w], delay: p.theta }; },
    // x1 = y, x2 = its rate.
    ss: (p) => {
      const w = TWO_PI * p.f;
      return {
        A: rows([0, 1], [-w * w, -2 * p.zeta * w]), B: rows([0], [p.K * w * w]), C: rows([1, 0]), D: rows([0]),
        states: [{ label: 'resonance.x1' }, { label: 'resonance.x2' }],
      };
    },
    chain: (p, { sd, units = {} } = {}) => [entry('gain', 'K', p, sd, gainUnit(units)), entry('delay', 'theta', p, sd), entry('resonance', 'f', p, sd), entry('resonance', 'zeta', p, sd)],
    start: (g) => ({ K: gainOf(g), f: g.f > 0 ? g.f : 1 / (TWO_PI * scaleOf(g)), zeta: g.zeta > 0 ? g.zeta : 0.7, theta: thetaOf(g) }),
    times: (p) => pairTimes(p.f, p.zeta),
  },
  intLag: {
    name: 'intLag', label: 'integrator · lag', glyph: 'gain · integrator · lag · dead time', integrating: true,
    params: ['kp', 'tau', 'theta'],
    tf: (p) => ({ num: [p.kp], den: [p.tau, 1, 0], delay: p.theta }),
    // The lag (gain k′, a rate) feeds the integrator.
    ss: (p) => ({
      A: rows([-1 / p.tau, 0], [1, 0]), B: rows([p.kp / p.tau], [0]), C: rows([0, 1]), D: rows([0]),
      states: [{ label: 'lag' }, { label: 'integrator' }],
    }),
    chain: (p, { sd, units = {} } = {}) => [entry('gain', 'kp', p, sd, rateUnit(units)), entry('delay', 'theta', p, sd), integratorEntry(), entry('lag', 'tau', p, sd)],
    start: (g) => ({ kp: rateOf(g), tau: g.tau > 0 ? g.tau : scaleOf(g), theta: thetaOf(g) }),
    times: (p) => [p.tau],
  },
  intRes: {
    name: 'intRes', label: 'integrator · resonance', glyph: 'gain · integrator · resonance · dead time', integrating: true,
    params: ['kp', 'f', 'zeta', 'theta'],
    tf: (p) => { const w = TWO_PI * p.f; return { num: [p.kp * w * w], den: [1, 2 * p.zeta * w, w * w, 0], delay: p.theta }; },
    // The resonance (gain k′, a rate: x1, x2) feeds the integrator (x3).
    ss: (p) => {
      const w = TWO_PI * p.f;
      return {
        A: rows([0, 1, 0], [-w * w, -2 * p.zeta * w, 0], [1, 0, 0]), B: rows([0], [p.kp * w * w], [0]), C: rows([0, 0, 1]), D: rows([0]),
        states: [{ label: 'resonance.x1' }, { label: 'resonance.x2' }, { label: 'integrator' }],
      };
    },
    chain: (p, { sd, units = {} } = {}) => [entry('gain', 'kp', p, sd, rateUnit(units)), entry('delay', 'theta', p, sd), integratorEntry(), entry('resonance', 'f', p, sd), entry('resonance', 'zeta', p, sd)],
    start: (g) => ({ kp: rateOf(g), f: g.f > 0 ? g.f : 1 / (TWO_PI * scaleOf(g)), zeta: g.zeta > 0 ? g.zeta : 0.7, theta: thetaOf(g) }),
    times: (p) => pairTimes(p.f, p.zeta),
  },
};

export const paramInfo = (key) => PARAMS[key];

function structureOf(s) {
  const S = typeof s === 'string' ? STRUCTURES[s] : s;
  if (!S || !S.params) throw new Error(`fit: unknown structure ${typeof s === 'string' ? s : JSON.stringify(s)} (one of ${Object.keys(STRUCTURES).join(', ')})`);
  return S;
}

// ---- Exact discretisation with a fractional dead time

// The structure at sample time Ts under a zero-order hold, with its dead time
// θ = (m + f)·Ts exact: over a sample the delayed input is u[k−m−1] for the
// first f·Ts and u[k−m] after, so
//   x[k+1] = Φ x[k] + Γ0 u[k−m] + Γ1 u[k−m−1],   y[k] = C x[k],
//   Γ0 = ∫₀^{(1−f)Ts} e^{As} ds B,   Γ1 = e^{A(1−f)Ts} ∫₀^{f·Ts} e^{As} ds B.
// Every structure is strictly proper (D = 0).
export function discretise(structure, p, Ts) {
  const S = structureOf(structure);
  if (!(Ts > 0)) throw new Error('discretise: Ts must be positive');
  const { A, B, C } = S.ss(p);
  const n = A.length;
  const ds = Math.max(0, (p.theta ?? 0) / Ts);
  let m = Math.floor(ds + 1e-9), f = ds - m;
  if (f < 1e-9) f = 0;
  let Phi, G0, G1;
  if (f === 0) {
    const d = c2d(A, B, Ts);
    Phi = d.Ad; G0 = d.Bd.map((r) => r[0]); G1 = new Array(n).fill(0);
  } else {
    const a = c2d(A, B, (1 - f) * Ts), b = c2d(A, B, f * Ts);
    Phi = a.Ad.map((r) => b.Ad[0].map((_, j) => r.reduce((s, v, k) => s + v * b.Ad[k][j], 0)));
    G0 = a.Bd.map((r) => r[0]);
    G1 = a.Ad.map((r) => r.reduce((s, v, k) => s + v * b.Bd[k][0], 0));
  }
  return { structure: S.name, n, Phi, G0, G1, C: C[0].slice(), m, f, Ts, theta: (m + f) * Ts };
}

// ---- Replaying a segment

// The model's y over a segment (and the u that drove it): at rest at the
// start, driven by u − uStart, delayed exactly. A closed-loop segment's law
// is fed the model's own output, so the measured noise never enters u.
export function simulateSegment(d, seg) {
  const N = seg.y ? seg.y.length : seg.n ?? seg.u.length;
  const n = d.n, m = d.m;
  const Phi = Float64Array.from(d.Phi.flat()), G0 = Float64Array.from(d.G0), G1 = Float64Array.from(d.G1), C = Float64Array.from(d.C);
  const y0 = seg.yStart ?? (seg.y ? seg.y[0] : 0), u0 = seg.uStart ?? 0;
  const law = seg.law ? seg.law() : null;
  const yhat = new Float64Array(N), uOut = new Float64Array(N);
  // Δu over the last m + 2 samples (0 before the start: at rest).
  const L = m + 2, hist = new Float64Array(L);
  let x = new Float64Array(n), xn = new Float64Array(n);
  for (let k = 0; k < N; k++) {
    let yk = y0;
    for (let i = 0; i < n; i++) yk += C[i] * x[i];
    yhat[k] = yk;
    const u = law ? law(k, yk) : seg.u[k];
    uOut[k] = u;
    hist[k % L] = u - u0;
    const a = k - m >= 0 ? hist[(k - m) % L] : 0, b = k - m - 1 >= 0 ? hist[(k - m - 1) % L] : 0;
    for (let i = 0; i < n; i++) {
      let s = G0[i] * a + G1[i] * b;
      const o = i * n;
      for (let j = 0; j < n; j++) s += Phi[o + j] * x[j];
      xn[i] = s;
    }
    const t = x; x = xn; xn = t;
  }
  return { y: yhat, u: uOut };
}

// The weighted residuals √w·(y − ŷ) of every segment, from k = 1, end to end.
function residuals(d, segments, out) {
  let o = 0;
  for (const seg of segments) {
    const { y: yh } = simulateSegment(d, seg);
    const w = Math.sqrt(seg.weight ?? 1), y = seg.y;
    for (let k = 1; k < y.length; k++) out[o++] = w * (y[k] - yh[k]);
  }
  return out;
}

// ---- Levenberg–Marquardt

const sumSq = (r) => { let s = 0; for (let i = 0; i < r.length; i++) s += r[i] * r[i]; return s; };
const allFinite = (r) => { for (let i = 0; i < r.length; i++) if (!Number.isFinite(r[i])) return false; return true; };

function drain(gen) {
  for (;;) { const s = gen.next(); if (s.done) return s.value; }
}

// Minimises Σ r(p)² from p0, deterministically (no clock, no randomness):
// forward-difference Jacobians, Marquardt's scaling by diag(JᵀJ), Nielsen's
// damping update, bounds by projection (a parameter at a bound with the
// gradient pushing out of it is held for that step). Yields after each
// iteration (one trial step), so a caller can slice the work; maxIter caps
// the iterations. Returns { p, r, cost, J (at p), iterations, evaluations,
// converged, why }, why one of 'gradient', 'step', 'cost', 'iterations'.
export function* lmSteps(residual, p0, { maxIter = 60, lower = null, upper = null, step = null, gtol = 1e-10, xtol = 1e-12, ftol = 1e-14 } = {}) {
  const np = p0.length;
  const lo = (j) => (lower ? lower[j] ?? -Infinity : -Infinity), hi = (j) => (upper ? upper[j] ?? Infinity : Infinity);
  const clampJ = (v, j) => Math.min(hi(j), Math.max(lo(j), v));
  let p = Array.from(p0, (v, j) => clampJ(v, j));
  let evaluations = 0;
  const evalR = (q) => { evaluations++; return residual(q); };
  let r = evalR(p);
  if (!allFinite(r)) throw new Error('lm: the residual at the start is not finite');
  let cost = sumSq(r);
  const nr = r.length;

  const jacobian = (q, rq) => {
    const J = Array.from({ length: np }, () => new Float64Array(nr));   // by column
    for (let j = 0; j < np; j++) {
      let h = step?.[j] ?? 1e-6 * Math.max(1, Math.abs(q[j]));
      if (q[j] + h > hi(j)) h = -h;
      const qh = q.slice(); qh[j] = q[j] + h;
      let rh = evalR(qh);
      if (!allFinite(rh) && q[j] - h >= lo(j)) { h = -h; qh[j] = q[j] + h; rh = evalR(qh); }
      const col = J[j];
      if (allFinite(rh)) for (let i = 0; i < nr; i++) col[i] = (rh[i] - rq[i]) / h;
    }
    return J;
  };
  const normal = (J, rq) => {
    const A = Array.from({ length: np }, () => new Array(np).fill(0)), g = new Array(np).fill(0);
    for (let a = 0; a < np; a++) {
      const ca = J[a];
      let s = 0;
      for (let i = 0; i < nr; i++) s += ca[i] * rq[i];
      g[a] = s;
      for (let b = 0; b <= a; b++) {
        const cb = J[b];
        let t = 0;
        for (let i = 0; i < nr; i++) t += ca[i] * cb[i];
        A[a][b] = A[b][a] = t;
      }
    }
    return { A, g };
  };

  let J = jacobian(p, r);
  let { A, g } = normal(J, r);
  let mu = 1e-3 * Math.max(1e-300, ...A.map((row, i) => row[i])), nu = 2;
  let it = 0, why = 'iterations';
  for (;;) {
    // Held: at a bound with the gradient pushing out of it.
    const free = [];
    for (let j = 0; j < np; j++) if (!((p[j] <= lo(j) && g[j] > 0) || (p[j] >= hi(j) && g[j] < 0))) free.push(j);
    // Converged when r is (nearly) orthogonal to every free column of J.
    let gmax = 0;
    for (const j of free) { const den = Math.sqrt(A[j][j] * cost); if (den > 0) gmax = Math.max(gmax, Math.abs(g[j]) / den); }
    if (cost === 0 || gmax <= gtol) { why = 'gradient'; break; }
    if (it >= maxIter) break;
    it++;
    const dmax = Math.max(...free.map((j) => A[j][j]));
    const M = free.map((a) => free.map((b) => A[a][b] + (a === b ? mu * Math.max(A[a][a], 1e-12 * dmax, 1e-300) : 0)));
    let dFree;
    try { dFree = cholSolve(cholesky(M), free.map((j) => -g[j])); } catch { mu *= nu; nu *= 2; yield { iteration: it, cost, mu }; continue; }
    const pNew = p.slice();
    free.forEach((j, i) => { pNew[j] = clampJ(p[j] + dFree[i], j); });
    const d = pNew.map((v, j) => v - p[j]);
    const dn = Math.hypot(...d), pn = Math.hypot(...p);
    if (dn <= xtol * (pn + xtol)) { why = 'step'; break; }
    const rNew = evalR(pNew);
    const costNew = allFinite(rNew) ? sumSq(rNew) : Infinity;
    // The decrease the linear model predicts for this step: −(2dᵀg + dᵀAd).
    let dAd = 0, dg = 0;
    for (let a = 0; a < np; a++) { dg += d[a] * g[a]; for (let b = 0; b < np; b++) dAd += d[a] * A[a][b] * d[b]; }
    const pred = -(2 * dg + dAd);
    const rho = pred > 0 ? (cost - costNew) / pred : costNew < cost ? 1 : -1;
    if (rho > 0) {
      const rel = (cost - costNew) / cost;
      p = pNew; r = rNew; cost = costNew;
      J = jacobian(p, r);
      ({ A, g } = normal(J, r));
      mu *= Math.max(1 / 3, 1 - (2 * rho - 1) ** 3);
      nu = 2;
      if (rel <= ftol) { why = 'cost'; break; }
    } else {
      mu *= nu;
      nu *= 2;
    }
    yield { iteration: it, cost, mu };
  }
  return { p, r, cost, J, A, iterations: it, evaluations, converged: why !== 'iterations', why };
}

export const lm = (residual, p0, opts) => drain(lmSteps(residual, p0, opts));

// ---- Fitting a structure to segments

// Logs keep positive parameters positive; a gain's sign is fixed by its
// start; θ is fitted in samples, 0 … the longest segment.
const LOG_BOUND = 46;   // e^±46 ≈ 1e±20

// How a measurement error at the start of a segment reaches the residuals:
// the impulse response h of the residual y − ŷ to an error added to what the
// segment's law reads at k = 1 (h[0] = 1, the error itself; then the model's
// answer to the law's answer), for the model d. An open-loop segment has
// h = [1]. A closed-loop replay leaves the measurement noise filtered by the
// loop (S·v), so its residuals are coloured where the loop acts. The tail is
// cut where less than 1e-9 of Σh² remains. Linear about the replay: the error
// is 1e-6 of the segment's y range, and a law at a clamp passes none of it.
export function noiseTransfer(d, seg) {
  if (!seg.law) return Float64Array.of(1);
  const N = seg.y.length;
  if (N < 3) return Float64Array.of(1);
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < N; k++) { lo = Math.min(lo, seg.y[k]); hi = Math.max(hi, seg.y[k]); }
  const eps = 1e-6 * Math.max(hi - lo, Math.abs(seg.yStart ?? seg.y[0]), 1e-12);
  const base = simulateSegment(d, seg).y;
  const pert = simulateSegment(d, { ...seg, law: () => { const f = seg.law(); return (k, y) => f(k, k === 1 ? y + eps : y); } }).y;
  const h = new Float64Array(N - 1);
  h[0] = 1;
  for (let q = 1; q < N - 1; q++) h[q] = (pert[1 + q] - base[1 + q]) / eps;
  let total = 0;
  for (let q = 0; q < h.length; q++) total += h[q] * h[q];
  let len = h.length, tail = 0;
  while (len > 1 && tail + h[len - 1] * h[len - 1] < 1e-9 * total) { tail += h[len - 1] * h[len - 1]; len--; }
  return h.slice(0, len);
}

// c(t) = Σ_q h(q) x(t + q) for t = 0 … x.length − 1 (x read as 0 beyond its
// end): directly for a short h, else by a zero-padded FFT.
function correlate(x, h) {
  const n = x.length, L = Math.min(h.length, n);
  const out = new Float64Array(n);
  if (L <= 32) {
    for (let t = 0; t < n; t++) {
      let s = 0;
      const m = Math.min(L, n - t);
      for (let q = 0; q < m; q++) s += h[q] * x[t + q];
      out[t] = s;
    }
    return out;
  }
  // IFFT(X · conj(H))[t] = Σ_q x[t + q] h[q], with no wrap at n + L ≤ size.
  const size = nextPow2(n + L);
  const xr = new Float64Array(size), xi = new Float64Array(size), hr = new Float64Array(size), hi = new Float64Array(size);
  xr.set(x); hr.set(h.subarray(0, L));
  fft(xr, xi); fft(hr, hi);
  for (let k = 0; k < size; k++) {
    const re = xr[k] * hr[k] + xi[k] * hi[k], im = xi[k] * hr[k] - xr[k] * hi[k];
    xr[k] = re; xi[k] = -im;   // conjugated: the inverse as conj(fft(conj(·)))/size
  }
  fft(xr, xi);
  for (let t = 0; t < n; t++) out[t] = xr[t] / size;
  return out;
}

// The covariance of the fitted parameters q from the Jacobian J (by column,
// segments end to end), A = JᵀJ, and each segment's noise transfer h
// (noiseTransfer) and length: residual = S·v with v white of variance σv²,
// so cov = A⁻¹ (σv² Σ_t g_t g_tᵀ) A⁻¹ with g = SᵀJ per segment,
// (SᵀJ)(t) = Σ_q h(q) J(t + q). σv² = s2 / H̄, s2 the residual variance per
// sample and H̄ the mean Σh² (what S does to the noise's power). With open-
// loop segments only (h = [1]) this is σ̂² A⁻¹ exactly. Returns null when A
// is singular.
export function parameterCov(J, A, parts, s2) {
  const np = A.length;
  let Ainv;
  try { Ainv = cholSolve(cholesky(A), A.map((_, i) => A.map((__, j) => (i === j ? 1 : 0)))); } catch { return null; }
  if (parts.every((pt) => pt.h.length === 1 && pt.h[0] === 1)) return Ainv.map((row) => row.map((v) => s2 * v));
  let o = 0, power = 0, n = 0;
  const Om = A.map((row) => row.map(() => 0));
  const g = Array.from({ length: np }, () => null);
  for (const { length, h } of parts) {
    let H = 0;
    for (let q = 0; q < h.length; q++) H += h[q] * h[q];
    power += H * length;
    n += length;
    for (let a = 0; a < np; a++) g[a] = correlate(J[a].subarray(o, o + length), h);
    for (let a = 0; a < np; a++) {
      for (let b = 0; b <= a; b++) {
        let s = 0;
        const ga = g[a], gb = g[b];
        for (let t = 0; t < length; t++) s += ga[t] * gb[t];
        Om[a][b] += s;
        if (a !== b) Om[b][a] += s;
      }
    }
    o += length;
  }
  const sv2 = power > 0 ? (s2 * n) / power : s2;
  const AO = Ainv.map((row) => Om[0].map((_, j) => row.reduce((s, v, k) => s + v * Om[k][j], 0)));
  const cov = AO.map((row) => Ainv[0].map((_, j) => sv2 * row.reduce((s, v, k) => s + v * Ainv[k][j], 0)));
  return cov.map((row, i) => row.map((v, j) => (v + cov[j][i]) / 2));
}

// Fits a structure to segments (open or closed loop, see the top) by
// Levenberg–Marquardt from each start (parameter objects), keeping the
// lowest cost. Yields progress; returns { structure, p, cov, sd, cost,
// chi2dof, bic, n, np, start, iterations, evaluations, converged }.
// cov = σ̂²(JᵀJ)⁻¹ in the parameters' own units, σ̂² the weighted residual
// variance (so the bars grow when the model misses), on open-loop segments;
// closed-loop segments leave the noise filtered by the loop in the
// residuals, and cov follows it there (parameterCov).
export function* fitStructureSteps(segments, structure, starts, { Ts = segments[0]?.Ts, maxIter = 60 } = {}) {
  const S = structureOf(structure);
  if (!(Ts > 0)) throw new Error('fitStructure: Ts must be positive (pass { Ts } or put it on the segments)');
  if (!segments.length) throw new Error('fitStructure: no segments');
  if (!starts?.length) throw new Error('fitStructure: no start');
  const kinds = S.params.map((k) => PARAMS[k].kind);
  const N = segments.reduce((s, seg) => s + Math.max(0, seg.y.length - 1), 0);
  const np = S.params.length;
  if (N <= np) throw new Error(`fitStructure: ${N} samples cannot fit ${np} parameters`);
  const longest = Math.max(...segments.map((seg) => seg.y.length));
  const lower = kinds.map((k) => (k === 'delay' ? 0 : -LOG_BOUND));
  const upper = kinds.map((k) => (k === 'delay' ? longest : LOG_BOUND));
  let best = null;
  for (let s = 0; s < starts.length; s++) {
    const st = starts[s];
    const sign = S.params.map((k, j) => (kinds[j] === 'signed' && st[k] < 0 ? -1 : 1));
    const toP = (q) => Object.fromEntries(S.params.map((k, j) => [k, kinds[j] === 'delay' ? q[j] * Ts : kinds[j] === 'signed' ? sign[j] * Math.exp(q[j]) : Math.exp(q[j])]));
    const q0 = S.params.map((k, j) => {
      const v = st[k] ?? 0;
      if (kinds[j] === 'delay') return Math.max(0, v / Ts);
      if (!(Math.abs(v) > 0) || !Number.isFinite(v)) throw new Error(`fitStructure: start ${s + 1} needs ${k} ≠ 0`);
      return Math.log(Math.abs(v));
    });
    const residual = (q) => residuals(discretise(S, toP(q), Ts), segments, new Float64Array(N));
    const res = yield* lmSteps(residual, q0, { maxIter, lower, upper });
    if (!best || res.cost < best.res.cost) best = { res, toP, start: s };
  }
  const { res, toP, start } = best;
  const p = toP(res.p);
  const dof = Math.max(1, N - np);
  const sigma2 = res.cost / dof;
  // In the fitted coordinates, then by dp/dq to the parameters.
  const dpdq = S.params.map((k, j) => (kinds[j] === 'delay' ? Ts : p[k]));
  const d = discretise(S, p, Ts);
  const parts = segments.map((seg) => ({ length: Math.max(0, seg.y.length - 1), h: noiseTransfer(d, seg) }));
  const cq = parameterCov(res.J, res.A, parts, sigma2);
  const cov = cq && cq.map((row, i) => row.map((v, j) => v * dpdq[i] * dpdq[j]));
  const out = { structure: S.name, p, cov, cost: res.cost, chi2dof: sigma2, bic: N * Math.log(Math.max(res.cost, 1e-300) / N) + np * Math.log(N), n: N, np, start, iterations: res.iterations, evaluations: res.evaluations, converged: res.converged, why: res.why };
  const perm = S.order?.(p);
  if (perm) {
    out.p = Object.fromEntries(S.params.map((k, j) => [k, p[S.params[perm[j]]]]));
    if (cov) out.cov = perm.map((a) => perm.map((b) => cov[a][b]));
  }
  out.sd = Object.fromEntries(S.params.map((k, j) => [k, out.cov ? Math.sqrt(Math.max(0, out.cov[j][j])) : null]));
  return out;
}

export const fitStructure = (segments, structure, starts, opts) => drain(fitStructureSteps(segments, structure, starts, opts));

// ---- Choosing a structure (§6.4)

export const CHOICE = {
  within: 1,      // points of Check fit: the fewest parameters within this of the best
  bicTie: 2,      // BIC differences below this decide nothing; the earlier structure is read more easily
  zetaMax: 5,     // ζ above this is not supported by the data
  slowest: 10,    // a time constant above this many test lengths is not supported
};

// Why a fit is not supported by the data (✕), or null: unstable other than
// its integrator, ζ above CHOICE.zetaMax, or a time constant longer than
// CHOICE.slowest × the test's length (seconds).
export function unsupported(structure, p, { length = Infinity } = {}) {
  const S = structureOf(structure);
  for (const k of S.params) if (!Number.isFinite(p[k])) return `${PARAMS[k].label} is not a number`;
  if (S.params.some((k) => PARAMS[k].kind === 'positive' && !(p[k] > 0))) return 'unstable';
  if ('zeta' in p && p.zeta > CHOICE.zetaMax) return `ζ ${p.zeta.toPrecision(2)} is above ${CHOICE.zetaMax}`;
  const slow = Math.max(...S.times(p));
  if (slow > CHOICE.slowest * length) return `a time constant of ${slow.toPrecision(2)} s is more than ${CHOICE.slowest} × the test's length`;
  return null;
}

// The candidate to use: of those supported (all, when none is), the fewest
// parameters within CHOICE.within points of the best Check fit; among those,
// the lowest BIC on the fitting data, where a difference below CHOICE.bicTie
// goes to the structure listed first in STRUCTURES. Candidates:
// [{ structure, fit, bic, unsupported? }]. Returns { index, why }.
export function chooseStructure(cands) {
  if (!cands.length) return { index: -1, why: 'no candidate' };
  const order = Object.keys(STRUCTURES);
  const np = (c) => structureOf(c.structure).params.length;
  let pool = cands.map((c, i) => i).filter((i) => !cands[i].unsupported && Number.isFinite(cands[i].fit));
  const none = !pool.length;
  if (none) pool = cands.map((c, i) => i).filter((i) => Number.isFinite(cands[i].fit));
  if (!pool.length) return { index: -1, why: 'no candidate has a fit' };
  const bestFit = Math.max(...pool.map((i) => cands[i].fit));
  const near = pool.filter((i) => cands[i].fit >= bestFit - CHOICE.within);
  const fewest = Math.min(...near.map((i) => np(cands[i])));
  const simplest = near.filter((i) => np(cands[i]) === fewest);
  const bicOf = (i) => (Number.isFinite(cands[i].bic) ? cands[i].bic : Infinity);
  const bestBic = Math.min(...simplest.map(bicOf));
  const tied = simplest.filter((i) => bicOf(i) < bestBic + CHOICE.bicTie || bicOf(i) === bestBic);
  tied.sort((a, b) => order.indexOf(cands[a].structure) - order.indexOf(cands[b].structure) || a - b);
  const index = tied[0];
  const best = cands[index].fit === bestFit;
  let why = best && near.length === 1 ? 'the best fit' : best ? 'the best fit, and the simplest within 1 point of it' : `the simplest within ${CHOICE.within} point of the best`;
  if (simplest.length > 1) why += tied.length > 1 ? '; as good as another of its size, and easier to read' : '; BIC decided between those of its size';
  if (none) why += '; none is supported by the data';
  return { index, why };
}

// ---- Validation (§7)

// The fit in %, as MATLAB's compare defines it (NRMSE):
// 100 (1 − ‖y − ŷ‖ / ‖y − ȳ‖). 100 is perfect, 0 no better than the mean.
export function fitPercent(y, yhat) {
  const N = y.length;
  if (yhat.length !== N) throw new Error('fitPercent: y and ŷ differ in length');
  let mean = 0;
  for (let i = 0; i < N; i++) mean += y[i];
  mean /= N;
  let e = 0, v = 0;
  for (let i = 0; i < N; i++) { e += (y[i] - yhat[i]) ** 2; v += (y[i] - mean) ** 2; }
  return 100 * (1 - Math.sqrt(e) / Math.sqrt(v));
}

// The best fit any model could reach on this noise (§7):
// 100 (1 − floor·√N / ‖y − ȳ‖).
export function noiseCeiling(y, floor) {
  const N = y.length;
  let mean = 0;
  for (let i = 0; i < N; i++) mean += y[i];
  mean /= N;
  let v = 0;
  for (let i = 0; i < N; i++) v += (y[i] - mean) ** 2;
  return 100 * (1 - (floor * Math.sqrt(N)) / Math.sqrt(v));
}

// The 99 % band of a white sequence's normalised correlations: ±2.58/√N.
export const Z99 = 2.58;
// A pattern: two or more lags outside the band (white residuals put 0.25 of
// 25 there; two or more in 2.6 % of records), or one beyond 1.5 × the band
// (3.9/√N: 0.25 % of white records).
export const WHITE = { outside: 1, far: 1.5 };
const looksWhite = (outside, worst) => outside <= WHITE.outside && worst <= WHITE.far;

// The residuals' autocorrelation over lags 1 … lags, normalised by lag 0,
// R(τ) = Σ e[k] e[k−τ] / Σ e[k]² (Ljung: no mean removed, so an offset is a
// pattern), against ±2.58/√N. white: no pattern by WHITE's rule.
export function whiteness(res, lags = 25) {
  const N = res.length;
  let r0 = 0;
  for (let k = 0; k < N; k++) r0 += res[k] * res[k];
  const r = new Float64Array(lags);
  for (let t = 1; t <= lags; t++) {
    let s = 0;
    for (let k = t; k < N; k++) s += res[k] * res[k - t];
    r[t - 1] = r0 > 0 ? s / r0 : 0;
  }
  const band = Z99 / Math.sqrt(N);
  let outside = 0, worst = 0;
  for (let i = 0; i < lags; i++) { if (Math.abs(r[i]) > band) outside++; worst = Math.max(worst, Math.abs(r[i]) / band); }
  return { r, band, outside, worst, white: looksWhite(outside, worst) };
}

// The residuals' cross-correlation with past u over lags 0 … lags,
// R(τ) = Σ e[k] ũ[k−τ] / √(Σe² Σũ²), ũ = u − its mean (u's level is
// arbitrary), against ±2.58/√N. independent: no pattern by WHITE's rule.
// A hint, not a verdict (valid under the assumptions it checks).
export function crossCorrelation(res, u, lags = 25) {
  const N = res.length;
  if (u.length !== N) throw new Error('crossCorrelation: residuals and u differ in length');
  let mean = 0;
  for (let k = 0; k < N; k++) mean += u[k];
  mean /= N;
  let ee = 0, uu = 0;
  for (let k = 0; k < N; k++) { ee += res[k] * res[k]; uu += (u[k] - mean) ** 2; }
  const den = Math.sqrt(ee * uu);
  const r = new Float64Array(lags + 1);
  for (let t = 0; t <= lags; t++) {
    let s = 0;
    for (let k = t; k < N; k++) s += res[k] * (u[k - t] - mean);
    r[t] = den > 0 ? s / den : 0;
  }
  const band = Z99 / Math.sqrt(N);
  let outside = 0, worst = 0;
  for (let i = 0; i <= lags; i++) { if (Math.abs(r[i]) > band) outside++; worst = Math.max(worst, Math.abs(r[i]) / band); }
  return { r, band, outside, worst, independent: looksWhite(outside, worst) };
}
