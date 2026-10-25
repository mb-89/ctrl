// Rigid-body kinematics and dynamics of a robot read from its URDF
// (core/urdf.js): a tree of bodies on revolute joints with a fixed base.
// Everything is computed in the world (base) frame with classical vectors;
// a robot's workspace is allocated once, and nothing allocates per call
// unless it returns a new array.
//
//   const r = createRbd(model, { armature, gravity, scale })
//   r.fk(q)                        world poses of the bodies (cached by q)
//   r.linkPose(q, link)            { R (9, row-major), p (3) } of any link's frame
//   r.linkPoses(q, out?)           every link's pose, for the 3D view
//   r.jacobian(q, link, J?, 'base' | 'frame')   geometric, 6×n row-major, rows v (3) then ω (3):
//                                  J_j = [z_j × (p − o_j); z_j] (in the link's frame with 'frame')
//   r.jdotqd(q, q̇, link)          J̇·q̇: the frame's acceleration with q̈ = 0 and no gravity
//   r.rnea(q, q̇, q̈)               inverse dynamics (Newton–Euler): τ = M(q)·q̈ + C(q, q̇)·q̇ + g(q)
//   r.massMatrix(q)                M(q) by the composite rigid body algorithm, n×n row-major
//   r.bias(q, q̇)                  h = C(q, q̇)·q̇ + g(q);  r.gravityTorque(q): g(q)
//   r.forwardDynamics(q, q̇, τ)    q̈ = M⁻¹(τ − h) by Cholesky
//   r.torqueSplit(q, q̇, q̈, drive?)  the torque at each joint and its shares:
//                                  inertial M·q̈, Coriolis and centrifugal C·q̇, gravity g, friction
//   r.energy(q, q̇)                { kinetic, potential } (J)
//
// armature (a number or n values, kg·m²) is the rotor inertia seen at each
// joint (G²·Jm), added to M's diagonal: a rotor turns with its joint.
// gravity is the acceleration of gravity in the base frame (default
// [0, 0, −9.81]); scale multiplies every mass and inertia of the arm (a
// controller's model that is wrong on purpose).
//
// Torques are what the joint must apply (the toolbox's sign: g(q) holds the
// arm still). Joint friction (jointFriction, below) is the motors' and is
// referred through the gears; it is not part of the URDF.

const len = (v, n, what) => {
  const a = typeof v === 'number' ? new Float64Array(n).fill(v) : Float64Array.from(v);
  if (a.length !== n) throw new Error(`${what} has ${a.length} values; the robot has ${n} joints`);
  return a;
};

