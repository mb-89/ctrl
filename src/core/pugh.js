// A Pugh decision matrix, generic: candidates marked against a datum on
// criteria, weighted, gated, ranked, and tested against its own weights.
// It knows nothing of what is being decided (design/output/pugh.md). One
// file, no imports, no clock, no Math.random: copy it into another project
// as it is.
//
//   decide(matrix)          → the result (data): marks, totals, fits, ranking,
//                             suggestion, weight sensitivity, weak spots
//   renderMarkdown(result)  → the report as Markdown, bottom line first
//   renderHtml(result)      → the same as an HTML fragment (the page's tokens
//                             as CSS variables, with fallbacks)
//
// The matrix (a plain object; the file shape is in pugh.md):
//   { title?, criteria: [{ key, label?, weight, better: 'lower'|'higher',
//       tolerance?, floor?, kind?: 'measured'|'judged' }],
//     candidates: [{ key, label?, values?: {criterion: number},
//       marks?: {criterion: −2…2 | [−2…2, …] (several raters)}, fits?, whyNot?,
//       suggestable?, keep?, tieBreak?, note? }],
//     gates?: [{ criterion, maxRatio | max | min, why? }],
//     datum?: { prefer: [candidate keys] },
//     strong?: 2, sensitivity?: { step, draws, seed, robustShare, runnersUp } }

export const PUGH_VERSION = 1;
export const SYMBOL = { 2: '++', 1: '+', 0: 'S', [-1]: '−', [-2]: '−−' };
export const DEFAULTS = { strong: 2, tolerance: 0.1, floor: 0, step: 1, draws: 4000, seed: 1, robustShare: 0.75, runnersUp: 3 };

export class PughError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const isMark = (v) => Number.isInteger(v) && v >= -2 && v <= 2;
const clampMark = (v) => Math.max(-2, Math.min(2, v));

// A seeded generator (a 32-bit linear congruential one): the same seed gives
// the same draws on every machine.
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// ---- The matrix, checked -----------------------------------------------------

