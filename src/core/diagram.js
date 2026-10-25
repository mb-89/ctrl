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
import { EXTERNAL_BLOCK } from './hil.js';

const num = (key, label, def, extra = {}) => ({ key, label, default: def, ...extra });

// Elementary blocks. Plant models from blocks.js (first order, n lags, ...)
// are diagram blocks too: their transfer function becomes the block.
// vary marks a physical parameter (a mass, a length, a gain, a time, a
// friction, an area): Identify's hidden variation scales it (varyDiagram,
// identify.js). Initial values, g, limits, noise and an integrator's K (the
// kinematics: position is the integral of speed) are not varied.
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
  gain: { label: 'Gain', group: 'Math', params: [num('K', 'K', 1, { vary: true })], ports: () => [1, 1], formula: 'K' },
  sum: { label: 'Sum', group: 'Math', params: [{ key: 'signs', label: 'Signs', default: '+-', kind: 'signs' }], ports: (p) => [p.signs.length, 1], formula: 'Σ' },
  integrator: { label: 'Integrator', group: 'Dynamics', params: [num('K', 'K', 1)], ports: () => [1, 1], formula: 'K / s', tf: (p) => ({ num: [p.K], den: [1, 0] }) },
  // The dead time is T_d in labels and formulas (L is the motor's inductance);
  // the key stays L, so files are unaffected.
  delay: { label: 'Dead time', group: 'Dynamics', params: [num('L', 'Dead time T_d', 0.1, { unit: 's', min: 0, vary: true }), num('y0', 'Output before T_d', 0)], ports: () => [1, 1], formula: 'e^(−T_d·s)' },
  fcn: { label: 'Function', group: 'Math', params: [{ key: 'expr', label: 'y = f(u)', default: 'u^2', kind: 'expr' }], ports: () => [1, 1], formula: 'f(u)' },
  saturation: { label: 'Saturation', group: 'Nonlinear', params: [num('min', 'Min', -1), num('max', 'Max', 1)], ports: () => [1, 1], formula: 'clamp' },
  quantizer: { label: 'Quantizer', group: 'Sensors', params: [num('q', 'Step', 0.01, { min: 1e-12 })], ports: () => [1, 1], formula: 'q · round(u / q)' },
  noise: { label: 'Noise', group: 'Sensors', params: [num('std', 'σ', 0.01, { min: 0 }), num('seed', 'Seed', 1, { int: true, min: 0 })], ports: () => [1, 1], formula: 'u + n,  n ~ N(0, σ²)' },
  cartPole: {
    // Point mass m on a massless pole of length l, hinged on a cart of mass M.
    // θ = 0 is upright, positive leaning towards +x. b is the cart's friction.
    label: 'Cart–pole', group: 'Physics', formula: 'F → x, θ, v, ω', outputs: ['x', 'θ', 'v', 'ω'], ports: () => [1, 4],
    params: [num('M', 'Cart M', 1, { unit: 'kg', min: 1e-6, vary: true }), num('m', 'Bob m', 0.2, { unit: 'kg', min: 1e-6, vary: true }), num('l', 'Length l', 0.5, { unit: 'm', min: 1e-6, vary: true }), num('g', 'g', 9.81, { unit: 'm/s²' }), num('b', 'Friction b', 0.1, { unit: 'N·s/m', min: 0, vary: true }), num('theta0', 'Start θ₀', 0.05, { unit: 'rad' })],
    ode: {
      n: 4,
      init: (p) => [0, 0, p.theta0, 0],
      out: (X, o, p, y) => { y[0] = X[o]; y[1] = X[o + 2]; y[2] = X[o + 1]; y[3] = X[o + 3]; },
      f: (X, o, u, p, dX) => {
        const v = X[o + 1], th = X[o + 2], w = X[o + 3];
        const s = Math.sin(th), c = Math.cos(th);
        const a = (u - p.b * v + p.m * p.l * w * w * s - p.m * p.g * s * c) / (p.M + p.m * s * s);
        dX[o] = v; dX[o + 1] = a; dX[o + 2] = w; dX[o + 3] = (p.g * s - a * c) / p.l;
      },
      bound: (p) => 2 * Math.sqrt(p.g * (p.M + p.m) / (p.M * p.l)) + p.b / p.M,
    },
  },
  pendulumCart: {
    // A chain of 1–3 rods on a cart (mass M): point masses m1, m2, m3 at the
    // ends of massless rods l1, l2, l3, each hinged on the one before. Angles
    // from upright, positive leaning towards +x. Lagrange's equations
    // M(q) q̈ = f(q, q̇, F) are solved at each evaluation.
    label: 'Pendulum chain on cart', group: 'Physics', formula: 'F → x, θ…, v, ω…',
    outputs: (p) => ['x', ...links(p).map((i) => `θ${i + 1}`), 'v', ...links(p).map((i) => `ω${i + 1}`)],
    ports: (p) => [1, 2 * p.links + 2],
    params: [num('links', 'Links', 3, { min: 1, int: true, max: 3 }), num('M', 'Cart M', 1, { unit: 'kg', min: 1e-6, vary: true }),
      ...[1, 2, 3].flatMap((i) => [num(`m${i}`, `Mass m${i}`, 0.1, { unit: 'kg', min: 1e-6, vary: true }), num(`l${i}`, `Rod l${i}`, 0.25, { unit: 'm', min: 1e-6, vary: true })]),
      num('g', 'g', 9.81, { unit: 'm/s²' }), num('b', 'Friction b', 0.1, { unit: 'N·s/m', min: 0, vary: true }),
      ...[1, 2, 3].map((i) => num(`theta${i}0`, `Start θ${i}₀`, i === 1 ? 0.05 : 0, { unit: 'rad' }))],
    ode: {
      n: (p) => 2 * p.links + 2,
      init: (p) => { const n = p.links; return [0, ...links(p).map((i) => p[`theta${i + 1}0`]), 0, ...new Array(n).fill(0)]; },
      out: (X, o, p, y) => { for (let i = 0; i < 2 * p.links + 2; i++) y[i] = X[o + i]; },
      f: (X, o, u, p, dX) => chainRates(X, o, u, p, dX),
      bound: (p) => 4 * Math.sqrt((p.g / Math.min(...links(p).map((i) => p[`l${i + 1}`]))) * (1 + p.links)) + p.b / p.M,
    },
  },
  conicalTank: {
    // A tank that widens upwards (radius r0 at the bottom, R at height H),
    // filled at q and draining through an outlet of area a (Torricelli). Its
    // dynamics are fast when nearly empty and slow when full. It cannot run
    // dry below 0 or hold more than H: what comes in beyond that overflows.
    label: 'Conical tank', group: 'Physics', formula: 'q → h', outputs: ['h'], ports: () => [1, 1],
    params: [num('r0', 'Bottom radius r0', 0.05, { unit: 'm', min: 1e-4, vary: true }), num('R', 'Top radius R', 0.5, { unit: 'm', min: 1e-4, vary: true }), num('H', 'Height H', 1, { unit: 'm', min: 1e-3, vary: true }), num('a', 'Outlet area a', 0.1, { unit: 'm²', min: 0, vary: true }), num('g', 'g', 9.81, { unit: 'm/s²' }), num('h0', 'Start level h₀', 0.25, { unit: 'm', min: 0 })],
    ode: {
      n: 1,
      init: (p) => [Math.min(p.H, p.h0)],
      out: (X, o, p, y) => { y[0] = Math.min(p.H, Math.max(0, X[o])); },
      f: (X, o, u, p, dX) => {
        const h = Math.min(p.H, Math.max(0, X[o]));
        const r = p.r0 + ((p.R - p.r0) * h) / p.H;
        const flow = Math.max(0, u) - p.a * Math.sqrt(2 * p.g * h);
        dX[o] = (h <= 0 && flow < 0) || (h >= p.H && flow > 0) ? 0 : flow / (Math.PI * r * r);
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
  // A plant outside the page (Live mode, hil.js): its outputs come from the
  // plant every cycle, its inputs are sent back; offline the outputs hold 0.
  external: EXTERNAL_BLOCK,
  subsystem: { label: 'Subsystem', group: 'Structure', params: [], ports: null, formula: '' },
};

const VARIANT_LIBS = { controller: undefined, observer: OBSERVERS };

const links = (p) => Array.from({ length: p.links }, (_, i) => i);

// The chain's rates, allocation-free (the swing-up planner calls this
// millions of times): build M(q) q̈ = f in a scratch matrix and solve it.
const CH = { m: new Float64Array(3), l: new Float64Array(3), mu: new Float64Array(3), th: new Float64Array(3), w: new Float64Array(3), A: new Float64Array(20), q: new Float64Array(4) };
function chainRates(X, o, u, p, dX) {
  const n = p.links, N = n + 1, W = N + 1, { m, l, mu, th, w, A, q } = CH;
  for (let i = 0; i < n; i++) { m[i] = p[`m${i + 1}`]; l[i] = p[`l${i + 1}`]; th[i] = X[o + 1 + i]; w[i] = X[o + n + 2 + i]; }
  for (let i = n - 1, acc = 0; i >= 0; i--) { acc += m[i]; mu[i] = acc; }   // mass at or beyond link i
  const v = X[o + n + 1];
  A.fill(0);
  A[0] = p.M + mu[0];
  A[N] = u - p.b * v;   // right-hand side in column N of an N × (N + 1) augmented matrix
  for (let j = 0; j < n; j++) {
    const c = mu[j] * l[j] * Math.cos(th[j]), sj = Math.sin(th[j]);
    A[j + 1] = c; A[(j + 1) * W] = c;
    A[N] += mu[j] * l[j] * sj * w[j] * w[j];
    let r = mu[j] * p.g * l[j] * sj;
    for (let k = 0; k < n; k++) {
      const mk = mu[Math.max(j, k)] * l[j] * l[k];
      A[(j + 1) * W + k + 1] = mk * Math.cos(th[j] - th[k]);
      r -= mk * Math.sin(th[j] - th[k]) * w[k] * w[k];
    }
    A[(j + 1) * W + N] = r;
  }
  // Gaussian elimination with partial pivoting on the augmented rows.
  for (let c = 0; c < N; c++) {
    let piv = c;
    for (let r = c + 1; r < N; r++) if (Math.abs(A[r * W + c]) > Math.abs(A[piv * W + c])) piv = r;
    if (piv !== c) for (let k = 0; k < W; k++) { const t = A[c * W + k]; A[c * W + k] = A[piv * W + k]; A[piv * W + k] = t; }
    for (let r = c + 1; r < N; r++) {
      const f = A[r * W + c] / A[c * W + c];
      for (let k = c; k < W; k++) A[r * W + k] -= f * A[c * W + k];
    }
  }
  for (let r = N - 1; r >= 0; r--) {
    let s2 = A[r * W + N];
    for (let k = r + 1; k < N; k++) s2 -= A[r * W + k] * q[k];
    q[r] = s2 / A[r * W + r];
  }
  dX[o] = v;
  for (let j = 0; j < n; j++) { dX[o + 1 + j] = w[j]; dX[o + n + 2 + j] = q[j + 1]; }
  dX[o + n + 1] = q[0];
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
  return { label: b.label, group: 'Models', params: b.params, ports: () => [1, 1], formula: b.formula, tf: (p) => b.tf(p), model: true, ...(b.summary ? { summary: b.summary } : {}) };
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
  if (ELEMENTS[type].normalize) return ELEMENTS[type].normalize(params, where);  // blocks that check their own (external)
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
      out.variants = vs.map((v, j) => normalizeVariant(v, `${where}(${b.id}).variants[${j}]`, lib, { inputs: out.params.inputs }));
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

// Flattens and compiles a diagram into a simulation element:
//   { n, bound, eval(t, X, o, u, dX) -> y, record(), probes(), warnings }
// opts.sources maps Source signal names to t => value. opts.standalone: the
// diagram is the whole system (no Out needed; an In reads 0).
export function compileDiagram(diagram, path = 'plant', opts = {}) {
  const nodes = [];
  const warnings = [];
  const probeList = [];
  const add = (node) => { nodes.push({ inputs: [], ...node }); return nodes.length - 1; };
  const externals = [];
  let extNode = -1, outNode = -1;
  const ctrlNodes = [];  // [block id path, node] of every Controller block

  // Creates nodes for one level; returns, per block id, where its output
  // ports come from and where its input ports go.
  function level(d, prefix, root, ids = '') {
    const outs = {}, ins = {};
    for (const b of d.blocks) {
      const name = `${prefix}${b.name ?? b.id}`;
      if (b.type === 'subsystem') {
        const inner = level(b.diagram, `${name}/`, false, `${ids}${b.id}/`);
        const ports = (t) => b.diagram.blocks.filter((x) => x.type === t).sort((a, c) => a.params.port - c.params.port);
        outs[b.id] = ports('outport').map((x) => inner.outs[x.id][0]);
        ins[b.id] = ports('inport').map((x) => inner.ins[x.id][0]);
        continue;
      }
      if (b.type === 'source') {
        const fn = opts.sources?.[b.params.signal];
        if (!fn) warnings.push(`${path}: no signal "${b.params.signal}" for ${name}`);
        const k = add({ kind: 'src', name, ft: false, fn: fn ?? (() => 0) });
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
        if (root && opts.standalone) {
          const k = add({ kind: 'src', name, ft: false, fn: () => 0 });
          warnings.push(`${path}: ${name} reads 0 until a controller drives the plant`);
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
        if (root && !opts.standalone) { if (outNode >= 0) throw new Error(`${path}: one output (Out) only, for now`); outNode = k; }
        outs[b.id] = [k]; ins[b.id] = [[k, 0]];
        continue;
      }
      const def = diagramBlockDef(b.type);
      const [nIn, nOut] = blockPorts(b);
      if (b.type === 'controller' || b.type === 'observer') {
        const lib = VARIANT_LIBS[b.type];
        const v = b.variants?.[b.variant ?? 0] ?? normalizeVariant({ type: b.type === 'observer' ? 'difference' : 'pid' }, b.id, lib);
        const k = add({ kind: 'ctrl', name, ft: false, observer: b.type === 'observer', inputs: new Array(nIn).fill(-1), Ts: b.params.Ts, law: makeLaw(v, b.params.Ts, lib), next: 0, k: 0, u: 0, outv: new Float64Array(nOut), x: new Float64Array(nIn) });
        outs[b.id] = b.type === 'observer' ? Array.from({ length: nOut }, (_, j) => add({ kind: 'tap', name: `${name}.x̂${j + 1}`, ft: false, parent: k, j })) : [k];
        ins[b.id] = nodes[k].inputs.map((_, s) => [k, s]);
        if (b.type === 'controller') ctrlNodes.push([`${ids}${b.id}`, k]); // auto-tune probes (below)
        continue;
      }
      if (b.type === 'external') {
        // Live mode sets its outputs (outv) each cycle and reads its inputs;
        // one tap node per output, as for a physics block.
        const k = add({ kind: 'xplant', name, ft: false, p: b.params, inputs: new Array(nIn).fill(-1), outv: new Float64Array(nOut) });
        externals.push(k);
        outs[b.id] = outputNames(def, b.params).map((o, j) => add({ kind: 'tap', name: `${name}.${o}`, ft: false, parent: k, j }));
        ins[b.id] = nodes[k].inputs.map((_, s) => [k, s]);
        continue;
      }
      if (def.ode) {
        // A physics block: its state integrates inside the diagram; one tap
        // node per output reads what the block computed from its state.
        const k = add({ kind: 'ode', name, ft: false, ode: def.ode, p: b.params, inputs: new Array(nIn).fill(-1), outv: new Float64Array(nOut), bound: def.ode.bound(b.params) });
        outs[b.id] = outputNames(def, b.params).map((o, j) => add({ kind: 'tap', name: `${name}.${o}`, ft: false, parent: k, j }));
        ins[b.id] = nodes[k].inputs.map((_, s) => [k, s]);
        continue;
      }
      const node = { name, inputs: new Array(nIn).fill(-1) };
      if (def.tf) {
        const tf = def.tf(b.params);
        const ss = tf2ss(tf.num, tf.den);
        Object.assign(node, { kind: 'ss', ss, ft: ss.D !== 0, bound: rootBound(tf.den), delay: Number(tf.delay) || 0 });
        if (node.delay > 0) node.ft = false;
      } else if (b.type === 'gain') Object.assign(node, { kind: 'gain', K: b.params.K, ft: true });
      else if (b.type === 'sum') Object.assign(node, { kind: 'sum', signs: [...b.params.signs].map((c) => (c === '-' ? -1 : 1)), ft: true });
      else if (b.type === 'saturation') Object.assign(node, { kind: 'sat', lo: Math.min(b.params.min, b.params.max), hi: Math.max(b.params.min, b.params.max), ft: true });
      else if (b.type === 'delay') Object.assign(node, { kind: 'delay', L: b.params.L, y0: b.params.y0, ft: b.params.L <= 0 });
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
  level(diagram, '', true);
  // Auto-tune reads each Controller block's r (input 1), y (input 2) and u
  // under its id path: "ctrl.r", "motor/ctrl.u". A signal name never has a
  // dot, so no scope channel lists these.
  for (const [key, k] of ctrlNodes) {
    const [r = -1, y = -1] = nodes[k].inputs;
    if (r >= 0) probeList.push([`${key}.r`, r]);
    if (y >= 0) probeList.push([`${key}.y`, y]);
    probeList.push([`${key}.u`, k]);
  }
  if (!opts.standalone) {
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
  if (pending.size) throw new Error(`${path}: algebraic loop through ${[...pending].map((i) => nodes[i].name).join(', ')}; put a block with state (integrator, lag) in the loop`);

  let n = 0, bound = 0;
  for (const nd of nodes) {
    if (nd.kind === 'ss') { nd.off = n; n += nd.ss.n; bound = Math.max(bound, nd.bound); }
    if (nd.kind === 'ode') { nd.off = n; n += typeof nd.ode.n === 'function' ? nd.ode.n(nd.p) : nd.ode.n; bound = Math.max(bound, nd.bound); }
  }
  const vals = new Float64Array(nodes.length);
  // Sampled blocks; observers first, so a controller sampling at the same
  // instant already sees the new estimate.
  const ctrls = nodes.filter((nd) => nd.kind === 'ctrl').sort((a, b) => b.observer - a.observer);
  const minTs = Math.min(Infinity, ...ctrls.map((nd) => nd.Ts));
  // Every sampled block's Ts: simulateSystem puts each sample instant k·Ts on
  // its integration grid.
  const sampleTimes = [...new Set(ctrls.map((nd) => nd.Ts))];
  const delays = nodes.filter((nd) => nd.kind === 'delay' || (nd.kind === 'ss' && nd.delay > 0)).map((nd) => { nd.hist = []; return nd; });
  let h = 0;
  const histAt = (hist, tau, y0 = 0) => {
    if (tau < 0 || !hist.length) return y0;
    const f = tau / h, i = Math.floor(f);
    if (i >= hist.length - 1) return hist[hist.length - 1];
    return hist[i] + (hist[i + 1] - hist[i]) * (f - i);
  };
  const inOf = (nd, s = 0) => (nd.inputs[s] < 0 ? 0 : vals[nd.inputs[s]]);

  const self = {
    n, bound, warnings, minTs, sampleTimes,
    setStep(step) { h = step; },
    // Called at each completed step with the state there: a controller whose
    // sample is due reads its inputs and sets its held output; the outputs are
    // then evaluated again so what is recorded at t already sees it. Sample k
    // is due at k·Ts, computed from k (no sum that drifts), so a step that
    // lands on k·Ts (simulateSystem's grid) samples exactly there.
    sample(t, X, o, u) {
      for (const nd of ctrls) {
        if (t < nd.next - 1e-9) continue;
        for (let s = 0; s < nd.x.length; s++) nd.x[s] = inOf(nd, s);
        const y = nd.law.step(nd.x);
        if (nd.observer) nd.outv.set(y.subarray ? y.subarray(0, nd.outv.length) : y.slice(0, nd.outv.length)); else nd.u = y;
        while (nd.next <= t + 1e-9) nd.next = ++nd.k * nd.Ts;
        self.eval(t, X, o, u, null);
      }
    },
    // The next instant a sampled block is due (Infinity without one).
    nextSample() { let t = Infinity; for (const nd of ctrls) if (nd.next < t) t = nd.next; return t; },
    // Initial state: zero, except for physics blocks with initial conditions.
    init(X, o) { for (const nd of nodes) if (nd.kind === 'ode') nd.ode.init(nd.p).forEach((v, i) => { X[o + nd.off + i] = v; }); },
    eval(t, X, o, u, dX) {
      for (const i of order) {
        const nd = nodes[i];
        let y;
        switch (nd.kind) {
          case 'ext': y = u; break;
          case 'src': y = nd.fn(t); break;
          case 'pass': y = inOf(nd); break;
          case 'gain': y = nd.K * inOf(nd); break;
          case 'sum': y = 0; for (let s = 0; s < nd.signs.length; s++) y += nd.signs[s] * inOf(nd, s); break;
          case 'sat': y = Math.min(nd.hi, Math.max(nd.lo, inOf(nd))); break;
          case 'delay': y = nd.L > 0 ? histAt(nd.hist, t - nd.L, nd.y0) : inOf(nd); break;
          case 'switch': y = inOf(nd, nd.pick); break;
          case 'fcn': nd.env.u = inOf(nd); nd.env.t = t; y = nd.f(nd.env); break;
          case 'quant': y = nd.q * Math.round(inOf(nd) / nd.q); break;
          case 'noise': y = inOf(nd) + nd.std * gaussAt(nd.seed, Math.floor(t / (h || 1) + 1e-9)); break;
          case 'ode': nd.ode.out(X, o + nd.off, nd.p, nd.outv); y = nd.outv[0]; break;
          case 'tap': y = nodes[nd.parent].outv[nd.j]; break;
          case 'ctrl': y = nd.u; break;
          case 'xplant': y = nd.outv[0]; break;
          default: {
            const { ss } = nd;
            const inp = nd.delay > 0 ? histAt(nd.hist, t - nd.delay) : inOf(nd);
            y = ss.D * inp;
            for (let j = 0; j < ss.n; j++) y += ss.C[j] * X[o + nd.off + j];
          }
        }
        vals[i] = y;
      }
      if (dX) {
        for (const nd of nodes) {
          if (nd.kind === 'ode') { nd.ode.f(X, o + nd.off, inOf(nd), nd.p, dX); continue; }
          if (nd.kind !== 'ss') continue;
          const { ss } = nd, base = o + nd.off;
          const inp = nd.delay > 0 ? histAt(nd.hist, t - nd.delay) : inOf(nd);
          for (let r = 0; r < ss.n; r++) {
            let s = ss.B[r] * inp;
            for (let c = 0; c < ss.n; c++) s += ss.A[r * ss.n + c] * X[base + c];
            dX[base + r] = s;
          }
        }
      }
      return outNode >= 0 ? vals[outNode] : 0;
    },
    // Values of the Sources and Sinks after the last eval.
    probes: () => probeList.map(([name, k]) => [name, vals[k]]),
    // Each Controller block's law, by its id path ("ctrl", "motor/ctrl"): a
    // runner reaches a hidden law's machine here (Identify's experiment).
    laws: Object.fromEntries(ctrlNodes.map(([key, k]) => [key, nodes[k].law])),
    // Called after each completed step: dead times remember their input.
    record() { for (const nd of delays) nd.hist.push(inOf(nd)); },
    // External plants (Live mode): y is written by the caller, u() reads what
    // the diagram feeds the block after the last eval, and shows[i] lists the
    // probes (Sinks) on the same signal as input i, which show what the plant
    // applies during a stop.
    externals: externals.map((k) => {
      const origin = (i) => { while (i >= 0 && nodes[i].kind === 'pass') i = nodes[i].inputs[0]; return i; };
      const shows = nodes[k].inputs.map((s) => (s < 0 ? [] : probeList.flatMap(([, pk], j) => (nodes[pk].kind === 'pass' && origin(pk) === origin(s) ? [j] : []))));
      return { name: nodes[k].name, params: nodes[k].p, y: nodes[k].outv, u: () => nodes[k].inputs.map((s) => (s < 0 ? 0 : vals[s])), shows };
    }),
  };
  return self;
}
