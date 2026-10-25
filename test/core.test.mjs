import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeProject, evaluateCandidate, evaluateProject } from '../src/core/project.js';
import { computeMetrics } from '../src/core/metrics.js';
import { runTune } from '../src/core/tune.js';
import { EXAMPLES } from '../src/core/examples.js';
import { buildHtml, bundleScript } from '../build.mjs';
import { referenceFn, normalizeReference, parseWaveform } from '../src/core/signals.js';
import { referenceTrace, autoTimebase, simOf, fitChannel } from '../src/core/project.js';
import { DEFAULT_PROJECT } from '../src/core/examples.js';

const loopProject = (system, controller, sim = { duration: 10, sampleTime: 0.01 }, goal) =>
  normalizeProject({ sim, system: { reference: { type: 'step', params: { amplitude: 1, time: 0 } }, ...system }, goal, candidates: [{ name: 'c', controller }] });
const run = (p) => evaluateCandidate(p, p.candidates[0]);

test('P control of a first-order plant settles at Kp K / (1 + Kp K)', () => {
  const p = loopProject({ plant: { type: 'firstOrder', params: { K: 1, tau: 1 } } }, { type: 'P', params: { Kp: 1 } }, { duration: 5, sampleTime: 0.01 });
  const { result, metrics } = run(p);
  assert.ok(Math.abs(result.y.at(-1) - 0.5 * (1 - Math.exp(-10))) < 1e-4);
  assert.ok(Math.abs(metrics.steadyStateError - 50) < 0.1);
});

test('dead time delays the response', () => {
  const p = loopProject({ plant: { type: 'fopdt', params: { K: 1, tau: 1, delay: 1 } } }, { type: 'P', params: { Kp: 0.5 } });
  const { result } = run(p);
  assert.equal(result.y[90], 0);
  assert.ok(result.y[150] > 0.05);
});

test('overshoot of a second-order step matches exp(−ζπ/√(1−ζ²))', () => {
  const zeta = 0.3, wn = 2, dt = 0.001, n = 10001;
  const t = new Float64Array(n), y = new Float64Array(n), r = new Float64Array(n), z = new Float64Array(n);
  const wd = wn * Math.sqrt(1 - zeta * zeta);
  for (let k = 0; k < n; k++) {
    t[k] = k * dt;
    r[k] = k >= 1000 ? 1 : 0;
    const s = t[k] - 1;
    y[k] = s < 0 ? 0 : 1 - Math.exp(-zeta * wn * s) * (Math.cos(wd * s) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * s));
  }
  const e = r.map((v, k) => v - y[k]);
  const m = computeMetrics({ t, r, y, u: z, v: z, e, d: z, info: { unstable: false } });
  assert.ok(Math.abs(m.overshoot - 100 * Math.exp(-zeta * Math.PI / Math.sqrt(1 - zeta * zeta))) < 0.05);
  assert.ok(Math.abs(m.peakTime - Math.PI / wd) < 0.01);
});

test('PI with actuator saturation removes the error and respects the limits', () => {
  const p = loopProject(
    { plant: { type: 'firstOrder', params: { K: 1, tau: 2 } }, actuator: { type: 'saturation', params: { uMin: -1.2, uMax: 1.2 } } },
    { type: 'PI', params: { Kp: 5, Ki: 5 } }, { duration: 20, sampleTime: 0.01 });
  const { result, metrics } = run(p);
  assert.ok(Math.max(...result.u) <= 1.2 + 1e-12);
  assert.ok(metrics.steadyStateError < 0.1);
  assert.ok(metrics.saturation > 0);
});

test('an unstable loop is flagged and infeasible', () => {
  const p = loopProject({ plant: { type: 'lagChain', params: { K: 1, tau: 1, n: 3 } } }, { type: 'P', params: { Kp: 20 } }, { duration: 200, sampleTime: 0.01 });
  const { metrics, evaluation } = run(p);
  assert.equal(metrics.unstable, true);
  assert.equal(evaluation.feasible, false);
});

test('auto-tune finds a feasible PID for the third-order example and is reproducible', () => {
  const p = normalizeProject(EXAMPLES[0]);
  const start = p.candidates.find((c) => c.name === 'Detuned PID');
  const a = runTune(p, start, { maxEvals: 200 });
  const b = runTune(p, start, { maxEvals: 200 });
  assert.equal(a.best.evaluation.feasible, true);
  assert.ok(a.best.evaluation.score < evaluateCandidate(p, start).evaluation.score);
  assert.deepEqual(a.best.params, b.best.params);
});

test('every example evaluates', () => {
  for (const ex of EXAMPLES) {
    const { runs } = evaluateProject(normalizeProject(ex));
    assert.ok(runs.every((r) => !r.metrics.unstable), ex.title);
  }
});

