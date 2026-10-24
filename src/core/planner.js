// Trajectory planning: a force F(t) on [0, T] that takes a Model (the plant a
// Controller sees, diagram.js) from its start state x0 to rest at the origin,
// angle states compared modulo 2π: for example a pendulum chain from hanging
// to upright. It ships with the page and runs on the plant as it is wired:
// nothing is planned offline (the person, design/input/2026-10-24-09-…).
// Method after Glück, Eder & Kugi, "Swing-up control of a triple pendulum on
// a cart with experimental validation", Automatica 49 (2013): a two-point
// boundary value problem for the feedforward, then a time-varying LQR along
// it (design/output/designs-in-the-page.md §8.3).
//
//   planTransfer(model, opts)     generator: yields null (ticks, ≤ ~2 ms apart) and a
//                                 progress object per iteration; returns the plan
//   alongPlan(model, plan)        the nominal path and the one-sample step map's Jacobians along it
//                                 (alongPlanSteps: the same, as a generator)
//   tvlqrGains(along, opts)       time-varying LQR gains, backwards from the upright P
//   planValues(model, along, Kx, up)  the plan and its gains in measurement order: planLaw's values
//   planLaw(values, Ts, opts)     the law that follows a plan, from plain data (the trajectory type runs it)
//   verifyLoop(model, law, opts)  the nonlinear closed loop, to check the plan holds
//   runPlan(gen, onProgress)      drains a generator (Node, tests, the synchronous store)
//
// The force is held over each controller sample (zero-order hold), on the
// controller's own sample grid, so the plan is exactly what the law applies.
// It is the piecewise-linear interpolation of force nodes, read at each
// sample instant. Unknowns: the nodes and the states at the starts of
// segments 1 … M−1 (multiple shooting). Residuals: the jumps between a
// segment's end and the next start (defects), the end's distance to the
// origin, small penalties on F and on its change from node to node, and a
// hinge on |F| beyond Fmax. Each
// segment's end depends only on its start and its own nodes, so the
// Jacobian is built a segment at a time and JᵀJ accumulated from the blocks.
// Levenberg–Marquardt, three continuation stages, iteration caps, three
// fixed starting guesses: the same model and inputs give the same plan, bit
// for bit. No clock decides anything.

import { inv } from './linalg.js';

export const PLAN_VERSION = 1;

// Continuation: [effort weight λ, weight of the defects and the end,
// iteration cap]. First a loose fit that keeps F small, then the jumps
// between segments and the miss at the end squeezed out. A stage ends early
// when it stalls; what it leaves of its cap goes to the next one.
const STAGES = [[3e-3, 1, 120], [1e-3, 10, 80], [3e-4, 100, 80]];
const CAP = 300;          // iterations over all starts
const HINGE = 3;          // weight of |F| beyond Fmax
const TRIES = 10;         // Levenberg–Marquardt tries per iteration
const STALL = 4;          // a stage stalls when its cost falls < 0.1 % over this many accepted iterations
const STARTS = [3, 2, 4]; // half-periods of the starting force guesses, in order

const wrapAngle = (d) => d - 2 * Math.PI * Math.round(d / (2 * Math.PI));
const fmt = (v) => String(Number(Number(v).toPrecision(3)));
// A state whose unit is per second is a rate; the rest are positions (angles among them).
const isRate = (s) => /\/s$/.test(s.unit ?? '');
// How far from the target a plan may end, and a closed loop after it.
const planTol = (s) => (s.angle ? 0.02 : isRate(s) ? 0.5 : 0.02);
const holdTol = (s) => (s.angle ? 0.05 : isRate(s) ? 0.5 : 0.25);

