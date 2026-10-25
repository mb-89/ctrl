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
//   step     an open-loop step (process reaction curve) from where the loop
//            holds r, fitted with a first order plus dead time or, when y
//            ramps, an integrator with lag and dead time, then SIMC
//            (Skogestad 2003); a gain-scheduled PI is tested at each point.
// The simulations read the block's own r (input 1), y (input 2) and u from
// the probes compileDiagram adds under "<block path>.r", ".y", ".u".
// Every strategy is a generator that yields after each run of the loop, so
// the page can keep drawing while it works (a run of a large plant takes tens
// of milliseconds) and pace the runs at its speed; a yield after a run says
// how much time it simulated (seconds), and Iterate's carry the run itself
// (run), which the page sweeps across the display. drain() runs one to its
// end (tests, the command line).
// autotune() is the one entry for the page, the command line and agents.

import { simulateSystem } from './sim.js';
import { defaultSampleTime } from './project.js';
import { normalizeVariant, makeLaw, CONTROLLERS } from './controllers.js';
import { parseEnd, blockPorts, compileDiagram } from './diagram.js';
import { amplitudeSpectrum } from './spectrum.js';

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

// The first External plant block (Live mode) in a diagram, at any depth.
function externalBlock(diagram) {
  for (const b of diagram.blocks) {
    if (b.type === 'external') return b;
    const inner = b.type === 'subsystem' ? externalBlock(b.diagram) : null;
    if (inner) return inner;
  }
  return null;
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
  // Every method simulates the loop; a plant outside the page (Live mode)
  // only outputs 0 here, so nothing could be learned from it.
  const ext = externalBlock(plant.diagram);
  if (ext) throw new Error(`the plant runs outside the page (External plant ${ext.name ?? ext.id}); Auto-tune simulates the loop and has no model of it (identification is not built yet). Tune it live in the Controller tab`);
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
  const running = normalizeVariant(block.variants[block.variant ?? 0]);
  const { variant, designed } = asTuned(plant.diagram, hit, running);
  const period = Math.max(...Object.values(project.system.signals).map((s) => s.period));
  const sim = { duration: period, sampleTime: project.sim?.sampleTime ?? defaultSampleTime(period) };
  // Copies, so the page may change the project while a tuning run reads these.
  const ctx = { diagram: structuredClone(plant.diagram), signals: structuredClone(project.system.signals), path: hit.path, key: hit.key, where: hit.where, block, variant, designed, sim, Ts: block.params.Ts };
  // The Source that feeds r, and the other inputs (the disturbance d, …).
  ctx.source = upstreamSource(ctx.diagram, ctx.path, 0);
  ctx.others = ctx.source ? Object.keys(ctx.signals).filter((k) => k !== ctx.source) : [];
  return ctx;
}

// A variant from the plant (design/output/designs.md) runs as its Copy as
// numbers twin with the numbers its design computes; Auto-tune tunes that
// twin, from those numbers, and its result is a hand variant like any other
// (the designed one stays, and goes on following the plant). The design is
// the one a compile makes now (in the page, from the page's store, as a
// guest: a plan not made yet has no numbers). A type without a twin (a
// planned swing-up), or a design that has no numbers, stays as it is, and
// tuningSpace says why it cannot be tuned. designed: { label, error } then.
function asTuned(diagram, hit, running) {
  const def = CONTROLLERS[running.type];
  if (!def?.designed) return { variant: running, designed: null };
  let st = null;
  try { st = compileDiagram(diagram, 'plant', { standalone: true }).designs.find((x) => x.path === hit.key); } catch { st = null; }
  if (!def.manual || !st?.values) return { variant: running, designed: { label: def.label, type: running.type, error: st?.error?.message ?? (st && st.status !== 'ok' && st.status !== 'warn' ? `its design is ${st.status}` : '') } };
  const twin = normalizeVariant(def.manual(running.params, st.values));
  return { variant: { ...twin, name: running.name }, designed: { label: def.label, type: running.type, from: twin.type } };
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
  trajectory: 'A planned swing-up follows a plan computed from the plant: it has no gains of its own to tune. Change its inputs (T, Q, R) in the Controller tab.',
};
// A variant from the plant whose design has no numbers to start from.
const undesigned = (v) => `${CONTROLLERS[v.type].label} computes its numbers from the plant, and has none now; see its Computed box in the Controller tab, or tune a hand variant`;

// The knobs the optimiser turns, as log factors on the variant's own values:
// x = 0 is the variant as it is, x = ln 2 doubles a gain. A gain at 0 stays
// off (the structure is the person's choice) and no sign ever flips.
//   pid            Kp, Ki, Kd, and the reference feedforward Kff, Kv, Ka
//   gainScheduled  the Kp table and the Ki table, each scaled as a whole; Kff, Kv, Ka
//   stateFeedback  each gain in K, and the prefilter kr
//   slidingMode    λ, and φ when it is above 0 (a relay stays a relay). K is
//                  left alone: it is the actuator's swing, and turning it
//                  down only moves u off the limit while the relay still slams
//   superTwisting  λ, k1 and k2
// start: values for feedforward gains that are 0, when the person asked to
// tune those too (feedforwardStart); they are then turned like the others,
// from there. base is the variant at x = 0.
const FF_KEYS = ['Kff', 'Kv', 'Ka'];
const isOn = (v) => Number.isFinite(v) && v !== 0;
export function tuningSpace(variant, { start = null, part = 'all' } = {}) {
  const p = { ...variant.params };
  const started = start ? FF_KEYS.filter((k) => p[k] === 0 && isOn(start[k])) : [];
  for (const k of started) p[k] = start[k];
  const f = (x) => Math.exp(Math.max(-LOG_LIMIT, Math.min(LOG_LIMIT, x)));
  const on = isOn;
  const fb = part !== 'feedforward', ff = part === 'feedback' ? [] : FF_KEYS.filter((k) => on(p[k]));
  let names, apply;
  if (variant.type === 'pid') {
    const keys = [...(fb ? ['Kp', 'Ki', 'Kd'] : []), ...ff].filter((k) => on(p[k]));
    names = keys;
    apply = (x) => { const q = { ...p }; keys.forEach((k, i) => { q[k] = p[k] * f(x[i]); }); return q; };
  } else if (variant.type === 'gainScheduled') {
    const keys = fb ? ['Kp', 'Ki'].filter((k) => p[k].some(on)) : [];
    names = [...keys.map((k) => `${k} table ×`), ...ff];
    apply = (x) => {
      const q = { ...p };
      keys.forEach((k, i) => { q[k] = p[k].map((v) => v * f(x[i])); });
      ff.forEach((k, j) => { q[k] = p[k] * f(x[keys.length + j]); });
      return q;
    };
  } else if (variant.type === 'stateFeedback') {
    const idx = p.K.map((v, i) => i).filter((i) => on(p.K[i]));
    names = [...idx.map((i) => `K${i + 1}`), ...(on(p.kr) ? ['kr'] : [])];
    apply = (x) => {
      const q = { ...p, K: p.K.slice() };
      idx.forEach((i, j) => { q.K[i] = p.K[i] * f(x[j]); });
      if (on(p.kr)) q.kr = p.kr * f(x[idx.length]);
      return q;
    };
  } else if (variant.type === 'slidingMode' || variant.type === 'superTwisting') {
    // λ, and a boundary layer's width; a relay (φ = 0) stays a relay. The
    // switching gain K stays: the cost counts the time u sits at a limit, and
    // a K just under the limit would zero that count while the relay still
    // slams. The cost has no chattering term (no V/s), so it does not judge
    // chattering.
    const keys = fb ? (variant.type === 'slidingMode' ? ['lambda', 'phi'] : ['lambda', 'k1', 'k2']).filter((k) => on(p[k])) : [];
    names = keys.map((k) => (k === 'lambda' ? 'λ' : k === 'phi' ? 'φ' : k));
    apply = (x) => { const q = { ...p }; keys.forEach((k, i) => { q[k] = p[k] * f(x[i]); }); return q; };
  } else throw new Error(UNTUNABLE[variant.type] ?? (CONTROLLERS[variant.type]?.designed ? undesigned(variant) : `a ${variant.type} variant cannot be tuned`));
  if (!names.length) throw new Error('every gain of this variant is 0; give the gains it should use a start value, then tune');
  return { names, started, base: started.length ? { ...variant, params: p } : variant, apply: (x) => ({ ...variant, params: apply(x) }) };
}

