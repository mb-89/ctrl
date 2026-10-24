// Auto-tune (Tab 4): improve a Controller block's running variant by
// simulating the plant, the way a person would by trying gains. Nothing about
// a plant is stored: every number here comes from simulations of the plant in
// the project, run when asked. Three textbook strategies
// (design/output/autotune.md):
//   iterate  Nelder–Mead (1965) over the variant's gains, minimising a cost of
//            one run: IAE, ITAE or ISE of e = r − y, plus effort and penalties
//            for overshoot and saturation. The disturbance d plays in the run,
//            so rejecting it counts too.
//   relay    Åström and Hägglund's relay experiment (1984): a relay makes the
//            loop oscillate; amplitude and period give the ultimate gain Ku and
//            period Pu, and a rule (Ziegler–Nichols, Tyreus–Luyben, …) a PID.
//   step     an open-loop step (process reaction curve) fitted with a first
//            order plus dead time, then a SIMC PI (Skogestad 2003).
// The simulations read the block's own r (input 1), y (input 2) and u from
// the probes compileDiagram adds under "<block path>.r", ".y", ".u".
// Every strategy is a generator that yields after each run of the loop, so
// the page can keep drawing while it works (a run of a large plant takes tens
// of milliseconds); drain() runs one to its end (tests, the command line).
// autotune() is the one entry for the page, the command line and agents.

import { simulateSystem } from './sim.js';
import { defaultSampleTime } from './project.js';
import { normalizeVariant } from './controllers.js';
import { parseEnd, blockPorts } from './diagram.js';

const DIVERGED = 100;        // the cost of a run that blew up (normal costs are O(1))
const OVERSHOOT_WEIGHT = 2;  // cost per 100 % of overshoot beyond the bound
const LOG_LIMIT = Math.log(1000);

// Runs a strategy's generator to its end and returns its result.
export function drain(gen) {
  for (;;) { const s = gen.next(); if (s.done) return s.value; }
}

// Every Controller block in a diagram, at any depth: { path, key, block, where }.
export function controllerBlocks(diagram) {
  const out = [];
  const walk = (d, path, where) => {
    for (const b of d.blocks) {
      if (b.type === 'controller') out.push({ path: [...path, b.id], key: [...path, b.id].join('/'), block: b, where: [...where, b.name ?? b.id].join(' / ') });
      if (b.type === 'subsystem') walk(b.diagram, [...path, b.id], [...where, b.name ?? b.id]);
    }
  };
  if (diagram) walk(diagram, [], []);
  return out;
}

// The diagram level holding the block at path, and the block.
function locate(diagram, path) {
  let level = diagram;
  for (const id of path.slice(0, -1)) level = level.blocks.find((b) => b.id === id).diagram;
  return { level, block: level.blocks.find((b) => b.id === path.at(-1)) };
}

// A copy of the diagram in which the block runs this variant (the project is
// not touched).
export function withVariant(diagram, path, variant) {
  const d = structuredClone(diagram);
  const { block } = locate(d, path);
  block.variants = [variant];
  block.variant = 0;
  return d;
}

const wireTo = (level, id, port) => level.wires.find((w) => { const e = parseEnd(w.to); return e.id === id && e.port === port; });
const portBlocks = (d, type) => d.blocks.filter((b) => b.type === type).sort((a, c) => a.params.port - c.params.port);

// The Source whose signal reaches an input of the block at path: back along
// the wires through blocks with one input (a gain, a lag, a prefilter) and
// through subsystem ports. null when the input is not wired or is fed by
// something else (a sum of signals, a loop).
export function upstreamSource(diagram, path, port) {
  const frames = [{ d: diagram }];
  for (const id of path.slice(0, -1)) frames.push({ d: frames.at(-1).d.blocks.find((b) => b.id === id).diagram, sub: id });
  let id = path.at(-1), p = port;
  for (let hop = 0; hop < 200; hop++) {
    const { d } = frames.at(-1);
    const w = wireTo(d, id, p);
    if (!w) return null;
    const from = parseEnd(w.from);
    const b = d.blocks.find((x) => x.id === from.id);
    if (!b) return null;
    if (b.type === 'source') return b.params.signal;
    if (b.type === 'inport') {
      // Out of the subsystem, to the wire into its input port.
      if (frames.length < 2) return null;
      const { d: inner, sub } = frames.pop();
      id = sub; p = portBlocks(inner, 'inport').indexOf(b);
      continue;
    }
    if (b.type === 'subsystem') {
      // Into the subsystem, to the wire into its output port.
      const out = portBlocks(b.diagram, 'outport')[from.port];
      if (!out) return null;
      frames.push({ d: b.diagram, sub: b.id });
      id = out.id; p = 0;
      continue;
    }
    if (blockPorts(b)[0] !== 1) return null;
    id = b.id; p = 0;
  }
  return null;
}

// What every strategy needs: the block, its running variant, and the
// experiment: one period of the input (every step and disturbance in it),
// sampled as the display samples it.
export function tuneContext(project, path) {
  const plant = project.system.plant;
  if (plant?.type !== 'diagram') throw new Error('the plant is not a block diagram yet');
  const all = controllerBlocks(plant.diagram);
  const key = path ? [].concat(path).join('/') : null;
  const hit = (key && all.find((c) => c.key === key)) || all[0];
  if (!hit) throw new Error('there is no Controller block in the plant');
  const { block } = hit;
  if (block.params.inputs < 2) throw new Error(`${hit.where} needs r on input 1 and the measurement y on input 2`);
  // The cost and the experiments read r and y at the block: both must be wired.
  const { level } = locate(plant.diagram, hit.path);
  if (!wireTo(level, block.id, 0)) throw new Error(`${hit.where}: wire the reference r to input 1`);
  if (!wireTo(level, block.id, 1)) throw new Error(`${hit.where}: wire the measurement y to input 2`);
  const variant = normalizeVariant(block.variants[block.variant ?? 0]);
  const period = Math.max(...Object.values(project.system.signals).map((s) => s.period));
  const sim = { duration: period, sampleTime: project.sim?.sampleTime ?? defaultSampleTime(period) };
  // Copies, so the page may change the project while a tuning run reads these.
  const ctx = { diagram: structuredClone(plant.diagram), signals: structuredClone(project.system.signals), path: hit.path, key: hit.key, where: hit.where, block, variant, sim, Ts: block.params.Ts };
  // The Source that feeds r, and the other inputs (the disturbance d, …).
  ctx.source = upstreamSource(ctx.diagram, ctx.path, 0);
  ctx.others = ctx.source ? Object.keys(ctx.signals).filter((k) => k !== ctx.source) : [];
  return ctx;
}

