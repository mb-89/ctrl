// A run is periodic after its start (inputs 50–52: "if I let it run longer,
// it should be periodic"; a spike at t = 0 is accepted, at no other time).
// An eased Sine eases in the run's first period only and joins up where it
// repeats; wrapJump says where a signal does not; the PUMA no longer jumps at
// every new cycle. (The first period of every library system is held to its
// fingerprint in hil-sim.test.mjs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { referenceFn, normalizeReference, wrapJump, wrapWarning } from '../src/core/signals.js';
import { SYSTEM_LIBRARY } from '../src/core/systems.js';
import { PUMA_SYSTEM } from '../src/core/pumasystem.js';
import { normalizeDiagram } from '../src/core/diagram.js';
import { simulateSystem } from '../src/core/sim.js';

const ctx = { sampleTime: 1e-3 };
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
const d1 = (f, t, h = 1e-4) => (f(t - 2 * h) - 8 * f(t - h) + 8 * f(t + h) - f(t + 2 * h)) / (12 * h);
const sine = (params) => ({ type: 'sine', params });
const step = (amplitude, time) => ({ type: 'step', params: { amplitude, time } });
// The PUMA's circle, as the library writes it.
const A_R = { period: 5, components: [sine({ amplitude: 0.15, frequency: 0.4, phase: 90, ease: 0.5 }), { type: 'dc', params: { level: -0.15 } }] };
const B_R = { period: 5, components: [sine({ amplitude: 0.15, frequency: 0.4, phase: 0, ease: 0.5 })] };

// The eased sine as it was before (eased in every period), for the first period.
function oldEased(q) {
  const w = 2 * Math.PI * q.frequency, ph = (q.phase * Math.PI) / 180, Te = q.ease;
  const phase = (u) => {
    if (u >= Te) return w * (u - Te / 2);
    const s = u / Te;
    return w * Te * (2.5 * s ** 4 - 3 * s ** 5 + s ** 6);
  };
  return (t) => (t >= q.time ? q.amplitude * Math.sin(phase(t - q.time) + ph) : 0);
}

test('the eased sine joins up at T and 2T in value, slope and acceleration', () => {
  for (const sig of [A_R, B_R]) {
    const r = referenceFn(normalizeReference(sig), ctx), v = r.derivative(1), a = r.derivative(2);
    const T = sig.period, A = 0.15, w = 2 * Math.PI * 0.4;
    for (const k of [1, 2]) {
      const t = k * T, e = 1e-9;
      close(r(t + e), r(t), A * w * 2e-9, `r across ${t} s`);
      close(v(t + e), v(t), A * w * w * 2e-9, `ṙ across ${t} s`);
      close(a(t + e), a(t), A * w ** 3 * 2e-9, `r̈ across ${t} s`);
      // A difference across the wrap sees no kink.
      close(d1(r, t), v(t), 1e-9, `ṙ from differences across ${t} s`);
      close(d1(v, t), a(t), 1e-8, `r̈ from differences across ${t} s`);
    }
  }
});

test("the eased sine's first period is unchanged, and it still starts at rest", () => {
  const q = { amplitude: 0.15, time: 0, frequency: 0.4, phase: 90, ease: 0.5 };
  const r = referenceFn(normalizeReference({ period: 5, components: [sine(q)] }), ctx), old = oldEased(q);
  for (let i = 0; i <= 5000; i++) { const t = i * 1e-3; assert.equal(r(t), old(t), `t = ${t}`); }
  // With a start time, too.
  const q2 = { amplitude: 1, time: 0.3, frequency: 2, phase: 10, ease: 0.4 };
  const r2 = referenceFn(normalizeReference({ period: 2, components: [sine(q2)] }), ctx), old2 = oldEased(q2);
  for (let i = 0; i <= 2000; i++) { const t = i * 1e-3; assert.equal(r2(t), old2(t), `t = ${t}`); }
  assert.equal(r.derivative(1)(0), 0);
  assert.equal(r.derivative(2)(0), 0);
});

test('from the second period on every period is the same, and the circle stays a circle', () => {
  const a = referenceFn(normalizeReference(A_R), ctx), b = referenceFn(normalizeReference(B_R), ctx);
  const va = a.derivative(1);
  let eased = 0;
  for (let i = 1; i <= 5000; i++) {
    const t = i * 1e-3;
    close(a(t + 10), a(t + 5), 1e-15, `a_r at ${t} in periods 2 and 3`);
    close(b(t + 10), b(t + 5), 1e-15, `b_r at ${t} in periods 2 and 3`);
    close(va(t + 10), va(t + 5), 1e-13, `ȧ_r at ${t} in periods 2 and 3`);
    for (const k of [0, 1, 2]) close(Math.hypot(a(t + 5 * k) + 0.15, b(t + 5 * k)), 0.15, 1e-12, `radius at ${t + 5 * k}`);
    eased = Math.max(eased, Math.abs(va(t) - va(t + 5)));
  }
  assert.ok(eased > 0.1, 'the first period eases, the later ones do not');
});

