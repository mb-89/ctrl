// The 3D view: a robot drawn from its links' visuals (URDF shapes), posed
// every frame, with paths (a dashed reference, a fading trail), labelled frame
// triads and joint axes. three.js draws it with WebGL (globalThis.THREE, set
// by the vendored script); where WebGL is missing or its context is lost, a
// Canvas2D painter walks the same scene. Both draw it cel shaded: each surface
// in a few flat bands of light, outlined, in the design tokens' colours; no
// texture but the light's ramp, made here, and nothing loaded. Navigation is CAD's: orbit about a
// target (z up, no roll), pan, zoom toward the cursor, WASD/QE to fly, preset
// views, an axis triad and a clickable view cube.
//
// The math (camera orbit, presets, the cube's regions, ribbons, paths,
// picking) is plain functions, tested in Node without a page.

import { palette } from './palette.js';

const T = () => globalThis.THREE;
const DEG = Math.PI / 180;
const FOV = 35;
const MONO = () => palette().mono;
const CANVAS_DASH = [8, 5];   // pixels

// ---- Vectors (plain arrays)
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const n = norm(a); return n > 0 ? scale(a, 1 / n) : [0, 0, 0]; };
const rot = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];

// ---- The camera: an orbit about a target. yaw and pitch give the direction
// from the target to the eye, d = (cos p cos y, cos p sin y, sin p); the
// screen's right is horizontal, r = (−sin y, cos y, 0), and its up u = d × r.
// The basis stays defined straight above and below (pitch ±90°), so top and
// bottom are views like the others, never a roll.
export function orbitBasis(yaw, pitch) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
  const d = [cp * cy, cp * sy, sp], r = [-sy, cy, 0];
  return { r, u: cross(d, r), d };
}
export const eyeOf = (s) => add(s.target, scale(orbitBasis(s.yaw, s.pitch).d, s.distance));

// The direction from the target to the eye as yaw and pitch. Straight up or
// down keeps the yaw given (the top view's x to the right, y up).
export function dirAngles(dir, yaw = -90 * DEG) {
  const d = unit(dir), h = Math.hypot(d[0], d[1]);
  return { yaw: h < 1e-9 ? yaw : Math.atan2(d[1], d[0]), pitch: Math.atan2(d[2], h) };
}

// Preset views, by where the eye is: front looks along +y (x right, z up),
// right along −x, top down (x right, y up), iso from (1, −1, 1).
export const VIEWS = {
  front: [0, -1, 0], back: [0, 1, 0], left: [-1, 0, 0], right: [1, 0, 0],
  top: [0, 0, 1], bottom: [0, 0, -1], iso: [1, -1, 1],
};
export const VIEW_KEYS = { 1: 'front', 2: 'back', 3: 'left', 4: 'right', 5: 'top', 6: 'bottom', 0: 'iso' };
export function viewAngles(name) {
  const d = VIEWS[name];
  if (!d) throw new Error(`unknown view ${name}`);
  return dirAngles(d);
}

// Dragging: right turns the scene with the pointer, down shows it more from
// above; pitch stops at the poles.
export function orbitBy(s, dx, dy, k = 0.008) {
  return { ...s, yaw: s.yaw - dx * k, pitch: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, s.pitch + dy * k)) };
}
// World length of a pixel at the target's depth, in a view h pixels tall.
export const pixelSize = (s, h, fov = FOV) => (2 * s.distance * Math.tan((fov * DEG) / 2)) / Math.max(1, h);
// Panning: the point under the pointer stays under it (at the target's depth).
export function panBy(s, dx, dy, h, fov = FOV) {
  const { r, u } = orbitBasis(s.yaw, s.pitch), k = pixelSize(s, h, fov);
  return { ...s, target: add(s.target, add(scale(r, -dx * k), scale(u, dy * k))) };
}
// Zoom by factor (< 1 nearer) toward the point under the cursor, given in
// normalised device coordinates (−1…1, y up): that point, on the plane
// through the target facing the viewer, stays where it is on the screen.
export function zoomAt(s, factor, nx = 0, ny = 0, aspect = 1, fov = FOV, limits = [1e-3, 1e4]) {
  const distance = Math.max(limits[0], Math.min(limits[1], s.distance * factor)), f = distance / s.distance;
  const { r, u } = orbitBasis(s.yaw, s.pitch), hh = s.distance * Math.tan((fov * DEG) / 2);
  const p = add(s.target, add(scale(r, nx * hh * aspect), scale(u, ny * hh)));
  return { ...s, distance, target: add(p, scale(sub(s.target, p), f)) };
}
// Flying: forward along the view, sideways along the screen's right, up and
// down along the world's z; the eye and the target move together.
export const FLY = { w: [0, 0, -1], s: [0, 0, 1], a: [-1, 0, 0], d: [1, 0, 0], q: [0, -1, 0], e: [0, 1, 0] };
export function flyBy(s, keys, step) {
  const { r, d } = orbitBasis(s.yaw, s.pitch);
  let m = [0, 0, 0];
  for (const k of keys) {
    const f = FLY[k];
    if (f) m = add(m, add(add(scale(r, f[0]), [0, 0, f[1]]), scale(d, f[2])));
  }
  return norm(m) ? { ...s, target: add(s.target, scale(unit(m), step)) } : s;
}
// The distance at which a sphere of radius rad fills the view.
export function fitDistance(rad, aspect = 1, fov = FOV, margin = 1.15) {
  const v = (fov * DEG) / 2, h = Math.atan(Math.tan(v) * aspect);
  return (rad * margin) / Math.sin(Math.min(v, h));
}
// Between two orientations, s in [0, 1], eased, yaw the short way round.
export function easeAngles(a, b, s) {
  const e = s < 0.5 ? 4 * s * s * s : 1 - (-2 * s + 2) ** 3 / 2;
  let dy = (b.yaw - a.yaw) % (2 * Math.PI);
  if (dy > Math.PI) dy -= 2 * Math.PI;
  if (dy < -Math.PI) dy += 2 * Math.PI;
  return { yaw: a.yaw + dy * e, pitch: a.pitch + (b.pitch - a.pitch) * e };
}

// Puts a three.js camera at the orbit.
export function placeCamera(camera, s, aspect) {
  const THREE = T(), { r, u, d } = orbitBasis(s.yaw, s.pitch), eye = eyeOf(s);
  camera.aspect = aspect;
  camera.near = s.distance / 200;
  camera.far = s.distance * 200;
  camera.updateProjectionMatrix();
  camera.matrixAutoUpdate = false;
  camera.matrix.makeBasis(new THREE.Vector3(...r), new THREE.Vector3(...u), new THREE.Vector3(...d)).setPosition(...eye);
  camera.updateMatrixWorld(true);
}

