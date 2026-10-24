// Trajectory planning: finds an input u(t) on [0, T] that takes ẋ = f(x, u)
// from x0 to a target (for example a pendulum chain from hanging to upright),
// by multiple shooting and Levenberg–Marquardt. It ships with the page and
// runs from the plant's own dynamics: nothing is planned offline (the person,
// design/input/2026-10-24-09-…). Method after Glück, Eder & Kugi, "Swing-up
// control of a triple pendulum on a cart with experimental validation",
// Automatica 49 (2013): a two-point boundary value problem for the
// feedforward, then a time-varying LQR along it (tvlqr below).
//
// Unknowns: u at N + 1 nodes (piecewise linear in time) and the states at the
// starts of segments 1 … M−1. Residuals: the jumps between a segment's end and
// the next start (defects), the distance of the end state to the target, a
// small penalty on u, and a penalty on |u| beyond umax. Each segment depends
// only on its own start and on the u nodes in its span, so the Jacobian is
// built segment by segment (a few integrations per column, not a whole run).
//
// planTrajectory(problem) is a generator: it yields progress after every
// iteration, so the page can run it in slices without freezing; Node runs it
// to the end with runPlan. It is deterministic.

import { c2d, dlqr } from './linalg.js';

// problem: { n, f(x, u, dx), x0, T, segments = 12, perSegment = 4, h = 0.01,
//   target (array, n), wrap (array of 0/1: angle states, compared modulo 2π),
//   weight (array, n: terminal weights), umax = Infinity, effort = 3e-4 }
export function* planTrajectory(problem) {
  const { n, f, x0, T } = problem;
  const M = problem.segments ?? 12, K = problem.perSegment ?? 4, N = M * K;
  const steps = Math.max(1, Math.round(T / M / (problem.h ?? 0.01))), h = T / M / steps;
  const target = problem.target ?? new Array(n).fill(0), wrap = problem.wrap ?? new Array(n).fill(0);
  const weight = problem.weight ?? new Array(n).fill(1), umax = problem.umax ?? Infinity;
  const nz = N + 1 + n * (M - 1);

  // RK4 over one segment with u linear between nodes; scratch is reused.
  const k1 = new Float64Array(n), k2 = new Float64Array(n), k3 = new Float64Array(n), k4 = new Float64Array(n), xt = new Float64Array(n);
  const uAt = (z, t) => { const s = Math.min(N - 1e-9, Math.max(0, (t / T) * N)), i = Math.floor(s); return z[i] + (z[i + 1] - z[i]) * (s - i); };
  function segment(z, j, start, out, record) {
    out.set(start);
    for (let s = 0; s < steps; s++) {
      const t = (j * steps + s) * h, u1 = uAt(z, t), u2 = uAt(z, t + h / 2), u3 = uAt(z, t + h);
      f(out, u1, k1);
      for (let i = 0; i < n; i++) xt[i] = out[i] + (h / 2) * k1[i];
      f(xt, u2, k2);
      for (let i = 0; i < n; i++) xt[i] = out[i] + (h / 2) * k2[i];
      f(xt, u2, k3);
      for (let i = 0; i < n; i++) xt[i] = out[i] + h * k3[i];
      f(xt, u3, k4);
      for (let i = 0; i < n; i++) out[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
      record?.(t + h, out);
    }
  }
  const startOf = (z, j) => (j === 0 ? x0 : z.subarray(N + 1 + n * (j - 1), N + 1 + n * j));
  const wrapped = (d, i) => (wrap[i] ? d - 2 * Math.PI * Math.round(d / (2 * Math.PI)) : d);

  // Residual layout: defects n·(M−1), terminal n, effort N+1, bound N+1.
  const nr = n * (M - 1) + n + 2 * (N + 1);
  const W = { defect: 1, effort: problem.effort ?? 3e-4, bound: 3 };
  const ends = Array.from({ length: M }, () => new Float64Array(n));
  function residual(z, r) {
    for (let j = 0; j < M; j++) segment(z, j, startOf(z, j), ends[j]);
    fill(z, r);
  }
  function fill(z, r) {
    let q = 0;
    for (let j = 0; j < M - 1; j++) { const s = startOf(z, j + 1); for (let i = 0; i < n; i++) r[q++] = W.defect * (ends[j][i] - s[i]); }
    for (let i = 0; i < n; i++) r[q++] = weight[i] * wrapped(ends[M - 1][i] - target[i], i);
    for (let k = 0; k <= N; k++) r[q++] = W.effort * z[k];
    for (let k = 0; k <= N; k++) r[q++] = W.bound * Math.max(0, Math.abs(z[k]) - umax);
  }

  // Deterministic start: u a slow sine (as a person would rock the cart),
  // states interpolated from x0 to the target.
  const z = new Float64Array(nz);
  const swing = problem.uGuess ?? (Number.isFinite(umax) ? 0.5 * umax : 8);
  for (let k = 0; k <= N; k++) z[k] = swing * Math.sin((3 * Math.PI * k) / N);
  for (let j = 1; j < M; j++) {
    const s = startOf(z, j), a = j / M;
    for (let i = 0; i < n; i++) s[i] = x0[i] + a * wrapped(target[i] - x0[i], i);
  }

  const r = new Float64Array(nr), rc = new Float64Array(nr), zc = new Float64Array(nz);
  const J = Array.from({ length: nr }, () => new Float64Array(nz));
  const endC = new Float64Array(n);
  const sumsq = (v) => { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; return s; };
  const norms = () => ({ defect: Math.sqrt(sumsq(r.subarray(0, n * (M - 1)))) / W.defect, terminal: Math.sqrt(sumsq(r.subarray(n * (M - 1), n * M))) });
  residual(z, r);
  let cost = sumsq(r), mu = 1e-2, iteration = 0;
  // Continuation: first a loose fit with more weight on small u, then the
  // jumps between segments are squeezed out. Done when the path is continuous
  // and ends on the target.
  const stages = problem.stages ?? [[3e-3, 1, 100], [1e-3, 10, 60], [3e-4, 100, 60]];
  const done = () => { const nm = norms(); return nm.defect < 1e-6 && nm.terminal < 1e-3; };
  for (const [effort, defect, iters] of stages) {
    if (done()) break;
    W.effort = effort; W.defect = defect;
    residual(z, r); cost = sumsq(r);
    for (let it = 0; it < iters; it++, iteration++) {
      // Jacobian, segment by segment: column c moves segment ends that depend on it.
      for (const row of J) row.fill(0);
      const eps = 1e-6;
      for (let j = 0; j < M; j++) {
        const cols = [];
        for (let k = j * K; k <= (j + 1) * K; k++) cols.push(k);
        if (j > 0) for (let i = 0; i < n; i++) cols.push(N + 1 + n * (j - 1) + i);
        for (const c of cols) {
          zc.set(z); zc[c] += eps;
          segment(zc, j, startOf(zc, j), endC);
          // Rows touched: this segment's defect (or the terminal rows), via its end state.
          const base = j < M - 1 ? n * j : n * (M - 1);
          for (let i = 0; i < n; i++) {
            const d = (endC[i] - ends[j][i]) / eps;
            J[base + i][c] += (j < M - 1 ? W.defect : weight[i]) * d;
          }
        }
        // The next segment's start enters its predecessor's defect with −1.
        if (j < M - 1) for (let i = 0; i < n; i++) J[n * j + i][N + 1 + n * j + i] -= W.defect;
      }
      for (let k = 0; k <= N; k++) {
        J[n * M + k][k] = W.effort;
        J[n * M + N + 1 + k][k] = Math.abs(z[k]) > umax ? W.bound * Math.sign(z[k]) : 0;
      }
      // Levenberg–Marquardt step on the normal equations.
      const JtJ = Array.from({ length: nz }, () => new Float64Array(nz)), Jtr = new Float64Array(nz);
      for (let i = 0; i < nr; i++) {
        const row = J[i], ri = r[i];
        for (let a = 0; a < nz; a++) {
          const va = row[a];
          if (va === 0) continue;
          Jtr[a] += va * ri;
          const ja = JtJ[a];
          for (let b = a; b < nz; b++) if (row[b] !== 0) ja[b] += va * row[b];
        }
      }
      for (let a = 0; a < nz; a++) for (let b = 0; b < a; b++) JtJ[a][b] = JtJ[b][a];
      let accepted = false;
      for (let tries = 0; tries < 10 && !accepted; tries++) {
        const A = JtJ.map((row, i) => { const c = Float64Array.from(row); c[i] += mu * (1 + row[i]); return c; });
        const dz = solveSym(A, Jtr);
        for (let i = 0; i < nz; i++) zc[i] = z[i] - dz[i];
        residual(zc, rc);
        const cn = sumsq(rc);
        if (Number.isFinite(cn) && cn < cost) { z.set(zc); r.set(rc); cost = cn; mu = Math.max(1e-9, mu / 3); accepted = true; } else mu *= 4;
      }
      residual(z, r);
      const nm = norms();
      yield { iteration, cost, ...nm, umax: Math.max(...z.subarray(0, N + 1).map(Math.abs)) };
      if (!accepted || done()) break;
    }
  }

  // The nominal path, sampled on the integration grid, taken from the
  // segments themselves (one long run from x0 would blow the tiny defects up).
  const t = [0], X = [Float64Array.from(x0)];
  for (let j = 0; j < M; j++) segment(z, j, startOf(z, j), ends[j], (tt, x) => { t.push(tt); X.push(Float64Array.from(x)); });
  const nm = norms();
  return {
    ok: nm.defect < 1e-4 && nm.terminal < 1e-2,
    T, N, u: Float64Array.from(z.subarray(0, N + 1)), uAt: (tt) => uAt(z, tt),
    t: Float64Array.from(t), X, ...nm, iterations: iteration,
  };
}

// Runs a planning generator to its end (Node, tests); onProgress is optional.
export function runPlan(gen, onProgress) {
  for (;;) {
    const s = gen.next();
    if (s.done) return s.value;
    onProgress?.(s.value);
  }
}

// Time-varying LQR along a plan, sampled every Ts: linearises f at the
// nominal (x*, u*) by finite differences, discretises with a zero-order hold
// and runs the Riccati recursion backwards from Pend (the upright LQR's P).
// Returns K as an array of gain rows, one per sample: u = u* − K (x − x*).
export function tvlqr({ n, f, plan, Ts, Q, R, Pend, wrap }) {
  const steps = Math.floor(plan.T / Ts + 1e-9);
  const xs = [], us = [];
  for (let k = 0; k <= steps; k++) {
    const t = k * Ts, i = Math.min(plan.t.length - 1, Math.round((t / plan.T) * (plan.t.length - 1)));
    xs.push(plan.X[i]); us.push(plan.uAt(t));
  }
  const dx = new Float64Array(n), dxp = new Float64Array(n), xp = new Float64Array(n), eps = 1e-6;
  const lin = (x, u) => {
    const A = Array.from({ length: n }, () => new Array(n).fill(0)), B = Array.from({ length: n }, () => [0]);
    f(x, u, dx);
    for (let c = 0; c < n; c++) { xp.set(x); xp[c] += eps; f(xp, u, dxp); for (let i = 0; i < n; i++) A[i][c] = (dxp[i] - dx[i]) / eps; }
    f(x, u + eps, dxp);
    for (let i = 0; i < n; i++) B[i][0] = (dxp[i] - dx[i]) / eps;
    return c2d(A, B, Ts);
  };
  let P = Pend.map((row) => [...row]);
  const Ks = new Array(steps);
  for (let k = steps - 1; k >= 0; k--) {
    const { Ad, Bd } = lin(xs[k], us[k]);
    // K = (R + Bᵀ P B)⁻¹ Bᵀ P A;  P ← Q + Aᵀ P (A − B K)
    const PB = P.map((row) => row.reduce((s, v, j) => s + v * Bd[j][0], 0));
    const S = R + PB.reduce((s, v, i) => s + v * Bd[i][0], 0);
    const BtPA = Array.from({ length: n }, (_, c) => PB.reduce((s, v, i) => s + v * Ad[i][c], 0));
    const Kk = BtPA.map((v) => v / S);
    Ks[k] = Kk;
    const AmBK = Ad.map((row, i) => row.map((v, c) => v - Bd[i][0] * Kk[c]));
    const PA = P.map((row) => AmBK[0].map((_, c) => row.reduce((s, v, j) => s + v * AmBK[j][c], 0)));
    P = Ad[0].map((_, a) => Ad[0].map((__, b) => Q[a][b] + Ad.reduce((s, row, i) => s + row[a] * PA[i][b], 0)));
    for (let a = 0; a < n; a++) for (let b = 0; b < a; b++) { const v = (P[a][b] + P[b][a]) / 2; P[a][b] = v; P[b][a] = v; }
  }
  return { K: Ks, x: xs.slice(0, steps), u: us.slice(0, steps), wrap };
}

// The steady upright LQR used at the end of the plan and after it.
export function uprightLqr({ n, f, x, u = 0, Ts, Q, R }) {
  const dx = new Float64Array(n), dxp = new Float64Array(n), xp = new Float64Array(n), eps = 1e-6;
  const A = Array.from({ length: n }, () => new Array(n).fill(0)), B = Array.from({ length: n }, () => [0]);
  f(x, u, dx);
  for (let c = 0; c < n; c++) { xp.set(x); xp[c] += eps; f(xp, u, dxp); for (let i = 0; i < n; i++) A[i][c] = (dxp[i] - dx[i]) / eps; }
  f(x, u + eps, dxp);
  for (let i = 0; i < n; i++) B[i][0] = (dxp[i] - dx[i]) / eps;
  const { Ad, Bd } = c2d(A, B, Ts);
  return dlqr(Ad, Bd, Q, R);
}

// Symmetric positive-definite solve (Cholesky), falling back to elimination.
function solveSym(A, b) {
  const n = b.length, L = A.map((row) => Float64Array.from(row));
  for (let j = 0; j < n; j++) {
    let d = L[j][j];
    for (let k = 0; k < j; k++) d -= L[j][k] * L[j][k];
    if (!(d > 0)) return solveGauss(A, b);
    d = Math.sqrt(d); L[j][j] = d;
    for (let i = j + 1; i < n; i++) {
      let s = L[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      L[i][j] = s / d;
    }
  }
  const y = new Float64Array(n), x = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i][k] * y[k]; y[i] = s / L[i][i]; }
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; }
  return x;
}
function solveGauss(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const q = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= q * M[c][k]; }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}
