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
//   refuseKinks(lin, what)        a design's refusal of a kink at its operating point
//
// Matrices are arrays of rows, as in linalg.js: A n×n, B n×1, C m×n, D m×1.

import { solve, eig, minreal } from './linalg.js';

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

// A slope by finite differences from the values at v + h (p), v (c) and
// v − h (q): central, unless one side is not finite or flat (it returns
// exactly the value at v while the other side moves: a pump at zero flow,
// a valve against its stop), then the other side alone.
function slope(p, c, q, h) {
  if (!Number.isFinite(q) || (q === c && p !== c)) return (p - c) / h;
  if (!Number.isFinite(p) || (p === c && q !== c)) return (c - q) / h;
  return (p - q) / (2 * h);
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
    for (let i = 0; i < n; i++) { const g = slope(fp[i], f0[i], fm[i], h); gf += g * f0[i]; gg += g * g; }
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
// position) stay where they start. Each residual row is scaled by the size
// of its Jacobian row, which leaves the minimum-norm step as it is but lets
// a fast state's rate (10¹¹ per unit, a stiff filter) and a slow one's weigh
// alike. Starts:
//   1. from the targets: a measurement that reads one state alone (slope s)
//      sets that state to its level, the rest stay at the start state, and
//      u is the input that holds that (an empty tank trims at 0.1 m at once);
//   2. from the start state x0, with the u that comes closest to holding it;
//   3. from there in eight stages towards the levels (a kink such as a pump
//      that cannot run backwards).
// Iteration caps only, no randomness. Throws DesignError 'trim-failed' or 'u-limit'.
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
  };
  const zt = new Float64Array(N), r = new Float64Array(P), rt = new Float64Array(P), rp = new Float64Array(P), rm = new Float64Array(P);
  const J = Array.from({ length: P }, () => new Array(N).fill(0)), rs = new Float64Array(P), tol = new Float64Array(P);
  const scaledCost = (v) => { let s = 0; for (let i = 0; i < P; i++) s += (rs[i] * v[i]) ** 2; return s; };
  // How far each residual may stay from 0: 1e-8, or what a relative error
  // of 1e-12 in z leaves of it (a stiff state's rate cannot get closer).
  const tolerances = (z) => { for (let i = 0; i < P; i++) { let s = 0; for (let j = 0; j < N; j++) s += Math.abs(J[i][j] * z[j]); tol[i] = 1e-8 + 1e-12 * s; } };
  const worst = () => { let w = 0; for (let i = 0; i < P; i++) w = Math.max(w, Math.abs(r[i]) / tol[i]); return w; };
  // Gauss–Newton from z towards goal; true when every residual is within its tolerance.
  const solveFrom = (z, iterations) => {
    residual(z, r);
    let lambda = 0, jacobian = false;
    for (let it = 0; it < iterations; it++) {
      for (let j = 0; j < N; j++) {
        const v = z[j], h = step(v);
        zt.set(z); zt[j] = v + h; residual(zt, rp);
        zt[j] = v - h; residual(zt, rm);
        // One side not finite, or flat for every row while the other moves: that side's slope is no slope.
        let pBad = false, mBad = false, pFlat = true, mFlat = true;
        for (let i = 0; i < P; i++) {
          if (!Number.isFinite(rp[i])) pBad = true;
          if (!Number.isFinite(rm[i])) mBad = true;
          if (rp[i] !== r[i]) pFlat = false;
          if (rm[i] !== r[i]) mFlat = false;
        }
        for (let i = 0; i < P; i++) J[i][j] = mBad || (mFlat && !pFlat) ? (rp[i] - r[i]) / h : pBad || (pFlat && !mFlat) ? (r[i] - rm[i]) / h : (rp[i] - rm[i]) / (2 * h);
      }
      jacobian = true;
      tolerances(z);
      if (worst() <= 1) return true;
      for (let i = 0; i < P; i++) { let s = 0; for (let j = 0; j < N; j++) s += J[i][j] * J[i][j]; rs[i] = s > 0 && Number.isFinite(s) ? 1 / Math.sqrt(s) : 1; }
      const Js = J.map((row, i) => row.map((v) => v * rs[i]));
      const JJ = Js.map((a) => Js.map((b) => a.reduce((s, x, k) => s + x * b[k], 0)));
      const scale = Math.max(1e-300, ...JJ.map((row, i) => row[i]));
      lambda = lambda ? Math.max(lambda / 10, 1e-15 * scale) : 1e-12 * scale;
      const cost = scaledCost(r), rsc = Array.from(r, (v, i) => v * rs[i]);
      let accepted = false;
      for (let tries = 0; tries < 12; tries++) {
        let w = null;
        try { w = solve(JJ.map((row, i) => row.map((v, j) => v + (i === j ? lambda : 0))), rsc); } catch { /* singular: damp more */ }
        if (w) {
          for (let j = 0; j < N; j++) { let s = 0; for (let i = 0; i < P; i++) s += Js[i][j] * w[i]; zt[j] = z[j] - s; }
          residual(zt, rt);
          const c = scaledCost(rt);
          if (c < cost) { z.set(zt); r.set(rt); accepted = true; break; }
        }
        lambda *= 10;
      }
      if (!accepted) break;
    }
    if (!jacobian) return false;
    return worst() <= 1;
  };
  const z0 = new Float64Array(N);
  z0.set(model.x0);
  z0[n] = restInput(model, model.x0, umin, umax);
  model.y(model.x0, z0[n], y);
  const y0 = free.map((k) => y[k]);
  free.forEach((k, j) => { goal[j] = tg[k]; });
  // 1. From the targets, where a measurement reads one state alone.
  const seed = Float64Array.from(z0);
  let seeded = false;
  free.forEach((k, j) => {
    const o = model.outputs[k];
    if (!(o && Number.isInteger(o.state) && Math.abs(o.slope) > 0)) return;
    seed[o.state] = model.x0[o.state] + (tg[k] - y0[j]) / o.slope;
    seeded = true;
  });
  let z = seed, ok = false;
  if (seeded) {
    seed[n] = restInput(model, seed.subarray(0, n), umin, umax);
    ok = solveFrom(z, 50);
  }
  // 2. From the start state; 3. in stages from there.
  if (!ok) { z = Float64Array.from(z0); ok = solveFrom(z, 50); }
  if (!ok) {
    z = Float64Array.from(z0);
    for (let s = 1; s <= 8; s++) {
      free.forEach((k, j) => { goal[j] = y0[j] + ((tg[k] - y0[j]) * s) / 8; });
      ok = solveFrom(z, s < 8 ? 20 : 50);
    }
  }
  residual(z, r);
  const res = maxAbs(r);
  if (!ok) throw new DesignError('trim-failed', `no equilibrium with ${label}: the best found leaves a residual of ${fmt(res)}`, `the level may be out of reach of ${uName}, or the levels contradict each other`);
  const u = z[n];
  if (u > umax + 1e-12) throw new DesignError('u-limit', `holding ${label} needs ${uName} = ${fmt(u)}, above u max ${fmt(umax)}`, 'choose a level the actuator can hold, or raise u max');
  if (u < umin - 1e-12) throw new DesignError('u-limit', `holding ${label} needs ${uName} = ${fmt(u)}, below u min ${fmt(umin)}`, 'choose a level the actuator can hold, or lower u min');
  return { x: Float64Array.from(z.subarray(0, n)), u, residual: res };
}

