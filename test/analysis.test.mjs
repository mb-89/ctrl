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
    ['stateFeedback', { K: [1, -2, 0.5], kr: 3, Tr: 0, umin: -Infinity, umax: Infinity }, 3],
    ['gainScheduled', { at: [0, 1], Kp: [1, 3], Ki: [0.5, 2], Tr: 0, u0: 0, umin: -Infinity, umax: Infinity }, 1],
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
    // The scheduled PI's slope term is second order in the small moves.
    assert.ok(worst < (type === 'gainScheduled' ? 1e-5 : 1e-12), `${type}: worst ${worst}`);
  }
  assert.throws(() => CONTROLLERS.swingUp.linear(cases[4][1], Ts, { y: [0, Math.PI, 0, 0] }), /pumps energy/);
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

// ---- Review fixes: gain interval, grid, step, poles on the circle, dead time

// The closed loop is stable for the loop gain scaled by k (eigenvalues only).
const stableAt = (L, k) => closedLoop(L, k).every((p) => Math.hypot(p.re, p.im) < 1);
// The edge of stability between a stable gain a and an unstable gain b, by bisection on the poles.
function edge(L, a, b) {
  for (let i = 0; i < 60; i++) { const m = Math.sqrt(a * b); if (stableAt(L, m)) a = m; else b = m; }
  return Math.sqrt(a * b);
}

test('the gain interval includes the crossings at z = 1 and z = −1', async () => {
  const { CONTROLLERS } = await import('../src/core/controllers.js');
  // 1/(s + 1) with P = 2 at Ts = 0.1: L(−1) = −2b/(1 + a) is negative, so the
  // loop crosses −1 at z = −1 for the gain (1 + a)/(2b); no phase crossing inside the band.
  const Ts = 0.1, a = Math.exp(-Ts), b = 1 - a, G = { A: [[-1]], B: [[1]], C: [[1]], D: [[0]] };
  const first = analyzeLoop(G, CONTROLLERS.pid.linear({ Kp: 2, Ki: 0, Kd: 0, Tf: 0.01, b: 1 }, Ts), Ts);
  assert.ok(Math.abs(first.margins.gmUp / ((1 + a) / (2 * b)) - 1) < 1e-9, `gmUp ${first.margins.gmUp}`);
  assert.equal(first.margins.gmDown, 0);
  assert.equal(first.margins.phaseCrossings.find((c) => c.gm === first.margins.gmUp).at, 'nyquist');
  // 1/(s − 1) with u = −3y at Ts = 1 ms: unstable below k = 1/3 (L(1) = −3 at
  // z = 1) and above (e^Ts + 1)/(3(e^Ts − 1)) ≈ 667 (z = −1).
  const T2 = 1e-3, e = Math.exp(T2), U = { A: [[1]], B: [[1]], C: [[1]], D: [[0]] }, k3 = { A: [], B: [], C: [[]], D: [[0, -3]] };
  const un = analyzeLoop(U, k3, T2), Lu = openLoop(U, k3, T2);
  assert.ok(Math.abs(un.margins.gmDown - 1 / 3) < 1e-9, `gmDown ${un.margins.gmDown}`);
  assert.ok(Math.abs(un.margins.gmUp / ((e + 1) / (3 * (e - 1))) - 1) < 1e-9, `gmUp ${un.margins.gmUp}`);
  assert.ok(!stableAt(Lu, 0.33) && stableAt(Lu, 0.34) && stableAt(Lu, 666) && !stableAt(Lu, 668));
});

