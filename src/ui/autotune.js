// Tab 4, Auto-tune: improve a Controller block's running variant by
// simulation. Three methods (src/core/autotune.js): iterate (Nelder–Mead on a
// cost, one step at a time so the improvement can be watched), relay
// (Åström–Hägglund: Ku and Pu, then a rule) and step response (a model fit,
// then SIMC). Every result goes into a variant of its own, "<original> ·
// auto-tuned" (or "· relay T–L", "· SIMC"), so the original stays for
// comparison; the whole run is one undo step. Its runs go at the header's
// Speed (ui/speed.js): Iterate sweeps each run it tries across the display at
// that speed, each lasting its own length, and computes the next one
// meanwhile; as fast as possible, it computes in slices between frames, so
// the page keeps drawing. See design/output/autotune.md.

import { controllerBlocks, tuneContext, tunedValues, autotuneSteps, whyNot, resultName, placeVariant, RULES, SIMC, COSTS, GOAL, tauCSource, tauCShort } from '../core/autotune.js';
import { twinProject, modelTuneSteps } from '../core/identify.js';
import { CONTROLLERS } from '../core/controllers.js';
import { num, parseSI } from './units.js';
import { AS_FAST, formatSpeed } from '../core/speed.js';
import { palette as C, fade } from './palette.js';

const METHODS = {
  iterate: {
    label: 'Iterate', sub: 'Nelder–Mead on the cost',
    about: 'Runs the loop, scores the run by the goal, changes the gains and runs again, keeping what scores better (the Nelder–Mead simplex search, 1965). Each improvement shows on the display; the runs before it fade.',
  },
  relay: {
    label: 'Relay', sub: 'Åström–Hägglund → Ku, Pu → rule',
    about: 'A relay replaces the controller around the middle of r, so the loop oscillates at its ultimate period Pu; the amplitude gives the ultimate gain Ku (Åström & Hägglund 1984, as industrial auto-tuners do). A rule turns Ku and Pu into a PID.',
  },
  step: {
    label: 'Step response', sub: 'model fit → SIMC',
    about: 'The running controller holds r at the middle of its range until y has settled within 2 % (of how far it moved, or of r\'s span; a steady ripple averaged out); then u is held and stepped. A controller that keeps swinging there hands over at the start instead. A response that settles gives a gain K, a lag τ and a dead time θ; one that ramps (an integrating plant, such as a motor\'s angle) gives a slope k′, a lag τ2 and a dead time θ, and the test ends once the slope is steady and the lag has faded. SIMC (Skogestad 2003) turns the model into a PI, or a PID when the lag of an integrating plant outlasts its dead time; a PID\'s derivative filter counts as dead time. A gain-scheduled PI is tested at each point of its table and gets SIMC gains there.',
  },
};
const SLICE = 30;    // ms of computing per task, so the page keeps drawing
const HOLD = 400;    // ms an experiment stays on the display after its sweep
const POLL = 100;    // ms between looks at whether a sweep has ended, besides the display's word
const IMPROVE = 250; // ms at least between two improvements shown at ∞ (each redraws the page)
const GOAL_ABOUT = 'The cost of one run: the error r − y (IAE, ITAE or ISE), plus the effort (the swing of u), the overshoot beyond the bound, and the time u sits at a limit. Over one period of the input, the disturbance d included.';

