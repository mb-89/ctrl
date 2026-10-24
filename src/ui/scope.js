// The scope: output y(t) over the reference r(t), and effort u(t) below, for
// every checked candidate. A scan line sweeps the period like an oscilloscope:
// left of it the selected trace is drawn bright, right of it as the fading
// previous sweep. Hovering moves the scan line; clicking a trace selects it.

import { fmt } from '../core/project.js';

const PAD = { l: 50, r: 14, t: 22, b: 24, gap: 26 };
const SPLIT = 0.64;

export function createScope(wrap, handlers) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Step response scope: output and control effort over time');
  wrap.append(canvas);
  const ctx = canvas.getContext('2d');
  const layer = document.createElement('canvas');
  const lctx = layer.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  let data = null;
  let colors = {};
  let geo = null;
  let dirty = true;
  let playing = false, sweepSeconds = 3, phase = 1;
  let hoverT = null, lastFrame = 0, raf = 0;

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    colors = { screen: v('--screen'), ink: v('--ink'), ink2: v('--ink-2'), muted: v('--muted'), grid: v('--grid'), axis: v('--axis'), bad: v('--bad'), scan: v('--scan'), mono: v('--mono') };
    dirty = true;
  }

  function resize() {
    const rect = wrap.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = Math.max(10, rect.width); H = Math.max(10, rect.height);
    for (const c of [canvas, layer]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    dirty = true;
    draw();
  }

  function niceTicks(lo, hi, n) {
    const span = hi - lo;
    if (!(span > 0)) return [lo];
    const raw = span / n;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) ?? 10 * mag;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return out;
  }

  function range(arrays, extra) {
    let lo = Infinity, hi = -Infinity;
    for (const a of arrays) for (let i = 0; i < a.length; i++) { const v = a[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    for (const v of extra) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!Number.isFinite(lo)) { lo = -1; hi = 1; }
    if (hi - lo < 1e-9) { lo -= 0.5; hi += 0.5; }
    const pad = (hi - lo) * 0.08;
    return [lo - pad, hi + pad];
  }

  function computeGeo() {
    const x0 = PAD.l, x1 = W - PAD.r;
    const usable = H - PAD.t - PAD.b - PAD.gap;
    const yTop = PAD.t, yMid = PAD.t + usable * SPLIT, yBot = yMid + PAD.gap, yEnd = H - PAD.b;
    const { duration, ref, traces, spec } = data;
    const extra = [];
    if (spec.step) {
      const D = spec.step.to - spec.step.from;
      if (spec.overshootMax !== undefined) extra.push(spec.step.to + (spec.overshootMax / 100) * D);
    }
    // Ranges come from the reference and the selected trace; other traces may
    // widen them by at most their own span again, so one diverging run cannot
    // flatten the rest.
    const sel = traces.find((t) => t.selected) ?? traces[0];
    const clipTo = (base, all) => {
      const span = base[1] - base[0];
      return [Math.max(all[0], base[0] - span), Math.min(all[1], base[1] + span)];
    };
    const uLim = [0, spec.uMax, spec.uMin !== undefined ? spec.uMin : (spec.uMax !== undefined ? -spec.uMax : undefined)];
    const [ylo, yhi] = clipTo(range([ref, ...(sel ? [sel.y] : [])], extra), range([ref, ...traces.map((t) => t.y)], extra));
    const [ulo, uhi] = clipTo(range(sel ? [sel.u] : [], uLim), range(traces.map((t) => t.u), uLim));
    geo = {
      x0, x1, duration,
      sx: (t) => x0 + (t / duration) * (x1 - x0),
      tx: (x) => ((x - x0) / (x1 - x0)) * duration,
      out: { top: yTop, bot: yMid, lo: ylo, hi: yhi, sy: (v) => yMid - ((v - ylo) / (yhi - ylo)) * (yMid - yTop) },
      eff: { top: yBot, bot: yEnd, lo: ulo, hi: uhi, sy: (v) => yEnd - ((v - ulo) / (uhi - ulo)) * (yEnd - yBot) },
    };
  }

  function hatch(c) {
    const p = document.createElement('canvas');
    p.width = p.height = 8 * dpr;
    const q = p.getContext('2d');
    q.strokeStyle = colors.bad; q.globalAlpha = 0.35; q.lineWidth = dpr;
    q.beginPath(); q.moveTo(0, 8 * dpr); q.lineTo(8 * dpr, 0); q.stroke();
    const pat = c.createPattern(p, 'repeat');
    pat.setTransform?.(new DOMMatrix().scale(1 / dpr));
    return pat;
  }

  // Draws t/v as a polyline, collapsing points that share a pixel column to
  // their min and max so long runs stay fast.
  function series(c, t, v, pane, from = 0, to = t.length - 1) {
    const { sx } = geo, sy = pane.sy;
    c.beginPath();
    let started = false, col = -1, mn = 0, mx = 0, last = 0;
    const flush = () => {
      if (col < 0) return;
      if (mn !== mx) { c.lineTo(col, sy(mn)); c.lineTo(col, sy(mx)); }
      c.lineTo(col, sy(last));
    };
    for (let i = from; i <= to; i++) {
      const y = v[i];
      if (!Number.isFinite(y)) break;
      const x = Math.round(sx(t[i]) * 2) / 2;
      if (!started) { c.moveTo(x, sy(y)); started = true; col = x; mn = mx = last = y; continue; }
      if (x === col) { mn = Math.min(mn, y); mx = Math.max(mx, y); last = y; continue; }
      flush();
      col = x; mn = mx = last = y;
    }
    flush();
    c.stroke();
  }

  function clipPane(c, pane) {
    c.save();
    c.beginPath();
    c.rect(geo.x0, pane.top, geo.x1 - geo.x0, pane.bot - pane.top);
    c.clip();
  }

  function drawStatic() {
    const c = lctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    c.fillStyle = colors.screen;
    c.fillRect(0, 0, W, H);
    if (!data) return;
    computeGeo();
    const { x0, x1, sx } = geo;
    c.font = `10.5px ${colors.mono}`;
    c.lineWidth = 1;

    for (const [pane, name] of [[geo.out, 'OUTPUT  y'], [geo.eff, 'EFFORT  u']]) {
      c.strokeStyle = colors.grid;
      c.fillStyle = colors.muted;
      c.textAlign = 'right'; c.textBaseline = 'middle';
      for (const v of niceTicks(pane.lo, pane.hi, pane === geo.out ? 6 : 3)) {
        const y = Math.round(pane.sy(v)) + 0.5;
        c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke();
        c.fillText(fmt(v), x0 - 6, y);
      }
      for (const t of niceTicks(0, data.duration, Math.max(2, Math.floor((x1 - x0) / 80)))) {
        const x = Math.round(sx(t)) + 0.5;
        c.beginPath(); c.moveTo(x, pane.top); c.lineTo(x, pane.bot); c.stroke();
      }
      if (pane.lo < 0 && pane.hi > 0) {
        c.strokeStyle = colors.axis;
        const y = Math.round(pane.sy(0)) + 0.5;
        c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke();
      }
      c.strokeStyle = colors.axis;
      c.strokeRect(x0 + 0.5, pane.top + 0.5, x1 - x0 - 1, pane.bot - pane.top - 1);
      c.fillStyle = colors.muted;
      c.textAlign = 'left'; c.textBaseline = 'bottom';
      c.font = `600 10px ${colors.mono}`;
      c.fillText(name, x0, pane.top - 5);
      c.font = `10.5px ${colors.mono}`;
    }
    c.fillStyle = colors.muted;
    c.textAlign = 'center'; c.textBaseline = 'top';
    const xt = niceTicks(0, data.duration, Math.max(2, Math.floor((x1 - x0) / 80)));
    xt.forEach((t, i) => {
      const last = i === xt.length - 1;
      c.textAlign = last && sx(t) > x1 - 20 ? 'right' : 'center';
      c.fillText(last ? `${fmt(t)} s` : fmt(t), last && sx(t) > x1 - 20 ? x1 : sx(t), geo.eff.bot + 5);
    });

    drawSpec(c);

    // Reference
    clipPane(c, geo.out);
    c.strokeStyle = colors.ink; c.lineWidth = 1.5; c.globalAlpha = 0.85;
    c.setLineDash([]);
    series(c, data.t, data.ref, geo.out);
    c.restore();
    c.globalAlpha = 1;

    // Unselected traces, then the hovered one on top
    const order = data.traces.filter((t) => !t.selected).sort((a, b) => (a.hot === b.hot ? 0 : a.hot ? 1 : -1));
    for (const tr of order) {
      c.strokeStyle = tr.color;
      c.lineWidth = tr.hot ? 2 : 1.3;
      c.globalAlpha = tr.hot ? 1 : 0.55;
      clipPane(c, geo.out); series(c, tr.t, tr.y, geo.out); c.restore();
      clipPane(c, geo.eff); series(c, tr.t, tr.u, geo.eff); c.restore();
    }
    c.globalAlpha = 1;
    dirty = false;
  }

  function drawSpec(c) {
    const { spec } = data;
    const { sx, x0, x1 } = geo;
    const pat = hatch(c);
    const P = geo.out;
    const region = (pane, t0, t1, v0, v1) => {
      const xa = Math.max(x0, sx(t0)), xb = Math.min(x1, sx(t1));
      const ya = Math.max(pane.top, Math.min(pane.bot, pane.sy(v0))), yb = Math.max(pane.top, Math.min(pane.bot, pane.sy(v1)));
      if (xb <= xa || Math.abs(yb - ya) < 0.5) return;
      c.fillStyle = pat;
      c.fillRect(xa, Math.min(ya, yb), xb - xa, Math.abs(yb - ya));
    };
    const edge = (pane, t0, t1, v) => {
      const y = pane.sy(v);
      if (y < pane.top || y > pane.bot) return;
      c.strokeStyle = colors.bad; c.globalAlpha = 0.8; c.lineWidth = 1; c.setLineDash([4, 3]);
      c.beginPath(); c.moveTo(Math.max(x0, sx(t0)), y); c.lineTo(Math.min(x1, sx(t1)), y); c.stroke();
      c.setLineDash([]); c.globalAlpha = 1;
    };
    if (spec.step) {
      const { time, from, to, end } = spec.step;
      const D = to - from, s = Math.sign(D) || 1;
      const far = (dir) => (dir > 0 ? P.hi : P.lo);
      // settling band (always shown, faint)
      c.strokeStyle = colors.muted; c.globalAlpha = 0.5; c.setLineDash([2, 3]); c.lineWidth = 1;
      for (const v of [to + spec.band * Math.abs(D), to - spec.band * Math.abs(D)]) {
        const y = P.sy(v);
        c.beginPath(); c.moveTo(sx(time), y); c.lineTo(sx(end), y); c.stroke();
      }
      c.setLineDash([]); c.globalAlpha = 1;
      if (spec.overshootMax !== undefined) {
        const lim = to + s * (spec.overshootMax / 100) * Math.abs(D);
        region(P, time, end, lim, far(s)); edge(P, time, end, lim);
      }
      if (spec.undershootMax !== undefined) {
        const lim = from - s * (spec.undershootMax / 100) * Math.abs(D);
        region(P, time, end, lim, far(-s)); edge(P, time, end, lim);
      }
      if (spec.settleMax !== undefined && Number.isFinite(spec.settleMax)) {
        const ts = time + spec.settleMax;
        if (ts < end) {
          const hi = to + spec.band * Math.abs(D), lo = to - spec.band * Math.abs(D);
          region(P, ts, end, hi, P.hi); region(P, ts, end, lo, P.lo);
          c.strokeStyle = colors.bad; c.globalAlpha = 0.8; c.setLineDash([4, 3]);
          c.beginPath(); c.moveTo(sx(ts) + 0.5, P.top); c.lineTo(sx(ts) + 0.5, P.bot); c.stroke();
          c.setLineDash([]); c.globalAlpha = 1;
        }
      }
    }
    const E = geo.eff;
    if (spec.uMax !== undefined) {
      const lo = spec.uMin ?? -spec.uMax;
      region(E, 0, data.duration, spec.uMax, E.hi); edge(E, 0, data.duration, spec.uMax);
      region(E, 0, data.duration, lo, E.lo); edge(E, 0, data.duration, lo);
    }
    // Markers for events
    c.fillStyle = colors.ink2; c.font = `10px ${colors.mono}`; c.textAlign = 'center'; c.textBaseline = 'bottom';
    const mark = (t, text) => {
      const x = sx(t);
      c.beginPath(); c.moveTo(x - 4, P.bot); c.lineTo(x + 4, P.bot); c.lineTo(x, P.bot - 6); c.closePath(); c.fill();
      c.fillText(text, x, P.bot - 8);
    };
    if (spec.dist) mark(spec.dist.time, 'd');
  }

  function indexAt(t) {
    const tt = data.t;
    if (tt.length < 2) return 0;
    const dt = tt[1] - tt[0];
    return Math.max(0, Math.min(tt.length - 1, Math.round(t / dt)));
  }

  function draw() {
    if (!W) return;
    if (dirty) drawStatic();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layer, 0, 0);
    if (!data || !geo) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sel = data.traces.find((t) => t.selected);
    const scanT = hoverT ?? (playing ? phase * data.duration : null);
    if (sel) {
      const k = scanT === null ? sel.t.length - 1 : indexAt(scanT);
      ctx.strokeStyle = sel.color; ctx.lineWidth = 2.25;
      for (const pane of [geo.out, geo.eff]) {
        const v = pane === geo.out ? sel.y : sel.u;
        clipPane(ctx, pane);
        ctx.globalAlpha = 1; series(ctx, sel.t, v, pane, 0, k);
        if (k < sel.t.length - 1) { ctx.globalAlpha = 0.28; series(ctx, sel.t, v, pane, k, sel.t.length - 1); }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
    if (scanT !== null) {
      const x = Math.round(geo.sx(scanT)) + 0.5;
      ctx.strokeStyle = colors.scan; ctx.globalAlpha = 0.45; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, geo.out.top); ctx.lineTo(x, geo.out.bot); ctx.moveTo(x, geo.eff.top); ctx.lineTo(x, geo.eff.bot); ctx.stroke();
      ctx.globalAlpha = 1;
      if (sel) {
        const k = indexAt(scanT);
        const dot = (pane, v) => {
          if (!Number.isFinite(v)) return;
          const y = pane.sy(v);
          if (y < pane.top || y > pane.bot) return;
          ctx.fillStyle = colors.screen; ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill();
          ctx.fillStyle = sel.color; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 7); ctx.fill();
        };
        dot(geo.out, sel.y[k]); dot(geo.eff, sel.u[k]);
        const text = `t ${fmt(data.t[k])} s   r ${fmt(data.ref[k])}   y ${fmt(sel.y[k])}   u ${fmt(sel.u[k])}`;
        ctx.font = `11px ${colors.mono}`;
        const w = ctx.measureText(text).width + 12;
        const bx = geo.x1 - w - 4, by = geo.out.top + 4;
        ctx.fillStyle = colors.screen; ctx.globalAlpha = 0.9; ctx.fillRect(bx, by, w, 18); ctx.globalAlpha = 1;
        ctx.fillStyle = colors.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(text, bx + 6, by + 9);
      }
    }
  }

  function loop(now) {
    raf = 0;
    const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    if (playing && hoverT === null) { phase += dt / sweepSeconds; if (phase > 1) phase -= 1; }
    draw();
    if (playing) raf = requestAnimationFrame(loop);
    else lastFrame = 0;
  }
  function kick() { if (!raf) raf = requestAnimationFrame(loop); }

  canvas.addEventListener('pointermove', (e) => {
    if (!geo) return;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    hoverT = x >= geo.x0 && x <= geo.x1 ? geo.tx(x) : null;
    kick();
  });
  canvas.addEventListener('pointerleave', () => { hoverT = null; kick(); });
  canvas.addEventListener('click', (e) => {
    if (!geo || !data) return;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < geo.x0 || x > geo.x1) return;
    const k = indexAt(geo.tx(x));
    let best = null;
    for (const tr of data.traces) {
      for (const [pane, v] of [[geo.out, tr.y], [geo.eff, tr.u]]) {
        if (y < pane.top || y > pane.bot || !Number.isFinite(v[k])) continue;
        const d = Math.abs(pane.sy(v[k]) - y);
        if (d < 12 && (!best || d < best.d)) best = { d, idx: tr.idx };
      }
    }
    if (best) handlers.onPick(best.idx);
  });

  new ResizeObserver(resize).observe(wrap);
  readColors();
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener?.('change', () => { readColors(); draw(); });
  new MutationObserver(() => { readColors(); draw(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  document.fonts?.ready.then(() => { dirty = true; draw(); });

  return {
    setData(d) { data = d; dirty = true; draw(); },
    setSweep(opts) {
      if ('seconds' in opts) sweepSeconds = opts.seconds;
      if ('playing' in opts) { playing = opts.playing; if (!playing) phase = 1; }
      kick();
    },
    get playing() { return playing; },
  };
}