test('wrapJump: the jump where a signal repeats', () => {
  const J = (components, period = 5) => wrapJump(normalizeReference({ period, components }), ctx);
  // The library's inputs that end away from where they start (before they were made to join up).
  const cases = [
    ['Mass–spring–damper F', [step(1, 0.1)], -1],
    ['Variable gain r', [step(5, 0.25), step(-0.5, 2.75)], -4.5],
    ['Encoder r', [{ type: 'ramp', params: { amplitude: 300, time: 0.5, rise: 4 } }], -300],
    ['Speed from an encoder r', [step(10, 0.2), step(-7, 2.5)], -3],
    ['Conical tank r', [{ type: 'dc', params: { level: 0.15 } }, step(0.3, 1.5), step(0.35, 3)], -0.65],
    ['Oven r', [step(40, 0.2), step(20, 2.2)], -60],
  ];
  for (const [name, comps, jump] of cases) {
    const j = J(comps);
    assert.equal(j.joins, false, name);
    close(j.value, jump, 1e-12, name);
    assert.equal(j.smooth, false, `${name}: steps and corners`);
  }
  // The PUMA's circle joins up, in value and slope.
  for (const sig of [A_R, B_R]) {
    const j = wrapJump(normalizeReference(sig), ctx);
    assert.ok(j.joins && j.smooth, 'the circle joins up');
    assert.ok(Math.abs(j.value) < 1e-15 && Math.abs(j.slope) < 1e-15, `value ${j.value}, slope ${j.slope}`);
    close(j.span, 0.3, 1e-12, 'its span');
  }
  // Steps that return, pulses, a whole number of cycles: quiet.
  assert.ok(J([step(1, 0.5), step(-1, 2)]).joins, 'a step that returns');
  assert.ok(J([{ type: 'square', params: { amplitude: 2, time: 0.25, width: 1.25, period: 2.5, count: 0 } }]).joins, 'a pulse train that fits the period');
  assert.ok(J([{ type: 'square', params: { amplitude: 1, time: 3.2, width: 0.5, period: 5, count: 1 } }]).joins, 'a single pulse');
  assert.ok(J([sine({ amplitude: 1, frequency: 0.2 })]).joins, 'one cycle per period');
  assert.ok(J([{ type: 'dc', params: { level: 3 } }]).joins, 'a level');
  assert.ok(J([]).joins, 'nothing');
  // A sine with a part cycle jumps; half a cycle from 0 joins in value but kinks.
  const part = J([sine({ amplitude: 1, frequency: 0.41 })]);
  assert.ok(!part.joins && Math.abs(part.value) > 0.1, 'a part cycle');
  const half = J([sine({ amplitude: 1, frequency: 0.5 })], 1);
  assert.ok(!half.joins && half.smooth, 'half a cycle');
  assert.ok(Math.abs(half.value) < 1e-15, 'it joins in value');
  close(half.slope, 2 * Math.PI, 1e-9, 'its slope turns from −Aω to Aω');
  // A ramp's slope is the left limit at the end: a triangle kinks at the wrap by twice its slope.
  const tri = J([{ type: 'ramp', params: { amplitude: 1, time: 0, rise: 0.5 } }, { type: 'ramp', params: { amplitude: -1, time: 0.5, rise: 0.5 } }], 1);
  assert.ok(Math.abs(tri.value) < 1e-15 && !tri.smooth && tri.joins, 'a triangle joins in value; its corners are its own');
  close(tri.slope, 4, 1e-9, 'its slope from −2 to 2');
  // A sawtooth drops at the wrap (the Input tab knows it was built to).
  close(J([{ type: 'ramp', params: { amplitude: 2, time: 0, rise: 5 } }]).value, -2, 1e-12, 'a sawtooth');
  // Noise is not a motion; a component switched off is not there.
  assert.ok(J([{ type: 'noise', params: { std: 1 } }]).joins, 'noise alone');
  close(J([{ type: 'noise', params: { std: 1 } }, step(1, 0.1)]).value, -1, 1e-12, 'noise beside a step');
  assert.ok(J([{ ...step(1, 0.1), enabled: false }]).joins, 'a step switched off');
});

test("the Input tab's line: a jump or a kink where it repeats, quiet where that was built", () => {
  const W = (components, period = 5, name = 'r') => wrapWarning({ period, components }, name, ctx);
  assert.match(W([step(1, 0.1)], 5, 'F'), /^F\(t\) jumps where it repeats: .*bring it back before the period ends\.$/);
  assert.match(W([sine({ amplitude: 1, frequency: 0.5 })], 1), /^r\(t\) kinks where it repeats: .*whole number of cycles per period\.$/);
  assert.match(W([sine({ amplitude: 1, frequency: 0.41 })]), /jumps where it repeats/);
  for (const [why, comps, period] of [
    ['steps that return', [step(1, 0.5), step(-1, 2)], 5],
    ['the PUMA circle', A_R.components, 5],
    ['a sawtooth', [{ type: 'ramp', params: { amplitude: 2, time: 0, rise: 1 } }], 1],
    ['a sawtooth with a level', [{ type: 'dc', params: { level: 1 } }, { type: 'ramp', params: { amplitude: 2, time: 0.2, rise: 0.8 } }], 1],
    ['a triangle', [{ type: 'ramp', params: { amplitude: 1, time: 0, rise: 0.5 } }, { type: 'ramp', params: { amplitude: -1, time: 0.5, rise: 0.5 } }], 1],
    ['noise', [{ type: 'noise', params: { std: 1 } }], 5],
    ['nothing', [], 5],
  ]) assert.equal(W(comps, period), '', why);
  // No numbers in it (the page's summaries carry none).
  assert.doesNotMatch(W([step(40, 0.2), step(20, 2.2)]), /\d/);
});

