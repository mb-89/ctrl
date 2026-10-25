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
// the plant's log). A plant that echoes the inputs it applied (y's applied)
// has them recorded as signals of their own, applied.NAME.

import { compileDiagram, normalizeDiagram, diagramNames, parseEnd } from './diagram.js';
import { CONTROLLERS } from './controllers.js';
import { OBSERVERS } from './observers.js';
import { referenceFn } from './signals.js';
import { createRampIn } from './ramp.js';
import { HIL_PROTOCOL, WATCHDOG_CYCLES, rpcRequest, uMessage, startParams, parseMessage, checkDescription, pageWatchdog, createLinkStats, fullScales, blockMode } from './hil.js';

// Cycles in a row in which an output of the plant is not a number before the
// page latches an E-stop (it holds the last number meanwhile).
export const NAN_CYCLES = 3;

// Why a diagram cannot run against its plant, or null: a Controller block's
// output wired to an input the plant takes as a reference (reference mode:
// the plant runs its own controller, so the page's would set its reference).
function controllerOnReference(params, links) {
  for (const c of links.ctrls) {
    for (const i of c.drives ?? []) {
      if ((params.kinds?.[i] ?? 'effort') !== 'reference') continue;
      return `Controller "${c.key}" is wired to ${params.inputs[i]}, which this plant takes as a reference (reference mode: the plant runs its own controller). Switch the plant to control mode (Live settings, Mode: "The page controls"), let r go straight to it (Mode: "The plant controls" rewires it so), or start the plant in control mode (hil_plant.py without --mode reference).`;
    }
  }
  return null;
}

