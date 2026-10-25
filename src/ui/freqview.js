// The scope's frequency views and display filters (the person, 2026-10-24:
// "we should be able to set the main oscilloscope to FFT mode and to
// spectrogram mode … filter all the signals … see the filter apply in real
// time … the time value of the channel overlaid, a second y-axis").
//
//   FFT          amplitude spectrum of every channel (what has run so far),
//                10 dB per division, or linear in each channel's units
//   Spectrogram  one channel's short-time spectrum over the screen's time,
//                frequency up the left axis, its time trace on the right axis,
//                and at the right edge a levels strip (after pyqtgraph's
//                HistogramLUTItem): the colour bar beside a histogram of the
//                amplitudes shown, with a floor and a ceiling to drag, and a
//                switch: colour as dB of the unit (Absolute) or as dB above
//                the noise at each frequency (Above noise)
//
// A channel's display filter changes what the scope shows and analyses, in
// every mode; the system is not changed. See design/output/instrument.md.

import { amplitudeSpectrum, spectrogram, designFilter, applyFilter, filterResponse, peaks, dbScale, DB_FLOOR, AUTO_LEVELS, spectrogramWindow, levelHistogram, autoLevels, levelRange, spectrogramNoise, aboveNoise } from '../core/spectrum.js';
import { levelsOf } from '../core/project.js';
import { siUnit, num } from './units.js';
import { palette as C, HEAT_STOPS as STOPS } from './palette.js';

const DIVX = 10, DIVY = 8, DB_PER_DIV = 10;

// Filtered signals, cached per run and filter, so turning a knob only
// filters again what changed.
const filteredCache = new WeakMap();
export function channelSignal(d, ch) {
  const v = d?.signals[ch.source];
  if (!v || !ch.filter) return v;
  let per = filteredCache.get(d);
  if (!per) { per = new Map(); filteredCache.set(d, per); }
  const key = `${ch.source}|${ch.filter.type}|${ch.filter.f0}|${ch.filter.order}|${ch.filter.q}`;
  if (!per.has(key)) {
    if (per.size > 32) per.clear();
    per.set(key, applyFilter(designFilter({ ...ch.filter, dt: dtOf(d) }), v));
  }
  return per.get(key);
}
export const dtOf = (d) => (d.t.length > 1 ? d.t[1] - d.t[0] : 1);
export const nyquist = (d) => 0.5 / dtOf(d);
export function freqRange(scope, d) {
  const fn = nyquist(d), v = scope.view ?? {};
  const f1 = Math.min(fn, v.fmax ?? fn), f0 = Math.max(0, Math.min(f1 * 0.999, v.fmin ?? 0));
  return [f0, f1];
}

// Spectra and spectrograms are recomputed at most ~100 times per sweep.
const specCache = new WeakMap();
function cached(d, key, make) {
  let per = specCache.get(d);
  if (!per) { per = new Map(); specCache.set(d, per); }
  if (!per.has(key)) { if (per.size > 64) per.clear(); per.set(key, make()); }
  return per.get(key);
}
const bucket = (k, n) => Math.min(n, Math.ceil(k / Math.max(1, Math.floor(n / 100))) * Math.max(1, Math.floor(n / 100)));
function spectrumOf(d, ch, k) {
  const n = d.t.length - 1, kk = bucket(k, n);
  const key = `fft|${ch.source}|${JSON.stringify(ch.filter ?? null)}|${kk}`;
  return cached(d, key, () => { const v = channelSignal(d, ch); return kk >= 32 ? amplitudeSpectrum(v.subarray(0, kk + 1), dtOf(d)) : null; });
}

// A dark-to-bright heat map (palette.js: after matplotlib's inferno).
function heat(x) {
  const s = Math.max(0, Math.min(1, x)) * (STOPS.length - 1), i = Math.min(STOPS.length - 2, Math.floor(s)), f = s - i;
  return STOPS[i].map((c, j) => Math.round(c + f * (STOPS[i + 1][j] - c)));
}
// The same as a table of 256 colours: index 0 is the floor (black), 255 the ceiling.
const LUT = new Uint8ClampedArray(256 * 3);
for (let k = 0; k < 256; k++) LUT.set(heat(k / 255), 3 * k);
const lutIndex = (db, floor, span) => { const x = (db - floor) / span; return x <= 0 ? 0 : x >= 1 ? 255 : Math.round(x * 255); };

