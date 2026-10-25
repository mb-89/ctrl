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
import { eig, csolve } from './linalg.js';
import { siUnit } from './scale.js';
import { gaussAt } from './signals.js';
import { isFormula, parseFormula, formulaNames, compileFormula, isReserved, NAME_RE } from './formula.js';
import { CONTROLLERS, normalizeVariant, makeLaw } from './controllers.js';
import { isOldPhysics, expandPhysics } from './physics.js';
import { MECH_ELEMENTS, isPart, normalizeJoins, mechanisms, mechanismOde, checkCoord } from './mech.js';
import { equationSheet } from './sheet.js';
import { OBSERVERS } from './observers.js';
import { SYNC_DESIGNS, defaultDesigns } from './design.js';
import { EXTERNAL_BLOCK } from './hil.js';
import { COMPONENTS, withPrefix } from './components.js';
import { VECTOR_ELEMENTS, flattenVectors, vectorExtras, normalizeRobots, mimoContext, makeMimo } from './vectors.js';

const num = (key, label, def, extra = {}) => ({ key, label, default: def, ...extra });

// Elementary blocks. Plant models from blocks.js (first order, n lags, ...)
// are diagram blocks too: their transfer function becomes the block.
export const ELEMENTS = {
  source: { label: 'Source', group: 'Signals', params: [{ key: 'signal', label: 'Signal', default: 'r', kind: 'name' }, { key: 'unit', label: 'Unit', default: '1', kind: 'unit' }], ports: (p) => [0, 1 + (p.derivatives ?? 0)], formula: 'r(t)' },
  sink: { label: 'Sink', group: 'Signals', params: [{ key: 'name', label: 'Name', default: 'y1', kind: 'name' }, { key: 'unit', label: 'Unit', default: '1', kind: 'unit' }], ports: () => [1, 0], formula: 'y' },
  terminator: { label: 'Terminator', group: 'Signals', params: [], ports: () => [1, 0], formula: 'ends a signal' },
  switch: {
    label: 'Switch', group: 'Math', formula: 'passes one input',
    params: [num('inputs', 'Inputs', 2, { min: 2, int: true }), num('position', 'Position', 1, { min: 1, int: true, maskable: true })],
    ports: (p) => [p.inputs, 1],
  },
  inport: { label: 'In', group: 'Ports', params: [num('port', 'Port', 1, { min: 1, int: true })], ports: () => [0, 1], formula: 'u' },
  outport: { label: 'Out', group: 'Ports', params: [num('port', 'Port', 1, { min: 1, int: true })], ports: () => [1, 0], formula: 'y' },
  gain: { label: 'Gain', group: 'Math', params: [num('K', 'K', 1)], ports: () => [1, 1], formula: 'K' },
  sum: { label: 'Sum', group: 'Math', params: [{ key: 'signs', label: 'Signs', default: '+-', kind: 'signs' }], ports: (p) => [p.signs.length, 1], formula: 'Σ' },
  // The Integrator with a start value and limits (transparent-models.md
  // §1.3): rate K·u, but 0 where the state sits at a limit and K·u pushes
  // beyond it; its output is the state clamped to [min, max], so a tank
  // overflows at its brim and stops when dry. Empty limits (or ±inf): none.
  // unit and angle label its state for the design layer and the planner.
  integrator: {
    label: 'Integrator', group: 'Dynamics', formula: 'K / s',
    params: [num('K', 'K', 1), num('x0', 'Start x₀', 0), num('min', 'Min', null, { nullable: 'none', inf: true }), num('max', 'Max', null, { nullable: 'none', inf: true }),
      { key: 'unit', label: 'Unit', default: '1', kind: 'unit' }, num('angle', 'Angle (0/1)', 0, { int: true, min: 0, max: 1 })],
    ports: () => [1, 1], tf: (p) => ({ num: [p.K], den: [1, 0] }),
  },
  // The dead time is T_d in labels and formulas (L is the motor's inductance);
  // the key stays L, so files are unaffected. y0 empty (null): before T_d it
  // puts out its input at t = 0, as a pipe that was already flowing; nothing
  // plant-specific has to be typed in for that.
  delay: { label: 'Dead time', group: 'Dynamics', params: [num('L', 'Dead time T_d', 0.1, { unit: 's', min: 0 }), num('y0', 'Output before T_d', 0, { nullable: 'its input at t = 0' })], ports: () => [1, 1], formula: 'e^(−T_d·s)' },
  // Equations (the Function block, generalised; transparent-models.md §1.2):
  // named inputs, lines "name = formula" in the inputs, the names above, the
  // masks' parameters and t, and the outputs among those names. A file's
  // { expr } is { inputs: 'u', eqs: 'y = expr', outputs: 'y' }.
  fcn: {
    label: 'Equations', group: 'Math', formula: 'y = f(u, t)',
    params: [{ key: 'inputs', label: 'Inputs', default: 'u', kind: 'names' }, { key: 'eqs', label: 'Equations', default: 'y = u^2', kind: 'eqs' }, { key: 'outputs', label: 'Outputs', default: 'y', kind: 'names' }],
    ports: (p) => [nameList(p.inputs).length, nameList(p.outputs).length],
    outputs: (p) => nameList(p.outputs), inputNames: (p) => nameList(p.inputs),
    normalize: (params, where, scope) => normalizeEquations(params, where, scope),
  },
  saturation: { label: 'Saturation', group: 'Nonlinear', params: [num('min', 'Min', -1, { inf: true }), num('max', 'Max', 1, { inf: true })], ports: () => [1, 1], formula: 'clamp' },
  quantizer: { label: 'Quantizer', group: 'Sensors', params: [num('q', 'Step', 0.01, { min: 1e-12 })], ports: () => [1, 1], formula: 'q · round(u / q)' },
  noise: { label: 'Noise', group: 'Sensors', params: [num('std', 'σ', 0.01, { min: 0 }), num('seed', 'Seed', 1, { int: true, min: 0, maskable: true })], ports: () => [1, 1], formula: 'u + n,  n ~ N(0, σ²)' },
  // A digital controller: inputs r, y1, y2, …; output u, held between samples.
  // It holds one or more variants (implementations from controllers.js with
  // this same interface); "variant" is the index of the one that runs.
  controller: {
    label: 'Controller', group: 'Control', formula: 'u = C(r, y)',
    params: [num('inputs', 'Inputs (r, y…)', 2, { min: 1, int: true }), num('Ts', 'Sample time Ts', 0.01, { unit: 's', min: 1e-4 })],
    ports: (p) => [p.inputs + (p.ff ? 1 : 0), 1],
  },
  // An observer: inputs u, y1, y2, …; outputs the estimated states, held
  // between samples. Built like a controller, with variants from observers.js.
  observer: {
    label: 'Observer', group: 'Control', formula: 'x̂ = O(u, y)',
    params: [num('inputs', 'Inputs (u, y…)', 2, { min: 2, int: true }), num('outputs', 'Estimates', 2, { min: 1, int: true }), num('Ts', 'Sample time Ts', 0.001, { unit: 's', min: 1e-4 })],
    ports: (p) => [p.inputs, p.outputs],
    // A finite difference on a vector (vectors.js gives it groups): ŷ and ẏ per element.
    outputs: (p) => (p.groups ? ['ŷ', 'ẏ'].flatMap((c) => Array.from({ length: p.groups[1] }, (_, i) => `${c}${i + 1}`)) : Array.from({ length: p.outputs }, (_, i) => `x̂${i + 1}`)),
  },
  // A plant outside the page (Live mode, hil.js): its outputs come from the
  // plant every cycle, its inputs are sent back; offline the outputs hold 0.
  external: EXTERNAL_BLOCK,
  // Mechanics parts, joined at frame ports (mech.js; transparent-models.md §1.1).
  ...MECH_ELEMENTS,
  subsystem: { label: 'Subsystem', group: 'Structure', params: [], ports: null, formula: '' },
  // Mux, Demux, Constant, the math and robot blocks (vectors.js).
  ...VECTOR_ELEMENTS,
};

const VARIANT_LIBS = { controller: CONTROLLERS, observer: OBSERVERS };

