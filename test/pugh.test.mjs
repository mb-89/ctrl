import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { reportStyle } from '../build.mjs';
import { decide, markOf, worseRatio, normalizeMatrix, renderMarkdown, renderHtml, bottomLine, mainReason, plotSvg, PughError } from '../src/core/pugh.js';

const require = createRequire(import.meta.url);
let chromium = null;
try { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); } catch { /* not installed */ }

const close = (a, b, tol, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} vs ${b} (tol ${tol})`);

// Three candidates on three measured criteria, marks worked out by hand.
const small = () => ({
  title: 'Small',
  criteria: [
    { key: 'err', weight: 3, better: 'lower', tolerance: 0.1, floor: 0 },
    { key: 'speed', weight: 2, better: 'higher', tolerance: 0.1, floor: 0 },
    { key: 'cost', weight: 1, better: 'lower', tolerance: 0.25, floor: 1 },
  ],
  candidates: [
    { key: 'D', values: { err: 1, speed: 10, cost: 9 } },
    { key: 'A', values: { err: 0.4, speed: 10.5, cost: 19 }, tieBreak: 2 },   // ++, S, −− ((19+1)/(9+1) = 2 → −, not beyond 2)
    { key: 'B', values: { err: 0.85, speed: 30, cost: 4 }, tieBreak: 1 },     // +, ++, + ((4+1)/(9+1) = 0.5 → +)
  ],
  datum: { prefer: ['D'] },
  sensitivity: { seed: 3, draws: 2000 },
});

test('marks follow the ratio bands, both directions, with the floor', () => {
  const lo = { better: 'lower', tolerance: 0.1, floor: 0 }, hi = { better: 'higher', tolerance: 0.1, floor: 0 };
  assert.equal(markOf(lo, 0.49, 1), 2);
  assert.equal(markOf(lo, 0.5, 1), 1);       // exactly ½: still +
  assert.equal(markOf(lo, 1 / 1.1, 1), 1);
  assert.equal(markOf(lo, 1.05, 1), 0);
  assert.equal(markOf(lo, 1.1, 1), -1);
  assert.equal(markOf(lo, 2, 1), -1);         // exactly ×2: still −
  assert.equal(markOf(lo, 2.01, 1), -2);
  assert.equal(markOf(hi, 2.01, 1), 2);       // higher is better: turned over
  assert.equal(markOf(hi, 0.49, 1), -2);
  assert.equal(markOf({ better: 'lower', tolerance: 0.2, floor: 2 }, 0, 1), 1);   // 0 % against 1 %: (0+2)/(1+2), not ×0
  assert.equal(markOf(lo, null, 1), null);
  assert.equal(markOf(lo, 0, 0), null);       // 0/0 without a floor: not judged
  close(worseRatio(hi, 4, 2), 0.5, 1e-12);
});

test('a small matrix, checked by hand', () => {
  const r = decide(small());
  const m = Object.fromEntries(r.candidates.map((c) => [c.key, c.marks]));
  assert.deepEqual(m.A, { err: 2, speed: 0, cost: -1 });
  assert.deepEqual(m.B, { err: 1, speed: 2, cost: 1 });
  assert.deepEqual(m.D, { err: 0, speed: 0, cost: 0 });
  const t = Object.fromEntries(r.candidates.map((c) => [c.key, c.total]));
  assert.equal(t.A, 3 * 2 + 0 - 1);   // 5
  assert.equal(t.B, 3 + 4 + 1);        // 8
  assert.deepEqual(r.ranking, ['B', 'A', 'D']);
  assert.equal(r.suggestion.key, 'B');
  assert.equal(r.datum.key, 'D');
});

test('judged marks, several raters (median, spread), and a judged datum shift', () => {
  const mx = {
    criteria: [{ key: 'x', weight: 1, better: 'lower' }, { key: 'look', weight: 2, better: 'higher', kind: 'judged' }],
    candidates: [
      { key: 'D', values: { x: 1 } },
      { key: 'A', values: { x: 1 }, marks: { look: [2, 1, 2] } },
      { key: 'B', values: { x: 1 }, marks: { look: [-1, 1] } },
    ],
    datum: { prefer: ['D'] },
  };
  const r = decide(mx), A = r.candidates.find((c) => c.key === 'A'), B = r.candidates.find((c) => c.key === 'B');
  assert.equal(A.marks.look, 2); assert.equal(A.spread.look, 1);
  assert.equal(B.marks.look, 0); assert.equal(B.spread.look, 2);
  // With A unfit and preferred first, the datum falls back to D: no shift.
  // With A as the datum, B's look is shifted by A's own mark: 0 − 2 = −2.
  const r2 = decide({ ...mx, datum: { prefer: ['A'] } });
  assert.equal(r2.candidates.find((c) => c.key === 'B').marks.look, -2);
  assert.equal(r2.candidates.find((c) => c.key === 'D').marks.look, null);   // D has no judged mark: not judged
  assert.ok(r2.notes.some((n) => /shifted/.test(n)));
});

test('gates: a hard limit before the datum, a ratio to the datum after, the datum exempt', () => {
  const mx = small();
  mx.gates = [{ criterion: 'cost', max: 15 }, { criterion: 'err', maxRatio: 2 }];
  mx.candidates.push({ key: 'C', values: { err: 2.5, speed: 50, cost: 1 } });   // ×2.5 the datum's error
  const r = decide(mx), by = Object.fromEntries(r.candidates.map((c) => [c.key, c]));
  assert.equal(by.A.fits, false); assert.match(by.A.whyNot, /above 15/);
  assert.equal(by.C.fits, false); assert.match(by.C.whyNot, /×2.5/);
  assert.deepEqual(r.ranking, ['B', 'D']);
  // A gate may carry its own reason word.
  const why = decide({ ...mx, gates: [{ criterion: 'err', maxRatio: 2, why: 'fails the main job' }] });
  assert.match(why.candidates.find((c) => c.key === 'C').whyNot, /^fails the main job: err ×2.5/);
  // The datum's fallback: the first preferred that fits, else the first preferred.
  const fb = decide({ ...small(), gates: [{ criterion: 'cost', max: 5 }], datum: { prefer: ['A', 'B'] } });
  assert.equal(fb.datum.key, 'B');
  const none = decide({ ...small(), gates: [{ criterion: 'cost', max: 1 }], datum: { prefer: ['A', 'B'] } });
  assert.equal(none.datum.key, 'A'); assert.equal(none.datum.fits, false);
  assert.equal(none.suggestion, null);
  assert.equal(bottomLine(none), 'No candidate fits.');
  // A missing value passes a hard limit (it cannot judge it) and fails a ratio gate.
  const miss = decide({ ...small(), candidates: [...small().candidates, { key: 'E', values: { speed: 10, cost: 9 } }], gates: [{ criterion: 'err', maxRatio: 2 }] });
  assert.match(miss.candidates.find((c) => c.key === 'E').whyNot, /no number/);
});

test('sensitivity: tie points and the smallest change agree with brute force', () => {
  const mx = small();
  mx.candidates.push({ key: 'C', values: { err: 0.95, speed: 22, cost: 9 }, tieBreak: 0 });   // S, ++, S: total 4
  const r = decide(mx), s = r.sensitivity, w = r.weights;
  const marks = Object.fromEntries(r.candidates.map((c) => [c.key, r.criteria.map((cr) => c.marks[cr.key] ?? 0)]));
  const total = (k, ww) => marks[k].reduce((t, x, i) => t + x * ww[i], 0);
  assert.equal(s.winner, 'B');
  for (const ru of s.all) {
    // Brute force: scan each weight alone in steps of 0.001 from 0 to 20 for
    // the first point (nearest to its default) where the runner-up reaches the winner.
    let best = null;
    w.forEach((_, i) => {
      for (const dir of [-1, 1]) for (let d = 0; d <= 20; d += 0.001) {
        const ww = w.slice(); ww[i] = w[i] + dir * d;
        if (ww[i] < 0) break;
        if (total(ru.key, ww) >= total('B', ww) - 1e-9) { if (!best || d < best.d) best = { i, d }; break; }
      }
    });
    if (!ru.tie) { assert.equal(best, null, ru.key); continue; }
    close(Math.abs(ru.tie.to - ru.tie.from), best.d, 2e-3, `${ru.key} tie`);
    assert.equal(r.criteria[best.i].key, ru.tie.criterion);
    // The smallest change of all weights: the distance to the hyperplane of
    // equal totals (no weight hits 0 here), checked against its closed form.
    const D = marks[ru.key].map((x, i) => x - marks.B[i]), dw = D.reduce((t, x, i) => t + x * w[i], 0);
    close(ru.minChange.rel, Math.abs(dw) / Math.hypot(...D) / Math.hypot(...w), 1e-9, `${ru.key} min change`);
    // A random search never finds a smaller change that ties.
    let seed = 11; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let n = 0; n < 2000; n++) {
      const ww = w.map((x) => Math.max(0, x + (rnd() * 2 - 1) * 3));
      if (total(ru.key, ww) >= total('B', ww)) assert.ok(Math.hypot(...ww.map((x, i) => x - w[i])) / Math.hypot(...w) >= ru.minChange.rel - 1e-9);
    }
  }
  // The shares add up to 1 and match a direct count with the same rule.
  const shares = [s.share, ...s.all.map((x) => x.share)];
  close(shares.reduce((a, b) => a + b, 0), 1, 1e-12);
});

test('verdict: the choice holds, depends on the weights, tied now', () => {
  const r = decide(small());
  assert.equal(r.sensitivity.verdict, 'holds');
  // robustShare, holdShare's old name, is still read.
  assert.equal(decide({ ...small(), sensitivity: { robustShare: 1.01 } }).sensitivity.verdict, 'depends');
  // Two identical candidates: tied now, the choice depends, the tie-break decides.
  const mx = small();
  mx.candidates.push({ key: 'B2', values: { ...mx.candidates[2].values }, tieBreak: 5 });
  const r2 = decide(mx), ru = r2.sensitivity.runnersUp.find((x) => x.key === 'B2');
  assert.equal(r2.suggestion.key, 'B');
  assert.equal(ru.tie.now, true);
  assert.equal(r2.sensitivity.verdict, 'depends');
  assert.match(bottomLine(r2), /the choice depends on the weights: .*B2 ties it now/);
});

test('deterministic: the same matrix gives the same result, the seed moves only the draws', () => {
  const a = JSON.stringify(decide(small())), b = JSON.stringify(decide(small()));
  assert.equal(a, b);
  const mx = small(); mx.candidates.push({ key: 'C', values: { err: 0.95, speed: 22, cost: 9 } });
  const s1 = decide({ ...mx, sensitivity: { seed: 1 } }), s2 = decide({ ...mx, sensitivity: { seed: 2 } });
  assert.deepEqual(s1.ranking, s2.ranking);
  assert.notEqual(s1.sensitivity.all[0].share, undefined);
});

test('the report: the bottom line first, then the matrix and the runners-up', () => {
  const r = decide(small()), md = renderMarkdown(r), lines = md.split('\n');
  assert.equal(lines[0], '# Small');
  assert.match(lines[2], /^Suggestion: \*\*B\*\* \(\+8 against the datum D\); the choice holds: it wins [\d.]+ % of the weight draws within ±1; mainly speed \(\+\+\), err \(\+\)\.$/);
  assert.equal(mainReason(r), 'mainly speed (++), err (+)');
  assert.ok(md.indexOf('| Criterion') > md.indexOf('Suggestion'));
  assert.ok(md.indexOf('Runners-up') > md.indexOf('| Criterion'));
  const keep = decide({ ...small(), candidates: [{ key: 'D', keep: true, values: { err: 0.1, speed: 99, cost: 0 } }, ...small().candidates.slice(1)] });
  assert.match(bottomLine(keep), /^Keep \*\*D\*\*: nothing beats it/);
  // The HTML report: a whole page, nothing outside it, the bottom line
  // before the matrix; its look is the style sheet it is given, nothing of
  // its own (input 65).
  const html = renderHtml(r, { style: reportStyle() });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<strong>B<\/strong>/);
  assert.ok(html.indexOf('class="rpt-bottom"') < html.indexOf('<table'));
  // What it is, first (input 68): a heading and a line on what was compared.
  assert.match(html, /<h1>Decision: Small<\/h1>\s*<p class="dim rpt-sub">3 options compared on 3 criteria against the datum, D; 3 in\.<\/p>/);
  assert.match(renderHtml(decide({ ...small(), kind: 'Controller benchmark' })), /<h1>Controller benchmark: Small<\/h1>/);
  // The caller's words (input 70): the options are controllers, the datum
  // is the one set up now; a datum that fails stays the datum and says so.
  const setUp = decide({ ...small(), kind: 'Controller benchmark', nouns: { options: 'controllers', datum: 'the one set up now' }, notes: ['a note of the caller'], gates: [{ criterion: 'cost', max: 8, why: 'too dear' }] });
  assert.equal(setUp.datum.key, 'D');
  assert.equal(setUp.datum.fits, false);
  assert.match(renderHtml(setUp), /3 controllers compared on 3 criteria against the one set up now, D; 1 in, 2 vetoed\. <span class="minus">D itself fails: too dear: cost 9 above 8\.<\/span>/);
  assert.equal(setUp.notes[0], 'a note of the caller');
  // Nothing outside the table but the bottom line, the keys, the
  // sensitivity and what opens.
  assert.doesNotMatch(html.replace(/<script[\s\S]*?<\/script>/g, ''), /<h2/);
  const noScripts = (x) => x.replace(/<script[\s\S]*?<\/script>/g, '');
  assert.equal((noScripts(html).match(/<style/g) || []).length, 1);
  assert.match(html, /<style id="rpt-style" data-license="IBM Plex/);
  assert.doesNotMatch(noScripts(renderHtml(r)), /<style/);
  assert.match(renderHtml(r, { theme: 'dark' }), /<html lang="en" data-theme="dark">/);
  // One table, an option a row (inputs 66, 67): the datum's row first,
  // then the ranking; a row is a <details> whose summary is the option's
  // bottom line (its name, its total, its marks); the weights are fields
  // in the head and nowhere else; one total, × when vetoed; nothing said
  // twice (no better/worse lines, no count of vetoes, no weighted or veto row).
  const vetoedA = renderHtml(decide({ ...small(), gates: [{ criterion: 'cost', max: 15, why: 'too dear' }] }), { style: reportStyle() });
  const sections = [...vetoedA.matchAll(/<details class="rpt-opt([^"]*)" data-section="(\w+)" data-fits="(\w+)"/g)].map((m) => [m[2], m[1].trim(), m[3]]);
  assert.deepEqual(sections, [['D', '', 'true'], ['B', '', 'true'], ['A', 'out', 'false']]);
  const rowOf = (k) => vetoedA.match(new RegExp(`data-section="${k}"[^>]*><summary class="rpt-grid">(.*?)</summary>`))[1];
  assert.deepEqual(rowOf('B').replace(/<[^>]+>/g, ' ').trim().split(/\s+/), ['B', '+8', '+', '++', '+']);
  assert.deepEqual(rowOf('A').replace(/<[^>]+>/g, ' ').trim().split(/\s+/), ['A', '+5', '×', '++', 'S', '−']);
  assert.equal((noScripts(vetoedA).match(/data-weight="/g) || []).length, 3, 'a weight is changed in the head only');
  assert.equal((noScripts(vetoedA).match(/data-cell="/g) || []).length, 6, 'every mark of every option but the datum, in place');
  for (const gone of [/Better<\/span> than/, /veto(es)? remains?/, /Weighted total/, /<td>Vetoes<\/td>/, /Σ/]) assert.doesNotMatch(noScripts(vetoedA), gone);
  // Whatever can be changed is a field, the same look everywhere.
  assert.ok([...noScripts(vetoedA).matchAll(/<button[^>]*data-(?:weight|tol|cell)=[^>]*>/g)].every((m) => /class="field field-sm rpt-field/.test(m[0])));
  // Interactive (input 61): two scripts, inline, the matrix (as data) and the
  // engine; nothing fetched; a static page without them on request.
  assert.equal((html.match(/<script/g) || []).length, 2);
  assert.match(html, /<script type="application\/json" id="pugh-matrix">/);
  assert.doesNotMatch(html, /src="|href="http|@import|fetch\(/);
  assert.doesNotMatch(renderHtml(r, { interactive: false }), /<script/);
  assert.doesNotMatch(renderHtml({ ...r, title: '<script>' }, { interactive: false }), /<script>/);
  assert.doesNotMatch(renderHtml(r, { standalone: false }), /<!doctype|<style>/);
});

test('bad matrices are refused with the place named', () => {
  const bad = (mx, re) => assert.throws(() => normalizeMatrix(mx), (e) => e instanceof PughError && re.test(e.message));
  bad({ criteria: [], candidates: [] }, /criteria/);
  bad({ ...small(), criteria: [{ key: 'err', weight: 1, better: 'up' }] }, /better/);
  bad({ ...small(), candidates: [{ key: 'D', values: { nope: 1 } }] }, /no such criterion/);
  bad({ ...small(), gates: [{ criterion: 'err', maxRatio: 2, max: 3 }] }, /exactly one/);
  bad({ ...small(), datum: { prefer: ['Z'] } }, /datum.prefer/);
  bad({ criteria: [{ key: 'j', weight: 1, better: 'higher', kind: 'judged' }], candidates: [{ key: 'a', marks: { j: 3 } }] }, /−2 to 2/);
});

test('the example file decides, and the CLI prints the same report', async () => {
  const mx = JSON.parse(readFileSync(new URL('../tools/pugh-example.json', import.meta.url), 'utf8'));
  const r = decide(mx);
  assert.equal(r.suggestion.key, 'managed');
  assert.equal(r.candidates.find((c) => c.key === 'db').fits, false);
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync(process.execPath, [new URL('../tools/pugh.mjs', import.meta.url).pathname, new URL('../tools/pugh-example.json', import.meta.url).pathname], { encoding: 'utf8' });
  assert.equal(out, renderMarkdown(r));
});

// Figures as data: series plotted to inline SVG, ready SVG passed through,
// at most two per option.
const wave = (n, f, a = 1) => ({ x: Array.from({ length: n }, (_, i) => (5 * i) / (n - 1)), y: Array.from({ length: n }, (_, i) => a * Math.sin((f * 5 * i) / (n - 1))) });
const figure = (k) => ({
  title: `figure ${k}`, xLabel: 't (s)',
  panels: [
    { yLabel: 'y', series: [{ label: 'r', ...wave(400, 1), role: 'reference' }, { label: 'datum', ...wave(400, 1.1), role: 'datum' }, { label: 'y', ...wave(400, 0.9), role: 'option' }] },
    { yLabel: 'u', series: [{ label: 'datum', ...wave(400, 7, 10), role: 'datum' }, { label: 'u', ...wave(400, 8, 12), role: 'option' }] },
  ],
});

test('figures: plotted from series, thinned, at most two per option, bad ones refused', () => {
  const svg = plotSvg(normalizeMatrix({ ...small(), candidates: [{ ...small().candidates[0], figures: [figure(1)] }] }).candidates[0].figures[0]);
  assert.match(svg, /^<svg[^>]*viewBox/);
  assert.equal((svg.match(/<polyline/g) || []).length, 5);
  assert.ok(svg.length < 60000, `thinned: ${svg.length} characters`);
  const mx = small();
  mx.candidates[2].figures = [figure(1), figure(2), figure(3), { title: 'ready', svg: '<svg id="mine"></svg>' }];
  const html = renderHtml(decide(mx), { standalone: false });
  assert.equal((html.match(/<figure>/g) || []).length, 2);
  assert.throws(() => normalizeMatrix({ ...small(), candidates: [{ key: 'D', figures: [{ title: 'x', series: [{ x: [1], y: [1, 2] }] }] }] }), /same length/);
  assert.throws(() => normalizeMatrix({ ...small(), candidates: [{ key: 'D', figures: [{ title: 'x', series: [{ x: [0, 1], y: [1, 2], role: 'hero' }] }] }] }), /role/);
});

// One page with nothing open (input 68), and the page budget with
// everything open (input 59: at most one printed page per option, the
// matrix aside). Measured by printing to PDF (A4) in Chromium and counting
// pages. The deadbeat motor's matrix (13 options, 6 in) with the example's
// two changes and two figures for every option, of the size the benchmark
// draws (400 points, two panels, five series), synthetic curves.
const deadbeat = () => {
  const mx = JSON.parse(readFileSync(new URL('./fixtures/pugh-deadbeat.json', import.meta.url), 'utf8'));
  for (const c of mx.candidates) c.figures = [figure(1), figure(2)];
  mx.kind = 'Controller benchmark';
  mx.overrides = [
    { kind: 'option', candidate: 'c10', action: 'nudge', by: -1, comment: 'unacceptable effort: the relay slams the full voltage, the motor would not last' },
    { kind: 'cell', candidate: 'c3', criterion: 'noise', action: 'veto', comment: 'the noise level is a placeholder until the current sensor is chosen' },
  ];
  return mx;
};
test('the deadbeat report: one page with nothing open, at most a page per option with everything open', { skip: !chromium && 'Playwright is not installed' }, async () => {
  const res = decide(deadbeat());
  assert.equal(res.candidates.length, 13);
  assert.equal(res.suggestion.label, 'State feedback');
  const dir = mkdtempSync(join(tmpdir(), 'pugh-'));
  const file = join(dir, 'report.html');
  writeFileSync(file, renderHtml(res, { style: reportStyle() }));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(pathToFileURL(file).href);
    await page.waitForSelector('section.rpt.live');
    const pages = async () => ((await page.pdf({ format: 'A4', preferCSSPageSize: true })).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    // Nothing open: the heading, the bottom line, the keys, the changes as
    // a line, the sensitivity and the table, on one A4 page and on one
    // screen of 1440 × 900 (the page does not scroll, nor does the table).
    assert.equal(await page.evaluate(() => document.querySelectorAll('section.rpt details[open]').length), 0);
    const screen = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, table: [...document.querySelectorAll('.rpt-scroll')].filter((b) => b.scrollWidth > b.clientWidth + 1).length }));
    assert.ok(screen.height <= 900, `${screen.height} px high at 1440 × 900`);
    assert.equal(screen.table, 0, 'the table scrolls at 1440 px');
    const closed = await pages();
    assert.equal(closed, 1, `${closed} A4 pages with nothing open`);
    // Everything open: at most a page per option more.
    await page.evaluate(() => document.querySelectorAll('section.rpt details').forEach((d) => { d.open = true; }));
    const all = await pages();
    console.log(`# page budget: ${closed} page with nothing open, ${all} with everything open, ${res.candidates.length} options`);
    assert.ok(all > closed && all - closed <= res.candidates.length, `${all} pages with everything open`);
  } finally { await browser.close(); }
});

