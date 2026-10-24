# Designs computed in the page

Reader: whoever builds or changes a designed controller or observer, the plant model a design sees, the swing-up planner, or the Analysis tab. This is the decided architecture, condensed; the full plan, with the reasons, cost figures and test list, is [designs-in-the-page.md](designs-in-the-page.md). Where the code and this page differ, the code wins and this page is fixed.

**Nothing plant-specific computed offline is stored.** The project file, `plants.js` and the HTML hold design inputs only: weights, times, levels, limits, names, physics parameters, and gains a person chose by hand. Every gain, table, trim value, model and plan is computed in the page from the plant as it is wired, by code that ships in the bundle; Node runs the same code. (The person, [input 09](../input/2026-10-24-09-analysis-autotune-triple-swingup.md): "It should be computable in principle … the optimizer, it should be part of the package that we deliver, not something that you bake in.") The rules and interpretations are in [decisions.md](decisions.md), v2.7.

## Modules

| Module | Role |
|---|---|
| `core/diagram.js` | The compiler. In `model` mode it gives the plant a block sees (`el.seen`); in a normal compile it makes the laws once every node exists, observers first, and asks the design store for the values of each running designed variant (`el.designs`: their statuses) |
| `core/linearize.js` | `DesignError` (code, sentence, hint); operating points (`parseOp`, `opLabel`, `operatingPoint`), `trim`, `linearize`, `firstOrderFit`, on a Model. Pure numerics |
| `core/planner.js` | The swing-up plan (`planTransfer`, a generator), the step map's Jacobians along it (`alongPlan`), TV-LQR gains (`tvlqrGains`), the plan in measurement order (`planValues`), the law that follows it (`planLaw`) and the closed-loop check (`verifyLoop`). Imports linalg only |
| `core/design.js` | Keys (`canonical`, `hashKey`, `plantKey`), the memory-only design store (`createDesignStore`, `SYNC_DESIGNS`, heavy entries for plans), `lqrDesign`, `piCancel`, `scheduledPIDesign` and `trajectoryDesign`; the Kalman helper comes with its type |
| `core/controllers.js`, `core/observers.js` | Hand types unchanged; designed types `lqr`, `swingUpLqr`, `scheduledPI`, `trajectory`, `kalman` |

`design.js` never imports `diagram.js`: the diagram hands the store a closure that compiles the model (from a copy of the diagram, since the store keeps it). `DesignError` lives in `linearize.js`, the lowest module that raises one, because the bundle cannot re-export a name; `design.js`, the types and tests import it from there. Bundle order: `… goal, linearize, planner, design, controllers, observers, diagram …`.

## The plant a block sees

The map from a **cut** signal u to the block's **measurements**, evaluated by the same compiled `eval` as the simulation.

- **Cut**: a Controller's own output; for an Observer, the node wired into its input 1 (u), whose value is replaced by u.
- **Measurements**: what feeds the block's inputs 2…, in port order, labelled as the Controller tab shows them (`blockInputNames`).
- **Other Controllers** hold their output (0, or `at.held`). A cascade's inner loop is designed open, and the Model says so.
- **Observers**: a Kalman observer is looked through (estimate k reads the true state it stands for, `at.seeThrough`); any other observer's estimates are held, with a warning.
- **Sources** read 0 (the nominal plant is undisturbed), or `at.sources[name]`.

### Model mode (`compileDiagram(d, 'plant', { mode: 'model' })`)

| Block | In model mode |
|---|---|
| Dead time, transfer function with delay | Pass straight through; each measurement reports the dead time on its way from u in `delay[k]`. If paths differ (a dead time in a loop or a parallel branch), only what every path has is reported, with a warning |
| Quantizer | Identity, with a note; its step goes into `sensors[k].q` when it sits between the plant and measurement k (several add as root-sum-square) |
| Noise | Adds 0, with a note; its σ goes into `sensors[k].std` likewise. Noise elsewhere (on a torque, say) is process noise: the note only |
| Saturation, Function, Switch | As in the simulation, so finite differences see their slope; `atLimits(x, u)` names a saturation outside its limits |
| Controller, Observer | No laws are built; outputs come from the cut, `held`, or the look-through |
| Source | `at.sources[name] ?? 0` |

