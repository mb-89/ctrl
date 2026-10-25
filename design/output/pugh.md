# The Pugh decision framework

Reader: whoever needs to choose between options against criteria, in this project or another one, and whoever changes `src/core/pugh.js`. **Status: built 2026-10-25** ([input 57](../input/2026-10-25-57-pugh-framework-generic.md)): the module, its CLI and its tests; **the report is HTML, at most a page per option, with figures** ([input 59](../input/2026-10-25-59-benchmark-report-html-one-page-per-option.md)). The controller benchmark ([benchmark.md](benchmark.md)) is its first user. Research and sources: [../research/benchmark.md](../research/benchmark.md) §1, §3, §4, §6.

## Bottom line

**One file, `src/core/pugh.js`, decides between candidates the way the benchmark does, and knows nothing of controllers.** You give it the candidates, the criteria (each with a weight, a direction, a tolerance and a floor), each candidate's measured numbers or, for judgement criteria, its marks against the datum, the gates, and which candidate is the datum. It gives back, as data:

- the **five-point marks** (++ +2, + +1, S 0, − −1, −− −2) against the datum;
- the **weighted totals**;
- **who fits** and, for each one that does not, **why**;
- the **ranking** and the **suggestion**, with any higher-ranked candidate that may not be suggested;
- the **reverse sensitivity**: for each runner-up, the single-weight change at which it ties and whether that change is reasonable; the smallest change of all weights; each candidate's share of seeded random weights (SMAA's rank-1 acceptability); and a *robust* or *sensitive* verdict, all by rule;
- the **weak spots** of the suggestion, as a hint for a hybrid (Pugh's controlled convergence);
- **the report as one standalone HTML page**: the bottom line first, the matrix, one compact section per option that fits with its figures, a line for each that does not; **at most one printed page per option**, the matrix aside (see "The report").

It is deterministic (seeded, no clock), has no imports, and can be copied into another project as one file. Run it on any matrix file with:

```
node tools/pugh.mjs matrix.json -o report.html     # the report
node tools/pugh.mjs matrix.json [--html | --json]  # to the terminal: the decision as Markdown text, or the HTML, or the result as data
```

[tools/pugh-example.json](../../tools/pugh-example.json) chooses a message queue, with three measured and two judged criteria, three raters on one of them, a hard gate and a ratio gate.

## The rules, and why

| Rule | What it does | Why |
|---|---|---|
| **The datum** | `datum.prefer` lists candidates; the first one that fits is the datum; if none fits, the first listed stays the datum and the result says it does not fit | Pugh: "set a good datum" (input 48); a strong datum helps convergence (Frey et al. 2009) |
| **Measured marks** | q = (a + f)/(b + f) for lower-is-better (turned over for higher): S within the tolerance (1/(1 + tol) < q < 1 + tol), ±1 beyond it up to the strong ratio (default ×2), ±2 beyond that; a missing number is "?" and counts as 0 | Ratios are what engineers read; ×2 is a round, domain-free line for "much"; the floor keeps tiny numbers from reading as huge ratios; each mark depends only on the candidate and the datum, so adding a candidate changes no other column (research §3) |
| **Judged marks** | Given directly on the same scale, against the first preferred candidate; a list is several raters: the median is the mark, the spread is shown; if the datum falls back to another candidate, judged marks are shifted by that candidate's own mark (and clipped to ±2) | People compare more reliably than they rate (Thurstone); one scale for both kinds of criteria (research §6) |
| **Hard gates** | `{ criterion, max }` or `{ criterion, min }` on a measured value, before the datum is chosen; a missing value passes (the gate cannot judge it) | A limit that holds whatever the others do (Ms ≤ 2 in the benchmark) |
| **Ratio gates** | `{ criterion, maxRatio }`: more than that many times worse than the datum does not fit (the datum is exempt); a missing value fails; on a judged criterion, a −− fails | A weighted sum lets many small wins buy one large loss; for the job an option exists to do, that trade is refused (input 55) |
| **External fits** | A candidate may arrive with `fits: false` and `whyNot` | What the caller found itself (the benchmark: diverging, unstable) |
| **Totals and ranking** | Σ weight × mark; fitting candidates by total, then `tieBreak` (lower first), then input order | Weighted marks: concept scoring's resolution on screening's relative marks (Ulrich and Eppinger) |
| **The suggestion** | The first fitting candidate with `suggestable` not false; a `keep` candidate (what is in use now) reads "Keep X: nothing beats it"; higher-ranked candidates that may not be suggested are named | In the benchmark, plant changes are ranked but never suggested (input 48) |
| **Sensitivity** | Among the fitting, suggestable candidates: one weight at a time (Triantaphyllou and Sánchez 1997), all weights together (the distance to the hyperplane of equal totals, weights kept ≥ 0), and seeded draws, each weight uniform within ±step of its own (at least 0.01) and each multi-rater mark one rater drawn (Butler, Jia and Dyer 1997; SMAA, Lahdelma et al. 1998) | The person: "how would the weights have to change for a close-up to win? And is that change reasonable?" (input 55) |
| **Reasonable, robust** | Reasonable: every weight within ±step (default 1) of its default and above 0. Robust: no reasonable single-weight change ties a runner-up, and the winner takes at least `robustShare` (default 75 %) of the draws; otherwise sensitive. A tie at the current weights reads "tied now" and is sensitive | Mechanical (input 55: "it can't be judgment") |
| **Weak spots** | For each row where the suggestion is worse than the datum, the fitting candidates that are better there | Pugh's step 5, combine the strong concepts, as a hint; it changes nothing (research §6) |

**Interpretations** (decisions v2.9, inputs 57 and 59): the report is HTML and Markdown stays as text for terminals and agents; at most two figures per option, none for options that do not fit; the page budget measured by printing;  judged marks are relative to the datum, not absolute ratings; several raters combine by the median, and their spread enters the sensitivity draws; the weak spots are a hint only, iterating stays with people; the module is not in the page's bundle until the benchmark is built.

## The matrix file

JSON, one object. Every field but `criteria` and `candidates` is optional.

```jsonc
{
  "title": "Which message queue",                       // the report's heading
  "criteria": [
    { "key": "latency",            // a name, unique
      "label": "p99 latency (ms)", // shown; default: the key
      "weight": 3,                 // ≥ 0; 0 drops the criterion from the totals
      "better": "lower",           // "lower" | "higher"
      "tolerance": 0.1,            // the S band, relative (default 0.1)
      "floor": 0.5,                // added to both numbers in the ratio (default 0)
      "kind": "measured" },        // "measured" (values) | "judged" (marks)
    { "key": "ops", "weight": 2, "better": "higher", "kind": "judged" }
  ],
  "candidates": [
    { "key": "current", "label": "Current queue",
      "values": { "latency": 12 },  // measured criteria: numbers (null: not measured)
      "marks": { "ops": [2, 1, 2] },// judged criteria: −2 … 2, or a list (one per rater)
      "fits": true, "whyNot": "",   // what the caller found itself
      "suggestable": true,          // false: ranked, never suggested
      "keep": true,                 // what is in use now
      "tieBreak": 0.12,             // equal totals: lower first
      "note": "",                   // a sentence for its section
      "figures": [                  // optional, at most two are shown
        { "title": "Its run", "xLabel": "t (s)", "xRange": [0, 5],
          "panels": [ { "yLabel": "y", "series": [
            { "label": "y", "x": [0, 1, 2], "y": [0, 0.9, 1], "role": "option" },   // option | datum | reference | other
            { "label": "datum", "x": [0, 1, 2], "y": [0, 0.7, 1], "role": "datum" } ] } ] },
        { "title": "Ready-made", "svg": "<svg …>…</svg>" } ] }
  ],
  "gates": [ { "criterion": "latency", "maxRatio": 2, "why": "fails the main job" },
             { "criterion": "throughput", "min": 5000 } ],
  "datum": { "prefer": ["current"] },   // default: the first candidate
  "strong": 2,                          // the ratio beyond which a mark is ±2
  "sensitivity": { "step": 1, "draws": 4000, "seed": 1, "robustShare": 0.75, "runnersUp": 3 }
}
```

A matrix that cannot be decided is refused with a `PughError` naming the place ("criteria[1].better: 'lower' or 'higher'"; "candidates[2].marks.ops: a whole number from −2 to 2, or a list of them (one per rater)").

## The API

```js
import { decide, renderMarkdown, renderHtml, bottomLine, markOf, worseRatio, normalizeMatrix, sensitivity, PughError, SYMBOL, DEFAULTS, PUGH_VERSION } from './pugh.js';

const result = decide(matrix);
// result = { version, title, strong, criteria, weights, gates,
//   datum: { key, label, fits, whyNot },
//   candidates: [{ key, label, values, marks: { criterion: −2…2 | null }, spread, total, fits, whyNot, suggestable, keep, tieBreak, note, datum }],
//   ranking: [keys], suggestion: { key, label, total, keep, above: [keys] } | null,
//   sensitivity: { winner, verdict: 'robust' | 'sensitive', share, step, draws, seed, robustShare,
//                  runnersUp: [{ key, label, total, share, tie: { criterion, from, to, now, reasonable } | null, minChange: { rel, maxStep } | null }], all },
//   weakSpots: [{ criterion, mark, strongerAt: [keys] }], notes: [sentences] }
renderHtml(result, { standalone = true, sections = true })   // the report: a whole HTML page (standalone: false gives the <section> alone, for a page with the tokens)
renderMarkdown(result)   // the decision as text, for a terminal or an agent
bottomLine(result), mainReason(result), plotSvg(figure), sensitivitySvg(result)   // the parts
// each result candidate also has gains and losses: [{ criterion, mark, contribution }], largest first, and its figures
```

## The report

The person (input 59): "The output of the benchmark should be itself HTML … you can bake in pictures and graphs where it makes sense … don't make it too big … not more than one page per option that was in the comparison, not including the table itself." So the report is **one standalone HTML page**: inline SVG, no script, no file outside it (the only URL in it is SVG's namespace), `@page` A4 (it prints on Letter as well), the page's design-system tokens as CSS variables with the light theme's values as fallbacks, so it reads the same on screen, inside the page and on paper. In order:

1. **The bottom line**: the suggestion, its robustness, the main reason. "Suggestion: **Managed queue** (+6 against the datum Current queue); robust: it wins 94.8 % of the weight draws within ±1; mainly Ease of operation (++), Throughput (msg/s) (+), against p99 latency (ms) (−)." The main reason is the suggestion's two largest weighted gains against the datum and its largest loss.
2. **The sensitivity at a glance** (a figure the module draws): the winner's share of the draws; for each runner-up, the weight it hangs on, that weight's default, its reasonable band and the tie point (red when the tie is reasonable).
3. **The matrix**, the runners-up table, and **the options that do not fit, one line each** with why.
4. **One compact section per option that fits**, in ranking order: where it is better and where worse than the datum (its largest weighted marks), the weak spots for the suggestion, its note, and **at most two figures**.

**Figures are data**: an option brings its own (series the module plots, or ready SVG), or none. Series have a role (option, datum, reference, other) that sets the line: the option solid in the page's blue, the datum dashed, a reference dotted in yellow; panels stack and share x; each series is thinned to the extremes of 150 buckets, so a long run stays small.

**The page budget**: at most one printed page per option compared, the matrix aside. What keeps it: sections are short by construction (a heading, two or three lines, two figures of about 60 mm), never split across pages (`break-inside: avoid`), and options that do not fit get no section. **Measured** in `test/pugh.test.mjs` by printing to PDF in Chromium (Playwright, A4) and counting pages, with the sections and without them: the difference may not exceed the number of options. The benchmark's deadbeat motor (13 candidates, 6 fitting, two figures each): **4 pages** on A4 and on Letter, 1 for the bottom line, matrix and not-fitting lines, 3 for the six sections; the budget allows 7. Printing was chosen over a size proxy because it measures what the person counts, pages.

**Markdown** stays as the command line's text (`node tools/pugh.mjs matrix.json`) and an agent's: a terminal cannot show HTML, an agent reads text. It has the same bottom line, matrix and runners-up, without figures.

## In the benchmark

The benchmark ([benchmark.md](benchmark.md) §2.7–§2.9) builds one matrix per run: its thirteen measured criteria (lower is better), the main-job ratio gates (×2) and the Ms gate (≤ 2; the prototype 3), the datum preference (the tuned PID, then the running variant), `suggestable: false` for plant changes, `keep` for the running variant, `tieBreak` = J, and seed 55. `tools/benchmark-prototype.mjs` does exactly that; its rankings, marks, totals, fits and verdicts are identical, on all eleven systems it was run on, to its own scoring before (checked line by line; only the wording of the reasons changed). Its `--report dir` writes each system's HTML report with two figures per option (its run, y over r and u below, and its first smooth move, against the datum's dashed); `--matrix dir` writes the matrix. Example: [../research/benchmark-report-deadbeat.html](../research/benchmark-report-deadbeat.html).

## Tests

`test/pugh.test.mjs`: the mark bands at their edges, both directions, the floor; a small matrix checked by hand (marks, totals, ranking); judged marks with raters (median, spread) and the datum shift; hard and ratio gates, the datum fallback, the reason word; the sensitivity's tie points against a brute-force scan of each weight, the all-weights change against its closed form and a random search; the verdict (robust, sensitive, tied now); determinism; the report's bottom line first (and the main reason), a whole page with nothing outside it and no script; figures (plotted, thinned, at most two, bad ones refused); **the page budget** on the deadbeat matrix (`test/fixtures/pugh-deadbeat.json`, its real numbers, synthetic curves of the benchmark's size), printed to PDF in Chromium, skipped where Playwright is not installed; refusals naming the place; the example file and the CLI.