test("the library pendulum's catch loop: its gain interval is the poles' stable range on both sides", async () => {
  const { CONTROLLERS } = await import('../src/core/controllers.js');
  const { EXAMPLE_PLANTS } = await import('../src/core/plants.js');
  const { ELEMENTS } = await import('../src/core/diagram.js');
  const entry = EXAMPLE_PLANTS.find((e) => e.name === 'Pendulum swing-up');
  const blk = entry.diagram.blocks, cart = blk.find((b) => b.type === 'cartPole').params, swing = blk.find((b) => b.type === 'controller').variants[0].params;
  // The cart–pole block linearised upright by central differences; its state
  // is [x, v, θ, ω], the controller reads [x, θ, v, ω].
  const f = (X, u) => { const d = new Array(4); ELEMENTS.cartPole.ode.f(X, 0, u, cart, d); return d; };
  const h = 1e-6, A = [[], [], [], []], B = [];
  for (let j = 0; j < 4; j++) {
    const xp = [0, 0, 0, 0], xm = [0, 0, 0, 0]; xp[j] = h; xm[j] = -h;
    const fp = f(xp, 0), fm = f(xm, 0);
    for (let i = 0; i < 4; i++) A[i][j] = (fp[i] - fm[i]) / (2 * h);
  }
  const up = f([0, 0, 0, 0], h), down = f([0, 0, 0, 0], -h);
  for (let i = 0; i < 4; i++) B.push([(up[i] - down[i]) / (2 * h)]);
  const cartPole = { A, B, C: [[1, 0, 0, 0], [0, 0, 1, 0], [0, 1, 0, 0], [0, 0, 0, 1]], D: [[0], [0], [0], [0]] };
  const Ts = 0.01, ctrl = CONTROLLERS.swingUp.linear(swing, Ts, { y: [0, 0, 0, 0] });
  const res = analyzeLoop(cartPole, ctrl, Ts), L = openLoop(cartPole, ctrl, Ts);
  assert.ok(res.stable && res.P === 1, 'the upright pendulum is open-loop unstable and caught');
  // Before the fix the interval read ×0.349 … ∞: the upper edge, a crossing at z = −1, was missed.
  const lo = edge(L, 1, 0.01), hi = edge(L, 1, 100);
  assert.ok(Number.isFinite(res.margins.gmUp) && Math.abs(res.margins.gmUp / hi - 1) < 1e-6, `gmUp ${res.margins.gmUp}, poles ${hi}`);
  assert.ok(Math.abs(res.margins.gmDown / lo - 1) < 1e-6, `gmDown ${res.margins.gmDown}, poles ${lo}`);
});

test('the frequency grid starts below the loop: a slow crossover at fast sampling keeps its margins', async () => {
  const { CONTROLLERS } = await import('../src/core/controllers.js');
  // 1/(s + 1) with PI Kp = Ki = 0.2: L = 0.2/s, crossover 0.2 rad/s, PM ≈ 90°.
  const G = { A: [[-1]], B: [[1]], C: [[1]], D: [[0]] };
  for (const Ts of [0.01, 0.001]) {
    const a = analyzeLoop(G, CONTROLLERS.pid.linear({ Kp: 0.2, Ki: 0.2, Kd: 0, Tf: 0.01, b: 1 }, Ts), Ts);
    assert.ok(a.fd.w[0] < 0.05, `grid from ${a.fd.w[0]} rad/s`);
    assert.ok(Math.abs(a.margins.wc - 0.2) < 1e-3 && Math.abs(a.margins.pm - 90) < 1, `Ts ${Ts}: PM ${a.margins.pm} at ${a.margins.wc}`);
    assert.ok(Math.abs(a.margins.dm - (Math.PI / 2) / 0.2) < 0.1, `DM ${a.margins.dm}`);
  }
  // An integrating plant K/s with K = 0.1 at Ts = 1 ms: one gain crossing at 0.1 rad/s.
  const I = analyzeLoop({ A: [[0]], B: [[1]], C: [[1]], D: [[0]] }, { A: [], B: [], C: [[]], D: [[0.1, -0.1]] }, 0.001);
  assert.equal(I.margins.gainCrossings.length, 1);
  assert.ok(Math.abs(I.margins.wc - 0.1) < 1e-3, `wc ${I.margins.wc}`);
});

