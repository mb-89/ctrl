import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fft, nextPow2, WINDOWS, coherentGain, amplitudeSpectrum, spectrogram, designFilter, applyFilter, filterResponse, peaks, dbScale } from '../src/core/spectrum.js';

const sine = (n, dt, f, a = 1, ph = 0) => Float64Array.from({ length: n }, (_, k) => a * Math.sin(2 * Math.PI * f * k * dt + ph));
const near = (actual, expected, tol, what = '') => assert.ok(Math.abs(actual - expected) <= tol, `${what} ${actual} vs ${expected} ± ${tol}`);
const db = (m) => 20 * Math.log10(m);

// Amplitude of the tone at f in y[from..to), projected onto sin and cos over
// whole periods.
function toneAmp(y, dt, f, from, to) {
  let s = 0, c = 0;
  for (let k = from; k < to; k++) {
    s += y[k] * Math.sin(2 * Math.PI * f * k * dt);
    c += y[k] * Math.cos(2 * Math.PI * f * k * dt);
  }
  return (2 * Math.hypot(s, c)) / (to - from);
}

test('fft matches a direct DFT; nextPow2 rounds up', () => {
  const n = 64;
  const re = Float64Array.from({ length: n }, (_, k) => Math.sin(k * 1.7) + 0.3 * Math.cos(k * k));
  const im = Float64Array.from({ length: n }, (_, k) => Math.cos(k * 0.9) - 0.2);
  const x = [Float64Array.from(re), Float64Array.from(im)];
  fft(re, im);
  for (let k = 0; k < n; k++) {
    let sr = 0, si = 0;
    for (let j = 0; j < n; j++) {
      const a = (-2 * Math.PI * k * j) / n;
      sr += x[0][j] * Math.cos(a) - x[1][j] * Math.sin(a);
      si += x[0][j] * Math.sin(a) + x[1][j] * Math.cos(a);
    }
    near(re[k], sr, 1e-9, `re[${k}]`);
    near(im[k], si, 1e-9, `im[${k}]`);
  }
  assert.throws(() => fft(new Float64Array(12), new Float64Array(12)), /power of two/);
  assert.deepEqual([0, 1, 5, 4096, 4097].map(nextPow2), [1, 1, 8, 4096, 8192]);
});

test('windows: coherent gain is the mean of the window', () => {
  const expected = { rect: 1, hann: 0.5, hamming: 0.54, blackman: 0.42, flattop: 0.21557895 };
  for (const [name, cg] of Object.entries(expected)) {
    const w = WINDOWS[name](1024);
    assert.equal(w.length, 1024);
    near(coherentGain(w), cg, 1e-9, name);
  }
});

test('a two-tone signal reads amplitudes 1 and 0.25 within 1 % (flattop and hann)', () => {
  const n = 4096, dt = 1e-3, df = 1 / (n * dt);
  const x = sine(n, dt, 200 * df, 1, 0.3).map((v, k) => v + 0.25 * Math.sin(2 * Math.PI * 600 * df * k * dt + 1.1));
  for (const window of ['flattop', 'hann']) {
    const s = amplitudeSpectrum(x, dt, { window });
    assert.equal(s.f.length, n / 2 + 1);
    near(s.df, df, 1e-12, 'df');
    near(s.fNyquist, 500, 1e-9, 'fNyquist');
    near(s.amp[200], 1, 0.01, `${window} tone 1`);
    near(s.amp[600], 0.25, 0.0025, `${window} tone 2`);
    const p = peaks(s.f, s.amp, { window });
    near(p[0].f, 200 * df, 1e-9, `${window} peak 1`);
    near(p[1].f, 600 * df, 1e-9, `${window} peak 2`);
  }
});

test('a padded record with an off-bin tone reads right through flattop, and through hann with peaks', () => {
  const n = 3000, dt = 1e-3, f = 123.4;
  const x = sine(n, dt, f, 0.7, 0.4);
  const flat = amplitudeSpectrum(x, dt, { window: 'flattop' });
  assert.equal(flat.f.length, 4096 / 2 + 1);
  near(Math.max(...flat.amp), 0.7, 0.007, 'flattop max bin');
  const hann = amplitudeSpectrum(x, dt);
  const [p] = peaks(hann.f, hann.amp);
  near(p.amp, 0.7, 0.007, 'hann peak amplitude');
  near(p.f, f, 0.05 * hann.df, 'hann peak frequency');
});

