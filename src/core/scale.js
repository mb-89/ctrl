// 1-2-5 sequences, as on a scope's scale knobs, and SI prefixes.

// The smallest 1-2-5 value that is >= v.
export function ceil125(v) {
  const e = Math.floor(Math.log10(v));
  for (let k = e; k <= e + 1; k++) for (const m of [1, 2, 5]) { const c = Number((m * 10 ** k).toPrecision(3)); if (c >= v * (1 - 1e-9)) return c; }
  return 10 ** (e + 1);
}

// The 1-2-5 step nearest to v, moved dir steps up or down.
export function step125(v, dir) {
  const e = Math.floor(Math.log10(v));
  const ladder = [];
  for (let k = e - 1; k <= e + 1; k++) for (const m of [1, 2, 5]) ladder.push(Number((m * 10 ** k).toPrecision(3)));
  let i = 0;
  for (let j = 0; j < ladder.length; j++) if (Math.abs(Math.log(ladder[j] / v)) < Math.abs(Math.log(ladder[i] / v))) i = j;
  return ladder[Math.max(0, Math.min(ladder.length - 1, i + dir))];
}

const PREFIXES = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']];

// 0.1 -> "100 m", 2e-6 -> "2 µ"; unit appended by the caller.
export function si(v, digits = 3) {
  if (v === 0) return '0 ';
  if (!Number.isFinite(v)) return '— ';
  const a = Math.abs(v);
  const [f, p] = PREFIXES.find(([f]) => a >= f * 0.9995) ?? PREFIXES[PREFIXES.length - 1];
  return `${Number((v / f).toPrecision(digits))} ${p}`;
}

// 1.4e-7, 's' -> "140 ns".
export function siUnit(v, unit, digits) {
  return `${si(v, digits)}${unit}`.replace(/ $/, '');
}
