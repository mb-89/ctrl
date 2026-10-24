// Designs computed in the page from the plant (design/output/designs.md): the
// cache keys, the memory-only design store, and the design helpers. A
// designed variant holds only its inputs (Q, R, levels, …); every number it
// runs on is computed here, from the plant as it is wired, whenever it is
// compiled. Same inputs, same numbers: no clocks, no randomness, no state
// carried over between edits; a cache only saves time.
//
//   canonical(x), hashKey(s), plantKey(diagram)   keys
//   createDesignStore(), SYNC_DESIGNS              the store compileDiagram resolves designs through
//   lqrDesign(lin, { Q, R, track, Ts })            discrete LQR on a linear model, in measurement order
//   piCancel(fit, Tcl), scheduledPIDesign(p, ctx)  PI by pole cancellation, at levels of the first measurement
//   trajectoryDesign(p, ctx)                       a swing-up plan with TV-LQR along it (planner.js)
//   kalmanDesign(lin, { Q, R, Ts, outputs })       the steady-state Kalman filter of an Observer

import { c2d, dlqr, dlqe, eig, solve, inv, rank, mul, transpose, equilibrate } from './linalg.js';
import { DesignError, operatingPoint, linearize, firstOrderFit, refuseKinks } from './linearize.js';
import { PLAN_VERSION, planTransfer, alongPlanSteps, tvlqrGains, planValues, planLaw, verifyLoop, runPlan } from './planner.js';

const fmt = (v) => (Number.isFinite(v) ? String(Number(Number(v).toPrecision(4))) : String(v));
const and = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list.join(''));
const now = () => globalThis.performance?.now() ?? Date.now();

// ---- Keys

