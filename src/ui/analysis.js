// Tab 5, Analysis: what control engineers read from a loop, computed from the
// plant a Controller block sees (linearised at an operating point) and the
// controller's own linear law, discrete at its sample time Ts as the
// simulation runs it (the person, 2026-10-24: root locus, Ortskurve, Bode,
// stability diagrams). Key numbers at the left; root locus, Bode, Nyquist and
// the linear step response at the right. Hovering the Bode plot marks the
// same frequency on the Nyquist curve. The X–Y plot is the scope's XY mode.
// Research and thresholds: design/research/analysis.md; core: core/analysis.js.

import { analyzeLoop, stepResponse, sOf, respondAt } from '../core/analysis.js';
import { createPlot, extent, PLOT_COLORS } from './plots.js';
import { CHANNEL_COLORS } from './display.js';
import { num } from './units.js';

const OPS = [
  { key: 'origin', label: 'At rest', title: 'All states and u at 0 (the pendulums upright)' },
  { key: 'initial', label: 'Start', title: 'The state the run starts from' },
  { key: 't', label: 'Scope time', title: 'The state at the time under the cursor, or at the end of the screen' },
];
const [C_L, C_CL, C_OL, C_U] = CHANNEL_COLORS;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const deg = (r) => (r * 180) / Math.PI;

// Good / fair / poor against the usual ranges (Åström & Murray §9.3,
// Skogestad §2.4.3), always with a word, never colour alone.
const GRADES = { good: ['✓', 'good'], fair: ['!', 'fair'], poor: ['✕', 'poor'] };
const grade = (g) => (g ? `<span class="grade grade-${g}" title="${GRADES[g][1]}">${GRADES[g][0]} ${GRADES[g][1]}</span>` : '');
const gradeMs = (ms) => (ms <= 1.4 ? 'good' : ms <= 2 ? 'fair' : 'poor');
const gradePm = (pm) => (pm >= 45 ? 'good' : pm >= 30 ? 'fair' : 'poor');
const gradeGm = (gm) => (gm >= 2.5 ? 'good' : gm >= 1.7 ? 'fair' : 'poor');

// Log-compressed radius for the Nyquist plot: unchanged up to 1, then
// 1 + ln ρ, so integrators and large gains fit while −1 stays put.
const squash = (re, im) => { const r = Math.hypot(re, im); if (!(r > 1)) return [re, im]; const k = (1 + Math.log(r)) / r; return [re * k, im * k]; };

// Step metrics of the linear response: final value, overshoot, 2 % settling.
function stepMetrics(st) {
  const y = st.y, yf = y.at(-1);
  if (!Number.isFinite(yf) || Math.abs(yf) < 1e-12) return { yf };
  const peak = Math.max(...y.map((v) => v / yf));
  let k = y.length - 1;
  while (k > 0 && Math.abs(y[k - 1] / yf - 1) <= 0.02) k--;
  return { yf, overshoot: Math.max(0, (peak - 1) * 100), settle: st.t[k], uPeak: Math.max(...st.u.map(Math.abs)) };
}

