// The PUMA 560 in the library (design/output/robot.md §11, tests 12, 15–18):
// the compiled system against the loop written plainly, what each variant
// tracks, the run inside the arm's limits, the designs per lane, the view's
// bindings, and the run's cost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PUMA_SYSTEM } from '../src/core/pumasystem.js';
import { PUMA560 } from '../src/core/puma560.js';
import { parseUrdf } from '../src/core/urdf.js';
import { normalizeDiagram, diagramNames } from '../src/core/diagram.js';
import { simulateSystem } from '../src/core/sim.js';
import { normalizeReference } from '../src/core/signals.js';
import { normalizeView } from '../src/core/views.js';
import { pumaReference } from './puma-reference.mjs';
import { createRbd } from '../src/core/rbd.js';

const signals = Object.fromEntries(Object.entries(PUMA_SYSTEM.signals).map(([k, r]) => [k, normalizeReference(r)]));
const withVariant = (v) => {
  const d = structuredClone(PUMA_SYSTEM.diagram);
  d.blocks.find((b) => b.id === 'ctl').diagram.blocks.find((b) => b.id === 'servos').variant = v;
  return normalizeDiagram(d);
};
const runs = new Map();
const run = (v) => {
  if (!runs.has(v)) {
    const t0 = performance.now();
    const out = simulateSystem(withVariant(v), signals, { duration: 5, sampleTime: 0.001 });
    out.ms = performance.now() - t0;
    runs.set(v, out);
  }
  return runs.get(v);
};
const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
const peak = (a) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

test('the compiled PUMA equals the loop written plainly, every variant, over 5 s to 1e-12', () => {
  for (const v of [0, 1, 2]) {
    const out = run(v), ref = pumaReference({ variant: v });
    let dq = 0, dp = 0;
    for (let k = 0; k < ref.t.length; k++) {
      for (let j = 0; j < 6; j++) dq = Math.max(dq, Math.abs(out.signals[`q${j + 1}`][k] - ref.q[k][j]));
      ['x', 'y', 'z'].forEach((c, i) => { dp = Math.max(dp, Math.abs(out.signals[c][k] - ref.p[k][i]), Math.abs(out.signals[`${c}r`][k] - ref.pd[k][i])); });
    }
    assert.ok(dq < 1e-12, `variant ${v}: |Δq| ${dq}`);
    assert.ok(dp < 1e-12, `variant ${v}: |Δp| ${dp}`);
  }
});

test('what a model buys: 0.01 mm with the feedforward, 1.3 mm without, 10 mm with P alone', () => {
  const [model, pi, p] = [0, 1, 2].map((v) => run(v).signals);
  assert.ok(rms(model.e) < 0.03, `with the model ${rms(model.e)} mm`);
  assert.ok(rms(pi.e) > 0.5 && rms(pi.e) < 3, `PI ${rms(pi.e)} mm`);
  assert.ok(rms(p.e) > 8, `P only ${rms(p.e)} mm`);
  // The two components in the circle's frame are what e is made of.
  for (let k = 0; k < model.e.length; k += 97) assert.ok(Math.abs(Math.hypot(model.ea[k], model.eb[k], model.ec[k]) - model.e[k]) < 1e-12);
});

test('the probe\'s circle moves every joint and stays inside the arm: limits, singularities, currents; no report', () => {
  const out = run(0), s = out.signals, joints = parseUrdf(PUMA560.urdfProbe).joints;
  assert.deepEqual(out.info.validity, []);
  assert.deepEqual(out.info.warnings, []);
  joints.forEach((j, k) => {
    const q = s[`q${k + 1}`];
    const lo = Math.min(...q), hi = Math.max(...q);
    assert.ok(lo - j.lower >= 5 * Math.PI / 180 && j.upper - hi >= 5 * Math.PI / 180, `${j.name}: ${lo}…${hi} against ${j.lower}…${j.upper}`);
    // Every axis moves visibly (inputs 40, 41): at least 30° peak to peak.
    assert.ok(hi - lo >= 30 * Math.PI / 180, `${j.name} moves ${(hi - lo) * 180 / Math.PI}°`);
  });
  assert.ok(Math.min(...s.sigma) >= 0.05, `σ_min ${Math.min(...s.sigma)}`);
  assert.ok(Math.min(...s.q5.map(Math.abs)) >= 9 * Math.PI / 180, 'the wrist stays clear of q5 = 0');
  PUMA560.drive.fuse.forEach((f, k) => assert.ok(peak(s[`i${k + 1}`]) < f, `i${k + 1} ${peak(s[`i${k + 1}`])} A against its fuse ${f} A`));
  // Every torque and its shares are signals; the shares add up to the joint torque less friction, which the arm does not see.
  for (let k = 1; k < s.tau1.length; k += 101) for (let j = 1; j <= 6; j++) assert.ok(Math.abs(s[`tauI${j}`][k] + s[`tauC${j}`][k] + s[`tauG${j}`][k] - s[`tau${j}`][k]) < 1e-9, `tau${j} at ${k}`);
});

