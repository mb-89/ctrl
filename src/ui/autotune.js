// Tab 4, Auto-tune: improve a Controller block's running variant by
// simulation. Three methods (src/core/autotune.js): iterate (Nelder–Mead on a
// cost, one step at a time so the improvement can be watched), relay
// (Åström–Hägglund: Ku and Pu, then a rule) and step response (SIMC). Every
// result goes into a variant of its own, "<original> · auto-tuned" (or
// "· relay T–L", "· SIMC"), so the original stays for comparison; the whole
// run is one undo step. Its runs go at the header's Speed (ui/speed.js):
// Iterate sweeps each run it tries across the display at that speed; as fast
// as possible, it computes in slices between frames, so the page keeps
// drawing. See design/output/autotune.md.

import { controllerBlocks, tuneContext, tunedValues, autotuneSteps, whyNot, resultName, placeVariant, RULES, COSTS, GOAL } from '../core/autotune.js';
import { CONTROLLERS } from '../core/controllers.js';
import { num, parseSI } from './units.js';
import { AS_FAST, formatSpeed } from '../core/speed.js';

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
    label: 'Step response', sub: 'FOPDT fit → SIMC PI',
    about: 'Opens the loop and steps u. The reaction curve gives a gain K, a lag τ and a dead time θ, and SIMC (Skogestad 2003) a PI with closed-loop time τc = θ. For plants that settle on their own.',
  },
};
const SLICE = 30;  // ms of computing per task, so the page keeps drawing
const HOLD = 400;  // ms an experiment stays on the display after its sweep
const POLL = 100;  // ms between looks at whether a sweep has ended, besides the display's word
const GOAL_ABOUT = 'The cost of one run: the error r − y (IAE, ITAE or ISE), plus the effort (the swing of u), the overshoot beyond the bound, and the time u sits at a limit. Over one period of the input, the disturbance d included.';

