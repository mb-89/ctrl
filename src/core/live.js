// Live (HIL) mode, the loop: a diagram stepped one plant cycle at a time
// against an external plant (createLiveRunner), and the connection that feeds
// it (createLiveLoop), which runs in a Web Worker so that drawing never delays
// an answer, or on the page if workers are blocked. No DOM. See
// design/output/hil.md.
//
// Each cycle the plant sends y (seq, t). The runner sets the External plant
// block's outputs to y, advances the rest of the diagram to t (Sources play
// their waveform in loop time after the ramp-in, core/ramp.js; Controller
// blocks sample on their own Ts), and reads the block's inputs: that is the u
// sent back, at once, with the same seq (and, in control mode, r and e for
// the plant's log).

import { compileDiagram, normalizeDiagram, diagramNames } from './diagram.js';
import { referenceFn } from './signals.js';
import { createRampIn } from './ramp.js';
import { HIL_PROTOCOL, WATCHDOG_CYCLES, rpcRequest, uMessage, startParams, parseMessage, checkDescription, pageWatchdog, createLinkStats, fullScales, blockMode } from './hil.js';

// What a running loop cannot take over in place: everything but block
// positions, the names and parameters of controller and observer variants
// (their laws read the parameters at every sample: controllers.js), and the
// External block's ramp-in and full scales (they count from the next Run).
const SAMPLED = ['controller', 'observer'];
function structureKey(diagram) {
  return JSON.stringify(diagram, function (k, v) {
    if ((k === 'x' || k === 'y') && typeof v === 'number' && this.id !== undefined) return undefined;
    if (k === 'variants' && SAMPLED.includes(this.type) && Array.isArray(v)) return v.map((x) => x.type);
    if (k === 'params' && this.type === 'external' && v) { const { ramp, scales, ...rest } = v; void ramp; void scales; return rest; }
    return v;
  });
}

// Copies the running variants' parameters into the ones the laws hold, so the
// next sample uses them and the blocks keep their state (integral, filters,
// estimates).
function copyParams(own, next) {
  own.blocks.forEach((b, i) => {
    const n = next.blocks[i];
    if (SAMPLED.includes(b.type)) Object.assign(b.variants[b.variant].params, n.variants[n.variant].params);
    if (b.type === 'subsystem') copyParams(b.diagram, n.diagram);
  });
}