// RK4 over one sample of length Ts in sub substeps, u held; in place, allocation-free.
function stepper(f, n, Ts, sub) {
  const h = Ts / sub, k1 = new Float64Array(n), k2 = new Float64Array(n), k3 = new Float64Array(n), k4 = new Float64Array(n), xt = new Float64Array(n);
  return (x, u) => {
    for (let s = 0; s < sub; s++) {
      f(x, u, k1);
      for (let i = 0; i < n; i++) xt[i] = x[i] + 0.5 * h * k1[i];
      f(xt, u, k2);
      for (let i = 0; i < n; i++) xt[i] = x[i] + 0.5 * h * k2[i];
      f(xt, u, k3);
      for (let i = 0; i < n; i++) xt[i] = x[i] + h * k3[i];
      f(xt, u, k4);
      for (let i = 0; i < n; i++) x[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    }
  };
}

// Substeps per sample: steps of at most 5 ms, and short against the fastest dynamics.
export function substeps(model, Ts) {
  const hmax = Math.min(0.005, model.bound > 0 ? 0.5 / model.bound : Infinity);
  return Math.max(1, Math.ceil(Ts / hmax - 1e-9));
}

// model: a Model (n, x0, states, f, bound). opts: T (s; snapped to the sample
// grid), Ts (the controller's sample time), segments, nodesPerSegment, Fmax
// (the hinge; Infinity for none).
// Yields null between short pieces of work and, per iteration,
//   { stage, stages, iteration, cost, defect, terminal, fraction, start, starts }.
// Returns { ok, code, message, hint, T, Ts, segments, perSegment, sub, z, F (per
// sample), S (segment start states), iterations, start, starts, defect,
// terminal (end error per state, angles wrapped), endError, Fpeak, Fmax }.
export function* planTransfer(model, { T, Ts, segments = 12, nodesPerSegment = 4, Fmax = Infinity } = {}) {
  const n = model.n, M = Math.max(1, Math.round(segments)), nps = Math.max(1, Math.round(nodesPerSegment));
  if (!(Ts > 0) || !(T > 0)) throw new Error('planTransfer: T and Ts must be above 0');
  if (!n) throw new Error('planTransfer: the model has no states');
  // The sample grid: perSegment samples per segment; T snapped to it.
  const P = Math.max(4, Math.round(T / (Ts * M)));
  const Tp = M * P * Ts, N = M * nps, K = M * P;
  const sub = substeps(model, Ts);
  const step = stepper(model.f, n, Ts, sub);
  const states = model.states, angle = states.map((s) => !!s.angle);
  const x0 = Float64Array.from(model.x0);
  // Sample i of a segment reads the nodes ia[i], ia[i] + 1 of it, weighted 1 − iw[i], iw[i].
  const ia = new Int32Array(P), iw = new Float64Array(P);
  for (let i = 0; i < P; i++) { const q = i * nps; ia[i] = Math.floor(q / P); iw[i] = (q - ia[i] * P) / P; }

  const nz = N + 1 + n * (M - 1), nr = n * M + 2 * (N + 1) + N;
  const z = new Float64Array(nz), zt = new Float64Array(nz);
  const sOff = (j) => N + 1 + n * (j - 1);   // where S_j sits in z (j ≥ 1)
  const startsOf = (v) => Array.from({ length: M }, (_, j) => (j === 0 ? x0 : v.subarray(sOff(j), sOff(j) + n)));
  const S = startsOf(z), St = startsOf(zt);
  const ends = new Float64Array(M * n), endsT = new Float64Array(M * n);
  const E = Array.from({ length: M }, (_, j) => ends.subarray(j * n, (j + 1) * n));
  const Et = Array.from({ length: M }, (_, j) => endsT.subarray(j * n, (j + 1) * n));
  const r = new Float64Array(nr), rt = new Float64Array(nr);
  const xs = new Float64Array(n);
  const w = { lam: STAGES[0][0], wd: STAGES[0][1] };

  // Segment j from start s, force from the nodes in v; its end into out.
  function segment(v, j, s, out) {
    xs.set(s);
    const b = j * nps;
    for (let i = 0; i < P; i++) { const a = b + ia[i]; step(xs, v[a] + (v[a + 1] - v[a]) * iw[i]); }
    out.set(xs);
  }
  // Residuals: defects n·(M−1) and the end n (wrapped), weighted alike;
  // effort N+1; hinge N+1; the change between neighbouring nodes N, weighted
  // as the effort (without it the last stages settle on a spiky force, often
  // at the limit; with it the default plan needs half the peak force). The
  // hinge keeps one weight: one that grows with the stages makes plans worse.
  function fill(v, en, res) {
    let q = 0;
    for (let j = 0; j < M - 1; j++) { const s = v.subarray(sOff(j + 1), sOff(j + 1) + n); for (let i = 0; i < n; i++) res[q++] = w.wd * (en[j * n + i] - s[i]); }
    for (let i = 0; i < n; i++) { const d = en[(M - 1) * n + i]; res[q++] = w.wd * (angle[i] ? wrapAngle(d) : d); }
    for (let k = 0; k <= N; k++) res[q++] = w.lam * v[k];
    for (let k = 0; k <= N; k++) res[q++] = Fmax < Infinity ? HINGE * Math.max(0, Math.abs(v[k]) - Fmax) : 0;
    for (let k = 0; k < N; k++) res[q++] = w.lam * (v[k + 1] - v[k]);
  }
  const sumsq = (v) => { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; return s; };
  const norm = (v, a, b) => { let s = 0; for (let i = a; i < b; i++) s += v[i] * v[i]; return Math.sqrt(s); };
  const defectOf = (res) => norm(res, 0, n * (M - 1)) / w.wd;
  const terminalOf = (res) => norm(res, n * (M - 1), n * M) / w.wd;
  const peakOf = (v) => { let p = 0; for (let k = 0; k <= N; k++) p = Math.max(p, Math.abs(v[k])); return p; };

  // The Jacobian of one segment's end: n rows, columns its nps + 1 nodes and
  // (from segment 1 on) its n start states, by forward differences. Each
  // column perturbs one entry of z in place and puts it back.
  const ncol = nps + 1 + n, G = new Float64Array(n * ncol), endC = new Float64Array(n), idx = new Int32Array(ncol);
  function columns(j) {
    const cols = j > 0 ? ncol : nps + 1;
    for (let c = 0; c < cols; c++) {
      const zi = c <= nps ? j * nps + c : sOff(j) + c - nps - 1;
      const v = z[zi], vp = v + 1e-6 * Math.max(1, Math.abs(v)), d = vp - v;
      z[zi] = vp;
      segment(z, j, S[j], endC);
      z[zi] = v;
      for (let i = 0; i < n; i++) G[i * ncol + c] = (endC[i] - E[j][i]) / d;
      idx[c] = zi;
    }
    return cols;
  }
  // JᵀJ (dense, preallocated) and Jᵀr, accumulated from one segment's block:
  // its end rows (a defect or the end, weighted wd) and the −wd·I a defect
  // has on the next segment's start.
  const H = new Float64Array(nz * nz), g = new Float64Array(nz);
  function accumulate(j, cols) {
    const last = j === M - 1, wi = w.wd, base = last ? n * (M - 1) : n * j;
    for (let i = 0; i < n; i++) {
      const ri = r[base + i], gi = i * ncol;
      for (let a = 0; a < cols; a++) {
        const ga = wi * G[gi + a];
        if (ga === 0) continue;
        g[idx[a]] += ga * ri;
        const row = idx[a] * nz;
        for (let b = 0; b < cols; b++) H[row + idx[b]] += ga * wi * G[gi + b];
      }
      if (!last) {
        const s = sOff(j + 1) + i;
        g[s] -= w.wd * ri;
        H[s * nz + s] += w.wd * w.wd;
        for (let a = 0; a < cols; a++) { const v = -w.wd * wi * G[gi + a]; H[idx[a] * nz + s] += v; H[s * nz + idx[a]] += v; }
      }
    }
  }
  // (H + μ(1 + diag H)) dz = g by Cholesky, in place on a preallocated copy.
  const L = new Float64Array(nz * nz), dz = new Float64Array(nz);
  function lmSolve(mu) {
    L.set(H);
    for (let i = 0; i < nz; i++) L[i * nz + i] += mu * (1 + H[i * nz + i]);
    for (let j = 0; j < nz; j++) {
      const rj = j * nz;
      let d = L[rj + j];
      for (let k = 0; k < j; k++) d -= L[rj + k] * L[rj + k];
      if (!(d > 0)) return false;
      d = Math.sqrt(d);
      L[rj + j] = d;
      for (let i = j + 1; i < nz; i++) {
        const ri = i * nz;
        let s = L[ri + j];
        for (let k = 0; k < j; k++) s -= L[ri + k] * L[rj + k];
        L[ri + j] = s / d;
      }
    }
    for (let i = 0; i < nz; i++) { const ri = i * nz; let s = g[i]; for (let k = 0; k < i; k++) s -= L[ri + k] * dz[k]; dz[i] = s / L[ri + i]; }
    for (let i = nz - 1; i >= 0; i--) { let s = dz[i]; for (let k = i + 1; k < nz; k++) s -= L[k * nz + i] * dz[k]; dz[i] = s / L[i * nz + i]; }
    return true;
  }
  function evaluate(v, St2, en, Ev, res) {
    for (let j = 0; j < M; j++) segment(v, j, St2[j], Ev[j]);
    fill(v, en, res);
    return sumsq(res);
  }

  // Starting guesses: the states on a straight line from x0 to the origin
  // (angles the short way round), the force a sine of k half-periods. Its
  // amplitude scales with the force limit; with none, with the force that
  // would carry the least-driven rate across the largest distance in T.
  const dist = Float64Array.from(x0, (v, i) => (angle[i] ? wrapAngle(-v) : -v));
  let span = 0;
  for (let i = 0; i < n; i++) span = Math.max(span, Math.abs(dist[i]));
  const b0 = new Float64Array(n), b1 = new Float64Array(n);
  model.f(x0, 1e-3, b0); model.f(x0, -1e-3, b1);
  let gain = Infinity;
  for (let i = 0; i < n; i++) { const bi = Math.abs(b0[i] - b1[i]) / 2e-3; if (bi > 1e-9) gain = Math.min(gain, bi); }
  const Fchar = Number.isFinite(gain) ? (2 * span * (2 * Math.PI / Tp) ** 2) / gain : 1;
  const amp = 0.5 * Math.min(Fmax, Fchar || 1);
  function guess(k) {
    for (let i = 0; i <= N; i++) z[i] = amp * Math.sin((k * Math.PI * i) / N);
    for (let j = 1; j < M; j++) for (let i = 0; i < n; i++) z[sOff(j) + i] = x0[i] + (j / M) * dist[i];
  }

  // The end error per state and how it compares with what is accepted.
  function judge() {
    const terminal = Float64Array.from(E[M - 1], (d, i) => (angle[i] ? wrapAngle(d) : d));
    let worst = 0, at = 0;
    terminal.forEach((d, i) => { const q = Math.abs(d) / planTol(states[i]); if (q > worst) { worst = q; at = i; } });
    const defect = defectOf(r), Fpeak = peakOf(z);
    const ok = defect < 1e-4 && worst < 1 && !(Fpeak > 1.05 * Fmax) && Number.isFinite(defect);
    return { ok, terminal, defect, Fpeak, worst, at, badness: Number.isFinite(defect) ? worst + defect / 1e-4 + Math.max(0, Fpeak / Fmax - 1.05) * 10 : Infinity };
  }

  let total = 0, best = null, tried = 0;
  for (let s = 0; s < STARTS.length && total < CAP; s++) {
    guess(STARTS[s]);
    tried++;
    let mu = 1e-2, done = false, fraction = 0, spare = 0;
    for (let st = 0; st < STAGES.length && !done && total < CAP; st++) {
      // A stage may use what the stages before it left of their caps.
      const [lam, wd, own] = STAGES[st], cap = own + spare, first = total;
      w.lam = lam; w.wd = wd;
      // The cost under this stage's weights; a tick per segment (the first run is cold).
      for (let j = 0; j < M; j++) { segment(z, j, S[j], E[j]); yield null; }
      fill(z, ends, r);
      let cost = sumsq(r);
      const hist = [];
      for (let it = 0; it < cap && total < CAP; it++) {
        H.fill(0); g.fill(0);
        for (let j = 0; j < M; j++) { accumulate(j, columns(j)); yield null; }
        // The node rows, written analytically: effort, hinge, smoothness.
        for (let k = 0; k <= N; k++) {
          H[k * nz + k] += w.lam * w.lam;
          g[k] += w.lam * r[n * M + k];
          const hr = r[n * M + N + 1 + k];
          if (hr > 0) { const sg = Math.sign(z[k]) * HINGE; H[k * nz + k] += sg * sg; g[k] += sg * hr; }
        }
        for (let k = 0; k < N; k++) {
          const e = w.lam, rs = r[n * M + 2 * (N + 1) + k];
          H[k * nz + k] += e * e; H[(k + 1) * nz + k + 1] += e * e; H[k * nz + k + 1] -= e * e; H[(k + 1) * nz + k] -= e * e;
          g[k] -= e * rs; g[k + 1] += e * rs;
        }
        let accepted = false;
        for (let tries = 0; tries < TRIES && !accepted; tries++) {
          const solved = lmSolve(mu);
          yield null;
          if (solved) {
            for (let i = 0; i < nz; i++) zt[i] = z[i] - dz[i];
            const ct = evaluate(zt, St, endsT, Et, rt);
            if (Number.isFinite(ct) && ct < cost) {
              z.set(zt); ends.set(endsT); r.set(rt); cost = ct;
              mu = Math.max(1e-9, mu / 3); accepted = true;
            }
          }
          if (!accepted) mu *= 4;
          yield null;
        }
        total++;
        const defect = defectOf(r), terminal = terminalOf(r);
        fraction = Math.max(fraction, Math.min(1, (st + (it + 1) / cap) / STAGES.length));
        yield { stage: st + 1, stages: STAGES.length, iteration: total, cost, defect, terminal, fraction, start: s + 1, starts: STARTS.length };
        if (!accepted) break;   // stuck in this stage
        if (defect < 1e-6 && terminal < 1e-3 && !(peakOf(z) > 1.05 * Fmax)) { done = true; break; }
        hist.push(cost);
        if (hist.length > STALL && hist[hist.length - 1 - STALL] - cost < 1e-3 * hist[hist.length - 1 - STALL]) break;
      }
      spare = cap - (total - first);
    }
    const q = judge();
    if (!best || q.badness < best.q.badness) best = { q, s, z: Float64Array.from(z) };
    if (q.ok) break;
  }

  // The plan: the best start, its force per sample and its segment starts.
  z.set(best.z);
  evaluate(z, S, ends, E, r);
  const q = judge();
  const F = new Float64Array(K);
  for (let j = 0; j < M; j++) for (let i = 0; i < P; i++) { const a = j * nps + ia[i]; F[j * P + i] = z[a] + (z[a + 1] - z[a]) * iw[i]; }
  let Fpeak = 0;
  for (let k = 0; k < K; k++) Fpeak = Math.max(Fpeak, Math.abs(F[k]));
  const worst = states[q.at];
  const endError = { label: worst.name ?? worst.label, value: q.terminal[q.at], unit: worst.unit ?? '' };
  const plan = {
    ok: q.ok, code: q.ok ? null : 'plan-not-converged', message: '', hint: '',
    T: Tp, Ts, segments: M, perSegment: P, nodesPerSegment: nps, sub,
    z: Float64Array.from(z), F, S: S.map((v) => Float64Array.from(v)),
    iterations: total, start: best.s + 1, starts: STARTS.length,
    defect: q.defect, terminal: q.terminal, endError, Fpeak, Fmax,
  };
  // Not converged: a sentence from the numbers, and what to change.
  if (!q.ok) {
    const off = `${endError.label} ends ${fmt(Math.abs(endError.value))}${endError.unit ? ` ${endError.unit}` : ''} off`;
    const u = model.input?.label ?? 'u';
    const tries = `${total} iterations, ${tried} start${tried > 1 ? 's' : ''}`;
    if (Fpeak > 1.05 * Fmax) {
      plan.message = `no plan found within the limit: it needs ${u} up to ${fmt(Fpeak)}, of the ${fmt(Fmax)} it may use (${tries})`;
      plan.hint = `needs more force or a longer T (now ${fmt(Tp)} s)`;
    } else if (q.worst >= 1 && Fpeak >= 0.95 * Fmax) {
      plan.message = `no plan found: ${off} at T = ${fmt(Tp)} s with ${u} at its limit ${fmt(Fmax)} (${tries})`;
      plan.hint = `needs more force or a longer T (now ${fmt(Tp)} s)`;
    } else if (q.defect >= 1e-4) {
      plan.message = `no plan found: the segments do not join (defect ${fmt(q.defect)}, ${tries})`;
      plan.hint = `more segments or a longer T (now ${M} segments, T = ${fmt(Tp)} s)`;
    } else {
      plan.message = `no plan found: ${off} at T = ${fmt(Tp)} s (${tries})`;
      plan.hint = `a longer T (now ${fmt(Tp)} s) or more force`;
    }
  }
  return plan;
}

// Runs a planning generator to its end (Node, tests); onProgress gets every
// progress object (not the null ticks).
export function runPlan(gen, onProgress) {
  for (;;) {
    const s = gen.next();
    if (s.done) return s.value;
    if (s.value) onProgress?.(s.value);
  }
}

// Along a plan: the nominal state x*_k at each sample, segment by segment
// from the shooting starts (one long open-loop replay would blow the tiny
// defects up), and the Jacobians Ad_k, Bd_k of the one-sample step map
// there (sub RK4 substeps, the force held), by central differences: the
// same discrete map the law lives on, so no c2d. Flat arrays: xs (K + 1)·n
// (the last row is the plan's end), F K, Ad K·n·n, Bd K·n.
// alongPlanSteps is the same as a generator with a tick per segment, so it
// can follow planTransfer in one sliced job (yield*).
export function alongPlan(model, plan) {
  return runPlan(alongPlanSteps(model, plan));
}
export function* alongPlanSteps(model, plan) {
  const n = model.n, { segments: M, perSegment: P, Ts, sub, F } = plan, K = M * P;
  const step = stepper(model.f, n, Ts, sub);
  const xs = new Float64Array((K + 1) * n), Ad = new Float64Array(K * n * n), Bd = new Float64Array(K * n);
  const x = new Float64Array(n), xp = new Float64Array(n), xm = new Float64Array(n);
  for (let j = 0; j < M; j++) {
    x.set(plan.S[j]);
    for (let i = 0; i < P; i++) {
      const k = j * P + i, u = F[k];
      xs.set(x, k * n);
      for (let c = 0; c < n; c++) {
        const d = 1e-6 * Math.max(1, Math.abs(x[c]));
        xp.set(x); xp[c] += d; step(xp, u);
        xm.set(x); xm[c] -= d; step(xm, u);
        for (let r = 0; r < n; r++) Ad[k * n * n + r * n + c] = (xp[r] - xm[r]) / (2 * d);
      }
      const du = 1e-6 * Math.max(1, Math.abs(u));
      xp.set(x); step(xp, u + du);
      xm.set(x); step(xm, u - du);
      for (let r = 0; r < n; r++) Bd[k * n + r] = (xp[r] - xm[r]) / (2 * du);
      step(x, u);
    }
    yield null;
  }
  xs.set(x, K * n);
  return { n, K, Ts, sub, xs, F: Float64Array.from(F), Ad, Bd, angle: model.states.map((s) => !!s.angle) };
}

// Time-varying LQR along a plan: the backward discrete Riccati recursion
//   K_k = (R + Bᵀ P B)⁻¹ Bᵀ P A,   P ← Q + Aᵀ P (A − B K_k)
// from P = Pend (the upright LQR's) at the plan's end, P symmetrised every
// step. Q: n×n (rows), R: a number. Returns K as K·n (row k: u = F_k − K_k (x − x*_k)).
export function tvlqrGains(along, { Q, R, Pend }) {
  const { n, K: steps, Ad, Bd } = along;
  const P = new Float64Array(n * n), PA = new Float64Array(n * n), PB = new Float64Array(n), Ks = new Float64Array(steps * n), Kk = new Float64Array(n), next = new Float64Array(n * n);
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) P[a * n + b] = Pend[a][b];
  for (let k = steps - 1; k >= 0; k--) {
    const A = Ad.subarray(k * n * n, (k + 1) * n * n), B = Bd.subarray(k * n, (k + 1) * n);
    // PB = P B, PA = P A, S = R + Bᵀ P B, K = Bᵀ P A / S.
    for (let a = 0; a < n; a++) { let s = 0; for (let b = 0; b < n; b++) s += P[a * n + b] * B[b]; PB[a] = s; }
    for (let a = 0; a < n; a++) for (let c = 0; c < n; c++) { let s = 0; for (let b = 0; b < n; b++) s += P[a * n + b] * A[b * n + c]; PA[a * n + c] = s; }
    let S = R;
    for (let a = 0; a < n; a++) S += B[a] * PB[a];
    for (let c = 0; c < n; c++) { let s = 0; for (let a = 0; a < n; a++) s += B[a] * PA[a * n + c]; Kk[c] = s / S; }
    Ks.set(Kk, k * n);
    // P ← Q + Aᵀ (P A − P B K) = Q + Aᵀ P (A − B K).
    for (let a = 0; a < n; a++) for (let c = 0; c < n; c++) PA[a * n + c] -= PB[a] * Kk[c];
    for (let a = 0; a < n; a++) for (let c = 0; c < n; c++) { let s = Q[a][c]; for (let b = 0; b < n; b++) s += A[b * n + a] * PA[b * n + c]; next[a * n + c] = s; }
    for (let a = 0; a < n; a++) for (let c = 0; c <= a; c++) { const v = 0.5 * (next[a * n + c] + next[c * n + a]); P[a * n + c] = v; P[c * n + a] = v; }
  }
  return Ks;
}

