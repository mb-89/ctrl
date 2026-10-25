// Deadbeat (design/research/deadbeat.md; design.js, deadbeatDesign) and its
// example, *DC motor, deadbeat* (design/output/system-library.md): every pole
// of the loop at z = 0, so a step of r is followed in n samples exactly; held
// to the linear plant to rounding, to an independent computation of its
// inputs, and to what the notes say the library system does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileDiagram } from '../src/core/diagram.js';
import { CONTROLLERS, normalizeVariant, makeLaw } from '../src/core/controllers.js';
import { createDesignStore } from '../src/core/design.js';
import { c2d, solve } from '../src/core/linalg.js';
import { analyzeLoop, stepResponse } from '../src/core/analysis.js';
import { normalizeProject, evaluateSystem, autoTimebase, loopModel } from '../src/core/project.js';
import { SYSTEM_LIBRARY, applySystem } from '../src/core/systems.js';
import { describeVariant } from '../src/core/structure.js';
import { DEFAULT_PROJECT } from '../src/core/examples.js';

const NAME = 'DC motor, deadbeat';
const entry = SYSTEM_LIBRARY.find((s) => s.name === NAME);
// The motor's physics as the library's blocks hold it (plants.js, motorBlock),
// states in the order the plant is seen: current, speed, angle.
const R = 1, L = 0.01, Kt = 0.5, b = 0.1;
const motor = (J = 0.02) => ({ A: [[-R / L, -Kt / L, 0], [Kt / J, -b / J, 0], [0, 1, 0]], B: [[1 / L], [0], [0]] });
const mv = (M, x) => M.map((row) => row.reduce((s, a, j) => s + a * x[j], 0));

function project(variant, edit) {
  const p = normalizeProject(applySystem(DEFAULT_PROJECT, entry, ['input', 'plant', 'controller']));
  p.scope.timebase = autoTimebase(p);
  ctrlOf(p).variant = variant;
  edit?.(p);
  return p;
}
const ctrlOf = (p) => p.system.plant.diagram.blocks.find((x) => x.id === 'ctrl');
const rotorOf = (p) => p.system.plant.diagram.blocks.find((x) => x.id === 'motor').diagram.blocks.find((x) => x.id === 'rotor');
// One run, and what the notes quote for the step of r at 0.2 s (0 → 1 rad):
// the peak, the time to within 2 % and to within tol for good, V's range.
function run(p, tol = 1e-6) {
  const res = evaluateSystem(p, { designs: createDesignStore() });
  const { t, signals: s } = res;
  const ks = Array.from(t).flatMap((x, k) => (x >= 0.2 && x < 1.5 ? [k] : []));
  const after = (eps) => { let last = 0.2; for (const k of ks) if (Math.abs(s.angle[k] - 1) > eps) last = t[k] + 0.001; return last - 0.2; };
  return {
    res, design: res.info.designs[0],
    peak: Math.max(...ks.map((k) => s.angle[k])), settle: after(0.02), exact: after(tol),
    Vmax: Math.max(...ks.map((k) => s.V[k])), Vmin: Math.min(...ks.map((k) => s.V[k])),
  };
}
const runs = [0, 1, 2, 3].map((v) => run(project(v)));
const [slow, fast, clipped, lqr] = runs;

test('deadbeat example: four variants that load and run whole, at the 1 ms record', () => {
  const c = entry.plant.diagram.blocks.find((x) => x.type === 'controller');
  assert.deepEqual(c.variants.map((v) => [v.type, v.params.every]), [['deadbeat', 10], ['deadbeat', 1], ['deadbeat', 1], ['lqr', undefined]]);
  assert.deepEqual([c.params.inputs, c.params.Ts, entry.sim.sampleTime], [4, 0.01, 0.001]);
  for (const r of runs) {
    assert.equal(r.design.status, 'ok', r.design.error?.message);
    assert.equal(r.design.seen, 'V → angle, speed (Motor), current (Motor) · 3 states (armature 1/(Ls + R), rotor 1/(Js + b), angle)');
    assert.equal(r.res.t.length, 5001);
    for (const [name, v] of Object.entries(r.res.signals)) assert.ok(v.every(Number.isFinite), `${name} finite`);
  }
});