// The linear model at an operating point (a spec, or what operatingPoint
// returned), by central differences with steps h = 1e-6·max(1, |v|):
//   δẋ = A δx + B δu,  δy = C δx + D δu.
// A kink at the point (a saturation at its limit, a pump at zero flow, a
// square root at 0) makes the slope differ left and right, and the central
// difference is then neither. So each slope is also taken one-sided; where
// the two sides disagree beyond 10⁻³ (and beyond the curvature a smooth
// function shows: the gap must not shrink with a 10× shorter step), lin.kinks
// names the state or input and what it moves, and LQR, the Kalman filter and
// the PI design refuse. Saturations at their limit are named there too.
export function linearize(model, op = 'origin') {
  const pt = op && op.x && 'u' in op ? op : operatingPoint(model, op);
  const { n, m } = model, x = Float64Array.from(pt.x), u = pt.u, uName = model.input?.label ?? 'u';
  const f0 = new Float64Array(n), y0 = new Float64Array(m);
  model.f(x, u, f0); model.y(x, u, y0);
  const c0 = Float64Array.from([...f0, ...y0]);
  // The values of f and y (one vector) with coordinate j (n: u) moved by d.
  const moved = (j, d) => {
    const fv = new Float64Array(n), yv = new Float64Array(m);
    if (j < n) { const v = x[j]; x[j] = v + d; model.f(x, u, fv); model.y(x, u, yv); x[j] = v; } else { model.f(x, u + d, fv); model.y(x, u + d, yv); }
    return Float64Array.from([...fv, ...yv]);
  };
  const rows = n + m, cols = n + 1;
  const S = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const side = [];
  for (let j = 0; j < cols; j++) {
    const v = j < n ? x[j] : u, h = step(v), p = moved(j, h), q = moved(j, -h);
    for (let i = 0; i < rows; i++) S[i][j] = (p[i] - q[i]) / (2 * h);
    side.push({ h, p, q });
  }
  // One-sided slopes against the central ones; a suspect gap is checked with a 10× longer step.
  const rowScale = S.map((row) => Math.max(0, ...row.map((v) => (Number.isFinite(v) ? Math.abs(v) : 0))));
  const kinks = [];
  const rowName = (i) => (i < n ? `the rate of ${model.states[i].label}` : model.outputs[i - n].label);
  const colName = (j) => (j < n ? model.states[j].label : uName);
  for (let j = 0; j < cols; j++) {
    const { h, p, q } = side[j];
    let far = null;
    for (let i = 0; i < rows; i++) {
      const fw = (p[i] - c0[i]) / h, bw = (c0[i] - q[i]) / h, gap = Math.abs(fw - bw);
      const noise = (1e3 * Number.EPSILON * Math.max(Math.abs(c0[i]), Math.abs(p[i]), Math.abs(q[i]))) / h;
      if (Number.isFinite(gap) && !(gap > 1e-3 * Math.max(Math.abs(fw), Math.abs(bw)) + 1e-6 * rowScale[i] + noise)) continue;
      if (!far) far = { p: moved(j, 10 * h), q: moved(j, -10 * h) };
      const gapFar = Math.abs((far.p[i] - c0[i]) / (10 * h) - (c0[i] - far.q[i]) / (10 * h));
      if (Number.isFinite(gap) && Number.isFinite(gapFar) && !(gap > 0.5 * gapFar)) continue;
      kinks.push(Number.isFinite(gap) ? `the slope of ${rowName(i)} along ${colName(j)} differs left and right (${fmt(bw)} and ${fmt(fw)})` : `${rowName(i)} has no slope along ${colName(j)} there`);
      break;
    }
  }
  const edges = (model.limits?.(x, u) ?? []).filter((s) => s.edge).map((s) => s.sentence);
  const A = S.slice(0, n).map((row) => row.slice(0, n)), B = S.slice(0, n).map((row) => [row[n]]);
  const C = S.slice(n).map((row) => row.slice(0, n)), D = S.slice(n).map((row) => [row[n]]);
  return {
    A, B, C, D, n, m,
    states: model.states, outputs: model.outputs, input: model.input ?? { label: 'u' },
    op: pt, delay: model.delay, sensors: model.sensors,
    kinks: [...edges, ...kinks],
    warnings: [...new Set([...model.warnings, ...pt.warnings, ...kinks.map((k) => `a kink at the operating point: ${k}`)])],
  };
}

