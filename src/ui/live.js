// Live (HIL) mode: a system with an External plant block runs against a plant
// outside the page (hil_plant.py, or hardware behind the same protocol). The
// loop (core/live.js) runs in a Web Worker made from this page's own script,
// so drawing never delays an answer; where workers are blocked it runs here.
//
// Where things are: the Live controls (Download the plant, Connect, Reset,
// Hold, where the plant listens, its state, the Live settings) sit in the
// Plant tab's right-hand panel; the E-STOP key in the header, beside the
// System library, reachable from anywhere (key E); the live state in the
// scope's status line. Nothing runs by itself: offline the scope stands
// still, Connect only reads the plant's description, Run starts the plant
// and the sweep, Stop stops both, Single runs one sweep and stops the plant
// (pressed while running, the sweep under way finishes first). The
// references ramp in before every loop (core/ramp.js). Every control has a
// stable id, an accessible name and its state in data-* attributes, so an
// agent with only a browser can read the page. See design/output/hil.md.

import { HIL_URL, externalParams, sameDescription, samePorts, findExternal, blockMode, RAMP_DEFAULT } from '../core/hil.js';
import { createLiveLoop, liveKey, liveScales, liveProblem, followPorts } from '../core/live.js';
import { normalizeDiagram } from '../core/diagram.js';
import { sweepStart } from '../core/trace.js';
import { zipFiles } from '../core/zip.js';
import { simulatorCore, CORE_FILE } from '../core/hilsim.js';
import { num, parseSI } from './units.js';

const MAX_SWEEP = 200000;
// The plant's files (hil/), put into the bundle by build.mjs.
const HIL_FILES = typeof __HIL_FILES === 'object' ? __HIL_FILES : {};
const ZIP_NAME = 'hil-plant.zip';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ms = (v) => (Number.isFinite(v) ? `${v < 10 ? v.toFixed(2) : v.toFixed(1)} ms` : '–');
// A key's lamp (design-system.md, Lit): data-lamp "ok", "warn", "bad", or off.
const lamp = (el, v) => { if (v) el.dataset.lamp = v; else delete el.dataset.lamp; };

// The plant's files: hil/ and this page's own core, cut from its script, so
// the plant simulates with exactly the code this page runs (an exported page
// carries its own). In Node (no page) only hil/.
export function plantFiles(script = typeof document === 'object' ? document.getElementById('lt-script')?.textContent ?? '' : '') {
  const core = simulatorCore(script);
  return { ...HIL_FILES, ...(core ? { [CORE_FILE]: core } : {}) };
}
// The plant's files as one zip; runme.sh stays executable.
export const plantZip = (files = plantFiles()) => zipFiles(Object.entries(files).map(([name, data]) => ({ name: `hil-plant/${name}`, data, mode: name.endsWith('.sh') ? 0o755 : 0o644 })));