test('bad input fails with the valid choices named', () => {
  assert.throws(() => normalizeProject({ system: { plant: { type: 'nope' } } }), /types: .*firstOrder/);
  assert.throws(() => normalizeProject({ goal: { minimize: { speed: 1 } } }), /unknown metric "speed"/);
  assert.throws(() => normalizeProject({ candidates: [{ controller: { type: 'PID', params: { Kp: 'x' } } }] }), /Kp: expected a number/);
});

test('the bundle parses and the CLI round-trips a project through HTML', () => {
  assert.doesNotThrow(() => new Function(bundleScript()));
  const dir = mkdtempSync(join(tmpdir(), 'lt-'));
  const json = join(dir, 'p.json'), html = join(dir, 'p.html');
  execFileSync('node', ['cli.mjs', 'new', '--example', '0', '-o', json]);
  execFileSync('node', ['cli.mjs', 'try', json, '--from', 'P only', '--set', 'Kp=2', '--name', 'P2', '--save']);
  execFileSync('node', ['cli.mjs', 'html', json, '-o', html]);
  assert.ok(readFileSync(html, 'utf8').includes('"P2"'));
  const out = JSON.parse(execFileSync('node', ['cli.mjs', 'eval', html, '--json']).toString());
  assert.ok(out.candidates.some((c) => c.name === 'P2' && c.controller.params.Kp === 2));
  assert.ok(buildHtml({ fragment: true }).startsWith('<title>'));
});

test('the reference is the sum of its enabled components', () => {
  const ref = normalizeReference({ period: 10, components: [
    { type: 'step', params: { amplitude: 1, time: 0.1 } },
    { type: 'ramp', params: { amplitude: 0.5, time: 0.4, rise: 0.5 } },
    { type: 'dc', params: { level: 9 }, enabled: false },
  ] });
  const r = referenceFn(ref, { sampleTime: 0.001 });
  assert.equal(r(0.05), 0);
  assert.equal(r(0.2), 1);
  assert.ok(Math.abs(r(0.65) - 1.25) < 1e-12);
  assert.equal(r(2), 1.5);
});

test('noise is reproducible and an arbitrary waveform interpolates its points', () => {
  const ref = normalizeReference({ components: [{ type: 'noise', params: { std: 1, seed: 3 } }] });
  const a = referenceFn(ref, { sampleTime: 0.01 }), b = referenceFn(ref, { sampleTime: 0.01 });
  assert.equal(a(0.537), b(0.537));
  assert.equal(a(0.531), a(0.539));
  const pts = parseWaveform('time,value\n0,0\n1,2\n2,2\n');
  const arb = referenceFn(normalizeReference({ period: 10, components: [{ type: 'arb', params: { gain: 2, shift: 0 }, points: pts }] }), { sampleTime: 0.01 });
  assert.equal(arb(0.5), 2);
  assert.equal(arb(5), 4);
});

test('a new project is the reference alone; a v1 file still loads with its loop', () => {
  const p = normalizeProject(structuredClone(DEFAULT_PROJECT));
  assert.equal(p.system.plant.type, 'diagram');
  assert.throws(() => evaluateCandidate(p, { controller: { type: 'P', params: { Kp: 1 } } }), /Out block/);
  const { r } = referenceTrace(p);
  assert.equal(r[0], 0);
  assert.equal(r[r.length - 1], 1);
  const v1 = normalizeProject(EXAMPLES[0]);
  assert.equal(v1.system.signals.r.components[0].type, 'step');
  assert.equal(v1.system.plant.type, 'lagChain');
  assert.equal(v1.scope.channels[0].source, 'r');
});

test('the reference repeats with its period; Auto Scale shows one period', () => {
  const ref = normalizeReference({ period: 1, components: [{ type: 'step', params: { amplitude: 1, time: 0.1 } }] });
  const r = referenceFn(ref, { sampleTime: 0.001 });
  assert.equal(r(1), 1);
  assert.equal(r(1.05), 0);
  assert.equal(r(1.15), 1);
  const p = normalizeProject({ system: { signals: { r: { period: 3.2, components: [] } } } });
  assert.deepEqual(autoTimebase(p), { scale: 0.5, position: 0 });
  assert.equal(simOf(p).duration, 5);
  assert.deepEqual(fitChannel([0, 1]), { scale: 0.2, offset: -0.6 });
});

