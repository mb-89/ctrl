// Tab 5, Analysis: what control engineers read from a loop, computed from the
// plant a Controller block sees (linearised at an operating point) and the
// controller's own linear law, discrete at its sample time Ts as the
// simulation runs it (the person, 2026-10-24: root locus, Ortskurve, Bode,
// stability diagrams). Key numbers at the left; root locus, Bode, Nyquist and
// the linear step response at the right. Hovering the Bode plot marks the
// same frequency on the Nyquist curve. The X–Y plot is the scope's XY mode.
// Research and thresholds: design/research/analysis.md; core: core/analysis.js.
//
// From app it takes project, loopModel(path, op) → { plant, ctrl, Ts,
// opLabel, variantName, warnings }, scopeTime() and, if there,
// scopeTimeFrom() ('cursor', 'sweep' or 'edge'). It returns render, shown,
// open and followTime (called while the scope's time moves).

import { analyzeLoop, stepInfo, stepResponse, sPlanePoint, respondAt, phaseAt } from '../core/analysis.js';
import { createPlot, extent } from './plots.js';
import { palette as C } from './palette.js';
import { num } from './units.js';

const OPS = [
  { key: 'origin', label: 'At rest', title: 'All states and u at 0 (the pendulums upright)' },
  { key: 'initial', label: 'Start', title: 'The state the run starts from' },
  { key: 't', label: 'Scope time', title: "The state at the scope's time: under the cursor or where it last was, at the sweep while running (followed), or at the right edge of the screen" },
];
const FROM = { cursor: 'at the scope cursor', sweep: 'at the sweep, following it', edge: 'at the right edge of the screen' };
// The plots' series follow the scope's channel order (design-system.md):
// L, the open loop, first; the closed loop second; poles and margins fourth.
const C_L = () => C().ch[0], C_CL = () => C().ch[1], C_U = () => C().ch[3];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Good / fair / poor against the usual ranges (Åström & Murray §9.3,
// Skogestad §2.4.3), always with a word, never colour alone. Only a stable
// loop is graded: an unstable one has no margins to grade.
const GRADES = { good: ['✓', 'good'], fair: ['!', 'fair'], poor: ['✕', 'poor'] };
const TEXT = { good: 'text-ok', fair: 'text-warn', poor: 'text-bad' };
const grade = (g) => (g ? `<span class="grade ${TEXT[g]}" title="${GRADES[g][1]}">${GRADES[g][0]} ${GRADES[g][1]}</span>` : '');
const gradeMs = (ms) => (ms <= 1.4 ? 'good' : ms <= 2 ? 'fair' : 'poor');
const gradePm = (pm) => (pm >= 45 ? 'good' : pm >= 30 ? 'fair' : 'poor');
const gradeGm = (gm) => (gm >= 2.5 ? 'good' : gm >= 1.7 ? 'fair' : 'poor');

// Log-compressed radius for the Nyquist plot: unchanged up to 1, then
// 1 + ln ρ, so integrators and large gains fit while −1 stays put.
const squash = (re, im) => { const r = Math.hypot(re, im); if (!(r > 1)) return [re, im]; const k = (1 + Math.log(r)) / r; return [re * k, im * k]; };

export function createAnalysisTab(host, app) {
  let target = null, op = 'origin', plane = 's', cursorW = null, last = null, lastKey = '';
  // Axes the wheel set on the locus and the Nyquist plot (null: the automatic view).
  const view = { locus: null, nyq: null };

  host.innerHTML = `
    <div class="an">
      <section class="gcol an-side" aria-label="Key numbers">
        <div class="ghead"><h3 class="label">Analysis</h3></div>
        <div id="an-blocks" class="ctblocks"></div>
        <div class="seg seg-fill" role="group" aria-label="Operating point">${OPS.map((o) => `<button class="btn btn-sm" data-op="${o.key}" title="${esc(o.title)}">${o.label}</button>`).join('')}</div>
        <div id="an-verdict" class="note"></div>
        <table class="kw" id="an-kw"></table>
        <div id="an-notes" class="note"></div>
      </section>
      <div class="an-grid" id="an-grid">
        <figure class="bezel an-fig"><figcaption class="on-dark"><span>Root locus · poles</span><span class="seg" role="group" aria-label="Plane"><button class="btn btn-sm" data-plane="s" title="The s-plane">s</button><button class="btn btn-sm" data-plane="z" title="The z-plane">z</button></span></figcaption><canvas id="an-locus" aria-label="Root locus"></canvas></figure>
        <figure class="bezel an-fig"><figcaption class="on-dark"><span>Bode · open loop L</span><span id="an-bode-read" class="muted"></span></figcaption><canvas id="an-mag" aria-label="Bode magnitude"></canvas><canvas id="an-phase" aria-label="Bode phase"></canvas></figure>
        <figure class="bezel an-fig"><figcaption class="on-dark"><span>Nyquist · Ortskurve of L</span><span id="an-nyq-read" class="muted"></span></figcaption><canvas id="an-nyq" aria-label="Nyquist plot"></canvas></figure>
        <figure class="bezel an-fig"><figcaption class="on-dark"><span>Step r → y · linear model</span><span id="an-step-read" class="muted"></span></figcaption><canvas id="an-step" aria-label="Step response"></canvas></figure>
      </div>
    </div>
    <div class="notice note" id="an-empty" hidden></div>`;
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
  host.querySelectorAll('[data-plane]').forEach((b) => b.addEventListener('click', () => { plane = b.dataset.plane; view.locus = null; draw(); }));
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

  // As on the scope, the wheel zooms about the pointer: up zooms in.
  for (const [id, k] of [['#an-locus', 'locus'], ['#an-nyq', 'nyq']]) {
    const c = $(id);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = plots[k], ax = p.ax;
      if (!ax || !p.P || !e.deltaY) return;
      const r = c.getBoundingClientRect(), [x, y] = p.at(e.clientX - r.left, e.clientY - r.top), f = 1.25 ** Math.sign(e.deltaY);
      const span = (ax.x1 - ax.x0) * f;
      if (!(span > 1e-9 && span < 1e9)) return;
      view[k] = { x0: x + (ax.x0 - x) * f, x1: x + (ax.x1 - x) * f, y0: y + (ax.y0 - y) * f, y1: y + (ax.y1 - y) * f };
      draw();
    }, { passive: false });
    c.addEventListener('dblclick', () => { view[k] = null; draw(); });
    c.title = 'Wheel to zoom about the pointer (up: in), double-click for the automatic view';
  }

  // The operating point as the provider takes it.
  const opSpec = () => (op === 't' ? { t: app.scopeTime?.() ?? 0 } : op);
  // "Scope time" follows the scope's time (cursor, sweep): at most four times
  // a second, and counted from the end of the last analysis, which waits
  // twice as long as that one took, so a slow loop (a long dead time) takes
  // at most a third of the page's time instead of all of it.
  let followTimer = 0, followed = 0, cost = 0;
  function followTime() {
    if (op !== 't' || host.hidden || !app.loopModel || followTimer) return;
    followTimer = setTimeout(() => {
      followTimer = 0;
      if (op !== 't' || host.hidden) return;
      const t0 = performance.now();
      render();
      followed = performance.now(); cost = followed - t0;
    }, Math.max(0, Math.max(250, 2 * cost) - (performance.now() - followed)));
  }

  function compute() {
    const all = controllers();
    const c = all.find((x) => target && x.path.join('/') === target.join('/')) ?? all[0];
    if (!c) return { empty: 'This system has no Controller block. Add one in the Plant tab, wire the reference to its first input and the measurements to the others.' };
    target = c.path;
    if (!app.loopModel) return { c, all, error: 'The analysis needs the plant a block sees, linearised at an operating point. That comes with the design layer.' };
    const spec = opSpec(), from = op === 't' ? app.scopeTimeFrom?.() : null;
    const key = JSON.stringify([app.project.system, c.path, spec]);
    if (key === lastKey && last) { if (last.res) last.from = from; return last; }
    lastKey = key;
    try {
      const m = app.loopModel(c.path, spec);
      const res = analyzeLoop(m.plant, m.ctrl, m.Ts);
      // The step only for a stable loop; its final value is the DC gain.
      const st = res.stable ? stepInfo(m.plant, m.ctrl, m.Ts, { clPoles: res.clPoles }) : null;
      // The peak of u in the step, from its first samples (kicks come early).
      if (st) st.uPeak = Math.max(...stepResponse(m.plant, m.ctrl, m.Ts, Math.min(4000, Math.ceil(st.T / m.Ts))).u.map(Math.abs));
      last = { c, all, m, res, st, spec, from };
    } catch (err) {
      last = { c, all, error: err.message };
    }
    return last;
  }

  function renderSide(v) {
    $('#an-blocks').innerHTML = v.all?.length > 1
      ? v.all.map((x) => `<button class="btn btn-block" data-path="${esc(x.path.join('/'))}" aria-pressed="${x === v.c}">${esc(x.where)}</button>`).join('')
      : v.c ? `<div class="heading">${esc(v.c.where)} · ${esc(v.c.block.variants?.[v.c.block.variant ?? 0]?.name ?? '')}</div>` : '';
    $('#an-blocks').querySelectorAll('[data-path]').forEach((el) => el.addEventListener('click', () => { target = el.dataset.path.split('/'); render(); }));
    host.querySelectorAll('[data-op]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.op === op)));
    if (!v.res) {
      $('#an-verdict').innerHTML = '';
      $('#an-kw').innerHTML = '';
      $('#an-notes').textContent = v.error ?? '';
      return;
    }
    const { res, m, st } = v, g = res.margins, Ts = m.Ts, ok = res.stable;
    const plural = (k, w) => `${k} ${w}${k > 1 ? 's' : ''}`;
    $('#an-verdict').innerHTML = ok
      ? `<span class="grade text-ok">✓ stable</span> <span class="muted">every closed-loop pole inside the unit circle</span>`
      : res.marginal
        ? `<span class="grade text-warn">! marginal</span> <span class="muted">${plural(res.onCircle.closed, 'closed-loop pole')} on the unit circle (a free integrator or an undamped mode): it neither dies away nor grows</span>`
        : `<span class="grade text-bad">✕ unstable</span> <span class="muted">${plural(res.Z, 'closed-loop pole')} outside the unit circle</span>`;
    const rows = [];
    const row = (k, val, extra = '', title = '') => rows.push(`<tr title="${esc(title)}"><th>${k}</th><td>${val}</td><td>${extra}</td></tr>`);
    const factor = (k) => `×${num(k, 3)}`;
    // With no pole outside, the gain interval is a margin; an unstable loop
    // shows instead the gains at which it would be stable.
    if (res.Z === 0) {
      const up = Number.isFinite(g.gmUp) ? `${factor(g.gmUp)} (${num(20 * Math.log10(g.gmUp), 3)} dB)` : '∞';
      row('Gain margin', g.gmDown > 0 ? `${factor(g.gmDown)} … ${up}` : up, ok && Number.isFinite(g.gmUp) ? grade(gradeGm(g.gmUp)) : '', 'The loop gain may change by these factors before a closed-loop pole crosses the unit circle');
    } else {
      const sg = g.stableGains;
      row('Stable for', sg ? `gain ${sg.lo > 0 ? factor(sg.lo) : '×0'} … ${Number.isFinite(sg.hi) ? factor(sg.hi) : '∞'}` : 'no gain', '', 'The loop is unstable as tuned; with its gain scaled by these factors every closed-loop pole would be inside the unit circle');
    }
    // An unstable loop has no margin: the same number is only where the phase is.
    if (res.Z === 0) row('Phase margin', Number.isFinite(g.pm) ? `${num(g.pm, 3)}° at ${num(g.wc, 3)} rad/s` : '—', ok && Number.isFinite(g.pm) ? grade(gradePm(g.pm)) : '', 'At the crossover |L| = 1, the phase left before −180°');
    else row('Phase at |L| = 1', Number.isFinite(g.pm) ? `${num(g.pm, 3)}° from −180° at ${num(g.wc, 3)} rad/s` : '—', '', 'At the crossover |L| = 1, how far the phase is from −180°; an unstable loop has no margin to read from it');
    row('Delay margin', res.Z === 0 && Number.isFinite(g.dm) ? `${num(g.dm * 1000, 3)} ms (${num(g.dmSamples, 3)} Ts)` : '—', '', res.Z === 0 ? 'The extra dead time the loop tolerates' : 'An unstable loop has no dead time to spare');
    row('Ms = max |S|', `${num(g.ms, 3)} at ${num(g.wMs, 3)} rad/s`, ok ? grade(gradeMs(g.ms)) : '', 'Peak sensitivity; 1/Ms is the closest approach to −1');
    row('Mt = max |T|', `${num(g.mt, 3)}`, '', 'Peak complementary sensitivity');
    if (res.slowest) {
      const s = res.slowest.s, at = `s = ${num(s.re, 3)} ${s.im >= 0 ? '+' : '−'} ${num(Math.abs(s.im), 3)}j`;
      row('Slowest pole', s.re < 0 ? `τ = ${num(-1 / s.re, 3)} s` : s.re === 0 ? 'τ = ∞ (on the circle)' : `grows ×e in ${num(1 / s.re, 3)} s`, '', at);
    }
    row('Least damping', `ζ = ${num(res.zetaMin, 3)}`, ok && res.zetaMin < 1 ? grade(res.zetaMin >= 0.5 ? 'good' : res.zetaMin >= 0.25 ? 'fair' : 'poor') : '', 'Smallest damping ratio of the oscillating closed-loop poles');
    const on = res.onCircle.open ? ` · ${res.onCircle.open} on |z| = 1` : '';
    row('Nyquist', `P ${res.P} · N ${res.N} · Z ${res.Z}${on}`, '', 'P open-loop poles outside the unit circle, N clockwise encirclements of −1, Z = N + P closed-loop poles outside; open-loop poles on the circle (integrators) are in neither P nor Z');
    if (st?.overshoot !== undefined) {
      row('Step (linear)', st.settled ? `${num(st.overshoot, 3)} % overshoot, settles ${num(st.settle, 3)} s` : `${num(st.overshoot, 3)} % overshoot, not settled in ${num(st.T, 3)} s`, '', 'Overshoot and the 2 % band, against the final value');
      row('Final value', num(st.yf, 4), '', "The closed loop's DC gain from r to y");
    }
    $('#an-kw').innerHTML = rows.join('');
    const dead = res.L.delaySamples ?? [];
    const notes = [
      `${m.opLabel ?? ''}${m.opLabel ? ' · ' : ''}${m.variantName ?? ''} · Ts ${num(Ts * 1000, 3)} ms`,
      ...(v.spec?.t !== undefined ? [`Scope time t = ${num(v.spec.t, 4)} s, ${FROM[v.from] ?? 'on the scope'}`] : []),
      ...(dead.some((d) => d > 0) ? [`dead time: ${dead.map((d) => `${num(d, 3)} Ts`).join(', ')}, exact (a part of a sample by the modified z-transform)`] : []),
      `Linear: u is assumed inside its limits${Number.isFinite(st?.uPeak) ? ` (in the step u peaks at ${num(st.uPeak, 3)} per unit of r)` : ''}; the step goes through the prefilter on r, which is outside the loop.`,
      ...(m.warnings ?? []),
    ];
    $('#an-notes').innerHTML = notes.map((n) => `<div>${esc(n)}</div>`).join('');
  }

  // Root locus in the s-plane (s = ln z / Ts) or the z-plane.
  function drawLocus(v) {
    const p = plots.locus, { res, m } = v, Ts = m.Ts;
    // In s, poles at z = 0 (a delay chain, a previous-measurement state) are
    // faster than anything shown: counted, not drawn.
    const map = plane === 's' ? (z) => sPlanePoint(z, Ts) : (z) => [z.re, z.im];
    let ax, hidden = 0;
    if (plane === 'z') ax = { x0: -1.25, x1: 1.25, y0: -1.25, y1: 1.25 };
    else {
      // The region the loop works in: poles up to ten times the crossover
      // (or the slowest pole); faster ones (an armature, a derivative filter)
      // are counted, not drawn.
      const pts = [...res.olPoles, ...res.clPoles.map((q) => q.z)].map(map).filter(Boolean);
      const mags = res.clPoles.map((q) => map(q.z)).filter(Boolean).map((q) => Math.hypot(q[0], q[1])).filter((x) => x > 1e-9).sort((a, b) => a - b);
      const lim = 10 * Math.max(Number.isFinite(res.margins.wc) ? res.margins.wc : 0, mags[0] ?? 1);
      const near = pts.filter((q) => Math.hypot(q[0], q[1]) <= lim);
      hidden = res.clPoles.filter((q) => { const s = map(q.z); return !s || Math.hypot(s[0], s[1]) > lim; }).length;
      const R = Math.max(1e-6, ...near.map((q) => Math.hypot(q[0], q[1]))) * 1.3;
      ax = { x0: -R, x1: 0.35 * R, y0: -0.8 * R, y1: 0.8 * R };
    }
    if (view.locus) ax = { ...view.locus };
    const fr = p.frame({ ...ax, equal: true, xlabel: plane === 's' ? 'Re s' : 'Re z', ylabel: plane === 's' ? 'Im s' : 'Im z' });
    p.clip(() => {
      const g = p.g;
      // Stability boundary and, in s, the ζ = 0.7 rays.
      if (plane === 'z') {
        const th = Array.from({ length: 181 }, (_, i) => (i / 180) * 2 * Math.PI);
        p.line(th.map(Math.cos), th.map(Math.sin), { color: C().axis, width: 1.2 });
      } else {
        const c = Math.cos(Math.acos(0.7)), s = Math.sin(Math.acos(0.7)), R = 2 * Math.max(Math.abs(fr.x0), Math.abs(fr.x1), Math.abs(fr.y0), Math.abs(fr.y1));
        p.line([0, -R * c], [0, R * s], { color: C().gridFaint, width: 1, dash: [3, 4] });
        p.line([0, -R * c], [0, -R * s], { color: C().gridFaint, width: 1, dash: [3, 4] });
      }
      g.globalAlpha = C().alpha.guide;
      for (const { poles } of res.locus) for (const z of poles) { const q = map(z); if (q) p.mark(q[0], q[1], { shape: 'dot', color: C_L(), size: 2.4 }); }
      g.globalAlpha = 1;
      for (const z of res.olPoles) { const q = map(z); if (q) p.mark(q[0], q[1], { shape: 'x', color: C_U(), size: 5 }); }
      for (const { z } of res.clPoles) { const q = map(z); if (q) p.mark(q[0], q[1], { shape: 'dot', color: C_CL(), size: 8 }); }
    });
    p.text(fr.x0, fr.y0, ` × open loop  ● closed loop  · gain ×0.01…×100${hidden ? `  · ${hidden} faster off the plot` : ''}`, { base: 'bottom', dy: -4, dx: 4 });
  }

  function drawBode(v) {
    const { res, m } = v, fd = res.fd, g = res.margins;
    // A crossing at an end of the band (z = 1 at ω = 0, z = −1 at π/Ts) is
    // marked at that end of the axis.
    const at = (w) => Math.min(Math.max(w, fd.w[0]), fd.w.at(-1));
    const dB = fd.mag.map((x) => 20 * Math.log10(x));
    const [d0, d1] = extent(dB.filter((x) => x > -200), 0.08);
    const a = plots.mag.frame({ x0: fd.w[0], x1: fd.w.at(-1), xlog: true, y0: Math.max(d0, -120), y1: Math.min(d1, 160), ylabel: '|L| dB' });
    plots.mag.clip(() => {
      plots.mag.line([a.x0, a.x1], [0, 0], { color: C().axis, width: 1, dash: [4, 3] });
      plots.mag.line(fd.w, dB, { color: C_L(), width: 1.8 });
      for (const c of g.gainCrossings) plots.mag.mark(c.w, 0, { shape: 'o', color: C_CL(), size: 4 });
      const P = plots.mag.P, sg = g.stableGains, unstable = res.Z > 0;
      for (const c of g.phaseCrossings) {
        plots.mag.line([at(c.w), at(c.w)], [20 * Math.log10(c.mag), 0], { color: C_U(), width: 1.5 });
        // Only the crossings that bound the gain interval get a label; an
        // unstable loop's, the ones that bound the gains it would be stable for.
        const label = !unstable ? (c.gm === g.gmUp || c.gm === g.gmDown) && `GM ×${num(c.gm, 3)}`
          : sg && (c.gm === sg.hi ? `stable below ×${num(c.gm, 3)}` : c.gm === sg.lo ? `stable above ×${num(c.gm, 3)}` : '');
        if (!label) continue;
        // Inside the plot, and at the ω = 0 end below the axis title in the corner.
        const y = 20 * Math.log10(c.mag) / 2, py = plots.mag.Y(y), top = P.t + (c.at === 'dc' ? 24 : 8);
        const dy = py < top ? top - py : py > P.b - 8 ? P.b - 8 - py : 0;
        plots.mag.text(at(c.w), y, label, { color: C_U(), dx: c.at === 'nyquist' ? -5 : 5, dy, align: c.at === 'nyquist' ? 'right' : 'left' });
      }
      if (cursorW) plots.mag.line([cursorW, cursorW], [a.y0, a.y1], { color: C().ink, width: 1, alpha: C().alpha.guide });
    });
    const [p0, p1] = extent(fd.phase, 0.08);
    const b = plots.phase.frame({ x0: fd.w[0], x1: fd.w.at(-1), xlog: true, y0: Math.min(p0, -190), y1: Math.max(p1, -80), xlabel: `ω rad/s · Nyquist ${num(Math.PI / m.Ts, 3)}`, ylabel: '∠L °' });
    plots.phase.clip(() => {
      for (let k = Math.ceil((b.y0 + 180) / 360); k * 360 - 180 <= b.y1; k++) plots.phase.line([b.x0, b.x1], [k * 360 - 180, k * 360 - 180], { color: C().axis, width: 1, dash: [4, 3] });
      plots.phase.line(fd.w, fd.phase, { color: C_L(), width: 1.8 });
      for (const c of g.gainCrossings) {
        const ph = phaseAt(fd, res.L, c.w);
        plots.phase.line([c.w, c.w], [ph, ph - c.pm], { color: C_CL(), width: 1.5 });
        plots.phase.text(c.w, ph - c.pm / 2, res.Z === 0 ? `PM ${num(c.pm, 3)}°` : `${num(c.pm, 3)}° from −180°`, { color: C_CL(), dx: -5, align: 'right' });
      }
      if (cursorW) plots.phase.line([cursorW, cursorW], [b.y0, b.y1], { color: C().ink, width: 1, alpha: C().alpha.guide });
    });
    // The readout gives the phase the curve shows (unwrapped), not atan2's.
    const L = cursorW ? respondAt(res.L, cursorW) : null;
    $('#an-bode-read').textContent = L ? `ω ${num(cursorW, 3)} rad/s · |L| ${num(20 * Math.log10(Math.hypot(L.re, L.im)), 3)} dB · ∠ ${num(phaseAt(fd, res.L, cursorW), 3)}°` : 'hover for a frequency';
  }

  function drawNyquist(v) {
    const p = plots.nyq, { res } = v, fd = res.fd, g = res.margins;
    const pts = fd.re.map((re, i) => squash(re, fd.im[i]));
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    // Around −1, where the margins are read; the wheel zooms out to the rest.
    p.frame({ ...(view.nyq ?? { x0: -3.2, x1: 1.6, y0: -2, y1: 2 }), equal: true, xlabel: 'Re L', ylabel: 'Im L  (|L| > 1: 1 + ln|L|)' });
    p.clip(() => {
      const th = Array.from({ length: 181 }, (_, i) => (i / 180) * 2 * Math.PI);
      p.line(th.map(Math.cos), th.map(Math.sin), { color: C().axis, width: 1 });
      // The Ms circle: |1 + L| = 1/Ms, the closest approach to −1.
      const ring = th.map((a) => squash(-1 + Math.cos(a) / g.ms, Math.sin(a) / g.ms));
      p.line(ring.map((q) => q[0]), ring.map((q) => q[1]), { color: C_U(), width: 1.2, dash: [4, 3] });
      p.line(xs, ys.map((y) => -y), { color: C_L(), width: 1.2, dash: [5, 4], alpha: C().alpha.guide });
      p.line(xs, ys, { color: C_L(), width: 1.8 });
      p.mark(-1, 0, { shape: '+', color: C().mark, size: 6, width: 2 });
      if (cursorW) { const at = respondAt(res.L, cursorW), q = squash(at.re, at.im); p.mark(q[0], q[1], { shape: 'o', color: C().mark, size: 5 }); }
    });
    $('#an-nyq-read').textContent = `P ${res.P} · N ${res.N} · Z ${res.Z} · Ms ${num(g.ms, 3)}`;
  }

  function drawStep(v) {
    const p = plots.step, { st, res, m } = v;
    if (!st || st.overshoot === undefined) {
      p.frame({ x0: 0, x1: 1, y0: -1, y1: 1 });
      p.note(res?.marginal ? 'marginal: no final value, no step' : res?.stable === false ? 'unstable: no step response' : 'no final value');
      $('#an-step-read').textContent = '';
      return;
    }
    // A settled response is shown to twice its settling time; one that has
    // not settled, the whole window.
    const tEnd = st.settled ? Math.min(st.T, Math.max(2 * st.settle, 20 * m.Ts)) : st.T;
    const n = Math.max(2, st.t.findIndex((t) => t > tEnd) + 1 || st.t.length);
    const t = st.t.slice(0, n), y = st.y.slice(0, n);
    const [y0, y1] = extent([...y, 0, 1, st.yf], 0.08);
    p.frame({ x0: 0, x1: t.at(-1), y0, y1, xunit: 's', ylabel: 'y (r = 1)' });
    p.clip(() => {
      p.line([0, t.at(-1)], [1, 1], { color: C().axis, width: 1, dash: [4, 3] });
      if (Math.abs(st.yf - 1) > 1e-3) p.line([0, t.at(-1)], [st.yf, st.yf], { color: C_CL(), width: 1, dash: [2, 3], alpha: C().alpha.guide });
      p.line(t, y, { color: C_CL(), width: 1.8 });
    });
    $('#an-step-read').textContent = `final ${num(st.yf, 3)} · overshoot ${num(st.overshoot, 3)} %${st.settled ? '' : ' · not settled'}`;
  }

  function draw() {
    const v = last;
    if (!v?.res || host.hidden || $('#an-grid').hidden) return;
    host.querySelectorAll('[data-plane]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.plane === plane)));
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
    followTime,
  };
}
