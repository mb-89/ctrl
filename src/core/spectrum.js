// Spectra of sampled signals, for the scope's FFT and spectrogram modes, and
// the display filters applied in those modes. Pure functions, no DOM: shared
// by browser and Node. Signals are sampled on a uniform grid with step dt (s);
// frequencies are in Hz.
//
// Amplitude convention: every spectrum here is a single-sided amplitude
// spectrum in the signal's own unit. A sine A·sin(2π f t + φ) at a bin
// frequency reads A in its bin; the DC bin reads |mean| (the window-weighted
// mean, equal to the plain mean for a constant). For a window w of length N
// with coherent gain CG = Σw / N, that sine gives |X[k]| = A·N·CG / 2, so
//   amp[k] = 2·|X[k]| / (N·CG)   (DC and Nyquist bins: |X[k]| / (N·CG)).
// N is the number of signal samples, not the zero-padded FFT length. A tone
// between bins reads low by the window's scalloping loss: up to 36 % (rect),
// 15 % (hann), 18 % (hamming), 12 % (blackman), 0.1 % (flattop). Flattop reads
// amplitudes straight from the bins but smears close tones together; peaks()
// recovers the loss for hann, hamming and blackman. Noise is not scaled to a
// density: this is an amplitude spectrum, not a PSD.

// Smallest power of two >= n (1 for n <= 1).
export function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// Largest power of two <= n (0 for n < 1).
function prevPow2(n) {
  if (!(n >= 1)) return 0;
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return p;
}

function checkDt(dt) {
  if (!(dt > 0) || !Number.isFinite(dt)) throw new Error(`dt must be a positive number, got ${dt}`);
}

// cos/sin of 2πk/n for k < n/2, kept per length: the spectrogram calls the
// same small FFT once per frame.
const TWIDDLES = new Map();
function twiddles(n) {
  let t = TWIDDLES.get(n);
  if (!t) {
    if (TWIDDLES.size >= 8) TWIDDLES.clear();
    const half = n >> 1;
    const cos = new Float64Array(half), sin = new Float64Array(half);
    for (let k = 0; k < half; k++) {
      cos[k] = Math.cos((2 * Math.PI * k) / n);
      sin[k] = Math.sin((2 * Math.PI * k) / n);
    }
    t = { cos, sin };
    TWIDDLES.set(n, t);
  }
  return t;
}

