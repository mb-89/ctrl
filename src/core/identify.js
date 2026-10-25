// Identify (design/output/identification.md): what the page knows about a
// Controller block's loop without asking (knownFor), the two things it asks
// with their defaults (identifySettings), and the plan of the experiment
// (planExperiment), which the experiment (experiment.js) runs as data (§2–§5);
// the model from the experiment's record (identifySteps: segments replayed in
// closed loop, the structures fitted and chosen on the Check, the grade, a
// model that changes by place, the sentences, §6–§8); the model as a linear
// model and as blocks (linearModel, twinSubsystem, §10, §12); a hidden
// variation of a simulated plant (varyDiagram, §13); and the whole test in
// Node (identify, §16). Every reason it cannot run is an IdentifyError with a
// sentence and a hint, as Auto-tune gives them.
//
// Nothing here is stored but the record, on Keep: the settings are design
// inputs, the plan is recomputed from them and the project whenever a test
// starts, and the model from the record whenever it is needed.

import { controllerBlocks, upstreamSource, drain } from './autotune.js';
import { parseEnd, ELEMENTS, diagramBlockDef, compileDiagram, normalizeDiagram } from './diagram.js';
import { CONTROLLERS } from './controllers.js';
import { referenceFn, gaussAt } from './signals.js';
import { IDENTIFY_VERSION, EXPERIMENT, LENGTHS, halved, piLaw, pidLaw, bumpless, fmtNum, budgetText, discriminationSignal, excitationOf, tryCost, tryMargin } from './experiment.js';
import {
  STRUCTURES, CHOICE, discretise, discretiseSS, LOG_BOUND, simulateSegment, fitStructureSteps, lmSteps, observations, noiseTransfer, parameterCov, chooseStructure, unsupported, convolve, noiseColour,
  fitPercent, noiseCeiling, whiteness, crossCorrelation, tcKernelSteps, kernelStep, kernelGuess, seeded, frf,
} from './fit.js';
import { cholesky, eig, solve, csolve } from './linalg.js';
import { pathRealisation } from './linearize.js';
import { createStepRunner } from './live.js';
import { loopModel, linearizeBlock } from './project.js';
import { analyzeLoop, discretePlant } from './analysis.js';
import { physicalMaskKeys } from './physics.js';

export class IdentifyError extends Error {
  constructor(code, message, hint = '') {
    super(message);
    this.name = 'IdentifyError';
    this.code = code;
    this.hint = hint;
  }
}

// The test's length (plant time, s): the choices the tab offers, and the default.
export const BUDGETS = LENGTHS;
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
//     u: { name, unit, min, max, u0, from, start },
//     y: { name, unit, hard, from },
//     r: { lo, hi, span, source, period, samples, Ts } | null,
//     Ts, others: [{ name, value, input? }] }
// u.start says where u₀ came from ('plant': the port's safe value;
// 'controller': the running variant's start output; null: 0); an other
// input that drives a live plant's input names it (input).
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
    const kinds = describe?.inputs?.map((p) => p.kind) ?? ext?.params.kinds;
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
  // the loop starts in balance), or the one its design computed from the
  // plant (a PI from the plant: the tank's pump holding 0.15 m), else 0;
  // held to the range.
  const own = safe === null ? variantStart(plant.diagram, hit.key, variant) : null;
  const start = safe ?? own ?? 0;
  const u0 = Math.min(umax, Math.max(umin, start));
  // y's hard range: what the plant declares, beyond which it E-stops
  // (describe's hard_min … hard_max, kept in the External block as ymin,
  // ymax). An output's min … max (the block's outMin, outMax) is its full
  // scale, what the scope spans, and never the hard range (§15).
  let hard = null;
  if (yp.ext) {
    const j = yp.index, p = yp.ext.params, d = describe?.outputs?.[j];
    hard = range(d?.hard_min, d?.hard_max) ?? range(p.ymin?.[j], p.ymax?.[j]);
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
    u: { name: up.name, unit: up.unit, min: umin, max: umax, u0, from: fromPlant && fromVariant ? 'both' : fromPlant ? 'plant' : 'controller', start: safe !== null ? 'plant' : own !== null && own !== 0 ? 'controller' : null },
    y: { name: yp.name, unit: yp.unit, hard, from: hard ? 'plant' : null },
    r, Ts, others,
  };
}

