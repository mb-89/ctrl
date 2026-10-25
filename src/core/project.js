// The project file: one human-editable JSON document holding the system (the
// reference and every slot but the controller), how the display is set, the
// goal, and the candidates. Each candidate holds its own controller and may
// override any other slot. design/output/project-format.md describes it.
// For a diagram, sim.sampleTime is the scope's record step (absent: the
// window / 2000); Controller blocks sample at their own Ts.

import { SLOTS, normalizeBlock } from './blocks.js';
import { normalizeReference, migrateReferenceBlock, referenceFn, sampleSignal } from './signals.js';
import { ceil125 } from './scale.js';
import { simulate, simulateSystem } from './sim.js';
import { computeMetrics } from './metrics.js';
import { normalizeGoal, evaluateGoal, compareEvals } from './goal.js';
import { normalizeDiagram, diagramNames, compileDiagram } from './diagram.js';
import { normalizeView } from './views.js';
import { DesignError, parseOp, operatingPoint, linearize } from './linearize.js';
import { CONTROLLERS } from './controllers.js';
import { inv, mul } from './linalg.js';
import { parseSpeed, speedToJson } from './speed.js';
import { STRUCTURES } from './fit.js';

export const FORMAT = 'loop-tuner/2';
export const PALETTE_SIZE = 8;
// Signals of the closed loop, available once a controller exists.
export const LOOP_SIGNALS = ['y', 'u', 'e', 'ym', 'd'];

// Slots that default to a transparent block. The plant has no default in a
// v2 project: it is null until the Plant tab sets one.
const SYSTEM_DEFAULTS = {
  actuator: { type: 'ideal' },
  disturbance: { type: 'none' },
  sensor: { type: 'ideal' },
  noise: { type: 'none' },
};
const BLOCK_SLOTS = ['actuator', 'disturbance', 'plant', 'sensor', 'noise'];
const CANDIDATE_KEYS = new Set(['name', 'checked', 'color', 'note', 'controller', ...BLOCK_SLOTS]);

export function normalizeProject(p) {
  if (!p || typeof p !== 'object') throw new Error('project must be a JSON object');
  const v1 = p.format === 'loop-tuner/1' || (p.system?.reference && typeof p.system.reference.type === 'string');
  // The simulated window is the screen (scope.timebase); sim holds only the
  // controller's sample time, when one is set.
  const sim = {};
  if (p.sim?.sampleTime !== undefined) {
    sim.sampleTime = Number(p.sim.sampleTime);
    if (!(sim.sampleTime > 0)) throw new Error('sim.sampleTime must be > 0');
  } else if (v1) sim.sampleTime = 0.01;
  const v1Duration = Number(p.sim?.duration ?? 20);
  const v1Period = 10 * ceil125(v1Duration / 10);
  // Named signals, each made by the signal generator; a Source block plays one.
  // Older files had a single "reference": it becomes the signal r.
  const signals = {};
  if (v1) signals.r = normalizeReference(migrateReferenceBlock(p.system?.reference ?? { type: 'step' }, v1Duration, v1Period));
  else if (p.system?.signals) for (const [name, ref] of Object.entries(p.system.signals)) signals[checkName(name)] = normalizeReference(ref);
  else if (p.system?.reference) {
    signals.r = normalizeReference(p.system.reference);
    if (p.system.reference.period === undefined && p.sim?.duration) signals.r.period = Number(p.sim.duration);
  }
  const system = { signals };
  for (const [slot, def] of Object.entries(SYSTEM_DEFAULTS)) system[slot] = normalizeBlock(slot, p.system?.[slot] ?? def);
  const plant = p.system?.plant ?? (v1 ? { type: 'firstOrder' } : null);
  system.plant = plant ? normalizePlant(plant) : null;
  if (system.plant?.type === 'diagram') {
    // Only what the diagram names exists: a signal per Source (r when there
    // is no Source yet).
    const { sources } = diagramNames(system.plant.diagram);
    for (const name of sources) signals[name] ??= normalizeReference({ period: 1, components: [] });
    for (const name of Object.keys(signals)) if (!sources.includes(name) && (sources.length || name !== 'r')) delete signals[name];
  }
  if (!Object.keys(signals).length) signals.r = normalizeReference({ period: 1, components: [] });
  const identify = normalizeIdentify(p.system?.identify);
  if (identify) system.identify = identify;
  const goal = normalizeGoal(p.goal);
  const raw = Array.isArray(p.candidates) ? p.candidates : [];
  const candidates = raw.map((c, i) => {
    for (const k of Object.keys(c)) if (!CANDIDATE_KEYS.has(k)) throw new Error(`candidates[${i}]: unknown key "${k}"`);
    const out = {
      name: String(c.name ?? `#${i + 1}`),
      checked: c.checked !== false,
      color: Number.isInteger(c.color) ? c.color % PALETTE_SIZE : null,
      controller: normalizeBlock('controller', c.controller ?? { type: 'PID' }),
    };
    if (c.note) out.note = String(c.note);
    for (const k of BLOCK_SLOTS) if (c[k]) out[k] = k === 'plant' ? normalizePlant(c[k]) : normalizeBlock(k, c[k]);
    return out;
  });
  for (const c of candidates) if (c.color === null) c.color = nextColor(candidates);
  return {
    format: FORMAT,
    title: String(p.title ?? 'Untitled loop'),
    ...(p.notes ? { notes: String(p.notes) } : {}),
    sim, system, scope: pruneChannels(normalizeScope(p.scope, longestPeriod(signals), candidates.length > 0 && !!system.plant), { system, candidates }), goal, candidates,
    ...(Array.isArray(p.library) && p.library.length ? { library: p.library.map(normalizeLibraryEntry) } : {}),
    ...(p.selected !== undefined ? { selected: String(p.selected) } : {}),
    ...(normalizeUi(p.ui) ? { ui: normalizeUi(p.ui) } : {}),
  };
}

