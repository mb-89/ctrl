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
// Prints, per system: the tests (a standard load step when the system's d
// plays nothing; the same moves as a smooth move), the candidates and
// refusals, the scores, the feedforward's share of the effort, the
// five-point Pugh matrix (one round against the tuned PID, the main-job gate),
// the suggestion, the plant changes it scored (never applied), the weight
// sensitivity, and the time each phase took.

import { writeFileSync } from 'node:fs';
import { SYSTEM_LIBRARY, SYSTEM_PARTS, applySystem } from '../src/core/systems.js';
import { DEFAULT_PROJECT } from '../src/core/examples.js';
import { normalizeProject, loopModel } from '../src/core/project.js';
import { CONTROLLERS, CONTROLLER_TYPES, normalizeVariant } from '../src/core/controllers.js';
import { diagramBlockDef, parseEnd, compileDiagram, blockPorts } from '../src/core/diagram.js';
import { analyzeLoop } from '../src/core/analysis.js';
import { simulateSystem } from '../src/core/sim.js';
import { decide, SYMBOL } from '../src/core/pugh.js';
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
  { key: 'track', label: 'Following steps (IAE)', dir: 'low', tol: 0.1, abs: 1e-3, w: 1.5, job: true },
  { key: 'move', label: 'Following a smooth move (IAE)', dir: 'low', tol: 0.1, abs: 1e-3, w: 1.5, job: true },
  { key: 'dist', label: 'Rejecting d (IAE)', dir: 'low', tol: 0.1, abs: 1e-3, w: 3, job: true },
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

// Following a smooth move: the mean |r − y| / R over the same windows as
// the steps (from each of r's steps in the system's run, until the next or
// a jump of d), in the run whose r is the smooth move.
function moveScore(run, key, others, R, steps) {
  const { r, y } = loopSignals(run, key), n = r.length;
  const jumps = (a, thr) => { const k = []; for (let i = 1; i < n; i++) if (Math.abs(a[i] - a[i - 1]) > thr) k.push(i); return k; };
  const ds = others.flatMap((name) => { const a = run.signals[name]; return a ? jumps(a, 0.05 * (span(a) || 1)) : []; }).sort((a, b) => a - b);
  let iae = 0, m = 0;
  for (const k0 of steps) {
    const k1 = Math.min(steps.find((x) => x > k0) ?? n, ds.find((x) => x > k0) ?? n);
    for (let k = k0; k < k1; k++) { iae += Math.abs(r[k] - y[k]) / R; m++; }
  }
  return m ? iae / m : null;
}

// What share of the effort the reference feedforward supplies: the PID's
// Kff·rf + Kv·ṙf + Ka·r̈f replayed at the controller's samples from the r the
// block saw (pidCore's formula and prefilter), clipped to the limits, against
// the rest of u (the feedback): Σ|ff| / (Σ|ff| + Σ|u − ff|) over the run.
function ffShare(run, key, params, Ts) {
  const { t, r, u } = loopSignals(run, key);
  const a = params.Tr > 0 ? Math.exp(-Ts / params.Tr) : 0;
  let rf = null, r1 = null, r2 = null, sff = 0, su = 0, k = 0;
  for (let j = 0; t[0] + j * Ts <= t.at(-1) + 1e-12; j++) {
    while (k < t.length - 1 && t[k + 1] <= t[0] + j * Ts + 1e-12) k++;
    rf = rf === null ? r[k] : a * rf + (1 - a) * r[k];
    if (r1 === null) r1 = r2 = rf;
    const ff = params.Kff * rf + (params.Kv * (rf - r1)) / Ts + (params.Ka * (rf - 2 * r1 + r2)) / (Ts * Ts);
    r2 = r1; r1 = rf;
    const ffc = Math.min(params.umax, Math.max(params.umin, ff));
    sff += Math.abs(ffc); su += Math.abs(u[k] - ffc);
  }
  return sff + su > 0 ? sff / (sff + su) : 0;
}

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

// ---- Plant changes: reported and scored, never applied ----------------------
// Two kinds (input 48): an observer for a measurement the block lacks, so a
// type refused for it can run; and a sensor in place of an observer, so the
// loop reads the true signal the estimate stands for. Each gives a changed
// copy of the diagram on which candidates are tuned and scored like any
// other; their columns carry the change and PLANT_CHANGE more complexity.
const PLANT_CHANGE = 5;

