// Shared by the planner tests (not a test file itself): the library's triple
// pendulum as the plant its Controller sees, and a swing-up put together
// from planner.js the way the trajectory type puts it together.

import { normalizeDiagram, compileDiagram } from '../src/core/diagram.js';
import { SYSTEM_LIBRARY } from '../src/core/systems.js';
import { planTransfer, runPlan, alongPlan, tvlqrGains, planValues } from '../src/core/planner.js';
import { linearize, operatingPoint } from '../src/core/linearize.js';
import { lqrDesign } from '../src/core/design.js';

export const Q_TRIPLE = [10, 100, 100, 100, 1, 1, 1, 1];
export const HANGING = [0, Math.PI, Math.PI, Math.PI, 0, 0, 0, 0];

// The Model the triple pendulum's Controller sees (it starts hanging);
// params change the cart and rods (masses, lengths).
export function tripleModel(params = {}) {
  const d = structuredClone(SYSTEM_LIBRARY.find((s) => s.name.startsWith('Triple')).plant.diagram);
  Object.assign(d.blocks.find((b) => b.id === 'cart').params, params);
  return compileDiagram(normalizeDiagram(d), 'plant', { mode: 'model' }).seen('ctrl');
}

// Plan, along-plan Jacobians, the upright LQR, TV-LQR and the law's values.
export function swingUp(model, { T = 2.4, Ts = 0.01, segments = 12, Fmax = 30, Q = Q_TRIPLE, R = 0.1, plan = null } = {}) {
  plan ??= runPlan(planTransfer(model, { T, Ts, segments, Fmax }));
  const along = alongPlan(model, plan);
  const lin = linearize(model, operatingPoint(model, 'origin'));
  const up = lqrDesign(lin, { Q, R, track: 1, Ts });
  const Qx = lin.C[0].map((_, a) => lin.C[0].map((__, b) => lin.C.reduce((s, row, k) => s + row[a] * Q[k] * row[b], 0)));
  const Kx = tvlqrGains(along, { Q: Qx, R, Pend: up.P });
  return { plan, along, lin, up, Qx, Kx, values: planValues(model, along, Kx, { K: up.K, kr: up.kr }) };
}