test('square counts its pulses; a formula is parsed, never evaluated as code', async () => {
  const { compileExpr } = await import('../src/core/expr.js');
  const sq = referenceFn(normalizeReference({ period: 10, components: [{ type: 'square', params: { amplitude: 2, time: 1, width: 0.5, period: 1, count: 2 } }] }), { sampleTime: 0.01 });
  assert.deepEqual([0.5, 1.2, 1.7, 2.2, 3.2].map(sq), [0, 2, 0, 2, 0]);
  const legacyPulse = normalizeReference({ period: 10, components: [{ type: 'pulse', params: { amplitude: 1, time: 0.1, width: 0.2 } }] });
  assert.equal(legacyPulse.components[0].type, 'square');
  assert.equal(compileExpr('2t + 3(t-1)^2')(2), 7);
  assert.equal(compileExpr('0.5*sin(2*pi*t)')(0.25), 0.5);
  assert.throws(() => compileExpr('process.exit(1)'), /unexpected|unknown name/);
  assert.throws(() => compileExpr('constructor'), /unknown name/);
  assert.throws(() => compileExpr('sin(t'), /expected "\)"/);
  const fn = referenceFn(normalizeReference({ period: 10, components: [{ type: 'fn', params: {}, expr: 'step(t-1)*t' }] }), { sampleTime: 0.01 });
  assert.equal(fn(0.5), 0);
  assert.equal(fn(2), 2);
});

test('a diagram plant matches its single-block equivalent, nested or not', async () => {
  const { EXAMPLE_PLANTS } = await import('../src/core/plants.js');
  const { simulateSystem } = await import('../src/core/sim.js');
  const { normalizeDiagram } = await import('../src/core/diagram.js');
  const signals = { r: normalizeReference({ period: 10, components: [{ type: 'step', params: { amplitude: 1, time: 0 } }] }) };
  const sim = { duration: 2, sampleTime: 0.001 };
  const msdOut = simulateSystem(normalizeDiagram(EXAMPLE_PLANTS.find((p) => p.name.startsWith('Mass')).diagram), { F: signals.r }, sim).signals;
  const msd = msdOut.x;
  const so = simulateSystem(normalizeDiagram({ blocks: [{ id: 'r', type: 'source', params: { signal: 'r' } }, { id: 'p', type: 'secondOrder', params: { K: 1 / 25, wn: 5, zeta: 0.05 } }, { id: 'y1', type: 'sink', params: { name: 'y1' } }], wires: [{ from: 'r', to: 'p' }, { from: 'p', to: 'y1' }] }), signals, sim).signals.y1;
  for (const k of [100, 500, 1000, 2000]) assert.ok(Math.abs(msd[k] - so[k]) < 1e-6, `t = ${k / 1000}: ${msd[k]} vs ${so[k]}`);
  // The Function blocks: energies ½mv² and ½kx² from the same run.
  for (const k of [300, 1200]) {
    assert.ok(Math.abs(msdOut.Ekin[k] - 0.5 * msdOut.v[k] ** 2) < 1e-12);
    assert.ok(Math.abs(msdOut.Epot[k] - 12.5 * msd[k] ** 2) < 1e-12);
  }
  // The motor with its controller off and 1 V in place of it: steady speed
  // per volt Kt·10 / (1 + Ke·Kt·10) = 5 / 3.5, through the nested Motor.
  const motorSys = structuredClone(EXAMPLE_PLANTS.find((p) => p.name.startsWith('DC motor')).diagram);
  motorSys.blocks.find((b) => b.type === 'controller').variant = 3;
  motorSys.blocks.push({ id: 'one', type: 'source', params: { signal: 'one' } });
  motorSys.wires = motorSys.wires.map((w) => (w.from === 'ctrl' && w.to === 'motor' ? { from: 'one', to: 'motor' } : w));
  const motor = simulateSystem(normalizeDiagram(motorSys), { one: signals.r }, sim).signals;
  assert.ok(Math.abs(motor.speed[2000] - 5 / 3.5) < 1e-3);
  assert.ok(motor.angle[2000] > 2);
});

test('an algebraic loop is refused; an empty diagram shows the reference alone', async () => {
  const { compileDiagram, normalizeDiagram } = await import('../src/core/diagram.js');
  const loop = normalizeDiagram({
    blocks: [{ id: 'r', type: 'source', params: { signal: 'r' } }, { id: 's', type: 'sum', params: { signs: '+-' } }, { id: 'g', type: 'gain', params: { K: 2 } }, { id: 'y1', type: 'sink', params: { name: 'y1' } }],
    wires: [{ from: 'r', to: 's' }, { from: 's', to: 'g' }, { from: 'g', to: 's:1' }, { from: 'g', to: 'y1' }],
  });
  assert.throws(() => compileDiagram(loop, 'plant', { standalone: true, sources: { r: () => 1 } }), /algebraic loop/);
  const p = normalizeProject(structuredClone(DEFAULT_PROJECT));
  const { evaluateSystem } = await import('../src/core/project.js');
  const sys = evaluateSystem(p);
  assert.deepEqual(Object.keys(sys.signals), ['r']);
  assert.equal(sys.signals.r[sys.signals.r.length - 1], 1);
});