// JSON with sorted keys, the same for equal values: -0 is 0, ±Infinity
// "inf" / "-inf", typed arrays as arrays, undefined fields left out.
export function canonical(x) {
  if (x === null || x === undefined) return 'null';
  if (typeof x === 'number') return Number.isFinite(x) ? JSON.stringify(x === 0 ? 0 : x) : Number.isNaN(x) ? '"nan"' : x > 0 ? '"inf"' : '"-inf"';
  if (typeof x === 'string' || typeof x === 'boolean') return JSON.stringify(x);
  if (Array.isArray(x) || ArrayBuffer.isView(x)) return `[${Array.from(x, canonical).join(',')}]`;
  if (x instanceof Map) return canonical([...x].sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1)));
  if (typeof x === 'object') return `{${Object.keys(x).filter((k) => x[k] !== undefined && typeof x[k] !== 'function').sort().map((k) => `${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`;
  return 'null';
}

// A short hash of a string (cyrb53), as 12 hex digits: shown as #a3f9c1.
export function hashKey(s) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0').slice(-4) + (h1 >>> 0).toString(16).padStart(8, '0');
}

// What a design depends on in a diagram: everything but where blocks sit and
// which way they face, what Sinks are called (they only record), and the
// variants of Controller blocks (each design holds the other Controllers at
// their output). Observers are kept whole: their variant changes the plant
// a Controller sees through them.
export function plantKey(diagram) {
  const strip = (d) => ({
    blocks: d.blocks.map(({ x, y, flip, ...b }) => {
      if (b.type === 'sink') return { id: b.id, type: b.type };
      if (b.type === 'controller') { const { variants, variant, ...rest } = b; return rest; }
      if (b.type === 'subsystem') return { ...b, diagram: strip(b.diagram) };
      return b;
    }),
    wires: d.wires,
  });
  return canonical(strip(diagram));
}

// ---- The store

// The design store: designs by key, in memory only (an LRU of `limit`
// designs and 8 model compiles). compileDiagram asks it for the values of
// each running designed variant:
//   const job = store.begin(diagram, () => compileDiagram(diagram, 'plant', { mode: 'model' }));
//   const status = job.resolve(block, variant, lib);   // status.values: what make() takes, or null
//   job.end();
// block: { idPath, name, kind: 'controller' | 'observer', Ts, inputs (labels), input (u's label), outputs }.
// A status is what the Controller tab, the CLI and agents see; its values
// are not enumerable, so a status prints and serialises without them.
// A heavy computation is kept apart (an LRU of 8), keyed by what it reads
// only: a plan by the plant, the block, Ts and the plan's own inputs, never
// Q or R, so tuning those re-runs the light part of a design, not the plan.
//
// mode 'sync' runs every design at once, heavy ones (a plan) too: Node, the
// CLI, tests. mode 'async' is the page's: a heavy miss queues a job and the
// design is 'pending' (u = 0), or 'stale' (the block's previous values run,
// when compatible: the same number of measurements and Ts, unless the type
// says otherwise). The page pumps the queue in short slices:
//   store.runJobs(ms) → { busy, finished, waitMs }   work for about ms; finished jobs bump generation
// A job starts debounceMs after it was first asked for (wheeling a mass
// plans once, not twenty times), and only the jobs the latest compile asked
// for are kept (the newest wins). cancel(key) and retry(key) take a status's
// key; onProgress(fn) hears the queue at most 10 times a second; idle()
// resolves when nothing is queued. Results never depend on the timing: a
// job is the same generator the sync store drains.
export function createDesignStore({ mode = 'sync', limit = 64, debounceMs = 150 } = {}) {
  if (mode !== 'sync' && mode !== 'async') throw new Error(`design store mode "${mode}": 'sync' or 'async'`);
  const designs = new Map(), models = new Map(), heavies = new Map();
  const counts = { runs: 0, hits: 0, heavyRuns: 0 };
  const remember = (map, key, value, size) => { map.delete(key); map.set(key, value); if (map.size > size) map.delete(map.keys().next().value); };
  // The background (async mode): queued jobs by heavy key, in the order
  // they were asked for; per slot (a block's variant) the last values that
  // ran, and a cancelled heavy key; per design key the heavy key it waits on.
  const jobs = new Map(), slots = new Map(), cancelled = new Map(), waitsOn = new Map();
  const listeners = new Set();
  let waiters = [], lastEmit = -Infinity;
  const settleWaiters = () => { if (jobs.size) return; const w = waiters; waiters = []; for (const res of w) res(); };
  const queue = () => [...jobs.values()].map((j) => ({ key: j.key, path: j.path, block: j.block, variant: j.variant, title: j.title, running: !!j.gen, progress: j.progress }));
  const emit = () => { lastEmit = now(); const list = queue(); for (const fn of listeners) fn(list); };

  // Runs one design; never throws. A DesignError becomes the status's error;
  // anything else is a bug, reported with code 'internal'. A design waiting
  // on a heavy job comes back { pending: true } and is not cached.
  function run(def, p, block, compiled, seeThrough, plant, slot, asked, guest) {
    const used = { model: null, at: '', warnings: [], heavy: null };
    const lins = new Map();
    const ctx = {
      Ts: block.Ts, idPath: block.idPath, name: block.name, kind: block.kind, inputs: block.inputs, outputs: block.outputs,
      // The plant this block sees (a Model), looking through designed observers.
      model() {
        if (!used.model) used.model = compiled().seen(block.idPath, seeThrough.size ? { seeThrough } : {});
        return used.model;
      },
      // The linear model at an operating point ('origin' unless named).
      linearize(op = 'origin', limits = {}) {
        const key = canonical([op, limits]);
        if (!lins.has(key)) {
          const lin = linearize(ctx.model(), operatingPoint(ctx.model(), op, limits));
          used.at ||= lin.op.label;
          used.warnings.push(...lin.op.warnings);
          lins.set(key, lin);
        }
        return lins.get(key);
      },
      // An equilibrium with the measurements at targets (null: free).
      trim(targets, limits = {}) {
        const pt = operatingPoint(ctx.model(), { y: targets }, limits);
        used.warnings.push(...pt.warnings);
        return pt;
      },
      // A long computation: start() returns a generator (planner.js) whose
      // value is kept under kind and inputs, for this plant, block and Ts.
      // → { status: 'ready', value, ms }; in async mode also { status:
      // 'pending', progress } (queued, or running) or { status: 'cancelled' }.
      // title names it in the page ('Swing-up': "Swing-up planned in 4.1 s").
      heavy(kind, inputs, start, { title = '' } = {}) {
        const key = hashKey(canonical([kind, inputs, plant(), block.idPath, block.Ts]));
        used.heavy = { key, status: 'ready' };
        let h = heavies.get(key);
        if (!h && mode === 'sync') {
          counts.heavyRuns++;
          const t0 = now();
          const value = runPlan(start());
          h = { value, ms: now() - t0 };
        }
        if (h) {
          remember(heavies, key, h, 8);
          if (h.error) throw h.error;
          return { status: 'ready', value: h.value, ms: h.ms, key };
        }
        // Cancelled until the inputs change (a new key) or retry().
        const mark = cancelled.get(slot);
        if (mark === key) { used.heavy.status = 'cancelled'; return { status: 'cancelled', key }; }
        if (mark) cancelled.delete(slot);
        let job = jobs.get(key);
        // A guest compile (one the page made without naming its store) starts no plan of its own.
        if (!job && guest) { used.heavy.status = 'pending'; return { status: 'pending', progress: null, key }; }
        if (!job) {
          job = { key, kind, title, path: block.idPath, block: block.name, variant: slot.split('#')[1], start, asked: now(), gen: null, started: 0, progress: null };
          jobs.set(key, job);
        }
        asked.add(key);
        used.heavy.status = 'pending';
        return { status: 'pending', progress: job.progress, key };
      },
    };
    const t0 = now();
    let out;
    try {
      out = def.design(p, ctx);
      if (!out) throw new Error(`${block.idPath}: the design returned nothing`);
      if ('pending' in out) {
        if (!used.heavy || used.heavy.status === 'ready') throw new Error('a design came back pending without waiting on a heavy job');
        const mdl = used.model;
        return {
          pending: true, cancelled: used.heavy.status === 'cancelled', heavy: used.heavy.key, progress: out.pending ?? null,
          status: 'pending', values: null, rows: [], warnings: [...new Set([...(mdl?.warnings ?? []), ...used.warnings, ...(out.warnings ?? [])])],
          quality: null, error: null, at: out.at ?? used.at, states: mdl ? mdl.states.map((s) => s.name) : null, ms: now() - t0,
        };
      }
    } catch (err) {
      out = { error: { code: err.code ?? 'internal', message: err.message, hint: err.hint ?? '' } };
    }
    const mdl = used.model;
    return {
      status: out.error ? 'error' : out.quality && out.quality.ok === false ? 'warn' : 'ok',
      values: out.error ? null : out.values ?? null,
      rows: out.rows ?? [],
      warnings: [...new Set([...(mdl?.warnings ?? []), ...used.warnings, ...(out.warnings ?? [])])],
      quality: out.quality ?? null,
      error: out.error ?? null,
      at: out.at ?? used.at,
      states: mdl ? mdl.states.map((s) => s.name) : null,
      ms: now() - t0,
    };
  }

  const store = {
    mode,
    generation: 0,
    // guest: a compile that did not name this store (the page's default,
    // useDesigns): it reads what is cached and the plans being made, but
    // starts no job and drops none.
    begin(diagram, compileModel, { guest = false } = {}) {
      let pk = null, el = null;
      const plant = () => (pk ??= plantKey(diagram));
      // The model-mode compile, shared by every design of this diagram.
      const compiled = () => {
        if (el) return el;
        const key = hashKey(plant());
        el = models.get(key) ?? compileModel();
        remember(models, key, el, 8);
        return el;
      };
      // Designed observers whose estimates a Controller looks through:
      // observer idPath → the global state index of each estimate.
      const seeThrough = new Map();
      // The heavy jobs this compile asked for (async: the newest wins).
      const asked = new Set();
      return {
        resolve(block, variant, lib) {
          const def = lib[variant.type];
          const key = hashKey(canonical([variant.type, def.version ?? 1, variant.params, block.Ts, plant(), block.idPath]));
          // A slot is a block's variant: what ran there last may run while its next design is computed.
          const slot = `${block.idPath}#${variant.name}#${variant.type}`;
          let entry = designs.get(key), cached = !!entry;
          if (cached) counts.hits++;
          else { counts.runs++; entry = run(def, variant.params, block, compiled, seeThrough, plant, slot, asked, guest); }
          let { status, values, rows } = entry;
          if (entry.pending) {
            // Waiting on a heavy job: the previous values of this slot run if
            // they fit (the same number of measurements and Ts), else u = 0.
            remember(waitsOn, key, { heavy: entry.heavy, slot }, limit);
            const before = slots.get(slot), here = { m: block.inputs.length - 1, Ts: block.Ts };
            const fits = !!before && (def.compatible ? def.compatible(before, here) : before.m === here.m && before.Ts === here.Ts);
            status = entry.cancelled ? 'cancelled' : fits ? 'stale' : 'pending';
            values = fits ? before.values : null;
            rows = fits ? before.rows : [];
          } else {
            remember(designs, key, entry, limit);
            if (values) remember(slots, slot, { values, rows, m: block.inputs.length - 1, Ts: block.Ts }, limit);
          }
          if (block.kind === 'observer' && values?.stateIndex) seeThrough.set(block.idPath, values.stateIndex);
          const seen = entry.states ? `${block.input} → ${block.inputs.slice(1).join(', ')} · ${entry.states.length} state${entry.states.length === 1 ? '' : 's'} (${entry.states.join(', ')})` : '';
          const out = {
            path: block.idPath, block: block.name, variant: variant.name, type: variant.type, key,
            status, ms: Number(entry.ms.toFixed(2)), cached,
            at: entry.at, seen, rows, warnings: entry.warnings, error: entry.error, progress: entry.pending ? entry.progress : null,
          };
          Object.defineProperty(out, 'values', { value: values, enumerable: false });
          return out;
        },
        // The compile is done: jobs it did not ask for are dropped.
        end() {
          if (mode !== 'async' || guest) return;
          for (const k of [...jobs.keys()]) if (!asked.has(k)) jobs.delete(k);
          settleWaiters();
        },
      };
    },
    // Works on the queue, oldest job first, for about budgetMs (async mode).
    // A job's generator yields every few ms, so a slice ends close to its
    // budget. → { busy, finished: [{ key, path, block, variant, title, ms, error }], waitMs }
    // (waitMs: how long until the next job may start, while it waits out
    // its debounce). Every finished job bumps generation: compile again.
    runJobs(budgetMs = 8) {
      const t0 = now(), finished = [];
      let waitMs = 0, moved = false;
      while (jobs.size && now() - t0 < budgetMs) {
        const job = jobs.values().next().value;
        if (!job.gen) {
          const wait = job.asked + debounceMs - now();
          if (wait > 0) { waitMs = wait; break; }
          job.started = now();
          job.gen = job.start();
          moved = true;
        }
        let done = null;
        try {
          for (;;) {
            const s = job.gen.next();
            if (s.done) { done = { value: s.value }; break; }
            if (s.value) { job.progress = s.value; moved = true; }
            if (now() - t0 >= budgetMs) break;
          }
        } catch (err) { done = { error: err }; }
        if (!done) continue;
        const ms = now() - job.started;
        jobs.delete(job.key);
        remember(heavies, job.key, { ...done, ms }, 8);
        counts.heavyRuns++;
        store.generation++;
        finished.push({ key: job.key, path: job.path, block: job.block, variant: job.variant, title: job.title, ms, error: done.error ? done.error.message : null });
      }
      if (moved && listeners.size && now() - lastEmit >= 100) emit();
      settleWaiters();
      return { busy: jobs.size > 0, finished, waitMs };
    },
    // Is a job queued or running? The queue, oldest first.
    busy: () => jobs.size > 0,
    queue,
    // Cancel the heavy job a status (by its key) waits on: the block runs
    // u = 0 (or its previous values) until its inputs change or retry(key).
    cancel(key) {
      const w = waitsOn.get(key) ?? [...waitsOn.values()].find((x) => x.heavy === key);
      if (!w) return false;
      jobs.delete(w.heavy);
      cancelled.set(w.slot, w.heavy);
      store.generation++;
      settleWaiters();
      return true;
    },
    retry(key) {
      const w = waitsOn.get(key) ?? [...waitsOn.values()].find((x) => x.heavy === key);
      if (!w || cancelled.get(w.slot) !== w.heavy) return false;
      cancelled.delete(w.slot);
      store.generation++;
      return true;
    },
    // fn(queue) at most 10 times a second while jobs make progress; returns a function that stops it.
    onProgress(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // Resolves when nothing is queued (at once in sync mode).
    idle: () => (jobs.size ? new Promise((res) => waiters.push(res)) : Promise.resolve()),
    // How often designs ran and were found in the cache, and plans were made.
    stats: () => ({ ...counts }),
  };
  return store;
}

