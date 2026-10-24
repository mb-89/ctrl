// The goal: minimise a weighted sum of metrics subject to bounds on metrics.
//   { "minimize": { "itae": 1 }, "subjectTo": { "overshoot": { "max": 5 } }, "settlingBand": 0.02 }
// A candidate's score is the weighted sum (lower is better); it is feasible
// when it is stable and meets every bound.

import { METRIC } from './metrics.js';

export const DEFAULT_GOAL = { minimize: { itae: 1 }, subjectTo: { overshoot: { max: 10 } }, settlingBand: 0.02 };

export function normalizeGoal(g = {}) {
  const minimize = {};
  for (const [k, w] of Object.entries(g.minimize ?? DEFAULT_GOAL.minimize)) {
    if (!METRIC[k]) throw new Error(`goal.minimize: unknown metric "${k}"; metrics: ${Object.keys(METRIC).join(', ')}`);
    if (!Number.isFinite(Number(w))) throw new Error(`goal.minimize.${k}: weight must be a number`);
    minimize[k] = Number(w);
  }
  const subjectTo = {};
  for (const [k, c] of Object.entries(g.subjectTo ?? {})) {
    if (!METRIC[k]) throw new Error(`goal.subjectTo: unknown metric "${k}"; metrics: ${Object.keys(METRIC).join(', ')}`);
    const b = {};
    if (c?.max !== undefined && c.max !== null) b.max = Number(c.max);
    if (c?.min !== undefined && c.min !== null) b.min = Number(c.min);
    if (!('max' in b) && !('min' in b)) throw new Error(`goal.subjectTo.${k}: needs "max" or "min"`);
    subjectTo[k] = b;
  }
  const settlingBand = g.settlingBand === undefined ? DEFAULT_GOAL.settlingBand : Number(g.settlingBand);
  return { minimize, subjectTo, settlingBand };
}

const CAP = 1e3;

export function evaluateGoal(metrics, goal) {
  let score = 0;
  for (const [k, w] of Object.entries(goal.minimize)) {
    const v = metrics[k];
    score += Number.isFinite(v) ? w * v : (w === 0 ? 0 : Infinity);
  }
  if (Object.keys(goal.minimize).length === 0) score = 0;
  const checks = [];
  let violation = metrics.unstable ? CAP : 0;
  for (const [k, b] of Object.entries(goal.subjectTo)) {
    const v = metrics[k];
    const scale = METRIC[k].scale ?? 1e-6;
    let over = 0;
    if (!Number.isFinite(v)) over = CAP;
    else {
      if ('max' in b && v > b.max) over += (v - b.max) / Math.max(Math.abs(b.max), scale);
      if ('min' in b && v < b.min) over += (b.min - v) / Math.max(Math.abs(b.min), scale);
    }
    violation += Math.min(over, CAP);
    checks.push({ metric: k, value: v, ...b, ok: over === 0 });
  }
  const feasible = !metrics.unstable && violation === 0;
  return { score, feasible, violation, checks, unstable: !!metrics.unstable, ...(metrics.unstable ? { blowup: metrics.blowup ?? 0 } : {}) };
}

// Lower is better; feasible candidates always beat infeasible ones.
export function compareEvals(a, b) {
  if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
  if (!a.feasible && a.violation !== b.violation) return a.violation - b.violation;
  const sa = Number.isFinite(a.score) ? a.score : Number.MAX_VALUE;
  const sb = Number.isFinite(b.score) ? b.score : Number.MAX_VALUE;
  return sa - sb;
}

// One number for an optimiser: the score, raised for infeasible candidates
// so that every feasible point wins against a nearby infeasible one. Unstable
// runs rank by how long they lasted, so a search can climb out of instability.
export function penalized(ev) {
  if (ev.unstable) return 1e12 * (2 - (ev.blowup ?? 0));
  const J = Number.isFinite(ev.score) ? ev.score : 1e9;
  return ev.feasible ? J : J + (Math.abs(J) + 1) * (1 + 100 * ev.violation);
}
