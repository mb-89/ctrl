import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fft, nextPow2, WINDOWS, coherentGain, amplitudeSpectrum, spectrogram, designFilter, applyFilter, filterResponse, peaks, dbScale, DB_FLOOR, AUTO_LEVELS, spectrogramWindow, levelHistogram, quantileSorted, autoLevels, levelRange } from '../src/core/spectrum.js';

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

// ---- Spectrogram levels (the strip after pyqtgraph's HistogramLUTItem)

// Deterministic white noise: mulberry32 and Box–Muller.
function noise(n, std, seed = 1) {
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return Float64Array.from({ length: n }, () => std * Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd()));
}

test('levelHistogram: equal bins over [lo, hi], the last closed; outside counted apart; NaN left out', () => {
  const h = levelHistogram(Float32Array.from([0, 0.5, 1, 9.99, 10, -1, 11, NaN, 4.2]), 0, 10, 10);
  assert.deepEqual([...h.counts], [2, 1, 0, 0, 1, 0, 0, 0, 0, 2]);
  assert.equal(h.below, 1); assert.equal(h.above, 1); assert.equal(h.total, 8); assert.equal(h.width, 1);
  assert.equal(levelHistogram([], -100, 0, 50).counts.length, 50);
  assert.throws(() => levelHistogram([1], 0, 0, 4), /lo < hi/);
});

test('quantileSorted interpolates between ranks', () => {
  const s = Float32Array.from([1, 2, 3, 4]);
  assert.equal(quantileSorted(s, 0), 1); assert.equal(quantileSorted(s, 1), 4); assert.equal(quantileSorted(s, 0.5), 2.5);
  assert.ok(Number.isNaN(quantileSorted([], 0.5)));
});

test('spectrogramWindow takes the frames and rows the screen shows', () => {
  // 4 frames centred at 0.1, 0.2, 0.3, 0.4 s; 5 rows at 0, 10, …, 40 Hz; value = 10·frame + row.
  const sg = { frames: 4, bins: 5, t: Float64Array.from([0.1, 0.2, 0.3, 0.4]), f: Float64Array.from([0, 10, 20, 30, 40]) };
  const v = Float32Array.from({ length: 20 }, (_, q) => 10 * Math.floor(q / 5) + (q % 5));
  assert.deepEqual([...spectrogramWindow(sg, v)], [...v]);
  // t in [0.2, 0.3] (a frame is a hop wide, so 0.16 still reaches the one at 0.2); f in [12, 26]: rows 10, 20, 30 overlap it.
  assert.deepEqual([...spectrogramWindow(sg, v, { t0: 0.24, t1: 0.3, f0: 12, f1: 26 })], [11, 12, 13, 21, 22, 23]);
  assert.deepEqual([...spectrogramWindow(sg, v, { t0: 0.26, t1: 0.3, f0: 12, f1: 26 })], [21, 22, 23], 'the frame at 0.2 s ends at 0.25 s');
  assert.deepEqual([...spectrogramWindow(sg, v, { t0: 0.14, t1: 0.2, f0: 0, f1: 4 })], [0, 10]);
  assert.equal(spectrogramWindow(sg, v, { t0: 1, t1: 2 }).length, 0);
  assert.equal(spectrogramWindow({ frames: 0, bins: 5, t: new Float64Array(0), f: sg.f }, new Float32Array(0)).length, 0);
});

test('auto levels on sines in noise: the lines stand out, the noise is black', () => {
  // Lines on bin centres (13 and 41 bins of 3.906 Hz), so they do not leak
  // into the rows between.
  const dt = 1e-3, n = 8192, df = 1 / (256 * dt), f1 = 13 * df, f2 = 41 * df;
  const x = noise(n, 0.01, 7);
  for (let k = 0; k < n; k++) x[k] += Math.sin(2 * Math.PI * f1 * k * dt) + 0.02 * Math.sin(2 * Math.PI * f2 * k * dt);
  const sg = spectrogram(x, dt, { size: 256, overlap: 0.875, detrend: 'linear' });
  const d = dbScale(sg.amp, DB_FLOOR);
  const lv = autoLevels(spectrogramWindow(sg, d));
  // The ceiling is the strongest bin: the unit sine, 0 dB.
  near(lv.ceiling, 0, 0.05, 'ceiling');
  near(lv.floor, lv.median + AUTO_LEVELS.margin, 1e-9, 'floor = median + margin');
  // Every frame of both lines is above the floor (the weak one is −34 dB, about 22 dB over the noise) …
  const row = (f) => Math.round(f / df);
  const peakAt = (i, f) => Math.max(...[-1, 0, 1].map((o) => d[i * sg.bins + row(f) + o]));
  for (let i = 0; i < sg.frames; i++) {
    assert.ok(peakAt(i, f1) > lv.floor && peakAt(i, f2) > lv.floor, `frame ${i}`);
  }
  // … and almost no bin away from their main lobes (3 rows or more) is: for
  // white noise, 0.1 % of the bins lie 10 dB above the median. (Not the
  // lowest three rows: removing each frame's best line also removes a small
  // ramp's worth of the unit sine, which shows there.)
  let above = 0, count = 0;
  for (let i = 0; i < sg.frames; i++) for (let b = 3; b < sg.bins; b++) {
    if (Math.abs(b - row(f1)) < 3 || Math.abs(b - row(f2)) < 3) continue;
    count++; if (d[i * sg.bins + b] > lv.floor) above++;
  }
  assert.ok(above / count < 0.005, `${(100 * above / count).toFixed(2)} % of the noise bins above the floor`);
});