// A checked copy with the defaults filled in; a matrix that cannot be
// decided is refused with a sentence that names the place (fail fast).
export function normalizeMatrix(m) {
  if (!m || typeof m !== 'object') throw new PughError('no-matrix', 'the matrix is not an object');
  const fail = (code, msg) => { throw new PughError(code, msg); };
  if (!Array.isArray(m.criteria) || !m.criteria.length) fail('no-criteria', 'criteria: a list of at least one criterion');
  if (!Array.isArray(m.candidates) || m.candidates.length < 1) fail('no-candidates', 'candidates: a list of at least one candidate');
  const keys = new Set();
  const criteria = m.criteria.map((c, i) => {
    const where = `criteria[${i}]`;
    if (typeof c?.key !== 'string' || !c.key) fail('bad-criterion', `${where}.key: a name`);
    if (keys.has(c.key)) fail('bad-criterion', `${where}.key: '${c.key}' twice`);
    keys.add(c.key);
    if (!finite(c.weight) || c.weight < 0) fail('bad-criterion', `${where}.weight: a number ≥ 0`);
    if (c.better !== 'lower' && c.better !== 'higher') fail('bad-criterion', `${where}.better: 'lower' or 'higher'`);
    const tolerance = c.tolerance ?? DEFAULTS.tolerance, floor = c.floor ?? DEFAULTS.floor, kind = c.kind ?? 'measured';
    if (!finite(tolerance) || tolerance < 0) fail('bad-criterion', `${where}.tolerance: a number ≥ 0`);
    if (!finite(floor) || floor < 0) fail('bad-criterion', `${where}.floor: a number ≥ 0`);
    if (kind !== 'measured' && kind !== 'judged') fail('bad-criterion', `${where}.kind: 'measured' or 'judged'`);
    return { key: c.key, label: String(c.label ?? c.key), weight: c.weight, better: c.better, tolerance, floor, kind };
  });
  const byKey = Object.fromEntries(criteria.map((c) => [c.key, c]));
  const ckeys = new Set();
  const candidates = m.candidates.map((c, i) => {
    const where = `candidates[${i}]`;
    if (typeof c?.key !== 'string' || !c.key) fail('bad-candidate', `${where}.key: a name`);
    if (ckeys.has(c.key)) fail('bad-candidate', `${where}.key: '${c.key}' twice`);
    ckeys.add(c.key);
    const values = {}, marks = {};
    for (const [k, v] of Object.entries(c.values ?? {})) {
      if (!byKey[k]) fail('bad-candidate', `${where}.values.${k}: no such criterion`);
      if (byKey[k].kind !== 'measured') fail('bad-candidate', `${where}.values.${k}: '${k}' is judged: give marks`);
      if (v !== null && typeof v !== 'number') fail('bad-candidate', `${where}.values.${k}: a number or null`);
      values[k] = v;
    }
    for (const [k, v] of Object.entries(c.marks ?? {})) {
      if (!byKey[k]) fail('bad-candidate', `${where}.marks.${k}: no such criterion`);
      if (byKey[k].kind !== 'judged') fail('bad-candidate', `${where}.marks.${k}: '${k}' is measured: give values`);
      const list = [].concat(v);
      if (!list.length || !list.every(isMark)) fail('bad-candidate', `${where}.marks.${k}: a whole number from −2 to 2, or a list of them (one per rater)`);
      marks[k] = list;
    }
    if (c.tieBreak !== undefined && !finite(c.tieBreak)) fail('bad-candidate', `${where}.tieBreak: a number`);
    return {
      key: c.key, label: String(c.label ?? c.key), values, marks, fits: c.fits !== false, whyNot: c.fits === false ? String(c.whyNot ?? 'does not fit') : '',
      suggestable: c.suggestable !== false, keep: !!c.keep, tieBreak: c.tieBreak ?? null, note: c.note ? String(c.note) : '',
    };
  });
  const gates = (m.gates ?? []).map((g, i) => {
    const where = `gates[${i}]`;
    if (!byKey[g?.criterion]) fail('bad-gate', `${where}.criterion: one of ${criteria.map((c) => c.key).join(', ')}`);
    const kinds = ['maxRatio', 'max', 'min'].filter((k) => g[k] !== undefined);
    if (kinds.length !== 1 || !finite(g[kinds[0]])) fail('bad-gate', `${where}: exactly one of maxRatio, max, min, a number`);
    if (kinds[0] === 'maxRatio' && !(g.maxRatio >= 1)) fail('bad-gate', `${where}.maxRatio: at least 1`);
    if (kinds[0] !== 'maxRatio' && byKey[g.criterion].kind !== 'measured') fail('bad-gate', `${where}: a hard limit needs a measured criterion`);
    return { criterion: g.criterion, [kinds[0]]: g[kinds[0]], why: g.why ? String(g.why) : '' };
  });
  const prefer = m.datum?.prefer ?? [candidates[0].key];
  if (!Array.isArray(prefer) || !prefer.length || !prefer.every((k) => ckeys.has(k))) fail('bad-datum', `datum.prefer: candidate keys (${[...ckeys].join(', ')})`);
  const strong = m.strong ?? DEFAULTS.strong;
  if (!finite(strong) || strong <= 1) fail('bad-strong', 'strong: a ratio above 1');
  const s = { ...DEFAULTS, ...(m.sensitivity ?? {}) };
  for (const k of ['step', 'draws', 'seed', 'robustShare', 'runnersUp']) if (!finite(s[k]) || s[k] < 0) fail('bad-sensitivity', `sensitivity.${k}: a number ≥ 0`);
  return {
    title: String(m.title ?? 'Decision'), criteria, candidates, gates, datum: { prefer }, strong,
    sensitivity: { step: s.step, draws: Math.round(s.draws), seed: s.seed, robustShare: s.robustShare, runnersUp: Math.round(s.runnersUp) },
  };
}

// ---- Marks -------------------------------------------------------------------

