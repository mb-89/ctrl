// The Sine's ease and the reference's derivatives ṙ, r̈.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { referenceFn, normalizeReference } from '../src/core/signals.js';

const ctx = { sampleTime: 1e-3 };
const ref = (components, period = 5) => normalizeReference({ period, components });
const sine = (params) => ({ type: 'sine', params });
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
// 5-point central differences of a function, with step h.
const d1 = (f, t, h = 1e-4) => (f(t - 2 * h) - 8 * f(t - h) + 8 * f(t + h) - f(t + 2 * h)) / (12 * h);
const d2 = (f, t, h = 1e-3) => (-f(t - 2 * h) + 16 * f(t - h) - 30 * f(t) + 16 * f(t + h) - f(t + 2 * h)) / (12 * h * h);
const ts = (a, b, n) => Array.from({ length: n }, (_, i) => a + ((b - a) * (i + 0.5)) / n);

test('ease 0 is bit for bit the old sine', () => {
  const q = { amplitude: 0.7, time: 0.13, frequency: 3.1, phase: 37 };
  const r = referenceFn(ref([sine(q)], 2), ctx);
  const old = (t) => (t >= q.time ? q.amplitude * Math.sin(2 * Math.PI * q.frequency * (t - q.time) + (q.phase * Math.PI) / 180) : 0);
  for (let i = 0; i <= 2000; i++) { const t = i * 0.000997; assert.equal(r(t), old(t), `t = ${t}`); }
  assert.equal(normalizeReference({ components: [sine({})] }).components[0].params.ease, 0);
});

test("the eased sine's ṙ and r̈ match differences of r", () => {
  const r = referenceFn(ref([sine({ amplitude: 0.15, time: 0.2, frequency: 0.4, phase: 30, ease: 0.5 })]), ctx);
  const v = r.derivative(1), a = r.derivative(2);
  assert.deepEqual(v.warnings, []);
  assert.deepEqual(a.warnings, []);
  for (const t of ts(0.21, 3, 97)) {
    close(v(t), d1(r, t), 1e-9, `ṙ at ${t}`);
    close(a(t), d2(r, t), 1e-6, `r̈ at ${t}`);
    close(a(t), d1(v, t), 1e-8, `r̈ from ṙ at ${t}`);
  }
});

test('the eased sine is C² at the end of the ease', () => {
  const q = { amplitude: 0.15, time: 0.3, frequency: 0.4, phase: 90, ease: 0.5 };
  const r = referenceFn(ref([sine(q)]), ctx), v = r.derivative(1), a = r.derivative(2);
  const te = q.time + q.ease, e = 1e-9;
  for (const f of [r, v, a]) close(f(te - e), f(te + e), 1e-7, 'continuous at the end of the ease');
  close(v(te + e), q.amplitude * 2 * Math.PI * q.frequency * Math.cos(2 * Math.PI * q.frequency * q.ease / 2 + Math.PI / 2), 1e-7, 'full speed after the ease');
});

test('speed and acceleration start at 0 with an ease', () => {
  const r = referenceFn(ref([sine({ amplitude: 0.15, frequency: 0.4, phase: 90, ease: 0.5 })]), ctx);
  assert.equal(r(0), 0.15);
  assert.equal(r.derivative(1)(0), 0);
  assert.equal(r.derivative(2)(0), 0);
});

test('the eased pair draws exactly the circle', () => {
  const a = referenceFn(ref([sine({ amplitude: 0.15, frequency: 0.4, phase: 90, ease: 0.5 }), { type: 'dc', params: { level: -0.15 } }]), ctx);
  const b = referenceFn(ref([sine({ amplitude: 0.15, frequency: 0.4, phase: 0, ease: 0.5 })]), ctx);
  for (let i = 0; i <= 5000; i++) {
    const t = i * 1e-3;
    close(Math.hypot(a(t) + 0.15, b(t)), 0.15, 1e-12, `radius at ${t}`);
  }
});

