// Block diagrams: the plant as blocks wired together, with subsystems that
// nest. A diagram is plain JSON:
//   { "blocks": [ { "id": "b1", "type": "firstOrder", "params": { "K": 1, "tau": 1 }, "x": 200, "y": 80 }, ... ],
//     "wires":  [ { "from": "in", "to": "b1" }, { "from": "b1", "to": "sum:1" } ] }
// A wire end is a block id, optionally with ":port" (0-based; default 0).
// A subsystem block carries its own "diagram"; its In and Out blocks become
// its ports, numbered by their "port" parameter.
//
// compileDiagram flattens subsystems and orders the blocks so that every
// block that passes its input straight through (gain, sum, ...) is evaluated
// after its inputs; a loop made only of such blocks is an algebraic loop and
// is refused, as in Simulink. Feedback through a block with state is fine.

import { BLOCKS, blockDef, normalizeBlock } from './blocks.js';
import { tf2ss, rootBound } from './poly.js';
import { gaussAt } from './signals.js';
import { compileExpr } from './expr.js';
import { normalizeVariant, makeLaw } from './controllers.js';
import { OBSERVERS } from './observers.js';

const num = (key, label, def, extra = {}) => ({ key, label, default: def, ...extra });

// Elementary blocks. Plant models from blocks.js (first order, n lags, ...)
// are diagram blocks too: their transfer function becomes the block.
export const ELEMENTS = {
  source: { label: 'Source', group: 'Signals', params: [{ key: 'signal', label: 'Signal', default: 'r', kind: 'name' }, { key: 'unit', label: 'Unit', default: '1', kind: 'unit' }], ports: () => [0, 1], formula: 'r(t)' },
  sink: { label: 'Sink', group: 'Signals', params: [{ key: 'name', label: 'Name', default: 'y1', kind: 'name' }, { key: 'unit', label: 'Unit', default: '1', kind: 'unit' }], ports: () => [1, 0], formula: 'y' },
  terminator: { label: 'Terminator', group: 'Signals', params: [], ports: () => [1, 0], formula: 'ends a signal' },
  switch: {
    label: 'Switch', group: 'Math', formula: 'passes one input',
    params: [num('inputs', 'Inputs', 2, { min: 2, int: true }), num('position', 'Position', 1, { min: 1, int: true })],
    ports: (p) => [p.inputs, 1],
  },
  inport: { label: 'In', group: 'Ports', params: [num('port', 'Port', 1, { min: 1, int: true })], ports: () => [0, 1], formula: 'u' },
  outport: { label: 'Out', group: 'Ports', params: [num('port', 'Port', 1, { min: 1, int: true })], ports: () => [1, 0], formula: 'y' },
  gain: { label: 'Gain', group: 'Math', params: [num('K', 'K', 1)], ports: () => [1, 1], formula: 'K' },
  sum: { label: 'Sum', group: 'Math', params: [{ key: 'signs', label: 'Signs', default: '+-', kind: 'signs' }], ports: (p) => [p.signs.length, 1], formula: 'Σ' },
  integrator: { label: 'Integrator', group: 'Dynamics', params: [num('K', 'K', 1)], ports: () => [1, 1], formula: 'K / s', tf: (p) => ({ num: [p.K], den: [1, 0] }) },
  // y0 empty (null): before L it puts out its input at t = 0, as a pipe that
  // was already flowing; nothing plant-specific has to be typed in for that.
  delay: { label: 'Dead time', group: 'Dynamics', params: [num('L', 'L', 0.1, { unit: 's', min: 0 }), num('y0', 'Output before L', 0, { nullable: 'its input at t = 0' })], ports: () => [1, 1], formula: 'e^(−Ls)' },
  fcn: { label: 'Function', group: 'Math', params: [{ key: 'expr', label: 'y = f(u)', default: 'u^2', kind: 'expr' }], ports: () => [1, 1], formula: 'f(u)' },
  saturation: { label: 'Saturation', group: 'Nonlinear', params: [num('min', 'Min', -1), num('max', 'Max', 1)], ports: () => [1, 1], formula: 'clamp' },
  quantizer: { label: 'Quantizer', group: 'Sensors', params: [num('q', 'Step', 0.01, { min: 1e-12 })], ports: () => [1, 1], formula: 'q · round(u / q)' },
  noise: { label: 'Noise', group: 'Sensors', params: [num('std', 'σ', 0.01, { min: 0 }), num('seed', 'Seed', 1, { int: true, min: 0 })], ports: () => [1, 1], formula: 'u + n,  n ~ N(0, σ²)' },
  cartPole: {
    // Point mass m on a massless pole of length l, hinged on a cart of mass M.
    // θ = 0 is upright, positive leaning towards +x. b is the cart's friction.
    label: 'Cart–pole', group: 'Physics', formula: 'F → x, θ, v, ω', outputs: ['x', 'θ', 'v', 'ω'], ports: () => [1, 4],
    params: [num('M', 'Cart M', 1, { unit: 'kg', min: 1e-6 }), num('m', 'Bob m', 0.2, { unit: 'kg', min: 1e-6 }), num('l', 'Length l', 0.5, { unit: 'm', min: 1e-6 }), num('g', 'g', 9.81, { unit: 'm/s²' }), num('b', 'Friction b', 0.1, { unit: 'N·s/m', min: 0 }), num('theta0', 'Start θ₀', 0.05, { unit: 'rad' })],
    ode: {
      n: 4,
      states: () => [state('x', 'm'), state('v', 'm/s'), state('θ', 'rad', true), state('ω', 'rad/s')],
      init: (p) => [0, 0, p.theta0, 0],
      out: (X, o, p, y) => { y[0] = X[o]; y[1] = X[o + 2]; y[2] = X[o + 1]; y[3] = X[o + 3]; },
      make(p) {
        const { M, m, l, g, b } = p, ml = m * l, mg = m * g;
        return (X, o, u, dX) => {
          const v = X[o + 1], th = X[o + 2], w = X[o + 3];
          const s = Math.sin(th), c = Math.cos(th);
          const a = (u - b * v + ml * w * w * s - mg * s * c) / (M + m * s * s);
          dX[o] = v; dX[o + 1] = a; dX[o + 2] = w; dX[o + 3] = (g * s - a * c) / l;
        };
      },
      bound: (p) => 2 * Math.sqrt(p.g * (p.M + p.m) / (p.M * p.l)) + p.b / p.M,
    },
  },
  pendulumCart: {
    // A chain of 1–3 rods on a cart (mass M): point masses m1, m2, m3 at the
    // ends of massless rods l1, l2, l3, each hinged on the one before. Angles
    // from upright, positive leaning towards +x. Lagrange's equations
    // M(q) q̈ = f(q, q̇, F) are solved at each evaluation (chainRates).
    label: 'Pendulum chain on cart', group: 'Physics', formula: 'F → x, θ…, v, ω…',
    outputs: (p) => ['x', ...links(p).map((i) => `θ${i + 1}`), 'v', ...links(p).map((i) => `ω${i + 1}`)],
    ports: (p) => [1, 2 * p.links + 2],
    params: [num('links', 'Links', 3, { min: 1, int: true, max: 3 }), num('M', 'Cart M', 1, { unit: 'kg', min: 1e-6 }),
      ...[1, 2, 3].flatMap((i) => [num(`m${i}`, `Mass m${i}`, 0.1, { unit: 'kg', min: 1e-6 }), num(`l${i}`, `Rod l${i}`, 0.25, { unit: 'm', min: 1e-6 })]),
      num('g', 'g', 9.81, { unit: 'm/s²' }), num('b', 'Friction b', 0.1, { unit: 'N·s/m', min: 0 }),
      ...[1, 2, 3].map((i) => num(`theta${i}0`, `Start θ${i}₀`, i === 1 ? 0.05 : 0, { unit: 'rad' }))],
    ode: {
      n: (p) => 2 * p.links + 2,
      states: (p) => [state('x', 'm'), ...links(p).map((i) => state(`θ${i + 1}`, 'rad', true)), state('v', 'm/s'), ...links(p).map((i) => state(`ω${i + 1}`, 'rad/s'))],
      init: (p) => { const n = p.links; return [0, ...links(p).map((i) => p[`theta${i + 1}0`]), 0, ...new Array(n).fill(0)]; },
      out: (X, o, p, y) => { for (let i = 0; i < 2 * p.links + 2; i++) y[i] = X[o + i]; },
      make: (p) => chainRates(p),
      bound: (p) => 4 * Math.sqrt((p.g / Math.min(...links(p).map((i) => p[`l${i + 1}`]))) * (1 + p.links)) + p.b / p.M,
    },
  },
  conicalTank: {
    // A tank that widens upwards (radius r0 at the bottom, R at height H),
    // filled at q and draining through an outlet of area a (Torricelli). Its
    // dynamics are fast when nearly empty and slow when full.
    label: 'Conical tank', group: 'Physics', formula: 'q → h', outputs: ['h'], ports: () => [1, 1],
    params: [num('r0', 'Bottom radius r0', 0.05, { unit: 'm', min: 1e-4 }), num('R', 'Top radius R', 0.5, { unit: 'm', min: 1e-4 }), num('H', 'Height H', 1, { unit: 'm', min: 1e-3 }), num('a', 'Outlet area a', 0.1, { unit: 'm²', min: 0 }), num('g', 'g', 9.81, { unit: 'm/s²' }), num('h0', 'Start level h₀', 0.25, { unit: 'm', min: 0 })],
    ode: {
      n: 1,
      states: () => [state('h', 'm')],
      init: (p) => [p.h0],
      out: (X, o, p, y) => { y[0] = X[o]; },
      make(p) {
        const { r0, H } = p, slope = (p.R - r0) / H, out = p.a * Math.sqrt(2 * p.g);
        return (X, o, u, dX) => {
          const h = Math.max(0, X[o]);
          const r = r0 + slope * Math.min(h, H);
          const flow = Math.max(0, u) - out * Math.sqrt(h);
          dX[o] = h <= 0 && flow < 0 ? 0 : flow / (Math.PI * r * r);
        };
      },
      bound: (p) => (p.a * Math.sqrt(2 * p.g)) / (Math.PI * p.r0 * p.r0 * 2 * Math.sqrt(0.01)),
    },
  },
  // A digital controller: inputs r, y1, y2, …; output u, held between samples.
  // It holds one or more variants (implementations from controllers.js with
  // this same interface); "variant" is the index of the one that runs.
  controller: {
    label: 'Controller', group: 'Control', formula: 'u = C(r, y)',
    params: [num('inputs', 'Inputs (r, y…)', 2, { min: 1, int: true }), num('Ts', 'Sample time Ts', 0.01, { unit: 's', min: 1e-4 })],
    ports: (p) => [p.inputs, 1],
  },
  // An observer: inputs u, y1, y2, …; outputs the estimated states, held
  // between samples. Built like a controller, with variants from observers.js.
  observer: {
    label: 'Observer', group: 'Control', formula: 'x̂ = O(u, y)',
    params: [num('inputs', 'Inputs (u, y…)', 2, { min: 2, int: true }), num('outputs', 'Estimates', 2, { min: 1, int: true }), num('Ts', 'Sample time Ts', 0.001, { unit: 's', min: 1e-4 })],
    ports: (p) => [p.inputs, p.outputs],
    outputs: (p) => Array.from({ length: p.outputs }, (_, i) => `x̂${i + 1}`),
  },
  subsystem: { label: 'Subsystem', group: 'Structure', params: [], ports: null, formula: '' },
};

