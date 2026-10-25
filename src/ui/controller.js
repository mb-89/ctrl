// Tab 3, Controller: the Controller blocks of the plant, each with its
// variants (implementations with the same inputs and output, as Simulink's
// variant subsystems). Clicking a variant runs it; the previous run stays
// faded on the display for comparison. The active variant's parameters are
// edited here; the library adds new variants. See design/output/controller-proposal.md.
//
// A designed variant (design/output/designs.md) holds only its inputs; what
// its design computed from the plant shows read-only in the Computed box
// beside (or, when narrow, below) its parameters. renderComputed() patches
// that box, the variant glyphs and nothing else, so a field being typed in
// keeps its focus when a design settles; renderProgress() only the progress
// of a plan being made (its bar, its line, the glyph), so its Cancel button
// stays where it is.

import { CONTROLLERS, normalizeVariant } from '../core/controllers.js';
import { OBSERVERS } from '../core/observers.js';
import { normalizeDiagram, parseEnd, blockInputNames } from '../core/diagram.js';
import { num, parseSI } from './units.js';
import { drawStructure } from './ctldiagram.js';

// What each implementation is for, in a sentence or two.
const ABOUT = {
  off: 'No control: the plant gets u = 0. Shows what the plant does on its own.',
  pidFF: 'A PID whose feedforward the page computes from the plant as it is wired: the plant\'s inverse at low frequency (from u to the first measurement, at its origin), so the input a moving reference needs comes from r itself, plus what the PID\'s own parts take away while y follows r (Kp (1 − b), Kd and Kd·Tf). Feedforward chooses the terms: Kff, then Kv, then Ka. Kp, Ki, Kd are yours; change the plant and the feedforward follows. Dead time is left out and reported.',
  pid: 'The workhorse. P reacts to the error, I removes what is left, D damps (on the measurement, filtered by Tf). b weights the reference in P; the prefilter Tr (Vorfilter) smooths reference jumps. Feedforward puts out what following r takes, from r alone: Kff·r, Kv·dr/dt, Ka·d²r/dt². u min/max are the actuator limits; anti-windup (clamping, back-calculation with Tt, or off) keeps the integral from winding up at a limit.',
  stateFeedback: 'u = kr·r − K·y: one gain per measured state (a matrix controller, Zustandsregler). With all states measured it can place every pole; LQR picks K by weighing state errors against effort. kr is the static prefilter so the output follows r. Update every k computes u every k samples and holds it, a longer sample time.',
  lqr: 'State feedback whose gains are computed from the plant as it is wired: the page linearises it at its origin and solves the discrete LQR problem. Q weighs the error of each measurement, R the effort; every state must be measured. Change the plant and the gains follow.',
  huLin: 'The variable gain of Hu and Lin: state feedback whose gain grows as y nears r, computed from the plant as it is wired. The page solves LQR for the weights ε·Q and R at levels ε from the lowest up to 1, each with the largest ellipsoid around r on which its u stays inside the limits; the ellipsoids are nested. At every sample the law takes the highest gain whose ellipsoid holds the error, interpolated between two levels: far from r a gentle gain, near it the full LQR, u near its limit but never past it, so the loop never opens. k above 1 is their saturated high gain: faster, with u at its limit a little. Every state must be measured; the limits must be set.',
  deadbeat: 'State feedback that puts every pole of the loop at z = 0, computed from the plant as it is wired (linearised at its origin): after a step of r the plant is at rest at r in n samples exactly, n its number of states, and nothing ripples between them. The price is u: it does whatever it takes, so a short sample time asks a huge input, and clipped at a limit it loses its finite settling. Update every k runs it at k·Ts, which asks less. Every state must be measured; a dead time is refused.',
  gainScheduled: 'A PI whose gains are looked up from the measurement: for plants whose behaviour changes with the operating point. Give the points (At) and Kp, Ki at each; between them the gains are interpolated.',
  scheduledPI: 'A PI computed from the plant: at each level of the measurement the page finds the input that holds it, linearises the plant there and fits a first-order lag; Kp and Ki then cancel that lag so the loop answers with the time constant Tcl. One level gives a fixed PI, several a gain-scheduled one. It starts with the input that holds the level the plant starts at. The reference feedforward (Kff, Kv, Ka) and the anti-windup are yours, as in the PID.',
  swingUp: 'For a pendulum on a cart (inputs r, x, θ, v, ω). Far from upright it pumps energy into the swing, so that a Lyapunov function of the energy error always falls; near the top it switches to state feedback and holds the pole.',
  swingUpLqr: 'The energy swing-up (the pump gains are yours), with the catch near the top designed by LQR from the cart and pole as they are wired: Q weighs x, θ, v, ω, R the force. The pole length and g the pump measures energy with come from the plant too. Change the pole and both follow.',
  trajectory: 'A swing-up planned in the page from the plant as it is wired: a force F(t) that takes it from where it starts to rest at the top in T seconds, followed with time-varying LQR that corrects small errors along the way, then LQR holds it. The plan uses a share of the force limit and leaves the rest to the feedback. Changing T, the segments, that share or a limit plans again (a few seconds); Q, R and the start only recompute the gains.',
  kalman: 'Predicts the states with a model of the plant as it is wired (linearised at its origin), then corrects with the measurements, weighing them by the noise: Q is a random push on u (or one value per state), R the noise on each measurement, taken from the noise and quantizer blocks on its way when left empty. A large R trusts the model, a large Q the measurements. The gain is the steady-state Kalman gain; its estimates are the states the observer can see, and a controller designed on them looks through to those states.',
  relay: 'On/off control, as a thermostat: full push one way or the other by the sign of the error, switching once it passes ±ε. Around a setpoint it makes the loop oscillate; the Auto-tune tab reads Ku and Pu from that oscillation.',
  slidingMode: 'Sliding mode (inputs r, y, ẏ): drives s = λ·e + ė to zero by switching u = u0 ± K. On the line s = 0 the error decays as e^(−λt) whatever the inertia or the load, so λ sets how the loop settles. φ = 0 is the textbook relay: robust, but it chatters at the sampling rate, hard on the actuator. φ > 0 is a boundary layer: proportional inside |s| < φ (a stiff PD, Kp = K·λ/φ, Kd = K/φ), smooth, but a load leaves an error. Needs a clean ẏ; put a differentiator in the diagram, not in the law.',
  superTwisting: 'Super-twisting, a second-order sliding mode (inputs r, y, ẏ): u = k1·√|s|·sign(s) + v, with the integral part v rising at k2 by the sign of s. The voltage is continuous and v rejects a constant load; actuator dynamics leave a small ripple, and a long reaching phase winds v up, so s overshoots the line before it slides. Size k1, k2 for the weakest plant.',
  kalmanModel: 'A Kalman filter on a model you give: ẋ = A x + B u, y = C x, row by row. The page discretises it at Ts and computes the steady-state gain L from Q (the variance of the noise on each state) and R (on each measurement). For a plant the page cannot see, such as an External plant; on a plant it can see, the Kalman filter from the plant computes the model as well.',
  luenbergerPlaced: 'A Luenberger observer whose model comes from the plant as it is wired (linearised at its origin), as the Kalman filter\'s does, but whose gain L you set by where the estimate\'s error dies out: each pole at s = −w. Fast poles follow the measurement closely, and its noise with it; slow ones trust the model and lag behind what it does not know, such as a load. One measurement; Copy as numbers gives the Luenberger observer it runs.',
  luenberger: 'Predicts with the model and corrects with a fixed gain L that you choose (by pole placement, for example).',
  difference: 'The naive estimate: each measurement and its rate by finite differences, optionally low-pass filtered. Quantised or noisy measurements make the rate jump.',
};
const LIBS = { controller: CONTROLLERS, observer: OBSERVERS };
const STATUS_WORD = { ok: 'ok', warn: 'warning', error: 'error', pending: 'planning', stale: 're-planning', cancelled: 'cancelled' };
// The status as a badge's lamp (design-system.md: a state in a word).
const STATUS_LAMP = { ok: 'ok', warn: 'warn', pending: 'warn', stale: 'warn', error: 'bad', cancelled: 'bad' };
const WAITING = ['pending', 'stale'];

