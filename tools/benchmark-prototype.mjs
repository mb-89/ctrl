#!/usr/bin/env node
// Prototype of the controller benchmark (design/output/benchmark.md): every
// controller type the registry knows, tuned on the current plant with one
// goal, scored on the criteria, ranked in a Pugh matrix against a datum.
// It is the design's measuring stick, not the build: the hooks a type will
// declare in controllers.js (`bench`) are stood in for by BENCH below, and
// the ±15 % plant variation by vary() (identification.md's varyDiagram).
//
//   node tools/benchmark-prototype.mjs [system name start …] [--iter 60] [--sweep 8] [--ms-max 3] [--no-backoff] [--json out.json]
//
// Prints, per system: the candidates and refusals, the scores, the Pugh
// matrix (round 1 against the tuned PID, round 2 against round 1's winner)
// and the time each phase took.

import { writeFileSync } from 'node:fs';
import { SYSTEM_LIBRARY, SYSTEM_PARTS, applySystem } from '../src/core/systems.js';
import { DEFAULT_PROJECT } from '../src/core/examples.js';
import { normalizeProject, loopModel } from '../src/core/project.js';
import { CONTROLLERS, CONTROLLER_TYPES, normalizeVariant } from '../src/core/controllers.js';
import { diagramBlockDef, parseEnd, compileDiagram } from '../src/core/diagram.js';
import { analyzeLoop } from '../src/core/analysis.js';
import { simulateSystem } from '../src/core/sim.js';
import { tuneContext, withVariant, runVariant, loopSignals, costScales, runCost, iterate, autotune, tuningSpace, drain, GOAL } from '../src/core/autotune.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const MS_MAX = Number(opt('--ms-max', 3)), BACKOFF = !args.includes('--no-backoff'), MAX_ITER = Number(opt('--iter', 60)), SWEEP = Number(opt('--sweep', 8)), JSON_OUT = opt('--json', null);
const names = args.filter((a, i) => !a.startsWith('--') && !(i && args[i - 1].startsWith('--')));
const SYSTEMS = names.length ? names : ['DC motor, sliding mode', 'Oven, badly tuned', 'Conical tank'];
const GOAL_USED = { ...GOAL };

// ---- Loading and small helpers -------------------------------------------

function load(name) {
  const entry = SYSTEM_LIBRARY.find((e) => e.name.toLowerCase().startsWith(name.toLowerCase()));
  if (!entry) throw new Error(`no system "${name}"`);
  return normalizeProject(applySystem(DEFAULT_PROJECT, entry, SYSTEM_PARTS.filter((k) => entry[k])));
}
const withDiagram = (project, diagram) => ({ ...project, system: { ...project.system, plant: { ...project.system.plant, diagram } } });
const placed = (project, ctx, variant) => withDiagram(project, withVariant(ctx.diagram, ctx.path, variant));
const finite = (v) => Number.isFinite(v);
const span = (a) => { let lo = Infinity, hi = -Infinity; for (const v of a) if (finite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } return hi - lo; };
const now = () => performance.now();
const fmt = (v, d = 3) => (v === null || v === undefined ? '—' : !finite(v) ? (v > 0 ? '∞' : String(v)) : Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(1) : String(Number(v.toPrecision(d))));

// The level of the diagram that holds the block, and the block's wires.
function level(diagram, path) { let d = diagram; for (const id of path.slice(0, -1)) d = d.blocks.find((b) => b.id === id).diagram; return d; }

// A copy whose Controller reads only r and y1: the relay and step tests are
// for one measurement, and a PID reads only y1 anyway.
function sisoProject(project, ctx) {
  const d = structuredClone(ctx.diagram), lv = level(d, ctx.path), b = lv.blocks.find((x) => x.id === ctx.path.at(-1));
  if (b.params.inputs <= 2) return project;
  b.params.inputs = 2;
  lv.wires = lv.wires.filter((w) => { const t = parseEnd(w.to); return !(t.id === b.id && t.port >= 2); });
  return withDiagram(project, d);
}

// ---- The ±15 % plant: identification.md's varyDiagram, as a stand-in ------
// Every physical number of the plant's blocks (transfer functions, lags,
// gains, dead times, physics blocks) scaled by a seeded factor in [1 − s, 1 + s].
const VARY = { tf: ['num', 'den'], firstOrder: ['K', 'tau'], gain: ['K'], delay: ['L'], integrator: ['K'] };
const KEEP = new Set(['x0', 'h0', 'y0', 'min', 'max', 'port', 'g', 'H', 'inputs', 'Ts', 'angle', 'seed', 'std', 'unit', 'theta0', 'signs']);
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function vary(diagram, share, seed) {
  const d = structuredClone(diagram), r = rng(seed), f = () => 1 + share * (2 * r() - 1);
  const walk = (lv) => {
    for (const b of lv.blocks) {
      if (b.type === 'subsystem') { walk(b.diagram); continue; }
      const keys = VARY[b.type] ?? (diagramBlockDef(b.type)?.ode ? Object.keys(b.params).filter((k) => !KEEP.has(k)) : []);
      for (const k of keys) {
        const v = b.params[k];
        if (Array.isArray(v)) b.params[k] = v.map((x) => (finite(x) && x !== 0 ? x * f() : x));
        else if (finite(v) && v !== 0) b.params[k] = v * f();
      }
    }
  };
  walk(d);
  return d;
}

