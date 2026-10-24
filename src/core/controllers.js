// The controller library: implementations a Controller block can run. Every
// implementation has the same interface, so a block can hold several of them
// as variants and switch between them (as Simulink's variant subsystems):
//
//   inputs  [r, y1, y2, …]   the reference first, then the measurements
//   output  u                held between samples (zero-order hold)
//
// Each runs digitally at the block's sample time Ts. make(params, Ts) returns
// { step(inputs) -> u }, called once per sample with the inputs at that instant.
// A law reads its parameters at every step, so an edit while running (Live
// mode changes the params object in place) takes effect at the next sample
// and the law keeps its state; only u0, the integral at the start, waits for
// the next start.
//
// A law that is linear about an operating point also has linear(params, Ts, at)
// for the Analysis tab: its discrete state space { A, B, C, D } (arrays of
// rows) from [r, y1 … ym] to u at Ts, valid while u is inside its limits.
// at.y holds the measurements at the operating point. The prefilter on r lies
// outside the loop and is left out. It throws when the law is not linear there.

const num = (key, label, def, extra = {}) => ({ key, label, default: def, ...extra });
const vec = (key, label, def, extra = {}) => ({ key, label, default: def, kind: 'vector', ...extra });
const LIMITS = [num('umin', 'u min', -Infinity, { unit: 'u' }), num('umax', 'u max', Infinity, { unit: 'u' })];
const PREFILTER = num('Tr', 'Prefilter Tr', 0, { unit: 's', min: 0, help: 'Vorfilter: a first-order lag on r; 0 is off' });
const START = num('u0', 'Start output u0', 0, { unit: 'u', help: 'the integral part at t = 0, so a loop can start in balance' });

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

// A first-order prefilter on the reference (Vorfilter), exact for a held input.
// It reads p.Tr at every sample, so a change made while running (Live mode)
// takes effect at the next one and the filtered value carries on.
function prefilter(p, Ts) {
  let rf = null, Tr = null, a = 0;
  return (r) => {
    if (!(p.Tr > 0)) { rf = r; return r; }
    if (p.Tr !== Tr) { Tr = p.Tr; a = Math.exp(-Ts / Tr); }
    rf = rf === null ? r : a * rf + (1 - a) * r;
    return rf;
  };
}

// Linear interpolation in a table, held flat beyond its ends.
function lookup(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1]);
  return ys[ys.length - 1];
}

// A PI(D) step shared by the fixed and the scheduled controller: derivative on
// the measurement (filtered), setpoint weight b on the P part, integration
// stopped while the output is saturated and the error would push it further.
function pidCore(Ts, u0 = 0) {
  let I = u0, D = 0, yPrev = null;
  return (rf, y, g) => {
    if (yPrev === null) yPrev = y;
    D = (g.Tf * D - g.Kd * (y - yPrev)) / (g.Tf + Ts);
    yPrev = y;
    const e = rf - y;
    const v = g.Kp * (g.b * rf - y) + I + D;
    const u = clamp(v, g.umin, g.umax);
    if (u === v || Math.sign(e) !== Math.sign(v - u)) I += g.Ki * Ts * e;
    return u;
  };
}

// pidCore's linear model with the gains g, for m measurements (only y1 is
// used). States: the integral I (when Ki ≠ 0); the filtered derivative D and
// the previous measurement (when Kd ≠ 0).
function pidLinear(g, Ts, m = 1) {
  const pad = (row) => [...row, ...new Array(m + 1 - row.length).fill(0)];
  const A = [], B = [], C = [], D = [pad([g.Kp * g.b, -g.Kp])];
  if (g.Ki) { A.push([1]); B.push(pad([g.Ki * Ts, -g.Ki * Ts])); C.push(1); }
  if (g.Kd) {
    const c = 1 / (g.Tf + Ts), i = A.length;
    for (const row of A) row.push(0, 0);
    A.push([...new Array(i).fill(0), g.Tf * c, g.Kd * c], new Array(i + 2).fill(0));
    B.push(pad([0, -g.Kd * c]), pad([0, 1]));
    C.push(g.Tf * c, g.Kd * c);
    D[0][1] -= g.Kd * c;
  }
  return { A, B, C: [C], D };
}
// A static law u = kr r − K · y.
const staticLinear = (kr, K) => ({ A: [], B: [], C: [[]], D: [[kr, ...K.map((k) => -k)]] });