// Draws the FFT or spectrogram view into the plot. v carries the display's
// geometry and state: { g, P, S, W, H, data, past, live, scope, k, axis,
// line, hover, sweeping, tScan, tx, xt, vy, colors, drawGrid, unitLabel,
// levelScale }. The spectrogram returns its levels strip (null without one),
// so the display can hit-test and drag it: { channel, source, floor, ceiling,
// auto, rule, lo, hi, sorted, unit, median, aboveNoise (the levels are dB
// above the noise), switchBox (the switch above the strip: l, r, t, b) }.
export function drawFrequency(v) {
  const mode = v.scope.view?.mode;
  if (mode === 'fft') { drawFft(v); return null; }
  return drawSpectrogram(v);
}

function axisText(g, P, labels, side, color) {
  g.font = `10.5px ${C().mono}`;
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.textAlign = side === 'left' ? 'right' : 'left';
  labels.forEach(([y, s]) => g.fillText(s, side === 'left' ? P.l - 6 : P.r + 6, Math.min(P.b - 5, Math.max(P.t + 5, y))));
}
function freqLabels(g, P, f0, f1) {
  g.font = `10.5px ${C().mono}`;
  g.fillStyle = C().label;
  g.textBaseline = 'top';
  for (let i = 0; i <= DIVX; i++) {
    const x = P.l + i * P.dx;
    g.textAlign = i === 0 ? 'left' : i === DIVX ? 'right' : 'center';
    g.fillText(siUnit(Number((f0 + ((f1 - f0) * i) / DIVX).toPrecision(4)), 'Hz', 3), x, P.b + 5);
  }
}

