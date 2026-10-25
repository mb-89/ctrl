# Benchmark prototype: the output

Reader: whoever checks the numbers [../output/benchmark.md](../output/benchmark.md) quotes. Generated, not hand-written: `node tools/benchmark-prototype.mjs` (the three systems), then `node tools/benchmark-prototype.mjs "Pendulum swing-up" "DC motor, position" "Triple" "Following a sine" "Encoder errors" "DC motor, speed" "DC motor with an unbalanced"` (the rest of the library: cost, and the limits), on main at the time of writing, in this container (Node 22). Timings vary by machine; the matrices are deterministic.

Goal: {"cost":"IAE","effort":0.05,"overshoot":10,"saturation":0.2}; Iterate up to 60 iterations; sweep 8 plants within ±15 %. Node v22.22.0.

## DC motor, sliding mode

Step test for the starts: integrating. Total 21.5 s: load 0.0733 s, starts 0.42 s, tuning 17.6 s, scoring 0.846 s, sweep (8 plants) 2.37 s. One run 38 ms, so about 564 runs' worth.

Refused:

- Off (`off`): does nothing: the open loop, not a candidate
- LQR (`lqr`): LQR needs every state measured. This block sees angle, rotor 1/(Js + b) but not Motor/armature 1/(Ls + R).
- State feedback (`stateFeedback`): starts from the LQR design, which refused: LQR needs every state measured. This block sees angle, rotor 1/(Js + b) but not Motor/armature 1/(Ls + R).
- PI from the plant (`scheduledPI`): angle integrates V: it has no static gain
- Swing-up (Lyapunov) + state feedback (`swingUp`): reads x, θ, v, ω of a pendulum on a cart (4 measurements); this block measures 2
- Swing-up + LQR catch (`swingUpLqr`): the swing-up reads x, θ, v, ω (θ an angle) from inputs 2 to 5; this block has angle, speed (Motor)
- Planned swing-up + TV-LQR (`trajectory`): LQR needs every state measured. This block sees angle, rotor 1/(Js + b) but not Motor/armature 1/(Ls + R).

