// The robot core: the XML reader, the URDF model and the rigid-body code,
// held to a reference implementation, to conservation laws and to
// independent computations ("the physics can't be wrong"). The reference
// values in fixtures/puma560-toolbox.json were computed by running Robotics
// Toolbox for Python 1.5.0 on its own PUMA 560 model (fixtures/puma560-toolbox.py).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseXml } from '../src/core/xml.js';
import { parseUrdf, rpyMatrix, inertiaProblem } from '../src/core/urdf.js';
import { createRbd, jointFriction, dampedInverse, sigmaMin, orientationError } from '../src/core/rbd.js';
import { PUMA560 } from '../src/core/puma560.js';

const FIX = JSON.parse(readFileSync(new URL('./fixtures/puma560-toolbox.json', import.meta.url), 'utf8'));
const DEG = Math.PI / 180;

// A seeded generator, so a failure can be repeated.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const flat = (A) => A.flat();

// ---- A standard Denavit–Hartenberg model, written independently of the URDF
// code: the toolbox's PUMA and the published inertias in the DH frames.
const DH = [
  { a: 0, alpha: Math.PI / 2, d: 0 }, { a: 0.4318, alpha: 0, d: 0 }, { a: 0.0203, alpha: -Math.PI / 2, d: 0.15005 },
  { a: 0, alpha: Math.PI / 2, d: 0.4318 }, { a: 0, alpha: -Math.PI / 2, d: 0 }, { a: 0, alpha: 0, d: 0 },
];
const PEDESTAL = 0.67183;
const TOOLBOX_LINKS = [
  { m: 0, r: [0, 0, 0], I: [0, 0.35, 0] }, { m: 17.4, r: [-0.3638, 0.006, 0.2275], I: [0.13, 0.524, 0.539] },
  { m: 4.8, r: [-0.0203, -0.0141, 0.070], I: [0.066, 0.086, 0.0125] }, { m: 0.82, r: [0, 0.019, 0], I: [1.8e-3, 1.3e-3, 1.8e-3] },
  { m: 0.34, r: [0, 0, 0], I: [0.3e-3, 0.4e-3, 0.3e-3] }, { m: 0.09, r: [0, 0, 0.032], I: [0.15e-3, 0.15e-3, 0.04e-3] },
];
// The published set with its two corrections (link 3's and link 4's centres of mass), unregrouped.
const PUBLISHED_LINKS = TOOLBOX_LINKS.map((l, i) => (i === 2 ? { ...l, r: [-0.0203, -0.014, 0.070] } : i === 3 ? { ...l, r: [0, -0.019, 0] } : l));
const TOOLBOX_G = [-62.6111, 107.815, -53.7063, 76.0364, 71.923, 76.686];
const TOOLBOX_JM = [200e-6, 200e-6, 200e-6, 33e-6, 33e-6, 33e-6];

// URDF from a DH table: joint i at Tx(a_{i−1})·Rx(α_{i−1})·Tz(d_i); a link's
// centre of mass and inertia move from DH frame i into the URDF frame by
// Tx(a_i)·Rx(α_i).
function dhUrdf(links, { flange = 0 } = {}) {
  const Rx = (al) => [1, 0, 0, 0, Math.cos(al), -Math.sin(al), 0, Math.sin(al), Math.cos(al)];
  const mv = (R, v) => [0, 1, 2].map((i) => R[3 * i] * v[0] + R[3 * i + 1] * v[1] + R[3 * i + 2] * v[2]);
  const n = (v) => String(v);
  let s = '<robot name="dh"><link name="base"/>';
  DH.forEach((row, i) => {
    const prev = i ? DH[i - 1] : { a: 0, alpha: 0 };
    const d = row.d + (i === 0 ? PEDESTAL : 0);
    s += `<joint name="j${i + 1}" type="revolute"><parent link="${i ? `link${i}` : 'base'}"/><child link="link${i + 1}"/>`;
    s += `<origin xyz="${n(prev.a)} ${n(-d * Math.sin(prev.alpha))} ${n(d * Math.cos(prev.alpha))}" rpy="${n(prev.alpha)} 0 0"/><axis xyz="0 0 1"/><limit lower="-7" upper="7" effort="1" velocity="1"/></joint>`;
    const L = links[i], R = Rx(row.alpha);
    const c = mv(R, L.r).map((v, k) => v + (k === 0 ? row.a : 0));
    const I = [0, 1, 2].flatMap((r) => [0, 1, 2].map((k) => R[3 * r] * L.I[0] * R[3 * k] + R[3 * r + 1] * L.I[1] * R[3 * k + 1] + R[3 * r + 2] * L.I[2] * R[3 * k + 2]));
    s += `<link name="link${i + 1}"><inertial><origin xyz="${c.map(n).join(' ')}"/><mass value="${L.m}"/><inertia ixx="${I[0]}" ixy="${I[1]}" ixz="${I[2]}" iyy="${I[4]}" iyz="${I[5]}" izz="${I[8]}"/></inertial></link>`;
  });
  if (flange) s += `<joint name="flange" type="fixed"><parent link="link6"/><child link="flange"/><origin xyz="0 0 ${flange}"/></joint><link name="flange"/>`;
  return `${s}</robot>`;
}
const armatureOf = (G, Jm) => G.map((g, i) => g * g * Jm[i]);