export function createControllerTab(host, app) {
  let target = null;   // path of subsystem ids and the Controller block id
  let planOpen = false;   // the Plan fold, kept while the page is open

  host.innerHTML = `
    <div class="banner notloop" id="ct-notloop" role="note" hidden></div>
    <div class="ctl">
      <section class="gcol" aria-label="Controller block">
        <div class="ghead"><h3 class="label">Controller</h3><span class="badge" id="ct-lanes" title="One block, its variants shared by every lane; each lane runs its own copy of the law, with its own design" hidden></span></div>
        <div id="ct-blocks" class="ctblocks"></div>
        <div id="ct-block" class="pform"></div>
        <p class="note" id="ct-ports"></p>
      </section>
      <section class="gcol" aria-label="Variants">
        <div class="ghead"><h3 class="label">Variants</h3><button class="btn btn-sm" id="ct-dup" title="Copy the running variant">Duplicate</button><button class="btn btn-sm btn-danger" id="ct-del" title="Remove the running variant">Delete</button></div>
        <ul class="lcd list vlist" id="ct-vars" role="listbox" aria-label="Variants: click one to run it"></ul>
        <p class="note">Click a variant to run it; the run before stays faded on the display. Double-click to rename.</p>
        <figure class="card ctdiag" id="ct-diag" hidden></figure>
      </section>
      <section class="gcol" aria-label="Parameters">
        <div class="ghead"><h3 class="label" id="ct-ptitle">Parameters</h3></div>
        <div class="ctwork">
          <div id="ct-params" class="pform ctparams"></div>
          <div id="ct-computed" class="lcd cbox" aria-label="Computed from the plant" aria-live="polite" hidden></div>
        </div>
        <details class="more" id="ct-aboutbox"><summary class="disclosure label"><span class="chev"></span>About this type</summary><p class="note" id="ct-about"></p></details>
      </section>
      <section class="gcol" aria-label="Controller library">
        <div class="ghead"><h3 class="label">Library</h3></div>
        <div id="ct-lib" class="ctlib"></div>
      </section>
    </div>
    <div id="ct-empty" hidden></div>`;
  const $ = (s) => host.querySelector(s);

  const root = () => app.project.system.plant?.type === 'diagram' ? app.project.system.plant.diagram : null;
  // Every Controller block, at any depth: [{ path, block, where }].
  function controllers() {
    const out = [];
    const walk = (d, path, where) => {
      for (const b of d.blocks) {
        if (b.type === 'controller' || b.type === 'observer') out.push({ path: [...path, b.id], block: b, where: [...where, b.name ?? b.id].join(' / ') });
        if (b.type === 'subsystem') walk(b.diagram, [...path, b.id], [...where, b.name ?? b.id]);
      }
    };
    if (root()) walk(root(), [], []);
    return out;
  }
  const levelOf = (d, path) => path.slice(0, -1).reduce((lv, id) => lv.blocks.find((b) => b.id === id).diagram, d);
  const current = () => {
    const all = controllers();
    const hit = target && all.find((c) => c.path.join('/') === target.join('/'));
    return hit ?? all[0] ?? null;
  };
  // A Controller with lanes (robot.md §5): its lane count, else 0.
  const lanesOf = (c) => (c.block.type === 'controller' && c.block.params.lanes > 1 ? c.block.params.lanes : 0);
  // What the running designed variant of a block computed (app.designStatuses,
  // from the last run). A block with lanes is designed per lane
  // ('ctl/servos[2]'): its statuses as one, the numbers a table by lane.
  const statusOf = (c) => {
    const all = app.designStatuses ?? [], p = c.path.join('/'), n = lanesOf(c);
    if (!n) return all.find((s) => s.path === p) ?? null;
    const per = Array.from({ length: n }, (_, k) => all.find((s) => s.path === `${p}[${k + 1}]`) ?? null);
    return per.every(Boolean) ? lanesStatus(per) : null;
  };

  // Edits the current block in a copy of the diagram; the app takes it as one undo step.
  function edit(fn) {
    const c = current();
    if (!c) return false;
    const next = structuredClone(root());
    const lv = levelOf(next, c.path);
    const blk = lv.blocks.find((b) => b.id === c.path.at(-1));
    if (fn(blk, lv) === false) return false;
    try { app.setPlant(normalizeDiagram(next)); } catch (err) { app.toast(err.message); render(); return false; }
    return true;
  }

  function field(key, label, value, hint, kind = 'number', title = '', nullable = false) {
    return `<label class="pf${kind === 'vector' ? ' wide' : ''}" title="${esc(title)}"><span class="flabel">${esc(label)}</span><input class="field field-sm mono" data-k="${esc(key)}" data-kind="${kind}" ${nullable ? 'data-null="1"' : ''} value="${esc(value)}" spellcheck="false" ${kind === 'number' ? 'inputmode="decimal"' : ''}><span class="hint">${esc(hint)}</span></label>`;
  }
  const show = (v) => (Array.isArray(v) ? v.map((x) => num(x, 5)).join(', ') : Number.isFinite(v) ? num(v, 6) : '');
  // A parameter's hint: its unit, and for a vector what its entries stand
  // for, named by what feeds the block's inputs ("x, θ, v, ω").
  function hintOf(p, names) {
    const meas = names.slice(1);
    const per = p.per === 'measurement' ? `for ${meas.join(', ')}` : p.per === 'level' ? `levels of ${meas[0] ?? 'y1'}` : p.per === 'lane' ? 'per lane, or one for all' : '';
    return [p.kind === 'vector' ? 'comma-separated' : '', per, p.unit === 'u' ? 'units of u' : p.unit ?? '', /^umin|umax$/.test(p.key) ? 'empty: no limit' : '', p.nullable ? p.empty ?? 'empty: from the plant' : ''].filter(Boolean).join(' · ');
  }
  // A parameter with named options (anti-windup): a select.
  const choice = (key, p, value) => `<label class="pf" title="${esc(p.help ?? '')}"><span class="flabel">${esc(p.label)}</span><select class="field field-sm" data-k="${esc(key)}" data-kind="choice">${Object.entries(p.options).map(([k, l]) => `<option value="${esc(k)}" ${k === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select><span class="hint"></span></label>`;

  function render() {
    const all = controllers();
    const c = current();
    // Reference mode (Live): the plant runs its own controller; the page's
    // are not in the loop, and the tab says so plainly.
    const notLoop = ['reference', 'log'].includes(app.hilMode?.());
    $('#ct-notloop').hidden = !notLoop || !c;
    if (notLoop) $('#ct-notloop').innerHTML = '<span class="banner-text"><b class="text-bad">Not in the loop.</b> This system\'s plant runs its own controller (reference mode): the page sends it the references and records what comes back. The Controller blocks here compute, but what they put out does not drive the plant.</span>';
    $('.ctl').hidden = !c;
    $('#ct-empty').hidden = !!c;
    if (!c && notLoop) {
      $('#ct-empty').innerHTML = '<div class="notice"><h3 class="label">The plant runs its own controller</h3><p class="note"><b>Not in the loop:</b> in reference mode the External plant takes references, not a control effort, so its own controller closes the loop, with its own limits and monitoring. The page sends the references (Input tab) and records what comes back, the plant\'s own control effort included. Controllers and Auto-tune in this page are not in the loop.</p></div>';
      return;
    }
    if (!c) {
      $('#ct-empty').innerHTML = `<div class="notice"><h3 class="label">No controller in this plant</h3><p class="note">Add a <b>Controller</b> block from the library's Control group in the Plant tab. Wire the reference r to its first input and the measurements to the next ones, and its output u to the plant. Then it shows here, with its variants. Or load a controlled system from the <b>System library</b>.</p></div>`;
      return;
    }
    target = c.path;
    const b = c.block;
    $('#ct-blocks').innerHTML = all.length > 1 ? all.map((x) => `<button class="btn btn-block" data-path="${esc(x.path.join('/'))}" aria-pressed="${x === c}">${esc(x.where)}</button>`).join('') : `<div class="heading">${esc(c.where)}</div>`;
    $('#ct-blocks').querySelectorAll('[data-path]').forEach((el) => el.addEventListener('click', () => { target = el.dataset.path.split('/'); render(); }));
    const obs = b.type === 'observer', lib = LIBS[b.type], lanes = lanesOf(c);
    $('#ct-lanes').hidden = !lanes;
    $('#ct-lanes').textContent = lanes ? `${lanes} lanes` : '';
    $('#ct-block').innerHTML = field('b:inputs', 'Inputs', b.params.inputs, obs ? 'u, then the measurements' : 'r, then the measurements')
      + (obs ? field('b:outputs', 'Estimates', b.params.outputs, 'states it puts out') : '')
      + field('b:Ts', 'Sample time', num(b.params.Ts, 4), 'Ts, s; every variant runs at it');
    const names = blockInputNames(root(), c.path);
    $('#ct-ports').innerHTML = `<b>In</b> <span class="ports">${names.map((n, k) => `<span class="chip">${k + 1} ${esc(n)}${lanes ? ` ×${lanes}` : ''}</span>`).join('')}</span>`
      + (lanes ? `<br>Each input is a group of ${lanes}, one per lane${b.params.ff ? ', the last the feedforward ff' : ''}; u is ${lanes} wide. The variants are shared by every lane, each lane designed on its own.` : '');

    // The type beside each name (.vtype: a variant from the plant says how its
    // design stands, renderGlyphs).
    $('#ct-vars').innerHTML = b.variants.map((v, i) => `<li class="item vrow" data-v="${i}" role="option" aria-selected="${i === b.variant}" tabindex="${i === b.variant ? 0 : -1}" title="${i === b.variant ? 'Running · double-click or F2 to rename' : 'Click or Enter to run it · double-click or F2 to rename'}">
        <span class="vdot" aria-hidden="true">${i === b.variant ? '▶' : ''}</span><span class="name">${esc(v.name)}</span><span class="hint vtype">${esc(lib[v.type].label)}</span></li>`).join('');
    $('#ct-del').disabled = b.variants.length < 2;
    drawStructure($('#ct-diag'), b, lib, names);

    const v = b.variants[b.variant];
    const def = lib[v.type];
    // The formula keeps its case (Λ and Φ are other letters than λ and φ).
    $('#ct-ptitle').innerHTML = `${esc(v.name)} ·<span class="mono">${esc(def.summary)}</span>`;
    const one = (p) => p.kind === 'choice' ? choice(`p:${p.key}`, p, v.params[p.key]) : p.table ? `<div class="pf"><span class="flabel">${esc(p.label)}</span><span class="hint mono">${v.params[p.key].length} values, from the project's JSON</span></div>` : field(`p:${p.key}`, p.label, show(v.params[p.key]), hintOf(p, names), p.kind ?? 'number', p.help ?? '', !!p.nullable);
    // Inputs that start a long computation (a plan) sit in a fold, so they
    // are changed on purpose, not nudged by the way.
    const light = def.params.filter((p) => !p.heavy), heavy = def.params.filter((p) => p.heavy);
    $('#ct-params').innerHTML = def.params.length
      ? light.map(one).join('') + (heavy.length ? `<details class="more pfold" id="ct-plan" ${planOpen ? 'open' : ''}><summary class="label disclosure"><span class="chev" aria-hidden="true"></span>Plan</summary><p class="hint">Changing these (or a limit) computes the plan again, which takes a few seconds.</p>${heavy.map(one).join('')}</details>` : '')
      : '<p class="note">No parameters.</p>';
    $('#ct-plan')?.addEventListener('toggle', (e) => { planOpen = e.target.open; });
    $('#ct-about').textContent = ABOUT[v.type] ?? '';
    $('#ct-aboutbox').hidden = !ABOUT[v.type];
    // The library: designs computed from the plant first, then the hand types.
    const types = Object.keys(lib);
    const group = (title, list) => (list.length ? `<h4 class="label">${title}</h4>` + list.map((t) => `<button class="btn btn-block btn-col" data-add="${t}" title="${esc(ABOUT[t] ?? '')}">${esc(lib[t].label)}<span class="btn-note">${esc(lib[t].summary)}</span></button>`).join('') : '');
    $('#ct-lib').innerHTML = group('From the plant', types.filter((t) => lib[t].designed)) + group('By hand', types.filter((t) => !lib[t].designed));
    bind(c);
    renderComputed();
  }

  // The variant glyphs and the Computed box, from the last run's design
  // statuses. Touches no input.
  function renderComputed() {
    const c = current();
    if (!c || $('.ctl').hidden) return;
    const b = c.block, lib = LIBS[b.type], st = statusOf(c);
    renderGlyphs(c, st);
    const box = $('#ct-computed');
    const v = b.variants[b.variant], def = lib[v.type];
    // The picture of what it does carries the numbers the design computed.
    if (def.designed) drawStructure($('#ct-diag'), b, lib, blockInputNames(root(), c.path), st?.lanes ? null : st?.values ?? null);
    box.hidden = !def.designed;
    if (!def.designed) { box.innerHTML = ''; return; }
    const off = b.type === 'observer' ? 'zero estimates' : 'u = 0';
    if (!st) {
      box.innerHTML = `<div class="chead"><h4 class="label">Computed</h4></div><p class="note">Not computed: ${app.systemError ? 'the plant does not run (see the Plant tab)' : 'the plant has not run yet'}.</p>`;
      return;
    }
    const waiting = WAITING.includes(st.status);
    const canCopy = st.values && def.manual && !waiting && st.status !== 'cancelled' && !st.lanes;
    const time = waiting ? percent(st) : st.status === 'cancelled' ? '' : st.cached ? 'cached' : st.ms >= 1000 ? `${(st.ms / 1000).toFixed(1)} s` : `${st.ms < 10 ? st.ms.toFixed(1) : Math.round(st.ms)} ms`;
    let body = `<p><b>${esc(def.label)}</b>${st.at ? ` at ${esc(st.at)}` : ''}</p>`;
    if (st.seen) body += `<p><span class="muted">plant seen${st.lanes ? ' by lane 1' : ''}</span> ${esc(st.seen)}</p>`;
    if (st.error) body += `<p class="text-bad">${esc(st.error.message)}</p>${st.error.hint ? `<p class="note">${esc(st.error.hint)}</p>` : ''}<p class="note">Until then the block puts out ${off}.</p>`;
    // A plan being made in the background: its progress, and what runs meanwhile.
    // Its Cancel (or, once cancelled, Plan) sits right under it, above the rows.
    if (waiting) {
      body += `<div class="cprog" data-key="${esc(st.key)}"><div class="progress" role="progressbar" aria-label="Planning" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(100 * (st.progress?.fraction ?? 0))}"><span style="width:${(100 * (st.progress?.fraction ?? 0)).toFixed(1)}%"></span></div>`
        + `<p class="note mono cprogline">${esc(progressLine(st.progress))}</p></div>`
        + `<p class="note">${st.status === 'stale' ? 'Meanwhile the block runs the previous plan; the display takes the new one from its start when it is ready.' : `Until it is ready the block puts out ${off}; the display then takes the new run from its start.`}</p>`
        + '<div class="pbtns"><button class="btn btn-sm" data-act="cancel" title="Stop planning; the block keeps what it runs now">Cancel</button></div>';
    }
    if (st.status === 'cancelled') {
      body += `<p class="note">Planning was cancelled. ${st.values ? 'The block runs the previous plan' : `The block puts out ${off}`} until you press Plan or change its inputs.</p>`
        + '<div class="pbtns"><button class="btn btn-sm" data-act="retry" title="Plan again with these inputs">Plan</button></div>';
    }
    if ((st.status === 'stale' || st.status === 'cancelled') && st.rows.length) body += '<p class="note">The previous plan:</p>';
    body += st.rows.map(rowHtml).join('');
    if (st.warnings.length) body += `<ul class="text-warn cwarn">${st.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`;
    box.innerHTML = `<div class="chead"><h4 class="label">Computed</h4><span class="badge" data-lamp="${STATUS_LAMP[st.status] ?? 'warn'}">${esc(STATUS_WORD[st.status] ?? st.status)}</span><span class="hint mono cmeta" title="the design's key: the same inputs give the same numbers">${time ? `${time} · ` : ''}#${esc(st.key.slice(0, 6))}</span></div>${body}`
      + (canCopy ? '<div class="pbtns"><button class="btn btn-sm" data-act="copy" title="Add a hand variant with these numbers after this one, and run it">Copy as numbers</button></div>' : '');
    // Bound inside the box: the Plan fold of the inputs has an id of its own.
    box.querySelector('[data-act="copy"]')?.addEventListener('click', () => copyAsNumbers(c, st));
    box.querySelector('[data-act="cancel"]')?.addEventListener('click', () => app.cancelDesign(st.key));
    box.querySelector('[data-act="retry"]')?.addEventListener('click', () => app.retryDesign(st.key));
  }

  // The variant glyphs: "computed", or how its design stands when it runs.
  function renderGlyphs(c, st) {
    const b = c.block, lib = LIBS[b.type];
    host.querySelectorAll('#ct-vars [data-v]').forEach((row) => {
      const i = Number(row.dataset.v), v = b.variants[i], def = lib[v.type];
      const g = row.querySelector('.vtype');
      // A word or a mark, never colour alone: only the running variant (lit) has a status.
      let text = def.label;
      if (def.designed) {
        const s = i === b.variant ? st : null;
        if (s?.status === 'error') text = '! no design';
        else if (s?.status === 'warn') text = '! computed';
        else if (s && WAITING.includes(s.status)) text = `⟳ ${percent(s)}`;
        else if (s?.status === 'cancelled') text = 'cancelled';
        else text = 'computed';
      }
      g.textContent = text;
      const keys = i === b.variant ? 'Running · double-click or F2 to rename' : 'Click or Enter to run it · double-click or F2 to rename';
      row.title = def.designed ? `${def.label}: computed from the plant${i === b.variant && st?.error ? `. ${st.error.message}` : ''}. ${keys}` : keys;
    });
  }

  // A plan's progress, at most 10 times a second: the bar, its line, the
  // glyph and the percentage; the rest of the box (and its Cancel button)
  // stays. Anything else changed: the whole box.
  function renderProgress() {
    const c = current();
    if (!c || $('.ctl').hidden) return;
    const st = statusOf(c), box = $('#ct-computed'), prog = box.querySelector('.cprog');
    if (!st || !WAITING.includes(st.status) || !prog || prog.dataset.key !== st.key) { renderComputed(); return; }
    const f = 100 * (st.progress?.fraction ?? 0);
    prog.querySelector('.progress span').style.width = `${f.toFixed(1)}%`;
    prog.querySelector('.progress').setAttribute('aria-valuenow', String(Math.round(f)));
    prog.querySelector('.cprogline').textContent = progressLine(st.progress);
    box.querySelector('.cmeta').textContent = `${percent(st)} · #${st.key.slice(0, 6)}`;
    renderGlyphs(c, st);
  }

  // Copy as numbers: the design's numbers as a hand variant after this one,
  // running at once. It runs exactly as the designed one did, so the faded
  // run and the new one coincide; from now on its numbers stay put.
  function copyAsNumbers(c, st) {
    const lib = LIBS[c.block.type];
    const ok = edit((blk) => {
      const v = blk.variants[blk.variant];
      const twin = lib[v.type].manual(v.params, st.values);
      blk.variants.splice(blk.variant + 1, 0, normalizeVariant({ name: `${v.name.slice(0, 30)} (numbers)`, ...twin }, 'variant', lib));
      blk.variant += 1;
    });
    if (ok) app.toast('Copied: these numbers no longer follow the plant.');
  }

  function commitField(inp) {
    const k = inp.dataset.k, raw = inp.value.trim();
    // Text as rendered is left alone: a field shows rounded numbers, and
    // committing them would change what the variant holds.
    if (inp.value === inp.defaultValue) return;
    let value;
    if (raw === '' && inp.dataset.null) value = null;
    else if (inp.dataset.kind === 'choice') value = inp.value;
    else if (inp.dataset.kind === 'vector') {
      value = raw.split(/[\s,;]+/).filter(Boolean).map(parseSI);
      if (!value.length || !value.every(Number.isFinite)) { app.toast('Enter numbers separated by commas.'); render(); return; }
    } else if (raw === '' && /^p:umin|p:umax$/.test(k)) value = null;
    else {
      value = parseSI(raw);
      if (!Number.isFinite(value)) { app.toast('Enter a number, e.g. 0.5, 20m, 2k.'); render(); return; }
    }
    // An unchanged field is left alone: re-rendering on every blur would
    // swallow the click that moved the focus away.
    const c = current(), old = k.startsWith('b:') ? c.block.params[k.slice(2)] : c.block.variants[c.block.variant].params[k.slice(2)];
    const same = Array.isArray(value) ? Array.isArray(old) && value.length === old.length && value.every((x, i) => x === old[i]) : value === null ? old === null || (typeof old === 'number' && !Number.isFinite(old)) : value === old;
    if (same) return;
    edit((blk, lv) => {
      if (k.startsWith('b:')) {
        const key = k.slice(2);
        if (blk.params[key] === value) return false;
        blk.params[key] = value;
        if (key === 'inputs') lv.wires = lv.wires.filter((w) => { const t = parseEnd(w.to); return t.id !== blk.id || t.port < value; });
        return true;
      }
      const v = blk.variants[blk.variant];
      v.params[k.slice(2)] = value;
      return true;
    });
  }

  // The wheel nudges a number by 5 % (Shift: 1 %); in a vector, the entry
  // under the caret, once the field has the focus (so scrolling the column
  // over a list of weights changes none of them). The display, and any
  // design, follow at once, and the field keeps the focus and the caret.
  function nudge(inp, e) {
    const vector = inp.dataset.kind === 'vector';
    if (vector ? document.activeElement !== inp : inp.dataset.kind !== 'number') return;
    const parts = vector ? inp.value.split(',').map((x) => x.trim()) : [inp.value.trim()];
    const i = vector ? (inp.value.slice(0, inp.selectionStart ?? 0).match(/,/g) ?? []).length : 0;
    const v = parseSI(parts[i] ?? '');
    if (!Number.isFinite(v) || v === 0) return;
    e.preventDefault();
    parts[i] = num(v * (e.shiftKey ? 1.01 : 1.05) ** (e.deltaY < 0 ? 1 : -1), 4);
    inp.value = parts.join(', ');
    const caret = parts.slice(0, i + 1).join(', ').length;
    commitField(inp);
    const next = host.querySelector(`input[data-k="${inp.dataset.k}"]`);
    if (next) { next.focus(); if (vector) next.setSelectionRange(caret, caret); }
  }

  function bind(c) {
    host.querySelectorAll('input[data-k]').forEach((inp) => {
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.dataset.cancel = '1'; inp.blur(); } });
      inp.addEventListener('blur', () => { if (inp.dataset.cancel) { delete inp.dataset.cancel; render(); return; } commitField(inp); });
      inp.addEventListener('wheel', (e) => nudge(inp, e), { passive: false });
    });
    // A change re-renders the tab: the new select takes the focus, so the
    // arrow keys keep stepping through the options.
    host.querySelectorAll('select[data-k]').forEach((sel) => sel.addEventListener('change', () => {
      commitField(sel);
      host.querySelector(`select[data-k="${sel.dataset.k}"]`)?.focus();
    }));
    // The variants are a list box: click, Enter or Space runs one; the arrows
    // move along the list; F2 or a double-click renames.
    const run = (i) => { if (i !== c.block.variant) edit((blk) => { blk.variant = i; }); host.querySelector(`[data-v="${i}"]`)?.focus(); };
    host.querySelectorAll('[data-v]').forEach((row) => {
      const i = Number(row.dataset.v);
      row.addEventListener('click', () => run(i));
      row.addEventListener('dblclick', () => rename(row, i));
      row.addEventListener('keydown', (e) => {
        const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: c.block.variants.length - 1 }[e.key];
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); run(i); }
        else if (e.key === 'F2') { e.preventDefault(); e.stopPropagation(); rename(row, i); }
        else if (to !== undefined) { e.preventDefault(); e.stopPropagation(); host.querySelector(`[data-v="${Math.max(0, Math.min(c.block.variants.length - 1, to))}"]`)?.focus(); }
      });
    });
    $('#ct-dup').onclick = () => edit((blk) => {
      const v = structuredClone(blk.variants[blk.variant]);
      v.name = `${v.name} copy`.slice(0, 40);
      blk.variants.splice(blk.variant + 1, 0, v);
      blk.variant += 1;
    });
    $('#ct-del').onclick = () => edit((blk) => {
      if (blk.variants.length < 2) return false;
      blk.variants.splice(blk.variant, 1);
      blk.variant = Math.min(blk.variant, blk.variants.length - 1);
    });
    host.querySelectorAll('[data-add]').forEach((btn) => btn.addEventListener('click', () => edit((blk) => {
      const type = btn.dataset.add, prev = blk.variants[blk.variant].params;
      if (blk.type === 'observer') { blk.variants.push(normalizeVariant({ type }, 'variant', OBSERVERS)); blk.variant = blk.variants.length - 1; return; }
      // A type this block cannot run (sliding mode on a block without ẏ) is
      // refused here, saying what to change, not by the diagram's check.
      const why = CONTROLLERS[type].check?.(normalizeVariant({ type }).params, { inputs: blk.params.inputs });
      if (why) { app.toast(`${CONTROLLERS[type].label} cannot run on this block: ${why}.`); return false; }
      const v = normalizeVariant({ type });
      // A new variant drives the same actuator: it keeps the limits, and a
      // gain or weight vector gets one entry per measurement.
      const m = Math.max(1, blk.params.inputs - 1);
      if ('umin' in v.params) { v.params.umin = prev.umin ?? -Infinity; v.params.umax = prev.umax ?? Infinity; }
      if (Array.isArray(v.params.K)) { v.params.K = new Array(m).fill(0); v.params.kr = 0; }
      if (Array.isArray(v.params.Q)) v.params.Q = new Array(m).fill(1);
      blk.variants.push(v);
      blk.variant = blk.variants.length - 1;
      app.toast(CONTROLLERS[type].designed ? `Added ${v.name}: its numbers are computed from the plant; set its inputs, then compare.` : `Added ${v.name}: set its parameters, then compare with the others.`);
    })));
  }

  function rename(row, i) {
    const name = row.querySelector('.name');
    const inp = document.createElement('input');
    inp.className = 'field field-sm mono';
    inp.value = controllers().length ? current().block.variants[i].name : '';
    name.replaceWith(inp);
    inp.focus(); inp.select();
    // Once: Enter or Esc redraws the list, which blurs the field. From the
    // keyboard, focus goes back to the renamed row, so the place is kept.
    let finished = false;
    const done = (ok, refocus) => {
      if (finished) return;
      finished = true;
      if (!(ok && inp.value.trim() && edit((blk) => { blk.variants[i].name = inp.value.trim().slice(0, 40); }))) render();
      if (refocus) $(`#ct-vars [data-v="${i}"]`)?.focus();
    };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true, true); if (e.key === 'Escape') done(false, true); });
    inp.addEventListener('blur', () => done(true, false), { once: true });
  }

  return {
    render() { if (!host.hidden) render(); },
    // Only the Computed box and the variant glyphs, for designs that settle on their own.
    renderComputed() { if (!host.hidden) renderComputed(); },
    // Only a plan's progress in the box, its glyph and percentage.
    renderProgress() { if (!host.hidden) renderProgress(); },
    shown: render,
    open(path) { target = path; },
  };
}