// An Equations block's names ("Q, h") and lines ("r = r0 + …").
const nameList = (text) => String(text ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const eqLines = (text) => String(text ?? '').split(/\n|;/).map((x) => x.trim()).filter(Boolean).map((line) => {
  const at = line.indexOf('=');
  return at < 0 ? { name: '', src: line, line } : { name: line.slice(0, at).trim(), src: line.slice(at + 1).trim(), line };
});
function normalizeEquations(params = {}, where, scope) {
  const p = params.eqs === undefined && params.expr !== undefined ? { inputs: 'u', eqs: `y = ${params.expr}`, outputs: 'y' } : params;
  const inputs = nameList(p.inputs ?? 'u'), outputs = nameList(p.outputs ?? 'y'), lines = eqLines(p.eqs ?? 'y = u^2');
  const seen = new Set();
  const named = (n, what) => {
    if (!NAME_RE.test(n)) throw new Error(`${where}.${what}: "${n}" is not a name (letters, digits, _; Greek letters too)`);
    if (isReserved(n)) throw new Error(`${where}.${what}: "${n}" is the time, a constant or a function; choose another name`);
    if (seen.has(n)) throw new Error(`${where}.${what}: "${n}" is defined twice`);
    seen.add(n);
  };
  for (const n of inputs) named(n, 'inputs');
  if (!lines.length) throw new Error(`${where}.eqs: at least one line "name = formula"`);
  for (const [i, l] of lines.entries()) {
    if (!l.name) throw new Error(`${where}.eqs line ${i + 1}: "name = formula", not "${l.line}"`);
    named(l.name, `eqs line ${i + 1}`);
    let tree;
    try { tree = parseFormula(l.src); } catch (e) { throw new Error(`${where}.eqs line ${i + 1} (${l.name}): ${e.message}`); }
    const known = [...inputs, ...lines.slice(0, i).map((x) => x.name)];
    for (const n of formulaNames(tree)) {
      if (known.includes(n) || scopeValue(scope, n) !== undefined || ['t', 'pi', 'e', 'inf'].includes(n.toLowerCase())) continue;
      throw new Error(`${where}.eqs line ${i + 1}: '${n}' is not an input, a name defined above, or a parameter${scope ? ` (${scopeKeys(scope).join(', ')})` : ' (no mask around this block)'}`);
    }
  }
  if (!outputs.length) throw new Error(`${where}.outputs: at least one`);
  for (const n of outputs) if (!lines.some((l) => l.name === n)) throw new Error(`${where}.outputs: "${n}" is not computed by a line`);
  return { inputs: inputs.join(', '), eqs: lines.map((l) => `${l.name} = ${l.src}`).join('\n'), outputs: outputs.join(', ') };
}
// An Equations block compiled: slots for its inputs, t and its lines; run(v)
// computes every line in order; out[j] is output j's slot.
function compileEquations(params, consts) {
  const inputs = nameList(params.inputs), lines = eqLines(params.eqs), outputs = nameList(params.outputs);
  const slot = new Map(inputs.map((n, i) => [n, i]));
  slot.set('t', inputs.length);
  const fs = lines.map((l, k) => {
    const f = compileFormula(l.src, (n) => (slot.has(n) ? { slot: slot.get(n) } : consts?.has(n) ? { value: consts.get(n) } : null));
    slot.set(l.name, inputs.length + 1 + k);
    return f;
  });
  const first = inputs.length + 1;
  return { n: first + lines.length, nIn: inputs.length, fs, first, out: outputs.map((n) => slot.get(n)) };
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
export function blockPorts(block, scope = null) {
  if (block.type === 'subsystem') {
    const inner = maskScope(block, scope);
    const count = (t) => Math.max(0, ...block.diagram.blocks.filter((b) => b.type === t && portPresent(b, inner)).map((b) => b.params.port));
    return [count('inport'), count('outport')];
  }
  return diagramBlockDef(block.type).ports(block.params);
}

export function parseEnd(end) {
  const [id, port] = String(end).split(':');
  return { id, port: port === undefined ? 0 : Number(port) };
}

// ---- Masks and formula parameters (transparent-models.md §1.4) ---------
// A subsystem may carry a mask, [{ key, label, unit, min?, max?, default? }],
// and its values, params { key: number | formula }. Inside it any number
// field may be a formula in the names of the masks around it, innermost
// first; a mask value may be a formula in the masks outside it. A scope is
// { label, values: Map(key → number), outer }.
const scopeValue = (scope, name) => { for (let s = scope; s; s = s.outer) if (s.values.has(name)) return s.values.get(name); return undefined; };
const scopeKeys = (scope) => { const out = []; for (let s = scope; s; s = s.outer) for (const k of s.values.keys()) if (!out.includes(k)) out.push(k); return out; };
// The names a scope gives, innermost first, as a Map (an Equations block's constants).
const scopeMap = (scope) => new Map(scopeKeys(scope).map((k) => [k, scopeValue(scope, k)]));
function unknownName(name, scope) {
  return scope ? `'${name}' is not a parameter of '${scope.label}' (${scopeKeys(scope).join(', ')})` : `'${name}' is not a parameter here: outside a masked subsystem a formula uses numbers, pi, e and inf`;
}
// The value of the formula src in scope; where names the field in a refusal.
function formulaValue(src, scope, where) {
  let tree;
  try { tree = parseFormula(src); } catch (e) { throw new Error(`${where}: ${e.message}`); }
  for (const name of formulaNames(tree)) {
    if (scopeValue(scope, name) === undefined && !['pi', 'e', 'inf'].includes(name.toLowerCase())) throw new Error(`${where}: ${unknownName(name, scope)}`);
  }
  return compileFormula(tree, (n) => { const v = scopeValue(scope, n); return v === undefined ? null : { value: v }; })(new Float64Array(0));
}
// A number field's value: a number, or a formula in scope. Infinite only
// where the field allows it (inf: a limit, where ±inf means none).
function fieldNumber(raw, p, scope, where) {
  if (!isFormula(raw)) return Number(raw);
  if (p.int && !p.maskable) throw new Error(`${where}: a whole number, not a formula`);
  const v = formulaValue(raw, scope, where);
  if (p.int && Number.isFinite(v) && !Number.isInteger(v)) throw new Error(`${where}: ${String(raw).trim()} = ${v}; it must be a whole number`);
  if (Number.isNaN(v) || (!Number.isFinite(v) && !p.inf)) throw new Error(`${where}: ${String(raw).trim()} = ${Number.isNaN(v) ? 'not a number' : v > 0 ? 'inf' : '-inf'}; it must be finite`);
  return v;
}
// Mask fields are numbers, or of a kind: a toggle (an effect switched on
// or off; 0 or 1 in formulas) or a choice of words (its 1-based index in
// formulas, so a Switch's position can be the choice itself).
export const MASK_KINDS = ['toggle', 'choice'];
const toggleValue = (raw) => (raw === true || raw === 'on' ? 1 : raw === false || raw === 'off' ? 0 : Number(raw) === 0 || Number(raw) === 1 ? Number(raw) : NaN);
function toggleField(raw, outer, at) {
  const v = isFormula(raw) && raw !== 'on' && raw !== 'off' ? formulaValue(raw, outer, at) : toggleValue(raw);
  if (v !== 0 && v !== 1) throw new Error(`${at}: a toggle is 0 or 1 (off or on), not ${raw}`);
  return { v, kept: isFormula(raw) && raw !== 'on' && raw !== 'off' ? String(raw).trim() : v };
}
function choiceField(raw, options, outer, at) {
  if (options.includes(raw)) return { v: options.indexOf(raw) + 1, kept: raw };
  let v;
  try { v = isFormula(raw) ? formulaValue(raw, outer, at) : Number(raw); } catch { v = NaN; }
  if (!Number.isInteger(v) || v < 1 || v > options.length) throw new Error(`${at}: one of ${options.join(', ')}, not ${raw}`);
  return { v, kept: isFormula(raw) ? String(raw).trim() : options[v - 1] };
}
// The scope a subsystem's mask opens (null when it has none or it cannot be
// had without the masks outside), and whether an In or Out block is there:
// a port may carry `when`, a formula in the mask (servo.md: In 3 only on a
// coupled shaft); 0 removes the port.
function maskScope(b, outer = null) {
  if (!b.mask?.length) return outer;
  try { return normalizeMask(b, b.id, outer, true).scope; } catch { return null; }
}
function portPresent(b, scope) {
  if (!b.when) return true;
  if (!scope) return true;
  try { return formulaValue(b.when, scope, `${b.id}.when`) !== 0; } catch { return true; }
}

// The mask of subsystem b and the scope it opens: { mask, params, scope }.
// resolve: params hold the values (numbers), not the formulas.
function normalizeMask(b, where, outer, resolve) {
  const given = b.params && typeof b.params === 'object' ? Object.keys(b.params) : [];
  if (b.mask === undefined || b.mask === null) {
    if (given.length) throw new Error(`${where}: parameters (${given.join(', ')}) need a mask that lists them`);
    return { scope: outer };
  }
  if (!Array.isArray(b.mask)) throw new Error(`${where}.mask: a list of { key, label, unit }`);
  const keys = new Set();
  const mask = b.mask.map((f, i) => {
    const at = `${where}.mask[${i}]`, key = String(f?.key ?? '');
    if (!NAME_RE.test(key)) throw new Error(`${at}: a key such as m, l1 or θ0 (letters, digits, _)`);
    if (isReserved(key)) throw new Error(`${at}: "${key}" is the time, a constant or a function; choose another key`);
    if (keys.has(key)) throw new Error(`${at}: the key "${key}" twice`);
    keys.add(key);
    const unit = String(f.unit ?? '1').trim() || '1';
    if (unit.length > 12 || /[<>"{}]/.test(unit)) throw new Error(`${at}.unit: a short unit such as m, N, rad/s, or 1`);
    const out = { key, label: String(f.label ?? key), unit };
    if (f.kind !== undefined && !MASK_KINDS.includes(f.kind)) throw new Error(`${at}.kind: one of ${MASK_KINDS.join(', ')} (or none: a number)`);
    if (f.kind) out.kind = f.kind;
    if (f.kind === 'choice') {
      if (!Array.isArray(f.options) || f.options.length < 2 || !f.options.every((o) => typeof o === 'string' && /^[A-Za-z][A-Za-z0-9 _-]{0,23}$/.test(o)) || new Set(f.options).size < f.options.length) throw new Error(`${at}.options: two or more different words, such as ["voltage", "current"]`);
      out.options = [...f.options];
    }
    for (const k of ['min', 'max', 'default']) {
      if (f[k] === undefined || f[k] === null || f[k] === '') continue;
      if (k === 'default' && f.kind === 'choice') {
        if (!out.options.includes(f.default)) throw new Error(`${at}.default: one of ${out.options.join(', ')}`);
        out.default = f.default;
        continue;
      }
      if (k === 'default' && /^-?inf$/i.test(String(f[k]).trim())) { out.default = String(f[k]).trim(); continue; }
      const v = k === 'default' && f.kind === 'toggle' ? toggleValue(f[k]) : Number(f[k]);
      if (Number.isNaN(v)) throw new Error(`${at}.${k}: ${f.kind === 'toggle' && k === 'default' ? '0 or 1 (off or on)' : 'a number'}`);
      out[k] = v;
    }
    if (out.min !== undefined && out.max !== undefined && out.min > out.max) throw new Error(`${at}: min ${out.min} is above max ${out.max}`);
    // Folded under a toggle ("coulomb") or one option of a choice ("shaft:coupled"): the panel greys it while that is off.
    if (f.under !== undefined) out.under = String(f.under);
    if (f.physical) out.physical = true;
    return out;
  });
  for (const f of mask) {
    if (f.under === undefined) continue;
    const [k, opt] = f.under.split(':'), of = mask.find((g) => g.key === k);
    if (!of || (of.kind !== 'toggle' && of.kind !== 'choice') || (opt === undefined) !== (of.kind === 'toggle') || (opt !== undefined && !of.options.includes(opt))) throw new Error(`${where}.mask(${f.key}).under: a toggle's key, or a choice's key:option, of this mask`);
  }
  for (const k of given) if (!keys.has(k)) throw new Error(`${where}.params: "${k}" is not on the mask (${[...keys].join(', ')})`);
  const label = b.name ?? b.id, values = new Map(), params = {};
  for (const f of mask) {
    const at = `${where}.params.${f.key}`;
    if (f.kind) {
      const { v, kept } = f.kind === 'toggle' ? toggleField(b.params?.[f.key] ?? f.default ?? 0, outer, at) : choiceField(b.params?.[f.key] ?? f.default ?? f.options[0], f.options, outer, at);
      values.set(f.key, v);
      params[f.key] = resolve ? v : kept;
      continue;
    }
    const raw = b.params?.[f.key] ?? f.default;
    if (raw === undefined || raw === null || raw === '') throw new Error(`${at}: needs a value`);
    const v = isFormula(raw) ? formulaValue(raw, outer, at) : Number(raw);
    if (Number.isNaN(v)) throw new Error(`${at}: expected a number or a formula`);
    if (f.min !== undefined && v < f.min) throw new Error(`${at}: ${v} is below its min ${f.min}`);
    if (f.max !== undefined && v > f.max) throw new Error(`${at}: ${v} is above its max ${f.max}`);
    values.set(f.key, v);
    params[f.key] = resolve || !isFormula(raw) ? v : String(raw).trim();
  }
  return { mask, params, scope: { label, values, outer } };
}

// Is there anything to resolve: a mask, or a formula in a number field?
function hasFormulas(d) {
  return d.blocks.some((b) => {
    if (isOldPhysics(b.type)) return true;   // an old physics block, to be opened (normalizeDiagram)
    if (b.type === 'subsystem') return b.mask?.length > 0 || hasFormulas(b.diagram);
    const def = ELEMENTS[b.type] ?? (BLOCKS.plant[b.type] ? { params: BLOCKS.plant[b.type].params } : null);
    return !!def?.params?.some((p) => (!p.kind && isFormula(b.params?.[p.key])) || (p.kind === 'vector' && Array.isArray(b.params?.[p.key]) && b.params[p.key].some(isFormula)));
  });
}

// The values of a level's mask names (innermost first), for the panel: the
// subsystems along idPath from the root diagram.
export function maskValues(diagram, idPath = []) {
  let scope = null, d = diagram;
  for (const id of idPath) {
    const b = d.blocks.find((x) => x.id === id);
    if (!b?.diagram) break;
    scope = normalizeMask(b, id, scope, true).scope;
    d = b.diagram;
  }
  return scopeMap(scope);
}
// The equations sheets of a diagram's mechanisms (sheet.js), from a compile
// of it (el): [{ idPath (its level), name, parts (ids), sheet }]. Each sheet
// reads the parts' parameters as written and their values in the masks
// around them; a joint's input is named by what is wired into it.
export function equationSheets(diagram, el) {
  return el.mechanisms.map((m) => {
    const ids = m.idPath ? m.idPath.split('/') : [];
    const lv = ids.reduce((d, id) => d.blocks.find((b) => b.id === id).diagram, diagram);
    const byId = new Map(lv.blocks.map((b) => [b.id, b]));
    const values = maskValues(diagram, ids);
    const inputName = (id) => {
      const w = lv.wires.find((x) => parseEnd(x.to).id === id);
      const src = w && byId.get(parseEnd(w.from).id);
      return !src ? null : src.type === 'source' ? src.params.signal : src.type === 'inport' ? (src.name ?? null) : (src.name ?? src.id);
    };
    const sheet = equationSheet(m.mechanism, (id) => byId.get(id).params, (text) => formulaIn(text, values), inputName);
    return { idPath: m.idPath, name: m.name, parts: m.mechanism.parts.map((b) => b.id), sheet, check: () => sheet.check(m.ode.constants) };
  });
}

// The value of a number field's formula in those values (NaN if it cannot be had).
export function formulaIn(src, values) {
  try { return compileFormula(src, (n) => (values.has(n) ? { value: values.get(n) } : null))(new Float64Array(0)); } catch { return NaN; }
}

function normalizeParams(type, params = {}, where, scope = null, resolve = false) {
  if (diagramBlockDef(type).model) {
    // Formulas are put in as their values for the block's own checks, and
    // kept as written (or as values when resolving).
    const def = diagramBlockDef(type), numeric = { ...params }, kept = {};
    for (const p of def.params) {
      const v = params[p.key], at = `${where}.${p.key}`;
      if (p.kind === 'vector' && Array.isArray(v) && v.some(isFormula)) { numeric[p.key] = v.map((x, j) => fieldNumber(x, p, scope, `${at}[${j}]`)); kept[p.key] = v.map((x) => (isFormula(x) ? String(x).trim() : Number(x))); }
      else if (p.kind !== 'vector' && isFormula(v)) { numeric[p.key] = fieldNumber(v, p, scope, at); kept[p.key] = String(v).trim(); }
    }
    const out = normalizeBlock('plant', { type, params: numeric }).params;
    return resolve ? out : { ...out, ...kept };
  }
  if (ELEMENTS[type].normalize) {
    // Blocks that check their own (external, Equations, the vector blocks):
    // a number field's formula is put in as its value, and kept as written
    // unless resolving.
    if (!VECTOR_ELEMENTS[type]) return ELEMENTS[type].normalize(params, where, scope);
    const numeric = { ...params }, kept = {};
    for (const p of ELEMENTS[type].params) if (!p.kind && isFormula(params[p.key])) { numeric[p.key] = fieldNumber(params[p.key], p, scope, `${where}.${p.key}`); kept[p.key] = String(params[p.key]).trim(); }
    const out = ELEMENTS[type].normalize(numeric, where, scope);
    return resolve ? out : { ...out, ...kept };
  }
  const out = {}, values = {};
  for (const p of ELEMENTS[type].params) {
    let v = params[p.key] ?? p.default;
    if (p.kind === 'unit') {
      v = String(v).trim() || '1';
      if (v.length > 12 || /[<>"{}]/.test(v)) throw new Error(`${where}.${p.key}: a short unit such as m, N, rad/s, or 1`);
    } else if (p.kind === 'name') {
      v = String(v);
      if (!/^[A-Za-z][A-Za-z0-9_]{0,11}$/.test(v)) throw new Error(`${where}.${p.key}: a name such as r, d or y1 (letters, digits, _)`);
    } else if (p.kind === 'coord') {
      v = checkCoord(v, `${where}.${p.key}`);
    } else if (p.kind === 'choice') {
      v = String(v);
      if (!p.options.includes(v)) throw new Error(`${where}.${p.key}: one of ${p.options.join(', ')}`);
    } else if (p.kind === 'signs') {
      v = String(v);
      if (!/^[+-]{1,8}$/.test(v)) throw new Error(`${where}.signs: one to eight of + and -`);
    } else if (p.nullable && (params[p.key] === null || params[p.key] === '' || (params[p.key] === undefined && p.default === null))) {
      v = null;   // empty: the meaning p.nullable names
    } else {
      const raw = v;
      v = fieldNumber(raw, p, scope, `${where}.${p.key}`);
      if (Number.isNaN(v) || (!Number.isFinite(v) && !isFormula(raw))) throw new Error(`${where}.${p.key}: expected a number`);
      if (p.int) v = Math.round(v);
      if (p.min !== undefined && v < p.min) throw new Error(`${where}.${p.key}: at least ${p.min}`);
      if (p.max !== undefined && v > p.max) throw new Error(`${where}.${p.key}: at most ${p.max}`);
      values[p.key] = v;
      if (isFormula(raw) && !resolve) v = String(raw).trim();
    }
    out[p.key] = v;
  }
  if (type === 'integrator' && values.min !== undefined && values.max !== undefined && values.min > values.max) throw new Error(`${where}: min ${values.min} is above max ${values.max}`);
  if (type === 'switch' && typeof out.position === 'number') out.position = Math.min(out.position, out.inputs);
  if (type === 'switch' && values.position > out.inputs) throw new Error(`${where}.position: ${params.position} = ${values.position}; the Switch has ${out.inputs} inputs`);
  return out;
}

// A use of a built-in component (components.js): its mask and diagram put in.
function useOf(b, at) {
  const c = typeof b.component === 'string' ? COMPONENTS[b.component] : null;
  if (!c) throw new Error(`${at}: no component "${b.component}"; built in: ${Object.keys(COMPONENTS).join(', ')}`);
  if (b.type !== undefined && b.type !== 'subsystem') throw new Error(`${at}: a component's use is a subsystem`);
  if (b.prefix !== undefined && !/^[A-Za-z][A-Za-z0-9_]{0,5}$/.test(b.prefix)) throw new Error(`${at}.prefix: up to six letters, digits and _, before its Sinks' names (m2_ makes m2_i)`);
  return { ...b, type: 'subsystem', mask: c.mask, diagram: withPrefix(c.diagram, b.prefix) };
}
function useJson(b) {
  const params = {};
  for (const f of b.mask) {
    const v = b.params[f.key], d = f.default ?? (f.kind === 'choice' ? f.options[0] : f.kind === 'toggle' ? 0 : undefined);
    if (v !== d && !(typeof v === 'number' && typeof d === 'string' && Number(d) === v) && !(v === Infinity && /^inf$/i.test(String(d)))) params[f.key] = v;
  }
  return { id: b.id, type: 'subsystem', ...(b.name ? { name: b.name } : {}), component: b.component, ...(b.prefix ? { prefix: b.prefix } : {}), params, x: b.x, y: b.y, ...(b.flip ? { flip: true } : {}) };
}

// opts.scope: the masks around this level; opts.resolve: formulas become
// their values (compileDiagram's copy; Equations blocks get the mask names
// as b.consts).
export function normalizeDiagram(d, path = 'plant', opts = {}) {
  const { scope = null, resolve = false } = opts;
  if (!d || !Array.isArray(d.blocks)) throw new Error(`${path}: a diagram needs "blocks" and "wires"`);
  const ids = new Set();
  const blocks = d.blocks.map((given, i) => {
    const where = `${path}.blocks[${i}]`;
    // An old physics block loads as its subsystem (physics.js).
    let b = isOldPhysics(given.type) ? expandPhysics(given) : given;
    if (!b.id || typeof b.id !== 'string' || /[:/]/.test(b.id)) throw new Error(`${where}: needs an "id" without ":" or "/"`);
    if (ids.has(b.id)) throw new Error(`${where}: duplicate id "${b.id}"`);
    ids.add(b.id);
    const at = `${where}(${b.id})`;
    const ref = b.component;
    if (ref !== undefined) b = useOf(b, at);
    const m = b.type === 'subsystem' ? normalizeMask(b, at, scope, resolve) : null;
    // Fields kept only when given (a vector Sink's names, an Integrator's x0 list, lanes: vectors.js).
    const { base, extra } = m ? { base: b.params, extra: {} } : vectorExtras(b.type, b.params, at);
    const out = { id: b.id, type: b.type, params: m ? m.params ?? {} : { ...normalizeParams(b.type, base, at, scope, resolve), ...extra }, x: Number(b.x) || 0, y: Number(b.y) || 0 };
    if (b.name) out.name = String(b.name);
    if (b.flip) out.flip = true;
    if ((b.type === 'inport' || b.type === 'outport') && b.when !== undefined && b.when !== null && b.when !== '') {
      if (!isFormula(b.when) && !Number.isFinite(Number(b.when))) throw new Error(`${at}.when: a formula in the mask's names (0: the port is not there)`);
      formulaValue(String(b.when), scope, `${at}.when`);
      out.when = String(b.when).trim();
    }
    // A Switch set by the mask is a wire once resolved: what reaches only
    // its other inputs is not compiled (compileDiagram).
    if (resolve && b.type === 'switch' && isFormula(b.params?.position)) Object.defineProperty(out, 'fixed', { value: true });
    if (m?.mask) out.mask = m.mask;
    if (b.type === 'subsystem') out.diagram = normalizeDiagram(b.diagram ?? { blocks: [], wires: [] }, `${path}/${b.id}`, { scope: m.scope, resolve });
    if (ref !== undefined) {
      out.component = ref;
      if (b.prefix) out.prefix = b.prefix;
      // Saved by reference: the component and the mask values that differ
      // from its defaults (servo.md §9); the insides come from the table.
      Object.defineProperty(out, 'toJSON', { value: () => useJson(out) });
    }
    if (resolve && b.type === 'fcn' && scope) Object.defineProperty(out, 'consts', { value: scopeMap(scope) });
    if ((b.type === 'controller' || b.type === 'observer') && resolve && Array.isArray(b.variants) && b.variants.length) {
      // Resolving (compileDiagram's copy of a normalised diagram): the
      // variants stay as given, a law Auto-tune hands in included.
      out.variants = b.variants;
      out.variant = b.variant ?? 0;
    } else if (b.type === 'controller' || b.type === 'observer') {
      const lib = VARIANT_LIBS[b.type];
      const vs = Array.isArray(b.variants) && b.variants.length ? b.variants : [{ type: b.type === 'observer' ? 'difference' : 'pid' }];
      // A variant made in code (Auto-tune's step test: a law of its own) is kept as it is.
      out.variants = vs.map((v, j) => (typeof v.law === 'function' ? v : normalizeVariant(v, `${where}(${b.id}).variants[${j}]`, lib, { inputs: out.params.inputs })));
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
      const n = blockPorts(b, scope)[side];
      if (!(e.port >= 0 && e.port < n)) throw new Error(`${path}.wires[${i}]: ${b.id} has no ${side ? 'output' : 'input'} ${e.port}`);
    }
    return { from: f.port ? `${f.id}:${f.port}` : f.id, to: t.port ? `${t.id}:${t.port}` : t.id };
  });
  const taken = new Set();
  for (const w of wires) {
    if (taken.has(w.to)) throw new Error(`${path}: input ${w.to} has two wires`);
    taken.add(w.to);
  }
  const robots = path === 'plant' ? normalizeRobots(d.robots) : undefined;
  // Mechanics parts meet at joins (one point each; mech.js).
  const joins = normalizeJoins(d.joins, blocks, path);
  return { ...(robots ? { robots } : {}), blocks, wires, ...(joins ? { joins } : {}) };
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
      if (b.type === 'source' && !b.params.derivative) { sources.add(b.params.signal); units[b.params.signal] ??= b.params.unit ?? '1'; }
      if (b.type === 'sink') { sinks.push(b.params.name); units[b.params.name] = b.params.unit ?? '1'; }
      if (b.type === 'subsystem') walk(b.diagram);
    }
  };
  walk(flattenVectors(diagram, { ports: blockPorts }));
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
    // A subsystem's output is named by its Out block ("speed" from Motor).
    if (src.type === 'subsystem') {
      const out = src.diagram.blocks.find((b) => b.type === 'outport' && b.params.port === f.port + 1);
      // A masked model (the tank, a cart) is named as a model block was: h, θ1.
      return out?.name ? (src.mask ? out.name : `${out.name} (${src.name ?? src.id})`) : (src.name ?? src.id);
    }
    const outNames = outputNames(diagramBlockDef(src.type), src.params);
    // An Equations block with one output is named by its label, as before;
    // with several, each by its output ("dh (level rate)").
    if (src.type === 'fcn') return outNames.length > 1 ? `${outNames[f.port]} (${src.name ?? src.id})` : (src.name ?? src.id);
    return outNames[f.port] || (src.name ?? src.id);
  });
}

// An error a design can report: a code, a sentence, and a hint.
function modelError(code, message, hint = '') {
  return Object.assign(new Error(message), { code, hint });
}
const fmt = (v) => String(Number(Number(v).toPrecision(3)));
const NONE = [];

// Compile-time switches (servo.md §8 item 6): a Switch set by a mask
// becomes a wire to its chosen input, and what reaches only its other
// inputs, or only those and Sinks, is not compiled: no state, no step bound,
// no evaluation (a toggle that is off is the motor without the effect, bit
// for bit). Sinks fed from there are off too. Marks the nodes dead and
// returns their indices.
function prune(nodes) {
  const deadEdge = [];
  for (const nd of nodes) {
    if (nd.kind !== 'switch' || !nd.fixed) continue;
    nd.inputs.forEach((s, slot) => { if (slot !== nd.pick && s >= 0) deadEdge.push(s); });
    Object.assign(nd, { kind: 'pass', inputs: [nd.inputs[nd.pick] ?? -1] });
  }
  const off = new Set();
  if (!deadEdge.length) return off;
  const uses = nodes.map(() => []);
  const feeds = (nd) => (nd.kind === 'tap' ? [nd.parent] : nd.inputs);
  nodes.forEach((nd, i) => { for (const s of feeds(nd)) if (s >= 0) uses[s].push(i); });
  const deadUses = new Set(deadEdge);
  // Candidates: whatever reaches an unchosen input; then, until nothing
  // changes, drop each one that still feeds something compiled (a Sink
  // keeps nothing compiled: it reads off with what feeds it).
  const cand = new Set(), stack = [...deadUses];
  while (stack.length) { const i = stack.pop(); if (cand.has(i)) continue; cand.add(i); for (const s of feeds(nodes[i])) if (s >= 0) stack.push(s); }
  for (let changed = true; changed;) {
    changed = false;
    for (const i of cand) {
      const keeps = uses[i].some((d) => !cand.has(d) && !nodes[d].end);
      if (keeps || !(deadUses.has(i) || uses[i].some((d) => cand.has(d)))) { cand.delete(i); changed = true; }
    }
  }
  for (const i of cand) off.add(i);
  nodes.forEach((nd, i) => { if (nd.end && nd.inputs[0] >= 0 && off.has(nd.inputs[0])) off.add(i); });
  for (const i of off) nodes[i].dead = true;
  return off;
}

// Flattens and compiles a diagram into a simulation element:
//   { n, bound, eval(t, X, o, u, dX) -> y, record(), probes(), warnings, states }
// opts.sources maps Source signal names to t => value. opts.standalone: the
// diagram is the whole system (no Out needed; an In reads 0).
// opts.laws === false: Controllers and Observers make no laws and put out 0
// (the Plant tab's structure check: editing the canvas never designs).
// opts.designs: the design store a designed variant gets its values from
// (design.js; SYNC_DESIGNS when none is given). el.designs lists the status
// of each running designed variant.
// opts.mode === 'model': the plant as a block sees it, for designs
// (design/output/designs.md). The diagram is the whole system and no laws
// are made; dead times pass straight through, a quantizer is the identity,
// noise adds 0, and Sources read the operating point's values.
// el.seen(idPath, at) then gives the Model a Controller or Observer sees.
export function compileDiagram(diagram, path = 'plant', opts = {}) {
  // Masks and formulas are resolved to numbers first, outermost first; then
  // vector wires become scalar ones (vectors.js; a diagram without vectors is
  // itself). The model compile reads the diagram as given (it resolves it the same way).
  const given = diagram;
  if (!diagram.scalar && hasFormulas(diagram)) diagram = normalizeDiagram(diagram, path, { resolve: true });
  diagram = flattenVectors(diagram, { ports: blockPorts });
  const model = opts.mode === 'model';
  const standalone = opts.standalone || model;
  const laws = opts.laws !== false && !model;
  const nodes = [];
  const warnings = [];
  const probeList = [];
  const add = (node) => { nodes.push({ inputs: [], ...node, i: nodes.length }); return nodes.length - 1; };
  const externals = [];
  let extNode = -1, outNode = -1;
  const ctrlNodes = [];  // [block id path, node] of every Controller block
  // What vector blocks report while a run goes (a joint leaving its range): info.validity.
  const validity = [];
  const mctx = mimoContext(diagram.robots, { model, report: (text) => { if (!validity.includes(text) && validity.length < 50) validity.push(text); } });
  const mechList = [];   // every mechanism compiled (el.mechanisms)

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
        const scope = maskScope(b);
        const ports = (t) => b.diagram.blocks.filter((x) => x.type === t && portPresent(x, scope)).sort((a, c) => a.params.port - c.params.port);
        outs[b.id] = ports('outport').map((x) => inner.outs[x.id][0]);
        ins[b.id] = ports('inport').map((x) => inner.ins[x.id][0]);
        continue;
      }
      if (b.type === 'source') {
        // A derivative output (vectors.js) reads the signal's ṙ or r̈ (signals.js) and is no probe.
        const d = b.params.derivative ?? 0, base = opts.sources?.[b.params.signal];
        let fn = base;
        if (d && base?.derivative) { try { fn = base.derivative(d); } catch (e) { throw new Error(`${path}: ${name}: ${e.message}`); } warnings.push(...(fn.warnings ?? []).map((w) => `${path}: ${b.params.signal}: ${w}`)); }
        else if (d) fn = null;
        if (!fn && !model && !d) warnings.push(`${path}: no signal "${b.params.signal}" for ${name}`);
        const k = add({ kind: 'src', name, signal: d ? null : b.params.signal, at: 0, ft: false, fn: fn ?? (() => 0) });
        if (!d) probeList.push([b.params.signal, k]);
        outs[b.id] = [k]; ins[b.id] = [];
        continue;
      }
      if (b.type === 'sink') {
        if (probeList.some(([n2]) => n2 === b.params.name)) throw new Error(`${path}: two signals named "${b.params.name}"`);
        const k = add({ kind: 'pass', name, ft: true, inputs: [-1], end: true, sink: b.params.name });
        probeList.push([b.params.name, k]);
        outs[b.id] = []; ins[b.id] = [[k, 0]];
        continue;
      }
      if (b.type === 'terminator') {
        const k = add({ kind: 'pass', name, ft: true, inputs: [-1], end: true });
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
      // Mechanics parts: their mechanism's node (below) gives a joint's ports.
      if (def.part) { outs[b.id] = []; ins[b.id] = []; continue; }
      if (b.type === 'controller' || b.type === 'observer') {
        const lib = VARIANT_LIBS[b.type];
        const v = b.variants?.[b.variant ?? 0] ?? normalizeVariant({ type: b.type === 'observer' ? 'difference' : 'pid' }, b.id, lib);
        const k = add({ kind: 'ctrl', name, idPath, ft: false, observer: b.type === 'observer', variant: v, lib, lane: b.params.lane ?? 0, lanes: b.params.lanes ?? 1, ff: !!b.params.ff, inputs: new Array(nIn).fill(-1), Ts: b.params.Ts, law: null, next: 0, k: 0, u: 0, outv: new Float64Array(nOut), x: new Float64Array(nIn) });
        nodes[k].taps = b.type === 'observer' ? Array.from({ length: nOut }, (_, j) => add({ kind: 'tap', name: `${name}.x̂${j + 1}`, ft: false, parent: k, j, see: -1 })) : [];
        outs[b.id] = b.type === 'observer' ? nodes[k].taps : [k];
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
        const k = add({ kind: 'ode', name, short: b.name ?? b.id, ft: false, ode: def.ode, rates: def.ode.make(b.params), p: b.params, inputs: new Array(nIn).fill(-1), uv: nIn > 1 ? new Float64Array(nIn) : null, outv: new Float64Array(nOut), bound: def.ode.bound(b.params) });
        outs[b.id] = outputNames(def, b.params).map((o, j) => add({ kind: 'tap', name: `${name}.${o}`, ft: false, parent: k, j, see: -1 }));
        ins[b.id] = nodes[k].inputs.map((_, s) => [k, s]);
        continue;
      }
      if (b.type === 'mimo') {
        // A vector block (vectors.js): its inputs straight through to its
        // outputs, one tap node per output.
        const k = add({ kind: 'mimo', name, ft: true, fn: makeMimo(b.params, mctx), inputs: new Array(nIn).fill(-1), uv: new Float64Array(nIn), outv: new Float64Array(nOut) });
        outs[b.id] = Array.from({ length: nOut }, (_, j) => add({ kind: 'tap', name: `${name}.${j + 1}`, ft: true, inputs: [k], parent: k, j, see: -1 }));
        ins[b.id] = nodes[k].inputs.map((_, s) => [k, s]);
        continue;
      }
      const node = { name, short: b.name ?? b.id, inputs: new Array(nIn).fill(-1) };
      if (b.type === 'integrator') Object.assign(node, { unit: b.params.unit, angle: !!b.params.angle });
      // (A diagram given without normalising may leave the new fields out.)
      const lo = b.params.min ?? -Infinity, hi = b.params.max ?? Infinity, x0 = b.params.x0 ?? 0;
      if (b.type === 'integrator' && (x0 !== 0 || lo > -Infinity || hi < Infinity)) {
        // With a start value or limits: its own state node (with the fields
        // at their defaults it stays the transfer function K/s, bit for bit).
        Object.assign(node, { kind: 'int', K: b.params.K, lo, hi, x0: Math.min(hi, Math.max(lo, x0)), ft: false, bound: 0 });
      } else if (def.tf) {
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
      else if (b.type === 'switch') Object.assign(node, { kind: 'switch', pick: b.params.position - 1, ft: true, fixed: !!b.fixed });
      else if (b.type === 'fcn') {
        const eq = compileEquations(b.params, b.consts);
        Object.assign(node, { kind: 'fcn', eq, v: new Float64Array(eq.n), outv: new Float64Array(eq.out.length), ft: true });
      }
      else if (b.type === 'quantizer') Object.assign(node, { kind: 'quant', q: b.params.q, ft: true });
      else if (b.type === 'noise') Object.assign(node, { kind: 'noise', std: b.params.std, seed: b.params.seed, ft: true });
      const k = add(node);
      // Outputs after the first (an Equations block's) read the block's
      // values after it is evaluated.
      outs[b.id] = [k, ...Array.from({ length: nOut - 1 }, (_, j) => add({ kind: 'pick', name: `${name}.${outputNames(def, b.params)[j + 1]}`, ft: true, inputs: [k], parent: k, j: j + 1 }))];
      ins[b.id] = node.inputs.map((_, s) => [k, s]);
    }
    // One state node per mechanism; a joint's outputs are taps of it (its
    // coordinate and rate), its force or torque one of its inputs.
    let mechs;
    try { mechs = mechanisms(d.blocks, d.joins); } catch (e) { throw Object.assign(new Error(`${path}${prefix ? ` (${prefix.slice(0, -1)})` : ''}: ${e.message}`), { code: e.code, blocks: (e.blocks ?? []).map((id) => `${ids}${id}`) }); }
    for (const mech of mechs) {
      let ode;
      try { ode = mechanismOde(mech); } catch (e) { throw Object.assign(new Error(`${path}${prefix ? ` (${prefix.slice(0, -1)})` : ''}: ${e.message}`), { code: e.code, blocks: (e.blocks ?? []).map((id) => `${ids}${id}`) }); }
      const name = prefix ? prefix.slice(0, -1) : (mech.world.name ?? mech.world.id);
      const k = add({ kind: 'ode', name, prefix, short: name, mech, ft: false, ode, rates: ode.make(), p: null, inputs: new Array(ode.nIn).fill(-1), uv: ode.nIn > 1 ? new Float64Array(ode.nIn) : null, outv: new Float64Array(2 * mech.joints.length), bound: ode.bound() });
      mechList.push({ name, idPath: ids.slice(0, -1), node: k, mechanism: mech, ode });
      mech.joints.forEach((jn, j) => {
        outs[jn.id] = [0, 1].map((r) => add({ kind: 'tap', name: `${prefix}${jn.params[r ? 'rate' : 'name']}`, ft: false, parent: k, j: 2 * j + r, see: -1 }));
        const slot = ode.inputs.indexOf(jn);
        ins[jn.id] = slot >= 0 ? [[k, slot]] : [];
      });
    }
    for (const w of d.wires) {
      const f = parseEnd(w.from), t = parseEnd(w.to);
      const src = outs[f.id][f.port], [dst, slot] = ins[t.id][t.port];
      nodes[dst].inputs[slot] = src;
    }
    return { outs, ins };
  }
  level(diagram, '', '', true);
  const off = prune(nodes);
  if (off.size) {
    for (let q = probeList.length - 1; q >= 0; q--) if (off.has(probeList[q][1])) probeList.splice(q, 1);
    for (let q = ctrlNodes.length - 1; q >= 0; q--) if (off.has(ctrlNodes[q][1])) ctrlNodes.splice(q, 1);
  }
  // The Sink that records node i, the outermost where several do (V beside
  // a Servo motor's own v), as [name, node].
  const outermostSink = (i) => probeList.filter(([nm, k]) => !nm.includes('.') && nodes[k].kind === 'pass' && nodes[k].inputs[0] === i).sort((a, b) => nodes[a[1]].name.split('/').length - nodes[b[1]].name.split('/').length)[0] ?? null;
  const offSinks = [...off].filter((i) => nodes[i].sink).map((i) => nodes[i].sink);
  // Auto-tune reads each Controller block's r (input 1), y (input 2) and u
  // under its id path: "ctrl.r", "motor/ctrl.u". A signal name never has a
  // dot, so no scope channel lists these (and no Sink lookup reads them).
  for (const [key, k] of ctrlNodes) {
    const [r = -1, y = -1] = nodes[k].inputs;
    if (r >= 0) probeList.push([`${key}.r`, r]);
    if (y >= 0) probeList.push([`${key}.y`, y]);
    probeList.push([`${key}.u`, k]);
  }
  if (!standalone) {
    if (outNode < 0) throw new Error(`${path}: add an Out block for the plant output y`);
    if (extNode < 0) warnings.push(`${path}: no In block, so the plant ignores u`);
  }
  for (const nd of nodes) if (!nd.dead) nd.inputs.forEach((s, i) => { if (s < 0) warnings.push(`${path}: ${nd.name} input ${i + 1} is not connected (reads 0)`); });

  // Evaluation order: blocks whose output does not depend on their input
  // first, then pass-through blocks after their inputs.
  const order = nodes.map((nd, i) => i).filter((i) => !nodes[i].ft && !nodes[i].dead);
  const pending = new Set(nodes.map((nd, i) => i).filter((i) => nodes[i].ft && !nodes[i].dead));
  let progress = true;
  while (pending.size && progress) {
    progress = false;
    for (const i of pending) {
      if (nodes[i].inputs.every((s) => s < 0 || !pending.has(s))) { order.push(i); pending.delete(i); progress = true; }
    }
  }
  if (pending.size) throw new Error(`${path}: algebraic loop through ${[...pending].map((i) => nodes[i].name).join(', ')}; put a block with state (integrator, lag) in the loop${model ? ' (in a model, dead times pass straight through)' : ''}`);
  // Pass nodes (In, Out, Sink, Terminator) only forward a value: where a
  // signal comes from is their origin. Every input reads its origin instead,
  // and pass nodes are not evaluated (a subsystem's ports cost nothing per
  // step); Sinks are read through (probes below).
  const origin = (i) => { while (i >= 0 && nodes[i].kind === 'pass') i = nodes[i].inputs[0]; return i; };
  const through = nodes.map((nd, i) => origin(i));
  for (const nd of nodes) for (let s = 0; s < nd.inputs.length; s++) if (nd.inputs[s] >= 0) nd.inputs[s] = through[nd.inputs[s]];
  for (let q = order.length - 1; q >= 0; q--) if (nodes[order[q]].kind === 'pass') order.splice(q, 1);

  // State offsets, in node order: diagram order, depth first through
  // subsystems, then each block's own order. The same in both modes, so a
  // state from a run fits a model.
  let n = 0, bound = 0;
  const stateNodes = [];
  for (const nd of nodes) {
    if ((nd.kind !== 'ss' && nd.kind !== 'ode' && nd.kind !== 'int') || nd.dead) continue;
    nd.nx = nd.kind === 'int' ? 1 : nd.kind === 'ss' ? nd.ss.n : typeof nd.ode.n === 'function' ? nd.ode.n(nd.p) : nd.ode.n;
    nd.off = n; n += nd.nx; bound = Math.max(bound, nd.bound);
    if (nd.nx > 0) stateNodes.push(nd);
  }
  // Every state with its label: subsystem/block.state, or the block's name
  // for a first-order block (its state is its output).
  const states = [];
  for (const nd of stateNodes) {
    // A mechanism's states are labelled by its level: 'cart and 3 rods/θ1'.
    if (nd.kind === 'ode') nd.ode.states(nd.p).forEach((s, j) => states.push({ label: nd.mech ? `${nd.prefix}${s.name}` : `${nd.name}.${s.name}`, name: s.name, unit: s.unit, angle: s.angle, index: nd.off + j, ...(nd.mech && nd.prefix ? { group: nd.prefix.slice(0, -1) } : {}) }));
    else for (let j = 0; j < nd.nx; j++) states.push(nd.nx === 1 ? { label: nd.name, name: nd.short, unit: nd.unit && nd.unit !== '1' ? nd.unit : '', angle: !!nd.angle, index: nd.off } : { label: `${nd.name}.x${j + 1}`, name: `${nd.short}.x${j + 1}`, unit: '', angle: false, index: nd.off + j });
  }

  const vals = new Float64Array(nodes.length);
  // Sampled blocks; observers first, so a controller sampling at the same
  // instant already sees the new estimate.
  const ctrls = nodes.filter((nd) => nd.kind === 'ctrl' && !nd.dead).sort((a, b) => b.observer - a.observer);
  const minTs = Math.min(Infinity, ...ctrls.map((nd) => nd.Ts));
  // Every sampled block's Ts: simulateSystem puts each sample instant k·Ts on
  // its integration grid.
  const sampleTimes = [...new Set(ctrls.map((nd) => nd.Ts))];

  // What a node's value reads at the same instant: its inputs, except for a
  // block whose output is its state (it reads X) and a sampled block (it
  // holds); a tap reads its parent.
  const readsNow = (nd) => (nd.kind === 'tap' ? [nd.parent] : nd.kind === 'ctrl' || nd.kind === 'src' || nd.kind === 'ext' || nd.kind === 'ode' || (nd.kind === 'ss' && !nd.ft) ? NONE : nd.inputs);
  const closure = (starts) => {
    const mark = new Uint8Array(nodes.length), stack = [];
    const push = (i) => { if (i >= 0 && !mark[i]) { mark[i] = 1; stack.push(i); } };
    starts.forEach(push);
    while (stack.length) readsNow(nodes[stack.pop()]).forEach(push);
    return mark;
  };
  // The rate slice (robot.md §10): what the state rates, the Out and the
  // External plants read. RK4's stages evaluate only these; what only Sinks
  // and sampled blocks read is evaluated when a step is done (eval with no
  // dX), which is when they are read.
  const rateNeed = closure([...stateNodes.flatMap((nd) => nd.inputs), outNode, ...externals.flatMap((k) => nodes[k].inputs)]);
  const rateOrder = order.filter((i) => rateNeed[i]);
  // The sampled blocks each one reads through blocks without state: after a
  // sample, the outputs are evaluated again only before a block that reads
  // one sampled since (and once at the end), not after every sample.
  for (const nd of ctrls) {
    const mark = closure(nd.inputs);
    nd.after = ctrls.filter((c) => c !== nd && mark[c.i]).map((c) => c.i);
  }

  // A finite difference looked through (robot.md §10): estimate k reads the
  // state measurement k is (an Integrator's output), and its rate estimate
  // the state that Integrator integrates with gain 1. null when a
  // measurement is not such a state: the design then holds the estimates.
  const stateOut = (i) => {
    const nd = nodes[origin(i)];
    if (!nd) return null;
    if (nd.kind === 'tap' && nodes[nd.parent].kind === 'ode' && nodes[nd.parent].nx === 1) return nodes[nd.parent];
    if (nd.kind === 'ss' && nd.nx === 1 && nd.ss.C[0] === 1 && nd.ss.D === 0) return nd;
    if (nd.kind === 'int' && nd.lo === -Infinity && nd.hi === Infinity) return nd;
    return null;
  };
  const gainOne = (nd) => (nd.kind === 'int' ? nd.K === 1 : nd.kind === 'ss' && nd.ss.A[0] === 0 && nd.ss.B[0] === 1);
  function differenceSees(nd) {
    const m = nd.inputs.length - 1, idx = new Int32Array(2 * m).fill(-1);
    for (let k = 0; k < m; k++) {
      const s = stateOut(nd.inputs[k + 1]);
      if (!s) return null;
      idx[k] = s.off;
      const r = gainOne(s) ? stateOut(s.inputs[0]) : null;
      if (r) idx[m + k] = r.off;
    }
    return idx;
  }

  // Laws, made once every node exists. A hand variant is made from its
  // parameters; a designed one from the values its design computes from the
  // plant this block sees (a model-mode compile of this same diagram, so a
  // design never sees a different plant from the one that runs). Observers
  // come first, so a Controller's design can look through a designed one.
  const designs = [];
  if (laws) {
    // Every compile tells the store when it is done, designed variants or
    // not: in the page, background jobs this compile did not ask for (a plan
    // for a variant no longer running) are dropped then.
    // The model compile reads a copy: the store may keep it, and a diagram edited in place must not change it.
    const job = (opts.designs ?? defaultDesigns()).begin(diagram, () => compileDiagram(structuredClone(given), path, { mode: 'model' }), { guest: !opts.designs && defaultDesigns() !== SYNC_DESIGNS });
    for (const nd of ctrls) {
      if (!nd.lib[nd.variant.type].designed) {
        nd.law = makeLaw(nd.variant, nd.Ts, nd.lib);
        if (nd.observer && nd.variant.type === 'difference') { const idx = differenceSees(nd); if (idx) job.see?.(nd.idPath, idx); }
        continue;
      }
      const inputs = blockInputNames(diagram, nd.idPath);
      // What u is called: the Sink that records a Controller's output (for an
      // Observer, what feeds its u), else what the Controller tab calls it.
      const fed = nd.observer ? nd.inputs[0] : nd.i;
      const sink = fed >= 0 ? outermostSink(fed) : null;
      const block = { idPath: nd.idPath, name: nd.name, kind: nd.observer ? 'observer' : 'controller', Ts: nd.Ts, inputs, input: sink?.[0] ?? (nd.observer ? inputs[0] : 'u'), outputs: nd.outv.length, lane: nd.lane, lanes: nd.lanes, ff: nd.ff };
      const status = job.resolve(block, nd.variant, nd.lib);
      nd.law = makeLaw(nd.variant, nd.Ts, nd.lib, status.values);
      designs.push(status);
    }
    job.end();
  }
  // The finite differences looked through, for a reader of seen() outside a
  // design (project.js, blockModel: the Analysis tab): idPath → state index.
  const looked = new Map();
  for (const nd of ctrls) if (nd.observer && nd.variant?.type === 'difference') { const idx = differenceSees(nd); if (idx) looked.set(nd.idPath, idx); }
  // A dead time remembers its input at each step: hist the value after the
  // samples there, histL the value the step ended on, before them. Between
  // two records it runs from the one to the other, so an input held by a
  // Controller (it changes only at its samples) comes out exactly delayed,
  // not spread over a step (which shortened the dead time by half a step).
  const delays = nodes.filter((nd) => !nd.dead && (nd.kind === 'delay' || (nd.kind === 'ss' && nd.delay > 0))).map((nd) => { nd.hist = []; nd.histL = []; return nd; });
  let h = 0;
  // left: the end of an integration step reads the value the step ran on
  // (the left limit), not the one a sample there puts out after it.
  let left = false;
  // ideal: a Jacobian is being taken (stiffness, below): quantizers are the
  // identity and noise adds 0, as in model mode, so a perturbation that
  // crosses a quantizer step does not inflate the bound.
  let ideal = false;
  const histAt = (nd, tau, y0 = 0) => {
    const hist = nd.hist;
    if (tau < 0 || !hist.length) return y0;
    const f = tau / h, i = left ? Math.max(0, Math.ceil(f - 1e-9) - 1) : Math.floor(f + 1e-9);
    if (i >= hist.length - 1) return hist[hist.length - 1];
    return hist[i] + ((nd.histL[i + 1] ?? hist[i + 1]) - hist[i]) * (f - i);
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
        case 'delay': y = model || nd.L <= 0 ? inOf(nd) : histAt(nd, t - nd.L, nd.y0 ?? (nd.hist.length ? nd.hist[0] : inOf(nd))); break;
        case 'switch': y = inOf(nd, nd.pick); break;
        case 'fcn': {
          const { eq, v } = nd;
          for (let s = 0; s < eq.nIn; s++) v[s] = inOf(nd, s);
          v[eq.nIn] = t;
          for (let k = 0; k < eq.fs.length; k++) v[eq.first + k] = eq.fs[k](v);
          for (let j = 0; j < eq.out.length; j++) nd.outv[j] = v[eq.out[j]];
          y = nd.outv[0];
          break;
        }
        case 'pick': y = nodes[nd.parent].outv[nd.j]; break;
        case 'int': y = Math.min(nd.hi, Math.max(nd.lo, X[o + nd.off])); break;
        case 'quant': y = model || ideal ? inOf(nd) : nd.q * Math.round(inOf(nd) / nd.q); break;
        case 'noise': y = model || ideal ? inOf(nd) : inOf(nd) + nd.std * gaussAt(nd.seed, Math.floor(t / (h || 1) + 1e-9)); break;
        case 'ode': nd.ode.out(X, o + nd.off, nd.p, nd.outv); y = nd.outv[0]; break;
        case 'mimo': for (let s = 0; s < nd.uv.length; s++) nd.uv[s] = inOf(nd, s); nd.fn(nd.uv, nd.outv, t); y = nd.outv.length ? nd.outv[0] : 0; break;
        // An observer's estimate looked through (model mode) reads the state it stands for.
        case 'tap': y = nd.see >= 0 ? X[o + nd.see] : nodes[nd.parent].outv[nd.j]; break;
        case 'ctrl': y = nd.u; break;
        // An External plant (Live mode): what the plant sent last; 0 offline.
        case 'xplant': y = nd.outv[0]; break;
        default: {
          const { ss } = nd;
          const inp = nd.delay > 0 && !model ? histAt(nd, t - nd.delay) : inOf(nd);
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
      if (nd.kind === 'int') {
        const r = nd.K * inOf(nd), x = X[o + nd.off];
        dX[o + nd.off] = (x <= nd.lo && r < 0) || (x >= nd.hi && r > 0) ? 0 : r;
        continue;
      }
      if (nd.kind === 'ode') {
        if (nd.uv) for (let s = 0; s < nd.uv.length; s++) nd.uv[s] = inOf(nd, s);
        nd.rates(X, o + nd.off, inOf(nd), dX, nd.uv);
        continue;
      }
      const { ss } = nd, base = o + nd.off;
      const inp = nd.delay > 0 && !model ? histAt(nd, t - nd.delay) : inOf(nd);
      for (let r = 0; r < ss.n; r++) {
        let s = ss.B[r] * inp;
        for (let c = 0; c < ss.n; c++) s += ss.A[r * ss.n + c] * X[base + c];
        dX[base + r] = s;
      }
    }
  }

  // What each probe and the Out read: the origin of their pass node.
  const probeSrc = probeList.map(([, k]) => origin(k)), outSrc = outNode >= 0 ? origin(outNode) : -1;
  const self = {
    n, bound, warnings, minTs, sampleTimes, states, designs, validity, looked,
    // Sinks in a branch a mask switched off: not compiled, they read "off".
    off: offSinks,
    // Every node not compiled, by name ('Motor/coupling'), for the canvas.
    offNodes: [...off].map((i) => nodes[i].name),
    // The mechanisms: { name, idPath (its level), node, mechanism (mech.js's topology), ode }.
    mechanisms: mechList.map(({ node, ...m }) => ({ ...m, offset: nodes[node].off })),
    setStep(step) { h = step; },
    // Called at each completed step with the state there: a controller whose
    // sample is due reads its inputs and sets its held output; the outputs are
    // then evaluated again so what is recorded at t already sees it. Sample k
    // is due at k·Ts, computed from k (no sum that drifts), so a step that
    // lands on k·Ts (simulateSystem's grid) samples exactly there.
    sample(t, X, o, u) {
      const since = [];
      for (const nd of ctrls) {
        if (!nd.law || t < nd.next - 1e-9) continue;
        if (since.length && nd.after.some((c) => since.includes(c))) { self.eval(t, X, o, u, null); since.length = 0; }
        for (let s = 0; s < nd.x.length; s++) nd.x[s] = inOf(nd, s);
        const y = nd.law.step(nd.x);
        if (nd.observer) nd.outv.set(y.subarray ? y.subarray(0, nd.outv.length) : y.slice(0, nd.outv.length)); else nd.u = y;
        while (nd.next <= t + 1e-9) nd.next = ++nd.k * nd.Ts;
        since.push(nd.i);
      }
      if (since.length) self.eval(t, X, o, u, null);
    },
    // The next instant a sampled block is due (Infinity without one).
    nextSample() { let t = Infinity; for (const nd of ctrls) if (nd.next < t) t = nd.next; return t; },
    // Initial state: zero, except for physics blocks with initial conditions.
    init(X, o) {
      for (const nd of stateNodes) {
        if (nd.kind === 'ode') nd.ode.init(nd.p).forEach((v, i) => { X[o + nd.off + i] = v; });
        if (nd.kind === 'int') X[o + nd.off] = nd.x0;
      }
    },
    eval(t, X, o, u, dX, end = false) {
      left = end;
      outputs(dX ? rateOrder : order, t, X, o, u);
      if (dX) rates(stateNodes, t, X, o, dX);
      return outSrc >= 0 ? vals[outSrc] : 0;
    },
    // Values of the Sources and Sinks after the last eval.
    probes: () => probeList.map(([name, k], j) => [name, probeSrc[j] >= 0 ? vals[probeSrc[j]] : 0]),
    // Called after each completed step: dead times remember their input.
    record() { for (const nd of delays) { nd.hist.push(inOf(nd)); if (nd.histL.length < nd.hist.length) nd.histL.push(inOf(nd)); } },
    // Called at the end of a step, before the samples there: what the step
    // ended on (record() then adds the value after them).
    recordLeft() { for (const nd of delays) nd.histL.push(inOf(nd)); },
    // The run at t, after its samples there (simulateSystem's { until }), as
    // a model takes it (el.seen's `at`): the state X, what each Controller
    // and Observer holds (`held`: an output, or the estimates), what each
    // read at its last sample (`inputs`: [r, y…] or [u, y…]) and the
    // Sources' values. Dead times keep their history out of X: a model
    // passes them straight through.
    snapshot(t, X, o = 0) {
      const held = {}, inputs = {}, sources = {};
      for (const nd of ctrls) { held[nd.idPath] = nd.observer ? Float64Array.from(nd.outv) : nd.u; inputs[nd.idPath] = Float64Array.from(nd.x); }
      for (const nd of nodes) if (nd.kind === 'src' && nd.signal !== null) sources[nd.signal] = nd.fn(t);
      return { t, X: Float64Array.from(X.subarray(o, o + n)), held, inputs, sources };
    },
    // External plants (Live mode): y is written by the caller, u() reads what
    // the diagram feeds the block after the last eval.
    externals: externals.filter((k) => !nodes[k].dead).map((k) => ({ name: nodes[k].name, params: nodes[k].p, y: nodes[k].outv, u: () => nodes[k].inputs.map((s) => (s < 0 ? 0 : vals[s])) })),
    // Who feeds what around the (first) External plant, by signal name
    // (Live mode: full scales, the ramp-in, the plant's log):
    //   sinks    { name: { output: j } }  a Sink showing the plant's output j
    //            { name: { input: i } }   … or what the plant gets at input i
    //   sources  { signal: { input: i } } a Source wired to input i
    //            { signal: { ctrl, measured } } a Source on a Controller's r;
    //            measured: the plant output its y comes from (if it does)
    //   ctrls    [{ key, source, measured, drives }] every Controller block:
    //            its id path (its probes are key.r, key.y, key.u), the Source
    //            on its r and the plant output on its y, where they are those,
    //            and the plant inputs its output u is wired to (drives)
    links() {
      const ext = externals[0] ?? -1;
      const outOf = (i) => { const o = origin(i); return o >= 0 && nodes[o].kind === 'tap' && nodes[o].parent === ext ? nodes[o].j : undefined; };
      const inputsFrom = (i) => (ext < 0 || i < 0 ? [] : nodes[ext].inputs.flatMap((s, slot) => (s >= 0 && origin(s) === origin(i) ? [slot] : [])));
      const sinks = {}, sources = {}, ctrls = [];
      for (const [name, pk] of probeList) {
        if (name.includes('.')) continue;
        const nd = nodes[pk];
        if (nd.kind === 'pass') {
          const j = outOf(pk), into = inputsFrom(pk);
          if (j !== undefined) sinks[name] = { output: j }; else if (into.length) sinks[name] = { input: into[0] };
        } else if (nd.kind === 'src') {
          const into = inputsFrom(pk);
          if (into.length) sources[name] = { input: into[0] };
        }
      }
      for (const [key, k] of ctrlNodes) {
        const [r = -1, y = -1] = nodes[k].inputs;
        const ro = origin(r), measured = y >= 0 ? outOf(y) : undefined;
        const source = ro >= 0 && nodes[ro].kind === 'src' ? nodes[ro].signal : undefined;
        ctrls.push({ key, source, measured, drives: inputsFrom(k) });
        if (source !== undefined && !sources[source]) sources[source] = { ctrl: key, ...(measured !== undefined ? { measured } : {}) };
      }
      return { sinks, sources, ctrls };
    },
  };

  // ---- Stiffness: the step bound sees loops through integrators -----------
  // (design/output/detail-levels.md §5.) Each block's own bound (a transfer
  // function's poles, a physics block's) misses a fast loop built from
  // Integrators and Gains. So the rates' Jacobian is taken by forward
  // differences at a state (sampled blocks hold their outputs, an External
  // plant its last values) and the largest magnitude of its eigenvalues
  // joins the blocks' bounds in el.bound, which every stepper reads
  // (simulateSystem, Live, the loop path, a Model's bound).
  const jacobian = (X0, t) => {
    const X = Float64Array.from(X0), f0 = new Float64Array(n), f1 = new Float64Array(n);
    const J = Array.from({ length: n }, () => new Array(n).fill(0));
    ideal = true;
    try {
      self.eval(t, X, 0, 0, f0);
      for (let j = 0; j < n; j++) {
        const x = X[j], dx = (x + 1e-6 * Math.max(1, Math.abs(x))) - x;
        X[j] = x + dx;
        self.eval(t, X, 0, 0, f1);
        X[j] = x;
        for (let i = 0; i < n; i++) J[i][j] = (f1[i] - f0[i]) / dx;
      }
    } finally { ideal = false; }
    self.eval(t, X, 0, 0, null);
    return J;
  };
  // { bound: the largest |λ|, state: the label of the state that mode moves
  // most (from one step of inverse iteration), or why there is none }.
  self.stiffness = (X0, t = 0) => {
    if (!n) return { bound: 0, state: null };
    const J = jacobian(X0, t);
    if (!J.every((row) => row.every(Number.isFinite))) return { bound: 0, state: null, note: 'the rates are not finite at this state' };
    let top = { re: 0, im: 0 }, mag = 0;
    for (const z of eig(J)) { const a = Math.hypot(z.re, z.im); if (a > mag) { mag = a; top = z; } }
    let state = null;
    if (mag > 0) {
      const s = 1 + 1e-7;
      const v = csolve(J.map((row, i) => row.map((a, j) => a - (i === j ? top.re * s : 0))), J.map((row, i) => row.map((a, j) => (i === j ? -top.im * s : 0))), new Array(n).fill(1), new Array(n).fill(0));
      if (v) { let k = 0; for (let i = 1; i < n; i++) if (Math.hypot(v.xr[i], v.xi[i]) > Math.hypot(v.xr[k], v.xi[k])) k = i; state = states[k]?.label ?? null; }
    }
    return { bound: mag, state };
  };
  {
    const X0 = new Float64Array(n);
    self.init(X0, 0);
    const s = self.stiffness(X0, 0);
    self.blockBound = bound;
    self.stiff = s;
    // The difference quotient is good to about 1e-6: an |λ| that close to
    // the blocks' bound is that bound (the encoder's 1000.0000002 is 1000).
    self.bound = s.bound > bound * (1 + 1e-6) ? s.bound : bound;
  }
  // A step plan's warning when the step cap binds: who needs the step.
  self.stiffWarning = (hmax, need, ran, T) => `${self.stiff.state ? `'${self.stiff.state}' needs` : 'this plant needs'} steps of ${siUnit(hmax, 's')}; this ${siUnit(T, 's')} screen would take ${siUnit(need, '', 3)} steps; it ran ${siUnit(ran, '', 3)}: inaccurate. Shorten the screen`;

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
      if (nd.kind === 'tap') return nodes[nd.parent].kind === 'ode' || nodes[nd.parent].kind === 'mimo' ? [nd.parent] : see.has(i) ? [owner[see.get(i)]] : NONE;
      if (nd.kind === 'switch') return [nd.inputs[nd.pick]];
      // A Gain of 0 depends on nothing (a Servo motor's ripple, switched off).
      if (nd.kind === 'gain' && nd.K === 0) return NONE;
      return nd.inputs;
    };
    // What a node's output reads at the same instant: a state block's output
    // reads its state, and its input only through D.
    const reads = (i) => (nodes[i].kind === 'ode' || nodes[i].kind === 'int' || (nodes[i].kind === 'ss' && nodes[i].ss.D === 0) ? NONE : deps(i));
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
    // A plant outside the page (an External plant, Live mode) has no model
    // here: what u drives, or what the measurements read, runs elsewhere.
    const outside = nodes.find((nd, i) => nd.kind === 'xplant' && (fromCut[i] || nd.i === cut || nodes.some((tp, j) => tp.kind === 'tap' && tp.parent === i && toMeas[j])));
    if (outside) throw modelError('external-plant', `the plant runs outside the page (External plant '${outside.name}'): the page has no model of it to design with or analyse`, 'identify it first (the Identify tab is designed, not built yet), or set the gains by hand and tune it live');
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

    // What the nodes carry while this Model is evaluated; the observers it
    // looks through (by name, for the Analysis tab's notes).
    const held = at.held ?? {}, setU = [], setO = [], setSrc = [], setSee = [], through = new Set();
    for (const i of slice) {
      const nd = nodes[i];
      if (nd.kind === 'tap' && see.has(i)) through.add(nodes[nd.parent].name);
      if (nd.kind === 'ctrl' && !nd.observer) {
        const v = Number(held[nd.idPath] ?? 0);
        setU.push([i, v]);
        // The other lanes of the same Controller: one note for them all.
        const lanes = blk.lanes > 1 && nd.lanes > 1 && nd.idPath.replace(/\[\d+\]$/, '') === blk.idPath.replace(/\[\d+\]$/, '');
        if (!lanes) notes.push(`controller '${nd.name}' holds its output at ${fmt(v)}: the design sees its loop open`);
        else if (!notes.some((x) => x.startsWith('the other lanes'))) notes.push(`the other lanes of '${blk.name.replace(/\[\d+\]$/, '')}' hold their outputs: each lane is designed on its own`);
      }
      if (nd.kind === 'src') setSrc.push([i, nd.signal === null ? 0 : Number(at.sources?.[nd.signal] ?? 0)]);
      if (nd.kind === 'tap' && nodes[nd.parent].kind === 'ctrl') {
        setSee.push([i, see.has(i) ? see.get(i) : -1]);
        const o = nodes[nd.parent];
        if (!see.has(i) && !setO.some(([k]) => k === o.i)) {
          const v = new Float64Array(o.outv.length), hv = held[o.idPath];
          if (typeof hv === 'number') v.fill(hv); else if (hv) v.set(Array.from(hv).slice(0, v.length));
          setO.push([o.i, v]);
          // A looked-through observer may have more estimates than states: those stand for none.
          const extra = o.taps.filter((tp) => !see.has(tp)).map((tp) => nodes[tp].name.slice(o.name.length + 1));
          notes.push(o.taps.some((tp) => see.has(tp)) ? `${extra.join(', ')} of '${o.name}' ${extra.length === 1 ? 'stands' : 'stand'} for no state of this plant and ${extra.length === 1 ? 'is' : 'are'} held` : `estimates of '${o.name}' are held; the design does not look through a hand observer`);
        }
      }
    }

    // Sensors: quantizers and noise between the plant and each measurement
    // (sensors[k], filled in below, once the Model can be evaluated). One
    // elsewhere (noise on a torque, say) is process noise, which no design
    // here accounts for: a note.
    const sensorPath = meas.map((mk) => walk([mk], reads));
    const sensors = meas.map(() => ({ std: 0, q: 0, parts: [] }));
    for (const i of slice) {
      const nd = nodes[i];
      if ((nd.kind !== 'quant' && nd.kind !== 'noise') || sensorPath.some((on) => on[i])) continue;
      notes.push(nd.kind === 'quant' ? `quantizer '${nd.name}' is the identity in the model (step ${fmt(nd.q)})` : `noise '${nd.name}' adds 0 in the model (σ ${fmt(nd.std)}): it is on no measurement's way`);
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

    const sink = outermostSink(cut);
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
      delay, sensors, through: [...through],
      bound: Math.max(self.bound, ...kept.map((nd) => nd.bound)),
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
      // Saturations outside their limits at (x, u), where the model sees no
      // slope through them, or at a limit (within a difference step), where
      // the slope differs left and right (edge).
      limits(x, u) {
        mdl.y(x, u, yScratch);
        const out = [];
        for (const i of slice) {
          const nd = nodes[i];
          if (nd.kind !== 'sat') continue;
          const v = inOf(nd), near = 1e-6 * Math.max(1, Math.abs(v)), lim = `(input ${fmt(v)}, limits ${fmt(nd.lo)} to ${fmt(nd.hi)})`;
          if (v < nd.lo || v > nd.hi) out.push({ name: nd.name, edge: false, sentence: `'${nd.name}' is saturated at the operating point ${lim}: the model sees no slope through it` });
          else if (v - nd.lo <= near || nd.hi - v <= near) out.push({ name: nd.name, edge: true, sentence: `'${nd.name}' is at its limit at the operating point ${lim}: the slope differs left and right` });
        }
        return out;
      },
      atLimits: (x, u) => mdl.limits(x, u).map((s) => s.sentence),
    };
    // The sensor blocks on each measurement's way, each weighed by how much
    // of it reaches the measurement (a unit-conversion gain after a noise
    // block multiplies its σ), at the origin, where a Kalman filter is
    // designed: |∂y_k / ∂(the block's output)|.
    const zx = new Float64Array(nk);
    const gainTo = (i, k) => {
      if (meas[k] === i) return 1;
      const p = slice.indexOf(i);
      if (p < 0 || meas[k] < 0) return 0;
      const head = slice.subarray(0, p + 1), tail = slice.subarray(p + 1);
      evaluate(zx, 0, head);
      const d = 1e-6 * Math.max(1, Math.abs(vals[i]));
      const at = (e) => { evaluate(zx, 0, head); vals[i] += e; outputs(tail, t0, Xf, 0, 0); return vals[meas[k]]; };
      return Math.abs((at(d) - at(-d)) / (2 * d));
    };
    sensors.forEach((sn, k) => {
      let std2 = 0, q2 = 0;
      for (const i of slice) {
        const nd = nodes[i];
        if (!sensorPath[k][i] || (nd.kind !== 'quant' && nd.kind !== 'noise')) continue;
        const g = gainTo(i, k), times = Math.abs(g - 1) > 1e-6 ? ` × ${fmt(g)}` : '';
        if (nd.kind === 'quant') { q2 += (g * nd.q) ** 2; sn.parts.push(`quantizer '${nd.name}' step ${fmt(nd.q)}${times}`); }
        else { std2 += (g * nd.std) ** 2; sn.parts.push(`noise '${nd.name}' σ ${fmt(nd.std)}${times}`); }
      }
      sn.std = Math.sqrt(std2);
      sn.q = Math.sqrt(q2);
    });
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
    // A measurement that reads one state alone, with any slope, gives trim
    // a start: that state at the level (outputs[k].state, .slope).
    slopes.forEach((row, k) => {
      const one = row.length === 1 && Math.abs(row[0][1] - 1) < 1e-6;
      mdl.outputs[k].angle = one && mdl.states[row[0][0]].angle;
      mdl.outputs[k].unit = one ? mdl.states[row[0][0]].unit : '';
      if (row.length === 1) Object.assign(mdl.outputs[k], { state: row[0][0], slope: row[0][1] });
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
