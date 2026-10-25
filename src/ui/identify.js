// Tab 4, Identify (design/output/identification.md): finding the plant a
// Controller block sees by one eased-in experiment. Four columns, as the
// Auto-tune tab has them: what the page knows (and the two things it asks),
// the experiment (Start, the stage chips, the push and room meters, the
// status, the tries, the overview strip), the model (sentences, the chain of
// blocks, the candidates, the gentlest controller that held, Keep, Copy as
// blocks, Add as variant) and the Check's plots. The experiment runs as the
// block's hidden law in a copy of the diagram (core/identify.js identifyRun)
// at the header's Speed, in slices between frames; the scope sweeps it, each
// try a sweep of its own. Nothing but the record is kept, on Keep; the model
// is computed from it whenever it is needed.

import { knownFor, identifySettings, identifyRun, identifySteps, predictCheck, modelStep, modelBode, twinSubsystem, withBar, BUDGETS, GRADE, IdentifyError, planExperiment, planRecheck, recheckFit, compactRecord, discriminateSteps } from '../core/identify.js';
import { controllerBlocks, placeVariant, baseName } from '../core/autotune.js';
import { normalizeVariant } from '../core/controllers.js';
import { AS_FAST, formatSpeed } from '../core/speed.js';
import { num, parseSI } from './units.js';
import { palette as C, fade } from './palette.js';
import { createPlot, extent } from './plots.js';

const SLICE = 30;       // ms of computing per task, so the page keeps drawing
const FRAME = 0.25;     // s of wall time a slow frame may make up, at most
const RENDER = 100;     // ms between two renders of the progress while it runs
const MAX_SWEEP = 4000; // samples a sweep keeps, at most
const PLOTS = {
  check: { label: 'Check', about: 'The Check: what was measured (a test the model was not fitted to) against the model\'s prediction and its 2σ band, with the reference.' },
  bode: { label: 'Bode', about: 'How much of a swing at each frequency the model passes, as the sampled loop sees it, with its 2σ band; the kernel\'s estimate dotted ("what the data say without choosing a shape").' },
  step: { label: 'Step', about: 'The model\'s response to one unit more of u, from rest, with its 2σ band; the kernel\'s dotted.' },
  where: { label: 'Where', about: 'The gain at each place the test sat, with its 2σ bar: where it differs, one linear model is a compromise. Faint: a place the test spent little time in.' },
  size: { label: 'Size', about: 'The apparent gain of each push of the Nudge against its size: a gain that grows with the push is friction or a dead band.' },
  more: { label: 'More', about: 'What is left after the model, on the Check: its autocorrelation against the 99 % band (and what the loop gives white noise, dashed); χ²/dof of every candidate.' },
};
const TIPS = {
  gain: 'K: how much more y one unit more of u gives, once it has settled',
  rate: 'k′: how fast y moves per unit of u (the plant integrates: it keeps moving as long as it is pushed)',
  delay: 'θ: how long before y responds at all (a dead time)',
  lag: 'τ: how long y takes to get about two thirds of the way',
  freq: 'f: how fast it swings',
  damping: 'ζ: how quickly a swing dies out; 0.7 swings once, 0.1 rings for a long time',
};