// Identify's settings and kept tests (design/output/identification.md §9),
// keyed by the Controller block's id path ("ctrl", "motor/ctrl"): the design
// inputs (band, budget, hard, vary, seed, structure, use) and, only on Keep,
// the measured records with the plans they ran. Nothing computed: the model
// is recomputed from the record, so a key that is not a measurement or a
// design input is refused with the sentence below.
export const IDENTIFY_COMPUTED = 'Identify keeps the measurements; the model is computed from them. To keep numbers, use Copy as blocks.';
const IDENTIFY_KEYS = ['band', 'budget', 'hard', 'vary', 'seed', 'structure', 'use', 'kept'];
const KEPT_KEYS = ['name', 'plan', 'record'];
const RECORD_KEYS = ['version', 'Ts', 'u', 'y', 'r', 'applied', 'gaps', 'log', 'end', 'ports'];
const PLAN_KEYS = ['version', 'kind', 'Ts', 'u0', 'umin', 'umax', 'band', 'hard', 'budget', 'seed', 'names', 'test', 'check', 'others'];
// The experiment's log keeps its own decisions (interpretation of §9): what
// it measured and chose as it ran (Listen's noise, each rung, the first look
// it steered by, each law and try), never a model of the record. Each kind
// has its fields, and the objects inside them theirs; anything else, at any
// depth, is refused with the sentence.
const LOG_KEYS = {
  stage: ['stage', 'i'],
  listen: ['y0', 'mean', 'sigma', 'q', 'floor', 'slope', 'drift', 'drifts', 'n', 'i0', 'i1'],
  rung: ['n', 'shape', 'a', 'T', 'dir', 'i0', 'i1', 'base', 'ic', 'nBase', 'slope', 'bound', 'backoff', 'runaway', 'w', 'up', 'down', 'max', 'size', 'p', 'plateau', 'ramp', 'complete', 'rings', 'visible', 'seen', 'floor', 'mean', 'sign', 'delay', 'within', 'left', 'at'],
  nudge: ['why', 'rungs', 'i'],
  look: ['cls', 'integrating', 'sign', 'K', 'kp', 'tau', 'theta', 'structure', 'p', 'swing', 'bic', 'guess', 'i'],
  references: ['i', 'test', 'check', 'staircase'],
  law: ['i', 'Kp', 'Ki', 'tauC', 'umin', 'umax', 'I', 'role'],
  hold: ['Kp', 'Ki', 'Ti', 'tauC', 'theta', 'i', 'again', 'doubled'],
  try: ['n', 'tauC', 'Kp', 'Ki', 'umin', 'umax', 'push', 'i0', 'iSwitch', 'iEnd', 'settled', 'tail', 'J', 'parts', 'overshoot', 'g', 'gRoom', 'gRing', 'accepted', 'mark', 'left', 'away'],
  ladder: ['why', 'incumbent', 'tauC', 'i'],
  supply: ['what', 'i', 'upto'],
  pause: ['i0', 'i1', 'waited'],
  check: ['i0', 'iStart', 'iEnd'],
  end: ['code', 'message', 'i', 't', 'check'],
  stop: ['i', 'code'],
  note: ['i', 'text'],
};
const LOG_OBJECTS = {
  'look.p': ['K', 'kp', 'tau', 'theta', 'f', 'zeta'], 'look.swing': ['count', 'f', 'peak'], 'look.bic': ['lag', 'intLag', 'resonance'],
  'look.guess': ['K', 'kp', 'tau', 'theta'], 'try.parts': ['error', 'effort', 'overshoot', 'saturation'], 'end.check': ['i0', 'iStart'],
};
// A value inside a plan, a record's ports or a log entry: a number, a word,
// true or false, null, or a list of those; objects only where named.
function plainValue(v, where) {
  if (v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return;
  if (Array.isArray(v)) { for (const [j, x] of v.entries()) if (x !== null && typeof x === 'object') throw new Error(`${where}[${j}]: ${IDENTIFY_COMPUTED}`); return; }
  throw new Error(`${where}: ${IDENTIFY_COMPUTED}`);
}
function checkLog(log, where) {
  log.forEach((e, j) => {
    const w = `${where}[${j}]`;
    const keys = LOG_KEYS[e.kind];
    if (!keys) throw new Error(`${w}.kind: ${IDENTIFY_COMPUTED}`);
    for (const [k, v] of Object.entries(e)) {
      if (k === 'kind') continue;
      if (!keys.includes(k)) throw new Error(`${w}.${k}: ${IDENTIFY_COMPUTED}`);
      const inner = LOG_OBJECTS[`${e.kind}.${k}`];
      if (inner && v !== null && typeof v === 'object' && !Array.isArray(v)) { for (const [k2, v2] of Object.entries(v)) { if (!inner.includes(k2)) throw new Error(`${w}.${k}.${k2}: ${IDENTIFY_COMPUTED}`); plainValue(v2, `${w}.${k}.${k2}`); } } else plainValue(v, `${w}.${k}`);
    }
  });
}
// The plan's parts: the references, the names, the inputs held.
function checkPlan(plan, where) {
  for (const [k, v] of Object.entries(plan)) {
    if (k === 'test') { onlyKeys(v, Array.isArray(v?.r) ? ['r'] : ['r0'], `${where}.test`); Object.entries(v).forEach(([k2, x]) => plainValue(x, `${where}.test.${k2}`)); } else if (k === 'check') { if (v !== null) { onlyKeys(v, ['r'], `${where}.check`); plainValue(v.r, `${where}.check.r`); } } else if (k === 'names') { onlyKeys(v, ['u', 'uUnit', 'y', 'yUnit'], `${where}.names`); Object.entries(v).forEach(([k2, x]) => plainValue(x, `${where}.names.${k2}`)); } else if (k === 'others') {
      if (!Array.isArray(v)) throw new Error(`${where}.others: a list of the inputs held`);
      v.forEach((o, j) => { onlyKeys(o, ['name', 'value', 'input'], `${where}.others[${j}]`); Object.entries(o).forEach(([k2, x]) => plainValue(x, `${where}.others[${j}].${k2}`)); });
    } else plainValue(v, `${where}.${k}`);
  }
}
function onlyKeys(o, keys, where) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error(`${where}: an object`);
  for (const k of Object.keys(o)) if (!keys.includes(k)) throw new Error(`${where}.${k}: ${IDENTIFY_COMPUTED}`);
}
const pair = (v, where) => {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v) || v.length !== 2 || !v.every(Number.isFinite) || !(v[0] < v[1])) throw new Error(`${where}: [low, high], low below high`);
  return [v[0], v[1]];
};
const numbers = (v, where) => {
  if (!Array.isArray(v) || !v.every((x) => x === null || Number.isFinite(x))) throw new Error(`${where}: a list of numbers (null where nothing was measured)`);
  return v.slice();
};
export function normalizeIdentify(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('system.identify: an object keyed by the Controller block (ctrl, motor/ctrl)');
  const out = {};
  for (const [key, e] of Object.entries(raw)) {
    const where = `system.identify.${key}`;
    if (!/^[^/:\s]+(\/[^/:\s]+)*$/.test(key)) throw new Error(`${where}: the Controller block's id path, such as ctrl or motor/ctrl`);
    onlyKeys(e, IDENTIFY_KEYS, where);
    const o = {};
    if (e.band != null) o.band = pair(e.band, `${where}.band`);
    if (e.hard != null) o.hard = pair(e.hard, `${where}.hard`);
    if (e.budget != null) { if (!(Number.isFinite(e.budget) && e.budget > 0)) throw new Error(`${where}.budget: seconds of plant time, above 0`); o.budget = e.budget; }
    if (e.vary != null) {
      onlyKeys(e.vary, ['share', 'seed'], `${where}.vary`);
      if (!(e.vary.share > 0 && e.vary.share < 1) || !Number.isInteger(e.vary.seed)) throw new Error(`${where}.vary: { share between 0 and 1, seed a whole number }`);
      o.vary = { share: e.vary.share, seed: e.vary.seed };
    } else if ('vary' in e) o.vary = null;
    if (e.seed != null) { if (!Number.isInteger(e.seed)) throw new Error(`${where}.seed: a whole number`); o.seed = e.seed; }
    if (e.structure != null) { if (!Object.hasOwn(STRUCTURES, e.structure)) throw new Error(`${where}.structure: one of ${Object.keys(STRUCTURES).join(', ')}`); o.structure = e.structure; }
    const kept = e.kept ?? [];
    if (!Array.isArray(kept)) throw new Error(`${where}.kept: a list of kept tests`);
    o.kept = kept.map((k, i) => {
      const w = `${where}.kept[${i}]`;
      onlyKeys(k, KEPT_KEYS, w);
      onlyKeys(k.plan, PLAN_KEYS, `${w}.plan`);
      checkPlan(k.plan, `${w}.plan`);
      onlyKeys(k.record, RECORD_KEYS, `${w}.record`);
      const r = k.record;
      if (!Number.isInteger(r.version) || !(r.Ts > 0)) throw new Error(`${w}.record: needs its version and Ts`);
      const rec = { version: r.version, Ts: r.Ts, u: numbers(r.u, `${w}.record.u`), y: numbers(r.y, `${w}.record.y`), r: numbers(r.r, `${w}.record.r`), applied: numbers(r.applied ?? [], `${w}.record.applied`) };
      if (rec.y.length !== rec.u.length || rec.r.length !== rec.u.length) throw new Error(`${w}.record: u, y and r have one value per sample`);
      if (!Array.isArray(r.gaps ?? []) || !(r.gaps ?? []).every((g) => Array.isArray(g) && g.length === 2 && g.every(Number.isInteger))) throw new Error(`${w}.record.gaps: [[sample, cycles lost], …]`);
      rec.gaps = (r.gaps ?? []).map((g) => g.slice());
      if (!Array.isArray(r.log ?? []) || !(r.log ?? []).every((x) => x && typeof x === 'object' && typeof x.kind === 'string')) throw new Error(`${w}.record.log: the experiment's log`);
      checkLog(r.log ?? [], `${w}.record.log`);
      rec.log = structuredClone(r.log ?? []);
      rec.end = r.end ?? null;
      if (r.ports) {
        onlyKeys(r.ports, ['u', 'y', 'units'], `${w}.record.ports`);
        Object.entries(r.ports).forEach(([k2, x]) => plainValue(x, `${w}.record.ports.${k2}`));
        rec.ports = structuredClone(r.ports);
      }
      return { name: String(k.name ?? `test ${i + 1}`), plan: structuredClone(k.plan), record: rec };
    });
    if (e.use != null) { if (!(Number.isInteger(e.use) && e.use >= 0 && e.use < o.kept.length)) throw new Error(`${where}.use: the index of a kept test`); o.use = e.use; }
    out[key] = o;
  }
  return Object.keys(out).length ? out : null;
}