test('deadbeat: the gains match Ackermann done by hand, and the loop on the linear plant is at rest at r after n samples, to rounding', () => {
  for (const [r, Td] of [[slow, 0.1], [fast, 0.01]]) {
    const { K, kr } = r.design.values;
    const { Ad, Bd } = c2d(motor().A, motor().B, Td);
    // Independently: the n inputs that take the plant from rest to the rest
    // at 1 rad (current 0, speed 0, angle 1) are unique: Σ Adⁿ⁻¹⁻ᵏ Bd uₖ = x*.
    const cols = [2, 1, 0].map((p) => { let v = Bd.map((x) => x[0]); for (let i = 0; i < p; i++) v = mv(Ad, v); return v; });
    const u = solve(cols[0].map((_, i) => cols.map((c) => c[i])), [0, 0, 1]);
    // The law in the loop, sample by sample, measurements angle, speed, current.
    let x = [0, 0, 0];
    const seq = [];
    for (let k = 0; k < 6; k++) {
      const uk = kr - (K[0] * x[2] + K[1] * x[1] + K[2] * x[0]);
      seq.push(uk);
      x = mv(Ad, x).map((v, i) => v + Bd[i][0] * uk);
      if (k === 2) assert.ok(Math.abs(x[2] - 1) < 1e-12 && Math.abs(x[1]) < 1e-11 && Math.abs(x[0]) < 1e-10, `Td ${Td}: at rest at r after 3 samples: ${x}`);
    }
    u.forEach((v, k) => assert.ok(Math.abs(seq[k] - v) <= 1e-9 * Math.abs(v) + 1e-9, `Td ${Td}: u${k} ${seq[k]}, by hand ${v}`));
    assert.ok(seq.slice(3).every((v) => Math.abs(v) < 1e-9), 'then u = 0, which holds the angle');
    // What the Computed box says.
    const rows = Object.fromEntries(r.design.rows.map((row) => [row.label, row]));
    assert.equal(rows['settles in'].value, Number((3 * Td).toPrecision(12)));
    u.forEach((v, k) => assert.ok(Math.abs(rows['u, unit step'].value[k] - v) <= 1e-9 * Math.abs(v) + 1e-9));
    assert.deepEqual(rows.K.labels, ['angle', 'speed (Motor)', 'current (Motor)']);
    assert.equal(rows.kr.note, 'angle follows r');
    assert.ok(Math.abs(kr - K[0]) < 1e-9 * kr, 'kr = K on the angle: the angle follows r');
  }
  // The notes' numbers: 8, −1, 0 V at 100 ms; 655, −815, 229 V at 10 ms.
  assert.deepEqual(slow.design.rows[3].value.map((v) => Number(v.toFixed(2))), [8, -1, 0]);
  assert.deepEqual(fast.design.rows[3].value.map(Math.round), [655, -815, 229]);
  assert.ok(Math.abs(slow.design.rows[4].value - 1.5) < 0.01, 'the largest step inside ±12 V: 1.5 rad');
  assert.ok(Math.abs(clipped.design.rows[4].value - 0.0147) < 1e-4, 'at 10 ms: 15 mrad');
  assert.equal(fast.design.rows.length, 4, 'no limits: no largest step');
});

test('deadbeat example: what the notes say, on the simulated motor', () => {
  // 100 ms: at r 0.3 s after the step, and still there between the samples
  // (every 1 ms record), with 8 V at most.
  assert.ok(slow.exact <= 0.3 + 1e-9, `100 ms: within 1e-6 rad from ${slow.exact} s`);
  assert.ok(slow.peak < 1 + 1e-6 && slow.Vmax <= 8.01 && slow.Vmin >= -1.01, `100 ms: ${slow.peak}, ${slow.Vmax}, ${slow.Vmin}`);
  // 10 ms, no limit: 30 ms, with +655 and −815 V.
  assert.ok(fast.exact <= 0.03 + 1e-9, `10 ms: ${fast.exact}`);
  assert.ok(Math.abs(fast.Vmax - 655.4) < 0.1 && Math.abs(fast.Vmin + 814.8) < 0.1, `${fast.Vmax}, ${fast.Vmin}`);
  // The same gains clipped to ±12 V: 17 % overshoot, about 0.23 s.
  assert.ok(clipped.peak > 1.16 && clipped.peak < 1.18, `clipped: peak ${clipped.peak}`);
  assert.ok(clipped.settle > 0.2 && clipped.settle < 0.25, `clipped: ${clipped.settle} s to 2 %`);
  assert.deepEqual([clipped.Vmax, clipped.Vmin], [12, -12]);
  // LQR: within 2 % after 0.5 s, never exactly (still 1e-6 off a second later), 9 V.
  assert.ok(lqr.settle > 0.48 && lqr.settle < 0.53, `LQR: ${lqr.settle}`);
  assert.ok(lqr.exact > 1, `LQR is not exact: ${lqr.exact}`);
  assert.ok(lqr.peak < 1.001 && Math.abs(lqr.Vmax - 9.1) < 0.05, `LQR: ${lqr.peak}, ${lqr.Vmax}`);
});

