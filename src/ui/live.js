// Live (HIL) mode, a second row of Run Control: a system with an External
// plant block runs against a plant outside the page (hil_plant.py, or
// hardware behind the same protocol). The loop (core/live.js) runs in a Web
// Worker made from this page's own script, so drawing never delays an answer;
// where workers are blocked it runs here.
//
// The scope's Run and Stop go through the plant (the person, 2026-10-24): Run
// starts a fresh run (the plant's clock and the controllers from 0), Stop
// stops it (safe inputs), Single runs one screen and stops. E-STOP and Reset
// are their own keys. Live samples sweep the screen like a simulated run and
// go to the live record (ui/record.js). See design/output/hil.md.

import { HIL_URL, externalParams, sameDescription, samePorts, findExternal } from '../core/hil.js';
import { createLiveLoop } from '../core/live.js';
import { normalizeDiagram, parseEnd } from '../core/diagram.js';
import { sweepStart } from '../core/trace.js';
import { zipFiles } from '../core/zip.js';
import { fitChannel } from '../core/project.js';

const MAX_SWEEP = 200000;
// The plant's files (hil/), put into the bundle by build.mjs.
const HIL_FILES = typeof __HIL_FILES === 'object' ? __HIL_FILES : {};
const PLANT_PY = HIL_FILES['hil_plant.py'] ?? '';
const RUN_PY = 'uv run hil_plant.py';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ms = (v) => (Number.isFinite(v) ? `${v < 10 ? v.toFixed(2) : v.toFixed(1)} ms` : '–');

