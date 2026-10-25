// The robot blocks (design/output/robot.md §1, §3): they read the robot
// named in their robot parameter from the diagram's robots map. Each is a
// block of vectors.js's kind: ports, widths and make (see vectors.js).
//
// q, q̇ and q̈ are n wide (the robot's joints); a pose is p (3) and R (9, row
// by row, base ← frame); a Jacobian is 6×n, rows v then ω. Each block keeps
// its buffers from make() on, so a call allocates nothing; blocks of one
// robot share its rigid-body workspace (ctx.rbd), whose kinematics are
// cached by q.

import { cholesky, cholSolve } from './rbd.js';
import { rpyMatrix } from './urdf.js';

const DEG = Math.PI / 180;

// ---- Parameters

const ROBOT = { key: 'robot', label: 'Robot', default: 'puma560', kind: 'robot', help: "the robot's name in the diagram's robots" };
const FRAME = { key: 'frame', label: 'Frame', default: '', kind: 'link', help: "a link of the robot; empty: its last link (the PUMA's flange)" };
const ARMATURE = { key: 'armature', label: 'Armature', default: 0, kind: 'value', unit: 'kg·m²', help: "rotor inertia at each joint (G²·Jm), on M's diagonal: a number or one per joint" };
const SCALE = { key: 'scale', label: 'Mass scale', default: 1, unit: '1', help: "multiplies every link's mass and inertia (a model that is wrong on purpose)" };