export function createRbd(model, { armature = 0, gravity = [0, 0, -9.81], scale = 1 } = {}) {
  const n = model.n, B = model.bodies;
  const arm = len(armature, n, 'armature');
  const g = Float64Array.from(gravity);
  const parent = Int32Array.from(B, (b) => b.parent);
  // Per body: R0·[a]× and (R0·a)·aᵀ, so that R0·Rot(a, q) = cos q·R0 + sin q·K + (1 − cos q)·P.
  const R0 = new Float64Array(9 * n), K = new Float64Array(9 * n), P = new Float64Array(9 * n), p0 = new Float64Array(3 * n);
  const mass = new Float64Array(n), cB = new Float64Array(3 * n), IB = new Float64Array(9 * n);
  B.forEach((b, i) => {
    const a = b.axis, R = b.R0;
    const ax = [0, -a[2], a[1], a[2], 0, -a[0], -a[1], a[0], 0];
    const Ra = [0, 1, 2].map((r) => R[3 * r] * a[0] + R[3 * r + 1] * a[1] + R[3 * r + 2] * a[2]);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        R0[9 * i + 3 * r + c] = R[3 * r + c];
        K[9 * i + 3 * r + c] = R[3 * r] * ax[c] + R[3 * r + 1] * ax[3 + c] + R[3 * r + 2] * ax[6 + c];
        P[9 * i + 3 * r + c] = Ra[r] * a[c];
      }
      p0[3 * i + r] = b.p0[r];
      cB[3 * i + r] = b.inertia.c[r];
    }
    mass[i] = b.inertia.m * scale;
    for (let k = 0; k < 9; k++) IB[9 * i + k] = b.inertia.I[k] * scale;
  });
  // A joint whose subtree has neither mass nor inertia, and no rotor, would
  // give the mass matrix a zero row.
  const moved = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    moved[i] += mass[i] + IB[9 * i] + IB[9 * i + 4] + IB[9 * i + 8];
    if (parent[i] >= 0) moved[parent[i]] += moved[i];
  }
  for (let i = 0; i < n; i++) {
    if (!(moved[i] > 0) && !(arm[i] > 0)) throw new Error(`${B[i].joint} moves no mass and has no armature: the mass matrix would have a zero row`);
  }

  // World poses, cached by q.
  const qc = new Float64Array(n).fill(NaN);
  const Rw = new Float64Array(9 * n), o = new Float64Array(3 * n), z = new Float64Array(3 * n);
  const cw = new Float64Array(3 * n), Iw = new Float64Array(9 * n);   // centres of mass and inertias in the world
  let inertiaFresh = false;
  const T = new Float64Array(9);
  function fk(q) {
    let same = true;
    for (let i = 0; i < n; i++) if (qc[i] !== q[i]) { same = false; break; }
    if (same) return api;
    for (let i = 0; i < n; i++) {
      const c = Math.cos(q[i]), s = Math.sin(q[i]), v = 1 - c, j = parent[i];
      for (let k = 0; k < 9; k++) T[k] = c * R0[9 * i + k] + s * K[9 * i + k] + v * P[9 * i + k];
      if (j < 0) {
        for (let k = 0; k < 9; k++) Rw[9 * i + k] = T[k];
        for (let k = 0; k < 3; k++) o[3 * i + k] = p0[3 * i + k];
      } else {
        for (let r = 0; r < 3; r++) {
          const a0 = Rw[9 * j + 3 * r], a1 = Rw[9 * j + 3 * r + 1], a2 = Rw[9 * j + 3 * r + 2];
          for (let cc = 0; cc < 3; cc++) Rw[9 * i + 3 * r + cc] = a0 * T[cc] + a1 * T[3 + cc] + a2 * T[6 + cc];
          o[3 * i + r] = o[3 * j + r] + a0 * p0[3 * i] + a1 * p0[3 * i + 1] + a2 * p0[3 * i + 2];
        }
      }
      const a = B[i].axis;
      for (let r = 0; r < 3; r++) z[3 * i + r] = Rw[9 * i + 3 * r] * a[0] + Rw[9 * i + 3 * r + 1] * a[1] + Rw[9 * i + 3 * r + 2] * a[2];
      qc[i] = q[i];
    }
    inertiaFresh = false;
    return api;
  }
  function worldInertia() {
    if (inertiaFresh) return;
    for (let i = 0; i < n; i++) {
      const R = 9 * i;
      for (let r = 0; r < 3; r++) cw[3 * i + r] = o[3 * i + r] + Rw[R + 3 * r] * cB[3 * i] + Rw[R + 3 * r + 1] * cB[3 * i + 1] + Rw[R + 3 * r + 2] * cB[3 * i + 2];
      // R·I·Rᵀ
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          let s = 0;
          for (let a = 0; a < 3; a++) {
            const ra = Rw[R + 3 * r + a];
            if (ra === 0) continue;
            for (let b = 0; b < 3; b++) s += ra * IB[R + 3 * a + b] * Rw[R + 3 * c + b];
          }
          Iw[R + 3 * r + c] = s;
        }
      }
    }
    inertiaFresh = true;
  }

  // A link's frame: its body and its pose in the body.
  function frameOf(link) {
    const f = model.frames.get(link);
    if (!f) throw new Error(`the robot has no link "${link}"`);
    return f;
  }
  function linkPoseInto(link, R, p) {
    const f = frameOf(link), i = f.body;
    if (i < 0) { for (let k = 0; k < 9; k++) R[k] = f.R[k]; for (let k = 0; k < 3; k++) p[k] = f.p[k]; return; }
    for (let r = 0; r < 3; r++) {
      const a0 = Rw[9 * i + 3 * r], a1 = Rw[9 * i + 3 * r + 1], a2 = Rw[9 * i + 3 * r + 2];
      for (let c = 0; c < 3; c++) R[3 * r + c] = a0 * f.R[c] + a1 * f.R[3 + c] + a2 * f.R[6 + c];
      p[r] = o[3 * i + r] + a0 * f.p[0] + a1 * f.p[1] + a2 * f.p[2];
    }
  }
  const pR = new Float64Array(9), pp = new Float64Array(3);

  function jacobian(q, link, J = new Float64Array(6 * n), expressedIn = 'base') {
    fk(q);
    linkPoseInto(link, pR, pp);
    J.fill(0);
    for (let j = frameOf(link).body; j >= 0; j = parent[j]) {
      const zx = z[3 * j], zy = z[3 * j + 1], zz = z[3 * j + 2];
      const dx = pp[0] - o[3 * j], dy = pp[1] - o[3 * j + 1], dz = pp[2] - o[3 * j + 2];
      J[j] = zy * dz - zz * dy; J[n + j] = zz * dx - zx * dz; J[2 * n + j] = zx * dy - zy * dx;
      J[3 * n + j] = zx; J[4 * n + j] = zy; J[5 * n + j] = zz;
    }
    if (expressedIn === 'frame') {
      for (let j = 0; j < n; j++) {
        for (const h of [0, 3]) {
          const v0 = J[h * n + j], v1 = J[(h + 1) * n + j], v2 = J[(h + 2) * n + j];
          for (let r = 0; r < 3; r++) J[(h + r) * n + j] = pR[r] * v0 + pR[3 + r] * v1 + pR[6 + r] * v2;
        }
      }
    } else if (expressedIn !== 'base') throw new Error(`a Jacobian is expressed in 'base' or 'frame', not "${expressedIn}"`);
    return J;
  }

  // The forward Newton–Euler pass: angular velocities and accelerations of
  // the bodies and the classical acceleration of their origins, the base
  // accelerating at a0 (−g puts gravity in).
  const w = new Float64Array(3 * n), wd = new Float64Array(3 * n), ao = new Float64Array(3 * n);
  function forward(qd, qdd, a0x, a0y, a0z) {
    for (let i = 0; i < n; i++) {
      const j = parent[i], I3 = 3 * i, J3 = 3 * j;
      const zx = z[I3], zy = z[I3 + 1], zz = z[I3 + 2], v = qd[i], acc = qdd ? qdd[i] : 0;
      if (j < 0) {
        w[I3] = zx * v; w[I3 + 1] = zy * v; w[I3 + 2] = zz * v;
        wd[I3] = zx * acc; wd[I3 + 1] = zy * acc; wd[I3 + 2] = zz * acc;
        ao[I3] = a0x; ao[I3 + 1] = a0y; ao[I3 + 2] = a0z;
        continue;
      }
      const px = w[J3], py = w[J3 + 1], pz = w[J3 + 2];
      w[I3] = px + zx * v; w[I3 + 1] = py + zy * v; w[I3 + 2] = pz + zz * v;
      wd[I3] = wd[J3] + zx * acc + (py * zz - pz * zy) * v;
      wd[I3 + 1] = wd[J3 + 1] + zy * acc + (pz * zx - px * zz) * v;
      wd[I3 + 2] = wd[J3 + 2] + zz * acc + (px * zy - py * zx) * v;
      const dx = o[I3] - o[J3], dy = o[I3 + 1] - o[J3 + 1], dz = o[I3 + 2] - o[J3 + 2];
      const ex = py * dz - pz * dy, ey = pz * dx - px * dz, ez = px * dy - py * dx;   // ω × d
      ao[I3] = ao[J3] + (wd[J3 + 1] * dz - wd[J3 + 2] * dy) + (py * ez - pz * ey);
      ao[I3 + 1] = ao[J3 + 1] + (wd[J3 + 2] * dx - wd[J3] * dz) + (pz * ex - px * ez);
      ao[I3 + 2] = ao[J3 + 2] + (wd[J3] * dy - wd[J3 + 1] * dx) + (px * ey - py * ex);
    }
  }

  function jdotqd(q, qd, link, out = new Float64Array(6)) {
    fk(q);
    out.fill(0);
    const i = frameOf(link).body;
    if (i < 0) return out;
    forward(qd, null, 0, 0, 0);
    linkPoseInto(link, pR, pp);
    const I3 = 3 * i, wx = w[I3], wy = w[I3 + 1], wz = w[I3 + 2];
    const dx = pp[0] - o[I3], dy = pp[1] - o[I3 + 1], dz = pp[2] - o[I3 + 2];
    const ex = wy * dz - wz * dy, ey = wz * dx - wx * dz, ez = wx * dy - wy * dx;
    out[0] = ao[I3] + (wd[I3 + 1] * dz - wd[I3 + 2] * dy) + (wy * ez - wz * ey);
    out[1] = ao[I3 + 1] + (wd[I3 + 2] * dx - wd[I3] * dz) + (wz * ex - wx * ez);
    out[2] = ao[I3 + 2] + (wd[I3] * dy - wd[I3 + 1] * dx) + (wx * ey - wy * ex);
    out[3] = wd[I3]; out[4] = wd[I3 + 1]; out[5] = wd[I3 + 2];
    return out;
  }

  // Inverse dynamics. The backward pass sums each body's force and its
  // moment about its joint's origin into its parent's.
  const fa = new Float64Array(3 * n), na = new Float64Array(3 * n);
  function rnea(q, qd, qdd, out = new Float64Array(n), { gravity: withGravity = true, armature: withArmature = true } = {}) {
    fk(q);
    worldInertia();
    if (withGravity) forward(qd, qdd, -g[0], -g[1], -g[2]); else forward(qd, qdd, 0, 0, 0);
    fa.fill(0); na.fill(0);
    for (let i = n - 1; i >= 0; i--) {
      const I3 = 3 * i, I9 = 9 * i, m = mass[i];
      const wx = w[I3], wy = w[I3 + 1], wz = w[I3 + 2];
      const rx = cw[I3] - o[I3], ry = cw[I3 + 1] - o[I3 + 1], rz = cw[I3 + 2] - o[I3 + 2];
      // Acceleration of the centre of mass: a_o + ω̇ × r + ω × (ω × r).
      const ex = wy * rz - wz * ry, ey = wz * rx - wx * rz, ez = wx * ry - wy * rx;
      const Fx = m * (ao[I3] + (wd[I3 + 1] * rz - wd[I3 + 2] * ry) + (wy * ez - wz * ey));
      const Fy = m * (ao[I3 + 1] + (wd[I3 + 2] * rx - wd[I3] * rz) + (wz * ex - wx * ez));
      const Fz = m * (ao[I3 + 2] + (wd[I3] * ry - wd[I3 + 1] * rx) + (wx * ey - wy * ex));
      // N = I·ω̇ + ω × (I·ω), about the centre of mass.
      const Iwx = Iw[I9] * wx + Iw[I9 + 1] * wy + Iw[I9 + 2] * wz;
      const Iwy = Iw[I9 + 3] * wx + Iw[I9 + 4] * wy + Iw[I9 + 5] * wz;
      const Iwz = Iw[I9 + 6] * wx + Iw[I9 + 7] * wy + Iw[I9 + 8] * wz;
      const Nx = Iw[I9] * wd[I3] + Iw[I9 + 1] * wd[I3 + 1] + Iw[I9 + 2] * wd[I3 + 2] + (wy * Iwz - wz * Iwy);
      const Ny = Iw[I9 + 3] * wd[I3] + Iw[I9 + 4] * wd[I3 + 1] + Iw[I9 + 5] * wd[I3 + 2] + (wz * Iwx - wx * Iwz);
      const Nz = Iw[I9 + 6] * wd[I3] + Iw[I9 + 7] * wd[I3 + 1] + Iw[I9 + 8] * wd[I3 + 2] + (wx * Iwy - wy * Iwx);
      const fx = Fx + fa[I3], fy = Fy + fa[I3 + 1], fz = Fz + fa[I3 + 2];
      const nx = Nx + (ry * Fz - rz * Fy) + na[I3];
      const ny = Ny + (rz * Fx - rx * Fz) + na[I3 + 1];
      const nz = Nz + (rx * Fy - ry * Fx) + na[I3 + 2];
      out[i] = z[I3] * nx + z[I3 + 1] * ny + z[I3 + 2] * nz + (withArmature && qdd ? arm[i] * qdd[i] : 0);
      const j = parent[i];
      if (j >= 0) {
        const J3 = 3 * j, dx = o[I3] - o[J3], dy = o[I3 + 1] - o[J3 + 1], dz = o[I3 + 2] - o[J3 + 2];
        fa[J3] += fx; fa[J3 + 1] += fy; fa[J3 + 2] += fz;
        na[J3] += nx + (dy * fz - dz * fy); na[J3 + 1] += ny + (dz * fx - dx * fz); na[J3 + 2] += nz + (dx * fy - dy * fx);
      }
    }
    return out;
  }

  // The composite rigid body algorithm, in world coordinates about the world
  // origin, where composite inertias simply add: per body m, h = m·c and the
  // rotational inertia about the origin. Joint j's motion axis is
  // S_j = (z_j; o_j × z_j), and M_ij = S_jᵀ·(I_i^C·S_i) for j = i and every
  // ancestor of i.
  const Cm = new Float64Array(n), Ch = new Float64Array(3 * n), CI = new Float64Array(9 * n);
  function massMatrix(q, out = new Float64Array(n * n)) {
    fk(q);
    worldInertia();
    for (let i = 0; i < n; i++) {
      const I3 = 3 * i, I9 = 9 * i, m = mass[i], cx = cw[I3], cy = cw[I3 + 1], cz = cw[I3 + 2], c2 = cx * cx + cy * cy + cz * cz;
      Cm[i] = m; Ch[I3] = m * cx; Ch[I3 + 1] = m * cy; Ch[I3 + 2] = m * cz;
      const c = [cx, cy, cz];
      for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) CI[I9 + 3 * r + k] = Iw[I9 + 3 * r + k] + m * ((r === k ? c2 : 0) - c[r] * c[k]);
    }
    for (let i = n - 1; i > 0; i--) {
      const j = parent[i];
      if (j < 0) continue;
      Cm[j] += Cm[i];
      for (let k = 0; k < 3; k++) Ch[3 * j + k] += Ch[3 * i + k];
      for (let k = 0; k < 9; k++) CI[9 * j + k] += CI[9 * i + k];
    }
    out.fill(0);
    for (let i = 0; i < n; i++) {
      const I3 = 3 * i, I9 = 9 * i;
      const zx = z[I3], zy = z[I3 + 1], zz = z[I3 + 2];
      const vx = o[I3 + 1] * zz - o[I3 + 2] * zy, vy = o[I3 + 2] * zx - o[I3] * zz, vz = o[I3] * zy - o[I3 + 1] * zx;
      const hx = Ch[I3], hy = Ch[I3 + 1], hz = Ch[I3 + 2], m = Cm[i];
      // F = (I_O·z + h × v; m·v + z × h)
      const nx = CI[I9] * zx + CI[I9 + 1] * zy + CI[I9 + 2] * zz + (hy * vz - hz * vy);
      const ny = CI[I9 + 3] * zx + CI[I9 + 4] * zy + CI[I9 + 5] * zz + (hz * vx - hx * vz);
      const nz = CI[I9 + 6] * zx + CI[I9 + 7] * zy + CI[I9 + 8] * zz + (hx * vy - hy * vx);
      const fx = m * vx + (zy * hz - zz * hy), fy = m * vy + (zz * hx - zx * hz), fz = m * vz + (zx * hy - zy * hx);
      for (let j = i; j >= 0; j = parent[j]) {
        const J3 = 3 * j, ax = z[J3], ay = z[J3 + 1], az = z[J3 + 2];
        const bx = o[J3 + 1] * az - o[J3 + 2] * ay, by = o[J3 + 2] * ax - o[J3] * az, bz = o[J3] * ay - o[J3 + 1] * ax;
        const Mij = ax * nx + ay * ny + az * nz + bx * fx + by * fy + bz * fz;
        out[i * n + j] = Mij; out[j * n + i] = Mij;
      }
      out[i * n + i] += arm[i];
    }
    return out;
  }

  const zero = new Float64Array(n);
  const bias = (q, qd, out = new Float64Array(n)) => rnea(q, qd, null, out);
  const gravityTorque = (q, out = new Float64Array(n)) => rnea(q, zero, null, out);

  const Mw = new Float64Array(n * n), hw = new Float64Array(n);
  function forwardDynamics(q, qd, tau, out = new Float64Array(n)) {
    massMatrix(q, Mw);
    bias(q, qd, hw);
    for (let i = 0; i < n; i++) out[i] = tau[i] - hw[i];
    if (!cholesky(Mw, n)) throw new Error('the mass matrix is not positive definite');
    return cholSolve(Mw, n, out);
  }

  // The torque each joint applies, split into what the model computes: the
  // inertial share M(q)·q̈ (rotors included), the Coriolis and centrifugal
  // share C(q, q̇)·q̇, the gravity share g(q), and friction (when the drive
  // is given: jointFriction). total is their sum; it equals rnea(q, q̇, q̈)
  // plus friction to rounding.
  function torqueSplit(q, qd, qdd, drive = null) {
    const inertial = new Float64Array(n), coriolis = new Float64Array(n), grav = new Float64Array(n);
    const friction = drive ? jointFriction(qd, drive) : new Float64Array(n);
    massMatrix(q, Mw);
    for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += Mw[i * n + j] * qdd[j]; inertial[i] = s; }
    rnea(q, qd, null, coriolis, { gravity: false });
    gravityTorque(q, grav);
    const total = Float64Array.from(inertial, (v, i) => v + coriolis[i] + grav[i] + friction[i]);
    return { inertial, coriolis, gravity: grav, friction, total };
  }

  function energy(q, qd) {
    massMatrix(q, Mw);
    let kinetic = 0, potential = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) kinetic += 0.5 * qd[i] * Mw[i * n + j] * qd[j];
    for (let i = 0; i < n; i++) potential -= mass[i] * (g[0] * cw[3 * i] + g[1] * cw[3 * i + 1] + g[2] * cw[3 * i + 2]);
    return { kinetic, potential };
  }

  function linkPose(q, link) {
    fk(q);
    const R = new Array(9), p = new Array(3);
    linkPoseInto(link, R, p);
    return { R, p };
  }
  function linkPoses(q, out = {}) {
    fk(q);
    for (const l of model.links) {
      const e = out[l.name] ?? (out[l.name] = { R: new Float64Array(9), p: new Float64Array(3) });
      linkPoseInto(l.name, e.R, e.p);
    }
    return out;
  }

  const api = {
    n, model, armature: arm, gravity: g,
    fk, linkPose, linkPoses, jacobian, jdotqd, rnea, massMatrix, bias, gravityTorque, forwardDynamics, torqueSplit, energy,
    // The world poses after fk: body i's rotation (9 from 9i), origin and joint axis (3 from 3i).
    poses: { R: Rw, o, z },
  };
  return api;
}