export function runVariant(ctx, variant, signals = ctx.signals, sim = ctx.sim) {
  return simulateSystem(withVariant(ctx.diagram, ctx.path, variant), signals, sim);
}

// The block's own signals in a run.
export function loopSignals(run, key) {
  const s = run.signals;
  return { t: run.t, r: s[`${key}.r`], y: s[`${key}.y`], u: s[`${key}.u`] };
}

// Auto Scale: the scope channels that show one Controller block's r and the
// y it compares with r (the same values as its probes), in groups of channel
// indices, so they can share one scale and overlay. unitOf(name) gives a
// signal's unit; channels of different units are not grouped.
export function loopOverlays(channels, signals, unitOf = () => '') {
  const same = (a, b) => a && b && a.length === b.length && a.every((v, k) => Object.is(v, b[k]));
  const groups = [];
  for (const key of Object.keys(signals)) {
    if (!key.endsWith('.r')) continue;
    const r = signals[key], y = signals[`${key.slice(0, -2)}.y`];
    const showing = (probe) => channels.map((ch, i) => (ch.on && same(signals[ch.source], probe) ? i : -1)).filter((i) => i >= 0);
    const g = [...showing(r), ...showing(y)];
    if (new Set(g).size > 1 && new Set(g.map((i) => unitOf(channels[i].source))).size === 1) groups.push([...new Set(g)]);
  }
  return groups;
}

const limitsOf = (v) => ({ lo: v.params.umin ?? -Infinity, hi: v.params.umax ?? Infinity });
const finiteRange = (a, from = 0, to = a.length) => {
  let lo = Infinity, hi = -Infinity;
  for (let k = from; k < to; k++) if (Number.isFinite(a[k])) { lo = Math.min(lo, a[k]); hi = Math.max(hi, a[k]); }
  return { lo, hi };
};
const mean = (a, from = 0, to = a.length) => { let s = 0; for (let k = from; k < to; k++) s += a[k]; return s / Math.max(1, to - from); };

// ---- The cost of a run -------------------------------------------------

export const COSTS = {
  IAE: 'mean |e|: every error counts by its size',
  ITAE: 'mean |e| weighted by the time since the last reference step: errors that last count most',
  ISE: 'mean e²: large errors count most',
};
export const GOAL = { cost: 'IAE', effort: 0.05, overshoot: 10, saturation: 0.2 };

// Scales that make the cost a plain number, fixed from the run the tuning
// starts with: the error relative to the reference's span (or, when r does
// not move, to the largest error), the effort relative to the actuator's range
// (or, without limits, to the largest swing of u).
export function costScales(run, key, variant) {
  const { r, y, u } = loopSignals(run, key);
  const rr = finiteRange(r);
  let e = rr.hi - rr.lo;
  if (!(e > 1e-9)) { e = 0; for (let k = 0; k < r.length; k++) if (Number.isFinite(y[k])) e = Math.max(e, Math.abs(r[k] - y[k])); }
  const { lo, hi } = limitsOf(variant);
  let U = hi - lo;
  if (!Number.isFinite(U)) { const ur = finiteRange(u); U = ur.hi - ur.lo; }
  return { e: e > 1e-9 ? e : 1, u: U > 1e-9 && Number.isFinite(U) ? U : 1 };
}

