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
  assert.equal(st.seen, 'F → x, θ, v, ω · 4 states (x, θ, v, ω)');
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
  assert.match(motor.error.message, /sees rotor angle but not Motor\/armature 1\/\(L·s \+ R\) and Motor\/rotor 1\/Jm\./);
  assert.match(motor.error.hint, /^wire armature 1\/\(L·s \+ R\) and rotor 1\/Jm to inputs, or add a Kalman Observer$/);
  // No weight on a mode that does not decay by itself: the cart's position
  // (an integrator, |z| = 1), or with Q = 0 the falling pole too. Q says so,
  // not the wiring.
  const free = statusOf(project('Pendulum swing-up', [lqr([0, 50, 1, 1], 0.1)]));
  assert.equal(free.error.code, 'not-stabilisable');
  assert.match(free.error.message, /^LQR finds no gain that holds this plant: Q gives no weight to x, and a mode seen only there does not decay by itself \(\|z\| = 1\)$/);
  assert.equal(free.error.hint, 'give x a weight above 0');
  const none = statusOf(project('Pendulum swing-up', [lqr([0], 0.1)]));
  assert.match(none.error.message, /Q gives no weight to x, θ, v and ω/);
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
  p.system.signals.r.components.push({ type: 'step', params: { amplitude: 0.2, time: 1 } }); run();
  p.scope.timebase.scale *= 2; run();
  blk('ctrl').variants[1].params.Kp = 3; run();
  blk('c2').variant = 1; run();
  assert.equal(runs(), 1, 'moving, the signal r, the timebase, another variant, another Controller');
  // A renamed Sink names u in the design's rows: the light design runs again
  // (a plan would not: the trajectory test).
  blk('F').params.name = 'force';
  const renamed = run()[0];
  assert.match(renamed.seen, /^force → /, 'a renamed Sink names u at once');
  assert.equal(runs(), 2, 'renaming the Sink of u');
  assert.deepEqual(renamed.values, first.values, 'the same numbers');
  blk('F').params.name = 'F'; run();
  assert.equal(runs(), 2, 'back: from the cache');

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
    // u is named by the Sink that records it, for an Observer as for a Controller.
    assert.equal(el.designs[0].seen, 'F → x, θ · 4 states (x, θ, v, ω)');
    const direct = statusOf(project('Pendulum swing-up', [lqr([10, 50, 1, 1], 0.1)]));
    assert.deepEqual(el.designs[1].values.K, direct.values.K);
  } finally { delete OBSERVERS.truth; }
});

