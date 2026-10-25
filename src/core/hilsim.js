// The HIL simulator's core: a library system's plant as an external plant
// (design/output/hil-simulator.md). hil/hil_plant.py runs this module, as the
// page carries it, in V8 inside Python; the page uses it to cut its own core
// for the plant's zip. Pure: no DOM, no Node.
//
//   simPlant(opts)        the plant: the system's diagram with the page's u in
//                         place of its Controller (or its own controller in
//                         reference and log modes), varied and with its
//                         effects switched from one seed, and its interface
//                         (describe's inputs and outputs, taken from the model)
//   createSimPlant(spec)  steps it on the page's grid: advance(span, u), outputs()
//   simulatorCore(script) the page's core modules, cut from its script, for the zip

import { compileDiagram, normalizeDiagram, parseEnd, outputNames, diagramBlockDef, diagramNames } from './diagram.js';
import { simulateSystem, stepPlan } from './sim.js';
import { referenceFn } from './signals.js';
import { EXAMPLE_PLANTS } from './plants.js';

// ---- the core for the plant

// The core modules of the page's script (from its first core/ module to its
// first ui/ module) as a script of their own, which leaves them on
// globalThis.LoopTunerCore. structuredClone is a host function a bare V8
// lacks; the core clones plain data only, which JSON does exactly.
export const CORE_FILE = 'loop-tuner-core.js';
export function simulatorCore(script) {
  const a = script.indexOf('\n// ---- core/'), b = script.indexOf('\n// ---- ui/');
  if (a < 0 || b < a) return null;
  return `(() => {\n'use strict';\nif (typeof structuredClone !== 'function') globalThis.structuredClone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));\nconst __mods = {};${script.slice(a, b)}\nglobalThis.LoopTunerCore = __mods;\n})();\n`;
}

// ---- the models it can run

const isLive = (e) => JSON.stringify(e.diagram).includes('"type":"external"');
// Every library system with a plant of its own (not the HIL systems).
export const simModels = () => EXAMPLE_PLANTS.filter((e) => !isLive(e));

