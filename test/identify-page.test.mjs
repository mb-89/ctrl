// What the Identify tab (ui/identify.js) computes from the core, step 6 of
// design/output/identification.md §18: the test as a generator the page
// slices (identifyRun, the same record as identify()), the Check's
// prediction drawn before it runs (§5.7), the model's step and Bode with
// their bands, and the tab's place among the tabs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identify, identifyRun, predictCheck, modelStep, modelBode } from '../src/core/identify.js';
import { UI_TABS } from '../src/core/project.js';
import { libraryProject } from './fixtures/plants.mjs';

test('Identify is a tab after Controller, before Auto-tune', () => {
  assert.deepEqual(UI_TABS, ['input', 'plant', 'controller', 'identify', 'tune', 'analysis']);
});

test('identifyRun: the page\'s generator gives identify()\'s record and model; samples carry plant time, fits none', () => {
  const p = libraryProject('DC motor, position');
  const run = identifyRun(p);
  let s, samples = 0, fits = 0, last = -1;
  for (;;) {
    s = run.steps.next();
    if (s.done) break;
    if (s.value.kind === 'sample') { samples++; assert.ok(s.value.t > last || samples === 1); last = s.value.t; assert.equal(s.value.values.length, run.names.length); } else fits++;
  }
  assert.ok(fits > 0, 'it yields while it fits');
  assert.equal(samples, s.value.record.y.length);
  const ref = identify(p);
  assert.equal(JSON.stringify(s.value.record), JSON.stringify(ref.record));
  assert.equal(JSON.stringify(s.value.model), JSON.stringify(ref.model));
});

for (const name of ['Oven', 'DC motor, position']) {
  test(`5.7 the Check's prediction, drawn when it starts, is the model's replay of it (${name})`, () => {
    const run = identifyRun(libraryProject(name));
    let s, pred = null;
    for (;;) {
      s = run.steps.next();
      if (s.done) break;
      const at = run.exp.state.checkAt;
      if (at !== null && !pred) pred = { at, ...predictCheck(run.pre, run.exp.record(), { at, r: run.exp.found.check }) };
    }
    const m = s.value.model, ck = m.check;
    assert.ok(pred && ck);
    let worst = 0, span = 0;
    for (let k = 0; k < ck.yhat.length; k++) {
      const j = ck.i0 + k - pred.at;
      if (j >= 0 && j < pred.y.length) worst = Math.max(worst, Math.abs(pred.y[j] - ck.yhat[k]));
      span = Math.max(span, Math.abs(ck.yhat[k] - ck.yhat[0]));
    }
    // The pause's fit and the final model are the same fits (reuse): the
    // prediction is the Check's replay, to the replay's rounding.
    assert.ok(worst < 2e-3 * span, `prediction within ${worst} of the replay (span ${span})`);
    assert.ok(pred.hi.every((v, k) => v >= pred.y[k] && pred.lo[k] <= pred.y[k]), 'the band holds the prediction');
  });
}

test('the model\'s step and Bode: the gain at rest, the band about the line, Bode the sampled response', () => {
  const { model: m } = identify(libraryProject('Oven'));
  const st = modelStep(m, 10);
  assert.ok(Math.abs(st.y.at(-1) - m.params.K) < 1e-3 * m.params.K);
  const w = [1e-3, 1, 10];
  const b = modelBode(m, w);
  const P = m.params, cont = (om) => P.K / Math.hypot(1, om * P.tau1) / Math.hypot(1, om * P.tau2);
  assert.ok(Math.abs(b.mag[0] - P.K) < 1e-6);
  // At ωTs ≪ 1 the sampled response is the continuous one.
  assert.ok(Math.abs(b.mag[1] - cont(1)) < 1e-3 * cont(1));
  assert.ok(b.phase[2] < b.phase[1] && b.phase[1] < 0);
  assert.ok(b.lo.every((v, k) => v <= b.mag[k] + 1e-12) && b.hi.every((v, k) => v >= b.mag[k] - 1e-12));
});