// ---- The view cube: 26 regions (6 faces, 12 edges, 8 corners), each a view
// direction with components in {−1, 0, 1}. Each face is cut 3 × 3: its middle
// is the face, its borders the edges, its corners the cube's corners. Each
// face's right and up are those of its own preset view, so its label reads
// upright there.
export const CUBE_FACES = [
  { n: [0, -1, 0], a: [1, 0, 0], b: [0, 0, 1], label: 'FRONT' },
  { n: [0, 1, 0], a: [-1, 0, 0], b: [0, 0, 1], label: 'BACK' },
  { n: [-1, 0, 0], a: [0, -1, 0], b: [0, 0, 1], label: 'LEFT' },
  { n: [1, 0, 0], a: [0, 1, 0], b: [0, 0, 1], label: 'RIGHT' },
  { n: [0, 0, 1], a: [1, 0, 0], b: [0, 1, 0], label: 'TOP' },
  { n: [0, 0, -1], a: [1, 0, 0], b: [0, -1, 0], label: 'BOTTOM' },
];
const CELL = 0.56;   // the face's middle spans ±CELL of its half-width
export function cubeRegions() {
  const out = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    const n = Math.abs(x) + Math.abs(y) + Math.abs(z);
    if (n) out.push({ dir: [x, y, z], kind: ['', 'face', 'edge', 'corner'][n] });
  }
  return out;
}
// Where a point of the cube's surface (cube coordinates, ±1) lands on the
// gizmo: half is the cube's half-width in pixels, y down. Orthographic.
export const cubeToScreen = (basis, p, half) => [dot(p, basis.r) * half, -dot(p, basis.u) * half];
// The region under a gizmo point (x, y from the cube's centre, pixels, y
// down): { dir, face, s, t } or null. Only faces turned to the viewer count.
export function cubeHit(basis, x, y, half) {
  for (const f of CUBE_FACES) {
    if (dot(f.n, basis.d) < 1e-3) continue;
    const [cx, cy] = cubeToScreen(basis, f.n, half), [ax, ay] = cubeToScreen(basis, f.a, half), [bx, by] = cubeToScreen(basis, f.b, half);
    const det = ax * by - ay * bx;
    if (Math.abs(det) < 1e-6) continue;
    const px = x - cx, py = y - cy, s = (px * by - py * bx) / det, t = (ax * py - ay * px) / det;
    if (Math.abs(s) > 1 || Math.abs(t) > 1) continue;
    const i = s > CELL ? 1 : s < -CELL ? -1 : 0, j = t > CELL ? 1 : t < -CELL ? -1 : 0;
    return { dir: add(f.n, add(scale(f.a, i), scale(f.b, j))), face: f, s, t };
  }
  return null;
}
// A cell of a face as four points in cube coordinates (i, j in {−1, 0, 1}).
export function cubeCell(f, i, j) {
  const lim = (k) => (k < 0 ? [-1, -CELL] : k > 0 ? [CELL, 1] : [-CELL, CELL]);
  const [s0, s1] = lim(i), [t0, t1] = lim(j);
  return [[s0, t0], [s1, t0], [s1, t1], [s0, t1]].map(([s, t]) => add(f.n, add(scale(f.a, s), scale(f.b, t))));
}

// ---- Colours from CSS: #rgb, #rrggbb, #rrggbbaa, rgb(), rgba() → [r, g, b, a]
// with r, g, b in 0…255 and a in 0…1; null if it is none of those.
export function parseColor(str) {
  const s = String(str ?? '').trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return [...v, h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1];
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(s);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return [Number(m[1]), Number(m[2]), Number(m[3]), a];
}
const cssOf = (c) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3]})`;
const hexOf = (c) => `#${c.slice(0, 3).map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
// A step of 1, 2 or 5 times a power of ten, at least x.
export function niceStep(x) {
  const p = 10 ** Math.floor(Math.log10(x)), m = x / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}
// Mixes two parsed colours: k = 0 gives a, 1 gives b.
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);

// ---- Paths. Points come flat (x, y, z, x, y, z, …); a non-finite point
// breaks the line. The trail shows the samples up to now, its alpha falling
// from 1 at now to 0 at now − fade.
export function pathPoints(path) {
  const pts = path.points ?? [], n = Math.floor(pts.length / 3), times = path.times;
  if (path.style !== 'actual' || !times || path.now === undefined) return { points: Float64Array.from(pts.slice(0, 3 * n)), alpha: null };
  const fade = path.fade > 0 ? path.fade : Infinity;
  let j1 = n - 1;
  while (j1 >= 0 && !(times[j1] <= path.now)) j1--;
  let j0 = 0;
  while (j0 < j1 && path.now - times[j0] > fade) j0++;
  if (j0 > 0) j0--;   // the last faded sample: the trail reaches alpha 0
  const m = Math.max(0, j1 - j0 + 1), points = new Float64Array(3 * m), alpha = new Float32Array(m);
  for (let j = 0; j < m; j++) {
    for (let c = 0; c < 3; c++) points[3 * j + c] = pts[3 * (j0 + j) + c];
    alpha[j] = Number.isFinite(fade) ? Math.max(0, Math.min(1, 1 - (path.now - times[j0 + j]) / fade)) : 1;
  }
  return { points, alpha };
}
// Every stride-th point (the last one kept), so a long path stays cheap.
export function thinPath(points, alpha, max) {
  const n = points.length / 3;
  if (n <= max) return { points, alpha };
  const stride = Math.ceil(n / max), idx = [];
  for (let j = 0; j < n; j += stride) idx.push(j);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
  const p = new Float64Array(idx.length * 3), a = alpha ? new Float32Array(idx.length) : null;
  idx.forEach((j, k) => { p[3 * k] = points[3 * j]; p[3 * k + 1] = points[3 * j + 1]; p[3 * k + 2] = points[3 * j + 2]; if (a) a[k] = alpha[j]; });
  return { points: p, alpha: a };
}

// A screen-space ribbon: every point becomes two vertices (side −1 and +1)
// that the vertex shader pushes apart across the line, by its neighbours on
// the screen (prev, next; at the ends and at breaks, the point itself), so
// the line has a width in pixels. arc is the length along the line (for
// dashes), restarting at 0 after a break.
export function ribbonArrays(points, alpha = null) {
  const n = Math.floor(points.length / 3), ok = (j) => j >= 0 && j < n && Number.isFinite(points[3 * j]) && Number.isFinite(points[3 * j + 1]) && Number.isFinite(points[3 * j + 2]);
  const position = new Float32Array(6 * n), prev = new Float32Array(6 * n), next = new Float32Array(6 * n);
  const side = new Float32Array(2 * n), arc = new Float32Array(2 * n), alp = new Float32Array(2 * n), index = [];
  let s = 0;
  for (let j = 0; j < n; j++) {
    const here = ok(j) ? j : -1, p = ok(j - 1) && here >= 0 ? j - 1 : here, q = ok(j + 1) && here >= 0 ? j + 1 : here;
    if (here >= 0 && p !== here) s += Math.hypot(points[3 * j] - points[3 * p], points[3 * j + 1] - points[3 * p + 1], points[3 * j + 2] - points[3 * p + 2]);
    else s = 0;
    for (let k = 0; k < 2; k++) {
      const v = 2 * j + k;
      for (let c = 0; c < 3; c++) {
        position[3 * v + c] = here >= 0 ? points[3 * j + c] : 0;
        prev[3 * v + c] = here >= 0 ? points[3 * p + c] : 0;
        next[3 * v + c] = here >= 0 ? points[3 * q + c] : 0;
      }
      side[v] = k ? 1 : -1;
      arc[v] = s;
      alp[v] = here < 0 ? 0 : alpha ? alpha[j] : 1;
    }
    if (here >= 0 && q !== here) index.push(2 * j, 2 * j + 2, 2 * j + 1, 2 * j + 1, 2 * j + 2, 2 * j + 3);
  }
  return { position, prev, next, side, arc, alpha: alp, index, length: s };
}
// Whether a point at arc length s lies on a dash (period dash + gap).
export const onDash = (s, dash, gap) => !(dash > 0) || ((s % (dash + gap)) + dash + gap) % (dash + gap) <= dash;

