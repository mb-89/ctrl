# System library

Reader: whoever adds an example system or changes how systems load.

**A system is a complete example: its input signals, its plant (diagram, with any Controller blocks and their variants) and its views. It loads whole or by part, so the input of one system can drive the plant of another.** (The person, 2026-10-24: "call them system library".)

**Few systems, each one working and moving, each 5 s long** (the person: "so it doesn't overwhelm"). Controlled systems grow in difficulty (the person asked for 2–3 with "increasing complexity of controllers", and a triple pendulum for the complex one):

| System | Input | Controller variants (first one runs) | What you see |
|---|---|---|---|
| Mass–spring–damper | F: 1 N step | none | The hanging mass drops 40 mm and swings at 0.8 Hz; energy bars |
| DC motor, position control | r: 0 ↔ 2 rad every 1.25 s; d: load torque at 3.2 s | P too aggressive · PD · PID with prefilter · Off | The shaft overshoots and rings (the person asked for a "not that good" controller); flip to see it settle |
| Conical tank, gain scheduling | r: 0.15 → 0.45 → 0.8 m; d: water drawn off at 2.2 s | Gain-scheduled PI · PI tuned for full · PI tuned for empty · Off (all three PIs computed from the tank) | The level climbs; the PI tuned for full rings at the low levels (it rests in balance at 0.15 m until the step at 1.5 s kicks it), the one tuned for empty overshoots when full |
| Pendulum swing-up | d: 4 N push at 3.5 s | Swing-up + LQR catch · LQR only · Off | Energy pumping (Lyapunov) swings the pole up from hanging, then LQR, computed from the cart and pole, holds it |
| Triple pendulum | d: 4 N push at 3.5 s | Planned swing-up + TV-LQR · LQR only (cannot swing up) · Off (both computed from the cart and rods) | Three rods hang below the cart (the person: it "starts hanging and needs to be put up"). A force planned in the page from the cart and rods brings all three up in 2.4 s, time-varying LQR keeps them on the plan, LQR holds them and takes the push. "LQR only" shows that a controller for the top alone tumbles |

- **Tags** (the person, 2026-10-24): each system shows coloured tags in the System library: linear or nonlinear, dead time, its controller and observer types, a disturbance, frequency views, HIL, auto-tune. They are derived from the system itself (`systemTags` in `src/core/systems.js`); an entry may add its own. Colours by kind: plant teal, controller blue, observer purple, signal magenta, feature amber.
- **Encoder errors and torque ripple** (FFT and spectrogram demo): a speed-controlled motor sweeping to 300 rad/s, an encoder with 1× and 2× angle errors, 6× torque ripple; opens in Spectrogram mode on the measured speed.
- **Signals are named for what they are** (F in N, x in m, θ in rad, …). Controlled systems have a reference **r** and a disturbance **d**, so both following and rejection can be tuned (the person).
- **The page opens the Mass–spring–damper**, running, on its view. **Loading a system shows it running**: a whole load takes the title, scope channels and `ui` (run, Plant tab, its view, setup area at 42 %).
- **Header, "System library ▾"**: every system, with Load and one button per part. **Plant tab, "System library" group**: a click loads the plant only.
- Entries live in `src/core/plants.js`; v1's closed-loop examples stay in `src/core/examples.js` for the CLI.

## What each design computes in the page

The library holds design **inputs** only: physics, hand gains, and the weights, levels and limits of designed variants. Every gain, table and start value a designed variant runs on is computed in the page from the plant as it is wired, every time the diagram compiles (cached in memory), so changing a mass or a radius changes the gains with it ([designs.md](designs.md); the person, [input 09](../input/2026-10-24-09-analysis-autotune-triple-swingup.md)). The Controller tab shows what was computed, in the **Computed** box under the parameters; **Copy as numbers** turns it into a hand variant.

- **DC motor**: hand gains, no design. P with Kp = 30 V/rad against 12 V limits rings; PD (Kp 20, Kd 1.5) is damped near ζ = 0.65; the PID adds Ki 10 and a 0.1 s prefilter.
- **Encoder example**: a hand PI.
- **Conical tank** (`scheduledPI`; inputs: levels `at`, closed-loop time constant Tcl = 0.25 s, limits 0…3 m³/s): at each level the page trims the tank (the pump flow that holds it), linearises it and fits a first-order lag K/(τs + 1); pole cancellation gives Kp = τ/(K·Tcl), Ki = 1/(K·Tcl). For this tank that is Kp = A(h)/Tcl and Ki = a√(2g)/(2√h·Tcl): Kp 0.113 … 3.14 and Ki 2.80 … 0.886 over 0.1 … 1 m. The fixed PIs are the same design at one level (0.8 m: Kp 2.112, Ki 0.990; 0.15 m: Kp 0.173, Ki 2.287). u0, the flow that holds the start level 0.15 m, is a√(2g·0.15) = 0.1716, so every PI starts in exact balance. The pipe's 0.1 s dead time is reported and left out of the design; it is what makes the PI tuned for full ring when the level is low.
- **Pendulum** (`swingUpLqr` and `lqr`; inputs: Q = [10, 50, 1, 1] for x, θ, v, ω, R = 0.1, limits ±25 N): discrete LQR (at the block's Ts, 10 ms) on the cart and pole linearised at the upright rest gives K ≈ [−9.18, −63.2, −10.3, −13.3] and kr = K[0], so x follows r. The swing-up's energy pump keeps its hand gains (kE 3, kx 8, kv 5, catch below 0.4 rad), found by simulation: up in about 2 s, cart within ±1.2 m.
- **Triple pendulum** (`trajectory` and `lqr`; Q = [10, 100, 100, 100, 1, 1, 1, 1], R = 0.1, limits ±40 N; the plan: T = 2.4 s, 12 segments, 75 % of the limit): when the system loads the page plans the swing-up from the cart and rods as they are wired (`planner.js`, about 3 s in Node, longer in a browser): a force held per 10 ms sample that takes the chain from hanging to rest upright with the cart back at 0, peak about 15 N of the 30 N it may use. Along it, time-varying LQR (the Riccati recursion backwards from the upright LQR) corrects small errors; after it, the upright LQR (the same gains as "LQR only") holds the rods and takes the push. A check on the nonlinear plant confirms the rods are up 1 s after the plan before it is used; a plan that fails still runs, with a warning, so the attempt can be seen. Nothing of the plan is stored: changing a mass plans again.
- Each design is checked against the closed-form values and the gains the library used to hold in `test/design.test.mjs`; the behaviour of every system in `test/core.test.mjs`. A guard test refuses stored gain tables, start outputs and pipe start flows in the library.

To add a system: add it to `plants.js` (name, notes, `signals`, `scope`, `ui`, `diagram`, `views`); it must move visibly with its own input within 5 s, and a test checks its behaviour.