When u reaches none of the measurements the Model says so, naming a held Controller in between. Errors (`no-block`, `no-cut` for an Observer with nothing on its u input, `bad-state`) carry `code` and `hint`, for `DesignError` to take over.

`opts.laws === false` is separate: the normal compile with every sampled block at u = 0 and no designs. The Plant tab's structure check uses it, so editing the canvas never designs.

### States and the Model

- **Global state order** is the compile's allocation order (diagram order, depth first through subsystems, then each block's own order), the same in both modes, so a simulation snapshot X fits a model directly. `el.states` lists every state with its label.
- **Physics blocks** declare `ode.states(p)` (cartPole `x, v, θ, ω`; pendulumCart `x, θ1…, v, ω1…`; conicalTank `h`) and `ode.make(p)`, which computes constants once and returns the allocation-free rate function the compile uses. The pendulum chain uses one sin and one cos per angle and solves its mass matrix by Cholesky (LDLᵀ).
- **A first-order transfer-function block** (integrator, first order) is realised with C = 1, so its state is its output: the state of "Motor/load" is the speed. Higher orders are labelled `name.x1…`.
- **Labels**: `subsystem/block.state` for states; measurements by what feeds the input.
- **Structural reduction**: the Model keeps the states that the cut reaches **and** that reach a measurement (a walk over the compiled nodes). The rest stay at the base state X0. Motor position: armature, load, angle; tank: h; carts: all.

`el.seen(idPath, at)` (idPath: subsystem ids and the block id, `'motor/ctrl'`) returns, memoised per `at` (up to 16 per compile):

```js
Model = {
  idPath, name, kind,             // the block; kind 'controller' | 'observer'
  n, m, X0, x0,                   // kept states, measurements, full base state, kept base state (hanging for the pendulums)
  input: { label },               // what u is called ('F' when a Sink records it)
  states:  [{ label, name, unit, angle, index }],   // index into the global state
  outputs: [{ label, angle }],    // angle when the measurement is exactly one angle state
  f(x, u, dx), y(x, u, out),      // allocation-free; f evaluates only the nodes the kept rates read, y those the measurements read too
  atLimits(x, u),                 // sentences for saturations outside their limits there
  delay: [s], sensors: [{ std, q }], bound, warnings: [],
}
at = { held?: { [idPath]: number | number[] }, sources?: { [name]: number }, X?: full state, t?, seeThrough?: Map(observerIdPath → global indices) }
```

## Operating points (`linearize.js`)

`operatingPoint(model, op, { umin, umax })` → `{ kind, x, u, y, drift, rest, label, warnings }` for:
- `'origin'`: x = 0, u = 0. `rest` is false (with a warning naming the fastest state) when max |f(0, 0)| > 1e-6; LQR then refuses (`not-at-rest`). The encoder example is such a plant: its encoder error is not 0 at angle 0.
- `'initial'`: the model's start state, with the u that comes closest to holding it (scalar Gauss–Newton). For the tank this is its PI's u0, a√(2g·0.15) = 0.1716, computed.
- `{ y: [...] }` (null leaves a measurement free): `trim`, a damped Gauss–Newton with minimum-norm steps over (kept x, u), so coordinates the levels leave free stay where they start (a cart moved to x = 0.3 keeps its pendulum hanging). It starts at the start state with the input that holds it, not at u = 0: from u = 0 the tank's first step lands on a negative pump flow, where the pump has no slope and the iteration is stuck. If the levels cannot be reached in one go it approaches them in eight stages. Iteration caps only. Refusals: `trim-failed` ("no equilibrium with x = 0.3 m, θ = 0.5 rad: …"), `u-limit` ("holding h = 0.98 m needs q = 0.438, above u max 0.3"). Limit: a saturation with no slope at the start (a valve shut below its lower limit) can hide an equilibrium.
- `{ t, u }`: a Model built at a snapshot of the run (step 12); drift reported; never in a variant.