// The store compileDiagram uses when it is given none: SYNC_DESIGNS (Node,
// the CLI, tests), or the one the page names with useDesigns (its async
// store), so a compile the page makes without naming a store (an analysis,
// an auto-tune run) never plans on the main thread and shares the page's
// plans and cache, as a guest.
export const SYNC_DESIGNS = createDesignStore();
let fallback = null;
export function useDesigns(store) { fallback = store ?? null; }
export function defaultDesigns() { return fallback ?? SYNC_DESIGNS; }

// ---- Design helpers

// A state for sentences: 'ω (cart and pole)', or its label.
function stateText(s) {
  return s.label.endsWith(`.${s.name}`) ? `${s.name} (${s.label.slice(0, -s.name.length - 1)})` : s.label;
}

// Discrete LQR at the operating point of lin, for a law u = kr·r − K·y that
// feeds back the measurements. Needs every state measured (C square and
// invertible, D = 0): then K = Kx C⁻¹, in measurement order. Q weighs the
// measurements (one value weighs them all), R the effort; Qx = Cᵀ diag(Q) C.
// track: the measurement (1-based) that follows r, 0 for none; kr sets its
// static gain from r to 1. Returns { K, kr, Kx, P, Qx, Ad, Bd, poles, rows, warnings }.
export function lqrDesign(lin, { Q, R, track = 1, Ts }) {
  const { n, m, states, outputs } = lin;
  const labels = outputs.map((o) => o.label);
  if (n > 40) throw new DesignError('too-many-states', `the plant this block sees has ${n} states; LQR here handles up to 40`);
  if (n === 0) throw new DesignError('no-states', `${lin.input.label} moves none of the measurements (${labels.join(', ')})`, lin.warnings.join('; ') || 'wire the controller output to the plant, and the plant to the measurements');
  if (lin.op.kind === 'origin' && !lin.op.rest) throw new DesignError('not-at-rest', `the plant is not at rest at the origin: ${lin.op.warnings[0].replace(/^the origin is not at rest: /, '')}`, 'LQR is designed at the origin, which must be an equilibrium with u = 0');
  refuseKinks(lin, 'LQR');
  // Every state measured, and only states.
  const direct = labels.filter((_, k) => lin.D[k][0] !== 0);
  if (direct.length) throw new DesignError('states-not-measured', `LQR needs measurements of states; ${direct.join(', ')} depends on ${lin.input.label} directly`, 'feed back states only (a Sink of u is fine, an input of the controller is not)');
  if (m !== n || rank(equilibrate(lin.C).M) < n) {
    const sole = lin.C.map((row) => { const nz = row.flatMap((v, j) => (Math.abs(v) > 1e-9 ? [j] : [])); return nz.length === 1 ? nz[0] : -1; });
    const seen = [...new Set(sole.filter((j) => j >= 0))].map((j) => states[j]), missing = states.filter((_, j) => !sole.includes(j));
    if (missing.length && m <= n) {
      throw new DesignError('states-not-measured', `LQR needs every state measured. This block sees ${seen.length ? seen.map((s) => s.name).join(', ') : 'none of them'} but not ${and(missing.map(stateText))}.`, `wire ${and(missing.map((s) => s.name))} to ${missing.length > 1 ? 'inputs' : 'an input'}, or add a Kalman Observer`);
    }
    throw new DesignError('states-not-measured', `LQR needs exactly one measurement per state: this block has ${m} measurement${m === 1 ? '' : 's'} (${labels.join(', ')}) for ${n} state${n === 1 ? '' : 's'} (${states.map((s) => s.name).join(', ')})`, 'measure each state once');
  }
  const q = Array.isArray(Q) ? Q : [Q];
  if (q.length !== 1 && q.length !== m) throw new DesignError('q-length', `Q has ${q.length} values; this block has ${m} measurements (${labels.join(', ')})`, 'give one weight per measurement, or one for all');
  const w = q.length === 1 ? new Array(m).fill(q[0]) : q;
  if (!w.every((v) => v >= 0) || !(R > 0)) throw new DesignError('bad-weights', 'Q must be at least 0 and R above 0');
  if (!(Number.isInteger(track) && track >= 0 && track <= m)) throw new DesignError('bad-track', `r applies to measurement ${track}; this block has ${m} (${labels.join(', ')}); 0 for none`);

  const { Ad, Bd } = c2d(lin.A, lin.B, Ts);
  const Ct = transpose(lin.C);
  const Qx = mul(Ct, lin.C.map((row, k) => row.map((v) => v * w[k])));
  const { K: Kr, P, converged } = dlqr(Ad, Bd, Qx, R);
  const Kx = Kr[0];
  const Acl = Ad.map((row, i) => row.map((v, j) => v - Bd[i][0] * Kx[j]));
  const poles = eig(Acl);
  const radius = Math.max(...poles.map((z) => Math.hypot(z.re, z.im)));
  if (!converged || !(radius < 1)) {
    // Why: a mode that does not decay by itself either cannot be moved by u
    // (the wiring), or carries no weight in Q (PBH tests).
    const mode = stuck(Ad, Bd, Qx);
    const zero = labels.filter((_, k) => w[k] === 0);
    if (mode && !mode.unreached && mode.unweighted && zero.length) throw new DesignError('not-stabilisable', `LQR finds no gain that holds this plant: Q gives no weight to ${and(zero)}, and a mode seen only there does not decay by itself (|z| = ${fmt(mode.radius)})`, `give ${and(zero)} a weight above 0`);
    throw new DesignError('not-stabilisable', `LQR finds no gain that holds this plant (a closed-loop pole stays at |z| = ${fmt(radius)})`, `${lin.input.label} may not reach every state; check the wiring`);
  }
  // K = Kx C⁻¹: Kᵀ solves Cᵀ Kᵀ = Kxᵀ.
  const K = solve(Ct, Kx);
  // kr: the static gain from r to the tracked measurement is 1.
  let kr = 0;
  const warnings = [];
  if (track) {
    const xs = solve(Acl.map((row, i) => row.map((v, j) => (i === j ? 1 : 0) - v)), Bd.map((b) => b[0]));
    const g = lin.C[track - 1].reduce((s, c, j) => s + c * xs[j], 0);
    if (Math.abs(g) > 1e-12) kr = 1 / g;
    else warnings.push(`${labels[track - 1]} has no static gain from r in this loop: kr = 0`);
  }
  const sensed = labels.filter((_, k) => lin.sensors?.[k] && (lin.sensors[k].std > 0 || lin.sensors[k].q > 0));
  if (sensed.length) warnings.push(`quantisers and noise on ${sensed.join(', ')} are not in this design`);
  lin.delay?.forEach((d, k) => { if (d > 0) warnings.push(`dead time ${fmt(d)} s on ${labels[k]} is not in this design`); });
  const rows = [
    { label: 'K', value: K, labels },
    { label: 'kr', value: kr, note: track ? `${labels[track - 1]} follows r` : 'r is not used' },
    { label: 'slowest pole', value: slowest(poles, Ts) },
  ];
  return { K, kr, Kx, P, Qx, Ad, Bd, poles, rows, warnings };
}