test('deadbeat example: a 20 % heavier rotor; the design follows, the copied gains do not, and LQR barely minds', () => {
  const heavy = (p) => { rotorOf(p).params.den = [0.024, 0.1]; };
  // Designed: computed again from the heavier motor, exact again.
  const again = run(project(0, heavy));
  assert.ok(again.exact <= 0.3 + 1e-9 && again.peak < 1 + 1e-6, `redesigned: ${again.exact}`);
  // Copy as numbers on the nominal motor, then the heavier one.
  const copied = (v) => run(project(0, (p) => {
    const c = ctrlOf(p), twin = CONTROLLERS[c.variants[v].type].manual(c.variants[v].params, runs[v].design.values);
    c.variants = [normalizeVariant({ name: 'copy', ...twin })];
    c.variant = 0;
    heavy(p);
  }), 1e-3);
  const db = copied(0), lq = copied(3);
  assert.ok(db.peak > 1.05 && db.peak < 1.065, `deadbeat's gains overshoot 6 %: ${db.peak}`);
  assert.ok(db.exact > 0.6, `and need over 0.6 s to come within 1 mrad: ${db.exact}`);
  assert.ok(lq.peak < 1.001 && lq.settle < 0.5, `LQR's gains: ${lq.peak}, ${lq.settle}`);
});

test('deadbeat: Copy as numbers is state feedback updated every k samples, and runs bit for bit', () => {
  const v = entry.plant.diagram.blocks.find((x) => x.id === 'ctrl').variants[0];
  const twin = CONTROLLERS.deadbeat.manual(normalizeVariant(v).params, slow.design.values);
  assert.equal(twin.type, 'stateFeedback');
  assert.equal(twin.params.every, 10);
  const copy = run(project(0, (p) => { ctrlOf(p).variants = [normalizeVariant({ name: 'copy', ...twin })]; }));
  for (const [name, sig] of Object.entries(slow.res.signals)) assert.deepEqual(copy.res.signals[name], sig, name);
  // The held law: u changes only at every 10th sample; the prefilter still runs every sample.
  const law = makeLaw(normalizeVariant({ type: 'stateFeedback', params: { K: [1], kr: 2, every: 3 } }), 0.01);
  assert.deepEqual([[1, 0], [1, 0.5], [1, 0.5], [1, 0.5], [1, 1], [1, 1], [1, 1]].map((x) => law.step(x)), [2, 2, 2, 1.5, 1.5, 1.5, 1]);
  assert.throws(() => normalizeVariant({ type: 'deadbeat', params: { K: [1] } }), /deadbeat computes K and kr from the plant and every and track; to set them by hand use Copy as numbers \(a State feedback variant\)/);
  assert.throws(() => normalizeVariant({ type: 'deadbeat', params: { every: 0 } }), /every: at least 1/);
});

test('deadbeat: the Analysis tab sees the loop at k·Ts, every closed-loop pole at the origin', () => {
  for (const [v, Ts] of [[0, 0.1], [1, 0.01]]) {
    const p = project(v);
    const m = loopModel(p, 'ctrl', 'origin', { designs: createDesignStore() });
    assert.equal(m.Ts, Ts);
    if (v === 0) assert.ok(m.warnings.some((w) => /updates every 10 samples/.test(w)), m.warnings.join('; '));
    const a = analyzeLoop(m.plant, m.ctrl, m.Ts);
    assert.ok(a.stable);
    // A nilpotent loop's eigenvalues come out near ε^(1/n), not 0.
    assert.ok(a.clPoles.every((q) => Math.hypot(q.z.re, q.z.im) < 1e-4), a.clPoles.map((q) => q.z.re).join(', '));
    // What the notes quote: deadbeat's margins, shrinking with the sample time.
    const [gm, ms] = v === 0 ? [1.8, 2.25] : [1.24, 5.19];
    assert.ok(Math.abs(a.margins.ms - ms) < 0.01 && Math.abs(a.margins.gmUp - gm) < 0.01, `${a.margins.ms}, ${a.margins.gmUp}`);
    const st = stepResponse(m.plant, m.ctrl, m.Ts, 6);
    assert.ok(st.y.slice(3).every((y) => Math.abs(y - 1) < 1e-9), `${st.y}`);
  }
});