Labels read `origin (all states 0, u = 0)`, `h = 0.45 m, q = 0.297`, `t = 2.10 s of the run`; a measurement that is exactly one state carries its unit (`Model.outputs[k].unit`). `linearize(model, op)` by central differences (step 1e-6·max(1, |v|)) gives `{ A, B, C, D, n, m, states, outputs, input, op, delay, sensors, warnings }`, matrices as arrays of rows (B n×1, D m×1). `firstOrderFit(lin, k)` keeps only the states on the path from u to measurement k and gives K = D − C A⁻¹ B, τ = C A⁻² B / K, θ = delay; refusals `integrating-plant` ("angle integrates V"), `zero-gain`, `no-path`. At a kink exactly on the operating point (the tank's wall ends at h = H = 1) the slope is accurate to about 10⁻⁶ only (the tank's Ki at 1 m is off by 9·10⁻⁷; elsewhere 10⁻¹⁰). Variants take no operating points in v1: LQR and Kalman at the origin, the tank PI at trim points of the level.

## The swing-up plan (`planner.js`)

`planTransfer(model, { T, Ts, segments = 12, nodesPerSegment = 4, Fmax })` finds the force that takes a Model from its start state `x0` to rest at the origin, angle states compared modulo 2π. It uses nothing but `model.f`, so it plans whatever plant the block sees.

- **The sample grid.** `perSegment` = max(4, round(T / (Ts·segments))) samples per segment, and T is snapped to it (2.4 s = 12 segments × 20 samples × 10 ms). The force is the piecewise-linear interpolation of `nodesPerSegment` nodes per segment, **read at each sample instant and held over the sample**: exactly what the Controller applies. RK4 with `sub` = ⌈Ts / min(5 ms, 0.5 / bound)⌉ substeps (2 at 10 ms).
- **Unknowns**: the nodes and the states at the starts of segments 1 … M−1 (multiple shooting; 137 for the triple pendulum). **Residuals**: the defects between segments and the miss at the end (angles wrapped), both weighted by the stage; the effort λ·F and the change between neighbouring nodes λ·(F_k+1 − F_k); a hinge 3·max(0, |F| − Fmax). Without the change term the last stage settles on a spiky force, often at the limit (28 N steps of 9 N per sample for the triple pendulum); with it the plan is smooth and needs about half the force (15.5 N, steps of 3 N), leaving the feedback room.
- **Levenberg–Marquardt** on JᵀJ accumulated from per-segment blocks: a segment's end depends only on its start and its own five nodes, so a Jacobian costs 13 one-segment integrations per segment (forward differences, one entry perturbed in place). JᵀJ (137²) and its Cholesky factor are preallocated; nothing is allocated in the loops.
- **Continuation stages** (λ, weight, cap): (3·10⁻³, 1, 120), (10⁻³, 10, 80), (3·10⁻⁴, 100, 80). A stage ends when the plan is feasible (defect < 10⁻⁶, end < 10⁻³) or stalls (cost down less than 0.1 % over 4 accepted iterations); what it leaves of its cap goes to the next stage. 300 iterations over all starts.
- **Three fixed starts**, tried in order until one is ok: the states on a straight line from x0 to the origin (angles the short way), the force a·sin(kπt/T) with k = 3, 2, 4. a = ½·min(Fmax, 2·D·(2π/T)²/b), D the largest distance to go and b the smallest nonzero input gain at x0: 15 N for the triple pendulum. No randomness, no clock: the same inputs give the same plan, bit for bit.
- **ok** when the defect is below 10⁻⁴, every angle and position ends within 0.02 (rad, m) and every rate (a unit per second) within 0.5, and the peak force is at most 1.05·Fmax. Otherwise `plan-not-converged`, with a sentence and a hint from the numbers ("no plan found within the limit: it needs F up to 10.5, of the 2 it may use (300 iterations, 1 start)" · "needs more force or a longer T (now 2.4 s)"; "the segments do not join" · "more segments or a longer T"). The best attempt is returned all the same, so it can run and be seen.
- **Ticks**: `yield null` after each segment's Jacobian columns, after each solve and each trial step, and per segment while a stage's first cost is computed (the first run is cold); one progress object `{ stage, stages, iteration, cost, defect, terminal, fraction, start, starts }` per iteration.
- **Measured** (Node, on a loaded 4-core machine): the default triple pendulum plans in about 3 s alone (5.5 s while the other test files run), 204 iterations from the first start, peak 15.5 N of the 30 N it may use; Chromium takes 4.5–4.8 s on the same machine, the same plan bit for bit. The longest slice between yields is 3–14 ms of CPU once the code is warm (the cold first run also counts V8 compiling it), the median 0.9 ms. The robustness matrix (`npm run test:slow`: T = 1.8 s and 3 s, masses ×2, rods ×1.6, a 4 N push mid-swing, rod masses 10 % lighter or heavier than planned for) plans from the first start and holds in every case, in 156–225 iterations.

