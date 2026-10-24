// The page's design store, async mode (designs-in-the-page.md §8.1–8.2):
// a plan is made in short slices while the block runs u = 0 or its previous
// values; the result is the sync store's, bit for bit. Test 11.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDesignStore, useDesigns } from '../src/core/design.js';
import { normalizeProject, evaluateSystem, autoTimebase } from '../src/core/project.js';
import { SYSTEM_LIBRARY, applySystem } from '../src/core/systems.js';
import { DEFAULT_PROJECT } from '../src/core/examples.js';

function project(name) {
  const p = normalizeProject(applySystem(DEFAULT_PROJECT, SYSTEM_LIBRARY.find((s) => s.name.startsWith(name)), ['input', 'plant']));
  p.scope.timebase = autoTimebase(p);
  return p;
}
const ctrlOf = (p) => p.system.plant.diagram.blocks.find((b) => b.id === 'ctrl');
const at = (res, name, t) => res.signals[name][Math.round(t / (res.t[1] - res.t[0]))];
const same = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

test('async store: pending runs u = 0, the plan is made in slices, then the run is the sync store\'s, bit for bit', async () => {
  const p = project('Triple');
  const store = createDesignStore({ mode: 'async', debounceMs: 0 });
  const first = evaluateSystem(p, { designs: store });
  const [st] = first.info.designs;
  assert.deepEqual([st.status, st.values, st.error, st.at], ['pending', null, null, 'θ1, θ2, θ3 = 3.142 rad → origin']);
  assert.ok(first.signals.F.every((v) => v === 0), 'u = 0 while planning');
  assert.ok(Math.abs(at(first, 'theta1', 4.9) - Math.PI) < 0.5, `the rods hang (the push at 3.5 s swings them a little): θ1 ${at(first, 'theta1', 4.9)}`);
  assert.ok(store.busy());
  assert.deepEqual(store.queue().map((j) => [j.path, j.title, j.running]), [['ctrl', 'Swing-up', false]]);
  assert.equal(store.generation, 0);

  // The pump: slices of about 5 ms until the plan is done.
  let heard = 0, slices = 0;
  const stop = store.onProgress(() => { heard++; });
  const fractions = [], finished = [];
  while (store.busy()) {
    const r = store.runJobs(5);
    slices++;
    finished.push(...r.finished);
    const q = store.queue()[0];
    if (q?.progress) fractions.push(q.progress.fraction);
  }
  stop();
  assert.ok(slices > 50, `${slices} slices`);
  assert.ok(fractions.length > 20 && fractions.every((f, i) => !i || f >= fractions[i - 1]), 'the progress rises');
  assert.ok(fractions.at(-1) > 0.3 && fractions.at(-1) <= 1);
  assert.ok(heard >= 1, 'onProgress heard');
  assert.equal(store.generation, 1, 'one plan, one new generation');
  assert.deepEqual(finished.map((f) => [f.path, f.title, f.error]), [['ctrl', 'Swing-up', null]]);
  assert.ok(finished[0].ms > 0);
  assert.equal(store.stats().heavyRuns, 1);
  await store.idle();

  // Compiled again: the plan's values, and the very run the sync store gives.
  const done = evaluateSystem(p, { designs: store });
  assert.equal(done.info.designs[0].status, 'ok');
  assert.match(done.info.designs[0].rows[0].value, /^Planned in [\d.]+ s \(\d+ iterations, start 1 of 3\)\. Verified/);
  const sync = evaluateSystem(p, { designs: createDesignStore() });
  for (const name of Object.keys(sync.signals)) assert.ok(same(done.signals[name], sync.signals[name]), name);
  assert.ok(Math.abs(at(done, 'theta1', 3.4)) < 0.05, 'swung up');

  // A compile that names no store, in a page that named its own (useDesigns,
  // as an analysis or an auto-tune run would): a guest. It reads the plan
  // made, and neither starts a plan of its own nor plans on the spot.
  useDesigns(store);
  try {
    assert.ok(same(evaluateSystem(p).signals.F, done.signals.F), 'the page\'s plan');
    ctrlOf(p).variants[0].params.T = 2.7;
    const guest = evaluateSystem(p).info.designs[0];
    assert.equal(guest.status, 'stale', 'the previous plan, as in the page');
    assert.equal(store.busy(), false, 'no job of its own');
    assert.equal(store.stats().heavyRuns, 1, 'and no plan made at once');
    ctrlOf(p).variants[0].params.T = 2.4;
  } finally { useDesigns(null); }

  // A new plan: the previous one runs meanwhile ('stale': same measurements, same Ts).
  const v = ctrlOf(p).variants[0];
  v.params.T = 2.5;
  const stale = evaluateSystem(p, { designs: store });
  const [s25] = stale.info.designs;
  assert.equal(s25.status, 'stale');
  assert.ok(same(s25.values.F, done.info.designs[0].values.F));
  assert.deepEqual(s25.rows, done.info.designs[0].rows, 'the previous plan\'s rows');
  for (const name of Object.keys(sync.signals)) assert.ok(same(stale.signals[name], done.signals[name]), `${name}: the previous plan runs`);
  const [job25] = store.queue();
  // The newest wins: asking for T = 2.6 drops the job for 2.5.
  v.params.T = 2.6;
  evaluateSystem(p, { designs: store });
  assert.equal(store.queue().length, 1);
  assert.notEqual(store.queue()[0].key, job25.key);
  // Another variant running: the plan is no longer asked for.
  ctrlOf(p).variant = 2;
  assert.deepEqual(evaluateSystem(p, { designs: store }).info.designs, []);
  assert.ok(!store.busy());
  await store.idle();
  ctrlOf(p).variant = 0;
  assert.equal(evaluateSystem(p, { designs: store }).info.designs[0].status, 'stale');
  // A different Ts does not fit the previous plan: pending, u = 0.
  ctrlOf(p).params.Ts = 0.02;
  const other = evaluateSystem(p, { designs: store });
  assert.equal(other.info.designs[0].status, 'pending');
  assert.ok(other.signals.F.every((x) => x === 0));
  ctrlOf(p).params.Ts = 0.01;

  // Cancel: u = 0 or the previous plan, labelled, until retry or new inputs.
  const key = evaluateSystem(p, { designs: store }).info.designs[0].key;
  const gen = store.generation;
  assert.ok(store.cancel(key));
  assert.ok(!store.busy() && store.generation === gen + 1);
  const off = evaluateSystem(p, { designs: store });
  assert.equal(off.info.designs[0].status, 'cancelled');
  assert.ok(same(off.info.designs[0].values.F, done.info.designs[0].values.F), 'the previous plan still runs');
  assert.ok(!store.busy(), 'not asked for again');
  assert.ok(store.retry(key));
  assert.equal(evaluateSystem(p, { designs: store }).info.designs[0].status, 'stale');
  assert.ok(store.busy());
  assert.ok(store.cancel(key));
  v.params.T = 2.7;
  assert.equal(evaluateSystem(p, { designs: store }).info.designs[0].status, 'stale', 'new inputs plan again');
  assert.ok(store.busy());
  assert.ok(!store.retry('nothing') && !store.cancel('nothing'));
});

test('async store: a job waits out its debounce; light designs never wait', () => {
  const store = createDesignStore({ mode: 'async', debounceMs: 60000 });
  const p = project('Triple');
  evaluateSystem(p, { designs: store });
  const r = store.runJobs(5);
  assert.ok(r.busy && r.waitMs > 50000 && !r.finished.length);
  assert.equal(store.queue()[0].running, false);
  // LQR has no heavy part: designed at once, in the same store.
  ctrlOf(p).variant = 1;
  const [st] = evaluateSystem(p, { designs: store }).info.designs;
  assert.deepEqual([st.type, st.status], ['lqr', 'ok']);
  assert.ok(!store.busy(), 'the plan was dropped');
  assert.throws(() => createDesignStore({ mode: 'later' }), /'sync' or 'async'/);
});