export const CONTROLLERS = {
  off: {
    label: 'Off', summary: 'u = 0', params: [],
    make: () => ({ step: () => 0 }),
    linear: (p, Ts, at) => staticLinear(0, new Array(at?.y?.length || 1).fill(0)),
  },
  pid: {
    label: 'PID', summary: 'u = Kp e + Ki ∫e + Kd ė',
    params: [num('Kp', 'Kp', 1), num('Ki', 'Ki', 0), num('Kd', 'Kd', 0), num('Tf', 'D filter Tf', 0.01, { unit: 's', min: 0 }), num('b', 'Setpoint weight b', 1), PREFILTER, START, ...LIMITS],
    make(p, Ts) {
      const pre = prefilter(p, Ts), core = pidCore(Ts, p.u0);
      return { step: (x) => core(pre(x[0]), x[1] ?? 0, p) };
    },
    linear: (p, Ts, at) => pidLinear(p, Ts, at?.y?.length || 1),
  },
  stateFeedback: {
    label: 'State feedback', summary: 'u = kr r − K · y',
    params: [vec('K', 'Gains K', [1]), num('kr', 'Prefilter kr', 1), PREFILTER, ...LIMITS],
    make(p, Ts) {
      const pre = prefilter(p, Ts);
      return {
        step(x) {
          let u = p.kr * pre(x[0]);
          for (let i = 0; i < p.K.length; i++) u -= p.K[i] * (x[i + 1] ?? 0);
          return clamp(u, p.umin, p.umax);
        },
      };
    },
    linear: (p) => staticLinear(p.kr, p.K),
  },
  gainScheduled: {
    label: 'Gain-scheduled PI', summary: 'PI with Kp, Ki looked up from y',
    params: [vec('at', 'At y =', [0, 1]), vec('Kp', 'Kp', [1, 1]), vec('Ki', 'Ki', [0, 0]), PREFILTER, START, ...LIMITS],
    check(p) { if (p.Kp.length !== p.at.length || p.Ki.length !== p.at.length) return 'At, Kp and Ki need the same number of values'; if (p.at.some((v, i) => i && v <= p.at[i - 1])) return 'the At values must increase'; return ''; },
    make(p, Ts) {
      const pre = prefilter(p, Ts), core = pidCore(Ts, p.u0);
      const g = { Kp: 0, Ki: 0, Kd: 0, Tf: 0, b: 1, umin: p.umin, umax: p.umax };
      return {
        step(x) {
          const y = x[1] ?? 0;
          g.Kp = lookup(p.at, p.Kp, y); g.Ki = lookup(p.at, p.Ki, y);
          g.umin = p.umin; g.umax = p.umax;
          return core(pre(x[0]), y, g);
        },
      };
    },
    // At rest (r = y) the slope of the schedule multiplies a zero error, so the
    // loop sees a PI with the gains at y.
    linear(p, Ts, at) {
      const y = at?.y?.[0] ?? p.at[0];
      return pidLinear({ Kp: lookup(p.at, p.Kp, y), Ki: lookup(p.at, p.Ki, y), Kd: 0, Tf: 0, b: 1 }, Ts, at?.y?.length || 1);
    },
  },
  swingUp: {
    // For a pendulum on a cart, inputs r, x, θ, v, ω (θ = 0 upright). Far from
    // upright it pumps energy: with E = ½ l² ω² + g l (cos θ − 1), zero at the
    // top, the push u = kE · E · ω · cos θ makes V = ½ E² fall (a Lyapunov
    // function), so each swing climbs higher, while kx, kv pull the cart back to the
    // middle. Near the top (|θ| < θs) it
    // catches the pole with state feedback u = kr r − K · [x, θ, v, ω].
    label: 'Swing-up (Lyapunov) + state feedback', summary: 'energy pumping, then u = kr r − K · y',
    params: [num('kE', 'Energy gain kE', 1), num('kx', 'Centring kx', 0), num('kv', 'Centring kv', 0), num('l', 'Pole length l', 0.5, { unit: 'm', min: 1e-6 }), num('g', 'g', 9.81, { unit: 'm/s²' }), num('thetaS', 'Catch below θs', 0.4, { unit: 'rad', min: 0 }), vec('K', 'Gains K', [-1, -30, -2, -5]), num('kr', 'Prefilter kr', -1), ...LIMITS],
    make(p) {
      let caught = false;
      return {
        step([r, x = 0, th = 0, v = 0, w = 0]) {
          const tw = wrap(th);
          if (Math.abs(tw) < p.thetaS) caught = true;
          else if (Math.abs(tw) > 2 * p.thetaS) caught = false;
          if (caught) {
            const y = [x, tw, v, w];
            let u = p.kr * r;
            for (let i = 0; i < p.K.length; i++) u -= p.K[i] * y[i];
            return clamp(u, p.umin, p.umax);
          }
          const E = 0.5 * p.l * p.l * w * w + p.g * p.l * (Math.cos(tw) - 1);
          // A pole hanging still has no swing to pump: give it a start.
          const pump = Math.abs(w) < 1e-3 && Math.abs(Math.cos(tw) + 1) < 1e-3 ? 1 : p.kE * E * w * Math.cos(tw);
          return clamp(pump - p.kx * x - p.kv * v, p.umin, p.umax);
        },
      };
    },
    // Linear only where it catches: state feedback on [x, θ, v, ω].
    linear(p, Ts, at) {
      const th = wrap(at?.y?.[1] ?? 0);
      if (Math.abs(th) >= p.thetaS) throw new Error(`the swing-up pumps energy at θ = ${th.toFixed(2)} rad; it is a linear loop only where it catches (|θ| < ${p.thetaS} rad)`);
      return staticLinear(p.kr, p.K);
    },
  },
  relay: {
    // On/off control: u0 + d while the error is positive, u0 − d while it is
    // negative, switching only once e passes ±ε (hysteresis), so a noisy
    // measurement cannot make it chatter. Auto-tune's relay experiment
    // (Åström–Hägglund) runs one to find Ku and Pu. A negative d reverses it,
    // for a plant whose y falls when u rises.
    label: 'Relay (on/off)', summary: 'u = u0 ± d by the sign of e, hysteresis ε',
    params: [num('d', 'Amplitude d', 1, { unit: 'u', help: 'negative for a plant whose y falls when u rises' }), num('eps', 'Hysteresis ε', 0, { min: 0, help: 'switches when e = r − y passes +ε or −ε' }), num('u0', 'Bias u0', 0, { unit: 'u' }), ...LIMITS],
    make(p) {
      let high = null;
      return {
        step(x) {
          const e = x[0] - (x[1] ?? 0);
          if (high === null) high = e >= 0;
          if (e > p.eps) high = true;
          else if (e < -p.eps) high = false;
          return clamp(p.u0 + (high ? p.d : -p.d), p.umin, p.umax);
        },
      };
    },
    linear() { throw new Error('a relay switches between two outputs: it has no linear model'); },
  },
  slidingMode: {
    // First-order sliding mode, model-free (Utkin 1977; Slotine & Li ch. 7),
    // for a plant whose output rises with u. Inputs r, y, ẏ. The sliding
    // variable s = λ·e + ė (e = r − y, in y's unit per second) is driven to
    // zero; on s = 0 the error decays as e^(−λt), whatever the inertia or a
    // load entering with u, while K dominates them. φ = 0 is the ideal relay
    // u = u0 + K·sign(s); φ > 0 is a boundary layer, u = u0 + K·sat(s/φ):
    // inside it a PD with Kp = K·λ/φ and Kd = K/φ, outside the relay.
    // ė = ṙf − ẏ, with ṙf the prefilter's own derivative (r − rf)/Tr, 0 without
    // a prefilter (derivative on the measurement): the law never differentiates.
    label: 'Sliding mode', summary: 'u = u0 + K·sign(s) or K·sat(s/φ), s = λe + ė',
    params: [
      num('lambda', 'Surface slope λ', 10, { unit: '1/s', min: 0, help: 'on the line s = 0 the error decays as e^(−λt): λ sets its time constant 1/λ' }),
      num('K', 'Switching gain K', 1, { unit: 'u', help: 'negative for a plant whose y falls when u rises' }),
      num('phi', 'Boundary layer φ', 0, { unit: 'y/s', min: 0, help: '0 is the ideal relay; above 0, proportional inside |s| < φ' }),
      PREFILTER, num('u0', 'Bias u0', 0, { unit: 'u' }), ...LIMITS,
    ],
    check: needsRate,
    make(p, Ts) {
      const surf = surface(p, Ts);
      return {
        step(x) {
          const s = surf(x);
          const sw = p.phi > 0 ? clamp(s / p.phi, -1, 1) : Math.sign(s);
          return clamp(p.u0 + p.K * sw, p.umin, p.umax);
        },
      };
    },
    // Inside the layer and the limits, with the prefilter left out (ṙf = 0):
    // no state, u = (K·λ/φ)·(r − y) − (K/φ)·ẏ.
    linear(p, Ts, at) {
      if (!(p.phi > 0)) throw new Error('an ideal sliding mode switches: it has no linear model; give it a boundary layer φ > 0');
      const m = Math.max(2, at?.y?.length ?? 2);
      return staticLinear((p.K * p.lambda) / p.phi, [(p.K * p.lambda) / p.phi, p.K / p.phi, ...new Array(m - 2).fill(0)]);
    },
  },
  superTwisting: {
    // Super-twisting (Levant 1993), a second-order sliding mode on the same s:
    // u = k1·√|s|·sign(s) + v, with v the integral part, v += Ts·k2·sign(s)
    // (explicit Euler). u is continuous, and v rejects a slowly varying load.
    // Both u and v are clamped to the limits (v's clamp is the anti-windup).
    // The sign is flipped from Levant's form because raising u lowers s here.
    label: 'Super-twisting', summary: 'u = k1·√|s|·sign(s) + v, v̇ = k2·sign(s)',
    params: [
      num('lambda', 'Surface slope λ', 10, { unit: '1/s', min: 0, help: 'on the line s = 0 the error decays as e^(−λt): λ sets its time constant 1/λ' }),
      num('k1', 'Gain k1', 1, { unit: 'u per √(y/s)', help: 'negative for a plant whose y falls when u rises' }),
      num('k2', 'Gain k2', 10, { unit: 'u/s', help: 'the rate of the integral part v; negative for a plant whose y falls when u rises' }),
      PREFILTER, START, ...LIMITS,
    ],
    check: needsRate,
    make(p, Ts) {
      const surf = surface(p, Ts);
      let v = clamp(p.u0, p.umin, p.umax);
      return {
        step(x) {
          const s = surf(x), sg = Math.sign(s);
          const u = clamp(p.k1 * Math.sqrt(Math.abs(s)) * sg + v, p.umin, p.umax);
          v = clamp(v + Ts * p.k2 * sg, p.umin, p.umax);
          return u;
        },
      };
    },
    linear() { throw new Error('super-twisting has no linear model: √|s| has infinite slope at s = 0'); },
  },
};