export function createLive(app, display, record, panelHost) {
  const $ = (id) => document.getElementById(id);

  // ---- The panel, at the top of the Plant tab's right-hand column.
  const panel = document.createElement('section');
  panel.className = 'live';
  panel.id = 'live';
  panel.setAttribute('aria-label', 'Live: the external plant');
  panel.innerHTML = `
    <h3 class="label">Live · external plant</h3>
    <button class="btn lv-download" id="live-download" aria-label="Download the plant (zip)" title="hil-plant.zip: a simulated plant for your computer, with runme scripts that install what it needs. What it is and how to run it: Help (?), Live.">Download the plant (zip)</button>
    <div class="keyrow">
      <button class="btn" id="live-connect" aria-label="Connect to the external plant" title="Open the link and read the plant's description; nothing starts until Run">Connect</button>
      <button class="btn" id="live-reset" aria-label="Reset the E-stop" title="Clear the E-stop (either side); the plant stays stopped until Run">Reset</button>
      <button class="btn" id="live-hold" aria-label="Hold the screen" aria-pressed="false" title="Freeze the screen while the plant runs on; the live record goes on (H)">Hold</button>
    </div>
    <label class="lv-line"><span class="flabel">Plant at</span><input class="field field-sm lv-url" id="live-url" spellcheck="false" aria-label="Where the plant listens" title="Where the plant listens: click to type (kept in the External plant block)"></label>
    <div class="lv-stats" id="live-status" role="status" aria-live="polite"></div>
    <p class="note" id="live-mode"></p>
    <details class="lv-set" id="live-settings"><summary class="flabel">Live settings</summary>
      <label class="pf"><span class="flabel">Ramp-in</span><input class="field field-sm" id="live-ramp" aria-label="Ramp-in, % of full scale per second" spellcheck="false" inputmode="decimal"><span class="hint">% of full scale per second: before every loop each reference moves to its first value no faster</span></label>
      <div id="live-scales"></div>
    </details>
    <p class="note">Agents: <code>loopTuner.help()</code></p>`;
  panelHost.prepend(panel);
  const estopKey = $('estop');
  // Every message Live shows is a toast for the person; the page keeps the
  // last one for an agent (state().message, #toast[data-last]), since a
  // toast is gone after 3 s.
  const tell = (msg) => app.toast(msg);

  // ---- The External plant block, at any depth.
  const rootDiagram = () => (app.project.system.plant?.type === 'diagram' ? app.project.system.plant.diagram : null);
  const external = () => findExternal(rootDiagram());
  // Edits it as one undo step, through the Plant tab's path.
  function editExternal(fn) {
    const next = structuredClone(rootDiagram());
    const hit = findExternal(next);
    if (!hit) return false;
    fn(hit.block, hit.level);
    try { app.setPlant(normalizeDiagram(next)); return true; } catch (err) { tell(err.message); return false; }
  }
  // Gives the block the plant's ports (keeping the page's own settings);
  // wires to ports that are gone, or into inputs whose name or kind changed,
  // go, and the Sinks and the scope's channels follow the outputs (core/live.js
  // followPorts), all one undo step. Returns how many wires into inputs went,
  // or false.
  function takePorts(dsc) {
    let dropped = 0, renamed = {};
    app.beginEdit();
    const ok = editExternal((b, lv) => {
      const was = b.params;
      b.params = externalParams(dsc, b.params);
      const into = (ws) => ws.filter((w) => w.to.split(':')[0] === b.id).length;
      const before = into(lv.wires);
      ({ blocks: lv.blocks, wires: lv.wires, renamed } = followPorts(lv, b.id, was, b.params));
      dropped = before - into(lv.wires);
      // The channels on a renamed Sink follow it (setPlant clears those on
      // names that went).
      for (const ch of app.project.scope.channels) if (renamed[ch.source]) ch.source = renamed[ch.source];
    });
    app.endEdit();
    return ok ? dropped : false;
  }
  const wentText = (n) => (n ? `; ${n} wire${n > 1 ? 's' : ''} into inputs that changed went` : '');
  const portText = (dsc) => `in ${dsc.inputs.map((p) => p.name).join(', ') || 'none'}; out ${dsc.outputs.map((p) => p.name).join(', ')}`;
  // The full scales of the signals around the plant, and the references.
  const scalesNow = () => liveScales(rootDiagram());

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
      w.onerror = (e) => { e.preventDefault(); if (!settled) fallback(); else tell(`Live: ${e.message}`); };
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

  // state: idle (never connected), connecting, open (connected, the plant
  // stopped), running, closed (offline after a connection).
  let state = 'idle', detail = '', estop = null, desc = null, link = null, plantStatus = null, programKey = '', ramp = null, hold = null;
  // The plant start or stop the page has asked for and the loop has not
  // answered yet: the keys count it at once (keyLink), so a Stop pressed
  // right after Run (or Run right after Stop) is never lost.
  let pending = null;
  const updates = {};  // how the running loop took edits: { kept, rebuilt, signals }
  const waiters = [];  // connect() promises, settled at open or closed
  const answers = new Map();  // ask() promises, settled by the loop's done
  let asked = 0;
  function receive(m) {
    if (m.type === 'state') onState(m.state, m.detail);
    else if (m.type === 'described') onDescribed(m.desc);
    else if (m.type === 'estop') {
      estop = { by: m.by, reason: m.reason };
      pending = null;
      tell(`E-STOP${m.by === 'plant' ? ' from the plant' : ''}: ${m.reason}. ${/at the plant/.test(m.reason) ? 'Reset it at the plant (its window or console), then Run.' : 'Reset, then Run.'}`);
      screen('stop');
      render();
    } else if (m.type === 'run') onRun(m.by);
    else if (m.type === 'stopped') { tell(`The plant stopped: ${m.reason || `by the ${m.by}`}.`); screen('stop'); render(); }
    else if (m.type === 'refused') { pending = null; screen('stop'); render(); }
    else if (m.type === 'done') { const r = answers.get(m.id); answers.delete(m.id); r?.(m); }
    else if (m.type === 'cleared') tell('The plant was reset at its own key: Run goes on.');
    else if (m.type === 'samples') onSamples(m);
    else if (m.type === 'stats') { link = m.link; plantStatus = m.plant; renderStats(); }
    else if (m.type === 'programmed') {
      updates[m.how] = (updates[m.how] ?? 0) + 1;
      if (m.how === 'rebuilt') tell('The diagram changed: the controllers start afresh.');
    } else if (m.type === 'error') tell(`Live: ${m.message}`);
  }
  // The scope's mode, without going through the plant (it told us already).
  function screen(m, restart = false) {
    if (m === 'stop' && hold) setHold(false);
    if (display.mode === m && !restart) return;
    display.setMode(m, { restart });
    app.runChanged();
  }

  function onState(s, d) {
    const was = state;
    state = s; detail = d;
    // Every state the loop reports is the answer to the last start or stop
    // (an overtaken one reports nothing), or news that overrides it.
    pending = null;
    if (s === 'connecting') { estop = null; desc = null; link = null; plantStatus = null; programKey = ''; ramp = null; }
    if (s === 'running') { estop = null; attach(); }
    if (s === 'open' && d === 'reset') estop = null;
    if (s === 'open' && was === 'running') { ramp = null; if (hold) setHold(false); }
    if (s === 'closed' && was !== 'closed') {
      tell(was === 'connecting' ? `Could not connect: ${d}` : `Disconnected: ${d}`);
      ramp = null;
      screen('stop');
    }
    if (s === 'open' || s === 'closed') settle();
    render();
  }
  function settle() { for (const w of waiters.splice(0)) w(); }

  // The plant says what it is: the block takes its ports (if they differ)
  // and the channels its full scales; the loop gets the diagram. The plant
  // stays stopped: Run starts it.
  function onDescribed(dsc) {
    desc = dsc;
    const hit = external();
    const went = hit && !sameDescription(hit.block.params, desc) ? takePorts(desc) : false;
    if (went !== false) {
      tell(`The External plant block took the plant's ports: ${portText(desc)}${wentText(went)}. Ctrl+Z goes back.`);
      setTimeout(() => app.fullScale?.());
    }
    sendProgram();  // (the edit above may have sent it already)
    render();
  }

  function sendProgram() {
    const d = rootDiagram();
    const key = JSON.stringify([d, app.project.system.signals]);
    if (key === programKey) return;
    programKey = key;
    host.post({ type: 'program', diagram: structuredClone(d), signals: structuredClone(app.project.system.signals) });
  }

  async function connect(url) {
    const hit = external();
    if (!hit) { tell('This system has no External plant block: add one from the Live group in the Plant tab, or load “HIL: an external plant”.'); return api.state(); }
    if (!window.WebSocket) { tell('This browser has no WebSocket.'); return api.state(); }
    if (on()) return api.state();
    if (url && url !== hit.block.params.url && !editExternal((b) => { b.params.url = url; })) return api.state();
    state = 'connecting'; render();
    const done = new Promise((resolve) => { waiters.push(resolve); setTimeout(resolve, 8000); });
    host ??= await openHost();
    host.post({ type: 'connect', url: external().block.params.url });
    await done;
    return api.state();
  }

  // ---- The screen while live: sweeps of the scope's window. A run's time
  // starts when the references have ramped in; the first ramp is a sweep of
  // its own (plant time from the run's start), so it shows on the scope.
  let names = [], sweep = null, done = null, earlier = null, lastT = null, plantT = null, feeding = false, inRamp = false, runT0 = null;
  const empty = { t: new Float64Array(0), signals: {} };
  function windowOf() {
    const tb = app.project.scope.timebase;
    const w0 = Math.max(0, tb.position);
    return [w0, Math.max(tb.position + 10 * tb.scale - w0, 1e-6)];
  }
  // A sweep as the display takes it; plantOffset turns its screen time into
  // the plant's (for Save, ui/record.js).
  const view = (s) => ({ t: s.t.subarray(0, s.n), signals: Object.fromEntries(names.map((nm, j) => [nm, s.cols[j].subarray(0, s.n)])), plantOffset: s.offset });
  // A sweep covers one screen width of run time from sweepStart, drawn at
  // w0 + (t − start): at position w0 the first sweep shows run time
  // w0 … w0 + W, as a simulated run does (core/trace.js).
  function newSweep(t, tp, w0, W) {
    const rate = desc?.rate_hz ?? 100;
    const every = Math.max(1, Math.ceil((W * rate) / MAX_SWEEP));
    const cap = Math.ceil((W * rate) / every) + 2;
    // A finished sweep of the run is done (it ends a Single); one of the
    // first ramp only fades behind.
    if (sweep?.n) { if (sweep.ramp) earlier = view(sweep); else done = view(sweep); }
    const start = sweepStart(t, w0, W);
    sweep = { w0, W, start, ramp: inRamp, offset: tp - (w0 + (t - start)), every, k: 0, n: 0, cap, t: new Float64Array(cap), cols: names.map(() => new Float64Array(cap)) };
  }
  function addSample(t, tp, vals) {
    const [w0, W] = windowOf();
    lastT = t;
    // Before the window's left edge nothing is on the screen, as in a
    // simulated run (the first ramp counts from the left edge).
    if (t < w0 - 1e-9) return;
    if (!sweep || sweep.w0 !== w0 || sweep.W !== W || t < sweep.start - 1e-9 || t - sweep.start >= W - 1e-9) newSweep(t, tp, w0, W);
    const s = sweep;
    if (s.k++ % s.every || s.n >= s.cap) return;
    s.t[s.n] = s.w0 + (t - s.start);
    for (let j = 0; j < names.length; j++) s.cols[j][s.n] = vals[j];
    s.n++;
  }
  // The sweep under way becomes an earlier run (faded), so a change can be
  // compared run against run; the next one starts afresh.
  function cut() { if (sweep?.n) earlier = view(sweep); sweep = null; done = null; lastT = null; }
  // A new run: the plant's clock restarts, the references ramp in first.
  function onRun(by) {
    cut();
    inRamp = false; runT0 = null; ramp = null;
    record.live.run();
    attach();
    if (by === 'plant' && display.mode === 'stop') { screen('run', true); tell('The plant started a run at its own key.'); }
  }
  // What the display draws each frame (Hold: the screen as it was).
  function poll() {
    if (hold) return { data: hold.data, scan: hold.scan, done: null, past: null };
    const out = { data: sweep ? view(sweep) : empty, scan: sweep && lastT !== null ? sweep.w0 + (lastT - sweep.start) : windowOf()[0], done, past: earlier };
    done = null; earlier = null;
    return out;
  }
  function attach() {
    if (feeding) return;
    feeding = true;
    display.clearRuns();
    display.setFeed(poll);
  }
  function detach() {
    if (!feeding) return;
    feeding = false;
    sweep = null; done = null; earlier = null; lastT = null; hold = null;
    display.setFeed(null);
    display.clearRuns();
  }
  function setHold(onOff) {
    const want = onOff ?? !hold;
    if (want && (state !== 'running' || !feeding)) { tell('Hold freezes the screen while the plant runs: Run first.'); return false; }
    hold = want ? { data: sweep ? structuredClone(view(sweep)) : empty, scan: sweep && lastT !== null ? sweep.w0 + (lastT - sweep.start) : windowOf()[0] } : null;
    render();
    return !!hold;
  }

  // The plant's clock against the page's, for the header's achieved speed.
  let clockT = null;
  function onSamples(m) {
    if (m.t.length) {
      const t1 = m.t[m.t.length - 1];
      app.timeRan?.(performance.now() / 1000, clockT !== null && t1 >= clockT ? t1 - clockT : 0);
      clockT = t1;
    }
    if (m.names.join('\n') !== names.join('\n')) { names = m.names; sweep = null; }
    for (let i = 0; i < m.t.length; i++) {
      const rt = m.rt?.[i];
      const first = !Number.isFinite(rt);
      // The first ramp is drawn from the left edge in plant time; when the
      // loop's time starts, it becomes an earlier sweep.
      if (first) { if (!inRamp) { cut(); inRamp = true; runT0 = m.t[i]; } }
      else if (inRamp) { cut(); inRamp = false; }
      addSample(first ? windowOf()[0] + (m.t[i] - runT0) : rt, m.t[i], m.values[i]);
      plantT = m.t[i];
    }
    const was = !!ramp;
    ramp = m.ramp ?? null;
    if (was !== !!ramp) render(); else if (ramp) renderStats();
    record.live.samples(m.names, m.t, m.values, m.units);
  }

  // ---- Keys
  const on = () => ['connecting', 'open', 'running'].includes(state);
  const connected = () => ['open', 'running'].includes(state);
  const linkState = () => (state === 'running' ? 'running' : state === 'open' ? 'open' : state === 'connecting' ? 'connecting' : 'offline');
  const keyLink = () => { const l = linkState(); return pending === 'run' && l === 'open' ? 'running' : pending === 'stop' && l === 'running' ? 'open' : l; };
  // The scope's Run, Stop or Single, through the plant (core/live.js
  // liveKey). Returns { display, plant, why }: why says why a key was
  // refused.
  function key(k) {
    let a = liveKey(k, { link: keyLink(), latched: !!estop, display: display.mode });
    // A Controller wired to an input the plant takes as a reference: Run is
    // refused before anything reaches the plant (the loop refuses it too).
    if (a.plant === 'start') { const why = liveProblem(rootDiagram()); if (why) a = { display: 'stop', restart: false, plant: null, why }; }
    if (a.why) tell(a.why);
    if (a.display !== 'run' && hold) setHold(false);
    if (a.display && (a.display !== display.mode || a.restart)) display.setMode(a.display, { restart: a.restart });
    // The live feed takes the screen at once, so the scope never sweeps on
    // its own while the plant starts.
    if (a.plant === 'start') { pending = 'run'; cut(); attach(); host.post({ type: 'start' }); }
    // Stop always reaches a connected plant, whatever the page believes it
    // is doing (one that started at its own key a moment ago stops too).
    else if ((k === 'stop' || k === 'swept') && connected()) { pending = 'stop'; host.post({ type: 'stop' }); }
    render();
    return { display: a.display, plant: a.plant, why: a.why };
  }
  // A request to the loop, answered once the plant has answered it:
  // resolves the loop's done { error? }.
  function ask(msg, ms = 4000) {
    if (!host) return Promise.resolve({ error: 'not connected' });
    const id = ++asked;
    return new Promise((resolve) => {
      answers.set(id, resolve);
      host.post({ ...msg, id });
      setTimeout(() => { if (answers.delete(id)) resolve({ error: 'no answer from the loop' }); }, ms);
    });
  }
  async function estopNow() {
    if (!connected()) { tell('E-STOP acts on a connected plant; none is connected.'); return api.state(); }
    pending = null;
    await ask({ type: 'estop' });
    return api.state();
  }
  async function resetNow() {
    if (!connected()) { tell('Reset acts on a connected plant; none is connected.'); return api.state(); }
    await ask({ type: 'reset' });
    return api.state();
  }
  async function disconnect() {
    if (!host || !on()) return api.state();
    await ask({ type: 'disconnect' });
    return api.state();
  }

  $('live-connect').addEventListener('click', () => { if (on()) disconnect(); else connect(); });
  $('live-reset').addEventListener('click', resetNow);
  $('live-hold').addEventListener('click', () => setHold());
  estopKey.addEventListener('click', estopNow);
  $('live-download').addEventListener('click', () => downloadPlant());
  const urlEl = $('live-url');
  urlEl.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') urlEl.blur(); if (e.key === 'Escape') { urlEl.value = external()?.block.params.url ?? ''; urlEl.blur(); } });
  urlEl.addEventListener('blur', () => {
    const v = urlEl.value.trim(), hit = external();
    if (hit && v !== hit.block.params.url && !editExternal((b) => { b.params.url = v; })) urlEl.value = hit.block.params.url;
  });

  // ---- Live settings: the ramp-in and the full scales of the references,
  // kept in the External plant block (saved with the system).
  function settings(s) {
    if (!s) { const hit = external(); return hit ? { ramp: hit.block.params.ramp ?? RAMP_DEFAULT, scales: scalesNow().scales } : null; }
    if (!external()) throw new Error('this system has no External plant block');
    editExternal((b) => {
      if (s.ramp !== undefined) b.params.ramp = Number(s.ramp);
      if (s.scales) {
        b.params.scales = { ...(b.params.scales ?? {}) };
        for (const [nm, pair] of Object.entries(s.scales)) { if (pair === null) delete b.params.scales[nm]; else b.params.scales[nm] = pair.map(Number); }
      }
    });
    return settings();
  }
  const rampEl = $('live-ramp');
  rampEl.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') rampEl.blur(); if (e.key === 'Escape') { rampEl.value = ''; rampEl.blur(); } });
  rampEl.addEventListener('blur', () => {
    const hit = external();
    if (!hit) return;
    const v = rampEl.value.trim() === '' ? hit.block.params.ramp : parseSI(rampEl.value.replace('%', ''));
    if (!(v >= 0.01 && v <= 1000)) { tell('A ramp-in from 0.01 to 1000 % of full scale per second.'); renderSettings(true); return; }
    if (v !== hit.block.params.ramp) settings({ ramp: v });
  });
  function renderSettings(force = false) {
    const hit = external();
    if (!hit) return;
    const box = $('live-scales');
    if (!force && panel.contains(document.activeElement) && document.activeElement.matches('#live-settings input')) return;
    rampEl.value = num(hit.block.params.ramp ?? RAMP_DEFAULT, 4);
    const { scales, refs } = scalesNow();
    const own = hit.block.params.scales ?? {};
    box.innerHTML = refs.length ? `<div class="flabel lv-fs">Full scale of the references</div>${refs.map((nm) => {
      const [lo, hi] = scales[nm] ?? ['', ''];
      return `<label class="pf"><span class="flabel">${esc(nm)}</span><span class="lv-fsin"><input class="field field-sm" id="live-scale-${esc(nm)}-lo" data-scale="${esc(nm)}" data-end="0" value="${esc(lo === '' ? '' : num(lo, 5))}" aria-label="Full scale of ${esc(nm)}: low end" spellcheck="false"> … <input class="field field-sm" id="live-scale-${esc(nm)}-hi" data-scale="${esc(nm)}" data-end="1" value="${esc(hi === '' ? '' : num(hi, 5))}" aria-label="Full scale of ${esc(nm)}: high end" spellcheck="false"></span><span class="hint">${own[nm] ? 'set here (empty both: the plant\'s)' : 'from the plant'}</span></label>`;
    }).join('')}` : '<p class="note">No reference feeds the plant.</p>';
    box.querySelectorAll('[data-scale]').forEach((inp) => {
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.dataset.cancel = '1'; inp.blur(); } });
      inp.addEventListener('blur', () => {
        if (inp.dataset.cancel) { delete inp.dataset.cancel; renderSettings(true); return; }
        if (box.contains(document.activeElement) && document.activeElement.dataset.scale === inp.dataset.scale) return;  // the other end is next
        const nm = inp.dataset.scale;
        const lo = box.querySelector(`[data-scale="${nm}"][data-end="0"]`).value.trim(), hi = box.querySelector(`[data-scale="${nm}"][data-end="1"]`).value.trim();
        if (lo === '' && hi === '') { if (own[nm]) settings({ scales: { [nm]: null } }); renderSettings(true); return; }
        const pair = [parseSI(lo), parseSI(hi)];
        if (!(pair[0] < pair[1])) { tell('A full scale is two numbers, low below high (both empty: the plant\'s).'); renderSettings(true); return; }
        const was = scales[nm];
        if (!was || was[0] !== pair[0] || was[1] !== pair[1]) settings({ scales: { [nm]: pair } });
      });
    });
  }

  // ---- The plant's download: a zip with runme scripts that install what it
  // needs; through the page's one download path.
  async function downloadPlant() {
    const ok = await app.download(ZIP_NAME, new Blob([plantZip()], { type: 'application/zip' }), 'application/zip',
      'loopTuner.live.plantFiles() has its files as text; or Copy HTML, save it as a .html file and open that in a browser, which can save the zip');
    if (ok) tell(`Saved ${ZIP_NAME}: unzip it, run runme.sh (Linux, macOS) or double-click runme.cmd (Windows), then Connect. Help (?), Live, has the details.`);
    return ok;
  }

  // ---- Rendering: the panel, the header's E-STOP, the shell's data-*.
  const modeOf = () => { const hit = external(); return hit ? blockMode(hit.block.params) : null; };
  function modeText() {
    const hit = external();
    if (!hit) return '';
    const p = hit.block.params, m = blockMode(p);
    const by = (kind) => p.inputs.filter((_, i) => (p.kinds?.[i] ?? 'effort') === kind);
    if (m === 'log') return '<b>The plant only reports</b>: it takes no inputs; the page records what it sends.';
    if (m === 'reference') return `<b>Reference mode</b>: the plant runs its own controller; the page sends ${esc([...by('reference'), ...by('disturbance')].join(', '))} and records what comes back. The page's controllers and Auto-tune are <b>not in the loop</b>.`;
    const extra = by('disturbance');
    return `<b>Control mode</b>: the page is the controller and sends ${esc(by('effort').join(', ') || 'u')}${extra.length ? ` (and ${esc(extra.join(', '))})` : ''} every cycle; r and e go along for the plant's log.`;
  }
  function render() {
    const hit = external();
    const shell = $('lt-shell');
    panel.hidden = !hit;
    estopKey.hidden = !hit;
    shell.dataset.live = !hit ? 'none' : estop ? 'estop' : linkState();
    if (hit) shell.dataset.hilMode = modeOf(); else delete shell.dataset.hilMode;
    shell.dataset.run = display.mode;
    display.renderStatus();
    app.speedRender?.();  // held at 1× while connected
    if (!hit) return;
    const k = $('live-connect');
    k.textContent = on() ? 'Disconnect' : 'Connect';
    k.setAttribute('aria-label', on() ? 'Disconnect from the external plant' : 'Connect to the external plant');
    // Lamps: Connect green while the plant runs, amber while it is connected
    // and waits; the header's E-STOP red while latched.
    lamp(k, state === 'running' ? 'ok' : on() ? 'warn' : null);
    $('live-reset').disabled = !(estop && connected());
    const hk = $('live-hold');
    hk.disabled = state !== 'running';
    hk.setAttribute('aria-pressed', String(!!hold));
    estopKey.disabled = !connected();
    lamp(estopKey, estop ? 'bad' : null);
    estopKey.dataset.state = estop ? 'latched' : connected() ? 'armed' : 'off';
    estopKey.title = estop ? `E-STOP latched: ${estop.reason}. Reset in the Plant tab's Live panel.` : connected() ? 'Emergency stop: the plant applies its safe inputs until Reset (E)' : 'Emergency stop (E): acts once the plant is connected';
    panel.dataset.state = shell.dataset.live;
    panel.dataset.mode = modeOf();
    if (document.activeElement !== urlEl) urlEl.value = hit.block.params.url;
    urlEl.disabled = on();
    $('live-mode').innerHTML = modeText();
    renderSettings();
    renderStats();
  }
  // Under the keys, two lines: the state, or an E-stop and its cause, or,
  // while running, what the link does.
  function renderStats() {
    const el = $('live-status');
    if (!el) return;
    const running = state === 'running' && !estop;
    el.title = '';
    const lines = (...ls) => { el.innerHTML = ls.map((l) => `<div>${l}</div>`).join(''); };
    el.dataset.state = estop ? 'estop' : linkState();
    for (const k of ['rate', 'rtt', 'missed', 'late']) delete el.dataset[k];
    if (estop) {
      lines(`<span class="text-bad">E-STOP: ${esc(estop.reason)}</span>`, `${estop.by === 'plant' ? 'by the plant · ' : ''}safe inputs until ${connected() ? 'Reset' : 'Connect, Reset'}`);
      el.title = `E-STOP: ${estop.reason}`;
      el.dataset.reason = estop.reason;
      return;
    }
    delete el.dataset.reason;
    if (!running) {
      lines(esc({
        idle: 'not connected · start the plant, then Connect',
        connecting: 'connecting…',
        open: detail === 'stopped' || detail === 'stopped at the plant' ? 'stopped · Run starts it again' : `connected${desc ? `: ${desc.name}` : ''} · Run starts it`,
        running: 'running',
        closed: `not connected${detail ? `: ${detail}` : ''}`,
      }[state]));
      el.title = detail;
      return;
    }
    const p = plantStatus;
    const ramping = ramp ? `ramping to r0: ${ramp.left.toFixed(1)} s left` : null;
    if (!link) { lines('<span class="text-ok">●</span> running', ramping ?? 'waiting for the first figures'); return; }
    el.dataset.rate = link.rate.toFixed(1);
    el.dataset.missed = String(link.missed);
    if (p?.rtt_ms?.mean !== undefined && p.rtt_ms.mean !== null) el.dataset.rtt = String(p.rtt_ms.mean);
    if (p?.late !== undefined) el.dataset.late = String(p.late);
    lines(`<span class="text-ok">●</span> ${link.rate.toFixed(1)} Hz · jitter ${ms(link.jitter)} · ${host.kind === 'worker' ? 'worker' : 'page'}`, ramping ?? `round trip ${ms(p?.rtt_ms?.mean)} · missed ${link.missed} · late ${p?.late ?? '–'}`);
    el.title = `Page: arrivals deviate up to ${ms(link.jitter)} from the cycle; ${ms(link.compute)} per cycle (at most ${ms(link.computeMax)}) to answer.\n`
      + (p ? `Plant: ${p.rate_hz} Hz, cycle start late by ${ms(p.jitter_ms?.mean)} on average (at most ${ms(p.jitter_ms?.max)}); round trip ${ms(p.rtt_ms?.mean)} (at most ${ms(p.rtt_ms?.max)}); ${p.late} cycles without a new u, ${p.overruns} skipped, ${p.dropped} y dropped.` : '');
  }

  // E-STOP from anywhere: the key E (not while typing).
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.target.closest?.('input, select, textarea')) return;
    const k = e.key.toLowerCase();
    if (k === 'e' && external()) { e.preventDefault(); e.stopImmediatePropagation(); estopNow(); }
    else if (k === 'h' && external() && state === 'running') { e.preventDefault(); e.stopImmediatePropagation(); setHold(); }
  }, true);

  const api = {
    worker: true,  // false: run the loop on the page (to compare)
    connect: (url) => connect(url),
    disconnect: () => disconnect(),
    estop: () => estopNow(),
    reset: () => resetNow(),
    hold: (onOff) => setHold(onOff),
    settings: (s) => settings(s),
    downloadPlant: () => downloadPlant(),
    plantFiles: () => plantFiles(),
    state: () => ({
      state: linkState(), detail, pending, message: app.lastMessage(), run: display.mode, estop, hold: !!hold, mode: modeOf(),
      plant: desc ? { name: desc.name, rate_hz: desc.rate_hz, mode: desc.mode, inputs: desc.inputs, outputs: desc.outputs } : null,
      ramp: ramp ? { left: ramp.left, to: ramp.to } : null,
      where: host?.kind ?? null, link, status: plantStatus, t: plantT, updates: { ...updates },
    }),
  };

  return {
    api,
    // Whether the scope's keys go through the plant: a system with an
    // External plant.
    owns: () => !!external(),
    running: () => state === 'running',
    key,
    // A Single's sweep ended: the plant stops.
    swept() { if (external()) key('swept'); },
    // The full scales of the signals around the plant ({ name: [lo, hi] }), or null.
    scales: () => (external() ? scalesNow().scales : null),
    // After every change of the project: the panel follows, a running loop
    // gets the new diagram (it takes parameters at the next cycle), and a
    // system without an External plant leaves Live. While connected the block
    // keeps the plant's ports, which the values follow by position.
    changed() {
      render();
      const hit = external();
      if (!hit && feeding) detach();
      if (!host || !on()) return;
      if (!hit) { tell('This system has no External plant block: Live disconnected.'); disconnect(); return; }
      if (!desc) return;
      if (!samePorts(hit.block.params, desc)) {
        // (after the toast of whatever caused it, such as Undo)
        const went = takePorts(desc);
        if (went !== false) setTimeout(() => tell(`While connected, the External plant block keeps the plant's ports (${portText(desc)})${wentText(went)}; Disconnect to change them.`));
        return;
      }
      sendProgram();
    },
    // Why the speed is held at 1×: connected, the plant owns the clock.
    lockReason: () => (connected() ? 'Live: the external plant owns the clock, so time runs at 1×. Disconnect to change the speed.' : null),
    // The live sweep on the screen (for views and Auto Scale), or null.
    data: () => (feeding ? (hold ? hold.data : sweep ? view(sweep) : null) : null),
    // The scope's status line: the live state, and the ramp-in.
    tag() {
      if (!external()) return null;
      if (estop) return { lamp: 'bad', text: 'E-STOP', note: estop.reason, state: 'estop' };
      if (state === 'running') {
        if (hold) return { lamp: 'warn', outline: true, text: 'Hold', note: `screen held · the plant runs on · H releases`, state: 'running' };
        if (ramp) return { lamp: 'ok', outline: true, text: 'Live', note: `ramping to r0: ${ramp.left.toFixed(1)} s left`, state: 'running', ramp: true };
        return { lamp: 'ok', outline: true, text: 'Live', note: `plant t ${plantT === null ? '–' : plantT.toFixed(2)} s`, state: 'running' };
      }
      if (state === 'open') return { lamp: 'warn', outline: true, text: 'Connected', note: 'stopped · Run starts the plant', state: 'open' };
      if (on()) return { lamp: 'warn', outline: true, text: 'Connecting', state: 'connecting' };
      return { outline: true, text: 'Offline', note: feeding ? 'the last live sweeps · Plant tab: Connect' : 'external plant not connected · Plant tab: Connect, then Run', state: 'offline' };
    },
  };
}