// The start output of a Controller block's running variant: its u0, or, for
// a designed variant, the u0 its design computes from the plant (read from a
// compile of the diagram, as a run makes it). null when it has none, or
// when the design cannot give one now.
function variantStart(diagram, key, variant) {
  if (finite(variant?.params?.u0)) return variant.params.u0;
  if (!CONTROLLERS[variant?.type]?.designed || !(CONTROLLERS[variant.type].computes ?? []).includes('u0')) return null;
  try {
    const el = compileDiagram(normalizeDiagram(structuredClone(diagram)), 'plant', { standalone: true, sources: new Proxy({}, { get: () => () => 0 }) });
    const st = el.designs.find((x) => [].concat(x.path).join('/') === key);
    return finite(st?.values?.u0) ? st.values.u0 : null;
  } catch { return null; }
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

// ---- The model from the record (§6–§8)
//
// The model is a pure function of the record (and the plan it ran): the same
// record gives the same model, bit for bit. identifySteps cuts the record into
// segments that start at rest, fits the structures of §6.2 by replaying the
// closed loop with the law the experiment logged (fit.js), grades each on the
// Check, chooses, refits the chosen one per place, and says what it found in
// sentences.

const nan = (v) => (v === null || v === undefined ? NaN : v);

// The record as Keep stores it (§9): u, r and the applied u to 6 significant
// digits, y to a tenth of its noise floor (Listen's). Identify computes its
// model from this form, so a kept record gives the model the run gave.
export function compactRecord(record) {
  const L = record.log?.find((e) => e.kind === 'listen');
  const dec = L?.floor > 0 ? Math.max(0, Math.min(15, Math.ceil(-Math.log10(L.floor / 10)))) : null;
  const sig = (v) => (v === null || v === undefined || !finite(v) ? null : Number(v.toPrecision(6)) + 0);
  const yv = (v) => (v === null || v === undefined || !finite(v) ? null : dec === null ? v + 0 : Number(v.toFixed(dec)) + 0);
  return { ...record, u: record.u.map(sig), y: record.y.map(yv), r: record.r.map(sig), applied: (record.applied ?? []).map(sig) };
}

// The step of the grid y moves on (an encoder's count) over the first F
// samples, or 0: the smallest change above the grid Keep rounds y to, when
// nine in ten changes are whole multiples of it.
function encoderStep(record, F, L) {
  const dec = L.floor > 0 ? Math.max(0, Math.min(15, Math.ceil(-Math.log10(L.floor / 10)))) : 15;
  const tol = 0.6 * 10 ** -dec;
  const d = [];
  for (let j = 1; j < F; j++) { const a = nan(record.y[j]), b = nan(record.y[j - 1]); if (finite(a) && finite(b) && Math.abs(a - b) > 2 * tol) d.push(Math.abs(a - b)); }
  if (d.length < 20) return 0;
  const q = Math.min(...d);
  const on = d.filter((x) => Math.abs(x - q * Math.round(x / q)) <= 2 * tol * Math.max(1, Math.round(x / q))).length;
  return on >= 0.9 * d.length ? q : 0;
}

// The log's entries, by kind.
function readLog(record) {
  const log = record.log ?? [];
  const one = (kind) => log.find((e) => e.kind === kind) ?? null;
  const all = (kind) => log.filter((e) => e.kind === kind);
  return {
    listen: one('listen'), rungs: all('rung'), look: one('look'), laws: all('law'), tries: all('try'), ladder: one('ladder'),
    // The fitting data end at the last fit pause (after the Shake, when it ran).
    supply: all('supply').filter((e) => (e.what ?? 'fit') === 'fit').at(-1) ?? null, pause: one('pause'), check: one('check'), discriminate: one('discriminate'), shakes: all('shake'), end: one('end'), notes: all('note'),
  };
}

// The law entry a replay needs: the PI's gains and limits.
const lawOf = (e) => ({ Kp: e.Kp, Ki: e.Ki, umin: e.umin, umax: e.umax, role: e.role, i: e.i });

// The mean of y and u over the w samples before a (the rest a segment starts from).
function restBefore(record, a, w) {
  let sy = 0, su = 0, n = 0;
  for (let j = Math.max(0, a - w); j < a; j++) {
    const y = nan(record.y[j]), u = nan(record.u[j]);
    if (finite(y) && finite(u)) { sy += y; su += u; n++; }
  }
  if (n) return { y: sy / n, u: su / n, n };
  return { y: nan(record.y[a]), u: nan(record.u[Math.max(0, a - 1)]), n: 0 };
}

// A closed-loop segment [a, b): the rest before it, the law running before
// it, and every switch inside it.
// excites: the log's entries of what was added to the law's output (a Shake
// place, the test that tells two shapes apart), with the limits u was held to.
function closedSegment(record, laws, a, b, w, role, { excites = [], limits = null } = {}) {
  const rest = restBefore(record, a, w);
  let before = null;
  for (const e of laws) if (e.i < a) before = e;
  const ex = excites.filter((e) => e && e.iStart < b && e.iEnd > a);
  return {
    kind: 'closed', role, i0: a, i1: b, yStart: rest.y, uStart: rest.u, rPrev: nan(record.r[Math.max(0, a - 1)]),
    before: before ? lawOf(before) : null, switches: laws.filter((e) => e.i >= a && e.i < b).map(lawOf),
    ...(ex.length ? { excites: ex, limits } : {}),
  };
}

// The tolerance a held y counts as settled within (the Hold's, §5.3).
const settleTol = (L, span) => Math.max(EXPERIMENT.hold.sigmas * L.sigma, EXPERIMENT.hold.bandShare * span, EXPERIMENT.hold.steps * L.q);

// The record's segments (§6.1): each runs from a settled point to the next.
//   open     the Nudge and the rest after it (u as applied, drift taken out)
//   closed   the Hold, then each try from its settle to the next one's, up
//            to the fit pause (the data the model is fitted to)
//   check    the Check, from the settled pause: graded, never fitted
//   holds    where y stood still and the u that held it there (Where, §6.6)
// upto: the last sample fitted (the fit pause's start; default the supply's).
export function segmentsOf(record, plan, { upto = null } = {}) {
  const Ts = record.Ts, n = record.y.length;
  const g = readLog(record);
  const L = g.listen;
  const F = Math.max(0, Math.min(n, upto ?? g.supply?.upto ?? n));
  const w = Math.max(1, Math.ceil(EXPERIMENT.hold.settle / Ts - 1e-9));
  const out = { F, w, listen: L, rungs: g.rungs, look: g.look, open: null, closed: [], check: null, holds: [], levels: [] };
  if (!L || !g.rungs.length) return out;
  const iL = L.i1 - 1;
  const hold = g.laws.find((e) => e.role === 'hold') ?? null;
  const iHold = hold ? hold.i : F;
  const exOpts = { excites: [...g.shakes, g.discriminate].filter(Boolean), limits: [plan.umin, plan.umax] };
  const o0 = g.rungs[0].i0, o1 = Math.min(iHold, F);
  if (o1 - o0 > 2) out.open = { kind: 'open', role: 'nudge', i0: o0, i1: o1, yStart: L.y0 + L.slope * (o0 - iL), uStart: plan.u0, slope: L.slope, iL, level: L.y0 };
  if (hold && iHold < F) {
    // Each try from its settle, and each Shake place from where its tones start.
    const cuts = [iHold, ...g.tries.filter((T) => T.settled && T.iSwitch > iHold && T.iSwitch < F).map((T) => T.iSwitch), ...g.shakes.filter((e) => e.iStart > iHold && e.iStart < F).map((e) => e.iStart)].sort((x, y) => x - y);
    cuts.forEach((a, j) => {
      const b = j + 1 < cuts.length ? cuts[j + 1] : F;
      if (b - a > 2) out.closed.push(closedSegment(record, g.laws, a, b, w, j === 0 ? 'hold' : g.shakes.some((e) => e.iStart === a) ? 'shake' : 'try', exOpts));
    });
  }
  const band = plan.band, span = band[1] - band[0];
  const tol = settleTol(L, span);
  // y held within the tolerance of r for the w samples before a: its rest.
  const settledAt = (a) => {
    if (a - w < 0) return null;
    const ref = nan(record.r[a - 1]);
    for (let j = a - w; j < a; j++) { const y = nan(record.y[j]); if (!finite(y) || Math.abs(y - ref) >= tol || nan(record.r[j]) !== ref) return null; }
    return restBefore(record, a, w);
  };
  // The Check is replayed from the last point where y was at rest: its
  // reference's start when the incumbent settled y there, else the pause's
  // end, else the last settled point fitted (a plant slower than the pause,
  // an oven cooling with its heater off). It is graded from `from` on.
  const ck = g.check ? { i0: g.check.i0, iStart: g.check.iStart, i1: g.check.iEnd, left: false } : g.end?.check ? { i0: g.end.check.i0, iStart: g.end.check.iStart, i1: g.end.i, left: true } : null;
  if (ck && ck.i1 - ck.i0 > 2) {
    const start = [ck.iStart, ck.i0].find((a) => finite(a) && a < ck.i1 - 2 && settledAt(a)) ?? out.closed.at(-1)?.i0 ?? ck.i0;
    const rest = settledAt(start);
    const c = closedSegment(record, g.laws, start, ck.i1, w, 'check', exOpts);
    out.check = { ...c, ...(rest ? { yStart: rest.y, uStart: rest.u } : {}), from: start >= ck.i0 ? start : ck.i0, left: ck.left };
  }
  // Where's hold curve (§6.6): where y stood still under the loop (its range
  // within the settling tolerance over the w samples before a reference step,
  // or before the fitting ends), the mean y and the mean u that held it there;
  // and Listen's rest (y₀ at u₀).
  out.holds.push({ y: L.y0, u: plan.u0, at: L.i1, n: L.i1 - L.i0 });
  const still = (a) => {
    if (a - w < 0) return null;
    let lo = Infinity, hi = -Infinity, sy = 0, su = 0;
    const ref = nan(record.r[a - 1]);
    for (let j = a - w; j < a; j++) {
      const y = nan(record.y[j]), u = nan(record.u[j]);
      if (!finite(y) || !finite(u) || nan(record.r[j]) !== ref) return null;
      lo = Math.min(lo, y); hi = Math.max(hi, y); sy += y; su += u;
    }
    return hi - lo <= tol && Math.abs(sy / w - ref) <= tol ? { y: sy / w, u: su / w, at: a, n: w } : null;
  };
  let rLo = Infinity, rHi = -Infinity;
  for (const seg of out.closed) for (let j = seg.i0; j < seg.i1; j++) { const r = nan(record.r[j]); if (finite(r)) { rLo = Math.min(rLo, r); rHi = Math.max(rHi, r); } }
  const R = rHi - rLo;
  // The levels the test visited: y₀ and every level r held in closed loop.
  out.levels = [L.y0];
  for (const seg of out.closed) for (let j = seg.i0; j < seg.i1; j++) { const r = nan(record.r[j]); if (finite(r) && (j === seg.i0 || r !== nan(record.r[j - 1]))) out.levels.push(r); }
  for (const seg of out.closed) {
    const ends = [];
    for (let j = seg.i0 + 1; j < seg.i1; j++) if (R > 0 && Math.abs(nan(record.r[j]) - nan(record.r[j - 1])) > EXPERIMENT.ease.stepShare * R) ends.push(j);
    ends.push(seg.i1);
    for (const a of ends) { const h = a - w >= seg.i0 ? still(a) : null; if (h) out.holds.push(h); }
  }
  return out;
}

// A segment as fit.js replays it: y (NaN where nothing was measured or a
// lost cycle is put back), yStart, uStart, the weight 1/floor², and u (open
// loop: as applied, held over a gap) or the law (closed loop: the logged PI,
// its switches bumpless and fed the model's own y, held over a gap).
function fitSegment(record, seg, L, Ts) {
  const gaps = new Map((record.gaps ?? []).map(([i, len]) => [i, len]));
  const ys = [], us = [], rs = [], idx = [];
  for (let i = seg.i0; i < seg.i1; i++) {
    const lost = i > seg.i0 ? gaps.get(i) ?? 0 : 0;
    for (let j = 0; j < lost; j++) { ys.push(NaN); us.push(us.length ? us.at(-1) : seg.uStart); rs.push(rs.length ? rs.at(-1) : nan(record.r[i])); idx.push(-1); }
    let y = nan(record.y[i]);
    if (seg.kind === 'open' && finite(y)) y -= seg.slope * (i - seg.iL);
    const ap = nan(record.applied?.[i]);
    ys.push(y); us.push(finite(ap) ? ap : nan(record.u[i])); rs.push(nan(record.r[i])); idx.push(i);
  }
  const N = ys.length;
  const out = { y: Float64Array.from(ys), yStart: seg.yStart, uStart: seg.uStart, weight: 1 / (L.floor * L.floor), Ts, idx };
  if (seg.kind === 'open') {
    for (let k = 0; k < N; k++) if (!finite(us[k])) us[k] = k ? us[k - 1] : seg.uStart;
    out.u = Float64Array.from(us);
    return out;
  }
  // The law switches at these samples (k of the segment).
  const at = new Map();
  for (const e of seg.switches) { const k = idx.indexOf(e.i); if (k >= 0) at.set(k, e); }
  const hold = ys.map((y) => !finite(y));
  const r = Float64Array.from(rs);
  const before = seg.before;
  // What was added to the law's output (the Shake's tones, the test that
  // tells two shapes apart), rebuilt from the log, as the experiment played it.
  const exs = (seg.excites ?? []).map((e) => excitationOf(e, Ts)).filter(Boolean);
  const [uLo, uHi] = seg.limits ?? [-Infinity, Infinity];
  const added = (i) => { let v = 0; for (const x of exs) { const j = i - x.from; if (j >= 0 && j < x.values.length) v += x.values[j]; } return v; };
  out.law = () => {
    let law = before ? piLaw(before, bumpless(before, seg.uStart, seg.rPrev, seg.yStart), before.umin, before.umax, Ts) : null;
    let uLast = seg.uStart;
    return (k, yh) => {
      if (hold[k]) return uLast;
      const e = at.get(k);
      if (e) law = piLaw(e, bumpless(e, uLast, r[k], yh), e.umin, e.umax, Ts);
      let u = law ? law.step(r[k], yh) : uLast;
      if (exs.length && law && idx[k] >= 0) u = Math.min(uHi, Math.max(uLo, u + added(idx[k])));
      uLast = u;
      return u;
    };
  };
  return out;
}

// The model's y over a segment of the record (a descriptor from segmentsOf),
// replayed at rest from its start (§6.1). model: { structure, params } (an
// IdentifiedModel, or a candidate).
export function replay(record, model, segment) {
  const L = readLog(record).listen;
  const fs = fitSegment(record, segment, L, record.Ts);
  return simulateSegment(discretise(model.structure, model.params ?? model.p, record.Ts), fs).y;
}

// A regularised impulse response (fit.js tcKernel) replayed over a segment
// the same way: y = yStart + Σ g_i ū_i (+ the rate, integrating), the law fed
// the kernel's own y. For the kernel ceiling (§6.8).
function kernelReplay(kernel, fs) {
  const N = fs.y.length, D = kernel.decimate, n = kernel.n;
  const rate = kernel.integrating ? kernel.rate?.value ?? 0 : 0;
  const gt = Float64Array.from(kernel.g, (v) => v - D * rate);
  const S = new Float64Array(N + 1), yh = new Float64Array(N);
  const law = fs.law ? fs.law() : null;
  for (let k = 0; k < N; k++) {
    let yk = fs.yStart + rate * S[k];
    for (let i = 1; i <= n; i++) {
      const top = k - (i - 1) * D - 1;
      if (top < 0) break;
      yk += (gt[i - 1] * (S[top + 1] - S[Math.max(0, k - i * D)])) / D;
    }
    yh[k] = yk;
    const u = law ? law(k, yk) : fs.u[k];
    S[k + 1] = S[k] + (u - fs.uStart);
  }
  return yh;
}

// ---- Where: the structure refitted per place (§6.6)
//
// A plant like the conical tank or the arm has a different gain and time
// scale at each place; one linear model is a compromise. Where refits the
// chosen structure with its gain and main time scale per place: the places
// are the low, middle and high thirds of the levels the test visited, and
// the model switches by where its own y is. So that switching is physics, the
// restoring part of the model is written through the hold curve u*(y), the u
// that holds y still: for a linear model u*(y) = uStart + (y − yStart)/K, and
// ẋ = A x + B (u − uStart) is ẋ = (A + b C) x + b K (u − u*(y)), b = B/K. Per
// place A, b and K are the place's, and u*(y) is continuous with slope 1/K
// there, so the model holds y where the plant does and is the place's linear
// model near each level (the tank: q = a√(2gh) holds h, and its gain and time
// constant are each level's). θ, ζ (and a second lag) are the main fit's. An
// integrating structure holds anywhere with the same u: only its rate and
// time scale change by place.

// A structure's continuous model at p in the form above: A' = A + b C (or A
// for an integrator), b K as the input, discretised with its dead time exact
// (as fit.js discretise).
function placeModel(structure, p, Ts) {
  const S = STRUCTURES[structure];
  const { A, B, C } = S.ss(p);
  const gain = p[GAIN(S)];
  const Ap = S.integrating ? A : A.map((row, i) => row.map((v, j) => v + (B[i][0] / gain) * C[0][j]));
  const { n, Phi, G0, G1, m } = discretiseSS(Ap, B, p.theta ?? 0, Ts);
  return { n, Phi: Float64Array.from(Phi.flat()), G0: Float64Array.from(G0), G1: Float64Array.from(G1), C: Float64Array.from(C[0]), m, gain, integrating: S.integrating };
}

// The replay of a segment with the model switching by place: places[g] the
// discretised model of place g, edges the two levels between the thirds. The
// hold curve u*(y) is anchored at the segment's rest (uStart at yStart) and
// has slope 1/K of the place it crosses.
function placeReplay(places, edges, seg) {
  const N = seg.y.length, n = places[0].n, m = places[0].m;
  const yS = seg.yStart, uS = seg.uStart;
  const placeOf = (y) => (y < edges[0] ? 0 : y < edges[1] ? 1 : 2);
  // u*(y): ∫ from yStart of dy / K(y), K by place, piecewise.
  const bounds = [-Infinity, edges[0], edges[1], Infinity];
  const hold = (y) => {
    if (places[0].integrating) return uS;
    let u = uS;
    const lo = Math.min(yS, y), hi = Math.max(yS, y), sgn = y >= yS ? 1 : -1;
    for (let g = 0; g < 3; g++) {
      const a = Math.max(lo, bounds[g]), b = Math.min(hi, bounds[g + 1]);
      if (b > a) u += (sgn * (b - a)) / places[g].gain;
    }
    return u;
  };
  const law = seg.law ? seg.law() : null;
  const yh = new Float64Array(N);
  const L = m + 2, hist = new Float64Array(L);
  let x = new Float64Array(n), xn = new Float64Array(n);
  const C = places[0].C;   // the same for every place: y is a state
  for (let k = 0; k < N; k++) {
    let yk = yS;
    for (let i = 0; i < n; i++) yk += C[i] * x[i];
    const P = places[placeOf(yk)];
    yh[k] = yk;
    const u = law ? law(k, yk) : seg.u[k];
    hist[k % L] = u;
    const ust = hold(yk);
    const a = (k - m >= 0 ? hist[(k - m) % L] : uS) - ust, b = (k - m - 1 >= 0 ? hist[(k - m - 1) % L] : uS) - ust;
    for (let i = 0; i < n; i++) {
      let s = P.G0[i] * a + P.G1[i] * b;
      const o = i * n;
      for (let j = 0; j < n; j++) s += P.Phi[o + j] * x[j];
      xn[i] = s;
    }
    const t = x; x = xn; xn = t;
  }
  return yh;
}

// The refit per place (§6.6): the gain and the main time scale of each third
// of the levels visited, the rest held at the main fit, by Levenberg–
// Marquardt on every fitting segment. A place the test only passed through is
// still fitted (its bars say how little it was seen). Returns [{ level, from,
// to, gain, gainSd, scale, scaleSd, scaleKey, samples }] or null.
function* placeFit(fsegs, structure, p, cov, levels, Ts, hNoise) {
  const S = STRUCTURES[structure];
  const gk = GAIN(S), sk = SCALE[structure];
  const lo = Math.min(...levels), hi = Math.max(...levels);
  if (!(hi > lo)) return null;
  const edges = [lo + (hi - lo) / 3, lo + (2 * (hi - lo)) / 3];
  const sign = p[gk] < 0 ? -1 : 1;
  const toPlaces = (q) => [0, 1, 2].map((g) => placeModel(structure, { ...p, [gk]: sign * Math.exp(q[g]), [sk]: Math.exp(q[3 + g]) }, Ts));
  const N = fsegs.reduce((a, sg) => a + Math.max(0, sg.y.length - 1), 0);
  const residual = (q) => {
    const places = toPlaces(q), out = new Float64Array(N);
    let o = 0;
    for (const sg of fsegs) {
      const yh = placeReplay(places, edges, sg);
      const w = Math.sqrt(sg.weight ?? 1);
      for (let k = 1; k < sg.y.length; k++) out[o++] = finite(sg.y[k]) ? w * (sg.y[k] - yh[k]) : 0;
    }
    return out;
  };
  const q0 = [0, 1, 2].map(() => Math.log(Math.abs(p[gk]))).concat([0, 1, 2].map(() => Math.log(p[sk])));
  let res;
  try { res = yield* lmSteps(residual, q0, { maxIter: 40, lower: q0.map(() => -LOG_BOUND), upper: q0.map(() => LOG_BOUND) }); } catch { return null; }
  const nObs = observations(fsegs);
  const parts = fsegs.map((sg, i) => ({ length: Math.max(0, sg.y.length - 1), h: hNoise[i] }));
  const cq = parameterCov(res.J, res.A, parts, res.cost / Math.max(1, nObs - 6));
  // How many samples the model spent in each place (at the fit).
  const places = toPlaces(res.p);
  const count = [0, 0, 0];
  for (const sg of fsegs) { const yh = placeReplay(places, edges, sg); for (let k = 0; k < yh.length; k++) count[yh[k] < edges[0] ? 0 : yh[k] < edges[1] ? 1 : 2]++; }
  const bounds = [lo, edges[0], edges[1], hi];
  return [0, 1, 2].map((g) => ({
    level: (bounds[g] + bounds[g + 1]) / 2, from: bounds[g], to: bounds[g + 1],
    gain: sign * Math.exp(res.p[g]), gainSd: cq ? Math.exp(res.p[g]) * Math.sqrt(Math.max(0, cq[g][g])) : null,
    scale: Math.exp(res.p[3 + g]), scaleSd: cq ? Math.exp(res.p[3 + g]) * Math.sqrt(Math.max(0, cq[3 + g][3 + g])) : null,
    scaleKey: sk, samples: count[g],
  }));
}

// How the grade is given (§7); thresholds in %, the where-spread as a share.
// seen: a place counts toward "behaves differently" when the model spent
// this share of its time there (its bars must still part the places).
export const GRADE = { good: 85, ceiling: 3, fair: 60, distortion: [10, 30], where: 0.25, seen: 0.05, kernel: 5 };

// The grade and its reasons (§7): ✓, ! or ✕; grades inform and never block.
// coloured: the noise at rest is itself not white (Listen), so a pattern in
// what is left may be the noise's own.
export function gradeOf({ fit, ceiling = -Infinity, white = true, coloured = false, distortion = null, spread = 0, kernelGap = 0, left = false, checked = true }) {
  const why = [];
  if (left) return { mark: '✕', why: ['the Check left the band'] };
  if (!finite(fit) || fit < GRADE.fair) why.push(`it explains under ${GRADE.fair} %`);
  if (distortion !== null && distortion > GRADE.distortion[1]) why.push(`${Math.round(distortion)} % of the response is not linear`);
  if (why.length) return { mark: '✕', why };
  if (!(fit >= GRADE.good || fit >= ceiling - GRADE.ceiling)) why.push(`it explains under ${GRADE.good} %`);
  if (distortion !== null && distortion >= GRADE.distortion[0]) why.push(`${Math.round(distortion)} % of the response is not linear`);
  if (spread >= GRADE.where) why.push('it behaves differently at different places');
  if (!white) why.push(coloured ? 'what is left has a pattern, as the noise at rest has' : 'what is left has a pattern');
  if (kernelGap >= GRADE.kernel) why.push('the shapes on offer miss something here');
  if (!checked) why.push('no Check ran');
  return { mark: why.length ? '!' : '✓', why };
}

// The structure's gain and main time scale (refitted per place, §6.6).
const GAIN = (S) => (S.integrating ? 'kp' : 'K');
const SCALE = { lag: 'tau', lags: 'tau1', resonance: 'f', intLag: 'tau', intRes: 'f' };

// Seeded parameter samples about a fit (§6.5, the bands): drawn in the
// coordinates the fit works in (logs, θ in samples) from its covariance.
function parameterSamples(structure, p, cov, Ts, count = 50, seed = 1) {
  const S = STRUCTURES[structure];
  if (!cov) return [];
  const kinds = S.params.map((k) => (k === 'theta' ? 'delay' : 'log'));
  const d = S.params.map((k, j) => (kinds[j] === 'delay' ? Ts : Math.abs(p[k])));
  const C = cov.map((row, i) => row.map((v, j) => v / (d[i] * d[j])));
  let Lc;
  try { Lc = cholesky(C.map((row, i) => row.map((v, j) => v + (i === j ? 1e-14 * Math.max(1e-300, C[i][i]) : 0)))); } catch { return []; }
  const out = [];
  for (let s = 0; s < count; s++) {
    const z = S.params.map((_, j) => gaussAt(seed, s * S.params.length + j));
    const q = S.params.map((_, i) => Lc[i].reduce((a, v, j) => (j <= i ? a + v * z[j] : a), 0));
    out.push(Object.fromEntries(S.params.map((k, j) => [k, kinds[j] === 'delay' ? Math.max(0, p[k] + q[j] * Ts) : p[k] * Math.exp(q[j])])));
  }
  return out;
}

// The time (s) a model's step response takes to stay within 2 % of its end
// (a settling model), from its exact discretisation.
function settlingTime(structure, p, Ts) {
  const S = STRUCTURES[structure];
  if (S.integrating) return null;
  const slow = Math.max(...S.times(p)) + (p.theta ?? 0);
  const dt = Math.max(Ts, slow / 400);
  const d = discretise(structure, p, dt);
  const N = Math.ceil((10 * slow) / dt) + 2;
  const { y } = simulateSegment(d, { u: new Float64Array(N).fill(1), yStart: 0, uStart: 0, n: N });
  const fin = p.K;
  let last = 0;
  for (let k = 0; k < N; k++) if (Math.abs(y[k] - fin) > 0.02 * Math.abs(fin)) last = k + 1;
  return last * dt;
}

// A number with its ±2σ bar, rounded to the digits the bar allows (§8):
// 0.534 ± 0.0213 → "0.53 ± 0.04"; without a bar, three significant digits.
export function withBar(v, sd) {
  if (!finite(v)) return String(v);
  const b = 2 * (sd ?? 0);
  if (!(b > 0) || !finite(b)) return fmtNum(v, 3);
  let e = Math.floor(Math.log10(b));
  if (b / 10 ** e < 2) e -= 1;                 // a bar starting with 1 keeps two digits
  const dec = Math.max(0, -e);
  const round = (x) => (dec > 0 ? Number(x.toFixed(Math.min(dec, 12))) : Math.round(x / 10 ** e) * 10 ** e);
  const show = (x) => (dec > 0 ? x.toFixed(Math.min(dec, 12)) : String(Number(x.toPrecision(15))));
  return `${show(round(v))} ± ${show(round(b))}`;
}
const withU = (text, unit) => (unit ? `${text} ${unit}` : text);
// A fit in %: whole points, one decimal from 99 on, rounded as everywhere
// else (the Check line and the candidates), and never reading 100.
const pctText = (x) => (x >= 99 && x < 100 ? Math.min(99.9, Math.round(x * 10) / 10).toFixed(1) : String(Math.round(x)));
function timeText(t) {
  if (!finite(t)) return String(t);
  if (t < 1) return `${fmtNum(t * 1000, 2)} ms`;
  return `${fmtNum(t, 2)} s`;
}

// What the tester reads (§8): three to six sentences from the model and the
// names and units of u and y (names: the plan's names, or a Known's u and y).
// No word of control theory: ζ, χ² and the kernel stay in tooltips and More.
export function modelSentences(model, names = {}) {
  const n = names.u && typeof names.u === 'object' ? { u: names.u.name, uUnit: names.u.unit, y: names.y.name, yUnit: names.y.unit } : { u: 'u', uUnit: '', y: 'y', yUnit: '', ...names };
  if (!model?.structure) return [model?.message ?? 'No model: the test ended before anything could be fitted.'];
  const S = STRUCTURES[model.structure], p = model.params, sd = model.sd ?? {};
  const out = [];
  const one = n.uUnit ? `1 ${n.uUnit}` : `1 of ${n.u}`;
  // A dead time is said when the data show one: at least a tenth of a sample
  // (the hold splits a delay exactly into fractions of one; a bar alone let
  // "0.0028 ms" through at 10 ms), and beyond its 2σ bar when it has one.
  if (p.theta >= model.Ts / 10 && (sd.theta === null || sd.theta === undefined || p.theta > 2 * sd.theta)) out.push(`Responds after ${timeText(p.theta)}.`);
  if (S.integrating) {
    out.push(`Keeps moving as long as it is pushed: ${one} for 1 s moves it ${withU(withBar(p.kp, sd.kp), n.yUnit)}${n.yUnit ? '' : ` of ${n.y}`} (it integrates).`);
  } else {
    const ts = settlingTime(model.structure, p, model.Ts);
    const swings = 'zeta' in p && p.zeta < 0.7;
    if (swings) out.push(`Swings at about ${fmtNum(p.f * Math.sqrt(1 - p.zeta * p.zeta), 2)} Hz and settles in about ${timeText(ts)}.`);
    else out.push(`Settles in about ${timeText(ts)}.`);
    out.push(`${one} more gives ${withU(withBar(p.K, sd.K), n.yUnit)}${n.yUnit ? '' : ` of ${n.y}`} more.`);
  }
  const W = model.whereSpread;
  const seenPlaces = (model.where ?? []).filter((pl) => pl.seen >= GRADE.seen);
  if (W?.flagged && seenPlaces.length >= 2) {
    const a = seenPlaces[0], b = seenPlaces.at(-1);
    const at = (v) => withU(fmtNum(v, 2), n.yUnit);
    out.push(`Behaves differently at different places: near ${at(a.level)}, ${one}${S.integrating ? ' for 1 s' : ''} moves it ${at(a.gain)}; near ${at(b.level)}, ${at(b.gain)}. The model is a compromise between them.`);
  }
  // The Shake's measure goes before the Nudge's hint of friction (§8: at most six).
  if (finite(model.distortion) && model.distortion >= GRADE.distortion[0]) out.push(`About ${Math.round(model.distortion)} % of the response at this size is not linear.`);
  else if (model.sizeNote) out.push(model.sizeNote);
  const noise = model.noise;
  const noiseLine = !noise ? null : noise.none ? 'This plant has no noise; real plants do.'
    : noise.steps && !(noise.sigma > 0.5 * noise.q / Math.sqrt(12)) ? `Noise on ${n.y}: only its steps of ${withU(fmtNum(noise.q, 2), n.yUnit)} (an encoder).`
      : `Noise on ${n.y}: ${withU(fmtNum(noise.sigma, 2), n.yUnit)}${noise.steps ? `, in steps of ${withU(fmtNum(noise.q, 2), n.yUnit)} (an encoder)` : ''}.`;
  const c = model.check;
  let grade;
  if (c && !finite(c.fit)) grade = `The Check did not move ${n.y}, so the model could not be checked ${model.grade}.`;
  else if (c) grade = `Explains ${pctText(c.fit)} % of a test it was not fitted to; what is left ${c.white ? 'looks like noise' : noise?.coloured ? 'has a pattern, as the noise at rest has' : 'has a pattern'} ${model.grade}.`;
  else grade = `${model.end === 'stopped' ? 'From a stopped test: ' : ''}explains ${pctText(model.fit)} % of what it was fitted to; no Check ran ${model.grade}.`.replace(/^e/, 'E');
  const tail = [grade];
  if (model.grade === '✕') tail.push('Auto-tune can tune on it, but Try on the plant will tell; a larger room or a longer test helps.');
  if (noiseLine && out.length + tail.length < 6) out.push(noiseLine);
  return [...out.slice(0, 6 - tail.length), ...tail];
}

// The kernel's step keeps rising at its end: an integrator is worth trying.
function kernelRises(kernel) {
  const st = kernelStep(kernel);
  const n = st.s.length - 1, a = st.s[Math.floor(0.75 * n)], b = st.s[n];
  return Math.abs(b - a) > 0.1 * Math.abs(b) && Math.sign(b - a) === Math.sign(b);
}

// The structures' start values from the first look (its K or k′, τ, θ, and
// a resonance's f and ζ), the sign fixed by it.
function lookGuess(look) {
  if (!look) return null;
  return { K: look.K ?? undefined, kp: look.kp ?? undefined, tau: look.tau, theta: look.theta, f: look.p?.f ?? look.swing?.f ?? undefined, zeta: look.p?.zeta ?? undefined };
}
function signed(start, S, sign) {
  const out = { ...start };
  const key = GAIN(S);
  if (finite(out[key]) && out[key] !== 0) out[key] = sign * Math.abs(out[key]);
  return out;
}

// The covariance and chain entries of a fit, as plain data.
const plainCov = (cov) => (cov ? cov.map((row) => Array.from(row, (v) => v + 0)) : null);

// The gentlest controller that held, eased in (§4: "Add as variant").
function easedFrom(g, plan) {
  // Only a controller that held: the ladder started (the Hold settled and
  // did not push the wrong way).
  if (!g.ladder) return null;
  const inc = g.ladder?.incumbent ?? 0;
  const T = inc ? g.tries.find((t) => t.n === inc) : null;
  const holdLaw = [...g.laws].reverse().find((e) => e.role === 'hold') ?? null;
  const src = T ?? holdLaw;
  if (!src) return null;
  return { Kp: src.Kp, Ki: src.Ki, tauC: src.tauC, umin: plan.umin, umax: plan.umax, try: inc || null };
}

// The onset test (input 56, decisions.md v2.9): after each visible push of
// the Nudge (each starts at rest; a try's step may not: the oven still
// cooling read an onset of 40 ms through its 0.1 s pipe), the time y has gone a tenth of the way to its peak response in
// the push's direction and stays beyond its noise (four floors) for two
// samples. The earliest over the pushes, { t, i (the rung) }, or null. A
// tenth, not the first sample out of the noise: a shape's dead time also
// stands for a slow start (the oven's three lags and its 0.1 s pipe read as
// 0.137 s), which moves y far less than a tenth by then; a dead time that
// is wrong (the arm's 0.15 s for a start within 30 ms) has let y go half
// its way.
export const ONSET = { share: 0.1, floors: 4, hold: 2, peakFloors: 20 };
function onsetOf(record, rungs, floor, Ts) {
  let best = null;
  // d: the response from where the push started, in its direction; the onset
  // where it has gone a tenth of the way to its peak, beyond the noise.
  const read = (d, at) => {
    const peak = Math.max(...d.filter(finite));
    if (!(peak > ONSET.peakFloors * floor)) return;
    const bar = Math.max(ONSET.floors * floor, ONSET.share * peak);
    for (let k = 0; k + ONSET.hold <= d.length; k++) {
      if (d.slice(k, k + ONSET.hold).every((v) => v > bar)) { const t = k * Ts; if (!best || t < best.t) best = { t, at }; return; }
    }
  };
  for (const R of rungs) {
    if (!R.visible || !Number.isInteger(R.i0) || !Number.isInteger(R.T)) continue;
    const dir = (R.dir ?? 1) * (R.sign ?? 1);
    const end = Math.min(record.y.length, R.i0 + 1 + R.T + 1);
    const d = [];
    for (let i = R.i0; i < end; i++) { const y = nan(record.y[i]); d.push(finite(y) ? dir * (y - (R.base + (R.slope ?? 0) * (i - (R.ic ?? R.i0)))) : NaN); }
    read(d, `rung ${R.n}`);
  }
  return best;
}
// A shape refuted by the onset: its dead time longer than the onset by more
// than a sample (the zero-order hold's own).
function refutedByOnset(theta, onset, Ts, names) {
  if (!onset || !(theta > onset.t + Ts)) return null;
  return `moves before its dead time: after a push ${names.y} had gone a tenth of its way in ${timeText(Math.max(onset.t, Ts))}, before this shape's ${timeText(theta)}`;
}

// A short fingerprint of the fitting data, so a fit made during the pause
// is reused for the same data (identify()).
function fingerprint(record, seg) {
  let a = 0, b = 0;
  for (let j = 0; j < seg.F; j++) { const y = nan(record.y[j]), u = nan(record.u[j]); if (finite(y)) a += y * (1 + (j % 7)); if (finite(u)) b += u * (1 + (j % 5)); }
  return JSON.stringify([seg.F, seg.open && [seg.open.i0, seg.open.i1], seg.closed.map((c) => [c.i0, c.i1, c.yStart, c.uStart]), a, b]);
}

// The model from a record (§6–§8), as a generator that yields progress so
// the page can slice the work (by LM iterations, never by time). opts: plan
// (the plan the record ran; its names, band and limits), structure (the
// tester's choice of candidate), upto (the last sample fitted; default the
// fit pause's start), reuse (a model from the same data, whose fits it takes).
// Returns the IdentifiedModel (§16).
export function* identifySteps(record, { plan, structure = null, upto = null, reuse = null } = {}) {
  if (!plan) throw new Error('identifySteps: give the plan the record ran ({ plan })');
  if (!record || record.version !== IDENTIFY_VERSION) throw new Error(`identifySteps: a record of version ${IDENTIFY_VERSION}`);
  const Ts = record.Ts;
  const g = readLog(record);
  const names = { u: 'u', uUnit: '', y: 'y', yUnit: '', ...(plan.names ?? {}) };
  const base = { version: IDENTIFY_VERSION, Ts, names, band: plan.band.slice(), end: record.end, connection: null };
  const L = g.listen;
  const endMessage = g.end?.message ?? null;
  const none = (message) => {
    const m = { ...base, ok: false, structure: null, params: null, message, grade: '✕', why: [message], warnings: [] };
    m.sentences = modelSentences(m, names);
    return m;
  };
  if (!L || !g.look) return none(endMessage ?? 'the test ended before anything could be fitted');
  const seg = segmentsOf(record, plan, { upto });
  const look = g.look, sign = look.sign || 1;
  const fitSegs = [seg.open, ...seg.closed].filter(Boolean).map((sg) => fitSegment(record, sg, L, Ts));
  if (!fitSegs.length) return none(endMessage ?? 'the test ended before anything could be fitted');
  const length = seg.F * Ts;
  const warnings = [];
  // The plant applied a different u than sent, beyond the limits the page knows.
  for (let j = 0; j < seg.F; j++) {
    const ap = nan(record.applied?.[j]), u = nan(record.u[j]);
    if (finite(ap) && finite(u) && Math.abs(ap - u) > 1e-6 * (plan.umax - plan.umin)) {
      warnings.push(`the plant applied a different ${names.u} than sent at ${fmtNum(j * Ts, 3)} s: a limit the page does not know`);
      break;
    }
  }
  // A controller at its limit in the closed-loop data: the loop there
  // passes the noise in a way the bars do not follow (they take the loop as
  // linear; measured: K's spread 1.6× its bar with u clamped at a
  // segment's start), so the model says so.
  {
    const tolU = 1e-9 * (plan.umax - plan.umin);
    let at = 0, all = 0;
    for (const sg of seg.closed) {
      for (let j = sg.i0; j < sg.i1; j++) {
        const u = nan(record.u[j]);
        if (!finite(u)) continue;
        all++;
        if (u <= plan.umin + tolU || u >= plan.umax - tolU) at++;
      }
    }
    if (at) warnings.push(`${names.u} was at its limit in ${Math.max(1, Math.round((100 * at) / all))} % of the loop's test: the ± bars may be too narrow`);
  }
  // No noise: Listen's floor is the smallest the experiment allows (a
  // simulation). An encoder's steps: Listen's, or, when y stood still in
  // Listen, the grid y moved on over the whole test (finer than the grid
  // Keep rounds y to does not count).
  const q = L.q > 0 ? L.q : encoderStep(record, seg.F, L);
  const quiet = !(L.sigma > 0.5 * L.floor) && !(q / Math.sqrt(12) > 0.5 * L.floor);
  const steps = q / Math.sqrt(12) > 0.2 * L.floor;
  if (quiet) warnings.push('this plant has no noise; real plants do');
  if (record.end === 'stopped') warnings.push('from a stopped test');
  const print = fingerprint(record, seg);
  const reused = reuse?.fitted?.print === print ? reuse.fitted : null;

  // The kernel reference (§6.8), on everything fitted, from Listen on.
  let kernel = reused ? reused.kernel : null;
  if (!reused) {
    const from = L.i0, to = seg.F;
    const u = new Float64Array(to - from), y = new Float64Array(to - from);
    let lastY = L.y0, lastU = plan.u0;
    for (let j = from; j < to; j++) {
      const yy = nan(record.y[j]), ap = nan(record.applied?.[j]), uu = finite(ap) ? ap : nan(record.u[j]);
      lastY = finite(yy) ? yy : lastY; lastU = finite(uu) ? uu : lastU;
      y[j - from] = lastY; u[j - from] = lastU;
    }
    const slow = look.theta + 4 * look.tau;
    const cover = Math.max(10, Math.min(Math.ceil((1.5 * slow) / Ts), Math.floor((to - from) / 3)));
    try {
      kernel = yield* tcKernelSteps(u, y, { cover, integrating: look.integrating, u0: plan.u0, y0: L.y0, Ts });
    } catch { kernel = null; }
  }
  const guessK = kernel ? kernelGuess(kernel, Ts) : null;
  const integrating = look.integrating || (kernel && !kernel.integrating && kernelRises(kernel));
  const tried = ['lag', 'lags', 'resonance', ...(integrating ? ['intLag', 'intRes'] : [])];

  // The noise's own colour, from Listen's last half less its drift (noise
  // only, no model involved): an AR model whose impulse response joins each
  // segment's noise transfer, so the bars hold when the noise is not white
  // (measured: AR(1) at ρ 0.95 put them 3–7× too narrow). An encoder's steps
  // or no noise at all: white. Coloured, the noise's level is its spread
  // about the drift, not Listen's σ from differences (σ√(1 − ρ) for AR(1)),
  // for the ceiling and the noise sentence.
  const { colour, level } = (() => {
    if (quiet || steps) return { colour: null, level: 0 };
    const a = L.i0 + Math.floor((L.i1 - L.i0) / 2), v = [];
    for (let j = a; j < L.i1; j++) { const yy = nan(record.y[j]); if (finite(yy)) v.push(yy - L.slope * (j - (L.i1 - 1))); }
    const c = noiseColour(v);
    if (c.length <= 1) return { colour: null, level: 0 };
    let m = 0, s = 0;
    for (const x of v) m += x;
    m /= v.length;
    for (const x of v) s += (x - m) ** 2;
    return { colour: c, level: Math.sqrt(s / Math.max(1, v.length - 1)) };
  })();
  const sigmaY = Math.max(L.sigma, level), floorY = Math.max(L.floor, level);

  // The fits (§6.3): two starts each, the first look's and the kernel's.
  const fits = reused ? reused.fits : {};
  if (!reused) {
    for (const name of tried) {
      const S = STRUCTURES[name];
      const starts = [signed(S.start(lookGuess(look)), S, sign)];
      if (guessK) starts.push(signed(S.start(guessK), S, sign));
      try { fits[name] = yield* fitStructureSteps(fitSegs, name, starts, { Ts, maxIter: 60, noise: colour }); } catch { fits[name] = null; }
    }
  }

  // The Check (§5.7, §7): each candidate replayed on it, from r alone.
  const ckSeg = seg.check ? fitSegment(record, seg.check, L, Ts) : null;
  const ckY = ckSeg ? Array.from(ckSeg.y) : null;
  const ckU = ckSeg ? ckSeg.idx.map((i) => (i >= 0 ? nan(record.u[i]) : NaN)) : null;
  // Graded from the Check's start on (the replay may start earlier, at rest).
  const graded = ckSeg ? ckSeg.idx.map((i) => i >= seg.check.from) : null;
  const measured = (yh) => {
    const y = [], h = [], u = [];
    for (let k = 0; k < ckY.length; k++) if (graded[k] && finite(ckY[k])) { y.push(ckY[k]); h.push(yh[k]); u.push(ckU[k]); }
    return { y, h, u };
  };
  const ceiling = ckSeg ? noiseCeiling(measured(ckY).y, floorY) : null;
  const scoreCheck = (yh, h = null) => {
    const m = measured(yh);
    const res = m.y.map((v, k) => v - m.h[k]);
    const w = whiteness(res, 25, h), x = crossCorrelation(res, m.u.map((v) => (finite(v) ? v : 0)));
    return { fit: fitPercent(m.y, m.h), white: w.white, independent: x.independent, whiteness: w, cross: x };
  };
  let kernelFit = null;
  if (kernel && ckSeg) { try { kernelFit = scoreCheck(kernelReplay(kernel, ckSeg)).fit; } catch { kernelFit = null; } }
  // The onset (input 56): after each push, how soon y moved. A shape whose
  // dead time is longer did not see the plant start.
  const onset = onsetOf(record, g.rungs, floorY, Ts);
  const candidates = [];
  for (const name of tried) {
    const f = fits[name];
    if (!f) continue;
    const why = unsupported(name, f.p, { length }) ?? refutedByOnset(f.p.theta ?? 0, onset, Ts, names);
    let check = null;
    // The Check's residual is the noise as the loop shapes it (S·v), coloured
    // even for the true model: the pattern test reads each lag against what
    // the loop gives white noise (measured: the true model read "a pattern"
    // in 61 % of seeds under a PI at τc = θ; 4 % so). The noise's own colour
    // is not taken out: from Listen's 150 samples it is too unsure for the
    // Check's narrow band (white noise then read "a pattern" in a third).
    if (ckSeg) { const dd = discretise(name, f.p, Ts); check = scoreCheck(simulateSegment(dd, ckSeg).y, noiseTransfer(dd, ckSeg)); }
    const fitAll = (() => {
      const yh = fitSegs.map((fs) => simulateSegment(discretise(name, f.p, Ts), fs).y);
      const y = [], h = [];
      fitSegs.forEach((fs, s) => { for (let k = 0; k < fs.y.length; k++) if (finite(fs.y[k])) { y.push(fs.y[k]); h.push(yh[s][k]); } });
      return fitPercent(y, h);
    })();
    const gr = gradeOf({ fit: check ? check.fit : fitAll, ceiling: ceiling ?? -Infinity, white: check ? check.white : true, coloured: !!colour, kernelGap: check && kernelFit !== null ? kernelFit - check.fit : 0, left: !!seg.check?.left, checked: !!check });
    candidates.push({
      structure: name, label: STRUCTURES[name].label, glyph: STRUCTURES[name].glyph, p: f.p, sd: f.sd, cov: plainCov(f.cov),
      fit: check ? check.fit : NaN, fitted: fitAll, chi2dof: f.chi2dof, bic: f.bic, unsupported: why, grade: why ? '✕' : gr.mark, why: why ? [why] : gr.why, check,
    });
  }
  if (!candidates.length) return none('no model could be fitted to this test');
  // Every shape on offer reads as unsupported (a time constant far beyond
  // the test, ζ above 5, unstable): no model, rather than one whose numbers
  // say "settles in about 4e20 s" (§6.4).
  if (candidates.every((c) => c.unsupported)) {
    const whys = [...new Set(candidates.map((c) => c.unsupported))];
    return none(`No shape on offer fits what this test saw (${whys.join('; ')}): a larger room or a longer test helps.`);
  }

  // The choice (§6.4): on the Check; without one (or when no candidate's
  // Check fit is a number: y did not move there), by BIC on the fitting data.
  let pick = ckSeg ? chooseStructure(candidates) : { index: -1 };
  if (pick.index < 0) {
    const pool = candidates.map((c, i) => i).filter((i) => !candidates[i].unsupported);
    const use = pool.length ? pool : candidates.map((c, i) => i);
    const best = Math.min(...use.map((i) => candidates[i].bic));
    const tied = use.filter((i) => candidates[i].bic < best + 2);
    const order = Object.keys(STRUCTURES);
    tied.sort((a, b) => order.indexOf(candidates[a].structure) - order.indexOf(candidates[b].structure));
    pick = { index: tied[0], why: ckSeg ? 'the lowest BIC (the Check gave no fit)' : 'the lowest BIC (no Check ran)' };
  }
  let index = pick.index, chosenWhy = pick.why;
  // The test that told two shapes apart (input 56): of those it was made
  // for, the one that predicted it.
  let discrimination = null;
  const D = g.discriminate;
  if (D && !D.left && D.iEnd > D.iStart + 2) {
    const fitsD = tellApart(record, plan, D.candidates.map((name) => candidates.find((c) => c.structure === name && !c.unsupported)).filter(Boolean).map((c) => ({ structure: c.structure, params: c.p })));
    const names2 = Object.keys(fitsD);
    if (names2.length >= 2) {
      const win = names2.reduce((a, b) => (fitsD[b] > fitsD[a] ? b : a));
      const other = names2.filter((x) => x !== win).reduce((a, b) => (fitsD[b] > fitsD[a] ? b : a));
      const test = D.shape === 'burst' ? `a burst at ${fmtNum(D.f, 2)} Hz` : `a ${D.shape}`;
      // A clear win: its miss (100 − fit, in the same units) at most `clear` of the other's.
      // and itself a fair prediction (a nonlinear plant may defeat both).
      const clear = fitsD[win] >= GRADE.fair && 100 - fitsD[win] <= DISCRIMINATE.clear * (100 - fitsD[other]);
      discrimination = { shape: D.shape, f: D.f, fits: fitsD, chosen: clear ? win : null };
      if (clear) {
        index = candidates.findIndex((c) => c.structure === win);
        chosenWhy = `the one that predicted the test that tells it from ${STRUCTURES[other].label} (${test}): ${pctText(fitsD[win])} % against ${pctText(fitsD[other])} %`;
      } else chosenWhy += `; the test that tells ${STRUCTURES[win].label} from ${STRUCTURES[other].label} (${test}) did not either (${pctText(fitsD[win])} % against ${pctText(fitsD[other])} %)`;
    }
  }
  if (structure && candidates.some((c) => c.structure === structure)) { index = candidates.findIndex((c) => c.structure === structure); chosenWhy = 'your choice'; }
  const chosen = candidates[index];
  const S = STRUCTURES[chosen.structure];

  // Where (§6.6): the gain and the main time scale refitted per place (the
  // thirds of the levels visited), and the hold curve measured where y sat
  // still at r (the u that held it there). Places differ when their gains
  // or time scales differ by more than 25 % and beyond their 2σ bars, among
  // the places the model spent at least a tenth of its time in.
  let where = [];
  const hN = fitSegs.map((fs) => convolve(noiseTransfer(discretise(chosen.structure, chosen.p, Ts), fs), colour));
  const placed = yield* placeFit(fitSegs, chosen.structure, chosen.p, chosen.cov, seg.levels, Ts, hN);
  if (placed) {
    const total = placed.reduce((a, pl) => a + pl.samples, 0);
    where = placed.map((pl) => {
      const near = seg.holds.filter((h) => h.y >= pl.from - 1e-12 && h.y <= pl.to + 1e-12);
      return { ...pl, seen: pl.samples / Math.max(1, total), hold: near.length ? near.reduce((a, h) => a + h.u, 0) / near.length : null, holdAt: near.length ? near.reduce((a, h) => a + h.y, 0) / near.length : null };
    });
  }
  let spread = 0, flagged = false;
  const seen = where.filter((pl) => pl.seen >= GRADE.seen);
  for (let a = 0; a < seen.length; a++) {
    for (let b = a + 1; b < seen.length; b++) {
      for (const [key, sdKey] of [['gain', 'gainSd'], ['scale', 'scaleSd']]) {
        const x = seen[a][key], y = seen[b][key];
        const rel = Math.abs(x - y) / Math.min(Math.abs(x), Math.abs(y));
        spread = Math.max(spread, rel);
        if (rel > GRADE.where && Math.abs(x - y) > 2 * Math.hypot(seen[a][sdKey] ?? 0, seen[b][sdKey] ?? 0)) flagged = true;
      }
    }
  }

  // Size (§6.6): the apparent gain of the Nudge's rungs at the final length.
  const lastT = g.rungs.at(-1)?.T;
  const size = g.rungs.filter((R) => R.T === lastT && R.visible).map((R) => {
    const i = R.i0 + R.T;
    const yT = nan(record.y[Math.min(record.y.length - 1, i)]) - (R.base + R.slope * (i - R.ic));
    return { a: R.a, gain: (yT / (R.dir * R.a)) * (S.integrating ? 1 / (R.T * Ts) : 1), complete: R.complete };
  });
  let sizeNote = null;
  if (size.length >= 2 && !S.integrating) {
    const small = size[0], big = size.at(-1);
    if (small.a < big.a && Math.abs(small.gain) < 0.75 * Math.abs(big.gain)) {
      sizeNote = `At ±${withU(fmtNum(small.a, 2), names.uUnit)} it moves less than at larger pushes (friction, or a dead band): this model is for pushes near ±${withU(fmtNum(big.a, 2), names.uUnit)} and more.`;
    }
  }

  // The grade (§7) of the chosen one, with the where-spread. A test that
  // ended before any loop held the plant (too short, a plant that does not
  // come back, a loop that pushed the wrong way or did not hold) is ✕ (§5.9),
  // whatever its fit: the model saw the pushes only.
  const check = chosen.check;
  const kernelGap = check && kernelFit !== null ? kernelFit - check.fit : 0;
  // The Shake (§6.7): the frequency response at each place it ran, its
  // distortion, and how much of it the model holds within 2σ.
  const shakes = shakeResponses(record, g.shakes, chosen, Ts);
  const distortion = shakes.length ? Math.max(...shakes.map((x) => x.distortion.share)) : null;
  let grade = gradeOf({ fit: check ? check.fit : chosen.fitted, ceiling: ceiling ?? -Infinity, white: check ? check.white : true, coloured: !!colour, distortion, spread: flagged ? spread : 0, kernelGap, left: !!seg.check?.left, checked: !!check });
  const early = { budget: 'the test ended after the first look', slow: 'the test ended after the first look', away: 'the gentle controller pushed the wrong way', hold: 'the gentle controller did not hold' }[g.end?.code];
  if (early) grade = { mark: '✕', why: [early] };
  if (chosen.unsupported) grade = { mark: '✕', why: [chosen.unsupported, ...grade.why.filter((w) => w !== chosen.unsupported)] };
  // The Check plot: the prediction with its 2σ band from 50 parameter samples.
  let checkOut = null;
  if (ckSeg) {
    const yh = simulateSegment(discretise(chosen.structure, chosen.p, Ts), ckSeg).y;
    const samples = parameterSamples(chosen.structure, chosen.p, chosen.cov, Ts);
    const runs = [];
    for (const p of samples) {
      try {
        const y = simulateSegment(discretise(chosen.structure, p, Ts), ckSeg).y;
        if (y.every(finite)) runs.push(y);
      } catch { /* a sample far out (a bar wider than its value) is left out */ }
    }
    const sdOf = (k) => { if (!runs.length) return 0; let m = 0; for (const r of runs) m += r[k]; m /= runs.length; let v = 0; for (const r of runs) v += (r[k] - m) ** 2; return Math.sqrt(v / Math.max(1, runs.length - 1)); };
    checkOut = {
      fit: check.fit, ceiling, white: check.white, independent: check.independent, grade: grade.mark, why: grade.why, kernel: kernelFit,
      i0: seg.check.from, i1: seg.check.i1, left: !!seg.check.left,
      y: ckY.filter((_, k) => graded[k]).map((v) => (finite(v) ? v : null)), yhat: Array.from(yh).filter((_, k) => graded[k]), band: Array.from(yh, (_, k) => 2 * sdOf(k)).filter((_, k) => graded[k]),
      autocorrelation: Array.from(check.whiteness.r), crossCorrelation: Array.from(check.cross.r), limit: check.whiteness.band,
    };
  }
  const model = {
    ...base, ok: true,
    structure: chosen.structure, label: S.label, glyph: S.glyph, params: chosen.p, sd: chosen.sd, cov: chosen.cov, chosen: chosenWhy,
    chain: S.chain(chosen.p, { sd: chosen.sd, units: { u: names.uUnit, y: names.yUnit } }),
    candidates: candidates.map(({ check: c, p, sd, cov, ...rest }) => ({ ...rest, params: p, sd })),
    noise: { sigma: quiet ? 0 : sigmaY, q: steps ? q : 0, floor: floorY, drift: L.drifts ? L.drift : 0, none: quiet, steps, coloured: !!colour },
    fit: chosen.fitted, check: checkOut,
    where, holds: seg.holds.map((h) => ({ y: h.y, u: h.u })), whereSpread: { spread, flagged }, size, sizeNote,
    kernel: kernel ? { g: Array.from(kernel.g), sd: Array.from(kernel.sd), Ts: kernel.Ts, decimate: kernel.decimate, integrating: kernel.integrating, rate: kernel.rate ? { value: kernel.rate.value, sd: kernel.rate.sd } : null, fit: kernelFit } : null,
    eased: easedFrom(g, plan), discrimination, frf: shakes, distortion,
    grade: grade.mark, why: grade.why, warnings,
    segments: { open: seg.open ? [seg.open.i0, seg.open.i1] : null, closed: seg.closed.map((c) => [c.i0, c.i1]), check: seg.check ? [seg.check.from, seg.check.i1] : null, fitted: seg.F },
  };
  model.sentences = modelSentences(model, names);
  // The fits, for a model of the same data (memory only, never stored).
  Object.defineProperty(model, 'fitted', { value: { print, kernel, fits }, enumerable: false });
  return model;
}

// ---- The model as blocks and as a linear model (§10, §12)

// The identified model's LinearModel for Analysis (§12): the chosen
// structure's continuous A, B, C, D with its states named by the chain, its
// dead time, the sensor's noise, the operating range and the grade's words.
export function linearModel(model) {
  if (!model?.structure) throw new Error('linearModel: no model was identified');
  const S = STRUCTURES[model.structure];
  const ss = S.ss(model.params);
  const n = model.names ?? {};
  // The range identified: the levels the test visited (§12), else the band.
  const lo = model.where?.length ? model.where[0].from : model.band?.[0];
  const hi = model.where?.length ? model.where.at(-1).to : model.band?.[1];
  return {
    A: ss.A.map((r) => r.slice()), B: ss.B.map((r) => r.slice()), C: ss.C.map((r) => r.slice()), D: ss.D.map((r) => r.slice()),
    states: ss.states.map((s) => ({ ...s })),
    inputs: [{ name: n.u ?? 'u', unit: n.uUnit ?? '' }],
    outputs: [{ name: n.y ?? 'y', unit: n.yUnit ?? '' }],
    op: { kind: 'identified', label: `identified over ${fmtNum(lo, 3)} … ${fmtNum(hi, 3)}${n.yUnit ? ` ${n.yUnit}` : ''}` },
    delay: [model.params.theta ?? 0],
    sensors: [{ std: model.noise?.sigma ?? 0, q: model.noise?.q ?? 0 }],
    warnings: [...(model.sentences ?? []).filter((t) => /Behaves differently|has a pattern|not linear/.test(t)), ...(model.warnings ?? [])],
  };
}

// The twin as a subsystem of the Plant library's own blocks (§10; no black
// boxes): In → gain K (or k′) → integrator → lags or a resonance → dead time
// → noise → quantiser → Out. push: an added Sum at its input with a second
// In for the test push. noise: false leaves out the noise and the quantiser.
// at: { u0, y0 }, the point the model was measured about (it is incremental):
// u0 is taken off its input and y0 added to its output, so in a loop it
// rests at y0 with u0, as the plant did in Listen.
export function twinSubsystem(model, { push = false, noise = true, id = 'twin', name = null, at = null } = {}) {
  if (!model?.structure) throw new Error('twinSubsystem: no model was identified');
  const p = model.params, S = STRUCTURES[model.structure];
  const blocks = [], wires = [];
  let x = 20, last = null;
  const add = (b) => { blocks.push({ ...b, x, y: 100 }); x += 130; if (last) wires.push({ from: last, to: b.id }); last = b.id; };
  blocks.push({ id: 'u', type: 'inport', name: model.names?.u ?? 'u', params: { port: 1 }, x, y: 100 });
  x += 130; last = 'u';
  if (push) {
    blocks.push({ id: 'push', type: 'inport', name: 'push at the input (model only)', params: { port: 2 }, x: x - 130, y: 220 });
    add({ id: 'sum', type: 'sum', params: { signs: '++' } });
    wires.push({ from: 'push', to: 'sum:1' });
  }
  // Offsets as Equations (a number written out in full, so the model is exact).
  if (at?.u0) add({ id: 'aboutU', type: 'fcn', name: 'about u₀', params: { inputs: 'u', eqs: `y = u - (${at.u0})`, outputs: 'y' } });
  const gainKey = GAIN(S);
  add({ id: 'gain', type: 'gain', name: S.integrating ? 'rate k′' : 'gain K', params: { K: p[gainKey] } });
  if (S.integrating) add({ id: 'int', type: 'integrator', name: 'integrator', params: { K: 1 } });
  if (model.structure === 'lag' || model.structure === 'intLag') add({ id: 'lag', type: 'firstOrder', name: 'lag τ', params: { K: 1, tau: p.tau } });
  if (model.structure === 'lags') {
    add({ id: 'lag1', type: 'firstOrder', name: 'lag τ₁', params: { K: 1, tau: p.tau1 } });
    add({ id: 'lag2', type: 'firstOrder', name: 'lag τ₂', params: { K: 1, tau: p.tau2 } });
  }
  if (model.structure === 'resonance' || model.structure === 'intRes') add({ id: 'res', type: 'secondOrder', name: 'resonance f, ζ', params: { K: 1, wn: 2 * Math.PI * p.f, zeta: p.zeta } });
  // The dead time after the dynamics (the same model: they commute): the Dead
  // time block interpolates its input between integration steps, exact for
  // a smooth input, half a step off for a held one (identification.md §17,
  // test 11).
  if (p.theta > 0) add({ id: 'dead', type: 'delay', name: 'dead time θ', params: { L: p.theta, y0: 0 } });
  if (at?.y0) add({ id: 'aboutY', type: 'fcn', name: 'about y₀', params: { inputs: 'u', eqs: `y = u + (${at.y0})`, outputs: 'y' } });
  if (noise && model.noise?.sigma > 0) add({ id: 'noise', type: 'noise', name: 'noise σ', params: { std: model.noise.sigma, seed: 1 } });
  if (noise && model.noise?.q > 0) add({ id: 'quant', type: 'quantizer', name: 'steps q', params: { q: model.noise.q } });
  add({ id: 'y', type: 'outport', name: model.names?.y ?? 'y', params: { port: 1 } });
  return { id, type: 'subsystem', name: name ?? `identified ${S.label}`, params: {}, diagram: { blocks, wires } };
}

// The twin in the plant's place (§10): in a copy of the diagram, the
// Controller block at path drives the twin subsystem and reads its output as
// its measurement; the real plant stays, cut off from the loop (a simulated
// one runs on beside it); an External plant (a live one) leaves the copy,
// and what showed its measured output shows the twin's. push: a Source named
// push into the twin's second input (the test push). noise: the twin's noise
// and quantiser (false for Analysis). Returns the diagram.
export function twinDiagram(diagram, path, model, { push = null, noise = true } = {}) {
  const d = structuredClone(diagram);
  const { level, block } = locate(d, path);
  if (block?.type !== 'controller') throw new Error(`twinDiagram: no Controller block ${[].concat(path).join('/')}`);
  const ids = new Set(level.blocks.map((b) => b.id));
  const fresh = (base) => { let id = base; for (let k = 2; ids.has(id); k++) id = `${base}${k}`; ids.add(id); return id; };
  const id = fresh('twin');
  const rest = model.holds?.[0] ?? null;
  const tw = twinSubsystem(model, { push: !!push, noise, id, name: 'identified model', at: rest ? { u0: rest.u, y0: rest.y } : null });
  tw.x = (block.x ?? 0) + 160; tw.y = (block.y ?? 0) + 140;
  const into = wireTo(level, block.id, 1);
  const measured = into ? parseEnd(into.from) : null;
  level.wires = level.wires.filter((w) => w !== into);
  // An External plant leaves the copy: what it fed reads the twin where it
  // was the measurement, nothing elsewhere.
  const ext = level.blocks.filter((b) => b.type === 'external').map((b) => b.id);
  if (ext.length) {
    level.wires = level.wires.flatMap((w) => {
      const f = parseEnd(w.from), t = parseEnd(w.to);
      if (ext.includes(t.id)) return [];
      if (!ext.includes(f.id)) return [w];
      return measured && sameEnd(f, measured) ? [{ ...w, from: id }] : [];
    });
    level.blocks = level.blocks.filter((b) => !ext.includes(b.id));
  }
  // A Sink that showed the measurement shows the model's (a simulated plant
  // runs on beside it, cut off; its other outputs read what it does open loop).
  if (measured && !ext.includes(measured.id)) {
    level.wires = level.wires.map((w) => (sameEnd(parseEnd(w.from), measured) && level.blocks.find((b) => b.id === parseEnd(w.to).id)?.type === 'sink' ? { ...w, from: id } : w));
  }
  level.blocks.push(tw);
  level.wires.push({ from: block.id, to: id }, { from: id, to: `${block.id}:1` });
  if (push) {
    const sid = fresh('push');
    level.blocks.push({ id: sid, type: 'source', name: 'push at the input (model only)', params: { signal: push }, x: tw.x - 120, y: tw.y + 60 });
    level.wires.push({ from: sid, to: `${id}:1` });
  }
  return d;
}

// The test push (§10): at the twin's input, 20 % of the u the model needs to
// move between the reference's levels (at least 1 % of u's range); where
// the tester's d plays, with d's own shape and timing (a pulse is answered
// on and off), scaled to that size; else a step at 60 % of the period.
// → { amplitude, time, components }.
export const PUSH = { share: 0.2, least: 0.01, at: 0.6 };
export function testPush(project, path, model) {
  const known = knownFor(project, path);
  const S = STRUCTURES[model.structure], p = model.params;
  const span = known.r?.span ?? 0;
  const U = known.u.max - known.u.min;
  const du = S.integrating ? 0 : Math.abs(span / p.K);
  const amplitude = Math.max(PUSH.least * U, PUSH.share * du);
  const period = known.r?.period ?? Math.max(...Object.values(project.system.signals).map((x) => x.period));
  // The tester's d, where it plays timed components (steps, pulses, squares).
  const d = known.others.map((o) => project.system.signals[o.name]).find((sg) => sg?.components?.some((c) => c.enabled !== false && finite(c.params?.amplitude) && c.params.amplitude !== 0 && finite(c.params?.time)));
  if (d) {
    const comps = d.components.filter((c) => c.enabled !== false && finite(c.params?.amplitude) && finite(c.params?.time));
    const big = Math.max(...comps.map((c) => Math.abs(c.params.amplitude)));
    return { amplitude, time: Math.min(...comps.map((c) => c.params.time)), components: comps.map((c) => ({ ...structuredClone(c), params: { ...c.params, amplitude: (c.params.amplitude / big) * amplitude } })) };
  }
  const time = PUSH.at * period;
  return { amplitude, time, components: [{ type: 'step', params: { amplitude, time } }] };
}

// A project in which the Controller block at path drives the identified
// model (§10): its plant is twinDiagram's, with the test push as a signal
// named push; for Auto-tune ("on the model") and Analysis (noise: false).
export function modelProject(project, path, model, { push = true, noise = true } = {}) {
  const known = knownFor({ ...project, system: { ...project.system } }, path);
  const signals = structuredClone(project.system.signals);
  let name = null;
  if (push) {
    name = 'push';
    for (let k = 2; signals[name]; k++) name = `push${k}`;
    const tp = testPush(project, path, model);
    const period = known.r?.period ?? 1;
    signals[name] = { period, components: tp.components };
  }
  const diagram = normalizeDiagram(twinDiagram(project.system.plant.diagram, known.block.path, model, { push: name, noise }));
  return { ...project, system: { ...project.system, plant: { ...project.system.plant, diagram }, signals } };
}

// The loop the Controller at path closes round the identified model, for
// Analysis (§12): the twin without its noise or push, linearised where the
// run starts (the model at rest about where it was measured: it is linear),
// labelled with the range it was identified over and its grade's warnings.
// A controller at its limit there is not the model's concern: the model holds
// about its range, not at a state. Returns loopModel's { plant, ctrl, Ts, … }.
export function identifiedLoop(project, path, model) {
  const lin = linearModel(model);
  const m = loopModel(modelProject(project, path, model, { push: false, noise: false }), path, 'initial');
  const own = m.warnings.filter((w) => !/is at its limit|the origin is not at rest/.test(w));
  return { ...m, opLabel: lin.op.label, atLimit: false, identified: true, warnings: [...new Set([...lin.warnings, ...own])] };
}

// The key numbers across what the model is unsure of (§12): the loop for up
// to `count` parameter samples and each place the model changes by; the
// range of the gain and phase margins and of Ms over those that are stable.
// Returns { gm: [lo, hi], pm: [lo, hi], ms: [lo, hi], n, unstable } or null.
export function loopRanges(project, path, model, { count = 12 } = {}) {
  const models = modelSamples(model, count).map((p) => ({ ...model, params: p }));
  const S = STRUCTURES[model.structure], gk = GAIN(S);
  for (const pl of model.where ?? []) if (pl.seen >= GRADE.seen && finite(pl.gain) && finite(pl.scale)) models.push({ ...model, params: { ...model.params, [gk]: pl.gain, [pl.scaleKey]: pl.scale } });
  const out = { gm: [Infinity, -Infinity], pm: [Infinity, -Infinity], ms: [Infinity, -Infinity], n: 0, unstable: 0 };
  const take = (k, v) => { if (finite(v)) { out[k][0] = Math.min(out[k][0], v); out[k][1] = Math.max(out[k][1], v); } };
  for (const mm of models) {
    let r;
    try { const m = identifiedLoop(project, path, mm); r = analyzeLoop(m.plant, m.ctrl, m.Ts, { points: 200 }); } catch { continue; }
    if (!r.stable) { out.unstable++; continue; }
    out.n++;
    take('gm', r.margins.gmUp); take('pm', r.margins.pm); take('ms', r.margins.ms);
  }
  return out.n || out.unstable ? out : null;
}

// ---- Compare with the diagram (§13, simulated plants only)

// The project with the plant a block's Identify measures (§13): the diagram
// varied by the block's hidden variation where one is set, else as it is.
// The experiment, Compare and the "on the diagram" score use it.
export function variedProject(project, path) {
  const known = (() => { try { return knownFor(project, path); } catch { return null; } })();
  const vary = known && project.system.identify?.[known.block.key]?.vary;
  if (!vary || project.system.plant?.type !== 'diagram') return project;
  return { ...project, system: { ...project.system, plant: { ...project.system.plant, diagram: varyDiagram(project.system.plant.diagram, vary.share, vary.seed).diagram } } };
}

// What the test found beside the diagram's own linearisation at each place
// the test sat (linearizeBlock at { y: level }, the hidden variation's copy
// when one is set): per place the gain (k′ for an integrating plant), the
// main time scale (τ of the slowest pole; f and ζ of the slowest two for a
// resonance) and the dead time, the found ones the Where refit's (the rest
// held at the main fit). Returns { rows: [{ level, seen, found, diagram,
// error }], sentence, notes, factors } where found and diagram are { gain,
// tau | f, zeta, theta } and diagram also carries sys, the path as a
// continuous { A, B, C, D, delay } for compareCurves; a place the diagram
// cannot be linearised at carries error. vary: { share, seed } or null.
export function compareWithDiagram(project, path, model, { vary = null } = {}) {
  if (!model?.ok) throw new IdentifyError('compare', 'there is no model to compare', 'identify the plant first');
  if (project.system.plant?.type !== 'diagram') throw new IdentifyError('compare', 'the plant is not a diagram: there is nothing to compare with', 'Compare is for simulated plants');
  let diagram = project.system.plant.diagram, factors = null;
  if (vary) ({ diagram, factors } = varyDiagram(diagram, vary.share, vary.seed));
  const proj = { ...project, system: { ...project.system, plant: { ...project.system.plant, diagram } } };
  const S = STRUCTURES[model.structure], gk = GAIN(S), p = model.params;
  const resonant = SCALE[model.structure] === 'f';
  const places = model.where?.length ? model.where : [{ level: model.holds?.[0]?.y ?? 0, gain: p[gk], gainSd: model.sd?.[gk] ?? null, scale: p[SCALE[model.structure]], scaleKey: SCALE[model.structure], seen: 1 }];
  const id = [].concat(path ?? controllerBlocks(diagram)[0]?.path ?? []);
  const rows = places.map((pl) => {
    const found = { gain: pl.gain, gainSd: pl.gainSd, theta: p.theta ?? 0 };
    if (resonant) { found.f = pl.scale; found.zeta = p.zeta; } else found.tau = pl.scale;
    const row = { level: pl.level, seen: pl.seen ?? 1, found, diagram: null, error: null };
    try { row.diagram = pathNumbers(linearizeBlock(proj, id, { y: pl.level }), resonant); } catch (e) { row.error = e.message; }
    return row;
  });
  const ok = rows.filter((r) => r.diagram && r.seen >= GRADE.seen);
  const notes = [];
  if (controllerBlocks(diagram).length > 1) notes.push('The test ran the other Controller blocks; the diagram\'s linearisation holds them at 0.');
  if (rows.some((r) => r.diagram && r.diagram.integrating !== S.integrating)) notes.push(`The diagram's path ${rows.find((r) => r.diagram)?.diagram.integrating ? 'integrates' : 'settles'}; the model's does ${S.integrating ? 'integrate' : 'settle'}.`);
  let sentence = rows.find((r) => r.error)?.error ? `The diagram has no linearisation at ${fmtNum(rows.find((r) => r.error).level, 3)}: ${rows.find((r) => r.error).error}.` : '';
  if (ok.length) {
    const K = p[gk], gains = ok.map((r) => r.diagram.gain);
    const lo = Math.min(...gains), hi = Math.max(...gains);
    const off = (a, b) => Math.abs(a - b) / Math.abs(b);
    const unit = (x) => withU(fmtNum(x, 2), model.names?.yUnit && model.names?.uUnit ? `${model.names.yUnit}/${model.names.uUnit}${S.integrating ? '/s' : ''}` : '');
    if (ok.length > 1 && hi > 1.25 * lo) {
      sentence = K >= 0.9 * lo && K <= 1.1 * hi
        ? `The identified gain (${unit(K)}) sits between the diagram's gains at the ${ok.length} places the test sat (${unit(lo)} … ${unit(hi)}): one linear model is a compromise for this plant.`
        : `The identified gain (${unit(K)}) lies outside the diagram's gains at the places the test sat (${unit(lo)} … ${unit(hi)}).`;
    } else {
      const gOff = Math.max(...ok.map((r) => off(r.found.gain, r.diagram.gain)));
      const key = resonant ? 'f' : 'tau';
      const sOff = Math.max(...ok.map((r) => off(r.found[key], r.diagram[key])));
      const within = (x) => `within ${Math.max(1, Math.round(100 * x))} %`;
      sentence = `The identified model is ${within(gOff)} of the diagram's gain and ${within(sOff)} of its ${resonant ? 'frequency' : 'time scale'} at the places the test sat.`;
    }
    // Where the most-seen place's linear step is far from the model's, the
    // slope there is not what a push of the test's size sees.
    const main = ok.reduce((x, y) => (y.seen > x.seen ? y : x));
    const N = Math.max(2, Math.ceil(compareHorizon(model) / model.Ts) + 1);
    const placed = model.where?.length ? { ...model, params: { ...p, [gk]: main.found.gain, [SCALE[model.structure]]: resonant ? main.found.f : main.found.tau } } : model;
    const ym = modelStep(placed, (N - 1) * model.Ts).y, yd = compareCurves(main.diagram.sys, model.Ts, { N }).step;
    main.agree = fitPercent(ym, yd);
    if (main.agree < GRADE.fair) notes.push(`Near ${fmtNum(main.level, 3)} the diagram's linearisation explains only ${pctText(Math.max(0, main.agree))} % of the step the test found there: a nonlinearity there (friction, a dead band, a limit) has a slope at rest that a push of the test's size does not see. The test measured the push.`);
    const thetaD = ok[0].diagram.theta, thetaF = p.theta ?? 0;
    if (thetaF > thetaD + 2 * model.Ts) notes.push(`The found dead time (${fmtNum(thetaF, 2)} s) is longer than the diagram's (${fmtNum(thetaD, 2)} s): it stands in for lags the model leaves out.`);
  }
  return { rows, sentence, notes, factors };
}

// How long the Step plot and the comparison look: six of the model's slowest
// times (its dead time on top), at least ten samples, at most 10 min.
export function compareHorizon(model) {
  const slow = Math.max(...model.chain.filter((x) => ['lag', 'delay'].includes(x.kind)).map((x) => x.value), 1 / (model.params.f ?? Infinity) * 3, 10 * model.Ts);
  return Math.min(6 * slow + (model.params.theta ?? 0), 600);
}

// The numbers of a linearised path (linearize.js pathRealisation): its gain
// (k′ where it integrates), the slowest pole's τ or the slowest two's f and
// ζ, its dead time, and the path itself.
function pathNumbers(lin, resonant) {
  const { A, b, c, d } = pathRealisation(lin, 0);
  const theta = lin.delay?.[0] ?? 0;
  const n = A.length;
  const sys = { A, B: b.map((x) => [x]), C: [c.slice()], D: [[d]], delay: [theta] };
  if (!n) return { gain: d, integrating: false, theta, sys, ...(resonant ? { f: NaN, zeta: NaN } : { tau: 0 }) };
  const size = Math.sqrt(A.flat().reduce((s, v) => s + v * v, 0));
  const poles = eig(A);
  const zero = poles.filter((q) => Math.hypot(q.re, q.im) <= 1e-9 * size);
  const rest = poles.filter((q) => Math.hypot(q.re, q.im) > 1e-9 * size).sort((x, y) => Math.hypot(x.re, x.im) - Math.hypot(y.re, y.im));
  const integrating = zero.length > 0;
  // The gain: G(0), or s·G(s) at an s far below every other pole where it integrates.
  const at = (s) => d + c.reduce((a, ci, i) => a + ci * solve(A.map((row, r) => row.map((v, j) => (r === j ? s : 0) - v)), b)[i], 0);
  const s0 = 1e-7 * (rest.length ? Math.hypot(rest[0].re, rest[0].im) : size);
  const gain = integrating ? s0 * at(s0) : at(0);
  const out = { gain, integrating, theta, sys };
  if (resonant) {
    const two = rest.slice(0, 2);
    if (two.length < 2) { out.f = NaN; out.zeta = NaN; } else {
      // The slowest pair: a complex pair as it is, two real poles as the second order they make.
      const w = Math.sqrt(Math.hypot(two[0].re, two[0].im) * Math.hypot(two[1].re, two[1].im));
      out.f = w / (2 * Math.PI); out.zeta = -(two[0].re + two[1].re) / (2 * w);
    }
  } else out.tau = rest.length ? -1 / rest[0].re : 0;
  return out;
}

// The diagram's path of a comparison row as the sampled loop sees it (zero-
// order hold and dead time, analysis.js discretePlant), for the dashed curves
// on Bode and Step: { mag: |G(e^{jωTs})| at w, step: the response to one unit
// more of u from rest, N samples }.
export function compareCurves(sys, Ts, { w = [], N = 0 } = {}) {
  const P = discretePlant(sys, Ts);
  const n = P.A.length;
  const mag = w.map((om) => {
    if (!n) return Math.abs(P.D[0][0]);
    const zr = Math.cos(om * Ts), zi = Math.sin(om * Ts);
    const { xr, xi } = csolve(P.A.map((row, i) => row.map((v, j) => (i === j ? zr : 0) - v)), P.A.map((row, i) => row.map((_, j) => (i === j ? zi : 0))), P.B.map((r) => r[0]), P.B.map(() => 0));
    const re = P.D[0][0] + P.C[0].reduce((a, v, i) => a + v * xr[i], 0), im = P.C[0].reduce((a, v, i) => a + v * xi[i], 0);
    return Math.hypot(re, im);
  });
  const step = new Float64Array(N);
  let x = new Array(n).fill(0);
  for (let k = 0; k < N; k++) {
    step[k] = P.D[0][0] * (k > 0 ? 1 : 0) + P.C[0].reduce((a, v, i) => a + v * x[i], 0);
    x = P.A.map((row, i) => row.reduce((a, v, j) => a + v * x[j], 0) + P.B[i][0]);
  }
  return { mag, step };
}

// The model of the block's kept test in use (system.identify[key]), from its
// record, for the command line and the MCP server (`--plant identified`);
// throws an IdentifyError when none is kept.
export function keptModel(project, path = null) {
  const key = path ? [].concat(path).join('/') : controllerBlocks(project.system.plant.diagram)[0]?.key;
  const e = project.system.identify?.[key];
  const kept = e?.kept ?? [];
  if (!kept.length) throw new IdentifyError('not-identified', 'identify the plant first: no test is kept for this block', 'node cli.mjs identify <project> --keep, or the Identify tab\'s Keep');
  const k = kept[Math.min(kept.length - 1, Math.max(0, e.use ?? kept.length - 1))];
  const model = drain(identifySteps(k.record, { plan: k.plan, structure: e.structure ?? null }));
  if (!model.ok) throw new IdentifyError('no-model', `the kept test "${k.name}" gives no model: ${model.sentences[0]}`, 'identify again');
  return { model, name: k.name, key };
}

// ---- Try on the plant (§11)

// The path from the controller that held (the model's eased-in PI) to a
// result tuned on the model, in three steps interpolated in log-gains (a gain
// that starts at 0, the derivative, linearly), each screened on the model,
// its parameter samples and its places: stable for all, Ms ≤ 2, and
// predicted to use at most 70 % of the room on the test reference. The path
// ends at the first step that fails ("the result is bolder than what the
// model knows: tried up to step 2"). Returns the experiment's plan of kind
// 'try' and the screening: { plan, steps: [{ n, s, gains, ok, why, J, room }],
// upto, why }. project, path: the system (its block's limits); src: the
// identify plan and record the model came from; variant: the result (PI or
// PID, type pid).
export const TRY = { steps: [1 / 3, 2 / 3, 1], ms: 2, room: 0.7, samples: 12, monitor: { residuals: 5, room: 0.2 } };
export function planTry(project, path, model, src, variant) {
  if (variant?.type !== 'pid') throw new IdentifyError('try-type', `Try on the plant takes PI and PID results; ${variant?.name ?? 'this one'} is a ${variant?.type}`, 'tune a PID or PI on the model');
  if (!model?.ok || !model.eased) throw new IdentifyError('try-eased', 'Try on the plant starts from the controller that held in the test: identify again, to a test that eased in', '');
  const { plan, record } = src;
  const g = readLog(record), Ts = plan.Ts;
  // The test reference as the tries played it.
  const refs = g.tries?.find((T) => T.settled) ?? g.tries?.[0];
  const len = record.log.find((e) => e.kind === 'references')?.test;
  if (!refs || !len) throw new IdentifyError('try-ref', 'the test that found this model played no try: identify again', '');
  const r = record.r.slice(refs.iSwitch, refs.iSwitch + len).map((v) => nan(v));
  const e0 = model.eased, p1 = variant.params;
  const lim = [Math.max(plan.umin, finite(p1.umin) ? p1.umin : -Infinity), Math.min(plan.umax, finite(p1.umax) ? p1.umax : Infinity)];
  const mix = (a, b, s) => (a > 0 && b > 0 ? a * (b / a) ** s : a + (b - a) * s);
  const theta = model.params.theta ?? 0;
  // The models a step must hold for: the nominal, the samples and the places.
  const S = STRUCTURES[model.structure], gk = GAIN(S);
  const models = [model, ...modelSamples(model, TRY.samples).map((p) => ({ ...model, params: p }))];
  for (const pl of model.where ?? []) if (pl.seen >= GRADE.seen && finite(pl.gain) && finite(pl.scale)) models.push({ ...model, params: { ...model.params, [gk]: pl.gain, [pl.scaleKey]: pl.scale } });
  const rest = model.holds?.[0] ?? { y: r[0], u: plan.u0 };
  // The hold u at r(0): the model's rest moved by r(0) − y₀ over its gain.
  const uHold = S.integrating ? rest.u : rest.u + (r[0] - rest.y) / model.params.K;
  const predict = (gains, m = model) => {
    let d;
    try { d = discretise(m.structure, m.params, Ts); } catch { return null; }
    const law = () => { const L = pidLaw(gains, uHold, lim[0], lim[1], Ts); return (k, yh) => L.step(r[k], yh); };
    return simulateSegment(d, { n: r.length, yStart: r[0], uStart: uHold, law });
  };
  const resid = model.check ? Math.sqrt(model.check.y.reduce((a, v, k) => (v === null ? a : a + (v - model.check.yhat[k]) ** 2), 0) / Math.max(1, model.check.y.length)) : model.noise?.sigma ?? 0;
  const room = Math.min(plan.band[1] - r[0], r[0] - plan.band[0]);
  const monitor = Math.max(TRY.monitor.residuals * resid, TRY.monitor.room * room);
  const span = Math.max(...r) - Math.min(...r) || 1;
  const steps = [];
  let why = null;
  for (const [j, s] of TRY.steps.entries()) {
    const gains = { Kp: mix(e0.Kp, p1.Kp, s), Ki: mix(e0.Ki, p1.Ki, s), Kd: (p1.Kd ?? 0) * s, Tf: p1.Tf ?? 0 };
    const stepVariant = normalizeVariantLike(variant, gains);
    let bad = null;
    for (const m of models) {
      let a;
      try { const placed = withBlockVariant(project, path, stepVariant); const L = identifiedLoop(placed, path, m); a = analyzeLoop(L.plant, L.ctrl, L.Ts, { points: 200 }); } catch (err) { bad = `the model cannot say (${err.message})`; break; }
      if (!a.stable) { bad = m === model ? 'unstable on the model' : 'unstable for a model within its bars or one of its places'; break; }
      if (a.margins.ms > TRY.ms) { bad = `Ms ${fmtNum(a.margins.ms, 3)} above ${TRY.ms}${m === model ? '' : ' for a model within its bars or places'}`; break; }
    }
    const pr = predict(gains);
    let J = null, used = null;
    if (pr) {
      J = tryCost(r, Array.from(pr.y), Array.from(pr.u), { R: span, U: plan.umax - plan.umin, lo: plan.umin, hi: plan.umax }).J;
      used = 1 - tryMargin(r, Array.from(pr.y), plan.band).gRoom;
      if (!bad && used > TRY.room) bad = `predicted to use ${Math.round(100 * used)} % of the room`;
    } else bad ??= 'the model cannot be simulated';
    steps.push({ n: j + 1, s, gains, ok: !bad, why: bad, J, room: used, predicted: pr ? Array.from(pr.y) : null });
    if (bad) { why = `the result is bolder than what the model knows: ${j ? `tried up to step ${j}` : 'not even its first step'} (step ${j + 1}: ${bad})`; break; }
  }
  const ok = steps.filter((x) => x.ok);
  const tryPlan = {
    ...structuredClone(plan), kind: 'try', test: { r }, check: { r },
    eased: { Kp: e0.Kp, Ki: e0.Ki, tauC: e0.tauC ?? 1, theta, lim: [e0.umin ?? plan.umin, e0.umax ?? plan.umax] },
    steps: ok.map((x) => ({ n: x.n, gains: x.gains, lim, predicted: x.predicted, J: x.J, room: x.room })), monitor,
  };
  return { plan: tryPlan, steps: steps.map(({ predicted, ...x }) => x), upto: ok.length, why };
}
// The result's variant with other PID gains (a step of the path), for the
// screening's linear loop.
function normalizeVariantLike(v, g) { return { ...v, params: { ...v.params, Kp: g.Kp, Ki: g.Ki, Kd: g.Kd, Tf: g.Tf || v.params.Tf } }; }
function withBlockVariant(project, path, variant) {
  const p = { ...project, system: { ...project.system, plant: { ...project.system.plant, diagram: structuredClone(project.system.plant.diagram) } } };
  const { block } = locate(p.system.plant.diagram, [].concat(path));
  block.variants = [...block.variants, structuredClone(variant)];
  block.variant = block.variants.length - 1;
  return p;
}

// What Try on the plant ends with (§11): the steps the record shows, and the
// variant to run: the result when every step was as predicted, else the last
// step that was ("<name> · tried 2/3"), else none. → { steps, run, name, all }.
export function tryOutcome(record, tried, variant) {
  const steps = record.log.filter((e) => e.kind === 'step');
  const good = steps.filter((e) => e.accepted);
  const total = tried.plan.steps.length;
  if (good.length === total && total === TRY.steps.length) return { steps, run: variant, all: true };
  if (!good.length) return { steps, run: null, all: false };
  const last = tried.plan.steps[good.length - 1];
  const name = `${variant.name.slice(0, 31)} · tried ${good.length}/${TRY.steps.length}`;
  return { steps, run: { ...structuredClone(variant), name, params: { ...variant.params, Kp: last.gains.Kp, Ki: last.gains.Ki, Kd: last.gains.Kd } }, all: false };
}

// ---- Hide a variation (§13)

// Every physical parameter (flagged vary in the block definitions: masses,
// lengths, gains, times, friction, a transfer function's denominator; and a
// masked model's physical fields, physicalMaskKeys: a tank's shape, a cart's
// masses, rods and friction) scaled by 1 + share·(2ρ − 1), ρ from a seeded generator, in the order the
// blocks are listed (depth first). Two Gain blocks with one value in one
// subsystem are one physical constant and get one factor (the motor's Kt and
// Ke, 0.5 each: equal in SI units, or the motor would make energy). Sources,
// Sinks, Controllers, Observers, limits, Ts, noise, quantisers, ports and an
// integrator's K are not varied. Returns { diagram (a copy), factors: [{ path,
// block, param, value, factor }] }.
// A mask's physical fields: those it flags (a component's: the Servo motor's
// R, L, K, b, Jm and its gear's stiffness), else every field but g and the
// start values (the physics models', physicalMaskKeys); a field folded under
// a toggle or a choice that is off is not in the model, and is left.
function maskPhysics(mask, params) {
  const on = (under) => {
    if (under === undefined) return true;
    const [k, opt] = under.split(':'), f = mask.find((g) => g.key === k);
    const v = params[k] ?? f?.default;
    return opt === undefined ? v === true || v === 'on' || Number(v) === 1 : v === opt;
  };
  const flagged = mask.some((f) => f.physical);
  const keys = new Set(flagged ? mask.filter((f) => f.physical).map((f) => f.key) : physicalMaskKeys(mask));
  return mask.filter((f) => keys.has(f.key) && !f.kind && on(f.under));
}

export function varyDiagram(diagram, share, seed) {
  if (!(share >= 0 && share < 1)) throw new Error('varyDiagram: the share lies in [0, 1)');
  if (!Number.isInteger(seed)) throw new Error('varyDiagram: the seed is a whole number');
  const d = structuredClone(diagram);
  const rnd = seeded(seed * 7919 + 17);
  const factors = [];
  const walk = (level, path) => {
    const drawn = new Map();
    const factor = (kind) => {
      if (!drawn.has(kind)) drawn.set(kind, 1 + share * (2 * rnd() - 1));
      return drawn.get(kind);
    };
    for (const b of level.blocks) {
      if (b.type === 'subsystem') {
        // A masked model (the tank, a cart, the Servo motor): its mask's
        // physical fields, each drawn on its own; the blocks inside refer to
        // them by name (a component's insides come from its table).
        if (b.mask) {
          const name = b.name ?? b.id;
          b.params ??= {};
          for (const field of maskPhysics(b.mask, b.params)) {
            const x = Number(b.params[field.key] ?? field.default);
            if (!finite(x) || x === 0) continue;
            const f = 1 + share * (2 * rnd() - 1);
            b.params[field.key] = x * f;
            factors.push({ path: [...path, b.id].join('/'), block: name, param: field.key, label: `${name}, ${field.label}`, value: x, factor: f });
          }
        }
        // A component's insides are its table's, set by its mask alone.
        if (!b.component) walk(b.diagram, [...path, b.id]);
        continue;
      }
      let def;
      try { def = diagramBlockDef(b.type); } catch { continue; }
      for (const spec of def.params ?? []) {
        if (!spec.vary) continue;
        const v = b.params?.[spec.key];
        const vs = Array.isArray(v) ? v.map((x, j) => [`${spec.key}[${j}]`, x, j]) : [[spec.key, v, -1]];
        for (const [param, x, j] of vs) {
          if (!finite(x) || x === 0) continue;
          // Two Gain blocks of one value in one subsystem are one constant;
          // every other parameter is drawn on its own.
          const f = b.type === 'gain' ? factor(`gain=${x}`) : 1 + share * (2 * rnd() - 1);
          const nv = x * f;
          if (j >= 0) b.params[spec.key][j] = nv; else b.params[spec.key] = nv;
          // In plain words for the reveal: a gain by its block's name; a
          // transfer function's coefficient by the power of s it goes with.
          const name = b.name ?? b.id, power = j >= 0 ? v.length - 1 - j : -1;
          const label = b.type === 'gain' ? name : j >= 0 ? `${name}, its ${power === 0 ? 'constant' : power === 1 ? 's' : `s^${power}`} term` : `${name}, ${spec.label ?? spec.key}`;
          factors.push({ path: [...path, b.id].join('/'), block: name, param, label, value: x, factor: f });
        }
      }
    }
  };
  walk(d, []);
  return { diagram: d, factors };
}

// ---- The whole test on a simulated plant (§16)

// The whole test on a simulated plant, as a generator, for the page and for
// Node: the experiment runs as the hidden law of the block in a copy of the
// diagram (createStepRunner), the r Source plays its reference, every other
// Source is held; at the fit pause the record so far is fitted (as Keep
// stores it) and supplied before the next sample, so the record does not
// depend on how long the fit takes; then the model from the record. It
// yields { kind: 'sample', k, t, values } once per controller sample (plant
// time passes; values in the order of run.names) and { kind: 'fit', stage:
// 'pause' | 'model' } while it fits (no plant time passes), and returns what
// identify() returns. run.exp is the experiment (its state for the page),
// run.stop() asks for its soft Stop. opts: plan (a plan made already: Check
// again's), recheck ({ model, record }: Check again ends with its verdict,
// recheckFit, instead of a model). settings: { band, budget, vary: {
// share, seed } | null, structure, seed }, over the stored ones
// (system.identify[key]).
export function identifyRun(project, path = null, settings = {}, { plan: ready = null, recheck = null } = {}) {
  const known = knownFor(project, path);
  if (known.live) throw new IdentifyError('live', 'this plant runs outside the page: it is identified in the page while connected', 'identify() simulates the plant; a live plant runs in the page');
  const stored = project.system.identify?.[known.block.key] ?? {};
  const given = Object.fromEntries(Object.entries(settings ?? {}).filter(([, v]) => v !== undefined));
  const merged = { ...stored, ...given };
  const s = settingsFor(known, merged);
  const plan = ready ?? planExperiment(known, s);
  const vary = merged.vary ?? null;
  let diagram = project.system.plant.diagram, factors = null;
  if (vary) {
    if (!(vary.share > 0 && vary.share < 1) || !Number.isInteger(vary.seed)) throw new IdentifyError('vary', 'Hide a variation needs a share between 0 and 1 and a whole seed', 'for example ±15 %, seed 7');
    ({ diagram, factors } = varyDiagram(diagram, vary.share, vary.seed));
  }
  const Ts = plan.Ts;
  let exp = null;
  const kOf = (t) => Math.floor(t / Ts + 1e-9);
  const sources = {};
  if (known.r?.source) sources[known.r.source] = (t) => (exp ? exp.reference(kOf(t)) : 0);
  for (const o of plan.others) sources[o.name] = () => o.value;
  const runner = createStepRunner(diagram, project.system.signals, { Ts, sources, variants: { [known.block.key]: { name: 'Identify', type: 'experiment', params: { plan } } } });
  exp = runner.law(known.block.key).experiment;
  const most = Math.ceil((plan.budget + EXPERIMENT.pause.wait + 10) / Ts);
  let pre = null;
  function* steps() {
    for (let k = 0; k <= most && !exp.state.done; k++) {
      const v = runner.step();
      yield { kind: 'sample', k: v.k, t: v.t, values: v.values };
      if (exp.needs?.kind === 'fit') {
        // The fit pause: fitted at once on the data so far, as Keep stores it.
        const upto = exp.needs.upto;
        pre = yield* tagged(identifySteps(compactRecord(exp.record()), { plan, upto }), 'pause');
        exp.supply('fit', fitSupply(pre, exp));
      } else if (exp.needs?.kind === 'discriminate') {
        // After the Check: do two shapes still tie? Then a test that tells them apart.
        exp.supply('discriminate', yield* tagged(discriminateSteps(exp.record(), plan, pre), 'discriminate'));
      }
    }
    if (!exp.state.done) exp.stop();
    const record = compactRecord(exp.record());
    if (plan.kind === 'try') {
      const end = exp.state.end;
      return { ok: end.code === 'done', block: known.block, plan, record, end: { code: end.code, message: end.message }, time: record.y.length * Ts, steps: record.log.filter((e) => e.kind === 'step') };
    }
    if (recheck) {
      const end = exp.state.end;
      return { ok: end.code === 'done', block: known.block, plan, record, end: { code: end.code, message: end.message }, time: record.y.length * Ts, recheck: recheckFit(recheck.model, record, recheck.record) };
    }
    const model = yield* tagged(identifySteps(record, { plan, structure: s.structure, reuse: pre }), 'model');
    const end = exp.state.end;
    return {
      ok: !!model.ok, block: known.block, plan, settings: { band: s.band.value, budget: s.budget.value, structure: s.structure },
      vary: vary ? { share: vary.share, seed: vary.seed, factors } : null,
      record, model, end: { code: end.code, message: end.message }, time: record.y.length * Ts, tries: exp.state.tries,
    };
  }
  // pre: the model fitted at the pause (the page draws the Check's prediction from it).
  return { known, plan, settings: s, vary, factors, runner, exp, names: runner.names(), steps: steps(), stop: () => exp.stop(), get pre() { return pre; } };
}

// What the page supplies at a fit pause: the model's shape and numbers, and,
// at the first pause, whether the Shake should look closer (§5.6: when the
// ladder's model is unsure, ! or ✕ for any reason but that no Check ran yet).
export function shakeWanted(model) {
  return !model?.ok || model.why.some((w) => w !== 'no Check ran');
}
export function fitSupply(model, exp = null) {
  const first = !exp || !exp.record().log.some((e) => e.kind === 'shake' || (e.kind === 'note' && /the Shake/.test(e.text)));
  return { ...(model?.ok ? { structure: model.structure, params: model.params } : {}), shake: first && shakeWanted(model) };
}

// What the page answers the experiment after the Check (input 56): the
// model so far (the pause's fits, the Check graded) and, if two shapes tie,
// the test that tells them apart. For the page and the live loop too.
export function* discriminateSteps(record, plan, pre) {
  const rec = compactRecord(record);
  const so = yield* identifySteps(rec, { plan, reuse: pre });
  return designDiscrimination(so, rec, plan) ?? {};
}

function* tagged(gen, stage) {
  for (;;) { const s = gen.next(); if (s.done) return s.value; yield { kind: 'fit', stage }; }
}

// The whole test on a simulated plant, synchronously, for Node, the command
// line and the tests (identifyRun to its end). Returns { ok, block, plan,
// settings, vary, record, model, end, time, tries }.
export function identify(project, path = null, settings = {}) {
  return drain(identifyRun(project, path, settings).steps);
}

// The Shake's frequency response at each place (§6.7, fit.js frf): its
// measured periods (those without a lost cycle, the ramp's left out), u as
// the plant applied it; Ĝ with its 2σ at the excited lines, the distortion,
// the model's sampled response G_d there (the zero-order hold and the
// fractional dead time: §6.7) and the share of lines it holds within 2σ.
function shakeResponses(record, shakes, model, Ts) {
  const out = [];
  const ramp = EXPERIMENT.shake.ramp.length;
  let d = null;
  try { d = discretise(model.structure, model.p ?? model.params, Ts); } catch { d = null; }
  for (const e of shakes) {
    if (e.left) continue;
    const ex = excitationOf(e, Ts);
    const lost = (a, b) => (record.gaps ?? []).some(([i]) => i >= a && i < b);
    const keep = e.starts.slice(ramp).filter((a, j) => e.amps[ramp + j] === e.amps.at(-1) && !lost(a, a + e.N) && a + e.N <= record.y.length);
    if (keep.length < 2) continue;
    const col = (src, a) => Array.from({ length: e.N }, (_, j) => { const v = nan(src[a + j]); return finite(v) ? v : 0; });
    const U = keep.map((a) => col(record.applied?.some((v) => v !== null) ? record.applied.map((v, i) => (v === null ? record.u[i] : v)) : record.u, a));
    const Y = keep.map((a) => col(record.y, a));
    let F;
    try { F = frf(U, Y, { excited: ex.lines.excited, detect: ex.lines.detect, Ts }); } catch { continue; }
    const Gd = d ? F.f.map((f) => discreteAt(d, 2 * Math.PI * f * Ts)) : null;
    const inside = Gd ? F.G.filter((g, j) => Math.hypot(g.re - Gd[j][0], g.im - Gd[j][1]) <= 2 * F.sd[j]).length / F.G.length : null;
    out.push({
      place: e.place, periods: keep.length, f: F.f, G: F.G.map((g) => [g.re, g.im]), sd: F.sd, model: Gd,
      distortion: { share: F.distortion.share, odd: F.distortion.odd, even: F.distortion.even }, within: inside,
    });
  }
  return out;
}

// ---- Telling two shapes apart (input 56)

// When two shapes still tie on the Check (within CHOICE.within points), the
// page designs a test input on which their predictions differ most against
// the noise (model discrimination: Box and Hill 1967; T-optimality,
// Atkinson and Fedorov 1975): a pulse, a step, or a burst at either shape's
// own frequency, added to the incumbent's output while it holds y where the
// Check ended, its size half the largest push the loop used, smaller where a
// shape predicts it would use more than half the room. separation: the
// predictions' difference, in noise floors over the test, below which they
// predict the same (and the simpler stays), the floor at least a thousandth
// of the band (a simulation without noise would tell anything apart).
// clear: the shape that predicted the test must miss it by at most this
// share of the other's miss (rms), and fit it at least GRADE.fair, or the
// simpler stays.
export const DISCRIMINATE = { separation: 20, floor: 1e-3, room: 0.5, push: 1, longest: 10, clear: 0.9 };

// model: the model so far (the Check included); record: the record so far;
// plan: the plan. Returns { shape, a, n, f, candidates, separation } to play,
// or { why } (a note) or null when no two shapes tie.
export function designDiscrimination(model, record, plan) {
  if (!model?.ok || !model.check) return null;
  const pool = model.candidates.filter((c) => !c.unsupported && finite(c.fit));
  if (pool.length < 2) return null;
  const best = Math.max(...pool.map((c) => c.fit));
  const tied = pool.filter((c) => c.fit >= best - CHOICE.within);
  if (tied.length < 2) return null;
  const A = tied.find((c) => c.structure === model.structure) ?? tied[0];
  const B = tied.filter((c) => c !== A).reduce((a, b) => (b.fit > a.fit ? b : a));
  const g = readLog(record), Ts = record.Ts, n0 = record.y.length;
  const law = g.laws.at(-1);
  if (!law || !g.listen) return null;
  const w = Math.max(1, Math.ceil(EXPERIMENT.hold.settle / Ts - 1e-9));
  const rest = restBefore(record, n0, w), level = nan(record.r[n0 - 1]);
  const floor = Math.max(model.noise?.floor ?? g.listen.floor, DISCRIMINATE.floor * (plan.band[1] - plan.band[0]));
  let push = 0;
  for (let j = law.i ?? 0; j < n0; j++) { const u = nan(record.u[j]); if (finite(u)) push = Math.max(push, Math.abs(u - rest.u)); }
  const U = plan.umax - plan.umin;
  const a0 = Math.max(0.01 * U, DISCRIMINATE.push * push);
  const scale = (c) => { const p = c.params; return p.f ? 1 / (2 * Math.PI * p.f) : Math.max(...STRUCTURES[c.structure].times(p)); };
  const freq = (c) => (c.params.f ? c.params.f * Math.sqrt(Math.max(0.05, 1 - (c.params.zeta ?? 0) ** 2)) : 1 / (2 * Math.PI * scale(c)));
  const slow = Math.max(scale(A), scale(B), A.params.theta ?? 0, B.params.theta ?? 0, Ts);
  const longest = Math.min(DISCRIMINATE.longest, plan.budget / 10);
  const steps = (x) => Math.max(2, Math.min(Math.round(longest / Ts), Math.round(x / Ts)));
  const shapes = [
    { shape: 'pulse', n: steps(Math.max(2 * Ts, slow / 2)) },
    { shape: 'step', n: steps(4 * slow) },
    ...[A, B].map((c) => { const f = Math.min(freq(c), 0.4 / Ts); return { shape: 'burst', f, n: steps(4 / f) }; }),
  ];
  const [lo, hi] = plan.band, room = Math.min(hi - level, level - lo);
  const predict = (c, d) => {
    const sig = discriminationSignal(d, Ts), N = d.n + Math.ceil(EXPERIMENT.discriminate.rest * d.n);
    return simulateSegment(discretise(c.structure, c.params, Ts), {
      n: N, yStart: rest.y, uStart: rest.u,
      law: () => { const pi = piLaw(law, bumpless(law, rest.u, level, rest.y), law.umin, law.umax, Ts); return (k, yh) => Math.min(plan.umax, Math.max(plan.umin, pi.step(level, yh) + (sig[k] ?? 0))); },
    }).y;
  };
  let pickD = null;
  for (const sh of shapes) {
    let d = { ...sh, a: a0 };
    let yA = predict(A, d), yB = predict(B, d);
    const used = Math.max(...[...yA, ...yB].map((v) => Math.abs(v - level)));
    if (!(room > 0)) continue;
    if (used > DISCRIMINATE.room * room) { d = { ...d, a: (a0 * DISCRIMINATE.room * room) / used }; yA = predict(A, d); yB = predict(B, d); }
    let e = 0;
    for (let k = 0; k < yA.length; k++) e += (yA[k] - yB[k]) ** 2;
    const sep = Math.sqrt(e) / floor;
    if (!pickD || sep > pickD.separation) pickD = { ...d, separation: sep };
  }
  if (!pickD || !(pickD.separation >= DISCRIMINATE.separation)) {
    return { why: `${A.label} and ${B.label} predict the same within the noise on any test the room allows: the simpler is kept` };
  }
  const { shape, a, n, f = null, separation } = pickD;
  return { shape, a, n, f, candidates: [A.structure, B.structure], separation };
}

// How well each model ({ structure, params }) predicts the record's test
// that tells shapes apart (its log entry): replayed from the settled start,
// under the logged law, its test input added as played. → { structure: fit % }.
export function tellApart(record, plan, models) {
  const g = readLog(record), D = g.discriminate, Ts = record.Ts;
  if (!D || !g.listen) return {};
  const seg = closedSegment(record, g.laws, D.iStart, D.iEnd, Math.max(1, Math.ceil(EXPERIMENT.hold.settle / Ts - 1e-9)), 'discriminate', { excites: [D], limits: [plan.umin, plan.umax] });
  const fs = fitSegment(record, seg, g.listen, Ts);
  const out = {};
  for (const m of models) {
    const yh = simulateSegment(discretise(m.structure, m.params, Ts), fs).y;
    const y = [], h = [];
    for (let k = 0; k < yh.length; k++) if (finite(fs.y[k])) { y.push(fs.y[k]); h.push(yh[k]); }
    out[m.structure] = fitPercent(y, h);
  }
  return out;
}

// ---- Check again (§14)

// How many points a Check again may lose against the model's own Check
// before the plant counts as changed.
export const RECHECK = { points: 5 };

// The plan of a Check again: Listen, then the controller that held the
// Check before brings y to the Check's start, and the Check's reference as
// it was played (from the record the model came from). plan: that record's
// plan. Throws when the model has no Check to repeat.
export function planRecheck(plan, model, record) {
  const g = readLog(record);
  if (!model?.ok || !g.check) throw new IdentifyError('recheck', 'this model had no Check to repeat: identify again', 'Check again repeats a test that ended done');
  const r = record.r.slice(g.check.iStart, g.check.iEnd).map((v) => nan(v));
  let law = null;
  for (const e of g.laws) if (e.i <= g.check.iStart) law = e;
  if (!law || r.length < 2) throw new IdentifyError('recheck', 'this model had no Check to repeat: identify again');
  return { ...structuredClone(plan), kind: 'recheck', test: { r }, check: { r }, law: { Kp: law.Kp, Ki: law.Ki, tauC: law.tauC ?? 1, theta: model.params.theta ?? 0, lim: [law.umin, law.umax] } };
}

// A Check again's verdict: the model replayed over the new record's Check
// (from its settled start, under the logged law, fed its own y) against the
// same replay of the Check of the record the model came from (original), so
// both are read the same way; without it, against the model's own Check fit.
// Returns { fit, was, still, message }.
export function recheckFit(model, record, original = null) {
  const now = checkReplayFit(model, record);
  if (now === null) return { fit: null, was: model.check?.fit ?? null, still: false, message: 'the Check did not run: identify again' };
  const was = (original && checkReplayFit(model, original)) ?? model.check?.fit ?? model.fit;
  const still = now >= was - RECHECK.points;
  return { fit: now, was, still, message: still ? `still fits ✓ (${pctText(now)} % now, ${pctText(was)} % when it was identified)` : `the plant has changed: identify again (${pctText(now)} % now, ${pctText(was)} % when it was identified) ✕` };
}
function checkReplayFit(model, record) {
  const g = readLog(record);
  if (!g.check || !g.listen) return null;
  const Ts = record.Ts, w = Math.max(1, Math.ceil(EXPERIMENT.hold.settle / Ts - 1e-9));
  const seg = closedSegment(record, g.laws, g.check.iStart, g.check.iEnd, w, 'check');
  const fs = fitSegment(record, seg, g.listen, Ts);
  const yh = simulateSegment(discretise(model.structure, model.params, Ts), fs).y;
  const y = [], h = [];
  for (let k = 0; k < yh.length; k++) if (finite(fs.y[k])) { y.push(fs.y[k]); h.push(yh[k]); }
  return y.length > 2 ? fitPercent(y, h) : null;
}

// ---- What the page draws from a model (§4, §5.7)

// The model's 50 parameter samples (§6.5), for the bands.
export function modelSamples(model, count = 50) {
  if (!model?.structure) return [];
  return parameterSamples(model.structure, model.params, model.cov, model.Ts, count);
}

// The Check's prediction, drawn before it runs (§5.7), replayed as the
// fits replay the record (§6.1): from the last rest the model was fitted
// from (the start of its last closed-loop segment), under the laws the log
// names, fed the model's own y, through the record so far and on into the
// Check's reference r (samples at Ts from the record index `at` where it
// starts). record: the record so far. Returns { y, lo, hi } from `at` on:
// the prediction and its 2σ band from the parameter samples.
export function predictCheck(model, record, { at, r }) {
  const Ts = model.Ts, N = r.length;
  const w = Math.max(1, Math.ceil(EXPERIMENT.hold.settle / Ts - 1e-9));
  const a = Math.min(at, model.segments?.closed?.at(-1)?.[0] ?? at);
  // Ahead, y is a placeholder (only the law runs there, on the model's y).
  const ahead = { ...record, y: [...record.y.slice(0, at), ...new Array(N).fill(0)], u: [...record.u.slice(0, at), ...new Array(N).fill(0)], r: [...record.r.slice(0, at), ...r], applied: [] };
  const g = readLog(record);
  const seg = closedSegment(ahead, g.laws, a, at + N, w, 'check');
  const fs = fitSegment(ahead, seg, g.listen, Ts);
  const run = (p) => {
    try { return simulateSegment(discretise(model.structure, p, Ts), fs).y.subarray(at - a); } catch { return null; }
  };
  const y = run(model.params);
  return { y, ...spreadOf(modelSamples(model).map(run).filter(Boolean), y) };
}

// The 2σ band of a set of curves about the nominal one: their standard
// deviation at each point, twice, either side.
function spreadOf(curves, y) {
  const lo = new Float64Array(y.length), hi = new Float64Array(y.length);
  for (let k = 0; k < y.length; k++) {
    let ss = 0, n = 0;
    for (const c of curves) if (finite(c[k])) { ss += (c[k] - y[k]) ** 2; n++; }
    const b = n ? 2 * Math.sqrt(ss / n) : 0;
    lo[k] = y[k] - b; hi[k] = y[k] + b;
  }
  return { lo, hi };
}

// The model's step response to one unit of u, from rest, over `seconds`,
// with its 2σ band (the Step plot).
export function modelStep(model, seconds) {
  const Ts = model.Ts, N = Math.max(2, Math.ceil(seconds / Ts) + 1);
  const run = (p) => { try { return simulateSegment(discretise(model.structure, p, Ts), { u: new Float64Array(N).fill(1), yStart: 0, uStart: 0, n: N }).y; } catch { return null; } };
  const y = run(model.params);
  const t = Float64Array.from({ length: N }, (_, k) => k * Ts);
  return { t, y, ...spreadOf(modelSamples(model).map(run).filter(Boolean), y) };
}

// The model's frequency response at angular frequencies w (rad/s), as the
// sampled loop sees it (the discretised model, zero-order hold and dead time
// included: §6.7), with the magnitude's 2σ band. Returns { w, mag, phase
// (degrees, unwrapped), lo, hi }.
export function modelBode(model, w) {
  const Ts = model.Ts;
  const resp = (p) => {
    let d;
    try { d = discretise(model.structure, p, Ts); } catch { return null; }
    return w.map((om) => discreteAt(d, om * Ts));
  };
  const g = resp(model.params);
  const mag = g.map((z) => Math.hypot(z[0], z[1]));
  const phase = [];
  let last = 0;
  g.forEach((z, i) => { let ph = (Math.atan2(z[1], z[0]) * 180) / Math.PI; if (i) while (ph - last > 180) ph -= 360; if (i) while (ph - last < -180) ph += 360; phase.push(ph); last = ph; });
  const curves = modelSamples(model).map(resp).filter(Boolean).map((c) => c.map((z) => Math.hypot(z[0], z[1])));
  const { lo, hi } = spreadOf(curves, Float64Array.from(mag));
  return { w, mag, phase, lo, hi };
}

// G_d(e^{jΩ}) of a discretised model (fit.js discretise: x⁺ = Φx + G0·Δu[k−m]
// + G1·Δu[k−m−1], y = Cx): C (zI − Φ)⁻¹ (G0 + G1 z⁻¹) z⁻ᵐ, as [re, im].
function discreteAt(d, Om) {
  const n = d.n, zr = Math.cos(Om), zi = Math.sin(Om);
  // (zI − Φ) as a complex matrix, solved for (G0 + G1/z) by Gaussian elimination.
  const ar = d.Phi.map((row, i) => row.map((v, j) => (i === j ? zr : 0) - v)), ai = d.Phi.map((row, i) => row.map((_, j) => (i === j ? zi : 0)));
  const iz = [Math.cos(-Om), Math.sin(-Om)];
  const br = d.G0.map((g0, i) => g0 + d.G1[i] * iz[0]), bi = d.G1.map((g1) => g1 * iz[1]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.hypot(ar[r][c], ai[r][c]) > Math.hypot(ar[piv][c], ai[piv][c])) piv = r;
    [ar[c], ar[piv]] = [ar[piv], ar[c]]; [ai[c], ai[piv]] = [ai[piv], ai[c]]; [br[c], br[piv]] = [br[piv], br[c]]; [bi[c], bi[piv]] = [bi[piv], bi[c]];
    const pr = ar[c][c], pi = ai[c][c], den = pr * pr + pi * pi;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const fr = (ar[r][c] * pr + ai[r][c] * pi) / den, fi = (ai[r][c] * pr - ar[r][c] * pi) / den;
      for (let j = c; j < n; j++) { const xr = ar[c][j], xi = ai[c][j]; ar[r][j] -= fr * xr - fi * xi; ai[r][j] -= fr * xi + fi * xr; }
      const xr = br[c], xi = bi[c]; br[r] -= fr * xr - fi * xi; bi[r] -= fr * xi + fi * xr;
    }
  }
  let sr = 0, si = 0;
  for (let c = 0; c < n; c++) {
    const pr = ar[c][c], pi = ai[c][c], den = pr * pr + pi * pi;
    const xr = (br[c] * pr + bi[c] * pi) / den, xi = (bi[c] * pr - br[c] * pi) / den;
    sr += d.C[c] * xr; si += d.C[c] * xi;
  }
  // z⁻ᵐ
  const mr = Math.cos(-d.m * Om), mi = Math.sin(-d.m * Om);
  return [sr * mr - si * mi, sr * mi + si * mr];
}