export function createAutotuneTab(host, app, display) {
  // Settings of this page session (not saved in the project).
  const st = { target: null, method: 'iterate', goal: { ...GOAL }, rule: 'tl', simc: 'tight', amplitude: 0.1, maxIter: 60, feedforward: false, unlimited: false };
  let job = null;   // the run in progress
  let shown = null; // what the progress column shows: the current or last run

  host.innerHTML = `
    <div class="tune">
      <section class="gcol" aria-label="Controller to tune">
        <div class="ghead"><h3 class="label">Controller</h3></div>
        <div id="tu-blocks" class="ctblocks"></div>
        <div id="tu-src"></div>
        <ul class="lcd list turows" id="tu-now"></ul>
        <p class="note" id="tu-target"></p>
      </section>
      <section class="gcol" aria-label="Method">
        <div class="ghead"><h3 class="label">Method</h3></div>
        <div class="choices" id="tu-methods" role="radiogroup" aria-label="Method"></div>
        <div id="tu-opts" class="pform"></div>
      </section>
      <section class="gcol" aria-label="Goal">
        <div class="ghead"><h3 class="label">Goal</h3></div>
        <div class="seg" id="tu-costs" role="radiogroup" aria-label="Cost"></div>
        <div id="tu-goal" class="pform"></div>
        <p class="note" id="tu-goalhelp" title="${esc(GOAL_ABOUT)}"></p>
      </section>
      <section class="gcol tuprogress" aria-label="Progress">
        <div class="ghead"><h3 class="label" id="tu-ptitle">Progress</h3>
          <button type="button" class="btn btn-sm" id="tu-fast" aria-pressed="false" title="Pressed, the tune runs at unlimited speed (Speed ∞ in the header) and the speed set before comes back when it ends. Not offered with a live plant: it runs in real time.">Unlimited speed</button>
          <button class="btn btn-sm" id="tu-try" hidden title="Takes the result to the plant in three steps from the controller that held in Identify's test, each screened on the model first; a monitor falls back to that controller when the plant does not behave as predicted. On a simulated plant: the same on the diagram, as a demonstration.">Try on the plant</button>
          <button class="btn btn-sm" id="tu-start">Start</button></div>
        <div class="note tustatus" id="tu-status" role="status"></div>
        <div class="note" id="tu-tried" role="status" hidden></div>
        <canvas class="tuplot" id="tu-plot" aria-label="Cost against iteration"></canvas>
        <ul class="lcd list turows wide" id="tu-result"></ul>
      </section>
    </div>
    <div id="tu-empty" hidden></div>`;
  host.insertAdjacentHTML('afterbegin', '<div class="banner notloop" id="tu-notloop" role="note" hidden></div>');
  const $ = (s) => host.querySelector(s);

  const root = () => (app.project.system.plant?.type === 'diagram' ? app.project.system.plant.diagram : null);
  const blocks = () => controllerBlocks(root());
  const current = () => { const all = blocks(); return all.find((c) => c.key === st.target) ?? all[0] ?? null; };
  // The block's tuning context, or why there is none (an unwired input, …).
  // On the identified model (ui/plantsource.js) the context is the twin's:
  // the model in the plant's place, with the test push (identification.md §10).
  const context = () => {
    const c = current();
    const src = c ? app.plantSource.state(c.key) : null;
    try {
      if (src?.on !== 'identified') return { ctx: tuneContext(app.project, c?.path) };
      if (src.why || src.wait) return { why: src.why ?? src.note, src };
      const twin = twinProject(app.project, c.path, src.use.model);
      return { ctx: tuneContext(twin.project, twin.path), twin, src };
    } catch (err) { return { why: err.message, src }; }
  };
  const onModel = () => { const c = current(); return !!c && app.plantSource.get(c.key) === 'identified'; };
  const unitY = () => { const c = current(); return c ? app.unitOf(inputName(c, 1)) : ''; };
  // The name of the signal on a block input, for its unit: the Source it
  // comes from, or a Sink that shows the same wire.
  function inputName(c, port) {
    let lv = root();
    for (const id of c.path.slice(0, -1)) lv = lv.blocks.find((b) => b.id === id).diagram;
    const byId = (id) => lv.blocks.find((b) => b.id === String(id).split(':')[0]);
    const w = lv.wires.find((x) => { const [id, k = '0'] = String(x.to).split(':'); return id === c.block.id && Number(k) === port; });
    if (!w) return '';
    if (byId(w.from)?.type === 'source') return byId(w.from).params.signal;
    const sink = lv.wires.find((x) => x.from === w.from && byId(x.to)?.type === 'sink');
    return sink ? byId(sink.to).params.name : '';
  }

  // ---- Setup columns ----------------------------------------------------

  function field(key, label, value, hint) {
    return `<label class="pf"><span class="flabel">${esc(label)}</span><input class="field field-sm mono" data-k="${key}" value="${esc(value)}" spellcheck="false" inputmode="decimal" ${job ? 'disabled' : ''}><span class="hint">${esc(hint)}</span></label>`;
  }
  // A container being typed in is not redrawn.
  const editing = (el) => el.contains(document.activeElement) && document.activeElement.matches('input, select');

  function renderSetup() {
    const c = current();
    // Reference mode (Live): the plant runs its own controller; Auto-tune is
    // not in the loop and does not start (tuneContext refuses).
    const notLoop = ['reference', 'log'].includes(app.hilMode?.());
    $('#tu-notloop').hidden = !notLoop || !c;
    if (notLoop) $('#tu-notloop').innerHTML = '<span class="banner-text"><b class="text-bad">Not in the loop.</b> This system\'s plant runs its own controller (reference mode): Auto-tune has nothing here to tune, and Start stays off.</span>';
    $('.tune').hidden = !c;
    $('#tu-empty').hidden = !!c;
    if (!c && notLoop) {
      $('#tu-empty').innerHTML = '<div class="notice"><h3 class="label">Auto-tune is not in the loop</h3><p class="note">In reference mode the External plant runs its own controller, with its own limits and monitoring; the page only sends the references and records. There is no controller here for Auto-tune to tune. To tune a controller in this page, use a plant in control mode, such as <b>HIL: an external plant</b>.</p></div>';
      return;
    }
    if (!c) {
      $('#tu-empty').innerHTML = '<div class="notice"><h3 class="label">Nothing to tune</h3><p class="note">Auto-tune improves a <b>Controller</b> block of the plant. Add one in the Plant tab (library, Control group), or load a controlled system from the <b>System library</b>: <b>Oven, badly tuned</b> is made for this tab.</p></div>';
      return;
    }
    renderButton();
    const all = blocks();
    const v = c.block.variants[c.block.variant ?? 0];
    $('#tu-blocks').innerHTML = all.length > 1
      ? all.map((x) => `<button class="btn btn-block" data-path="${esc(x.key)}" aria-pressed="${x.key === c.key}" ${job ? 'disabled' : ''}>${esc(x.where)}</button>`).join('')
      : `<div class="heading">${esc(c.where)}</div>`;
    const { ctx, why: noCtx } = context();
    $('#tu-src').innerHTML = app.plantSource.html(c.key, { disabled: !!job });
    app.plantSource.bind($('#tu-src'), c.key);
    // A variant from the plant is tuned as its Copy as numbers twin, from the
    // numbers its design computes now (core/autotune.js, asTuned).
    const twin = ctx?.designed?.from ? ctx.variant : null;
    const why = noCtx ?? whyNot(ctx, st.method);
    // The note says how a variant from the plant is tuned; where the method
    // cannot tune it (a swing-up), the reason below says so instead.
    $('#tu-now').innerHTML = `<li class="tuhead"><b>${esc(v.name)}</b><span class="hint">${esc(CONTROLLERS[v.type]?.label ?? v.type)} · running</span></li>`
      + (twin && !why ? `<li class="tunote">from the plant: tuned as a ${esc(CONTROLLERS[twin.type].label)}, from the numbers it computes now</li>` : '')
      + tunedValues(twin ?? v).map(([k, x]) => `<li class="turow"><span>${esc(k)}</span><span>${show(x)}</span></li>`).join('');
    const into = job ? job.name : resultName(c.block, st.method, st.rule, st.simc, { model: onModel() });
    const target = $('#tu-target');
    if (job) { target.innerHTML = `Into <b>${esc(into)}</b>`; target.title = `${shown.before?.variant.name ?? v.name} stays as it was.`; }
    else if (why) { target.innerHTML = `<span class="text-bad">${esc(why)}</span>`; target.title = ''; }
    else if (into === v.name) { target.innerHTML = `Updates <b>${esc(into)}</b>`; target.title = 'Tuning again from a tuned variant updates it in place.'; }
    else {
      target.innerHTML = `Into <b>${esc(into)}</b>`;
      target.title = `The result goes into a variant of its own; ${v.name} stays, to compare in the Controller tab. An earlier result is never overwritten: a new one is numbered.`;
    }

    $('#tu-methods').innerHTML = Object.entries(METHODS).map(([k, m]) => `<button class="btn btn-block btn-col" data-method="${k}" role="radio" aria-checked="${k === st.method}" title="${esc(m.about)}" ${job ? 'disabled' : ''}>${m.label}<span class="btn-note">${m.sub}</span></button>`).join('');
    if (!editing($('#tu-opts'))) {
      const opts = [];
      if (st.method === 'iterate') opts.push(field('maxIter', 'Iterations', st.maxIter, 'at most; stops when the cost stops falling'));
      // Feedforward gains that are not 0 are tuned anyway; this adds those at 0.
      if (st.method === 'iterate' && CONTROLLERS[v.type]?.params.some((p) => p.key === 'Kff')) opts.push(`<div class="pf" title="Kff, Kv and Ka that are not 0 are always tuned. Pressed, those at 0 are tuned too, from a fit of the starting run's u to the reference (what the feedforward should put out: Kff where the loop rests, Kv and Ka where r moves); a gain the reference does not explain stays 0. The feedforward is tuned first with the feedback held, then the feedback with the feedforward held; a run without a disturbance cannot judge the feedback then, so it is held."><span class="flabel">Feedforward</span><button type="button" class="btn btn-sm" id="tu-ff" aria-pressed="${st.feedforward}" ${job ? 'disabled' : ''}>Tune those at 0 too</button><span class="hint">Kff, Kv, Ka</span></div>`);
      if (st.method === 'relay') opts.push(`<label class="pf"><span class="flabel">Rule</span><select class="field field-sm" id="tu-rule" ${job ? 'disabled' : ''}>${Object.entries(RULES).map(([k, r]) => `<option value="${k}" ${k === st.rule ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select><span class="hint">${esc(RULES[st.rule].about)}</span></label>`);
      if (st.method === 'step') opts.push(`<label class="pf"><span class="flabel">SIMC τc</span><select class="field field-sm" id="tu-simc" ${job ? 'disabled' : ''}>${Object.entries(SIMC).map(([k, r]) => `<option value="${k}" ${k === st.simc ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select><span class="hint">${esc(SIMC[st.simc].about)}</span></label>`);
      if (st.method !== 'iterate') opts.push(field('amplitude', st.method === 'relay' ? 'Relay ±d' : 'Step Δu', num(100 * st.amplitude, 3), '% of the actuator range'));
      $('#tu-opts').innerHTML = opts.join('');
    }

    $('#tu-costs').innerHTML = Object.keys(COSTS).map((k) => `<button class="btn btn-sm" data-cost="${k}" role="radio" aria-checked="${k === st.goal.cost}" title="${esc(COSTS[k])}" ${job ? 'disabled' : ''}>${k}</button>`).join('');
    if (!editing($('#tu-goal'))) {
      $('#tu-goal').innerHTML = field('effort', 'Effort weight', num(st.goal.effort, 3), 'on the swing of u; 0 ignores it')
        + field('overshoot', 'Overshoot ≤', num(st.goal.overshoot, 3), '% of a step; beyond costs extra');
    }
    $('#tu-goalhelp').textContent = st.method === 'iterate' ? 'Over one period of the input, d included.' : 'The rule ignores the goal; it scores the result.';
    bind();
  }

  function bind() {
    host.querySelectorAll('[data-path]').forEach((el) => { el.onclick = () => { if (job) return; st.target = el.dataset.path; shown = null; renderAll(); }; });
    host.querySelectorAll('[data-method]').forEach((el) => { el.onclick = () => { if (job) return; st.method = el.dataset.method; renderAll(); }; });
    host.querySelectorAll('[data-cost]').forEach((el) => { el.onclick = () => { if (job) return; st.goal.cost = el.dataset.cost; renderSetup(); }; });
    const rule = $('#tu-rule');
    if (rule) rule.onchange = () => { if (job) return; st.rule = rule.value; rule.blur(); renderSetup(); };
    const simc = $('#tu-simc');
    if (simc) simc.onchange = () => { if (job) return; st.simc = simc.value; simc.blur(); renderSetup(); };
    const ff = $('#tu-ff');
    if (ff) ff.onclick = () => { if (job) return; st.feedforward = !st.feedforward; renderSetup(); };
    host.querySelectorAll('input[data-k]').forEach((inp) => {
      inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.dataset.cancel = '1'; inp.blur(); } };
      inp.onblur = () => {
        if (inp.dataset.cancel || job) { delete inp.dataset.cancel; setTimeout(renderSetup); return; }
        const v = parseSI(inp.value), k = inp.dataset.k;
        const ok = Number.isFinite(v) && v >= 0 && (k !== 'maxIter' || v >= 1) && (k !== 'amplitude' || (v > 0 && v <= 100));
        if (!ok) app.toast(k === 'amplitude' ? 'Enter a percentage above 0, up to 100.' : 'Enter a number, 0 or more.');
        else if (k === 'maxIter') st.maxIter = Math.round(v);
        else if (k === 'amplitude') st.amplitude = v / 100;
        else st.goal[k] = v;
        setTimeout(renderSetup);
      };
    });
  }

  function renderButton() {
    const { ctx, why } = context();
    const b = $('#tu-start');
    b.textContent = job ? 'Stop' : 'Start';
    b.className = `btn btn-sm${job ? ' btn-danger' : ''}`;
    b.disabled = !job && !!(why ?? whyNot(ctx, st.method));
    // Unlimited speed only where the speed can be raised (a live plant holds 1×).
    const fast = $('#tu-fast');
    fast.hidden = !!app.speedLock?.();
    fast.setAttribute('aria-pressed', String(st.unlimited));
    fast.disabled = !!job;
  }

  // ---- Running ------------------------------------------------------------

  // Puts a variant into the block (over the result of this run, or as a new
  // one after the running variant). The first change opens the run's undo
  // step; the run takes no other.
  function place(variant, run, from = null) {
    if (!job.edit) { app.beginEdit(); job.edit = true; }
    // On the model the tuner's run is not the screen's; on a plant outside
    // the page the result is added but not run (Try on the plant hands it over).
    if (job.model) from = null;
    if (job.hil) run = false;
    app.tuneEdit((p) => placeVariant(p, job.path, variant, { run }), from);
    if (run) job.ran = true;
    shown.placed = structuredClone(variant);
  }

  function start() {
    const c = current();
    const { ctx, why: noCtx } = context();
    const why = noCtx ?? whyNot(ctx, st.method);
    if (!c || why) { app.toast(why ?? 'There is no Controller block to tune.'); return; }
    // The settings are copied: changing them during the run changes nothing.
    const goal = { ...st.goal };
    const model = onModel(), hil = app.plantSource.hil();
    const name = resultName(c.block, st.method, st.rule, st.simc, { model });
    const opts = { method: st.method, goal, rule: st.rule, simc: st.simc, amplitude: st.amplitude, maxIter: st.maxIter, feedforward: st.feedforward, name };
    // On the model, a simulated plant's result is scored on the diagram too.
    const use = model ? app.plantSource.state(c.key).use : null;
    const gen = model ? modelTuneSteps(app.project, c.path, use.model, { ...opts, diagram: !hil }) : autotuneSteps(app.project, c.path, opts);
    shown = { method: st.method, rule: st.rule, goal, key: c.key, title: app.project.title, history: [], status: st.method === 'iterate' ? 'Scoring the running variant…' : 'Running the experiment…', before: null, best: null, res: null, placed: null, unit: unitY(), on: model ? app.plantSource.label(use) : null };
    // bests: the loop's run with each better set of gains, newest first; the
    // display fades them behind the run on screen. queue: steps computed
    // ahead, not yet taken. bestRun: the run of the best gains so far (it
    // stands for the screen's when that is the same simulation; app.tuneEdit).
    job = {
      gen, kind: st.method, name, path: c.path, plant: app.project.system.plant, ctx, mode: display.mode, startData: display.data, model, hil,
      timer: 0, lookTimer: 0, improveTimer: 0, improvedAt: 0, stepMs: 0, queue: [], playing: false,
      edit: false, ran: false, swept: false, showing: false, applied: Infinity, runs: 0, bests: [display.data], seenBest: null, bestRun: null,
    };
    // Unlimited speed (the person, input 45): the header's Speed goes to ∞ for
    // the run and back to what it was when the run ends.
    if (st.unlimited && !app.speedLock?.() && app.speedSet() !== AS_FAST) { job.speedBefore = app.speedSet(); app.setSpeed(AS_FAST); }
    // The display stands still for every method: it shows the tuner's runs,
    // and at ∞ the readout counts the tuner's computing.
    app.setRunMode('stop');
    if (st.method === 'iterate') display.clearRuns();
    renderAll();
    schedule();
  }

  const replaced = () => job && app.project.system.plant !== job.plant;
  // The next slice of computing, in a task of its own.
  const schedule = () => { if (job && !job.timer) job.timer = setTimeout(() => { if (job) { job.timer = 0; tick(); } }, 0); };

  // One step of the method: { value, done }, or { error }. stepMs follows
  // how long a step takes, so a slice stops before the next would overrun it.
  function compute() {
    const t0 = performance.now();
    let s;
    try { s = job.gen.next(); } catch (err) { s = { error: err }; }
    job.stepMs = Math.max(performance.now() - t0, 0.8 * job.stepMs);
    return s;
  }
  // The next step: one computed ahead, else a new one.
  const step = () => (job.queue.length ? job.queue.shift() : compute());

  // Steps the method. Iterate at a finite speed: computes ahead up to the
  // next run of the loop, which then sweeps across the display at that speed
  // and lasts its own length (a 5 s run takes 5 s at 1×, 0.5 s at 10×), while
  // the run after it is computed. As fast as possible, and the experiments'
  // runs at any speed (they are shown once they are done): in slices of
  // about SLICE ms between frames. At ∞ with the display standing still, the
  // simulated time computed counts as the achieved speed.
  function tick() {
    if (!job) return;
    if (replaced()) { end('Stopped: the plant changed while tuning.', { gone: true }); return; }
    if (job.kind === 'iterate' && app.speed() !== AS_FAST) { ahead(); return; }
    if (job.playing) return;  // a run still sweeps: when it ends, swept() goes on
    const t0 = performance.now(), counting = app.speed() === AS_FAST && display.mode === 'stop';
    let iterated = false, seconds = 0;
    const count = () => { if (counting) { app.timeRan(t0 / 1000, 0); app.timeRan(performance.now() / 1000, seconds); } };
    for (;;) {
      const s = step();
      if (s.error) { end(`Stopped: ${s.error.message}.`); return; }
      if (s.done) { count(); improve(); finish(s.value); return; }
      seconds += s.value.seconds ?? 0;
      if (take(s.value)) iterated = true;
      if (performance.now() - t0 + job.stepMs > SLICE) break;
    }
    count();
    // An improvement goes into the project in a task of its own, a few
    // times a second at most: placing it redraws the page.
    if (iterated) improveSoon();
    if (job.kind !== 'iterate') shown.status = `Running the ${job.kind === 'relay' ? 'relay experiment' : 'step test'}… (${job.runs} run${job.runs === 1 ? '' : 's'} of the loop)`;
    renderProgress();
    schedule();
  }

  // What a step of the method tells: the runs, the start, the best so far, the
  // history of the cost plot. True at the end of an iteration.
  function take(v) {
    if (v.seconds) job.runs++;
    if (v.before) shown.before ??= v.before;
    // The run in which the best changed is the run of the best gains.
    if (v.best && v.best !== job.seenBest) { job.seenBest = v.best; job.bestRun = v.run ?? null; }
    if (v.start) {
      shown.before ??= { variant: v.start.variant, cost: v.start.detail };
      Object.assign(shown, { best: v.best, iteration: v.iteration, evals: v.evals });
    }
    if (job.kind === 'iterate' && !v.partial) {
      shown.status = 'Tuning…';
      shown.history.push({ iteration: v.iteration, cost: v.cost, tried: v.tried });
      return true;
    }
    return false;
  }

  // Iterate at a finite speed: computes ahead, in slices, up to the next run
  // of the loop while the one before sweeps (Nelder–Mead needs only a run's
  // cost, known before its sweep); the steps are taken when it sweeps.
  const ready = () => { const s = job.queue.at(-1); return !!s && (!!s.error || !!s.done || !!s.value?.run); };
  function ahead() {
    const t0 = performance.now();
    while (!ready()) {
      job.queue.push(compute());
      if (!ready() && performance.now() - t0 + job.stepMs > SLICE) { schedule(); return; }
    }
    if (!job.playing) playNext();
  }
  // Takes the steps computed ahead, up to the next run, which sweeps; the one
  // after it is computed meanwhile.
  function playNext() {
    while (job.queue.length) {
      const s = job.queue.shift();
      if (s.error) { end(`Stopped: ${s.error.message}.`); return; }
      if (s.done) { improve(); finish(s.value); return; }
      take(s.value);
      if (s.value.run) { sweep(s.value.run); break; }
    }
    renderProgress();
    schedule();
  }
  // Calls then() once the sweep on the display has ended: when the display
  // says so (in the frame the sweep ends), or when Run or Single was pressed
  // meanwhile (the scope's Stop stops the tuning: scopeStopped).
  function afterSweep(then) {
    const go = () => { if (!job || job.next !== go) return; job.next = null; clearTimeout(job.lookTimer); then(); };
    job.next = go;
    const look = () => { if (!job || job.next !== go) return; if (display.mode !== 'single') go(); else job.lookTimer = setTimeout(look, POLL); };
    job.lookTimer = setTimeout(look, POLL);
  }
  // The display's sweep ended: go on at once, so the next run starts in the
  // same frame, where this one ended.
  app.sweepEnded = () => job?.next?.();
  function sweep(run) {
    job.showing = true;
    job.playing = true;
    app.playRun({ t: run.t, signals: run.signals }, job.bests.slice(0, 4));
    const sp = formatSpeed(app.speed());
    const where = job.model ? ' on the model' : '';
    shown.status = job.runs <= 1 ? `Scoring the running variant${where}: its run sweeps at ${sp}.`
      : `Run ${job.runs}${where}${shown.iteration ? `, iteration ${shown.iteration}` : ''}, sweeping at ${sp}; the best so far fades behind it.`;
    afterSweep(swept);
  }
  function swept() {
    if (!job) return;
    job.playing = false;
    if (replaced()) { end('Stopped: the plant changed while tuning.', { gone: true }); return; }
    improve();
    if (job.kind === 'iterate' && app.speed() !== AS_FAST && ready()) playNext();
    else schedule();
  }
  // At ∞: an improvement shown at most every IMPROVE ms.
  function improveSoon() {
    if (job.improveTimer) return;
    job.improveTimer = setTimeout(() => {
      if (!job) return;
      job.improveTimer = 0;
      job.improvedAt = performance.now();
      improve();
    }, Math.max(0, job.improvedAt + IMPROVE - performance.now()));
  }

  // A better run becomes the best: its gains go into the result variant, the
  // display shows the loop's run with them, and the runs before it fade.
  function improve() {
    const b = shown.best;
    if (!b || !(b.cost.J < job.applied) || !(b.cost.J < shown.before.cost.J)) return;
    job.applied = b.cost.J;
    const variant = { ...b.variant, name: job.name };
    // The tuner's run with these gains stands for the screen's, if it is the same simulation.
    place(variant, true, job.seenBest === b && job.bestRun ? { run: job.bestRun, ctx: job.ctx, variant } : null);
    job.bests.unshift(display.data);
    display.setPast(job.bests.slice(1, 5));
  }

  function finish(res) {
    if (res.before) shown.before = res.before;
    // An experiment's result shows once it has swept across the display.
    if (res.method === 'iterate' || !res.run) shown.res = res;
    if (res.method === 'iterate') {
      if (!res.ok) { end(`Could not run: ${res.why}.`); return; }
      const notes = res.notes?.length ? ` Note: ${res.notes.join('; ')}.` : '';
      end((res.better ? 'Done: the cost stopped falling.' : 'Done: no better gains found; the running variant stays.') + onModelText(res) + notes);
      return;
    }
    if (!res.run) { end(res.ok ? 'Done.' : `Could not run: ${res.why}.`); return; }
    // The experiment sweeps across the display at the header's speed (∞: at
    // once), then the loop's own run comes back, with the result if any.
    job.swept = true;
    const T = res.ctx.sim.duration;
    app.playRun(res.method === 'relay' ? lastPeriod(res.run, T) : aroundStep(res.run, res.tHold ?? 0, T), []);
    // Numbers to three digits; a bias of a ten-thousandth of the swing is 0.
    const u = (x) => num(Math.abs(x) < 1e-4 * Math.abs(res.d ?? res.du ?? 1) ? 0 : x, 3);
    shown.status = (res.method === 'relay'
      ? `On the display: the relay experiment, u = ${u(res.u0)} ± ${u(res.d)} around r0 = ${u(res.r0)}, other inputs at 0.`
      : stepStatus(res, u))
      + (res.ok ? '' : ` It gives no result: ${res.why}.`);
    renderAll();
    afterSweep(() => {
      clearTimeout(job.timer);
      job.timer = setTimeout(() => {
        if (!job) return;
        if (replaced()) { end('Stopped: the plant changed during the experiment.', { gone: true }); return; }
        apply(res);
      }, HOLD);
    });
  }

  // What a run on the model says (§10): how many runs, on which model, and on
  // a simulated plant the costs on the model and on the diagram; on a plant
  // outside the page, that the result waits to be tried.
  function onModelText(res) {
    if (!job?.model) return '';
    const out = [` ${job.runs} runs on the model (${shown.on}).`];
    if (res.onDiagram && res.after) out.push(`Cost on the model ${num(res.after.J, 3)} · on the diagram ${num(res.onDiagram.after.J, 3)} (it started at ${num(res.onDiagram.before.J, 3)} there).`);
    if (job.hil && res.ok && res.better) out.push(`${res.variant.name} was added, not run: Try on the plant comes next; until then run it in the Controller tab while you watch the plant.`);
    return out.join(' ');
  }

  function apply(res) {
    shown.res = res;
    if (!res.ok) { end(`The experiment gave no result: ${res.why}.`); return; }
    const notes = res.notes?.length ? ` Note: ${res.notes.join('; ')}.` : '';
    if (res.better) { place(res.variant, true); end(`Done.${onModelText(res)}${notes}`); return; }
    // Worse than the running variant (or unstable where the run starts,
    // whatever its run scores): kept to compare, not run.
    place(res.variant, false);
    const x = `cost ×${num(res.after.J / res.before.cost.J, 2)}`;
    end(`${res.unstableAtStart ? `The result is not run (${x} against ${res.before.variant.name})` : `The result scores worse than ${res.before.variant.name} (${x})`}${res.worse ? `: ${res.worse}` : ''}. It was added as ${res.variant.name}, but ${res.before.variant.name} keeps running.${onModelText(res)}${notes}`);
  }

  // What the display shows of a step test, in words. Times on the display
  // count from where it starts (aroundStep).
  function stepStatus(res, u) {
    const T = res.ctx.sim.duration, shift = Math.max(0, (res.tHold ?? 0) - 0.1 * T);
    const unit = shown.unit ? ` ${shown.unit}` : '';
    const where = res.model === 'schedule' ? `the step test at y = ${u(res.shownAt)}${unit} (one of ${res.points.length}, one per point of the table)` : 'the step test';
    const held = res.tHold > 0
      ? `${res.before?.variant.name ?? 'the running variant'} held r0 = ${u(res.r0)}${unit}, then u was set to ${u(res.u0 + res.du)} at t = ${num(res.tHold - shift, 3)} s, against a second run that held it at ${u(res.u0)}`
      : `u was held at ${u(res.u0 + res.du)} from the start, against a second run that held it at ${u(res.u0)} (r0 = ${u(res.r0)}${unit})`;
    const ended = res.model === 'integrating' ? `; y ramps, so the test ended ${num(res.tEnd, 3)} s later, once its slope was steady${res.faded ? ' and its lag had faded' : ''}` : '';
    const vm = app.project.scope.view?.mode ?? 'time';
    const view = vm === 'time' ? '' : ` The display is in ${vm === 'xy' ? 'XY' : vm === 'fft' ? 'FFT' : 'Spectrogram'} mode${vm === 'xy' ? ', channel 1 across' : ''}; Time shows the test over time.`;
    return `On the display: ${where}: ${held}${ended}. Other inputs at 0.${view}`;
  }

  // Ends the run: closes its undo step and brings back the loop's own run,
  // with the run it started from faded behind a new result, and the run
  // mode. If the project was replaced meanwhile (loaded, undone), the
  // display shows that one; its mode is restored only if nothing else set it.
  function end(status = '', { gone = false, mode = null } = {}) {
    if (!job) return;
    for (const t of [job.timer, job.lookTimer, job.improveTimer]) clearTimeout(t);
    const j = job;
    job = null;
    if (status && shown) shown.status = status;
    if (j.edit) app.endEdit();
    // The speed set before an unlimited run, unless someone set another meanwhile.
    if (j.speedBefore !== undefined && app.speedSet() === AS_FAST) app.setSpeed(j.speedBefore);
    if (!gone) {
      if (j.swept || j.showing) app.showLoop();
      display.clearRuns();
      if (j.ran) display.keep(j.startData);
    }
    if (!gone || display.mode === 'stop') app.setRunMode(mode ?? (j.mode === 'single' ? 'stop' : j.mode));
    if (gone) { shown = null; app.toast(status); }
    else if (j.ran) {
      const after = shown.res?.after ?? shown.best?.cost;
      if (after && shown.before) app.toast(`Auto-tune: cost ×${num(after.J / shown.before.cost.J, 2)} of the start; the faded run is where it started. Ctrl+Z undoes the whole run.`);
    }
    renderAll();
  }

  // ---- Progress -----------------------------------------------------------

  // Whether the progress column's run still belongs to the project: the same
  // block, and its result still in it (an undo or another system removes it).
  function stillShown() {
    const s = shown;
    if (!s || s.title !== app.project.title) return false;
    const c = blocks().find((x) => x.key === s.key);
    if (!c || (current()?.key !== s.key)) return false;
    if (!job && s.placed) return c.block.variants.some((v) => v.name === s.placed.name && JSON.stringify(v.params) === JSON.stringify(s.placed.params));
    return true;
  }

  function renderProgress() {
    if (shown && !job && !stillShown()) shown = null;
    const s = shown;
    $('#tu-plot').hidden = (s ? s.method : st.method) !== 'iterate';
    $('#tu-ptitle').textContent = s ? `Progress · ${METHODS[s.method].label}` : 'Progress';
    if (!s) {
      $('#tu-status').innerHTML = `<span class="muted" title="${st.method === 'iterate' ? 'Each run tried sweeps across the display at the header\'s Speed; at ∞ it computes as fast as it can and shows each improvement.' : 'The display shows the experiment at the header\'s Speed, then the tuned loop.'}">Press Start.</span>`;
      $('#tu-result').innerHTML = '';
      drawPlot(null);
      return;
    }
    const rows = [];
    const res = s.res;
    const after = s.method === 'iterate' ? (s.best && s.best.cost.J < s.before?.cost.J ? s.best.variant : null) : res?.ok ? res.variant : null;
    const costAfter = s.method === 'iterate' ? s.best?.cost : res?.after;
    if (s.method === 'iterate' && s.best) rows.push(row('Iteration', String(s.iteration), `${s.evals} runs`));
    if (s.method === 'relay' && res?.ok) {
      rows.push(row('Ku', num(res.Ku, 4), `ultimate gain; y swung ±${num(res.a, 3)} ${unitY()}`));
      rows.push(row('Pu', `${num(res.Pu, 4)} s`, 'ultimate period'));
      rows.push(row('Rule', RULES[res.rule].label, ''));
    }
    if (s.method === 'step' && res?.ok) {
      // The model a step test fitted: a gain (or, ramping, a slope per unit
      // of u) and a lag and dead time.
      const fit = (m) => (m.model === 'integrating'
        ? { gain: ['k′', num(m.kp, 3), 'slope of y per unit of u (it ramps)'], lag: ['τ2, θ', `${num(m.tau2, 3)} s, ${num(m.theta, 3)} s`] }
        : { gain: ['K', num(m.K, 3), 'y per u'], lag: ['τ, θ', `${num(m.tau, 3)} s, ${num(m.theta, 3)} s`] });
      if (res.model === 'schedule') {
        for (const p of res.points) {
          if (!p.ok) { rows.push(row(`at ${num(p.at, 3)}`, `gains of ${num(p.from, 3)}`, 'no result: see the status')); continue; }
          const { gain, lag } = fit(p);
          rows.push(row(`at ${num(p.at, 3)}`, `${gain[0]} ${gain[1]}; ${lag[0]} ${lag[1]}`, `Kp ${num(p.gains.Kp, 3)}, Ki ${num(p.gains.Ki, 3)}, τc ${num(p.gains.tauC, 3)} s = ${tauCShort(p.gains, res.simc)}`, '', `τc = ${tauCSource(p.gains, res.simc)}`));
        }
        rows.push(row('u0', num(res.trim, 3), 'balances the start level'));
        rows.push(row('SIMC', SIMC[res.simc].label, 'τc at each point: in its row', '', SIMC[res.simc].about));
      } else {
        const { gain, lag } = fit(res);
        rows.push(row(...gain));
        rows.push(row(...lag, 'lag, dead time'));
        // The τc actually used, and what set it (SIMC's rule or a floor).
        rows.push(row('τc', `${num(res.gains.tauC, 3)} s`, `${SIMC[res.simc].label}: = ${tauCShort(res.gains, res.simc)}`, '', `τc = ${tauCSource(res.gains, res.simc)}`));
      }
    }
    if (s.before) {
      rows.push(row('Cost', costAfter ? `${num(s.before.cost.J, 3)} → ${num(costAfter.J, 3)}` : num(s.before.cost.J, 3), costAfter ? `×${num(costAfter.J / s.before.cost.J, 2)}` : 'at the start', !costAfter ? '' : costAfter.J > s.before.cost.J ? 'text-bad' : 'text-ok'));
      rows.push(row('Overshoot', costAfter ? `${pct(s.before.cost.overshoot)} → ${pct(costAfter.overshoot)}` : pct(s.before.cost.overshoot), 'largest'));
      const b = tunedValues(s.before.variant), a = after ? tunedValues(after) : [];
      if (after && after.type !== s.before.variant.type) rows.push(row('Type', `${CONTROLLERS[s.before.variant.type].label} → ${CONTROLLERS[after.type].label}`, ''));
      const keys = [...new Set([...b, ...a].map(([k]) => k))];
      for (const k of keys) {
        const x = b.find(([q]) => q === k)?.[1], y = a.find(([q]) => q === k)?.[1];
        rows.push(row(k, after ? `${x === undefined ? '—' : show(x)} → ${show(y)}` : show(x), ''));
      }
    }
    if (s.on) rows.push(row('Plant', 'identified model', '', '', s.on));
    if (res?.onDiagram) rows.push(row('Diagram', `${num(res.onDiagram.before.J, 3)} → ${num(res.onDiagram.after.J, 3)}`, `×${num(res.onDiagram.after.J / res.onDiagram.before.J, 2)}`, res.onDiagram.after.J > res.onDiagram.before.J ? 'text-bad' : 'text-ok', 'The cost of the start and of the result on the diagram: the plant as built'));
    if (s.placed) rows.push(row('Into', s.placed.name, ''));
    $('#tu-result').innerHTML = rows.join('');
    $('#tu-status').textContent = s.status;
    drawPlot(s.method === 'iterate' ? s.history : null);
  }

  const row = (k, v, hint, cls = '', title = hint) => `<li class="turow"${title ? ` title="${esc(title)}"` : ''}><span>${esc(k)}</span><span class="${cls}">${esc(v)}</span><em>${esc(hint)}</em></li>`;
  const pct = (v) => (Number.isFinite(v) ? `${num(v, 3)} %` : '—');

  // The cost of every run tried (dots) and the best so far (line) against
  // the iteration, on a log scale; dark, like the scope.
  function drawPlot(history) {
    const cv = $('#tu-plot');
    if (cv.hidden) return;
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (!r.width) return;
    const W = r.width, H = r.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = C().bg; g.fillRect(0, 0, W, H);
    const P = { l: 44, r: W - 10, t: 8, b: H - 18 };
    g.fillStyle = C().grid;
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 20; j++) g.fillRect(P.l + (i * (P.r - P.l)) / 10, P.t + (j * (P.b - P.t)) / 20, 1, 1);
    g.strokeStyle = C().axis; g.strokeRect(P.l + 0.5, P.t + 0.5, P.r - P.l - 1, P.b - P.t - 1);
    g.font = `10px ${C().mono}`;
    g.fillStyle = C().label;
    g.textAlign = 'center'; g.textBaseline = 'top';
    const n = Math.max(st.maxIter, history?.at(-1)?.iteration ?? 0, 10);
    g.fillText('0', P.l, P.b + 4); g.fillText(String(n), P.r - 6, P.b + 4); g.fillText('iteration', (P.l + P.r) / 2, P.b + 4);
    g.save(); g.translate(10, (P.t + P.b) / 2); g.rotate(-Math.PI / 2); g.fillText('cost', 0, -4); g.restore();
    if (!history?.length) return;
    // Diverged runs (cost 100 and up) stay off the scale.
    const all = history.flatMap((h) => [h.cost, ...h.tried]).filter((v) => v > 0 && v < 100);
    if (!all.length) return;
    const top = Math.ceil(Math.log10(Math.max(...all)) * 4) / 4, bot = Math.min(Math.floor(Math.log10(Math.min(...all)) * 4) / 4, top - 0.25);
    const x = (i) => P.l + (i / n) * (P.r - P.l);
    const y = (v) => P.b - ((Math.log10(Math.min(Math.max(v, 10 ** bot), 10 ** top)) - bot) / (top - bot)) * (P.b - P.t);
    g.textAlign = 'right'; g.textBaseline = 'middle';
    g.fillText(num(10 ** top, 2), P.l - 4, P.t + 4);
    g.fillText(num(10 ** bot, 2), P.l - 4, P.b - 4);
    g.fillStyle = fade(C().ch[2], C().alpha.guide);
    for (const h of history) for (const v of h.tried) if (v < 100) g.fillRect(x(h.iteration) - 1, y(v) - 1, 2.5, 2.5);
    g.strokeStyle = C().ch[1]; g.lineWidth = 1.8; g.shadowColor = C().ch[1]; g.shadowBlur = 5;
    g.beginPath();
    history.forEach((h, i) => { if (i) g.lineTo(x(h.iteration), y(history[i - 1].cost)); else g.moveTo(x(h.iteration), y(h.cost)); g.lineTo(x(h.iteration), y(h.cost)); });
    g.stroke();
    g.shadowBlur = 0;
  }

  // Try on the plant (identification.md §11): offered for a PI or PID result
  // tuned on the model; its screening and steps in a line of their own.
  function renderTry() {
    const c = current(), b = $('#tu-try'), line = $('#tu-tried');
    const res = shown?.placed ?? null;
    const can = !!c && !job && onModel() && res?.type === 'pid' && (shown?.res?.ok ?? !!shown?.best);
    const t = c ? app.identifyTry?.state(c.key) : null;
    b.hidden = !can && !t?.running;
    b.disabled = !!t?.running;
    b.textContent = t?.running ? 'Trying…' : 'Try on the plant';
    line.hidden = !t;
    if (t) line.innerHTML = `<span class="${t.running ? '' : t.ok ? 'text-ok' : t.ok === false ? 'text-warn' : ''}">${esc(t.text)}</span>`;
  }
  app.identifyProgress = () => { if (!host.hidden) renderTry(); };
  $('#tu-try').onclick = () => {
    const c = current(), v = shown?.placed;
    if (!c || !v) return;
    const why = app.identifyTry.start(c.path, v);
    if (why) app.toast(`Try on the plant: ${why}`);
    renderTry();
  };

  function renderAll() { renderSetup(); renderProgress(); renderTry(); }

  $('#tu-fast').onclick = () => { st.unlimited = !st.unlimited; renderButton(); };
  $('#tu-start').onclick = () => {
    if (!job) start();
    else end(job.kind === 'iterate' ? 'Stopped. The best gains so far are kept.' : 'Stopped before the result was applied.');
  };
  new ResizeObserver(() => { if (!host.hidden) drawPlot(shown?.method === 'iterate' ? shown.history : null); }).observe($('#tu-plot'));

  return {
    render() { if (!host.hidden) renderAll(); },
    shown: renderAll,
    stop() { if (job) end('Stopped.'); },
    // The scope's Stop while a run of the tuner sweeps on the display: the
    // tuning stops, as with the tab's Stop, and the scope stays stopped.
    scopeStopped() { if (job?.next) end(job.kind === 'iterate' ? 'Stopped. The best gains so far are kept.' : 'Stopped before the result was applied.', { mode: 'stop' }); },
  };
}

