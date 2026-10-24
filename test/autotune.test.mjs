import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProject, evaluateSystem, channelNames, autoTimebase } from '../src/core/project.js';
import { SYSTEM_LIBRARY, applySystem } from '../src/core/systems.js';
import { DEFAULT_PROJECT } from '../src/core/examples.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONTROLLERS } from '../src/core/controllers.js';
import {
  iterate, runIterate, tuneContext, runVariant, costScales, runCost, variantCost, tuningSpace,
  relayExperiment, relayTune, pidFromUltimate, stepExperiment, stepTune, simcGains, baseName, RULES,
  autotune, tuneReport, resultName, placeVariant, loopOverlays, upstreamSource,
} from '../src/core/autotune.js';

const system = (name) => {
  const p = normalizeProject(applySystem(DEFAULT_PROJECT, SYSTEM_LIBRARY.find((s) => s.name.startsWith(name)), ['input', 'plant']));
  p.scope.timebase = autoTimebase(p);
  return p;
};

// One loop: Source r → Controller → plant block(s) → Sink y, y back to the
// controller. extra: more blocks; wires replaces the wiring.
const LOOP_WIRES = [{ from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'p' }, { from: 'p', to: 'y' }, { from: 'p', to: 'ctrl:1' }];
const loop = (plant, { period = 20, Ts = 0.01, variant = { name: 'PI', type: 'pid', params: { Kp: 0.1, Ki: 0.05 } }, r = [{ type: 'step', params: { amplitude: 1, time: 0.5 } }], extra = [], wires = LOOP_WIRES } = {}) => normalizeProject({
  system: {
    signals: { r: { period, components: r } },
    plant: { type: 'diagram', diagram: {
      blocks: [
        { id: 'r', type: 'source', params: { signal: 'r' } },
        { id: 'ctrl', type: 'controller', params: { inputs: 2, Ts }, variants: [variant] },
        { id: 'p', ...plant },
        { id: 'y', type: 'sink', params: { name: 'y' } },
        ...extra,
      ],
      wires,
    } },
  },
});
const LAGS = { type: 'lagChain', params: { K: 8, tau: 1, n: 3 } };

test('a Controller block\'s r, y and u are probed under its path, never offered as channels', () => {
  const p = system('Oven');
  const run = evaluateSystem(p);
  for (const k of ['ctrl.r', 'ctrl.y', 'ctrl.u']) assert.ok(run.signals[k], k);
  const n = run.t.length - 1;
  assert.equal(run.signals['ctrl.r'][n], run.signals.r[n]);
  assert.equal(run.signals['ctrl.y'][n], run.signals.T[n]);
  assert.equal(run.signals['ctrl.u'][n], run.signals.P[n]);
  assert.ok(channelNames(p).every((c) => !c.includes('.')));
});

test('the cost: errors count, a diverged run costs a large finite amount, the project is not touched', () => {
  const p = system('Oven');
  const before = JSON.stringify(p);
  const ctx = tuneContext(p);
  const sc = costScales(runVariant(ctx, ctx.variant), ctx.key, ctx.variant);
  const start = variantCost(ctx, ctx.variant, {}, sc);
  assert.ok(start.J > 0.5 && start.overshoot > 25, `the badly tuned PID overshoots: ${start.overshoot} %`);
  // A wildly unstable PID (no limits) blows up: large but finite, worse than any working one.
  const wild = { ...ctx.variant, params: { ...ctx.variant.params, Kp: 400, Ki: 4000, umin: -Infinity, umax: Infinity } };
  const bad = variantCost(ctx, wild, {}, sc);
  assert.ok(bad.diverged && Number.isFinite(bad.J) && bad.J >= 100, JSON.stringify(bad));
  // ISE and ITAE weigh the same run differently; effort adds to the cost.
  const run = runVariant(ctx, ctx.variant);
  const how = { scales: sc, variant: ctx.variant, others: ctx.others };
  assert.notEqual(runCost(run, ctx.key, { cost: 'ISE' }, how).parts.error, runCost(run, ctx.key, { cost: 'ITAE' }, how).parts.error);
  assert.ok(runCost(run, ctx.key, { effort: 1 }, how).J > runCost(run, ctx.key, { effort: 0 }, how).J);
  assert.equal(JSON.stringify(p), before);
});