// Measurement noise: a Noise block spliced into every measurement wire of the
// Controller, σ a share of that measurement's span in the nominal run.
function withNoise(diagram, path, sigmas) {
  const d = structuredClone(diagram), lv = level(d, path), id = path.at(-1);
  lv.wires.forEach((w, i) => {
    const t = parseEnd(w.to);
    if (t.id !== id || t.port < 1 || !(sigmas[t.port - 1] > 0)) return;
    const nid = `bench_noise_${t.port}`;
    lv.blocks.push({ id: nid, type: 'noise', params: { std: sigmas[t.port - 1], seed: 7 + t.port }, x: 0, y: 0 });
    lv.wires.push({ from: nid, to: w.to });
    lv.wires[i] = { from: w.from, to: nid };
  });
  return d;
}

// ---- What each type needs: the registry's future `bench` hooks ------------
// applies(c) → '' or the reason it cannot run on this block; start(c) → one
// or more { name, variant, how } to tune from; tune: 'iterate' (its gains),
// 'knob' (a designed type: one input that sets its speed, searched on a log
// scale), 'none'. A type the table does not know falls back to GENERIC: a
// designed type is computed with its defaults, a hand type is iterated from
// its defaults, and either is refused when its check or design refuses.

const half = (c) => (c.umax - c.umin) / 2, mid = (c) => (c.umax + c.umin) / 2;
const needLimits = (c) => (finite(c.umin) && finite(c.umax) ? '' : 'needs finite actuator limits (u min, u max) to know its swing');
const needRate = (c) => (c.m >= 2 ? '' : `reads ẏ on input 3; this block measures ${c.m} signal${c.m > 1 ? 's' : ''} (a Finite difference observer would make it)`);
const levels = (c, n) => (n === 1 ? [c.rMid] : Array.from({ length: n }, (_, i) => c.rLo + ((c.rHi - c.rLo) * i) / (n - 1)));
const v = (type, params, name) => normalizeVariant({ type, name: name ?? CONTROLLERS[type].label, params: { umin: 0, umax: 0, ...params } });