// How the page opens: the run control, the open tab, in the Plant tab the
// representation shown, the setup area's share of the page height, and the
// speed of time (a positive factor, or -1: as fast as possible).
// Unknown values are dropped.
export const UI_RUN = ['run', 'stop', 'single'];
export const UI_TABS = ['input', 'plant', 'controller', 'identify', 'tune', 'analysis'];
export function normalizeUi(ui) {
  if (!ui || typeof ui !== 'object') return null;
  const out = {};
  if (UI_RUN.includes(ui.run)) out.run = ui.run;
  if (UI_TABS.includes(ui.tab)) out.tab = ui.tab;
  if (typeof ui.view === 'string' && ui.view) out.view = ui.view;
  if (Number.isFinite(ui.setup) && ui.setup > 0 && ui.setup < 1) out.setup = ui.setup;
  const speed = parseSpeed(ui.speed);
  if (speed !== null) out.speed = speedToJson(speed);
  return Object.keys(out).length ? out : null;
}

export function checkName(name) {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,11}$/.test(name)) throw new Error(`signal name "${name}": letters, digits and _, starting with a letter`);
  return name;
}

const longestPeriod = (signals) => Math.max(...Object.values(signals).map((s) => s.period));

// A plant is a single model block or a diagram ({ "type": "diagram", "diagram": {...} }).
export function normalizePlant(plant) {
  if (plant.type === 'diagram') {
    const out = { type: 'diagram', diagram: normalizeDiagram(plant.diagram) };
    if (Array.isArray(plant.views) && plant.views.length) out.views = plant.views.map((v, i) => normalizeView(v, `plant.views[${i}]`));
    return out;
  }
  return normalizeBlock('plant', plant);
}