test('scheduledPI: pole cancellation from the tank at each level reproduces the formulas and the old table', () => {
  // Test 6. Linearised at level h the tank is (1/A(h)) / (s + 1/τ(h)), so a
  // PI for a closed loop of time constant Tcl has Kp = A(h) / Tcl and
  // Ki = a √(2g) / (2 √h Tcl); u0 = a √(2g h0) balances the outlet at the start.
  const p = project('Conical tank');
  const tank = p.system.plant.diagram.blocks.find((b) => b.id === 'tank').params;
  const A = (h) => Math.PI * (tank.r0 + ((tank.R - tank.r0) * Math.min(h, tank.H)) / tank.H) ** 2;
  const rel = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${what}: ${a}, not ${b}`);
  // The top level is 0.95 m: at the brim, 1 m, the tank overflows (below).
  const at = [0.1, 0.25, 0.5, 0.75, 0.95];
  const st = statusOf(p);
  assert.equal(st.status, 'ok', JSON.stringify(st.error));
  assert.equal(st.type, 'scheduledPI');
  const { Kp, Ki, u0 } = st.values;
  assert.deepEqual(st.values.at, at);
  at.forEach((h, i) => {
    rel(Kp[i], A(h) / 0.25, 1e-6, `Kp at ${h}`);
    rel(Ki[i], (tank.a * Math.sqrt(2 * tank.g)) / (2 * Math.sqrt(h) * 0.25), 1e-6, `Ki at ${h}`);
  });
  // The table the library held, to 0.5 %, at the levels it shares.
  [0.113, 0.332, 0.95, 1.887].forEach((v, i) => rel(Kp[i], v, 5e-3, `old Kp[${i}]`));
  [2.801, 1.772, 1.253, 1.023].forEach((v, i) => rel(Ki[i], v, 5e-3, `old Ki[${i}]`));
  rel(u0, tank.a * Math.sqrt(2 * tank.g * tank.h0), 1e-9, 'u0');
  assert.equal(Number(u0.toFixed(4)), 0.1716);
  assert.equal(st.at, 'h = 0.1 … 0.95 m (5 levels)');
  // At the brim the level's rate has a slope below and none above (what
  // comes in beyond it overflows): a kink, so no PI is designed there.
  const brim = statusOf(project('Conical tank', [{ type: 'scheduledPI', params: { at: [0.5, 1], umin: 0, umax: 3 } }]));
  assert.equal(brim.error.code, 'kink');
  assert.match(brim.error.message, /^pole cancellation needs slopes, and the plant has a kink at h = 1 m, q = 0\.443: the slope of the rate of tank\/h along tank\/h differs left and right/);
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
  assert.match(motor.error.message, /θ measured integrates V/);
  assert.throws(() => normalizeVariant({ type: 'scheduledPI', params: { at: [0.5, 0.2] } }), /the At values must increase/);
  assert.throws(() => normalizeVariant({ type: 'scheduledPI', params: { Tcl: 0 } }), /Tcl: above 0/);
  // A closed loop faster than the pipe's dead time and half a sample allow
  // would ring or cycle (Tcl 0.05 s cycles between 0.76 and 0.91 m): a
  // warning with the numbers. So does a sample time long against Tcl.
  const quick = statusOf(project('Conical tank', [{ type: 'scheduledPI', params: { at: [0.8], Tcl: 0.05, umin: 0, umax: 3 } }]));
  assert.equal(quick.status, 'warn');
  assert.ok(quick.warnings.includes('Tcl 0.05 s is faster than the loop can be: the dead time 0.1 s and half the sample time 0.02 s add 0.11 s, and the loop will ring or cycle; make Tcl at least 0.11 s'), quick.warnings.join(' | '));
  const slow = project('Conical tank');
  ctrlOf(slow).params.Ts = 0.5;
  const ss = statusOf(slow);
  assert.equal(ss.status, 'warn');
  assert.ok(ss.warnings.some((w) => /^Tcl 0\.25 s is faster than the loop can be: the dead time 0\.1 s and half the sample time 0\.5 s add 0\.35 s/.test(w)), ss.warnings.join(' | '));
  ctrlOf(slow).params.Ts = 0.1;
  ctrlOf(slow).variants[0].params.Tcl = 0.3;
  assert.ok(statusOf(slow).warnings.includes('the sample time 0.1 s is long against the closed loop Tcl 0.3 s; Ts ≤ Tcl / 4 (0.075 s) follows it closely'));
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
  assert.deepEqual([statusOf(only).values.K, statusOf(only).values.kr], [st.values.K, st.values.kr]);
  // The pole the pump measures energy with comes from the plant: l and g of
  // the cart–pole, and a longer pole gives its own.
  assert.ok(Math.abs(st.values.l - 0.5) < 1e-6 && Math.abs(st.values.g - 9.81) < 1e-5, `l ${st.values.l}, g ${st.values.g}`);
  assert.deepEqual(st.rows.at(-1).labels, ['l', 'g']);
  const longer = project('Pendulum swing-up');
  longer.system.plant.diagram.blocks.find((b) => b.id === 'cart').params.l = 0.8;
  const lv = statusOf(longer).values;
  assert.ok(Math.abs(lv.l - 0.8) < 1e-6 && Math.abs(lv.g - 9.81) < 1e-5, `l ${lv.l}, g ${lv.g}`);
  assert.deepEqual(CONTROLLERS.swingUpLqr.manual(ctrlOf(longer).variants[0].params, lv).params.l, lv.l);
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
  assert.throws(() => normalizeVariant({ type: 'swingUpLqr', params: { kr: 1 } }), /swingUpLqr computes K, kr, l and g .* \(a Swing-up \(Lyapunov\) \+ state feedback variant\)/);
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
    // Sliding mode's λ, K, φ (and super-twisting's k1) are tuning inputs a
    // person chooses, as a PID's gains are. (The library's super-twisting
    // k2 = 44 is Levant's 1.1·L/β with the motor's β, a guessed L: derived
    // from the plant, an open question for the person; roadmap.) A finite
    // difference's rate filter (the PUMA's encoders, Tf 0) is a sensor
    // choice, not a number from the plant.
    // Gear backlash's Dual loop is a PD whose damping reads the motor's
    // speed: state feedback holding the PD's hand gains.
    assert.ok(lib[v.type].designed || ['pid', 'off', 'slidingMode', 'superTwisting', 'difference'].includes(v.type) || v.name === 'Dual loop', `${v.name}: ${v.type} holds numbers; use a designed type`);
    assert.ok(!('u0' in (v.params ?? {})), `${v.name}: a start output is a trim value, computed from the plant`);
    // A feedforward that follows r is the plant's inverse: computed (pidFF), never a hand number in the library.
    for (const k of ['Kff', 'Kv', 'Ka']) assert.ok(!v.params?.[k], `${v.name}: ${k} ${v.params?.[k]} is computable from the plant; use pidFF`);
  }
  for (const b of delays) assert.ok(b.params.y0 === null || b.params.y0 === undefined || b.params.y0 === 0, `${b.name}: y0 ${b.params.y0} is a computed start flow; leave it empty`);
  const src = readFileSync(new URL('../src/core/plants.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/'(?:[^'\\]|\\.)*'/g, "''");
  assert.deepEqual(src.match(/\bK_\w*/g) ?? [], [], 'no stored gain tables');
});

test('trajectory: Q, R and start re-run the gains, never the plan; T and the limits plan again', () => {
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
  assert.match(first.rows[0].value, /^Planned in [\d.]+ s \(\d+ iterations, start 1 of 3\)\. Verified: at rest at the origin 1 s after T, peak F [\d.]+ \(limits -40 to 40\)\.$/);
  assert.equal(first.at, 'θ1, θ2, θ3 = 3.142 rad → origin');
  assert.deepEqual(first.rows.map((r) => r.label), ['plan', 'T', 'F(t)', 'end error', 'defect', 'K at the origin', 'kr', 'slowest pole']);
  assert.match(first.rows[2].note, /^-?[\d.]+ to [\d.]+, of -30 to 30 it may use$/);
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
  assert.deepEqual(counts(), [4, 1], 'R and start');
  // A limit is the plan's: it may use 75 % of each, so either one plans again
  // (seen here as the heavy job a page's store would queue, without running it).
  const queued = () => { const a = createDesignStore({ mode: 'async' }); statusOf(p, a); return a.queue()[0]?.key; };
  const k0 = queued();
  v.params.Q = Q_TRIPLE; assert.equal(queued(), k0, 'Q does not');
  v.params.umax = 50; const k1 = queued();
  v.params.umin = -30; const k2 = queued();
  assert.ok(k0 && k1 !== k0 && k2 !== k1 && k2 !== k0, 'u max and u min do');
  v.params.umax = 40; v.params.umin = -40;
  assert.equal(queued(), k0);
  // So do the plan's own inputs (the snapped grid of a new T is checked on the cart–pole, below).
  for (const [key, value] of [['T', 2.5], ['segments', 10], ['planShare', 0.5]]) {
    const old = v.params[key];
    v.params[key] = value;
    assert.notEqual(queued(), k0, `${key} plans again`);
    v.params[key] = old;
  }
  assert.deepEqual(counts(), [4, 1]);
  // Back: from the cache.
  v.params.Q = Q_TRIPLE; v.params.R = 0.1; v.params.start = 0;
  const back = st();
  assert.ok(back.cached && same(back.values.K, K));
  assert.deepEqual(counts(), [4, 1]);
  // A renamed Sink of u: the rows say its new name ("force(t)", "peak
  // force"); TV-LQR runs again, the plan is not made again.
  const sinkF = p.system.plant.diagram.blocks.find((b) => b.type === 'sink' && b.params.name === 'F');
  sinkF.params.name = 'force';
  const renamed = st();
  assert.deepEqual(counts(), [5, 1], 'the gains again, not the plan');
  assert.equal(renamed.rows[2].label, 'force(t)');
  assert.match(renamed.rows[0].value, /peak force [\d.]+/);
  assert.ok(same(renamed.values.F, F));
});

test('trajectory: verified as it runs, from t = 0 through start; the force it may use each way', () => {
  // The single cart–pole, planned from θ = 2 rad (not at rest: it falls).
  const p = project('Pendulum swing-up', [{ name: 'plan', type: 'trajectory', params: { T: 2.4, Q: [10, 50, 1, 1], R: 0.1, umin: -25, umax: 25 } }]);
  p.system.plant.diagram.blocks.find((b) => b.id === 'cart').params.theta0 = 2;
  const store = createDesignStore();
  const now = statusOf(p, store);
  assert.equal(now.status, 'ok', now.warnings.join(' | '));
  // Starting 1 s later the pole has fallen elsewhere: the check runs the law
  // as it runs (u = 0 until start), says the loop does not hold, and why.
  ctrlOf(p).variants[0].params.start = 1;
  const late = statusOf(p, store);
  assert.equal(store.stats().heavyRuns, 1, 'start is light: the same plan');
  assert.equal(late.status, 'warn');
  assert.match(late.rows[0].value, /The loop does not hold: x is [\d.]+ m off 1 s after T\.$/);
  assert.ok(late.warnings.includes('the plant does not rest at its start state, and the plan assumes it does until start (1 s): start at 0, or start the plant at rest'), late.warnings.join(' | '));
  // A one-way-heavy actuator, −5 to 25 N: the plan may use 75 % of each side.
  const asym = project('Pendulum swing-up', [{ name: 'plan', type: 'trajectory', params: { T: 2.4, Q: [10, 50, 1, 1], R: 0.1, umin: -5, umax: 25 } }]);
  const a = statusOf(asym);
  assert.equal(a.status, 'ok', a.warnings.join(' | '));
  const lo = Math.min(...a.values.F), hi = Math.max(...a.values.F);
  assert.ok(lo >= -3.75 * 1.05 && hi <= 18.75 * 1.05 && hi > 3.75 * 1.05, `F from ${lo} to ${hi}`);
  assert.match(a.rows[2].note, /, of -3\.75 to 18\.75 it may use$/);
  // T is snapped to whole samples: 2.5 s is 12 segments of 21 samples of 10 ms.
  ctrlOf(asym).variants[0].params.T = 2.5;
  const longer = statusOf(asym);
  assert.equal(longer.values.F.length, 252);
  assert.ok(Math.abs(longer.rows[1].value - 2.52) < 1e-12);
  assert.equal(longer.rows[1].note, 's, 12 segments of 21 samples');
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
  execFileSync('node', ['tools/cli.mjs', 'new', '--system', 'Triple pendulum', '-o', file]);
  const text = execFileSync('node', ['tools/cli.mjs', 'design', file]).toString();
  assert.match(text, /^Triple pendulum: 1 designed variant running/);
  assert.match(text, /ctrl · controller · Planned swing-up \+ TV-LQR \(trajectory\): ok · /);
  assert.match(text, /K at the origin +x -6\.99 +θ1 -497\.8/);
  // JSON, on a system that designs in milliseconds (one plan per test file is enough).
  const single = join(mkdtempSync(join(tmpdir(), 'lt-')), 'pendulum.json');
  execFileSync('node', ['tools/cli.mjs', 'new', '--system', 'Pendulum swing-up', '-o', single]);
  const json = JSON.parse(execFileSync('node', ['tools/cli.mjs', 'design', single, '--json', '--block', 'ctrl']).toString());
  assert.equal(json.title, 'Pendulum swing-up');
  assert.deepEqual(json.designs.map((d) => [d.path, d.type, d.status]), [['ctrl', 'swingUpLqr', 'ok']]);
  assert.ok(json.designs[0].rows.some((r) => r.label === 'K' && r.value.length === 4));
  assert.ok(!/"values"/.test(JSON.stringify(json)), 'no numbers but the rows');
});

test('pidFF: the feedforward is the plant\'s inverse plus what the PID takes away; refusals in sentences', async () => {
  const { inverseSeries } = await import('../src/core/design.js');
  // 2/(s + 1): 1/G = 0.5 + 0.5 s. An integrator with a lag, 1/(s (s + 1)): s + s².
  assert.deepEqual(inverseSeries({ A: [[-1]], b: [1], c: [2], d: 0 }).h, [0.5, 0.5, 0]);
  const integ = inverseSeries({ A: [[0, 1], [0, -1]], b: [0, 1], c: [1, 0], d: 0 }).h;
  [0, 1, 1].forEach((v, i) => assert.ok(Math.abs(integ[i] - v) < 1e-12, `h${i} ${integ[i]}`));
  // The motor from V to the angle: Kt / (s ((L s + R)(J s + b) + Kt Ke)), so
  // 1/G = (R b + Kt Ke)/Kt · s + (R J + L b)/Kt · s² + …: Kv = Ke + R b/Kt,
  // Ka = (R J + L b)/Kt, plus Kd and less Kd·Tf from the PID; Kff = Kp (1 − b).
  const [R, L, J, b, K] = [1, 0.01, 0.02, 0.1, 0.5];
  const ff = (params) => statusOf(project('Following a sine', [{ name: 'ff', type: 'pidFF', params: { Kp: 30, Ki: 80, Kd: 1, Tf: 0.02, umin: -12, umax: 12, ...params } }]));
  const all = ff({ b: 0.6 });
  assert.equal(all.status, 'ok', JSON.stringify(all.error));
  const close = (a, x, what) => assert.ok(Math.abs(a - x) < 1e-9, `${what}: ${a}, not ${x}`);
  close(all.values.Kff, 30 * 0.4, 'Kff');
  close(all.values.Kv, K + (R * b) / K + 1, 'Kv');
  close(all.values.Ka, (R * J + L * b) / K - 0.02, 'Ka');
  assert.deepEqual(all.rows.map((r) => r.label), ['plant inverse', 'feedforward']);
  const one = ff({ order: '1' }).values;
  assert.deepEqual([one.Kff, one.Ka], [0, 0]);
  close(one.Kv, 1.7, 'Kv, velocity only');
  // In a file: inputs only.
  assert.throws(() => normalizeVariant({ type: 'pidFF', params: { Kp: 1, Kv: 1.7 } }), /pidFF computes Kff, Kv and Ka from the plant .*use Copy as numbers \(a PID variant\)/);
  // Copy as numbers: a PID with those numbers, running the same.
  const twin = CONTROLLERS.pidFF.manual(normalizeVariant({ type: 'pidFF', params: { Kp: 30, Ki: 80, Kd: 1, Tf: 0.02 } }).params, all.values);
  assert.equal(twin.type, 'pid');
  // A path with a zero in the right half-plane, and one with a zero at the origin, are refused.
  const plantOf = (num, den) => normalizeDiagram({
    blocks: [
      { id: 'r', type: 'source', params: { signal: 'r' } },
      { id: 'ctrl', type: 'controller', params: { inputs: 2, Ts: 0.01 }, variants: [{ name: 'ff', type: 'pidFF', params: { Kp: 1 } }] },
      { id: 'g', type: 'tf', params: { num, den } },
      { id: 'y', type: 'sink', params: { name: 'y' } },
    ],
    wires: [{ from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'g' }, { from: 'g', to: 'y' }, { from: 'g', to: 'ctrl:1' }],
  });
  const refused = (d) => compileDiagram(d, 'plant', { standalone: true, designs: createDesignStore() }).designs[0].error;
  const nmp = refused(plantOf([-1, 1], [1, 2, 1]));
  assert.equal(nmp?.code, 'nonminimum-phase', JSON.stringify(nmp));
  assert.match(nmp.message, /a zero at s = 1 in the right half-plane: its inverse is unstable/);
  assert.equal(refused(plantOf([1, 0], [1, 2, 1]))?.code, 'zero-at-origin');
});
