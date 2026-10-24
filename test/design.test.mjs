// The design store and the first designed type (lqr): design/output/designs.md,
// tests 5, 7 and 8 of designs-in-the-page.md §11.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDiagram, compileDiagram } from '../src/core/diagram.js';
import { CONTROLLERS, normalizeVariant } from '../src/core/controllers.js';
import { OBSERVERS } from '../src/core/observers.js';
import { canonical, hashKey, plantKey, createDesignStore } from '../src/core/design.js';
import { normalizeProject, evaluateSystem, autoTimebase } from '../src/core/project.js';
import { SYSTEM_LIBRARY, applySystem } from '../src/core/systems.js';
import { DEFAULT_PROJECT } from '../src/core/examples.js';

// The gains the library held before they were computed in the page: discrete
// LQR at Ts = 10 ms at the upright rest, in measurement order (x, θ…, v, ω…).
const K_SINGLE = [-9.177, -63.18, -10.33, -13.34];
const K_TRIPLE = [-6.9896, -497.8, 1400.5, -1011.7, -12.018, -18.079, 79.602, -102.41];
const K_TRIPLE_GENTLE = [-2.3, -417, 1050, -686, -4.496, -14.83, 62.84, -67.32];
const Q_TRIPLE = [10, 100, 100, 100, 1, 1, 1, 1];

// A library system as a project; variants, if given, replace its Controller's.
function project(name, variants, variant = 0) {
  const p = normalizeProject(applySystem(DEFAULT_PROJECT, SYSTEM_LIBRARY.find((s) => s.name.startsWith(name)), ['input', 'plant']));
  p.scope.timebase = autoTimebase(p);
  if (variants) {
    const c = ctrlOf(p);
    c.variants = variants.map((v, i) => normalizeVariant(v, `variants[${i}]`));
    c.variant = variant;
  }
  return p;
}
const ctrlOf = (p) => p.system.plant.diagram.blocks.find((b) => b.id === 'ctrl');
const lqr = (Q, R, extra = {}) => ({ name: 'LQR', type: 'lqr', params: { Q, R, ...extra } });
// The status of the one designed variant of a project, in a fresh store.
const statusOf = (p, store = createDesignStore()) => compileDiagram(p.system.plant.diagram, 'plant', { standalone: true, designs: store }).designs[0];

test('design keys: canonical JSON, a short hash, and what a design depends on in a diagram', () => {
  assert.equal(canonical({ b: 1, a: [-0, Infinity, -Infinity, null], c: undefined }), '{"a":[0,"inf","-inf",null],"b":1}');
  assert.equal(canonical(new Float64Array([1.5, -0])), '[1.5,0]');
  assert.equal(canonical({ x: { z: 1, y: 2 } }), canonical({ x: { y: 2, z: 1 } }));
  assert.match(hashKey('a'), /^[0-9a-f]{12}$/);
  assert.equal(hashKey('the same'), hashKey('the same'));
  assert.notEqual(hashKey('a'), hashKey('b'));
  const d = project('Pendulum swing-up').system.plant.diagram;
  const key = plantKey(d);
  const changed = (fn) => { const e = structuredClone(d); fn(e); return plantKey(e) !== key; };
  const blk = (e, id) => e.blocks.find((b) => b.id === id);
  assert.ok(!changed((e) => { blk(e, 'cart').x += 40; blk(e, 'cart').flip = true; }), 'place and flip');
  assert.ok(!changed((e) => { blk(e, 'F').params.name = 'force'; }), 'a Sink\'s name');
  assert.ok(!changed((e) => { blk(e, 'ctrl').variant = 2; blk(e, 'ctrl').variants[0].params.kE = 5; }), 'Controller variants');
  assert.ok(changed((e) => { blk(e, 'cart').params.m = 0.3; }), 'a physics parameter');
  assert.ok(changed((e) => { blk(e, 'ctrl').params.Ts = 0.02; }), 'the Controller\'s sample time');
  assert.ok(changed((e) => { e.wires.pop(); }), 'wiring');
});