// In-place forward complex FFT, X[k] = Σ x[n] e^(−2πi kn/N), unscaled.
// Iterative radix-2: bit-reversal permutation, then log2 N butterfly stages.
export function fft(re, im) {
  const n = re.length;
  if (im.length !== n) throw new Error(`fft: re and im differ in length (${n}, ${im.length})`);
  if (n & (n - 1)) throw new Error(`fft: length ${n} is not a power of two`);
  if (n <= 1) return;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }
  const { cos, sin } = twiddles(n);
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1, step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0, t = 0; k < half; k++, t += step) {
        const wr = cos[t], wi = -sin[t];
        const a = i + k, b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

// w[n] = Σ (−1)^k a_k cos(2π k n / N). Periodic (DFT-even) windows, as used
// for spectral analysis: a bin-centred sine then sits exactly on a bin.
function cosineSum(N, a) {
  const w = new Float64Array(N);
  if (N <= 1) return w.fill(1);
  for (let n = 0; n < N; n++) {
    const x = (2 * Math.PI * n) / N;
    let v = 0;
    for (let k = 0; k < a.length; k++) v += (k % 2 ? -a[k] : a[k]) * Math.cos(k * x);
    w[n] = v;
  }
  return w;
}

export const WINDOWS = {
  rect: (N) => new Float64Array(N).fill(1),
  hann: (N) => cosineSum(N, [0.5, 0.5]),
  hamming: (N) => cosineSum(N, [0.54, 0.46]),
  blackman: (N) => cosineSum(N, [0.42, 0.5, 0.08]),
  // The common five-term flat top (as in SciPy and MATLAB): wide main lobe,
  // but under 0.02 dB scalloping, so off-bin tones read their amplitude.
  flattop: (N) => cosineSum(N, [0.21557895, 0.41663158, 0.277263158, 0.083578947, 0.006947368]),
};

// Mean of the window: what a sine's FFT bin is scaled by, so amplitudes are
// corrected by 1 / (N · coherentGain(w)), doubled for the single side.
export function coherentGain(w) {
  let s = 0;
  for (let k = 0; k < w.length; k++) s += w[k];
  return w.length ? s / w.length : 0;
}

// The last few windows built, because turning a knob recomputes the same one.
const WINDOW_CACHE = new Map();
function windowOf(name, N) {
  if (!WINDOWS[name]) throw new Error(`window "${name}": expected one of ${Object.keys(WINDOWS).join(', ')}`);
  const key = `${name}:${N}`;
  let w = WINDOW_CACHE.get(key);
  if (!w) {
    if (WINDOW_CACHE.size >= 16) WINDOW_CACHE.clear();
    w = WINDOWS[name](N);
    WINDOW_CACHE.set(key, w);
  }
  return w;
}

// Removes, in place, the mean ('mean') or the least-squares line ('linear')
// from seg[0..n), so the DC bin and its leakage do not swamp low frequencies.
function detrendInPlace(seg, n, mode) {
  if (mode === 'none' || n === 0) return;
  let mean = 0;
  for (let k = 0; k < n; k++) mean += seg[k];
  mean /= n;
  if (mode === 'mean') {
    for (let k = 0; k < n; k++) seg[k] -= mean;
    return;
  }
  if (mode !== 'linear') throw new Error(`detrend "${mode}": expected none, mean or linear`);
  const kMid = (n - 1) / 2;
  let sxy = 0, sxx = 0;
  for (let k = 0; k < n; k++) { sxy += (k - kMid) * (seg[k] - mean); sxx += (k - kMid) * (k - kMid); }
  const slope = sxx > 0 ? sxy / sxx : 0;
  for (let k = 0; k < n; k++) seg[k] -= mean + slope * (k - kMid);
}

// Windowed FFT of re[0..n) (zero beyond n, length re.length), written as
// single-sided amplitudes into out[0 .. size/2].
function frameAmplitudes(re, im, n, w, out) {
  const size = re.length;
  let sw = 0;
  for (let k = 0; k < n; k++) { re[k] *= w[k]; sw += w[k]; }
  re.fill(0, n);
  im.fill(0);
  fft(re, im);
  const half = size >> 1;
  const scale = sw > 0 ? 1 / sw : 0;
  for (let k = 0; k <= half; k++) {
    const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]) * scale;
    out[k] = k === 0 || k === half ? m : 2 * m;
  }
}

// Single-sided amplitude spectrum of x. With pad, the record is zero-padded to
// the next power of two (the window covers the samples only); without, the
// FFT uses the most recent power-of-two samples and drops the earliest.
export function amplitudeSpectrum(x, dt, { window = 'hann', detrend = 'mean', pad = true } = {}) {
  checkDt(dt);
  const len = x.length;
  const n = pad ? len : prevPow2(len);
  const size = n === 0 ? 0 : pad ? nextPow2(n) : n;
  const bins = size ? (size >> 1) + 1 : 0;
  const df = size ? 1 / (size * dt) : 1 / dt;
  const f = new Float64Array(bins), amp = new Float64Array(bins);
  for (let k = 0; k < bins; k++) f[k] = k * df;
  if (!size) return { f, amp, df, fNyquist: 0.5 / dt };
  const re = new Float64Array(size), im = new Float64Array(size);
  const start = len - n;
  for (let k = 0; k < n; k++) re[k] = x[start + k];
  detrendInPlace(re, n, detrend);
  frameAmplitudes(re, im, n, windowOf(window, n), amp);
  return { f, amp, df, fNyquist: 0.5 / dt };
}