// The cost J of one run, smaller is better:
//   error       IAE, ITAE or ISE of e = r − y (the block's inputs 1 and 2), per sample
//   effort      weight × mean (u − ū)² / U², the swing of u about its mean
//   overshoot   for each reference step, 2 × the overshoot beyond the bound (a
//               fraction of the step), until the next step or until another
//               input (d) changes: recovering from a disturbance is not overshoot
//   saturation  weight × the fraction of the time u sits at a limit
// A run that diverges costs 100–200 (earlier is worse), so the search can
// still tell which way is back. how: { scales, variant (for its limits),
// others (names of the other inputs) }.
export function runCost(run, key, goal = {}, how = {}) {
  const g = { ...GOAL, ...goal };
  const { scales = { e: 1, u: 1 }, variant = null, others = [] } = how;
  const { t, r, y, u } = loopSignals(run, key);
  if (!r || !y || !u) throw new Error('the run has no r, y and u for this Controller block');
  const n = t.length;
  let valid = n;
  for (let k = 0; k < n; k++) if (!Number.isFinite(r[k]) || !Number.isFinite(y[k]) || !Number.isFinite(u[k])) { valid = k; break; }
  if (valid < n || run.info?.unstable) {
    return { J: DIVERGED * (2 - valid / n), diverged: true, parts: { error: DIVERGED, effort: 0, overshoot: 0, saturation: 0 }, overshoot: Infinity, saturated: 0 };
  }
  const R = scales.e, U = scales.u;
  // Reference steps: a jump of more than 5 % of the span in one sample.
  const steps = [];
  for (let k = 1; k < n; k++) if (Math.abs(r[k] - r[k - 1]) > 0.05 * R) steps.push(k);
  const Tseg = (t[n - 1] - t[0]) / (steps.length + 1) || 1;
  let err = 0, since = t[0], s = 0;
  for (let k = 0; k < n; k++) {
    if (k === steps[s]) { since = t[k]; s++; }
    const e = (r[k] - y[k]) / R;
    err += g.cost === 'ISE' ? e * e : g.cost === 'ITAE' ? ((t[k] - since) / Tseg) * Math.abs(e) : Math.abs(e);
  }
  err /= n;
  const um = mean(u);
  let swing = 0;
  for (let k = 0; k < n; k++) swing += (u[k] - um) ** 2;
  const effort = g.effort * swing / (n * U * U);
  // Where another input jumps (5 % of its span in one sample), a step's
  // overshoot window ends.
  const cuts = [];
  for (const name of others) {
    const v = run.signals[name];
    if (!v) continue;
    const vr = finiteRange(v), jump = 0.05 * (vr.hi - vr.lo);
    for (let k = 1; k < n; k++) if (Math.abs(v[k] - v[k - 1]) > jump) cuts.push(k);
  }
  cuts.sort((a, b) => a - b);
  let worst = 0, over = 0;
  steps.forEach((k0, i) => {
    const k1 = Math.min(steps[i + 1] ?? n, cuts.find((c) => c > k0) ?? n), dr = r[k0] - r[k0 - 1], dir = Math.sign(dr);
    let peak = 0;
    for (let k = k0; k < k1; k++) peak = Math.max(peak, dir * (y[k] - r[k]));
    const pct = (100 * peak) / Math.abs(dr);
    worst = Math.max(worst, pct);
    over += Math.max(0, pct - g.overshoot) / 100;
  });
  let sat = 0;
  if (variant) {
    const { lo, hi } = limitsOf(variant), tol = 1e-9 * (U + 1);
    if (Number.isFinite(lo) || Number.isFinite(hi)) for (let k = 0; k < n; k++) if (u[k] <= lo + tol || u[k] >= hi - tol) sat++;
  }
  const parts = { error: err, effort, overshoot: OVERSHOOT_WEIGHT * over, saturation: g.saturation * sat / n };
  const J = parts.error + parts.effort + parts.overshoot + parts.saturation;
  return { J: Number.isFinite(J) ? Math.min(J, DIVERGED) : 2 * DIVERGED, diverged: false, parts, overshoot: worst, saturated: sat / n };
}

// The cost of running a variant in the context's experiment.
export function variantCost(ctx, variant, goal, scales) {
  return runCost(runVariant(ctx, variant), ctx.key, goal, { scales, variant, others: ctx.others });
}

// ---- What can be tuned -------------------------------------------------

const UNTUNABLE = {
  off: 'Off has nothing to tune. Add a PID to this block in the Controller tab, then tune that.',
  swingUp: 'A swing-up switches between pumping energy and catching the pole; its gains do not act on r − y. Tune its catching gains as a State feedback variant.',
  relay: 'A relay has no gains to tune; the relay method uses one to find Ku and Pu.',
};

// The knobs the optimiser turns, as log factors on the variant's own values:
// x = 0 is the variant as it is, x = ln 2 doubles a gain. A gain at 0 stays
// off (the structure is the person's choice) and no sign ever flips.
//   pid            Kp, Ki, Kd
//   gainScheduled  the Kp table and the Ki table, each scaled as a whole
//   stateFeedback  each gain in K, and the prefilter kr
export function tuningSpace(variant) {
  const p = variant.params;
  const f = (x) => Math.exp(Math.max(-LOG_LIMIT, Math.min(LOG_LIMIT, x)));
  const on = (v) => Number.isFinite(v) && v !== 0;
  let names, apply;
  if (variant.type === 'pid') {
    const keys = ['Kp', 'Ki', 'Kd'].filter((k) => on(p[k]));
    names = keys;
    apply = (x) => { const q = { ...p }; keys.forEach((k, i) => { q[k] = p[k] * f(x[i]); }); return q; };
  } else if (variant.type === 'gainScheduled') {
    const keys = ['Kp', 'Ki'].filter((k) => p[k].some(on));
    names = keys.map((k) => `${k} table ×`);
    apply = (x) => { const q = { ...p }; keys.forEach((k, i) => { q[k] = p[k].map((v) => v * f(x[i])); }); return q; };
  } else if (variant.type === 'stateFeedback') {
    const idx = p.K.map((v, i) => i).filter((i) => on(p.K[i]));
    names = [...idx.map((i) => `K${i + 1}`), ...(on(p.kr) ? ['kr'] : [])];
    apply = (x) => {
      const q = { ...p, K: p.K.slice() };
      idx.forEach((i, j) => { q.K[i] = p.K[i] * f(x[j]); });
      if (on(p.kr)) q.kr = p.kr * f(x[idx.length]);
      return q;
    };
  } else throw new Error(UNTUNABLE[variant.type] ?? `a ${variant.type} variant cannot be tuned`);
  if (!names.length) throw new Error('every gain of this variant is 0; give the gains it should use a start value, then tune');
  return { names, apply: (x) => ({ ...variant, params: apply(x) }) };
}

// The values the tuner turns, for showing before and after: [[name, value]].
export function tunedValues(variant) {
  const p = variant.params;
  if (variant.type === 'pid') return ['Kp', 'Ki', 'Kd'].map((k) => [k, p[k]]);
  if (variant.type === 'gainScheduled') return [['Kp', p.Kp], ['Ki', p.Ki]];
  if (variant.type === 'stateFeedback') return [['K', p.K], ['kr', p.kr]];
  return [];
}

// ---- Strategy 1: Nelder–Mead -------------------------------------------

