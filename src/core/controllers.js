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
// outside the loop and is left out of A, B, C, D; the model carries its time
// constant as Tr, so a step response can feed r through it as the law does.
// The reference feedforward is in r's column. Anti-windup acts only at a
// limit, so it is not in the model. It throws when the law is not linear
// there.

const num = (key, label, def, extra = {}) => ({ key, label, default: def, ...extra });
const vec = (key, label, def, extra = {}) => ({ key, label, default: def, kind: 'vector', ...extra });
const LIMITS = [num('umin', 'u min', -Infinity, { unit: 'u' }), num('umax', 'u max', Infinity, { unit: 'u' })];
const PREFILTER = num('Tr', 'Prefilter Tr', 0, { unit: 's', min: 0, help: 'Vorfilter: a first-order lag on r; 0 is off' });
const START = num('u0', 'Start output u0', 0, { unit: 'u', help: 'the integral part at t = 0, so a loop can start in balance' });
// Reference feedforward: terms of u computed from the prefiltered reference
// rf alone, outside the loop. 0 is off.
const FEEDFORWARD = [
  num('Kff', 'Feedforward Kff', 0, { unit: 'u per r', help: 'static feedforward: u += Kff · rf; the input that holds y at r, per unit of r' }),
  num('Kv', 'Velocity FF Kv', 0, { unit: 'u per r/s', help: 'velocity feedforward: u += Kv · drf/dt' }),
  num('Ka', 'Acceleration FF Ka', 0, { unit: 'u per r/s²', help: 'acceleration feedforward: u += Ka · d²rf/dt²' }),
];
// Anti-windup: what the integral does while u sits at a limit.
export const ANTI_WINDUP = { clamp: 'clamping', back: 'back-calculation', off: 'off (windup)' };
const WINDUP = [
  { key: 'aw', label: 'Anti-windup', default: 'clamp', kind: 'choice', options: ANTI_WINDUP, help: 'clamping: the integral stops at a limit; back-calculation: it is pulled back with time constant Tt; off: it winds up' },
  num('Tt', 'Tracking Tt', 0, { unit: 's', min: 0, help: 'back-calculation only: how fast the integral follows the limit; 0: √(Ti·Td), or Ti/2 without D' }),
];
// What the scheduled PI passes on to pidCore unchanged, read at every sample.
const SHARED = ['Kff', 'Kv', 'Ka', 'aw', 'Tt', 'umin', 'umax'];

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

// The tracking time constant of back-calculation: Tt when given, else the
// rule of thumb of Åström and Hägglund, Tt = √(Ti·Td) (between Td and Ti),
// and Ti/2 for a PI, with Ti = Kp/Ki and Td = Kd/Kp; never below Ts.
export function trackingTime(g, Ts) {
  if (g.Tt > 0) return g.Tt;
  const Ti = Math.abs(g.Kp / g.Ki), Td = Math.abs(g.Kd / g.Kp);
  const t = Td > 0 ? Math.sqrt(Ti * Td) : Ti / 2;
  return Number.isFinite(t) && t > Ts ? t : Ts;
}