const puma = () => createRbd(parseUrdf(PUMA560.urdf), { armature: PUMA560.armature });
const randomQ = (r, lim = parseUrdf(PUMA560.urdf).joints) => lim.map((j) => j.lower + (j.upper - j.lower) * r());

// ---- XML

test('xml: elements, attributes, entities, comments, CDATA, the prolog; malformed documents are refused with their line', () => {
  const d = parseXml('<?xml version="1.0"?>\n<!-- c --><a x="1" y=\'&lt;2&gt;\'><b/><c>t &amp; u<![CDATA[<raw>]]></c></a>');
  assert.equal(d.name, 'a');
  assert.deepEqual(d.attrs, { x: '1', y: '<2>' });
  assert.equal(d.children.length, 2);
  assert.equal(d.children[1].text, 't & u<raw>');
  assert.throws(() => parseXml('<a>\n<b></a>'), /line 2: <\/a> closes <b>/);
  assert.throws(() => parseXml('<a><b>'), /<b> is not closed/);
  assert.throws(() => parseXml('<a x="1" x="2"/>'), /two "x" attributes/);
  assert.throws(() => parseXml('<a/><b/>'), /second root/);
  assert.throws(() => parseXml('<a>&nbsp;</a>'), /unknown entity/);
});

// ---- URDF

test('urdf: rpy is Rz(yaw)·Ry(pitch)·Rx(roll); defaults; fixed joints merge their mass into the body', () => {
  const R = rpyMatrix(0.3, -0.2, 1.1);
  const Rz = (a) => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
  const Ry = (a) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
  const Rx = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
  const mm = (A, B) => [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j]));
  assert.ok(maxDiff(R, mm(mm(Rz(1.1), Ry(-0.2)), Rx(0.3))) < 1e-15);
  const m = parseUrdf(`<robot name="r"><link name="a"/><joint name="j" type="continuous"><parent link="a"/><child link="b"/></joint>
    <link name="b"><inertial><mass value="1"/><inertia ixx="1" iyy="1" izz="1"/></inertial></link>
    <joint name="f" type="fixed"><parent link="b"/><child link="c"/><origin xyz="0 0 2"/></joint>
    <link name="c"><inertial><mass value="3"/><inertia ixx="0" iyy="0" izz="0"/></inertial></link></robot>`);
  assert.equal(m.n, 1);
  assert.deepEqual(m.bodies[0].axis, [1, 0, 0]);
  assert.equal(m.joints[0].lower, -Infinity);
  assert.equal(m.frames.get('c').body, 0);
  const { m: mass, c, I } = m.bodies[0].inertia;
  assert.equal(mass, 4);
  assert.ok(maxDiff(c, [0, 0, 1.5]) < 1e-15);
  // 1 + 1·1.5² + 3·0.5² about x and y, 1 about z.
  assert.ok(maxDiff(I, [4, 0, 0, 0, 4, 0, 0, 0, 1]) < 1e-15);
});

