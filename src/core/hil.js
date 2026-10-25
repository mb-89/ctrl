// Live (HIL) mode, the protocol side: messages between the page and an
// external plant, the plant's description, the page's watchdog, link
// statistics, and the External plant block. No DOM, no sockets: the loop that
// uses them is live.js. The protocol is in design/output/hil.md.
//
// JSON-RPC 2.0, one message per WebSocket text frame. The plant is the
// server (a page cannot listen on a port) and owns the clock:
//   page -> plant   describe, start { log }, stop, reset, estop   requests
//                   u { seq, u: [...], log: [...] }       the answer to each y
//   plant -> page   y { seq, t, y: [...], applied?: [...] }  every cycle
//                   estop { reason, t }, running { running, by, reason },
//                   status { ... }                        notifications
// Two modes (settled): in control mode the plant's inputs are efforts and
// the page is the controller (u carries r and e along for the plant's log
// only); in reference mode the plant runs its own controller and its inputs
// are references. A plant with no inputs only reports (logging): the page
// answers each y with an empty u, so the plant's watchdog sees a live page.

export const HIL_URL = 'ws://127.0.0.1:8765';
export const HIL_PROTOCOL = 'loop-tuner-hil/1';
export const WATCHDOG_CYCLES = 10;

export const rpcRequest = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
export const rpcNotice = (method, params) => JSON.stringify({ jsonrpc: '2.0', method, params });
const nine = (v) => (Number.isFinite(v) ? Number(v.toPrecision(9)) : null);
// The page's answer to y number seq: the inputs to apply from now on, and the
// values for the plant's log (declared once, in start's params; the physics
// ignores them).
export const uMessage = (seq, u, log) => rpcNotice('u', { seq, u: Array.from(u, nine), ...(log?.length ? { log: Array.from(log, nine) } : {}) });
// start's params: the names and units of the values each u carries for the
// plant's log (control mode: r and e).
export const startParams = (log) => (log?.length ? { log: log.map(({ name, unit }) => ({ name, unit })) } : undefined);

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// Reads one frame from the plant. Never throws: what it cannot use comes back
// as { kind: 'invalid', error }.
export function parseMessage(text) {
  let m;
  try { m = JSON.parse(text); } catch { return { kind: 'invalid', error: 'not JSON' }; }
  if (!m || typeof m !== 'object' || m.jsonrpc !== '2.0') return { kind: 'invalid', error: 'not a JSON-RPC 2.0 message' };
  if (m.id !== undefined && m.id !== null && !m.method) {
    if (m.error) return { kind: 'error', id: m.id, error: String(m.error.message ?? 'error'), code: m.error.code };
    return { kind: 'result', id: m.id, result: m.result };
  }
  if (m.id === null && m.error) return { kind: 'invalid', error: String(m.error.message ?? 'error') };
  const p = m.params ?? {};
  if (m.method === 'y') {
    if (!Number.isInteger(p.seq) || !finite(p.t) || !Array.isArray(p.y)) return { kind: 'invalid', error: 'y needs seq (integer), t (s) and y (a list)' };
    // applied (optional): the inputs the plant applied over the cycle just
    // ended, after its clamps; null when the plant does not say.
    const applied = Array.isArray(p.applied) ? p.applied.map((v) => (finite(v) ? v : NaN)) : null;
    return { kind: 'y', seq: p.seq, t: p.t, y: p.y.map((v) => (finite(v) ? v : NaN)), applied };
  }
  if (m.method === 'estop') return { kind: 'estop', reason: String(p.reason ?? 'E-stop'), t: finite(p.t) ? p.t : null };
  // The plant started or stopped on its own (its Run/Stop key): the page follows.
  if (m.method === 'running') {
    if (typeof p.running !== 'boolean') return { kind: 'invalid', error: 'running needs running (true or false)' };
    return { kind: 'running', running: p.running, by: String(p.by ?? 'plant'), reason: p.reason ? String(p.reason) : '' };
  }
  if (m.method === 'status') return { kind: 'status', status: p };
  return { kind: 'invalid', error: `unknown method ${m.method}` };
}

