// Small continuous-time models fitted to a measured record (Identify,
// design/output/identification.md §5.6, §6–7): the structures (a gain with
// lags, a resonance, an integrator, each with a dead time), their exact zero-
// order-hold discretisation with a fractional dead time, a deterministic
// Levenberg–Marquardt, the fit of a structure to segments of a record, the
// choice between structures, the measures of validation (fit %, the
// residuals' whiteness and their cross-correlation with u), the regularised
// impulse response (TC kernel) as the order-free reference, the random-odd
// multisine, and the frequency response from its whole periods with the noise
// and nonlinear distortion it shows. Pure functions, no DOM, no clock; the
// only randomness is the multisine's, from its seed. Shared by the page, Node
// and the CLI.
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

import { c2d, cholesky, cholSolve, eigSym } from './linalg.js';
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
// A sample without a measurement (y not a number: a lost cycle the plant held
// u over) counts 0.
export function residuals(d, segments, out) {
  let o = 0;
  for (const seg of segments) {
    const { y: yh } = simulateSegment(d, seg);
    const w = Math.sqrt(seg.weight ?? 1), y = seg.y;
    for (let k = 1; k < y.length; k++) out[o++] = Number.isFinite(y[k]) ? w * (y[k] - yh[k]) : 0;
  }
  return out;
}
// The measured samples residuals() counts (from k = 1, y a number).
export function observations(segments) {
  let n = 0;
  for (const seg of segments) for (let k = 1; k < seg.y.length; k++) if (Number.isFinite(seg.y[k])) n++;
  return n;
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
  let mu = 1e-3, nu = 2;   // dimensionless: the damping is mu·diag(JᵀJ) (Marquardt), so a uniform weight leaves the path unchanged
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

// a * b (b null: a). The loop's noise transfer with the noise's own colour.
export function convolve(a, b) {
  if (!b || b.length <= 1) return a;
  const o = new Float64Array(a.length + b.length - 1);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) o[i + j] += a[i] * b[j];
  return o;
}