// One seeded generator for every draw (mulberry32): uniform in [0, 1).
export function seededRandom(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- where things are in a diagram: "motor/arm" is block arm in subsystem
// motor; "motor/arm.den[1]" its parameter den, element 1.

function blockAt(diagram, path) {
  let d = diagram, b = null;
  for (const id of path.split('/')) {
    b = d?.blocks.find((x) => x.id === id);
    if (!b) throw new Error(`no block "${path}" in the model`);
    d = b.diagram;
  }
  return b;
}
function paramAt(diagram, at) {
  const m = /^(.+)\.(\w+)(?:\[(\d+)\])?$/.exec(at);
  if (!m) throw new Error(`"${at}": a parameter as block.key or block.key[i]`);
  const block = blockAt(diagram, m[1]), key = m[2], i = m[3] === undefined ? null : Number(m[3]);
  const now = i === null ? block.params?.[key] : block.params?.[key]?.[i];
  if (typeof now !== 'number') throw new Error(`"${at}": not a number in the model`);
  return {
    get: () => (i === null ? block.params[key] : block.params[key][i]),
    set: (v) => { if (i === null) block.params[key] = v; else block.params[key][i] = v; },
  };
}

// The physical parameters a block type flags, for a system that lists none
// (a project file): masses, lengths, friction, a tank's shape; the models'
// gains and time constants; a transfer function's coefficients; a dead time.
// Never g, start values, noise, seeds, ports, signs or controllers.
const PHYSICAL = {
  cartPole: ['M', 'm', 'l', 'b'],
  pendulumCart: (p) => ['M', 'b', ...Array.from({ length: p.links }, (_, i) => [`m${i + 1}`, `l${i + 1}`]).flat()],
  conicalTank: ['r0', 'R', 'H', 'a'],
  firstOrder: ['K', 'tau'], fopdt: ['K', 'tau', 'delay'], secondOrder: ['K', 'wn', 'zeta'], lagChain: ['K', 'tau'], integratorLag: ['K', 'tau'],
  doubleIntegrator: ['K'], inverseResponse: ['K', 'Tz', 'tau1', 'tau2'],
  tf: (p) => [...p.num.map((v, i) => (v ? `num[${i}]` : null)), ...p.den.map((v, i) => (v ? `den[${i}]` : null))].filter(Boolean),
  delay: ['L'],
};
function typePhysics(diagram, prefix = '') {
  const out = [];
  for (const b of diagram.blocks) {
    if (b.type === 'subsystem') { out.push(...typePhysics(b.diagram, `${prefix}${b.id}/`)); continue; }
    const keys = typeof PHYSICAL[b.type] === 'function' ? PHYSICAL[b.type](b.params) : PHYSICAL[b.type] ?? [];
    for (const k of keys) {
      const at = `${prefix}${b.id}.${k}`;
      const unit = (diagramBlockDef(b.type).params.find((p) => p.key === k.replace(/\[.*/, ''))?.unit) ?? '';
      out.push({ name: at, at, unit });
    }
  }
  return out;
}

// ---- the draws

// The system, its effects and its physical parameters, from one seed and in
// this order, so a seed always gives the same plant:
//   opts.model    a library system's name, or { name, signals, diagram } (a project's)
//   opts.random   draw the system from simModels() first
//   opts.vary     each physical parameter × (1 + vary·(2ρ − 1)); default 0.15
//   opts.detail   'random' (each effect on with p ½), 'all', 'none', or the
//                 names of the effects that are on (a list, or text with commas)
//   opts.set      { name: value }: physical parameters fixed after the draw
// Returns { entry, diagram (varied, effects applied), effects: [{ name, on }],
// params: [{ name, unit, nominal, value }] }.
export function drawSystem(opts = {}) {
  const rand = seededRandom(opts.seed ?? 1);
  const models = simModels();
  let entry;
  if (opts.random) entry = models[Math.floor(rand() * models.length)];
  else if (opts.model && typeof opts.model === 'object') entry = opts.model;
  else {
    const name = opts.model ?? DEFAULT_MODEL;
    entry = models.find((e) => e.name === name) ?? models.find((e) => e.name.toLowerCase() === String(name).toLowerCase());
    if (!entry) throw new Error(`no model "${name}"; --list gives the models: ${models.map((e) => e.name).join('; ')}`);
  }
  const diagram = structuredClone(entry.diagram);
  // Effects: a named block that is the effect; off, a Gain of 1 (pass) or 0 (zero).
  const known = entry.effects ?? [];
  const detail = opts.detail ?? 'random';
  let wanted = null;
  if (detail !== 'random' && detail !== 'all' && detail !== 'none') {
    wanted = (Array.isArray(detail) ? detail : String(detail).split(',')).map((s) => s.trim()).filter(Boolean);
    for (const w of wanted) if (!known.some((f) => f.name === w)) throw new Error(`--detail: no effect "${w}" in ${entry.name}; its effects: ${known.map((f) => f.name).join(', ') || 'none'}`);
  }
  const effects = known.map((f) => {
    const on = detail === 'random' ? rand() < 0.5 : detail === 'all' ? true : detail === 'none' ? false : wanted.includes(f.name);
    if (!on) {
      const b = blockAt(diagram, f.at);
      const keep = { id: b.id, x: b.x, y: b.y, ...(b.name ? { name: `${b.name} (off)` } : {}), ...(b.flip ? { flip: true } : {}) };
      for (const k of Object.keys(b)) delete b[k];
      Object.assign(b, keep, { type: 'gain', params: { K: f.off === 'zero' ? 0 : 1 } });
    }
    return { name: f.name, on };
  });
  // Physical parameters: the entry's list (named, with ties), else the block types'.
  const list = entry.physics ?? typePhysics(normalizeDiagram(structuredClone(entry.diagram)));
  const share = Number(opts.vary ?? 0.15);
  const factors = {};
  const params = [];
  for (const p of list) {
    if (p.same && !(p.same in factors)) throw new Error(`${p.name}: tied to ${p.same}, which must come first`);
    let at;
    try { at = paramAt(diagram, p.at); } catch { continue; }   // a block an effect switched off
    const nominal = at.get();
    const f = p.same ? factors[p.same] : 1 + share * (2 * rand() - 1);
    factors[p.name] = f;
    params.push({ name: p.name, unit: p.unit ?? '', nominal, value: nominal * f, at });
  }
  for (const [name, value] of Object.entries(opts.set ?? {})) {
    const p = params.find((x) => x.name === name);
    if (!p) throw new Error(`--set ${name}: not a physical parameter of ${entry.name}; its parameters: ${params.map((x) => x.name).join(', ')}`);
    p.value = Number(value);
    for (const q of params) if (list.find((x) => x.name === q.name)?.same === name) q.value = q.nominal * (p.value / p.nominal);
  }
  for (const p of params) p.at.set(p.value);
  return { entry, diagram, effects, params: params.map(({ at, ...p }) => p) };
}

// A diagram varied as the simulator varies it (identification.md §13's
// "hide a variation"), with its effects as the system has them.
export function varyDiagram(entry, vary, seed) {
  return drawSystem({ model: entry, vary, seed, detail: (entry.effects ?? []).map((f) => f.name) }).diagram;
}

export const DEFAULT_MODEL = 'DC motor with an unbalanced arm';

// ---- the diagram, flattened: who feeds what, through subsystems

// Leaves are blocks other than subsystems, In and Out, keyed by their id
// path ("motor/arm"); feeds[key][slot] is { key, port } of what drives that
// input, or null.
function flatten(diagram) {
  const leaves = new Map(), feeds = new Map();
  const wireTo = (d, id, port) => d.wires.find((w) => { const t = parseEnd(w.to); return t.id === id && t.port === port; });
  const srcOf = (d, prefix, ctx, from) => {
    const { id, port } = parseEnd(from);
    const b = d.blocks.find((x) => x.id === id);
    if (b.type === 'subsystem') {
      const out = b.diagram.blocks.find((x) => x.type === 'outport' && x.params.port === port + 1);
      const w = out && wireTo(b.diagram, out.id, 0);
      return w ? srcOf(b.diagram, `${prefix}${b.id}/`, { d, prefix, sub: b, ctx }, w.from) : null;
    }
    if (b.type === 'inport') {
      if (!ctx) return null;
      const w = wireTo(ctx.d, ctx.sub.id, b.params.port - 1);
      return w ? srcOf(ctx.d, ctx.prefix, ctx.ctx, w.from) : null;
    }
    return { key: `${prefix}${b.id}`, port };
  };
  const walk = (d, prefix, ctx) => {
    for (const b of d.blocks) {
      if (b.type === 'subsystem') { walk(b.diagram, `${prefix}${b.id}/`, { d, prefix, sub: b, ctx }); continue; }
      if (b.type === 'inport' || b.type === 'outport') continue;
      const key = `${prefix}${b.id}`;
      leaves.set(key, b);
      const slots = [];
      for (const w of d.wires) {
        const t = parseEnd(w.to);
        if (t.id === b.id) slots[t.port] = srcOf(d, prefix, ctx, w.from);
      }
      feeds.set(key, slots);
    }
  };
  walk(diagram, '', null);
  // What a set of leaves reaches, downstream, not through the leaves in stop.
  const reach = (starts, stop = new Set()) => {
    const seen = new Set(starts), todo = [...starts];
    while (todo.length) {
      const k = todo.pop();
      if (stop.has(k)) continue;
      for (const [key, slots] of feeds) if (!seen.has(key) && slots.some((s) => s?.key === k)) { seen.add(key); todo.push(key); }
    }
    return seen;
  };
  return { leaves, feeds, reach };
}

const ASCII = { θ: 'theta', ω: 'omega', φ: 'phi', α: 'alpha', β: 'beta', τ: 'tau', 'x̂': 'xhat' };
// The units of the physics blocks' outputs, by name (x, θ1, v, ω1 …).
const OUTPUT_UNITS = { x: 'm', v: 'm/s', 'θ': 'rad', 'ω': 'rad/s', h: 'm' };
const asName = (s) => {
  let n = String(s);
  for (const [g, a] of Object.entries(ASCII)) n = n.split(g).join(a);
  n = n.replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z]+/, '');
  return (n || 'y').slice(0, 12);
};