export function createLive(app, display, controlsRoot, record) {
  const framed = window.self !== window.top;

  // ---- Controls: the same keys as Run Control, then two lines that keep
  // their height: where the plant is and the state, or what the link does.
  const liveEl = document.createElement('div');
  liveEl.className = 'lv';
  liveEl.setAttribute('aria-label', 'Live: the external plant');
  liveEl.innerHTML = `
    <div class="row">
      <button class="key" id="lv-connect" title="Connect to the external plant; Run and Stop then start and stop it">Connect</button>
      <button class="key estop" id="lv-estop" title="Emergency stop: the plant applies its safe inputs until Reset">E-STOP</button>
      <button class="key" id="lv-reset" title="Clear the E-stop and go on, the controllers afresh">Reset</button>
    </div>
    <div class="lv-line" id="lv-where"><input class="lv-url" id="lv-url" spellcheck="false" aria-label="Where the plant listens" title="Where the plant listens: click to type (kept in the External plant block)"><button class="lv-link" id="lv-script" title="The external plant of HIL: external motor, a Python script for your computer">plant script…</button></div>
    <div class="lv-stats" id="lv-stats" aria-live="polite"></div>`;
  controlsRoot.querySelector('.group').append(liveEl);
  const $ = (id) => document.getElementById(id);

  // ---- The External plant block, at any depth.
  const rootDiagram = () => (app.project.system.plant?.type === 'diagram' ? app.project.system.plant.diagram : null);
  const external = () => findExternal(rootDiagram());
  // Edits it as one undo step, through the Plant tab's path.
  function editExternal(fn) {
    const next = structuredClone(rootDiagram());
    const hit = findExternal(next);
    if (!hit) return false;
    fn(hit.block, hit.level);
    try { app.setPlant(normalizeDiagram(next)); return true; } catch (err) { app.toast(err.message); return false; }
  }
  // Gives the block the plant's ports; wires to ports that are gone go.
  function takePorts(dsc) {
    return editExternal((b, lv) => {
      b.params = externalParams(dsc, b.params.url);
      const nIn = b.params.inputs.length, nOut = b.params.outputs.length;
      lv.wires = lv.wires.filter((w) => { const f = parseEnd(w.from), t = parseEnd(w.to); return !(t.id === b.id && t.port >= nIn) && !(f.id === b.id && f.port >= nOut); });
    });
  }
  const portText = (dsc) => `in ${dsc.inputs.map((p) => p.name).join(', ')}; out ${dsc.outputs.map((p) => p.name).join(', ')}`;

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
    else if (m.type === 'estop') { estop = { by: m.by, reason: m.reason }; app.toast(`E-STOP${m.by === 'plant' ? ' from the plant' : ''}: ${m.reason}. Reset goes on.`); render(); }
    else if (m.type === 'run') onRun();
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
    if (s === 'connecting') { estop = null; desc = null; link = null; plantStatus = null; programKey = ''; }
    if (s === 'running') { estop = null; attach(); }
    if (s === 'open' && d === 'reset') estop = null;  // Reset with the scope stopped: cleared, not started
    if (s === 'closed' && was !== 'closed') {
      app.toast(was === 'connecting' ? `Could not connect: ${d}` : `Disconnected: ${d}`);
      // The screen holds the last sweeps; Run goes back to the simulation.
      if (feeding && display.mode !== 'stop') app.setMode('stop');
    }
    render();
  }

  // The plant says what it is: the block takes its ports (if they differ),
  // the loop gets the diagram, and the plant starts if the scope runs.
  function onDescribed(dsc) {
    desc = dsc;
    const hit = external();
    if (hit && !sameDescription(hit.block.params, desc) && takePorts(desc)) app.toast(`The External plant block took the plant's ports: ${portText(desc)}. Ctrl+Z goes back.`);
    sendProgram();  // (the edit above may have sent it already)
    if (!desc.estop && display.mode !== 'stop') host.post({ type: 'start' });
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
    if (!hit) { app.toast('This system has no External plant block: add one from the Live group in the Plant tab, or load “HIL: external motor”.'); return; }
    if (!window.WebSocket) { app.toast('This browser has no WebSocket.'); return; }
    if (url && url !== hit.block.params.url && !editExternal((b) => { b.params.url = url; })) return;
    state = 'connecting'; render();
    host ??= await openHost();
    host.post({ type: 'connect', url: external().block.params.url });
  }

  // ---- The screen while live: sweeps of the scope's window, each one run.
  let names = [], sweep = null, done = null, earlier = null, lastT = null, feeding = false;
  const empty = { t: new Float64Array(0), signals: {} };
  function windowOf() {
    const tb = app.project.scope.timebase;
    const w0 = Math.max(0, tb.position);
    return [w0, Math.max(tb.position + 10 * tb.scale - w0, 1e-6)];
  }
  // A sweep as the display takes it; plantOffset turns its screen time into
  // the plant's (for Save, ui/record.js).
  const view = (s) => ({ t: s.t.subarray(0, s.n), signals: Object.fromEntries(names.map((nm, j) => [nm, s.cols[j].subarray(0, s.n)])), plantOffset: s.start - s.w0 });
  // A sweep covers one screen width of plant time from sweepStart, drawn at
  // w0 + (t − start): at position w0 the first sweep shows plant time
  // w0 … w0 + W, as a simulated run does (core/trace.js).
  function newSweep(t, w0, W) {
    const rate = desc?.rate_hz ?? 100;
    const every = Math.max(1, Math.ceil((W * rate) / MAX_SWEEP));
    const cap = Math.ceil((W * rate) / every) + 2;
    if (sweep?.n) done = view(sweep);
    sweep = { w0, W, start: sweepStart(t, w0, W), every, k: 0, n: 0, cap, t: new Float64Array(cap), cols: names.map(() => new Float64Array(cap)) };
  }
  function addSample(t, vals) {
    const [w0, W] = windowOf();
    lastT = t;
    // Before the window's left edge (the start of a run at a position > 0)
    // nothing is on the screen, as in a simulated run.
    if (t < w0 - 1e-9) return;
    if (!sweep || sweep.w0 !== w0 || sweep.W !== W || t < sweep.start - 1e-9 || t - sweep.start >= W - 1e-9) newSweep(t, w0, W);
    const s = sweep;
    if (s.k++ % s.every || s.n >= s.cap) return;
    s.t[s.n] = s.w0 + (t - s.start);
    for (let j = 0; j < names.length; j++) s.cols[j][s.n] = vals[j];
    s.n++;
  }
  // A new run: the plant's clock restarts. The sweep under way becomes an
  // earlier run (faded), so a change can be compared run against run.
  function onRun() {
    if (sweep?.n) earlier = view(sweep);
    sweep = null; done = null; lastT = null;
    record.live.run();
    attach();
  }
  // What the display draws each frame.
  function poll() {
    const out = { data: sweep ? view(sweep) : empty, scan: sweep && lastT !== null ? sweep.w0 + (lastT - sweep.start) : windowOf()[0], done, past: earlier };
    if (done && fitPending !== null) { const d = done, was = fitPending; fitPending = null; setTimeout(() => fitTo(d, was)); }
    done = null; earlier = null;
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
  }
  function detach() {
    if (!feeding) return;
    feeding = false;
    sweep = null; done = null; earlier = null; lastT = null;
    display.setFeed(null);
    display.clearRuns();
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
    for (let i = 0; i < m.t.length; i++) addSample(m.t[i], m.values[i]);
    record.live.samples(m.names, m.t, m.values);
  }

  // ---- The plant: a zip with runme scripts that install what it needs (the
  // person, 2026-10-24), or the script alone; copy where files cannot leave.
  const plantZip = () => new Blob([zipFiles(Object.entries(HIL_FILES).map(([name, data]) => ({ name: `hil-plant/${name}`, data, mode: name.endsWith('.sh') ? 0o755 : 0o644 })))], { type: 'application/zip' });
  const dlg = document.createElement('div');
  dlg.className = 'overlay';
  dlg.hidden = true;
  dlg.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="lv-dlg-title">
    <h2 id="lv-dlg-title">The external plant</h2>
    <p><code>hil_plant.py</code> is a DC motor swinging an unbalanced arm, simulated in real time at 100 Hz on your computer: the plant of <b>HIL: external motor</b>. It listens on <code>${HIL_URL}</code>, sends its outputs every cycle and applies the inputs this page sends back. The scope's Run and Stop start and stop it. If it hears nothing for 10 cycles it stops the motor (E-stop) until you press Reset; Enter in its window stops it too.</p>
    <p><b>hil-plant.zip</b> holds it with two scripts that install what it needs (uv, which brings Python and the websockets package) and start it:</p>
    <pre>sh runme.sh      Linux, macOS