test('DC: detrend none reads the mean, mean removes it, linear removes a ramp', () => {
  const n = 1024, dt = 0.01, df = 1 / (n * dt);
  const x = sine(n, dt, 64 * df).map((v) => v + 2.5);
  const none = amplitudeSpectrum(x, dt, { detrend: 'none' });
  near(none.amp[0], 2.5, 1e-9, 'DC with detrend none');
  near(none.amp[64], 1, 1e-9, 'tone');
  near(amplitudeSpectrum(x, dt, { detrend: 'none', window: 'rect' }).amp[0], 2.5, 1e-9, 'DC, rect');
  assert.ok(amplitudeSpectrum(x, dt).amp[0] < 1e-12, 'DC removed by detrend mean');
  const ramp = x.map((v, k) => v + 3 * k * dt);
  const mean = amplitudeSpectrum(ramp, dt, { detrend: 'mean' });
  const linear = amplitudeSpectrum(ramp, dt, { detrend: 'linear' });
  assert.ok(mean.amp[1] > 1, `a ramp leaks into the low bins: ${mean.amp[1]}`);
  for (let k = 0; k < 4; k++) assert.ok(linear.amp[k] < 0.02, `bin ${k} after linear detrend: ${linear.amp[k]}`);
  near(linear.amp[64], 1, 0.01, 'tone after linear detrend');
  assert.throws(() => amplitudeSpectrum(x, dt, { detrend: 'quadratic' }), /detrend/);
  assert.throws(() => amplitudeSpectrum(x, dt, { window: 'kaiser' }), /window/);
});

test('a linear chirp: the spectrogram peak rises frame by frame', () => {
  const n = 4096, dt = 1e-3, T = n * dt, f0 = 50, f1 = 400;
  const x = Float64Array.from({ length: n }, (_, k) => {
    const t = k * dt;
    return Math.sin(2 * Math.PI * (f0 * t + (0.5 * (f1 - f0) * t * t) / T));
  });
  const s = spectrogram(x, dt);
  assert.equal(s.size, 256);
  assert.equal(s.hop, 64);
  assert.equal(s.frames, (n - 256) / 64 + 1);
  assert.equal(s.bins, 129);
  assert.equal(s.amp.length, s.frames * s.bins);
  near(s.t[0], 127.5 * dt, 1e-12, 'first frame centre');
  let last = 0;
  for (let i = 0; i < s.frames; i++) {
    const row = s.amp.subarray(i * s.bins, (i + 1) * s.bins);
    const [p] = peaks(s.f, row, { count: 1 });
    assert.ok(p.f > last, `frame ${i}: ${p.f} Hz after ${last} Hz`);
    near(p.f, f0 + ((f1 - f0) * s.t[i]) / T, 2 / (s.size * dt), `frame ${i} frequency`);
    // The chirp sweeps about 6 bins within a frame, so its peak reads below 1.
    assert.ok(p.amp > 0.6 && p.amp <= 1, `frame ${i} amplitude ${p.amp}`);
    last = p.f;
  }
});

test('spectrogram shrinks its frame for short signals and caps the frame count', () => {
  const short = spectrogram(sine(100, 1e-3, 50), 1e-3);
  assert.equal(short.size, 64);
  assert.equal(short.frames, 3);
  assert.equal(short.bins, 33);
  assert.equal(spectrogram(sine(10, 1e-3, 50), 1e-3).frames, 0);
  const long = spectrogram(sine(20000, 1e-3, 50), 1e-3, { maxFrames: 100 });
  assert.ok(long.frames <= 100 && long.frames > 90, `${long.frames} frames`);
});

test('Butterworth lowpass of order 4: −3 dB at f0, −24 dB per octave above', () => {
  const dt = 1e-3, f0 = 10;
  const lp = designFilter({ type: 'lowpass', f0, order: 4, dt });
  assert.equal(lp.sections.length, 2);
  const { mag, phaseDeg } = filterResponse(lp, [1, f0, 4 * f0, 8 * f0]);
  near(mag[0], 1, 1e-4, 'passband');
  near(db(mag[1]), -3.0103, 0.001, 'at f0');
  near(phaseDeg[1], -180, 1e-6, 'phase at f0');
  const slope = db(mag[2]) - db(mag[3]);
  assert.ok(slope > 23 && slope < 26, `${slope} dB per octave`);
  // The time-domain filter agrees with the response: a sine at f0 comes out at 1/√2.
  const y = applyFilter(lp, sine(4000, dt, f0));
  near(toneAmp(y, dt, f0, 2000, 4000), Math.SQRT1_2, 0.007, 'filtered sine at f0');
  // Started in steady state: a constant passes without a transient.
  const c = applyFilter(lp, new Float64Array(500).fill(3));
  for (const v of c) near(v, 3, 1e-9, 'constant');
});

test('Butterworth highpass mirrors the lowpass', () => {
  const dt = 1e-3, f0 = 10;
  const lp = designFilter({ type: 'lowpass', f0, order: 4, dt });
  const hp = designFilter({ type: 'highpass', f0, order: 4, dt });
  near(db(filterResponse(hp, [f0]).mag[0]), -3.0103, 0.001, 'at f0');
  // Exact mirror in the prewarped frequency: tan(π f' dt) = tan²(π f0 dt) / tan(π f dt).
  const w0 = Math.tan(Math.PI * f0 * dt);
  for (const f of [15, 20, 40, 80]) {
    const fm = Math.atan((w0 * w0) / Math.tan(Math.PI * f * dt)) / (Math.PI * dt);
    near(filterResponse(hp, [fm]).mag[0], filterResponse(lp, [f]).mag[0], 1e-9, `${fm} Hz vs ${f} Hz`);
  }
  const m = filterResponse(hp, [f0 / 4, f0 / 8]).mag;
  const slope = db(m[0]) - db(m[1]);
  assert.ok(slope > 23 && slope < 26, `${slope} dB per octave`);
  const c = applyFilter(hp, new Float64Array(500).fill(3));
  for (const v of c) near(v, 0, 1e-9, 'constant');
});

