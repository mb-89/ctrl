// The signal generator's primitives. The reference r(t) is the sum of a list
// of components, each one primitive with its parameters, repeated with the
// signal's period, as a function generator repeats its waveform:
//   { "period": 1, "components": [ { "type": "step", "params": { "amplitude": 1, "time": 0.1 } } ] }
// A component may be switched off with "enabled": false; an Arb component
// carries its samples in "points": [[t, v], ...].
// Each type's d(q, ctx, comp, k) gives its k-th time derivative (k = 1, 2) as
// { fn, warn }: warn is a sentence when the derivative is not the true one.
// A component's function, and its derivatives', is called as f(t, n): t the
// time in the period, n the period's index from the run's start (0 for the
// first). Only an eased Sine reads n: it eases in the first period and runs
// on its steady phase in every later one, so a long run is periodic after
// its start.

import { compileExpr } from './expr.js';

const p = (key, label, def, unit, extra = {}) => ({ key, label, default: def, unit, ...extra });

export const SIGNALS = {
  dc: {
    label: 'DC', params: [p('level', 'Level', 1, '')],
    fn: (q) => () => q.level,
    d: () => ({ fn: () => 0 }),
    describe: (q) => `level ${q.level}`,
  },
  step: {
    label: 'Step', params: [p('amplitude', 'Amplitude', 1, ''), p('time', 'Time', 0.1, 's', { min: 0 })],
    fn: (q) => (t) => (t >= q.time ? q.amplitude : 0),
    d: (q) => ({ fn: () => 0, warn: `the step at ${q.time.toFixed(2)} s has no finite derivative: use a ramp or an eased sine` }),
    describe: (q) => `${q.amplitude} at ${q.time} s`,
  },
  ramp: {
    label: 'Ramp', params: [p('amplitude', 'Amplitude', 1, ''), p('time', 'Start', 0.1, 's', { min: 0 }), p('rise', 'Rise time', 0.5, 's', { min: 1e-9 })],
    fn: (q) => (t) => (t < q.time ? 0 : t >= q.time + q.rise ? q.amplitude : (q.amplitude * (t - q.time)) / q.rise),
    // Its slope inside the ramp; the corners' impulses in r̈ are left out.
    d: (q, ctx, comp, k) => (k === 1
      ? { fn: (t) => (t < q.time || t >= q.time + q.rise ? 0 : q.amplitude / q.rise) }
      : { fn: () => 0, warn: `the ramp's corners at ${q.time.toFixed(2)} s and ${(q.time + q.rise).toFixed(2)} s have no finite second derivative: their impulses are left out` }),
    describe: (q) => `${q.amplitude} over ${q.rise} s from ${q.time} s`,
  },
  square: {
    // A pulse train; count 1 is a single pulse, count 0 repeats without end.
    label: 'Square', params: [p('amplitude', 'Amplitude', 1, ''), p('time', 'Start', 0.1, 's', { min: 0 }), p('width', 'High time', 0.1, 's', { min: 0 }), p('period', 'Period', 0.2, 's', { min: 1e-9 }), p('count', 'Count', 0, '', { min: 0, int: true, zero: '∞' })],
    fn: (q) => (t) => {
      if (t < q.time) return 0;
      const k = Math.floor((t - q.time) / q.period);
      if (q.count > 0 && k >= q.count) return 0;
      return t - q.time - k * q.period < q.width ? q.amplitude : 0;
    },
    d: (q) => ({ fn: () => 0, warn: `the step at ${q.time.toFixed(2)} s has no finite derivative: use a ramp or an eased sine` }),
    describe: (q) => (q.count === 1 ? `pulse ${q.amplitude} for ${q.width} s at ${q.time} s` : `${q.amplitude}, ${q.width}/${q.period} s${q.count ? `, ${q.count}×` : ''}`),
  },
  sine: {
    label: 'Sine', params: [p('amplitude', 'Amplitude', 1, ''), p('time', 'Start', 0, 's', { min: 0 }), p('frequency', 'Frequency', 5, 'Hz', { min: 0 }), p('phase', 'Phase', 0, '°'),
      p('ease', 'Ease', 0, 's', { min: 0, help: 'the phase rate rises from 0 over this time, so speed and acceleration start at 0' })],
    // With ease the phase, not the amplitude, is eased, so a pair of sines
    // still draws its circle exactly. It eases once, in the run's first
    // period (n = 0); every later period runs on the steady phase, so a sine
    // with a whole number of cycles per period joins up where it repeats.
    // Ease 0 keeps the plain expression.
    fn: (q) => {
      if (!(q.ease > 0)) return (t) => (t >= q.time ? q.amplitude * Math.sin(2 * Math.PI * q.frequency * (t - q.time) + (q.phase * Math.PI) / 180) : 0);
      const w = 2 * Math.PI * q.frequency, ph = (q.phase * Math.PI) / 180;
      return (t, n = 0) => (t >= q.time ? q.amplitude * Math.sin(easedPhase(t - q.time, w, q.ease, n > 0)[0] + ph) : 0);
    },
    d: (q, ctx, comp, k) => {
      const w = 2 * Math.PI * q.frequency, ph = (q.phase * Math.PI) / 180, A = q.amplitude;
      return { fn: (t, n = 0) => {
        if (t < q.time) return 0;
        const [f, df, ddf] = q.ease > 0 ? easedPhase(t - q.time, w, q.ease, n > 0) : [w * (t - q.time), w, 0];
        return k === 1 ? A * Math.cos(f + ph) * df : A * (Math.cos(f + ph) * ddf - Math.sin(f + ph) * df * df);
      } };
    },
    describe: (q) => `${q.amplitude}, ${q.frequency} Hz${q.ease > 0 ? `, eased over ${q.ease} s` : ''}`,
  },
  chirp: {
    label: 'Chirp', params: [p('amplitude', 'Amplitude', 1, ''), p('time', 'Start', 0, 's', { min: 0 }), p('f0', 'Start freq.', 1, 'Hz', { min: 0 }), p('f1', 'End freq.', 20, 'Hz', { min: 0 }), p('duration', 'Duration', 1, 's', { min: 1e-9 })],
    fn: (q) => (t) => {
      if (t < q.time || t >= q.time + q.duration) return 0;
      const s = t - q.time;
      return q.amplitude * Math.sin(2 * Math.PI * (q.f0 * s + ((q.f1 - q.f0) * s * s) / (2 * q.duration)));
    },
    d: (q, ctx, comp, k) => ({ fn: (t) => {
      if (t < q.time || t >= q.time + q.duration) return 0;
      const s = t - q.time, f = 2 * Math.PI * (q.f0 * s + ((q.f1 - q.f0) * s * s) / (2 * q.duration));
      const df = 2 * Math.PI * (q.f0 + ((q.f1 - q.f0) * s) / q.duration), ddf = (2 * Math.PI * (q.f1 - q.f0)) / q.duration;
      return k === 1 ? q.amplitude * Math.cos(f) * df : q.amplitude * (Math.cos(f) * ddf - Math.sin(f) * df * df);
    } }),
    describe: (q) => `${q.amplitude}, ${q.f0} → ${q.f1} Hz over ${q.duration} s`,
  },
  fn: {
    label: 'Function', params: [],
    fn: (q, ctx, comp) => compileExpr(comp.expr),
    // 5-point central differences with h = 10 µs.
    d: (q, ctx, comp, k) => {
      const f = compileExpr(comp.expr), h = 1e-5;
      return { fn: k === 1
        ? (t) => (f(t - 2 * h) - 8 * f(t - h) + 8 * f(t + h) - f(t + 2 * h)) / (12 * h)
        : (t) => (-f(t - 2 * h) + 16 * f(t - h) - 30 * f(t) + 16 * f(t + h) - f(t + 2 * h)) / (12 * h * h) };
    },
    describe: (q, comp) => `y = ${comp.expr}`,
  },
  noise: {
    label: 'Noise', params: [p('std', 'σ', 0.05, '', { min: 0 }), p('seed', 'Seed', 1, '', { min: 0, int: true })],
    // Held per sample and derived from (seed, sample index), so any time
    // evaluates to the same value in the page and in Node.
    fn: (q, ctx) => (t) => q.std * gaussAt(q.seed, Math.floor(t / ctx.sampleTime + 1e-9)),
    d: () => { throw new Error('noise has no derivative: switch the Noise component off, or take ṙ and r̈ from a signal without it'); },
    describe: (q) => `σ ${q.std}, seed ${q.seed}`,
  },
  arb: {
    label: 'Arb', params: [p('gain', 'Gain', 1, ''), p('shift', 'Time shift', 0, 's')],
    fn: (q, ctx, comp) => {
      const pts = comp.points ?? [];
      return (t) => q.gain * interp(pts, t - q.shift);
    },
    // Piecewise slopes; the corners' impulses in r̈ are left out.
    d: (q, ctx, comp, k) => {
      const pts = comp.points ?? [];
      if (k === 2) return { fn: () => 0, warn: pts.length > 1 ? `the Arb's corners have no finite second derivative: their impulses are left out` : undefined };
      return { fn: (t) => q.gain * slope(pts, t - q.shift) };
    },
    describe: (q, comp) => `${(comp.points ?? []).length} points${comp.name ? ` from ${comp.name}` : ''}`,
  },
};