const BENCH = {
  off: { applies: () => 'does nothing: the open loop, not a candidate' },
  pid: {
    start: (c) => [{ variant: c.pidStart.variant, how: c.pidStart.how }],
    tune: 'iterate',
  },
  pidFF: {
    // Its feedback gains are hand inputs: the PID row's tuned gains; the
    // feedforward is computed from the plant's inverse.
    after: 'pid',
    // A feedforward on a stepped r kicks (Kv/Ts, Ka/Ts²): its knob is the
    // prefilter Tr, which shapes r into something the plant can follow.
    start: (c) => { const p = c.tuned.pid.params; return [{ variant: v('pidFF', { Kp: p.Kp, Ki: p.Ki, Kd: p.Kd, Tf: p.Tf, b: p.b, Tr: Math.max(p.Tr, c.tauGuess), order: '2', u0: p.u0, umin: c.umin, umax: c.umax }), how: 'the PID row\'s gains; Kff, Kv, Ka from the plant' }]; },
    tune: 'knob', knob: 'Tr',
  },
  scheduledPI: {
    start: (c) => [{ variant: v('scheduledPI', { at: levels(c, 1), Tcl: c.tauGuess, Tr: c.Tr0, umin: c.umin, umax: c.umax }), how: 'one level, r\'s middle' }],
    tune: 'knob', knob: 'Tcl',
  },
  gainScheduled: {
    applies: (c) => (c.rHi > c.rLo ? '' : 'r does not move: there is no range to schedule over'),
    // Its start: the plant's pole-cancellation PI at three levels of r (its
    // designed sibling's numbers), else the PID row's gains, flat.
    start: (c) => {
      if (c.simcSchedule) return [{ variant: { ...c.simcSchedule, name: 'Gain-scheduled PI' }, how: 'step tests, a SIMC schedule' }];
      const d = c.design(v('scheduledPI', { at: levels(c, 3), Tcl: c.tuned.scheduledPI?.params?.Tcl ?? c.tauGuess, Tr: c.Tr0, umin: c.umin, umax: c.umax }));
      if (d) return [{ variant: v('gainScheduled', { at: d.at, Kp: d.Kp, Ki: d.Ki, Tr: c.Tr0, u0: d.u0, umin: c.umin, umax: c.umax }), how: 'PI from the plant at 3 levels' }];
      const p = c.tuned.pid?.params ?? c.pidStart.variant.params;
      return [{ variant: v('gainScheduled', { at: levels(c, 2), Kp: [p.Kp, p.Kp], Ki: [p.Ki, p.Ki], Tr: p.Tr, u0: p.u0, umin: c.umin, umax: c.umax }), how: 'the PID\'s gains, flat' }];
    },
    after: 'scheduledPI', tune: 'iterate',
  },
  lqr: {
    start: (c) => [{ variant: v('lqr', { Q: [1], R: 1, track: 1, umin: c.umin, umax: c.umax }), how: 'Q = 1 for every measurement' }],
    tune: 'knob', knob: 'R',
  },
  stateFeedback: {
    after: 'lqr',
    applies: (c) => (c.tuned.lqr ? '' : `starts from the LQR design, which refused: ${c.refused.lqr}`),
    start: (c) => { const d = c.design(c.tuned.lqr); return [{ variant: v('stateFeedback', { K: d.K, kr: d.kr, umin: c.umin, umax: c.umax }), how: 'the LQR row\'s gains' }]; },
    tune: 'iterate',
  },
  swingUp: { applies: (c) => (c.m >= 4 ? '' : `reads x, θ, v, ω of a pendulum on a cart (4 measurements); this block measures ${c.m}`) },
  relay: {
    applies: needLimits,
    start: (c) => [{ variant: v('relay', { d: half(c) * c.dir, eps: 0.005 * c.rSpan, u0: mid(c), umin: c.umin, umax: c.umax }), how: 'the full actuator range, hysteresis 0.5 % of r' }],
    tune: 'none',
  },
  slidingMode: {
    applies: (c) => needLimits(c) || needRate(c),
    start: (c) => {
      const base = { lambda: c.lambda, K: half(c) * c.dir, u0: mid(c), umin: c.umin, umax: c.umax, Tr: 0 };
      return [
        { name: 'Sliding mode (ideal)', variant: v('slidingMode', { ...base, phi: 0 }, 'Sliding mode (ideal)'), how: 'λ from the step model, K the full swing' },
        { name: 'Sliding mode (boundary layer)', variant: v('slidingMode', { ...base, phi: 0.2 * c.lambda * c.rSpan }, 'Sliding mode (layer)'), how: 'and φ = 0.2·λ·span r' },
      ];
    },
    tune: 'iterate',
  },
  superTwisting: {
    applies: (c) => needLimits(c) || needRate(c),
    start: (c) => [{ variant: v('superTwisting', { lambda: c.lambda, k1: (half(c) / 3) * c.dir, k2: 3.7 * half(c) * c.dir, u0: mid(c), umin: c.umin, umax: c.umax }), how: 'λ as the sliding mode; k1 = U/3, k2 = 3.7 U' }],
    tune: 'iterate',
  },
};
const GENERIC = {
  start: (c, type) => [{ variant: v(type, { umin: c.umin, umax: c.umax }), how: 'its defaults' }],
  tune: (type) => (CONTROLLERS[type].designed ? 'none' : 'iterate'),
};

// ---- Scoring --------------------------------------------------------------
// The criteria, each from a run, the Analysis numbers, the sweep or the type.
// dir: 'low' (smaller is better) or 'high'. tol: how far from the datum still
// counts as the same (S), relative; abs: and an absolute floor.
const CRITERIA = [
  { key: 'track', label: 'Following r (IAE)', dir: 'low', tol: 0.1, abs: 1e-3, w: 3 },
  { key: 'dist', label: 'Rejecting d (IAE)', dir: 'low', tol: 0.1, abs: 1e-3, w: 3 },
  { key: 'over', label: 'Overshoot', dir: 'low', tol: 0.2, abs: 2, w: 2 },
  { key: 'settle', label: 'Settling (2 %, s)', dir: 'low', tol: 0.15, abs: 0.02, w: 1 },
  { key: 'effort', label: 'Effort (u swing)', dir: 'low', tol: 0.15, abs: 1e-3, w: 1 },
  { key: 'wear', label: 'Wear (u travel/s)', dir: 'low', tol: 0.25, abs: 0.05, w: 2 },
  { key: 'sat', label: 'Time at a limit', dir: 'low', tol: 0.25, abs: 0.02, w: 1 },
  { key: 'ms', label: 'Robustness Ms', dir: 'low', tol: 0.1, abs: 0.05, w: 2 },
  { key: 'vary', label: 'Plant ±15 % (worst J)', dir: 'low', tol: 0.15, abs: 0.005, w: 3 },
  { key: 'noise', label: 'Noise → u', dir: 'low', tol: 0.25, abs: 0.002, w: 2 },
  { key: 'complex', label: 'Complexity', dir: 'low', tol: 0, abs: 0.5, w: 1 },
  { key: 'effortTune', label: 'Tuning runs', dir: 'low', tol: 0.5, abs: 5, w: 1 },
];

