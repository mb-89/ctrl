// Identify (design/output/identification.md §2–§5): what the page knows about
// a Controller block's loop without asking (knownFor), the two things it asks
// with their defaults (identifySettings), and the plan of the experiment
// (planExperiment), which the experiment (experiment.js) runs as data. Every
// reason it cannot run is an IdentifyError with a sentence and a hint, as
// Auto-tune gives them.
//
// Nothing here is stored: the settings are design inputs, and the plan is
// recomputed from them and the project whenever a test starts.

import { controllerBlocks, upstreamSource } from './autotune.js';
import { parseEnd } from './diagram.js';
import { referenceFn } from './signals.js';
import { IDENTIFY_VERSION, EXPERIMENT, halved } from './experiment.js';

export class IdentifyError extends Error {
  constructor(code, message, hint = '') {
    super(message);
    this.name = 'IdentifyError';
    this.code = code;
    this.hint = hint;
  }
}

// The test's length (plant time, s): the choices the tab offers, and the default.
export const BUDGETS = [30, 60, 120, 300, 600];
export const BUDGET = 120;
// The band's defaults (§2): r's range widened by a third of its span on each
// side; without a span, r₀ ± 10 % of the hard range; clipped to the hard
// range shrunk by 5 % of its span, so the page backs off before the plant
// E-stops.
export const BAND = { widen: 1 / 3, still: 0.1, inset: 0.05 };

const finite = Number.isFinite;

// The diagram level holding the block at path, and the block.
function locate(diagram, path) {
  let level = diagram;
  for (const id of path.slice(0, -1)) level = level.blocks.find((b) => b.id === id)?.diagram;
  return { level, block: level?.blocks.find((b) => b.id === path.at(-1)) };
}

const wiresFrom = (level, id, port = 0) => level.wires.filter((w) => { const e = parseEnd(w.from); return e.id === id && e.port === port; });
const wireTo = (level, id, port) => level.wires.find((w) => { const e = parseEnd(w.to); return e.id === id && e.port === port; });
const sameEnd = (a, b) => a.id === b.id && a.port === b.port;

// A Sink at this level fed from the same output end, or null.
function sinkOn(level, end) {
  for (const w of level.wires) {
    if (!sameEnd(parseEnd(w.from), end)) continue;
    const to = level.blocks.find((b) => b.id === parseEnd(w.to).id);
    if (to?.type === 'sink') return to;
  }
  return null;
}

// u: what the block's output drives. An External plant's input (its name,
// unit, range and safe value), a Sink that shows it (name, unit), or the
// block it feeds.
function uPort(level, block) {
  const out = { name: 'u', unit: '', ext: null, index: -1 };
  for (const w of wiresFrom(level, block.id, 0)) {
    const to = parseEnd(w.to), b = level.blocks.find((x) => x.id === to.id);
    if (b?.type === 'external') { out.ext = b; out.index = to.port; out.name = b.params.inputs?.[to.port] ?? out.name; out.unit = b.params.inUnits?.[to.port] ?? ''; return out; }
  }
  const sink = sinkOn(level, { id: block.id, port: 0 });
  if (sink) { out.name = sink.params.name; out.unit = sink.params.unit ?? ''; }
  return out;
}

// y: what feeds the block's input 2. An External plant's output (name, unit,
// the hard range it declares), or a Sink on the same signal.
function yPort(level, block) {
  const w = wireTo(level, block.id, 1);
  if (!w) return null;
  const from = parseEnd(w.from), b = level.blocks.find((x) => x.id === from.id);
  const out = { name: 'y', unit: '', ext: null, index: -1 };
  if (b?.type === 'external') {
    out.ext = b; out.index = from.port;
    out.name = b.params.outputs?.[from.port] ?? out.name; out.unit = b.params.outUnits?.[from.port] ?? '';
    return out;
  }
  const sink = sinkOn(level, from);
  if (sink) { out.name = sink.params.name; out.unit = sink.params.unit ?? ''; } else if (b) out.name = b.name ?? b.id;
  return out;
}

// A hard range [lo, hi] from two numbers, or null.
const range = (lo, hi) => (finite(lo) && finite(hi) && lo < hi ? [lo, hi] : null);