test('urdf: refusals, each with its sentence', () => {
  const wrap = (s) => `<robot name="r"><link name="a"/>${s}</robot>`;
  const link = '<link name="b"><inertial><mass value="1"/><inertia ixx="1" iyy="1" izz="1"/></inertial></link>';
  const joint = (type, extra = '') => `<joint name="j" type="${type}"><parent link="a"/><child link="b"/>${extra}</joint>`;
  const cases = [
    [wrap(joint('floating') + link), /floating: a free-flying base is not modelled/],
    [wrap(joint('planar') + link), /planar/],
    [wrap(joint('prismatic', '<limit lower="0" upper="1" effort="1" velocity="1"/>') + link), /prismatic: sliding joints are not modelled yet/],
    [wrap(joint('revolute') + link), /revolute joint j has no <limit>/],
    [wrap(joint('continuous', '<dynamics damping="0.1"/>') + link), /friction lives in the motors, and counting it twice would be wrong/],
    ['<robot name="r" xmlns:xacro="http://www.ros.org/wiki/xacro"><link name="a"/></robot>', /Xacro/],
    ['<robot name="r"><link name="a"/><link name="b"/></robot>', /2 root links \(a, b\)/],
    [wrap(`${joint('continuous')}<joint name="k" type="continuous"><parent link="b"/><child link="a"/></joint>${link}`), /no root link: the joints form a cycle/],
    [wrap(`${joint('continuous')}<joint name="k" type="continuous"><parent link="a"/><child link="b"/></joint>${link}`), /link b has two parent joints/],
    [wrap(joint('continuous') + '<link name="b"><inertial><mass value="4.8"/><inertia ixx="0.066" iyy="0.0125" izz="0.086"/></inertial></link>'), /link b: moments 0.066, 0.0125, 0.086 break the triangle inequality: no rigid body has them/],
    [wrap(joint('continuous') + '<link name="b"><inertial><mass value="1"/><inertia ixx="1" iyy="1" izz="-0.5"/></inertial></link>'), /not positive semi-definite/],
    [wrap(joint('continuous') + '<link name="b"><inertial><mass value="-1"/></inertial></link>'), /mass -1 kg is below 0/],
    [wrap(joint('continuous', '<axis xyz="0 0 0"/>') + link), /axis has no direction/],
    [wrap(joint('continuous').replace('"b"', '"x"') + link), /child link "x" does not exist/],
  ];
  for (const [text, re] of cases) assert.throws(() => parseUrdf(text), re, String(re));
  // A published, non-physical set loads in a test with a warning.
  const m = parseUrdf(cases[9][0], { inertia: 'warn' });
  assert.match(m.warnings[0], /triangle inequality/);
  // A joint that moves nothing and has no rotor.
  const empty = parseUrdf(wrap(`${joint('continuous')}<link name="b"/>`));
  assert.throws(() => createRbd(empty), /j moves no mass and has no armature/);
  assert.doesNotThrow(() => createRbd(empty, { armature: 0.1 }));
  assert.equal(inertiaProblem(1, [1, 0, 0, 0, 1, 0, 0, 0, 2]), null, 'a thin disc is a rigid body (the equality case)');
});

test('urdf: a mesh is drawn as its collision primitive, or as a box, and the model says so', () => {
  const m = parseUrdf(`<robot name="r"><link name="a"><visual><geometry><mesh filename="package://x/a.stl"/></geometry></visual>
    <collision><origin xyz="0 0 1"/><geometry><cylinder radius="0.1" length="0.5"/></geometry></collision></link>
    <joint name="j" type="fixed"><parent link="a"/><child link="b"/></joint><link name="b"><visual><geometry><mesh filename="b.dae"/></geometry></visual></link></robot>`);
  assert.deepEqual(m.links[0].visuals[0].geom, { type: 'cylinder', radius: 0.1, length: 0.5 });
  assert.deepEqual(m.links[0].visuals[0].origin.p, [0, 0, 1]);
  assert.deepEqual(m.links[1].visuals[0].geom, { type: 'box', size: [0.05, 0.05, 0.05] });
  assert.equal(m.warnings.length, 2);
  assert.match(m.warnings[0], /cannot be loaded by a standalone page; it is drawn as its collision cylinder/);
});

test('urdf: our PUMA 560 is physical, has six revolute joints with the published ranges, efforts and speeds, and no XML comments', () => {
  assert.ok(!PUMA560.urdf.includes('<!--'));
  const m = parseUrdf(PUMA560.urdf);
  assert.deepEqual(m.warnings, []);
  assert.deepEqual(m.joints.map((j) => j.name), ['j1', 'j2', 'j3', 'j4', 'j5', 'j6']);
  const range = [[-160, 160], [-45, 225], [-225, 45], [-110, 170], [-100, 100], [-266, 266]];
  m.joints.forEach((j, i) => {
    assert.ok(Math.abs(j.lower - range[i][0] * DEG) < 1e-15 && Math.abs(j.upper - range[i][1] * DEG) < 1e-15, j.name);
  });
  assert.deepEqual(m.joints.map((j) => j.effort), [56, 97, 52, 10, 10, 10]);
  assert.deepEqual(m.joints.map((j) => j.velocity), [1.92, 1.51, 2.4, 5.34, 5.09, 5.74]);
  assert.equal(m.frames.get('flange').body, 5);
  assert.ok(m.links.every((l) => l.visuals.every((v) => ['box', 'cylinder', 'sphere'].includes(v.geom.type))));
});

// ---- Against the toolbox

test('rbd: M, g, RNEA, the flange pose and the Jacobian agree with the toolbox on 8 states (its own link set)', () => {
  const r = createRbd(parseUrdf(dhUrdf(TOOLBOX_LINKS), { inertia: 'warn' }), { armature: armatureOf(TOOLBOX_G, TOOLBOX_JM) });
  const worst = { M: 0, g: 0, tau: 0, p: 0, R: 0, J: 0 };
  for (const s of FIX.states) {
    worst.M = Math.max(worst.M, maxDiff(r.massMatrix(s.q), flat(s.M)));
    worst.g = Math.max(worst.g, maxDiff(r.gravityTorque(s.q), s.g));
    worst.tau = Math.max(worst.tau, maxDiff(r.rnea(s.q, s.qd, s.qdd), s.tau));
    const { R, p } = r.linkPose(s.q, 'link6');
    worst.p = Math.max(worst.p, maxDiff(p, s.T.slice(0, 3).map((row) => row[3])));
    worst.R = Math.max(worst.R, maxDiff(R, s.T.slice(0, 3).flatMap((row) => row.slice(0, 3))));
    worst.J = Math.max(worst.J, maxDiff(r.jacobian(s.q, 'link6'), flat(s.J)));
  }
  for (const [k, v] of Object.entries(worst)) assert.ok(v < 1e-12, `${k}: ${v}`);
});

