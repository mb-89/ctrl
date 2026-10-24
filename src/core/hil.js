// Live (HIL) mode, the protocol side: messages between the page and an
// external plant, the plant's description, the page's watchdog, link
// statistics, and the External plant block. No DOM, no sockets: the loop that
// uses them is live.js. The protocol is in design/output/hil.md.
//
// JSON-RPC 2.0, one message per WebSocket text frame. The plant is the
// server (a page cannot listen on a port) and owns the clock:
//   page -> plant   describe, start, stop, reset, estop   requests (with an id)
//                   u { seq, u: [...] }                   the answer to each y
//   plant -> page   y { seq, t, y: [...] }                every cycle
//                   estop { reason, t }, status { ... }   notifications

export const HIL_URL = 'ws://127.0.0.1:8765';
export const HIL_PROTOCOL = 'loop-tuner-hil/1';
export const WATCHDOG_CYCLES = 10;

export const rpcRequest = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
export const rpcNotice = (method, params) => JSON.stringify({ jsonrpc: '2.0', method, params });
// The page's answer to y number seq: the inputs to apply from now on.
export const uMessage = (seq, u) => rpcNotice('u', { seq, u: Array.from(u, (v) => (Number.isFinite(v) ? Number(v.toPrecision(9)) : null)) });

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
    return { kind: 'y', seq: p.seq, t: p.t, y: p.y.map((v) => (finite(v) ? v : NaN)) };
  }
  if (m.method === 'estop') return { kind: 'estop', reason: String(p.reason ?? 'E-stop'), t: finite(p.t) ? p.t : null };
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

// The plant's answer to describe, checked: { name, rate_hz, inputs: [{ name,
// unit, min, max, safe }], outputs: [{ name, unit }], watchdog, estop, running }.
export function checkDescription(d) {
  if (!d || typeof d !== 'object') throw new Error('describe: expected an object');
  const rate = Number(d.rate_hz);
  if (!(rate >= 1 && rate <= 1000)) throw new Error('describe: rate_hz between 1 and 1000');
  const port = (p, i, side) => {
    const where = `describe: ${side}[${i}]`;
    if (!PORT_NAME.test(p?.name ?? '')) throw new Error(`${where}.name: letters, digits and _, up to 16`);
    return { name: p.name, unit: checkUnit(p.unit, `${where}.unit`) };
  };
  if (!Array.isArray(d.inputs) || !d.inputs.length || d.inputs.length > 8) throw new Error('describe: inputs, a list of 1 to 8');
  if (!Array.isArray(d.outputs) || !d.outputs.length || d.outputs.length > 16) throw new Error('describe: outputs, a list of 1 to 16');
  const inputs = d.inputs.map((p, i) => {
    const q = port(p, i, 'inputs');
    const min = Number(p.min), max = Number(p.max), safe = Number(p.safe ?? 0);
    if (!finite(min) || !finite(max) || !(min <= max)) throw new Error(`describe: inputs[${i}] needs min <= max`);
    if (!(safe >= min && safe <= max)) throw new Error(`describe: inputs[${i}].safe must lie within min and max`);
    return { ...q, min, max, safe };
  });
  return {
    name: String(d.name ?? 'external plant').slice(0, 80),
    rate_hz: rate,
    inputs,
    outputs: d.outputs.map((p, i) => port(p, i, 'outputs')),
    watchdog: Number.isInteger(d.watchdog_cycles) && d.watchdog_cycles > 0 ? d.watchdog_cycles : WATCHDOG_CYCLES,
    estop: d.estop ? String(d.estop) : null,
    running: !!d.running,
  };
}

// ---- The External plant block (ELEMENTS.external in diagram.js)
// Its ports are the plant's: what the page sends (inputs, with their limits
// and safe values) and what it receives (outputs). They are design inputs,
// set from the plant's description when it connects and kept in the project,
// so the diagram is valid offline, where the outputs hold 0.

const split = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[,;]/)).map((x) => String(x).trim()).filter((x) => x !== '');
const numbers = (v, where) => split(v).map((x) => {
  const n = Number(String(x).replace(/−/g, '-'));
  if (!finite(n)) throw new Error(`${where}: numbers separated by commas`);
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
    { key: 'outputs', label: 'Outputs y', default: ['y'], kind: 'list' },
    { key: 'outUnits', label: 'Units of y', default: ['1'], kind: 'list' },
  ],
  ports: (p) => [p.inputs.length, p.outputs.length],
  outputs: (p) => p.outputs,
  summary: (p) => `${p.rate} Hz`,
  // Lists may be typed as "a, b" in the Plant tab or given as JSON arrays.
  normalize(params = {}, where = 'external') {
    const d = Object.fromEntries(EXTERNAL_BLOCK.params.map((p) => [p.key, params[p.key] ?? p.default]));
    const url = String(d.url).trim();
    if (!/^wss?:\/\/[^\s"'<>]{1,200}$/.test(url)) throw new Error(`${where}.url: a WebSocket address such as ${HIL_URL}`);
    const rate = Number(d.rate);
    if (!(rate >= 1 && rate <= 1000)) throw new Error(`${where}.rate: between 1 and 1000 Hz`);
    const names = (v, key) => {
      const out = split(v);
      if (!out.length || out.length > 16) throw new Error(`${where}.${key}: 1 to 16 names, separated by commas`);
      for (const n of out) if (!PORT_NAME.test(n)) throw new Error(`${where}.${key}: "${n}" is not a name (letters, digits, _)`);
      return out;
    };
    const inputs = names(d.inputs, 'inputs'), outputs = names(d.outputs, 'outputs');
    const n = inputs.length;
    const min = fit(numbers(d.min, `${where}.min`), n, -1), max = fit(numbers(d.max, `${where}.max`), n, 1);
    for (let i = 0; i < n; i++) if (min[i] > max[i]) [min[i], max[i]] = [max[i], min[i]];
    const safe = fit(numbers(d.safe, `${where}.safe`), n, (i) => Math.min(max[i], Math.max(min[i], 0))).map((v, i) => Math.min(max[i], Math.max(min[i], v)));
    return {
      url, rate, inputs,
      inUnits: fit(split(d.inUnits), n, '1').map((u, i) => checkUnit(u, `${where}.inUnits[${i}]`)),
      min, max, safe, outputs,
      outUnits: fit(split(d.outUnits), outputs.length, '1').map((u, i) => checkUnit(u, `${where}.outUnits[${i}]`)),
    };
  },
};

// The block's parameters for a plant's description (keeping where it lives).
export function externalParams(desc, url = HIL_URL) {
  return EXTERNAL_BLOCK.normalize({
    url, rate: desc.rate_hz,
    inputs: desc.inputs.map((p) => p.name), inUnits: desc.inputs.map((p) => p.unit),
    min: desc.inputs.map((p) => p.min), max: desc.inputs.map((p) => p.max), safe: desc.inputs.map((p) => p.safe),
    outputs: desc.outputs.map((p) => p.name), outUnits: desc.outputs.map((p) => p.unit),
  });
}

// Whether a block already matches a description (then connecting changes nothing).
export function sameDescription(params, desc) {
  const want = externalParams(desc, params.url);
  return JSON.stringify(want) === JSON.stringify(EXTERNAL_BLOCK.normalize(params));
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