// What is known without asking (§2), for the Controller block at path (an id
// path, or its key "motor/ctrl"; default the first). describe: the plant's
// answer to `describe` (Live mode), for its output ranges and input kinds.
// link: { connected, estop } on a live plant (the tab's state). Returns
//   { block: { path, key, where }, live,
//     u: { name, unit, min, max, u0, from },
//     y: { name, unit, hard, from },
//     r: { lo, hi, span, source, period, samples, Ts } | null,
//     Ts, others: [{ name, value }] }
// and throws an IdentifyError when Identify cannot run on this block.
export function knownFor(project, path, { describe = null, link = null } = {}) {
  const plant = project?.system?.plant;
  if (plant?.type !== 'diagram') throw new IdentifyError('no-diagram', 'the plant is not a block diagram', 'build the plant in the Plant tab');
  const all = controllerBlocks(plant.diagram);
  if (!all.length) throw new IdentifyError('no-controller', 'there is no Controller block in the plant', 'add a Controller block in the Plant tab: Identify drives the plant through it');
  const key = path ? [].concat(path).join('/') : null;
  const hit = (key && all.find((c) => c.key === key)) || (key ? null : all[0]);
  if (!hit) throw new IdentifyError('no-block', `there is no Controller block ${key}`, 'choose one of the Controller blocks');
  const { level, block } = locate(plant.diagram, hit.path);
  const inputs = block.params.inputs ?? 2;
  if (inputs > 2) throw new IdentifyError('measurements', `Identify is for a block with one measurement (r, y): this one has ${inputs - 1}`, 'MIMO and blocks with several measurements come later');
  if (inputs < 2 || !wireTo(level, block.id, 1)) throw new IdentifyError('unwired', 'wire the measurement to input 2', `${hit.where} reads r on input 1 and the measurement y on input 2`);
  const up = uPort(level, block), yp = yPort(level, block);
  const live = !!(up.ext || yp.ext || hasExternal(plant.diagram));
  if (live) {
    const ext = up.ext ?? yp.ext;
    const kinds = ext?.params.kinds ?? describe?.inputs?.map((p) => p.kind);
    if (up.index >= 0 && kinds?.[up.index] === 'reference') throw new IdentifyError('reference-mode', 'this plant takes references (reference mode): identifying through its own controller comes later', 'Identify needs a plant the page drives with u');
    if (link && link.connected === false) throw new IdentifyError('connect', 'connect the plant first', 'press Connect under Live');
    if (link?.estop) throw new IdentifyError('estop', 'the plant is E-stopped: Reset', 'press Reset under Live');
  }
  // u's range: the running variant's limits, within the External port's.
  const variant = block.variants?.[block.variant ?? 0];
  let umin = finite(variant?.params?.umin) ? variant.params.umin : -Infinity;
  let umax = finite(variant?.params?.umax) ? variant.params.umax : Infinity;
  const fromVariant = finite(umin) || finite(umax);
  let fromPlant = false, safe = null;
  if (up.ext) {
    const p = up.ext.params, j = up.index;
    if (finite(p.min?.[j])) { umin = Math.max(umin, p.min[j]); fromPlant = true; }
    if (finite(p.max?.[j])) { umax = Math.min(umax, p.max[j]); fromPlant = true; }
    if (finite(p.safe?.[j])) safe = p.safe[j];
  }
  if (!finite(umin) || !finite(umax) || !(umax > umin)) {
    throw new IdentifyError('u-range', `set u min and u max in the Controller tab: Identify needs to know how far ${up.name} may go`, 'the running variant\'s u min and u max');
  }
  // u₀: a live plant's safe value; on a simulated plant the running
  // variant's start output u0 (the integral at t = 0, which a person sets so
  // the loop starts in balance: the tank's pump at 0.172 m³/s holds 0.15 m),
  // else 0; held to the range.
  const start = safe ?? (finite(variant?.params?.u0) ? variant.params.u0 : 0);
  const u0 = Math.min(umax, Math.max(umin, start));
  // y's hard range: what the plant declares (describe, or the External block's outMin/outMax, ymin/ymax).
  let hard = null;
  if (yp.ext) {
    const j = yp.index, p = yp.ext.params, d = describe?.outputs?.[j];
    hard = range(d?.min, d?.max) ?? range(p.outMin?.[j], p.outMax?.[j]) ?? range(p.ymin?.[j] ?? p.ymin, p.ymax?.[j] ?? p.ymax);
  }
  const Ts = block.params.Ts;
  // r: the Source feeding input 1, over one period at Ts.
  const source = upstreamSource(plant.diagram, hit.path, 0);
  const signals = project.system.signals ?? {};
  let r = null;
  if (source && signals[source]) {
    const ref = signals[source], period = ref.period;
    const fn = referenceFn(ref, { sampleTime: Ts });
    const N = Math.max(2, Math.round(period / Ts));
    const samples = new Array(N);
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < N; k++) { const v = fn(k * Ts); samples[k] = v; lo = Math.min(lo, v); hi = Math.max(hi, v); }
    r = { lo, hi, span: hi - lo, source, period, samples, Ts };
  }
  // The other inputs, held for the whole test (§2): every other Source at 0,
  // or, where it drives a live plant's input, at that input's safe value.
  const others = Object.keys(signals).filter((n) => n !== source).map((name) => {
    const ext = drivesExternal(plant.diagram, name);
    return ext ? { name, value: ext.block.params.safe?.[ext.port] ?? 0, input: ext.block.params.inputs?.[ext.port] ?? null } : { name, value: 0 };
  });
  return {
    block: { path: hit.path, key: hit.key, where: hit.where }, live,
    u: { name: up.name, unit: up.unit, min: umin, max: umax, u0, from: fromPlant && fromVariant ? 'both' : fromPlant ? 'plant' : 'controller', start: safe !== null ? 'plant' : finite(variant?.params?.u0) && variant.params.u0 !== 0 ? 'controller' : null },
    y: { name: yp.name, unit: yp.unit, hard, from: hard ? 'plant' : null },
    r, Ts, others,
  };
}

