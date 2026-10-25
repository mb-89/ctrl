// The PUMA 560 in the library (design/output/robot.md §11, tests 12, 15–18):
// the compiled system against the loop written plainly, what each variant
// tracks, the run inside the arm's limits, the designs per lane, the view's
// bindings, and the run's cost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PUMA_SYSTEM, PUMA_START } from '../src/core/pumasystem.js';
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
    const out = simulateSystem(withVariant(v), signals, { duration: 10, sampleTime: 0.001 });
    out.ms = performance.now() - t0;
    runs.set(v, out);
  }
  return runs.get(v);
};
// The circle's centre: the middle of the reference path's extent.
const centre = (s) => [(Math.max(...s.xr) + Math.min(...s.xr)) / 2, (Math.max(...s.yr) + Math.min(...s.yr)) / 2];
const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
const peak = (a) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

test('the compiled PUMA equals the loop written plainly, every variant, over a 10 s period to 1e-12', () => {
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

test('what a model buys: 0.017 mm with the feedforward, 1.4 mm without, 9.5 mm with P alone', () => {
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
    assert.ok(lo - j.lower >= 15 * Math.PI / 180 && j.upper - hi >= 15 * Math.PI / 180, `${j.name}: ${lo}…${hi} against ${j.lower}…${j.upper}`);
    // Every axis moves visibly (inputs 40, 41): at least 30° peak to peak.
    assert.ok(hi - lo >= 30 * Math.PI / 180, `${j.name} moves ${(hi - lo) * 180 / Math.PI}°`);
  });
  assert.ok(Math.min(...s.sigma) >= 0.08, `σ_min ${Math.min(...s.sigma)}`);
  assert.ok(Math.min(...s.q5.map(Math.abs)) >= 9 * Math.PI / 180, 'the wrist stays clear of q5 = 0');
  PUMA560.drive.fuse.forEach((f, k) => assert.ok(peak(s[`m${k + 1}_i`]) < f, `m${k + 1}_i ${peak(s[`m${k + 1}_i`])} A against its fuse ${f} A`));
  // Every torque and its shares are signals; the shares add up to the joint torque less friction, which the arm does not see.
  for (let k = 1; k < s.tau1.length; k += 101) for (let j = 1; j <= 6; j++) assert.ok(Math.abs(s[`tauI${j}`][k] + s[`tauC${j}`][k] + s[`tauG${j}`][k] - s[`tau${j}`][k]) < 1e-9, `tau${j} at ${k}`);
});

test('a circle too fast runs a joint beyond its speed limit, reported once with the time', () => {
  // Round and back in 3 s instead of 10.
  const fast = structuredClone(PUMA_SYSTEM.signals);
  for (const k of ['a_r', 'b_r']) { fast[k].period = 3; fast[k].components[0].expr = fast[k].components[0].expr.replace('/10', '/3'); }
  const out = simulateSystem(withVariant(0), Object.fromEntries(Object.entries(fast).map(([k, r]) => [k, normalizeReference(r)])), { duration: 10, sampleTime: 0.001 });
  assert.ok(out.info.validity.some((r) => /(faster than its limit|left its range) .* at \d+\.\d+ s/.test(r)), out.info.validity.join('; '));
});

test('the probe looks onto the inside of the circle at 45° all the way round; the drawn probe is the modelled one', () => {
  const s = run(0).signals;
  assert.ok(peak(s.eo) < 0.05, `orientation error ${peak(s.eo)}°`);
  const model = parseUrdf(PUMA_SYSTEM.diagram.robots.puma560.urdf), rbd = createRbd(model);
  const az = [];
  for (let k = 0; k < s.q1.length; k += 50) {
    const q = [1, 2, 3, 4, 5, 6].map((j) => s[`q${j}`][k]), { R, p } = rbd.linkPose(q, 'tip');
    assert.ok(Math.abs(Math.acos(-R[8]) * 180 / Math.PI - 45) < 0.1, `tilt at ${k}`);
    // The stylus leans in towards the circle's centre: its horizontal part points from the ball to the centre.
    const ctr = centre(s), toC = [ctr[0] - p[0], ctr[1] - p[1]], h = Math.hypot(R[2], R[5]);
    assert.ok((R[2] * toC[0] + R[5] * toC[1]) / (h * Math.hypot(...toC)) > 0.999, `inward at ${k}`);
    az.push(Math.atan2(R[5], R[2]));
  }
  // Round once and back: the stylus's azimuth goes a full turn out and returns.
  let turned = 0, most = 0;
  for (let k = 1; k < az.length; k++) { let d = az[k] - az[k - 1]; d -= 2 * Math.PI * Math.round(d / (2 * Math.PI)); turned += d; most = Math.max(most, Math.abs(turned)); }
  assert.ok(Math.abs(most / (2 * Math.PI) - 1) < 0.01 && Math.abs(turned) < 0.05, `the stylus turned ${most / (2 * Math.PI)} turns out, ${turned / (2 * Math.PI)} at the end`);
  // One description draws and models it: the ball's visual sits at the tool point (tip), the
  // blocks' tool is the last link, and the stylus's mass is in the arm's (and the model's) gravity.
  const tipLink = model.links.find((l) => l.name === 'tip');
  assert.ok(tipLink.visuals.some((v) => v.geom.type === 'sphere' && Math.hypot(...v.origin.p) === 0));
  assert.equal(model.links.at(-1).name, 'tip');
  const q0 = PUMA_START.map((v) => v * Math.PI / 180);
  const bare = createRbd(parseUrdf(PUMA560.urdf)).gravityTorque(q0), probe = rbd.gravityTorque(q0);
  // What the probe adds is 0.1 kg at its centre of mass (40 mm along the stylus): τ = J_vᵀ·m·g there.
  const com = (q) => { const { R, p } = rbd.linkPose(q, 'probe'); return [0, 1, 2].map((i) => p[i] + 0.04 * R[3 * i + 2]); };
  q0.forEach((_, j) => {
    const a = q0.slice(), b = q0.slice(); a[j] += 1e-6; b[j] -= 1e-6;
    const dzdq = (com(a)[2] - com(b)[2]) / 2e-6;
    assert.ok(Math.abs(probe[j] - bare[j] - 0.1 * 9.81 * dzdq) < 1e-6, `joint ${j + 1}: the probe adds ${probe[j] - bare[j]} N·m, its mass ${0.1 * 9.81 * dzdq}`);
  });
});

