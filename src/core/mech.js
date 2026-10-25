// Mechanics (design/output/transparent-models.md §1.1): planar parts joined
// at frame ports, compiled to one state node per mechanism.
//
// Parts: World (the fixed ground, gravity −g·ŷ), Rail (a prismatic joint:
// coordinate s, rate ṡ; follower = base + s·(cos α, sin α)), Hinge (a
// revolute joint: θ, the follower's angle from upright, positive towards +x),
// Mass (a point mass at its frame) and Rod (tip = base + l·(sin φ, cos φ),
// its mass at the tip or spread uniformly). A diagram's "joins" list the
// points where frame ports meet: [["world:W", "rail:B"], ["rail:F", "cart:F", "hinge:B"], …].
//
// The class handled: trees rooted at one World, rails on parts that do not
// turn, hinge angles absolute. Every body's position is then
//   p_b = c_b + Σ_p P_bp·s_p·d_p + Σ_j L_bj·(sin θ_j, cos θ_j)
// with constant directions d_p and lengths L_bj, so M(q) and the generalised
// forces Q are built from constants and one sin and one cos per hinge, and
// M(q)·q̈ = Q is solved by LDLᵀ without pivoting (M is positive definite:
// every joint must move mass).

import { NAME_RE, isReserved } from './formula.js';

const num = (key, label, def, extra = {}) => ({ key, label, default: def, ...extra });
const coord = (key, label, def) => ({ key, label, default: def, kind: 'coord' });

// The parts, as diagram elements (diagram.js puts them in ELEMENTS). frames:
// the frame ports, base first (B), then the follower (F, T); W for the World.
export const MECH_ELEMENTS = {
  world: { label: 'World', group: 'Mechanics', formula: 'g ↓', part: true, frames: () => ['W'], params: [num('g', 'g', 9.81, { unit: 'm/s²' })], ports: () => [0, 0] },
  rail: {
    label: 'Rail', group: 'Mechanics', formula: 'F − b·v', part: true, joint: true, frames: () => ['B', 'F'],
    params: [coord('name', 'Coordinate', 'x'), coord('rate', 'Rate', 'v'), num('b', 'Friction b', 0, { unit: 'N·s/m', min: 0 }), num('incline', 'Incline α', 0, { unit: 'rad' }),
      num('x0', 'Start s₀', 0, { unit: 'm' }), num('v0', 'Start ṡ₀', 0, { unit: 'm/s' }), num('force', 'Force input (0/1)', 1, { int: true, min: 0, max: 1 })],
    ports: (p) => [p.force ? 1 : 0, 2], outputs: (p) => [p.name, p.rate], inputNames: (p) => (p.force ? ['F'] : []),
  },
  hinge: {
    label: 'Hinge', group: 'Mechanics', formula: 'θ from upright', part: true, joint: true, frames: () => ['B', 'F'],
    params: [coord('name', 'Coordinate', 'θ'), coord('rate', 'Rate', 'ω'), num('c', 'Damping c', 0, { unit: 'N·m·s/rad', min: 0 }),
      num('theta0', 'Start θ₀', 0, { unit: 'rad' }), num('omega0', 'Start ω₀', 0, { unit: 'rad/s' }), num('torque', 'Torque input (0/1)', 0, { int: true, min: 0, max: 1 })],
    ports: (p) => [p.torque ? 1 : 0, 2], outputs: (p) => [p.name, p.rate], inputNames: (p) => (p.torque ? ['τ'] : []),
  },
  mass: { label: 'Mass', group: 'Mechanics', formula: 'm', part: true, frames: () => ['F'], params: [num('m', 'Mass m', 1, { unit: 'kg', min: 0 })], ports: () => [0, 0] },
  rod: {
    label: 'Rod', group: 'Mechanics', formula: 'l, m at tip', part: true, frames: () => ['B', 'T'],
    params: [num('l', 'Length l', 0.5, { unit: 'm', min: 0 }), num('m', 'Mass m', 0, { unit: 'kg', min: 0 }), { key: 'at', label: 'Mass at', default: 'tip', kind: 'choice', options: ['tip', 'uniform'] }],
    ports: () => [0, 0],
  },
};
export const isPart = (type) => Object.hasOwn(MECH_ELEMENTS, type);

// A coordinate's name: short, Greek letters too (θ1, ω1).
export function checkCoord(v, where) {
  const s = String(v ?? '').trim();
  if (!NAME_RE.test(s) || s.length > 8) throw new Error(`${where}: a short name such as x, θ1 or ω1 (letters, digits, _)`);
  if (isReserved(s)) throw new Error(`${where}: "${s}" is the time, a constant or a function; choose another name`);
  return s;
}