// The External plant input a Source drives directly (at any level), or null.
function drivesExternal(d, signal) {
  for (const b of d?.blocks ?? []) {
    if (b.type === 'source' && b.params.signal === signal) {
      for (const w of wiresFrom(d, b.id, 0)) {
        const to = parseEnd(w.to), x = d.blocks.find((y) => y.id === to.id);
        if (x?.type === 'external') return { block: x, port: to.port };
      }
    }
    if (b.type === 'subsystem') { const hit = drivesExternal(b.diagram, signal); if (hit) return hit; }
  }
  return null;
}

function hasExternal(d) {
  for (const b of d?.blocks ?? []) {
    if (b.type === 'external') return true;
    if (b.type === 'subsystem' && hasExternal(b.diagram)) return true;
  }
  return false;
}

// The band's default (§2) and where it came from: 'r' (r's range widened by
// a third), 'plant' (r₀ ± 10 % of the hard range), or null when the page knows
// no range for y. hard: the plant's, or the tester's.
export function defaultBand(known, hard = known.y.hard) {
  const r = known.r;
  let band = null, from = null;
  if (r && r.span > 1e-12 * Math.max(1, Math.abs(r.lo), Math.abs(r.hi))) {
    band = [r.lo - BAND.widen * r.span, r.hi + BAND.widen * r.span];
    from = 'r';
  } else if (hard) {
    const r0 = r ? r.lo : (hard[0] + hard[1]) / 2, w = BAND.still * (hard[1] - hard[0]);
    band = [r0 - w, r0 + w];
    from = 'plant';
  }
  if (band && hard) {
    const inset = BAND.inset * (hard[1] - hard[0]);
    band = [Math.max(band[0], hard[0] + inset), Math.min(band[1], hard[1] - inset)];
    if (!(band[1] > band[0])) band = null;
  }
  return { band, from };
}

// The settings (§2, §9): the stored design inputs, or their defaults, each
// with where it came from. stored: system.identify[key] of the project (or
// given). Returns { band: { value, from }, budget: { value, from },
// hard: { value, from }, vary, structure, seed }.
export function identifySettings(project, path, opts = {}) {
  const known = opts.known ?? knownFor(project, path, opts);
  const stored = opts.stored ?? project?.system?.identify?.[known.block.key] ?? {};
  return settingsFor(known, stored);
}