// Start values for feedforward gains that are 0, when the person asks to tune
// them too. The feedforward should put out the u the loop needs to follow r,
// so the start is read from the starting run, in two parts (rf: r through
// the variant's prefilter; differences over the run's samples):
//   Kff  what holds y at r: from the samples where rf rests and y has settled
//        at it (within 2 % of r's span), u ≈ c + Kff·rf. It needs two levels
//        of r at rest; otherwise (a sine never rests) it stays 0. An
//        integrating plant (a motor's angle) needs no u to stay anywhere, so
//        Kff comes out about 0, as it should
//   Kv, Ka  what moving takes: over the whole run, u − Kff·rf ≈ c + Kv·drf/dt
//        + Ka·d²rf/dt²
// Samples where another input (others: the disturbance d) is not 0 are left
// out: there u answers the disturbance, not r. A term whose signal the run
// cannot tell from the ones before it (a constant r has no speed) is left
// out, and so is one that explains less than 2 % of u's swing: it stays 0.
// Returns { Kff, Kv, Ka } (0 where left out).
export function feedforwardStart(run, key, variant, others = []) {
  const { t, r, y, u } = loopSignals(run, key);
  const n = t.length, out = { Kff: 0, Kv: 0, Ka: 0 };
  if (n < 5) return out;
  const dt = (t[n - 1] - t[0]) / (n - 1), Tr = variant.params.Tr ?? 0;
  const a = Tr > 0 ? Math.exp(-dt / Tr) : 0;
  const rf = new Float64Array(n);
  for (let k = 0; k < n; k++) rf[k] = k && a ? a * rf[k - 1] + (1 - a) * r[k] : r[k];
  const d1 = new Float64Array(n), d2 = new Float64Array(n);
  for (let k = 1; k < n - 1; k++) { d1[k] = (rf[k + 1] - rf[k - 1]) / (2 * dt); d2[k] = (rf[k + 1] - 2 * rf[k] + rf[k - 1]) / (dt * dt); }
  const quiet = (k) => others.every((name) => { const v = run.signals[name]?.[k]; return !Number.isFinite(v) || Math.abs(v) < 1e-12; });
  const rows = []; for (let k = 1; k < n - 1; k++) if (Number.isFinite(u[k]) && Number.isFinite(rf[k]) && quiet(k)) rows.push(k);
  if (rows.length < 4) return out;
  const sd = (x) => { const mu = x.reduce((s, v) => s + v, 0) / x.length; return Math.sqrt(x.reduce((s, v) => s + (v - mu) ** 2, 0) / x.length); };
  const swing = sd(rows.map((k) => u[k]));
  const { lo, hi } = finiteRange(rf), span = hi - lo;
  // At rest: rf still, y settled at it.
  const rest = rows.filter((k) => Math.abs(rf[k + 1] - rf[k - 1]) <= 1e-6 * span && Number.isFinite(y[k]) && Math.abs(y[k] - rf[k]) <= 0.02 * span);
  if (rest.length >= 4 && sd(rest.map((k) => rf[k])) > 1e-3 * span) {
    const [, Kff] = leastSquares([rest.map(() => 1), rest.map((k) => rf[k])], rest.map((k) => u[k]));
    if (Number.isFinite(Kff) && Math.abs(Kff) * sd(rows.map((k) => rf[k])) >= 0.02 * swing) out.Kff = Kff;
  }
  const z = rows.map((k) => u[k] - out.Kff * rf[k]);
  const c = leastSquares([rows.map(() => 1), rows.map((k) => d1[k]), rows.map((k) => d2[k])], z);
  [['Kv', d1, c[1]], ['Ka', d2, c[2]]].forEach(([name, col, g]) => {
    if (Number.isFinite(g) && Math.abs(g) * sd(rows.map((k) => col[k])) >= 0.02 * swing) out[name] = g;
  });
  return out;
}

