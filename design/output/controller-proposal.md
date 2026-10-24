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
| `pid` | Kp(b·r − y) + Ki∫e − Kd·ẏ filtered (Tf), on the prefiltered rf (Tr, the Vorfilter); reference feedforward Kff, Kv, Ka; limits with switchable anti-windup (clamping, back-calculation, off); start output u0 | Most loops |
| `stateFeedback` | u = kr·r − K·y, one gain per measured state; kr is the static prefilter; optional Tr | Matrix controllers (Zustandsregler), LQR, pole placement |
| `gainScheduled` | PI with Kp, Ki interpolated from a table over the measurement; the PID's prefilter, feedforward and anti-windup | Plants whose dynamics change with the operating point |
| `swingUp` | Far from upright, u = kE·E·ω·cos θ (V = ½E² falls: a Lyapunov design) with cart centring; near upright, state feedback | Swinging a pendulum up and catching it |
| `relay` | u = u0 ± d by the sign of e, switching when e passes ±ε (hysteresis); a negative d reverses it | On/off control (a thermostat); Auto-tune's relay experiment |

To add one: an entry in `CONTROLLERS` with `label`, `summary`, `params` and `make(params, Ts)` returning `{ step(inputs) → u }`; a sentence in `ABOUT` in `src/ui/controller.js`; a test.

## The tab

Four columns: the block (which one, if several; Inputs, Ts; what feeds each input), the **variants** (click one to run it, double-click to rename, Duplicate, Delete), the running variant's **parameters** (typed with SI prefixes, vectors comma-separated; the wheel nudges a number by 5 %, Shift 1 %, and the display follows at once), and the **library** (adds a variant that keeps the actuator limits and gets one gain per measurement).

Comparing: the run before a change stays faded on the display for five runs, so flipping a variant or turning a parameter shows old against new.

**What it does**: under the variant list, a small block diagram of the running variant, drawn from its type with its live values on the blocks; it follows every parameter change. A path whose gain is 0, or a part that is off (no prefilter, no limits), is drawn faint. Hovering a block says what it is; a click shows the diagram large (Esc closes it). Per type: the PID's reference path (prefilter Tr, setpoint weight b), the P, I and D paths (D on the measurement, filtered), the feedforward, the summing bar, the limits and u, and its anti-windup as set (clamping: a dashed line from the limits to the integral; back-calculation: the (u − v) loop through 1/Tt; off: a warning); the scheduled PI with its table over y; state feedback with kr and one row K1 … Km per measurement, named by what feeds it; the swing-up's pump and catch with the switch between them and its condition; the relay's hysteresis; off; and for Observer blocks predict and correct (Kalman, Luenberger) or the finite difference. The description is a pure module (`src/core/structure.js`, tested in Node: every type has a picture inside its canvas, with its values); `src/ui/ctldiagram.js` draws it as inline SVG in the theme's colours. A type without its own layout gets one block with its summary. Interpretation: the person asked for "a small diagram of what the controller does in the corner that's still open"; that corner is the empty space under the variant list, and a fixed layout per type reads better at that size than an automatic one.

## The standard controller: reference path, feedforward, anti-windup

The person: "nobody that does serious control theory does it without feed forward. So our controllers need to support it", and anti-windup "needs to be in", switchable so one badly tuned example can turn it off ([input](../input/2026-10-24-10-sliding-mode-and-triple-swingup.md)). The PID and the gain-scheduled PI have both; every new parameter defaults to what ran before (feedforward 0, clamping), so existing projects behave the same.

**What industrial controllers offer** (checked briefly): process PIDs take a feedforward value that is summed into the output after the PID terms, inside the output limits (Rockwell's PIDE has an FF input of that kind, and WindupHIn/LIn to stop the output at a limit). Servo drives and motion controllers add, in the position loop, a velocity feedforward (the commanded profile's speed times a gain) and an acceleration feedforward (its acceleration times a gain, an inertia estimate), computed from the command, not from the error; they cut the following error without raising the loop gains and do not change stability (Machine Design, "20 minute tune-up: Forward march"; Power Motion, "Feedforward compensates for servo-loop errors"). Disturbance feedforward (from a measured disturbance) is out of scope here.

The law, at each sample, on the prefiltered reference rf and the measurement y (`pidCore` in `src/core/controllers.js`):