// The plan in measurement order, for planLaw: Y_k = y(x*_k), the
// measurements along the plan, and K_k = Kx_k C⁻¹, the gains (Kx from
// tvlqrGains, K·n in state order). C is the measurement matrix of the
// linearisation at the origin (square and invertible: every state measured,
// D = 0); up: the upright LQR's { K, kr } in measurement order.
export function planValues(model, along, Kx, { C, K: Kup, kr }) {
  const n = model.n, m = model.m, steps = along.K, Ci = inv(C);
  const Y = new Float64Array(steps * m), K = new Float64Array(steps * m), y = new Float64Array(m);
  for (let k = 0; k < steps; k++) {
    model.y(along.xs.subarray(k * n, (k + 1) * n), along.F[k], y);
    Y.set(y, k * m);
    for (let i = 0; i < m; i++) { let s = 0; for (let c = 0; c < n; c++) s += Kx[k * n + c] * Ci[c][i]; K[k * m + i] = s; }
  }
  return { F: Float64Array.from(along.F), Y, K, Kup: Array.from(Kup), kr, angle: model.outputs.map((o) => !!o.angle) };
}

// The law that follows a plan, from plain data (design/output/designs-in-the-page.md §8.5):
//   values = { F (K), Y (K·m), K (K·m), Kup (m), kr, angle (m flags) }: the
//   force per sample, the measurements along the plan, the time-varying
//   gains in measurement order, the upright gains and prefilter.
// k counts samples from t = 0 and j = k − round(start / Ts):
//   j < 0      u = 0 (the plant rests where it starts until the plan begins)
//   j < K      u = F_j − Σ_i K_j,i (y_i − Y_j,i)
//   after      u = kr r − Σ_i Kup_i y_i
// with angle measurements compared modulo 2π, and u clamped to [umin, umax].
export function planLaw(values, Ts, { start = 0, umin = -Infinity, umax = Infinity } = {}) {
  const { F, Y, K: Kt, Kup, kr, angle } = values, m = Kup.length, steps = F.length, j0 = Math.round(start / Ts);
  let k = 0;
  return {
    step(x) {
      const j = k++ - j0;
      let u = 0;
      if (j >= 0 && j < steps) {
        u = F[j];
        for (let i = 0; i < m; i++) { const d = (x[i + 1] ?? 0) - Y[j * m + i]; u -= Kt[j * m + i] * (angle[i] ? wrapAngle(d) : d); }
      } else if (j >= steps) {
        u = kr * x[0];
        for (let i = 0; i < m; i++) { const y = x[i + 1] ?? 0; u -= Kup[i] * (angle[i] ? wrapAngle(y) : y); }
      }
      return Math.min(umax, Math.max(umin, u));
    },
  };
}

