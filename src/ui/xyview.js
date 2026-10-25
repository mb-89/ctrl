// The scope's XY mode (the person, 2026-10-24: "the x-axis is the reference
// value and the y-axis is the delta … ideally a line … usually an ellipse").
// As on a real oscilloscope, channel 1 drives the beam horizontally at its
// own scale and every other visible channel draws against it vertically.
// With Δ on, a channel in channel 1's unit draws X − Y instead: r on 1 and y on 2
// give the error e = r − y over r, so perfect tracking is a flat line, a gain
// error a tilted line, and a lag an ellipse (a Lissajous figure).
//
// The beam draws the samples inside the timebase window, up to the sweep, so
// moving the window past the start-up leaves the settled figure. Each channel
// reads out the straight line that fits it best, Y ≈ a·X + b, and the spread
// σ of the figure around that line: a line has σ ≈ 0, an ellipse does not.

import { channelSignal } from './freqview.js';
import { num } from './units.js';
import { palette as C } from './palette.js';
import { fitChannel } from '../core/project.js';

const DIVX = 10, DIVY = 8, MAX_POINTS = 6000;

export const xOf = (P, ch, v) => P.l + P.w / 2 + ((v + ch.offset) / ch.scale) * P.dx;
export const vOfX = (P, ch, x) => ((x - P.l - P.w / 2) / P.dx) * ch.scale - ch.offset;

// The value label of a channel at division line j (0 at the top), as the
// value axes print it.
export function valueLabel(ch, j) {
  const v = (DIVY / 2 - j) * ch.scale - ch.offset;
  return num(Math.abs(v) < ch.scale * 1e-9 ? 0 : v, 3);
}

// Whether channel i draws X − Y: Δ is on and it has channel 1's unit (r − V
// would mean nothing).
export const isDelta = (scope, i, unitOf) => !!scope.view?.delta && i > 0 && unitOf(scope.channels[i].source) === unitOf(scope.channels[0].source);
// Whether it does so on the screen now (XY mode).
export const drawsDelta = (scope, i, unitOf) => scope.view?.mode === 'xy' && isDelta(scope, i, unitOf);
// The values a Y channel draws: its signal, or X − Y.
export function ySignal(d, scope, i, unitOf) {
  const y = channelSignal(d, scope.channels[i]);
  if (!y || !isDelta(scope, i, unitOf)) return y;
  const x = channelSignal(d, scope.channels[0]);
  if (!x) return y;
  const out = new Float64Array(y.length);
  for (let j = 0; j < y.length; j++) out[j] = x[j] - y[j];
  return out;
}
// The values channel i shows on the screen in the scope's present mode, from
// the run's signals: X − Y where it draws Δ, else its signal (for Auto Scale).
export function drawnValues(signals, scope, i, unitOf) {
  const v = signals[scope.channels[i].source], x = signals[scope.channels[0].source];
  return v && x && drawsDelta(scope, i, unitOf) ? Array.from(v, (y, j) => x[j] - y) : v;
}
// A channel drawn as X − Y in XY and as itself in the other modes shows two
// different quantities on one scale. When a change of mode or of Δ switches
// a channel between them, it is fitted again (as Auto Scale fits it), so the
// angle does not leave the screen at the error's scale.
export function refitSwitched(before, after, signals, unitOf) {
  for (let i = 1; i < after.channels.length; i++) {
    if (drawsDelta(before, i, unitOf) === drawsDelta(after, i, unitOf)) continue;
    const v = drawnValues(signals, after, i, unitOf), fit = v && fitChannel(v);
    if (fit) Object.assign(after.channels[i], fit);
  }
}

// The channels a vertical gesture (wheel, drag, box) acts on: the selected
// line, or every channel that shows a signal. In XY, channel 1 is the beam's
// horizontal axis, not a Y channel, so it is never among them, selected or not.
export function valueTargets(mode, line, visible) {
  if (mode !== 'xy') return line !== null ? [line] : [0, 1, 2, 3].filter(visible);
  return line !== null && line > 0 && visible(line) ? [line] : [1, 2, 3].filter(visible);
}

// The XY part of the status line: Δ is named only when it changes a channel.
export function xyStatus(scope, unitOf, shown = (i) => scope.channels[i].on) {
  if (!scope.view?.delta) return 'XY';
  if ([1, 2, 3].some((i) => shown(i) && isDelta(scope, i, unitOf))) return 'XY · Δ X − Y';
  const u = unitOf(scope.channels[0].source);
  return `XY · Δ: no channel in ${u === '1' ? "channel 1's unit" : u}`;
}