runme.ps1        Windows: right-click › Run with PowerShell</pre>
    <p>With uv already there: <code>${RUN_PY}</code>. With Python: <code>pip install websockets</code>, then <code>python3 hil_plant.py</code>. <code>--help</code> lists its options (port, rate, watchdog, and how far its plant varies from nominal: up to ±15 %, unknown to this page).</p>
    <p class="dim" id="lv-dlg-note"></p>
    <p class="lv-btns"><button class="key primary" id="lv-dl-zip">Download hil-plant.zip</button><button class="key" id="lv-dl">Download hil_plant.py</button><button class="key" id="lv-copy-py">Copy the script</button><button class="key" id="lv-close">Close</button></p>
  </div>`;
  document.getElementById('lt-shell').append(dlg);
  const closeDlg = () => { dlg.hidden = true; };
  $('lv-script').addEventListener('click', () => {
    // Files leave through app.download; the claude.ai viewer takes a zip, not a .py.
    const can = app.canDownload();
    $('lv-dl-zip').hidden = !can;
    $('lv-dl').hidden = !can || framed;
    $('lv-dlg-note').textContent = framed ? 'This viewer may not let the page connect to your computer: use Copy HTML, save it as a file and open that in your browser to go live.'
      : 'To put real hardware behind Loop Tuner, keep the script\'s server, cycle and watchdog and replace its Motor with your device; any language that speaks the protocol works.';
    dlg.hidden = false;
    ($('lv-dl-zip').hidden ? $('lv-copy-py') : $('lv-dl-zip')).focus();
  });
  $('lv-close').addEventListener('click', closeDlg);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) closeDlg(); });
  dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeDlg(); } });
  $('lv-dl-zip').addEventListener('click', async () => { if (await app.download('hil-plant.zip', plantZip(), 'application/zip')) app.toast('Saved hil-plant.zip: unzip it and run runme.sh (Linux, macOS) or runme.ps1 (Windows).'); });
  $('lv-dl').addEventListener('click', async () => { if (await app.download('hil_plant.py', PLANT_PY, 'text/x-python')) app.toast(`Saved hil_plant.py. Run it with: ${RUN_PY}`); });
  $('lv-copy-py').addEventListener('click', () => app.copy(PLANT_PY, 'hil_plant.py'));

  // ---- Live controls
  const on = () => ['connecting', 'open', 'running'].includes(state);
  const connected = () => ['open', 'running'].includes(state);
  $('lv-connect').addEventListener('click', () => { if (on()) host?.post({ type: 'disconnect' }); else connect(); });
  $('lv-estop').addEventListener('click', () => { if (connected()) host.post({ type: 'estop' }); });
  $('lv-reset').addEventListener('click', () => { if (connected()) host.post({ type: 'reset', start: display.mode !== 'stop' }); });
  const urlEl = $('lv-url');
  urlEl.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') urlEl.blur(); if (e.key === 'Escape') { urlEl.value = external()?.block.params.url ?? ''; urlEl.blur(); } });
  urlEl.addEventListener('blur', () => {
    const v = urlEl.value.trim(), hit = external();
    if (hit && v !== hit.block.params.url && !editExternal((b) => { b.params.url = v; })) urlEl.value = hit.block.params.url;
  });

  function render() {
    const hit = external();
    liveEl.hidden = !hit;
    display.renderStatus();
    app.speedRender?.();  // held at 1× while connected
    if (!hit) return;
    const k = $('lv-connect');
    k.textContent = on() ? 'Disconnect' : 'Connect';
    k.className = `key ${state === 'running' ? 'lit-green' : on() ? 'lit-amber' : ''}`;
    $('lv-estop').className = `key estop ${estop ? 'lit-red' : ''}`;
    $('lv-estop').disabled = !connected();
    $('lv-reset').disabled = !(estop && connected());
    if (document.activeElement !== urlEl) urlEl.value = hit.block.params.url;
    urlEl.disabled = on();
    renderStats();
  }
  // Under the keys, always two lines: the address and the state; or an
  // E-stop and its cause; or, while running, what the link does.
  function renderStats() {
    const el = $('lv-stats');
    const running = state === 'running' && link && !estop;
    $('lv-where').hidden = running || !!estop;
    el.title = '';
    const lines = (...ls) => { el.innerHTML = ls.map((l) => `<div>${l}</div>`).join(''); };
    if (estop) {
      lines(`<span class="bad">E-STOP: ${esc(estop.reason)}</span>`, `${estop.by === 'plant' ? 'by the plant · safe' : 'safe inputs'} until ${connected() ? 'Reset' : 'Connect, Reset'}`);
      el.title = `E-STOP: ${estop.reason}`;
      return;
    }
    if (!running) {
      lines(esc({
        idle: 'start the plant, then Connect',
        connecting: 'connecting…',
        open: detail === 'stopped' ? 'stopped · Run starts it again' : 'connected · Run starts the plant',
        running: 'running',
        closed: `not connected${detail ? `: ${detail}` : ''}`,
      }[state]));
      el.title = detail;
      return;
    }
    const p = plantStatus;
    lines(`<span class="ok">●</span> ${link.rate.toFixed(1)} Hz · jitter ${ms(link.jitter)} · ${host.kind === 'worker' ? 'worker' : 'page'}`, `round trip ${ms(p?.rtt_ms?.mean)} · missed ${link.missed} · late ${p?.late ?? '–'}`);
    el.title = `Page: arrivals deviate up to ${ms(link.jitter)} from the cycle; ${ms(link.compute)} per cycle (at most ${ms(link.computeMax)}) to answer.\n`
      + (p ? `Plant: ${p.rate_hz} Hz, cycle start late by ${ms(p.jitter_ms?.mean)} on average (at most ${ms(p.jitter_ms?.max)}); round trip ${ms(p.rtt_ms?.mean)} (at most ${ms(p.rtt_ms?.max)}); ${p.late} cycles without a new u, ${p.overruns} skipped, ${p.dropped} y dropped.` : '');
  }

  const api = {
    worker: true,  // false: run the loop on the page (to compare)
    connect: (url) => connect(url),
    disconnect: () => host?.post({ type: 'disconnect' }),
    estop: () => { if (connected()) host.post({ type: 'estop' }); },
    reset: () => { if (connected()) host.post({ type: 'reset', start: display.mode !== 'stop' }); },
    state: () => ({ state, detail, run: display.mode, estop, plant: desc ? { name: desc.name, rate_hz: desc.rate_hz, inputs: desc.inputs, outputs: desc.outputs } : null, where: host?.kind ?? null, link, status: plantStatus, t: lastT, updates: { ...updates } }),
  };

  return {
    api,
    // The scope's Run, Stop or Single (app.setMode), and the end of a Single.
    // Offline, Run leaves the last live sweeps for the simulation.
    mode(m) {
      if (!connected()) { if (m !== 'stop' && feeding && !on()) detach(); return; }
      if (m === 'stop') { if (state === 'running') host.post({ type: 'stop' }); return; }
      if (estop) { app.toast('E-STOP is latched: Reset goes on.'); return; }
      if (m === 'single' || state !== 'running') host.post({ type: 'start' });  // a fresh run from t = 0
    },
    // After every change of the project: the panel follows, a running loop
    // gets the new diagram (it takes parameters at the next cycle), and a
    // system without an External plant leaves Live. While connected the block
    // keeps the plant's ports, which the values follow by position.
    changed() {
      render();
      const hit = external();
      if (!hit && feeding) detach();
      if (!host || !on()) return;
      if (!hit) { app.toast('This system has no External plant block: Live disconnected.'); host.post({ type: 'disconnect' }); return; }
      if (!desc) return;
      if (!samePorts(hit.block.params, desc)) {
        // (after the toast of whatever caused it, such as Undo)
        if (takePorts(desc)) setTimeout(() => app.toast(`While connected, the External plant block keeps the plant's ports (${portText(desc)}); Disconnect to change them.`));
        return;
      }
      sendProgram();
    },
    // Why the speed is held at 1×: connected, the plant owns the clock.
    lockReason: () => (connected() ? 'Live: the external plant owns the clock, so time runs at 1×. Disconnect to change the speed.' : null),
    // The live sweep on the screen (for views and Auto Scale), or null.
    data: () => (feeding && sweep ? view(sweep) : null),
    tag() {
      if (!external()) return null;
      if (estop) return { cls: 'st-estop', text: 'E-STOP', note: estop.reason };
      if (state === 'running') return { cls: 'st-live', text: 'Live', note: `plant t ${lastT === null ? '–' : lastT.toFixed(2)} s` };
      if (state === 'open') return { cls: 'st-wait', text: 'Connected', note: 'Run starts the plant' };
      if (on()) return { cls: 'st-wait', text: 'Connecting' };
      return { cls: 'st-offline', text: 'Offline', note: feeding ? 'the last live sweeps · Connect to go on' : 'external plant not connected: it reads 0 · Connect' };
    },
  };
}
