// Sliding mode control (design/research/sliding-mode.md): the two laws, the
// textbook double integrator, the library system "DC motor, sliding mode" with
// its motor built from transfer functions, the physics under the fastest
// switching the library produces, controllers sampling on their own clock, a
// library entry's record step, and the scope's Measure readout. Values in the
// comments are what the repository measures; the brief's Recommendation 4
// lists the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTROLLERS, normalizeVariant } from '../src/core/controllers.js';
import { normalizeDiagram } from '../src/core/diagram.js';
import { simulateSystem, stepPlan } from '../src/core/sim.js';
import { normalizeReference } from '../src/core/signals.js';
import { SYSTEM_LIBRARY, SYSTEM_PARTS, applySystem, systemTags } from '../src/core/systems.js';
import { normalizeProject, evaluateSystem, autoTimebase } from '../src/core/project.js';
import { tuningSpace } from '../src/core/autotune.js';
import { amplitudeSpectrum, peaks } from '../src/core/spectrum.js';
import { lineFit } from '../src/ui/xyview.js';
import { measure, measureLine, measureValue } from '../src/ui/measure.js';

const SM = CONTROLLERS.slidingMode, ST = CONTROLLERS.superTwisting;
const sm = (over) => normalizeVariant({ type: 'slidingMode', params: over }).params;
const st = (over) => normalizeVariant({ type: 'superTwisting', params: over }).params;

// ---- The laws -------------------------------------------------------------

test('slidingMode: u0 ± K by the sign of s = λe + ė, u0 at s = 0, clamped; φ > 0 is proportional inside the layer', () => {
  const p = sm({ lambda: 10, K: 12, phi: 0, u0: 1, umin: -12, umax: 12 });
  const u = (r, y, yd) => SM.make(p, 0.001).step([r, y, yd]);
  assert.equal(u(1, 0, 0), 12, 'clamped at umax: 1 + 12');
  assert.equal(u(0, 1, 0), -11);
  assert.equal(u(0, 0, 0), 1, 'sign(0) = 0: the bias');
  assert.equal(u(1, 0, 10), 1, 's = 10·1 − 10 = 0');
  assert.equal(u(1, 0, 9.9), 12);
  assert.equal(SM.make(sm({ lambda: 10, K: -12, phi: 0 }), 0.001).step([1, 0, 0]), -12, 'a negative K reverses it');
  // Boundary layer: K·s/φ inside |s| < φ, ±K outside.
  const q = sm({ lambda: 10, K: 12, phi: 2 });
  const v = (r, y, yd) => SM.make(q, 0.001).step([r, y, yd]);
  assert.ok(Math.abs(v(0.05, 0, 0) - 12 * 0.5 / 2) < 1e-12, 's = 0.5');
  assert.ok(Math.abs(v(0, 0, 1.5) - 12 * -1.5 / 2) < 1e-12, 's = −1.5');
  assert.equal(v(1, 0, 0), 12);
  assert.equal(v(-1, 0, 0), -12);
});

test('the reference derivative is the prefilter\'s own: 0 without one, (r − rf)/Tr with one', () => {
  // Tr = 0: a step in r moves s by λ·Δr only (ė = −ẏ, no kick).
  const a = SM.make(sm({ lambda: 10, K: 1, phi: 1e6 }), 0.01);
  assert.ok(Math.abs(a.step([0.3, 0, 0]) - (10 * 0.3) / 1e6) < 1e-15);
  // Tr = 0.1 s: rf = (1 − e^(−Ts/Tr))·r after the first sample of a step from 0.
  const Tr = 0.1, Ts = 0.01, q = sm({ lambda: 10, K: 1, phi: 1e6, Tr });
  const b = SM.make(q, Ts);
  b.step([0, 0, 0]);
  const rf = 1 - Math.exp(-Ts / Tr), s = 10 * rf + (1 - rf) / Tr;
  assert.ok(Math.abs(b.step([1, 0, 0]) - s / 1e6) < 1e-15, `s = ${s}`);
});