test('the step: final value from the DC gain, and a response not settled in its window says so', async () => {
  const { CONTROLLERS } = await import('../src/core/controllers.js');
  const { stepInfo } = await import('../src/core/analysis.js');
  const G = { A: [[-1]], B: [[1]], C: [[1]], D: [[0]] }, Ts = 0.001;
  const pi = CONTROLLERS.pid.linear({ Kp: 0.2, Ki: 0.2, Kd: 0, Tf: 0.01, b: 1 }, Ts);
  const res = analyzeLoop(G, pi, Ts);
  // The closed loop is 0.2/(s + 0.2): final value 1, settles (2 %) at ln 50 / 0.2 ≈ 19.56 s.
  // Before: 4000 samples (4 s) read final value 0.551, settles 3.88 s.
  const st = stepInfo(G, pi, Ts, { clPoles: res.clPoles });
  assert.ok(Math.abs(st.yf - 1) < 1e-9, `final ${st.yf}`);
  assert.ok(st.settled && Math.abs(st.settle - Math.log(50) / 0.2) < 0.05, `settles ${st.settle}`);
  assert.ok(st.overshoot < 1e-6 && st.T >= 40);
  // Cut to 4 s, it has not settled; the final value is still the DC gain.
  const cut = stepInfo(G, pi, Ts, { T: 4 });
  assert.equal(cut.settled, false);
  assert.ok(Number.isNaN(cut.settle) && Math.abs(cut.yf - 1) < 1e-9);
  // A P loop's final value is K/(1 + K), not 1.
  const p = stepInfo(G, CONTROLLERS.pid.linear({ Kp: 4, Ki: 0, Kd: 0, Tf: 0.01, b: 1 }, 0.01), 0.01);
  assert.ok(Math.abs(p.yf - 0.8) < 1e-12 && p.settled, `${p.yf}`);
});

test('poles on the unit circle are on the circle, in neither P nor Z', async () => {
  const { CONTROLLERS } = await import('../src/core/controllers.js');
  const { mul, inv } = await import('../src/core/linalg.js');
  const { poleSides } = await import('../src/core/analysis.js');
  // A double integrator in a non-triangular basis (as a linearisation may
  // deliver it) under PID: a triple pole at z = 1. Before: P 1, N −1 at 5 and 10 ms.
  const T = [[1.3, 0.7], [-0.4, 2.1]], Ti = inv(T);
  const dbl = { A: mul(mul(Ti, [[0, 1], [0, 0]]), T), B: mul(Ti, [[0], [1]]), C: mul([[1, 0]], T), D: [[0]] };
  for (const Ts of [0.001, 0.002, 0.005, 0.01, 0.02]) {
    const a = analyzeLoop(dbl, CONTROLLERS.pid.linear({ Kp: 4, Ki: 1, Kd: 3, Tf: 0.02, b: 1 }, Ts), Ts);
    assert.ok(a.P === 0 && a.N === 0 && a.Z === 0 && a.stable, `Ts ${Ts}: P ${a.P} N ${a.N} Z ${a.Z}`);
    assert.equal(a.onCircle.open, 3);
  }
  // The DC motor (angle) with the example's PID: plant and controller integrators.
  // Before: P 1 · N −1, one of the two read as outside.
  const motor = { A: [[-100, -50, 0], [25, -5, 0], [0, 1, 0]], B: [[100], [0], [0]], C: [[0, 0, 1]], D: [[0]] };
  const m = analyzeLoop(motor, CONTROLLERS.pid.linear({ Kp: 30, Ki: 80, Kd: 1, Tf: 0.02, b: 1 }, 0.01), 0.01);
  assert.ok(m.P === 0 && m.N === 0 && m.onCircle.open === 2, `P ${m.P} N ${m.N}`);
  // A split repeated pole is graded by its mean; a real pole off the circle is not hidden.
  assert.deepEqual(poleSides([{ re: 1 + 1.5e-9, im: 0 }, { re: 1 - 1.5e-9, im: 0 }, { re: 1 + 3e-6, im: 5e-6 }, { re: 1 + 3e-6, im: -5e-6 }, { re: 1 - 6e-6, im: 0 }]), ['on', 'on', 'on', 'on', 'on']);
  assert.deepEqual(poleSides([{ re: 1.001, im: 0 }, { re: 0.999, im: 0 }, { re: -1 - 1e-12, im: 0 }]), ['out', 'in', 'on']);
});