// ---- Overrides (inputs 61–64) -----------------------------------------------

const withOv = (mx, ...overrides) => decide({ ...mx, overrides });
const cand = (r, k) => r.candidates.find((c) => c.key === k);

test('overrides: a criterion’s weight and tolerance', () => {
  const r = withOv(small(), { kind: 'criterion', criterion: 'speed', weight: 0, comment: 'speed does not matter here' });
  assert.equal(cand(r, 'B').total, 3 + 0 + 1);   // speed's ++ no longer counts
  assert.equal(r.weights[1], 0);
  assert.match(r.overrides[0].effect, /speed: weight 2 → 0/);
  // A wider tolerance turns B's err + (0.85 against 1) into S at tolerance 0.5: 1/1.5 < 0.85.
  const t = withOv(small(), { kind: 'criterion', criterion: 'err', tolerance: 0.5, comment: 'only big differences count' });
  assert.equal(cand(small() && decide(small()), 'B').marks.err, 1);
  assert.equal(cand(t, 'B').marks.err, 0);
  assert.match(t.overrides[0].effect, /err: tolerance 0.1 → 0.5/);
});

test('overrides: a cell vetoed (out of the totals and the gates) or nudged', () => {
  const v = withOv(small(), { kind: 'cell', candidate: 'B', criterion: 'speed', action: 'veto', comment: 'speed test was wrong' });
  assert.equal(cand(v, 'B').marks.speed, null);
  assert.equal(cand(v, 'B').toolMarks.speed, 2);
  assert.equal(cand(v, 'B').total, 3 + 1);
  const n = withOv(small(), { kind: 'cell', candidate: 'A', criterion: 'cost', action: 'nudge', by: -1, comment: 'too expensive to run' });
  assert.equal(cand(n, 'A').marks.cost, -2);
  assert.equal(cand(n, 'A').total, 6 + 0 - 2);
  // A vetoed cell plays no part in its option's gates.
  const mx = { ...small(), gates: [{ criterion: 'cost', max: 15 }] };
  assert.equal(cand(decide(mx), 'A').fits, false);
  assert.equal(cand(withOv(mx, { kind: 'cell', candidate: 'A', criterion: 'cost', action: 'veto', comment: 'cost is negotiable' }), 'A').fits, true);
});