test('derivatives of every type', () => {
  const at = (comp, k, t) => referenceFn(ref([comp], 10), ctx).derivative(k)(t);
  // DC
  assert.equal(at({ type: 'dc', params: { level: 3 } }, 1, 0.5), 0);
  assert.equal(at({ type: 'dc', params: { level: 3 } }, 2, 0.5), 0);
  // Ramp: its slope inside, 0 outside.
  const ramp = { type: 'ramp', params: { amplitude: 2, time: 0.1, rise: 0.5 } };
  assert.equal(at(ramp, 1, 0.05), 0);
  assert.equal(at(ramp, 1, 0.3), 4);
  assert.equal(at(ramp, 1, 0.7), 0);
  assert.equal(at(ramp, 2, 0.3), 0);
  assert.match(referenceFn(ref([ramp]), ctx).derivative(2).warnings[0], /impulses are left out/);
  assert.deepEqual(referenceFn(ref([ramp]), ctx).derivative(1).warnings, []);
  // Plain sine.
  const s = sine({ amplitude: 2, time: 0.1, frequency: 1.5, phase: 20 });
  const w = 2 * Math.PI * 1.5, ph = (20 * Math.PI) / 180;
  close(at(s, 1, 0.4), 2 * w * Math.cos(w * 0.3 + ph), 1e-12, 'sine ṙ');
  close(at(s, 2, 0.4), -2 * w * w * Math.sin(w * 0.3 + ph), 1e-10, 'sine r̈');
  assert.equal(at(s, 1, 0.05), 0);
  // Chirp: exact, against differences.
  const chirp = { type: 'chirp', params: { amplitude: 1.5, time: 0.2, f0: 1, f1: 6, duration: 2 } };
  const rc = referenceFn(ref([chirp], 10), ctx);
  for (const t of ts(0.21, 2.19, 41)) {
    close(rc.derivative(1)(t), d1(rc, t), 1e-7, `chirp ṙ at ${t}`);
    close(rc.derivative(2)(t), d2(rc, t), 1e-4, `chirp r̈ at ${t}`);
  }
  assert.equal(rc.derivative(1)(2.5), 0);
  // Function: differences of the expression.
  const fn = { type: 'fn', params: {}, expr: 'sin(3*t) + t^2' };
  close(at(fn, 1, 0.7), 3 * Math.cos(2.1) + 1.4, 1e-8, 'fn ṙ');
  close(at(fn, 2, 0.7), -9 * Math.sin(2.1) + 2, 1e-4, 'fn r̈');
  // Arb: piecewise slopes, with its gain and shift.
  const arb = { type: 'arb', params: { gain: 2, shift: 0.5 }, points: [[0, 0], [1, 1], [2, -1]] };
  assert.equal(at(arb, 1, 0.4), 0);
  assert.equal(at(arb, 1, 1), 2);
  assert.equal(at(arb, 1, 2), -4);
  assert.equal(at(arb, 1, 2.6), 0);
  assert.equal(at(arb, 2, 1), 0);
  // Step and Square: 0, with a warning.
  const step = referenceFn(ref([{ type: 'step', params: { amplitude: 1, time: 0.1 } }]), ctx).derivative(1);
  assert.equal(step(0.1), 0);
  assert.deepEqual(step.warnings, ['the step at 0.10 s has no finite derivative: use a ramp or an eased sine']);
  const sq = referenceFn(ref([{ type: 'square', params: { amplitude: 1, time: 0.25 } }]), ctx).derivative(2);
  assert.equal(sq(0.3), 0);
  assert.match(sq.warnings[0], /0\.25 s has no finite derivative/);
  // Components add; disabled ones are left out.
  const two = referenceFn(ref([ramp, { ...ramp, params: { ...ramp.params, amplitude: 1 } }, { type: 'step', params: {}, enabled: false }]), ctx).derivative(1);
  assert.equal(two(0.3), 6);
  assert.deepEqual(two.warnings, []);
  assert.throws(() => referenceFn(ref([ramp]), ctx).derivative(3), /k must be 1 or 2/);
});

test('r and its derivatives repeat with the period; the ease is the first period\'s alone', () => {
  const T = 2, q = { amplitude: 1, time: 0.1, frequency: 0.7, phase: 10, ease: 0.4 };
  const r = referenceFn(ref([sine(q)], T), ctx);
  const v = r.derivative(1), a = r.derivative(2);
  // From the second period on, every period is the same.
  for (const t of ts(0, T, 23)) for (const k of [2, 3]) {
    close(r(t + k * T), r(t + T), 1e-12, `r at ${t} + ${k}T`);
    close(v(t + k * T), v(t + T), 1e-9, `ṙ at ${t} + ${k}T`);
    close(a(t + k * T), a(t + T), 1e-8, `r̈ at ${t} + ${k}T`);
  }
  // After the ease the first period is the steady one too.
  for (const t of ts(q.time + q.ease, T, 11)) {
    close(v(t + T), v(t), 1e-9, `ṙ at ${t} + T`);
    close(a(t + T), a(t), 1e-8, `r̈ at ${t} + T`);
  }
  // (k·T, (k+1)·T]: the sample at T is still the first period's.
  const once = referenceFn(ref([sine(q)], 100), ctx).derivative(1);
  assert.equal(v(T), once(T));
  // The second period runs on the steady phase throughout: before the sine's
  // start time too (it does not stop and switch on again there).
  const w = 2 * Math.PI * q.frequency, ph = (q.phase * Math.PI) / 180;
  close(v(T + 0.05), w * Math.cos(w * (0.05 - q.time - q.ease / 2) + ph), 1e-12, 'before its start time, on the steady phase');
  close(v(T + 0.3), w * Math.cos(w * (0.3 - q.time - q.ease / 2) + ph), 1e-12, 'the steady phase in the second period');
  close(a(T + 0.05), -w * w * Math.sin(w * (0.05 - q.time - q.ease / 2) + ph), 1e-12, 'r̈ before its start time, on the steady phase');
  const ramp = referenceFn(ref([{ type: 'ramp', params: { amplitude: 1, time: 0, rise: 2 } }], T), ctx).derivative(1);
  assert.equal(ramp(T), 0, 'at T the ramp is over: the first period');
  assert.equal(ramp(T + 0.5), 0.5, 'then it starts again');
});

test('noise is refused', () => {
  const r = referenceFn(ref([{ type: 'noise', params: { std: 0.1 } }, { type: 'dc', params: {} }]), ctx);
  assert.throws(() => r.derivative(1), /^Error: noise has no derivative: /);
  assert.throws(() => r.derivative(2), /noise has no derivative/);
  const off = referenceFn(ref([{ type: 'noise', params: {}, enabled: false }]), ctx);
  assert.equal(off.derivative(1)(0.3), 0, 'a disabled noise is left out');
});
