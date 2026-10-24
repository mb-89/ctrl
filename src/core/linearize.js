// Operating points, trim and linearisation of the plant a block sees: pure
// numerics on a Model (diagram.js, el.seen), which gives ẋ = f(x, u) and the
// measurements y(x, u) over the states the block's input reaches. Nothing
// here knows a plant; every number comes from f and y
// (design/output/designs.md).
//
//   parseOp(spec)                 'origin' | 'initial' | { y: [levels] } | { t } → Op
//   operatingPoint(model, op)     → { kind, x, u, y, drift, rest, label, warnings }
//   trim(model, targets)          an equilibrium where the measurements are at targets
//   linearize(model, op)          → { A, B, C, D, states, outputs, op, delay, sensors, warnings }
//   firstOrderFit(lin, k)         K, τ, θ of the path from u to measurement k
//
// Matrices are arrays of rows, as in linalg.js: A n×n, B n×1, C m×n, D m×1.

import { solve, rank } from './linalg.js';

// An error a design reports: a code, a sentence, and a hint. The status of a
// failed design carries all three; nothing breaks (the law then puts out 0).
export class DesignError extends Error {
  constructor(code, message, hint = '') {
    super(message);
    this.name = 'DesignError';
    this.code = code;
    this.hint = hint;
  }
}

const fmt = (v) => (Number.isFinite(v) ? String(Number(Number(v).toPrecision(3))) : String(v));
const maxAbs = (v) => { let m = 0; for (let i = 0; i < v.length; i++) m = Math.max(m, Math.abs(v[i])); return m; };
const sumSq = (v) => { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; return s; };
// The rates below this count as rest (units of the state per second).
const REST = 1e-6;
const step = (v) => 1e-6 * Math.max(1, Math.abs(v));

// An operating point as a design or the Analysis tab names it.
export function parseOp(spec, where = 'operating point') {
  if (spec === undefined || spec === null || spec === 'origin') return { kind: 'origin' };
  if (spec === 'initial') return { kind: 'initial' };
  if (typeof spec === 'object' && ['origin', 'initial', 'y', 't'].includes(spec.kind)) return spec;
  if (typeof spec === 'object' && 'y' in spec) {
    const y = Array.isArray(spec.y) ? spec.y : [spec.y];
    if (!y.length || !y.every((v) => v === null || Number.isFinite(v))) throw new DesignError('bad-op', `${where}: y takes levels, one per measurement`, 'null leaves a measurement free');
    return { kind: 'y', y: y.map((v) => (v === null ? null : Number(v))) };
  }
  if (typeof spec === 'object' && 't' in spec) {
    if (!(Number(spec.t) >= 0)) throw new DesignError('bad-op', `${where}: t is a time of the run, in seconds`, 'a time from 0 to the end of the screen');
    return { kind: 't', t: Number(spec.t), u: Number(spec.u) || 0 };
  }
  throw new DesignError('bad-op', `${where}: 'origin', 'initial', { y: [levels] } or { t: seconds }`, 'origin: all states 0; initial: the start state; y: an equilibrium at these levels; t: a moment of the run');
}

// A label for an operating point; with the model, levels are named by the
// measurements they set ('h = 0.45 m').
export function opLabel(op, model = null) {
  op = parseOp(op);
  if (op.kind === 'origin') return 'origin (all states 0, u = 0)';
  if (op.kind === 'initial') return 'the initial state';
  if (op.kind === 't') return `t = ${op.t.toFixed(2)} s of the run`;
  return op.y.map((v, k) => {
    if (v === null) return '';
    const o = model?.outputs[k];
    return `${o?.label ?? `y${k + 1}`} = ${fmt(v)}${o?.unit ? ` ${o.unit}` : ''}`;
  }).filter(Boolean).join(', ') || 'an equilibrium near the initial state';
}

// The fastest-moving state at (x, u), for sentences: 'θ moves at 0.3 rad/s'.
function moving(model, f) {
  let j = 0;
  for (let i = 1; i < f.length; i++) if (Math.abs(f[i]) > Math.abs(f[j])) j = i;
  const s = model.states[j];
  return `${s.label} moves at ${fmt(f[j])}${s.unit ? ` ${s.unit}` : ''}/s`;
}