function drawFft(v) {
  const { g, P, data, scope, k, axis, line, colors, hover } = v;
  v.drawGrid(g);
  // A Live sweep just begun has no sampling rate yet: the last one's axis.
  const fd = data.t.length > 1 ? data : v.past?.find((d) => d.t.length > 1) ?? data;
  const [f0, f1] = freqRange(scope, fd);
  const fx = (f) => P.l + ((f - f0) / (f1 - f0)) * P.w;
  const db = scope.view?.db !== false;
  const shown = [0, 1, 2, 3].filter((i) => scope.channels[i].on && channelSignal(data, scope.channels[i]));
  // The reference level: the largest amplitude of the whole run, rounded up
  // to 10 dB, so the top line does not move while the sweep fills in.
  const n = data.t.length - 1;
  let top = -Infinity;
  for (const i of shown) { const s = spectrumOf(data, scope.channels[i], n); if (s) for (let j = 1; j < s.amp.length; j++) top = Math.max(top, s.amp[j]); }
  const refDb = Number.isFinite(top) && top > 0 ? Math.ceil((20 * Math.log10(top)) / DB_PER_DIV) * DB_PER_DIV : 0;
  const yOf = (i, a) => (db ? P.t + ((refDb - 20 * Math.log10(Math.max(a, 1e-12))) / DB_PER_DIV) * P.dy : P.b - (a / scope.channels[i].scale) * P.dy);
  freqLabels(g, P, f0, f1);
  const ai = shown.includes(axis) ? axis : shown[0];
  if (db) axisText(g, P, Array.from({ length: DIVY + 1 }, (_, j) => [P.t + j * P.dy, `${refDb - j * DB_PER_DIV}${j ? '' : ' dB'}`]), 'left', C().label);
  else if (ai !== undefined) axisText(g, P, Array.from({ length: DIVY + 1 }, (_, j) => [P.t + j * P.dy, num((DIVY - j) * scope.channels[ai].scale, 3)]), 'left', colors[ai]);

  g.save();
  g.beginPath(); g.rect(P.l, P.t, P.w, P.h); g.clip();
  const fn = nyquist(fd);
  if (fn >= f0 && fn <= f1) {
    const x = Math.round(fx(fn)) + 0.5;
    g.strokeStyle = C().scan; g.setLineDash([3, 4]);
    g.beginPath(); g.moveTo(x, P.t); g.lineTo(x, P.b); g.stroke(); g.setLineDash([]);
    g.font = `10px ${C().mono}`; g.fillStyle = C().label; g.textAlign = 'right'; g.textBaseline = 'top';
    g.fillText('Nyquist', x - 4, P.t + 4);
  }
  const order = shown.slice().sort((a, b) => (a === line) - (b === line));
  for (const i of order) {
    const s = spectrumOf(data, scope.channels[i], k);
    if (!s) continue;
    g.strokeStyle = colors[i];
    g.lineWidth = i === line ? 2.4 : 1.4;
    g.globalAlpha = line !== null && i !== line ? C().alpha.unselected : 1;
    g.beginPath();
    let col = null, mn = 0, mx = 0, started = false;
    for (let j = 0; j < s.f.length; j++) {
      if (s.f[j] < f0 || s.f[j] > f1) continue;
      const x = Math.round(fx(s.f[j])), y = yOf(i, s.amp[j]);
      if (!started) { g.moveTo(x, y); started = true; col = x; mn = mx = y; continue; }
      if (x === col) { mn = Math.min(mn, y); mx = Math.max(mx, y); continue; }
      if (mn !== mx) { g.lineTo(col, mn); g.lineTo(col, mx); }
      g.lineTo(x, y); col = x; mn = mx = y;
    }
    g.stroke();
  }
  g.globalAlpha = 1;
  // The selected channel's filter as a dashed response curve (0 dB at the top line).
  const fc = scope.channels[ai]?.filter;
  if (db && fc) {
    const fl = designFilter({ ...fc, dt: dtOf(data) });
    const fs = Array.from({ length: 200 }, (_, j) => f0 + ((f1 - f0) * j) / 199);
    const { mag } = filterResponse(fl, fs, dtOf(data));
    g.strokeStyle = colors[ai]; g.setLineDash([5, 4]); g.lineWidth = 1.2; g.globalAlpha = C().alpha.over;
    g.beginPath();
    fs.forEach((f, j) => { const y = P.t + (-20 * Math.log10(Math.max(mag[j], 1e-9)) / DB_PER_DIV) * P.dy; if (j) g.lineTo(fx(f), y); else g.moveTo(fx(f), y); });
    g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
  }
  // Peaks of the selected channel, labelled.
  const sp = ai !== undefined && spectrumOf(data, scope.channels[ai], k);
  if (sp) {
    g.font = `10.5px ${C().mono}`; g.textAlign = 'center'; g.textBaseline = 'bottom';
    for (const pk of peaks(sp.f, sp.amp, { count: 6, minRel: 0.02 })) {
      if (pk.f < f0 || pk.f > f1 || pk.f < 3 * sp.df) continue;
      const x = fx(pk.f), y = Math.max(P.t + 26, yOf(ai, pk.amp) - 4);
      g.fillStyle = C().veil;
      const s = siUnit(Number(pk.f.toPrecision(3)), 'Hz', 3), w = g.measureText(s).width;
      g.fillRect(x - w / 2 - 3, y - 13, w + 6, 13);
      g.fillStyle = colors[ai]; g.fillText(s, x, y);
    }
  }
  if (hover && hover.x >= P.l && hover.x <= P.r && hover.y >= P.t && hover.y <= P.b) {
    const f = f0 + ((hover.x - P.l) / P.w) * (f1 - f0);
    const x = Math.round(hover.x) + 0.5;
    g.strokeStyle = C().cursor; g.setLineDash([2, 3]);
    g.beginPath(); g.moveTo(x, P.t); g.lineTo(x, P.b); g.stroke(); g.setLineDash([]);
    const rows = [[`f  ${siUnit(f, 'Hz', 4)}`, C().ink]];
    for (const i of shown) {
      const s = spectrumOf(data, scope.channels[i], k);
      if (!s) continue;
      const j = Math.max(0, Math.min(s.f.length - 1, Math.round(f / s.df)));
      rows.push([`${i + 1} ${scope.channels[i].source.padEnd(2)} ${num(s.amp[j])} ${v.unitLabel(scope.channels[i].source)}${db ? `  ${(20 * Math.log10(Math.max(s.amp[j], 1e-12))).toFixed(1)} dB` : ''}`, colors[i]]);
    }
    readout(g, P, hover.x, rows);
  }
  g.restore();
}