// Nelder–Mead on the log factors. Deterministic. When the simplex has
// collapsed it restarts around the best point with smaller steps, twice at
// most (a common remedy for stalls). It stops after maxIter iterations, or
// when 15 (patience) have not lowered the cost by 0.1 %. The goal is copied
// at the start: changing it during a run cannot change the search.
// Yields after every run of the loop { partial: true, … } and after every
// iteration (a reflection, expansion, contraction or shrink of the simplex)
// { iteration, evals, cost, start, best: { variant, cost, x }, tried, names };
// the final value has done: true.
export function* iterate(project, path, goal = {}, opts = {}) {
  const g = { ...GOAL, ...goal };
  const ctx = tuneContext(project, path);
  const space = tuningSpace(ctx.variant);
  const n = space.names.length;
  const maxIter = opts.maxIter ?? 60;
  let step = opts.step ?? Math.log(2), restarts = opts.restarts ?? 2;
  const startRun = runVariant(ctx, ctx.variant);
  const scales = costScales(startRun, ctx.key, ctx.variant);
  const detail = runCost(startRun, ctx.key, g, { scales, variant: ctx.variant, others: ctx.others });
  const start = { cost: detail.J, detail, variant: ctx.variant };
  const x0 = new Array(n).fill(0);
  let evals = 1, best = { variant: ctx.variant, cost: detail, x: x0 }, tried = [detail.J], iteration = 0;
  const report = (partial) => {
    const out = { iteration, evals, cost: best.cost.J, start, best, tried, names: space.names, key: ctx.key, path: ctx.path, goal: g, scales };
    if (partial) return { ...out, partial: true };
    tried = [];
    return out;
  };
  // One run of the loop with the gains at x.
  function* f(x) {
    const variant = space.apply(x);
    let cost;
    try { cost = variantCost(ctx, variant, g, scales); } catch { cost = { J: 2 * DIVERGED, diverged: true, parts: {} }; }
    evals++;
    tried.push(cost.J);
    if (cost.J < best.cost.J) best = { variant, cost, x: x.slice() };
    yield report(true);
    return cost.J;
  }
  let simplex = [], fs = [];
  function* build(xb, fb) {
    simplex = [xb.slice()]; fs = [fb];
    for (let i = 0; i < n; i++) { const x = xb.slice(); x[i] += step; simplex.push(x); fs.push(yield* f(x)); }
  }
  yield report(true);
  yield* build(x0, detail.J);
  yield report(false);
  let mark = best.cost.J, since = 0;
  const patience = opts.patience ?? 15;

  for (iteration = 1; iteration <= maxIter; iteration++) {
    const order = fs.map((_, i) => i).sort((a, b) => fs[a] - fs[b]);
    simplex = order.map((i) => simplex[i]); fs = order.map((i) => fs[i]);
    let spread = 0;
    for (let i = 1; i <= n; i++) for (let j = 0; j < n; j++) spread = Math.max(spread, Math.abs(simplex[i][j] - simplex[0][j]));
    if (spread < 1e-2 || fs[n] - fs[0] <= 1e-4 * Math.abs(fs[0])) {
      if (!restarts--) break;
      step /= 4;
      yield* build(best.x, best.cost.J);
    } else {
      const c = new Array(n).fill(0);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += simplex[i][j] / n;
      const at = (a) => c.map((cj, j) => cj + a * (simplex[n][j] - cj));
      const xr = at(-1), fr = yield* f(xr);
      if (fr < fs[0]) {
        const xe = at(-2), fe = yield* f(xe);
        if (fe < fr) { simplex[n] = xe; fs[n] = fe; } else { simplex[n] = xr; fs[n] = fr; }
      } else if (fr < fs[n - 1]) {
        simplex[n] = xr; fs[n] = fr;
      } else {
        const xc = fr < fs[n] ? at(-0.5) : at(0.5), fc = yield* f(xc);
        if (fc < Math.min(fr, fs[n])) { simplex[n] = xc; fs[n] = fc; } else {
          for (let i = 1; i <= n; i++) { simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j])); fs[i] = yield* f(simplex[i]); }
        }
      }
    }
    yield report(false);
    // Done when the best cost has not fallen by 0.1 % for `patience` iterations.
    if (best.cost.J < 0.999 * mark) { mark = best.cost.J; since = iteration; }
    if (iteration - since >= patience) break;
  }
  iteration = Math.min(iteration, maxIter);
  return { ...report(false), done: true };
}

export function runIterate(project, path, goal, opts) {
  return drain(iterate(project, path, goal, opts));
}

// ---- Experiments around an operating point -----------------------------

const NO_RANGE = 'there is no scale for the test signal: the running variant has no actuator limits and its u does not move. Give it limits (u min, u max) in the Controller tab, or run a variant that controls';

// The operating point for an experiment: the Source that feeds r (through
// gains, lags and subsystem ports) held at the middle of its range, every
// other input (the disturbance d, …) at 0; r0 is the r this gives. The
// running variant holds r0 first; the u it needs there is the bias u0.
function* operatingPoint(ctx) {
  const ownRun = runVariant(ctx, ctx.variant);
  yield { partial: true, phase: 'operating point' };
  const own = loopSignals(ownRun, ctx.key);
  const rr = finiteRange(own.r);
  const name = ctx.source, notes = [];
  let signals = ctx.signals;
  if (name) {
    const sr = finiteRange(ownRun.signals[name] ?? []);
    const level = Number.isFinite(sr.lo) ? (sr.lo + sr.hi) / 2 : 0;
    signals = {};
    for (const [k, s] of Object.entries(ctx.signals)) signals[k] = { ...s, components: k === name ? [{ type: 'dc', params: { level } }] : [] };
  } else notes.push('input 1 is not fed by a Source (through gains, lags or subsystem ports), so r cannot be held: the experiment runs with the inputs as they are, and the estimate is rough');
  const sim = { ...ctx.sim };
  const holdRun = runVariant(ctx, ctx.variant, signals, sim);
  yield { partial: true, phase: 'operating point' };
  const hold = loopSignals(holdRun, ctx.key);
  const k0 = Math.floor(0.75 * hold.u.length);
  const r0 = name ? mean(hold.r, k0) : (rr.lo + rr.hi) / 2;
  let u0 = mean(hold.u, k0);
  const { lo, hi } = limitsOf(ctx.variant);
  if (!Number.isFinite(u0)) u0 = Number.isFinite(lo + hi) ? (lo + hi) / 2 : 0;
  u0 = Math.min(hi, Math.max(lo, u0));
  return { r0, name, signals, sim, u0, span: rr.hi - rr.lo, own, notes };
}

