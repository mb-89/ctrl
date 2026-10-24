import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProject, evaluateSystem, channelNames, autoTimebase } from '../src/core/project.js';
import { SYSTEM_LIBRARY, applySystem } from '../src/core/systems.js';
import { DEFAULT_PROJECT } from '../src/core/examples.js';
import {
  iterate, runIterate, tuneContext, runVariant, costScales, runCost, variantCost, tuningSpace,
  relayExperiment, relayTune, pidFromUltimate, stepExperiment, stepTune, simcGains, baseName, RULES,
} from '../src/core/autotune.js';

const system = (name) => {
  const p = normalizeProject(applySystem(DEFAULT_PROJECT, SYSTEM_LIBRARY.find((s) => s.name.startsWith(name)), ['input', 'plant']));
  p.scope.timebase = autoTimebase(p);
  return p;
};

// One loop: Source r → Controller → plant block(s) → Sink y, y back to the controller.
const loop = (plant, { period = 20, Ts = 0.01, variant = { name: 'PI', type: 'pid', params: { Kp: 0.1, Ki: 0.05 } }, r = [{ type: 'step', params: { amplitude: 1, time: 0.5 } }] } = {}) => normalizeProject({
  system: {
    signals: { r: { period, components: r } },
    plant: { type: 'diagram', diagram: {
      blocks: [
        { id: 'r', type: 'source', params: { signal: 'r' } },
        { id: 'ctrl', type: 'controller', params: { inputs: 2, Ts }, variants: [variant] },
        { id: 'p', ...plant },
        { id: 'y', type: 'sink', params: { name: 'y' } },
      ],
      wires: [{ from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'p' }, { from: 'p', to: 'y' }, { from: 'p', to: 'ctrl:1' }],
    } },
  },
});

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