// The spectrogram of a channel and its amplitudes in dB, kept per run.
const SG_OPTS = { overlap: 0.875, detrend: 'linear' };   // linear: a ramp would flood the lowest bins
function spectrogramOf(data, ch, size) {
  const key = `sg|${ch.source}|${JSON.stringify(ch.filter ?? null)}|${size}`;
  const s = cached(data, key, () => {
    const sg = spectrogram(channelSignal(data, ch), dtOf(data), { ...SG_OPTS, size });
    return sg.frames ? { sg, db: dbScale(sg.amp, DB_FLOOR) } : null;
  });
  return { key, s };
}
// The noise level of each frequency row (core/spectrum.js spectrogramNoise:
// the lower of the estimates on this spectrogram and on a low-leakage one
// with the same frames and rows), from the frames on the screen; every row
// counts, so zooming the frequency does not change it. Null when the signal
// has no noise (its bins mostly exact zeros).
function noiseOf(data, ch, key, s, size, win) {
  return cached(data, `${key}|noise|${win[0]}|${win[1]}`, () => spectrogramNoise(channelSignal(data, ch), dtOf(data), { ...SG_OPTS, size }, { t0: win[0], t1: win[1], shown: s }));
}
// A noise estimate made on one spectrogram's rows (from, in Live the last
// whole sweep's) on another's (sg), row by row at the nearest frequency: a
// sweep just begun is shorter than a frame, so its frames are shorter too.
function onRows(noise, from, sg) {
  if (sg.bins === noise.length) return noise;
  const out = new Float32Array(sg.bins), r = (sg.f[1] - sg.f[0]) / (from.f[1] - from.f[0]);
  for (let b = 0; b < sg.bins; b++) out[b] = noise[Math.min(noise.length - 1, Math.round(b * r))];
  return out;
}
// A spectrogram's values in dB above a noise estimate (in Live the estimate
// comes from the last whole sweep), kept until the estimate changes.
const relCache = new WeakMap();
function aboveNoiseOf(data, key, s, noise) {
  let per = relCache.get(data);
  if (!per) { per = new Map(); relCache.set(data, per); }
  const hit = per.get(key);
  if (hit?.noise === noise) return hit.values;
  if (per.size > 8) per.clear();
  const values = aboveNoise(s.db, noise, s.sg.bins);
  per.set(key, { noise, values });
  return values;
}
// The bins the screen shows (time and frequency window), sorted, and the
// automatic levels they give. The whole run counts, not only what the sweep
// has reached, so the levels do not move while it fills in (in Live, where
// the sweep is built from nothing, the last whole sweep counts: see
// drawSpectrogram). Above the noise (noise given), the values are dB above
// it and the automatic floor sits AUTO_LEVELS.noiseMargin above 0 dB.
function shownOf(data, key, s, win, noise) {
  return cached(data, `${key}|win|${win.join('|')}|${noise ? 'noise' : 'abs'}`, () => {
    const values = noise ? aboveNoiseOf(data, key, s, noise) : s.db;
    const auto = autoLevels(spectrogramWindow(s.sg, values, { t0: win[0], t1: win[1], f0: win[2], f1: win[3] }), noise ? { noise: 0, margin: AUTO_LEVELS.noiseMargin } : {});
    return { auto, sorted: auto?.sorted ?? new Float32Array(0), hist: null };
  });
}
// The heat map at one pair of levels; one image per spectrogram, redrawn
// when the levels or the values (absolute or above the noise) change: a drag
// recolours it, it does not recompute it.
const imageCache = new WeakMap();
function imageOf(data, key, sg, values, floor, ceiling) {
  let per = imageCache.get(data);
  if (!per) { per = new Map(); imageCache.set(data, per); }
  const hit = per.get(key);
  if (hit && hit.values === values && hit.floor === floor && hit.ceiling === ceiling) return hit.cv;
  const cv = hit?.cv ?? document.createElement('canvas');
  if (!hit) { if (per.size > 8) per.clear(); cv.width = sg.frames; cv.height = sg.bins; }
  const cx = cv.getContext('2d'), im = cx.createImageData(sg.frames, sg.bins), span = ceiling - floor;
  for (let fr = 0; fr < sg.frames; fr++) for (let b = 0; b < sg.bins; b++) {
    const c = 3 * lutIndex(values[fr * sg.bins + b], floor, span), o = ((sg.bins - 1 - b) * sg.frames + fr) * 4;
    im.data[o] = LUT[c]; im.data[o + 1] = LUT[c + 1]; im.data[o + 2] = LUT[c + 2]; im.data[o + 3] = 255;
  }
  cx.putImageData(im, 0, 0);
  per.set(key, { cv, values, floor, ceiling });
  return cv;
}