// The design statuses of a block's lanes as one (Controller tab, Computed):
// the worst status, the first error (with its lane), the warnings once each
// (with the lanes they hold for, unless all), and the numbers as a table, a
// row per lane. Notes that differ by lane are left out.
const WORST = ['error', 'cancelled', 'pending', 'stale', 'warn', 'ok'];
function lanesStatus(per) {
  const n = per.length, worst = WORST.find((w) => per.some((s) => s.status === w)) ?? per[0].status;
  const bad = per.findIndex((s) => s.error);
  const nums = per[0].rows.filter((r) => typeof r.value === 'number');
  const table = per.map((s, k) => [k + 1, ...nums.map((r) => s.rows.find((x) => x.label === r.label)?.value ?? '–')]);
  const notes = nums.filter((r) => r.note && per.every((s) => s.rows.find((x) => x.label === r.label)?.note === r.note)).map((r) => `${r.label}: ${r.note}`);
  const said = new Map();
  per.forEach((s, k) => { for (const w of s.warnings) said.set(w, [...(said.get(w) ?? []), k + 1]); });
  const warnings = [...said].map(([w, ks]) => (ks.length === n ? w : `lane${ks.length > 1 ? 's' : ''} ${ks.join(', ')}: ${w}`));
  const rows = nums.length ? [{ table, head: ['lane', ...nums.map((r) => r.label)] }, ...(notes.length ? [{ sentence: true, label: '', value: notes.join(' · ') }] : [])] : [];
  return {
    ...per[0], lanes: n, status: worst, values: per.every((s) => s.values) ? per[0].values : null,
    ms: per.reduce((a, s) => a + (s.ms ?? 0), 0), cached: per.every((s) => s.cached),
    error: bad < 0 ? null : { ...per[bad].error, message: `lane ${bad + 1}: ${per[bad].error.message}` },
    progress: per.find((s) => s.progress)?.progress ?? null, rows, warnings,
  };
}