test('Nelder–Mead lowers the badly tuned oven\'s cost by a clear factor, step by step and reproducibly', () => {
  const p = system('Oven');
  const costs = [];
  for (const s of iterate(p, null, {}, { maxIter: 30 })) costs.push(s.cost);
  assert.ok(costs.length >= 5);
  for (let i = 1; i < costs.length; i++) assert.ok(costs[i] <= costs[i - 1], 'the best cost never rises');
  const a = runIterate(p, null, {}, { maxIter: 30 }), b = runIterate(p, null, {}, { maxIter: 30 });
  assert.ok(a.cost < 0.2 * a.start.cost, `${a.start.cost} → ${a.cost}`);
  assert.ok(a.best.cost.overshoot < 12, `overshoot ${a.best.cost.overshoot} %`);
  assert.deepEqual(a.best.variant.params, b.best.variant.params);
  assert.equal(a.best.variant.type, 'pid');
});

test('the oven\'s view reads T as the temperature, not the time', async () => {
  const { compileScene } = await import('../src/core/views.js');
  const { compileExpr } = await import('../src/core/expr.js');
  const oven = SYSTEM_LIBRARY.find((s) => s.name.startsWith('Oven'));
  const scene = compileScene(oven.plant.views[0]);
  const caption = scene({ t: 2, T: 41.5, r: 40, P: 46, d: 0 }).find((o) => o.text?.startsWith('T'));
  assert.match(caption.text, /^T\s+41\.5 °C/);
  const f = compileExpr('T + PI', { vars: true });
  assert.equal(f({ t: 2, T: 40 }), 40 + Math.PI, 'a signal named T is read; PI stays π when no signal has that name');
  assert.equal(f({ t: 2 }), 2 + Math.PI, 'without a signal T, T is the time as before');
});

test('a variant restored from JSON (undo) keeps its open limits open', async () => {
  const { makeLaw, normalizeVariant } = await import('../src/core/controllers.js');
  const v = JSON.parse(JSON.stringify(normalizeVariant({ type: 'pid', params: { Kp: 2 } })));
  assert.equal(v.params.umin, null);
  assert.equal(makeLaw(v, 0.01).step([1, 0]), 2);
});

test('what can be tuned: gains that are 0 stay off; untunable variants say why', () => {
  const pid = tuningSpace({ type: 'pid', params: { Kp: 2, Ki: 0, Kd: 0.5 } });
  assert.deepEqual(pid.names, ['Kp', 'Kd']);
  const v = pid.apply([Math.log(2), -Math.log(2)]);
  assert.deepEqual([v.params.Kp, v.params.Ki, v.params.Kd], [4, 0, 0.25]);
  const sf = tuningSpace({ type: 'stateFeedback', params: { K: [-1, 0, 3], kr: -1 } });
  assert.deepEqual(sf.names, ['K1', 'K3', 'kr']);
  assert.deepEqual(sf.apply([0, Math.log(2), 0]).params.K, [-1, 0, 6], 'signs are kept');
  const gs = tuningSpace({ type: 'gainScheduled', params: { at: [0, 1], Kp: [1, 2], Ki: [0, 0] } });
  assert.deepEqual(gs.apply([Math.log(3)]).params.Kp.map((x) => Number(x.toFixed(9))), [3, 6]);
  assert.throws(() => tuningSpace({ type: 'off', params: {} }), /nothing to tune/);
  assert.throws(() => tuningSpace({ type: 'swingUp', params: {} }), /State feedback/);
  assert.equal(baseName('PD · auto-tuned'), 'PD');
  assert.equal(baseName('PD · relay Z–N · auto-tuned'), 'PD');
});

test('relay feedback finds Ku and Pu of K/(s+1)³ (K = 8: Ku = 1, Pu = 2π/√3)', () => {
  const p = loop({ type: 'lagChain', params: { K: 8, tau: 1, n: 3 } });
  const ex = relayExperiment(p, null, { d: 0.1 });
  assert.ok(ex.ok, ex.why);
  // The describing function is an approximation: a few percent here.
  assert.ok(Math.abs(ex.Ku - 1) < 0.06, `Ku ${ex.Ku}`);
  assert.ok(Math.abs(ex.Pu / ((2 * Math.PI) / Math.sqrt(3)) - 1) < 0.03, `Pu ${ex.Pu}`);
  assert.ok(Math.abs(ex.u0 - 0.5 / 8) < 0.005, `bias ${ex.u0} holds r0 = 0.5`);
});