const label = (b) => `'${b.name ?? b.id}'`;
const err = (message, blocks) => Object.assign(new Error(message), { code: 'mechanism', blocks });

// A join's port "id:P" as { id, port }.
export function parseFrame(end) {
  const s = String(end), at = s.lastIndexOf(':');
  return at < 0 ? { id: s, port: '' } : { id: s.slice(0, at), port: s.slice(at + 1) };
}

// Checks a diagram level's joins against its blocks; returns them as written
// (lists of "id:P"). Each port in one join at most; a join of two ports or more.
export function normalizeJoins(joins, blocks, path) {
  if (joins === undefined || joins === null) return undefined;
  if (!Array.isArray(joins)) throw new Error(`${path}.joins: a list of joins, each a list of frame ports such as ["world:W", "rail:B"]`);
  const byId = new Map(blocks.map((b) => [b.id, b])), used = new Map();
  return joins.map((j, i) => {
    const at = `${path}.joins[${i}]`;
    if (!Array.isArray(j) || j.length < 2) throw new Error(`${at}: a join holds two frame ports or more`);
    return j.map((end) => {
      const { id, port } = parseFrame(end), b = byId.get(id);
      if (!b) throw new Error(`${at}: no block "${id}"`);
      const frames = MECH_ELEMENTS[b.type]?.frames(b.params) ?? [];
      if (!frames.includes(port)) throw new Error(`${at}: ${label(b)} has no frame port "${port}"${frames.length ? ` (its frame ports: ${frames.join(', ')})` : ' (only Mechanics parts have frame ports)'}`);
      const key = `${id}:${port}`;
      if (used.has(key)) throw new Error(`${at}: ${key} is already in join ${used.get(key) + 1}; a port is in one join (one point)`);
      used.set(key, i);
      return key;
    });
  });
}