// Short-time amplitude spectra of x: frames of `size` samples (a power of
// two, shrunk for short signals, at least 16), stepped by size·(1 − overlap).
// amp[i * bins + k] is frame i at frequency f[k], amplitude-correct as above;
// t[i] is the frame's centre, in seconds from the first sample. Long records
// get a longer step so there are at most maxFrames frames. A signal shorter
// than 16 samples has no frames.
export function spectrogram(x, dt, { window = 'hann', size = 256, overlap = 0.75, detrend = 'mean', maxFrames = 2048 } = {}) {
  checkDt(dt);
  const n = x.length;
  let m = Math.max(16, prevPow2(size));
  while (m > 16 && m > n) m >>= 1;
  const bins = (m >> 1) + 1;
  const f = new Float64Array(bins);
  for (let k = 0; k < bins; k++) f[k] = k / (m * dt);
  if (n < m) return { t: new Float64Array(0), f, amp: new Float32Array(0), frames: 0, bins, size: m, hop: 0 };
  const ov = Math.min(Math.max(Number(overlap) || 0, 0), 0.99);
  let hop = Math.max(1, Math.round(m * (1 - ov)));
  let frames = Math.floor((n - m) / hop) + 1;
  const cap = Math.max(2, Math.floor(maxFrames));
  if (frames > cap) {
    hop = Math.ceil((n - m) / (cap - 1));
    frames = Math.floor((n - m) / hop) + 1;
  }
  const w = windowOf(window, m);
  const re = new Float64Array(m), im = new Float64Array(m);
  const t = new Float64Array(frames);
  const amp = new Float32Array(frames * bins);
  for (let i = 0; i < frames; i++) {
    const s = i * hop;
    for (let k = 0; k < m; k++) re[k] = x[s + k];
    detrendInPlace(re, m, detrend);
    frameAmplitudes(re, im, m, w, amp.subarray(i * bins, (i + 1) * bins));
    t[i] = (s + (m - 1) / 2) * dt;
  }
  return { t, f, amp, frames, bins, size: m, hop };
}

// ---- Display filters: second-order sections from the RBJ audio-EQ cookbook.
// Those are the bilinear transform of the analog prototypes, prewarped so the
// digital filter has its analog gain exactly at f0. A section is
//   H(z) = (b0 + b1 z⁻¹ + b2 z⁻²) / (1 + a1 z⁻¹ + a2 z⁻²).

const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch'];
const fmt = (v) => String(Number(v.toPrecision(4)));

function biquad(type, w0, q) {
  const c = Math.cos(w0), alpha = Math.sin(w0) / (2 * q);
  // 1 ∓ cos w0 as 2 sin² / 2 cos² of w0/2, exact for very low f0.
  const omc = 2 * Math.sin(w0 / 2) ** 2, opc = 2 * Math.cos(w0 / 2) ** 2;
  const num = {
    lowpass: [omc / 2, omc, omc / 2],
    highpass: [opc / 2, -opc, opc / 2],
    bandpass: [alpha, 0, -alpha],
    notch: [1, -2 * c, 1],
  }[type];
  const a0 = 1 + alpha;
  return { b0: num[0] / a0, b1: num[1] / a0, b2: num[2] / a0, a1: (-2 * c) / a0, a2: (1 - alpha) / a0 };
}