test('a marginally stable loop is marginal, not stable, and its slowest pole does not decay', () => {
  // Cart–pole upright with K = [0, −30, −2, −5]: no position feedback, so x drifts.
  const M = 1, m = 0.2, l = 0.5, g = 9.81;
  const cp = { A: [[0, 0, 1, 0], [0, 0, 0, 1], [0, -m * g / M, 0, 0], [0, (M + m) * g / (M * l), 0, 0]], B: [[0], [0], [1 / M], [-1 / (M * l)]], C: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]], D: [[0], [0], [0], [0]] };
  const a = analyzeLoop(cp, { A: [], B: [], C: [[]], D: [[0, 0, 30, 2, 5]] }, 0.01);
  assert.equal(a.stable, false);
  assert.equal(a.marginal, true);
  assert.equal(a.Z, 0);
  assert.equal(a.onCircle.closed, 1);
  assert.equal(a.slowest.s.re, 0);
});

test('a dead time that is not a whole number of samples is exact (modified z-transform)', async () => {
  const { CONTROLLERS } = await import('../src/core/controllers.js');
  // 1/(s + 1), P = 5, Ts = 0.1. A measurement delayed by (d + f)·Ts reads the plant (1 − f)·Ts
  // after a sample, d + 1 samples late: G(z) = z^−(d+1) [e^−σ (1 − a)/(z − a) + 1 − e^−σ], σ = (1 − f) Ts.
  const Ts = 0.1, a = Math.exp(-Ts), G = { A: [[-1]], B: [[1]], C: [[1]], D: [[0]] }, P5 = CONTROLLERS.pid.linear({ Kp: 5, Ki: 0, Kd: 0, Tf: 0.01, b: 1 }, Ts);
  const cmul = (x, y) => ({ re: x.re * y.re - x.im * y.im, im: x.re * y.im + x.im * y.re });
  const cdiv = (x, y) => { const d = y.re ** 2 + y.im ** 2; return { re: (x.re * y.re + x.im * y.im) / d, im: (x.im * y.re - x.re * y.im) / d }; };
  for (const tau of [0.004, 0.04, 0.06, 0.14]) {
    const L = openLoop({ ...G, delay: [tau] }, P5, Ts), d = Math.floor(tau / Ts + 1e-9), sig = Ts - (tau - d * Ts);
    for (const w of [0.5, 5, 25]) {
      const z = { re: Math.cos(w * Ts), im: Math.sin(w * Ts) };
      let g = cdiv({ re: Math.exp(-sig) * (1 - a), im: 0 }, { re: z.re - a, im: z.im });
      g = { re: g.re + 1 - Math.exp(-sig), im: g.im };
      for (let k = 0; k <= d; k++) g = cdiv(g, z);
      g = cmul(g, { re: 5, im: 0 });
      // Both the full state space and the factored form L = z^−d · core.
      for (const r of [respondAt(L, w), respondAt({ ...L, core: null }, w)]) assert.ok(Math.hypot(r.re - g.re, r.im - g.im) < 1e-12, `τ ${tau}, ω ${w}`);
    }
  }
  // The phase margin falls with every bit of dead time; before, 0.004 and 0.04 s read the same as none.
  const pm = [0, 0.004, 0.04, 0.06, 0.1].map((tau) => analyzeLoop({ ...G, delay: [tau] }, P5, Ts).margins.pm);
  for (let i = 1; i < pm.length; i++) assert.ok(pm[i] < pm[i - 1] - 0.5, `PM ${pm.join(', ')}`);
  assert.ok(Math.abs(pm[2] - 77.11) < 0.05, `PM at 0.04 s: ${pm[2]}`);
});