// A PI(D) step shared by the fixed and the scheduled controller, on the
// prefiltered reference rf and the measurement y:
//   P   Kp (b·rf − y)              setpoint weight b on the P part
//   I   Ki ∫ (rf − y)              starting at u0
//   D   −Kd dy/dt, filtered (Tf)   on the measurement: a step of r gives no kick
//   FF  Kff·rf + Kv·drf/dt + Ka·d²rf/dt², by differences over Ts. Before
//       the first sample rf is taken to have rested at its first value, so
//       the first sample puts out no kick
// v = P + I + D + FF; u is v held to [umin, umax]. While u sits at a limit
// the anti-windup (g.aw) keeps the integral from running away:
//   clamp  conditional integration: it stops while the error would push u further
//   back   back-calculation: dI/dt = Ki·e + (u − v)/Tt, so I tracks the limit.
//          The feedforward's own excess beyond a limit (a kick as r starts
//          to move) is left out of (u − v): the integral cannot undo it, and
//          tracking it would leave I offset once the kick has passed
//   off    it integrates on (windup)
// The parameters are read at every sample (Live mode edits them in place).
// A change of a feedforward gain while running is bumpless: the integral
// takes the step the new gain would put into u, and lets it go at its own
// pace (only with a Ki; without one there is nothing to carry it).
function pidCore(Ts, u0 = 0) {
  let I = u0, D = 0, yPrev = null, r1 = null, r2 = null;
  let kff = 0, kv = 0, ka = 0;   // the feedforward gains of the sample before
  return (rf, y, g) => {
    const Kff = g.Kff ?? 0, Kv = g.Kv ?? 0, Ka = g.Ka ?? 0;
    if (yPrev === null) { yPrev = y; r1 = r2 = rf; kff = Kff; kv = Kv; ka = Ka; }
    D = (g.Tf * D - g.Kd * (y - yPrev)) / (g.Tf + Ts);
    yPrev = y;
    const ffOf = (a, b, c) => a * rf + (b * (rf - r1)) / Ts + (c * (rf - 2 * r1 + r2)) / (Ts * Ts);
    const ff = ffOf(Kff, Kv, Ka);
    if (g.Ki && (Kff !== kff || Kv !== kv || Ka !== ka)) I -= ff - ffOf(kff, kv, ka);
    kff = Kff; kv = Kv; ka = Ka;
    r2 = r1; r1 = rf;
    const e = rf - y;
    const v = g.Kp * (g.b * rf - y) + I + D + ff;
    const u = clamp(v, g.umin, g.umax);
    if (!g.Ki) return u;
    if (g.aw === 'back') {
      // Tracking, exact for a held excess: I moves by the fraction
      // 1 − e^(−Ts/Tt) of it per sample.
      const vb = v - ff + clamp(ff, g.umin, g.umax);
      I += g.Ki * Ts * e + (1 - Math.exp(-Ts / trackingTime(g, Ts))) * (clamp(vb, g.umin, g.umax) - vb);
    } else if (g.aw === 'off' || u === v || Math.sign(g.Ki * e) !== Math.sign(v - u)) I += g.Ki * Ts * e;
    return u;
  };
}

// pidCore's linear model with the gains g, for m measurements (only y1 is
// used). States, each only when its gain is not 0: the integral I; the
// filtered derivative D and the previous measurement; the reference one and
// two samples back (for Kv and Ka).
function pidLinear(g, Ts, m = 1) {
  const pad = (row) => [...row, ...new Array(m + 1 - row.length).fill(0)];
  const A = [], B = [], C = [], D = [pad([g.Kp * g.b, -g.Kp])];
  // A new state: its input row b and its weight c in u; A's entries are set after.
  const state = (b, c) => { for (const row of A) row.push(0); A.push(new Array(A.length + 1).fill(0)); B.push(pad(b)); C.push(c); return A.length - 1; };
  if (g.Ki) { const i = state([g.Ki * Ts, -g.Ki * Ts], 1); A[i][i] = 1; }
  if (g.Kd) {
    const c = 1 / (g.Tf + Ts);
    const d = state([0, -g.Kd * c], g.Tf * c), p = state([0, 1], g.Kd * c);
    A[d][d] = g.Tf * c; A[d][p] = g.Kd * c;
    D[0][1] -= g.Kd * c;
  }
  // FF = Kff·r + Kv·(r − r1)/Ts + Ka·(r − 2·r1 + r2)/Ts².
  const kv = (g.Kv ?? 0) / Ts, ka = (g.Ka ?? 0) / (Ts * Ts);
  D[0][0] += (g.Kff ?? 0) + kv + ka;
  if (kv || ka) {
    const r1 = state([1], -kv - 2 * ka);
    if (ka) { const r2 = state([0], ka); A[r2][r1] = 1; }
  }
  return { A, B, C: [C], D, Tr: g.Tr ?? 0 };
}
// A static law u = kr r − K · y.
const staticLinear = (kr, K, Tr = 0) => ({ A: [], B: [], C: [[]], D: [[kr, ...K.map((k) => -k)]], Tr });