// The mechanisms of one diagram level: the parts grouped through their
// joins, each walked from its World. Returns [{ world, rails, hinges, joints,
// bodies, base }], where
//   rails, hinges  the joints in block order (rails first in the state)
//   joints         every joint in block order (the outputs: coordinate, rate)
//   base[j]        the hinge whose frame hinge j turns against (−1: none)
//   bodies         [{ part, m, I, hinge (its inertia's angle, −1: none),
//                     c: [x, y] (rods on frames that do not turn),
//                     rails: [p…], rods: [{ part, hinge, f }] (f·l of each rod
//                     on the way, along hinge j) }]
// Parts and joins are the level's blocks and joins; refused (with the parts
// named, err.blocks) where §1.1 says so.
export function mechanisms(blocks, joins = []) {
  const parts = blocks.filter((b) => isPart(b.type));
  if (!parts.length) return [];
  const frameOf = new Map();
  joins.forEach((j, i) => { for (const key of j) frameOf.set(key, i); });
  let next = joins.length;
  const atFrame = new Map();   // frame → [{ part, port }]
  for (const b of parts) {
    for (const port of MECH_ELEMENTS[b.type].frames(b.params)) {
      const key = `${b.id}:${port}`;
      if (!frameOf.has(key)) frameOf.set(key, next++);
      const f = frameOf.get(key);
      if (!atFrame.has(f)) atFrame.set(f, []);
      atFrame.get(f).push({ part: b, port });
    }
  }
  const seen = new Set(), out = [];
  for (const world of parts.filter((b) => b.type === 'world')) {
    if (seen.has(world.id)) continue;
    // Frames reached: { c, rails, rods, hinge } (the frame's orientation: a hinge's index, −1 fixed).
    const reached = new Map(), mine = [world], rails = [], hinges = [], bodies = [], base = [];
    seen.add(world.id);
    const start = frameOf.get(`${world.id}:W`);
    reached.set(start, { c: [0, 0], rails: [], rods: [], hinge: -1 });
    const queue = [start];
    while (queue.length) {
      const f = queue.shift(), fr = reached.get(f);
      for (const { part: b, port } of atFrame.get(f)) {
        if (b === world && port === 'W') continue;
        if (seen.has(b.id)) {
          if (mine.includes(b)) continue;
          throw err(`${label(b)} is in two mechanisms`, [b.id]);
        }
        if (b.type === 'world') throw err(`${label(world)} and ${label(b)} are joined: one World per mechanism`, [world.id, b.id]);
        const frames = MECH_ELEMENTS[b.type].frames(b.params);
        if (frames.length === 2 && port !== frames[0]) throw err(`${label(b)} is joined the wrong way round: its base (${frames[0]}) goes on the World's side`, [b.id]);
        seen.add(b.id); mine.push(b);
        const p = b.params;
        if (b.type === 'mass') { bodies.push({ part: b, m: p.m, I: 0, hinge: -1, c: [...fr.c], rails: [...fr.rails], rods: [...fr.rods] }); continue; }
        // Its follower frame.
        let g;
        if (b.type === 'rail') {
          if (fr.hinge >= 0) throw err(`${label(b)} sits on a part that turns (${label(hinges[fr.hinge])}): a rail's base must not turn (the World or another rail)`, [b.id, hinges[fr.hinge].id]);
          rails.push(b);
          g = { c: [...fr.c], rails: [...fr.rails, rails.length - 1], rods: [...fr.rods], hinge: -1 };
        } else if (b.type === 'hinge') {
          hinges.push(b); base.push(fr.hinge);
          g = { c: [...fr.c], rails: [...fr.rails], rods: [...fr.rods], hinge: hinges.length - 1 };
        } else {
          // A rod: along its frame's orientation; its mass at the tip, or at
          // the middle with I = m·l²/12 turning with it.
          const along = (k) => (fr.hinge < 0 ? { c: [fr.c[0], fr.c[1] + k * p.l], rods: [...fr.rods] } : { c: [...fr.c], rods: [...fr.rods, { part: b, hinge: fr.hinge, f: k }] });
          const tip = along(1);
          g = { c: tip.c, rails: [...fr.rails], rods: tip.rods, hinge: fr.hinge };
          if (p.m > 0) {
            if (p.at === 'uniform') { const mid = along(0.5); bodies.push({ part: b, m: p.m, I: (p.m * p.l * p.l) / 12, hinge: fr.hinge, c: mid.c, rails: [...fr.rails], rods: mid.rods }); }
            else bodies.push({ part: b, m: p.m, I: 0, hinge: -1, c: tip.c, rails: [...fr.rails], rods: tip.rods });
          }
        }
        const gi = frameOf.get(`${b.id}:${frames[1]}`);
        if (reached.has(gi)) throw err(`a mechanism must be a tree: ${label(b)} closes a loop`, [b.id]);
        reached.set(gi, g);
        queue.push(gi);
      }
    }
    const order = (list) => list.slice().sort((a, b) => blocks.indexOf(a) - blocks.indexOf(b));
    const rs = order(rails), hs = order(hinges);
    // Re-index rails and hinges into block order.
    const ri = rails.map((b) => rs.indexOf(b)), hi = hinges.map((b) => hs.indexOf(b));
    for (const body of bodies) {
      body.rails = body.rails.map((r) => ri[r]);
      body.rods = body.rods.map((r) => ({ ...r, hinge: hi[r.hinge] }));
      if (body.hinge >= 0) body.hinge = hi[body.hinge];
    }
    const baseOrdered = new Array(hs.length);
    hinges.forEach((b, j) => { baseOrdered[hi[j]] = base[j] < 0 ? -1 : hi[base[j]]; });
    const joints = order([...rs, ...hs]);
    const names = new Map();
    for (const jn of joints) for (const k of ['name', 'rate']) {
      const nm = jn.params[k];
      if (names.has(nm)) throw err(`${label(names.get(nm))} and ${label(jn)} both name a coordinate or rate ${nm}`, [names.get(nm).id, jn.id]);
      names.set(nm, jn);
    }
    if (joints.length || bodies.length) out.push({ world, parts: mine, rails: rs, hinges: hs, joints, base: baseOrdered, bodies });
  }
  const loose = parts.filter((b) => !seen.has(b.id));
  if (loose.length) throw err(`${loose.map(label).join(', ')} ${loose.length === 1 ? 'is' : 'are'} not joined to a World`, loose.map((b) => b.id));
  return out;
}