export function createIdentifyTab(host, app, display, record) {
  const st = { target: null, plot: 'check' };
  let job = null;             // the test in progress
  const fresh = new Map();    // block key → the last test run here, not kept (memory only)
  const models = new Map();   // record hash + structure → a model computed from it
  let computing = null;       // a model being computed from a kept record
  const checks = new Map();   // block key → the last Check again's verdict
  const connections = new Map(); // record hash → the live connection it was measured on (this page session)

  host.innerHTML = `
    <div class="ident">
      <section class="gcol" aria-label="What we know">
        <div class="ghead"><h3 class="label">What we know</h3></div>
        <div id="id-blocks" class="ctblocks"></div>
        <div id="id-known" class="idknown"></div>
        <p class="note" id="id-why" role="alert"></p>
      </section>
      <section class="gcol idexp" aria-label="Experiment">
        <div class="ghead"><h3 class="label">Experiment</h3><button class="btn btn-sm" id="id-start">Start</button></div>
        <div class="idchips" id="id-chips" role="list" aria-label="Stages"></div>
        <div class="idmeters" id="id-meters"></div>
        <div class="note tustatus" id="id-status" role="status"></div>
        <div class="idchips" id="id-tries" aria-label="Tries"></div>
        <p class="hint mono" id="id-time"></p>
        <canvas class="idstrip" id="id-strip" aria-label="The whole record: u and y with the stages; click a stage to see it on the scope" hidden></canvas>
      </section>
      <section class="gcol" aria-label="Model">
        <div class="ghead"><h3 class="label">Model</h3></div>
        <div id="id-model"></div>
      </section>
      <section class="gcol" aria-label="Check">
        <div class="ghead"><h3 class="label">Check</h3></div>
        <div class="seg" id="id-plots" role="radiogroup" aria-label="Plot"></div>
        <canvas class="idplot" id="id-plot" aria-label="The plot"></canvas>
        <p class="hint" id="id-plotnote"></p>
      </section>
    </div>
    <div id="id-empty" hidden></div>`;
  const $ = (s) => host.querySelector(s);
  const plot = createPlot($('#id-plot'));

  const root = () => (app.project.system.plant?.type === 'diagram' ? app.project.system.plant.diagram : null);
  const blocks = () => controllerBlocks(root());
  const current = () => { const all = blocks(); return all.find((c) => c.key === st.target) ?? all[0] ?? null; };
  const stored = (key) => app.project.system.identify?.[key] ?? {};
  // What the page knows, the settings, and the plan, or why it cannot run.
  function context() {
    const c = current();
    if (!c) return { why: null };
    let known, settings, plan = null, why = null, hint = '';
    const L = app.live?.identify;
    try {
      known = knownFor(app.project, c.path, app.live?.owns() ? { describe: L.describe(), link: L.link() } : {});
      settings = identifySettings(app.project, c.path, { known });
    } catch (err) { return { c, why: err.message, hint: err.hint ?? '' }; }
    try { plan = planExperiment(known, settings); } catch (err) { why = err.message; hint = err.hint ?? ''; }
    // On a live plant the block samples on the plant's clock: its Ts a whole
    // number of the plant's cycles.
    const rate = L?.describe()?.rate_hz;
    if (!why && known.live && rate && Math.abs(known.Ts * rate - Math.round(known.Ts * rate)) > 1e-6) { why = `the block's Ts (${fmtTime(known.Ts)}) is not a whole number of the plant's cycles (${num(rate, 4)} Hz)`; hint = 'set Ts in the Plant tab'; }
    return { c, known, settings, plan, why, hint };
  }
  // The diagram as the experiment sees it: the variants and the blocks'
  // places aside, so Add as variant keeps a test that is not kept.
  const plantKey = () => JSON.stringify(root(), function (k, v) { if (k === 'x' || k === 'y' ? typeof v === 'number' && this.id !== undefined : k === 'variants' || k === 'variant') return undefined; return v; });

  // ---- The model shown: the test just run (not kept), else the kept one in use.

  function source(key) {
    const f = fresh.get(key);
    if (f && f.plant === plantKey() && f.keptAs === null) return { kind: 'fresh', plan: f.result.plan, record: f.result.record, name: f.name, result: f.result };
    if (f && f.plant !== plantKey()) fresh.delete(key);
    const s = stored(key), kept = s.kept ?? [];
    if (!kept.length) return null;
    const i = Math.min(kept.length - 1, Math.max(0, s.use ?? kept.length - 1));
    return { kind: 'kept', index: i, plan: kept[i].plan, record: kept[i].record, name: kept[i].name };
  }
  const recordHash = (rec) => { const s = JSON.stringify(rec); let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return `${s.length}:${h >>> 0}`; };
  const modelKey = (src, structure) => `${recordHash(src.record)}|${structure ?? ''}`;
  // The model of the block's source, or null while it is computed (in slices).
  function modelOf(key) {
    const src = source(key);
    if (!src) return { src: null, model: null };
    const structure = stored(key).structure ?? null;
    const mk = modelKey(src, structure);
    if (models.has(mk)) return { src, model: models.get(mk) };
    if (!computing || computing.mk !== mk) {
      const reuse = [...models.values()].find((m) => m.recordHash === recordHash(src.record)) ?? null;
      computing = { mk, gen: identifySteps(src.record, { plan: src.plan, structure, reuse }) };
      setTimeout(computeSlice, 0);
    }
    return { src, model: null };
  }
  function computeSlice() {
    const w = computing;
    if (!w) return;
    const t0 = performance.now();
    try {
      for (;;) {
        const s = w.gen.next();
        if (s.done) { remember(w.mk, s.value); computing = null; renderAll(); return; }
        if (performance.now() - t0 > SLICE) break;
      }
    } catch (err) { computing = null; app.toast(`Could not compute the model: ${err.message}`); return; }
    setTimeout(computeSlice, 0);
  }
  function remember(mk, model) {
    Object.defineProperty(model, 'recordHash', { value: mk.split('|')[0], enumerable: false });
    models.set(mk, model);
    if (models.size > 24) models.delete(models.keys().next().value);
  }

  // ---- Column 1: what we know, and the two things asked

  function renderKnown() {
    const ctx = context();
    const { c, known, settings } = ctx;
    const all = blocks();
    $('#id-blocks').innerHTML = all.length > 1
      ? all.map((x) => `<button class="btn btn-block" data-path="${esc(x.key)}" aria-pressed="${x.key === c?.key}" ${job ? 'disabled' : ''}>${esc(x.where)}</button>`).join('')
      : c ? `<div class="heading">${esc(c.where)}</div>` : '';
    if (!known) { $('#id-known').innerHTML = ''; $('#id-why').innerHTML = ctx.why ? `<span class="text-bad">✕ ${esc(ctx.why)}</span>${ctx.hint ? `<br><span class="hint">${esc(ctx.hint)}</span>` : ''}` : ''; return ctx; }
    const u = known.u, y = known.y, U = (v, unit) => `${num(v, 4)}${unit ? ` ${unit}` : ''}`;
    const from = { plant: 'from the plant', controller: 'from the Controller tab', both: 'from the plant and the Controller tab' }[u.from] ?? '';
    const startFrom = u.start === 'plant' ? 'the plant\'s safe value' : u.start === 'controller' ? 'the running variant\'s start output' : 'u at rest';
    const bandFrom = { r: 'from r\'s range', plant: 'from the plant', yours: 'yours' }[settings.band.from] ?? '';
    const lock = job ? 'disabled' : '';
    const hard = settings.hard;
    const rows = [
      `<div class="idrow mono">${esc(u.name)} → ${esc(y.name)} · Ts ${esc(fmtTime(known.Ts))}</div>`,
      `<div class="idrow" title="u's range: the running variant's u min and u max${u.from !== 'controller' ? ', within the plant\'s' : ''}; it starts at ${esc(startFrom)}">${esc(u.name)} may go ${esc(U(u.min, u.unit))} … ${esc(U(u.max, u.unit))} · starts at ${esc(U(u.u0, u.unit))} <span class="hint">(${esc(from)})</span>${rangeBar(u.min, u.max, u.u0)}</div>`,
      hard.from === 'plant'
        ? `<div class="idrow">${esc(y.name)} never beyond ${esc(U(hard.value[0], y.unit))} … ${esc(U(hard.value[1], y.unit))} <span class="hint">(from the plant)</span></div>`
        : `<label class="idpf" title="Where the plant itself would stop (E-stop). Leave empty if you do not know: the band below is then all the page goes by."><span class="flabel">${esc(y.name)} never beyond</span><span class="idpair"><input class="field field-sm mono" data-k="hard0" value="${hard.value ? esc(num(hard.value[0], 4)) : ''}" placeholder="don't know" ${lock}><span>…</span><input class="field field-sm mono" data-k="hard1" value="${hard.value ? esc(num(hard.value[1], 4)) : ''}" placeholder="don't know" ${lock}></span><span class="hint">${esc(y.unit)}</span></label>`,
      known.r ? `<div class="idrow">r runs ${esc(U(known.r.lo, y.unit))} … ${esc(U(known.r.hi, y.unit))} <span class="hint">(Input tab)</span></div>` : '<div class="idrow hint">no reference: the test plays a staircase of its own</div>',
      `<label class="idpf" title="How far the test may move ${esc(y.name)}: the page eases in and backs off before it reaches an edge. Default: r's range widened by a third of its span on each side, inside the plant's range."><span class="flabel">${esc(y.name)} may move within</span><span class="idpair"><input class="field field-sm mono" data-k="band0" value="${settings.band.value ? esc(num(settings.band.value[0], 4)) : ''}" ${lock}><span>…</span><input class="field field-sm mono" data-k="band1" value="${settings.band.value ? esc(num(settings.band.value[1], 4)) : ''}" ${lock}></span><span class="hint">${esc(y.unit)}${bandFrom ? ` · ${esc(bandFrom)}` : ''}</span></label>`,
      `<label class="idpf" title="Plant time: the test eases in for as long as this allows, and always keeps time for the Check."><span class="flabel">The test may take</span><select class="field field-sm" id="id-budget" ${lock}>${BUDGETS.map((b) => `<option value="${b}" ${b === settings.budget.value ? 'selected' : ''}>${b < 60 ? `${b} s` : `${b / 60} min`}</option>`).join('')}</select></label>`,
    ];
    if (!editing($('#id-known'))) $('#id-known').innerHTML = rows.join('');
    $('#id-why').innerHTML = ctx.why ? `<span class="text-bad">✕ ${esc(ctx.why)}</span>${ctx.hint ? `<br><span class="hint">${esc(ctx.hint)}</span>` : ''}` : '';
    return ctx;
  }
  const editing = (el) => el.contains(document.activeElement) && document.activeElement.matches('input, select');

  // A design input of the block's Identify settings (one undo step); null
  // removes it, back to its default.
  function setSetting(key, name, value) {
    app.editProject((p) => {
      const all = (p.system.identify ??= {});
      const e = (all[key] ??= {});
      if (value === null) delete e[name]; else e[name] = value;
      if (!Object.keys(e).length) delete all[key];
      if (!Object.keys(all).length) delete p.system.identify;
    });
  }

  // ---- Column 2: the experiment

  function renderExperiment(ctx) {
    const b = $('#id-start');
    b.textContent = job ? (job.stopping ? 'Stopping…' : 'Stop') : 'Start';
    b.className = `btn btn-sm${job ? ' btn-danger' : ''}`;
    b.disabled = job ? !!job.stopping : !!ctx.why || !ctx.plan;
    b.title = job ? 'Stop: the excitation ends, the controller brings y back, the record so far is kept' : 'Start the test: it eases in, and the plant may move within the band';
    const s = stateOf(job) ?? shownState();
    const chips = s?.chips ?? ['Listen', 'Nudge', 'Hold', 'Ease in', 'Shake', 'Check'].map((label) => ({ label, mark: '' }));
    $('#id-chips').innerHTML = chips.map((x) => `<span class="btn btn-sm idchip" role="listitem" ${x.mark === 'lit' ? 'aria-pressed="true"' : ''} title="${esc(STAGE_ABOUT[x.label] ?? '')}">${x.mark && x.mark !== 'lit' ? `${esc(x.mark)} ` : ''}${esc(x.label)}</span>`).join('');
    $('#id-meters').innerHTML = s ? meter('push', 'push', s.push, s.pushMax, s.marks.push, 'How hard the test pushes: |u − u₀| as % of u\'s range, and the largest so far') + meter('room', 'room used', s.room, s.roomMax, s.marks.room, 'How much of the room y may use the test has used: easing in stops at the first mark, the page backs off at the second') : '';
    const status = job ? (job.fitting ? 'Fitting the model…' : s?.status ?? 'Starting the plant…') : s ? s.status : ctx.why ? '' : 'Press Start: the page runs one test that eases in. The plant may move within the band.';
    $('#id-status').textContent = status ?? '';
    $('#id-tries').innerHTML = (s?.tries ?? []).map((t, i) => `<span class="chip" title="Try ${i + 1}">${i + 1} ${esc(t)}</span>`).join('');
    $('#id-time').textContent = s ? `Plant time ${clock(s.t)} of ${clock(s.budget)}${job ? ` · ${formatSpeed(app.speed())}` : ''}` : '';
    const rec = !job ? source(current()?.key)?.record : null;
    $('#id-strip').hidden = !rec;
    if (rec) drawStrip(rec);
  }
  // The state of the last test, for the chips and the status after it.
  function shownState() {
    const f = fresh.get(current()?.key);
    return f && f.plant === plantKey() ? f.state : null;
  }
  function meter(id, label, v, max, marks, title) {
    const pct = (x) => `${Math.round(100 * Math.min(1, Math.max(0, x)))}`;
    return `<div class="idmeter" title="${esc(title)}"><span class="flabel">${esc(label)}</span><span class="idbar" role="meter" aria-label="${esc(label)}" aria-valuenow="${pct(v)}" aria-valuemin="0" aria-valuemax="100"><span class="idfill idfill-${id}" style="width:${pct(v)}%"></span><span class="idmax" style="left:${pct(max)}%"></span>${marks.filter((m) => m !== null).map((m) => `<span class="idmark" style="left:${pct(m)}%"></span>`).join('')}</span><span class="mono hint">${pct(v)} % · ${pct(max)} %</span></div>`;
  }

  // The overview strip: u and y over the whole record, with the stages as
  // bands; a click shows that stage on the scope (the record's reference).
  function drawStrip(rec) {
    const cv = $('#id-strip'), r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (!r.width) return;
    const W = r.width, H = r.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = C().bg; g.fillRect(0, 0, W, H);
    const n = rec.y.length, x = (i) => (i / Math.max(1, n - 1)) * W;
    const stages = (rec.log ?? []).filter((e) => e.kind === 'stage');
    stages.forEach((e, j) => {
      const a = x(e.i ?? 0), b = x(stages[j + 1]?.i ?? n);
      g.fillStyle = j % 2 ? C().hover : C().veil; g.fillRect(a, 0, b - a, H);
      g.fillStyle = C().label; g.font = `9px ${C().mono}`; g.textBaseline = 'top';
      const label = STAGE_SHORT[e.stage] ?? e.stage;
      if (b - a > g.measureText(label).width + 6) g.fillText(label, a + 2, 2);
    });
    const line = (v, color) => {
      const [lo, hi] = extent(v.filter((q) => q !== null), 0.1);
      g.strokeStyle = color; g.lineWidth = 1; g.beginPath();
      let pen = false;
      for (let i = 0; i < n; i += Math.max(1, Math.floor(n / (2 * W)))) {
        if (v[i] === null) { pen = false; continue; }
        const px = x(i), py = H - 2 - ((v[i] - lo) / (hi - lo)) * (H - 14);
        if (pen) g.lineTo(px, py); else { g.moveTo(px, py); pen = true; }
      }
      g.stroke();
    };
    line(rec.u, C().ch[3]);
    line(rec.y, C().ch[2]);
  }

  // ---- Column 3: the model

  function renderModel() {
    const c = current();
    const box = $('#id-model');
    if (!c) { box.innerHTML = ''; return null; }
    if (job) { box.innerHTML = '<p class="note muted">The model comes when the test ends.</p>'; return null; }
    const { src, model } = modelOf(c.key);
    if (!src) { box.innerHTML = '<p class="note muted">No test yet. The model, in a few plain sentences, comes when a test ends.</p>'; return null; }
    if (!model) { box.innerHTML = '<p class="note muted">Computing the model from the record…</p>'; return null; }
    const s = stored(c.key);
    const out = [];
    const ended = src.record.end !== 'done' ? src.record.log.findLast((e) => e.kind === 'end')?.message : null;
    if (ended) out.push(`<p class="note text-warn">! From a test that ended early: ${esc(ended)}</p>`);
    if (!model.ok) {
      out.push(`<ul class="idsent">${model.sentences.map((t) => `<li class="text-bad">${esc(t)}</li>`).join('')}</ul>`);
    } else {
      out.push(`<ul class="idsent">${model.sentences.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`);
      const mark = model.grade === '✓' ? 'text-ok' : model.grade === '!' ? 'text-warn' : 'text-bad';
      out.push(`<p class="note"><b class="${mark}">${esc(model.grade)}</b> ${esc(model.why.length ? model.why.join('; ') : 'explains the test well')}</p>`);
      out.push(`<div class="idchain mono" aria-label="The model as blocks">In → ${model.chain.map((x) => `<span class="chip" title="${esc(TIPS[x.kind === 'gain' && model.label.startsWith('integrator') ? 'rate' : x.kind] ?? x.label)}">${esc(x.value === null ? x.label : `${x.label} ${withBar(x.value, x.sd)}${x.unit ? ` ${x.unit}` : ''}`)}</span>`).join(' → ')} → Out</div>`);
      out.push(`<p class="hint">${esc(model.chosen)}</p>`);
      out.push(`<div class="choices idcands" role="radiogroup" aria-label="Candidates">${model.candidates.map((x) => `<button class="item" role="radio" data-structure="${esc(x.structure)}" aria-checked="${x.structure === model.structure}" title="${esc(x.why.join('; ') || x.glyph)}"><span>${esc(x.label)}<span class="hint"> · ${esc(x.glyph)}</span></span><span class="mono">${Number.isFinite(x.fit) ? `${fitText(x.fit)} %` : '–'} ${esc(x.grade)}</span></button>`).join('')}</div>`);
    }
    if (model.eased) {
      out.push(`<p class="note">The gentlest controller that held: PI, Kp ${esc(num(model.eased.Kp, 3))}, Ki ${esc(num(model.eased.Ki, 3))}${model.eased.try ? ` (try ${model.eased.try})` : ' (the Hold\'s)'} <button class="btn btn-sm" id="id-variant" title="Adds it to the block as a variant of its own, “… · eased in”: hand numbers you choose to keep">Add as variant</button></p>`);
    }
    const keys = [];
    if (src.kind === 'fresh') keys.push('<button class="btn btn-sm" id="id-keep" title="Stores the measured record with the project (one undo step); the model is computed from it whenever it is needed">Keep</button>');
    if (model.ok && model.check) keys.push('<button class="btn btn-sm" id="id-recheck" title="Runs Listen, then the controller that held and the Check alone (about 10–20 s), and compares the plant with the model: still fits, or the plant has changed">Check again</button>');
    if (model.ok) keys.push('<button class="btn btn-sm" id="id-copy" title="Puts the model as a subsystem of the Plant library\'s own blocks into My blocks: these numbers no longer follow the plant">Copy as blocks</button>');
    if (keys.length) out.push(`<div class="idkeys">${keys.join('')}</div>`);
    const L = app.live?.owns() ? app.live.identify : null;
    const conn = src.kind === 'fresh' ? fresh.get(c.key)?.connection : connections.get(recordHash(src.record));
    if (L && (conn === undefined || conn === null || conn !== L.connection())) out.push('<p class="note text-warn">! Measured on an earlier connection: the plant may have changed. Check again tells.</p>');
    const ck = checks.get(c.key);
    if (ck) out.push(`<p class="note ${ck.ended ? 'text-bad' : ck.still ? 'text-ok' : 'text-bad'}">Check again: ${esc(ck.ended ?? ck.message)}</p>`);
    out.push(src.kind === 'fresh' ? '<p class="hint">Not kept: Keep saves it with the project.</p>' : `<p class="hint">Kept: ${esc(src.name)}.</p>`);
    const kept = s.kept ?? [];
    if (kept.length > 1 || (kept.length && src.kind === 'fresh')) {
      out.push(`<div class="choices" role="radiogroup" aria-label="Kept tests">${kept.map((k, i) => `<button class="item" role="radio" data-use="${i}" aria-checked="${src.kind === 'kept' && src.index === i}"><span>${esc(k.name)}</span><span class="hint">${esc(clock(k.record.y.length * k.record.Ts))}</span></button>`).join('')}</div>`);
    }
    if (model.warnings?.length) out.push(`<details class="more"><summary class="disclosure label"><span class="chev"></span>Notes</summary>${model.warnings.map((w) => `<p class="note">${esc(w)}</p>`).join('')}</details>`);
    box.innerHTML = out.join('');
    box.querySelectorAll('[data-structure]').forEach((el) => { el.onclick = () => { if (el.dataset.structure !== model.structure) setSetting(c.key, 'structure', el.dataset.structure); }; });
    box.querySelectorAll('[data-use]').forEach((el) => { el.onclick = () => { const f = fresh.get(c.key); if (f) f.keptAs = -1; setSetting(c.key, 'use', Number(el.dataset.use)); }; });
    $('#id-keep')?.addEventListener('click', () => keep(c, src));
    $('#id-copy')?.addEventListener('click', () => copyBlocks(model, src));
    $('#id-recheck')?.addEventListener('click', () => start('recheck'));
    $('#id-variant')?.addEventListener('click', () => addVariant(c, model));
    return model;
  }

  function keep(c, src) {
    const f = fresh.get(c.key);
    if (!f) return;
    let index = 0;
    app.editProject((p) => {
      const all = (p.system.identify ??= {});
      const e = (all[c.key] ??= {});
      e.kept ??= [];
      e.kept.push({ name: f.name, plan: structuredClone(src.plan), record: structuredClone(src.record) });
      index = e.use = e.kept.length - 1;
    });
    f.keptAs = index;
    app.toast(`Kept “${f.name}” with the project: the record; the model is computed from it. Ctrl+Z goes back.`);
  }
  function copyBlocks(model, src) {
    const name = `identified ${model.names.y} · ${src.name.split(' · ').pop()}`;
    app.saveToLibrary(name, twinSubsystem(model, { name }));
    app.toast(`Copied “${name}” to My blocks (Plant tab): these numbers no longer follow the plant.`);
  }
  function addVariant(c, model) {
    const e = model.eased;
    const block = c.block, running = block.variants[block.variant ?? 0];
    const base = `${baseName(running.name)} · eased in`;
    const taken = new Set(block.variants.map((v) => v.name));
    let name = base.slice(0, 40);
    for (let i = 2; taken.has(name); i++) name = `${base.slice(0, 36)} ${i}`;
    const variant = normalizeVariant({ name, type: 'pid', params: { Kp: e.Kp, Ki: e.Ki, Kd: 0, Tf: 0.01, b: 1, Tr: 0, Kff: 0, Kv: 0, Ka: 0, u0: running.params?.u0 ?? 0, umin: e.umin, umax: e.umax, aw: 'clamp', Tt: 0 } });
    app.editProject((p) => placeVariant(p, c.path, variant, { run: false }));
    app.toast(`Added “${name}” to ${c.where}: the PI that held, proven on the plant. Run it in the Controller tab.`);
  }

  // ---- Column 4: the Check's plots

  function renderPlots(model) {
    $('#id-plots').innerHTML = Object.entries(PLOTS).map(([k, x]) => `<button class="btn btn-sm" role="radio" data-plot="${k}" aria-checked="${k === st.plot}" title="${esc(x.about)}">${x.label}</button>`).join('');
    host.querySelectorAll('[data-plot]').forEach((el) => { el.onclick = () => { st.plot = el.dataset.plot; renderPlots(model); }; });
    drawPlot(model);
  }
  function drawPlot(model) {
    const note = $('#id-plotnote');
    note.textContent = '';
    if (!$('#id-plot').getBoundingClientRect().width) return;
    if (!model?.ok) { plot.frame({ x0: 0, x1: 1, y0: 0, y1: 1 }); plot.note(job ? 'the test runs: the plots come with the model' : 'no model yet'); return; }
    const n = model.names, cols = C().ch;
    const src = source(current()?.key);
    if (st.plot === 'check') {
      const ck = model.check;
      if (!ck) { plot.frame({ x0: 0, x1: 1, y0: 0, y1: 1 }); plot.note('no Check ran'); return; }
      const N = ck.yhat.length, t = Array.from({ length: N }, (_, k) => (ck.i0 + k) * model.Ts);
      const r = t.map((_, k) => src?.record.r[ck.i0 + k] ?? null);
      const lo = ck.yhat.map((v, k) => v - ck.band[k]), hi = ck.yhat.map((v, k) => v + ck.band[k]);
      const [y0, y1] = extent([...ck.y, ...lo, ...hi, ...r]);
      plot.frame({ x0: t[0], x1: t[N - 1], y0, y1, xunit: 's', ylabel: n.yUnit ? `${n.y} (${n.yUnit})` : n.y });
      plot.clip(() => {
        band(t, lo, hi, cols[0]);
        plot.line(t, r, { color: C().label, dash: [4, 3], width: 1 });
        plot.line(t, ck.y, { color: cols[1], width: 1.2 });
        plot.line(t, ck.yhat, { color: cols[0], width: 1.6 });
      });
      note.textContent = `measured (${n.y}) against the model's prediction and its 2σ band: ${fitText(ck.fit)} % (the noise allows ${fitText(ck.ceiling)} %)`;
    } else if (st.plot === 'step') {
      const slow = Math.max(...model.chain.filter((x) => ['lag', 'delay'].includes(x.kind)).map((x) => x.value), 1 / (model.params.f ?? Infinity) * 3, 10 * model.Ts);
      const sp = modelStep(model, Math.min(6 * slow + (model.params.theta ?? 0), 600));
      const kern = model.kernel ? kernelCurve(model.kernel, sp.t.at(-1)) : null;
      const [y0, y1] = extent([...sp.lo, ...sp.hi, 0, ...(kern ? kern.s : [])]);
      plot.frame({ x0: 0, x1: sp.t.at(-1), y0, y1, xunit: 's', ylabel: `${n.y} per ${n.uUnit || n.u}` });
      plot.clip(() => {
        band(sp.t, sp.lo, sp.hi, cols[0]);
        if (kern) plot.line(kern.t, kern.s, { color: cols[2], dash: [2, 3], width: 1.2 });
        plot.line(sp.t, sp.y, { color: cols[0], width: 1.6 });
      });
      note.textContent = `the model's step: one ${n.uUnit || 'unit'} more of ${n.u}, from rest${kern ? '; dotted: the kernel (no shape chosen)' : ''}`;
    } else if (st.plot === 'bode') {
      const nyq = Math.PI / model.Ts, slowest = Math.max(...model.chain.filter((x) => x.kind === 'lag').map((x) => x.value), model.params.f ? 1 / (2 * Math.PI * model.params.f) : 0, model.Ts);
      const wa = Math.min(0.05 / slowest, nyq / 1e3), w = Array.from({ length: 160 }, (_, i) => wa * (nyq / wa) ** (i / 159));
      const b = modelBode(model, w);
      const dB = (x) => 20 * Math.log10(Math.max(x, 1e-12));
      const mag = b.mag.map(dB), lo = Array.from(b.lo, (x) => dB(x)), hi = Array.from(b.hi, (x) => dB(x));
      const [y0, y1] = extent([...mag, ...hi].filter((v) => v > -200));
      plot.frame({ x0: w[0], x1: w.at(-1), y0: Math.max(y0, y1 - 80), y1, xlog: true, xlabel: 'rad/s', ylabel: '|G| dB' });
      plot.clip(() => { band(w, lo, hi, cols[0]); plot.line(w, mag, { color: cols[0], width: 1.6 }); });
      note.textContent = `|G|, as the loop sampled at ${fmtTime(model.Ts)} sees it, with its 2σ band; phase ${num(b.phase[Math.floor(w.length / 2)], 3)}° at ${num(w[Math.floor(w.length / 2)], 3)} rad/s (hover the plot keys for more)`;
    } else if (st.plot === 'where') {
      const pl = model.where ?? [];
      if (!pl.length) { plot.frame({ x0: 0, x1: 1, y0: 0, y1: 1 }); plot.note('one place only'); return; }
      const xs = pl.map((p) => p.level), ys = pl.flatMap((p) => [p.gain - 2 * p.gainSd, p.gain + 2 * p.gainSd]);
      const [x0, x1] = extent([...xs, ...pl.map((p) => p.from), ...pl.map((p) => p.to)]), [y0, y1] = extent([...ys, 0]);
      plot.frame({ x0, x1, y0, y1, xlabel: `place (${n.y}${n.yUnit ? `, ${n.yUnit}` : ''})`, ylabel: 'gain' });
      for (const p of pl) {
        const color = p.seen >= GRADE.seen ? cols[0] : fade(cols[0], C().alpha.unselected);
        plot.line([p.level, p.level], [p.gain - 2 * p.gainSd, p.gain + 2 * p.gainSd], { color, width: 1.4 });
        plot.mark(p.level, p.gain, { shape: 'dot', color, size: 6 });
      }
      note.textContent = `the gain at each place, ±2σ${model.whereSpread.flagged ? ': it differs by place, so one linear model is a compromise' : ''}`;
    } else if (st.plot === 'size') {
      const sz = model.size ?? [];
      if (!sz.length) { plot.frame({ x0: 0, x1: 1, y0: 0, y1: 1 }); plot.note('no pushes at one length to compare'); return; }
      const [x0, x1] = extent([0, ...sz.map((p) => p.a)]), [y0, y1] = extent([0, ...sz.map((p) => p.gain)]);
      plot.frame({ x0, x1, y0, y1, xlabel: `push (${n.u}${n.uUnit ? `, ${n.uUnit}` : ''})`, ylabel: 'apparent gain' });
      for (const p of sz) plot.mark(p.a, p.gain, { shape: p.complete ? 'dot' : 'o', color: cols[0], size: 6 });
      note.textContent = model.sizeNote ?? 'the apparent gain of each push of the Nudge: about the same at every size';
    } else {
      const ck = model.check;
      if (!ck) { plot.frame({ x0: 0, x1: 1, y0: 0, y1: 1 }); plot.note('no Check ran'); return; }
      const r = ck.autocorrelation, lags = r.map((_, i) => i + 1);
      plot.frame({ x0: 0, x1: lags.length + 1, y0: -1, y1: 1, xlabel: 'lag (samples)', ylabel: 'autocorrelation' });
      plot.line([0, lags.length + 1], [ck.limit, ck.limit], { color: C().label, dash: [4, 3], width: 1 });
      plot.line([0, lags.length + 1], [-ck.limit, -ck.limit], { color: C().label, dash: [4, 3], width: 1 });
      r.forEach((v, i) => plot.line([i + 1, i + 1], [0, v], { color: Math.abs(v) > ck.limit ? C().bad : cols[0], width: 2 }));
      note.textContent = `χ²/dof: ${model.candidates.map((x) => `${x.label} ${Number.isFinite(x.chi2dof) ? num(x.chi2dof, 3) : '–'}`).join(' · ')}${model.check.kernel !== null ? ` · the kernel explains ${fitText(model.check.kernel)} % of the Check` : ''}`;
    }
  }
  function band(x, lo, hi, color) {
    const g = plot.g;
    g.fillStyle = fade(color, C().alpha.past);
    g.globalAlpha = 1;
    g.beginPath();
    let started = false;
    for (let i = 0; i < x.length; i++) { const px = plot.X(x[i]), py = plot.Y(hi[i]); if (!Number.isFinite(py)) continue; if (started) g.lineTo(px, py); else { g.moveTo(px, py); started = true; } }
    for (let i = x.length - 1; i >= 0; i--) { const py = plot.Y(lo[i]); if (Number.isFinite(py)) g.lineTo(plot.X(x[i]), py); }
    g.closePath();
    g.save(); g.globalCompositeOperation = 'lighter'; g.fill(); g.restore();
  }

  // ---- Running the test: a simulated plant at the header's Speed, a live
  // plant in the live loop (ui/live.js, core/live.js) at its own clock.

  // kind: 'identify' (the whole test) or 'recheck' (Check again, §14).
  function start(kind = 'identify') {
    const ctx = context();
    if (job || !ctx.plan) { if (ctx.why) app.toast(ctx.why); return null; }
    let plan = ctx.plan, recheck = null;
    if (kind === 'recheck') {
      const { src, model } = modelOf(ctx.c.key);
      try { plan = planRecheck(src.plan, model, src.record); } catch (err) { app.toast(err.message); return null; }
      recheck = { model, record: src.record };
    }
    let run = null;
    if (!ctx.known.live) {
      try { run = identifyRun(app.project, ctx.c.path, {}, kind === 'recheck' ? { plan, recheck } : {}); } catch (err) { app.toast(err instanceof IdentifyError ? err.message : `Could not start: ${err.message}`); return null; }
      plan = run.plan;
    }
    app.beginEdit();
    const known = ctx.known;
    // y and u on the scope: if no channel shows them, on channels 3 and 4.
    const sc = app.project.scope, shows = (nm) => sc.channels.some((ch) => ch.on && ch.source === nm), names = app.signalNames();
    if (names.includes(known.y.name) && names.includes(known.u.name) && !shows(known.y.name) && !shows(known.u.name)) {
      Object.assign(sc.channels[2], { source: known.y.name, on: true, ...scaleFor(plan.band) });
      Object.assign(sc.channels[3], { source: known.u.name, on: true, ...scaleFor([plan.umin, plan.umax]) });
    }
    record.removeReferences((nm) => nm.startsWith(REF));
    job = {
      kind, live: known.live, run, plan, recheck, key: ctx.c.key, path: ctx.c.path, where: ctx.c.where, plant: app.project.system.plant, mode: display.mode, names: run?.names ?? [], known,
      wall: performance.now(), target: 0, tPlant: 0, timer: 0, fitting: false, stopping: false, rendered: 0, stageKey: '', checkDrawn: false,
      sweep: null, done: null, past: null, lastT: null, resolve: [], state: null, pre: null, work: null,
    };
    app.changedView();
    if (job.live) startLive(job);
    else {
      display.clearRuns();
      display.setFeed(poll);
      app.setRunMode('run');
      schedule();
    }
    renderAll();
    return job;
  }
  const stateOf = (j) => (j ? (j.live ? j.state : j.run.exp.state) : null);

  // On a live plant: the loop runs the experiment as the block's law; its
  // state comes here; the fit at the pause is made here and supplied back.
  async function startLive(j) {
    const L = app.live.identify;
    const desc = L.describe();
    L.on((m) => { if (job === j) onLive(j, m); });
    j.connection = L.connection();
    app.setRunMode('run');
    const hold = Object.fromEntries(j.plan.others.map((o) => [o.name, o.value]));
    const res = await L.start({ key: j.key, plan: j.plan, source: j.known.r?.source ?? null, hold, applied: desc.inputs.map((p) => p.name).indexOf(j.known.u.name) });
    if (res?.error && job === j) end({ status: `Could not start the test on the plant: ${res.error}` });
  }
  function onLive(j, m) {
    j.state = m.state;
    if (m.needs?.kind === 'fit') {
      // The fit pause: fitted in slices on the record so far, then supplied.
      j.fitting = true;
      const gen = identifySteps(compactRecord(m.record), { plan: j.plan, upto: m.needs.upto });
      work(j, gen, (pre) => { j.pre = pre; j.fitting = false; app.live.identify.supply('fit', pre.ok ? { structure: pre.structure, params: pre.params } : {}); });
    } else if (m.needs?.kind === 'discriminate') {
      // After the Check: do two shapes still tie? Then the test that tells them apart (input 56).
      j.fitting = true;
      work(j, discriminateSteps(m.record, j.plan, j.pre), (d) => { j.fitting = false; app.live.identify.supply('discriminate', d); });
    }
    if (m.check && j.pre && !j.checkDrawn) { j.checkDrawn = true; drawPrediction(j, m.record, m.state.checkAt, m.check); }
    if (m.done) {
      const record = compactRecord(m.record);
      const end0 = record.log.find((e) => e.kind === 'end') ?? { code: record.end, message: m.state.status };
      const base = { ok: false, block: { path: j.path, key: j.key, where: j.where }, plan: j.plan, record, end: { code: end0.code, message: end0.message }, time: record.y.length * j.plan.Ts, tries: m.state.tries };
      if (j.kind === 'recheck') { finish({ ...base, ok: end0.code === 'done', recheck: recheckFit(j.recheck.model, record, j.recheck.record) }); return; }
      j.fitting = true;
      work(j, identifySteps(record, { plan: j.plan, structure: stored(j.key).structure ?? null, reuse: j.pre }), (model) => finish({ ...base, ok: !!model.ok, model, settings: { structure: stored(j.key).structure ?? null } }));
    }
    if (performance.now() - j.rendered > RENDER) { j.rendered = performance.now(); renderExperiment(context()); }
  }
  // A generator's work in slices; then(value) at its end.
  function work(j, gen, then) {
    const go = () => {
      if (job !== j) return;
      const t0 = performance.now();
      try {
        for (;;) { const s = gen.next(); if (s.done) { then(s.value); return; } if (performance.now() - t0 > SLICE) break; }
      } catch (err) { end({ status: `Stopped: ${err.message}.` }); return; }
      setTimeout(go, 0);
    };
    setTimeout(go, 0);
  }

  const schedule = () => { if (job && !job.timer) job.timer = setTimeout(() => { if (job) { job.timer = 0; tick(); } }, app.speed() === AS_FAST || job.fitting ? 0 : 16); };
  function tick() {
    if (app.project.system.plant !== job.plant) { end({ status: 'Stopped: the plant changed during the test.', gone: true }); return; }
    const sp = app.speed(), now = performance.now();
    if (sp !== AS_FAST) job.target = (job.fitting ? job.tPlant : job.target) + Math.min(FRAME, (now - job.wall) / 1000) * sp;
    job.wall = now;
    const t0 = performance.now(), tBefore = job.tPlant;
    for (;;) {
      if (sp !== AS_FAST && !job.fitting && job.tPlant >= job.target) break;
      let s;
      try { s = job.run.steps.next(); } catch (err) { end({ status: `Stopped: ${err.message}.` }); return; }
      if (s.done) { app.timeRan(t0 / 1000, 0); app.timeRan(performance.now() / 1000, job.tPlant - tBefore); finish(s.value); return; }
      if (s.value.kind === 'sample') { job.fitting = false; sample(s.value); } else job.fitting = true;
      if (performance.now() - t0 > SLICE) break;
    }
    app.timeRan(t0 / 1000, 0);
    app.timeRan(performance.now() / 1000, job.tPlant - tBefore);
    if (performance.now() - job.rendered > RENDER) { job.rendered = performance.now(); renderExperiment(context()); }
    schedule();
  }
  // One controller sample: onto the scope's sweep; a new try (or stage of
  // the loop) starts a new sweep; the Check's prediction drawn first.
  function sample(v) {
    job.tPlant = v.t;
    const s = job.run.exp.state;
    const key = `${s.stage}|${s.try}|${s.checkAt ?? ''}`;
    const cut = key !== job.stageKey && ['hold', 'ease', 'shake', 'check'].includes(s.stage);
    job.stageKey = key;
    addSample(v.t, v.values, cut);
    if (s.checkAt !== null && !job.checkDrawn) { job.checkDrawn = true; drawPrediction(job, job.run.exp.record(), s.checkAt, job.run.exp.found.check); }
  }
  function windowOf() {
    const tb = app.project.scope.timebase;
    const w0 = Math.max(0, tb.position);
    return [w0, Math.max(tb.position + 10 * tb.scale - w0, 1e-6)];
  }
  const view = (s) => ({ t: s.t.subarray(0, s.n), signals: Object.fromEntries(job.names.map((nm, j) => [nm, s.cols[j].subarray(0, s.n)])) });
  function addSample(t, vals, cut) {
    const [w0, W] = windowOf();
    if (cut || !job.sweep || job.sweep.w0 !== w0 || job.sweep.W !== W || t - job.sweep.start >= W - 1e-9) {
      if (job.sweep?.n) job.done = view(job.sweep);
      const Ts = job.plan.Ts, every = Math.max(1, Math.ceil(W / Ts / MAX_SWEEP)), cap = Math.ceil(W / Ts / every) + 2;
      job.sweep = { w0, W, start: t, every, k: 0, n: 0, cap, t: new Float64Array(cap), cols: job.names.map(() => new Float64Array(cap)) };
    }
    const s = job.sweep;
    job.lastT = t;
    if (s.k++ % s.every || s.n >= s.cap) return;
    s.t[s.n] = s.w0 + (t - s.start);
    for (let j = 0; j < vals.length; j++) s.cols[j][s.n] = vals[j];
    s.n++;
  }
  function poll() {
    const s = job?.sweep;
    const out = { data: s ? view(s) : { t: new Float64Array(0), signals: {} }, scan: s && job.lastT !== null ? s.w0 + (job.lastT - s.start) : windowOf()[0], done: job?.done ?? null, past: null };
    if (job) job.done = null;
    return out;
  }
  // The model fitted at the pause, replayed under the incumbent on the
  // Check's reference from where it starts: "y · predicted", dashed, which
  // the measurement then sweeps over (§5.7). On a live plant the sweep is
  // the scope's own, so the prediction is placed at the Check's time.
  function drawPrediction(j, rec, i0, ref) {
    const pre = j.live ? j.pre : j.run.pre;
    if (!pre?.ok || !ref || j.kind === 'recheck') return;
    let p;
    try { p = predictCheck(pre, rec, { at: i0, r: ref }); } catch { return; }
    // Live: in plant time; a reference is shown from the sweep it starts in,
    // where the scope's own sweep draws the Check (record.js refShift).
    const [w0] = windowOf(), Ts = j.plan.Ts;
    const t0 = j.live ? i0 * Ts : w0;
    const t = Float64Array.from(p.y, (_, k) => t0 + k * Ts);
    record.trace({ t, signals: { [j.known.y.name]: p.y } }, `${REF}${j.known.y.name} · predicted`);
  }

  function finish(result) {
    const j = job;
    if (j.kind === 'recheck') {
      const rc = result.recheck;
      checks.set(j.key, { ...rc, connection: j.connection ?? null, ended: result.end.code === 'done' ? null : result.end.message });
      end({ status: result.end.code === 'done' ? `Check again: ${rc.message}` : result.end.message });
      return;
    }
    const name = `${j.known.y.name} · ${new Date().toTimeString().slice(0, 5)}`;
    checks.delete(j.key);
    fresh.set(j.key, { result, name, state: stateOf(j), plant: plantKey(), keptAs: null, connection: j.live ? j.connection : null });
    if (j.live) connections.set(recordHash(result.record), j.connection);
    const mk = modelKey({ record: result.record }, result.settings.structure);
    remember(mk, result.model);
    end({ status: result.end.message, result });
  }
  // Ends the test: the scope goes back to the loop's own run, with the
  // record (dashed) and the model's Check over it as references.
  function end({ status = '', result = null, gone = false } = {}) {
    if (!job) return;
    clearTimeout(job.timer);
    const j = job;
    job = null;
    app.endEdit();
    if (!j.live) {
      display.setFeed(null);
      if (!gone) { app.showLoop(); display.clearRuns(); }
      app.setRunMode(j.mode === 'single' ? 'stop' : j.mode);
    } else app.setRunMode('stop');
    record.removeReferences((nm) => nm.startsWith(REF));
    if (result?.model && !j.live) showRecord(result, j);
    if (status) app.toast(status);
    for (const f of j.resolve) f(result);
    renderAll();
  }
  function showRecord(res, j) {
    const rec = res.record, Ts = rec.Ts, n = rec.y.length, [w0] = windowOf();
    const t = Float64Array.from({ length: n }, (_, i) => w0 + i * Ts);
    const col = (a) => Float64Array.from(a, (v) => (v === null ? NaN : v));
    const signals = { [j.known.y.name]: col(rec.y), [j.known.u.name]: col(rec.u) };
    if (j.known.r?.source) signals[j.known.r.source] = col(rec.r);
    const name = `${REF}record`;
    record.trace({ t, signals }, name);
    const ck = res.model.check;
    if (ck) {
      const yh = new Float64Array(n).fill(NaN);
      ck.yhat.forEach((v, k) => { yh[ck.i0 + k] = v; });
      record.trace({ t, signals: { [j.known.y.name]: yh } }, `${REF}${j.known.y.name} · model`);
      record.showReference(name, ck.i0 * Ts + w0);
    }
  }
  function stop() {
    if (!job || job.stopping) return;
    job.stopping = true;
    if (job.live) app.live.identify.stop(); else job.run.stop();
    renderAll();
  }

  function renderAll() {
    if (host.hidden && !job) return;
    const c = current();
    $('.ident').hidden = !c;
    $('#id-empty').hidden = !!c;
    if (!c) {
      $('#id-empty').innerHTML = '<div class="notice"><h3 class="label">Nothing to identify</h3><p class="note">Identify finds the plant a <b>Controller</b> block drives, by one experiment that eases in. Add a Controller block in the Plant tab, or load a controlled system from the <b>System library</b>, such as <b>Oven, badly tuned</b>.</p></div>';
      return;
    }
    const ctx = renderKnown();
    renderExperiment(ctx);
    const model = renderModel();
    renderPlots(model);
    bind();
  }
  function bind() {
    host.querySelectorAll('[data-path]').forEach((el) => { el.onclick = () => { if (job) return; st.target = el.dataset.path; renderAll(); }; });
    const c = current();
    const budget = $('#id-budget');
    if (budget) budget.onchange = () => { const v = Number(budget.value); budget.blur(); setSetting(c.key, 'budget', v === 120 ? null : v); };
    host.querySelectorAll('#id-known input[data-k]').forEach((inp) => {
      inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.dataset.cancel = '1'; inp.blur(); } };
      inp.onblur = () => {
        if (inp.dataset.cancel || job) { delete inp.dataset.cancel; setTimeout(renderAll); return; }
        const kind = inp.dataset.k.slice(0, -1);
        const a = $(`[data-k="${kind}0"]`).value.trim(), b = $(`[data-k="${kind}1"]`).value.trim();
        if (kind === 'hard' && !a && !b) { setSetting(c.key, 'hard', null); return; }
        if (kind === 'band' && !a && !b) { setSetting(c.key, 'band', null); return; }
        const lo = parseSI(a), hi = parseSI(b);
        if (!(Number.isFinite(lo) && Number.isFinite(hi))) { if (a && b) app.toast('Enter two numbers, low and high.'); return; }
        if (!(hi > lo)) { app.toast('The low end goes first, below the high end.'); setTimeout(renderAll); return; }
        const was = stored(c.key)[kind];
        if (was && was[0] === lo && was[1] === hi) return;
        setSetting(c.key, kind, [lo, hi]);
      };
    });
  }
  $('#id-start').onclick = () => { if (job) stop(); else start('identify'); };
  $('#id-strip').addEventListener('click', (e) => {
    const rec = source(current()?.key)?.record;
    if (!rec) return;
    const r = e.currentTarget.getBoundingClientRect(), i = Math.round(((e.clientX - r.left) / r.width) * (rec.y.length - 1));
    const stages = (rec.log ?? []).filter((x) => x.kind === 'stage');
    const at = [...stages].reverse().find((x) => (x.i ?? 0) <= i) ?? stages[0];
    if (!at) return;
    if (!record.showReference(`${REF}record`, (at.i ?? 0) * rec.Ts + windowOf()[0])) {
      const res = fresh.get(current().key)?.result;
      if (res) { showRecord(res, { known: knownFor(app.project, current().path) }); record.showReference(`${REF}record`, (at.i ?? 0) * rec.Ts + windowOf()[0]); }
    }
    app.toast(`On the scope, dashed: the ${STAGE_SHORT[at.stage] ?? at.stage} of the test (◀ ▶ under the screen step through the record).`);
  });
  new ResizeObserver(() => { if (!host.hidden) { const c = current(); drawPlot(c && !job ? modelOf(c.key).model : null); const rec = c && !job ? source(c.key)?.record : null; if (rec) drawStrip(rec); } }).observe($('#id-plot'));

  // What the test is doing, for the scope's status line.
  function tag() {
    if (!job || job.live) return null;
    const s = stateOf(job);
    const stage = job.fitting ? 'fitting' : `${(STAGE_SHORT[s.stage] ?? s.stage).toLowerCase()}${s.stage === 'ease' ? ` ${s.try}` : ''}`;
    return { lamp: 'warn', outline: true, text: 'Identify', note: `${stage} · push ${Math.round(100 * s.push)} % · room ${Math.round(100 * s.room)} %`, state: 'identify' };
  }

  // For agents: the whole test, as the tab runs it (at the header's Speed).
  function api(opts = {}) {
    if (job) return Promise.reject(new Error('identify: a test is running; wait for it, or stop it'));
    if (opts.block) st.target = String(opts.block);
    const c = current();
    if (!c) return Promise.reject(new Error('identify: there is no Controller block'));
    const before = structuredClone(app.project.system.identify ?? null);
    const set = { band: opts.band, budget: opts.budget, vary: opts.vary };
    if (Object.values(set).some((v) => v !== undefined)) app.editProject((p) => { const e = ((p.system.identify ??= {})[c.key] ??= {}); for (const [k, v] of Object.entries(set)) if (v !== undefined) e[k] = v; });
    const j = start();
    if (!j) { if (before === null) delete app.project.system.identify; else app.project.system.identify = before; return Promise.reject(new Error(`identify: ${context().why ?? 'cannot start'}`)); }
    return new Promise((resolve) => j.resolve.push(resolve)).then((res) => {
      if (!res) return { ok: false, why: 'stopped before the end' };
      if (opts.keep) keep(c, { plan: res.plan, record: res.record });
      return report(res.model, { end: res.end, time: res.time, tries: res.tries, kept: !!opts.keep });
    });
  }
  function identified(block) {
    const c = block ? blocks().find((x) => x.key === String(block)) : current();
    if (!c) return null;
    const { model } = modelOf(c.key);
    return model ? report(model) : null;
  }

  return {
    render() { if (!host.hidden) renderAll(); },
    shown: renderAll,
    tag,
    stop() { if (job) stop(); },
    running: () => !!job,
    // The scope's Stop while the test runs: the test stops, softly.
    scopeStopped() { if (job) stop(); },
    api: { identify: api, identified },
  };
}