// type 'lowpass' | 'highpass': Butterworth of order 2, 4, 6 or 8, as order/2
// sections with Q_k = 1 / (2 cos((2k − 1)π / (2·order))); q is not used.
// type 'bandpass' (0 dB at f0, bandwidth f0/q) | 'notch': one section with q.
// f0 is clamped into (0, 0.49/dt), at least 1e-5/dt, and describe says so.
export function designFilter({ type = 'lowpass', f0, q = Math.SQRT1_2, order = 2, dt } = {}) {
  if (!FILTER_TYPES.includes(type)) throw new Error(`filter type "${type}": expected one of ${FILTER_TYPES.join(', ')}`);
  checkDt(dt);
  const asked = Number(f0);
  if (!Number.isFinite(asked)) throw new Error(`filter f0: expected a number, got ${f0}`);
  const fMin = 1e-5 / dt, fMax = 0.49 / dt;
  const fc = Math.min(Math.max(asked, fMin), fMax);
  const clamped = fc !== asked;
  const w0 = 2 * Math.PI * fc * dt;
  const notes = [];
  if (clamped) notes.push(`f0 ${fmt(asked)} Hz clamped to ${fmt(fc)} Hz (${asked > fc ? 'limit 0.49/dt' : 'limit 1e-5/dt'})`);
  let sections, describe, ord = 2, Q = Number(q);
  if (type === 'lowpass' || type === 'highpass') {
    const want = Number(order);
    ord = Number.isFinite(want) ? Math.min(8, Math.max(2, 2 * Math.round(want / 2))) : 2;
    if (ord !== want) notes.push(`order ${order} taken as ${ord}`);
    sections = [];
    for (let k = 1; k <= ord / 2; k++) sections.push(biquad(type, w0, 1 / (2 * Math.cos(((2 * k - 1) * Math.PI) / (2 * ord)))));
    describe = `Butterworth ${type} ${fmt(fc)} Hz, order ${ord}`;
  } else {
    if (!(Q > 0)) throw new Error(`filter q: expected a number > 0, got ${q}`);
    sections = [biquad(type, w0, Q)];
    describe = `${type} ${fmt(fc)} Hz, Q ${fmt(Q)}`;
  }
  if (notes.length) describe += `; ${notes.join('; ')}`;
  return { type, f0: fc, q: Q, order: ord, dt, sections, describe, clamped };
}

// Direct form II transposed, in place, starting in the steady state of a
// constant input equal to y[0], so a signal with an offset has no start
// transient.
function runSection({ b0, b1, b2, a1, a2 }, y) {
  const x0 = y[0];
  const den = 1 + a1 + a2;
  const ys = den !== 0 ? ((b0 + b1 + b2) / den) * x0 : 0;
  let z1 = (b1 + b2) * x0 - (a1 + a2) * ys;
  let z2 = b2 * x0 - a2 * ys;
  for (let k = 0; k < y.length; k++) {
    const xk = y[k];
    const yk = b0 * xk + z1;
    z1 = b1 * xk - a1 * yk + z2;
    z2 = b2 * xk - a2 * yk;
    y[k] = yk;
  }
}

// Samples for the slowest pole of the cascade to decay to 0.1 %.
function settleSamples(filter) {
  let r = 0;
  for (const { a1, a2 } of filter.sections) {
    const d = a1 * a1 - 4 * a2;
    const rs = d < 0 ? Math.sqrt(a2) : Math.max(Math.abs(-a1 + Math.sqrt(d)), Math.abs(-a1 - Math.sqrt(d))) / 2;
    r = Math.max(r, rs);
  }
  return r > 0 && r < 1 ? Math.ceil(Math.log(1e-3) / Math.log(r)) : Infinity;
}

// Filters x into a new Float64Array. zeroPhase runs the cascade forward and
// then backward (no lag, squared magnitude: −6 dB at a Butterworth f0), on the
// record extended at both ends by its point reflection, so a slope at an end
// does not leave an edge transient.
export function applyFilter(filter, x, { zeroPhase = false } = {}) {
  const n = x.length;
  if (!zeroPhase || n < 2) {
    const y = Float64Array.from(x);
    if (n) for (const s of filter.sections) runSection(s, y);
    if (n && zeroPhase) for (const s of filter.sections) runSection(s, y);
    return y;
  }
  const pad = Math.min(n - 1, settleSamples(filter));
  const y = new Float64Array(n + 2 * pad);
  for (let k = 0; k < n; k++) y[pad + k] = x[k];
  for (let k = 1; k <= pad; k++) {
    y[pad - k] = 2 * x[0] - x[k];
    y[pad + n - 1 + k] = 2 * x[n - 1] - x[n - 1 - k];
  }
  for (const s of filter.sections) runSection(s, y);
  y.reverse();
  for (const s of filter.sections) runSection(s, y);
  y.reverse();
  return y.slice(pad, pad + n);
}