test('a notch removes a sine at f0 and passes 3·f0', () => {
  const dt = 1e-3, f0 = 50, n = 4000;
  const notch = designFilter({ type: 'notch', f0, q: 5, dt });
  assert.ok(filterResponse(notch, [f0]).mag[0] < 1e-9);
  const y = applyFilter(notch, sine(n, dt, f0));
  for (let k = 1000; k < n; k++) assert.ok(Math.abs(y[k]) < 0.02, `residual ${y[k]} at ${k}`);
  const y3 = applyFilter(notch, sine(n, dt, 3 * f0));
  near(toneAmp(y3, dt, 3 * f0, 2000, n), 1, 0.02, '3·f0 passes');
});

test('zero-phase filtering has no lag on a slow sine', () => {
  const dt = 1e-3, n = 4000;
  const x = sine(n, dt, 1).map((v) => v + 0.5);
  const lp = designFilter({ type: 'lowpass', f0: 20, order: 4, dt });
  const lagged = applyFilter(lp, x);
  const zero = applyFilter(lp, x, { zeroPhase: true });
  let eLag = 0, eZero = 0;
  for (let k = 0; k < n; k++) {
    eLag = Math.max(eLag, Math.abs(lagged[k] - x[k]));
    eZero = Math.max(eZero, Math.abs(zero[k] - x[k]));
  }
  assert.ok(eLag > 0.05, `the causal filter lags: ${eLag}`);
  assert.ok(eZero < 1e-3, `zero-phase error, ends included: ${eZero}`);
  // Forward-backward squares the magnitude: −6 dB at f0.
  const y = applyFilter(lp, sine(n, dt, 20), { zeroPhase: true });
  near(toneAmp(y, dt, 20, 1000, 3000), 0.5, 0.005, 'zero-phase gain at f0');
});

test('aliasing: a sine at 0.8/dt appears at 0.2/dt', () => {
  const dt = 1e-3, n = 4096;
  const s = amplitudeSpectrum(sine(n, dt, 0.8 / dt, 0.5), dt);
  const [p] = peaks(s.f, s.amp);
  near(p.f, 0.2 / dt, 0.05 * s.df, 'alias frequency');
  near(p.amp, 0.5, 0.005, 'alias amplitude');
});

test('designFilter clamps f0 and says so; bandpass is 0 dB at f0', () => {
  const dt = 1e-3;
  const hi = designFilter({ type: 'lowpass', f0: 800, order: 3, dt });
  assert.equal(hi.f0, 490);
  assert.equal(hi.order, 4);
  assert.ok(hi.clamped);
  assert.match(hi.describe, /clamped to 490 Hz/);
  assert.match(hi.describe, /order 3 taken as 4/);
  const lo = designFilter({ type: 'highpass', f0: -5, dt });
  assert.ok(lo.f0 > 0 && lo.clamped);
  const ok = designFilter({ type: 'notch', f0: 50, q: 5, dt });
  assert.equal(ok.clamped, false);
  assert.equal(ok.describe, 'notch 50 Hz, Q 5');
  assert.throws(() => designFilter({ type: 'comb', f0: 50, dt }), /lowpass, highpass, bandpass, notch/);
  assert.throws(() => designFilter({ type: 'notch', f0: 50, q: 0, dt }), /q/);
  const bp = designFilter({ type: 'bandpass', f0: 50, q: 2, dt });
  const { mag, phaseDeg } = filterResponse(bp, [50, 5, 400]);
  near(mag[0], 1, 1e-9, 'bandpass at f0');
  near(phaseDeg[0], 0, 1e-6, 'bandpass phase at f0');
  assert.ok(mag[1] < 0.1 && mag[2] < 0.15, `bandpass skirts ${mag[1]}, ${mag[2]}`);
});

test('dbScale floors at floorDb', () => {
  assert.deepEqual([...dbScale([1, 0.1, 0, 1e-6, -10])], [0, -20, -100, -100, 20]);
  assert.deepEqual([...dbScale([1e-4, 1e-2], -60)], [-60, -40]);
});

test('performance: spectrum and spectrogram of 4096 samples in under 20 ms', () => {
  const dt = 1e-4, n = 4096;
  const x = Float64Array.from({ length: n }, (_, k) => Math.sin(k * 0.05) + 0.1 * Math.sin(k * 1.3) + 0.01 * Math.cos(k * k));
  amplitudeSpectrum(x, dt);
  spectrogram(x, dt);
  const times = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    amplitudeSpectrum(x, dt, { window: 'flattop' });
    spectrogram(x, dt);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  assert.ok(times[2] < 20, `median ${times[2].toFixed(2)} ms`);
});