// The pole of a pendulum on a cart, from the plant's linearisation at the
// top, for the energy swing-up: measurements x, θ, v, ω (every state
// measured, as lqrDesign checks). A rigid pendulum on a cart has
// θ̈ = (g/l) θ − ẍ / l there, l its effective length (a bob's distance, ⅔ of
// a uniform rod): the combination of the v̇ and ω̇ rows without u leaves
// (g/l) θ alone. Returns { l, g } with the g of the pendulum's own swing,
// so the pump's energy is zero exactly at the top. Throws 'swing-plant' when
// the plant is not one such pendulum.
export function poleOf(lin) {
  const Ci = inv(lin.C), A = mul(mul(lin.C, lin.A), Ci), B = mul(lin.C, lin.B).map((b) => b[0]);
  const c = -B[3] / B[2], row = A[3].map((v, j) => v + c * A[2][j]), gl = row[1];
  const size = Math.max(...row.map(Math.abs));
  if (!(Number.isFinite(c) && c !== 0 && gl > 0 && [0, 2, 3].every((j) => Math.abs(row[j]) <= 1e-4 * size))) {
    throw new DesignError('swing-plant', `the energy swing-up needs one pendulum on a cart, θ̈ = (g/l) θ − ẍ / l at the top; the plant this block sees is not one`, 'use LQR, or the planned swing-up');
  }
  const l = 1 / Math.abs(c);
  return { l, g: gl * l };
}

