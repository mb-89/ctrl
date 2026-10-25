// Robot descriptions in URDF, read into a model for the rigid-body code
// (core/rbd.js) and the 3D view. The conventions are urdfdom's:
// - <origin xyz rpy> places the child's frame in the parent's, with
//   R = Rz(yaw)·Ry(pitch)·Rx(roll); a missing origin is the identity;
// - a missing <axis> is (1, 0, 0); a cylinder stands along its own z;
// - an <inertial> origin's rpy rotates the inertia tensor.
// The joint's frame is its child link's frame, so a movable joint turns its
// child about the axis, given in that frame.
//
// Fixed joints merge their child into the parent's body: they give a frame
// (model.frames) and add their mass. A movable joint starts a body. Bodies
// come in tree order (a parent before its children), movable joints in the
// same order.
//
//   parseUrdf(text, { inertia: 'refuse' | 'warn' }) -> {
//     name, n, root,
//     bodies: [{ joint, link, parent, R0, p0, axis, lower, upper, effort, velocity,
//                inertia: { m, c, I } }],     R0 (9, row-major), p0: the joint's frame in the parent body's;
//                                             c, I: centre of mass and inertia about it, in the body's frame
//     frames: Map(link -> { body, R, p }),    a link's frame in its body's (body -1: the fixed base)
//     links: [{ name, visuals: [{ origin: { R, p }, geom, material, rgba }] }],
//     joints: [{ name, child, axis, lower, upper, effort, velocity }],  the movable joints, in body order
//     warnings: [sentence, …] }
//
// Refused, each with a sentence: floating and planar joints, prismatic joints
// (not yet), Xacro, two roots or a cycle, a revolute joint without <limit>,
// joint friction or damping other than 0 (friction lives in the motors), a
// mass below 0, and an inertia no rigid body has (not positive semi-definite,
// or principal moments that break the triangle inequality). A test may load
// a published, non-physical set with inertia: 'warn'.
// A mesh cannot be fetched by a standalone page: it is drawn as the link's
// collision primitive, or as a small box, with a warning.

import { parseXml, xmlChildren, xmlChild } from './xml.js';

const fmt = (v) => String(+v.toPrecision(6));

function numbers(s, k, what) {
  const v = String(s).trim().split(/\s+/).map(Number);
  if (v.length !== k || v.some((x) => !Number.isFinite(x))) throw new Error(`URDF: ${what} must be ${k} numbers, not "${s}"`);
  return v;
}

export function rpyMatrix(r, p, y) {
  const cr = Math.cos(r), sr = Math.sin(r), cp = Math.cos(p), sp = Math.sin(p), cy = Math.cos(y), sy = Math.sin(y);
  return [
    cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr,
    sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr,
    -sp, cp * sr, cp * cr,
  ];
}

function origin(el, what) {
  const o = el && xmlChild(el, 'origin');
  const p = o?.attrs.xyz != null ? numbers(o.attrs.xyz, 3, `${what}'s origin xyz`) : [0, 0, 0];
  const rpy = o?.attrs.rpy != null ? numbers(o.attrs.rpy, 3, `${what}'s origin rpy`) : [0, 0, 0];
  return { R: rpyMatrix(...rpy), p };
}

// 3×3 row-major helpers.
const mm = (A, B) => [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j]));
const mv = (A, v) => [0, 1, 2].map((i) => A[3 * i] * v[0] + A[3 * i + 1] * v[1] + A[3 * i + 2] * v[2]);
const tr = (A) => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
const rotI = (R, I) => mm(mm(R, I), tr(R));

// The eigenvalues of a symmetric 3×3 matrix by Jacobi rotations, in the
// order of the diagonal (a diagonal matrix keeps its order).
export function symEig3(S) {
  const a = [[S[0], S[1], S[2]], [S[3], S[4], S[5]], [S[6], S[7], S[8]]];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = a[0][1] ** 2 + a[0][2] ** 2 + a[1][2] ** 2;
    if (off <= 1e-30 * (a[0][0] ** 2 + a[1][1] ** 2 + a[2][2] ** 2) || off === 0) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (a[p][q] === 0) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
    }
  }
  return [a[0][0], a[1][1], a[2][2]];
}

