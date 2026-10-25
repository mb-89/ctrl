// The 3D view's math, in Node without a page: the orbit camera and its
// projection, pan and zoom, the preset views and the view cube's 26 regions,
// ribbons, dashes and fading paths, picking links in a three.js scene, and
// the cel shading: bands, outlines, and no texture but the light's ramp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../src/vendor/three/three.module.min.js';

globalThis.THREE = THREE;
const V = await import('../src/ui/view3d.js');

const near = (a, b, tol = 1e-9, msg = '') => {
  if (Array.isArray(a)) a.forEach((x, i) => near(x, b[i], tol, `${msg}[${i}]`));
  else assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} ≠ ${b}`);
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const camAt = (s, w = 800, h = 600) => {
  const cam = new THREE.PerspectiveCamera(35, w / h, 0.01, 100);
  V.placeCamera(cam, s, w / h);
  return { cam, project: V.projector(cam, w, h) };
};

test('the orbit basis is right-handed and never rolls, also straight above and below', () => {
  for (const yaw of [-3, -1.2, 0, 0.4, 2.5]) for (const pitch of [-Math.PI / 2, -0.7, 0, 0.3, Math.PI / 2]) {
    const { r, u, d } = V.orbitBasis(yaw, pitch);
    for (const [a, b] of [[r, u], [u, d], [d, r]]) near(dot(a, b), 0, 1e-12);
    for (const a of [r, u, d]) near(dot(a, a), 1, 1e-12);
    near(cross(r, u), d, 1e-12, 'r × u = d');
    near(r[2], 0, 1e-15, 'the screen\'s right stays horizontal');
    assert.ok(u[2] >= -1e-12, 'up never points down');
  }
});

test('preset views: where the eye is, and which way is right and up on the screen', () => {
  const at = (name) => ({ ...V.orbitBasis(V.viewAngles(name).yaw, V.viewAngles(name).pitch) });
  const expect = {
    front: { d: [0, -1, 0], r: [1, 0, 0], u: [0, 0, 1] }, back: { d: [0, 1, 0], r: [-1, 0, 0], u: [0, 0, 1] },
    left: { d: [-1, 0, 0], r: [0, -1, 0], u: [0, 0, 1] }, right: { d: [1, 0, 0], r: [0, 1, 0], u: [0, 0, 1] },
    top: { d: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0] }, bottom: { d: [0, 0, -1], r: [1, 0, 0], u: [0, -1, 0] },
  };
  for (const [name, e] of Object.entries(expect)) {
    const b = at(name);
    for (const k of ['d', 'r', 'u']) near(b[k], e[k], 1e-12, `${name}.${k}`);
  }
  near(at('iso').d, [1, -1, 1].map((x) => x / Math.sqrt(3)), 1e-12, 'iso');
  // Each preset's cube face is the one its view looks at, upright.
  for (const f of V.CUBE_FACES) {
    const b = at(f.label.toLowerCase());
    near(b.d, f.n, 1e-12); near(b.r, f.a, 1e-12); near(b.u, f.b, 1e-12);
  }
  assert.deepEqual(Object.values(V.VIEW_KEYS).sort(), Object.keys(V.VIEWS).sort());
  assert.throws(() => V.viewAngles('sideways'));
});

test('the camera projects the target to the middle, right to the right and up to the top', () => {
  const s = { target: [0.4, -0.2, 0.6], distance: 2, yaw: 0.7, pitch: 0.4 };
  const { cam, project } = camAt(s);
  near(V.eyeOf(s), cam.position.clone().setFromMatrixPosition(cam.matrixWorld).toArray(), 1e-12);
  const c = project(...s.target);
  near(c.slice(0, 2), [400, 300], 1e-9);
  near(c[2], 2, 1e-9, 'depth: the distance');
  const { r, u, d } = V.orbitBasis(s.yaw, s.pitch);
  const pr = project(...s.target.map((v, i) => v + 0.1 * r[i])), pu = project(...s.target.map((v, i) => v + 0.1 * u[i]));
  assert.ok(pr[0] > 400 && Math.abs(pr[1] - 300) < 1e-9);
  assert.ok(pu[1] < 300 && Math.abs(pu[0] - 400) < 1e-9);
  // A pixel at the target's depth is pixelSize long.
  near(pr[0] - 400, 0.1 / V.pixelSize(s, 600), 1e-6);
  assert.equal(project(...V.eyeOf(s).map((v, i) => v + d[i])), null, 'behind the eye: nothing');
  // three's own projection agrees.
  const ndc = new THREE.Vector3(...s.target.map((v, i) => v + 0.1 * r[i] - 0.05 * u[i])).project(cam);
  const p = project(...s.target.map((v, i) => v + 0.1 * r[i] - 0.05 * u[i]));
  near([p[0], p[1]], [(ndc.x + 1) * 400, (1 - ndc.y) * 300], 1e-9);
});

test('orbit, pan, zoom toward the cursor and flying', () => {
  const s = { target: [0, 0, 0.5], distance: 3, yaw: -1, pitch: 0.5 };
  const o = V.orbitBy(s, 10, -1000);
  near(o.yaw, s.yaw - 0.08, 1e-12);
  near(o.pitch, -Math.PI / 2, 0, 'pitch stops at the pole');
  near(V.orbitBy(s, 0, 1e4).pitch, Math.PI / 2, 0);
  // Pan: the target moves with the pointer, exactly.
  const { r: r0, u: u0 } = V.orbitBasis(s.yaw, s.pitch), point = s.target.map((v, i) => v + 0.3 * r0[i] + 0.1 * u0[i]);
  const before = camAt(s).project(...point), after = camAt(V.panBy(s, 25, -12, 600)).project(...point);
  near([after[0] - before[0], after[1] - before[1]], [25, -12], 1e-9, 'a point at the target\'s depth');
  const t0 = camAt(V.panBy(s, 25, -12, 600)).project(...s.target);
  near([t0[0] - 400, t0[1] - 300], [25, -12], 1e-9);
  // Zoom: the point under the cursor, on the target's plane, stays there.
  const nx = 0.4, ny = -0.3, aspect = 800 / 600, { r, u } = V.orbitBasis(s.yaw, s.pitch);
  const hh = s.distance * Math.tan((35 * Math.PI) / 360);
  const under = s.target.map((v, i) => v + nx * hh * aspect * r[i] + ny * hh * u[i]);
  const p0 = camAt(s).project(...under);
  near([p0[0], p0[1]], [(nx + 1) * 400, (1 - ny) * 300], 1e-9);
  for (const f of [0.5, 0.8, 1.25]) {
    const z = V.zoomAt(s, f, nx, ny, aspect);
    near(z.distance, s.distance * f, 1e-12);
    const p1 = camAt(z).project(...under);
    near([p1[0], p1[1]], [p0[0], p0[1]], 1e-6, `zoom ${f}`);
  }
  near(V.zoomAt(s, 1e-9, 0, 0, 1, 35, [0.5, 10]).distance, 0.5, 0, 'limits');
  // Fly: forward along the view, up along z, both at the step given.
  const { d } = V.orbitBasis(s.yaw, s.pitch);
  near(V.flyBy(s, ['w'], 0.2).target, s.target.map((v, i) => v - 0.2 * d[i]), 1e-12);
  near(V.flyBy(s, ['e'], 0.2).target, [0, 0, 0.7], 1e-12);
  near(V.flyBy(s, ['d'], 0.2).target, s.target.map((v, i) => v + 0.2 * r[i]), 1e-12);
  near(V.flyBy(s, new Set(['w', 'q', 'shift']), 0.3).target.map((v, i) => v - s.target[i]).reduce((a, x) => a + x * x, 0), 0.09, 1e-12, 'diagonal: the same speed');
  assert.equal(V.flyBy(s, ['x'], 1), s);
});

test('fit, easing between views and the grid step', () => {
  // A sphere of radius 1 at fitDistance just fits the narrower field of view.
  for (const aspect of [0.5, 1, 2]) {
    const dist = V.fitDistance(1, aspect, 35, 1), v = (35 * Math.PI) / 360, h = Math.atan(Math.tan(v) * aspect);
    near(Math.asin(1 / dist), Math.min(v, h), 1e-12);
  }
  const a = { yaw: 3, pitch: 0 }, b = { yaw: -3, pitch: 1 };
  near(V.easeAngles(a, b, 0).yaw, 3, 0); near(V.easeAngles(a, b, 1).pitch, 1, 1e-12);
  const mid = V.easeAngles(a, b, 0.5);
  near(mid.yaw, 3 + (2 * Math.PI - 6) / 2, 1e-12, 'the short way round, through ±π');
  assert.deepEqual([0.07, 0.1, 0.13, 0.3, 4, 600].map(V.niceStep), [0.1, 0.1, 0.2, 0.5, 5, 1000]);
});

test('the view cube: 26 regions, each one hit where it is drawn', () => {
  const regions = V.cubeRegions();
  assert.equal(regions.length, 26);
  assert.equal(new Set(regions.map((r) => String(r.dir))).size, 26);
  assert.deepEqual(['face', 'edge', 'corner'].map((k) => regions.filter((r) => r.kind === k).length), [6, 12, 8]);
  const half = 26;
  for (const { dir } of regions) {
    // Looking from near the region's own direction, a point of the cube's
    // surface inside the region (its outer components at 1, the others at
    // 0.8 or 0) lies on a face that faces the viewer.
    const look = V.dirAngles(dir.map((v, i) => v + [0.11, 0.07, 0.05][i]));
    const basis = V.orbitBasis(look.yaw, look.pitch);
    const k = dir.findIndex((v) => v !== 0);
    const p = dir.map((v, i) => (i === k ? v : v * 0.8));
    const [x, y] = V.cubeToScreen(basis, p, half);
    const hit = V.cubeHit(basis, x, y, half);
    assert.ok(hit, `region ${dir}: no hit`);
    assert.deepEqual(hit.dir, dir, `region ${dir}`);
    // Snapping to it looks along it.
    near(V.orbitBasis(V.dirAngles(dir).yaw, V.dirAngles(dir).pitch).d, dir.map((v) => v / Math.hypot(...dir)), 1e-12);
  }
  // Every region is reachable from the iso view's three faces or the opposite ones.
  for (const view of [[1, -1, 1], [-1, 1, -1]]) {
    const a = V.dirAngles(view), basis = V.orbitBasis(a.yaw, a.pitch), seen = new Set();
    for (let x = -40; x <= 40; x += 1) for (let y = -40; y <= 40; y += 1) { const h = V.cubeHit(basis, x, y, half); if (h) seen.add(String(h.dir)); }
    assert.equal(seen.size, 19, `${view}: 3 faces, 9 edges and 7 corners`);
  }
  const top = V.orbitBasis(-Math.PI / 2, Math.PI / 2);
  assert.deepEqual(V.cubeHit(top, 0, 0, half).dir, [0, 0, 1]);
  assert.deepEqual(V.cubeHit(top, 25, -25, half).dir, [1, 1, 1], 'top view: up and right is +y, +x');
  assert.equal(V.cubeHit(top, 30, 0, half), null, 'outside the cube');
  // A cell's corners lie on its face, inside it.
  const f = V.CUBE_FACES[4];
  for (const p of V.cubeCell(f, 1, -1)) { near(p[2], 1, 1e-12); assert.ok(p[0] >= 0.5 && p[1] <= -0.5); }
});

test('ribbons: two vertices a point, triangles between neighbours, breaks at gaps, arc length for dashes', () => {
  const pts = [0, 0, 0, 3, 0, 0, 3, 4, 0];
  const r = V.ribbonArrays(pts, [1, 0.5, 0]);
  assert.equal(r.side.length, 6);
  assert.deepEqual([...r.side], [-1, 1, -1, 1, -1, 1]);
  assert.deepEqual([...r.arc], [0, 0, 3, 3, 7, 7]);
  assert.deepEqual([...r.alpha], [1, 1, 0.5, 0.5, 0, 0]);
  assert.deepEqual(r.index, [0, 2, 1, 1, 2, 3, 2, 4, 3, 3, 4, 5]);
  assert.deepEqual([...r.prev.slice(0, 3)], [0, 0, 0], 'the first point is its own previous');
  assert.deepEqual([...r.next.slice(12, 15)], [3, 4, 0], 'the last point is its own next');
  assert.deepEqual([...r.prev.slice(6, 9)], [0, 0, 0]);
  assert.deepEqual([...r.next.slice(6, 9)], [3, 4, 0]);
  assert.equal(r.length, 7);
  // A gap (NaN) breaks the line: no triangle reaches it, the arc restarts.
  const g = V.ribbonArrays([0, 0, 0, 1, 0, 0, NaN, 0, 0, 5, 0, 0, 7, 0, 0]);
  assert.deepEqual(g.index, [0, 2, 1, 1, 2, 3, 6, 8, 7, 7, 8, 9]);
  assert.deepEqual([...g.arc], [0, 0, 1, 1, 0, 0, 0, 0, 2, 2]);
  assert.deepEqual([...g.alpha.slice(4, 6)], [0, 0]);
  // Dashes by arc length: on for dash, off for gap, repeating.
  assert.deepEqual([0, 0.5, 1, 1.2, 1.6, 2.1, 2.7].map((s) => V.onDash(s, 1, 0.5)), [true, true, true, false, true, true, false]);
  assert.ok(V.onDash(5, 0, 0), 'no dash: solid');
});

test('paths: the reference whole, the trail up to now, fading over its time', () => {
  const n = 101, points = [], times = [];
  for (let i = 0; i < n; i++) { points.push(i / 100, 0, 1); times.push(i / 100); }
  const ref = V.pathPoints({ points, times, now: 0.3, style: 'reference' });
  assert.equal(ref.points.length, 3 * n);
  assert.equal(ref.alpha, null);
  const tr = V.pathPoints({ points, times, now: 0.5, fade: 0.2, style: 'actual' });
  // Samples from 0.29 (the last faded one) to 0.50.
  assert.equal(tr.points.length / 3, 22);
  near(tr.points[0], 0.29, 1e-12); near(tr.points[tr.points.length - 3], 0.5, 1e-12);
  near(tr.alpha[tr.alpha.length - 1], 1, 1e-6);
  near(tr.alpha[1], 0, 1e-6, 'at now − fade');
  near(tr.alpha[11], 0.5, 1e-6);
  assert.ok(tr.alpha.every((a, i) => i === 0 || a >= tr.alpha[i - 1]), 'fading toward the past');
  assert.equal(V.pathPoints({ points, times, now: -1, style: 'actual' }).points.length, 0, 'before the start: nothing');
  assert.equal(V.pathPoints({ points, times, now: 0.5, style: 'actual' }).points.length, 3 * 51, 'no fade: all up to now');
  // Thinning keeps the ends.
  const th = V.thinPath(Float64Array.from(points), Float32Array.from(times), 10);
  assert.ok(th.points.length / 3 <= 11);
  near([...th.points.slice(-3)], [1, 0, 1], 0);
  near(th.alpha[th.alpha.length - 1], 1, 1e-7);
});

test('colours from CSS tokens', () => {
  assert.deepEqual(V.parseColor('#f2c718'), [242, 199, 24, 1]);
  assert.deepEqual(V.parseColor(' #abc '), [170, 187, 204, 1]);
  assert.deepEqual(V.parseColor('#00000080'), [0, 0, 0, 128 / 255]);
  assert.deepEqual(V.parseColor('rgba(255, 255, 255, 0.10)'), [255, 255, 255, 0.1]);
  assert.deepEqual(V.parseColor('rgb(1 2 3 / 50%)'), [1, 2, 3, 0.5]);
  assert.equal(V.parseColor('var(--x)'), null);
  assert.equal(V.parseColor(''), null);
});

// A small arm: a box, a cylinder (URDF: along its z) and a sphere.
const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const links = [
  { name: 'block', visuals: [{ origin: { R: I, p: [0, 0, 0] }, geom: { type: 'box', size: [0.2, 0.2, 0.2] }, rgba: [0.5, 0.5, 0.5, 1], material: null }] },
  { name: 'post', visuals: [{ origin: { R: I, p: [0, 0, 0.25] }, geom: { type: 'cylinder', radius: 0.05, length: 0.5 }, rgba: null, material: null }] },
  { name: 'ball', visuals: [{ origin: { R: I, p: [0, 0, 0] }, geom: { type: 'sphere', radius: 0.1 }, rgba: [1, 0.5, 0, 1], material: 'orange' }] },
];

test('picking: a ray against the link meshes names the link, in either renderer', () => {
  const robot = V.buildRobot(links);
  assert.equal(robot.meshes.length, 3);
  // Poses: the block at the origin, the post standing on x = 1, the ball
  // turned and at y = 1.
  const Rz = [0, -1, 0, 1, 0, 0, 0, 0, 1];
  V.applyPoses(robot, { block: { R: I, p: [0, 0, 0] }, post: { R: I, p: [1, 0, 0] }, ball: { R: Rz, p: [0, 1, 0.1] } });
  const s = { target: [0.5, 0.5, 0.2], distance: 4, ...V.viewAngles('iso') };
  const { cam } = camAt(s);
  const ndcOf = (p) => { const v = new THREE.Vector3(...p).project(cam); return [v.x, v.y]; };
  assert.equal(V.pickLink(cam, robot.meshes, ...ndcOf([0, 0, 0])).link, 'block');
  assert.equal(V.pickLink(cam, robot.meshes, ...ndcOf([1, 0, 0.45])).link, 'post', 'the cylinder stands along z');
  assert.equal(V.pickLink(cam, robot.meshes, ...ndcOf([1, 0, 0.6])), null, 'above the cylinder: nothing');
  assert.equal(V.pickLink(cam, robot.meshes, ...ndcOf([0, 1, 0.1])).link, 'ball');
  assert.equal(V.pickLink(cam, robot.meshes, 0.98, 0.98), null);
  const hit = V.pickLink(cam, robot.meshes, ...ndcOf([0, 0, 0]));
  assert.ok(hit.distance < V.eyeOf(s).reduce((a, x) => a + x * x, 0) ** 0.5, 'the near face of the block');
  // The front view, straight at the post: the cylinder's radius bounds it.
  const f = camAt({ target: [1, 0, 0.25], distance: 3, ...V.viewAngles('front') }).cam;
  const nd = (p) => { const v = new THREE.Vector3(...p).project(f); return [v.x, v.y]; };
  assert.equal(V.pickLink(f, robot.meshes, ...nd([1.045, 0, 0.25])).link, 'post');
  assert.equal(V.pickLink(f, robot.meshes, ...nd([1.06, 0, 0.25])), null);
  // The bounds hold every mesh.
  const b = V.robotBounds(robot.meshes);
  for (const p of [[-0.1, -0.1, -0.1], [1.05, 0, 0.5], [0, 1.1, 0.1]]) assert.ok(Math.hypot(...p.map((v, i) => v - b.center[i])) <= b.radius + 1e-9);
  // A visual's URDF colour gives its role; the role's token its colour.
  assert.deepEqual(robot.meshes.map((m) => m.userData.role), ['dark', 'light', 'accent'], 'the grey block is dark, the post without a colour light');
  V.styleRobot(robot, { parts: { light: [226, 221, 208, 1], dark: [89, 97, 107, 1], accent: [232, 105, 44, 1] }, outline: [21, 25, 28, 1] });
  assert.equal(robot.meshes[2].material.color.getHexString(), 'e8692c');
  assert.equal(robot.meshes[0].children[0].material.uniforms.color.value.getHexString(), '15191c', 'the outline');
  // Canvas mode draws coarser shapes.
  assert.ok(robot.meshes[1].userData.coarse.attributes.position.count < robot.meshes[1].geometry.attributes.position.count);
});

test('setMatrix reads a row-major rotation and a position', () => {
  const m = V.setMatrix(new THREE.Matrix4(), { R: [0, -1, 0, 1, 0, 0, 0, 0, 1], p: [1, 2, 3] });
  near(new THREE.Vector3(1, 0, 0).applyMatrix4(m).toArray(), [1, 3, 3], 1e-12);
  near(new THREE.Vector3(0, 1, 0).applyMatrix4(m).toArray(), [0, 2, 3], 1e-12);
});

test('cel shading: three bands of light, the painter\'s the same as the shader\'s ramp', () => {
  assert.ok(V.TOON_RAMP.length >= 3 && V.TOON_RAMP.length <= 4);
  // Turned away, grazing, facing the light.
  assert.deepEqual([-1, -0.3, 0, 0.3, 0.5, 0.9, 1].map(V.toonBand), [0, 0, 0.5, 0.5, 1, 1, 1]);
  assert.equal(new Set([...Array(201)].map((_, i) => V.toonBand(-1 + i / 100))).size, 3, 'three bands, nothing between');
  // Where three samples the ramp (dot · 0.5 + 0.5, nearest texel), the band is the same.
  const ramp = V.toonRamp(), data = ramp.image.data;
  for (let i = 0; i <= 200; i++) {
    const ndl = -1 + i / 100, u = ndl * 0.5 + 0.5, texel = Math.min(data.length - 1, Math.floor(u * data.length));
    near(data[texel] / 255, V.toonBand(ndl), 1 / 255, `dot ${ndl}`);
  }
  assert.equal(ramp.magFilter, THREE.NearestFilter); assert.equal(ramp.minFilter, THREE.NearestFilter);
  // The trail fades in steps too.
  assert.deepEqual([0, 0.002, 0.1, 0.34, 0.5, 0.7, 1].map(V.bandAlpha), [0, 0, 1 / 3, 2 / 3, 2 / 3, 1, 1]);
  // Roles from URDF colours.
  assert.deepEqual([null, [0.86, 0.84, 0.78, 1], [0.32, 0.34, 0.37, 1], [0.85, 0.27, 0.2, 1], [0.93, 0.55, 0.2, 1]].map(V.partRole), ['light', 'light', 'dark', 'accent', 'accent']);
});

test('outlines: a box has 12 hard edges, a cylinder its two rims, a sphere none; the hull\'s normals are smoothed', () => {
  const seg = (g) => V.hardEdgePoints(g).length / 9;
  assert.equal(seg(V.shapeGeometry({ type: 'box', size: [1, 2, 3] })), 12);
  assert.equal(seg(V.shapeGeometry({ type: 'cylinder', radius: 0.1, length: 1 })), 2 * 48);
  assert.equal(seg(V.shapeGeometry({ type: 'sphere', radius: 1 })), 0);
  // The painter's edges of the coarse shapes: every edge borders two
  // triangles (closed shapes), the hard ones as above.
  for (const [geom, hard] of [[{ type: 'box', size: [1, 1, 1] }, 12], [{ type: 'cylinder', radius: 0.1, length: 1 }, 28], [{ type: 'sphere', radius: 1 }, 0]]) {
    const E = V.meshEdges(V.shapeGeometry(geom, true));
    let n = 0;
    for (let e = 0; e < E.length; e += 5) { assert.ok(E[e + 3] >= 0, `${geom.type}: a border`); n += E[e + 4]; }
    assert.equal(n, hard, geom.type);
  }
  // A box's corner: its three vertices there share one normal, diagonal.
  const box = V.shapeGeometry({ type: 'box', size: [1, 1, 1] }), sn = V.smoothNormals(box), pos = box.attributes.position;
  for (let i = 0; i < pos.count; i++) near([sn[3 * i], sn[3 * i + 1], sn[3 * i + 2]], [pos.getX(i), pos.getY(i), pos.getZ(i)].map((v) => Math.sign(v) / Math.sqrt(3)), 1e-6);
});

test('no texture but the light\'s ramp, and nothing loaded: shapes and colours are made by code', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/ui/view3d.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /Loader\b|\bfetch\(|XMLHttpRequest|new Image\b|\bimport\(|createImageBitmap|\b(Canvas|Video|Cube|Compressed|Data3D|DataArray|Depth)Texture\b|\.(png|jpe?g|gif|webp|ktx2?|hdr|exr|glb|gltf|obj|stl|dae|fbx|ttf|otf|woff2?)\b/i, 'view3d loads nothing and makes no other texture');
  assert.equal(src.match(/new THREE\.DataTexture\(/g)?.length, 1, 'one texture is made: the ramp');
  // Every texture a built robot holds is its ramp, a few bytes.
  const robot = V.buildRobot(links), seen = new Set();
  robot.group.traverse((o) => {
    if (!o.material) return;
    for (const v of Object.values(o.material)) if (v?.isTexture) seen.add(v);
    for (const u of Object.values(o.material.uniforms ?? {})) if (u.value?.isTexture) seen.add(u.value);
  });
  assert.deepEqual([...seen], [robot.ramp]);
  assert.ok(robot.ramp.isDataTexture && robot.ramp.image.data.length <= 4);
  // Every surface is toon-shaded, with a hull and its hard edges.
  for (const m of robot.meshes) {
    assert.ok(m.material.isMeshToonMaterial);
    assert.equal(m.material.gradientMap, robot.ramp);
    assert.equal(m.children.length, 2);
    assert.equal(m.children[0].material.side, THREE.BackSide);
  }
});