test('overrides: an option vetoed or nudged (a step is one mark at the largest weight)', () => {
  const v = withOv(small(), { kind: 'option', candidate: 'B', action: 'veto', comment: 'unacceptable effort' });
  assert.equal(cand(v, 'B').fits, false);
  assert.match(cand(v, 'B').whyNot, /vetoed by the person: unacceptable effort/);
  assert.equal(v.suggestion.key, 'A');
  assert.equal(v.before.suggestion, 'B');
  const n = withOv(small(), { kind: 'option', candidate: 'B', action: 'nudge', by: -1, comment: 'unacceptable effort function' });
  assert.equal(n.nudgeUnit, 3);
  assert.equal(cand(n, 'B').total, 8 - 3);
  assert.deepEqual(n.ranking, ['B', 'A', 'D']);   // 5 = 5: B's tieBreak 1 beats A's 2
  const n2 = withOv(small(), { kind: 'option', candidate: 'B', action: 'nudge', by: -1, comment: 'a' }, { kind: 'option', candidate: 'B', action: 'nudge', by: -1, comment: 'b' });
  assert.equal(cand(n2, 'B').total, 2);
  assert.equal(n2.suggestion.key, 'A');
  // The nudge is a fixed offset in the sensitivity too.
  assert.equal(n2.sensitivity.winner, 'A');
});