test('auto levels: the floor stays 20 to 80 dB below the ceiling', () => {
  const dt = 1e-3;
  // Noise alone: no line to show, so the noise shows (20 dB of it), not a few specks.
  const only = dbScale(spectrogram(noise(4096, 0.01, 3), dt, { size: 128 }).amp, DB_FLOOR);
  const a = autoLevels(only);
  near(a.ceiling - a.floor, AUTO_LEVELS.span, 1e-9, 'noise alone');
  assert.equal(a.rule, 'span');
  // A sine 120 dB above its noise: the range is at most 80 dB.
  const quiet = noise(4096, 1e-6, 5);
  for (let k = 0; k < quiet.length; k++) quiet[k] += Math.sin(2 * Math.PI * 62.5 * k * dt);
  const b = autoLevels(dbScale(spectrogram(quiet, dt, { size: 128 }).amp, DB_FLOOR));
  near(b.ceiling - b.floor, AUTO_LEVELS.depth, 1e-9, 'sine far above its noise');
  assert.equal(b.rule, 'depth');
  assert.equal(autoLevels([]), null);
  assert.equal(autoLevels([NaN, NaN]), null);
});

test('auto levels leave exact zeros out: a noise-free signal, a sweep just begun', () => {
  // A sine on a bin centre and nothing else: outside its main lobe every bin
  // is exactly zero (DB_FLOOR). Counted, they would make the median −240 dB.
  const dt = 1e-3, clean = dbScale(spectrogram(sine(4096, dt, 62.5), dt, { size: 128 }).amp, DB_FLOOR);
  const zeros = clean.filter((v) => v <= DB_FLOOR).length;
  assert.ok(zeros > clean.length / 2, `${zeros} of ${clean.length} bins zero`);
  const a = autoLevels(clean);
  assert.equal(a.zeros, zeros);
  assert.ok(a.median > DB_FLOOR + 100, `median ${a.median} dB of the bins that are not zero`);
  assert.equal(a.rule, 'span', 'the main lobe alone: 20 dB of it shows');
  assert.equal(a.sorted.length, clean.length, 'the histogram still counts every bin shown');
  // Nothing but zeros: nothing to set levels by.
  assert.equal(autoLevels(new Float32Array(50).fill(DB_FLOOR)), null);
  // The strip's range starts at the 1st percentile of the bins that are not zero.
  assert.deepEqual(levelRange(a.sorted), levelRange(a.sorted.filter((v) => v > DB_FLOOR)));
  assert.ok(levelRange(a.sorted)[0] > -100, `${levelRange(a.sorted)}`);
});

test('levelRange: whole 10 dB from the 1st percentile to above the largest, levels inside', () => {
  const s = Float32Array.from({ length: 1000 }, (_, k) => -80 + (k / 999) * 90).sort();   // −80 … 10 dB
  assert.deepEqual(levelRange(s), [-90, 20]);
  assert.deepEqual(levelRange(s, [-120, 35]), [-120, 40]);
  assert.deepEqual(levelRange(new Float32Array(0)), [-100, 0]);
  const deep = Float32Array.from([...Array(100).fill(-230), ...Array(400).fill(0)]).sort();
  assert.deepEqual(levelRange(deep), [-190, 10], 'at most 200 dB deep');
  const zeros = Float32Array.from([...Array(100).fill(DB_FLOOR), ...Array(400).fill(0)]).sort();
  assert.deepEqual(levelRange(zeros), [-10, 10], 'exact zeros left out');
  assert.deepEqual(levelRange(new Float32Array(10).fill(DB_FLOOR)), [-100, 0], 'nothing but zeros');
});