// The actuator range a test may use: the limits, or, without them, the swing
// of u in the variant's own run; 0 when neither gives one.
function actuatorRange(ctx, own) {
  const { lo, hi } = limitsOf(ctx.variant);
  if (Number.isFinite(hi - lo)) return hi - lo;
  const ur = finiteRange(own.u);
  const span = Math.max(ur.hi - ur.lo, Math.abs(ur.hi), Math.abs(ur.lo));
  return span > 1e-9 ? span : 0;
}

// The controller replaced by a constant u (a PID without gains holds its start
// output).
const constantU = (u, lo, hi) => normalizeVariant({ name: 'Step test', type: 'pid', params: { Kp: 0, Ki: 0, Kd: 0, u0: u, umin: lo, umax: hi } });

// Two open-loop runs, u held at u0 and at u0 + du; their difference dy is the
// plant's step response from the same start, so the start transient cancels
// (exact for a linear plant).
function* openLoopStep(ctx, op, du, sim) {
  const { lo, hi } = limitsOf(ctx.variant);
  const runA = runVariant(ctx, constantU(op.u0, lo, hi), op.signals, sim);
  yield { partial: true, phase: 'open loop' };
  const runB = runVariant(ctx, constantU(op.u0 + du, lo, hi), op.signals, sim);
  yield { partial: true, phase: 'open loop' };
  const yA = loopSignals(runA, ctx.key).y, yB = loopSignals(runB, ctx.key).y;
  return { runA, runB, dy: yB.map((v, k) => v - yA[k]) };
}

const longer = (sim, f) => ({ duration: sim.duration * f, sampleTime: sim.sampleTime });

// ---- Strategy 2: relay feedback ----------------------------------------

// Rules from the ultimate gain and period to a PID (Kp, Ti = Kp/Ki, Td = Kd/Kp).
export const RULES = {
  zn: { label: 'Ziegler–Nichols', short: 'Z–N', kp: 0.6, ti: 1 / 2, td: 1 / 8, about: 'Ziegler & Nichols (1942): fast, about a quarter decay; overshoots' },
  tl: { label: 'Tyreus–Luyben', short: 'T–L', kp: 1 / 2.2, ti: 2.2, td: 1 / 6.3, about: 'Tyreus & Luyben (1992): calmer and more robust, slower to remove errors' },
  calm: { label: 'No overshoot', short: 'no overshoot', kp: 0.2, ti: 1 / 2, td: 1 / 3, about: 'the "no overshoot" row of the Ziegler–Nichols tables: gentle' },
};

// A negative Ku (a reverse-acting plant) gives negative gains, as it should.
export function pidFromUltimate(Ku, Pu, rule = 'zn') {
  const r = RULES[rule];
  if (!r) throw new Error(`rule: one of ${Object.keys(RULES).join(', ')}`);
  const Kp = r.kp * Ku, Ti = r.ti * Pu, Td = r.td * Pu;
  return { Kp, Ki: Kp / Ti, Kd: Kp * Td, Ti, Td };
}

// Reads the steady oscillation from the last cycles of a relay run.
function readOscillation(run, key, mid, eps) {
  const { t, y, u } = loopSignals(run, key);
  const n = t.length;
  let valid = n;
  for (let k = 0; k < n; k++) if (!Number.isFinite(y[k])) { valid = k; break; }
  const ups = [];
  let switched = false;
  for (let k = 1; k < valid; k++) {
    if ((u[k] > mid) !== (u[k - 1] > mid)) switched = true;
    if (u[k] > mid && u[k - 1] <= mid) ups.push(k);
  }
  const out = { switched, cycles: Math.max(0, ups.length - 1), diverged: valid < n };
  if (ups.length < 4) return out;
  // The last full cycle, and the cycles before it for the period.
  const last = ups.length - 1, j0 = Math.max(1, last - 4);
  const Pu = (t[ups[last]] - t[ups[j0]]) / (last - j0);
  const P1 = t[ups[last]] - t[ups[last - 1]], P2 = t[ups[last - 1]] - t[ups[last - 2]];
  const amp = (a, b) => { const r = finiteRange(y, a, b); return (r.hi - r.lo) / 2; };
  const a = amp(ups[last - 1], ups[last]), a2 = amp(ups[last - 2], ups[last - 1]);
  let high = 0;
  for (let k = ups[last - 1]; k < ups[last]; k++) if (u[k] > mid) high++;
  const yMean = mean(y, ups[last - 1], ups[last]), yPrev = mean(y, ups[last - 2], ups[last - 1]);
  // The describing function assumes y is a sine: use the amplitude of the
  // fundamental (a Fourier coefficient over the last cycle), not the peak,
  // which the harmonics raise.
  const k0 = ups[last - 1], k1 = ups[last], w = (2 * Math.PI) / (t[k1] - t[k0]);
  let c = 0, sn = 0;
  for (let k = k0; k < k1; k++) { c += (y[k] - yMean) * Math.cos(w * t[k]); sn += (y[k] - yMean) * Math.sin(w * t[k]); }
  const a1 = (2 / (k1 - k0)) * Math.hypot(c, sn);
  return {
    ...out, Pu, a, a1, high: high / (ups[last] - ups[last - 1]), uMean: mean(u, ups[last - 1], ups[last]),
    settled: Math.abs(P1 - P2) <= 0.05 * Pu && Math.abs(a - a2) <= 0.05 * a, drift: Math.abs(yMean - yPrev) > 0.2 * a,
    hysteresisOnly: a < 1.5 * eps,
  };
}

// The experiments replace the controller with a relay or a constant: that
// only makes sense for a loop with one measurement (r, y).
function siso(ctx) {
  const m = ctx.block.params.inputs - 1;
  return m > 1 ? `${ctx.where} uses ${m} measurements; the relay and step tests are for loops with one (r, y). Use the iterative method.` : '';
}