test('overrides: the tool’s vetoes, one per reason, each lifted on its own', () => {
  const mx = { ...small(), gates: [{ criterion: 'cost', max: 15, why: 'too dear' }, { criterion: 'err', maxRatio: 1.05, why: 'main job' }] };
  mx.candidates[1] = { ...mx.candidates[1], values: { err: 1.2, speed: 10.5, cost: 19 } };   // A fails both gates
  const r = decide(mx), A = cand(r, 'A');
  assert.deepEqual(A.vetoes.map((v) => v.id), ['gate0', 'gate1']);
  assert.equal(A.fits, false);
  const one = withOv(mx, { kind: 'lift', candidate: 'A', veto: 'gate0', comment: 'the budget can stretch' });
  assert.equal(cand(one, 'A').fits, false, 'one veto remains');
  assert.match(one.overrides[0].effect, /1 veto remains/);
  const both = withOv(mx, { kind: 'lift', candidate: 'A', veto: 'gate0', comment: 'the budget can stretch' }, { kind: 'lift', candidate: 'A', veto: 'gate1', comment: 'close enough' });
  assert.equal(cand(both, 'A').fits, true);
  assert.ok(both.ranking.includes('A'));
  assert.match(both.overrides[1].effect, /it is back in/);
  // The caller's verdict is a veto too, liftable.
  const given = { ...small(), candidates: small().candidates.map((c) => (c.key === 'A' ? { ...c, fits: false, whyNot: 'diverges' } : c)) };
  assert.deepEqual(cand(decide(given), 'A').vetoes.map((v) => v.id), ['given']);
  assert.equal(cand(withOv(given, { kind: 'lift', candidate: 'A', veto: 'given', comment: 'a model artefact' }), 'A').fits, true);
  // A lift of a veto that is not there is said, not dropped silently.
  assert.ok(withOv(small(), { kind: 'lift', candidate: 'A', veto: 'gate9', comment: 'x' }).notes.some((n) => /no veto 'gate9'/.test(n)));
});