// A trail fades in steps, as the light does on the surfaces: its alpha in
// FADE_BANDS flat bands, never a gradient.
export const FADE_BANDS = 3;
export const bandAlpha = (a) => (a <= 0.004 ? 0 : Math.ceil(a * FADE_BANDS - 1e-4) / FADE_BANDS);
const RIBBON_VS = `
attribute vec3 prev;
attribute vec3 next;
attribute float side;
attribute float arc;
attribute float alpha;
uniform vec2 resolution;
uniform float width;
varying float vArc;
varying float vAlpha;
vec2 screen(vec4 c) { return c.xy / c.w * resolution * 0.5; }
void main() {
  mat4 m = projectionMatrix * modelViewMatrix;
  vec4 c = m * vec4(position, 1.0);
  vec2 a = screen(m * vec4(prev, 1.0)), b = screen(c), d = screen(m * vec4(next, 1.0));
  vec2 t1 = b - a, t2 = d - b;
  if (dot(t1, t1) < 1e-10) t1 = t2;
  if (dot(t2, t2) < 1e-10) t2 = t1;
  if (dot(t1, t1) < 1e-10) { t1 = vec2(1.0, 0.0); t2 = t1; }
  t1 = normalize(t1); t2 = normalize(t2);
  vec2 tg = t1 + t2;
  tg = dot(tg, tg) < 1e-6 ? t1 : normalize(tg);
  vec2 nrm = vec2(-tg.y, tg.x);
  float miter = 1.0 / max(0.5, dot(nrm, vec2(-t1.y, t1.x)));
  c.xy += nrm * side * width * miter / resolution * c.w;
  vArc = arc;
  vAlpha = alpha;
  gl_Position = c;
}`;
const RIBBON_FS = `
uniform vec3 color;
uniform float opacity;
uniform float dash;
uniform float gap;
varying float vArc;
varying float vAlpha;
void main() {
  if (dash > 0.0 && mod(vArc, dash + gap) > dash) discard;
  if (vAlpha * opacity <= 0.004) discard;
  gl_FragColor = vec4(color, opacity * ceil(vAlpha * ${FADE_BANDS}.0 - 1e-4) / ${FADE_BANDS}.0);
  #include <colorspace_fragment>
}`;
function ribbonMaterial(resolution, { color, width, dash = 0, gap = 0, opacity = 1 }) {
  const THREE = T();
  return new THREE.ShaderMaterial({
    vertexShader: RIBBON_VS, fragmentShader: RIBBON_FS, side: THREE.DoubleSide, transparent: true, depthWrite: false, depthTest: true,
    uniforms: { resolution, width: { value: width }, color: { value: new THREE.Color(hexOf(color)) }, opacity: { value: opacity * color[3] }, dash: { value: dash }, gap: { value: gap } },
  });
}

// ---- Cel shading. The key light's dot(n, l), from −1 (turned away) to 1,
// picks its strength from a ramp, sampled as three samples it (dot · 0.5 +
// 0.5, nearest texel): four texels make three bands, shadow (turned away),
// half (grazing) and lit. The ramp is the only texture, made here.
export const TOON_RAMP = [0, 0, 0.5, 1];
// The key light (in the camera's frame: from the upper left, in front) and
// the ambient: the lit band shows a part in its token's colour, the half band
// at about 0.65 of it and the shadow at 0.3 (linear light).
export const LIGHT = { key: 2.2, ambient: 0.94, dir: [-0.45, 0.85, 0.5] };
export function toonBand(ndl) {
  const n = TOON_RAMP.length;
  return TOON_RAMP[Math.max(0, Math.min(n - 1, Math.floor((ndl * 0.5 + 0.5) * n)))];
}
export function toonRamp() {
  const THREE = T(), t = new THREE.DataTexture(Uint8Array.from(TOON_RAMP, (v) => Math.round(v * 255)), TOON_RAMP.length, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}
// Outlines, in CSS pixels at every zoom: the silhouette's width outside the
// shape, and the hard edges' (where faces meet at more than EDGE_ANGLE).
export const OUTLINE = { silhouette: 1.6, edge: 1.2 };
export const EDGE_ANGLE = 30;
// A part's colour is a token chosen by its role, which its URDF colour
// gives: a saturated colour is the accent (a tool), else light or dark.
export const PART_ROLES = ['light', 'dark', 'accent', 'ruby'];
export function partRole(rgba) {
  if (!rgba) return 'light';
  const [r, g, b] = rgba, hi = Math.max(r, g, b), lo = Math.min(r, g, b);
  if (hi - lo > 0.3 && r > 0.6 && g < 0.2 && b < 0.3) return 'ruby';   // a probe's ruby ball
  return hi - lo > 0.3 ? 'accent' : 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? 'light' : 'dark';
}

// The silhouette: the mesh again, its back faces only, each vertex pushed out
// on the screen by the outline's width along its smoothed normal (so a box's
// corners stay closed), in the outline colour (an inverted hull).
const HULL_VS = `
attribute vec3 smoothNormal;
uniform vec2 resolution;
uniform float width;
void main() {
  vec4 c = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalMatrix * smoothNormal;
  vec2 d = vec2(n.x * projectionMatrix[0][0] * resolution.x, n.y * projectionMatrix[1][1] * resolution.y);
  if (dot(d, d) > 1e-12) c.xy += normalize(d) * 2.0 * width / resolution * c.w;
  gl_Position = c;
}`;
const HULL_FS = `
uniform vec3 color;
void main() {
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}`;
// Where a vertex is, to 10 µm of the shape's units (−0 and 0 the same place).
const placeKey = (pos, i) => `${Math.round(pos.getX(i) * 1e5) || 0},${Math.round(pos.getY(i) * 1e5) || 0},${Math.round(pos.getZ(i) * 1e5) || 0}`;
// The normals averaged over the vertices at one place.
export function smoothNormals(geo) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal, n = pos.count, sum = new Map(), keys = new Array(n);
  for (let i = 0; i < n; i++) {
    const k = keys[i] = placeKey(pos, i);
    const s = sum.get(k) ?? [0, 0, 0];
    s[0] += nrm.getX(i); s[1] += nrm.getY(i); s[2] += nrm.getZ(i);
    sum.set(k, s);
  }
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) out.set(unit(sum.get(keys[i])), 3 * i);
  return out;
}
// The hard edges as one polyline broken between segments (for a ribbon).
export function hardEdgePoints(geo, angle = EDGE_ANGLE) {
  const THREE = T(), e = new THREE.EdgesGeometry(geo, angle), p = e.attributes.position.array, out = [];
  for (let i = 0; i < p.length; i += 6) out.push(p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5], NaN, NaN, NaN);
  e.dispose();
  return out;
}
// For the painter: every edge of a mesh's triangles, with the one or two
// triangles it borders and whether it is hard. Flat [a, b, t0, t1, hard]:
// vertex indices, triangle indices (t1 = −1 on a border), 1 if hard.
export function meshEdges(geo, angle = EDGE_ANGLE) {
  const pos = geo.attributes.position, idx = geo.index, n = idx ? idx.count : pos.count;
  const at = (k) => (idx ? idx.getX(k) : k), ids = new Map(), id = (i) => {
    const k = placeKey(pos, i);
    if (!ids.has(k)) ids.set(k, ids.size);
    return ids.get(k);
  };
  const v = (i) => [pos.getX(i), pos.getY(i), pos.getZ(i)], normals = [], byKey = new Map();
  for (let k = 0; k < n; k += 3) {
    const t = k / 3, tri = [at(k), at(k + 1), at(k + 2)];
    const p0 = v(tri[0]), nr = cross(sub(v(tri[1]), p0), sub(v(tri[2]), p0));
    normals[t] = norm(nr) > 1e-12 ? unit(nr) : null;
    for (let j = 0; j < 3; j++) {
      const a = tri[j], b = tri[(j + 1) % 3], ia = id(a), ib = id(b);
      if (ia === ib) continue;
      const key = ia < ib ? `${ia} ${ib}` : `${ib} ${ia}`, e = byKey.get(key);
      if (e) e.t1 = t; else byKey.set(key, { a, b, t0: t, t1: -1 });
    }
  }
  const out = [], c = Math.cos(angle * DEG);
  for (const e of byKey.values()) {
    const n0 = normals[e.t0], n1 = e.t1 >= 0 ? normals[e.t1] : null;
    out.push(e.a, e.b, e.t0, e.t1, n0 && n1 && dot(n0, n1) < c ? 1 : 0);
  }
  return Int32Array.from(out);
}

