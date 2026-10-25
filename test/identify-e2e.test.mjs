// Identify end to end, test 13 of design/output/identification.md §17, the
// identify part (Auto-tune on the model comes with step 9): the experiment and
// the model on the library's oven, motor and tank, each through its own block
// diagram with a sensor's noise (test 5's fixtures), and on five arms drawn
// within ±15 % (hil_plant.py's physics, test/fixtures/arm.mjs). Each model is
// scored against the plant it really ran on: its step response against the
// true plant's, and per place against the true plant's linearisation there.
// The numbers go to the test's diagnostics (node --test shows them).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identifySteps, knownFor, identifySettings, planExperiment, compactRecord, GRADE } from '../src/core/identify.js';
import { discretise, simulateSegment } from '../src/core/fit.js';
import { createStepRunner } from '../src/core/live.js';
import { normalizeProject } from '../src/core/project.js';
import { drain } from '../src/core/autotune.js';
import { diagramPlant, libraryProject, runExperiment, transferPlant, lag } from './fixtures/plants.mjs';
import { createArm, drawArm, armAt, NOMINAL } from './fixtures/arm.mjs';
import { armProject } from './fixtures/arm-project.mjs';
import { contSim } from './fixtures/continuous.mjs';

const fmt = (v, d = 3) => Number(v.toPrecision(d));
const params = (m) => Object.entries(m.params).map(([k, v]) => `${k} ${fmt(v)}±${fmt(2 * (m.sd[k] ?? 0), 2)}`).join(', ');
const places = (m) => m.where.filter((pl) => pl.seen >= GRADE.seen);

// The model's response to a unit step of u, at the record's Ts, from rest.
function modelStep(m, N) {
  return simulateSegment(discretise(m.structure, m.params, m.Ts), { u: new Float64Array(N).fill(1), yStart: 0, uStart: 0, n: N }).y;
}
// A true transfer function's, sampled the same way.
function trueStep(num, den, theta, Ts, N) {
  const s = contSim(num, den, theta, Ts);
  const y = new Float64Array(N);
  for (let k = 0; k < N; k++) { y[k] = s.output(); s.advance(1); }
  return y;
}
const worstOf = (a, b) => a.reduce((w, v, k) => Math.max(w, Math.abs(v - b[k])), 0);

// The experiment on a library system through its diagram with a sensor's
// noise, then the model from the record as Keep stores it.
function libraryRun(name, sensor) {
  const project = libraryProject(name);
  const known = knownFor(project);
  const plan = planExperiment(known, identifySettings(project, null, { known }));
  const plant = diagramPlant(project, 'ctrl', { hold: Object.fromEntries(plan.others.map((o) => [o.name, o.value])), ...sensor });
  const res = runExperiment(plan, plant);
  const record = compactRecord(res.record);
  return { plan, res, record, model: drain(identifySteps(record, { plan })) };
}

