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
import { parseEnd, ELEMENTS, diagramBlockDef } from './diagram.js';
import { referenceFn, gaussAt } from './signals.js';
import { IDENTIFY_VERSION, EXPERIMENT, halved, piLaw, bumpless, fmtNum } from './experiment.js';
import {
  STRUCTURES, discretise, simulateSegment, fitStructureSteps, lmSteps, observations, noiseTransfer, parameterCov, chooseStructure, unsupported,
  fitPercent, noiseCeiling, whiteness, crossCorrelation, tcKernelSteps, kernelStep, kernelGuess, seeded,
} from './fit.js';
import { cholesky, c2d } from './linalg.js';
import { createStepRunner } from './live.js';

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
    supply: one('supply'), pause: one('pause'), check: one('check'), end: one('end'), notes: all('note'),
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
function closedSegment(record, laws, a, b, w, role) {
  const rest = restBefore(record, a, w);
  let before = null;
  for (const e of laws) if (e.i < a) before = e;
  return {
    kind: 'closed', role, i0: a, i1: b, yStart: rest.y, uStart: rest.u, rPrev: nan(record.r[Math.max(0, a - 1)]),
    before: before ? lawOf(before) : null, switches: laws.filter((e) => e.i >= a && e.i < b).map(lawOf),
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
  const o0 = g.rungs[0].i0, o1 = Math.min(iHold, F);
  if (o1 - o0 > 2) out.open = { kind: 'open', role: 'nudge', i0: o0, i1: o1, yStart: L.y0 + L.slope * (o0 - iL), uStart: plan.u0, slope: L.slope, iL, level: L.y0 };
  if (hold && iHold < F) {
    const cuts = [iHold, ...g.tries.filter((T) => T.settled && T.iSwitch > iHold && T.iSwitch < F).map((T) => T.iSwitch)];
    cuts.forEach((a, j) => {
      const b = j + 1 < cuts.length ? cuts[j + 1] : F;
      if (b - a > 2) out.closed.push(closedSegment(record, g.laws, a, b, w, j === 0 ? 'hold' : 'try'));
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
    const c = closedSegment(record, g.laws, start, ck.i1, w, 'check');
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
  out.law = () => {
    let law = before ? piLaw(before, bumpless(before, seg.uStart, seg.rPrev, seg.yStart), before.umin, before.umax, Ts) : null;
    let uLast = seg.uStart;
    return (k, yh) => {
      if (hold[k]) return uLast;
      const e = at.get(k);
      if (e) law = piLaw(e, bumpless(e, uLast, r[k], yh), e.umin, e.umax, Ts);
      const u = law ? law.step(r[k], yh) : uLast;
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
  const n = A.length, gain = p[GAIN(S)];
  const Ap = S.integrating ? A : A.map((row, i) => row.map((v, j) => v + (B[i][0] / gain) * C[0][j]));
  const ds = Math.max(0, (p.theta ?? 0) / Ts);
  let m = Math.floor(ds + 1e-9), f = ds - m;
  if (f < 1e-9) f = 0;
  let Phi, G0, G1;
  if (f === 0) {
    const d = c2d(Ap, B, Ts);
    Phi = d.Ad; G0 = d.Bd.map((r) => r[0]); G1 = new Array(n).fill(0);
  } else {
    const a = c2d(Ap, B, (1 - f) * Ts), b = c2d(Ap, B, f * Ts);
    Phi = a.Ad.map((r) => b.Ad[0].map((_, j) => r.reduce((acc, v, k) => acc + v * b.Ad[k][j], 0)));
    G0 = a.Bd.map((r) => r[0]);
    G1 = a.Ad.map((r) => r.reduce((acc, v, k) => acc + v * b.Bd[k][0], 0));
  }
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
  try { res = yield* lmSteps(residual, q0, { maxIter: 40, lower: q0.map(() => -46), upper: q0.map(() => 46) }); } catch { return null; }
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
export const GRADE = { good: 85, ceiling: 3, fair: 60, distortion: [10, 30], where: 0.25, kernel: 5 };

// The grade and its reasons (§7): ✓, ! or ✕; grades inform and never block.
export function gradeOf({ fit, ceiling = -Infinity, white = true, distortion = null, spread = 0, kernelGap = 0, left = false, checked = true }) {
  const why = [];
  if (left) return { mark: '✕', why: ['the Check left the band'] };
  if (!finite(fit) || fit < GRADE.fair) why.push(`it explains under ${GRADE.fair} %`);
  if (distortion !== null && distortion > GRADE.distortion[1]) why.push(`${Math.round(distortion)} % of the response is not linear`);
  if (why.length) return { mark: '✕', why };
  if (!(fit >= GRADE.good || fit >= ceiling - GRADE.ceiling)) why.push(`it explains under ${GRADE.good} %`);
  if (distortion !== null && distortion >= GRADE.distortion[0]) why.push(`${Math.round(distortion)} % of the response is not linear`);
  if (spread >= GRADE.where) why.push('it behaves differently at different places');
  if (!white) why.push('what is left has a pattern');
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
// A fit in %: whole points, one decimal above 99 (99.8 is not 100).
const pctText = (x) => (x >= 99 && x < 100 ? (Math.floor(x * 10) / 10).toFixed(1) : String(Math.round(x)));
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
  // A dead time is said when the data show one: beyond its 2σ bar (or, with
  // no bar, at least half a sample).
  if (sd.theta !== null && sd.theta !== undefined ? p.theta > 2 * sd.theta && p.theta > 0 : p.theta >= model.Ts / 2) out.push(`Responds after ${timeText(p.theta)}.`);
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
  const seenPlaces = (model.where ?? []).filter((pl) => pl.seen >= 0.1);
  if (W?.flagged && seenPlaces.length >= 2) {
    const a = seenPlaces[0], b = seenPlaces.at(-1);
    const at = (v) => withU(fmtNum(v, 2), n.yUnit);
    out.push(`Behaves differently at different places: near ${at(a.level)}, ${one}${S.integrating ? ' for 1 s' : ''} moves it ${at(a.gain)}; near ${at(b.level)}, ${at(b.gain)}. The model is a compromise between them.`);
  }
  if (model.sizeNote) out.push(model.sizeNote);
  const noise = model.noise;
  const noiseLine = !noise ? null : noise.none ? 'This plant has no noise; real plants do.'
    : noise.steps && !(noise.sigma > 0.5 * noise.q / Math.sqrt(12)) ? `Noise on ${n.y}: only its steps of ${withU(fmtNum(noise.q, 2), n.yUnit)} (an encoder).`
      : `Noise on ${n.y}: ${withU(fmtNum(noise.sigma, 2), n.yUnit)}${noise.steps ? `, in steps of ${withU(fmtNum(noise.q, 2), n.yUnit)} (an encoder)` : ''}.`;
  const c = model.check;
  let grade;
  if (c && !finite(c.fit)) grade = `The Check did not move ${n.y}, so the model could not be checked ${model.grade}.`;
  else if (c) grade = `Explains ${pctText(c.fit)} % of a test it was not fitted to; what is left ${c.white ? 'looks like noise' : 'has a pattern'} ${model.grade}.`;
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
  const inc = g.ladder?.incumbent ?? 0;
  const T = inc ? g.tries.find((t) => t.n === inc) : null;
  const holdLaw = [...g.laws].reverse().find((e) => e.role === 'hold') ?? null;
  const src = T ?? holdLaw;
  if (!src) return null;
  return { Kp: src.Kp, Ki: src.Ki, tauC: src.tauC, umin: plan.umin, umax: plan.umax, try: inc || null };
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

  // The fits (§6.3): two starts each, the first look's and the kernel's.
  const fits = reused ? reused.fits : {};
  if (!reused) {
    for (const name of tried) {
      const S = STRUCTURES[name];
      const starts = [signed(S.start(lookGuess(look)), S, sign)];
      if (guessK) starts.push(signed(S.start(guessK), S, sign));
      try { fits[name] = yield* fitStructureSteps(fitSegs, name, starts, { Ts, maxIter: 60 }); } catch { fits[name] = null; }
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
  const ceiling = ckSeg ? noiseCeiling(measured(ckY).y, L.floor) : null;
  const scoreCheck = (yh) => {
    const m = measured(yh);
    const res = m.y.map((v, k) => v - m.h[k]);
    const w = whiteness(res), x = crossCorrelation(res, m.u.map((v) => (finite(v) ? v : 0)));
    return { fit: fitPercent(m.y, m.h), white: w.white, independent: x.independent, whiteness: w, cross: x };
  };
  let kernelFit = null;
  if (kernel && ckSeg) { try { kernelFit = scoreCheck(kernelReplay(kernel, ckSeg)).fit; } catch { kernelFit = null; } }
  const candidates = [];
  for (const name of tried) {
    const f = fits[name];
    if (!f) continue;
    const why = unsupported(name, f.p, { length });
    let check = null;
    if (ckSeg) check = scoreCheck(simulateSegment(discretise(name, f.p, Ts), ckSeg).y);
    const fitAll = (() => {
      const yh = fitSegs.map((fs) => simulateSegment(discretise(name, f.p, Ts), fs).y);
      const y = [], h = [];
      fitSegs.forEach((fs, s) => { for (let k = 0; k < fs.y.length; k++) if (finite(fs.y[k])) { y.push(fs.y[k]); h.push(yh[s][k]); } });
      return fitPercent(y, h);
    })();
    const gr = gradeOf({ fit: check ? check.fit : fitAll, ceiling: ceiling ?? -Infinity, white: check ? check.white : true, kernelGap: check && kernelFit !== null ? kernelFit - check.fit : 0, left: !!seg.check?.left, checked: !!check });
    candidates.push({
      structure: name, label: STRUCTURES[name].label, glyph: STRUCTURES[name].glyph, p: f.p, sd: f.sd, cov: plainCov(f.cov),
      fit: check ? check.fit : NaN, fitted: fitAll, chi2dof: f.chi2dof, bic: f.bic, unsupported: why, grade: gr.mark, why: why ? [why] : gr.why, check,
    });
  }
  if (!candidates.length) return none('no model could be fitted to this test');

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
  if (structure && candidates.some((c) => c.structure === structure)) { index = candidates.findIndex((c) => c.structure === structure); chosenWhy = 'your choice'; }
  const chosen = candidates[index];
  const S = STRUCTURES[chosen.structure];

  // Where (§6.6): the gain and the main time scale refitted per place (the
  // thirds of the levels visited), and the hold curve measured where y sat
  // still at r (the u that held it there). Places differ when their gains
  // or time scales differ by more than 25 % and beyond their 2σ bars, among
  // the places the model spent at least a tenth of its time in.
  let where = [];
  const hN = fitSegs.map((fs) => noiseTransfer(discretise(chosen.structure, chosen.p, Ts), fs));
  const placed = yield* placeFit(fitSegs, chosen.structure, chosen.p, chosen.cov, seg.levels, Ts, hN);
  if (placed) {
    const total = placed.reduce((a, pl) => a + pl.samples, 0);
    where = placed.map((pl) => {
      const near = seg.holds.filter((h) => h.y >= pl.from - 1e-12 && h.y <= pl.to + 1e-12);
      return { ...pl, seen: pl.samples / Math.max(1, total), hold: near.length ? near.reduce((a, h) => a + h.u, 0) / near.length : null, holdAt: near.length ? near.reduce((a, h) => a + h.y, 0) / near.length : null };
    });
  }
  let spread = 0, flagged = false;
  const seen = where.filter((pl) => pl.seen >= 0.1);
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

  // The grade (§7) of the chosen one, with the where-spread.
  const check = chosen.check;
  const kernelGap = check && kernelFit !== null ? kernelFit - check.fit : 0;
  const grade = gradeOf({ fit: check ? check.fit : chosen.fitted, ceiling: ceiling ?? -Infinity, white: check ? check.white : true, spread: flagged ? spread : 0, kernelGap, left: !!seg.check?.left, checked: !!check });
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
    noise: { sigma: quiet ? 0 : L.sigma, q: steps ? q : 0, floor: L.floor, drift: L.drifts ? L.drift : 0, none: quiet, steps },
    fit: chosen.fitted, check: checkOut,
    where, holds: seg.holds.map((h) => ({ y: h.y, u: h.u })), whereSpread: { spread, flagged }, size, sizeNote,
    kernel: kernel ? { g: Array.from(kernel.g), sd: Array.from(kernel.sd), Ts: kernel.Ts, decimate: kernel.decimate, integrating: kernel.integrating, rate: kernel.rate ? { value: kernel.rate.value, sd: kernel.rate.sd } : null, fit: kernelFit } : null,
    eased: easedFrom(g, plan),
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
  const lo = model.band?.[0], hi = model.band?.[1];
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
// boxes): In → gain K (or k′) → dead time → lags or a resonance → integrator
// → noise → quantiser → Out. push: an added Sum at its input with a second
// In for the test push. noise: false leaves out the noise and the quantiser.
export function twinSubsystem(model, { push = false, noise = true, id = 'twin', name = null } = {}) {
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
  const gainKey = GAIN(S);
  add({ id: 'gain', type: 'gain', name: S.integrating ? 'rate k′' : 'gain K', params: { K: p[gainKey] } });
  if (p.theta > 0) add({ id: 'dead', type: 'delay', name: 'dead time θ', params: { L: p.theta, y0: 0 } });
  if (S.integrating) add({ id: 'int', type: 'integrator', name: 'integrator', params: { K: 1 } });
  if (model.structure === 'lag' || model.structure === 'intLag') add({ id: 'lag', type: 'firstOrder', name: 'lag τ', params: { K: 1, tau: p.tau } });
  if (model.structure === 'lags') {
    add({ id: 'lag1', type: 'firstOrder', name: 'lag τ₁', params: { K: 1, tau: p.tau1 } });
    add({ id: 'lag2', type: 'firstOrder', name: 'lag τ₂', params: { K: 1, tau: p.tau2 } });
  }
  if (model.structure === 'resonance' || model.structure === 'intRes') add({ id: 'res', type: 'secondOrder', name: 'resonance f, ζ', params: { K: 1, wn: 2 * Math.PI * p.f, zeta: p.zeta } });
  if (noise && model.noise?.sigma > 0) add({ id: 'noise', type: 'noise', name: 'noise σ', params: { std: model.noise.sigma, seed: 1 } });
  if (noise && model.noise?.q > 0) add({ id: 'quant', type: 'quantizer', name: 'steps q', params: { q: model.noise.q } });
  add({ id: 'y', type: 'outport', name: model.names?.y ?? 'y', params: { port: 1 } });
  return { id, type: 'subsystem', name: name ?? `identified ${S.label}`, params: {}, diagram: { blocks, wires } };
}

// ---- Hide a variation (§13)

// Every physical parameter (flagged vary in the block definitions: masses,
// lengths, gains, times, friction, areas, a transfer function's denominator)
// scaled by 1 + share·(2ρ − 1), ρ from a seeded generator, in the order the
// blocks are listed (depth first). Two Gain blocks with one value in one
// subsystem are one physical constant and get one factor (the motor's Kt and
// Ke, 0.5 each: equal in SI units, or the motor would make energy). Sources,
// Sinks, Controllers, Observers, limits, Ts, noise, quantisers, ports and an
// integrator's K are not varied. Returns { diagram (a copy), factors: [{ path,
// block, param, value, factor }] }.
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
      if (b.type === 'subsystem') { walk(b.diagram, [...path, b.id]); continue; }
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
          factors.push({ path: [...path, b.id].join('/'), block: b.name ?? b.id, param, value: x, factor: f });
        }
      }
    }
  };
  walk(d, []);
  return { diagram: d, factors };
}

// ---- The whole test in Node (§16)

// The whole test on a simulated plant, synchronously, for Node, the command
// line and the tests: the experiment runs as the hidden law of the block in a
// copy of the diagram (createStepRunner), the r Source plays its reference,
// every other Source is held; the fit is supplied at once at the pause, and
// the model is computed from the record as Keep stores it. settings: { band,
// budget, vary: { share, seed } | null, structure, seed }, over the stored
// ones (system.identify[key]). Returns { ok, block, plan, settings, vary,
// record, model, end, time, tries }.
export function identify(project, path = null, settings = {}) {
  const known = knownFor(project, path);
  if (known.live) throw new IdentifyError('live', 'this plant runs outside the page: identify it from the page, connected (Identify tab)', 'identify() simulates the plant; a live plant runs in the page');
  const stored = project.system.identify?.[known.block.key] ?? {};
  const given = Object.fromEntries(Object.entries(settings ?? {}).filter(([, v]) => v !== undefined));
  const merged = { ...stored, ...given };
  const s = settingsFor(known, merged);
  const plan = planExperiment(known, s);
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
  for (let k = 0; k <= most && !exp.state.done; k++) {
    runner.step();
    if (exp.needs) {
      // The fit pause: fitted at once on the data so far, as Keep stores it.
      const upto = exp.needs.upto;
      pre = drain(identifySteps(compactRecord(exp.record()), { plan, upto }));
      exp.supply('fit', pre.ok ? { structure: pre.structure, params: pre.params } : {});
    }
  }
  if (!exp.state.done) exp.stop();
  const record = compactRecord(exp.record());
  const model = drain(identifySteps(record, { plan, structure: s.structure, reuse: pre }));
  const end = exp.state.end;
  return {
    ok: !!model.ok, block: known.block, plan, settings: { band: s.band.value, budget: s.budget.value, structure: s.structure },
    vary: vary ? { share: vary.share, seed: vary.seed, factors } : null,
    record, model, end: { code: end.code, message: end.message }, time: record.y.length * Ts, tries: exp.state.tries,
  };
}
