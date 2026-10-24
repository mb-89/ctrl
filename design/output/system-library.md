# System library

Reader: whoever adds an example system or changes how systems load.

**A system is a complete example: its input signals, its plant (diagram, with any Controller blocks and their variants) and its views. It loads whole or by part, so the input of one system can drive the plant of another.** (The person, 2026-10-24: "call them system library".)

**Few systems, each one working and moving, each 5 s long** (the person: "so it doesn't overwhelm"). Controlled systems grow in difficulty (the person asked for 2–3 with "increasing complexity of controllers", and a triple pendulum for the complex one):

| System | Input | Controller variants (first one runs) | What you see |
|---|---|---|---|
| Mass–spring–damper | F: 1 N step | none | The hanging mass drops 40 mm and swings at 0.8 Hz; energy bars |
| DC motor, position control | r: 0 ↔ 2 rad every 1.25 s; d: load torque at 3.2 s | P too aggressive · PD · PID with prefilter · Off | The shaft overshoots and rings (the person asked for a "not that good" controller); flip to see it settle |
| Conical tank, gain scheduling | r: 0.15 → 0.45 → 0.8 m; d: water drawn off at 2.2 s | Gain-scheduled PI · PI tuned for full · PI tuned for empty · Off | The level climbs; a fixed PI oscillates when nearly empty or crawls when full |
| Pendulum swing-up | d: 4 N push at 3.5 s | Swing-up + state feedback · State feedback only · Off | Energy pumping (Lyapunov) swings the pole up from hanging, then state feedback holds it |
| Triple pendulum | r: cart to 0.5 m at 2.5 s; d: 4 N push at 1 s | LQR · LQR gentle · Off | Three rods held upright on a moving cart; the force arrow is the control effort |
| HIL: external motor | r: 0 ↔ 1.5 rad every 2.5 s; d: 0.1 N·m load torque at 3.6 s | P, untuned · PD · PID with prefilter · Off | The plant is `hil/hil_plant.py`, outside the page ([hil.md](hil.md)): a motor swinging an unbalanced arm. Offline it reads 0; connected, the P leaves the arm short of r (gravity), PD less so, the PID holds it |

- **Tags** (the person, 2026-10-24): each system shows coloured tags in the System library: linear or nonlinear, dead time, its controller and observer types, a disturbance, frequency views, HIL, auto-tune. They are derived from the system itself (`systemTags` in `src/core/systems.js`); an entry may add its own. Values that differ look different at a glance (the person): the style says what a tag is about (plant: a filled chip; controller: a coloured bar; observer: an outline; feature: a dot; *No controller*: an empty dashed chip) and the tone which value it is, the same on every card. Linear and Nonlinear take the cool and warm poles (blue, red). Tones come from an eight-slot palette validated for colour-vision deficiency on both themes' panels; the label is always shown, and a key under the popover's heading names the five styles.
- **Physics is never wrong** (the person: "the control loops can be stupid, but the physics can't be wrong"). A bad controller may do strange things, but only what the real system would do: `test/physics.test.mjs` holds each physics block to conservation laws (energy, horizontal momentum, water volume) and textbook results (the hanging pole's frequency, a pole trailing at atan(a/g) under constant push), and the pictures draw the state as it is, without clamping. The cart runs on an endless rail, as in the model, so a runaway cart leaves the picture; the tank overflows at its height.
- **Following a sine (XY)** (XY demo): the DC motor follows a slow sine (0.2 Hz, one period per sweep); the scope opens in XY with Δ, error over reference. P: a wide ellipse (the error leads r by a quarter period); PD: a smaller one; PID: a thin tilted line (the integral turns the error against r). The motor diagram and picture are shared with *DC motor, position control* (`motorDiagram`, `motorViews` in `plants.js`).
- **Encoder errors and torque ripple** (FFT and spectrogram demo): a speed-controlled motor sweeping to 300 rad/s, an encoder with 1× and 2× angle errors, 6× torque ripple; opens in Spectrogram mode on the measured speed.
- **Signals are named for what they are** (F in N, x in m, θ in rad, …). Controlled systems have a reference **r** and a disturbance **d**, so both following and rejection can be tuned (the person).
- **The page opens the Mass–spring–damper**, running, on its view. **Loading a system shows it running**: a whole load takes the title, scope channels and `ui` (run, Plant tab, its view, setup area at 42 %).
- **Header, "System library ▾"**: every system, with Load and one button per part. **Plant tab, "System library" group**: a click loads the plant only.
- Entries live in `src/core/plants.js`; v1's closed-loop examples stay in `src/core/examples.js` for the CLI.

## How the controllers were designed

- Motor: P with Kp = 30 V/rad against 12 V limits rings; PD (Kp 20, Kd 1.5) is damped near ζ = 0.65; the PID adds Ki 10 and a 0.1 s prefilter.
- Tank: linearised at level h, the tank is (1/A(h)) / (s + 1/τ(h)) with τ = 2A√h / (a√(2g)). A PI by pole cancellation for a 0.25 s closed loop gives Kp = A(h)/0.25, Ki = a√(2g) / (2√h · 0.25); the scheduled PI tabulates these at 0.1 … 1 m; the fixed ones use h = 0.8 and h = 0.15. A 0.1 s pipe dead time makes the too-strong one oscillate. u0 starts the loop balanced.
- Pendulums: discrete LQR (Ts = 10 ms) at the upright rest, from a numerical linearisation of the physics block and the Riccati iteration; Q weighs cart 10, angles 50–100, rates 1; R = 0.1 (gentle: 1). The swing-up gains (kE 3, kx 8, kv 5, catch below 0.4 rad, ±25 N) were found by simulation: up in about 2 s, cart within ±1.2 m.
- Each is checked in `test/core.test.mjs`.
- HIL motor: gains by hand against the script's physics (R 2 Ω, L 4 mH, k 0.1 N·m/A, J 2.5·10⁻³ kg·m², unbalance m g l 0.1 N·m, Coulomb friction 0.01 N·m): P with Kp 2 is slow and holding the arm up needs 2 V that it only gets from an error; PD (Kp 6, Kd 0.6) is fast with a smaller offset; the PID (Kp 10, Ki 20, Kd 0.6, Tr 0.1 s) settles on r. `test/live.test.mjs` checks that the script describes exactly the ports the system's External plant block has. It opens with the setup area at 36 %, since Live adds a row to Run Control.

To add a system: add it to `plants.js` (name, notes, `signals`, `scope`, `ui`, `diagram`, `views`); it must move visibly with its own input within 5 s, and a test checks its behaviour.