// How many times worse a is than b on this criterion (1: the same; ½: twice
// as good), the floor added to both so tiny numbers do not read as huge
// ratios: q = (a + f)/(b + f), turned over when higher is better.
export function worseRatio(criterion, a, b) {
  const f = criterion.floor;
  return criterion.better === 'lower' ? (a + f) / (b + f) : (b + f) / (a + f);
}

// The five-point mark of a measured value against the datum's: S within the
// tolerance, ±1 beyond it up to the strong ratio, ±2 beyond that; null when
// either number is missing.
export function markOf(criterion, a, b, strong = DEFAULTS.strong) {
  if (!finite(a) || !finite(b)) return null;
  const q = worseRatio(criterion, a, b), up = 1 + criterion.tolerance;
  if (!Number.isFinite(q)) return null;
  if (q < 1 / strong) return 2;
  if (q <= 1 / up) return 1;
  if (q > strong) return -2;
  if (q >= up) return -1;
  return 0;
}

const median = (list) => {
  const s = [...list].sort((x, y) => x - y), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

// ---- The decision ------------------------------------------------------------

export function decide(matrix) {
  const m = normalizeMatrix(matrix), { criteria, candidates, strong } = m;
  const weights = criteria.map((c) => c.weight);
  const notes = [];
  const hardGate = (c) => {
    for (const g of m.gates) {
      if (g.maxRatio !== undefined) continue;
      const cr = criteria.find((x) => x.key === g.criterion), v = c.values[g.criterion];
      if (!finite(v)) continue;   // not measured: the gate cannot judge it
      const pre = g.why ? `${g.why}: ` : '';
      if (g.max !== undefined && v > g.max) return `${pre}${cr.label} ${fmt(v)} above ${fmt(g.max)}`;
      if (g.min !== undefined && v < g.min) return `${pre}${cr.label} ${fmt(v)} below ${fmt(g.min)}`;
    }
    return '';
  };
  const rows = candidates.map((c) => {
    let fits = c.fits, whyNot = c.whyNot;
    if (fits) { const why = hardGate(c); if (why) { fits = false; whyNot = why; } }
    return { ...c, fits, whyNot };
  });
  // The datum: the first preferred candidate that fits; if none does, the
  // first preferred all the same (the result says it does not fit).
  const prefer = m.datum.prefer.map((k) => rows.find((r) => r.key === k));
  const datum = prefer.find((r) => r.fits) ?? prefer[0];
  if (datum.key !== m.datum.prefer[0]) notes.push(`the datum is ${datum.label}: ${prefer[0].label} does not fit (${prefer[0].whyNot})`);
  if (!datum.fits) notes.push(`the datum ${datum.label} does not fit (${datum.whyNot}); it is kept as the reference`);
  // Judged marks are given against the first preferred candidate; against
  // another datum they are shifted by that datum's own mark.
  const judgedShift = Object.fromEntries(criteria.filter((c) => c.kind === 'judged').map((c) => [c.key, datum.marks[c.key] ? median(datum.marks[c.key]) : 0]));
  if (Object.values(judgedShift).some((v) => v)) notes.push(`judged marks are shifted to the datum ${datum.label}`);
  for (const r of rows) {
    r.marks_ = {}; r.spread = {};
    for (const c of criteria) {
      if (r === datum) { r.marks_[c.key] = 0; continue; }
      if (c.kind === 'measured') r.marks_[c.key] = markOf(c, r.values[c.key], datum.values[c.key], strong);
      else if (r.marks[c.key]) {
        r.marks_[c.key] = clampMark(median(r.marks[c.key]) - judgedShift[c.key]);
        if (r.marks[c.key].length > 1) r.spread[c.key] = Math.max(...r.marks[c.key]) - Math.min(...r.marks[c.key]);
      } else r.marks_[c.key] = null;
    }
  }
  // Ratio gates against the datum (the datum itself is exempt).
  for (const r of rows) {
    if (!r.fits || r === datum) continue;
    for (const g of m.gates) {
      if (g.maxRatio === undefined) continue;
      const cr = criteria.find((x) => x.key === g.criterion), pre = g.why ? `${g.why}: ` : '';
      const b = datum.values[g.criterion], a = r.values[g.criterion];
      if (cr.kind === 'judged') {
        // A judged gate: no more than the strong mark below the datum.
        const mk = r.marks_[g.criterion];
        if (mk !== null && mk <= -2 && g.maxRatio <= strong) { r.fits = false; r.whyNot = `${pre}${cr.label}: much worse than the datum (−−)`; break; }
        continue;
      }
      if (!finite(b)) continue;
      if (!finite(a)) { r.fits = false; r.whyNot = `${pre}${cr.label}: no number`; break; }
      const q = worseRatio(cr, a, b);
      if (q > g.maxRatio) { r.fits = false; r.whyNot = `${pre}${cr.label} ×${fmt(q)} of the datum's (at most ×${fmt(g.maxRatio)})`; break; }
    }
  }
  const markList = (r) => criteria.map((c) => r.marks_[c.key]);
  const totalOf = (marks, w) => marks.reduce((t, s, i) => t + (s ?? 0) * w[i], 0);
  for (const r of rows) r.total = r === datum ? 0 : totalOf(markList(r), weights);
  const better = (a, b) => b.total - a.total || (a.tieBreak ?? 0) - (b.tieBreak ?? 0) || rows.indexOf(a) - rows.indexOf(b);
  const ranking = rows.filter((r) => r.fits).sort(better);
  const eligible = ranking.filter((r) => r.suggestable);
  const best = eligible[0] ?? null;
  const above = best ? ranking.slice(0, ranking.indexOf(best)) : [];
  const sens = eligible.length > 1 ? sensitivity(eligible, criteria, weights, m.sensitivity) : null;
  // Pugh's controlled convergence, as a hint only: where the winner is worse
  // than the datum, which fitting candidates are better there (a hybrid
  // might take that from them). It changes no mark and no rank.
  const weakSpots = [];
  if (best) for (const c of criteria) {
    const mk = best.marks_[c.key];
    if (mk === null || mk >= 0) continue;
    const stronger = ranking.filter((r) => r !== best && (r.marks_[c.key] ?? -Infinity) > mk).map((r) => r.key);
    weakSpots.push({ criterion: c.key, mark: mk, strongerAt: stronger });
  }
  const out = (r) => ({
    key: r.key, label: r.label, values: r.values, marks: r.marks_, spread: r.spread, total: r.total, fits: r.fits, whyNot: r.whyNot,
    suggestable: r.suggestable, keep: r.keep, tieBreak: r.tieBreak, note: r.note, datum: r === datum,
  });
  return {
    version: PUGH_VERSION, title: m.title, strong, criteria, weights, gates: m.gates,
    datum: { key: datum.key, label: datum.label, fits: datum.fits, whyNot: datum.whyNot },
    candidates: rows.map(out),
    ranking: ranking.map((r) => r.key),
    suggestion: best ? { key: best.key, label: best.label, total: best.total, keep: best.keep, above: above.map((r) => r.key) } : null,
    sensitivity: sens,
    weakSpots,
    notes,
  };
}

// ---- Reverse sensitivity -----------------------------------------------------
// The totals are linear in the weights, T_k = Σ w_i m_ki, so each question
// has an exact answer (pugh.md, "Sensitivity"). Among the candidates the
// suggestion is chosen from, the first being the winner:
//   tie       for each runner-up, the smallest change of one weight at which
//             it ties the winner (the weight kept ≥ 0)
//   minChange the smallest Euclidean change of all weights together that
//             makes it tie (kept ≥ 0), as a share of the weights' size
//   share     SMAA's rank-1 acceptability: the share of seeded draws, each
//             weight uniform within ±step of its own (at least 0.01), and
//             each multi-rater mark one rater drawn at random, it wins
// Reasonable: every weight within ±step of its default and above 0. Robust:
// no reasonable single change ties a runner-up, and the winner takes at
// least robustShare of the draws.
export function sensitivity(cands, criteria, w, opts = DEFAULTS) {
  const { step, draws, seed, robustShare, runnersUp } = { ...DEFAULTS, ...opts };
  const marks = cands.map((r) => criteria.map((c) => r.marks_[c.key]));
  const T = (k, ww, mm = marks) => mm[k].reduce((t, s, i) => t + (s ?? 0) * ww[i], 0);
  const iw = 0, list = [];
  for (let j = 1; j < cands.length; j++) {
    const gap = T(iw, w) - T(j, w);
    let tie = null;
    criteria.forEach((cr, i) => {
      const slope = (marks[j][i] ?? 0) - (marks[iw][i] ?? 0);
      if (!slope) return;
      const d = gap / slope;
      if (w[i] + d < 0) return;
      if (!tie || Math.abs(d) < Math.abs(tie.d)) tie = { i, d };
    });
    // The same total now, with no weight that tells them apart: tied now.
    if (!tie && Math.abs(gap) < 1e-9) tie = { i: -1, d: 0 };
    const D = criteria.map((_, i) => (marks[j][i] ?? 0) - (marks[iw][i] ?? 0));
    let ww = w.slice();
    for (let it = 0; it < 20; it++) {
      const dw = D.reduce((t, x, i) => t + x * ww[i], 0);
      if (dw >= -1e-12) break;
      const free = D.map((x, i) => (ww[i] > 0 || x > 0 ? x : 0)), nn = free.reduce((t, x) => t + x * x, 0);
      if (!nn) { ww = null; break; }
      ww = ww.map((x, i) => Math.max(0, x - (dw / nn) * free[i]));
    }
    list.push({
      key: cands[j].key, label: cands[j].label, total: T(j, w),
      tie: !tie ? null : tie.i < 0 ? { criterion: null, from: null, to: null, now: true, reasonable: true }
        : { criterion: criteria[tie.i].key, from: w[tie.i], to: w[tie.i] + tie.d, now: Math.abs(tie.d) < 1e-9, reasonable: Math.abs(tie.d) <= step && w[tie.i] + tie.d > 0 },
      minChange: ww ? { rel: Math.hypot(...ww.map((x, i) => x - w[i])) / (Math.hypot(...w) || 1), maxStep: Math.max(...ww.map((x, i) => Math.abs(x - w[i]))) } : null,
    });
  }
  // The draws: weights first (in criterion order), then a rater for each
  // multi-rater mark (in candidate, criterion order), so a matrix without
  // raters draws exactly the weights.
  const r = rng(seed), wins = new Array(cands.length).fill(0);
  const multi = [];
  cands.forEach((c, k) => criteria.forEach((cr, i) => { if ((c.marks[cr.key]?.length ?? 0) > 1) multi.push({ k, i, list: c.marks[cr.key], shift: c.marks_[cr.key] - median(c.marks[cr.key]) }); }));
  for (let n = 0; n < draws; n++) {
    const ww = w.map((x) => Math.max(0.01, x - step + 2 * step * r()));
    let mm = marks;
    if (multi.length) {
      mm = marks.map((row) => row.slice());
      for (const { k, i, list, shift } of multi) mm[k][i] = clampMark(list[Math.min(list.length - 1, Math.floor(r() * list.length))] + shift);
    }
    let bk = 0, bt = -Infinity;
    cands.forEach((c, k) => { const t = T(k, ww, mm); if (t > bt + 1e-12 || (Math.abs(t - bt) <= 1e-12 && (c.tieBreak ?? 0) < (cands[bk].tieBreak ?? 0))) { bt = t; bk = k; } });
    wins[bk]++;
  }
  const share = wins.map((x) => (draws ? x / draws : 0));
  list.forEach((x, j) => { x.share = share[j + 1]; });
  const reasonableFlip = list.some((x) => x.tie?.reasonable);
  return {
    winner: cands[0].key, verdict: !reasonableFlip && share[0] >= robustShare ? 'robust' : 'sensitive',
    share: share[0], step, draws, seed, robustShare,
    runnersUp: list.slice(0, runnersUp), all: list,
  };
}

// ---- Reports -----------------------------------------------------------------

export function fmt(v, digits = 3) {
  if (v === null || v === undefined) return '—';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : String(v);
  if (v !== 0 && (Math.abs(v) >= 1e4 || Math.abs(v) < 1e-3)) return v.toExponential(1);
  return String(Number(v.toPrecision(digits)));
}
const signed = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v))}`;
const pct = (v) => `${fmt(100 * v)} %`;
const labelOf = (res, key) => res.candidates.find((c) => c.key === key)?.label ?? key;
const critLabel = (res, key) => res.criteria.find((c) => c.key === key)?.label ?? key;

// The bottom line, one sentence: what to choose, and how much it depends on
// the weights.
export function bottomLine(res) {
  const s = res.suggestion;
  if (!s) return 'No candidate fits.';
  const head = s.keep ? `Keep **${s.label}**: nothing beats it` : `Suggestion: **${s.label}** (${signed(s.total)} against the datum ${res.datum.label})`;
  const sv = res.sensitivity;
  const rob = !sv ? 'the only candidate that fits and may be suggested'
    : sv.verdict === 'robust' ? `robust: it wins ${pct(sv.share)} of the weight draws within ±${fmt(sv.step)}`
      : `sensitive: it wins ${pct(sv.share)} of the weight draws within ±${fmt(sv.step)}${(() => { const f = sv.runnersUp.find((x) => x.tie?.reasonable || x.tie?.now); return f ? `; ${f.label} ${f.tie.now ? 'ties it now' : `ties if ${critLabel(res, f.tie.criterion)} goes ${fmt(f.tie.from)} → ${fmt(f.tie.to)}`}` : ''; })()}`;
  const above = s.above.length ? ` Ranked above it but not to be suggested: ${s.above.map((k) => labelOf(res, k)).join(', ')}.` : '';
  return `${head}; ${rob}.${above}`;
}

function runnerRows(res) {
  return (res.sensitivity?.runnersUp ?? []).map((x) => [
    x.label, signed(x.total),
    !x.tie ? 'no single weight' : x.tie.now ? 'tied now (the tie-break decides)' : `${critLabel(res, x.tie.criterion)} ${fmt(x.tie.from)} → ${fmt(x.tie.to)}`,
    !x.tie || x.tie.now ? (x.tie?.now ? 'yes' : '—') : x.tie.reasonable ? 'yes' : 'no',
    x.minChange ? `${pct(x.minChange.rel)} (largest ${fmt(x.minChange.maxStep)})` : '—',
    pct(x.share),
  ]);
}

export function renderMarkdown(res) {
  const L = [`# ${res.title}`, '', bottomLine(res), ''];
  const cols = res.candidates;
  L.push(`Datum: **${res.datum.label}**. Marks: ++ much better, + better, S same (within the tolerance), − worse, −− much worse (beyond ×${fmt(res.strong)}), ? not judged (counts as S).`, '');
  L.push(`| Criterion (weight) | ${cols.map((c) => c.label).join(' | ')} |`, `|---|${cols.map(() => ':-:').join('|')}|`);
  for (const cr of res.criteria) L.push(`| ${cr.label}${cr.kind === 'judged' ? ' (judged)' : ''} (${fmt(cr.weight)}) | ${cols.map((c) => (c.datum ? 'D' : c.marks[cr.key] === null ? '?' : SYMBOL[Math.round(c.marks[cr.key])] + (c.spread[cr.key] ? ` ±${fmt(c.spread[cr.key] / 2)}` : ''))).join(' | ')} |`);
  L.push(`| **Weighted** | ${cols.map((c) => (c.datum ? '0' : signed(c.total))).join(' | ')} |`);
  L.push(`| **Fits** | ${cols.map((c) => (c.fits ? 'yes' : 'no')).join(' | ')} |`, '');
  L.push(`Ranking: ${res.ranking.map((k, i) => `${i + 1}. ${labelOf(res, k)} (${signed(cols.find((c) => c.key === k).total)})`).join('; ') || 'none fits'}.`);
  const out = cols.filter((c) => !c.fits);
  if (out.length) L.push('', `Not ranked: ${out.map((c) => `${c.label}: ${c.whyNot}`).join('; ')}.`);
  if (res.sensitivity) {
    L.push('', `Runners-up (reasonable: every weight within ±${fmt(res.sensitivity.step)} of its default):`, '', '| Runner-up | Total | Ties when one weight changes | Reasonable | All weights together | Share of draws |', '|---|---|---|---|---|---|');
    for (const row of runnerRows(res)) L.push(`| ${row.join(' | ')} |`);
  }
  if (res.weakSpots.length) L.push('', `Weak spots of the suggestion (for a hybrid): ${res.weakSpots.map((w) => `${critLabel(res, w.criterion)} (${SYMBOL[Math.round(w.mark)]}${w.strongerAt.length ? `; better there: ${w.strongerAt.map((k) => labelOf(res, k)).join(', ')}` : ''})`).join('; ')}.`);
  if (res.notes.length) L.push('', ...res.notes.map((n) => `Note: ${n}.`));
  return `${L.join('\n')}\n`;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const bold = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

