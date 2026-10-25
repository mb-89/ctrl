// The robot blocks (robotblocks.js): each against direct calls of the
// rigid-body code it wraps, on random states; then through the vector pass,
// the compiler and the simulator, and the sentences a wrong width gets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROBOT_BLOCKS } from '../src/core/robotblocks.js';
import { mimoContext } from '../src/core/vectors.js';
import { parseUrdf, rpyMatrix } from '../src/core/urdf.js';
import { createRbd, dampedInverse, orientationError } from '../src/core/rbd.js';
import { normalizeDiagram, compileDiagram } from '../src/core/diagram.js';
import { simulateSystem } from '../src/core/sim.js';
import { PUMA560 } from '../src/core/puma560.js';

const DEG = Math.PI / 180;
const ROBOTS = { puma560: { urdf: PUMA560.urdf } };
const MODEL = parseUrdf(PUMA560.urdf);
const N = MODEL.n;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const maxDiff = (a, b) => { assert.equal(a.length, b.length); let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const randomQ = (r) => MODEL.joints.map((j) => j.lower + (j.upper - j.lower) * r());
const randomV = (r, n, s = 2) => Array.from({ length: n }, () => s * (2 * r() - 1));

// A block as the compiler builds it: normalized params, widths, make.
function block(type, params = {}, { inW, report, model = false } = {}) {
  const def = ROBOT_BLOCKS[type];
  const p = def.normalize(params, type);
  const ctx = mimoContext(ROBOTS, { model, report });
  const env = { name: `'${def.label}'`, robot: ctx.robot };
  const w = def.widths(p, inW ?? new Array(def.ports(p)[0]).fill(undefined), env);
  const fn = def.make(p, { ...ctx, inW: w.ins, outW: w.outs, name: def.label });
  const nIn = w.ins.reduce((s, x) => s + x, 0), nOut = w.outs.reduce((s, x) => s + x, 0);
  const u = new Float64Array(nIn), y = new Float64Array(nOut);
  return { p, w, run(parts, t = 0) { u.set(parts.flat()); fn(u, y, t); return y; } };
}

test('robot blocks: every def has its ports, its group names and defaults that normalize', () => {
  for (const [key, def] of Object.entries(ROBOT_BLOCKS)) {
    assert.equal(def.group, 'Robot', key);
    const p = def.normalize({}, key);
    for (const s of def.params) assert.ok(s.key in p, `${key}.${s.key}`);
    const [i, o] = def.ports(p);
    assert.equal(def.inputs(p).length, i, key);
    assert.equal(def.outputs(p).length, o, key);
  }
  assert.throws(() => ROBOT_BLOCKS.jacobian.normalize({ expressedIn: 'tool' }, 'b'), /b\.expressedIn: base or frame/);
  assert.throws(() => ROBOT_BLOCKS.massMatrix.normalize({ armature: [-1] }, 'b'), /b\.armature: a number or a list/);
  assert.throws(() => ROBOT_BLOCKS.frameTransform.normalize({ groups: 'p,x' }, 'b'), /b\.groups: one to eight/);
  assert.throws(() => ROBOT_BLOCKS.jointLimits.normalize({ check: 'effort' }, 'b'), /b\.check:/);
  assert.throws(() => ROBOT_BLOCKS.dampedInverse.normalize({ lambdaMax: 0 }, 'b'), /b\.lambdaMax:/);
  assert.deepEqual(ROBOT_BLOCKS.massMatrix.normalize({ armature: '[1, 2, 3, 4, 5, 6]' }, 'b').armature, [1, 2, 3, 4, 5, 6]);
});

test('robot blocks: kinematics equal rbd.js on random states (frame, expressedIn)', () => {
  const r = rng(1), rbd = createRbd(MODEL);
  const fk = block('forwardKinematics'), fk3 = block('forwardKinematics', { frame: 'link3' }), fkb = block('forwardKinematics', { frame: 'base' });
  const J0 = block('jacobian'), Jn = block('jacobian', { expressedIn: 'frame' }), J4 = block('jacobian', { frame: 'link4' });
  const jd = block('jdotqd'), jd5 = block('jdotqd', { frame: 'link5' });
  for (let k = 0; k < 50; k++) {
    const q = randomQ(r), qd = randomV(r, N);
    for (const [b, link] of [[fk, 'flange'], [fk3, 'link3'], [fkb, 'base']]) {
      const y = b.run([q]), pose = rbd.linkPose(q, link);
      assert.ok(maxDiff(y.slice(0, 3), pose.p) <= 1e-12 && maxDiff(y.slice(3), pose.R) <= 1e-12, link);
    }
    assert.ok(maxDiff(J0.run([q]), rbd.jacobian(q, 'flange')) <= 1e-12);
    assert.ok(maxDiff(Jn.run([q]), rbd.jacobian(q, 'flange', undefined, 'frame')) <= 1e-12);
    assert.ok(maxDiff(J4.run([q]), rbd.jacobian(q, 'link4')) <= 1e-12);
    assert.ok(maxDiff(jd.run([q, qd]), rbd.jdotqd(q, qd, 'flange')) <= 1e-12);
    assert.ok(maxDiff(jd5.run([q, qd]), rbd.jdotqd(q, qd, 'link5')) <= 1e-12);
  }
});

test('robot blocks: dynamics equal rbd.js (armature, scale); the torque split adds up to inverse dynamics', () => {
  const r = rng(2), arm = PUMA560.armature;
  const ref = createRbd(MODEL, { armature: arm, scale: 0.8 }), plain = createRbd(MODEL, { scale: 0.8 });
  const M = block('massMatrix', { armature: arm, scale: 0.8 }), M0 = block('massMatrix');
  const h = block('biasForces', { scale: 0.8 }), id = block('inverseDynamics', { armature: arm, scale: 0.8 });
  const split = block('torqueSplit', { armature: arm, scale: 0.8 });
  const unit = createRbd(MODEL);
  for (let k = 0; k < 50; k++) {
    const q = randomQ(r), qd = randomV(r, N), qdd = randomV(r, N, 5);
    assert.ok(maxDiff(M.run([q]), ref.massMatrix(q)) <= 1e-12);
    assert.ok(maxDiff(M0.run([q]), unit.massMatrix(q)) <= 1e-12);
    assert.ok(maxDiff(h.run([q, qd]), plain.bias(q, qd)) <= 1e-12);
    const tau = Float64Array.from(id.run([q, qd, qdd]));
    assert.ok(maxDiff(tau, ref.rnea(q, qd, qdd)) <= 1e-12);
    const y = split.run([q, qd, qdd]), s = ref.torqueSplit(q, qd, qdd);
    assert.ok(maxDiff(y.slice(0, N), s.inertial) <= 1e-12 && maxDiff(y.slice(N, 2 * N), s.coriolis) <= 1e-12 && maxDiff(y.slice(2 * N), s.gravity) <= 1e-12);
    assert.ok(maxDiff(Array.from({ length: N }, (_, i) => y[i] + y[N + i] + y[2 * N + i]), tau) <= 1e-12);
  }
  // Two blocks with the same robot and options share one workspace.
  const ctx = mimoContext(ROBOTS);
  assert.equal(ctx.rbd('puma560', { armature: arm }), ctx.rbd('puma560', { armature: arm }));
});

test('robot blocks: the damped inverse equals rbd.dampedInverse, away from and near singularities', () => {
  const r = rng(3), rbd = createRbd(MODEL);
  const D = block('dampedInverse', {}, { inW: [36] }), D3 = block('dampedInverse', { rows: 3, eps: 0.1 }, { inW: [18] });
  const qs = Array.from({ length: 60 }, () => randomQ(r));
  qs.push(PUMA560.start.map((d) => d * DEG), [0, 0.5, -1, 0.3, 1e-4, 0.2], [0, 0.5, -1, 0.3, 0, 0.2]);   // q5 = 0: the wrist singularity
  let damped = 0;
  for (const q of qs) {
    const J = rbd.jacobian(q, 'flange');
    const y = D.run([Array.from(J)]), ref = dampedInverse(J, 6, 6);
    assert.ok(maxDiff(y.slice(0, 36), ref.Jinv) <= 1e-12, `J⁺ at ${q}`);
    assert.ok(Math.abs(y[36] - ref.sigma) <= 1e-12);
    if (ref.lambda2 > 0) damped++;
    const Jv = J.slice(0, 18), y3 = D3.run([Array.from(Jv)]), ref3 = dampedInverse(Jv, 3, 6, { eps: 0.1 });
    assert.ok(maxDiff(y3.slice(0, 18), ref3.Jinv) <= 1e-12 && Math.abs(y3[18] - ref3.sigma) <= 1e-12);
  }
  assert.ok(damped >= 2, 'the singular poses are damped');
  assert.throws(() => ROBOT_BLOCKS.dampedInverse.widths({ rows: 6 }, [35], { name: "'Damped inverse'" }), /'Damped inverse': J has 35 elements, not a whole number of rows of 6/);
});

test('robot blocks: the orientation error equals rbd.orientationError, also at the tool-down pose', () => {
  const r = rng(4), b = block('orientationError');
  const down = [-1, 0, 0, 0, 1, 0, 0, 0, -1];
  for (let k = 0; k < 200; k++) {
    const Rd = rpyMatrix(...randomV(r, 3, Math.PI));
    const R = k % 2 ? rpyMatrix(...randomV(r, 3, Math.PI)) : (() => { const E = rpyMatrix(...randomV(r, 3, 2 * DEG)); return [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => E[3 * i] * down[j] + E[3 * i + 1] * down[3 + j] + E[3 * i + 2] * down[6 + j])); })();
    const Rd2 = k % 2 ? Rd : down;
    const y = b.run([Rd2, R]), ref = orientationError(Rd2, R);
    assert.ok(maxDiff(y.slice(0, 3), ref.e) <= 1e-12 && Math.abs(y[3] - ref.theta) <= 1e-12);
  }
  const y = b.run([down, down]);
  assert.deepEqual(Array.from(y), [0, 0, 0, 0]);
});

