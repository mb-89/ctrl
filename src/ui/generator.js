// Tab 1, the signal generator: waveform keys, parameter fields with a digit
// cursor, a dial and keypad for entry, and the stack of components summed into
// r(t). A waveform is drafted first (previewed dashed on the display) and only
// joins the signal on Add. See design/output/signal-generator.md.

import { SIGNALS, normalizeComponent, describeComponent, parseWaveform } from '../core/signals.js';
import { createDial } from './dial.js';

const ICONS = {
  dc: 'M2 7 H22',
  step: 'M2 11 H9 V3 H22',
  ramp: 'M2 11 H7 L15 3 H22',
  pulse: 'M2 11 H8 V3 H13 V11 H22',
  square: 'M2 11 H5 V3 H9 V11 H13 V3 H17 V11 H21',
  sine: 'M2 7 C4.5 -1 7.5 -1 10 7 S15.5 15 18 7 S20.5 1 22 3',
  chirp: 'M2 7 C3.5 1 5.5 1 7 7 S10 13 11 7 S13 1 14 7 S15.5 13 16 7 S17.5 1 18 7 S19 12 19.5 7 S20.5 2 21 7',
  noise: 'M2 8 L4 5 L5 10 L7 4 L8 9 L10 6 L11 11 L13 3 L14 8 L16 6 L17 10 L19 5 L20 8 L22 7',
  arb: 'M2 11 L6 9 L9 4 L12 8 L15 6 L18 10 L22 3',
};
const ORDER = ['dc', 'step', 'ramp', 'pulse', 'square', 'sine', 'chirp', 'noise', 'arb'];
const icon = (type) => `<svg viewBox="0 0 24 14" aria-hidden="true"><path d="${ICONS[type]}"/></svg>`;
const LENGTH = { key: 'length', label: 'Length', unit: 's', min: 1e-6 };

