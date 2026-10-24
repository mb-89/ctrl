// The controller library: implementations a Controller block can run. Every
// implementation has the same interface, so a block can hold several of them
// as variants and switch between them (as Simulink's variant subsystems):
//
//   inputs  [r, y1, y2, …]   the reference first, then the measurements
//   output  u                held between samples (zero-order hold)
//
// Each runs digitally at the block's sample time Ts. make(params, Ts) returns
// { step(inputs) -> u }, called once per sample with the inputs at that instant.
//
// A law that is linear about an operating point also has linear(params, Ts,
// at, values) for the Analysis tab: its discrete state space { A, B, C, D }
// (arrays of rows) from [r, y1 … ym] to u at Ts, valid while u is inside its
// limits. at.y holds the measurements at the operating point, at.t the time
// of the run the law is at (a snapshot; a planned law's gains change with
// it). The prefilter on r lies outside the loop and is left out. It throws
// when the law is not linear there. A designed type takes the values its
// design computed, and gives its Copy as numbers twin's model; it may add a
// `note` for the analysis (a plan's gains frozen at one sample).
//
// A designed type computes its numbers from the plant instead of being given
// them (design/output/designs.md). Its params are inputs only (weights,
// levels, limits); it adds
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

import { lqrDesign, scheduledPIDesign, trajectoryDesign, poleOf } from './design.js';
import { DesignError } from './linearize.js';
import { planLaw } from './planner.js';

const num = (key, label, def, extra = {}) => ({ key, label, default: def, ...extra });
const vec = (key, label, def, extra = {}) => ({ key, label, default: def, kind: 'vector', ...extra });
const LIMITS = [num('umin', 'u min', -Infinity, { unit: 'u' }), num('umax', 'u max', Infinity, { unit: 'u' })];
const PREFILTER = num('Tr', 'Prefilter Tr', 0, { unit: 's', min: 0, help: 'Vorfilter: a first-order lag on r; 0 is off' });
const START = num('u0', 'Start output u0', 0, { unit: 'u', help: 'the integral part at t = 0, so a loop can start in balance' });
// The energy pump of the swing-up: hand gains, shared by its two types.
const SWING = [num('kE', 'Energy gain kE', 1), num('kx', 'Centring kx', 0), num('kv', 'Centring kv', 0), num('l', 'Pole length l', 0.5, { unit: 'm', min: 1e-6 }), num('g', 'g', 9.81, { unit: 'm/s²' }), num('thetaS', 'Catch below θs', 0.4, { unit: 'rad', min: 0 })];
// The weights of an LQR design.
const WEIGHTS = [
  vec('Q', 'Weights Q', [1], { min: 0, per: 'measurement', help: 'what an error in each measurement costs, one per measurement; one value weighs them all' }),
  num('R', 'Effort weight R', 1, { positive: true, help: 'how much u costs: larger is gentler' }),
];

const and = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list.join(''));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

