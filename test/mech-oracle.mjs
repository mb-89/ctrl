// The reference for test/mechanics.test.mjs (design/output/transparent-models.md
// §8.2, test 1): a general Jacobian solver for planar Mechanics parts, written
// apart from src/core/mech.js (no shared constants, its own walk). Every
// evaluation walks the tree with the actual geometry, builds each frame's
// position p, orientation φ, their Jacobians ∂p/∂q, ∂φ/∂q and the bias J̇q̇,
// then assembles
//   M = Σ m·JpᵀJp + Σ I·JφᵀJφ
//   Q = Σ Jpᵀ(0, −m·g) + joint forces (on the follower, reacting on the base)
//       − Σ m·Jpᵀ(J̇p·q̇) − Σ I·Jφᵀ(J̇φ·q̇)
// and solves M·q̈ = Q by Gaussian elimination with partial pivoting.
//
// oracleRates(blocks, joins) → (X, inputs, dX): one mechanism (one World) of a
// normalised diagram level, numeric params. State: rails' coordinates, hinges'
// angles (block order), then their rates. inputs: the forces and torques of
// the joints that take one, in block order.

const FRAMES = { world: ['W'], rail: ['B', 'F'], hinge: ['B', 'F'], mass: ['F'], rod: ['B', 'T'] };

// The tree, as a list of steps from the World out: each part with the frame
// its base sits on and the frame it makes (indices into a list of frames).
function walk(blocks, joins) {
  const parts = blocks.filter((b) => FRAMES[b.type]);
  const point = new Map();     // "id:P" → point (joins merged)
  let n = 0;
  for (const j of joins ?? []) { for (const e of j) point.set(e, n); n++; }
  for (const b of parts) for (const P of FRAMES[b.type]) if (!point.has(`${b.id}:${P}`)) point.set(`${b.id}:${P}`, n++);
  const world = parts.find((b) => b.type === 'world');
  const steps = [], queue = [point.get(`${world.id}:W`)];
  while (queue.length) {
    const f = queue.shift();
    for (const b of parts) {
      if (b === world || point.get(`${b.id}:${FRAMES[b.type][0]}`) !== f) continue;
      const g = b.type === 'mass' ? -1 : point.get(`${b.id}:${FRAMES[b.type][1]}`);
      steps.push({ b, from: f, to: g });
      if (g >= 0) queue.push(g);
    }
  }
  return { world, root: point.get(`${world.id}:W`), steps, nPoints: n };
}

const zeros = (N) => new Float64Array(N);

// Gaussian elimination with partial pivoting: solves A·x = r (A: rows of arrays).
export function solve(A, r) {
  const N = r.length, a = A.map((row, i) => [...row, r[i]]);
  for (let k = 0; k < N; k++) {
    let piv = k;
    for (let i = k + 1; i < N; i++) if (Math.abs(a[i][k]) > Math.abs(a[piv][k])) piv = i;
    [a[k], a[piv]] = [a[piv], a[k]];
    for (let i = k + 1; i < N; i++) {
      const f = a[i][k] / a[k][k];
      for (let j = k; j <= N; j++) a[i][j] -= f * a[k][j];
    }
  }
  const x = new Array(N).fill(0);
  for (let i = N - 1; i >= 0; i--) {
    let e = a[i][N];
    for (let j = i + 1; j < N; j++) e -= a[i][j] * x[j];
    x[i] = e / a[i][i];
  }
  return x;
}

