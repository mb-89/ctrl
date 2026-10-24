// The app: project state, history, persistence, the acquisition the display
// shows, and wiring between display, controls and tabs. window.loopTuner is
// the browser API for agents driving the page.

import { normalizeProject, referenceTrace, loopReady, evaluateCandidate, findCandidate, simOf, autoTimebase, fitChannel, MAX_SAMPLES } from '../core/project.js';
import { SIGNALS, normalizeComponent, referenceFn, sampleSignal } from '../core/signals.js';
import { EXAMPLES, DEFAULT_PROJECT } from '../core/examples.js';
import { createDisplay } from './display.js';
import { createControls } from './controls.js';
import { createGenerator } from './generator.js';
import { createSplitters } from './layout.js';

const STORE_KEY = 'loop-tuner:v2:autosave';
const TABS = [
  { key: 'input', label: 'Input' },
  { key: 'plant', label: 'Plant', next: 'Pick a plant from the block library and set it with knobs. Channel 2 will show its output y(t). The actuator, sensor and disturbance start as ideal blocks you can swap for richer ones.' },
  { key: 'controller', label: 'Controller', next: 'Hand-tuned controller candidates, overlaid on the display and stepped through like patches on a synthesizer.' },
  { key: 'tune', label: 'Auto-tune', next: 'Set the goal (minimise a metric under bounds such as overshoot and settling time) and let the optimiser search the gains.' },
  { key: 'analysis', label: 'Analysis', next: 'Computed views of the loop: root locus, Bode, Nyquist and pole-zero maps, step metrics.' },
];