// The slowest of discrete poles, as a continuous one (s = ln(z) / Ts): '1.9 rad/s, ζ 0.71'.
function slowest(poles, Ts) {
  const slow = poles.reduce((a, z) => (Math.hypot(z.re, z.im) > Math.hypot(a.re, a.im) ? z : a));
  const s = { re: Math.log(Math.hypot(slow.re, slow.im)) / Ts, im: Math.atan2(slow.im, slow.re) / Ts };
  const wn = Math.hypot(s.re, s.im), zeta = wn > 0 ? -s.re / wn : 1;
  return `${fmt(wn)} rad/s, ζ ${fmt(zeta)}`;
}

// A mode of Ad that does not decay by itself (|z| ≥ 1) and that the loop
// cannot hold, with the reason by PBH tests at its eigenvalue z:
// unreached when rank [zI − Ad, B] < n (the input does not move it),
// unweighted when rank [zI − Ad; W] < n (W, the weight, does not see it).
// null when every such mode passes both. Complex z by its real 2n form.
function stuck(Ad, B, W) {
  const n = Ad.length;
  const full = (M, size) => {
    const { M: S } = equilibrate(M);
    let big = 0;
    for (let j = 0; j < S[0].length; j++) { let c = 0; for (const row of S) c += row[j] * row[j]; big = Math.max(big, Math.sqrt(c)); }
    return rank(S, 1e-8 * big) >= size;
  };
  for (const z of eig(Ad)) {
    const radius = Math.hypot(z.re, z.im);
    if (radius < 1 - 1e-9) continue;
    const cplx = Math.abs(z.im) > 1e-12, k = cplx ? 2 : 1;
    // zI − Ad (real 2n form for complex z: [[aI − A, −bI], [bI, aI − A]]).
    const Z = Array.from({ length: k * n }, (_, i) => Array.from({ length: k * n }, (__, j) => {
      const bi = Math.floor(i / n), bj = Math.floor(j / n), ii = i % n, jj = j % n;
      if (bi === bj) return (ii === jj ? z.re : 0) - Ad[ii][jj];
      return ii === jj ? (bi === 0 ? -z.im : z.im) : 0;
    }));
    const side = (M) => Array.from({ length: k * n }, (_, i) => Array.from({ length: k * M[0].length }, (__, j) => (Math.floor(j / M[0].length) === Math.floor(i / n) ? M[i % n][j % M[0].length] : 0)));
    const below = (M) => Array.from({ length: k * M.length }, (_, i) => Array.from({ length: k * n }, (__, j) => (Math.floor(j / n) === Math.floor(i / M.length) ? M[i % M.length][j % n] : 0)));
    const unreached = !full(Z.map((row, i) => [...row, ...side(B)[i]]), k * n);
    const unweighted = !full([...Z, ...below(W)], k * n);
    if (unreached || unweighted) return { z, radius, unreached, unweighted };
  }
  return null;
}