Along the plan: `alongPlan(model, plan)` (and `alongPlanSteps`, a generator that ticks per segment) integrates each segment from its shooting start (never one long open-loop replay) and takes Ad_k, Bd_k as central differences of the one-sample step map (the force held, the same RK4), so no c2d. `tvlqrGains(along, { Q, R, Pend })` runs the discrete Riccati recursion backwards from the upright LQR's P, symmetrising P each step. `planValues` gives the measurements along the plan Y_k = y(x*_k) and the gains in measurement order K_k = Kx_k C⁻¹. `planLaw(values, Ts, { start, umin, umax })` is the law (u = 0 until `start`, u = F_k − K_k (y − Y_k) along the plan with angle errors wrapped, then u = kr r − Kup y), and `verifyLoop(model, law, { Ts, sub, duration, umin, umax, d })` runs the nonlinear closed loop and says whether every state ends within reach of the origin (angles 0.05 rad, rates 0.5, other states 0.25), with the worst state, the peak force asked for and the cart's largest excursion.

Where this differs from the plan (§8.3): the end is weighted like the defects (with weight 1 the effort term held it about 0.01 off and the plan never became feasible); a smoothness term (above); unused stage budget carries over (masses ×2 needs about 130 iterations in the last stage); the hinge keeps one weight (one that grows with the stages, or a tanh bound on the force, made the plans worse); the starting amplitude is generic (a Model knows no total mass or g); the law and the mapping to measurements live in `planner.js`, beside the plan they follow. The default plan takes about 3 s in Node, not the 2.5 s targeted.

### The `trajectory` type (step 9)

`trajectoryDesign(p, ctx)` in design.js; inputs T (2.4 s), segments (12), planShare (0.75), start (0 s), Q, R, limits. The first three are flagged `heavy, tune: false` and sit in the Controller tab's Plan fold.
1. The upright LQR at the origin by `lqrDesign` (so it refuses what LQR refuses: every state must be measured), x following r. Refuses `bad-limits` unless u min < 0 < u max.
2. The plan: `ctx.heavy('plan', { version, T, segments, Fmax }, generator)`, Fmax = planShare · min(−u min, u max). The generator runs `planTransfer` then `alongPlanSteps` (`yield*`), so the along-plan data is kept with the plan. The heavy entry is keyed by these, the plant, the block and Ts, never by Q, R, start or a limit that leaves Fmax alone: tuning those re-runs steps 3–5 in about 50 ms (TV-LQR, the mapping, the check), never the plan. The sync store (Node, the CLI) drains the generator at once; the page's store runs it in the background (below). Either keeps 8 plans (LRU); `stats().heavyRuns` counts plans.
3. TV-LQR with Qx = Cᵀ diag(Q) C ending in the upright P, then `planValues`.
4. `verifyLoop` on the nonlinear plant, with the limits, until 1 s after the plan.
5. Rows: a sentence ("Planned in 4.5 s (204 iterations, start 1 of 3). Verified: upright 1 s after T, peak F 15.49 of 40."), T and its grid, F(t) as a sparkline (≤ 120 points), the end error per state, the defect, the upright K, kr and slowest pole. The status's `at` reads "θ1, θ2, θ3 = 3.142 rad → origin". A plan that did not converge, or a loop that does not hold, gives status `warn` with the planner's sentence and hint (or "the loop does not hold: θ2 is 0.4 rad off 1 s after the plan; peak F 77 with a 40 limit: lengthen T or raise the limit"), and still runs.

The law (`make`) is `planLaw(values, Ts, p)`: u = 0 until `start`, then the plan with TV-LQR, then the upright LQR, angles modulo 2π, clamped. values: F (per sample), Y and K (per sample and measurement), Kup, kr, angle flags; they never reach a file (`computes` refuses F, Y, K, Kup and kr: "they are never kept in a file"), and there is no Copy as numbers. In the Computed box a row with `spark` draws a sparkline and a row with `sentence` reads in the UI font; long design times show in seconds.

`node cli.mjs design <project> [--block <path>] [--json]` prints the same statuses, synchronously; `node cli.mjs new --system <name>` writes a System library entry as a project, and `node cli.mjs systems` lists them.

## Designed variants