// Joint friction from the motors, referred through the gears: at the motor
// speed ω = G·q̇, τ_m = B·ω + Tc·tanh(ω/ω_s), with Tc = Tcp for ω ≥ 0 and
// Tcn (a magnitude) below; at the joint τ = G·τ_m. The smoothing ω_s stands
// for the step a Coulomb law has at 0: below it a joint creeps under a steady
// load instead of sticking. drive = { G, B, Tcp, Tcn, ws } (numbers or n values).
export function jointFriction(qd, { G, B, Tcp, Tcn, ws }, out = new Float64Array(qd.length)) {
  const at = (v, i) => (typeof v === 'number' ? v : v[i]);
  for (let i = 0; i < qd.length; i++) {
    const Gi = at(G, i), om = Gi * qd[i];
    out[i] = Gi * (at(B, i) * om + (om >= 0 ? at(Tcp, i) : at(Tcn, i)) * Math.tanh(om / at(ws, i)));
  }
  return out;
}

// ---- Small dense linear algebra on row-major Float64Arrays

// In place: the lower triangle becomes L with A = L·Lᵀ. False if A is not
// positive definite.
export function cholesky(A, n) {
  for (let j = 0; j < n; j++) {
    let d = A[j * n + j];
    for (let k = 0; k < j; k++) d -= A[j * n + k] ** 2;
    if (!(d > 0)) return false;
    d = Math.sqrt(d);
    A[j * n + j] = d;
    for (let i = j + 1; i < n; i++) {
      let s = A[i * n + j];
      for (let k = 0; k < j; k++) s -= A[i * n + k] * A[j * n + k];
      A[i * n + j] = s / d;
    }
  }
  return true;
}