// The constants of a mechanism's equations, from its topology (numbers):
//   M_pp' = Σ m·P_bp·P_bp'·(d_p·d_p')
//   M_pj  = Cpr_pj·(d_p,x·cos θ_j − d_p,y·sin θ_j),  Cpr_pj = Σ m·P_bp·L_bj
//   M_jk  = Crr_jk·cos(θ_j − θ_k) (+ I on the diagonal),  Crr_jk = Σ m·L_bj·L_bk
//   Q_p   = F_p − b_p·ṡ_p + Gp_p + Σ_k Cpr_pk·(d_p,x·sin θ_k + d_p,y·cos θ_k)·ω_k²,  Gp_p = −g·Σ m·P_bp·d_p,y
//   Q_j   = Gr_j·sin θ_j − Σ_k Crr_jk·sin(θ_j − θ_k)·ω_k² + τ_j − c_j·(ω_j − ω_base) − the reactions,  Gr_j = g·Σ m·L_bj
export function constants(mech) {
  const g = mech.world.params.g, np = mech.rails.length, nh = mech.hinges.length;
  const d = mech.rails.map((r) => [Math.cos(r.params.incline), Math.sin(r.params.incline)]);
  const Mpp = new Float64Array(np * np), Cpr = new Float64Array(np * nh), Crr = new Float64Array(nh * nh), I = new Float64Array(nh), Gp = new Float64Array(np), Gr = new Float64Array(nh);
  for (const b of mech.bodies) {
    const L = new Float64Array(nh);
    for (const r of b.rods) L[r.hinge] += r.f * r.part.params.l;
    const P = new Float64Array(np);
    for (const p of b.rails) P[p] = 1;
    for (let p = 0; p < np; p++) {
      for (let q = 0; q < np; q++) Mpp[p * np + q] += b.m * P[p] * P[q] * (d[p][0] * d[q][0] + d[p][1] * d[q][1]);
      for (let j = 0; j < nh; j++) Cpr[p * nh + j] += b.m * P[p] * L[j];
      Gp[p] -= g * b.m * P[p] * d[p][1];
    }
    for (let j = 0; j < nh; j++) {
      for (let k = 0; k < nh; k++) Crr[j * nh + k] += b.m * L[j] * L[k];
      Gr[j] += g * b.m * L[j];
    }
    if (b.hinge >= 0) I[b.hinge] += b.I;
  }
  return { g, np, nh, d, Mpp, Cpr, Crr, I, Gp, Gr };
}