export function createGenerator(root, app) {
  root.innerHTML = `
    <div class="gen">
      <section class="gcol gwave" aria-label="Waveform">
        <h3 class="glabel">Waveform</h3>
        <div class="wkeys">${ORDER.map((t) => `<button class="key wkey" data-type="${t}" title="${SIGNALS[t].label}${t === 'arb' ? ': load t, value rows from a CSV file' : ''}">${icon(t)}<span>${SIGNALS[t].label}</span></button>`).join('')}</div>
        <input type="file" id="arb-file" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden>
      </section>
      <section class="gcol gparams" aria-label="Parameters">
        <h3 class="glabel" id="g-mode"></h3>
        <div class="plist" id="g-plist"></div>
        <div class="pact">
          <button class="key wide primary" id="g-add">Add</button>
          <button class="key wide" id="g-cancel">Cancel</button>
        </div>
      </section>
      <section class="gcol gentry" aria-label="Entry">
        <h3 class="glabel">Entry</h3>
        <div class="dialrow">
          <button class="key arrow" id="g-left" title="Move the digit cursor left (←)" aria-label="Cursor left">◀</button>
          <span id="g-dial"></span>
          <button class="key arrow" id="g-right" title="Move the digit cursor right (→)" aria-label="Cursor right">▶</button>
        </div>
        <div class="keypad" id="g-keypad"></div>
      </section>
      <section class="gcol gstack" aria-label="Signal">
        <h3 class="glabel">Signal <span class="eq">r(t) = Σ</span></h3>
        <ol class="slist" id="g-stack"></ol>
        <div class="lenrow" id="g-len"></div>
      </section>
    </div>`;
  const $ = (s) => root.querySelector(s);

  // Editor state. The draft is not part of the project until it is added.
  let draft = null; // { mode: 'new' | 'edit', index, comp }
  let active = 'length';
  let buffer = '';
  const cursors = {};

  const fields = () => (draft ? SIGNALS[draft.comp.type].params : []).concat([LENGTH]);
  const fieldDef = (key) => fields().find((f) => f.key === key) ?? LENGTH;
  const getValue = (key) => (key === 'length' ? app.project.sim.duration : draft.comp.params[key]);
  const cursorOf = (key) => {
    if (cursors[key] === undefined) {
      const v = Math.abs(getValue(key));
      cursors[key] = fieldDef(key).int ? 0 : v === 0 ? -1 : Math.max(-6, Math.floor(Math.log10(v)) - 1);
    }
    return cursors[key];
  };

  function setValue(key, v, live) {
    const f = fieldDef(key);
    if (f.int) v = Math.round(v);
    if (f.min !== undefined) v = Math.max(f.min, v);
    if (f.max !== undefined) v = Math.min(f.max, v);
    v = Number(v.toPrecision(10));
    if (key === 'length') { app.setLength(v, live); }
    else { draft.comp.params[key] = v; preview(); }
    render();
  }

  function preview() { app.setPreview(draft ? { comp: draft.comp, replace: draft.mode === 'edit' ? draft.index : null } : null); }

  function startDraft(type) {
    const def = SIGNALS[type];
    const params = {};
    for (const p of def.params) params[p.key] = draft?.comp.params[p.key] ?? p.default;
    draft = { mode: draft?.mode ?? 'new', index: draft?.index, comp: normalizeComponent({ type, params }) };
    if (type === 'step' && draft.mode === 'new' && !app.project.system.reference.components.length) draft.comp.params.time = Math.min(0.1, app.project.sim.duration / 2);
    for (const k of Object.keys(cursors)) if (k !== 'length') delete cursors[k];
    active = def.params[0]?.key ?? 'length';
    buffer = '';
    preview();
    render();
  }

  function editComponent(i) {
    const comp = structuredClone(app.project.system.reference.components[i]);
    draft = { mode: 'edit', index: i, comp };
    for (const k of Object.keys(cursors)) if (k !== 'length') delete cursors[k];
    active = SIGNALS[comp.type].params[0]?.key ?? 'length';
    buffer = '';
    preview();
    render();
  }

  function commitDraft() {
    if (!draft) return;
    if (draft.mode === 'edit') app.replaceComponent(draft.index, draft.comp);
    else app.addComponent(draft.comp);
    draft = null; active = 'length'; buffer = '';
    preview();
    render();
  }
  function cancelDraft() { draft = null; active = 'length'; buffer = ''; preview(); render(); }

  // Entry: dial, cursor keys, keypad.
  const dial = createDial({
    size: 70, label: 'Entry dial', title: 'Changes the digit under the cursor',
    onTurn: (s) => {
      if (active === 'length') app.beginEdit();
      buffer = '';
      setValue(active, getValue(active) + s * 10 ** cursorOf(active), true);
    },
    onRelease: () => { if (active === 'length') app.endEdit(); },
  });
  $('#g-dial').append(dial.el);
  const moveCursor = (d) => { if (fieldDef(active).int) return; cursors[active] = Math.max(-6, Math.min(6, cursorOf(active) + d)); render(); };
  $('#g-left').addEventListener('click', () => moveCursor(1));
  $('#g-right').addEventListener('click', () => moveCursor(-1));

  const PAD = [['7', '8', '9', 'Del'], ['4', '5', '6', 'Cancel'], ['1', '2', '3', 'Enter'], ['.', '0', '±', null]];
  $('#g-keypad').innerHTML = PAD.flat().map((k) => (k === null ? '' : `<button class="key pk ${/^\d$/.test(k) ? '' : 'fn'} ${k === 'Enter' ? 'enter' : ''}" data-k="${k}">${k}</button>`)).join('');
  $('#g-keypad').querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => press(b.dataset.k)));

  function press(k) {
    if (/^\d$/.test(k)) buffer += k;
    else if (k === '.') { if (!buffer.includes('.')) buffer += buffer ? '.' : '0.'; }
    else if (k === '±') {
      if (buffer) buffer = buffer.startsWith('-') ? buffer.slice(1) : `-${buffer}`;
      else { if (active === 'length') { app.beginEdit(); setValue(active, -getValue(active)); app.endEdit(); } else setValue(active, -getValue(active)); }
    } else if (k === 'Del') buffer = buffer.slice(0, -1);
    else if (k === 'Cancel') { if (buffer) buffer = ''; else cancelDraft(); }
    else if (k === 'Enter') {
      if (buffer) {
        const v = Number(buffer);
        buffer = '';
        if (Number.isFinite(v)) {
          if (active === 'length') { app.beginEdit(); setValue(active, v); app.endEdit(); } else setValue(active, v);
          delete cursors[active];
        }
      } else commitDraft();
    }
    render();
  }

  $('#g-add').addEventListener('click', () => { if (buffer) press('Enter'); commitDraft(); });
  $('#g-cancel').addEventListener('click', () => { buffer = ''; cancelDraft(); });

  root.querySelectorAll('.wkey').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.type === 'arb') { $('#arb-file').click(); return; }
    startDraft(b.dataset.type);
  }));
  $('#arb-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const points = parseWaveform(await f.text());
      startDraft('arb');
      draft.comp = normalizeComponent({ type: 'arb', params: { gain: 1, shift: 0 }, points, name: f.name });
      preview(); render();
      app.toast(`Loaded ${points.length} points from ${f.name}`);
    } catch (err) { app.toast(`Could not read ${f.name}: ${err.message}`); }
  });

  // A mouse click on a panel key leaves the keyboard to the entry (typing,
  // Enter, Esc); keyboard users who tabbed to a key keep its focus.
  root.addEventListener('click', (e) => { const k = e.target.closest('button'); if (k && e.detail > 0) k.blur(); });

  // Rendering
  function valueHtml(key) {
    const f = fieldDef(key);
    if (key === active && buffer) return `<span class="buf">${buffer}</span><span class="caret"></span>`;
    const v = getValue(key);
    const c = f.int ? 0 : cursorOf(key);
    let natural = 0;
    while (natural < 6 && Number(v.toFixed(natural)) !== v) natural++;
    const dec = Math.max(natural, -c, 0);
    let [ip, fp = ''] = Math.abs(v).toFixed(dec).split('.');
    if (c >= ip.length) ip = ip.padStart(c + 1, '0');
    const chars = [...ip].map((ch, i) => [ch, ip.length - 1 - i]);
    if (fp) chars.push(['.', null], ...[...fp].map((ch, i) => [ch, -(i + 1)]));
    const sign = v < 0 ? '−' : '';
    return sign + chars.map(([ch, e]) => (key === active && e === c ? `<span class="cur">${ch}</span>` : ch)).join('');
  }

  function fieldRow(f) {
    return `<button class="pfield ${f.key === active ? 'active' : ''}" data-key="${f.key}">
      <span class="pl">${f.label}</span><span class="pv">${valueHtml(f.key)}</span><span class="pu">${f.unit ?? ''}</span></button>`;
  }

  function render() {
    const comps = app.project.system.reference.components;
    root.querySelectorAll('.wkey').forEach((b) => b.classList.toggle('lit', draft?.comp.type === b.dataset.type));
    $('#g-mode').textContent = !draft ? 'Parameters' : draft.mode === 'edit' ? `Edit ${draft.index + 1} · ${SIGNALS[draft.comp.type].label}` : `New ${SIGNALS[draft.comp.type].label} · preview`;
    $('#g-plist').innerHTML = draft
      ? SIGNALS[draft.comp.type].params.map(fieldRow).join('') + (draft.comp.type === 'arb' ? `<div class="hint">${(draft.comp.points ?? []).length} points${draft.comp.name ? ` from ${draft.comp.name}` : ''}</div>` : '')
      : `<div class="hint">Press a waveform key to draft a component. The display previews it dashed, alone and added to r(t); <b>Add</b> puts it into the signal.</div>`;
    $('#g-add').textContent = draft?.mode === 'edit' ? 'Apply' : 'Add';
    $('#g-add').disabled = !draft;
    $('#g-cancel').disabled = !draft && !buffer;
    $('#g-stack').innerHTML = comps.length
      ? comps.map((c, i) => `<li class="srow ${c.enabled === false ? 'off' : ''} ${draft?.mode === 'edit' && draft.index === i ? 'editing' : ''}" data-i="${i}">
          <span class="sn">${i + 1}</span>${icon(c.type)}<span class="sd" title="Edit">${describeComponent(c)}</span>
          <button class="sw ${c.enabled === false ? '' : 'on'}" data-tog="${i}" role="switch" aria-checked="${c.enabled !== false}" aria-label="Component ${i + 1} on"></button>
          <button class="x" data-del="${i}" aria-label="Remove component ${i + 1}" title="Remove">✕</button></li>`).join('')
      : '<li class="empty">No components yet: r(t) = 0.</li>';
    $('#g-len').innerHTML = `${fieldRow(LENGTH)}<span class="hint">record and sweep time</span>`;
    root.querySelectorAll('.pfield').forEach((b) => b.addEventListener('click', () => { if (buffer) press('Enter'); active = b.dataset.key; render(); }));
    root.querySelectorAll('.srow').forEach((li) => li.addEventListener('click', (e) => { if (!e.target.closest('button')) editComponent(Number(li.dataset.i)); }));
    root.querySelectorAll('[data-tog]').forEach((b) => b.addEventListener('click', () => app.toggleComponent(Number(b.dataset.tog))));
    root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.del);
      if (draft?.mode === 'edit' && draft.index === i) cancelDraft();
      else if (draft?.mode === 'edit' && draft.index > i) draft.index--;
      app.removeComponent(i);
    }));
  }

  // Keyboard, while this tab is open. Returns true when the key was used.
  function handleKey(e) {
    if (/^[0-9]$/.test(e.key)) { press(e.key); return true; }
    if (e.key === '.' || e.key === ',') { press('.'); return true; }
    if (e.key === '-') { press('±'); return true; }
    if (e.key === 'Backspace') { press('Del'); return true; }
    if (e.key === 'Enter') { press('Enter'); return true; }
    if (e.key === 'Escape') { press('Cancel'); return true; }
    if (e.key === 'ArrowLeft') { moveCursor(1); return true; }
    if (e.key === 'ArrowRight') { moveCursor(-1); return true; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const s = e.key === 'ArrowUp' ? 1 : -1;
      if (active === 'length') { app.beginEdit(); setValue(active, getValue(active) + s * 10 ** cursorOf(active)); app.endEdit(); }
      else setValue(active, getValue(active) + s * 10 ** cursorOf(active));
      return true;
    }
    if (e.key === 'Tab') {
      const keys = fields().map((f) => f.key);
      if (buffer) press('Enter');
      active = keys[(keys.indexOf(active) + (e.shiftKey ? keys.length - 1 : 1)) % keys.length];
      render();
      return true;
    }
    return false;
  }

  return { render, handleKey, get drafting() { return !!draft; }, reset: cancelDraft };
}