// Frequency response at the frequencies f (Hz): magnitude (linear) and phase
// in degrees, summed over the sections so it does not wrap at ±180°.
export function filterResponse(filter, f, dt = filter.dt) {
  checkDt(dt);
  const n = f.length;
  const mag = new Float64Array(n), phaseDeg = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = 2 * Math.PI * f[i] * dt;
    const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    let m = 1, ph = 0;
    for (const { b0, b1, b2, a1, a2 } of filter.sections) {
      const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2);
      const dr = 1 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
      m *= Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
      ph += Math.atan2(ni * dr - nr * di, nr * dr + ni * di);
    }
    mag[i] = m;
    phaseDeg[i] = (ph * 180) / Math.PI;
  }
  return { mag, phaseDeg };
}

// Peaks are refined by a parabola through the bin and its two neighbours,
// raised to a power that makes the window's main lobe close to a parabola
// (Werner & Germain 2010; 0.23 for hann). Hann, hamming and blackman peaks
// then read amplitude within 0.2 % and frequency within 0.01 bin, padded or
// not. A parabola would overshoot the flat top, and a rect main lobe is not
// one: those two keep the bin's amplitude (flattop is right already; rect
// reads low by up to 36 %) and get a plain parabola for frequency, within
// about a quarter bin.
const PEAK_EXPONENT = { hann: 0.23, hamming: 0.19, blackman: 0.13 };

// The largest local maxima of a spectrum made with `window`, largest first,
// DC excluded, each at least minRel of the largest non-DC bin.
export function peaks(f, amp, { count = 8, minRel = 0.01, window = 'hann' } = {}) {
  if (!WINDOWS[window]) throw new Error(`window "${window}": expected one of ${Object.keys(WINDOWS).join(', ')}`);
  const e = PEAK_EXPONENT[window];
  const n = amp.length;
  let max = 0;
  for (let k = 1; k < n; k++) if (amp[k] > max) max = amp[k];
  if (!(max > 0)) return [];
  const floor = max * minRel;
  const found = [];
  for (let k = 1; k < n - 1; k++) {
    const a = amp[k];
    if (a > amp[k - 1] && a >= amp[k + 1] && a >= floor) found.push(k);
  }
  found.sort((i, j) => amp[j] - amp[i]);
  return found.slice(0, count).map((k) => {
    // Neighbours relative to the peak bin, so both are <= 1 and |p| <= 0.5.
    const b = amp[k];
    const A = (amp[k - 1] / b) ** (e ?? 1), C = (amp[k + 1] / b) ** (e ?? 1);
    const d = A - 2 + C;
    const p = d < 0 ? (0.5 * (A - C)) / d : 0;
    const gain = e ? Math.max(1 - 0.25 * (A - C) * p, 0) ** (1 / e) : 1;
    return { f: f[k] + (p * (f[k + 1] - f[k - 1])) / 2, amp: b * gain };
  });
}

// 20·log10(|amp|), floored at floorDb: for the heat map and log display.
export function dbScale(amp, floorDb = -100) {
  const out = new Float32Array(amp.length);
  const floor = Math.pow(10, floorDb / 20);
  for (let k = 0; k < amp.length; k++) {
    const a = Math.abs(amp[k]);
    out[k] = a > floor ? 20 * Math.log10(a) : floorDb;
  }
  return out;
}

// ---- Levels of the spectrogram's heat map, after pyqtgraph's
// HistogramLUTItem: a histogram of the amplitudes shown, in dB, and two
// levels. Below the floor a bin is black, above the ceiling it has the
// brightest colour, in between the colour follows the dB value linearly.
// Levels are dB of the amplitude in the channel's unit (0 dB = 1 unit), as
// the FFT's axis.

