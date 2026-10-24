// Designs the triple pendulum swing-up offline (the person asked for it,
// design/input/2026-10-24-09-…): a force trajectory F(t) that takes the chain
// from hanging (θ = π, π, π) to upright and the cart back to 0, found by
// multiple shooting and Levenberg–Marquardt, then a time-varying LQR along it.
// Prints the controller variant's parameters as JSON.
//   node tools/triple-swingup.mjs [T] [segments]
// The method follows Glück, Eder & Kugi, "Swing-up control of a triple
// pendulum on a cart with experimental validation", Automatica 49 (2013):
// feedforward from a two-point boundary value problem plus time-varying LQR.

import { ELEMENTS } from '../src/core/diagram.js';

const T = Number(process.argv[2] ?? 2.4), M = Number(process.argv[3] ?? 12);
const N = 4 * M;                  // force nodes, piecewise linear
const h = 0.0025;                 // integration step (the simulator's at 5 s / 2000)
const P = Object.fromEntries(ELEMENTS.pendulumCart.params.map((s) => [s.key, s.default]));
Object.assign(P, { links: 3, M: 1, m1: 0.1, m2: 0.1, m3: 0.1, l1: 0.25, l2: 0.25, l3: 0.25, b: 0.1 });
const n = 8, f = ELEMENTS.pendulumCart.ode.f;
const deriv = (X, u) => { const d = new Array(n).fill(0); f(X, 0, u, P, d); return d; };
const Fat = (Fv, t) => { const s = Math.min(N - 1e-9, Math.max(0, (t / T) * N)); const k = Math.floor(s); return Fv[k] + (Fv[k + 1] - Fv[k]) * (s - k); };
function rk4(X, t, Fv) {
  const u1 = Fat(Fv, t), u2 = Fat(Fv, t + h / 2), u3 = Fat(Fv, t + h);
  const k1 = deriv(X, u1), k2 = deriv(X.map((x, i) => x + (h / 2) * k1[i]), u2);
  const k3 = deriv(X.map((x, i) => x + (h / 2) * k2[i]), u2), k4 = deriv(X.map((x, i) => x + h * k3[i]), u3);
  return X.map((x, i) => x + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
}
const steps = Math.round(T / h), per = steps / M;
function segment(S, j, Fv) { let X = S; for (let s = 0; s < per; s++) X = rk4(X, (j * per + s) * h, Fv); return X; }

const X0 = [0, Math.PI, Math.PI, Math.PI, 0, 0, 0, 0];
const W = { lam: 3e-3, end: 10, defect: 1 };
// Unknowns z = [F_0..F_N, S_1..S_{M-1}]
function unpack(z) { const Fv = z.slice(0, N + 1); const S = [X0]; for (let j = 1; j < M; j++) S.push(z.slice(N + 1 + 8 * (j - 1), N + 1 + 8 * j)); return { Fv, S }; }
function residual(z) {
  const { Fv, S } = unpack(z); const r = [];
  for (let j = 0; j < M; j++) {
    const E = segment(S[j], j, Fv);
    if (j < M - 1) for (let i = 0; i < n; i++) r.push(W.defect * (E[i] - S[j + 1][i]));
    else { r.push(W.end * E[0]); for (let i = 1; i <= 3; i++) { r.push(W.end * Math.sin(E[i])); r.push(W.end * (1 - Math.cos(E[i]))); } for (let i = 4; i < 8; i++) r.push(W.end * 0.3 * E[i]); }
  }
  for (const F of Fv) r.push(W.lam * F);
  return r;
}
function solve(A, b) { const m = b.length, Mx = A.map((row, i) => [...row, b[i]]); for (let c = 0; c < m; c++) { let p = c; for (let r = c + 1; r < m; r++) if (Math.abs(Mx[r][c]) > Math.abs(Mx[p][c])) p = r; [Mx[c], Mx[p]] = [Mx[p], Mx[c]]; for (let r = c + 1; r < m; r++) { const q = Mx[r][c] / Mx[c][c]; for (let k = c; k <= m; k++) Mx[r][k] -= q * Mx[c][k]; } } const x = new Array(m).fill(0); for (let r = m - 1; r >= 0; r--) { let s = Mx[r][m]; for (let k = r + 1; k < m; k++) s -= Mx[r][k] * x[k]; x[r] = s / Mx[r][r]; } return x; }

export function optimise(seed = 1) {
  // Initial guess: states interpolated from hanging to upright (each rod
  // turning the way the first one does), a gentle oscillating force.
  let rnd = seed; const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647 - 0.5);
  const z = [];
  for (let k = 0; k <= N; k++) z.push(8 * Math.sin((2 * Math.PI * k) / N * 1.5) + 2 * rand());
  for (let j = 1; j < M; j++) { const s = j / M; const th = Math.PI * (1 - s); z.push(0, th, th, th, 0, -Math.PI / T, -Math.PI / T, -Math.PI / T); }
  for (const [lam, defect, iters] of [[3e-3, 1, 120], [1e-3, 10, 80], [3e-4, 100, 80]]) {
    W.lam = lam; W.defect = defect;
    lm(z, iters);
  }
  return unpack(z);
}

function lm(z, iters) {
  let r = residual(z), cost = r.reduce((a, v) => a + v * v, 0), mu = 1e-2;
  for (let it = 0; it < iters; it++) {
    const J = r.map(() => new Array(z.length).fill(0)), eps = 1e-6;
    for (let c = 0; c < z.length; c++) { const zc = [...z]; zc[c] += eps; const rc = residual(zc); for (let i = 0; i < r.length; i++) J[i][c] = (rc[i] - r[i]) / eps; }
    const JtJ = z.map((_, a) => z.map((__, b2) => J.reduce((s, row) => s + row[a] * row[b2], 0)));
    const Jtr = z.map((_, a) => J.reduce((s, row, i) => s + row[a] * r[i], 0));
    for (let tries = 0; tries < 8; tries++) {
      const A = JtJ.map((row, i) => row.map((v, j) => v + (i === j ? mu * (1 + v) : 0)));
      const dz = solve(A, Jtr.map((v) => -v));
      const zn = z.map((v, i) => v + dz[i]); const rn = residual(zn); const cn = rn.reduce((a, v) => a + v * v, 0);
      if (Number.isFinite(cn) && cn < cost) { z.splice(0, z.length, ...zn); r = rn; cost = cn; mu = Math.max(1e-8, mu / 3); break; }
      mu *= 4;
    }
    const defect = Math.sqrt(r.slice(0, 8 * (M - 1)).reduce((a, v) => a + v * v, 0)) / W.defect;
    const end = Math.sqrt(r.slice(8 * (M - 1), 8 * (M - 1) + 11).reduce((a, v) => a + v * v, 0)) / W.end;
    if (it % 20 === 0) console.error(`lam ${W.lam} it ${it} cost ${cost.toExponential(3)} defect ${defect.toExponential(2)} end ${end.toExponential(2)} mu ${mu.toExponential(1)} Fmax ${Math.max(...unpack(z).Fv.map(Math.abs)).toFixed(1)}`);
    if (defect < 1e-7 && end < 1e-5) break;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { Fv } = optimise(Number(process.argv[4] ?? 1));
  console.log(JSON.stringify({ T, F: Fv.map((v) => +v.toFixed(4)) }));
}