// Port names label the External block's ports; units follow the Sink rules.
const PORT_NAME = /^[A-Za-z][A-Za-z0-9_]{0,15}$/;
const checkUnit = (u, where) => {
  const s = String(u ?? '1').trim() || '1';
  if (s.length > 12 || /[<>"{},]/.test(s)) throw new Error(`${where}: a short unit such as V, rad/s or 1`);
  return s;
};

// What a plant's input is: an effort (control mode: the page's controller
// drives it), a reference (reference mode: the plant's own controller follows
// it), or a disturbance (a test input, such as a load torque).
export const INPUT_KINDS = ['effort', 'reference', 'disturbance'];
// The mode a set of inputs makes: reference if any input is a reference, log
// (the plant only reports) if there are none, else control.
export const modeOf = (kinds) => (!kinds.length ? 'log' : kinds.includes('reference') ? 'reference' : 'control');
const range = (p, where, [a, b] = ['min', 'max'], what = 'its full scale') => {
  if (p?.[a] === undefined && p?.[b] === undefined) return [null, null];
  const lo = Number(p[a]), hi = Number(p[b]);
  if (!finite(lo) || !finite(hi) || !(lo < hi)) throw new Error(`${where} needs ${a} < ${b} (${what})`);
  return [lo, hi];
};

// The plant's answer to describe, checked: { protocol, name, rate_hz, mode,
// inputs: [{ name, unit, min, max, safe, kind, measures }], outputs: [{ name,
// unit, min, max, hard_min, hard_max, kind }], watchdog, estop, running,
// slew }. Inputs have a full scale (min … max, also their limits); outputs
// may (min … max: what the scope shows, null if not given), and may have a
// hard range (hard_min … hard_max: beyond it the plant E-stops; usually
// inside the full scale, null if not given). An input's kind defaults to the
// plant's mode ("mode": "reference" makes them references); a reference may
// name the output it is compared with (measures).
export function checkDescription(d) {
  if (!d || typeof d !== 'object') throw new Error('describe: expected an object');
  const rate = Number(d.rate_hz);
  if (!(rate >= 1 && rate <= 1000)) throw new Error('describe: rate_hz between 1 and 1000');
  const port = (p, i, side) => {
    const where = `describe: ${side}[${i}]`;
    if (!PORT_NAME.test(p?.name ?? '')) throw new Error(`${where}.name: letters, digits and _, up to 16`);
    return { name: p.name, unit: checkUnit(p.unit, `${where}.unit`) };
  };
  if (!Array.isArray(d.inputs) || d.inputs.length > 8) throw new Error('describe: inputs, a list of 0 to 8');
  if (!Array.isArray(d.outputs) || !d.outputs.length || d.outputs.length > 16) throw new Error('describe: outputs, a list of 1 to 16');
  const outputs = d.outputs.map((p, i) => {
    const [min, max] = range(p, `describe: outputs[${i}]`);
    const [hard_min, hard_max] = range(p, `describe: outputs[${i}]`, ['hard_min', 'hard_max'], 'its hard range: beyond it the plant E-stops');
    const kind = p.kind === 'effort' ? 'effort' : 'measurement';
    return { ...port(p, i, 'outputs'), min, max, hard_min, hard_max, kind };
  });
  const byDefault = d.mode === 'reference' ? 'reference' : 'effort';
  const inputs = d.inputs.map((p, i) => {
    const q = port(p, i, 'inputs');
    const min = Number(p.min), max = Number(p.max), safe = Number(p.safe ?? 0);
    if (!finite(min) || !finite(max) || !(min <= max)) throw new Error(`describe: inputs[${i}] needs min <= max`);
    if (!(safe >= min && safe <= max)) throw new Error(`describe: inputs[${i}].safe must lie within min and max`);
    const kind = p.kind ?? byDefault;
    if (!INPUT_KINDS.includes(kind)) throw new Error(`describe: inputs[${i}].kind: one of ${INPUT_KINDS.join(', ')}`);
    const measures = p.measures ? String(p.measures) : '';
    if (measures && !outputs.some((o) => o.name === measures)) throw new Error(`describe: inputs[${i}].measures: "${measures}" is not an output`);
    return { ...q, min, max, safe, kind, measures };
  });
  const slew = Number(d.slew);
  return {
    // Which protocol the plant speaks; the page warns when it is not this one.
    protocol: String(d.protocol ?? ''),
    name: String(d.name ?? 'external plant').slice(0, 80),
    rate_hz: rate,
    mode: modeOf(inputs.map((p) => p.kind)),
    inputs,
    outputs,
    watchdog: Number.isInteger(d.watchdog_cycles) && d.watchdog_cycles > 0 ? d.watchdog_cycles : WATCHDOG_CYCLES,
    estop: d.estop ? String(d.estop) : null,
    running: !!d.running,
    // The plant limits how fast its inputs change (fraction of full scale per
    // second), if it says so; the page's ramp-in is its own.
    slew: finite(slew) && slew > 0 ? slew : null,
  };
}

// ---- The External plant block (ELEMENTS.external in diagram.js)
// Its ports are the plant's: what the page sends (inputs, with their limits,
// safe values and kinds) and what it receives (outputs, with their full
// scales and hard ranges). They are design inputs, set from the plant's description when it
// connects and kept in the project, so the diagram is valid offline, where
// the outputs hold 0. Two settings are the page's own and stay when the
// plant's ports are taken: the ramp-in (% of full scale per second) and the
// full scales set for references (scales: { name: [lo, hi] }).

export const RAMP_DEFAULT = 10;  // % of full scale per second
const split = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[,;]/)).map((x) => String(x).trim()).filter((x) => x !== '');
// The same, keeping empty places (an output without a full scale).
const splitKeep = (v) => (Array.isArray(v) ? v.map((x) => (x === null || x === undefined ? '' : String(x).trim())) : String(v ?? '').trim() === '' ? [] : String(v).split(/[,;]/).map((x) => x.trim()));
const numbers = (v, where) => split(v).map((x) => {
  const n = Number(String(x).replace(/−/g, '-'));
  if (!finite(n)) throw new Error(`${where}: numbers separated by commas`);
  return n;
});
const maybeNumbers = (v, where) => splitKeep(v).map((x) => {
  if (x === '' || x === '–' || /^(none|null|nan)$/i.test(x)) return null;
  const n = Number(x.replace(/−/g, '-'));
  if (!finite(n)) throw new Error(`${where}: numbers separated by commas (empty: not given)`);
  return n;
});
// A list with one entry per port: missing entries take the default, extra ones go.
const fit = (list, n, def) => Array.from({ length: n }, (_, i) => list[i] ?? (typeof def === 'function' ? def(i) : def));