const parseList = (v, where) => {
  if (typeof v === 'string' && v.trim().startsWith('[')) { try { v = JSON.parse(v); } catch { throw new Error(`${where}: a number or a list [1, 2, 3]`); } }
  return v;
};
const P = {
  robot(v, where) {
    const s = String(v ?? '').trim();
    if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(s)) throw new Error(`${where}: a robot's name such as puma560 (letters, digits, _)`);
    return s;
  },
  frame(v, where) {
    const s = String(v ?? '').trim();
    if (s.length > 64 || /[<>"{}]/.test(s)) throw new Error(`${where}: the name of one of the robot's links, or empty for its last`);
    return s;
  },
  armature(v, where) {
    v = parseList(v, where);
    const list = Array.isArray(v) ? v.map(Number) : [Number(v)];
    if (!list.length || !list.every((x) => Number.isFinite(x) && x >= 0)) throw new Error(`${where}: a number or a list, each at least 0 (kg·m²)`);
    return Array.isArray(v) ? list : list[0];
  },
  positive: (what) => (v, where) => {
    const x = Number(v);
    if (!(Number.isFinite(x) && x > 0)) throw new Error(`${where}: ${what}, above 0`);
    return x;
  },
};
P.scale = P.positive('a factor such as 1 or 0.8');

// normalize() from a parser per key (the parameter's own default when absent).
function normalizer(params, parsers) {
  return (p = {}, where = 'block') => Object.fromEntries(params.map((s) => [s.key, parsers[s.key](p[s.key] ?? s.default, `${where}.${s.key}`)]));
}

// The frame's link: the one named, or the robot's last.
const linkOf = (model, frame) => frame || model.links[model.links.length - 1].name;

// Widths of a block whose inputs are each n wide: a sentence naming both
// sides when one is not (a width-1 input broadcasts).
function jointWidths(p, inW, env, names, outs) {
  const model = env.robot(p.robot), n = model.n;
  inW.forEach((w, k) => {
    if (w !== undefined && w !== n && w !== 1) throw new Error(`${env.name}: ${names[k]} has ${w} element${w === 1 ? '' : 's'}; ${p.robot} has ${n} joints`);
  });
  if (p.frame !== undefined && !model.frames.has(linkOf(model, p.frame))) throw new Error(`${env.name}: ${p.robot} has no link "${p.frame}" (its links: ${model.links.map((l) => l.name).join(', ')})`);
  if (Array.isArray(p.armature) && p.armature.length !== n) throw new Error(`${env.name}: armature has ${p.armature.length} values; ${p.robot} has ${n} joints`);
  return { ins: names.map(() => n), outs: outs(n) };
}

// A block of the Robot group with inputs of n each: its def from its
// parameters' parsers, its group names and its outputs' widths.
function robotBlock({ label, formula, params, parsers, ins, outs, outW, make, ...rest }) {
  return {
    label, group: 'Robot', formula, params,
    inputs: () => ins, outputs: () => outs,
    normalize: normalizer(params, { robot: P.robot, frame: P.frame, armature: P.armature, scale: P.scale, ...parsers }),
    ports: () => [ins.length, outs.length],
    widths: (p, inW, env) => jointWidths(p, inW, env, ins, outW),
    make, ...rest,
  };
}

// The rigid-body options a block passes, canonical so that blocks with the
// same robot and options share one workspace.
function dynOpts(p, { armature = true } = {}) {
  const o = {};
  if (armature && (Array.isArray(p.armature) ? p.armature.some((x) => x !== 0) : p.armature !== 0)) o.armature = p.armature;
  if (p.scale !== 1) o.scale = p.scale;
  return o;
}

// Copies of q, q̇, q̈ from the inputs (group k of n); a width-1 input arrives
// already broadcast by the pass.
function reader(n, groups) {
  const bufs = Array.from({ length: groups }, () => new Float64Array(n));
  return { bufs, read(u) { for (let g = 0; g < groups; g++) { const b = bufs[g], o = g * n; for (let i = 0; i < n; i++) b[i] = u[o + i]; } } };
}

// ---- Allocation-free forms of rbd.js's helpers (the same arithmetic, so
// the same results to the bit).

// The eigenvalues of a symmetric m×m matrix (in a, overwritten) by cyclic
// Jacobi rotations, as rbd.symEig: returns the smallest.
function smallestEig(a, m) {
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0, diag = 0;
    for (let p = 0; p < m; p++) { diag += a[p * m + p] ** 2; for (let q = p + 1; q < m; q++) off += a[p * m + q] ** 2; }
    if (off === 0 || off <= 1e-32 * diag) break;
    for (let p = 0; p < m - 1; p++) {
      for (let q = p + 1; q < m; q++) {
        const apq = a[p * m + q];
        if (apq === 0) continue;
        const th = (a[q * m + q] - a[p * m + p]) / (2 * apq);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < m; k++) { const x = a[k * m + p], y = a[k * m + q]; a[k * m + p] = c * x - s * y; a[k * m + q] = s * x + c * y; }
        for (let k = 0; k < m; k++) { const x = a[p * m + k], y = a[q * m + k]; a[p * m + k] = c * x - s * y; a[q * m + k] = s * x + c * y; }
      }
    }
  }
  let min = Infinity;
  for (let i = 0; i < m; i++) min = Math.min(min, a[i * m + i]);
  return min;
}

// rbd.orientationError into e (3); returns θ. Re is a 9-element workspace.
function orientationInto(Rd, R, e, Re, od = 0, o = 9) {
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) Re[3 * i + j] = Rd[od + 3 * i] * R[o + 3 * j] + Rd[od + 3 * i + 1] * R[o + 3 * j + 1] + Rd[od + 3 * i + 2] * R[o + 3 * j + 2];
  const E = Re, t = E[0] + E[4] + E[8];
  let eta, x, y, z;
  if (t >= E[0] && t >= E[4] && t >= E[8]) {
    const s = Math.sqrt(1 + t) * 2; eta = s / 4; x = (E[7] - E[5]) / s; y = (E[2] - E[6]) / s; z = (E[3] - E[1]) / s;
  } else if (E[0] >= E[4] && E[0] >= E[8]) {
    const s = Math.sqrt(1 + E[0] - E[4] - E[8]) * 2; eta = (E[7] - E[5]) / s; x = s / 4; y = (E[1] + E[3]) / s; z = (E[2] + E[6]) / s;
  } else if (E[4] >= E[8]) {
    const s = Math.sqrt(1 + E[4] - E[0] - E[8]) * 2; eta = (E[2] - E[6]) / s; x = (E[1] + E[3]) / s; y = s / 4; z = (E[5] + E[7]) / s;
  } else {
    const s = Math.sqrt(1 + E[8] - E[0] - E[4]) * 2; eta = (E[3] - E[1]) / s; x = (E[2] + E[6]) / s; y = (E[5] + E[7]) / s; z = s / 4;
  }
  if (eta < 0) { eta = -eta; x = -x; y = -y; z = -z; }
  e[0] = x; e[1] = y; e[2] = z;
  return 2 * Math.atan2(Math.hypot(x, y, z), eta);
}

