# The controller benchmark: which controller for this plant

Reader: the person, deciding whether this is the benchmark they asked for; then whoever builds it, after the overhaul. **Status: designed 2026-10-25, prototyped in Node (`tools/benchmark-prototype.mjs`), not built.** The research is [../research/benchmark.md](../research/benchmark.md); the prototype's full output is [../research/benchmark-prototype.md](../research/benchmark-prototype.md).

The person's words:
- Input 10: "we identify a plant. If we are sure that we have identified it, then we run a controller benchmark against all the controllers we know. And then we produce a report … You tune all of them. You look up what a [Pugh] matrix is. You would create a [Pugh] matrix with criteria. You judge the different options by, and then you would select the best option."
- Input 29: "you take the current plant and you run all controllers that we have against it and try to figure out which ones fit and which would be the best with which tuning."
- Input 35: "a big matrix where you compare which controller can I use for this plant, how good are the results … To make a decision on which controller to use in which plant."

## 0. Bottom line: what the person sees and does

- **Auto-tune gets a second mode, Benchmark** (a switch at the top of the tab: *This variant* | *Every type*). The person picks nothing else and presses **Start**. The plant is the current one: the diagram, or the identified model when Identify has one (always the model on HIL).
- **The page then, on its own:**
  1. lists every controller type the library knows, and says which ones **cannot run here and why** ("Sliding mode reads ẏ on input 3; this block measures 1 signal"; "LQR needs every state measured: this block sees thermocouple but not heater and chamber");
  2. **tunes each one that can** on the same goal (the Auto-tune goal) and the same experiment (the input's period, with its disturbance), within the same robustness bound;
  3. **scores each** on twelve criteria: following r, rejecting d, overshoot, settling, effort, actuator wear, time at a limit, robustness margin (Ms), behaviour on plants varied by ±15 %, noise passed to u, complexity, tuning effort;
  4. drops what **does not fit** (diverges, unstable where it runs, or fragile: Ms above 2), with the reason;
  5. puts the rest in a **Pugh matrix**: + / S / − against a datum (the tuned PID, or the running variant when the PID does not fit), the weights beside the criteria, the weighted total under each column; then a **second round with the winner as datum**, as Pugh iterates;
  6. **recommends** the winner in one sentence with its reasons ("Sliding mode with a boundary layer: follows and rejects the load as well as the PID, with the same wear, a sixth of the noise in u and Ms 1.6 against 2.1"), and adds it to the block as a variant (not running until the person flips it, as for an Auto-tune result that is not better).
- **What the person sees while it runs**: the matrix filling column by column; each candidate's run sweeping on the scope at the header's Speed, the best runs fading behind (as Auto-tune shows its runs); a progress line ("4 of 8 · tuning Super-twisting · 12 s left").
- **What they can change**: the weights (the matrix re-ranks at once, nothing re-runs), the datum (click a column's head), which candidates take part (a tick per column), the variation (±15 % by default) and the Ms bound. Each candidate's column opens its numbers, its gains and its runs.
- **The report**: **Download report** gives one HTML page (or Markdown, `--report x.md`) with the plant, the goal, the refusals, the matrix, the numbers, the runs overlaid, and the reasons.
- **The same from an agent**: `node cli.mjs benchmark <project>` and the MCP tool `benchmark` return the matrix as JSON and the report.
- **Cost**: 1–2 s for most library systems, about 20 s for the 1 ms sliding-mode motor (measured, §8), in a Worker so the page stays live.

What the prototype found on three systems (§7): on the **sliding-mode motor** the boundary-layer sliding mode wins (+8 against the PID; the ideal relay rejects the load best but travels 86 V/s of the range per second, the boundary layer 1.6); on the **oven** the PID, the PI from the plant and the scheduled PI are the same within tolerance (a linear plant needs no schedule) and the feedforward edges ahead (+2); on the **conical tank** a single PID or PI does not fit (unstable where the tank starts) and the loaded schedule stays best. The pendulum and the triple pendulum showed the limit: a swing-up is not judged by following r (§10).

## 1. Where it lives: a mode of Auto-tune, not a tab

| | A sixth tab, Benchmark | A mode of Auto-tune (chosen) |
|---|---|---|
| The person's word | — | "that benchmark **mode**" (input 10) |
| Goal | A second copy of the goal settings, or shared state between tabs | The same Goal column: one goal for the benchmark and for tuning one variant |
| Block, result | Its own block picker; results into variants | Auto-tune's: the block picker, results into variants, Undo as one step |
| Pacing, display | A second implementation | Auto-tune's: Speed, the sweeps, the cost plot |
| Tabs | Seven tabs, against "the tabs exist to keep the screen calm" ([tabs.md](tabs.md)) | Six |

**Decision (interpretation): a mode of Auto-tune.** The benchmark is tuning applied to every type instead of one, scored more widely; it shares everything Auto-tune owns. Its matrix needs width, so in Benchmark mode the tab's four columns become two: **Setup** (the mode switch, the block, the goal, the variation and the Ms bound, Start) and **Matrix** (the matrix, the recommendation, Download report). Progressive disclosure ([tabs.md](tabs.md)): the matrix shows marks and totals; each cell's number is its tooltip; a column's Details open its numbers, gains and how it was tuned; the refusals sit under the matrix in one folded line ("7 types cannot run here ▸").

## 2. The flow

```
plant (diagram | identified twin)
  → candidates: every registered type → applies? (refusal with its sentence) → starts
  → tune each (same goal, same budget, same Ms bound)
  → score each (nominal run, linear loop, ±15 % sweep, noise run, registry facts)
  → gates (fits / why not) → Pugh round 1 (datum) → round 2 (winner) → recommendation → report
```

### 2.1 The plant
- **The diagram**, as Auto-tune uses it (`tuneContext`): a copy, the block's other variants left alone.
- **The identified model**, when Identify has one in use: its twin diagram (`twinDiagram`, [identification.md](identification.md) §10), with its test push at the input. On HIL the benchmark refuses without one ("identify the plant first (Identify tab)") and runs on the twin with one; the recommendation then goes through **Try on the plant** (identification.md §11). This is input 10's order: identify, then benchmark.
- The **±15 % sweep** uses `varyDiagram(diagram, 0.15, seed)` from the Identify design (the prototype has a stand-in, `vary`): every physical number of the plant's blocks scaled by a seeded factor. On an identified model it varies the model's parameters, or uses its uncertainty where Identify reports one (each fitted parameter ± 2 σ, the larger of the two).

### 2.2 The candidates: every type the registry knows
The list is `CONTROLLER_TYPES`, read at run time, so the Hu–Lin variable-gain type, deadbeat and the PUMA's speed PI join by registering, with no list in the benchmark to update (decisions: locality). **Each type says how it takes part, in its own registry entry**, as an optional `bench` hook:

```js
bench: {
  applies(c) → '' | sentence      // why it cannot run on this block; c: the block's facts (below)
  start(c) → [{ name?, params, how }]   // one or more starting variants (sliding mode: ideal and boundary layer)
  tune: 'iterate' | 'knob' | 'none'     // its gains by Iterate; one speed input searched (designed types); nothing
  knob: 'Tcl'                     // for 'knob': the input that sets its speed
  after: 'pid'                    // a type that starts from another's result (the PID's feedforward from the PID)
  reads(p, m) → n                 // the measurements it reads (complexity); default 1
}
c = { m, umin, umax, rLo, rHi, rMid, rSpan, Ts, model (the step test's), tauGuess, lambda, tuned: {type: variant}, refused: {type: sentence}, design(variant) }
```

**A type without the hook still takes part**: a designed type is computed with its defaults and refused when its design refuses (the design's own sentence: "PI from the plant: angle integrates V: it has no static gain"); a hand type is iterated from its defaults when `tuningSpace` can tune it, else scored as it is. So a new type is never silently left out; the hook only makes it start well. Types that are not controllers (`off`, the hidden `experiment`) declare `applies: () => 'not a candidate'`.

What each type on main declares (the prototype's table, `BENCH` in the script):

| Type | Applies when | Starts from | Tuned by |
|---|---|---|---|
| PID | always | the step test's SIMC gains, else the relay's Tyreus–Luyben, else Kp = 1 | Iterate |
| PID + feedforward from the plant | its design works (no kink, minimum phase) | the PID row's gains; Kff, Kv, Ka computed | knob: the prefilter Tr (a feedforward on a stepped r kicks; Tr shapes r) |
| PI from the plant | its design works (a static gain, no kink) | one level, r's middle | knob: Tcl |
| Gain-scheduled PI | r moves | the step tests' SIMC schedule, else PI from the plant at three levels of r, else the PID's gains flat | Iterate (the tables scaled) |
| LQR | its design works (every state measured, at rest) | Q = 1 per measurement | knob: R |
| State feedback | LQR worked | the LQR row's gains | Iterate |
| Swing-up, swing-up + LQR, planned swing-up | a pendulum on a cart (4 measurements, an angle) | defaults; designs | none, or knob R |
| Relay | finite actuator limits | the full range, hysteresis 0.5 % of r | none |
| Sliding mode | finite limits and ẏ on input 3 | two: ideal (φ = 0) and boundary layer; λ = 1/τc from the step test, K the full swing | Iterate (λ, φ) |
| Super-twisting | finite limits and ẏ | λ as above, k1 = U/3, k2 = 3.7 U | Iterate |
| Off | never: "the open loop, not a candidate" | | |

**The running variant takes part as it is** ("As loaded: …"), untuned: it shows what the person has now and can be the datum.

**Interpretation: the benchmark does not rewire the plant.** A sliding mode needs ẏ on input 3, LQR every state: on a block that does not measure them they are refused with what they would need ("a Finite difference observer would make it"). Adding an observer or a sensor changes the plant the person built; it stays the person's choice. Later, the hook may offer "would apply with a Finite difference observer on input 3" as a one-click variant of the plant (§11).

### 2.3 Tuning: how fair
- **The same goal**: the Auto-tune goal (cost type, effort weight, overshoot bound), copied at Start; the same experiment (one period of the input, the disturbance included), the same cost scales for everyone (r's span, the actuator range).
- **The same budget**: Iterate up to 60 iterations from each start (the prototype: 15–120 runs per candidate); a knob search 15 designs; a type with nothing to tune one run. The runs are reported as *Tuning runs*, a criterion.
- **Each from its best start**: a rule or a design first (SIMC, the plant's pole cancellation, LQR), then the search. A structure is judged at its best on the goal, not as it happened to be set (research §2, fairness).
- **Designed types stay designed**: their numbers are computed from the plant; only the input that sets their speed (Tcl, R, Tr) is searched. So *PI from the plant* is what the plant model gives, and *PID* is what the search gives; both are in the matrix and the person sees whether the search earned its runs.
- **The same robustness bound**: tuning must keep **Ms ≤ 2** where the loop works and stay stable where the run starts and on every varied plant. Iterate's cost has no robustness term, and tuning to J alone buys a little IAE with a lot of margin: on the tank Iterate took the schedule to Ms 12, phase margin 9° (Ms 13 on its input since inputs 50–52); on the sliding-mode motor the PID to Ms 2.1, phase margin 34°. The build adds the bound to Iterate (`goal.msMax`, a penalty like the overshoot's, on the linear loop at r's middle, each run; research §2, MIGO). The prototype, which leaves the core alone, **backs off** instead: a tuned result that fails a gate is moved back along the way it came (¾, ½, ¼ of the way from its start, then the start) until it passes; the tank's schedule passed at ¼ of the way (Ms 2.5 with the prototype's bound of 3).
- **What is not equal, and is said**: a type that cannot be tuned (the relay) is scored at its start; the gain-scheduled PI scales whole tables, not each entry; switching laws have no Ms, so the sweep alone judges their robustness. The report states each.

### 2.4 Scoring: the criteria
Each candidate is run once on the nominal plant, once with measurement noise, once on each of 8 varied plants, and its loop is linearised where it works. All are deterministic.

| Criterion | Measure | Better | Tolerance (S within) | Weight |
|---|---|---|---|---|
| Following r | IAE of r − y per sample over the windows after each step of r (until the next step or a jump of d), / r's span | lower | 10 % | 3 |
| Rejecting d | IAE after each jump of d until the next step of r, / r's span | lower | 10 % | 3 |
| Overshoot | the worst step's, % of the step | lower | 20 %, 2 points | 2 |
| Settling | mean time into the 2 % band after a step (a window that never settles counts whole) | lower | 15 % | 1 |
| Effort | rms of u about its mean, / the actuator range | lower | 15 % | 1 |
| Wear | total variation of u per second, / the range (Σ\|Δu\|/U/T) | lower | 25 % | 2 |
| Time at a limit | share of samples at u min or u max | lower | 25 %, 2 points | 1 |
| Robustness | Ms of the loop linearised at r's middle (Analysis core); PM, GM, delay margin shown | lower | 10 % | 2 |
| Plant ±15 % | the worst J over 8 seeded varied plants | lower | 15 % | 3 |
| Noise → u | rms change of u with white noise of σ = 0.5 % of each measurement's span on every measurement, / range | lower | 25 % | 2 |
| Complexity | numbers in the law + measurements read + 2 when it needs a plant model | lower | ½ | 1 |
| Tuning effort | runs the tuning took | lower | 50 %, 5 runs | 1 |

- **Weights**: the defaults above (following, rejection and plant change count most; the person's list in input 10 named "following, disturbance rejection, overshoot, robustness to the plant's ±15 % variation, effort and actuator wear, noise sensitivity, complexity"). Editable in the tab and by `--weights track=3,dist=3,…`; a weight of 0 removes the row. Saved with the project's benchmark settings, not per viewer (they are the person's decision criteria and belong with the report).
- **A missing number is "?"**, counted as S, and named: Ms for a law with no linear model ("no linear model: the sweep judges its robustness").
- **The tolerances** make "better" mean something: without them a 0.1 % difference would be a +. They are per criterion, relative to the datum's value with an absolute floor.
- **Interpretation**: the linear loop is taken at r's middle (a trim of y1 there), where the loop works, not at the start: the oven starts with the heater at 0, at its limit, where no linear loop holds. A system may name its own operating point (§10).

### 2.5 Gates: which ones fit
A candidate **fits** when it (1) does not diverge on the nominal plant, (2) does not diverge on any of the varied plants, (3) is not unstable at r's middle, (4) is not unstable where the run starts (Auto-tune's check, v2.7.3: a loop that starts in exact balance rests even where it is unstable; marginal passes), and (5) has Ms ≤ 2 where linear. A candidate that does not fit stays in the matrix, greyed, with its reason in the Fits row ("unstable where the run starts (2 poles outside); it rests there only because it starts in balance"; "fragile: Ms 12 at r's middle, PM 9°"); it is not ranked. This is input 29's "which ones fit".

**Interpretation**: the prototype used Ms ≤ 3 to see the back-off work; the design takes **2**, the usual "acceptable" bound ([analysis.md](analysis.md) grades Ms ≤ 2 fair).

### 2.6 The Pugh matrix and the ranking
- Columns: the candidates (the running variant first); rows: the criteria with their weights; cells: **+ / S / −** against the datum's number, **D** in the datum's column, **?** where a number is missing. Under them: the count of + and − (Pugh's own reading), the weighted total (Σ w·(+1, 0, −1), the common variant), and Fits.
- **The datum**: the tuned PID, the controller everyone knows (roadmap: "against a datum (the PID)"); if it does not fit, the running variant; if that does not fit, the fitting candidate with the lowest J. The person can click any column's head to make it the datum.
- **Round 2**: the matrix again with round 1's winner as datum (Pugh's controlled convergence). It confirms the winner (nothing scores above 0) or shows where another candidate beats it. The tab shows round 2 when it changes the order, else a line "round 2 against Sliding mode (boundary layer): nothing beats it".
- **Ranking**: fitting candidates by weighted total, ties by J. **The recommendation** is the top one, with the + rows that carried it and its worst − row in words, and the runner-up when within 2 points ("PID + feedforward (+2) and the PID (0) are close; the feedforward settles faster and holds up better on the varied plants, at the price of more wear and a model").
- **Interpretation**: Pugh warned against summing the marks. The total is shown because the person asked to "select the best option"; the marks and the numbers stay under it, the + / − counts beside it, and the recommendation names the reasons, so the person decides (research §1).

### 2.7 What comes out
- **Variants**: the winner is added to the block as "<type> · benchmark", not running (flip it in the Controller tab); with **Add all** every fitting candidate is added. One undo step. Interpretation: the benchmark compares structures; switching the running controller stays the person's act, unlike an Auto-tune result that beats the running variant.
- **The report** (`benchmarkReport(result, { format: 'html' | 'md' })`), one self-contained file:
  1. the bottom line: the recommendation in two sentences;
  2. the plant (system name, diagram or identified model and its fit), the goal, the experiment, the variation and the date;
  3. the matrix, both rounds, with the weights;
  4. the numbers table (every criterion, PM, GM, delay margin);
  5. the runs: r, y and u of every fitting candidate overlaid, nominal and the worst varied plant (inline SVG in HTML; in Markdown a CSV block per run, or omitted with `--no-runs`);
  6. per candidate: how it was tuned, its gains, why it does or does not fit;
  7. the refusals with their sentences;
  8. what was not judged (switching laws' margins, the task of a swing-up).
  It leaves through the page's one download path (Export menu, [decisions.md](decisions.md) v2.9) and carries no provenance (input 10).

## 3. In the page
- Auto-tune, mode switch **This variant | Every type**. In Every type: Setup (block; plant source, shared with the tab; goal; variation ±15 %, plants 8; Ms bound 2; Start/Stop) and Matrix.
- **While running**: columns appear in registry order as candidates finish; the current one's runs sweep the display at the Speed (at ∞ the display stands still and the matrix fills as fast as it computes, as Auto-tune does). Stop keeps what is finished and ranks it.
- **After**: weights and datum change the matrix at once (pure recomputation from the stored scores, no runs). Clicking a column shows that candidate's nominal run on the scope, its varied runs faded behind; Details lists its numbers.
- `window.loopTuner.benchmark({ block, plant, weights, datum, sweep, vary, msMax, include, apply })` returns a Promise of the result (the CLI's `--json`); `loopTuner.benchmarkReport(format)` returns the last report's text. Documented in Help (For agents) and AGENTS.md.

## 4. CLI and MCP
- `node cli.mjs benchmark <project> [--block ctrl] [--plant diagram|identified] [--datum pid|running|<type>] [--weights track=3,dist=3,…] [--include pid,slidingMode] [--vary 0.15] [--sweep 8] [--ms-max 2] [--iterations 60] [--report out.html|out.md] [--save] [--json]`: the same core, the same numbers as the tab; prints the matrix and the recommendation; `--save` adds the winner as a variant.
- **MCP tool `benchmark`** (on feat/mcp's server, beside `autotune` and `analyze`; snake case like its siblings): arguments `project`, `block`, `plant`, `weights`, `datum`, `include`, `vary`, `sweep`, `msMax`, `report` (`'md' | 'html' | null`), `apply`. It sends progress notifications per candidate (as `autotune` does with its progress token), returns the result JSON (`structuredContent`: candidates, refusals, scores, both rounds, ranking, recommendation) and, as text, the matrix in Markdown so an agent can show it as it is. A refusal (no Controller block, an External plant without a model) is a tool error with the core's sentence. When the server hosts the page (agentic mode), the tool runs in the page, so the person watches the matrix fill.

## 5. Core API

```js
// src/core/benchmark.js (no DOM; Node, the Worker, the page)
export const CRITERIA                        // [{ key, label, dir, tol, abs, weight, unit, from: 'run'|'linear'|'sweep'|'noise'|'registry' }]
export function candidates(project, path)    // → { facts: c, list: [{ type, name, start, how, tune }], refused: [{ type, label, why }] }
export function* benchmarkSteps(project, path, opts)  // yields { partial, phase, candidate, run, seconds } per run; returns BenchResult
export const benchmark = (project, path, opts) => drain(benchmarkSteps(project, path, opts))
export function scoreRun(run, key, ctx, scales, variant)   // → the run criteria (pure)
export function gates(row, opts)             // → '' | why not
export function pugh(rows, datum, weights)   // → [{ type, marks, plus, minus, total }] (pure: re-run on a weight change)
export function rank(rows, weights, datum)   // → { round1, round2, ranking, recommendation: { type, sentence, runnerUp } }
export function benchmarkReport(result, { format })  // → string
// BenchResult = { version, plant: { source, label, fit? }, goal, opts, facts, refused, rows: [{ type, name, how,
//   variant, start, evals, scores: { track, dist, … }, margins: { ms, pm, gm, dm, marginal }, fits, whyNot, runs? }],
//   round1, round2, ranking, recommendation, ms }
```
- `autotune.js` gains `goal.msMax` (Iterate's penalty) and exports what the benchmark reuses (`iterate`, the step test, `runCost`, `costScales`, `unstableAtStart`).
- `controllers.js` gains the optional `bench` hook per type (§2.2); `identify.js` provides `varyDiagram` and `twinDiagram` (designed there).
- `diagram.js` or a small helper gains `spliceNoise(diagram, path, sigmas)` and `probeMeasurements(diagram, path)` (the prototype's `withNoise` and the Sink probes).

## 6. Tests
- **Registry-driven**: a fake type registered in a test library takes part with no change to `benchmark.js`; one with `applies` returning a sentence is listed as refused with it; one without a hook is computed or iterated from its defaults (the GENERIC path).
- **Refusals are the designs' sentences**: the oven lists LQR's "needs every state measured … thermocouple but not heater and chamber", the motor *PI from the plant*'s "integrates V".
- **Pugh, pure**: hand-made rows give known marks, totals and tolerances; a weight of 0 removes a row; changing the datum or weights changes the matrix without any run (a counting fake of `simulateSystem` stays at 0 calls).
- **Gates**: a diverging candidate, one unstable at the start (the tank's PID), one fragile (Ms above the bound), one marginal (the encoder's speed loop, which passes).
- **Fairness**: every candidate's runs use the same goal and scales (asserted on the cost's inputs); the budget cap holds.
- **Determinism**: two runs give the same result bit for bit (seeded variation and noise).
- **The three systems** once, slow-marked or on shared fixtures (the overhaul's "expensive once"): the motor's winner is the boundary-layer sliding mode; the oven's three PI types are S against each other; on the tank no single PID fits. Other tests use a recorded BenchResult.
- **Report**: HTML is self-contained (no external URL, no provenance; the provenance test's rules) and Markdown has the matrix table; both name every refused type.
- **CLI and MCP**: `benchmark --json` equals the core's result; the MCP tool's schema refuses unknown arguments and returns the core's sentences.

## 7. The prototype's matrices

`node tools/benchmark-prototype.mjs` on main's controller types, Iterate 60, 8 varied plants, the prototype's Ms bound 3 with back-off. Full output with every number: [../research/benchmark-prototype.md](../research/benchmark-prototype.md). Below, round 1 (datum in bold), the + / − counts and weighted totals.

**DC motor, sliding mode** (Ts 1 ms; measures angle and speed; datum **PID**):

| Criterion (weight) | Loaded: Relay (theory) | **PID** | Gain-sched. PI | PID + FF | Relay | SMC ideal | SMC layer | Super-twisting |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Following r (3) | − | D | − | S | − | S | S | S |
| Rejecting d (3) | + | D | − | S | − | + | + | + |
| Overshoot (2) | S | D | − | S | − | S | S | − |
| Settling (1) | − | D | − | S | − | + | + | S |
| Effort (1) | − | D | + | S | − | − | S | S |
| Wear (2) | − | D | + | S | − | − | S | − |
| Time at a limit (1) | − | D | + | S | − | − | S | + |
| Ms (2) | ? | D | + | S | ? | ? | + | ? |
| Plant ±15 % (3) | − | D | − | − | − | − | S | − |
| Noise → u (2) | − | D | + | S | − | − | + | + |
| Complexity (1) | S | D | − | − | + | S | − | − |
| Tuning runs (1) | + | D | S | + | + | + | + | S |
| **+ / −** | 2 / 7 | datum | 5 / 6 | 1 / 2 | 2 / 9 | 3 / 5 | **5 / 1** | 3 / 4 |
| **Weighted** | −9 | 0 | −5 | −3 | −16 | −4 | **+8** | −2 |

All fit. Refused: LQR and state feedback (the armature current is not measured), PI from the plant (the angle integrates), the three swing-ups. Round 2 against the boundary layer: nothing beats it (the ideal relay −5, the PID −8). The numbers behind it: the ideal relay rejects the load best (IAE 0.0012 against the PID's 0.015) but sits at a limit 95 % of the time and travels 86 ranges per second (wear; the loaded relay 120); the boundary layer keeps most of the rejection (0.013), wears like the PID (1.6 against 1.8) and has Ms 1.6 against the tuned PID's 2.1. That is input 10's "theoretical but hard on the actuator, and one that is more practical", measured.

**Oven, badly tuned** (dead time; datum **PID**; on its 10 s cycle since [inputs 50–52](../input/2026-10-25-52-a-spike-only-at-the-start.md), the test and then a ramp back down): PID ranks first (**+0**), the gain-scheduled PI is S on every performance row (−1: the oven is linear, so a schedule buys nothing but complexity), and PI from the plant holds up less well on the varied plants (−3: worst J 0.25 against 0.20). PID + feedforward from the plant (its prefilter searched to 0.39 s) settles faster (1.4 s against 1.7 s) and rejects d better, but the ramp back down costs it wear (0.46 against 0.36), time at a limit and its worst J on the varied plants (0.24 against 0.20): third at −2. On the 5 s input before, it ranked first at +2 (worst J 0.19 against 0.24, wear 0.79 against 0.55), and the PID tunes to 0.133 now (0.139 before). The loaded PID does not fit (unstable at r's middle: it lives in a limit cycle at the heater's limits); the relay fits and ranks last (−15: 54 % overshoot). Refused: LQR (only the thermocouple is measured), sliding modes (no ẏ), the swing-ups.

**Conical tank** (nonlinear; datum **the loaded schedule**, because the PID does not fit): the tuned PID scores best on following and rejection but is unstable where the tank starts (h = 0.15 m, 2 poles outside). *PI from the plant* at its searched Tcl (0.31 s) fits, slower on both (−7). The tuned schedule fit only after backing off to ¼ of the way (Ms 13 → 2.5) and ends level with the loaded one (−3: same performance, more tuning runs). Ranking: the loaded schedule, the tuned schedule, PI from the plant, the relay. Measured since the tank's drop back at 4.5 s (inputs 50–52), whose drain every candidate pays alike; before it PI from the plant backed off to its start (−11), and the schedule from Ms 12. Refused: LQR, state feedback and the feedforward (the tank has a kink at empty, where they linearise), sliding modes (no ẏ).

## 8. Cost

Measured with the prototype in this container (Node 22, one core), the full benchmark (starts, tuning, scoring, the 8-plant sweep):

| System | One run | Benchmark | Mostly |
|---|---|---|---|
| Oven, badly tuned | 5.7 ms | 1.2 s | tuning 0.8 s (its 5 s run, before inputs 50–52; the 10 s cycle since then not timed again here) |
| Conical tank | 5.5 ms | 1.8 s | tuning 1.1 s |
| DC motor, position control | 5.2 ms | 1.2 s | |
| Following a sine | 4.6 ms | 1.2 s | |
| Pendulum swing-up | 6.4 ms | 3.9 s | the sweep 1.8 s |
| DC motor with an unbalanced arm | 14 ms | 5.0 s | |
| DC motor, speed from an encoder | 24 ms | 4.2 s | |
| Encoder errors and torque ripple | 35 ms | 7.5 s | |
| Triple pendulum | 5.8 ms | 8.4 s | its plan (1.4 s) and the planned type's design |
| **DC motor, sliding mode** | **38 ms** | **21.5 s** | tuning 17.6 s (5 candidates iterated at Ts 1 ms) |
| Mass–spring–damper | | refused: no Controller block | |
| HIL systems | | refused until Identify; then on the twin, like the oven | |

A benchmark is about 200–600 runs (the triple pendulum 1400): roughly 100 per tuned candidate, 2 + 8 per scored one. **It costs about one Auto-tune Iterate run per candidate**, plus 10 runs each to score.

**Keeping the page responsive.**
- **A Worker**, as Live and the HIL loop already use one made from the page's own script ([decisions.md](decisions.md), Live): `benchmarkSteps` is a generator that yields after every run, so the Worker posts each finished candidate (its scores, its nominal run decimated to the screen's points) and the page fills the matrix. The page never computes a run itself. Where Workers are blocked (the limited environment), the same generator runs in **slices of about 30 ms** on the main thread, as Auto-tune does today.
- **Several Workers**: the candidates are independent once the PID row exists (only the feedforward and the scheduled PI start from another row). With `navigator.hardwareConcurrency − 1` Workers (at most 4), the sliding-mode motor's 21 s becomes about 6–8 s; a library plant stays under 1 s. Results are merged in registry order, so the outcome does not depend on which Worker finishes first.
- **At a finite Speed** the display shows the current candidate's runs sweeping, while the Workers compute ahead (Auto-tune's pacing); at ∞ nothing waits on the display.
- **Feedback within a second**: the candidate list and the refusals come from the registry and the designs before the first run (about 50 ms); the matrix grows from there. A progress line counts candidates and estimates the rest from the runs so far.
- **Budgets**: one per candidate (Iterate's 60 iterations) and one for the whole (default 2 minutes of computing; the person sees "stopped at the budget: 6 of 8 tuned" and the matrix of what is done).

## 9. Implementation steps (after the overhaul, in order)
1. **Iterate with an Ms bound** (`goal.msMax`, a penalty on the linear loop at r's middle; Auto-tune gains the setting too). Tests: the tank's schedule stays under the bound; the library's Auto-tune results unchanged where they already meet it.
2. **`varyDiagram`** (from Identify's step list, if Identify has not built it yet) and **`spliceNoise` / `probeMeasurements`**.
3. **The `bench` hook** on each type of main, and the GENERIC path; `candidates()`. Tests: registry-driven, refusals.
4. **`benchmark.js`**: tuning, scoring, gates, `pugh`, `rank`, deterministic. Tests §6.
5. **CLI `benchmark`** and its `--json`; then the **MCP tool** on the server (if merged by then).
6. **The report**, HTML and Markdown, through the Export path.
7. **The page**: Auto-tune's mode switch, Setup and Matrix, the Worker (and several), weights and datum live, Add the winner; `loopTuner.benchmark`. Help and AGENTS.md.
8. **On the identified model**: the plant selector and HIL's refusal without a model; the recommendation into Try on the plant.

Each step keeps the library's fingerprints and the tests green (the overhaul's gate).

## 10. Not built, and the limits found
- **Tasks other than following r.** On the pendulum the benchmark ranked a PID that holds the cart while the pole hangs first, and on the triple pendulum nothing fit: the shared cost cannot see that a swing-up must bring the pole up (the autotune research's "per-variant goals"). **A system may declare its task** (a library entry's `bench.task`: a Sink and a band, "θ within 0.2 rad of 0 from 3 s on"), which joins the gates and the criteria; and its **operating point** for the linear loop (the pendulums' upright rest). Until then the benchmark says, on a system with swing-up types, that it judges following r only.
- **Rewiring for a candidate** (an observer for ẏ, a sensor for the full state): listed as what a refused type would need, not done (§2.2).
- **Hybrids** (Pugh's step 5: combine two concepts, a PID with a sliding-mode outer loop): the person's.
- **Several Controller blocks** (cascades, the PUMA's joints): one block at a time, the others as they are; the PUMA's six joints would each be a benchmark.
- **Real runs on HIL**: the benchmark runs on the identified model; only the chosen controller goes to the plant (Try on the plant).
- **Statistical confidence**: 8 plants give a worst case, not a probability; more plants are an option (`--sweep`), at proportional cost.

## 11. Interpretations for the decision log
- A **mode of Auto-tune** (This variant | Every type), not a seventh tab: the person said "benchmark mode", and it shares the goal, the block, the results and the pacing.
- **Candidates are every registered type**, each declaring in its own entry whether and how it takes part (`bench`); a type without the hook takes part from its defaults. Types that need measurements the block lacks are refused with what they need; **the plant is not rewired**.
- **Fairness**: one goal, one experiment, one budget, one robustness bound; each candidate from its best start (a rule or its design), then searched. **Designed types stay designed**: only their speed input is searched.
- **Gates before marks**: diverging, unstable at r's middle or where the run starts, Ms above **2**, or diverging on a ±15 % plant means "does not fit", with the reason; not a −.
- **Datum**: the tuned PID; else the running variant; else the best fitting J. **Two rounds**, the second against the winner.
- **Weighted totals are shown** with the marks, the counts and the numbers, though Pugh warned against summing; the recommendation names its reasons.
- **The winner is added, not run**: switching the controller stays the person's act.
- **The linear loop at r's middle** for the margins; the start is checked for stability only.
- **Default weights** 3 (following, rejection, plant change), 2 (overshoot, wear, Ms, noise), 1 (settling, effort, time at a limit, complexity, tuning runs); tolerances per criterion; ±15 % over 8 seeded plants; noise σ 0.5 % of each measurement's span.
- **MCP tool name `benchmark`**.

## 12. Open questions for the person
1. **Weights**: are following, rejection and the ±15 % plant change the right three to count most? Wear at 2, complexity at 1?
2. **The datum**: the tuned PID (as the roadmap says), or the controller you have running now?
3. **The winner**: added but not running (as designed), or switched on when it beats the running variant (as Auto-tune does)?
4. **Rewiring**: should the benchmark offer "Sliding mode would apply with a Finite difference observer on input 3" as a candidate that changes the plant, or only say so?
5. **Swing-up systems**: is it enough to say the benchmark judges following r there, until a system can declare its task?
