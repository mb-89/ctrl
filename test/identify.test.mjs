// Identify, step 5 of design/output/identification.md §18: the runner and the
// whole test in Node. The hidden 'experiment' controller type, createStepRunner
// (one controller sample at a time, Sources overridable, shared with the live
// runner), identify() and its model, and the tests §17 numbers 11 (the rest:
// linearModel, the twin, Copy as blocks), 12 (storage), 17 (varyDiagram) and
// 19 (the command line). Test 13's identify part, on the oven, the motor, the
// tank and five arms, is in identify-e2e.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  identify, identifySteps, segmentsOf, replay, compactRecord, linearModel, twinSubsystem, varyDiagram, modelSentences, withBar, gradeOf, knownFor, planExperiment, settingsFor, GRADE,
} from '../src/core/identify.js';
import { createStepRunner, createLiveRunner } from '../src/core/live.js';
import { simulateSystem } from '../src/core/sim.js';
import { normalizeVariant, makeLaw, HIDDEN, CONTROLLERS, CONTROLLER_TYPES } from '../src/core/controllers.js';
import { normalizeProject, IDENTIFY_COMPUTED } from '../src/core/project.js';
import { normalizeDiagram, ELEMENTS, diagramBlockDef } from '../src/core/diagram.js';
import { STRUCTURES, discretise, simulateSegment } from '../src/core/fit.js';
import { piLaw, bumpless } from '../src/core/experiment.js';
import { csolve } from '../src/core/linalg.js';
import { drain } from '../src/core/autotune.js';
import { libraryProject } from './fixtures/plants.mjs';

const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const json = (x) => JSON.parse(JSON.stringify(x));

// One identify() of the library's motor (36 s of plant time), shared.
let motorRun = null;
const motor = () => (motorRun ??= { project: libraryProject('DC motor, position'), res: identify(libraryProject('DC motor, position')) });

// ---- The hidden law and the runner