// A design on a linear model refuses a kink at its operating point: the
// slopes it would use are neither the left nor the right one.
export function refuseKinks(lin, what) {
  if (!lin.kinks?.length) return;
  throw new DesignError('kink', `${what} needs slopes, and the plant has a kink at ${lin.op.label}: ${lin.kinks[0]}`, 'choose an operating point away from the limit or kink, or move the limit');
}

// The path from u to measurement k as a first-order lag with dead time,
// K e^(−θs) / (τs + 1): the static gain K = D − C A⁻¹ B, the mean residence
// time τ = C A⁻² B / K (exact for one state), θ the dead time reported on
// the way. Computed on a minimal realisation of the path (linalg.js
// minreal: balanced, then only the modes u moves and y_k sees), so badly
// scaled states (a stiff filter beside a slow motor) and a pole cancelled by
// a zero (an angle, then its derivative) do not get in the way. Refusals:
// 'integrating-plant' (a pole at 0 left), 'unstable-plant' (a pole in the
// right half-plane), 'zero-gain', 'no-path'.
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
  if (!path.length && d === 0) throw new DesignError('no-path', `${uName} does not reach ${label}`, 'check the wiring from the controller output to the plant and on to this measurement');
  const mr = minreal(path.map((i) => path.map((j) => lin.A[i][j])), path.map((i) => lin.B[i][0]), path.map((j) => lin.C[k][j]));
  const A = mr.A, B = mr.b, C = mr.c, r = A.length;
  if (!r) {
    if (d === 0) throw new DesignError('zero-gain', `${uName} has no static effect on ${label}`, 'pole cancellation needs a plant whose output settles away from 0');
    return { K: d, tau: 0, theta: lin.delay[k] ?? 0, label, warnings: [] };
  }
  let size = 0;
  for (const row of A) for (const v of row) size += v * v;
  size = Math.sqrt(size);
  const poles = eig(A);
  if (poles.some((p) => Math.hypot(p.re, p.im) <= 1e-9 * size)) throw new DesignError('integrating-plant', `${label} integrates ${uName}: it has no static gain`, 'pole cancellation needs a self-regulating plant; measure a rate, or use another design');
  const rhp = poles.filter((p) => p.re > 1e-9 * size);
  if (rhp.length) throw new DesignError('unstable-plant', `the path from ${uName} to ${label} is unstable: a pole at ${fmt(rhp[0].re)}${rhp[0].im ? ` ± ${fmt(Math.abs(rhp[0].im))}i` : ''} rad/s`, 'pole cancellation needs a stable plant; stabilise it first (an inner loop), or use LQR');
  const x1 = solve(A, B), x2 = solve(A, x1);
  const K = d - C.reduce((s, c, i) => s + c * x1[i], 0);
  if (!(Math.abs(K) > 1e-9 * Math.max(Math.abs(d), Math.hypot(...C) * Math.hypot(...B) / size))) throw new DesignError('zero-gain', `${uName} has no static effect on ${label}`, 'pole cancellation needs a plant whose output settles away from 0');
  const tau = C.reduce((s, c, i) => s + c * x2[i], 0) / K;
  const warnings = tau > 0 ? [] : [`the step response of ${label} is not lag-like (τ = ${fmt(tau)} s): it overshoots or starts the wrong way`];
  return { K, tau, theta: lin.delay[k] ?? 0, label, warnings };
}