// An HTML fragment: its colours are the page's design-system tokens (ink,
// lines, the green and red tones), with fallbacks, so it fits the page and
// still reads on its own.
export function renderHtml(res) {
  const cols = res.candidates;
  const cell = 'padding:2px 8px;border-bottom:1px solid var(--line, rgba(0,0,0,.15));text-align:center';
  const tone = (mk) => (mk > 0 ? 'color:var(--tone-green-ink, #1b6b2a)' : mk < 0 ? 'color:var(--tone-red-ink, #9b1c1c)' : '');
  const h = [`<section class="pugh" style="color:var(--ink, #15191c);font-family:var(--font-ui, system-ui, sans-serif)">`, `<h2>${esc(res.title)}</h2>`, `<p>${bold(bottomLine(res))}</p>`];
  h.push(`<table style="border-collapse:collapse"><thead><tr><th style="${cell};text-align:left">Criterion (weight)</th>${cols.map((c) => `<th style="${cell}">${esc(c.label)}${c.datum ? ' (datum)' : ''}</th>`).join('')}</tr></thead><tbody>`);
  for (const cr of res.criteria) h.push(`<tr><td style="${cell};text-align:left">${esc(cr.label)}${cr.kind === 'judged' ? ' (judged)' : ''} (${fmt(cr.weight)})</td>${cols.map((c) => { const mk = c.marks[cr.key]; return `<td style="${cell};${tone(mk ?? 0)}">${c.datum ? 'D' : mk === null ? '?' : esc(SYMBOL[Math.round(mk)])}</td>`; }).join('')}</tr>`);
  h.push(`<tr><th style="${cell};text-align:left">Weighted</th>${cols.map((c) => `<th style="${cell}">${c.datum ? '0' : esc(signed(c.total))}</th>`).join('')}</tr>`);
  h.push(`<tr><td style="${cell};text-align:left">Fits</td>${cols.map((c) => `<td style="${cell}" title="${esc(c.whyNot)}">${c.fits ? 'yes' : 'no'}</td>`).join('')}</tr></tbody></table>`);
  if (res.sensitivity) {
    h.push(`<table style="border-collapse:collapse;margin-top:8px"><thead><tr>${['Runner-up', 'Total', 'Ties when one weight changes', 'Reasonable', 'All weights together', 'Share of draws'].map((t) => `<th style="${cell}">${t}</th>`).join('')}</tr></thead><tbody>`);
    for (const row of runnerRows(res)) h.push(`<tr>${row.map((v) => `<td style="${cell}">${esc(v)}</td>`).join('')}</tr>`);
    h.push('</tbody></table>');
  }
  const out = cols.filter((c) => !c.fits);
  if (out.length) h.push(`<p style="color:var(--ink-2, #3a4249)">Not ranked: ${esc(out.map((c) => `${c.label}: ${c.whyNot}`).join('; '))}.</p>`);
  h.push('</section>');
  return h.join('\n');
}
