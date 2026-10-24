// The project file: one human-editable JSON document holding the system (the
// reference and every slot but the controller), how the display is set, the
// goal, and the candidates. Each candidate holds its own controller and may
// override any other slot. design/output/project-format.md describes it.

import { SLOTS, normalizeBlock } from './blocks.js';
import { normalizeReference, migrateReferenceBlock, referenceFn, sampleSignal } from './signals.js';
import { simulate } from './sim.js';
import { computeMetrics } from './metrics.js';
import { normalizeGoal, evaluateGoal, compareEvals } from './goal.js';

export const FORMAT = 'loop-tuner/2';
export const PALETTE_SIZE = 8;
export const CHANNEL_SOURCES = ['r', 'y', 'u', 'e', 'ym', 'd'];

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
  const sim = { duration: Number(p.sim?.duration ?? (v1 ? 20 : 1)), sampleTime: Number(p.sim?.sampleTime ?? (v1 ? 0.01 : NaN)) };
  if (!(sim.duration > 0)) throw new Error('sim.duration must be > 0');
  if (!Number.isFinite(sim.sampleTime)) sim.sampleTime = defaultSampleTime(sim.duration);
  if (!(sim.sampleTime > 0) || sim.sampleTime > sim.duration) throw new Error('sim.sampleTime must be > 0 and below the duration');
  const system = {
    reference: v1 ? normalizeReference(migrateReferenceBlock(p.system?.reference ?? { type: 'step' }, sim.duration)) : normalizeReference(p.system?.reference),
  };
  for (const [slot, def] of Object.entries(SYSTEM_DEFAULTS)) system[slot] = normalizeBlock(slot, p.system?.[slot] ?? def);
  const plant = p.system?.plant ?? (v1 ? { type: 'firstOrder' } : null);
  system.plant = plant ? normalizeBlock('plant', plant) : null;
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
    for (const k of BLOCK_SLOTS) if (c[k]) out[k] = normalizeBlock(k, c[k]);
    return out;
  });
  for (const c of candidates) if (c.color === null) c.color = nextColor(candidates);
  return {
    format: FORMAT,
    title: String(p.title ?? 'Untitled loop'),
    ...(p.notes ? { notes: String(p.notes) } : {}),
    sim, system, scope: normalizeScope(p.scope, sim), goal, candidates,
    ...(p.selected !== undefined ? { selected: String(p.selected) } : {}),
  };
}

export function defaultSampleTime(duration) {
  return Number((duration / 2000).toPrecision(2));
}

const DEFAULT_CHANNELS = [
  { source: 'r', on: true, scale: 0.2, offset: 0 },
  { source: 'y', on: true, scale: 0.2, offset: 0 },
  { source: 'u', on: false, scale: 0.5, offset: 0 },
  { source: 'e', on: false, scale: 0.2, offset: 0 },
];

// How the display is set: timebase (s/div, time at the left edge) and four
// channels (source, on, units/div, offset in units).
export function normalizeScope(scope = {}, sim) {
  const tb = scope.timebase ?? {};
  const timebase = { scale: Number(tb.scale ?? sim.duration / 10), position: Number(tb.position ?? 0) };
  if (!(timebase.scale > 0)) throw new Error('scope.timebase.scale must be > 0');
  const channels = DEFAULT_CHANNELS.map((d, i) => {
    const c = scope.channels?.[i] ?? {};
    const ch = { source: c.source ?? d.source, on: c.on ?? d.on, scale: Number(c.scale ?? d.scale), offset: Number(c.offset ?? d.offset) };
    if (!CHANNEL_SOURCES.includes(ch.source)) throw new Error(`scope.channels[${i}].source: one of ${CHANNEL_SOURCES.join(', ')}`);
    if (!(ch.scale > 0) || !Number.isFinite(ch.offset)) throw new Error(`scope.channels[${i}]: scale must be > 0 and offset a number`);
    ch.on = !!ch.on;
    return ch;
  });
  return { timebase, channels };
}

// A loop can run once it has a plant and at least one controller candidate.
export function loopReady(project) {
  return !!project.system.plant && project.candidates.length > 0;
}

// r(t) on the simulation grid, whether or not a loop exists.
export function referenceTrace(project) {
  const { t, v } = sampleSignal(referenceFn(project.system.reference, project.sim), project.sim);
  return { t, r: v };
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
  const loop = {};
  for (const s of SLOTS) loop[s.key] = s.key === 'controller' ? cand.controller : (cand[s.key] ?? project.system[s.key]);
  return loop;
}

export function evaluateCandidate(project, cand) {
  if (!project.system.plant) throw new Error('the loop has no plant yet; add one in the Plant tab or set system.plant');
  const result = simulate(resolveLoop(project, cand), project.sim);
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