// Solves L·Lᵀ·x = b in place in b.
export function cholSolve(L, n, b) {
  for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i * n + k] * b[k]; b[i] = s / L[i * n + i]; }
  for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let k = i + 1; k < n; k++) s -= L[k * n + i] * b[k]; b[i] = s / L[i * n + i]; }
  return b;
}

// The eigenvalues of a symmetric n×n matrix by cyclic Jacobi rotations.
export function symEig(S, n) {
  const a = Float64Array.from(S);
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0, diag = 0;
    for (let p = 0; p < n; p++) { diag += a[p * n + p] ** 2; for (let q = p + 1; q < n; q++) off += a[p * n + q] ** 2; }
    if (off === 0 || off <= 1e-32 * diag) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q];
        if (apq === 0) continue;
        const th = (a[q * n + q] - a[p * n + p]) / (2 * apq);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) { const x = a[k * n + p], y = a[k * n + q]; a[k * n + p] = c * x - s * y; a[k * n + q] = s * x + c * y; }
        for (let k = 0; k < n; k++) { const x = a[p * n + k], y = a[q * n + k]; a[p * n + k] = c * x - s * y; a[q * n + k] = s * x + c * y; }
      }
    }
  }
  return Array.from({ length: n }, (_, i) => a[i * n + i]);
}