A designed type adds `designed: true`, `version`, `computes` (keys refused in a file: "lqr computes K and kr from the plant and Q, R and track; to set them by hand use Copy as numbers (a State feedback variant)"), `twin` (the hand type Copy as numbers makes), `design(p, ctx)` (pure, synchronous; throws `DesignError`; may return pending once the page store is async), `make(p, Ts, values)` (values null → u = 0), `manual(p, values)` (Copy as numbers) and, for the page, `compatible(a, b)`. `makeLaw(variant, Ts, lib, values)`. Parameters may be `nullable` (vectors too: null means "from the plant"), `int`, `positive`, take a `min` and a `max`, and may be flagged `heavy` (it starts a plan) and `tune: false` (auto-tune leaves it alone). A type without a hand twin (`trajectory`) refuses its computed keys with "they are never kept in a file". `ctx` = `{ Ts, idPath, name, kind, inputs, model(), linearize(op, limits), trim(targets, limits), heavy(kind, inputs, start) }`; `heavy` keeps the value of a generator (a plan) under its own key and returns `{ status: 'ready', value, ms }`. A design may return its own `at` (the operating points, for the status) when one label does not say it. A designed law runs as its Copy as numbers twin would (`make` builds the twin's law from `manual(p, values)`), so the copy runs bit for bit alike. A vector parameter's `per` (`'measurement'`, `'level'`) lets the Controller tab name its entries.

| Type | Inputs | Computes |
|---|---|---|
| `lqr` (built) | Q (one per measurement, or one for all), R, track (the measurement r applies to; 0 none), Tr, limits | Discrete LQR at the origin: K = Kx C⁻¹ in measurement order, kr (static gain 1 from r to the tracked measurement; equals K[0] for the carts), the slowest pole. Refuses `states-not-measured` (naming what is missing: "sees x, θ, v but not ω (cart and pole)"), `q-length`, `not-at-rest`, `not-stabilisable`, `no-states`, `too-many-states`. Reproduces the gains the library held (K_SINGLE, K_TRIPLE, K_TRIPLE_GENTLE) to the digits they were stored with (within 0.02 %) |
| `swingUpLqr` (built) | the hand energy-pump gains (kE, kx, kv, l, g, θs), Q, R, limits | The catch gains K, kr by `lqrDesign` at the origin (the upright rest), x following r. Refuses `swing-inputs` unless the block measures four signals with an angle second (the law reads x, θ, v, ω). Copy as numbers: `swingUp` |
| `scheduledPI` (built) | levels `at` of the first measurement (one level: a fixed PI), Tcl, Tr, limits | At each level: `trim` → `linearize` → `firstOrderFit` → `piCancel`: Kp = τ/(K·Tcl), Ki = 1/(K·Tcl). u0: the input that holds the first measurement where the plant starts (a `trim` at y1(x0)), so the loop starts in exact balance. The dead time θ is shown and left out, with a warning. The status's `at` reads "h = 0.1 … 1 m (5 levels)"; a `gains` row is a table (level, trim u, K, τ, θ, Kp, Ki). Refusals come from trim and the fit (`u-limit`, `trim-failed`, `integrating-plant`). Copy as numbers: `pid` (one level) or `gainScheduled` |
| `trajectory` (built) | T, segments, planShare (the Plan fold), start, Q, R, limits | The swing-up plan (force held per Ts, a heavy entry keyed without Q and R), TV-LQR along it, the upright LQR, a verify run (above). No Copy as numbers |
| `kalman` (observer) | Q, R (empty: from the sensor blocks) | L by the discrete Riccati equation; the states each estimate stands for |

The store (`createDesignStore`) caches in memory only (64 designs, 8 model compiles, LRU), keyed by the type, its version, the variant's inputs, Ts, the plant (`plantKey`: without places, flips, Sinks' names or the variants of Controller blocks; Observers whole) and the block's id path. Failed designs are cached too: the same inputs fail the same way. compileDiagram calls `store.begin(diagram, compileModel)` once per compile (with Controllers and Observers running laws, designed or not), then `job.resolve(block, variant, lib)` per block, observers first: a designed observer's `values.stateIndex` lets a later Controller look through it. Each resolve gives a status `{ path, block, variant, type, key, status, ms, cached, at, seen, rows, warnings, error, progress }` whose `values` are not enumerable (a status prints and serialises without numbers). `seen` ("F → x, θ, v, ω · 4 states (x, v, θ, ω)") is built from the live labels, so renaming a Sink renames u without a re-design. `simulateSystem(…, { designs })` and `evaluateSystem(p, { designs })` take a store (default `SYNC_DESIGNS`) and return the statuses as `info.designs`; the page lists them with `window.loopTuner.designs()`. A cache hit costs about 0.2 ms per compile (the triple pendulum's key). The plan's key leaves out Q and R, so tuning Q re-runs only TV-LQR.

### In the page: the plan in the background (step 10)

`createDesignStore({ mode: 'async', debounceMs = 150 })` is the page's store; Node, the CLI and tests use the sync one. Results never depend on the mode: a job is the same generator the sync store drains, so the run after a plan made in slices equals the sync run bit for bit (test 11).
- **A heavy miss** queues one job per heavy key, and the design comes back pending (it is not cached). Its status is `pending` (no values: u = 0, an observer zero estimates), or `stale` when the block's slot (`idPath#variant name#type`) holds the values that ran last and they fit (the same number of measurements and Ts, or the type's `compatible(before, here)`): the previous plan keeps running, labelled. A status waiting on a job carries the job's `progress` (`{ stage, stages, iteration, cost, defect, terminal, fraction, start, starts }`).
- **Debounce**: a job starts 150 ms after it was first asked for, so wheeling a mass plans once. **Newest wins**: every compile with laws ends with `job.end()`, which drops the jobs that compile did not ask for (an edited plant, another variant, Off).
- `runJobs(budgetMs)` works on the oldest job for about budgetMs (the planner yields every few ms) → `{ busy, finished, waitMs }`. A finished job keeps its value as a heavy entry and bumps `generation`. `busy()`, `queue()`, `onProgress(fn)` (at most 10 times a second), `idle()` (a promise: nothing queued), `cancel(key)` and `retry(key)` (a status's key). A cancelled plan stays cancelled (u = 0, or the previous plan) until the block's inputs give a new key or `retry`; both bump `generation`.
- **The pump** (`app.js`): while the store is busy, a MessageChannel message per slice (setTimeout would clamp to 4 ms), a timer during a debounce wait. A slice lasts as long as the browser was away since the last one, 8 to 16 ms: on a quick screen the display keeps 60 frames a second; on a slow one (software rendering) the plan still gets about half the main thread and the sweep about 30.
- **The acquisition key** includes `generation`, so a settled job makes the next acquire compile again. **Settle** (the light path): `display.restartSweep()` keeps the run so far faded and starts the sweep at the window's start, the display takes the new run, the Computed box and the loopnote follow, and a toast says "Swing-up planned in 4.1 s" (the job's title from `ctx.heavy(…, { title })`). The Controller tab's inputs are not re-rendered: a field being typed in keeps its focus and text. An Auto Scale made while a design was pending (when a system loads) is made again on the new run, unless the scope was set by hand in between.
- **Progress** patches only the bar and line in the Computed box, the variant glyph ("⟳ 43 %") and the loopnote ("planning 43 %", "re-planning 43 %", "planning cancelled"), so the box's Cancel button stays put.
- `window.loopTuner.whenDesigned()` resolves, with the statuses, once nothing is queued and the display shows the run that uses the result.
- **Measured** in headless Chromium on this loaded 4-core machine: Node plans the triple pendulum in 4.8 s; the page in 7 to 22 s, depending on what else it draws (the sweeping display costs most of the main thread in software rendering: with the display stopped and the Controller tab open, about 7 s). No slice blocks a frame: in an 8.7 s plan the only long animation frames (> 50 ms) were loading the system and opening the tab. A tab click runs 0 to 4 ms of script, and the next frame follows within 7 to 28 ms.