test('the rules map Ku and Pu to the textbook gains', () => {
  const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b)), msg ?? `${a} ≠ ${b}`);
  const zn = pidFromUltimate(10, 2, 'zn');    // Kp 0.6 Ku, Ti Pu/2, Td Pu/8
  close(zn.Kp, 6); close(zn.Ti, 1); close(zn.Td, 0.25); close(zn.Ki, 6); close(zn.Kd, 1.5);
  const tl = pidFromUltimate(10, 2, 'tl');    // Kp Ku/2.2, Ti 2.2 Pu, Td Pu/6.3
  close(tl.Kp, 10 / 2.2); close(tl.Ti, 4.4); close(tl.Td, 2 / 6.3); close(tl.Ki, (10 / 2.2) / 4.4);
  const calm = pidFromUltimate(10, 2, 'calm'); // Kp 0.2 Ku, Ti Pu/2, Td Pu/3
  close(calm.Kp, 2); close(calm.Ti, 1); close(calm.Td, 2 / 3);
  assert.deepEqual(Object.keys(RULES), ['zn', 'tl', 'calm']);
  // SIMC: Kp = τ / (K (τc + θ)), Ti = min(τ, 4 (τc + θ)), τc = θ.
  const s = simcGains(2, 1, 0.3);
  close(s.Kp, 1 / (2 * 0.6)); close(s.Ti, 1);
  close(simcGains(2, 3, 0.3).Ti, 2.4);
  close(simcGains(2, 5, 0.1).tauC, 0.5, 'with almost no dead time τc stays at τ / 10');
});

test('relay and step tests on the oven give working PIDs; experiments explain when they cannot run', () => {
  const p = system('Oven');
  const ctx = tuneContext(p);
  const sc = costScales(runVariant(ctx, ctx.variant), ctx.key, ctx.variant);
  const start = variantCost(ctx, ctx.variant, {}, sc).J;
  const tl = relayTune(p, null, 'tl');
  assert.ok(tl.ok, tl.why);
  assert.equal(tl.variant.name, 'PID, badly tuned · relay T–L');
  assert.deepEqual([tl.variant.params.umin, tl.variant.params.umax], [0, 100], 'the actuator limits carry over');
  assert.ok(variantCost(ctx, tl.variant, {}, sc).J < 0.3 * start);
  const st = stepTune(p, null);
  assert.ok(st.ok, st.why);
  assert.ok(Math.abs(st.K - 1) < 0.02, `static gain ${st.K}`);
  assert.ok(variantCost(ctx, st.variant, {}, sc).J < 0.3 * start);
  // A first order plus dead time is fitted exactly by the two-point method.
  const fopdt = stepExperiment(loop({ type: 'fopdt', params: { K: 2, tau: 1, delay: 0.3 } }, { period: 10 }), null, { du: 0.1 });
  assert.ok(fopdt.ok, fopdt.why);
  assert.ok(Math.abs(fopdt.K - 2) < 0.01 && Math.abs(fopdt.tau - 1) < 0.03 && Math.abs(fopdt.theta - 0.3) < 0.03, `${fopdt.K} ${fopdt.tau} ${fopdt.theta}`);
  // The motor integrates: no settled step response. The triple pendulum has eight measurements.
  assert.match(stepExperiment(system('DC motor'), null).why, /integrating/);
  assert.match(relayExperiment(system('Triple'), null).why, /measurements/);
  assert.throws(() => iterate(system('Pendulum'), null).next(), /State feedback/);
});

test('tuning reads a Controller inside a subsystem; unwired inputs are named', () => {
  const p = normalizeProject({
    system: {
      signals: { r: { period: 20, components: [{ type: 'step', params: { amplitude: 1, time: 0.5 } }] } },
      plant: { type: 'diagram', diagram: {
        blocks: [
          { id: 'r', type: 'source', params: { signal: 'r' } },
          { id: 'sub', type: 'subsystem', name: 'Loop', params: {}, diagram: {
            blocks: [
              { id: 'in', type: 'inport', params: { port: 1 } },
              { id: 'ctrl', type: 'controller', params: { inputs: 2, Ts: 0.01 }, variants: [{ name: 'PI', type: 'pid', params: { Kp: 0.1, Ki: 0.05 } }] },
              { id: 'p', ...LAGS },
              { id: 'out', type: 'outport', params: { port: 1 } },
            ],
            wires: [{ from: 'in', to: 'ctrl' }, { from: 'ctrl', to: 'p' }, { from: 'p', to: 'out' }, { from: 'p', to: 'ctrl:1' }],
          } },
          { id: 'y', type: 'sink', params: { name: 'y' } },
        ],
        wires: [{ from: 'r', to: 'sub' }, { from: 'sub', to: 'y' }],
      } },
    },
  });
  const run = evaluateSystem(p);
  for (const k of ['sub/ctrl.r', 'sub/ctrl.y', 'sub/ctrl.u']) assert.ok(run.signals[k], k);
  const ctx = tuneContext(p, ['sub', 'ctrl']);
  assert.equal(ctx.source, 'r', 'r is traced back through the subsystem port to its Source');
  const res = autotune(p, ['sub', 'ctrl'], { method: 'iterate', maxIter: 10 });
  assert.ok(res.ok && res.better && res.after.J < res.before.cost.J, JSON.stringify(tuneReport(res)));
  // An input without a wire is named, before any run.
  assert.throws(() => tuneContext(loop(LAGS, { wires: LOOP_WIRES.slice(0, 3) })), /wire the measurement y to input 2/);
  assert.throws(() => tuneContext(loop(LAGS, { wires: LOOP_WIRES.slice(1) })), /wire the reference r to input 1/);
  assert.throws(() => autotune(loop(LAGS, { wires: LOOP_WIRES.slice(0, 3) }), null, { method: 'relay' }), /input 2/);
});