// What the screen says when channel 1 cannot drive the beam.
export function xyEmpty(scope) {
  const cx = scope.channels[0];
  if (!cx.source) return 'XY: channel 1 drives the beam across. Give it a source (the reference r, say).';
  if (!cx.on) return `XY: channel 1 (${cx.source}) is off. Turn it on with the channel key 1 under Vertical.`;
  return `XY: channel 1's source ${cx.source} has no signal.`;
}

// A channel's line fit as its label reads: a slope and an intercept below a
// millionth of a division are rounding, shown as 0.
export function fitLabel(name, xName, fit, yScale, xScale, unit = '1') {
  const a = Math.abs(fit.a) < 1e-6 * (yScale / xScale) ? 0 : fit.a, b = Math.abs(fit.b) < 1e-6 * yScale ? 0 : fit.b;
  return `${name}  ≈ ${num(a, 3)}·${xName} ${b < 0 ? '−' : '+'} ${num(Math.abs(b), 3)}   σ ${num(fit.sigma, 3)}${unit === '1' ? '' : ` ${unit}`}`;
}

// Least-squares line through (x, y) over samples [j0, j1], and the spread
// (rms distance in y) of the points around it.
export function lineFit(x, y, j0, j1) {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let j = j0; j <= j1; j++) {
    if (!Number.isFinite(x[j]) || !Number.isFinite(y[j])) continue;
    n++; sx += x[j]; sy += y[j]; sxx += x[j] * x[j]; sxy += x[j] * y[j];
  }
  if (n < 3) return null;
  const vx = sxx - (sx * sx) / n;
  const a = vx > 1e-300 ? (sxy - (sx * sy) / n) / vx : 0, b = (sy - a * sx) / n;
  let r = 0;
  for (let j = j0; j <= j1; j++) if (Number.isFinite(x[j]) && Number.isFinite(y[j])) r += (y[j] - a * x[j] - b) ** 2;
  return { a, b, sigma: Math.sqrt(r / n), n };
}

// The Y channels drawn, the one whose values the left axis shows, and the
// samples the beam draws: inside the window, up to the sweep, every stride-th.
export function xyFrame(v) {
  const { data, scope } = v;
  const ys = [1, 2, 3].filter((i) => scope.channels[i].on && channelSignal(data, scope.channels[i]));
  const t = data.t, [w0, w1] = v.win();
  const dt = t.length > 1 ? t[1] - t[0] : 1;
  const j0 = Math.max(0, Math.ceil(w0 / dt - 1e-9)), j1 = Math.min(v.k, Math.floor(w1 / dt + 1e-9), t.length - 1);
  return { ys, axis: ys.includes(v.axis) ? v.axis : ys[0], j0, j1, stride: Math.max(1, Math.ceil((j1 - j0) / MAX_POINTS)), dt, w1 };
}

// The drawn sample nearest a point of the screen (within `within` pixels):
// { i, j, px, py }, or null.
export function xyNearest(v, hx, hy, within = 14) {
  const { P, data, scope, vy } = v, cx = scope.channels[0], X = channelSignal(data, cx);
  if (!cx.on || !X) return null;
  const { ys, j0, j1, stride } = xyFrame(v);
  let best = null, bd = within;
  for (const i of ys) {
    const y = ySignal(data, scope, i, v.unitLabel), ch = scope.channels[i];
    for (let j = j0; j <= j1; j += stride) {
      if (!Number.isFinite(X[j]) || !Number.isFinite(y[j])) continue;
      const px = xOf(P, cx, X[j]), py = vy(ch, y[j]), d = Math.hypot(px - hx, py - hy);
      if (d < bd) { bd = d; best = { i, j, px, py }; }
    }
  }
  return best;
}

