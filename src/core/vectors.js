// Vector signals (design/output/robot.md §2): a wire may carry a vector or
// a matrix (r·c elements, row by row). This pass runs before the compiler:
// flattenVectors takes a diagram whose wires connect port groups and returns
// an ordinary scalar diagram that compileDiagram runs, so the compiler keeps
// seeing scalars (model mode, labels, the planner).
//
// Widths are not inferred in Simulink's sense: each output's width is either
// declared where a value starts (Sources, Constants, robot blocks from the
// robot's n, Integrators from x0 or width, Controllers from lanes, Mux from
// its inputs, Demux from its sizes) or a function of its inputs' widths,
// found in one forward pass in signal order. A loop passes through a block
// with state, whose width is declared. A width-1 input broadcasts.
//
// The blocks that only vector diagrams have are registered here
// (VECTOR_ELEMENTS, merged into diagram.js's ELEMENTS): Mux, Demux, Constant,
// and the multi-input, multi-output blocks of mathblocks.js and
// robotblocks.js. Such a block's def has
//   ports(p) → [input groups, output groups]
//   widths(p, inW, env) → { ins: [w…], outs: [w…] }, or null while an input's
//                         width is unknown (undefined in inW); throws a
//                         sentence on a mismatch. env.robot(name) is the
//                         parsed robot of the diagram's robots map
//   make(p, ctx) → (u, y, t) => void   u: the inputs, group after group; y:
//                         the outputs, likewise. ctx: { inW, outW, name,
//                         model (a design's model compile), robot(name),
//                         rbd(name, opts) (one rigid-body workspace per robot
//                         and options, shared by the compile), report(text) }
// and compiles to one scalar 'mimo' block (diagram.js: a node that passes
// its inputs straight through to its outputs). Today's blocks work on
// vectors element by element: one copy per element (ids "gain[2]"), and a
// diagram with no vector in it is returned as it is, so every file runs bit
// for bit as before.

import { BLOCKS } from './blocks.js';
import { parseUrdf } from './urdf.js';
import { createRbd } from './rbd.js';
import { MATH_BLOCKS } from './mathblocks.js';
import { ROBOT_BLOCKS } from './robotblocks.js';

const num = (key, label, def, extra = {}) => ({ key, label, default: def, ...extra });

// A list of positive whole sizes, "3,3" or [3, 3].
export function parseSizes(v, where) {
  const list = Array.isArray(v) ? v : String(v).split(',').map((s) => s.trim()).filter(Boolean);
  const out = list.map(Number);
  if (!out.length || !out.every((n) => Number.isInteger(n) && n >= 1 && n <= 4096)) throw new Error(`${where}: sizes such as "3,3" (whole numbers, at least 1)`);
  return out;
}
// A number, or a list of numbers (a vector), or a list of rows (a matrix,
// stored row by row with its shape).
export function parseValue(v, where) {
  if (typeof v === 'string' && v.trim().startsWith('[')) { try { v = JSON.parse(v); } catch { throw new Error(`${where}: a number, a list [1, 2] or rows [[1, 0], [0, 1]]`); } }
  if (Array.isArray(v) && v.length && Array.isArray(v[0])) {
    const c = v[0].length;
    if (!v.every((row) => Array.isArray(row) && row.length === c)) throw new Error(`${where}: every row needs ${c} values`);
    const flat = v.flat().map(Number);
    if (!flat.every(Number.isFinite)) throw new Error(`${where}: numbers only`);
    return { value: flat, shape: [v.length, c] };
  }
  if (Array.isArray(v)) {
    const flat = v.map(Number);
    if (!flat.length || !flat.every(Number.isFinite)) throw new Error(`${where}: numbers only`);
    return { value: flat, shape: [flat.length] };
  }
  const x = Number(v);
  if (!Number.isFinite(x)) throw new Error(`${where}: a number, a list [1, 2] or rows [[1, 0], [0, 1]]`);
  return { value: [x], shape: [] };
}
// A parameter that is a number or a list: the list as given, or the number.
export function numOrList(v, where, extra = {}) {
  if (Array.isArray(v)) {
    const out = v.map(Number);
    if (!out.length || !out.every(Number.isFinite)) throw new Error(`${where}: numbers only`);
    if (extra.min !== undefined && out.some((x) => x < extra.min)) throw new Error(`${where}: at least ${extra.min}`);
    return out;
  }
  const x = Number(v);
  if (!Number.isFinite(x)) throw new Error(`${where}: a number or a list of numbers`);
  if (extra.min !== undefined && x < extra.min) throw new Error(`${where}: at least ${extra.min}`);
  return x;
}
// Element i of a number or a list (a number broadcasts).
export const at = (v, i) => (typeof v === 'number' ? v : v[i]);
export const widthOf = (v) => (typeof v === 'number' ? 1 : v.length);