test('LQR from the plant reproduces the gains the library held, to 0.1 %; it refuses what it cannot do', () => {
  // Test 5.
  for (const [name, Q, R, Kref] of [['Pendulum swing-up', [10, 50, 1, 1], 0.1, K_SINGLE], ['Triple', Q_TRIPLE, 0.1, K_TRIPLE], ['Triple', Q_TRIPLE, 1, K_TRIPLE_GENTLE]]) {
    const st = statusOf(project(name, [lqr(Q, R, { umin: -40, umax: 40 })]));
    assert.equal(st.status, 'ok', JSON.stringify(st.error));
    const { K, kr } = st.values;
    assert.equal(K.length, Kref.length);
    K.forEach((k, i) => assert.ok(Math.abs(k - Kref[i]) <= 1e-3 * Math.abs(Kref[i]), `${name} R ${R}: K[${i}] = ${k}, not ${Kref[i]}`));
    assert.ok(Math.abs(kr - K[0]) <= 1e-6 * Math.abs(K[0]), `kr ${kr}, K[0] ${K[0]}: x follows r`);
  }
  // What the status says, and that it carries no numbers into JSON.
  const st = statusOf(project('Pendulum swing-up', [lqr([10, 50, 1, 1], 0.1)]));
  assert.equal(st.seen, 'F → x, θ, v, ω · 4 states (x, v, θ, ω)');
  assert.equal(st.at, 'origin (all states 0, u = 0)');
  assert.deepEqual(st.rows[0].labels, ['x', 'θ', 'v', 'ω']);
  assert.equal(st.rows[1].note, 'x follows r');
  assert.match(st.rows[2].value, /rad\/s, ζ 0\.\d+/);
  assert.match(st.key, /^[0-9a-f]{12}$/);
  assert.deepEqual([st.path, st.block, st.variant, st.type, st.cached, st.error], ['ctrl', 'controller', 'LQR', 'lqr', false, null]);
  assert.ok(!('values' in JSON.parse(JSON.stringify(st))));
  // One Q for all measurements.
  assert.deepEqual(statusOf(project('Pendulum swing-up', [lqr([1], 1)])).values.K, statusOf(project('Pendulum swing-up', [lqr([1, 1, 1, 1], 1)])).values.K);

  // ω not wired: refused, naming ω; the controller then puts out 0 and the run goes on.
  const p = project('Pendulum swing-up', [lqr([10, 50, 1, 1], 0.1)]);
  p.system.plant.diagram.wires = p.system.plant.diagram.wires.filter((w) => w.to !== 'ctrl:4');
  const res = evaluateSystem(p, { designs: createDesignStore() });
  const [bad] = res.info.designs;
  assert.equal(bad.status, 'error');
  assert.equal(bad.error.code, 'states-not-measured');
  assert.match(bad.error.message, /^LQR needs every state measured\. This block sees x, θ, v but not ω \(cart and pole\)\.$/);
  assert.match(bad.error.hint, /wire ω to an input, or add a Kalman Observer/);
  assert.equal(bad.values, null);
  assert.ok(res.signals.F.every((v) => v === 0), 'u = 0');
  assert.ok(res.signals.theta.every(Number.isFinite));
  // Q of the wrong length.
  const q3 = statusOf(project('Pendulum swing-up', [lqr([1, 2, 3], 1)]));
  assert.equal(q3.error.code, 'q-length');
  assert.match(q3.error.message, /Q has 3 values; this block has 4 measurements \(x, θ, v, ω\)/);
  // The motor measures its angle only.
  const motor = statusOf(project('DC motor', [lqr([1], 1)]));
  assert.equal(motor.error.code, 'states-not-measured');
  assert.match(motor.error.message, /sees angle but not Motor\/armature and Motor\/load\./);
  assert.match(motor.error.hint, /^wire armature and load to inputs, or add a Kalman Observer$/);
});