test('rbd: joint friction agrees with the toolbox\'s (Coulomb as a step, per direction of the motor)', () => {
  // The toolbox gives the force friction exerts (negative when q̇ > 0) and
  // stores Coulomb values per direction of the joint; with ω_s → 0 the
  // smoothed law is its step.
  const Tc = [[0.395, -0.435], [0.126, -0.071], [0.132, -0.105], [11.2e-3, -16.9e-3], [9.26e-3, -14.5e-3], [3.96e-3, -10.5e-3]];
  const drive = {
    G: TOOLBOX_G, B: [1.48e-3, 0.817e-3, 1.38e-3, 71.2e-6, 82.6e-6, 36.7e-6], ws: 1e-12,
    // A negative G turns the motor against its joint: forward at the motor is reverse at the joint.
    Tcp: Tc.map(([p, m], i) => (TOOLBOX_G[i] > 0 ? p : -m)), Tcn: Tc.map(([p, m], i) => (TOOLBOX_G[i] > 0 ? -m : p)),
  };
  for (const s of FIX.states) assert.ok(maxDiff(jointFriction(s.qd, drive), s.friction.map((f) => -f)) < 1e-13);
  // The data module's friction values are these, with Corke's 0.0709 where the toolbox rounds to 0.071.
  assert.deepEqual(drive.Tcp.map((v) => +v.toPrecision(4)), PUMA560.drive.Tcp);
  assert.deepEqual(drive.Tcn.map((v, i) => (i === 1 ? 0.0709 : +v.toPrecision(4))), PUMA560.drive.Tcn);
  assert.deepEqual(TOOLBOX_G, PUMA560.drive.G);
});

test('rbd: our URDF reproduces the published inertias exactly (the link-3/link-1 regrouping), over 2 000 states; the values at qn', () => {
  const ours = puma();
  const pub = createRbd(parseUrdf(dhUrdf(PUBLISHED_LINKS, { flange: 0.05625 }), { inertia: 'warn' }), { armature: PUMA560.armature });
  const r = rng(2000);
  let dM = 0, dT = 0, dP = 0;
  for (let k = 0; k < 2000; k++) {
    const q = randomQ(r), qd = q.map(() => 4 * r() - 2), qdd = q.map(() => 10 * r() - 5);
    dM = Math.max(dM, maxDiff(ours.massMatrix(q), pub.massMatrix(q)));
    dT = Math.max(dT, maxDiff(ours.rnea(q, qd, qdd), pub.rnea(q, qd, qdd)));
    const a = ours.linkPose(q, 'flange'), b = pub.linkPose(q, 'flange');
    dP = Math.max(dP, maxDiff(a.p, b.p), maxDiff(a.R, b.R));
  }
  assert.ok(dM < 1e-12 && dT < 1e-12 && dP < 1e-14, `M ${dM}, τ ${dT}, pose ${dP}`);
  const qn = [0, Math.PI / 4, -Math.PI, 0, Math.PI / 4, 0];
  const g = ours.gravityTorque(qn), M = ours.massMatrix(qn);
  assert.deepEqual(Array.from(g, (v) => +v.toFixed(4) + 0), [0, 31.4237, 5.819, 0, 0.0283, 0]);
  assert.deepEqual([M[0], M[1], M[7], M[8], M[14]].map((v) => +v.toFixed(4)), [3.6329, -0.4075, 4.3868, 0.324, 0.9109]);
  // At the start pose: the flange, tool down, and the torques that hold the arm.
  const q0 = PUMA560.start.map((v) => v * DEG);
  const { R, p } = ours.linkPose(q0, 'flange');
  assert.deepEqual(p.map((v) => +v.toFixed(4)), [0.7296, -0.15, 0.7264]);
  assert.ok(maxDiff(R, [-1, 0, 0, 0, 1, 0, 0, 0, -1]) < 1e-15);
  assert.deepEqual(Array.from(ours.gravityTorque(q0), (v) => +v.toFixed(2) + 0), [0, 35.71, 7.84, 0, 0, 0]);
});

// ---- Independent checks

