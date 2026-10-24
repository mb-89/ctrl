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

import { c2d, dlqr, eig, solve, rank, mul, transpose } from './linalg.js';
import { DesignError, operatingPoint, linearize, firstOrderFit } from './linearize.js';

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
// block: { idPath, name, kind: 'controller' | 'observer', Ts, inputs (labels), input (u's label) }.
// A status is what the Controller tab, the CLI and agents see; its values
// are not enumerable, so a status prints and serialises without them.
// The 'sync' mode runs every design at once (Node, the CLI, tests, and the
// page until heavy designs exist).
export function createDesignStore({ mode = 'sync', limit = 64 } = {}) {
  if (mode !== 'sync') throw new Error(`design store mode "${mode}": only 'sync' exists so far`);
  const designs = new Map(), models = new Map();
  const counts = { runs: 0, hits: 0, heavyRuns: 0 };
  const remember = (map, key, value, size) => { map.delete(key); map.set(key, value); if (map.size > size) map.delete(map.keys().next().value); };

  // Runs one design; never throws. A DesignError becomes the status's error;
  // anything else is a bug, reported with code 'internal'.
  function run(def, p, block, compiled, seeThrough) {
    const used = { model: null, at: '', warnings: [] };
    const lins = new Map();
    const ctx = {
      Ts: block.Ts, idPath: block.idPath, name: block.name, kind: block.kind, inputs: block.inputs,
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
    };
    const t0 = now();
    let out;
    try {
      out = def.design(p, ctx);
      if (!out || out.pending) throw new DesignError('pending', 'this design runs in the background, which this store cannot do yet');
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

  return {
    mode,
    generation: 0,
    begin(diagram, compileModel) {
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
      return {
        resolve(block, variant, lib) {
          const def = lib[variant.type];
          const key = hashKey(canonical([variant.type, def.version ?? 1, variant.params, block.Ts, plant(), block.idPath]));
          let entry = designs.get(key), cached = !!entry;
          if (cached) counts.hits++;
          else { counts.runs++; entry = run(def, variant.params, block, compiled, seeThrough); }
          remember(designs, key, entry, limit);
          if (block.kind === 'observer' && entry.values?.stateIndex) seeThrough.set(block.idPath, entry.values.stateIndex);
          const seen = entry.states ? `${block.input} → ${block.inputs.slice(1).join(', ')} · ${entry.states.length} state${entry.states.length === 1 ? '' : 's'} (${entry.states.join(', ')})` : '';
          const status = {
            path: block.idPath, block: block.name, variant: variant.name, type: variant.type, key,
            status: entry.status, ms: Number(entry.ms.toFixed(2)), cached,
            at: entry.at, seen, rows: entry.rows, warnings: entry.warnings, error: entry.error, progress: null,
          };
          Object.defineProperty(status, 'values', { value: entry.values, enumerable: false });
          return status;
        },
        end() {},
      };
    },
    // How often designs ran and were found in the cache.
    stats: () => ({ ...counts }),
    idle: () => Promise.resolve(),
  };
}

// The store compileDiagram uses when it is given none.
export const SYNC_DESIGNS = createDesignStore();

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
// static gain from r to 1. Returns { K, kr, Kx, P, Ad, Bd, poles, rows, warnings }.
export function lqrDesign(lin, { Q, R, track = 1, Ts }) {
  const { n, m, states, outputs } = lin;
  const labels = outputs.map((o) => o.label);
  if (n > 40) throw new DesignError('too-many-states', `the plant this block sees has ${n} states; LQR here handles up to 40`);
  if (n === 0) throw new DesignError('no-states', `${lin.input.label} moves none of the measurements (${labels.join(', ')})`, lin.warnings.join('; ') || 'wire the controller output to the plant, and the plant to the measurements');
  if (lin.op.kind === 'origin' && !lin.op.rest) throw new DesignError('not-at-rest', `the plant is not at rest at the origin: ${lin.op.warnings[0].replace(/^the origin is not at rest: /, '')}`, 'LQR is designed at the origin, which must be an equilibrium with u = 0');
  // Every state measured, and only states.
  const direct = labels.filter((_, k) => lin.D[k][0] !== 0);
  if (direct.length) throw new DesignError('states-not-measured', `LQR needs measurements of states; ${direct.join(', ')} depends on ${lin.input.label} directly`, 'feed back states only (a Sink of u is fine, an input of the controller is not)');
  if (m !== n || rank(lin.C) < n) {
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
  if (!converged || !(radius < 1)) throw new DesignError('not-stabilisable', `LQR finds no gain that holds this plant (a closed-loop pole stays at |z| = ${fmt(radius)})`, `${lin.input.label} may not reach every state; check the wiring`);
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
  // The slowest closed-loop pole, as a continuous one: s = ln(z) / Ts.
  const slow = poles.reduce((a, z) => (Math.hypot(z.re, z.im) > Math.hypot(a.re, a.im) ? z : a));
  const s = { re: Math.log(Math.hypot(slow.re, slow.im)) / Ts, im: Math.atan2(slow.im, slow.re) / Ts };
  const wn = Math.hypot(s.re, s.im), zeta = wn > 0 ? -s.re / wn : 1;
  const rows = [
    { label: 'K', value: K, labels },
    { label: 'kr', value: kr, note: track ? `${labels[track - 1]} follows r` : 'r is not used' },
    { label: 'slowest pole', value: `${fmt(wn)} rad/s, ζ ${fmt(zeta)}` },
  ];
  return { K, kr, Kx, P, Ad, Bd, poles, rows, warnings };
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
  const rows = [
    { label: 'gains', head: [`${out.label}${unit ? ` (${unit.trim()})` : ''}`, uName, 'K', 'τ (s)', 'θ (s)', 'Kp', 'Ki'], table: pts.map((q) => [q.level, q.u, q.fit.K, q.fit.tau, q.fit.theta, q.Kp, q.Ki]) },
    { label: 'u0', value: u0, note: `holds ${out.label} = ${fmt(y[0])}${unit}, where it starts` },
  ];
  const at = p.at.length === 1 ? `${out.label} = ${fmt(p.at[0])}${unit}, ${uName} = ${fmt(pts[0].u)}` : `${out.label} = ${fmt(p.at[0])} … ${fmt(p.at.at(-1))}${unit} (${p.at.length} levels)`;
  return { values: { at: [...p.at], Kp: pts.map((q) => q.Kp), Ki: pts.map((q) => q.Ki), u0 }, rows, warnings: [...new Set(warnings)], at };
}
