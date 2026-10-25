// Try on the plant, step 10 of design/output/identification.md §18 (§11), and
// test 16: a result tuned on the model goes to the plant in three steps from
// the controller that held, each screened on the model, its bars and its
// places (stable, Ms ≤ 2, at most 70 % of the room predicted); on the plant
// a monitor falls back to the controller that held when y strays from the
// prediction; a step is accepted when it behaves as predicted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identify, identifyRun, twinProject, planTry, tryOutcome, TRY } from '../src/core/identify.js';
import { autotune, drain } from '../src/core/autotune.js';
import { libraryProject, runExperiment } from './fixtures/plants.mjs';
import { armProject } from './fixtures/arm-project.mjs';
import { createArm, drawArm } from './fixtures/arm.mjs';

const tunedOn = (p, opts) => {
  const r = identify(p, null, opts), path = r.block.path;
  const tuned = autotune(twinProject(p, path, r.model).project, path, { method: 'iterate' });
  return { r, path, tuned, src: { plan: r.plan, record: r.record } };
};

test('11. on the oven and the motor every step is screened and then behaves as predicted on the plant; the result runs', () => {
  for (const name of ['Oven', 'DC motor, position']) {
    const p = libraryProject(name);
    const { r, path, tuned, src } = tunedOn(p);
    const tp = planTry(p, path, r.model, src, tuned.variant);
    assert.equal(tp.upto, 3, `${name}: ${tp.why}`);
    // The path climbs in log-gains from the controller that held.
    const kp = tp.plan.steps.map((x) => x.gains.Kp), e = r.model.eased, v = tuned.variant.params;
    assert.ok(Math.abs(kp[2] - v.Kp) < 1e-9 * v.Kp && Math.abs(kp[0] - e.Kp * (v.Kp / e.Kp) ** (1 / 3)) < 1e-9 * v.Kp);
    const res = drain(identifyRun(p, path, {}, { plan: tp.plan }).steps);
    assert.equal(res.end.code, 'done');
    assert.deepEqual(res.steps.map((s) => s.mark), ['✓ as predicted', '✓ as predicted', '✓ as predicted'], name);
    for (const s of res.steps) assert.ok(Math.abs(s.J - s.Jpred) <= 0.3 * s.Jpred && (s.g ?? 1) >= 0.3);
    const out = tryOutcome(res.record, tp, tuned.variant);
    assert.equal(out.all, true);
    assert.equal(out.run.name, tuned.variant.name);
  }
});

test('16. screening refuses a step that is unstable or too sensitive for a model within the bars or the places; the path ends there', () => {
  const p = armProject();
  const { r, path, tuned, src } = tunedOn(p, { vary: { share: 0.15, seed: 1 } });
  const bold = { ...tuned.variant, params: { ...tuned.variant.params, Kp: 30 * tuned.variant.params.Kp } };
  const tb = planTry(p, path, r.model, src, bold);
  assert.equal(tb.upto, 0);
  assert.match(tb.why, /^the result is bolder than what the model knows: not even its first step \(step 1: (Ms [\d.]+ above 2|unstable)/);
  // The arm's own result (tuned on the model with the test push alone, §10)
  // holds at every step; one 2.5 × bolder holds at its first steps and is
  // too sensitive further on, where the arm's gain is higher (a place), so
  // the path ends there.
  assert.equal(planTry(p, path, r.model, src, tuned.variant).upto, 3);
  const bolder = { ...tuned.variant, params: { ...tuned.variant.params, Kp: 2.5 * tuned.variant.params.Kp } };
  const tp = planTry(p, path, r.model, src, bolder);
  assert.ok(tp.upto >= 1 && tp.upto < 3, tp.why);
  assert.match(tp.why, new RegExp(`tried up to step ${tp.upto} \\(step ${tp.upto + 1}: .*(bars or places|unstable|room)`));
  assert.equal(tp.plan.steps.length, tp.upto, 'only the screened steps go to the plant');
});

test('16. the monitor falls back to the controller that held when the plant changes under a step: ✕ did not behave as predicted, and the path ends', () => {
  const p = armProject();
  const { r, path, tuned, src } = tunedOn(p, { vary: { share: 0.15, seed: 1 } });
  const tp = planTry(p, path, r.model, src, tuned.variant);
  assert.ok(tp.upto >= 1);
  // The arm the model was measured on, swapped for one with three times the
  // motor's constant as the first step starts.
  const A = createArm(drawArm(1), { Ts: 0.01, seed: 1 }), B = createArm({ ...drawArm(1), k: 0.3 }, { Ts: 0.01, seed: 1 });
  let swap = false;
  const plant = { Ts: 0.01, output: () => (swap ? B : A).output(), advance: (u) => { A.advance(u); return B.advance(u); }, get applied() { return (swap ? B : A).applied; } };
  const same = runExperiment(tp.plan, createArm(drawArm(1), { Ts: 0.01, seed: 1 }));
  assert.equal(same.record.log.find((e) => e.kind === 'step').mark, '✓ as predicted', 'the same arm behaves as predicted');
  const res = runExperiment(tp.plan, plant, { onSample: (k, exp) => { if (exp.state.stage === 'ease') swap = true; } });
  const steps = res.record.log.filter((e) => e.kind === 'step');
  assert.equal(steps.length, 1, 'the path ends at the first step that strays');
  assert.equal(steps[0].mark, '✕ did not behave as predicted');
  assert.equal(steps[0].tripped, 'stray');
  // It fell back within the monitor's 0.2 s and the plant stayed in the band.
  const fell = res.record.log.find((e) => e.kind === 'law' && e.role === 'incumbent' && e.i >= steps[0].i0);
  assert.ok(fell && fell.i === steps[0].iEnd);
  assert.equal(res.exp.state.end.code, 'done');
  assert.equal(tryOutcome(res.record, tp, tuned.variant).run, null, 'nothing better to run');
  assert.ok(TRY.monitor.room === 0.2);
});