test('the design store: a design runs again only when what it depends on changes', () => {
  // Test 7, without the trajectory part. A second, unrelated Controller
  // shows that switching another block's variant does not re-design.
  const p = project('Pendulum swing-up', [lqr([10, 50, 1, 1], 0.1, { umin: -25, umax: 25 }), { type: 'pid', params: { Kp: 2 } }]);
  const d = p.system.plant.diagram;
  d.blocks.push({ id: 'c2', type: 'controller', name: 'other', params: { inputs: 2, Ts: 0.01 }, variants: [{ type: 'pid', params: { Kp: 1 } }, { type: 'off' }], x: 0, y: 400 },
    { id: 'i2', type: 'integrator', params: { K: 1 }, x: 120, y: 400 });
  d.wires.push({ from: 'r', to: 'c2' }, { from: 'c2', to: 'i2' }, { from: 'i2', to: 'c2:1' });
  p.system.plant.diagram = normalizeDiagram(d);
  const blk = (id) => p.system.plant.diagram.blocks.find((b) => b.id === id);
  const store = createDesignStore();
  const run = () => evaluateSystem(p, { designs: store }).info.designs;
  const runs = () => store.stats().runs;

  const [first] = run();
  assert.equal(first.status, 'ok');
  assert.equal(runs(), 1);
  const [again] = run();
  assert.equal(runs(), 1);
  assert.equal(store.stats().hits, 1, 'a second compile is a hit');
  assert.ok(again.cached && !first.cached);
  assert.equal(again.key, first.key);
  assert.deepEqual(again.values, first.values);

  // None of these re-design.
  blk('cart').x += 60; run();
  blk('F').params.name = 'force';
  assert.match(run()[0].seen, /^force → /, 'a renamed Sink names u at once');
  p.system.signals.r.components.push({ type: 'step', params: { amplitude: 0.2, time: 1 } }); run();
  p.scope.timebase.scale *= 2; run();
  blk('ctrl').variants[1].params.Kp = 3; run();
  blk('c2').variant = 1; run();
  assert.equal(runs(), 1, 'moving, renaming a Sink, the signal r, the timebase, another variant, another Controller');

  // These do.
  const rerun = (what, fn) => { const before = runs(); fn(); const [st] = run(); assert.equal(runs(), before + 1, what); assert.ok(!st.cached, what); return st; };
  const heavier = rerun('the bob\'s mass', () => { blk('cart').params.m = 0.3; });
  assert.notDeepEqual(heavier.values.K, first.values.K);
  rerun('the start angle', () => { blk('cart').params.theta0 = 3; });
  rerun('Ts', () => { blk('ctrl').params.Ts = 0.02; });
  rerun('the variant\'s own Q', () => { blk('ctrl').variants[0].params.Q = [10, 60, 1, 1]; });
  // Back to an earlier design: from the cache.
  blk('ctrl').variants[0].params.Q = [10, 50, 1, 1];
  blk('ctrl').params.Ts = 0.01;
  blk('cart').params.theta0 = Math.PI;
  blk('cart').params.m = 0.2;
  const before = runs();
  assert.deepEqual(run()[0].values, first.values);
  assert.equal(runs(), before);
});

test('lqr in a file holds inputs only; computed numbers are refused; Copy as numbers runs bit for bit', () => {
  // Test 8, for lqr.
  const p = project('Pendulum swing-up', [lqr([10, 50, 1, 1], 0.1, { umin: -25, umax: 25 }), { name: 'Off', type: 'off' }]);
  const json = JSON.stringify(p);
  assert.ok(!/"K"|"kr"/.test(json), 'no computed gains in the file');
  assert.deepEqual(normalizeProject(JSON.parse(json)), p, 'round trip');
  assert.deepEqual(ctrlOf(p).variants[0].params, { Q: [10, 50, 1, 1], R: 0.1, track: 1, Tr: 0, umin: -25, umax: 25 });
  const withK = JSON.parse(json);
  ctrlOf(withK).variants[0].params.K = [1, 2, 3, 4];
  assert.throws(() => normalizeProject(withK), /variants\[0\]\.params\.K: lqr computes K and kr from the plant and Q, R and track; to set them by hand use Copy as numbers \(a State feedback variant\)/);
  assert.throws(() => normalizeVariant({ type: 'lqr', params: { kr: 1 } }), /Copy as numbers/);
  assert.throws(() => normalizeVariant({ type: 'lqr', params: { R: 0 } }), /R: above 0/);
  assert.throws(() => normalizeVariant({ type: 'lqr', params: { Q: [1, -1] } }), /Q: each at least 0/);
  assert.equal(normalizeVariant({ type: 'lqr', params: { track: 1.6 } }).params.track, 2);

  // Copy as numbers: the twin is a State feedback variant with the computed
  // numbers, and runs exactly as the designed one.
  const store = createDesignStore();
  const designed = evaluateSystem(p, { designs: store });
  const [st] = designed.info.designs;
  const twin = CONTROLLERS.lqr.manual(ctrlOf(p).variants[0].params, st.values);
  assert.equal(twin.type, 'stateFeedback');
  const c = ctrlOf(p);
  c.variants.splice(1, 0, normalizeVariant({ name: 'LQR (numbers)', ...twin }));
  c.variant = 1;
  const copied = evaluateSystem(normalizeProject(JSON.parse(JSON.stringify(p))), { designs: store });
  assert.deepEqual(copied.info.designs, []);
  for (const name of Object.keys(designed.signals)) assert.deepEqual(copied.signals[name], designed.signals[name], name);
  assert.ok(Math.abs(designed.signals.F[100]) > 0.1, 'and it does something');
});