test('the axis gains come from the plant, per lane: b, Kv = 2ζω/b, Ki = ω²/b, u0 holds the start pose', () => {
  const designs = run(1).info.designs;
  assert.equal(designs.length, 6);
  const plan = { Kv: [191.2, 240.2, 55.4, 11.5, 10.3, 11.7], Ki: [2869, 3604, 831, 173, 155, 175] };
  designs.forEach((d, k) => {
    assert.equal(d.status, 'ok', d.error?.message);
    const row = (l) => d.rows.find((r) => r.label === l).value;
    assert.ok(Math.abs(row('Kv') / plan.Kv[k] - 1) < 0.01 && Math.abs(row('Ki') / plan.Ki[k] - 1) < 0.01, `lane ${k + 1}: Kv ${row('Kv')}, Ki ${row('Ki')}`);
  });
  // Without the model, u0 is the gravity that holds the start pose (26.98, 3.61 N·m on joints 2 and 3).
  const u0 = designs.map((d) => d.rows.find((r) => r.label === 'u0').value);
  assert.ok(Math.abs(u0[1] - 26.98) < 0.01 && Math.abs(u0[2] - 3.61) < 0.01 && Math.abs(u0[0]) < 1e-9, u0.join(', '));
  assert.ok(run(0).info.designs.every((d) => d.rows.find((r) => r.label === 'u0').value === 0));
});

test('the 3D view binds to visible Sinks; the reference path is the circle of 0.08 m to 1e-6', () => {
  const view = normalizeView(PUMA_SYSTEM.views[0]);
  const { sinks } = diagramNames(normalizeDiagram(PUMA_SYSTEM.diagram));
  for (let j = 1; j <= 6; j++) assert.ok(sinks.includes(`${view.joints}${j}`));
  for (const pth of view.paths) for (const c of ['x', 'y', 'z']) assert.ok(sinks.includes(pth[c]), pth[c]);
  const s = run(0).signals, [cx, cy] = centre(s);
  for (let k = 0; k < s.xr.length; k += 7) {
    assert.ok(Math.abs(Math.hypot(s.xr[k] - cx, s.yr[k] - cy) - 0.08) < 1e-6);
    assert.ok(Math.abs(s.zr[k] - s.zr[0]) < 1e-12);
  }
});

test('the run repeats: three periods alike, no jump at a period\'s end (input 52)', () => {
  const s = simulateSystem(withVariant(0), signals, { duration: 30, sampleTime: 0.001 }).signals, per = 10000;
  let d = 0, wrap = 0;
  for (const n of ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'tau2', 'tau3']) for (let i = 0; i < per; i++) d = Math.max(d, Math.abs(s[n][2 * per + i] - s[n][per + i]));
  for (const w of [per, 2 * per]) for (let i = w - 50; i < w + 50; i++) wrap = Math.max(wrap, s.e[i]);
  assert.ok(d < 1e-3, `period 3 against period 2: ${d}`);
  assert.ok(wrap < 0.01, `the error at a period's end: ${wrap} mm`);
});

test('a 10 s run takes about 1.2 s in Node (logged; held to 6 s on a busy machine)', () => {
  const out = simulateSystem(withVariant(0), signals, { duration: 10, sampleTime: 0.001 });
  console.log(`PUMA 10 s run: ${out.info.ms.toFixed(0)} ms (${out.info.steps} steps)`);
  assert.ok(out.info.ms < 6000);
});