// The operating point op of the model: the state x (kept states), the input
// u, the measurements y there, and how far it is from rest (drift = max |ẋ|).
//   origin:  x = 0, u = 0
//   initial: x = the model's start state, u the input that comes closest to rest
//   { y }:   an equilibrium with those measurements (trim)
//   { t }:   the model built at a snapshot of the run; u as given; not an equilibrium
export function operatingPoint(model, op, { umin = -Infinity, umax = Infinity } = {}) {
  op = parseOp(op);
  const { n, m } = model, uName = model.input?.label ?? 'u';
  let x, u;
  if (op.kind === 'origin') { x = new Float64Array(n); u = 0; }
  else if (op.kind === 'initial') { x = Float64Array.from(model.x0); u = restInput(model, x, umin, umax); }
  else if (op.kind === 'y') ({ x, u } = trim(model, op.y, { umin, umax }));
  else { x = Float64Array.from(model.x0); u = op.u; }
  const f = new Float64Array(n), y = new Float64Array(m);
  model.f(x, u, f);
  model.y(x, u, y);
  const drift = maxAbs(f), rest = drift <= REST;
  const warnings = [];
  if (!rest) {
    if (op.kind === 'origin') warnings.push(`the origin is not at rest: ${moving(model, f)} with ${uName} = 0`);
    else if (op.kind === 'initial') warnings.push(`no ${uName} holds the initial state at rest: ${moving(model, f)} at best`);
    else if (op.kind === 't') warnings.push(`t = ${op.t.toFixed(2)} s is not an equilibrium: ${moving(model, f)}`);
  }
  warnings.push(...(model.atLimits?.(x, u) ?? []));
  const base = opLabel(op, model);
  // (an input that is 0 but for rounding reads 0)
  const label = op.kind === 'initial' || op.kind === 'y' ? `${base}, ${uName} = ${fmt(Math.abs(u) < 1e-12 ? 0 : u)}` : base;
  return { kind: op.kind, op, x, u, y, drift, rest, label, warnings };
}

// The u that brings ẋ = f(x, u) closest to 0 at a fixed x (scalar
// Gauss–Newton with halving steps), within [umin, umax].
function restInput(model, x, umin, umax) {
  const n = model.n, f0 = new Float64Array(n), fp = new Float64Array(n), fm = new Float64Array(n);
  const cost = (u) => { model.f(x, u, f0); let s = 0; for (let i = 0; i < n; i++) s += f0[i] * f0[i]; return s; };
  const clamp = (v) => Math.min(umax, Math.max(umin, v));
  let u = clamp(0), c = cost(u);
  for (let it = 0; it < 50 && c > 0; it++) {
    const h = step(u);
    model.f(x, u + h, fp); model.f(x, u - h, fm);
    cost(u);
    let gf = 0, gg = 0;
    for (let i = 0; i < n; i++) { const g = (fp[i] - fm[i]) / (2 * h); gf += g * f0[i]; gg += g * g; }
    if (!(gg > 0)) break;
    let du = -gf / gg, moved = false;
    for (let tries = 0; tries < 30; tries++, du /= 2) {
      const un = clamp(u + du), cn = cost(un);
      if (cn < c) { moved = un !== u; u = un; c = cn; break; }
    }
    if (!moved) break;
  }
  return u;
}

