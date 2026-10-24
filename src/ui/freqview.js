// The scope's frequency views and display filters (the person, 2026-10-24:
// "we should be able to set the main oscilloscope to FFT mode and to
// spectrogram mode … filter all the signals … see the filter apply in real
// time … the time value of the channel overlaid, a second y-axis").
//
//   FFT          amplitude spectrum of every channel (what has run so far),
//                10 dB per division, or linear in each channel's units
//   Spectrogram  one channel's short-time spectrum over the screen's time,
//                frequency up the left axis, its time trace on the right axis
//
// A channel's display filter changes what the scope shows and analyses, in
// every mode; the system is not changed. See design/output/instrument.md.

import { amplitudeSpectrum, spectrogram, designFilter, applyFilter, filterResponse, peaks } from '../core/spectrum.js';
import { siUnit, num } from './units.js';

const DIVX = 10, DIVY = 8, DB_PER_DIV = 10;
const MONO = '"IBM Plex Mono", ui-monospace, monospace';

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

// A dark-to-bright heat map (after matplotlib's inferno).
const STOPS = [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]];
function heat(x) {
  const s = Math.max(0, Math.min(1, x)) * (STOPS.length - 1), i = Math.min(STOPS.length - 2, Math.floor(s)), f = s - i;
  return STOPS[i].map((c, j) => Math.round(c + f * (STOPS[i + 1][j] - c)));
}

// Draws the FFT or spectrogram view into the plot. v carries the display's
// geometry and state: { g, P, W, H, data, scope, k, axis, line, hover,
// sweeping, tScan, tx, xt, vy, colors, drawGrid, unitLabel }.
export function drawFrequency(v) {
  const mode = v.scope.view?.mode;
  if (mode === 'fft') drawFft(v); else drawSpectrogram(v);
}