// The colour of a stretch of pure noise (Listen's, y less its drift): an
// AR(p), p ≤ pmax by AIC, by Burg's method (on a short record near the unit
// circle Yule–Walker's lags shrink the pole: Listen's 150 samples of an
// AR(1) at 0.95), as the impulse response of 1/A(z), cut where less than
// 1e-12 of its energy remains. White, or too short a stretch: [1].
export function noiseColour(v, pmax = 10) {
  const n = v.length;
  if (n < 4 * pmax) return Float64Array.of(1);
  let m = 0;
  for (const x of v) m += x;
  m /= n;
  const f = Float64Array.from(v, (x) => x - m), b = Float64Array.from(f);
  let E = 0;
  for (const x of f) E += x * x;
  E /= n;
  if (!(E > 0)) return Float64Array.of(1);
  let a = [], best = { aic: n * Math.log(E), a: [] };
  for (let p = 1; p <= pmax; p++) {
    // The reflection that minimises the forward and backward errors together.
    let num = 0, den = 0;
    for (let t = p; t < n; t++) { num += f[t] * b[t - 1]; den += f[t] * f[t] + b[t - 1] * b[t - 1]; }
    const k = den > 0 ? (2 * num) / den : 0;
    a = [...a.map((x, j) => x - k * a[a.length - 1 - j]), k];
    for (let t = n - 1; t >= p; t--) { const ft = f[t], bt = b[t - 1]; f[t] = ft - k * bt; b[t] = bt - k * ft; }
    E *= 1 - k * k;
    const aic = n * Math.log(E) + 2 * p;
    if (aic < best.aic) best = { aic, a: a.slice() };
  }
  if (!best.a.length) return Float64Array.of(1);
  const h = [1];
  let tot = 1;
  for (let t = 1; t < 4096; t++) {
    let s = 0;
    for (let j = 0; j < best.a.length && j < t; j++) s += best.a[j] * h[t - 1 - j];
    h.push(s); tot += s * s;
    if (t > best.a.length && s * s < 1e-12 * tot) break;
  }
  return Float64Array.from(h);
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
// residuals, and cov follows it there (parameterCov). noise: the noise's own
// colour (noiseColour of a stretch of pure noise), convolved into each
// segment's noise transfer, so the bars hold when it is not white.
export function* fitStructureSteps(segments, structure, starts, { Ts = segments[0]?.Ts, maxIter = 60, noise = null } = {}) {
  const S = structureOf(structure);
  if (!(Ts > 0)) throw new Error('fitStructure: Ts must be positive (pass { Ts } or put it on the segments)');
  if (!segments.length) throw new Error('fitStructure: no segments');
  if (!starts?.length) throw new Error('fitStructure: no start');
  const kinds = S.params.map((k) => PARAMS[k].kind);
  const N = segments.reduce((s, seg) => s + Math.max(0, seg.y.length - 1), 0);
  const nObs = observations(segments);
  const np = S.params.length;
  if (nObs <= np) throw new Error(`fitStructure: ${nObs} samples cannot fit ${np} parameters`);
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
  const dof = Math.max(1, nObs - np);
  const sigma2 = res.cost / dof;
  // In the fitted coordinates, then by dp/dq to the parameters.
  const dpdq = S.params.map((k, j) => (kinds[j] === 'delay' ? Ts : p[k]));
  const d = discretise(S, p, Ts);
  const parts = segments.map((seg) => ({ length: Math.max(0, seg.y.length - 1), h: convolve(noiseTransfer(d, seg), noise) }));
  const cq = parameterCov(res.J, res.A, parts, sigma2);
  const cov = cq && cq.map((row, i) => row.map((v, j) => v * dpdq[i] * dpdq[j]));
  const out = { structure: S.name, p, cov, cost: res.cost, chi2dof: sigma2, bic: nObs * Math.log(Math.max(res.cost, 1e-300) / nObs) + np * Math.log(nObs), n: nObs, np, start, iterations: res.iterations, evaluations: res.evaluations, converged: res.converged, why: res.why };
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
// h: a closed-loop replay's noise transfer (noiseTransfer): its residual is
// S·v, which the loop colours even for the true model, so r is read about the
// autocorrelation S gives white noise, Σ h_q h_{q+τ} / Σ h² (expected).
export function whiteness(res, lags = 25, h = null) {
  const N = res.length;
  let r0 = 0;
  for (let k = 0; k < N; k++) r0 += res[k] * res[k];
  const r = new Float64Array(lags), expected = new Float64Array(lags);
  for (let t = 1; t <= lags; t++) {
    let s = 0;
    for (let k = t; k < N; k++) s += res[k] * res[k - t];
    r[t - 1] = r0 > 0 ? s / r0 : 0;
  }
  if (h && h.length > 1) {
    let H = 0;
    for (let q = 0; q < h.length; q++) H += h[q] * h[q];
    for (let t = 1; t <= lags; t++) { let s = 0; for (let q = 0; q + t < h.length; q++) s += h[q] * h[q + t]; expected[t - 1] = s / H; }
  }
  const band = Z99 / Math.sqrt(N);
  let outside = 0, worst = 0;
  for (let i = 0; i < lags; i++) { const d = Math.abs(r[i] - expected[i]); if (d > band) outside++; worst = Math.max(worst, d / band); }
  return { r, expected, band, outside, worst, white: looksWhite(outside, worst) };
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

// ---- The kernel reference (§6.8)

// The TC kernel K(i, j) = λ^max(i, j) (taps i, j = 1 … n) is the covariance
// of a random walk run backwards from the last tap: g_i = Σ_{j ≥ i} w_j with
// w_j independent, of variance e_j = λ^j (1 − λ) (j < n) and e_n = λ^n. So
// K = U E Uᵀ (U upper triangular ones, E = diag(e)), log det K = Σ log e_j,
// and K⁻¹ = U⁻ᵀ E⁻¹ U⁻¹ is tridiagonal (Carli, Chen & Ljung 2017), with the
// bidiagonal factor U⁻ᵀ E^(−½). Nothing is inverted, so it holds where K
// itself is too ill-conditioned to invert (λ^n far below the rounding).
function tcIncrements(n, lambda) {
  const e = new Float64Array(n);
  for (let j = 0; j < n; j++) e[j] = j < n - 1 ? lambda ** (j + 1) * (1 - lambda) : lambda ** n;
  return e;
}

// K⁻¹ of the TC kernel of n taps: its diagonal and its first off-diagonal
// (off[i] = K⁻¹(i, i+1), 0-based), from the increments' variances.
export function tcInverse(n, lambda) {
  if (!(lambda > 0 && lambda < 1)) throw new Error('tcInverse: λ must lie between 0 and 1');
  const e = tcIncrements(n, lambda);
  const diag = new Float64Array(n), off = new Float64Array(Math.max(0, n - 1));
  for (let i = 0; i < n; i++) diag[i] = 1 / e[i] + (i > 0 ? 1 / e[i - 1] : 0);
  for (let i = 0; i < n - 1; i++) off[i] = -1 / e[i];
  return { diag, off };
}

// The search for the hyperparameters: λ = e^(−a/n), a the decay of the prior's
// variance over the n taps, on a grid of a, then golden-section refinement in
// log a between the best grid point's neighbours, to tol in log a; at most
// maxEvaluations values of λ in all. At each λ the noise variance σ² is
// profiled exactly and the ratio η = σ²/c found by a scalar search.
export const KERNEL = { maxTaps: 150, maxEvaluations: 40, grid: [0.5, 1, 2, 4, 8, 16, 32, 64, 128], tol: 0.01 };

const GOLD = (Math.sqrt(5) - 1) / 2;

// Golden-section search for the minimum of f on [lo, hi], f evaluated at most
// `budget` times, until hi − lo < tol; yields after each evaluation. Returns
// { x, f }, the best point it evaluated.
function* goldenSteps(f, lo, hi, tol, budget) {
  if (budget < 2) return { x: NaN, f: Infinity };
  let a = lo, b = hi;
  let c = b - GOLD * (b - a), d = a + GOLD * (b - a);
  let fc = f(c);
  yield;
  let fd = f(d), used = 2;
  yield;
  let best = fc <= fd ? { x: c, f: fc } : { x: d, f: fd };
  while (b - a > tol && used < budget) {
    if (fc <= fd) { b = d; d = c; fd = fc; c = b - GOLD * (b - a); fc = f(c); if (fc < best.f) best = { x: c, f: fc }; }
    else { a = c; c = d; fc = fd; d = a + GOLD * (b - a); fd = f(d); if (fd < best.f) best = { x: d, f: fd }; }
    used++;
    yield;
  }
  return best;
}
const golden = (...args) => drain(goldenSteps(...args));

// A regularised impulse response from u to y (§6.8):
//   y[k] − y0 = Σ_{i=1…n} g_i ū_i[k] + v[k],   v white,
// with the TC prior g ~ N(0, cK) and (c, λ, σ²) by the marginal likelihood
// (empirical Bayes; Chen, Ohlsson & Ljung 2012; Pillonetto et al. 2014).
//   decimate D: tap i is the sum of the impulse response over the lags
//     (i−1)D + 1 … iD, so n taps cover nD samples: ū_i[k] is the mean of
//     u − u0 over those lags. y stays at its full rate and every regressor is
//     strictly in the past, so with white noise the estimate is consistent in
//     closed loop too. cover (samples) chooses D and n ≤ KERNEL.maxTaps.
//   integrating: the impulse response does not decay but settles at a rate r
//     per sample (r = k′·Ts): y[k] − y0 = r Σ_{t<k} (u[t] − u0) + the TC part,
//     which then holds the difference from the rate (it decays). r has a flat
//     prior and is integrated out (the restricted likelihood). The noise stays
//     white: fitting Δy instead would make it coloured, and biased under
//     feedback.
//   u0, y0: the rest the record starts from (u = u0 and y = y0 before it).
//   from: the first sample used as an equation (the earlier ones only feed
//     the regressors).
// Each evaluation (one λ) is one symmetric eigendecomposition of
// W = E^½ Uᵀ (ΦᵀΦ) U E^½ (the factor of K⁻¹ applied to ΦᵀΦ, O(n²) per λ),
// which gives −2 log L for every η = σ²/c in O(n): σ² is profiled exactly,
// η by a scalar search. The estimate is the posterior mean, its covariance
// σ̂² (ΦᵀΦ + η K⁻¹)⁻¹. Yields after each evaluation (about 10 ms at 150
// taps), so the page can slice the work. Returns { g (y's impulse response,
// summed per tap; with the rate's D·r for an integrating plant), sd, cov, n,
// decimate, integrating, rate? ({ value, sd, cov: with each g_i }), Ts (the
// taps' spacing, when Ts is given), hyper: { c, lambda, sigma2, eta },
// logLik (−2 log L at the optimum; for an integrating kernel the restricted
// one, the rate integrated out), evaluations }.
export function* tcKernelSteps(u, y, { n, decimate = 1, cover, integrating = false, u0 = 0, y0 = 0, from = 0, Ts } = {}) {
  const N = y.length;
  if (u.length !== N) throw new Error('tcKernel: u and y differ in length');
  let D = decimate, taps = n;
  if (cover !== undefined) {
    if (!(cover >= 1)) throw new Error('tcKernel: cover must be at least one sample');
    D = Math.max(1, Math.ceil(cover / KERNEL.maxTaps));
    taps = Math.ceil(cover / D);
  }
  if (!Number.isInteger(D) || D < 1) throw new Error('tcKernel: decimate must be a whole number ≥ 1');
  if (!Number.isInteger(taps) || taps < 1 || taps > KERNEL.maxTaps) throw new Error(`tcKernel: n must be a whole number of taps, 1 … ${KERNEL.maxTaps}`);
  if (!(from >= 0) || N - from < 3) throw new Error('tcKernel: too few samples');
  if (u.every((v) => v === u0)) throw new Error('tcKernel: u does not move');
  const M = N - from;
  // ū[t]: the mean of u − u0 over t − D + 1 … t (u0 before the record).
  const ub = new Float64Array(N);
  let run = 0;
  for (let t = 0; t < N; t++) {
    run += u[t] - u0;
    if (t >= D) run -= u[t - D] - u0;
    ub[t] = run / D;
  }
  const Y = Float64Array.from(y, (v) => v - y0);
  // The integrator's regressor: Σ_{t<k} (u[t] − u0).
  const X = integrating ? new Float64Array(N) : null;
  if (X) for (let k = 1; k < N; k++) X[k] = X[k - 1] + u[k - 1] - u0;
  // Regressor i (0-based) at row k: ū[k − 1 − iD] (0 before the record).
  // R = ΦᵀΦ: R[i][i + d] = Σ_t ū[t] ū[t − dD] over t = from − 1 − iD … N − 2 − iD,
  // from one prefix sum per lag d.
  const R = Array.from({ length: taps }, () => new Float64Array(taps));
  const C = new Float64Array(N);
  for (let dl = 0; dl < taps; dl++) {
    const sh = dl * D;
    let s = 0;
    for (let t = 0; t < N - 1; t++) { if (t >= sh) s += ub[t] * ub[t - sh]; C[t] = s; }
    for (let i = 0; i + dl < taps; i++) {
      const hi = N - 2 - i * D, lo = Math.max(0, from - 1 - i * D);
      const v = hi < lo ? 0 : C[hi] - (lo > 0 ? C[lo - 1] : 0);
      R[i][i + dl] = R[i + dl][i] = v;
    }
  }
  const cross = (Z) => {
    const r = new Float64Array(taps);
    for (let i = 0; i < taps; i++) {
      let s = 0;
      for (let k = Math.max(from, 1 + i * D); k < N; k++) s += ub[k - 1 - i * D] * Z[k];
      r[i] = s;
    }
    return r;
  };
  const dot = (a, b) => { let s = 0; for (let k = from; k < N; k++) s += a[k] * b[k]; return s; };
  const YY = dot(Y, Y), XX = X ? dot(X, X) : 0, XY = X ? dot(X, Y) : 0;
  // B = UᵀRU (prefix sums over rows and columns); Uᵀ(ΦᵀY), Uᵀ(ΦᵀX).
  const B = R.map((row) => Float64Array.from(row));
  for (const row of B) for (let j = 1; j < taps; j++) row[j] += row[j - 1];
  for (let i = 1; i < taps; i++) for (let j = 0; j < taps; j++) B[i][j] += B[i - 1][j];
  const cumsum = (r) => { for (let j = 1; j < taps; j++) r[j] += r[j - 1]; return r; };
  const cy = cumsum(cross(Y)), cx = X ? cumsum(cross(X)) : null;
  const dof = X ? M - 1 : M;
  const LOG2PI1 = 1 + Math.log(2 * Math.PI);

  const setup = (lambda) => {
    const s = tcIncrements(taps, lambda).map(Math.sqrt);
    const W = B.map((row, j) => Array.from(row, (v, k) => s[j] * v * s[k]));
    return { s, W, b: Array.from(cy, (v, j) => s[j] * v), bx: cx && Array.from(cx, (v, j) => s[j] * v) };
  };
  // −2 log L with σ² profiled (and the rate integrated out):
  //   dof·log σ̂² + Σ log(1 + s_i/η) [+ log xᵀM⁻¹x] + dof(1 + log 2π),
  // M = I + ΨΨᵀ/η, σ̂² = (YᵀM⁻¹Y − (xᵀM⁻¹Y)²/xᵀM⁻¹x)/dof, from W's eigenvalues
  // s_i and the projections of b = ΨᵀY (and ΨᵀX).
  const profile = (vals, pb, px) => {
    const f = (x) => {
      const eta = Math.exp(x);
      let yy = YY, xy = XY, xx = XX, ld = 0;
      for (let i = 0; i < vals.length; i++) {
        const w = 1 / (eta + vals[i]);
        yy -= pb[i] * pb[i] * w;
        if (px) { xy -= px[i] * pb[i] * w; xx -= px[i] * px[i] * w; }
        ld += Math.log1p(vals[i] / eta);
      }
      if (px && !(xx > 0)) return Infinity;
      const q = px ? yy - (xy * xy) / xx : yy;
      return q > 0 ? dof * Math.log(q / dof) + ld + (px ? Math.log(xx) : 0) + dof * LOG2PI1 : Infinity;
    };
    const top = Math.max(...vals);
    if (!(top > 0)) return { x: Infinity, f: f(Infinity) };
    // A grid over log η, one per e-fold from 35 below the largest eigenvalue
    // to 10 above, then golden section between the best one's neighbours.
    const x0 = Math.log(top), xs = [];
    for (let x = x0 - 35; x <= x0 + 10; x += 1) xs.push(x);
    let bi = 0, bf = Infinity;
    xs.forEach((x, i) => { const v = f(x); if (v < bf) { bf = v; bi = i; } });
    const g = golden(f, xs[Math.max(0, bi - 1)], xs[Math.min(xs.length - 1, bi + 1)], 1e-6, 60);
    return g.f <= bf ? g : { x: xs[bi], f: bf };
  };
  let evaluations = 0, best = null;
  const tryA = (loga) => {
    evaluations++;
    const lambda = Math.exp(-Math.exp(loga) / taps);
    const { W, b, bx } = setup(lambda);
    const { values, projected } = eigSym(W, { project: bx ? [b, bx] : [b] });
    const fit = profile(values.map((v) => Math.max(0, v)), projected[0], projected[1]);
    if (!best || fit.f < best.f) best = { lambda, eta: Math.exp(fit.x), f: fit.f };
    return fit.f;
  };
  const grid = KERNEL.grid.map(Math.log), fs = [];
  for (const x of grid) { fs.push(tryA(x)); yield { evaluation: evaluations }; }
  const ib = fs.indexOf(Math.min(...fs));
  for (const _ of goldenSteps(tryA, grid[Math.max(0, ib - 1)], grid[Math.min(grid.length - 1, ib + 1)], KERNEL.tol, KERNEL.maxEvaluations - evaluations)) yield { evaluation: evaluations };

  // The estimate at the best (λ, η): with z = E^(−½)U⁻¹g̃ the normal equations
  // are (W + ηI) z = b, or with the rate r first,
  //   [xᵀx  (ΨᵀX)ᵀ; ΨᵀX  W + ηI] [r; z] = [xᵀY; b],
  // and the posterior covariance is σ̂² times the inverse of that matrix.
  // g̃ = U E^½ z (suffix sums), g = g̃ + D·r.
  const { s, W, b, bx } = setup(best.lambda);
  const g = new Float64Array(taps), sd = new Float64Array(taps);
  const cov = Array.from({ length: taps }, () => new Float64Array(taps));
  const out = { g, sd, cov, n: taps, decimate: D, integrating, Ts: Ts > 0 ? D * Ts : undefined, logLik: best.f, evaluations };
  const eta = Number.isFinite(best.eta) ? best.eta : 1e300;
  const o = X ? 1 : 0, m = taps + o;
  const A = Array.from({ length: m }, () => new Array(m).fill(0)), rhs = new Array(m);
  for (let i = 0; i < taps; i++) { for (let j = 0; j < taps; j++) A[o + i][o + j] = W[i][j]; A[o + i][o + i] += eta; rhs[o + i] = b[i]; }
  if (X) { A[0][0] = XX; rhs[0] = XY; for (let i = 0; i < taps; i++) A[0][1 + i] = A[1 + i][0] = bx[i]; }
  const L = cholesky(A);
  const sol = cholSolve(L, rhs);
  let fitted = 0;
  for (let i = 0; i < m; i++) fitted += rhs[i] * sol[i];
  const sigma2 = (YY - fitted) / dof;
  out.hyper = { c: sigma2 / eta, lambda: best.lambda, sigma2, eta: best.eta };
  const Ainv = cholSolve(L, A.map((_, i) => A.map((__, j) => (i === j ? 1 : 0))));
  const rate = X ? sol[0] : 0;
  for (let i = taps - 1, acc = 0; i >= 0; i--) { acc += s[i] * sol[o + i]; g[i] = acc + D * rate; }
  // cov(g̃) by suffix sums of σ̂² s_i Ainv s_j; with the rate, the terms in D·r.
  for (let i = 0; i < taps; i++) for (let j = 0; j < taps; j++) cov[i][j] = sigma2 * s[i] * Ainv[o + i][o + j] * s[j];
  for (const row of cov) for (let j = taps - 2; j >= 0; j--) row[j] += row[j + 1];
  for (let i = taps - 2; i >= 0; i--) for (let j = 0; j < taps; j++) cov[i][j] += cov[i + 1][j];
  if (X) {
    // c_i = cov(g̃_i, r) = σ̂² Σ_{j ≥ i} s_j Ainv[1+j][0]; vr = var(r).
    const ci = new Float64Array(taps), vr = sigma2 * Ainv[0][0];
    for (let i = taps - 1, acc = 0; i >= 0; i--) { acc += sigma2 * s[i] * Ainv[1 + i][0]; ci[i] = acc; }
    for (let i = 0; i < taps; i++) for (let j = 0; j < taps; j++) cov[i][j] += D * (ci[i] + ci[j]) + D * D * vr;
    out.rate = { value: rate, sd: Math.sqrt(Math.max(0, vr)), cov: Float64Array.from(ci, (v) => v + D * vr) };
  }
  for (let i = 0; i < taps; i++) sd[i] = Math.sqrt(Math.max(0, cov[i][i]));
  return out;
}

export const tcKernel = (u, y, opts) => drain(tcKernelSteps(u, y, opts));

// The step response of y the kernel describes, at the ends of its taps
// (t = I·D samples, I = 0 … count): Σ_{i<I} g_i, and past the last tap, for
// an integrating kernel, D·r more per tap. With its standard deviation from
// the posterior covariance. Returns { t (in samples, or seconds when the
// kernel has Ts), s, sd }.
export function kernelStep(kernel, count = kernel.n) {
  const { g, cov, decimate: D, rate } = kernel, n = g.length;
  const t = new Float64Array(count + 1), s = new Float64Array(count + 1), sd = new Float64Array(count + 1);
  // Running sums: m = Σ g_i, v = Σ_{i,j} cov_ij over i, j < I.
  let m = 0, v = 0;
  for (let I = 0; I <= count; I++) {
    if (I > 0 && I <= n) {
      const i = I - 1;
      let q = 0;
      for (let j = 0; j < i; j++) q += cov[i][j];
      v += 2 * q + cov[i][i];
      m += g[i];
    }
    let mi = m, vi = v;
    if (I > n && rate) {
      // s_I = Σ g + (I − n)·D·r: var adds 2(I − n)D Σ cov(g_i, r) + ((I − n)D)² var(r).
      const a = (I - n) * D;
      let cg = 0;
      for (let i = 0; i < n; i++) cg += rate.cov[i];
      mi += a * rate.value;
      vi += 2 * a * cg + a * a * rate.sd * rate.sd;
    }
    t[I] = kernel.Ts ? I * kernel.Ts : I * D;
    s[I] = mi;
    sd[I] = Math.sqrt(Math.max(0, vi));
  }
  return { t, s, sd };
}

// Start values from the kernel (§6.3): its sum gives the gain (for an
// integrating kernel, its rate gives k′ = r/Ts), the time it reaches 2 % of
// it the dead time, 63 % the time scale, and an overshoot ζ and f (of the
// step, or for an integrator of y's impulse response). Ts: the record's
// sample time. Returns a guess { K | kp, tau, theta, f?, zeta? } for
// STRUCTURES[…].start, or null when the kernel found nothing.
export function kernelGuess(kernel, Ts) {
  const { g, decimate: D, integrating, rate } = kernel, n = g.length, dt = D * Ts;
  // The normalised curve (t, c): the step response at the taps' ends, or y's
  // impulse response (each tap's mean) at the taps' middles.
  const t = [0], c = [0];
  let fin;
  if (integrating) {
    fin = D * (rate?.value ?? 0);
    for (let i = 0; i < n; i++) { t.push((i + 0.5) * dt); c.push(g[i]); }
  } else {
    fin = 0;
    for (let i = 0; i < n; i++) { fin += g[i]; t.push((i + 1) * dt); c.push(fin); }
  }
  if (!(Math.abs(fin) > 0) || !Number.isFinite(fin)) return null;
  const yv = c.map((v) => v / fin);
  const when = (level) => {
    for (let I = 1; I < yv.length; I++) if (yv[I] >= level) return t[I - 1] + ((level - yv[I - 1]) / (yv[I] - yv[I - 1])) * (t[I] - t[I - 1]);
    return t[t.length - 1];
  };
  const theta = when(0.02);
  const tau = Math.max(dt, when(0.632) - theta);
  const guess = integrating ? { kp: fin / (D * Ts), tau, theta } : { K: fin, tau, theta };
  let peak = 0, at = 0;
  for (let I = 0; I < yv.length; I++) if (yv[I] > peak) { peak = yv[I]; at = t[I]; }
  if (peak > 1.02 && at > theta) {
    const ln = Math.log(peak - 1), zeta = -ln / Math.sqrt(Math.PI ** 2 + ln * ln);
    guess.zeta = zeta;
    guess.f = 1 / (2 * (at - theta) * Math.sqrt(1 - zeta * zeta));
  }
  return guess;
}

// ---- The multisine (§5.6)

// A seeded uniform generator on [0, 1) (splitmix32): the multisine's phases
// and its detection lines, Identify's hidden variation. No clock, no
// Math.random.
export function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return ((z ^ (z >>> 16)) >>> 0) / 4294967296;
  };
}

const oddNear = (x) => 2 * Math.round((x - 1) / 2) + 1;

// The lines of a random-odd multisine of period N (harmonic k is the
// frequency k/(N·Ts)): the odd harmonics kmin … kmax, thinned to about
// 1.5 × count log-spaced candidates when there are more (each the next odd
// harmonic at least r times the last, r chosen so they fit), then one in each
// group of three consecutive candidates left out at random (seeded): those,
// the odd harmonics between candidates and every even harmonic up to the
// highest excited one are the detection lines. Returns { excited, detect:
// { odd, even } }, harmonic numbers ascending.
export function multisineLines({ N, kmax, kmin = 1, count = 60, seed = 1 } = {}) {
  if (!(N >= 4) || N & (N - 1)) throw new Error('multisineLines: N must be a power of two ≥ 4');
  const top = Math.min(Math.floor(kmax), N / 2 - 1);
  const first = Math.max(1, Math.ceil(kmin) % 2 ? Math.ceil(kmin) : Math.ceil(kmin) + 1);   // the smallest odd harmonic ≥ kmin
  if (!(top >= first)) throw new Error('multisineLines: no odd harmonic between kmin and kmax');
  const target = Math.ceil(1.5 * count);
  const quasiLog = (r) => {
    const c = [first];
    for (;;) {
      const k = Math.max(c[c.length - 1] + 2, oddNear(c[c.length - 1] * r));
      if (k > top) return c;
      c.push(k);
    }
  };
  let cand = quasiLog(1);
  if (cand.length > target) {
    // The smallest ratio that gives at most `target` lines (bisection in log r).
    let lo = 0, hi = Math.log(top / first) + 1;
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (quasiLog(Math.exp(mid)).length > target) lo = mid; else hi = mid; }
    cand = quasiLog(Math.exp(hi));
  }
  const rnd = seeded(seed), excited = [];
  for (let i = 0; i < cand.length; i += 3) {
    const group = cand.slice(i, i + 3);
    const out = group.length === 3 ? Math.floor(rnd() * 3) : -1;
    group.forEach((k, j) => { if (j !== out) excited.push(k); });
  }
  const on = new Set(excited), last = excited[excited.length - 1];
  const odd = [], even = [];
  for (let k = 1; k <= last; k++) if (!on.has(k)) (k % 2 ? odd : even).push(k);
  return { excited, detect: { odd, even } };
}

