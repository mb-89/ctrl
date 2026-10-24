# Designs computed in the page

Reader: whoever builds or changes a designed controller or observer, the plant model a design sees, the swing-up planner, or the Analysis tab. This is the decided architecture, condensed; the full plan, with the reasons, cost figures and test list, is [designs-in-the-page.md](designs-in-the-page.md). Where the code and this page differ, the code wins and this page is fixed.

**Nothing plant-specific computed offline is stored.** The project file, `plants.js` and the HTML hold design inputs only: weights, times, levels, limits, names, physics parameters, and gains a person chose by hand. Every gain, table, trim value, model and plan is computed in the page from the plant as it is wired, by code that ships in the bundle; Node runs the same code. (The person, [input 09](../input/2026-10-24-09-analysis-autotune-triple-swingup.md): "It should be computable in principle … the optimizer, it should be part of the package that we deliver, not something that you bake in.") The rules and interpretations are in [decisions.md](decisions.md), v2.7.

## Modules

| Module | Role |
|---|---|
| `core/diagram.js` | The compiler. In `model` mode it gives the plant a block sees (`el.seen`); later it resolves designs while it compiles |
| `core/linearize.js` (next) | Operating points, trim, linearisation, first-order fit, on a Model. Pure numerics |
| `core/planner.js` | Swing-up plan, along-plan linearisation, TV-LQR gains, verify run. In the bundle; reworked in step 8 |
| `core/design.js` (to come) | `DesignError`, keys, the memory-only design store, LQR / PI / Kalman / trajectory design helpers |
| `core/controllers.js`, `core/observers.js` | Hand types unchanged; designed types `lqr`, `swingUpLqr`, `scheduledPI`, `trajectory`, `kalman` |

`design.js` never imports `diagram.js`: the diagram hands the store a closure that compiles the model.

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
| Dead time, transfer function with delay | Pass straight through; each measurement reports its series dead time in `delay[k]`. Paths with different dead times give a warning |
| Quantizer | Identity; its step goes into `sensors[k].q`, with a note |
| Noise | Adds 0; its σ goes into `sensors[k].std`, with a note |
| Saturation, Function, Switch | As in the simulation, so finite differences see their slope; `atLimits(x, u)` names a saturation outside its limits |
| Controller, Observer | No laws are built; outputs come from the cut, `held`, or the look-through |
| Source | `at.sources[name] ?? 0` |

`opts.laws === false` is separate: the normal compile with every sampled block at u = 0 and no designs. The Plant tab's structure check uses it, so editing the canvas never designs.

### States and the Model

- **Global state order** is the compile's allocation order (diagram order, depth first through subsystems, then each block's own order), the same in both modes, so a simulation snapshot X fits a model directly. `el.states` lists every state with its label.
- **Physics blocks** declare `ode.states(p)` (cartPole `x, v, θ, ω`; pendulumCart `x, θ1…, v, ω1…`; conicalTank `h`) and `ode.make(p)`, which computes constants once and returns the allocation-free rate function the compile uses. The pendulum chain uses one sin and one cos per angle and solves its mass matrix by Cholesky (LDLᵀ).
- **A first-order transfer-function block** (integrator, first order) is realised with C = 1, so its state is its output: the state of "Motor/load" is the speed. Higher orders are labelled `name.x1…`.
- **Labels**: `subsystem/block.state` for states; measurements by what feeds the input.
- **Structural reduction**: the Model keeps the states that the cut reaches **and** that reach a measurement (a walk over the compiled nodes). The rest stay at the base state X0. Motor position: armature, load, angle; tank: h; carts: all.

`el.seen(idPath, at)` (idPath: subsystem ids and the block id, `'motor/ctrl'`) returns, memoised per `at`:

