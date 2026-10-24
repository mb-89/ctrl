// The project file: one human-editable JSON document holding the system (every
// slot but the controller), the goal, and the candidates. Each candidate holds
// its own controller and may override any other slot.

import { SLOTS, normalizeBlock } from './blocks.js';
import { simulate } from './sim.js';
import { computeMetrics } from './metrics.js';
import { normalizeGoal, evaluateGoal, compareEvals } from './goal.js';

export const FORMAT = 'loop-tuner/1';
export const PALETTE_SIZE = 8;

const SYSTEM_DEFAULTS = {
  reference: { type: 'step' },
  actuator: { type: 'ideal' },
  disturbance: { type: 'none' },
  plant: { type: 'firstOrder' },
  sensor: { type: 'ideal' },
  noise: { type: 'none' },
};
const CANDIDATE_KEYS = new Set(['name', 'checked', 'color', 'note', 'controller', ...SLOTS.map((s) => s.key)]);

export function normalizeProject(p) {
  if (!p || typeof p !== 'object') throw new Error('project must be a JSON object');
  const sim = { duration: Number(p.sim?.duration ?? 20), sampleTime: Number(p.sim?.sampleTime ?? 0.01) };
  if (!(sim.duration > 0)) throw new Error('sim.duration must be > 0');
  if (!(sim.sampleTime > 0) || sim.sampleTime > sim.duration) throw new Error('sim.sampleTime must be > 0 and below the duration');
  const system = {};
  for (const [slot, def] of Object.entries(SYSTEM_DEFAULTS)) system[slot] = normalizeBlock(slot, p.system?.[slot] ?? def);
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
    for (const s of SLOTS) if (s.key !== 'controller' && c[s.key]) out[s.key] = normalizeBlock(s.key, c[s.key]);
    return out;
  });
  for (const c of candidates) if (c.color === null) c.color = nextColor(candidates);
  return {
    format: FORMAT,
    title: String(p.title ?? 'Untitled loop'),
    ...(p.notes ? { notes: String(p.notes) } : {}),
    sim, system, goal, candidates,
    ...(p.selected !== undefined ? { selected: String(p.selected) } : {}),
  };
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
