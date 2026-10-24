// The project file: one human-editable JSON document holding the system (the
// reference and every slot but the controller), how the display is set, the
// goal, and the candidates. Each candidate holds its own controller and may
// override any other slot. design/output/project-format.md describes it.

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

// How the page opens: the run control, the open tab, in the Plant tab the
// representation shown, and the setup area's share of the page height.
// Unknown values are dropped.
export const UI_RUN = ['run', 'stop', 'single'];
export const UI_TABS = ['input', 'plant', 'controller'];
export function normalizeUi(ui) {
  if (!ui || typeof ui !== 'object') return null;
  const out = {};
  if (UI_RUN.includes(ui.run)) out.run = ui.run;
  if (UI_TABS.includes(ui.tab)) out.tab = ui.tab;
  if (typeof ui.view === 'string' && ui.view) out.view = ui.view;
  if (Number.isFinite(ui.setup) && ui.setup > 0 && ui.setup < 1) out.setup = ui.setup;
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
// spectra (FFT) or as one channel's spectrogram; and which channel, if any,
// has its values on a second axis at the right.
export const VIEW_MODES = ['time', 'fft', 'spectrogram'];
function normalizeScopeView(v) {
  if (!v || typeof v !== 'object') return null;
  const out = {};
  if (VIEW_MODES.includes(v.mode) && v.mode !== 'time') out.mode = v.mode;
  if (Number.isInteger(v.right) && v.right >= 0 && v.right < 4) out.right = v.right;
  const fmin = Number(v.fmin), fmax = Number(v.fmax);
  if (fmin >= 0 && fmax > fmin) { out.fmin = fmin; out.fmax = fmax; }
  if (v.db === false) out.db = false;
  if ([64, 128, 256, 512, 1024].includes(Number(v.size))) out.size = Number(v.size);
  return Object.keys(out).length ? out : null;
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
  const level = parts.slice(0, -1).reduce((d, x) => d?.blocks.find((b) => b.id === x && b.type === 'subsystem')?.diagram, diagram);
  const block = level?.blocks.find((b) => b.id === parts.at(-1));
  if (!block || (block.type !== 'controller' && block.type !== 'observer')) throw new DesignError('no-block', `no Controller or Observer "${id}" in the plant`, 'name a block by its id path, as motor/ctrl');
  const op = parseOp(at);
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
  const seeThrough = new Map();
  for (const s of statuses) if (s.path !== id && s.values?.stateIndex) seeThrough.set(s.path, s.values.stateIndex);
  const el = compileDiagram(structuredClone(diagram), 'plant', { mode: 'model' });
  const model = el.seen(id, { ...(seeThrough.size ? { seeThrough } : {}), ...(snap ? { X: snap.X, held: snap.held, sources: snap.sources, t: snap.t } : {}) });
  // The limits of the running variant, for a trim (u that holds a level).
  const v = block.variants?.[block.variant ?? 0]?.params ?? {};
  const lim = limits ?? { umin: v.umin ?? -Infinity, umax: v.umax ?? Infinity };
  // At a snapshot, u is what the block put out there (an Observer: what it read on its input u).
  const pt = snap ? operatingPoint(model, { kind: 't', t: snap.t, u: block.type === 'observer' ? snap.inputs[id]?.[0] ?? 0 : snap.held[id] ?? 0 }, lim) : operatingPoint(model, op, lim);
  return { model, pt, statuses, block, id, snap };
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
// initial state) and warnings: the model's, and where the linear loop does
// not hold (u at a limit; estimates read as the states they stand for).
export function loopModel(project, idPath, at = 'origin', { designs } = {}) {
  const { model, pt, statuses, block, id, snap } = blockModel(project, idPath, at, { designs });
  if (block.type !== 'controller') throw new DesignError('not-a-controller', `'${block.name ?? block.id}' is an Observer: a loop is cut at a Controller's output`, 'pick the Controller that drives the plant');
  const plant = Object.assign(linearize(model, pt), { idPath: id, Ts: block.params.Ts });
  const variant = block.variants[block.variant ?? 0], def = CONTROLLERS[variant.type], Ts = block.params.Ts;
  let values = null;
  if (def.designed) {
    const st = statuses.find((s) => s.path === id);
    values = st?.values ?? null;
    if (!values) {
      const why = st?.error ? `: ${st.error.message}` : st?.status === 'pending' || st?.status === 'cancelled' ? ': its plan is not made yet' : '';
      throw new DesignError('no-design', `${variant.name} has no design to analyse${why}`, st?.error?.hint || 'see its Computed box in the Controller tab');
    }
  }
  if (!def.linear) throw new DesignError('no-linear', `${def.label} has no linear model`, 'analyse another variant');
  const t = snap ? snap.t : parseOp(at).kind === 'initial' ? 0 : undefined;
  let ctrl;
  try { ctrl = def.linear(variant.params, Ts, { y: Array.from(plant.op.y), ...(t !== undefined ? { t } : {}) }, values); } catch (err) {
    throw err instanceof DesignError ? err : new DesignError('not-linear', `${variant.name}: ${err.message}`, 'pick an operating point where the law is linear, such as at rest');
  }
  const warnings = [...plant.warnings];
  if (ctrl.note) warnings.push(ctrl.note);
  const { umin = -Infinity, umax = Infinity } = variant.params, u = plant.op.u, tol = 1e-9 * Math.max(1, Math.abs(u));
  if (u >= umax - tol || u <= umin + tol) warnings.push(`${plant.input.label} = ${fmt(u)} is at its limit (${fmt(umin)} to ${fmt(umax)}) there: the controller saturates, and the linear loop does not hold`);
  for (const obs of model.through) warnings.push(`the estimates of '${obs}' are read as the states they stand for: the filter's own dynamics are not in this loop`);
  return { plant, ctrl, Ts, opLabel: plant.op.label, variantName: variant.name, type: variant.type, t, warnings: [...new Set(warnings)] };
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