export const EXTERNAL_BLOCK = {
  label: 'External plant', group: 'Live', formula: 'u → plant → y, live over WebSocket',
  params: [
    { key: 'url', label: 'Plant at', default: HIL_URL, kind: 'text' },
    { key: 'rate', label: 'Cycle rate', default: 100, unit: 'Hz', min: 1, max: 1000 },
    { key: 'inputs', label: 'Inputs u', default: ['u'], kind: 'list' },
    { key: 'inUnits', label: 'Units of u', default: ['1'], kind: 'list' },
    { key: 'min', label: 'u min', default: [-1], kind: 'list' },
    { key: 'max', label: 'u max', default: [1], kind: 'list' },
    { key: 'safe', label: 'Safe u', default: [0], kind: 'list' },
    { key: 'kinds', label: 'Kinds of u', default: [], kind: 'list' },
    { key: 'measures', label: 'u measured as', default: [], kind: 'list' },
    { key: 'outputs', label: 'Outputs y', default: ['y'], kind: 'list' },
    { key: 'outUnits', label: 'Units of y', default: ['1'], kind: 'list' },
    { key: 'outMin', label: 'y full scale min', default: [], kind: 'list' },
    { key: 'outMax', label: 'y full scale max', default: [], kind: 'list' },
    // The hard range: beyond it the plant E-stops (from describe).
    { key: 'ymin', label: 'y hard min', default: [], kind: 'list' },
    { key: 'ymax', label: 'y hard max', default: [], kind: 'list' },
    { key: 'ramp', label: 'Ramp-in', default: RAMP_DEFAULT, unit: '%/s', min: 0.01, max: 1000 },
    { key: 'scales', label: 'Full scales', default: {}, kind: 'hidden' },
  ],
  ports: (p) => [p.inputs.length, p.outputs.length],
  outputs: (p) => p.outputs,
  inputNames: (p) => p.inputs,  // labels on the canvas, as the outputs have
  summary: (p) => `${p.rate} Hz${modeOf(p.kinds ?? []) === 'reference' ? ' · reference mode' : !p.inputs.length ? ' · logging' : ''}`,
  // Lists may be typed as "a, b" in the Plant tab or given as JSON arrays.
  normalize(params = {}, where = 'external') {
    const d = Object.fromEntries(EXTERNAL_BLOCK.params.map((p) => [p.key, params[p.key] ?? p.default]));
    const url = String(d.url).trim();
    if (!/^wss?:\/\/[^\s"'<>]{1,200}$/.test(url)) throw new Error(`${where}.url: a WebSocket address such as ${HIL_URL}`);
    const rate = Number(d.rate);
    if (!(rate >= 1 && rate <= 1000)) throw new Error(`${where}.rate: between 1 and 1000 Hz`);
    const names = (v, key, least) => {
      const out = split(v);
      if (out.length < least || out.length > 16) throw new Error(`${where}.${key}: ${least} to 16 names, separated by commas`);
      for (const n of out) if (!PORT_NAME.test(n)) throw new Error(`${where}.${key}: "${n}" is not a name (letters, digits, _)`);
      return out;
    };
    // A plant may take no inputs (it only reports); it always has outputs.
    const inputs = names(d.inputs, 'inputs', 0), outputs = names(d.outputs, 'outputs', 1);
    const n = inputs.length, m = outputs.length;
    const min = fit(numbers(d.min, `${where}.min`), n, -1), max = fit(numbers(d.max, `${where}.max`), n, 1);
    for (let i = 0; i < n; i++) if (min[i] > max[i]) [min[i], max[i]] = [max[i], min[i]];
    const safe = fit(numbers(d.safe, `${where}.safe`), n, (i) => Math.min(max[i], Math.max(min[i], 0))).map((v, i) => Math.min(max[i], Math.max(min[i], v)));
    const kinds = fit(splitKeep(d.kinds).map((k) => k || 'effort'), n, 'effort');
    for (const k of kinds) if (!INPUT_KINDS.includes(k)) throw new Error(`${where}.kinds: one of ${INPUT_KINDS.join(', ')} per input`);
    const measures = fit(splitKeep(d.measures), n, '');
    for (const o of measures) if (o && !outputs.includes(o)) throw new Error(`${where}.measures: "${o}" is not an output`);
    // Pairs per output: a pair that is incomplete or empty is not given.
    const pairs = (a, b) => {
      const lo = fit(maybeNumbers(d[a], `${where}.${a}`), m, null), hi = fit(maybeNumbers(d[b], `${where}.${b}`), m, null);
      for (let j = 0; j < m; j++) if (lo[j] === null || hi[j] === null || !(lo[j] < hi[j])) lo[j] = hi[j] = null;
      return [lo, hi];
    };
    const [outMin, outMax] = pairs('outMin', 'outMax'), [ymin, ymax] = pairs('ymin', 'ymax');
    const ramp = Number(d.ramp);
    if (!(ramp >= 0.01 && ramp <= 1000)) throw new Error(`${where}.ramp: from 0.01 to 1000 % of full scale per second`);
    const scales = {};
    for (const [name, pair] of Object.entries(d.scales && typeof d.scales === 'object' ? d.scales : {})) {
      const [lo, hi] = Array.isArray(pair) ? pair.map(Number) : [NaN, NaN];
      if (!PORT_NAME.test(name) || !finite(lo) || !finite(hi) || !(lo < hi)) throw new Error(`${where}.scales.${name}: [min, max] with min < max`);
      scales[name] = [lo, hi];
    }
    return {
      url, rate, inputs,
      inUnits: fit(split(d.inUnits), n, '1').map((u, i) => checkUnit(u, `${where}.inUnits[${i}]`)),
      min, max, safe, kinds, measures, outputs,
      outUnits: fit(split(d.outUnits), m, '1').map((u, i) => checkUnit(u, `${where}.outUnits[${i}]`)),
      outMin, outMax, ymin, ymax, ramp, scales,
    };
  },
};

// The block's parameters for a plant's description, keeping the page's own
// settings of the block it replaces (where the plant lives, the ramp-in, the
// full scales set for references).
export function externalParams(desc, prev = {}) {
  const keep = typeof prev === 'string' ? { url: prev } : prev ?? {};
  return EXTERNAL_BLOCK.normalize({
    url: keep.url ?? HIL_URL, rate: desc.rate_hz,
    inputs: desc.inputs.map((p) => p.name), inUnits: desc.inputs.map((p) => p.unit),
    min: desc.inputs.map((p) => p.min), max: desc.inputs.map((p) => p.max), safe: desc.inputs.map((p) => p.safe),
    kinds: desc.inputs.map((p) => p.kind ?? 'effort'), measures: desc.inputs.map((p) => p.measures ?? ''),
    outputs: desc.outputs.map((p) => p.name), outUnits: desc.outputs.map((p) => p.unit),
    outMin: desc.outputs.map((p) => p.min ?? null), outMax: desc.outputs.map((p) => p.max ?? null),
    ymin: desc.outputs.map((p) => p.hard_min ?? null), ymax: desc.outputs.map((p) => p.hard_max ?? null),
    ramp: keep.ramp ?? RAMP_DEFAULT, scales: keep.scales ?? {},
  });
}

// The mode of a block (from its inputs' kinds): control, reference or log.
export const blockMode = (params) => modeOf(params.kinds ?? []);

// The External plant block of a diagram, at any depth, and the level it is
// on: { block, level }, or null.
export function findExternal(d) {
  for (const b of d?.blocks ?? []) {
    if (b.type === 'external') return { block: b, level: d };
    if (b.type === 'subsystem') { const hit = findExternal(b.diagram); if (hit) return hit; }
  }
  return null;
}

// Whether the block's ports carry the plant's names, in the plant's order:
// what the loop relies on, since values travel by position.
export const samePorts = (params, desc) => params.inputs.join() === desc.inputs.map((p) => p.name).join() && params.outputs.join() === desc.outputs.map((p) => p.name).join();

// Whether a block already matches a description (then connecting changes nothing).
export function sameDescription(params, desc) {
  const want = externalParams(desc, params);
  return JSON.stringify(want) === JSON.stringify(EXTERNAL_BLOCK.normalize(params));
}

// ---- Full scale (Live): every live signal has one, for orientation on the
// scope and for the ramp-in. An External output has the plant's (outMin …
// outMax); a signal that feeds an External input has that input's range; a
// reference compared with an output (a Controller's r, or a reference input
// that measures it) has the output's; full scales set in the block (scales)
// win. links: what compileDiagram's links() says about the diagram (who
// feeds what). Returns { name: [lo, hi] } for the signals it knows.
export function fullScales(params, links) {
  const out = {};
  const outRange = (j) => (j >= 0 && params.outMin?.[j] !== null && params.outMin?.[j] !== undefined && params.outMax?.[j] !== null ? [params.outMin[j], params.outMax[j]] : null);
  const inRange = (i) => [params.min[i], params.max[i]];
  for (const [name, at] of Object.entries(links?.sinks ?? {})) {
    const r = at.output !== undefined ? outRange(at.output) : at.input !== undefined ? inRange(at.input) : null;
    if (r) out[name] = r;
  }
  for (const [name, at] of Object.entries(links?.sources ?? {})) {
    let r = null;
    if (at.measured !== undefined) r = outRange(at.measured);
    if (!r && at.input !== undefined) {
      const j = params.outputs.indexOf(params.measures?.[at.input] ?? '');
      r = (params.kinds?.[at.input] === 'reference' ? outRange(j) : null) ?? inRange(at.input);
    }
    if (r) out[name] = r;
  }
  for (const [name, pair] of Object.entries(params.scales ?? {})) out[name] = [...pair];
  return out;
}

// A channel showing a signal of full scale [lo, hi]: the 8 divisions span it.
export function fullScaleChannel([lo, hi]) {
  const scale = Number(((hi - lo) / 8).toPrecision(4));
  return { scale, offset: Number((-(lo + hi) / 2).toPrecision(6)) || 0 };
}

// ---- The page's watchdog: a pure function of the time, so it can be tested.
// The plant is silent once no y has come for `cycles` of its cycles.
export function pageWatchdog({ now, lastY, rateHz, cycles = WATCHDOG_CYCLES }) {
  const silent = Math.max(0, Math.floor(((now - lastY) / 1000) * rateHz + 1e-9));
  return { silent, trip: silent >= cycles };
}

// ---- What the page sees of the link, over the last second: the cycle rate,
// the arrival jitter (largest deviation from the cycle), y that never came
// (gaps in seq), and the page's own time per cycle. Arrival times in ms.
export function createLinkStats(rateHz) {
  let n = 0, t0 = null, last = null, lastSeq = null, jitter = 0, compute = 0, computeMax = 0;
  let missed = 0;
  const period = 1000 / rateHz;
  return {
    add(at, seq, computeMs = 0) {
      if (lastSeq !== null && seq > lastSeq + 1) missed += seq - lastSeq - 1;
      if (last !== null && lastSeq !== null && seq === lastSeq + 1) jitter = Math.max(jitter, Math.abs(at - last - period));
      t0 ??= at;
      n++; last = at; lastSeq = seq;
      compute += computeMs; computeMax = Math.max(computeMax, computeMs);
    },
    // The figures since the last read; missed y counts from the start.
    read() {
      const span = n > 1 ? (last - t0) / 1000 : 0;
      const out = { rate: span > 0 ? (n - 1) / span : 0, jitter, missed, compute: n ? compute / n : 0, computeMax };
      jitter = 0; compute = 0; computeMax = 0;
      t0 = last; n = last === null ? 0 : 1;
      return out;
    },
  };
}