const sum = (a) => a.reduce((s, x) => s + x, 0);

// ---- The blocks only vector diagrams have

const SIGNAL_BLOCKS = {
  mux: {
    label: 'Mux', group: 'Signals', formula: 'joins signals into a vector',
    params: [{ key: 'inputs', label: 'Inputs', default: '2', kind: 'text', help: 'how many signals it joins ("3"), or the width of each ("3,3")' }],
    normalize(p, where) {
      const s = String(p.inputs ?? 2).trim();
      if (/^\d+$/.test(s)) { const n = Number(s); if (n < 1 || n > 64) throw new Error(`${where}.inputs: 1 to 64`); return { inputs: s }; }
      parseSizes(s, `${where}.inputs`);
      return { inputs: s.replace(/\s+/g, '') };
    },
    ports: (p) => [String(p.inputs).includes(',') ? parseSizes(p.inputs, 'inputs').length : Number(p.inputs), 1],
    widths(p, inW) {
      const fixed = String(p.inputs).includes(',') ? parseSizes(p.inputs, 'inputs') : null;
      if (fixed) return { ins: fixed, outs: [sum(fixed)] };
      if (inW.some((w) => w === undefined)) return null;
      return { ins: inW, outs: [sum(inW)] };
    },
  },
  demux: {
    label: 'Demux', group: 'Signals', formula: 'splits a vector',
    params: [{ key: 'sizes', label: 'Sizes', default: '1,1', kind: 'text', help: 'the width of each part, "3,3"; outputs left open are dropped' }],
    normalize: (p, where) => ({ sizes: parseSizes(p.sizes ?? '1,1', `${where}.sizes`).join(',') }),
    ports: (p) => [1, parseSizes(p.sizes, 'sizes').length],
    widths(p, inW, env) {
      const sizes = parseSizes(p.sizes, 'sizes'), n = sum(sizes);
      if (inW[0] !== undefined && inW[0] !== n && inW[0] !== 1) throw new Error(`${env.name}: takes ${n} elements (sizes ${sizes.join(', ')}) but gets ${inW[0]}`);
      return { ins: [n], outs: sizes };
    },
  },
  constant: {
    label: 'Constant', group: 'Signals', formula: 'y = value',
    params: [{ key: 'value', label: 'Value', default: 1, kind: 'value', help: 'a number, a list [1, 2] or rows [[1, 0], [0, 1]]' }, { key: 'unit', label: 'Unit', default: '1', kind: 'unit' }],
    normalize(p, where) {
      const { value, shape } = parseValue(p.value ?? 1, `${where}.value`);
      const v = shape.length === 2 ? Array.from({ length: shape[0] }, (_, r) => value.slice(r * shape[1], (r + 1) * shape[1])) : shape.length === 1 ? value : value[0];
      return { value: v, unit: String(p.unit ?? '1').trim() || '1' };
    },
    ports: () => [0, 1],
    widths: (p) => ({ ins: [], outs: [parseValue(p.value, 'value').value.length] }),
    make(p) {
      const v = parseValue(p.value, 'value').value;
      return (u, y) => { for (let i = 0; i < v.length; i++) y[i] = v[i]; };
    },
  },
};

// The scalar form of a multi-input, multi-output block: inputs and outputs
// are scalar ports (nIn, nOut); params.op names the block it came from.
const MIMO = {
  label: 'Vector block', group: null, formula: '', params: [],
  ports: (p) => [p.nIn, p.nOut],
};

export const VECTOR_ELEMENTS = { ...SIGNAL_BLOCKS, ...MATH_BLOCKS, ...ROBOT_BLOCKS, mimo: MIMO };