function interp(pts, t) {
  if (!pts.length) return 0;
  if (t <= pts[0][0]) return t < pts[0][0] ? 0 : pts[0][1];
  if (t >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid][0] <= t) lo = mid; else hi = mid; }
  const [t0, v0] = pts[lo], [t1, v1] = pts[hi];
  return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
}

function slope(pts, t) {
  if (pts.length < 2 || t < pts[0][0] || t >= pts[pts.length - 1][0]) return 0;
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid][0] <= t) lo = mid; else hi = mid; }
  const [t0, v0] = pts[lo], [t1, v1] = pts[hi];
  return t1 === t0 ? 0 : (v1 - v0) / (t1 - t0);
}

// The eased phase at time u after the start, and its two derivatives: the
// phase rate rises from 0 to w along a quintic smoothstep over Te seconds.
// steady: the phase it settles on, w·(u − Te/2), from u = 0 (a period after
// the first: the ease is over).
export function easedPhase(u, w, Te, steady = false) {
  if (steady || u >= Te) return [w * (u - Te / 2), w, 0];
  const s = u / Te;
  return [w * Te * (2.5 * s ** 4 - 3 * s ** 5 + s ** 6), w * (10 * s ** 3 - 15 * s ** 4 + 6 * s ** 5), (w / Te) * (30 * s ** 2 - 60 * s ** 3 + 30 * s ** 4)];
}