// ẏ for a block that measures y alone: a Finite difference observer on y
// (rate filter Tf), its rate on the Controller's new input 3.
function addRateObserver(diagram, path, Tf) {
  const d = structuredClone(diagram), lv = level(d, path), id = path.at(-1), b = lv.blocks.find((x) => x.id === id);
  const yw = lv.wires.find((w) => { const t = parseEnd(w.to); return t.id === id && t.port === 1; });
  if (!yw || b.params.inputs !== 2) return null;
  b.params.inputs = 3;
  lv.blocks.push({ id: 'bench_obs', type: 'observer', name: 'rate (benchmark)', params: { inputs: 2, outputs: 2, Ts: b.params.Ts }, x: 0, y: 0, variants: [{ name: 'Finite difference', type: 'difference', params: { Tf } }], variant: 0 });
  lv.wires.push({ from: id, to: 'bench_obs' }, { from: yw.from, to: 'bench_obs:1' }, { from: 'bench_obs:1', to: `${id}:2` });
  return { diagram: d, change: `a Finite difference observer (Tf ${fmt(Tf)} s) makes ẏ from y for input 3` };
}

// Measure it instead: each Controller input fed by an Observer's estimate
// gets the true signal that estimate stands for. For a Finite difference,
// estimate m + k is the rate of its measurement k. Mechanically, whatever
// the plant's inside looks like (a bare integrator, a Servo subsystem): back
// from that measurement through sensor blocks (Noise, Quantizer) to the
// signal they measure, then, among every block output at that level, the
// one whose run matches that signal's derivative best (rms difference within
// 5 % of the derivative's rms) in the loaded run. (A Kalman or placed
// Luenberger estimate stands for the states its design names,
// values.stateIndex; the same match finds a block output equal to that
// state: the design.)
const SENSOR_BLOCKS = new Set(['noise', 'quantizer']);
function sensorForObserver(diagram, path, signals, sim, running) {
  const d = structuredClone(diagram), lv = level(d, path), id = path.at(-1), changes = [];
  const into = (bid, port) => lv.wires.find((w) => { const t = parseEnd(w.to); return t.id === bid && t.port === port; });
  for (const w of lv.wires) {
    const t = parseEnd(w.to), f = parseEnd(w.from);
    if (t.id !== id || t.port < 1) continue;
    const obs = lv.blocks.find((x) => x.id === f.id && x.type === 'observer');
    if (!obs) continue;
    const variant = obs.variants[obs.variant ?? 0], mObs = obs.params.inputs - 1;
    if (variant.type !== 'difference' || f.port < mObs) continue;
    // The measured signal, before the sensor blocks.
    let src = into(obs.id, f.port - mObs + 1), hops = 0;
    while (src && hops++ < 20) {
      const b = lv.blocks.find((x) => x.id === parseEnd(src.from).id);
      if (!b || !SENSOR_BLOCKS.has(b.type)) break;
      src = into(b.id, 0);
    }
    if (!src) continue;
    // Probe it and every block output at this level, in one loaded run.
    const probe = structuredClone(diagram), plv = level(probe, path), outs = [];
    for (const b of lv.blocks) {
      if (['sink', 'source', 'observer', 'controller', 'terminator'].includes(b.type) || b.id.startsWith('bench_')) continue;
      const n = blockPorts(b)[1] ?? 0;
      for (let k = 0; k < n; k++) outs.push(k ? `${b.id}:${k}` : b.id);
    }
    const name = (o) => `bp${outs.indexOf(o)}`;   // Sink names are short
    for (const o of outs) { plv.blocks.push({ id: name(o), type: 'sink', params: { name: name(o), unit: '1' }, x: 0, y: 0 }); plv.wires.push({ from: o, to: name(o) }); }
    let run;
    try { run = simulateSystem(withVariant(probe, path, running), signals, sim); } catch { continue; }
    const from = parseEnd(src.from), base = run.signals[name(from.port ? `${from.id}:${from.port}` : from.id)];
    if (!base) continue;
    const tt = run.t, der = base.map((_, k) => (k ? (base[k] - base[k - 1]) / (tt[k] - tt[k - 1]) : 0)), rms = Math.sqrt(der.reduce((s2, x) => s2 + x * x, 0) / der.length);
    let best = null;
    for (const o of outs) {
      const y = run.signals[name(o)];
      if (!y || y === base) continue;
      let e = 0; for (let k = 1; k < y.length; k++) e += (y[k] - der[k]) ** 2;
      const rel = Math.sqrt(e / (y.length - 1)) / (rms || 1);
      if (!best || rel < best.rel) best = { o, rel };
    }
    if (!best || best.rel > 0.05) continue;
    w.from = best.o;
    changes.push(`input ${t.port + 1} measures ${best.o} directly (it matches the rate of ${src.from} within ${fmt(100 * best.rel, 2)} %), in place of '${obs.name ?? obs.id}' (${variant.name})`);
  }
  return changes.length ? { diagram: d, change: changes.join('; ') } : null;
}

