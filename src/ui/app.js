// The app: project state, history, persistence, the acquisition the display
// shows, and wiring between display, controls and tabs. window.loopTuner is
// the browser API for agents driving the page.

import { normalizeProject, referenceTrace, loopReady, evaluateCandidate, evaluateSystem, findCandidate, simOf, autoTimebase, fitChannel, MAX_SAMPLES, channelNames, pruneChannels, UI_TABS, loopModel } from '../core/project.js';
import { diagramNames } from '../core/diagram.js';
import { createDesignStore, useDesigns } from '../core/design.js';
import { createPlantEditor } from './plant.js';
import { drawnValues, refitSwitched } from './xyview.js';
import { createControllerTab } from './controller.js';
import { createAutotuneTab } from './autotune.js';
import { loopOverlays, autotune, placeVariant, tuneReport, withVariant } from '../core/autotune.js';
import { createAnalysisTab } from './analysis.js';
import { SIGNALS, normalizeComponent, referenceFn, sampleSignal } from '../core/signals.js';
import { DEFAULT_PROJECT } from '../core/examples.js';
import { SYSTEM_LIBRARY, SYSTEM_PARTS, applySystem, libraryTags, filterByTags } from '../core/systems.js';
import { createDisplay } from './display.js';
import { createControls } from './controls.js';
import { createGenerator } from './generator.js';
import { createSplitters } from './layout.js';
import { createLive } from './live.js';
import { createRecord } from './record.js';
import { createSpeed } from './speed.js';
import { speedToJson } from '../core/speed.js';

const STORE_KEY = 'loop-tuner:v2:autosave';
const TABS = [
  { key: 'input', label: 'Input' },
  { key: 'plant', label: 'Plant' },
  { key: 'controller', label: 'Controller' },
  { key: 'tune', label: 'Auto-tune' },
  { key: 'analysis', label: 'Analysis' },
];