// diagram: a normalised plant diagram with one External plant block.
// signals: the project's named signals (the Sources play them).
export function createLiveRunner(diagram, signals) {
  const fns = {};
  let own, key, el, ext, keep, X, Xt, k1, k2, k3, k4, tPrev, h, links, ramp = null, started = false, log = [], period = Infinity;
  let sigs = {};

  function setSignals(next) {
    sigs = next ?? {};
    for (const name of Object.keys(fns)) delete fns[name];
    for (const [name, ref] of Object.entries(sigs)) fns[name] = referenceFn(ref, { sampleTime: h ?? 0.01 });
  }
  // A Source's waveform in loop time; looked up when called, so an edit of
  // the signal takes effect at once.
  const wave = (name) => (tau) => (fns[name] ? fns[name](tau) : 0);
  // The runner's own copy, in normal form (a project restored by Undo has
  // its open limits as null), so the laws hold its parameter objects.
  function build(d) {
    own = normalizeDiagram(structuredClone(d));
    key = structureKey(own);
    // Before the run's first cycle the Sources read their first value; then
    // the ramp-in plays them.
    const sources = new Proxy({}, { get: (_, name) => (t) => (started && ramp ? ramp.value(name, t) : wave(name)(0)) });
    el = compileDiagram(own, 'plant', { standalone: true, sources });
    // The scope's signals: Sources and Sinks. (Auto-tune's "ctrl.u" probes
    // have a dot in their name and stay out, as on the scope.)
    keep = el.probes().flatMap(([n], i) => (n.includes('.') ? [] : [i]));
    if (el.externals.length !== 1) throw new Error(el.externals.length ? 'one External plant per system, for now' : 'this system has no External plant block: add one from the Live group in the Plant tab');
    ext = el.externals[0];
    links = el.links();
    // Continuous blocks on the page integrate between cycles, in steps no
    // longer than their dynamics allow.
    const dt = 1 / ext.params.rate;
    const m = Math.max(1, Math.ceil(dt / (el.bound > 0 ? Math.min(0.5 / el.bound, el.minTs) : Math.min(dt, el.minTs)) - 1e-9));
    h = dt / m;
    el.setStep(h);
    X = new Float64Array(el.n); Xt = new Float64Array(el.n);
    k1 = new Float64Array(el.n); k2 = new Float64Array(el.n); k3 = new Float64Array(el.n); k4 = new Float64Array(el.n);
    el.init(X, 0);
    tPrev = null;
    started = false;
    // In control mode each u carries r and e of the Controller blocks, for
    // the plant's log (in the unit of what they measure).
    const units = diagramNames(own).units;
    const ctrls = blockMode(ext.params) === 'control' ? links.ctrls : [];
    log = ctrls.flatMap((c) => {
      const unit = c.measured !== undefined ? ext.params.outUnits[c.measured] : units[c.source] ?? '1';
      const pre = ctrls.length > 1 ? `${c.key.replace(/\//g, '_')}_` : '';
      return [{ name: `${pre}r`, unit, probe: `${c.key}.r` }, { name: `${pre}e`, unit, probe: [`${c.key}.r`, `${c.key}.y`] }];
    });
  }
  // Every Source the diagram plays gets a ramp-in, with its full scale.
  function makeRamp() {
    const played = diagramNames(own).sources.filter((n) => sigs[n]);
    period = Math.max(...played.map((n) => sigs[n].period), 0) || Infinity;
    const fs = fullScales(ext.params, links);
    ramp = createRampIn({ refs: played.map((name) => ({ name, fn: wave(name), fs: fs[name] ? fs[name][1] - fs[name][0] : null })), period, rate: ext.params.ramp / 100 });
    return played;
  }
  // Sources are looked up when called, so signals change without a rebuild;
  // probes() lists them only for the names the diagram actually plays.
  setSignals(signals);
  build(diagram);
  const names = () => { const all = el.probes(); return keep.map((i) => all[i][0]); };
  const probe = (all, name) => { for (const [n, v] of all) if (n === name) return v; return NaN; };

  // The run's first cycle: where each reference is now. A reference on a
  // Controller's r is where the measurement it is compared with is; one wired
  // to a plant input is at the input's safe value (a stopped plant applies
  // it), or, for a reference input that names its measurement, there.
  function present(y) {
    const out = {};
    const all = el.probes();
    for (const [name, at] of Object.entries(links.sources)) {
      if (at.ctrl !== undefined) {
        const v = probe(all, `${at.ctrl}.y`);
        if (Number.isFinite(v)) out[name] = v;
      } else if (at.input !== undefined) {
        const j = ext.params.outputs.indexOf(ext.params.measures?.[at.input] ?? '');
        out[name] = ext.params.kinds?.[at.input] === 'reference' && j >= 0 && Number.isFinite(y[j]) ? y[j] : ext.params.safe[at.input];
      }
    }
    return out;
  }

  function rk4(t, dt) {
    const N = el.n;
    el.eval(t, X, 0, 0, k1);
    for (let i = 0; i < N; i++) Xt[i] = X[i] + 0.5 * dt * k1[i];
    el.eval(t + 0.5 * dt, Xt, 0, 0, k2);
    for (let i = 0; i < N; i++) Xt[i] = X[i] + 0.5 * dt * k2[i];
    el.eval(t + 0.5 * dt, Xt, 0, 0, k3);
    for (let i = 0; i < N; i++) Xt[i] = X[i] + dt * k3[i];
    el.eval(t + dt, Xt, 0, 0, k4);
    for (let i = 0; i < N; i++) X[i] += (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  }

  return {
    names,
    // The External block's ports, as the diagram has them now.
    get port() { return ext.params; },
    // What each u carries for the plant's log: [{ name, unit }].
    get log() { return log.map(({ name, unit }) => ({ name, unit })); },
    get period() { return period; },
    // The ramp-in's state after the last cycle (core/ramp.js), or null.
    ramp: () => (ramp && started ? ramp.state() : null),
    // One cycle: the plant's outputs y at its time t. Returns u, clamped to the
    // plant's limits (a value that is not a number becomes the safe one), the
    // values of every Source and Sink at t, in the order of names(), the
    // values for the plant's log, and the ramp-in's state.
    // held: an E-stop is latched, so the plant applies its safe inputs: u is
    // the safe values, and so are the Sinks that show the block's inputs.
    step(t, y, held = false) {
      for (let j = 0; j < ext.y.length; j++) ext.y[j] = Number.isFinite(y[j]) ? y[j] : 0;
      if (!started) {
        // The first cycle: read where the loop is (Sources at their first
        // value), then start the ramp-in from there.
        el.eval(t, X, 0, 0, null);
        makeRamp();
        ramp.start(t, present(y));
        started = true;
      } else {
        ramp.advance(t);
        if (tPrev !== null && t > tPrev) {
          // Between cycles the plant's outputs hold their last value.
          const m = Math.max(1, Math.round((t - tPrev) / h));
          const dt = (t - tPrev) / m;
          for (let s = 0; s < m; s++) {
            const ts = tPrev + s * dt;
            if (el.n) rk4(ts, dt);
            if (s < m - 1) { el.eval(ts + dt, X, 0, 0, null); el.sample(ts + dt, X, 0, 0); el.record(); }
          }
        }
      }
      el.eval(t, X, 0, 0, null);
      el.sample(t, X, 0, 0);
      el.record();
      tPrev = t;
      const p = ext.params;
      const all = el.probes();
      if (held) ext.shows.forEach((js, i) => { for (const j of js) all[j][1] = p.safe[i]; });
      const values = keep.map((i) => all[i][1]);
      const logged = log.map((l) => (Array.isArray(l.probe) ? probe(all, l.probe[0]) - probe(all, l.probe[1]) : probe(all, l.probe)));
      const state = ramp.state();
      if (held) return { u: [...p.safe], values, log: logged, ramp: state };
      const u = ext.u().map((v, i) => (Number.isFinite(v) ? Math.min(p.max[i], Math.max(p.min[i], v)) : p.safe[i]));
      return { u, values, log: logged, ramp: state };
    },
    // A new version of the diagram or the signals while running: parameters
    // of controller variants take effect at the next cycle, keeping the
    // controllers' state; anything else rebuilds (controllers start afresh).
    update(d, nextSigs) {
      if (nextSigs) setSignals(nextSigs);
      if (!d) return 'signals';
      const next = normalizeDiagram(structuredClone(d));
      if (structureKey(next) === key) { copyParams(own, next); return 'kept'; }
      build(next);
      return 'rebuilt';
    },
    // Controllers start afresh, and the ramp-in with them.
    restart() { build(own); },
  };
}

// The connection: one WebSocket to the plant, the runner, both watchdogs'
// page side, and statistics. It talks to the page through post(msg):
//   in:  connect { url }, program { diagram, signals }, start (a fresh run,
//        restarting the plant if it runs), stop, estop, reset, disconnect
//   out: state { state, detail }, described { desc }, estop { by, reason },
//        run { by } (a new run begins), stopped { by, reason } (the plant
//        stopped by itself), samples { names, t, rt, values, ramp },
//        stats { link, plant }, error { message }, programmed { how }
// States: connecting, open (connected, the plant not running), running, closed.
// Nothing starts by itself: connecting reads the description only, and an
// E-stop (either side) stops the run until Reset, then Run.
// The same object runs in a worker (liveWorker) or on the page.
export function createLiveLoop(post, env = globalThis) {
  const now = () => env.performance.now();
  let ws = null, desc = null, runner = null, program = null;
  let running = false, latched = null, lastY = 0, watchdog = 0;
  let stats = null, plantStatus = null, lastStats = 0;
  const empty = () => ({ t: [], rt: [], values: [] });
  let batch = empty(), lastFlush = 0, names = [], lastRamp = null;
  let id = 0;
  const calls = new Map();

  const say = (state, detail = '') => post({ type: 'state', state, detail });
  const fail = (message) => post({ type: 'error', message });
  function call(method, params) {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== 1) { reject(new Error('not connected')); return; }
      const i = ++id;
      calls.set(i, { resolve, reject });
      ws.send(rpcRequest(i, method, params));
    });
  }

  function flush() {
    if (!batch.t.length) return;
    post({ type: 'samples', names, ...batch, ramp: lastRamp });
    batch = empty();
  }
  function halt() { running = false; stopWatchdog(); flush(); }
  // An E-stop from either side: latched until Reset, and the run is over.
  function latch(by, reason) {
    if (latched) return;
    latched = { by, reason };
    halt();
    post({ type: 'estop', by, reason });
  }
  function stopWatchdog() { if (watchdog) env.clearInterval(watchdog); watchdog = 0; }
  // The page's watchdog: no y for the plant's watchdog cycles means the plant
  // is silent; the controller stops (no more u) until Reset.
  function startWatchdog() {
    stopWatchdog();
    lastY = now();
    const cycles = desc?.watchdog ?? WATCHDOG_CYCLES;
    watchdog = env.setInterval(() => {
      if (!running || latched) return;
      const w = pageWatchdog({ now: now(), lastY, rateHz: desc.rate_hz, cycles });
      if (w.trip) {
        latch('page', `plant silent for ${w.silent} cycles`);
        call('estop', { reason: 'the page heard no y' }).catch(() => {});
      }
    }, Math.max(5, 1000 / desc.rate_hz));
  }

  function makeRunner() {
    if (!program) throw new Error('nothing to run yet');
    runner = createLiveRunner(program.diagram, program.signals);
    names = runner.names();
  }
  // The page's side of a fresh run: the controllers and the ramp-in afresh.
  function begin(by) {
    makeRunner();
    post({ type: 'run', by });  // what follows is a new run: its time starts again
    stats = createLinkStats(desc.rate_hz);
    lastStats = now();
    running = true;
    startWatchdog();
  }

  function onY(m) {
    const at = now();
    lastY = at;
    if (!runner || !running) return;
    let res;
    try { res = runner.step(m.t, m.y, !!latched); } catch (err) { latch('page', `the diagram failed: ${err.message}`); call('estop', { reason: 'the page\'s diagram failed' }).catch(() => {}); return; }
    // The answer goes out first; everything else can wait. A plant without
    // inputs gets an empty u: its watchdog sees a live page.
    if (!latched && ws?.readyState === 1) ws.send(uMessage(m.seq, res.u, res.log));
    stats?.add(at, m.seq, now() - at);
    batch.t.push(m.t);
    batch.rt.push(res.ramp?.runT ?? NaN);
    batch.values.push(res.values);
    lastRamp = res.ramp && res.ramp.phase === 'ramp' ? { left: res.ramp.left, to: res.ramp.to, first: res.ramp.first } : null;
    if (at - lastFlush >= 33) { lastFlush = at; flush(); }
    if (stats && at - lastStats >= 500) { lastStats = at; post({ type: 'stats', link: stats.read(), plant: plantStatus }); }
  }

  function onText(text) {
    const m = parseMessage(text);
    if (m.kind === 'y') onY(m);
    else if (m.kind === 'result' || m.kind === 'error') {
      const c = calls.get(m.id);
      calls.delete(m.id);
      if (m.kind === 'result') c?.resolve(m.result); else c?.reject(new Error(m.error));
    } else if (m.kind === 'estop') latch('plant', m.reason);
    else if (m.kind === 'running') {
      // The plant's own Run/Stop key: the page follows.
      if (!m.running && running) { halt(); post({ type: 'stopped', by: m.by, reason: m.reason }); say('open', 'stopped at the plant'); }
      else if (m.running && !running && !latched && desc && program) { try { begin('plant'); say('running', desc.name); } catch (err) { fail(err.message); } }
    } else if (m.kind === 'status') plantStatus = m.status;
    else fail(`the plant sent something unexpected: ${m.error}`);
  }

  // A fresh run: the plant restarts its clock (stopped first if it runs),
  // the controllers start afresh and the references ramp in, as a simulated
  // run starts from t = 0.
  async function start() {
    if (!desc) throw new Error('not connected');
    if (latched) throw new Error(`E-STOP is latched (${latched.reason}): Reset first`);
    if (running) { halt(); await call('stop'); }
    begin('page');
    // y may come before start's answer: they are answered and counted.
    try { await call('start', startParams(runner.log)); } catch (err) { halt(); throw err; }
    say('running', desc.name);
  }

  const handlers = {
    connect({ url }) {
      if (ws) return;
      say('connecting', url);
      try { ws = new env.WebSocket(url); } catch (err) { ws = null; say('closed', `cannot open ${url}: ${err.message}`); return; }
      let opened = false;
      ws.onopen = async () => {
        opened = true;
        say('open', url);
        try {
          desc = checkDescription(await call('describe'));
          latched = desc.estop ? { by: 'plant', reason: desc.estop } : null;
          if (desc.protocol !== HIL_PROTOCOL) fail(`the plant speaks ${desc.protocol || 'an unnamed protocol'}, this page ${HIL_PROTOCOL}: it may not work`);
          post({ type: 'described', desc });
          if (latched) post({ type: 'estop', by: 'plant', reason: desc.estop });
          // A plant still running from before (a page that went away) is
          // stopped: nothing runs until Run.
          if (desc.running && !latched) await call('stop').catch(() => {});
        } catch (err) { fail(`describe: ${err.message}`); ws?.close(); }
      };
      ws.onmessage = (e) => onText(e.data);
      ws.onclose = (e) => {
        const wasRunning = running;
        halt(); ws = null; desc = null;
        for (const c of calls.values()) c.reject(new Error('connection closed'));
        calls.clear();
        if (wasRunning && !latched) latch('page', 'connection lost');
        say('closed', e.reason || (opened ? 'the connection was lost' : e.code === 1006 ? 'no plant answered at that address (or this page may not open connections)' : `code ${e.code}`));
      };
      ws.onerror = () => {};  // onclose follows with the reason
    },
    program(p) {
      program = p;
      if (!runner) return;
      try {
        const how = runner.update(p.diagram, p.signals);
        if (how === 'rebuilt') names = runner.names();
        post({ type: 'programmed', how });
      } catch (err) { if (running) { latch('page', err.message); call('estop', { reason: 'the page\'s diagram failed' }).catch(() => {}); } }
    },
    async start() { try { await start(); } catch (err) { fail(err.message); post({ type: 'refused', message: err.message }); } },
    async stop() {
      const was = running;
      halt();
      try { await call('stop'); } catch { /* already gone */ }
      if (was || !latched) say('open', 'stopped');
    },
    async estop() {
      latch('page', 'pressed on this page');
      try { await call('estop', { reason: 'E-STOP pressed on the page' }); } catch { /* the plant's watchdog trips anyway */ }
    },
    // Reset clears both latches; the plant stays stopped until Run.
    async reset() {
      try {
        await call('reset');
        latched = null;
        say('open', 'reset');
      } catch (err) { fail(`reset: ${err.message}`); }
    },
    async disconnect() {
      if (!ws) return;
      halt();
      // Stop first, so the plant does not take the closing for a lost page.
      await Promise.race([call('stop').catch(() => {}), new Promise((r) => env.setTimeout(r, 300))]);
      ws?.close(1000, 'disconnected by the page');
    },
  };
  return {
    handle(msg) { const f = handlers[msg.type]; if (f) f(msg); },
    protocol: HIL_PROTOCOL,
  };
}

// The worker's entry: the bundle's core modules, then this.
export function liveWorker(scope) {
  const loop = createLiveLoop((msg) => scope.postMessage(msg), scope);
  scope.onmessage = (e) => loop.handle(e.data);
  scope.postMessage({ type: 'ready' });
}