export function createAutotuneTab(host, app, display) {
  // Settings of this page session (not saved in the project).
  const st = { target: null, method: 'iterate', goal: { ...GOAL }, rule: 'tl', amplitude: 0.1, maxIter: 60 };
  let job = null;   // the run in progress
  let shown = null; // what the progress column shows: the current or last run

  host.innerHTML = `
    <div class="tune">
      <section class="gcol" aria-label="Controller to tune">
        <div class="ghead"><h3 class="glabel">Controller</h3></div>
        <div id="tu-blocks" class="ctblocks"></div>
        <ul class="plist turows" id="tu-now"></ul>
        <p class="phelp" id="tu-target"></p>
      </section>
      <section class="gcol" aria-label="Method">
        <div class="ghead"><h3 class="glabel">Method</h3></div>
        <div class="tumethods" id="tu-methods" role="radiogroup" aria-label="Method"></div>
        <div id="tu-opts" class="pform"></div>
      </section>
      <section class="gcol" aria-label="Goal">
        <div class="ghead"><h3 class="glabel">Goal</h3></div>
        <div class="reps" id="tu-costs" role="radiogroup" aria-label="Cost"></div>
        <div id="tu-goal" class="pform"></div>
        <p class="phelp" id="tu-goalhelp" title="${esc(GOAL_ABOUT)}"></p>
      </section>
      <section class="gcol tuprogress" aria-label="Progress">
        <div class="ghead"><h3 class="glabel" id="tu-ptitle">Progress</h3>
          <button class="key small primary" id="tu-start">Start</button></div>
        <div class="tustatus" id="tu-status" role="status"></div>
        <canvas class="tuplot" id="tu-plot" aria-label="Cost against iteration"></canvas>
        <ul class="plist turows wide" id="tu-result"></ul>
      </section>
    </div>
    <div class="ctempty" id="tu-empty" hidden></div>`;
  const $ = (s) => host.querySelector(s);

  const root = () => (app.project.system.plant?.type === 'diagram' ? app.project.system.plant.diagram : null);
  const blocks = () => controllerBlocks(root());
  const current = () => { const all = blocks(); return all.find((c) => c.key === st.target) ?? all[0] ?? null; };
  // The block's tuning context, or why there is none (an unwired input, …).
  const context = () => { try { return { ctx: tuneContext(app.project, current()?.path) }; } catch (err) { return { why: err.message }; } };
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
    return `<label class="pf"><span class="pfl">${esc(label)}</span><input class="field pfi" data-k="${key}" value="${esc(value)}" spellcheck="false" inputmode="decimal" ${job ? 'disabled' : ''}><span class="pfh">${esc(hint)}</span></label>`;
  }
  // A container being typed in is not redrawn.
  const editing = (el) => el.contains(document.activeElement) && document.activeElement.matches('input, select');

  function renderSetup() {
    const c = current();
    $('.tune').hidden = !c;
    $('#tu-empty').hidden = !!c;
    if (!c) {
      $('#tu-empty').innerHTML = '<div class="later-box"><h3 class="glabel">Nothing to tune</h3><p>Auto-tune improves a <b>Controller</b> block of the plant. Add one in the Plant tab (library, Control group), or load a controlled system from the <b>System library</b>: <b>Oven, badly tuned</b> is made for this tab.</p></div>';
      return;
    }
    renderButton();
    const all = blocks();
    const v = c.block.variants[c.block.variant ?? 0];
    $('#tu-blocks').innerHTML = all.length > 1
      ? all.map((x) => `<button class="sigkey ${x.key === c.key ? 'on' : ''}" data-path="${esc(x.key)}" ${job ? 'disabled' : ''}>${esc(x.where)}</button>`).join('')
      : `<div class="ctname">${esc(c.where)}</div>`;
    $('#tu-now').innerHTML = `<li class="tuhead"><b>${esc(v.name)}</b><span>${esc(CONTROLLERS[v.type]?.label ?? v.type)} · running</span></li>`
      + tunedValues(v).map(([k, x]) => `<li class="turow"><span>${esc(k)}</span><span>${show(x)}</span></li>`).join('');
    const { ctx, why: noCtx } = context();
    const why = noCtx ?? whyNot(ctx, st.method);
    const into = job ? job.name : resultName(c.block, st.method, st.rule);
    const target = $('#tu-target');
    if (job) { target.innerHTML = `Into <b>${esc(into)}</b>`; target.title = `${shown.before?.variant.name ?? v.name} stays as it was.`; }
    else if (why) { target.innerHTML = `<span class="tuwhy">${esc(why)}</span>`; target.title = ''; }
    else if (into === v.name) { target.innerHTML = `Updates <b>${esc(into)}</b>`; target.title = 'Tuning again from a tuned variant updates it in place.'; }
    else {
      target.innerHTML = `Into <b>${esc(into)}</b>`;
      target.title = `The result goes into a variant of its own; ${v.name} stays, to compare in the Controller tab. An earlier result is never overwritten: a new one is numbered.`;
    }

    $('#tu-methods').innerHTML = Object.entries(METHODS).map(([k, m]) => `<button class="sigkey tumethod ${k === st.method ? 'on' : ''}" data-method="${k}" role="radio" aria-checked="${k === st.method}" title="${esc(m.about)}" ${job ? 'disabled' : ''}><b>${m.label}</b><span>${m.sub}</span></button>`).join('');
    if (!editing($('#tu-opts'))) {
      const opts = [];
      if (st.method === 'iterate') opts.push(field('maxIter', 'Iterations', st.maxIter, 'at most; stops when the cost stops falling'));
      if (st.method === 'relay') opts.push(`<label class="pf"><span class="pfl">Rule</span><select class="field" id="tu-rule" ${job ? 'disabled' : ''}>${Object.entries(RULES).map(([k, r]) => `<option value="${k}" ${k === st.rule ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select><span class="pfh">${esc(RULES[st.rule].about)}</span></label>`);
      if (st.method !== 'iterate') opts.push(field('amplitude', st.method === 'relay' ? 'Relay ±d' : 'Step Δu', num(100 * st.amplitude, 3), '% of the actuator range'));
      $('#tu-opts').innerHTML = opts.join('');
    }

    $('#tu-costs').innerHTML = Object.keys(COSTS).map((k) => `<button class="rep ${k === st.goal.cost ? 'on' : ''}" data-cost="${k}" role="radio" aria-checked="${k === st.goal.cost}" title="${esc(COSTS[k])}" ${job ? 'disabled' : ''}>${k}</button>`).join('');
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
    b.className = `key small ${job ? 'lit-red' : 'primary'}`;
    b.disabled = !job && !!(why ?? whyNot(ctx, st.method));
  }

  // ---- Running ------------------------------------------------------------

  // Puts a variant into the block (over the result of this run, or as a new
  // one after the running variant). The first change opens the run's undo
  // step; the run takes no other.
  function place(variant, run) {
    if (!job.edit) { app.beginEdit(); job.edit = true; }
    app.tuneEdit((p) => placeVariant(p, job.path, variant, { run }));
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
    const name = resultName(c.block, st.method, st.rule);
    const gen = autotuneSteps(app.project, c.path, { method: st.method, goal, rule: st.rule, amplitude: st.amplitude, maxIter: st.maxIter, name });
    shown = { method: st.method, rule: st.rule, goal, key: c.key, title: app.project.title, history: [], status: st.method === 'iterate' ? 'Scoring the running variant…' : 'Running the experiment…', before: null, best: null, res: null, placed: null };
    // bests: the loop's run with each better set of gains, newest first; the
    // display fades them behind the run on screen.
    job = { gen, kind: st.method, name, path: c.path, plant: app.project.system.plant, mode: display.mode, startData: display.data, timer: 0, edit: false, ran: false, swept: false, showing: false, applied: Infinity, runs: 0, bests: [display.data] };
    if (st.method === 'iterate') { app.setRunMode('stop'); display.clearRuns(); }
    renderAll();
    job.timer = setTimeout(tick);
  }

  const replaced = () => job && app.project.system.plant !== job.plant;

  // Steps the method. Iterate at a finite speed: up to the next run of the
  // loop, which then sweeps across the display at that speed (a 5 s run takes
  // 5 s at 1×, 0.5 s at 10×). As fast as possible, and the experiments' runs
  // at any speed (they are shown once they are done): in slices of about
  // SLICE ms between frames. At ∞ with the display standing still, the
  // simulated time computed counts as the achieved speed.
  function tick() {
    if (!job) return;
    if (replaced()) { end('Stopped: the plant changed while tuning.', { gone: true }); return; }
    if (job.kind === 'iterate' && app.speed() !== AS_FAST) { sweepNext(); return; }
    const t0 = performance.now(), counting = app.speed() === AS_FAST && display.mode === 'stop';
    let iterated = false, seconds = 0;
    const count = () => { if (counting) { app.timeRan(t0 / 1000, 0); app.timeRan(performance.now() / 1000, seconds); } };
    for (;;) {
      let s;
      try { s = job.gen.next(); } catch (err) { end(`Stopped: ${err.message}.`); return; }
      if (s.done) { count(); improve(); finish(s.value); return; }
      seconds += s.value.seconds ?? 0;
      if (take(s.value)) iterated = true;
      if (performance.now() - t0 > SLICE) break;
    }
    count();
    if (iterated) improve();
    if (job.kind !== 'iterate') shown.status = `Running the ${job.kind === 'relay' ? 'relay experiment' : 'step test'}… (${job.runs} run${job.runs === 1 ? '' : 's'} of the loop)`;
    renderProgress();
    job.timer = setTimeout(tick, 0);
  }

  // What a step of the method tells: the runs, the start, the best so far, the
  // history of the cost plot. True at the end of an iteration.
  function take(v) {
    if (v.seconds) job.runs++;
    if (v.before) shown.before ??= v.before;
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

  // Iterate at a finite speed: computes up to the next run of the loop and
  // sweeps it across the display, the best runs so far faded behind it; when
  // the sweep has ended, a better run becomes the best and the next follows.
  function sweepNext() {
    const t0 = performance.now();
    for (;;) {
      let s;
      try { s = job.gen.next(); } catch (err) { end(`Stopped: ${err.message}.`); return; }
      if (s.done) { improve(); finish(s.value); return; }
      const v = s.value;
      take(v);
      if (v.run) { sweep(v.run); break; }
      if (performance.now() - t0 > SLICE) { renderProgress(); job.timer = setTimeout(tick, 0); return; }
    }
    renderProgress();
    afterSweep(swept);
  }
  // Calls then() once the sweep on the display has ended: when the display
  // says so, or (Stop or Run pressed meanwhile) when its mode has changed.
  function afterSweep(then) {
    const go = () => { if (!job || job.next !== go) return; job.next = null; clearTimeout(job.timer); then(); };
    job.next = go;
    const look = () => { if (!job || job.next !== go) return; if (display.mode !== 'single') go(); else job.timer = setTimeout(look, POLL); };
    job.timer = setTimeout(look, POLL);
  }
  // The display's Single ended: go on at once (after this frame).
  app.sweepEnded = () => { const go = job?.next; if (go) setTimeout(go, 0); };
  function sweep(run) {
    job.showing = true;
    app.playRun({ t: run.t, signals: run.signals }, job.bests.slice(0, 4));
    const sp = formatSpeed(app.speed());
    shown.status = job.runs <= 1 ? `Scoring the running variant: its run sweeps at ${sp}.`
      : `Run ${job.runs}${shown.iteration ? `, iteration ${shown.iteration}` : ''}, sweeping at ${sp}; the best so far fades behind it.`;
  }
  function swept() {
    if (!job) return;
    if (replaced()) { end('Stopped: the plant changed while tuning.', { gone: true }); return; }
    improve();
    job.timer = setTimeout(tick, 0);  // the next run in a task of its own
  }

  // A better run becomes the best: its gains go into the result variant, the
  // display shows the loop's run with them, and the runs before it fade.
  function improve() {
    const b = shown.best;
    if (!b || !(b.cost.J < job.applied) || !(b.cost.J < shown.before.cost.J)) return;
    job.applied = b.cost.J;
    place({ ...b.variant, name: job.name }, true);
    job.bests.unshift(display.data);
    display.setPast(job.bests.slice(1, 5));
  }

  function finish(res) {
    if (res.before) shown.before = res.before;
    // An experiment's result shows once it has swept across the display.
    if (res.method === 'iterate' || !res.run) shown.res = res;
    if (res.method === 'iterate') {
      if (!res.ok) { end(`Could not run: ${res.why}.`); return; }
      end(res.better ? 'Done: the cost stopped falling.' : 'Done: no better gains found; the running variant stays.');
      return;
    }
    if (!res.run) { end(res.ok ? 'Done.' : `Could not run: ${res.why}.`); return; }
    // The experiment sweeps across the display at the header's speed (∞: at
    // once), then the loop's own run comes back, with the result if any.
    job.swept = true;
    app.playRun(res.method === 'relay' ? lastPeriod(res.run, res.ctx.sim.duration) : { t: res.run.t, signals: res.run.signals }, []);
    // Numbers to three digits; a bias of a millionth of the swing is 0.
    const u = (x) => num(Math.abs(x) < 1e-6 * Math.abs(res.d ?? res.du ?? 1) ? 0 : x, 3);
    shown.status = (res.method === 'relay'
      ? `On the display: the relay experiment, u = ${u(res.u0)} ± ${u(res.d)} around r0 = ${u(res.r0)}, other inputs at 0.`
      : `On the display: the step test, u held at ${u(res.u0)}, then at ${u(res.u0 + (res.du ?? 0))}; r0 = ${u(res.r0)}, other inputs at 0.`)
      + (res.ok ? '' : ` It gives no result: ${res.why}.`);
    renderAll();
    afterSweep(() => {
      job.timer = setTimeout(() => {
        if (!job) return;
        if (replaced()) { end('Stopped: the plant changed during the experiment.', { gone: true }); return; }
        apply(res);
      }, HOLD);
    });
  }

  function apply(res) {
    shown.res = res;
    if (!res.ok) { end(`The experiment gave no result: ${res.why}.`); return; }
    const notes = res.notes?.length ? ` Note: ${res.notes.join('; ')}.` : '';
    if (res.better) { place(res.variant, true); end(`Done.${notes}`); return; }
    // Worse than the running variant: kept to compare, not run.
    place(res.variant, false);
    end(`The result scores worse than ${res.before.variant.name} (cost ×${num(res.after.J / res.before.cost.J, 2)}): it was added as ${res.variant.name}, but ${res.before.variant.name} keeps running.${notes}`);
  }

  // Ends the run: closes its undo step and brings back the loop's own run,
  // with the run it started from faded behind a new result, and the run
  // mode. If the project was replaced meanwhile (loaded, undone), the
  // display shows that one; its mode is restored only if nothing else set it.
  function end(status = '', { gone = false } = {}) {
    if (!job) return;
    clearTimeout(job.timer);
    const j = job;
    job = null;
    if (status && shown) shown.status = status;
    if (j.edit) app.endEdit();
    if (!gone) {
      if (j.swept || j.showing) app.showLoop();
      display.clearRuns();
      if (j.ran) display.keep(j.startData);
    }
    if (!gone || display.mode === 'stop') app.setRunMode(j.mode === 'single' ? 'stop' : j.mode);
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
      $('#tu-status').innerHTML = `<span class="dim">Press Start. ${st.method === 'iterate' ? 'Each run tried sweeps across the display at the header\'s Speed; at ∞ it computes as fast as it can and shows each improvement.' : 'The display shows the experiment at the header\'s Speed, then the tuned loop.'}</span>`;
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
      rows.push(row('K', num(res.K, 4), 'y per u'));
      rows.push(row('τ, θ', `${num(res.tau, 3)} s, ${num(res.theta, 3)} s`, 'lag, dead time'));
      rows.push(row('τc', `${num(res.gains.tauC, 3)} s`, 'closed-loop time'));
    }
    if (s.before) {
      rows.push(row('Cost', costAfter ? `${num(s.before.cost.J, 3)} → ${num(costAfter.J, 3)}` : num(s.before.cost.J, 3), costAfter ? `×${num(costAfter.J / s.before.cost.J, 2)}` : 'at the start', costAfter && costAfter.J > s.before.cost.J ? 'tuworse' : 'tucost'));
      rows.push(row('Overshoot', costAfter ? `${pct(s.before.cost.overshoot)} → ${pct(costAfter.overshoot)}` : pct(s.before.cost.overshoot), 'largest'));
      const b = tunedValues(s.before.variant), a = after ? tunedValues(after) : [];
      if (after && after.type !== s.before.variant.type) rows.push(row('Type', `${CONTROLLERS[s.before.variant.type].label} → ${CONTROLLERS[after.type].label}`, ''));
      const keys = [...new Set([...b, ...a].map(([k]) => k))];
      for (const k of keys) {
        const x = b.find(([q]) => q === k)?.[1], y = a.find(([q]) => q === k)?.[1];
        rows.push(row(k, after ? `${x === undefined ? '—' : show(x)} → ${show(y)}` : show(x), ''));
      }
    }
    if (s.placed) rows.push(row('Into', s.placed.name, ''));
    $('#tu-result').innerHTML = rows.join('');
    $('#tu-status').textContent = s.status;
    drawPlot(s.method === 'iterate' ? s.history : null);
  }

  const row = (k, v, hint, cls = '') => `<li class="turow ${cls}"><span>${esc(k)}</span><span>${esc(v)}</span><em>${esc(hint)}</em></li>`;
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
    g.fillStyle = '#0a0d10'; g.fillRect(0, 0, W, H);
    const P = { l: 44, r: W - 10, t: 8, b: H - 18 };
    g.fillStyle = 'rgba(160, 175, 190, 0.32)';
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 20; j++) g.fillRect(P.l + (i * (P.r - P.l)) / 10, P.t + (j * (P.b - P.t)) / 20, 1, 1);
    g.strokeStyle = 'rgba(160, 175, 190, 0.5)'; g.strokeRect(P.l + 0.5, P.t + 0.5, P.r - P.l - 1, P.b - P.t - 1);
    g.font = '10px "IBM Plex Mono", ui-monospace, monospace';
    g.fillStyle = 'rgba(200, 210, 218, 0.75)';
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
    g.fillStyle = 'rgba(78, 166, 255, 0.6)';
    for (const h of history) for (const v of h.tried) if (v < 100) g.fillRect(x(h.iteration) - 1, y(v) - 1, 2.5, 2.5);
    g.strokeStyle = '#33d17a'; g.lineWidth = 1.8; g.shadowColor = '#33d17a'; g.shadowBlur = 5;
    g.beginPath();
    history.forEach((h, i) => { if (i) g.lineTo(x(h.iteration), y(history[i - 1].cost)); else g.moveTo(x(h.iteration), y(h.cost)); g.lineTo(x(h.iteration), y(h.cost)); });
    g.stroke();
    g.shadowBlur = 0;
  }

  function renderAll() { renderSetup(); renderProgress(); }

  $('#tu-start').onclick = () => {
    if (!job) start();
    else end(job.kind === 'iterate' ? 'Stopped. The best gains so far are kept.' : 'Stopped before the result was applied.');
  };
  new ResizeObserver(() => { if (!host.hidden) drawPlot(shown?.method === 'iterate' ? shown.history : null); }).observe($('#tu-plot'));

  return {
    render() { if (!host.hidden) renderAll(); },
    shown: renderAll,
    stop() { if (job) end('Stopped.'); },
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

// A value for the lists: numbers to four digits, long tables shortened.
function show(v) {
  if (Array.isArray(v)) return v.length > 4 ? `${v.slice(0, 3).map((x) => num(x, 3)).join(', ')}, … (${v.length})` : v.map((x) => num(x, 3)).join(', ');
  return num(v, 4);
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