test('robot blocks: a frame transform and its inverse; points move by o, directions do not', () => {
  const r = rng(5), rpy = randomV(r, 3, Math.PI), R = rpyMatrix(...rpy);
  const fwd = block('frameTransform', { rpy, groups: 'p,v,a' }), inv = block('frameTransform', { rpy, groups: 'p,v,a', inverse: 1 });
  const x = [randomV(r, 3), randomV(r, 3), randomV(r, 3)], o = randomV(r, 3);
  const y = Array.from(fwd.run([...x, o]));
  const Rx = (v) => [0, 1, 2].map((i) => R[3 * i] * v[0] + R[3 * i + 1] * v[1] + R[3 * i + 2] * v[2]);
  assert.ok(maxDiff(y.slice(0, 3), Rx(x[0]).map((v, i) => v + o[i])) <= 1e-15);
  assert.ok(maxDiff(y.slice(3, 6), Rx(x[1])) <= 1e-15 && maxDiff(y.slice(6), Rx(x[2])) <= 1e-15);
  const back = inv.run([y.slice(0, 3), y.slice(3, 6), y.slice(6), o]);
  assert.ok(maxDiff(back, x.flat()) <= 1e-14);
  assert.equal(ROBOT_BLOCKS.frameTransform.summary(inv.p), 'x = Rᵀ(x_base − o)');
  assert.deepEqual(fwd.w, { ins: [3, 3, 3, 3], outs: [3, 3, 3] });
});