// ---- ranges: from the model where it declares them, else from its own loop

// Rounds outwards to two significant digits.
const outward = (v, up) => {
  if (v === 0) return 0;
  const e = 10 ** (Math.floor(Math.log10(Math.abs(v))) - 1);
  return (up ? Math.ceil(v / e - 1e-9) : Math.floor(v / e + 1e-9)) * e;
};
const tidy = (v) => Number(v.toPrecision(12));
// { scale: [lo, hi], hard: [lo, hi] } from an extent [a, b] (4.3).
export function rangesFrom(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { scale: [-1, 1], hard: [-1, 1] };
  if (a === b && a === 0) return { scale: [-1, 1], hard: [-1, 1] };
  if (a < 0 && b > 0) {
    const m = Math.max(-a, b);
    return { scale: [tidy(-outward(2 * m, true)), tidy(outward(2 * m, true))], hard: [tidy(-outward(1.5 * m, true)), tidy(outward(1.5 * m, true))] };
  }
  const s = b - a || Math.max(Math.abs(a), Math.abs(b));
  return { scale: [tidy(outward(a - s, false)), tidy(outward(b + s, true))], hard: [tidy(outward(a - s / 2, false)), tidy(outward(b + s / 2, true))] };
}

const finiteLimit = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

// ---- the plant