// The sliding variable s = λ·e + ė of both sliding-mode laws, from the inputs
// [r, y, ẏ]: e = rf − y and ė = ṙf − ẏ, with rf the prefiltered reference and
// ṙf = (r − rf)/Tr its exact derivative (the filter's own state; 0 when Tr = 0).
function surface(p, Ts) {
  const pre = prefilter(p, Ts);
  return (x) => {
    const r = x[0], rf = pre(r);
    const rdot = p.Tr > 0 ? (r - rf) / p.Tr : 0;
    return p.lambda * (rf - (x[1] ?? 0)) + rdot - (x[2] ?? 0);
  };
}
// A sliding-mode law reads ẏ on input 3; it never differentiates y itself.
function needsRate(p, ctx) {
  return ctx?.inputs !== undefined && ctx.inputs < 3 ? 'sliding mode needs ẏ on input 3; to make it from y, place a Finite difference observer in the diagram' : '';
}

export const CONTROLLER_TYPES = Object.keys(CONTROLLERS);

function normalizeParam(spec, v, where) {
  v ??= spec.default;
  if (spec.kind === 'vector') {
    if (!Array.isArray(v) || !v.length || !v.every((x) => Number.isFinite(Number(x)))) throw new Error(`${where}.${spec.key}: a list of numbers`);
    return v.map(Number);
  }
  if (v === null || v === '' || v === 'inf' || v === 'Infinity' || v === '-inf' || v === '-Infinity') return v && String(v).startsWith('-') ? -Infinity : spec.default;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`${where}.${spec.key}: expected a number`);
  if (spec.min !== undefined && n < spec.min) throw new Error(`${where}.${spec.key}: at least ${spec.min}`);
  return n;
}