test('the cart-pole falls the right way at the right rate; sensor blocks behave', async () => {
  const { simulateSystem } = await import('../src/core/sim.js');
  const { normalizeDiagram } = await import('../src/core/diagram.js');
  const d = normalizeDiagram({
    blocks: [{ id: 'r', type: 'source', params: { signal: 'r' } }, { id: 'cp', type: 'cartPole', params: { M: 1, m: 0.2, l: 0.5, b: 0, theta0: 0.001 } },
      { id: 'x', type: 'sink', params: { name: 'x' } }, { id: 'th', type: 'sink', params: { name: 'th' } }],
    wires: [{ from: 'r', to: 'cp' }, { from: 'cp', to: 'x' }, { from: 'cp:1', to: 'th' }],
  });
  const zero = { r: normalizeReference({ period: 10, components: [] }) };
  const { signals } = simulateSystem(d, zero, { duration: 0.5, sampleTime: 0.001 });
  // Linearised: θ'' = g (M + m) / (M l) θ, so θ grows like cosh(λt).
  const lam = Math.sqrt(9.81 * 1.2 / 0.5);
  assert.ok(Math.abs(signals.th[500] / (0.001 * Math.cosh(lam * 0.5)) - 1) < 0.02);
  assert.ok(signals.x[500] < 0, 'the cart moves away from the fall');
  const q = normalizeDiagram({ blocks: [{ id: 'r', type: 'source', params: { signal: 'r' } }, { id: 'q', type: 'quantizer', params: { q: 0.25 } }, { id: 'y1', type: 'sink', params: { name: 'y1' } }], wires: [{ from: 'r', to: 'q' }, { from: 'q', to: 'y1' }] });
  const ramp = { r: normalizeReference({ period: 10, components: [{ type: 'ramp', params: { amplitude: 1, time: 0, rise: 1 } }] }) };
  const out = simulateSystem(q, ramp, { duration: 1, sampleTime: 0.01 }).signals.y1;
  assert.equal(out[40], 0.5);
  assert.equal(out[60], 0.5);
});

test('2D views compile and move with the signals; library parts combine', async () => {
  const { SYSTEM_LIBRARY, applySystem } = await import('../src/core/systems.js');
  const { compileScene } = await import('../src/core/views.js');
  const pend = SYSTEM_LIBRARY.find((s) => s.name === 'Pendulum swing-up');
  const p = normalizeProject(applySystem(structuredClone(DEFAULT_PROJECT), pend, ['input', 'plant', 'controller']));
  assert.equal(p.title, 'Pendulum swing-up');
  const scene = compileScene(p.system.plant.views[0]);
  const bob = (th) => scene({ t: 0, F: 0, d: 0, r: 0, x: 0, theta: th }).find((o) => o.op === 'circle' && o.fill === 'ch3').c;
  assert.ok(Math.abs(bob(0)[0]) < 1e-12 && Math.abs(bob(0)[1] - 0.6) < 1e-12);
  assert.ok(bob(0.3)[0] > 0.1, 'positive θ leans towards +x');
  const msd = SYSTEM_LIBRARY.find((s) => s.name === 'Mass–spring–damper');
  const motorSys = SYSTEM_LIBRARY.find((s) => s.name.startsWith('DC motor'));
  const mixed = normalizeProject(applySystem(normalizeProject(applySystem(DEFAULT_PROJECT, motorSys, ['input', 'plant'])), SYSTEM_LIBRARY.find((s) => s.name.startsWith('Triple')), ['plant']));
  assert.equal(mixed.system.signals.r.components[0].type, 'square', 'the input stays from the motor');
  assert.equal(mixed.system.plant.views[0].name, 'Cart and triple pendulum');
  assert.deepEqual(mixed.scope.channels.map((c) => c.source), ['r', '', '', 'd'], 'a whole load brings the system scope; a plant load keeps what still exists');
  assert.ok(SYSTEM_LIBRARY.every((s) => s.plant.views?.length || s.scope?.view?.mode), 'every system has a view, or opens the scope in a frequency view');
  const { loopReady } = await import('../src/core/project.js');
  const fromLoop = normalizeProject(applySystem(EXAMPLES[0], msd, ['input', 'plant']));
  assert.equal(fromLoop.candidates.length, 0, 'a whole load leaves no controller of an older project behind');
  assert.equal(loopReady({ ...fromLoop, candidates: EXAMPLES[0].candidates }), false, 'a diagram with its own Sources is never run as a loop plant');
  assert.ok(SYSTEM_LIBRARY.every((s) => s.ui?.run === 'run' && (!s.ui.view || s.plant.views.some((v) => v.name === s.ui.view))), 'every system opens running, on a view it has');
  assert.equal(SYSTEM_LIBRARY.find((s) => s.name.includes('badly tuned'))?.ui.tab, 'tune', 'the system made for Auto-tune opens on that tab');
  assert.deepEqual(p.ui, { run: 'run', tab: 'plant', setup: 0.42, view: 'Cart and pole' }, 'a whole load brings how the system opens');
  assert.deepEqual(normalizeProject({ ui: { run: 'fast', tab: 'plant', extra: 1 } }).ui, { tab: 'plant' }, 'unknown ui values are dropped');
  assert.throws(() => normalizeProject({ system: { plant: { type: 'diagram', diagram: { blocks: [], wires: [] }, views: [{ kind: '2d', shapes: [{ type: 'line', x1: 'sin(' }] }] } } }), /views\[0\]/);
});