// ---- The robot: one group per link, posed by its world transform; each
// visual a mesh in it. URDF's cylinder stands along its z (three's along y).
const identity = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], p: [0, 0, 0] };
export function setMatrix(m, { R, p }) {
  m.set(R[0], R[1], R[2], p[0], R[3], R[4], R[5], p[1], R[6], R[7], R[8], p[2], 0, 0, 0, 1);
  return m;
}
export function shapeGeometry(geom, coarse = false) {
  const THREE = T();
  if (geom.type === 'box') return new THREE.BoxGeometry(...geom.size);
  if (geom.type === 'sphere') return coarse ? new THREE.SphereGeometry(geom.radius, 12, 8) : new THREE.SphereGeometry(geom.radius, 40, 24);
  if (geom.type === 'cylinder') {
    const g = new THREE.CylinderGeometry(geom.radius, geom.radius, geom.length, coarse ? 14 : 48, 1);
    g.rotateX(Math.PI / 2);
    return g;
  }
  throw new Error(`unknown shape ${geom.type}`);
}
// Each visual a toon-shaded mesh with its silhouette (a hull) and its hard
// edges (a ribbon) as children; colours come later, from the theme
// (styleRobot). resolution is the view's size uniform, for the outlines.
export function buildRobot(links, { resolution = { value: new (T().Vector2)(1, 1) } } = {}) {
  const THREE = T(), group = new THREE.Group(), byName = {}, meshes = [], ramp = toonRamp();
  const line = { value: new THREE.Color() };
  for (const link of links ?? []) {
    const g = new THREE.Group();
    g.name = link.name;
    g.matrixAutoUpdate = false;
    for (const v of link.visuals ?? []) {
      const alpha = v.rgba?.[3] ?? 1, geo = shapeGeometry(v.geom), coarse = shapeGeometry(v.geom, true);
      const mesh = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ gradientMap: ramp, transparent: alpha < 1, opacity: alpha }));
      mesh.matrixAutoUpdate = false;
      setMatrix(mesh.matrix, v.origin ?? identity);
      mesh.userData = { link: link.name, role: partRole(v.rgba), coarse, edges: meshEdges(coarse) };
      geo.setAttribute('smoothNormal', new THREE.BufferAttribute(smoothNormals(geo), 3));
      const hull = new THREE.Mesh(geo, new THREE.ShaderMaterial({
        vertexShader: HULL_VS, fragmentShader: HULL_FS, side: THREE.BackSide,
        uniforms: { resolution, width: { value: OUTLINE.silhouette }, color: line },
      }));
      const pts = hardEdgePoints(geo), r = ribbonArrays(pts), eg = new THREE.BufferGeometry();
      for (const [name, k] of [['position', 3], ['prev', 3], ['next', 3], ['side', 1], ['arc', 1], ['alpha', 1]]) eg.setAttribute(name, new THREE.BufferAttribute(r[name], k));
      eg.setIndex(r.index);
      const edgeMat = ribbonMaterial(resolution, { color: [0, 0, 0, 1], width: OUTLINE.edge });
      edgeMat.uniforms.color = line;
      Object.assign(edgeMat, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
      const edges = new THREE.Mesh(eg, edgeMat);
      for (const o of [hull, edges]) { o.frustumCulled = false; o.userData.outline = true; mesh.add(o); }
      g.add(mesh);
      meshes.push(mesh);
    }
    group.add(g);
    byName[link.name] = g;
  }
  group.updateMatrixWorld(true);
  return { group, byName, meshes, ramp, line };
}
// The theme's colours: each part its role's token, the outlines theirs.
export function styleRobot(robot, { parts, outline }) {
  for (const m of robot.meshes) m.material.color.set(hexOf(parts[m.userData.role]));
  robot.line.value.set(hexOf(outline));
}
export function applyPoses(robot, poses) {
  for (const [name, pose] of Object.entries(poses ?? {})) {
    const g = robot.byName[name];
    if (g && pose?.R && pose?.p) setMatrix(g.matrix, pose);
  }
  robot.group.updateMatrixWorld(true);
}
// The link under a point of the view (normalised device coordinates), by a
// ray cast on the CPU against the link meshes: its name, or null.
export function pickLink(camera, meshes, nx, ny) {
  const THREE = T(), ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
  const hit = ray.intersectObjects(meshes, false)[0];
  return hit ? { link: hit.object.userData.link, point: hit.point.toArray(), distance: hit.distance } : null;
}
// The bounding sphere of the robot (world): { center, radius }.
export function robotBounds(meshes) {
  const THREE = T(), box = new THREE.Box3(), b = new THREE.Box3();
  for (const m of meshes) {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    box.union(b.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld));
  }
  if (box.isEmpty()) return { center: [0, 0, 0], radius: 1 };
  const s = box.getBoundingSphere(new THREE.Sphere());
  return { center: s.center.toArray(), radius: Math.max(1e-3, s.radius) };
}

// ---- Canvas2D painter: the mesh triangles projected with the camera's
// matrices, each filled flat in its band of the key light (as the toon
// material bands it), back faces dropped, silhouettes and hard edges stroked
// in the outline colour, drawn far to near with the lines (paths, triads,
// axes) sorted among them.
// project: [x, y] pixels and the view depth, or null behind the eye.
export function projector(camera, w, h) {
  const THREE = T(), m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), e = m.elements;
  return (x, y, z) => {
    const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
    if (cw <= camera.near) return null;
    return [((e[0] * x + e[4] * y + e[8] * z + e[12]) / cw + 1) * 0.5 * w, (1 - (e[1] * x + e[5] * y + e[9] * z + e[13]) / cw) * 0.5 * h, cw];
  };
}