// What an amplitude of zero reads (20·log10(1e-12)).
export const DB_FLOOR = -240;

// The frames whose centre lies in [t0, t1] (± half a hop, as each is drawn
// that wide); t0 and t1 are seconds from the first sample.
function framesIn(sg, t0, t1) {
  const hop = sg.t.length > 1 ? sg.t[1] - sg.t[0] : 0, frames = [];
  for (let i = 0; i < sg.frames; i++) if (sg.t[i] + hop / 2 >= t0 && sg.t[i] - hop / 2 <= t1) frames.push(i);
  return frames;
}

// The values of the bins the screen shows, in a new Float32Array: frames
// whose centre lies in [t0, t1] (± half a hop, as each is drawn that wide),
// frequency rows whose cell overlaps [f0, f1]. values is laid out like
// sg.amp (frame-major); t0 and t1 are seconds from the first sample.
export function spectrogramWindow(sg, values, { t0 = -Infinity, t1 = Infinity, f0 = 0, f1 = Infinity } = {}) {
  if (!sg.frames) return new Float32Array(0);
  const df = sg.f.length > 1 ? sg.f[1] - sg.f[0] : 1;
  const b0 = Math.max(0, Math.ceil(f0 / df - 0.5)), b1 = Math.min(sg.bins - 1, Math.floor(f1 / df + 0.5));
  const frames = framesIn(sg, t0, t1);
  if (b1 < b0 || !frames.length) return new Float32Array(0);
  const out = new Float32Array(frames.length * (b1 - b0 + 1));
  let q = 0;
  for (const i of frames) for (let b = b0; b <= b1; b++) out[q++] = values[i * sg.bins + b];
  return out;
}

// Counts of values in `bins` equal bins over [lo, hi] (the last bin closed);
// values outside go to below and above, NaN is left out.
export function levelHistogram(values, lo, hi, bins) {
  const n = Math.max(1, Math.floor(bins)), width = (hi - lo) / n;
  if (!(width > 0)) throw new Error(`levelHistogram: need lo < hi, got ${lo}, ${hi}`);
  const counts = new Uint32Array(n);
  let below = 0, above = 0, total = 0;
  for (let k = 0; k < values.length; k++) {
    const v = values[k];
    if (Number.isNaN(v)) continue;
    total++;
    if (v < lo) below++;
    else if (v > hi) above++;
    else counts[Math.min(n - 1, Math.floor((v - lo) / width))]++;
  }
  return { lo, hi, width, counts, below, above, total };
}

// The q-quantile (0..1) of an ascending array, interpolated between ranks.
export function quantileSorted(sorted, q) {
  const n = sorted.length;
  if (!n) return NaN;
  const r = Math.min(1, Math.max(0, q)) * (n - 1), i = Math.floor(r), f = r - i;
  return i + 1 < n ? sorted[i] + f * (sorted[i + 1] - sorted[i]) : sorted[i];
}

// Bins at DB_FLOOR or below are exact zeros (a noise-free signal has many,
// and a sweep's first samples): they say nothing about the noise, so the
// automatic levels and the strip's range leave them out. The index of the
// first value above `zero` in an ascending array.
function firstAbove(sorted, zero) {
  let a = 0, b = sorted.length;
  while (a < b) { const m = (a + b) >> 1; if (sorted[m] <= zero) a = m + 1; else b = m; }
  return a;
}