test('a switch passes its chosen input; a terminator ends a signal; SVG views bind safely', async () => {
  const { simulateSystem } = await import('../src/core/sim.js');
  const { normalizeDiagram } = await import('../src/core/diagram.js');
  const { normalizeView, compileBindings } = await import('../src/core/views.js');
  const d = (position) => normalizeDiagram({
    blocks: [{ id: 'r', type: 'source', params: { signal: 'r' } }, { id: 'k', type: 'gain', params: { K: 3 } }, { id: 'sw', type: 'switch', params: { inputs: 2, position } },
      { id: 'y1', type: 'sink', params: { name: 'y1' } }, { id: 'end', type: 'terminator' }],
    wires: [{ from: 'r', to: 'sw' }, { from: 'r', to: 'k' }, { from: 'k', to: 'sw:1' }, { from: 'sw', to: 'y1' }, { from: 'k', to: 'end' }],
  });
  const sig = { r: normalizeReference({ period: 10, components: [{ type: 'dc', params: { level: 2 } }] }) };
  const run = (pos) => simulateSystem(d(pos), sig, { duration: 0.1, sampleTime: 0.01 });
  assert.equal(run(1).signals.y1[5], 2);
  assert.equal(run(2).signals.y1[5], 6);
  assert.deepEqual(Object.keys(run(2).signals).sort(), ['r', 'y1']);
  const v = normalizeView({ kind: 'svg', svg: '<svg viewBox="0 0 10 10"><rect id="m" width="1" height="1"/></svg>', bind: [{ select: '#m', attr: 'transform', value: 'translate({100*y1}, 0)' }] });
  assert.deepEqual(compileBindings(v)({ t: 0, y1: 0.02 }), [{ select: '#m', attr: 'transform', value: 'translate(2, 0)' }]);
  assert.throws(() => normalizeView({ kind: 'svg', svg: '<svg/>', bind: [{ select: '#m', attr: 'onclick', value: 'x' }] }), /not an event/);
});

test('only what the diagram names exists: signals and channels are pruned, units are kept', async () => {
  const { channelNames } = await import('../src/core/project.js');
  const p = normalizeProject({
    system: {
      signals: { r: { period: 1, components: [] }, stale: { period: 1, components: [] } },
      plant: { type: 'diagram', diagram: { blocks: [{ id: 'r', type: 'source', params: { signal: 'r', unit: 'N' } }, { id: 'y1', type: 'sink', params: { name: 'y1', unit: 'm' } }], wires: [{ from: 'r', to: 'y1' }] } },
    },
    scope: { channels: [{ source: 'r', on: true }, { source: 'y1', on: true }, { source: 'u', on: true }, { source: 'gone', on: true }] },
  });
  assert.deepEqual(Object.keys(p.system.signals), ['r']);
  assert.deepEqual(channelNames(p), ['r', 'y1']);
  assert.deepEqual(p.scope.channels.map((c) => `${c.source}:${c.on}`), ['r:true', 'y1:true', ':false', ':false']);
  const { diagramNames } = await import('../src/core/diagram.js');
  assert.deepEqual(diagramNames(p.system.plant.diagram).units, { r: 'N', y1: 'm' });
});