// ---- The view
export function createView3d(container, opts = {}) {
  const THREE = T();
  const root = document.createElement('div');
  root.className = 'v3d';
  root.tabIndex = 0;
  root.setAttribute('role', 'application');
  root.setAttribute('aria-label', '3D view: drag to orbit, right-drag or Shift-drag to pan, wheel to zoom, W A S D Q E to fly, 1 to 6 and 0 for the preset views, F to fit');
  root.innerHTML = `<canvas class="v3d-gl"></canvas><canvas class="v3d-cv" hidden></canvas><div class="v3d-labels"></div>
<div class="v3d-bar" role="toolbar" aria-label="Views"></div><canvas class="v3d-cube" width="1" height="1" aria-label="View cube"></canvas><canvas class="v3d-triad" width="1" height="1" aria-hidden="true"></canvas>
<div class="v3d-tip" hidden></div><div class="v3d-note" hidden>Canvas fallback</div>`;
  container.append(root);
  const q = (c) => root.querySelector(c);
  const glCanvas = q('.v3d-gl'), cvCanvas = q('.v3d-cv'), labelsEl = q('.v3d-labels'), bar = q('.v3d-bar'), cubeEl = q('.v3d-cube'), triadEl = q('.v3d-triad'), tip = q('.v3d-tip'), note = q('.v3d-note');

  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 100);
  // The key light turns with the camera, so the bands read the same from
  // every side.
  const key = new THREE.DirectionalLight(0xffffff, LIGHT.key), ambient = new THREE.AmbientLight(0xffffff, LIGHT.ambient);
  key.position.set(...LIGHT.dir);
  key.target.position.set(0, 0, 0);
  camera.add(key, key.target);
  scene.add(camera, ambient);
  const resolution = { value: new THREE.Vector2(1, 1) };
  const robot = buildRobot(opts.links, { resolution });
  scene.add(robot.group);
  const joints = opts.joints ?? [];
  const paths = new Map();
  let frames = [], theme = null, grid = null, axisLines = [], frameLines = [];
  let w = 1, h = 1, dpr = 1, renderer = null, ctx2d = null, mode = 'canvas', destroyed = false;
  let raf = 0, hover = null, cubeHover = null, anim = null;
  const held = new Set();

  // Where the view looks. The robot's extent, measured on its first poses
  // (before them every link is at the origin), scales the floor grid, the
  // axes, the triads and the dashes.
  let bounds = robotBounds(robot.meshes), posed = false;
  const cam0 = opts.camera ?? {};
  // A camera kept from before (its yaw and pitch) comes back as it was; else a preset view.
  let state = { target: cam0.target ?? bounds.center, distance: cam0.distance ?? fitDistance(bounds.radius), ...(Number.isFinite(cam0.yaw) && Number.isFinite(cam0.pitch) ? { yaw: cam0.yaw, pitch: cam0.pitch } : viewAngles(cam0.view ?? 'iso')) };

  // ---- Theme
  function readTheme() {
    // Each token resolved as the view sees it (its theme, light or dark),
    // through a probe inside it: a token may be light-dark(), which only the
    // computed colour settles.
    const probe = document.createElement('i');
    probe.hidden = true;
    root.append(probe);
    const tok = (name) => { probe.style.color = `var(${name})`; return parseColor(getComputedStyle(probe).color); };
    const bg = tok('--v3d-bg'), ink = tok('--ink');
    const dark = bg[0] + bg[1] + bg[2] < 3 * 128;
    theme = {
      bg, ink, dark, muted: tok('--ink-3'), panel: tok('--surface'),
      axis: [tok('--axis-x'), tok('--axis-y'), tok('--axis-z')],
      grid: mix(bg, ink, dark ? 0.12 : 0.08), gridMajor: mix(bg, ink, dark ? 0.24 : 0.18),
      ch: palette().ch.map(parseColor),
      parts: { light: tok('--part'), dark: tok('--part-dark'), accent: tok('--part-accent'), ruby: tok('--part-ruby') }, outline: tok('--part-line'),
    };
    probe.remove();
    // A yellow reference on a light ground reads better a little darker.
    if (!dark) theme.ch[0] = mix(theme.ch[0], ink, 0.35);
  }

  // ---- Lines: ribbons in WebGL, strokes in the painter
  const RIBBON_ATTRS = [['position', 3], ['prev', 3], ['next', 3], ['side', 1], ['arc', 1], ['alpha', 1]];
  // New points for a ribbon: written into its buffers when the count is the
  // same (a trail every frame), else into new ones.
  function setRibbon(mesh, points, alpha) {
    const r = ribbonArrays(points, alpha), g = mesh.geometry, line = mesh.userData.line;
    line.points = points; line.alpha = alpha;
    const same = g.attributes.position?.count === r.side.length;
    for (const [name, k] of RIBBON_ATTRS) {
      if (same) { g.attributes[name].array.set(r[name]); g.attributes[name].needsUpdate = true; }
      else g.setAttribute(name, new THREE.BufferAttribute(r[name], k));
    }
    if (same && g.index?.count === r.index.length) { g.index.array.set(r.index); g.index.needsUpdate = true; }
    else g.setIndex(new THREE.BufferAttribute(new Uint32Array(r.index), 1));
  }
  function ribbonMesh(points, alpha, { color, width, dash = 0, gap = 0, opacity = 1 }) {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), ribbonMaterial(resolution, { color, width, dash, gap, opacity }));
    mesh.frustumCulled = false;
    mesh.userData = { line: { points, alpha, color, width, dash, gap, opacity } };
    setRibbon(mesh, points, alpha);
    return mesh;
  }
  const drop = (m) => { if (!m) return; scene.remove(m); m.geometry.dispose(); m.material.dispose(); };

  // A path keeps its mesh while its style stays; new points go into it.
  function buildPath(id, restyle = false) {
    const p = paths.get(id), ref = p.spec.style !== 'actual';
    const pts = pathPoints(p.spec), { points, alpha } = thinPath(pts.points, pts.alpha, 40000);
    if (p.mesh && !restyle && p.ref === ref) { setRibbon(p.mesh, points, alpha); return; }
    drop(p.mesh);
    p.ref = ref;
    p.mesh = ribbonMesh(points, alpha, ref
      ? { color: theme.ch[0], width: 3.4, dash: p.spec.dash ?? bounds.radius * 0.022, gap: p.spec.gap ?? bounds.radius * 0.014 }
      : { color: theme.ch[1], width: 2 });
    p.mesh.renderOrder = ref ? 1 : 2;
    scene.add(p.mesh);
  }

  // Joint axes: a thin line through each joint along its axis, j1 … at its
  // positive end.
  function buildAxes(restyle = false) {
    if (restyle) { axisLines.forEach(drop); axisLines = []; }
    const len = bounds.radius * 0.16;
    joints.forEach((j, i) => {
      const g = robot.byName[j.child];
      const pose = g ? { R: matR(g.matrix), p: [g.matrix.elements[12], g.matrix.elements[13], g.matrix.elements[14]] } : identity;
      const a = unit(rot(pose.R, j.axis ?? [0, 0, 1]));
      const p0 = add(pose.p, scale(a, -len)), p1 = add(pose.p, scale(a, len)), pts = [...p0, ...p1];
      let m = axisLines[i];
      if (m) setRibbon(m, pts, null);
      else {
        m = axisLines[i] = ribbonMesh(pts, null, { color: theme.muted, width: 1.4, opacity: palette().alpha.over });
        m.renderOrder = 3;
        scene.add(m);
      }
      m.userData.end = p1;
    });
  }
  const matR = (m) => { const e = m.elements; return [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]]; };

  function buildFrames(restyle = false) {
    if (restyle || frameLines.length !== 3 * frames.length) { frameLines.forEach(drop); frameLines = []; }
    frames.forEach((f, i) => {
      const size = f.size ?? bounds.radius * 0.14;
      for (let k = 0; k < 3; k++) {
        const e = [0, 0, 0];
        e[k] = 1;
        const pts = [...f.p, ...add(f.p, scale(rot(f.R, e), size))];
        let m = frameLines[3 * i + k];
        if (m) { setRibbon(m, pts, null); continue; }
        m = frameLines[3 * i + k] = ribbonMesh(pts, null, { color: theme.axis[k], width: 2.6 });
        m.material.depthTest = false;   // a frame stays visible inside a link
        m.renderOrder = 4;
        scene.add(m);
      }
    });
  }

  // The floor: a grid in z = 0 under the robot, every fifth line stronger.
  function buildGrid() {
    if (grid) { scene.remove(grid); grid.children.forEach((c) => { c.geometry.dispose(); c.material.dispose(); }); }
    const stepM = niceStep(bounds.radius / 5), n = Math.ceil((bounds.radius * 1.5) / stepM), ext = n * stepM;
    const cx = Math.round(bounds.center[0] / stepM) * stepM, cy = Math.round(bounds.center[1] / stepM) * stepM;
    const minor = [], major = [];
    for (let i = -n; i <= n; i++) {
      const to = (i + Math.round(cx / stepM)) % 5 === 0 ? major : minor;
      to.push(cx + i * stepM, cy - ext, 0, cx + i * stepM, cy + ext, 0);
      const to2 = (i + Math.round(cy / stepM)) % 5 === 0 ? major : minor;
      to2.push(cx - ext, cy + i * stepM, 0, cx + ext, cy + i * stepM, 0);
    }
    grid = new THREE.Group();
    for (const [pts, col] of [[minor, theme.grid], [major, theme.gridMajor]]) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const ls = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: new THREE.Color(hexOf(col)), depthWrite: false }));
      ls.userData.grid = { pts, color: col };
      ls.renderOrder = -1;
      grid.add(ls);
    }
    scene.add(grid);
    scene.background = new THREE.Color(hexOf(theme.bg));
  }

  // ---- Labels: DOM elements placed by projection
  const labelEls = new Map();
  function label(key, text, cls) {
    let el = labelEls.get(key);
    if (!el) { el = document.createElement('div'); el.className = `v3d-label ${cls}`; labelsEl.append(el); labelEls.set(key, el); }
    if (el.textContent !== text) el.textContent = text;
    el.dataset.used = '1';
    return el;
  }
  function placeLabels(project) {
    for (const el of labelEls.values()) el.dataset.used = '';
    const put = (el, p) => {
      const s = project(...p);
      if (!s || s[0] < -20 || s[1] < -20 || s[0] > w + 20 || s[1] > h + 20) { el.hidden = true; return; }
      el.hidden = false;
      el.style.transform = `translate(${s[0].toFixed(1)}px, ${s[1].toFixed(1)}px)`;
    };
    frames.forEach((f, i) => put(label(`f${i}`, f.label ?? '', 'v3d-flabel'), f.p));
    axisLines.forEach((m, i) => { const el = label(`j${i}`, `j${i + 1}`, 'v3d-jlabel'); el.title = joints[i].name ?? ''; put(el, m.userData.end); });
    for (const [k, el] of labelEls) if (!el.dataset.used) { el.remove(); labelEls.delete(k); }
  }

  // ---- Rendering
  function setMode(m) {
    mode = m;
    glCanvas.hidden = m !== 'webgl';
    cvCanvas.hidden = m === 'webgl';
    note.hidden = m === 'webgl';
    root.dataset.mode = m;
    invalidate();
  }
  function startWebgl() {
    try {
      renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch { renderer = null; return false; }
    glCanvas.addEventListener('webglcontextlost', onLost);
    glCanvas.addEventListener('webglcontextrestored', onRestored);
    return true;
  }
  function onLost(e) { e.preventDefault(); setMode('canvas'); }
  function onRestored() { setMode('webgl'); }

  function resize() {
    const r = root.getBoundingClientRect();
    w = Math.max(1, Math.round(r.width)); h = Math.max(1, Math.round(r.height));
    dpr = Math.min(3, globalThis.devicePixelRatio || 1);
    resolution.value.set(w, h);
    if (renderer) { renderer.setPixelRatio(dpr); renderer.setSize(w, h, false); }
    cvCanvas.width = Math.round(w * dpr); cvCanvas.height = Math.round(h * dpr);
    for (const [el, px] of [[cubeEl, 104], [triadEl, 72]]) { el.width = px * dpr; el.height = px * dpr; }
    invalidate();
  }
  function invalidate() { if (!raf && !destroyed) raf = requestAnimationFrame(frame); }

  let lastT = 0;
  function frame(now) {
    raf = 0;
    const dt = Math.min(0.1, lastT ? (now - lastT) / 1000 : 0);
    lastT = now;
    if (anim) {
      const s = Math.min(1, (now - anim.t0) / anim.ms);
      state = { ...state, ...easeAngles(anim.from, anim.to, s) };
      if (s >= 1) anim = null;
    }
    if (held.size && dt > 0) state = flyBy(state, held, state.distance * (held.has('shift') ? 1.8 : 0.6) * dt);
    render();
    if (anim || held.size) raf = requestAnimationFrame(frame); else lastT = 0;
  }
  function render() {
    if (Math.min(3, globalThis.devicePixelRatio || 1) !== dpr) resize();
    placeCamera(camera, state, w / h);
    const project = projector(camera, w, h);
    if (mode === 'webgl' && renderer) renderer.render(scene, camera); else paint(project);
    placeLabels(project);
    drawGizmo();
    if (hover && !tip.hidden) tipText(hover);
  }

  const tmpColor = new THREE.Color();
  function paint(project) {
    const g = ctx2d ?? (ctx2d = cvCanvas.getContext('2d'));
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = cssOf(theme.bg);
    g.fillRect(0, 0, w, h);
    g.lineCap = 'round'; g.lineJoin = 'round';
    // The floor first: it lies under everything.
    if (grid) for (const ls of grid.children) {
      const { pts, color } = ls.userData.grid;
      g.strokeStyle = cssOf(color); g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i < pts.length; i += 6) {
        const a = project(pts[i], pts[i + 1], pts[i + 2]), b = project(pts[i + 3], pts[i + 4], pts[i + 5]);
        if (a && b) { g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
      }
      g.stroke();
    }
    // The light, in world coordinates: from the key light towards its target.
    const L = unit(sub(key.getWorldPosition(new THREE.Vector3()).toArray(), key.target.getWorldPosition(new THREE.Vector3()).toArray()));
    const items = [], outline = cssOf(theme.outline), eps = 1e-6 * state.distance;
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    for (const mesh of robot.meshes) {
      if (!mesh.visible) continue;
      const geo = mesh.userData.coarse, pos = geo.attributes.position, idx = geo.index, mw = mesh.matrixWorld;
      const mat = mesh.material, base = mat.color, em = mat.emissive;
      const nv = pos.count, wp = new Float64Array(nv * 3), sp = new Array(nv);
      for (let i = 0; i < nv; i++) {
        va.fromBufferAttribute(pos, i).applyMatrix4(mw);
        wp[3 * i] = va.x; wp[3 * i + 1] = va.y; wp[3 * i + 2] = va.z;
        sp[i] = project(va.x, va.y, va.z);
      }
      const n = idx ? idx.count : nv, depth = new Float64Array(n / 3).fill(NaN);   // NaN: not drawn
      for (let k = 0; k < n; k += 3) {
        const i0 = idx ? idx.getX(k) : k, i1 = idx ? idx.getX(k + 1) : k + 1, i2 = idx ? idx.getX(k + 2) : k + 2;
        const a = sp[i0], b = sp[i1], c = sp[i2];
        if (!a || !b || !c) continue;
        if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) >= 0) continue;   // turned away (y down)
        va.set(wp[3 * i0], wp[3 * i0 + 1], wp[3 * i0 + 2]); vb.set(wp[3 * i1], wp[3 * i1 + 1], wp[3 * i1 + 2]); vc.set(wp[3 * i2], wp[3 * i2 + 1], wp[3 * i2 + 2]);
        const nrm = vb.clone().sub(va).cross(vc.clone().sub(va)).normalize();
        const lit = (ambient.intensity + key.intensity * toonBand(nrm.x * L[0] + nrm.y * L[1] + nrm.z * L[2])) / Math.PI;
        tmpColor.copy(base).multiplyScalar(lit).add(em);
        tmpColor.r = Math.min(1, tmpColor.r); tmpColor.g = Math.min(1, tmpColor.g); tmpColor.b = Math.min(1, tmpColor.b);
        depth[k / 3] = (a[2] + b[2] + c[2]) / 3;
        items.push({ z: depth[k / 3], tri: [a, b, c], fill: tmpColor.getStyle(), alpha: mat.opacity });
      }
      // An edge between a drawn and a hidden triangle is the silhouette; one
      // between two drawn ones at a fold is a hard edge. Each is drawn just
      // after its nearer drawn triangle; a silhouette is stroked across its
      // edge, so 1.5 times the width shows about as much outside as WebGL's.
      const E = mesh.userData.edges;
      for (let e = 0; e < E.length; e += 5) {
        const a = sp[E[e]], b = sp[E[e + 1]], d0 = depth[E[e + 2]], d1 = E[e + 3] >= 0 ? depth[E[e + 3]] : NaN;
        const f0 = d0 === d0, f1 = d1 === d1;
        if (!a || !b || !(f0 || f1) || (f0 && f1 && !E[e + 4])) continue;
        const silhouette = f0 !== f1;
        items.push({ z: (f0 && f1 ? Math.min(d0, d1) : f0 ? d0 : d1) - eps, seg: [a, b], stroke: outline, width: silhouette ? 1.5 * OUTLINE.silhouette : OUTLINE.edge, alpha: mat.opacity, off: 0 });
      }
    }
    // Lines, cut into segments sorted with the triangles; a dashed line's
    // pattern runs on along it (its offset is the length drawn before). The
    // frame triads go on top, as in WebGL.
    const lineItems = (m, out) => {
      const L2 = m.userData.line, { points, alpha } = thinPath(L2.points, L2.alpha, 900);
      const col = cssOf([...L2.color.slice(0, 3), 1]);
      let run = 0;
      for (let j = 0; j + 1 < points.length / 3; j++) {
        const a = project(points[3 * j], points[3 * j + 1], points[3 * j + 2]), b = project(points[3 * j + 3], points[3 * j + 4], points[3 * j + 5]);
        if (!a || !b) continue;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]), off = run;
        run += len;
        const al = bandAlpha(alpha ? (alpha[j] + alpha[j + 1]) / 2 : 1) * L2.opacity * L2.color[3];
        if (al <= 0.004) continue;
        out.push({ z: Math.min(a[2], b[2]) - 1e-4 * state.distance, seg: [a, b], stroke: col, width: L2.width, alpha: al, dash: L2.dash > 0, off });
      }
    };
    for (const m of [...[...paths.values()].map((p) => p.mesh), ...axisLines]) if (m) lineItems(m, items);
    items.sort((p, q2) => q2.z - p.z);
    const top = [];
    frameLines.forEach((m) => lineItems(m, top));
    for (const it of [...items, ...top]) {
      g.globalAlpha = it.alpha;
      if (it.tri) {
        const [a, b, c] = it.tri;
        g.fillStyle = it.fill; g.strokeStyle = it.fill; g.lineWidth = 0.6;
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.closePath(); g.fill(); g.stroke();
      } else {
        g.strokeStyle = it.stroke; g.lineWidth = it.width;
        g.setLineDash(it.dash ? CANVAS_DASH : []);
        g.lineDashOffset = it.dash ? it.off : 0;
        g.lineCap = it.dash ? 'butt' : 'round';
        g.beginPath(); g.moveTo(it.seg[0][0], it.seg[0][1]); g.lineTo(it.seg[1][0], it.seg[1][1]); g.stroke();
      }
    }
    g.setLineDash([]);
    g.globalAlpha = 1;
  }

  // ---- The gizmo: the view cube (top right) and the axis triad (bottom
  // left), Canvas2D in both modes.
  function drawGizmo() {
    const basis = orbitBasis(state.yaw, state.pitch), t = theme;
    {
      const g = cubeEl.getContext('2d'), S = 104, half = 26, c = S / 2;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, S, S);
      const faces = CUBE_FACES.map((f) => ({ f, k: dot(f.n, basis.d) })).filter((x) => x.k > 1e-3).sort((a, b) => a.k - b.k);
      const P = (p) => { const [x, y] = cubeToScreen(basis, p, half); return [c + x, c + y]; };
      for (const { f, k } of faces) {
        const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, u]) => P(add(f.n, add(scale(f.a, s), scale(f.b, u)))));
        g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(...p) : g.moveTo(...p))); g.closePath();
        g.fillStyle = cssOf(mix(t.panel, t.dark ? [255, 255, 255, 1] : [255, 255, 255, 1], (t.dark ? 0.06 : 0.35) + 0.2 * k));
        g.fill();
        g.strokeStyle = cssOf([...t.muted.slice(0, 3), 0.9]); g.lineWidth = 1; g.stroke();
        if (cubeHover) {
          for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
            const dir = add(f.n, add(scale(f.a, i), scale(f.b, j)));
            if (dir.some((v, n) => v !== cubeHover[n])) continue;
            const cell = cubeCell(f, i, j).map(P);
            g.beginPath(); cell.forEach((p, n) => (n ? g.lineTo(...p) : g.moveTo(...p))); g.closePath();
            g.fillStyle = cssOf([...t.ch[2].slice(0, 3), 0.45]); g.fill();
          }
        }
        // The face's name, drawn in its plane.
        if (k > 0.25) {
          const [ox, oy] = P(f.n), [ax, ay] = cubeToScreen(basis, f.a, half), [bx, by] = cubeToScreen(basis, f.b, half);
          g.save();
          g.transform(ax / 26, ay / 26, -bx / 26, -by / 26, ox, oy);
          g.globalAlpha = Math.min(1, (k - 0.25) * 3);
          g.fillStyle = cssOf(t.ink); g.font = `600 ${f.label.length > 5 ? 8.5 : 9.5}px ${MONO()}`; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(f.label, 0, 0.5);
          g.restore();
        }
      }
    }
    {
      const g = triadEl.getContext('2d'), S = 72, c = S / 2, len = 24;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, S, S);
      const axes = [0, 1, 2].map((k) => { const e = [0, 0, 0]; e[k] = 1; return { k, x: dot(e, basis.r), y: -dot(e, basis.u), z: dot(e, basis.d) }; }).sort((a, b) => a.z - b.z);
      g.lineCap = 'round';
      for (const a of axes) {
        const col = cssOf(t.axis[a.k]);
        g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2.2;
        g.beginPath(); g.moveTo(c, c); g.lineTo(c + a.x * len, c + a.y * len); g.stroke();
        g.font = `600 11px ${MONO()}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('xyz'[a.k], c + a.x * (len + 8), c + a.y * (len + 8));
      }
    }
  }

  // ---- Interaction
  function setView(name, animate = true) {
    const to = name in VIEWS ? viewAngles(name) : null;
    if (to) goTo(to, animate);
  }
  function goTo(to, animate) {
    if (!animate) { anim = null; state = { ...state, ...to }; invalidate(); return; }
    anim = { from: { yaw: state.yaw, pitch: state.pitch }, to, t0: performance.now(), ms: 380 };
    invalidate();
  }
  function fit() {
    const b = robotBounds(robot.meshes);
    state = { ...state, target: b.center, distance: fitDistance(b.radius, w / h) };
    invalidate();
  }
  for (const [name, key, text] of [['iso', '0', 'Iso'], ['front', '1', 'Front'], ['back', '2', 'Back'], ['left', '3', 'Left'], ['right', '4', 'Right'], ['top', '5', 'Top'], ['bottom', '6', 'Bottom'], ['fit', 'F', 'Fit']]) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'v3d-btn'; b.textContent = text; b.title = `${name === 'fit' ? 'Fit the robot into the view' : `${text} view`} (${key})`;
    b.addEventListener('click', () => (name === 'fit' ? fit() : setView(name)));
    bar.append(b);
  }

  const ndc = (e) => { const r = root.getBoundingClientRect(); return [((e.clientX - r.left) / w) * 2 - 1, 1 - ((e.clientY - r.top) / h) * 2]; };
  let drag = null;
  function onDown(e) {
    if (e.target === cubeEl || bar.contains(e.target)) return;
    root.focus({ preventScroll: true });
    const panning = e.button === 1 || e.button === 2 || e.shiftKey;
    drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, panning, moved: false, id: e.pointerId };
    root.setPointerCapture?.(e.pointerId);
    anim = null;
    e.preventDefault();
  }
  function onMove(e) {
    if (drag && drag.id === e.pointerId) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 3) drag.moved = true;
      state = drag.panning ? panBy(state, dx, dy, h) : orbitBy(state, dx, dy);
      setTip(null);
      invalidate();
      return;
    }
    if (e.target === cubeEl || bar.contains(e.target)) { setTip(null); return; }
    const [nx, ny] = ndc(e);
    setTip(pickLink(camera, robot.meshes, nx, ny), e);
  }
  function onUp(e) {
    if (!drag || drag.id !== e.pointerId) return;
    const click = !drag.moved;
    drag = null;
    root.releasePointerCapture?.(e.pointerId);
    if (click && e.button === 0) {
      const [nx, ny] = ndc(e), hit = pickLink(camera, robot.meshes, nx, ny);
      opts.onPick?.(hit ? { link: hit.link } : null);
    }
  }
  function setTip(hit, e) {
    const link = hit?.link ?? null;
    if (link !== hover) {
      for (const m of robot.meshes) m.material.emissive.setScalar(m.userData.link === link ? (theme.dark ? 0.09 : 0.06) : 0);
      hover = link;
      root.style.cursor = link ? 'pointer' : '';
      invalidate();
    }
    if (!link) { tip.hidden = true; return; }
    tipText(link);
    tip.hidden = false;
    const r = root.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    tip.style.transform = `translate(${Math.min(x + 14, w - tip.offsetWidth - 4)}px, ${Math.max(4, y - tip.offsetHeight - 10)}px)`;
  }
  // The tooltip: the link's name and what the page says about it now.
  function tipText(link) {
    const extra = opts.linkInfo?.(link) ?? '', text = extra ? `${link}\n${extra}` : link;
    if (tip.textContent !== text) tip.textContent = text;
  }
  function onWheel(e) {
    e.preventDefault();
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? h : 1);
    const [nx, ny] = ndc(e);
    state = zoomAt(state, Math.exp(Math.max(-60, Math.min(60, dy)) * 0.0022), nx, ny, w / h, FOV, [bounds.radius * 0.02, bounds.radius * 200]);
    anim = null;
    invalidate();
  }
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k in FLY) { held.add(k); if (e.shiftKey) held.add('shift'); }
    else if (VIEW_KEYS[k]) setView(VIEW_KEYS[k]);
    else if (k === 'f') fit();
    else return;
    e.preventDefault(); e.stopPropagation();
    invalidate();
  }
  function onKeyUp(e) {
    const k = e.key.toLowerCase();
    if (k in FLY || k === 'shift') { held.delete(k); if (k === 'shift') held.delete('shift'); e.stopPropagation(); }
    if (![...held].some((x) => x in FLY)) held.clear();
  }
  const cubePoint = (e) => { const r = cubeEl.getBoundingClientRect(); return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2]; };
  function onCubeMove(e) {
    const hit = cubeHit(orbitBasis(state.yaw, state.pitch), ...cubePoint(e), 26);
    const dir = hit?.dir ?? null;
    if (String(dir) !== String(cubeHover)) { cubeHover = dir; invalidate(); }
    cubeEl.style.cursor = dir ? 'pointer' : '';
  }
  function onCubeClick(e) {
    const hit = cubeHit(orbitBasis(state.yaw, state.pitch), ...cubePoint(e), 26);
    if (hit) goTo(dirAngles(hit.dir, Math.abs(hit.dir[2]) === 1 && !hit.dir[0] && !hit.dir[1] ? -Math.PI / 2 : state.yaw), true);
  }

  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);
  root.addEventListener('pointerleave', () => { if (!drag) setTip(null); });
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  root.addEventListener('wheel', onWheel, { passive: false });
  root.addEventListener('keydown', onKey);
  root.addEventListener('keyup', onKeyUp);
  root.addEventListener('blur', () => held.clear());
  cubeEl.addEventListener('pointermove', onCubeMove);
  cubeEl.addEventListener('pointerleave', () => { cubeHover = null; invalidate(); });
  cubeEl.addEventListener('click', onCubeClick);
  const ro = new ResizeObserver(resize);
  ro.observe(root);
  const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  const onTheme = () => view.refreshTheme();
  media?.addEventListener?.('change', onTheme);
  const mo = new MutationObserver(onTheme);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });

  // Everything drawn in the theme's colours or at the robot's scale.
  function restyle() {
    styleRobot(robot, theme);
    buildGrid();
    buildAxes(true);
    buildFrames(true);
    for (const id of paths.keys()) buildPath(id, true);
  }
  readTheme();
  restyle();
  setMode(opts.renderer !== 'canvas' && startWebgl() ? 'webgl' : 'canvas');
  resize();

  const view = {
    get mode() { return mode; },
    setPoses(poses) {
      applyPoses(robot, poses);
      if (!posed) {
        posed = true;
        bounds = robotBounds(robot.meshes);
        if (!cam0.target) state = { ...state, target: bounds.center };
        if (!cam0.distance) state = { ...state, distance: fitDistance(bounds.radius, w / h) };
        restyle();
      } else buildAxes();
      invalidate();
    },
    setPath(id, spec) {
      if (!spec) { drop(paths.get(id)?.mesh); paths.delete(id); invalidate(); return; }
      const p = paths.get(id) ?? {};
      p.spec = spec;
      paths.set(id, p);
      buildPath(id);
      invalidate();
    },
    setFrames(list) { frames = list ?? []; buildFrames(); invalidate(); },
    setView,
    fit,
    // Draws now (else at the next animation frame); for pictures and timing.
    renderNow() { if (raf) { cancelAnimationFrame(raf); raf = 0; } render(); },
    // Where a world point is in the view (CSS pixels from its top left), or
    // null behind the eye.
    screenOf(p) { placeCamera(camera, state, w / h); const s = projector(camera, w, h)(...p); return s && [s[0], s[1]]; },
    get camera() { return { target: [...state.target], distance: state.distance, yaw: state.yaw, pitch: state.pitch }; },
    refreshTheme() { readTheme(); restyle(); invalidate(); },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect(); mo.disconnect(); media?.removeEventListener?.('change', onTheme);
      scene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); o.userData?.coarse?.dispose(); });
      robot.ramp.dispose();
      renderer?.dispose();
      root.remove();
    },
  };
  return view;
}
