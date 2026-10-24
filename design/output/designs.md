# Designs computed in the page

Reader: whoever builds or changes a designed controller or observer, the plant model a design sees, the swing-up planner, or the Analysis tab. This is the decided architecture, condensed; the full plan, with the reasons, cost figures and test list, is [designs-in-the-page.md](designs-in-the-page.md). Where the code and this page differ, the code wins and this page is fixed.

**Nothing plant-specific computed offline is stored.** The project file, `plants.js` and the HTML hold design inputs only: weights, times, levels, limits, names, physics parameters, and gains a person chose by hand. Every gain, table, trim value, model and plan is computed in the page from the plant as it is wired, by code that ships in the bundle; Node runs the same code. (The person, [input 09](../input/2026-10-24-09-analysis-autotune-triple-swingup.md): "It should be computable in principle … the optimizer, it should be part of the package that we deliver, not something that you bake in.") The rules and interpretations are in [decisions.md](decisions.md), v2.7.

## Modules

| Module | Role |
|---|---|
| `core/diagram.js` | The compiler. In `model` mode it gives the plant a block sees (`el.seen`); in a normal compile it makes the laws once every node exists, observers first, and asks the design store for the values of each running designed variant (`el.designs`: their statuses) |
| `core/linearize.js` | `DesignError` (code, sentence, hint); operating points (`parseOp`, `opLabel`, `operatingPoint`), `trim`, `linearize`, `firstOrderFit`, on a Model. Pure numerics |
| `core/planner.js` | Swing-up plan, along-plan linearisation, TV-LQR gains, verify run. In the bundle; reworked in step 8 |
| `core/design.js` | Keys (`canonical`, `hashKey`, `plantKey`), the memory-only design store (`createDesignStore`, `SYNC_DESIGNS`), `lqrDesign`, `piCancel` and `scheduledPIDesign`; the Kalman and trajectory helpers come with their types |
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

## Designed variants

A designed type adds `designed: true`, `version`, `computes` (keys refused in a file: "lqr computes K and kr from the plant and Q, R and track; to set them by hand use Copy as numbers (a State feedback variant)"), `twin` (the hand type Copy as numbers makes), `design(p, ctx)` (pure, synchronous; throws `DesignError`; may return pending once the page store is async), `make(p, Ts, values)` (values null → u = 0), `manual(p, values)` (Copy as numbers) and, for the page, `compatible(a, b)`. `makeLaw(variant, Ts, lib, values)`. Parameters may be `nullable` (vectors too: null means "from the plant"), `int`, `positive`, and vectors take a `min`. `ctx` = `{ Ts, idPath, name, kind, inputs, model(), linearize(op, limits), trim(targets, limits) }`; `heavy` comes with the plan (step 9). A design may return its own `at` (the operating points, for the status) when one label does not say it. A designed law runs as its Copy as numbers twin would (`make` builds the twin's law from `manual(p, values)`), so the copy runs bit for bit alike. A vector parameter's `per` (`'measurement'`, `'level'`) lets the Controller tab name its entries.

| Type | Inputs | Computes |
|---|---|---|
| `lqr` (built) | Q (one per measurement, or one for all), R, track (the measurement r applies to; 0 none), Tr, limits | Discrete LQR at the origin: K = Kx C⁻¹ in measurement order, kr (static gain 1 from r to the tracked measurement; equals K[0] for the carts), the slowest pole. Refuses `states-not-measured` (naming what is missing: "sees x, θ, v but not ω (cart and pole)"), `q-length`, `not-at-rest`, `not-stabilisable`, `no-states`, `too-many-states`. Reproduces the gains the library held (K_SINGLE, K_TRIPLE, K_TRIPLE_GENTLE) to the digits they were stored with (within 0.02 %) |
| `swingUpLqr` (built) | the hand energy-pump gains (kE, kx, kv, l, g, θs), Q, R, limits | The catch gains K, kr by `lqrDesign` at the origin (the upright rest), x following r. Refuses `swing-inputs` unless the block measures four signals with an angle second (the law reads x, θ, v, ω). Copy as numbers: `swingUp` |
| `scheduledPI` (built) | levels `at` of the first measurement (one level: a fixed PI), Tcl, Tr, limits | At each level: `trim` → `linearize` → `firstOrderFit` → `piCancel`: Kp = τ/(K·Tcl), Ki = 1/(K·Tcl). u0: the input that holds the first measurement where the plant starts (a `trim` at y1(x0)), so the loop starts in exact balance. The dead time θ is shown and left out, with a warning. The status's `at` reads "h = 0.1 … 1 m (5 levels)"; a `gains` row is a table (level, trim u, K, τ, θ, Kp, Ki). Refusals come from trim and the fit (`u-limit`, `trim-failed`, `integrating-plant`). Copy as numbers: `pid` (one level) or `gainScheduled` |
| `trajectory` | T, segments, planShare, start, Q, R, limits | The swing-up plan (force held per Ts), TV-LQR along it, the upright LQR, a verify run |
| `kalman` (observer) | Q, R (empty: from the sensor blocks) | L by the discrete Riccati equation; the states each estimate stands for |

The store (`createDesignStore`) caches in memory only (64 designs, 8 model compiles, LRU), keyed by the type, its version, the variant's inputs, Ts, the plant (`plantKey`: without places, flips, Sinks' names or the variants of Controller blocks; Observers whole) and the block's id path. Failed designs are cached too: the same inputs fail the same way. compileDiagram calls `store.begin(diagram, compileModel)` once per compile with a designed variant running, then `job.resolve(block, variant, lib)` per block, observers first: a designed observer's `values.stateIndex` lets a later Controller look through it. Each resolve gives a status `{ path, block, variant, type, key, status, ms, cached, at, seen, rows, warnings, error, progress }` whose `values` are not enumerable (a status prints and serialises without numbers). `seen` ("F → x, θ, v, ω · 4 states (x, v, θ, ω)") is built from the live labels, so renaming a Sink renames u without a re-design. `simulateSystem(…, { designs })` and `evaluateSystem(p, { designs })` take a store (default `SYNC_DESIGNS`) and return the statuses as `info.designs`; the page lists them with `window.loopTuner.designs()`. A cache hit costs about 0.2 ms per compile (the triple pendulum's key). The plan's key leaves out Q and R, so tuning Q re-runs only TV-LQR. In Node the store runs synchronously; in the page the plan runs in short slices pumped by a MessageChannel, newest job wins, and the display shows u = 0 (or the previous plan, labelled) until it is ready.

The Controller tab gets a read-only **Computed** box under the parameters (method, operating point, status, time or "cached", the plant seen, the values, errors with a hint, Copy as numbers, Cancel / Plan). `node cli.mjs design <project>` prints the same; `window.loopTuner.whenDesigned()` resolves when nothing is pending.

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
| 7 | Controller tab: Computed box, glyphs, Copy as numbers, library groups | |
| 8 | Planner rework | |
| 9 | `trajectory`; the triple pendulum starts hanging; `cli.mjs design` | |
| 10 | Async store and pump in the page | |
| 11 | Designed `kalman` with look-through | |
| 12 | Analysis hooks (snapshots, `linearizeBlock`) | |
| 13 | Docs sweep | |
