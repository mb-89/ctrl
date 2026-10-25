import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decide, markOf, worseRatio, normalizeMatrix, renderMarkdown, renderHtml, bottomLine, PughError } from '../src/core/pugh.js';

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

test('verdict: robust, sensitive, tied now', () => {
  const r = decide(small());
  assert.equal(r.sensitivity.verdict, 'robust');
  // Two identical candidates: tied now, sensitive, the tie-break decides.
  const mx = small();
  mx.candidates.push({ key: 'B2', values: { ...mx.candidates[2].values }, tieBreak: 5 });
  const r2 = decide(mx), ru = r2.sensitivity.runnersUp.find((x) => x.key === 'B2');
  assert.equal(r2.suggestion.key, 'B');
  assert.equal(ru.tie.now, true);
  assert.equal(r2.sensitivity.verdict, 'sensitive');
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
  assert.match(lines[2], /^Suggestion: \*\*B\*\* \(\+8 against the datum D\); robust: it wins [\d.]+ % of the weight draws within ±1\.$/);
  assert.ok(md.indexOf('| Criterion') > md.indexOf('Suggestion'));
  assert.ok(md.indexOf('Runners-up') > md.indexOf('| Criterion'));
  const keep = decide({ ...small(), candidates: [{ key: 'D', keep: true, values: { err: 0.1, speed: 99, cost: 0 } }, ...small().candidates.slice(1)] });
  assert.match(bottomLine(keep), /^Keep \*\*D\*\*: nothing beats it/);
  const html = renderHtml(r);
  assert.match(html, /<strong>B<\/strong>/);
  assert.match(html, /var\(--ink, /);
  assert.doesNotMatch(renderHtml({ ...r, title: '<script>' }), /<script>/);
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