function drawSpectrogram(v) {
  const { g, P, scope, axis, colors, tx, vy, hover } = v;
  v.drawGrid(g);
  // In Live each sweep is built from nothing, so while one fills in, the
  // automatic levels, the histogram and the frame length come from the last
  // whole sweep (prev): the colours and the strip hold still from sweep to
  // sweep. A sweep just begun has no samples yet (data null).
  const prev = v.live && v.sweeping && v.past?.[0]?.t.length > 1 ? v.past[0] : null;
  const data = prev && v.data.t.length < 2 ? null : v.data, base = data ?? prev;
  const has = (d, c) => scope.channels[c]?.on && channelSignal(d, scope.channels[c]);
  const i = has(base, axis) ? axis : [0, 1, 2, 3].find((c) => has(base, c));
  if (i === undefined) return null;
  const ch = scope.channels[i], sig = data && channelSignal(data, ch), dt = dtOf(base);
  const [f0, f1] = freqRange(scope, base);
  const ref = prev && channelSignal(prev, ch) && Math.abs(dtOf(prev) - dt) <= 1e-3 * dt ? prev : data;
  const n = (ref ?? base).t.length - 1;
  const size = scope.view?.size ?? Math.max(64, Math.min(512, 2 ** Math.round(Math.log2(n / 16))));
  const { key, s } = sig ? spectrogramOf(data, ch, size) : { key: null, s: null };
  const r = ref === data ? { key, s } : spectrogramOf(ref, ch, size);
  // Spectrogram times count from a record's first sample, which in Live is
  // the window's left edge, not 0.
  const t0 = data?.t[0] ?? 0, tr = ref?.t[0] ?? 0;
  // Above the noise: each row's noise from the frames on the screen (in
  // Live, of the last whole sweep, so the colours hold still as the levels
  // do), and the values as dB above it.
  const win = [v.xt(P.l) - tr, v.xt(P.r) - tr, f0, f1];
  // Without noise on the screen (a noise-free signal, whose bins are mostly
  // exact zeros) there is nothing to count from: the colours stay absolute,
  // and the status line and the switch say so.
  const above = !!scope.view?.aboveNoise, noise = above && r.s ? noiseOf(ref, ch, r.key, r.s, size, win) : null;
  const nz = noise && s ? onRows(noise, r.s.sg, s.sg) : null;
  const values = s && (nz ? aboveNoiseOf(data, key, s, nz) : s.db);
  // The levels: those set for this signal in this unit (dB of one unit are
  // not dB of another, nor dB above the noise), or automatic from the bins
  // on the screen.
  const shown = r.s && shownOf(ref, r.key, r.s, win, noise);
  const fixed = levelsOf(scope.view, ch.source, !!noise);
  const levels = fixed ?? (shown?.auto ? [shown.auto.floor, shown.auto.ceiling] : null);
  freqLabelsTime(v);
  axisText(g, P, Array.from({ length: DIVY + 1 }, (_, j) => [P.t + j * P.dy, siUnit(Number((f1 - ((f1 - f0) * j) / DIVY).toPrecision(4)), 'Hz', 3)]), 'left', C().label);
  axisText(g, P, Array.from({ length: DIVY + 1 }, (_, j) => [P.t + j * P.dy, num((DIVY / 2 - j) * ch.scale - ch.offset, 3)]), 'right', colors[i]);
  g.save();
  g.beginPath(); g.rect(P.l, P.t, P.w, P.h); g.clip();
  const sg = s?.sg, hop = sg && sg.t.length > 1 ? sg.t[1] - sg.t[0] : dt;
  if (s && levels) {
    const cv = imageOf(data, key, sg, values, levels[0], levels[1]);
    // Each frame covers [centre − hop/2, centre + hop/2], each row
    // [f − df/2, f + df/2]: the rows that reach into [f0, f1] are drawn
    // where the frequency axis has them (the bins the levels strip counts).
    const df = sg.f[1] - sg.f[0], fy = (f) => P.b - ((f - f0) / (f1 - f0)) * P.h;
    const b0 = Math.max(0, Math.ceil(f0 / df - 0.5)), b1 = Math.min(sg.bins - 1, Math.floor(f1 / df + 0.5));
    const xa = tx(t0 + sg.t[0] - hop / 2), xb = tx(t0 + sg.t[sg.frames - 1] + hop / 2);
    const xEnd = v.sweeping ? Math.min(xb, tx(v.tScan)) : xb;
    if (b1 >= b0) {
      g.save();
      g.beginPath(); g.rect(P.l, P.t, Math.max(0, xEnd - P.l), P.h); g.clip();
      g.imageSmoothingEnabled = true;
      const ya = fy((b1 + 0.5) * df), yb = fy((b0 - 0.5) * df);
      g.drawImage(cv, 0, sg.bins - 1 - b1, sg.frames, b1 - b0 + 1, xa, ya, xb - xa, yb - ya);
      g.restore();
    }
  }
  // The channel's time trace over it, on the right axis.
  const k = sig ? v.k : -1;
  g.strokeStyle = colors[i]; g.lineWidth = 1.4; g.globalAlpha = C().alpha.over;
  g.beginPath();
  let started = false;
  for (let j = 0; j <= k; j++) {
    const x = tx(data.t[j]), y = vy(ch, sig[j]);
    if (!Number.isFinite(y)) break;
    if (x < P.l - 2 || x > P.r + 2) continue;
    if (started) g.lineTo(x, y); else { g.moveTo(x, y); started = true; }
  }
  g.stroke(); g.globalAlpha = 1;
  if (v.sweeping) {
    const x = Math.round(tx(v.tScan)) + 0.5;
    g.strokeStyle = C().scan; g.beginPath(); g.moveTo(x, P.t); g.lineTo(x, P.b); g.stroke();
  }
  const unit = v.unitLabel(ch.source);
  if (hover && hover.x >= P.l && hover.x <= P.r && hover.y >= P.t && hover.y <= P.b) {
    const t = v.xt(hover.x), f = f1 - ((hover.y - P.t) / P.h) * (f1 - f0);
    const rows = [[`t  ${siUnit(t, 's', 4)}`, C().ink], [`f  ${siUnit(f, 'Hz', 4)}`, C().ink], [`${i + 1} ${ch.source}`, colors[i]]];
    // The amplitude under the cursor, to pick a level by.
    if (sg && (!v.sweeping || t <= v.tScan)) {
      const fr = Math.round((t - t0 - sg.t[0]) / hop), b = Math.round(f / (sg.f[1] - sg.f[0]));
      if (fr >= 0 && fr < sg.frames && b >= 0 && b < sg.bins) {
        rows.push([`A  ${num(sg.amp[fr * sg.bins + b])} ${unit}  ${fmtDb(s.db[fr * sg.bins + b], 1)} dB`, colors[i]]);
        if (nz && s.db[fr * sg.bins + b] > DB_FLOOR) rows.push([`   ${relText(values[fr * sg.bins + b])} (the noise: ${fmtDb(nz[b], 1)} dB)`, colors[i]]);
      }
    }
    readout(g, P, hover.x, rows);
  }
  g.restore();
  if (!shown || !levels) return null;
  const [lo, hi] = v.levelScale ?? levelRange(shown.sorted, levels);
  const st = { channel: i, source: ch.source, floor: levels[0], ceiling: levels[1], auto: !fixed, rule: shown.auto?.rule, lo, hi, sorted: shown.sorted, unit, median: shown.auto?.median, aboveNoise: !!noise, switchOn: above, noNoise: above && !noise };
  drawStrip(v, st, shown);
  return st;
}