// M as Σ JᵢᵀMᵢJᵢ over the bodies' centres of mass, a different algorithm from
// the composite rigid bodies.
function massByJacobians(r, q) {
  const n = r.n, model = r.model;
  r.fk(q);
  const { R: Rw, o, z } = r.poses;
  const M = new Float64Array(n * n);
  model.bodies.forEach((b, i) => {
    const R = Rw.subarray(9 * i, 9 * i + 9), c = [0, 1, 2].map((k) => o[3 * i + k] + R[3 * k] * b.inertia.c[0] + R[3 * k + 1] * b.inertia.c[1] + R[3 * k + 2] * b.inertia.c[2]);
    const Iw = [0, 1, 2].flatMap((a) => [0, 1, 2].map((d) => { let s = 0; for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) s += R[3 * a + x] * b.inertia.I[3 * x + y] * R[3 * d + y]; return s; }));
    const Jv = [], Jw = [];
    for (let j = 0; j < n; j++) {
      let anc = false;
      for (let k = i; k >= 0; k = model.bodies[k].parent) if (k === j) anc = true;
      const zj = anc ? [z[3 * j], z[3 * j + 1], z[3 * j + 2]] : [0, 0, 0];
      const d = [0, 1, 2].map((k) => c[k] - o[3 * j + k]);
      Jv.push([zj[1] * d[2] - zj[2] * d[1], zj[2] * d[0] - zj[0] * d[2], zj[0] * d[1] - zj[1] * d[0]]);
      Jw.push(zj);
    }
    for (let a = 0; a < n; a++) {
      for (let d = 0; d < n; d++) {
        let s = b.inertia.m * (Jv[a][0] * Jv[d][0] + Jv[a][1] * Jv[d][1] + Jv[a][2] * Jv[d][2]);
        for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) s += Jw[a][x] * Iw[3 * x + y] * Jw[d][y];
        M[a * n + d] += s;
      }
    }
  });
  for (let i = 0; i < n; i++) M[i * n + i] += r.armature[i];
  return M;
}

test('rbd: M by composite rigid bodies equals Σ JᵀMJ and RNEA column by column; symmetric, positive definite; RNEA∘FD = identity (500 states)', () => {
  const r = puma(), rand = rng(500), n = 6;
  let dJ = 0, dCol = 0, dFD = 0;
  for (let k = 0; k < 500; k++) {
    const q = randomQ(rand), qd = q.map(() => 4 * rand() - 2), tau = q.map(() => 100 * rand() - 50);
    const M = r.massMatrix(q);
    dJ = Math.max(dJ, maxDiff(M, massByJacobians(r, q)));
    for (let j = 0; j < n; j++) {
      const e = new Float64Array(n); e[j] = 1;
      const col = r.rnea(q, new Float64Array(n), e, undefined, { gravity: false });
      for (let i = 0; i < n; i++) dCol = Math.max(dCol, Math.abs(col[i] - M[i * n + j]));
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) assert.equal(M[i * n + j], M[j * n + i]);
    const L = Float64Array.from(M);
    for (let j = 0; j < n; j++) {
      let d = L[j * n + j];
      for (let p = 0; p < j; p++) d -= L[j * n + p] ** 2;
      assert.ok(d > 0, 'positive definite');
      L[j * n + j] = Math.sqrt(d);
      for (let i = j + 1; i < n; i++) { let s = L[i * n + j]; for (let p = 0; p < j; p++) s -= L[i * n + p] * L[j * n + p]; L[i * n + j] = s / L[j * n + j]; }
    }
    const qdd = r.forwardDynamics(q, qd, tau);
    dFD = Math.max(dFD, maxDiff(r.rnea(q, qd, qdd), tau) / 50);
  }
  assert.ok(dJ < 1e-13 && dCol < 1e-13 && dFD < 1e-13, `ΣJᵀMJ ${dJ}, columns ${dCol}, RNEA∘FD ${dFD}`);
});

test('rbd: the torque split (inertial, Coriolis and centrifugal, gravity, friction) sums to RNEA plus friction', () => {
  const r = puma(), rand = rng(77), drive = { ...PUMA560.drive };
  let worst = 0;
  for (let k = 0; k < 300; k++) {
    const q = randomQ(rand), qd = q.map(() => 3 * rand() - 1.5), qdd = q.map(() => 8 * rand() - 4);
    const s = r.torqueSplit(q, qd, qdd, drive);
    const ref = r.rnea(q, qd, qdd), f = jointFriction(qd, drive);
    for (let i = 0; i < 6; i++) {
      worst = Math.max(worst, Math.abs(s.inertial[i] + s.coriolis[i] + s.gravity[i] + s.friction[i] - (ref[i] + f[i])), Math.abs(s.total[i] - (ref[i] + f[i])));
    }
    // Each share is what it says: at rest only gravity remains; with no gravity and no speed only M·q̈.
    const rest = r.torqueSplit(q, [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], drive);
    assert.ok(maxDiff(rest.total, r.gravityTorque(q)) < 1e-12 && maxDiff(rest.coriolis, [0, 0, 0, 0, 0, 0]) === 0);
  }
  assert.ok(worst < 1e-12, `${worst}`);
  // Friction opposes motion: its power is never negative.
  const f = jointFriction([0.3, -0.2, 0.01, -1e-4, 2, -3], drive);
  [0.3, -0.2, 0.01, -1e-4, 2, -3].forEach((v, i) => assert.ok(f[i] * v >= 0));
});

