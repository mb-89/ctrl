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
  simcIntegrating, settledLevel, settledSlope, derivativeFilter, tauCSource, unstableAtStart,
} from '../src/core/autotune.js';
import { analyzeLoop } from '../src/core/analysis.js';

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
  // A plant outside the page (Live mode) reads 0 offline: every method says so.
  for (const method of ['iterate', 'relay', 'step']) assert.throws(() => autotune(system('HIL'), null, { method }), /outside the page/);
  // The triple pendulum has eight measurements.
  assert.match(relayExperiment(system('Triple'), null).why, /measurements/);
  assert.match(stepExperiment(system('Triple'), null).why, /measurements/);
  assert.throws(() => iterate(system('Pendulum'), null).next(), /State feedback/);
});

test('SIMC for an integrating plant: Skogestad\'s Table 1, series form converted by his eq. 36', () => {
  const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b)), msg ?? `${a} ≠ ${b}`);
  // k' e^(−θs)/s, θ = 0.1, τc = θ: Kc = 1/(k'(τc + θ)) = 2.5, τI = 4(τc + θ) = 0.8, a PI.
  const pi = simcIntegrating(2, 0.1);
  close(pi.Kp, 2.5); close(pi.Ki, 2.5 / 0.8); close(pi.Kd, 0);
  // Smooth: τc = 3θ, Kc = 1/(2 · 0.4), τI = 1.6.
  const smooth = simcIntegrating(2, 0.1, 0, 0, { rule: 'smooth' });
  close(smooth.Kp, 1.25); close(smooth.Ki, 1.25 / 1.6);
  // With a lag longer than θ, SIMC's series PID (Kc 0.5, τI 1, τD 1 when k' = 8,
  // θ = 0.125, τ2 = 1) is, in ideal form, Kc' 1, τI' 2, τD' 0.5: the numbers
  // of Skogestad's example of eq. 36 in his appendix (there for the process
  // e^(−s)/(s + 1)², here from an integrating one), so Kp 1, Ki 0.5, Kd 0.5.
  const pid = simcIntegrating(8, 0.125, 1);
  close(pid.Kc, 0.5); close(pid.tauI, 1); close(pid.tauD, 1);
  close(pid.Kp, 1); close(pid.Ki, 0.5); close(pid.Kd, 0.5);
  // A lag shorter than θ: a PI, half the lag counted as dead time (θ = 0.1 + 0.05).
  const half = simcIntegrating(2, 0.1, 0.1);
  close(half.Kd, 0); close(half.Kp, 1 / (2 * 0.3)); close(half.tauI, 1.2);
  // Half a controller sample joins the dead time, as for the first-order rule.
  close(simcIntegrating(2, 0.1, 0, 0.02).theta, 0.11);
  // The PID's derivative filter joins it too, when given: Tf is
  // max(Ts, Td/10) of the gains it gives (here Ts).
  const Ts = 0.01, dFilter = (Td) => derivativeFilter(Td, Ts);
  const own = simcIntegrating(1.4286, 0.0103, 0.0497, Ts, { dFilter });
  close(own.Tf, derivativeFilter(own.Td, Ts));
  close(own.Tf, Ts);
  close(own.theta, 0.0103 + Ts / 2 + own.Tf);
  close(own.thetaPlant, 0.0103 + Ts / 2);
  close(own.Kc, 1 / (1.4286 * 2 * own.theta));
  assert.match(tauCSource(own), /derivative's filter/);
  // A filter longer than a sample is found by repeating: Td/10 of the result.
  const slow = simcIntegrating(1, 0.05, 1, Ts, { dFilter });
  assert.ok(slow.Tf > Ts);
  close(slow.Tf, slow.Td / 10, `Tf ${slow.Tf}, Td ${slow.Td}`);
  // A PI has no derivative and adds nothing.
  close(simcIntegrating(2, 0.1, 0, Ts, { dFilter }).theta, 0.1 + Ts / 2);
});

