# Tab 3: the Controller

Reader: whoever changes controllers, their library or the Controller tab. **Status: built 2026-10-24** (decided with the person the same day; their words in [../input/2026-10-24-08-controllers-and-5-seconds.md](../input/2026-10-24-08-controllers-and-5-seconds.md)).

**The controller is a block in the plant diagram, and a block holds several interchangeable implementations (variants, as Simulink's variant subsystems).** All variants of a block have the same interface, so flipping between them changes nothing else; Auto-tune will search their parameters and flip through them.

## The Controller block

- Inputs: r first, then the measurements, as many as the block's **Inputs** (default 2: r and y). Output: u.
- Digital: every variant runs at the block's **sample time Ts** and holds u between samples (zero-order hold). Several Controller blocks may have different Ts. **A controller samples exactly at k·Ts, whatever the scope's record step**: the integration step divides the greatest common divisor of the record step and every Ts (in whole nanoseconds), so every sample instant lies on the grid (`substeps` in `src/core/sim.js`; before, a 1 ms controller at a 2.5 ms record sampled at 0, 1.667, 2.5, 3.333 … ms). When that would take more steps than the budget, the steps fall back to the stability bound, samples land on the first step after their instant, and the run warns.
- JSON: `{ "type": "controller", "params": { "inputs": 2, "Ts": 0.01 }, "variants": [ { "name": "PD", "type": "pid", "params": { … } } ], "variant": 0 }`. Open actuator limits are saved as `null`.

## The controller library (`src/core/controllers.js`)

| Type | Law | For |
|---|---|---|
| `off` | u = 0 | Seeing the plant on its own |
| `pid` | Kp(b·r − y) + Ki∫e + Kd·ẏ filtered (Tf); prefilter Tr (Vorfilter); limits with anti-windup; start output u0 | Most loops |
| `stateFeedback` | u = kr·r − K·y, one gain per measured state; kr is the static prefilter; optional Tr | Matrix controllers (Zustandsregler), LQR, pole placement |
| `gainScheduled` | PI with Kp, Ki interpolated from a table over the measurement | Plants whose dynamics change with the operating point |
| `swingUp` | Far from upright, u = kE·E·ω·cos θ (V = ½E² falls: a Lyapunov design) with cart centring; near upright, state feedback | Swinging a pendulum up and catching it |
| `relay` | u = u0 ± d by the sign of e, switching when e passes ±ε (hysteresis); a negative d reverses it | On/off control (a thermostat); Auto-tune's relay experiment |
| `slidingMode` | Inputs r, y, ẏ. s = λ·e + ė with e = rf − y, ė = ṙf − ẏ (ṙf = (r − rf)/Tr, the prefilter's own derivative; 0 without one); u = u0 + K·sign(s) (φ = 0, the relay) or u0 + K·sat(s/φ) (φ > 0, a boundary layer), clamped. λ in 1/s, K in u (negative for a plant whose y falls when u rises), φ in y's unit per second. A block with fewer than 3 inputs is refused ("sliding mode needs ẏ on input 3; … place a Finite difference observer"): the law never differentiates. Linear only with φ > 0: a PD, D = [[K·λ/φ, −K·λ/φ, −K/φ]] on [r, y, ẏ]; φ = 0 has no linear model | Robust position or speed loops on an actuator that is a switch; on a continuous one, the layer. On the line the error decays as e^(−λt) whatever the inertia or a load entering with u: λ sets the error's time constant. *DC motor, sliding mode* |
| `superTwisting` | Inputs r, y, ẏ; the same s. u = k1·√\|s\|·sign(s) + v, v += Ts·k2·sign(s) (explicit Euler), both clamped to the limits (v's clamp is the anti-windup); u0 starts v. No linear model (√\|s\| has infinite slope at 0) | A continuous voltage that rejects a constant load (v integrates sign(s)), in finite time; with actuator dynamics it keeps a small ripple, and a long reaching phase winds v up so s overshoots the line |

To add one: an entry in `CONTROLLERS` with `label`, `summary`, `params` and `make(params, Ts)` returning `{ step(inputs) → u }`; a sentence in `ABOUT` in `src/ui/controller.js`; a test. A `check(params, ctx)` may refuse a variant; `ctx.inputs` is the block's input count when the variant sits in a block (the sliding-mode laws refuse fewer than 3). Its tag in the System library: `VARIANT_TAGS` in `src/core/systems.js`; Auto-tune's knobs: `tuningSpace` in `src/core/autotune.js` (for the sliding modes: λ, K and φ when φ > 0, so a relay stays a relay; λ, k1 and k2).

The sliding-mode gains in the library are design inputs (λ, φ, the limits) and hand gains (K, k1, k2: K equals the limit; k1 and k2 started from Levant's rule of thumb k1 = 1.5√L/β, k2 = 1.1L/β with a guessed L = 1000 rad/s³ at the nominal β, 1.9 and 44; then k1 raised to 4 by simulation, since 1.9 overshoots the step by 17.8 % with a tripled inertia; 6 would also remove the line overshoot there but costs more ripple); no formula is stored, none runs in the page ([sliding-mode.md](../research/sliding-mode.md)). A model-based law (equivalent control) and the implicit super-twisting law need plant values, so they wait for the design layer as designed twins.

## The tab

Four columns: the block (which one, if several; Inputs, Ts; what feeds each input), the **variants** (click one to run it, double-click to rename, Duplicate, Delete), the running variant's **parameters** (typed with SI prefixes, vectors comma-separated; the wheel nudges a number by 5 %, Shift 1 %, and the display follows at once), and the **library** (adds a variant that keeps the actuator limits and gets one gain per measurement).

Comparing: the run before a change stays faded on the display for five runs, so flipping a variant or turning a parameter shows old against new.

## Not yet

- Variants that are diagrams (freeform controllers built from blocks); MIMO outputs.
- Auto-tune over a block's parameters is built ([autotune.md](autotune.md)); flipping through its variants is not.