test('robot blocks: joint limits report each joint and kind once, with the time; a model checks nothing', () => {
  const texts = [], b = block('jointLimits', {}, { report: (s) => texts.push(s) });
  const q = PUMA560.start.map((d) => d * DEG), qd = new Array(N).fill(0);
  b.run([q, qd], 0);
  assert.deepEqual(texts, []);
  const q2 = [...q]; q2[2] = -226 * DEG;
  const qd2 = [...qd]; qd2[1] = -1.6;
  b.run([q2, qd2], 2.31);
  b.run([q2, qd2], 2.5);
  assert.deepEqual(texts, ['j2 is faster than its limit (1.51 rad/s) at 2.31 s', 'j3 left its range (−225 … 45°) at 2.31 s: the real arm stops there']);
  const quiet = [], m = block('jointLimits', {}, { report: (s) => quiet.push(s), model: true });
  m.run([q2, qd2], 1);
  assert.deepEqual(quiet, []);
  const pos = [], only = block('jointLimits', { check: 'position' }, { report: (s) => pos.push(s) });
  only.run([q2, qd2], 0.8);
  assert.equal(pos.length, 1);
});

// ---- Through the pass, the compiler and the simulator

const diagram = (blocks, wires, robots = ROBOTS) => normalizeDiagram({ robots, blocks, wires });
const last = (out) => Object.fromEntries(Object.entries(out.signals).map(([k, v]) => [k, v.at(-1)]));