function hash32(a) {
  a = Math.imul(a ^ (a >>> 16), 0x45d9f3b);
  a = Math.imul(a ^ (a >>> 16), 0x45d9f3b);
  return (a ^ (a >>> 16)) >>> 0;
}

export function gaussAt(seed, k) {
  const u1 = (hash32((seed * 2654435761 + k * 2) | 0) + 1) / 4294967297;
  const u2 = hash32((seed * 2654435761 + k * 2 + 1) | 0) / 4294967296;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// Earlier files had a separate pulse, and a square with a duty cycle.
function legacy(c) {
  const q = c.params ?? {};
  if (c.type === 'pulse') return { ...c, type: 'square', params: { amplitude: q.amplitude, time: q.time, width: q.width ?? 0.1, period: (q.width ?? 0.1) * 2, count: 1 } };
  if (c.type === 'square' && q.duty !== undefined && q.width === undefined) return { ...c, params: { ...q, width: ((q.duty ?? 50) / 100) * (q.period ?? 0.2) } };
  return c;
}

export function normalizeComponent(cIn, i = 0) {
  const c = cIn ? legacy(cIn) : cIn;
  const def = SIGNALS[c?.type];
  if (!def) throw new Error(`reference.components[${i}]: unknown type "${c?.type}"; types: ${Object.keys(SIGNALS).join(', ')}`);
  const params = {};
  for (const q of def.params) {
    let v = c.params?.[q.key];
    v = v === undefined || v === null ? q.default : Number(v);
    if (!Number.isFinite(v)) throw new Error(`reference.components[${i}].${q.key}: expected a number`);
    if (q.int) v = Math.round(v);
    params[q.key] = v;
  }
  const out = { type: c.type, params };
  if (c.enabled === false) out.enabled = false;
  if (c.type === 'fn') {
    out.expr = String(c.expr ?? '').trim();
    try { compileExpr(out.expr); } catch (e) { throw new Error(`reference.components[${i}].expr: ${e.message}`); }
  }
  if (c.type === 'arb') {
    const pts = (c.points ?? []).map((pt) => [Number(pt[0]), Number(pt[1])]);
    if (!pts.every((pt) => pt.every(Number.isFinite))) throw new Error(`reference.components[${i}].points: expected [[t, v], ...]`);
    pts.sort((a, b) => a[0] - b[0]);
    out.points = pts;
    if (c.name) out.name = String(c.name);
  }
  return out;
}

export const DEFAULT_PERIOD = 1;

export function normalizeReference(ref) {
  if (!ref) return { period: DEFAULT_PERIOD, components: [] };
  if (!Array.isArray(ref.components)) throw new Error('reference: expected { "period": …, "components": [...] }');
  const period = Number(ref.period ?? DEFAULT_PERIOD);
  if (!(period > 0)) throw new Error('reference.period must be > 0');
  return { period, components: ref.components.map(normalizeComponent) };
}

export function componentFn(comp, ctx) {
  return SIGNALS[comp.type].fn(comp.params, ctx, comp);
}

// r(t): the sum of the enabled components, repeated every period. Each
// repetition covers (k·T, (k+1)·T], so a screen that shows exactly one period
// ends on the last value of that period rather than the first of the next.
// t is the run's time (0 at its start): the first period is the only one an
// eased Sine eases in; from the second on every period is the same.
// r.derivative(k), k = 1 or 2, is the k-th time derivative of the same
// signal, repeated the same way; it carries .warnings, a list of sentences.
// The components are normalized here (a parameter left out takes its
// default), so a signal written in short, as the library's are, plays as the
// page plays it; a normalized one is unchanged by it.
export function referenceFn(ref, ctx) {
  const on = ref.components.map(normalizeComponent).filter((c) => c.enabled !== false);
  const T = ref.period ?? Infinity;
  const sum = (fns) => (t) => {
    let tp = t, n = 0;
    if (Number.isFinite(T) && t > T * (1 + 1e-12)) {
      n = Math.ceil(t / T - 1 - 1e-9);
      // A later period's time on a picosecond grid: t carries the rounding of
      // its own size, which would put a step a sample early or late in some
      // periods; on the grid every later period is the same, bit for bit.
      tp = n > 0 ? Math.round((t - n * T) * 1e12) / 1e12 : t;
    }
    let s = 0;
    for (const f of fns) s += f(tp, n);
    return s;
  };
  const r = sum(on.map((c) => componentFn(c, ctx)));
  r.derivative = (k) => {
    if (k !== 1 && k !== 2) throw new Error(`derivative: k must be 1 or 2, not ${k}`);
    const ds = on.map((c) => SIGNALS[c.type].d(c.params, ctx, c, k));
    const dr = sum(ds.map((d) => d.fn));
    dr.warnings = [...new Set(ds.map((d) => d.warn).filter(Boolean))];
    return dr;
  };
  return r;
}

// Where a signal repeats: does it join up with itself? For a reference, the
// jump from the end of a period to the start of the next, in the steady
// periods (from the second on, where an eased Sine has eased in; the run's
// start at t = 0 is not a wrap). Noise is left out: it is held per sample,
// not a motion.
//   → { value, slope, span, rate, smooth, joins }
//   value   r at the start of a period less r at the end of the one before
//   slope   the same for ṙ (the left limit at the end); null without a ṙ
//   span    max − min of r over a period; rate: max |ṙ| (0 if not smooth)
//   smooth  no step and no corner inside the period (ṙ and r̈ are the true
//           ones): a smooth motion, whose slope must join up too
//   joins   the value within a millionth of the span and, where smooth, the
//           slope within a millionth of the rate
export function wrapJump(ref, ctx = { sampleTime: 1e-3 }) {
  const T = Number(ref.period);
  const on = (ref.components ?? []).map(normalizeComponent).filter((c) => c.enabled !== false && c.type !== 'noise');
  if (!(T > 0) || !Number.isFinite(T) || !on.length) return { value: 0, slope: 0, span: 0, rate: 0, smooth: true, joins: true };
  const fns = on.map((c) => componentFn(c, ctx));
  const at = (fs, t, n) => fs.reduce((s, f) => s + f(t, n), 0);
  const value = at(fns, 0, 2) - at(fns, T, 1);
  let d1 = null, smooth = false;
  try {
    d1 = on.map((c) => SIGNALS[c.type].d(c.params, ctx, c, 1));
    smooth = d1.every((d) => !d.warn) && on.every((c) => !SIGNALS[c.type].d(c.params, ctx, c, 2).warn);
    d1 = d1.map((d) => d.fn);
  } catch { d1 = null; }
  // ṙ at the end: a smooth signal's at T; else its left limit there (a
  // component's ṙ is right-continuous at its corners).
  const slope = d1 ? at(d1, 0, 2) - at(d1, smooth ? T : T * (1 - 1e-10), 1) : null;
  let lo = Infinity, hi = -Infinity, rate = 0;
  const N = 1000;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * T, v = at(fns, t, 1);
    lo = Math.min(lo, v); hi = Math.max(hi, v);
    if (smooth && d1) rate = Math.max(rate, Math.abs(at(d1, t, 1)));
  }
  const span = hi - lo;
  const joins = Math.abs(value) <= 1e-6 * span && (!smooth || slope === null || Math.abs(slope) <= 1e-6 * rate);
  return { value, slope, span, rate, smooth, joins };
}

