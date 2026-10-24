// Traces: the scope's deep memory. A recorder keeps the last N seconds of every
// signal the scope acquires (live cycles, or simulated sweeps one after the
// other), in a ring buffer; a trace is saved as CSV (t and every signal, units
// in the header) or JSON, and read back to show as a reference on the scope.
// See design/output/instrument.md (Record) and design/output/hil.md.

export const TRACE_FORMAT = 'loop-tuner-trace/1';
export const MAX_RECORD_SAMPLES = 2e6;

// A ring buffer of samples: t and one column per name. Its capacity follows
// the record length and the sample rate; a change of the names or of the
// rate starts a new recording (reset).
export function createRecorder(seconds = 300) {
  let names = [], units = {}, rate = 0, cap = 0, n = 0, head = 0, t = null, cols = [];
  const self = {
    get seconds() { return seconds; },
    get names() { return names; },
    get length() { return n; },
    // Seconds held now.
    span() { return n > 1 ? t[(head - 1 + cap) % cap] - t[(head - n + cap) % cap] : 0; },
    // Starts afresh for these signals at this sample rate (Hz).
    reset(nextNames = names, nextUnits = units, nextRate = rate) {
      names = [...nextNames]; units = { ...nextUnits }; rate = nextRate;
      cap = rate > 0 ? Math.min(MAX_RECORD_SAMPLES, Math.ceil(seconds * rate) + 1) : 0;
      t = new Float64Array(cap); cols = names.map(() => new Float64Array(cap));
      n = 0; head = 0;
    },
    setLength(s) {
      const keep = self.snapshot();
      seconds = s;
      self.reset(names, units, rate);
      const from = Math.max(0, keep.t.length - cap);
      for (let i = from; i < keep.t.length; i++) self.push(keep.t[i], names.map((nm) => keep.signals[nm][i]));
    },
    // Whether samples with these names at this rate can follow the ones held.
    fits(nextNames, nextRate) { return cap > 0 && Math.abs(nextRate - rate) <= 1e-6 * rate && nextNames.length === names.length && nextNames.every((x, i) => x === names[i]); },
    push(time, values) {
      if (!cap) return;
      t[head] = time;
      for (let j = 0; j < cols.length; j++) cols[j][head] = values[j];
      head = (head + 1) % cap;
      n = Math.min(cap, n + 1);
    },
    // In time order: { t, signals: { name: Float64Array }, units }.
    snapshot() {
      const out = { t: new Float64Array(n), signals: {}, units: { ...units } };
      const start = (head - n + cap) % (cap || 1);
      const copy = (src, dst) => { for (let i = 0; i < n; i++) dst[i] = src[(start + i) % cap]; };
      if (n) copy(t, out.t);
      names.forEach((nm, j) => { out.signals[nm] = new Float64Array(n); if (n) copy(cols[j], out.signals[nm]); });
      return out;
    },
  };
  return self;
}

const cell = (v) => (Number.isFinite(v) ? String(Number(v.toPrecision(9))) : '');

// CSV: comment lines (#) say what it is; the header is "name [unit]".
export function traceToCsv(trace, { title = '', source = '' } = {}) {
  const names = Object.keys(trace.signals);
  const unit = (nm) => trace.units?.[nm] ?? '1';
  const lines = [`# ${TRACE_FORMAT}${title ? ` · ${title}` : ''}${source ? ` · ${source}` : ''} · ${trace.t.length} samples`];
  lines.push(['t [s]', ...names.map((nm) => `${nm} [${unit(nm)}]`)].join(','));
  for (let i = 0; i < trace.t.length; i++) lines.push([cell(trace.t[i]), ...names.map((nm) => cell(trace.signals[nm][i]))].join(','));
  return `${lines.join('\n')}\n`;
}

export function traceToJson(trace, { title = '', source = '' } = {}) {
  const arr = (a) => Array.from(a, (v) => (Number.isFinite(v) ? Number(v.toPrecision(9)) : null));
  return JSON.stringify({
    format: TRACE_FORMAT, title, source, units: { t: 's', ...trace.units },
    t: arr(trace.t), signals: Object.fromEntries(Object.entries(trace.signals).map(([nm, v]) => [nm, arr(v)])),
  });
}

// Reads a trace saved by traceToCsv or traceToJson (or any CSV whose first
// column is time): { title, t, signals, units }. Empty cells are NaN.
export function parseTrace(text) {
  const s = String(text).replace(/^﻿/, '');
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
