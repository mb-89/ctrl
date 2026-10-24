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

Designed types hold inputs only and compute their numbers from the plant in the page ([designs.md](designs.md)): `lqr` (state feedback by LQR), `scheduledPI` (PI from the plant, one level or scheduled), `swingUpLqr` (the swing-up with its catch by LQR). Each has a hand twin that **Copy as numbers** makes.

To add one: an entry in `CONTROLLERS` with `label`, `summary`, `params` and `make(params, Ts)` returning `{ step(inputs) → u }` (a designed type adds the fields in designs.md); a sentence in `ABOUT` in `src/ui/controller.js`; a test.

## The tab

Four columns: the block (which one, if several; Inputs, Ts; what feeds each input), the **variants** (click one to run it, double-click to rename, Duplicate, Delete; a designed one is marked "computed", or "! no design" when its design was refused), the running variant's **parameters** (typed with SI prefixes, vectors comma-separated and their entries named; the wheel nudges a number by 5 %, Shift 1 %, or the entry under the caret in a focused list, and the display follows at once) with, for a designed variant, the read-only **Computed** box and **Copy as numbers**, and the **library** in two groups, From the plant and By hand (adds a variant that keeps the actuator limits and gets one gain or weight per measurement).

Comparing: the run before a change stays faded on the display for five runs, so flipping a variant or turning a parameter shows old against new.

## Not yet

- Variants that are diagrams (freeform controllers built from blocks); MIMO outputs.
- Auto-tune over parameters and variants, with goals for following r and rejecting d.