export const CONTROLLERS = {
  off: {
    label: 'Off', summary: 'u = 0', params: [],
    make: () => ({ step: () => 0 }),
    linear: (p, Ts, at) => staticLinear(0, new Array(at?.y?.length || 1).fill(0)),
  },
  pid: {
    label: 'PID', summary: 'u = Kp e + Ki ∫e + Kd ė',
    params: [num('Kp', 'Kp', 1), num('Ki', 'Ki', 0), num('Kd', 'Kd', 0), num('Tf', 'D filter Tf', 0.01, { unit: 's', min: 0 }), num('b', 'Setpoint weight b', 1, { help: 'weights r in the P part only (two degrees of freedom); not feedforward' }), PREFILTER, ...FEEDFORWARD, START, ...LIMITS, ...WINDUP],
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
    linear: (p) => staticLinear(p.kr, p.K, p.Tr),
  },
  gainScheduled: {
    label: 'Gain-scheduled PI', summary: 'PI with Kp, Ki looked up from y',
    params: [vec('at', 'At y =', [0, 1]), vec('Kp', 'Kp', [1, 1]), vec('Ki', 'Ki', [0, 0]), PREFILTER, ...FEEDFORWARD, START, ...LIMITS, ...WINDUP],
    check(p) { if (p.Kp.length !== p.at.length || p.Ki.length !== p.at.length) return 'At, Kp and Ki need the same number of values'; if (p.at.some((v, i) => i && v <= p.at[i - 1])) return 'the At values must increase'; return ''; },
    make(p, Ts) {
      const pre = prefilter(p, Ts), core = pidCore(Ts, p.u0);
      const g = { Kp: 0, Ki: 0, Kd: 0, Tf: 0, b: 1 };
      return {
        step(x) {
          const y = x[1] ?? 0;
          g.Kp = lookup(p.at, p.Kp, y); g.Ki = lookup(p.at, p.Ki, y);
          // Read at every sample, as the PID reads p: an edit while running counts.
          for (const k of SHARED) g[k] = p[k];
          return core(pre(x[0]), y, g);
        },
      };
    },
    // At rest (r = y) the slope of the schedule multiplies a zero error, so the
    // loop sees a PI with the gains at y.
    linear(p, Ts, at) {
      const y = at?.y?.[0] ?? p.at[0];
      return pidLinear({ Kp: lookup(p.at, p.Kp, y), Ki: lookup(p.at, p.Ki, y), Kd: 0, Tf: 0, b: 1, Tr: p.Tr, Kff: p.Kff, Kv: p.Kv, Ka: p.Ka }, Ts, at?.y?.length || 1);
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
};

export const CONTROLLER_TYPES = Object.keys(CONTROLLERS);

function normalizeParam(spec, v, where) {
  v ??= spec.default;
  if (spec.kind === 'choice') {
    if (!Object.hasOwn(spec.options, v)) throw new Error(`${where}.${spec.key}: one of ${Object.keys(spec.options).join(', ')}`);
    return v;
  }
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
// Observer block); both share this format.
export function normalizeVariant(v, where = 'variant', lib = CONTROLLERS) {
  const def = lib[v?.type];
  if (!def) throw new Error(`${where}.type: one of ${Object.keys(lib).join(', ')}`);
  const params = {};
  for (const spec of def.params) params[spec.key] = normalizeParam(spec, v.params?.[spec.key], where);
  if (params.umin > params.umax) [params.umin, params.umax] = [params.umax, params.umin];
  const bad = def.check?.(params);
  if (bad) throw new Error(`${where}: ${bad}`);
  return { name: String(v.name ?? def.label).slice(0, 40), type: v.type, params };
}

// The law of a block's active variant. Normalised first: a project restored
// from JSON (undo, redo) has its open limits as null, not ±Infinity. Params
// already in normal form are used as they are, so an edit of them while the
// law runs (Live mode) reaches it. An experiment Auto-tune runs
// (src/core/autotune.js: hold r, then step u) brings its own law as a
// function, so it can never come from a file.
const same = (a, b) => (Array.isArray(b) ? Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]) : a === b);
export function makeLaw(variant, Ts, lib = CONTROLLERS) {
  if (typeof variant.law === 'function') return variant.law(Ts);
  const { params } = normalizeVariant(variant, 'variant', lib);
  const keep = variant.params && Object.keys(params).every((k) => same(variant.params[k], params[k]));
  return lib[variant.type].make(keep ? variant.params : params, Ts);
}

