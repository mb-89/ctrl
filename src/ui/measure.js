// The scope's Measure readout (design/output/instrument.md): for a channel
// with Measure on, one line under the screen with what a bench scope's
// measurements give, over the samples the screen shows (inside the timebase
// window, up to the sweep; the display-filtered signal when a filter is set):
//   mean      (1/n)·Σx
//   rms       √((1/n)·Σx²)
//   ac        √((1/n)·Σ(x − mean)²), the rms of what moves
//   p-p       max − min
//   TV/s      Σ|x_j − x_(j−1)| / (t_last − t_first), the total variation per
//             second (how much the signal travels: the effort's wear)
//   rev/s     reversals per second: how often x turns after moving more than
//             h (hysteresis), an edge count as bench scopes offer; h is 0.1
//             division of the channel
// A waveform with fewer than 10 samples per period is not resolved: its rms,
// ac and p-p are wrong (a relay-driven current sampled at 4 points per period
// reads 1.5× its true mean square), so the line says so. Samples per period
// are 2 / (rev/s · record step).

const RESOLVED = 10;   // samples per period below which the line warns

// Measures x over samples [j0, j1] (inclusive; values that are not numbers
// are skipped). t: the sample times; h: the hysteresis of the reversal count.
export function measure(t, x, j0, j1, h) {
  let n = 0, s = 0, s2 = 0, lo = Infinity, hi = -Infinity, tv = 0, prev = null, tFirst = null, tLast = null;
  let dir = 0, ext = 0, turns = 0, start = 0, sLo = Infinity, sHi = -Infinity;
  for (let j = Math.max(0, j0); j <= j1 && j < x.length; j++) {
    const v = x[j];
    if (!Number.isFinite(v)) continue;
    n++; s += v; s2 += v * v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    if (prev !== null) tv += Math.abs(v - prev);
    prev = v;
    tFirst ??= t[j];
    tLast = t[j];
    // Reversals: the first move of more than h sets the direction; after it,
    // every move of more than h back from the extreme reached is a turn.
    if (n === 1) { start = v; sLo = sHi = v; continue; }
    if (dir === 0) {
      sLo = Math.min(sLo, v); sHi = Math.max(sHi, v);
      if (sHi - start > h) { dir = 1; ext = sHi; if (ext - v > h) { turns++; dir = -1; ext = v; } }
      else if (start - sLo > h) { dir = -1; ext = sLo; if (v - ext > h) { turns++; dir = 1; ext = v; } }
    } else if (dir > 0) {
      if (v > ext) ext = v;
      else if (ext - v > h) { turns++; dir = -1; ext = v; }
    } else if (v < ext) ext = v;
    else if (v - ext > h) { turns++; dir = 1; ext = v; }
  }
  if (!n) return null;
  const mean = s / n, span = tLast - tFirst;
  const rms = Math.sqrt(s2 / n), ac = Math.sqrt(Math.max(0, s2 / n - mean * mean));
  const per = span > 0 ? 1 / span : NaN;
  const rev = turns * per;
  const dt = n > 1 ? span / (n - 1) : NaN;
  // Samples per period of the turning waveform (two turns per period).
  const perPeriod = rev > 0 && dt > 0 ? 2 / (rev * dt) : Infinity;
  return { n, mean, rms, ac, pp: hi - lo, tv: tv * per, rev, h, span, perPeriod, under: perPeriod < RESOLVED };
}

// A value for the line, with an SI prefix: 2786 V/s -> "2.79 kV/s",
// 0.0042 rad -> "4.2 mrad", 0.5 V -> "0.5 V" (no prefix from 0.1 up); values
// below a thousandth of ref (the channel's scale) read 0.
const PREFIX = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n']];
export function measureValue(v, unit, ref = 0) {
  if (!Number.isFinite(v)) return '—';
  const u = unit === '1' ? '' : unit;
  if (v === 0 || Math.abs(v) < ref * 1e-3) return `0${u ? ` ${u}` : ''}`;
  const a = Math.abs(v);
  const [f, p] = a >= 0.0995 && a < 1 ? [1, ''] : PREFIX.find(([f2]) => a >= f2 * 0.9995) ?? PREFIX[PREFIX.length - 1];
  const text = Number((v / f).toPrecision(3)).toString().replace('-', '−');
  return `${text}${p || u ? ` ${p}${u}` : ''}`;
}

// The line for channel i (0-based) showing name in unit, at the channel's
// scale (units per division): its parts, the warning last when there is one.
export function measureLine(m, i, name, unit, scale) {
  const u = unit === '1' ? '' : unit;
  const f = (v) => measureValue(v, unit, scale);
  const parts = [`${i + 1} ${name}`, `mean ${f(m.mean)}`, `rms ${f(m.rms)}`, `ac ${f(m.ac)}`, `p-p ${f(m.pp)}`,
    `TV ${measureValue(m.tv, u ? `${u}/s` : '/s', scale)}`, `rev ${Number(m.rev.toPrecision(3))}/s (h ${f(m.h)})`];
  return { text: parts.join('  '), warn: m.under ? `under-resolved: ${Math.max(1, Math.round(m.perPeriod))} samples per period` : '' };
}