test('robot blocks in a diagram: Constant q → Forward kinematics → Sinks x, y, z and R1…R9', () => {
  const q = [0.3, 0.9, -2.4, 0.2, -1.1, 0.5];
  const d = diagram([
    { id: 'c', type: 'constant', params: { value: q } },
    { id: 'fk', type: 'forwardKinematics', name: 'Tool pose' },
    { id: 'p', type: 'sink', params: { name: 'x,y,z', unit: 'm' } },
    { id: 'R', type: 'sink', params: { name: 'R' } },
  ], [{ from: 'c', to: 'fk' }, { from: 'fk', to: 'p' }, { from: 'fk:1', to: 'R' }]);
  const out = last(simulateSystem(d, {}, { duration: 0.02, sampleTime: 0.01 }));
  const pose = createRbd(MODEL).linkPose(q, 'flange');
  assert.ok(maxDiff([out.x, out.y, out.z], pose.p) <= 1e-12);
  assert.ok(maxDiff(Array.from({ length: 9 }, (_, i) => out[`R${i + 1}`]), pose.R) <= 1e-12);
});

test('robot blocks in a diagram: inverse dynamics and the torque split from Constants', () => {
  const r = rng(6), q = randomQ(r), qd = randomV(r, N), qdd = randomV(r, N, 4);
  const names = (s) => Array.from({ length: N }, (_, i) => `${s}${i + 1}`).join(',');
  const d = diagram([
    { id: 'q', type: 'constant', params: { value: q } }, { id: 'qd', type: 'constant', params: { value: qd } }, { id: 'qdd', type: 'constant', params: { value: qdd } },
    { id: 'id', type: 'inverseDynamics', params: { armature: PUMA560.armature } },
    { id: 'ts', type: 'torqueSplit', params: { armature: PUMA560.armature } },
    { id: 'tau', type: 'sink', params: { name: names('tau') } },
    { id: 'gr', type: 'sink', params: { name: names('g') } },
  ], [
    { from: 'q', to: 'id' }, { from: 'qd', to: 'id:1' }, { from: 'qdd', to: 'id:2' },
    { from: 'q', to: 'ts' }, { from: 'qd', to: 'ts:1' }, { from: 'qdd', to: 'ts:2' },
    { from: 'id', to: 'tau' }, { from: 'ts:2', to: 'gr' },
  ]);
  const out = last(simulateSystem(d, {}, { duration: 0.01, sampleTime: 0.01 }));
  const ref = createRbd(MODEL, { armature: PUMA560.armature });
  assert.ok(maxDiff(Array.from({ length: N }, (_, i) => out[`tau${i + 1}`]), ref.rnea(q, qd, qdd)) <= 1e-12);
  assert.ok(maxDiff(Array.from({ length: N }, (_, i) => out[`g${i + 1}`]), ref.gravityTorque(q)) <= 1e-12);
});

