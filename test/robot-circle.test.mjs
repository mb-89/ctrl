// The PUMA 560's circle, followed kinematically with the robot core
// (tools/robot-demo.mjs): the placement the plan chose must stay inside every
// joint's range and away from singularities, and the torques it takes must be
// within the drives' fuses. These are the plan's numbers, re-measured on our
// own URDF and code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { circleFollow, easedPhase } from '../tools/robot-demo.mjs';

const DEG = 180 / Math.PI;
const run = circleFollow();
const n = 6, N = run.t.length;
const range = (a, j) => { let lo = Infinity, hi = -Infinity; for (let s = 0; s < N; s++) { lo = Math.min(lo, a[s * n + j]); hi = Math.max(hi, a[s * n + j]); } return [lo, hi]; };

test('circle: the eased phase starts at rest and joins the steady rate smoothly (C²)', () => {
  const w = 2 * Math.PI / 2.5, Te = 0.5;
  const a = easedPhase(0, w, Te);
  assert.deepEqual([a.phi, a.dphi, a.ddphi], [0, 0, 0]);
  const b = easedPhase(Te - 1e-12, w, Te), c = easedPhase(Te, w, Te);
  assert.ok(Math.abs(b.phi - c.phi) < 1e-10 && Math.abs(b.dphi - c.dphi) < 1e-9 && Math.abs(b.ddphi - c.ddphi) < 1e-9);
  // Its derivatives are the derivatives.
  for (const t of [0.1, 0.3, 0.45, 1.2]) {
    const h = 1e-6, p = easedPhase(t + h, w, Te), m = easedPhase(t - h, w, Te), x = easedPhase(t, w, Te);
    assert.ok(Math.abs((p.phi - m.phi) / (2 * h) - x.dphi) < 1e-7 && Math.abs((p.dphi - m.dphi) / (2 * h) - x.ddphi) < 1e-6);
  }
});

test('circle: the reference is a circle of 0.15 m through the start point, centred towards the base; the tool follows it', () => {
  const c = [run.origin[0] - 0.15, run.origin[1], run.origin[2]];
  let worst = 0;
  for (let s = 0; s < N; s++) worst = Math.max(worst, Math.abs(Math.hypot(run.pRef[3 * s] - c[0], run.pRef[3 * s + 1] - c[1], run.pRef[3 * s + 2] - c[2]) - 0.15));
  assert.ok(worst < 1e-9, `${worst}`);
  assert.deepEqual(c.map((v) => +v.toFixed(3)), [0.580, -0.150, 0.726]);
  assert.ok(Math.max(...run.error) < 1e-9, 'closed-loop IK holds the path');
  assert.ok(Math.max(...run.orient) < 1e-12, 'and the tool pointing down');
});

test('circle: every joint stays at least 18° inside its range, σ_min within 0.175 … 0.256, speeds within the limits', () => {
  const lim = run.model.joints;
  const margin = lim.map((j, i) => { const [lo, hi] = range(run.q, i); return Math.min(lo - j.lower, j.upper - hi) * DEG; });
  assert.ok(Math.min(...margin) > 18, margin.join(', '));
  assert.deepEqual(range(run.q, 2).map((v) => Math.round(v * DEG)), [-207, -149]);
  assert.deepEqual([Math.min(...run.sigma), Math.max(...run.sigma)].map((v) => +v.toFixed(3)), [0.175, 0.256]);
  const speed = lim.map((_, i) => Math.max(...range(run.qd, i).map(Math.abs)));
  assert.deepEqual(speed.map((v) => +v.toFixed(2)), [0.88, 0.73, 1.21, 0, 0.5, 0.88]);
  speed.forEach((v, i) => assert.ok(v < lim[i].velocity, lim[i].name));
});

test('circle: the joint torques stay within the fuses; shoulder and elbow carry gravity, the waist mostly friction', () => {
  const { total, gravity, friction, inertial, coriolis } = run.tau;
  const peak = (a, j) => Math.max(...range(a, j).map(Math.abs));
  run.model.joints.forEach((jt, j) => assert.ok(peak(total, j) < jt.effort, `${jt.name}: ${peak(total, j)} N·m`));
  // At the start, at rest: the torques that hold the arm (35.71, 7.84 N·m) plus friction's 0 at rest.
  assert.deepEqual([total[1], total[2]].map((v) => +v.toFixed(2)), [35.71, 7.84]);
  assert.ok(peak(gravity, 1) > 30 && peak(gravity, 0) === 0);
  assert.ok(peak(friction, 0) > 0.8 * peak(total, 0), 'the waist works against its friction');
  for (let s = 0; s < N; s++) for (let j = 0; j < n; j++) {
    const k = s * n + j;
    assert.ok(Math.abs(inertial[k] + coriolis[k] + gravity[k] + friction[k] - total[k]) < 1e-12);
  }
});