// The person's own blocks: subsystems saved to the library, kept in the project.
function normalizeLibraryEntry(e, i) {
  if (!e?.name) throw new Error(`library[${i}]: needs a name`);
  const d = normalizeDiagram({ blocks: [{ ...e.block, id: 'x', x: 0, y: 0 }], wires: [] }, `library[${i}]`);
  const { id, x, y, ...block } = d.blocks[0];
  void id; void x; void y;
  return { name: String(e.name), block };
}

export function defaultSampleTime(duration) {
  return Number((duration / 2000).toPrecision(2));
}

export const MAX_SAMPLES = 200000;

// The simulation window: from 0 to the right edge of the screen, sampled at
// the controller's sample time, or finely enough to draw when there is none.
export function simOf(project) {
  const tb = project.scope.timebase;
  const duration = Math.max(tb.position + 10 * tb.scale, tb.scale);
  return { duration, sampleTime: project.sim.sampleTime ?? defaultSampleTime(duration) };
}

// Auto Scale's timebase: one period of the input on the screen, at the
// smallest 1-2-5 step that fits it.
export function autoTimebase(project) {
  return { scale: ceil125(longestPeriod(project.system.signals) / 10), position: 0 };
}

// Auto Scale for one channel: the signal spans about six divisions, centred
// on a whole division so the axis labels are round numbers.
export function fitChannel(values) {
  let lo = Infinity, hi = -Infinity;
  for (const x of values) if (Number.isFinite(x)) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
  if (!Number.isFinite(lo)) return null;
  const span = hi - lo || Math.abs(hi) || 1;
  const scale = ceil125(span / 6);
  const offset = Number((-Math.round((hi + lo) / 2 / scale) * scale).toPrecision(6)) || 0;
  return { scale, offset };
}

// Channel 1 shows r; the others start empty ("" is no source) until the
// person picks a Source or Sink for them. A closed loop starts with y, u, e.
const DEFAULT_CHANNELS = [
  { source: 'r', on: true, scale: 0.2, offset: 0 },
  { source: '', on: false, scale: 0.2, offset: 0 },
  { source: '', on: false, scale: 0.5, offset: 0 },
  { source: '', on: false, scale: 0.2, offset: 0 },
];
export const LOOP_CHANNELS = ['r', 'y', 'u', 'e'];

// How the display is set: timebase (s/div, time at the left edge) and four
// channels (source, on, units/div, offset in units).
export function normalizeScope(scope = {}, period, loop = false) {
  const tb = scope.timebase ?? {};
  const timebase = { scale: Number(tb.scale ?? ceil125(period / 10)), position: Number(tb.position ?? 0) };
  if (!(timebase.scale > 0)) throw new Error('scope.timebase.scale must be > 0');
  const channels = DEFAULT_CHANNELS.map((d, i) => {
    const c = scope.channels?.[i] ?? {};
    const ch = { source: c.source ?? (loop ? LOOP_CHANNELS[i] : d.source), on: c.on ?? (loop || d.on), scale: Number(c.scale ?? d.scale), offset: Number(c.offset ?? d.offset) };
    if (ch.source !== '' && !/^[A-Za-z][A-Za-z0-9_]{0,11}$/.test(ch.source)) throw new Error(`scope.channels[${i}].source: a signal name such as r, y1 or u, or "" for none`);
    if (ch.source === '') ch.on = false;
    if (!(ch.scale > 0) || !Number.isFinite(ch.offset)) throw new Error(`scope.channels[${i}]: scale must be > 0 and offset a number`);
    ch.on = !!ch.on;
    const f = normalizeFilter(c.filter, `scope.channels[${i}].filter`);
    if (f) ch.filter = f;
    // A Measure line under the screen (mean, rms, …); absent is off.
    if (c.measure === true) ch.measure = true;
    return ch;
  });
  const view = normalizeScopeView(scope.view);
  return { timebase, channels, ...(view ? { view } : {}) };
}

// A display filter on a channel: the scope shows (and analyses) the filtered
// signal; the system is not changed. Designs are in core/spectrum.js.
export const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch'];
function normalizeFilter(f, where) {
  if (!f || !FILTER_TYPES.includes(f.type)) return null;
  const f0 = Number(f.f0), order = [2, 4, 6, 8].includes(Number(f.order)) ? Number(f.order) : 2, q = Number(f.q ?? Math.SQRT1_2);
  if (!(f0 > 0)) throw new Error(`${where}.f0: a frequency above 0 Hz`);
  if (!(q > 0)) throw new Error(`${where}.q: above 0`);
  return { type: f.type, f0, order, q };
}

// How the screen shows the channels: in time (the default), as amplitude
// spectra (FFT), as one channel's spectrogram, or XY (channel 1 across, the
// others against it; delta: they draw channel 1 minus themselves); and which
// channel, if any, has its values on a second axis at the right; the
// spectrogram's levels per signal (absent: automatic); aboveNoise: the
// spectrogram's colour is dB above the local noise instead of dB of the
// signal's unit, with levels of its own per signal (noiseLevels).
export const VIEW_MODES = ['time', 'fft', 'spectrogram', 'xy'];
function normalizeScopeView(v) {
  if (!v || typeof v !== 'object') return null;
  const out = {};
  if (VIEW_MODES.includes(v.mode) && v.mode !== 'time') out.mode = v.mode;
  if (Number.isInteger(v.right) && v.right >= 0 && v.right < 4) out.right = v.right;
  const fmin = Number(v.fmin), fmax = Number(v.fmax);
  if (fmin >= 0 && fmax > fmin) { out.fmin = fmin; out.fmax = fmax; }
  if (v.db === false) out.db = false;
  if (v.delta === true) out.delta = true;
  if ([64, 128, 256, 512, 1024].includes(Number(v.size))) out.size = Number(v.size);
  const levels = normalizeLevels(v.levels);
  if (levels) out.levels = levels;
  if (v.aboveNoise === true) out.aboveNoise = true;
  const noiseLevels = normalizeLevels(v.noiseLevels);
  if (noiseLevels) out.noiseLevels = noiseLevels;
  return Object.keys(out).length ? out : null;
}