const REF = 'identify · ';
const STAGE_SHORT = { listen: 'Listen', nudge: 'Nudge', hold: 'Hold', ease: 'Ease in', shake: 'Shake', check: 'Check' };
const STAGE_ABOUT = {
  Listen: 'u held still for 3 s: the page measures the noise and any drift',
  Nudge: 'tiny pushes back and forth, each a little larger or longer, only while the last one stayed well inside the room',
  Hold: 'a deliberately gentle controller, built from the Nudge, brings y to where the reference starts',
  'Ease in': 'your reference again and again, each try asking the controller to be 30 % quicker, until a try rings, comes near the edge or stops improving',
  Shake: 'a mix of tones under the gentle loop, only when the model is unsure',
  Check: 'a test the model has not seen, its prediction drawn first',
};

// The model as an agent reads it: plain data, the sentences first.
function report(model, extra = {}) {
  const m = JSON.parse(JSON.stringify(model));
  delete m.cov;
  return { ok: !!m.ok, sentences: m.sentences, grade: m.grade, why: m.why, structure: m.structure ?? null, params: m.params ?? null, sd: m.sd ?? null, chain: m.chain ?? [], check: m.check ? { fit: m.check.fit, ceiling: m.check.ceiling, kernel: m.check.kernel } : null, eased: m.eased ?? null, candidates: (m.candidates ?? []).map((c) => ({ structure: c.structure, fit: c.fit, grade: c.grade })), where: m.where ?? [], warnings: m.warnings ?? [], ...extra };
}