test('SIMC with the derivative filter in θ keeps Skogestad\'s margins on an integrator with a short lag', () => {
  // y = ∫ k' u / (τ2 s + 1), τ2 = 5 samples, no dead time: the controller's
  // own delays (the hold, the derivative's filter) are all the loop has.
  const k = 1.43, tau2 = 0.05, Ts = 0.01;
  const p = loop({ type: 'firstOrder', params: { K: k, tau: tau2 } }, {
    period: 5, Ts, variant: { name: 'P', type: 'pid', params: { Kp: 2, umin: -12, umax: 12 } },
    extra: [{ id: 'i', type: 'integrator', params: { K: 1 } }],
    wires: [{ from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'p' }, { from: 'p', to: 'i' }, { from: 'i', to: 'y' }, { from: 'i', to: 'ctrl:1' }],
  });
  const res = stepTune(p, null);
  assert.ok(res.ok && res.model === 'integrating' && res.variant.params.Kd > 0, res.why);
  assert.ok(Math.abs(res.kp / k - 1) < 0.005 && Math.abs(res.tau2 / tau2 - 1) < 0.05, `k' ${res.kp}, τ2 ${res.tau2}`);
  // The plant as the Analysis tab takes it: speed, then angle.
  const plant = { A: [[-1 / tau2, 0], [1, 0]], B: [[k / tau2], [0]], C: [[0, 1]], D: [[0]] };
  const ms = (params) => analyzeLoop(plant, CONTROLLERS.pid.linear(params, Ts), Ts, { points: 3000 }).margins.ms;
  const msNow = ms(res.variant.params);
  assert.ok(msNow > 1.4 && msNow < 1.85, `Ms ${msNow} (Skogestad: 1.59–1.70 for τc = θ)`);
  // The same rule without the filter in θ: Ms about 10, a loop that rings.
  const bare = simcIntegrating(res.kp, res.theta, res.tau2, Ts);
  assert.ok(ms({ ...res.variant.params, Kp: bare.Kp, Ki: bare.Ki, Kd: bare.Kd, Tf: derivativeFilter(bare.Td, Ts) }) > 3);
});

test('the settling check reads through a steady ripple: a first-order response with a sine on it', () => {
  const n = 2000, dt = 0.0025, t = new Float64Array(n), y = new Float64Array(n);
  const at = (tau, a) => { for (let k = 0; k < n; k++) { t[k] = k * dt; y[k] = 2 * (1 - Math.exp(-t[k] / tau)) + a * Math.sin(2 * Math.PI * 23 * t[k]) * (t[k] > 0.05 ? 1 : 0); } return settledLevel(t, y); };
  // A 10 % ripple (±0.2 on a step of 2) at 23 Hz: the response has settled; the ripple is read.
  const s = at(0.2, 0.2);
  assert.ok(s.settled, JSON.stringify(s));
  assert.ok(Math.abs(s.final - 2) < 0.01 && Math.abs(s.ripple - 0.2) < 0.02, `final ${s.final}, ripple ${s.ripple}`);
  // A raw 2 % band would never pass: the ripple alone is 10 %.
  let raw = 0;
  for (let k = Math.floor(0.8 * n); k < n; k++) raw = Math.max(raw, Math.abs(y[k] - 2));
  assert.ok(raw > 0.04 * 2);
  // Still rising (τ 3 s in a 5 s record): not settled, ripple or not.
  assert.ok(!at(3, 0.2).settled && !at(3, 0).settled);
  // A ramp is no level; its slope is steady.
  for (let k = 0; k < n; k++) y[k] = t[k] > 0.2 ? 0.5 * (t[k] - 0.2) + 0.05 * Math.sin(2 * Math.PI * 23 * t[k]) : 0;
  assert.ok(!settledLevel(t, y).settled);
  const r = settledSlope(t, y);
  assert.ok(r.ramps && Math.abs(r.slope - 0.5) < 0.01, JSON.stringify(r));
});