// The spectrogram's levels, per signal (dB of one unit are not dB of
// another): { name: [floor, ceiling] } in dB of that signal's unit, each pair
// rounded to 0.1 dB, floor first (a reversed pair is swapped), at least 1 dB
// apart and within ±300 dB. A signal without a pair has automatic levels;
// no pair at all is absent.
function normalizeLevels(l) {
  if (!l || typeof l !== 'object' || Array.isArray(l)) return null;
  const out = {};
  for (const [name, pair] of Object.entries(l)) {
    const lv = normalizeLevelPair(pair);
    if (name && name !== '__proto__' && lv) out[name] = lv;
  }
  return Object.keys(out).length ? out : null;
}
function normalizeLevelPair(l) {
  if (!Array.isArray(l) || l.length !== 2 || l.some((x) => typeof x !== 'number')) return null;
  const [a, b] = l.map((x) => Math.round(x * 10) / 10).sort((x, y) => x - y);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b - a < 1 || a < -300 || b > 300) return null;
  return [a, b];
}

// The scope view with one signal's levels set ([floor, ceiling] in dB) or,
// with null, back to automatic; the other signals' levels are kept. Levels
// above the noise (dB above the local noise) are kept apart from absolute
// ones (dB of the unit), in noiseLevels; which ones follows the view's switch
// unless aboveNoise is given.
const levelsKey = (aboveNoise) => (aboveNoise ? 'noiseLevels' : 'levels');
export function withLevels(view, source, pair, aboveNoise = !!view?.aboveNoise) {
  const key = levelsKey(aboveNoise), levels = { ...(view?.[key] ?? {}) };
  if (pair) levels[source] = pair; else delete levels[source];
  const out = { ...(view ?? {}), [key]: levels };
  if (!Object.keys(levels).length) delete out[key];
  return out;
}
// A signal's levels in the scope view, or null (automatic): absolute or
// above the noise, as the view's switch is unless aboveNoise is given.
export function levelsOf(view, source, aboveNoise = !!view?.aboveNoise) {
  const l = view?.[levelsKey(aboveNoise)];
  return l && Object.hasOwn(l, source) ? l[source] : null;
}
// The scope view with the spectrogram's colour switched: dB above the local
// noise (true) or absolute (false, the default: absent).
export function withAboveNoise(view, on) {
  const out = { ...(view ?? {}) };
  if (on) out.aboveNoise = true; else delete out.aboveNoise;
  return out;
}

// Every name a scope channel can show: the signals (one per Source) and the
// diagram's Sinks; with a closed loop from an older file, also its y, u, e, ym, d.
export function channelNames(project) {
  const plant = project.system.plant;
  const n = plant?.type === 'diagram' ? diagramNames(plant.diagram) : { sources: [], sinks: [] };
  return [...new Set([...Object.keys(project.system.signals), ...n.sinks, ...(loopReady(project) ? LOOP_SIGNALS : [])])];
}

// A channel showing a name that no longer exists goes back to no source.
export function pruneChannels(scope, project) {
  const names = channelNames(project);
  for (const ch of scope.channels) if (ch.source && !names.includes(ch.source)) { ch.source = ''; ch.on = false; }
  return scope;
}

// With a plant but no controller yet, the plant runs open loop: u = r.
export function evaluateOpenLoop(project) {
  const loop = resolveLoop(project, { controller: null });
  return simulate(loop, simOf(project), { openLoop: true });
}

// A loop can run once it has a plant and at least one controller candidate.
// A v1 closed loop: a plant and controller candidates. A diagram that plays
// its own Sources is a whole system, not a loop's plant, whatever candidates
// an older file carries.
export function loopReady(project) {
  const plant = project.system.plant;
  if (plant?.type === 'diagram' && diagramNames(plant.diagram).sources.length) return false;
  return !!plant && project.candidates.length > 0;
}

// One named signal on the simulation grid (r by default).
export function referenceTrace(project, name = 'r') {
  const sim = simOf(project);
  const ref = project.system.signals[name] ?? { period: 1, components: [] };
  const { t, v } = sampleSignal(referenceFn(ref, sim), sim);
  return { t, r: v };
}

// The diagram as the whole system: every Source and Sink, with its
// Controllers running. opts.designs: the design store (simulateSystem);
// info.designs lists what the designed variants computed.
export function evaluateSystem(project, { designs } = {}) {
  const plant = project.system.plant;
  const sim = simOf(project);
  if (plant?.type !== 'diagram') {
    const signals = {};
    for (const name of Object.keys(project.system.signals)) signals[name] = referenceTrace(project, name).r;
    return { t: referenceTrace(project).t, signals, info: { warnings: [], designs: [] } };
  }
  return simulateSystem(plant.diagram, project.system.signals, sim, { designs });
}

// What the designed variants compute, without a run: { designs } as in
// evaluateSystem's info. The page does not simulate a plant outside it
// (Live mode, offline), but a variant from the plant still says why it is
// refused there.
export function designSystem(project, { designs } = {}) {
  const plant = project.system.plant;
  if (plant?.type !== 'diagram') return [];
  return compileDiagram(plant.diagram, 'plant', { standalone: true, designs }).designs ?? [];
}

// ---- Analysis hooks (design/output/designs.md, "For the Analysis tab")