// v: { g, P, data, past, scope, k, axis, line, colors, drawGrid, unitLabel, vy, win, runs, hover }
export function drawXY(v) {
  const { g, P, data, scope, colors, vy } = v;
  v.drawGrid(g);
  const cx = scope.channels[0], X = channelSignal(data, cx);
  g.font = `10.5px ${C().mono}`;
  if (!cx.on || !X) {
    g.fillStyle = C().label; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(xyEmpty(scope), P.l + P.w / 2, P.t + P.h / 2);
    return;
  }
  const { ys, axis: ai, j0, j1, stride, dt, w1 } = xyFrame(v);
  const t = data.t;

  // Axes: channel 1's values below, the axis channel's at the left.
  g.fillStyle = colors[0]; g.textBaseline = 'top';
  for (let i = 0; i <= DIVX; i++) {
    const x = P.l + i * P.dx, val = vOfX(P, cx, x);
    g.textAlign = i === 0 ? 'left' : i === DIVX ? 'right' : 'center';
    g.fillText(num(Math.abs(val) < cx.scale * 1e-9 ? 0 : val, 3), x, P.b + 5);
  }
  if (ai !== undefined) {
    const ch = scope.channels[ai];
    g.fillStyle = colors[ai]; g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let j = 0; j <= DIVY; j++) g.fillText(valueLabel(ch, j), P.l - 22, Math.min(P.b - 5, Math.max(P.t + 5, P.t + j * P.dy)));
  }

  g.save();
  g.beginPath(); g.rect(P.l, P.t, P.w, P.h); g.clip();
  g.lineJoin = 'round';
  const path = (d, i, from, to, ch) => {
    const x = channelSignal(d, cx), y = ySignal(d, scope, i, v.unitLabel);
    if (!x || !y) return;
    g.beginPath();
    let pen = false;
    for (let j = from; j <= to; j += stride) {
      if (!Number.isFinite(x[j]) || !Number.isFinite(y[j])) { pen = false; continue; }
      const px = xOf(P, cx, x[j]), py = vy(ch, y[j]);
      if (pen) g.lineTo(px, py); else { g.moveTo(px, py); pen = true; }
    }
    g.stroke();
  };
  // Earlier runs, faded, over the same window.
  const seen = new Set();
  (v.past ?? []).forEach((d, age) => {
    if (seen.has(d) || d.t.length !== t.length) return;
    seen.add(d);
    g.globalAlpha = 0.5 * (1 - (age + 1) / v.runs);
    g.lineWidth = 1.2;
    for (const i of ys) { g.strokeStyle = colors[i]; path(d, i, j0, Math.min(t.length - 1, Math.floor(w1 / dt + 1e-9)), scope.channels[i]); }
  });
  g.globalAlpha = 1;
  // A selected line among the Y channels stands out; the others dim. A line
  // selected elsewhere (channel 1, the X axis here) dims nothing.
  const dim = ys.includes(v.line);
  for (const i of ys) {
    const ch = scope.channels[i], sel = i === v.line;
    g.strokeStyle = colors[i]; g.lineWidth = sel ? 2.6 : 1.6; g.shadowColor = colors[i]; g.shadowBlur = sel ? 9 : 5;
    g.globalAlpha = dim && !sel ? 0.55 : 1;
    path(data, i, j0, j1, ch);
    // The beam: a bright dot where the figure is now.
    const y = ySignal(data, scope, i, v.unitLabel);
    if (j1 >= j0 && Number.isFinite(X[j1]) && Number.isFinite(y[j1])) {
      g.fillStyle = C().mark; g.beginPath(); g.arc(xOf(P, cx, X[j1]), vy(ch, y[j1]), 3, 0, 2 * Math.PI); g.fill();
    }
  }
  g.shadowBlur = 0; g.globalAlpha = 1;
  // The sample under the pointer: the instant the other views follow.
  const near = v.hover ? xyNearest(v, v.hover.x, v.hover.y) : null;
  if (near) {
    g.strokeStyle = C().mark; g.lineWidth = 1.5; g.beginPath(); g.arc(near.px, near.py, 6, 0, 2 * Math.PI); g.stroke();
    g.fillStyle = C().ink; g.textAlign = near.px > P.r - 90 ? 'right' : 'left'; g.textBaseline = 'bottom';
    g.fillText(`t ${num(t[near.j], 4)} s`, near.px + (near.px > P.r - 90 ? -9 : 9), near.py - 6);
  }
  g.restore();

  // Labels: what X and Y are, and each channel's best line and spread.
  const unit = (ch) => v.unitLabel(ch.source);
  const ux = unit(cx) === '1' ? '' : ` ${unit(cx)}`;
  g.textBaseline = 'bottom'; g.textAlign = 'right'; g.fillStyle = colors[0];
  g.fillText(`X = ${cx.source}${ux ? ` (${ux.trim()})` : ''}`, P.r - 6, P.b - 4);
  g.textAlign = 'left'; g.textBaseline = 'top';
  ys.forEach((i, row) => {
    const ch = scope.channels[i], y = ySignal(data, scope, i, v.unitLabel);
    const fit = lineFit(X, y, j0, j1);
    const name = isDelta(scope, i, v.unitLabel) ? `${cx.source} − ${ch.source}` : ch.source;
    const text = fit ? fitLabel(name, cx.source, fit, ch.scale, cx.scale, unit(ch)) : name;
    const w = g.measureText(text).width;
    g.fillStyle = C().veil; g.fillRect(P.l + 4, P.t + 4 + row * 16, w + 8, 15);
    g.fillStyle = colors[i]; g.fillText(text, P.l + 8, P.t + 6 + row * 16);
  });
}