// Why a method cannot run on the context's variant, or '' when it can.
export function whyNot(ctx, method) {
  if (method !== 'iterate') return siso(ctx);
  try { tuningSpace(ctx.variant); return ''; } catch (err) { return err.message; }
}

// The relay experiment: around r0, u = u0 ± d with hysteresis ε. A short
// open-loop step first tells which way the plant goes: if y falls when u
// rises (reverse acting) the relay is reversed and Ku comes out negative. The
// bias starts at what the running variant needs to hold r0 and is corrected
// until the relay is high half the time (a symmetric oscillation). The run
// grows until it holds enough cycles. Ku = 4d / (π √(a² − ε²)) from the
// describing function of a relay with hysteresis, a the amplitude of y's
// fundamental; Pu is the oscillation's period.
// opts: amplitude (fraction of the actuator range, default 0.1) or d
// (absolute), hysteresis (absolute; default 0.1 % of r's span).
export function* relayExperimentSteps(project, path, opts = {}) {
  const ctx = tuneContext(project, path);
  if (siso(ctx)) return { ctx, ok: false, notes: [], why: siso(ctx) };
  const op = yield* operatingPoint(ctx);
  const { lo, hi } = limitsOf(ctx.variant);
  const notes = [...op.notes];
  const base = { ctx, r0: op.r0, notes, source: op.name };
  const range = actuatorRange(ctx, op.own);
  if (opts.d === undefined && !range) return { ...base, ok: false, u0: op.u0, why: NO_RANGE };
  const want = Math.abs(opts.d ?? (opts.amplitude ?? 0.1) * range);
  const eps = opts.hysteresis ?? 0.001 * (op.span > 1e-9 ? op.span : Math.abs(op.r0) || 1);
  // Which way y goes when u rises (up if there is room, else down).
  const probe = hi - op.u0 >= Math.min(want, op.u0 - lo) ? want : -want;
  const { dy } = yield* openLoopStep(ctx, op, probe, op.sim);
  let moved = 0;
  for (const v of dy) if (Number.isFinite(v)) moved += v;
  const sign = moved * probe < 0 ? -1 : 1;
  if (sign < 0) notes.push('y falls when u rises (a reverse-acting plant): the relay is reversed and Ku is negative');
  let u0 = op.u0, sim = op.sim, run = null, osc = null, d = want;
  for (let tries = 0; tries < 8; tries++) {
    // The relay stays inside the limits so it is symmetric about u0.
    d = Math.min(want, hi - u0, u0 - lo);
    // Less than a tenth of the amplitude asked for is too little to read a cycle from.
    if (!(d > 0.1 * want)) return { ...base, ok: false, u0, d, run, sign, why: `the bias u0 = ${fmtN(u0)} needed to hold r0 = ${fmtN(op.r0)} sits at an actuator limit (${fmtN(lo)} … ${fmtN(hi)}): no room for the relay to swing` };
    const relay = normalizeVariant({ name: 'Relay experiment', type: 'relay', params: { d: sign * d, eps, u0, umin: lo, umax: hi } });
    run = runVariant(ctx, relay, op.signals, sim);
    yield { partial: true, phase: 'relay', run };
    osc = readOscillation(run, ctx.key, u0, eps);
    if (osc.diverged) return { ...base, ok: false, u0, d, run, sign, why: 'the relay run diverged: the plant may be unstable without its controller' };
    if (!osc.switched) {
      // Stuck on one side: the bias cannot carry y across r0. Move it by d.
      const { y } = loopSignals(run, ctx.key);
      u0 += sign * (y[y.length - 1] < op.r0 ? 1 : -1) * want;
      if (u0 > hi || u0 < lo) return { ...base, ok: false, u0, d, run, sign, why: `the relay never switched: with u0 ± d inside the limits the measurement does not cross r0 = ${fmtN(op.r0)}` };
      continue;
    }
    if (osc.cycles < 4) {
      if (sim.duration >= 16 * ctx.sim.duration) break;
      sim = longer(sim, 4);
      continue;
    }
    if (Math.abs(osc.high - 0.5) > 0.03 && tries < 6) { u0 = Math.min(hi, Math.max(lo, osc.uMean)); continue; }
    break;
  }
  const res = { ...base, u0, d, run, sim, osc, sign };
  if (!osc?.switched) return { ...res, ok: false, why: `the relay never switched: the measurement does not cross r0 = ${fmtN(op.r0)}` };
  if (osc.cycles < 4) return { ...res, ok: false, why: `only ${osc.cycles} cycle${osc.cycles === 1 ? '' : 's'} in ${fmtN(sim.duration)} s: the plant is too slow for this window (lengthen the input's period)` };
  if (osc.hysteresisOnly) return { ...res, ok: false, why: 'the oscillation is no larger than the relay\'s hysteresis: the plant has too little lag for a relay test (an integrator or a first-order lag alone)' };
  if (osc.drift) notes.push('y drifts from cycle to cycle (an integrating plant, or a load the bias does not balance): the estimate is rough');
  if (!osc.settled) notes.push('the oscillation had not quite settled: the estimate is rough');
  if (Math.abs(osc.high - 0.5) > 0.05) notes.push(`the oscillation is asymmetric (relay high ${Math.round(100 * osc.high)} % of the time)`);
  if (d < 0.999 * want) notes.push(`the relay amplitude was reduced to ${fmtN(d)} to stay inside the actuator limits`);
  const a = osc.a1;
  const Ku = (4 * sign * d) / (Math.PI * Math.sqrt(Math.max(a * a - eps * eps, 1e-30)));
  return { ...res, ok: true, Ku, Pu: osc.Pu, a };
}

export const relayExperiment = (project, path, opts) => drain(relayExperimentSteps(project, path, opts));