// The smallest singular value of an m×n matrix (m ≤ n), from the eigenvalues
// of J·Jᵀ.
export function sigmaMin(J, m, n) {
  const A = new Float64Array(m * m);
  for (let i = 0; i < m; i++) for (let j = 0; j <= i; j++) { let s = 0; for (let k = 0; k < n; k++) s += J[i * n + k] * J[j * n + k]; A[i * m + j] = s; A[j * m + i] = s; }
  return Math.sqrt(Math.max(0, Math.min(...symEig(A, m))));
}

// The damped inverse of an m×n matrix: J⁺ = Jᵀ·(J·Jᵀ + λ²·I)⁻¹ (n×m), with
// λ² = λ_max²·(1 − (σ_min/ε)²) when σ_min < ε, else 0: the exact inverse away
// from singularities, bounded joint speeds near them.
export function dampedInverse(J, m, n, { eps = 0.04, lambdaMax = 0.05 } = {}, out = new Float64Array(n * m)) {
  const sigma = sigmaMin(J, m, n);
  const lambda2 = sigma < eps ? lambdaMax ** 2 * (1 - (sigma / eps) ** 2) : 0;
  const A = new Float64Array(m * m);
  for (let i = 0; i < m; i++) for (let j = 0; j <= i; j++) { let s = 0; for (let k = 0; k < n; k++) s += J[i * n + k] * J[j * n + k]; A[i * m + j] = s; A[j * m + i] = s; }
  for (let i = 0; i < m; i++) A[i * m + i] += lambda2;
  if (!cholesky(A, m)) throw new Error(`the Jacobian is singular (σ_min ${sigma.toExponential(2)}) and the damping is 0: give ε and λ_max above 0`);
  const col = new Float64Array(m);
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < m; i++) col[i] = J[i * n + k];
    cholSolve(A, m, col);
    for (let i = 0; i < m; i++) out[k * m + i] = col[i];
  }
  return { Jinv: out, sigma, lambda2 };
}