export function settingsFor(known, stored = {}) {
  const hardMine = range(stored.hard?.[0], stored.hard?.[1]);
  const hard = known.y.hard ? { value: known.y.hard, from: 'plant' } : hardMine ? { value: hardMine, from: 'yours' } : { value: null, from: null };
  const mine = range(stored.band?.[0], stored.band?.[1]);
  const def = defaultBand(known, hard.value);
  const band = mine ? { value: mine, from: 'yours' } : { value: def.band, from: def.from };
  const budget = finite(stored.budget) && stored.budget > 0 ? { value: stored.budget, from: 'yours' } : { value: BUDGET, from: 'default' };
  return { band, budget, hard, vary: stored.vary ?? null, structure: stored.structure ?? null, seed: finite(stored.seed) ? stored.seed : 1 };
}

// The plan of the experiment (§3, §5): data the experiment runs on, in the
// page, in the live worker and in Node. settings: identifySettings' result,
// or plain values { band, budget, hard, seed }. Throws an IdentifyError when
// the test cannot run as set.
export function planExperiment(known, settings = {}) {
  const val = (s) => (s && typeof s === 'object' && !Array.isArray(s) && 'value' in s ? s.value : s);
  const yName = known.y.name, unit = known.y.unit ? ` ${known.y.unit}` : '';
  const hard = val(settings.hard) ?? known.y.hard ?? null;
  let band = val(settings.band);
  if (band === undefined || band === null) band = defaultBand(known, hard).band;
  if (!band) throw new IdentifyError('no-band', `the page knows no range for ${yName}: say how far it may move`, `fill in "${yName} may move within"`);
  band = [Number(band[0]), Number(band[1])];
  if (!(finite(band[0]) && finite(band[1]) && band[1] > band[0])) throw new IdentifyError('band', `"${yName} may move within" needs a low and a high end, low below high`);
  if (hard && (band[0] < hard[0] || band[1] > hard[1])) {
    const end = band[1] > hard[1] ? `reaches ${fmt(band[1])}${unit}, beyond ${fmt(hard[1])}` : `reaches ${fmt(band[0])}${unit}, beyond ${fmt(hard[0])}`;
    throw new IdentifyError('band-hard', `'may move within' ${end}, where the plant stops itself`, 'keep it inside the plant\'s range');
  }
  const r = known.r;
  if (r) {
    if (r.hi > band[1]) throw new IdentifyError('r-band', `r leaves 'may move within' (r reaches ${fmt(r.hi)}, the band ends at ${fmt(band[1])})`, 'widen the band or change r in the Input tab');
    if (r.lo < band[0]) throw new IdentifyError('r-band', `r leaves 'may move within' (r reaches ${fmt(r.lo)}, the band starts at ${fmt(band[0])})`, 'widen the band or change r in the Input tab');
  }
  const budget = val(settings.budget) ?? BUDGET;
  if (!(finite(budget) && budget > 0)) throw new IdentifyError('budget', 'the test needs a length: 30 s, 1, 2, 5 or 10 min');
  const span = band[1] - band[0];
  // The test reference: the tester's r over one period, or a staircase when
  // r moves less than 10 % of the band (built by the experiment once it knows
  // the plant's time scale).
  const moves = r && r.span >= EXPERIMENT.ease.staircase * span;
  const r0 = r ? r.samples[0] : (band[0] + band[1]) / 2;
  if (!r && !(r0 >= band[0] && r0 <= band[1])) throw new IdentifyError('band', 'the band holds no reference');
  return {
    version: IDENTIFY_VERSION, kind: 'identify',
    Ts: known.Ts, u0: known.u.u0, umin: known.u.min, umax: known.u.max,
    band, hard, budget, seed: val(settings.seed) ?? 1,
    names: { u: known.u.name, uUnit: known.u.unit, y: known.y.name, yUnit: known.y.unit },
    // The Check (§5.7): the test reference with its steps halved about the
    // middle; for a staircase the experiment builds both.
    test: moves ? { r: r.samples.slice() } : { r0 },
    check: moves ? { r: halved(r.samples) } : null,
    others: known.others.map((o) => ({ ...o })),
  };
}

function fmt(v) {
  if (!finite(v)) return String(v);
  return String(Number(v.toPrecision(3)));
}