// The Input tab's line where a signal does not join up with itself: one
// sentence, or '' where it joins, or where the jump is what was built: a
// sawtooth (a Ramp still rising at the period's end drops there by design).
// Steps that return join, so they stay quiet.
export function wrapWarning(ref, name = 'r', ctx) {
  const j = wrapJump(ref, ctx);
  if (j.joins) return '';
  const T = Number(ref.period);
  const saw = ref.components.map(normalizeComponent).some((c) => c.enabled !== false && c.type === 'ramp' && c.params.time < T && c.params.time + c.params.rise >= T * (1 - 1e-9));
  if (saw) return '';
  return Math.abs(j.value) > 1e-6 * j.span
    ? `${name}(t) jumps where it repeats: it ends the period away from where it starts, so every later period begins with a step; bring it back before the period ends.`
    : `${name}(t) kinks where it repeats: its slope at the end of the period is not the one it starts with; a sine joins up with a whole number of cycles per period.`;
}

export function describeComponent(comp) {
  const def = SIGNALS[comp.type];
  return `${def.label} · ${def.describe(comp.params, comp)}`;
}

// Samples of a signal on the simulation grid.
export function sampleSignal(fn, sim) {
  const K = Math.round(sim.duration / sim.sampleTime);
  const t = new Float64Array(K + 1), v = new Float64Array(K + 1);
  for (let k = 0; k <= K; k++) { t[k] = k * sim.sampleTime; v[k] = fn(t[k]); }
  return { t, v };
}