// What a running loop cannot take over in place: everything but block
// positions, the names and parameters of controller and observer variants
// (their laws read the parameters at every sample: controllers.js), and the
// External block's ramp-in and full scales (they count from the next Run).
// The running variant's parameters, if it is designed, are inputs to its
// design (design.js): a change designs it again, so it rebuilds the loop. A
// designed variant that does not run is designed when it is switched to (a
// switch rebuilds), so editing it keeps the running loop and its state.
const SAMPLED = ['controller', 'observer'];
const LIBS = { controller: CONTROLLERS, observer: OBSERVERS };
function structureKey(diagram) {
  return JSON.stringify(diagram, function (k, v) {
    if ((k === 'x' || k === 'y') && typeof v === 'number' && this.id !== undefined) return undefined;
    if (k === 'variants' && SAMPLED.includes(this.type) && Array.isArray(v)) return v.map((x, i) => (LIBS[this.type][x.type]?.designed && i === (this.variant ?? 0) ? { type: x.type, params: x.params } : x.type));
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
    const why = controllerOnReference(ext.params, links);
    if (why) throw new Error(why);
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
    el.eval(t + dt, Xt, 0, 0, k4, true);
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
    // values for the plant's log, the ramp-in's state, and the outputs that
    // came without a number (missing): those hold their last number, never a
    // made-up 0 (the loop latches an E-stop after NAN_CYCLES of them).
    step(t, y) {
      const missing = [];
      for (let j = 0; j < ext.y.length; j++) {
        if (Number.isFinite(y[j])) ext.y[j] = y[j];
        else missing.push(ext.params.outputs[j]);
      }
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
            if (s < m - 1) { el.eval(ts + dt, X, 0, 0, null); el.recordLeft(); el.sample(ts + dt, X, 0, 0); el.record(); }
          }
        }
      }
      el.eval(t, X, 0, 0, null);
      if (tPrev !== null) el.recordLeft();
      el.sample(t, X, 0, 0);
      el.record();
      tPrev = t;
      const p = ext.params;
      const all = el.probes();
      const values = keep.map((i) => all[i][1]);
      const logged = log.map((l) => (Array.isArray(l.probe) ? probe(all, l.probe[0]) - probe(all, l.probe[1]) : probe(all, l.probe)));
      const u = ext.u().map((v, i) => (Number.isFinite(v) ? Math.min(p.max[i], Math.max(p.min[i], v)) : p.safe[i]));
      return { u, values, log: logged, ramp: ramp.state(), missing };
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

// The full scale of every signal around a diagram's External plant, for the
// scope's channels and the Live settings: { name: [lo, hi] } (hil.js
// fullScales), and the references the ramp-in moves (the Sources that feed
// the plant or a Controller's r). Empty without an External plant.
export function liveScales(diagram) {
  if (!diagram) return { scales: {}, refs: [] };
  let el;
  try { el = compileDiagram(normalizeDiagram(structuredClone(diagram)), 'plant', { standalone: true, sources: new Proxy({}, { get: () => () => 0 }) }); } catch { return { scales: {}, refs: [] }; }
  if (el.externals.length !== 1) return { scales: {}, refs: [] };
  const links = el.links();
  return { scales: fullScales(el.externals[0].params, links), refs: Object.keys(links.sources) };
}

// The wires of a level whose External block (id) takes a plant's ports:
// was and now are the block's parameters before and after. Wires to ports
// that are gone go, and so do wires into an input whose name or kind
// changed: what fed a motor's voltage must not become a reference in rad
// (the plant started in another mode).
export function keptWires(wires, id, was, now) {
  const sig = (p, i) => `${p.inputs[i]}:${p.kinds?.[i] || 'effort'}`;
  const changed = (i) => i >= now.inputs.length || i >= was.inputs.length || sig(was, i) !== sig(now, i);
  return wires.filter((w) => { const f = parseEnd(w.from), t = parseEnd(w.to); return !(t.id === id && changed(t.port)) && !(f.id === id && f.port >= now.outputs.length); });
}

// A level whose External block (id) takes a plant's ports, was and now its
// parameters before and after (input 20: the page draws and wires what the
// plant describes). The wires go as keptWires says, and the Sinks follow
// the outputs: a Sink named for its port (the port's old name) takes the
// new name and unit; an output without a Sink gets one, wired; a Sink named
// for a port that is gone goes with it. Returns { blocks, wires, renamed:
// { old: new name, or null for one that went } } for the scope's channels.
const SIGNAL_NAME = /^[A-Za-z][A-Za-z0-9_]{0,11}$/;
const endIs = (end, id, port) => { const e = parseEnd(end); return e.id === id && e.port === port; };

// The plant changed mode (Live settings' switch, or a plant started in the
// other mode): its inputs that lost their wire are fed as the new mode
// needs. A reference input where a Controller drove the effort takes what
// fed that Controller's r (the plant runs its own controller now); an effort
// input where a reference was fed takes the Controller whose r that was and
// whose u drives nothing (the page controls again). blocks and wires are the
// level's after keptWires; wires is extended.
function modeWires(level, blocks, wires, id, now) {
  const byId = (bid) => blocks.find((b) => b.id === bid);
  const into = (bid, port) => wires.find((w) => endIs(w.to, bid, port));
  now.inputs.forEach((_, j) => {
    if (into(id, j)) return;
    const before = level.wires.find((w) => endIs(w.to, id, j));
    if (!before) return;
    const feeder = byId(parseEnd(before.from).id), kind = now.kinds?.[j] || 'effort';
    const to = j ? `${id}:${j}` : id;
    if (kind === 'reference' && feeder?.type === 'controller') {
      const r = level.wires.find((w) => endIs(w.to, feeder.id, 0));
      if (r) wires.push({ from: r.from, to });
    } else if (kind === 'effort' && feeder?.type !== 'controller') {
      const ctl = blocks.find((b) => b.type === 'controller' && wires.some((w) => endIs(w.to, b.id, 0) && w.from === before.from)
        && !wires.some((w) => parseEnd(w.from).id === b.id && parseEnd(w.to).id === id));
      if (ctl) wires.push({ from: ctl.id, to });
    }
  });
}

export function followPorts(level, id, was, now) {
  const ext = level.blocks.find((b) => b.id === id);
  const fromPort = (w) => { const f = parseEnd(w.from); return f.id === id ? f.port : -1; };
  const fed = (b) => level.wires.filter((w) => parseEnd(w.to).id === b.id);
  const renamed = {};
  // Sinks named for an output that is gone, fed by nothing else, go.
  const gone = new Set(level.blocks.filter((b) => b.type === 'sink' && fed(b).length && fed(b).every((w) => fromPort(w) >= now.outputs.length && b.params.name === was.outputs[fromPort(w)])).map((b) => b.id));
  for (const b of level.blocks) if (gone.has(b.id)) renamed[b.params.name] = null;
  const blocks = level.blocks.filter((b) => !gone.has(b.id)).map((b) => structuredClone(b));
  const wires = keptWires(level.wires, id, was, now).filter((w) => !gone.has(parseEnd(w.to).id)).map((w) => ({ ...w }));
  modeWires(level, blocks, wires, id, now);
  // A Sink of an output that went, where a Controller now drives the plant
  // input of the same name, shows that Controller's u (control mode again).
  for (const b of level.blocks) {
    if (!gone.has(b.id) || b.type !== 'sink') continue;
    const j = now.inputs.indexOf(b.params.name);
    const drive = j < 0 ? null : wires.find((w) => endIs(w.to, id, j) && blocks.find((x) => x.id === parseEnd(w.from).id)?.type === 'controller');
    if (!drive) continue;
    gone.delete(b.id);
    delete renamed[b.params.name];
    blocks.push(structuredClone(b));
    wires.push({ from: drive.from, to: b.id });
  }
  const taken = new Set(diagramNames({ blocks, wires }).sinks.concat(diagramNames({ blocks, wires }).sources));
  now.outputs.forEach((name, j) => {
    const unit = now.outUnits?.[j] ?? '1';
    const sinks = blocks.filter((b) => b.type === 'sink' && wires.some((w) => parseEnd(w.to).id === b.id && fromPort(w) === j));
    // A Sink named for this output that shows a Controller's u, where that
    // Controller no longer drives the plant (reference mode: the plant's own
    // effort comes back as an output), shows the output instead.
    if (!sinks.length) {
      const own = blocks.find((b) => b.type === 'sink' && b.params.name === name);
      const feed = own && wires.find((w) => parseEnd(w.to).id === own.id);
      const from = feed && blocks.find((x) => x.id === parseEnd(feed.from).id);
      if (from?.type === 'controller' && !wires.some((w) => parseEnd(w.from).id === from.id && parseEnd(w.to).id === id)) {
        feed.from = j ? `${id}:${j}` : id;
        own.params.unit = unit;
        sinks.push(own);
      }
    }
    for (const b of sinks) {
      if (b.params.name !== was.outputs[j]) continue;  // the person's own name stays
      if (name !== b.params.name && SIGNAL_NAME.test(name) && !taken.has(name)) { taken.delete(b.params.name); renamed[b.params.name] = name; b.params.name = name; taken.add(name); }
      b.params.unit = unit;
    }
    if (sinks.length || !SIGNAL_NAME.test(name) || taken.has(name)) return;
    let sid = name;
    for (let k = 2; blocks.some((b) => b.id === sid); k++) sid = `${name}_${k}`;
    blocks.push({ id: sid, type: 'sink', params: { name, unit }, x: (ext?.x ?? 0) + 260, y: (ext?.y ?? 0) + 36 * j });
    wires.push({ from: j ? `${id}:${j}` : id, to: sid });
    taken.add(name);
  });
  return { blocks, wires, renamed };
}

// Why Run cannot start this diagram against its plant, or null (the loop
// refuses the same): a Controller block driving a reference input.
export function liveProblem(diagram) {
  let el;
  try { el = compileDiagram(normalizeDiagram(structuredClone(diagram)), 'plant', { standalone: true, sources: new Proxy({}, { get: () => () => 0 }) }); } catch (err) { return err.message; }
  if (el.externals.length !== 1) return null;
  return controllerOnReference(el.externals[0].params, el.links());
}

// The scope's keys with an External plant: Run, Stop and Single go through
// the plant, and nothing runs by itself (design/output/hil.md, "Run, Stop and
// the keys"). key: 'run', 'stop', 'single', or 'swept' (a Single's sweep has
// ended). st: { link: 'offline' | 'connecting' | 'open' | 'running', latched
// (an E-stop, either side), display (the scope's mode) }. Returns { display:
// the scope's next mode, restart (a fresh sweep from the left edge), plant:
// 'start' | 'stop' | null, why: what to tell the person when a key is refused }.
export function liveKey(key, { link, latched = false, display = 'stop' } = {}) {
  const running = link === 'running';
  const out = (d, restart, plant, why = null) => ({ display: d, restart, plant, why });
  if (key === 'stop' || key === 'swept') return out('stop', false, running ? 'stop' : null);
  if (latched) return out('stop', false, running ? 'stop' : null, 'E-STOP is latched: Reset first, then Run.');
  if (!running && link !== 'open') return out('stop', false, null, link === 'connecting' ? 'Still connecting to the plant.' : 'Offline: connect the plant first (Plant tab, Connect); Run then starts it.');
  // Single while running: the sweep under way finishes, then the plant stops.
  if (key === 'single') return running ? out('single', false, null) : out('single', true, 'start');
  // Run while running (a Single pending, or the screen stopped by a key the
  // plant did not see) goes on running; from stopped it starts the plant.
  return running ? out('run', display === 'stop', null) : out('run', true, 'start');
}

// The connection: one WebSocket to the plant, the runner, both watchdogs'
// page side, and statistics. It talks to the page through post(msg):
//   in:  connect { url }, program { diagram, signals }, start (a fresh run,
//        restarting the plant if it runs), stop, estop, reset, disconnect;
//        a message with an id is answered with done { id, error? } once
//        the plant has answered it (disconnect: once the link is closed)
//   out: state { state, detail }, described { desc }, estop { by, reason },
//        cleared { by } (the plant was reset at its own key),
//        run { by } (a new run begins), stopped { by, reason } (the plant
//        stopped by itself), samples { names, units, t, rt, values, ramp }
//        (units: of the applied.NAME columns, which only the record keeps),
//        stats { link, plant }, error { message }, programmed { how },
//        refused { message }, done { id, error? }
// States: connecting (until the plant has described itself), open
// (connected, the plant not running), running, closed.
// Nothing starts by itself: connecting reads the description only, and an
// E-stop (either side) stops the run until Reset, then Run. The last of
// start and stop asked for wins: one overtaken by a later one reports
// nothing, so a Stop pressed right after Run (or the other way round) is
// never lost while the plant answers.
// The same object runs in a worker (liveWorker) or on the page.
export function createLiveLoop(post, env = globalThis) {
  const now = () => env.performance.now();
  let ws = null, desc = null, runner = null, program = null;
  let running = false, latched = null, lastY = 0, watchdog = 0, armed = false;
  let stats = null, plantStatus = null, lastStats = 0;
  const empty = () => ({ t: [], rt: [], values: [] });
  let batch = empty(), lastFlush = 0, names = [], lastRamp = null;
  // The inputs the plant applied, when it says (y's applied): recorded as
  // applied.NAME after the diagram's signals, NaN in a cycle without them.
  let appliedOn = false, appliedUnits = {};
  let id = 0, gen = 0, bad = 0;
  const calls = new Map();
  const programWaiters = [], closeWaiters = [];

  const say = (state, detail = '') => post({ type: 'state', state, detail });
  const fail = (message) => post({ type: 'error', message });
  const open = () => ws?.readyState === 1;
  function call(method, params) {
    return new Promise((resolve, reject) => {
      if (!open()) { reject(new Error('not connected')); return; }
      const i = ++id;
      calls.set(i, { resolve, reject });
      ws.send(rpcRequest(i, method, params));
    });
  }

  function flush() {
    if (!batch.t.length) return;
    post({ type: 'samples', names, units: appliedUnits, ...batch, ramp: lastRamp });
    batch = empty();
  }
  function halt() { running = false; stopWatchdog(); flush(); }
  // An E-stop from either side: latched until Reset, and the run is over.
  function latch(by, reason) {
    if (latched) return;
    latched = { by, reason };
    halt();
    post({ type: 'estop', by, reason });
    // Still connected: the plant is stopped (latched) until Reset, then Run.
    if (open()) say('open', 'e-stop');
  }
  // The page's own E-stop: latched here, and the plant is asked to E-stop too.
  function trip(reason, toPlant) {
    latch('page', reason);
    call('estop', { reason: toPlant }).catch(() => {});
  }
  function stopWatchdog() { if (watchdog) env.clearInterval(watchdog); watchdog = 0; }
  // The page's watchdog: no y for the plant's watchdog cycles means the plant
  // is silent; the controller stops (no more u) until Reset.
  // It counts from the run's first y (or from start's answer, or a second
  // after Run at the latest), so a plant that takes a moment to start its
  // clock is not taken for a silent one.
  function startWatchdog() {
    stopWatchdog();
    lastY = now();
    const armAt = lastY + 1000;
    armed = false;
    const cycles = desc?.watchdog ?? WATCHDOG_CYCLES;
    watchdog = env.setInterval(() => {
      if (!running || latched) return;
      if (!armed) { if (now() < armAt) return; armed = true; }
      const w = pageWatchdog({ now: now(), lastY, rateHz: desc.rate_hz, cycles });
      if (w.trip) trip(`plant silent for ${w.silent} cycles`, 'the page heard no y');
    }, Math.max(5, 1000 / desc.rate_hz));
  }

  function sampleNames() {
    const p = runner.port;
    appliedUnits = appliedOn ? Object.fromEntries(p.inputs.map((n, i) => [`applied.${n}`, p.inUnits[i]])) : {};
    names = [...runner.names(), ...Object.keys(appliedUnits)];
  }
  function makeRunner() {
    if (!program) throw new Error('nothing to run yet');
    runner = createLiveRunner(program.diagram, program.signals);
    appliedOn = false;
    sampleNames();
  }
  // The page's side of a fresh run: the controllers and the ramp-in afresh.
  function begin(by) {
    makeRunner();
    post({ type: 'run', by });  // what follows is a new run: its time starts again
    stats = createLinkStats(desc.rate_hz);
    lastStats = now();
    bad = 0;
    running = true;
    startWatchdog();
  }

  function onY(m) {
    const at = now();
    lastY = at;
    armed = true;
    if (!runner || !running) return;
    let res;
    try { res = runner.step(m.t, m.y); } catch (err) { trip(`the diagram failed: ${err.message}`, 'the page\'s diagram failed'); return; }
    // An output that is not a number holds its last one for a moment; then
    // the page stops rather than control on a stale measurement.
    if (res.missing.length) {
      if (++bad >= NAN_CYCLES) { trip(`no number for ${res.missing.join(', ')} in ${bad} cycles`, `the page got no number for ${res.missing.join(', ')}`); return; }
    } else bad = 0;
    // The answer goes out first; everything else can wait. A plant without
    // inputs gets an empty u: its watchdog sees a live page.
    if (!latched && open()) ws.send(uMessage(m.seq, res.u, res.log));
    stats?.add(at, m.seq, now() - at);
    const n = runner.port.inputs.length;
    if (!appliedOn && m.applied?.length === n && n) { flush(); appliedOn = true; sampleNames(); }
    batch.t.push(m.t);
    batch.rt.push(res.ramp?.runT ?? NaN);
    batch.values.push(appliedOn ? [...res.values, ...Array.from({ length: n }, (_, i) => (m.applied?.length === n ? m.applied[i] : NaN))] : res.values);
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
      // The plant's own Run/Stop key (or a stop of its own): the page
      // follows. A change the page asked for is the echo of its own key: the
      // page knows already, and an echo that arrives late must not stop a
      // newer run.
      if (m.by === 'page') return;
      if (!m.running && running) { gen++; halt(); post({ type: 'stopped', by: m.by, reason: m.reason }); say('open', 'stopped at the plant'); }
      else if (m.running && !running && !latched && desc && program) { gen++; try { begin('plant'); say('running', desc.name); } catch (err) { fail(err.message); } }
    } else if (m.kind === 'status') {
      plantStatus = m.status;
      // Reset at the plant's own key clears an E-stop the plant latched; one
      // the page latched waits for the page's Reset.
      if (latched?.by === 'plant' && m.status?.estop === null && !running) { latched = null; post({ type: 'cleared', by: 'plant' }); say('open', 'reset'); }
    }
    else fail(`the plant sent something unexpected: ${m.error}`);
  }

  // A fresh run: the plant restarts its clock (stopped first if it runs),
  // the controllers start afresh and the references ramp in, as a simulated
  // run starts from t = 0. A later start or stop overtakes it (gen).
  async function start() {
    const my = ++gen;
    if (!desc) throw new Error('not connected');
    if (latched) throw new Error(`E-STOP is latched (${latched.reason}): Reset first`);
    // The page sends the diagram as the plant describes itself; a Run right
    // after Connect waits for it.
    if (!program) await new Promise((r) => { programWaiters.push(r); env.setTimeout(r, 1000); });
    if (my !== gen || latched) return;
    try {
      if (running) { halt(); await call('stop'); if (my !== gen || latched) return; }
      begin('page');
      // y may come before start's answer: they are answered and counted.
      await call('start', startParams(runner.log));
    } catch (err) {
      halt();
      if (my === gen && open() && !latched) say('open', 'stopped');
      throw err;
    }
    // A Stop or an E-stop that came while the plant was starting has the
    // last word (the plant hears it after start).
    if (my !== gen || !running || latched) return;
    if (!armed) { armed = true; lastY = now(); }
    say('running', desc.name);
  }

  const handlers = {
    connect({ url }) {
      if (ws) return;
      say('connecting', url);
      try { ws = new env.WebSocket(url); } catch (err) { ws = null; say('closed', `cannot open ${url}: ${err.message}`); return; }
      let opened = false;
      // Open once the plant has described itself (and a run left over from a
      // page that went away is stopped), so whoever waits for it can Run.
      ws.onopen = async () => {
        opened = true;
        try {
          desc = checkDescription(await call('describe'));
          latched = desc.estop ? { by: 'plant', reason: desc.estop } : null;
          if (desc.protocol !== HIL_PROTOCOL) fail(`the plant speaks ${desc.protocol || 'an unnamed protocol'}, this page ${HIL_PROTOCOL}: it may not work`);
          post({ type: 'described', desc });
          if (latched) post({ type: 'estop', by: 'plant', reason: desc.estop });
          // A plant still running from before (a page that went away) is
          // stopped: nothing runs until Run.
          if (desc.running && !latched) await call('stop').catch(() => {});
          if (open()) say('open', url);
        } catch (err) { fail(`describe: ${err.message}`); ws?.close(); }
      };
      ws.onmessage = (e) => onText(e.data);
      ws.onclose = (e) => {
        const wasRunning = running;
        halt(); ws = null; desc = null; gen++;
        for (const c of calls.values()) c.reject(new Error('connection closed'));
        calls.clear();
        if (wasRunning && !latched) latch('page', 'connection lost');
        say('closed', e.reason || (opened ? 'the connection was lost' : e.code === 1006 ? 'no plant answered at that address (or this page may not open connections)' : `code ${e.code}`));
        for (const w of closeWaiters.splice(0)) w();
      };
      ws.onerror = () => {};  // onclose follows with the reason
    },
    program(p) {
      program = p;
      for (const w of programWaiters.splice(0)) w();
      if (!runner) return;
      try {
        const how = runner.update(p.diagram, p.signals);
        if (how === 'rebuilt') { flush(); sampleNames(); }
        post({ type: 'programmed', how });
      } catch (err) { if (running) trip(err.message, 'the page\'s diagram failed'); }
    },
    async start() {
      try { await start(); return {}; } catch (err) { fail(err.message); post({ type: 'refused', message: err.message }); return { error: err.message }; }
    },
    async stop() {
      const my = ++gen;
      halt();
      try { await call('stop'); } catch { /* already gone */ }
      // The plant has taken this stop after anything sent before it: it is
      // stopped (a run it began at its own key meanwhile included).
      if (my !== gen) return {};
      halt();
      if (open()) say('open', latched ? 'e-stop' : 'stopped');
      return {};
    },
    async estop() {
      gen++;
      latch('page', 'pressed on this page');
      try { await call('estop', { reason: 'E-STOP pressed on the page' }); } catch { /* the plant's watchdog trips anyway */ }
      return {};
    },
    // Reset clears both latches; the plant stays stopped until Run. The
    // plant may refuse: a STOP pressed at the plant is reset there.
    async reset() {
      try {
        await call('reset');
        latched = null;
        say('open', 'reset');
        return {};
      } catch (err) { fail(`reset: ${err.message}`); return { error: err.message }; }
    },
    // The Live settings' mode switch: the plant, stopped, runs in another
    // mode and describes itself anew; the page takes the new ports as on
    // Connect. A plant without the request says so in its error.
    async mode({ mode }) {
      if (!desc) return { error: 'not connected' };
      if (running) return { error: 'stop the plant first: its mode changes only while it is stopped' };
      try {
        desc = checkDescription(await call('mode', { mode }));
        post({ type: 'described', desc });
        return {};
      } catch (err) { return { error: err.message }; }
    },
    async disconnect() {
      if (!ws) return {};
      halt();
      gen++;
      // Stop first, so the plant does not take the closing for a lost page.
      await Promise.race([call('stop').catch(() => {}), new Promise((r) => env.setTimeout(r, 300))]);
      if (!ws) return {};
      const closed = new Promise((r) => { closeWaiters.push(r); env.setTimeout(r, 1000); });
      ws.close(1000, 'disconnected by the page');
      await closed;
      return {};
    },
  };
  return {
    handle(msg) {
      const f = handlers[msg.type];
      if (!f) return;
      const res = f(msg);
      if (msg.id !== undefined) Promise.resolve(res).then((r) => post({ type: 'done', id: msg.id, ...(r ?? {}) }));
    },
    protocol: HIL_PROTOCOL,
  };
}

// The worker's entry: the bundle's core modules, then this.
export function liveWorker(scope) {
  const loop = createLiveLoop((msg) => scope.postMessage(msg), scope);
  scope.onmessage = (e) => loop.handle(e.data);
  scope.postMessage({ type: 'ready' });
}