// opts: drawSystem's, and mode ('control' | 'reference' | 'log'), dyno,
// rate (Hz), setpoint (log mode). Returns the spec createSimPlant steps:
// { name, mode, rate, inputs, outputs (describe's), diagram, sources, draws }.
export function simPlant(opts = {}) {
  const mode = opts.mode ?? 'control', rate = Number(opts.rate ?? 100), dyno = !!opts.dyno;
  if (!['control', 'reference', 'log'].includes(mode)) throw new Error(`mode: control, reference or log, not "${mode}"`);
  const draw = drawSystem(opts);
  const { entry } = draw;
  const own = normalizeDiagram(draw.diagram);
  const signals = structuredClone(entry.signals ?? {});
  const flat = flatten(own);
  const ctrls = own.blocks.filter((b) => b.type === 'controller');
  if (ctrls.length > 1) throw new Error(`${entry.name}: one Controller block, for now`);
  const ctrl = ctrls[0] ?? null;
  if (!ctrl && mode !== 'control') throw new Error(`${entry.name} has no controller of its own: run it in control mode`);
  const sinks = [...flat.leaves].filter(([, b]) => b.type === 'sink').map(([key, b]) => ({ key, name: b.params.name, unit: b.params.unit ?? '1', src: flat.feeds.get(key)[0] ?? null }))
    // The top level's Sinks first, then those inside subsystems, each in diagram order.
    .sort((a, b) => a.key.split('/').length - b.key.split('/').length);
  const same = (a, b) => a && b && a.key === b.key && a.port === b.port;
  const sinkOf = (src) => sinks.find((s) => same(s.src, src));
  const isSource = (src) => src && flat.leaves.get(src.key)?.type === 'source';
  const added = [];   // Sinks added for measurements that had none
  const taken = new Set([...sinks.map((s) => s.name), ...Object.keys(signals)]);
  const fresh = (base) => { let n = asName(base), i = 2; while (taken.has(n)) n = `${asName(base).slice(0, 10)}${i++}`; taken.add(n); return n; };

  // What the Controller measures (its inputs after r), named.
  const measured = [];
  if (ctrl) {
    const slots = flat.feeds.get(ctrl.id);
    for (let j = 1; j < ctrl.params.inputs; j++) {
      const src = slots[j];
      if (!src) continue;
      let s = sinkOf(src);
      if (!s) {
        const b = flat.leaves.get(src.key);
        const names = outputNames(diagramBlockDef(b.type), b.params);
        const raw = names[src.port];
        const name = fresh(raw ?? (src.port ? `${b.id}${src.port}` : b.id));
        const unit = b.type === 'source' ? b.params.unit : OUTPUT_UNITS[String(raw ?? '').replace(/\d+$/, '')] ?? '1';
        s = { key: null, name, unit, src };
        added.push(s);
      }
      if (!measured.includes(s)) measured.push(s);
    }
  }

  // The own loop with the added Sinks: what the ranges are simulated on.
  const withSinks = (d, list) => {
    const out = structuredClone(d);
    for (const s of list) {
      const id = `hil_${s.name}`;
      out.blocks.push({ id, type: 'sink', params: { name: s.name, unit: s.unit }, x: 0, y: 0 });
      const [path, ...rest] = s.src.key.split('/');
      if (rest.length) throw new Error(`${entry.name}: a measurement inside a subsystem needs a Sink`);
      out.wires.push({ from: s.src.port ? `${path}:${s.src.port}` : path, to: id });
    }
    return normalizeDiagram(out);
  };
  const ownLoop = withSinks(own, added);
  const later = [];   // Sinks added after the ranges were simulated (the plant's own u)
  const period = Math.max(1, ...Object.values(signals).map((s) => s.period ?? 1));
  const step = Math.min(1 / rate, entry.sim?.sampleTime ?? 1 / rate);
  const run = simulateSystem(ownLoop, signals, { duration: 2 * period, sampleTime: step });
  const extent = (name) => {
    const v = run.signals[name];
    if (!v) return [NaN, NaN];
    let a = Infinity, b = -Infinity;
    for (const x of v) if (Number.isFinite(x)) { if (x < a) a = x; if (x > b) b = x; }
    return a <= b ? [a, b] : [NaN, NaN];
  };
  const declared = entry.ports ?? {};
  const from = {};
  const rangesOf = (name, ext) => {
    const d = declared[name];
    if (d?.hard || d?.scale) { from[name] = 'model'; return { scale: d.scale ?? d.hard, hard: d.hard ?? d.scale }; }
    from[name] = 'simulation';
    return rangesFrom(...ext);
  };

  // Inputs.
  const inputs = [], inputOf = {};   // inputOf: Source signal (or the effort's own) -> index
  const plant = structuredClone(ownLoop);
  const dropped = new Set();
  const effortSink = ctrl ? sinks.find((s) => s.src?.key === ctrl.id) : null;
  const variant = ctrl ? ctrl.variants[ctrl.variant] : null;
  const limits = variant ? [finiteLimit(variant.params.umin), finiteLimit(variant.params.umax)] : [null, null];
  const effortRange = () => {
    if (limits[0] !== null && limits[1] !== null) { from[effortSink?.name ?? 'u'] = 'model'; return [limits[0], limits[1]]; }
    const r = rangesOf(effortSink?.name ?? 'u', extent(`${ctrl.id}.u`));
    return r.scale;
  };
  const addInput = (port) => {
    const d = declared[port.name]?.scale;
    if (d) { [port.min, port.max] = d; from[port.name] = 'model'; }
    port.safe = Math.min(port.max, Math.max(port.min, 0));
    inputs.push(port);
    return inputs.length - 1;
  };
  const rSource = ctrl ? flat.feeds.get(ctrl.id)[0] : null;
  const rSignal = rSource && isSource(rSource) ? flat.leaves.get(rSource.key).params.signal : null;
  const sources = [...flat.leaves].filter(([, b]) => b.type === 'source').map(([key, b]) => ({ key, signal: b.params.signal, unit: b.params.unit ?? '1' }));
  if (ctrl && mode === 'control') {
    const [lo, hi] = effortRange();
    const name = effortSink?.name ?? fresh('u');
    const i = addInput({ name, unit: effortSink?.unit ?? '1', min: lo, max: hi, kind: 'effort' });
    // The Controller's place: a Source that plays the page's u.
    const b = plant.blocks.find((x) => x.id === ctrl.id);
    const keep = { id: b.id, x: b.x, y: b.y, name: 'u from the page' };
    for (const k of Object.keys(b)) delete b[k];
    Object.assign(b, keep, { type: 'source', params: { signal: 'hilu0', unit: effortSink?.unit ?? '1' } });
    plant.wires = plant.wires.filter((w) => parseEnd(w.to).id !== ctrl.id);
    inputOf.hilu0 = i;
    // Sources only the Controller's r read are gone with it.
    if (rSignal) dropped.add(rSource.key);
  }
  if (ctrl && mode === 'reference' && rSignal) {
    const m = measured[0];
    const r = m ? rangesOf(m.name, extent(m.name)) : rangesOf(rSignal, extent(rSignal));
    inputOf[rSignal] = addInput({ name: rSignal, unit: m?.unit ?? sources.find((s) => s.signal === rSignal).unit, min: r.scale[0], max: r.scale[1], kind: 'reference', ...(m ? { measures: m.name } : {}) });
  }
  // Disturbances (and, without a Controller, the effort): the Sources that feed the plant.
  let first = !ctrl;
  for (const s of sources) {
    if (s.signal === rSignal || dropped.has(s.key)) continue;
    const kind = first ? 'effort' : 'disturbance';
    if (kind === 'disturbance' && !dyno) continue;
    // A disturbance pushes both ways: twice the largest it reaches in its own signal.
    const [a, b] = extent(s.signal), most = Math.max(Math.abs(a), Math.abs(b));
    from[s.signal] = 'simulation';
    const r = kind === 'effort' ? rangesOf(s.signal, [a, b]).scale : most > 0 ? [tidy(-outward(2 * most, true)), tidy(outward(2 * most, true))] : [-1, 1];
    inputOf[s.signal] = addInput({ name: s.signal, unit: s.unit, min: r[0], max: r[1], kind });
    first = false;
  }

  // Outputs: the measurements, then the other Sinks, but none that copies an
  // input or depends on a dropped Source; in reference and log modes the
  // Controller's u as the plant's effort, and in log mode its reference.
  const drop = flat.reach([...dropped], new Set(ctrl ? [ctrl.id] : []));
  const inputKeys = new Set([...sources.filter((s) => s.signal in inputOf).map((s) => s.key), ...(ctrl && mode === 'control' ? [ctrl.id] : [])]);
  const outputs = [];
  const addOutput = (s, kind) => {
    const ext = extent(s.name);
    const r = kind === 'effort' && limits[0] !== null && limits[1] !== null ? (from[s.name] = 'model', { scale: limits, hard: null }) : rangesOf(s.name, ext);
    outputs.push({ name: s.name, unit: s.unit, min: r.scale[0], max: r.scale[1], ...(r.hard ? { hard_min: r.hard[0], hard_max: r.hard[1] } : {}), kind: kind ?? 'measurement' });
  };
  for (const s of measured) addOutput(s);
  for (const s of sinks) {
    if (measured.includes(s) || (s.key && drop.has(s.key))) continue;
    if (s === effortSink && mode !== 'control') continue;
    if (s.src && (inputKeys.has(s.src.key) || isSource(s.src))) continue;
    addOutput(s);
  }
  if (ctrl && mode !== 'control') {
    let s = effortSink;
    if (!s) { s = { key: null, name: fresh('u'), unit: '1', src: { key: 'hil_gate', port: 0 } }; later.push(s); }
    addOutput(s, 'effort');
    // The plant's own controller acts only while the plant runs: a Switch
    // after it gives the safe effort (0) while stopped, as the plant always did.
    for (const w of plant.wires) if (parseEnd(w.from).id === ctrl.id) w.from = 'hil_gate';
    plant.blocks.push({ id: 'hil_gate', type: 'switch', params: { inputs: 2, position: 2 }, x: 0, y: 0 }, { id: 'hil_safe', type: 'source', params: { signal: 'hilsafe', unit: '1' }, x: 0, y: 0 });
    plant.wires.push({ from: ctrl.id, to: 'hil_gate' }, { from: 'hil_safe', to: 'hil_gate:1' });
  }
  let setpointName = null;
  if (mode === 'log' && rSignal) {
    setpointName = fresh('setpoint');
    plant.blocks.push({ id: 'hil_setpoint', type: 'sink', params: { name: setpointName, unit: sources.find((s) => s.signal === rSignal).unit }, x: 0, y: 0 });
    plant.wires.push({ from: rSource.key, to: 'hil_setpoint' });
    outputs.push({ name: setpointName, unit: sources.find((s) => s.signal === rSignal).unit, ...(() => { const r = rangesOf(rSignal, extent(rSignal)); return { min: r.scale[0], max: r.scale[1] }; })(), kind: 'measurement' });
  }
  if (!outputs.length) throw new Error(`${entry.name}: nothing to measure (no Sink, no Controller input)`);
  const final = withSinks(plant, later);
  const shown = diagramNames(final).sinks;
  for (const o of outputs) if (!shown.includes(o.name)) throw new Error(`${o.name}: no Sink`);
  for (const p of inputs) if (p.min > p.max) [p.min, p.max] = [p.max, p.min];

  // What each Source plays in the plant: an input's value, the system's own
  // waveform (log mode's reference, or the setpoint), or 0.
  const sourcePlays = {};
  for (const s of sources) {
    if (s.signal in inputOf) sourcePlays[s.signal] = { input: inputOf[s.signal] };
    else if (mode === 'log' && s.signal === rSignal) sourcePlays[s.signal] = opts.setpoint !== undefined && opts.setpoint !== null ? { value: Number(opts.setpoint) } : { wave: signals[s.signal] ?? null };
    else sourcePlays[s.signal] = { value: 0 };
  }
  sourcePlays.hilu0 = { input: inputOf.hilu0 ?? 0 };
  sourcePlays.hilsafe = { value: 0 };
  return {
    name: `Simulated plant${mode === 'control' ? '' : `, ${mode} mode`}`,
    mode, rate, inputs, outputs, diagram: final, sources: sourcePlays, signals, loop: ownLoop, gate: !!ctrl && mode !== 'control',
    draws: { system: entry.name, seed: opts.seed ?? 1, vary: Number(opts.vary ?? 0.15), effects: draw.effects, params: draw.params, ranges: from },
  };
}