// Input 62: a lifted veto is as if the tool had never set it, and the
// person's veto and the tool's are one and the same thing.
const decision = (r) => ({ ranking: r.ranking, suggestion: r.suggestion?.key, totals: r.candidates.map((c) => [c.key, c.total, c.fits]), sensitivity: r.sensitivity && { verdict: r.sensitivity.verdict, share: r.sensitivity.share } });
test('a lifted tool veto ranks the option as decide() does without that gate', () => {
  const gates = [{ criterion: 'cost', max: 15, why: 'too dear' }, { criterion: 'err', maxRatio: 1.05, why: 'main job' }];
  const mx = { ...small(), gates, candidates: small().candidates.map((c) => (c.key === 'A' ? { ...c, values: { err: 1.2, speed: 10.5, cost: 19 } } : c)) };   // only A fails, both gates
  for (const [gi, id] of [[0, 'gate0'], [1, 'gate1']]) {
    const other = gates.filter((_, k) => k !== gi);
    const lifted = withOv(mx, { kind: 'lift', candidate: 'A', veto: id, comment: 'x' }, { kind: 'lift', candidate: 'A', veto: gi ? 'gate0' : 'gate1', comment: 'y' });
    const without = decide({ ...mx, gates: [] });
    assert.deepEqual(decision(lifted), decision(without), `${id} and the other lifted: as without both gates`);
    const one = withOv(mx, { kind: 'lift', candidate: 'A', veto: id, comment: 'x' });
    assert.deepEqual(decision(one), decision(decide({ ...mx, gates: other })), `${id} lifted: as without that gate`);
  }
});