// A first-order prefilter on the reference (Vorfilter), exact for a held input.
function prefilter(Tr, Ts) {
  if (!(Tr > 0)) return (r) => r;
  const a = Math.exp(-Ts / Tr);
  let rf = null;
  return (r) => { rf = rf === null ? r : a * rf + (1 - a) * r; return rf; };
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
    params: [num('Kp', 'Kp', 1), num('Ki', 'Ki', 0), num('Kd', 'Kd', 0), num('Tf', 'D filter Tf', 0.01, { unit: 's', min: 0 }), num('b', 'Setpoint weight b', 1), PREFILTER, START, ...LIMITS],
    make(p, Ts) {
      const pre = prefilter(p.Tr, Ts), core = pidCore(Ts, p.u0);
      return { step: (x) => core(pre(x[0]), x[1] ?? 0, p) };
    },
    linear: (p, Ts, at) => pidLinear(p, Ts, at?.y?.length || 1),
  },
  stateFeedback: {
    label: 'State feedback', summary: 'u = kr r − K · y',
    params: [vec('K', 'Gains K', [1], { per: 'measurement' }), num('kr', 'Prefilter kr', 1), PREFILTER, ...LIMITS],
    make(p, Ts) {
      const pre = prefilter(p.Tr, Ts);
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
  gainScheduled: {
    label: 'Gain-scheduled PI', summary: 'PI with Kp, Ki looked up from y',
    params: [vec('at', 'At y =', [0, 1]), vec('Kp', 'Kp', [1, 1]), vec('Ki', 'Ki', [0, 0]), PREFILTER, START, ...LIMITS],
    check(p) { if (p.Kp.length !== p.at.length || p.Ki.length !== p.at.length) return 'At, Kp and Ki need the same number of values'; if (p.at.some((v, i) => i && v <= p.at[i - 1])) return 'the At values must increase'; return ''; },
    make(p, Ts) {
      const pre = prefilter(p.Tr, Ts), core = pidCore(Ts, p.u0);
      const g = { Kp: 0, Ki: 0, Kd: 0, Tf: 0, b: 1, umin: p.umin, umax: p.umax };
      return {
        step(x) {
          const y = x[1] ?? 0;
          g.Kp = lookup(p.at, p.Kp, y); g.Ki = lookup(p.at, p.Ki, y);
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
  scheduledPI: {
    // A PI by pole cancellation, from the plant this block sees: at each
    // level of the first measurement the plant is trimmed, linearised and
    // fitted as K e^(−θs) / (τs + 1), and Kp = τ / (K Tcl), Ki = 1 / (K Tcl)
    // make the loop a first-order lag with time constant Tcl (design.js).
    // One level gives a fixed PI; several, a gain-scheduled one. u0 holds the
    // level the plant starts at.
    label: 'PI from the plant', summary: 'PI by pole cancellation at levels of y',
    designed: true, version: 1, computes: ['Kp', 'Ki', 'u0'], twin: ['pid', 'gainScheduled'],
    params: [vec('at', 'At y =', [1], { per: 'level', help: 'the levels of the first measurement to design at; one level gives a fixed PI, several are interpolated' }), num('Tcl', 'Closed loop Tcl', 0.25, { unit: 's', positive: true, help: 'the time constant the loop should have' }), PREFILTER, ...LIMITS],
    check(p) { return p.at.some((v, i) => i && v <= p.at[i - 1]) ? 'the At values must increase' : ''; },
    design: (p, ctx) => scheduledPIDesign(p, ctx),
    make(p, Ts, values) { return values ? twinLaw(CONTROLLERS.scheduledPI.manual(p, values), Ts) : OFF; },
    manual(p, values) {
      const common = { Tr: p.Tr, u0: values.u0, umin: p.umin, umax: p.umax };
      return values.at.length === 1
        ? { type: 'pid', params: { Kp: values.Kp[0], Ki: values.Ki[0], Kd: 0, ...common } }
        : { type: 'gainScheduled', params: { at: [...values.at], Kp: [...values.Kp], Ki: [...values.Ki], ...common } };
    },
    linear: twinLinear('scheduledPI'),
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
};

export const CONTROLLER_TYPES = Object.keys(CONTROLLERS);

function normalizeParam(spec, v, where) {
  if (spec.nullable && (v === null || v === '')) return null;
  v ??= spec.default;
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
// Observer block); both share this format.
export function normalizeVariant(v, where = 'variant', lib = CONTROLLERS) {
  const def = lib[v?.type];
  if (!def) throw new Error(`${where}.type: one of ${Object.keys(lib).join(', ')}`);
  const given = (def.computes ?? []).filter((k) => v.params?.[k] !== undefined);
  if (given.length) {
    const inputs = def.params.map((p) => p.key).filter((k) => !/^(umin|umax|Tr)$/.test(k));
    const twins = [].concat(def.twin ?? []).map((t) => lib[t]?.label ?? t).join(' or ');
    throw new Error(`${where}.params.${given[0]}: ${v.type} computes ${and(def.computes)} from the plant and ${and(inputs)}; ${twins ? `to set them by hand use Copy as numbers (a ${twins} variant)` : 'they are never kept in a file'}`);
  }
  const params = {};
  for (const spec of def.params) params[spec.key] = normalizeParam(spec, v.params?.[spec.key], where);
  if (params.umin > params.umax) [params.umin, params.umax] = [params.umax, params.umin];
  const bad = def.check?.(params);
  if (bad) throw new Error(`${where}: ${bad}`);
  return { name: String(v.name ?? def.label).slice(0, 40), type: v.type, params };
}

// The law of a block's active variant; a designed one runs on the values its
// design computed (null: u = 0).
export function makeLaw(variant, Ts, lib = CONTROLLERS, values = null) {
  return lib[variant.type].make(variant.params, Ts, values);
}