// ---- The standard tests ----------------------------------------------------
// The disturbance (input 55: "it can't only weigh following, it also needs
// to weigh disturbance reaction"): when no input other than r plays
// anything, a load step at the plant's input, u_plant = u + d: −10 % of the
// actuator range (of u's swing in the loaded run when the range is open),
// from the middle of the longest stretch between r's steps to the end. The
// plant input is the one place every plant has; a load there passes through
// the whole plant, so only integral action (or an equivalent) removes it.
function withStandardDisturbance(project, ctx, U, steps, n, dt) {
  const others = ctx.others.filter((k) => { const sig = project.system.signals[k]; return sig?.components?.length; });
  if (others.length) return null;
  const d = structuredClone(ctx.diagram), lv = level(d, ctx.path), id = ctx.path.at(-1);
  const into = lv.wires.filter((w) => parseEnd(w.from).id === id && !['sink', 'observer'].includes(lv.blocks.find((b) => b.id === parseEnd(w.to).id)?.type));
  if (!into.length) return null;
  lv.blocks.push({ id: 'bench_load', type: 'source', params: { signal: 'bench_d', unit: 'u' }, x: 0, y: 0 }, { id: 'bench_sum', type: 'sum', params: { signs: '++' }, x: 0, y: 0 });
  for (const w of into) { lv.wires.push({ from: 'bench_sum', to: w.to }); w.to = 'bench_sum'; }
  lv.wires.push({ from: 'bench_load', to: 'bench_sum:1' });
  // The longest stretch between steps (the last one runs to the end).
  const cuts = [...steps, n];
  let best = [0, cuts[0]];
  for (let i = 0; i < cuts.length - 1; i++) if (cuts[i + 1] - cuts[i] > best[1] - best[0]) best = [cuts[i], cuts[i + 1]];
  const time = (Math.round((best[0] + best[1]) / 2)) * dt, amplitude = -0.1 * U;
  const period = project.system.signals.r?.period ?? ctx.sim.duration;
  const signals = { ...project.system.signals, bench_d: { period, components: [{ type: 'step', params: { amplitude, time } }] } };
  return { project: { ...withDiagram(project, d), system: { ...project.system, plant: { ...project.system.plant, diagram: d }, signals } }, change: `a load step of ${fmt(amplitude)} at the plant's input from ${fmt(time)} s (10 % of u's range)` };
}

// The smooth move (input 55: feedforward "doesn't gain anything on steps"):
// the same r, each step turned into a smooth move by 1/(τs + 1)³ on the wire
// into the Controller (r, ṙ and r̈ continuous), τ so that the move is 99 %
// done in a fifth of the shortest stretch between steps (8.4 τ).
function smoothMove(diagram, path, tau) {
  const d = structuredClone(diagram), lv = level(d, path), id = path.at(-1);
  const w = lv.wires.find((x) => { const t = parseEnd(x.to); return t.id === id && t.port === 0; });
  if (!w) return null;
  lv.blocks.push({ id: 'bench_move', type: 'tf', params: { num: [1], den: [tau ** 3, 3 * tau ** 2, 3 * tau, 1], delay: 0 }, x: 0, y: 0 });
  lv.wires.push({ from: w.from, to: 'bench_move' });
  w.from = 'bench_move';
  return d;
}

// ---- The benchmark ----------------------------------------------------------

// One plant to tune and score on: the loaded diagram, or a changed copy.
// scales: the goal's, fixed from the loaded run, the same for every plant.
function plantOf(project, sc, change = null, tau = null) {
  const ctx = tuneContext(project, null);
  const designStatus = (variant) => { try { return compileDiagram(withVariant(ctx.diagram, ctx.path, variant), 'plant', { standalone: true }).designs.find((x) => x.path === ctx.key); } catch (e) { return { error: e }; } };
  const goalScore = (variant, diagram = null) => {
    const run = diagram ? simulateSystem(withVariant(diagram, ctx.path, variant), ctx.signals, ctx.sim) : runVariant(ctx, variant);
    return { run, cost: runCost(run, ctx.key, GOAL_USED, { scales: sc, variant, others: ctx.others }) };
  };
  // σ for each measurement: 0.5 % of its span in the loaded run, read by a
  // Sink spliced onto each measurement wire.
  const probed = structuredClone(ctx.diagram), plv = level(probed, ctx.path), sigmas = [];
  for (const w of [...plv.wires]) { const t = parseEnd(w.to); if (t.id === ctx.path.at(-1) && t.port >= 1) { plv.blocks.push({ id: `bench_m${t.port}`, type: 'sink', params: { name: `bench_m${t.port}`, unit: '1' }, x: 0, y: 0 }); plv.wires.push({ from: w.from, to: `bench_m${t.port}` }); } }
  const prun = simulateSystem(withVariant(probed, ctx.path, ctx.variant), ctx.signals, ctx.sim);
  for (let k = 1; k < ctx.block.params.inputs; k++) sigmas[k - 1] = 0.005 * span(prun.signals[`bench_m${k}`] ?? []);
  return {
    project, ctx, change, designStatus, goalScore, m: ctx.block.params.inputs - 1,
    noisy: withNoise(ctx.diagram, ctx.path, sigmas),
    move: tau ? smoothMove(ctx.diagram, ctx.path, tau) : null,
    // The same seeds on every plant: blocks a change adds are appended, so
    // the plant's own numbers get the same factors.
    plants: Array.from({ length: SWEEP }, (_, i) => vary(ctx.diagram, 0.15, 101 + i)),
  };
}

