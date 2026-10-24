// Engineering units for the instrument: SI prefixes and plain readouts.
// The 1-2-5 sequences live in core/scale.js.

const PREFIXES = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n']];

// 0.1 -> "100 m", 2e-6 -> "2 µ"; unit appended by the caller.
export function si(v, digits = 3) {
  if (v === 0) return '0 ';
  if (!Number.isFinite(v)) return '— ';
  const a = Math.abs(v);
  const [f, p] = PREFIXES.find(([f]) => a >= f * 0.9995) ?? PREFIXES[PREFIXES.length - 1];
  return `${Number((v / f).toPrecision(digits))} ${p}`;
}

export function siUnit(v, unit, digits) {
  return `${si(v, digits)}${unit}`.replace(/ $/, '');
}

// A plain number for readouts: up to 4 significant digits, no exponent noise.
export function num(v, digits = 4) {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-4) return v.toExponential(2);
  return String(Number(v.toPrecision(digits)));
}

// Reads a typed value with an optional SI prefix and unit: "20m", "100 ms",
// "2u", "-0.4", "1.5k". Returns NaN when it is not a number.
export function parseSI(text, unit = '') {
  let s = String(text).trim().replace(/,/g, '.').replace(/−/g, '-').replace(/\/div$/, '').trim();
  if (unit && s.endsWith(unit)) s = s.slice(0, -unit.length).trim();
  const m = s.match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*([GMkmuµn]?)$/i);
  if (!m) return NaN;
  const f = { G: 1e9, M: 1e6, k: 1e3, K: 1e3, m: 1e-3, u: 1e-6, U: 1e-6, 'µ': 1e-6, n: 1e-9, N: 1e-9, '': 1 }[m[2]];
  return Number(m[1]) * f;
}