test('Iterate tunes gain-scheduled and state-feedback variants, signs kept', () => {
  const tank = system('Conical');
  const startKp = tank.system.plant.diagram.blocks.find((b) => b.id === 'ctrl').variants[0].params.Kp;
  const gs = runIterate(tank, null, {}, { maxIter: 12 });
  assert.equal(gs.best.variant.type, 'gainScheduled');
  assert.ok(gs.cost < 0.95 * gs.start.cost, `${gs.start.cost} → ${gs.cost}`);
  const ratio = gs.best.variant.params.Kp[0] / startKp[0];
  assert.ok(gs.best.variant.params.Kp.every((v, i) => Math.abs(v / startKp[i] - ratio) < 1e-9), 'the Kp table scales as a whole');
  // u = kr r − K y on a first-order lag, sluggish at the start.
  const sf = loop({ type: 'firstOrder', params: { K: 1, tau: 1 } }, { period: 10, variant: { name: 'Slow', type: 'stateFeedback', params: { K: [0.5], kr: 1.5, umin: -5, umax: 5 } } });
  const res = runIterate(sf, null, {}, { maxIter: 25 });
  assert.ok(res.cost < 0.7 * res.start.cost, `${res.start.cost} → ${res.cost}`);
  assert.ok(res.best.variant.params.K[0] > 0.5 && res.best.variant.params.kr > 1.5, 'faster: both gains rise, neither flips sign');
});

test('Iterate yields after every run, and a goal changed mid-run changes nothing', () => {
  const goal = { cost: 'IAE', effort: 0.05 };
  const it = iterate(system('Oven'), null, goal, { maxIter: 8 });
  let s, partials = 0, iterations = 0;
  for (;;) {
    s = it.next();
    if (s.done) break;
    if (s.value.partial) partials++; else iterations++;
    if (partials === 4) { goal.cost = 'ISE'; goal.effort = 5; }
  }
  assert.ok(partials > iterations, `${partials} runs, ${iterations} iterations`);
  const ref = runIterate(system('Oven'), null, { cost: 'IAE', effort: 0.05 }, { maxIter: 8 });
  assert.deepEqual(s.value.best.variant.params, ref.best.variant.params);
  assert.equal(s.value.goal.cost, 'IAE');
});