const fmtDeg = (x) => { const v = Math.round((x / DEG) * 10) / 10; return `${v < 0 ? '−' : ''}${Math.abs(v)}`; };

// ---- The blocks

export const ROBOT_BLOCKS = {
  forwardKinematics: robotBlock({
    label: 'Forward kinematics', formula: 'q → p, R', params: [ROBOT, FRAME],
    summary: (p) => `q → p, R (base ← ${p.frame || 'tool'})`,
    ins: ['q'], outs: ['p', 'R'], outW: () => [3, 9],
    make(p, ctx) {
      const model = ctx.robot(p.robot), r = ctx.rbd(p.robot), n = model.n;
      const f = model.frames.get(linkOf(model, p.frame)), i = f.body, { R: Rw, o } = r.poses;
      const { bufs: [q], read } = reader(n, 1);
      return (u, y) => {
        read(u);
        r.fk(q);
        if (i < 0) { for (let k = 0; k < 3; k++) y[k] = f.p[k]; for (let k = 0; k < 9; k++) y[3 + k] = f.R[k]; return; }
        // As rbd.linkPose: the body's pose times the link's pose in it.
        for (let a = 0; a < 3; a++) {
          const a0 = Rw[9 * i + 3 * a], a1 = Rw[9 * i + 3 * a + 1], a2 = Rw[9 * i + 3 * a + 2];
          for (let c = 0; c < 3; c++) y[3 + 3 * a + c] = a0 * f.R[c] + a1 * f.R[3 + c] + a2 * f.R[6 + c];
          y[a] = o[3 * i + a] + a0 * f.p[0] + a1 * f.p[1] + a2 * f.p[2];
        }
      };
    },
  }),
  jacobian: robotBlock({
    label: 'Jacobian', formula: 'J_j = [z_j × (p − o_j); z_j]',
    params: [ROBOT, FRAME, { key: 'expressedIn', label: 'Expressed in', default: 'base', kind: 'choice', options: ['base', 'frame'], help: "the base's axes (jacob0) or the frame's (jacobn)" }],
    parsers: { expressedIn(v, where) { const s = String(v).trim(); if (s !== 'base' && s !== 'frame') throw new Error(`${where}: base or frame`); return s; } },
    ins: ['q'], outs: ['J'], outW: (n) => [6 * n],
    make(p, ctx) {
      const model = ctx.robot(p.robot), r = ctx.rbd(p.robot), link = linkOf(model, p.frame);
      const { bufs: [q], read } = reader(model.n, 1), J = new Float64Array(6 * model.n);
      return (u, y) => { read(u); r.jacobian(q, link, J, p.expressedIn); for (let k = 0; k < J.length; k++) y[k] = J[k]; };
    },
  }),
  jdotqd: robotBlock({
    label: 'J̇q̇', formula: 'J̇·q̇: the acceleration with q̈ = 0', params: [ROBOT, FRAME],
    ins: ['q', 'q̇'], outs: ['J̇q̇'], outW: () => [6],
    make(p, ctx) {
      const model = ctx.robot(p.robot), r = ctx.rbd(p.robot), link = linkOf(model, p.frame);
      const { bufs: [q, qd], read } = reader(model.n, 2), out = new Float64Array(6);
      return (u, y) => { read(u); r.jdotqd(q, qd, link, out); for (let k = 0; k < 6; k++) y[k] = out[k]; };
    },
  }),
  massMatrix: robotBlock({
    label: 'Mass matrix', formula: 'M(q) (composite rigid bodies)', params: [ROBOT, ARMATURE, SCALE],
    ins: ['q'], outs: ['M'], outW: (n) => [n * n],
    make(p, ctx) {
      const n = ctx.robot(p.robot).n, r = ctx.rbd(p.robot, dynOpts(p));
      const { bufs: [q], read } = reader(n, 1), M = new Float64Array(n * n);
      return (u, y) => { read(u); r.massMatrix(q, M); for (let k = 0; k < M.length; k++) y[k] = M[k]; };
    },
  }),
  biasForces: robotBlock({
    label: 'Bias forces', formula: 'h = C(q, q̇)·q̇ + g(q)', params: [ROBOT, SCALE],
    ins: ['q', 'q̇'], outs: ['h'], outW: (n) => [n],
    make(p, ctx) {
      const n = ctx.robot(p.robot).n, r = ctx.rbd(p.robot, dynOpts(p, { armature: false }));
      const { bufs: [q, qd], read } = reader(n, 2), h = new Float64Array(n);
      return (u, y) => { read(u); r.bias(q, qd, h); for (let k = 0; k < n; k++) y[k] = h[k]; };
    },
  }),
  inverseDynamics: robotBlock({
    label: 'Inverse dynamics', formula: 'τ = M(q)·q̈ + C(q, q̇)·q̇ + g(q)', params: [ROBOT, ARMATURE, SCALE],
    ins: ['q', 'q̇', 'q̈'], outs: ['τ'], outW: (n) => [n],
    make(p, ctx) {
      const n = ctx.robot(p.robot).n, r = ctx.rbd(p.robot, dynOpts(p));
      const { bufs: [q, qd, qdd], read } = reader(n, 3), tau = new Float64Array(n);
      return (u, y) => { read(u); r.rnea(q, qd, qdd, tau); for (let k = 0; k < n; k++) y[k] = tau[k]; };
    },
  }),
  torqueSplit: robotBlock({
    label: 'Torque split', formula: 'τ = M·q̈ + C·q̇ + g', params: [ROBOT, ARMATURE, SCALE],
    ins: ['q', 'q̇', 'q̈'], outs: ['inertial', 'coriolis', 'gravity'], outW: (n) => [n, n, n],
    make(p, ctx) {
      const n = ctx.robot(p.robot).n, r = ctx.rbd(p.robot, dynOpts(p));
      const { bufs: [q, qd, qdd], read } = reader(n, 3), M = new Float64Array(n * n), c = new Float64Array(n), g = new Float64Array(n);
      return (u, y) => {
        read(u);
        r.massMatrix(q, M);
        for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += M[i * n + j] * qdd[j]; y[i] = s; }
        r.rnea(q, qd, null, c, { gravity: false });
        r.gravityTorque(q, g);
        for (let i = 0; i < n; i++) { y[n + i] = c[i]; y[2 * n + i] = g[i]; }
      };
    },
  }),
  dampedInverse: {
    label: 'Damped inverse', group: 'Robot', formula: 'J⁺ = Jᵀ(JJᵀ + λ²I)⁻¹',
    params: [
      { key: 'eps', label: 'ε', default: 0.04, help: 'below this σ_min the inverse is damped' },
      { key: 'lambdaMax', label: 'λ_max', default: 0.05, help: 'the damping at σ_min = 0' },
      { key: 'rows', label: 'Rows', default: 6, help: "J's rows m (6: v and ω; 3: v only)" },
    ],
    inputs: () => ['J'], outputs: () => ['J⁺', 'σ_min'],
    normalize(p = {}, where = 'block') {
      const out = { eps: P.positive('a singular value such as 0.04')(p.eps ?? 0.04, `${where}.eps`), lambdaMax: P.positive('a damping such as 0.05')(p.lambdaMax ?? 0.05, `${where}.lambdaMax`), rows: Number(p.rows ?? 6) };
      if (!(Number.isInteger(out.rows) && out.rows >= 1 && out.rows <= 64)) throw new Error(`${where}.rows: a whole number of rows, 1 to 64`);
      return out;
    },
    ports: () => [1, 2],
    widths(p, inW, env) {
      const w = inW[0], m = p.rows;
      if (w === undefined) return null;
      if (w === 1 && !env.wired?.(0)) return { ins: [m * m], outs: [m * m, 1] };   // open: a 0 of each width
      if (w % m) throw new Error(`${env.name}: J has ${w} elements, not a whole number of rows of ${m} (rows ${m})`);
      return { ins: [w], outs: [w, 1] };
    },
    make(p, ctx) {
      // As rbd.dampedInverse: σ_min from the eigenvalues of J·Jᵀ, then one
      // Cholesky factorisation and a solve per column of J.
      const m = p.rows, n = ctx.inW[0] / m, eps = p.eps, lmax2 = p.lambdaMax ** 2;
      const A = new Float64Array(m * m), E = new Float64Array(m * m), col = new Float64Array(m);
      return (u, y) => {
        for (let i = 0; i < m; i++) for (let j = 0; j <= i; j++) { let s = 0; for (let k = 0; k < n; k++) s += u[i * n + k] * u[j * n + k]; A[i * m + j] = s; A[j * m + i] = s; }
        E.set(A);
        const sigma = Math.sqrt(Math.max(0, smallestEig(E, m)));
        const lambda2 = sigma < eps ? lmax2 * (1 - (sigma / eps) ** 2) : 0;
        for (let i = 0; i < m; i++) A[i * m + i] += lambda2;
        y[n * m] = sigma;
        if (!cholesky(A, m)) { y.fill(NaN, 0, n * m); return; }
        for (let k = 0; k < n; k++) {
          for (let i = 0; i < m; i++) col[i] = u[i * n + k];
          cholSolve(A, m, col);
          for (let i = 0; i < m; i++) y[k * m + i] = col[i];
        }
      };
    },
  },
  orientationError: {
    label: 'Orientation error', group: 'Robot', formula: 'R_e = R_d·Rᵀ → e_o, θ', params: [],
    inputs: () => ['R_d', 'R'], outputs: () => ['e_o', 'θ'],
    normalize: () => ({}),
    ports: () => [2, 2],
    widths(p, inW, env) {
      inW.forEach((w, k) => { if (w !== undefined && w !== 9 && !(w === 1 && !env.wired?.(k))) throw new Error(`${env.name}: ${k ? 'R' : 'R_d'} has ${w} element${w === 1 ? '' : 's'}; a rotation has 9 (3×3, row by row)`); });
      return { ins: [9, 9], outs: [3, 1] };
    },
    make() {
      const Re = new Float64Array(9);
      return (u, y) => { y[3] = orientationInto(u, u, y, Re, 0, 9); };
    },
  },
  frameTransform: {
    label: 'Frame transform', group: 'Robot', formula: 'x_base = o + R·x',
    summary: (p) => (p.inverse ? 'x = Rᵀ(x_base − o)' : 'x_base = o + R·x'),
    params: [
      { key: 'rpy', label: 'Rotation rpy', default: [0, 0, 0], kind: 'value', unit: 'rad', help: 'roll, pitch, yaw: R = Rz(yaw)·Ry(pitch)·Rx(roll)' },
      { key: 'groups', label: 'Groups', default: 'p,v,a', kind: 'text', help: 'one per input: p a point (moved by o), v or a a direction' },
      { key: 'inverse', label: 'Inverse', default: 0, help: '1: from the base into the frame' },
    ],
    inputs: (p) => [...String(p.groups).split(','), 'o'],
    outputs: (p) => String(p.groups).split(','),
    normalize(p = {}, where = 'block') {
      const rpy = parseList(p.rpy ?? [0, 0, 0], `${where}.rpy`);
      if (!(Array.isArray(rpy) && rpy.length === 3 && rpy.map(Number).every(Number.isFinite))) throw new Error(`${where}.rpy: three angles [roll, pitch, yaw] in rad`);
      const groups = String(p.groups ?? 'p,v,a').split(',').map((s) => s.trim());
      if (!(groups.length >= 1 && groups.length <= 8 && groups.every((g) => g === 'p' || g === 'v' || g === 'a'))) throw new Error(`${where}.groups: one to eight of p (a point), v and a (directions), such as "p,v,a"`);
      return { rpy: rpy.map(Number), groups: groups.join(','), inverse: Number(p.inverse ?? 0) ? 1 : 0 };
    },
    ports: (p) => { const k = String(p.groups).split(',').length; return [k + 1, k]; },
    widths(p, inW, env) {
      const names = [...String(p.groups).split(','), 'o'];
      inW.forEach((w, k) => { if (w !== undefined && w !== 3 && w !== 1) throw new Error(`${env.name}: ${names[k]} has ${w} elements; a vector in 3D has 3`); });
      return { ins: names.map(() => 3), outs: names.slice(1).map(() => 3) };
    },
    make(p) {
      const R = rpyMatrix(...p.rpy), pts = String(p.groups).split(',').map((g) => g === 'p'), k = pts.length, inv = p.inverse, oo = 3 * k;
      return (u, y) => {
        const ox = u[oo], oy = u[oo + 1], oz = u[oo + 2];
        for (let g = 0; g < k; g++) {
          const b = 3 * g;
          let x = u[b], v = u[b + 1], w = u[b + 2];
          if (inv) {
            if (pts[g]) { x -= ox; v -= oy; w -= oz; }
            for (let r = 0; r < 3; r++) y[b + r] = R[r] * x + R[3 + r] * v + R[6 + r] * w;
          } else {
            for (let r = 0; r < 3; r++) y[b + r] = R[3 * r] * x + R[3 * r + 1] * v + R[3 * r + 2] * w;
            if (pts[g]) { y[b] += ox; y[b + 1] += oy; y[b + 2] += oz; }
          }
        }
      };
    },
  },
  jointLimits: robotBlock({
    label: 'Joint limits', formula: "reports a joint leaving the URDF's limits",
    params: [ROBOT, { key: 'check', label: 'Check', default: 'position,velocity', kind: 'text', help: 'position (lower … upper), velocity (|q̇| up to the limit), or both' }],
    parsers: {
      check(v, where) {
        const list = String(v).split(',').map((s) => s.trim()).filter(Boolean);
        if (!list.length || !list.every((s) => s === 'position' || s === 'velocity')) throw new Error(`${where}: position, velocity, or "position,velocity"`);
        return [...new Set(list)].join(',');
      },
    },
    ins: ['q', 'q̇'], outs: [], outW: () => [],
    // Each joint and kind once per compile, at the first sample beyond it;
    // in a design's model it checks nothing (a Terminator).
    make(p, ctx) {
      if (ctx.model) return () => {};
      const J = ctx.robot(p.robot).joints, n = J.length, pos = p.check.includes('position'), vel = p.check.includes('velocity');
      const told = new Uint8Array(2 * n);
      return (u, y, t) => {
        for (let j = 0; j < n; j++) {
          const lim = J[j], q = u[j], qd = u[n + j];
          if (pos && !told[j] && (q < lim.lower || q > lim.upper)) {
            told[j] = 1;
            ctx.report(`${lim.name} left its range (${fmtDeg(lim.lower)} … ${fmtDeg(lim.upper)}°) at ${t.toFixed(2)} s: the real arm stops there`);
          }
          if (vel && !told[n + j] && lim.velocity > 0 && Math.abs(qd) > lim.velocity) {
            told[n + j] = 1;
            ctx.report(`${lim.name} is faster than its limit (${lim.velocity} rad/s) at ${t.toFixed(2)} s`);
          }
        }
      };
    },
  }),
};