test('rbd: the Jacobian against central differences of the pose; J̇q̇ against d/dt(J·q̇)', () => {
  const r = puma(), rand = rng(9), h = 1e-6;
  let dJ = 0, dA = 0;
  for (let k = 0; k < 50; k++) {
    const q = randomQ(rand), qd = q.map(() => 2 * rand() - 1);
    const J = Float64Array.from(r.jacobian(q, 'flange'));
    for (let j = 0; j < 6; j++) {
      const qp = [...q], qm = [...q]; qp[j] += h; qm[j] -= h;
      const a = r.linkPose(qp, 'flange'), b = r.linkPose(qm, 'flange'), c = r.linkPose(q, 'flange');
      const v = a.p.map((x, i) => (x - b.p[i]) / (2 * h));
      // ω from Ṙ·Rᵀ, a skew matrix.
      const dR = a.R.map((x, i) => (x - b.R[i]) / (2 * h));
      const W = [0, 1, 2].flatMap((i) => [0, 1, 2].map((l) => dR[3 * i] * c.R[3 * l] + dR[3 * i + 1] * c.R[3 * l + 1] + dR[3 * i + 2] * c.R[3 * l + 2]));
      const w = [W[7], W[2], W[3]];
      for (let i = 0; i < 3; i++) dJ = Math.max(dJ, Math.abs(J[i * 6 + j] - v[i]), Math.abs(J[(3 + i) * 6 + j] - w[i]));
    }
    // Along q(t) = q + q̇·t, q̈ = 0: J̇·q̇ = d/dt (J(q(t))·q̇).
    const Jq = (t) => { const Jt = r.jacobian(q.map((x, i) => x + qd[i] * t), 'flange'); return [0, 1, 2, 3, 4, 5].map((i) => qd.reduce((s, v, j) => s + Jt[i * 6 + j] * v, 0)); };
    const ap = Jq(h), am = Jq(-h), jd = r.jdotqd(q, qd, 'flange');
    for (let i = 0; i < 6; i++) dA = Math.max(dA, Math.abs(jd[i] - (ap[i] - am[i]) / (2 * h)));
  }
  assert.ok(dJ < 1e-8 && dA < 1e-8, `J ${dJ}, J̇q̇ ${dA}`);
  // In the frame: the same columns turned by Rᵀ.
  const q = [0.1, 0.7, -2.4, 0.3, -1, 0.5], Jb = r.jacobian(q, 'flange'), Jn = r.jacobian(q, 'flange', undefined, 'frame'), { R } = r.linkPose(q, 'flange');
  for (let j = 0; j < 6; j++) for (const s of [0, 3]) for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(Jn[(s + i) * 6 + j] - (R[i] * Jb[s * 6 + j] + R[3 + i] * Jb[(s + 1) * 6 + j] + R[6 + i] * Jb[(s + 2) * 6 + j])) < 1e-15);
  }
});

test('rbd: energy is conserved over a 5 s free swing (RK4 at 1 ms, rotors on); friction alone only removes energy', () => {
  const r = puma(), n = 6, h = 1e-3;
  const step = (x, u) => {
    const f = (s) => { const qdd = r.forwardDynamics(s.slice(0, n), s.slice(n), u(s)); return [...s.slice(n), ...qdd]; };
    const k1 = f(x), k2 = f(x.map((v, i) => v + 0.5 * h * k1[i])), k3 = f(x.map((v, i) => v + 0.5 * h * k2[i])), k4 = f(x.map((v, i) => v + h * k3[i]));
    return x.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
  };
  const E = (x) => { const e = r.energy(x.slice(0, n), x.slice(n)); return e.kinetic + e.potential; };
  let x = [0.2, 0.5, -0.5, 0.4, 1.2, -0.3, 0, 0, 0, 0, 0, 0];
  const E0 = E(x);
  let drift = 0, peak = 0;
  for (let k = 0; k < 5000; k++) {
    x = step(x, () => new Float64Array(n));
    drift = Math.max(drift, Math.abs(E(x) - E0));
    peak = Math.max(peak, r.energy(x.slice(0, n), x.slice(n)).kinetic);
  }
  assert.ok(peak > 10, `the arm swings (peak kinetic energy ${peak} J)`);
  assert.ok(drift < 1e-6 * peak, `drift ${drift} J against ${peak} J`);
  // With the motors' friction acting on the joints the energy never rises.
  const drive = PUMA560.drive;
  x = [0.2, 0.5, -0.5, 0.4, 1.2, -0.3, 0, 0, 0, 0, 0, 0];
  let last = E(x);
  for (let k = 0; k < 1000; k++) {
    x = step(x, (s) => jointFriction(s.slice(n), drive).map((v) => -v));
    const e = E(x);
    assert.ok(e <= last + 1e-9, `energy rose at step ${k}: ${e - last}`);
    last = e;
  }
});