// The steady-state Kalman filter of an Observer (designs-in-the-page.md
// §6.3) on the plant it sees, linearised at the origin, which must be an
// equilibrium with u = 0. Its estimates are the states the Observer can see
// (the kept states of its Model, in their global order); values.stateIndex
// says which, so a Controller designed on the estimates looks through them
// to the states they stand for.
//   Q  process noise: one value is the variance of a random push on u, held
//      over each sample (Qw = Q·Bd·Bdᵀ); n values, one per state (diagonal).
//   R  measurement noise, one per measurement (one value: all); null takes
//      it from the sensor blocks on each measurement's way, σ² + q²/12 (a
//      noise σ, a quantizer step q), and 1 where there are none (a warning).
//   outputs  the block's estimate count: more are zeros, fewer drop the last states.
// The filter predicts with (Ad, Bd) and corrects with L = dlqe(Ad, C, Qw, R)
// (observers.js); its error runs with (I − L C) Ad. values = { A, B, C, L }
// (continuous A, B; flat, row by row), the Luenberger observer that runs
// the same, plus stateIndex. Returns { values, rows, warnings, quality }.
export function kalmanDesign(lin, { Q, R = null, Ts, outputs = lin.n }) {
  const { n, m, states, outputs: meas } = lin;
  const labels = meas.map((o) => o.label), names = states.map((s) => s.name);
  if (n > 40) throw new DesignError('too-many-states', `the plant this observer sees has ${n} states; the filter here handles up to 40`);
  if (!m) throw new DesignError('no-measurement', 'this observer has no measurement to correct its estimate with', 'wire the measurements to inputs 2, 3, …');
  if (n === 0) throw new DesignError('no-states', `${lin.input.label} moves none of the measurements (${labels.join(', ')}), so there is nothing to estimate`, lin.warnings.join('; ') || 'wire input 1 (u) to what drives the plant, and the plant to the measurements');
  if (lin.op.kind === 'origin' && !lin.op.rest) throw new DesignError('not-at-rest', `the plant is not at rest at the origin: ${lin.op.warnings[0].replace(/^the origin is not at rest: /, '')}`, 'the filter is designed at the origin, which must be an equilibrium with u = 0');
  refuseKinks(lin, 'the Kalman filter');
  const direct = labels.filter((_, k) => lin.D[k][0] !== 0);
  if (direct.length) throw new DesignError('feedthrough', `${and(direct)} ${direct.length > 1 ? 'depend' : 'depends'} on ${lin.input.label} directly; the filter needs measurements of states`, 'measure after a block with state, or use a Luenberger observer with your own model');
  const q = Array.isArray(Q) ? Q : [Q];
  if (q.length !== 1 && q.length !== n) throw new DesignError('q-length', `Q has ${q.length} values; the plant this observer sees has ${n} state${n === 1 ? '' : 's'} (${names.join(', ')})`, `give one value (a push on ${lin.input.label}) or one per state`);
  const given = R !== null && R !== undefined;
  const rv = given ? (Array.isArray(R) ? R : [R]) : null;
  if (given && rv.length !== 1 && rv.length !== m) throw new DesignError('r-length', `R has ${rv.length} values; this observer has ${m} measurement${m === 1 ? '' : 's'} (${labels.join(', ')})`, 'give one per measurement, or one for all; empty takes them from the sensor blocks');
  if (!q.every((v) => v >= 0) || (given && !rv.every((v) => v > 0))) throw new DesignError('bad-weights', 'Q must be at least 0 and R above 0');

  const warnings = [];
  // R: given, or what the noise and quantizer blocks on each measurement's way add.
  const parts = given ? [] : lin.sensors.flatMap((s) => s.parts ?? []);
  const r = given ? (rv.length === 1 ? new Array(m).fill(rv[0]) : rv) : lin.sensors.map((s, k) => {
    const v = s.std ** 2 + s.q ** 2 / 12;
    if (v > 0) return v;
    warnings.push(`no sensor block on ${labels[k]}: R = 1`);
    return 1;
  });
  const { Ad, Bd } = c2d(lin.A, lin.B, Ts);
  const diag = (v) => v.map((x, i) => v.map((_, j) => (i === j ? x : 0)));
  const Qw = q.length === 1 ? Bd.map((a) => Bd.map((b) => q[0] * a[0] * b[0])) : diag(q);
  const { L, converged } = dlqe(Ad, lin.C, Qw, diag(r));
  // The estimate's error: e⁺ = (I − L C) Ad e.
  const ILC = L.map((row, i) => lin.C[0].map((_, j) => (i === j ? 1 : 0) - row.reduce((s, l, k) => s + l * lin.C[k][j], 0)));
  const poles = eig(mul(ILC, Ad));
  const radius = Math.max(...poles.map((z) => Math.hypot(z.re, z.im)));
  if (!converged || !(radius < 1)) {
    // Why: a mode that does not decay by itself is either not seen by the
    // measurements, or not driven by any process noise in Q (PBH tests).
    const Ct = transpose(lin.C), mode = stuck(transpose(Ad), Ct, transpose(Qw));
    if (mode && !mode.unreached && mode.unweighted) throw new DesignError('not-detectable', `the estimate's error would not die out: Q gives no process noise to a mode that does not decay by itself (|z| = ${fmt(mode.radius)}), so the filter would trust its model there for ever`, 'give Q a value above 0');
    throw new DesignError('not-detectable', `the estimate's error would not die out: a pole of the filter stays at |z| = ${fmt(radius)}`, `the measurements may not show every state (${names.join(', ')}); measure more, or raise Q`);
  }

  if (outputs !== n) warnings.push(`the plant seen has ${n} state${n === 1 ? '' : 's'} (${names.join(', ')}); set Estimates to ${n}`);
  lin.op.y?.forEach((v, k) => { if (Math.abs(v) > 1e-9) warnings.push(`${labels[k]} reads ${fmt(v)} at the origin: the filter does not know that offset`); });
  lin.delay?.forEach((d, k) => { if (d > 0) warnings.push(`dead time ${fmt(d)} s on ${labels[k]} is not in this filter`); });
  const estimates = Array.from({ length: outputs }, (_, j) => (j < n ? names[j] : '0'));
  const rows = [
    { label: 'estimates', value: estimates, labels: estimates.map((_, j) => `x̂${j + 1}`) },
    { label: 'L', head: ['L', ...labels], table: L.map((row, i) => [names[i], ...row]) },
    { label: 'R', value: r, labels, note: given ? '' : parts.length ? `from ${and(parts)}` : 'none: no sensor blocks' },
    q.length === 1 ? { label: 'Q', value: q[0], note: `a push on ${lin.input.label}, per sample` } : { label: 'Q', value: q, labels: names },
    { label: 'slowest pole', value: slowest(poles, Ts), note: 'of the error' },
  ];
  const values = {
    A: lin.A.flat(), B: lin.B.map((b) => b[0]), C: lin.C.flat(), L: L.flat(),
    stateIndex: Array.from({ length: outputs }, (_, j) => (j < n ? states[j].index : -1)),
  };
  return { values, rows, warnings, quality: { ok: outputs === n } };
}