// Following and rejection from one run: windows after each reference step
// (until the next step or a jump of d) and after each jump of d (until the
// next step of r).
function runScores(run, key, others, R, U, variant) {
  const { t, r, y, u } = loopSignals(run, key), n = t.length, dt = (t[n - 1] - t[0]) / (n - 1);
  const jumps = (a, thr) => { const k = []; for (let i = 1; i < n; i++) if (Math.abs(a[i] - a[i - 1]) > thr) k.push(i); return k; };
  const rs = jumps(r, 0.05 * R);
  const ds = others.flatMap((name) => { const a = run.signals[name]; return a ? jumps(a, 0.05 * (span(a) || 1)).filter((i, j, l) => !j || i - l[j - 1] > 1) : []; }).sort((a, b) => a - b);
  const next = (list, k) => list.find((x) => x > k) ?? n;
  let iae = 0, nT = 0, over = 0, settle = [], diae = 0, nD = 0;
  for (const k0 of rs) {
    const k1 = Math.min(next(rs, k0), next(ds, k0)), dr = r[k0] - r[k0 - 1], dir = Math.sign(dr);
    let peak = 0, last = k0;
    for (let k = k0; k < k1; k++) {
      iae += Math.abs(r[k] - y[k]) / R; nT++;
      peak = Math.max(peak, dir * (y[k] - r[k]));
      if (Math.abs(y[k] - r[k]) > 0.02 * Math.abs(dr)) last = k;
    }
    over = Math.max(over, (100 * peak) / Math.abs(dr));
    settle.push((last - k0 + 1) * dt);   // s; a window that never settles counts whole
  }
  for (const k0 of ds) {
    const k1 = next(rs, k0);
    for (let k = k0; k < k1; k++) { diae += Math.abs(r[k] - y[k]) / R; nD++; }
  }
  let um = 0; for (let k = 0; k < n; k++) um += u[k] / n;
  let sw = 0, tv = 0, sat = 0;
  const lo = variant.params.umin, hi = variant.params.umax, tol = 1e-9 * (U + 1);
  for (let k = 0; k < n; k++) {
    sw += (u[k] - um) ** 2;
    if (k) tv += Math.abs(u[k] - u[k - 1]);
    if ((finite(lo) && u[k] <= lo + tol) || (finite(hi) && u[k] >= hi - tol)) sat++;
  }
  return {
    track: nT ? iae / nT : null, dist: nD ? diae / nD : null, over, settle: settle.length ? settle.reduce((a, b) => a + b, 0) / settle.length : null,
    effort: Math.sqrt(sw / n) / U, wear: tv / U / (t[n - 1] - t[0]), sat: sat / n,
  };
}

// Margins from the Analysis tab's core, on the loop linearised where it
// works: at r's middle (a trim of y1 there). And the start's check, as
// Auto-tune makes it: a loop unstable where the run starts rests there only
// because it starts in balance. u at a limit (the oven's heater at 0 at the
// start) leaves the linear loop meaningless there: neither gate nor score.
function linearLoop(project, ctx, variant, at) {
  try {
    const m = loopModel(placed(project, ctx, variant), ctx.path, at);
    if (m.atLimit) return { none: 'u at a limit there: not linear' };
    const a = analyzeLoop(m.plant, m.ctrl, m.Ts);
    // Marginal (a pole on the circle, such as an angle the speed loop does
    // not feed back) is not unstable: Auto-tune's check lets it pass too.
    if (!a.stable && !a.marginal) return { stable: false, note: `${a.Z} poles outside` };
    return { stable: true, marginal: a.marginal, ms: a.margins.ms, pm: a.margins.pm, gm: a.margins.gmUp, dm: a.margins.dm };
  } catch (e) { return { none: e.message.split(';')[0].slice(0, 90) }; }
}
function margins(project, ctx, variant, rMid, m) {
  const mid = linearLoop(project, ctx, variant, { y: [rMid, ...new Array(Math.max(0, m - 1)).fill(null)] });
  const start = linearLoop(project, ctx, variant, 'initial');
  return { ...mid, startUnstable: start.stable === false ? start.note : null };
}

// Complexity, from the registry: the numbers a person sets or the design
// computes (parameters other than limits and options), the measurements it
// reads, and +2 when it needs a model of the plant.
function complexity(variant, m) {
  const def = CONTROLLERS[variant.type];
  const reads = ['slidingMode', 'superTwisting'].includes(variant.type) ? 2 : ['stateFeedback', 'lqr', 'swingUp', 'swingUpLqr', 'trajectory'].includes(variant.type) ? m : 1;
  const law = def.designed ? (def.manual ? def.manual(variant.params, designValues(variant)).params : {}) : variant.params;
  const skip = new Set(['umin', 'umax', 'u0', 'aw', 'Tt', 'Tf', 'b', 'track', 'order', 'eps', 'Q', 'R']);
  let n = 0;
  for (const [k, x] of Object.entries(law)) if (!skip.has(k)) for (const y of [].concat(x)) if (finite(y) && y !== 0) n++;
  return n + reads + (def.designed ? 2 : 0);
}
let designValues = () => null;