// The plant a Controller or Observer sees (el.seen) at an operating point,
// with what the run's designs computed: a Controller looks through designed
// observers as its design did. at: 'origin' | 'initial' | { y: [levels] } |
// { t: seconds of the run }; a { t } runs the system to t (simulateSystem's
// until) and takes the model there: the state, what the other blocks hold,
// the Sources' values. → { model, pt, statuses, block, id, snap }.
function blockModel(project, idPath, at, { designs, limits } = {}) {
  const plant = project.system.plant;
  if (plant?.type !== 'diagram') throw new DesignError('no-diagram', 'the plant is not a block diagram, so no block sees a plant in it', 'build the plant in the Plant tab, or load a system from the System library');
  const diagram = plant.diagram, id = Array.isArray(idPath) ? idPath.join('/') : String(idPath);
  const parts = id.split('/');
  // A lane of a Controller with lanes: 'ctl/servos[2]' (1-based; vectors.js).
  const [, last, lane] = parts.at(-1).match(/^(.*?)(?:\[(\d+)\])?$/);
  const level = parts.slice(0, -1).reduce((d, x) => d?.blocks.find((b) => b.id === x && b.type === 'subsystem')?.diagram, diagram);
  const block = level?.blocks.find((b) => b.id === last);
  if (!block || (block.type !== 'controller' && block.type !== 'observer') || (lane && !(lane >= 1 && lane <= (block.params.lanes ?? 1) && block.params.lanes > 1))) throw new DesignError('no-block', `no Controller or Observer "${id}" in the plant`, 'name a block by its id path, as motor/ctrl, or a lane as robot/servos[2]');
  // A lane starts where the run starts (t = 0): every lane then holds what
  // it puts out at the start, the torques that hold the arm, where a trim of
  // this lane alone would leave the others at 0 and the arm falling.
  const op = lane && parseOp(at).kind === 'initial' ? parseOp({ t: 0 }) : parseOp(at);
  // No store named: compileDiagram's default (Node: SYNC_DESIGNS; the page: its own, as a guest).
  const store = designs;
  let statuses, snap = null;
  if (op.kind === 't') {
    const sim = simOf(project);
    const run = simulateSystem(diagram, project.system.signals, { ...sim, duration: Math.max(sim.duration, op.t) }, { designs: store, until: op.t });
    snap = run.snapshot;
    if (!snap) throw new DesignError('diverged', `the run diverges before t = ${op.t} s: there is no state to linearise at`, 'pick an earlier time, or steady the loop first');
    statuses = run.info.designs;
  } else statuses = compileDiagram(diagram, 'plant', { standalone: true, sources: {}, designs: store }).designs;
  const el = compileDiagram(structuredClone(diagram), 'plant', { mode: 'model' });
  // Finite differences are looked through as a design looks through them (diagram.js, looked).
  const seeThrough = new Map(el.looked ?? []);
  for (const s of statuses) if (s.path !== id && s.values?.stateIndex) seeThrough.set(s.path, s.values.stateIndex);
  const seenAt = { ...(seeThrough.size ? { seeThrough } : {}), ...(snap ? { X: snap.X, held: snap.held, sources: snap.sources, t: snap.t } : {}) };
  const model = el.seen(id, seenAt);
  // The limits of the running variant, for a trim (u that holds a level).
  const v = block.variants?.[block.variant ?? 0]?.params ?? {};
  const lim = limits ?? { umin: v.umin ?? -Infinity, umax: v.umax ?? Infinity };
  // At a snapshot, u is what the block put out there (an Observer: what it read on its input u).
  const pt = snap ? operatingPoint(model, { kind: 't', t: snap.t, u: block.type === 'observer' ? snap.inputs[id]?.[0] ?? 0 : snap.held[id] ?? 0 }, lim) : operatingPoint(model, op, lim);
  // Another lane j of the same Controller, linearised at the same state with
  // what it holds there (loopModel closes it round the plant).
  const laneId = (j) => id.replace(/\[\d+\]$/, `[${j}]`);
  const laneLin = (j) => { const m = el.seen(laneId(j), seenAt); return linearize(m, operatingPoint(m, { kind: 't', t: snap?.t ?? 0, u: Number(snap?.held[laneId(j)] ?? 0) })); };
  return { model, pt, statuses, block, id, snap, lane: Number(lane) || 0, laneId, laneLin };
}

// The plant the block idPath sees, linearised at an operating point
// (linearize.js: A, B, C, D, states, outputs, op, delay, sensors, warnings),
// with idPath, the block's Ts, and t, the snapshot's time, for a { t }
// (on the sample grid; the op's drift says how far from rest it is).
// opts.designs: the store the run's designs come from (the page's, so a
// plan is not made twice); opts.limits: { umin, umax } for a trim, by
// default the running variant's.
export function linearizeBlock(project, idPath, at = 'origin', opts = {}) {
  const { model, pt, block, id, snap } = blockModel(project, idPath, at, opts);
  return Object.assign(linearize(model, pt), { idPath: id, Ts: block.params.Ts, ...(snap ? { t: snap.t } : {}) });
}