// One variant: { name, type, params }. Unknown types and bad values fail with
// the valid choices named.
// lib: the library the variant comes from (CONTROLLERS, or OBSERVERS for an
// Observer block); both share this format. ctx: what the block gives the
// variant ({ inputs }), when known, for checks that need it.
export function normalizeVariant(v, where = 'variant', lib = CONTROLLERS, ctx = undefined) {
  const def = lib[v?.type];
  if (!def) throw new Error(`${where}.type: one of ${Object.keys(lib).join(', ')}`);
  const params = {};
  for (const spec of def.params) params[spec.key] = normalizeParam(spec, v.params?.[spec.key], where);
  if (params.umin > params.umax) [params.umin, params.umax] = [params.umax, params.umin];
  const bad = def.check?.(params, ctx);
  if (bad) throw new Error(`${where}: ${bad}`);
  return { name: String(v.name ?? def.label).slice(0, 40), type: v.type, params };
}

// The law of a block's active variant. Normalised first: a project restored
// from JSON (undo, redo) has its open limits as null, not ±Infinity. Params
// already in normal form are used as they are, so an edit of them while the
// law runs (Live mode) reaches it.
const same = (a, b) => (Array.isArray(b) ? Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]) : a === b);
export function makeLaw(variant, Ts, lib = CONTROLLERS) {
  const { params } = normalizeVariant(variant, 'variant', lib);
  const keep = variant.params && Object.keys(params).every((k) => same(variant.params[k], params[k]));
  return lib[variant.type].make(keep ? variant.params : params, Ts);
}