// ---- Inverse kinematics in closed form, the oracle for FK (Paul and Zhang's
// solution as in the toolbox, written from the DH table, not from our code).
function ikPuma(R, p, config) {
  const { a: a2 } = DH[1], { a: a3, d: d3 } = DH[2], { d: d4 } = DH[3], flange = 0.05625;
  // The wrist centre, flange 56.25 mm back along the tool's z.
  const Px = p[0] - flange * R[2], Py = p[1] - flange * R[5], Pz = p[2] - flange * R[8] - PEDESTAL;
  const r = Math.hypot(Px, Py);
  if (r < Math.abs(d3)) return null;
  const left = config.includes('l');
  const q1 = left ? Math.atan2(Py, Px) + Math.PI - Math.asin(d3 / r) : Math.atan2(Py, Px) + Math.asin(d3 / r);
  let n2 = config.includes('u') ? 1 : -1;
  if (left) n2 = -n2;
  const V = Px * Math.cos(q1) + Py * Math.sin(q1), rr = Math.hypot(V, Pz);
  const c = (a2 * a2 - d4 * d4 - a3 * a3 + V * V + Pz * Pz) / (2 * a2 * rr);
  if (Math.abs(c) > 1) return null;
  const q2 = Math.atan2(Pz, V) + n2 * Math.acos(c);
  const num = Math.cos(q2) * V + Math.sin(q2) * Pz - a2, den = Math.cos(q2) * Pz - Math.sin(q2) * V;
  const q3 = Math.atan2(a3, d4) - Math.atan2(num, den);
  // The wrist: R36 = (A1·A2·A3)ᵀ·R = Rz(q4)·Ry(−q5)·Rz(q6).
  const A = (row, th) => { const ct = Math.cos(th), st = Math.sin(th), ca = Math.cos(row.alpha), sa = Math.sin(row.alpha); return [ct, -st * ca, st * sa, st, ct * ca, -ct * sa, 0, sa, ca]; };
  const mm = (X, Y) => [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => X[3 * i] * Y[j] + X[3 * i + 1] * Y[3 + j] + X[3 * i + 2] * Y[6 + j]));
  const R03 = mm(mm(A(DH[0], q1), A(DH[1], q2)), A(DH[2], q3));
  const W = [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => R03[i] * R[j] + R03[3 + i] * R[3 + j] + R03[6 + i] * R[6 + j]));
  let th = Math.atan2(Math.hypot(W[2], W[5]), W[8]), phi = Math.atan2(W[5], W[2]), psi = Math.atan2(W[7], -W[6]);
  if (config.includes('f')) { th = -th; phi += Math.PI; psi += Math.PI; }
  return [q1, q2, q3, phi, -th, psi];
}

test('rbd: FK(IK(T)) = T for all 8 configurations at 200 random reachable poses (closed-form IK as the oracle)', () => {
  const r = puma(), rand = rng(200);
  let worst = 0, solved = 0;
  for (let k = 0; k < 200; k++) {
    const T = r.linkPose(randomQ(rand), 'flange');
    for (const config of ['run', 'ruf', 'rdn', 'rdf', 'lun', 'luf', 'ldn', 'ldf']) {
      const q = ikPuma(T.R, T.p, config);
      assert.ok(q, `pose ${k} has no ${config} solution`);
      const b = r.linkPose(q, 'flange');
      worst = Math.max(worst, maxDiff(b.p, T.p), maxDiff(b.R, T.R));
      solved++;
    }
  }
  assert.equal(solved, 1600);
  assert.ok(worst < 1e-10, `${worst}`);
});

test('rbd: singularities where the research puts them (wrist q5 = 0, elbow q3 = −87.3°, the wrist centre 0.150 m from the waist)', () => {
  const r = puma(), s = (q) => sigmaMin(r.jacobian(q, 'flange'), 6, 6);
  assert.ok(s([0.3, 0.6, -2.2, 0.4, 0, 0.2]) < 1e-9, 'wrist');
  assert.ok(s([0.3, 0.6, -Math.PI / 2 + Math.atan2(0.0203, 0.4318), 0.4, 0.8, 0.2]) < 1e-9, 'elbow');
  // The shoulder: the wrist centre's distance from the waist axis is d3 when
  // its reach in the arm's plane, a2·cos q2 + a3·cos(q2+q3) − d4·sin(q2+q3), is 0.
  const q3 = -2.4, reach = (q2) => 0.4318 * Math.cos(q2) + 0.0203 * Math.cos(q2 + q3) - 0.4318 * Math.sin(q2 + q3);
  let lo = 0, hi = 3;
  assert.ok(reach(lo) * reach(hi) < 0);
  for (let k = 0; k < 200; k++) { const mid = (lo + hi) / 2; if (reach(lo) * reach(mid) <= 0) hi = mid; else lo = mid; }
  const q = [0.3, lo, q3, 0.4, 0.8, 0.2];
  const w = r.linkPose(q, 'link4').p;
  assert.ok(Math.abs(Math.hypot(w[0], w[1]) - 0.15005) < 1e-12);
  assert.ok(s(q) < 1e-9, 'shoulder');
  assert.ok(s(PUMA560.start.map((v) => v * DEG)) > 0.15, 'the start pose is far from all three');
});

