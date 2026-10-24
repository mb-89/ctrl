# Tab 3: the Controller

Reader: whoever changes controllers, their library or the Controller tab. **Status: built 2026-10-24** (decided with the person the same day; their words in [../input/2026-10-24-08-controllers-and-5-seconds.md](../input/2026-10-24-08-controllers-and-5-seconds.md)).

**The controller is a block in the plant diagram, and a block holds several interchangeable implementations (variants, as Simulink's variant subsystems).** All variants of a block have the same interface, so flipping between them changes nothing else; Auto-tune will search their parameters and flip through them.

## The Controller block

- Inputs: r first, then the measurements, as many as the block's **Inputs** (default 2: r and y). Output: u.
- Digital: every variant runs at the block's **sample time Ts** and holds u between samples (zero-order hold). Several Controller blocks may have different Ts. The simulation steps no longer than the shortest Ts, and a controller samples on its own clock.
- JSON: `{ "type": "controller", "params": { "inputs": 2, "Ts": 0.01 }, "variants": [ { "name": "PD", "type": "pid", "params": { … } } ], "variant": 0 }`. Open actuator limits are saved as `null`.

## The controller library (`src/core/controllers.js`)

| Type | Law | For |
|---|---|---|
| `off` | u = 0 | Seeing the plant on its own |
| `pid` | Kp(b·r − y) + Ki∫e + Kd·ẏ filtered (Tf); prefilter Tr (Vorfilter); limits with anti-windup; start output u0 | Most loops |
| `stateFeedback` | u = kr·r − K·y, one gain per measured state; kr is the static prefilter; optional Tr | Matrix controllers (Zustandsregler), LQR, pole placement |
| `gainScheduled` | PI with Kp, Ki interpolated from a table over the measurement | Plants whose dynamics change with the operating point |
| `swingUp` | Far from upright, u = kE·E·ω·cos θ (V = ½E² falls: a Lyapunov design) with cart centring; near upright, state feedback | Swinging a pendulum up and catching it |

### Designed types: computed from the plant

Designed types hold inputs only (weights, levels, times, limits) and compute their numbers in the page from the plant the block sees, every time the diagram changes; nothing plant-specific is stored ([designs.md](designs.md); the person, [input 09](../input/2026-10-24-09-analysis-autotune-triple-swingup.md)). The plant a block sees is the map from its output u to its measurements, from the same compiled diagram that runs, with other Controllers holding their output.

| Type | Inputs | Design method | Copy as numbers |
|---|---|---|---|
| `lqr` | Q (per measurement), R, track, Tr, limits | Discrete LQR (zero-order hold at Ts) on the plant linearised at the origin, which must be at rest with every state measured: K = Kx C⁻¹ in measurement order; kr gives the tracked measurement a static gain of 1 from r | `stateFeedback` |
| `scheduledPI` | levels `at` of the first measurement, Tcl, Tr, limits | At each level: trim (the u that holds it), linearise, fit a first-order lag K e^(−θs)/(τs + 1) on the path from u; pole cancellation Kp = τ/(K·Tcl), Ki = 1/(K·Tcl). u0 holds the level the plant starts at. The dead time θ is reported and left out | `pid` (one level) or `gainScheduled` |
| `swingUpLqr` | the energy pump's hand gains, Q, R, limits | The catch by `lqr` at the upright rest, and the pole's length and g the pump measures energy with; the pump's gains stay by hand | `swingUp` |
| `trajectory` | T, segments, planShare (the Plan fold), start, Q, R, limits | A force per sample that takes the plant from its start state to rest at the origin (multiple shooting, Levenberg–Marquardt, angles modulo 2π), within a share of each limit, time-varying LQR along it, the LQR at the origin after it, checked on the nonlinear plant as it runs. Made in the background in the page (a few seconds, with progress and Cancel); a limit or the plan's own inputs plan again | none: a plan is always computed |

The **Observer block** (inputs u, y1, y2, …; outputs the estimates x̂1, x̂2, …; its own Ts) holds variants from `src/core/observers.js` the same way: `kalman` (designed: the model of the states the Observer sees and the steady-state gain L by `dlqe`; R from the noise and quantizer blocks on each measurement when left empty; Copy as numbers gives `luenberger`), `luenberger` (A, B, C and L by hand) and `difference` (finite differences). A Controller designed on a Kalman filter's estimates looks through them to the states they stand for, so LQR on x̂ gives the K it gives on the states.

Every controller type also has `linear(p, Ts, at, values)`: its discrete state space from [r, y…] to u about an operating point, for the Analysis tab (designs.md, "For the Analysis tab").

To add one: an entry in `CONTROLLERS` with `label`, `summary`, `params`, `make(params, Ts)` returning `{ step(inputs) → u }` and, when the law is linear about an operating point, `linear` (a designed type adds the fields in designs.md); a sentence in `ABOUT` in `src/ui/controller.js`; a test.

## The tab

Four columns: the block (which one, if several; Inputs, Ts; what feeds each input), the **variants** (click one to run it, double-click to rename, Duplicate, Delete; a designed one is marked "computed", or "! no design" when its design was refused), the running variant's **parameters** (typed with SI prefixes, vectors comma-separated and their entries named; the wheel nudges a number by 5 %, Shift 1 %, or the entry under the caret in a focused list, and the display follows at once) with, for a designed variant, the read-only **Computed** box and **Copy as numbers**, and the **library** in two groups, From the plant and By hand (adds a variant that keeps the actuator limits and gets one gain or weight per measurement).

Comparing: the run before a change stays faded on the display for five runs, so flipping a variant or turning a parameter shows old against new.

## Not yet

- Variants that are diagrams (freeform controllers built from blocks); MIMO outputs.
- Auto-tune over parameters and variants, with goals for following r and rejecting d.