// ---- The benchmark ----------------------------------------------------------

function benchmark(name) {
  const T = { load: 0, starts: 0, tune: 0, score: 0, sweep: 0 };
  let t0 = now();
  const project = load(name), ctx = tuneContext(project, null);
  const running = ctx.variant, rp = running.params;
  const run0 = runVariant(ctx, running), sc = costScales(run0, ctx.key, running), R = sc.e, U = sc.u;
  const ls = loopSignals(run0, ctx.key);
  const c = {
    m: ctx.block.params.inputs - 1, umin: rp.umin, umax: rp.umax, Tr0: rp.Tr ?? 0, dir: 1,
    rLo: Math.min(...ls.r), rHi: Math.max(...ls.r), rSpan: R, tuned: {}, refused: {},
  };
  c.rMid = (c.rLo + c.rHi) / 2;
  // A designed variant's numbers, from a compile of the plant with it running.
  const designStatus = (variant) => { try { return compileDiagram(withVariant(ctx.diagram, ctx.path, variant), 'plant', { standalone: true }).designs.find((s) => s.path === ctx.key); } catch (e) { return { error: e }; } };
  c.design = (variant) => {
    return designStatus(variant)?.values ?? null;
  };
  designValues = (variant) => c.design(variant);
  T.load = now() - t0;
  // What one run costs here (the running variant, five runs).
  t0 = now(); for (let i = 0; i < 5; i++) runVariant(ctx, running); T.run = (now() - t0) / 5;

  // One step test for every rule that needs a model: SIMC for the PID's
  // start; τ for the designed PI's Tcl; λ for the sliding modes.
  t0 = now();
  let st = null;
  try { st = autotune(sisoProject(project, ctx), ctx.path, { method: 'step' }); } catch (e) { st = { ok: false, why: e.message }; }
  if (!st?.ok) { try { st = autotune(sisoProject(project, ctx), ctx.path, { method: 'relay' }); } catch (e) { st = { ok: false, why: e.message }; } }
  const model = st?.model === 'fopdt' ? st.fit ?? st : st;
  const g = st?.gains ?? {};
  const tauC = g.tauC ?? (finite(g.tauI) ? g.tauI / 4 : null);
  c.tauGuess = Math.max(5 * ctx.Ts, tauC ?? ctx.sim.duration / 20);
  c.lambda = 1 / c.tauGuess;
  // A gain-scheduled running variant gets a SIMC schedule from the step
  // test: the gain-scheduled row starts from it, the PID from its middle point.
  if (st?.ok && st.variant.type === 'gainScheduled') {
    const q = st.variant.params, j = Math.floor(q.at.length / 2);
    c.simcSchedule = st.variant;
    c.pidStart = { variant: v('pid', { Kp: q.Kp[j], Ki: q.Ki[j], Tr: q.Tr, u0: q.u0, umin: c.umin, umax: c.umax }), how: `step test, SIMC at ${fmt(q.at[j])} (the schedule's middle)` };
  } else c.pidStart = st?.ok
    ? { variant: { ...st.variant, params: { ...st.variant.params, umin: c.umin, umax: c.umax } }, how: st.method === 'relay' ? 'relay test, Tyreus–Luyben' : `step test, SIMC (${st.model})` }
    : { variant: v('pid', { Kp: 1, Tr: c.Tr0, umin: c.umin, umax: c.umax }), how: `Kp = 1 (no test: ${st?.why ?? '?'})` };
  T.starts = now() - t0;

  const goalScore = (variant, sim = ctx.sim, diagram = null) => {
    const run = diagram ? simulateSystem(withVariant(diagram, ctx.path, variant), ctx.signals, sim) : runVariant(ctx, variant);
    return { run, cost: runCost(run, ctx.key, GOAL_USED, { scales: sc, variant, others: ctx.others }) };
  };

  // Types in registry order, each after the row it starts from.
  const order = [];
  const add = (type) => { if (order.includes(type)) return; const after = BENCH[type]?.after; if (after && CONTROLLERS[after]) add(after); order.push(type); };
  for (const type of CONTROLLER_TYPES) add(type);

  const rows = [], refusals = [];
  // The running variant as loaded, scored as it is: what the person has now.
  rows.push({ type: running.type, name: `As loaded: ${running.name}`, how: 'not tuned', variant: running, start: null, evals: 0, loaded: true });

  // The gates a tuned variant must pass to fit (the same as the matrix's
  // Fits row): finite runs on the nominal plant and on every varied one,
  // stable at r's middle and where the run starts, Ms at most MS_MAX.
  const plants = Array.from({ length: SWEEP }, (_, i) => vary(ctx.diagram, 0.15, 101 + i));
  const gate = (variant) => {
    if (goalScore(variant).cost.diverged) return 'diverges on the nominal plant';
    const mg = margins(project, ctx, variant, c.rMid, c.m);
    if (mg.stable === false) return `unstable at r's middle (${mg.note})`;
    if (mg.startUnstable) return `unstable where the run starts (${mg.startUnstable})`;
    if (mg.ms > MS_MAX) return `Ms ${fmt(mg.ms, 2)}`;
    const bad = plants.filter((d) => { try { return goalScore(variant, ctx.sim, d).cost.diverged; } catch { return true; } }).length;
    return bad ? `diverges on ${bad} of ${SWEEP} varied plants` : '';
  };
  // Geometric blend of two variants of one type: every number that is
  // finite, non-zero and of one sign in both, s^(1−a)·t^a.
  const blend = (sv, tv, a) => {
    const P = { ...tv.params };
    for (const [k, x] of Object.entries(tv.params)) {
      const y = sv.params[k];
      const mix = (p0, p1) => (finite(p0) && finite(p1) && p0 * p1 > 0 ? Math.sign(p1) * Math.abs(p0) ** (1 - a) * Math.abs(p1) ** a : p1);
      P[k] = Array.isArray(x) ? x.map((xi, i) => mix(y?.[i], xi)) : mix(y, x);
    }
    return { ...tv, params: P };
  };

  t0 = now();
  for (const type of order) {
    const def = CONTROLLERS[type], h = BENCH[type] ?? {};
    const why = h.applies?.(c) ?? '';
    if (why) { refusals.push({ type, label: def.label, why }); c.refused[type] = why; continue; }
    let starts;
    try { starts = (h.start ?? ((cc) => GENERIC.start(cc, type)))(c); } catch (e) { refusals.push({ type, label: def.label, why: e.message }); c.refused[type] = e.message; continue; }
    const tune = h.tune ?? GENERIC.tune(type);
    for (const s of starts) {
      const t1 = now();
      let variant = s.variant, evals = 0, start;
      // A designed type that refuses on this plant: its design's sentence.
      if (def.designed) {
        const st2 = designStatus(variant);
        if (!st2?.values) { const msg = st2?.error?.message ?? `its design is ${st2?.status ?? 'missing'}`; refusals.push({ type, label: def.label, why: msg }); c.refused[type] = msg; continue; }
      }
      try { start = goalScore(variant).cost.J; evals++; } catch (e) { refusals.push({ type, label: s.name ?? def.label, why: e.message }); c.refused[type] = e.message; continue; }
      if (tune === 'iterate') {
        try {
          const r = drain(iterate(placed(project, ctx, variant), ctx.path, GOAL_USED, { maxIter: MAX_ITER }));
          if (r.best.cost.J < start) variant = r.best.variant;
          evals += r.evals;
        } catch (e) { s.how += ` (not iterated: ${e.message.slice(0, 60)})`; }
      } else if (tune === 'knob') {
        // Golden section on log(knob) over ×1/30 … ×30 of the start: the
        // designed type stays designed, only its speed input moves.
        const k0 = variant.params[h.knob], f = (x) => { const vv = normalizeVariant({ ...variant, params: { ...variant.params, [h.knob]: k0 * Math.exp(x) } }); evals++; try { return goalScore(vv).cost.J; } catch { return Infinity; } };
        let a = -Math.log(30), b = Math.log(30), gr = (Math.sqrt(5) - 1) / 2, x1 = b - gr * (b - a), x2 = a + gr * (b - a), f1 = f(x1), f2 = f(x2);
        for (let i = 0; i < 12; i++) { if (f1 < f2) { b = x2; x2 = x1; f2 = f1; x1 = b - gr * (b - a); f1 = f(x1); } else { a = x1; x1 = x2; f1 = f2; x2 = a + gr * (b - a); f2 = f(x2); } }
        const x = f1 < f2 ? x1 : x2, best = Math.min(f1, f2);
        if (best < start) variant = normalizeVariant({ ...variant, params: { ...variant.params, [h.knob]: k0 * Math.exp(x) } });
        s.how += `; ${h.knob} searched → ${fmt(variant.params[h.knob])}`;
      }
      // A tuned variant that fails a gate backs off along the way it came:
      // ¾, ½, ¼ of the way from the start, then the start itself. The cost
      // Iterate minimises has no robustness term (the design adds one).
      if (variant !== s.variant && BACKOFF) {
        let why = gate(variant);
        if (why) {
          const tried = variant, first = why;
          for (const a of [0.75, 0.5, 0.25, 0]) {
            const cand = a ? blend(s.variant, tried, a) : s.variant;
            why = gate(cand); evals++;
            if (!why) { variant = cand; s.how += `; backed off to ${a * 100} % of the way (tuned: ${first})`; break; }
          }
          if (why) s.how += `; no point on the way fits (tuned: ${first})`;
        }
      }
      const row = { type, name: s.name ?? def.label, how: s.how, variant, start, evals, tuneMs: now() - t1 };
      rows.push(row);
      if (!(type in c.tuned)) c.tuned[type] = variant;
    }
  }
  T.tune = now() - t0;

  // Score every row: the nominal run, the margins, noise, complexity.
  t0 = now();
  // σ for each measurement: 0.5 % of its span in the loaded run, read by a
  // Sink spliced onto each measurement wire.
  const probed = structuredClone(ctx.diagram), plv = level(probed, ctx.path), sigmas = [];
  for (const w of [...plv.wires]) { const t = parseEnd(w.to); if (t.id === ctx.path.at(-1) && t.port >= 1) { plv.blocks.push({ id: `bench_m${t.port}`, type: 'sink', params: { name: `bench_m${t.port}`, unit: '1' }, x: 0, y: 0 }); plv.wires.push({ from: w.from, to: `bench_m${t.port}` }); } }
  const prun = simulateSystem(withVariant(probed, ctx.path, running), ctx.signals, ctx.sim);
  for (let k = 1; k <= c.m; k++) sigmas[k - 1] = 0.005 * span(prun.signals[`bench_m${k}`] ?? []);
  const noisy = withNoise(ctx.diagram, ctx.path, sigmas);
  for (const row of rows) {
    const { run, cost } = goalScore(row.variant);
    row.J = cost.J; row.diverged = cost.diverged;
    Object.assign(row, cost.diverged ? {} : runScores(run, ctx.key, ctx.others, R, U, row.variant));
    row.margins = margins(project, ctx, row.variant, c.rMid, c.m);
    row.ms = row.margins.ms ?? null;
    if (!cost.diverged) {
      const nr = simulateSystem(withVariant(noisy, ctx.path, row.variant), ctx.signals, ctx.sim);
      const a = loopSignals(nr, ctx.key).u, b = loopSignals(run, ctx.key).u;
      let s2 = 0; for (let k = 0; k < a.length; k++) s2 += (a[k] - b[k]) ** 2;
      row.noise = Math.sqrt(s2 / a.length) / U;
    }
    row.complex = complexity(row.variant, c.m);
    row.effortTune = row.evals;
  }
  T.score = now() - t0;

  // The robustness sweep: SWEEP seeded plants within ±15 %.
  t0 = now();
  for (const row of rows) {
    if (row.diverged) continue;
    let worst = 0, bad = 0;
    for (const d of plants) {
      let J;
      try { J = goalScore(row.variant, ctx.sim, d).cost; } catch { J = { J: 200, diverged: true }; }
      if (J.diverged) bad++;
      worst = Math.max(worst, J.J);
    }
    row.vary = worst; row.varyBad = bad;
  }
  T.sweep = now() - t0;

  // Fit: stable and finite in the nominal run and in every varied plant.
  for (const row of rows) {
    const fragile = row.ms !== null && row.ms > MS_MAX;
    row.fits = !row.diverged && !row.varyBad && row.margins.stable !== false && !row.margins.startUnstable && !fragile;
    row.whyNot = row.diverged ? 'diverges on the nominal plant' : row.varyBad ? `diverges on ${row.varyBad} of ${SWEEP} plants within ±15 %` : row.margins.stable === false ? `unstable at r's middle (${row.margins.note})` : row.margins.startUnstable ? `unstable where the run starts (${row.margins.startUnstable}); it rests there only because it starts in balance` : fragile ? `fragile: Ms ${fmt(row.ms, 2)} at r's middle (at most ${MS_MAX}), PM ${fmt(row.margins.pm, 2)}°` : '';
  }
  return { name: project.title, ctx, rows, refusals, T, step: st?.ok ? `${st.method === 'relay' ? 'relay' : st.model}` : st?.why, R, U };
}