// Why an inertia is not a rigid body's, or null if it is one.
export function inertiaProblem(m, I) {
  if (!(m >= 0)) return `mass ${fmt(m)} kg is below 0`;
  const asym = Math.max(Math.abs(I[1] - I[3]), Math.abs(I[2] - I[6]), Math.abs(I[5] - I[7]));
  const scale = Math.max(Math.abs(I[0]), Math.abs(I[4]), Math.abs(I[8]), 1e-300);
  if (asym > 1e-12 * scale) return 'the inertia tensor is not symmetric';
  const e = symEig3(I), tol = 1e-12 * scale;
  if (Math.min(...e) < -tol) return `moments ${e.map(fmt).join(', ')} are not positive semi-definite: no rigid body has them`;
  for (let k = 0; k < 3; k++) {
    if (e[(k + 1) % 3] + e[(k + 2) % 3] < e[k] - tol) return `moments ${e.map(fmt).join(', ')} break the triangle inequality: no rigid body has them`;
  }
  return null;
}

function readGeometry(g, where) {
  const shape = g && g.children[0];
  if (!shape) throw new Error(`URDF: ${where} has no geometry`);
  const a = shape.attrs;
  if (shape.name === 'box') return { type: 'box', size: numbers(a.size, 3, `${where}'s box size`) };
  if (shape.name === 'cylinder') return { type: 'cylinder', radius: Number(a.radius), length: Number(a.length) };
  if (shape.name === 'sphere') return { type: 'sphere', radius: Number(a.radius) };
  if (shape.name === 'mesh') return { type: 'mesh', filename: a.filename ?? '' };
  throw new Error(`URDF: ${where} has an unknown geometry <${shape.name}>`);
}

function rgbaOf(el) {
  const c = el && xmlChild(el, 'color');
  return c?.attrs.rgba != null ? numbers(c.attrs.rgba, 4, 'a colour') : null;
}

const cache = new Map();

export function parseUrdf(text, { inertia: inertiaMode = 'refuse' } = {}) {
  const key = `${inertiaMode}\n${text}`;
  if (cache.has(key)) return cache.get(key);
  const model = readUrdf(text, inertiaMode);
  if (cache.size > 16) cache.delete(cache.keys().next().value);
  cache.set(key, model);
  return model;
}

