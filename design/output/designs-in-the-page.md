# Computing designs in the page

Reader: whoever implements the design layer (linearisation, designed controller and observer variants, the swing-up planner in the page) or the Analysis tab. It is the synthesis of a three-proposal, three-judge design panel run on 2026-10-24 after the person said nothing plant-specific may be baked in ([input](../input/2026-10-24-09-analysis-autotune-triple-swingup.md)). Where the code and this plan differ, the code and decisions.md win.

## 0. Summary and sources

The project file, `plants.js` and the HTML hold only design inputs: weights, times, levels, limits and names. Every gain, table, trim value, model and plan is computed in the page from the plant as it is wired, by code that ships in the bundle. Node runs the same code synchronously. The page runs the one heavy job, the triple-pendulum swing-up plan, in short time slices on the main thread.

The base is the **simple** proposal, which all three judges preferred. It contributes:
- designed variant types with `design(p, ctx)` and `make(p, Ts, values)`
- a `model` compile mode that reuses the one `eval`
- memory-only caches
- `y0: null` for the pipe
- a guard test

Grafts from the other proposals:
- **From general:** the plan holds the force per Ts. Its segments lie on the controller's sample grid, and time-varying LQR (TV-LQR) uses the discrete step map, so the plan is exactly what the law applies. Also: a nonlinear verify run with a sentence on failure, the Kalman R taken from the sensor blocks, a robustness test matrix, and testing the Riccati solver against known gains.
- **From ux:**
  - Rework the committed `src/core/planner.js` instead of writing a new planner.
  - Layered keys: the plan is keyed without Q and R; the gains are keyed with them.
  - The store is passed through `opts`, with a synchronous default.
  - Pumping uses MessageChannel, with debounce and newest-job-wins.
  - Progress patches only the Computed box; the sweep restarts when a plan settles.
  - Computed fields in a file are refused with a sentence.
  - The hand `swingUp` type stays, and a designed twin is added.
  - Up to three fixed starting guesses; no wall-clock stopping; `whenDesigned()`; a simple observer look-through.

Flaws from the verdicts, and how this plan fixes them:

| Flaw | Fix |
|---|---|
| Single pendulum Q | Q = [10, 50, 1, 1], which reproduces K_SINGLE exactly |
| First-order fit (ux) | τ = C A⁻² B / K (mean residence time), not −trace(A⁻¹) |
| Affine fast path (ux) | Not built. The planner calls the compiled model; speed comes from `ode.make` and slice evaluation |
| Planning step h = 0.02 (ux) | Not used. h ≤ 5 ms |
| Worker | Not built |
| Q/R edit forcing a re-plan (general) | The plan key leaves out Q and R |
| Separate evaluation loop (general) | Not built; one `eval` |
| Pipe y0 0.172 (general) | Replaced by `y0: null` |
| Manual copy of plans | Not offered |
| localStorage plan cache | Not built |
| PL force vs ZOH law (simple) | The force is held per Ts in the plan |
| swingUp K, kr lost silently (simple) | Hand type kept, designed twin `swingUpLqr` added |
| Hard 8 N guess (simple) | Guesses scale with the force limit; up to three starts |
| setTimeout clamp (simple) | MessageChannel |
| No look-through (simple) | A Kalman observer's estimate k counts as the true state k |
| Second planner file (simple) | The committed `planner.js` is reworked |
| Noise invisible to LQR (all three) | The report says so |

Checked against HEAD `f3a9895`:
- `planner.js`, `linalg.js` and `observers.js` are committed.
- `planner.js` is **not** in `build.mjs` MODULES.
- `tools/` does not exist.
- `controllers.js` has no `trajectory` type, and `ui/controller.js:136` filters `trajectory` out of the library.
- `ui/plant.js:333` compiles the diagram for validation, so it must not trigger designs.
- `systems.js` VARIANT_TAGS already names `lqr`, `trajectory` and `kalman`.

## 1. Rules (go into decisions.md)

