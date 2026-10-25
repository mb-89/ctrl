// Test 13 of design/output/identification.md §17 on five arms drawn within
// ±15 % (hil_plant.py's physics as blocks, test/fixtures/arm-project.mjs):
// identified within 2 min of plant time through a noisy encoder, tuned on
// the model, within 1.3 × on the true arm of tuning on the arm itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProject } from '../src/core/project.js';
import { armProject } from './fixtures/arm-project.mjs';
import { drawArm } from './fixtures/arm.mjs';
import { harness, line } from './fixtures/harness.mjs';

for (const seed of [1, 2, 3, 4, 5]) {
  test(`13. Arm ${seed} (±15 %): within 2 min, tuned on its model within 1.3 ×`, (t) => {
    const h = harness(normalizeProject(armProject(drawArm(seed), { noise: 0, counts: 0 })), { noise: 0.001, q: (2 * Math.PI) / 4096 });
    t.diagnostic(line(`arm ${seed}`, h));
    assert.ok(h.id.time <= 120, `${h.id.time} s`);
    assert.ok(h.ratio <= 1.3, line(`arm ${seed}`, h));
  });
}