// The kernel's step (the model keeps its taps, not their covariance): the
// running sum of its impulse response, then its rate for an integrating one.
function kernelCurve(k, T) {
  const dt = k.Ts, D = k.decimate ?? 1, n = k.g.length, N = Math.max(n, Math.ceil(T / dt));
  const t = [0], s = [0];
  let m = 0;
  for (let I = 1; I <= N; I++) { m += I <= n ? k.g[I - 1] : k.rate ? k.rate.value * D : 0; t.push(I * dt); s.push(m); }
  return { t, s };
}

function rangeBar(lo, hi, at) {
  const pct = Math.round((100 * (at - lo)) / (hi - lo));
  return `<span class="idbar idrange" aria-hidden="true"><span class="idmark idstart" style="left:${Math.min(100, Math.max(0, pct))}%"></span></span>`;
}
const scaleFor = ([lo, hi]) => ({ scale: Number(((hi - lo) / 8).toPrecision(3)), offset: Number((-(lo + hi) / 2).toPrecision(6)) || 0 });
const fitText = (x) => (x >= 99 && x < 100 ? Math.min(99.9, Math.round(x * 10) / 10).toFixed(1) : String(Math.round(x)));
function fmtTime(t) { return t < 1 ? `${num(t * 1000, 3)} ms` : `${num(t, 3)} s`; }
function clock(s) { const m = Math.floor(s / 60), r = Math.floor(s - 60 * m); return `${m}:${String(r).padStart(2, '0')}`; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