// Automatic levels. Most bins of a spectrogram are noise, so their median is
// the noise's level: the floor sits `margin` dB above it, the ceiling at the
// largest value. The floor stays within `depth` dB of the ceiling (the fixed
// range the scope had before) and at least `span` dB below it, so a picture of
// noise alone shows its noise rather than a few specks. `rule` says which of
// the three set the floor ('median', 'depth', 'span'); exact zeros (`zeros`
// of them) are left out. Null when there is nothing but zeros.
// With `noise`, the floor counts from that level instead of the median, and
// the rule says 'noise': for values already in dB above the noise (see
// aboveNoise), where the noise is 0 dB by construction.
// For white noise a bin's amplitude is Rayleigh distributed: its 95th
// percentile lies 6.3 dB above its median, its 99th 8.2 dB, its 99.9th 10 dB.
// Above the noise the margin is 6 dB (noiseMargin): the point of that view is
// to find weak lines, and the 5 % of noise bins it lets through get the
// darkest colours whenever a line stands well above them.
export const AUTO_LEVELS = { margin: 10, depth: 80, span: 20, noiseMargin: 6 };
export function autoLevels(values, { margin = AUTO_LEVELS.margin, depth = AUTO_LEVELS.depth, span = AUTO_LEVELS.span, zero = DB_FLOOR, noise = null } = {}) {
  const sorted = Float32Array.from(values).filter((v) => !Number.isNaN(v)).sort();
  const zeros = firstAbove(sorted, zero), real = sorted.subarray(zeros);
  if (!real.length) return null;
  const ceiling = real[real.length - 1], median = quantileSorted(real, 0.5);
  const from = Number.isFinite(noise) ? noise : median, raw = from + margin;
  const rule = raw > ceiling - span ? 'span' : raw < ceiling - depth ? 'depth' : Number.isFinite(noise) ? 'noise' : 'median';
  const floor = rule === 'span' ? ceiling - span : rule === 'depth' ? ceiling - depth : raw;
  return { floor, ceiling, median, rule, zeros, sorted };
}

// ---- Colour as dB above the local noise (the person, 2026-10-24: "the
// delta mode, I like that. Like dB above the local noise … Make that a
// switch"). The noise of a spectrogram is seldom white: in a motor's speed it
// falls 60 dB from the lowest frequencies to the highest, so one floor either
// lets the low noise through or hides a weak line high up. Measured against
// the noise at its own frequency, every line shows by how far it stands out.