// The loop a Controller closes, cut at its output u, for the Analysis tab:
//   plant  the plant it sees, linearised at `at` (linearizeBlock: continuous;
//          discretise it at Ts with a zero-order hold, each measurement's
//          dead time as round(delay / Ts) unit delays)
//   ctrl   the running variant's own discrete law there, { A, B, C, D } from
//          [r, y1 … ym] to u (controllers.js linear); a designed variant's
//          from the values its design computed
// so that L(z) = −C_y(z) P(z), with C_y the measurement columns of ctrl.
// Also Ts, opLabel, variantName, type, t (the snapshot's, or 0 for the
// initial state), atLimit (u at a limit there) and warnings: the model's,
// and where the linear loop does not hold (u at a limit; estimates read as
// the states they stand for). Refused (DesignError) where there is no
// linear loop: a law with no linear model, a design not made, a plant
// outside the page, and a kink at the operating point (the slope there is
// neither side's and depends on the difference step; designs refuse it too).
export function loopModel(project, idPath, at = 'origin', { designs } = {}) {
  const { model, pt, statuses, block, id, snap, lane, laneId, laneLin } = blockModel(project, idPath, at, { designs });
  if (block.type !== 'controller') throw new DesignError('not-a-controller', `'${block.name ?? block.id}' is an Observer: a loop is cut at a Controller's output`, 'pick the Controller that drives the plant');
  let plant = Object.assign(linearize(model, pt), { idPath: id, Ts: block.params.Ts });
  // At a kink the central slope is neither side's (and depends on the step):
  // margins and poles from it say nothing, so the loop is refused, as a design refuses it.
  if (plant.kinks.length) throw new DesignError('kink', `the plant has a kink at ${plant.op.label}: ${plant.kinks[0]}; a linear loop there would show the slope of neither side`, 'pick Start or Scope time (a state of the run), or a level away from the kink');
  const variant = block.variants[block.variant ?? 0], def = CONTROLLERS[variant.type], Ts = block.params.Ts;
  const t = snap ? snap.t : parseOp(at).kind === 'initial' ? 0 : undefined;
  // The running variant's linear law at lane path p (the block's own path, or a lane's).
  function lawOf(p, lin) {
    let values = null;
    if (def.designed) {
      const st = statuses.find((s) => s.path === p);
      values = st?.values ?? null;
      if (!values) {
        const why = st?.error ? `: ${st.error.message}` : st?.status === 'pending' || st?.status === 'cancelled' ? ': its plan is not made yet' : '';
        throw new DesignError('no-design', `${variant.name} has no design to analyse${why}`, st?.error?.hint || 'see its Computed box in the Controller tab');
      }
    }
    if (!def.linear) throw new DesignError('no-linear', `${def.label} has no linear model`, 'analyse another variant');
    try { return def.linear(variant.params, Ts, { y: Array.from(lin.op.y), ...(t !== undefined ? { t } : {}) }, values); } catch (err) {
      // The law's own hint where it has one (no point makes a switching law linear).
      throw err instanceof DesignError ? err : new DesignError('not-linear', `${variant.name}: ${err.message}`, err.hint ?? 'pick an operating point where the law is linear, such as at rest');
    }
  }
  const ctrl = lawOf(id, plant);
  // A law that updates every k samples is linear at its own, longer Ts.
  const loopTs = ctrl.Ts ?? Ts;
  plant.Ts = loopTs;
  const warnings = [...plant.warnings];
  if (ctrl.note) warnings.push(ctrl.note);
  // A lane: the other lanes closed round the plant by their own laws.
  if (lane) {
    const others = [];
    for (let j = 1; j <= block.params.lanes; j++) if (j !== lane) { const lin = laneLin(j); others.push({ lin, ctrl: lawOf(laneId(j), lin) }); }
    const closed = closeLanes(plant, others, Ts);
    if (closed) {
      plant = closed;
      warnings.splice(0, warnings.length, ...warnings.filter((w) => !w.startsWith('the other lanes')));
      warnings.push(`the other lanes of '${block.name ?? block.id}' run their law round the plant (taken to continuous time); r of every lane is held`);
    }
  }
  // A lane's limit (speedPI's limit, ± per lane) as umin, umax.
  const laneLim = Array.isArray(variant.params.limit) ? (variant.params.limit[(lane || 1) - 1] ?? variant.params.limit[0]) || Infinity : null;
  const { umin = laneLim === null ? -Infinity : -laneLim, umax = laneLim ?? Infinity } = variant.params, u = plant.op.u, tol = 1e-9 * Math.max(1, Math.abs(u));
  const atLimit = u >= umax - tol || u <= umin + tol;
  if (atLimit) warnings.push(`${plant.input.label} = ${fmt(u)} is at its limit (${fmt(umin)} to ${fmt(umax)}) there: the controller saturates, and the linear loop does not hold`);
  for (const obs of model.through) warnings.push(`the estimates of '${obs}' are read as the states they stand for: the filter's own dynamics are not in this loop`);
  // Where the linear loop does not hold, for a reader that grades it (the
  // Analysis tab's verdict, Auto-tune's check at the start): u at a limit.
  // (A kink at the operating point is refused above.)
  return { plant, ctrl, Ts: loopTs, opLabel: plant.op.label, variantName: variant.name, type: variant.type, t, atLimit, warnings: [...new Set(warnings)] };
}