// The crest factor max|x| / rms(x).
export function crestFactor(x) {
  let peak = 0, ss = 0;
  for (let i = 0; i < x.length; i++) { peak = Math.max(peak, Math.abs(x[i])); ss += x[i] * x[i]; }
  return ss > 0 ? peak / Math.sqrt(ss / x.length) : Infinity;
}

// One period of a multisine: equal amplitudes at the excited harmonics
// `lines` of the period N, nothing at any other line,
//   x[t] = Σ cos(2π k t / N + φ_k),
// with phases from the seed (uniform) or Schroeder's (φ_i = −π i(i − 1)/F,
// i = 1 … F), then the crest factor lowered by `iterations` clip-and-restore
// passes (clip at MULTISINE.clip × the rms, keep the phases the spectrum then
// has, restore the amplitudes, empty every other line; the lowest crest
// factor seen is kept), and scaled so that its peak is `peak` exactly.
// Returns a Float64Array of N samples. Measured (10 seeds, 20 passes): crest
// factor 1.7–1.9 at N 256 (18 lines), 1.8–2.0 at 512 (34), 2.3–2.7 at 4096
// (60 lines over 765 harmonics); random phases alone give 2.5–3.8, Schroeder's
// 2.4–3.3 on these sparse lines. Clipping at a share of the peak instead
// (0.85) left 2.0–3.4.
export const MULTISINE = { iterations: 20, clip: 1.4 };
export function multisine({ N, lines, peak = 1, seed = 1, phases = 'random', iterations = MULTISINE.iterations } = {}) {
  if (!(N >= 4) || N & (N - 1)) throw new Error('multisine: N must be a power of two ≥ 4');
  if (!lines?.length) throw new Error('multisine: no lines');
  if (lines.some((k) => !Number.isInteger(k) || k < 1 || k >= N / 2) || new Set(lines).size !== lines.length) throw new Error(`multisine: lines must be distinct whole harmonics 1 … ${N / 2 - 1}`);
  if (!(peak > 0)) throw new Error('multisine: peak must be positive');
  const F = lines.length, rnd = seeded(seed);
  let phi = phases === 'schroeder' ? lines.map((_, i) => (-Math.PI * (i + 1) * i) / F) : lines.map(() => 2 * Math.PI * rnd());
  const re = new Float64Array(N), im = new Float64Array(N);
  // x from the phases: the inverse FFT as conj(FFT(conj(X)))/N, X[k] = (N/2) e^{jφ}.
  const synth = () => {
    re.fill(0); im.fill(0);
    lines.forEach((k, i) => {
      const c = Math.cos(phi[i]) / 2, s = Math.sin(phi[i]) / 2;
      re[k] = c; im[k] = -s; re[N - k] = c; im[N - k] = s;
    });
    fft(re, im);
    return Float64Array.from(re);
  };
  let x = synth(), best = x, bestCf = crestFactor(x);
  for (let it = 0; it < iterations; it++) {
    let ss = 0;
    for (let t = 0; t < N; t++) ss += x[t] * x[t];
    const c = MULTISINE.clip * Math.sqrt(ss / N);
    for (let t = 0; t < N; t++) { re[t] = Math.max(-c, Math.min(c, x[t])); im[t] = 0; }
    fft(re, im);
    phi = lines.map((k) => Math.atan2(im[k], re[k]));
    x = synth();
    const cf = crestFactor(x);
    if (cf < bestCf) { best = x; bestCf = cf; }
  }
  let m = 0;
  for (let t = 0; t < N; t++) m = Math.max(m, Math.abs(best[t]));
  return best.map((v) => (v * peak) / m);
}

