// The swing-up planner's robustness matrix (designs-in-the-page.md §11,
// test 9): slow, so not in npm test. Run: npm run test:slow
// Each case plans on its plant and checks, in the nonlinear closed loop with
// time-varying LQR along the plan and the upright LQR after it, that the
// rods are up 1 s after the plan. The last two plan on the nominal plant
// and run on one whose rod masses are 10 % off.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planLaw, verifyLoop } from '../src/core/planner.js';
import { tripleModel, swingUp } from './triple.mjs';

const CASES = [
  ['T = 1.8 s', { T: 1.8 }],
  ['T = 3 s', { T: 3 }],
  ['masses ×2', { params: { M: 2, m1: 0.2, m2: 0.2, m3: 0.2 } }],
  ['rods ×1.6', { params: { l1: 0.4, l2: 0.4, l3: 0.4 } }],
  ['a 4 N push mid-swing', { d: (t) => (t >= 1.2 && t < 1.3 ? 4 : 0) }],
  ['rod masses −10 %', { truth: { m1: 0.09, m2: 0.09, m3: 0.09 } }],
  ['rod masses +10 %', { truth: { m1: 0.11, m2: 0.11, m3: 0.11 } }],
];

for (const [name, c] of CASES) {
  test(`swing-up holds: ${name}`, (t) => {
    const model = tripleModel(c.params);
    const t0 = performance.now();
    const { plan, values } = swingUp(model, { T: c.T ?? 2.4 });
    const ms = performance.now() - t0;
    const real = c.truth ? tripleModel({ ...c.params, ...c.truth }) : model;
    const v = verifyLoop(real, planLaw(values, 0.01), { Ts: 0.01, sub: plan.sub, duration: plan.T + 1, umin: -40, umax: 40, d: c.d });
    t.diagnostic(`${Math.round(ms)} ms, ${plan.iterations} iterations from start ${plan.start}, plan peak ${plan.Fpeak.toFixed(1)} N; loop peak ${v.Fpeak.toFixed(1)} N, cart within ${v.xmax.toFixed(2)} m, worst end ${v.endError.label} ${v.endError.value.toExponential(1)}`);
    assert.ok(plan.ok, plan.message);
    assert.ok(v.ok, JSON.stringify(v.endError));
  });
}
