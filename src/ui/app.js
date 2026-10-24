// The app: state, history, persistence, and wiring between the panels.
// window.loopTuner is the browser API for agents driving the page.

import { SLOTS, retypeBlock, normalizeBlock, blockDef } from '../core/blocks.js';
import { tf2ss } from '../core/poly.js';
import { simulate } from '../core/sim.js';
import { computeMetrics, METRICS } from '../core/metrics.js';
import { normalizeProject, evaluateCandidate, nextColor, uniqueName, fmt, describeController, findCandidate } from '../core/project.js';
import { compareEvals } from '../core/goal.js';
import { tuneCandidate } from '../core/tune.js';
import { EXAMPLES } from '../core/examples.js';
import { createScope } from './scope.js';
import { createRack } from './rack.js';
import { createGoalPanel, createCandidateTable, renderReadout } from './candidates.js';

const STORE_KEY = 'loop-tuner:autosave';
const SERIES = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'];

function startApp() {
  const $ = (id) => document.getElementById(id);
  const embeddedEl = $('loop-tuner-project');
  const embeddedText = embeddedEl?.textContent.trim() || '';
  const shellTemplate = $('lt-shell').outerHTML;
  // Inside a frame (an embedded preview) downloads are often blocked: offer copying instead.
  const framed = window.self !== window.top;
  document.querySelectorAll(framed ? '[data-standalone]' : '[data-framed]').forEach((el) => { el.hidden = true; });

  const app = {
    project: null,
    sel: 0,
    hot: null,
    tuning: null,
    stash: {},
    get candidate() { return this.project.candidates[this.sel] ?? null; },
  };

  // Evaluation cache keyed by everything a run depends on.
  const cache = new Map();
  function keyOf(c) {
    const loop = {};
    for (const s of SLOTS) loop[s.key] = s.key === 'controller' ? c.controller : (c[s.key] ?? app.project.system[s.key]);
    return JSON.stringify([loop, app.project.sim, app.project.goal]);
  }
  app.runOf = (c) => {
    if (!c) return null;
    const k = keyOf(c);
    let run = cache.get(k);
    if (!run) {
      try { run = evaluateCandidate(app.project, c); } catch (err) { run = { error: err.message }; }
      cache.set(k, run);
      if (cache.size > 300) cache.delete(cache.keys().next().value);
    }
    return run.error ? null : run;
  };
  app.colorOf = (c) => getComputedStyle(document.documentElement).getPropertyValue(SERIES[(c?.color ?? 0) % SERIES.length]).trim() || '#2a78d6';
  app.bestIndex = () => {
    let best = -1;
    app.project.candidates.forEach((c, i) => {
      const ev = app.runOf(c)?.evaluation;
      if (!ev?.feasible) return;
      if (best < 0 || compareEvals(ev, app.runOf(app.project.candidates[best]).evaluation) < 0) best = i;
    });
    return best;
  };

  // History: snapshots of the project, taken before each edit.
  const undoStack = [], redoStack = [];
  const snap = () => JSON.stringify({ project: app.project, sel: app.sel });
  let editOpen = false;
  app.beginEdit = () => {
    if (editOpen) return;
    undoStack.push(snap());
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
    editOpen = true;
  };
  const endEdit = () => { editOpen = false; };
  function restore(s) {
    const o = JSON.parse(s);
    app.project = o.project; app.sel = Math.min(o.sel, app.project.candidates.length - 1);
    renderAll();
  }
  app.undo = () => { if (!undoStack.length) return; redoStack.push(snap()); restore(undoStack.pop()); toast('Undone'); };
  app.redo = () => { if (!redoStack.length) return; undoStack.push(snap()); restore(redoStack.pop()); toast('Redone'); };

  // Persistence: the page remembers the working project per embedded project.
  let saveTimer = null;
  function autosave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify({ base: embeddedText.length + ':' + hash(embeddedText), project: app.project, sel: app.sel })); } catch { /* storage unavailable */ }
    }, 300);
  }
  function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

  // Mutations
  function targetBlock(slot) {
    const c = app.candidate;
    if (slot === 'controller') return c ? ['candidate', c, 'controller'] : null;
    if (c?.[slot]) return ['candidate', c, slot];
    return ['system', app.project.system, slot];
  }
  app.setParam = (slot, key, value, live) => {
    const t = targetBlock(slot);
    if (!t) return false;
    const [, owner, k] = t;
    const next = { type: owner[k].type, params: { ...owner[k].params, [key]: value } };
    try {
      const block = normalizeBlock(slot, next);
      const def = blockDef(slot, block.type);
      if (def.tf) { const tf = def.tf(block.params); tf2ss(tf.num, tf.den); }
      owner[k] = block;
    } catch (err) { toast(err.message); return false; }
    if (!live) endEdit();
    update({ structure: false });
    return true;
  };
  app.setSim = (key, value, live) => {
    const sim = { ...app.project.sim, [key]: value };
    if (!(sim.sampleTime > 0) || sim.sampleTime >= sim.duration) { if (!live) toast('The sample time must be shorter than the simulation length.'); return; }
    if (sim.duration / sim.sampleTime > 200000) { if (!live) toast('Too many samples: raise Ts or shorten the window.'); return; }
    app.project.sim = sim;
    if (!live) { endEdit(); update({ structure: true }); } else update({ structure: false });
  };
  app.retype = (slot, type) => {
    const t = targetBlock(slot);
    if (!t) return;
    const [, owner, k] = t;
    app.beginEdit();
    const old = owner[k];
    app.stash[slot] = { ...(app.stash[slot] ?? {}), [old.type]: old.params };
    owner[k] = retypeBlock(slot, old, type, app.stash[slot]);
    endEdit();
    update({ structure: true });
  };
  app.editGoal = (fn) => {
    app.beginEdit();
    const goal = structuredClone(app.project.goal);
    fn(goal);
    try { app.project = normalizeProject({ ...app.project, goal }); } catch (err) { toast(err.message); }
    endEdit();
    update({ structure: true, goal: true });
  };
  app.select = (i) => {
    if (i < 0 || i >= app.project.candidates.length || i === app.sel) return;
    app.sel = i;
    app.project.selected = app.candidate.name;
    update({ structure: true });
  };
  app.setHot = (i) => { if (app.hot === i) return; app.hot = i; drawScope(); };
  app.toggleChecked = (i) => {
    app.beginEdit();
    const c = app.project.candidates[i];
    c.checked = !c.checked;
    endEdit();
    update({ structure: false });
  };
  app.duplicate = (from = app.candidate, patch = {}) => {
    app.beginEdit();
    const p = app.project;
    const base = from ? structuredClone(from) : { controller: normalizeBlock('controller', { type: 'PID' }) };
    const c = { ...base, name: uniqueName(p, patch.name ?? (from ? from.name : 'Candidate')), checked: true, color: nextColor(p.candidates), ...patch };
    delete c.note;
    const at = from ? p.candidates.indexOf(from) + 1 : p.candidates.length;
    p.candidates.splice(at, 0, c);
    app.sel = at;
    endEdit();
    update({ structure: true });
    return c;
  };
  app.remove = (i) => {
    const p = app.project;
    if (i < 0 || i >= p.candidates.length) return;
    app.beginEdit();
    const [gone] = p.candidates.splice(i, 1);
    if (app.sel >= p.candidates.length) app.sel = p.candidates.length - 1;
    endEdit();
    update({ structure: true });
    toast(`Deleted ${gone.name}. Ctrl+Z brings it back.`);
  };
  app.rename = (i, name) => {
    app.beginEdit();
    const c = app.project.candidates[i];
    c.name = uniqueName({ candidates: app.project.candidates.filter((x) => x !== c) }, name);
    endEdit();
    update({ structure: true });
  };
  app.sortByScore = () => {
    app.beginEdit();
    const cur = app.candidate;
    const p = app.project;
    p.candidates = p.candidates.map((c) => [c, app.runOf(c)?.evaluation]).sort((a, b) => (a[1] && b[1] ? compareEvals(a[1], b[1]) : 0)).map(([c]) => c);
    app.sel = Math.max(0, p.candidates.indexOf(cur));
    endEdit();
    update({ structure: true });
  };

  // Auto-tune runs as a slice of evaluations per frame, so the page stays live
  // and the scope shows the search converging.
  app.toggleTune = () => {
    if (app.tuning) { stopTune(true); return; }
    const c = app.candidate;
    if (!c) return;
    let gen;
    try { gen = tuneCandidate(app.project, c, { maxEvals: 300 }); } catch (err) { toast(err.message); return; }
    const preview = app.duplicate(c, { name: `${c.name} tuned` });
    app.tuning = { gen, preview, evals: 0 };
    renderRack();
    const step = () => {
      if (!app.tuning) return;
      const t0 = performance.now();
      let s;
      do { s = app.tuning.gen.next(); } while (!s.done && performance.now() - t0 < 14);
      const prog = s.value;
      if (prog?.best) {
        preview.controller = { type: preview.controller.type, params: { ...prog.best.params } };
        app.tuning.evals = prog.evals;
        update({ structure: false });
        $('tune-btn').textContent = s.done ? 'Auto-tune' : `Stop · ${prog.evals}`;
      }
      if (s.done) stopTune(false);
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  function stopTune(cancelled) {
    const t = app.tuning;
    app.tuning = null;
    update({ structure: true });
    const ev = app.runOf(t.preview)?.evaluation;
    toast(`${cancelled ? 'Stopped' : 'Tuned'} after ${t.evals} runs: ${describeController(t.preview.controller)} · score ${fmt(ev?.score)} ${ev?.feasible ? '✓' : '(infeasible)'}`);
  }

  // Rendering
  const scope = createScope($('scope'), { onPick: (i) => app.select(i) });
  const rack = createRack($('rack'), app);
  const goalPanel = createGoalPanel($('goal'), app);
  const table = createCandidateTable($('cands'), app);
  const renderRack = () => rack.render();

  function drawScope() {
    const p = app.project;
    const traces = [];
    p.candidates.forEach((c, i) => {
      if (!c.checked && i !== app.sel) return;
      const run = app.runOf(c);
      if (!run) return;
      traces.push({ idx: i, color: app.colorOf(c), t: run.result.t, y: run.result.y, u: run.result.u, selected: i === app.sel, hot: i === app.hot });
    });
    const selRun = app.runOf(app.candidate) ?? (traces[0] && app.runOf(p.candidates[traces[0].idx]));
    const g = p.goal.subjectTo;
    const spec = { band: p.goal.settlingBand, step: selRun?.metrics.events.step ?? null, dist: selRun?.metrics.events.disturbance ?? null };
    if (g.overshoot?.max !== undefined) spec.overshootMax = g.overshoot.max;
    if (g.undershoot?.max !== undefined) spec.undershootMax = g.undershoot.max;
    if (g.settlingTime?.max !== undefined) spec.settleMax = g.settlingTime.max;
    if (g.uPeak?.max !== undefined) spec.uMax = g.uPeak.max;
    if (!selRun) { scope.setData(null); return; }
    scope.setData({ duration: p.sim.duration, t: selRun.result.t, ref: selRun.result.r, traces, spec });
  }

  function update({ structure }) {
    $('title').value = app.project.title;
    if (structure) rack.render(); else rack.refresh();
    if (structure) goalPanel.render();
    table.render();
    renderReadout($('readout'), app);
    drawScope();
    const run = app.runOf(app.candidate);
    const warn = run?.result.info.warnings ?? [];
    $('warn').textContent = warn.join(' · ');
    $('warn').hidden = !warn.length;
    $('undo').disabled = !undoStack.length;
    $('redo').disabled = !redoStack.length;
    autosave();
  }
  function renderAll() { update({ structure: true }); }

  // Loading
  function load(raw, { keepHistory = true, quiet = false } = {}) {
    const p = normalizeProject(typeof raw === 'string' ? JSON.parse(raw) : raw);
    if (keepHistory && app.project) app.beginEdit();
    app.project = p;
    app.sel = Math.max(0, p.selected ? p.candidates.findIndex((c) => c.name === p.selected) : 0);
    if (app.sel < 0) app.sel = 0;
    endEdit();
    renderAll();
    if (!quiet) toast(`Loaded “${p.title}”`);
  }

  // Files and sharing
  const exportJson = () => JSON.stringify(app.project, null, 2);
  function exportHtml() {
    const style = $('lt-style').textContent;
    const script = $('lt-script').textContent;
    const fonts = $('lt-fonts')?.outerHTML ?? '';
    const json = exportJson().replace(/</g, '\\u003c');
    return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<title>${escapeHtml(app.project.title)} · Loop Tuner</title>\n${fonts}\n<style id="lt-style">${style}</style>\n</head>\n<body>\n${shellTemplate}\n<script type="application/json" id="loop-tuner-project">\n${json}\n</script>\n<script id="lt-script">${script}</script>\n</body>\n</html>\n`;
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const fileStem = () => app.project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'loop';
  async function copy(text, what) {
    try { await navigator.clipboard.writeText(text); toast(`${what} copied to the clipboard`); } catch { toast('Copying was blocked by the browser. Use Save instead.'); }
  }

  $('save').addEventListener('click', () => { download(`${fileStem()}.json`, exportJson(), 'application/json'); toast('Saved the project as JSON'); });
  $('export').addEventListener('click', () => { download(`${fileStem()}.html`, exportHtml(), 'text/html'); toast('Exported a standalone HTML file with this project inside'); });
  $('copy').addEventListener('click', () => copy(exportJson(), 'Project JSON'));
  $('copy-html').addEventListener('click', () => copy(exportHtml(), 'Standalone HTML'));
  $('open').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (f) await openFile(f);
    e.target.value = '';
  });
  async function openFile(f) {
    const text = await f.text();
    try {
      if (/^\s*</.test(text)) {
        const m = text.match(/<script type="application\/json" id="loop-tuner-project">([\s\S]*?)<\/script>/);
        if (!m) throw new Error('This HTML file has no Loop Tuner project inside.');
        load(m[1]);
      } else load(text);
    } catch (err) { toast(`Could not open ${f.name}: ${err.message}`); }
  }
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { dragDepth++; $('drop').hidden = false; } });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop').hidden = true; });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; $('drop').hidden = true;
    const f = e.dataTransfer.files[0];
    if (f) openFile(f);
  });
  window.addEventListener('paste', (e) => {
    if (e.target.closest?.('input, textarea')) return;
    const text = e.clipboardData?.getData('text') ?? '';
    if (!/^\s*\{/.test(text)) return;
    try { load(text); } catch (err) { toast(`Pasted text is not a project: ${err.message}`); }
  });

  const ex = $('examples');
  EXAMPLES.forEach((x, i) => { const o = document.createElement('option'); o.value = i; o.textContent = x.title; ex.append(o); });
  ex.addEventListener('change', () => { if (ex.value !== '') load(structuredClone(EXAMPLES[Number(ex.value)])); ex.value = ''; });

  $('title').addEventListener('change', () => { app.beginEdit(); app.project.title = $('title').value.trim() || 'Untitled loop'; endEdit(); update({ structure: false }); });
  $('title').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); });
  $('undo').addEventListener('click', app.undo);
  $('redo').addEventListener('click', app.redo);

  // Sweep transport
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const playBtn = $('play');
  function setPlaying(on) {
    scope.setSweep({ playing: on });
    playBtn.innerHTML = on ? '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" fill="currentColor"/><rect x="9.5" y="2" width="3.5" height="12" fill="currentColor"/></svg>' : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2 L14 8 L4 14 Z" fill="currentColor"/></svg>';
    playBtn.setAttribute('aria-label', on ? 'Pause sweep' : 'Play sweep');
    playBtn.title = `${on ? 'Pause' : 'Play'} the scan sweep (P)`;
  }
  playBtn.addEventListener('click', () => setPlaying(!scope.playing));
  $('speed').addEventListener('change', (e) => scope.setSweep({ seconds: Number(e.target.value) }));
  scope.setSweep({ seconds: Number($('speed').value) });

  // Help
  $('help').addEventListener('click', () => { $('help-dlg').hidden = false; $('help-close').focus(); });
  $('help-close').addEventListener('click', () => { $('help-dlg').hidden = true; });
  $('help-dlg').addEventListener('click', (e) => { if (e.target === $('help-dlg')) $('help-dlg').hidden = true; });

  // Keyboard
  window.addEventListener('keydown', (e) => {
    const inField = e.target.closest?.('input, select, textarea');
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { if (inField) return; e.preventDefault(); e.shiftKey ? app.redo() : app.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { if (inField) return; e.preventDefault(); app.redo(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); $('save').click(); return; }
    if (inField || mod || e.altKey) return;
    if (e.key === 'Escape' && !$('help-dlg').hidden) { $('help-dlg').hidden = true; return; }
    if (e.target.closest?.('[role="slider"]') && e.key.startsWith('Arrow')) return;
    const n = app.project.candidates.length;
    switch (e.key) {
      case 'ArrowDown': case 'j': e.preventDefault(); app.select(Math.min(n - 1, app.sel + 1)); break;
      case 'ArrowUp': case 'k': e.preventDefault(); app.select(Math.max(0, app.sel - 1)); break;
      case ' ': case 'x': if (e.target.closest?.('button')) return; e.preventDefault(); app.toggleChecked(app.sel); break;
      case 'n': case 'd': app.duplicate(); break;
      case 'Delete': case 'Backspace': app.remove(app.sel); break;
      case 't': app.toggleTune(); break;
      case 'p': setPlaying(!scope.playing); break;
      case '?': $('help').click(); break;
      default: {
        const slot = { 1: 'reference', 2: 'controller', 3: 'actuator', 4: 'disturbance', 5: 'plant', 6: 'sensor', 7: 'noise' }[e.key];
        if (slot) rack.focusModule(slot);
      }
    }
  });

  // Toast
  let toastTimer = null;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }
  app.toast = toast;

  // Browser API for agents (Playwright and the like). Every call takes and
  // returns plain JSON, the same shapes as the project file and the CLI.
  window.loopTuner = {
    version: 1,
    getProject: () => structuredClone(app.project),
    setProject: (p) => { load(p, { quiet: true }); return structuredClone(app.project); },
    evaluate: () => app.project.candidates.map((c) => {
      const run = app.runOf(c);
      return { name: c.name, controller: c.controller, metrics: run && strip(run.metrics), score: run?.evaluation.score ?? null, feasible: run?.evaluation.feasible ?? false, checks: run?.evaluation.checks ?? [] };
    }),
    select: (ref) => { app.select(findCandidate(app.project, ref)); return app.candidate.name; },
    addCandidate: (c) => {
      const p = normalizeProject({ ...app.project, candidates: [...app.project.candidates, c] });
      app.beginEdit();
      app.project.candidates.push(p.candidates[p.candidates.length - 1]);
      app.sel = app.project.candidates.length - 1;
      endEdit(); update({ structure: true });
      return app.candidate.name;
    },
    metrics: () => METRICS.map(({ key, label, unit, desc }) => ({ key, label, unit, desc })),
    simulate: (loop, sim) => { const r = simulate(loop, sim); return strip(computeMetrics(r)); },
  };
  function strip(m) {
    const o = {};
    for (const [k, v] of Object.entries(m)) o[k] = typeof v === 'number' && !Number.isFinite(v) ? null : v;
    return o;
  }

  // Boot: embedded project, unless this browser has newer work on it.
  let initial = null;
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved && saved.base === embeddedText.length + ':' + hash(embeddedText)) initial = saved;
  } catch { /* storage unavailable */ }
  try {
    if (initial) { app.project = normalizeProject(initial.project); app.sel = Math.min(initial.sel ?? 0, app.project.candidates.length - 1); }
    else load(embeddedText ? JSON.parse(embeddedText) : structuredClone(EXAMPLES[0]), { keepHistory: false, quiet: true });
  } catch (err) {
    load(structuredClone(EXAMPLES[0]), { keepHistory: false, quiet: true });
    toast(`The embedded project could not be read (${err.message}); opened the example instead.`);
  }
  renderAll();
  setPlaying(!reduced);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startApp);
else startApp();