test('designs resolve observers first: a Controller looks through a designed observer', () => {
  // A stand-in for the designed Kalman filter (step 11): its design says
  // which true state each estimate stands for. An LQR on the estimates then
  // designs the same K as on the states themselves.
  OBSERVERS.truth = {
    label: 'Truth', summary: 'x̂ = x (test)', params: [], designed: true, version: 1, computes: [],
    design(p, ctx) {
      const states = ctx.model().states;
      return { values: { stateIndex: ['x', 'θ', 'v', 'ω'].map((n) => states.find((s) => s.name === n).index) }, rows: [] };
    },
    make: () => ({ step: () => new Float64Array(4) }),
  };
  try {
    const p = project('Pendulum swing-up', [lqr([10, 50, 1, 1], 0.1)]);
    const d = p.system.plant.diagram;
    d.blocks.push({ id: 'obs', type: 'observer', name: 'estimator', params: { inputs: 3, outputs: 4, Ts: 0.01 }, variants: [{ type: 'truth' }], x: 200, y: 300 });
    d.wires = d.wires.filter((w) => !w.to.startsWith('ctrl:'));
    d.wires.push({ from: 'ctrl', to: 'obs' }, { from: 'cart', to: 'obs:1' }, { from: 'cart:1', to: 'obs:2' },
      ...[0, 1, 2, 3].map((j) => ({ from: j ? `obs:${j}` : 'obs', to: `ctrl:${j + 1}` })));
    const el = compileDiagram(normalizeDiagram(d), 'plant', { standalone: true, designs: createDesignStore() });
    assert.deepEqual(el.designs.map((s) => [s.path, s.status]), [['obs', 'ok'], ['ctrl', 'ok']]);
    assert.equal(el.designs[0].seen, 'controller → x, θ · 4 states (x, v, θ, ω)');
    const direct = statusOf(project('Pendulum swing-up', [lqr([10, 50, 1, 1], 0.1)]));
    assert.deepEqual(el.designs[1].values.K, direct.values.K);
  } finally { delete OBSERVERS.truth; }
});