// A PI that cancels the lag of a first-order fit K e^(−θs) / (τs + 1):
// Kp = τ / (K Tcl), Ki = 1 / (K Tcl) leave the loop a first-order lag with
// time constant Tcl. The dead time θ is not in it.
export function piCancel(fit, Tcl) {
  return { Kp: fit.tau / (fit.K * Tcl), Ki: 1 / (fit.K * Tcl) };
}

// The PI of a scheduledPI variant: at each level of the first measurement
// (p.at) the plant is trimmed, linearised and fitted (linearize.js), and
// piCancel gives the gains there. u0 is the input that holds the first
// measurement where the plant starts, so the loop starts in balance.
// p: { at, Tcl, umin, umax }. Returns { values: { at, Kp, Ki, u0 }, rows,
// warnings, at } (the last: the operating points, for the status).
export function scheduledPIDesign(p, ctx) {
  const model = ctx.model();
  if (!model.m) throw new DesignError('no-measurement', 'this block has no measurement to design a PI for', 'wire the measurement to input 2');
  const out = model.outputs[0], uName = model.input?.label ?? 'u';
  const unit = out.unit ? ` ${out.unit}` : '';
  const limits = { umin: p.umin, umax: p.umax };
  const warnings = [];
  const pts = p.at.map((level) => {
    const lin = ctx.linearize({ y: [level] }, limits);
    refuseKinks(lin, 'pole cancellation');
    const fit = firstOrderFit(lin, 0);
    warnings.push(...fit.warnings);
    return { level, u: lin.op.u, fit, ...piCancel(fit, p.Tcl) };
  });
  // The start: the level y1 has at the initial state, held by u0.
  const y = new Float64Array(model.m);
  model.y(model.x0, 0, y);
  let u0 = 0;
  try { u0 = ctx.trim([y[0]], limits).u; } catch (err) { warnings.push(`u0 = 0: ${err.message}`); }
  const theta = pts[0].fit.theta;
  if (theta > 0) warnings.push(`dead time ${fmt(theta)} s on ${out.label} is not in this design: pole cancellation leaves it out`);
  // Is the closed loop asked for reachable? Not faster than the dead time
  // plus half a sample (the hold's own lag; SIMC: Tcl ≥ θ), nor with a
  // sample time long against it.
  const Ts = ctx.Ts, lag = theta + Ts / 2;
  let ok = true;
  if (p.Tcl < lag) {
    ok = false;
    warnings.push(`Tcl ${fmt(p.Tcl)} s is faster than the loop can be: the dead time ${fmt(theta)} s and half the sample time ${fmt(Ts)} s add ${fmt(lag)} s, and the loop will ring or cycle; make Tcl at least ${fmt(lag)} s`);
  } else if (Ts > p.Tcl / 2) {
    ok = false;
    warnings.push(`the sample time ${fmt(Ts)} s is long against the closed loop Tcl ${fmt(p.Tcl)} s; make Ts at most Tcl / 4 (${fmt(p.Tcl / 4)} s)`);
  } else if (Ts > p.Tcl / 4) warnings.push(`the sample time ${fmt(Ts)} s is long against the closed loop Tcl ${fmt(p.Tcl)} s; Ts ≤ Tcl / 4 (${fmt(p.Tcl / 4)} s) follows it closely`);
  // The dead time is the path's, the same at every level: a row of its own.
  const rows = [
    { label: 'gains', head: [`${out.label}${unit ? ` (${unit.trim()})` : ''}`, uName, 'K', 'τ (s)', 'Kp', 'Ki'], table: pts.map((q) => [q.level, q.u, q.fit.K, q.fit.tau, q.Kp, q.Ki]) },
    { label: 'dead time θ', value: theta, note: theta > 0 ? 's, left out' : 's' },
    { label: 'u0', value: u0, note: `holds ${out.label} = ${fmt(y[0])}${unit}, where it starts` },
  ];
  const at = p.at.length === 1 ? `${out.label} = ${fmt(p.at[0])}${unit}, ${uName} = ${fmt(pts[0].u)}` : `${out.label} = ${fmt(p.at[0])} … ${fmt(p.at.at(-1))}${unit} (${p.at.length} levels)`;
  return { values: { at: [...p.at], Kp: pts.map((q) => q.Kp), Ki: pts.map((q) => q.Ki), u0 }, rows, warnings: [...new Set(warnings)], quality: { ok }, at };
}

