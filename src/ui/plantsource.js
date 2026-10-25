// The plant Auto-tune and Analysis work on (design/output/identification.md
// §10, §12): the diagram, or the model the Identify tab identified. One
// choice per Controller block, shared by both tabs and the Identify tab's
// "Use for Auto-tune and Analysis", for this page session (the model it
// names is computed from a record whenever it is needed). On a plant
// outside the page (an External block) there is no diagram to simulate:
// the identified model is always used, and without one both tabs say to
// identify first.

import { findExternal } from '../core/hil.js';
import { num } from './units.js';

export const IDENTIFY_FIRST = 'identify the plant first (Identify tab)';

export function createPlantSource(app) {
  const chosen = new Map();   // block key → 'identified' | 'diagram'
  const diagram = () => (app.project.system.plant?.type === 'diagram' ? app.project.system.plant.diagram : null);
  const hil = () => !!(diagram() && findExternal(diagram()));
  const get = (key) => (hil() ? 'identified' : chosen.get(key) ?? 'diagram');
  // The identified model for a block, as the Identify tab has it, or null.
  const inUse = (key) => app.identifiedFor?.(key) ?? null;

  // What the model is, in a few words: "T · test 1, two lags, ! explains 99 %".
  function label(use) {
    const m = use?.model;
    if (!m?.ok) return use?.name ?? '';
    const fit = m.check?.fit ?? m.fit;
    return `${use.name}: ${m.label}, ${m.grade} explains ${Number.isFinite(fit) ? fitText(fit) : '?'} %`;
  }

  // The state of a block's source: { on: 'diagram' | 'identified', use (the
  // model in use, or null), why (identified but no model to use: in red),
  // note (a word on the model) }.
  function state(key) {
    const on = get(key);
    const use = inUse(key);
    if (on === 'diagram') return { on, use, why: null, note: '' };
    if (!use) return { on, use, why: IDENTIFY_FIRST, note: '' };
    if (!use.model) return { on, use, why: null, wait: true, note: 'Computing the model from the record…' };
    if (!use.model.ok) return { on, use, why: `the test gives no model: ${use.model.sentences?.[0] ?? ''} Identify again (Identify tab)`, note: '' };
    const notes = [label(use)];
    if (use.earlier) notes.push('! Measured on an earlier connection: the plant may have changed. Check again tells (Identify tab).');
    return { on, use, why: null, note: notes.join(' ') };
  }

  // The selector, "Plant: [the diagram | the model]" (the identified model),
// and the
  // line under it. On a plant outside the page only the model is offered.
  function html(key, { disabled = false } = {}) {
    const s = state(key);
    const lock = disabled ? 'disabled' : '';
    const has = !!s.use?.model?.ok;
    const keys = hil()
      ? `<span class="hint">the identified model: the plant is outside the page</span>`
      : `<span class="seg seg-fill" role="radiogroup" aria-label="Plant">`
        + `<button class="btn btn-sm" data-plantsrc="diagram" role="radio" aria-checked="${s.on === 'diagram'}" title="The diagram: simulate the plant as it is built" ${lock}>the diagram</button>`
        + `<button class="btn btn-sm" data-plantsrc="identified" role="radio" aria-checked="${s.on === 'identified'}" title="${esc(has ? 'The identified model: work on the model the Identify tab found' : 'The identified model: none yet, run a test in the Identify tab')}" ${lock || (!has && s.on !== 'identified' ? 'disabled' : '')}>the model</button></span>`;
    const line = s.why ? `<span class="text-bad">✕ ${esc(s.why)}</span>` : s.note ? esc(s.note) : '';
    return `<div class="pf plantsrc"><span class="flabel">Plant</span>${keys}</div>${line ? `<p class="note plantsrc-note">${line}</p>` : ''}`;
  }
  function bind(el, key, then) {
    el.querySelectorAll('[data-plantsrc]').forEach((b) => { b.onclick = () => { set(key, b.dataset.plantsrc); then?.(); }; });
  }
  function set(key, v) {
    if (v === 'identified') chosen.set(key, v); else chosen.delete(key);
    app.plantSourceChanged?.();
  }

  return { hil, get, set, state, label, html, bind };
}

const fitText = (x) => (x >= 99 && x < 100 ? Math.min(99.9, Math.round(x * 10) / 10).toFixed(1) : num(Math.round(x), 3));
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