function benchmark(name) {
  const T = { load: 0, starts: 0, tune: 0, score: 0, sweep: 0 };
  let t0 = now();
  const loaded = load(name), ctx0 = tuneContext(loaded, null);
  const running = ctx0.variant, rp = running.params;
  const run00 = runVariant(ctx0, running), sc = costScales(run00, ctx0.key, running), R = sc.e, U = sc.u;
  const ls = loopSignals(run00, ctx0.key), nS = ls.t.length, dtS = (ls.t.at(-1) - ls.t[0]) / (nS - 1);
  const steps = []; for (let k = 1; k < nS; k++) if (Math.abs(ls.r[k] - ls.r[k - 1]) > 0.05 * R) steps.push(k);
  // The standard disturbance when the system has none (a copy; same for all).
  const std = withStandardDisturbance(loaded, ctx0, U, steps, nS, dtS);
  const project = std ? std.project : loaded, ctx = tuneContext(project, null), run0 = runVariant(ctx, running);
  // The smooth move: 99 % done in a fifth of the shortest stretch between steps.
  const gaps = steps.slice(1).map((k, i) => k - steps[i]).concat(steps.length ? [nS - steps.at(-1)] : []);
  const tau = steps.length ? (0.2 * Math.min(...gaps) * dtS) / 8.4 : null;
  const P0 = plantOf(project, sc, null, tau);
  const c = {
    m: P0.m, umin: rp.umin, umax: rp.umax, Tr0: rp.Tr ?? 0, dir: 1,
    rLo: Math.min(...ls.r), rHi: Math.max(...ls.r), rSpan: R, tuned: {}, refused: {},
  };
  c.rMid = (c.rLo + c.rHi) / 2;
  c.design = (variant) => P0.designStatus(variant)?.values ?? null;
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

  // The gates a tuned variant must pass to fit (the same as the matrix's
  // Fits row): finite runs on the nominal plant and on every varied one,
  // stable at r's middle and where the run starts, Ms at most MS_MAX.
  const gate = (P, variant) => {
    if (P.goalScore(variant).cost.diverged) return 'diverges on the nominal plant';
    const mg = margins(P.project, P.ctx, variant, c.rMid, P.m);
    if (mg.stable === false) return `unstable at r's middle (${mg.note})`;
    if (mg.startUnstable) return `unstable where the run starts (${mg.startUnstable})`;
    if (mg.ms > MS_MAX) return `Ms ${fmt(mg.ms, 2)}`;
    const bad = P.plants.filter((d) => { try { return P.goalScore(variant, d).cost.diverged; } catch { return true; } }).length;
    return bad ? `diverges on ${bad} of ${SWEEP} varied plants` : '';
  };
  // Geometric blend of two variants of one type: every number that is
  // finite, non-zero and of one sign in both, s^(1−a)·t^a.
  const blend = (sv, tv, a) => {
    const Q = { ...tv.params };
    for (const [k, x] of Object.entries(tv.params)) {
      const y = sv.params[k];
      const mix = (p0, p1) => (finite(p0) && finite(p1) && p0 * p1 > 0 ? Math.sign(p1) * Math.abs(p0) ** (1 - a) * Math.abs(p1) ** a : p1);
      Q[k] = Array.isArray(x) ? x.map((xi, i) => mix(y?.[i], xi)) : mix(y, x);
    }
    return { ...tv, params: Q };
  };

  // One candidate from one start on one plant: its design checked, tuned,
  // backed off until it passes the gates. → a row, or { refused }.
  function tuneOne(P, type, s, h) {
    const def = CONTROLLERS[type], t1 = now(), tune = h.tune ?? GENERIC.tune(type);
    let variant = s.variant, evals = 0, start, how = s.how;
    // A designed type that refuses on this plant: its design's sentence.
    if (def.designed) {
      const st2 = P.designStatus(variant);
      if (!st2?.values) return { refused: st2?.error?.message ?? `its design is ${st2?.status ?? 'missing'}` };
    }
    try { start = P.goalScore(variant).cost.J; evals++; } catch (e) { return { refused: e.message }; }
    if (tune === 'iterate') {
      try {
        const r = drain(iterate(placed(P.project, P.ctx, variant), P.ctx.path, GOAL_USED, { maxIter: MAX_ITER }));
        if (r.best.cost.J < start) variant = r.best.variant;
        evals += r.evals;
      } catch (e) { how += ` (not iterated: ${e.message.slice(0, 60)})`; }
    } else if (tune === 'knob') {
      // Golden section on log(knob) over ×1/30 … ×30 of the start: the
      // designed type stays designed, only its speed input moves.
      // The cost of both following tests: the system's run and the smooth move.
      const k0 = variant.params[h.knob], f = (x) => { const vv = normalizeVariant({ ...variant, params: { ...variant.params, [h.knob]: k0 * Math.exp(x) } }); evals += 2; try { return P.goalScore(vv).cost.J + (P.move ? P.goalScore(vv, P.move).cost.J : 0); } catch { return Infinity; } };
      const f0 = f(0);
      let a = -Math.log(30), b = Math.log(30), gr = (Math.sqrt(5) - 1) / 2, x1 = b - gr * (b - a), x2 = a + gr * (b - a), f1 = f(x1), f2 = f(x2);
      for (let i = 0; i < 12; i++) { if (f1 < f2) { b = x2; x2 = x1; f2 = f1; x1 = b - gr * (b - a); f1 = f(x1); } else { a = x1; x1 = x2; f1 = f2; x2 = a + gr * (b - a); f2 = f(x2); } }
      const x = f1 < f2 ? x1 : x2, best = Math.min(f1, f2);
      if (best < f0) variant = normalizeVariant({ ...variant, params: { ...variant.params, [h.knob]: k0 * Math.exp(x) } });
      how += `; ${h.knob} searched → ${fmt(variant.params[h.knob])}`;
    }
    // A tuned variant that fails a gate backs off along the way it came:
    // ¾, ½, ¼ of the way from the start, then the start itself. The cost
    // Iterate minimises has no robustness term (the design adds one).
    if (variant !== s.variant && BACKOFF) {
      let why = gate(P, variant);
      if (why) {
        const tried = variant, first = why;
        for (const a of [0.75, 0.5, 0.25, 0]) {
          const cand = a ? blend(s.variant, tried, a) : s.variant;
          why = gate(P, cand); evals++;
          if (!why) { variant = cand; how += `; backed off to ${a * 100} % of the way (tuned: ${first})`; break; }
        }
        if (why) how += `; no point on the way fits (tuned: ${first})`;
      }
    }
    return { type, name: s.name ?? def.label, how, variant, start, evals, tuneMs: now() - t1, P };
  }

  // Types in registry order, each after the row it starts from.
  const order = [];
  const add = (type) => { if (order.includes(type)) return; const after = BENCH[type]?.after; if (after && CONTROLLERS[after]) add(after); order.push(type); };
  for (const type of CONTROLLER_TYPES) add(type);

  const rows = [], refusals = [];
  // The running variant as loaded, scored as it is: what the person has now.
  rows.push({ type: running.type, name: `As loaded: ${running.name}`, how: 'not tuned', variant: running, start: null, evals: 0, loaded: true, P: P0 });

  t0 = now();
  const needsRate = [];
  for (const type of order) {
    const def = CONTROLLERS[type], h = BENCH[type] ?? {};
    const why = h.applies?.(c) ?? '';
    if (why) { refusals.push({ type, label: def.label, why }); c.refused[type] = why; if (h.applies === BENCH.slidingMode?.applies && !needLimits(c)) needsRate.push(type); continue; }
    let starts;
    try { starts = (h.start ?? ((cc) => GENERIC.start(cc, type)))(c); } catch (e) { refusals.push({ type, label: def.label, why: e.message }); c.refused[type] = e.message; continue; }
    for (const s of starts) {
      const row = tuneOne(P0, type, s, h);
      if (row.refused) { refusals.push({ type, label: s.name ?? def.label, why: row.refused }); c.refused[type] = row.refused; continue; }
      rows.push(row);
      if (!(type in c.tuned)) c.tuned[type] = row.variant;
    }
  }

  // Plant changes, never applied: candidates on a changed copy of the plant.
  const changed = [];
  if (needsRate.length && c.m === 1) {
    const ch = addRateObserver(ctx.diagram, ctx.path, Math.max(ctx.Ts, c.tauGuess / 10));
    if (ch) {
      const P = plantOf(withDiagram(project, ch.diagram), sc, ch.change, tau), c2 = { ...c, m: 2 };
      for (const type of needsRate) for (const s of BENCH[type].start(c2)) {
        const row = tuneOne(P, type, s, BENCH[type]);
        if (!row.refused) rows.push({ ...row, name: `${row.name} ⚙ rate observer`, plantChange: ch.change });
      }
      changed.push(ch.change);
    }
  }
  const sensor = sensorForObserver(ctx.diagram, ctx.path, ctx.signals, ctx.sim, running);
  if (sensor) {
    const P = plantOf(withDiagram(project, sensor.diagram), sc, sensor.change, tau);
    // The loaded controller as it is with the sensor (what the sensor alone
    // does), and the PID tuned on the measured signal.
    rows.push({ type: running.type, name: `As loaded ⚙ sensor`, how: 'not tuned', variant: running, start: null, evals: 0, P, plantChange: sensor.change });
    const row = tuneOne(P, 'pid', { variant: c.pidStart.variant, how: c.pidStart.how }, BENCH.pid);
    if (!row.refused) rows.push({ ...row, name: 'PID ⚙ sensor', plantChange: sensor.change });
    changed.push(sensor.change);
  }
  T.tune = now() - t0;

  // Score every row on its own plant: the nominal run, the margins, noise,
  // complexity.
  t0 = now();
  for (const row of rows) {
    const P = row.P, { run, cost } = P.goalScore(row.variant);
    row.J = cost.J; row.diverged = cost.diverged;
    Object.assign(row, cost.diverged ? {} : runScores(run, P.ctx.key, P.ctx.others, R, U, row.variant));
    row.margins = margins(P.project, P.ctx, row.variant, c.rMid, P.m);
    row.ms = row.margins.ms ?? null;
    let moveRun = null;
    if (P.move && !cost.diverged) {
      moveRun = P.goalScore(row.variant, P.move);
      row.move = moveRun.cost.diverged ? Infinity : moveScore(moveRun.run, P.ctx.key, P.ctx.others, R, steps);
    }
    // The feedforward's share of u, on the steps and on the smooth move.
    const twin = CONTROLLERS[row.variant.type].designed && CONTROLLERS[row.variant.type].manual ? CONTROLLERS[row.variant.type].manual(row.variant.params, designValues(row.variant)) : row.variant;
    if (twin?.type === 'pid' && (twin.params.Kff || twin.params.Kv || twin.params.Ka) && !cost.diverged) {
      row.ffShare = { steps: ffShare(run, P.ctx.key, twin.params, P.ctx.Ts), move: moveRun ? ffShare(moveRun.run, P.ctx.key, twin.params, P.ctx.Ts) : null, Kff: twin.params.Kff, Kv: twin.params.Kv, Ka: twin.params.Ka, Tr: twin.params.Tr };
    }
    if (!cost.diverged) {
      const nr = simulateSystem(withVariant(P.noisy, P.ctx.path, row.variant), P.ctx.signals, P.ctx.sim);
      const a = loopSignals(nr, P.ctx.key).u, b = loopSignals(run, P.ctx.key).u;
      let s2 = 0; for (let k = 0; k < a.length; k++) s2 += (a[k] - b[k]) ** 2;
      row.noise = Math.sqrt(s2 / a.length) / U;
    }
    row.complex = complexity(row.variant, P.m) + (row.plantChange ? PLANT_CHANGE : 0);
    row.effortTune = row.evals;
  }
  T.score = now() - t0;

  // The robustness sweep: SWEEP seeded plants within ±15 %.
  t0 = now();
  for (const row of rows) {
    if (row.diverged) continue;
    let worst = 0, bad = 0;
    for (const d of row.P.plants) {
      let J;
      try { J = row.P.goalScore(row.variant, d).cost; } catch { J = { J: 200, diverged: true }; }
      if (J.diverged) bad++;
      worst = Math.max(worst, J.J);
    }
    row.vary = worst; row.varyBad = bad;
  }
  T.sweep = now() - t0;

  // Fit: stable and finite in the nominal run and in every varied plant.
  for (const row of rows) {
    row.fits = !row.diverged && !row.varyBad && row.margins.stable !== false && !row.margins.startUnstable;
    row.whyNot = row.diverged ? 'diverges on the nominal plant' : row.varyBad ? `diverges on ${row.varyBad} of ${SWEEP} plants within ±15 %` : row.margins.stable === false ? `unstable at r's middle (${row.margins.note})` : row.margins.startUnstable ? `unstable where the run starts (${row.margins.startUnstable}); it rests there only because it starts in balance` : '';
  }
  return { name: project.title, rows, refusals, changed, T, standard: std?.change ?? null, tau, step: st?.ok ? `${st.method === 'relay' ? 'relay' : st.model}` : st?.why, R, U };
}

