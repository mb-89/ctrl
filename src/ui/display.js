// The scope display: a 10 × 8 division graticule, four channels, a real-time
// sweep, the generator's dashed preview, and a hover cursor. See
// design/output/instrument.md.

import { siUnit, num } from './units.js';

export const CHANNEL_COLORS = ['#f2c718', '#33d17a', '#4ea6ff', '#ff5ca8'];
export const SOURCE_LABEL = { r: 'r  reference', y: 'y  output', u: 'u  effort', e: 'e  error', ym: 'ym measured', d: 'd  disturbance' };
const DIVX = 10, DIVY = 8;

export function createDisplay(root, handlers) {
  const status = root.querySelector('.status');
  const screen = root.querySelector('.screen');
  const badges = root.querySelector('.badges');
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Oscilloscope display');
  screen.append(canvas);
  const ctx = canvas.getContext('2d');
  const grid = document.createElement('canvas');
  const gctx = grid.getContext('2d');

  let W = 0, H = 0, dpr = 1;
  let data = null, scope = null, preview = null, selected = 0;
  let mode = 'stop', tScan = 0, last = 0, raf = 0, hover = null;

  function resize() {
    const r = screen.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = Math.max(20, r.width); H = Math.max(20, r.height);
    for (const c of [canvas, grid]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    drawGrid();
    draw();
  }

  function drawGrid() {
    const g = gctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0a0d10';
    g.fillRect(0, 0, W, H);
    const dx = W / DIVX, dy = H / DIVY;
    g.fillStyle = 'rgba(160, 175, 190, 0.32)';
    for (let i = 0; i <= DIVX; i++) for (let j = 0; j <= DIVY * 5; j++) g.fillRect(Math.round(i * dx) - 0.5, j * dy / 5 - 0.5, 1, 1);
    for (let j = 0; j <= DIVY; j++) for (let i = 0; i <= DIVX * 5; i++) g.fillRect(i * dx / 5 - 0.5, Math.round(j * dy) - 0.5, 1, 1);
    g.strokeStyle = 'rgba(160, 175, 190, 0.38)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, Math.round(H / 2) + 0.5); g.lineTo(W, Math.round(H / 2) + 0.5);
    g.moveTo(Math.round(W / 2) + 0.5, 0); g.lineTo(Math.round(W / 2) + 0.5, H);
    for (let i = 0; i <= DIVX * 5; i++) { const x = Math.round(i * dx / 5) + 0.5; g.moveTo(x, H / 2 - 3); g.lineTo(x, H / 2 + 3); }
    for (let j = 0; j <= DIVY * 5; j++) { const y = Math.round(j * dy / 5) + 0.5; g.moveTo(W / 2 - 3, y); g.lineTo(W / 2 + 3, y); }
    g.stroke();
    g.strokeStyle = 'rgba(160, 175, 190, 0.5)';
    g.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  const tx = (t) => ((t - scope.timebase.position) / scope.timebase.scale) * (W / DIVX);
  const xt = (x) => scope.timebase.position + (x / (W / DIVX)) * scope.timebase.scale;
  const vy = (ch, v) => H / 2 - ((v + ch.offset) / ch.scale) * (H / DIVY);

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
      if (x < -2 && i < to && tx(t[i + 1]) < -2) continue;
      if (!started) { c.moveTo(x, vy(ch, y)); started = true; col = x; mn = mx = lastV = y; continue; }
      if (x === col) { mn = Math.min(mn, y); mx = Math.max(mx, y); lastV = y; continue; }
      flush();
      if (x > W + 2) { col = null; break; }
      col = x; mn = mx = lastV = y;
    }
    flush();
    c.stroke();
  }

  function indexAt(t) {
    const tt = data.t;
    if (tt.length < 2) return 0;
    return Math.max(0, Math.min(tt.length - 1, Math.round(t / (tt[1] - tt[0]))));
  }

  function draw() {
    if (!W) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(grid, 0, 0);
    if (!data || !scope) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    ctx.lineJoin = 'round';
    const n = data.t.length - 1;
    const sweeping = mode !== 'stop';
    const k = sweeping ? indexAt(tScan) : n;

    scope.channels.forEach((ch, i) => {
      const v = data.signals[ch.source];
      if (!ch.on || !v) return;
      ctx.strokeStyle = CHANNEL_COLORS[i];
      ctx.lineWidth = 1.6;
      ctx.shadowColor = CHANNEL_COLORS[i];
      ctx.shadowBlur = 5;
      ctx.globalAlpha = 1;
      trace(ctx, data.t, v, ch, 0, k);
      if (k < n) { ctx.shadowBlur = 0; ctx.globalAlpha = 0.28; trace(ctx, data.t, v, ch, k, n); }
    });
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    if (preview) {
      const ch = scope.channels[preview.channel];
      ctx.setLineDash([3, 4]); ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(235, 240, 245, 0.75)';
      trace(ctx, data.t, preview.alone, ch, 0, n);
      ctx.setLineDash([7, 5]); ctx.lineWidth = 2; ctx.strokeStyle = CHANNEL_COLORS[preview.channel];
      trace(ctx, data.t, preview.sum, ch, 0, n);
      ctx.setLineDash([]);
      ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
      ctx.textBaseline = 'bottom';
      const tag = (v, text, color) => {
        const tEnd = Math.min(data.t[n], xt(W - 8));
        const j = indexAt(tEnd);
        const y = Math.max(14, Math.min(H - 4, vy(ch, v[j]) - 4));
        const w = ctx.measureText(text).width;
        ctx.fillStyle = 'rgba(10, 13, 16, 0.75)'; ctx.fillRect(Math.min(tx(tEnd), W - 6) - w - 6, y - 13, w + 6, 14);
        ctx.fillStyle = color; ctx.textAlign = 'right'; ctx.fillText(text, Math.min(tx(tEnd), W - 6) - 3, y);
      };
      tag(preview.sum, `r + ${preview.label}`, CHANNEL_COLORS[preview.channel]);
      tag(preview.alone, preview.label, 'rgba(235, 240, 245, 0.85)');
    }

    if (sweeping) {
      const x = Math.round(tx(tScan)) + 0.5;
      if (x >= 0 && x <= W) {
        ctx.strokeStyle = 'rgba(235, 240, 245, 0.35)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
    }

    // Ground markers: each channel's zero level on the left edge.
    ctx.font = '600 10px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    scope.channels.forEach((ch, i) => {
      if (!ch.on || !data.signals[ch.source]) return;
      const y0 = vy(ch, 0);
      const y = Math.max(8, Math.min(H - 8, y0));
      ctx.fillStyle = CHANNEL_COLORS[i];
      ctx.beginPath();
      ctx.moveTo(0, y - 7); ctx.lineTo(11, y - 7); ctx.lineTo(17, y); ctx.lineTo(11, y + 7); ctx.lineTo(0, y + 7); ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#0a0d10';
      ctx.fillText(y0 < 8 ? '↑' : y0 > H - 8 ? '↓' : String(i + 1), 7, y + 0.5);
    });

    if (hover !== null) {
      const x = Math.round(hover) + 0.5;
      const t = xt(hover);
      ctx.strokeStyle = 'rgba(235, 240, 245, 0.55)'; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); ctx.setLineDash([]);
      const rows = [[`t  ${siUnit(t, 's', 4)}`, 'rgba(235, 240, 245, 0.9)']];
      if (t >= 0 && t <= data.t[n]) {
        const j = indexAt(t);
        scope.channels.forEach((ch, i) => {
          const v = data.signals[ch.source];
          if (ch.on && v) rows.push([`${i + 1} ${ch.source.padEnd(2)} ${num(v[j])}`, CHANNEL_COLORS[i]]);
        });
      }
      ctx.font = '11.5px "IBM Plex Mono", ui-monospace, monospace';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      const w = Math.max(...rows.map(([s]) => ctx.measureText(s).width)) + 14;
      const bx = hover + 10 + w > W ? hover - 10 - w : hover + 10;
      ctx.fillStyle = 'rgba(10, 13, 16, 0.85)'; ctx.fillRect(bx, 8, w, rows.length * 16 + 8);
      ctx.strokeStyle = 'rgba(160, 175, 190, 0.4)'; ctx.strokeRect(bx + 0.5, 8.5, w - 1, rows.length * 16 + 7);
      rows.forEach(([s, c], i) => { ctx.fillStyle = c; ctx.fillText(s, bx + 7, 13 + i * 16); });
    }
    ctx.restore();
    renderStatus();
  }

  function renderStatus() {
    if (!scope || !data) return;
    const state = { run: ['run', 'Run'], stop: ['stop', 'Stop'], single: ['single', 'Single'] }[mode];
    const tb = scope.timebase;
    const rec = data.t[data.t.length - 1];
    status.innerHTML = `<span class="st st-${state[0]}">${state[1]}</span>
      <span>${siUnit(tb.scale, 's')}/div</span>
      <span class="dim">pos ${siUnit(tb.position, 's', 4)}</span>
      <span class="dim">record ${siUnit(rec, 's', 4)}</span>
      <span class="grow"></span>
      ${mode !== 'stop' ? `<span class="dim">t ${siUnit(tScan, 's', 3)}</span>` : ''}`;
  }

  function renderBadges() {
    if (!scope || !data) return;
    badges.innerHTML = scope.channels.map((ch, i) => {
      const has = !!data.signals[ch.source];
      const cls = ['badge', ch.on ? 'on' : 'off', i === selected ? 'sel' : '', has ? '' : 'nosig'].join(' ');
      return `<button class="${cls}" data-ch="${i}" style="--cc:${CHANNEL_COLORS[i]}" title="Channel ${i + 1}: ${SOURCE_LABEL[ch.source]}">
        <span class="num">${i + 1}</span><span class="src">${ch.source}</span>
        <span class="val">${has ? `${num(ch.scale)}/div` : 'no signal'}</span></button>`;
    }).join('');
    badges.querySelectorAll('[data-ch]').forEach((b) => b.addEventListener('click', () => handlers.onSelectChannel(Number(b.dataset.ch))));
  }

  function frame(now) {
    raf = 0;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (mode !== 'stop' && data) {
      tScan += dt;
      const rec = data.t[data.t.length - 1];
      if (tScan >= rec) {
        if (mode === 'single') { tScan = rec; mode = 'stop'; handlers.onStopped?.(); }
        else tScan %= rec;
      }
    }
    draw();
    if (mode !== 'stop') raf = requestAnimationFrame(frame);
    else last = 0;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

  canvas.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); hover = e.clientX - r.left; if (mode === 'stop') draw(); });
  canvas.addEventListener('pointerleave', () => { hover = null; if (mode === 'stop') draw(); });

  new ResizeObserver(resize).observe(screen);
  document.fonts?.ready.then(() => draw());

  return {
    setData(d) { data = d; if (data && tScan > data.t[data.t.length - 1]) tScan = 0; renderBadges(); draw(); },
    setScope(s, sel) { scope = s; selected = sel; renderBadges(); draw(); },
    setPreview(p) { preview = p; draw(); },
    setMode(m) {
      if (m === 'single') tScan = 0;
      mode = m;
      last = 0;
      kick();
      draw();
    },
    get mode() { return mode; },
  };
}
