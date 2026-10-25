// Tab 3, Controller: the Controller blocks of the plant, each with its
// variants (implementations with the same inputs and output, as Simulink's
// variant subsystems). Clicking a variant runs it; the previous run stays
// faded on the display for comparison. The active variant's parameters are
// edited here; the library adds new variants. See design/output/controller-proposal.md.

import { CONTROLLERS, normalizeVariant } from '../core/controllers.js';
import { OBSERVERS } from '../core/observers.js';
import { diagramBlockDef, normalizeDiagram, parseEnd, outputNames } from '../core/diagram.js';
import { num, parseSI } from './units.js';
import { drawStructure } from './ctldiagram.js';

// What each implementation is for, in a sentence or two.
const ABOUT = {
  off: 'No control: the plant gets u = 0. Shows what the plant does on its own.',
  pid: 'The workhorse. P reacts to the error, I removes what is left, D damps (on the measurement, filtered by Tf). b weights the reference in P; the prefilter Tr (Vorfilter) smooths reference jumps. Feedforward puts out what following r takes, from r alone: Kff·r, Kv·dr/dt, Ka·d²r/dt². u min/max are the actuator limits; anti-windup (clamping, back-calculation with Tt, or off) keeps the integral from winding up at a limit.',
  stateFeedback: 'u = kr·r − K·y: one gain per measured state (a matrix controller, Zustandsregler). With all states measured it can place every pole; LQR picks K by weighing state errors against effort. kr is the static prefilter so the output follows r.',
  gainScheduled: 'A PI whose gains are looked up from the measurement: for plants whose behaviour changes with the operating point. Give the points (At) and Kp, Ki at each; between them the gains are interpolated.',
  swingUp: 'For a pendulum on a cart (inputs r, x, θ, v, ω). Far from upright it pumps energy into the swing, so that a Lyapunov function of the energy error always falls; near the top it switches to state feedback and holds the pole.',
  relay: 'On/off control, as a thermostat: full push one way or the other by the sign of the error, switching once it passes ±ε. Around a setpoint it makes the loop oscillate; the Auto-tune tab reads Ku and Pu from that oscillation.',
  slidingMode: 'Sliding mode (inputs r, y, ẏ): drives s = λ·e + ė to zero by switching u = u0 ± K. On the line s = 0 the error decays as e^(−λt) whatever the inertia or the load, so λ sets how the loop settles. φ = 0 is the textbook relay: robust, but it chatters at the sampling rate, hard on the actuator. φ > 0 is a boundary layer: proportional inside |s| < φ (a stiff PD, Kp = K·λ/φ, Kd = K/φ), smooth, but a load leaves an error. Needs a clean ẏ; put a differentiator in the diagram, not in the law.',
  superTwisting: 'Super-twisting, a second-order sliding mode (inputs r, y, ẏ): u = k1·√|s|·sign(s) + v, with the integral part v rising at k2 by the sign of s. The voltage is continuous and v rejects a constant load; actuator dynamics leave a small ripple, and a long reaching phase winds v up, so s overshoots the line before it slides. Size k1, k2 for the weakest plant.',
  kalman: 'Predicts the states with the model, then corrects with the measurements, weighing them by the noise you expect: a large R trusts the model, a large Q trusts the measurements. The gain is the steady-state Kalman gain.',
  luenberger: 'Predicts with the model and corrects with a fixed gain L that you choose (by pole placement, for example).',
  difference: 'The naive estimate: each measurement and its rate by finite differences, optionally low-pass filtered. Quantised or noisy measurements make the rate jump.',
};
const LIBS = { controller: CONTROLLERS, observer: OBSERVERS };

