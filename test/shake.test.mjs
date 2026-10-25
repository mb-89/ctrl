// The Shake, step 8 of design/output/identification.md §18 (§5.6, §6.7), and
// tests 8 (the grade) and 9 (a period with a lost cycle is played again): when
// the model at the pause is unsure, the experiment adds a random-odd multisine
// to the incumbent's output at the low and the high end of the test
// reference, eased in over three periods, then four measured periods; the
// model takes the frequency response, its distortion and the share of lines
// it holds; above 30 % of distortion the grade is ✕ whatever the fit says.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planExperiment, identifySteps, compactRecord, fitSupply, gradeOf, modelSentences } from '../src/core/identify.js';
import { createExperiment, EXPERIMENT } from '../src/core/experiment.js';
import { normalizeProject } from '../src/core/project.js';
import { drain } from '../src/core/autotune.js';
import { transferPlant, libraryProject } from './fixtures/plants.mjs';

const Ts = 0.01;
const stepR = Array.from({ length: 600 }, (_, k) => (k >= 50 && k < 550 ? 1 : 0));
const KNOWN = { block: { path: ['c'], key: 'c', where: 'c' }, live: false, u: { name: 'u', unit: '', min: -2, max: 2, u0: 0, from: 'controller' }, y: { name: 'y', unit: '', hard: null, from: null }, r: { lo: 0, hi: 1, span: 1, source: 'r', period: 6, samples: stepR, Ts }, Ts, others: [] };

// A lag behind an actuator v = u + c·u³ (c = 0: linear), the Shake asked for
// at the first pause; lose: a sample k where the plant loses two cycles.
function run({ cubic = 0, lose = null, budget = 300 } = {}) {
  const plan = planExperiment(KNOWN, { budget });
  const plant = transferPlant({ num: [2], den: [0.5, 1], theta: 0.05 }, Ts, { noise: 0.002, seed: 4 });
  const exp = createExperiment(plan);
  let pre = null, k = 0;
  for (let n = 0; n < 40000 && !exp.state.done; n++) {
    const u = exp.step(k, plant.output(), k ? plant.applied : undefined);
    if (exp.needs?.kind === 'fit') { pre = drain(identifySteps(compactRecord(exp.record()), { plan, upto: exp.needs.upto })); exp.supply('fit', { ...fitSupply(pre, exp), shake: !exp.record().log.some((e) => e.kind === 'shake') }); }
    if (exp.needs?.kind === 'discriminate') exp.supply('discriminate', {});
    const steps = lose !== null && lose(exp) ? 3 : 1;
    for (let s = 0; s < steps; s++) plant.advance(u + cubic * u ** 3);
    k += steps;
  }
  const record = compactRecord(exp.record());
  return { plan, exp, record, model: drain(identifySteps(record, { plan })) };
}

test('5.6 the Shake: two places, eased in over three periods, four measured; the frequency response holds the linear model; the record goes through the file', () => {
  const { exp, record, model, plan } = run();
  assert.equal(exp.state.end.code, 'done', exp.state.end.message);
  assert.deepEqual(exp.state.chips.map((c) => c.mark), ['✓', '✓', '✓', '✓', '✓', '✓'], 'every stage ran, the Shake too');
  const shakes = record.log.filter((e) => e.kind === 'shake');
  assert.deepEqual(shakes.map((e) => e.place), [0, 1], 'the low and the high end of the test reference');
  for (const e of shakes) {
    assert.equal(e.starts.length, EXPERIMENT.shake.ramp.length + EXPERIMENT.shake.measured);
    assert.deepEqual(e.amps.slice(0, 3).map((a) => a / e.amps.at(-1)), [0.25, 0.5, 1], 'eased in at ¼, ½, 1');
    assert.ok(!e.left);
  }
  assert.equal(record.log.filter((e) => e.kind === 'pause').length, 2, 'a second pause after the Shake');
  assert.equal(model.frf.length, 2);
  for (const x of model.frf) {
    assert.equal(x.periods, 4);
    assert.ok(x.distortion.share < 1, `distortion ${x.distortion.share} %`);
    assert.ok(x.within >= 0.8, `the model within 2σ at ${(100 * x.within).toFixed(0)} % of the lines`);
  }
  assert.ok(model.check.fit > 95 && model.grade !== '✕');
  assert.ok(!model.sentences.some((t) => /not linear/.test(t)));
  assert.doesNotThrow(() => normalizeProject({ ...libraryProject('Oven'), system: { ...libraryProject('Oven').system, identify: { ctrl: { kept: [{ name: 'y · test 1', plan, record }] } } } }));
});

test('8. a cubic actuator shows its distortion under the Shake, and the model says so; above 30 % the grade is ✕ whatever the fit says', () => {
  const { model } = run({ cubic: 1 });
  assert.ok(model.distortion >= 10, `${model.distortion} %`);
  assert.ok(model.why.some((w) => /% of the response is not linear/.test(w)), model.why.join('; '));
  assert.ok(model.sentences.some((t) => /^About \d+ % of the response at this size is not linear\.$/.test(t)), model.sentences.join(' '));
  const g = gradeOf({ fit: 99, ceiling: 99, white: true, distortion: 31 });
  assert.equal(g.mark, '✕', 'whatever the fit says');
  assert.deepEqual(g.why, ['31 % of the response is not linear']);
});

test('5.6 a band exit stops the tones at once; the incumbent brings y back and the test goes on to the Check', () => {
  const { exp, record } = run({ cubic: 0.5 });
  const left = record.log.filter((e) => e.kind === 'shake' && e.left);
  assert.equal(left.length, 1, 'the tones left the band once');
  assert.ok(record.log.some((e) => e.kind === 'note' && /during the Shake: the tones stopped/.test(e.text)));
  assert.equal(exp.state.end.code, 'done', exp.state.end.message);
});

test('9. a measured period with a lost cycle is played once more and left out of the response', () => {
  let lost = false;
  const { record, model } = run({ lose: (exp) => { const s = exp.record().log.filter((e) => e.kind === 'shake').length; if (!lost && exp.state.stage === 'shake' && s === 0 && /period 5 of/.test(exp.state.status)) { lost = true; return true; } return false; } });
  assert.ok(lost);
  const e = record.log.find((x) => x.kind === 'shake');
  assert.equal(e.starts.length, EXPERIMENT.shake.ramp.length + EXPERIMENT.shake.measured + 1, 'one period more');
  assert.equal(model.frf[0].periods, 4, 'four whole periods kept');
  assert.ok(model.frf[0].within >= 0.8);
});
