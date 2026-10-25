# Benchmark prototype: the output

Reader: whoever checks the numbers [../output/benchmark.md](../output/benchmark.md) quotes. Generated, not hand-written: `node tools/benchmark-prototype.mjs` (the three systems), then `node tools/benchmark-prototype.mjs "Pendulum swing-up" "DC motor, position" "Triple" "Following a sine" "Encoder errors" "DC motor, speed" "DC motor with an unbalanced"` (the rest of the library: cost, plant changes and the limits), on main at 6ee6307 (with deadbeat, Hu–Lin and the speed PI registered), in this container (Node 22). One round against the datum (input 48). Timings vary by machine; the matrices are deterministic.

Goal: {"cost":"IAE","effort":0.05,"overshoot":10,"saturation":0.2}; Iterate up to 60 iterations; sweep 8 plants within ±15 %. Node v22.22.0.

## DC motor, sliding mode

Step test for the starts: integrating. Total 18.1 s: load 0.12 s, starts 0.375 s, tuning 14.8 s, scoring 0.634 s, sweep (8 plants) 1.97 s. One run 28 ms, so about 635 runs' worth.

Refused:

- Off (`off`): does nothing: the open loop, not a candidate
- LQR (`lqr`): LQR needs every state measured. This block sees angle, rotor 1/(Js + b) but not Motor/armature 1/(Ls + R).
- State feedback (`stateFeedback`): starts from the LQR design, which refused: LQR needs every state measured. This block sees angle, rotor 1/(Js + b) but not Motor/armature 1/(Ls + R).
- Deadbeat (`deadbeat`): deadbeat state feedback needs every state measured. This block sees angle, rotor 1/(Js + b) but not Motor/armature 1/(Ls + R).
- PI from the plant (`scheduledPI`): angle integrates V: it has no static gain
- Speed PI from the plant (`speedPI`): angle does not accelerate with V (∂ẏ/∂u = 0): speedPI needs a measured speed
- Swing-up (Lyapunov) + state feedback (`swingUp`): reads x, θ, v, ω of a pendulum on a cart (4 measurements); this block measures 2
- Swing-up + LQR catch (`swingUpLqr`): the swing-up reads x, θ, v, ω (θ an angle) from inputs 2 to 5; this block has angle, speed (Motor)
- Planned swing-up + TV-LQR (`trajectory`): LQR needs every state measured. This block sees angle, rotor 1/(Js + b) but not Motor/armature 1/(Ls + R).
- Variable gain (Hu–Lin) (`huLin`): LQR needs every state measured. This block sees angle, rotor 1/(Js + b) but not Motor/armature 1/(Ls + R).

