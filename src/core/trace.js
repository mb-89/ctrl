// Traces: what the scope stores. Where live and recorded time lands on the
// screen (sweepStart, refShift); the live record, the last N seconds of every
// signal in a ring buffer (createRecorder); a trace saved as CSV (t and every
// signal, units in the header) or JSON, and read back to be shown as a
// reference on the scope (parseTrace).
// See design/output/instrument.md (Save and references) and design/output/hil.md.

export const TRACE_FORMAT = 'loop-tuner-trace/1';
// The live record's memory, all columns together: 2^24 numbers, 128 MB.
export const MAX_RECORD_VALUES = 2 ** 24;

// ---- Time on the screen. The window shows [w0, w0 + W). A live sweep covers
// one screen width of plant time and starts where the plant's time, counted
// in screen widths from w0, begins a new one; its samples are drawn at
// w0 + (t − start). So at position w0 the screen shows plant time w0 … w0 + W
// the first time round, as a simulated run does, and an input whose period
// is the screen width lines up sweep after sweep.
export const sweepStart = (t, w0, W) => w0 + W * Math.floor((t - w0) / W + 1e-9);

// Where a reference trace [t0, t1] is drawn: the shift added to its time. A
// trace with any part in the window stays at its own time (one saved from the
// same screen lines up exactly); one outside it is folded in like a live
// sweep, its first sample in the window. step moves it on by whole screen
// widths, through a trace longer than the screen; steps gives their range.
export function refShift(t0, t1, w0, W, step = 0) {
  const base = t1 >= w0 && t0 < w0 + W ? 0 : w0 - sweepStart(t0, w0, W);
  return base - step * W;
}
export function refSteps(t0, t1, w0, W) {
  const base = refShift(t0, t1, w0, W);
  return { min: Math.floor((t0 + base - w0 - W) / W + 1e-9) + 1, max: Math.max(0, Math.ceil((t1 + base - w0) / W - 1e-9) - 1) };
}

// ---- The live record: the last `seconds` of samples, one column per signal
// name. Columns are added when a new name comes (earlier samples read NaN), so
// adding a Sink while live keeps what was recorded. The buffers grow as the
// samples come, up to MAX_RECORD_VALUES numbers; beyond that the oldest go
// first, and longest() says how long that holds at the current rate. Times
// must not decrease.
export function createRecorder(seconds = 300, maxValues = MAX_RECORD_VALUES) {
  let names = [], units = {}, cap = 0, n = 0, head = 0, t = new Float64Array(0), cols = [];
  let lastIn = null, map = [];
  const limit = () => Math.floor(maxValues / (names.length + 1));
  const oldest = () => (head - n + cap) % cap;
  // New buffers of size c holding the newest samples, in time order from 0.
  function relayout(c) {
    const keep = Math.min(n, c), from = (head - keep + cap) % (cap || 1);
    const move = (src) => { const dst = new Float64Array(c).fill(NaN); for (let i = 0; i < keep; i++) dst[i] = src[(from + i) % cap]; return dst; };
    t = move(t); cols = cols.map(move);
    cap = c; n = keep; head = keep % c;
  }
  function column(name) {
    let j = names.indexOf(name);
    if (j >= 0) return j;
    names.push(name);
    cols.push(new Float64Array(cap).fill(NaN));
    if (cap > limit()) relayout(limit());
    j = names.length - 1;
    return j;
  }
  // Drops samples older than the record length before `now`.
  function evict(now) { while (n && t[oldest()] < now - seconds - 1e-9) n--; }
  const self = {
    get seconds() { return seconds; },
    get names() { return names; },
    get length() { return n; },
    // Seconds held now, and the newest time.
    span() { return n > 1 ? t[(head - 1 + cap) % cap] - t[oldest()] : 0; },
    last() { return n ? t[(head - 1 + cap) % cap] : null; },
    // How long the memory holds at the rate the record is filling.
    longest() {
      const s = self.span();
      return n > 1 && s > 0 ? (limit() * s) / (n - 1) : Infinity;
    },
    setUnits(u) { Object.assign(units, u); },
    setLength(s) { seconds = s; const now = self.last(); if (now !== null) evict(now); },
    clear() { names = []; units = {}; cap = 0; n = 0; head = 0; t = new Float64Array(0); cols = []; lastIn = null; map = []; },
    // One sample: its time, the names of its values (the same array object
    // each time is cheapest), and the values.
    push(time, nms, values) {
      if (nms !== lastIn) { map = nms.map(column); lastIn = nms; }
      evict(time);
      if (n === cap) {
        if (cap < limit()) relayout(Math.min(limit(), Math.max(1024, 2 * cap)));
        else n--;  // full: the oldest goes
      }
      t[head] = time;
      for (let j = 0; j < cols.length; j++) cols[j][head] = NaN;
      for (let i = 0; i < map.length; i++) cols[map[i]][head] = values[i];
      head = (head + 1) % cap;
      n++;
    },
    // In time order: { t, signals: { name: Float64Array }, units }.
    snapshot() {
      const out = { t: new Float64Array(n), signals: {}, units: Object.fromEntries(names.map((nm) => [nm, units[nm] ?? '1'])) };
      const from = oldest();
      const copy = (src, dst) => { for (let i = 0; i < n; i++) dst[i] = src[(from + i) % cap]; };
      if (n) copy(t, out.t);
      names.forEach((nm, j) => { out.signals[nm] = new Float64Array(n); if (n) copy(cols[j], out.signals[nm]); });
      return out;
    },
  };
  return self;
}