1. **Inputs only, in the file and in the library.** A project, `plants.js` and the HTML hold design inputs (weights, times, levels, limits, names), physics parameters and hand gains a person chose (PID gains, energy swing-up gains).
   - Never stored: gains computed from the plant, tables, trim values (u0, a pipe's start flow), models, plans.
   - "Copy as numbers" is the person's explicit way to turn a design into hand numbers. It is offered for LQR, PI and Kalman only, never for plans.
2. **Same inputs, same numbers.** A computed number depends only on the diagram, the variant's parameters and Ts, and is computed by bundled code. Node and the page give the same numbers (the same JS engine, bit for bit).
   - No wall-clock stopping criteria; iteration caps only.
   - No warm starts across edits.
   - No randomness.
3. **Caches are memory-only and invisible.** Dropping one changes timing, never results.
4. **Laws know nothing of plants.** `make(p, Ts, values)` reads plain data. Only `design(p, ctx)` sees the plant, through `ctx`.
5. **A failed design never breaks the display.**
   - With no values, the block runs u = 0 (an observer: zero estimates).
   - The status carries `{ code, message, hint }`, naming states and measurements by their labels.

## 2. Modules and build order

```
MODULES = poly, linalg, scale, blocks, expr, signals, metrics, goal,
          linearize (new), planner (exists; add), design (new),
          controllers, observers, diagram, sim, plants, views, project, tune, examples, systems, spectrum, ui/…
```

| Module | Role | Imports |
|---|---|---|
| `core/linearize.js` (new) | Operating points, trim, linearise, first-order fit, on a `Model` object. Pure numerics | linalg |
| `core/planner.js` (rework) | Plan generator, along-plan linearisation, TV-LQR gains, verify run | linalg |
| `core/design.js` (new) | `DesignError`, key helpers, the design store, design helpers (lqr, PI by pole cancellation, kalman, trajectory) | linalg, linearize, planner |
| `core/controllers.js` | Hand types unchanged; designed types `lqr`, `swingUpLqr`, `scheduledPI`, `trajectory` | design |
| `core/observers.js` | `kalman` becomes designed; `luenberger` and `difference` stay hand types | linalg, design |
| `core/diagram.js` | `model` compile mode, `el.seen()`, id paths, deferred laws, design resolution | controllers, observers, design |

There are no cycles: `design.js` never imports `diagram.js`. The diagram gives the store a closure that builds the model.

## 3. Data flow

```
edit → app.changed() → acquire()            key += app.designs.generation
  → evaluateSystem(p, { designs: app.designs }) → simulateSystem(diagram, signals, sim, { designs })
    → compileDiagram(diagram, 'plant', { sources, standalone, designs })
        build nodes (sampled blocks: law = null) → order → state offsets
        job = designs.begin(diagram, () => compileDiagram(diagram, 'plant', { mode: 'model' }))
        for each Observer, then each Controller (running variant only):
          hand type  → law = make(p, Ts)
          designed   → st = job.resolve(block, variant, lib)   // cache hit, or def.design(p, ctx)
                       law = make(p, Ts, st.values)            // values null → u = 0
        el.designs = statuses
  ← info.designs  → Controller tab "Computed" box, variant glyphs, loopnote
page only: heavy miss → job queued → MessageChannel pump runs slices → progress (≤ 10 Hz) patches the box
           → done: generation++ → light re-acquire, sweep restarts, toast
```

## 4. The plant a block sees

### 4.1 Definition

The plant a block sees is the map from a **cut signal** u to the block's **measurement signals**. It is evaluated by the same compiled `eval` as the simulation, in `model` mode.

- **Cut.**
  - For a Controller: its own output node.
  - For an Observer: the node wired into its input 0 (u). In model mode that node's value is *replaced* by u after it is evaluated.
- **Measurements.** The nodes feeding the block's inputs 1…m (Controller inputs 2…, Observer inputs 2…), in port order.
- **Other Controllers** hold their output: 0 at a static operating point, their held value at a snapshot. A cascade's inner loop is designed open, and the report says so.
- **Observers.**
  - If a measurement comes from an Observer whose running variant is a designed `kalman`, its tap k reads the true state that estimate k stands for (separation principle; observers are designed first).
  - Any other observer's outputs are held, with the warning "estimates of 'obs' are held; the design does not look through a hand observer".
- **Sources** read 0 (the nominal plant is undisturbed), or their value at t for a snapshot.

### 4.2 `model` compile mode (in diagram.js; one eval, a few switch cases differ)

| Block | In model mode |
|---|---|
| Dead time, `tf` with `delay` | Pass straight through. Each measurement reports its series dead time in `delay[k]`. If paths to one measurement disagree, a warning says the dead time is inside a loop and left out |
| Quantizer | Identity. Its q goes into `sensors[k].q` |
| Noise | Adds 0. Its σ goes into `sensors[k].std` |
| Saturation, Function, Switch | Evaluated as in the simulation, so finite differences give their slope. A Saturation outside its limits at the operating point gives the warning "saturated at the operating point" |
| Controller, Observer | No laws are built (this breaks the recursion). Outputs come from the cut, `held`, or the look-through |
| Source | `at.sources[name] ?? 0` |

`opts.laws === false` is a separate switch: the normal compile with every sampled block at u = 0 and no designs. `ui/plant.js:333` uses it for structure checks, so editing the canvas never designs.

### 4.3 States, labels, reduction

- **Global state order** is the compile's allocation order: diagram block order, depth-first through subsystems, then each block's own order. This is unchanged, so a simulation snapshot X fits a model-mode compile directly.
- **Physics blocks gain `ode.states(p) → [{ name, unit, angle }]`:**
  - cartPole: `x, v, θ(angle), ω`
  - pendulumCart: `x, θ1…θn (angle), v, ω1…ωn`
  - conicalTank: `h`
- **Model blocks.** An n = 1 transfer-function block (integrator, first order) is realised with C = 1, so its state *is* its output: B ← B·C, C ← 1, one line in diagram.js. Its state label is the block's name ("Motor/load" is the speed). Higher orders are labelled `name.x1…`.
- **Labels** are `subsystem/block.state` for states. For measurements they are what feeds the input, as the Controller tab shows today; `blockInputNames(diagram, idPath)` moves from `ui/controller.js` into `diagram.js`.
- **Structural reduction.** The model keeps the states that are reachable from the cut **and** reach a measurement, found by a graph walk over node inputs and state dependencies. The rest stay at the operating point's full state.
  - Motor position: armature, load, angle (3).
  - Tank: h.
  - Carts: all 4 or 8.

### 4.4 The Model object (returned by `el.seen(idPath, at)` on a model-mode compile)

```js
Model = {
  n, m, X0,                       // kept-state count, measurement count, full initial state (Float64Array)
  x0,                             // kept initial state (hanging for the pendulums)
  states:  [{ label: 'cart and 3 rods.θ1', unit: 'rad', angle: true, index: 2 }],   // index = global X
  outputs: [{ label: 'θ1', angle: true }],          // angle when its C row picks one angle state
  f(x, u, dx), y(x, u, out),      // allocation-free; only the slice of nodes between cut, states and measurements
  delay: [0.1], sensors: [{ std: 0, q: 0 }], bound, warnings: [],
}
```

`at = { held?: { [idPath]: number | Float64Array }, sources?: { name: value }, X?: full state, seeThrough?: Map(observerIdPath → global indices) }`.

The model-mode compile is memoised by plantKey (LRU of 8 in the store). `seen()` per block is memoised by (idPath, canonical(at)).

## 5. Operating points and `linearize.js`

```js
export function parseOp(spec, where)       // 'origin' | 'initial' | { y: number | (number|null)[] } | { t: number } → Op
export function opLabel(op)                // 'upright rest' | 'h = 0.45 m' | 't = 2.10 s of the run'
export function operatingPoint(model, op, { umin = -Infinity, umax = Infinity } = {})
  // → { kind, x, u, y, drift, label, warnings }
  //   origin:  x = 0, u = 0; warns (and LQR/Kalman refuse, code 'not-at-rest') when |f(0, 0)| > 1e-6
  //   initial: x = model.x0, u = argmin |f(x0, u)| (scalar Gauss–Newton)
  //   {y}:     trim, below. Free entries are null
  //   {t}:     x and u from a snapshot (§12); not an equilibrium; |f| reported as drift
export function trim(model, targets, { umin, umax })
  // solve f(x, u) = 0 and y_k(x, u) = target_k over (kept x, u), damped Gauss–Newton with
  // minimum-norm steps (Δ = Jᵀ (J Jᵀ + λI)⁻¹ r) from (x0, 0), so free coordinates (cart position) stay put.
  // ≤ 50 iterations, deterministic. Throws DesignError 'trim-failed' ("no equilibrium with h = 1.2 m,
  // best residual 3e-2") or 'u-limit' ("needs u = 4.1, above u max 3")
export function linearize(model, op)
  // central differences, step 1e-6·max(1, |v|) → { A, B, C, D, states, outputs, op, delay, sensors, warnings }
export function firstOrderFit(lin, k = 0)
  // K = D − C A⁻¹ B;  τ = C A⁻² B / K (mean residence time; exact for n = 1);  θ = lin.delay[k]
  // throws 'integrating-plant' when A is singular on the path ("pole cancellation needs a self-regulating plant")
```

| Use | Operating point |
|---|---|
| LQR (pendulums), swing-up catch, trajectory end | `origin` (fixed for v1; the variant has no `at` parameter) |
| Kalman (motor at rest) | `origin` (fixed for v1) |
| Gain-scheduled / fixed PI (tank) | `{ y: [at_i] }` per point; u0 from `{ y: [y1(x0)] }`, the plant's start level |
| Trajectory | From `model.x0` to `origin` (angle states modulo 2π) |
| Analysis tab | `origin`, `initial`, `{ y }`, or `{ t }` (snapshot) |

`{ t }` is never accepted in a variant: a design that depends on the run it controls would be circular. Variants do not take operating points at all in v1. LQR and Kalman at trim points need offset handling in the laws, and nothing needs that yet.

## 6. Variants: contract, design context, types

### 6.1 Contract

Hand types are unchanged: `{ label, summary, params, check?, make(p, Ts) }`. Designed types add:

```js
{
  designed: true, version: 1,          // version enters the cache key; bump when results change
  computes: ['K', 'kr'],               // refused in params: "lqr computes K and kr from Q and R;
                                       //  to set them by hand use Copy as numbers (a State feedback variant)"
  design(p, ctx) → { values, rows, warnings?, quality? } | { pending: Progress, warnings? },   // pure, synchronous
  make(p, Ts, values),                 // values === null → u = 0 / zero estimates
  manual?(p, values) → { type, params },   // Copy as numbers
  compatible?(a, b) → boolean,         // may stale values run on the new plant (default: same m and Ts)
}
makeLaw(variant, Ts, lib, values = null)
```

`normalizeVariant` changes:
- vector params may be `nullable` (null = "from the plant", used by Kalman R)
- a one-value Q is broadcast at design time, not at normalisation
- keys in `computes` are refused with the sentence above

### 6.2 The design context (built by the store from compileDiagram's closures)

```js
ctx = {
  Ts, idPath: 'ctrl', name: 'controller', kind: 'controller' | 'observer',
  inputs: ['r', 'x', 'θ', 'v', 'ω'],         // labels (blockInputNames)
  model(),                                    // Model of the plant seen (memo)
  linearize(op = 'origin'),                   // LinearModel (memo by op)
  trim(targets),                              // OperatingPoint
  heavy(kind, inputs, start: () => Generator) // → { status: 'ready', value } | { status: 'pending', progress }
}
```

`make()` never receives `ctx`.

### 6.3 Designed types

| type (lib) | Label | Params (inputs only; defaults) | design() | Law | Copy as numbers |
|---|---|---|---|---|---|
| `lqr` (C) | LQR | `Q` [1] (one per measurement; one value = all), `R` 1, `track` 1 (measurement r applies to; 0 none), `Tr` 0, `umin`, `umax` | `lqrDesign`, below | `stateFeedback.make({K, kr, Tr, umin, umax})` | `stateFeedback` |
| `swingUpLqr` (C) | Swing-up (Lyapunov) + LQR catch | `kE kx kv l g thetaS` (hand law parameters), `Q`, `R`, `umin`, `umax` | catch gains = `lqrDesign` with track 1 | `swingUp.make({...p, K, kr})` | `swingUp` |
| `scheduledPI` (C) | PI from the plant (pole cancellation) | `at` [0, 1] (levels of the first measurement; one value = a fixed PI), `Tcl` 0.25 s, `Tr` 0, `umin`, `umax` | for each at_i: trim `{y:[at_i]}` → linearise → fit → Kp = τ/(K·Tcl), Ki = 1/(K·Tcl). u0 = trim u at y1(x0). Dead time θ is shown, not used (warning) | one point: `pid.make({Kp, Ki, Kd: 0, u0, …})`; else `gainScheduled.make({at, Kp, Ki, u0, …})` | `pid` or `gainScheduled` |
| `trajectory` (C) | Planned swing-up + TV-LQR | `T` 2.4 s, `segments` 12, `planShare` 0.75 (share of umax the plan may use), `start` 0 s, `Q`, `R` 0.1, `umin`, `umax`. `T`, `segments` and `planShare` are flagged `heavy, tune: false` | §8 | §8.5 | none |
| `kalman` (O) | Kalman filter (model from the plant) | `Q` 1 (scalar: variance of noise at u; n values: per state), `R` null (= from the sensor blocks) | `kalmanDesign`, below | estimator (the existing `estimator()`) | `luenberger {A, B, C, L}` |

**`lqrDesign(lin, { Q, R, track, Ts })`:**
1. Refusals:
   - n > 40: `too-many-states`.
   - D ≠ 0, or C not square and invertible: `states-not-measured` ("LQR needs every state measured. This block sees x, θ, v but not ω (cart and pole). Wire ω to an input, or add a Kalman Observer.").
   - Q length ≠ m: `q-length`, naming the labels.
2. (Ad, Bd) = `c2d(A, B, Ts)` with a zero-order hold. Qx = Cᵀ diag(Q) C. Kx = `dlqr(Ad, Bd, Qx, R)`. K = Kx C⁻¹, in measurement order.
3. If dlqr did not converge, or ρ(Ad − Bd Kx) ≥ 1: `not-stabilisable`.
4. kr = 1 / (c_track (I − Ad + Bd Kx)⁻¹ Bd). It equals K[0] for the carts.
5. Rows: K labelled by measurement, kr, discrete poles and their continuous equivalents (slowest ω and ζ).
6. Note: "quantisers and noise on the measurements are not in this design". Cost ≈ 3 ms for n = 8 (SDA dlqr measured at 2.8 ms).

**`kalmanDesign(lin, { Q, R, Ts })`:**
- Model at the origin; c2d.
- Qw = q·Bd·Bdᵀ, or diag(Q) shown with state labels.
- Rv = diag(R). R null means σ² + q²/12 from the sensor blocks on each measurement's path; with none it is 1, with the warning "no sensor block on θ: R = 1".
- L = `dlqe`.
- If the block's `outputs` ≠ n: warning `estimates-count` ("the plant seen has 3 states (Motor/armature, Motor/load, angle); set Estimates to 3"). Estimates are truncated or zero-padded.
- Values carry `stateIndex` (global indices) for the look-through.

### 6.4 JSON (inputs only)

```json
{ "name": "LQR only", "type": "lqr", "params": { "Q": [10, 50, 1, 1], "R": 0.1, "track": 1, "Tr": 0, "umin": -25, "umax": 25 } }
{ "name": "Gain-scheduled PI", "type": "scheduledPI", "params": { "at": [0.1, 0.25, 0.5, 0.75, 1], "Tcl": 0.25, "Tr": 0.1, "umin": 0, "umax": 3 } }
{ "name": "Planned swing-up + TV-LQR", "type": "trajectory", "params": { "T": 2.4, "segments": 12, "planShare": 0.75, "start": 0, "Q": [10, 100, 100, 100, 1, 1, 1, 1], "R": 0.1, "umin": -40, "umax": 40 } }
{ "name": "Kalman", "type": "kalman", "params": { "Q": 1, "R": null } }
```

Migration of the committed hand-model `kalman` (params A, B, C, Q, R; no example uses it): A, B or C on `kalman` are refused with "kalman takes its model from the plant; for a model typed by hand use a Luenberger observer". `stateFeedback`, `gainScheduled`, `swingUp`, `pid` and `luenberger` files load unchanged.

## 7. The design store and cache keys (`design.js`)

```js
export class DesignError extends Error { constructor(code, message, hint) }
export function canonical(x)                 // JSON with sorted keys; -0 → 0; ±Infinity → "inf"
export function hashKey(s)                   // cyrb53 → 12 hex digits (shown as #a3f9c1 in the UI and CLI)
export function plantKey(diagram)            // canonical(diagram without x, y, flip; each Controller block
                                             //  without variants and variant; Observers kept whole)
export function createDesignStore({ mode = 'sync', limit = 64, debounceMs = 150 } = {}) → Store
export const SYNC_DESIGNS = createDesignStore()   // default for compileDiagram (Node, CLI, tests)
export function lqrDesign(lin, opts), piCancel(fit, Tcl), kalmanDesign(lin, opts)
export function trajectoryDesign(p, ctx)     // composes planner.js (§8)

Store = {
  mode, generation,                          // generation++ whenever a heavy job finishes
  begin(diagram, compileModel) → Job,        // Job.resolve(block, variant, lib) → DesignStatus; Job.end()
  runJobs(budgetMs) → { busy, finished, waitMs },   // async mode only
  cancel(key), retry(key), onProgress(fn), idle() → Promise, stats() → { runs, hits, heavyRuns },
}
```

| Cache | Key | Holds | Size |
|---|---|---|---|
| Model compile | plantKey | Model-mode `el` | LRU 8 |
| Design | `hashKey(canonical([type, def.version, p, Ts, plantKey, idPath]))` | `{ values, rows, warnings, quality, ms }` | LRU 64 |
| Heavy (plan) | `hashKey(canonical(['plan', PLAN_VERSION, plantKey, idPath, Ts, T, segments, planShare·umax]))`, without Q, R, start, umin or Tr | Plan plus along-plan data (x*, F per sample, Ad_k, Bd_k) | LRU 8; entries the latest compile requested are pinned |
| Slot | `idPath#variant.name#type` → last ready values | Stale fallback | one per slot |

**Consequences:**
- These never re-design: moving, flipping or renaming a Sink; editing r or d (signals live in `system.signals`); the scope timebase; another variant's parameters; another Controller's variant.
- These re-design: plant parameters, initial conditions (θ0, h0), wiring, Ts, the variant's own inputs, and an Observer's variant (it changes the plant a Controller sees through it).
- A Q, R or limit edit on the swing-up re-runs only TV-LQR, the upright LQR and the verify run (≈ 10 ms). It never re-plans.

**DesignStatus** (memory; `info.designs`; never in the JSON):

```json
{ "path": "ctrl", "block": "controller", "variant": "LQR only", "type": "lqr", "key": "a3f9c1d2e4b5",
  "status": "ok", "ms": 2.9, "cached": false,
  "at": "origin (upright rest)", "seen": "F → x, θ, v, ω · 4 states (x, v, θ, ω)",
  "rows": [ { "label": "K", "value": [-9.177, -63.18, -10.33, -13.34], "labels": ["x", "θ", "v", "ω"] },
            { "label": "kr", "value": -9.177, "note": "x follows r" },
            { "label": "slowest pole", "value": "1.9 rad/s, ζ 0.71" } ],
  "warnings": [], "error": null, "progress": null }
```

`status` is one of:
- `ok`
- `pending`: no values, u = 0
- `stale`: the slot's previous values run
- `warn`: values run, with a quality problem (plan not converged, loop does not hold, estimates count)
- `error`: no values, u = 0; `error = { code, message, hint }`
- `cancelled`

## 8. Heavy computation: the swing-up plan

### 8.1 Where it runs

- **Main thread, time-sliced. No Worker.**
  - A `blob:` Worker from `lt-script` would need a guard around the UI modules, a second role for the bundle, a message protocol and a handshake.
  - The claude.ai sandboxed iframe's CSP is expected to refuse it anyway, so the slice fallback would be the usual path: two code paths for one job.
  - Revisit only if a design passes about 10 s.
- **Node (CLI, tests, auto-tune).** `SYNC_DESIGNS` drains the generator with `runPlan` inside `compileDiagram`. `evaluateSystem` stays synchronous; the first compile of the triple pendulum takes about 2 s.
- **Page.** `app.designs = createDesignStore({ mode: 'async' })`.
  1. On a heavy miss, `ctx.heavy` queues one job per key and returns pending.
  2. Debounce: a job starts ≥ 150 ms after it was first requested, so wheeling a mass starts one plan, not twenty.
  3. Newest wins: `runJobs` drops jobs the latest compile did not request.
  4. The pump: a `MessageChannel` loop calls `runJobs(8)` while busy (no 4 ms setTimeout clamp), and uses `setTimeout(waitMs)` during a debounce wait.
  5. The planner yields `null` ticks at most about 2 ms apart, so each slice ends on time and the display's requestAnimationFrame runs between slices.

### 8.2 Before the plan exists

- **Pending.** No earlier plan for this slot: `make(p, Ts, null)` gives u = 0. The rods hang, which is truthful.
- **Stale.** The slot has a ready plan and `compatible()` holds (same m and Ts): it keeps running, labelled "re-planning 43 % · running the previous plan". After a small plant edit the old plan with TV-LQR usually still swings up.
- **Settle.**
  1. `generation++`.
  2. `app.designsSettled()` does the light path: `display.setData(acquire())`, the old run fades as usual, `display.restartSweep()` (the swing-up is seen from t = 0), `controllerTab.renderComputed()`, `renderChrome()`.
  3. Toast "Swing-up planned in 2.1 s".
  4. The Controller tab's inputs are never re-rendered, so focus and typing survive.
- **Progress** (≤ 10 Hz, from `onProgress`) patches only the Computed box and the loopnote: "planning swing-up 43 %". The loopnote is clickable and opens the Controller tab on that block.
- **Cancel** marks the key cancelled (u = 0 or stale) until the inputs change or [Plan] calls `retry(key)`.
- **Memory only.** Each page load plans again (about 2–4 s, visible). There is no localStorage plan cache.

### 8.3 Planner algorithm (rework of `planner.js`)

```js
export function* planTransfer(model, { T, Ts, segments = 12, nodesPerSegment = 4, Fmax = Infinity })
  // yields null (ticks) and { stage, stages, iteration, cost, defect, terminal, fraction, start }
  // returns PlanResult { ok, code, T, Ts, perSegment, sub, z (nodes + shooting states), F (per sample),
  //   S (segment start states), iterations, start, defect, terminal, Fpeak, reason }
export function alongPlan(model, plan)       // segment-wise nominal x*_k from the shooting nodes (never one long
                                             // open-loop replay); Ad_k, Bd_k = central differences of the
                                             // one-sample step map (sub RK4 substeps, force held); no c2d
export function tvlqrGains(along, { Q, R, Pend })   // backward discrete Riccati, P symmetrised every step
export function verifyLoop(model, law, { x0, Ts, sub, duration, umin, umax })
  // nonlinear closed loop for T + 1 s → { ok, endError: { label, value }, Fpeak, xmax }
export function runPlan(gen, onProgress)     // kept: drains a generator
```

**Problem.**
- From `model.x0` to the origin, with angle states (`model.states[i].angle`) compared modulo 2π. This is generic: it uses only `model.f` and nothing pendulum-specific.
- **Sample grid.** perSegment = round(T / (Ts·segments)) samples, at least 4. T is snapped to segments·perSegment·Ts and reported ("T = 2.40 s").
- **Force.** Unknowns are piecewise-linear nodes every perSegment/nodesPerSegment samples. The applied force is the node interpolation **at each sample instant, held over the sample** (zero-order hold), which is exactly what the law applies.
- **Integration.** RK4 with sub = max(1, ceil(Ts / min(5 ms, 0.5/model.bound))) substeps: 2 at Ts = 10 ms.
- **Residuals:**
  - defects (weight w_d)
  - terminal (wrapped)
  - effort (λ·F)
  - hinge λ_b·max(0, |F| − Fmax), with Fmax = planShare·umax (30 N of ±40 N, leaving 25 % for feedback)
- **Continuation stages** (λ, w_d, cap): (3e-3, 1, 120), (1e-3, 10, 80), (3e-4, 100, 80).
  - A stage ends early when the cost falls by less than 1e-3 (relative) over 4 accepted iterations, or when the plan is feasible (defect < 1e-6, terminal < 1e-3).
  - Total cap: 300 iterations.
- **Deterministic starting guesses, tried in order:**
  - states interpolated from x0 to the origin, angles along the wrapped difference
  - force a·sin(kπ t/T) with a = 0.5·min(Fmax, 4·m_total·g), for k = 3, then 2, then 4 half-periods
  - the first that ends `ok` is taken and reported ("converged from start 2 of 3")
  - no random term
- **Result.** `ok` when defect < 1e-4, wrapped |angle| < 0.02 rad, |x| < 0.02 m, |rate| < 0.5 and Fpeak ≤ 1.05·Fmax. Otherwise `plan-not-converged`, with a hint built from the numbers:
  - terminal error large and Fpeak near the limit: "needs more force or a longer T (now 2.4 s)"
  - defects large: "the segments do not join: more segments or a longer T"

**Speed measures:**
1. **`ode.make(p)` per physics block.** Constants are computed once: masses beyond each link μj, μj·lj, μj·g·lj, and the mass-matrix products. Trig is one sin and one cos per angle, with cos(θj−θk) = cj ck + sj sk and sin(θj−θk) = sj ck − cj sk. The mass matrix is solved by Cholesky without pivoting into scratch buffers. Simulation and model mode both use it.
   - Measured: committed `chainRates` 1.04–1.08 µs; prototype 0.35–0.39 µs.
2. **The model evaluates only its slice** (cut, sum, ode, taps). There is no bypass of the diagram, so the planner can never plan a different plant from the one simulated.
3. **Segment-sparse Jacobian.**
   - Segment j's end depends only on S_j (n columns) and its 5 nodes: 13 one-segment integrations per segment, instead of whole trajectories (about 10× fewer).
   - Blocks are stored as n×13 per segment. The −I defect blocks, effort rows and hinge rows are written analytically.
4. **No allocation in loops.**
   - JᵀJ is accumulated from the blocks into one preallocated Float64Array(nz²).
   - Cholesky runs in place on a preallocated copy.
   - The column scratch perturbs only the one entry. There is no `zc.set(z)` per column, no `Array.from` or `.map` per try, and no dense nr×nz J.
5. **Stall exits per stage.** Measured: 220 → 133 iterations; with fast dynamics, 115 iterations and 1.6 s in a prototype.
6. **Fine yields:** `yield null` after each segment's columns (about 1.3 ms) and after each LM try. One progress object per iteration.

**Targets:**
- Node cold: ≤ 2.5 s for the default triple pendulum; the test budget is 10 s.
- Page: about 2× wall-clock (slices).
- Today's planner: 4.8 s, 220 iterations, yields 58–77 ms apart.

### 8.4 From plan to law (light design, ≈ 10 ms, keyed with Q and R)

`trajectoryDesign(p, ctx)`:
1. **Refusal.** C must be square and invertible with D = 0 (same as LQR).
2. **Plan.** `h = ctx.heavy('plan', { T, segments, Fmax }, () => planTransfer(model, …))`. If pending, return `{ pending }`.
3. **Along the plan.** `along` is cached inside the heavy entry, computed once after the generator returns.
4. **Upright gains.** `up = lqrDesign(lin@origin, { Q, R, track: 1, Ts })` gives Pend, Kup and kr.
5. **TV-LQR.** `K_k = tvlqrGains(along, { Q: Cᵀ diag(Q) C, R, Pend: up.P })`, mapped to measurement order: K_y = K_x C⁻¹ and Y_k = C x*_k.
6. **Verify.** `verifyLoop(...)`. If it fails: status `warn`, "the loop does not hold: θ2 is 0.4 rad off 1 s after the plan; peak 77 N with a 40 N limit: lengthen T or raise the limit". A plan that failed or was not verified still runs, so the attempt can be seen.
7. **Rows:**
   - status sentence: "Planned in 2.1 s (124 iterations, start 1 of 3). Verified: upright 1 s after T, peak 16 N of 40 N."
   - defect and end error per label
   - a sparkline of F(t)

### 8.5 The `trajectory` law (counts its own samples; `step(inputs)` is unchanged)

```
k: samples since t = 0; j = k − round(start/Ts)
j < 0:            u = 0
0 ≤ j < Kp:       u = F[j] − Σ_i K[j,i] · d_i,   d_i = y_i − Y[j,i], wrapped for angle measurements
j ≥ Kp:           u = kr·r − Σ_i Kup_i · wrap(y_i)
u clamped to [umin, umax]
values === null:  u = 0
```

`start` shifts the plan in time without re-planning. It assumes the plant rests at x0 under u = 0 until then, which holds for a hanging chain.

## 9. Controller tab, JSON, CLI, browser API

- **Parameters column.**
  - A designed variant's inputs are editable as today, through `app.setPlant` (one undo step).
  - Vector hints name the labels: "Q (x, θ1, θ2, θ3, v, ω1, ω2, ω3)".
  - A variant added from the library gets Q pre-filled with one 1 per measurement.
  - Heavy inputs (T, segments, planShare) sit in a fold, "Plan".
  - Kalman R shows an empty field meaning "from the sensors".
- **Computed box** (new, below the parameters, read-only, greyed), rendered by `controllerTab.renderComputed()`, which patches without touching inputs:
  - **Header:** method · operating point · status · `2.9 ms` or `cached` · `#a3f9c1`.
  - **Plant seen:** "F → x, θ, v, ω · 4 states (x, v, θ, ω) at upright rest", plus warnings ("pipe dead time 0.1 s not in the design", "noise on θ not in the LQR design", "estimates of 'obs' held").
  - **Values:**
    - LQR: K as labelled pairs, kr, poles.
    - Scheduled PI: a table at | trim u | K | τ | θ | Kp | Ki, and u0.
    - Kalman: L as an n×m grid with state labels; estimator poles; what each estimate x̂k is.
    - Plan: a progress bar with stage, iteration, cost and defect while pending, then the quality sentence and the F(t) sparkline.
  - **Errors:** the message and hint.
  - **Buttons:**
    - [Copy as numbers] (lqr, swingUpLqr, scheduledPI, kalman) inserts `manual(p, values)`, named "<name> (numbers)", after the current variant and selects it. It runs bit-identically: the faded old run and the new one coincide, which is a visible trust check. Toast: "Copied: these numbers no longer follow the plant."
    - [Cancel] while planning; [Plan] after a cancel.
- **Variant list glyphs:** "computed", "⟳ 43 %", "!".
- **Library:** two groups. "From the plant": LQR, PI from the plant, Swing-up + LQR catch, Planned swing-up, Kalman. "By hand": PID, State feedback, Gain-scheduled PI, Swing-up, Luenberger, Finite difference. Remove the `trajectory` filter at `ui/controller.js:136`.
- **JSON, save, autosave, Copy JSON, Export HTML:** the project never contains computed values (they live only in the store and statuses). `normalizeVariant` refuses `computes` keys with the sentence in §6.1.
- **CLI:** `node cli.mjs design <project> [--block <idPath>] [--json]` prints every running designed variant's status and rows, synchronously. `tools/triple-swingup.mjs` stays deleted.
- **Browser API:** `window.loopTuner.designs()` returns the statuses; `await window.loopTuner.whenDesigned()` resolves when no job is pending (for Playwright and agents).
- **Auto-tune (later):** skips parameters flagged `tune: false`.

## 10. The System library in the new form

- **Mass–spring–damper:** unchanged.
- **DC motor, position control:** unchanged (P, PD and PID gains are hand parameters).
- **Encoder errors and torque ripple:** unchanged (hand PI).
- **Conical tank:**
  ```js
  ctrl(130, 90, 2, 0.02, [
    { name: 'Gain-scheduled PI', type: 'scheduledPI', params: { at: [0.1, 0.25, 0.5, 0.75, 1], Tcl: 0.25, Tr: 0.1, umin: 0, umax: 3 } },
    { name: 'PI tuned for full',  type: 'scheduledPI', params: { at: [0.8],  Tcl: 0.25, umin: 0, umax: 3 } },
    { name: 'PI tuned for empty', type: 'scheduledPI', params: { at: [0.15], Tcl: 0.25, umin: 0, umax: 3 } },
    { name: 'Off', type: 'off', params: {} },
  ])
  { id: 'pipe', type: 'delay', name: 'pipe', params: { L: 0.1, y0: null }, … }
  ```
  - Dead time's `y0` becomes nullable: null means "before L it outputs its input at t = 0" (the pipe was already flowing). Until something is recorded, it outputs its current input.
  - The design reproduces Kp = A(h)/0.25, Ki = a√(2g)/(2√h·0.25), the fixed PIs 2.112 / 0.990 and 0.173 / 2.287, and u0 = a√(2g·0.15) = 0.1716.
- **Pendulum swing-up:**
  ```js
  ctrl(130, 80, 5, 0.01, [
    { name: 'Swing-up + LQR catch', type: 'swingUpLqr', params: { kE: 3, kx: 8, kv: 5, l: 0.5, g: 9.81, thetaS: 0.4, Q: [10, 50, 1, 1], R: 0.1, umin: -25, umax: 25 } },
    { name: 'LQR only', type: 'lqr', params: { Q: [10, 50, 1, 1], R: 0.1, umin: -25, umax: 25 } },
    { name: 'Off', type: 'off', params: {} },
  ])
  ```
- **Triple pendulum:** starts hanging: `theta10 = theta20 = theta30 = Math.PI` (physical initial conditions).
  ```js
  signals: { r: { period: 5, components: [] }, d: { period: 5, components: [pulse(4, 3.5, 0.1)] } },
  scope: { channels: channels('x', 'theta1', 'F', 'd') },
  ctrl(130, 70, 9, 0.01, [
    { name: 'Planned swing-up + TV-LQR', type: 'trajectory', params: { T: 2.4, segments: 12, planShare: 0.75, Q: [10, 100, 100, 100, 1, 1, 1, 1], R: 0.1, umin: -40, umax: 40 } },
    { name: 'LQR only (cannot swing up)', type: 'lqr', params: { Q: [10, 100, 100, 100, 1, 1, 1, 1], R: 0.1, umin: -40, umax: 40 } },
    { name: 'Off', type: 'off', params: {} },
  ])
  ```
  - Notes: "Three rods hang below a cart. When the system loads, the page plans a swing-up from the plant itself (a few seconds; the Controller tab shows the progress), follows it with time-varying LQR, and holds the rods up. At 3.5 s the cart is pushed (d)."
  - Two things, per "one or two things per example". "LQR, gentle" goes; it is still R = 1.
- **Deleted:** `K_SINGLE`, `K_TRIPLE`, `K_TRIPLE_GENTLE` and the tank's comment table. The expected numbers move into the tests, which are not shipped.
- **systems.js VARIANT_TAGS:** add `scheduledPI: 'Gain scheduling'` and `swingUpLqr: 'Lyapunov swing-up'` (also tagged 'LQR'). `trajectory` and `kalman` already exist.
- **Observer example** (task #2, separate): a motor with a quantised, noisy encoder; a `kalman` Observer (R from the sensors) whose speed estimate feeds a PI. With the n = 1 realisation, "Motor/load" is the speed.

## 11. Tests

Test files: `test/linearize.test.mjs`, `test/design.test.mjs`, `test/planner.test.mjs`, edits to `core.test.mjs`, and `test/planner.slow.mjs` (not in the `*.test.mjs` glob).

1. **Physics.** `ode.make` f equals the current f to 1e-12 (relative) on 1000 seeded states for cartPole, pendulumCart (1–3 links) and the tank. `ode.states` labels and angle flags are right.
2. **Model mode.**
   - Cart–pole at the origin: A and B equal the analytic Jacobian (with friction) to 1e-6. States are `x, v, θ, ω`; outputs `x, θ, v, ω`.
   - The motor keeps 3 states; an unrelated integrator is dropped.
   - The tank reports delay 0.1.
   - The quantiser is identity and noise is 0, each with a note.
   - Two Controllers: the second one's model holds the first at 0.
   - `laws: false` never designs (the store's runs count is unchanged).
3. **Trim.** Tank at y = 0.45 gives h = 0.45 and u = a√(2g·0.45) to 1e-9. y = 0.98 with umax 0.3 gives `u-limit` with a sentence.
4. **Fit.** A firstOrder block's K and τ are exact. The motor's speed fit has τ = C A⁻² B / K. An integrating plant gives `integrating-plant`.
5. **LQR reproduces the old gains** to 0.1 %:
   - K_SINGLE (Q [10, 50, 1, 1], R 0.1)
   - K_TRIPLE (Q [10, 100×3, 1×4], R 0.1)
   - K_TRIPLE_GENTLE (the same Q, R 1)

   kr = K[0] to 1e-6. With ω unwired: `states-not-measured` naming ω. Q of length 3: `q-length`.
6. **scheduledPI.** Kp and Ki equal the formulas at all five levels to 1e-6, the old table to 0.5 %, the fixed PIs to 0.5 %, and u0 = 0.1716.
7. **Cache.**
   - A second compile is a hit.
   - No re-run after: moving a block, renaming a Sink, editing signal r, changing the timebase, editing another variant, switching another Controller's variant.
   - A re-run after: m1, θ10, Ts, or the variant's own Q.
   - On `trajectory`: a Q edit leaves `heavyRuns` unchanged; a T edit re-plans.
8. **JSON and Copy as numbers.**
   - A designed variant round-trips with inputs only; Copy JSON contains no K.
   - `K` on `lqr` is refused with "Copy as numbers"; `A` on `kalman` is refused.
   - `manual()` twins (lqr, swingUpLqr, scheduledPI with 1 and 5 points, kalman) simulate bit-identically to the designed variant.
9. **Planner** (default triple via the model of the library system):
   - `ok`; ≤ 300 iterations; time logged; < 10 s in Node.
   - Two cold runs in fresh stores give identical F, bit for bit.
   - The longest gap between yields is < 10 ms on an idle machine; the assertion is < 30 ms.
   - Fmax = 2 N gives `warn` with `plan-not-converged` and a hint naming T and the force, without throwing.
   - In `planner.slow.mjs`: T ∈ {1.8, 3.0}, masses ×2, lengths ×1.6, and a 4 N push mid-swing all verify `ok`.
10. **Closed loop** (`evaluateSystem` on the library triple pendulum):
    - Planned swing-up: |wrap θi| < 0.05 at 3.4 s and 4.9 s, |x| < 1 m throughout, and it holds after the push.
    - LQR only: |θ1| > 1 at 4.9 s.
11. **Async equals sync.**
    - With an async store, the first `evaluateSystem` gives `pending`, u = 0 and θ1 ≈ π at 4.9 s.
    - Repeated `runJobs(5)` raises progress; `generation` increments once.
    - The next evaluate equals the sync result bit for bit.
    - A newer key drops the older job; the stale case is used only when `compatible`.
12. **Guard.**
    - Library variants use only designed types, `pid` and `off`: no `stateFeedback`, `gainScheduled`, `swingUp` or `luenberger`.
    - No Dead time has a numeric `y0` other than 0.
    - `plants.js` contains no identifier matching `/^K_/`.
13. **Behaviour test** (existing): passes with the renamed variants: 'Swing-up + LQR catch', 'LQR only', 'Planned swing-up + TV-LQR', 'LQR only (cannot swing up)'.
14. **Kalman.**
    - A scalar plant matches the closed-form steady-state gain.
    - R from the sensors = σ² + q²/12.
    - Look-through: LQR on a Kalman's x̂ designs the same K as on the true states.
15. **CLI.** `node cli.mjs design <triple>` prints `ok` and K; `--json` parses.
16. **Bundle.** `bundleScript()` parses with the new modules (MODULES order).

## 12. Implementation steps (each one agent, `npm test` green at the end)

0. **Record.**
   - `decisions.md` v2.7 entry: the rules of §1 and the interpretations of §14.
   - New `design/output/designs.md`: this architecture, condensed, plus a row in the output README table.
   - The person's words are already saved in input file 09.
1. **Physics.**
   - `ode.states` and `ode.make` (constants, 6 trig calls, Cholesky) for the three physics blocks; the compile uses `make`.
   - Add `planner.js` to MODULES now.
   - Test 1.
2. **Model mode** in `diagram.js`:
   - id paths; `opts.mode = 'model'`; `opts.laws = false`, used by `ui/plant.js`
   - `el.seen(idPath, at)` → Model: slice, cut, structural reduction, delays and sensors, held, sources
   - n = 1 realisation with C = 1
   - `blockInputNames` moved to core and imported by the Controller tab
   - nullable Dead time `y0`

   Test 2.
3. **`linearize.js`:** `parseOp`, `opLabel`, `operatingPoint`, `trim`, `linearize`, `firstOrderFit`. Tests 3 and 4.
4. **Store and the first designed type.**
   - `design.js`: `DesignError`, `canonical`, `hashKey`, `plantKey`, `createDesignStore` (sync), `SYNC_DESIGNS`, `lqrDesign`.
   - `compileDiagram`: deferred laws, observers first, `job.resolve`, `el.designs`.
   - `simulateSystem(…, { designs })`, `evaluateSystem(p, { designs })`, `info.designs`.
   - Contract in `controllers.js` (`designed`, `computes`, `version`, `design`, `make(p, Ts, values)`, `manual`, `compatible`).
   - `normalizeVariant`: nullable vectors, refusal of computed keys. The `lqr` type.
   - Tests 5, 7 (non-trajectory part), 8 (lqr).
5. **`swingUpLqr` and `scheduledPI`** with their manual twins. Tests 6 and 8.
6. **Migrate `plants.js`.**
   - Tank (`y0: null`), pendulum; the triple pendulum temporarily stays upright on `lqr`.
   - Delete the K constants; update VARIANT_TAGS.
   - Guard test 12, behaviour test 13.
   - Rewrite `system-library.md` "How the controllers were designed" as "What each design computes in the page".
7. **Controller tab:** Computed box (`renderComputed`), glyphs, Copy as numbers, library groups, labelled vector hints, the Plan fold, loopnote. Check in the browser that a wheel on Q re-designs within a frame and that focus survives.
8. **Planner rework (pure):**
   - `planTransfer` (zero-order hold, sample grid, block-sparse JᵀJ, preallocated Cholesky, stall exits, three starts, caps, ticks, report)
   - `alongPlan`, `tvlqrGains`, `verifyLoop`

   Tests 9 and the slow matrix.
9. **`trajectory`:**
   - `trajectoryDesign` and the `trajectory` type; heavy entries in the sync store
   - the triple pendulum starts hanging with re-timed signals and notes
   - `cli.mjs design`

   Tests 7 (trajectory part), 10, 15.
10. **Async in the page.**
    - Store async mode: queue, debounce, newest-wins, slots and stale, cancel/retry, `onProgress`, `idle()`.
    - `app.js`: the store, `generation` in the acquire key, MessageChannel pump, light settle path, `display.restartSweep()`, progress patching.
    - `loopTuner.designs()` and `whenDesigned()`.
    - Test 11, and a browser check that the triple pendulum hangs, shows progress, then swings up.
11. **Kalman.** Designed `kalman`, sensor-based R, `luenberger` twin, look-through via `stateIndex`, refusal of a hand model on `kalman`. Test 14. The observer example itself is the observers workstream.
12. **Analysis hooks.**
    - `simulateSystem(…, { until: t })` returns `snapshot: { t, X, held }`.
    - `project.js`: `export function linearizeBlock(project, idPath, at = 'origin', { designs })` → LinearModel. A `{ t }` operating point uses the snapshot's sources and held values; drift is reported.
    - Optional `law.linear?(p, Ts, values)` → discrete controller state space, for C(z)P(z).
    - The Analysis tab itself is its own workstream.
13. **Docs sweep:** `controller-proposal.md` (design methods), `project-format.md` (variants hold inputs; nullable fields), `AGENTS.md` (`cli design`, `whenDesigned`), `roadmap.md`, and the README status.

## 13. Not built

- Web Worker, WebAssembly, SharedArrayBuffer. Revisit only if a design passes about 10 s.
- localStorage or IndexedDB plan caches.
- Warm starts across edits. Wall-clock stopping.
- A planner fast path that bypasses the compiled diagram. Planning steps above 5 ms.
- Analytic or automatic-differentiation Jacobians, sensitivity equations, sparse LM solvers. Node-span restarts for force columns (about 12 %, not needed).
- LQR or Kalman at trim points: origin only until an example needs it. Variant-level operating-point parameters.
- Padé or other dead-time states in state-space models: dead time is reported, exact in frequency plots, and noted on root locus.
- SIMC or IMC rules: pole cancellation only; θ is shown.
- Cascade or joint MIMO design: other Controllers are held. Look-through for hand observers (`difference`, `luenberger`).
- A general trajectory-optimisation UI (costs, constraints, targets): one method, from the start state to rest at the origin.
- Manual copies of plans or TV-LQR tables.
- Designs for variants that are not running.
- Reading the swing-up's l and g from the plant, or Bryson-rule automatic Q and R.
- A display chip or canvas badge for planning: the loopnote and the Controller tab suffice.

## 14. Interpretations for the decision log

- "Computed" covers everything derived from the plant: gains, tables, trim values (u0, a pipe's start flow), models and plans. Hand gains, energy-pump gains and physics are inputs.
- A design sees the plant with other Controllers held, so cascades are designed with the inner loop open. It sees through Kalman observers and holds hand observers.
- Dead time is left out of state-space designs and reported. Quantisers and noise are left out of LQR and used for the Kalman R.
- Plans are computed when a system loads (2–4 s, visible) and are not kept across page loads. A plan that failed still runs, so the attempt can be seen.
- Hand types stay for people who want numbers. "Copy as numbers" is the bridge, offered for LQR, PI and Kalman, never for plans.