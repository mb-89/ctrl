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
// the next start. (A designed variant's inputs change its design, so Live
// mode rebuilds its law instead: live.js.)
//
// A law that is linear about an operating point also has linear(params, Ts,
// at, values) for the Analysis tab: its discrete state space { A, B, C, D }
// (arrays of rows) from [r, y1 … ym] to u at Ts, valid while u is inside its
// limits. at.y holds the measurements at the operating point, at.t the time
// of the run the law is at (a snapshot; a planned law's gains change with
// it). The prefilter on r lies outside the loop and is left out of A, B, C,
// D; the model carries its time constant as Tr, so a step response can feed
// r through it as the law does. The reference feedforward is in r's column.
// Anti-windup acts only at a limit, so it is not in the model. It throws
// when the law is not linear there. A designed type takes the values its
// design computed, and gives its Copy as numbers twin's model; it may add a
// `note` for the analysis (a plan's gains frozen at one sample).
//
// A designed type computes its numbers from the plant instead of being given
// them (design/output/designs.md). Its params are inputs only (weights,
// levels, limits, and hand gains such as a feedforward); it adds
//   designed: true, version          version enters the cache key; bump it when results change
//   computes: ['K', 'kr']            refused in params: a file never holds computed numbers
//   twin: 'stateFeedback'            the hand type(s) "Copy as numbers" turns it into
//   design(p, ctx)                   → { values, rows, warnings?, quality?, at? }; sees the
//                                    plant only through ctx (design.js), throws DesignError
//   make(p, Ts, values)              the law from plain data; values null → u = 0
//   manual(p, values)                → { type, params } of the twin: Copy as numbers
//   linear(p, Ts, at, values)        the twin's linear model (values null → DesignError 'no-design')
//   compatible?(a, b)                may old values run on a changed plant (the page's store)
// A vector parameter's `per` says what its entries stand for, so the
// Controller tab can name them: 'measurement' (one each) or 'level' (levels
// of the first measurement). `heavy` marks an input that starts a long
// computation (a plan; the tab folds it away), `tune: false` one auto-tune
// leaves alone.

import { lqrDesign, scheduledPIDesign, trajectoryDesign, feedforwardDesign, huLinDesign, speedPIDesign, deadbeatDesign, poleOf } from './design.js';
import { DesignError } from './linearize.js';
import { planLaw } from './planner.js';

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
// The energy pump of the swing-up: hand gains, shared by its two types.
const SWING = [num('kE', 'Energy gain kE', 1), num('kx', 'Centring kx', 0), num('kv', 'Centring kv', 0), num('l', 'Pole length l', 0.5, { unit: 'm', min: 1e-6 }), num('g', 'g', 9.81, { unit: 'm/s²' }), num('thetaS', 'Catch below θs', 0.4, { unit: 'rad', min: 0 })];
// A law that updates every k samples and holds u in between: a longer sample time, k·Ts.
const EVERY = num('every', 'Update every', 1, { int: true, min: 1, tune: false, help: 'u is computed every k samples and held in between: a sample time of k·Ts' });
// The weights of an LQR design.
const WEIGHTS = [
  vec('Q', 'Weights Q', [1], { min: 0, per: 'measurement', help: 'what an error in each measurement costs, one per measurement; one value weighs them all' }),
  num('R', 'Effort weight R', 1, { positive: true, help: 'how much u costs: larger is gentler' }),
];

const and = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list.join(''));
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
    let v = g.Kp * (g.b * rf - y) + I + D + ff;
    if (g.uff) v += g.uff;   // a feedforward input (a Controller's ff group: speedPI)
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