export function createControllerTab(host, app) {
  let target = null;   // path of subsystem ids and the Controller block id

  host.innerHTML = `
    <div class="ctl">
      <section class="gcol" aria-label="Controller block">
        <div class="ghead"><h3 class="label">Controller</h3></div>
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
        <div id="ct-params" class="pform ctparams"></div>
        <p class="note" id="ct-about"></p>
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

  // What feeds each input: "r", "x (cart and pole)", …
  function inputNames(c) {
    const lv = levelOf(root(), c.path);
    return Array.from({ length: c.block.params.inputs }, (_, k) => {
      const w = lv.wires.find((x) => { const t = parseEnd(x.to); return t.id === c.block.id && t.port === k; });
      if (!w) return 'not connected';
      const f = parseEnd(w.from), src = lv.blocks.find((b) => b.id === f.id);
      if (src.type === 'source') return src.params.signal;
      // A subsystem's output is named by its Out block ("speed" from Motor).
      if (src.type === 'subsystem') {
        const out = src.diagram.blocks.find((b) => b.type === 'outport' && b.params.port === f.port + 1);
        return out?.name ? `${out.name} (${src.name ?? src.id})` : (src.name ?? src.id);
      }
      const port = outputNames(diagramBlockDef(src.type), src.params)[f.port];
      return port || (src.name ?? src.id);
    });
  }

  function field(key, label, value, hint, kind = 'number', title = '') {
    return `<label class="pf" title="${esc(title)}"><span class="flabel">${esc(label)}</span><input class="field field-sm mono" data-k="${esc(key)}" data-kind="${kind}" value="${esc(value)}" spellcheck="false" ${kind === 'number' ? 'inputmode="decimal"' : ''}><span class="hint">${esc(hint)}</span></label>`;
  }
  const show = (v) => (Array.isArray(v) ? v.map((x) => num(x, 5)).join(', ') : Number.isFinite(v) ? num(v, 6) : '');
  // A parameter with named options (anti-windup): a select.
  const choice = (key, p, value) => `<label class="pf" title="${esc(p.help ?? '')}"><span class="flabel">${esc(p.label)}</span><select class="field field-sm" data-k="${esc(key)}" data-kind="choice">${Object.entries(p.options).map(([k, l]) => `<option value="${esc(k)}" ${k === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select><span class="hint"></span></label>`;

  function render() {
    const all = controllers();
    const c = current();
    $('.ctl').hidden = !c;
    $('#ct-empty').hidden = !!c;
    if (!c) {
      $('#ct-empty').innerHTML = `<div class="notice"><h3 class="label">No controller in this plant</h3><p class="note">Add a <b>Controller</b> block from the library's Control group in the Plant tab. Wire the reference r to its first input and the measurements to the next ones, and its output u to the plant. Then it shows here, with its variants. Or load a controlled system from the <b>System library</b>.</p></div>`;
      return;
    }
    target = c.path;
    const b = c.block;
    $('#ct-blocks').innerHTML = all.length > 1 ? all.map((x) => `<button class="btn btn-block" data-path="${esc(x.path.join('/'))}" aria-pressed="${x === c}">${esc(x.where)}</button>`).join('') : `<div class="heading">${esc(c.where)}</div>`;
    $('#ct-blocks').querySelectorAll('[data-path]').forEach((el) => el.addEventListener('click', () => { target = el.dataset.path.split('/'); render(); }));
    const obs = b.type === 'observer', lib = LIBS[b.type];
    $('#ct-block').innerHTML = field('b:inputs', 'Inputs', b.params.inputs, obs ? 'u, then the measurements' : 'r, then the measurements')
      + (obs ? field('b:outputs', 'Estimates', b.params.outputs, 'states it puts out') : '')
      + field('b:Ts', 'Sample time', num(b.params.Ts, 4), 'Ts, s; every variant runs at it');
    const names = inputNames(c);
    $('#ct-ports').innerHTML = `<b>In</b> <span class="ports">${names.map((n, k) => `<span class="chip">${k + 1} ${esc(n)}</span>`).join('')}</span>`;

    $('#ct-vars').innerHTML = b.variants.map((v, i) => `<li class="item vrow" data-v="${i}" role="option" aria-selected="${i === b.variant}" tabindex="${i === b.variant ? 0 : -1}" title="${i === b.variant ? 'Running · double-click or F2 to rename' : 'Click or Enter to run it · double-click or F2 to rename'}">
        <span class="vdot" aria-hidden="true">${i === b.variant ? '▶' : ''}</span><span class="name">${esc(v.name)}</span><span class="hint">${esc(lib[v.type].label)}</span></li>`).join('');
    $('#ct-del').disabled = b.variants.length < 2;
    drawStructure($('#ct-diag'), b, lib, names);

    const v = b.variants[b.variant];
    const def = lib[v.type];
    // The formula keeps its case (Λ and Φ are other letters than λ and φ).
    $('#ct-ptitle').innerHTML = `${esc(v.name)} ·<span class="mono">${esc(def.summary)}</span>`;
    $('#ct-params').innerHTML = def.params.length
      ? def.params.map((p) => p.kind === 'choice' ? choice(`p:${p.key}`, p, v.params[p.key]) : p.table ? `<div class="pf"><span class="flabel">${esc(p.label)}</span><span class="hint mono">${v.params[p.key].length} values, from the project's JSON</span></div>` : field(`p:${p.key}`, p.label, show(v.params[p.key]), [p.kind === 'vector' ? 'comma-separated' : '', p.unit === 'u' ? 'units of u' : p.unit ?? '', /^umin|umax$/.test(p.key) ? 'empty: no limit' : ''].filter(Boolean).join(' · '), p.kind ?? 'number', p.help ?? '')).join('')
      : '<p class="note">No parameters.</p>';
    $('#ct-about').textContent = ABOUT[v.type] ?? '';
    // Planned trajectories are made offline, not added by hand.
    $('#ct-lib').innerHTML = Object.keys(lib).filter((t) => t !== 'trajectory').map((t) => `<button class="btn btn-block btn-col" data-add="${t}" title="${esc(ABOUT[t] ?? '')}">${esc(lib[t].label)}<span class="btn-note">${esc(lib[t].summary)}</span></button>`).join('');
    bind(c);
  }

  function commitField(inp) {
    const k = inp.dataset.k, raw = inp.value.trim();
    let value;
    if (inp.dataset.kind === 'choice') value = inp.value;
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
    const same = Array.isArray(value) ? Array.isArray(old) && value.length === old.length && value.every((x, i) => x === old[i]) : value === null ? !Number.isFinite(old) : value === old;
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

  function bind(c) {
    host.querySelectorAll('input[data-k]').forEach((inp) => {
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.dataset.cancel = '1'; inp.blur(); } });
      inp.addEventListener('blur', () => { if (inp.dataset.cancel) { delete inp.dataset.cancel; render(); return; } commitField(inp); });
      // The wheel nudges a number by 5 % (Shift: 1 %), and the display follows at once.
      inp.addEventListener('wheel', (e) => {
        if (inp.dataset.kind !== 'number') return;
        const v = parseSI(inp.value);
        if (!Number.isFinite(v) || v === 0) return;
        e.preventDefault();
        const f = (e.shiftKey ? 1.01 : 1.05) ** (e.deltaY < 0 ? 1 : -1);
        inp.value = num(v * f, 4);
        commitField(inp);
        host.querySelector(`input[data-k="${inp.dataset.k}"]`)?.focus();
      }, { passive: false });
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
      // gain vector gets one entry per measurement.
      if ('umin' in v.params) { v.params.umin = prev.umin ?? -Infinity; v.params.umax = prev.umax ?? Infinity; }
      if (Array.isArray(v.params.K)) { v.params.K = new Array(Math.max(1, blk.params.inputs - 1)).fill(0); v.params.kr = 0; }
      blk.variants.push(v);
      blk.variant = blk.variants.length - 1;
      app.toast(`Added ${v.name}: set its parameters, then compare with the others.`);
    })));
  }

  function rename(row, i) {
    const name = row.querySelector('.name');
    const inp = document.createElement('input');
    inp.className = 'field field-sm mono';
    inp.value = controllers().length ? current().block.variants[i].name : '';
    name.replaceWith(inp);
    inp.focus(); inp.select();
    const done = (ok) => { if (ok && inp.value.trim()) edit((blk) => { blk.variants[i].name = inp.value.trim().slice(0, 40); }); else render(); };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    inp.addEventListener('blur', () => done(true), { once: true });
  }

  return {
    render() { if (!host.hidden) render(); },
    shown: render,
    open(path) { target = path; },
  };
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