test('a long dead time: the phase is unwrapped exactly and every crossing of −180° is found', async () => {
  const { frequencyData, loopMargins } = await import('../src/core/analysis.js');
  // 1/(s + 1), P = 0.5, Ts = 10 ms, 50 samples of dead time.
  const Ts = 0.01, d = 50, ea = Math.exp(-Ts);
  const L = openLoop({ A: [[-1]], B: [[1]], C: [[1]], D: [[0]], delay: [d * Ts] }, { A: [], B: [], C: [[]], D: [[0.5, -0.5]] }, Ts);
  assert.equal(L.pureDelay, d);
  const fd = frequencyData(L, { wmin: 0.1 });
  const truth = (w) => (-d * w * Ts - Math.atan2(Math.sin(w * Ts), Math.cos(w * Ts) - ea)) * 180 / Math.PI;
  for (let i = 0; i < fd.w.length; i++) assert.ok(Math.abs(fd.phase[i] - truth(fd.w[i])) < 1e-6, `ω ${fd.w[i]}: ${fd.phase[i]} vs ${truth(fd.w[i])}`);
  const mg = loopMargins(fd, Ts, { L });
  // −180°, −540°, … down to the last grid point, plus the end at z = −1 (L(−1) < 0 for even d).
  const inside = Math.floor((-180 - truth(fd.w.at(-1))) / 360) + 1;
  assert.equal(mg.phaseCrossings.filter((c) => !c.at).length, inside);
  assert.ok(mg.phaseCrossings.some((c) => c.at === 'nyquist'));
  // The upper gain limit is the poles' (the first crossing).
  assert.ok(Math.abs(mg.gmUp / edge(L, 1, 100) - 1) < 1e-6, `gmUp ${mg.gmUp}`);
});

test('poles at z = 0 (dead time, a previous measurement) stay off the s-plane plot', async () => {
  const { CONTROLLERS } = await import('../src/core/controllers.js');
  const { sPlanePoint, AT_ORIGIN } = await import('../src/core/analysis.js');
  // The DC motor with PD and 30 ms of dead time: the delay chain is exactly z = 0.
  const motor = { A: [[-100, -50, 0], [25, -5, 0], [0, 1, 0]], B: [[100], [0], [0]], C: [[0, 0, 1]], D: [[0]], delay: [0.03] };
  const a = analyzeLoop(motor, CONTROLLERS.pid.linear({ Kp: 20, Ki: 0, Kd: 1.5, Tf: 0.01, b: 1 }, 0.01), 0.01);
  const small = a.olPoles.filter((z) => Math.hypot(z.re, z.im) < AT_ORIGIN);
  assert.equal(small.length, 4, 'three delay states and the previous measurement');
  assert.ok(small.every((z) => z.re === 0 && z.im === 0));
  // What eig made of them before (|z| = 1.24e-4 at ±45°) is z = 0 too: no point at Re s ≈ −900.
  assert.equal(sPlanePoint({ re: 1.238e-4 * Math.SQRT1_2, im: 1.238e-4 * Math.SQRT1_2 }, 0.01), null);
  for (const z of [...a.olPoles, ...a.clPoles.map((p) => p.z)]) {
    const q = sPlanePoint(z, 0.01);
    assert.ok(q === null || Math.hypot(q[0], q[1]) < 800, `pole at ${JSON.stringify(q)}`);
  }
});

test('an unstable loop has no margin: the gain interval becomes the gains that would stabilise it', async () => {
  const { CONTROLLERS } = await import('../src/core/controllers.js');
  const motor = { A: [[-100, -50, 0], [25, -5, 0], [0, 1, 0]], B: [[100], [0], [0]], C: [[0, 0, 1]], D: [[0]] };
  const Ts = 0.01, ctrl = CONTROLLERS.pid.linear({ Kp: 300, Ki: 0, Kd: 1.5, Tf: 0.01, b: 1 }, Ts);
  const a = analyzeLoop(motor, ctrl, Ts), L = openLoop(motor, ctrl, Ts);
  assert.equal(a.stable, false);
  assert.ok(a.Z > 0);
  const sg = a.margins.stableGains;
  assert.ok(sg && sg.hi < 1 && stableAt(L, Math.sqrt(Math.max(sg.lo, 1e-3) * sg.hi)) && !stableAt(L, sg.hi * 1.01), JSON.stringify(sg));
});