test('the encoder example: automatic levels show the orders and the resonance, not the noise', async () => {
  const { SYSTEM_LIBRARY, SYSTEM_PARTS, applySystem } = await import('../src/core/systems.js');
  const { normalizeProject, evaluateSystem, autoTimebase } = await import('../src/core/project.js');
  const entry = SYSTEM_LIBRARY.find((e) => e.name === 'Encoder errors and torque ripple');
  const p = normalizeProject(applySystem(normalizeProject({}), entry, SYSTEM_PARTS.filter((k) => entry[k])));
  p.scope.timebase = autoTimebase(p);   // as loading it does: 500 ms/div
  const data = evaluateSystem(p), dt = data.t[1] - data.t[0], n = data.t.length - 1;
  // As the scope computes it (src/ui/freqview.js).
  const size = Math.max(64, Math.min(512, 2 ** Math.round(Math.log2(n / 16))));
  const sg = spectrogram(data.signals.speed_m, dt, { size, overlap: 0.875, detrend: 'linear' });
  const d = dbScale(sg.amp, DB_FLOOR), lv = autoLevels(spectrogramWindow(sg, d));
  const fn = 0.5 / dt, alias = (f) => { const m = f % (2 * fn); return m > fn ? 2 * fn - m : m; };
  const at = (i, f) => { const b = Math.round(f / sg.f[1]); return Math.max(...[-1, 0, 1].map((o) => d[i * sg.bins + Math.min(sg.bins - 1, Math.max(0, b + o))])); };
  const share = (pred) => { let k = 0, m = 0; for (let i = 0; i < sg.frames; i++) { const r = pred(i, data.signals.speed[Math.round(sg.t[i] / dt)]); if (r === null) continue; m++; if (r > lv.floor) k++; } return k / m; };
  const order = (k) => (i, w) => (w > 20 ? at(i, alias((k * w) / (2 * Math.PI))) : null);
  assert.equal(share(order(1)), 1, '1× on every frame');
  assert.equal(share(order(2)), 1, '2× on every frame');
  assert.equal(share((i, w) => (w > 20 && (6 * w) / (2 * Math.PI) < 90 ? at(i, (6 * w) / (2 * Math.PI)) : null)), 1, '6× up to 90 Hz');
  assert.ok(share((i) => at(i, 70)) >= 0.95, 'the 70 Hz resonance');
  // Before, the heat map was 80 dB deep below the largest bin: most bins showed.
  const above = (floor) => d.filter((v) => v > floor).length / d.length;
  assert.ok(above(lv.floor) < 0.4 && above(lv.ceiling - 80) > 0.6, `${above(lv.floor)} of the bins above the floor; ${above(lv.ceiling - 80)} before`);
});

test('scope.view.levels: per signal, [floor, ceiling] in dB, normalised; absent means automatic', async () => {
  const { normalizeScope, normalizeProject, withLevels, levelsOf } = await import('../src/core/project.js');
  const lv = (pair) => normalizeScope({ view: { mode: 'spectrogram', levels: { speed_m: pair } } }, 1).view.levels?.speed_m;
  assert.deepEqual(lv([-30, 10]), [-30, 10]);
  assert.deepEqual(lv([10, -30]), [-30, 10], 'a reversed pair is swapped');
  assert.deepEqual(lv([-30.04, 9.96]), [-30, 10], 'rounded to 0.1 dB');
  for (const bad of [[0, 0.5], ['-30', 10], [NaN, 0], [-Infinity, 0], [-400, 0], [0], [-30, 0, 10], 'auto', null]) assert.equal(lv(bad), undefined, JSON.stringify(bad));
  // One pair per signal: dB of rad/s are not dB of V.
  const two = normalizeScope({ view: { levels: { speed_m: [-60, 20], u: [-40, 0], bad: [0, 0], '': [-1, 9] } } }, 1).view;
  assert.deepEqual(two, { levels: { speed_m: [-60, 20], u: [-40, 0] } }, 'kept in the time view too: they belong to the view');
  for (const bad of [[-60, 20], 'x', null, {}]) assert.equal(normalizeScope({ view: { levels: bad } }, 1).view, undefined, `${JSON.stringify(bad)}: no signal named`);
  assert.equal(normalizeScope({ view: JSON.parse('{"levels":{"__proto__":[-10,0]}}') }, 1).view, undefined);
  const p = normalizeProject({ scope: { view: { mode: 'spectrogram', levels: { speed_m: [-48.5, 12] } } } });
  assert.deepEqual(normalizeProject(JSON.parse(JSON.stringify(p))).scope.view, { mode: 'spectrogram', levels: { speed_m: [-48.5, 12] } }, 'survives saving and opening');
  // Setting one signal's levels keeps the others'; null returns it to automatic.
  let v = withLevels({ mode: 'spectrogram' }, 'speed_m', [-60, 20]);
  v = withLevels(v, 'u', [-40, 0]);
  assert.deepEqual(v, { mode: 'spectrogram', levels: { speed_m: [-60, 20], u: [-40, 0] } });
  assert.deepEqual(levelsOf(v, 'u'), [-40, 0]);
  assert.equal(levelsOf(v, 'y'), null, 'a signal without levels: automatic');
  assert.equal(levelsOf(v, 'constructor'), null, 'only the view\'s own names');
  v = withLevels(withLevels(v, 'u', null), 'speed_m', null);
  assert.deepEqual(v, { mode: 'spectrogram' }, 'no pair left: absent');
});