test('the person’s veto and the tool’s are one path: the same ranking either way', () => {
  const byTool = decide({ ...small(), candidates: small().candidates.map((c) => (c.key === 'B' ? { ...c, fits: false, whyNot: 'diverges' } : c)) });
  const byPerson = withOv(small(), { kind: 'option', candidate: 'B', action: 'veto', comment: 'diverges' });
  assert.deepEqual(decision(byPerson), decision(byTool));
  assert.deepEqual(cand(byPerson, 'B').vetoes.map(({ by, why }) => [by, why]), [['person', 'diverges']]);
  assert.deepEqual(cand(byTool, 'B').vetoes.map(({ by, why }) => [by, why]), [['tool', 'diverges']]);
  // Lifting the tool's and removing the person's both give the matrix back.
  assert.deepEqual(decision(withOv(byTool.input, { kind: 'lift', candidate: 'B', veto: 'given', comment: 'x' })), decision(decide(small())));
});

test('overrides: another datum; bad overrides are refused', () => {
  const r = withOv(small(), { kind: 'datum', candidate: 'B', comment: 'B is what we know' });
  assert.equal(r.datum.key, 'B');
  assert.equal(cand(r, 'D').marks.err, -1);   // 1 against 0.85
  assert.match(r.overrides[0].effect, /the datum: D → B/);
  const bad = (o, re) => assert.throws(() => withOv(small(), o), (e) => e instanceof PughError && re.test(e.message));
  bad({ kind: 'cell', candidate: 'A', criterion: 'err', action: 'veto' }, /comment/);
  bad({ kind: 'cell', candidate: 'A', criterion: 'err', action: 'nudge', by: 0, comment: 'x' }, /by/);
  bad({ kind: 'option', candidate: 'Z', action: 'veto', comment: 'x' }, /candidate/);
  bad({ kind: 'criterion', criterion: 'err', comment: 'x' }, /a weight or a tolerance/);
  bad({ kind: 'nope', comment: 'x' }, /kind/);
});