test('scheduledPI: pole cancellation from the tank at each level reproduces the formulas and the old table', () => {
  // Test 6. Linearised at level h the tank is (1/A(h)) / (s + 1/τ(h)), so a
  // PI for a closed loop of time constant Tcl has Kp = A(h) / Tcl and
  // Ki = a √(2g) / (2 √h Tcl); u0 = a √(2g h0) balances the outlet at the start.
  const p = project('Conical tank');
  const tank = p.system.plant.diagram.blocks.find((b) => b.type === 'conicalTank').params;
  const A = (h) => Math.PI * (tank.r0 + ((tank.R - tank.r0) * Math.min(h, tank.H)) / tank.H) ** 2;
  const rel = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${what}: ${a}, not ${b}`);
  const at = [0.1, 0.25, 0.5, 0.75, 1];
  const st = statusOf(p);
  assert.equal(st.status, 'ok', JSON.stringify(st.error));
  assert.equal(st.type, 'scheduledPI');
  const { Kp, Ki, u0 } = st.values;
  assert.deepEqual(st.values.at, at);
  at.forEach((h, i) => {
    rel(Kp[i], A(h) / 0.25, 1e-6, `Kp at ${h}`);
    rel(Ki[i], (tank.a * Math.sqrt(2 * tank.g)) / (2 * Math.sqrt(h) * 0.25), 1e-6, `Ki at ${h}`);
  });
  // The table the library held, to 0.5 %.
  [0.113, 0.332, 0.95, 1.887, 3.142].forEach((v, i) => rel(Kp[i], v, 5e-3, `old Kp[${i}]`));
  [2.801, 1.772, 1.253, 1.023, 0.886].forEach((v, i) => rel(Ki[i], v, 5e-3, `old Ki[${i}]`));
  rel(u0, tank.a * Math.sqrt(2 * tank.g * tank.h0), 1e-9, 'u0');
  assert.equal(Number(u0.toFixed(4)), 0.1716);
  assert.equal(st.at, 'h = 0.1 … 1 m (5 levels)');
  assert.deepEqual(st.rows[0].head, ['h (m)', 'q', 'K', 'τ (s)', 'Kp', 'Ki']);
  assert.deepEqual(st.rows[0].table.map((row) => row.slice(4)), at.map((_, i) => [Kp[i], Ki[i]]));
  assert.deepEqual(st.rows[1], { label: 'dead time θ', value: 0.1, note: 's, left out' });
  assert.deepEqual(st.rows[2], { label: 'u0', value: u0, note: 'holds h = 0.15 m, where it starts' });
  assert.ok(st.warnings.includes('dead time 0.1 s on h is not in this design: pole cancellation leaves it out'));
  // The fixed PIs, tuned for full (0.8 m) and for empty (0.15 m), to 0.5 %.
  for (const [name, kp, ki] of [['PI tuned for full', 2.112, 0.99], ['PI tuned for empty', 0.173, 2.287]]) {
    const q = project('Conical tank');
    ctrlOf(q).variant = ctrlOf(q).variants.findIndex((v) => v.name === name);
    const s = statusOf(q);
    assert.equal(s.values.at.length, 1);
    rel(s.values.Kp[0], kp, 5e-3, `${name} Kp`);
    rel(s.values.Ki[0], ki, 5e-3, `${name} Ki`);
    assert.equal(s.values.u0, u0);
  }
  // Refusals, as sentences: a level the pump cannot hold, an integrating plant.
  const high = statusOf(project('Conical tank', [{ type: 'scheduledPI', params: { at: [0.5, 0.98], umin: 0, umax: 0.4 } }]));
  assert.equal(high.error.code, 'u-limit');
  assert.match(high.error.message, /^holding h = 0\.98 m needs q = 0\.438, above u max 0\.4$/);
  const motor = statusOf(project('DC motor', [{ type: 'scheduledPI', params: { at: [1] } }]));
  assert.equal(motor.error.code, 'integrating-plant');
  assert.match(motor.error.message, /angle integrates V/);
  assert.throws(() => normalizeVariant({ type: 'scheduledPI', params: { at: [0.5, 0.2] } }), /the At values must increase/);
  assert.throws(() => normalizeVariant({ type: 'scheduledPI', params: { Tcl: 0 } }), /Tcl: above 0/);
});

test('swingUpLqr: the catch is LQR from the plant; it needs the cart–pole\'s x, θ, v, ω', () => {
  const st = statusOf(project('Pendulum swing-up'));
  assert.equal(st.type, 'swingUpLqr');
  assert.equal(st.status, 'ok', JSON.stringify(st.error));
  st.values.K.forEach((k, i) => assert.ok(Math.abs(k - K_SINGLE[i]) <= 1e-3 * Math.abs(K_SINGLE[i]), `K[${i}] = ${k}`));
  assert.ok(Math.abs(st.values.kr - st.values.K[0]) <= 1e-6 * Math.abs(st.values.K[0]));
  assert.equal(st.at, 'origin (all states 0, u = 0)');
  // The same weights as "LQR only": the same gains.
  const only = project('Pendulum swing-up');
  ctrlOf(only).variant = 1;
  assert.deepEqual(statusOf(only).values, st.values);
  // On the triple pendulum the swing-up would read the wrong inputs: refused.
  const triple = statusOf(project('Triple', [{ type: 'swingUpLqr', params: { Q: Q_TRIPLE, R: 0.1 } }]));
  assert.equal(triple.error.code, 'swing-inputs');
  assert.match(triple.error.message, /reads x, θ, v, ω \(θ an angle\) from inputs 2 to 5; this block has x, θ1, θ2, θ3, v, ω1, ω2, ω3/);
});

test('Copy as numbers: the hand twins of swingUpLqr and scheduledPI run bit for bit like the designed variants', () => {
  // Test 8, for swingUpLqr and scheduledPI with five levels and with one.
  for (const [name, variant, twinType] of [['Pendulum swing-up', 0, 'swingUp'], ['Conical tank', 0, 'gainScheduled'], ['Conical tank', 1, 'pid']]) {
    const p = project(name);
    const c = ctrlOf(p);
    c.variant = variant;
    const json = JSON.stringify(c.variants[variant]);
    assert.ok(!/"(K|kr|Kp|Ki|u0)"/.test(json), `${json}: inputs only`);
    const store = createDesignStore();
    const designed = evaluateSystem(p, { designs: store });
    const [st] = designed.info.designs;
    const v = c.variants[variant];
    const twin = CONTROLLERS[v.type].manual(v.params, st.values);
    assert.equal(twin.type, twinType);
    c.variants.splice(variant + 1, 0, normalizeVariant({ name: `${v.name} (numbers)`, ...twin }));
    c.variant = variant + 1;
    const copied = evaluateSystem(normalizeProject(JSON.parse(JSON.stringify(p))), { designs: store });
    assert.deepEqual(copied.info.designs, [], `${name}: the copy is a hand variant`);
    for (const sig of Object.keys(designed.signals)) assert.deepEqual(copied.signals[sig], designed.signals[sig], `${name} ${v.name}: ${sig}`);
  }
  // Computed numbers in a file are refused, naming the twin.
  assert.throws(() => normalizeVariant({ type: 'scheduledPI', params: { Kp: [1] } }), /scheduledPI computes Kp, Ki and u0 from the plant and at and Tcl; to set them by hand use Copy as numbers \(a PID or Gain-scheduled PI variant\)/);
  assert.throws(() => normalizeVariant({ type: 'swingUpLqr', params: { kr: 1 } }), /swingUpLqr computes K and kr .* \(a Swing-up \(Lyapunov\) \+ state feedback variant\)/);
});

test('guard: the library stores inputs only, never numbers computed from a plant', async () => {
  // Test 12.
  const { readFileSync } = await import('node:fs');
  const variants = [], delays = [];
  const walk = (d) => { for (const b of d.blocks) { if (b.variants) variants.push(...b.variants); if (b.type === 'delay') delays.push(b); if (b.diagram) walk(b.diagram); } };
  for (const s of SYSTEM_LIBRARY) walk(s.plant.diagram);
  assert.ok(variants.length >= 10);
  for (const v of variants) {
    const lib = CONTROLLERS[v.type] ? CONTROLLERS : OBSERVERS;
    assert.ok(lib[v.type].designed || ['pid', 'off'].includes(v.type), `${v.name}: ${v.type} holds numbers; use a designed type`);
    assert.ok(!('u0' in (v.params ?? {})), `${v.name}: a start output is a trim value, computed from the plant`);
  }
  for (const b of delays) assert.ok(b.params.y0 === null || b.params.y0 === undefined || b.params.y0 === 0, `${b.name}: y0 ${b.params.y0} is a computed start flow; leave it empty`);
  const src = readFileSync(new URL('../src/core/plants.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/'(?:[^'\\]|\\.)*'/g, "''");
  assert.deepEqual(src.match(/\bK_\w*/g) ?? [], [], 'no stored gain tables');
});

test('trajectory: Q, R, start and the limits re-run the gains, never the plan; T plans again', () => {
  // Test 7, the trajectory part. The library's triple pendulum runs it.
  const p = project('Triple');
  const v = ctrlOf(p).variants[0];
  assert.equal(v.type, 'trajectory');
  const store = createDesignStore();
  const st = () => statusOf(p, store);
  const counts = () => { const s = store.stats(); return [s.runs, s.heavyRuns]; };
  const same = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

  const first = st();
  assert.equal(first.status, 'ok', JSON.stringify(first.warnings));
  assert.deepEqual(counts(), [1, 1]);
  assert.match(first.rows[0].value, /^Planned in [\d.]+ s \(\d+ iterations, start 1 of 3\)\. Verified: upright 1 s after T, peak F [\d.]+ of 40\.$/);
  assert.equal(first.at, 'θ1, θ2, θ3 = 3.142 rad → origin');
  assert.deepEqual(first.rows.map((r) => r.label), ['plan', 'T', 'F(t)', 'end error', 'defect', 'K upright', 'kr', 'slowest pole']);
  assert.ok(first.rows[2].spark.length <= 120);
  assert.deepEqual(first.rows[3].labels, ['x', 'θ1', 'θ2', 'θ3', 'v', 'ω1', 'ω2', 'ω3']);
  const { F, Y, K, Kup, angle } = first.values;
  assert.deepEqual([F.length, Y.length, K.length, Kup.length], [240, 240 * 8, 240 * 8, 8]);
  assert.deepEqual(angle, [false, true, true, true, false, false, false, false]);
  const json = JSON.parse(JSON.stringify(first));
  assert.ok(!('values' in json), 'a status carries no values into JSON');
  assert.ok(JSON.stringify(json).length < 8000, 'only the rows: a sparkline of F, the end error, the upright gains');

  // The light inputs: the gains again (a few ms), the same plan.
  v.params.Q = [20, 100, 100, 100, 1, 1, 1, 1];
  const q = st();
  assert.deepEqual(counts(), [2, 1], 'Q re-runs the gains only');
  assert.ok(same(q.values.F, F) && !same(q.values.K, K) && !same(q.values.Kup, Kup));
  assert.ok(q.ms < 500, `${q.ms} ms for the gains`);
  v.params.R = 0.2; st();
  v.params.start = 0.5; st();
  v.params.umax = 50; st();   // the plan may still use 75 % of the smaller limit, 40
  assert.deepEqual(counts(), [5, 1], 'R, start and a limit that leaves the plan\'s force alone');
  // The plan's own inputs: a new plan.
  v.params.T = 2.5;
  const longer = st();
  assert.deepEqual(counts(), [6, 2], 'T plans again');
  assert.equal(longer.values.F.length, 252, 'T snapped to whole samples: 12 segments of 21');
  assert.ok(Math.abs(longer.rows[1].value - 2.52) < 1e-12);
  // Back: both from the cache.
  v.params.T = 2.4; v.params.Q = Q_TRIPLE; v.params.R = 0.1; v.params.start = 0; v.params.umax = 40;
  const back = st();
  assert.ok(back.cached && same(back.values.K, K));
  assert.deepEqual(counts(), [6, 2]);
});

test('trajectory: a plan that cannot be is a warning, and the attempt still runs; plans are never kept in a file', () => {
  const p = project('Triple', [{ name: 'Too short', type: 'trajectory', params: { T: 0.5, Q: Q_TRIPLE, R: 0.1, umin: -40, umax: 40 } }]);
  const res = evaluateSystem(p, { designs: createDesignStore() });
  const [st] = res.info.designs;
  assert.equal(st.status, 'warn');
  assert.match(st.rows[0].value, /^Not converged in/);
  assert.ok(st.warnings.some((w) => /^no plan found: .* \(300 iterations, \d starts?\): needs more force or a longer T \(now 0\.48 s\)$/.test(w)), st.warnings.join(' | '));
  assert.ok(st.values && res.signals.F.some((f) => Math.abs(f) > 1), 'the attempt runs');
  // Inputs only: what a plan computes is refused, and there is no hand twin.
  assert.throws(() => normalizeVariant({ type: 'trajectory', params: { F: [1, 2] } }), /variant\.params\.F: trajectory computes F, Y, K, Kup and kr from the plant and T, segments, planShare, start, Q and R; they are never kept in a file/);
  assert.throws(() => normalizeVariant({ type: 'trajectory', params: { planShare: 1.5 } }), /planShare: at most 1/);
  assert.equal(CONTROLLERS.trajectory.manual, undefined, 'no Copy as numbers for a plan');
  const bad = statusOf(project('Triple', [{ type: 'trajectory', params: { Q: Q_TRIPLE, R: 0.1, umin: 0, umax: 40 } }]));
  assert.equal(bad.error.code, 'bad-limits');
});

test('cli: node cli.mjs design prints what the running designed variants computed', async () => {
  // Test 15.
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const file = join(mkdtempSync(join(tmpdir(), 'lt-')), 'triple.json');
  execFileSync('node', ['cli.mjs', 'new', '--system', 'Triple pendulum', '-o', file]);
  const text = execFileSync('node', ['cli.mjs', 'design', file]).toString();
  assert.match(text, /^Triple pendulum: 1 designed variant running/);
  assert.match(text, /ctrl · controller · Planned swing-up \+ TV-LQR \(trajectory\): ok · /);
  assert.match(text, /K upright +x -6\.99 +θ1 -497\.8/);
  const json = JSON.parse(execFileSync('node', ['cli.mjs', 'design', file, '--json', '--block', 'ctrl']).toString());
  assert.equal(json.title, 'Triple pendulum');
  assert.deepEqual(json.designs.map((d) => [d.path, d.type, d.status]), [['ctrl', 'trajectory', 'ok']]);
  assert.ok(json.designs[0].rows.some((r) => r.label === 'K upright' && r.value.length === 8));
});