export function oracle(blocks, joins) {
  const { world, root, steps, nPoints } = walk(blocks, joins);
  const g = world.params.g;
  const rails = blocks.filter((b) => b.type === 'rail'), hinges = blocks.filter((b) => b.type === 'hinge');
  const np = rails.length, N = np + hinges.length;
  const index = new Map([...rails.map((b, i) => [b, i]), ...hinges.map((b, i) => [b, np + i])]);
  const inputs = blocks.filter((b) => (b.type === 'rail' && b.params.force) || (b.type === 'hinge' && b.params.torque));

  // Each frame's kinematics at (q, q̇): p, Jp (2 rows), a = J̇p·q̇; φ, Jφ, aφ.
  function frames(q, qd) {
    const F = new Array(nPoints);
    F[root] = { p: [0, 0], Jx: zeros(N), Jy: zeros(N), a: [0, 0], phi: 0, Jphi: zeros(N), aphi: 0 };
    const dot = (J) => J.reduce((s, v, i) => s + v * qd[i], 0);
    const bodies = [], joints = [];
    for (const { b, from, to } of steps) {
      const B = F[from], P = b.params;
      if (b.type === 'mass') { bodies.push({ m: P.m, I: 0, fr: B }); continue; }
      let T;
      if (b.type === 'rail') {
        // follower = base + s·(cos α, sin α) (the base does not turn).
        const k = index.get(b), dx = Math.cos(P.incline), dy = Math.sin(P.incline);
        const Jx = Float64Array.from(B.Jx), Jy = Float64Array.from(B.Jy);
        Jx[k] += dx; Jy[k] += dy;
        T = { p: [B.p[0] + q[k] * dx, B.p[1] + q[k] * dy], Jx, Jy, a: [...B.a], phi: B.phi, Jphi: Float64Array.from(B.Jphi), aphi: B.aphi };
        joints.push({ b, base: B, fol: T, d: [dx, dy] });
      } else if (b.type === 'hinge') {
        // The follower's absolute angle is the coordinate.
        const k = index.get(b), Jphi = zeros(N);
        Jphi[k] = 1;
        T = { p: [...B.p], Jx: Float64Array.from(B.Jx), Jy: Float64Array.from(B.Jy), a: [...B.a], phi: q[k], Jphi, aphi: 0 };
        joints.push({ b, base: B, fol: T });
      } else {
        // A rod: a point at distance r along the base frame's orientation.
        const at = (r) => {
          const c = Math.cos(B.phi), s = Math.sin(B.phi), w = dot(B.Jphi);
          const Jx = B.Jx.map((v, i) => v + r * c * B.Jphi[i]), Jy = B.Jy.map((v, i) => v - r * s * B.Jphi[i]);
          // p̈ = p̈_b + r·(cos, −sin)·φ̈ − r·(sin, cos)·φ̇²
          return { p: [B.p[0] + r * s, B.p[1] + r * c], Jx, Jy, a: [B.a[0] + r * c * B.aphi - r * s * w * w, B.a[1] - r * s * B.aphi - r * c * w * w], phi: B.phi, Jphi: Float64Array.from(B.Jphi), aphi: B.aphi };
        };
        T = at(P.l);
        if (P.m > 0) bodies.push(P.at === 'uniform' ? { m: P.m, I: (P.m * P.l * P.l) / 12, fr: at(P.l / 2) } : { m: P.m, I: 0, fr: T });
      }
      F[to] = T;
    }
    return { bodies, joints };
  }

  const rates = (X, u, dX) => {
    const q = Array.from({ length: N }, (_, i) => X[i]), qd = Array.from({ length: N }, (_, i) => X[N + i]);
    const { bodies, joints } = frames(q, qd);
    const M = Array.from({ length: N }, () => new Array(N).fill(0)), Q = new Array(N).fill(0);
    for (const { m, I, fr } of bodies) {
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) M[i][j] += m * (fr.Jx[i] * fr.Jx[j] + fr.Jy[i] * fr.Jy[j]) + I * fr.Jphi[i] * fr.Jphi[j];
        Q[i] += -m * g * fr.Jy[i] - m * (fr.Jx[i] * fr.a[0] + fr.Jy[i] * fr.a[1]) - I * fr.Jphi[i] * fr.aphi;
      }
    }
    const dot = (J) => J.reduce((s, v, i) => s + v * qd[i], 0);
    for (const { b, base, fol, d } of joints) {
      const k = inputs.indexOf(b), ext = k >= 0 ? u[k] : 0;
      if (b.type === 'rail') {
        // The force F − b·(relative rate along d) on the follower, −it on the base.
        const vrel = d[0] * (dot(fol.Jx) - dot(base.Jx)) + d[1] * (dot(fol.Jy) - dot(base.Jy));
        const f = ext - b.params.b * vrel;
        for (let i = 0; i < N; i++) Q[i] += f * (d[0] * (fol.Jx[i] - base.Jx[i]) + d[1] * (fol.Jy[i] - base.Jy[i]));
      } else {
        // The torque τ − c·(ω − ω_base) on the follower, −it on the base.
        const tau = ext - b.params.c * (dot(fol.Jphi) - dot(base.Jphi));
        for (let i = 0; i < N; i++) Q[i] += tau * (fol.Jphi[i] - base.Jphi[i]);
      }
    }
    const qdd = solve(M, Q);
    for (let i = 0; i < N; i++) { dX[i] = qd[i]; dX[N + i] = qdd[i]; }
    return { M, Q };
  };
  return { N, inputs, rates };
}

export const oracleRates = (blocks, joins) => oracle(blocks, joins).rates;