// The last period of a long experiment, from t = 0 on the display: where the
// relay's cycle has settled and Ku and Pu are read.
function lastPeriod(run, T) {
  const n = run.t.length, end = run.t[n - 1];
  if (end <= T * 1.001) return { t: run.t, signals: run.signals };
  let k0 = 0;
  while (k0 < n - 1 && run.t[k0] < end - T) k0++;
  const signals = {};
  for (const [k, v] of Object.entries(run.signals)) signals[k] = v.subarray(k0);
  return { t: run.t.subarray(k0).map((x) => x - run.t[k0]), signals };
}

// A step test on the display: from a tenth of a period before the step, so
// the hold that came before it does not fill the screen; t from 0 there.
function aroundStep(run, tHold, T) {
  const t0 = Math.max(0, tHold - 0.1 * T);
  if (!(t0 > 0)) return { t: run.t, signals: run.signals };
  let k0 = 0;
  while (k0 < run.t.length - 1 && run.t[k0] < t0 - 1e-9) k0++;
  const signals = {};
  for (const [k, v] of Object.entries(run.signals)) signals[k] = v.subarray(k0);
  return { t: run.t.subarray(k0).map((x) => x - run.t[k0]), signals };
}

// A value for the lists: numbers to four digits, long tables shortened.
function show(v) {
  if (Array.isArray(v)) return v.length > 4 ? `${v.slice(0, 3).map((x) => num(x, 3)).join(', ')}, … (${v.length})` : v.map((x) => num(x, 3)).join(', ');
  return num(v, 4);
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