test('controllers: the variants of every system run; the good ones control, the bad ones show why', async () => {
  const { SYSTEM_LIBRARY, applySystem } = await import('../src/core/systems.js');
  const { evaluateSystem, autoTimebase } = await import('../src/core/project.js');
  const run = (name, variant) => {
    const p = normalizeProject(applySystem(DEFAULT_PROJECT, SYSTEM_LIBRARY.find((s) => s.name.startsWith(name)), ['input', 'plant']));
    p.scope.timebase = autoTimebase(p);
    const c = p.system.plant.diagram.blocks.find((b) => b.type === 'controller');
    c.variant = c.variants.findIndex((v) => v.name === variant);
    assert.ok(c.variant >= 0, variant);
    const res = evaluateSystem(p);
    const at = (sig, t) => res.signals[sig][Math.round((t / 5) * (res.signals[sig].length - 1))];
    at.all = (sig) => res.signals[sig];
    at.designs = res.info.designs;
    return at;
  };
  const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
  // Motor: the aggressive P overshoots 2 rad by more than 15 %; PD does not.
  const pAgg = run('DC motor', 'P, too aggressive'), pd = run('DC motor', 'PD');
  const peak = (f) => Math.max(...Array.from({ length: 100 }, (_, i) => f('angle', 0.25 + i * 0.0125)));
  assert.ok(peak(pAgg) > 2.3 && peak(pd) < 2.05, `${peak(pAgg)} ${peak(pd)}`);
  assert.ok(Math.abs(pd('angle', 1.4) - 2) < 0.02);
  // Tank: the scheduled PI holds every level; the PI tuned for full rings
  // when the level is low. Its computed u0 balances the outlet exactly, so
  // it rests at 0.15 m until the step to 0.45 m at 1.5 s, then overshoots
  // and swings back below 0.35 m.
  const sched = run('Conical tank', 'Gain-scheduled PI'), full = run('Conical tank', 'PI tuned for full');
  for (const [t, r] of [[1.4, 0.15], [2.15, 0.45], [4.9, 0.8]]) assert.ok(Math.abs(sched('h', t) - r) < 0.03, `h(${t}) = ${sched('h', t)}`);
  const after = (f) => Array.from({ length: 70 }, (_, i) => f('h', 1.5 + i * 0.01));
  const top = (f) => Math.max(...after(f)), dip = (f) => { const v = after(f); return Math.min(...v.slice(v.indexOf(Math.max(...v)))); };
  assert.ok(top(full) > 0.55 && dip(full) < 0.35, `full: peak ${top(full)}, then ${dip(full)}`);
  assert.ok(top(sched) < 0.49, `scheduled: peak ${top(sched)}`);
  // Swing-up: from hanging to upright and held, through the push; LQR alone cannot.
  const up = run('Pendulum', 'Swing-up + LQR catch'), sf = run('Pendulum', 'LQR only');
  for (const t of [2.5, 3.4, 4.9]) assert.ok(Math.abs(wrap(up('theta', t))) < 0.05, `θ(${t}) = ${up('theta', t)}`);
  assert.ok(Math.abs(wrap(sf('theta', 4.9))) > 1);
  // Triple pendulum (test 10): from hanging, the swing-up planned in the
  // page brings all three rods up and holds them through the push at 3.5 s,
  // the cart within 1 m; LQR alone never gets them up.
  const rods = ['theta1', 'theta2', 'theta3'];
  const planned = run('Triple', 'Planned swing-up + TV-LQR'), only = run('Triple', 'LQR only (cannot swing up)');
  assert.equal(planned.designs[0].status, 'ok', JSON.stringify(planned.designs[0].warnings));
  for (const k of rods) assert.ok(Math.abs(Math.abs(wrap(planned(k, 0))) - Math.PI) < 1e-9, `${k} starts hanging`);
  for (const t of [3.4, 4.9]) for (const k of rods) assert.ok(Math.abs(wrap(planned(k, t))) < 0.05, `${k}(${t}) = ${planned(k, t)}`);
  assert.ok(planned.all('x').every((x) => Math.abs(x) < 1), 'the cart stays within 1 m');
  const last = (f) => Math.max(...rods.flatMap((k) => Array.from(f.all(k)).slice(-Math.round(f.all(k).length / 5)).map((v) => Math.abs(wrap(v)))));
  assert.ok(last(only) > 1, `LQR only: the rods within ${last(only)} rad of upright in the last second`);
});

test('controller variants are validated; view captions keep their width', async () => {
  const { normalizeVariant } = await import('../src/core/controllers.js');
  assert.throws(() => normalizeVariant({ type: 'fuzzy' }), /pid, stateFeedback/);
  assert.throws(() => normalizeVariant({ type: 'gainScheduled', params: { at: [0, 1], Kp: [1], Ki: [1, 1] } }), /same number/);
  const v = normalizeVariant({ type: 'pid', params: { Kp: 2, umin: null } });
  assert.equal(v.params.umin, -Infinity);
  assert.equal(JSON.parse(JSON.stringify(v)).params.umin, null, 'an open limit is saved as null and read back as open');
  const { compileScene } = await import('../src/core/views.js');
  const scene = compileScene({ kind: '2d', view: [-1, -1, 1, 1], shapes: [{ type: 'text', x: 0, y: 0, text: 'x = {x:6.2} m' }, { type: 'polygon', points: [[0, 0], [1, 0], ['x', 1]] }] });
  const a = scene({ x: 1.5 }), b = scene({ x: -12.25 });
  assert.equal(a[0].text.length, b[0].text.length);
  assert.equal(b[0].text, 'x = -12.25 m');
  assert.deepEqual(a[1].pts[2], [1.5, 1]);
});

