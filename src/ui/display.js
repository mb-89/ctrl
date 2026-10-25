// The scope display: a 10 × 8 division graticule with time labels below and
// the active channel's values to the left, four channels, a sweep that crosses
// the screen at the speed set in the header (1×: real time; the screen is the
// record; never faster than the page simulates it; core/speed.js paceOf and
// sweepClock), the generator's dashed
// preview, a hover cursor, and direct manipulation:
//   wheel on the plot     zoom time and values around the cursor
//   wheel on an axis      zoom that axis only
//   drag                  pan (time sideways; values up and down)
//   click a trace/marker  select that line: drag and wheel then act on it alone
//   Shift + drag          zoom to the marked box (or band)
//   levels strip          (spectrogram) drag a handle or the band; wheel:
//                         floor, Shift + wheel: ceiling; double-click: auto;
//                         the switch above it: absolute or above the noise
// Every gesture sets the same scope settings as the knobs.
// See design/output/instrument.md.

import { num } from './units.js';
import { siUnit, step125 } from '../core/scale.js';
import { channelSignal, drawFrequency, freqRange, nyquist } from './freqview.js';
import { withLevels, levelsOf, withAboveNoise } from '../core/project.js';
import { drawXY, vOfX, valueLabel, valueTargets, xyStatus, xyFrame, xyNearest } from './xyview.js';
import { sweepClock, paceOf, MAX_FRAME, AS_FAST, singleFrom } from '../core/speed.js';
import { measure, measureLine } from './measure.js';
import { palette as C } from './palette.js';

const CH = () => C().ch;

const DIVX = 10, DIVY = 8;
const PAD = { l: 58, t: 6, r: 8, b: 22 };
const MEASURE_ROW = 15;      // a Measure line under the screen, per measured channel
const PAD_RIGHT_AXIS = 50;   // room for a second value axis at the right
const STRIP_W = 60;          // the spectrogram's levels strip, right of that axis
const STRIP_W_NARROW = 40;   // … on a screen narrower than NARROW px
const SWITCH_H = 18;         // the switch above the strip (absolute / above the noise)
const NARROW = 600;
const LEVEL_STEP = 2;        // dB per wheel step over the strip
const dbText = (d, sign = false) => `${Math.round(d) < 0 ? '−' : sign && Math.round(d) > 0 ? '+' : ''}${Math.abs(Math.round(d))}`;
const r1 = (d) => Math.round(d * 10) / 10;