// ---- The decision: the generic Pugh module ----------------------------------
// The marks, the gates on the main job and on Ms, the datum, the ranking and
// the weight sensitivity are src/core/pugh.js (design/output/pugh.md): the
// benchmark hands it a matrix of measured numbers and reads the result.

const JOB_MAX = 2, STEP = 1;
function matrixOf(b) {
  const keyOf = (i) => `c${i}`;
  const pid = b.rows.findIndex((r) => r.type === 'pid' && !r.loaded && !r.plantChange), loadedRow = b.rows.findIndex((r) => r.loaded);
  return {
    title: b.name,
    criteria: CRITERIA.map((cr) => ({ key: cr.key, label: cr.label, weight: cr.w, better: 'lower', tolerance: cr.tol, floor: cr.abs })),
    candidates: b.rows.map((r, i) => ({
      key: keyOf(i), label: r.name,
      values: Object.fromEntries(CRITERIA.filter((cr) => typeof r[cr.key] === 'number').map((cr) => [cr.key, r[cr.key]])),
      fits: r.fits, whyNot: r.whyNot, suggestable: !r.plantChange, keep: !!r.loaded, tieBreak: r.J,
    })),
    // The main job against the datum (input 55) and the Ms bound.
    gates: [...CRITERIA.filter((cr) => cr.job).map((cr) => ({ criterion: cr.key, maxRatio: JOB_MAX, why: 'fails the main job' })), { criterion: 'ms', max: MS_MAX, why: "fragile, at r's middle" }],
    // The tuned PID (input 48); the running variant when the PID does not fit.
    datum: { prefer: [pid, loadedRow].filter((i) => i >= 0).map(keyOf) },
    sensitivity: { step: STEP, draws: 4000, seed: 55, robustShare: 0.75, runnersUp: 3 },
  };
}

