# Benchmark prototype: the output

Reader: whoever checks the numbers [../output/benchmark.md](../output/benchmark.md) quotes. Generated, not hand-written: `node tools/benchmark-prototype.mjs "DC motor, sliding mode" "Oven" "Conical" "DC motor, deadbeat"`, then `node tools/benchmark-prototype.mjs "Pendulum swing-up" "DC motor, position" "Triple" "Following a sine" "Encoder errors" "DC motor, speed" "DC motor with an unbalanced"` (the rest of the library: cost and limits), on main at 3691720, in this container (Node 22). The decision (marks, vetoes, datum, ranking, weight sensitivity) is the generic module `src/core/pugh.js` ([../output/pugh.md](../output/pugh.md)); since input 64 an option that does not fit lists every veto (each failing gate, one per reason), so the reasons below may name several; the rankings, marks, totals, fits and verdicts are unchanged (checked line by line on all eleven systems). Timings vary by machine (and with the container's load); the matrices are deterministic.

Goal: {"cost":"IAE","effort":0.05,"overshoot":10,"saturation":0.2}; Iterate up to 60 iterations; sweep 8 plants within ±15 %. Node v22.22.0.

## DC motor, sliding mode

Step test for the starts: integrating. Total 33.2 s: load 0.228 s, starts 0.586 s, tuning 27.1 s, scoring 1.58 s, sweep (8 plants) 3.48 s. One run 43 ms, so about 778 runs' worth.

Tests: the system's own input (its own disturbance plays); the smooth move: r through 1/(τs + 1)³, τ = 0.0238 s.

Refused:

- Off (`off`): does nothing: the open loop, not a candidate
- LQR (`lqr`): LQR needs every state measured. This block sees rotor angle, rotor 1/Jm but not Motor/armature 1/(L·s + R).
- State feedback (`stateFeedback`): starts from the LQR design, which refused: LQR needs every state measured. This block sees rotor angle, rotor 1/Jm but not Motor/armature 1/(L·s + R).
- Deadbeat (`deadbeat`): deadbeat state feedback needs every state measured. This block sees rotor angle, rotor 1/Jm but not Motor/armature 1/(L·s + R).
- PI from the plant (`scheduledPI`): θ measured integrates V: it has no static gain
- Speed PI from the plant (`speedPI`): θ measured does not accelerate with V (∂ẏ/∂u = 0): speedPI needs a measured speed
- Swing-up (Lyapunov) + state feedback (`swingUp`): reads x, θ, v, ω of a pendulum on a cart (4 measurements); this block measures 2
- Swing-up + LQR catch (`swingUpLqr`): the swing-up reads x, θ, v, ω (θ an angle) from inputs 2 to 5; this block has θ measured, ω measured
- Planned swing-up + TV-LQR (`trajectory`): LQR needs every state measured. This block sees rotor angle, rotor 1/Jm but not Motor/armature 1/(L·s + R).
- Variable gain (Hu–Lin) (`huLin`): LQR needs every state measured. This block sees rotor angle, rotor 1/Jm but not Motor/armature 1/(L·s + R).

Candidates (J: the goal's cost on the system's run, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: Relay (theory) | not tuned | 0.302 | 0 | 0 | no: fails the main job: Following a smooth move (IAE) ×2.55 of the datum's (at most ×2) |
| PID | step test, SIMC (integrating) | 0.206 → 0.0767 | 115 | 6400 | yes |
| Gain-scheduled PI | the PID's gains, flat | 2.34 → 0.125 | 92 | 5600 | no: fails the main job: Following a smooth move (IAE) ×2.9 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×9.35 of the datum's (at most ×2) |
| PID + feedforward from the plant | the PID row's gains; Kff, Kv, Ka from the plant; Tr searched → 0.0155 | 0.0773 → 0.0766 | 31 | 2300 | yes |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 2.64 → 2.64 | 1 | 52 | no: fails the main job: Following steps (IAE) ×3.04 of the datum's (at most ×2); fails the main job: Following a smooth move (IAE) ×4.52 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×9.7 of the datum's (at most ×2) |
| Sliding mode (ideal) | λ from the step model, K the full swing | 0.595 → 0.26 | 38 | 2600 | yes |
| Sliding mode (boundary layer) | and φ = 0.2·λ·span r | 0.551 → 0.0757 | 57 | 3500 | yes |
| Super-twisting | λ as the sliding mode; k1 = U/3, k2 = 3.7 U | 0.869 → 0.0654 | 115 | 6700 | yes |

Scores:

| Candidate | Following steps (IAE) | Following a smooth move (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: Relay (theory) | 0.13 | 0.1 | 0.0048 | 0.095 % | 0.42 | 0.49 | 120 | 0.95 | no linear model | 0.3 | 0.69 | 4 | 0 | — | — |
| PID | 0.077 | 0.04 | 0.015 | 0.39 % | 0.19 | 0.14 | 1.8 | 0.06 | 2.1 | 0.077 | 0.098 | 4 | 120 | 34 | 11 ms |
| Gain-scheduled PI | 0.12 | 0.12 | 0.15 | 10 % | 0.41 | 0.084 | 0.6 | 0 | 1.4 | 0.13 | 0.0016 | 6 | 92 | 58 | 100 ms |
| PID + feedforward from the plant | 0.077 | 0.021 | 0.015 | 0.37 % | 0.19 | 0.14 | 1.8 | 0.059 | 2.1 | 0.077 | 0.098 | 9 | 31 | 34 | 11 ms |
| Relay (on/off) | 0.23 | 0.18 | 0.16 | 39 % | 0.99 | 0.5 | 12 | 1 | no linear model | 2.6 | 0.78 | 2 | 1 | — | — |
| Sliding mode (ideal) | 0.074 | 0.028 | 0.0012 | 0.19 % | 0.12 | 0.49 | 86 | 0.95 | no linear model | 0.26 | 0.65 | 4 | 38 | — | — |
| Sliding mode (boundary layer) | 0.076 | 0.039 | 0.013 | 0.2 % | 0.13 | 0.14 | 1.6 | 0.06 | 1.6 | 0.076 | 0.017 | 5 | 57 | 43 | 13 ms |
| Super-twisting | 0.081 | 0.05 | 0.0026 | 2.7 % | 0.18 | 0.12 | 4.2 | 0 | no linear model | 0.065 | 0.047 | 5 | 120 | — | — |

The feedforward's share of the effort (Σ|ff| / (Σ|ff| + Σ|u − ff|)):

- PID + feedforward from the plant (Kff 0, Kv 2.45, Ka 0.0359, prefilter Tr 0.0155 s): 3.7 % on the system's steps, 58 % on the smooth move; following IAE 0.077 (steps), 0.021 (move), against the datum's 0.077 and 0.04.

Pugh matrix: datum **PID**; five-point marks (++ +2, + +1, S 0, − −1, −− −2, ? not judged); weights 1.5, 1.5, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: Relay (theory) | PID | Gain-scheduled PI | PID + feedforward from the plant | Relay (on/off) | Sliding mode (ideal) | Sliding mode (boundary layer) | Super-twisting |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Following steps (IAE) (1.5) | − | D | − | S | −− | S | S | S |
| Following a smooth move (IAE) (1.5) | −− | D | −− | + | −− | + | S | − |
| Rejecting d (IAE) (3) | ++ | D | −− | S | −− | ++ | + | ++ |
| Overshoot (2) | S | D | −− | S | −− | S | S | − |
| Settling (2 %, s) (1) | −− | D | −− | S | −− | + | + | S |
| Effort (u swing) (1) | −− | D | + | S | −− | −− | S | + |
| Wear (u travel/s) (2) | −− | D | ++ | S | −− | −− | S | −− |
| Time at a limit (1) | −− | D | ++ | S | −− | −− | S | ++ |
| Robustness Ms (2) | ? | D | + | S | ? | ? | + | ? |
| Plant ±15 % (worst J) (3) | −− | D | − | S | −− | −− | S | + |
| Noise → u (2) | −− | D | ++ | S | −− | −− | ++ | ++ |
| Complexity (1) | + | D | − | −− | + | + | − | − |
| Tuning runs (1) | ++ | D | S | ++ | ++ | ++ | + | S |
| **Weighted** | -15.5 | 0 | -7.5 | +1.5 | -33 | -6.5 | +10 | +7.5 |
| **Fits** | no | yes | no | yes | no | yes | yes | yes |

Ranking (fitting only): 1. Sliding mode (boundary layer) (+10); 2. Super-twisting (+7.5); 3. PID + feedforward from the plant (+1.5); 4. PID (+0); 5. Sliding mode (ideal) (-6.5).

Not ranked: As loaded: Relay (theory): fails the main job: Following a smooth move (IAE) ×2.55 of the datum's (at most ×2); Gain-scheduled PI: fails the main job: Following a smooth move (IAE) ×2.9 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×9.35 of the datum's (at most ×2); Relay (on/off): fails the main job: Following steps (IAE) ×3.04 of the datum's (at most ×2); fails the main job: Following a smooth move (IAE) ×4.52 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×9.7 of the datum's (at most ×2).

Suggestion: **Sliding mode (boundary layer)** (+10), added as a variant, not switched on.

Weight sensitivity (winner Sliding mode (boundary layer); reasonable: each weight within ±1 of its default): **robust**. It wins 86.2 % of 4000 weight draws within one step.
- Super-twisting (+7.5, wins 13.8 % of draws): ties if Wear (u travel/s) goes 2 → 0.75 (not reasonable); all weights together: 9.5 % of the weights' size, the largest single change 0.31.
- PID + feedforward from the plant (+1.5, wins 0 % of draws): ties if Following a smooth move (IAE) goes 1.5 → 10 (not reasonable); all weights together: 41 % of the weights' size, the largest single change 1.7.
- PID (+0, wins 0 % of draws): ties if Complexity goes 1 → 11 (not reasonable); all weights together: 51 % of the weights' size, the largest single change 2.

## Oven, badly tuned

Step test for the starts: fopdt. Total 1.9 s: load 0.0239 s, starts 0.0465 s, tuning 1.4 s, scoring 0.144 s, sweep (8 plants) 0.248 s. One run 5.7 ms, so about 334 runs' worth.

Tests: the system's own input (its own disturbance plays); the smooth move: r through 1/(τs + 1)³, τ = 0.0476 s.

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

Candidates (J: the goal's cost on the system's run, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: PID, badly tuned | not tuned | 1.28 | 0 | 0 | no: unstable at r's middle (2 poles outside) |
| PID | step test, SIMC (fopdt) | 0.152 → 0.139 | 57 | 250 | yes |
| PI from the plant | one level, r's middle; Tcl searched → 0.435 | 0.836 → 0.14 | 31 | 170 | yes |
| Gain-scheduled PI | PI from the plant at 3 levels | 0.14 → 0.139 | 82 | 340 | yes |
| PID + feedforward from the plant | the PID row's gains; Kff, Kv, Ka from the plant; Tr searched → 0.403 | 0.756 → 0.136 | 31 | 160 | yes |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 1.91 → 1.91 | 1 | 2.9 | yes |
| Sliding mode (ideal) ⚙ rate observer | λ from the step model, K the full swing | 0.606 → 0.587 | 25 | 140 | yes |
| Sliding mode (boundary layer) ⚙ rate observer | and φ = 0.2·λ·span r | 0.434 → 0.11 | 70 | 310 | yes |

Scores:

| Candidate | Following steps (IAE) | Following a smooth move (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: PID, badly tuned | 0.18 | 0.16 | 0.13 | 42 % | 1.7 | 0.41 | 2.1 | 0.47 | unstable | 1.7 | 0.036 | 4 | 0 | — | — |
| PID | 0.14 | 0.14 | 0.11 | 10 % | 1.7 | 0.21 | 0.55 | 0.04 | 1.8 | 0.24 | 0.0057 | 3 | 57 | 58 | 360 ms |
| PI from the plant | 0.14 | 0.14 | 0.12 | 9.8 % | 1.7 | 0.2 | 0.49 | 0.04 | 1.7 | 0.26 | 0.0051 | 5 | 31 | 58 | 390 ms |
| Gain-scheduled PI | 0.14 | 0.14 | 0.11 | 9.9 % | 1.7 | 0.21 | 0.54 | 0.04 | 1.8 | 0.24 | 0.0056 | 9 | 82 | 58 | 360 ms |
| PID + feedforward from the plant | 0.14 | 0.11 | 0.11 | 9.7 % | 1.3 | 0.2 | 0.8 | 0.048 | 1.8 | 0.24 | 0.0056 | 9 | 31 | 58 | 360 ms |
| Relay (on/off) | 0.17 | 0.15 | 0.15 | 54 % | 1.7 | 0.49 | 2.4 | 1 | no linear model | 2.3 | 0.53 | 2 | 1 | — | — |
| Sliding mode (ideal) ⚙ rate observer | 0.15 | 0.13 | 0.14 | 22 % | 1.7 | 0.49 | 3.9 | 0.98 | no linear model | 0.9 | 0.15 | 9 | 25 | — | — |
| Sliding mode (boundary layer) ⚙ rate observer | 0.11 | 0.088 | 0.098 | 10 % | 1.7 | 0.19 | 1.1 | 0.032 | 2.4 | 0.18 | 0.011 | 10 | 70 | 50 | 200 ms |

The feedforward's share of the effort (Σ|ff| / (Σ|ff| + Σ|u − ff|)):

- PID + feedforward from the plant (Kff 1, Kv 0.65, Ka 0.08, prefilter Tr 0.403 s): 85 % on the system's steps, 88 % on the smooth move; following IAE 0.14 (steps), 0.11 (move), against the datum's 0.14 and 0.14.

Pugh matrix: datum **PID**; five-point marks (++ +2, + +1, S 0, − −1, −− −2, ? not judged); weights 1.5, 1.5, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: PID, badly tuned | PID | PI from the plant | Gain-scheduled PI | PID + feedforward from the plant | Relay (on/off) | Sliding mode (ideal) ⚙ rate observer | Sliding mode (boundary layer) ⚙ rate observer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Following steps (IAE) (1.5) | − | D | S | S | S | − | S | + |
| Following a smooth move (IAE) (1.5) | − | D | S | S | + | S | S | + |
| Rejecting d (IAE) (3) | − | D | S | S | S | − | − | + |
| Overshoot (2) | −− | D | S | S | S | −− | −− | S |
| Settling (2 %, s) (1) | S | D | S | S | + | S | S | S |
| Effort (u swing) (1) | − | D | S | S | S | −− | −− | S |
| Wear (u travel/s) (2) | −− | D | S | S | − | −− | −− | − |
| Time at a limit (1) | −− | D | S | S | S | −− | −− | S |
| Robustness Ms (2) | ? | D | S | S | S | ? | ? | − |
| Plant ±15 % (worst J) (3) | −− | D | S | S | S | −− | −− | + |
| Noise → u (2) | −− | D | S | S | S | −− | −− | − |
| Complexity (1) | − | D | − | −− | −− | + | −− | −− |
| Tuning runs (1) | ++ | D | + | S | + | ++ | ++ | S |
| **Weighted** | -26 | 0 | +0 | -2 | -0.5 | -23.5 | -25 | +1 |
| **Fits** | no | yes | yes | yes | yes | yes | yes | yes |

Ranking (fitting only): 1. Sliding mode (boundary layer) ⚙ rate observer (+1); 2. PID (+0); 3. PI from the plant (+0); 4. PID + feedforward from the plant (-0.5); 5. Gain-scheduled PI (-2); 6. Relay (on/off) (-23.5); 7. Sliding mode (ideal) ⚙ rate observer (-25).

Not ranked: As loaded: PID, badly tuned: unstable at r's middle (2 poles outside).

Suggestion: **PID** (+0), added as a variant, not switched on; ranked above it with a plant change: Sliding mode (boundary layer) ⚙ rate observer (+1; a Finite difference observer (Tf 0.0253 s) makes ẏ from y for input 3).

Weight sensitivity (winner PID; reasonable: each weight within ±1 of its default): **sensitive**. It wins 43.3 % of 4000 weight draws within one step.
- PI from the plant (+0, wins 27.6 % of draws): tied now: the same total, J breaks the tie; all weights together: 0 % of the weights' size, the largest single change 0.
- PID + feedforward from the plant (-0.5, wins 29.1 % of draws): ties if Complexity goes 1 → 0.75 (reasonable); all weights together: 2.7 % of the weights' size, the largest single change 0.13.
- Gain-scheduled PI (-2, wins 0 % of draws): ties if Complexity goes 1 → 0 (not reasonable); all weights together: 15 % of the weights' size, the largest single change 1.

## Conical tank, gain scheduling

Step test for the starts: schedule. Total 2.5 s: load 0.0349 s, starts 0.315 s, tuning 1.62 s, scoring 0.176 s, sweep (8 plants) 0.29 s. One run 5.1 ms, so about 480 runs' worth.

Tests: the system's own input (its own disturbance plays); the smooth move: r through 1/(τs + 1)³, τ = 0.0357 s.

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

Candidates (J: the goal's cost on the system's run, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: Gain-scheduled PI | not tuned | 0.0853 | 0 | 0 | yes |
| PID | step test, SIMC at 0.5 (the schedule's middle); no point on the way fits (tuned: unstable where the run starts (2 poles outside)) | 0.0786 → 0.0646 | 78 | 410 | no: unstable where the run starts (2 poles outside); it rests there only because it starts in balance |
| PI from the plant | one level, r's middle; Tcl searched → 0.214; backed off to 75 % of the way (tuned: unstable where the run starts (2 poles outside)) | 0.123 → 0.118 | 32 | 250 | yes |
| Gain-scheduled PI | step tests, a SIMC schedule; backed off to 25 % of the way (tuned: Ms 12) | 0.141 → 0.0822 | 69 | 370 | yes |
| Speed PI from the plant | its defaults | 4.35 → 4.35 | 1 | 5.2 | no: unstable at r's middle (2 poles outside); fails the main job: Following steps (IAE) ×3.33 of the datum's (at most ×2); fails the main job: Following a smooth move (IAE) ×3.25 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×4.97 of the datum's (at most ×2) |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 5.08 → 5.08 | 1 | 4.3 | no: fails the main job: Rejecting d (IAE) ×5.47 of the datum's (at most ×2) |
| Sliding mode (ideal) ⚙ rate observer | λ from the step model, K the full swing | 5.13 → 5.06 | 20 | 140 | no: fails the main job: Following steps (IAE) ×2.29 of the datum's (at most ×2); fails the main job: Following a smooth move (IAE) ×2.36 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×3.53 of the datum's (at most ×2) |
| Sliding mode (boundary layer) ⚙ rate observer | and φ = 0.2·λ·span r; no point on the way fits (tuned: unstable at r's middle (2 poles outside)) | 5.03 → 3.4 | 76 | 420 | no: unstable at r's middle (2 poles outside); fails the main job: Following a smooth move (IAE) ×2.33 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×3.52 of the datum's (at most ×2) |

Scores:

| Candidate | Following steps (IAE) | Following a smooth move (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: Gain-scheduled PI | 0.12 | 0.12 | 0.1 | 7.7 % | 1.4 | 0.044 | 0.077 | 0 | 1.5 | 0.086 | 0.0016 | 17 | 0 | 64 | 280 ms |
| PID | 0.095 | 0.11 | 0.069 | 10 % | 0.65 | 0.05 | 0.21 | 0 | 2.8 | 0.067 | 0.034 | 4 | 78 | 39 | 79 ms |
| PI from the plant | 0.13 | 0.13 | 0.11 | 11 % | 1.4 | 0.043 | 0.083 | 0 | 1.6 | 0.13 | 0.0016 | 6 | 32 | 62 | 240 ms |
| Gain-scheduled PI | 0.12 | 0.12 | 0.098 | 8.9 % | 1.4 | 0.049 | 0.12 | 0 | 2.5 | 0.081 | 0.0014 | 17 | 69 | 43 | 95 ms |
| Speed PI from the plant | 0.42 | 0.4 | 0.51 | 160 % | 1.4 | 0.52 | 3.2 | 0 | unstable | 4.1 | 0.3 | 3 | 1 | — | — |
| Relay (on/off) | 0.22 | 0.24 | 0.57 | 180 % | 1.4 | 0.38 | 3 | 1 | no linear model | 5.1 | 0.57 | 2 | 1 | — | — |
| Sliding mode (ideal) ⚙ rate observer | 0.29 | 0.29 | 0.36 | 180 % | 1.4 | 0.4 | 3.5 | 1 | no linear model | 5.1 | 0.64 | 9 | 20 | — | — |
| Sliding mode (boundary layer) ⚙ rate observer | 0.22 | 0.29 | 0.36 | 110 % | 1.4 | 0.22 | 3.7 | 0.6 | unstable | 4.5 | 0.16 | 10 | 76 | — | — |

Pugh matrix: datum **As loaded: Gain-scheduled PI**; five-point marks (++ +2, + +1, S 0, − −1, −− −2, ? not judged); weights 1.5, 1.5, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: Gain-scheduled PI | PID | PI from the plant | Gain-scheduled PI | Speed PI from the plant | Relay (on/off) | Sliding mode (ideal) ⚙ rate observer | Sliding mode (boundary layer) ⚙ rate observer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Following steps (IAE) (1.5) | D | + | S | S | −− | − | −− | − |
| Following a smooth move (IAE) (1.5) | D | + | S | S | −− | − | −− | −− |
| Rejecting d (IAE) (3) | D | + | − | S | −− | −− | −− | −− |
| Overshoot (2) | D | − | − | S | −− | −− | −− | −− |
| Settling (2 %, s) (1) | D | ++ | S | S | S | S | S | S |
| Effort (u swing) (1) | D | S | S | S | −− | −− | −− | −− |
| Wear (u travel/s) (2) | D | −− | S | − | −− | −− | −− | −− |
| Time at a limit (1) | D | S | S | S | S | −− | −− | −− |
| Robustness Ms (2) | D | − | S | − | ? | ? | ? | ? |
| Plant ±15 % (worst J) (3) | D | + | − | S | −− | −− | −− | −− |
| Noise → u (2) | D | −− | S | S | −− | −− | −− | −− |
| Complexity (1) | D | ++ | ++ | + | ++ | ++ | + | + |
| Tuning runs (1) | D | −− | −− | −− | S | S | −− | −− |
| **Weighted** | 0 | -1 | -8 | -5 | -30 | -29 | -35 | -33.5 |
| **Fits** | yes | no | yes | yes | no | no | no | no |

Ranking (fitting only): 1. As loaded: Gain-scheduled PI (+0); 2. Gain-scheduled PI (-5); 3. PI from the plant (-8).

Not ranked: PID: unstable where the run starts (2 poles outside); it rests there only because it starts in balance; Speed PI from the plant: unstable at r's middle (2 poles outside); fails the main job: Following steps (IAE) ×3.33 of the datum's (at most ×2); fails the main job: Following a smooth move (IAE) ×3.25 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×4.97 of the datum's (at most ×2); Relay (on/off): fails the main job: Rejecting d (IAE) ×5.47 of the datum's (at most ×2); Sliding mode (ideal) ⚙ rate observer: fails the main job: Following steps (IAE) ×2.29 of the datum's (at most ×2); fails the main job: Following a smooth move (IAE) ×2.36 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×3.53 of the datum's (at most ×2); Sliding mode (boundary layer) ⚙ rate observer: unstable at r's middle (2 poles outside); fails the main job: Following a smooth move (IAE) ×2.33 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×3.52 of the datum's (at most ×2).

Suggestion: keep **Gain-scheduled PI**, the running variant: nothing beats it.

Weight sensitivity (winner As loaded: Gain-scheduled PI; reasonable: each weight within ±1 of its default): **robust**. It wins 100 % of 4000 weight draws within one step.
- Gain-scheduled PI (-5, wins 0 % of draws): ties if Complexity goes 1 → 6 (not reasonable); all weights together: 30 % of the weights' size, the largest single change 1.
- PI from the plant (-8, wins 0 % of draws): ties if Complexity goes 1 → 5 (not reasonable); all weights together: 38 % of the weights' size, the largest single change 1.7.

## DC motor, deadbeat

Step test for the starts: integrating. Total 9.1 s: load 0.0419 s, starts 0.105 s, tuning 6.73 s, scoring 0.685 s, sweep (8 plants) 1.47 s. One run 9.2 ms, so about 987 runs' worth.

Tests: the system's own input, plus the standard disturbance (it has none of its own): a load step of -2.4 at the plant's input from 3.35 s (10 % of u's range); the smooth move: r through 1/(τs + 1)³, τ = 0.0238 s.

Refused:

- Off (`off`): does nothing: the open loop, not a candidate
- PI from the plant (`scheduledPI`): angle integrates V: it has no static gain
- Speed PI from the plant (`speedPI`): angle does not accelerate with V (∂ẏ/∂u = 0): speedPI needs a measured speed
- Swing-up (Lyapunov) + state feedback (`swingUp`): reads x, θ, v, ω of a pendulum on a cart (4 measurements); this block measures 3
- Swing-up + LQR catch (`swingUpLqr`): the swing-up reads x, θ, v, ω (θ an angle) from inputs 2 to 5; this block has angle, speed (Motor), current (Motor)

Candidates (J: the goal's cost on the system's run, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: Deadbeat, 100 ms | not tuned | 0.56 | 0 | 0 | no: fails the main job: Following a smooth move (IAE) ×2.17 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×9.54 of the datum's (at most ×2) |
| PID | step test, SIMC (integrating); backed off to 75 % of the way (tuned: Ms 3.3) | 0.374 → 0.127 | 111 | 1200 | yes |
| LQR | Q = 1 for every measurement; R searched → 0.0336 | 4.17 → 2.43 | 31 | 460 | no: fails the main job: Following steps (IAE) ×5.65 of the datum's (at most ×2); fails the main job: Following a smooth move (IAE) ×6.64 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×27.2 of the datum's (at most ×2) |
| State feedback | the LQR row's gains | 2.43 → 0.0809 | 107 | 1200 | yes |
| Deadbeat | its defaults | 0.904 → 0.904 | 1 | 12 | no: fragile, at r's middle: Robustness Ms 5.19 above 3 |
| Gain-scheduled PI | the PID's gains, flat | 3.04 → 0.786 | 63 | 670 | no: fails the main job: Following steps (IAE) ×2.05 of the datum's (at most ×2); fails the main job: Following a smooth move (IAE) ×2.34 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×11.4 of the datum's (at most ×2) |
| PID + feedforward from the plant | the PID row's gains; Kff, Kv, Ka from the plant; Tr searched → 0.0363 | 0.0839 → 0.089 | 31 | 460 | yes |
| Planned swing-up + TV-LQR | its defaults | 4.29 → 4.29 | 1 | 65 | no: fails the main job: Following steps (IAE) ×7.68 of the datum's (at most ×2); fails the main job: Following a smooth move (IAE) ×9.17 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×40.3 of the datum's (at most ×2) |
| Variable gain (Hu–Lin) | its defaults | 4.17 → 4.17 | 1 | 20 | no: fails the main job: Following steps (IAE) ×7.35 of the datum's (at most ×2); fails the main job: Following a smooth move (IAE) ×8.66 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×35.8 of the datum's (at most ×2) |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 3.33 → 3.33 | 1 | 9.8 | no: fails the main job: Following steps (IAE) ×3.04 of the datum's (at most ×2); fails the main job: Following a smooth move (IAE) ×3.11 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×9.16 of the datum's (at most ×2) |
| Sliding mode (ideal) | λ from the step model, K the full swing | 0.291 → 0.284 | 39 | 480 | yes |
| Sliding mode (boundary layer) | and φ = 0.2·λ·span r | 0.0895 → 0.0839 | 64 | 730 | yes |
| Super-twisting | λ as the sliding mode; k1 = U/3, k2 = 3.7 U | 0.0815 → 0.0741 | 141 | 1400 | yes |

Scores:

| Candidate | Following steps (IAE) | Following a smooth move (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: Deadbeat, 100 ms | 0.15 | 0.18 | 0.25 | 30 % | 0.39 | 0.1 | 0.62 | 0 | 2.3 | 1.2 | 0.0046 | 8 | 0 | 55 | 80 ms |
| PID | 0.096 | 0.08 | 0.025 | 12 % | 0.5 | 0.14 | 1.5 | 0.046 | 2.6 | 0.77 | 0.024 | 4 | 110 | 30 | 16 ms |
| LQR | 0.55 | 0.54 | 0.71 | 100 % | 1 | 0.033 | 0.099 | 0 | 1.4 | 2.4 | 0.0034 | 9 | 31 | 150 | 200 ms |
| State feedback | 0.08 | 0.045 | 0.02 | 2.2 % | 0.37 | 0.14 | 1.6 | 0.056 | 1.7 | 0.092 | 0.042 | 8 | 110 | 43 | 9 ms |
| Deadbeat | 0.083 | 0.022 | 0.0036 | 29 % | 0.22 | 0.22 | 3.7 | 0.17 | 5.2 | 1.3 | 0.32 | 8 | 1 | 18 | 1.6 ms |
| Gain-scheduled PI | 0.2 | 0.19 | 0.3 | 38 % | 1 | 0.075 | 0.41 | 0 | 1.4 | 1.4 | 0.0016 | 6 | 63 | 59 | 140 ms |
| PID + feedforward from the plant | 0.091 | 0.036 | 0.025 | 8.2 % | 0.49 | 0.13 | 1.5 | 0.046 | 2.6 | 0.65 | 0.024 | 9 | 31 | 30 | 16 ms |
| Planned swing-up + TV-LQR | 0.74 | 0.75 | 1.1 | 190 % | 0.74 | 0.027 | 0.038 | 0 | 1.1 | 4.5 | 0.0013 | 5 | 1 | 110 | 1600 ms |
| Variable gain (Hu–Lin) | 0.71 | 0.7 | 0.94 | 180 % | 1 | 0.027 | 0.058 | 0 | 1.1 | 4.4 | 0.0013 | 3 | 1 | 110 | 1600 ms |
| Relay (on/off) | 0.29 | 0.25 | 0.24 | 50 % | 1 | 0.5 | 10 | 1 | no linear model | 4.5 | 0.68 | 2 | 1 | — | — |
| Sliding mode (ideal) | 0.095 | 0.057 | 0.0098 | 6 % | 0.79 | 0.49 | 40 | 0.96 | no linear model | 0.37 | 0.32 | 4 | 39 | — | — |
| Sliding mode (boundary layer) | 0.081 | 0.047 | 0.03 | 3.4 % | 0.39 | 0.15 | 2.2 | 0.06 | 2.5 | 0.15 | 0.03 | 5 | 64 | 28 | 7.7 ms |
| Super-twisting | 0.078 | 0.053 | 0.0063 | 2.9 % | 0.16 | 0.14 | 5.1 | 0.036 | no linear model | 0.43 | 0.083 | 5 | 140 | — | — |

The feedforward's share of the effort (Σ|ff| / (Σ|ff| + Σ|u − ff|)):

- PID + feedforward from the plant (Kff 0, Kv 1.66, Ka 0.0324, prefilter Tr 0.0363 s): 26 % on the system's steps, 43 % on the smooth move; following IAE 0.091 (steps), 0.036 (move), against the datum's 0.096 and 0.08.

Pugh matrix: datum **PID**; five-point marks (++ +2, + +1, S 0, − −1, −− −2, ? not judged); weights 1.5, 1.5, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: Deadbeat, 100 ms | PID | LQR | State feedback | Deadbeat | Gain-scheduled PI | PID + feedforward from the plant | Planned swing-up + TV-LQR | Variable gain (Hu–Lin) | Relay (on/off) | Sliding mode (ideal) | Sliding mode (boundary layer) | Super-twisting |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Following steps (IAE) (1.5) | − | D | −− | + | + | −− | S | −− | −− | −− | S | + | + |
| Following a smooth move (IAE) (1.5) | −− | D | −− | + | ++ | −− | ++ | −− | −− | −− | + | + | + |
| Rejecting d (IAE) (3) | −− | D | −− | + | ++ | −− | S | −− | −− | −− | ++ | − | ++ |
| Overshoot (2) | −− | D | −− | ++ | −− | −− | + | −− | −− | −− | + | ++ | ++ |
| Settling (2 %, s) (1) | + | D | −− | + | ++ | −− | S | − | −− | −− | − | + | ++ |
| Effort (u swing) (1) | + | D | ++ | S | − | + | S | ++ | ++ | −− | −− | S | S |
| Wear (u travel/s) (2) | ++ | D | ++ | S | −− | ++ | S | ++ | ++ | −− | −− | − | −− |
| Time at a limit (1) | ++ | D | ++ | S | −− | ++ | S | ++ | ++ | −− | −− | S | S |
| Robustness Ms (2) | + | D | + | + | − | + | S | ++ | ++ | ? | ? | S | ? |
| Plant ±15 % (worst J) (3) | − | D | −− | ++ | − | − | + | −− | −− | −− | ++ | ++ | + |
| Noise → u (2) | ++ | D | ++ | − | −− | ++ | S | ++ | ++ | −− | −− | S | −− |
| Complexity (1) | − | D | −− | − | − | − | −− | − | + | + | + | − | − |
| Tuning runs (1) | ++ | D | ++ | S | ++ | + | ++ | ++ | ++ | ++ | ++ | + | S |
| **Weighted** | -2.5 | 0 | -10 | +16 | -6.5 | -8 | +8 | -6 | -5 | -33 | +5.5 | +9 | +9 |
| **Fits** | no | yes | no | yes | no | no | yes | no | no | no | yes | yes | yes |

Ranking (fitting only): 1. State feedback (+16); 2. Super-twisting (+9); 3. Sliding mode (boundary layer) (+9); 4. PID + feedforward from the plant (+8); 5. Sliding mode (ideal) (+5.5); 6. PID (+0).

Not ranked: As loaded: Deadbeat, 100 ms: fails the main job: Following a smooth move (IAE) ×2.17 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×9.54 of the datum's (at most ×2); LQR: fails the main job: Following steps (IAE) ×5.65 of the datum's (at most ×2); fails the main job: Following a smooth move (IAE) ×6.64 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×27.2 of the datum's (at most ×2); Deadbeat: fragile, at r's middle: Robustness Ms 5.19 above 3; Gain-scheduled PI: fails the main job: Following steps (IAE) ×2.05 of the datum's (at most ×2); fails the main job: Following a smooth move (IAE) ×2.34 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×11.4 of the datum's (at most ×2); Planned swing-up + TV-LQR: fails the main job: Following steps (IAE) ×7.68 of the datum's (at most ×2); fails the main job: Following a smooth move (IAE) ×9.17 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×40.3 of the datum's (at most ×2); Variable gain (Hu–Lin): fails the main job: Following steps (IAE) ×7.35 of the datum's (at most ×2); fails the main job: Following a smooth move (IAE) ×8.66 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×35.8 of the datum's (at most ×2); Relay (on/off): fails the main job: Following steps (IAE) ×3.04 of the datum's (at most ×2); fails the main job: Following a smooth move (IAE) ×3.11 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×9.16 of the datum's (at most ×2).

Suggestion: **State feedback** (+16), added as a variant, not switched on.

Weight sensitivity (winner State feedback; reasonable: each weight within ±1 of its default): **robust**. It wins 100 % of 4000 weight draws within one step.
- Super-twisting (+9, wins 0 % of draws): ties if Rejecting d (IAE) goes 3 → 10 (not reasonable); all weights together: 35 % of the weights' size, the largest single change 1.6.
- Sliding mode (boundary layer) (+9, wins 0 % of draws): ties if Noise → u goes 2 → 9 (not reasonable); all weights together: 38 % of the weights' size, the largest single change 1.8.
- PID + feedforward from the plant (+8, wins 0 % of draws): ties if Tuning runs goes 1 → 5 (not reasonable); all weights together: 34 % of the weights' size, the largest single change 1.2.


# The rest of the library

## Pendulum swing-up

Step test for the starts: relay. Total 2.7 s: load 0.0558 s, starts 0.135 s, tuning 1.61 s, scoring 0.519 s, sweep (8 plants) 0.315 s. One run 3.9 ms, so about 672 runs' worth.

Tests: the system's own input (its own disturbance plays); no smooth move (r has no steps to smooth).

Refused:

- Off (`off`): does nothing: the open loop, not a candidate
- Deadbeat (`deadbeat`): the poles did not all land at z = 0 (0.0002291 of the plant's motion is left after 4 samples): u moves some state too weakly at this sample time
- PI from the plant (`scheduledPI`): x integrates F: it has no static gain
- Gain-scheduled PI (`gainScheduled`): r does not move: there is no range to schedule over
- PID + feedforward from the plant (`pidFF`): the path from F to x has a zero at s = 4.429 in the right half-plane: its inverse is unstable, so no feedforward follows r through it

Candidates (J: the goal's cost on the system's run, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: Swing-up + LQR catch | not tuned | 0.193 | 0 | 0 | no: fails the main job: Rejecting d (IAE) ×9.09 of the datum's (at most ×2) |
| PID | relay test, Tyreus–Luyben; backed off to 50 % of the way (tuned: Ms 2300) | 0.00531 → 5.7e-4 | 113 | 450 | yes |
| LQR | Q = 1 for every measurement; R searched → 1 | 67.4 → 67.4 | 31 | 65 | no: unstable at r's middle (1 poles outside); fails the main job: Rejecting d (IAE) ×5.3e+4 of the datum's (at most ×2) |
| State feedback | the LQR row's gains; no point on the way fits (tuned: unstable at r's middle (1 poles outside)) | 67.4 → 67.4 | 21 | 120 | no: unstable at r's middle (1 poles outside); fails the main job: Rejecting d (IAE) ×5.3e+4 of the datum's (at most ×2) |
| Speed PI from the plant | its defaults | 100 → 100 | 1 | 5.4 | no: unstable at r's middle (4 poles outside); fails the main job: Rejecting d (IAE) ×8.2e+4 of the datum's (at most ×2) |
| Swing-up (Lyapunov) + state feedback | its defaults (not iterated: A swing-up switches between pumping energy and catching the ) | 6.49 → 6.49 | 1 | 4 | no: fails the main job: Rejecting d (IAE) ×4040 of the datum's (at most ×2) |
| Swing-up + LQR catch | its defaults | 6.49 → 6.49 | 1 | 5.5 | no: fails the main job: Rejecting d (IAE) ×4040 of the datum's (at most ×2) |
| Planned swing-up + TV-LQR | its defaults | 0.106 → 0.106 | 1 | 300 | no: unstable at r's middle (1 poles outside); fails the main job: Rejecting d (IAE) ×26 of the datum's (at most ×2) |
| Variable gain (Hu–Lin) | its defaults | 67.4 → 67.4 | 1 | 21 | no: unstable at r's middle (1 poles outside); fails the main job: Rejecting d (IAE) ×5.3e+4 of the datum's (at most ×2) |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 0.414 → 0.414 | 1 | 2.9 | no: fails the main job: Rejecting d (IAE) ×90.5 of the datum's (at most ×2) |
| Sliding mode (ideal) | λ from the step model, K the full swing | 7.83 → 0.375 | 26 | 100 | no: fails the main job: Rejecting d (IAE) ×86.7 of the datum's (at most ×2) |
| Sliding mode (boundary layer) | and φ = 0.2·λ·span r; no point on the way fits (tuned: unstable at r's middle (4 poles outside)) | 2.1 → 0.00745 | 33 | 140 | no: unstable at r's middle (4 poles outside); fails the main job: Rejecting d (IAE) ×8.83 of the datum's (at most ×2) |
| Super-twisting | λ as the sliding mode; k1 = U/3, k2 = 3.7 U | 3.4 → 0.006 | 125 | 390 | no: fails the main job: Rejecting d (IAE) ×4.81 of the datum's (at most ×2) |

Scores:

| Candidate | Following steps (IAE) | Following a smooth move (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: Swing-up + LQR catch | — | — | 0.024 | 0 % | — | 0.14 | 0.7 | 0.03 | no linear model | 0.19 | 0.054 | 15 | 0 | — | — |
| PID | — | — | 0.0018 | 0 % | — | 0.016 | 0.079 | 0 | 2.3 | 5.7e-4 | 0.11 | 4 | 110 | 8.8 | 23 ms |
| LQR | — | — | 150 | 0 % | — | 2.2e-14 | 0 | 1 | unstable | 67 | 0 | 11 | 31 | — | — |
| State feedback | — | — | 150 | 0 % | — | 2.2e-14 | 0 | 1 | unstable | 67 | 0 | 10 | 21 | — | — |
| Speed PI from the plant | — | — | 230 | 0 % | — | 120 | 170 | 0 | unstable | 100 | 2.3 | 3 | 1 | — | — |
| Swing-up (Lyapunov) + state feedback | — | — | 11 | 0 % | — | 0.092 | 0.57 | 0.014 | no linear model | 6.5 | 0.033 | 13 | 1 | — | — |
| Swing-up + LQR catch | — | — | 11 | 0 % | — | 0.092 | 0.57 | 0.014 | no linear model | 6.5 | 0.033 | 15 | 1 | — | — |
| Planned swing-up + TV-LQR | — | — | 0.071 | 0 % | — | 0.058 | 0.25 | 0 | unstable | 0.11 | 0.017 | 6 | 1 | — | — |
| Variable gain (Hu–Lin) | — | — | 150 | 0 % | — | 2.2e-14 | 0 | 1 | unstable | 67 | 0 | 3 | 1 | — | — |
| Relay (on/off) | — | — | 0.25 | 0 % | — | 0.5 | 3.4 | 1 | no linear model | 0.41 | 0.69 | 2 | 1 | — | — |
| Sliding mode (ideal) | — | — | 0.24 | 0 % | — | 0.5 | 3.6 | 1 | no linear model | 0.38 | 0.72 | 4 | 26 | — | — |
| Sliding mode (boundary layer) | — | — | 0.023 | 0 % | — | 0.035 | 0.19 | 0 | unstable | 0.0075 | 0.047 | 5 | 33 | — | — |
| Super-twisting | — | — | 0.012 | 0 % | — | 0.021 | 0.18 | 0 | no linear model | 0.006 | 0.052 | 5 | 130 | — | — |

Pugh matrix: datum **PID**; five-point marks (++ +2, + +1, S 0, − −1, −− −2, ? not judged); weights 1.5, 1.5, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: Swing-up + LQR catch | PID | LQR | State feedback | Speed PI from the plant | Swing-up (Lyapunov) + state feedback | Swing-up + LQR catch | Planned swing-up + TV-LQR | Variable gain (Hu–Lin) | Relay (on/off) | Sliding mode (ideal) | Sliding mode (boundary layer) | Super-twisting |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Following steps (IAE) (1.5) | ? | D | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| Following a smooth move (IAE) (1.5) | ? | D | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| Rejecting d (IAE) (3) | −− | D | −− | −− | −− | −− | −− | −− | −− | −− | −− | −− | −− |
| Overshoot (2) | S | D | S | S | S | S | S | S | S | S | S | S | S |
| Settling (2 %, s) (1) | ? | D | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| Effort (u swing) (1) | −− | D | ++ | ++ | −− | −− | −− | −− | ++ | −− | −− | −− | − |
| Wear (u travel/s) (2) | −− | D | ++ | ++ | −− | −− | −− | −− | ++ | −− | −− | − | − |
| Time at a limit (1) | −− | D | −− | −− | S | − | − | S | −− | −− | −− | S | S |
| Robustness Ms (2) | ? | D | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| Plant ±15 % (worst J) (3) | −− | D | −− | −− | −− | −− | −− | −− | −− | −− | −− | −− | − |
| Noise → u (2) | ++ | D | ++ | ++ | −− | ++ | ++ | ++ | ++ | −− | −− | ++ | ++ |
| Complexity (1) | −− | D | −− | −− | + | −− | −− | − | + | + | + | − | − |
| Tuning runs (1) | ++ | D | ++ | ++ | ++ | ++ | ++ | ++ | ++ | ++ | ++ | ++ | S |
| **Weighted** | -16 | 0 | -4 | -4 | -19 | -15 | -15 | -13 | -1 | -21 | -21 | -11 | -9 |
| **Fits** | no | yes | no | no | no | no | no | no | no | no | no | no | no |

Ranking (fitting only): 1. PID (+0).

Not ranked: As loaded: Swing-up + LQR catch: fails the main job: Rejecting d (IAE) ×9.09 of the datum's (at most ×2); LQR: unstable at r's middle (1 poles outside); fails the main job: Rejecting d (IAE) ×5.3e+4 of the datum's (at most ×2); State feedback: unstable at r's middle (1 poles outside); fails the main job: Rejecting d (IAE) ×5.3e+4 of the datum's (at most ×2); Speed PI from the plant: unstable at r's middle (4 poles outside); fails the main job: Rejecting d (IAE) ×8.2e+4 of the datum's (at most ×2); Swing-up (Lyapunov) + state feedback: fails the main job: Rejecting d (IAE) ×4040 of the datum's (at most ×2); Swing-up + LQR catch: fails the main job: Rejecting d (IAE) ×4040 of the datum's (at most ×2); Planned swing-up + TV-LQR: unstable at r's middle (1 poles outside); fails the main job: Rejecting d (IAE) ×26 of the datum's (at most ×2); Variable gain (Hu–Lin): unstable at r's middle (1 poles outside); fails the main job: Rejecting d (IAE) ×5.3e+4 of the datum's (at most ×2); Relay (on/off): fails the main job: Rejecting d (IAE) ×90.5 of the datum's (at most ×2); Sliding mode (ideal): fails the main job: Rejecting d (IAE) ×86.7 of the datum's (at most ×2); Sliding mode (boundary layer): unstable at r's middle (4 poles outside); fails the main job: Rejecting d (IAE) ×8.83 of the datum's (at most ×2); Super-twisting: fails the main job: Rejecting d (IAE) ×4.81 of the datum's (at most ×2).

Suggestion: **PID** (+0), added as a variant, not switched on.

## DC motor, position control

Step test for the starts: integrating. Total 3.7 s: load 0.0311 s, starts 0.121 s, tuning 2.71 s, scoring 0.309 s, sweep (8 plants) 0.443 s. One run 11 ms, so about 324 runs' worth.

Tests: the system's own input (its own disturbance plays); the smooth move: r through 1/(τs + 1)³, τ = 0.0239 s.

Refused:

- Off (`off`): does nothing: the open loop, not a candidate
- LQR (`lqr`): LQR needs every state measured. This block sees rotor angle but not Motor/armature 1/(L·s + R) and Motor/rotor 1/Jm.
- State feedback (`stateFeedback`): starts from the LQR design, which refused: LQR needs every state measured. This block sees rotor angle but not Motor/armature 1/(L·s + R) and Motor/rotor 1/Jm.
- Deadbeat (`deadbeat`): deadbeat state feedback needs every state measured. This block sees rotor angle but not Motor/armature 1/(L·s + R) and Motor/rotor 1/Jm.
- PI from the plant (`scheduledPI`): θ measured integrates V: it has no static gain
- Speed PI from the plant (`speedPI`): θ measured does not accelerate with V (∂ẏ/∂u = 0): speedPI needs a measured speed
- Swing-up (Lyapunov) + state feedback (`swingUp`): reads x, θ, v, ω of a pendulum on a cart (4 measurements); this block measures 1
- Swing-up + LQR catch (`swingUpLqr`): the swing-up reads x, θ, v, ω (θ an angle) from inputs 2 to 5; this block has θ measured
- Planned swing-up + TV-LQR (`trajectory`): LQR needs every state measured. This block sees rotor angle but not Motor/armature 1/(L·s + R) and Motor/rotor 1/Jm.
- Variable gain (Hu–Lin) (`huLin`): LQR needs every state measured. This block sees rotor angle but not Motor/armature 1/(L·s + R) and Motor/rotor 1/Jm.
- Sliding mode (`slidingMode`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)
- Super-twisting (`superTwisting`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)

Plant changes scored (⚙, never applied; complexity +5):

- a Finite difference observer (Tf 0.01 s) makes ẏ from y for input 3

Candidates (J: the goal's cost on the system's run, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: P, too aggressive | not tuned | 1.27 | 0 | 0 | no: fragile, at r's middle: Robustness Ms 4.7 above 3; fails the main job: Rejecting d (IAE) ×2.81 of the datum's (at most ×2) |
| PID | step test, SIMC (integrating) | 0.13 → 0.111 | 91 | 820 | yes |
| Gain-scheduled PI | the PID's gains, flat | 1.17 → 0.114 | 61 | 560 | no: fails the main job: Rejecting d (IAE) ×3.57 of the datum's (at most ×2) |
| PID + feedforward from the plant | the PID row's gains; Kff, Kv, Ka from the plant; Tr searched → 0.0277 | 0.112 → 0.11 | 31 | 430 | yes |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 1.55 → 1.55 | 1 | 7.7 | no: fails the main job: Following a smooth move (IAE) ×2.54 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×13 of the datum's (at most ×2) |
| Sliding mode (ideal) ⚙ rate observer | λ from the step model, K the full swing | 0.32 → 0.32 | 32 | 350 | no: fails the main job: Rejecting d (IAE) ×4.49 of the datum's (at most ×2) |
| Sliding mode (boundary layer) ⚙ rate observer | and φ = 0.2·λ·span r | 0.119 → 0.11 | 52 | 490 | yes |

Scores:

| Candidate | Following steps (IAE) | Following a smooth move (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: P, too aggressive | 0.16 | 0.11 | 0.023 | 24 % | 0.83 | 0.25 | 3.6 | 0.16 | 4.7 | 1.3 | 0.023 | 2 | 0 | 15 | 9.9 ms |
| PID | 0.11 | 0.078 | 0.0076 | 0.87 % | 0.2 | 0.16 | 1.2 | 0.088 | 1.9 | 0.11 | 0.037 | 4 | 91 | 44 | 31 ms |
| Gain-scheduled PI | 0.14 | 0.14 | 0.03 | 6.5 % | 0.47 | 0.14 | 0.86 | 0 | 1.4 | 0.11 | 0.0042 | 6 | 61 | 61 | 130 ms |
| PID + feedforward from the plant | 0.12 | 0.061 | 0.0076 | 0.36 % | 0.2 | 0.16 | 1.2 | 0.08 | 1.9 | 0.11 | 0.037 | 9 | 31 | 44 | 31 ms |
| Relay (on/off) | 0.22 | 0.2 | 0.11 | 26 % | 0.99 | 0.5 | 9 | 1 | no linear model | 1.6 | 0.52 | 2 | 1 | — | — |
| Sliding mode (ideal) ⚙ rate observer | 0.14 | 0.1 | 0.038 | 6.4 % | 0.98 | 0.49 | 17 | 0.95 | no linear model | 0.32 | 0.42 | 9 | 32 | — | — |
| Sliding mode (boundary layer) ⚙ rate observer | 0.12 | 0.084 | 0.0098 | 0.62 % | 0.21 | 0.16 | 1 | 0.08 | 1.3 | 0.11 | 0.011 | 10 | 52 | 61 | 56 ms |

The feedforward's share of the effort (Σ|ff| / (Σ|ff| + Σ|u − ff|)):

- PID + feedforward from the plant (Kff 0, Kv 1.34, Ka 0.0356, prefilter Tr 0.0277 s): 16 % on the system's steps, 75 % on the smooth move; following IAE 0.12 (steps), 0.061 (move), against the datum's 0.11 and 0.078.

Pugh matrix: datum **PID**; five-point marks (++ +2, + +1, S 0, − −1, −− −2, ? not judged); weights 1.5, 1.5, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: P, too aggressive | PID | Gain-scheduled PI | PID + feedforward from the plant | Relay (on/off) | Sliding mode (ideal) ⚙ rate observer | Sliding mode (boundary layer) ⚙ rate observer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Following steps (IAE) (1.5) | − | D | − | S | − | − | S |
| Following a smooth move (IAE) (1.5) | − | D | − | + | −− | − | S |
| Rejecting d (IAE) (3) | −− | D | −− | S | −− | −− | − |
| Overshoot (2) | −− | D | −− | + | −− | −− | S |
| Settling (2 %, s) (1) | −− | D | −− | S | −− | −− | S |
| Effort (u swing) (1) | − | D | + | S | −− | −− | S |
| Wear (u travel/s) (2) | −− | D | + | S | −− | −− | S |
| Time at a limit (1) | − | D | ++ | S | −− | −− | S |
| Robustness Ms (2) | −− | D | + | S | ? | ? | + |
| Plant ±15 % (worst J) (3) | −− | D | S | S | −− | −− | S |
| Noise → u (2) | + | D | ++ | S | −− | −− | ++ |
| Complexity (1) | + | D | − | −− | + | −− | −− |
| Tuning runs (1) | ++ | D | S | ++ | ++ | ++ | + |
| **Weighted** | -26 | 0 | -5 | +3.5 | -31.5 | -33 | +2 |
| **Fits** | no | yes | no | yes | no | no | yes |

Ranking (fitting only): 1. PID + feedforward from the plant (+3.5); 2. Sliding mode (boundary layer) ⚙ rate observer (+2); 3. PID (+0).

Not ranked: As loaded: P, too aggressive: fragile, at r's middle: Robustness Ms 4.7 above 3; fails the main job: Rejecting d (IAE) ×2.81 of the datum's (at most ×2); Gain-scheduled PI: fails the main job: Rejecting d (IAE) ×3.57 of the datum's (at most ×2); Relay (on/off): fails the main job: Following a smooth move (IAE) ×2.54 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×13 of the datum's (at most ×2); Sliding mode (ideal) ⚙ rate observer: fails the main job: Rejecting d (IAE) ×4.49 of the datum's (at most ×2).

Suggestion: **PID + feedforward from the plant** (+3.5), added as a variant, not switched on.

Weight sensitivity (winner PID + feedforward from the plant; reasonable: each weight within ±1 of its default): **robust**. It wins 97.8 % of 4000 weight draws within one step.
- PID (+0, wins 2.23 % of draws): ties if Complexity goes 1 → 2.75 (not reasonable); all weights together: 17 % of the weights' size, the largest single change 0.7.

## Triple pendulum

Step test for the starts: relay. Total 9.1 s: load 3.58 s, starts 0.123 s, tuning 2.57 s, scoring 2.11 s, sweep (8 plants) 0.646 s. One run 5.5 ms, so about 1640 runs' worth.

Tests: the system's own input (its own disturbance plays); no smooth move (r has no steps to smooth).

Refused:

- Off (`off`): does nothing: the open loop, not a candidate
- Deadbeat (`deadbeat`): the poles did not all land at z = 0 (494300000 of the plant's motion is left after 8 samples): u moves some state too weakly at this sample time
- PI from the plant (`scheduledPI`): x integrates F: it has no static gain
- Gain-scheduled PI (`gainScheduled`): r does not move: there is no range to schedule over
- Swing-up + LQR catch (`swingUpLqr`): the swing-up reads x, θ, v, ω (θ an angle) from inputs 2 to 5; this block has x, θ1, θ2, θ3, v, ω1, ω2, ω3

Candidates (J: the goal's cost on the system's run, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: Planned swing-up + TV-LQR | not tuned | 0.219 | 0 | 0 | no: unstable at r's middle (3 poles outside); fails the main job: Rejecting d (IAE) ×3.71 of the datum's (at most ×2) |
| PID | relay test, Tyreus–Luyben; backed off to 25 % of the way (tuned: unstable at r's middle (2 poles outside)) | 0.0103 → 0.00355 | 115 | 720 | yes |
| LQR | Q = 1 for every measurement; R searched → 2.23; no point on the way fits (tuned: unstable at r's middle (3 poles outside)) | 32.6 → 20.5 | 35 | 190 | no: unstable at r's middle (3 poles outside); fails the main job: Rejecting d (IAE) ×2480 of the datum's (at most ×2) |
| State feedback | the LQR row's gains; no point on the way fits (tuned: unstable at r's middle (5 poles outside)) | 20.5 → 14.3 | 84 | 480 | no: unstable at r's middle (5 poles outside); fails the main job: Rejecting d (IAE) ×989 of the datum's (at most ×2) |
| Speed PI from the plant | its defaults | 100 → 100 | 1 | 24 | no: unstable at r's middle (6 poles outside); fails the main job: Rejecting d (IAE) ×4.0e+4 of the datum's (at most ×2) |
| PID + feedforward from the plant | the PID row's gains; Kff, Kv, Ka from the plant; Tr searched → 0.25 | 0.00355 → 0.00355 | 31 | 100 | yes |
| Swing-up (Lyapunov) + state feedback | its defaults (not iterated: A swing-up switches between pumping energy and catching the ) | 78.3 → 78.3 | 1 | 5.9 | no: fails the main job: Rejecting d (IAE) ×1.3e+4 of the datum's (at most ×2) |
| Planned swing-up + TV-LQR | its defaults | 0.244 → 0.244 | 1 | 12 | no: unstable at r's middle (3 poles outside); fails the main job: Rejecting d (IAE) ×10.3 of the datum's (at most ×2) |
| Variable gain (Hu–Lin) | its defaults | 24.5 → 24.5 | 1 | 27 | no: unstable at r's middle (3 poles outside); fails the main job: Rejecting d (IAE) ×2780 of the datum's (at most ×2) |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 0.733 → 0.733 | 1 | 4.8 | no: fails the main job: Rejecting d (IAE) ×58.8 of the datum's (at most ×2) |
| Sliding mode (ideal) | λ from the step model, K the full swing | 25.6 → 1.12 | 27 | 190 | no: fails the main job: Rejecting d (IAE) ×133 of the datum's (at most ×2) |
| Sliding mode (boundary layer) | and φ = 0.2·λ·span r; no point on the way fits (tuned: unstable at r's middle (8 poles outside)) | 8.17 → 1.69 | 49 | 330 | no: unstable at r's middle (8 poles outside); fails the main job: Rejecting d (IAE) ×147 of the datum's (at most ×2) |
| Super-twisting | λ as the sliding mode; k1 = U/3, k2 = 3.7 U | 13.9 → 1.21 | 79 | 470 | no: fails the main job: Rejecting d (IAE) ×180 of the datum's (at most ×2) |

Scores:

| Candidate | Following steps (IAE) | Following a smooth move (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: Planned swing-up + TV-LQR | — | — | 0.046 | 0 % | — | 0.069 | 0.43 | 0 | unstable | 0.22 | 0.39 | 10 | 0 | — | — |
| PID | — | — | 0.012 | 0 % | — | 0.0076 | 0.031 | 0 | 2.6 | 0.0036 | 0.027 | 4 | 120 | 10 | 34 ms |
| LQR | — | — | 32 | 0 % | — | 0.48 | 4.4 | 1 | unstable | 21 | 0.75 | 19 | 35 | — | — |
| State feedback | — | — | 13 | 0 % | — | 0.49 | 3.4 | 1 | unstable | 14 | 0.16 | 18 | 84 | — | — |
| Speed PI from the plant | — | — | 520 | 0 % | — | 62 | 83 | 0 | unstable | 100 | 2 | 3 | 1 | — | — |
| PID + feedforward from the plant | — | — | 0.012 | 0 % | — | 0.0076 | 0.031 | 0 | 2.6 | 0.0036 | 0.027 | 10 | 31 | 10 | 34 ms |
| Swing-up (Lyapunov) + state feedback | — | — | 170 | 0 % | — | 0.18 | 1.7 | 0.07 | no linear model | 78 | 0.21 | 17 | 1 | — | — |
| Planned swing-up + TV-LQR | — | — | 0.13 | 0 % | — | 0.07 | 0.43 | 0 | unstable | 0.24 | 0.38 | 10 | 1 | — | — |
| Variable gain (Hu–Lin) | — | — | 36 | 0 % | — | 0.45 | 2.8 | 0.98 | unstable | 25 | 0.45 | 3 | 1 | — | — |
| Relay (on/off) | — | — | 0.75 | 0 % | — | 0.5 | 4.4 | 1 | no linear model | 0.73 | 0.7 | 2 | 1 | — | — |
| Sliding mode (ideal) | — | — | 1.7 | 0 % | — | 0.5 | 3.4 | 1 | no linear model | 1.1 | 0 | 4 | 27 | — | — |
| Sliding mode (boundary layer) | — | — | 1.9 | 0 % | — | 0.47 | 3.3 | 0.83 | unstable | 1.7 | 0.63 | 5 | 49 | — | — |
| Super-twisting | — | — | 2.3 | 0 % | — | 0.35 | 3.1 | 0.11 | no linear model | 1.2 | 0.45 | 5 | 79 | — | — |

The feedforward's share of the effort (Σ|ff| / (Σ|ff| + Σ|u − ff|)):

- PID + feedforward from the plant (Kff -5.4e-15, Kv 6.33, Ka 1.24, prefilter Tr 0.25 s): 0 % on the system's steps, — on the smooth move; following IAE — (steps), — (move), against the datum's — and —.

Pugh matrix: datum **PID**; five-point marks (++ +2, + +1, S 0, − −1, −− −2, ? not judged); weights 1.5, 1.5, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: Planned swing-up + TV-LQR | PID | LQR | State feedback | Speed PI from the plant | PID + feedforward from the plant | Swing-up (Lyapunov) + state feedback | Planned swing-up + TV-LQR | Variable gain (Hu–Lin) | Relay (on/off) | Sliding mode (ideal) | Sliding mode (boundary layer) | Super-twisting |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Following steps (IAE) (1.5) | ? | D | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| Following a smooth move (IAE) (1.5) | ? | D | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| Rejecting d (IAE) (3) | −− | D | −− | −− | −− | S | −− | −− | −− | −− | −− | −− | −− |
| Overshoot (2) | S | D | S | S | S | S | S | S | S | S | S | S | S |
| Settling (2 %, s) (1) | ? | D | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| Effort (u swing) (1) | −− | D | −− | −− | −− | S | −− | −− | −− | −− | −− | −− | −− |
| Wear (u travel/s) (2) | −− | D | −− | −− | −− | S | −− | −− | −− | −− | −− | −− | −− |
| Time at a limit (1) | S | D | −− | −− | S | S | −− | S | −− | −− | −− | −− | −− |
| Robustness Ms (2) | ? | D | ? | ? | ? | S | ? | ? | ? | ? | ? | ? | ? |
| Plant ±15 % (worst J) (3) | −− | D | −− | −− | −− | S | −− | −− | −− | −− | −− | −− | −− |
| Noise → u (2) | −− | D | −− | −− | −− | S | −− | −− | −− | −− | ++ | −− | −− |
| Complexity (1) | −− | D | −− | −− | + | −− | −− | −− | + | + | + | − | − |
| Tuning runs (1) | ++ | D | ++ | S | ++ | ++ | ++ | ++ | ++ | ++ | ++ | ++ | S |
| **Weighted** | -22 | 0 | -24 | -26 | -19 | +0 | -24 | -22 | -21 | -21 | -13 | -23 | -25 |
| **Fits** | no | yes | no | no | no | yes | no | no | no | no | no | no | no |

Ranking (fitting only): 1. PID (+0); 2. PID + feedforward from the plant (+0).

Not ranked: As loaded: Planned swing-up + TV-LQR: unstable at r's middle (3 poles outside); fails the main job: Rejecting d (IAE) ×3.71 of the datum's (at most ×2); LQR: unstable at r's middle (3 poles outside); fails the main job: Rejecting d (IAE) ×2480 of the datum's (at most ×2); State feedback: unstable at r's middle (5 poles outside); fails the main job: Rejecting d (IAE) ×989 of the datum's (at most ×2); Speed PI from the plant: unstable at r's middle (6 poles outside); fails the main job: Rejecting d (IAE) ×4.0e+4 of the datum's (at most ×2); Swing-up (Lyapunov) + state feedback: fails the main job: Rejecting d (IAE) ×1.3e+4 of the datum's (at most ×2); Planned swing-up + TV-LQR: unstable at r's middle (3 poles outside); fails the main job: Rejecting d (IAE) ×10.3 of the datum's (at most ×2); Variable gain (Hu–Lin): unstable at r's middle (3 poles outside); fails the main job: Rejecting d (IAE) ×2780 of the datum's (at most ×2); Relay (on/off): fails the main job: Rejecting d (IAE) ×58.8 of the datum's (at most ×2); Sliding mode (ideal): fails the main job: Rejecting d (IAE) ×133 of the datum's (at most ×2); Sliding mode (boundary layer): unstable at r's middle (8 poles outside); fails the main job: Rejecting d (IAE) ×147 of the datum's (at most ×2); Super-twisting: fails the main job: Rejecting d (IAE) ×180 of the datum's (at most ×2).

Suggestion: **PID** (+0), added as a variant, not switched on.

Weight sensitivity (winner PID; reasonable: each weight within ±1 of its default): **sensitive**. It wins 49.9 % of 4000 weight draws within one step.
- PID + feedforward from the plant (+0, wins 50.1 % of draws): tied now: the same total, J breaks the tie; all weights together: 0 % of the weights' size, the largest single change 0.

## Following a sine (XY)

Step test for the starts: integrating. Total 3.4 s: load 0.0288 s, starts 0.0668 s, tuning 2.66 s, scoring 0.194 s, sweep (8 plants) 0.433 s. One run 7.3 ms, so about 469 runs' worth.

Tests: the system's own input, plus the standard disturbance (it has none of its own): a load step of -2.4 at the plant's input from 2.5 s (10 % of u's range); no smooth move (r has no steps to smooth).

Refused:

- Off (`off`): does nothing: the open loop, not a candidate
- LQR (`lqr`): LQR needs every state measured. This block sees rotor angle but not Motor/armature 1/(L·s + R) and Motor/rotor 1/Jm.
- State feedback (`stateFeedback`): starts from the LQR design, which refused: LQR needs every state measured. This block sees rotor angle but not Motor/armature 1/(L·s + R) and Motor/rotor 1/Jm.
- Deadbeat (`deadbeat`): deadbeat state feedback needs every state measured. This block sees rotor angle but not Motor/armature 1/(L·s + R) and Motor/rotor 1/Jm.
- PI from the plant (`scheduledPI`): θ measured integrates V: it has no static gain
- Speed PI from the plant (`speedPI`): θ measured does not accelerate with V (∂ẏ/∂u = 0): speedPI needs a measured speed
- Swing-up (Lyapunov) + state feedback (`swingUp`): reads x, θ, v, ω of a pendulum on a cart (4 measurements); this block measures 1
- Swing-up + LQR catch (`swingUpLqr`): the swing-up reads x, θ, v, ω (θ an angle) from inputs 2 to 5; this block has θ measured
- Planned swing-up + TV-LQR (`trajectory`): LQR needs every state measured. This block sees rotor angle but not Motor/armature 1/(L·s + R) and Motor/rotor 1/Jm.
- Variable gain (Hu–Lin) (`huLin`): LQR needs every state measured. This block sees rotor angle but not Motor/armature 1/(L·s + R) and Motor/rotor 1/Jm.
- Sliding mode (`slidingMode`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)
- Super-twisting (`superTwisting`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)

Plant changes scored (⚙, never applied; complexity +5):

- a Finite difference observer (Tf 0.01 s) makes ẏ from y for input 3

Candidates (J: the goal's cost on the system's run, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: P | not tuned | 0.219 | 0 | 0 | no: fails the main job: Rejecting d (IAE) ×59.9 of the datum's (at most ×2) |
| PID | step test, SIMC (integrating); backed off to 50 % of the way (tuned: Ms 10) | 0.0158 → 0.00515 | 94 | 810 | yes |
| Gain-scheduled PI | the PID's gains, flat; no point on the way fits (tuned: Ms 8.5) | 0.169 → 0.00772 | 48 | 420 | no: fragile, at r's middle: Robustness Ms 8.5 above 3 |
| PID + feedforward from the plant | the PID row's gains; Kff, Kv, Ka from the plant; Tr searched → 0.00178 | 0.0174 → 0.0016 | 31 | 230 | yes |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 0.326 → 0.326 | 1 | 7.6 | no: fails the main job: Rejecting d (IAE) ×19.5 of the datum's (at most ×2) |
| Sliding mode (ideal) ⚙ rate observer | λ from the step model, K the full swing | 0.258 → 0.256 | 42 | 450 | no: fails the main job: Rejecting d (IAE) ×8.28 of the datum's (at most ×2) |
| Sliding mode (boundary layer) ⚙ rate observer | and φ = 0.2·λ·span r | 0.0344 → 0.0155 | 76 | 700 | no: fails the main job: Rejecting d (IAE) ×3.15 of the datum's (at most ×2) |

Scores:

| Candidate | Following steps (IAE) | Following a smooth move (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: P | — | — | 0.35 | 0 % | — | 0.053 | 0.054 | 0 | 1.2 | 0.22 | 0.0019 | 2 | 0 | 75 | 310 ms |
| PID | — | — | 0.0049 | 0 % | — | 0.059 | 0.1 | 0 | 2.6 | 0.0052 | 0.064 | 4 | 94 | 31 | 17 ms |
| Gain-scheduled PI | — | — | 0.0091 | 0 % | — | 0.062 | 0.33 | 0 | 8.5 | 0.0077 | 0.026 | 7 | 48 | 7.5 | 5.3 ms |
| PID + feedforward from the plant | — | — | 0.0023 | 0 % | — | 0.06 | 0.21 | 0 | 2.6 | 0.0016 | 0.064 | 9 | 31 | 31 | 17 ms |
| Relay (on/off) | — | — | 0.11 | 0 % | — | 0.5 | 10 | 1 | no linear model | 0.33 | 0.51 | 2 | 1 | — | — |
| Sliding mode (ideal) ⚙ rate observer | — | — | 0.048 | 0 % | — | 0.5 | 19 | 1 | no linear model | 0.26 | 0.79 | 9 | 42 | — | — |
| Sliding mode (boundary layer) ⚙ rate observer | — | — | 0.018 | 0 % | — | 0.072 | 1.6 | 0 | 2.7 | 0.015 | 0.22 | 10 | 76 | 25 | 9.1 ms |

The feedforward's share of the effort (Σ|ff| / (Σ|ff| + Σ|u − ff|)):

- PID + feedforward from the plant (Kff 0, Kv 1.95, Ka 0.0295, prefilter Tr 0.00178 s): 48 % on the system's steps, — on the smooth move; following IAE — (steps), — (move), against the datum's — and —.

Pugh matrix: datum **PID**; five-point marks (++ +2, + +1, S 0, − −1, −− −2, ? not judged); weights 1.5, 1.5, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: P | PID | Gain-scheduled PI | PID + feedforward from the plant | Relay (on/off) | Sliding mode (ideal) ⚙ rate observer | Sliding mode (boundary layer) ⚙ rate observer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Following steps (IAE) (1.5) | ? | D | ? | ? | ? | ? | ? |
| Following a smooth move (IAE) (1.5) | ? | D | ? | ? | ? | ? | ? |
| Rejecting d (IAE) (3) | −− | D | − | + | −− | −− | −− |
| Overshoot (2) | S | D | S | S | S | S | S |
| Settling (2 %, s) (1) | ? | D | ? | ? | ? | ? | ? |
| Effort (u swing) (1) | S | D | S | S | −− | −− | − |
| Wear (u travel/s) (2) | + | D | −− | − | −− | −− | −− |
| Time at a limit (1) | S | D | S | S | −− | −− | S |
| Robustness Ms (2) | ++ | D | −− | S | ? | ? | S |
| Plant ±15 % (worst J) (3) | −− | D | − | + | −− | −− | −− |
| Noise → u (2) | ++ | D | ++ | S | −− | −− | −− |
| Complexity (1) | + | D | − | −− | + | −− | −− |
| Tuning runs (1) | ++ | D | + | ++ | ++ | ++ | S |
| **Weighted** | +1 | 0 | -10 | +4 | -21 | -24 | -23 |
| **Fits** | no | yes | no | yes | no | no | no |

Ranking (fitting only): 1. PID + feedforward from the plant (+4); 2. PID (+0).

Not ranked: As loaded: P: fails the main job: Rejecting d (IAE) ×59.9 of the datum's (at most ×2); Gain-scheduled PI: fragile, at r's middle: Robustness Ms 8.5 above 3; Relay (on/off): fails the main job: Rejecting d (IAE) ×19.5 of the datum's (at most ×2); Sliding mode (ideal) ⚙ rate observer: fails the main job: Rejecting d (IAE) ×8.28 of the datum's (at most ×2); Sliding mode (boundary layer) ⚙ rate observer: fails the main job: Rejecting d (IAE) ×3.15 of the datum's (at most ×2).

Suggestion: **PID + feedforward from the plant** (+4), added as a variant, not switched on.

Weight sensitivity (winner PID + feedforward from the plant; reasonable: each weight within ±1 of its default): **robust**. It wins 98.3 % of 4000 weight draws within one step.
- PID (+0, wins 1.73 % of draws): ties if Complexity goes 1 → 3 (not reasonable); all weights together: 18 % of the weights' size, the largest single change 0.73.

## Encoder errors and torque ripple

Step test for the starts: fopdt. Total 18.6 s: load 0.191 s, starts 0.363 s, tuning 13.2 s, scoring 1.09 s, sweep (8 plants) 3.48 s. One run 57 ms, so about 327 runs' worth.

Tests: the system's own input, plus the standard disturbance (it has none of its own): a load step of -9.6 at the plant's input from 2.5 s (10 % of u's range); no smooth move (r has no steps to smooth).

Refused:

- Off (`off`): does nothing: the open loop, not a candidate
- LQR (`lqr`): the plant is not at rest at the origin: Motor/speed from angle moves at -18000/s with V = 0
- State feedback (`stateFeedback`): starts from the LQR design, which refused: the plant is not at rest at the origin: Motor/speed from angle moves at -18000/s with V = 0
- Deadbeat (`deadbeat`): the plant is not at rest at the origin: Motor/speed from angle moves at -18000/s with V = 0
- PI from the plant (`scheduledPI`): no equilibrium with ω measured = 150: the best found leaves a residual of 68200
- Speed PI from the plant (`speedPI`): ω measured is no state of the plant this lane sees: speedPI needs a measured speed
- Swing-up (Lyapunov) + state feedback (`swingUp`): reads x, θ, v, ω of a pendulum on a cart (4 measurements); this block measures 1
- Swing-up + LQR catch (`swingUpLqr`): the swing-up reads x, θ, v, ω (θ an angle) from inputs 2 to 5; this block has ω measured
- Planned swing-up + TV-LQR (`trajectory`): the plant is not at rest at the origin: Motor/speed from angle moves at -18000/s with V = 0
- Variable gain (Hu–Lin) (`huLin`): the plant is not at rest at the origin: Motor/speed from angle moves at -18000/s with V = 0
- Sliding mode (`slidingMode`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)
- Super-twisting (`superTwisting`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)

Plant changes scored (⚙, never applied; complexity +5):

- a Finite difference observer (Tf 0.00425 s) makes ẏ from y for input 3

Candidates (J: the goal's cost on the system's run, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: PI speed | not tuned | 0.0838 | 0 | 0 | yes |
| PID | step test, SIMC (fopdt) | 0.0801 → 0.0747 | 70 | 4500 | yes |
| Gain-scheduled PI | the PID's gains, flat | 0.0747 → 0.0747 | 37 | 2800 | yes |
| PID + feedforward from the plant | the PID row's gains; Kff, Kv, Ka from the plant; Tr searched → 0.00145 | 0.757 → 0.587 | 31 | 1600 | no: fails the main job: Rejecting d (IAE) ×3.33 of the datum's (at most ×2) |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 0.353 → 0.353 | 1 | 61 | no: fails the main job: Rejecting d (IAE) ×2.14 of the datum's (at most ×2) |
| Sliding mode (ideal) ⚙ rate observer | λ from the step model, K the full swing | 0.83 → 0.36 | 17 | 1800 | no: fails the main job: Rejecting d (IAE) ×2.23 of the datum's (at most ×2) |
| Sliding mode (boundary layer) ⚙ rate observer | and φ = 0.2·λ·span r; no point on the way fits (tuned: unstable where the run starts (3 poles outside)) | 0.824 → 0.175 | 30 | 2300 | no: unstable where the run starts (3 poles outside); it rests there only because it starts in balance; fails the main job: Rejecting d (IAE) ×3.02 of the datum's (at most ×2) |

Scores:

| Candidate | Following steps (IAE) | Following a smooth move (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: PI speed | — | — | 0.06 | 0 % | — | 0.19 | 2.8 | 0.24 | no linear model | 0.084 | 0.0071 | 3 | 0 | — | — |
| PID | — | — | 0.056 | 0 % | — | 0.19 | 0.37 | 0.21 | no linear model | 0.075 | 0.0013 | 3 | 70 | — | — |
| Gain-scheduled PI | — | — | 0.056 | 0 % | — | 0.19 | 0.37 | 0.21 | no linear model | 0.075 | 0.0013 | 6 | 37 | — | — |
| PID + feedforward from the plant | — | — | 0.19 | 0 % | — | 0.17 | 0.5 | 0.9 | no linear model | 0.59 | 5.9e-4 | 9 | 31 | — | — |
| Relay (on/off) | — | — | 0.12 | 0 % | — | 0.44 | 87 | 1 | no linear model | 0.35 | 0.28 | 2 | 1 | — | — |
| Sliding mode (ideal) ⚙ rate observer | — | — | 0.13 | 0 % | — | 0.44 | 88 | 1 | no linear model | 0.36 | 0.31 | 9 | 17 | — | — |
| Sliding mode (boundary layer) ⚙ rate observer | — | — | 0.17 | 0 % | — | 0.25 | 46 | 0.25 | no linear model | 0.17 | 0.034 | 10 | 30 | — | — |

The feedforward's share of the effort (Σ|ff| / (Σ|ff| + Σ|u − ff|)):

- PID + feedforward from the plant (Kff 3.5e+6, Kv 4.3e+12, Ka 5.2e+18, prefilter Tr 0.00145 s): 48 % on the system's steps, — on the smooth move; following IAE — (steps), — (move), against the datum's — and —.

Pugh matrix: datum **PID**; five-point marks (++ +2, + +1, S 0, − −1, −− −2, ? not judged); weights 1.5, 1.5, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: PI speed | PID | Gain-scheduled PI | PID + feedforward from the plant | Relay (on/off) | Sliding mode (ideal) ⚙ rate observer | Sliding mode (boundary layer) ⚙ rate observer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Following steps (IAE) (1.5) | ? | D | ? | ? | ? | ? | ? |
| Following a smooth move (IAE) (1.5) | ? | D | ? | ? | ? | ? | ? |
| Rejecting d (IAE) (3) | S | D | S | −− | −− | −− | −− |
| Overshoot (2) | S | D | S | S | S | S | S |
| Settling (2 %, s) (1) | ? | D | ? | ? | ? | ? | ? |
| Effort (u swing) (1) | S | D | S | S | −− | −− | − |
| Wear (u travel/s) (2) | −− | D | S | − | −− | −− | −− |
| Time at a limit (1) | S | D | S | −− | −− | −− | S |
| Robustness Ms (2) | ? | D | ? | ? | ? | ? | ? |
| Plant ±15 % (worst J) (3) | S | D | S | −− | −− | −− | −− |
| Noise → u (2) | −− | D | S | + | −− | −− | −− |
| Complexity (1) | + | D | − | −− | + | −− | −− |
| Tuning runs (1) | ++ | D | + | ++ | ++ | ++ | ++ |
| **Weighted** | -5 | 0 | +0 | -14 | -21 | -24 | -21 |
| **Fits** | yes | yes | yes | no | no | no | no |

Ranking (fitting only): 1. Gain-scheduled PI (+0); 2. PID (+0); 3. As loaded: PI speed (-5).

Not ranked: PID + feedforward from the plant: fails the main job: Rejecting d (IAE) ×3.33 of the datum's (at most ×2); Relay (on/off): fails the main job: Rejecting d (IAE) ×2.14 of the datum's (at most ×2); Sliding mode (ideal) ⚙ rate observer: fails the main job: Rejecting d (IAE) ×2.23 of the datum's (at most ×2); Sliding mode (boundary layer) ⚙ rate observer: unstable where the run starts (3 poles outside); it rests there only because it starts in balance; fails the main job: Rejecting d (IAE) ×3.02 of the datum's (at most ×2).

Suggestion: **Gain-scheduled PI** (+0), added as a variant, not switched on.

Weight sensitivity (winner Gain-scheduled PI; reasonable: each weight within ±1 of its default): **sensitive**. It wins 49.8 % of 4000 weight draws within one step.
- PID (+0, wins 49.8 % of draws): tied now: the same total, J breaks the tie; all weights together: 0 % of the weights' size, the largest single change 0.
- As loaded: PI speed (-5, wins 0.425 % of draws): ties if Complexity goes 1 → 3.5 (not reasonable); all weights together: 21 % of the weights' size, the largest single change 0.77.

## DC motor, speed from an encoder

Step test for the starts: relay. Total 13.8 s: load 0.0875 s, starts 0.593 s, tuning 9.29 s, scoring 1.2 s, sweep (8 plants) 2.51 s. One run 26 ms, so about 523 runs' worth.

Tests: the system's own input (its own disturbance plays); the smooth move: r through 1/(τs + 1)³, τ = 0.0548 s.

Refused:

- Off (`off`): does nothing: the open loop, not a candidate
- LQR (`lqr`): LQR needs every state measured. This block sees rotor 1/Jm but not Motor/armature 1/(L·s + R).
- State feedback (`stateFeedback`): starts from the LQR design, which refused: LQR needs every state measured. This block sees rotor 1/Jm but not Motor/armature 1/(L·s + R).
- Deadbeat (`deadbeat`): deadbeat state feedback needs every state measured. This block sees rotor 1/Jm but not Motor/armature 1/(L·s + R).
- Swing-up (Lyapunov) + state feedback (`swingUp`): reads x, θ, v, ω of a pendulum on a cart (4 measurements); this block measures 1
- Swing-up + LQR catch (`swingUpLqr`): the swing-up reads x, θ, v, ω (θ an angle) from inputs 2 to 5; this block has x̂2
- Planned swing-up + TV-LQR (`trajectory`): LQR needs every state measured. This block sees rotor 1/Jm but not Motor/armature 1/(L·s + R).
- Variable gain (Hu–Lin) (`huLin`): LQR needs every state measured. This block sees rotor 1/Jm but not Motor/armature 1/(L·s + R).
- Sliding mode (`slidingMode`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)
- Super-twisting (`superTwisting`): reads ẏ on input 3; this block measures 1 signal (a Finite difference observer would make it)

Plant changes scored (⚙, never applied; complexity +5):

- a Finite difference observer (Tf 0.025 s) makes ẏ from y for input 3
- input 2 measures motor:2 directly (it matches the rate of motor:1 within 0.18 %), in place of 'speed estimator' (Finite difference)

Candidates (J: the goal's cost on the system's run, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: PI speed | not tuned | 3 | 0 | 0 | yes |
| PID | relay test, Tyreus–Luyben | 4.19 → 4.19 | 40 | 1400 | yes |
| PI from the plant | one level, r's middle; Tcl searched → 0.0401 | 4.21 → 4.19 | 31 | 1200 | yes |
| Gain-scheduled PI | PI from the plant at 3 levels | 4.19 → 2.44 | 55 | 1900 | yes |
| Speed PI from the plant | its defaults | 4.19 → 4.19 | 1 | 31 | yes |
| PID + feedforward from the plant | the PID row's gains; Kff, Kv, Ka from the plant; Tr searched → 0.0969 | 2.46 → 2.44 | 31 | 1200 | yes |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 3.2 → 3.2 | 1 | 27 | yes |
| Sliding mode (ideal) ⚙ rate observer | λ from the step model, K the full swing | 3.36 → 3.36 | 5 | 170 | no: fails the main job: Following steps (IAE) ×2.01 of the datum's (at most ×2); fails the main job: Following a smooth move (IAE) ×2.07 of the datum's (at most ×2) |
| Sliding mode (boundary layer) ⚙ rate observer | and φ = 0.2·λ·span r | 3.36 → 3.36 | 8 | 270 | no: fails the main job: Following steps (IAE) ×2.01 of the datum's (at most ×2); fails the main job: Following a smooth move (IAE) ×2.06 of the datum's (at most ×2) |
| As loaded ⚙ sensor | not tuned | 0.0128 | 0 | 0 | yes |
| PID ⚙ sensor | relay test, Tyreus–Luyben | 1.42 → 0.0121 | 108 | 3000 | yes |

Scores:

| Candidate | Following steps (IAE) | Following a smooth move (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: PI speed | 0.32 | 0.3 | 0.31 | 130 % | 1.7 | 0.27 | 390 | 0.12 | 1.4 | 3 | 0.31 | 3 | 0 | 58 | 20 ms |
| PID | 0.3 | 0.29 | 0.31 | 130 % | 1.7 | 0.14 | 130 | 0.0026 | 1.6 | 4.2 | 0.11 | 4 | 40 | 43 | 26 ms |
| PI from the plant | 0.31 | 0.28 | 0.31 | 130 % | 1.7 | 0.17 | 200 | 0.0032 | 1.2 | 4.2 | 0.16 | 5 | 31 | 77 | 49 ms |
| Gain-scheduled PI | 0.31 | 0.29 | 0.31 | 84 % | 1.7 | 0.19 | 230 | 0.0054 | 1.2 | 2.4 | 0.19 | 9 | 55 | 84 | 48 ms |
| Speed PI from the plant | 0.3 | 0.28 | 0.31 | 130 % | 1.7 | 0.32 | 460 | 0 | 1.4 | 4.2 | 0.37 | 3 | 1 | 60 | 18 ms |
| PID + feedforward from the plant | 0.31 | 0.29 | 0.31 | 84 % | 1.7 | 0.13 | 130 | 6.0e-4 | 1.6 | 2.4 | 0.11 | 10 | 31 | 43 | 26 ms |
| Relay (on/off) | 0.35 | 0.33 | 0.31 | 130 % | 1.7 | 0.48 | 640 | 1 | no linear model | 3.2 | 0.48 | 2 | 1 | — | — |
| Sliding mode (ideal) ⚙ rate observer | 0.61 | 0.59 | 0.31 | 130 % | 1.7 | 0.48 | 750 | 0.96 | no linear model | 3.4 | 0.63 | 9 | 5 | — | — |
| Sliding mode (boundary layer) ⚙ rate observer | 0.61 | 0.59 | 0.31 | 130 % | 1.7 | 0.48 | 750 | 0.96 | 1.7 | 3.4 | 0.56 | 10 | 8 | 46 | 7.4 ms |
| As loaded ⚙ sensor | 0.016 | 0.009 | 0.0014 | 9.9 % | 0.12 | 0.11 | 0.39 | 0.0048 | 1.4 | 0.013 | 0.0043 | 8 | 0 | 58 | 20 ms |
| PID ⚙ sensor | 0.016 | 0.013 | 0.0019 | 5.9 % | 0.098 | 0.11 | 0.28 | 0.0014 | 1.3 | 0.012 | 0.0029 | 9 | 110 | 64 | 32 ms |

The feedforward's share of the effort (Σ|ff| / (Σ|ff| + Σ|u − ff|)):

- PID + feedforward from the plant (Kff 0.7, Kv 0.0422, Ka 4.0e-4, prefilter Tr 0.0969 s): 69 % on the system's steps, 69 % on the smooth move; following IAE 0.31 (steps), 0.29 (move), against the datum's 0.3 and 0.29.

Pugh matrix: datum **PID**; five-point marks (++ +2, + +1, S 0, − −1, −− −2, ? not judged); weights 1.5, 1.5, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: PI speed | PID | PI from the plant | Gain-scheduled PI | Speed PI from the plant | PID + feedforward from the plant | Relay (on/off) | Sliding mode (ideal) ⚙ rate observer | Sliding mode (boundary layer) ⚙ rate observer | Loaded ⚙ sensor | PID ⚙ sensor |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Following steps (IAE) (1.5) | S | D | S | S | S | S | − | −− | −− | ++ | ++ |
| Following a smooth move (IAE) (1.5) | S | D | S | S | S | S | − | −− | −− | ++ | ++ |
| Rejecting d (IAE) (3) | S | D | S | S | S | S | S | S | S | ++ | ++ |
| Overshoot (2) | S | D | S | + | S | + | S | S | S | ++ | ++ |
| Settling (2 %, s) (1) | S | D | S | S | S | S | S | S | S | ++ | ++ |
| Effort (u swing) (1) | − | D | − | − | −− | S | −− | −− | −− | + | + |
| Wear (u travel/s) (2) | −− | D | − | − | −− | S | −− | −− | −− | ++ | ++ |
| Time at a limit (1) | −− | D | S | S | S | S | −− | −− | −− | S | S |
| Robustness Ms (2) | + | D | + | + | + | S | ? | ? | S | + | + |
| Plant ±15 % (worst J) (3) | + | D | S | + | S | + | + | + | + | ++ | ++ |
| Noise → u (2) | −− | D | − | − | −− | S | −− | −− | −− | ++ | ++ |
| Complexity (1) | + | D | − | −− | + | −− | + | −− | −− | − | −− |
| Tuning runs (1) | ++ | D | S | S | ++ | S | ++ | ++ | ++ | ++ | −− |
| **Weighted** | -3 | 0 | -4 | +0 | -5 | +3 | -9 | -15 | -15 | +36 | +31 |
| **Fits** | yes | yes | yes | yes | yes | yes | yes | no | no | yes | yes |

Ranking (fitting only): 1. As loaded ⚙ sensor (+36); 2. PID ⚙ sensor (+31); 3. PID + feedforward from the plant (+3); 4. Gain-scheduled PI (+0); 5. PID (+0); 6. As loaded: PI speed (-3); 7. PI from the plant (-4); 8. Speed PI from the plant (-5); 9. Relay (on/off) (-9).

Not ranked: Sliding mode (ideal) ⚙ rate observer: fails the main job: Following steps (IAE) ×2.01 of the datum's (at most ×2); fails the main job: Following a smooth move (IAE) ×2.07 of the datum's (at most ×2); Sliding mode (boundary layer) ⚙ rate observer: fails the main job: Following steps (IAE) ×2.01 of the datum's (at most ×2); fails the main job: Following a smooth move (IAE) ×2.06 of the datum's (at most ×2).

Suggestion: **PID + feedforward from the plant** (+3), added as a variant, not switched on; ranked above it with a plant change: As loaded ⚙ sensor (+36; input 2 measures motor:2 directly (it matches the rate of motor:1 within 0.18 %), in place of 'speed estimator' (Finite difference)); PID ⚙ sensor (+31; input 2 measures motor:2 directly (it matches the rate of motor:1 within 0.18 %), in place of 'speed estimator' (Finite difference)).

Weight sensitivity (winner PID + feedforward from the plant; reasonable: each weight within ±1 of its default): **robust**. It wins 96.3 % of 4000 weight draws within one step.
- Gain-scheduled PI (+0, wins 0.175 % of draws): ties if Robustness Ms goes 2 → 5 (not reasonable); all weights together: 23 % of the weights' size, the largest single change 0.75.
- PID (+0, wins 1.03 % of draws): ties if Complexity goes 1 → 2.5 (not reasonable); all weights together: 19 % of the weights' size, the largest single change 1.
- As loaded: PI speed (-3, wins 2.33 % of draws): ties if Complexity goes 1 → 3 (not reasonable); all weights together: 17 % of the weights' size, the largest single change 0.64.

## DC motor with an unbalanced arm

Step test for the starts: relay. Total 7.7 s: load 0.0586 s, starts 0.311 s, tuning 5.84 s, scoring 0.428 s, sweep (8 plants) 0.975 s. One run 14 ms, so about 556 runs' worth.

Tests: the system's own input (its own disturbance plays); the smooth move: r through 1/(τs + 1)³, τ = 0.0477 s.

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

Candidates (J: the goal's cost on the system's run, IAE + effort + overshoot + saturation; start → tuned):

| Candidate | Tuned how | J start → tuned | Runs | ms | Fits |
|---|---|---|---|---|---|
| As loaded: PID | not tuned | 0.152 | 0 | 0 | yes |
| PID | relay test, Tyreus–Luyben | 0.433 → 0.0429 | 112 | 1700 | yes |
| PI from the plant | one level, r's middle; Tcl searched → 0.107 | 3.66 → 2.65 | 31 | 590 | no: fails the main job: Following steps (IAE) ×7.07 of the datum's (at most ×2); fails the main job: Following a smooth move (IAE) ×6.24 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×31.3 of the datum's (at most ×2) |
| Gain-scheduled PI | PI from the plant at 3 levels | 2.68 → 2.4 | 89 | 1300 | no: fails the main job: Following steps (IAE) ×6.89 of the datum's (at most ×2); fails the main job: Following a smooth move (IAE) ×6.25 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×30.7 of the datum's (at most ×2) |
| PID + feedforward from the plant | the PID row's gains; Kff, Kv, Ka from the plant; Tr searched → 1.02 | 6.6 → 0.294 | 31 | 600 | no: fails the main job: Following steps (IAE) ×5.38 of the datum's (at most ×2); fails the main job: Following a smooth move (IAE) ×6.12 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×30.6 of the datum's (at most ×2) |
| Relay (on/off) | the full actuator range, hysteresis 0.5 % of r | 4.03 → 4.03 | 1 | 13 | no: fails the main job: Following steps (IAE) ×8.16 of the datum's (at most ×2); fails the main job: Following a smooth move (IAE) ×8.24 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×41.6 of the datum's (at most ×2) |
| Sliding mode (ideal) ⚙ rate observer | λ from the step model, K the full swing | 0.345 → 0.274 | 13 | 330 | no: fails the main job: Following a smooth move (IAE) ×2.29 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×4.6 of the datum's (at most ×2) |
| Sliding mode (boundary layer) ⚙ rate observer | and φ = 0.2·λ·span r | 0.274 → 0.0695 | 80 | 1300 | yes |

Scores:

| Candidate | Following steps (IAE) | Following a smooth move (IAE) | Rejecting d (IAE) | Overshoot | Settling (2 %, s) | Effort (u swing) | Wear (u travel/s) | Time at a limit | Robustness Ms | Plant ±15 % (worst J) | Noise → u | Complexity | Tuning runs | PM ° | Delay margin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| As loaded: PID | 0.08 | 0.058 | 0.019 | 14 % | 0.69 | 0.09 | 0.62 | 0.012 | 1.8 | 0.63 | 0.018 | 4 | 0 | 32 | 530 ms |
| PID | 0.058 | 0.047 | 0.0095 | 2.8 % | 0.18 | 0.11 | 0.8 | 0.022 | 1.4 | 0.076 | 0.036 | 4 | 110 | 42 | 480 ms |
| PI from the plant | 0.42 | 0.3 | 0.33 | 70 % | 1.5 | 0.47 | 5.7 | 0.87 | 1.1 | 4.2 | 0.59 | 5 | 31 | 85 | 160 ms |
| Gain-scheduled PI | 0.41 | 0.3 | 0.32 | 70 % | 1.5 | 0.47 | 5.7 | 0.86 | 1.1 | 4.2 | 0.34 | 9 | 89 | 85 | 160 ms |
| PID + feedforward from the plant | 0.32 | 0.29 | 0.32 | 9.9 % | 1.5 | 0.11 | 0.87 | 0.03 | 1.4 | 1.2 | 0.037 | 10 | 31 | 42 | 480 ms |
| Relay (on/off) | 0.48 | 0.39 | 0.44 | 110 % | 1.5 | 0.5 | 6.8 | 1 | no linear model | 4.3 | 0.68 | 2 | 1 | — | — |
| Sliding mode (ideal) ⚙ rate observer | 0.12 | 0.11 | 0.047 | 5.8 % | 1.5 | 0.47 | 16 | 0.9 | no linear model | 0.3 | 0.64 | 9 | 13 | — | — |
| Sliding mode (boundary layer) ⚙ rate observer | 0.089 | 0.065 | 0.0031 | 9.5 % | 1.5 | 0.17 | 2.4 | 0.068 | 1.1 | 0.16 | 0.023 | 10 | 80 | 98 | 850 ms |

The feedforward's share of the effort (Σ|ff| / (Σ|ff| + Σ|u − ff|)):

- PID + feedforward from the plant (Kff 2, Kv 21.3, Ka 0.0785, prefilter Tr 1.02 s): 52 % on the system's steps, 52 % on the smooth move; following IAE 0.32 (steps), 0.29 (move), against the datum's 0.058 and 0.047.

Pugh matrix: datum **PID**; five-point marks (++ +2, + +1, S 0, − −1, −− −2, ? not judged); weights 1.5, 1.5, 3, 2, 1, 1, 2, 1, 2, 3, 2, 1, 1.

| Criterion (weight) | Loaded: PID | PID | PI from the plant | Gain-scheduled PI | PID + feedforward from the plant | Relay (on/off) | Sliding mode (ideal) ⚙ rate observer | Sliding mode (boundary layer) ⚙ rate observer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Following steps (IAE) (1.5) | − | D | −− | −− | −− | −− | − | − |
| Following a smooth move (IAE) (1.5) | − | D | −− | −− | −− | −− | −− | − |
| Rejecting d (IAE) (3) | − | D | −− | −− | −− | −− | −− | ++ |
| Overshoot (2) | −− | D | −− | −− | −− | −− | − | −− |
| Settling (2 %, s) (1) | −− | D | −− | −− | −− | −− | −− | −− |
| Effort (u swing) (1) | + | D | −− | −− | S | −− | −− | − |
| Wear (u travel/s) (2) | + | D | −− | −− | S | −− | −− | −− |
| Time at a limit (1) | + | D | −− | −− | S | −− | −− | −− |
| Robustness Ms (2) | − | D | + | + | S | ? | ? | + |
| Plant ±15 % (worst J) (3) | −− | D | −− | −− | −− | −− | −− | −− |
| Noise → u (2) | + | D | −− | −− | S | −− | −− | + |
| Complexity (1) | + | D | − | −− | −− | + | −− | −− |
| Tuning runs (1) | ++ | D | ++ | S | ++ | ++ | ++ | S |
| **Weighted** | -11 | 0 | -33 | -36 | -24 | -33 | -32.5 | -14 |
| **Fits** | yes | yes | no | no | no | no | no | yes |

Ranking (fitting only): 1. PID (+0); 2. As loaded: PID (-11); 3. Sliding mode (boundary layer) ⚙ rate observer (-14).

Not ranked: PI from the plant: fails the main job: Following steps (IAE) ×7.07 of the datum's (at most ×2); fails the main job: Following a smooth move (IAE) ×6.24 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×31.3 of the datum's (at most ×2); Gain-scheduled PI: fails the main job: Following steps (IAE) ×6.89 of the datum's (at most ×2); fails the main job: Following a smooth move (IAE) ×6.25 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×30.7 of the datum's (at most ×2); PID + feedforward from the plant: fails the main job: Following steps (IAE) ×5.38 of the datum's (at most ×2); fails the main job: Following a smooth move (IAE) ×6.12 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×30.6 of the datum's (at most ×2); Relay (on/off): fails the main job: Following steps (IAE) ×8.16 of the datum's (at most ×2); fails the main job: Following a smooth move (IAE) ×8.24 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×41.6 of the datum's (at most ×2); Sliding mode (ideal) ⚙ rate observer: fails the main job: Following a smooth move (IAE) ×2.29 of the datum's (at most ×2); fails the main job: Rejecting d (IAE) ×4.6 of the datum's (at most ×2).

Suggestion: **PID** (+0), added as a variant, not switched on.

Weight sensitivity (winner PID; reasonable: each weight within ±1 of its default): **robust**. It wins 100 % of 4000 weight draws within one step.
- As loaded: PID (-11, wins 0 % of draws): ties if Tuning runs goes 1 → 6.5 (not reasonable); all weights together: 33 % of the weights' size, the largest single change 0.88.