// −36, 20, −4.5: dB with a real minus sign; with sign, +20 for dB above the noise.
const fmtDb = (d, digits = 0, sign = false) => `${d < 0 ? '−' : sign && d > 0 ? '+' : ''}${Math.abs(d).toFixed(Math.abs(d) < 10 && digits === 0 ? 1 : digits).replace(/\.0$/, '')}`;
// A value in dB above the noise, in words: 3 dB below it rather than −3 dB above.
const relText = (d) => (Math.abs(d) < 0.05 ? 'at the noise' : d < 0 ? `${fmtDb(-d, 1)} dB below the noise` : `${fmtDb(d, 1, true)} dB above the noise`);
// Which rule of the automatic levels set the floor (core/spectrum.js autoLevels).
function autoText(st) {
  if (st.rule === 'depth') return `auto: ${AUTO_LEVELS.depth} dB below the ceiling (at most)`;
  if (st.rule === 'span') return `auto: ${AUTO_LEVELS.span} dB below the ceiling (at least)`;
  if (st.rule === 'noise') return `auto: ${AUTO_LEVELS.noiseMargin} dB above the noise`;
  return `auto: median ${fmtDb(st.median ?? 0, 1)} dB + ${AUTO_LEVELS.margin} dB`;
}
// Share of the shown bins above a level (sorted ascending).
function shareAbove(sorted, d) {
  let a = 0, b = sorted.length;
  while (a < b) { const m = (a + b) >> 1; if (sorted[m] <= d) a = m + 1; else b = m; }
  return sorted.length ? (sorted.length - a) / sorted.length : 0;
}