// Reads "t, value" rows from CSV or TSV text; a header line is skipped.
export function parseWaveform(text) {
  const pts = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.trim().split(/[\s,;]+/).filter(Boolean);
    if (cells.length < 2) continue;
    const t = Number(cells[0]), v = Number(cells[1]);
    if (Number.isFinite(t) && Number.isFinite(v)) pts.push([t, v]);
  }
  if (pts.length < 2) throw new Error('expected at least two rows of "time, value"');
  return pts.sort((a, b) => a[0] - b[0]);
}

// v1 projects had one reference block; it becomes one component, with a
// period no shorter than the v1 run so nothing repeats inside it.
export function migrateReferenceBlock(block, duration, period) {
  return { period, ...migrateComponents(block, duration) };
}

function migrateComponents(block, duration) {
  if (!block) return { components: [] };
  const q = block.params ?? {};
  switch (block.type) {
    case 'ramp': {
      const rise = Math.max(1e-9, duration - (q.time ?? 1));
      return { components: [{ type: 'ramp', params: { amplitude: (q.slope ?? 0.1) * rise, time: q.time ?? 1, rise } }] };
    }
    case 'square': return { components: [{ type: 'square', params: { amplitude: q.amplitude, time: q.time, period: q.period, width: (q.duty ?? 0.5) * (q.period ?? 10), count: 0 } }] };
    case 'sine': return { components: [{ type: 'sine', params: { amplitude: q.amplitude, time: q.time, frequency: q.frequency } }] };
    case 'staircase': {
      const comps = [];
      for (let t = q.time ?? 1; t < duration; t += q.interval ?? 5) comps.push({ type: 'step', params: { amplitude: q.height ?? 0.5, time: t } });
      return { components: comps };
    }
    default: return { components: [{ type: block.type, params: q }] };
  }
}
