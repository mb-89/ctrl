// Live (HIL) mode and Record, in the controls column under Run Control.
//
// Live: a system with an External plant block runs against a plant outside
// the page (hil_plant.py, or hardware behind the same protocol). The loop
// (core/live.js) runs in a Web Worker made from this page's own script, so
// drawing never delays an answer; where workers are blocked it runs here.
// Its samples sweep the screen like a simulation: each sweep is one run and
// earlier sweeps fade. Record keeps the last minutes of every signal, live or
// simulated; Save writes them as CSV or JSON; Open shows a saved trace as a
// dashed reference. See design/output/hil.md and instrument.md.

import { HIL_URL, externalParams, sameDescription } from '../core/hil.js';
import { createLiveLoop } from '../core/live.js';
import { normalizeDiagram, parseEnd } from '../core/diagram.js';
import { createRecorder, traceToCsv, traceToJson, parseTrace } from '../core/trace.js';
import { fitChannel } from '../core/project.js';

const RECORD_KEY = 'loop-tuner:record-seconds';
const MAX_SWEEP = 200000;
// The plant script's text, put into the bundle by build.mjs.
const PLANT_PY = typeof __HIL_PLANT_PY === 'string' ? __HIL_PLANT_PY : '';
const RUN_PY = 'uv run hil_plant.py';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ms = (v) => (Number.isFinite(v) ? `${v < 10 ? v.toFixed(2) : v.toFixed(1)} ms` : '–');
// Record lengths: "5 min", "30 s", "1 h"; a bare number is seconds, m is minutes.
function parseDuration(text) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(h|min|m|s)?\s*$/i.exec(String(text).replace(',', '.'));
  if (!m) return NaN;
  return Number(m[1]) * ({ h: 3600, min: 60, m: 60, s: 1 }[(m[2] ?? 's').toLowerCase()]);
}
function duration(s) {
  if (s >= 3600 && s % 3600 === 0) return `${s / 3600} h`;
  if (s >= 60) return Number.isInteger(s / 60) ? `${s / 60} min` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')} min`;
  return `${Number(s.toFixed(s < 10 ? 1 : 0))} s`;
}

