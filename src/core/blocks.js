// The block library. Every block type registers here with the slot it fits,
// its parameters (with ranges the UI and the tuner use) and its behaviour:
//   tf(p)     -> { num, den, delay }   linear SISO element (actuator, plant, sensor, controller)
//   pid       -> true                  discrete PID (controller slot)
//   signal(p) -> t => value            signal source (disturbance)
//   limits(p) -> { min, max }          actuator saturation
//   noise(p)  -> { std, seed }         measurement noise
// Blocks in one slot are interchangeable: parameters with the same key carry
// over when the type changes (Kp from P to PID, K from one plant to another).

import { polyMul, polyPow } from './poly.js';

export const SLOTS = [
  { key: 'reference', label: 'Reference', symbol: 'r', scope: 'system' },
  { key: 'controller', label: 'Controller', symbol: 'C', scope: 'candidate' },
  { key: 'actuator', label: 'Actuator', symbol: 'A', scope: 'system' },
  { key: 'disturbance', label: 'Disturbance', symbol: 'd', scope: 'system' },
  { key: 'plant', label: 'Plant', symbol: 'P', scope: 'system' },
  { key: 'sensor', label: 'Sensor', symbol: 'S', scope: 'system' },
  { key: 'noise', label: 'Noise', symbol: 'n', scope: 'system' },
];

// Parameter helpers. scale: 'lin' | 'log' | 'log0' (log with an off position at 0).
// max: 'duration' resolves to the simulation duration.
const num = (key, label, def, min, max, scale = 'lin', extra = {}) => ({ key, label, default: def, min, max, scale, ...extra });
const gain = (key, label, def, extra) => num(key, label, def, 0.01, 100, 'log', extra);
const tau = (key, label, def, extra) => num(key, label, def, 0.001, 1000, 'log', { unit: 's', ...extra });
const time = (key, label, def) => num(key, label, def, 0, 'duration', 'lin', { unit: 's' });
const amp = (key, label, def) => num(key, label, def, -10, 10, 'lin');
const vec = (key, label, def) => ({ key, label, default: def, kind: 'vector' });
// A physical parameter of a plant block: Identify's hidden variation scales it
// (varyDiagram, identify.js). A transfer function's denominator varies term by
// term (the motor's 1/(L·s + R): L and R); its numerator is structure.
const VARY = { vary: true };

const lag = (t) => [t, 1];