test('library tags: opposite values look different, and a value looks the same on every card', async () => {
  const { SYSTEM_LIBRARY, TAG_TONES, systemTags } = await import('../src/core/systems.js');
  const seen = new Map();
  for (const e of SYSTEM_LIBRARY) {
    for (const t of e.tags) {
      assert.ok(TAG_TONES.includes(t.tone), `${e.name}: ${t.label} has no palette tone`);
      const look = `${t.kind}/${t.tone}`;
      assert.equal(seen.get(t.label) ?? look, look, `${t.label} looks different on ${e.name}`);
      seen.set(t.label, look);
    }
  }
  const lin = systemTags({ diagram: { blocks: [{ id: 'g', type: 'gain', params: {} }], wires: [] } });
  const non = systemTags({ diagram: { blocks: [{ id: 's', type: 'saturation', params: {} }], wires: [] } });
  assert.equal(lin[0].label, 'Linear'); assert.equal(non[0].label, 'Nonlinear');
  assert.notEqual(lin[0].tone, non[0].tone);
  const none = lin.find((t) => t.label === 'No controller'), pid = systemTags({ diagram: { blocks: [{ id: 'c', type: 'controller', params: {}, variants: [{ type: 'pid' }] }], wires: [] } }).find((t) => t.label === 'PID');
  assert.notEqual(none.kind, pid.kind, 'No controller must not look like a controller');
  // Values that differ look different at a glance: no tag shares its tone
  // with a tag beside it on any card (Disturbance was Nonlinear's red on
  // three, Dead time Auto-tune's green on the oven), and in the filter row no
  // two values of one kind share a tone.
  for (const e of SYSTEM_LIBRARY) {
    const tones = e.tags.map((t) => t.tone);
    assert.equal(new Set(tones).size, tones.length, `${e.name}: ${e.tags.map((t) => `${t.label} ${t.tone}`).join(', ')}`);
  }
  const { libraryTags } = await import('../src/core/systems.js');
  const looks = libraryTags().map((t) => `${t.kind}/${t.tone}`);
  assert.equal(new Set(looks).size, looks.length, looks.join(' '));
});

test('library tags: Disturbance only where d plays something', async () => {
  const { SYSTEM_LIBRARY } = await import('../src/core/systems.js');
  const tags = (name) => SYSTEM_LIBRARY.find((e) => e.name.startsWith(name)).tags.map((t) => t.label);
  // Following a sine keeps a Source d with no components: it stays 0.
  assert.ok(!tags('Following a sine').includes('Disturbance'), tags('Following a sine').join(', '));
  assert.ok(tags('DC motor').includes('Disturbance') && tags('Pendulum swing-up').includes('Disturbance'));
});

test('XY: channel 1 is the X axis, never a target of vertical gestures, selected or not', async () => {
  const { valueTargets } = await import('../src/ui/xyview.js');
  const all = () => true;
  assert.deepEqual(valueTargets('xy', 0, all), [1, 2, 3], 'a line 1 selected in Time does not carry over');
  assert.deepEqual(valueTargets('xy', 2, all), [2]);
  assert.deepEqual(valueTargets('xy', null, (i) => i !== 3), [1, 2]);
  assert.deepEqual(valueTargets('time', 0, all), [0]);
  assert.deepEqual(valueTargets('time', null, all), [0, 1, 2, 3]);
});

test('XY: the status names Δ only when it changes a channel; the empty screen says why', async () => {
  const { xyStatus, xyEmpty, fitLabel } = await import('../src/ui/xyview.js');
  const unit = (s) => ({ F: 'N', x: 'm', Ekin: 'J', Epot: 'J', r: 'rad', angle: 'rad' })[s] ?? '1';
  const ch = (source, on = true) => ({ source, on, scale: 1, offset: 0 });
  // The mass–spring–damper: F in N across, x in m and the energies in J: Δ subtracts nothing.
  const msd = { channels: [ch('F'), ch('x'), ch('Ekin'), ch('Epot')], view: { mode: 'xy', delta: true } };
  assert.equal(xyStatus(msd, unit), 'XY · Δ: no channel in N');
  const sine = { channels: [ch('r'), ch('angle'), ch('', false), ch('', false)], view: { mode: 'xy', delta: true } };
  assert.equal(xyStatus(sine, unit), 'XY · Δ X − Y');
  assert.equal(xyStatus({ ...sine, view: { mode: 'xy' } }, unit), 'XY');
  assert.match(xyEmpty({ channels: [ch('r', false)] }), /channel 1 \(r\) is off\. Turn it on with the channel key 1 under Vertical/);
  assert.match(xyEmpty({ channels: [ch('')] }), /Give it a source/);
  // Rounding noise in a fit's intercept reads 0, not 5.46e-17.
  assert.equal(fitLabel('x', 'F', { a: 0.04, b: 5.46e-17, sigma: 0 }, 0.02, 1, 'm'), 'x  ≈ 0.04·F + 0   σ 0 m');
});

