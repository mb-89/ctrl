// A run is periodic after its start (inputs 50–52: "if I let it run longer,
// it should be periodic"; a spike at t = 0 is accepted, at no other time).
// An eased Sine eases in the run's first period only and joins up where it
// repeats; wrapJump says where a signal does not; the PUMA no longer jumps at
// every new cycle; every library input joins up with itself, and a long run
// of every library system is periodic after its start, with no spike at a
// wrap. (The first period of every library system is held to its
// fingerprint in hil-sim.test.mjs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { referenceFn, normalizeReference, wrapJump, wrapWarning } from '../src/core/signals.js';
import { SYSTEM_LIBRARY } from '../src/core/systems.js';
import { PUMA_SYSTEM } from '../src/core/pumasystem.js';
import { normalizeDiagram } from '../src/core/diagram.js';
import { simulateSystem } from '../src/core/sim.js';
import { defaultSampleTime } from '../src/core/project.js';

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

test('every library input joins up where it repeats: its value, and its slope where it is a smooth motion', () => {
  // Steps inside a period are deliberate (a step test) and stay; the wrap
  // itself is not a step. Before inputs 50–52 six did not join (the cases
  // in the wrapJump test above).
  for (const sys of SYSTEM_LIBRARY) for (const [name, sig] of Object.entries(sys.input.signals)) {
    const j = wrapJump(normalizeReference(sig), ctx);
    assert.ok(Math.abs(j.value) <= 1e-6 * j.span, `${sys.name}: ${name} jumps by ${j.value} where it repeats`);
    if (j.smooth && j.slope !== null) assert.ok(Math.abs(j.slope) <= 1e-6 * j.rate, `${sys.name}: ${name} kinks by ${j.slope} where it repeats`);
    assert.ok(j.joins, `${sys.name}: ${name}`);
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

// ---- The library over a long run (inputs 50–52) ----------------------------
// Every library system but the HIL ones (their plant is outside the page) and
// the PUMA (the test above, and puma.test.mjs): a run of four
// periods of its first variant, one run per system, shared by the tests
// below. Noise plays as shipped: it is seeded, so the run is the same every
// time, and the two systems that have noise are held to its statistics.
const LONG = 4;
const longRuns = new Map();
function longRun(name) {
  if (!longRuns.has(name)) {
    const sys = SYSTEM_LIBRARY.find((s) => s.name === name);
    const T = Math.max(...Object.values(sys.input.signals).map((s) => s.period));
    const dt = sys.sim?.sampleTime ?? defaultSampleTime(T);
    const out = simulateSystem(normalizeDiagram(sys.plant.diagram), sys.input.signals, { duration: LONG * T, sampleTime: dt });
    longRuns.set(name, { T, dt, N: Math.round(T / dt), s: out.signals });
  }
  return longRuns.get(name);
}
const LONG_RUN = SYSTEM_LIBRARY.filter((s) => s.name !== PUMA_SYSTEM.name && !JSON.stringify(s.plant).includes('"external"'));

// How a system is held where period 4 is not period 3 sample for sample, and
// why (the physics, not a jump):
//   settles     its run approaches its periodic motion by a factor a period
//               (every output's difference at most 0.3 of the one before)
//   statistics  each output's mean and rms deviation in period 4 within a
//               tenth of its rms deviation in period 3 (the largest measured:
//               5 %, the encoder's ripple torque); for a free shaft's angle,
//               which a speed loop does not hold, how far it turns instead
//               of its mean
// Every other system repeats: period 4 within 1e-4 of each output's span in
// periods 3 and 4 (the largest measured: 1.5e-5, the triple pendulum's θ3).
const HELD = {
  // ζ 0.05 and no controller: a swing it carries into the next period shrinks
  // to e^(−c·T/2m) = 0.29 a period (its own test below).
  'Mass–spring–damper': { how: 'settles' },
  // The relay chatters in a rhythm of its own (13 to 14 ms) that does not fit
  // the period's samples: a period repeats the one three before it.
  'DC motor, sliding mode': { how: 'statistics' },
  // The ripple and the encoder errors follow the shaft's angle, 102.65 turns a
  // period, so they fall at another phase each period; and the torque noise
  // (its own test below: without both, periods 2 to 4 agree to 1e-9).
  'Encoder errors and torque ripple': { how: 'statistics' },
  // The encoder's noise, and its counts, which fall differently as the angle
  // turns on (about 27 rad a period); with an ideal encoder period 2 is
  // period 3 to 1e-8 (observer-example.test.mjs).
  'DC motor, speed from an encoder': { how: 'statistics', turns: ['angle', 'encoder'] },
  // On the load's encoder the PID hunts in the play, a limit cycle of about
  // 31 Hz of its own (what the example shows).
  'Gear backlash': { how: 'statistics' },
};

const maxDiff = (x, N, a, b) => { let m = 0; for (let k = 1; k <= N; k++) m = Math.max(m, Math.abs(x[a * N + k] - x[b * N + k])); return m; };
const periodStats = (x, N, p) => {
  let s = 0, s2 = 0;
  for (let k = 1; k <= N; k++) { const v = x[p * N + k]; s += v; s2 += v * v; }
  const mean = s / N;
  return { mean, sd: Math.sqrt(Math.max(0, s2 / N - mean * mean)), turn: x[(p + 1) * N] - x[p * N] };
};

for (const sys of LONG_RUN) {
  test(`${sys.name}: no spike where its input repeats, and periodic after the start`, () => {
    const { T, N, s } = longRun(sys.name), held = HELD[sys.name] ?? { how: 'repeats' };
    for (const [n, x] of Object.entries(s)) {
      let lo = Infinity, hi = -Infinity;
      for (const v of x) { if (v < lo) lo = v; if (v > hi) hi = v; }
      const floor = 1e-9 * (hi - lo) + 1e-12;
      // No spike at a wrap (a spike at t = 0 is accepted, at no other time):
      // across T, 2T and 3T an output steps at most twice as far as it does
      // anywhere in the ten samples on either side. Before inputs 50–52 an
      // input that ended away from where it started stepped there out of a
      // standstill, and the loop after it (the variable gain's u by 80 times
      // its steps around the wrap, the encoder example's voltage by 7 times).
      for (let p = 1; p < LONG; p++) {
        const k = p * N, wrap = Math.abs(x[k + 1] - x[k]);
        let near = 0;
        for (let j = k - 10; j <= k + 10; j++) if (j !== k) near = Math.max(near, Math.abs(x[j + 1] - x[j]));
        assert.ok(wrap <= 2 * near + floor, `${n} steps by ${wrap} at ${p * T} s, by at most ${near} around it`);
      }
      // Periodic after the start: period 4 against period 3.
      if (held.how === 'repeats') {
        let a = Infinity, b = -Infinity;
        for (let k = 2 * N + 1; k <= 4 * N; k++) { a = Math.min(a, x[k]); b = Math.max(b, x[k]); }
        const d = maxDiff(x, N, 2, 3);
        assert.ok(d <= 1e-4 * (b - a) + floor, `${n}: periods 3 and 4 differ by ${d} (span ${b - a})`);
      } else if (held.how === 'settles') {
        const d23 = maxDiff(x, N, 1, 2), d34 = maxDiff(x, N, 2, 3);
        assert.ok(d34 <= 0.3 * d23 + floor, `${n}: periods 3 and 4 differ by ${d34}, 2 and 3 by ${d23}`);
      } else {
        const p3 = periodStats(x, N, 2), p4 = periodStats(x, N, 3), tol = 0.1 * p3.sd + floor;
        assert.ok(Math.abs(p4.sd - p3.sd) <= tol, `${n}: rms deviation ${p4.sd} in period 4, ${p3.sd} in period 3`);
        if (held.turns?.includes(n)) assert.ok(Math.abs(p4.turn - p3.turn) <= 0.1 * Math.abs(p3.turn), `${n} turns ${p4.turn} in period 4, ${p3.turn} in period 3`);
        else assert.ok(Math.abs(p4.mean - p3.mean) <= tol, `${n}: mean ${p4.mean} in period 4, ${p3.mean} in period 3`);
      }
    }
  });
}

test('the mass–spring–damper is let go inside its period: no kick where F repeats, and its light damping makes every period alike', () => {
  const { T, N, s } = longRun('Mass–spring–damper'), { x, v, F: f } = s;
  // Nothing happens at a wrap: F holds, the acceleration does not step (the
  // second difference of v stays at the rounding of a smooth swing; it was
  // 2.1e-3 when F dropped to 0 there for 0.1 s).
  for (let p = 1; p < LONG; p++) {
    const k = p * N;
    assert.equal(f[k + 1], f[k], `F at ${p * T} s`);
    assert.ok(Math.abs(v[k + 1] - 2 * v[k] + v[k - 1]) < 1e-4, `v kinks at ${p * T} s`);
  }
  // Each period starts from where the last one left the mass, so the periods
  // differ by the swing the damper has not yet taken away: that difference
  // shrinks by e^(−c·T/2m) = e^(−1.25) a period (σ = 0.25 1/s), the physics.
  const diff = (a, b) => { let m = 0; for (let k = 1; k <= N; k++) m = Math.max(m, Math.abs(x[a * N + k] - x[b * N + k])); return m; };
  const d = [diff(0, 1), diff(1, 2), diff(2, 3)];
  for (let i = 1; i < d.length; i++) close(d[i] / d[i - 1], Math.exp(-1.25), 0.01, `period ${i + 1} against ${i + 2}`);
  assert.ok(d[1] < 3e-3 && d[2] < 1e-3, `periods 2 and 3 within 3 mm, 3 and 4 within 1 mm: ${d}`);
});

test('the encoder example runs up and back down: no jump where it repeats, its loop the same in every later period', () => {
  const sys = SYSTEM_LIBRARY.find((e) => e.name === 'Encoder errors and torque ripple');
  const run = (mask) => {
    const d = structuredClone(sys.plant.diagram);
    Object.assign(d.blocks.find((b) => b.id === 'motor').params, mask);
    return simulateSystem(normalizeDiagram(d), sys.input.signals, { duration: 20, sampleTime: 0.0025 }).signals;
  };
  const { N: P, s: full } = longRun(sys.name), quiet = run({ torqueNoise: 0, ripple: 0, encErrors: 0 });
  for (const n of ['speed', 'speed_m', 'V', 'i']) {
    // At each wrap: no step larger than the largest one inside a period (before: V jumped by 87 V, i by 49 A).
    let inner = 0;
    for (let k = P + 3; k < 4 * P - 1; k++) if (k % P > 2 && k % P < P - 2) inner = Math.max(inner, Math.abs(full[n][k + 1] - full[n][k]));
    for (const w of [1, 2, 3]) assert.ok(Math.abs(full[n][w * P + 1] - full[n][w * P]) < 0.2 * inner, `${n} at ${5 * w} s`);
    // Without what turns with the shaft's angle (ripple, encoder errors) and without noise, periods 2, 3 and 4 are one.
    let diff = 0, span = 0;
    for (let k = 1; k <= P; k++) { diff = Math.max(diff, Math.abs(quiet[n][P + k] - quiet[n][2 * P + k]), Math.abs(quiet[n][2 * P + k] - quiet[n][3 * P + k])); span = Math.max(span, Math.abs(quiet[n][P + k])); }
    assert.ok(diff < 1e-9 * span, `${n}: periods 2 to 4 differ by ${diff}`);
  }
});

test('the conical tank drains back before the period ends: from the second period on every period is the same', () => {
  const sys = SYSTEM_LIBRARY.find((s) => s.name === 'Conical tank, gain scheduling');
  const { dt: Ts, N } = longRun(sys.name);
  const run = (variant, periods) => {
    const d = structuredClone(sys.plant.diagram);
    d.blocks.find((b) => b.type === 'controller').variant = variant;
    return simulateSystem(normalizeDiagram(d), sys.input.signals, { duration: 5 * periods, sampleTime: Ts }).signals;
  };
  const diff = (x, a, b) => { let m = 0; for (let i = 0; i <= N; i++) m = Math.max(m, Math.abs(x[b * N + i] - x[a * N + i])); return m; };
  // The gain-scheduled PI and the PI tuned for empty are back at the start
  // level before the next period's first step, and every period repeats.
  for (const [variant, tol] of [[0, 1e-5], [2, 1e-3]]) {
    const s = variant === 0 ? longRun(sys.name).s : run(variant, 3);
    for (const n of ['h', 'q']) assert.ok(diff(s[n], 1, 2) < tol, `variant ${variant}: ${n} differs by ${diff(s[n], 1, 2)} between periods 2 and 3`);
    close(s.h[N + Math.round(1.5 / Ts) - 1], 0.15, 5e-4, `variant ${variant}: h before the second period's first step`);
  }
  // The PI tuned for full cannot hold the start level (it rests there only in
  // exact balance): it rings there from the drop, and its run settles into a
  // repeating one period by period, the high level calming it each time.
  const full = run(1, 6);
  assert.ok(diff(full.h, 4, 5) < 5e-3 && diff(full.h, 4, 5) < diff(full.h, 1, 2) / 20, `${diff(full.h, 1, 2)} → ${diff(full.h, 4, 5)}`);
  // Off cannot fill it: the tank runs dry at once, in every period.
  assert.ok(run(3, 2).h.subarray(N).every((v) => v === 0));
});