test("the library's other inputs join up where they repeat", () => {
  const known = { 'Encoder errors and torque ripple': ['r'], 'DC motor, speed from an encoder': ['r'], 'Conical tank, gain scheduling': ['r'], 'Oven, badly tuned': ['r'] };
  for (const sys of SYSTEM_LIBRARY) for (const [name, sig] of Object.entries(sys.input.signals)) {
    if (known[sys.name]?.includes(name)) continue;
    const j = wrapJump(normalizeReference(sig), ctx);
    assert.ok(j.joins, `${sys.name}: ${name} jumps by ${j.value} (slope ${j.slope})`);
  }
});

test('a signal written in short plays as the normalized one', () => {
  const short = { period: 5, components: [sine({ amplitude: 1, frequency: 0.2 })] };
  const r = referenceFn(short, ctx), n = referenceFn(normalizeReference(short), ctx);
  for (let i = 0; i <= 600; i++) { const t = i * 0.025; assert.equal(r(t), n(t), `t = ${t}`); }
  assert.ok(Math.abs(r(1.25) - 1) < 1e-12, 'the sine plays (its start time defaults to 0)');
});

test('every library signal repeats from the second period on', () => {
  for (const sys of SYSTEM_LIBRARY) for (const [name, sig] of Object.entries(sys.input.signals)) {
    const ref = normalizeReference(sig), T = ref.period, r = referenceFn(ref, ctx);
    // Between the grid's points: exactly at a step, where a period starts rounds either way.
    for (let i = 1; i <= 500; i++) {
      const t = ((i - 0.37) / 500) * T;
      close(r(t + 2 * T), r(t + T), 1e-12 * Math.max(1, Math.abs(r(t + T))), `${sys.name}: ${name} at ${t} s`);
    }
  }
});

test('the PUMA does not jump where its circle repeats', () => {
  const signals = Object.fromEntries(Object.entries(PUMA_SYSTEM.signals).map(([k, r]) => [k, normalizeReference(r)]));
  const out = simulateSystem(normalizeDiagram(PUMA_SYSTEM.diagram), signals, { duration: 5.4, sampleTime: 0.001 });
  const peak = (x, a, b) => { let m = 0; for (let i = a; i <= b; i++) m = Math.max(m, Math.abs(x[i])); return m; };
  for (const n of ['ea', 'eb']) {
    const steady = peak(out.signals[n], 1000, 4900), wrap = peak(out.signals[n], 4901, 5400);
    // Before, eb kicked to about 88 mm here (0.05 mm while the circle runs).
    assert.ok(wrap <= steady, `${n}: ${wrap} mm after the wrap against ${steady} mm while running`);
  }
});

test('the mass–spring–damper is let go inside its period: no kick where F repeats, and its light damping makes every period alike', () => {
  const sys = SYSTEM_LIBRARY.find((s) => s.name === 'Mass–spring–damper');
  const F = sys.input.signals.F, T = F.period, dt = 0.0025, N = Math.round(T / dt);
  assert.ok(wrapJump(normalizeReference(F), ctx).joins, 'F ends the period where it starts');
  const out = simulateSystem(normalizeDiagram(sys.plant.diagram), sys.input.signals, { duration: 5 * T, sampleTime: dt });
  const { x, v, F: f } = out.signals;
  // Nothing happens at a wrap: F holds, the acceleration does not step (the
  // second difference of v stays at the rounding of a smooth swing).
  for (let p = 1; p < 5; p++) {
    const k = p * N;
    assert.equal(f[k + 1], f[k], `F at ${p * T} s`);
    assert.ok(Math.abs(v[k + 1] - 2 * v[k] + v[k - 1]) < 1e-4, `v kinks at ${p * T} s`);
  }
  // Each period starts from where the last one left the mass, so the periods
  // differ by the swing the damper has not yet taken away: that difference
  // shrinks by e^(−c·T/2m) = e^(−1.25) a period (σ = 0.25 1/s), the physics.
  const diff = (a, b) => { let m = 0; for (let k = 1; k <= N; k++) m = Math.max(m, Math.abs(x[a * N + k] - x[b * N + k])); return m; };
  const d = [diff(0, 1), diff(1, 2), diff(2, 3), diff(3, 4)];
  for (let i = 1; i < d.length; i++) close(d[i] / d[i - 1], Math.exp(-1.25), 0.01, `period ${i + 1} against ${i + 2}`);
  assert.ok(d[1] < 3e-3 && d[3] < 2.5e-4, `periods 2 and 3 within 3 mm, 4 and 5 within 0.25 mm: ${d}`);
});