export function createDisplay(root, handlers) {
  const status = root.querySelector('.status');
  const screen = root.querySelector('.screen');
  // The levels strip's readout: right of the strip, outside the screen, so it
  // never covers the plot while the levels are dragged.
  const stripTip = document.createElement('div');
  stripTip.className = 'tip';
  stripTip.hidden = true;
  document.body.append(stripTip);
  function showStripTip(tip) {
    if (!tip || !S) { stripTip.hidden = true; return; }
    const r = canvas.getBoundingClientRect();
    stripTip.innerHTML = tip.rows.map(([t, c]) => `<div style="color:${c}">${t.replace(/[&<>]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[x])}</div>`).join('');
    stripTip.hidden = false;
    const w = stripTip.offsetWidth, h = stripTip.offsetHeight;
    stripTip.style.left = `${Math.min(window.innerWidth - w - 4, r.left + S.r + 10)}px`;
    stripTip.style.top = `${Math.max(4, Math.min(window.innerHeight - h - 4, r.top + tip.y - h / 2))}px`;
  }
  const badges = root.querySelector('.chbar');
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Oscilloscope display. Wheel to zoom, drag to pan, click a trace to select it, Shift-drag to zoom to a box. In Spectrogram mode the strip at the right sets the colour levels: drag its handles or the band between them, wheel for the floor, Shift+wheel for the ceiling, double-click for automatic levels; the switch above it shows colour as absolute dB or as dB above the noise at each frequency.');
  screen.append(canvas);
  const ctx = canvas.getContext('2d');

  let W = 0, H = 0, dpr = 1;
  let data = null, scope = null, preview = null, selected = 0, line = null;
  let mode = 'stop', tScan = 0, last = 0, raf = 0, hover = null, box = null;
  // Where the cursor last pointed in time, kept after it leaves the screen
  // (until a run starts): the instant the Analysis tab's "Scope time" uses.
  let cursorT = null;
  // Auto-tune's run sweeping once (play): its own clock from 0 to its length
  // T, at the speed; the scan line follows it across the screen. framing: a
  // frame is under way (a run that starts in it goes on from where the one
  // before ended).
  let run = null, framing = false;
  // Earlier runs, newest first; each fades a step per run and is gone after
  // five (the person, 2026-10-24), so an edit can be compared with before.
  const RUNS = 5;
  let past = [];
  // The run whose sampling sets the frequency axis: in Live a sweep just
  // begun has fewer than two samples (no sampling rate yet), so the last one.
  const freqData = () => (data?.t.length > 1 ? data : past.find((d) => d.t.length > 1) ?? data);
  const keepRun = () => { if (data) past = [data, ...past].slice(0, RUNS - 1); };
  // Live mode (ui/live.js): a feed gives the data and the scan line instead
  // of the simulation, whose last data waits in simData. References are
  // saved traces, drawn dashed until cleared.
  let feed = null, simData = null, refs = [];
  const P = { l: 0, t: 0, r: 0, b: 0, w: 0, h: 0, dx: 0, dy: 0 };
  // The spectrogram's levels strip (empty in the other modes), and what it
  // showed last: levels, their dB scale (see freqview.js drawStrip). The
  // switch above it runs from S.st to S.t.
  const S = { l: 0, r: 0, t: 0, b: 0, st: 0 };
  let strip = null, levelScale = null, levelsSig = '';

  function resize() {
    const r = screen.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = Math.max(40, r.width); H = Math.max(40, r.height);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    layout();
    draw();
  }
  // The plot area; wider right margin when a second axis is shown there.
  // The value axes get room for their widest label, so a long one (−0.0121)
  // keeps its sign instead of starting off the canvas.
  const viewMode = () => scope?.view?.mode ?? 'time';
  const rightAxis = () => (viewMode() === 'time' ? rightSet() : null);
  const labelsWidth = (i) => {
    if (i === null || i === undefined || !visible(i)) return 0;
    ctx.font = `10.5px ${C().mono}`;
    let w = 0;
    for (let j = 0; j <= DIVY; j++) w = Math.max(w, ctx.measureText(valueLabel(scope.channels[i], j)).width);
    return w;
  };
  function layout() {
    const vm = viewMode(), spec = !!scope && vm === 'spectrogram';
    const wide = scope && (spec || rightAxis() !== null);
    let l = PAD.l, r = wide ? PAD_RIGHT_AXIS : PAD.r;
    if (scope && data && (vm === 'time' || vm === 'xy')) {
      const left = vm === 'xy' ? xyFrame({ data, scope, axis: axisChannel(), k: data.t.length - 1, win }).axis : axisChannel();
      l = Math.max(PAD.l, Math.ceil(labelsWidth(left)) + 26);
      if (rightAxis() !== null) r = Math.max(PAD_RIGHT_AXIS, Math.ceil(labelsWidth(rightAxis())) + 10);
    }
    const rows = scope && data ? measured().length : 0;
    Object.assign(P, { l, t: PAD.t, r: W - r - (spec ? (W < NARROW ? STRIP_W_NARROW : STRIP_W) : 0), b: H - PAD.b - (rows ? rows * MEASURE_ROW + 2 : 0) });
    P.w = P.r - P.l; P.h = P.b - P.t; P.dx = P.w / DIVX; P.dy = P.h / DIVY;
    Object.assign(S, spec ? { l: P.r + PAD_RIGHT_AXIS + 4, r: W - 6, st: P.t, t: P.t + SWITCH_H, b: P.b } : { l: 0, r: 0, t: 0, b: 0, st: 0 });
  }

  // Coordinates
  const tx = (t) => P.l + ((t - scope.timebase.position) / scope.timebase.scale) * P.dx;
  const xt = (x) => scope.timebase.position + ((x - P.l) / P.dx) * scope.timebase.scale;
  const vy = (ch, v) => P.t + P.h / 2 - ((v + ch.offset) / ch.scale) * P.dy;
  const divsAt = (y) => (P.t + P.h / 2 - y) / P.dy;
  const win = () => [Math.max(0, scope.timebase.position), scope.timebase.position + DIVX * scope.timebase.scale];
  const inStrip = (x, y) => S.r > S.l && x >= S.l - 6 && y >= S.t - 4 && y <= S.b + 4;
  const inSwitch = (x, y) => !!strip?.switchBox && x >= S.l - 2 && x <= S.r + 2 && y >= S.st - 2 && y < S.t - 4 + 2;
  const region = (x, y) => (inSwitch(x, y) ? 'switch' : inStrip(x, y) ? 'strip' : x < P.l ? 'yaxis' : y > P.b ? 'xaxis' : 'plot');
  const visible = (i) => scope.channels[i].on && !!data?.signals[scope.channels[i].source];
  // Channels with a Measure line: Measure on, and the channel showing a signal.
  const measured = () => [0, 1, 2, 3].filter((i) => scope.channels[i].measure && visible(i));
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
    g.fillStyle = C().bg;
    g.fillRect(0, 0, W, H);
    g.fillStyle = C().grid;
    for (let i = 0; i <= DIVX; i++) for (let j = 0; j <= DIVY * 5; j++) g.fillRect(Math.round(P.l + i * P.dx) - 0.5, P.t + (j * P.dy) / 5 - 0.5, 1, 1);
    for (let j = 0; j <= DIVY; j++) for (let i = 0; i <= DIVX * 5; i++) g.fillRect(P.l + (i * P.dx) / 5 - 0.5, Math.round(P.t + j * P.dy) - 0.5, 1, 1);
    g.strokeStyle = C().tick;
    g.lineWidth = 1;
    g.beginPath();
    const cy = Math.round(P.t + P.h / 2) + 0.5, cx = Math.round(P.l + P.w / 2) + 0.5;
    g.moveTo(P.l, cy); g.lineTo(P.r, cy);
    g.moveTo(cx, P.t); g.lineTo(cx, P.b);
    for (let i = 0; i <= DIVX * 5; i++) { const x = Math.round(P.l + (i * P.dx) / 5) + 0.5; g.moveTo(x, cy - 3); g.lineTo(x, cy + 3); }
    for (let j = 0; j <= DIVY * 5; j++) { const y = Math.round(P.t + (j * P.dy) / 5) + 0.5; g.moveTo(cx - 3, y); g.lineTo(cx + 3, y); }
    g.stroke();
    g.strokeStyle = C().axis;
    g.strokeRect(P.l + 0.5, P.t + 0.5, P.w - 1, P.h - 1);
  }

  function drawAxes(g) {
    g.font = `10.5px ${C().mono}`;
    g.fillStyle = C().label;
    g.textBaseline = 'top';
    for (let i = 0; i <= DIVX; i++) {
      const x = P.l + i * P.dx;
      g.textAlign = i === 0 ? 'left' : i === DIVX ? 'right' : 'center';
      g.fillText(siUnit(Number(xt(x).toPrecision(6)), 's', 4), x, P.b + 5);
    }
    const ci = axisChannel();
    const ch = scope.channels[ci];
    if (!visible(ci)) return;
    g.fillStyle = CH()[ci];
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let j = 0; j <= DIVY; j++) g.fillText(valueLabel(ch, j), P.l - 22, Math.min(P.b - 5, Math.max(P.t + 5, P.t + j * P.dy)));
    // A second channel's values at the right (the person, 2026-10-24).
    const ri = rightAxis();
    if (ri === null) return;
    const rc = scope.channels[ri];
    g.fillStyle = CH()[ri];
    g.textAlign = 'left';
    for (let j = 0; j <= DIVY; j++) g.fillText(valueLabel(rc, j), P.r + 6, Math.min(P.b - 5, Math.max(P.t + 5, P.t + j * P.dy)));
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
    if (!data || !scope) { ctx.fillStyle = C().bg; ctx.fillRect(0, 0, W, H); return; }
    layout();
    if (viewMode() !== 'spectrogram') showStripTip(null);
    if (viewMode() === 'xy') {
      strip = null;
      delete canvas.dataset.levels;
      levelsChanged();
      drawXY({ ...xyArgs(), g: ctx, past, colors: CH(), drawGrid, runs: RUNS, hover: box || !hover || region(hover.x, hover.y) !== 'plot' ? null : hover });
      drawMeasures(ctx);
      renderStatus();
      return;
    }
    if (viewMode() !== 'time') {
      const n = data.t.length - 1;
      strip = drawFrequency({ g: ctx, P, S, W, H, data, past, live: !!feed, scope, k: mode !== 'stop' ? indexAt(tScan) : n, axis: axisChannel(), line, hover: box ? null : hover,
        sweeping: mode !== 'stop', tScan, tx, xt, vy, colors: CH(), drawGrid, unitLabel, levelScale });
      // For agents and tests: the levels as drawn (floor ceiling lo hi, dB), whether
      // automatic, and their unit: abs (dB of the signal's unit) or noise (dB above the noise).
      showStripTip(strip?.tip);
      if (strip) canvas.dataset.levels = `${[strip.floor, strip.ceiling, strip.lo, strip.hi].map((d) => d.toFixed(1)).join(' ')} ${strip.auto ? 'auto' : 'fixed'} ${strip.aboveNoise ? 'noise' : 'abs'}`;
      else delete canvas.dataset.levels;
      levelsChanged();
      drawMeasures(ctx);
      renderStatus();
      return;
    }
    strip = null;
    delete canvas.dataset.levels;
    levelsChanged();
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
      ctx.globalAlpha = C().alpha.past * (1 - (age + 1) / RUNS);
      ctx.lineWidth = 1.2;
      for (const i of order) {
        const ch = scope.channels[i], v = sig(d, i);
        if (!ch.on || !v) continue;
        ctx.strokeStyle = CH()[i];
        trace(ctx, d.t, v, ch, 0, d.t.length - 1);
      }
    });
    // References: on the channels showing their names, only the part on screen.
    if (refs.length) {
      ctx.setLineDash([6, 4]); ctx.lineWidth = 1.3; ctx.globalAlpha = C().alpha.guide;
      const first = (t, x) => { let lo = 0, hi = t.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (t[mid] < x) lo = mid + 1; else hi = mid; } return lo; };
      for (const ref of refs) {
        const a = Math.max(0, first(ref.t, xt(P.l)) - 1), b = Math.min(ref.t.length - 1, first(ref.t, xt(P.r)) + 1);
        for (const i of order) {
          const ch = scope.channels[i], v = ref.signals[ch.source];
          if (!ch.on || !v) continue;
          ctx.strokeStyle = CH()[i];
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
      ctx.strokeStyle = CH()[i];
      ctx.lineWidth = sel ? 2.6 : 1.6;
      ctx.shadowColor = CH()[i];
      ctx.shadowBlur = sel ? 9 : 5;
      ctx.globalAlpha = line !== null && !sel ? C().alpha.unselected : 1;
      // While sweeping, only what has happened so far: nothing ahead of the scan line.
      trace(ctx, data.t, v, ch, 0, k);
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    if (preview) {
      const ch = scope.channels[preview.channel];
      ctx.setLineDash([3, 4]); ctx.lineWidth = 1.2; ctx.strokeStyle = C().preview;
      trace(ctx, data.t, preview.alone, ch, 0, n);
      ctx.setLineDash([7, 5]); ctx.lineWidth = 2; ctx.strokeStyle = CH()[preview.channel];
      trace(ctx, data.t, preview.sum, ch, 0, n);
      ctx.setLineDash([]);
      ctx.font = `11px ${C().mono}`;
      ctx.textBaseline = 'bottom';
      const tag = (v, text, color) => {
        const tEnd = Math.min(data.t[n], xt(P.r - 8));
        const j = indexAt(tEnd);
        const y = Math.max(P.t + 14, Math.min(P.b - 4, vy(ch, v[j]) - 4));
        const x = Math.min(tx(tEnd), P.r - 6);
        const w = ctx.measureText(text).width;
        ctx.fillStyle = C().veil; ctx.fillRect(x - w - 6, y - 13, w + 6, 14);
        ctx.fillStyle = color; ctx.textAlign = 'right'; ctx.fillText(text, x - 3, y);
      };
      tag(preview.sum, `${preview.signal ?? 'r'} + ${preview.label}`, CH()[preview.channel]);
      tag(preview.alone, preview.label, C().ink);
    }

    if (sweeping) {
      const x = Math.round(tx(tScan)) + 0.5;
      ctx.strokeStyle = C().scan; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, P.t); ctx.lineTo(x, P.b); ctx.stroke();
    }

    if (box) {
      const x0 = Math.min(box.x0, box.x1), y0 = Math.min(box.y0, box.y1);
      const w = Math.abs(box.x1 - box.x0), h = Math.abs(box.y1 - box.y0);
      const tOnly = h < 8, vOnly = w < 8;
      const rx = vOnly ? P.l : x0, rw = vOnly ? P.w : w, ry = tOnly ? P.t : y0, rh = tOnly ? P.h : h;
      ctx.fillStyle = C().hover; ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = C().preview; ctx.setLineDash([4, 3]); ctx.strokeRect(rx + 0.5, ry + 0.5, rw, rh); ctx.setLineDash([]);
    }

    if (hover && !box && region(hover.x, hover.y) === 'plot') {
      const x = Math.round(hover.x) + 0.5;
      const t = xt(hover.x);
      ctx.strokeStyle = C().cursor; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(x, P.t); ctx.lineTo(x, P.b); ctx.stroke(); ctx.setLineDash([]);
      const rows = [[`t  ${siUnit(t, 's', 4)}`, C().ink]];
      if (t >= 0 && t <= data.t[n]) {
        const j = indexAt(t);
        scope.channels.forEach((ch, i) => { const v = sig(data, i); if (ch.on && v) rows.push([`${i + 1} ${ch.source.padEnd(2)} ${num(v[j])}`, CH()[i]]); });
      }
      ctx.font = `11.5px ${C().mono}`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      const w = Math.max(...rows.map(([s]) => ctx.measureText(s).width)) + 14;
      const bx = hover.x + 10 + w > P.r ? hover.x - 10 - w : hover.x + 10;
      ctx.fillStyle = C().veil; ctx.fillRect(bx, P.t + 6, w, rows.length * 16 + 8);
      ctx.strokeStyle = C().tick; ctx.strokeRect(bx + 0.5, P.t + 6.5, w - 1, rows.length * 16 + 7);
      rows.forEach(([s, c], i) => { ctx.fillStyle = c; ctx.fillText(s, bx + 7, P.t + 11 + i * 16); });
    }
    ctx.restore();

    // Ground markers in the left margin: each channel's zero level.
    ctx.font = `600 10px ${C().mono}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    scope.channels.forEach((ch, i) => {
      if (!visible(i)) return;
      const [y, y0] = markerY(i);
      const x = P.l - 18;
      ctx.fillStyle = CH()[i];
      ctx.beginPath();
      ctx.moveTo(x, y - 7); ctx.lineTo(x + 11, y - 7); ctx.lineTo(x + 17, y); ctx.lineTo(x + 11, y + 7); ctx.lineTo(x, y + 7); ctx.closePath();
      ctx.fill();
      if (i === line) { ctx.strokeStyle = C().mark; ctx.lineWidth = 1.5; ctx.stroke(); }
      ctx.fillStyle = C().bg;
      ctx.fillText(y0 < P.t + 7 ? '↑' : y0 > P.b - 7 ? '↓' : String(i + 1), x + 7, y + 0.5);
    });
    drawMeasures(ctx);
    renderStatus();
  }

  // The Measure lines under the screen, one per measured channel in its
  // colour, over the samples the screen shows: inside the timebase window, up
  // to the sweep (as XY draws them), the filtered signal when a filter is set.
  // For agents and tests, canvas.dataset.measure holds the lines.
  function drawMeasures(g) {
    const rows = measured();
    if (!rows.length) { delete canvas.dataset.measure; return; }
    const t = data.t, n = t.length - 1, dt = t.length > 1 ? t[1] - t[0] : 1;
    const [w0, w1] = win();
    const k = mode !== 'stop' ? indexAt(tScan) : n;
    const j0 = Math.max(0, Math.ceil(w0 / dt - 1e-9)), j1 = Math.min(k, Math.floor(w1 / dt + 1e-9), n);
    g.font = `10.5px ${C().mono}`;
    g.textAlign = 'left'; g.textBaseline = 'top';
    const lines = rows.map((i, row) => {
      const ch = scope.channels[i], m = measure(t, sig(data, i), j0, j1, ch.scale / 10);
      const y = P.b + PAD.b - 2 + row * MEASURE_ROW;
      g.fillStyle = CH()[i];
      if (!m) { g.fillText(`${i + 1} ${ch.source}  nothing on the screen yet`, P.l, y); return `${i + 1} ${ch.source} -`; }
      const { text, warn } = measureLine(m, i, ch.source, unitLabel(ch.source), ch.scale);
      g.fillText(text, P.l, y);
      if (warn) { g.fillStyle = C().warn; g.fillText(`  ${warn}`, P.l + g.measureText(text).width, y); }
      return warn ? `${text}  ${warn}` : text;
    });
    canvas.dataset.measure = lines.join('\n');
  }

  function renderStatus() {
    if (!scope || !data) return;
    const state = { run: ['run', 'Run'], stop: ['stop', 'Stop'], single: ['single', 'Single'] }[mode];
    const tb = scope.timebase;
    // Live mode's state (Live, E-STOP, Offline) and what goes with it.
    const live = handlers.liveTag?.();
    // What the last run reported (a validity report, else its first warning):
    // loopTuner.info() has all of it.
    const runNote = live ? null : handlers.runNote?.();
    status.dataset.note = runNote ?? '';
    // The state, readable without JavaScript (an agent's browser tool).
    status.dataset.run = mode;
    status.dataset.live = live?.state ?? 'none';
    status.dataset.ramp = live?.ramp ? 'yes' : 'no';
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const vm = viewMode(), fr = vm === 'fft' || vm === 'spectrogram' ? freqRange(scope, freqData()) : null;
    status.innerHTML = `<span class="badge" data-lamp="${{ run: 'ok', stop: 'bad', single: 'warn' }[state[0]]}">${state[1]}</span>
      ${live ? `<span class="badge${live.outline ? ' badge-outline' : ''}"${live.lamp ? ` data-lamp="${live.lamp}"` : ''}>${esc(live.text)}</span>${live.note ? `<span class="muted">${esc(live.note)}</span>` : ''}` : ''}
      ${fr ? `<span class="badge">${vm === 'fft' ? 'FFT' : 'Spectrogram'}</span><span>${siUnit(Number(fr[0].toPrecision(3)), 'Hz', 3)} … ${siUnit(Number(fr[1].toPrecision(3)), 'Hz', 3)}</span>` : ''}
      ${vm === 'spectrogram' && strip ? (strip.aboveNoise
        ? `<span class="badge" title="Spectrogram colour: dB above the noise at each frequency (0 dB: the noise there)">Above noise</span><span title="Spectrogram levels of ${strip.source}, dB above the noise: below the floor black, above the ceiling the brightest colour">${dbText(strip.floor, true)} … ${dbText(strip.ceiling, true)} dB</span><span class="muted">${strip.auto ? 'auto' : 'levels set'}</span>`
        : `${strip.noNoise ? `<span class="muted" title="Above noise is on, but ${strip.source} has no noise on the screen (its bins are mostly exact zeros): the colours stay absolute">no noise: absolute</span>` : `<span class="muted" title="Spectrogram colour: dB of the signal's unit (0 dB: 1 ${unitLabel(strip.source)})">Absolute</span>`}<span title="Spectrogram levels of ${strip.source}: below the floor black, above the ceiling the brightest colour">${dbText(strip.floor)} … ${dbText(strip.ceiling)} dB<span class="wide"> · ceiling ${num(10 ** (strip.ceiling / 20), 3)} ${unitLabel(strip.source)}</span></span><span class="muted">${strip.auto ? 'auto' : 'levels set'}</span>`) : ''}
      ${vm === 'xy' ? `<span class="badge">${xyStatus(scope, unitLabel, visible)}</span>` : ''}
      <span>${siUnit(tb.scale, 's')}/div</span>
      <span class="muted">pos ${siUnit(tb.position, 's', 4)}</span>
      ${runNote ? `<span class="badge badge-outline" data-lamp="warn">Warning</span><span class="run-note" title="${esc(runNote)}">${esc(runNote)}</span>` : ''}
      ${line !== null ? `<span class="selline" style="--cc: var(--ch-${line + 1})">line ${line + 1} selected · Esc to release</span>` : ''}
      <span class="grow"></span>
      ${mode !== 'stop' ? `<span class="muted">t ${siUnit(run ? run.t : tScan, 's', 3)}</span>` : ''}`;
  }

  function renderBadges() {
    if (!scope || !data) return;
    // The same channel keys as in Vertical (lit while on, the selected one
    // marked under its number, the same press), with the source and its scale.
    badges.innerHTML = scope.channels.map((ch, i) => {
      const has = !!data.signals[ch.source];
      return `<button class="btn btn-sm btn-ch chbtn" data-ch="${i}" style="--cc: var(--ch-${i + 1})" aria-pressed="${!!ch.on}" aria-current="${i === selected}" title="Channel ${i + 1}: ${ch.source ? `${ch.source} in ${unitLabel(ch.source)}` : 'no source; pick one under Vertical'} · press to select, again to turn off">
        <span class="num">${i + 1}</span><span class="mono">${ch.source || '—'}</span>
        <span class="btn-note">${has ? `${num(ch.scale)} ${unitLabel(ch.source)}/div` : ch.source ? 'no signal' : 'none'}</span></button>`;
    }).join('');
    badges.querySelectorAll('[data-ch]').forEach((b) => b.addEventListener('click', () => handlers.onChannelKey(Number(b.dataset.ch))));
  }

  // Sweep. Simulated time runs at the header's speed (handlers.speed(): a
  // factor, or Infinity), never faster than the page simulates the screen
  // (handlers.simRate(), measured; ∞ runs at it); each frame tells
  // handlers.onSweep how much simulated time it swept, for the achieved speed.
  // A live feed brings its own scan line and its own clock.
  // While the page makes a plan (handlers.frameMs() > 0) the sweep keeps
  // its time but draws at most every frameMs, so the plan gets the thread.
  let drawn = 0;
  function frame(now) {
    raf = 0;
    framing = true;
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    if (mode !== 'stop' && data && scope && feed) {
      // Live: data and scan line come from the plant; a finished sweep becomes
      // an earlier run, or ends a Single; past is a run cut short by a new one.
      const s = feed(), names = Object.keys(data.signals).join();
      if (s.past) past = [s.past, ...past].slice(0, RUNS - 1);
      if (s.done && mode === 'single') { data = s.done; tScan = win()[1]; mode = 'stop'; handlers.onStopped?.(); }
      else { if (s.done) past = [s.done, ...past].slice(0, RUNS - 1); data = s.data; tScan = s.scan; }
      if (Object.keys(data.signals).join() !== names) renderBadges();
    } else if (mode !== 'stop' && data && scope && run) {
      // Auto-tune's run: it lasts its own length at the speed (the tuner
      // simulated it already), whatever the screen's width. When it ends, the
      // tuner may start the next one at once (handlers.onStopped); the time
      // left of this frame counts for that one.
      const sp = handlers.speed?.() ?? 1;
      const c = sweepClock(run.t, 0, run.T, sp, dt, true);
      run.t = c.scan;
      const [w0, w1] = win();
      tScan = Math.min(Math.max(run.t, w0), w1);
      // At ∞ the tuner counted the run as it computed it; shown at once, it adds nothing.
      handlers.onSweep?.(now / 1000, sp === AS_FAST ? 0 : c.advanced);
      if (c.ended) {
        const rest = sp === AS_FAST ? 0 : Math.max(0, Math.min(MAX_FRAME, dt) - c.advanced / sp);
        run = null;
        mode = 'stop';
        last = now - 1000 * rest;
        handlers.onStopped?.();
      }
    } else if (mode !== 'stop' && data && scope) {
      const [w0, w1] = win();
      const c = sweepClock(tScan, w0, w1, paceOf(handlers.speed?.() ?? 1, handlers.simRate?.()), dt, mode === 'single');
      tScan = c.scan;
      handlers.onSweep?.(now / 1000, c.advanced);
      if (c.ended) {
        if (mode === 'single') { mode = 'stop'; handlers.onStopped?.(); }
        // At ∞ the same run comes round many times a second: only a changed
        // run becomes an earlier one, so after an edit the run before it stays
        // to compare (at a finite speed every sweep fades them a step).
        else if ((handlers.speed?.() ?? 1) !== AS_FAST || past[0] !== data) keepRun();
      }
    }
    framing = false;
    const every = mode === 'stop' ? 0 : handlers.frameMs?.() ?? 0;
    if (!every || now - drawn >= every) { drawn = now; draw(); }
    if (mode !== 'stop') { if (!raf) raf = requestAnimationFrame(frame); handlers.onTime?.(); }
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
  // channel that shows a signal; in XY never channel 1, the horizontal axis.
  const targets = () => valueTargets(viewMode(), line, visible);
  // What XY needs to find its figure (drawing, and the sample under the pointer).
  const xyArgs = () => ({ P, data, scope, k: mode !== 'stop' ? indexAt(tScan) : data.t.length - 1, axis: axisChannel(), line, unitLabel, vy, win });
  // The time under the pointer, where the screen shows time across (Time,
  // Spectrogram), or of the XY figure's sample nearest it; else null.
  function hoverTime() {
    if (!hover || box || !data || !scope || region(hover.x, hover.y) !== 'plot') return null;
    const vm = viewMode();
    if (vm === 'time' || vm === 'spectrogram') return Math.max(0, Math.min(data.t[data.t.length - 1], xt(hover.x)));
    if (vm === 'xy') { const near = xyNearest(xyArgs(), hover.x, hover.y); return near ? data.t[near.j] : null; }
    return null;
  }
  // XY mode: channel 1's scale and position, around a screen column.
  function zoomX(sc, x, dir) {
    const ch = sc.channels[0], vc = vOfX(P, ch, x), kx = (x - P.l - P.w / 2) / P.dx;
    ch.scale = step125(ch.scale, dir);
    ch.offset = Number((kx * ch.scale - vc).toPrecision(6));
  }

  // The spectrogram's levels for one signal: [floor, ceiling] in dB, kept at
  // least 1 dB apart; stored in the scope view per signal, rounded to 0.1 dB,
  // in the unit the strip draws them in (with Above noise on, a signal
  // without noise is drawn, and set, in absolute dB).
  const noiseUnit = () => (strip ? strip.aboveNoise : !!scope.view?.aboveNoise);
  function setLevels(source, f, c) {
    const lv = [r1(f), r1(Math.max(c, f + 1))], above = noiseUnit();
    if (lv[1] - lv[0] < 1) lv[1] = r1(lv[0] + 1);
    handlers.edit((sc) => { sc.view = withLevels(sc.view, source, lv, above); });
  }
  function autoLevelsFor(source) {
    const above = noiseUnit();
    handlers.edit((sc) => { sc.view = withLevels(sc.view, source, null, above); });
  }
  // The spectrogram's colour: dB above the noise at each frequency, or absolute.
  function setAboveNoise(on) {
    handlers.edit((sc) => { sc.view = withAboveNoise(sc.view, on); });
    handlers.endEdit();
  }
  // Tells the controls (the typed levels) when the levels drawn change.
  function levelsChanged() {
    const sig = strip ? `${strip.source}|${strip.floor.toFixed(1)}|${strip.ceiling.toFixed(1)}|${strip.auto}|${strip.aboveNoise}` : '';
    if (sig !== levelsSig) { levelsSig = sig; handlers.onLevels?.(); }
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const stripDb = (y, lo, hi) => lo + ((S.b - y) / (S.b - S.t)) * (hi - lo);
  const stripY = (d) => S.b - ((d - strip.lo) / (strip.hi - strip.lo)) * (S.b - S.t);
  // What a press on the strip takes: a handle (within 6 px), the band
  // between them, or, above or below the band, the nearer handle, which
  // then jumps to the pointer.
  function stripPart(y) {
    const yc = stripY(strip.ceiling), yf = stripY(strip.floor);
    if (Math.abs(y - yc) <= 6 && Math.abs(y - yc) <= Math.abs(y - yf)) return ['ceiling', true];
    if (Math.abs(y - yf) <= 6) return ['floor', true];
    if (y > yc && y < yf) return ['both', true];
    return [y < yc ? 'ceiling' : 'floor', false];
  }

  let wheelAcc = 0, wheelTimer = null;
  canvas.addEventListener('wheel', (e) => {
    if (!scope || !data) return;
    e.preventDefault();
    const { x, y } = pos(e);
    const where = region(x, y);
    if (where === 'switch') return;
    // Shift turns the wheel sideways in some browsers: over the strip, either counts.
    wheelAcc += (where === 'strip' && !e.deltaY ? e.deltaX : e.deltaY) * (e.deltaMode === 1 ? 20 : 1);
    const steps = Math.trunc(wheelAcc / 60);
    if (!steps) return;
    wheelAcc -= steps * 60;
    if (where === 'strip') {
      // Wheel up raises the floor (Shift: the ceiling).
      if (!strip) return;
      const d = -steps * LEVEL_STEP, { floor: f, ceiling: c, lo, hi } = strip;
      if (e.shiftKey) setLevels(strip.source, f, clamp(c + d, f + 1, hi)); else setLevels(strip.source, clamp(f + d, lo, c - 1), c);
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => handlers.endEdit(), 400);
      return;
    }
    if (viewMode() === 'fft' || (viewMode() === 'spectrogram' && where !== 'xaxis')) {
      // Frequency axis: around the cursor (x in FFT, y in the spectrogram).
      const fd = freqData(), [f0, f1] = freqRange(scope, fd), fn = nyquist(fd);
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
    if (region(x, y) === 'switch') { gesture = { kind: 'switch' }; return; }
    if (region(x, y) === 'strip') {
      if (!strip) return;
      const [part, grab] = stripPart(y), at = stripDb(y, strip.lo, strip.hi);
      // The scale stays as it is while dragging, so the handle stays under the pointer.
      levelScale = [strip.lo, strip.hi];
      gesture = { kind: 'levels', part, y, moved: false, source: strip.source, lv: [strip.floor, strip.ceiling], at, off: grab && part !== 'both' ? at - (part === 'floor' ? strip.floor : strip.ceiling) : 0 };
      return;
    }
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
    if (gesture?.kind === 'levels') {
      if (!gesture.moved && Math.abs(p.y - gesture.y) < 2) return;
      gesture.moved = true;
      const [lo, hi] = levelScale, at = stripDb(p.y, lo, hi);
      let [f, c] = gesture.lv;
      if (gesture.part === 'both') { const d = clamp(at - gesture.at, lo - f, hi - c); f += d; c += d; }
      else if (gesture.part === 'floor') f = clamp(at - gesture.off, lo, c - 1);
      else c = clamp(at - gesture.off, f + 1, hi);
      canvas.style.cursor = gesture.part === 'both' ? 'grabbing' : 'ns-resize';
      setLevels(gesture.source, f, c);
      return;
    }
    if (gesture?.kind === 'pan') {
      const dx = p.x - gesture.x, dy = p.y - gesture.y;
      if (!gesture.moved && Math.hypot(dx, dy) < 3) return;
      gesture.moved = true;
      gesture.x = p.x; gesture.y = p.y;
      canvas.style.cursor = 'grabbing';
      if (viewMode() === 'fft') {
        const fd = freqData(), [f0, f1] = freqRange(scope, fd), fn = nyquist(fd), df = (-dx / P.w) * (f1 - f0);
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
    if (where === 'switch') canvas.style.cursor = 'pointer';
    else if (where === 'strip') canvas.style.cursor = strip ? (stripPart(p.y)[0] === 'both' ? 'grab' : 'ns-resize') : 'default';
    else canvas.style.cursor = hitLine(p.x, p.y) !== null ? 'grab' : where === 'xaxis' ? 'ew-resize' : where === 'yaxis' ? 'ns-resize' : 'crosshair';
    const ht = hoverTime();
    if (ht !== null && ht !== cursorT) { cursorT = ht; handlers.onTime?.(); }
    redraw();
  });
  const finish = (e) => {
    if (!gesture) return;
    levelScale = null;
    // The switch: released on it (a press that slides off does nothing).
    if (gesture.kind === 'switch') { const p = e && pos(e); if (p && region(p.x, p.y) === 'switch') setAboveNoise(!scope.view?.aboveNoise); }
    else if (gesture.kind === 'levels') { if (gesture.moved) handlers.endEdit(); }
    else if (gesture.kind === 'box') applyBox();
    else if (gesture.moved) handlers.endEdit();
    else if (gesture.hit === null && line !== null) selectLine(null);
    gesture = null;
    canvas.style.cursor = 'crosshair';
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', () => { box = null; gesture = null; levelScale = null; draw(); });
  // A double-click on the strip returns to automatic levels.
  canvas.addEventListener('dblclick', (e) => {
    const { x, y } = pos(e);
    if (region(x, y) !== 'strip' || !strip || !levelsOf(scope.view, strip.source, strip.aboveNoise)) return;
    autoLevelsFor(strip.source);
    handlers.endEdit();
  });
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
      const [f0, f1] = freqRange(scope, freqData()), fa = f0 + ((x0 - P.l) / P.w) * (f1 - f0), fb = f0 + ((x1 - P.l) / P.w) * (f1 - f0);
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

  function instant() {
    if (!scope) return { t: 0, from: 'edge' };
    const h = hoverTime();
    if (h !== null) return { t: h, from: 'cursor' };
    if (run) return { t: run.t, from: 'sweep' };  // Auto-tune's run: its own time, also beyond the screen
    if (mode !== 'stop') return { t: tScan, from: 'sweep' };
    if (cursorT !== null) return { t: cursorT, from: 'cursor' };
    return { t: win()[1], from: 'edge' };
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
    setScope(s, sel) {
      scope = s; selected = sel;
      // In XY, channel 1 is the X axis: a line selected on it in Time is released.
      if (line !== null && (line !== sel || (viewMode() === 'xy' && line === 0))) line = null;
      renderBadges(); draw();
    },
    setPreview(p) { preview = p; draw(); },
    // restart: a fresh sweep from the left edge. Single pressed while the
    // scope runs lets the sweep under way finish, then stops (singleFrom).
    setMode(m, { restart } = {}) {
      const fresh = restart ?? (m === 'single' ? singleFrom(mode).restart : false);
      if (fresh && scope) { if (m === 'single' && mode !== 'single' && (data?.t?.length ?? 0) > 1) keepRun(); tScan = win()[0]; }
      if (m !== 'stop') cursorT = null;
      mode = m;
      run = null;
      last = 0;
      kick();
      draw();
    },
    clearRuns() { past = []; draw(); },
    // A design settled on its own (a plan made in the background): the run
    // so far stays, faded, and the sweep starts again at the window's start,
    // so the new run is seen from its beginning. Call before setData.
    restartSweep() {
      if (mode === 'stop' || !scope || feed || run) return;
      keepRun();
      tScan = win()[0];
      last = 0;
      kick();
    },
    // Auto-tune: the earlier runs behind the one on screen, newest first.
    setPast(list) { past = list.filter(Boolean).slice(0, RUNS - 1); draw(); },
    // Auto-tune: run d (from t = 0) sweeps once across the screen at the
    // header's speed, the runs in list faded behind it, and lasts its own
    // length: a 5 s run takes 5 s at 1×, on any screen. Called as the run
    // before it ends (from handlers.onStopped), it goes on from that instant,
    // so no time is lost between runs.
    play(d, list) {
      simData = d;
      if (!feed) data = d;
      past = list.filter(Boolean).slice(0, RUNS - 1);
      if (line !== null && !visible(line)) line = null;
      renderBadges();
      mode = 'single';
      run = { t: 0, T: d.t.length ? d.t[d.t.length - 1] : 0 };
      tScan = scope ? win()[0] : 0;
      if (!framing) last = performance.now();
      kick();
    },
    // Auto-tune: the run on screen (or the run given) becomes the newest faded one.
    keep(d = data) { if (d) past = [d, ...past].slice(0, RUNS - 1); draw(); },
    get data() { return data; },
    releaseLine() { if (line === null) return false; selectLine(null); return true; },
    // The instant other views follow: the cursor's time (where the screen
    // shows time across, or the XY sample under it), else the scan line while
    // sweeping, else where the cursor last pointed, else the right edge of
    // the screen. timeFrom() says which one it is.
    time() { return instant().t; },
    timeFrom() { return instant().from; },
    get mode() { return mode; },
    // The spectrogram's levels as drawn: { source, unit, floor, ceiling, auto,
    // aboveNoise (the levels are dB above the noise, not of the unit) }, or null.
    get levels() { return strip && { source: strip.source, unit: strip.unit, floor: strip.floor, ceiling: strip.ceiling, auto: strip.auto, aboveNoise: strip.aboveNoise }; },
    // The spectrogram's colour: dB above the noise at each frequency (true) or absolute.
    setAboveNoise,
    // Sets one signal's levels ([floor, ceiling] dB), or automatic with null.
    setLevels(source, pair) { if (pair) setLevels(source, pair[0], pair[1]); else autoLevelsFor(source); handlers.endEdit(); },
  };
}