test('13 (identify). The oven: two lags and a dead time, its step within 2 % of the three lags it is, as good as its noise allows', (t) => {
  const { res, model: m } = libraryRun('Oven', { noise: 0.1 });
  assert.equal(res.exp.state.end.code, 'done');
  assert.ok(m.ok && m.check.fit >= 95, `fit ${m.check.fit}`);
  // The oven is heater 0.1 s, chamber 0.5 s, thermocouple 0.05 s and 0.1 s to the sensor, K 1.
  const N = 250;
  const truth = trueStep([1], [0.1 * 0.5 * 0.05, 0.1 * 0.5 + 0.1 * 0.05 + 0.5 * 0.05, 0.65, 1], 0.1, m.Ts, N);
  const step = modelStep(m, N), worst = worstOf(step, truth);
  assert.ok(worst < 0.02, `step ${worst}`);
  // Two lags for three lags and a dead time: the gain within 1.5 % (its ±2σ
  // bar is far narrower: bars understate when the structure is wrong, §6.5).
  assert.ok(Math.abs((m.params.K ?? 0) - 1) < 0.015, `K ${m.params.K}`);
  assert.ok(!m.whereSpread.flagged, 'a linear plant is the same everywhere');
  // ✓, or ! for a pattern alone: two lags for three lags and a dead time
  // leave a slow error of about 0.1 °C in the cooling tail, which σ 0.1 °C
  // over a 9 s Check sometimes shows and sometimes hides (✓ on 3 to 6 of 10
  // noise seeds, before and after the review's fixes). Either way the Check
  // fit is within its noise ceiling's reach.
  assert.ok(m.grade === '✓' || (m.grade === '!' && m.why.every((w) => w.startsWith('what is left has a pattern'))), m.why.join('; '));
  assert.ok(m.check.fit >= m.check.ceiling - 0.3, `fit ${m.check.fit}, ceiling ${m.check.ceiling}`);
  // The heater cannot cool: its PI sat at 0 % while the oven cooled, and the
  // model says its bars may be too narrow there (they take the loop as linear).
  assert.ok(m.warnings.some((w) => /^P was at its limit in \d+ % of the loop's test: the ± bars may be too narrow$/.test(w)), m.warnings.join('; '));
  t.diagnostic(`oven: ${m.structure}, fit ${fmt(m.check.fit)} % (ceiling ${fmt(m.check.ceiling)}, kernel ${fmt(m.check.kernel)}), ${m.grade}; ${params(m)}; step within ${fmt(100 * worst, 2)} % of the truth`);
});

test('13 (identify). The motor: an integrator with a lag, k′ within 1 % of Kt/(R·b + Kt·Ke)', (t) => {
  const { res, model: m } = libraryRun('DC motor, position', { q: (2 * Math.PI) / 4096 });
  assert.equal(res.exp.state.end.code, 'done');
  assert.ok(m.ok && m.check.fit >= 95, `fit ${m.check.fit}`);
  assert.ok(['intLag', 'intRes'].includes(m.structure), m.structure);
  const kp = 0.5 / (1 * 0.1 + 0.5 * 0.5);
  assert.ok(Math.abs(m.params.kp - kp) < 0.01 * kp, `k′ ${m.params.kp} against ${kp}`);
  // Angle per volt: 0.5 / ((0.01 s + 1)(0.02 s + 0.1) + 0.25) / s.
  const N = 100;
  const truth = trueStep([0.5], [0.0002, 0.021, 0.35, 0], 0, m.Ts, N);
  const worst = worstOf(modelStep(m, N), truth) / truth[N - 1];
  assert.ok(worst < 0.01, `step ${worst}`);
  assert.ok(m.sentences.includes('Noise on angle: only its steps of 0.0015 rad (an encoder).'), m.sentences.join(' | '));
  t.diagnostic(`motor: ${m.structure}, fit ${fmt(m.check.fit)} %, ${m.grade}; ${params(m)} (k′ true ${fmt(kp, 4)}); step within ${fmt(100 * worst, 2)} % over 1 s`);
});

test('13 (identify). The conical tank: one lag as a compromise, and per place the tank\'s own gain and time constant; where-spread flagged', (t) => {
  const { res, model: m } = libraryRun('Conical tank', { noise: 0.001 });
  assert.equal(res.exp.state.end.code, 'done');
  assert.ok(m.ok && m.check.fit >= 85, `fit ${m.check.fit}`);
  assert.ok(m.whereSpread.flagged, 'behaves differently at different places');
  assert.ok(m.sentences.some((s) => s.startsWith('Behaves differently at different places: near ')));
  assert.notEqual(m.grade, '✓');
  // The tank (r0 0.05, R 0.5, H 1, a 0.1) linearised at a level h: q = a√(2gh)
  // holds it; K = √(2gh)/(a·g), τ = A(h)·K.
  const lin = (h) => { const K = Math.sqrt(2 * 9.81 * h) / (0.1 * 9.81), r = 0.05 + 0.45 * h; return { K, tau: Math.PI * r * r * K }; };
  const lines = [];
  for (const pl of places(m)) {
    const tr = lin(pl.level);
    lines.push(`near ${fmt(pl.level)} m: K ${fmt(pl.gain)} (true ${fmt(tr.K)}), τ ${fmt(pl.scale)} (true ${fmt(tr.tau)})`);
    assert.ok(Math.abs(pl.gain - tr.K) < 0.1 * tr.K, lines.at(-1));
    assert.ok(Math.abs(pl.scale - tr.tau) < 0.2 * tr.tau, lines.at(-1));
  }
  assert.ok(places(m).length >= 2);
  t.diagnostic(`tank: ${m.structure}, fit ${fmt(m.check.fit)} % (ceiling ${fmt(m.check.ceiling)}), ${m.grade}; ${params(m)}; ${lines.join('; ')}`);
});

test('13 (identify). Five arms within ±15 %: fit, grade, and per place the gain the arm has there', (t) => {
  const Ts = 0.01;
  const r = Array.from({ length: 500 }, (_, k) => (k * Ts > 0.5 && k * Ts <= 3.0 ? 1.5 : 0));
  const known = {
    block: { path: ['ctrl'], key: 'ctrl', where: 'controller' }, live: true,
    u: { name: 'V', unit: 'V', min: -12, max: 12, u0: 0, from: 'both' }, y: { name: 'angle', unit: 'rad', hard: [-2.5, 2.5], from: 'plant' },
    r: { lo: 0, hi: 1.5, span: 1.5, source: 'r', period: 5, samples: r, Ts }, Ts, others: [{ name: 'd', value: 0, input: 'load' }],
  };
  const plan = planExperiment(known, { budget: 120 });
  for (let seed = 1; seed <= 5; seed++) {
    const p = drawArm(seed);
    const arm = createArm(p, { Ts, seed });
    const res = runExperiment(plan, arm, { applied: true });
    assert.equal(arm.estop, null);
    assert.equal(res.exp.state.end.code, 'done');
    const m = drain(identifySteps(compactRecord(res.record), { plan }));
    assert.ok(m.ok && m.check.fit >= 75, `arm ${seed}: fit ${m.check.fit}`);
    // The arm at rest: its gain (k/R)/(mgl·cos θ) and its swing.
    const at0 = armAt(p, 0);
    assert.ok(m.params.K > 0.9 * at0.gain && m.params.K < 1.5 * at0.gain, `arm ${seed}: K ${m.params.K} against ${at0.gain} at rest`);
    // Per place: low near the true gain there, high above low (gravity holds
    // the arm less near horizontal). The high place is understated today
    // (0.56–0.74 of the truth there: the arm holds 1.5 rad still and passes
    // the high third only between steps; step 8's Shake looks there), so its
    // bound is two-sided around the truth and leaves room to become right.
    const pl = places(m), lo = pl[0], hi = pl.at(-1);
    const tLo = armAt(p, lo.level).gain, tHi = armAt(p, hi.level).gain;
    assert.ok(Math.abs(lo.gain - tLo) < 0.15 * tLo, `arm ${seed}: near ${lo.level} K ${lo.gain} against ${tLo}`);
    assert.ok(hi.gain > 1.3 * lo.gain && hi.gain > 0.4 * tHi && hi.gain < 1.25 * tHi, `arm ${seed}: near ${hi.level} K ${hi.gain} (true ${tHi}), low ${lo.gain}`);
    assert.ok(m.whereSpread.flagged, `arm ${seed}: places not told apart`);
    assert.equal(m.grade, '!');
    t.diagnostic(`arm ${seed}: ${m.structure}, fit ${fmt(m.check.fit)} % (ceiling ${fmt(m.check.ceiling)}, kernel ${fmt(m.check.kernel)}), ${m.grade} (${m.why.join('; ')}); ${params(m)}; at rest K ${fmt(at0.gain)}, f ${fmt(at0.f)}, ζ ${fmt(at0.zeta, 2)}; ${pl.map((x) => `near ${fmt(x.level, 2)} rad K ${fmt(x.gain)} (true ${fmt(armAt(p, x.level).gain)})`).join(', ')}; ${fmt(res.record.y.length * Ts)} s`);
  }
});

test('the simulated arm (a test fixture for the command line) is hil_plant.py\'s physics: it agrees with the ported arm within 5 mrad (the round trip is a Dead time block, within half an integration step)', () => {
  const Ts = 0.01;
  for (const p of [NOMINAL, drawArm(3)]) {
    const proj = normalizeProject(armProject(p, { noise: 0, counts: 0 }));
    const V = (k) => (k < 100 ? 0 : k < 200 ? 1.5 : k < 300 ? -1 : k < 450 ? 1.2 : 0.5 * Math.sin(k / 30));
    let kk = 0;
    const run = createStepRunner(proj.system.plant.diagram, proj.system.signals, { Ts, sources: { r: () => 0, d: () => 0 }, variants: { ctrl: { name: 'V', type: 'pid', params: {}, law: () => ({ step: () => V(kk++) }) } } });
    const ia = run.names().indexOf('angle');
    const arm = createArm(p, { Ts, noise: 0, counts: 0, hard: null });
    let worst = 0;
    for (let k = 0; k < 700; k++) {
      worst = Math.max(worst, Math.abs(run.step().values[ia] - arm.output()));
      arm.advance(V(k));
    }
    assert.ok(worst < 5e-3, `${worst}`);
  }
});

test('6 (in the model). Coloured noise: its colour and level read from Listen, the bars widened by it, and a pattern said to be the noise\'s own', () => {
  // A lag (K 2, τ 0.5 s, θ 0.05 s) under the whole test, its sensor noise an
  // AR(1) at 0.9 with σ 0.005: Listen's σ from differences reads σ√(1 − ρ).
  const Ts = 0.01, r = Array.from({ length: 600 }, (_, k) => (k >= 50 && k < 550 ? 1 : 0));
  const known = {
    block: { path: ['c'], key: 'c', where: 'c' }, live: false,
    u: { name: 'u', unit: '', min: -2, max: 2, u0: 0, from: 'controller' },
    y: { name: 'y', unit: '', hard: null, from: null },
    r: { lo: 0, hi: 1, span: 1, source: 'r', period: 6, samples: r, Ts }, Ts, others: [],
  };
  const plan = planExperiment(known);
  const run = (opts) => {
    const res = runExperiment(plan, transferPlant(lag(2, 0.5, 0.05), Ts, opts));
    return drain(identifySteps(compactRecord(res.record), { plan }));
  };
  const m = run({ noise: 0.005, ar: 0.9, seed: 5 });
  assert.ok(m.ok, m.message);
  assert.equal(m.noise.coloured, true);
  assert.ok(Math.abs(m.noise.sigma - 0.005) < 0.0015, `σ ${m.noise.sigma}`);
  const ys = m.check.y, mean = ys.reduce((a, b) => a + b, 0) / ys.length;
  const ceilingAt = (s) => 100 * (1 - (s * Math.sqrt(ys.length)) / Math.hypot(...ys.map((v) => v - mean)));
  assert.ok(Math.abs(m.check.ceiling - ceilingAt(m.noise.sigma)) < 1e-9, 'the ceiling from the noise\'s level, not from its differences');
  if (!m.check.white) assert.ok(m.why.includes('what is left has a pattern, as the noise at rest has'), m.why.join('; '));
  // White noise reads white: the plain reasons, the plain level.
  const w = run({ noise: 0.002, seed: 5 });
  assert.equal(w.noise.coloured, false);
  assert.ok(Math.abs(w.noise.sigma - 0.002) < 0.0004, `σ ${w.noise.sigma}`);
});