const VARIANT_LIBS = { controller: undefined, observer: OBSERVERS };

const links = (p) => Array.from({ length: p.links }, (_, i) => i);

// A state of a physics block, as ode.states lists it; angle: compared
// modulo 2π (a pendulum that went round once is where it started).
const state = (name, unit, angle = false) => ({ name, unit, angle });

// The chain's rate function for parameters p, allocation-free (the swing-up
// planner calls it millions of times). Constants are computed once: the mass
// at or beyond each link μj and its products. Per call: one sin and one cos
// per angle (differences by the angle-sum identities), the mass matrix
// M(q) q̈ = r built in a scratch buffer and solved by Cholesky without
// square roots (LDLᵀ; M(q) is positive definite, so no pivoting).
function chainRates(p) {
  const n = p.links, N = n + 1, { g, b } = p;
  const mu = new Float64Array(n), ml = new Float64Array(n), mgl = new Float64Array(n), mll = new Float64Array(n * n);
  for (let i = n - 1, acc = 0; i >= 0; i--) { acc += p[`m${i + 1}`]; mu[i] = acc; }
  for (let j = 0; j < n; j++) {
    const lj = p[`l${j + 1}`];
    ml[j] = mu[j] * lj; mgl[j] = mu[j] * g * lj;
    for (let k = 0; k < n; k++) mll[j * n + k] = mu[Math.max(j, k)] * lj * p[`l${k + 1}`];
  }
  const total = p.M + mu[0];
  const s = new Float64Array(n), c = new Float64Array(n), w2 = new Float64Array(n);
  const A = new Float64Array(N * N), r = new Float64Array(N), q = new Float64Array(N);
  return (X, o, u, dX) => {
    for (let j = 0; j < n; j++) {
      const th = X[o + 1 + j], w = X[o + n + 2 + j];
      s[j] = Math.sin(th); c[j] = Math.cos(th); w2[j] = w * w;
    }
    // Lower triangle of M(q) and the right-hand side r.
    A[0] = total;
    r[0] = u - b * X[o + n + 1];
    for (let j = 0; j < n; j++) {
      const row = (j + 1) * N;
      A[row] = ml[j] * c[j];
      r[0] += ml[j] * s[j] * w2[j];
      let rj = mgl[j] * s[j];
      for (let k = 0; k < n; k++) {
        const cjk = c[j] * c[k] + s[j] * s[k], sjk = s[j] * c[k] - c[j] * s[k];   // cos, sin of θj − θk
        if (k <= j) A[row + k + 1] = mll[j * n + k] * cjk;
        rj -= mll[j * n + k] * sjk * w2[k];
      }
      r[j + 1] = rj;
    }
    // LDLᵀ in place: L below the diagonal (unit diagonal implied), D on it.
    for (let j = 0; j < N; j++) {
      let d = A[j * N + j];
      for (let k = 0; k < j; k++) d -= A[j * N + k] * A[j * N + k] * A[k * N + k];
      A[j * N + j] = d;
      for (let i = j + 1; i < N; i++) {
        let e = A[i * N + j];
        for (let k = 0; k < j; k++) e -= A[i * N + k] * A[j * N + k] * A[k * N + k];
        A[i * N + j] = e / d;
      }
    }
    for (let i = 0; i < N; i++) { let e = r[i]; for (let k = 0; k < i; k++) e -= A[i * N + k] * q[k]; q[i] = e; }
    for (let i = 0; i < N; i++) q[i] /= A[i * N + i];
    for (let i = N - 1; i >= 0; i--) { let e = q[i]; for (let k = i + 1; k < N; k++) e -= A[k * N + i] * q[k]; q[i] = e; }
    dX[o] = X[o + n + 1];
    for (let j = 0; j < n; j++) { dX[o + 1 + j] = X[o + n + 2 + j]; dX[o + n + 2 + j] = q[j + 1]; }
    dX[o + n + 1] = q[0];
  };
}