// The swing-up of a trajectory variant (designs-in-the-page.md §8.4): from
// where the plant starts to rest at the origin (the upright rest of a
// pendulum chain), planned on the plant this block sees (planner.js), with
// time-varying LQR along the plan and the upright LQR after it.
//   1. The upright LQR at the origin (lqrDesign: every state measured), x following r.
//   2. The plan, a heavy entry keyed by T, segments and the force it may use
//      each way (planShare of u min and of u max), not by Q, R or start:
//      tuning those re-runs steps 3 to 5 (a few ms), never the plan.
//   3. TV-LQR along the plan, ending in the upright P; in measurement order.
//   4. The closed loop on the nonlinear plant as it runs (u = 0 until start,
//      then the plan) until 1 s after the plan.
//   5. Rows: what was planned and checked, the end error, F(t), the upright gains.
// A plan that did not converge, or a loop that does not hold, still runs
// (status 'warn'), so the attempt can be seen.
// p: { T, segments, planShare, start, Q, R, umin, umax }.
export function trajectoryDesign(p, ctx) {
  const lin = ctx.linearize('origin');
  const Ts = ctx.Ts;
  if (!(p.umin < 0 && p.umax > 0)) throw new DesignError('bad-limits', `the swing-up pushes both ways: u min must be below 0 and u max above 0 (now ${fmt(p.umin)} to ${fmt(p.umax)})`, 'set the actuator\'s limits; an open limit (empty) is fine');
  const up = lqrDesign(lin, { Q: p.Q, R: p.R, track: 1, Ts });
  const model = ctx.model();
  const labels = lin.outputs.map((o) => o.label), uName = lin.input.label;
  // The force the plan may use each way; the rest of each limit is the feedback's.
  const Fmin = p.planShare * p.umin, Fmax = p.planShare * p.umax;
  // Where it starts, states with the same value grouped: 'θ1, θ2, θ3 = 3.142 rad → origin'.
  const groups = [];
  model.states.forEach((s, i) => {
    const v = model.x0[i], text = `${fmt(v)}${s.unit ? ` ${s.unit}` : ''}`;
    if (Math.abs(v) < 1e-12) return;
    const g = groups.at(-1);
    if (g && g.text === text) g.names.push(s.name); else groups.push({ names: [s.name], text });
  });
  const at = `${groups.length ? groups.map((g) => `${g.names.join(', ')} = ${g.text}`).join(', ') : 'rest'} → origin`;
  const h = ctx.heavy('plan', { version: PLAN_VERSION, T: p.T, segments: p.segments, Fmin, Fmax }, function* plan() {
    const pl = yield* planTransfer(model, { T: p.T, Ts, segments: p.segments, Fmin, Fmax });
    const along = yield* alongPlanSteps(model, pl);
    return { plan: pl, along };
  }, { title: 'Swing-up' });
  // In the page the plan is made in the background: until then u = 0 (or the previous plan).
  if (h.status !== 'ready') return { pending: h.progress ?? null, at, warnings: up.warnings };
  const { plan, along } = h.value;
  const Kx = tvlqrGains(along, { Q: up.Qx, R: p.R, Pend: up.P });
  const values = planValues(model, along, Kx, { K: up.K, kr: up.kr });
  // The loop on the nonlinear plant as it runs, from t = 0 (u = 0 until
  // start), with the limits; the law unclamped, so the peak it asks for shows.
  const check = verifyLoop(model, planLaw(values, Ts, { start: p.start }), { Ts, sub: plan.sub, duration: p.start + plan.T + 1, umin: p.umin, umax: p.umax });
  const limText = ` (limits ${fmt(p.umin)} to ${fmt(p.umax)})`;
  const end = check.endError, endText = `${end.label} is ${fmt(Math.abs(end.value))}${end.unit ? ` ${end.unit}` : ''} off`;
  const warnings = [...up.warnings];
  // The plan starts from the start state: a plant that moves before start is not where it assumes.
  if (p.start > 0) {
    const f = new Float64Array(model.n);
    model.f(model.x0, 0, f);
    if (f.some((v) => Math.abs(v) > 1e-6)) warnings.push(`the plant does not rest at its start state, and the plan assumes it does until start (${fmt(p.start)} s): start at 0, or start the plant at rest`);
  }
  if (!plan.ok) warnings.push(`${plan.message}: ${plan.hint}`);
  const over = check.Fpeak > Math.min(-p.umin, p.umax);
  if (!check.ok) warnings.push(`the loop does not hold: ${endText} 1 s after the plan; peak ${uName} ${fmt(check.Fpeak)}${limText}: ${over ? 'lengthen T or raise the limits' : 'lengthen T, or weigh the states more (Q)'}`);
  const planned = `${plan.ok ? 'Planned' : 'Not converged'} in ${(h.ms / 1000).toFixed(1)} s (${plan.iterations} iterations, start ${plan.start} of ${plan.starts}).`;
  const held = check.ok ? `Verified: at rest at the origin 1 s after T, peak ${uName} ${fmt(check.Fpeak)}${limText}.` : `The loop does not hold: ${endText} 1 s after T.`;
  // F(t) for a sparkline, at most 120 points.
  const every = Math.max(1, Math.ceil(plan.F.length / 120));
  const spark = Array.from(plan.F).filter((_, i) => i % every === 0);
  const ends = model.states.map((s, i) => [s.name, plan.terminal[i]]);
  const rows = [
    { label: 'plan', value: `${planned} ${held}`, sentence: true },
    { label: 'T', value: plan.T, note: `s, ${plan.segments} segments of ${plan.perSegment} samples` },
    { label: `${uName}(t)`, spark, note: `${fmt(plan.Flo)} to ${fmt(plan.Fhi)}${Number.isFinite(Fmax) || Number.isFinite(Fmin) ? `, of ${fmt(Fmin)} to ${fmt(Fmax)} it may use` : ''}` },
    { label: 'end error', value: ends.map(([, v]) => v), labels: ends.map(([n]) => n) },
    { label: 'defect', value: plan.defect, note: 'between segments' },
    { label: 'K at the origin', value: up.K, labels },
    ...up.rows.slice(1),
  ];
  return { values, rows, warnings: [...new Set(warnings)], quality: { ok: plan.ok && check.ok }, at };
}