// A polynomial in s, highest power first: [0.01, 1] -> "0.01s + 1",
// [1, 0, 2] -> "s² + 2". paren: in brackets when it has more than one term.
const SUP = ['', '', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
export function polyText(c, paren = false) {
  const n = c.length - 1;
  const terms = [];
  c.forEach((v, i) => {
    const k = n - i;
    if (v === 0) return;
    const mag = Number(Math.abs(v).toPrecision(4));
    const coef = k > 0 && mag === 1 ? '' : String(mag);
    terms.push([v < 0 ? '−' : '+', `${coef}${k > 0 ? `s${SUP[k] ?? `^${k}`}` : ''}`]);
  });
  if (!terms.length) return '0';
  const text = terms.map(([sg, t], i) => (i ? ` ${sg} ${t}` : sg === '−' ? `−${t}` : t)).join('');
  return paren && terms.length > 1 ? `(${text})` : text;
}

const BLOCK_LIST = [
  // Reference and disturbance sources
  {
    type: 'step', slots: ['disturbance'], label: 'Step', formula: 'A · 1(t − t₀)',
    params: [amp('amplitude', 'A', 1), time('time', 't₀', 1)],
    signal: (p) => (t) => (t >= p.time ? p.amplitude : 0),
  },
  {
    type: 'square', slots: ['disturbance'], label: 'Square', formula: 'A · square(t − t₀, T)',
    params: [amp('amplitude', 'A', 1), time('time', 't₀', 1), num('period', 'T', 10, 0.01, 1000, 'log', { unit: 's' }), num('duty', 'duty', 0.5, 0.05, 0.95)],
    signal: (p) => (t) => (t >= p.time && ((t - p.time) % p.period) < p.duty * p.period ? p.amplitude : 0),
  },
  {
    type: 'pulse', slots: ['disturbance'], label: 'Pulse', formula: 'A for t₀ ≤ t < t₀ + w',
    params: [amp('amplitude', 'A', 1), time('time', 't₀', 1), num('width', 'w', 1, 0.001, 1000, 'log', { unit: 's' })],
    signal: (p) => (t) => (t >= p.time && t < p.time + p.width ? p.amplitude : 0),
  },
  {
    type: 'ramp', slots: ['disturbance'], label: 'Ramp', formula: 'k · (t − t₀) · 1(t − t₀)',
    params: [amp('slope', 'k', 0.1), time('time', 't₀', 1)],
    signal: (p) => (t) => (t >= p.time ? p.slope * (t - p.time) : 0),
  },
  {
    type: 'sine', slots: ['disturbance'], label: 'Sine', formula: 'A · sin(2πf (t − t₀))',
    params: [amp('amplitude', 'A', 1), time('time', 't₀', 0), num('frequency', 'f', 0.1, 0.001, 100, 'log', { unit: 'Hz' })],
    signal: (p) => (t) => (t >= p.time ? p.amplitude * Math.sin(2 * Math.PI * p.frequency * (t - p.time)) : 0),
  },
  {
    type: 'none', slots: ['disturbance'], label: 'None', formula: '0',
    params: [], signal: () => () => 0,
  },

  // Controllers (per candidate)
  {
    type: 'P', slots: ['controller'], label: 'P', formula: 'Kp · e',
    params: [gain('Kp', 'Kp', 1, { tunable: true })], pid: true,
  },
  {
    type: 'PI', slots: ['controller'], label: 'PI', formula: 'Kp (b·r − y) + Ki ∫e',
    params: [gain('Kp', 'Kp', 1, { tunable: true }), num('Ki', 'Ki', 0.5, 0.001, 100, 'log0', { tunable: true }), num('b', 'b', 1, 0, 1)],
    pid: true,
  },
  {
    type: 'PD', slots: ['controller'], label: 'PD', formula: 'Kp e + Kd s/(Tf s + 1) (c·r − y)',
    params: [gain('Kp', 'Kp', 1, { tunable: true }), num('Kd', 'Kd', 0.5, 0.001, 100, 'log0', { tunable: true }), tau('Tf', 'Tf', 0.05), num('c', 'c', 0, 0, 1)],
    pid: true,
  },
  {
    type: 'PID', slots: ['controller'], label: 'PID', formula: 'Kp (b·r − y) + Ki ∫e + Kd s/(Tf s + 1) (c·r − y)',
    params: [
      gain('Kp', 'Kp', 1, { tunable: true }), num('Ki', 'Ki', 0.5, 0.001, 100, 'log0', { tunable: true }),
      num('Kd', 'Kd', 0.5, 0.001, 100, 'log0', { tunable: true }), tau('Tf', 'Tf', 0.05),
      num('b', 'b', 1, 0, 1), num('c', 'c', 0, 0, 1),
    ],
    pid: true,
  },
  {
    type: 'leadLag', slots: ['controller'], label: 'Lead / lag', formula: 'K (Tz s + 1) / (Tp s + 1)',
    params: [gain('K', 'K', 1, { tunable: true }), tau('Tz', 'Tz', 1, { tunable: true }), tau('Tp', 'Tp', 0.1, { tunable: true })],
    tf: (p) => ({ num: [p.K * p.Tz, p.K], den: [p.Tp, 1], delay: 0 }),
  },
  {
    type: 'tf', slots: ['controller', 'actuator', 'plant', 'sensor'], label: 'Transfer function', formula: 'num(s) / den(s) · e^(−T_d·s)',
    params: [vec('num', 'num', [1]), { ...vec('den', 'den', [1, 1]), vary: true }, num('delay', 'Dead time T_d', 0, 0.001, 100, 'log0', { unit: 's', vary: true })],
    tf: (p) => ({ num: p.num, den: p.den, delay: p.delay }),
    // Its face in the diagram: the transfer function with its coefficients.
    summary: (p) => `${polyText(p.num)} / ${polyText(p.den, true)}${p.delay > 0 ? ` · e^(−${Number(p.delay.toPrecision(3))}s)` : ''}`,
  },

  // Actuators
  {
    type: 'ideal', slots: ['actuator', 'sensor'], label: 'Ideal', formula: '1',
    params: [], tf: () => ({ num: [1], den: [1], delay: 0 }),
  },
  {
    type: 'saturation', slots: ['actuator'], label: 'Saturation', formula: 'clamp(u, u_min, u_max)',
    params: [amp('uMin', 'u min', -2), amp('uMax', 'u max', 2)],
    tf: () => ({ num: [1], den: [1], delay: 0 }), limits: (p) => ({ min: p.uMin, max: p.uMax }),
  },
  {
    type: 'lag', slots: ['actuator', 'sensor'], label: 'First-order lag', formula: '1 / (τ s + 1)',
    params: [tau('tau', 'τ', 0.1)], tf: (p) => ({ num: [1], den: lag(p.tau), delay: 0 }),
  },
  {
    type: 'lagSaturation', slots: ['actuator'], label: 'Lag + saturation', formula: 'clamp(u) → 1 / (τ s + 1)',
    params: [tau('tau', 'τ', 0.1), amp('uMin', 'u min', -2), amp('uMax', 'u max', 2)],
    tf: (p) => ({ num: [1], den: lag(p.tau), delay: 0 }), limits: (p) => ({ min: p.uMin, max: p.uMax }),
  },

  // Plants
  {
    type: 'firstOrder', slots: ['plant'], label: 'First order', formula: 'K / (τ s + 1)',
    params: [gain('K', 'K', 1, VARY), tau('tau', 'τ', 1, VARY)], tf: (p) => ({ num: [p.K], den: lag(p.tau), delay: 0 }),
  },
  {
    type: 'fopdt', slots: ['plant'], label: 'First order + dead time', formula: 'K e^(−T_d·s) / (τ s + 1)',
    params: [gain('K', 'K', 1, VARY), tau('tau', 'τ', 1, VARY), num('delay', 'Dead time T_d', 0.5, 0.001, 100, 'log0', { unit: 's', vary: true })],
    tf: (p) => ({ num: [p.K], den: lag(p.tau), delay: p.delay }),
  },
  {
    type: 'secondOrder', slots: ['plant'], label: 'Second order', formula: 'K ωn² / (s² + 2ζωn s + ωn²)',
    params: [gain('K', 'K', 1, VARY), num('wn', 'ωn', 1, 0.01, 1000, 'log', { unit: 'rad/s', vary: true }), num('zeta', 'ζ', 0.3, 0.001, 10, 'log0', VARY)],
    tf: (p) => ({ num: [p.K * p.wn * p.wn], den: [1, 2 * p.zeta * p.wn, p.wn * p.wn], delay: 0 }),
  },
  {
    type: 'lagChain', slots: ['plant'], label: 'n equal lags', formula: 'K / (τ s + 1)ⁿ',
    params: [gain('K', 'K', 1, VARY), tau('tau', 'τ', 1, VARY), num('n', 'n', 3, 1, 8, 'lin', { int: true })],
    tf: (p) => ({ num: [p.K], den: polyPow(lag(p.tau), Math.round(p.n)), delay: 0 }),
  },
  {
    type: 'integratorLag', slots: ['plant'], label: 'Integrator + lag', formula: 'K / (s (τ s + 1))',
    params: [gain('K', 'K', 1, VARY), tau('tau', 'τ', 0.5, VARY)], tf: (p) => ({ num: [p.K], den: [p.tau, 1, 0], delay: 0 }),
  },
  {
    type: 'doubleIntegrator', slots: ['plant'], label: 'Double integrator', formula: 'K / s²',
    params: [gain('K', 'K', 1, VARY)], tf: (p) => ({ num: [p.K], den: [1, 0, 0], delay: 0 }),
  },
  {
    type: 'inverseResponse', slots: ['plant'], label: 'Inverse response', formula: 'K (1 − Tz s) / ((τ₁ s + 1)(τ₂ s + 1))',
    params: [gain('K', 'K', 1, VARY), tau('Tz', 'Tz', 0.5, VARY), tau('tau1', 'τ₁', 1, VARY), tau('tau2', 'τ₂', 2, VARY)],
    tf: (p) => ({ num: [-p.K * p.Tz, p.K], den: polyMul(lag(p.tau1), lag(p.tau2)), delay: 0 }),
  },

  // Sensors
  {
    type: 'gain', slots: ['sensor'], label: 'Gain', formula: 'K',
    params: [gain('K', 'K', 1)], tf: (p) => ({ num: [p.K], den: [1], delay: 0 }),
  },
  {
    type: 'delay', slots: ['sensor'], label: 'Dead time', formula: 'e^(−T_d·s)',
    params: [num('delay', 'Dead time T_d', 0.1, 0.001, 100, 'log0', { unit: 's' })], tf: (p) => ({ num: [1], den: [1], delay: p.delay }),
  },
  {
    type: 'lagDelay', slots: ['sensor'], label: 'Lag + dead time', formula: 'e^(−T_d·s) / (τ s + 1)',
    params: [tau('tau', 'τ', 0.1), num('delay', 'Dead time T_d', 0.1, 0.001, 100, 'log0', { unit: 's' })],
    tf: (p) => ({ num: [1], den: lag(p.tau), delay: p.delay }),
  },

  // Measurement noise
  { type: 'none', slots: ['noise'], label: 'None', formula: '0', params: [], noise: () => ({ std: 0, seed: 1 }) },
  {
    type: 'white', slots: ['noise'], label: 'White noise', formula: 'n ~ N(0, σ²)',
    params: [num('std', 'σ', 0.01, 0.0001, 1, 'log'), num('seed', 'seed', 1, 1, 999, 'lin', { int: true })],
    noise: (p) => ({ std: p.std, seed: p.seed }),
  },
];

// Registry keyed by slot, then type. A type name may appear in several slots.
export const BLOCKS = {};
for (const s of SLOTS) BLOCKS[s.key] = {};
for (const b of BLOCK_LIST) for (const s of b.slots) BLOCKS[s][b.type] = b;

export function blockDef(slot, type) {
  const bySlot = BLOCKS[slot];
  if (!bySlot) throw new Error(`unknown slot "${slot}"; slots: ${SLOTS.map((s) => s.key).join(', ')}`);
  const def = bySlot[type];
  if (!def) throw new Error(`unknown ${slot} type "${type}"; types: ${Object.keys(bySlot).join(', ')}`);
  return def;
}

export function paramMax(param, ctx) {
  return param.max === 'duration' ? ctx.duration : param.max;
}

// Fill missing params with defaults and drop unknown ones. Fails fast on an
// unknown type, a non-finite number or a malformed vector.
export function normalizeBlock(slot, block) {
  if (!block || typeof block.type !== 'string') throw new Error(`${slot}: block needs a "type"`);
  const def = blockDef(slot, block.type);
  const params = {};
  for (const p of def.params) {
    let v = block.params?.[p.key];
    if (v === undefined || v === null) v = p.default;
    if (p.kind === 'vector') {
      if (!Array.isArray(v) || v.length === 0 || !v.every((x) => Number.isFinite(Number(x)))) throw new Error(`${slot}.${p.key}: expected a list of numbers`);
      v = v.map(Number);
    } else {
      v = Number(v);
      if (!Number.isFinite(v)) throw new Error(`${slot}.${p.key}: expected a number`);
      if (p.int) v = Math.round(v);
    }
    params[p.key] = v;
  }
  return { type: block.type, params };
}

// Switch a block to another type, carrying over parameters that share a key.
// stash holds parameters the slot had under earlier types, so switching back
// restores them.
export function retypeBlock(slot, block, newType, stash = {}) {
  const def = blockDef(slot, newType);
  const params = {};
  for (const p of def.params) {
    if (block.params && p.key in block.params) params[p.key] = block.params[p.key];
    else if (stash[newType] && p.key in stash[newType]) params[p.key] = stash[newType][p.key];
  }
  return normalizeBlock(slot, { type: newType, params });
}
