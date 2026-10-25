// Small plots in the scope's style (dark screen, dotted grid, mono labels)
// for the Analysis tab: a frame with linear or logarithmic axes, and helpers
// to draw curves, points and markers in data coordinates.

import { siUnit, num } from './units.js';

const BG = '#0a0d10';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';
export const PLOT_COLORS = { ink: 'rgba(235, 240, 245, 0.9)', dim: 'rgba(200, 210, 218, 0.7)', grid: 'rgba(160, 175, 190, 0.18)', axis: 'rgba(160, 175, 190, 0.45)' };

// Ticks for a linear axis: about n steps of 1, 2 or 5 × 10^k.
export function niceTicks(lo, hi, n = 6) {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / n, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}
// Padded range of values, ignoring non-finite ones.
export function extent(values, pad = 0.08) {
  let lo = Infinity, hi = -Infinity;
  for (const v of values) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!Number.isFinite(lo)) return [-1, 1];
  if (lo === hi) { const d = Math.abs(lo) || 1; return [lo - d / 2, hi + d / 2]; }
  const d = (hi - lo) * pad;
  return [lo - d, hi + d];
}

// A plot in a canvas: create once, then frame() and draw on each render.
export function createPlot(canvas) {
  const g = canvas.getContext('2d');
  let W = 0, H = 0, P = null, ax = null;
  function size() {
    const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    W = Math.max(60, r.width); H = Math.max(60, r.height);
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const X = (x) => P.l + (ax.xlog ? (Math.log10(x) - Math.log10(ax.x0)) / (Math.log10(ax.x1) - Math.log10(ax.x0)) : (x - ax.x0) / (ax.x1 - ax.x0)) * (P.r - P.l);
  const Y = (y) => P.b - ((y - ax.y0) / (ax.y1 - ax.y0)) * (P.b - P.t);
  return {
    g,
    get P() { return P; },
    // The axes as last drawn (after equal scaling).
    get ax() { return ax; },
    X, Y,
    // Data coordinates of a point in the canvas (CSS pixels), linear axes.
    at(px, py) { return [ax.x0 + ((px - P.l) / (P.r - P.l)) * (ax.x1 - ax.x0), ax.y0 + ((P.b - py) / (P.b - P.t)) * (ax.y1 - ax.y0)]; },
    // axes: { x0, x1, y0, y1, xlog, title, xlabel, ylabel, xunit, yunit, equal }
    frame(axes) {
      size();
      ax = { ...axes };
      P = { l: 52, t: axes.title ? 20 : 8, r: W - 10, b: H - 24 };
      if (ax.equal) {
        // Same scale on both axes (pole maps, Nyquist): widen the shorter range.
        const sx = (ax.x1 - ax.x0) / (P.r - P.l), sy = (ax.y1 - ax.y0) / (P.b - P.t);
        if (sx > sy) { const c = (ax.y0 + ax.y1) / 2, h = (sx * (P.b - P.t)) / 2; ax.y0 = c - h; ax.y1 = c + h; } else { const c = (ax.x0 + ax.x1) / 2, h = (sy * (P.r - P.l)) / 2; ax.x0 = c - h; ax.x1 = c + h; }
      }
      g.fillStyle = BG; g.fillRect(0, 0, W, H);
      g.font = `10.5px ${MONO}`;
      if (axes.title) { g.fillStyle = PLOT_COLORS.ink; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(axes.title, P.l, 4); }
      // Grid and tick labels.
      g.lineWidth = 1;
      const xt = ax.xlog ? decades(ax.x0, ax.x1) : niceTicks(ax.x0, ax.x1, Math.max(3, Math.floor((P.r - P.l) / 70)));
      const yt = niceTicks(ax.y0, ax.y1, Math.max(3, Math.floor((P.b - P.t) / 34)));
      g.strokeStyle = PLOT_COLORS.grid;
      g.beginPath();
      for (const v of xt) { const x = Math.round(X(v)) + 0.5; g.moveTo(x, P.t); g.lineTo(x, P.b); }
      for (const v of yt) { const y = Math.round(Y(v)) + 0.5; g.moveTo(P.l, y); g.lineTo(P.r, y); }
      g.stroke();
      g.fillStyle = PLOT_COLORS.dim;
      g.textAlign = 'center'; g.textBaseline = 'top';
      for (const v of xt) g.fillText(ax.xunit ? siUnit(v, ax.xunit, 3) : num(v, 3), X(v), P.b + 5);
      g.textAlign = 'right'; g.textBaseline = 'middle';
      for (const v of yt) g.fillText(ax.yunit ? siUnit(v, ax.yunit, 3) : num(v, 3), P.l - 5, Y(v));
      // Zero lines, if inside.
      g.strokeStyle = PLOT_COLORS.axis;
      g.beginPath();
      if (!ax.xlog && ax.x0 < 0 && ax.x1 > 0) { const x = Math.round(X(0)) + 0.5; g.moveTo(x, P.t); g.lineTo(x, P.b); }
      if (ax.y0 < 0 && ax.y1 > 0) { const y = Math.round(Y(0)) + 0.5; g.moveTo(P.l, y); g.lineTo(P.r, y); }
      g.stroke();
      g.strokeRect(P.l + 0.5, P.t + 0.5, P.r - P.l - 1, P.b - P.t - 1);
      if (axes.xlabel) { g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillStyle = PLOT_COLORS.dim; g.fillText(axes.xlabel, P.r - 3, P.b - 3); }
      if (axes.ylabel) { g.textAlign = 'left'; g.textBaseline = 'top'; g.fillStyle = PLOT_COLORS.dim; g.fillText(axes.ylabel, P.l + 4, P.t + 3); }
      return ax;
    },
    // Clip to the plot area for the drawing in fn.
    clip(fn) { g.save(); g.beginPath(); g.rect(P.l, P.t, P.r - P.l, P.b - P.t); g.clip(); fn(); g.restore(); },
    line(xs, ys, { color = PLOT_COLORS.ink, width = 1.5, dash = null, alpha = 1 } = {}) {
      g.strokeStyle = color; g.lineWidth = width; g.globalAlpha = alpha; if (dash) g.setLineDash(dash);
      g.beginPath();
      let pen = false;
      for (let i = 0; i < xs.length; i++) {
        const x = X(xs[i]), y = Y(ys[i]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) { pen = false; continue; }
        if (pen) g.lineTo(x, y); else { g.moveTo(x, y); pen = true; }
      }
      g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
    },
    // Markers: 'x' (pole), 'o' (zero), 'dot', '+'.
    mark(x, y, { shape = 'dot', color = PLOT_COLORS.ink, size = 4, width = 1.6 } = {}) {
      const px = X(x), py = Y(y);
      if (!Number.isFinite(px) || !Number.isFinite(py)) return;
      g.strokeStyle = color; g.fillStyle = color; g.lineWidth = width;
      g.beginPath();
      if (shape === 'x') { g.moveTo(px - size, py - size); g.lineTo(px + size, py + size); g.moveTo(px + size, py - size); g.lineTo(px - size, py + size); g.stroke(); }
      else if (shape === 'o') { g.arc(px, py, size, 0, 2 * Math.PI); g.stroke(); }
      else if (shape === '+') { g.moveTo(px - size, py); g.lineTo(px + size, py); g.moveTo(px, py - size); g.lineTo(px, py + size); g.stroke(); }
      else { g.arc(px, py, size / 2, 0, 2 * Math.PI); g.fill(); }
    },
    text(x, y, s, { color = PLOT_COLORS.dim, align = 'left', base = 'middle', dx = 0, dy = 0 } = {}) {
      g.font = `10.5px ${MONO}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = base;
      g.fillText(s, X(x) + dx, Y(y) + dy);
    },
    note(s, color = PLOT_COLORS.dim) {
      g.font = `11px ${MONO}`; g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(s, (P.l + P.r) / 2, (P.t + P.b) / 2);
    },
  };
}

function decades(a, b) {
  const out = [];
  for (let e = Math.floor(Math.log10(a)); e <= Math.ceil(Math.log10(b)); e++) { const v = 10 ** e; if (v >= a * 0.999 && v <= b * 1.001) out.push(v); }
  return out.length ? out : [a, b];
}