test('the relay: reverse-acting plants, a bias at a limit, a reduced amplitude, r through a gain', () => {
  // y falls when u rises: the relay is reversed and Ku comes out negative.
  const rev = relayExperiment(loop({ type: 'lagChain', params: { K: -8, tau: 1, n: 3 } }, { variant: { name: 'PI', type: 'pid', params: { Kp: -0.1, Ki: -0.05 } } }), null, { d: 0.1 });
  assert.ok(rev.ok, rev.why);
  assert.ok(Math.abs(rev.Ku + 1) < 0.06 && Math.abs(rev.Pu / ((2 * Math.PI) / Math.sqrt(3)) - 1) < 0.03, `Ku ${rev.Ku} Pu ${rev.Pu}`);
  const g0 = pidFromUltimate(rev.Ku, rev.Pu, 'tl');
  assert.ok(g0.Kp < 0 && g0.Ki < 0 && g0.Kd < 0, 'a reverse-acting PID');
  // r0 = 0.5 needs u0 = 1/16; with u at most 1/16 the relay has no room.
  const atLimit = relayExperiment(loop(LAGS, { variant: { name: 'PI', type: 'pid', params: { Kp: 0.1, Ki: 0.05, umin: 0, umax: 0.0625 } } }), null, { d: 0.01 });
  assert.ok(!atLimit.ok && /actuator limit/.test(atLimit.why), atLimit.why);
  // Half the range asked, 0.0375 left above the bias: the amplitude shrinks and says so.
  const reduced = relayExperiment(loop(LAGS, { variant: { name: 'PI', type: 'pid', params: { Kp: 0.1, Ki: 0.05, umin: 0, umax: 0.1 } } }), null, { amplitude: 0.5 });
  assert.ok(reduced.ok, reduced.why);
  assert.ok(Math.abs(reduced.d - 0.0375) < 0.002 && reduced.notes.some((n) => /reduced/.test(n)), `${reduced.d} ${reduced.notes}`);
  assert.ok(Math.abs(reduced.Ku - 1) < 0.08, `Ku ${reduced.Ku}`);
  // r through a gain of 2: the Source is held at the middle of its range, r0 = 1.
  const viaGain = loop(LAGS, { extra: [{ id: 'g', type: 'gain', params: { K: 2 } }], wires: [{ from: 'r', to: 'g' }, { from: 'g', to: 'ctrl' }, ...LOOP_WIRES.slice(1)] });
  assert.equal(upstreamSource(viaGain.system.plant.diagram, ['ctrl'], 0), 'r');
  const g = relayExperiment(viaGain, null, { d: 0.1 });
  assert.ok(g.ok && Math.abs(g.r0 - 1) < 1e-6 && Math.abs(g.Ku - 1) < 0.08, `${g.why} r0 ${g.r0} Ku ${g.Ku}`);
  // Off, without limits: no scale for the test signal.
  const off = loop(LAGS, { variant: { name: 'Off', type: 'off', params: {} } });
  assert.match(relayExperiment(off, null).why, /no actuator limits/);
  assert.match(stepExperiment(off, null).why, /no actuator limits/);
});

test('the relay controller: hysteresis and limits', () => {
  const law = CONTROLLERS.relay.make({ d: 2, eps: 0.5, u0: 1, umin: 0, umax: 2.5 });
  const u = [[1, 0], [1, 0.8], [1, 1.4], [1, 1.6], [1, 1.2], [1, 0.4]].map((x) => law.step(x));
  assert.deepEqual(u, [2.5, 2.5, 2.5, 0, 0, 2.5], 'switches only past ±ε; u0 + d is clamped to u max, u0 − d to u min');
  const rev = CONTROLLERS.relay.make({ d: -1, eps: 0, u0: 0, umin: -Infinity, umax: Infinity });
  assert.equal(rev.step([1, 0]), -1, 'a negative d reverses it');
});

test('results: a variant of their own, numbered, never overwriting; a worse one does not run', () => {
  const p = system('Oven');
  const block = p.system.plant.diagram.blocks.find((b) => b.id === 'ctrl');
  assert.equal(resultName(block, 'iterate'), 'PID, badly tuned · auto-tuned');
  assert.equal(resultName(block, 'relay', 'zn'), 'PID, badly tuned · relay Z–N');
  placeVariant(p, ['ctrl'], { ...block.variants[0], name: 'PID, badly tuned · auto-tuned' }, { run: false });
  assert.equal(block.variant, 0);
  assert.equal(resultName(block, 'iterate'), 'PID, badly tuned · auto-tuned 2', 'an earlier result is not overwritten');
  block.variant = 1;
  assert.equal(resultName(block, 'iterate'), 'PID, badly tuned · auto-tuned', 'tuning again from a result updates it');
  assert.equal(baseName('PID · auto-tuned 2'), 'PID');
  // The conical tank's gain scheduling beats a fixed PI from a relay rule: not better.
  const tank = autotune(system('Conical'), null, { method: 'relay' });
  assert.ok(tank.ok && !tank.better && tank.after.J > tank.before.cost.J, `${tank.before.cost.J} → ${tank.after.J}`);
  const rep = tuneReport(tank);
  assert.equal(rep.better, false);
  assert.equal(rep.before.variant.params.umax, 3);
  assert.equal(JSON.stringify(rep), JSON.stringify(JSON.parse(JSON.stringify(rep))), 'plain JSON');
});