// The noise level of each frequency row, in dB (Float32Array of sg.bins):
//  1. each row's median over the frames whose centre lies in [t0, t1] (exact
//     zeros left out): a line that sweeps through the row, or a transient,
//     covers fewer than half of its frames and does not count;
//  2. a running median of those over ±reach rows, as a first guess: a line
//     that stays at one frequency is a few rows wide (a Hann main lobe: 3 or
//     4) and does not count either;
//  3. rows that stand more than `line` dB above the first guess are such
//     lines: they are bridged by a straight line (in dB) between the nearest
//     rows that are not. Where the noise falls steeply (by the lowest
//     frequencies), a line would otherwise lift the median of its window;
//  4. a running median over ±reach rows again, then averaged over three
//     rows, so the estimate has no steps (both centred on the row, narrower
//     towards the ends, so a slope there is not bent).
// The DC and Nyquist rows keep their own medians (step 1 only). Every row
// takes part, whatever the frequency zoom, so zooming does not change the
// noise. A row with nothing but zeros takes its nearest row's level; null
// when every row has nothing but zeros (or no frame is in the window).
export const NOISE_EST = { reach: 4, line: 6 };
export function noiseLevel(sg, values, { t0 = -Infinity, t1 = Infinity, reach = NOISE_EST.reach, line = NOISE_EST.line, zero = DB_FLOOR } = {}) {
  if (!sg.frames) return null;
  const frames = framesIn(sg, t0, t1), bins = sg.bins;
  if (!frames.length) return null;
  const row = new Float32Array(bins).fill(NaN), col = new Float32Array(frames.length);
  for (let b = 0; b < bins; b++) {
    let m = 0;
    for (const i of frames) { const v = values[i * bins + b]; if (v > zero) col[m++] = v; }
    if (m) row[b] = quantileSorted(col.subarray(0, m).sort(), 0.5);
  }
  // Rows of zeros: the nearest row with a value (the lower one on a tie).
  const has = [];
  for (let b = 0; b < bins; b++) if (!Number.isNaN(row[b])) has.push(b);
  if (!has.length) return null;
  for (let b = 0, j = 0; b < bins; b++) {
    if (!Number.isNaN(row[b])) continue;
    while (j + 1 < has.length && Math.abs(has[j + 1] - b) < Math.abs(has[j] - b)) j++;
    row[b] = row[has[j]];
  }
  // The DC and Nyquist rows are not like the others (one-sided, and real):
  // they keep their own median and take no part in their neighbours'.
  const out = Float32Array.from(row);
  if (bins > 2) out.set(acrossRows(row.subarray(1, bins - 1), reach, line), 1);
  return out;
}
// Steps 2 to 4 of noiseLevel on the rows' medians.
function acrossRows(row, reach, line) {
  const n = row.length, guess = runningMedian(row, reach), bridged = Float32Array.from(row);
  const isLine = (b) => row[b] > guess[b] + line;
  for (let b = 0; b < n; b++) {
    if (!isLine(b)) continue;
    let a = b - 1, z = b + 1;
    while (a >= 0 && isLine(a)) a--;
    while (z < n && isLine(z)) z++;
    bridged[b] = a < 0 && z >= n ? guess[b] : a < 0 ? row[z] : z >= n ? row[a] : row[a] + ((row[z] - row[a]) * (b - a)) / (z - a);
  }
  // Centred windows here (narrower towards the ends), so a slope is not bent there.
  const med = runningMedian(bridged, reach, true), out = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    const r = Math.min(1, b, n - 1 - b);
    let s = 0;
    for (let k = b - r; k <= b + r; k++) s += med[k];
    out[b] = s / (2 * r + 1);
  }
  return out;
}
// The median of x over ±reach around each element: towards the ends the
// window is cut off (more robust), or with centred kept centred on it (no
// bias on a slope).
function runningMedian(x, reach, centred = false) {
  const n = x.length, out = new Float32Array(n), win = new Float32Array(2 * reach + 1);
  for (let b = 0; b < n; b++) {
    const r = centred ? Math.min(reach, b, n - 1 - b) : reach;
    const a = Math.max(0, b - r), z = Math.min(n - 1, b + r), w = win.subarray(0, z - a + 1);
    w.set(x.subarray(a, z + 1));
    out[b] = quantileSorted(w.sort(), 0.5);
  }
  return out;
}

// Values (dB, laid out like sg.amp) as dB above the noise of their row: a new
// Float32Array of v − noise[row]. Exact zeros stay at `zero`, so they are
// still left out of the levels and the strip's range.
export function aboveNoise(values, noise, bins, zero = DB_FLOOR) {
  const out = new Float32Array(values.length);
  for (let k = 0; k < values.length; k++) {
    const v = values[k];
    out[k] = v > zero ? v - noise[k % bins] : zero;
  }
  return out;
}

// The dB range of the levels strip: the shown values (exact zeros left out)
// from their 1st percentile to their largest, with room around, in whole
// 10 dB, at most 200 dB deep; the levels always inside.
export function levelRange(sorted, levels, zero = DB_FLOOR) {
  let lo = -100, hi = 0;
  const real = sorted.subarray ? sorted.subarray(firstAbove(sorted, zero)) : sorted.slice(firstAbove(sorted, zero));
  if (real.length) {
    hi = 10 * Math.ceil((real[real.length - 1] + 5) / 10) + 0;   // + 0: never −0
    lo = Math.max(hi - 200, 10 * Math.floor((quantileSorted(real, 0.01) - 5) / 10));
  }
  if (levels) { lo = Math.min(lo, 10 * Math.floor(levels[0] / 10)); hi = Math.max(hi, 10 * Math.ceil(levels[1] / 10)); }
  if (hi - lo < 20) lo = hi - 20;
  return [lo, hi];
}