export function createLive(app, display, controlsRoot) {
  const framed = window.self !== window.top;

  // ---- Controls. Live is a second row of Run Control, with the same keys,
  // shown only for a system with an External plant; Record ends the column.
  const liveEl = document.createElement('div');
  liveEl.className = 'lv';
  liveEl.setAttribute('aria-label', 'Live: the external plant');
  liveEl.innerHTML = `
    <div class="row">
      <button class="key" id="lv-connect" title="Connect to the external plant and run the loop against it">Connect</button>
      <button class="key estop" id="lv-estop" title="Emergency stop: the plant applies its safe inputs until Reset">E-STOP</button>
      <button class="key" id="lv-reset" title="Clear the E-stop and start again, the controllers afresh">Reset</button>
    </div>
    <div class="lv-line" id="lv-where"><input class="lv-url" id="lv-url" spellcheck="false" aria-label="Where the plant listens" title="Where the plant listens: click to type (kept in the External plant block)"><button class="lv-link" id="lv-script" title="The external plant of HIL: external motor, a Python script for your computer">plant script…</button></div>
    <div class="lv-stats" id="lv-stats" aria-live="polite"></div>`;
  // Record sits under the screen, beside the channel badges, like a scope's
  // save keys: what it saves is what the screen shows, and more.
  const recEl = document.createElement('div');
  recEl.className = 'recbar';
  recEl.setAttribute('aria-label', 'Record');
  recEl.innerHTML = `
    <span class="rc-label" title="Record: the last … of every signal, live or simulated, is kept to be saved">Rec</span>
    <span class="rc-state" id="rc-state"></span><input class="rc-len" id="rc-len" spellcheck="false" aria-label="Record length" title="Record length: 5 min, 30 s, 1 h">
    ${framed ? '<button class="rkey" id="rc-copy" title="Copy the record as CSV (downloads are blocked here)">Copy CSV</button>'
      : `<span class="rc-menu"><button class="rkey" id="rc-save" aria-haspopup="true" aria-expanded="false" title="Save the record">Save ▾</button><span class="rc-pop" id="rc-pop" hidden>
        <button class="rkey" id="rc-csv" title="t and every signal, units in the header: for spreadsheets">CSV file</button><button class="rkey" id="rc-json" title="The same as JSON: for scripts">JSON file</button><button class="rkey" id="rc-copy" title="CSV to the clipboard">Copy CSV</button></span></span>`}
    <button class="rkey" id="rc-open" title="Open a saved trace (CSV or JSON): it is drawn dashed on the channels with the same names">Open…</button>
    <span class="rc-refs" id="rc-refs" hidden></span>
    <input type="file" id="rc-file" accept=".csv,.json,text/csv,application/json" hidden>`;
  controlsRoot.querySelector('.group').append(liveEl);
  document.getElementById('display').append(recEl);
  const $ = (id) => document.getElementById(id);

  // ---- The External plant block, at any depth.
  const rootDiagram = () => (app.project.system.plant?.type === 'diagram' ? app.project.system.plant.diagram : null);
  function findExternal(d = rootDiagram()) {
    if (!d) return null;
    for (const b of d.blocks) {
      if (b.type === 'external') return { block: b, level: d };
      if (b.type === 'subsystem') { const hit = findExternal(b.diagram); if (hit) return hit; }
    }
    return null;
  }
  // Edits it as one undo step, through the Plant tab's path.
  function editExternal(fn) {
    const next = structuredClone(rootDiagram());
    const hit = findExternal(next);
    if (!hit) return false;
    fn(hit.block, hit.level);
    try { app.setPlant(normalizeDiagram(next)); return true; } catch (err) { app.toast(err.message); return false; }
  }

  // ---- The loop: in a worker made from this page's own script (its core
  // modules), or on the page when workers are blocked (a strict host).
  let host = null;
  function workerSource() {
    const src = document.getElementById('lt-script')?.textContent ?? '';
    const cut = src.indexOf('\n// ---- ui/');
    return cut < 0 ? null : `${src.slice(0, cut)}\n__mods['core/live.js'].liveWorker(self);\n})();\n`;
  }
  function openHost() {
    return new Promise((resolve) => {
      const onPage = () => { const loop = createLiveLoop(receive); resolve({ post: (m) => loop.handle(m), kind: 'page' }); };
      const src = api.worker === false ? null : workerSource();
      if (!src) { onPage(); return; }
      let w = null, url = '', settled = false;
      const fallback = () => {
        if (settled) return;
        settled = true;
        try { w?.terminate(); } catch { /* never started */ }
        URL.revokeObjectURL(url);
        onPage();
      };
      try {
        url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        w = new Worker(url, { name: 'loop-tuner-live' });
      } catch { fallback(); return; }
      w.onerror = (e) => { e.preventDefault(); if (!settled) fallback(); else app.toast(`Live: ${e.message}`); };
      w.onmessage = (e) => {
        if (settled) { receive(e.data); return; }
        if (e.data?.type !== 'ready') return;
        settled = true;
        URL.revokeObjectURL(url);
        resolve({ post: (m) => w.postMessage(m), kind: 'worker' });
      };
      setTimeout(fallback, 3000);
    });
  }

  let state = 'idle', detail = '', estop = null, desc = null, link = null, plantStatus = null, programKey = '';
  const updates = {};  // how the running loop took edits: { kept, rebuilt, signals }
  function receive(m) {
    if (m.type === 'state') onState(m.state, m.detail);
    else if (m.type === 'described') onDescribed(m.desc);
    else if (m.type === 'estop') { estop = { by: m.by, reason: m.reason }; app.toast(`E-STOP${m.by === 'plant' ? ' from the plant' : ''}: ${m.reason}. Reset starts again.`); render(); }
    else if (m.type === 'samples') onSamples(m);
    else if (m.type === 'stats') { link = m.link; plantStatus = m.plant; renderStats(); }
    else if (m.type === 'programmed') {
      updates[m.how] = (updates[m.how] ?? 0) + 1;
      if (m.how === 'rebuilt') app.toast('The diagram changed: the controllers start afresh.');
    }
    else if (m.type === 'error') app.toast(`Live: ${m.message}`);
  }

  function onState(s, d) {
    const was = state;
    state = s; detail = d;
    if (s === 'connecting') { estop = null; desc = null; link = null; plantStatus = null; sweep = null; lastT = null; recSource = ''; programKey = ''; }
    if (s === 'running') { estop = null; attach(); }
    if (s === 'closed' && was !== 'closed') app.toast(was === 'connecting' ? `Could not connect: ${d}` : `Disconnected: ${d}`);
    render();
  }

  // The plant says what it is: the block takes its ports (if they differ),
  // the loop gets the diagram, and it starts, unless an E-stop is latched.
  function onDescribed(dsc) {
    desc = dsc;
    const hit = findExternal();
    if (hit && !sameDescription(hit.block.params, desc)) {
      editExternal((b, lv) => {
        b.params = externalParams(desc, b.params.url);
        const nIn = b.params.inputs.length, nOut = b.params.outputs.length;
        lv.wires = lv.wires.filter((w) => { const f = parseEnd(w.from), t = parseEnd(w.to); return !(t.id === b.id && t.port >= nIn) && !(f.id === b.id && f.port >= nOut); });
      });
      app.toast(`The External plant block took the plant's ports: in ${desc.inputs.map((p) => p.name).join(', ')}; out ${desc.outputs.map((p) => p.name).join(', ')}. Ctrl+Z goes back.`);
    }
    sendProgram();  // (the edit above may have sent it already)
    if (desc.estop) render();
    else host.post({ type: 'start' });
  }

  function sendProgram() {
    const d = rootDiagram();
    const key = JSON.stringify([d, app.project.system.signals]);
    if (key === programKey) return;
    programKey = key;
    host.post({ type: 'program', diagram: structuredClone(d), signals: structuredClone(app.project.system.signals) });
  }

  async function connect() {
    const hit = findExternal();
    if (!hit) { app.toast('This system has no External plant block: add one from the Live group in the Plant tab, or load “HIL: external motor”.'); return; }
    if (!window.WebSocket) { app.toast('This browser has no WebSocket.'); return; }
    state = 'connecting'; render();
    host ??= await openHost();
    host.post({ type: 'connect', url: hit.block.params.url });
  }

  // ---- The screen while live: sweeps of the scope's window, each one run.
  let names = [], sweep = null, done = null, lastT = null, feeding = false;
  const empty = { t: new Float64Array(0), signals: {} };
  function windowOf() {
    const tb = app.project.scope.timebase;
    const w0 = Math.max(0, tb.position);
    return [w0, tb.position + 10 * tb.scale];
  }
  const view = (s) => ({ t: s.t.subarray(0, s.n), signals: Object.fromEntries(names.map((nm, j) => [nm, s.cols[j].subarray(0, s.n)])) });
  // A sweep starts at a multiple of the screen's width in plant time, so
  // sweeps line up with an input whose period fits the screen, as the
  // simulated runs do (they start at t = 0).
  function newSweep(t) {
    const [w0, w1] = windowOf();
    const W = Math.max(w1 - w0, 1e-6), rate = desc?.rate_hz ?? 100;
    const every = Math.max(1, Math.ceil((W * rate) / MAX_SWEEP));
    const cap = Math.ceil((W * rate) / every) + 2;
    if (sweep?.n) done = view(sweep);
    const start = W * Math.floor(t / W + 1e-9);
    sweep = { w0, W, key: `${w0}:${W}`, start, every, k: 0, n: 0, cap, t: new Float64Array(cap), cols: names.map(() => new Float64Array(cap)) };
  }
  function addSample(t, vals) {
    const [w0, w1] = windowOf();
    if (!sweep || sweep.key !== `${w0}:${Math.max(w1 - w0, 1e-6)}` || t < sweep.start || t - sweep.start >= sweep.W) newSweep(t);
    lastT = t;
    const s = sweep;
    if (s.k++ % s.every || s.n >= s.cap) return;
    s.t[s.n] = s.w0 + (t - s.start);
    for (let j = 0; j < names.length; j++) s.cols[j][s.n] = vals[j];
    s.n++;
  }
  // What the display draws each frame.
  function poll() {
    const out = { data: sweep ? view(sweep) : empty, scan: sweep && lastT !== null ? sweep.w0 + (lastT - sweep.start) : windowOf()[0], done };
    if (done && fitPending !== null) { const d = done, was = fitPending; fitPending = null; setTimeout(() => fitTo(d, was)); }
    done = null;
    return out;
  }
  // The channels were scaled offline, where the External plant reads 0: the
  // first live sweep fits them, as Auto Scale does, unless they were set since.
  let fitPending = null;
  function fitTo(d, was) {
    if (JSON.stringify(app.project.scope.channels) !== was) return;
    app.editScope((sc) => { for (const ch of sc.channels) { const fit = d.signals[ch.source] && fitChannel(d.signals[ch.source]); if (fit) Object.assign(ch, fit); } });
    app.endEdit();
    app.toast('Channels fitted to the first live sweep (Auto Scale). Ctrl+Z goes back.');
  }
  function attach() {
    if (feeding) return;
    feeding = true;
    fitPending = JSON.stringify(app.project.scope.channels);
    display.clearRuns();
    display.setFeed(poll);
    if (display.mode === 'stop') app.toggleRun();
  }
  function detach() {
    if (!feeding) return;
    feeding = false;
    display.setFeed(null);
    display.clearRuns();
  }

  function onSamples(m) {
    if (m.names.join('\n') !== names.join('\n')) { names = m.names; sweep = null; }
    for (let i = 0; i < m.t.length; i++) {
      addSample(m.t[i], m.values[i]);
      recordLive(m.t[i], m.values[i]);
    }
  }

  // ---- Record: the scope's deep memory, live or simulated.
  let seconds = 300;
  try { seconds = Number(localStorage.getItem(RECORD_KEY)) || 300; } catch { /* storage unavailable */ }
  const rec = createRecorder(seconds);
  let recSource = '', simT = 0;
  const unitsOf = (list) => Object.fromEntries(list.map((nm) => [nm, app.unitOf(nm)]));
  function recordLive(t, vals) {
    const rate = desc?.rate_hz ?? 100;
    if (recSource !== 'live' || !rec.fits(names, rate)) { rec.reset(names, unitsOf(names), rate); recSource = 'live'; }
    rec.push(t, vals);
  }
  // A simulated sweep the display finished: its window [w0, w1) follows the
  // one before, so the record's time runs on.
  function recordSweep(d, w0, w1) {
    if (feeding || !(d?.t?.length > 1)) return;
    const nms = Object.keys(d.signals), rate = 1 / (d.t[1] - d.t[0]);
    if (recSource !== 'simulation' || !rec.fits(nms, rate)) { rec.reset(nms, unitsOf(nms), rate); recSource = 'simulation'; simT = 0; }
    const cols = nms.map((nm) => d.signals[nm]), vals = new Array(nms.length);
    for (let i = 0; i < d.t.length; i++) {
      if (d.t[i] < w0 - 1e-9 || d.t[i] >= w1 - 1e-9) continue;
      for (let j = 0; j < cols.length; j++) vals[j] = cols[j][i];
      rec.push(simT + d.t[i] - w0, vals);
    }
    simT += w1 - w0;
  }
  // The record, or the screen if nothing is recorded yet.
  function traceNow() {
    if (rec.length > 1) return { trace: rec.snapshot(), source: recSource === 'live' ? `live: ${desc?.name ?? 'external plant'}` : 'simulation' };
    const d = display.data;
    if (!(d?.t?.length > 1)) return null;
    const nms = Object.keys(d.signals);
    return { trace: { t: d.t, signals: d.signals, units: unitsOf(nms) }, source: 'the screen' };
  }
  const stem = () => `${app.project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'trace'}-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}`;
  function save(kind) {
    const x = traceNow();
    if (!x) { app.toast('Nothing recorded yet: let the scope run a sweep, or connect Live.'); return; }
    const meta = { title: app.project.title, source: x.source };
    const n = x.trace.t.length;
    if (kind === 'copy') { app.copy(traceToCsv(x.trace, meta), `The record (${n} samples, CSV)`); return; }
    if (kind === 'json') app.download(`${stem()}.json`, traceToJson(x.trace, meta), 'application/json');
    else app.download(`${stem()}.csv`, traceToCsv(x.trace, meta), 'text/csv');
    app.toast(`Saved ${duration(x.trace.t[n - 1] - x.trace.t[0])} of ${Object.keys(x.trace.signals).join(', ')} (${x.source})`);
  }

  // References: saved traces shown dashed on the channels with their names.
  const refs = [];
  function renderRefs() {
    const box = $('rc-refs');
    box.hidden = !refs.length;
    box.innerHTML = refs.length ? `<button class="rkey rc-ref" id="rc-clear" title="References (dashed): ${esc(refs.map((r) => r.name).join(', '))}. Click to clear them.">ref${refs.length > 1 ? ` ×${refs.length}` : ''} ✕</button>` : '';
    $('rc-clear')?.addEventListener('click', () => { refs.length = 0; display.setRefs(refs); renderRefs(); app.toast('References cleared'); });
  }
  $('rc-open').addEventListener('click', () => $('rc-file').click());
  $('rc-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const tr = parseTrace(await f.text());
      const name = f.name.replace(/\.(csv|json)$/i, '');
      refs.push({ name, ...tr });
      display.setRefs(refs);
      renderRefs();
      const all = Object.keys(tr.signals), shown = all.filter((nm) => app.project.scope.channels.some((c) => c.on && c.source === nm));
      app.toast(shown.length ? `Reference “${name}”: ${shown.join(', ')} dashed on the scope${shown.length < all.length ? `; ${all.filter((x) => !shown.includes(x)).join(', ')} not on a channel` : ''}` : `Reference “${name}” holds ${all.join(', ')}; none of them is on a channel.`);
    } catch (err) { app.toast(`Could not read ${f.name}: ${err.message}`); }
  });
  const pop = $('rc-pop');
  const closePop = () => { if (pop && !pop.hidden) { pop.hidden = true; $('rc-save').setAttribute('aria-expanded', 'false'); } };
  $('rc-save')?.addEventListener('click', (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; $('rc-save').setAttribute('aria-expanded', String(!pop.hidden)); });
  document.addEventListener('click', closePop);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pop && !pop.hidden) { closePop(); e.stopImmediatePropagation(); } }, true);
  $('rc-csv')?.addEventListener('click', () => save('csv'));
  $('rc-json')?.addEventListener('click', () => save('json'));
  $('rc-copy')?.addEventListener('click', () => save('copy'));
  const lenEl = $('rc-len');
  lenEl.value = duration(seconds);
  lenEl.addEventListener('focus', () => lenEl.select());
  lenEl.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') lenEl.blur(); if (e.key === 'Escape') { lenEl.value = duration(seconds); lenEl.blur(); } });
  lenEl.addEventListener('blur', () => {
    const s = parseDuration(lenEl.value);
    if (!(s >= 1 && s <= 4 * 3600)) { if (lenEl.value !== duration(seconds)) app.toast('A record length from 1 s to 4 h: 5 min, 30 s, 1 h.'); lenEl.value = duration(seconds); return; }
    seconds = s;
    rec.setLength(s);
    lenEl.value = duration(s);
    try { localStorage.setItem(RECORD_KEY, String(s)); } catch { /* storage unavailable */ }
    renderRecord();
  });
  function renderRecord() {
    const st = $('rc-state');
    st.textContent = `${duration(rec.length > 1 ? rec.span() : 0)} /`;
    st.title = rec.length > 1 ? `${duration(rec.span())} recorded, ${recSource === 'live' ? 'live' : 'simulated'}; the last ${duration(seconds)} are kept` : 'Nothing recorded yet: the record fills while the scope runs';
  }
  setInterval(renderRecord, 500);

  // ---- The plant script: download or copy, with how to run it.
  const dlg = document.createElement('div');
  dlg.className = 'overlay';
  dlg.hidden = true;
  dlg.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="lv-dlg-title">
    <h2 id="lv-dlg-title">The external plant</h2>
    <p><code>hil_plant.py</code> is a DC motor swinging an unbalanced arm, simulated in real time at 100 Hz on your computer: the plant of <b>HIL: external motor</b>. It listens on <code>${HIL_URL}</code>, sends its outputs every cycle and applies the inputs this page sends back. If it hears nothing for 10 cycles it stops the motor (E-stop) until you press Reset.</p>
    <pre>${RUN_PY}</pre>
    <p>uv installs what it needs (the websockets package) by itself. Without uv: <code>pip install websockets</code>, then <code>python3 hil_plant.py</code>. <code>--help</code> lists its options (port, rate, watchdog).</p>
    <p class="dim">${framed ? 'This viewer may not let the page connect to your computer or download files: copy the script here, and use Copy HTML to open Loop Tuner from a file in your browser.' : 'To put real hardware behind Loop Tuner, keep the script\'s server, cycle and watchdog and replace its Motor with your device.'}</p>
    <p class="lv-btns">${framed ? '' : '<button class="key primary" id="lv-dl">Download hil_plant.py</button>'}<button class="key" id="lv-copy-py">Copy the script</button><button class="key" id="lv-copy-cmd">Copy “${RUN_PY}”</button><button class="key" id="lv-close">Close</button></p>
  </div>`;
  document.getElementById('lt-shell').append(dlg);
  const closeDlg = () => { dlg.hidden = true; };
  $('lv-script').addEventListener('click', () => { dlg.hidden = false; ($('lv-dl') ?? $('lv-copy-py')).focus(); });
  $('lv-close').addEventListener('click', closeDlg);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) closeDlg(); });
  dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeDlg(); } });
  $('lv-dl')?.addEventListener('click', () => { app.download('hil_plant.py', PLANT_PY, 'text/x-python'); app.toast(`Saved hil_plant.py. Run it with: ${RUN_PY}`); });
  $('lv-copy-py').addEventListener('click', () => app.copy(PLANT_PY, 'hil_plant.py'));
  $('lv-copy-cmd').addEventListener('click', () => app.copy(RUN_PY, 'The command'));

  // ---- Live controls
  const on = () => ['connecting', 'open', 'running'].includes(state);
  $('lv-connect').addEventListener('click', () => { if (on()) host?.post({ type: 'disconnect' }); else connect(); });
  $('lv-estop').addEventListener('click', () => { if (on()) host.post({ type: 'estop' }); });
  $('lv-reset').addEventListener('click', () => { if (on()) host.post({ type: 'reset' }); });
  const urlEl = $('lv-url');
  urlEl.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') urlEl.blur(); if (e.key === 'Escape') { urlEl.value = findExternal()?.block.params.url ?? ''; urlEl.blur(); } });
  urlEl.addEventListener('blur', () => {
    const v = urlEl.value.trim(), hit = findExternal();
    if (hit && v !== hit.block.params.url && !editExternal((b) => { b.params.url = v; })) urlEl.value = hit.block.params.url;
  });

  function render() {
    const hit = findExternal();
    liveEl.hidden = !hit;
    if (!hit) return;
    const k = $('lv-connect');
    k.textContent = on() ? 'Disconnect' : 'Connect';
    k.className = `key ${state === 'running' ? 'lit-green' : on() ? 'lit-amber' : ''}`;
    $('lv-estop').className = `key estop ${estop ? 'lit-red' : ''}`;
    $('lv-estop').disabled = !on();
    $('lv-reset').disabled = !(estop && on());
    if (document.activeElement !== urlEl) urlEl.value = hit.block.params.url;
    urlEl.disabled = on();
    renderStats();
  }
  // Under the keys: where the plant is and the state, or while running what
  // the link does.
  function renderStats() {
    const el = $('lv-stats');
    const running = state === 'running' && link && !estop;
    $('lv-where').hidden = running;
    el.title = '';
    if (estop) { el.innerHTML = `<span class="bad">E-STOP: ${esc(estop.reason)}</span><br>${estop.by === 'plant' ? 'the plant stopped it' : 'the page stopped it'}: safe inputs until ${on() ? 'Reset' : 'you Connect and Reset'}`; return; }
    if (!running) {
      el.textContent = { idle: 'not connected: run the plant script, then Connect', connecting: 'connecting…', open: 'connected, starting…', running: 'running', closed: `not connected${detail ? `: ${detail}` : ''}` }[state];
      return;
    }
    const p = plantStatus;
    el.innerHTML = `<span class="ok">●</span> ${link.rate.toFixed(1)} Hz · jitter ${ms(link.jitter)} · ${host.kind === 'worker' ? 'worker' : 'page'}<br>round trip ${ms(p?.rtt_ms?.mean)} · missed ${link.missed} · late ${p?.late ?? '–'}`;
    el.title = `Page: arrivals deviate up to ${ms(link.jitter)} from the cycle; ${ms(link.compute)} per cycle (at most ${ms(link.computeMax)}) to answer.\n`
      + (p ? `Plant: ${p.rate_hz} Hz, cycle start late by ${ms(p.jitter_ms?.mean)} on average (at most ${ms(p.jitter_ms?.max)}); round trip ${ms(p.rtt_ms?.mean)} (at most ${ms(p.rtt_ms?.max)}); ${p.late} cycles without a new u, ${p.overruns} skipped, ${p.dropped} y dropped.` : '');
  }

  const api = {
    worker: true,  // false: run the loop on the page (to compare)
    connect: () => connect(),
    disconnect: () => host?.post({ type: 'disconnect' }),
    estop: () => host?.post({ type: 'estop' }),
    reset: () => host?.post({ type: 'reset' }),
    state: () => ({ state, detail, estop, where: host?.kind ?? null, link, plant: plantStatus, t: lastT, recorded: rec.span(), refs: refs.map((r) => r.name), updates: { ...updates } }),
    csv: () => { const x = traceNow(); return x ? traceToCsv(x.trace, { title: app.project.title, source: x.source }) : ''; },
  };

  return {
    api,
    // After every change of the project: the panel follows, a running loop
    // gets the new diagram (it takes parameters at the next cycle), and a
    // system without an External plant leaves Live.
    changed() {
      render();
      const hit = findExternal();
      if (!hit && feeding) detach();
      if (!host || !on()) return;
      if (!hit) { app.toast('This system has no External plant block: Live disconnected.'); host.post({ type: 'disconnect' }); return; }
      if (desc) sendProgram();
    },
    sweep: recordSweep,
    // The live sweep on the screen (for views and Auto Scale), or null.
    data: () => (feeding && sweep ? view(sweep) : null),
    tag() {
      if (!findExternal()) return null;
      if (estop) return { cls: 'st-estop', text: 'E-STOP', note: estop.reason };
      if (state === 'running') return { cls: 'st-live', text: 'Live', note: `plant t ${lastT === null ? '–' : lastT.toFixed(2)} s` };
      if (on()) return { cls: 'st-wait', text: 'Connecting' };
      return { cls: 'st-offline', text: 'Offline', note: feeding ? 'the last live sweeps · Connect to go on' : 'external plant not connected: it reads 0 · Connect' };
    },
  };
}
