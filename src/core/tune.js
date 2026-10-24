// Auto-tuning: Nelder–Mead over chosen controller parameters, minimising the
// goal's penalised score. Positive (log-scale) parameters are searched in log
// space. Written as a generator that yields after every evaluation, so the UI
// can run it a slice per frame and the CLI can run it to the end.

import { blockDef, paramMax } from './blocks.js';
import { evaluateCandidate, simOf } from './project.js';
import { penalized } from './goal.js';

export function tunableParams(block) {
  return blockDef('controller', block.type).params.filter((p) => p.tunable).map((p) => p.key);
}

export function* tuneCandidate(project, cand, opts = {}) {
  const def = blockDef('controller', cand.controller.type);
  const keys = opts.params?.length ? opts.params : tunableParams(cand.controller);
  const ctx = { duration: simOf(project).duration };
  const specs = keys.map((k) => {
    const p = def.params.find((q) => q.key === k);
    if (!p || p.kind === 'vector') throw new Error(`cannot tune "${k}" of ${cand.controller.type}; tunable: ${tunableParams(cand.controller).join(', ')}`);
    const lo = p.min, hi = paramMax(p, ctx);
    const log = p.scale !== 'lin' && lo > 0;
    const enc = (v) => (log ? Math.log(Math.min(hi, Math.max(lo, v > 0 ? v : (p.default > 0 ? p.default : lo * 10)))) : v);
    const dec = (x) => { const v = log ? Math.exp(x) : x; return Math.min(hi, Math.max(lo, v)); };
    return { key: k, enc, dec, step: log ? 0.7 : 0.2 * (hi - lo) };
  });
  const maxEvals = opts.maxEvals ?? 300;

  const paramsAt = (x) => {
    const params = { ...cand.controller.params };
    specs.forEach((s, i) => { params[s.key] = s.dec(x[i]); });
    return params;
  };
  let evals = 0;
  let best = null;
  const f = (x) => {
    const params = paramsAt(x);
    const trial = { ...cand, controller: { type: cand.controller.type, params } };
    const { evaluation } = evaluateCandidate(project, trial);
    const val = penalized(evaluation);
    evals++;
    if (!best || val < best.f) best = { f: val, x: x.slice(), params, evaluation };
    return val;
  };

  // Coarse scan around the start (seeded, so runs are reproducible), then
  // Nelder–Mead from the best point found, with shrinking restarts.
  let x0 = specs.map((s) => s.enc(cand.controller.params[s.key]));
  f(x0);
  yield { evals, best };
  const rand = lcg(opts.seed ?? 1);
  const scan = Math.min(opts.scan ?? 40, Math.floor(maxEvals / 4));
  for (let i = 0; i < scan; i++) {
    f(x0.map((v, j) => v + (rand() * 2 - 1) * specs[j].step * 4));
    yield { evals, best };
  }
  x0 = best.x;
  const restarts = opts.restarts ?? 2;
  for (let round = 0; round <= restarts && evals < maxEvals; round++) {
    const budget = Math.floor((maxEvals - evals) / (restarts - round + 1));
    yield* nelderMead(f, x0, specs.map((s) => s.step / (round + 1)), budget, () => ({ evals, best }));
    x0 = best.x;
  }
  return { evals, best, keys };
}

function* nelderMead(f, x0, steps, maxEvals, progress) {
  const n = x0.length;
  let simplex = [x0.slice()];
  for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += steps[i]; simplex.push(x); }
  let fs = [];
  let used = 0;
  const ev = function* (x) { const v = f(x); used++; yield progress(); return v; };
  for (const x of simplex) fs.push(yield* ev(x));
  while (used < maxEvals) {
    const order = fs.map((_, i) => i).sort((a, b) => fs[a] - fs[b]);
    simplex = order.map((i) => simplex[i]); fs = order.map((i) => fs[i]);
    if (Math.abs(fs[n] - fs[0]) <= 1e-9 * (Math.abs(fs[0]) + 1e-12) && spread(simplex) < 1e-6) break;
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += simplex[i][j] / n;
    const at = (t) => c.map((cj, j) => cj + t * (simplex[n][j] - cj));
    const xr = at(-1); const fr = yield* ev(xr);
    if (fr < fs[0]) {
      const xe = at(-2); const fe = yield* ev(xe);
      if (fe < fr) { simplex[n] = xe; fs[n] = fe; } else { simplex[n] = xr; fs[n] = fr; }
    } else if (fr < fs[n - 1]) {
      simplex[n] = xr; fs[n] = fr;
    } else {
      const xc = fr < fs[n] ? at(-0.5) : at(0.5);
      const fc = yield* ev(xc);
      if (fc < Math.min(fr, fs[n])) { simplex[n] = xc; fs[n] = fc; } else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]));
          fs[i] = yield* ev(simplex[i]);
        }
      }
    }
  }
}

function lcg(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; };
}

function spread(simplex) {
  let s = 0;
  for (let i = 1; i < simplex.length; i++) for (let j = 0; j < simplex[0].length; j++) s = Math.max(s, Math.abs(simplex[i][j] - simplex[0][j]));
  return s;
}

export function runTune(project, cand, opts) {
  const it = tuneCandidate(project, cand, opts);
  for (;;) { const s = it.next(); if (s.done) return s.value; }
}