```js
Model = {
  idPath, name, kind,             // the block; kind 'controller' | 'observer'
  n, m, X0, x0,                   // kept states, measurements, full base state, kept base state (hanging for the pendulums)
  input: { label },               // what u is called ('F' when a Sink records it)
  states:  [{ label, name, unit, angle, index }],   // index into the global state
  outputs: [{ label, angle }],    // angle when the measurement is exactly one angle state
  f(x, u, dx), y(x, u, out),      // allocation-free; only the slice of nodes between cut, states and measurements
  atLimits(x, u),                 // sentences for saturations outside their limits there
  delay: [s], sensors: [{ std, q }], bound, warnings: [],
}
at = { held?: { [idPath]: number | number[] }, sources?: { [name]: number }, X?: full state, t?, seeThrough?: Map(observerIdPath → global indices) }
```

## Operating points (`linearize.js`)

`'origin'` (x = 0, u = 0; refused when the origin is not at rest), `'initial'` (x0, u from |f| minimal), `{ y: [...] }` (trim by damped minimum-norm Gauss–Newton, ≤ 50 iterations), `{ t }` (a snapshot of the run; drift reported; never in a variant). `linearize(model, op)` by central differences gives `{ A, B, C, D, states, outputs, delay, sensors, warnings }`; `firstOrderFit` gives K = D − C A⁻¹ B, τ = C A⁻² B / K, θ = delay. Variants take no operating points in v1: LQR and Kalman at the origin, the tank PI at trim points of the level.

## Designed variants

A designed type adds `designed: true`, `version`, `computes` (keys refused in a file: "lqr computes K and kr from Q and R; to set them by hand use Copy as numbers"), `design(p, ctx)` (pure, synchronous; may return pending), `make(p, Ts, values)` (values null → u = 0), `manual(p, values)` (Copy as numbers) and `compatible(a, b)`.

| Type | Inputs | Computes |
|---|---|---|
| `lqr` | Q (one per measurement), R, track, Tr, limits | Discrete LQR at the origin: K in measurement order, kr, poles. Needs every state measured |
| `swingUpLqr` | the hand energy-pump gains, Q, R, limits | The catch gains of the swing-up by LQR |
| `scheduledPI` | levels `at`, Tcl, Tr, limits | Kp, Ki by pole cancellation at each trimmed level, and u0 at the start level |
| `trajectory` | T, segments, planShare, start, Q, R, limits | The swing-up plan (force held per Ts), TV-LQR along it, the upright LQR, a verify run |
| `kalman` (observer) | Q, R (empty: from the sensor blocks) | L by the discrete Riccati equation; the states each estimate stands for |

The store (`createDesignStore`) caches in memory only, keyed by the type, its version, the variant's inputs, Ts, the plant (without positions, Sinks' places or other variants) and the block's id path. The plan's key leaves out Q and R, so tuning Q re-runs only TV-LQR. In Node the store runs synchronously; in the page the plan runs in short slices pumped by a MessageChannel, newest job wins, and the display shows u = 0 (or the previous plan, labelled) until it is ready.

The Controller tab gets a read-only **Computed** box under the parameters (method, operating point, status, time or "cached", the plant seen, the values, errors with a hint, Copy as numbers, Cancel / Plan). `node cli.mjs design <project>` prints the same; `window.loopTuner.whenDesigned()` resolves when nothing is pending.

## Steps and status

| Step | What | Status |
|---|---|---|
| 0 | This page, decisions v2.7 | Built |
| 1 | `ode.states`, `ode.make` for the physics blocks; `planner.js` in the bundle | Next |
| 2 | Model mode in `diagram.js`, `el.seen`, `laws: false`, n = 1 realisation, `blockInputNames` in core, nullable Dead time `y0` (the tank's pipe has none baked in) | |
| 3 | `linearize.js` | |
| 4 | `design.js`, the store, the `lqr` type, designs resolved while compiling | |
| 5 | `swingUpLqr`, `scheduledPI` and their manual twins | |
| 6 | `plants.js` migrated; K constants deleted; guard test | |
| 7 | Controller tab: Computed box, glyphs, Copy as numbers, library groups | |
| 8 | Planner rework | |
| 9 | `trajectory`; the triple pendulum starts hanging; `cli.mjs design` | |
| 10 | Async store and pump in the page | |
| 11 | Designed `kalman` with look-through | |
| 12 | Analysis hooks (snapshots, `linearizeBlock`) | |
| 13 | Docs sweep | |
