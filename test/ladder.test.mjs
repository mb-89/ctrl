// Identify's experiment end to end, test 5 of §17 (design/output/
// identification.md §5.4): the ladder on the library's oven, motor and tank,
// each through its own block diagram with a sensor's noise, and on five arms
// drawn within ±15 % (hil_plant.py's physics, test/fixtures/arm.mjs). It never
// leaves the band, it stops by its rules, the plant time stays within the
// budget, and every input but u is held.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIMENT, gentleGains } from '../src/core/experiment.js';
import { knownFor, identifySettings, planExperiment } from '../src/core/identify.js';
import { createArm, drawArm } from './fixtures/arm.mjs';
import { diagramPlant, libraryProject, runExperiment } from './fixtures/plants.mjs';

const E = EXPERIMENT.ease;
const RULES = ['margin', 'guard', 'stale', 'quick', 'tries', 'budget'];

// The ladder's record checked against its rules; returns a line for the log.
function checkLadder(name, plan, res) {
  const { record, exp } = res;
  const s = exp.state;
  assert.equal(s.end?.code, 'done', `${name}: ${s.end?.message}`);
  // Plant time within the budget.
  const t = record.y.length * plan.Ts;
  assert.ok(t <= plan.budget, `${name}: ${t} s of ${plan.budget}`);
  // Never out of the band, measured or true.
  const [lo, hi] = plan.band;
  for (let k = 0; k < record.y.length; k++) assert.ok(record.y[k] >= lo && record.y[k] <= hi, `${name}: y ${record.y[k]} at ${k}`);
  for (const v of res.truth) assert.ok(v >= lo && v <= hi, `${name}: the plant at ${v}`);
  const tries = record.log.filter((e) => e.kind === 'try');
  const ladder = record.log.find((e) => e.kind === 'ladder');
  assert.ok(tries.length >= 1, `${name}: no try`);
  assert.ok(RULES.includes(ladder.why), `${name}: ${ladder.why}`);
  assert.ok(tries.every((T) => !T.left), `${name}: a try left the band`);
  // Each try asks for 30 % quicker than the one before; accepted ones keep
  // their margin and improve J by at least 3 % (so the mark ✓ and the
  // incumbent agree); the incumbent is the best accepted. A try pushes at
  // most twice what was proven before it (the Nudge, the Hold, the accepted
  // tries), and its tail (until y settles or stops moving, at most 4 s) is
  // scored with it.
  let J = Infinity, tc = record.log.find((e) => e.kind === 'law' && e.role === 'hold').tauC, best = 0;
  const U = plan.umax - plan.umin;
  const pushIn = (a, b) => { let m = 0; for (let j = a; j < b; j++) if (record.u[j] !== null) m = Math.max(m, Math.abs(record.u[j] - plan.u0)); return m; };
  let proven = pushIn(record.log.find((e) => e.kind === 'rung').i0, tries[0].i0);
  for (const T of tries) {
    assert.ok(Math.abs(T.tauC - E.quicker * tc) < 1e-12 * tc, `${name}: try ${T.n} τc`);
    tc = T.tauC;
    assert.ok(Math.abs(T.push - pushIn(T.iSwitch, T.iEnd)) < 1e-9 && T.push <= E.cap * Math.max(proven, EXPERIMENT.nudge.a0 * U) * (1 + 1e-9), `${name}: try ${T.n} pushed ${T.push}, proven ${proven}`);
    assert.ok(T.left || T.tail !== null, `${name}: try ${T.n} has its tail`);
    if (T.mark === '✓ quicker') proven = Math.max(proven, T.push);
    assert.equal(T.accepted, T.g >= E.gMin && T.J < (1 - E.better) * J, `${name}: try ${T.n} accepted`);
    assert.equal(T.accepted, T.mark === '✓ quicker');
    if (T.accepted) { J = T.J; best = T.n; }
  }
  assert.equal(ladder.incumbent, best);
  // The rule that stopped it holds for the last try.
  const last = tries.at(-1);
  if (ladder.why === 'margin') assert.ok(last.g < E.gMin);
  if (ladder.why === 'tries') assert.equal(tries.length, E.tries);
  if (ladder.why === 'stale') {
    const [a, b] = tries.slice(-2);
    const before = (T) => Math.min(Infinity, ...tries.filter((x) => x.n < T.n && x.accepted).map((x) => x.J));
    for (const T of [a, b]) assert.ok(!(T.J < (1 - E.better) * before(T)), `${name}: try ${T.n} improved`);
  }
  if (ladder.why === 'quick') {
    const look = exp.found.look;
    assert.ok(E.quicker * last.tauC < E.thetaShare * gentleGains(look, 1, plan.Ts).theta);
  }
  if (ladder.why === 'budget') {
    // Another try (its settle, the reference, its tail) and the pause and the Check did not fit.
    const at = last.iEnd * plan.Ts;
    assert.ok(plan.budget - at < E.settleMax * 3 + (exp.found.test.length + exp.found.check.length) * plan.Ts + EXPERIMENT.pause.seconds + 0.5);
  }
  return `${name}: ${tries.length} tries (${tries.map((T) => T.mark[0]).join('')}), ${ladder.why}, best J ${J.toFixed(3)}, ${t.toFixed(0)} s`;
}

for (const [name, sensor] of [['Oven', { noise: 0.1 }], ['DC motor, position', { q: (2 * Math.PI) / 4096 }], ['Conical tank', { noise: 0.001 }]]) {
  test(`5. The ladder on the library's ${name.split(',')[0].toLowerCase()}: never leaves the band, stops by its rules, within the budget, d held`, (t) => {
    const project = libraryProject(name);
    const known = knownFor(project);
    const plan = planExperiment(known, identifySettings(project, null, { known }));
    assert.deepEqual(plan.others, [{ name: 'd', value: 0 }], 'd is held at 0');
    const plant = diagramPlant(project, 'ctrl', { hold: Object.fromEntries(plan.others.map((o) => [o.name, o.value])), ...sensor });
    const held = new Set();
    const res = runExperiment(plan, plant, { onSample: () => held.add(plant.sources().d) });
    assert.deepEqual([...held], [0], 'd stayed at 0 the whole test');
    t.diagnostic(checkLadder(name, plan, res));
  });
}

test('5. The ladder on five arms drawn within ±15 %: never leaves the band, stops by its rules, within 2 min, the load held', (t) => {
  const Ts = 0.01;
  const r = Array.from({ length: 500 }, (_, k) => (k * Ts > 0.5 && k * Ts <= 3.0 ? 1.5 : 0));
  const known = {
    block: { path: ['ctrl'], key: 'ctrl', where: 'controller' }, live: true,
    u: { name: 'V', unit: 'V', min: -12, max: 12, u0: 0, from: 'both' }, y: { name: 'angle', unit: 'rad', hard: [-2.5, 2.5], from: 'plant' },
    r: { lo: 0, hi: 1.5, span: 1.5, source: 'r', period: 5, samples: r, Ts }, Ts, others: [{ name: 'd', value: 0, input: 'load' }],
  };
  const plan = planExperiment(known, { budget: 120 });
  assert.deepEqual(plan.others, [{ name: 'd', value: 0, input: 'load' }]);
  for (let seed = 1; seed <= 5; seed++) {
    const arm = createArm(drawArm(seed), { Ts, seed, load: plan.others[0].value });
    const res = runExperiment(plan, arm);
    assert.equal(arm.estop, null, `arm ${seed}: the plant stopped itself`);
    t.diagnostic(checkLadder(`arm ${seed}`, plan, res));
  }
});