function axisText(g, P, labels, side, color) {
  g.font = `10.5px ${MONO}`;
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.textAlign = side === 'left' ? 'right' : 'left';
  labels.forEach(([y, s]) => g.fillText(s, side === 'left' ? P.l - 6 : P.r + 6, Math.min(P.b - 5, Math.max(P.t + 5, y))));
}
function freqLabels(g, P, f0, f1) {
  g.font = `10.5px ${MONO}`;
  g.fillStyle = 'rgba(200, 210, 218, 0.75)';
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
  const [f0, f1] = freqRange(scope, data);
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
  if (db) axisText(g, P, Array.from({ length: DIVY + 1 }, (_, j) => [P.t + j * P.dy, `${refDb - j * DB_PER_DIV}${j ? '' : ' dB'}`]), 'left', 'rgba(200, 210, 218, 0.75)');
  else if (ai !== undefined) axisText(g, P, Array.from({ length: DIVY + 1 }, (_, j) => [P.t + j * P.dy, num((DIVY - j) * scope.channels[ai].scale, 3)]), 'left', colors[ai]);

  g.save();
  g.beginPath(); g.rect(P.l, P.t, P.w, P.h); g.clip();
  const fn = nyquist(data);
  if (fn >= f0 && fn <= f1) {
    const x = Math.round(fx(fn)) + 0.5;
    g.strokeStyle = 'rgba(235, 240, 245, 0.35)'; g.setLineDash([3, 4]);
    g.beginPath(); g.moveTo(x, P.t); g.lineTo(x, P.b); g.stroke(); g.setLineDash([]);
    g.font = `10px ${MONO}`; g.fillStyle = 'rgba(235, 240, 245, 0.55)'; g.textAlign = 'right'; g.textBaseline = 'top';
    g.fillText('Nyquist', x - 4, P.t + 4);
  }
  const order = shown.slice().sort((a, b) => (a === line) - (b === line));
  for (const i of order) {
    const s = spectrumOf(data, scope.channels[i], k);
    if (!s) continue;
    g.strokeStyle = colors[i];
    g.lineWidth = i === line ? 2.4 : 1.4;
    g.globalAlpha = line !== null && i !== line ? 0.55 : 1;
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
    g.strokeStyle = colors[ai]; g.setLineDash([5, 4]); g.lineWidth = 1.2; g.globalAlpha = 0.8;
    g.beginPath();
    fs.forEach((f, j) => { const y = P.t + (-20 * Math.log10(Math.max(mag[j], 1e-9)) / DB_PER_DIV) * P.dy; if (j) g.lineTo(fx(f), y); else g.moveTo(fx(f), y); });
    g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
  }
  // Peaks of the selected channel, labelled.
  const sp = ai !== undefined && spectrumOf(data, scope.channels[ai], k);
  if (sp) {
    g.font = `10.5px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'bottom';
    for (const pk of peaks(sp.f, sp.amp, { count: 6, minRel: 0.02 })) {
      if (pk.f < f0 || pk.f > f1 || pk.f < 3 * sp.df) continue;
      const x = fx(pk.f), y = Math.max(P.t + 26, yOf(ai, pk.amp) - 4);
      g.fillStyle = 'rgba(10, 13, 16, 0.7)';
      const s = siUnit(Number(pk.f.toPrecision(3)), 'Hz', 3), w = g.measureText(s).width;
      g.fillRect(x - w / 2 - 3, y - 13, w + 6, 13);
      g.fillStyle = colors[ai]; g.fillText(s, x, y);
    }
  }
  if (hover && hover.x >= P.l && hover.x <= P.r && hover.y >= P.t && hover.y <= P.b) {
    const f = f0 + ((hover.x - P.l) / P.w) * (f1 - f0);
    const x = Math.round(hover.x) + 0.5;
    g.strokeStyle = 'rgba(235, 240, 245, 0.5)'; g.setLineDash([2, 3]);
    g.beginPath(); g.moveTo(x, P.t); g.lineTo(x, P.b); g.stroke(); g.setLineDash([]);
    const rows = [[`f  ${siUnit(f, 'Hz', 4)}`, 'rgba(235, 240, 245, 0.9)']];
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

function drawSpectrogram(v) {
  const { g, P, data, scope, axis, colors, tx, vy, hover } = v;
  v.drawGrid(g);
  const i = scope.channels[axis]?.on && channelSignal(data, scope.channels[axis]) ? axis : [0, 1, 2, 3].find((c) => scope.channels[c].on && channelSignal(data, scope.channels[c]));
  if (i === undefined) return;
  const ch = scope.channels[i], sig = channelSignal(data, ch), dt = dtOf(data), n = data.t.length - 1;
  const [f0, f1] = freqRange(scope, data);
  const size = scope.view?.size ?? Math.max(64, Math.min(512, 2 ** Math.round(Math.log2(n / 16))));
  const key = `sg|${ch.source}|${JSON.stringify(ch.filter ?? null)}|${size}`;
  const img = cached(data, key, () => {
    const sg = spectrogram(sig, dt, { size, overlap: 0.875, detrend: 'linear' });   // a ramp would flood the lowest bins
    if (!sg.frames) return null;
    let mx = -Infinity;
    for (let q = 0; q < sg.amp.length; q++) mx = Math.max(mx, sg.amp[q]);
    const top = 20 * Math.log10(Math.max(mx, 1e-12)), range = 80;
    const cv = document.createElement('canvas');
    cv.width = sg.frames; cv.height = sg.bins;
    const im = cv.getContext('2d').createImageData(sg.frames, sg.bins);
    for (let fr = 0; fr < sg.frames; fr++) for (let b = 0; b < sg.bins; b++) {
      const a = sg.amp[fr * sg.bins + b], c = heat((20 * Math.log10(Math.max(a, 1e-12)) - top + range) / range);
      const o = ((sg.bins - 1 - b) * sg.frames + fr) * 4;
      im.data[o] = c[0]; im.data[o + 1] = c[1]; im.data[o + 2] = c[2]; im.data[o + 3] = 255;
    }
    cv.getContext('2d').putImageData(im, 0, 0);
    return { cv, sg, top };
  });
  freqLabelsTime(v);
  axisText(g, P, Array.from({ length: DIVY + 1 }, (_, j) => [P.t + j * P.dy, siUnit(Number((f1 - ((f1 - f0) * j) / DIVY).toPrecision(4)), 'Hz', 3)]), 'left', 'rgba(200, 210, 218, 0.75)');
  axisText(g, P, Array.from({ length: DIVY + 1 }, (_, j) => [P.t + j * P.dy, num((DIVY / 2 - j) * ch.scale - ch.offset, 3)]), 'right', colors[i]);
  g.save();
  g.beginPath(); g.rect(P.l, P.t, P.w, P.h); g.clip();
  if (img) {
    const { cv, sg } = img, hop = sg.t.length > 1 ? sg.t[1] - sg.t[0] : dt;
    // Each frame covers [centre − hop/2, centre + hop/2]; rows from f0 to f1.
    const b0 = Math.max(0, Math.floor(f0 / (sg.f[1] - sg.f[0]))), b1 = Math.min(sg.bins - 1, Math.ceil(f1 / (sg.f[1] - sg.f[0])));
    const xa = tx(sg.t[0] - hop / 2), xb = tx(sg.t[sg.frames - 1] + hop / 2);
    const xEnd = v.sweeping ? Math.min(xb, tx(v.tScan)) : xb;
    g.save();
    g.beginPath(); g.rect(P.l, P.t, Math.max(0, xEnd - P.l), P.h); g.clip();
    g.imageSmoothingEnabled = true;
    g.drawImage(cv, 0, sg.bins - 1 - b1, sg.frames, b1 - b0 + 1, xa, P.t, xb - xa, P.h);
    g.restore();
  }
  // The channel's time trace over it, on the right axis.
  const k = v.k;
  g.strokeStyle = colors[i]; g.lineWidth = 1.4; g.globalAlpha = 0.9;
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
    g.strokeStyle = 'rgba(235, 240, 245, 0.35)'; g.beginPath(); g.moveTo(x, P.t); g.lineTo(x, P.b); g.stroke();
  }
  if (hover && hover.x >= P.l && hover.x <= P.r && hover.y >= P.t && hover.y <= P.b) {
    const t = v.xt(hover.x), f = f1 - ((hover.y - P.t) / P.h) * (f1 - f0);
    readout(g, P, hover.x, [[`t  ${siUnit(t, 's', 4)}`, 'rgba(235, 240, 245, 0.9)'], [`f  ${siUnit(f, 'Hz', 4)}`, 'rgba(235, 240, 245, 0.9)'], [`${i + 1} ${ch.source}`, colors[i]]]);
  }
  g.restore();
}

function freqLabelsTime(v) {
  const { g, P } = v;
  g.font = `10.5px ${MONO}`;
  g.fillStyle = 'rgba(200, 210, 218, 0.75)';
  g.textBaseline = 'top';
  for (let i = 0; i <= DIVX; i++) {
    const x = P.l + i * P.dx;
    g.textAlign = i === 0 ? 'left' : i === DIVX ? 'right' : 'center';
    g.fillText(siUnit(Number(v.xt(x).toPrecision(6)), 's', 4), x, P.b + 5);
  }
}

function readout(g, P, x, rows) {
  g.font = `11.5px ${MONO}`;
  g.textAlign = 'left'; g.textBaseline = 'top';
  const w = Math.max(...rows.map(([s]) => g.measureText(s).width)) + 14;
  const bx = x + 10 + w > P.r ? x - 10 - w : x + 10;
  g.fillStyle = 'rgba(10, 13, 16, 0.85)'; g.fillRect(bx, P.t + 6, w, rows.length * 16 + 8);
  g.strokeStyle = 'rgba(160, 175, 190, 0.4)'; g.strokeRect(bx + 0.5, P.t + 6.5, w - 1, rows.length * 16 + 7);
  rows.forEach(([s, c], j) => { g.fillStyle = c; g.fillText(s, bx + 7, P.t + 11 + j * 16); });
}