function startApp() {
  const $ = (id) => document.getElementById(id);
  const embeddedText = $('loop-tuner-project')?.textContent.trim() || '';
  const shellTemplate = $('lt-shell').outerHTML;
  const framed = window.self !== window.top;
  document.querySelectorAll(framed ? '[data-standalone]' : '[data-framed]').forEach((el) => { el.hidden = true; });

  const app = { project: null, channel: 0, tab: 'input' };

  // History: snapshots of the project, taken before each edit.
  const undoStack = [], redoStack = [];
  let editOpen = false;
  app.beginEdit = () => {
    if (editOpen) return;
    undoStack.push(JSON.stringify(app.project));
    if (undoStack.length > 300) undoStack.shift();
    redoStack.length = 0;
    editOpen = true;
  };
  app.endEdit = () => { editOpen = false; renderChrome(); };
  const restore = (s) => { app.project = JSON.parse(s); changed(); };
  app.undo = () => { if (!undoStack.length) return; redoStack.push(JSON.stringify(app.project)); restore(undoStack.pop()); toast('Undone'); };
  app.redo = () => { if (!redoStack.length) return; undoStack.push(JSON.stringify(app.project)); restore(redoStack.pop()); toast('Redone'); };

  let saveTimer = null;
  const base = `${embeddedText.length}:${hash(embeddedText)}`;
  function autosave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify({ base, project: app.project })); } catch { /* storage unavailable */ } }, 300);
  }

  // The acquisition: every signal the display can show. Without a plant and a
  // controller there is only r(t).
  let acqKey = '', acq = null, loopNote = '';
  function acquire() {
    const p = app.project;
    const key = JSON.stringify([simOf(p), p.system, p.candidates, p.selected, p.goal]);
    if (key === acqKey) return acq;
    acqKey = key;
    const { t, r } = referenceTrace(p);
    const signals = { r };
    loopNote = '';
    if (loopReady(p)) {
      const cand = p.candidates[Math.max(0, p.selected ? p.candidates.findIndex((c) => c.name === p.selected) : 0)] ?? p.candidates[0];
      try {
        const { result } = evaluateCandidate(p, cand);
        Object.assign(signals, { y: result.y, u: result.u, e: result.e, ym: result.ym, d: result.d });
        loopNote = cand.name;
      } catch (err) { loopNote = ''; toast(`The loop could not be simulated: ${err.message}`); }
    }
    acq = { t, signals };
    return acq;
  }

  // Mutations
  // Scope edits. The timebase sets the simulated window, so changing it
  // re-acquires; a window with too many controller samples is refused.
  app.editScope = (fn) => {
    const before = JSON.stringify(app.project.scope);
    app.beginEdit();
    fn(app.project.scope);
    const sim = simOf(app.project);
    if (sim.duration / sim.sampleTime > MAX_SAMPLES) {
      app.project.scope = JSON.parse(before);
      toast(`That window needs over ${MAX_SAMPLES / 1000}k controller samples at ${sim.sampleTime} s; zoom in instead.`);
      changed({ data: false });
      return false;
    }
    const tbChanged = JSON.stringify(app.project.scope.timebase) !== JSON.stringify(JSON.parse(before).timebase);
    changed({ data: tbChanged });
    return true;
  };
  app.channelKey = (i) => {
    const ch = app.project.scope.channels[i];
    app.beginEdit();
    if (!ch.on) { ch.on = true; app.channel = i; }
    else if (app.channel === i) ch.on = false;
    else app.channel = i;
    app.endEdit();
    changed({ data: false });
  };
  app.selectChannel = (i) => { app.channel = i; changed({ data: false }); };
  const refs = () => app.project.system.reference.components;
  app.addComponent = (comp) => { app.beginEdit(); refs().push(normalizeComponent(comp)); app.endEdit(); changed(); toast(`Added ${SIGNALS[comp.type].label} to r(t)`); };
  app.replaceComponent = (i, comp) => { app.beginEdit(); refs()[i] = normalizeComponent(comp); app.endEdit(); changed(); };
  app.removeComponent = (i) => { app.beginEdit(); refs().splice(i, 1); app.endEdit(); changed(); };
  app.toggleComponent = (i) => {
    app.beginEdit();
    const c = refs()[i];
    if (c.enabled === false) delete c.enabled; else c.enabled = false;
    app.endEdit(); changed();
  };
  app.setPeriod = (v, live) => {
    if (!(v > 0)) return;
    app.project.system.reference.period = v;
    if (!live) app.endEdit();
    changed();
  };

  // Preview of a drafted component: alone, and the signal with it added (or
  // replacing the component being edited), drawn dashed on r's channel.
  let previewReq = null;
  app.setPreview = (req) => { previewReq = req; showPreview(); };
  function showPreview() {
    if (!previewReq) { display.setPreview(null); return; }
    const p = app.project;
    const sim = simOf(p);
    const comps = p.system.reference.components.slice();
    if (previewReq.replace !== null && previewReq.replace !== undefined) comps[previewReq.replace] = previewReq.comp;
    else comps.push(previewReq.comp);
    let alone, sum;
    try {
      const period = p.system.reference.period;
      alone = sampleSignal(referenceFn({ period, components: [normalizeComponent(previewReq.comp)] }, sim), sim).v;
      sum = sampleSignal(referenceFn({ period, components: comps.map((c, i) => normalizeComponent(c, i)) }, sim), sim).v;
    } catch { display.setPreview(null); return; }
    const channel = Math.max(0, p.scope.channels.findIndex((c) => c.source === 'r'));
    display.setPreview({ channel, alone, sum, label: SIGNALS[previewReq.comp.type].label.toLowerCase() });
  }

  // Run control
  app.toggleRun = () => { display.setMode(display.mode === 'stop' ? 'run' : 'stop'); controls.render(display.mode); };
  app.single = () => { display.setMode('single'); controls.render(display.mode); };
  // Auto Scale: one period of the input across the screen, then every
  // channel with a signal fitted to about six divisions.
  app.autoScale = () => {
    app.beginEdit();
    app.project.scope.timebase = autoTimebase(app.project);
    const data = acquire();
    for (const ch of app.project.scope.channels) {
      const fit = data.signals[ch.source] && fitChannel(data.signals[ch.source]);
      if (fit) Object.assign(ch, fit);
    }
    app.endEdit();
    changed();
    toast('Auto Scale: one period of the input, every channel fitted');
  };

  // Rendering
  const display = createDisplay($('display'), {
    onSelectChannel: (i) => app.selectChannel(i),
    onSelectLine: (i) => { if (i !== null) app.channel = i; changed({ data: false }); },
    onStopped: () => controls.render(display.mode),
    edit: (fn) => app.editScope(fn),
    endEdit: () => app.endEdit(),
  });
  const controls = createControls($('controls'), app);
  const generator = createGenerator($('tab-input'), app);

  function renderTabs() {
    $('tabbar').innerHTML = TABS.map((t, i) => `<button role="tab" class="tab ${t.key === app.tab ? 'on' : ''} ${t.next ? 'later' : ''}" data-tab="${t.key}" aria-selected="${t.key === app.tab}">
      <span class="tn">${i + 1}</span>${t.label}${t.next ? '<span class="soon">later</span>' : ''}</button>`).join('');
    $('tabbar').querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { app.tab = b.dataset.tab; renderTabs(); }));
    const t = TABS.find((x) => x.key === app.tab);
    $('tab-input').hidden = app.tab !== 'input';
    $('tab-later').hidden = app.tab === 'input';
    if (t.next) {
      const defined = app.tab === 'plant' && app.project.system.plant ? `<p>This project already has a plant (<code>${app.project.system.plant.type}</code>) from its file; channels 2–4 show the loop.</p>` : '';
      $('tab-later').innerHTML = `<div class="later-box"><h3 class="glabel">${t.label} · comes next</h3><p>${t.next}</p>${defined}<p class="dim">Until then the display shows what is set up so far. The order and plans are in design/output/tabs.md.</p></div>`;
    }
  }

  function renderChrome() {
    $('undo').disabled = !undoStack.length;
    $('redo').disabled = !redoStack.length;
    $('title').value = app.project.title;
    $('loopnote').textContent = loopNote ? `loop: ${loopNote}` : '';
  }

  function changed({ data = true } = {}) {
    if (data) display.setData(acquire());
    display.setScope(app.project.scope, app.channel);
    showPreview();
    controls.render(display.mode);
    generator.render();
    renderChrome();
    autosave();
  }

  // Loading
  function load(raw, { keepHistory = true, quiet = false } = {}) {
    const p = normalizeProject(typeof raw === 'string' ? JSON.parse(raw) : raw);
    if (keepHistory && app.project) app.beginEdit();
    app.project = p;
    app.endEdit();
    generator.reset();
    acqKey = '';
    changed();
    if (!quiet) toast(`Loaded “${p.title}”`);
  }

  // Files and sharing
  const exportJson = () => JSON.stringify(app.project, null, 2);
  function exportHtml() {
    const json = exportJson().replace(/</g, '\\u003c');
    return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<title>${esc(app.project.title)} · Loop Tuner</title>\n${$('lt-fonts')?.outerHTML ?? ''}\n<style id="lt-style">${$('lt-style').textContent}</style>\n</head>\n<body>\n${shellTemplate}\n<script type="application/json" id="loop-tuner-project">\n${json}\n</script>\n<script id="lt-script">${$('lt-script').textContent}</script>\n</body>\n</html>\n`;
  }
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const stem = () => app.project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'loop';
  async function copy(text, what) {
    try { await navigator.clipboard.writeText(text); toast(`${what} copied to the clipboard`); } catch { toast('Copying was blocked by the browser.'); }
  }
  $('save').addEventListener('click', () => { download(`${stem()}.json`, exportJson(), 'application/json'); toast('Saved the project as JSON'); });
  $('export').addEventListener('click', () => { download(`${stem()}.html`, exportHtml(), 'text/html'); toast('Exported a standalone page with this project inside'); });
  $('copy').addEventListener('click', () => copy(exportJson(), 'Project JSON'));
  $('copy-html').addEventListener('click', () => copy(exportHtml(), 'Standalone HTML'));
  $('open').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', async (e) => { const f = e.target.files[0]; if (f) await openFile(f); e.target.value = ''; });
  async function openFile(f) {
    const text = await f.text();
    try {
      if (/^\s*</.test(text)) {
        const m = text.match(/<script type="application\/json" id="loop-tuner-project">([\s\S]*?)<\/script>/);
        if (!m || !m[1].trim()) throw new Error('this page has no Loop Tuner project inside');
        load(m[1]);
      } else load(text);
    } catch (err) { toast(`Could not open ${f.name}: ${err.message}`); }
  }
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { dragDepth++; $('drop').hidden = false; } });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop').hidden = true; });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; $('drop').hidden = true; const f = e.dataTransfer.files[0]; if (f) openFile(f); });
  window.addEventListener('paste', (e) => {
    if (e.target.closest?.('input, textarea')) return;
    const text = e.clipboardData?.getData('text') ?? '';
    if (!/^\s*\{/.test(text)) return;
    try { load(text); } catch (err) { toast(`Pasted text is not a project: ${err.message}`); }
  });

  const ex = $('examples');
  [DEFAULT_PROJECT, ...EXAMPLES].forEach((x, i) => { const o = document.createElement('option'); o.value = i; o.textContent = x.title; ex.append(o); });
  ex.addEventListener('change', () => {
    if (ex.value === '') return;
    const src = [DEFAULT_PROJECT, ...EXAMPLES][Number(ex.value)];
    const fresh = !src.scope;
    load(structuredClone(src));
    if (fresh) app.autoScale();
    ex.value = '';
  });
  $('title').addEventListener('change', () => { app.beginEdit(); app.project.title = $('title').value.trim() || 'Untitled loop'; app.endEdit(); autosave(); });
  $('title').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); });
  $('undo').addEventListener('click', app.undo);
  $('redo').addEventListener('click', app.redo);
  $('help').addEventListener('click', () => { $('help-dlg').hidden = false; $('help-close').focus(); });
  $('help-close').addEventListener('click', () => { $('help-dlg').hidden = true; });
  $('help-dlg').addEventListener('click', (e) => { if (e.target === $('help-dlg')) $('help-dlg').hidden = true; });

  window.addEventListener('keydown', (e) => {
    const inField = e.target.closest?.('input, select, textarea');
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !inField) { e.preventDefault(); e.shiftKey ? app.redo() : app.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y' && !inField) { e.preventDefault(); app.redo(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); $(framed ? 'copy' : 'save').click(); return; }
    if (inField || mod || e.altKey) return;
    if (!$('help-dlg').hidden) { if (e.key === 'Escape') $('help-dlg').hidden = true; return; }
    if (e.key === 'Escape' && display.releaseLine()) return;
    const onControl = e.target.closest?.('button, [role="slider"], a');
    if (app.tab === 'input' && !(onControl && ['Enter', ' ', 'Tab'].includes(e.key)) && generator.handleKey(e)) { e.preventDefault(); return; }
    const k = e.key.toLowerCase();
    if (k === 'r') app.toggleRun();
    else if (k === 's') app.single();
    else if (k === 'a') app.autoScale();
    else if (e.key === '?') $('help').click();
  });

  let toastTimer = null;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
  }
  app.toast = toast;

  // Browser API for agents. Plain JSON in and out, the same shapes as the file.
  window.loopTuner = {
    version: 2,
    getProject: () => structuredClone(app.project),
    setProject: (p) => { load(p, { quiet: true }); return structuredClone(app.project); },
    addComponent: (c) => { app.addComponent(c); return structuredClone(refs()); },
    reference: () => { const { t, r } = referenceTrace(app.project); return { t: Array.from(t), r: Array.from(r) }; },
    autoScale: () => app.autoScale(),
    run: () => { display.setMode('run'); controls.render('run'); },
    stop: () => { display.setMode('stop'); controls.render('stop'); },
    selectCandidate: (ref) => { const i = findCandidate(app.project, ref); app.beginEdit(); app.project.selected = app.project.candidates[i].name; app.endEdit(); changed(); },
  };

  // Boot: the embedded project, unless this browser has newer work on it.
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { /* storage unavailable */ }
  try {
    if (saved && saved.base === base) app.project = normalizeProject(saved.project);
    else app.project = normalizeProject(embeddedText ? JSON.parse(embeddedText) : structuredClone(DEFAULT_PROJECT));
  } catch (err) {
    app.project = normalizeProject(structuredClone(DEFAULT_PROJECT));
    setTimeout(() => toast(`The embedded project could not be read (${err.message}); opened a new one instead.`));
  }
  renderTabs();
  changed();
  createSplitters($('lt-shell'));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  display.setMode(reduced ? 'stop' : 'run');
  controls.render(display.mode);
}

function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startApp);
else startApp();