**The Controller tab** (built in step 7):
- A read-only **Computed** box: an LCD readout beside the parameters when the column has room, below them when it has not (the plan said below; beside keeps K in view while Q is wheeled). It shows the status, the time or "cached", and the key (#682b37); the method and operating point; the plant seen; the values (gains labelled by measurement, a table for the PI at three digits, kr, poles, θ, u0); the warnings; for an error its message, hint and "Until then the block puts out u = 0". `controllerTab.renderComputed()` patches only this box and the variant glyphs, for designs that settle on their own; `renderProgress()` only a plan's progress. While a plan is made the box shows a progress bar with the stage, iteration, cost and defect, what runs meanwhile, and **Cancel**; once cancelled, **Plan**; for a stale status the previous plan's rows follow.
- **Copy as numbers** (for any type with `manual`) inserts "<name> (numbers)" after the variant and runs it; toast "Copied: these numbers no longer follow the plant." A field left untouched is not committed on blur, so its rounded display never replaces the copied full-precision numbers.
- **Variant glyphs**: "computed"; on the running variant "! no design" (red) or "! computed" (amber, a quality warning), "⟳ 43 %" while a plan is made, "cancelled".
- **Library** in two groups, From the plant and By hand (no type is filtered out).
- **Hints** name a vector's entries ("for x, θ1, θ2, θ3, v, ω1, ω2, ω3", "levels of h"); vector fields take the full width. A variant added from the library gets one Q weight per measurement.
- Inputs flagged `heavy` sit in a "Plan" fold, closed until opened (`trajectory`'s T, segments and planShare).
- **The wheel** nudges a number by 5 % and the design follows in the same event: on the triple pendulum one notch on Q re-designs (≈ 8 ms) and re-simulates in about 35 ms, so the next frame shows the new K and run. In a list it nudges the entry under the caret, and only while the field has the focus, so scrolling the column never changes a weight; the focus and the caret survive the re-render.
- **The loopnote** in the header names a block whose design failed ("controller · LQR: no design", "planning 43 %") and opens the Controller tab on it; "plant: see the Plant tab" opens the Plant tab.
- `node cli.mjs design <project>` prints the statuses (step 9); `window.loopTuner.whenDesigned()` waits for the page's plans (step 10).

## Steps and status

| Step | What | Status |
|---|---|---|
| 0 | This page, decisions v2.7 | Built |
| 1 | `ode.states`, `ode.make` for the physics blocks; `planner.js` in the bundle | Built |
| 2 | Model mode in `diagram.js`, `el.seen`, `laws: false`, n = 1 realisation, `blockInputNames` in core, nullable Dead time `y0` (the tank's pipe has none baked in) | Built |
| 3 | `linearize.js` | Built (tests 3, 4 in `test/linearize.test.mjs`) |
| 4 | `design.js`, the store (sync), the `lqr` type, designs resolved while compiling, `info.designs`, `loopTuner.designs()` | Built (tests 5, 7 without the plan, 8 for lqr, and the observer look-through, in `test/design.test.mjs`). The Controller tab lists LQR; its Computed box is step 7 |
| 5 | `swingUpLqr`, `scheduledPI` and their manual twins | Built (tests 6 and 8 in `test/design.test.mjs`) |
| 6 | `plants.js` migrated; K constants deleted; guard test | Built: the tank's three PIs are `scheduledPI`, the pendulum runs `swingUpLqr` and `lqr`, the triple pendulum stays upright on `lqr` until step 9; VARIANT_TAGS; guard test 12, behaviour test 13. With the computed u0 the tank starts in exact balance, so the PI tuned for full rests at 0.15 m until the step at 1.5 s (the baked 0.172 was 0.26 % off and kicked it at once); the behaviour test checks its ringing after the step |
| 7 | Controller tab: Computed box, glyphs, Copy as numbers, library groups | Built (above); browser-checked with Playwright |
| 8 | Planner rework | Built (above): test 9 in `test/planner.test.mjs`, the robustness matrix in `test/planner.slow.mjs` (`npm run test:slow`) |
| 9 | `trajectory`; the triple pendulum starts hanging; `cli.mjs design` | Built: the triple pendulum hangs at the start and runs "Planned swing-up + TV-LQR", "LQR only (cannot swing up)" and Off, the push moved to 3.5 s, no reference step. Tests 7 (the plan part), 10 (in the behaviour test of `test/core.test.mjs`) and 15 in `test/design.test.mjs`. |
| 10 | Async store and pump in the page | Built (above): test 11 in `test/async.test.mjs`; browser-checked with Playwright (the triple pendulum loads hanging, shows the progress, swings up; re-planning, Cancel, Plan, undo; typing survives a settle) |
| 11 | Designed `kalman` with look-through | |
| 12 | Analysis hooks (snapshots, `linearizeBlock`) | |
| 13 | Docs sweep | |
