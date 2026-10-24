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

const MAX_SAMPLES = 200000;
const MAX_STEPS = 400000;
const BLOWUP = 1e8;

export function simulate(loop, sim) {
  const duration = Number(sim.duration);
  const Ts = Number(sim.sampleTime);
  if (!(duration > 0)) throw new Error('sim.duration must be > 0');
  if (!(Ts > 0)) throw new Error('sim.sampleTime must be > 0');
  for (const s of SLOTS) if (!loop[s.key]) throw new Error(`loop is missing slot "${s.key}"`);

  const warnings = [];
  const K = Math.min(Math.round(duration / Ts), MAX_SAMPLES);
  if (K < Math.round(duration / Ts)) warnings.push(`sample count capped at ${MAX_SAMPLES}; increase sampleTime`);

  const refFn = blockDef('reference', loop.reference.type).signal(loop.reference.params);
  const distFn = blockDef('disturbance', loop.disturbance.type).signal(loop.disturbance.params);
  const actDef = blockDef('actuator', loop.actuator.type);
  const limits = actDef.limits ? actDef.limits(loop.actuator.params) : null;
  const noise = blockDef('noise', loop.noise.type).noise(loop.noise.params);

  // Continuous chain: actuator, plant, sensor.
  const chainTfs = ['actuator', 'plant', 'sensor'].map((slot) => blockDef(slot, loop[slot].type).tf(loop[slot].params));
  let bound = 0;
  for (const tf of chainTfs) bound = Math.max(bound, rootBound(tf.den));
  const hmax = bound > 0 ? 0.5 / bound : Ts;
  let m = Math.max(1, Math.ceil(Ts / hmax - 1e-9));
  if (K * m > MAX_STEPS) {
    m = Math.max(1, Math.floor(MAX_STEPS / K));
    warnings.push('stiff system: integration step limited for speed; results may be inaccurate');
  }
  const h = Ts / m;
  const totalSteps = K * m;

  const elems = [];
  let N = 0;
  for (const tf of chainTfs) {
    const ss = tf2ss(tf.num, tf.den);
    const delay = Number(tf.delay) || 0;
    elems.push({ ss, off: N, delay, hist: delay > 0 ? new Float64Array(totalSteps + 1) : null });
    N += ss.n;
  }
  let histCount = 0;
  const rawIn = new Float64Array(3);
  const sig = new Float64Array(3);

  function histAt(hist, tau) {
    if (tau < 0) return 0;
    const f = tau / h;
    const i = Math.floor(f);
    if (i >= histCount - 1) return hist[histCount - 1];
    const w = f - i;
    return hist[i] * (1 - w) + hist[i + 1] * w;
  }

  // Evaluates the chain at time t: fills dX (if given), sig (element outputs)
  // and rawIn (undelayed element inputs).
  function chainEval(t, X, u, dX) {
    let input = u;
    for (let e = 0; e < 3; e++) {
      if (e === 1) input += distFn(t);
      const el = elems[e];
      rawIn[e] = input;
      const inp = el.delay > 0 ? histAt(el.hist, t - el.delay) : input;
      const { n, A, B, C, D } = el.ss;
      const o = el.off;
      let out = D * inp;
      for (let i = 0; i < n; i++) out += C[i] * X[o + i];
      if (dX) {
        for (let i = 0; i < n; i++) {
          let s = B[i] * inp;
          for (let j = 0; j < n; j++) s += A[i * n + j] * X[o + j];
          dX[o + i] = s;
        }
      }
      sig[e] = out;
      input = out;
    }
  }

  function record() {
    for (let e = 0; e < 3; e++) if (elems[e].hist) elems[e].hist[histCount] = rawIn[e];
    histCount++;
  }

  const ctrl = makeController(loop.controller, Ts, warnings);
  const rand = gaussian(noise.seed);

  const X = new Float64Array(N);
  const Xt = new Float64Array(N);
  const k1 = new Float64Array(N), k2 = new Float64Array(N), k3 = new Float64Array(N), k4 = new Float64Array(N);

  const out = {
    t: new Float64Array(K + 1), r: new Float64Array(K + 1), y: new Float64Array(K + 1), u: new Float64Array(K + 1),
    v: new Float64Array(K + 1), ym: new Float64Array(K + 1), d: new Float64Array(K + 1), e: new Float64Array(K + 1),
  };

  let unstable = false;
  let blowup = 1;
  chainEval(0, X, 0, null);
  record();

  for (let k = 0; k <= K; k++) {
    const t = k * Ts;
    const y = sig[1];
    const ym = sig[2] + (noise.std > 0 ? noise.std * rand() : 0);
    const r = refFn(t);
    const v = ctrl.step(r, ym);
    let u = v;
    if (limits) u = Math.min(limits.max, Math.max(limits.min, v));
    ctrl.track(u, v);

    out.t[k] = t; out.r[k] = r; out.y[k] = y; out.u[k] = u; out.v[k] = v; out.ym[k] = ym; out.d[k] = distFn(t); out.e[k] = r - y;
    if (!Number.isFinite(y) || Math.abs(y) > BLOWUP || !Number.isFinite(u)) {
      unstable = true;
      blowup = k / K;
      for (const key in out) if (key !== 't') out[key].fill(NaN, k);
      for (let j = k; j <= K; j++) out.t[j] = j * Ts;
      break;
    }
    if (k === K) break;

    // Integrate one sample interval with u held.
    for (let s = 0; s < m; s++) {
      const ts = t + s * h;
      chainEval(ts, X, u, k1);
      for (let i = 0; i < N; i++) Xt[i] = X[i] + 0.5 * h * k1[i];
      chainEval(ts + 0.5 * h, Xt, u, k2);
      for (let i = 0; i < N; i++) Xt[i] = X[i] + 0.5 * h * k2[i];
      chainEval(ts + 0.5 * h, Xt, u, k3);
      for (let i = 0; i < N; i++) Xt[i] = X[i] + h * k3[i];
      chainEval(ts + h, Xt, u, k4);
      for (let i = 0; i < N; i++) X[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
      chainEval(ts + h, X, u, null);
      record();
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