// The plant lane k sees with the other lanes of its Controller closed round
// it (robot.md §5: one loop at a time, the others tracking), so the arm's
// other joints do not fall while lane k is cut. Each other lane's discrete
// law (inputs r, its measurements) is taken to continuous time (Tustin,
// exact at low frequency; the sample-and-hold of the other lanes is left
// out), its r held: u_j = C_j x_j + D_j y_j, ẋ_j = A_j x_j + B_j y_j. Its
// plant column and rows come from its own cut at the same state. null where
// the lanes' plants are not one (other states, a dead time, feedthrough):
// the other lanes then hold their outputs, as seen() leaves them.
function closeLanes(plant, others, Ts) {
  const n = plant.A.length, names = plant.states.map((s) => s.label).join('|');
  if (others.some(({ lin }) => lin.A.length !== n || lin.states.map((s) => s.label).join('|') !== names || lin.D.flat().some((v) => v !== 0) || (lin.delay ?? []).some((d) => d > 0))) return null;
  const parts = others.map(({ lin, ctrl }) => {
    const m = lin.C.length, nc = ctrl.A.length;
    const cols = (row) => Array.from({ length: m }, (_, k) => row[1 + k] ?? 0);
    if (!nc) return { lin, nc, A: [], B: [], C: [], D: cols(ctrl.D[0]) };
    // Tustin backwards: A = (2/Ts)(Φ + I)⁻¹(Φ − I), B = (Φ + I)⁻¹Γ, C = H (2/Ts I − A), D = J − H B.
    const P = ctrl.A.map((r, i) => r.map((v, j) => v + (i === j ? 1 : 0)));
    const Pi = inv(P);
    const A = mul(Pi, ctrl.A.map((r, i) => r.map((v, j) => v - (i === j ? 1 : 0)))).map((r) => r.map((v) => (2 / Ts) * v));
    const B = mul(Pi, ctrl.B.map(cols));
    const H = ctrl.C[0];
    const C = A.map((_, j) => (2 / Ts) * H[j] - H.reduce((s, h, i) => s + h * A[i][j], 0));
    const D = cols(ctrl.D[0]).map((d, k) => d - H.reduce((s, h, i) => s + h * B[i][k], 0));
    return { lin, nc, A, B, C, D };
  });
  const N = n + parts.reduce((s, p) => s + p.nc, 0);
  const A = Array.from({ length: N }, (_, i) => (i < n ? [...plant.A[i], ...new Array(N - n).fill(0)] : new Array(N).fill(0)));
  let o = n;
  for (const p of parts) {
    const Bu = p.lin.B.map((r) => r[0]), Cy = p.lin.C;
    // u_j's weight on the plant's states (D_j y) and on the law's own.
    const dx = Array.from({ length: n }, (_, c) => p.D.reduce((s, d, k) => s + d * Cy[k][c], 0));
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < n; c++) A[i][c] += Bu[i] * dx[c];
      for (let c = 0; c < p.nc; c++) A[i][o + c] += Bu[i] * p.C[c];
    }
    for (let r = 0; r < p.nc; r++) {
      for (let c = 0; c < n; c++) A[o + r][c] = p.B[r].reduce((s, b, k) => s + b * Cy[k][c], 0);
      for (let c = 0; c < p.nc; c++) A[o + r][o + c] = p.A[r][c];
    }
    o += p.nc;
  }
  // A law state that integrates what is a plant state's rate (a PI's
  // integral of a measured speed is the angle, scaled: ẋ_c = β·ẋ_s) stays
  // β·x_s apart from it, a constant: taken out (x_c = β·x_s, exact for the
  // deviations), or it would be a pole at s = 0 that neither u nor y moves.
  const drop = [];
  for (let r = n; r < N; r++) {
    if (A[r].some((v, c) => c >= n && v !== 0) || A.some((row, i) => i >= n && i !== r && row[r] !== 0)) continue;
    const w = A[r].slice(0, n), big = Math.max(...w.map(Math.abs));
    if (!(big > 0)) continue;
    for (let sIdx = 0; sIdx < n; sIdx++) {
      const a = plant.A[sIdx], j = a.findIndex((v) => v !== 0);
      if (j < 0 || plant.B[sIdx][0] !== 0 || A[sIdx].some((v, c) => c >= n && v !== 0)) continue;
      const beta = w[j] / a[j];
      if (!w.every((v, c) => Math.abs(v - beta * a[c]) <= 1e-12 * big)) continue;
      for (const row of A) row[sIdx] += beta * row[r];
      drop.push(r);
      break;
    }
  }
  const keep = A.map((_, i) => i).filter((i) => !drop.includes(i));
  const Ar = keep.map((i) => keep.map((j) => A[i][j])), M = keep.length;
  const pad = (row) => [...row, ...new Array(M - n).fill(0)];
  const lawStates = Array.from({ length: M - n }, (_, i) => ({ label: `other lanes' law ${i + 1}`, name: `x${i + 1}`, unit: '', angle: false, index: n + i }));
  return { ...plant, A: Ar, B: plant.B.concat(Array.from({ length: M - n }, () => [0])), C: plant.C.map(pad), n: M, states: [...plant.states, ...lawStates] };
}

// The least-used palette slot, earliest first, so a colour follows its
// candidate and is never reassigned when others are added or removed.
export function nextColor(candidates) {
  const count = new Array(PALETTE_SIZE).fill(0);
  for (const c of candidates) if (Number.isInteger(c.color)) count[c.color]++;
  let best = 0;
  for (let i = 1; i < PALETTE_SIZE; i++) if (count[i] < count[best]) best = i;
  return best;
}

export function resolveLoop(project, cand) {
  const loop = { reference: project.system.signals.r ?? { period: 1, components: [] } };
  for (const s of SLOTS) if (s.key !== 'reference') loop[s.key] = s.key === 'controller' ? cand.controller : (cand[s.key] ?? project.system[s.key]);
  return loop;
}

export function evaluateCandidate(project, cand) {
  if (!project.system.plant) throw new Error('the loop has no plant yet; add one in the Plant tab or set system.plant');
  const result = simulate(resolveLoop(project, cand), simOf(project));
  const metrics = computeMetrics(result, { settlingBand: project.goal.settlingBand });
  const evaluation = evaluateGoal(metrics, project.goal);
  return { result, metrics, evaluation };
}

// Evaluates every candidate; rank lists candidate indices best first.
export function evaluateProject(project) {
  const runs = project.candidates.map((c) => evaluateCandidate(project, c));
  const rank = runs.map((_, i) => i).sort((a, b) => compareEvals(runs[a].evaluation, runs[b].evaluation));
  return { runs, rank };
}

export function findCandidate(project, ref) {
  if (ref === undefined || ref === null) return project.candidates.length - 1;
  const byName = project.candidates.findIndex((c) => c.name === String(ref));
  if (byName >= 0) return byName;
  const i = Number(ref);
  if (Number.isInteger(i) && i >= 0 && i < project.candidates.length) return i;
  throw new Error(`no candidate "${ref}"; candidates: ${project.candidates.map((c) => c.name).join(', ')}`);
}

export function uniqueName(project, base) {
  const names = new Set(project.candidates.map((c) => c.name));
  if (!names.has(base)) return base;
  const stem = base.replace(/ \d+$/, '');
  for (let i = 2; ; i++) if (!names.has(`${stem} ${i}`)) return `${stem} ${i}`;
}

// Parameters left out of a one-line summary while they hold their usual value.
const QUIET_DEFAULTS = { b: 1, c: 0, Tf: 0.05 };

export function describeController(block) {
  const ps = Object.entries(block.params)
    .filter(([k, v]) => !(k in QUIET_DEFAULTS) || v !== QUIET_DEFAULTS[k])
    .map(([k, v]) => `${k} ${Array.isArray(v) ? `[${v.join(', ')}]` : fmt(v)}`);
  return `${block.type}${ps.length ? ' · ' + ps.join(' · ') : ''}`;
}

export function fmt(v, digits = 3) {
  if (v === Infinity) return '∞';
  if (v === -Infinity) return '−∞';
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e4 || a < 1e-3) return v.toExponential(2);
  return String(Number(v.toPrecision(digits)));
}