Candidates (J: the goal's cost, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: Relay (theory) | not tuned | 0.302 | 0 | 0 | yes |
| PID | step test, SIMC (integrating) | 0.206 → 0.0767 | 115 | 3800 | yes |
| Gain-scheduled PI | the PID's gains, flat | 2.34 → 0.125 | 92 | 3100 | yes |
| PID + feedforward from the plant | the PID row's gains; Kff, Kv, Ka from the plant; Tr searched → 0.0155 | 0.0773 → 0.0766 | 15 | 770 | yes |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 2.64 → 2.64 | 1 | 30 | yes |
| Sliding mode (ideal) | λ from the step model, K the full swing | 0.595 → 0.26 | 38 | 1400 | yes |
| Sliding mode (boundary layer) | and φ = 0.2·λ·span r | 0.551 → 0.0757 | 57 | 2000 | yes |
| Super-twisting | λ as the sliding mode; k1 = U/3, k2 = 3.7 U | 0.869 → 0.0654 | 115 | 3700 | yes |

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

Pugh matrix: datum **PID**; weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

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

Suggestion: **Sliding mode (boundary layer)** (+8), added as a variant, not switched on.

## Oven, badly tuned

Step test for the starts: fopdt. Total 1.5 s: load 0.0258 s, starts 0.0311 s, tuning 1.11 s, scoring 0.0995 s, sweep (8 plants) 0.202 s. One run 3.8 ms, so about 391 runs' worth.

Refused:

- Off (`off`): does nothing: the open loop, not a candidate
- LQR (`lqr`): LQR needs every state measured. This block sees thermocouple but not heater and chamber.
- State feedback (`stateFeedback`): starts from the LQR design, which refused: LQR needs every state measured. This block sees thermocouple but not heater and chamber.
- Deadbeat (`deadbeat`): deadbeat places every pole of the loop at z = 0, but the dead time (0.1 s on thermocouple) holds inputs this law does not see, so it cannot place theirs
- Speed PI from the plant (`speedPI`): thermocouple does not accelerate with P (∂ẏ/∂u = 0): speedPI needs a measured speed
- Swing-up (Lyapunov) + state feedback (`swingUp`): reads x, θ, v, ω of a pendulum on a cart (4 measurements); this block measures 1
- Swing-up + LQR catch (`swingUpLqr`): the swing-up reads x, θ, v, ω (θ an angle) from inputs 2 to 5; this block has thermocouple
- Planned swing-up + TV-LQR (`trajectory`): the swing-up pushes both ways: u min must be below 0 and u max above 0 (now 0 to 100)
- Variable gain (Hu–Lin) (`huLin`): LQR needs every state measured. This block sees thermocouple but not heater and chamber.
- Sliding mode (`slidingMode`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)
- Super-twisting (`superTwisting`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)

Plant changes scored (⚙, never applied; complexity +5):

- a Finite difference observer (Tf 0.0253 s) makes ẏ from y for input 3

Candidates (J: the goal's cost, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: PID, badly tuned | not tuned | 1.28 | 0 | 0 | no: unstable at r's middle (2 poles outside) |
| PID | step test, SIMC (fopdt) | 0.152 → 0.139 | 57 | 240 | yes |
| PI from the plant | one level, r's middle; Tcl searched → 0.435 | 0.836 → 0.14 | 15 | 90 | yes |
| Gain-scheduled PI | PI from the plant at 3 levels | 0.14 → 0.139 | 82 | 270 | yes |
| PID + feedforward from the plant | the PID row's gains; Kff, Kv, Ka from the plant; Tr searched → 0.419 | 0.756 → 0.136 | 15 | 86 | yes |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 1.91 → 1.91 | 1 | 3.6 | yes |
| Sliding mode (ideal) ⚙ rate observer | λ from the step model, K the full swing | 0.606 → 0.587 | 25 | 130 | yes |
| Sliding mode (boundary layer) ⚙ rate observer | and φ = 0.2·λ·span r | 0.434 → 0.11 | 70 | 270 | yes |

Scores:

| Candidate | Following r (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: PID, badly tuned | 0.18 | 0.13 | 42 % | 1.7 | 0.41 | 2.1 | 0.47 | unstable | 1.7 | 0.036 | 4 | 0 | — | — |
| PID | 0.14 | 0.11 | 10 % | 1.7 | 0.21 | 0.55 | 0.04 | 1.8 | 0.24 | 0.0057 | 3 | 57 | 58 | 360 ms |
| PI from the plant | 0.14 | 0.12 | 9.8 % | 1.7 | 0.2 | 0.49 | 0.04 | 1.7 | 0.26 | 0.0051 | 5 | 15 | 58 | 390 ms |
| Gain-scheduled PI | 0.14 | 0.11 | 9.9 % | 1.7 | 0.21 | 0.54 | 0.04 | 1.8 | 0.24 | 0.0056 | 9 | 82 | 58 | 360 ms |
| PID + feedforward from the plant | 0.14 | 0.11 | 8.2 % | 1.3 | 0.2 | 0.79 | 0.048 | 1.8 | 0.19 | 0.0056 | 9 | 15 | 58 | 360 ms |
| Relay (on/off) | 0.17 | 0.15 | 54 % | 1.7 | 0.49 | 2.4 | 1 | no linear model | 2.3 | 0.53 | 2 | 1 | — | — |
| Sliding mode (ideal) ⚙ rate observer | 0.15 | 0.14 | 22 % | 1.7 | 0.49 | 3.9 | 0.98 | no linear model | 0.9 | 0.15 | 9 | 25 | — | — |
| Sliding mode (boundary layer) ⚙ rate observer | 0.11 | 0.098 | 10 % | 1.7 | 0.19 | 1.1 | 0.032 | 2.4 | 0.18 | 0.011 | 10 | 70 | 50 | 200 ms |

Pugh matrix: datum **PID**; weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: PID, badly tuned | PID | PI from the plant | Gain-scheduled PI | PID + feedforward from the plant | Relay (on/off) | Sliding mode (ideal) ⚙ rate observer | Sliding mode (boundary layer) ⚙ rate observer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Following r (IAE) (3) | − | D | S | S | S | − | S | + |
| Rejecting d (IAE) (3) | − | D | S | S | S | − | − | + |
| Overshoot (2) | − | D | S | S | S | − | − | S |
| Settling (2 %, s) (1) | S | D | S | S | + | S | S | S |
| Effort (u swing) (1) | − | D | S | S | S | − | − | S |
| Wear (u travel/s) (2) | − | D | S | S | − | − | − | − |
| Time at a limit (1) | − | D | S | S | S | − | − | S |
| Robustness Ms (2) | ? | D | S | S | S | ? | ? | − |
| Plant ±15 % (worst J) (3) | − | D | S | S | + | − | − | + |
| Noise → u (2) | − | D | S | S | S | − | − | − |
| Complexity (1) | − | D | − | − | − | + | − | − |
| Tuning runs (1) | + | D | + | S | + | + | + | S |
| **+ / −** | 1 / 9 | datum | 1 / 1 | 0 / 1 | 3 / 2 | 2 / 8 | 1 / 8 | 3 / 4 |
| **Weighted** | -17 | 0 | 0 | -1 | 2 | -15 | -14 | 2 |
| **Fits** | no | yes | yes | yes | yes | yes | yes | yes |

Ranking (fitting only): 1. Sliding mode (boundary layer) ⚙ rate observer (+2); 2. PID + feedforward from the plant (+2); 3. PID (+0); 4. PI from the plant (+0); 5. Gain-scheduled PI (-1); 6. Sliding mode (ideal) ⚙ rate observer (-14); 7. Relay (on/off) (-15).

Suggestion: **PID + feedforward from the plant** (+2), added as a variant, not switched on; ranked above it with a plant change: Sliding mode (boundary layer) ⚙ rate observer (+2; a Finite difference observer (Tf 0.0253 s) makes ẏ from y for input 3).

## Conical tank, gain scheduling

Step test for the starts: schedule. Total 2.2 s: load 0.0267 s, starts 0.296 s, tuning 1.43 s, scoring 0.132 s, sweep (8 plants) 0.275 s. One run 4.8 ms, so about 451 runs' worth.

Refused:

- Off (`off`): does nothing: the open loop, not a candidate
- LQR (`lqr`): LQR needs slopes, and the plant has a kink at origin (all states 0, u = 0): the slope of the rate of tank/h along tank/h differs left and right (0 and -56400)
- State feedback (`stateFeedback`): starts from the LQR design, which refused: LQR needs slopes, and the plant has a kink at origin (all states 0, u = 0): the slope of the rate of tank/h along tank/h differs left and right (0 and -56400)
- Deadbeat (`deadbeat`): deadbeat needs slopes, and the plant has a kink at origin (all states 0, u = 0): the slope of the rate of tank/h along tank/h differs left and right (0 and -56400)
- PID + feedforward from the plant (`pidFF`): a feedforward from the plant needs slopes, and the plant has a kink at origin (all states 0, u = 0): the slope of the rate of tank/h along tank/h differs left and right (0 and -56400)
- Swing-up (Lyapunov) + state feedback (`swingUp`): reads x, θ, v, ω of a pendulum on a cart (4 measurements); this block measures 1
- Swing-up + LQR catch (`swingUpLqr`): the swing-up reads x, θ, v, ω (θ an angle) from inputs 2 to 5; this block has h
- Planned swing-up + TV-LQR (`trajectory`): the swing-up pushes both ways: u min must be below 0 and u max above 0 (now 0 to 3)
- Variable gain (Hu–Lin) (`huLin`): LQR needs slopes, and the plant has a kink at origin (all states 0, u = 0): the slope of the rate of tank/h along tank/h differs left and right (0 and -56400)
- Sliding mode (`slidingMode`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)
- Super-twisting (`superTwisting`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)

Plant changes scored (⚙, never applied; complexity +5):

- a Finite difference observer (Tf 0.025 s) makes ẏ from y for input 3

Candidates (J: the goal's cost, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: Gain-scheduled PI | not tuned | 0.0853 | 0 | 0 | yes |
| PID | step test, SIMC at 0.5 (the schedule's middle); no point on the way fits (tuned: unstable where the run starts (2 poles outside)) | 0.0786 → 0.0646 | 78 | 390 | no: unstable where the run starts (2 poles outside); it rests there only because it starts in balance |
| PI from the plant | one level, r's middle; Tcl searched → 0.123; backed off to 0 % of the way (tuned: unstable where the run starts (2 poles outside)) | 0.123 → 0.123 | 19 | 170 | yes |
| Gain-scheduled PI | step tests, a SIMC schedule; backed off to 25 % of the way (tuned: Ms 12) | 0.141 → 0.0822 | 69 | 330 | yes |
| Speed PI from the plant | its defaults | 4.35 → 4.35 | 1 | 5.6 | no: unstable at r's middle (2 poles outside) |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 5.08 → 5.08 | 1 | 4.3 | yes |
| Sliding mode (ideal) ⚙ rate observer | λ from the step model, K the full swing | 5.13 → 5.06 | 20 | 130 | yes |
| Sliding mode (boundary layer) ⚙ rate observer | and φ = 0.2·λ·span r; no point on the way fits (tuned: unstable at r's middle (2 poles outside)) | 5.03 → 3.4 | 76 | 380 | no: unstable at r's middle (2 poles outside) |

Scores:

| Candidate | Following r (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: Gain-scheduled PI | 0.12 | 0.1 | 7.7 % | 1.4 | 0.044 | 0.077 | 0 | 1.5 | 0.086 | 0.0016 | 17 | 0 | 64 | 280 ms |
| PID | 0.095 | 0.069 | 10 % | 0.65 | 0.05 | 0.21 | 0 | 2.8 | 0.067 | 0.034 | 4 | 78 | 39 | 79 ms |
| PI from the plant | 0.14 | 0.12 | 11 % | 1.4 | 0.042 | 0.073 | 0 | 1.5 | 0.13 | 0.0013 | 6 | 19 | 65 | 290 ms |
| Gain-scheduled PI | 0.12 | 0.098 | 8.9 % | 1.4 | 0.049 | 0.12 | 0 | 2.5 | 0.081 | 0.0014 | 17 | 69 | 43 | 95 ms |
| Speed PI from the plant | 0.42 | 0.51 | 160 % | 1.4 | 0.52 | 3.2 | 0 | unstable | 4.1 | 0.3 | 3 | 1 | — | — |
| Relay (on/off) | 0.22 | 0.57 | 180 % | 1.4 | 0.38 | 3 | 1 | no linear model | 5.1 | 0.57 | 2 | 1 | — | — |
| Sliding mode (ideal) ⚙ rate observer | 0.29 | 0.36 | 180 % | 1.4 | 0.4 | 3.5 | 1 | no linear model | 5.1 | 0.64 | 9 | 20 | — | — |
| Sliding mode (boundary layer) ⚙ rate observer | 0.22 | 0.36 | 110 % | 1.4 | 0.22 | 3.7 | 0.6 | unstable | 4.5 | 0.16 | 10 | 76 | — | — |

Pugh matrix: datum **As loaded: Gain-scheduled PI**; weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: Gain-scheduled PI | PID | PI from the plant | Gain-scheduled PI | Speed PI from the plant | Relay (on/off) | Sliding mode (ideal) ⚙ rate observer | Sliding mode (boundary layer) ⚙ rate observer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Following r (IAE) (3) | D | + | − | S | − | − | − | − |
| Rejecting d (IAE) (3) | D | + | − | S | − | − | − | − |
| Overshoot (2) | D | − | − | S | − | − | − | − |
| Settling (2 %, s) (1) | D | + | S | S | S | S | S | S |
| Effort (u swing) (1) | D | S | S | S | − | − | − | − |
| Wear (u travel/s) (2) | D | − | S | S | − | − | − | − |
| Time at a limit (1) | D | S | S | S | S | − | − | − |
| Robustness Ms (2) | D | − | S | − | ? | ? | ? | ? |
| Plant ±15 % (worst J) (3) | D | + | − | S | − | − | − | − |
| Noise → u (2) | D | − | S | S | − | − | − | − |
| Complexity (1) | D | + | + | S | + | + | + | + |
| Tuning runs (1) | D | − | − | − | S | S | − | − |
| **+ / −** | datum | 5 / 5 | 1 / 5 | 0 / 2 | 1 / 7 | 1 / 8 | 1 / 9 | 1 / 9 |
| **Weighted** | 0 | 2 | -11 | -3 | -15 | -16 | -17 | -17 |
| **Fits** | yes | no | yes | yes | no | yes | yes | no |

Ranking (fitting only): 1. As loaded: Gain-scheduled PI (+0); 2. Gain-scheduled PI (-3); 3. PI from the plant (-11); 4. Relay (on/off) (-16); 5. Sliding mode (ideal) ⚙ rate observer (-17).

Suggestion: keep **Gain-scheduled PI**, the running variant: nothing beats it.


# The rest of the library

## Pendulum swing-up

Step test for the starts: relay. Total 2.7 s: load 0.0609 s, starts 0.136 s, tuning 1.7 s, scoring 0.511 s, sweep (8 plants) 0.301 s. One run 6.1 ms, so about 450 runs' worth.

Refused:

- Off (`off`): does nothing: the open loop, not a candidate
- Deadbeat (`deadbeat`): the poles did not all land at z = 0 (0.0002291 of the plant's motion is left after 4 samples): u moves some state too weakly at this sample time
- PI from the plant (`scheduledPI`): x integrates F: it has no static gain
- Gain-scheduled PI (`gainScheduled`): r does not move: there is no range to schedule over
- Speed PI from the plant (`speedPI`): x does not accelerate with F (∂ẏ/∂u = 0): speedPI needs a measured speed
- PID + feedforward from the plant (`pidFF`): the path from F to x has a zero at s = 4.429 in the right half-plane: its inverse is unstable, so no feedforward follows r through it

Candidates (J: the goal's cost, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: Swing-up + LQR catch | not tuned | 0.193 | 0 | 0 | yes |
| PID | relay test, Tyreus–Luyben; backed off to 50 % of the way (tuned: Ms 2300) | 0.00531 → 5.7e-4 | 113 | 460 | yes |
| LQR | Q = 1 for every measurement; R searched → 1 | 67.4 → 67.4 | 15 | 89 | no: unstable at r's middle (1 poles outside) |
| State feedback | the LQR row's gains; no point on the way fits (tuned: unstable at r's middle (1 poles outside)) | 67.4 → 67.4 | 21 | 130 | no: unstable at r's middle (1 poles outside) |
| Swing-up (Lyapunov) + state feedback | its defaults (not iterated: A swing-up switches between pumping energy and catching the ) | 6.49 → 6.49 | 1 | 4 | yes |
| Swing-up + LQR catch | its defaults | 6.49 → 6.49 | 1 | 6.1 | yes |
| Planned swing-up + TV-LQR | its defaults | 0.106 → 0.106 | 1 | 290 | no: unstable at r's middle (1 poles outside) |
| Variable gain (Hu–Lin) | its defaults | 67.4 → 67.4 | 1 | 21 | no: unstable at r's middle (1 poles outside) |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 0.414 → 0.414 | 1 | 3.7 | yes |
| Sliding mode (ideal) | λ from the step model, K the full swing | 7.83 → 0.375 | 26 | 120 | yes |
| Sliding mode (boundary layer) | and φ = 0.2·λ·span r; no point on the way fits (tuned: unstable at r's middle (4 poles outside)) | 2.1 → 0.00745 | 33 | 150 | no: unstable at r's middle (4 poles outside) |
| Super-twisting | λ as the sliding mode; k1 = U/3, k2 = 3.7 U | 3.4 → 0.006 | 125 | 410 | yes |

Scores:

| Candidate | Following r (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: Swing-up + LQR catch | — | 0.024 | 0 % | — | 0.14 | 0.7 | 0.03 | no linear model | 0.19 | 0.054 | 15 | 0 | — | — |
| PID | — | 0.0018 | 0 % | — | 0.016 | 0.079 | 0 | 2.3 | 5.7e-4 | 0.11 | 4 | 110 | 8.8 | 23 ms |
| LQR | — | 150 | 0 % | — | 2.2e-14 | 0 | 1 | unstable | 67 | 0 | 11 | 15 | — | — |
| State feedback | — | 150 | 0 % | — | 2.2e-14 | 0 | 1 | unstable | 67 | 0 | 10 | 21 | — | — |
| Swing-up (Lyapunov) + state feedback | — | 11 | 0 % | — | 0.092 | 0.57 | 0.014 | no linear model | 6.5 | 0.033 | 13 | 1 | — | — |
| Swing-up + LQR catch | — | 11 | 0 % | — | 0.092 | 0.57 | 0.014 | no linear model | 6.5 | 0.033 | 15 | 1 | — | — |
| Planned swing-up + TV-LQR | — | 0.071 | 0 % | — | 0.058 | 0.25 | 0 | unstable | 0.11 | 0.017 | 6 | 1 | — | — |
| Variable gain (Hu–Lin) | — | 150 | 0 % | — | 2.2e-14 | 0 | 1 | unstable | 67 | 0 | 3 | 1 | — | — |
| Relay (on/off) | — | 0.25 | 0 % | — | 0.5 | 3.4 | 1 | no linear model | 0.41 | 0.69 | 2 | 1 | — | — |
| Sliding mode (ideal) | — | 0.24 | 0 % | — | 0.5 | 3.6 | 1 | no linear model | 0.38 | 0.72 | 4 | 26 | — | — |
| Sliding mode (boundary layer) | — | 0.023 | 0 % | — | 0.035 | 0.19 | 0 | unstable | 0.0075 | 0.047 | 5 | 33 | — | — |
| Super-twisting | — | 0.012 | 0 % | — | 0.021 | 0.18 | 0 | no linear model | 0.006 | 0.052 | 5 | 130 | — | — |

Pugh matrix: datum **PID**; weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: Swing-up + LQR catch | PID | LQR | State feedback | Swing-up (Lyapunov) + state feedback | Swing-up + LQR catch | Planned swing-up + TV-LQR | Variable gain (Hu–Lin) | Relay (on/off) | Sliding mode (ideal) | Sliding mode (boundary layer) | Super-twisting |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Following r (IAE) (3) | ? | D | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| Rejecting d (IAE) (3) | − | D | − | − | − | − | − | − | − | − | − | − |
| Overshoot (2) | S | D | S | S | S | S | S | S | S | S | S | S |
| Settling (2 %, s) (1) | ? | D | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| Effort (u swing) (1) | − | D | + | + | − | − | − | + | − | − | − | − |
| Wear (u travel/s) (2) | − | D | + | + | − | − | − | + | − | − | − | − |
| Time at a limit (1) | − | D | − | − | S | S | S | − | − | − | S | S |
| Robustness Ms (2) | ? | D | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| Plant ±15 % (worst J) (3) | − | D | − | − | − | − | − | − | − | − | − | − |
| Noise → u (2) | + | D | + | + | + | + | + | + | − | − | + | + |
| Complexity (1) | − | D | − | − | − | − | − | + | + | S | − | − |
| Tuning runs (1) | + | D | + | + | + | + | + | + | + | + | + | S |
| **+ / −** | 2 / 6 | datum | 4 / 4 | 4 / 4 | 2 / 5 | 2 / 5 | 2 / 5 | 5 / 3 | 2 / 6 | 1 / 6 | 2 / 5 | 1 / 5 |
| **Weighted** | -8 | 0 | -2 | -2 | -7 | -7 | -7 | 0 | -10 | -11 | -7 | -8 |
| **Fits** | yes | yes | no | no | yes | yes | no | no | yes | yes | no | yes |

Ranking (fitting only): 1. PID (+0); 2. Swing-up + LQR catch (-7); 3. Swing-up (Lyapunov) + state feedback (-7); 4. Super-twisting (-8); 5. As loaded: Swing-up + LQR catch (-8); 6. Relay (on/off) (-10); 7. Sliding mode (ideal) (-11).

Suggestion: **PID** (+0), added as a variant, not switched on.

## DC motor, position control

Step test for the starts: integrating. Total 1.6 s: load 0.0211 s, starts 0.045 s, tuning 1.27 s, scoring 0.0912 s, sweep (8 plants) 0.208 s. One run 3.4 ms, so about 486 runs' worth.

Refused:

- Off (`off`): does nothing: the open loop, not a candidate
- LQR (`lqr`): LQR needs every state measured. This block sees angle but not Motor/armature 1/(Ls + R) and Motor/rotor 1/(Js + b).
- State feedback (`stateFeedback`): starts from the LQR design, which refused: LQR needs every state measured. This block sees angle but not Motor/armature 1/(Ls + R) and Motor/rotor 1/(Js + b).
- Deadbeat (`deadbeat`): deadbeat state feedback needs every state measured. This block sees angle but not Motor/armature 1/(Ls + R) and Motor/rotor 1/(Js + b).
- PI from the plant (`scheduledPI`): angle integrates V: it has no static gain
- Speed PI from the plant (`speedPI`): angle does not accelerate with V (∂ẏ/∂u = 0): speedPI needs a measured speed
- Swing-up (Lyapunov) + state feedback (`swingUp`): reads x, θ, v, ω of a pendulum on a cart (4 measurements); this block measures 1
- Swing-up + LQR catch (`swingUpLqr`): the swing-up reads x, θ, v, ω (θ an angle) from inputs 2 to 5; this block has angle
- Planned swing-up + TV-LQR (`trajectory`): LQR needs every state measured. This block sees angle but not Motor/armature 1/(Ls + R) and Motor/rotor 1/(Js + b).
- Variable gain (Hu–Lin) (`huLin`): LQR needs every state measured. This block sees angle but not Motor/armature 1/(Ls + R) and Motor/rotor 1/(Js + b).
- Sliding mode (`slidingMode`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)
- Super-twisting (`superTwisting`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)

Plant changes scored (⚙, never applied; complexity +5):

- a Finite difference observer (Tf 0.01 s) makes ẏ from y for input 3

Candidates (J: the goal's cost, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: P, too aggressive | not tuned | 1.27 | 0 | 0 | no: fragile: Ms 4.7 at r's middle (at most 3), PM 15° |
| PID | step test, SIMC (integrating) | 0.13 → 0.111 | 91 | 340 | yes |
| Gain-scheduled PI | the PID's gains, flat | 1.17 → 0.114 | 61 | 310 | yes |
| PID + feedforward from the plant | the PID row's gains; Kff, Kv, Ka from the plant; Tr searched → 0.0277 | 0.112 → 0.11 | 15 | 140 | yes |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 1.55 → 1.55 | 1 | 3 | yes |
| Sliding mode (ideal) ⚙ rate observer | λ from the step model, K the full swing | 0.32 → 0.32 | 32 | 180 | yes |
| Sliding mode (boundary layer) ⚙ rate observer | and φ = 0.2·λ·span r | 0.119 → 0.11 | 52 | 260 | yes |

Scores:

| Candidate | Following r (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: P, too aggressive | 0.16 | 0.023 | 24 % | 0.83 | 0.25 | 3.6 | 0.16 | 4.7 | 1.9 | 0.023 | 2 | 0 | 15 | 9.9 ms |
| PID | 0.11 | 0.0076 | 0.87 % | 0.2 | 0.16 | 1.2 | 0.088 | 1.9 | 0.13 | 0.037 | 4 | 91 | 44 | 31 ms |
| Gain-scheduled PI | 0.14 | 0.03 | 6.5 % | 0.47 | 0.14 | 0.86 | 0 | 1.4 | 0.54 | 0.0042 | 6 | 61 | 61 | 130 ms |
| PID + feedforward from the plant | 0.12 | 0.0076 | 0.36 % | 0.2 | 0.16 | 1.2 | 0.08 | 1.9 | 0.15 | 0.037 | 9 | 15 | 44 | 31 ms |
| Relay (on/off) | 0.22 | 0.11 | 26 % | 0.99 | 0.5 | 9 | 1 | no linear model | 2.3 | 0.52 | 2 | 1 | — | — |
| Sliding mode (ideal) ⚙ rate observer | 0.14 | 0.038 | 6.4 % | 0.98 | 0.49 | 17 | 0.95 | no linear model | 0.35 | 0.42 | 9 | 32 | — | — |
| Sliding mode (boundary layer) ⚙ rate observer | 0.12 | 0.0098 | 0.62 % | 0.21 | 0.16 | 1 | 0.08 | 1.3 | 0.13 | 0.011 | 10 | 52 | 61 | 56 ms |

Pugh matrix: datum **PID**; weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: P, too aggressive | PID | Gain-scheduled PI | PID + feedforward from the plant | Relay (on/off) | Sliding mode (ideal) ⚙ rate observer | Sliding mode (boundary layer) ⚙ rate observer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Following r (IAE) (3) | − | D | − | S | − | − | S |
| Rejecting d (IAE) (3) | − | D | − | S | − | − | − |
| Overshoot (2) | − | D | − | S | − | − | S |
| Settling (2 %, s) (1) | − | D | − | S | − | − | S |
| Effort (u swing) (1) | − | D | + | S | − | − | S |
| Wear (u travel/s) (2) | − | D | + | S | − | − | S |
| Time at a limit (1) | − | D | + | S | − | − | S |
| Robustness Ms (2) | − | D | + | S | ? | ? | + |
| Plant ±15 % (worst J) (3) | − | D | − | − | − | − | S |
| Noise → u (2) | + | D | + | S | − | − | + |
| Complexity (1) | + | D | − | − | + | − | − |
| Tuning runs (1) | + | D | S | + | + | + | S |
| **+ / −** | 3 / 9 | datum | 5 / 6 | 1 / 2 | 2 / 9 | 1 / 10 | 2 / 2 |
| **Weighted** | -14 | 0 | -5 | -3 | -16 | -18 | 0 |
| **Fits** | no | yes | yes | yes | yes | yes | yes |

Ranking (fitting only): 1. Sliding mode (boundary layer) ⚙ rate observer (+0); 2. PID (+0); 3. PID + feedforward from the plant (-3); 4. Gain-scheduled PI (-5); 5. Relay (on/off) (-16); 6. Sliding mode (ideal) ⚙ rate observer (-18).

Suggestion: **PID** (+0), added as a variant, not switched on; ranked above it with a plant change: Sliding mode (boundary layer) ⚙ rate observer (+0; a Finite difference observer (Tf 0.01 s) makes ẏ from y for input 3).

## Triple pendulum

Step test for the starts: relay. Total 8.6 s: load 3.46 s, starts 0.119 s, tuning 2.46 s, scoring 2 s, sweep (8 plants) 0.498 s. One run 5.3 ms, so about 1608 runs' worth.

Refused:

- Off (`off`): does nothing: the open loop, not a candidate
- Deadbeat (`deadbeat`): the poles did not all land at z = 0 (494300000 of the plant's motion is left after 8 samples): u moves some state too weakly at this sample time
- PI from the plant (`scheduledPI`): x integrates F: it has no static gain
- Gain-scheduled PI (`gainScheduled`): r does not move: there is no range to schedule over
- Speed PI from the plant (`speedPI`): x does not accelerate with F (∂ẏ/∂u = 0): speedPI needs a measured speed
- Swing-up + LQR catch (`swingUpLqr`): the swing-up reads x, θ, v, ω (θ an angle) from inputs 2 to 5; this block has x, θ1, θ2, θ3, v, ω1, ω2, ω3

Candidates (J: the goal's cost, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: Planned swing-up + TV-LQR | not tuned | 0.219 | 0 | 0 | no: unstable at r's middle (3 poles outside) |
| PID | relay test, Tyreus–Luyben; backed off to 25 % of the way (tuned: unstable at r's middle (2 poles outside)) | 0.0103 → 0.00355 | 115 | 690 | yes |
| LQR | Q = 1 for every measurement; R searched → 2.23; no point on the way fits (tuned: unstable at r's middle (3 poles outside)) | 32.6 → 20.5 | 19 | 190 | no: unstable at r's middle (3 poles outside) |
| State feedback | the LQR row's gains; no point on the way fits (tuned: unstable at r's middle (5 poles outside)) | 20.5 → 14.3 | 84 | 470 | no: unstable at r's middle (5 poles outside) |
| PID + feedforward from the plant | the PID row's gains; Kff, Kv, Ka from the plant; Tr searched → 0.25 | 0.00355 → 0.00355 | 15 | 82 | yes |
| Swing-up (Lyapunov) + state feedback | its defaults (not iterated: A swing-up switches between pumping energy and catching the ) | 78.3 → 78.3 | 1 | 5.1 | yes |
| Planned swing-up + TV-LQR | its defaults | 0.244 → 0.244 | 1 | 10 | no: unstable at r's middle (3 poles outside) |
| Variable gain (Hu–Lin) | its defaults | 24.5 → 24.5 | 1 | 27 | no: unstable at r's middle (3 poles outside) |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 0.733 → 0.733 | 1 | 5.3 | yes |
| Sliding mode (ideal) | λ from the step model, K the full swing | 25.6 → 1.12 | 27 | 180 | yes |
| Sliding mode (boundary layer) | and φ = 0.2·λ·span r; no point on the way fits (tuned: unstable at r's middle (8 poles outside)) | 8.17 → 1.69 | 49 | 320 | no: unstable at r's middle (8 poles outside) |
| Super-twisting | λ as the sliding mode; k1 = U/3, k2 = 3.7 U | 13.9 → 1.21 | 79 | 460 | yes |

Scores:

| Candidate | Following r (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: Planned swing-up + TV-LQR | — | 0.046 | 0 % | — | 0.069 | 0.43 | 0 | unstable | 0.22 | 0.39 | 10 | 0 | — | — |
| PID | — | 0.012 | 0 % | — | 0.0076 | 0.031 | 0 | 2.6 | 0.0036 | 0.027 | 4 | 120 | 10 | 34 ms |
| LQR | — | 32 | 0 % | — | 0.48 | 4.4 | 1 | unstable | 21 | 0.75 | 19 | 19 | — | — |
| State feedback | — | 13 | 0 % | — | 0.49 | 3.4 | 1 | unstable | 14 | 0.16 | 18 | 84 | — | — |
| PID + feedforward from the plant | — | 0.012 | 0 % | — | 0.0076 | 0.031 | 0 | 2.6 | 0.0036 | 0.027 | 10 | 15 | 10 | 34 ms |
| Swing-up (Lyapunov) + state feedback | — | 170 | 0 % | — | 0.18 | 1.7 | 0.07 | no linear model | 78 | 0.21 | 17 | 1 | — | — |
| Planned swing-up + TV-LQR | — | 0.13 | 0 % | — | 0.07 | 0.43 | 0 | unstable | 0.24 | 0.38 | 10 | 1 | — | — |
| Variable gain (Hu–Lin) | — | 36 | 0 % | — | 0.45 | 2.8 | 0.98 | unstable | 25 | 0.45 | 3 | 1 | — | — |
| Relay (on/off) | — | 0.75 | 0 % | — | 0.5 | 4.4 | 1 | no linear model | 0.73 | 0.7 | 2 | 1 | — | — |
| Sliding mode (ideal) | — | 1.7 | 0 % | — | 0.5 | 3.4 | 1 | no linear model | 1.1 | 0 | 4 | 27 | — | — |
| Sliding mode (boundary layer) | — | 1.9 | 0 % | — | 0.47 | 3.3 | 0.83 | unstable | 1.7 | 0.63 | 5 | 49 | — | — |
| Super-twisting | — | 2.3 | 0 % | — | 0.35 | 3.1 | 0.11 | no linear model | 1.2 | 0.45 | 5 | 79 | — | — |

Pugh matrix: datum **PID**; weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: Planned swing-up + TV-LQR | PID | LQR | State feedback | PID + feedforward from the plant | Swing-up (Lyapunov) + state feedback | Planned swing-up + TV-LQR | Variable gain (Hu–Lin) | Relay (on/off) | Sliding mode (ideal) | Sliding mode (boundary layer) | Super-twisting |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Following r (IAE) (3) | ? | D | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| Rejecting d (IAE) (3) | − | D | − | − | S | − | − | − | − | − | − | − |
| Overshoot (2) | S | D | S | S | S | S | S | S | S | S | S | S |
| Settling (2 %, s) (1) | ? | D | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| Effort (u swing) (1) | − | D | − | − | S | − | − | − | − | − | − | − |
| Wear (u travel/s) (2) | − | D | − | − | S | − | − | − | − | − | − | − |
| Time at a limit (1) | S | D | − | − | S | − | S | − | − | − | − | − |
| Robustness Ms (2) | ? | D | ? | ? | S | ? | ? | ? | ? | ? | ? | ? |
| Plant ±15 % (worst J) (3) | − | D | − | − | S | − | − | − | − | − | − | − |
| Noise → u (2) | − | D | − | − | S | − | − | − | − | + | − | − |
| Complexity (1) | − | D | − | − | − | − | − | + | + | S | − | − |
| Tuning runs (1) | + | D | + | S | + | + | + | + | + | + | + | S |
| **+ / −** | 1 / 6 | datum | 1 / 7 | 0 / 7 | 1 / 1 | 1 / 7 | 1 / 6 | 2 / 6 | 2 / 6 | 2 / 5 | 1 / 7 | 0 / 7 |
| **Weighted** | -11 | 0 | -12 | -13 | 0 | -12 | -11 | -10 | -10 | -7 | -12 | -13 |
| **Fits** | no | yes | no | no | yes | yes | no | no | yes | yes | no | yes |

Ranking (fitting only): 1. PID (+0); 2. PID + feedforward from the plant (+0); 3. Sliding mode (ideal) (-7); 4. Relay (on/off) (-10); 5. Swing-up (Lyapunov) + state feedback (-12); 6. Super-twisting (-13).

Suggestion: **PID** (+0), added as a variant, not switched on.

## Following a sine (XY)

Step test for the starts: integrating. Total 1.6 s: load 0.00872 s, starts 0.036 s, tuning 1.26 s, scoring 0.0919 s, sweep (8 plants) 0.207 s. One run 3.4 ms, so about 479 runs' worth.

Refused:

- Off (`off`): does nothing: the open loop, not a candidate
- LQR (`lqr`): LQR needs every state measured. This block sees angle but not Motor/armature 1/(Ls + R) and Motor/rotor 1/(Js + b).
- State feedback (`stateFeedback`): starts from the LQR design, which refused: LQR needs every state measured. This block sees angle but not Motor/armature 1/(Ls + R) and Motor/rotor 1/(Js + b).
- Deadbeat (`deadbeat`): deadbeat state feedback needs every state measured. This block sees angle but not Motor/armature 1/(Ls + R) and Motor/rotor 1/(Js + b).
- PI from the plant (`scheduledPI`): angle integrates V: it has no static gain
- Speed PI from the plant (`speedPI`): angle does not accelerate with V (∂ẏ/∂u = 0): speedPI needs a measured speed
- Swing-up (Lyapunov) + state feedback (`swingUp`): reads x, θ, v, ω of a pendulum on a cart (4 measurements); this block measures 1
- Swing-up + LQR catch (`swingUpLqr`): the swing-up reads x, θ, v, ω (θ an angle) from inputs 2 to 5; this block has angle
- Planned swing-up + TV-LQR (`trajectory`): LQR needs every state measured. This block sees angle but not Motor/armature 1/(Ls + R) and Motor/rotor 1/(Js + b).
- Variable gain (Hu–Lin) (`huLin`): LQR needs every state measured. This block sees angle but not Motor/armature 1/(Ls + R) and Motor/rotor 1/(Js + b).
- Sliding mode (`slidingMode`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)
- Super-twisting (`superTwisting`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)

Plant changes scored (⚙, never applied; complexity +5):

- a Finite difference observer (Tf 0.01 s) makes ẏ from y for input 3

Candidates (J: the goal's cost, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: P | not tuned | 0.087 | 0 | 0 | yes |
| PID | step test, SIMC (integrating); backed off to 50 % of the way (tuned: Ms 14) | 0.0121 → 0.0039 | 105 | 420 | yes |
| Gain-scheduled PI | the PID's gains, flat; no point on the way fits (tuned: Ms 9.2) | 0.183 → 0.00444 | 58 | 230 | no: fragile: Ms 9.2 at r's middle (at most 3), PM 6.8° |
| PID + feedforward from the plant | the PID row's gains; Kff, Kv, Ka from the plant; Tr searched → 0.00176 | 0.0178 → 3.3e-4 | 15 | 100 | yes |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 0.326 → 0.326 | 1 | 3.2 | yes |
| Sliding mode (ideal) ⚙ rate observer | λ from the step model, K the full swing | 0.252 → 0.252 | 23 | 130 | yes |
| Sliding mode (boundary layer) ⚙ rate observer | and φ = 0.2·λ·span r; backed off to 25 % of the way (tuned: Ms 15) | 0.0287 → 0.0123 | 78 | 370 | yes |

Scores:

| Candidate | Following r (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: P | — | — | 0 % | — | 0.024 | 0.034 | 0 | 1.2 | 0.096 | 0.0014 | 2 | 0 | 75 | 310 ms |
| PID | — | — | 0 % | — | 0.027 | 0.052 | 0 | 2.7 | 0.0041 | 0.047 | 4 | 110 | 31 | 16 ms |
| Gain-scheduled PI | — | — | 0 % | — | 0.029 | 0.14 | 0 | 9.2 | 0.028 | 0.019 | 7 | 58 | 6.8 | 5 ms |
| PID + feedforward from the plant | — | — | 0 % | — | 0.029 | 0.16 | 0 | 2.7 | 5.2e-4 | 0.047 | 9 | 15 | 31 | 16 ms |
| Relay (on/off) | — | — | 0 % | — | 0.5 | 10 | 1 | no linear model | 0.35 | 0.43 | 2 | 1 | — | — |
| Sliding mode (ideal) ⚙ rate observer | — | — | 0 % | — | 0.5 | 19 | 1 | no linear model | 0.27 | 0.79 | 9 | 23 | — | — |
| Sliding mode (boundary layer) ⚙ rate observer | — | — | 0 % | — | 0.027 | 0.072 | 0 | 2.7 | 0.013 | 0.018 | 10 | 78 | 25 | 16 ms |

Pugh matrix: datum **PID**; weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: P | PID | Gain-scheduled PI | PID + feedforward from the plant | Relay (on/off) | Sliding mode (ideal) ⚙ rate observer | Sliding mode (boundary layer) ⚙ rate observer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Following r (IAE) (3) | ? | D | ? | ? | ? | ? | ? |
| Rejecting d (IAE) (3) | ? | D | ? | ? | ? | ? | ? |
| Overshoot (2) | S | D | S | S | S | S | S |
| Settling (2 %, s) (1) | ? | D | ? | ? | ? | ? | ? |
| Effort (u swing) (1) | S | D | S | S | − | − | S |
| Wear (u travel/s) (2) | S | D | − | − | − | − | S |
| Time at a limit (1) | S | D | S | S | − | − | S |
| Robustness Ms (2) | + | D | − | S | ? | ? | S |
| Plant ±15 % (worst J) (3) | − | D | − | S | − | − | − |
| Noise → u (2) | + | D | + | S | − | − | + |
| Complexity (1) | + | D | − | − | + | − | − |
| Tuning runs (1) | + | D | S | + | + | + | S |
| **+ / −** | 4 / 1 | datum | 1 / 4 | 1 / 2 | 2 / 5 | 1 / 6 | 1 / 2 |
| **Weighted** | 3 | 0 | -6 | -2 | -7 | -9 | -2 |
| **Fits** | yes | yes | no | yes | yes | yes | yes |

Ranking (fitting only): 1. As loaded: P (+3); 2. PID (+0); 3. PID + feedforward from the plant (-2); 4. Sliding mode (boundary layer) ⚙ rate observer (-2); 5. Relay (on/off) (-7); 6. Sliding mode (ideal) ⚙ rate observer (-9).

Suggestion: keep **P**, the running variant: nothing beats it.

## Encoder errors and torque ripple

Step test for the starts: fopdt. Total 11.1 s: load 0.1 s, starts 0.219 s, tuning 7.64 s, scoring 0.588 s, sweep (8 plants) 2.41 s. One run 33 ms, so about 338 runs' worth.

Refused:

- Off (`off`): does nothing: the open loop, not a candidate
- LQR (`lqr`): the plant is not at rest at the origin: speed from angle moves at -18000/s with V = 0
- State feedback (`stateFeedback`): starts from the LQR design, which refused: the plant is not at rest at the origin: speed from angle moves at -18000/s with V = 0
- Deadbeat (`deadbeat`): the plant is not at rest at the origin: speed from angle moves at -18000/s with V = 0
- PI from the plant (`scheduledPI`): no equilibrium with speed from angle = 150: the best found leaves a residual of 68200
- Speed PI from the plant (`speedPI`): speed from angle is no state of the plant this lane sees: speedPI needs a measured speed
- Swing-up (Lyapunov) + state feedback (`swingUp`): reads x, θ, v, ω of a pendulum on a cart (4 measurements); this block measures 1
- Swing-up + LQR catch (`swingUpLqr`): the swing-up reads x, θ, v, ω (θ an angle) from inputs 2 to 5; this block has speed from angle
- Planned swing-up + TV-LQR (`trajectory`): the plant is not at rest at the origin: speed from angle moves at -18000/s with V = 0
- Variable gain (Hu–Lin) (`huLin`): the plant is not at rest at the origin: speed from angle moves at -18000/s with V = 0
- Sliding mode (`slidingMode`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)
- Super-twisting (`superTwisting`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)

Plant changes scored (⚙, never applied; complexity +5):

- a Finite difference observer (Tf 0.00425 s) makes ẏ from y for input 3

Candidates (J: the goal's cost, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: PI speed | not tuned | 0.0159 | 0 | 0 | yes |
| PID | step test, SIMC (fopdt) | 0.0148 → 0.0106 | 60 | 2400 | yes |
| Gain-scheduled PI | the PID's gains, flat | 0.0106 → 0.0106 | 33 | 1500 | yes |
| PID + feedforward from the plant | the PID row's gains; Kff, Kv, Ka from the plant; Tr searched → 0.00145 | 0.801 → 0.637 | 15 | 940 | yes |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 0.361 → 0.361 | 1 | 33 | yes |
| Sliding mode (ideal) ⚙ rate observer | λ from the step model, K the full swing | 0.743 → 0.372 | 17 | 1200 | yes |
| Sliding mode (boundary layer) ⚙ rate observer | and φ = 0.2·λ·span r; no point on the way fits (tuned: unstable where the run starts (3 poles outside)) | 0.734 → 0.149 | 34 | 1500 | no: unstable where the run starts (3 poles outside); it rests there only because it starts in balance |

Scores:

| Candidate | Following r (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: PI speed | — | — | 0 % | — | 0.16 | 4.9 | 0.011 | no linear model | 0.091 | 0.0095 | 3 | 0 | — | — |
| PID | — | — | 0 % | — | 0.16 | 0.38 | 0 | no linear model | 0.086 | 0.0016 | 3 | 60 | — | — |
| Gain-scheduled PI | — | — | 0 % | — | 0.16 | 0.38 | 0 | no linear model | 0.086 | 0.0016 | 6 | 33 | — | — |
| PID + feedforward from the plant | — | — | 0 % | — | 0.17 | 0.5 | 0.9 | no linear model | 0.89 | 7.5e-4 | 9 | 15 | — | — |
| Relay (on/off) | — | — | 0 % | — | 0.46 | 110 | 1 | no linear model | 0.46 | 0.44 | 2 | 1 | — | — |
| Sliding mode (ideal) ⚙ rate observer | — | — | 0 % | — | 0.46 | 110 | 1 | no linear model | 0.47 | 0.52 | 9 | 17 | — | — |
| Sliding mode (boundary layer) ⚙ rate observer | — | — | 0 % | — | 0.24 | 58 | 0.19 | no linear model | 0.33 | 0.072 | 10 | 34 | — | — |

Pugh matrix: datum **PID**; weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: PI speed | PID | Gain-scheduled PI | PID + feedforward from the plant | Relay (on/off) | Sliding mode (ideal) ⚙ rate observer | Sliding mode (boundary layer) ⚙ rate observer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Following r (IAE) (3) | ? | D | ? | ? | ? | ? | ? |
| Rejecting d (IAE) (3) | ? | D | ? | ? | ? | ? | ? |
| Overshoot (2) | S | D | S | S | S | S | S |
| Settling (2 %, s) (1) | ? | D | ? | ? | ? | ? | ? |
| Effort (u swing) (1) | S | D | S | S | − | − | − |
| Wear (u travel/s) (2) | − | D | S | − | − | − | − |
| Time at a limit (1) | S | D | S | − | − | − | − |
| Robustness Ms (2) | ? | D | ? | ? | ? | ? | ? |
| Plant ±15 % (worst J) (3) | S | D | S | − | − | − | − |
| Noise → u (2) | − | D | S | S | − | − | − |
| Complexity (1) | S | D | − | − | + | − | − |
| Tuning runs (1) | + | D | S | + | + | + | S |
| **+ / −** | 1 / 2 | datum | 0 / 1 | 1 / 4 | 2 / 5 | 1 / 6 | 0 / 6 |
| **Weighted** | -3 | 0 | -1 | -6 | -7 | -9 | -10 |
| **Fits** | yes | yes | yes | yes | yes | yes | no |

Ranking (fitting only): 1. PID (+0); 2. Gain-scheduled PI (-1); 3. As loaded: PI speed (-3); 4. PID + feedforward from the plant (-6); 5. Relay (on/off) (-7); 6. Sliding mode (ideal) ⚙ rate observer (-9).

Suggestion: **PID** (+0), added as a variant, not switched on.

## DC motor, speed from an encoder

Step test for the starts: relay. Total 6.4 s: load 0.0538 s, starts 0.429 s, tuning 4.23 s, scoring 0.354 s, sweep (8 plants) 1.19 s. One run 19 ms, so about 343 runs' worth.

Refused:

- Off (`off`): does nothing: the open loop, not a candidate
- LQR (`lqr`): V moves none of the measurements (x̂2)
- State feedback (`stateFeedback`): starts from the LQR design, which refused: V moves none of the measurements (x̂2)
- Deadbeat (`deadbeat`): V moves none of the measurements (x̂2)
- PI from the plant (`scheduledPI`): no equilibrium with x̂2 = 5: the best found leaves a residual of 5
- Speed PI from the plant (`speedPI`): x̂2 is no state of the plant this lane sees: speedPI needs a measured speed
- PID + feedforward from the plant (`pidFF`): V does not reach x̂2
- Swing-up (Lyapunov) + state feedback (`swingUp`): reads x, θ, v, ω of a pendulum on a cart (4 measurements); this block measures 1
- Swing-up + LQR catch (`swingUpLqr`): the swing-up reads x, θ, v, ω (θ an angle) from inputs 2 to 5; this block has x̂2
- Planned swing-up + TV-LQR (`trajectory`): V moves none of the measurements (x̂2)
- Variable gain (Hu–Lin) (`huLin`): V moves none of the measurements (x̂2)
- Sliding mode (`slidingMode`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)
- Super-twisting (`superTwisting`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)

Plant changes scored (⚙, never applied; complexity +5):

- a Finite difference observer (Tf 0.025 s) makes ẏ from y for input 3
- input 2 measures motor's output directly, the rate of angle that 'speed estimator' (Finite difference) estimated

Candidates (J: the goal's cost, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: PI speed | not tuned | 3 | 0 | 0 | yes |
| PID | relay test, Tyreus–Luyben | 4.19 → 4.19 | 40 | 910 | yes |
| Gain-scheduled PI | the PID's gains, flat | 4.19 → 4.19 | 46 | 1100 | yes |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 3.2 → 3.2 | 1 | 18 | yes |
| Sliding mode (ideal) ⚙ rate observer | λ from the step model, K the full swing | 3.36 → 3.36 | 5 | 120 | yes |
| Sliding mode (boundary layer) ⚙ rate observer | and φ = 0.2·λ·span r | 3.36 → 3.36 | 8 | 200 | yes |
| As loaded ⚙ sensor | not tuned | 0.0128 | 0 | 0 | yes |
| PID ⚙ sensor | relay test, Tyreus–Luyben | 1.42 → 0.0121 | 108 | 1900 | yes |

Scores:

| Candidate | Following r (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: PI speed | 0.32 | 0.31 | 130 % | 1.7 | 0.27 | 390 | 0.12 | no linear model | 4.2 | 0.31 | 3 | 0 | — | — |
| PID | 0.3 | 0.31 | 130 % | 1.7 | 0.14 | 130 | 0.0026 | no linear model | 4.2 | 0.11 | 4 | 40 | — | — |
| Gain-scheduled PI | 0.3 | 0.31 | 130 % | 1.7 | 0.13 | 110 | 0.0018 | no linear model | 4.2 | 0.095 | 6 | 46 | — | — |
| Relay (on/off) | 0.35 | 0.31 | 130 % | 1.7 | 0.48 | 640 | 1 | no linear model | 4.4 | 0.48 | 2 | 1 | — | — |
| Sliding mode (ideal) ⚙ rate observer | 0.61 | 0.31 | 130 % | 1.7 | 0.48 | 750 | 0.96 | no linear model | 3.4 | 0.63 | 9 | 5 | — | — |
| Sliding mode (boundary layer) ⚙ rate observer | 0.61 | 0.31 | 130 % | 1.7 | 0.48 | 750 | 0.96 | no linear model | 3.4 | 0.56 | 10 | 8 | — | — |
| As loaded ⚙ sensor | 0.016 | 0.0014 | 9.9 % | 0.12 | 0.11 | 0.39 | 0.0048 | 1.4 | 0.14 | 0.0043 | 8 | 0 | 58 | 20 ms |
| PID ⚙ sensor | 0.016 | 0.0019 | 5.9 % | 0.098 | 0.11 | 0.28 | 0.0014 | 1.3 | 0.051 | 0.0029 | 9 | 110 | 64 | 32 ms |

Pugh matrix: datum **PID**; weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: PI speed | PID | Gain-scheduled PI | Relay (on/off) | Sliding mode (ideal) ⚙ rate observer | Sliding mode (boundary layer) ⚙ rate observer | Loaded ⚙ sensor | PID ⚙ sensor |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Following r (IAE) (3) | S | D | S | − | − | − | + | + |
| Rejecting d (IAE) (3) | S | D | S | S | S | S | + | + |
| Overshoot (2) | S | D | S | S | S | S | + | + |
| Settling (2 %, s) (1) | S | D | S | S | S | S | + | + |
| Effort (u swing) (1) | − | D | S | − | − | − | + | + |
| Wear (u travel/s) (2) | − | D | S | − | − | − | + | + |
| Time at a limit (1) | − | D | S | − | − | − | S | S |
| Robustness Ms (2) | ? | D | ? | ? | ? | ? | ? | ? |
| Plant ±15 % (worst J) (3) | S | D | S | S | + | + | + | + |
| Noise → u (2) | − | D | S | − | − | − | + | + |
| Complexity (1) | + | D | − | + | − | − | − | − |
| Tuning runs (1) | + | D | S | + | + | + | + | − |
| **+ / −** | 2 / 4 | datum | 0 / 1 | 2 / 5 | 2 / 6 | 2 / 6 | 9 / 1 | 8 / 2 |
| **Weighted** | -4 | 0 | -1 | -7 | -6 | -6 | 17 | 15 |
| **Fits** | yes | yes | yes | yes | yes | yes | yes | yes |

Ranking (fitting only): 1. As loaded ⚙ sensor (+17); 2. PID ⚙ sensor (+15); 3. PID (+0); 4. Gain-scheduled PI (-1); 5. As loaded: PI speed (-4); 6. Sliding mode (ideal) ⚙ rate observer (-6); 7. Sliding mode (boundary layer) ⚙ rate observer (-6); 8. Relay (on/off) (-7).

Suggestion: **PID** (+0), added as a variant, not switched on; ranked above it with a plant change: As loaded ⚙ sensor (+17; input 2 measures motor's output directly, the rate of angle that 'speed estimator' (Finite difference) estimated); PID ⚙ sensor (+15; input 2 measures motor's output directly, the rate of angle that 'speed estimator' (Finite difference) estimated).

## DC motor with an unbalanced arm

Step test for the starts: relay. Total 6.4 s: load 0.0284 s, starts 0.298 s, tuning 4.94 s, scoring 0.257 s, sweep (8 plants) 0.817 s. One run 12 ms, so about 513 runs' worth.

Refused:

- Off (`off`): does nothing: the open loop, not a candidate
- LQR (`lqr`): LQR needs every state measured. This block sees angle but not Motor and arm/armature 1/(Ls + R) and Motor and arm/rotor 1/(Js + b).
- State feedback (`stateFeedback`): starts from the LQR design, which refused: LQR needs every state measured. This block sees angle but not Motor and arm/armature 1/(Ls + R) and Motor and arm/rotor 1/(Js + b).
- Deadbeat (`deadbeat`): deadbeat state feedback needs every state measured. This block sees angle but not Motor and arm/armature 1/(Ls + R) and Motor and arm/rotor 1/(Js + b).
- Speed PI from the plant (`speedPI`): angle (Motor and arm) does not accelerate with V (∂ẏ/∂u = 0): speedPI needs a measured speed
- Swing-up (Lyapunov) + state feedback (`swingUp`): reads x, θ, v, ω of a pendulum on a cart (4 measurements); this block measures 1
- Swing-up + LQR catch (`swingUpLqr`): the swing-up reads x, θ, v, ω (θ an angle) from inputs 2 to 5; this block has angle (Motor and arm)
- Planned swing-up + TV-LQR (`trajectory`): LQR needs every state measured. This block sees angle but not Motor and arm/armature 1/(Ls + R) and Motor and arm/rotor 1/(Js + b).
- Variable gain (Hu–Lin) (`huLin`): LQR needs every state measured. This block sees angle but not Motor and arm/armature 1/(Ls + R) and Motor and arm/rotor 1/(Js + b).
- Sliding mode (`slidingMode`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)
- Super-twisting (`superTwisting`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)

Plant changes scored (⚙, never applied; complexity +5):

- a Finite difference observer (Tf 0.025 s) makes ẏ from y for input 3

Candidates (J: the goal's cost, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: PID | not tuned | 0.152 | 0 | 0 | yes |
| PID | relay test, Tyreus–Luyben | 0.433 → 0.0429 | 112 | 1500 | yes |
| PI from the plant | one level, r's middle; Tcl searched → 0.107 | 3.66 → 2.65 | 15 | 320 | yes |
| Gain-scheduled PI | PI from the plant at 3 levels | 2.68 → 2.4 | 89 | 1200 | yes |
| PID + feedforward from the plant | the PID row's gains; Kff, Kv, Ka from the plant; Tr searched → 1.03 | 6.6 → 0.295 | 15 | 320 | yes |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 4.03 → 4.03 | 1 | 12 | yes |
| Sliding mode (ideal) ⚙ rate observer | λ from the step model, K the full swing | 0.345 → 0.274 | 13 | 290 | yes |
| Sliding mode (boundary layer) ⚙ rate observer | and φ = 0.2·λ·span r | 0.274 → 0.0695 | 80 | 1200 | yes |

Scores:

| Candidate | Following r (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: PID | 0.08 | 0.019 | 14 % | 0.69 | 0.09 | 0.62 | 0.012 | 1.8 | 0.63 | 0.018 | 4 | 0 | 32 | 530 ms |
| PID | 0.058 | 0.0095 | 2.8 % | 0.18 | 0.11 | 0.8 | 0.022 | 1.4 | 0.076 | 0.036 | 4 | 110 | 42 | 480 ms |
| PI from the plant | 0.42 | 0.33 | 70 % | 1.5 | 0.47 | 5.7 | 0.87 | 1.1 | 4.2 | 0.59 | 5 | 15 | 85 | 160 ms |
| Gain-scheduled PI | 0.41 | 0.32 | 70 % | 1.5 | 0.47 | 5.7 | 0.86 | 1.1 | 4.2 | 0.34 | 9 | 89 | 85 | 160 ms |
| PID + feedforward from the plant | 0.32 | 0.32 | 9.7 % | 1.5 | 0.11 | 0.87 | 0.03 | 1.4 | 1.2 | 0.037 | 10 | 15 | 42 | 480 ms |
| Relay (on/off) | 0.48 | 0.44 | 110 % | 1.5 | 0.5 | 6.8 | 1 | no linear model | 4.3 | 0.68 | 2 | 1 | — | — |
| Sliding mode (ideal) ⚙ rate observer | 0.12 | 0.047 | 5.8 % | 1.5 | 0.47 | 16 | 0.9 | no linear model | 0.3 | 0.64 | 9 | 13 | — | — |
| Sliding mode (boundary layer) ⚙ rate observer | 0.089 | 0.0031 | 9.5 % | 1.5 | 0.17 | 2.4 | 0.068 | 1.1 | 0.16 | 0.023 | 10 | 80 | 98 | 850 ms |

Pugh matrix: datum **PID**; weights 3, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: PID | PID | PI from the plant | Gain-scheduled PI | PID + feedforward from the plant | Relay (on/off) | Sliding mode (ideal) ⚙ rate observer | Sliding mode (boundary layer) ⚙ rate observer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Following r (IAE) (3) | − | D | − | − | − | − | − | − |
| Rejecting d (IAE) (3) | − | D | − | − | − | − | − | + |
| Overshoot (2) | − | D | − | − | − | − | − | − |
| Settling (2 %, s) (1) | − | D | − | − | − | − | − | − |
| Effort (u swing) (1) | + | D | − | − | S | − | − | − |
| Wear (u travel/s) (2) | S | D | − | − | S | − | − | − |
| Time at a limit (1) | S | D | − | − | S | − | − | − |
| Robustness Ms (2) | − | D | + | + | S | ? | ? | + |
| Plant ±15 % (worst J) (3) | − | D | − | − | − | − | − | − |
| Noise → u (2) | + | D | − | − | S | − | − | + |
| Complexity (1) | S | D | − | − | − | + | − | − |
| Tuning runs (1) | + | D | + | S | + | + | + | S |
| **+ / −** | 3 / 6 | datum | 2 / 10 | 1 / 10 | 1 / 6 | 2 / 9 | 1 / 10 | 3 / 8 |
| **Weighted** | -10 | 0 | -16 | -17 | -12 | -16 | -18 | -7 |
| **Fits** | yes | yes | yes | yes | yes | yes | yes | yes |

Ranking (fitting only): 1. PID (+0); 2. Sliding mode (boundary layer) ⚙ rate observer (-7); 3. As loaded: PID (-10); 4. PID + feedforward from the plant (-12); 5. PI from the plant (-16); 6. Relay (on/off) (-16); 7. Gain-scheduled PI (-17); 8. Sliding mode (ideal) ⚙ rate observer (-18).

Suggestion: **PID** (+0), added as a variant, not switched on.