test('the hidden controller type "experiment": never in the library, refused in files with its sentence, run as a block\'s law', () => {
  assert.ok(!CONTROLLER_TYPES.includes('experiment') && !('experiment' in CONTROLLERS), 'not in the library');
  assert.ok(HIDDEN.experiment);
  assert.throws(() => normalizeVariant({ type: 'experiment', params: { plan: {} } }), /experiment is the page's own: Identify runs it for its test, and a file never holds one/);
  const p = libraryProject('Oven');
  p.system.plant.diagram.blocks.find((b) => b.id === 'ctrl').variants.push({ name: 'sneaked in', type: 'experiment', params: {} });
  assert.throws(() => normalizeProject(json(p)), /variants\[2\]: experiment is the page's own/);
  // As a law it is the experiment: its machine on law.experiment, k counted
  // from 0, or named by a live runner (at) with the applied u.
  const { project, res } = motor();
  const law = makeLaw({ type: 'experiment', params: { plan: res.plan } }, res.plan.Ts);
  assert.equal(typeof law.experiment.reference, 'function');
  assert.equal(law.step([0, 0]), res.plan.u0);
  law.at(5, 0.25);
  law.step([0, 0]);
  assert.deepEqual(law.experiment.record().gaps, [[1, 4]], 'a jump in the plant\'s seq is a gap');
  assert.ok(project);
});

test('createStepRunner: one controller sample at a time, the same as simulateSystem bit for bit; Sources overridable; the live runner unchanged', () => {
  for (const name of ['Oven', 'DC motor, position', 'Conical tank', 'Mass', 'DC motor, sliding']) {
    const p = libraryProject(name);
    const d = p.system.plant.diagram;
    const Ts = d.blocks.find((b) => b.type === 'controller')?.params.Ts ?? 0.01;
    const ref = simulateSystem(d, p.system.signals, { duration: 5, sampleTime: Ts });
    const run = createStepRunner(d, p.system.signals, { Ts });
    const names = run.names();
    for (let k = 0; k <= Math.round(5 / Ts); k++) {
      const s = run.step();
      assert.equal(s.k, k);
      names.forEach((n, j) => assert.ok(Object.is(s.values[j], ref.signals[n][k]), `${name}: ${n} at ${k}: ${s.values[j]} against ${ref.signals[n][k]}`));
    }
  }
  // A Source the caller plays: r from a function of t, d held at 0.3.
  const p = libraryProject('Oven');
  const run = createStepRunner(p.system.plant.diagram, p.system.signals, { Ts: 0.02, sources: { r: (t) => 10 * Math.floor(t / 0.02 + 1e-9), d: () => 0.3 } });
  const ir = run.names().indexOf('r'), id = run.names().indexOf('d');
  for (let k = 0; k < 20; k++) { const v = run.step().values; assert.equal(v[ir], 10 * k); assert.equal(v[id], 0.3); }
  // A variant set after normalising: a law of the caller's, reached by key.
  const seen = [];
  const r2 = createStepRunner(p.system.plant.diagram, p.system.signals, { Ts: 0.02, variants: { ctrl: { name: 'probe', type: 'pid', params: {}, law: () => ({ step: (x) => { seen.push(x[1]); return 7; } }) } } });
  for (let k = 0; k < 5; k++) r2.step();
  assert.equal(seen.length, 5);
  assert.equal(typeof r2.law('ctrl').step, 'function');
  assert.throws(() => createStepRunner(libraryProject('HIL: an external plant').system.plant.diagram, {}, { Ts: 0.01 }), /outside the page/);
  // The live runner shares the core: an External plant still steps as before.
  const live = createLiveRunner(libraryProject('HIL: an external plant').system.plant.diagram, libraryProject('HIL: an external plant').system.signals);
  assert.deepEqual(live.step(0, [0.1, 0, 0]).u.length, 1);
});

test('identify(): the experiment runs as the block\'s hidden law in a copy, r plays its reference, d is held, the plant time stays within the budget', () => {
  const { project, res } = motor();
  assert.equal(res.ok, true);
  assert.equal(res.end.code, 'done');
  assert.ok(res.time <= res.plan.budget);
  // The record's r is the experiment's reference (r(0) held, then the test's).
  const tries = res.record.log.filter((e) => e.kind === 'try');
  assert.ok(tries.length >= 1);
  const T = tries[0];
  assert.deepEqual(res.record.r.slice(T.iSwitch, T.iSwitch + 250), res.plan.test.r.slice(0, 250).map((v) => Number(v.toPrecision(6)) + 0));
  // The project was not touched; the block keeps its variants.
  assert.equal(project.system.plant.diagram.blocks.find((b) => b.id === 'ctrl').variants[0].type, 'pid');
  // The model and its words.
  const m = res.model;
  assert.equal(m.structure, 'intLag');
  assert.ok(Math.abs(m.params.kp - 1.4286) < 0.01 * 1.4286, `k′ ${m.params.kp}`);
  assert.ok(m.sentences.length >= 3 && m.sentences.length <= 6, m.sentences.join(' | '));
  assert.ok(m.sentences.some((s) => /^Keeps moving as long as it is pushed: 1 V for 1 s moves it 1\.4\d+ ± 0\.00\d+ rad \(it integrates\)\.$/.test(s)), m.sentences.join(' | '));
  assert.ok(m.sentences.includes('This plant has no noise; real plants do.'));
});

// ---- The closed-loop replay

test('the closed-loop replay rebuilds the logged law: fed the measured y it gives back every u the experiment sent', () => {
  const { res } = motor();
  const { record, plan } = res;
  const seg = segmentsOf(record, plan);
  assert.ok(seg.open && seg.closed.length >= 2 && seg.check, 'Nudge, Hold and tries, Check');
  // A "model" that answers with the measured y: the law then sees what the
  // experiment saw, from each segment's start on (bumpless at its rest).
  for (const s of [...seg.closed, seg.check]) {
    const before = s.before;
    let law = before ? piLaw(before, bumpless(before, s.uStart, s.rPrev, s.yStart), before.umin, before.umax, plan.Ts) : null, uLast = s.uStart;
    let worst = 0;
    for (let i = s.i0; i < s.i1; i++) {
      const sw = s.switches.find((e) => e.i === i);
      if (sw) law = piLaw(sw, bumpless(sw, record.u[i - 1], record.r[i], record.y[i]), sw.umin, sw.umax, plan.Ts);
      const u = law.step(record.r[i], record.y[i]);
      uLast = u;
      // Exact from the first switch on (before it the law starts from the rest's estimate).
      if (s.switches.length && i >= s.switches[0].i) worst = Math.max(worst, Math.abs(u - record.u[i]));
    }
    assert.ok(worst < 1e-5 * (plan.umax - plan.umin), `${s.role} ${s.i0}…${s.i1}: ${worst}`);
  }
  // replay() is the model's y over a segment, from r alone.
  const y = replay(record, res.model, seg.check);
  assert.equal(y.length, seg.check.i1 - seg.check.i0);
  assert.ok(Math.abs(y[0] - seg.check.yStart) < 1e-12);
});

// ---- 11. Models

const MODELS = {
  lag: { K: 2, tau: 0.3, theta: 0.03 },
  lags: { K: 2, tau1: 0.3, tau2: 0.08, theta: 0.03 },
  resonance: { K: 1.5, f: 1.2, zeta: 0.3, theta: 0.02 },
  intLag: { kp: 3, tau: 0.1, theta: 0.02 },
  intRes: { kp: 2, f: 2, zeta: 0.4, theta: 0.01 },
};
const modelOf = (structure, params = MODELS[structure], noise = { sigma: 0, q: 0 }) => ({ structure, params, Ts: 0.01, names: { u: 'u', uUnit: 'V', y: 'y', yUnit: 'm' }, noise, band: [0, 1], sentences: [], warnings: [] });

test('11. linearModel matches each structure\'s transfer function (with its dead time); states named by the chain', () => {
  for (const [name, p] of Object.entries(MODELS)) {
    const lm = linearModel(modelOf(name));
    assert.deepEqual(lm.delay, [p.theta]);
    assert.deepEqual(lm.states.map((s) => s.label), STRUCTURES[name].ss(p).states.map((s) => s.label));
    assert.equal(lm.op.kind, 'identified');
    assert.deepEqual(lm.sensors, [{ std: 0, q: 0 }]);
    const tf = STRUCTURES[name].tf(p);
    for (const w of [0.3, 1, 3, 10, 30]) {
      // C (jωI − A)⁻¹ B e^(−jωθ) against num(jω)/den(jω) e^(−jωθ).
      const n = lm.A.length;
      const Mr = lm.A.map((row) => row.map((v) => -v)), Mi = lm.A.map((row, i) => row.map((_, j) => (i === j ? w : 0)));
      const { xr, xi } = csolve(Mr, Mi, lm.B.map((r) => r[0]), new Array(n).fill(0));
      let gr = lm.D[0][0], gi = 0;
      for (let i = 0; i < n; i++) { gr += lm.C[0][i] * xr[i]; gi += lm.C[0][i] * xi[i]; }
      const poly = (c) => { let re = 0, im = 0; c.forEach((v, k) => { const pw = c.length - 1 - k; const a = w ** pw; const ph = pw % 4; if (ph === 0) re += v * a; else if (ph === 1) im += v * a; else if (ph === 2) re -= v * a; else im -= v * a; }); return [re, im]; };
      const [nr, ni] = poly(tf.num), [dr, di] = poly(tf.den);
      const den = dr * dr + di * di, hr = (nr * dr + ni * di) / den, hi = (ni * dr - nr * di) / den;
      const rot = (re, im) => [re * Math.cos(w * p.theta) + im * Math.sin(w * p.theta), im * Math.cos(w * p.theta) - re * Math.sin(w * p.theta)];
      const [ar, ai] = rot(gr, gi), [br, bi] = rot(hr, hi);
      assert.ok(Math.hypot(ar - br, ai - bi) < 1e-9 * Math.hypot(br, bi), `${name} at ${w} rad/s`);
    }
  }
});

test('11. the twin subsystem simulates the same as replay, open and closed loop; Copy as blocks holds primitives only', () => {
  const PRIMITIVES = new Set(['inport', 'outport', 'gain', 'sum', 'delay', 'integrator', 'firstOrder', 'secondOrder', 'noise', 'quantizer']);
  const Ts = 0.01, N = 400;
  for (const [name, p] of Object.entries(MODELS)) {
    for (const theta of [0, p.theta]) {
      const params = { ...p, theta };
      const model = modelOf(name, params);
      const twin = twinSubsystem(model, { noise: false });
      const types = twin.diagram.blocks.map((b) => b.type);
      assert.ok(types.every((t) => PRIMITIVES.has(t)), `${name}: ${types}`);
      // The twin as the plant of a loop: u from a law (a staircase, or a PI
      // on r = 1 fed the twin's y), y read at each sample.
      for (const closed of [false, true]) {
        const g = { Kp: 0.4, Ki: 0.8 };
        const uOf = (k) => (k < 20 ? 0 : k < 150 ? 0.5 : k < 260 ? -0.3 : 0.2);
        const diagram = normalizeDiagram({
          blocks: [
            { id: 'r', type: 'source', params: { signal: 'r' } },
            { id: 'ctrl', type: 'controller', params: { inputs: 2, Ts }, variants: [{ type: 'pid', params: {} }] },
            twin,
            { id: 'y', type: 'sink', params: { name: 'y' } },
          ],
          wires: [{ from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'twin' }, { from: 'twin', to: 'y' }, { from: 'twin', to: 'ctrl:1' }],
        });
        let k = 0;
        const law = () => { const pi = piLaw(g, 0, -5, 5, Ts); return { step: (x) => (closed ? pi.step(k++ < 20 ? 0 : 1, x[1]) : uOf(k++)) }; };
        const run = createStepRunner(diagram, { r: { period: 1, components: [] } }, { Ts, variants: { ctrl: { type: 'pid', params: {}, law } } });
        const iy = run.names().indexOf('y');
        const got = Array.from({ length: N }, () => run.step().values[iy]);
        const seg = closed
          ? { y: new Float64Array(N), yStart: 0, uStart: 0, law: () => { const pi = piLaw(g, 0, -5, 5, Ts); return (kk, yh) => pi.step(kk < 20 ? 0 : 1, yh); } }
          : { y: new Float64Array(N), yStart: 0, uStart: 0, u: Float64Array.from({ length: N }, (_, kk) => uOf(kk)) };
        const want = simulateSegment(discretise(name, params, Ts), seg).y;
        let worst = 0, scale = 0;
        for (let j = 0; j < N; j++) { worst = Math.max(worst, Math.abs(got[j] - want[j])); scale = Math.max(scale, Math.abs(want[j])); }
        // Without a dead time the twin is the replay to RK4's accuracy. With one,
        // the diagram's Dead time block interpolates its input between
        // integration steps (here one step is Ts): on a held input that moves
        // each jump by up to half a step, 1–3 % of the response here.
        assert.ok(worst <= (theta ? 3.5e-2 : 2e-6) * scale, `${name} θ ${theta} ${closed ? 'closed' : 'open'}: ${worst} of ${scale}`);
      }
    }
  }
  // With the noise the plant showed and the test push (§10).
  const t2 = twinSubsystem(modelOf('lag', MODELS.lag, { sigma: 0.01, q: 0.002 }), { push: true });
  assert.deepEqual(t2.diagram.blocks.map((b) => b.type), ['inport', 'inport', 'sum', 'gain', 'delay', 'firstOrder', 'noise', 'quantizer', 'outport']);
  assert.ok(normalizeDiagram(t2.diagram));
});

// ---- 12. Storage

test('12. Keep round-trips through the project file with no computed fields; computed keys are refused with the sentence; a kept record recomputes the same model bit for bit', () => {
  const { project, res } = motor();
  // Two runs: identical records and models.
  const again = identify(libraryProject('DC motor, position'));
  assert.equal(JSON.stringify(again.record), JSON.stringify(res.record));
  assert.equal(JSON.stringify(again.model), JSON.stringify(res.model));
  // Keep: the record and its plan, nothing computed.
  const kept = structuredClone(project);
  kept.system.identify = { ctrl: { budget: 60, kept: [{ name: 'angle · test 1', plan: res.plan, record: res.record }], use: 0 } };
  const file = JSON.parse(JSON.stringify(normalizeProject(kept)));
  const back = normalizeProject(file);
  assert.deepEqual(back.system.identify, file.system.identify, 'round-trips');
  const k = back.system.identify.ctrl.kept[0];
  assert.deepEqual(Object.keys(k).sort(), ['name', 'plan', 'record']);
  assert.deepEqual(Object.keys(k.record).sort(), ['Ts', 'applied', 'end', 'gaps', 'log', 'r', 'u', 'version', 'y']);
  // The model from the kept record is the one the run gave, bit for bit.
  const model = drain(identifySteps(k.record, { plan: k.plan }));
  assert.equal(JSON.stringify(model), JSON.stringify(res.model));
  // The record as kept is compact (§9): y on a tenth of its floor, u and r to 6 digits.
  assert.deepEqual(compactRecord(res.record), res.record);
  assert.ok(res.record.u.every((v) => v === null || Number(v.toPrecision(6)) === v));
  // Computed keys are refused with the sentence, wherever they are put.
  const refuse = (edit) => {
    const f = structuredClone(file);
    edit(f.system.identify.ctrl);
    assert.throws(() => normalizeProject(f), (err) => err.message.endsWith(IDENTIFY_COMPUTED));
  };
  refuse((e) => { e.model = res.model; });
  refuse((e) => { e.kept[0].params = { kp: 1.43 }; });
  refuse((e) => { e.kept[0].record.fit = 99; });
  refuse((e) => { e.kept[0].plan.gains = { Kp: 1 }; });
  assert.equal(IDENTIFY_COMPUTED, 'Identify keeps the measurements; the model is computed from them. To keep numbers, use Copy as blocks.');
  // Design inputs are checked.
  const bad = structuredClone(file);
  bad.system.identify.ctrl.vary = { share: 2, seed: 1 };
  assert.throws(() => normalizeProject(bad), /vary/);
  // A stored setting is used: the budget of 60 s shortens nothing here, a band does.
  const s = settingsFor(knownFor(back), back.system.identify.ctrl);
  assert.deepEqual([s.budget.value, s.budget.from], [60, 'yours']);
});

// ---- The grade and the words

test('the grade (§7) and the sentences (§8): thresholds named, numbers rounded to their bars', () => {
  assert.deepEqual(gradeOf({ fit: 91, ceiling: 99 }), { mark: '✓', why: [] });
  assert.equal(gradeOf({ fit: 84, ceiling: 86 }).mark, '✓', 'within 3 points of the ceiling');
  assert.deepEqual(gradeOf({ fit: 77, ceiling: 99 }), { mark: '!', why: ['it explains under 85 %'] });
  assert.equal(gradeOf({ fit: 95, white: false }).mark, '!');
  assert.equal(gradeOf({ fit: 95, spread: GRADE.where }).mark, '!');
  assert.equal(gradeOf({ fit: 95, kernelGap: 5 }).mark, '!');
  assert.equal(gradeOf({ fit: 95, distortion: 31 }).mark, '✕', 'distortion above 30 %, whatever else');
  assert.equal(gradeOf({ fit: 59 }).mark, '✕');
  assert.equal(gradeOf({ fit: 99, left: true }).mark, '✕');
  assert.equal(withBar(0.534, 0.0106), '0.53 ± 0.02');
  assert.equal(withBar(0.534, 0.007), '0.534 ± 0.014');
  assert.equal(withBar(1234, 40), '1230 ± 80');
  assert.equal(withBar(2.5, null), '2.5');
  const m = { ...modelOf('resonance', { K: 0.53, f: 0.96, zeta: 0.3, theta: 0.002 }), sd: { K: 0.01, f: 0.01, zeta: 0.02, theta: 0.0005 }, grade: '✓', check: { fit: 91.2, white: true }, noise: { sigma: 0.0013, q: 0.0015, steps: true }, whereSpread: { flagged: false } };
  const s = modelSentences(m, { u: 'V', uUnit: 'V', y: 'angle', yUnit: 'rad' });
  assert.deepEqual(s, [
    'Responds after 2 ms.',
    `Swings at about ${Number((0.96 * Math.sqrt(1 - 0.09)).toPrecision(2))} Hz and settles in about 1.9 s.`,
    '1 V more gives 0.53 ± 0.02 rad more.',
    'Noise on angle: 0.0013 rad, in steps of 0.0015 rad (an encoder).',
    'Explains 91 % of a test it was not fitted to; what is left looks like noise ✓.',
  ]);
});

// ---- 17. Teaching: Hide a variation

test('17. varyDiagram with a seed is reproducible and varies only the flagged physical parameters; Kt = Ke stay one constant', () => {
  const p = libraryProject('DC motor, position');
  const d = p.system.plant.diagram;
  const a = varyDiagram(d, 0.15, 7), b = varyDiagram(d, 0.15, 7), c = varyDiagram(d, 0.15, 8);
  assert.deepEqual(a, b, 'reproducible');
  assert.notDeepEqual(a.factors.map((f) => f.factor), c.factors.map((f) => f.factor));
  assert.deepEqual(d, libraryProject('DC motor, position').system.plant.diagram, 'the project is not touched');
  // Only flagged parameters change, each within ±15 %.
  const walk = (x, y, path = []) => x.blocks.forEach((bx, i) => {
    const by = y.blocks[i];
    if (bx.type === 'subsystem') return walk(bx.diagram, by.diagram, [...path, bx.id]);
    const def = diagramBlockDef(bx.type);
    for (const [key, v] of Object.entries(bx.params ?? {})) {
      const spec = def.params?.find((q) => q.key === key);
      if (JSON.stringify(v) !== JSON.stringify(by.params[key])) assert.ok(spec?.vary, `${[...path, bx.id].join('/')}.${key} changed without a flag`);
    }
    if (bx.variants) assert.deepEqual(bx.variants, by.variants, 'controllers are not varied');
  });
  walk(d, a.diagram);
  assert.ok(a.factors.length > 0 && a.factors.every((f) => f.factor >= 0.85 && f.factor <= 1.15));
  const kinds = new Set(a.factors.map((f) => `${f.path.split('/').at(-1)}.${f.param}`));
  for (const k of ['arm.den[0]', 'arm.den[1]', 'rotor.den[0]', 'rotor.den[1]', 'kt.K', 'ke.K']) assert.ok(kinds.has(k), k);
  assert.ok(!kinds.has('int.K'), 'an integrator (angle = ∫ speed) is kinematics, not varied');
  // The motor's Kt and Ke are one constant: equal before, equal after.
  const motor = a.diagram.blocks.find((x) => x.id === 'motor').diagram.blocks;
  assert.equal(motor.find((x) => x.id === 'kt').params.K, motor.find((x) => x.id === 'ke').params.K);
  assert.notEqual(motor.find((x) => x.id === 'kt').params.K, 0.5);
  // Sources, Sinks, Controllers, noise and quantisers have nothing flagged.
  for (const t of ['source', 'sink', 'controller', 'observer', 'noise', 'quantizer', 'saturation', 'switch', 'integrator', 'external']) {
    assert.ok(!(ELEMENTS[t].params ?? []).some((q) => q.vary), t);
  }
  // identify() runs the varied copy and reveals the factors drawn.
  const res = identify(libraryProject('DC motor, position'), null, { vary: { share: 0.15, seed: 7 } });
  assert.deepEqual(res.vary.factors, a.factors);
  // The motor's rate k′ = Kt / (R b + Kt Ke) follows the draw.
  const f = Object.fromEntries(a.factors.map((x) => [`${x.path.split('/').at(-1)}.${x.param}`, x.factor]));
  const kt = 0.5 * f['kt.K'], R = 1 * f['arm.den[1]'], bb = 0.1 * f['rotor.den[1]'];
  const kp = kt / (R * bb + kt * kt);
  assert.ok(Math.abs(res.model.params.kp - kp) < 0.01 * kp, `k′ ${res.model.params.kp} against ${kp}`);
});

// ---- 19. The command line

test('19. node cli.mjs identify prints the sentences; --json parses and gives the same numbers as identify(); --keep stores the record', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lt-identify-'));
  try {
    const file = join(dir, 'motor.json');
    writeFileSync(file, JSON.stringify(libraryProject('DC motor, position')));
    const { res } = motor();
    const text = execFileSync(process.execPath, [CLI, 'identify', file]).toString();
    for (const s of res.model.sentences) assert.ok(text.includes(s), `missing: ${s}`);
    assert.match(text, /model: integrator · lag/);
    const out = JSON.parse(execFileSync(process.execPath, [CLI, 'identify', file, '--json']).toString());
    assert.equal(JSON.stringify(out.model), JSON.stringify(res.model), 'the same numbers');
    assert.deepEqual(out.end, res.end);
    assert.equal(out.samples, res.record.y.length);
    // --keep: the record (not the model) goes into the project.
    execFileSync(process.execPath, [CLI, 'identify', file, '--keep', '--budget', '120']);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    const k = saved.system.identify.ctrl;
    assert.deepEqual([k.kept.length, k.use, k.budget], [1, 0, 120]);
    assert.deepEqual(k.kept[0].record, res.record);
    assert.equal(JSON.stringify(drain(identifySteps(k.kept[0].record, { plan: k.kept[0].plan }))), JSON.stringify(res.model));
    // Wrong flags say what they take.
    assert.throws(() => execFileSync(process.execPath, [CLI, 'identify', file, '--band', '2,1'], { stdio: 'pipe' }), /--band: low,high/);
    assert.throws(() => execFileSync(process.execPath, [CLI, 'identify', file, '--seed', '3'], { stdio: 'pipe' }), /--seed goes with --vary/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