// The orientation error between a desired rotation R_d and the actual R (both
// 3×3 row-major, base ← frame): the relative rotation R_e = R_d·Rᵀ, its unit
// quaternion (η, ε) by Shepperd's method with η ≥ 0, and e = ε = sin(θ/2)·k in
// the base frame, θ = 2·atan2(‖ε‖, η). R_e is near the identity when the
// error is small, so no sign is in doubt (each rotation's own quaternion is
// not: at a half turn, such as a tool pointing down, its sign flips).
export function orientationError(Rd, R, out = new Float64Array(3)) {
  const e = new Float64Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) e[3 * i + j] = Rd[3 * i] * R[3 * j] + Rd[3 * i + 1] * R[3 * j + 1] + Rd[3 * i + 2] * R[3 * j + 2];
  const t = e[0] + e[4] + e[8];
  let eta, x, y, zz;
  if (t >= e[0] && t >= e[4] && t >= e[8]) {
    const s = Math.sqrt(1 + t) * 2; eta = s / 4; x = (e[7] - e[5]) / s; y = (e[2] - e[6]) / s; zz = (e[3] - e[1]) / s;
  } else if (e[0] >= e[4] && e[0] >= e[8]) {
    const s = Math.sqrt(1 + e[0] - e[4] - e[8]) * 2; eta = (e[7] - e[5]) / s; x = s / 4; y = (e[1] + e[3]) / s; zz = (e[2] + e[6]) / s;
  } else if (e[4] >= e[8]) {
    const s = Math.sqrt(1 + e[4] - e[0] - e[8]) * 2; eta = (e[2] - e[6]) / s; x = (e[1] + e[3]) / s; y = s / 4; zz = (e[5] + e[7]) / s;
  } else {
    const s = Math.sqrt(1 + e[8] - e[0] - e[4]) * 2; eta = (e[3] - e[1]) / s; x = (e[2] + e[6]) / s; y = (e[5] + e[7]) / s; zz = s / 4;
  }
  if (eta < 0) { eta = -eta; x = -x; y = -y; zz = -zz; }
  out[0] = x; out[1] = y; out[2] = zz;
  return { e: out, theta: 2 * Math.atan2(Math.hypot(x, y, zz), eta), eta };
}