// Least squares y ≈ Σ c_j·cols[j]. A column the others already explain
// (Gram–Schmidt: less than 1e-6 of it is new) is left out: its c is NaN.
function leastSquares(cols, y) {
  const dot = (x, z) => x.reduce((s, v, i) => s + v * z[i], 0);
  const basis = [], kept = [];
  cols.forEach((col, j) => {
    let w = col.slice();
    for (const q of basis) { const s = dot(w, q); w = w.map((v, i) => v - s * q[i]); }
    const norm = Math.sqrt(dot(w, w)), full = Math.sqrt(dot(col, col));
    if (norm > 1e-6 * full && norm > 1e-12) { basis.push(w.map((v) => v / norm)); kept.push(j); }
  });
  // The normal equations of the kept columns.
  const m = kept.length, M = kept.map((i) => kept.map((j) => dot(cols[i], cols[j]))), b = kept.map((i) => dot(cols[i], y));
  for (let i = 0; i < m; i++) {
    let piv = i; for (let k = i + 1; k < m; k++) if (Math.abs(M[k][i]) > Math.abs(M[piv][i])) piv = k;
    [M[i], M[piv]] = [M[piv], M[i]]; [b[i], b[piv]] = [b[piv], b[i]];
    for (let k = i + 1; k < m; k++) { const f = M[k][i] / M[i][i]; for (let j = i; j < m; j++) M[k][j] -= f * M[i][j]; b[k] -= f * b[i]; }
  }
  const x = new Array(m).fill(0);
  for (let i = m - 1; i >= 0; i--) { let s = b[i]; for (let j = i + 1; j < m; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
  const c = new Array(cols.length).fill(NaN);
  kept.forEach((j, i) => { c[j] = x[i]; });
  return c;
}

// The values the tuner turns, for showing before and after: [[name, value]].
// Feedforward gains show when they are not 0.
export function tunedValues(variant) {
  const p = variant.params;
  const ff = FF_KEYS.filter((k) => isOn(p[k])).map((k) => [k, p[k]]);
  if (variant.type === 'pid') return [...['Kp', 'Ki', 'Kd'].map((k) => [k, p[k]]), ...ff];
  if (variant.type === 'gainScheduled') return [['Kp', p.Kp], ['Ki', p.Ki], ...ff];
  if (variant.type === 'stateFeedback') return [['K', p.K], ['kr', p.kr]];
  if (variant.type === 'slidingMode') return [['λ', p.lambda], ['φ', p.phi]];
  if (variant.type === 'superTwisting') return [['λ', p.lambda], ['k1', p.k1], ['k2', p.k2]];
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
// { iteration, evals, cost, start, best: { variant, cost, x }, tried, names,
// stage, notes }; the final value has done: true.
// opts.feedforward: also tune the feedforward gains that are 0, from the
// start feedforwardStart fits to the starting run.
// With feedforward and feedback gains to tune, it tunes them in two stages,
// each its own search: first the feedforward with the feedback held (a
// feedforward cannot change the loop, so this is always safe), then the
// feedback with the feedforward held (stage 'feedforward', 'feedback';
// without feedforward 'all'). The feedforward stage gets at most half the
// iterations. A run without a disturbance cannot judge the feedback once a
// feedforward follows r: tuned there, the feedback gains drift weak (on
// Following a sine, Ki fell from 80 to 0.09 and the error under a load
// doubled). So when the run has none and the feedforward is on after its
// stage, the feedback is held, and a note says so.
export function* iterate(project, path, goal = {}, opts = {}) {
  const g = { ...GOAL, ...goal };
  const ctx = tuneContext(project, path);
  tuningSpace(ctx.variant);   // says why not, before any run
  const maxIter = opts.maxIter ?? 60, patience = opts.patience ?? 15;
  const startRun = runVariant(ctx, ctx.variant);
  const scales = costScales(startRun, ctx.key, ctx.variant);
  const detail = runCost(startRun, ctx.key, g, { scales, variant: ctx.variant, others: ctx.others });
  const start = { cost: detail.J, detail, variant: ctx.variant };
  const seconds = ctx.sim.duration;
  const ffStart = opts.feedforward && ['pid', 'gainScheduled'].includes(ctx.variant.type) ? feedforwardStart(startRun, ctx.key, ctx.variant, ctx.others) : null;
  const whole = tuningSpace(ctx.variant, { start: ffStart });
  const ffNames = whole.names.filter((k) => FF_KEYS.includes(k)), quiet = !disturbed(startRun, ctx.others);
  const stages = ffNames.length && ffNames.length < whole.names.length ? ['feedforward', 'feedback'] : ['all'];
  let names = whole.names;
  const notes = [];
  let evals = 1, best = { variant: ctx.variant, cost: detail, x: null }, tried = [detail.J], iteration = 0, stage = stages[0], space = whole;
  const report = (partial) => {
    const out = { iteration, evals, cost: best.cost.J, start, best, tried, names, stage, notes, key: ctx.key, path: ctx.path, goal: g, scales };
    if (partial) return { ...out, partial: true };
    tried = [];
    return out;
  };
  // One run of the loop with the gains at x.
  function* f(x) {
    const variant = space.apply(x);
    let cost, run = null;
    try {
      run = runVariant(ctx, variant);
      cost = runCost(run, ctx.key, g, { scales, variant, others: ctx.others });
    } catch { cost = { J: 2 * DIVERGED, diverged: true, parts: {} }; }
    evals++;
    tried.push(cost.J);
    if (cost.J < best.cost.J) best = { variant, cost, x: x.slice() };
    yield { ...report(true), seconds, run };
    return cost.J;
  }
  yield { ...report(true), seconds, run: startRun };
  for (const [i, part] of stages.entries()) {
    if (part === 'feedback' && quiet && FF_KEYS.some((k) => isOn(best.variant.params[k]))) {
      names = ffNames;
      notes.push('this run has no disturbance, so it cannot judge the feedback once the feedforward follows r: the feedback gains were held and only the feedforward was tuned. To tune the feedback too, give d a step in the Input tab, or set the feedforward to 0 first');
      break;
    }
    stage = part;
    // Each stage starts from the best so far: x = 0 is that variant, or for
    // the first, the variant with its started feedforward gains.
    space = part === 'all' ? whole : tuningSpace(i ? best.variant : ctx.variant, { part, start: i ? null : ffStart });
    const n = space.names.length, x0 = new Array(n).fill(0);
    const until = part === 'feedforward' ? Math.ceil(maxIter / 2) : maxIter;
    let step = opts.step ?? Math.log(2), restarts = opts.restarts ?? 2;
    // Where the stage's best lies (null: at x0).
    const at0 = best.cost.J;
    best = { ...best, x: null };
    let simplex = [], fs = [];
    function* build(xb, fb) {
      simplex = [xb.slice()]; fs = [fb];
      for (let j = 0; j < n; j++) { const x = xb.slice(); x[j] += step; simplex.push(x); fs.push(yield* f(x)); }
    }
    // With started feedforward gains, x0 is a new point: run it first.
    const f0 = !i && space.started.length ? yield* f(x0) : at0;
    yield* build(x0, f0);
    yield report(false);
    let mark = best.cost.J, since = iteration;
    while (iteration < until) {
      iteration++;
      const order = fs.map((_, j) => j).sort((a, b) => fs[a] - fs[b]);
      simplex = order.map((j) => simplex[j]); fs = order.map((j) => fs[j]);
      let spread = 0;
      for (let j = 1; j <= n; j++) for (let k = 0; k < n; k++) spread = Math.max(spread, Math.abs(simplex[j][k] - simplex[0][k]));
      if (spread < 1e-2 || fs[n] - fs[0] <= 1e-4 * Math.abs(fs[0])) {
        if (!restarts--) break;
        step /= 4;
        yield* build(best.x ?? x0, best.x ? best.cost.J : f0);
      } else {
        const c = new Array(n).fill(0);
        for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) c[k] += simplex[j][k] / n;
        const along = (a) => c.map((ck, k) => ck + a * (simplex[n][k] - ck));
        const xr = along(-1), fr = yield* f(xr);
        if (fr < fs[0]) {
          const xe = along(-2), fe = yield* f(xe);
          if (fe < fr) { simplex[n] = xe; fs[n] = fe; } else { simplex[n] = xr; fs[n] = fr; }
        } else if (fr < fs[n - 1]) {
          simplex[n] = xr; fs[n] = fr;
        } else {
          const xc = fr < fs[n] ? along(-0.5) : along(0.5), fc = yield* f(xc);
          if (fc < Math.min(fr, fs[n])) { simplex[n] = xc; fs[n] = fc; } else {
            for (let j = 1; j <= n; j++) { simplex[j] = simplex[j].map((v, k) => simplex[0][k] + 0.5 * (v - simplex[0][k])); fs[j] = yield* f(simplex[j]); }
          }
        }
      }
      yield report(false);
      // Done when the best cost has not fallen by 0.1 % for `patience` iterations.
      if (best.cost.J < 0.999 * mark) { mark = best.cost.J; since = iteration; }
      if (iteration - since >= patience) break;
    }
  }
  return { ...report(false), done: true };
}

// Whether a run has a disturbance: another input than r that is not 0.
function disturbed(run, others) {
  return others.some((k) => { const v = run.signals[k]; if (!v) return false; const { lo, hi } = finiteRange(v); return lo < -1e-12 || hi > 1e-12; });
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
  yield { partial: true, phase: 'operating point', seconds: ctx.sim.duration };
  const own = loopSignals(ownRun, ctx.key);
  const rr = finiteRange(own.r);
  const name = ctx.source, notes = [];
  let signals = ctx.signals, level = null;
  if (name) {
    const sr = finiteRange(ownRun.signals[name] ?? []);
    level = Number.isFinite(sr.lo) ? (sr.lo + sr.hi) / 2 : 0;
    signals = holding(ctx, level);
  } else notes.push('input 1 is not fed by a Source (through gains, lags or subsystem ports), so r cannot be held: the experiment runs with the inputs as they are, and the estimate is rough');
  const sim = { ...ctx.sim };
  const holdRun = runVariant(ctx, ctx.variant, signals, sim);
  yield { partial: true, phase: 'operating point', seconds: sim.duration };
  const hold = loopSignals(holdRun, ctx.key);
  const k0 = Math.floor(0.75 * hold.u.length);
  const r0 = name ? mean(hold.r, k0) : (rr.lo + rr.hi) / 2;
  let u0 = mean(hold.u, k0);
  const { lo, hi } = limitsOf(ctx.variant);
  if (!Number.isFinite(u0)) u0 = Number.isFinite(lo + hi) ? (lo + hi) / 2 : 0;
  u0 = Math.min(hi, Math.max(lo, u0));
  return { r0, name, level, signals, sim, u0, span: rr.hi - rr.lo, rRange: rr, own, ownRun, holdRun, notes };
}

// The inputs with r's Source held at a level and every other input at 0.
function holding(ctx, level) {
  const signals = {};
  for (const [k, s] of Object.entries(ctx.signals)) signals[k] = { ...s, components: k === ctx.source ? [{ type: 'dc', params: { level } }] : [] };
  return signals;
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
  yield { partial: true, phase: 'open loop', seconds: sim.duration };
  const runB = runVariant(ctx, constantU(op.u0 + du, lo, hi), op.signals, sim);
  yield { partial: true, phase: 'open loop', seconds: sim.duration };
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
    yield { partial: true, phase: 'relay', run, seconds: sim.duration };
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

// ---- Reading a response: ripple, settling, ramps -----------------------

// Running means over m samples. trailing: s[k] is the mean of y[k−m+1 … k]
// (of what there is at the start); centred: the mean of the m samples around
// k, without lag, the record held at its first value before the start and at
// its last after the end.
function trailing(y, m) {
  const n = y.length, s = new Float64Array(n);
  let acc = 0;
  for (let k = 0; k < n; k++) { acc += y[k]; if (k >= m) acc -= y[k - m]; s[k] = acc / Math.min(k + 1, m); }
  return s;
}
function centred(y, m) {
  const n = y.length, s = new Float64Array(n), h = Math.floor(m / 2);
  const at = (k) => y[Math.min(n - 1, Math.max(0, k))];
  let acc = 0;
  for (let j = -h; j < m - h; j++) acc += at(j);
  for (let k = 0; k < n; k++) { s[k] = acc / m; acc += at(k + m - h) - at(k - h); }
  return s;
}
// y averaged over m samples twice (a triangle 2m long), so a steady ripple of
// period m and its harmonics drop out; m ≤ 1 leaves y as it is.
const smooth = (y, m, how = trailing) => (m > 1 ? how(how(y, m), m) : Float64Array.from(y));

// The first sample of the last `last` (a fraction) of a record's time.
function lastStretch(t, last) {
  const n = t.length, t1 = t[n - 1] - last * (t[n - 1] - t[0]);
  let k = n - 1;
  while (k > 0 && t[k - 1] >= t1) k--;
  return k;
}

// The least-squares line y = a + b x through the samples from..to−1.
function lineFit(x, y, from = 0, to = y.length) {
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  const N = to - from;
  for (let k = from; k < to; k++) { sx += x[k]; sy += y[k]; sxx += x[k] * x[k]; sxy += x[k] * y[k]; }
  const b = (N * sxy - sx * sy) / (N * sxx - sx * sx || 1);
  return { a: (sy - b * sx) / N, b };
}

// The ripple on a response, as the period (in samples) of its slowest strong
// periodic part: in the last 40 % of y, its straight-line trend removed, the
// lowest-frequency peak of the (Hann-windowed) spectrum that is at least a
// quarter as large as the largest, with six periods or more in that stretch.
// 0 when the largest is under 0.2 % of size (the size of the response).
export function ripplePeriod(y, dt, size) {
  const n = y.length, k0 = Math.floor(0.6 * n);
  if (n - k0 < 32 || !(size > 0)) return 0;
  const { f, amp } = amplitudeSpectrum(y.slice(k0), dt, { detrend: 'linear' });
  const fmin = 6 / ((n - k0) * dt);
  let top = 0;
  for (let k = 1; k < amp.length; k++) if (f[k] >= fmin) top = Math.max(top, amp[k]);
  if (!(top >= 0.002 * size)) return 0;
  for (let k = 1; k < amp.length - 1; k++) {
    if (f[k] >= fmin && amp[k] >= top / 4 && amp[k] >= amp[k - 1] && amp[k] >= amp[k + 1]) return Math.max(2, Math.round(1 / (f[k] * dt)));
  }
  return 0;
}

// Half the peak-to-peak of y about its average over the ripple period m
// (about its straight-line trend when m ≤ 1), from sample `from` on.
function rippleOf(y, m, from) {
  const n = y.length;
  let lo = Infinity, hi = -Infinity;
  if (m > 1) {
    const s = smooth(y, m, centred);
    for (let k = from; k < n - m; k++) { lo = Math.min(lo, y[k] - s[k]); hi = Math.max(hi, y[k] - s[k]); }
  } else {
    const x = Array.from({ length: n }, (_, k) => k), { a, b } = lineFit(x, y, from, n);
    for (let k = from; k < n; k++) { const e = y[k] - a - b * k; lo = Math.min(lo, e); hi = Math.max(hi, e); }
  }
  return hi > lo ? (hi - lo) / 2 : 0;
}

// Whether a response has settled: averaged over its ripple period, it stays
// within band of its final value for the last `last` of the record, band a
// fraction of the size of the response (its final value less its first). A
// steady ripple and noise count as settled; `ripple` is their amplitude (half
// the peak-to-peak about the average) over that stretch.
export function settledLevel(t, y, { band = 0.02, last = 0.2 } = {}) {
  const n = y.length;
  if (n < 16) return { settled: false, final: y[n - 1], size: 0, ripple: 0, m: 0 };
  const dt = (t[n - 1] - t[0]) / (n - 1), k1 = lastStretch(t, last);
  const m = ripplePeriod(y, dt, Math.abs(mean(y, k1) - y[0]));
  const s = smooth(y, m);
  const final = s[n - 1], size = Math.abs(final - y[0]);
  const from = Math.min(n - 1, Math.max(k1, 2 * m));
  let dev = 0;
  for (let k = from; k < n; k++) dev = Math.max(dev, Math.abs(s[k] - final));
  return { settled: size > 0 && dev <= band * size, final, size, m, ripple: rippleOf(y, m, from) };
}

// Whether a response ramps, as an integrating plant's does: its slope (the
// secant over the ripple period, and over at least 2 % of the record, of y
// averaged over that period) stays within band of its final value for the
// last `last` of the record, and that slope accounts for at least half of
// where y went. tSteady: from when on the slope stayed within the band.
export function settledSlope(t, y, { band = 0.02, last = 0.2 } = {}) {
  const n = y.length;
  const no = { ramps: false, slope: 0, tSteady: t[n - 1], m: 0, ripple: 0 };
  if (n < 16) return no;
  const dt = (t[n - 1] - t[0]) / (n - 1), k1 = lastStretch(t, last);
  const m = ripplePeriod(y, dt, Math.abs(y[n - 1] - y[0]));
  const s = smooth(y, m), q = Math.max(m, Math.round(0.02 * n), 1);
  const from = Math.max(k1, 2 * m + q);
  if (from >= n - 1) return no;
  const g = (k) => (s[k] - s[k - q]) / (t[k] - t[k - q]);
  const gF = g(n - 1);
  let dev = 0;
  for (let k = from; k < n; k++) dev = Math.max(dev, Math.abs(g(k) - gF));
  const ramps = Number.isFinite(gF) && gF !== 0 && dev <= band * Math.abs(gF) && Math.abs(gF) * (t[n - 1] - t[0]) >= 0.5 * Math.abs(s[n - 1] - y[0]);
  let ks = n - 1;
  while (ks > 2 * m + q && Math.abs(g(ks - 1) - gF) <= band * Math.abs(gF)) ks--;
  return { ramps, slope: gF, tSteady: t[ks], m, ripple: rippleOf(y, m, from) };
}

// When a closed-loop run settled: from when on y, averaged over its ripple
// period, stayed within 2 % of where it ended (of how far it moved, or of
// scale when it hardly moved), and its swing about that average stayed
// within that band of the swing it keeps at the end (a steady ripple,
// noise): the average alone also passes a loop still ringing down.
// settled: within the first 80 % of the run.
function settleTime(t, y, scale) {
  const n = y.length, dt = (t[n - 1] - t[0]) / (n - 1);
  const moved = Math.abs(mean(y, lastStretch(t, 0.2)) - y[0]);
  const m = ripplePeriod(y, dt, Math.max(moved, scale));
  const s = smooth(y, m), final = s[n - 1];
  const tol = 0.02 * Math.max(Math.abs(final - y[0]), scale);
  let k = n - 1;
  while (k > 0 && Math.abs(s[k - 1] - final) <= tol) k--;
  if (m > 1 && n > 4 * m) {
    const c = smooth(y, m, centred), kEnd = n - m, swing = (j) => Math.abs(y[j] - c[j]);
    let end = 0;
    for (let j = Math.min(lastStretch(t, 0.2), kEnd - 1); j < kEnd; j++) end = Math.max(end, swing(j));
    let j = kEnd - 1;
    while (j > 0 && swing(j - 1) <= end + tol) j--;
    k = Math.max(k, j);
  }
  return { settled: Number.isFinite(final) && t[k] <= t[0] + 0.8 * (t[n - 1] - t[0]), time: t[k] };
}

// A first order plus dead time, K e^(−θs) / (τs + 1), fitted to a settled
// response (t from the step; y averaged over the ripple period m, without
// lag, when there is ripple) by Smith's two-point method (28.3 % and 63.2 %):
//   K = Δy∞ / Δu,  τ = 1.5 (t63 − t28),  θ = t63 − τ
export function fitFopdt(t, y, du, final, m = 0) {
  const s = smooth(y, m, centred), n = s.length;
  const cross = (level) => {
    for (let k = 1; k < n; k++) if ((s[k] - level * final) * Math.sign(final) >= 0) {
      const f = (level * final - s[k - 1]) / (s[k] - s[k - 1] || 1);
      return t[k - 1] + f * (t[k] - t[k - 1]);
    }
    return t[n - 1];
  };
  const t28 = cross(0.283), t63 = cross(0.632), t2 = cross(0.02);
  let tau = Math.max(1.5 * (t63 - t28), 1e-6), theta = Math.max(0, t63 - tau);
  // A response that is no first order (a nonlinear plant stepped far, say)
  // can give a dead time shorter than the time y visibly does not move: then
  // θ is that time (until y has moved 2 %), and τ the rest of the way to 63 %.
  if (theta < 0.5 * t2) { theta = t2; tau = Math.max(t63 - t2, 1e-6); }
  return { K: final / du, tau, theta, t28, t63 };
}

// An integrator with a lag and a dead time, k' e^(−θs) / (s (τ2 s + 1)),
// fitted to a ramp (t from the step of size du): the straight line through
// its last stretch (from sample `from` on) gives the slope k'·du and, where
// it crosses the start level, the apparent dead time L = θ + τ2 (its
// asymptote's intercept); τ2 is the lag in [0, L] that fits the whole
// response best (least squares), and θ = L − τ2.
export function fitIntegrating(t, y, du, from) {
  const n = y.length, { a, b } = lineFit(t, y, from, n);
  const L = Math.max(0, -a / b);
  const sse = (tau2) => {
    const th = L - tau2;
    let e = 0;
    for (let k = 0; k < n; k++) {
      const x = t[k] - th;
      const model = x <= 0 ? 0 : tau2 > 1e-12 ? b * (x - tau2 * (1 - Math.exp(-x / tau2))) : b * x;
      e += (y[k] - model) ** 2;
    }
    return e;
  };
  // A scan of τ2 over [0, L], then golden-section search around the best.
  let best = 0, bestE = Infinity;
  for (let i = 0; i <= 40; i++) { const e = sse((i / 40) * L); if (e < bestE) { bestE = e; best = i; } }
  let lo = (Math.max(0, best - 1) / 40) * L, hi = (Math.min(40, best + 1) / 40) * L;
  const gr = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 40; i++) { const c = hi - gr * (hi - lo), d = lo + gr * (hi - lo); if (sse(c) < sse(d)) hi = d; else lo = c; }
  const tau2 = (lo + hi) / 2;
  return { kp: b / du, slope: b, L, tau2, theta: L - tau2 };
}

// ---- Strategy 3: step response and SIMC --------------------------------

// The step test's controller: the running variant holds r until tSwitch, then
// u is held at a constant (inside the limits). The law counts its samples.
function holdThen(variant, tSwitch, u, lo, hi) {
  const v = Math.min(hi, Math.max(lo, u));
  return {
    name: 'Step test', type: variant.type, params: variant.params,
    law: (Ts) => {
      const inner = makeLaw(variant, Ts), kSwitch = Math.round(tSwitch / Ts);
      let k = 0;
      return { step: (x) => (k++ < kSwitch ? inner.step(x) : v) };
    },
  };
}

// The first k samples of a run.
const cutRun = (run, k) => ({ ...run, t: run.t.subarray(0, k), signals: Object.fromEntries(Object.entries(run.signals).map(([name, v]) => [name, v.subarray(0, k)])) });

// One step test at an operating point. point: { signals that hold r there,
// hold (the running variant's run holding it), u0 (the u it needs there),
// r0, scale (r's span) }. The running variant holds r until y has settled,
// then u is held at u0 (run A) or at u0 + du (run B): dy = yB − yA from the
// switch on is the plant's step response from that state (exact for a linear
// plant). If dy settles within one period of the input (four, the second
// time), a first order plus dead time is fitted; if instead its slope
// settles, an integrator with lag and dead time, and the test ends there.
// bound: how far y may move; { exceeded } asks the caller for a smaller step.
function* stepAt(ctx, point, du, bound = Infinity) {
  const { lo, hi } = limitsOf(ctx.variant);
  const hold = loopSignals(point.hold, ctx.key);
  const st = settleTime(hold.t, hold.y, point.scale);
  const notes = [];
  // A variant that keeps swinging at r0 cannot hand over a plant at rest: the
  // test then starts at t = 0, from the plant's own start.
  // It runs one sample first, so a dead time whose output before T_d is its
  // input at t = 0 (a pipe already flowing, design.js) holds what the loop put
  // out there in both runs, and the step reaches the plant after T_d.
  if (!st.settled) notes.push(`${ctx.variant.name} does not settle at r0 = ${fmtN(point.r0)}, so the test starts one sample after t = 0, from the plant's start: exact for a linear plant, rough otherwise`);
  const tHold = st.settled ? Math.ceil(st.time / ctx.Ts - 1e-6) * ctx.Ts : ctx.Ts;
  const out = { du, u0: point.u0, r0: point.r0, tHold, notes };
  let W = ctx.sim.duration, runB = null;
  for (let tries = 0; tries < 2; tries++, W *= 4) {
    const sim = { duration: tHold + W, sampleTime: ctx.sim.sampleTime };
    const runA = runVariant(ctx, holdThen(ctx.variant, tHold, point.u0, lo, hi), point.signals, sim);
    yield { partial: true, phase: 'step test', seconds: sim.duration };
    runB = runVariant(ctx, holdThen(ctx.variant, tHold, point.u0 + du, lo, hi), point.signals, sim);
    yield { partial: true, phase: 'step test', seconds: sim.duration };
    const yA = loopSignals(runA, ctx.key).y, { t: tB, y: yB } = loopSignals(runB, ctx.key);
    let k0 = 0;
    while (k0 < tB.length - 1 && tB[k0] < tHold - 1e-9) k0++;
    const n = tB.length - k0, t = new Float64Array(n), dy = new Float64Array(n);
    let kBad = n, kOut = n;
    for (let k = 0; k < n; k++) {
      t[k] = tB[k0 + k] - tHold;
      dy[k] = yB[k0 + k] - yA[k0 + k];
      if (!Number.isFinite(dy[k]) && kBad === n) kBad = k;
      if (Math.abs(dy[k]) > bound && kOut === n) kOut = k;
    }
    if (kBad <= kOut && kBad < n) return { ...out, ok: false, run: runB, why: 'the open-loop run diverged: the plant is unstable without its controller; use the relay or iterative method' };
    let moved = 0;
    for (let k = 0; k < n; k++) if (Number.isFinite(dy[k])) moved = Math.max(moved, Math.abs(dy[k]));
    if (!(moved > 1e-9 * point.scale)) return { ...out, ok: false, still: true, run: runB, why: `y does not respond to a step of u (Δu = ${fmtN(du)}) at r0 = ${fmtN(point.r0)}: is the controller's output wired to the plant, or does the plant sit at a limit of its own there?` };
    const level = settledLevel(t, dy);
    if (level.settled) {
      if (Math.abs(level.final) > bound) return { ...out, ok: false, exceeded: true, final: level.final, run: runB };
      const fit = fitFopdt(t, dy, du, level.final, level.m);
      return { ...out, ok: true, model: 'fopdt', ...fit, ripple: level.ripple, rippleT: level.m > 1 ? level.m * ctx.sim.sampleTime : 0, size: level.size, run: runB, tEnd: t[n - 1] };
    }
    // A ramp, up to where y leaves the bound: the test ends once its slope
    // is steady, with the last fifth of it on the steady slope.
    const kEnd = Math.min(n, kOut);
    const ramp = settledSlope(t.subarray(0, kEnd), dy.subarray(0, kEnd));
    if (ramp.ramps) {
      let kStop = 16;
      while (kStop < kEnd && t[kStop - 1] < ramp.tSteady / 0.8) kStop++;
      let r = settledSlope(t.subarray(0, kStop), dy.subarray(0, kStop));
      while (!r.ramps && kStop < kEnd) { kStop = Math.min(kEnd, Math.ceil(1.05 * kStop) + 1); r = settledSlope(t.subarray(0, kStop), dy.subarray(0, kStop)); }
      // A steady slope is not yet a straight line: the lag's transient fades
      // as e^(−t/τ2), and a line through the last fifth that still carries it
      // reads k' low and θ long (on the motor, cut at 0.26 s: k' −1 %, θ
      // +22 %). So the test runs on until the last fifth starts L + 5 τ2
      // after the step (the transient under 1 %), and is fitted again. When y
      // would leave its bound before then, the step is made smaller.
      let fit = null, faded = false;
      for (let pass = 0; pass < 4; pass++) {
        const tt = t.subarray(0, kStop);
        fit = fitIntegrating(tt, dy.subarray(0, kStop), du, lastStretch(tt, 0.2));
        const tNeed = (fit.L + 5 * fit.tau2) / 0.8;
        faded = t[kStop - 1] >= 0.98 * tNeed;
        if (faded || kStop >= n) break;
        let k = kStop;
        while (k < n && t[k - 1] < tNeed) k++;
        if (k > kEnd) return { ...out, ok: false, exceeded: true, reach: Math.abs(fit.slope) * Math.max(tNeed - fit.L, 0), run: runB };
        kStop = k;
      }
      r = settledSlope(t.subarray(0, kStop), dy.subarray(0, kStop));
      const tt = t.subarray(0, kStop), yy = dy.subarray(0, kStop);
      return { ...out, ok: true, model: 'integrating', ...fit, faded, ripple: r.ripple, rippleT: r.m > 1 ? r.m * ctx.sim.sampleTime : 0, moved: yy[kStop - 1], run: cutRun(runB, k0 + kStop), tEnd: tt[kStop - 1] };
    }
    if (kOut < n) return { ...out, ok: false, exceeded: true, reach: moved, run: runB };
  }
  return { ...out, ok: false, run: runB, why: 'the step response settled neither to a level nor to a steady slope in four periods of the input: a very slow plant (lengthen the input\'s period)' };
}

// A step test whose response must stay within bound: the step is made smaller
// (five times at most, to 80 % of what fits, at least halved) until it does.
// dir: the sign of the step in u to try first (0: upwards if there is room);
// a step toward dir uses what room there is, and goes the other way only
// when there is less than a tenth of the step asked for. responds: y is
// known to respond to u elsewhere (another point of a schedule), so a plant
// that does not respond here sits at a limit of its own.
function* boundedStep(ctx, point, want, dir, bound, boundWhy, responds = false) {
  const { lo, hi } = limitsOf(ctx.variant);
  const room = (s) => (s > 0 ? hi - point.u0 : point.u0 - lo);
  const enough = (s) => room(s) >= (dir ? 0.1 : 1) * want;
  const first = dir || 1;
  const s = enough(first) ? first : room(-first) >= want ? -first : room(first) >= room(-first) ? first : -first;
  let du = s * Math.min(want, room(s));
  if (!(Math.abs(du) >= 0.1 * want)) return { du, u0: point.u0, r0: point.r0, notes: [], ok: false, why: `the actuator is at a limit at r0 = ${fmtN(point.r0)} (u0 = ${fmtN(point.u0)}): no room for a step` };
  const notes = [], unit = measurement(ctx).unit, u = unit ? ` ${unit}` : '';
  if (dir && s !== dir) notes.push(`the step went the other way (Δu = ${fmtN(du)}): no room for it in u`);
  else if (Math.abs(du) < want) notes.push(`the step was made smaller, Δu = ${fmtN(du)}, to stay inside the actuator limits`);
  let moved = null;
  for (let tries = 0; ; tries++) {
    const r = yield* stepAt(ctx, point, du, bound);
    if (r.still && (moved || responds)) {
      r.why = `y does not respond to a step of u (Δu = ${fmtN(du)}) at r0 = ${fmtN(point.r0)}${u}, ${moved ? `though a step of Δu = ${fmtN(moved)} moved it by more than ${fmtN(bound)}${u}` : 'though it does at other points'}: the plant sits at a limit of its own there`;
    }
    if (!r.exceeded) { r.notes.unshift(...notes); return { ...r, bound, boundWhy }; }
    if (tries === 5) return { ...r, ok: false, notes, why: `even a step of Δu = ${fmtN(du)} moves y by more than ${fmtN(bound)}${u} (${boundWhy}) before it settles` };
    moved = du;
    const far = Math.abs(r.final ?? r.reach ?? NaN);
    du *= far > 0 && Number.isFinite(far) ? Math.min(0.5, (0.8 * bound) / far) : 0.5;
    notes.splice(0, notes.length, `the step was made smaller, Δu = ${fmtN(du)}, so y moves by at most ${fmtN(bound)}${u} (${boundWhy})`);
  }
}

// The running variant holding r at a target: r's Source at the level that
// gives it (the target itself; when r is not the Source's own value, once
// more on the line through the operating point), every other input at 0.
// When y has not settled within one period of the input, the hold runs four
// times as long. reached: y within 2 % of r's span of the target.
function* holdAt(ctx, op, target, scale) {
  let level = target, signals, run, r, y, u, sim = ctx.sim;
  for (let i = 0; i < 3; i++) {
    signals = holding(ctx, level);
    run = runVariant(ctx, ctx.variant, signals, sim);
    yield { partial: true, phase: 'hold', seconds: sim.duration };
    const s = loopSignals(run, ctx.key), k0 = Math.floor(0.75 * s.t.length);
    r = mean(s.r, k0); y = mean(s.y, k0); u = mean(s.u, k0);
    if (Math.abs(r - target) > 1e-3 * scale && Math.abs(op.r0 - r) > 1e-12 && level !== op.level && i === 0) {
      level += ((target - r) * (op.level - level)) / (op.r0 - r);
      continue;
    }
    if (sim !== ctx.sim || settleTime(s.t, s.y, scale).settled) break;
    sim = longer(ctx.sim, 4);
  }
  const { lo, hi } = limitsOf(ctx.variant);
  return { signals, hold: run, r0: r, y, u0: Math.min(hi, Math.max(lo, u)), scale, reached: Math.abs(y - target) <= 0.02 * scale };
}

// For a gain-scheduled PI: a step test at each of its points (the y values
// of its table), r held there first by the running variant. Each step goes
// toward the middle of the table and may move y half the way to the next
// point, so each model is local; the first test (nearest the middle, u
// stepped up) tells which way y goes when u rises.
function* scheduleExperiment(ctx, op, want, base, scale) {
  const at = ctx.variant.params.at;
  const mid = (at[0] + at[at.length - 1]) / 2;
  const order = at.map((_, i) => i).sort((a, b) => Math.abs(at[a] - mid) - Math.abs(at[b] - mid) || a - b);
  const points = new Array(at.length);
  let sign = 0;
  for (const i of order) {
    const target = at[i];
    const point = yield* holdAt(ctx, op, target, scale);
    if (!point.reached) { points[i] = { at: target, ok: false, notes: [], why: `${ctx.variant.name} holds y at ${fmtN(point.y)}, not at ${fmtN(target)}` }; continue; }
    const toward = target <= mid ? 1 : -1, next = at[i + toward] ?? at[i - toward];
    const bound = next === undefined ? (op.span > 1e-9 ? op.span / 2 : Infinity) : Math.abs(next - target) / 2;
    const r = yield* boundedStep(ctx, point, want, sign ? toward * sign : 0, bound, 'half the way to the next point', sign !== 0);
    if (r.ok && !sign) sign = Math.sign(r.model === 'integrating' ? r.kp : r.K) || 1;
    points[i] = { at: target, ...r, notes: [...r.notes, ...stepNotes(r, measurement(ctx).unit)] };
  }
  const ok = points.filter((p) => p.ok);
  const show = points[order.find((i) => points[i].ok) ?? order[0]];
  if (!ok.length) return { ...base, ...show, ok: false, model: 'schedule', points, shownAt: show.at, why: `no step test worked; at ${fmtN(show.at)}: ${show.why}` };
  // u0, the integral part at the start, balances the plant at its start level.
  const y0 = loopSignals(op.ownRun, ctx.key).y[0];
  let trim = ok.find((p) => Math.abs(p.at - y0) <= 1e-6 * scale)?.u0;
  const notes = [...base.notes];
  if (trim === undefined) {
    const h = yield* holdAt(ctx, op, y0, scale);
    trim = h.u0;
    if (!h.reached) notes.push(`${ctx.variant.name} does not hold y at its start level ${fmtN(y0)}: u0 is rough`);
  }
  return { ...base, ok: true, model: 'schedule', points, trim, y0, notes, run: show.run, u0: show.u0, r0: show.r0, du: show.du, tHold: show.tHold, shownAt: show.at };
}

// The open-loop step test (process reaction curve) around the operating point
// r0, as stepAt does it; y may move by half of r's span (r0 is its middle).
// A gain-scheduled PI is tested at each point of its table instead.
// opts: amplitude (fraction of the actuator range, default 0.1) or du.
export function* stepExperimentSteps(project, path, opts = {}) {
  const ctx = tuneContext(project, path);
  if (siso(ctx)) return { ctx, ok: false, notes: [], why: siso(ctx) };
  const op = yield* operatingPoint(ctx);
  const range = actuatorRange(ctx, op.own);
  const base = { ctx, r0: op.r0, u0: op.u0, notes: [...op.notes] };
  if (opts.du === undefined && !range) return { ...base, ok: false, why: NO_RANGE };
  const want = Math.abs(opts.du ?? (opts.amplitude ?? 0.1) * range);
  const scale = op.span > 1e-9 ? op.span : Math.abs(op.r0) || 1;
  if (ctx.variant.type === 'gainScheduled' && op.name) return yield* scheduleExperiment(ctx, op, want, base, scale);
  const point = { signals: op.signals, hold: op.holdRun, u0: op.u0, r0: op.r0, scale };
  const r = yield* boundedStep(ctx, point, want, 0, op.span > 1e-9 ? op.span / 2 : Infinity, 'half of r\'s span');
  return { ...base, ...r, notes: [...base.notes, ...r.notes, ...stepNotes(r, measurement(ctx).unit)] };
}

export const stepExperiment = (project, path, opts) => drain(stepExperimentSteps(project, path, opts));

// What a step test found worth saying: the ramp and where it was cut, ripple.
function stepNotes(r, unit = '') {
  if (!r.ok) return [];
  const notes = [], u = unit ? ` ${unit}` : '';
  if (r.model === 'integrating') notes.push(`y ramps (an integrating plant): the test ended ${fmtN(r.tEnd)} s after the step, once its slope was steady${r.faded ? ' and its lag\'s transient had faded below 1 %' : ', before its lag had faded (the record is too short, so the estimate is rough)'}, with y moved by ${fmtN(Math.abs(r.moved))}${u}${Number.isFinite(r.bound) ? ` (it may move ${fmtN(r.bound)}${u}, ${r.boundWhy})` : ''}`);
  const size = r.model === 'integrating' ? Math.abs(r.moved) : r.size;
  if (r.ripple > 0.005 * size) notes.push(`y ripples by ±${fmtN(r.ripple)}${u} (${fmtN((100 * r.ripple) / size)} % of the step response)${r.rippleT ? `, slowest strong period ${fmtN(r.rippleT)} s; the test reads y averaged over it` : ''}`);
  return notes;
}

// How SIMC chooses the closed-loop time τc. Skogestad (2003): τc = θ for
// tight control; larger for smoother control (Skogestad's lectures: τc > θ,
// for smoother input usage, less sensitivity to noise and more robustness).
// The factor 3 for "smooth" is ours.
export const SIMC = {
  tight: { label: 'Tight', short: '', f: 1, about: 'τc = θ (Skogestad 2003): fast; his margins on the model: Ms 1.6–1.7, gain margin about 3' },
  smooth: { label: 'Smooth', short: ' smooth', f: 3, about: 'τc = 3θ: slower and gentler on u, more robust' },
};
const simcFactor = (rule) => {
  if (!SIMC[rule]) throw new Error(`SIMC τc: one of ${Object.keys(SIMC).join(', ')}`);
  return SIMC[rule].f;
};

// What set τc, in words, for the notes and the tab: g.by is 'theta' (SIMC's
// rule), 'lag' (a tenth of the lag, when the dead time is shorter) or
// 'ripple' (the ripple's period on y); both floors are ours.
export function tauCSource(g, rule = 'tight') {
  const f = SIMC[rule]?.f ?? 1, x = f === 1 ? '' : `${f} × `;
  if (g.by === 'ripple') return `${x}the ripple's period on y (our floor), not the dead time θ = ${fmtN(g.theta)} s`;
  if (g.by === 'lag') return `${x}a tenth of the lag τ (our floor), not the dead time θ = ${fmtN(g.theta)} s, which is shorter`;
  if (g.by === 'given') return 'given';
  const dead = `the dead time${g.Tf ? ' with the derivative\'s filter' : ''}`;
  return f === 1 ? `θ, ${dead} (Skogestad's tight rule)` : `${f}θ (θ = ${fmtN(g.theta)} s, ${dead})`;
}

// The same in a few characters, for a row in the tab: θ, 3θ, τ/10, …
export function tauCShort(g, rule = 'tight') {
  const f = SIMC[rule]?.f ?? 1, x = f === 1 ? '' : `${f} × `;
  return g.by === 'ripple' ? `${x}ripple period` : g.by === 'lag' ? `${x}τ/10` : g.by === 'given' ? 'given' : `${f === 1 ? '' : f}θ`;
}

// SIMC for a first order plus dead time (Skogestad 2003, Table 1):
//   Kp = τ / (K (τc + θ)),  Ti = min(τ, 4 (τc + θ))
// θ includes half a controller sample, the delay of the hold on u.
// τc = θ (tight) or 3θ (smooth), where the θ that sets τc is at least τ / 10
// (almost no dead time) and at least minTauC (the period of a ripple on y,
// so the loop does not chase the ripple); both floors are ours. tauC
// overrides it. by: what set τc (tauCSource).
export function simcGains(K, tau, theta, Ts = 0, tauC = null, rule = 'tight', minTauC = 0) {
  const th = theta + Ts / 2, base = Math.max(th, tau / 10, minTauC);
  const by = tauC !== null ? 'given' : base === th ? 'theta' : minTauC >= tau / 10 ? 'ripple' : 'lag';
  const tc = tauC ?? simcFactor(rule) * base;
  const Kp = tau / (K * (tc + th)), Ti = Math.min(tau, 4 * (tc + th));
  return { Kp, Ki: Kp / Ti, Kd: 0, Ti, Td: 0, tauC: tc, theta: th, thetaPlant: th, Ts, by, byRipple: by === 'ripple' };
}

// SIMC for an integrating process, k' e^(−θs) / s, with a lag, / (τ2 s + 1)
// (Skogestad 2003, Table 1), in the series form:
//   Kc = 1 / (k' (τc + θ)),  τI = 4 (τc + θ),  τD = τ2
// converted to this code's parallel PID (Skogestad 2003, eq. 36):
//   Kp = Kc (1 + τD / τI),  Ki = Kc / τI,  Kd = Kc τD
// The derivative cancels the lag, so it is used when the lag dominates the
// dead time (τ2 > θ, as Skogestad recommends PID); otherwise (or pid: false)
// a PI, with the lag counted as dead time by the half rule (θ + τ2 / 2). θ
// includes half a controller sample (the hold on u); τc = θ (tight) or 3θ
// (smooth), the θ that sets τc at least minTauC (a ripple's period, as above).
// dFilter(Td): the filter Tf the PID's derivative will get. Given, Tf joins
// the dead time: Skogestad's margins (Ms 1.70, GM 2.96, PM 47° for an
// integrator) are computed without a filter (he simulates with 0.01 τD),
// and a filter of a quarter of τD (Ts on the motor) adds a lag about as
// long as θ. Tf is a lag shorter than the one kept, counted whole as his
// half rule counts such lags. It depends on the gains, so this repeats
// until it holds. Without dFilter: his formulas as printed.
export function simcIntegrating(kp, theta, tau2 = 0, Ts = 0, { rule = 'tight', pid = null, minTauC = 0, dFilter = null } = {}) {
  const withD = pid ?? tau2 > theta + Ts / 2, f = simcFactor(rule);
  const own = withD && dFilter;
  const thPlant = (withD ? theta : theta + tau2 / 2) + Ts / 2;
  let Tf = own ? dFilter(tau2) : 0, g = null;
  for (let i = 0; i < 50; i++) {
    const th = thPlant + (own ? Tf : 0), base = Math.max(th, minTauC);
    const tc = f * base;
    const Kc = 1 / (kp * (tc + th)), tauI = 4 * (tc + th), tauD = withD ? tau2 : 0;
    const Kp = Kc * (1 + tauD / tauI), Ki = Kc / tauI, Kd = Kc * tauD;
    g = { Kp, Ki, Kd, Ti: Kp / Ki, Td: Kd / Kp, tauC: tc, theta: th, thetaPlant: thPlant, Ts, Tf: own ? Tf : undefined, Kc, tauI, tauD, by: base === th ? 'theta' : 'ripple', byRipple: base !== th };
    if (!own) break;
    const next = dFilter(g.Td);
    if (Math.abs(next - Tf) <= 1e-12 + 1e-9 * Tf) break;
    Tf = next;
  }
  return g;
}

// SIMC gains for what one step test found.
function simcFor(m, Ts, rule, pid = null) {
  return m.model === 'integrating'
    ? simcIntegrating(m.kp, m.theta, m.tau2, Ts, { rule, pid, minTauC: m.rippleT ?? 0, dFilter: (Td) => derivativeFilter(Td, Ts) })
    : simcGains(m.K, m.tau, m.theta, Ts, null, rule, m.rippleT ?? 0);
}

// opts.name: the new variant's name; opts.simc: 'tight' (default) or 'smooth'.
// A gain-scheduled PI gets a new table: SIMC PI gains at each point (a point
// whose test failed takes the nearest working point's gains), u0 the trim at
// the start level, its feedforward and anti-windup kept (no D and b = 1, so
// nothing moves them); the result is a PI(D) otherwise.
export function* stepTuneSteps(project, path, opts = {}) {
  const rule = opts.simc ?? 'tight';
  simcFactor(rule);
  const ex = yield* stepExperimentSteps(project, path, opts);
  if (!ex.ok) return ex;
  const from = ex.ctx.variant, Ts = ex.ctx.Ts;
  const name = (opts.name ?? `${baseName(from.name)} · SIMC${SIMC[rule].short}`).slice(0, 40);
  if (ex.model === 'schedule') {
    const ok = ex.points.filter((p) => p.ok);
    const notes = [...ex.notes];
    const points = ex.points.map((p) => {
      if (p.ok) {
        const gains = simcFor(p, Ts, rule, false);
        return { ...p, gains, notes: [...p.notes, ...simcNotes(p, gains, true)] };
      }
      const near = ok.reduce((a, b) => (Math.abs(b.at - p.at) < Math.abs(a.at - p.at) ? b : a));
      notes.push(`at ${fmtN(p.at)}: ${p.why}; its gains are those found at ${fmtN(near.at)}`);
      return { ...p, gains: simcFor(near, Ts, rule, false), from: near.at };
    });
    const p = from.params;
    const variant = normalizeVariant({ name, type: 'gainScheduled', params: { at: p.at, Kp: points.map((q) => q.gains.Kp), Ki: points.map((q) => q.gains.Ki), Tr: p.Tr, Kff: p.Kff, Kv: p.Kv, Ka: p.Ka, u0: ex.trim, umin: p.umin, umax: p.umax, aw: p.aw, Tt: p.Tt } });
    return { ...ex, points, notes, simc: rule, variant };
  }
  const g = simcFor(ex, Ts, rule);
  return { ...ex, notes: [...ex.notes, ...simcNotes(ex, g)], simc: rule, gains: g, variant: pidVariant(from, g, name, Ts) };
}

// What SIMC did that a reader should know. scheduled: the gains go into a
// gain-scheduled PI, which has no derivative.
function simcNotes(m, g, scheduled = false) {
  const notes = [];
  if (g.by === 'ripple') notes.push(`τc = ${fmtN(g.tauC)} s is set from the ripple's period (${fmtN(m.rippleT)} s), not from the dead time (${fmtN(g.theta)} s): a faster loop would chase the ripple`);
  if (g.by === 'lag') notes.push(`τc = ${fmtN(g.tauC)} s is set from a tenth of the lag τ = ${fmtN(m.tau)} s (our floor), not from the dead time θ = ${fmtN(g.theta)} s, which is shorter`);
  if (m.model === 'integrating' && m.tau2 > 0.02 * m.L) {
    if (g.Kd) notes.push(`the lag τ2 = ${fmtN(m.tau2)} s is longer than the dead time θ = ${fmtN(g.thetaPlant)} s (half a controller sample included), so the PI gets a derivative that cancels it (SIMC PID)`);
    else notes.push(`${scheduled ? 'a gain-scheduled PI has no derivative' : `the lag τ2 = ${fmtN(m.tau2)} s is no longer than the dead time`}, so half of τ2 counts as dead time (the half rule)`);
  }
  if (g.Tf) notes.push(`SIMC's margins are for an unfiltered derivative; this PID filters it at Tf = ${fmtN(g.Tf)} s (Td/10, at least a sample), a lag that counts as dead time: θ = ${fmtN(g.thetaPlant)} + ${fmtN(g.Tf)} = ${fmtN(g.theta)} s`);
  return notes;
}

export const stepTune = (project, path, opts) => drain(stepTuneSteps(project, path, opts));

// ---- One entry: the page, the command line, agents ----------------------

export const METHODS = ['iterate', 'relay', 'step'];

// Runs a method on the block at path (default: the first Controller block)
// and scores its result against the running variant with the goal. Yields
// what the strategy yields; returns
//   { ok, why, method, key, where, before: { variant, cost }, variant (the
//     result, named), after (its cost), better, worse (why it scores worse,
//     in plain words, when it does), notes, … the method's own:
//     iterate: iterations, evals, names; relay: Ku, Pu, a, u0, d, r0, rule,
//     gains, run; step: model ('fopdt': K, tau, theta; 'integrating': kp, L,
//     tau2, theta; 'schedule': points, trim), simc, gains, u0, du, r0, run }
// opts: method, goal, maxIter, feedforward (iterate: also the feedforward
// gains that are 0), rule (relay), simc (step: 'tight', 'smooth'),
// amplitude, name (of the result variant; default resultName).
export function* autotuneSteps(project, path, opts = {}) {
  const method = opts.method ?? 'iterate';
  if (!METHODS.includes(method)) throw new Error(`method: one of ${METHODS.join(', ')}`);
  const g = { ...GOAL, ...opts.goal };
  const ctx = tuneContext(project, path);
  const head = { method, key: ctx.key, path: ctx.path, where: ctx.where, goal: g };
  const why = whyNot(ctx, method);
  if (why) return { ...head, ok: false, why, notes: [] };
  const name = opts.name ?? resultName(ctx.block, method, opts.rule, opts.simc);
  if (method === 'iterate') {
    const r = yield* iterate(project, path, g, { maxIter: opts.maxIter, feedforward: opts.feedforward });
    const better = r.best.cost.J < r.start.cost;
    return {
      ...head, ok: true, notes: r.notes, before: { variant: ctx.variant, cost: r.start.detail },
      variant: { ...r.best.variant, name }, after: r.best.cost, better, iterations: r.iteration, evals: r.evals, names: r.names,
    };
  }
  const startRun = runVariant(ctx, ctx.variant);
  const scales = costScales(startRun, ctx.key, ctx.variant);
  const before = { variant: ctx.variant, cost: runCost(startRun, ctx.key, g, { scales, variant: ctx.variant, others: ctx.others }) };
  yield { partial: true, phase: 'start', before, seconds: ctx.sim.duration };
  const res = method === 'relay'
    ? yield* relayTuneSteps(project, path, opts.rule ?? 'tl', { amplitude: opts.amplitude, d: opts.d, name })
    : yield* stepTuneSteps(project, path, { amplitude: opts.amplitude, du: opts.du, simc: opts.simc, name });
  if (!res.ok) return { ...res, ...head, before };
  const after = variantCost(ctx, res.variant, g, scales);
  yield { partial: true, phase: 'score', seconds: ctx.sim.duration };
  // Two integrators in the loop: the integral of r − y after a step in r
  // must come back to 0, so y overshoots. A prefilter on r with Tr = τI
  // cancels the PI's zero; one more run says what it would do here.
  if (res.model === 'integrating' && res.variant.params.Ki && !res.variant.params.Tr && after.overshoot > g.overshoot) {
    const Tr = res.gains.tauI, pre = variantCost(ctx, { ...res.variant, params: { ...res.variant.params, Tr } }, g, scales);
    yield { partial: true, phase: 'score', seconds: ctx.sim.duration };
    res.notes = [...res.notes, `plant and controller both integrate, so y overshoots a step in r (${fmtN(after.overshoot)} %); with a prefilter on r of Tr = τI = ${fmtN(Tr)} s it would overshoot ${fmtN(pre.overshoot)} %, at the price of a slower response to r: cost ×${fmtN(pre.J / before.cost.J)} of ${ctx.variant.name}, against ×${fmtN(after.J / before.cost.J)} without the prefilter`];
  }
  const out = { ...res, ...head, before, after, better: after.J < before.cost.J };
  if (!out.better) out.worse = whyWorse(out, ctx);
  return out;
}

export const autotune = (project, path, opts) => drain(autotuneSteps(project, path, opts));

// The measured signal y, as the scope names it: the Sink on the wire into the
// block's input 2 (or the Source on it), with its unit; '' when none.
export function measurement(ctx) {
  const { level } = locate(ctx.diagram, ctx.path);
  const w = wireTo(level, ctx.block.id, 1);
  if (!w) return { name: '', unit: '' };
  const from = parseEnd(w.from);
  const byId = (id) => level.blocks.find((b) => b.id === id);
  const src = byId(from.id);
  if (src?.type === 'source') return { name: src.params.signal, unit: src.params.unit ?? '' };
  const sink = level.wires.map((x) => ({ x, to: byId(parseEnd(x.to).id) })).find(({ x, to }) => to?.type === 'sink' && parseEnd(x.from).id === from.id && parseEnd(x.from).port === from.port)?.to;
  return sink ? { name: sink.params.name, unit: sink.params.unit && sink.params.unit !== '1' ? sink.params.unit : '' } : { name: '', unit: '' };
}

// Why a result scores worse than the running variant, in plain words, as far
// as it can be known: what the result cannot do that the running variant
// does, then which part of the cost grew the most.
export function whyWorse(res, ctx) {
  const was = res.before.variant, now = res.variant, a = res.before.cost, b = res.after, goal = res.goal;
  const y = measurement(ctx), yName = y.name || 'y', at = (v) => `${yName} = ${fmtN(v)}${y.unit ? ` ${y.unit}` : ''}`;
  const kind = (v) => (v.type === 'gainScheduled' ? 'gain-scheduled PI' : v.params.Kd ? 'PID' : v.params.Ki ? 'PI' : 'P controller');
  const out = [];
  if (was.type === 'gainScheduled' && now.type !== 'gainScheduled') {
    const kp = was.params.Kp.map(Math.abs), lo = Math.min(...kp), hi = Math.max(...kp);
    const test = res.method === 'relay' ? 'a relay test' : 'a step test';
    if (hi > 1.5 * lo) out.push(`one ${kind(now)} from ${test} at ${at(res.r0)}; ${was.name} changes its gains with ${yName} (Kp ${fmtN(lo)} … ${fmtN(hi)}), which a single ${kind(now)} cannot`);
  } else if (was.type === 'pid' && was.params.Kd && now.type === 'pid' && !now.params.Kd) {
    out.push(`the result is a PI: SIMC from a first order plus dead time has no derivative action, and ${was.name} uses one`);
  }
  if (res.notes?.some((n) => /estimate is rough/.test(n))) out.push('the experiment\'s estimate is rough (see the notes)');
  const { lo, hi } = limitsOf(was), kp = Math.abs(now.params.Kp ?? 0);
  if (res.ripple && !Array.isArray(now.params.Kp) && Number.isFinite(hi - lo) && kp * res.ripple >= 0.05 * (hi - lo)) {
    out.push(`${yName} ripples by ±${fmtN(res.ripple)}${y.unit ? ` ${y.unit}` : ''}, and its Kp passes ±${fmtN(kp * res.ripple)} of that to u (${fmtN((100 * kp * res.ripple) / (hi - lo))} % of u's range)`);
  }
  if (b.diverged) out.push('the loop diverges with it');
  else {
    const [part] = Object.keys(b.parts).map((k) => [k, b.parts[k] - (a.parts?.[k] ?? 0)]).sort((p, q) => q[1] - p[1])[0];
    const x = (k) => (a.parts?.[k] > 0 ? `×${fmtN(b.parts[k] / a.parts[k])}` : `${fmtN(b.parts[k])}, was 0`);
    if (part === 'overshoot') out.push(`it overshoots ${fmtN(b.overshoot)} % (the goal allows ${fmtN(goal.overshoot)} %; ${was.name}: ${fmtN(a.overshoot)} %)`);
    else if (part === 'error') out.push(`r − y is larger (${goal.cost} ${x('error')})`);
    else if (part === 'effort') out.push(`u swings more (effort ${x('effort')})`);
    else out.push(`u sits at a limit ${fmtN(100 * b.saturated)} % of the time (${was.name}: ${fmtN(100 * a.saturated)} %)`);
  }
  return out.join('; ');
}

// A result of autotune() as plain JSON (no runs; open limits as null), for
// the command line and agents.
export function tuneReport(res) {
  const cost = (c) => c && { J: c.J, overshoot: c.overshoot, saturated: c.saturated, diverged: c.diverged, parts: c.parts };
  const out = { ok: res.ok, method: res.method, block: res.key, where: res.where, goal: res.goal };
  const model = (m) => (m.model === 'integrating' ? { model: m.model, kp: m.kp, L: m.L, tau2: m.tau2, theta: m.theta, tEnd: m.tEnd, faded: m.faded } : { model: m.model, K: m.K, tau: m.tau, theta: m.theta });
  if (!res.ok) Object.assign(out, { why: res.why, notes: res.notes ?? [] });
  else {
    Object.assign(out, { better: res.better, before: { variant: res.before.variant, cost: cost(res.before.cost) }, after: { variant: res.variant, cost: cost(res.after) }, notes: res.notes });
    if (!res.better) out.worse = res.worse;
    if (res.method === 'iterate') Object.assign(out, { iterations: res.iterations, evals: res.evals, tuned: res.names });
    if (res.method === 'relay') Object.assign(out, { Ku: res.Ku, Pu: res.Pu, amplitude: res.a, r0: res.r0, u0: res.u0, d: res.d, rule: res.rule, gains: res.gains });
    if (res.method === 'step') {
      Object.assign(out, { simc: res.simc, r0: res.r0, u0: res.u0, du: res.du, tHold: res.tHold });
      if (res.model === 'schedule') {
        Object.assign(out, { model: 'schedule', trim: res.trim, points: res.points.map((p) => ({ at: p.at, ok: p.ok, ...(p.ok ? { ...model(p), u0: p.u0, du: p.du, notes: p.notes } : { why: p.why }), ...(p.from !== undefined ? { gainsFrom: p.from } : {}), gains: p.gains })) });
      } else Object.assign(out, { ...model(res), gains: res.gains });
    }
  }
  return JSON.parse(JSON.stringify(out));
}

// ---- Variants -----------------------------------------------------------

// The name a variant had before any tuning suffix this module adds.
export function baseName(name) {
  return String(name).replace(/( · (auto-tuned|relay [^·]+?|SIMC( smooth)?)( \d+)?)+$/, '');
}

// The name for a method's result: "<base> · auto-tuned", "· relay T–L" (by
// the rule), "· SIMC" or "· SIMC smooth" (by simc). A running variant that
// already has the name (or a numbered one of it) keeps it: tuning again
// updates it. Another variant of that name is never overwritten: the new one
// is numbered.
export function resultName(block, method, rule = 'tl', simc = 'tight') {
  const running = block.variants[block.variant ?? 0];
  const base = baseName(running.name);
  const suffix = method === 'iterate' ? ' · auto-tuned' : method === 'relay' ? ` · relay ${RULES[rule ?? 'tl']?.short ?? rule}` : ` · SIMC${SIMC[simc ?? 'tight']?.short ?? ''}`;
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

// The filter on a tuned PID's derivative: Td / 10, but never shorter than a
// controller sample Ts (a shorter one would pass the measurement's noise and
// the sampling's steps almost unfiltered).
export const derivativeFilter = (Td, Ts) => Math.max(Ts, Td / 10);

// A PID with the given gains that drives the same actuator as the variant it
// replaces: limits, start output, setpoint weight, prefilter, reference
// feedforward and anti-windup carry over. The derivative is filtered at g.Tf
// when the rule chose it (SIMC counts it in the dead time), else at
// derivativeFilter(Td, Ts). A feedforward gain that is on moves with the new
// gains, so it keeps doing its job: when y follows r the D part (on y) takes
// away Kd·dr/dt and the P part puts out Kp(b − 1)·r, and a feedforward that
// removes the following error holds the plant's need plus those
// (controller-proposal.md), so Kv moves by the change of Kd and Kff by the
// change of Kp(1 − b).
export function pidVariant(from, g, name, Ts) {
  const p = from.params ?? {};
  const pid = from.type === 'pid';
  const b = pid ? p.b : 1, KpWas = pid ? p.Kp : 0, KdWas = pid ? p.Kd : 0;
  const Kv = isOn(p.Kv) ? p.Kv + g.Kd - KdWas : 0;
  const Kff = isOn(p.Kff) ? p.Kff + (g.Kp - KpWas) * (1 - b) : 0;
  return normalizeVariant({
    name: name.slice(0, 40), type: 'pid',
    params: {
      Kp: g.Kp, Ki: g.Ki, Kd: g.Kd, Tf: g.Kd ? (g.Tf ?? derivativeFilter(g.Td ?? 0, Ts)) : (pid ? p.Tf : 0.01), b, Tr: p.Tr ?? 0,
      Kff, Kv, Ka: p.Ka ?? 0, u0: p.u0 ?? 0, umin: p.umin ?? -Infinity, umax: p.umax ?? Infinity, aw: p.aw ?? 'clamp', Tt: p.Tt ?? 0,
    },
  });
}

function fmtN(v) {
  if (!Number.isFinite(v)) return String(v);
  return String(Number(v.toPrecision(3)));
}
