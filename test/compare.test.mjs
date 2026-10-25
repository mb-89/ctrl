// Test 17 of design/output/identification.md §17 (teaching, §13): Compare
// with the diagram puts what the test found beside the diagram's own
// linearisation at each place the test sat, and Hide a variation measures,
// compares and reveals the varied copy; the library's Unknown oven carries it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identify, compareWithDiagram, compareCurves, varyDiagram, variedProject, modelStep, compareHorizon } from '../src/core/identify.js';
import { linearizeBlock } from '../src/core/project.js';
import { firstOrderFit } from '../src/core/linearize.js';
import { SYSTEM_LIBRARY, applySystem } from '../src/core/systems.js';
import { normalizeProject } from '../src/core/project.js';
import { DEFAULT_PROJECT } from '../src/core/examples.js';
import { libraryProject } from './fixtures/plants.mjs';

const close = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${what}: ${a} against ${b}`);

test('17. the Compare table equals linearizeBlock at each level the test sat', (t) => {
  for (const name of ['Oven', 'Conical tank']) {
    const p = libraryProject(name);
    const { model } = identify(p);
    const cmp = compareWithDiagram(p, null, model);
    assert.equal(cmp.rows.length, model.where.length, `${name}: one row per place`);
    for (const [i, r] of cmp.rows.entries()) {
      const lin = linearizeBlock(p, ['ctrl'], { y: r.level });
      const fo = firstOrderFit(lin);
      close(r.diagram.gain, fo.K, 1e-6, `${name} near ${r.level}: the gain`);
      assert.equal(r.diagram.theta, lin.delay[0], `${name}: the dead time`);
      assert.equal(r.found.gain, model.where[i].gain, `${name}: the found gain is the place's`);
      // The dashed step settles where the diagram's gain says.
      const N = Math.ceil(Math.max(compareHorizon(model), 10 * r.diagram.tau + r.diagram.theta) / model.Ts) + 1;
      close(compareCurves(r.diagram.sys, model.Ts, { N }).step[N - 1], fo.K, 0.02, `${name}: the diagram's step ends at its gain`);
    }
    t.diagnostic(`${name}: ${cmp.sentence} ${cmp.notes.join(' ')}`);
  }
  // The oven is linear: within a few per cent of the drawing.
  const oven = libraryProject('Oven');
  const c = compareWithDiagram(oven, null, identify(oven).model);
  assert.match(c.sentence, /within \d % of the diagram's gain/);
  close(c.rows[0].diagram.tau, 0.5, 1e-6, 'the chamber is the slowest lag');
  // The tank's gain changes with its level: one model is a compromise.
  const tank = libraryProject('Conical tank');
  assert.match(compareWithDiagram(tank, null, identify(tank).model).sentence, /sits between the diagram's gains at the 3 places .*a compromise/);
});

test('17 (teaching). Hide a variation: the test measures the varied copy, Compare linearises it, the reveal lists its factors', () => {
  const p = libraryProject('Oven');
  const vary = { share: 0.15, seed: 3 };
  p.system.identify = { ctrl: { vary } };
  const { diagram, factors } = varyDiagram(p.system.plant.diagram, vary.share, vary.seed);
  const varied = { ...p, system: { ...p.system, plant: { ...p.system.plant, diagram } } };
  assert.deepEqual(variedProject(p, null).system.plant.diagram, diagram, 'variedProject is the hidden copy');
  const { model } = identify(p);
  const cmp = compareWithDiagram(p, null, model, { vary });
  assert.deepEqual(cmp.factors, factors, 'the reveal is the draw');
  const truth = firstOrderFit(linearizeBlock(varied, ['ctrl'], { y: cmp.rows[0].level })).K;
  close(cmp.rows[0].diagram.gain, truth, 1e-6, 'Compare linearises the varied copy');
  // The model found the varied oven, not the drawn one (the drawn gain is 1).
  const K = factors.filter((f) => f.param === 'K').reduce((a, f) => a * f.factor, 1);
  assert.ok(Math.abs(K - 1) > 0.05, `the draw moves the gain (${K})`);
  close(model.params.K, K, 0.04, 'the identified gain is the hidden oven\'s');
  close(model.params.K, truth, 0.04, 'and the comparison\'s');
});

test('17 (library). Unknown oven: identify, then tune opens on Identify with its hidden variation and joins up where it repeats', () => {
  const entry = SYSTEM_LIBRARY.find((s) => s.name === 'Unknown oven: identify, then tune');
  assert.ok(entry, 'in the library');
  assert.equal(entry.ui.tab, 'identify');
  const p = normalizeProject(applySystem(DEFAULT_PROJECT, entry, ['input', 'plant', 'controller']));
  assert.deepEqual(p.system.identify.ctrl.vary, { share: 0.15, seed: 3 });
  // Another system's plant brings its own settings: none here.
  const q = applySystem(p, SYSTEM_LIBRARY.find((s) => s.name === 'Oven, badly tuned'), ['plant']);
  assert.equal(q.system.identify, undefined, 'Identify\'s settings go with the plant they measured');
  // r is back where it started before the period ends.
  for (const s of Object.values(entry.input.signals)) {
    const total = s.components.filter((c) => c.type === 'step').reduce((a, c) => a + c.params.amplitude, 0);
    assert.equal(total, 0, 'every step is taken back');
  }
  const { model } = identify(p);
  assert.ok(model.ok && model.check.fit > 85, `the model explains ${model.check?.fit} %`);
  assert.ok(modelStep(model, 2).y.at(-1) > 0.5);
});