// An equilibrium f(x, u) = 0 with y_k(x, u) = targets[k] (null: free), over
// the kept states and u. Damped Gauss–Newton with minimum-norm steps
// Δ = −Jᵀ (J Jᵀ + λI)⁻¹ r, so coordinates the targets leave free (a cart's
// position) stay where they start: at the start state x0, with the u that
// comes closest to holding it. If the targets cannot be reached in one go
// (a kink such as a pump that cannot run backwards), they are approached in
// eight stages from where the start state is. Iteration caps only, no
// randomness. Throws DesignError 'trim-failed' or 'u-limit'.
export function trim(model, targets, { umin = -Infinity, umax = Infinity } = {}) {
  const { n, m } = model, N = n + 1, uName = model.input?.label ?? 'u';
  const tg = Array.isArray(targets) ? targets : [targets];
  if (tg.length > m) throw new DesignError('bad-op', `${tg.length} levels for ${m} measurement${m === 1 ? '' : 's'} (${model.outputs.map((o) => o.label).join(', ')})`, 'give at most one level per measurement, null to leave one free');
  const free = [];
  tg.forEach((v, k) => { if (v !== null && v !== undefined) free.push(k); });
  const P = n + free.length;
  const label = opLabel({ kind: 'y', y: tg.map((v) => v ?? null) }, model);
  const f = new Float64Array(n), y = new Float64Array(m), goal = new Float64Array(free.length);
  const residual = (zz, r) => {
    const x = zz.subarray(0, n), u = zz[n];
    model.f(x, u, f);
    model.y(x, u, y);
    for (let i = 0; i < n; i++) r[i] = f[i];
    for (let j = 0; j < free.length; j++) r[n + j] = y[free[j]] - goal[j];
    return sumSq(r);
  };
  const zt = new Float64Array(N), r = new Float64Array(P), rt = new Float64Array(P), rp = new Float64Array(P), rm = new Float64Array(P);
  const J = Array.from({ length: P }, () => new Array(N).fill(0));
  // Gauss–Newton from z towards goal; returns the largest residual left.
  const solveFrom = (z, iterations) => {
    let cost = residual(z, r), lambda = 0;
    for (let it = 0; it < iterations && maxAbs(r) > 1e-14; it++) {
      for (let j = 0; j < N; j++) {
        const v = z[j], h = step(v);
        zt.set(z); zt[j] = v + h; residual(zt, rp);
        zt[j] = v - h; residual(zt, rm);
        for (let i = 0; i < P; i++) J[i][j] = (rp[i] - rm[i]) / (2 * h);
      }
      const JJ = J.map((a) => J.map((b) => a.reduce((s, x, k) => s + x * b[k], 0)));
      const scale = Math.max(1e-300, ...JJ.map((row, i) => row[i]));
      lambda = lambda ? Math.max(lambda / 10, 1e-15 * scale) : 1e-12 * scale;
      let accepted = false;
      for (let tries = 0; tries < 12; tries++) {
        let w = null;
        try { w = solve(JJ.map((row, i) => row.map((v, j) => v + (i === j ? lambda : 0))), Array.from(r)); } catch { /* singular: damp more */ }
        if (w) {
          for (let j = 0; j < N; j++) { let s = 0; for (let i = 0; i < P; i++) s += J[i][j] * w[i]; zt[j] = z[j] - s; }
          const c = residual(zt, rt);
          if (c < cost) { z.set(zt); r.set(rt); cost = c; accepted = true; break; }
        }
        lambda *= 10;
      }
      if (!accepted) break;
    }
    residual(z, r);
    return maxAbs(r);
  };
  const z0 = new Float64Array(N);
  z0.set(model.x0);
  z0[n] = restInput(model, model.x0, umin, umax);
  model.y(model.x0, z0[n], y);
  const y0 = free.map((k) => y[k]);
  let z = Float64Array.from(z0);
  free.forEach((k, j) => { goal[j] = tg[k]; });
  let res = solveFrom(z, 50);
  if (!(res <= 1e-8)) {
    z = Float64Array.from(z0);
    for (let s = 1; s <= 8; s++) {
      free.forEach((k, j) => { goal[j] = y0[j] + ((tg[k] - y0[j]) * s) / 8; });
      res = solveFrom(z, s < 8 ? 20 : 50);
    }
  }
  if (!(res <= 1e-8)) throw new DesignError('trim-failed', `no equilibrium with ${label}: the best found leaves a residual of ${fmt(res)}`, `the level may be out of reach of ${uName}, or the levels contradict each other`);
  const u = z[n];
  if (u > umax + 1e-12) throw new DesignError('u-limit', `holding ${label} needs ${uName} = ${fmt(u)}, above u max ${fmt(umax)}`, 'choose a level the actuator can hold, or raise u max');
  if (u < umin - 1e-12) throw new DesignError('u-limit', `holding ${label} needs ${uName} = ${fmt(u)}, below u min ${fmt(umin)}`, 'choose a level the actuator can hold, or lower u min');
  return { x: Float64Array.from(z.subarray(0, n)), u, residual: res };
}