test('slidingMode is linear only with a boundary layer: a PD with Kp = K·λ/φ, Kd = K/φ, equal to its step() inside the layer', () => {
  assert.throws(() => SM.linear(sm({ phi: 0 }), 0.001, { y: [0, 0] }), /no linear model; give it a boundary layer/);
  assert.throws(() => ST.linear(st({}), 0.001, { y: [0, 0] }), /infinite slope/);
  const p = sm({ lambda: 10, K: 12, phi: 2, u0: 0.5 });
  const lin = SM.linear(p, 0.001, { y: [0, 0] });
  assert.deepEqual(lin.D, [[60, -60, -6]], 'the example\'s layer: Kp 60 V/rad, Kd 6 V·s/rad');
  assert.equal(lin.A.length, 0, 'no state');
  const law = SM.make(p, 0.001);
  let worst = 0;
  for (let k = 0; k < 200; k++) {
    const x = [1e-3 * Math.sin(0.3 * k), 1e-3 * Math.sin(0.7 * k + 1), 1e-2 * Math.sin(0.5 * k + 2)];
    worst = Math.max(worst, Math.abs(law.step(x) - p.u0 - lin.D[0].reduce((s, d, i) => s + d * x[i], 0)));
  }
  assert.ok(worst < 1e-12, `worst ${worst}`);
});