function startApp() {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (id) => document.getElementById(id);
  const embeddedText = $('loop-tuner-project')?.textContent.trim() || '';
  const shellTemplate = $('lt-shell').outerHTML;
  const framed = window.self !== window.top;
  document.querySelectorAll(framed ? '[data-standalone]' : '[data-framed]').forEach((el) => { el.hidden = true; });

  // signal: the named signal the Input tab is editing.
  const app = { project: null, channel: 0, tab: 'input', signal: 'r' };

  // History: snapshots of the project, taken before each edit.
  // An edit that changed nothing (a lit key pressed again) leaves no step,
  // and the redo it cleared comes back.
  const undoStack = [], redoStack = [];
  let editOpen = false, redoBefore = [];
  app.beginEdit = () => {
    if (editOpen) return;
    undoStack.push(JSON.stringify(app.project));
    if (undoStack.length > 300) undoStack.shift();
    redoBefore = redoStack.splice(0);
    editOpen = true;
  };
  app.endEdit = () => {
    if (editOpen && undoStack.at(-1) === JSON.stringify(app.project)) { undoStack.pop(); redoStack.push(...redoBefore); }
    editOpen = false; redoBefore = [];
    renderChrome();
  };
  const restore = (s) => { app.project = JSON.parse(s); changed(); };
  app.undo = () => { if (!undoStack.length) return; redoStack.push(JSON.stringify(app.project)); restore(undoStack.pop()); toast('Undone'); };
  app.redo = () => { if (!redoStack.length) return; undoStack.push(JSON.stringify(app.project)); restore(redoStack.pop()); toast('Redone'); };

  let saveTimer = null;
  // A page without a project inside opens the first system of the library.
  // Autosaved work belongs to the project the page opened with: when that
  // changes (a new version of the page), the old work is not restored over it.
  const startText = embeddedText || JSON.stringify(applySystem(DEFAULT_PROJECT, SYSTEM_LIBRARY[0], SYSTEM_PARTS.filter((k) => SYSTEM_LIBRARY[0][k])));
  const base = `${startText.length}:${hash(startText)}`;
  const saveNow = () => { saveTimer = null; try { localStorage.setItem(STORE_KEY, JSON.stringify({ base, project: withUi() })); } catch { /* storage unavailable */ } };
  function autosave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 300);
  }
  // A reload or a closed tab right after a change still keeps it.
  const flushSave = () => { if (saveTimer) { clearTimeout(saveTimer); saveNow(); } };
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });

  // Designs computed from the plant (design/output/designs.md). Light ones
  // are computed while the diagram compiles; a heavy one (a swing-up plan)
  // runs in the background, in slices between frames, while its block runs
  // u = 0 or its previous values. When it is done, the store's generation
  // goes up and the acquisition is made again.
  const designs = createDesignStore({ mode: 'async' });
  // Every compile in the page uses it: one that names no store (an analysis,
  // an auto-tune run) reads its designs and plans as a guest and never plans
  // on the main thread. app.designs.generation goes up when a plan settles.
  useDesigns(designs);
  app.designs = designs;

  // The acquisition: every signal the display can show. Without a plant and a
  // controller there is only r(t).
  let acqKey = '', acq = null, loopNote = '';
  app.systemError = '';
  // A plan that settles (the design store's generation) makes it again.
  const acqKeyOf = (p) => JSON.stringify([simOf(p), p.system, p.candidates, p.selected, p.goal, designs.generation]);
  function acquire() {
    const p = app.project;
    const key = acqKeyOf(p);
    if (key === acqKey) return acq;
    acqKey = key;
    const t0 = performance.now();
    acq = simulateScreen(p);
    timedSim(key, simOf(p).duration, performance.now() - t0, () => simulateScreen(p));
    pumpDesigns();
    return acq;
  }
  function simulateScreen(p) {
    loopNote = '';
    app.systemError = '';
    app.designStatuses = [];
    if (loopReady(p)) {
      const { t, r } = referenceTrace(p);
      const signals = { r };
      const cand = p.candidates[Math.max(0, p.selected ? p.candidates.findIndex((c) => c.name === p.selected) : 0)] ?? p.candidates[0];
      try {
        const { result } = evaluateCandidate(p, cand);
        Object.assign(signals, { y: result.y, u: result.u, e: result.e, ym: result.ym, d: result.d });
        loopNote = `loop: ${cand.name}`;
      } catch (err) { app.systemError = err.message; }
      return { t, signals };
    }
    // No controller yet: the diagram is the whole system. If it cannot run,
    // the signals still show and the Plant tab says why.
    try {
      const sys = evaluateSystem(p, { designs });
      app.designStatuses = sys.info.designs ?? [];
      return { t: sys.t, signals: sys.signals };
    } catch (err) {
      app.systemError = err.message;
      const signals = {};
      let t = null;
      for (const name of Object.keys(p.system.signals)) { const tr = referenceTrace(p, name); signals[name] = tr.r; t = tr.t; }
      return { t, signals };
    }
  }
  // How fast this page simulates the screen: its simulated seconds over the
  // wall time the simulation took, the fastest of up to three timings (a
  // first run is slowed by the browser compiling; the others are taken only
  // while the speed is held to it). A screen simulated in under 2 ms is run a
  // few more times, so the timing is longer than the clock's resolution. No
  // speed runs faster (core/speed.js paceOf); ∞ runs at it.
  let simTiming = { key: '', duration: 0, ms: [], again: null, at: 0, timer: 0 };
  function timedSim(key, duration, ms, again) {
    let n = 1;
    if (ms < 2) { const t0 = performance.now() - ms; while (performance.now() - t0 < 2 && n < 64) { again(); n++; } ms = (performance.now() - t0) / n; }
    clearTimeout(simTiming.timer);
    simTiming = { key, duration, ms: [ms], again, at: performance.now(), timer: 0 };
  }
  app.simRate = ({ retime = false } = {}) => {
    const ms = Math.min(...simTiming.ms);
    const rate = ms > 0 && simTiming.duration > 0 ? simTiming.duration / (ms / 1000) : Infinity;
    // Sweeping held to it: time it again (once a second, twice at most), as
    // the first timing may be the slow one.
    if (retime && simTiming.ms.length < 3 && !simTiming.timer && simTiming.again && performance.now() - simTiming.at > 1000 && (app.speed?.() ?? 1) >= rate) {
      const t = simTiming;
      t.timer = setTimeout(() => {
        t.timer = 0;
        if (t !== simTiming || acqKeyOf(app.project) !== t.key) return;
        const t0 = performance.now();
        t.again();
        t.ms.push(performance.now() - t0);
        t.at = performance.now();
      }, 0);
    }
    return rate;
  };
  // Auto-tune's run with the gains it just put in stands for the screen's own
  // when the screen would simulate exactly that: the same diagram but for the
  // tuned block's variants, the same inputs, one period of the input on the
  // same time grid. Saves simulating it again for every improvement.
  function adoptRun({ run, ctx, variant }) {
    const p = app.project;
    if (!run || !ctx || loopReady(p) || p.system.plant?.type !== 'diagram') return;
    if (JSON.stringify(simOf(p)) !== JSON.stringify(ctx.sim) || JSON.stringify(p.system.signals) !== JSON.stringify(ctx.signals)) return;
    if (JSON.stringify(withVariant(p.system.plant.diagram, ctx.path, variant)) !== JSON.stringify(withVariant(ctx.diagram, ctx.path, variant))) return;
    acqKey = acqKeyOf(p);
    acq = { t: run.t, signals: run.signals };
    loopNote = '';
    app.systemError = '';
  }

  // The pump: while the store has jobs, a slice of work per task. A
  // MessageChannel message starts the next slice at once (setTimeout would
  // wait at least 4 ms), and the browser draws frames between slices. A
  // slice lasts as long as the browser was away since the last one, between
  // 24 and 40 ms, and meanwhile the display and the plant's view draw at most
  // 20 frames a second (app.frameMs): what runs is u = 0 or the previous
  // plan, so the plan gets most of the main thread (headless Chromium: the
  // default plan in 5 to 6 s, Node 3 s). While a job waits out its
  // debounce, a timer.
  const pumpChannel = new MessageChannel();
  let pumping = false, sliceEnd = 0;
  app.frameMs = () => (pumping ? 50 : 0);
  function pumpDesigns() {
    if (pumping || !designs.busy()) return;
    pumping = true;
    sliceEnd = 0;
    pumpChannel.port2.postMessage(0);
  }
  pumpChannel.port1.onmessage = () => {
    const away = sliceEnd ? performance.now() - sliceEnd : 0;
    const r = designs.runJobs(Math.min(40, Math.max(24, away)));
    sliceEnd = performance.now();
    // The next slice is scheduled even if showing this one's result fails.
    try { if (r.finished.length) designsSettled(r.finished); } finally {
      if (!designs.busy()) pumping = false;
      else if (r.waitMs > 0) setTimeout(() => pumpChannel.port2.postMessage(0), r.waitMs);
      else pumpChannel.port2.postMessage(0);
    }
  };
  // Progress, at most 10 times a second: only the Computed box, the variant
  // marker and the note beside the title change; no input is re-rendered.
  designs.onProgress((queue) => {
    for (const s of app.designStatuses ?? []) {
      const job = queue.find((j) => j.path === s.path);
      if (job && (s.status === 'pending' || s.status === 'stale')) s.progress = job.progress;
    }
    controllerTab.renderProgress();
    renderNote();
  });
  // A background design is done (generation went up): the light path. The
  // display takes the new run from the start of the sweep (the run before
  // stays faded), the Computed box and the note follow, and the Controller
  // tab's inputs are left alone, so typing in them goes on. An Auto Scale
  // made while the design was pending is made again on the new run.
  function designsSettled(finished) {
    display.restartSweep();
    const refit = fitPending;
    if (refit) fitScope();
    display.setData(acquire());
    if (refit) { display.setScope(app.project.scope, app.channel); controls.render(display.mode); autosave(); }
    controllerTab.renderComputed();
    if (app.tab === 'analysis') analysisTab.render();
    renderChrome();
    const f = finished.at(-1), st = (app.designStatuses ?? []).find((s) => s.path === f.path);
    const what = f.title || 'The plan';
    if (f.error) toast(`${what} failed: ${f.error}`);
    else toast(`${f.title ? `${f.title} planned` : 'Planned'} in ${(f.ms / 1000).toFixed(1)} s${st?.status === 'warn' ? ', with a warning: see the Controller tab' : ''}`);
  }
  // Cancel the plan a status waits on, or plan again after a cancel.
  function designsChanged() { display.setData(acquire()); controllerTab.renderComputed(); if (app.tab === 'analysis') analysisTab.render(); renderChrome(); }
  app.cancelDesign = (key) => { if (designs.cancel(key)) { designsChanged(); toast('Planning cancelled'); } };
  app.retryDesign = (key) => { if (designs.retry(key)) designsChanged(); };
  // The loop a Controller closes, cut at its output, linearised at an
  // operating point ('origin', 'initial', { y }, { t }): for the Analysis
  // tab, with the page's designs (a plan is never made twice).
  app.loopModel = (path, op) => loopModel(app.project, path, op, { designs });
  // What a scope channel can show: only names the diagram gives (its Sources
  // and Sinks, r always), each with its unit.
  app.signalNames = () => channelNames(app.project);
  app.sourceNames = () => { const n = app.signalNames().filter((x) => app.project.system.signals[x]); return n.length ? n : ['r']; };
  // The scope's Nyquist frequency: half its sampling rate.
  app.nyquist = () => 0.5 / simOf(app.project).sampleTime;
  app.unitOf = (name) => {
    const plant = app.project.system.plant;
    return (plant?.type === 'diagram' ? diagramNames(plant.diagram).units[name] : null) ?? '1';
  };
  const sig = () => app.project.system.signals[app.signal] ?? app.project.system.signals[(app.signal = Object.keys(app.project.system.signals)[0])];
  app.signalRef = sig;

  // Mutations
  // Scope edits. The timebase sets the simulated window, so changing it
  // re-acquires; a window with too many controller samples is refused.
  app.editScope = (fn) => {
    const before = JSON.stringify(app.project.scope);
    fitPending = false;
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
    if (!ch.on && !ch.source) { app.channel = i; toast(`Channel ${i + 1} has no source: pick one under Vertical › Source.`); }
    else if (!ch.on) { ch.on = true; app.channel = i; }
    else if (app.channel === i) ch.on = false;
    else app.channel = i;
    app.endEdit();
    changed({ data: false });
  };
  app.selectChannel = (i) => { app.channel = i; changed({ data: false }); };
  const refs = () => sig().components;
  app.addComponent = (comp) => { app.beginEdit(); refs().push(normalizeComponent(comp)); app.endEdit(); changed(); toast(`Added ${SIGNALS[comp.type].label} to ${app.signal}(t)`); };
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
    sig().period = v;
    if (!live) app.endEdit();
    changed();
  };

  // The plant diagram. Every Source needs a signal: new names get an empty one.
  app.setPlant = (diagram, views) => {
    app.beginEdit();
    const keep = views ?? app.project.system.plant?.views;
    app.project.system.plant = { type: 'diagram', diagram, ...(keep?.length ? { views: keep } : {}) };
    // Only what the diagram names exists: new Sources get a signal, removed
    // ones lose theirs, channels on vanished names clear.
    const signals = app.project.system.signals;
    const { sources } = diagramNames(diagram);
    for (const name of sources) signals[name] ??= { period: Math.max(...Object.values(signals).map((x) => x.period), 1), components: [] };
    for (const name of Object.keys(signals)) if (!sources.includes(name) && (sources.length || name !== 'r')) delete signals[name];
    if (!Object.keys(signals).length) signals.r = { period: 1, components: [] };
    pruneChannels(app.project.scope, app.project);
    if (!signals[app.signal]) app.signal = Object.keys(signals)[0];
    app.endEdit();
    changed();
  };
  app.plantMoved = () => { changed({ data: false }); };
  app.setViews = (views) => {
    const plant = app.project.system.plant;
    if (plant?.type !== 'diagram') return;
    app.beginEdit();
    if (views.length) plant.views = views; else delete plant.views;
    app.endEdit();
    autosave();
  };
  // Signal values at the scope's current instant, for 2D views.
  app.sceneEnv = () => {
    const data = live?.data() ?? acquire();  // live: the sweep on the screen
    const t = display.time();
    const env = { t };
    if (data?.t?.length > 1) {
      const k = Math.max(0, Math.min(data.t.length - 1, Math.round((t - data.t[0]) / (data.t[1] - data.t[0]))));
      env.t = data.t[k];
      for (const [name, v] of Object.entries(data.signals)) env[name] = v[k];
    }
    return env;
  };
  // A Sink's new name follows into the channels that showed it.
  app.renameSink = (from, to) => {
    app.beginEdit();
    for (const ch of app.project.scope.channels) if (ch.source === from) ch.source = to;
  };
  app.renameSignal = (from, to, users) => {
    const signals = app.project.system.signals;
    app.beginEdit();
    if (!signals[to]) signals[to] = users <= 1 ? signals[from] : structuredClone(signals[from]);
    if (users <= 1 && from !== to) delete signals[from];
    if (app.signal === from) app.signal = to;
    for (const ch of app.project.scope.channels) if (ch.source === from && users <= 1) ch.source = to;
  };
  app.editSignal = (name) => { app.signal = name; app.tab = 'input'; generator.reset(); renderTabs(); changed({ data: false }); };
  app.selectSignal = (name) => { app.signal = name; generator.reset(); changed({ data: false }); };
  app.saveToLibrary = (name, block) => {
    app.beginEdit();
    (app.project.library ??= []).push({ name, block });
    app.endEdit();
    autosave();
    toast(`Saved “${name}” to My blocks`);
  };

  // Preview of a drafted component: alone, and the signal with it added (or
  // replacing the component being edited), drawn dashed on r's channel.
  let previewReq = null;
  app.setPreview = (req) => { previewReq = req; showPreview(); };
  function showPreview() {
    if (!previewReq) { display.setPreview(null); return; }
    const p = app.project;
    const sim = simOf(p);
    const comps = sig().components.slice();
    if (previewReq.replace !== null && previewReq.replace !== undefined) comps[previewReq.replace] = previewReq.comp;
    else comps.push(previewReq.comp);
    let alone, sum;
    try {
      const period = sig().period;
      alone = sampleSignal(referenceFn({ period, components: [normalizeComponent(previewReq.comp)] }, sim), sim).v;
      sum = sampleSignal(referenceFn({ period, components: comps.map((c, i) => normalizeComponent(c, i)) }, sim), sim).v;
    } catch { display.setPreview(null); return; }
    const channel = Math.max(0, p.scope.channels.findIndex((c) => c.source === app.signal));
    display.setPreview({ channel, alone, sum, label: SIGNALS[previewReq.comp.type].label.toLowerCase(), signal: app.signal });
  }

  // Run control. In Live mode Run and Stop go through the plant (ui/live.js).
  app.setMode = (m) => {
    // The scope's Stop while Auto-tune sweeps its runs stops the tuning.
    if (m === 'stop') tuneTab?.scopeStopped();
    display.setMode(m); controls.render(display.mode); live?.mode(m);
  };
  app.toggleRun = () => app.setMode(display.mode === 'stop' ? 'run' : 'stop');
  app.single = () => app.setMode('single');
  // Auto Scale: one period of the input across the screen, then every
  // channel with a signal fitted to about six divisions. Fitted while a
  // design is still being computed (a plan, when a system loads), it fits
  // the run without it, so it is made again when the design settles, unless
  // the scope was set by hand in between.
  let fitPending = false;
  function fitScope() {
    app.project.scope.timebase = autoTimebase(app.project);
    const data = live?.data() ?? acquire();  // live: the sweep on the screen
    const sc = app.project.scope;
    sc.channels.forEach((ch, i) => {
      // XY with Δ: the channels draw channel 1 minus themselves; fit that.
      const v = drawnValues(data.signals, sc, i, app.unitOf), fit = v && fitChannel(v);
      if (fit) Object.assign(ch, fit);
    });
    // A Controller block's r and the y it compares with r share one scale and
    // offset, so they overlay (src/core/autotune.js loopOverlays); not in XY,
    // where channel 1 is the beam's x.
    if (sc.view?.mode !== 'xy') for (const g of loopOverlays(sc.channels, data.signals, app.unitOf)) {
      const fit = fitChannel(g.flatMap((i) => Array.from(data.signals[sc.channels[i].source])));
      if (fit) for (const i of g) Object.assign(sc.channels[i], fit);
    }
    fitPending = (app.designStatuses ?? []).some((s) => s.status === 'pending' || s.status === 'stale');
  }
  // After a change of display mode or Δ: a channel that now draws another
  // quantity (X − Y in XY, itself elsewhere) is fitted to it.
  app.refitSwitched = (before, sc) => { const d = display.data; if (d) refitSwitched(before, sc, d.signals, app.unitOf); };
  app.autoScale = () => {
    app.beginEdit();
    fitScope();
    app.endEdit();
    changed();
    toast('Auto Scale: one period of the input, every channel fitted');
  };

  // Rendering
  let live = null;  // Live mode (ui/live.js), made below
  let tuneTab = null;  // the Auto-tune tab (ui/autotune.js), made below
  // Speed, in the header (ui/speed.js): the factor every clock of the page
  // runs at, held at 1× while a live plant is connected (it owns the clock),
  // and the speed achieved.
  app.speedLock = () => live?.lockReason() ?? null;
  app.speedChanged = () => autosave();
  const speed = createSpeed(app);
  app.speed = () => speed.effective();
  app.timeRan = (t, seconds) => speed.ran(t, seconds);
  app.speedRender = () => speed.render();
  const display = createDisplay($('display'), {
    onSelectChannel: (i) => app.selectChannel(i),
    onSelectLine: (i) => { if (i !== null) app.channel = i; changed({ data: false }); },
    onStopped: () => { controls.render(display.mode); live?.mode('stop'); app.sweepEnded?.(); },  // a Single ended
    frameMs: () => app.frameMs(),
    edit: (fn) => app.editScope(fn),
    unitOf: (name) => app.unitOf(name),
    endEdit: () => app.endEdit(),
    onTime: () => app.onScopeTime?.(),
    liveTag: () => live?.tag(),
    speed: () => speed.effective(),
    simRate: () => app.simRate({ retime: true }),
    onSweep: (t, seconds) => speed.ran(t, seconds),
    onLevels: () => app.renderLevels?.(),  // the typed spectrogram levels follow the strip
  });
  app.display = display;
  const controls = createControls($('controls'), app);
  app.renderLevels = controls.renderLevels;
  // Save and references under the screen (ui/record.js); Live in Run Control.
  const record = createRecord(app, display);
  live = createLive(app, display, $('controls'), record);
  const generator = createGenerator($('tab-input'), app);
  const plantEditor = createPlantEditor($('tab-plant'), app);
  const controllerTab = createControllerTab($('tab-controller'), app);
  // Opens the Controller tab on one Controller block (path of block ids).
  app.openController = (path) => { controllerTab.open(path); app.tab = 'controller'; renderTabs(); };
  // The Analysis tab; the scope's time (the cursor, the sweep, where the
  // cursor last was, or the right edge) is its "Scope time" operating point,
  // and the tab follows it as it moves.
  const analysisTab = createAnalysisTab($('tab-analysis'), app);
  app.scopeTime = () => display.time();
  app.scopeTimeFrom = () => display.timeFrom();
  app.onScopeTime = () => analysisTab.followTime();
  // Auto-tune changes the project many times in one run but takes one undo
  // step for all of it (beginEdit at its start, endEdit at its end); each
  // change goes through tuneEdit. It shows whole runs while it works.
  app.tuneEdit = (fn, from) => { fn(app.project); if (from) adoptRun(from); changed(); };
  app.showLoop = () => display.setData(acquire());  // the loop's own run back on the display
  app.playRun = (d, past) => { display.play(d, past); controls.render(display.mode); };  // one run swept once
  app.setRunMode = (m) => { display.setMode(m); controls.render(display.mode); };
  tuneTab = createAutotuneTab($('tab-tune'), app, display);

  function renderTabs() {
    $('tabbar').innerHTML = TABS.map((t, i) => `<button role="tab" class="tab ${t.key === app.tab ? 'on' : ''} ${t.next ? 'later' : ''}" data-tab="${t.key}" aria-selected="${t.key === app.tab}">
      <span class="tn">${i + 1}</span>${t.label}${t.next ? '<span class="soon">later</span>' : ''}</button>`).join('');
    $('tabbar').querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { app.tab = b.dataset.tab; renderTabs(); }));
    const t = TABS.find((x) => x.key === app.tab);
    $('tab-input').hidden = app.tab !== 'input';
    $('tab-plant').hidden = app.tab !== 'plant';
    $('tab-controller').hidden = app.tab !== 'controller';
    if (app.tab === 'controller') controllerTab.shown();
    $('tab-tune').hidden = app.tab !== 'tune';
    if (app.tab === 'tune') tuneTab.shown();
    $('tab-analysis').hidden = app.tab !== 'analysis';
    if (app.tab === 'analysis') analysisTab.shown();
    if (app.tab !== 'plant') plantEditor.hidden();
    $('tab-later').hidden = !t.next;
    if (app.tab === 'plant') plantEditor.shown();
    if (t.next) {
      $('tab-later').innerHTML = `<div class="later-box"><h3 class="glabel">${t.label} · comes next</h3><p>${t.next}</p><p class="dim">Until then the display shows what is set up so far. The order and plans are in design/output/tabs.md.</p></div>`;
    }
  }

  // The note beside the title: a plant that does not run, a design that
  // failed, or one being planned; a click opens the tab that says why.
  let noteAction = null;
  function designNote() {
    const order = ['error', 'pending', 'stale', 'cancelled', 'warn'];
    const s = (app.designStatuses ?? []).filter((x) => order.includes(x.status)).sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))[0];
    if (!s) return null;
    const pct = `${Math.round(100 * (s.progress?.fraction ?? 0))} %${s.progress?.start > 1 ? ` (start ${s.progress.start} of ${s.progress.starts})` : ''}`;
    const what = { error: 'no design', warn: 'check its design', pending: `planning ${pct}`, stale: `re-planning ${pct}`, cancelled: 'planning cancelled' }[s.status];
    return { who: `${s.block} · ${s.variant}`, what, path: s.path };
  }
  function renderChrome() {
    $('undo').disabled = !undoStack.length;
    $('redo').disabled = !redoStack.length;
    if (document.activeElement !== $('title')) $('title').value = app.project.title;
    renderNote();
  }
  // A design's note is "block · variant: what"; where the header is short of
  // room the name gives way (an ellipsis) and "planning 43 %" stays. The note
  // takes no room of its own in the header's rows (style.css), so a plan that
  // starts or settles never wraps the header and moves the page.
  function renderNote() {
    const note = app.systemError ? null : designNote();
    const el = $('loopnote');
    if (note) {
      el.innerHTML = `<span class="ln-who"></span><span class="ln-what"></span>`;
      el.firstChild.textContent = note.who;
      el.lastChild.textContent = `: ${note.what}`;
    } else el.textContent = app.systemError ? 'plant: see the Plant tab' : loopNote;
    noteAction = app.systemError ? () => { app.tab = 'plant'; renderTabs(); } : note ? () => app.openController(note.path.split('/')) : null;
    el.classList.toggle('act', !!noteAction);
    if (noteAction) { el.setAttribute('role', 'button'); el.tabIndex = 0; el.title = `${el.textContent}. Open the tab that says why`; } else { el.removeAttribute('role'); el.removeAttribute('tabindex'); el.title = ''; }
  }
  $('loopnote').addEventListener('click', () => noteAction?.());
  $('loopnote').addEventListener('keydown', (e) => { if (noteAction && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); noteAction(); } });

  function changed({ data = true } = {}) {
    if (data) display.setData(acquire());
    display.setScope(app.project.scope, app.channel);
    showPreview();
    controls.render(display.mode);
    generator.render();
    if (app.tab === 'plant') plantEditor.render();
    if (app.tab === 'controller') controllerTab.render();
    if (app.tab === 'tune') tuneTab.render();
    if (app.tab === 'analysis') analysisTab.render();
    live.changed();  // a running loop takes the edit at its next cycle
    record.changed();  // references follow the window
    renderChrome();
    autosave();
  }

  // How the page is set (run control, tab, view) travels with the project as
  // `ui` when it is saved, and is applied when a project or system opens.
  let layout = null;
  const withUi = () => {
    const ui = { run: display.mode, ...(UI_TABS.includes(app.tab) ? { tab: app.tab } : {}), ...(plantEditor.viewName() ? { view: plantEditor.viewName() } : {}), ...(layout ? { setup: layout.setupShare() } : {}), speed: speedToJson(speed.set) };
    return { ...app.project, ui };
  };
  function applyUi(ui = {}) {
    if (ui.tab) app.tab = ui.tab;
    if (ui.speed !== undefined) speed.setSpeed(ui.speed);
    plantEditor.view(ui.view ?? '');
    if (ui.setup) layout?.setSetup(ui.setup);
    renderTabs();
    const run = ui.run ?? (reduced ? 'stop' : 'run');
    display.setMode(run, { restart: true });
    controls.render(display.mode);
  }

  // Loading
  function load(raw, { keepHistory = true, quiet = false } = {}) {
    const p = normalizeProject(typeof raw === 'string' ? JSON.parse(raw) : raw);
    const ui = p.ui;
    delete p.ui;  // applied once below; the page itself is the live state
    if (keepHistory && app.project) app.beginEdit();
    app.project = p;
    app.endEdit();
    generator.reset();
    plantEditor.reset();
    app.signal = Object.keys(p.system.signals).includes('r') ? 'r' : Object.keys(p.system.signals)[0];
    acqKey = '';
    display.clearRuns();
    changed();
    if (ui) applyUi(ui);
    if (!quiet) toast(`Loaded “${p.title}”`);
  }

  // Files and sharing
  const exportJson = () => JSON.stringify(withUi(), null, 2);
  function exportHtml() {
    const json = exportJson().replace(/</g, '\\u003c');
    return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<title>${esc(app.project.title)} · Loop Tuner</title>\n${$('lt-fonts')?.outerHTML ?? ''}\n<style id="lt-style">${$('lt-style').textContent}</style>\n</head>\n<body>\n${shellTemplate}\n<script type="application/json" id="loop-tuner-project">\n${json}\n</script>\n<script id="lt-script">${$('lt-script').textContent}</script>\n</body>\n</html>\n`;
  }
  // Saving a file. Where the hosting page offers a save adapter (the hosted
  // build adds one; the viewer confirms each save), through it; in a plain
  // browser, through a download link. Resolves true once the file is on its
  // way. Framed without an adapter, only the Copy buttons are offered.
  let saver = null;
  (window.__ltHost?.saver?.() ?? Promise.resolve(null)).then((d) => {
    saver = d;
    if (d && framed) document.querySelectorAll('[data-standalone]').forEach((el) => { el.hidden = false; });
  }).catch(() => {});
  async function download(name, data, type) {
    if (saver) {
      try { await saver.save({ filename: name, data }); return true; } catch (err) {
        if (err?.code !== 'declined') toast(`Could not save ${name}: ${err?.message ?? err?.code ?? err}`);
        return false;
      }
    }
    if (framed) { toast('Saving files is not available here; use Copy JSON or Copy HTML.'); return false; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
    a.download = name;
    document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return true;
  }
  app.download = download;
  app.canDownload = () => !framed || !!saver;  // else Save offers Copy (ui/record.js)
  const stem = () => app.project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'loop';
  async function copy(text, what) {
    try { await navigator.clipboard.writeText(text); toast(`${what} copied to the clipboard`); } catch { toast('Copying was blocked by the browser.'); }
  }
  app.copy = copy;  // for Save and the plant script (ui/record.js, ui/live.js)
  $('save').addEventListener('click', async () => { if (await download(`${stem()}.json`, exportJson(), 'application/json')) toast('Saved the project as JSON'); });
  $('export').addEventListener('click', async () => { if (await download(`${stem()}.html`, exportHtml(), 'text/html')) toast('Exported a standalone page with this project inside'); });
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

  // The System library: complete systems, loaded whole or by part.
  app.loadSystem = (entry, parts) => {
    try { load(applySystem(app.project, entry, parts), { quiet: true }); } catch (err) { toast(`Could not load ${entry.name}: ${err.message}`); return; }
    if (parts.includes('input') || parts.includes('plant')) app.autoScale();
    if (app.tab === 'plant') plantEditor.shown();
    const what = SYSTEM_PARTS.filter((k) => entry[k]).every((k) => parts.includes(k)) ? '' : ` (${parts.join(' and ')})`;
    toast(`Loaded ${entry.name}${what}. Ctrl+Z goes back.`);
  };
  const pop = $('syslib-pop');
  const PART_LABEL = { input: 'Input', plant: 'Plant', controller: 'Controller' };
  // Tags filter the list: every tag in the library is a chip at the top; a
  // click on one there or on a card toggles it; systems must carry them all.
  const tagFilter = new Set();
  const chip = (t, extra = '') => `<button type="button" class="tag tag-${t.kind} tone-${t.tone}${extra}" data-tag="${esc(t.label)}" aria-pressed="${tagFilter.has(t.label)}" title="Show only systems tagged ${esc(t.label)}">${esc(t.label)}</button>`;
  function renderLibrary() {
    const shown = new Set(filterByTags([...tagFilter]));
    pop.innerHTML = `<div class="pophead">System library <span>load a whole system, or one part of it</span></div>`
      + `<div class="taglegend">Tags: <span class="tag tag-plant">plant</span><span class="tag tag-controller">controller</span><span class="tag tag-observer">observer</span><span class="tag tag-feature">feature</span><span class="tag tag-none">none</span></div>`
      + `<div class="tagfilter" role="group" aria-label="Filter by tag">${libraryTags().map((t) => chip(t)).join('')}`
      + `<span class="tagcount">${tagFilter.size ? `${shown.size} of ${SYSTEM_LIBRARY.length} <button type="button" class="key small" data-tagclear>Clear</button>` : `${SYSTEM_LIBRARY.length} systems · click a tag to filter`}</span></div>`
      + SYSTEM_LIBRARY.map((e, i) => (shown.has(i) ? `<div class="sysrow"><div class="sysname">${esc(e.name)}<div class="systags">${e.tags.map((t) => chip(t)).join('')}</div><div class="sysnote">${esc(e.notes)}</div></div>
      <div class="sysbtns"><button class="key small primary" data-sys="${i}" data-parts="all">Load</button>${SYSTEM_PARTS.filter((k) => e[k]).map((k) => `<button class="key small" data-sys="${i}" data-parts="${k}">${PART_LABEL[k]}</button>`).join('')}</div></div>` : '')).join('');
  }
  renderLibrary();
  const closePop = () => { pop.hidden = true; $('syslib').setAttribute('aria-expanded', 'false'); };
  $('syslib').addEventListener('click', (e) => {
    e.stopPropagation();
    if (pop.hidden) document.dispatchEvent(new MouseEvent('click'));  // one menu open at a time: the others close
    pop.hidden = !pop.hidden;
    $('syslib').setAttribute('aria-expanded', String(!pop.hidden));
  });
  pop.addEventListener('click', (e) => {
    e.stopPropagation();
    const tag = e.target.closest('[data-tag]');
    if (tag) { if (!tagFilter.delete(tag.dataset.tag)) tagFilter.add(tag.dataset.tag); renderLibrary(); return; }
    if (e.target.closest('[data-tagclear]')) { tagFilter.clear(); renderLibrary(); return; }
    const b = e.target.closest('[data-sys]');
    if (!b) return;
    const entry = SYSTEM_LIBRARY[Number(b.dataset.sys)];
    app.loadSystem(entry, b.dataset.parts === 'all' ? SYSTEM_PARTS.filter((k) => entry[k]) : [b.dataset.parts]);
    closePop();
  });
  document.addEventListener('click', closePop);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { closePop(); e.stopImmediatePropagation(); } }, true);
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
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); $(framed && !saver ? 'copy' : 'save').click(); return; }
    if (!inField && app.tab === 'plant' && $('help-dlg').hidden && plantEditor.handleKey(e)) { e.preventDefault(); return; }
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
    run: () => app.setMode('run'),
    stop: () => app.setMode('stop'),
    single: () => app.setMode('single'),
    // The speed of time: x a factor, or -1 (or 'inf') for as fast as possible.
    // Returns { speed, effective, achieved, simulation, locked } (-1 for as
    // fast as possible; simulation: how fast the page simulates the screen,
    // which no speed exceeds, or null if not timed).
    speed: (x) => {
      if (x !== undefined && !speed.setSpeed(x)) throw new Error('speed: a factor above 0, or -1 for as fast as possible');
      const sim = app.simRate();
      return { speed: speedToJson(speed.set), effective: speedToJson(speed.effective()), achieved: speed.achieved(), simulation: Number.isFinite(sim) ? sim : null, locked: speed.locked() };
    },
    // What each running designed variant computed from the plant (status, rows, errors).
    designs: () => { acquire(); return structuredClone(app.designStatuses ?? []); },
    // Resolves, with the statuses, once no design is being computed in the
    // background (a plan) and the display shows the run that uses it.
    whenDesigned: async () => {
      for (;;) {
        acquire();
        if (!designs.busy()) return structuredClone(app.designStatuses ?? []);
        await designs.idle();
      }
    },
    // The loop the Controller at path closes, linearised at op ('origin',
    // 'initial', { y: [levels] }, { t: seconds }): { plant, ctrl, Ts, … }.
    loopModel: (path, op) => structuredClone(app.loopModel(path, op)),
    selectCandidate: (ref) => { const i = findCandidate(app.project, ref); app.beginEdit(); app.project.selected = app.project.candidates[i].name; app.endEdit(); changed(); },
    live: live.api,  // connect(url), disconnect(), estop(), reset(), state(): design/output/hil.md
    record: record.api,  // screen(format), live(format), reference(text, name), clearReferences(), state()
    // Auto-tune a Controller block at once, as the Auto-tune tab does step by
    // step: opts { block (id path, 'ctrl'), method, goal, rule, simc,
    // amplitude, maxIter, feedforward, apply = true }. Applied, the result
    // goes into a variant of its own, running if it scores better: one undo
    // step.
    autotune: (opts = {}) => {
      tuneTab.stop();
      let res;
      try { res = autotune(app.project, opts.block ? String(opts.block).split('/') : null, opts); } catch (err) { return { ok: false, why: err.message }; }
      if (res.ok && opts.apply !== false) { app.beginEdit(); placeVariant(app.project, res.path, res.variant, { run: res.better }); app.endEdit(); changed(); }
      return tuneReport(res);
    },
  };

  // Boot: the embedded project, unless this browser has newer work on it.
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { /* storage unavailable */ }
  try {
    if (saved && saved.base === base) app.project = normalizeProject(saved.project);
    else {
      app.project = normalizeProject(JSON.parse(startText));
      if (!embeddedText) fitScope();  // the library's system, scaled as when it is loaded
    }
  } catch (err) {
    app.project = normalizeProject(structuredClone(DEFAULT_PROJECT));
    setTimeout(() => toast(`The embedded project could not be read (${err.message}); opened a new one instead.`));
  }
  renderTabs();
  changed();
  layout = createSplitters($('lt-shell'));
  const ui = app.project.ui;
  delete app.project.ui;
  applyUi(ui);
}

function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startApp);
else startApp();
