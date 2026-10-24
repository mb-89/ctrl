import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeLoop, openLoop, closedLoop, respondAt } from '../src/core/analysis.js';

// L(s) = 2 / (s (s + 1)(0.5 s + 1)) = 4 / (s³ + 3 s² + 2 s): phase −180° at
// ω = √2 rad/s with |L| = 2/3, so the gain margin is 1.5.
const plant = { A: [[0, 1, 0], [0, 0, 1], [0, -2, -3]], B: [[0], [0], [1]], C: [[4, 0, 0]], D: [[0]] };
// A P controller without states: u = 1·r − 1·y.
const pCtrl = { A: [], B: [], C: [[]], D: [[1, -1]] };

test('a fast-sampled loop reproduces the continuous margins', () => {
  const a = analyzeLoop(plant, pCtrl, 1e-3, { points: 2000 });
  const pc = a.margins.phaseCrossings[0];
  assert.ok(Math.abs(pc.w - Math.SQRT2) < 0.01, `w180 ${pc.w}`);
  // The ZOH adds a small lag (ωTs/2), so the margin is a little below 1.5.
  assert.ok(Math.abs(a.margins.gmUp - 1.5) < 0.01, `GM ${a.margins.gmUp}`);
  assert.ok(a.stable && a.Z === 0 && a.P === 0, 'stable, no unstable poles');
  // Crossover at ω ≈ 1.14 rad/s, phase −168.4°: PM ≈ 11.6°, minus a little for the ZOH.
  assert.ok(Math.abs(a.margins.pm - 11.6) < 0.5 && Math.abs(a.margins.wc - 1.14) < 0.02, `PM ${a.margins.pm} at ${a.margins.wc}`);
  assert.ok(a.margins.ms > 1.5 && Number.isFinite(a.margins.ms));
  assert.ok(a.margins.dm > 0 && a.margins.dmSamples > 100);
});

test('the root locus crosses the unit circle near the gain margin', () => {
  const L = openLoop(plant, pCtrl, 1e-3);
  const outside = (k) => closedLoop(L, k).some((p) => Math.hypot(p.re, p.im) > 1);
  assert.equal(outside(1.45), false);
  assert.equal(outside(1.55), true);
});

test('the discrete response matches the continuous one well below Nyquist', () => {
  const L = openLoop(plant, pCtrl, 1e-3);
  const g = respondAt(L, 1);   // continuous: 4 / (j(−1 + 2 + 3j)… ) = 4 / (−3 + j(2 − 1))
  const s = { re: 0, im: 1 }, den = { re: -3 * 1, im: -1 + 2 };   // s³ + 3s² + 2s at s = j: −j − 3 + 2j
  const ref = { re: (4 * den.re) / (den.re ** 2 + den.im ** 2), im: (-4 * den.im) / (den.re ** 2 + den.im ** 2) };
  assert.ok(Math.hypot(g.re - ref.re, g.im - ref.im) < 0.01 * Math.hypot(ref.re, ref.im), `${JSON.stringify(g)} vs ${JSON.stringify(ref)}`);
  void s;
});

test('an open-loop unstable plant stabilised by feedback counts P = 1, Z = 0, N = −1', () => {
  // G(s) = 1/(s − 1) with u = −3 y: closed loop s + 2.
  const g = { A: [[1]], B: [[1]], C: [[1]], D: [[0]] }, k = { A: [], B: [], C: [[]], D: [[0, -3]] };
  const a = analyzeLoop(g, k, 1e-3);
  assert.equal(a.P, 1);
  assert.equal(a.Z, 0);
  assert.equal(a.N, -1);
  const s = a.clPoles[0].s;
  assert.ok(Math.abs(s.re + 2) < 0.01, `pole ${s.re}`);
});