test('robot blocks in a diagram: an Integrator from the start pose runs j3 out of its range, reported once', () => {
  const q0 = PUMA560.start.map((d) => d * DEG);
  const d = diagram([
    { id: 'w', type: 'constant', params: { value: [0, 0, -1, 0, 0, 0] } },
    { id: 'q', type: 'integrator', params: { K: 1, x0: q0 } },
    { id: 'lim', type: 'jointLimits' },
    { id: 'fk', type: 'forwardKinematics' },
    { id: 'p', type: 'sink', params: { name: 'x,y,z' } },
  ], [{ from: 'w', to: 'q' }, { from: 'q', to: 'lim' }, { from: 'w', to: 'lim:1' }, { from: 'q', to: 'fk' }, { from: 'fk', to: 'p' }]);
  const el = compileDiagram(d, 'plant', { standalone: true });
  const X = new Float64Array(el.n), dX = new Float64Array(el.n), h = 1e-3;
  el.setStep(h);
  el.init(X, 0);
  // As simulateSystem: the RK4 stages evaluate what the rates need; a block
  // read by nothing (Joint limits) runs when a step is done (eval without dX).
  for (let k = 0; k <= 1500; k++) { el.eval(k * h, X, 0, 0, null); el.eval(k * h, X, 0, 0, dX); for (let i = 0; i < el.n; i++) X[i] += h * dX[i]; }
  // q3 starts at −150° and leaves at −225° after 75° at 1 rad/s.
  assert.deepEqual(el.validity, [`j3 left its range (−225 … 45°) at ${(75 * DEG + 1e-3).toFixed(2)} s: the real arm stops there`]);
  const pose = createRbd(MODEL).linkPose(q0, 'flange');
  const out = last(simulateSystem(d, {}, { duration: 0.01, sampleTime: 0.01 }));
  assert.ok(Math.abs(out.x - createRbd(MODEL).linkPose(q0.map((v, i) => (i === 2 ? v - 0.01 : v)), 'flange').p[0]) <= 1e-9);
  assert.ok(Math.abs(out.y - pose.p[1]) <= 1e-9);
});

test('robot blocks in a diagram: a missing robot, a wrong width and an unknown link are refused with a sentence', () => {
  const run = (d) => simulateSystem(d, {}, { duration: 0.01, sampleTime: 0.01 });
  const q = PUMA560.start.map((x) => x * DEG);
  const two = (fk, value = q, robots = ROBOTS) => diagram([{ id: 'c', type: 'constant', params: { value } }, { id: 'fk', type: 'forwardKinematics', name: 'Tool pose', params: fk }, { id: 's', type: 'sink', params: { name: 'x,y,z' } }], [{ from: 'c', to: 'fk' }, { from: 'fk', to: 's' }], robots);
  assert.throws(() => run(two({ robot: 'ur5' })), /'Tool pose': no robot "ur5" in the diagram's robots \(it has puma560\)/);
  assert.throws(() => run(two({}, q, null)), /'Tool pose': no robot "puma560" in the diagram's robots/);
  assert.throws(() => run(two({}, q.slice(0, 5))), /'Tool pose': q has 5 elements; puma560 has 6 joints/);
  assert.throws(() => run(two({ frame: 'hand' })), /'Tool pose': puma560 has no link "hand"/);
  const mm = diagram([{ id: 'c', type: 'constant', params: { value: q } }, { id: 'M', type: 'massMatrix', params: { armature: [1, 2, 3] } }, { id: 's', type: 'sink', params: { name: 'M' } }], [{ from: 'c', to: 'M' }, { from: 'M', to: 's' }]);
  assert.throws(() => run(mm), /'M': armature has 3 values; puma560 has 6 joints/);
});