// The state node of a mechanism (an `ode` as diagram.js compiles them).
// States: the rails' coordinates, the hinges' angles, then their rates, each
// in block order. Inputs: each joint's force or torque that is switched on,
// in block order. Outputs: each joint's coordinate and rate, in block order.
export function mechanismOde(mech) {
  const K = constants(mech), { np, nh, d, Mpp, Cpr, Crr, I, Gp, Gr } = K, N = np + nh;
  const joints = [...mech.rails, ...mech.hinges];
  // Where each output reads (state index) and which joints take an input.
  const outAt = mech.joints.map((b) => joints.indexOf(b));
  const inputs = mech.joints.filter((b) => (b.type === 'rail' ? b.params.force : b.params.torque));
  const railIn = new Int32Array(np).fill(-1), hingeIn = new Int32Array(nh).fill(-1);
  inputs.forEach((b, k) => { if (b.type === 'rail') railIn[mech.rails.indexOf(b)] = k; else hingeIn[mech.hinges.indexOf(b)] = k; });
  const bf = Float64Array.from(mech.rails, (r) => r.params.b), cf = Float64Array.from(mech.hinges, (h) => h.params.c);
  const base = Int32Array.from(mech.base);
  // A joint that moves no mass leaves M singular: refused.
  for (let p = 0; p < np; p++) if (!(Mpp[p * np + p] > 0)) throw err(`${label(mech.rails[p])} moves no mass: put a Mass on it`, [mech.rails[p].id]);
  for (let j = 0; j < nh; j++) if (!(Crr[j * nh + j] + I[j] > 0)) throw err(`${label(mech.hinges[j])} moves no mass: put a Rod with a mass, or a Mass, on it`, [mech.hinges[j].id]);
  const ode = {
    n: 2 * N, mechanism: mech, constants: K, nIn: inputs.length, inputs,
    states: () => [
      ...mech.rails.map((b) => ({ name: b.params.name, unit: 'm', angle: false })), ...mech.hinges.map((b) => ({ name: b.params.name, unit: 'rad', angle: true })),
      ...mech.rails.map((b) => ({ name: b.params.rate, unit: 'm/s', angle: false })), ...mech.hinges.map((b) => ({ name: b.params.rate, unit: 'rad/s', angle: false })),
    ],
    init: () => [...mech.rails.map((b) => b.params.x0), ...mech.hinges.map((b) => b.params.theta0), ...mech.rails.map((b) => b.params.v0), ...mech.hinges.map((b) => b.params.omega0)],
    out: (X, o, p, y) => { for (let k = 0; k < outAt.length; k++) { y[2 * k] = X[o + outAt[k]]; y[2 * k + 1] = X[o + N + outAt[k]]; } },
    // ẋ for the state at X[o…]; u: the input when there is one, uv: all of them.
    make() {
      const s = new Float64Array(nh), c = new Float64Array(nh), w2 = new Float64Array(nh), tq = new Float64Array(nh);
      const A = new Float64Array(N * N), r = new Float64Array(N), q = new Float64Array(N), one = inputs.length === 1;
      return (X, o, u, dX, uv) => {
        for (let j = 0; j < nh; j++) { const th = X[o + np + j], w = X[o + N + np + j]; s[j] = Math.sin(th); c[j] = Math.cos(th); w2[j] = w * w; }
        // The lower triangle of M(q) and the right-hand side Q.
        for (let p = 0; p < np; p++) {
          for (let k = 0; k <= p; k++) A[p * N + k] = Mpp[p * np + k];
          let rp = Gp[p] - bf[p] * X[o + N + p];
          if (railIn[p] >= 0) rp += one ? u : uv[railIn[p]];
          for (let k = 0; k < nh; k++) rp += Cpr[p * nh + k] * (d[p][0] * s[k] + d[p][1] * c[k]) * w2[k];
          r[p] = rp;
        }
        // Each hinge's torque on its follower, less its damping.
        for (let j = 0; j < nh; j++) {
          const wj = X[o + N + np + j], wb = base[j] >= 0 ? X[o + N + np + base[j]] : 0;
          tq[j] = (hingeIn[j] >= 0 ? (one ? u : uv[hingeIn[j]]) : 0) - cf[j] * (wj - wb);
        }
        for (let j = 0; j < nh; j++) {
          const row = (np + j) * N;
          for (let p = 0; p < np; p++) A[row + p] = Cpr[p * nh + j] * (d[p][0] * c[j] - d[p][1] * s[j]);
          let rj = Gr[j] * s[j] + tq[j];
          for (let k = 0; k < nh; k++) {
            if (k <= j) A[row + np + k] = Crr[j * nh + k] * (c[j] * c[k] + s[j] * s[k]) + (k === j ? I[j] : 0);
            rj -= Crr[j * nh + k] * (s[j] * c[k] - c[j] * s[k]) * w2[k];
            if (base[k] === j) rj -= tq[k];   // the reaction of a hinge mounted on what hinge j turns
          }
          r[np + j] = rj;
        }
        // LDLᵀ in place: L below the diagonal (unit diagonal implied), D on it.
        for (let j = 0; j < N; j++) {
          let dd = A[j * N + j];
          for (let k = 0; k < j; k++) dd -= A[j * N + k] * A[j * N + k] * A[k * N + k];
          A[j * N + j] = dd;
          for (let i = j + 1; i < N; i++) {
            let e = A[i * N + j];
            for (let k = 0; k < j; k++) e -= A[i * N + k] * A[j * N + k] * A[k * N + k];
            A[i * N + j] = e / dd;
          }
        }
        for (let i = 0; i < N; i++) { let e = r[i]; for (let k = 0; k < i; k++) e -= A[i * N + k] * q[k]; q[i] = e; }
        for (let i = 0; i < N; i++) q[i] /= A[i * N + i];
        for (let i = N - 1; i >= 0; i--) { let e = q[i]; for (let k = i + 1; k < N; k++) e -= A[k * N + i] * q[k]; q[i] = e; }
        for (let i = 0; i < N; i++) { dX[o + i] = X[o + N + i]; dX[o + N + i] = q[i]; }
      };
    },
    // The fastest dynamics, for the step size: 4·√(g / l_min·(1 + hinges)) +
    // Σ b / M_pp + Σ c / M_jj (a uniform rod counts 2l/3).
    bound: () => {
      const lens = [];
      for (const b of mech.parts) if (b.type === 'rod' && b.params.l > 0) lens.push(b.params.at === 'uniform' ? (2 * b.params.l) / 3 : b.params.l);
      let w = nh && lens.length ? 4 * Math.sqrt((K.g / Math.min(...lens)) * (1 + nh)) : 0;
      for (let p = 0; p < np; p++) w += bf[p] / Mpp[p * np + p];
      for (let j = 0; j < nh; j++) w += cf[j] / (Crr[j * nh + j] + I[j]);
      return w;
    },
    // Every frame's position and every body's at the state X[o…] (tests; a later view).
    pose(X, o = 0) {
      const at = (b) => {
        let x = b.c[0], y = b.c[1];
        for (const p of b.rails) { x += X[o + p] * d[p][0]; y += X[o + p] * d[p][1]; }
        for (const rr of b.rods) { const th = X[o + np + rr.hinge], l = rr.f * rr.part.params.l; x += l * Math.sin(th); y += l * Math.cos(th); }
        return [x, y];
      };
      return mech.bodies.map((b) => ({ id: b.part.id, m: b.m, I: b.I, hinge: b.hinge, angle: b.hinge >= 0 ? X[o + np + b.hinge] : 0, at: at(b) }));
    },
  };
  return ode;
}
