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

test("each linear law's state space reproduces its step() while u is inside its limits", async () => {
  const { CONTROLLERS } = await import('../src/core/controllers.js');
  const Ts = 0.01;
  const cases = [
    ['pid', { Kp: 2, Ki: 3, Kd: 0.4, Tf: 0.02, b: 0.7, Tr: 0, u0: 0, umin: -Infinity, umax: Infinity }, 1],
    ['pid', { Kp: 1.5, Ki: 0, Kd: 0, Tf: 0.01, b: 1, Tr: 0, u0: 0, umin: -Infinity, umax: Infinity }, 1],
    // Reference feedforward: static, velocity and acceleration, alone and together.
    ['pid', { Kp: 2, Ki: 3, Kd: 0.4, Tf: 0.02, b: 0.7, Tr: 0, Kff: 0.8, Kv: 0.3, Ka: 0.02, u0: 0, umin: -Infinity, umax: Infinity, aw: 'back' }, 1],
    ['pid', { Kp: 0, Ki: 0, Kd: 0, Tf: 0.01, b: 1, Tr: 0, Kff: 0, Kv: 0.5, Ka: 0, u0: 0, umin: -Infinity, umax: Infinity }, 1],
    ['pid', { Kp: 1, Ki: 0, Kd: 0, Tf: 0.01, b: 1, Tr: 0, Kff: 0, Kv: 0, Ka: 0.01, u0: 0, umin: -Infinity, umax: Infinity }, 1],
    ['stateFeedback', { K: [1, -2, 0.5], kr: 3, Tr: 0, umin: -Infinity, umax: Infinity }, 3],
    ['gainScheduled', { at: [0, 1], Kp: [1, 3], Ki: [0.5, 2], Tr: 0, u0: 0, umin: -Infinity, umax: Infinity }, 1],
    ['gainScheduled', { at: [0, 1], Kp: [1, 3], Ki: [0.5, 2], Tr: 0, Kff: 1.2, Kv: 0.2, Ka: 0.01, u0: 0, umin: -Infinity, umax: Infinity }, 1],
    ['swingUp', { kE: 1, kx: 0, kv: 0, l: 0.5, g: 9.81, thetaS: 0.4, K: [-1, -30, -2, -5], kr: -1, umin: -Infinity, umax: Infinity }, 4],
  ];
  for (const [type, p, m] of cases) {
    // About an operating point: the scheduled PI at y = 0.5 sees small moves only.
    const y0 = type === 'gainScheduled' ? 0.5 : 0;
    const law = CONTROLLERS[type].make(p, Ts), lin = CONTROLLERS[type].linear(p, Ts, { y: new Array(m).fill(y0) });
    const n = lin.A.length;
    let x = new Array(n).fill(0), worst = 0, u0 = null;
    for (let k = 0; k < 200; k++) {
      const v = k === 0 ? new Array(m + 1).fill(0) : Array.from({ length: m + 1 }, (_, i) => 1e-3 * Math.sin(0.3 * k * (i + 1) + i));
      const inp = v.map((d) => d + y0);
      const uLaw = law.step(inp);
      u0 ??= uLaw;   // the law's output at the operating point
      let u = lin.D[0].reduce((s, d, i) => s + d * v[i], 0);
      for (let j = 0; j < n; j++) u += lin.C[0][j] * x[j];
      x = lin.A.map((row, i) => row.reduce((s, a, j) => s + a * x[j], 0) + lin.B[i].reduce((s, b, j) => s + b * v[j], 0));
      worst = Math.max(worst, Math.abs(uLaw - u0 - u));
    }
    // The scheduled PI's slope term is second order in the small moves; Ka/Ts² is large, so its rounding is too.
    assert.ok(worst < (type === 'gainScheduled' ? 1e-5 : 1e-10), `${type}: worst ${worst}`);
  }
  const swing = cases.find((c) => c[0] === 'swingUp')[1];
  assert.throws(() => CONTROLLERS.swingUp.linear(swing, Ts, { y: [0, Math.PI, 0, 0] }), /pumps energy/);
});

test('dead time is exact in the discrete loop, and the step response reaches the textbook final values', async () => {
  const { openLoop, respondAt, stepResponse } = await import('../src/core/analysis.js');
  const { CONTROLLERS } = await import('../src/core/controllers.js');
  const Ts = 0.01, G = { A: [[-1]], B: [[1]], C: [[1]], D: [[0]] };
  const P = (K) => CONTROLLERS.pid.linear({ Kp: K, Ki: 0, Kd: 0, Tf: 0.01, b: 1 }, Ts);
  const L0 = openLoop(G, P(2), Ts), L5 = openLoop({ ...G, delay: [0.05] }, P(2), Ts);
  assert.equal(L5.n - L0.n, 5);
  for (const w of [0.3, 3, 30]) {
    const a = respondAt(L0, w), b = respondAt(L5, w), c = Math.cos(-5 * w * Ts), s = Math.sin(-5 * w * Ts);
    assert.ok(Math.hypot(b.re - (a.re * c - a.im * s), b.im - (a.re * s + a.im * c)) < 1e-9, `ω ${w}`);
  }
  const p = stepResponse(G, P(4), Ts, 1000);
  assert.ok(Math.abs(p.y.at(-1) - 0.8) < 1e-6 && Math.abs(p.u.at(-1) - 0.8) < 1e-6, `${p.y.at(-1)} ${p.u.at(-1)}`);
  const pi = stepResponse({ ...G, delay: [0.05] }, CONTROLLERS.pid.linear({ Kp: 1, Ki: 2, Kd: 0, Tf: 0.01, b: 1 }, Ts), Ts, 2000);
  assert.ok(Math.abs(pi.y.at(-1) - 1) < 1e-4, `${pi.y.at(-1)}`);
  assert.equal(pi.y[5], 0, 'nothing arrives before the dead time');
});