// The plant's describe ports and draws as text for --show-params.
export function drawsText(spec) {
  const d = spec.draws;
  const pct = (p) => (p.nominal ? `${((p.value / p.nominal - 1) * 100).toFixed(1)} %` : '');
  const g = (v) => Number(Number(v).toPrecision(4));
  return [
    `system: ${d.system} (seed ${d.seed}, vary ±${(d.vary * 100).toFixed(0)} %)`,
    `effects: ${d.effects.length ? d.effects.map((f) => `${f.name} ${f.on ? 'on' : 'off'}`).join(', ') : 'none'}`,
    `parameters: ${d.params.map((p) => `${p.name} ${g(p.value)}${p.unit ? ` ${p.unit}` : ''} (${g(p.nominal)}, ${pct(p)})`).join(', ') || 'none'}`,
    `ranges: ${[...spec.inputs, ...spec.outputs].map((p) => `${p.name} from the ${d.ranges[p.name] ?? 'simulation'}`).join(', ')}`,
  ].join('\n');
}

// ---- stepping

// The plant stepped on the page's grid: substeps h = dt/m, every sample of a
// Controller on it, the same time arithmetic as simulateSystem, so whole
// cycles give the page's simulation sample for sample. advance(span, u)
// integrates a span with u held, cutting a substep where the span ends.
export function createSimPlant(spec) {
  const u = spec.inputs.map((p) => p.safe);
  const fns = {};
  for (const [name, play] of Object.entries(spec.sources)) {
    if (play.input !== undefined) { const i = play.input; fns[name] = () => u[i]; } else if (play.wave) {
      const f = referenceFn(play.wave, { sampleTime: 1 / spec.rate });
      fns[name] = f;
    } else { const v = play.value ?? 0; fns[name] = () => v; }
  }
  const sources = new Proxy({}, { get: (_, n) => fns[n] ?? (() => 0) });
  const dt = 1 / spec.rate;
  // Compiled again when the plant starts or stops (reference and log modes):
  // its own controller starts afresh at each run and is gated off while it
  // is stopped; the continuous state goes on (dead times start afresh).
  let el, m, split, h, names, index, running = false;
  const X = new Float64Array(compileDiagram(spec.diagram, 'plant', { standalone: true, sources }).n);
  const N = X.length;
  const build = () => {
    const d = structuredClone(spec.diagram);
    if (spec.gate) d.blocks.find((b) => b.id === 'hil_gate').params.position = running ? 1 : 2;
    el = compileDiagram(d, 'plant', { standalone: true, sources });
    ({ m, split } = stepPlan(dt, el.bound, el.sampleTimes, 1));
    h = dt / m;
    el.setStep(h);
    names = el.probes().map(([n]) => n);
    index = spec.outputs.map((o) => names.indexOf(o.name));
  };
  build();
  const Xt = new Float64Array(N), k1 = new Float64Array(N), k2 = new Float64Array(N), k3 = new Float64Array(N), k4 = new Float64Array(N);
  el.init(X, 0);
  const rk4 = (ts, d) => {
    el.eval(ts, X, 0, 0, k1);
    for (let i = 0; i < N; i++) Xt[i] = X[i] + 0.5 * d * k1[i];
    el.eval(ts + 0.5 * d, Xt, 0, 0, k2);
    for (let i = 0; i < N; i++) Xt[i] = X[i] + 0.5 * d * k2[i];
    el.eval(ts + 0.5 * d, Xt, 0, 0, k3);
    for (let i = 0; i < N; i++) Xt[i] = X[i] + d * k3[i];
    el.eval(ts + d, Xt, 0, 0, k4);
    for (let i = 0; i < N; i++) X[i] += (d / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  };
  const onGrid = (t) => Math.round(t * 1e9) / 1e9;
  // A grid point's record (what dead times remember) waits for the input
  // that holds from it: in the page the sample there sets u first, and here
  // the next span brings it.
  let pending = true;
  const recordAt = (t) => { if (!pending) return; el.eval(t, X, 0, 0, null); el.record(); pending = false; };
  el.eval(0, X, 0, 0, null);
  el.sample(0, X, 0, 0);
  let k = 0, s = 0, a = 0;   // cycle, substep, time into the substep
  // Integrates the substep under way from a to b (≤ h), sampling where a
  // Controller is due inside; at its end, as simulateSystem does.
  const part = (b) => {
    const tk = k * dt, ts = tk + s * h;
    if (a === 0) recordAt(s ? onGrid(ts) : tk);
    let at = ts + a;
    const end = b >= h * (1 - 1e-9);
    const stop = end ? onGrid(tk + (s + 1) * h) : ts + b;
    if (split) {
      for (let tn = onGrid(el.nextSample()); tn < stop - 1e-9; tn = onGrid(el.nextSample())) {
        if (tn > at) { rk4(at, tn - at); at = tn; }
        el.eval(tn, X, 0, 0, null);
        el.sample(tn, X, 0, 0);
      }
    }
    if (end) {
      rk4(at, ts + h - at);
      el.eval(stop, X, 0, 0, null);
      el.sample(stop, X, 0, 0);
      pending = true;
      a = 0;
      if (++s === m) { s = 0; k++; }
    } else {
      rk4(at, ts + b - at);
      el.eval(ts + b, X, 0, 0, null);
      a = b;
    }
  };
  return {
    rate: spec.rate, substeps: m,
    get t() { return k * dt + s * h + a; },
    advance(span, values) {
      for (let i = 0; i < u.length; i++) {
        const v = Number(values?.[i]);
        u[i] = Number.isFinite(v) ? Math.min(spec.inputs[i].max, Math.max(spec.inputs[i].min, v)) : spec.inputs[i].safe;
      }
      let left = Number(span);
      if (!(left > 0)) return;
      while (left > h * 1e-9) {
        const room = h - a;
        if (left >= room * (1 - 1e-9)) { left -= room; part(h); } else { part(a + left); left = 0; }
      }
    },
    outputs() { const all = el.probes(); return index.map((i) => all[i][1]); },
    // The plant starts or stops: its own controller (if it runs one) afresh, or gated off.
    running(on) {
      if (!spec.gate || running === !!on) return;
      running = !!on;
      const t = k * dt + s * h + a;
      build();
      el.eval(t, X, 0, 0, null);
      el.sample(t, X, 0, 0);
    },
    // One cycle from the Python plant: [[seconds, [u…]], …] in order; the outputs after it.
    cycle(segments) {
      for (const [span, values] of segments) this.advance(span, values);
      return this.outputs();
    },
  };
}

// For the Python plant: one call that builds the plant from its options and
// keeps it on globalThis.__plant. Returns describe's ports and the draws.
export function startSimPlant(opts) {
  const spec = simPlant(opts);
  const plant = createSimPlant(spec);
  globalThis.__plant = plant;
  return JSON.stringify({ name: spec.name, mode: spec.mode, inputs: spec.inputs, outputs: spec.outputs, draws: spec.draws, text: drawsText(spec), substeps: plant.substeps });
}

// --list: every model, its inputs and outputs in control mode.
export function listModels() {
  return simModels().map((e) => {
    try {
      const p = simPlant({ model: e.name, vary: 0, detail: 'all', dyno: true });
      return `${e.name}: in ${p.inputs.map((x) => `${x.name} [${x.unit}]`).join(', ')}; out ${p.outputs.map((x) => `${x.name} [${x.unit}]`).join(', ')}`;
    } catch (err) { return `${e.name}: ${err.message}`; }
  }).join('\n');
}

// --check: the model as the System library has it (nominal, every effect on,
// its own controller and signals) for one period: its outputs at the end.
export function checkText(opts = {}) {
  const spec = simPlant({ ...opts, vary: 0, detail: 'all', mode: 'control', dyno: false });
  const period = Math.max(1, ...Object.values(spec.signals).map((s) => s.period ?? 1));
  const run = simulateSystem(spec.loop, spec.signals, { duration: period, sampleTime: 1 / spec.rate });
  const last = (n) => run.signals[n]?.[run.t.length - 1];
  const g = (v) => (Number.isFinite(v) ? String(Number(v.toPrecision(4))) : 'not a number');
  return `${spec.draws.system}, nominal, after ${period} s of its own controller: ${spec.outputs.map((o) => `${o.name} ${g(last(o.name))} ${o.unit}`).join(', ')}`;
}