// ---- The interactive report in a browser ----------------------------------------

// Drives the report as a person would: a click, the dialog, a comment, the
// button. The page decides with the engine it carries; the result must equal
// decide() here on the same matrix and overrides.
test('the report decides again in the browser, and equals decide() here', { skip: !chromium && 'Playwright is not installed' }, async () => {
  const mx = { ...small(), gates: [{ criterion: 'cost', max: 15, why: 'too dear' }] };   // A is out: cost 19
  const dir = mkdtempSync(join(tmpdir(), 'pugh-live-'));
  const file = join(dir, 'report.html');
  writeFileSync(file, renderHtml(decide(mx), { style: reportStyle() }));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(file).href);
    await page.waitForSelector('section.rpt.live');
    const act = async (selector, choice, { comment = 'a reason', weight } = {}) => {
      await page.click(selector);
      if (weight !== undefined) await page.fill('#pugh-weight', String(weight));
      if (comment) await page.fill('#pugh-comment', comment);
      await page.click(`dialog [data-do="${choice}"]`);
      await page.waitForFunction(() => !document.querySelector('dialog.rpt-dialog')?.open);
    };
    await act('[data-weight="cost"] >> nth=0', 'set', { weight: 2, comment: 'cost matters more' });
    await act('[data-cell="B|speed"]', 'veto', { comment: 'the speed test was wrong' });
    // A mark sits in its row's summary: changing it does not open the row.
    assert.equal(await page.evaluate(() => document.querySelector('[data-section="B"]').open), false);
    // A row opens to its actions and vetoes, and stays open across changes.
    await page.click('[data-section="B"] > summary .rpt-name');
    await act('[data-act="up"][data-cand="B"]', 'up', { comment: 'easy to maintain' });
    assert.equal(await page.evaluate(() => document.querySelector('[data-section="B"]').open), true);
    await page.focus('[data-section="A"] > summary');
    await page.keyboard.press('Enter');
    assert.equal(await page.getAttribute('[data-section="A"]', 'open'), '');
    await act('[data-lift="A|gate0"]', 'lift', { comment: 'the budget can stretch' });
    await act('[data-act="veto"][data-cand="B"]', 'veto', { comment: 'unacceptable effort' });
    const state = await page.evaluate(() => ({ overrides: window.pughState.overrides, totals: Object.fromEntries([...document.querySelectorAll('[data-total]')].map((e) => [e.dataset.total, Number(e.dataset.value)])), fits: Object.fromEntries([...document.querySelectorAll('[data-section]')].map((e) => [e.dataset.section, e.dataset.fits === 'true'])), bottom: document.querySelector('[data-bottom]').textContent }));
    assert.deepEqual(state.overrides.map((o) => o.kind), ['criterion', 'cell', 'option', 'lift', 'option']);
    const here = decide({ ...mx, overrides: state.overrides });
    for (const c of here.candidates) {
      close(state.totals[c.key], c.total, 1e-12, `${c.key} total`);
      assert.equal(state.fits[c.key], c.fits, `${c.key} fits`);
    }
    assert.equal(state.bottom, bottomLine(here).replace(/\*\*/g, ''));
    // Undo takes back the last change.
    await page.click('[data-tool="undo"]');
    assert.equal(await page.evaluate(() => window.pughState.overrides.length), 4);
    // Save: the same report, its changes baked in; it reopens with them.
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-tool="save"]')]);
    const saved = join(dir, 'saved.html');
    await download.saveAs(saved);
    const again = await browser.newPage();
    await again.goto(pathToFileURL(saved).href);
    await again.waitForSelector('section.rpt.live');
    const reopened = await again.evaluate(() => window.pughState.overrides);
    assert.equal(reopened.length, 4);
    assert.match(await again.textContent('.rpt-person > summary'), /^4 changes by you/);
    // Export: the changes as JSON, for the command line.
    const [exp] = await Promise.all([page.waitForEvent('download'), page.click('[data-tool="export"]')]);
    const json = join(dir, 'changes.json');
    await exp.saveAs(json);
    assert.deepEqual(JSON.parse(readFileSync(json, 'utf8')), reopened);
    // Keyboard: a weight opens with Enter.
    await page.focus('[data-weight="err"] >> nth=0');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.querySelector('dialog.rpt-dialog').open), true);
    await page.keyboard.press('Escape');
    // The theme (input 65): the page follows the system until a key is
    // pressed; dark sets data-theme, the key reads pressed; print is light.
    const bg = (p) => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.emulateMedia({ colorScheme: 'light' });
    const light = await bg(page);
    await page.click('[data-theme-set="dark"]');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    assert.equal(await page.getAttribute('[data-theme-set="dark"]', 'aria-pressed'), 'true');
    assert.notEqual(await bg(page), light);
    await page.emulateMedia({ media: 'print' });
    assert.equal(await bg(page), light, 'print is light whatever the theme');
    // Paper shows what is open (input 68): B, opened above, prints its
    // panel; the rows left closed print as a line.
    const shown = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('details.rpt-opt')].map((d) => [d.dataset.section, [d.open, d.querySelector('.rpt-panel').checkVisibility()]])));
    assert.deepEqual(shown.B, [true, true]);
    for (const [k, [isOpen, seen]] of Object.entries(shown)) assert.equal(seen, isOpen, `${k} printed as it is`);
    await page.emulateMedia({ media: 'screen' });
    // Print with everything open: every <details> open while printing,
    // then back as it was.
    await page.evaluate(() => { window.print = () => { window.allOpen = [...document.querySelectorAll('section.rpt details')].every((d) => d.open); window.dispatchEvent(new Event('afterprint')); }; });
    await page.click('[data-tool="print-all"]');
    assert.equal(await page.evaluate(() => window.allOpen), true);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('details.rpt-opt[open]')].map((d) => d.dataset.section)), ['B', 'A'].filter((k) => shown[k][0]));
    // Save keeps the theme chosen.
    const [dark] = await Promise.all([page.waitForEvent('download'), page.click('[data-tool="save"]')]);
    const darkFile = join(dir, 'dark.html');
    await dark.saveAs(darkFile);
    assert.match(readFileSync(darkFile, 'utf8'), /<html lang="en" data-theme="dark">[\s\S]*<style id="rpt-style"/);
    await page.click('[data-theme-set="system"]');
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-theme')), false);
  } finally { await browser.close(); }
});