test('XY: switching Following a sine to Time fits the angle again, so it stays on the screen', async () => {
  const { SYSTEM_LIBRARY, SYSTEM_PARTS, applySystem } = await import('../src/core/systems.js');
  const { evaluateSystem } = await import('../src/core/project.js');
  const { drawnValues, refitSwitched } = await import('../src/ui/xyview.js');
  const entry = SYSTEM_LIBRARY.find((s) => s.name.startsWith('Following a sine'));
  const p = normalizeProject(applySystem(DEFAULT_PROJECT, entry, SYSTEM_PARTS));
  p.scope.timebase = autoTimebase(p);
  const res = evaluateSystem(p), unit = (s) => ({ r: 'rad', angle: 'rad', V: 'V' })[s] ?? '1';
  // Auto Scale in XY Δ fits the error r − angle.
  p.scope.channels.forEach((c, i) => { const v = drawnValues(res.signals, p.scope, i, unit), f = v && fitChannel(v); if (f) Object.assign(c, f); });
  const onScreen = (sc, i) => { const c = sc.channels[i]; return Math.max(...Array.from(res.signals[c.source], (v) => Math.abs((v + c.offset) / c.scale))) <= 4; };
  // Press Time: the angle (±1 rad) at the error's scale left the ±4 divisions before.
  const before = structuredClone(p.scope), time = structuredClone(p.scope);
  delete time.view.mode;
  assert.equal(onScreen(time, 1), false, 'at the Δ scale the angle leaves the screen');
  refitSwitched(before, time, res.signals, unit);
  assert.ok(onScreen(time, 1), JSON.stringify(time.channels[1]));
  // And back to XY: fitted to the error again.
  const xy = structuredClone(time);
  xy.view.mode = 'xy';
  refitSwitched(time, xy, res.signals, unit);
  assert.deepEqual([xy.channels[1].scale, xy.channels[1].offset], [p.scope.channels[1].scale, p.scope.channels[1].offset]);
});

test('XY: following a sine, the error figure closes from a wide ellipse (P) to a thin line (PID)', async () => {
  const { SYSTEM_LIBRARY, SYSTEM_PARTS, applySystem } = await import('../src/core/systems.js');
  const { evaluateSystem, autoTimebase } = await import('../src/core/project.js');
  const { lineFit, isDelta, ySignal } = await import('../src/ui/xyview.js');
  const entry = SYSTEM_LIBRARY.find((s) => s.name.startsWith('Following a sine'));
  const spread = (name) => {
    const p = normalizeProject(applySystem(DEFAULT_PROJECT, entry, SYSTEM_PARTS));
    p.scope.timebase = autoTimebase(p);   // one period of the input, as the page loads it
    const c = p.system.plant.diagram.blocks.find((b) => b.type === 'controller');
    c.variant = c.variants.findIndex((v) => v.name === name);
    const res = evaluateSystem(p), unit = (s) => ({ r: 'rad', angle: 'rad', V: 'V' })[s];
    assert.ok(isDelta(p.scope, 1, unit) && !isDelta({ ...p.scope, channels: [p.scope.channels[0], { source: 'V' }] }, 1, unit), 'Δ only for channels in X\'s unit');
    const e = ySignal(res, p.scope, 1, unit), n = res.t.length;
    return lineFit(res.signals.r, e, Math.round(n * 0.3), n - 1).sigma;
  };
  const [p, pd, pid] = ['P', 'PD', 'PID'].map(spread);
  assert.ok(p > 1.5 * pd && pd > 5 * pid && pid < 0.02 && p > 0.1, `σ: P ${p}, PD ${pd}, PID ${pid}`);
});

test('System library tags: every tag listed once, grouped; filtering keeps systems that carry all chosen tags', async () => {
  const { SYSTEM_LIBRARY, libraryTags, filterByTags } = await import('../src/core/systems.js');
  const tags = libraryTags();
  assert.equal(new Set(tags.map((t) => t.label)).size, tags.length);
  assert.ok(tags.findIndex((t) => t.kind === 'plant') < tags.findIndex((t) => t.kind === 'feature'));
  assert.deepEqual(filterByTags([]), SYSTEM_LIBRARY.map((e, i) => i));
  const lin = filterByTags(['Linear']), non = filterByTags(['Nonlinear']);
  assert.ok(lin.length && non.length && lin.length + non.length === SYSTEM_LIBRARY.length, 'every system is linear or nonlinear');
  const both = filterByTags(['Nonlinear', 'Disturbance']);
  assert.ok(both.every((i) => non.includes(i) && SYSTEM_LIBRARY[i].tags.some((t) => t.label === 'Disturbance')));
});