test('the step test fits an integrator with lag and dead time: k\' and θ within 1 %', () => {
  // y = ∫ 2 e^(−0.3 s)/(0.2 s + 1) u: k' = 2, τ2 = 0.2 s, θ = 0.3 s.
  const p = loop({ type: 'fopdt', params: { K: 2, tau: 0.2, delay: 0.3 } }, {
    period: 10, variant: { name: 'P', type: 'pid', params: { Kp: 0.5, umin: -1, umax: 1 } },
    extra: [{ id: 'i', type: 'integrator', params: { K: 1 } }],
    wires: [{ from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'p' }, { from: 'p', to: 'i' }, { from: 'i', to: 'y' }, { from: 'i', to: 'ctrl:1' }],
  });
  const ex = stepExperiment(p, null);
  assert.ok(ex.ok && ex.model === 'integrating', ex.why);
  // The test runs until the lag has faded, so the line through its end is
  // the asymptote: k' and θ within 1 %, τ2 within 5 % (cut where the slope
  // first looked steady, k' was 1 % low, θ 2 % long and τ2 10 % short).
  assert.ok(Math.abs(ex.kp / 2 - 1) < 0.01, `k' ${ex.kp}`);
  assert.ok(Math.abs(ex.theta / 0.3 - 1) < 0.01, `θ ${ex.theta}`);
  assert.ok(Math.abs(ex.tau2 / 0.2 - 1) < 0.05, `τ2 ${ex.tau2}`);
  assert.ok(Math.abs(ex.L - 0.5) < 0.01, `asymptote's intercept ${ex.L}`);
  assert.ok(0.8 * ex.tEnd >= ex.L + 5 * ex.tau2 - 0.05, `the last fifth starts after L + 5 τ2: ended ${ex.tEnd} s`);
  // It ends once the slope is steady and the lag has faded: well before the
  // period is over, and with y moved by no more than half of r's span (0.5).
  assert.ok(ex.tEnd < 3 && Math.abs(ex.moved) <= 0.5, `ended ${ex.tEnd} s after the step, y moved ${ex.moved}`);
  assert.ok(ex.notes.some((n) => /ramps/.test(n)));
  assert.ok(ex.run.t[ex.run.t.length - 1] < ex.tHold + 3, 'the run shown ends with the test');
});