test('Auto Scale overlays a Controller block\'s r and y, nothing else', () => {
  const p = system('Oven');
  const run = evaluateSystem(p);
  const units = { r: '°C', T: '°C', P: '%', d: '%' };
  const chs = ['r', 'T', 'P', 'd'].map((source) => ({ source, on: true }));
  assert.deepEqual(loopOverlays(chs, run.signals, (n) => units[n]), [[0, 1]], 'r and T share a scale; P and d (same unit) do not');
  assert.deepEqual(loopOverlays(chs.map((c, i) => ({ ...c, on: i !== 1 })), run.signals, (n) => units[n]), [], 'only channels that are on');
  assert.deepEqual(loopOverlays(chs, run.signals, (n) => (n === 'T' ? 'K' : units[n])), [], 'only one unit');
});

test('the command line tunes a Controller block and saves the result', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lt-'));
  const file = join(dir, 'oven.json');
  writeFileSync(file, JSON.stringify(system('Oven')));
  const out = JSON.parse(execFileSync('node', ['cli.mjs', 'autotune', file, '--method', 'step', '--save', '--json']).toString());
  assert.ok(out.ok && out.better && out.K > 0.9 && out.after.cost.J < out.before.cost.J, JSON.stringify(out));
  const saved = JSON.parse(readFileSync(file, 'utf8')).system.plant.diagram.blocks.find((b) => b.id === 'ctrl');
  assert.equal(saved.variants[saved.variant].name, 'PID, badly tuned · SIMC');
  assert.match(execFileSync('node', ['cli.mjs', 'autotune', file, '--method', 'relay', '--rule', 'zn']).toString(), /Ku 5/);
});

test('Iterate tunes the feedforward gains that are not 0; asked to, also those at 0, from a fit of u to the reference', async () => {
  const { feedforwardStart } = await import('../src/core/autotune.js');
  const p0 = { Kp: 2, Ki: 1, Kd: 0, Kff: 0, Kv: 0.5, Ka: 0 };
  assert.deepEqual(tuningSpace({ type: 'pid', params: p0 }).names, ['Kp', 'Ki', 'Kv'], 'a feedforward gain at 0 stays off');
  const started = tuningSpace({ type: 'pid', params: p0 }, { start: { Kff: 0.3, Kv: 9, Ka: 0 } });
  assert.deepEqual(started.names, ['Kp', 'Ki', 'Kff', 'Kv']);
  assert.deepEqual([started.base.params.Kff, started.base.params.Kv], [0.3, 0.5], 'only gains at 0 take a start value');
  const gs = tuningSpace({ type: 'gainScheduled', params: { at: [0, 1], Kp: [1, 2], Ki: [1, 1], Kff: 2, Kv: 0, Ka: 0 } });
  assert.deepEqual(gs.names, ['Kp table ×', 'Ki table ×', 'Kff']);
  assert.equal(gs.apply([0, 0, Math.log(2)]).params.Kff, 4);
  // Following a sine with the PID: the u the loop needs is the motor's
  // voltage per rad/s of speed times the reference's speed (0.7 V·s/rad from
  // the motor in plants.js). A sine's acceleration is its value times −ω²,
  // so the run cannot tell Ka from Kff: Ka stays 0.
  const p = system('Following a sine');
  const blk = p.system.plant.diagram.blocks.find((b) => b.type === 'controller');
  blk.variant = blk.variants.findIndex((v) => v.name === 'PID');
  const ctx = tuneContext(p, null);
  const fit = feedforwardStart(runVariant(ctx, ctx.variant), ctx.key, ctx.variant);
  assert.ok(Math.abs(fit.Kv - 0.7) < 0.07 && Math.abs(fit.Kff) < 0.1 && fit.Ka === 0, JSON.stringify(fit));
  const plain = runIterate(p, null, {}, { maxIter: 20 }), ff = runIterate(p, null, {}, { maxIter: 20, feedforward: true });
  assert.ok(ff.names.includes('Kv') && !plain.names.includes('Kv'));
  assert.ok(ff.best.cost.J < 0.5 * plain.best.cost.J, `cost with feedforward ${ff.best.cost.J}, without ${plain.best.cost.J}`);
  assert.ok(ff.best.variant.params.Kv > 1, `Kv ${ff.best.variant.params.Kv}: the motor's 0.7 plus what the D part on the measurement takes away`);
  // Ticked on the oven (steps, little to explain): never worse than the start.
  const oven = runIterate(system('Oven'), null, {}, { maxIter: 10, feedforward: true });
  assert.ok(oven.best.cost.J <= oven.start.cost);
});
