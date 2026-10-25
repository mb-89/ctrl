// Input 56 (decisions.md v2.9): a dead time and a resonance are told apart.
// The onset test refutes a shape whose dead time is longer than the time the
// plant took to move after a push (data already recorded); when two shapes
// still tie on the Check, the page designs a test on which they differ most
// against the noise, the experiment plays it after the Check, and the shape
// that predicts it is kept, if it does so clearly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identify, planExperiment, identifySteps, compactRecord, designDiscrimination, tellApart, DISCRIMINATE } from '../src/core/identify.js';
import { drain } from '../src/core/autotune.js';
import { normalizeProject } from '../src/core/project.js';
import { armProject } from './fixtures/arm-project.mjs';
import { libraryProject, transferPlant, runExperiment } from './fixtures/plants.mjs';

test('the onset test: on five arms the shapes with a dead time longer than the arm took to move are refuted, and the resonance is kept', () => {
  const p = armProject();
  for (const seed of [1, 2, 3, 4, 5]) {
    const m = identify(p, null, { vary: { share: 0.15, seed } }).model;
    for (const name of ['lag', 'lags']) {
      const c = m.candidates.find((x) => x.structure === name);
      assert.equal(c.grade, '✕', `seed ${seed}: ${name} θ ${c.params.theta}`);
      assert.match(c.why[0], /^moves before its dead time: after a push angle had gone a tenth of its way in \d+ ms, before this shape's \d+ ms$/);
    }
    assert.equal(m.structure, 'resonance', `seed ${seed}`);
    assert.ok(m.params.theta < 0.03, `seed ${seed}: θ ${m.params.theta}`);
    assert.doesNotMatch(m.sentences[0], /Responds after 1\d\d ms/);
  }
});

test('the onset test leaves a dead time that stands for a slow start: the oven, the motor and the tank keep their shapes', () => {
  for (const [name, structure] of [['Oven', 'lags'], ['DC motor, position', 'intLag'], ['Conical tank', 'lag']]) {
    const m = identify(libraryProject(name)).model;
    assert.equal(m.structure, structure, name);
    assert.ok(!m.candidates.some((c) => /moves before its dead time/.test(c.why.join())), name);
  }
});

// A linear loop: u ±2 from 0, r 0 → 1 → 0 over 6 s, the band from r; the
// plant a resonance with a small dead time, measured with noise.
const Ts = 0.01;
const stepR = Array.from({ length: 600 }, (_, k) => (k >= 50 && k < 550 ? 1 : 0));
const KNOWN = { block: { path: ['c'], key: 'c', where: 'c' }, live: false, u: { name: 'u', unit: '', min: -2, max: 2, u0: 0, from: 'controller' }, y: { name: 'y', unit: '', hard: null, from: null }, r: { lo: 0, hi: 1, span: 1, source: 'r', period: 6, samples: stepR, Ts }, Ts, others: [] };

for (const [zeta, theta] of [[0.5, 0.03], [0.7, 0.05]]) {
  test(`the discriminating test: a lag tied with the true resonance (ζ ${zeta}) on the Check is told apart by the test the page designs`, () => {
    const plan = planExperiment(KNOWN, {});
    const w = 2 * Math.PI * 0.6;
    const plant = transferPlant({ num: [w * w], den: [1, 2 * zeta * w, w * w], theta }, Ts, { noise: 0.002, seed: 4 });
    let pre = null, design = null;
    const res = runExperiment(plan, plant, {
      supply: (exp) => {
        const rec = compactRecord(exp.record());
        if (exp.needs.kind === 'fit') { pre = drain(identifySteps(rec, { plan, upto: exp.needs.upto })); return { structure: pre.structure, params: pre.params }; }
        // The tie made by hand: the lag as good as the resonance on the Check.
        const m = drain(identifySteps(rec, { plan, reuse: pre }));
        const best = m.candidates.find((c) => c.structure === 'resonance').fit;
        const cands = m.candidates.filter((c) => ['lag', 'resonance'].includes(c.structure)).map((c) => ({ ...c, unsupported: null, fit: best }));
        design = designDiscrimination({ ...m, structure: 'lag', candidates: cands }, rec, plan);
        return design;
      },
    });
    assert.equal(res.exp.state.end.code, 'done');
    assert.ok(design?.shape && design.separation >= DISCRIMINATE.separation, JSON.stringify(design));
    const rec = compactRecord(res.record);
    const D = rec.log.find((e) => e.kind === 'discriminate');
    assert.ok(D && !D.left, 'played, inside the band');
    assert.deepEqual(D.candidates, ['lag', 'resonance']);
    // The record keeps the test (it goes through the file).
    assert.doesNotThrow(() => normalizeProject({ ...libraryProject('Oven'), system: { ...libraryProject('Oven').system, identify: { ctrl: { kept: [{ name: 'y · test 1', plan, record: rec }] } } } }));
    const fits = tellApart(rec, plan, ['lag', 'resonance'].map((s) => ({ structure: s, params: pre.candidates.find((c) => c.structure === s).params })));
    assert.ok(fits.resonance > 90 && 100 - fits.resonance < DISCRIMINATE.clear * (100 - fits.lag), JSON.stringify(fits));
  });
}

test('no test when the shapes that tie predict the same: the oven\'s two lags and resonance', () => {
  const r = identify(libraryProject('Oven'));
  assert.ok(!r.record.log.some((e) => e.kind === 'discriminate'));
  assert.ok(r.record.log.some((e) => e.kind === 'note' && /predict the same within the noise/.test(e.text)));
});
