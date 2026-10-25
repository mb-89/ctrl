// Closed-loop simulation of one SISO loop:
//
//   r ─►(Σ)─► C ─► sat ─► A ─►(Σ)─► P ─┬─► y
//        ▲−                    ▲ d     │
//        └──── (+n) ◄── S ◄────────────┘
//
// The controller is digital: it samples the measurement every sampleTime and
// holds its output (zero-order hold). Actuator, plant and sensor are continuous
// and integrated with fixed-step RK4 between samples. Because the measurement is
// taken before the new control value is applied, the loop has no algebraic loop.

import { blockDef, SLOTS } from './blocks.js';
import { tf2ss, rootBound } from './poly.js';
import { compileDiagram, plantDiagram, wrapPlant } from './diagram.js';
import { referenceFn } from './signals.js';

const MAX_SAMPLES = 200000;
const MAX_STEPS = 400000;
const BLOWUP = 1e8;

// opts.openLoop: the controller is bypassed and the actuator receives r
// directly, to show the plant's own response before a controller exists.
export function simulate(loop, sim, opts = {}) {
  const duration = Number(sim.duration);
  const Ts = Number(sim.sampleTime);
  if (!(duration > 0)) throw new Error('sim.duration must be > 0');
  if (!(Ts > 0)) throw new Error('sim.sampleTime must be > 0');
  for (const s of SLOTS) if (!loop[s.key] && !(opts.openLoop && s.key === 'controller')) throw new Error(`loop is missing slot "${s.key}"`);

  const warnings = [];
  const K = Math.min(Math.round(duration / Ts), MAX_SAMPLES);
  if (K < Math.round(duration / Ts)) warnings.push(`sample count capped at ${MAX_SAMPLES}; increase sampleTime`);

  const refFn = referenceFn(loop.reference ?? { period: 1, components: [] }, { sampleTime: Ts });
  const distFn = blockDef('disturbance', loop.disturbance.type).signal(loop.disturbance.params);
  const actDef = blockDef('actuator', loop.actuator.type);
  const limits = actDef.limits ? actDef.limits(loop.actuator.params) : null;
  const noise = blockDef('noise', loop.noise.type).noise(loop.noise.params);

  // Continuous chain: actuator, plant, sensor, each compiled as a diagram (a
  // single block is a diagram of one block; the plant may be a whole diagram).
  const asDiagram = (slot) => {
    const block = loop[slot];
    if (slot === 'plant') return plantDiagram(block);
    const tf = blockDef(slot, block.type).tf(block.params);
    return wrapPlant({ type: 'tf', params: { num: tf.num, den: tf.den, delay: Number(tf.delay) || 0 } });
  };
  const elems = ['actuator', 'plant', 'sensor'].map((slot) => compileDiagram(asDiagram(slot), slot));
  for (const el of elems) warnings.push(...el.warnings);
  let bound = 0;
  for (const el of elems) bound = Math.max(bound, el.bound);
  const hmax = bound > 0 ? 0.5 / bound : Ts;
  let m = Math.max(1, Math.ceil(Ts / hmax - 1e-9));
  if (K * m > MAX_STEPS) {
    m = Math.max(1, Math.floor(MAX_STEPS / K));
    warnings.push('stiff system: integration step limited for speed; results may be inaccurate');
  }
  const h = Ts / m;
  let N = 0;
  for (const el of elems) { el.off = N; N += el.n; el.setStep(h); }
  const sig = new Float64Array(3);

  // Evaluates the chain at time t: fills dX (if given) and sig (the outputs
  // of actuator, plant and sensor). The disturbance adds at the plant input.
  // end: the end of an integration step (a dead time reads what the step
  // ran on, not what a new u puts in there).
  function chainEval(t, X, u, dX, end = false) {
    sig[0] = elems[0].eval(t, X, elems[0].off, u, dX, end);
    sig[1] = elems[1].eval(t, X, elems[1].off, sig[0] + distFn(t), dX, end);
    sig[2] = elems[2].eval(t, X, elems[2].off, sig[1], dX, end);
  }
  // Dead times remember their input at each step: the value the step ended
  // on (recordLeft), and the one after a new u (record), so a held u comes
  // out exactly delayed (diagram.js histAt).
  function record() { for (const el of elems) el.record(); }
  function recordLeft() { for (const el of elems) el.recordLeft(); }

  const ctrl = opts.openLoop ? null : makeController(loop.controller, Ts, warnings);
  const rand = gaussian(noise.seed);

  const X = new Float64Array(N);
  for (const el of elems) el.init(X, el.off);
  const Xt = new Float64Array(N);
  const k1 = new Float64Array(N), k2 = new Float64Array(N), k3 = new Float64Array(N), k4 = new Float64Array(N);

  const out = {
    t: new Float64Array(K + 1), r: new Float64Array(K + 1), y: new Float64Array(K + 1), u: new Float64Array(K + 1),
    v: new Float64Array(K + 1), ym: new Float64Array(K + 1), d: new Float64Array(K + 1), e: new Float64Array(K + 1),
  };

  let unstable = false;
  let blowup = 1;
  chainEval(0, X, 0, null);

  for (let k = 0; k <= K; k++) {
    const t = k * Ts;
    const y = sig[1];
    const ym = sig[2] + (noise.std > 0 ? noise.std * rand() : 0);
    const r = refFn(t);
    const v = opts.openLoop ? r : ctrl.step(r, ym);
    let u = v;
    if (limits) u = Math.min(limits.max, Math.max(limits.min, v));
    ctrl?.track(u, v);

    out.t[k] = t; out.r[k] = r; out.y[k] = y; out.u[k] = u; out.v[k] = v; out.ym[k] = ym; out.d[k] = distFn(t); out.e[k] = r - y;
    if (!Number.isFinite(y) || Math.abs(y) > BLOWUP || !Number.isFinite(u)) {
      unstable = true;
      blowup = k / K;
      for (const key in out) if (key !== 't') out[key].fill(NaN, k);
      for (let j = k; j <= K; j++) out.t[j] = j * Ts;
      break;
    }
    if (k === K) break;
    // What the dead times take from t on: u is new here.
    chainEval(t, X, u, null);
    record();

    // Integrate one sample interval with u held.
    for (let s = 0; s < m; s++) {
      const ts = t + s * h;
      chainEval(ts, X, u, k1);
      for (let i = 0; i < N; i++) Xt[i] = X[i] + 0.5 * h * k1[i];
      chainEval(ts + 0.5 * h, Xt, u, k2);
      for (let i = 0; i < N; i++) Xt[i] = X[i] + 0.5 * h * k2[i];
      chainEval(ts + 0.5 * h, Xt, u, k3);
      for (let i = 0; i < N; i++) Xt[i] = X[i] + h * k3[i];
      chainEval(ts + h, Xt, u, k4, true);
      for (let i = 0; i < N; i++) X[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
      chainEval(ts + h, X, u, null);
      // At a sample instant the next u comes first (recorded above).
      if (s < m - 1) record(); else recordLeft();
    }
  }

  return { ...out, info: { h, substeps: m, samples: K + 1, unstable, blowup, limits, warnings } };
}

// Controllers. PID types run a discrete PID with a filtered derivative and
// back-calculation anti-windup; the others run their transfer function on the
// error e = r − y, integrated over each sample with the error held.
function makeController(block, Ts, warnings) {
  const def = blockDef('controller', block.type);
  return def.pid ? makePid(block.params, Ts) : makeTfController(def.tf(block.params), Ts, warnings);
}

function makePid(p, Ts) {
  const Kp = p.Kp ?? 0, Ki = p.Ki ?? 0, Kd = p.Kd ?? 0;
  const Tf = Math.max(p.Tf ?? 0, 0);
  const b = p.b ?? 1, c = p.c ?? 0;
  const Ti = Ki > 0 ? (Kp > 0 ? Kp / Ki : 1 / Ki) : Infinity;
  const Td = Kp > 0 ? Kd / Kp : 0;
  const Tt = Math.max(Ts, Td > 0 ? Math.sqrt(Ti * Td) : 0.5 * Ti);
  let I = 0, D = 0, prevDin = null, lastE = 0;
  return {
    step(r, y) {
      const din = c * r - y;
      if (prevDin === null) prevDin = din;
      D = (Tf * D + Kd * (din - prevDin)) / (Tf + Ts);
      prevDin = din;
      lastE = r - y;
      return Kp * (b * r - y) + I + D;
    },
    track(u, v) {
      if (Ki > 0) I += Ki * Ts * lastE + (Number.isFinite(Tt) ? (Ts / Tt) * (u - v) : 0);
    },
  };
}

function makeTfController(tf, Ts, warnings) {
  const ss = tf2ss(tf.num, tf.den);
  const bound = rootBound(tf.den);
  const m = Math.max(1, Math.ceil(Ts * bound / 0.5));
  const h = Ts / m;
  const n = ss.n;
  const x = new Float64Array(n), xt = new Float64Array(n);
  const k1 = new Float64Array(n), k2 = new Float64Array(n), k3 = new Float64Array(n), k4 = new Float64Array(n);
  const lag = Math.round((Number(tf.delay) || 0) / Ts);
  if (tf.delay > 0 && lag === 0) warnings.push('controller delay is below one sample and was ignored');
  const queue = new Array(lag).fill(0);
  let e = 0;
  const deriv = (xs, dx) => {
    for (let i = 0; i < n; i++) {
      let s = ss.B[i] * e;
      for (let j = 0; j < n; j++) s += ss.A[i * n + j] * xs[j];
      dx[i] = s;
    }
  };
  return {
    step(r, y) {
      e = r - y;
      let v = ss.D * e;
      for (let i = 0; i < n; i++) v += ss.C[i] * x[i];
      for (let s = 0; s < m; s++) {
        deriv(x, k1);
        for (let i = 0; i < n; i++) xt[i] = x[i] + 0.5 * h * k1[i];
        deriv(xt, k2);
        for (let i = 0; i < n; i++) xt[i] = x[i] + 0.5 * h * k2[i];
        deriv(xt, k3);
        for (let i = 0; i < n; i++) xt[i] = x[i] + h * k3[i];
        deriv(xt, k4);
        for (let i = 0; i < n; i++) x[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
      }
      if (lag > 0) { queue.push(v); v = queue.shift(); }
      return v;
    },
    track() {},
  };
}

// Seeded standard-normal generator (mulberry32 + Box–Muller), so a run with
// noise is reproducible.
function gaussian(seed) {
  let a = (Number(seed) >>> 0) || 1;
  const uni = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare = null;
  return () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    const u1 = Math.max(uni(), 1e-12), u2 = uni();
    const rr = Math.sqrt(-2 * Math.log(u1));
    spare = rr * Math.sin(2 * Math.PI * u2);
    return rr * Math.cos(2 * Math.PI * u2);
  };
}

// How simulateSystem steps through one record step T, so every sample instant
// k·Ts of every Controller and Observer is met exactly (with a 2.5 ms record
// and Ts = 1 ms: at 0, 1, 2 … ms, not 0, 1.667, 2.5 …). Two ways, the cheaper
// one is taken:
//   grid   m equal steps, with m a multiple of T/g, g the greatest common
//          divisor of T and every Ts (in whole nanoseconds), so every k·Ts
//          lies on the grid; m is the smallest such multiple at or above
//          T/hmax, the stability bound of the continuous blocks
//   split  m = T/hmax steps (rounded up), and a step that a sample instant
//          falls inside is cut there: integrate to the instant, sample,
//          integrate on. It costs about one extra step per sample
// The grid is taken when it costs no more steps than splitting would (each
// Ts adds at most ceil(T/Ts) cuts per record step). T = 2.5 ms, Ts = 1 ms:
// grid, m = 5. Ts = 1.1 ms (g = 0.1 ms, a grid of 25): split, 2 or 3 steps
// plus the cuts. Returns { m, split }.
const ns = (x) => Math.round(x * 1e9);
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
export function stepPlan(T, bound, sampleTimes = [], K = 1, warnings = []) {
  const hmax = bound > 0 ? 0.5 / bound : T;
  let need = Math.max(1, Math.ceil(T / hmax - 1e-9));
  if (K * need > MAX_STEPS) { need = Math.max(1, Math.floor(MAX_STEPS / K)); warnings.push('stiff system: integration step limited for speed'); }
  if (!sampleTimes.length) return { m: need, split: false };
  let g = ns(T);
  for (const Ts of sampleTimes) g = gcd(g, ns(Ts));
  const base = g > 0 ? ns(T) / g : Infinity;
  const grid = base * Math.ceil(need / base - 1e-9);
  const cuts = sampleTimes.reduce((n, Ts) => n + Math.ceil(T / Ts - 1e-9), 0);
  return grid <= need + cuts && K * grid <= MAX_STEPS ? { m: grid, split: false } : { m: need, split: true };
}
// The integration steps per record step (stepPlan's m).
export const substeps = (...a) => stepPlan(...a).m;

// A time on the decimal grid of whole nanoseconds, where the instants of
// sources and samples are given (r stepping at 1.5 s; k·Ts): what is read at
// the end of a step sees the edge on its new side.
export const onGrid = (t) => Math.round(t * 1e9) / 1e9;

// The diagram as the whole system: every Source plays its signal, every Sink
// is recorded, Controllers and Observers run their variants. Returns
// { t, signals: { name: values }, info }; info.designs is the status of each
// running designed variant, computed through opts.designs (a design store;
// the shared synchronous one by default).
// opts.until: run only to the sample nearest that time (within the window)
// and return the run there as `snapshot` ({ t, X, held, inputs, sources },
// diagram.js el.snapshot), for a model at a moment of the run; null if the
// run diverged before it.
export function simulateSystem(diagram, signals, sim, { designs, until } = {}) {
  const Ts = Number(sim.sampleTime), duration = Number(sim.duration);
  let K = Math.min(Math.round(duration / Ts), MAX_SAMPLES);
  if (until !== undefined) {
    if (!(Number(until) >= 0)) throw new Error('until: a time of the run, at least 0 s');
    K = Math.min(K, Math.round(Number(until) / Ts));
  }
  const sources = Object.fromEntries(Object.entries(signals).map(([name, ref]) => [name, referenceFn(ref, { sampleTime: Ts })]));
  const el = compileDiagram(diagram, 'plant', { sources, standalone: true, designs });
  const warnings = [...el.warnings];
  const { m, split } = stepPlan(Ts, el.bound, el.sampleTimes, K, warnings);
  const h = Ts / m, N = el.n;
  el.setStep(h);
  const X = new Float64Array(N), Xt = new Float64Array(N);
  el.init(X, 0);
  const k1 = new Float64Array(N), k2 = new Float64Array(N), k3 = new Float64Array(N), k4 = new Float64Array(N);
  // One RK4 step of length dt from ts.
  const rk4 = (ts, dt) => {
    el.eval(ts, X, 0, 0, k1);
    for (let i = 0; i < N; i++) Xt[i] = X[i] + 0.5 * dt * k1[i];
    el.eval(ts + 0.5 * dt, Xt, 0, 0, k2);
    for (let i = 0; i < N; i++) Xt[i] = X[i] + 0.5 * dt * k2[i];
    el.eval(ts + 0.5 * dt, Xt, 0, 0, k3);
    for (let i = 0; i < N; i++) Xt[i] = X[i] + dt * k3[i];
    el.eval(ts + dt, Xt, 0, 0, k4, true);
    for (let i = 0; i < N; i++) X[i] += (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  };
  const t = new Float64Array(K + 1);
  const out = {};
  el.eval(0, X, 0, 0, null);
  el.sample(0, X, 0, 0);
  el.record();
  let unstable = false, steps = 0;
  for (let k = 0; k <= K; k++) {
    t[k] = k * Ts;
    for (const [name, v] of el.probes()) {
      (out[name] ??= new Float64Array(K + 1).fill(NaN))[k] = v;
      if (!Number.isFinite(v) || Math.abs(v) > BLOWUP) unstable = true;
    }
    if (unstable) { for (let j = k; j <= K; j++) t[j] = j * Ts; warnings.push('a signal diverged; the rest is not drawn'); break; }
    if (k === K) break;
    for (let s = 0; s < m; s++) {
      const ts = t[k] + s * h, te = onGrid(t[k] + (s + 1) * h);
      let a = ts;
      // A sample instant inside this step: integrate to it and sample there.
      if (split) {
        for (let tn = onGrid(el.nextSample()); tn < te - 1e-9; tn = onGrid(el.nextSample())) {
          if (tn > a) { rk4(a, tn - a); a = tn; steps++; }
          el.eval(tn, X, 0, 0, null);
          el.sample(tn, X, 0, 0);
        }
      }
      rk4(a, ts + h - a);
      steps++;
      el.eval(te, X, 0, 0, null);
      el.recordLeft();
      el.sample(te, X, 0, 0);
      el.record();
    }
  }
  const res = { t, signals: out, info: { h, substeps: m, split, steps, unstable, warnings, designs: el.designs } };
  if (until !== undefined) res.snapshot = unstable ? null : el.snapshot(K * Ts, X);
  return res;
}