// ---- Frequency response and distortion (§6.7)

// Which periods of a periodic excitation can be averaged: period i covers the
// record's samples start + iN … start + (i + 1)N − 1. One with a seq gap at
// or inside it ([k, len]: len plant cycles lost just before sample k, u held
// by the plant) or a guard event (breaks: sample indices) is dropped: the DFT
// is never taken across a gap, and the experiment plays it again. Returns
// { kept, dropped, starts } (period numbers, and the kept periods' first
// samples).
export function wholePeriods({ start = 0, N, count, gaps = [], breaks = [] } = {}) {
  if (!(N >= 1) || !(count >= 0)) throw new Error('wholePeriods: N and count are needed');
  const at = [...gaps.map((g) => (Array.isArray(g) ? g[0] : g)), ...breaks];
  const kept = [], dropped = [];
  for (let i = 0; i < count; i++) {
    const a = start + i * N, b = a + N;
    (at.some((k) => k >= a && k < b) ? dropped : kept).push(i);
  }
  return { kept, dropped, starts: kept.map((i) => start + i * N) };
}

// The frequency response from whole periods of a periodic excitation, and the
// noise and nonlinear distortion it shows (Pintelon & Schoukens 2012). U, Y:
// P ≥ 2 periods of u and y (arrays of N samples, N a power of two), in
// periodic steady state. At every line k the periods' DFTs are averaged:
// Ĝ = Ȳ/Ū at the excited lines, consistent under feedback because the noise
// does not repeat with the period. Its variance comes from the spread between
// periods, with the U–Y covariance that feedback brings:
//   var Ĝ = |Ĝ|² (σ²_Ȳ/|Ȳ|² + σ²_Ū/|Ū|² − 2 Re(σ²_ȲŪ / (Ȳ Ū*))).
// At a detection line (excited: nothing) Ȳ holds what the plant made there
// that is not linear, plus the noise left after averaging; its power less the
// noise's (σ²_Ȳ, from the spread) is the distortion's. The odd and the even
// shares compare the distortion's power at the odd (even) detection lines with
// the response's at their neighbouring excited lines (the nearest below and
// above), per line; the share adds the two in power. Odd distortion (a cubic)
// also lands on the excited lines, at about the odd detection lines' level;
// even distortion (a square, or a cubic away from its centre) lands on the
// even lines only.
//   excited: harmonic numbers; detect: { odd, even } (default: every other
//   line from 1 to the highest excited); Ts: to give frequencies in Hz.
// Returns { lines, f?, G ({re, im}), sd (√E|Ĝ − G|²), U, Y (the averaged
// amplitudes at the excited lines), noise (the noise left on Ȳ, as an
// amplitude, per excited line), distortion: { share, odd, even (%: the odd
// and the even detection lines alone), level: { odd, even, noise } (rms per
// line, amplitudes), near (per excited line, the distortion nearby in G's
// units, for the Bode plot's ticks; null without a detection line nearby) },
// periods }. Amplitudes are those of the sines (2|X|/N).
export function frf(U, Y, { excited, detect = null, Ts } = {}) {
  const P = U.length;
  if (P < 2 || Y.length !== P) throw new Error('frf: needs at least 2 periods of u and of y');
  const N = U[0].length;
  if (!(N >= 4) || N & (N - 1)) throw new Error('frf: a period must be a power of two ≥ 4 samples');
  if ([...U, ...Y].some((x) => x.length !== N)) throw new Error('frf: every period must have N samples');
  if (!excited?.length) throw new Error('frf: no excited lines');
  const H = N / 2, lines = [...excited].sort((a, b) => a - b);
  if (lines.some((k) => !Number.isInteger(k) || k < 1 || k >= H)) throw new Error(`frf: excited lines must be whole harmonics 1 … ${H - 1}`);
  const on = new Set(lines), top = lines[lines.length - 1];
  const det = detect ?? (() => {
    const odd = [], even = [];
    for (let k = 1; k <= top; k++) if (!on.has(k)) (k % 2 ? odd : even).push(k);
    return { odd, even };
  })();
  // Per line 0 … H: the mean over periods and the spread (Σ|X_p − X̄|²/(P − 1)) of U and Y, and their covariance.
  const mean = (Xs) => {
    const re = new Float64Array(H + 1), im = new Float64Array(H + 1);
    const spec = Xs.map((x) => {
      const r = Float64Array.from(x), i = new Float64Array(N);
      fft(r, i);
      for (let k = 0; k <= H; k++) { re[k] += r[k] / P; im[k] += i[k] / P; }
      return { r, i };
    });
    return { re, im, spec };
  };
  const u = mean(U), y = mean(Y);
  const vU = new Float64Array(H + 1), vY = new Float64Array(H + 1), cRe = new Float64Array(H + 1), cIm = new Float64Array(H + 1);
  for (let p = 0; p < P; p++) {
    const su = u.spec[p], sy = y.spec[p];
    for (let k = 0; k <= H; k++) {
      const ur = su.r[k] - u.re[k], ui = su.i[k] - u.im[k], yr = sy.r[k] - y.re[k], yi = sy.i[k] - y.im[k];
      vU[k] += (ur * ur + ui * ui) / (P - 1);
      vY[k] += (yr * yr + yi * yi) / (P - 1);
      // (ΔY)(ΔU)*
      cRe[k] += (yr * ur + yi * ui) / (P - 1);
      cIm[k] += (yi * ur - yr * ui) / (P - 1);
    }
  }
  const amp = 2 / N;
  const G = [], sd = [], Ua = [], Ya = [], noise = [];
  for (const k of lines) {
    const ur = u.re[k], ui = u.im[k], yr = y.re[k], yi = y.im[k];
    const uu = ur * ur + ui * ui, yy = yr * yr + yi * yi;
    const g = { re: (yr * ur + yi * ui) / uu, im: (yi * ur - yr * ui) / uu };
    // Re(c / (Ȳ Ū*)), Ȳ Ū* = (yr ur + yi ui) + j(yi ur − yr ui).
    const dr = yr * ur + yi * ui, di = yi * ur - yr * ui, dd = dr * dr + di * di;
    const cross = dd > 0 ? (cRe[k] * dr + cIm[k] * di) / dd : 0;
    const rel = vY[k] / P / yy + vU[k] / P / uu - (2 * cross) / P;
    G.push(g);
    sd.push(Math.sqrt(Math.max(0, (g.re * g.re + g.im * g.im) * rel)));
    Ua.push(amp * Math.sqrt(uu));
    Ya.push(amp * Math.sqrt(yy));
    noise.push(amp * Math.sqrt(vY[k] / P));
  }
  // The distortion at the detection lines, noise removed, against the response at the neighbouring excited lines.
  const neighbours = (k) => {
    let lo = 0, hi = lines.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (lines[mid] < k) lo = mid; else hi = mid; }
    if (lines[lo] > k) return [lo];
    if (lines[hi] < k) return [hi];
    return lo === hi ? [lo] : [lo, hi];
  };
  const yPow = (i) => y.re[lines[i]] ** 2 + y.im[lines[i]] ** 2;
  const nearSum = new Float64Array(lines.length), nearCount = new Float64Array(lines.length);
  const tally = (ks) => {
    let dist = 0, resp = 0, noisePow = 0, used = 0;
    for (const k of ks) {
      if (!(k >= 1 && k < H) || on.has(k)) continue;
      used++;
      const nb = neighbours(k);
      const d = y.re[k] ** 2 + y.im[k] ** 2 - vY[k] / P;
      dist += d;
      noisePow += vY[k] / P;
      resp += nb.reduce((s, i) => s + yPow(i), 0) / nb.length;
      // For the ticks: the detection line counts for its nearest excited line.
      const i = nb.length === 1 ? nb[0] : k - lines[nb[0]] <= lines[nb[1]] - k ? nb[0] : nb[1];
      nearSum[i] += d; nearCount[i]++;
    }
    return { dist: Math.max(0, dist), resp, level: amp * Math.sqrt(Math.max(0, dist) / Math.max(1, used)), noise: noisePow, n: used };
  };
  const o = tally(det.odd ?? []), e = tally(det.even ?? []);
  const pct = (d, r) => (r > 0 ? 100 * Math.sqrt(d / r) : 0);
  const near = lines.map((k, i) => (nearCount[i] ? (amp * Math.sqrt(Math.max(0, nearSum[i]) / nearCount[i])) / Ua[i] : null));
  const out = {
    lines, G, sd, U: Ua, Y: Ya, noise,
    distortion: {
      share: Math.hypot(pct(o.dist, o.resp), pct(e.dist, e.resp)), odd: pct(o.dist, o.resp), even: pct(e.dist, e.resp),
      level: { odd: o.level, even: e.level, noise: amp * Math.sqrt((o.noise + e.noise) / Math.max(1, o.n + e.n)) },
      near,
    },
    periods: P,
  };
  if (Ts > 0) out.f = lines.map((k) => k / (N * Ts));
  return out;
}
