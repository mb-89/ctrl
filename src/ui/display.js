// The scope display: a 10 × 8 division graticule with time labels below and
// the active channel's values to the left, four channels, a sweep that crosses
// the screen in real time (the screen is the record), the generator's dashed
// preview, a hover cursor, and direct manipulation:
//   wheel on the plot     zoom time and values around the cursor
//   wheel on an axis      zoom that axis only
//   drag                  pan (time sideways; values up and down)
//   click a trace/marker  select that line: drag and wheel then act on it alone
//   Shift + drag          zoom to the marked box (or band)
// Every gesture sets the same scope settings as the knobs.
// See design/output/instrument.md.

import { siUnit, num } from './units.js';
import { step125 } from '../core/scale.js';
import { channelSignal, drawFrequency, freqRange } from './freqview.js';
import { drawXY, vOfX } from './xyview.js';

export const CHANNEL_COLORS = ['#f2c718', '#33d17a', '#4ea6ff', '#ff5ca8'];
const DIVX = 10, DIVY = 8;
const PAD = { l: 58, t: 6, r: 8, b: 22 };
const PAD_RIGHT_AXIS = 50;   // room for a second value axis at the right
const BG = '#0a0d10';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';

export function createDisplay(root, handlers) {
  const status = root.querySelector('.status');
  const screen = root.querySelector('.screen');
  const badges = root.querySelector('.badges');
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Oscilloscope display. Wheel to zoom, drag to pan, click a trace to select it, Shift-drag to zoom to a box.');
  screen.append(canvas);
  const ctx = canvas.getContext('2d');

  let W = 0, H = 0, dpr = 1;
  let data = null, scope = null, preview = null, selected = 0, line = null;
  let mode = 'stop', tScan = 0, last = 0, raf = 0, hover = null, box = null;
  // Earlier runs, newest first; each fades a step per run and is gone after
  // five (the person, 2026-10-24), so an edit can be compared with before.
  const RUNS = 5;
  let past = [];
  const keepRun = () => { if (data) past = [data, ...past].slice(0, RUNS - 1); };
  // Live mode (ui/live.js): a feed gives the data and the scan line instead
  // of the simulation, whose last data waits in simData. References are
  // saved traces, drawn dashed until cleared.
  let feed = null, simData = null, refs = [];
  const P = { l: 0, t: 0, r: 0, b: 0, w: 0, h: 0, dx: 0, dy: 0 };

  function resize() {
    const r = screen.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = Math.max(40, r.width); H = Math.max(40, r.height);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    layout();
    draw();
  }
  // The plot area; wider right margin when a second axis is shown there.
  const viewMode = () => scope?.view?.mode ?? 'time';
  const rightAxis = () => (viewMode() === 'time' ? rightSet() : null);
  function layout() {
    const wide = scope && (viewMode() === 'spectrogram' || rightAxis() !== null);
    Object.assign(P, { l: PAD.l, t: PAD.t, r: W - (wide ? PAD_RIGHT_AXIS : PAD.r), b: H - PAD.b });
    P.w = P.r - P.l; P.h = P.b - P.t; P.dx = P.w / DIVX; P.dy = P.h / DIVY;
  }

  // Coordinates
  const tx = (t) => P.l + ((t - scope.timebase.position) / scope.timebase.scale) * P.dx;
  const xt = (x) => scope.timebase.position + ((x - P.l) / P.dx) * scope.timebase.scale;
  const vy = (ch, v) => P.t + P.h / 2 - ((v + ch.offset) / ch.scale) * P.dy;
  const divsAt = (y) => (P.t + P.h / 2 - y) / P.dy;
  const win = () => [Math.max(0, scope.timebase.position), scope.timebase.position + DIVX * scope.timebase.scale];
  const region = (x, y) => (x < P.l ? 'yaxis' : y > P.b ? 'xaxis' : 'plot');
  const visible = (i) => scope.channels[i].on && !!data?.signals[scope.channels[i].source];
  const sig = (d, i) => channelSignal(d, scope.channels[i]);
  // The left axis shows the selected line or channel, unless that one is on
  // the right axis; then the first other channel that shows a signal.
  const rightSet = () => (Number.isInteger(scope?.view?.right) && visible(scope.view.right) ? scope.view.right : null);
  const axisChannel = () => {
    const a = line !== null ? line : selected, r = viewMode() === 'time' ? rightSet() : null;
    if (a !== r) return a;
    return [0, 1, 2, 3].find((i) => i !== r && visible(i)) ?? a;
  };
  const unitLabel = (name) => handlers.unitOf?.(name) ?? '1';

  function drawGrid(g) {
    g.fillStyle = BG;
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(160, 175, 190, 0.32)';
    for (let i = 0; i <= DIVX; i++) for (let j = 0; j <= DIVY * 5; j++) g.fillRect(Math.round(P.l + i * P.dx) - 0.5, P.t + (j * P.dy) / 5 - 0.5, 1, 1);
    for (let j = 0; j <= DIVY; j++) for (let i = 0; i <= DIVX * 5; i++) g.fillRect(P.l + (i * P.dx) / 5 - 0.5, Math.round(P.t + j * P.dy) - 0.5, 1, 1);
    g.strokeStyle = 'rgba(160, 175, 190, 0.38)';
    g.lineWidth = 1;
    g.beginPath();
    const cy = Math.round(P.t + P.h / 2) + 0.5, cx = Math.round(P.l + P.w / 2) + 0.5;
    g.moveTo(P.l, cy); g.lineTo(P.r, cy);
    g.moveTo(cx, P.t); g.lineTo(cx, P.b);
    for (let i = 0; i <= DIVX * 5; i++) { const x = Math.round(P.l + (i * P.dx) / 5) + 0.5; g.moveTo(x, cy - 3); g.lineTo(x, cy + 3); }
    for (let j = 0; j <= DIVY * 5; j++) { const y = Math.round(P.t + (j * P.dy) / 5) + 0.5; g.moveTo(cx - 3, y); g.lineTo(cx + 3, y); }
    g.stroke();
    g.strokeStyle = 'rgba(160, 175, 190, 0.5)';
    g.strokeRect(P.l + 0.5, P.t + 0.5, P.w - 1, P.h - 1);
  }

  function drawAxes(g) {
    g.font = `10.5px ${MONO}`;
    g.fillStyle = 'rgba(200, 210, 218, 0.75)';
    g.textBaseline = 'top';
    for (let i = 0; i <= DIVX; i++) {
      const x = P.l + i * P.dx;
      g.textAlign = i === 0 ? 'left' : i === DIVX ? 'right' : 'center';
      g.fillText(siUnit(Number(xt(x).toPrecision(6)), 's', 4), x, P.b + 5);
    }
    const ci = axisChannel();
    const ch = scope.channels[ci];
    if (!visible(ci)) return;
    g.fillStyle = CHANNEL_COLORS[ci];
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let j = 0; j <= DIVY; j++) {
      const y = P.t + j * P.dy;
      const v = (DIVY / 2 - j) * ch.scale - ch.offset;
      g.fillText(num(Math.abs(v) < ch.scale * 1e-9 ? 0 : v, 3), P.l - 22, Math.min(P.b - 5, Math.max(P.t + 5, y)));
    }
    // A second channel's values at the right (the person, 2026-10-24).
    const ri = rightAxis();
    if (ri === null) return;
    const rc = scope.channels[ri];
    g.fillStyle = CHANNEL_COLORS[ri];
    g.textAlign = 'left';
    for (let j = 0; j <= DIVY; j++) {
      const v = (DIVY / 2 - j) * rc.scale - rc.offset;
      g.fillText(num(Math.abs(v) < rc.scale * 1e-9 ? 0 : v, 3), P.r + 6, Math.min(P.b - 5, Math.max(P.t + 5, P.t + j * P.dy)));
    }
  }

  // Polyline of v over t for samples [from, to], collapsing samples that share
  // a pixel column into their min/max, skipping what is off screen.
  function trace(c, t, v, ch, from, to) {
    c.beginPath();
    let started = false, col = null, mn = 0, mx = 0, lastV = 0;
    const flush = () => {
      if (col === null) return;
      if (mn !== mx) { c.lineTo(col, vy(ch, mn)); c.lineTo(col, vy(ch, mx)); }
      c.lineTo(col, vy(ch, lastV));
    };
    for (let i = Math.max(0, from); i <= to; i++) {
      const y = v[i];
      if (!Number.isFinite(y)) break;
      const x = Math.round(tx(t[i]));
      if (x < P.l - 2 && i < to && tx(t[i + 1]) < P.l - 2) continue;
      if (!started) { c.moveTo(x, vy(ch, y)); started = true; col = x; mn = mx = lastV = y; continue; }
      if (x === col) { mn = Math.min(mn, y); mx = Math.max(mx, y); lastV = y; continue; }
      flush();
      if (x > P.r + 2) { col = null; break; }
      col = x; mn = mx = lastV = y;
    }
    flush();
    c.stroke();
  }

  function indexAt(t) {
    const tt = data.t;
    if (tt.length < 2) return 0;
    return Math.max(0, Math.min(tt.length - 1, Math.round((t - tt[0]) / (tt[1] - tt[0]))));
  }

  function markerY(i) {
    const y0 = vy(scope.channels[i], 0);
    return [Math.max(P.t + 7, Math.min(P.b - 7, y0)), y0];
  }

  function draw() {
    if (!W) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!data || !scope) { ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H); return; }
    layout();
    if (viewMode() === 'xy') {
      drawXY({ g: ctx, P, data, past, scope, k: mode !== 'stop' ? indexAt(tScan) : data.t.length - 1, axis: axisChannel(), line, colors: CHANNEL_COLORS, drawGrid, unitLabel, vy, win, runs: RUNS });
      renderStatus();
      return;
    }
    if (viewMode() !== 'time') {
      const n = data.t.length - 1;
      drawFrequency({ g: ctx, P, W, H, data, scope, k: mode !== 'stop' ? indexAt(tScan) : n, axis: axisChannel(), line, hover: box ? null : hover,
        sweeping: mode !== 'stop', tScan, tx, xt, vy, colors: CHANNEL_COLORS, drawGrid, unitLabel });
      renderStatus();
      return;
    }
    drawGrid(ctx);
    drawAxes(ctx);
    ctx.save();
    ctx.beginPath(); ctx.rect(P.l, P.t, P.w, P.h); ctx.clip();
    ctx.lineJoin = 'round';
    const n = data.t.length - 1;
    const sweeping = mode !== 'stop';
    const k = sweeping ? indexAt(tScan) : n;

    const order = [0, 1, 2, 3].sort((a, b) => (a === line) - (b === line));
    // Earlier runs first, whole and faded: they may show what lies ahead.
    const seen = new Set();
    past.forEach((d, age) => {
      if (seen.has(d)) return;
      seen.add(d);
      ctx.globalAlpha = 0.5 * (1 - (age + 1) / RUNS);
      ctx.lineWidth = 1.2;
      for (const i of order) {
        const ch = scope.channels[i], v = sig(d, i);
        if (!ch.on || !v) continue;
        ctx.strokeStyle = CHANNEL_COLORS[i];
        trace(ctx, d.t, v, ch, 0, d.t.length - 1);
      }
    });
    // References: on the channels showing their names, only the part on screen.
    if (refs.length) {
      ctx.setLineDash([6, 4]); ctx.lineWidth = 1.3; ctx.globalAlpha = 0.6;
      const first = (t, x) => { let lo = 0, hi = t.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (t[mid] < x) lo = mid + 1; else hi = mid; } return lo; };
      for (const ref of refs) {
        const a = Math.max(0, first(ref.t, xt(P.l)) - 1), b = Math.min(ref.t.length - 1, first(ref.t, xt(P.r)) + 1);
        for (const i of order) {
          const ch = scope.channels[i], v = ref.signals[ch.source];
          if (!ch.on || !v) continue;
          ctx.strokeStyle = CHANNEL_COLORS[i];
          trace(ctx, ref.t, v, ch, a, b);
        }
      }
      ctx.setLineDash([]);
    }
    for (const i of order) {
      const ch = scope.channels[i];
      const v = sig(data, i);
      if (!ch.on || !v) continue;
      const sel = i === line;
      ctx.strokeStyle = CHANNEL_COLORS[i];
      ctx.lineWidth = sel ? 2.6 : 1.6;
      ctx.shadowColor = CHANNEL_COLORS[i];
      ctx.shadowBlur = sel ? 9 : 5;
      ctx.globalAlpha = line !== null && !sel ? 0.55 : 1;
      // While sweeping, only what has happened so far: nothing ahead of the scan line.
      trace(ctx, data.t, v, ch, 0, k);
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    if (preview) {
      const ch = scope.channels[preview.channel];
      ctx.setLineDash([3, 4]); ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(235, 240, 245, 0.75)';
      trace(ctx, data.t, preview.alone, ch, 0, n);
      ctx.setLineDash([7, 5]); ctx.lineWidth = 2; ctx.strokeStyle = CHANNEL_COLORS[preview.channel];
      trace(ctx, data.t, preview.sum, ch, 0, n);
      ctx.setLineDash([]);
      ctx.font = `11px ${MONO}`;
      ctx.textBaseline = 'bottom';
      const tag = (v, text, color) => {
        const tEnd = Math.min(data.t[n], xt(P.r - 8));
        const j = indexAt(tEnd);
        const y = Math.max(P.t + 14, Math.min(P.b - 4, vy(ch, v[j]) - 4));
        const x = Math.min(tx(tEnd), P.r - 6);
        const w = ctx.measureText(text).width;
        ctx.fillStyle = 'rgba(10, 13, 16, 0.75)'; ctx.fillRect(x - w - 6, y - 13, w + 6, 14);
        ctx.fillStyle = color; ctx.textAlign = 'right'; ctx.fillText(text, x - 3, y);
      };
      tag(preview.sum, `${preview.signal ?? 'r'} + ${preview.label}`, CHANNEL_COLORS[preview.channel]);
      tag(preview.alone, preview.label, 'rgba(235, 240, 245, 0.85)');
    }

    if (sweeping) {
      const x = Math.round(tx(tScan)) + 0.5;
      ctx.strokeStyle = 'rgba(235, 240, 245, 0.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, P.t); ctx.lineTo(x, P.b); ctx.stroke();
    }

    if (box) {
      const x0 = Math.min(box.x0, box.x1), y0 = Math.min(box.y0, box.y1);
      const w = Math.abs(box.x1 - box.x0), h = Math.abs(box.y1 - box.y0);
      const tOnly = h < 8, vOnly = w < 8;
      const rx = vOnly ? P.l : x0, rw = vOnly ? P.w : w, ry = tOnly ? P.t : y0, rh = tOnly ? P.h : h;
      ctx.fillStyle = 'rgba(235, 240, 245, 0.08)'; ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = 'rgba(235, 240, 245, 0.8)'; ctx.setLineDash([4, 3]); ctx.strokeRect(rx + 0.5, ry + 0.5, rw, rh); ctx.setLineDash([]);
    }

    if (hover && !box && region(hover.x, hover.y) === 'plot') {
      const x = Math.round(hover.x) + 0.5;
      const t = xt(hover.x);
      ctx.strokeStyle = 'rgba(235, 240, 245, 0.5)'; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(x, P.t); ctx.lineTo(x, P.b); ctx.stroke(); ctx.setLineDash([]);
      const rows = [[`t  ${siUnit(t, 's', 4)}`, 'rgba(235, 240, 245, 0.9)']];
      if (t >= 0 && t <= data.t[n]) {
        const j = indexAt(t);
        scope.channels.forEach((ch, i) => { const v = sig(data, i); if (ch.on && v) rows.push([`${i + 1} ${ch.source.padEnd(2)} ${num(v[j])}`, CHANNEL_COLORS[i]]); });
      }
      ctx.font = `11.5px ${MONO}`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      const w = Math.max(...rows.map(([s]) => ctx.measureText(s).width)) + 14;
      const bx = hover.x + 10 + w > P.r ? hover.x - 10 - w : hover.x + 10;
      ctx.fillStyle = 'rgba(10, 13, 16, 0.85)'; ctx.fillRect(bx, P.t + 6, w, rows.length * 16 + 8);
      ctx.strokeStyle = 'rgba(160, 175, 190, 0.4)'; ctx.strokeRect(bx + 0.5, P.t + 6.5, w - 1, rows.length * 16 + 7);
      rows.forEach(([s, c], i) => { ctx.fillStyle = c; ctx.fillText(s, bx + 7, P.t + 11 + i * 16); });
    }
    ctx.restore();

    // Ground markers in the left margin: each channel's zero level.
    ctx.font = `600 10px ${MONO}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    scope.channels.forEach((ch, i) => {
      if (!visible(i)) return;
      const [y, y0] = markerY(i);
      const x = P.l - 18;
      ctx.fillStyle = CHANNEL_COLORS[i];
      ctx.beginPath();
      ctx.moveTo(x, y - 7); ctx.lineTo(x + 11, y - 7); ctx.lineTo(x + 17, y); ctx.lineTo(x + 11, y + 7); ctx.lineTo(x, y + 7); ctx.closePath();
      ctx.fill();
      if (i === line) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke(); }
      ctx.fillStyle = BG;
      ctx.fillText(y0 < P.t + 7 ? '↑' : y0 > P.b - 7 ? '↓' : String(i + 1), x + 7, y + 0.5);
    });
    renderStatus();
  }

  function renderStatus() {
    if (!scope || !data) return;
    const state = { run: ['run', 'Run'], stop: ['stop', 'Stop'], single: ['single', 'Single'] }[mode];
    const tb = scope.timebase;
    // Live mode's state (Live, E-STOP, Offline) and what goes with it.
    const live = handlers.liveTag?.();
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const vm = viewMode(), fr = vm === 'fft' || vm === 'spectrogram' ? freqRange(scope, data) : null;
    status.innerHTML = `<span class="st st-${state[0]}">${state[1]}</span>
      ${live ? `<span class="st ${live.cls}">${esc(live.text)}</span>${live.note ? `<span class="dim">${esc(live.note)}</span>` : ''}` : ''}
      ${fr ? `<span class="st st-view">${vm === 'fft' ? 'FFT' : 'Spectrogram'}</span><span>${siUnit(Number(fr[0].toPrecision(3)), 'Hz', 3)} … ${siUnit(Number(fr[1].toPrecision(3)), 'Hz', 3)}</span>` : ''}
      ${vm === 'xy' ? `<span class="st st-view">XY${scope.view?.delta ? ' · Δ X − Y' : ''}</span>` : ''}
      <span>${siUnit(tb.scale, 's')}/div</span>
      <span class="dim">pos ${siUnit(tb.position, 's', 4)}</span>
      ${line !== null ? `<span class="selline" style="--cc:${CHANNEL_COLORS[line]}">line ${line + 1} selected · Esc to release</span>` : ''}
      <span class="grow"></span>
      ${mode !== 'stop' ? `<span class="dim">t ${siUnit(tScan, 's', 3)}</span>` : ''}`;
  }

  function renderBadges() {
    if (!scope || !data) return;
    badges.innerHTML = scope.channels.map((ch, i) => {
      const has = !!data.signals[ch.source];
      const cls = ['badge', ch.on ? 'on' : 'off', i === selected ? 'sel' : '', has ? '' : 'nosig'].join(' ');
      return `<button class="${cls}" data-ch="${i}" style="--cc:${CHANNEL_COLORS[i]}" title="Channel ${i + 1}: ${ch.source ? `${ch.source} in ${unitLabel(ch.source)}` : 'no source; pick one under Vertical'}">
        <span class="num">${i + 1}</span><span class="src">${ch.source || '—'}</span>
        <span class="val">${has ? `${num(ch.scale)} ${unitLabel(ch.source)}/div` : ch.source ? 'no signal' : 'none'}</span></button>`;
    }).join('');
    badges.querySelectorAll('[data-ch]').forEach((b) => b.addEventListener('click', () => handlers.onSelectChannel(Number(b.dataset.ch))));
  }

  // Sweep
  function frame(now) {
    raf = 0;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (mode !== 'stop' && data && scope && feed) {
      // Live: data and scan line come from the plant; a finished sweep becomes
      // an earlier run, or ends a Single; past is a run cut short by a new one.
      const s = feed(), names = Object.keys(data.signals).join();
      if (s.past) past = [s.past, ...past].slice(0, RUNS - 1);
      if (s.done && mode === 'single') { data = s.done; tScan = win()[1]; mode = 'stop'; handlers.onStopped?.(); }
      else { if (s.done) past = [s.done, ...past].slice(0, RUNS - 1); data = s.data; tScan = s.scan; }
      if (Object.keys(data.signals).join() !== names) renderBadges();
    } else if (mode !== 'stop' && data && scope) {
      const [w0, w1] = win();
      if (tScan < w0 || tScan > w1) tScan = w0;
      tScan += dt;
      if (tScan >= w1) {
        if (mode === 'single') { tScan = w1; mode = 'stop'; handlers.onStopped?.(); }
        else { tScan = w0 + ((tScan - w0) % (w1 - w0)); keepRun(); }
      }
    }
    draw();
    if (mode !== 'stop') raf = requestAnimationFrame(frame);
    else last = 0;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  const redraw = () => { if (mode === 'stop') draw(); };

  // Direct manipulation
  function selectLine(i) {
    if (line === i) return;
    line = i;
    handlers.onSelectLine(i);
    redraw();
  }

  // The line under the pointer: a ground marker in the margin, or a trace
  // within a few pixels in the plot.
  function hitLine(x, y) {
    if (!data || !scope || viewMode() !== 'time') return null;
    if (x < P.l && x > P.l - 22) {
      for (const i of [3, 2, 1, 0]) if (visible(i) && Math.abs(markerY(i)[0] - y) <= 8) return i;
      return null;
    }
    if (region(x, y) !== 'plot') return null;
    const t = xt(x);
    if (t < 0 || t > data.t[data.t.length - 1]) return null;
    const j = indexAt(t), j0 = Math.max(0, j - 2), j1 = Math.min(data.t.length - 1, j + 2);
    let best = null, bd = 7;
    for (const i of [line, 0, 1, 2, 3]) {
      if (i === null || !visible(i)) continue;
      const ch = scope.channels[i], v = sig(data, i);
      for (let q = j0; q <= j1; q++) {
        const d = Math.abs(vy(ch, v[q]) - y);
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  }

  // The channels a vertical gesture acts on: the selected line, or every
  // channel that shows a signal.
  // In XY mode channel 1 is the horizontal axis, so not among them.
  const targets = () => (line !== null ? [line] : [0, 1, 2, 3].filter((i) => visible(i) && !(i === 0 && viewMode() === 'xy')));
  // XY mode: channel 1's scale and position, around a screen column.
  function zoomX(sc, x, dir) {
    const ch = sc.channels[0], vc = vOfX(P, ch, x), kx = (x - P.l - P.w / 2) / P.dx;
    ch.scale = step125(ch.scale, dir);
    ch.offset = Number((kx * ch.scale - vc).toPrecision(6));
  }

  let wheelAcc = 0, wheelTimer = null;
  canvas.addEventListener('wheel', (e) => {
    if (!scope || !data) return;
    e.preventDefault();
    wheelAcc += e.deltaY * (e.deltaMode === 1 ? 20 : 1);
    const steps = Math.trunc(wheelAcc / 60);
    if (!steps) return;
    wheelAcc -= steps * 60;
    const { x, y } = pos(e);
    const where = region(x, y);
    if (viewMode() === 'fft' || (viewMode() === 'spectrogram' && where !== 'xaxis')) {
      // Frequency axis: around the cursor (x in FFT, y in the spectrogram).
      const [f0, f1] = freqRange(scope, data), fn = 0.5 / (data.t[1] - data.t[0]);
      const a = viewMode() === 'fft' ? (x - P.l) / P.w : (P.b - y) / P.h;
      const fc = f0 + Math.max(0, Math.min(1, a)) * (f1 - f0), span = Math.min(fn, (f1 - f0) * 1.25 ** steps);
      const nf0 = Math.max(0, Math.min(fn - span, fc - a * span));
      handlers.edit((sc) => { sc.view = { ...(sc.view ?? {}), fmin: Number(nf0.toPrecision(5)), fmax: Number((nf0 + span).toPrecision(5)) }; });
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => handlers.endEdit(), 400);
      return;
    }
    if (viewMode() === 'xy') {
      // Below the screen: X (channel 1); on it or at the left: the Y channels.
      const dir = Math.sign(steps);
      handlers.edit((sc) => {
        for (let s = 0; s < Math.abs(steps); s++) {
          if (where === 'xaxis') { zoomX(sc, x, dir); continue; }
          const k = divsAt(y);
          for (const i of targets()) { const ch = sc.channels[i], vc = k * ch.scale - ch.offset; ch.scale = step125(ch.scale, dir); ch.offset = Number((k * ch.scale - vc).toPrecision(6)); }
        }
      });
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => handlers.endEdit(), 400);
      return;
    }
    const zoomTime = where === 'xaxis' || (where === 'plot' && line === null);
    const zoomValues = where === 'yaxis' || where === 'plot';
    const dir = Math.sign(steps);
    handlers.edit((sc) => {
      for (let s = 0; s < Math.abs(steps); s++) {
        if (zoomTime) {
          const tb = sc.timebase, tc = xt(x);
          tb.scale = step125(tb.scale, dir);
          tb.position = Number((tc - ((x - P.l) / P.dx) * tb.scale).toPrecision(6));
        }
        if (zoomValues) {
          const k = divsAt(y);
          for (const i of targets()) {
            const ch = sc.channels[i], vc = k * ch.scale - ch.offset;
            ch.scale = step125(ch.scale, dir);
            ch.offset = Number((k * ch.scale - vc).toPrecision(6));
          }
        }
      }
    });
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => handlers.endEdit(), 400);
  }, { passive: false });

  let gesture = null;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !scope || !data) return;
    const { x, y } = pos(e);
    canvas.setPointerCapture(e.pointerId);
    if (e.shiftKey && region(x, y) === 'plot') { box = { x0: x, y0: y, x1: x, y1: y }; gesture = { kind: 'box' }; return; }
    const hit = hitLine(x, y);
    if (hit !== null) selectLine(hit);
    const where = region(x, y);
    gesture = { kind: 'pan', x, y, moved: false, hit, time: where !== 'yaxis', values: where !== 'xaxis' };
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pos(e);
    hover = p;
    if (gesture?.kind === 'box') { box.x1 = Math.max(P.l, Math.min(P.r, p.x)); box.y1 = Math.max(P.t, Math.min(P.b, p.y)); draw(); return; }
    if (gesture?.kind === 'pan') {
      const dx = p.x - gesture.x, dy = p.y - gesture.y;
      if (!gesture.moved && Math.hypot(dx, dy) < 3) return;
      gesture.moved = true;
      gesture.x = p.x; gesture.y = p.y;
      canvas.style.cursor = 'grabbing';
      if (viewMode() === 'fft') {
        const [f0, f1] = freqRange(scope, data), fn = 0.5 / (data.t[1] - data.t[0]), df = (-dx / P.w) * (f1 - f0);
        const nf0 = Math.max(0, Math.min(fn - (f1 - f0), f0 + df));
        if (dx) handlers.edit((sc) => { sc.view = { ...(sc.view ?? {}), fmin: Number(nf0.toPrecision(5)), fmax: Number((nf0 + f1 - f0).toPrecision(5)) }; });
        return;
      }
      if (viewMode() === 'xy') {
        handlers.edit((sc) => {
          if (gesture.time && dx) { const ch = sc.channels[0]; ch.offset = Number((ch.offset + (dx / P.dx) * ch.scale).toPrecision(6)); }
          if (gesture.values && dy) for (const i of targets()) { const ch = sc.channels[i]; ch.offset = Number((ch.offset - (dy / P.dy) * ch.scale).toPrecision(6)); }
        });
        return;
      }
      handlers.edit((sc) => {
        if (gesture.time && dx) sc.timebase.position = Number((sc.timebase.position - (dx / P.dx) * sc.timebase.scale).toPrecision(6));
        if (gesture.values && dy) for (const i of targets()) { const ch = sc.channels[i]; ch.offset = Number((ch.offset - (dy / P.dy) * ch.scale).toPrecision(6)); }
      });
      return;
    }
    const where = region(p.x, p.y);
    canvas.style.cursor = hitLine(p.x, p.y) !== null ? 'grab' : where === 'xaxis' ? 'ew-resize' : where === 'yaxis' ? 'ns-resize' : 'crosshair';
    redraw();
  });
  const finish = () => {
    if (!gesture) return;
    if (gesture.kind === 'box') applyBox();
    else if (gesture.moved) handlers.endEdit();
    else if (gesture.hit === null && line !== null) selectLine(null);
    gesture = null;
    canvas.style.cursor = 'crosshair';
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', () => { box = null; gesture = null; draw(); });
  canvas.addEventListener('pointerleave', () => { if (!gesture) { hover = null; redraw(); } });

  // Shift-drag: show exactly the marked box. A flat box zooms time only, a
  // narrow one values only.
  function applyBox() {
    const b = box;
    box = null;
    const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
    const time = x1 - x0 >= 8, values = y1 - y0 >= 8;
    if (!time && !values) { draw(); return; }
    if (viewMode() === 'fft') {
      if (!time) { draw(); return; }
      const [f0, f1] = freqRange(scope, data), fa = f0 + ((x0 - P.l) / P.w) * (f1 - f0), fb = f0 + ((x1 - P.l) / P.w) * (f1 - f0);
      handlers.edit((sc) => { sc.view = { ...(sc.view ?? {}), fmin: Number(Math.max(0, fa).toPrecision(5)), fmax: Number(fb.toPrecision(5)) }; });
      handlers.endEdit();
      return;
    }
    const t0 = xt(x0), t1 = xt(x1), k0 = divsAt(y0), k1 = divsAt(y1);
    const xy = viewMode() === 'xy';
    handlers.edit((sc) => {
      if (time && xy) {
        const ch = sc.channels[0], va = vOfX(P, ch, x0), vb = vOfX(P, ch, x1);
        ch.scale = Number(((vb - va) / DIVX).toPrecision(4)); ch.offset = Number((-(va + vb) / 2).toPrecision(6));
      } else if (time) sc.timebase = { scale: Number(((t1 - t0) / DIVX).toPrecision(4)), position: Number(t0.toPrecision(6)) };
      if (values) for (const i of targets()) {
        const ch = sc.channels[i];
        const top = k0 * ch.scale - ch.offset, bot = k1 * ch.scale - ch.offset;
        ch.scale = Number(((top - bot) / DIVY).toPrecision(4));
        ch.offset = Number((-(top + bot) / 2).toPrecision(6));
      }
    });
    handlers.endEdit();
  }

  new ResizeObserver(resize).observe(screen);
  document.fonts?.ready.then(() => draw());

  return {
    setData(d) { simData = d; if (!feed) data = d; if (line !== null && !visible(line)) line = null; renderBadges(); draw(); },
    // Live mode: fn() -> { data, scan, done, past } each frame; null returns
    // to the simulation.
    setFeed(fn) { feed = fn; data = fn ? fn().data : simData; renderBadges(); draw(); },
    setRefs(list) { refs = list; draw(); },
    renderStatus,  // Live's state changed while the screen stands still
    get data() { return data; },
    setScope(s, sel) { scope = s; selected = sel; if (line !== null && line !== sel) line = null; renderBadges(); draw(); },
    setPreview(p) { preview = p; draw(); },
    setMode(m, { restart = false } = {}) {
      if ((m === 'single' || restart) && scope) { if (m === 'single' && mode !== 'single') keepRun(); tScan = win()[0]; }
      mode = m;
      last = 0;
      kick();
      draw();
    },
    clearRuns() { past = []; draw(); },
    // Auto-tune: the run on screen (or the run given) becomes the newest faded one.
    keep(d = data) { if (d) past = [d, ...past].slice(0, RUNS - 1); draw(); },
    get data() { return data; },
    releaseLine() { if (line === null) return false; selectLine(null); return true; },
    // The instant other views follow: the hover cursor, else the scan line
    // while sweeping, else the right edge of the screen.
    time() {
      if (!scope) return 0;
      if (hover && region(hover.x, hover.y) === 'plot') return xt(hover.x);
      return mode !== 'stop' ? tScan : win()[1];
    },
    get mode() { return mode; },
  };
}
