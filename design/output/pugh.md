# The Pugh decision framework

Reader: whoever needs to choose between options against criteria, in this project or another one, and whoever changes `src/core/pugh.js`. **Status: built 2026-10-25** ([input 57](../input/2026-10-25-57-pugh-framework-generic.md)): the module, its CLI and its tests; **the report is HTML, at most a page per option, with figures** ([input 59](../input/2026-10-25-59-benchmark-report-html-one-page-per-option.md)); **the person changes the decision in the report itself, every change with a comment, and it is decided again at once** ([inputs 61–64](../input/2026-10-25-61-report-interactive-veto-nudge.md)). The controller benchmark ([benchmark.md](benchmark.md)) is its first user. Research and sources: [../research/benchmark.md](../research/benchmark.md) §1, §3, §4, §6.

## Bottom line

**One file, `src/core/pugh.js`, decides between candidates the way the benchmark does, and knows nothing of controllers.** You give it the candidates, the criteria (each with a weight, a direction, a tolerance and a floor), each candidate's measured numbers or, for judgement criteria, its marks against the datum, the gates, and which candidate is the datum. It gives back, as data:

- the **five-point marks** (++ +2, + +1, S 0, − −1, −− −2) against the datum;
- the **weighted totals**;
- **who fits** and, for each one that does not, **why**;
- the **ranking** and the **suggestion**, with any higher-ranked candidate that may not be suggested;
- the **reverse sensitivity**: for each runner-up, the single-weight change at which it ties and whether that change is reasonable; the smallest change of all weights; each candidate's share of seeded random weights (SMAA's rank-1 acceptability); and a verdict, *the choice holds* or *the choice depends on the weights* (words about the decision, never about a controller's robustness), all by rule;
- the **weak spots** of the suggestion, as a hint for a hybrid (Pugh's controlled convergence);
- **the report as one standalone HTML page**: the bottom line first, the matrix, one compact section per option with its vetoes, its marks and its figures; **at most one printed page per option**, the matrix aside (see "The report");
- **the person's changes** (overrides, as data, each with a comment): a criterion's weight or tolerance; a mark vetoed (out of the calculation) or nudged; an option vetoed or nudged; one of the tool's vetoes lifted; another datum. The report applies them in the browser at once, and the file, the CLI and the benchmark take them too (see "The person's changes").

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
| **Vetoes, one per reason** | A candidate is out while any veto stands: the caller's verdict (`fits: false`, id `given`), each hard gate that fails and each ratio gate that fails (ids `gate0`, `gate1`, … by the gate's place), and the person's own (`person`). All gates are evaluated, not just the first that fails, so every reason is listed; the person lifts a tool's veto on its own, with a comment, and the option is back in when none stands | Input 62: "not fitting … would be vetoes that you set … I can override or remove that veto"; input 64: "it could be multiple vetoes … I would have to think about if I override any of them" |
| **External fits** | A candidate may arrive with `fits: false` and `whyNot` | What the caller found itself (the benchmark: diverging, unstable) |
| **Totals and ranking** | Σ weight × mark; fitting candidates by total, then `tieBreak` (lower first), then input order | Weighted marks: concept scoring's resolution on screening's relative marks (Ulrich and Eppinger) |
| **The suggestion** | The first fitting candidate with `suggestable` not false; a `keep` candidate (what is in use now) reads "Keep X: nothing beats it"; higher-ranked candidates that may not be suggested are named | In the benchmark, plant changes are ranked but never suggested (input 48) |
| **Sensitivity** | Among the fitting, suggestable candidates: one weight at a time (Triantaphyllou and Sánchez 1997), all weights together (the distance to the hyperplane of equal totals, weights kept ≥ 0), and seeded draws, each weight uniform within ±step of its own (at least 0.01) and each multi-rater mark one rater drawn (Butler, Jia and Dyer 1997; SMAA, Lahdelma et al. 1998) | The person: "how would the weights have to change for a close-up to win? And is that change reasonable?" (input 55) |
| **Reasonable; the choice holds** | Reasonable: every weight within ±step (default 1) of its default and above 0. The choice holds (`'holds'`): no reasonable single-weight change ties a runner-up, and the winner takes at least `holdShare` (default 75 %; `robustShare`, its old name, is still read) of the draws; otherwise it depends on the weights (`'depends'`). A tie at the current weights reads "tied now" and depends | Mechanical (input 55: "it can't be judgment") |
| **Weak spots** | For each row where the suggestion is worse than the datum, the fitting candidates that are better there | Pugh's step 5, combine the strong concepts, as a hint; it changes nothing (research §6) |

**Interpretations** (decisions v2.9, inputs 57, 59 and 61–64): an option nudge is one weighted mark at the largest weight per step, a fixed amount; a vetoed cell plays no part in its option's gates; criteria are edited only in the overview table, marks and vetoes in each option's section, a weight in either (one value);  the report is HTML and Markdown stays as text for terminals and agents; at most two figures per option, none for options that do not fit; the page budget measured by printing;  judged marks are relative to the datum, not absolute ratings; several raters combine by the median, and their spread enters the sensitivity draws; the weak spots are a hint only, iterating stays with people; the module is not in the page's bundle until the benchmark is built.

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
  "sensitivity": { "step": 1, "draws": 4000, "seed": 1, "robustShare": 0.75, "runnersUp": 3 },
  "overrides": [                        // the person's changes, in order; every one has a comment
    { "kind": "criterion", "criterion": "cost", "weight": 3, "tolerance": 0.2, "comment": "budget is tight" },  // weight and/or tolerance
    { "kind": "cell", "candidate": "log", "criterion": "ops", "action": "veto", "comment": "not judged fairly" },  // out of the calculation
    { "kind": "cell", "candidate": "db", "criterion": "latency", "action": "nudge", "by": 1, "comment": "cache planned" },
    { "kind": "option", "candidate": "log", "action": "nudge", "by": -1, "comment": "unacceptable effort" },    // or "action": "veto"
    { "kind": "lift", "candidate": "db", "veto": "gate1", "comment": "throughput is enough for now" },         // one of the tool's vetoes
    { "kind": "datum", "candidate": "managed", "comment": "what we would buy anyway" } ]
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
//   sensitivity: { winner, verdict: 'holds' | 'depends', share, step, draws, seed, holdShare,
//                  runnersUp: [{ key, label, total, share, tie: { criterion, from, to, now, reasonable } | null, minChange: { rel, maxStep } | null }], all },
//   weakSpots: [{ criterion, mark, strongerAt: [keys] }], notes: [sentences] }
renderHtml(result, { standalone = true, sections = true, interactive = true })   // the report: a whole HTML page that carries the matrix and this engine (interactive: false, a static page; standalone: false gives the <section> alone, for a page with the tokens)
renderMarkdown(result)   // the decision as text, for a terminal or an agent
bottomLine(result), mainReason(result), plotSvg(figure), sensitivitySvg(result)   // the parts
boot(document)           // in the browser: what the report runs to become interactive
// a result also has overrides: [{ …override, effect }] and before: { suggestion } (without the person's changes);
// a candidate has vetoes: [{ id, by: 'tool' | 'person', why, lifted }], toolMarks, overridden: { criterion: 'veto' | 'nudge' }, nudge, offset
// each result candidate also has gains and losses: [{ criterion, mark, contribution }], largest first, and its figures
```

## The report

The person (input 59): "The output of the benchmark should be itself HTML … you can bake in pictures and graphs where it makes sense … don't make it too big … not more than one page per option that was in the comparison, not including the table itself." So the report is **one standalone HTML page**: inline SVG, nothing outside it (the only URL in it is SVG's namespace), `@page` A4 (it prints on Letter as well). In order:

1. **The bottom line**: the suggestion, whether the choice holds, the main reason. "Suggestion: **Managed queue** (+6 against the datum Current queue); the choice holds: it wins 94.8 % of the weight draws within ±1; mainly Ease of operation (++), Throughput (msg/s) (+), against p99 latency (ms) (−)." The main reason is the suggestion's two largest weighted gains against the datum and its largest loss.
2. **The sensitivity at a glance** (a figure the module draws): the winner's share of the draws; for each runner-up, the weight it hangs on, that weight's default, its reasonable band and the tie point (red when the tie is reasonable).
3. **The overview table**, laid out as a Pugh matrix usually is (input 63; research [../research/benchmark.md](../research/benchmark.md) §8): the criteria as rows with their **weight and tolerance in columns of their own**, the only place a criterion is defined and edited (input 64); **the datum's column first**, all D; then every option a column, the vetoed ones too (greyed), **their names standing on end** (bottom to top, wrapping only between words, so no word is ever broken), and a table wider than its place scrolls in its own box, never the page; under the marks **Σ +, Σ S and Σ −** (how many marks are better, the same, worse; a vetoed mark is not counted), then the **weighted total**, then the count of standing vetoes. The marks here are for reading (marks and vetoes are edited in each option's section, input 64). Then the runners-up table.
4. **One section per option**, the fitting ones in ranking order, then the vetoed ones: its vetoes, one per reason, each with Lift (or Restore) and how many remain; where it is better and where worse than the datum; the weak spots for the suggestion; its note; **a small table** of criterion, weight, its mark and the mark's weighted contribution, where the mark is vetoed or nudged and the weight (the same for every option, kept in step with the overview) may be changed; its actions (veto the option, nudge it, make it the datum); and **at most two figures**, shown while the option is in: the caller supplies figures for every option (input 62), and a vetoed option's appear once the person lifts its vetoes.

**Figures are data**: an option brings its own (series the module plots, or ready SVG), or none. Series have a role (option, datum, reference, other) that sets the line's class, and the style sheet its look; in Loop Tuner a plot is drawn like the scope (input 65): on its dark screen with its inks, the option solid in channel 2's colour, the datum dashed in the screen's ink, a reference dotted in channel 1's, another in channel 4's; on paper the screen turns light; panels stack and share x; each series is thinned to the extremes of 150 buckets, so a long run stays small.

**The page budget**: at most one printed page per option compared, the matrix aside. What keeps it: sections are short by construction (a heading, two or three lines, two figures of about 60 mm), never split across pages (`break-inside: avoid`), and options that do not fit get no section. **Measured** in `test/pugh.test.mjs` by printing to PDF in Chromium (Playwright, A4) and counting pages, with the sections and without them: the difference may not exceed the number of options. The benchmark's deadbeat motor (13 candidates, 6 fitting, two figures each): **4 pages** on A4 and on Letter, 1 for the bottom line, matrix and not-fitting lines, 3 for the six sections; the budget allows 7. Printing was chosen over a size proxy because it measures what the person counts, pages.

**The page budget, with every option a section**: the deadbeat report (13 options, 6 fitting) prints on 6 A4 pages with its two changes; in the test, with synthetic figures, 5 pages against 1 without the sections. Vetoed sections are short (their vetoes and the small table, no figures), so they were not collapsed for print.

**Its look is the one style sheet** (input 65: "make sure we have one master style sheet. Everything goes through there"). The report writes classes only (`.rpt…`, `.btn`, `.dialog`, `.seg`, the plots' `.rpt-plot` and `.rpt-sensplot`); it has no colour, size or style of its own. `renderHtml(res, { style })` embeds the sheet it is given; Loop Tuner's is `src/ui/style.css` with the page's fonts, read from those files when the report is made (`reportStyle()` in `build.mjs`), so the report looks like the page and changes with it; its components live in the sheet's section "Decision report". Without a sheet the page is plain HTML. `test/design-system.test.mjs` checks the report's markup: no colour, size, opacity or presentation attribute outside the sheet, every class one the sheet defines, every key a `.btn`, a chosen key `aria-pressed`.

**Light and dark**: the toolbar has the page's theme keys, System, Light and Dark (`data-theme` on `<html>`, the page's mechanism; by default the system's). **Print and PDF are always light** (the sheet's print rules), whatever the theme on screen. **Save report** keeps the theme chosen. Screenshots, the report beside the page in the same theme: [light](../research/benchmark-report-light.png), [dark](../research/benchmark-report-dark.png).

**Markdown** stays as the command line's text (`node tools/pugh.mjs matrix.json`) and an agent's: a terminal cannot show HTML, an agent reads text. It has the same bottom line, matrix and runners-up, without figures.

## The person's changes

The person (input 61): "every decision that you make, every judgment you make, I should be able to veto, and then it should be thrown out of the calculation at once, and the new thing should be calculated … modify the weight of something, or veto or nudge the controller by myself with a comment … I nudge it down with a comment, unacceptable effort function". Inputs 62–64 placed them: the tool's "does not fit" is its veto, one per reason; criteria are edited in the overview table, marks and vetoes in each option's section.

| Change | Where in the report | What it does |
|---|---|---|
| A criterion's weight | the overview's Weight column, or any option's small table (one value, it changes it for every option) | the totals and the sensitivity follow; the person's weight is the default the sensitivity's ±step is taken around |
| A criterion's tolerance | the overview's Tol. column (measured criteria) | every mark on that row is set again |
| A mark: veto | the option's small table | the mark is out: it adds nothing, and it plays no part in this option's gates (hard or ratio) |
| A mark: nudge | the option's small table | a step up or down on the five-point scale, within ±2; a "?" is nudged from 0 |
| An option: veto | the option's section | out of the ranking, with the comment as its reason; Remove my veto takes it back |
| An option: nudge | the option's section | a step is one mark at the largest weight (default weights: 3), added to its total as a fixed amount, also in the sensitivity draws; several nudges add up |
| A tool's veto: lift | the veto's line in the option's section | that reason no longer counts; the option is in when no veto stands; Restore takes the lift back |
| The datum | the option's section | every mark is set again against it; judged marks shift by its own mark |

**Every change carries a comment** (refused without one) and is listed under the bottom line, under **Changed by the person**, with what it changed ("Sliding mode (ideal): nudged down 1 step, −3 on its total …") and the comment; when the suggestion differs from the one without the changes, that is said too. These print. **Undo** takes back the last change; **Save report** writes the same report with the changes baked in (it opens with them, and its Undo starts there); **Export changes** writes them as JSON for `node tools/pugh.mjs matrix.json --overrides changes.json`. A host page may set `window.pughDownload(name, text, type)` to take both through its own download path (the Loop Tuner page will, for the benchmark tab).

**How it works**: the whole engine is one function, `pughEngine`; the module exports what it returns, and a report carries `pughEngine`'s own source and the matrix (as JSON) in two inline scripts, so the browser decides with the very same code, nothing copied that could drift. Without scripts the report is the static page it was. The controls are the page's keys (`.btn`) and focusable cells (Enter or Space opens a cell or a weight), the dialog is a native `<dialog>` with the page's `.dialog` look and the comment field first; print hides the controls.

**Vetoes, one model** (input 62): the caller's verdict (`given`), each failing gate (`gate<i>`) and the person's own (`person`) are the same thing, set and counted by the same code; an option is in when none stands. Lifting a tool veto ranks the option exactly as `decide()` does with that gate removed (tested), and each lift is listed under **Changed by the person** with its comment.

## In the benchmark

The benchmark ([benchmark.md](benchmark.md) §2.7–§2.9) builds one matrix per run: its thirteen measured criteria (lower is better), the main-job ratio gates (×2) and the Ms gate (≤ 2; the prototype 3), the datum preference (the tuned PID, then the running variant), `suggestable: false` for plant changes, `keep` for the running variant, `tieBreak` = J, and seed 55. `tools/benchmark-prototype.mjs` does exactly that; its rankings, marks, totals, fits and verdicts are identical, on all eleven systems it was run on, to its own scoring before (checked line by line; only the wording of the reasons changed). Its `--report dir` writes each system's HTML report with two figures per option (its run, y over r and u below, and its first smooth move, against the datum's dashed); `--matrix dir` writes the matrix. Example: [../research/benchmark-report-deadbeat.html](../research/benchmark-report-deadbeat.html).

## Tests

`test/pugh.test.mjs`: the mark bands at their edges, both directions, the floor; a small matrix checked by hand (marks, totals, ranking); judged marks with raters (median, spread) and the datum shift; hard and ratio gates, the datum fallback, the reason word; the sensitivity's tie points against a brute-force scan of each weight, the all-weights change against its closed form and a random search; the verdict (holds, depends, tied now; the old `robustShare` still read); determinism; the overview's layout (datum first, Σ +, Σ S, Σ −, the weighted total); the report's bottom line first (and the main reason), a whole page with nothing outside it and no script; figures (plotted, thinned, at most two, bad ones refused); each override kind against hand-checked matrices (weight, tolerance, cell veto and nudge, a vetoed cell out of the gates, option veto and nudge, vetoes one per reason lifted one by one, the caller's verdict lifted, another datum, refusals); **in Chromium**, the report driven by clicks, a dialog and comments (a weight, a cell veto, an option nudge, a lift, an option veto) gives the same totals, fits and bottom line as `decide()` here, Undo, Save (the saved report reopens with its changes), Export (the same JSON), the keyboard, the theme (Dark sets `data-theme`, print is light, Save keeps it); at 1440, 1000 and 390 px and in print no word in a table is broken and nothing leaves the viewport (on paper nothing would need to scroll); a lifted tool veto equals `decide()` without that gate, and the person's veto and the caller's give the same ranking; **the page budget** on the deadbeat matrix (`test/fixtures/pugh-deadbeat.json`, its real numbers, synthetic curves of the benchmark's size), printed to PDF in Chromium, skipped where Playwright is not installed; refusals naming the place; the example file and the CLI.
