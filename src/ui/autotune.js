// Tab 4, Auto-tune: improve a Controller block's running variant by
// simulation. Three methods (src/core/autotune.js): iterate (Nelder–Mead on a
// cost, one step at a time so the improvement can be watched), relay
// (Åström–Hägglund: Ku and Pu, then a rule) and step response (SIMC). Every
// result goes into a variant of its own, "<original> · auto-tuned" (or
// "· relay T–L", "· SIMC"), so the original stays for comparison; the whole
// run is one undo step. See design/output/autotune.md.

import { controllerBlocks, tuneContext, tunedValues, iterate, relayTune, stepTune, whyNot, baseName, costScales, runVariant, variantCost, RULES, COSTS, GOAL } from '../core/autotune.js';
import { CONTROLLERS } from '../core/controllers.js';
import { num, parseSI } from './units.js';

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
const PACE = 1000 / 6;  // iterations per second while watching

export function createAutotuneTab(host, app, display) {
  // Settings of this page session (not saved in the project).
  const st = { target: null, method: 'iterate', goal: { ...GOAL }, rule: 'tl', amplitude: 0.1, maxIter: 60, fast: false };
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
        <p class="phelp" id="tu-about"></p>
      </section>
      <section class="gcol" aria-label="Goal">
        <div class="ghead"><h3 class="glabel">Goal</h3></div>
        <div class="reps" id="tu-costs" role="radiogroup" aria-label="Cost"></div>
        <div id="tu-goal" class="pform"></div>
        <p class="phelp" id="tu-goalhelp"></p>
      </section>
      <section class="gcol" aria-label="Progress">
        <div class="ghead"><h3 class="glabel" id="tu-ptitle">Progress</h3>
          <label class="tufast" title="Run the iterations as fast as the browser can, and skip the experiment's sweep"><button class="sw" id="tu-fast" role="switch" aria-checked="false" aria-label="Fast"></button>Fast</label>
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
  const context = () => { try { return tuneContext(app.project, current()?.path); } catch { return null; } };
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
  const resultName = (name, method = st.method, rule = st.rule) => {
    const b = baseName(name);
    return (method === 'iterate' ? `${b} · auto-tuned` : method === 'relay' ? `${b} · relay ${RULES[rule].short}` : `${b} · SIMC`).slice(0, 40);
  };

  // ---- Setup columns ----------------------------------------------------

  function field(key, label, value, hint) {
    return `<label class="pf"><span class="pfl">${esc(label)}</span><input class="field pfi" data-k="${key}" value="${esc(value)}" spellcheck="false" inputmode="decimal"><span class="pfh">${esc(hint)}</span></label>`;
  }

  function renderSetup() {
    const c = current();
    $('.tune').hidden = !c;
    $('#tu-empty').hidden = !!c;
    if (!c) {
      $('#tu-empty').innerHTML = '<div class="later-box"><h3 class="glabel">Nothing to tune</h3><p>Auto-tune improves a <b>Controller</b> block of the plant. Add one in the Plant tab (library, Control group), or load a controlled system from the <b>System library</b>: <b>Oven, badly tuned</b> is made for this tab.</p></div>';
      return;
    }
    // Typing in a field is not interrupted by a redraw.
    if (host.contains(document.activeElement) && document.activeElement.matches('input, select')) return;
    const all = blocks();
    const v = c.block.variants[c.block.variant];
    $('#tu-blocks').innerHTML = all.length > 1
      ? all.map((x) => `<button class="sigkey ${x === c ? 'on' : ''}" data-path="${esc(x.key)}">${esc(x.where)}</button>`).join('')
      : `<div class="ctname">${esc(c.where)}</div>`;
    $('#tu-now').innerHTML = `<li class="tuhead"><b>${esc(v.name)}</b><span>${esc(CONTROLLERS[v.type]?.label ?? v.type)} · running</span></li>`
      + tunedValues(v).map(([k, x]) => `<li class="turow"><span>${esc(k)}</span><span>${show(x)}</span></li>`).join('');
    const ctx = context();
    const why = ctx ? whyNot(ctx, st.method) : `${c.where} needs r on input 1 and the measurement y on input 2.`;
    const into = resultName(v.name);
    $('#tu-target').innerHTML = job ? `Tuning into <b>${esc(job.name ?? into)}</b>; <b>${esc(shown.before.variant.name)}</b> stays as it was.`
      : why ? `<span class="tuwhy">${esc(why)}</span>`
        : into === v.name ? (st.method === 'iterate' ? 'Tuning continues from this variant and updates it.' : 'The result replaces this variant\'s gains.')
          : `The result goes into a variant of its own, <b>${esc(into)}</b>; <b>${esc(v.name)}</b> stays, to compare in the Controller tab.`;

    $('#tu-methods').innerHTML = Object.entries(METHODS).map(([k, m]) => `<button class="sigkey tumethod ${k === st.method ? 'on' : ''}" data-method="${k}" role="radio" aria-checked="${k === st.method}" ${job ? 'disabled' : ''}><b>${m.label}</b><span>${m.sub}</span></button>`).join('');
    const opts = [];
    if (st.method === 'iterate') opts.push(field('maxIter', 'Iterations', st.maxIter, 'at most; it stops when the cost stops falling'));
    if (st.method === 'relay') opts.push(`<label class="pf"><span class="pfl">Rule</span><select class="field" id="tu-rule">${Object.entries(RULES).map(([k, r]) => `<option value="${k}" ${k === st.rule ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select><span class="pfh">${esc(RULES[st.rule].about)}</span></label>`);
    if (st.method !== 'iterate') opts.push(field('amplitude', st.method === 'relay' ? 'Relay ±d' : 'Step Δu', num(100 * st.amplitude, 3), '% of the actuator range'));
    $('#tu-opts').innerHTML = opts.join('');
    $('#tu-about').textContent = METHODS[st.method].about;

    $('#tu-costs').innerHTML = Object.keys(COSTS).map((k) => `<button class="rep ${k === st.goal.cost ? 'on' : ''}" data-cost="${k}" role="radio" aria-checked="${k === st.goal.cost}" title="${esc(COSTS[k])}">${k}</button>`).join('');
    $('#tu-goal').innerHTML = field('effort', 'Effort weight', num(st.goal.effort, 3), 'on the swing of u; 0 ignores effort')
      + field('overshoot', 'Overshoot ≤', num(st.goal.overshoot, 3), '% of a reference step; beyond costs extra');
    $('#tu-goalhelp').textContent = `Cost: ${st.goal.cost}, ${COSTS[st.goal.cost]}, of e = r − y; plus effort, overshoot beyond the bound and time at the actuator's limits. Over one period of the input, the disturbance d included. ${st.method === 'iterate' ? 'The search minimises it.' : 'The rule does not use it: it scores the result, to compare methods.'}`;
    bind();
    renderButton();
  }

  function bind() {
    host.querySelectorAll('[data-path]').forEach((el) => { el.onclick = () => { if (job) return; st.target = el.dataset.path; shown = null; renderAll(); }; });
    host.querySelectorAll('[data-method]').forEach((el) => { el.onclick = () => { if (job) return; st.method = el.dataset.method; renderAll(); }; });
    host.querySelectorAll('[data-cost]').forEach((el) => { el.onclick = () => { st.goal.cost = el.dataset.cost; renderSetup(); }; });
    const rule = $('#tu-rule');
    if (rule) rule.onchange = () => { st.rule = rule.value; rule.blur(); renderSetup(); };
    host.querySelectorAll('input[data-k]').forEach((inp) => {
      inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.dataset.cancel = '1'; inp.blur(); } };
      inp.onblur = () => {
        if (inp.dataset.cancel) { delete inp.dataset.cancel; setTimeout(renderSetup); return; }
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
    const ctx = context();
    const why = ctx ? whyNot(ctx, st.method) : 'no block';
    const b = $('#tu-start');
    b.textContent = job ? 'Stop' : 'Start';
    b.className = `key small ${job ? 'lit-red' : 'primary'}`;
    b.disabled = !job && !!why;
    $('#tu-fast').classList.toggle('on', st.fast);
    $('#tu-fast').setAttribute('aria-checked', String(st.fast));
  }

  // ---- Running ------------------------------------------------------------

  // Puts a variant into the block (at index `at`, or under its name, or as a
  // new one after the running variant) and runs it. It belongs to the run's
  // undo step and takes none of its own.
  function place(path, variant, at) {
    let i = at;
    app.tuneEdit((p) => {
      let lv = p.system.plant.diagram;
      for (const id of path.slice(0, -1)) lv = lv.blocks.find((b) => b.id === id).diagram;
      const blk = lv.blocks.find((b) => b.id === path.at(-1));
      if (i === undefined) {
        i = blk.variants.findIndex((v) => v.name === variant.name);
        if (i < 0) { i = blk.variant + 1; blk.variants.splice(i, 0, null); }
      }
      blk.variants[i] = structuredClone(variant);
      blk.variant = i;
    });
    return i;
  }

  function start() {
    const c = current(), ctx = context();
    if (!c || !ctx || whyNot(ctx, st.method)) return;
    const scales = costScales(runVariant(ctx, ctx.variant), ctx.key, ctx.variant);
    const before = { variant: ctx.variant, cost: variantCost(ctx, ctx.variant, st.goal, scales) };
    shown = { method: st.method, rule: st.rule, goal: { ...st.goal }, path: c.path, title: app.project.title, before, scales, history: [], status: '' };
    // The display shows whole runs while tuning, the earlier ones fading.
    const base = { mode: display.mode, startData: display.data, path: c.path, plant: app.project.system.plant, timer: 0 };
    display.clearRuns();
    if (st.method === 'iterate') {
      let gen;
      try { gen = iterate(app.project, c.path, st.goal, { maxIter: st.maxIter }); } catch (err) { app.toast(err.message); return; }
      app.beginEdit();
      app.setRunMode('stop');
      const name = resultName(ctx.variant.name);
      job = { ...base, kind: 'iterate', gen, name, edit: true, applied: before.cost.J };
      job.index = place(c.path, { ...ctx.variant, name });
      shown.status = 'Tuning…';
      renderAll();
      tick();
      return;
    }
    let res;
    try {
      res = st.method === 'relay' ? relayTune(app.project, c.path, st.rule, { amplitude: st.amplitude }) : stepTune(app.project, c.path, { amplitude: st.amplitude });
    } catch (err) { res = { ok: false, why: err.message }; }
    if (!res.run) { shown.res = res; shown.status = `Could not run: ${res.why}.`; renderAll(); return; }
    // The experiment sweeps across the display as it runs (Fast: at once);
    // its result shows when it has run.
    job = { ...base, kind: st.method, name: res.variant?.name, res, experiment: true };
    app.setRunMode(st.fast ? 'stop' : 'single');
    display.clearRuns();
    display.setData({ t: res.run.t, signals: res.run.signals });
    const u = (x) => num(x, 3);
    shown.status = st.method === 'relay'
      ? `Relay experiment: u = ${u(res.u0)} ± ${u(res.d)} around r0 = ${u(res.r0)}, d at 0. Watch y oscillate…`
      : `Step test: u held at ${u(res.u0)}, then at ${u(res.u0 + res.du)}; r0 = ${u(res.r0)}, d at 0. Watch y react…`;
    renderAll();
    const sweep = 10 * app.project.scope.timebase.scale;
    job.timer = setTimeout(() => finishExperiment(res), st.fast ? 500 : 1000 * sweep + 400);
  }

  const replaced = () => job && app.project.system.plant !== job.plant;

  function tick() {
    if (!job) return;
    if (replaced()) { end('Stopped: the plant changed while tuning.', { replaced: true }); return; }
    const t0 = performance.now();
    let s;
    do {
      try { s = job.gen.next(); } catch (err) { end(`Stopped: ${err.message}.`); return; }
      const r = s.value;
      shown.history.push({ iteration: r.iteration, cost: r.cost, tried: r.tried });
      Object.assign(shown, { best: r.best, iteration: r.iteration, evals: r.evals });
    } while (!s.done && st.fast && performance.now() - t0 < 40);
    // A better run goes onto the display; the one before it fades.
    if (shown.best.cost.J < job.applied) {
      job.applied = shown.best.cost.J;
      display.keep();
      place(job.path, { ...shown.best.variant, name: job.name }, job.index);
    }
    if (s.done) { end('Done: the cost stopped falling.'); return; }
    renderProgress();
    job.timer = setTimeout(tick, st.fast ? 0 : PACE);
  }

  function finishExperiment(res) {
    if (!job) return;
    if (replaced()) { end('Stopped: the plant changed during the experiment.', { replaced: true }); return; }
    job.experiment = false;
    shown.res = res;
    if (!res.ok) { end(`The experiment gave no result: ${res.why}.`, { keepDisplay: true }); return; }
    app.beginEdit();
    job.edit = true;
    place(job.path, res.variant);
    const ctx = context();
    if (ctx) shown.after = variantCost(ctx, res.variant, shown.goal, shown.scales);
    end(res.notes?.length ? `Done. Note: ${res.notes.join('; ')}.` : 'Done.');
  }

  // Ends the run: closes its undo step, leaves the display with the run it
  // started from (faded) against the result, and restores the run mode. If
  // the project was replaced meanwhile (loaded, undone), the display shows
  // that one; its mode is restored only if nothing else set it.
  function end(status = '', { keepDisplay = false, replaced: gone = false } = {}) {
    if (!job) return;
    clearTimeout(job.timer);
    const j = job;
    job = null;
    if (status) shown.status = status;
    if (j.edit) app.endEdit();
    if (!gone && !keepDisplay) {
      if (j.experiment) display.setData(j.startData);
      display.clearRuns();
      if (j.edit) display.keep(j.startData);
    }
    if (!keepDisplay && (!gone || display.mode === 'stop')) app.setRunMode(j.mode === 'single' ? 'stop' : j.mode);
    const after = shown.after ?? (j.kind === 'iterate' ? shown.best?.cost : null);
    if (gone) { shown = null; app.toast(status); }
    else if (after) app.toast(`Auto-tune: cost ×${num(after.J / shown.before.cost.J, 2)} of the start; the faded run is where it started. Ctrl+Z undoes the whole run.`);
    renderAll();
  }

  // ---- Progress -----------------------------------------------------------

  function renderProgress() {
    const s = shown, c = current();
    // The run shown belongs to this project's block (another system loaded since has its own).
    const mine = s && c && s.path.join('/') === c.key && s.title === app.project.title;
    $('#tu-plot').hidden = (mine ? s.method : st.method) !== 'iterate';
    $('#tu-ptitle').textContent = mine ? `Progress · ${METHODS[s.method].label}` : 'Progress';
    if (!mine) {
      $('#tu-status').innerHTML = `<span class="dim">Press Start. ${st.method === 'iterate' ? 'Each iteration runs the loop once or a few times and keeps the best gains; the display shows every improvement.' : 'The display shows the experiment as it runs, then the tuned loop.'}</span>`;
      $('#tu-result').innerHTML = '';
      drawPlot(null);
      return;
    }
    const rows = [];
    const res = s.res && !(job?.experiment) ? s.res : null;
    const after = s.method === 'iterate' ? s.best?.variant : res?.ok ? res.variant : null;
    const costAfter = s.method === 'iterate' ? s.best?.cost : s.after;
    if (s.method === 'iterate' && s.best) rows.push(row('Iteration', String(s.iteration), `${s.evals} runs`));
    if (s.method === 'relay' && res?.ok) {
      rows.push(row('Ku', num(res.Ku, 4), `ultimate gain; y swung ±${num(res.a, 3)} ${unitY()}`));
      rows.push(row('Pu', `${num(res.Pu, 4)} s`, 'ultimate period'));
      rows.push(row('Rule', RULES[s.rule].label, ''));
    }
    if (s.method === 'step' && res?.ok) {
      rows.push(row('K', num(res.K, 4), 'y per u'));
      rows.push(row('τ, θ', `${num(res.tau, 3)} s, ${num(res.theta, 3)} s`, 'lag, dead time'));
      rows.push(row('τc', `${num(res.gains.tauC, 3)} s`, 'closed-loop time'));
    }
    rows.push(row('Cost', costAfter ? `${num(s.before.cost.J, 3)} → ${num(costAfter.J, 3)}` : num(s.before.cost.J, 3), costAfter ? `×${num(costAfter.J / s.before.cost.J, 2)}` : 'at the start', 'tucost'));
    rows.push(row('Overshoot', costAfter ? `${pct(s.before.cost.overshoot)} → ${pct(costAfter.overshoot)}` : pct(s.before.cost.overshoot), 'largest'));
    const b = tunedValues(s.before.variant), a = after ? tunedValues(after) : [];
    if (after && after.type !== s.before.variant.type) rows.push(row('Type', `${CONTROLLERS[s.before.variant.type].label} → ${CONTROLLERS[after.type].label}`, ''));
    const keys = [...new Set([...b, ...a].map(([k]) => k))];
    for (const k of keys) {
      const x = b.find(([q]) => q === k)?.[1], y = a.find(([q]) => q === k)?.[1];
      rows.push(row(k, after ? `${x === undefined ? '—' : show(x)} → ${show(y)}` : show(x), ''));
    }
    if (s.method !== 'iterate' && after) rows.push(row('Into', after.name, ''));
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
  $('#tu-fast').onclick = (e) => { e.preventDefault(); st.fast = !st.fast; renderButton(); };
  new ResizeObserver(() => { if (!host.hidden) drawPlot(shown?.method === 'iterate' ? shown.history : null); }).observe($('#tu-plot'));

  return {
    render() { if (!host.hidden) renderAll(); },
    shown: renderAll,
    stop() { if (job) end('Stopped.'); },
  };
}

// A value for the lists: numbers to four digits, long tables shortened.
function show(v) {
  if (Array.isArray(v)) return v.length > 4 ? `${v.slice(0, 3).map((x) => num(x, 3)).join(', ')}, … (${v.length})` : v.map((x) => num(x, 3)).join(', ');
  return num(v, 4);
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