// The levels strip at the right edge (v.S): the shown amplitudes as a
// histogram (bars from the colour bar leftwards, linear in the count as in
// pyqtgraph, so the noise is the big hump and the lines the thin tail above
// it), the colour bar on the same dB scale (black below the floor, brightest
// above the ceiling), the band between the levels and a handle on each; above
// it (S.st … S.t) the switch between absolute dB and dB above the noise.
const BAR_W = 9;
function drawStrip(v, st, shown) {
  const { g, S, hover } = v;
  const { lo, hi, floor, ceiling } = st, sign = st.aboveNoise;
  const H = S.b - S.t, yOf = (d) => S.b - ((d - lo) / (hi - lo)) * H;
  const barL = S.r - BAR_W, hL = S.l, hR = barL - 2;
  const nb = Math.max(8, Math.round(H / 3)), hk = `${lo}|${hi}|${nb}`;
  if (shown.histKey !== hk) { shown.hist = levelHistogram(shown.sorted, lo, hi, nb); shown.histKey = hk; }
  const { counts, width } = shown.hist;
  // The band between the levels.
  const yc = yOf(ceiling), yf = yOf(floor);
  g.fillStyle = C().hover;
  g.fillRect(hL, yc, hR - hL, yf - yc);
  // A faint line every 20 dB across the histogram, so where the noise's hump
  // sits can be read without hovering; the labels go on top (below).
  const ticks = [];
  for (let d = 20 * Math.ceil(lo / 20); d <= hi; d += 20) ticks.push(d);
  // Above the noise, the 0 dB line is the noise itself: a little stronger.
  g.lineWidth = 1;
  for (const d of ticks) {
    const y = Math.round(yOf(d)) + 0.5;
    g.strokeStyle = sign && d === 0 ? C().ruleStrong : C().rule;
    g.beginPath(); g.moveTo(hL, y); g.lineTo(hR, y); g.stroke();
  }
  let mx = 0;
  for (const c of counts) mx = Math.max(mx, c);
  const L = mx || 1;
  for (let k = 0; k < counts.length; k++) {
    if (!counts[k]) continue;
    const d0 = lo + k * width, len = (counts[k] / L) * (hR - hL), y0 = yOf(d0 + width), y1 = yOf(d0);
    const inside = d0 + width / 2 >= floor && d0 + width / 2 <= ceiling;
    g.fillStyle = inside ? C().hist : C().grid;
    g.fillRect(hR - len, y0, len, Math.max(1, y1 - y0));
  }
  // The colour bar: each pixel row in the colour its dB gets.
  const span = ceiling - floor;
  for (let y = Math.floor(S.t); y < S.b; y++) {
    const c = 3 * lutIndex(lo + ((S.b - y - 0.5) / H) * (hi - lo), floor, span);
    g.fillStyle = `rgb(${LUT[c]}, ${LUT[c + 1]}, ${LUT[c + 2]})`;
    g.fillRect(barL, y, BAR_W, 1);
  }
  g.strokeStyle = C().axis; g.lineWidth = 1;
  g.strokeRect(barL - 0.5, S.t + 0.5, BAR_W + 1, H - 1);
  // Where the handles' labels go (top of each box, 12 px high).
  const yC = Math.round(yOf(ceiling)) + 0.5, yF = Math.round(yOf(floor)) + 0.5;
  const tops = [Math.max(S.t + 1, yC - 15), Math.min(S.b - 14, yF + 3)];
  // The scale's labels, outlined so they read over the bars; not where a
  // handle's label is, and only if they fit beside the colour bar.
  g.font = `9px ${C().mono}`; g.textAlign = 'left'; g.textBaseline = 'middle';
  if (hR - hL >= 26) for (const d of ticks) {
    const y = Math.round(yOf(d)), t = fmtDb(d, 0, sign);
    if (y < S.t + 11 || y > S.b - 3 || tops.some((ty) => y > ty - 4 && y < ty + 24)) continue;
    g.lineWidth = 3; g.strokeStyle = C().veil; g.strokeText(t, hL + 2, y - 5);
    g.fillStyle = C().label; g.fillText(t, hL + 2, y - 5);
  }
  // The handles: a line across, a grip at the left, the level in dB.
  g.font = `10px ${C().mono}`; g.textAlign = 'left';
  for (const [d, y, ty] of [[ceiling, yC, tops[0]], [floor, yF, tops[1]]]) {
    g.strokeStyle = C().handle; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(hL, y); g.lineTo(S.r, y); g.stroke();
    g.fillStyle = C().handle;
    g.beginPath(); g.moveTo(hL - 1, y - 5); g.lineTo(hL + 5, y); g.lineTo(hL - 1, y + 5); g.closePath(); g.fill();
    const s = fmtDb(d, 0, sign), w = g.measureText(s).width;
    g.fillStyle = C().veil; g.fillRect(hL + 6, ty, w + 4, 12);
    g.fillStyle = C().handle; g.textBaseline = 'top'; g.fillText(s, hL + 8, ty + 1);
  }
  // Under the strip, where the time axis has its labels: the unit, and auto.
  g.font = `10.5px ${C().mono}`; g.textBaseline = 'top'; g.textAlign = 'center';
  g.fillStyle = C().label;
  g.fillText(st.auto ? 'dB auto' : 'dB', (S.l + S.r) / 2, S.b + 5);
  // The switch above the strip: what a colour means. Lit above the noise
  // (not the default); a click switches (ui/display.js).
  const sw = { l: S.l, r: S.r, t: S.st, b: S.t - 4 };
  st.switchBox = sw;
  const swHover = hover && hover.x >= sw.l - 2 && hover.x <= sw.r + 2 && hover.y >= sw.t - 2 && hover.y <= sw.b + 2;
  const on = st.switchOn;
  g.fillStyle = on ? C().accent : swHover ? C().hover : C().veil;
  g.fillRect(sw.l, sw.t, sw.r - sw.l, sw.b - sw.t);
  g.strokeStyle = on ? C().accent : C().axis; g.lineWidth = 1;
  g.strokeRect(sw.l + 0.5, sw.t + 0.5, sw.r - sw.l - 1, sw.b - sw.t - 1);
  g.font = `600 9.5px ${C().mono}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = on ? C().inkOnLit : C().label;
  g.fillText(on ? 'noise' : 'abs', (sw.l + sw.r) / 2, (sw.t + sw.b) / 2 + 0.5);
  const grey = C().ink, dim = C().label;
  // Its readout goes beside the strip, outside the screen, as the strip's does.
  if (swHover) {
    st.tip = { y: (sw.t + sw.b) / 2, rows: st.noNoise ? [
      ['Colour: dB above the noise, but', grey],
      [`${st.source} has no noise on the screen`, grey],
      ['(its bins are mostly exact zeros):', grey],
      [`absolute shown, dB of ${st.unit}`, grey],
      ['click: absolute', dim],
    ] : sign ? [
      ['Colour: dB above the noise', grey],
      ['at each frequency (0 dB: the noise there)', grey],
      ['click: absolute, dB of ' + st.unit, dim],
    ] : [
      [`Colour: absolute, dB of ${st.unit}`, grey],
      [`(0 dB: 1 ${st.unit})`, grey],
      ['click: dB above the noise at each frequency', dim],
    ] };
    return;
  }
  // Hovering the strip: the level under the pointer and how to use it.
  if (hover && hover.x >= S.l - 6 && hover.y >= S.t && hover.y <= S.b) {
    const d = lo + ((S.b - hover.y) / H) * (hi - lo);
    const y = Math.round(hover.y) + 0.5;
    g.strokeStyle = C().cursor; g.setLineDash([2, 3]); g.lineWidth = 1;
    g.beginPath(); g.moveTo(hL, y); g.lineTo(S.r, y); g.stroke(); g.setLineDash([]);
    // The readout goes to the right of the strip, outside the screen (the
    // display places it), so the plot stays in view while the levels move.
    st.tip = { y: hover.y, rows: [
      [sign ? relText(d) : `${fmtDb(d, 1)} dB = ${num(10 ** (d / 20))} ${st.unit}`, grey],
      [`${Math.round(100 * shareAbove(st.sorted, d))} % of the shown bins above`, grey],
      [`floor ${fmtDb(floor, 1, sign)} dB · ceiling ${fmtDb(ceiling, 1, sign)} dB`, grey],
      [st.auto ? autoText(st) : `set by hand for ${st.source} · double-click: auto`, dim],
      ['drag a handle or the band', dim],
      ['wheel: floor · Shift+wheel: ceiling', dim],
    ] };
  }
}

function freqLabelsTime(v) {
  const { g, P } = v;
  g.font = `10.5px ${C().mono}`;
  g.fillStyle = C().label;
  g.textBaseline = 'top';
  for (let i = 0; i <= DIVX; i++) {
    const x = P.l + i * P.dx;
    g.textAlign = i === 0 ? 'left' : i === DIVX ? 'right' : 'center';
    g.fillText(siUnit(Number(v.xt(x).toPrecision(6)), 's', 4), x, P.b + 5);
  }
}

// The hover readout goes in the top corner of the half the pointer is not in
// (the person: "it blocks the view on the diagram"), as a scope's readouts do.
function readout(g, P, x, rows, top = P.t + 6) {
  g.font = `11.5px ${C().mono}`;
  g.textAlign = 'left'; g.textBaseline = 'top';
  const w = Math.max(...rows.map(([s]) => g.measureText(s).width)) + 14;
  const bx = Math.max(2, x < (P.l + P.r) / 2 ? P.r - 6 - w : P.l + 6);
  g.fillStyle = C().veil; g.fillRect(bx, top, w, rows.length * 16 + 8);
  g.strokeStyle = C().tick; g.strokeRect(bx + 0.5, top + 0.5, w - 1, rows.length * 16 + 7);
  rows.forEach(([s, c], j) => { g.fillStyle = c; g.fillText(s, bx + 7, top + 5 + j * 16); });
}