// ---- The Pugh matrix ---------------------------------------------------------

function pugh(rows, datum) {
  const marks = rows.map((row) => {
    let total = 0, plus = 0, minus = 0;
    const m = CRITERIA.map((cr) => {
      const a = row[cr.key], b = datum[cr.key];
      if (row === datum) return 'D';
      if (a === null || a === undefined || b === null || b === undefined || !finite(a) || !finite(b)) {
        // Ms without a linear model: not judged (the sweep judges robustness).
        return '?';
      }
      const d = cr.dir === 'low' ? b - a : a - b, thr = Math.max(cr.abs, cr.tol * Math.abs(b));
      const s = d > thr ? 1 : d < -thr ? -1 : 0;
      total += cr.w * s; if (s > 0) plus++; if (s < 0) minus++;
      return s > 0 ? '+' : s < 0 ? '−' : 'S';
    });
    return { row, m, total: row === datum ? 0 : total, plus, minus };
  });
  return marks;
}

// ---- Output ---------------------------------------------------------------

const out = [];
const results = [];
for (const name of SYSTEMS) {
  const t0 = now();
  const b = benchmark(name);
  const total = now() - t0;
  results.push(b);
  const fitting = b.rows.filter((r) => r.fits);
  // The datum: the tuned PID; if it does not fit, the running variant; if
  // that does not fit either, the fitting row with the lowest J.
  const pid = b.rows.find((r) => r.type === 'pid' && !r.loaded), loaded = b.rows.find((r) => r.loaded);
  const datum = pid?.fits ? pid : loaded?.fits ? loaded : [...fitting].sort((a, c) => a.J - c.J)[0] ?? b.rows[0];
  const p1 = pugh(b.rows, datum);
  const ranked1 = p1.filter((x) => x.row.fits).sort((a, c) => c.total - a.total || a.row.J - c.row.J);
  const win1 = ranked1[0]?.row ?? datum;
  const p2 = pugh(b.rows, win1);
  const ranked2 = p2.filter((x) => x.row.fits).sort((a, c) => c.total - a.total || a.row.J - c.row.J);

  out.push(`\n## ${b.name}\n`);
  out.push(`Step test for the starts: ${b.step}. Total ${(total / 1000).toFixed(1)} s: load ${fmt(b.T.load / 1000)} s, starts ${fmt(b.T.starts / 1000)} s, tuning ${fmt(b.T.tune / 1000)} s, scoring ${fmt(b.T.score / 1000)} s, sweep (${SWEEP} plants) ${fmt(b.T.sweep / 1000)} s. One run ${fmt(b.T.run, 2)} ms, so about ${Math.round(total / b.T.run)} runs' worth.\n`);
  out.push('Refused:\n');
  for (const r of b.refusals) out.push(`- ${r.label} (\`${r.type}\`): ${r.why}`);
  out.push('\nCandidates (J: the goal\'s cost, IAE + effort + overshoot + saturation; start → tuned):\n');
  out.push('| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |');
  out.push('|---|---|---|---|---|---|');
  for (const r of b.rows) out.push(`| ${r.name} | ${r.how} | ${r.start === null ? '' : `${fmt(r.start)} → `}${fmt(r.J)} | ${r.evals} | ${fmt(r.tuneMs ?? 0, 2)} | ${r.fits ? 'yes' : `no: ${r.whyNot}`} |`);
  out.push('\nScores:\n');
  out.push(`| Candidate | ${CRITERIA.map((c) => c.label).join(' | ')} | PM ° | Delay margin |`);
  out.push(`|---|${CRITERIA.map(() => '---').join('|')}|---|---|`);
  for (const r of b.rows) out.push(`| ${r.name} | ${CRITERIA.map((c) => (c.key === 'over' ? `${fmt(r[c.key], 2)} %` : c.key === 'ms' && r[c.key] === null ? (r.margins.none ? 'no linear model' : r.margins.stable === false ? 'unstable' : '—') : fmt(r[c.key], 2))).join(' | ')} | ${fmt(r.margins.pm, 2)} | ${r.margins.dm !== undefined ? `${fmt(r.margins.dm * 1000, 2)} ms` : '—'} |`);
  for (const [round, marks, dat, ranked] of [[1, p1, datum, ranked1], [2, p2, win1, ranked2]]) {
    out.push(`\nPugh matrix, round ${round}: datum **${dat.name}**${round === 2 ? ' (round 1\'s winner)' : ''}; weights ${CRITERIA.map((c) => c.w).join(', ')}.\n`);
    out.push(`| Criterion (weight) | ${marks.map((x) => x.row.name.replace('As loaded: ', 'Loaded: ')).join(' | ')} |`);
    out.push(`|---|${marks.map(() => ':-:').join('|')}|`);
    CRITERIA.forEach((cr, i) => out.push(`| ${cr.label} (${cr.w}) | ${marks.map((x) => x.m[i]).join(' | ')} |`));
    out.push(`| **+ / −** | ${marks.map((x) => (x.row === dat ? 'datum' : `${x.plus} / ${x.minus}`)).join(' | ')} |`);
    out.push(`| **Weighted** | ${marks.map((x) => (x.row === dat ? '0' : String(x.total))).join(' | ')} |`);
    out.push(`| **Fits** | ${marks.map((x) => (x.row.fits ? 'yes' : 'no')).join(' | ')} |`);
    out.push(`\nRanking (fitting only): ${ranked.map((x, i) => `${i + 1}. ${x.row.name} (${x.total >= 0 ? '+' : ''}${x.total})`).join('; ')}.`);
  }
}
const text = `# Benchmark prototype: results\n\nGoal: ${JSON.stringify(GOAL_USED)}; Iterate up to ${MAX_ITER} iterations; sweep ${SWEEP} plants within ±15 %. Node ${process.version}.\n${out.join('\n')}\n`;
console.log(text);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(results.map((b) => ({ name: b.name, T: b.T, refusals: b.refusals, rows: b.rows.map(({ variant, margins: mg, ...r }) => ({ ...r, variant, margins: mg })) })), null, 1));