| Part | Term | What it does |
|---|---|---|
| Prefilter **Tr** | rf: r through a first-order lag Tr (0: rf = r) | Smooths reference jumps before the controller sees them (the Vorfilter). It changes what is asked, not the loop |
| Setpoint weight **b** | P = Kp·(b·rf − y) | How much of r the P part sees (two degrees of freedom): b < 1 softens the answer to a step of r without changing how the loop rejects disturbances |
| I | Ki·∫(rf − y), from u0 | Removes what is left |
| D | −Kd·dy/dt through a lag Tf | Damps; on the measurement, so a step of r gives no kick |
| Static feedforward **Kff** | + Kff·rf | The input that holds y at r, per unit of r: for a plant with a steady gain K, Kff = 1/K |
| Velocity feedforward **Kv** | + Kv·drf/dt | What following a moving reference takes: for the motor, the voltage per rad/s of speed |
| Acceleration feedforward **Ka** | + Ka·d²rf/dt² | What accelerating takes: inertia |
| Limits, anti-windup | v = P + I + D + FF; u = v held to [umin, umax] | See below |

- The derivatives of rf are differences over Ts. Before the first sample rf is taken to have rested at its first value, so the first sample puts out no kick; a reference that then starts moving does kick (it really accelerates). Through the prefilter a step of r reaches the velocity and acceleration terms smoothly.
- **Why b is not feedforward**: b scales the reference inside the P term, so what it adds, Kp(b − 1)·r, is tied to the feedback gain and is used to soften the answer to r. Feedforward supplies, from r alone, the input the plant needs to follow r (its inverse), independent of the feedback gains. With b = 1 and no feedforward the controller only acts on the error, so it can act only after an error has appeared; feedforward acts as r changes.
- **Feedforward and the parts on y**: when y follows r exactly, the D part still brakes (−Kd·ṙ) and P still puts out Kp(b − 1)·r. A feedforward that removes the following error therefore adds them back: Kv = the plant's need + Kd, Kff = the plant's need + Kp(1 − b). In *Following a sine (XY)* the motor needs 0.7 V per rad/s and Kd is 1: Kv = 1.7, set by hand, lays the figure flat (σ about 21 times smaller than the PID's once the start-up has died away; slope −0.0003 instead of −0.028).
- **Anti-windup** (`aw`), judged on the total output v, feedforward included:
  - **clamping** (conditional integration; the default, as before): while u sits at a limit, the integral stops if the error would push u further.
  - **back-calculation**: dI/dt = Ki·e + (u − v)/Tt, so the integral is pulled back toward the limit with time constant Tt (per sample I moves by the fraction 1 − e^(−Ts/Tt) of the excess, exact for a held excess). **Tt** 0 takes the rule of thumb of Åström and Hägglund, Tt = √(Ti·Td) (between Td and Ti), and Ti/2 for a PI (Td = 0), with Ti = Kp/Ki and Td = Kd/Kp; never below Ts. Interpretation: Ti/2 for a PI is our choice inside the range the rule asks for. After the error reverses, the output leaves the limit Tt·ln 2 later (a test).
  - **off**: the integral runs on (windup). *Oven, badly tuned* has the same gains with it off: the heater stays full on past r and the first step overshoots to 67 °C instead of 52 °C (69 % instead of 29 %).
  - Without a Ki there is no integral and nothing to wind up. Clamping now compares the direction of Ki·e (not e) with the limit, so a reverse-acting PID (negative gains) clamps the right way.
- **The linear model** (`linear(p, Ts, at)`, for the Analysis tab): the feedforward is in r's column, with the states it needs (r one and two samples back, only when Kv or Ka is not 0); the prefilter stays outside, as before. Anti-windup acts only at a limit, where the model does not hold, so it is not in the model. `test/analysis.test.mjs` checks the model against `step()` sample by sample, feedforward included.
- **Auto-tune** keeps a tuned PID's feedforward and anti-windup, and Iterate tunes the feedforward gains ([autotune.md](autotune.md)).
- **Follow-up**: a feedforward gain that is really the plant's inverse (Kff = 1/K, Kv from the plant's speed gain) should be computed from the plant the block sees by the design layer ([designs-in-the-page.md](designs-in-the-page.md), follow-up). Until then the examples' feedforward gains are hand-set tuning inputs.

## Not yet

- Variants that are diagrams (freeform controllers built from blocks); MIMO outputs. The person: "for now it's okay if we don't have configurable controllers".
- Disturbance feedforward (from a measured disturbance); a feedforward computed from the plant (see above).
- Auto-tune over a block's parameters is built ([autotune.md](autotune.md)); flipping through its variants is not.