test('both sliding-mode laws need ẏ on input 3: a block with 2 inputs is refused', () => {
  for (const type of ['slidingMode', 'superTwisting']) {
    const d = (inputs) => ({ blocks: [{ id: 'c', type: 'controller', params: { inputs, Ts: 0.001 }, variants: [{ type }] }], wires: [] });
    assert.throws(() => normalizeDiagram(d(2)), /needs ẏ on input 3: set the Controller block's Inputs to 3/);
    assert.doesNotThrow(() => normalizeDiagram(d(3)));
  }
});

test('superTwisting: u is continuous in s; its integral part moves by Ts·k2 per sample and stays within the limits', () => {
  const p = st({ lambda: 10, k1: 4, k2: 44, umin: -12, umax: 12 });
  // v fixed (k2 = 0): u across s = 0.
  const q = st({ lambda: 10, k1: 4, k2: 0 });
  const up = ST.make(q, 0.001).step([0, 0, -1e-10]), down = ST.make(q, 0.001).step([0, 0, 1e-10]);
  assert.ok(Math.abs(up - down) < 1e-4 * q.k1, `${up} ${down}`);
  // The integral part alone (k1 = 0): u is v before the sample's update.
  const law = ST.make({ ...p, k1: 0 }, 0.001);
  const vOf = (s) => law.step([0, 0, -s]);
  let v = vOf(1e-12);
  assert.equal(v, 0, 'v starts at u0');
  for (let k = 0; k < 400; k++) {
    const next = vOf(1e-12);   // s > 0 throughout: v rises by Ts·k2 until the limit
    assert.ok(Math.abs(next - Math.min(12, v + 0.001 * 44)) < 1e-9, `sample ${k}: ${next} after ${v}`);
    v = next;
  }
  assert.ok(Math.abs(v - 12) < 1e-9, 'v stops at umax (anti-windup)');
});

test('Auto-tune turns λ and φ, not K; a relay stays a relay', () => {
  // K is the actuator's swing: turned down below the limit it would only hide
  // the relay from the cost's time-at-a-limit count while it still slams.
  assert.deepEqual(tuningSpace({ type: 'slidingMode', params: sm({ lambda: 10, K: 12, phi: 0 }) }).names, ['λ']);
  assert.deepEqual(tuningSpace({ type: 'slidingMode', params: sm({ lambda: 10, K: 12, phi: 2 }) }).names, ['λ', 'φ']);
  assert.deepEqual(tuningSpace({ type: 'superTwisting', params: st({ lambda: 10, k1: 4, k2: 44 }) }).names, ['λ', 'k1', 'k2']);
  const sp = tuningSpace({ type: 'slidingMode', params: sm({ lambda: 10, K: 12, phi: 2 }) });
  const q = sp.apply([Math.log(2), Math.log(0.5)]).params;
  assert.equal(q.lambda, 20);
  assert.equal(q.phi, 1);
  assert.equal(q.K, 12, 'K is left as it is');
});

// ---- The textbook plant: a double integrator --------------------------------

// ÿ = b·u from a Gain and two Integrators (an ideal actuator), a relay
// slidingMode at Ts = 1 ms, r = 1 from t = 0. Returns the first switch and the
// largest |s| after it.
function doubleIntegrator(b, K, lambda, Ts = 0.001) {
  const d = normalizeDiagram({
    blocks: [
      { id: 'r', type: 'source', params: { signal: 'r' } },
      { id: 'c', type: 'controller', params: { inputs: 3, Ts }, variants: [{ type: 'slidingMode', params: { lambda, K, phi: 0 } }] },
      { id: 'b', type: 'gain', params: { K: b } },
      { id: 'v', type: 'integrator', params: { K: 1 } }, { id: 'y', type: 'integrator', params: { K: 1 } },
      { id: 'u', type: 'sink', params: { name: 'u' } }, { id: 'ys', type: 'sink', params: { name: 'y' } }, { id: 'vs', type: 'sink', params: { name: 'v' } },
    ],
    wires: [{ from: 'r', to: 'c' }, { from: 'c', to: 'b' }, { from: 'b', to: 'v' }, { from: 'v', to: 'y' }, { from: 'y', to: 'c:1' }, { from: 'v', to: 'c:2' },
      { from: 'c', to: 'u' }, { from: 'y', to: 'ys' }, { from: 'v', to: 'vs' }],
  });
  const one = { r: normalizeReference({ period: 10, components: [{ type: 'dc', params: { level: 1 } }] }) };
  const { t, signals: s } = simulateSystem(d, one, { duration: 2, sampleTime: Ts / 4 });
  let k = 1;
  while (k < t.length && s.u[k] === s.u[0]) k++;
  let after = 0;
  for (let j = k; j < t.length; j++) after = Math.max(after, Math.abs(lambda * (1 - s.y[j]) - s.v[j]));
  return { tSwitch: t[k], after };
}

test('double integrator: the relay reaches the line in finite time, then stays in an O(Ts) band', () => {
  const b = 1, K = 20, lambda = 4, Ts = 0.001, s0 = lambda;
  const tr = (-1 + Math.sqrt(1 + (2 * lambda * s0) / (b * K))) / lambda;   // 153.1 ms
  const { tSwitch, after } = doubleIntegrator(b, K, lambda, Ts);           // 154 ms
  assert.ok(Math.abs(tSwitch - tr) <= 2 * Ts, `first switch ${tSwitch} s, predicted ${tr} s`);
  assert.ok(after <= 2 * b * K * Ts, `|s| ${after} after reaching (band ${2 * b * K * Ts})`);   // 0.030
});

test('double integrator: where |u_eq| = λ·|ẏ|/b exceeds K there is no sliding; the beam crosses the line', () => {
  for (const [b, K, lambda] of [[1, 5, 10], [2, 3, 5]]) {
    const { after } = doubleIntegrator(b, K, lambda);   // 4.88 and 0.69
    assert.ok(after > 20 * 2 * b * K * 0.001, `b ${b}, K ${K}, λ ${lambda}: |s| reached only ${after}`);
  }
});

// ---- The library system -----------------------------------------------------

const ENTRY = SYSTEM_LIBRARY.find((e) => e.name === 'DC motor, sliding mode');
const VARIANTS = ENTRY.plant.diagram.blocks.find((b) => b.type === 'controller').variants.map((v) => v.name);
const RELAY = 0, LAYER = 1, TWIST = 2;
const LAMBDA = 10;

// The system as a whole load gives it (Auto Scale's window: 0–5 s at the
// entry's 0.25 ms record), with one variant running and Motor edited.
function load(variant, { Jm, L, sampleTime, timebase } = {}) {
  const p = normalizeProject(applySystem(normalizeProject({}), ENTRY, SYSTEM_PARTS.filter((k) => ENTRY[k])));
  p.scope.timebase = timebase ?? autoTimebase(p);
  if (sampleTime) p.sim.sampleTime = sampleTime;
  const d = p.system.plant.diagram;
  d.blocks.find((b) => b.type === 'controller').variant = variant;
  const motor = d.blocks.find((b) => b.id === 'motor').params;
  if (Jm) motor.Jm = Jm;
  if (L) motor.L = L;
  return normalizeProject(p);
}
const cache = new Map();
const runOf = (variant, opts = {}) => {
  const key = JSON.stringify([variant, opts]);
  if (!cache.has(key)) cache.set(key, evaluateSystem(load(variant, opts)));
  return cache.get(key);
};
const at = (t, x) => Math.round(x / (t[1] - t[0]));
const range = (run, a, b) => [at(run.t, a), at(run.t, b)];
const sOf = (run, k) => LAMBDA * run.signals.e[k] - run.signals.speed[k];   // r held: ė = −ω
function reaching(run, tStep = 0.25) {
  let k = at(run.t, tStep) + 1;
  while (k < run.t.length && Math.abs(sOf(run, k)) >= 0.5) k++;
  return run.t[k] - tStep;
}
const meanAbs = (run, name, a, b) => { const [i, j] = range(run, a, b); let x = 0; for (let k = i; k <= j; k++) x += Math.abs(run.signals[name][k]); return x / (j - i + 1); };
const slope = (run, a, b) => { const [i, j] = range(run, a, b); return lineFit(run.signals.e, run.signals.speed, i, j); };
const HOLD = [1.0, 1.49], R = 1;   // r = 1 held, no load; the armature's R
const holdMeasure = (run, name, h) => { const [i, j] = range(run, ...HOLD); return measure(run.t, run.signals[name], i, j, h); };
const holdLoss = (run) => { const [i, j] = range(run, ...HOLD); let p = 0; for (let k = i; k <= j; k++) p += R * run.signals.i[k] ** 2; return p / (j - i + 1); };
// The largest line of V's spectrum while holding.
function fundamental(run) {
  const [i, j] = range(run, ...HOLD), dt = run.t[1] - run.t[0];
  const sp = amplitudeSpectrum(run.signals.V.subarray(i, j + 1), dt);
  return peaks(sp.f, sp.amp, { count: 1 })[0] ?? { f: 0, amp: 0 };
}

test('the sliding-mode system loads whole with its record step, V and i assigned but off, and XY', () => {
  const p = load(RELAY);
  assert.equal(p.sim.sampleTime, 0.00025, 'four records per controller sample');
  assert.deepEqual(p.scope.channels.map((c) => [c.source, c.on, !!c.measure]), [['e', true, false], ['speed', true, false], ['V', false, false], ['i', false, false]]);
  assert.deepEqual(p.scope.view, { mode: 'xy' }, 'XY without Δ: the phase portrait');
  assert.deepEqual(VARIANTS, ['Relay (theory)', 'Boundary layer', 'Super-twisting'], 'short enough for the variant list');
  const c = p.system.plant.diagram.blocks.find((b) => b.type === 'controller');
  assert.deepEqual(c.params, { inputs: 3, Ts: 0.001 });
  // A whole load of another system takes the record step away again.
  const other = normalizeProject(applySystem(p, SYSTEM_LIBRARY.find((e) => e.name.startsWith('DC motor, position')), ['input', 'plant']));
  assert.deepEqual(other.sim, {});
  // Measure, switched on, survives saving and opening.
  const on = structuredClone(p); on.scope.channels[3].measure = true;
  assert.equal(normalizeProject(JSON.parse(JSON.stringify(on))).scope.channels[3].measure, true);
  assert.equal(normalizeProject({ scope: { channels: [{ source: 'r', measure: 'yes' }] } }).scope.channels[0].measure, undefined, 'only true turns it on');
  const tags = ENTRY.tags.map((t) => t.label);
  for (const want of ['Linear', 'Variable structure', 'Disturbance', 'XY']) assert.ok(tags.includes(want), `${want} in ${tags}`);
  assert.equal(systemTags({ diagram: { blocks: [{ id: 'c', type: 'controller', params: {}, variants: [{ type: 'superTwisting' }] }], wires: [] } }).find((t) => t.kind === 'controller').tone, 'red');
});

test('the motor is the Servo motor: every physics value once, on its mask; the current a Sink inside', () => {
  // (Its runs against the motor built from transfer functions: test/servo.test.mjs.)
  const motor = ENTRY.plant.diagram.blocks.find((b) => b.id === 'motor');
  assert.equal(motor.component, 'servo-motor@1');
  assert.deepEqual(['R', 'L', 'K', 'b', 'Jm', 'G'].map((k) => motor.params[k]), [1, 0.01, 0.5, 0.1, 0.02, 1]);
  assert.ok(motor.diagram.blocks.some((b) => b.type === 'sink' && b.params.name === 'i' && b.params.unit === 'A'), 'the current is a Sink inside Motor');
});

test('reaching: |s| < 0.5 rad/s within 60 ms of the step for every variant, within 160 ms with J×3', () => {
  for (const v of [RELAY, LAYER, TWIST]) {
    const nominal = reaching(runOf(v)), heavy = reaching(runOf(v, { Jm: 0.06 }));   // 43–48 ms; 90–95 ms
    assert.ok(nominal < 0.06, `${VARIANTS[v]}: ${nominal} s`);
    assert.ok(heavy < 0.16, `${VARIANTS[v]} J×3: ${heavy} s`);
  }
});

test('under a 1 N·m load: the relay errs by sampling, the boundary layer by φ, super-twisting rejects it', () => {
  const relay = runOf(RELAY), layer = runOf(LAYER), twist = runOf(TWIST);
  const [l0, l1] = range(relay, 3.2, 3.69);
  let peak = 0;
  for (let k = l0; k <= l1; k++) peak = Math.max(peak, Math.abs(relay.signals.e[k]));
  assert.ok(peak < 0.025, `relay peak ${peak}`);                                        // 15.4 mrad
  assert.ok(meanAbs(relay, 'e', 3.4, 3.69) < 0.01, `${meanAbs(relay, 'e', 3.4, 3.69)}`); // 5.4 mrad
  assert.ok(meanAbs(twist, 'e', 3.6, 3.69) < 0.001, `${meanAbs(twist, 'e', 3.6, 3.69)}`); // 0.34 mrad
  // The layer is a PD inside: it leaves φ·(d·R/Kt)/(K·λ).
  const expected = (2 * (1 * 1 / 0.5)) / (12 * LAMBDA);                                 // 33.3 mrad
  const e369 = layer.signals.e[at(layer.t, 3.69)];                                       // 33.2 mrad
  assert.ok(Math.abs(e369 - expected) < 0.1 * expected, `${e369} vs ${expected}`);
});

test('XY: the sliding line\'s slope reads λ in the window after reaching, at the nominal and the tripled inertia', () => {
  // The window the notes give: 100 ms/div at 0.4 s; the run then ends at 1.4 s.
  const window = { scale: 0.1, position: 0.4 };
  const fit = (v, opts = {}, from = 0.4) => {
    const run = runOf(v, { ...opts, timebase: window });
    assert.ok(Math.abs(run.t.at(-1) - 1.4) < 1e-9, 'the screen is the record');
    return slope(run, from, 1.4);
  };
  const near = (a, pct) => Math.abs(a - LAMBDA) <= (pct / 100) * LAMBDA;
  const J3 = { Jm: 0.06 };
  const relay = fit(RELAY), relay3 = fit(RELAY, J3);              // 9.89, 10.02
  assert.ok(near(relay.a, 3) && near(relay3.a, 3), `relay ${relay.a}, J×3 ${relay3.a}`);
  assert.ok(relay.sigma > 0.05 && relay.sigma < 0.4, `the relay's band σ ${relay.sigma} rad/s`);   // 0.177
  const twist = fit(TWIST);                                        // 10.05
  assert.ok(near(twist.a, 3), `super-twisting ${twist.a}`);
  const layer = fit(LAYER), layer3 = fit(LAYER, J3);               // 9.48, 10.90
  assert.ok(near(layer.a, 10) && near(layer3.a, 10), `layer ${layer.a}, J×3 ${layer3.a}`);
  assert.ok(layer.sigma < 0.01, `layer σ ${layer.sigma}`);
  // Super-twisting at J×3 first overshoots the line, then slides.
  const late = fit(TWIST, J3, 0.6);                                // 10.02
  assert.ok(fit(TWIST, J3).a > 12, 'J×3 0.4–1.4 s');               // 15.35
  assert.ok(near(late.a, 3), `J×3 0.6–1.4 s: ${late.a}`);
  // Over the whole run (as loading shows it) the line also fits the reaching arcs: a ≈ 7.
  for (const v of [RELAY, LAYER, TWIST]) {
    const run = runOf(v), a = slope(run, 0, 5).a;
    assert.ok(a > 6 && a < 7.5, `${VARIANTS[v]}: whole-run a ${a}`);
  }
});

test('chattering while holding: the relay slams ±12 V and heats the motor; the layer is still; super-twisting keeps a small honest ripple', () => {
  const relay = runOf(RELAY), layer = runOf(LAYER), twist = runOf(TWIST);
  const [h0, h1] = range(relay, ...HOLD);
  let full = 0;
  for (let k = h0; k <= h1; k++) if (Math.abs(Math.abs(relay.signals.V[k]) - 12) < 1e-9) full++;
  assert.ok(full / (h1 - h0 + 1) >= 0.99, `${full} of ${h1 - h0 + 1} samples at ±12 V`);
  const f = fundamental(relay).f;                                                        // 62.5 Hz
  assert.ok(f > 55 && f < 75, `relay fundamental ${f} Hz`);
  const iac = holdMeasure(relay, 'i', 0.05).ac;                                          // 2.76 A
  assert.ok(iac > 2.4 && iac < 3.2, `i ac ${iac}`);
  const loss = holdLoss(relay);                                                          // 7.64 W
  assert.ok(loss > 6.5 && loss < 8.5, `copper loss ${loss} W`);
  assert.ok(holdMeasure(layer, 'V', 0.5).ac < 0.05, `layer V ac ${holdMeasure(layer, 'V', 0.5).ac}`);
  const tac = holdMeasure(twist, 'V', 0.5).ac;                                           // 0.64 V
  assert.ok(tac > 0.2 && tac < 1.5, `super-twisting V ac ${tac}: the armature leaves a ripple`);
  const tv = (run) => measure(run.t, run.signals.V, 0, run.t.length - 1, 0.5).tv;
  assert.ok(tv(twist) < tv(relay) / 10, `TV ${tv(twist)} against ${tv(relay)}`);         // 130 against 2786 V/s
  // No switching faster than the controller can: f ≤ 1/(2Ts) = 500 Hz.
  for (const run of [relay, layer, twist]) assert.ok(fundamental(run).f <= 500 && measure(run.t, run.signals.V, 0, run.t.length - 1, 0.5).rev / 2 <= 500);
});

// ∫V·i dt = ∫R·i² dt + ∫b·ω² dt + ∫d·ω dt + ½L·i² + ½J·ω², recorded at 0.1 ms;
// V and d are held over each step (V by the controller's hold; d jumps on a record).
test('physics: the motor\'s energy balances for every variant, the relay\'s too', () => {
  const { L, R: Rm, Jm: J, b: bf } = ENTRY.plant.diagram.blocks.find((b) => b.id === 'motor').params;
  for (const v of [RELAY, LAYER, TWIST]) {
    const { t, signals: s } = runOf(v, { sampleTime: 0.0001 });
    const dt = t[1] - t[0], n = t.length - 1;
    let Ein = 0, Q = 0, F = 0, W = 0;
    for (let k = 0; k < n; k++) {
      const im = 0.5 * (s.i[k] + s.i[k + 1]), wm = 0.5 * (s.speed[k] + s.speed[k + 1]);
      Ein += s.V[k] * im * dt;
      Q += 0.5 * Rm * (s.i[k] ** 2 + s.i[k + 1] ** 2) * dt;
      F += 0.5 * bf * (s.speed[k] ** 2 + s.speed[k + 1] ** 2) * dt;
      W += s.d[k] * wm * dt;
    }
    const stored = 0.5 * L * s.i[n] ** 2 + 0.5 * J * s.speed[n] ** 2;
    const out = Q + F + W + stored;
    assert.ok(Math.abs(Ein - out) < 0.005 * Ein, `${VARIANTS[v]}: in ${Ein} J, out ${out} J`);
    if (v === RELAY) assert.ok(Q / Ein > 0.9, `the relay turns ${Q / Ein} of its energy into heat`);   // 50.5 of 52.4 J
  }
});

test('physics: a ten times faster armature makes the relay chatter faster and burn more', () => {
  const fast = runOf(RELAY, { L: 0.001 });
  const f = fundamental(fast).f;                       // 250 Hz (f_s/4)
  assert.ok(f >= 200, `chatter at ${f} Hz`);
  const loss = holdLoss(fast);                         // 35.7 W at the 0.25 ms record (34.6 exact; 0.1 ms samples read 34.75)
  assert.ok(loss > 30 && loss < 40, `${loss} W`);
  // At 16 samples per period the Measure line does not flag it.
  assert.equal(holdMeasure(fast, 'i', 0.5).under, false);
});

// ---- Sampling on the controller's own clock -------------------------------

test('a Controller at Ts samples at exactly k·Ts, whatever the record step', () => {
  // u = r(t) at each sample, r = t: the held u is the instant of the last sample.
  const d = (Ts) => normalizeDiagram({
    blocks: [
      { id: 'r', type: 'source', params: { signal: 'r' } },
      { id: 'c', type: 'controller', params: { inputs: 1, Ts }, variants: [{ type: 'stateFeedback', params: { K: [0], kr: 1 } }] },
      { id: 'u', type: 'sink', params: { name: 'u' } },
    ],
    wires: [{ from: 'r', to: 'c' }, { from: 'c', to: 'u' }],
  });
  const ramp = { r: normalizeReference({ period: 100, components: [{ type: 'ramp', params: { amplitude: 10, time: 0, rise: 10 } }] }) };
  for (const Ts of [0.001, 0.0011, 0.00102]) for (const T of [0.0025, 0.00025, 0.004, 0.0015, 0.01]) {
    const { t, signals, info } = simulateSystem(d(Ts), ramp, { duration: 1, sampleTime: T });
    for (let k = 0; k < t.length; k++) {
      const last = Math.floor(t[k] / Ts + 1e-9) * Ts;
      assert.ok(Math.abs(signals.u[k] - last) < 1e-12, `Ts ${Ts}, record ${T}: at ${t[k]} the last sample was ${signals.u[k]}, not ${last} (h ${info.h})`);
    }
  }
  // The steps: a common grid (a multiple of T/gcd(T, Ts), at least what the
  // stability bound needs) when it costs no more than cutting the steps at
  // the sample instants; otherwise the bound's steps, cut there.
  assert.deepEqual(stepPlan(0.0025, 1000, [0.001]), { m: 5, split: false }, '0.5 ms already meets the bound of 0.5 ms');
  assert.deepEqual(stepPlan(0.0025, 3000, [0.001]), { m: 15, split: false }, 'the bound needs 15; 15 is a multiple of 5');
  assert.deepEqual(stepPlan(0.0025, 0, [0.01]), { m: 1, split: false });
  assert.deepEqual(stepPlan(0.00025, 100, [0.001]), { m: 1, split: false });
  assert.deepEqual(stepPlan(0.0025, 0, [0.001]), { m: 1, split: true }, 'a grid of 5 against 1 step and 3 cuts');
  assert.deepEqual(stepPlan(0.0025, 0, [0.0011]), { m: 1, split: true }, 'a grid of 25 (g = 0.1 ms)');
  assert.deepEqual(stepPlan(0.0025, 0, [0.00102]), { m: 1, split: true }, 'a grid of 125');
  const warnings = [];
  assert.deepEqual(stepPlan(0.0025, 0, [0.001234567], 2000, warnings), { m: 1, split: true });
  assert.deepEqual(warnings, []);
  // Cutting costs about one step per sample: a 1.02 ms controller at the
  // 2.5 ms record takes at most 4 steps per record (a grid would take 125).
  const run = simulateSystem(d(0.00102), ramp, { duration: 1, sampleTime: 0.0025 });
  assert.ok(run.info.steps <= 4 * 400, `${run.info.steps} steps`);
});

test('a Source edge at a sample instant reaches the Controller at that sample, not one later', () => {
  // r steps at 0.25, 1.5, 2.75 and 4.0 s; d adds 10 over 3.2–3.7 s. u = r + d
  // as last sampled; read at the first record at or after each edge.
  const d = (Ts) => normalizeDiagram({
    blocks: [
      { id: 'r', type: 'source', params: { signal: 'r' } },
      { id: 'c', type: 'controller', params: { inputs: 1, Ts }, variants: [{ type: 'stateFeedback', params: { K: [0], kr: 1 } }] },
      { id: 'u', type: 'sink', params: { name: 'u' } },
    ],
    wires: [{ from: 'r', to: 'c' }, { from: 'c', to: 'u' }],
  });
  const sq = { r: normalizeReference({ period: 5, components: [
    { type: 'square', params: { amplitude: 1, time: 0.25, width: 1.25, period: 2.5, count: 0 } },
    { type: 'square', params: { amplitude: 10, time: 3.2, width: 0.5, period: 5, count: 1 } }] }) };
  const want = (t) => (t >= 0.25 && (t - 0.25) % 2.5 < 1.25 - 1e-12 ? 1 : 0) + (t >= 3.2 && t < 3.7 - 1e-12 ? 10 : 0);
  for (const Ts of [0.001, 0.002, 0.005, 0.01]) for (const T of [0.00025, 0.0005, 0.001, 0.0015, 0.0025, 0.004, 0.01]) {
    const { t, signals } = simulateSystem(d(Ts), sq, { duration: 5, sampleTime: T });
    for (const edge of [0.25, 1.5, 2.75, 3.2, 3.7, 4.0]) {
      const k = Math.ceil(edge / T - 1e-9), last = Math.floor(t[k] / Ts + 1e-9) * Ts;
      assert.equal(signals.u[k], want(last + 1e-12), `Ts ${Ts}, record ${T}: the edge at ${edge} s`);
    }
  }
});

test('the encoder example samples as before: same steps, its speed follows as well', () => {
  const e = SYSTEM_LIBRARY.find((x) => x.name === 'Encoder errors and torque ripple');
  const p = normalizeProject(applySystem(normalizeProject({}), e, SYSTEM_PARTS.filter((k) => e[k])));
  p.scope.timebase = autoTimebase(p);
  const run = evaluateSystem(p);
  assert.equal(run.info.substeps, 5, '0.5 ms steps: its 1 ms samples were on the grid already');
  let a = 0, n = 0;
  for (let k = 0; k < run.t.length; k++) if (run.t[k] >= 0.5) { a += (run.signals.r[k] - run.signals.speed[k]) ** 2; n++; }
  assert.ok(Math.sqrt(a / n) <= 2.18149, `rms speed error ${Math.sqrt(a / n)} rad/s (2.18148 before)`);
});

// ---- The Measure readout ----------------------------------------------------

const series = (n, dt, f) => { const t = new Float64Array(n), x = new Float64Array(n); for (let k = 0; k < n; k++) { t[k] = k * dt; x[k] = f(t[k], k); } return { t, x }; };

test('Measure: a ±12 V square wave at 62.5 Hz, a sine, a constant', () => {
  const sq = series(1001, 0.001, (t, k) => (Math.floor(k / 8) % 2 ? -12 : 12));   // 62.5 Hz at 1 ms
  const m = measure(sq.t, sq.x, 0, 1000, 0.5);
  assert.ok(Math.abs(m.ac - 12) < 0.01 && Math.abs(m.rms - 12) < 1e-12, `ac ${m.ac}`);
  assert.ok(Math.abs(m.tv - 2 * 24 * 62.5) < 1e-9, `TV ${m.tv}`);
  assert.ok(Math.abs(m.rev - 125) <= 1, `reversals ${m.rev}`);
  assert.equal(m.pp, 24);
  const A = 2, f = 5, sn = series(10001, 0.0001, (t) => A * Math.sin(2 * Math.PI * f * t));
  const s = measure(sn.t, sn.x, 0, 10000, 0.1);
  assert.ok(Math.abs(s.ac - A / Math.SQRT2) < 1e-3 && Math.abs(s.mean) < 1e-9, `${s.ac} ${s.mean}`);
  assert.equal(s.rev, 2 * f);
  assert.ok(Math.abs(s.tv - 4 * A * f) < 1e-3, 'a sine travels 4A per period');
  const c = measure(sq.t, new Float64Array(1001).fill(3), 0, 1000, 0.1);
  assert.deepEqual([c.mean, c.ac, c.pp, c.tv, c.rev], [3, 0, 0, 0, 0]);
  assert.ok(Math.abs(c.rms - 3) < 1e-12);
  // The window is what the screen shows: samples j0..j1 only.
  assert.equal(measure(sq.t, sq.x, 0, 7, 0.5).pp, 0);
});

test('Measure flags a waveform with fewer than 10 samples per period', () => {
  const tri = (per) => series(4001, 0.001, (t, k) => { const ph = (k % per) / per; return ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph; });
  const four = tri(4), sixteen = tri(16);
  const m4 = measure(four.t, four.x, 0, 4000, 0.1), m16 = measure(sixteen.t, sixteen.x, 0, 4000, 0.1);
  assert.equal(m4.under, true);
  assert.ok(Math.abs(m4.perPeriod - 4) < 0.01, `${m4.perPeriod}`);
  assert.equal(m16.under, false);
  assert.match(measureLine(m4, 3, 'i', 'A', 1).warn, /under-resolved: 4 samples per period/);
  assert.equal(measureLine(m16, 3, 'i', 'A', 1).warn, '');
  // The line, as the scope shows it.
  const sq = series(1024, 0.001, (t, k) => (Math.floor(k / 8) % 2 ? -12 : 12));   // 64 whole periods
  const line = measureLine(measure(sq.t, sq.x, 0, 1023, 0.5), 2, 'V', 'V', 5).text;
  assert.match(line, /^3 V {2}mean 0 V {2}rms 12 V {2}ac 12 V {2}p-p 24 V {2}TV 2\.98 kV\/s {2}rev 12[34]\/s \(h 0\.5 V\)$/);
  assert.equal(measureValue(2786.4, 'V/s'), '2.79 kV/s');
  assert.equal(measureValue(-0.0042, 'rad'), '−4.2 mrad');
  assert.equal(measureValue(1e-9, 'V', 5), '0 V', 'below a thousandth of the scale');
  assert.equal(measureValue(3, '1'), '3');
});