export function createAnalysisTab(host, app) {
  let target = null, op = 'origin', plane = 's', cursorW = null, last = null, lastKey = '';
  // Wheel zoom of the locus and the Nyquist plot (1 = the automatic view).
  const zoom = { locus: 1, nyq: 1 };

  host.innerHTML = `
    <div class="an">
      <section class="gcol an-side" aria-label="Key numbers">
        <div class="ghead"><h3 class="glabel">Analysis</h3></div>
        <div id="an-blocks" class="ctblocks"></div>
        <div class="an-op" role="group" aria-label="Operating point">${OPS.map((o) => `<button class="key small" data-op="${o.key}" title="${o.title}">${o.label}</button>`).join('')}</div>
        <div id="an-verdict" class="an-verdict"></div>
        <table class="kw" id="an-kw"></table>
        <div id="an-notes" class="phelp"></div>
      </section>
      <div class="an-grid" id="an-grid">
        <figure class="an-fig"><figcaption><span>Root locus · poles</span><span class="an-tg"><button class="key small" data-plane="s">s</button><button class="key small" data-plane="z">z</button></span></figcaption><canvas id="an-locus" aria-label="Root locus"></canvas></figure>
        <figure class="an-fig"><figcaption><span>Bode · open loop L</span><span id="an-bode-read" class="dim"></span></figcaption><canvas id="an-mag" aria-label="Bode magnitude"></canvas><canvas id="an-phase" aria-label="Bode phase"></canvas></figure>
        <figure class="an-fig"><figcaption><span>Nyquist · Ortskurve of L</span><span id="an-nyq-read" class="dim"></span></figcaption><canvas id="an-nyq" aria-label="Nyquist plot"></canvas></figure>
        <figure class="an-fig"><figcaption><span>Step r → y · linear model</span><span id="an-step-read" class="dim"></span></figcaption><canvas id="an-step" aria-label="Step response"></canvas></figure>
      </div>
    </div>
    <div class="ctempty" id="an-empty" hidden></div>`;
  const $ = (s) => host.querySelector(s);
  const plots = { locus: createPlot($('#an-locus')), mag: createPlot($('#an-mag')), phase: createPlot($('#an-phase')), nyq: createPlot($('#an-nyq')), step: createPlot($('#an-step')) };

  // Every Controller block, at any depth.
  function controllers() {
    const out = [], d = app.project.system.plant?.type === 'diagram' ? app.project.system.plant.diagram : null;
    const walk = (dd, path, where) => {
      for (const b of dd.blocks) {
        if (b.type === 'controller') out.push({ path: [...path, b.id], block: b, where: [...where, b.name ?? b.id].join(' / ') });
        if (b.type === 'subsystem') walk(b.diagram, [...path, b.id], [...where, b.name ?? b.id]);
      }
    };
    if (d) walk(d, [], []);
    return out;
  }

  host.querySelectorAll('[data-op]').forEach((b) => b.addEventListener('click', () => { op = b.dataset.op; render(); }));
  host.querySelectorAll('[data-plane]').forEach((b) => b.addEventListener('click', () => { plane = b.dataset.plane; draw(); }));
  for (const id of ['#an-mag', '#an-phase']) {
    const c = $(id);
    c.addEventListener('pointermove', (e) => {
      const P = plots.mag.P;
      if (!last?.res || !P) return;
      const r = c.getBoundingClientRect(), x = e.clientX - r.left, w = last.res.fd.w;
      const f = (x - P.l) / (P.r - P.l);
      cursorW = f < 0 || f > 1 ? null : w[0] * (w.at(-1) / w[0]) ** f;
      draw();
    });
    c.addEventListener('pointerleave', () => { cursorW = null; draw(); });
  }

  for (const [id, k] of [['#an-locus', 'locus'], ['#an-nyq', 'nyq']]) {
    $(id).addEventListener('wheel', (e) => { e.preventDefault(); zoom[k] = Math.min(1e3, Math.max(1e-3, zoom[k] * 1.25 ** Math.sign(e.deltaY))); draw(); }, { passive: false });
    $(id).addEventListener('dblclick', () => { zoom[k] = 1; draw(); });
    $(id).title = 'Wheel to zoom, double-click for the automatic view';
  }

  // The operating point as the provider takes it.
  const opSpec = () => (op === 't' ? { t: app.scopeTime?.() ?? 0 } : op);

  function compute() {
    const all = controllers();
    const c = all.find((x) => target && x.path.join('/') === target.join('/')) ?? all[0];
    if (!c) return { empty: 'This system has no Controller block. Add one in the Plant tab, wire the reference to its first input and the measurements to the others.' };
    target = c.path;
    if (!app.loopModel) return { c, all, error: 'The analysis needs the plant a block sees, linearised at an operating point. That comes with the design layer.' };
    const spec = opSpec();
    const key = JSON.stringify([app.project.system, c.path, spec]);
    if (key === lastKey && last) return last;
    lastKey = key;
    try {
      const m = app.loopModel(c.path, spec);
      const res = analyzeLoop(m.plant, m.ctrl, m.Ts);
      const T = Math.min(20, Math.max(2, 8 / Math.max(1e-3, ...res.clPoles.map((p) => -p.s.re).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b).slice(0, 1))));
      const st = res.stable ? stepResponse(m.plant, m.ctrl, m.Ts, Math.min(4000, Math.round(T / m.Ts))) : null;
      last = { c, all, m, res, st, sm: st ? stepMetrics(st) : null };
    } catch (err) {
      last = { c, all, error: err.message };
    }
    return last;
  }

  function renderSide(v) {
    $('#an-blocks').innerHTML = v.all?.length > 1
      ? v.all.map((x) => `<button class="sigkey ${x === v.c ? 'on' : ''}" data-path="${esc(x.path.join('/'))}">${esc(x.where)}</button>`).join('')
      : v.c ? `<div class="ctname">${esc(v.c.where)} · ${esc(v.c.block.variants?.[v.c.block.variant ?? 0]?.name ?? '')}</div>` : '';
    $('#an-blocks').querySelectorAll('[data-path]').forEach((el) => el.addEventListener('click', () => { target = el.dataset.path.split('/'); render(); }));
    host.querySelectorAll('[data-op]').forEach((b) => { b.classList.toggle('lit-view', b.dataset.op === op); b.setAttribute('aria-pressed', String(b.dataset.op === op)); });
    if (!v.res) {
      $('#an-verdict').innerHTML = '';
      $('#an-kw').innerHTML = '';
      $('#an-notes').textContent = v.error ?? '';
      return;
    }
    const { res, m, sm } = v, g = res.margins, Ts = m.Ts;
    $('#an-verdict').innerHTML = res.stable
      ? `<span class="grade grade-good">✓ stable</span> <span class="dim">every closed-loop pole inside the unit circle</span>`
      : `<span class="grade grade-poor">✕ unstable</span> <span class="dim">${res.Z} closed-loop pole${res.Z > 1 ? 's' : ''} outside the unit circle</span>`;
    const rows = [];
    const row = (k, val, extra = '', title = '') => rows.push(`<tr title="${esc(title)}"><th>${k}</th><td>${val}</td><td>${extra}</td></tr>`);
    const gm = Number.isFinite(g.gmUp) ? `×${num(g.gmUp, 3)} (${num(20 * Math.log10(g.gmUp), 3)} dB)` : '∞';
    row('Gain margin', g.gmDown > 0 ? `×${num(g.gmDown, 3)} … ${gm}` : gm, Number.isFinite(g.gmUp) ? grade(gradeGm(g.gmUp)) : '', 'The loop gain may change by these factors before the loop crosses −1');
    row('Phase margin', Number.isFinite(g.pm) ? `${num(g.pm, 3)}° at ${num(g.wc, 3)} rad/s` : '—', Number.isFinite(g.pm) ? grade(gradePm(g.pm)) : '', 'At the crossover |L| = 1, the phase left before −180°');
    row('Delay margin', Number.isFinite(g.dm) ? `${num(g.dm * 1000, 3)} ms (${num(g.dmSamples, 3)} Ts)` : '—', '', 'The extra dead time the loop tolerates');
    row('Ms = max |S|', `${num(g.ms, 3)} at ${num(g.wMs, 3)} rad/s`, grade(gradeMs(g.ms)), 'Peak sensitivity; 1/Ms is the closest approach to −1');
    row('Mt = max |T|', `${num(g.mt, 3)}`, '', 'Peak complementary sensitivity');
    if (res.slowest) {
      const s = res.slowest.s;
      row('Slowest pole', `τ = ${num(-1 / s.re, 3)} s`, '', `s = ${num(s.re, 3)} ${s.im >= 0 ? '+' : '−'} ${num(Math.abs(s.im), 3)}j`);
    }
    row('Least damping', `ζ = ${num(res.zetaMin, 3)}`, res.zetaMin < 1 ? grade(res.zetaMin >= 0.5 ? 'good' : res.zetaMin >= 0.25 ? 'fair' : 'poor') : '', 'Smallest damping ratio of the oscillating closed-loop poles');
    row('Nyquist', `P ${res.P} · N ${res.N} · Z ${res.Z}`, '', 'P open-loop poles outside the unit circle, N clockwise encirclements of −1, Z = N + P closed-loop poles outside');
    if (sm?.overshoot !== undefined) row('Step (linear)', `${num(sm.overshoot, 3)} % overshoot, settles ${num(sm.settle, 3)} s`, '', `final value ${num(sm.yf, 4)}`);
    $('#an-kw').innerHTML = rows.join('');
    const notes = [
      `${m.opLabel ?? ''}${m.opLabel ? ' · ' : ''}${m.variantName ?? ''} · Ts ${num(Ts * 1000, 3)} ms`,
      ...(res.L.delaySamples?.some((d) => d) ? [`dead time: ${res.L.delaySamples.map((d) => `${d} Ts`).join(', ')}, exact in discrete time`] : []),
      `Linear: u is assumed inside its limits${Number.isFinite(sm?.uPeak) ? ` (in the step u peaks at ${num(sm.uPeak, 3)} per unit of r)` : ''}; the step goes through the prefilter on r, which is outside the loop.`,
      ...(m.warnings ?? []),
    ];
    $('#an-notes').innerHTML = notes.map((n) => `<div>${esc(n)}</div>`).join('');
  }

  // Root locus in the s-plane (s = ln z / Ts) or the z-plane.
  function drawLocus(v) {
    const p = plots.locus, { res, m } = v, Ts = m.Ts;
    const map = plane === 's' ? (z) => { const s = sOf(z, Ts); return Number.isFinite(s.re) ? [s.re, s.im] : null; } : (z) => [z.re, z.im];
    let ax, hidden = 0;
    if (plane === 'z') ax = { x0: -1.25 / zoom.locus, x1: 1.25 / zoom.locus, y0: -1.25 / zoom.locus, y1: 1.25 / zoom.locus };
    else {
      // The region the loop works in: poles up to ten times the crossover
      // (or the slowest pole); faster ones (an armature, a derivative filter)
      // are counted, not drawn.
      const pts = [...res.olPoles, ...res.clPoles.map((q) => q.z)].map(map).filter(Boolean);
      const mags = res.clPoles.map((q) => Math.hypot(q.s.re, q.s.im)).filter((x) => Number.isFinite(x) && x > 1e-9).sort((a, b) => a - b);
      const lim = 10 * Math.max(Number.isFinite(res.margins.wc) ? res.margins.wc : 0, mags[0] ?? 1);
      const near = pts.filter((q) => Math.hypot(q[0], q[1]) <= lim);
      hidden = res.clPoles.filter((q) => Math.hypot(q.s.re, q.s.im) > lim).length;
      const R = (Math.max(1e-6, ...near.map((q) => Math.hypot(q[0], q[1]))) * 1.3) / zoom.locus;
      ax = { x0: -R, x1: 0.35 * R, y0: -0.8 * R, y1: 0.8 * R };
    }
    p.frame({ ...ax, equal: true, xlabel: plane === 's' ? 'Re s' : 'Re z', ylabel: plane === 's' ? 'Im s' : 'Im z' });
    p.clip(() => {
      const g = p.g;
      // Stability boundary and, in s, the band edges ±π/Ts.
      if (plane === 'z') {
        const th = Array.from({ length: 181 }, (_, i) => (i / 180) * 2 * Math.PI);
        p.line(th.map(Math.cos), th.map(Math.sin), { color: PLOT_COLORS.axis, width: 1.2 });
      } else {
        // ζ = 0.7 rays.
        const c = Math.cos(Math.acos(0.7)), s = Math.sin(Math.acos(0.7)), R = Math.max(Math.abs(ax.x0), Math.abs(ax.y1)) * 2;
        p.line([0, -R * c], [0, R * s], { color: PLOT_COLORS.grid, width: 1, dash: [3, 4] });
        p.line([0, -R * c], [0, -R * s], { color: PLOT_COLORS.grid, width: 1, dash: [3, 4] });
      }
      g.globalAlpha = 0.55;
      for (const { poles } of res.locus) for (const z of poles) { const q = map(z); if (q) p.mark(q[0], q[1], { shape: 'dot', color: C_L, size: 2.4 }); }
      g.globalAlpha = 1;
      for (const z of res.olPoles) { const q = map(z); if (q) p.mark(q[0], q[1], { shape: 'x', color: C_U, size: 5 }); }
      for (const { z } of res.clPoles) { const q = map(z); if (q) p.mark(q[0], q[1], { shape: 'dot', color: C_CL, size: 8 }); }
    });
    p.text(ax.x0, ax.y0, ` × open loop  ● closed loop  · gain ×0.01…×100${hidden ? `  · ${hidden} faster off the plot` : ''}`, { base: 'bottom', dy: -4, dx: 4 });
  }

  function drawBode(v) {
    const { res, m } = v, fd = res.fd, g = res.margins;
    const dB = fd.mag.map((x) => 20 * Math.log10(x));
    const [d0, d1] = extent(dB.filter((x) => x > -200), 0.08);
    const a = plots.mag.frame({ x0: fd.w[0], x1: fd.w.at(-1), xlog: true, y0: Math.max(d0, -120), y1: Math.min(d1, 160), ylabel: '|L| dB' });
    plots.mag.clip(() => {
      plots.mag.line([a.x0, a.x1], [0, 0], { color: PLOT_COLORS.axis, width: 1, dash: [4, 3] });
      plots.mag.line(fd.w, dB, { color: C_L, width: 1.8 });
      for (const c of g.gainCrossings) plots.mag.mark(c.w, 0, { shape: 'o', color: C_CL, size: 4 });
      for (const c of g.phaseCrossings) {
        plots.mag.line([c.w, c.w], [20 * Math.log10(c.mag), 0], { color: C_U, width: 1.5 });
        // Only the crossings that bound the gain interval get a label.
        if (c.gm === g.gmUp || c.gm === g.gmDown) plots.mag.text(c.w, 20 * Math.log10(c.mag) / 2, `GM ×${num(c.gm, 3)}`, { color: C_U, dx: 5 });
      }
      if (cursorW) plots.mag.line([cursorW, cursorW], [a.y0, a.y1], { color: PLOT_COLORS.ink, width: 1, alpha: 0.6 });
    });
    const [p0, p1] = extent(fd.phase, 0.08);
    const b = plots.phase.frame({ x0: fd.w[0], x1: fd.w.at(-1), xlog: true, y0: Math.min(p0, -190), y1: Math.max(p1, -80), xlabel: `ω rad/s · Nyquist ${num(Math.PI / m.Ts, 3)}`, ylabel: '∠L °' });
    plots.phase.clip(() => {
      for (let k = Math.ceil((b.y0 + 180) / 360); k * 360 - 180 <= b.y1; k++) plots.phase.line([b.x0, b.x1], [k * 360 - 180, k * 360 - 180], { color: PLOT_COLORS.axis, width: 1, dash: [4, 3] });
      plots.phase.line(fd.w, fd.phase, { color: C_L, width: 1.8 });
      for (const c of g.gainCrossings) {
        const ph = respondPhase(fd, c.w);
        plots.phase.line([c.w, c.w], [ph, ph - c.pm], { color: C_CL, width: 1.5 });
        plots.phase.text(c.w, ph - c.pm / 2, `PM ${num(c.pm, 3)}°`, { color: C_CL, dx: -5, align: 'right' });
      }
      if (cursorW) plots.phase.line([cursorW, cursorW], [b.y0, b.y1], { color: PLOT_COLORS.ink, width: 1, alpha: 0.6 });
    });
    const at = cursorW ? respondAt(res.L, cursorW) : null;
    $('#an-bode-read').textContent = at ? `ω ${num(cursorW, 3)} rad/s · |L| ${num(20 * Math.log10(Math.hypot(at.re, at.im)), 3)} dB · ∠ ${num(deg(Math.atan2(at.im, at.re)), 3)}°` : 'hover for a frequency';
  }
  // The unwrapped phase at ω, interpolated on the grid.
  function respondPhase(fd, w) {
    const i = Math.max(1, fd.w.findIndex((x) => x >= w));
    const f = (Math.log(w) - Math.log(fd.w[i - 1])) / (Math.log(fd.w[i]) - Math.log(fd.w[i - 1]));
    return fd.phase[i - 1] + f * (fd.phase[i] - fd.phase[i - 1]);
  }

  function drawNyquist(v) {
    const p = plots.nyq, { res } = v, fd = res.fd, g = res.margins;
    const pts = fd.re.map((re, i) => squash(re, fd.im[i]));
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    // Around −1, where the margins are read; the wheel zooms out to the rest.
    const z = zoom.nyq;
    p.frame({ x0: -1 - 2.2 / z, x1: -1 + 2.6 / z, y0: -2 / z, y1: 2 / z, equal: true, xlabel: 'Re L', ylabel: 'Im L  (|L| > 1: 1 + ln|L|)' });
    p.clip(() => {
      const th = Array.from({ length: 181 }, (_, i) => (i / 180) * 2 * Math.PI);
      p.line(th.map(Math.cos), th.map(Math.sin), { color: PLOT_COLORS.axis, width: 1 });
      // The Ms circle: |1 + L| = 1/Ms, the closest approach to −1.
      const ring = th.map((a) => squash(-1 + Math.cos(a) / g.ms, Math.sin(a) / g.ms));
      p.line(ring.map((q) => q[0]), ring.map((q) => q[1]), { color: C_U, width: 1.2, dash: [4, 3] });
      p.line(xs, ys.map((y) => -y), { color: C_L, width: 1.2, dash: [5, 4], alpha: 0.6 });
      p.line(xs, ys, { color: C_L, width: 1.8 });
      p.mark(-1, 0, { shape: '+', color: '#ffffff', size: 6, width: 2 });
      if (cursorW) { const at = respondAt(res.L, cursorW), q = squash(at.re, at.im); p.mark(q[0], q[1], { shape: 'o', color: '#ffffff', size: 5 }); }
    });
    $('#an-nyq-read').textContent = `P ${res.P} · N ${res.N} · Z ${res.Z} · Ms ${num(g.ms, 3)}`;
  }

  function drawStep(v) {
    const p = plots.step, { st, sm, res } = v;
    if (!st) { p.frame({ x0: 0, x1: 1, y0: -1, y1: 1 }); p.note(res?.stable === false ? 'unstable: no step response' : ''); $('#an-step-read').textContent = ''; return; }
    const [y0, y1] = extent([...st.y, 0, 1], 0.08);
    p.frame({ x0: 0, x1: st.t.at(-1), y0, y1, xunit: 's', ylabel: 'y (r = 1)' });
    p.clip(() => {
      p.line([0, st.t.at(-1)], [1, 1], { color: PLOT_COLORS.axis, width: 1, dash: [4, 3] });
      p.line(st.t, st.y, { color: C_CL, width: 1.8 });
    });
    $('#an-step-read').textContent = sm?.overshoot !== undefined ? `final ${num(sm.yf, 3)} · overshoot ${num(sm.overshoot, 3)} %` : '';
  }

  function draw() {
    const v = last;
    if (!v?.res || host.hidden || $('#an-grid').hidden) return;
    host.querySelectorAll('[data-plane]').forEach((b) => b.classList.toggle('lit-view', b.dataset.plane === plane));
    drawLocus(v); drawBode(v); drawNyquist(v); drawStep(v);
  }

  function render() {
    const v = compute();
    $('#an-empty').hidden = !v.empty;
    host.querySelector('.an').hidden = !!v.empty;
    if (v.empty) { $('#an-empty').textContent = v.empty; return; }
    renderSide(v);
    $('#an-grid').hidden = !v.res;
    if (!v.res) return;
    requestAnimationFrame(draw);
  }

  new ResizeObserver(() => { if (!host.hidden) draw(); }).observe(host);
  return {
    render,
    shown() { lastKey = ''; render(); },
    open(path) { target = path; },
  };
}
