// Test 13 of design/output/identification.md §17, the whole harness (§18
// step 9): identify a simulated plant through a sensor (noise, an encoder),
// tune on the identified model with Auto-tune's Iterate (the twin in the
// plant's place with its test push, §10), then score the result noise-free
// on the true plant, against Iterate run on the true plant itself (the best
// the same search finds there). The oven and the motor within 1.3 ×; the
// conical tank reported, its where-spread flagged. The arms are in
// identify-tune-arms.test.mjs (they run beside this file). Numbers go to the
// diagnostics.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { libraryProject } from './fixtures/plants.mjs';
import { harness, line } from './fixtures/harness.mjs';

test('13. The oven: tuned on its model, within 1.3 × of tuning on the oven itself', (t) => {
  const h = harness(libraryProject('Oven'), { noise: 0.1 });
  t.diagnostic(line('oven', h));
  assert.ok(h.ratio <= 1.3, line('oven', h));
  assert.match(h.onModel.variant.name, /· auto-tuned \(model\)$/);
});

test('13. The motor: tuned on its model, within 1.3 × of tuning on the motor itself', (t) => {
  const h = harness(libraryProject('DC motor, position'), { q: (2 * Math.PI) / 4096 });
  t.diagnostic(line('motor', h));
  assert.ok(h.ratio <= 1.3, line('motor', h));
});

test('13. The conical tank: reported, its where-spread flagged (one linear model across its range)', (t) => {
  const h = harness(libraryProject('Conical tank'), { noise: 0.001 });
  t.diagnostic(line('tank', h));
  assert.ok(h.id.model.whereSpread.flagged);
  assert.ok(Number.isFinite(h.ratio));
});