// The nonlinear closed loop: the Model from x0 under a law (as a Controller
// runs it: step([r, y1, …]) once per sample, r = 0, its output clamped to
// [umin, umax] and held), for duration seconds; d(t), if given, adds to u
// after the clamp (a push on the cart, say). ok when every state ends
// within reach of the origin (angles 0.05 rad, rates 0.5, other states 0.25,
// angles modulo 2π). Fpeak is the largest force the law asked for, before
// the clamp; xmax the largest excursion of a position state that is not an angle.
export function verifyLoop(model, law, { x0 = model.x0, Ts, sub, duration, umin = -Infinity, umax = Infinity, d = null }) {
  const n = model.n, m = model.m, step = stepper(model.f, n, Ts, sub ?? substeps(model, Ts));
  const x = Float64Array.from(x0), y = new Float64Array(m), inputs = new Array(m + 1).fill(0);
  const steps = Math.round(duration / Ts);
  const pos = model.states.map((s) => !s.angle && !isRate(s));
  let Fpeak = 0, xmax = 0, u = 0, finite = true;
  for (let k = 0; k < steps && finite; k++) {
    model.y(x, u, y);
    for (let i = 0; i < m; i++) inputs[i + 1] = y[i];
    const v = law.step(inputs);
    Fpeak = Math.max(Fpeak, Math.abs(v));
    u = Math.min(umax, Math.max(umin, v));
    step(x, d ? u + d(k * Ts) : u);
    for (let i = 0; i < n; i++) { if (!Number.isFinite(x[i])) finite = false; if (pos[i]) xmax = Math.max(xmax, Math.abs(x[i])); }
  }
  let worst = -1, at = 0;
  for (let i = 0; i < n; i++) {
    const s = model.states[i], e = s.angle ? wrapAngle(x[i]) : x[i];
    const q = Number.isFinite(e) ? Math.abs(e) / holdTol(s) : Infinity;
    if (q > worst) { worst = q; at = i; }
  }
  const s = model.states[at];
  return { ok: finite && worst < 1, endError: { label: s.name ?? s.label, value: s.angle ? wrapAngle(x[at]) : x[at], unit: s.unit ?? '' }, Fpeak, xmax, x };
}