function readUrdf(text, inertiaMode) {
  if (/<xacro:|xmlns:xacro|\$\{/.test(text)) throw new Error('URDF: this is Xacro (macros); expand it to plain URDF first (xacro robot.urdf.xacro > robot.urdf)');
  const doc = parseXml(text);
  if (doc.name !== 'robot') throw new Error(`URDF: the root element is <${doc.name}>, not <robot>`);
  if (doc.attrs.version != null && doc.attrs.version !== '1.0') throw new Error(`URDF: version ${doc.attrs.version} is not read (only 1.0)`);
  const warnings = [];
  const materials = new Map(xmlChildren(doc, 'material').map((m) => [m.attrs.name, rgbaOf(m)]));

  const links = new Map();
  for (const el of xmlChildren(doc, 'link')) {
    const name = el.attrs.name;
    if (!name) throw new Error('URDF: a link has no name');
    if (links.has(name)) throw new Error(`URDF: two links are named "${name}"`);
    const inert = xmlChild(el, 'inertial');
    let m = 0, c = [0, 0, 0], I = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    if (inert) {
      const o = origin(inert, `link ${name}'s inertial`);
      m = Number(xmlChild(inert, 'mass')?.attrs.value ?? 0);
      const t = xmlChild(inert, 'inertia')?.attrs ?? {};
      const v = (k) => Number(t[k] ?? 0);
      if (![m, ...['ixx', 'ixy', 'ixz', 'iyy', 'iyz', 'izz'].map(v)].every(Number.isFinite)) throw new Error(`URDF: link ${name}'s inertial values must be numbers`);
      I = rotI(o.R, [v('ixx'), v('ixy'), v('ixz'), v('ixy'), v('iyy'), v('iyz'), v('ixz'), v('iyz'), v('izz')]);
      c = o.p;
      const why = inertiaProblem(m, I);
      if (why) {
        const s = `link ${name}: ${why}`;
        if (inertiaMode !== 'warn') throw new Error(`URDF: ${s}`);
        warnings.push(s);
      }
    }
    const collisions = xmlChildren(el, 'collision').map((k) => ({ origin: origin(k, `link ${name}'s collision`), geom: readGeometry(xmlChild(k, 'geometry'), `link ${name}'s collision`) }));
    const visuals = xmlChildren(el, 'visual').map((vis) => {
      const mat = xmlChild(vis, 'material');
      let v = { origin: origin(vis, `link ${name}'s visual`), geom: readGeometry(xmlChild(vis, 'geometry'), `link ${name}'s visual`), material: mat?.attrs.name ?? null, rgba: rgbaOf(mat) ?? (mat ? materials.get(mat.attrs.name) ?? null : null) };
      if (v.geom.type === 'mesh') {
        const prim = collisions.find((k) => k.geom.type !== 'mesh');
        warnings.push(`link ${name}: the mesh "${v.geom.filename}" cannot be loaded by a standalone page; it is drawn as ${prim ? `its collision ${prim.geom.type}` : 'a 5 cm box'}`);
        v = { ...v, ...(prim ? { origin: prim.origin, geom: prim.geom } : { geom: { type: 'box', size: [0.05, 0.05, 0.05] } }) };
      }
      return v;
    });
    links.set(name, { name, m, c, I, visuals });
  }

  const joints = [];
  const parentOf = new Map();
  for (const el of xmlChildren(doc, 'joint')) {
    const name = el.attrs.name, type = el.attrs.type;
    if (!name) throw new Error('URDF: a joint has no name');
    if (type === 'floating' || type === 'planar') throw new Error(`URDF: joint ${name} is ${type}: a free-flying base is not modelled here (only a fixed base)`);
    if (type === 'prismatic') throw new Error(`URDF: joint ${name} is prismatic: sliding joints are not modelled yet (only revolute, continuous and fixed)`);
    if (!['revolute', 'continuous', 'fixed'].includes(type)) throw new Error(`URDF: joint ${name} has an unknown type "${type}"`);
    const parent = xmlChild(el, 'parent')?.attrs.link, child = xmlChild(el, 'child')?.attrs.link;
    for (const [role, l] of [['parent', parent], ['child', child]]) {
      if (!links.has(l)) throw new Error(`URDF: joint ${name}'s ${role} link "${l ?? ''}" does not exist`);
    }
    if (parentOf.has(child)) throw new Error(`URDF: link ${child} has two parent joints (${parentOf.get(child).name}, ${name}): a closed chain is not a tree`);
    const ax = xmlChild(el, 'axis');
    let axis = ax?.attrs.xyz != null ? numbers(ax.attrs.xyz, 3, `joint ${name}'s axis`) : [1, 0, 0];
    const len = Math.hypot(...axis);
    if (type !== 'fixed' && !(len > 0)) throw new Error(`URDF: joint ${name}'s axis has no direction`);
    axis = axis.map((v) => v / (len || 1));
    const lim = xmlChild(el, 'limit');
    if (type === 'revolute' && !lim) throw new Error(`URDF: revolute joint ${name} has no <limit> (lower, upper, effort, velocity)`);
    const dyn = xmlChild(el, 'dynamics');
    if (dyn && (Number(dyn.attrs.damping ?? 0) !== 0 || Number(dyn.attrs.friction ?? 0) !== 0)) {
      throw new Error(`URDF: joint ${name} has damping or friction in <dynamics>: give 0 here, friction lives in the motors, and counting it twice would be wrong`);
    }
    const lv = (k, d) => (lim?.attrs[k] != null ? Number(lim.attrs[k]) : d);
    const j = {
      name, type, parent, child, origin: origin(el, `joint ${name}`), axis,
      lower: type === 'continuous' ? -Infinity : lv('lower', 0), upper: type === 'continuous' ? Infinity : lv('upper', 0),
      effort: lv('effort', Infinity), velocity: lv('velocity', Infinity),
    };
    if (![j.lower, j.upper, j.effort, j.velocity].every((x) => !Number.isNaN(x))) throw new Error(`URDF: joint ${name}'s limits must be numbers`);
    joints.push(j);
    parentOf.set(child, j);
  }

  const roots = [...links.keys()].filter((l) => !parentOf.has(l));
  if (roots.length !== 1) throw new Error(roots.length ? `URDF: ${roots.length} root links (${roots.join(', ')}): a robot has one` : 'URDF: no root link: the joints form a cycle');
  const root = roots[0];

  // Tree order: depth first from the root, siblings in document order.
  const bodies = [], frames = new Map([[root, { body: -1, R: rpyMatrix(0, 0, 0), p: [0, 0, 0] }]]);
  const visit = (link) => {
    for (const j of joints.filter((x) => x.parent === link)) {
      const f = frames.get(link);
      const R = mm(f.R, j.origin.R), p = mv(f.R, j.origin.p).map((v, k) => v + f.p[k]);
      if (j.type === 'fixed') frames.set(j.child, { body: f.body, R, p });
      else {
        bodies.push({ joint: j.name, link: j.child, parent: f.body, R0: R, p0: p, axis: j.axis, lower: j.lower, upper: j.upper, effort: j.effort, velocity: j.velocity });
        frames.set(j.child, { body: bodies.length - 1, R: rpyMatrix(0, 0, 0), p: [0, 0, 0] });
      }
      visit(j.child);
    }
  };
  visit(root);
  if (frames.size !== links.size) throw new Error(`URDF: links ${[...links.keys()].filter((l) => !frames.has(l)).join(', ')} are not reached from the root ${root}: the joints form a cycle`);

  // Each body's mass: its own link and every link fixed to it, about the
  // combined centre of mass, in the body's frame.
  const sums = Array.from({ length: bodies.length + 1 }, () => ({ m: 0, mc: [0, 0, 0], parts: [] }));
  for (const [name, f] of frames) {
    const l = links.get(name);
    if (!(l.m > 0) && l.I.every((v) => v === 0)) continue;
    const c = mv(f.R, l.c).map((v, k) => v + f.p[k]);
    const s = sums[f.body + 1];
    s.m += l.m;
    for (let k = 0; k < 3; k++) s.mc[k] += l.m * c[k];
    s.parts.push({ m: l.m, c, I: rotI(f.R, l.I) });
  }
  const inertiaOf = (s) => {
    const c = s.m > 0 ? s.mc.map((v) => v / s.m) : [0, 0, 0];
    const I = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const q of s.parts) {
      const d = q.c.map((v, k) => v - c[k]), d2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) I[3 * a + b] += q.I[3 * a + b] + q.m * ((a === b ? d2 : 0) - d[a] * d[b]);
    }
    return { m: s.m, c, I };
  };
  bodies.forEach((b, i) => { b.inertia = inertiaOf(sums[i + 1]); });

  return {
    name: doc.attrs.name ?? '', n: bodies.length, root, bodies, frames,
    links: [...links.values()].map(({ name, visuals }) => ({ name, visuals })),
    joints: bodies.map((b) => ({ name: b.joint, child: b.link, axis: b.axis, lower: b.lower, upper: b.upper, effort: b.effort, velocity: b.velocity })),
    warnings,
  };
}