// How far a plan is: '43 %'.
const percent = (st) => `${Math.round(100 * (st.progress?.fraction ?? 0))} %`;
// A plan's progress in words: the stage, iteration, cost and defect (planner.js).
function progressLine(p) {
  if (!p) return 'starting';
  const e = (x) => (Number.isFinite(x) ? x.toExponential(1) : '–');
  return `stage ${p.stage} of ${p.stages} · iteration ${p.iteration} · cost ${e(p.cost)} · defect ${e(p.defect)}${p.start > 1 ? ` · start ${p.start} of ${p.starts}` : ''}`;
}

// One row of a design's status: labelled values (K for x, θ, …), a number
// with a note, a sentence, a table, or a sparkline (a plan's F(t)).
function rowHtml(r) {
  if (r.spark) return `<div class="crow"><span class="muted">${esc(r.label)}</span><span class="cv">${sparkSvg(r.spark)}${r.note ? ` <span class="muted">${esc(r.note)}</span>` : ''}</span></div>`;
  if (r.sentence) return `<div class="crow"><span class="muted">${esc(r.label)}</span><span>${esc(r.value)}</span></div>`;
  if (r.table) {
    // Three digits in a table, so it fits beside the parameters; Copy as numbers keeps them all.
    return `<div class="ctabwrap"><table class="ctab"><thead><tr>${r.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${r.table.map((row) => `<tr>${row.map((x) => `<td>${val(x, 3)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  const value = Array.isArray(r.value)
    ? (r.labels ? r.value.map((x, i) => `<span class="cpair"><i class="muted">${esc(r.labels[i] ?? '')}</i>${val(x)}</span>`).join('') : r.value.map((x) => val(x)).join(', '))
    : val(r.value);
  return `<div class="crow"><span class="muted">${esc(r.label)}</span><span class="cv mono">${value}${r.note ? ` <span class="muted">${esc(r.note)}</span>` : ''}</span></div>`;
}
// A sparkline with its zero line, scaled to fit.
function sparkSvg(v) {
  const W = 180, H = 28, lo = Math.min(0, ...v), hi = Math.max(0, ...v);
  const y = (x) => (H - 1 - ((x - lo) / (hi - lo || 1)) * (H - 2)).toFixed(1);
  const pts = v.map((x, i) => `${((i / Math.max(1, v.length - 1)) * W).toFixed(1)},${y(x)}`).join(' ');
  return `<svg class="cspark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}"/><polyline points="${pts}"/></svg>`;
}
const val = (x, digits = 4) => (typeof x === 'number' ? num(x, digits).replace(/^-/, '−') : esc(x ?? ''));

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