// Relay experiment, then a PID by the rule, as a new variant that keeps the
// running variant's limits, start output, setpoint weight and prefilter.
// opts.name: the new variant's name.
export function* relayTuneSteps(project, path, rule = 'tl', opts = {}) {
  if (!RULES[rule]) throw new Error(`rule: one of ${Object.keys(RULES).join(', ')}`);
  const ex = yield* relayExperimentSteps(project, path, opts);
  if (!ex.ok) return ex;
  const g = pidFromUltimate(ex.Ku, ex.Pu, rule);
  const variant = pidVariant(ex.ctx.variant, g, opts.name ?? `${baseName(ex.ctx.variant.name)} · relay ${RULES[rule].short}`, ex.ctx.Ts);
  return { ...ex, rule, gains: g, variant };
}

export const relayTune = (project, path, rule, opts) => drain(relayTuneSteps(project, path, rule, opts));

// ---- Strategy 3: step response and SIMC --------------------------------

// The open-loop step test: the controller is replaced by a constant u0 (what
// the running variant needs at r0), then u0 + Δu; their difference is the
// plant's step response. If it has not settled in one period of the input it
// runs once more, four times as long. A first order plus dead time is fitted
// by Smith's two-point method (28.3 % and 63.2 % of the change):
//   K = Δy∞ / Δu,  τ = 1.5 (t63 − t28),  θ = t63 − τ
// and tuned by SIMC (Skogestad 2003) with τc = θ ("tight" control):
//   Kp = τ / (K (τc + θ)),  Ti = min(τ, 4 (τc + θ))
// θ includes half a controller sample, the delay a digital controller adds;
// with almost no dead time τc is kept at τ / 10 at least.
export function* stepExperimentSteps(project, path, opts = {}) {
  const ctx = tuneContext(project, path);
  if (siso(ctx)) return { ctx, ok: false, notes: [], why: siso(ctx) };
  const op = yield* operatingPoint(ctx);
  const { lo, hi } = limitsOf(ctx.variant);
  const range = actuatorRange(ctx, op.own);
  const base = { ctx, r0: op.r0, u0: op.u0, notes: [...op.notes] };
  if (opts.du === undefined && !range) return { ...base, ok: false, why: NO_RANGE };
  const want = Math.abs(opts.du ?? (opts.amplitude ?? 0.1) * range);
  // Upwards if there is room, else downwards, else as far as the limits allow.
  const up = hi - op.u0, down = op.u0 - lo;
  const du = up >= want ? want : down >= want ? -want : up >= down ? up : -down;
  base.du = du;
  if (Math.abs(du) < 0.1 * want) return { ...base, ok: false, why: 'the actuator is at a limit at the operating point: no room for a step' };
  let sim = op.sim, runB, dy;
  for (let tries = 0; tries < 2; tries++) {
    ({ runB, dy } = yield* openLoopStep(ctx, op, du, sim));
    const n = dy.length, end = dy[n - 1], k9 = Math.floor(0.9 * n);
    if (!Number.isFinite(end)) return { ...base, ok: false, run: runB, why: 'the open-loop run diverged: the plant is unstable without its controller; use the relay or iterative method' };
    if (Math.abs(end - dy[k9]) <= 0.02 * Math.abs(end)) break;
    if (tries === 1) return { ...base, ok: false, run: runB, why: 'the step response has not settled in four periods of the input: an integrating or very slow plant (SIMC here assumes one that settles)' };
    sim = longer(sim, 4);
  }
  const t = runB.t, n = dy.length, end = dy[n - 1];
  if (Math.abs(end) < 1e-9) return { ...base, ok: false, run: runB, why: 'y does not respond to u: is the controller output wired to the plant?' };
  const cross = (level) => {
    for (let k = 1; k < n; k++) if ((dy[k] - level * end) * Math.sign(end) >= 0) {
      const f = (level * end - dy[k - 1]) / (dy[k] - dy[k - 1] || 1);
      return t[k - 1] + f * (t[k] - t[k - 1]);
    }
    return t[n - 1];
  };
  const K = end / du, t28 = cross(0.283), t63 = cross(0.632);
  const tau = Math.max(1.5 * (t63 - t28), 1e-6), theta = Math.max(0, t63 - tau);
  return { ...base, ok: true, run: runB, sim, K, tau, theta, t28, t63 };
}

export const stepExperiment = (project, path, opts) => drain(stepExperimentSteps(project, path, opts));

export function simcGains(K, tau, theta, Ts = 0, tauC = null) {
  const th = theta + Ts / 2;
  const tc = tauC ?? Math.max(th, tau / 10);
  const Kp = tau / (K * (tc + th)), Ti = Math.min(tau, 4 * (tc + th));
  return { Kp, Ki: Kp / Ti, Kd: 0, Ti, Td: 0, tauC: tc };
}

// opts.name: the new variant's name; opts.tauC overrides τc = θ.
export function* stepTuneSteps(project, path, opts = {}) {
  const ex = yield* stepExperimentSteps(project, path, opts);
  if (!ex.ok) return ex;
  const g = simcGains(ex.K, ex.tau, ex.theta, ex.ctx.Ts, opts.tauC);
  const variant = pidVariant(ex.ctx.variant, g, opts.name ?? `${baseName(ex.ctx.variant.name)} · SIMC`, ex.ctx.Ts);
  return { ...ex, gains: g, variant };
}

export const stepTune = (project, path, opts) => drain(stepTuneSteps(project, path, opts));

// ---- One entry: the page, the command line, agents ----------------------

export const METHODS = ['iterate', 'relay', 'step'];