test('a circle too fast runs a joint beyond its speed limit, reported once with the time', () => {
  const fast = structuredClone(PUMA_SYSTEM.signals);
  fast.a_r.components[0].params.frequency = 0.6; fast.b_r.components[0].params.frequency = 0.6;
  const out = simulateSystem(withVariant(0), Object.fromEntries(Object.entries(fast).map(([k, r]) => [k, normalizeReference(r)])), { duration: 5, sampleTime: 0.001 });
  assert.ok(out.info.validity.some((r) => /(faster than its limit|left its range) .* at \d+\.\d+ s/.test(r)), out.info.validity.join('; '));
});

test('the probe touches the circle tilted 30° from the vertical, its stylus turning once per turn of the circle', () => {
  const s = run(0).signals;
  // The pointing error stays small; the stylus's direction (from the tool's pose) turns about the vertical.
  assert.ok(peak(s.eo) < 0.05, `pointing ${peak(s.eo)}°`);
  const rbd = createRbd(parseUrdf(PUMA560.urdfProbe));
  const az = [], tilt = [];
  for (let k = 0; k < s.q1.length; k += 50) {
    const { R } = rbd.linkPose([1, 2, 3, 4, 5, 6].map((j) => s[`q${j}`][k]), 'tip');
    az.push(Math.atan2(R[5], R[2])); tilt.push(Math.acos(-R[8]) * 180 / Math.PI);
  }
  for (const t of tilt) assert.ok(Math.abs(t - 30) < 0.1, `tilt ${t}°`);
  let turned = 0;
  for (let k = 1; k < az.length; k++) { let d = az[k] - az[k - 1]; d -= 2 * Math.PI * Math.round(d / (2 * Math.PI)); turned += d; }
  assert.ok(Math.abs(Math.abs(turned) / (2 * Math.PI) - 0.95) < 0.02, `the stylus turned ${turned / (2 * Math.PI)} turns`);
});

test('the axis gains come from the plant, per lane: b, Kv = 2ζω/b, Ki = ω²/b, u0 holds the start pose', () => {
  const designs = run(1).info.designs;
  assert.equal(designs.length, 6);
  const plan = { Kv: [155.7, 230.2, 55.7, 11.55, 10.34, 11.65], Ki: [2335, 3453, 836, 173, 155, 175] };
  designs.forEach((d, k) => {
    assert.equal(d.status, 'ok', d.error?.message);
    const row = (l) => d.rows.find((r) => r.label === l).value;
    assert.ok(Math.abs(row('Kv') / plan.Kv[k] - 1) < 0.01 && Math.abs(row('Ki') / plan.Ki[k] - 1) < 0.01, `lane ${k + 1}: Kv ${row('Kv')}, Ki ${row('Ki')}`);
  });
  // Without the model, u0 is the gravity that holds the start pose (14.31, 5.55 N·m on joints 2 and 3).
  const u0 = designs.map((d) => d.rows.find((r) => r.label === 'u0').value);
  assert.ok(Math.abs(u0[1] - 14.31) < 0.01 && Math.abs(u0[2] - 5.55) < 0.01 && Math.abs(u0[0]) < 1e-9, u0.join(', '));
  assert.ok(run(0).info.designs.every((d) => d.rows.find((r) => r.label === 'u0').value === 0));
});

test('the 3D view binds to visible Sinks; the reference path is the circle of 0.08 m to 1e-9', () => {
  const view = normalizeView(PUMA_SYSTEM.views[0]);
  const { sinks } = diagramNames(normalizeDiagram(PUMA_SYSTEM.diagram));
  for (let j = 1; j <= 6; j++) assert.ok(sinks.includes(`${view.joints}${j}`));
  for (const pth of view.paths) for (const c of ['x', 'y', 'z']) assert.ok(sinks.includes(pth[c]), pth[c]);
  const s = run(0).signals, cx = s.xr[0] + 0.08, cy = s.yr[0];
  for (let k = 0; k < s.xr.length; k += 7) {
    assert.ok(Math.abs(Math.hypot(s.xr[k] - cx, s.yr[k] - cy) - 0.08) < 1e-9);
    assert.ok(Math.abs(s.zr[k] - s.zr[0]) < 1e-12);
  }
});

test('a 5 s run takes about 0.6 s in Node (logged; held to 3 s on a busy machine)', () => {
  const out = simulateSystem(withVariant(0), signals, { duration: 5, sampleTime: 0.001 });
  console.log(`PUMA 5 s run: ${out.info.ms.toFixed(0)} ms (${out.info.steps} steps)`);
  assert.ok(out.info.ms < 3000);
});