// Output names of a block (physics blocks may depend on their parameters).
export function outputNames(def, params) {
  return typeof def.outputs === 'function' ? def.outputs(params) : def.outputs ?? [];
}

// Every type a diagram can hold, with its label, group, params and ports.
export function diagramBlockDef(type) {
  if (ELEMENTS[type]) return ELEMENTS[type];
  const b = BLOCKS.plant[type];
  if (!b) throw new Error(`unknown block type "${type}"; types: ${[...Object.keys(ELEMENTS), ...Object.keys(BLOCKS.plant)].join(', ')}`);
  return { label: b.label, group: 'Models', params: b.params, ports: () => [1, 1], formula: b.formula, tf: (p) => b.tf(p), model: true };
}

export function diagramTypes() {
  return [...Object.keys(ELEMENTS), ...Object.keys(BLOCKS.plant)];
}

// [inputs, outputs] of a block.
export function blockPorts(block) {
  if (block.type === 'subsystem') {
    const count = (t) => Math.max(0, ...block.diagram.blocks.filter((b) => b.type === t).map((b) => b.params.port));
    return [count('inport'), count('outport')];
  }
  return diagramBlockDef(block.type).ports(block.params);
}

export function parseEnd(end) {
  const [id, port] = String(end).split(':');
  return { id, port: port === undefined ? 0 : Number(port) };
}