// ---- Extra fields of today's blocks on vector wires
// Fields a block keeps only when given (so files without them are unchanged):
//   source      derivatives 1 or 2: outputs ṙ (and r̈) beside r
//   sink        name "x, y, z" (one per element) and unit "m, m, rad"
//   integrator  x0 as a list (one start value per element), width
//   controller  lanes (one law per element), ff 1 (a feedforward input group)
// vectorExtras splits the params into what the block's own normalisation
// takes and these extras, checked here.
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,11}$/;
export function vectorExtras(type, params = {}, where = 'block') {
  const base = { ...params }, extra = {};
  const take = (key) => { const v = base[key]; delete base[key]; return v; };
  if (type === 'source') {
    const d = take('derivatives');
    if (d !== undefined && Number(d) !== 0) {
      const n = Math.round(Number(d));
      if (n !== 1 && n !== 2) throw new Error(`${where}.derivatives: 0, 1 (ṙ) or 2 (ṙ and r̈)`);
      extra.derivatives = n;
    }
  } else if (type === 'sink') {
    const name = String(base.name ?? 'y1');
    if (name.includes(',')) {
      const names = name.split(',').map((s) => s.trim());
      for (const s of names) if (!NAME.test(s)) throw new Error(`${where}.name: names such as "x, y, z" (each: letters, digits, _)`);
      if (new Set(names).size !== names.length) throw new Error(`${where}.name: each name once`);
      base.name = names[0];
      extra.name = names.join(',');
    }
    const unit = String(base.unit ?? '1');
    if (unit.includes(',')) {
      const units = unit.split(',').map((s) => s.trim() || '1');
      if (units.some((u) => u.length > 12 || /[<>"{}]/.test(u))) throw new Error(`${where}.unit: short units such as "m, m, rad"`);
      base.unit = units[0];
      extra.unit = units.join(',');
    }
  } else if (type === 'integrator') {
    const width = take('width');
    if (Array.isArray(base.x0)) extra.x0 = numOrList(take('x0'), `${where}.x0`);
    if (width !== undefined && Number(width) !== 1) {
      const w = Math.round(Number(width));
      if (!(w >= 1 && w <= 4096)) throw new Error(`${where}.width: a whole number, at least 1`);
      extra.width = w;
    }
    if (extra.x0 !== undefined && extra.width !== undefined && typeof extra.x0 !== 'number' && extra.x0.length !== extra.width) throw new Error(`${where}: x0 has ${extra.x0.length} values but width is ${extra.width}`);
  } else if (type === 'controller') {
    const lanes = take('lanes'), ff = take('ff');
    if (lanes !== undefined && Number(lanes) !== 1) {
      const n = Math.round(Number(lanes));
      if (!(n >= 1 && n <= 64)) throw new Error(`${where}.lanes: 1 to 64`);
      extra.lanes = n;
    }
    if (ff !== undefined && Number(ff)) extra.ff = 1;
  }
  return { base, extra };
}

// What a diagram needs the pass for: a block of a vector type, or one of
// the extras above (a Sink's name list alone is a vector Sink).
function needsPass(d) {
  for (const b of d.blocks) {
    if (VECTOR_ELEMENTS[b.type]) return true;
    const p = b.params ?? {};
    if (p.derivatives || p.lanes > 1 || p.ff || (b.type === 'integrator' && (Array.isArray(p.x0) || p.width > 1)) || (b.type === 'sink' && String(p.name).includes(','))) return true;
    if (b.type === 'subsystem' && needsPass(b.diagram)) return true;
  }
  return false;
}

// ---- Robots

// The parsed robots of a diagram's robots map ({ name: { urdf, gravity } }),
// memoised by the map.
const parsedRobots = new WeakMap();
export function robotsOf(robots) {
  if (!robots) return {};
  let out = parsedRobots.get(robots);
  if (!out) {
    out = {};
    for (const [name, r] of Object.entries(robots)) out[name] = { model: parseUrdf(r.urdf), gravity: r.gravity ?? [0, 0, -9.81] };
    parsedRobots.set(robots, out);
  }
  return out;
}
// A diagram's robots map, checked: each a URDF text and an optional gravity.
export function normalizeRobots(robots, where = 'plant.robots') {
  if (robots === undefined || robots === null) return undefined;
  if (typeof robots !== 'object' || Array.isArray(robots)) throw new Error(`${where}: an object of robots by name, { "puma560": { "urdf": "<robot …>" } }`);
  const out = {};
  for (const [name, r] of Object.entries(robots)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(name)) throw new Error(`${where}: a robot's name such as puma560 (letters, digits, _)`);
    if (!r || typeof r.urdf !== 'string') throw new Error(`${where}.${name}: needs "urdf", the robot's description`);
    try { parseUrdf(r.urdf); } catch (e) { throw new Error(`${where}.${name}: ${e.message}`); }
    const g = r.gravity === undefined ? undefined : r.gravity.map(Number);
    if (g && !(g.length === 3 && g.every(Number.isFinite))) throw new Error(`${where}.${name}.gravity: three numbers, such as [0, 0, -9.81]`);
    out[name] = g ? { urdf: r.urdf, gravity: g } : { urdf: r.urdf };
  }
  return out;
}

// The context a 'mimo' block's make() gets in a compile (diagram.js).
export function mimoContext(robots, { model = false, report = () => {} } = {}) {
  const parsed = robotsOf(robots), shared = new Map();
  const robot = (name) => {
    const r = parsed[name];
    if (!r) throw new Error(`no robot "${name}" in the diagram's robots${Object.keys(parsed).length ? ` (it has ${Object.keys(parsed).join(', ')})` : ''}`);
    return r.model;
  };
  return {
    model, report, robot,
    // One workspace per robot and options: blocks reading the same q share
    // its kinematics (rbd.js caches them by q).
    rbd(name, opts = {}) {
      const key = JSON.stringify([name, opts]);
      if (!shared.has(key)) shared.set(key, createRbd(robot(name), { gravity: parsed[name].gravity, ...opts }));
      return shared.get(key);
    },
  };
}
export function makeMimo(params, ctx) {
  const def = VECTOR_ELEMENTS[params.op];
  return def.make(params.p, { ...ctx, inW: params.inW, outW: params.outW, name: params.label });
}

// ---- Widths

const isModelType = (type) => !!BLOCKS.plant[type];
const ELEMWISE = new Set(['gain', 'saturation', 'delay', 'fcn', 'quantizer', 'noise', 'integrator', 'sink', 'terminator']);
const STATEFUL = new Set(['integrator', 'delay']);   // and every model block (blocks.js)

// The widths of one block's port groups from its inputs' widths (undefined:
// not known yet); force: decide a stateful block's width even so.
function blockWidths(b, inW, env, force) {
  const def = VECTOR_ELEMENTS[b.type];
  if (def) return def.widths(b.params, inW, env);
  const p = b.params, known = inW.filter((w) => w !== undefined);
  const widest = known.length ? Math.max(...known) : 1;
  const all = (n, k) => new Array(k).fill(n);
  if (b.type === 'integrator') {
    const n = p.x0 !== undefined && typeof p.x0 !== 'number' ? p.x0.length : p.width ?? (inW[0] !== undefined ? inW[0] : force ? 1 : undefined);
    return n === undefined ? null : { ins: [n], outs: [n] };
  }
  if (b.type === 'source') return { ins: [], outs: all(1, 1 + (p.derivatives ?? 0)) };
  if (b.type === 'controller') {
    const lanes = p.lanes ?? 1, nIn = p.inputs + (p.ff ? 1 : 0);
    return { ins: all(lanes, nIn), outs: [lanes] };
  }
  if (b.type === 'observer') {
    if (grouped(b)) {
      if (inW[1] === undefined && !force) return null;
      const m = inW[1] ?? 1;
      return { ins: [1, m], outs: [m, m] };
    }
    return { ins: all(1, p.inputs), outs: all(1, p.outputs) };
  }
  if (ELEMWISE.has(b.type) || isModelType(b.type) || b.type === 'sum' || b.type === 'switch') {
    const nIn = b.type === 'sum' ? p.signs.length : b.type === 'switch' ? p.inputs : 1;
    const stateful = STATEFUL.has(b.type) || isModelType(b.type);
    // An input not known yet: wait (a block with state decides when forced).
    if (known.length < inW.length && !(stateful && force)) return null;
    const outs = b.type === 'sink' || b.type === 'terminator' ? [] : [widest];
    return { ins: all(widest, nIn), outs };
  }
  // Physics blocks, External plants: scalar ports only.
  const [nIn, nOut] = env.ports(b);
  return { ins: all(1, nIn), outs: all(1, nOut) };
}
// A Finite difference observer with one u and one y group: its estimates are
// y and ẏ, each as wide as y (robot.md §2).
const grouped = (b) => b.type === 'observer' && b.params.inputs === 2 && b.params.outputs === 2 && b.variants?.every((v) => v.type === 'difference');

// ---- The pass

const flatCache = new WeakMap();

// diagram → a scalar diagram (or diagram itself when it has no vectors).
// opts.ports(block) → [inputs, outputs] of a scalar block (diagram.js's
// blockPorts). The result is memoised by the diagram object.
export function flattenVectors(diagram, opts) {
  if (diagram.scalar || !needsPass(diagram)) return diagram;
  const hit = flatCache.get(diagram);
  if (hit) return hit;
  const { W, levels, keyOf, childOf, where } = widthPass(diagram, opts);
  // Every wire: the source's width is the input's, or 1 (it broadcasts).
  for (const lv of levels) {
    for (const [to, from] of lv.into) {
      const [tid, tp] = to.split(':'), [fid, fp] = from.split(':');
      const tw = W.get(keyOf(lv, tid)).ins[Number(tp)], fw = W.get(keyOf(lv, fid)).outs[Number(fp)];
      if (fw !== tw && fw !== 1) throw new Error(`${where(lv, lv.byId[tid])}: input ${Number(tp) + 1} takes ${tw} element${tw === 1 ? '' : 's'} but ${where(lv, lv.byId[fid])} gives ${fw}`);
    }
  }
  const out = expandLevel(levels[0], { W, keyOf, childOf, opts, levels }).diagram;
  if (diagram.robots) out.robots = diagram.robots;
  out.scalar = true;   // flattened already (a copy of it is too)
  flatCache.set(diagram, out);
  return out;
}

// The width of every wire of one level (path: the ids of the subsystems
// it is inside), by the wire's index: what its source gives, from the same
// pass as flattenVectors. A diagram without vectors has width 1 everywhere;
// throws what the pass refuses. For the editor, which draws vector wires.
const widthCache = new WeakMap();
export function wireWidths(diagram, path = [], opts) {
  let level = diagram;
  for (const id of path) level = level.blocks.find((b) => b.id === id)?.diagram ?? level;
  if (diagram.scalar || !needsPass(diagram)) return level.wires.map(() => 1);
  let pass = widthCache.get(diagram);
  if (!pass) { pass = widthPass(diagram, opts); widthCache.set(diagram, pass); }
  const lv = pass.levels.find((l) => l.d === level);
  return level.wires.map((w) => {
    const [fid, fp = 0] = w.from.split(':');
    return pass.W.get(pass.keyOf(lv, fid))?.outs[Number(fp)] ?? 1;
  });
}

// The widths of every block's port groups, level by level.
function widthPass(diagram, opts) {
  const parsed = robotsOf(diagram.robots);
  const robot = (name) => {
    const r = parsed[name];
    if (!r) throw new Error(`no robot "${name}" in the diagram's robots${Object.keys(parsed).length ? ` (it has ${Object.keys(parsed).join(', ')})` : ''}`);
    return r.model;
  };
  const W = new Map();   // block key → { ins, outs }
  const levels = [];      // { d, path, parent: { key, level } | null }
  const walk = (d, path, parent) => {
    const lv = { d, path, parent, byId: Object.fromEntries(d.blocks.map((b) => [b.id, b])), into: new Map() };
    for (const w of d.wires) lv.into.set(w.to.includes(':') ? w.to : `${w.to}:0`, w.from.includes(':') ? w.from : `${w.from}:0`);
    levels.push(lv);
    for (const b of d.blocks) if (b.type === 'subsystem') walk(b.diagram, `${path}${b.id}/`, { key: `${path}${b.id}`, lv });
    return lv;
  };
  walk(diagram, '', null);
  const keyOf = (lv, id) => `${lv.path}${id}`;
  const childOf = new Map(levels.filter((l) => l.parent).map((l) => [l.parent.key, l]));
  const where = (lv, b) => `'${lv.path}${b.name ?? b.id}'`;
  // The width of what feeds input port k of block b at level lv.
  const fed = (lv, b, k) => {
    const src = lv.into.get(`${b.id}:${k}`);
    if (!src) return 1;
    const [id, port] = src.split(':');
    const w = W.get(keyOf(lv, id));
    return w ? w.outs[Number(port)] : undefined;
  };
  const units = levels.flatMap((lv) => lv.d.blocks.map((b) => ({ lv, b, key: keyOf(lv, b.id) })));
  const decide = (force) => {
    let progress = false;
    for (const u of units) {
      if (done.has(u.key)) continue;
      const { lv, b } = u;
      let res = null;
      if (b.type === 'subsystem') {
        // Port by port: a loop may run out of one port and back into another.
        const inner = childOf.get(u.key);
        const ports = (t) => b.diagram.blocks.filter((x) => x.type === t).sort((a, c) => a.params.port - c.params.port);
        const ins = ports('inport').map((x) => W.get(keyOf(inner, x.id))?.outs[0]);
        const outs = ports('outport').map((x) => W.get(keyOf(inner, x.id))?.ins[0]);
        const known = (r) => (r ? [...r.ins, ...r.outs].filter((x) => x !== undefined).length : -1);
        const before = known(W.get(u.key));
        if (known({ ins, outs }) > before) { W.set(u.key, { ins, outs }); progress = true; }
        if (ins.every((x) => x !== undefined) && outs.every((x) => x !== undefined)) done.add(u.key);
        continue;
      } else if (b.type === 'inport' && lv.parent) {
        const parent = lv.parent.lv, sub = parent.byId[lv.parent.key.split('/').pop()];
        const order = sub.diagram.blocks.filter((x) => x.type === 'inport').sort((a, c) => a.params.port - c.params.port);
        const w = fed(parent, sub, order.indexOf(b));
        if (w !== undefined) res = { ins: [], outs: [w] };
        else if (force) res = { ins: [], outs: [1] };
      } else if (b.type === 'inport') res = { ins: [], outs: [1] };
      else if (b.type === 'outport') {
        const w = fed(lv, b, 0);
        if (w !== undefined) res = { ins: [w], outs: lv.parent ? [w] : [] };
      } else {
        const nIn = (VECTOR_ELEMENTS[b.type] ? VECTOR_ELEMENTS[b.type].ports(b.params) : opts.ports(b))[0];
        const inW = Array.from({ length: nIn }, (_, k) => fed(lv, b, k));
        const env = { name: where(lv, b), robot, ports: opts.ports, wired: (k) => lv.into.has(`${b.id}:${k}`) };
        try { res = blockWidths(b, inW, env, force); } catch (e) { throw new Error(`${e.message.startsWith("'") ? '' : `${where(lv, b)}: `}${e.message}`); }
      }
      if (res) { W.set(u.key, res); done.add(u.key); progress = true; }
    }
    return progress;
  };
  const done = new Set();
  while (done.size < units.length) {
    if (decide(false)) continue;
    if (!decide(true)) break;
  }
  const open = units.filter((u) => !done.has(u.key));
  if (open.length) throw new Error(`the width of ${open.slice(0, 4).map((u) => where(u.lv, u.b)).join(', ')} cannot be told: a loop needs a block with state whose width is declared (an Integrator's x0 or width)`);
  return { W, levels, keyOf, childOf, where };
}

// ---- Expansion

// The scalar blocks of one level. Each block gives, per input group, the
// scalar input ends of its elements, and per output group, a reference per
// element: a scalar output end ("id:port"), or an alias of one of its own
// input elements (Mux and Demux create no block).
function expandLevel(lv, cx) {
  const blocks = [], wires = [], ins = {}, outs = {};
  const end = (id, port) => (port ? `${id}:${port}` : id);
  const copyId = (id, k, n) => (n === 1 ? id : `${id}[${k + 1}]`);
  for (const b of lv.d.blocks) {
    const w = cx.W.get(cx.keyOf(lv, b.id));
    const def = VECTOR_ELEMENTS[b.type];
    const label = b.name ?? b.id;
    if (b.type === 'mux') {
      ins[b.id] = null;
      outs[b.id] = [w.ins.flatMap((n, g) => Array.from({ length: n }, (_, i) => ({ alias: [b.id, g, i] })))];
      continue;
    }
    if (b.type === 'demux') {
      ins[b.id] = null;
      let off = 0;
      outs[b.id] = w.outs.map((n) => { const o = off; off += n; return Array.from({ length: n }, (_, i) => ({ alias: [b.id, 0, o + i] })); });
      continue;
    }
    if (def) {
      // One scalar block with every element as a port.
      const nIn = sum(w.ins), nOut = sum(w.outs);
      blocks.push({ id: b.id, type: 'mimo', name: b.name, params: { op: b.type, p: b.params, inW: w.ins, outW: w.outs, nIn, nOut, label: `${lv.path}${label}` }, x: b.x, y: b.y });
      let k = 0;
      ins[b.id] = w.ins.map((n) => Array.from({ length: n }, () => end(b.id, k++)));
      k = 0;
      outs[b.id] = w.outs.map((n) => Array.from({ length: n }, () => end(b.id, k++)));
      continue;
    }
    if (b.type === 'subsystem') {
      const inner = expandLevel(cx.childOf.get(cx.keyOf(lv, b.id)), cx);
      blocks.push({ ...b, diagram: inner.diagram });
      let k = 0;
      ins[b.id] = w.ins.map((n) => Array.from({ length: n }, () => end(b.id, k++)));
      k = 0;
      outs[b.id] = w.outs.map((n) => Array.from({ length: n }, () => end(b.id, k++)));
      continue;
    }
    if (b.type === 'inport' || b.type === 'outport') {
      // A port of width n becomes n ports, numbered on after the groups before it.
      const n = b.type === 'inport' ? w.outs[0] : w.ins[0];
      const siblings = lv.d.blocks.filter((x) => x.type === b.type).sort((a, c) => a.params.port - c.params.port);
      let base = 0;
      for (const s of siblings) { if (s === b) break; const sw = cx.W.get(cx.keyOf(lv, s.id)); base += b.type === 'inport' ? sw.outs[0] : sw.ins[0]; }
      const ids = Array.from({ length: n }, (_, k) => copyId(b.id, k, n));
      ids.forEach((id, k) => blocks.push({ ...b, id, ...(n > 1 ? { name: `${label}[${k + 1}]` } : {}), params: { port: base + k + 1 } }));
      ins[b.id] = [ids];
      outs[b.id] = [ids];
      continue;
    }
    if (b.type === 'source') {
      const n = 1 + (b.params.derivatives ?? 0);
      const { derivatives, ...rest } = b.params;
      blocks.push({ ...b, params: rest });
      for (let k = 1; k < n; k++) blocks.push({ ...b, id: `${b.id}[d${k}]`, name: `${label}${"'".repeat(k)}`, params: { ...rest, derivative: k } });
      ins[b.id] = [];
      outs[b.id] = Array.from({ length: n }, (_, k) => [k ? `${b.id}[d${k}]` : b.id]);
      continue;
    }
    if (b.type === 'controller' && (b.params.lanes ?? 1) > 1) {
      const lanes = b.params.lanes, nIn = b.params.inputs + (b.params.ff ? 1 : 0);
      const ids = Array.from({ length: lanes }, (_, k) => `${b.id}[${k + 1}]`);
      ids.forEach((id, k) => blocks.push({ ...b, id, name: `${label}[${k + 1}]`, params: { inputs: b.params.inputs, Ts: b.params.Ts, lane: k + 1, lanes, ...(b.params.ff ? { ff: 1 } : {}) } }));
      ins[b.id] = Array.from({ length: nIn }, (_, g) => ids.map((id) => end(id, g)));
      outs[b.id] = [ids];
      continue;
    }
    if (b.type === 'controller' && b.params.ff) {
      blocks.push(b);
      ins[b.id] = Array.from({ length: b.params.inputs + 1 }, (_, g) => [end(b.id, g)]);
      outs[b.id] = [[b.id]];
      continue;
    }
    if (grouped(b)) {
      const m = w.outs[0], wu = w.ins[0];
      blocks.push({ ...b, params: { ...b.params, inputs: wu + m, outputs: 2 * m, groups: [wu, m] } });
      // A finite difference reads no u: left open, it reads a 0 of its own (no warning).
      if (!lv.into.has(`${b.id}:0`)) { blocks.push({ id: `${b.id}[u]`, type: 'mimo', params: { op: 'constant', p: { value: 0 }, inW: [], outW: [1], nIn: 0, nOut: 1, label: `${lv.path}${label}/u` }, x: b.x, y: b.y }); wires.push({ from: `${b.id}[u]`, to: b.id }); }
      ins[b.id] = [Array.from({ length: wu }, (_, i) => end(b.id, i)), Array.from({ length: m }, (_, i) => end(b.id, wu + i))];
      outs[b.id] = [Array.from({ length: m }, (_, i) => end(b.id, i)), Array.from({ length: m }, (_, i) => end(b.id, m + i))];
      continue;
    }
    const n = b.type === 'sink' || b.type === 'terminator' ? w.ins[0] : w.outs[0] ?? 1;
    const nIn = w.ins.length;
    const allScalar = w.ins.every((x) => x === 1) && w.outs.every((x) => x === 1);
    if (allScalar && !(b.type === 'integrator' && Array.isArray(b.params.x0)) && !(b.type === 'sink' && String(b.params.name).includes(','))) {
      blocks.push(b);
      ins[b.id] = Array.from({ length: nIn }, (_, g) => [end(b.id, g)]);
      outs[b.id] = w.outs.map((_, g) => [end(b.id, g)]);
      continue;
    }
    // Element by element: one copy per element.
    const ids = Array.from({ length: n }, (_, k) => copyId(b.id, k, n));
    ids.forEach((id, k) => blocks.push(elementCopy(b, id, k, n, label)));
    ins[b.id] = Array.from({ length: nIn }, (_, g) => ids.map((id) => end(id, g)));
    outs[b.id] = w.outs.map((_, g) => ids.map((id) => end(id, g)));
  }
  // Wires: element by element, a width-1 source to every element.
  const resolve = (ref, depth = 0) => {
    if (typeof ref === 'string' || ref === null) return ref;
    if (depth > 4096) throw new Error('a loop of Mux and Demux blocks only: no signal starts in it');
    const [id, g, i] = ref.alias;
    const from = lv.into.get(`${id}:${g}`);
    if (!from) return null;
    const [fid, fp] = from.split(':');
    const src = outs[fid][Number(fp)];
    return resolve(src.length === 1 ? src[0] : src[i], depth + 1);
  };
  for (const [to, from] of lv.into) {
    const [tid, tp] = to.split(':'), [fid, fp] = from.split(':');
    const dst = ins[tid];
    if (!dst) continue;   // into a Mux or Demux: read through its aliases
    const src = outs[fid][Number(fp)];
    dst[Number(tp)].forEach((e, i) => {
      const s = resolve(src.length === 1 ? src[0] : src[i]);
      if (s) wires.push({ from: s, to: e });
    });
  }
  return { diagram: { blocks, wires }, ins, outs };
}

// Copy k of n of a block applied element by element: Sinks named per
// element, Integrators with their element of x0, Noise with its own seed.
function elementCopy(b, id, k, n, label) {
  const p = b.params, copy = { ...b, id };
  if (n > 1) copy.name = `${label}[${k + 1}]`;
  if (b.type === 'sink') {
    const names = String(p.name).split(','), units = String(p.unit ?? '1').split(',');
    const name = names.length > 1 ? names[k] : n > 1 ? `${p.name}${k + 1}` : p.name;
    copy.params = { name, unit: units.length > 1 ? units[k] : units[0] };
    if (name.length > 12) throw new Error(`Sink '${label}': "${name}" is longer than 12 characters; give the elements their names ("x, y, z")`);
    return copy;
  }
  if (b.type === 'integrator') {
    // Its element of x0; its state is labelled by the element ("Arm/q3").
    const { width, ...rest } = p;
    copy.params = { ...rest, x0: p.x0 === undefined ? 0 : at(p.x0, k) };
    if (n > 1) copy.name = `${label}${k + 1}`;
    return copy;
  }
  if (b.type === 'noise') { copy.params = { ...p, seed: p.seed + k }; return copy; }
  return copy;
}
