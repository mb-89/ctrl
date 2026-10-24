// The controller library: implementations a Controller block can run. Every
// implementation has the same interface, so a block can hold several of them
// as variants and switch between them (as Simulink's variant subsystems):
//
//   inputs  [r, y1, y2, …]   the reference first, then the measurements
//   output  u                held between samples (zero-order hold)
//
// Each runs digitally at the block's sample time Ts. make(params, Ts) returns
// { step(inputs) -> u }, called once per sample with the inputs at that instant.

const num = (key, label, def, extra = {}) => ({ key, label, default: def, ...extra });
const vec = (key, label, def, extra = {}) => ({ key, label, default: def, kind: 'vector', ...extra });
const LIMITS = [num('umin', 'u min', -Infinity, { unit: 'u' }), num('umax', 'u max', Infinity, { unit: 'u' })];
const PREFILTER = num('Tr', 'Prefilter Tr', 0, { unit: 's', min: 0, help: 'Vorfilter: a first-order lag on r; 0 is off' });
const START = num('u0', 'Start output u0', 0, { unit: 'u', help: 'the integral part at t = 0, so a loop can start in balance' });

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

export const CONTROLLERS = {
  off: {
    label: 'Off', summary: 'u = 0', params: [],
    make: () => ({ step: () => 0 }),
  },
  pid: {
    label: 'PID', summary: 'u = Kp e + Ki ∫e + Kd ė',
    params: [num('Kp', 'Kp', 1), num('Ki', 'Ki', 0), num('Kd', 'Kd', 0), num('Tf', 'D filter Tf', 0.01, { unit: 's', min: 0 }), num('b', 'Setpoint weight b', 1), PREFILTER, START, ...LIMITS],
    make(p, Ts) {
      const pre = prefilter(p.Tr, Ts), core = pidCore(Ts, p.u0);
      return { step: (x) => core(pre(x[0]), x[1] ?? 0, p) };
    },
  },
  stateFeedback: {
    label: 'State feedback', summary: 'u = kr r − K · y',
    params: [vec('K', 'Gains K', [1]), num('kr', 'Prefilter kr', 1), PREFILTER, ...LIMITS],
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
  },
  trajectory: {
    // A swing-up planned offline (tools/triple-swingup.mjs): until T it adds
    // a time-varying LQR around the planned path to the planned force,
    // u = F(t) − K(t) · (y − y*(t)); after T it holds the top with state
    // feedback u = kr r − Kup · y. The tables are sampled every dt; angle
    // errors (the states flagged in wrap) are taken modulo 2π.
    label: 'Trajectory + time-varying LQR', summary: 'u = F(t) − K(t)(y − y*(t)), then state feedback',
    params: [num('T', 'Swing-up time T', 2, { unit: 's', min: 0 }), num('dt', 'Table step dt', 0.02, { unit: 's', min: 1e-4 }),
      vec('F', 'Planned force F(t)', [0], { table: true }), vec('Y', 'Planned states y*(t)', [0], { table: true }), vec('K', 'Gains K(t)', [0], { table: true }),
      vec('wrap', 'Angle states (1 = wrap)', [0]), vec('Kup', 'Upright gains Kup', [0]), num('kr', 'Prefilter kr', 0), ...LIMITS],
    check(p) { const n = p.Kup.length, rows = p.F.length; if (p.Y.length !== rows * n || p.K.length !== rows * n) return `Y and K need ${rows} rows of ${n} values (one row per F value, one value per gain in Kup)`; return ''; },
    make(p, Ts) {
      const n = p.Kup.length, rows = p.F.length;
      let k = 0;
      const at = (tab, row, i) => tab[row * n + i];
      return {
        step(x) {
          const t = k++ * Ts;
          let u;
          if (t < p.T) {
            const s = Math.min(rows - 1, t / p.dt), i0 = Math.floor(s), i1 = Math.min(rows - 1, i0 + 1), f = s - i0;
            u = p.F[i0] + f * (p.F[i1] - p.F[i0]);
            for (let i = 0; i < n; i++) {
              let e = (x[i + 1] ?? 0) - (at(p.Y, i0, i) + f * (at(p.Y, i1, i) - at(p.Y, i0, i)));
              if (p.wrap[i]) e = wrap(e);
              u -= (at(p.K, i0, i) + f * (at(p.K, i1, i) - at(p.K, i0, i))) * e;
            }
          } else {
            u = p.kr * x[0];
            for (let i = 0; i < n; i++) u -= p.Kup[i] * (p.wrap[i] ? wrap(x[i + 1] ?? 0) : (x[i + 1] ?? 0));
          }
          return clamp(u, p.umin, p.umax);
        },
      };
    },
  },
};

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

// The law of a block's active variant.
export function makeLaw(variant, Ts, lib = CONTROLLERS) {
  return lib[variant.type].make(variant.params, Ts);
}