function normalizeParams(type, params = {}, where) {
  if (diagramBlockDef(type).model) return normalizeBlock('plant', { type, params }).params;
  const out = {};
  for (const p of ELEMENTS[type].params) {
    let v = params[p.key] ?? p.default;
    if (p.kind === 'unit') {
      v = String(v).trim() || '1';
      if (v.length > 12 || /[<>"{}]/.test(v)) throw new Error(`${where}.${p.key}: a short unit such as m, N, rad/s, or 1`);
    } else if (p.kind === 'name') {
      v = String(v);
      if (!/^[A-Za-z][A-Za-z0-9_]{0,11}$/.test(v)) throw new Error(`${where}.${p.key}: a name such as r, d or y1 (letters, digits, _)`);
    } else if (p.kind === 'expr') {
      v = String(v).trim();
      try { compileExpr(v, { vars: true }); } catch (e) { throw new Error(`${where}.${p.key}: ${e.message}`); }
    } else if (p.kind === 'signs') {
      v = String(v);
      if (!/^[+-]{1,8}$/.test(v)) throw new Error(`${where}.signs: one to eight of + and -`);
    } else if (p.nullable && (params[p.key] === null || params[p.key] === '')) {
      v = null;   // empty: the meaning p.nullable names
    } else {
      v = Number(v);
      if (!Number.isFinite(v)) throw new Error(`${where}.${p.key}: expected a number`);
      if (p.int) v = Math.round(v);
      if (p.min !== undefined && v < p.min) throw new Error(`${where}.${p.key}: at least ${p.min}`);
      if (p.max !== undefined && v > p.max) throw new Error(`${where}.${p.key}: at most ${p.max}`);
    }
    out[p.key] = v;
  }
  if (type === 'switch') out.position = Math.min(out.position, out.inputs);
  return out;
}

export function normalizeDiagram(d, path = 'plant') {
  if (!d || !Array.isArray(d.blocks)) throw new Error(`${path}: a diagram needs "blocks" and "wires"`);
  const ids = new Set();
  const blocks = d.blocks.map((b, i) => {
    const where = `${path}.blocks[${i}]`;
    if (!b.id || typeof b.id !== 'string' || /[:/]/.test(b.id)) throw new Error(`${where}: needs an "id" without ":" or "/"`);
    if (ids.has(b.id)) throw new Error(`${where}: duplicate id "${b.id}"`);
    ids.add(b.id);
    const out = { id: b.id, type: b.type, params: normalizeParams(b.type, b.params, `${where}(${b.id})`), x: Number(b.x) || 0, y: Number(b.y) || 0 };
    if (b.name) out.name = String(b.name);
    if (b.flip) out.flip = true;
    if (b.type === 'subsystem') out.diagram = normalizeDiagram(b.diagram ?? { blocks: [], wires: [] }, `${path}/${b.id}`);
    if (b.type === 'controller' || b.type === 'observer') {
      const lib = VARIANT_LIBS[b.type];
      const vs = Array.isArray(b.variants) && b.variants.length ? b.variants : [{ type: b.type === 'observer' ? 'difference' : 'pid' }];
      out.variants = vs.map((v, j) => normalizeVariant(v, `${where}(${b.id}).variants[${j}]`, lib));
      out.variant = Math.min(Math.max(0, Math.round(Number(b.variant) || 0)), out.variants.length - 1);
    }
    return out;
  });
  const byId = Object.fromEntries(blocks.map((b) => [b.id, b]));
  const wires = (d.wires ?? []).map((w, i) => {
    const f = parseEnd(w.from), t = parseEnd(w.to);
    for (const [e, side] of [[f, 1], [t, 0]]) {
      const b = byId[e.id];
      if (!b) throw new Error(`${path}.wires[${i}]: no block "${e.id}"`);
      const n = blockPorts(b)[side];
      if (!(e.port >= 0 && e.port < n)) throw new Error(`${path}.wires[${i}]: ${b.id} has no ${side ? 'output' : 'input'} ${e.port}`);
    }
    return { from: f.port ? `${f.id}:${f.port}` : f.id, to: t.port ? `${t.id}:${t.port}` : t.id };
  });
  const taken = new Set();
  for (const w of wires) {
    if (taken.has(w.to)) throw new Error(`${path}: input ${w.to} has two wires`);
    taken.add(w.to);
  }
  return { blocks, wires };
}

// A single plant model as a diagram: In -> block -> Out.
export function wrapPlant(block) {
  return {
    blocks: [
      { id: 'in', type: 'inport', params: { port: 1 }, x: 40, y: 80 },
      { id: 'p1', type: block.type, params: { ...block.params }, x: 180, y: 70 },
      { id: 'out', type: 'outport', params: { port: 1 }, x: 380, y: 80 },
    ],
    wires: [{ from: 'in', to: 'p1' }, { from: 'p1', to: 'out' }],
  };
}

// The plant slot holds either a single model block or a diagram.
export function plantDiagram(plant) {
  return plant.type === 'diagram' ? plant.diagram : wrapPlant(plant);
}

// Names of the Source signals and the Sinks anywhere in a diagram, and the
// unit each one is given ("1" when none).
export function diagramNames(diagram) {
  const sources = new Set(), sinks = [], units = {};
  const walk = (d) => {
    for (const b of d.blocks) {
      if (b.type === 'source') { sources.add(b.params.signal); units[b.params.signal] ??= b.params.unit ?? '1'; }
      if (b.type === 'sink') { sinks.push(b.params.name); units[b.params.name] = b.params.unit ?? '1'; }
      if (b.type === 'subsystem') walk(b.diagram);
    }
  };
  walk(diagram);
  return { sources: [...sources], sinks, units };
}

// What feeds each input of a block, by name, as the Controller tab shows it:
// a Source's signal ("r"), a block's output ("x", "θ"), else the block's
// name ("Motor"); "not connected" when nothing is wired. idPath: the ids of
// the subsystems it sits in and its own, as 'motor/ctrl' or ['motor', 'ctrl'].
export function blockInputNames(diagram, idPath) {
  const path = Array.isArray(idPath) ? idPath : String(idPath).split('/');
  const lv = path.slice(0, -1).reduce((d, id) => d?.blocks.find((b) => b.id === id)?.diagram, diagram);
  const blk = lv?.blocks.find((b) => b.id === path.at(-1));
  if (!blk) throw new Error(`no block "${path.join('/')}"`);
  return Array.from({ length: blockPorts(blk)[0] }, (_, k) => {
    const w = lv.wires.find((x) => { const t = parseEnd(x.to); return t.id === blk.id && t.port === k; });
    if (!w) return 'not connected';
    const f = parseEnd(w.from), src = lv.blocks.find((b) => b.id === f.id);
    if (src.type === 'source') return src.params.signal;
    return outputNames(diagramBlockDef(src.type), src.params)[f.port] || (src.name ?? src.id);
  });
}

// An error a design can report: a code, a sentence, and a hint.
function modelError(code, message, hint = '') {
  return Object.assign(new Error(message), { code, hint });
}
const fmt = (v) => String(Number(Number(v).toPrecision(3)));
const NONE = [];

// Flattens and compiles a diagram into a simulation element:
//   { n, bound, eval(t, X, o, u, dX) -> y, record(), probes(), warnings, states }
// opts.sources maps Source signal names to t => value. opts.standalone: the
// diagram is the whole system (no Out needed; an In reads 0).
// opts.laws === false: Controllers and Observers make no laws and put out 0
// (the Plant tab's structure check: editing the canvas never designs).
// opts.mode === 'model': the plant as a block sees it, for designs
// (design/output/designs.md). The diagram is the whole system and no laws
// are made; dead times pass straight through, a quantizer is the identity,
// noise adds 0, and Sources read the operating point's values.
// el.seen(idPath, at) then gives the Model a Controller or Observer sees.
export function compileDiagram(diagram, path = 'plant', opts = {}) {
  const model = opts.mode === 'model';
  const standalone = opts.standalone || model;
  const laws = opts.laws !== false && !model;
  const nodes = [];
  const warnings = [];
  const probeList = [];
  const add = (node) => { nodes.push({ inputs: [], ...node, i: nodes.length }); return nodes.length - 1; };
  let extNode = -1, outNode = -1;

  // Creates nodes for one level; returns, per block id, where its output
  // ports come from and where its input ports go. Each node has a name
  // (labels: 'Motor/load') and Controllers and Observers an id path
  // ('motor/ctrl'), which designs are keyed by.
  function level(d, prefix, ids, root) {
    const outs = {}, ins = {};
    for (const b of d.blocks) {
      const name = `${prefix}${b.name ?? b.id}`, idPath = `${ids}${b.id}`;
      if (b.type === 'subsystem') {
        const inner = level(b.diagram, `${name}/`, `${idPath}/`, false);
        const ports = (t) => b.diagram.blocks.filter((x) => x.type === t).sort((a, c) => a.params.port - c.params.port);
        outs[b.id] = ports('outport').map((x) => inner.outs[x.id][0]);
        ins[b.id] = ports('inport').map((x) => inner.ins[x.id][0]);
        continue;
      }
      if (b.type === 'source') {
        const fn = opts.sources?.[b.params.signal];
        if (!fn && !model) warnings.push(`${path}: no signal "${b.params.signal}" for ${name}`);
        const k = add({ kind: 'src', name, signal: b.params.signal, at: 0, ft: false, fn: fn ?? (() => 0) });
        probeList.push([b.params.signal, k]);
        outs[b.id] = [k]; ins[b.id] = [];
        continue;
      }
      if (b.type === 'sink') {
        if (probeList.some(([n2]) => n2 === b.params.name)) throw new Error(`${path}: two signals named "${b.params.name}"`);
        const k = add({ kind: 'pass', name, ft: true, inputs: [-1] });
        probeList.push([b.params.name, k]);
        outs[b.id] = []; ins[b.id] = [[k, 0]];
        continue;
      }
      if (b.type === 'terminator') {
        const k = add({ kind: 'pass', name, ft: true, inputs: [-1] });
        outs[b.id] = []; ins[b.id] = [[k, 0]];
        continue;
      }
      if (b.type === 'inport') {
        if (root && standalone) {
          const k = add({ kind: 'src', name, signal: null, at: 0, ft: false, fn: () => 0 });
          if (!model) warnings.push(`${path}: ${name} reads 0 until a controller drives the plant`);
          outs[b.id] = [k]; ins[b.id] = [];
        } else if (root) {
          if (extNode >= 0) throw new Error(`${path}: one input (In) only, for now`);
          extNode = add({ kind: 'ext', name, ft: false });
          outs[b.id] = [extNode]; ins[b.id] = [];
        } else {
          const k = add({ kind: 'pass', name, ft: true, inputs: [-1] });
          outs[b.id] = [k]; ins[b.id] = [[k, 0]];
        }
        continue;
      }
      if (b.type === 'outport') {
        const k = add({ kind: 'pass', name, ft: true, inputs: [-1] });
        if (root && !standalone) { if (outNode >= 0) throw new Error(`${path}: one output (Out) only, for now`); outNode = k; }
        outs[b.id] = [k]; ins[b.id] = [[k, 0]];
        continue;
      }
      const def = diagramBlockDef(b.type);
      const [nIn, nOut] = blockPorts(b);
      if (b.type === 'controller' || b.type === 'observer') {
        const lib = VARIANT_LIBS[b.type];
        const v = b.variants?.[b.variant ?? 0] ?? normalizeVariant({ type: b.type === 'observer' ? 'difference' : 'pid' }, b.id, lib);
        const k = add({ kind: 'ctrl', name, idPath, ft: false, observer: b.type === 'observer', variant: v, inputs: new Array(nIn).fill(-1), Ts: b.params.Ts, law: laws ? makeLaw(v, b.params.Ts, lib) : null, next: 0, u: 0, outv: new Float64Array(nOut), x: new Float64Array(nIn) });
        nodes[k].taps = b.type === 'observer' ? Array.from({ length: nOut }, (_, j) => add({ kind: 'tap', name: `${name}.x̂${j + 1}`, ft: false, parent: k, j, see: -1 })) : [];
        outs[b.id] = b.type === 'observer' ? nodes[k].taps : [k];
        ins[b.id] = nodes[k].inputs.map((_, s) => [k, s]);
        continue;
      }
      if (def.ode) {
        // A physics block: its state integrates inside the diagram; one tap
        // node per output reads what the block computed from its state.
        const k = add({ kind: 'ode', name, short: b.name ?? b.id, ft: false, ode: def.ode, rates: def.ode.make(b.params), p: b.params, inputs: new Array(nIn).fill(-1), outv: new Float64Array(nOut), bound: def.ode.bound(b.params) });
        outs[b.id] = outputNames(def, b.params).map((o, j) => add({ kind: 'tap', name: `${name}.${o}`, ft: false, parent: k, j, see: -1 }));
        ins[b.id] = nodes[k].inputs.map((_, s) => [k, s]);
        continue;
      }
      const node = { name, short: b.name ?? b.id, inputs: new Array(nIn).fill(-1) };
      if (def.tf) {
        const tf = def.tf(b.params);
        const ss = tf2ss(tf.num, tf.den);
        // First order (integrator, lag): realised with C = 1, so the state is
        // the block's output ("Motor/load" is the speed) and a model's state
        // reads as a signal of the diagram.
        if (ss.n === 1) { ss.B[0] *= ss.C[0]; ss.C[0] = 1; }
        const delay = Number(tf.delay) || 0;
        Object.assign(node, { kind: 'ss', ss, ft: ss.D !== 0 && (model || !(delay > 0)), bound: rootBound(tf.den), delay });
      } else if (b.type === 'gain') Object.assign(node, { kind: 'gain', K: b.params.K, ft: true });
      else if (b.type === 'sum') Object.assign(node, { kind: 'sum', signs: [...b.params.signs].map((c) => (c === '-' ? -1 : 1)), ft: true });
      else if (b.type === 'saturation') Object.assign(node, { kind: 'sat', lo: Math.min(b.params.min, b.params.max), hi: Math.max(b.params.min, b.params.max), ft: true });
      else if (b.type === 'delay') Object.assign(node, { kind: 'delay', L: b.params.L, y0: b.params.y0, ft: model || b.params.L <= 0 });
      else if (b.type === 'switch') Object.assign(node, { kind: 'switch', pick: b.params.position - 1, ft: true });
      else if (b.type === 'fcn') Object.assign(node, { kind: 'fcn', f: compileExpr(b.params.expr, { vars: true }), env: { u: 0, t: 0 }, ft: true });
      else if (b.type === 'quantizer') Object.assign(node, { kind: 'quant', q: b.params.q, ft: true });
      else if (b.type === 'noise') Object.assign(node, { kind: 'noise', std: b.params.std, seed: b.params.seed, ft: true });
      const k = add(node);
      outs[b.id] = [k];
      ins[b.id] = node.inputs.map((_, s) => [k, s]);
    }
    for (const w of d.wires) {
      const f = parseEnd(w.from), t = parseEnd(w.to);
      const src = outs[f.id][f.port], [dst, slot] = ins[t.id][t.port];
      nodes[dst].inputs[slot] = src;
    }
    return { outs, ins };
  }
  level(diagram, '', '', true);
  if (!standalone) {
    if (outNode < 0) throw new Error(`${path}: add an Out block for the plant output y`);
    if (extNode < 0) warnings.push(`${path}: no In block, so the plant ignores u`);
  }
  for (const nd of nodes) nd.inputs.forEach((s, i) => { if (s < 0) warnings.push(`${path}: ${nd.name} input ${i + 1} is not connected (reads 0)`); });

  // Evaluation order: blocks whose output does not depend on their input
  // first, then pass-through blocks after their inputs.
  const order = nodes.map((nd, i) => i).filter((i) => !nodes[i].ft);
  const pending = new Set(nodes.map((nd, i) => i).filter((i) => nodes[i].ft));
  let progress = true;
  while (pending.size && progress) {
    progress = false;
    for (const i of pending) {
      if (nodes[i].inputs.every((s) => s < 0 || !pending.has(s))) { order.push(i); pending.delete(i); progress = true; }
    }
  }
  if (pending.size) throw new Error(`${path}: algebraic loop through ${[...pending].map((i) => nodes[i].name).join(', ')}; put a block with state (integrator, lag) in the loop${model ? ' (in a model, dead times pass straight through)' : ''}`);

  // State offsets, in node order: diagram order, depth first through
  // subsystems, then each block's own order. The same in both modes, so a
  // state from a run fits a model.
  let n = 0, bound = 0;
  const stateNodes = [];
  for (const nd of nodes) {
    if (nd.kind !== 'ss' && nd.kind !== 'ode') continue;
    nd.nx = nd.kind === 'ss' ? nd.ss.n : typeof nd.ode.n === 'function' ? nd.ode.n(nd.p) : nd.ode.n;
    nd.off = n; n += nd.nx; bound = Math.max(bound, nd.bound);
    if (nd.nx > 0) stateNodes.push(nd);
  }
  // Every state with its label: subsystem/block.state, or the block's name
  // for a first-order block (its state is its output).
  const states = [];
  for (const nd of stateNodes) {
    if (nd.kind === 'ode') nd.ode.states(nd.p).forEach((s, j) => states.push({ label: `${nd.name}.${s.name}`, name: s.name, unit: s.unit, angle: s.angle, index: nd.off + j }));
    else for (let j = 0; j < nd.nx; j++) states.push(nd.nx === 1 ? { label: nd.name, name: nd.short, unit: '', angle: false, index: nd.off } : { label: `${nd.name}.x${j + 1}`, name: `${nd.short}.x${j + 1}`, unit: '', angle: false, index: nd.off + j });
  }

  const vals = new Float64Array(nodes.length);
  // Sampled blocks; observers first, so a controller sampling at the same
  // instant already sees the new estimate.
  const ctrls = nodes.filter((nd) => nd.kind === 'ctrl').sort((a, b) => b.observer - a.observer);
  const minTs = Math.min(Infinity, ...ctrls.map((nd) => nd.Ts));
  const delays = nodes.filter((nd) => nd.kind === 'delay' || (nd.kind === 'ss' && nd.delay > 0)).map((nd) => { nd.hist = []; return nd; });
  let h = 0;
  const histAt = (hist, tau, y0 = 0) => {
    if (tau < 0 || !hist.length) return y0;
    const f = tau / h, i = Math.floor(f);
    if (i >= hist.length - 1) return hist[hist.length - 1];
    return hist[i] + (hist[i + 1] - hist[i]) * (f - i);
  };
  const inOf = (nd, s = 0) => (nd.inputs[s] < 0 ? 0 : vals[nd.inputs[s]]);

  // The outputs of the nodes in list (indices, in evaluation order). The
  // simulation and the model share this; model mode differs in a few cases.
  function outputs(list, t, X, o, u) {
    for (let q = 0; q < list.length; q++) {
      const i = list[q], nd = nodes[i];
      let y;
      switch (nd.kind) {
        case 'ext': y = u; break;
        case 'src': y = model ? nd.at : nd.fn(t); break;
        case 'pass': y = inOf(nd); break;
        case 'gain': y = nd.K * inOf(nd); break;
        case 'sum': y = 0; for (let s = 0; s < nd.signs.length; s++) y += nd.signs[s] * inOf(nd, s); break;
        case 'sat': y = Math.min(nd.hi, Math.max(nd.lo, inOf(nd))); break;
        // y0 null: before L, the input at t = 0 (the first recorded), or the
        // input now while nothing is recorded.
        case 'delay': y = model || nd.L <= 0 ? inOf(nd) : histAt(nd.hist, t - nd.L, nd.y0 ?? (nd.hist.length ? nd.hist[0] : inOf(nd))); break;
        case 'switch': y = inOf(nd, nd.pick); break;
        case 'fcn': nd.env.u = inOf(nd); nd.env.t = t; y = nd.f(nd.env); break;
        case 'quant': y = model ? inOf(nd) : nd.q * Math.round(inOf(nd) / nd.q); break;
        case 'noise': y = model ? inOf(nd) : inOf(nd) + nd.std * gaussAt(nd.seed, Math.floor(t / (h || 1) + 1e-9)); break;
        case 'ode': nd.ode.out(X, o + nd.off, nd.p, nd.outv); y = nd.outv[0]; break;
        // An observer's estimate looked through (model mode) reads the state it stands for.
        case 'tap': y = nd.see >= 0 ? X[o + nd.see] : nodes[nd.parent].outv[nd.j]; break;
        case 'ctrl': y = nd.u; break;
        default: {
          const { ss } = nd;
          const inp = nd.delay > 0 && !model ? histAt(nd.hist, t - nd.delay) : inOf(nd);
          y = ss.D * inp;
          for (let j = 0; j < ss.n; j++) y += ss.C[j] * X[o + nd.off + j];
        }
      }
      vals[i] = y;
    }
  }
  // The state rates of the state nodes in list, after their inputs are evaluated.
  function rates(list, t, X, o, dX) {
    for (let q = 0; q < list.length; q++) {
      const nd = list[q];
      if (nd.kind === 'ode') { nd.rates(X, o + nd.off, inOf(nd), dX); continue; }
      const { ss } = nd, base = o + nd.off;
      const inp = nd.delay > 0 && !model ? histAt(nd.hist, t - nd.delay) : inOf(nd);
      for (let r = 0; r < ss.n; r++) {
        let s = ss.B[r] * inp;
        for (let c = 0; c < ss.n; c++) s += ss.A[r * ss.n + c] * X[base + c];
        dX[base + r] = s;
      }
    }
  }

  const self = {
    n, bound, warnings, minTs, states,
    setStep(step) { h = step; },
    // Called at each completed step with the state there: a controller whose
    // sample is due reads its inputs and sets its held output; the outputs are
    // then evaluated again so what is recorded at t already sees it.
    sample(t, X, o, u) {
      for (const nd of ctrls) {
        if (!nd.law || t < nd.next - 1e-9) continue;
        for (let s = 0; s < nd.x.length; s++) nd.x[s] = inOf(nd, s);
        const y = nd.law.step(nd.x);
        if (nd.observer) nd.outv.set(y.subarray ? y.subarray(0, nd.outv.length) : y.slice(0, nd.outv.length)); else nd.u = y;
        while (nd.next <= t + 1e-9) nd.next += nd.Ts;
        self.eval(t, X, o, u, null);
      }
    },
    // Initial state: zero, except for physics blocks with initial conditions.
    init(X, o) { for (const nd of stateNodes) if (nd.kind === 'ode') nd.ode.init(nd.p).forEach((v, i) => { X[o + nd.off + i] = v; }); },
    eval(t, X, o, u, dX) {
      outputs(order, t, X, o, u);
      if (dX) rates(stateNodes, t, X, o, dX);
      return outNode >= 0 ? vals[outNode] : 0;
    },
    // Values of the Sources and Sinks after the last eval.
    probes: () => probeList.map(([name, k]) => [name, vals[k]]),
    // Called after each completed step: dead times remember their input.
    record() { for (const nd of delays) nd.hist.push(inOf(nd)); },
  };
  if (!model) return self;

  // ---- The plant a block sees (design/output/designs.md) -----------------
  // The map from the cut u (a Controller's output; for an Observer, what
  // feeds its input u) to the block's measurements (its inputs 2…). Other
  // Controllers hold their output, Observers their estimates unless looked
  // through, Sources read the operating point's values.
  const owner = new Int32Array(n);   // global state index → its node
  for (const nd of stateNodes) owner.fill(nd.i, nd.off, nd.off + nd.nx);
  const blockNode = (idPath) => nodes.find((nd) => nd.kind === 'ctrl' && nd.idPath === idPath);
  let active = null;   // the Model whose held values and sources the nodes carry now
  const memo = new Map();
  const sorted = (o) => Object.entries(o ?? {}).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const plain = (v) => (typeof v === 'number' ? v : Array.from(v ?? []));

  function buildModel(idPath, at) {
    const blk = blockNode(idPath);
    if (!blk) throw modelError('no-block', `no Controller or Observer "${idPath}" in the plant`);
    const cut = blk.observer ? blk.inputs[0] : blk.i;
    if (cut < 0) throw modelError('no-cut', `nothing is wired to input 1 (u) of the observer '${blk.name}', so it cannot know what drives the plant`, 'wire the plant input u to it');
    const meas = blk.inputs.slice(1), m = meas.length;
    // Look-through: estimate j of an observer reads the true state it stands for.
    const see = new Map();
    for (const [obs, idx] of at.seeThrough ?? []) {
      const o = blockNode(obs);
      if (!o?.observer) throw modelError('no-block', `no Observer "${obs}" to look through`);
      o.taps.forEach((tp, j) => { if (Number.isInteger(idx[j]) && idx[j] >= 0 && idx[j] < n) see.set(tp, idx[j]); });
    }
    // What a node depends on (its output, and its state's rate); the cut,
    // held blocks and Sources depend on nothing.
    const deps = (i) => {
      if (i === cut) return NONE;
      const nd = nodes[i];
      if (nd.kind === 'src' || nd.kind === 'ext' || nd.kind === 'ctrl') return NONE;
      if (nd.kind === 'tap') return nodes[nd.parent].kind === 'ode' ? [nd.parent] : see.has(i) ? [owner[see.get(i)]] : NONE;
      if (nd.kind === 'switch') return [nd.inputs[nd.pick]];
      return nd.inputs;
    };
    // What a node's output reads at the same instant: a state block's output
    // reads its state, and its input only through D.
    const reads = (i) => (nodes[i].kind === 'ode' || (nodes[i].kind === 'ss' && nodes[i].ss.D === 0) ? NONE : deps(i));
    const users = nodes.map(() => []);
    nodes.forEach((nd, i) => { for (const s of deps(i)) if (s >= 0) users[s].push(i); });
    const walk = (starts, next) => {
      const mark = new Uint8Array(nodes.length), stack = [];
      for (const s of starts) if (s >= 0 && !mark[s]) { mark[s] = 1; stack.push(s); }
      while (stack.length) for (const j of next(stack.pop())) if (j >= 0 && !mark[j]) { mark[j] = 1; stack.push(j); }
      return mark;
    };
    // Structural reduction: keep the states the cut reaches and that reach a
    // measurement; the rest stay at the base state (so do those of a cut
    // block with state, whose output u replaces).
    const fromCut = walk([cut], (i) => users[i]);
    const toMeas = walk(meas, deps);
    const kept = stateNodes.filter((nd) => nd.i !== cut && fromCut[nd.i] && toMeas[nd.i]);
    // The slices: only the nodes the kept rates read (for f), and those the
    // measurements read too (for y).
    const sliceOf = (starts) => { const used = walk(starts, reads); return Int32Array.from(order.filter((i) => used[i] && i !== cut)); };
    const sliceF = sliceOf(kept.flatMap((nd) => nd.inputs));
    const slice = sliceOf([...meas, ...kept.flatMap((nd) => nd.inputs)]);
    const keep = Int32Array.from(kept.flatMap((nd) => Array.from({ length: nd.nx }, (_, j) => nd.off + j)));
    const nk = keep.length;

    const X0 = new Float64Array(n);
    if (at.X) {
      if (at.X.length !== n) throw modelError('bad-state', `the state has ${at.X.length} values; this plant has ${n}`);
      X0.set(at.X);
    } else self.init(X0, 0);
    const t0 = Number(at.t) || 0;
    const labels = blockInputNames(diagram, blk.idPath).slice(1);
    const notes = [];

    // What the nodes carry while this Model is evaluated.
    const held = at.held ?? {}, setU = [], setO = [], setSrc = [], setSee = [];
    for (const i of slice) {
      const nd = nodes[i];
      if (nd.kind === 'ctrl' && !nd.observer) {
        const v = Number(held[nd.idPath] ?? 0);
        setU.push([i, v]);
        notes.push(`controller '${nd.name}' holds its output at ${fmt(v)}: the design sees its loop open`);
      }
      if (nd.kind === 'src') setSrc.push([i, nd.signal === null ? 0 : Number(at.sources?.[nd.signal] ?? 0)]);
      if (nd.kind === 'tap' && nodes[nd.parent].kind === 'ctrl') {
        setSee.push([i, see.has(i) ? see.get(i) : -1]);
        const o = nodes[nd.parent];
        if (!see.has(i) && !setO.some(([k]) => k === o.i)) {
          const v = new Float64Array(o.outv.length), hv = held[o.idPath];
          if (typeof hv === 'number') v.fill(hv); else if (hv) v.set(Array.from(hv).slice(0, v.length));
          setO.push([o.i, v]);
          notes.push(`estimates of '${o.name}' are held; the design does not look through a hand observer`);
        }
      }
    }

    // Sensors: quantizers and noise between the plant and each measurement.
    const sensorPath = meas.map((mk) => walk([mk], reads));
    const sensors = sensorPath.map((on) => {
      let std2 = 0, q2 = 0;
      for (let i = 0; i < nodes.length; i++) {
        if (!on[i]) continue;
        if (nodes[i].kind === 'quant') q2 += nodes[i].q ** 2;
        if (nodes[i].kind === 'noise') std2 += nodes[i].std ** 2;
      }
      return { std: Math.sqrt(std2), q: Math.sqrt(q2) };
    });
    for (const i of slice) {
      const nd = nodes[i];
      if (nd.kind !== 'quant' && nd.kind !== 'noise') continue;
      const on = labels.filter((_, k) => sensorPath[k][i]);
      const where = on.length ? ` on ${on.join(', ')}` : '';
      notes.push(nd.kind === 'quant' ? `quantizer '${nd.name}'${where} is the identity in the model (step ${fmt(nd.q)})` : `noise '${nd.name}'${where} adds 0 in the model (σ ${fmt(nd.std)})`);
    }

    // Dead time per measurement: the shortest and longest sums along the
    // paths from the cut; if they differ, the dead time sits in a loop or a
    // parallel branch, and only the part every path has is reported.
    const delayOf = (i) => (nodes[i].kind === 'delay' ? nodes[i].L : nodes[i].kind === 'ss' ? nodes[i].delay : 0);
    const delay = meas.map((mk, k) => {
      if (mk < 0 || !fromCut[mk]) return 0;
      const back = walk([mk], deps), list = [];
      for (let i = 0; i < nodes.length; i++) if (back[i] && fromCut[i] && i !== cut) list.push(i);
      const lo = new Float64Array(nodes.length).fill(Infinity), hi = new Float64Array(nodes.length).fill(-Infinity);
      lo[cut] = hi[cut] = 0;
      let settled = false;
      for (let it = 0; it <= list.length + 1 && !settled; it++) {
        settled = true;
        for (const j of list) {
          const w = delayOf(j);
          for (const s of deps(j)) {
            if (s < 0 || !(s === cut || (back[s] && fromCut[s]))) continue;
            if (lo[s] + w < lo[j]) { lo[j] = lo[s] + w; settled = false; }
            if (hi[s] + w > hi[j] + 1e-12) { hi[j] = hi[s] + w; settled = false; }
          }
        }
      }
      const longest = settled ? hi[mk] : Infinity;
      if (longest - lo[mk] > 1e-12) notes.push(`dead time on the way to ${labels[k]} differs between paths (${fmt(lo[mk])} to ${longest === Infinity ? '∞' : fmt(longest)} s): it sits in a loop or a parallel branch and is left out${lo[mk] > 0 ? `, but for the ${fmt(lo[mk])} s every path has` : ''}`);
      return lo[mk] === Infinity ? 0 : lo[mk];
    });

    const sink = probeList.find(([, k]) => nodes[k].kind === 'pass' && nodes[k].inputs[0] === cut);
    const inputLabel = sink?.[0] ?? (blk.observer ? nodes[cut].name : 'u');
    if (!meas.some((mk) => mk >= 0 && fromCut[mk])) {
      const between = nodes.filter((nd) => nd.kind === 'ctrl' && !nd.observer && nd.i !== cut && nd.inputs.some((s) => s >= 0 && fromCut[s])).map((nd) => `'${nd.name}'`);
      notes.push(`${inputLabel} reaches none of the measurements${between.length ? `: controller ${between.join(', ')} holds its output in between` : ''}`);
    }

    const Xf = Float64Array.from(X0), dXf = new Float64Array(n), yScratch = new Float64Array(m);
    const bind = () => {
      for (const [i, v] of setU) nodes[i].u = v;
      for (const [i, v] of setO) nodes[i].outv.set(v);
      for (const [i, v] of setSrc) nodes[i].at = v;
      for (const [i, s] of setSee) nodes[i].see = s;
      active = mdl;
    };
    const evaluate = (x, u, list) => {
      if (active !== mdl) bind();
      for (let i = 0; i < nk; i++) Xf[keep[i]] = x[i];
      vals[cut] = u;
      outputs(list, t0, Xf, 0, 0);
    };
    const mdl = {
      idPath: blk.idPath, name: blk.name, kind: blk.observer ? 'observer' : 'controller',
      n: nk, m, X0, x0: Float64Array.from(keep, (g) => X0[g]),
      input: { label: inputLabel },
      states: Array.from(keep, (g) => ({ ...states[g] })),
      outputs: labels.map((label) => ({ label, angle: false, unit: '' })),
      delay, sensors,
      bound: Math.max(0, ...kept.map((nd) => nd.bound)),
      warnings: notes,
      // ẋ = f(x, u) over the kept states; allocation-free.
      f(x, u, dx) {
        evaluate(x, u, sliceF);
        rates(kept, t0, Xf, 0, dXf);
        for (let i = 0; i < nk; i++) dx[i] = dXf[keep[i]];
      },
      // The measurements y(x, u).
      y(x, u, out) {
        evaluate(x, u, slice);
        for (let k = 0; k < m; k++) out[k] = meas[k] < 0 ? 0 : vals[meas[k]];
      },
      // Saturations outside their limits at (x, u): there the model has no slope.
      atLimits(x, u) {
        mdl.y(x, u, yScratch);
        const out = [];
        for (const i of slice) {
          const nd = nodes[i], v = inOf(nd);
          if (nd.kind === 'sat' && (v < nd.lo || v > nd.hi)) out.push(`'${nd.name}' is saturated at the operating point (input ${fmt(v)}, limits ${fmt(nd.lo)} to ${fmt(nd.hi)}): the model sees no slope through it`);
        }
        return out;
      },
    };
    // A measurement is an angle when it is exactly one angle state (slope 1).
    // Such a measurement also has the state's unit ('h = 0.45 m').
    const xs = Float64Array.from(mdl.x0), yp = new Float64Array(m), ym = new Float64Array(m);
    const slopes = Array.from({ length: m }, () => []);
    for (let i = 0; i < nk; i++) {
      const x = xs[i], dx = 1e-6 * Math.max(1, Math.abs(x));
      xs[i] = x + dx; mdl.y(xs, 0, yp);
      xs[i] = x - dx; mdl.y(xs, 0, ym);
      xs[i] = x;
      for (let k = 0; k < m; k++) { const d = (yp[k] - ym[k]) / (2 * dx); if (Math.abs(d) > 1e-9) slopes[k].push([i, d]); }
    }
    slopes.forEach((row, k) => {
      const one = row.length === 1 && Math.abs(row[0][1] - 1) < 1e-6;
      mdl.outputs[k].angle = one && mdl.states[row[0][0]].angle;
      mdl.outputs[k].unit = one ? mdl.states[row[0][0]].unit : '';
    });
    return mdl;
  }

  // The Model of the plant the block idPath sees, memoised per `at`:
  //   at = { held: { idPath: value(s) }, sources: { name: value }, X: full state, t, seeThrough: Map(observer idPath → state indices) }
  self.seen = (idPath, at = {}) => {
    const id = Array.isArray(idPath) ? idPath.join('/') : String(idPath);
    const key = JSON.stringify([id, sorted(at.held).map(([k, v]) => [k, plain(v)]), sorted(at.sources), at.X ? Array.from(at.X) : null, Number(at.t) || 0, at.seeThrough ? [...at.seeThrough].map(([k, v]) => [k, Array.from(v)]).sort() : null]);
    let mdl = memo.get(key);
    if (!mdl) {
      mdl = buildModel(id, at);
      if (memo.size >= 16) memo.delete(memo.keys().next().value);
      memo.set(key, mdl);
    }
    return mdl;
  };
  return self;
}