// Runs a method on the block at path (default: the first Controller block)
// and scores its result against the running variant with the goal. Yields
// what the strategy yields; returns
//   { ok, why, method, key, where, before: { variant, cost }, variant (the
//     result, named), after (its cost), better, notes, … the method's own:
//     iterate: iterations, evals, names; relay: Ku, Pu, a, u0, d, r0, rule,
//     gains, run; step: K, tau, theta, gains, run }
// opts: method, goal, maxIter, rule, amplitude, name (of the result variant;
// default resultName).
export function* autotuneSteps(project, path, opts = {}) {
  const method = opts.method ?? 'iterate';
  if (!METHODS.includes(method)) throw new Error(`method: one of ${METHODS.join(', ')}`);
  const g = { ...GOAL, ...opts.goal };
  const ctx = tuneContext(project, path);
  const head = { method, key: ctx.key, path: ctx.path, where: ctx.where, goal: g };
  const why = whyNot(ctx, method);
  if (why) return { ...head, ok: false, why, notes: [] };
  const name = opts.name ?? resultName(ctx.block, method, opts.rule);
  if (method === 'iterate') {
    const r = yield* iterate(project, path, g, { maxIter: opts.maxIter });
    const better = r.best.cost.J < r.start.cost;
    return {
      ...head, ok: true, notes: [], before: { variant: ctx.variant, cost: r.start.detail },
      variant: { ...r.best.variant, name }, after: r.best.cost, better, iterations: r.iteration, evals: r.evals, names: r.names,
    };
  }
  const startRun = runVariant(ctx, ctx.variant);
  const scales = costScales(startRun, ctx.key, ctx.variant);
  const before = { variant: ctx.variant, cost: runCost(startRun, ctx.key, g, { scales, variant: ctx.variant, others: ctx.others }) };
  yield { partial: true, phase: 'start', before };
  const res = method === 'relay'
    ? yield* relayTuneSteps(project, path, opts.rule ?? 'tl', { amplitude: opts.amplitude, d: opts.d, name })
    : yield* stepTuneSteps(project, path, { amplitude: opts.amplitude, du: opts.du, name });
  if (!res.ok) return { ...res, ...head, before };
  const after = variantCost(ctx, res.variant, g, scales);
  yield { partial: true, phase: 'score' };
  return { ...res, ...head, before, after, better: after.J < before.cost.J };
}

export const autotune = (project, path, opts) => drain(autotuneSteps(project, path, opts));

// A result of autotune() as plain JSON (no runs; open limits as null), for
// the command line and agents.
export function tuneReport(res) {
  const cost = (c) => c && { J: c.J, overshoot: c.overshoot, saturated: c.saturated, diverged: c.diverged, parts: c.parts };
  const out = { ok: res.ok, method: res.method, block: res.key, where: res.where, goal: res.goal };
  if (!res.ok) Object.assign(out, { why: res.why, notes: res.notes ?? [] });
  else {
    Object.assign(out, { better: res.better, before: { variant: res.before.variant, cost: cost(res.before.cost) }, after: { variant: res.variant, cost: cost(res.after) }, notes: res.notes });
    if (res.method === 'iterate') Object.assign(out, { iterations: res.iterations, evals: res.evals, tuned: res.names });
    if (res.method === 'relay') Object.assign(out, { Ku: res.Ku, Pu: res.Pu, amplitude: res.a, r0: res.r0, u0: res.u0, d: res.d, rule: res.rule, gains: res.gains });
    if (res.method === 'step') Object.assign(out, { K: res.K, tau: res.tau, theta: res.theta, r0: res.r0, u0: res.u0, du: res.du, gains: res.gains });
  }
  return JSON.parse(JSON.stringify(out));
}

// ---- Variants -----------------------------------------------------------

// The name a variant had before any tuning suffix this module adds.
export function baseName(name) {
  return String(name).replace(/( · (auto-tuned|relay [^·]+?|SIMC)( \d+)?)+$/, '');
}

// The name for a method's result: "<base> · auto-tuned", "· relay T–L" (by
// the rule) or "· SIMC". A running variant that already has the name (or a
// numbered one of it) keeps it: tuning again updates it. Another variant of
// that name is never overwritten: the new one is numbered.
export function resultName(block, method, rule = 'tl') {
  const running = block.variants[block.variant ?? 0];
  const base = baseName(running.name);
  const suffix = method === 'iterate' ? ' · auto-tuned' : method === 'relay' ? ` · relay ${RULES[rule]?.short ?? rule}` : ' · SIMC';
  const named = (s) => `${base.slice(0, Math.max(0, 40 - s.length))}${s}`;
  const plain = named(suffix);
  if (running.name === plain || (running.name.startsWith(plain) && /^ \d+$/.test(running.name.slice(plain.length)))) return running.name;
  const taken = new Set(block.variants.map((v) => v.name));
  for (let i = 1; ; i++) { const s = named(i === 1 ? suffix : `${suffix} ${i}`); if (!taken.has(s)) return s; }
}

// Puts a variant into the block at path of the project (changing it): over
// the variant of the same name, else after the running one. run: make it the
// running variant. Returns its index.
export function placeVariant(project, path, variant, { run = true } = {}) {
  const { block } = locate(project.system.plant.diagram, path);
  let i = block.variants.findIndex((v) => v.name === variant.name);
  if (i < 0) { i = (block.variant ?? 0) + 1; block.variants.splice(i, 0, null); }
  block.variants[i] = structuredClone(variant);
  if (run) block.variant = i;
  return i;
}

// A PID with the given gains that drives the same actuator as the variant it
// replaces: limits, start output, setpoint weight and prefilter carry over.
// The derivative is filtered at Td / 10 (but not faster than a sample).
export function pidVariant(from, g, name, Ts) {
  const p = from.params ?? {};
  const pid = from.type === 'pid';
  return normalizeVariant({
    name: name.slice(0, 40), type: 'pid',
    params: { Kp: g.Kp, Ki: g.Ki, Kd: g.Kd, Tf: g.Kd ? Math.max(Ts, (g.Td ?? 0) / 10) : (pid ? p.Tf : 0.01), b: pid ? p.b : 1, Tr: p.Tr ?? 0, u0: p.u0 ?? 0, umin: p.umin ?? -Infinity, umax: p.umax ?? Infinity },
  });
}

function fmtN(v) {
  if (!Number.isFinite(v)) return String(v);
  return String(Number(v.toPrecision(3)));
}