test('the step method on the library\'s examples: better where the loop is badly tuned, sensible elsewhere', () => {
  const step2 = (p, opts) => autotune(p, null, { method: 'step', ...opts });
  const step = (name, opts) => {
    const res = autotune(system(name), null, { method: 'step', ...opts });
    assert.ok(res.ok, `${name}: ${res.why}`);
    assert.ok(!res.after.diverged && res.after.saturated < 0.1, `${name}: ${JSON.stringify(tuneReport(res).after.cost)}`);
    return res;
  };
  // The motor's aggressive P and the oven's PID: SIMC beats them.
  const motor = step('DC motor');
  assert.equal(motor.model, 'integrating');
  assert.ok(Math.abs(motor.kp / (0.5 * 10 / (1 + 0.5 * 0.5 * 10)) - 1) < 0.01, `k' ${motor.kp} V⁻¹s⁻¹ (the motor's speed per volt)`);
  assert.ok(motor.after.J < 0.5 * motor.before.cost.J && motor.after.overshoot < motor.before.cost.overshoot, `${motor.before.cost.J} → ${motor.after.J}`);
  assert.ok(motor.variant.params.Kd > 0, 'a lag longer than the dead time: SIMC PID');
  const oven = step('Oven');
  assert.equal(oven.model, 'fopdt');
  assert.ok(oven.after.J < 0.3 * oven.before.cost.J);
  // Sensible elsewhere: a stable loop near the running one's cost.
  const sine = step('Following');
  assert.ok(sine.after.J <= sine.before.cost.J, `${sine.before.cost.J} → ${sine.after.J}`);
  const enc = step('Encoder');
  assert.equal(enc.model, 'fopdt');
  assert.ok(Math.abs(enc.K / (200 * 0.1 / (1 + 0.1 * 0.1 * 200)) - 1) < 0.03, `K ${enc.K} (speed per volt)`);
  assert.ok(enc.ripple > 0.05 * enc.size && enc.notes.some((n) => /ripples/.test(n)), 'the encoder\'s errors ripple on y and are named');
  assert.ok(enc.after.J < 1.5 * enc.before.cost.J, `${enc.before.cost.J} → ${enc.after.J}`);
  // The conical tank's gain-scheduled PI gets a schedule of its own: a step test at each point.
  const tank = step('Conical');
  assert.equal(tank.variant.type, 'gainScheduled');
  assert.deepEqual(tank.variant.params.at, tank.before.variant.params.at);
  assert.ok(tank.points.filter((q) => q.ok).length >= 3, JSON.stringify(tank.points.map((q) => q.why ?? 'ok')));
  const kp = tank.variant.params.Kp;
  assert.ok(kp[2] > 4 * kp[0], `the gain rises with the level as the tank widens: ${kp}`);
  // u0 balances the outlet at the start level: a √(2 g h0).
  assert.ok(Math.abs(tank.variant.params.u0 / (0.1 * Math.sqrt(2 * 9.81 * 0.15)) - 1) < 0.02, `u0 ${tank.variant.params.u0}`);
  assert.ok(tank.after.J < 2 * tank.before.cost.J && tank.after.overshoot < 20, `${tank.before.cost.J} → ${tank.after.J}, overshoot ${tank.after.overshoot} %`);
  // The library's schedule (from the plant) tops out at 0.95 m, below the
  // brim, and its step test works there.
  assert.ok(tank.points.find((q) => q.at === 0.95).ok);
  // The full tank (1 m) overflows: a small step does not move y, a large one
  // drains it too far. Said as it is, not as a wiring fault. (A hand schedule
  // with a point at the brim: the table the library once held.)
  const brim = system('Conical');
  const bctrl = brim.system.plant.diagram.blocks.find((b) => b.type === 'controller');
  bctrl.variants[0] = { name: 'Gain-scheduled PI', type: 'gainScheduled', params: { at: [0.1, 0.25, 0.5, 0.75, 1], Kp: [0.113, 0.332, 0.95, 1.887, 3.142], Ki: [2.801, 1.772, 1.253, 1.023, 0.886], u0: 0.172, Tr: 0.1, umin: 0, umax: 3 } };
  const full = step2(brim).points.find((q) => q.at === 1);
  assert.ok(!full.ok && /limit of its own/.test(full.why) && !/wired/.test(full.why), full.why);
  // Each point steps toward the middle of the table: down at 0.75 m.
  assert.ok(tank.points.find((q) => q.at === 0.75).du < 0);
  // Larger steps are made small enough, also for a single PI on the tank.
  const tank25 = step('Conical', { amplitude: 0.25 });
  assert.ok(tank25.after.J < 2.5 * tank25.before.cost.J && tank25.after.overshoot < 20, `${tank25.after.J / tank25.before.cost.J} ${tank25.after.overshoot}`);
  const empty = system('Conical');
  empty.system.plant.diagram.blocks.find((b) => b.type === 'controller').variant = 2;
  // Its run scores far better than the PI tuned for empty (cost ×0.42), but
  // the PI it fits is unstable at h = 0.15 m, where the run starts: it rests
  // there only in exact balance (u0 computed from the plant). With u0 0.1 %
  // off it rings at 3 Hz and empties the tank within 5 s; back at 0.15 m
  // after the drop (the 10 s cycle, inputs 50–52) it rings there too. So it
  // is not run.
  const pe = autotune(empty, null, { method: 'step', amplitude: 0.5 });
  assert.ok(pe.ok && pe.after.J < 0.5 * pe.before.cost.J, `${pe.before?.variant.name}: ${pe.why ?? pe.worse}`);
  assert.ok(!pe.better && pe.unstableAtStart?.Z === 2, pe.worse);
  // Smooth is slower than tight: smaller gains from the same tests.
  const calm = step('DC motor', { simc: 'smooth' });
  assert.ok(calm.variant.params.Kp < motor.variant.params.Kp && calm.variant.name.endsWith('· SIMC smooth'));
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
  // The library's tank runs a PI from the plant: Iterate tunes the schedule
  // its design computed (its Copy as numbers twin), from those numbers.
  const tank = system('Conical');
  const startKp = evaluateSystem(tank).info.designs[0].values.Kp;
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

test('every run a method yields says how much time it simulated; Iterate\'s carry the run, to sweep', async () => {
  const { autotuneSteps } = await import('../src/core/autotune.js');
  const p = system('Oven'), T = Math.max(...Object.values(p.system.signals).map((x) => x.period));
  for (const method of ['iterate', 'relay', 'step']) {
    const gen = autotuneSteps(p, null, { method, maxIter: 4 });
    let s, runs = 0, seconds = 0;
    for (;;) {
      s = gen.next();
      if (s.done) break;
      const v = s.value;
      if (v.seconds) { runs++; seconds += v.seconds; }
      else assert.ok(!v.partial || method !== 'iterate', `${method}: a partial yield without seconds (${v.phase ?? ''})`);
      if (method === 'iterate' && v.partial) {
        assert.equal(v.seconds, T, 'an Iterate run covers one period of the input');
        assert.ok(v.run?.t?.length > 1 && v.run.signals.T, 'and carries the run, with the signals the scope shows');
      }
    }
    assert.ok(s.value.ok, `${method}: ${s.value.why}`);
    if (method === 'iterate') assert.equal(runs, s.value.evals, 'Iterate: one yield with seconds per run of the loop');
    assert.ok(seconds >= runs * T, `${method}: ${runs} runs, ${seconds} s simulated`);
  }
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
  // The conical tank's gain scheduling against a fixed PID from a relay rule:
  // the PID is unstable where the run starts (h = 0.15 m), so it does not
  // run. Its run rests in exact balance until the first step; since the
  // tank's cycle is 10 s (inputs 50–52) it is back at 0.15 m after the drop
  // and rings there, and its run shows it (×4.4). Within the 5 s run it was,
  // its run alone would not tell (×0.95 to ×1.006 of the running variant's).
  const tank = autotune(system('Conical'), null, { method: 'relay' });
  assert.ok(tank.ok && !tank.better && tank.unstableAtStart?.Z === 6, `${tank.before.cost.J} → ${tank.after.J}`);
  assert.ok(tank.after.J > 2 * tank.before.cost.J, `back at the start level it rings: ${tank.after.J / tank.before.cost.J}`);
  const rep = tuneReport(tank);
  assert.equal(rep.better, false);
  // Why, in plain words: unstable at the start, and one PID where the
  // running variant schedules its gains (computed from the tank, up to
  // 0.95 m); and what its run shows, the ringing back at the start level.
  assert.equal(rep.worse, 'it is unstable where the run starts (the initial state, q = 0.172: 6 closed-loop poles outside the unit circle); the run rests there only because it starts in exact balance, and the first disturbance there sets it off; one PID from a relay test at h = 0.475 m; Gain-scheduled PI changes its gains with h (Kp 0.113 … 2.87), which a single PID cannot; it overshoots 23.1 % (the goal allows 10 %; Gain-scheduled PI: 7.74 %)');
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
  const out = JSON.parse(execFileSync('node', ['tools/cli.mjs', 'autotune', file, '--method', 'step', '--save', '--json']).toString());
  assert.ok(out.ok && out.better && out.K > 0.9 && out.after.cost.J < out.before.cost.J, JSON.stringify(out));
  const saved = JSON.parse(readFileSync(file, 'utf8')).system.plant.diagram.blocks.find((b) => b.id === 'ctrl');
  assert.equal(saved.variants[saved.variant].name, 'PID, badly tuned · SIMC');
  assert.match(execFileSync('node', ['tools/cli.mjs', 'autotune', file, '--method', 'relay', '--rule', 'zn']).toString(), /Ku 5/);
  // The motor ramps: the step test fits an integrator, and Smooth names its result.
  const motor = join(dir, 'motor.json');
  writeFileSync(motor, JSON.stringify(system('DC motor')));
  const m = JSON.parse(execFileSync('node', ['tools/cli.mjs', 'autotune', motor, '--method', 'step', '--simc', 'smooth', '--json']).toString());
  assert.ok(m.ok && m.better && m.model === 'integrating' && m.kp > 1.3 && m.simc === 'smooth', JSON.stringify(m));
  assert.equal(m.after.variant.name, 'P, too aggressive · SIMC smooth');
  assert.match(execFileSync('node', ['tools/cli.mjs', 'autotune', motor, '--method', 'step']).toString(), /ramps: k′ 1\.4/);
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
  // Following a sine with the PID: the u the loop needs is what the motor
  // needs to move, V = 0.7·θ' + 0.042·θ'' (+ a tiny jerk term) from the motor
  // in plants.js ((1 + 0.01 s)(1 + 0.2 s)/5 + 0.5 per rad/s). A sine never
  // rests, so Kff, what holds y at r, stays 0; the acceleration is told
  // apart from the speed.
  const p = system('Following a sine');
  const blk = p.system.plant.diagram.blocks.find((b) => b.type === 'controller');
  blk.variant = blk.variants.findIndex((v) => v.name === 'PID');
  const ctx = tuneContext(p, null);
  const fit = feedforwardStart(runVariant(ctx, ctx.variant), ctx.key, ctx.variant, ctx.others);
  assert.ok(fit.Kff === 0 && Math.abs(fit.Kv - 0.7) < 0.07 && fit.Ka > 0.02 && fit.Ka < 0.06, JSON.stringify(fit));
  const plain = runIterate(p, null, {}, { maxIter: 20 }), ff = runIterate(p, null, {}, { maxIter: 20, feedforward: true });
  assert.ok(ff.names.includes('Kv') && !plain.names.includes('Kv'));
  assert.ok(ff.best.cost.J < 0.5 * plain.best.cost.J, `cost with feedforward ${ff.best.cost.J}, without ${plain.best.cost.J}`);
  assert.ok(ff.best.variant.params.Kv > 1, `Kv ${ff.best.variant.params.Kv}: the motor's 0.7 plus what the D part on the measurement takes away`);
  assert.equal(ff.notes.length, 1, 'the sine has no disturbance: the feedback was held, and the result says so');
  // The DC motor on steps: its angle integrates, so no u is needed to hold
  // it anywhere and Kff, read where the loop rests, is about 0 (a fit over
  // the whole run read 1.16 V/rad from the transients). Samples where the
  // load torque acts are left out.
  const sq = system('DC motor');
  const sb = sq.system.plant.diagram.blocks.find((b) => b.type === 'controller');
  sb.variant = sb.variants.findIndex((v) => v.name === 'PD');
  const sctx = tuneContext(sq, null);
  const sfit = feedforwardStart(runVariant(sctx, sctx.variant), sctx.key, sctx.variant, sctx.others);
  assert.ok(Math.abs(sfit.Kff) < 0.05, JSON.stringify(sfit));
  // With feedforward and feedback gains, the feedforward is tuned first with
  // the feedback held; the feedback only when the run has a disturbance to
  // judge it by. Tuned together on this run without one, 250 iterations took
  // the feedback down to Kp 3.7, Ki 2.1 (three times the error under a load).
  const pf = system('Following a sine');
  const pb = pf.system.plant.diagram.blocks.find((b) => b.type === 'controller');
  pb.variant = pb.variants.findIndex((v) => v.name === 'PID + feedforward');
  // The stages a run goes through, and its result (the generator's return value).
  const stagesOf = (p, opts) => {
    const seen = [], gen = iterate(p, null, {}, opts);
    for (;;) { const s = gen.next(); if (s.done) return { seen, last: s.value }; if (seen.at(-1) !== s.value.stage) seen.push(s.value.stage); }
  };
  const sine = stagesOf(pf, { maxIter: 250 });
  assert.deepEqual(sine.seen, ['feedforward']);
  const q = sine.last.best.variant.params;
  assert.deepEqual([q.Kp, q.Ki, q.Kd], [30, 80, 1], 'the feedback is held');
  assert.ok(Math.abs(q.Kv - q.Kd - 0.7) < 0.05 && sine.last.notes.length === 1 && sine.last.names.join() === 'Kv', JSON.stringify(q));
  // The square-wave motor has a load pulse: both stages run.
  const dc = system('DC motor');
  const db = dc.system.plant.diagram.blocks.find((b) => b.type === 'controller');
  db.variant = db.variants.findIndex((v) => v.name === 'PID with prefilter');
  db.variants[db.variant].params.Kv = 2.2;
  const motor = stagesOf(dc, { maxIter: 20 });
  assert.deepEqual(motor.seen, ['feedforward', 'feedback']);
  assert.equal(motor.last.notes.length, 0);
  // Ticked on the oven (steps, little to explain): never worse than the start.
  const oven = runIterate(system('Oven'), null, {}, { maxIter: 10, feedforward: true });
  assert.ok(oven.best.cost.J <= oven.start.cost);
});

test('relay and step results move a feedforward that is on with the new gains (Kv with Kd, Kff with Kp(1 − b))', async () => {
  const { pidVariant } = await import('../src/core/autotune.js');
  const from = { type: 'pid', params: { Kp: 30, Ki: 80, Kd: 1, Tf: 0.02, b: 0.5, Kff: 0.5, Kv: 1.7, Ka: 0.03, aw: 'back', umin: -12, umax: 12 } };
  const v = pidVariant(from, { Kp: 20, Ki: 5, Kd: 0.6, Td: 0.03 }, 'x', 0.01).params;
  assert.ok(Math.abs(v.Kv - 1.3) < 1e-12, `Kv ${v.Kv}: the motor's 0.7 plus the new Kd`);
  assert.ok(Math.abs(v.Kff - (0.5 + (20 - 30) * 0.5)) < 1e-12, `Kff ${v.Kff}`);
  assert.equal(v.Ka, 0.03);
  assert.equal(v.aw, 'back');
  const off = pidVariant({ type: 'pid', params: { Kp: 3, Kd: 1, b: 0.5 } }, { Kp: 20, Ki: 5, Kd: 0.6 }, 'x', 0.01).params;
  assert.deepEqual([off.Kff, off.Kv], [0, 0], 'a feedforward that is off stays off');
  // The relay on the sine's PID + feedforward: Kv − Kd stays the motor's 0.7.
  const p = system('Following a sine');
  const blk = p.system.plant.diagram.blocks.find((b) => b.type === 'controller');
  blk.variant = blk.variants.findIndex((x) => x.name === 'PID + feedforward');
  const res = autotune(p, null, { method: 'relay', rule: 'tl' });
  assert.ok(res.ok && Math.abs(res.variant.params.Kv - res.variant.params.Kd - 0.7) < 1e-9, JSON.stringify(res.variant.params));
});

test('a variant from the plant: Auto-tune tunes the numbers its design computed, as a hand variant; a plan says why not', () => {
  // The tank's PI from the plant runs as a gain-scheduled PI with the table
  // its design computed: that twin is what Iterate starts from, and the
  // result is a hand variant (the designed one stays, following the plant).
  const tank = system('Conical');
  const des = evaluateSystem(tank).info.designs[0];
  const ctx = tuneContext(tank);
  assert.equal(ctx.variant.type, 'gainScheduled');
  assert.equal(ctx.variant.name, 'Gain-scheduled PI');
  assert.deepEqual(ctx.variant.params.Kp, des.values.Kp);
  assert.equal(ctx.variant.params.u0, des.values.u0);
  assert.deepEqual(ctx.designed, { label: 'PI from the plant', type: 'scheduledPI', from: 'gainScheduled' });
  // The triple pendulum's planned swing-up has no gains of its own.
  assert.throws(() => iterate(system('Triple'), null).next(), /A planned swing-up follows a plan computed from the plant/);
  // A design that refuses (the motor's LQR: its angle alone) leaves nothing to start from.
  const motor = system('DC motor');
  const c = motor.system.plant.diagram.blocks.find((b) => b.id === 'ctrl');
  c.variants = [{ name: 'LQR', type: 'lqr', params: { Q: [1], R: 1 } }];
  c.variant = 0;
  assert.throws(() => iterate(motor, null).next(), /LQR computes its numbers from the plant, and has none now/);
});

test('a relay result unstable where the run starts is not run, though its run rests in exact balance until the first step', () => {
  // The tank starts in exact balance (u0 computed from the plant), so a loop
  // unstable at h = 0.15 m rests there until the step at 1.5 s (in a 5 s run
  // it scored like the running variant's; since the drop back at 5 s of the
  // 10 s cycle it rings there after it, ×4.4). One PID from the relay test at
  // mid-range is unstable there: the loop linearised at the start says so.
  const tank = system('Conical');
  const res = autotune(tank, null, { method: 'relay' });
  assert.ok(res.ok);
  assert.ok(res.unstableAtStart, 'flagged');
  assert.ok(res.unstableAtStart.Z > 0);
  assert.equal(res.better, false);
  assert.match(res.worse, /^it is unstable where the run starts \(the initial state, q = 0\.172: \d+ closed-loop poles outside the unit circle\); the run rests there only because it starts in exact balance/);
  assert.deepEqual(tuneReport(res).unstableAtStart, { Z: res.unstableAtStart.Z, at: res.unstableAtStart.label });
  // The gain-scheduled PI it would replace is stable there, and so is the
  // oven's relay result, which runs (the oven starts at the heater's limit:
  // no verdict there, so nothing is flagged).
  const ctx = tuneContext(tank);
  assert.equal(unstableAtStart(tank, ctx, ctx.variant), null);
  const oven = autotune(system('Oven'), null, { method: 'relay' });
  assert.equal(oven.unstableAtStart, undefined);
  assert.equal(oven.better, true);
});
