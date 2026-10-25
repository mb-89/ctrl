// The PUMA 560's loop written plainly (design/output/robot.md §9, §11 test
// 12): the arm, the motors, the encoders, the task law, the damped inverse,
// the model feedforward and the six speed PIs, as one hand-written program
// on the robot core (rbd.js), with no blocks and no compiler. test/puma.test.mjs
// holds the library system's compiled run to it.
//
//   pumaReference({ variant: 0 | 1 | 2, T: 10 }) → { t, q (per sample, 6), p, pd, e }
//
// variant 0: PI + model feedforward; 1: PI, no model; 2: P only, no model.
// The same steps as simulateSystem: RK4 at the 1 ms record step with the
// currents held, the controllers sampled at the end of each step (the
// encoders first), the Sources read there.

import { parseUrdf } from '../src/core/urdf.js';
import { createRbd, dampedInverse, orientationError, jointFriction } from '../src/core/rbd.js';
import { PUMA560 } from '../src/core/puma560.js';
import { normalizeReference, referenceFn } from '../src/core/signals.js';
import { solve } from '../src/core/linalg.js';
import { PUMA_SYSTEM, PUMA_START } from '../src/core/pumasystem.js';

const DEG = Math.PI / 180, N = 6;

export function pumaReference({ variant = 0, T = 10, signals } = {}) {
  const D = PUMA560.drive, Ts = 0.001, h = Ts, K = Math.round(T / Ts);
  const model = parseUrdf(PUMA560.urdfProbe), tool = 'tip';
  const arm = createRbd(model, { armature: PUMA560.armature }), kin = createRbd(model);
  const q0 = PUMA_START.map((v) => v * DEG);
  // The circle: two references in its own frame (its a axis along −x of the
  // base: the frame turned half a turn about z), at the probe's start point.
  const sig = signals ?? PUMA_SYSTEM.signals;
  const Rad = PUMA_SYSTEM.diagram.blocks.find((b) => b.id === 'ref').params.R;
  const fa = referenceFn(normalizeReference(sig.a_r), { sampleTime: Ts }), fb = referenceFn(normalizeReference(sig.b_r), { sampleTime: Ts });
  const ra = [fa, fa.derivative(1), fa.derivative(2)], rb = [fb, fb.derivative(1), fb.derivative(2)];
  const start = kin.linkPose(q0, tool), o = start.p, R0 = start.R;
  const yaw = PUMA_SYSTEM.diagram.blocks.find((b) => b.id === 'ref').diagram.blocks.find((b) => b.id === 'frame').params.rpy[2];
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const kx = 10, ko = 10, Kf = variant === 0 ? 1 : 0, integral = variant !== 2;

  // The speed PIs' gains, as speedPI computes them: b is the joint's
  // acceleration per unit torque at the start pose, (M⁻¹)_kk; u0 the
  // torques that hold the start pose (gravity) less the feedforward there.
  const M = arm.massMatrix(q0), Mrows = Array.from({ length: N }, (_, i) => Array.from(M.subarray(i * N, i * N + N)));
  const b = Array.from({ length: N }, (_, k) => solve(Mrows, Array.from({ length: N }, (_, i) => (i === k ? 1 : 0)))[k]);
  const g0 = arm.gravityTorque(q0);
  const Kv = b.map((bk) => 60 / bk), Ki = b.map((bk) => (integral ? 900 / bk : 0));
  const u0 = Kf ? new Array(N).fill(0) : Array.from(g0);
  const lim = Array.from({ length: N }, (_, j) => Math.abs(D.G[j]) * D.kt[j] * D.imax[j]);

  // The plant: q, q̇; τ from the six motors on their current drives.
  const X = new Float64Array(2 * N), Xt = new Float64Array(2 * N);
  X.set(q0, 0);
  const k1 = new Float64Array(2 * N), k2 = new Float64Array(2 * N), k3 = new Float64Array(2 * N), k4 = new Float64Array(2 * N);
  const icmd = new Float64Array(N), tau = new Float64Array(N), qdd = new Float64Array(N);
  const rates = (x, dx) => {
    const q = x.subarray(0, N), qd = x.subarray(N);
    for (let j = 0; j < N; j++) {
      const i = Math.min(D.imax[j], Math.max(-D.imax[j], icmd[j]));
      const om = D.G[j] * qd[j];
      const tf = D.B[j] * om + (om >= 0 ? D.Tcp[j] : D.Tcn[j]) * Math.tanh(om / D.ws);
      tau[j] = D.G[j] * (D.kt[j] * i - tf);
    }
    arm.forwardDynamics(q, qd, tau, qdd);
    for (let j = 0; j < N; j++) { dx[j] = qd[j]; dx[N + j] = qdd[j]; }
  };

  // The controller's memory: the encoders' last angles and speeds, the PIs' integrals.
  let prev = null;
  const rate = new Float64Array(N), I = Float64Array.from(u0);
  const J = new Float64Array(6 * N), v = new Float64Array(6), eo = new Float64Array(3);
  const sample = (t) => {
    const qm = Float64Array.from(X.subarray(0, N));
    prev ??= Float64Array.from(qm);
    for (let j = 0; j < N; j++) rate[j] = rate[j] + ((qm[j] - prev[j]) / Ts - rate[j]);
    prev = qm;
    const qdm = rate;
    // Axes → task.
    const { p, R } = kin.linkPose(qm, tool);
    kin.jacobian(qm, tool, J);
    const jd = kin.jdotqd(qm, qdm, tool);
    for (let i = 0; i < 6; i++) { let s = 0; for (let c = 0; c < N; c++) s += J[i * N + c] * qdm[c]; v[i] = s; }
    // The reference, placed at the tool's start.
    const A = [ra[0](t), ra[1](t), ra[2](t)], B = [rb[0](t), rb[1](t), rb[2](t)];
    const rot = (x, y) => [cy * x - sy * y, sy * x + cy * y];
    const [px, py] = rot(A[0], B[0]), [vx, vy] = rot(A[1], B[1]), [axx, ayy] = rot(A[2], B[2]);
    const pd = [o[0] + px, o[1] + py, o[2]], vd = [vx, vy, 0], ad = [axx, ayy, 0];
    // The tool's orientation: R0 turned about the vertical by the circle's phase φ.
    const c = (A[0] + Rad) / Rad, sn = B[0] / Rad, dph = (c * B[1] - sn * A[1]) / Rad, ddph = (c * B[2] - sn * A[2]) / Rad;
    const Rz = [c, -sn, 0, sn, c, 0, 0, 0, 1], Rd = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let s = 0; for (let k = 0; k < 3; k++) s += Rz[3 * i + k] * R0[3 * k + j]; Rd[3 * i + j] = s; }
    const wd = [0, 0, dph], al = [0, 0, ddph];
    // The task law.
    orientationError(Rd, R, eo);
    const vs = [0, 1, 2].map((i) => vd[i] + kx * (pd[i] - p[i])).concat([0, 1, 2].map((i) => wd[i] + ko * eo[i]));
    const as = [0, 1, 2].map((i) => ad[i] + kx * (vd[i] - v[i])).concat([0, 1, 2].map((i) => al[i] + ko * (wd[i] - v[3 + i])));
    // Task → axes.
    const { Jinv } = dampedInverse(J, 6, N, { eps: 0.04, lambdaMax: 0.05 });
    const qds = new Float64Array(N), qdds = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      let s = 0, a = 0;
      for (let i = 0; i < 6; i++) { s += Jinv[k * 6 + i] * vs[i]; a += Jinv[k * 6 + i] * (as[i] - jd[i]); }
      qds[k] = s; qdds[k] = a;
    }
    // The model's torque: inverse dynamics on the measured state, friction by the commanded speed.
    const tid = arm.rnea(qm, qdm, qdds), tfr = jointFriction(qds, { G: D.G, B: D.B, Tcp: D.Tcp, Tcn: D.Tcn, ws: D.ws });
    // Six speed PIs (clamping anti-windup), torque to current.
    for (let j = 0; j < N; j++) {
      const e = qds[j] - qdm[j], ff = Kf * (tid[j] + tfr[j]);
      const vv = Kv[j] * e + I[j] + ff, u = Math.min(lim[j], Math.max(-lim[j], vv));
      if (Ki[j] && (u === vv || Math.sign(Ki[j] * e) !== Math.sign(vv - u))) I[j] += Ki[j] * Ts * e;
      icmd[j] = u / (D.G[j] * D.kt[j]);
    }
    return { p, pd };
  };

  const out = { t: new Float64Array(K + 1), q: [], p: [], pd: [], e: new Float64Array(K + 1) };
  const onGrid = (x) => Math.round(x * 1e9) / 1e9;
  for (let k = 0; ; k++) {
    const t = k === 0 ? 0 : onGrid((k - 1) * Ts + h);
    const { p, pd } = sample(t);
    out.t[k] = k * Ts;
    out.q.push(Array.from(X.subarray(0, N)));
    out.p.push(p); out.pd.push(pd);
    out.e[k] = 1000 * Math.hypot(pd[0] - p[0], pd[1] - p[1], pd[2] - p[2]);
    if (k === K) break;
    rates(X, k1);
    for (let i = 0; i < 2 * N; i++) Xt[i] = X[i] + 0.5 * h * k1[i];
    rates(Xt, k2);
    for (let i = 0; i < 2 * N; i++) Xt[i] = X[i] + 0.5 * h * k2[i];
    rates(Xt, k3);
    for (let i = 0; i < 2 * N; i++) Xt[i] = X[i] + h * k3[i];
    rates(Xt, k4);
    for (let i = 0; i < 2 * N; i++) X[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  }
  return out;
}