Candidates (J: the goal's cost, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: Relay (theory) | not tuned | 0.302 | 0 | 0 | yes |
| PID | step test, SIMC (integrating) | 0.206 → 0.0767 | 115 | 4500 | yes |
| Gain-scheduled PI | the PID's gains, flat | 2.34 → 0.125 | 92 | 3700 | yes |
| PID + feedforward from the plant | the PID row's gains; Kff, Kv, Ka from the plant; Tr searched → 0.0155 | 0.0773 → 0.0766 | 15 | 930 | yes |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 2.64 → 2.64 | 1 | 37 | yes |
| Sliding mode (ideal) | λ from the step model, K the full swing | 0.595 → 0.26 | 38 | 1700 | yes |
| Sliding mode (boundary layer) | and φ = 0.2·λ·span r | 0.551 → 0.0757 | 57 | 2300 | yes |
| Super-twisting | λ as the sliding mode; k1 = U/3, k2 = 3.7 U | 0.869 → 0.0654 | 115 | 4500 | yes |

Scores:

| Candidate | Following r (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: Relay (theory) | 0.13 | 0.0048 | 0.095 % | 0.42 | 0.49 | 120 | 0.95 | no linear model | 0.31 | 0.69 | 4 | 0 | — | — |
| PID | 0.077 | 0.015 | 0.39 % | 0.19 | 0.14 | 1.8 | 0.06 | 2.1 | 0.089 | 0.098 | 4 | 120 | 34 | 11 ms |
| Gain-scheduled PI | 0.12 | 0.15 | 10 % | 0.41 | 0.084 | 0.6 | 0 | 1.4 | 0.9 | 0.0016 | 6 | 92 | 58 | 100 ms |
| PID + feedforward from the plant | 0.077 | 0.015 | 0.37 % | 0.19 | 0.14 | 1.8 | 0.059 | 2.1 | 0.11 | 0.098 | 9 | 15 | 34 | 11 ms |
| Relay (on/off) | 0.23 | 0.16 | 39 % | 0.99 | 0.5 | 12 | 1 | no linear model | 3.4 | 0.78 | 2 | 1 | — | — |
| Sliding mode (ideal) | 0.074 | 0.0012 | 0.19 % | 0.12 | 0.49 | 86 | 0.95 | no linear model | 0.28 | 0.65 | 4 | 38 | — | — |
| Sliding mode (boundary layer) | 0.076 | 0.013 | 0.2 % | 0.13 | 0.14 | 1.6 | 0.06 | 1.6 | 0.087 | 0.017 | 5 | 57 | 43 | 13 ms |
| Super-twisting | 0.081 | 0.0026 | 2.7 % | 0.18 | 0.12 | 4.2 | 0 | no linear model | 0.29 | 0.047 | 5 | 120 | — | — |

Pugh matrix, round 1: datum **PID**; weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: Relay (theory) | PID | Gain-scheduled PI | PID + feedforward from the plant | Relay (on/off) | Sliding mode (ideal) | Sliding mode (boundary layer) | Super-twisting |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Following r (IAE) (3) | − | D | − | S | − | S | S | S |
| Rejecting d (IAE) (3) | + | D | − | S | − | + | + | + |
| Overshoot (2) | S | D | − | S | − | S | S | − |
| Settling (2 %, s) (1) | − | D | − | S | − | + | + | S |
| Effort (u swing) (1) | − | D | + | S | − | − | S | S |
| Wear (u travel/s) (2) | − | D | + | S | − | − | S | − |
| Time at a limit (1) | − | D | + | S | − | − | S | + |
| Robustness Ms (2) | ? | D | + | S | ? | ? | + | ? |
| Plant ±15 % (worst J) (3) | − | D | − | − | − | − | S | − |
| Noise → u (2) | − | D | + | S | − | − | + | + |
| Complexity (1) | S | D | − | − | + | S | − | − |
| Tuning runs (1) | + | D | S | + | + | + | + | S |
| **+ / −** | 2 / 7 | datum | 5 / 6 | 1 / 2 | 2 / 9 | 3 / 5 | 5 / 1 | 3 / 4 |
| **Weighted** | -9 | 0 | -5 | -3 | -16 | -4 | 8 | -2 |
| **Fits** | yes | yes | yes | yes | yes | yes | yes | yes |

Ranking (fitting only): 1. Sliding mode (boundary layer) (+8); 2. PID (+0); 3. Super-twisting (-2); 4. PID + feedforward from the plant (-3); 5. Sliding mode (ideal) (-4); 6. Gain-scheduled PI (-5); 7. As loaded: Relay (theory) (-9); 8. Relay (on/off) (-16).

Pugh matrix, round 2: datum **Sliding mode (boundary layer)** (round 1's winner); weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: Relay (theory) | PID | Gain-scheduled PI | PID + feedforward from the plant | Relay (on/off) | Sliding mode (ideal) | Sliding mode (boundary layer) | Super-twisting |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Following r (IAE) (3) | − | S | − | S | − | S | D | S |
| Rejecting d (IAE) (3) | + | − | − | − | − | + | D | + |
| Overshoot (2) | S | S | − | S | − | S | D | − |
| Settling (2 %, s) (1) | − | − | − | − | − | S | D | − |
| Effort (u swing) (1) | − | S | + | S | − | − | D | S |
| Wear (u travel/s) (2) | − | S | + | S | − | − | D | − |
| Time at a limit (1) | − | S | + | S | − | − | D | + |
| Robustness Ms (2) | ? | − | + | − | ? | ? | D | ? |
| Plant ±15 % (worst J) (3) | − | S | − | − | − | − | D | − |
| Noise → u (2) | − | − | + | − | − | − | D | − |
| Complexity (1) | + | + | − | − | + | + | D | S |
| Tuning runs (1) | + | − | − | + | + | S | D | − |
| **+ / −** | 3 / 7 | 1 / 5 | 5 / 7 | 1 / 6 | 2 / 9 | 2 / 5 | datum | 2 / 6 |
| **Weighted** | -8 | -8 | -6 | -11 | -16 | -5 | 0 | -7 |
| **Fits** | yes | yes | yes | yes | yes | yes | yes | yes |

Ranking (fitting only): 1. Sliding mode (boundary layer) (+0); 2. Sliding mode (ideal) (-5); 3. Gain-scheduled PI (-6); 4. Super-twisting (-7); 5. PID (-8); 6. As loaded: Relay (theory) (-8); 7. PID + feedforward from the plant (-11); 8. Relay (on/off) (-16).

## Oven, badly tuned

Step test for the starts: fopdt. Total 1.2 s: load 0.0139 s, starts 0.0334 s, tuning 0.827 s, scoring 0.0871 s, sweep (8 plants) 0.189 s. One run 5.7 ms, so about 206 runs' worth.

Refused:

- Off (`off`): does nothing: the open loop, not a candidate
- LQR (`lqr`): LQR needs every state measured. This block sees thermocouple but not heater and chamber.
- State feedback (`stateFeedback`): starts from the LQR design, which refused: LQR needs every state measured. This block sees thermocouple but not heater and chamber.
- Swing-up (Lyapunov) + state feedback (`swingUp`): reads x, θ, v, ω of a pendulum on a cart (4 measurements); this block measures 1
- Swing-up + LQR catch (`swingUpLqr`): the swing-up reads x, θ, v, ω (θ an angle) from inputs 2 to 5; this block has thermocouple
- Planned swing-up + TV-LQR (`trajectory`): the swing-up pushes both ways: u min must be below 0 and u max above 0 (now 0 to 100)
- Sliding mode (`slidingMode`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)
- Super-twisting (`superTwisting`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)

Candidates (J: the goal's cost, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: PID, badly tuned | not tuned | 1.28 | 0 | 0 | no: unstable at r's middle (2 poles outside) |
| PID | step test, SIMC (fopdt) | 0.152 → 0.139 | 57 | 270 | yes |
| PI from the plant | one level, r's middle; Tcl searched → 0.435 | 0.836 → 0.14 | 15 | 99 | yes |
| Gain-scheduled PI | PI from the plant at 3 levels | 0.14 → 0.139 | 82 | 350 | yes |
| PID + feedforward from the plant | the PID row's gains; Kff, Kv, Ka from the plant; Tr searched → 0.419 | 0.756 → 0.136 | 15 | 100 | yes |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 1.91 → 1.91 | 1 | 4.1 | yes |

Scores:

| Candidate | Following r (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: PID, badly tuned | 0.18 | 0.13 | 42 % | 1.7 | 0.41 | 2.1 | 0.47 | unstable | 1.7 | 0.036 | 4 | 0 | — | — |
| PID | 0.14 | 0.11 | 10 % | 1.7 | 0.21 | 0.55 | 0.04 | 1.8 | 0.24 | 0.0057 | 3 | 57 | 58 | 360 ms |
| PI from the plant | 0.14 | 0.12 | 9.8 % | 1.7 | 0.2 | 0.49 | 0.04 | 1.7 | 0.26 | 0.0051 | 5 | 15 | 58 | 390 ms |
| Gain-scheduled PI | 0.14 | 0.11 | 9.9 % | 1.7 | 0.21 | 0.54 | 0.04 | 1.8 | 0.24 | 0.0056 | 9 | 82 | 58 | 360 ms |
| PID + feedforward from the plant | 0.14 | 0.11 | 8.2 % | 1.3 | 0.2 | 0.79 | 0.048 | 1.8 | 0.19 | 0.0056 | 9 | 15 | 58 | 360 ms |
| Relay (on/off) | 0.17 | 0.15 | 54 % | 1.7 | 0.49 | 2.4 | 1 | no linear model | 2.3 | 0.53 | 2 | 1 | — | — |

Pugh matrix, round 1: datum **PID**; weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: PID, badly tuned | PID | PI from the plant | Gain-scheduled PI | PID + feedforward from the plant | Relay (on/off) |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Following r (IAE) (3) | − | D | S | S | S | − |
| Rejecting d (IAE) (3) | − | D | S | S | S | − |
| Overshoot (2) | − | D | S | S | S | − |
| Settling (2 %, s) (1) | S | D | S | S | + | S |
| Effort (u swing) (1) | − | D | S | S | S | − |
| Wear (u travel/s) (2) | − | D | S | S | − | − |
| Time at a limit (1) | − | D | S | S | S | − |
| Robustness Ms (2) | ? | D | S | S | S | ? |
| Plant ±15 % (worst J) (3) | − | D | S | S | + | − |
| Noise → u (2) | − | D | S | S | S | − |
| Complexity (1) | − | D | − | − | − | + |
| Tuning runs (1) | + | D | + | S | + | + |
| **+ / −** | 1 / 9 | datum | 1 / 1 | 0 / 1 | 3 / 2 | 2 / 8 |
| **Weighted** | -17 | 0 | 0 | -1 | 2 | -15 |
| **Fits** | no | yes | yes | yes | yes | yes |

Ranking (fitting only): 1. PID + feedforward from the plant (+2); 2. PID (+0); 3. PI from the plant (+0); 4. Gain-scheduled PI (-1); 5. Relay (on/off) (-15).

Pugh matrix, round 2: datum **PID + feedforward from the plant** (round 1's winner); weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: PID, badly tuned | PID | PI from the plant | Gain-scheduled PI | PID + feedforward from the plant | Relay (on/off) |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Following r (IAE) (3) | − | S | S | S | D | − |
| Rejecting d (IAE) (3) | − | S | S | S | D | − |
| Overshoot (2) | − | S | S | S | D | − |
| Settling (2 %, s) (1) | − | − | − | − | D | − |
| Effort (u swing) (1) | − | S | S | S | D | − |
| Wear (u travel/s) (2) | − | + | + | + | D | − |
| Time at a limit (1) | − | S | S | S | D | − |
| Robustness Ms (2) | ? | S | S | S | D | ? |
| Plant ±15 % (worst J) (3) | − | − | − | − | D | − |
| Noise → u (2) | − | S | S | S | D | − |
| Complexity (1) | + | + | + | S | D | + |
| Tuning runs (1) | + | − | S | − | D | + |
| **+ / −** | 2 / 9 | 2 / 3 | 2 / 2 | 1 / 3 | datum | 2 / 9 |
| **Weighted** | -16 | -2 | -1 | -3 | 0 | -16 |
| **Fits** | no | yes | yes | yes | yes | yes |

Ranking (fitting only): 1. PID + feedforward from the plant (+0); 2. PI from the plant (-1); 3. PID (-2); 4. Gain-scheduled PI (-3); 5. Relay (on/off) (-16).

## Conical tank, gain scheduling

Step test for the starts: schedule. Total 1.8 s: load 0.0193 s, starts 0.344 s, tuning 1.12 s, scoring 0.0947 s, sweep (8 plants) 0.204 s. One run 5.5 ms, so about 330 runs' worth.

Refused:

- Off (`off`): does nothing: the open loop, not a candidate
- LQR (`lqr`): LQR needs slopes, and the plant has a kink at origin (all states 0, u = 0): the slope of the rate of tank.h along tank.h differs left and right (0 and -56400)
- State feedback (`stateFeedback`): starts from the LQR design, which refused: LQR needs slopes, and the plant has a kink at origin (all states 0, u = 0): the slope of the rate of tank.h along tank.h differs left and right (0 and -56400)
- PID + feedforward from the plant (`pidFF`): a feedforward from the plant needs slopes, and the plant has a kink at origin (all states 0, u = 0): the slope of the rate of tank.h along tank.h differs left and right (0 and -56400)
- Swing-up (Lyapunov) + state feedback (`swingUp`): reads x, θ, v, ω of a pendulum on a cart (4 measurements); this block measures 1
- Swing-up + LQR catch (`swingUpLqr`): the swing-up reads x, θ, v, ω (θ an angle) from inputs 2 to 5; this block has h
- Planned swing-up + TV-LQR (`trajectory`): the swing-up pushes both ways: u min must be below 0 and u max above 0 (now 0 to 3)
- Sliding mode (`slidingMode`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)
- Super-twisting (`superTwisting`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)

Candidates (J: the goal's cost, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: Gain-scheduled PI | not tuned | 0.0853 | 0 | 0 | yes |
| PID | step test, SIMC at 0.5 (the schedule's middle); no point on the way fits (tuned: unstable where the run starts (2 poles outside)) | 0.0786 → 0.0646 | 78 | 460 | no: unstable where the run starts (2 poles outside); it rests there only because it starts in balance |
| PI from the plant | one level, r's middle; Tcl searched → 0.123; backed off to 0 % of the way (tuned: unstable where the run starts (2 poles outside)) | 0.123 → 0.123 | 19 | 220 | yes |
| Gain-scheduled PI | step tests, a SIMC schedule; backed off to 25 % of the way (tuned: Ms 12) | 0.142 → 0.0822 | 69 | 430 | yes |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 5.08 → 5.08 | 1 | 4.6 | yes |

Scores:

| Candidate | Following r (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: Gain-scheduled PI | 0.12 | 0.1 | 7.7 % | 1.4 | 0.044 | 0.077 | 0 | 1.5 | 0.088 | 0.0017 | 17 | 0 | 64 | 280 ms |
| PID | 0.095 | 0.069 | 10 % | 0.65 | 0.05 | 0.21 | 0 | 2.8 | 0.8 | 0.038 | 4 | 78 | 39 | 79 ms |
| PI from the plant | 0.14 | 0.12 | 11 % | 1.4 | 0.042 | 0.073 | 0 | 1.5 | 0.14 | 0.0011 | 6 | 19 | 65 | 290 ms |
| Gain-scheduled PI | 0.12 | 0.098 | 8.9 % | 1.4 | 0.049 | 0.12 | 0 | 2.5 | 0.093 | 0.0016 | 17 | 69 | 43 | 95 ms |
| Relay (on/off) | 0.22 | 0.56 | 180 % | 1.4 | 0.38 | 3 | 1 | no linear model | 5.1 | 0.53 | 2 | 1 | — | — |

Pugh matrix, round 1: datum **As loaded: Gain-scheduled PI**; weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: Gain-scheduled PI | PID | PI from the plant | Gain-scheduled PI | Relay (on/off) |
|---|:-:|:-:|:-:|:-:|:-:|
| Following r (IAE) (3) | D | + | − | S | − |
| Rejecting d (IAE) (3) | D | + | − | S | − |
| Overshoot (2) | D | − | − | S | − |
| Settling (2 %, s) (1) | D | + | S | S | S |
| Effort (u swing) (1) | D | S | S | S | − |
| Wear (u travel/s) (2) | D | − | S | S | − |
| Time at a limit (1) | D | S | S | S | − |
| Robustness Ms (2) | D | − | S | − | ? |
| Plant ±15 % (worst J) (3) | D | − | − | S | − |
| Noise → u (2) | D | − | S | S | − |
| Complexity (1) | D | + | + | S | + |
| Tuning runs (1) | D | − | − | − | S |
| **+ / −** | datum | 4 / 6 | 1 / 5 | 0 / 2 | 1 / 8 |
| **Weighted** | 0 | -4 | -11 | -3 | -16 |
| **Fits** | yes | no | yes | yes | yes |

Ranking (fitting only): 1. As loaded: Gain-scheduled PI (+0); 2. Gain-scheduled PI (-3); 3. PI from the plant (-11); 4. Relay (on/off) (-16).

Pugh matrix, round 2: datum **As loaded: Gain-scheduled PI** (round 1's winner); weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: Gain-scheduled PI | PID | PI from the plant | Gain-scheduled PI | Relay (on/off) |
|---|:-:|:-:|:-:|:-:|:-:|
| Following r (IAE) (3) | D | + | − | S | − |
| Rejecting d (IAE) (3) | D | + | − | S | − |
| Overshoot (2) | D | − | − | S | − |
| Settling (2 %, s) (1) | D | + | S | S | S |
| Effort (u swing) (1) | D | S | S | S | − |
| Wear (u travel/s) (2) | D | − | S | S | − |
| Time at a limit (1) | D | S | S | S | − |
| Robustness Ms (2) | D | − | S | − | ? |
| Plant ±15 % (worst J) (3) | D | − | − | S | − |
| Noise → u (2) | D | − | S | S | − |
| Complexity (1) | D | + | + | S | + |
| Tuning runs (1) | D | − | − | − | S |
| **+ / −** | datum | 4 / 6 | 1 / 5 | 0 / 2 | 1 / 8 |
| **Weighted** | 0 | -4 | -11 | -3 | -16 |
| **Fits** | yes | no | yes | yes | yes |

Ranking (fitting only): 1. As loaded: Gain-scheduled PI (+0); 2. Gain-scheduled PI (-3); 3. PI from the plant (-11); 4. Relay (on/off) (-16).


# The rest of the library

## Pendulum swing-up

Step test for the starts: relay. Total 3.9 s: load 0.0332 s, starts 0.132 s, tuning 1.55 s, scoring 0.379 s, sweep (8 plants) 1.77 s. One run 6.4 ms, so about 606 runs' worth.

Refused:

- Off (`off`): does nothing: the open loop, not a candidate
- PI from the plant (`scheduledPI`): x integrates F: it has no static gain
- Gain-scheduled PI (`gainScheduled`): r does not move: there is no range to schedule over

Candidates (J: the goal's cost, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: Swing-up + LQR catch | not tuned | 0.193 | 0 | 0 | yes |
| PID | relay test, Tyreus–Luyben; backed off to 50 % of the way (tuned: Ms 2300) | 0.00531 → 5.7e-4 | 113 | 460 | yes |
| LQR | Q = 1 for every measurement; R searched → 1 | 67.4 → 67.4 | 15 | 74 | no: unstable at r's middle (1 poles outside) |
| State feedback | the LQR row's gains; no point on the way fits (tuned: unstable at r's middle (1 poles outside)) | 67.4 → 67.4 | 21 | 110 | no: unstable at r's middle (1 poles outside) |
| PID + feedforward from the plant | the PID row's gains; Kff, Kv, Ka from the plant; Tr searched → 0.25 | 5.7e-4 → 5.7e-4 | 15 | 58 | yes |
| Swing-up (Lyapunov) + state feedback | its defaults (not iterated: A swing-up switches between pumping energy and catching the ) | 6.49 → 6.49 | 1 | 3.6 | yes |
| Swing-up + LQR catch | its defaults | 6.49 → 6.49 | 1 | 4.8 | yes |
| Planned swing-up + TV-LQR | its defaults | 0.106 → 0.106 | 1 | 180 | no: unstable at r's middle (1 poles outside) |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 0.414 → 0.414 | 1 | 6.9 | yes |
| Sliding mode (ideal) | λ from the step model, K the full swing | 7.83 → 0.375 | 26 | 110 | yes |
| Sliding mode (boundary layer) | and φ = 0.2·λ·span r; no point on the way fits (tuned: unstable at r's middle (4 poles outside)) | 2.1 → 0.00745 | 33 | 150 | no: unstable at r's middle (4 poles outside) |
| Super-twisting | λ as the sliding mode; k1 = U/3, k2 = 3.7 U | 3.4 → 0.006 | 125 | 400 | yes |

Scores:

| Candidate | Following r (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: Swing-up + LQR catch | — | 0.024 | 0 % | — | 0.14 | 0.7 | 0.03 | no linear model | 0.28 | 0.054 | 15 | 0 | — | — |
| PID | — | 0.0018 | 0 % | — | 0.016 | 0.079 | 0 | 2.3 | 5.5e-4 | 0.11 | 4 | 110 | 8.8 | 23 ms |
| LQR | — | 150 | 0 % | — | 2.2e-14 | 0 | 1 | unstable | 72 | 0 | 11 | 15 | — | — |
| State feedback | — | 150 | 0 % | — | 2.2e-14 | 0 | 1 | unstable | 72 | 0 | 9 | 21 | — | — |
| PID + feedforward from the plant | — | 0.0018 | 0 % | — | 0.016 | 0.079 | 0 | 2.3 | 0.061 | 0.11 | 10 | 15 | 8.8 | 23 ms |
| Swing-up (Lyapunov) + state feedback | — | 11 | 0 % | — | 0.092 | 0.57 | 0.014 | no linear model | 6.5 | 0.033 | 13 | 1 | — | — |
| Swing-up + LQR catch | — | 11 | 0 % | — | 0.092 | 0.57 | 0.014 | no linear model | 7.3 | 0.033 | 15 | 1 | — | — |
| Planned swing-up + TV-LQR | — | 0.071 | 0 % | — | 0.058 | 0.25 | 0 | unstable | 0.11 | 0.017 | 6 | 1 | — | — |
| Relay (on/off) | — | 0.25 | 0 % | — | 0.5 | 3.4 | 1 | no linear model | 0.51 | 0.69 | 2 | 1 | — | — |
| Sliding mode (ideal) | — | 0.24 | 0 % | — | 0.5 | 3.6 | 1 | no linear model | 0.43 | 0.72 | 4 | 26 | — | — |
| Sliding mode (boundary layer) | — | 0.023 | 0 % | — | 0.035 | 0.19 | 0 | unstable | 0.0073 | 0.047 | 5 | 33 | — | — |
| Super-twisting | — | 0.012 | 0 % | — | 0.021 | 0.18 | 0 | no linear model | 0.011 | 0.052 | 5 | 130 | — | — |

Pugh matrix, round 1: datum **PID**; weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: Swing-up + LQR catch | PID | LQR | State feedback | PID + feedforward from the plant | Swing-up (Lyapunov) + state feedback | Swing-up + LQR catch | Planned swing-up + TV-LQR | Relay (on/off) | Sliding mode (ideal) | Sliding mode (boundary layer) | Super-twisting |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Following r (IAE) (3) | ? | D | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| Rejecting d (IAE) (3) | − | D | − | − | S | − | − | − | − | − | − | − |
| Overshoot (2) | S | D | S | S | S | S | S | S | S | S | S | S |
| Settling (2 %, s) (1) | ? | D | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| Effort (u swing) (1) | − | D | + | + | S | − | − | − | − | − | − | − |
| Wear (u travel/s) (2) | − | D | + | + | S | − | − | − | − | − | − | − |
| Time at a limit (1) | − | D | − | − | S | S | S | S | − | − | S | S |
| Robustness Ms (2) | ? | D | ? | ? | S | ? | ? | ? | ? | ? | ? | ? |
| Plant ±15 % (worst J) (3) | − | D | − | − | − | − | − | − | − | − | − | − |
| Noise → u (2) | + | D | + | + | S | + | + | + | − | − | + | + |
| Complexity (1) | − | D | − | − | − | − | − | − | + | S | − | − |
| Tuning runs (1) | + | D | + | + | + | + | + | + | + | + | + | S |
| **+ / −** | 2 / 6 | datum | 4 / 4 | 4 / 4 | 1 / 2 | 2 / 5 | 2 / 5 | 2 / 5 | 2 / 6 | 1 / 6 | 2 / 5 | 1 / 5 |
| **Weighted** | -8 | 0 | -2 | -2 | -3 | -7 | -7 | -7 | -10 | -11 | -7 | -8 |
| **Fits** | yes | yes | no | no | yes | yes | yes | no | yes | yes | no | yes |

Ranking (fitting only): 1. PID (+0); 2. PID + feedforward from the plant (-3); 3. Swing-up + LQR catch (-7); 4. Swing-up (Lyapunov) + state feedback (-7); 5. Super-twisting (-8); 6. As loaded: Swing-up + LQR catch (-8); 7. Relay (on/off) (-10); 8. Sliding mode (ideal) (-11).

Pugh matrix, round 2: datum **PID** (round 1's winner); weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: Swing-up + LQR catch | PID | LQR | State feedback | PID + feedforward from the plant | Swing-up (Lyapunov) + state feedback | Swing-up + LQR catch | Planned swing-up + TV-LQR | Relay (on/off) | Sliding mode (ideal) | Sliding mode (boundary layer) | Super-twisting |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Following r (IAE) (3) | ? | D | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| Rejecting d (IAE) (3) | − | D | − | − | S | − | − | − | − | − | − | − |
| Overshoot (2) | S | D | S | S | S | S | S | S | S | S | S | S |
| Settling (2 %, s) (1) | ? | D | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| Effort (u swing) (1) | − | D | + | + | S | − | − | − | − | − | − | − |
| Wear (u travel/s) (2) | − | D | + | + | S | − | − | − | − | − | − | − |
| Time at a limit (1) | − | D | − | − | S | S | S | S | − | − | S | S |
| Robustness Ms (2) | ? | D | ? | ? | S | ? | ? | ? | ? | ? | ? | ? |
| Plant ±15 % (worst J) (3) | − | D | − | − | − | − | − | − | − | − | − | − |
| Noise → u (2) | + | D | + | + | S | + | + | + | − | − | + | + |
| Complexity (1) | − | D | − | − | − | − | − | − | + | S | − | − |
| Tuning runs (1) | + | D | + | + | + | + | + | + | + | + | + | S |
| **+ / −** | 2 / 6 | datum | 4 / 4 | 4 / 4 | 1 / 2 | 2 / 5 | 2 / 5 | 2 / 5 | 2 / 6 | 1 / 6 | 2 / 5 | 1 / 5 |
| **Weighted** | -8 | 0 | -2 | -2 | -3 | -7 | -7 | -7 | -10 | -11 | -7 | -8 |
| **Fits** | yes | yes | no | no | yes | yes | yes | no | yes | yes | no | yes |

Ranking (fitting only): 1. PID (+0); 2. PID + feedforward from the plant (-3); 3. Swing-up + LQR catch (-7); 4. Swing-up (Lyapunov) + state feedback (-7); 5. Super-twisting (-8); 6. As loaded: Swing-up + LQR catch (-8); 7. Relay (on/off) (-10); 8. Sliding mode (ideal) (-11).

## DC motor, position control

Step test for the starts: integrating. Total 1.2 s: load 0.0117 s, starts 0.0592 s, tuning 0.826 s, scoring 0.0885 s, sweep (8 plants) 0.163 s. One run 5.2 ms, so about 224 runs' worth.

Refused:

- Off (`off`): does nothing: the open loop, not a candidate
- LQR (`lqr`): LQR needs every state measured. This block sees angle but not Motor/armature 1/(Ls + R) and Motor/rotor 1/(Js + b).
- State feedback (`stateFeedback`): starts from the LQR design, which refused: LQR needs every state measured. This block sees angle but not Motor/armature 1/(Ls + R) and Motor/rotor 1/(Js + b).
- PI from the plant (`scheduledPI`): angle integrates V: it has no static gain
- Swing-up (Lyapunov) + state feedback (`swingUp`): reads x, θ, v, ω of a pendulum on a cart (4 measurements); this block measures 1
- Swing-up + LQR catch (`swingUpLqr`): the swing-up reads x, θ, v, ω (θ an angle) from inputs 2 to 5; this block has angle
- Planned swing-up + TV-LQR (`trajectory`): LQR needs every state measured. This block sees angle but not Motor/armature 1/(Ls + R) and Motor/rotor 1/(Js + b).
- Sliding mode (`slidingMode`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)
- Super-twisting (`superTwisting`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)

Candidates (J: the goal's cost, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: P, too aggressive | not tuned | 1.27 | 0 | 0 | no: fragile: Ms 4.7 at r's middle (at most 3), PM 15° |
| PID | step test, SIMC (integrating) | 0.13 → 0.111 | 91 | 400 | yes |
| Gain-scheduled PI | the PID's gains, flat | 1.17 → 0.114 | 61 | 280 | yes |
| PID + feedforward from the plant | the PID row's gains; Kff, Kv, Ka from the plant; Tr searched → 0.0277 | 0.112 → 0.11 | 15 | 130 | yes |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 1.55 → 1.55 | 1 | 3.6 | yes |

Scores:

| Candidate | Following r (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: P, too aggressive | 0.16 | 0.023 | 24 % | 0.83 | 0.25 | 3.6 | 0.16 | 4.7 | 1.9 | 0.023 | 2 | 0 | 15 | 9.9 ms |
| PID | 0.11 | 0.0076 | 0.87 % | 0.2 | 0.16 | 1.2 | 0.088 | 1.9 | 0.13 | 0.037 | 4 | 91 | 44 | 31 ms |
| Gain-scheduled PI | 0.14 | 0.03 | 6.5 % | 0.47 | 0.14 | 0.86 | 0 | 1.4 | 0.54 | 0.0042 | 6 | 61 | 61 | 130 ms |
| PID + feedforward from the plant | 0.12 | 0.0076 | 0.36 % | 0.2 | 0.16 | 1.2 | 0.08 | 1.9 | 0.15 | 0.037 | 9 | 15 | 44 | 31 ms |
| Relay (on/off) | 0.22 | 0.11 | 26 % | 0.99 | 0.5 | 9 | 1 | no linear model | 2.3 | 0.52 | 2 | 1 | — | — |

Pugh matrix, round 1: datum **PID**; weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: P, too aggressive | PID | Gain-scheduled PI | PID + feedforward from the plant | Relay (on/off) |
|---|:-:|:-:|:-:|:-:|:-:|
| Following r (IAE) (3) | − | D | − | S | − |
| Rejecting d (IAE) (3) | − | D | − | S | − |
| Overshoot (2) | − | D | − | S | − |
| Settling (2 %, s) (1) | − | D | − | S | − |
| Effort (u swing) (1) | − | D | + | S | − |
| Wear (u travel/s) (2) | − | D | + | S | − |
| Time at a limit (1) | − | D | + | S | − |
| Robustness Ms (2) | − | D | + | S | ? |
| Plant ±15 % (worst J) (3) | − | D | − | − | − |
| Noise → u (2) | + | D | + | S | − |
| Complexity (1) | + | D | − | − | + |
| Tuning runs (1) | + | D | S | + | + |
| **+ / −** | 3 / 9 | datum | 5 / 6 | 1 / 2 | 2 / 9 |
| **Weighted** | -14 | 0 | -5 | -3 | -16 |
| **Fits** | no | yes | yes | yes | yes |

Ranking (fitting only): 1. PID (+0); 2. PID + feedforward from the plant (-3); 3. Gain-scheduled PI (-5); 4. Relay (on/off) (-16).

Pugh matrix, round 2: datum **PID** (round 1's winner); weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: P, too aggressive | PID | Gain-scheduled PI | PID + feedforward from the plant | Relay (on/off) |
|---|:-:|:-:|:-:|:-:|:-:|
| Following r (IAE) (3) | − | D | − | S | − |
| Rejecting d (IAE) (3) | − | D | − | S | − |
| Overshoot (2) | − | D | − | S | − |
| Settling (2 %, s) (1) | − | D | − | S | − |
| Effort (u swing) (1) | − | D | + | S | − |
| Wear (u travel/s) (2) | − | D | + | S | − |
| Time at a limit (1) | − | D | + | S | − |
| Robustness Ms (2) | − | D | + | S | ? |
| Plant ±15 % (worst J) (3) | − | D | − | − | − |
| Noise → u (2) | + | D | + | S | − |
| Complexity (1) | + | D | − | − | + |
| Tuning runs (1) | + | D | S | + | + |
| **+ / −** | 3 / 9 | datum | 5 / 6 | 1 / 2 | 2 / 9 |
| **Weighted** | -14 | 0 | -5 | -3 | -16 |
| **Fits** | no | yes | yes | yes | yes |

Ranking (fitting only): 1. PID (+0); 2. PID + feedforward from the plant (-3); 3. Gain-scheduled PI (-5); 4. Relay (on/off) (-16).

## Triple pendulum

Step test for the starts: relay. Total 8.4 s: load 1.42 s, starts 0.126 s, tuning 3.27 s, scoring 3.5 s, sweep (8 plants) 0.0197 s. One run 5.8 ms, so about 1438 runs' worth.

Refused:

- Off (`off`): does nothing: the open loop, not a candidate
- PI from the plant (`scheduledPI`): x integrates F: it has no static gain
- Gain-scheduled PI (`gainScheduled`): r does not move: there is no range to schedule over
- Swing-up + LQR catch (`swingUpLqr`): the swing-up reads x, θ, v, ω (θ an angle) from inputs 2 to 5; this block has x, θ1, θ2, θ3, v, ω1, ω2, ω3

Candidates (J: the goal's cost, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: Planned swing-up + TV-LQR | not tuned | 0.219 | 0 | 0 | no: diverges on 8 of 8 plants within ±15 % |
| PID | relay test, Tyreus–Luyben; no point on the way fits (tuned: unstable at r's middle (2 poles outside)) | 0.0103 → 7.6e-5 | 116 | 810 | no: diverges on 8 of 8 plants within ±15 % |
| LQR | Q = 1 for every measurement; R searched → 2.23; no point on the way fits (tuned: unstable at r's middle (3 poles outside)) | 32.6 → 20 | 19 | 230 | no: diverges on 8 of 8 plants within ±15 % |
| State feedback | the LQR row's gains; no point on the way fits (tuned: unstable at r's middle (5 poles outside)) | 20 → 11.7 | 72 | 500 | no: diverges on 8 of 8 plants within ±15 % |
| PID + feedforward from the plant | the PID row's gains; Kff, Kv, Ka from the plant; Tr searched → 0.25 | 7.6e-5 → 7.6e-5 | 15 | 100 | no: diverges on 8 of 8 plants within ±15 % |
| Swing-up (Lyapunov) + state feedback | its defaults (not iterated: A swing-up switches between pumping energy and catching the ) | 78.3 → 78.3 | 1 | 7.4 | no: diverges on 8 of 8 plants within ±15 % |
| Planned swing-up + TV-LQR | its defaults | 0.244 → 0.244 | 1 | 22 | no: diverges on 8 of 8 plants within ±15 % |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 0.732 → 0.732 | 1 | 6.5 | no: diverges on 8 of 8 plants within ±15 % |
| Sliding mode (ideal) | λ from the step model, K the full swing; no point on the way fits (tuned: diverges on 8 of 8 varied plants) | 33.1 → 1.28 | 46 | 290 | no: diverges on 8 of 8 plants within ±15 % |
| Sliding mode (boundary layer) | and φ = 0.2·λ·span r; no point on the way fits (tuned: unstable at r's middle (8 poles outside)) | 7.84 → 0.0128 | 96 | 660 | no: diverges on 8 of 8 plants within ±15 % |
| Super-twisting | λ as the sliding mode; k1 = U/3, k2 = 3.7 U; no point on the way fits (tuned: diverges on 8 of 8 varied plants) | 14.4 → 0.0213 | 104 | 640 | no: diverges on 8 of 8 plants within ±15 % |

Scores:

| Candidate | Following r (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: Planned swing-up + TV-LQR | — | 0.046 | 0 % | — | 0.069 | 0.43 | 0 | unstable | 200 | 0.39 | 10 | 0 | — | — |
| PID | — | 1.3e-4 | 0 % | — | 0.0092 | 0.046 | 0 | unstable | 200 | 0.37 | 4 | 120 | — | — |
| LQR | — | 30 | 0 % | — | 0.48 | 3.6 | 1 | unstable | 200 | 0.81 | 19 | 19 | — | — |
| State feedback | — | 22 | 0 % | — | 0.49 | 5.2 | 1 | unstable | 200 | 0.71 | 17 | 72 | — | — |
| PID + feedforward from the plant | — | 1.3e-4 | 0 % | — | 0.0092 | 0.046 | 0 | unstable | 200 | 0.37 | 10 | 15 | — | — |
| Swing-up (Lyapunov) + state feedback | — | 170 | 0 % | — | 0.18 | 1.7 | 0.07 | no linear model | 200 | 0.21 | 17 | 1 | — | — |
| Planned swing-up + TV-LQR | — | 0.13 | 0 % | — | 0.07 | 0.43 | 0 | unstable | 200 | 0.38 | 10 | 1 | — | — |
| Relay (on/off) | — | 0.75 | 0 % | — | 0.5 | 4.4 | 1 | no linear model | 200 | 0.69 | 2 | 1 | — | — |
| Sliding mode (ideal) | — | 1.8 | 0 % | — | 0.5 | 4 | 1 | no linear model | 200 | 0.65 | 4 | 46 | — | — |
| Sliding mode (boundary layer) | — | 0.03 | 0 % | — | 0.017 | 0.13 | 0 | unstable | 200 | 0.026 | 5 | 96 | — | — |
| Super-twisting | — | 0.019 | 0 % | — | 0.013 | 0.094 | 0 | no linear model | 200 | 0.03 | 5 | 100 | — | — |

Pugh matrix, round 1: datum **As loaded: Planned swing-up + TV-LQR**; weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: Planned swing-up + TV-LQR | PID | LQR | State feedback | PID + feedforward from the plant | Swing-up (Lyapunov) + state feedback | Planned swing-up + TV-LQR | Relay (on/off) | Sliding mode (ideal) | Sliding mode (boundary layer) | Super-twisting |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Following r (IAE) (3) | D | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| Rejecting d (IAE) (3) | D | + | − | − | + | − | − | − | − | + | + |
| Overshoot (2) | D | S | S | S | S | S | S | S | S | S | S |
| Settling (2 %, s) (1) | D | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| Effort (u swing) (1) | D | + | − | − | + | − | S | − | − | + | + |
| Wear (u travel/s) (2) | D | + | − | − | + | − | S | − | − | + | + |
| Time at a limit (1) | D | S | − | − | S | − | S | − | − | S | S |
| Robustness Ms (2) | D | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| Plant ±15 % (worst J) (3) | D | S | S | S | S | S | S | S | S | S | S |
| Noise → u (2) | D | S | − | − | S | + | S | − | − | + | + |
| Complexity (1) | D | + | − | − | S | − | S | + | + | + | + |
| Tuning runs (1) | D | − | − | − | − | S | S | S | − | − | − |
| **+ / −** | datum | 4 / 1 | 0 / 7 | 0 / 7 | 3 / 1 | 1 / 5 | 0 / 1 | 1 / 5 | 1 / 6 | 5 / 1 | 5 / 1 |
| **Weighted** | 0 | 6 | -11 | -11 | 5 | -6 | -3 | -8 | -9 | 8 | 8 |
| **Fits** | no | no | no | no | no | no | no | no | no | no | no |

Ranking (fitting only): .

Pugh matrix, round 2: datum **As loaded: Planned swing-up + TV-LQR** (round 1's winner); weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: Planned swing-up + TV-LQR | PID | LQR | State feedback | PID + feedforward from the plant | Swing-up (Lyapunov) + state feedback | Planned swing-up + TV-LQR | Relay (on/off) | Sliding mode (ideal) | Sliding mode (boundary layer) | Super-twisting |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Following r (IAE) (3) | D | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| Rejecting d (IAE) (3) | D | + | − | − | + | − | − | − | − | + | + |
| Overshoot (2) | D | S | S | S | S | S | S | S | S | S | S |
| Settling (2 %, s) (1) | D | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| Effort (u swing) (1) | D | + | − | − | + | − | S | − | − | + | + |
| Wear (u travel/s) (2) | D | + | − | − | + | − | S | − | − | + | + |
| Time at a limit (1) | D | S | − | − | S | − | S | − | − | S | S |
| Robustness Ms (2) | D | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| Plant ±15 % (worst J) (3) | D | S | S | S | S | S | S | S | S | S | S |
| Noise → u (2) | D | S | − | − | S | + | S | − | − | + | + |
| Complexity (1) | D | + | − | − | S | − | S | + | + | + | + |
| Tuning runs (1) | D | − | − | − | − | S | S | S | − | − | − |
| **+ / −** | datum | 4 / 1 | 0 / 7 | 0 / 7 | 3 / 1 | 1 / 5 | 0 / 1 | 1 / 5 | 1 / 6 | 5 / 1 | 5 / 1 |
| **Weighted** | 0 | 6 | -11 | -11 | 5 | -6 | -3 | -8 | -9 | 8 | 8 |
| **Fits** | no | no | no | no | no | no | no | no | no | no | no |

Ranking (fitting only): .

## Following a sine (XY)

Step test for the starts: integrating. Total 1.2 s: load 0.00529 s, starts 0.038 s, tuning 0.903 s, scoring 0.0725 s, sweep (8 plants) 0.167 s. One run 4.6 ms, so about 261 runs' worth.

Refused:

- Off (`off`): does nothing: the open loop, not a candidate
- LQR (`lqr`): LQR needs every state measured. This block sees angle but not Motor/armature 1/(Ls + R) and Motor/rotor 1/(Js + b).
- State feedback (`stateFeedback`): starts from the LQR design, which refused: LQR needs every state measured. This block sees angle but not Motor/armature 1/(Ls + R) and Motor/rotor 1/(Js + b).
- PI from the plant (`scheduledPI`): angle integrates V: it has no static gain
- Swing-up (Lyapunov) + state feedback (`swingUp`): reads x, θ, v, ω of a pendulum on a cart (4 measurements); this block measures 1
- Swing-up + LQR catch (`swingUpLqr`): the swing-up reads x, θ, v, ω (θ an angle) from inputs 2 to 5; this block has angle
- Planned swing-up + TV-LQR (`trajectory`): LQR needs every state measured. This block sees angle but not Motor/armature 1/(Ls + R) and Motor/rotor 1/(Js + b).
- Sliding mode (`slidingMode`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)
- Super-twisting (`superTwisting`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)

Candidates (J: the goal's cost, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: P | not tuned | 0.087 | 0 | 0 | yes |
| PID | step test, SIMC (integrating); backed off to 50 % of the way (tuned: Ms 14) | 0.0121 → 0.0039 | 105 | 500 | yes |
| Gain-scheduled PI | the PID's gains, flat; no point on the way fits (tuned: Ms 9.2) | 0.183 → 0.00444 | 58 | 280 | no: fragile: Ms 9.2 at r's middle (at most 3), PM 6.8° |
| PID + feedforward from the plant | the PID row's gains; Kff, Kv, Ka from the plant; Tr searched → 0.00176 | 0.0178 → 3.3e-4 | 15 | 110 | yes |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 0.326 → 0.326 | 1 | 3.8 | yes |

Scores:

| Candidate | Following r (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: P | — | — | 0 % | — | 0.024 | 0.034 | 0 | 1.2 | 0.096 | 0.0014 | 2 | 0 | 75 | 310 ms |
| PID | — | — | 0 % | — | 0.027 | 0.052 | 0 | 2.7 | 0.0041 | 0.047 | 4 | 110 | 31 | 16 ms |
| Gain-scheduled PI | — | — | 0 % | — | 0.029 | 0.14 | 0 | 9.2 | 0.028 | 0.019 | 7 | 58 | 6.8 | 5 ms |
| PID + feedforward from the plant | — | — | 0 % | — | 0.029 | 0.16 | 0 | 2.7 | 5.2e-4 | 0.047 | 9 | 15 | 31 | 16 ms |
| Relay (on/off) | — | — | 0 % | — | 0.5 | 10 | 1 | no linear model | 0.35 | 0.43 | 2 | 1 | — | — |

Pugh matrix, round 1: datum **PID**; weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: P | PID | Gain-scheduled PI | PID + feedforward from the plant | Relay (on/off) |
|---|:-:|:-:|:-:|:-:|:-:|
| Following r (IAE) (3) | ? | D | ? | ? | ? |
| Rejecting d (IAE) (3) | ? | D | ? | ? | ? |
| Overshoot (2) | S | D | S | S | S |
| Settling (2 %, s) (1) | ? | D | ? | ? | ? |
| Effort (u swing) (1) | S | D | S | S | − |
| Wear (u travel/s) (2) | S | D | − | − | − |
| Time at a limit (1) | S | D | S | S | − |
| Robustness Ms (2) | + | D | − | S | ? |
| Plant ±15 % (worst J) (3) | − | D | − | S | − |
| Noise → u (2) | + | D | + | S | − |
| Complexity (1) | + | D | − | − | + |
| Tuning runs (1) | + | D | S | + | + |
| **+ / −** | 4 / 1 | datum | 1 / 4 | 1 / 2 | 2 / 5 |
| **Weighted** | 3 | 0 | -6 | -2 | -7 |
| **Fits** | yes | yes | no | yes | yes |

Ranking (fitting only): 1. As loaded: P (+3); 2. PID (+0); 3. PID + feedforward from the plant (-2); 4. Relay (on/off) (-7).

Pugh matrix, round 2: datum **As loaded: P** (round 1's winner); weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: P | PID | Gain-scheduled PI | PID + feedforward from the plant | Relay (on/off) |
|---|:-:|:-:|:-:|:-:|:-:|
| Following r (IAE) (3) | D | ? | ? | ? | ? |
| Rejecting d (IAE) (3) | D | ? | ? | ? | ? |
| Overshoot (2) | D | S | S | S | S |
| Settling (2 %, s) (1) | D | ? | ? | ? | ? |
| Effort (u swing) (1) | D | S | − | − | − |
| Wear (u travel/s) (2) | D | S | − | − | − |
| Time at a limit (1) | D | S | S | S | − |
| Robustness Ms (2) | D | − | − | − | ? |
| Plant ±15 % (worst J) (3) | D | + | + | + | − |
| Noise → u (2) | D | − | − | − | − |
| Complexity (1) | D | − | − | − | S |
| Tuning runs (1) | D | − | − | − | S |
| **+ / −** | datum | 1 / 4 | 1 / 6 | 1 / 6 | 0 / 5 |
| **Weighted** | 0 | -3 | -6 | -6 | -9 |
| **Fits** | yes | yes | no | yes | yes |

Ranking (fitting only): 1. As loaded: P (+0); 2. PID (-3); 3. PID + feedforward from the plant (-6); 4. Relay (on/off) (-9).

## Encoder errors and torque ripple

Step test for the starts: fopdt. Total 7.5 s: load 0.0441 s, starts 0.212 s, tuning 4.9 s, scoring 0.469 s, sweep (8 plants) 1.7 s. One run 35 ms, so about 217 runs' worth.

Refused:

- Off (`off`): does nothing: the open loop, not a candidate
- LQR (`lqr`): the plant is not at rest at the origin: speed from angle moves at -18000/s with V = 0
- State feedback (`stateFeedback`): starts from the LQR design, which refused: the plant is not at rest at the origin: speed from angle moves at -18000/s with V = 0
- PI from the plant (`scheduledPI`): no equilibrium with speed from angle = 150: the best found leaves a residual of 68200
- Swing-up (Lyapunov) + state feedback (`swingUp`): reads x, θ, v, ω of a pendulum on a cart (4 measurements); this block measures 1
- Swing-up + LQR catch (`swingUpLqr`): the swing-up reads x, θ, v, ω (θ an angle) from inputs 2 to 5; this block has speed from angle
- Planned swing-up + TV-LQR (`trajectory`): the plant is not at rest at the origin: speed from angle moves at -18000/s with V = 0
- Sliding mode (`slidingMode`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)
- Super-twisting (`superTwisting`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)

Candidates (J: the goal's cost, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: PI speed | not tuned | 0.0159 | 0 | 0 | yes |
| PID | step test, SIMC (fopdt) | 0.0148 → 0.0106 | 60 | 2400 | yes |
| Gain-scheduled PI | the PID's gains, flat | 0.0106 → 0.0106 | 33 | 1500 | yes |
| PID + feedforward from the plant | the PID row's gains; Kff, Kv, Ka from the plant; Tr searched → 0.00145 | 0.801 → 0.637 | 15 | 930 | yes |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 0.361 → 0.361 | 1 | 33 | yes |

Scores:

| Candidate | Following r (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: PI speed | — | — | 0 % | — | 0.16 | 4.9 | 0.011 | no linear model | 0.091 | 0.0095 | 3 | 0 | — | — |
| PID | — | — | 0 % | — | 0.16 | 0.38 | 0 | no linear model | 0.086 | 0.0016 | 3 | 60 | — | — |
| Gain-scheduled PI | — | — | 0 % | — | 0.16 | 0.38 | 0 | no linear model | 0.086 | 0.0016 | 6 | 33 | — | — |
| PID + feedforward from the plant | — | — | 0 % | — | 0.17 | 0.5 | 0.9 | no linear model | 0.89 | 7.5e-4 | 9 | 15 | — | — |
| Relay (on/off) | — | — | 0 % | — | 0.46 | 110 | 1 | no linear model | 0.46 | 0.44 | 2 | 1 | — | — |

Pugh matrix, round 1: datum **PID**; weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: PI speed | PID | Gain-scheduled PI | PID + feedforward from the plant | Relay (on/off) |
|---|:-:|:-:|:-:|:-:|:-:|
| Following r (IAE) (3) | ? | D | ? | ? | ? |
| Rejecting d (IAE) (3) | ? | D | ? | ? | ? |
| Overshoot (2) | S | D | S | S | S |
| Settling (2 %, s) (1) | ? | D | ? | ? | ? |
| Effort (u swing) (1) | S | D | S | S | − |
| Wear (u travel/s) (2) | − | D | S | − | − |
| Time at a limit (1) | S | D | S | − | − |
| Robustness Ms (2) | ? | D | ? | ? | ? |
| Plant ±15 % (worst J) (3) | S | D | S | − | − |
| Noise → u (2) | − | D | S | S | − |
| Complexity (1) | S | D | − | − | + |
| Tuning runs (1) | + | D | S | + | + |
| **+ / −** | 1 / 2 | datum | 0 / 1 | 1 / 4 | 2 / 5 |
| **Weighted** | -3 | 0 | -1 | -6 | -7 |
| **Fits** | yes | yes | yes | yes | yes |

Ranking (fitting only): 1. PID (+0); 2. Gain-scheduled PI (-1); 3. As loaded: PI speed (-3); 4. PID + feedforward from the plant (-6); 5. Relay (on/off) (-7).

Pugh matrix, round 2: datum **PID** (round 1's winner); weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: PI speed | PID | Gain-scheduled PI | PID + feedforward from the plant | Relay (on/off) |
|---|:-:|:-:|:-:|:-:|:-:|
| Following r (IAE) (3) | ? | D | ? | ? | ? |
| Rejecting d (IAE) (3) | ? | D | ? | ? | ? |
| Overshoot (2) | S | D | S | S | S |
| Settling (2 %, s) (1) | ? | D | ? | ? | ? |
| Effort (u swing) (1) | S | D | S | S | − |
| Wear (u travel/s) (2) | − | D | S | − | − |
| Time at a limit (1) | S | D | S | − | − |
| Robustness Ms (2) | ? | D | ? | ? | ? |
| Plant ±15 % (worst J) (3) | S | D | S | − | − |
| Noise → u (2) | − | D | S | S | − |
| Complexity (1) | S | D | − | − | + |
| Tuning runs (1) | + | D | S | + | + |
| **+ / −** | 1 / 2 | datum | 0 / 1 | 1 / 4 | 2 / 5 |
| **Weighted** | -3 | 0 | -1 | -6 | -7 |
| **Fits** | yes | yes | yes | yes | yes |

Ranking (fitting only): 1. PID (+0); 2. Gain-scheduled PI (-1); 3. As loaded: PI speed (-3); 4. PID + feedforward from the plant (-6); 5. Relay (on/off) (-7).

## DC motor, speed from an encoder

Step test for the starts: relay. Total 4.2 s: load 0.0398 s, starts 0.527 s, tuning 2.54 s, scoring 0.237 s, sweep (8 plants) 0.743 s. One run 24 ms, so about 173 runs' worth.

Refused:

- Off (`off`): does nothing: the open loop, not a candidate
- LQR (`lqr`): V moves none of the measurements (x̂2)
- State feedback (`stateFeedback`): starts from the LQR design, which refused: V moves none of the measurements (x̂2)
- PI from the plant (`scheduledPI`): no equilibrium with x̂2 = 5: the best found leaves a residual of 5
- PID + feedforward from the plant (`pidFF`): V does not reach x̂2
- Swing-up (Lyapunov) + state feedback (`swingUp`): reads x, θ, v, ω of a pendulum on a cart (4 measurements); this block measures 1
- Swing-up + LQR catch (`swingUpLqr`): the swing-up reads x, θ, v, ω (θ an angle) from inputs 2 to 5; this block has x̂2
- Planned swing-up + TV-LQR (`trajectory`): V moves none of the measurements (x̂2)
- Sliding mode (`slidingMode`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)
- Super-twisting (`superTwisting`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)

Candidates (J: the goal's cost, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: PI speed | not tuned | 3 | 0 | 0 | yes |
| PID | relay test, Tyreus–Luyben | 4.19 → 4.19 | 40 | 1100 | yes |
| Gain-scheduled PI | the PID's gains, flat | 4.19 → 4.19 | 46 | 1400 | yes |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 3.2 → 3.2 | 1 | 24 | yes |

Scores:

| Candidate | Following r (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: PI speed | 0.32 | 0.31 | 130 % | 1.7 | 0.27 | 390 | 0.12 | no linear model | 4.2 | 0.31 | 3 | 0 | — | — |
| PID | 0.3 | 0.31 | 130 % | 1.7 | 0.14 | 130 | 0.0026 | no linear model | 4.2 | 0.11 | 4 | 40 | — | — |
| Gain-scheduled PI | 0.3 | 0.31 | 130 % | 1.7 | 0.13 | 110 | 0.0018 | no linear model | 4.2 | 0.095 | 6 | 46 | — | — |
| Relay (on/off) | 0.35 | 0.31 | 130 % | 1.7 | 0.48 | 640 | 1 | no linear model | 4.4 | 0.48 | 2 | 1 | — | — |

Pugh matrix, round 1: datum **PID**; weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: PI speed | PID | Gain-scheduled PI | Relay (on/off) |
|---|:-:|:-:|:-:|:-:|
| Following r (IAE) (3) | S | D | S | − |
| Rejecting d (IAE) (3) | S | D | S | S |
| Overshoot (2) | S | D | S | S |
| Settling (2 %, s) (1) | S | D | S | S |
| Effort (u swing) (1) | − | D | S | − |
| Wear (u travel/s) (2) | − | D | S | − |
| Time at a limit (1) | − | D | S | − |
| Robustness Ms (2) | ? | D | ? | ? |
| Plant ±15 % (worst J) (3) | S | D | S | S |
| Noise → u (2) | − | D | S | − |
| Complexity (1) | + | D | − | + |
| Tuning runs (1) | + | D | S | + |
| **+ / −** | 2 / 4 | datum | 0 / 1 | 2 / 5 |
| **Weighted** | -4 | 0 | -1 | -7 |
| **Fits** | yes | yes | yes | yes |

Ranking (fitting only): 1. PID (+0); 2. Gain-scheduled PI (-1); 3. As loaded: PI speed (-4); 4. Relay (on/off) (-7).

Pugh matrix, round 2: datum **PID** (round 1's winner); weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: PI speed | PID | Gain-scheduled PI | Relay (on/off) |
|---|:-:|:-:|:-:|:-:|
| Following r (IAE) (3) | S | D | S | − |
| Rejecting d (IAE) (3) | S | D | S | S |
| Overshoot (2) | S | D | S | S |
| Settling (2 %, s) (1) | S | D | S | S |
| Effort (u swing) (1) | − | D | S | − |
| Wear (u travel/s) (2) | − | D | S | − |
| Time at a limit (1) | − | D | S | − |
| Robustness Ms (2) | ? | D | ? | ? |
| Plant ±15 % (worst J) (3) | S | D | S | S |
| Noise → u (2) | − | D | S | − |
| Complexity (1) | + | D | − | + |
| Tuning runs (1) | + | D | S | + |
| **+ / −** | 2 / 4 | datum | 0 / 1 | 2 / 5 |
| **Weighted** | -4 | 0 | -1 | -7 |
| **Fits** | yes | yes | yes | yes |

Ranking (fitting only): 1. PID (+0); 2. Gain-scheduled PI (-1); 3. As loaded: PI speed (-4); 4. Relay (on/off) (-7).

## DC motor with an unbalanced arm

Step test for the starts: relay. Total 5.0 s: load 0.016 s, starts 0.323 s, tuning 3.72 s, scoring 0.224 s, sweep (8 plants) 0.666 s. One run 14 ms, so about 351 runs' worth.

Refused:

- Off (`off`): does nothing: the open loop, not a candidate
- LQR (`lqr`): LQR needs every state measured. This block sees angle but not Motor and arm/armature 1/(Ls + R) and Motor and arm/rotor 1/(Js + b).
- State feedback (`stateFeedback`): starts from the LQR design, which refused: LQR needs every state measured. This block sees angle but not Motor and arm/armature 1/(Ls + R) and Motor and arm/rotor 1/(Js + b).
- Swing-up (Lyapunov) + state feedback (`swingUp`): reads x, θ, v, ω of a pendulum on a cart (4 measurements); this block measures 1
- Swing-up + LQR catch (`swingUpLqr`): the swing-up reads x, θ, v, ω (θ an angle) from inputs 2 to 5; this block has angle (Motor and arm)
- Planned swing-up + TV-LQR (`trajectory`): LQR needs every state measured. This block sees angle but not Motor and arm/armature 1/(Ls + R) and Motor and arm/rotor 1/(Js + b).
- Sliding mode (`slidingMode`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)
- Super-twisting (`superTwisting`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)

Candidates (J: the goal's cost, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: PID | not tuned | 0.152 | 0 | 0 | yes |
| PID | relay test, Tyreus–Luyben | 0.433 → 0.0429 | 112 | 1700 | yes |
| PI from the plant | one level, r's middle; Tcl searched → 0.107 | 3.66 → 2.65 | 15 | 340 | yes |
| Gain-scheduled PI | PI from the plant at 3 levels | 2.68 → 2.4 | 89 | 1300 | yes |
| PID + feedforward from the plant | the PID row's gains; Kff, Kv, Ka from the plant; Tr searched → 1.03 | 6.6 → 0.295 | 15 | 340 | yes |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 4.03 → 4.03 | 1 | 12 | yes |

Scores:

| Candidate | Following r (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: PID | 0.08 | 0.019 | 14 % | 0.69 | 0.09 | 0.62 | 0.012 | 1.8 | 0.63 | 0.018 | 4 | 0 | 32 | 530 ms |
| PID | 0.058 | 0.0095 | 2.8 % | 0.18 | 0.11 | 0.8 | 0.022 | 1.4 | 0.076 | 0.036 | 4 | 110 | 42 | 480 ms |
| PI from the plant | 0.42 | 0.33 | 70 % | 1.5 | 0.47 | 5.7 | 0.87 | 1.1 | 4.2 | 0.59 | 5 | 15 | 85 | 160 ms |
| Gain-scheduled PI | 0.41 | 0.32 | 70 % | 1.5 | 0.47 | 5.7 | 0.86 | 1.1 | 4.2 | 0.34 | 9 | 89 | 85 | 160 ms |
| PID + feedforward from the plant | 0.32 | 0.32 | 9.7 % | 1.5 | 0.11 | 0.87 | 0.03 | 1.4 | 1.2 | 0.037 | 10 | 15 | 42 | 480 ms |
| Relay (on/off) | 0.48 | 0.44 | 110 % | 1.5 | 0.5 | 6.8 | 1 | no linear model | 4.3 | 0.68 | 2 | 1 | — | — |

Pugh matrix, round 1: datum **PID**; weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: PID | PID | PI from the plant | Gain-scheduled PI | PID + feedforward from the plant | Relay (on/off) |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Following r (IAE) (3) | − | D | − | − | − | − |
| Rejecting d (IAE) (3) | − | D | − | − | − | − |
| Overshoot (2) | − | D | − | − | − | − |
| Settling (2 %, s) (1) | − | D | − | − | − | − |
| Effort (u swing) (1) | + | D | − | − | S | − |
| Wear (u travel/s) (2) | S | D | − | − | S | − |
| Time at a limit (1) | S | D | − | − | S | − |
| Robustness Ms (2) | − | D | + | + | S | ? |
| Plant ±15 % (worst J) (3) | − | D | − | − | − | − |
| Noise → u (2) | + | D | − | − | S | − |
| Complexity (1) | S | D | − | − | − | + |
| Tuning runs (1) | + | D | + | S | + | + |
| **+ / −** | 3 / 6 | datum | 2 / 10 | 1 / 10 | 1 / 6 | 2 / 9 |
| **Weighted** | -10 | 0 | -16 | -17 | -12 | -16 |
| **Fits** | yes | yes | yes | yes | yes | yes |

Ranking (fitting only): 1. PID (+0); 2. As loaded: PID (-10); 3. PID + feedforward from the plant (-12); 4. PI from the plant (-16); 5. Relay (on/off) (-16); 6. Gain-scheduled PI (-17).

Pugh matrix, round 2: datum **PID** (round 1's winner); weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: PID | PID | PI from the plant | Gain-scheduled PI | PID + feedforward from the plant | Relay (on/off) |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Following r (IAE) (3) | − | D | − | − | − | − |
| Rejecting d (IAE) (3) | − | D | − | − | − | − |
| Overshoot (2) | − | D | − | − | − | − |
| Settling (2 %, s) (1) | − | D | − | − | − | − |
| Effort (u swing) (1) | + | D | − | − | S | − |
| Wear (u travel/s) (2) | S | D | − | − | S | − |
| Time at a limit (1) | S | D | − | − | S | − |
| Robustness Ms (2) | − | D | + | + | S | ? |
| Plant ±15 % (worst J) (3) | − | D | − | − | − | − |
| Noise → u (2) | + | D | − | − | S | − |
| Complexity (1) | S | D | − | − | − | + |
| Tuning runs (1) | + | D | + | S | + | + |
| **+ / −** | 3 / 6 | datum | 2 / 10 | 1 / 10 | 1 / 6 | 2 / 9 |
| **Weighted** | -10 | 0 | -16 | -17 | -12 | -16 |
| **Fits** | yes | yes | yes | yes | yes | yes |

Ranking (fitting only): 1. PID (+0); 2. As loaded: PID (-10); 3. PID + feedforward from the plant (-12); 4. PI from the plant (-16); 5. Relay (on/off) (-16); 6. Gain-scheduled PI (-17).

