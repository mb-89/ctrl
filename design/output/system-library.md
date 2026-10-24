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
| Oven, badly tuned | r: 0 → 40 → 60 °C; d: 25 % heat lost while the door is open, 3.6–4.4 s | PID, badly tuned | Made for the Auto-tune tab, where it opens: the temperature overshoots and rings until the tab tunes it |

- **Signals are named for what they are** (F in N, x in m, θ in rad, …). Controlled systems have a reference **r** and a disturbance **d**, so both following and rejection can be tuned (the person).
- **The page opens the Mass–spring–damper**, running, on its view. **Loading a system shows it running**: a whole load takes the title, scope channels and `ui` (run, Plant tab, its view, setup area at 42 %).
- **Header, "System library ▾"**: every system, with Load and one button per part. **Plant tab, "System library" group**: a click loads the plant only.
- Entries live in `src/core/plants.js`; v1's closed-loop examples stay in `src/core/examples.js` for the CLI.

## How the controllers were designed

- Motor: P with Kp = 30 V/rad against 12 V limits rings; PD (Kp 20, Kd 1.5) is damped near ζ = 0.65; the PID adds Ki 10 and a 0.1 s prefilter.
- Tank: linearised at level h, the tank is (1/A(h)) / (s + 1/τ(h)) with τ = 2A√h / (a√(2g)). A PI by pole cancellation for a 0.25 s closed loop gives Kp = A(h)/0.25, Ki = a√(2g) / (2√h · 0.25); the scheduled PI tabulates these at 0.1 … 1 m; the fixed ones use h = 0.8 and h = 0.15. A 0.1 s pipe dead time makes the too-strong one oscillate. u0 starts the loop balanced.
- Pendulums: discrete LQR (Ts = 10 ms) at the upright rest, from a numerical linearisation of the physics block and the Riccati iteration; Q weighs cart 10, angles 50–100, rates 1; R = 0.1 (gentle: 1). The swing-up gains (kE 3, kx 8, kv 5, catch below 0.4 rad, ±25 N) were found by simulation: up in about 2 s, cart within ±1.2 m.
- Oven: heater (lag 0.1 s), chamber (1 °C per %, lag 0.5 s), 0.1 s dead time to the sensor, thermocouple (lag 0.05 s); heater 0–100 %, Ts 20 ms. Its PID (Kp 6, Ki 12, Kd 0.1) is hand-picked to be poor (42 % overshoot); the Auto-tune tab computes better gains from the plant, nothing is stored ([autotune.md](autotune.md)).
- Each is checked in `test/core.test.mjs` (the oven in `test/autotune.test.mjs`).

To add a system: add it to `plants.js` (name, notes, `signals`, `scope`, `ui`, `diagram`, `views`); it must move visibly with its own input within 5 s, and a test checks its behaviour.