// The law of a designed variant without values (pending, or failed): u = 0.
const OFF = { step: () => 0 };
// A designed law runs as its Copy as numbers twin would, so the copy runs bit for bit alike.
const twinLaw = (twin, Ts) => CONTROLLERS[twin.type].make(normalizeVariant(twin).params, Ts);
// A designed variant with no values has nothing to analyse.
const noDesign = (type) => new DesignError('no-design', `${CONTROLLERS[type].label} has no design to analyse yet`, 'see its Computed box in the Controller tab: the design is pending, cancelled or refused');
// A designed law's linear model is its twin's, made from the values.
function twinLinear(type) {
  return (p, Ts, at, values) => {
    if (!values) throw noDesign(type);
    const twin = CONTROLLERS[type].manual(p, values);
    return CONTROLLERS[twin.type].linear(normalizeVariant(twin).params, Ts, at);
  };
}

export const CONTROLLERS = {
  off: {
    label: 'Off', summary: 'u = 0', params: [],
    make: () => OFF,
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
    params: [vec('K', 'Gains K', [1], { per: 'measurement' }), num('kr', 'Prefilter kr', 1), PREFILTER, EVERY, ...LIMITS],
    make(p, Ts) {
      const pre = prefilter(p, Ts);
      let k = 0, u = 0;
      return {
        step(x) {
          const rf = pre(x[0]);
          if (k++ % (p.every ?? 1)) return u;
          u = p.kr * rf;
          for (let i = 0; i < p.K.length; i++) u -= p.K[i] * (x[i + 1] ?? 0);
          u = clamp(u, p.umin, p.umax);
          return u;
        },
      };
    },
    // Updated every k samples, the law is linear at k·Ts (it reads y only
    // then), so the loop is analysed there.
    linear: (p, Ts) => (p.every > 1 ? { ...staticLinear(p.kr, p.K, p.Tr), Ts: p.every * Ts, note: `the law updates every ${p.every} samples: the loop is analysed at ${p.every} × Ts` } : staticLinear(p.kr, p.K, p.Tr)),
  },
  lqr: {
    // Discrete LQR at the origin of the plant the block sees, which must be an
    // equilibrium with every state measured (design.js, lqrDesign).
    label: 'LQR', summary: 'u = kr r − K · y, K from the plant (LQR)',
    designed: true, version: 1, computes: ['K', 'kr'], twin: 'stateFeedback',
    params: [...WEIGHTS, num('track', 'r applies to', 1, { int: true, min: 0, help: 'the measurement (1, 2, …) that follows r; 0: none' }), PREFILTER, ...LIMITS],
    design(p, ctx) {
      const d = lqrDesign(ctx.linearize('origin'), { Q: p.Q, R: p.R, track: p.track, Ts: ctx.Ts });
      return { values: { K: d.K, kr: d.kr }, rows: d.rows, warnings: d.warnings };
    },
    make(p, Ts, values) {
      if (!values) return OFF;
      return CONTROLLERS.stateFeedback.make({ K: values.K, kr: values.kr, Tr: p.Tr, umin: p.umin, umax: p.umax }, Ts);
    },
    manual: (p, values) => ({ type: 'stateFeedback', params: { K: [...values.K], kr: values.kr, Tr: p.Tr, umin: p.umin, umax: p.umax } }),
    linear: twinLinear('lqr'),
  },
  deadbeat: {
    // State feedback with every pole of the loop at z = 0, at the sample time
    // k·Ts (design.js, deadbeatDesign): from rest, a step of r is followed in
    // n samples exactly, n the plant's states; every state measured.
    label: 'Deadbeat', summary: 'u = kr r − K · y, every pole at z = 0: settles in n samples',
    designed: true, version: 1, computes: ['K', 'kr'], twin: 'stateFeedback',
    params: [{ ...EVERY, help: 'the deadbeat runs at k·Ts and settles in n of those samples (n states); longer asks less of u' }, num('track', 'r applies to', 1, { int: true, min: 0, help: 'the measurement (1, 2, …) that follows r; 0: none' }), PREFILTER, ...LIMITS],
    design(p, ctx) {
      const d = deadbeatDesign(ctx.linearize('origin'), { track: p.track, Ts: (p.every ?? 1) * ctx.Ts, umin: p.umin, umax: p.umax });
      return { values: { K: d.K, kr: d.kr }, rows: d.rows, warnings: d.warnings };
    },
    make(p, Ts, values) {
      if (!values) return OFF;
      return CONTROLLERS.stateFeedback.make(CONTROLLERS.deadbeat.manual(p, values).params, Ts);
    },
    manual: (p, values) => ({ type: 'stateFeedback', params: { K: [...values.K], kr: values.kr, Tr: p.Tr, every: p.every, umin: p.umin, umax: p.umax } }),
    linear: twinLinear('deadbeat'),
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
  scheduledPI: {
    // A PI by pole cancellation, from the plant this block sees: at each
    // level of the first measurement the plant is trimmed, linearised and
    // fitted as K e^(−θs) / (τs + 1), and Kp = τ / (K Tcl), Ki = 1 / (K Tcl)
    // make the loop a first-order lag with time constant Tcl (design.js).
    // One level gives a fixed PI; several, a gain-scheduled one. u0 holds the
    // level the plant starts at. The reference feedforward and the
    // anti-windup are hand inputs, passed on to the PI as they are.
    label: 'PI from the plant', summary: 'PI by pole cancellation at levels of y',
    designed: true, version: 1, computes: ['Kp', 'Ki', 'u0'], twin: ['pid', 'gainScheduled'],
    params: [vec('at', 'At y =', [1], { per: 'level', help: 'the levels of the first measurement to design at; one level gives a fixed PI, several are interpolated' }), num('Tcl', 'Closed loop Tcl', 0.25, { unit: 's', positive: true, help: 'the time constant the loop should have' }), PREFILTER, ...FEEDFORWARD, ...LIMITS, ...WINDUP],
    check(p) { return p.at.some((v, i) => i && v <= p.at[i - 1]) ? 'the At values must increase' : ''; },
    design: (p, ctx) => scheduledPIDesign(p, ctx),
    make(p, Ts, values) { return values ? twinLaw(CONTROLLERS.scheduledPI.manual(p, values), Ts) : OFF; },
    manual(p, values) {
      const common = { Tr: p.Tr, Kff: p.Kff, Kv: p.Kv, Ka: p.Ka, u0: values.u0, umin: p.umin, umax: p.umax, aw: p.aw, Tt: p.Tt };
      return values.at.length === 1
        ? { type: 'pid', params: { Kp: values.Kp[0], Ki: values.Ki[0], Kd: 0, ...common } }
        : { type: 'gainScheduled', params: { at: [...values.at], Kp: [...values.Kp], Ki: [...values.Ki], ...common } };
    },
    linear: twinLinear('scheduledPI'),
  },
  speedPI: {
    // A PI speed loop per lane of a Controller (robot.md §5): r the speed
    // target, y the measured speed, ff a feedforward input added to u inside
    // the limits (as an industrial PIDE's FF input), with gain Kf. Kv and Ki
    // put a double pole at ω (ζ 1) on the plant each lane sees at the start
    // state, u0 holds that state (design.js, speedPIDesign). limit: ±u per
    // lane, 0 none.
    label: 'Speed PI from the plant', summary: 'u = Kv e + Ki ∫e + Kf·ff, Kv, Ki from the plant',
    designed: true, version: 1, computes: ['Kv', 'Ki', 'u0'],
    params: [
      num('omega', 'Bandwidth ω', 30, { unit: 'rad/s', positive: true, help: 'the double pole the speed loop gets' }),
      num('zeta', 'Damping ζ', 1, { positive: true }),
      num('Kf', 'Feedforward Kf', 1, { help: 'the gain on the ff input; 0 leaves it out' }),
      { key: 'integral', label: 'Integral', default: 'on', kind: 'choice', options: { on: 'on: PI', off: 'off: P only' } },
      vec('limit', 'Limit ±u', [0], { min: 0, per: 'lane', help: 'per lane, or one for all; 0: none' }),
      ...WINDUP,
    ],
    design: (p, ctx) => speedPIDesign(p, ctx),
    make(p, Ts, values) {
      if (!values) return OFF;
      const core = pidCore(Ts, values.u0);
      const lim = (p.limit[(values.lane || 1) - 1] ?? p.limit[0]) || Infinity;
      const g = { Kp: values.Kv, Ki: values.Ki, Kd: 0, Tf: 0, b: 1, umin: -lim, umax: lim, aw: p.aw, Tt: p.Tt, uff: 0 };
      return { step: (x) => { g.uff = p.Kf * (x[2] ?? 0); return core(x[0], x[1] ?? 0, g); } };
    },
    linear(p, Ts, at, values) {
      if (!values) throw noDesign('speedPI');
      const m = at?.y?.length || 1;
      const lin = pidLinear({ Kp: values.Kv, Ki: values.Ki, Kd: 0, Tf: 0, b: 1 }, Ts, m);
      if (m >= 2) lin.D[0][2] = p.Kf;
      return lin;
    },
  },
  pidFF: {
    // A PID whose reference feedforward is computed from the plant this block
    // sees (designs-in-the-page.md §15; design.js, feedforwardDesign): the
    // plant's inverse at low frequency, h0 + h1 s + h2 s², from u to the first
    // measurement at the plant's origin, plus what the PID's P (b ≠ 1) and D
    // parts take away while y follows r. The feedback gains are hand inputs;
    // order says how many terms (Kff; Kv; Ka) are used. It runs as the PID
    // with those numbers (Copy as numbers).
    label: 'PID + feedforward from the plant', summary: 'PID; Kff, Kv, Ka from the plant\'s inverse',
    designed: true, version: 1, computes: ['Kff', 'Kv', 'Ka'], twin: 'pid',
    params: [
      num('Kp', 'Kp', 1), num('Ki', 'Ki', 0), num('Kd', 'Kd', 0), num('Tf', 'D filter Tf', 0.01, { unit: 's', min: 0 }), num('b', 'Setpoint weight b', 1, { help: 'weights r in the P part only; the feedforward makes up for it' }), PREFILTER,
      { key: 'order', label: 'Feedforward', default: '2', kind: 'choice', options: { 0: 'static: Kff', 1: 'and velocity: Kv', 2: 'and acceleration: Ka' }, help: 'how many terms of the plant\'s inverse: Kff (the input that holds y at r), Kv (per r/s), Ka (per r/s²)' },
      START, ...LIMITS, ...WINDUP,
    ],
    design: (p, ctx) => feedforwardDesign(p, ctx),
    make(p, Ts, values) { return values ? twinLaw(CONTROLLERS.pidFF.manual(p, values), Ts) : OFF; },
    manual: (p, values) => ({ type: 'pid', params: { Kp: p.Kp, Ki: p.Ki, Kd: p.Kd, Tf: p.Tf, b: p.b, Tr: p.Tr, Kff: values.Kff, Kv: values.Kv, Ka: values.Ka, u0: p.u0, umin: p.umin, umax: p.umax, aw: p.aw, Tt: p.Tt } }),
    linear: twinLinear('pidFF'),
  },
  swingUp: {
    // For a pendulum on a cart, inputs r, x, θ, v, ω (θ = 0 upright). Far from
    // upright it pumps energy: with E = ½ l² ω² + g l (cos θ − 1), zero at the
    // top, the push u = kE · E · ω · cos θ makes V = ½ E² fall (a Lyapunov
    // function), so each swing climbs higher, while kx, kv pull the cart back to the
    // middle. Near the top (|θ| < θs) it
    // catches the pole with state feedback u = kr r − K · [x, θ, v, ω].
    label: 'Swing-up (Lyapunov) + state feedback', summary: 'energy pumping, then u = kr r − K · y',
    params: [...SWING, vec('K', 'Gains K', [-1, -30, -2, -5], { per: 'measurement' }), num('kr', 'Prefilter kr', -1), ...LIMITS],
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
  swingUpLqr: {
    // The swing-up above, its catch designed by LQR at the upright rest (the
    // origin of the plant this block sees, which must be the cart–pole's
    // x, θ, v, ω on inputs 2 to 5); x follows r. The energy pump keeps its
    // hand gains; the pole's l and g it measures energy with come from the
    // plant too (poleOf), so a longer pole is pumped to its own top.
    label: 'Swing-up + LQR catch', summary: 'energy pumping, then u = kr r − K · y, K from the plant',
    designed: true, version: 2, computes: ['K', 'kr', 'l', 'g'], twin: 'swingUp',
    params: [...SWING.filter((s) => s.key !== 'l' && s.key !== 'g'), ...WEIGHTS, ...LIMITS],
    design(p, ctx) {
      const lin = ctx.linearize('origin');
      const labels = lin.outputs.map((o) => o.label);
      if (lin.m !== 4 || !lin.outputs[1].angle) throw new DesignError('swing-inputs', `the swing-up reads x, θ, v, ω (θ an angle) from inputs 2 to 5; this block has ${labels.length ? labels.join(', ') : 'no measurements'}`, 'wire the cart–pole\'s x, θ, v, ω to inputs 2 to 5, or use LQR');
      const d = lqrDesign(lin, { Q: p.Q, R: p.R, track: 1, Ts: ctx.Ts });
      const { l, g } = poleOf(lin);
      return { values: { K: d.K, kr: d.kr, l, g }, rows: [...d.rows, { label: 'pole', value: [l, g], labels: ['l', 'g'], note: 'm, m/s²: what the pump measures energy with' }], warnings: d.warnings };
    },
    make(p, Ts, values) { return values ? twinLaw(CONTROLLERS.swingUpLqr.manual(p, values), Ts) : OFF; },
    manual: (p, values) => ({ type: 'swingUp', params: { kE: p.kE, kx: p.kx, kv: p.kv, l: values.l, g: values.g, thetaS: p.thetaS, K: [...values.K], kr: values.kr, umin: p.umin, umax: p.umax } }),
    linear: twinLinear('swingUpLqr'),
  },
  trajectory: {
    // A swing-up planned in the page from the plant this block sees
    // (planner.js, design.js): the force per sample that takes it from where
    // it starts to rest at the origin, followed with time-varying LQR along
    // the plan; then the upright LQR holds it, x following r. T, segments,
    // planShare and the limits shape the plan (changing them plans again,
    // seconds); Q, R and start only re-run the gains. There is no Copy as
    // numbers: a plan is always computed.
    label: 'Planned swing-up + TV-LQR', summary: 'u = F(t) − K(t)·(y − y*(t)), then u = kr r − K·y',
    designed: true, version: 1, computes: ['F', 'Y', 'K', 'Kup', 'kr'],
    params: [
      num('T', 'Swing-up time T', 2.4, { unit: 's', positive: true, heavy: true, tune: false, help: 'how long the swing-up takes; rounded to whole samples' }),
      num('segments', 'Segments', 12, { int: true, min: 2, max: 40, heavy: true, tune: false, help: 'pieces the plan is solved in (multiple shooting); more take longer' }),
      num('planShare', 'Plan may use', 0.75, { min: 0.05, max: 1, heavy: true, tune: false, help: 'the share of the force limit the plan may use; the rest is left for the feedback' }),
      num('start', 'Starts at', 0, { unit: 's', min: 0, help: 'until then u = 0' }),
      ...WEIGHTS, ...LIMITS,
    ],
    design: (p, ctx) => trajectoryDesign(p, ctx),
    make(p, Ts, values) { return values ? planLaw(values, Ts, p) : OFF; },
    // The law at the sample at.t is at (planLaw): before the plan u = 0;
    // along it u = F_j − K_j (y − Y_j), linear in y with the gains of that
    // sample (r unused); after it, and at rest (no t), the upright LQR.
    linear(p, Ts, at, values) {
      if (!values) throw noDesign('trajectory');
      const m = values.Kup.length, steps = values.F.length;
      const j = at?.t === undefined ? Infinity : Math.floor(at.t / Ts + 1e-9) - Math.round(p.start / Ts);
      if (j < 0) return { ...staticLinear(0, new Array(m).fill(0)), note: `before the plan starts (at ${p.start} s) u = 0: the loop is open` };
      if (j >= steps) return staticLinear(values.kr, values.Kup);
      return { ...staticLinear(0, Array.from(values.K.subarray(j * m, (j + 1) * m))), note: `the plan's gains at sample ${j} of ${steps} (t = ${((j + Math.round(p.start / Ts)) * Ts).toFixed(2)} s), frozen: along the plan they change every sample` };
    },
  },
  huLin: {
    // The Hu–Lin variable gain (design/research/hu-lin.md; design.js,
    // huLinDesign): LQR gains for Q·ε and R, ε from `low` up to 1, each on
    // its ellipsoid, nested, inside which its linear law cannot reach the
    // limits. At each sample the law takes the highest level whose ellipsoid
    // holds the error, interpolated between two levels (huLinLaw): far from
    // r the gain is low, and it grows as y nears r, so u stays near the
    // limit but inside it and the loop never opens. k > 1 is Hu and Lin's
    // saturated high gain, u = sat(k·K(ε)·e). Every state measured, as LQR.
    // There is no Copy as numbers: a table of ellipsoids is always computed.
    label: 'Variable gain (Hu–Lin)', summary: 'u = us·r − K(ε)·(y − ys·r); ε, the gain, grows as y nears r',
    designed: true, version: 1, computes: ['K', 'S', 'ys', 'us'],
    params: [
      ...WEIGHTS,
      num('low', 'Lowest level ε', 1e-4, { positive: true, max: 1, tune: false, help: 'far from r the weights are ε·Q: smaller reaches farther and starts more gently' }),
      num('levels', 'Levels', 30, { int: true, min: 2, max: 200, tune: false, help: 'gains between the lowest level and 1, on nested ellipsoids; the law interpolates between them' }),
      num('k', 'High gain k', 1, { min: 1, help: 'Hu and Lin\'s saturated high gain, u = sat(k·K(ε)·e); 1 keeps u inside the limits' }),
      num('track', 'r applies to', 1, { int: true, min: 0, help: 'the measurement (1, 2, …) that follows r; 0: none' }),
      PREFILTER, ...LIMITS,
    ],
    design: (p, ctx) => huLinDesign(p, ctx),
    make(p, Ts, values) { return values ? huLinLaw(p, Ts, values) : OFF; },
    // Near r the error lies inside the highest level: the LQR there, times k.
    linear(p, Ts, at, values) {
      if (!values) throw noDesign('huLin');
      const K = huLinGain(values, values.N - 1, 0).map((g) => g * p.k);
      return { ...staticLinear(values.us + K.reduce((s, g, i) => s + g * values.ys[i], 0), K, p.Tr), note: 'the gain near r, where it is highest; farther from r it is lower' };
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
    // Inside the layer and the limits: u = (K/φ)·(λ·(rf − y) + ṙf − ẏ). The
    // model's r input is the prefiltered rf (the tab feeds a step through Tr,
    // as for the PID), and ṙf = (r − rf)/Tr = a·(rf − rf⁻)/((1 − a)·Tr) with
    // a = e^(−Ts/Tr): one state, the rf of the sample before. Without a
    // prefilter, no state: u = (K·λ/φ)·(r − y) − (K/φ)·ẏ.
    linear(p, Ts, at) {
      if (!(p.phi > 0)) throw Object.assign(new Error('an ideal sliding mode switches: it has no linear model; give it a boundary layer φ > 0'), { hint: 'give it a boundary layer φ > 0, or analyse another variant' });
      const m = Math.max(2, at?.y?.length ?? 2), k = p.K / p.phi;
      const ys = [k * p.lambda, k, ...new Array(m - 2).fill(0)];
      if (!(p.Tr > 0)) return staticLinear(k * p.lambda, ys);
      const a = Math.exp(-Ts / p.Tr), c = (k * a) / ((1 - a) * p.Tr);
      return { A: [[0]], B: [[1, ...new Array(m).fill(0)]], C: [[-c]], D: [[k * p.lambda + c, ...ys.map((g) => -g)]], Tr: p.Tr };
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
    linear() { throw Object.assign(new Error('super-twisting has no linear model: √|s| has infinite slope at s = 0'), { hint: 'analyse another variant (a sliding mode with a boundary layer is linear inside it)' }); },
  },
};

// The gains of level j, plus lam times the step to level j + 1.
function huLinGain(v, j, lam) {
  const K = v.K.slice(j * v.m, (j + 1) * v.m);
  if (lam) for (let i = 0; i < v.m; i++) K[i] += lam * (v.K[(j + 1) * v.m + i] - K[i]);
  return K;
}
// The level of the error e: eᵀ S_j e, where e lies inside level j's
// ellipsoid while it is at most ū² (huLinDesign).
function huLinForm(v, j, e) {
  const o = j * v.m * v.m;
  let g = 0;
  for (let a = 0; a < v.m; a++) for (let b = 0; b < v.m; b++) g += e[a] * v.S[o + a * v.m + b] * e[b];
  return g;
}
// Where e lies among the levels: { j, lam }, the highest level whose
// ellipsoid holds e (the full gain near r), and how far toward the next it
// has come (0 on level j's boundary, 1 on level j + 1's). Outside the lowest
// level: j = 0, lam = 0, the lowest gain (its u may reach the limit there).
export function huLinLevel(v, e, room) {
  const lim = room > 0 ? room * room : 0;
  let above = huLinForm(v, v.N - 1, e);
  if (above <= lim) return { j: v.N - 1, lam: 0 };
  for (let j = v.N - 2; j >= 0; j--) {
    const g = huLinForm(v, j, e);
    if (g <= lim) return { j, lam: (lim - g) / (above - g) };
    above = g;
  }
  return { j: 0, lam: 0 };
}
// The law: u = us·rf − k·K(ε)·(y − ys·rf), held to the limits; ū is the room
// they leave around us·rf, the input that holds y at rf.
function huLinLaw(p, Ts, v) {
  const pre = prefilter(p, Ts), e = new Array(v.m);
  return {
    step(x) {
      const rf = pre(x[0]);
      for (let i = 0; i < v.m; i++) e[i] = (x[i + 1] ?? 0) - v.ys[i] * rf;
      const u0 = v.us * rf, { j, lam } = huLinLevel(v, e, Math.min(p.umax - u0, u0 - p.umin));
      const K = huLinGain(v, j, lam);
      let u = u0;
      for (let i = 0; i < v.m; i++) u -= p.k * K[i] * e[i];
      return clamp(u, p.umin, p.umax);
    },
  };
}

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
  return ctx?.inputs !== undefined && ctx.inputs < 3 ? 'sliding mode needs ẏ on input 3: set the Controller block\'s Inputs to 3 in the Plant tab and wire the measured rate there (a Finite difference observer makes it from y)' : '';
}

export const CONTROLLER_TYPES = Object.keys(CONTROLLERS);

function normalizeParam(spec, v, where) {
  if (spec.nullable && (v === null || v === '')) return null;
  v ??= spec.default;
  if (spec.kind === 'choice') {
    if (!Object.hasOwn(spec.options, v)) throw new Error(`${where}.${spec.key}: one of ${Object.keys(spec.options).join(', ')}`);
    return v;
  }
  if (spec.kind === 'vector') {
    if (v === null && spec.nullable) return null;   // e.g. "from the plant"
    if (!Array.isArray(v) || !v.length || !v.every((x) => Number.isFinite(Number(x)))) throw new Error(`${where}.${spec.key}: a list of numbers`);
    if (spec.min !== undefined && v.some((x) => Number(x) < spec.min)) throw new Error(`${where}.${spec.key}: each at least ${spec.min}`);
    return v.map(Number);
  }
  if (v === null || v === '' || v === 'inf' || v === 'Infinity' || v === '-inf' || v === '-Infinity') return v && String(v).startsWith('-') ? -Infinity : spec.default;
  let n = Number(v);
  if (Number.isNaN(n)) throw new Error(`${where}.${spec.key}: expected a number`);
  if (spec.int) n = Math.round(n);
  if (spec.min !== undefined && n < spec.min) throw new Error(`${where}.${spec.key}: at least ${spec.min}`);
  if (spec.max !== undefined && n > spec.max) throw new Error(`${where}.${spec.key}: at most ${spec.max}`);
  if (spec.positive && !(n > 0)) throw new Error(`${where}.${spec.key}: above 0`);
  return n;
}

// One variant: { name, type, params }. Unknown types and bad values fail with
// the valid choices named. A designed type's computed numbers are refused:
// a file holds inputs only.
// lib: the library the variant comes from (CONTROLLERS, or OBSERVERS for an
// Observer block); both share this format. ctx: what the block gives the
// variant ({ inputs }), when known, for checks that need it.
export function normalizeVariant(v, where = 'variant', lib = CONTROLLERS, ctx = undefined) {
  // A type may take an older form of itself (a file from before it was designed).
  if (lib[v?.type]?.migrate) v = lib[v.type].migrate(v);
  const def = lib[v?.type];
  if (!def) throw new Error(`${where}.type: one of ${Object.keys(lib).join(', ')}`);
  const given = (def.computes ?? []).filter((k) => v.params?.[k] !== undefined);
  if (given.length) {
    const inputs = def.params.map((p) => p.key).filter((k) => !/^(umin|umax|Tr|Kff|Kv|Ka|aw|Tt)$/.test(k));
    const twins = [].concat(def.twin ?? []).map((t) => lib[t]?.label ?? t).join(' or ');
    throw new Error(`${where}.params.${given[0]}: ${v.type} computes ${and(def.computes)} from the plant and ${and(inputs)}; ${twins ? `to set them by hand use Copy as numbers (a ${twins} variant)` : 'they are never kept in a file'}`);
  }
  const params = {};
  for (const spec of def.params) params[spec.key] = normalizeParam(spec, v.params?.[spec.key], where);
  if (params.umin > params.umax) [params.umin, params.umax] = [params.umax, params.umin];
  const bad = def.check?.(params, ctx);
  if (bad) throw new Error(`${where}: ${bad}`);
  return { name: String(v.name ?? def.label).slice(0, 40), type: v.type, params };
}

// The law of a block's active variant; a designed one runs on the values its
// design computed (null: u = 0). Normalised first: a project restored from
// JSON (undo, redo) has its open limits as null, not ±Infinity. Params
// already in normal form are used as they are, so an edit of them while the
// law runs (Live mode) reaches it. An experiment Auto-tune runs
// (src/core/autotune.js: hold r, then step u) brings its own law as a
// function, so it can never come from a file.
const same = (a, b) => (Array.isArray(b) ? Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]) : a === b);
export function makeLaw(variant, Ts, lib = CONTROLLERS, values = null) {
  if (typeof variant.law === 'function') return variant.law(Ts);
  const { params } = normalizeVariant(variant, 'variant', lib);
  const keep = variant.params && Object.keys(params).every((k) => same(variant.params[k], params[k]));
  return lib[variant.type].make(keep ? variant.params : params, Ts, values);
}