// The linear model at an operating point (a spec, or what operatingPoint
// returned), by central differences with steps 1e-6·max(1, |v|):
//   δẋ = A δx + B δu,  δy = C δx + D δu.
export function linearize(model, op = 'origin') {
  const pt = op && op.x && 'u' in op ? op : operatingPoint(model, op);
  const { n, m } = model, x = Float64Array.from(pt.x), u = pt.u;
  const fp = new Float64Array(n), fm = new Float64Array(n), yp = new Float64Array(m), ym = new Float64Array(m);
  const A = Array.from({ length: n }, () => new Array(n).fill(0)), C = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let j = 0; j < n; j++) {
    const v = x[j], h = step(v);
    x[j] = v + h; model.f(x, u, fp); model.y(x, u, yp);
    x[j] = v - h; model.f(x, u, fm); model.y(x, u, ym);
    x[j] = v;
    for (let i = 0; i < n; i++) A[i][j] = (fp[i] - fm[i]) / (2 * h);
    for (let k = 0; k < m; k++) C[k][j] = (yp[k] - ym[k]) / (2 * h);
  }
  const h = step(u);
  model.f(x, u + h, fp); model.y(x, u + h, yp);
  model.f(x, u - h, fm); model.y(x, u - h, ym);
  const B = Array.from({ length: n }, (_, i) => [(fp[i] - fm[i]) / (2 * h)]);
  const D = Array.from({ length: m }, (_, k) => [(yp[k] - ym[k]) / (2 * h)]);
  return {
    A, B, C, D, n, m,
    states: model.states, outputs: model.outputs, input: model.input ?? { label: 'u' },
    op: pt, delay: model.delay, sensors: model.sensors,
    warnings: [...new Set([...model.warnings, ...pt.warnings])],
  };
}

// The path from u to measurement k as a first-order lag with dead time,
// K e^(−θs) / (τs + 1): the static gain K = D − C A⁻¹ B, the mean residence
// time τ = C A⁻² B / K (exact for one state), θ the dead time reported on
// the way. Only the states on the path (moved by u, seen by y_k) count.
export function firstOrderFit(lin, k = 0) {
  if (!(k >= 0 && k < lin.m)) throw new DesignError('bad-output', `no measurement ${k + 1}; this block has ${lin.m}`);
  const label = lin.outputs[k].label, uName = lin.input.label;
  const n = lin.n, d = lin.D[k][0];
  // States on the path: reached from B through A, and reaching C_k through A.
  const reach = (seed, edge) => {
    const on = seed.slice(), stack = [];
    on.forEach((v, i) => { if (v) stack.push(i); });
    while (stack.length) { const i = stack.pop(); for (let j = 0; j < n; j++) if (!on[j] && edge(i, j)) { on[j] = true; stack.push(j); } }
    return on;
  };
  const fromU = reach(lin.B.map((b) => b[0] !== 0), (i, j) => lin.A[j][i] !== 0);
  const toY = reach(lin.C[k].map((c) => c !== 0), (i, j) => lin.A[i][j] !== 0);
  const path = [];
  for (let i = 0; i < n; i++) if (fromU[i] && toY[i]) path.push(i);
  if (!path.length) {
    if (d === 0) throw new DesignError('no-path', `${uName} does not reach ${label}`, 'check the wiring from the controller output to the plant and on to this measurement');
    return { K: d, tau: 0, theta: lin.delay[k] ?? 0, label, warnings: [] };
  }
  const A = path.map((i) => path.map((j) => lin.A[i][j])), B = path.map((i) => lin.B[i][0]), C = path.map((j) => lin.C[k][j]);
  if (rank(A) < path.length) throw new DesignError('integrating-plant', `${label} integrates ${uName}: it has no static gain`, 'pole cancellation needs a self-regulating plant; measure a rate, or use another design');
  const x1 = solve(A, B), x2 = solve(A, x1);
  const K = d - C.reduce((s, c, i) => s + c * x1[i], 0);
  if (!(Math.abs(K) > 1e-12 * Math.max(1, Math.abs(d)))) throw new DesignError('zero-gain', `${uName} has no static effect on ${label}`, 'pole cancellation needs a plant whose output settles away from 0');
  const tau = C.reduce((s, c, i) => s + c * x2[i], 0) / K;
  const warnings = tau > 0 ? [] : [`the step response of ${label} is not lag-like (τ = ${fmt(tau)} s): it overshoots or starts the wrong way`];
  return { K, tau, theta: lin.delay[k] ?? 0, label, warnings };
}