// ---- Output ---------------------------------------------------------------

const out = [];
const results = [];
for (const name of SYSTEMS) {
  const t0 = now();
  const b = benchmark(name);
  const total = now() - t0;
  results.push(b);
  const res = decide(matrixOf(b));
  const byKey = Object.fromEntries(res.candidates.map((c) => [c.key, c]));
  b.rows.forEach((row, i) => { const c = byKey[`c${i}`]; row.fits = c.fits; row.whyNot = c.whyNot; });
  const datum = b.rows[Number(res.datum.key.slice(1))];
  const w = res.weights;
  const marks = b.rows.map((_, i) => CRITERIA.map((cr) => byKey[`c${i}`].marks[cr.key]));
  const totals = b.rows.map((_, i) => byKey[`c${i}`].total);
  const order = res.ranking.map((k) => Number(k.slice(1)));
  const pos = (v) => `${v >= 0 ? '+' : ''}${fmt(v, 3)}`;
  const best = res.suggestion ? Number(res.suggestion.key.slice(1)) : undefined;
  const above = res.suggestion ? res.suggestion.above.map((k) => Number(k.slice(1))) : [];
  const eligible = order.filter((k) => !b.rows[k].plantChange);

  out.push(`\n## ${b.name}\n`);
  out.push(`Step test for the starts: ${b.step}. Total ${(total / 1000).toFixed(1)} s: load ${fmt(b.T.load / 1000)} s, starts ${fmt(b.T.starts / 1000)} s, tuning ${fmt(b.T.tune / 1000)} s, scoring ${fmt(b.T.score / 1000)} s, sweep (${SWEEP} plants) ${fmt(b.T.sweep / 1000)} s. One run ${fmt(b.T.run, 2)} ms, so about ${Math.round(total / b.T.run)} runs' worth.\n`);
  out.push(`Tests: the system's own input${b.standard ? `, plus the standard disturbance (it has none of its own): ${b.standard}` : ' (its own disturbance plays)'}; ${b.tau ? `the smooth move: r through 1/(τs + 1)³, τ = ${fmt(b.tau, 3)} s` : 'no smooth move (r has no steps to smooth)'}.\n`);
  out.push('Refused:\n');
  for (const r of b.refusals) out.push(`- ${r.label} (\`${r.type}\`): ${r.why}`);
  if (b.changed.length) { out.push('\nPlant changes scored (⚙, never applied; complexity +5):\n'); for (const ch of b.changed) out.push(`- ${ch}`); }
  out.push('\nCandidates (J: the goal\'s cost on the system\'s run, IAE + effort + overshoot + saturation; start → tuned):\n');
  out.push('| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |');
  out.push('|---|---|---|---|---|---|');
  for (const r of b.rows) out.push(`| ${r.name} | ${r.how} | ${r.start === null ? '' : `${fmt(r.start)} → `}${fmt(r.J)} | ${r.evals} | ${fmt(r.tuneMs ?? 0, 2)} | ${r.fits ? 'yes' : `no: ${r.whyNot}`} |`);
  out.push('\nScores:\n');
  out.push(`| Candidate | ${CRITERIA.map((c) => c.label).join(' | ')} | PM ° | Delay margin |`);
  out.push(`|---|${CRITERIA.map(() => '---').join('|')}|---|---|`);
  for (const r of b.rows) out.push(`| ${r.name} | ${CRITERIA.map((c) => (c.key === 'over' ? `${fmt(r[c.key], 2)} %` : c.key === 'ms' && r[c.key] === null ? (r.margins.none ? 'no linear model' : r.margins.stable === false ? 'unstable' : '—') : fmt(r[c.key], 2))).join(' | ')} | ${fmt(r.margins.pm, 2)} | ${r.margins.dm !== undefined ? `${fmt(r.margins.dm * 1000, 2)} ms` : '—'} |`);
  const ffRows = b.rows.filter((r) => r.ffShare);
  if (ffRows.length) {
    out.push('\nThe feedforward\'s share of the effort (Σ|ff| / (Σ|ff| + Σ|u − ff|)):\n');
    for (const r of ffRows) out.push(`- ${r.name} (Kff ${fmt(r.ffShare.Kff)}, Kv ${fmt(r.ffShare.Kv)}, Ka ${fmt(r.ffShare.Ka)}, prefilter Tr ${fmt(r.ffShare.Tr)} s): ${fmt(100 * r.ffShare.steps, 2)} % on the system's steps, ${r.ffShare.move === null ? '—' : `${fmt(100 * r.ffShare.move, 2)} %`} on the smooth move; following IAE ${fmt(r.track, 2)} (steps), ${fmt(r.move, 2)} (move), against the datum's ${fmt(datum.track, 2)} and ${fmt(datum.move, 2)}.`);
  }
  out.push(`\nPugh matrix: datum **${datum.name}**${datum.fits ? '' : ' (does not fit, but no fitting PID or loaded variant to take its place)'}; five-point marks (++ +2, + +1, S 0, − −1, −− −2, ? not judged); weights ${w.join(', ')}.\n`);
  out.push(`| Criterion (weight) | ${b.rows.map((r) => r.name.replace('As loaded', 'Loaded')).join(' | ')} |`);
  out.push(`|---|${b.rows.map(() => ':-:').join('|')}|`);
  CRITERIA.forEach((cr, i) => out.push(`| ${cr.label} (${cr.w}) | ${marks.map((m, k) => (b.rows[k] === datum ? 'D' : m[i] === null ? '?' : SYMBOL[m[i]])).join(' | ')} |`));
  out.push(`| **Weighted** | ${totals.map((t, k) => (b.rows[k] === datum ? '0' : pos(t))).join(' | ')} |`);
  out.push(`| **Fits** | ${b.rows.map((r) => (r.fits ? 'yes' : 'no')).join(' | ')} |`);
  out.push(`\nRanking (fitting only): ${order.map((k, i) => `${i + 1}. ${b.rows[k].name} (${pos(totals[k])})`).join('; ')}.`);
  const noFit = b.rows.filter((r) => !r.fits).map((r) => `${r.name}: ${r.whyNot}`);
  if (noFit.length) out.push(`\nNot ranked: ${noFit.join('; ')}.`);
  out.push(`\nSuggestion: ${best === undefined ? 'none fits' : b.rows[best].loaded ? `keep **${b.rows[best].name.replace('As loaded: ', '')}**, the running variant: nothing beats it` : `**${b.rows[best].name}** (${pos(totals[best])}), added as a variant, not switched on`}${above.length ? `; ranked above it with a plant change: ${above.map((k) => `${b.rows[k].name} (${pos(totals[k])}; ${b.rows[k].plantChange})`).join('; ')}` : ''}.`);
  // Reverse sensitivity, from the module.
  const sv = res.sensitivity;
  if (sv) {
    out.push(`\nWeight sensitivity (winner ${b.rows[eligible[0]].name}; reasonable: each weight within ±${STEP} of its default): **${sv.verdict}**. It wins ${fmt(100 * sv.share, 3)} % of ${sv.draws} weight draws within one step.`);
    for (const ru of sv.runnersUp) {
      const f = ru.tie, mc = ru.minChange, label = (k) => CRITERIA.find((cr) => cr.key === k)?.label;
      out.push(`- ${ru.label} (${pos(ru.total)}, wins ${fmt(100 * ru.share, 3)} % of draws): ${f ? (f.now ? 'tied now: the same total, J breaks the tie' : `ties if ${label(f.criterion)} goes ${fmt(f.from, 3)} → ${fmt(f.to, 3)} (${f.reasonable ? 'reasonable' : 'not reasonable'})`) : 'no single weight makes it tie'}; ${mc ? `all weights together: ${fmt(100 * mc.rel, 2)} % of the weights' size, the largest single change ${fmt(mc.maxStep, 2)}` : 'no weights make it tie'}.`);
    }
  }
}
const text = `# Benchmark prototype: results\n\nGoal: ${JSON.stringify(GOAL_USED)}; Iterate up to ${MAX_ITER} iterations; sweep ${SWEEP} plants within ±15 %. Node ${process.version}.\n${out.join('\n')}\n`;
console.log(text);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(results.map((b) => ({ name: b.name, T: b.T, refusals: b.refusals, changed: b.changed, rows: b.rows.map(({ P, ...r }) => r) })), null, 1));