// At every width no word is broken and nothing leaves the viewport: the
// options' names stand on end, a table wider than its place scrolls in its
// own box; on paper (A4, 186 mm of text) nothing needs to scroll.
test('the report at 1440, 1000 and 390 px and in print: no word broken, nothing outside the viewport', { skip: !chromium && 'Playwright is not installed' }, async () => {
  const mx = JSON.parse(readFileSync(new URL('./fixtures/pugh-deadbeat.json', import.meta.url), 'utf8'));
  for (const c of mx.candidates) c.figures = [figure(1), figure(2)];
  const dir = mkdtempSync(join(tmpdir(), 'pugh-widths-'));
  const file = join(dir, 'report.html');
  writeFileSync(file, renderHtml(decide(mx), { style: reportStyle() }));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(file).href);
    await page.waitForSelector('section.rpt.live');
    const check = () => page.evaluate(() => {
      const broken = [];
      for (const cell of document.querySelectorAll('.rpt th, .rpt td, .rpt-grid > *')) {
        const walk = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          for (const m of n.data.matchAll(/\S+/g)) {
            const r = document.createRange();
            r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
            if (r.getClientRects().length > 1) broken.push(m[0]);
          }
        }
      }
      const scrolls = [...document.querySelectorAll('.rpt-scroll')].filter((b) => b.scrollWidth > b.clientWidth + 1).length;
      return { broken, page: document.documentElement.scrollWidth - window.innerWidth, scrolls };
    });
    for (const width of [1440, 1000, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const r = await check();
      assert.deepEqual(r.broken, [], `${width} px: words broken`);
      assert.ok(r.page <= 0, `${width} px: the page is ${r.page} px wider than the viewport`);
      if (width >= 1000) assert.equal(r.scrolls, 0, `${width} px: a table scrolls`);
    }
    // Print: A4's 186 mm of text is about 703 px; paper cannot scroll.
    await page.emulateMedia({ media: 'print' });
    await page.setViewportSize({ width: 703, height: 1000 });
    const p = await check();
    assert.deepEqual(p.broken, [], 'print: words broken');
    assert.equal(p.scrolls, 0, 'print: a table would need to scroll');
    assert.ok(p.page <= 0, 'print: wider than the paper');
  } finally { await browser.close(); }
});