test('deadbeat example: LQR, for contrast, has the margins deadbeat gives away', () => {
  const m = loopModel(project(3), 'ctrl', 'origin', { designs: createDesignStore() });
  const g = analyzeLoop(m.plant, m.ctrl, m.Ts).margins;
  assert.ok(Math.abs(g.pm - 96.8) < 0.1 && Math.abs(g.ms - 1.10) < 0.01, `${g.pm}, ${g.ms}`);
});

test('deadbeat: the structure diagram is state feedback with its numbers, the hold and the settling', () => {
  const v = normalizeVariant(entry.plant.diagram.blocks.find((x) => x.id === 'ctrl').variants[0]);
  const d = describeVariant(v, { inputs: ['r', 'angle', 'speed', 'current'], Ts: 0.01, values: slow.design.values });
  const notes = d.nodes.filter((n) => n.kind === 'note').map((n) => n.text);
  assert.equal(d.title, 'Deadbeat');
  assert.ok(notes.includes('u held: updated every 10 samples, 0.1 s'), notes.join(' | '));
  assert.ok(notes.includes('K, kr: poles at z = 0, settles in 3 × 0.1 s'), notes.join(' | '));
});

// A small plant for the refusals: r and a Controller with one deadbeat.
const lag = (id, x, delay = 0) => ({ id, type: 'tf', name: id, params: { num: [1], den: [1, 1], delay }, x, y: 100 });
function refusal(blocks, wires, inputs) {
  const d = {
    blocks: [{ id: 'r', type: 'source', params: { signal: 'r' }, x: 0, y: 0 }, { id: 'ctrl', type: 'controller', params: { inputs, Ts: 0.1 }, variants: [normalizeVariant({ name: 'DB', type: 'deadbeat' })], variant: 0, x: 100, y: 0 }, ...blocks],
    wires: [{ from: 'r', to: 'ctrl' }, ...wires],
  };
  return compileDiagram(d, 'plant', { standalone: true, designs: createDesignStore() }).designs[0].error;
}

test('deadbeat refuses, in sentences, what it cannot do', () => {
  // Two identical lags driven alike: each measured, but u cannot steer them apart.
  const twins = refusal([lag('a', 200), lag('b', 300)], [{ from: 'ctrl', to: 'a' }, { from: 'ctrl', to: 'b' }, { from: 'a', to: 'ctrl:1' }, { from: 'b', to: 'ctrl:2' }], 3);
  assert.equal(twins.code, 'not-controllable');
  assert.match(twins.message, /^u cannot steer every state of the plant this block sees \(a, b\) on its own: .* so no K places all 2 poles at z = 0$/);
  // A dead time: its delayed inputs are states the law does not see.
  const dead = refusal([lag('a', 200, 0.05)], [{ from: 'ctrl', to: 'a' }, { from: 'a', to: 'ctrl:1' }], 2);
  assert.equal(dead.code, 'dead-time');
  assert.match(dead.message, /the dead time \(0\.05 s on a\) holds inputs this law does not see/);
  // The position-control motor measures its angle only.
  const p = normalizeProject(applySystem(DEFAULT_PROJECT, SYSTEM_LIBRARY.find((s) => s.name === 'DC motor, position control'), ['input', 'plant']));
  ctrlOf(p).variants = [normalizeVariant({ name: 'DB', type: 'deadbeat' })];
  const st = compileDiagram(p.system.plant.diagram, 'plant', { standalone: true, designs: createDesignStore() }).designs[0];
  assert.equal(st.error.code, 'states-not-measured');
  assert.match(st.error.message, /^deadbeat state feedback needs every state measured\. This block sees rotor angle but not Motor\/armature 1\/\(L·s \+ R\) and Motor\/rotor 1\/Jm\.$/);
  // One lag, nothing refused: K = Ad/Bd puts its one pole at 0.
  const one = { blocks: [{ id: 'r', type: 'source', params: { signal: 'r' }, x: 0, y: 0 }, { id: 'ctrl', type: 'controller', params: { inputs: 2, Ts: 0.1 }, variants: [normalizeVariant({ type: 'deadbeat' })], variant: 0, x: 100, y: 0 }, lag('a', 200)], wires: [{ from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'a' }, { from: 'a', to: 'ctrl:1' }] };
  const ok = compileDiagram(one, 'plant', { standalone: true, designs: createDesignStore() }).designs[0];
  const a = Math.exp(-0.1);
  assert.ok(Math.abs(ok.values.K[0] - a / (1 - a)) < 1e-9 && Math.abs(ok.values.kr - 1 / (1 - a)) < 1e-9, JSON.stringify(ok.values));
});
