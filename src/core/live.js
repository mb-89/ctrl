// Live (HIL) mode, the loop: a diagram stepped one plant cycle at a time
// against an external plant (createLiveRunner), and the connection that feeds
// it (createLiveLoop), which runs in a Web Worker so that drawing never delays
// an answer, or on the page if workers are blocked. No DOM. See
// design/output/hil.md.
//
// Each cycle the plant sends y (seq, t). The runner sets the External plant
// block's outputs to y, advances the rest of the diagram to t (Sources play
// at t, Controller blocks sample on their own Ts), and reads the block's
// inputs: that is the u sent back, at once, with the same seq.
//
// createStepRunner is the same loop on a simulated plant, one controller
// sample at a time, with Sources a caller may play itself (Identify's
// experiment plays r and holds the other inputs: identification.md §3).

import { compileDiagram, normalizeDiagram } from './diagram.js';
import { referenceFn } from './signals.js';
import { stepPlan, onGrid } from './sim.js';
import { HIL_PROTOCOL, WATCHDOG_CYCLES, rpcRequest, uMessage, parseMessage, checkDescription, pageWatchdog, createLinkStats } from './hil.js';

// What a running loop cannot take over in place: everything but block
// positions and the names and parameters of controller and observer variants
// (their laws read the parameters at every sample: controllers.js).
const SAMPLED = ['controller', 'observer'];
function structureKey(diagram) {
  return JSON.stringify(diagram, function (k, v) {
    if ((k === 'x' || k === 'y') && typeof v === 'number' && this.id !== undefined) return undefined;
    if (k === 'variants' && SAMPLED.includes(this.type) && Array.isArray(v)) return v.map((x) => x.type);
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

// What both runners share: the diagram compiled with its Sources looked up
// when called, so signals change without a rebuild (a Source a caller plays
// itself, in `own`, comes first), the scope's signals among the probes, and
// one RK4 step of the continuous blocks from the state X. probes() lists the
// Sources only for the names the diagram actually plays.
function compileRun(diagram, fns, own = {}) {
  const sources = new Proxy({}, { get: (_, name) => (t) => (own[name] ? own[name](t) : fns[name] ? fns[name](t) : 0) });
  const el = compileDiagram(diagram, 'plant', { standalone: true, sources });
  // The scope's signals: Sources and Sinks. (Auto-tune's "ctrl.u" probes
  // have a dot in their name and stay out, as on the scope.)
  const keep = el.probes().flatMap(([n], i) => (n.includes('.') ? [] : [i]));
  const N = el.n;
  const X = new Float64Array(N), Xt = new Float64Array(N);
  const k1 = new Float64Array(N), k2 = new Float64Array(N), k3 = new Float64Array(N), k4 = new Float64Array(N);
  function rk4(t, dt) {
    el.eval(t, X, 0, 0, k1);
    for (let i = 0; i < N; i++) Xt[i] = X[i] + 0.5 * dt * k1[i];
    el.eval(t + 0.5 * dt, Xt, 0, 0, k2);
    for (let i = 0; i < N; i++) Xt[i] = X[i] + 0.5 * dt * k2[i];
    el.eval(t + 0.5 * dt, Xt, 0, 0, k3);
    for (let i = 0; i < N; i++) Xt[i] = X[i] + dt * k3[i];
    el.eval(t + dt, Xt, 0, 0, k4);
    for (let i = 0; i < N; i++) X[i] += (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  }
  const names = () => { const all = el.probes(); return keep.map((i) => all[i][0]); };
  const values = () => { const all = el.probes(); return keep.map((i) => all[i][1]); };
  return { el, keep, X, rk4, names, values };
}

// diagram: a normalised plant diagram with one External plant block.
// signals: the project's named signals (the Sources play them).
export function createLiveRunner(diagram, signals) {
  const fns = {};
  let own, key, el, ext, keep, X, rk4, tPrev, h, run;

  function setSignals(sigs) {
    for (const name of Object.keys(fns)) delete fns[name];
    for (const [name, ref] of Object.entries(sigs ?? {})) fns[name] = referenceFn(ref, { sampleTime: h ?? 0.01 });
  }
  // The runner's own copy, in normal form (a project restored by Undo has
  // its open limits as null), so the laws hold its parameter objects.
  function build(d) {
    own = normalizeDiagram(structuredClone(d));
    key = structureKey(own);
    run = compileRun(own, fns);
    ({ el, keep, X, rk4 } = run);
    if (el.externals.length !== 1) throw new Error(el.externals.length ? 'one External plant per system, for now' : 'this system has no External plant block: add one from the Live group in the Plant tab');
    ext = el.externals[0];
    // Continuous blocks on the page integrate between cycles, in steps no
    // longer than their dynamics allow.
    const dt = 1 / ext.params.rate;
    const m = Math.max(1, Math.ceil(dt / (el.bound > 0 ? Math.min(0.5 / el.bound, el.minTs) : Math.min(dt, el.minTs)) - 1e-9));
    h = dt / m;
    el.setStep(h);
    el.init(X, 0);
    tPrev = null;
  }
  build(diagram);
  setSignals(signals);
  const names = () => run.names();

  return {
    names,
    // The External block's ports, as the diagram has them now.
    get port() { return ext.params; },
    // One cycle: the plant's outputs y at its time t. Returns u, clamped to the
    // plant's limits (a value that is not a number becomes the safe one), and
    // the values of every Source and Sink at t, in the order of names().
    // held: an E-stop is latched, so the plant applies its safe inputs: u is
    // the safe values, and so are the Sinks that show the block's inputs.
    step(t, y, held = false) {
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
      for (let j = 0; j < ext.y.length; j++) ext.y[j] = Number.isFinite(y[j]) ? y[j] : 0;
      el.eval(t, X, 0, 0, null);
      el.sample(t, X, 0, 0);
      el.record();
      tPrev = t;
      const p = ext.params;
      const all = el.probes();
      if (held) ext.shows.forEach((js, i) => { for (const j of js) all[j][1] = p.safe[i]; });
      const values = keep.map((i) => all[i][1]);
      if (held) return { u: [...p.safe], values };
      const u = ext.u().map((v, i) => (Number.isFinite(v) ? Math.min(p.max[i], Math.max(p.min[i], v)) : p.safe[i]));
      return { u, values };
    },
    // A new version of the diagram or the signals while running: parameters
    // of controller variants take effect at the next cycle, keeping the
    // controllers' state; anything else rebuilds (controllers start afresh).
    update(d, sigs) {
      if (sigs) setSignals(sigs);
      if (!d) return 'signals';
      const next = normalizeDiagram(structuredClone(d));
      if (structureKey(next) === key) { copyParams(own, next); return 'kept'; }
      build(next);
      return 'rebuilt';
    },
    // Controllers start afresh, as after an E-stop.
    restart() { build(own); },
  };
}

// A simulated plant's diagram run one controller sample at a time, as the
// live runner runs a plant outside the page (identification.md §3): each
// step() advances the continuous blocks over one sample Ts, exactly as
// simulateSystem does (every sampled block's instant k·Ts on the grid), then
// the Controller blocks sample. The first step() only samples at t = 0. With
// the record step at the block's Ts, the values equal simulateSystem's, bit
// for bit.
//   diagram   a plant diagram without an External plant block
//   signals   the project's named signals (the Sources play them)
//   Ts        the time per step (the Controller block's sample time)
//   sources   { name: t => value }: Sources the caller plays instead (the r
//             Source from the experiment's reference(k), the others held)
//   variants  { 'ctrl' | 'motor/ctrl': variant }: a block runs this variant,
//             set after the diagram is normalised (a hidden law such as
//             Identify's experiment, which no file holds)
// Returns { step() → { k, t, values }, names(), probes(), law(key), k, t,
// warnings }; law(key) is the law a Controller block runs (law.experiment for
// Identify's).
export function createStepRunner(diagram, signals, { Ts, sources = {}, variants = {} } = {}) {
  if (!(Ts > 0)) throw new Error('createStepRunner: Ts must be positive');
  const d = normalizeDiagram(structuredClone(diagram));
  for (const [key, v] of Object.entries(variants)) {
    let level = d, block = null;
    for (const id of key.split('/')) { block = level?.blocks.find((b) => b.id === id); level = block?.diagram; }
    if (block?.type !== 'controller') throw new Error(`createStepRunner: no Controller block ${key}`);
    block.variants = [v];
    block.variant = 0;
  }
  const fns = {};
  for (const [name, ref] of Object.entries(signals ?? {})) fns[name] = referenceFn(ref, { sampleTime: Ts });
  const run = compileRun(d, fns, sources);
  const { el, X, rk4 } = run;
  if (el.externals.length) throw new Error('this plant runs outside the page (External plant): it is stepped by its own cycles (createLiveRunner)');
  const warnings = [...el.warnings];
  const { m, split } = stepPlan(Ts, el.bound, el.sampleTimes, 1, warnings);
  const h = Ts / m;
  el.setStep(h);
  el.init(X, 0);
  let k = -1;
  return {
    warnings,
    get k() { return k; },
    get t() { return Math.max(0, k) * Ts; },
    names: run.names,
    probes: () => el.probes(),
    law: (key) => el.laws[Array.isArray(key) ? key.join('/') : key] ?? null,
    step() {
      if (k < 0) {
        el.eval(0, X, 0, 0, null);
        el.sample(0, X, 0, 0);
        el.record();
        k = 0;
        return { k, t: 0, values: run.values() };
      }
      const t0 = k * Ts;
      for (let s = 0; s < m; s++) {
        const ts = t0 + s * h, te = onGrid(t0 + (s + 1) * h);
        let a = ts;
        // A sample instant inside this step: integrate to it and sample there.
        if (split) {
          for (let tn = onGrid(el.nextSample()); tn < te - 1e-9; tn = onGrid(el.nextSample())) {
            if (tn > a) { rk4(a, tn - a); a = tn; }
            el.eval(tn, X, 0, 0, null);
            el.sample(tn, X, 0, 0);
          }
        }
        rk4(a, ts + h - a);
        el.eval(te, X, 0, 0, null);
        el.sample(te, X, 0, 0);
        el.record();
      }
      k++;
      return { k, t: k * Ts, values: run.values() };
    },
  };
}

// The connection: one WebSocket to the plant, the runner, both watchdogs'
// page side, and statistics. It talks to the page through post(msg):
//   in:  connect { url }, program { diagram, signals }, start (a fresh run,
//        restarting the plant if it runs), stop, estop, reset { start },
//        disconnect
//   out: state { state, detail }, described { desc }, estop { by, reason },
//        run (a new run begins), samples { names, t, values },
//        stats { link, plant }, error { message }
// States: connecting, open (connected, the plant not running), running, closed.
// The same object runs in a worker (liveWorker) or on the page.
export function createLiveLoop(post, env = globalThis) {
  const now = () => env.performance.now();
  let ws = null, desc = null, runner = null, program = null;
  let running = false, latched = null, lastY = 0, watchdog = 0;
  let stats = null, plantStatus = null, lastStats = 0;
  let batch = { t: [], values: [] }, lastFlush = 0, names = [];
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
    post({ type: 'samples', names, t: batch.t, values: batch.values });
    batch = { t: [], values: [] };
  }
  function latch(by, reason) {
    if (latched) return;
    latched = { by, reason };
    flush();
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

  function onY(m) {
    const at = now();
    lastY = at;
    if (!runner) return;
    let res;
    try { res = runner.step(m.t, m.y, !!latched); } catch (err) { latch('page', `the diagram failed: ${err.message}`); return; }
    // The answer goes out first; everything else can wait.
    if (running && !latched && ws?.readyState === 1) ws.send(uMessage(m.seq, res.u));
    stats?.add(at, m.seq, now() - at);
    batch.t.push(m.t);
    batch.values.push(res.values);
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
    else if (m.kind === 'status') plantStatus = m.status;
    else fail(`the plant sent something unexpected: ${m.error}`);
  }

  // A fresh run: the plant restarts its clock (stopped first if it runs) and
  // the controllers start afresh, as a simulated run starts from t = 0.
  async function start() {
    if (!desc) throw new Error('not connected');
    if (running) { running = false; stopWatchdog(); flush(); await call('stop'); }
    makeRunner();
    post({ type: 'run' });  // what follows is a new run: its time starts again
    // y may come before start's answer: they are answered and counted.
    stats = createLinkStats(desc.rate_hz);
    lastStats = now();
    running = true;
    startWatchdog();
    try { await call('start'); } catch (err) { running = false; stopWatchdog(); throw err; }
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
        } catch (err) { fail(`describe: ${err.message}`); ws?.close(); }
      };
      ws.onmessage = (e) => onText(e.data);
      ws.onclose = (e) => {
        const wasRunning = running;
        running = false; ws = null; desc = null;
        stopWatchdog(); flush();
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
      } catch (err) { latch('page', err.message); }
    },
    async start() { try { await start(); } catch (err) { fail(err.message); } },
    async stop() {
      running = false; stopWatchdog(); flush();
      try { await call('stop'); } catch { /* already gone */ }
      say('open', 'stopped');
    },
    async estop() {
      latch('page', 'pressed on this page');
      try { await call('estop', { reason: 'E-STOP pressed on the page' }); } catch { /* the plant's watchdog trips anyway */ }
    },
    // Reset clears both latches and goes on, the controllers afresh: a plant
    // still running keeps its clock; a stopped one starts when asked to.
    async reset({ start: go = true } = {}) {
      try {
        await call('reset');
        latched = null;
        if (running) { runner?.restart(); startWatchdog(); say('running', desc.name); } else if (go) await start(); else say('open', 'reset');
      } catch (err) { fail(`reset: ${err.message}`); }
    },
    async disconnect() {
      if (!ws) return;
      running = false; stopWatchdog(); flush();
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