test('rbd: the damped inverse is the exact inverse away from singularities and bounded near them', () => {
  const r = puma(), J = r.jacobian(PUMA560.start.map((v) => v * DEG), 'flange');
  const { Jinv, sigma, lambda2 } = dampedInverse(J, 6, 6);
  assert.ok(sigma > 0.04 && lambda2 === 0);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    let s = 0; for (let k = 0; k < 6; k++) s += J[i * 6 + k] * Jinv[k * 6 + j];
    assert.ok(Math.abs(s - (i === j ? 1 : 0)) < 1e-12);
  }
  const Js = r.jacobian([0.3, 0.6, -2.2, 0.4, 0, 0.2], 'flange');
  const d = dampedInverse(Js, 6, 6, { eps: 0.04, lambdaMax: 0.05 });
  assert.ok(d.sigma < 1e-9 && Math.abs(d.lambda2 - 0.0025) < 1e-12);
  // ‖J⁺‖ ≤ 1/(2λ) at most: joint speeds stay bounded.
  for (const v of d.Jinv) assert.ok(Math.abs(v) < 1 / (2 * 0.05) + 1e-9);
});

// ---- Orientation error

test('orientation error: right sign at the tool-down pose (20 000 rotations within 2°), exact small and large angles', () => {
  const rand = rng(20000), down = [-1, 0, 0, 0, 1, 0, 0, 0, -1];
  const rot = (k, th) => { const c = Math.cos(th), s = Math.sin(th), v = 1 - c, [x, y, z] = k; return [c + x * x * v, x * y * v - z * s, x * z * v + y * s, y * x * v + z * s, c + y * y * v, y * z * v - x * s, z * x * v - y * s, z * y * v + x * s, c + z * z * v]; };
  const mm = (A, B) => [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j]));
  let worst = 0, worstAngle = 0;
  for (let k = 0; k < 20000; k++) {
    const u = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1], l = Math.hypot(...u), axis = u.map((v) => v / l), th = rand() * 2 * DEG;
    // R_d = Rot(k, θ)·R: the error is sin(θ/2)·k, in the base frame.
    const R = mm(rot([0.6, 0, 0.8], rand() * 2 * DEG), down);
    const { e, theta } = orientationError(mm(rot(axis, th), R), R);
    worst = Math.max(worst, ...axis.map((v, i) => Math.abs(e[i] - Math.sin(th / 2) * v)));
    worstAngle = Math.max(worstAngle, Math.abs(theta - th));
  }
  assert.ok(worst < 1e-15 && worstAngle < 1e-15, `${worst}, ${worstAngle}`);
  const tiny = orientationError(mm(rot([0, 0, 1], 1e-9), down), down);
  assert.ok(Math.abs(tiny.theta - 1e-9) < 1e-22);
  // The textbook form, acos((tr(R_dᵀ·R) − 1)/2), reads 0 there.
  const Rt = rot([0, 0, 1], 1e-9);
  assert.equal(Math.acos(Math.min(1, (Rt[0] + Rt[4] + Rt[8] - 1) / 2)), 0);
  const big = orientationError(rot([0, 1, 0], 179 * DEG), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  assert.ok(Math.abs(big.theta - 179 * DEG) < 1e-14 && big.e[1] > 0);
  // Away from a half turn the separate-quaternion form (η·ε_d − η_d·ε − ε_d × ε) agrees.
  const quat = (A) => { const w = Math.sqrt(1 + A[0] + A[4] + A[8]) / 2; return [w, (A[7] - A[5]) / (4 * w), (A[2] - A[6]) / (4 * w), (A[3] - A[1]) / (4 * w)]; };
  const Rd = rot([0.2, 0.3, 0.93].map((v, _, a) => v / Math.hypot(...a)), 0.7), R = rot([1, 0, 0], 0.4);
  const [ed, xd, yd, zd] = quat(Rd), [e0, x, y, z] = quat(R);
  const ref = [e0 * xd - ed * x - (yd * z - zd * y), e0 * yd - ed * y - (zd * x - xd * z), e0 * zd - ed * z - (xd * y - yd * x)];
  assert.ok(maxDiff(orientationError(Rd, R).e, ref) < 1e-15);
});