// The samples of a trace within [a, b], as a trace of their own.
export function traceWindow(trace, a, b) {
  let i0 = 0, i1 = trace.t.length;
  while (i0 < i1 && trace.t[i0] < a - 1e-9) i0++;
  while (i1 > i0 && trace.t[i1 - 1] > b + 1e-9) i1--;
  return { t: trace.t.slice(i0, i1), signals: Object.fromEntries(Object.entries(trace.signals).map(([nm, v]) => [nm, v.slice(i0, i1)])), units: { ...trace.units } };
}

const cell = (v) => (Number.isFinite(v) ? String(Number(v.toPrecision(9))) : '');
const ROWS = 20000;  // per part: a long record is written piece by piece (Blob parts)

// CSV: comment lines (#) say what it is; the header is "name [unit]". In
// parts, so a long record never has to be one string.
export function traceToCsvParts(trace, { title = '', source = '' } = {}) {
  const names = Object.keys(trace.signals);
  const unit = (nm) => trace.units?.[nm] ?? '1';
  const head = `# ${TRACE_FORMAT}${title ? ` · ${title}` : ''}${source ? ` · ${source}` : ''} · ${trace.t.length} samples\n${['t [s]', ...names.map((nm) => `${nm} [${unit(nm)}]`)].join(',')}\n`;
  const parts = [head], cs = names.map((nm) => trace.signals[nm]);
  for (let a = 0; a < trace.t.length; a += ROWS) {
    const lines = [];
    for (let i = a; i < Math.min(trace.t.length, a + ROWS); i++) lines.push(`${cell(trace.t[i])}${cs.map((v) => `,${cell(v[i])}`).join('')}`);
    parts.push(`${lines.join('\n')}\n`);
  }
  return parts;
}
export const traceToCsv = (trace, meta) => traceToCsvParts(trace, meta).join('');

export function traceToJsonParts(trace, { title = '', source = '' } = {}) {
  const arr = (a) => {
    const out = [];
    for (let i = 0; i < a.length; i += ROWS) out.push(Array.from(a.subarray ? a.subarray(i, i + ROWS) : a.slice(i, i + ROWS), (v) => (Number.isFinite(v) ? Number(v.toPrecision(9)) : 'null')).join(','));
    return `[${out.join(',')}]`;
  };
  const parts = [`{"format":${JSON.stringify(TRACE_FORMAT)},"title":${JSON.stringify(title)},"source":${JSON.stringify(source)},"units":${JSON.stringify({ t: 's', ...trace.units })},"t":${arr(trace.t)},"signals":{`];
  Object.entries(trace.signals).forEach(([nm, v], i) => parts.push(`${i ? ',' : ''}${JSON.stringify(nm)}:${arr(v)}`));
  parts.push('}}');
  return parts;
}
export const traceToJson = (trace, meta) => traceToJsonParts(trace, meta).join('');

// Reads a trace saved by traceToCsv or traceToJson (or any CSV whose first
// column is time): { title, t, signals, units }. Empty cells are NaN.
export function parseTrace(text) {
  const s = String(text).replace(/^\uFEFF/, '');
  if (/^\s*\{/.test(s)) {
    const j = JSON.parse(s);
    if (!Array.isArray(j.t) || !j.signals || typeof j.signals !== 'object') throw new Error('a trace needs "t" and "signals"');
    const num = (a) => Float64Array.from(a, (v) => (v === null || v === '' ? NaN : Number(v)));
    const signals = {};
    for (const [nm, v] of Object.entries(j.signals)) {
      if (!Array.isArray(v) || v.length !== j.t.length) throw new Error(`signal ${nm}: one value per time`);
      signals[nm] = num(v);
    }
    const units = { ...(j.units ?? {}) };
    delete units.t;
    return { title: String(j.title ?? ''), t: num(j.t), signals, units };
  }
  const lines = s.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  if (lines.length < 2) throw new Error('a CSV trace needs a header and at least one row');
  const head = lines[0].split(/[,;\t]/).map((h) => h.trim().replace(/^"|"$/g, ''));
  const cols = head.map((h) => /^(.*?)\s*(?:\[(.*)\])?$/.exec(h));
  const t = new Float64Array(lines.length - 1);
  const values = cols.slice(1).map(() => new Float64Array(lines.length - 1));
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(/[,;\t]/);
    t[i - 1] = f[0] === '' ? NaN : Number(f[0]);
    for (let j = 1; j < cols.length; j++) values[j - 1][i - 1] = f[j] === undefined || f[j].trim() === '' ? NaN : Number(f[j]);
  }
  if (!t.every(Number.isFinite)) throw new Error('the first column must be the time, in seconds');
  const signals = {}, units = {};
  cols.slice(1).forEach((c, j) => { const nm = c[1] || `col${j + 2}`; signals[nm] = values[j]; units[nm] = c[2] || '1'; });
  return { title: '', t, signals, units };
}
