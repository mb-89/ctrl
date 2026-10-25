# Research: sliding mode control

Reader: whoever implements sliding mode control in Loop Tuner: the two controller types, the example system with its motor built from diagram blocks, and the scope's Measure readout. The person's words are in [input 10](../input/2026-10-24-10-sliding-mode-and-triple-swingup.md): the sliding-mode request, and "no black-box models", added the same day. This synthesis was made on 2026-10-24 from four research sweeps: the classic theory, gentler variants, industrial use, and how sliding modes are drawn. The same day two skeptical reviews checked it: one of the mathematics, with an independent simulator that solves the linear motor exactly between controller samples, and one of the fit with Loop Tuner's code. Their corrections are listed first; the rest of the document already includes them. A third check, of the built branch against an exact solver and in the browser, added corrections 29–35.

Marks used below: **(inference)** is reasoning, not a source. **(simulation)** is a run of the repository's `simulateSystem`. **(exact)** is the reviewers' matrix-exponential solution of the motor, which uses no repository code. Scripts are listed under Sources.

## Reviewer's corrections

What changed from the first synthesis, and why.

**Numbers and explanations (mathematics check)**

1. **Copper loss and current RMS from 1 ms samples were biased high.** The relay switches on sample instants, so the current's corners sit on samples. At 4 samples per period the sampled mean square of the ripple is about A²/2 instead of A²/3 (inference). Armature τ 1 ms: 52 W became 34.6 W (exact 34.57 W on a 1 µs grid; the mean of 0.1 ms samples reads 34.75 W, the 0.25 ms record 35.70 W, +3.3 %, and a 1 ms record 50.83 W). Nominal, while holding: 7.9 W became 7.6 W and 2.80 A became 2.76 A. Whole-run mean: 10.3 W became 10.1 W. Changed: the example records at 0.25 ms (Recommendation 6), the Measure readout flags a waveform with fewer than 10 samples per period (Recommendation 5), and the fast-armature test bound is 30–40 W on a fine record (Recommendation 8).
2. **The Ts = 5 ms row was wrong** (it said 34 Hz, 28 W, 26 mrad). Correct: 33.3 Hz (6 samples), 23.2 W while holding, load error 42.2 mrad mean over 3.4–3.69 s (41.6 over 3.6–3.69 s; 49.9 mrad at 3.69 s, 53.4 mrad peak; exact). The 26 mrad came from a run integrated at a 5 ms step, half the armature's τ. That step is stable and its one-step error is tiny (3.4 mA), yet the relay locked into a different limit cycle (23.8 mrad). Steps of 2.5, 1 and 0.5 ms give 43.4, 42.7 and 42.4 mrad. A relay loop's result can change 2× with the integration step, and the page gives no warning (Pitfalls).
3. **The relay's load offset comes from sampling, not from the armature.** It scales with Ts: 5.1 mrad at Ts = 1 ms with the armature and 7.2 without it; 1.5 and 1.2 mrad at Ts = 0.2 ms. On average a sampled relay acts as a layer β·K·Ts = 0.3 rad/s wide, which leaves φ·(d·R/Kt)/(K·λ) = 5 mrad (the φ = 0.3 layer gives 5.1–5.3). It is not a fixed offset: its 0.1 s means fall from 7.5 to 4.4 mrad over 3.3–3.69 s, inside a ±1.7 mrad ripple. The old "5.5 mrad at 3.69 s" was one sample.
4. **Super-twisting at J×3: the explanation was wrong.** The doc said the k2 condition was at its limit. Raising k2 makes the slope worse (k1 = 4: k2 66 → 18.7, 80 → 21.5, 120 → 29.1 with 3.3 % overshoot); raising k1 fixes it (k2 = 44: k1 6 → 11.7, 8 → 10.5). The cause: v integrates through the longer reaching phase (95 ms at full voltage), s then overshoots the line to −1.7 rad/s at 0.40 s with e ≈ 0.35 rad, and those points dominate the least-squares fit. How fast the proportional term undoes that is set by k1 against √(k2 + L). Stopping v while the output is clamped helps little (13.8). From about 0.55 s it slides at λ (9.91 over 0.55–1.4 s; 10.03 over 0.6–1.4 s). The rate bound was also misjudged: along the actual J×3 trajectory |ẇ| ≤ 362 rad/s³ (225 after reaching; the top speed is 6.7 rad/s, not 8.8), so β·k2 = 367 does exceed L there; at the nominal J, |ẇ| reaches 1651 rad/s³ while reaching and 876 just after, so L = 645 understated it. Changed: the notes and tests say super-twisting first overshoots the line at J×3, then slides (Recommendation 4).
5. **The Seeber–Andritsch conditions were applied to the wrong law.** Their eq. 15 (k2 > L, k1 > √(k2 + L)) and the accuracy |x| ≤ L·T² are proven (Theorem 6) for their implicit law, eq. 13 (defined by eq. 12), under a zero-order hold, not for the explicit Euler law built here. The continuous-time conditions (Moreno & Osorio 2008; Seeber & Horn 2017) are the guide; the gains are hand gains checked by simulation.
6. **The implicit law needs a plant value.** In volts, eq. 13 is V = −u_s/β with K1 = β·k1, K2 = β·k2, a linear region |s| ≤ K2·Ts² and Λ = K2 − K1²/4, so it needs β = Kt/(R·J), which is computable. Under Rule 1 of [designs-in-the-page.md](../output/designs-in-the-page.md) it can only be a designed twin (Recommendation 9), not "one branch and a square root". Confirmed: with the armature the two forms behave alike (explicit 0.64 V at 36 Hz and 130 V/s; implicit 0.59 V at 33 Hz and 116 V/s). Without the armature they differ (0.108 V at 500 Hz against 0.001 V).
7. **The textbook super-twisting gains at J×3** (k1 1.9, k2 44): the 17.8 % overshoot holds; "a 6 Hz oscillation" did not. The swing decays while its frequency rises: −178 mrad at 0.588 s, +50 mrad at 0.767 s (about 2.8 Hz), then a ±2 mrad limit cycle near 10 Hz (0.87 V at 9.8 Hz while holding).
8. **A faster armature does change super-twisting.** At τ = 1 ms its ripple goes from 0.64 V at 36 Hz to 0.18 V at 167 Hz, its TV from 130 to 149 V/s and its holding loss from 0.068 to 0.014 W. Only the boundary layer is unchanged.
9. **Slotine's rules were mixed.** λ ≤ 1/(3·T_A) bounds λ (10 ≤ 33 here), not φ. Slotine sets the layer by the balance condition (layer bandwidth = λ), which for this law (k = β·K = 300 rad/s²) gives φ = 30 rad/s: Kp 4, Kd 0.4, and 0.5 rad of error under the load. φ = 2 rad/s is this document's own choice (Recommendation 2).
10. **The φ floor.** In the reduced model s_{k+1} = (1 − β·K·Ts/φ)·s_k. φ = β·K·Ts = 0.3 rad/s is deadbeat; between β·K·Ts/2 and β·K·Ts the layer rings but decays; sampling alone makes it chatter only below β·K·Ts/2 = 0.15 rad/s.
11. **Ringing after reaching:** φ = 1 rings at −9.1/+7.6 V (not ±8 V); φ = 2 swings −3.6/+3.7 V and settles in about 60 ms (not 30 ms); φ = 0.3 gives 22.8 reversals/s (not 27), 941 V per run and a ±12 V ring of 0.17 s.
12. **Harmonic balance** gives 68.7 Hz only with an assumed delay of Ts/2 (the hold's average delay); a full Ts gives 48 Hz. The sampled relay locks to 16 samples, 62.5 Hz.
13. **Smaller numbers.** The relay turns 96.4 % of its input energy into heat (50.54 of 52.41 J), not 97 %. Its TV is 2786 V/s (2796 at a 1 ms record). Super-twisting is still converging at 3.69 s: 0.34 mrad mean over 3.6–3.69 s and falling (0.15 mrad was one sample).
14. **Controller sampling today.** At the default 2.5 ms record a 1 ms Controller is called at 0, 1.667, 2.5, 3.333, 4.167, 5.0, 6.667 ms…: one 1.667 ms interval, then four of 0.833 ms, per 5 ms (not "alternating"). It moves the relay from 63.5 to 51 Hz, from 7.25 to 10.4 W and from 5.1 to 6.6 mrad mean load error.
15. **The model-based law's gain condition** (Recommendation 9). With an uncertain input gain the model term is scaled by b/b̂, so the condition is K ≥ (sup|w − (b/b̂)·ŵ| + η)/b_min, as Slotine & Li eq. 7.20: k ≥ β(F + η) + (β − 1)|û|.
16. **XY σ is a vertical residual**, the RMS of y − (a·x + b), not a perpendicular distance. With a ≈ λ and b ≈ 0 it equals RMS(s), so reading it as the band in rad/s is right.
17. **Tan et al. 2005's** f_S = Vo(1 − Vo/Vi)/(2κL) could not be checked (the PDF's equations do not extract). It is marked unverified and used for no number.

**Fit with Loop Tuner (code check)**

18. **The PD variant measured gain, not method.** Inside the layer, the boundary layer is a PD with Kp 60 V/rad and Kd 6 V·s/rad; the library PD (Kp 20, Kd 1.5) is three to four times softer. A PD with the layer's own gains errs 33.2 mrad under the load (the same as the layer), reads a slope of 10.43 at J×3 (layer 10.90) and uses 51 V/s. So "the PD errs 99 mrad" and "the PD's line tilts to 18" showed a gain difference. Changed: the PD variant is dropped and three variants remain (Recommendation 4). The notes say instead that a PID's integral would also remove a constant-load offset; what super-twisting adds is finite-time convergence with a continuous voltage.
19. **The readout claims named no window, and the example opens on the whole run.** Loading a system runs Auto Scale (`src/ui/app.js`), which shows 0–5 s; there every variant reads a ≈ 6.5–7.0, and about 5.0 at J×3. Because the screen is the record, a window that ends earlier also ends the run, and the load at 3.2 s drops out. The entry's channel scales are overwritten by Auto Scale on load. Changed: every a ≈ λ claim names its window (100 ms/div at position 0.4 s) and the channel scales the person sets after loading; the entry sets no scales; the notes say the run is then shorter.
20. **The entry's `sim` was dropped twice.** `fromPlant` (`src/core/systems.js`) does not copy it, and `applySystem` sets `p.sim = {}` on a whole load. Changed (Recommendation 6).
21. **`scope.channels[i].measure` would be dropped** by `normalizeScope` (`src/core/project.js`), which rebuilds each channel field by field. Changed (Recommendation 5).
22. **Differencing r broke the Analysis tab's linear step.** ṙf = (rf − rf_prev)/Ts gives a feedthrough from r of K(λ + 1/Ts)/φ = 6060 V/rad, so the linear step would start at 6 kV. Changed: ṙf = (r − rf)/Tr from the prefilter state, and 0 when Tr = 0 (derivative on the measurement, as `pidCore`). `linear()` then has no state: D = [[K·λ/φ, −K·λ/φ, −K/φ]]. No simulated number changes: the old one-sample spike at a step was saturated anyway (exact: every value in Recommendation 4 reproduces with the new surface).
23. **Renaming the motor's blocks would not open the black box.** Its firstOrder blocks store K = 1/R, τ = L/R, K = 1/b and τ = J/b, values computed from the physics, although the old table said nothing computed is stored; and "J×3" had to be done as "rotor τ 0.2 → 0.6". Changed: Motor uses the existing Transfer function block, `num [1]`, `den [L, R] = [0.01, 1]` and `den [J, b] = [0.02, 0.1]`. Results are identical (holding current ripple 2.805 A, load error at 3.69 s 5.47 mrad, slopes 9.888 and 10.017 at a 1 ms record, step 1 ms), the block keeps its transfer-function step bound, and J×3 is `den [0.06, 0.1]` (Recommendation 1).
24. **Gain/Sum/Integrator rebuilds are more dangerous than said.** With L/R = 0.3 ms built that way, a 1 ms record diverges with a warning, and the page's default 2.5 ms record (step 0.833 ms, at RK4's stability limit) silently returns wrong numbers: holding current ripple 0.097 A against 11.6 A exact, e(3.4 s) 9.5 against 5.7 mrad. For this example's own values the integrator form would be accurate today (2.805 A; L = 1 mH: 7.04 against 7.13 A), but the person can edit L down. Changed: the Transfer function form now; the Jacobian step bound is a prerequisite for the integrator form, computed in `compileDiagram`, not in a design layer that does not exist yet (Recommendation 9).
25. **Auto-tune refuses the new types** (`tuningSpace` throws), while [controller-proposal.md](../output/controller-proposal.md) promises it searches every variant. Changed: two branches (Recommendation 7).
26. **Guard test 12** of [designs-in-the-page.md](../output/designs-in-the-page.md) allows only designed types, `pid` and `off` in the library. Changed: `slidingMode` and `superTwisting` are allowed explicitly (Recommendation 7).
27. **Smaller fit problems, each fixed in place:** the bias uses `num('u0', 'Bias u0', 0, { unit: 'u' })` as `relay` does, not `START` ("the integral part at t = 0"); `LAW_PARAMS` in `test/live.test.mjs` gets both types; `TONE['Sliding mode'] = 'red'` explicitly, because controller tags already use seven of the eight tones; the library motor's controller runs at Ts = 10 ms, so the example sets 1 ms itself; a missing view signal shows "—", not NaN, and Sink `i` goes into the shared `motorDiagram`, so no `current` flag is needed; the two-input fallback (differencing y inside the law) was a hidden differentiator and is removed; a caption never binds `{e}`, which a view formula reads as Euler's number (`src/core/expr.js`).
28. **k2 = 44 equals 1.1·L/β** for a guessed L = 1000 rad/s³ at the nominal β, so its provenance must be stated. Changed: k1 and k2 are hand gains, picked from the rule of thumb and then by simulation; nothing computes them in the page (Rule 1 allows hand gains a person chose).

**Third check (the built branch, against an exact solver and in the browser)**

29. **Auto-tune cheated on the relay.** With K in the tuning space, Iterate cut K from 12 to 11.11 V: the time-at-a-limit penalty fell from 0.19 to 0, most of the gain (J 0.302 → 0.071), while the relay still slammed ±11.1 V and the heat while holding rose from 7.6 to 13.4 W (K = 11.99 alone removes the penalty). Changed: `slidingMode` tunes λ, and φ when above 0; K stays. The relay then gives λ 40.9 with K 12 (J 0.302 → 0.260), the layer λ 37.1, φ 5.0. The cost has no chattering term; the old claim that it judged chattering was wrong (Recommendation 7). Super-twisting tuned on the nominal motor (λ 21, k1 2.48, k2 82.9) loses the load at J×3 (368 mrad peak, 28 W while holding): the cost sees only the plant as it is.
30. **Exact sampling made some sample times slow.** A common grid for T = 2.5 ms and Ts = 1.1, 1.2, 1.3 or 2.1 ms took 25 steps per record (before: 2–3), and 125 for 1.02 ms; one triple-pendulum run went from 0.04–0.25 s to 0.45–2.2 s. Changed: the cheaper of the grid and cutting the bound's steps at each sample instant (Recommendation 6).
31. **A Source edge at a sample instant could reach the controller one sample late.** The step's end t[k] + s·h + h can round just below k·Ts, so the edge was read on its old side (a 1 ms controller at a 1.5 or 4 ms record and r at 1.5 s; at the 0.25 ms record d at 3.2 s, also before this branch). The ramp test could not see it. Changed: the end of each step is read on the nanosecond grid; a recorded Source at its edge instant now shows its new value. The example's numbers are unchanged.
32. **Numbers.** Armature 1 ms: the true copper loss while holding is 34.57 W (correction 1). Ts = 5 ms: 42.2 mrad mean over 3.4–3.69 s, not 43 (correction 2). Reaching: 42.9, 43.3 and 48.2 ms (exact; Recommendation 4). The relay's 62.5 Hz (16 samples) holds by edge timing and by a fine spectrum; a coarse spectrum of the 0.49 s holding window reads the nearest 2.04 Hz bin, 61.2 Hz.
33. **The notes promised what the page did not show.** The line in the λ window rises one division per division across; it is not at 45° (a division is about 98 × 41 px at 1400 × 900). Measure counts both turns of V: 126 reversals/s in that window for a 62.5 Hz relay, not "63 times a second". In that window i reads 2.70 A rms (7.3 W) and 11.2 A p-p; 7.6 W and 10.3 A are the holding window's. "The Analysis tab shows it" waits for the design layer. The notes were 2483 characters, more than twice the next longest; they now give the window's numbers and are shorter.
34. **Smaller fit problems, fixed:** the top-level wire from r to the error's Sum ran under the controller and Motor (the Sum now sits below the controller); the parameter heading set the formula in capitals (Λ and Φ are other letters); adding a sliding-mode variant to a 2-input block gave a path-prefixed toast that did not say to set Inputs to 3; the Measure warning colour is the stylesheet's `--lit-amber`.
35. **Merge with main:** both types have a structure diagram in the Controller tab (`src/core/structure.js`); the relay's "sign" note sits at y 6, clear of the relay box.

Confirmed by both checks and kept: the reduced model (a = 17.5 1/s, β = 25 rad/s² per V, V_eq = 3e + 2d, no-load speed 17.1 rad/s, stall torque 6 N·m); the sliding limits (|e| ≤ 2.4 rad at J×3 with λ = 10; 0.35 rad with λ = 20, where the relay's slope goes to 32.4 and super-twisting overshoots 20.9 %); the boundary-layer derivations (Kp 60, Kd 6; ζ 0.41/0.29/0.16; 33.3 mrad by formula, 33.2 simulated); the reaching times (42.9–48.2 ms; 90.5–94.7 ms at J×3, exact); the double-integrator test (154 ms against 153.1 predicted; band 0.030 ≤ 0.04; negative cases grow to 4.88 and 0.69); Δi_pp ≈ U/(2Lf) = 9.6 A; the Gao band εT/(2 − qT), which matches the chapter's δ = β/(1 + α) with α = 1 − qT; the MathWorks and Utkin & Lee quotations.

## Summary

**What sliding mode control is.** Choose a sliding variable s = λe + ė, with e = r − y, λ in 1/s and s in y's unit per second. Drive s to zero with a switching law u = K·sgn(s). Once s = 0, the error obeys ė = −λe and decays as e^(−λt). This holds whatever the plant's parameters and whatever disturbances enter through the input channel, as long as the switching gain dominates them. That robustness is the point of the method (Utkin 1977, 1993; Slotine & Li ch. 7; matching condition: Draženović 1969).

**Why it is hard on actuators.** The person's suspicion is right. An ideal sliding mode switches infinitely fast. A real one switches as fast as the sampling and the actuator's own fast dynamics allow. That chattering causes "low control accuracy, high wear of moving mechanical parts, and high heat losses in power circuits" (Utkin & Lee 2006).

On the library DC motor at Ts = 1 ms, the textbook relay V = 12·sgn(s) holds the shaft almost perfectly. To do so it slams ±12 V at 62.5 Hz. That drives 10.3 A peak to peak of current ripple, which is 5 N·m of torque ripple on a motor whose stall torque is 6 N·m, and 7.6 W of heat into a shaft standing still. Over the 5 s run, 96 % of the electrical energy becomes copper heat (exact).

**How it is used in practice.** Industry uses sliding modes in three ways.
1. Where the actuator already is a switch, the sliding law is the switching rule and a hysteresis band bounds its frequency. Examples are hysteretic DC–DC regulators, hysteresis current control, ABB's Direct Torque Control (two-level hysteresis every 25 µs), and NASA's phase-plane thruster control with deadband and a Schmitt trigger.
2. As sliding-mode observers, where the switching happens only in software. Examples are sensorless PMSM drives: Microchip AN1078, TI's eSMO, and the MathWorks SMO block. Their speed and current loops stay PI.
3. On continuous actuators, smoothed: a boundary layer sat(s/φ), which is a saturated high-gain PD near the surface (MathWorks' reaching-law block; Slotine & Li §7.2).

Higher-order laws such as super-twisting give a continuous u. They keep finite-time convergence and reject slowly varying loads exactly (Levant 1993, 2003). But they still oscillate when the actuator has dynamics (Boiko & Fridman 2005). I found them validated on lab benches, not in shipped products. Tan, Lai and Tse (2008) explain why switching SMC stays rare even in converters: variable switching frequency, EMI, filter design, no ICs, no design procedure.

**What to build.**
- One example, *DC motor, sliding mode*, on the library motor. Its Motor subsystem is rebuilt so every physics value shows once: R and L in the armature `1/(L·s + R)`, J and b in the rotor `1/(J·s + b)`, Kt and Ke as gains. The 10 ms armature is the physical "unmodelled fast dynamics" that makes chattering real, and it can be opened and changed.
- Two controller types: `slidingMode` (the relay, or a boundary layer with φ > 0) and `superTwisting`.
- Three variants: relay (theory) · boundary layer (practice) · super-twisting (the continuous improvement).
- The existing XY mode **without Δ**, with e across and the speed up, is the phase portrait. The sliding line is speed = λ·e, the readout's slope a is λ once the window starts after reaching, and its σ is the chattering band. No new display mode is needed.
- One scope addition: a **Measure** readout per channel (mean, RMS, AC RMS, p-p, TV/s, reversals/s). It makes "hard on the actuator" a number.
- Simulation and loading fixes: controllers sample exactly on their own clock; a library entry carries its record step; this system records at 0.25 ms.
- No new diagram primitive is needed for this example.

## Recommendations

### 1. The example: "DC motor, sliding mode", on the library motor with its physics visible

**What.** A new motor system, opening on its own view of the motor, in XY mode. It shows two things:
1. What sliding is: a reaching arc, then a straight line whose slope is λ, set by the controller rather than the plant.
2. What the textbook law costs the actuator, and what the practical laws give up instead.

**How.**

*Plant.* `motorDiagram` in `src/core/plants.js`, rebuilt from blocks whose parameters are the physics. This applies to every system that uses `motorDiagram` (*DC motor position*, *Following a sine (XY)* and this one): the physics is unchanged, so their runs are identical.

| Physics | Value | Block in Motor |
|---|---|---|
| Armature resistance R and inductance L | 1 Ω, 10 mH | Transfer function `armature 1/(L·s + R)`: num [1], den [L, R] = [0.01, 1]; output i in A |
| Torque constant Kt | 0.5 N·m/A | Gain `Kt (= Ke)` |
| Back-EMF constant Ke | 0.5 V·s/rad | Gain `Ke (= Kt)` (feedback to the armature Sum) |
| Rotor inertia J and viscous friction b | 0.02 kg·m², 0.1 N·m·s/rad | Transfer function `rotor 1/(J·s + b)`: num [1], den [J, b] = [0.02, 0.1]; output speed in rad/s. It replaces the block named `load`, which sat beside the `load torque` port |
| Angle | | Integrator `angle`, outside Motor (as today) |
| Voltage limit | ±12 V | Controller umin, umax |
| Controller sample time Ts | 1 ms here (the library motor's controller uses 10 ms) | Controller Ts |

Every value in the table is a physics parameter or a design input, and each appears once.

Changes for this system:
- `motorDiagram(variants, { inputs: 3, Ts: 0.001 })`; the defaults (2 inputs, 10 ms) keep the other motor systems as they are.
- Controller Inputs = 3: r, angle, speed. Wire the Motor output (speed) to `ctrl:2`.
- A top-level Sum (+−) of r and angle feeding a Sink **e** (rad).
- Inside Motor, a Sink **i** (A) on the armature output, in the shared `motorDiagram`. Any Sink at any depth is a scope source.
- The Transfer function block's dead-time parameter is labelled L today. In every block that has a dead time, label it "Dead time T_d" and write the formulas with e^(−T_d·s); the key `delay` stays, so files are unaffected. L then means only inductance in the motor.

*Reduced model, for reasoning only.* With L → 0 (computed here, never stored; inference):
- θ̈ = −a·θ̇ + β·V − d/J, with a = (b + Kt·Ke/R)/J = 17.5 1/s and β = Kt/(R·J) = 25 rad/s² per V.
- A load d is worth d·R/Kt = 2 V per N·m. No-load speed is β·12/a = 17.1 rad/s; stall torque 6 N·m; stall current 12 A.
- While r is held, ė = −ω, s = λe − ω, and ṡ = (a − λ)·ω − β·V + d/J.
- On s = 0 the equivalent control is V_eq = 3 V/rad·e + 2 V/(N·m)·d. Sliding exists while |V_eq| < 12 V (Slotine & Li §7.1.2).

*Input.*
- r: Square, amplitude 1 rad, start 0.25 s, high 1.25 s, period 2.5 s, count 0. Steps occur at 0.25, 1.5, 2.75 and 4.0 s.
- d: Square, amplitude 1 N·m, start 3.2 s, high 0.5 s, count 1. It brakes the shaft while r = 1.
- Run length 5 s.

*Uncertainty it shows robustness to.*
- The load torque d. It is matched in the reduced model: it enters with V.
- The rotor inertia J. Open Motor and set the rotor's den from [0.02, 0.1] to [0.06, 0.1], which is J×3, a heavier load coupled to the shaft. β drops to 8.3 and a to 5.8; with λ = 10 the sliding condition still holds for |e| ≤ 2.4 rad.

*Actuator effects that make chattering real.*
- The armature lag L/R = 10 ms. The sampled relay chatters at 62.5 Hz, 16 samples. Harmonic balance predicts 68.7 Hz with a loop delay of Ts/2 and 48 Hz with Ts (inference: the hold's average delay is Ts/2; Boiko et al.). Hand check: Δi_pp ≈ U/(2·L·f) = 12/(2·0.01·62.5) = 9.6 A, against 10.3 A (exact).
- Sampling at Ts = 1 ms. The switching cannot be faster than 1/(2Ts) (Utkin & Lee 2006). Sampling also sets the relay's residual load error (correction 3).
- Measurement noise is left out of the default, so the example stays at two lessons.
- The ±12 V source stands for a PWM bridge's average voltage (inference). The 62.5 Hz swing is therefore real at the motor terminals.

*Scope* (the `scope` field of the library entry). No channel scales: Auto Scale sets them on load.
- Channel 1: e, on.
- Channel 2: speed, on.
- Channel 3: V, assigned but off, `measure: true`.
- Channel 4: i, assigned but off, `measure: true`.
- `view: { mode: 'xy' }`, with Δ off.
- `sim: { sampleTime: 0.00025 }` (Recommendation 6).
- Opens on the Plant tab with the motor view.
- The view's caption adds `i {i:5.1} A` in the shared `motorViews`. It never binds `{e}`.

*Reading λ.* After loading, the screen shows 0–5 s and the best line also fits the reaching arcs: a ≈ 6.5–7.0 (about 5 at J×3). To read λ, set Horizontal to 100 ms/div at position 0.4 s, channel 1 to 0.1 rad/div and channel 2 to 1 rad/s/div. The screen then holds only the sliding after the first step, and the run ends at 1.4 s, so the load drops out. With scales in the ratio λ, the sliding line rises one division for each division across, through the centre (not 45°: the screen's divisions are not square, about 98 × 41 px at 1400 × 900).

*Notes text* (numbers from Recommendation 4, and the λ window's own Measure readings: 0.4–1.4 s, relay V 126 reversals/s, i 2.70 A rms, 11.2 A p-p; correction 33):

> A sliding-mode controller holds the shaft: it drives s = λ·e + ė to zero (e = r − angle, λ = 10 1/s). On the line s = 0 the error decays as e^(−λt) whatever the load or the inertia, so the slope λ, not the mass, sets how the shaft settles. The scope opens in XY, e across, speed up: after each step the beam runs at full voltage towards the line speed = 10·e, then slides along it into the origin (the whole run's fit, a ≈ 7, includes these arcs). To read λ, set Horizontal to 100 ms/div at 0.4 s, channel 1 to 0.1 rad/div and channel 2 to 1 rad/s/div: only the sliding is left (the run now ends at 1.4 s), the line rises one division per division across, a reads λ, σ how tightly it slides. Relay (theory), V = 12 V·sign(s): press Time, switch on channels 3 and 4. V slams between ±12 V at 62.5 Hz (Measure counts both turns: 126/s), the current ripples 11 A peak to peak, and its rms of 2.7 A is 7.3 W of heat (R·i², R = 1 Ω). Boundary layer (practice): a stiff PD inside |s| < 2 rad/s (Kp 60, Kd 6): no chatter, but over the whole run (Auto Scale) the load at 3.2 s leaves 33 mrad (the relay about 5). Super-twisting: a continuous voltage whose integral part rejects the load; a 36 Hz ripple from the armature remains. A PID's integral would reject the load too; super-twisting adds convergence in finite time. Try: open Motor and triple J (rotor den [0.06, 0.1]): the relay and the layer keep the slope, super-twisting first overshoots the line. Or make the armature ten times faster (den [0.001, 1]): the relay chatters at 250 Hz and makes about five times the heat.

*Tags:* `systemTags` derives Linear, the controller tags, Disturbance and XY. Add `slidingMode` and `superTwisting` to `VARIANT_TAGS` as one tag, "Sliding mode", with `TONE['Sliding mode'] = 'red'`.

**Why.**
- The DC motor position servo is the canonical SMC plant for electric drives (Utkin 1993; Slotine & Li §7.1.4; Utkin, Guldner & Shi).
- Its actuator is a voltage, so chattering is a visible square wave and a measurable current.
- Its reduced model is second order, so the phase plane fits XY.
- It answers "no black boxes" without a new primitive: Motor opens into a Sum, two transfer functions whose coefficients are R, L, J and b, and two gains. The cause of the chattering, the armature lag, can be opened and changed, and the Transfer function block keeps its step bound when L is edited down. The Gain/Integrator form waits for a step bound that sees integrator loops (Recommendation 9).
- Alternatives that were rejected:
  - The cart–pole is underactuated (sliding on it needs a design for unmatched dynamics) and its physics block is not yet rebuilt from primitives.
  - A buck converter switches at tens of kHz, beyond a 5 s screen, and needs a Product primitive and a limited integrator.
  - A thruster (attitude) example is a good later second example (Recommendation 9).

### 2. Controller type `slidingMode`: the relay (φ = 0) and the boundary layer (φ > 0)

**What.** A model-free first-order sliding-mode law for a plant whose output rises with u:
- inputs [r, y, ẏ] (r first, as every law); ẏ on input 3 is required;
- output u, digital at Ts with a zero-order hold.

**How.**
- Parameters:
  - `lambda`, label "Surface slope λ", unit 1/s, default 10, min 0.
  - `K`, label "Switching gain K", unit u, default 1. Help text: negative for a plant whose y falls when u rises, as the relay's d.
  - `phi`, label "Boundary layer φ", in the unit of s, i.e. y's unit per second (rad/s here), default 0, min 0. Help text: 0 is the ideal relay.
  - `PREFILTER` (Tr); `num('u0', 'Bias u0', 0, { unit: 'u' })`, as `relay`; `LIMITS`.
- `check`: a block with fewer than 3 inputs is refused with "sliding mode needs ẏ on input 3; to make it from y, place a Finite difference observer in the diagram". The law never differentiates y itself.
- Law, per sample:
  ```
  rf  = prefilter(r)                       // existing Vorfilter; rf = r when Tr = 0
  ṙf  = Tr > 0 ? (r − rf)/Tr : 0           // the filter's own derivative; 0 = derivative on the measurement
  e   = rf − y;   ė = ṙf − ẏ;   s = λ·e + ė
  sw  = φ > 0 ? clamp(s/φ, −1, 1) : sign(s)   // sign(0) = 0
  u   = clamp(u0 + K·sw, umin, umax)
  ```
  - ṙf = (r − rf)/Tr is exact for the first-order filter (inference). With Tr = 0, a step in r moves s by λ·Δr only.
  - Units: s in y/s (rad/s), K in u (V), φ in y/s.
- `linear(p, Ts, at)` for the Analysis tab:
  - φ = 0: throw "an ideal sliding mode switches: it has no linear model; give it a boundary layer φ > 0".
  - φ > 0, inside the layer and the limits, with the prefilter left out as the convention says (so ṙf = 0): no state. `staticLinear(K·λ/φ, [K·λ/φ, K/φ])`, which is D = [[K·λ/φ, −K·λ/φ, −K/φ]] on [r, y, ẏ].
  - The Analysis tab then shows the boundary layer for what it is: a PD with Kp = K·λ/φ = 60 V/rad and Kd = K/φ = 6 V·s/rad for the example's values.
- The structure diagram of the running variant (task 21) gets one entry: e, ė → λ·e + ė = s → sign / sat(·/φ) → K → u.
- An `ABOUT` sentence, and a row in [controller-proposal.md](../output/controller-proposal.md).

The example's values:
- Relay: λ = 10, K = 12 V, φ = 0, limits ±12 V. K equals the limit, so the law is V = 12·sgn(s).
- Boundary layer: the same, with φ = 2 rad/s.

How φ was chosen (inference, checked in simulation):
- Sampling: in the reduced model s_{k+1} = (1 − β·K·Ts/φ)·s_k. Below β·K·Ts/2 = 0.15 rad/s sampling alone makes the layer chatter; φ = β·K·Ts = 0.3 rad/s is deadbeat (the implicit-discretisation width of Acary and Brogliato); in between it rings but decays.
- The armature asks for much more. The layer's speed loop, β·K/φ, should stay near the armature corner 1/τ_a = 100 1/s. For φ = 2 it is 150 1/s, and the reduced loop τ_a·σ² + σ + β·K/φ has ζ ≈ 0.41. φ = 1 gives ζ ≈ 0.29 and rings at −9.1/+7.6 V after reaching; φ = 0.3 gives ζ ≈ 0.16, a ±12 V ring of 0.17 s and 22.8 reversals/s. φ = 2 swings −3.6/+3.7 V and settles in about 60 ms.
- Slotine's balance condition (layer bandwidth = λ) gives φ = β·K/λ = 30 rad/s: Kp 4, Kd 0.4 and 0.5 rad of error under the load, too thick for an example meant to show what sliding buys.
- Price of φ = 2: a constant load leaves e_ss = φ·(d·R/Kt)/(K·λ) = 2·2/(12·10) = 33.3 mrad at 1 N·m (simulated 33.2).

**Why.**
- Utkin's relay u = U·sgn(s) is the form used for electric drives. It needs only λ, U and the sign of the input gain, so nothing plant-specific is stored.
- sat(s/φ) is the most common smoothing (Slotine & Li §7.2; MathWorks' block offers sign, s/(|s| + φ), tanh(s/φ) and sat(s/φ)). MathWorks: "A larger Phi value results in less chattering but can increase the steady-state error."
- One type with φ = 0 meaning the relay keeps the two variants one parameter apart. Flipping between them shows exactly what the layer changes.

### 3. Controller type `superTwisting`: continuous, with exact rejection of slow loads

**What.** Levant's second-order sliding-mode law on the same s, with the same inputs [r, y, ẏ], the same `check` and the same surface code as `slidingMode`.

**How.**
- Parameters:
  - `lambda` (1/s, default 10);
  - `k1`, label "Gain k1", unit u per √(y/s), V·s^½/rad^½ here, default 1;
  - `k2`, label "Gain k2", unit u/s, default 10;
  - `PREFILTER`, `START` (u0, the starting value of v, which is the integral part), `LIMITS`.
  - Help text on k1 and k2: negative for a plant whose y falls when u rises.
- Law, explicit Euler. The sign is flipped from Levant's form because raising u lowers s here:
  ```
  u = clamp(k1·√|s|·sign(s) + v, umin, umax)
  v = clamp(v + Ts·k2·sign(s), umin, umax)     // v is the integral part; clamping it is the anti-windup
  ```
- `linear()` throws "super-twisting has no linear model: √|s| has infinite slope at s = 0".
- The example's gains: λ = 10, k1 = 4 V·s^½/rad^½, k2 = 44 V/s, limits ±12 V. They are **hand gains**, picked like the swing-up gains: start from Levant's rule of thumb k1 = 1.5√L/β, k2 = 1.1L/β with a guessed L = 1000 rad/s³ and the nominal β (1.9 and 44), then raise k1 in simulation until J×3 no longer overshoots (the textbook 1.9 overshoots 17.8 % there). No formula is stored, and none runs in the page.
  - In s-units, where ṡ = −β·V + w and w = (a − λ)·ω + d/J, the gains are β·k1 = 100 and β·k2 = 1100 rad/s³ at the nominal J, and 33 and 367 at J×3.
  - Guide: for the continuous law the conditions of Moreno & Osorio (2008) and the setting of Seeber & Horn (2017) apply, with L ≥ |ẇ|. They assume a perfect first-order sliding variable without the armature, and the law here is explicit Euler, so they are a guide, not a proof (inference). The gains must hold at the smallest input gain β, i.e. the largest J.
  - What sets the J×3 behaviour is k1 (correction 4): k2 = 44 with k1 = 6 reads 11.7 in the 0.4–1.4 s window, at 214 V/s and a 0.85 V ripple at 47 Hz. k1 = 4 is kept because it is gentler on the actuator, and the overshoot it leaves at J×3 is itself a lesson about the integral part.
- Discretisation:
  - Explicit Euler has |s| = O(Ts²) accuracy without parasitic dynamics, plus small discretisation chattering (Levant 2003).
  - The implicit law of Seeber and Andritsch (2025, eq. 13; conditioned for saturation in eq. 18) is proven for a zero-order hold and reaches |s| ≤ L·Ts². It needs β (correction 6), so it would be a designed twin (Recommendation 9).
  - Here the armature dominates the residual oscillation, and the two forms behave alike with it (0.64 V at 36 Hz against 0.59 V at 33 Hz). Explicit Euler with clamped v is enough.

**Why.** Super-twisting is the literature's answer to the person's question: an SMC that is not hard on the actuator.
- u is continuous.
- v integrates sgn(s), so a constant load is rejected: the error under the load falls to 0.34 mrad (mean over 3.6–3.69 s, still falling), against about 5 mrad for the relay and 33 mrad for the boundary layer.
- It needs no derivative of s.

Its honest limits belong in the notes:
- With actuator dynamics it converges to a small periodic motion, not to rest (Boiko & Fridman 2005). Here that is 0.64 V AC RMS at 36 Hz, 0.26 A of current ripple and 0.07 W while holding.
- Its integral part winds up during a long reaching phase, and s then overshoots the line (J×3).
- Its gains must be sized for the weakest plant.
- No shipped product built on it was found (industry sweep).

### 4. The variants and the numbers each must reach

**What.** Three variants, the first one running:
1. **Sliding mode, relay (theory)**: `slidingMode` λ 10, K 12, φ 0.
2. **Sliding mode, boundary layer (practice)**: `slidingMode` λ 10, K 12, φ 2.
3. **Super-twisting (continuous)**: `superTwisting` λ 10, k1 4, k2 44.

All have limits ±12 V. There is no Off (it would only show the load spinning a free shaft) and no PD (correction 18: a PD as stiff as the layer behaves like it; the Analysis tab shows the layer's PD).

**How.** Expected values with the nominal motor, from the exact solution and from `simulateSystem` at the 0.25 ms record with the Transfer function motor; the two agree within 1 %.
- *Whole run* is the 5 s screen.
- *Hold* is 1.0–1.49 s: r = 1 held, no load.
- *Load* is 3.2–3.69 s.
- *XY* is the readout over the window 0.4–1.4 s (100 ms/div at 0.4 s).
- Copper loss is R·i² with R = 1 Ω, averaged over time.

| | Relay (theory) | Boundary layer φ = 2 | Super-twisting 4 / 44 |
|---|---|---|---|
| V total variation per second, whole run | 2786 V/s | 34 V/s | 130 V/s |
| V reversals per second (hysteresis 0.5 V), whole run | 116 | 3.2 | 63.8 |
| V AC RMS while holding, and its frequency | 12.0 V at 62.5 Hz | 0.00 V | 0.64 V at 36 Hz |
| Current ripple while holding, AC RMS (p-p) | 2.76 A (10.3 A; 5.1 N·m of torque) | 0.00 A | 0.26 A (0.78 A) |
| Copper loss while holding | 7.6 W | 0.00 W | 0.07 W |
| Mean copper loss, whole run | 10.1 W | 3.2 W | 2.8 W |
| Error under 1 N·m: peak / mean over 3.6–3.69 s | 15.4 / 4.4 mrad (±1.7 ripple, falling) | 33.2 / 33.2 mrad | 17.8 / 0.34 mrad (falling) |
| Reaching: \|s\| < 0.5 rad/s after the 0.25 s step | 42.9 ms | 43.3 ms | 48.2 ms |
| Settling (2 %) of the first step | 0.426 s | 0.437 s | 0.417 s |
| XY slope a and spread σ, 0.4–1.4 s | 9.89, 0.177 rad/s | 9.48, 0.001 | 10.06, 0.029 |
| XY slope a with J×3, 0.4–1.4 s | 10.02 | 10.90 | 15.35 (overshoots the line, then slides) |
| XY slope a with J×3, 0.6–1.4 s | 9.84 | 10.87 | 10.03 |
| Reaching with J×3 | 90.5 ms | 91.6 ms | 94.7 ms |
| Energy in / heat, whole run | 52.4 / 50.5 J (96 %) | 17.8 / 16.1 J | 15.9 / 14.1 J |

Other conditions (the "try this" lines; values exact or at a fine record):
- Armature τ 10 → 1 ms (den [0.001, 1]): the relay chatters at 250 Hz (f_s/4) and loses 34.6 W while holding (35.7 W read at the 0.25 ms record; a 1 ms record would show 50.8 W). Super-twisting's ripple goes to 0.18 V at 167 Hz (149 V/s, 0.014 W). The boundary layer is unchanged.
- Controller Ts = 5 ms (with the 0.25 ms record): the relay chatters at 33.3 Hz (6 samples), loses 23.2 W while holding, and its load error is 42 mrad mean over 3.4–3.69 s (53 mrad peak).
- Speed noise σ = 0.2 rad/s on the speed input (a Noise block): the boundary layer's TV rises to about 1300 V/s and super-twisting's to about 1600 V/s (1311–1365 and 1607–1671 over seeds). This is the sliding modes' dependence on a clean ė.

**Why.** Each variant shows one thing:
- The relay: near-perfect tracking that costs 2.8 kV/s of switching and 7.6 W of heat standing still.
- The boundary layer: smoothness bought with invariance ("no free lunch", Slotine & Li §7.2). Inside the layer it is a PD with Kp 60, Kd 6.
- Super-twisting: a continuous voltage with load rejection, an honest residual ripple, and an integral part that can overshoot.

### 5. The scope: XY without Δ is the phase portrait; one addition, a Measure readout

**What.**
- *Phase portrait.* Channel 1 = e (across), channel 2 = speed (up), Δ off. While r is held, ė = −ω, so s = 0 is the line speed = λ·e, a slope of +λ through the origin. Slotine's figure plots ė against e and has slope −λ.
- *Reading the figure.*
  - The beam first runs along a reaching arc at full voltage, then along the line.
  - The existing readout Y ≈ a·X + b gives a ≈ λ in a window that starts after reaching (Recommendation 1, *Reading λ*).
  - Its σ, the RMS vertical residual from the best line, equals RMS(s) when a ≈ λ and b ≈ 0: the quasi-sliding band in rad/s.
- *Why not Δ.* Δ draws channel 1 minus a channel of the same unit, and e (rad) and speed (rad/s) differ. With r and angle on the channels, Δ gives the following error over r, which for square steps degenerates into vertical lines ([analysis.md](analysis.md) Pitfalls).
- *Alternative rejected.* Building s in the diagram (a Gain λ on e and a Sum λe − speed) so that Δ draws s puts λ in the diagram as well as in the controller. It goes stale when either is edited, and Auto-tune cannot reach it.
- *The rest from existing modes:*
  - Time on V and i shows the cost.
  - FFT on V shows the chattering line: 62.5 Hz at 14.6 V, about 4·12/π, with odd harmonics.
  - The Spectrogram shows the line switch on when reaching ends.
  - A 10 Hz low-pass display filter on a second V channel shows the equivalent control (Utkin's filtered-average reading; Levant & Yu 2018).
- *No s(t) trace in v1.* σ measures the band, and the figure's distance from the line shows it. Showing s over time is the general "controller signals join the scope" feature that [instrument.md](../output/instrument.md) already anticipates (Recommendation 9).

**How: the Measure readout.** This is the one addition, and it applies to every mode.
- Format: `scope.channels[i].measure: true`; absent means off. `normalizeScope` keeps it (`if (c.measure === true) ch.measure = true`), and the `channels()` helper in `plants.js` can set it. Document it in [project-format.md](../output/project-format.md) and [instrument.md](../output/instrument.md).
- Toggled under Vertical › Measure for the Vertical channel. A channel that is off shows no Measure line; its flag stays, so the line appears when the channel is switched on.
- Each measured channel gets one line under the screen, in its colour. It covers the samples inside the timebase window, up to the sweep (the same samples XY uses), on the display-filtered signal when a filter is set. The values are:
  - mean = (1/n)·Σx;
  - RMS = √((1/n)·Σx²);
  - AC RMS = √((1/n)·Σ(x − mean)²);
  - p-p = max − min;
  - TV/s = Σ|x_j − x_(j−1)| / (t_last − t_first);
  - reversals/s: the number of times x turns after moving more than h, divided by the window length, with h = 0.1 division (the channel's scale/10), shown in the line. It is an edge count with hysteresis, as bench scopes offer (PicoScope: AC RMS, edge count with hysteresis).
- **Resolution flag.** RMS, AC RMS and p-p of a waveform that is not resolved are wrong: a relay-driven current sampled at 4 points per period reads 1.5× its true mean square (correction 1). When reversals/s × record step > 0.2, i.e. fewer than 10 samples per period, the line ends with "under-resolved: n samples per period" in the warning colour. At the example's 0.25 ms record the 250 Hz try-this has 16 samples per period (+3 %) and is not flagged.
- Example line: `3 V  mean 0.00 V  rms 12.0 V  ac 12.0 V  p-p 24.0 V  TV 2.79 kV/s  rev 116/s (h 0.5 V)`.
- For i, the RMS gives the heat directly, P = R·i_rms², with R read from the armature block by the person.
- Code goes beside `lineFit` (`src/ui/measure.js`); tests in Recommendation 8.

**Why.** "Hard on the actuator" has to be a number the person reads, not an impression of a dense trace. The quantities are the ones the literature scores chattering by: amplitude, frequency and average power (Martínez-Fuentes, Pérez-Ventura & Fridman 2020). TV is the repository's own uTV, per second so that windows compare. The readout is generic, so it serves any system: the oven's heater, a HIL plant.

A dashed XY guide line Y = f(X) is not needed: a and σ already compare the figure with a line, and a guide would repeat λ outside the controller.

### 6. Simulation and loading: controllers sample on their own clock; a library entry carries its record step

**What.** Three changes.
1. A correctness fix for every diagram system: a Controller or Observer at Ts samples exactly at k·Ts.
2. A library entry may carry `sim: { sampleTime }`, and loading keeps it.
3. This example records at 0.25 ms.

**How.**
1. In `simulateSystem`, choose the substep count m so that every sample instant lies on the integration grid.
   - Let g be the gcd of the record step T and every sampled block's Ts, computed on integers of 1 ns.
   - m is the smallest multiple of T/g that is ≥ T/hmax.
   - For T = 2.5 ms and Ts = 1 ms: g = 0.5 ms, m = 5, h = 0.5 ms (today 0.833 ms). Integration cost rises by 1.67×.
   - If that grid costs more steps than cutting the bound's steps at each sample instant inside them (about one extra step per sample), cut instead (correction 30): a Ts that shares only a small divisor with T (1.1 ms: a grid of 25 steps per record; 1.02 ms: 125) must not slow every run.
   - Read the end of each step on the nanosecond grid, so a Source edge at a sample instant reaches the controller at that sample (correction 31).
2. Carry the entry's `sim`:
   - `fromPlant` adds `...(e.sim ? { sim: structuredClone(e.sim) } : {})`;
   - `applySystem` sets `p.sim = entry.sim ? structuredClone(entry.sim) : {}` on a whole load instead of `{}`;
   - [project-format.md](../output/project-format.md) says that for a diagram `sim.sampleTime` is the scope's record step (today it says "the controller's sample time").
   - Keep the global default (duration/2000) for entries without it: the encoder example relies on aliasing at 200 Hz.
3. This system sets `sim: { sampleTime: 0.00025 }`, four records per controller sample.
   - The current is resolved: 64 samples per period at 62.5 Hz, 16 at the 250 Hz try-this (Measure reads 7.64 W against 7.62 W exact, and 35.7 W against 34.6 W).
   - Integration runs at h ≤ 0.25 ms, a fortieth of the armature's τ, so the relay's limit cycle is the physical one (correction 2), also when the person sets Ts = 5 ms.
   - Every V switch lands between two records, so TV and reversals are exact; the FFT reaches 2 kHz.
   - A 5 s screen is 20 000 samples, well inside `MAX_SAMPLES` (200 000); windows up to 50 s fit.

**Why.**
- Without fix 1, the relay's chattering frequency, heat and residual error depend on the screen's record step, not on the controller (correction 14).
- Without fix 2, the example would load at the default 2.5 ms record: the jitter above, TV and reversals that miss switches, and the 250 Hz try-this aliased at the 200 Hz Nyquist frequency.
- Without fix 3, a 1 ms record overstates the fast-armature heat by half and lets the integration step reach half the armature's τ.

### 7. Integration with Loop Tuner

- **Auto-tune.** `tuningSpace` (`src/core/autotune.js`) gets two branches, as log factors on the variant's own values:
  - `slidingMode`: λ, and φ when φ > 0 (a relay stays a relay); not K (correction 29);
  - `superTwisting`: λ, k1 and k2.
  - `tunedValues` returns the same names. The cost's saturation term counts the time u sits at a limit, so the relay (K = the limit) counts fully. The cost has no chattering term (no V/s), so it does not judge chattering; adding one is a separate change.
- **Guard.** Test 12 of [designs-in-the-page.md](../output/designs-in-the-page.md) §11 allows `slidingMode` and `superTwisting` explicitly: their parameters are design inputs (λ, φ, limits) and hand gains (K, k1, k2). Add a [decisions.md](../output/decisions.md) entry.
- **Tags.** `VARIANT_TAGS.slidingMode = VARIANT_TAGS.superTwisting = 'Sliding mode'`; `TONE['Sliding mode'] = 'red'`.
- **Tests file.** `LAW_PARAMS` in `test/live.test.mjs` gets both types (λ 10, K 12, φ 2; λ 10, k1 4, k2 44; limits ±12).
- **Documents.** A row per type in [controller-proposal.md](../output/controller-proposal.md); the entry in [system-library.md](../output/system-library.md); Measure in [instrument.md](../output/instrument.md); `measure` and `sim.sampleTime` in [project-format.md](../output/project-format.md); decisions.md entries for: the motor built from Transfer function blocks, three variants without a PD, the "Dead time T_d" label, the Measure readout and its resolution flag, a library entry's record step.

### 8. Tests that prove it works

**What.** These go in `test/core.test.mjs`, or in a new `test/smc.test.mjs` for the system. Values in parentheses are measured (scripts under Sources).

**How.**
- *Laws.*
  - `slidingMode` with φ = 0 returns u0 ± K by the sign of s, and u0 at s = 0. It is clamped, and a negative K reverses it.
  - With φ > 0 it returns u0 + K·s/φ inside the layer and u0 ± K outside.
  - ṙf is 0 with Tr = 0 and (r − rf)/Tr with Tr > 0.
  - `linear()` agrees with `step()` within 1e-12 for small random inputs inside the layer with Tr = 0, like the existing check of every linear law against its step. For φ = 0 it throws.
  - `check` refuses a block with 2 inputs, for both types.
  - `superTwisting`: with v fixed, |u(s = +1e-10) − u(s = −1e-10)| < 1e-4·k1, i.e. continuous. v moves by exactly Ts·k2 per sample and stays within the limits. `linear()` throws.
- *Finite-time reaching, textbook plant.* A double integrator ÿ = b·u from two Integrators, an ideal actuator, a relay `slidingMode`, a unit step at t = 0.
  - The first switch must fall within 2·Ts of t_r = (−1 + √(1 + 2λ·s0/(b·K)))/λ, with s0 = λ. For b = 1, K = 20, λ = 4: 153.1 ms (154 ms).
  - After reaching, |s| ≤ 2·b·K·Ts (0.030 against 0.04). This is the O(Ts) quasi-sliding band (Levant 1993; Utkin & Lee 2006).
  - Sliding needs |u_eq| = λ·|ẏ|/b < K. The cases K = 5, λ = 10 and K = 3, λ = 5 (b = 2) violate it and cross the line instead: after the first switch |s| grows far beyond 2·b·K·Ts (to 4.88 and 0.69). A useful negative test.
- *The motor, at the 0.25 ms record.*
  - Plant: the existing motor systems give the same runs with the Transfer function Motor as with the firstOrder one (within 1e-9).
  - Reaching: after the 0.25 s step, |s| < 0.5 rad/s within 60 ms for every variant (42.9–48.2 ms). The reduced-model bound is t ≤ |s(0)|/η with η = β·K − |a − λ|·ω_max = 300 − 7.5·8.6 ≈ 235 rad/s², so 10/235 = 43 ms; the armature adds a few ms. With J×3: within 160 ms (90.5–94.7 ms).
  - Load, 1 N·m: relay peak |e| < 25 mrad (15.4) and mean |e| over 3.4–3.69 s < 10 mrad (5.4); super-twisting mean |e| over 3.6–3.69 s < 1 mrad (0.34); boundary layer e(3.69 s) within 10 % of φ·d·R/(Kt·K·λ) = 33.3 mrad (33.2).
  - XY over 0.4–1.4 s: relay within 3 % of λ at nominal and J×3 (9.89, 10.02); super-twisting within 3 % at nominal (10.06); boundary layer within 10 % at both (9.48, 10.90). Super-twisting at J×3: above 12 over 0.4–1.4 s (15.35) and within 3 % of λ over 0.6–1.4 s (10.03).
- *Chattering, while holding.*
  - Relay: V at ±12 V in ≥ 99 % of samples (100 %); fundamental of V between 55 and 75 Hz (62.5); i AC RMS 2.4–3.2 A (2.76); mean R·i² 6.5–8.5 W (7.64).
  - Boundary layer: V AC RMS < 0.05 V (0.00).
  - Super-twisting: 0.2 V < V AC RMS < 1.5 V (0.64). The lower bound is the honest residual and guards against a later change hiding the armature. Its TV/s is below the relay's / 10 (130 against 2786).
  - No chattering frequency exceeds 1/(2Ts).
- *Physics.*
  - Energy balance for each variant, recorded at 0.1 ms, with V held over each step in the quadrature: ∫V·i dt = ∫R·i² dt + ∫b·ω² dt + ∫d·ω dt + ½L·i² + ½J·ω² within 0.5 %. Measured 0.030 % for the relay, which converts 50.5 J of its 52.4 J into heat; 0.001 % for the others.
  - Armature den [0.001, 1] (τ 1 ms): the relay's chattering rises to ≥ 200 Hz (250) and its mean R·i² while holding, on the 0.25 ms record, lies between 30 and 40 W (35.7; exact 34.6). This shows the chattering is set by the plant's own fast dynamics.
- *Simulation and loading.*
  - With T = 2.5 ms, a Controller at Ts = 1 ms is called at exactly k·1 ms (also Ts 1.1 and 1.02 ms, cut steps). Before: 0, 1.667, 2.5, 3.333, 4.167, 5.0 ms….
  - A Source edge at a sample instant (1.5 s, 3.2 s) reaches a controller of Ts 1, 2, 5 and 10 ms at that sample, at every record step.
  - Loading the example whole keeps `sim.sampleTime = 0.00025` and `measure` on channels 3 and 4.
- *Measure readout.* A ±12 V square wave at 62.5 Hz recorded at 1 ms over 1 s gives AC RMS 12 V, TV/s = 2·24·62.5 = 3000 V/s and reversals 125/s. A sine A·sin(2πft) gives AC RMS A/√2 and reversals 2f. A constant gives zeros. A triangle at 4 samples per period is flagged under-resolved; at 16 it is not.
- *Integration.* `tuningSpace` returns [λ] for the relay, [λ, φ] for the layer and [λ, k1, k2] for super-twisting; guard test 12 passes with the new library entry.

**Why.** These pin down what each variant is for (reaching, robustness, chattering per variant) and keep the physics honest under the fastest switching the library produces.

### 9. Later, not in this change

- **Model-based sliding mode (equivalent control).** This is Slotine's û: switch only for what the model does not know.
  - Law: u = u0 + (â·ẏ + λ·ė)/b̂ + K·sw(s), with K ≥ (sup|w − (b/b̂)·ŵ| + η)/b_min (Slotine & Li eq. 7.20).
  - â and b̂ are computed from the plant, so per [designs-in-the-page.md](../output/designs-in-the-page.md) they must not be stored. Make it a designed twin `slidingModeDesigned`. Its `design(p, ctx)` linearises the plant the block sees (cut at u, measurements [y, ẏ]) and fits the speed path with `firstOrderFit`: K_fit = 1.43 rad/s per V and τ = 0.06 s, so â = 1/τ = 16.7 1/s and b̂ = K_fit/τ = 23.8 rad/s² per V (my computation from V→ω = 0.5/(0.0002s² + 0.021s + 0.35)). Stored inputs stay λ, K and φ.
  - In simulation, K = 3 V with these values cut the relay's total variation to 3207 V per run (against 13 980 V) and the heat while holding to 0.37 W, still chattering at 70 Hz. With φ = 0.1 it was smooth.
  - A disturbance-observer form, with the Observer block in the diagram, is the visible-model version (Yang, Li & Yu 2013).
- **Implicit super-twisting** (Seeber & Andritsch eq. 13, eq. 18 with saturation) as a designed twin that computes β by linearisation. Worth it only for a plant without parasitic dynamics, where it removes the discretisation chattering (0.108 V → 0.001 V).
- **s as a controller signal.** `make()` may return `signals: { s: () => s }`, listed as `controller.s` (unit y/s). A PID could later expose its P, I and D the same way.
- **The motor in integrator form, and a Product primitive.**
  - For a first-principles view, rebuild Motor from Gain, Sum and Integrator blocks named R, 1/L, Ke, Kt, b and 1/J.
  - Prerequisite: a step bound that sees loops through integrators. It is 0 today (an integrator's denominator [1, 0] gives `rootBound` 0), and an armature with L/R = 0.3 ms then diverges at a 1 ms record and silently goes wrong at 2.5 ms (correction 24). Compute it in `compileDiagram` or `simulateSystem`: a finite-difference Jacobian of `eval` at the initial state (n + 1 evaluations), its ∞-norm (which bounds every eigenvalue) times a safety factor, combined by max with the transfer-function bounds. A nonlinear plant whose stiffness grows later needs the check repeated (inference).
  - Add one primitive, **Product**: inputs per a string of `*` and `/` as in Simulink, y = Π u_k^(±1), passing straight through. With it, copper loss P_cu = i·(R·i), electrical power V·i and mechanical power Kt·i·ω become exact signals that follow every edit. The cart–pole rebuild needs it too (m·l·ω²·sin θ).
  - Until then, the example uses the Measure RMS of i for the heat. A Function `1*u^2` would hard-code R and go stale.
  - The encoder motor's own Motor (`firstOrder` K 200, τ 0.2 s; armature K 1, τ 2 ms) gets the same Transfer function form: rotor den [J, b] = [0.001, 0.005], armature den [L, R] = [0.002, 1].
- **Measurement noise.** A Noise block (σ 0.2 rad/s) on the speed input shows that sliding modes need a clean ė; the boundary layer's gain K/φ = 6 V·s/rad amplifies it. Levant's robust differentiator (ż0 = −1.5·L^½·|z0 − y|^½·sign(z0 − y) + z1, ż1 = −1.1·L·sign(z0 − y)) is the matching observer, with an error of order ε^½ under noise ε (Levant 2003, 2007).
- **Another SMC example.** A spacecraft axis with on/off thrusters. It needs only a Gain 1/J and two Integrators. The law is the existing relay generalised from e to s, with hysteresis and a deadband, as NASA's phase-plane control. It shows the practical fix for actuators that cannot be smoothed: firings and propellant against the size of the limit cycle.
- **Defer:**
  - a sliding-mode observer in `observers.js`, until there is a PMSM plant;
  - a buck converter, which needs Product, an integrator with a lower limit and µs steps.
- **Metrics in the CLI.** metrics.js `saturation` counts v ≠ u, so the relay, whose K equals its limit, reads 0 % while it sits at ±12 V most of the run. Add "time at a limit" (|u − umax| or |u − umin| below 1e-9 of the span), as Auto-tune's cost already counts it.
- **An accuracy step bound for every system** (open question for [roadmap.md](../output/roadmap.md)). Today's bound h ≤ 0.5/bound is a stability bound; a switching law can lock into a different limit cycle at h = τ/2 (correction 2). This example avoids it by its record step; tightening the bound everywhere changes other systems' runs slightly and needs its own check.

## Pitfalls

- **Sign convention.** Loop Tuner uses e = r − y, so s = λe + ė and u = +K·sgn(s) for a plant whose y rises with u. Slotine and Levant write x̃ = y − r and u = −k·sgn(s); MathWorks writes e = x_d − x as here. With r held, ė = −ẏ, so the line in the e–speed plane has slope +λ.
- **Sliding must exist over the whole uncertainty range.** The condition is |u_eq| < U along the line: here |V_eq| = |(a − λ)·λ·e + d/J|/β < 12 V. It bounds λ against the weakest actuator authority (λ = 20 fails at J×3: sliding only for |e| ≤ 0.35 rad, the relay's slope goes to 32.4 and super-twisting overshoots 20.9 %). The reaching condition ½·d(s²)/dt ≤ −η|s| gives t_reach ≤ |s(0)|/η only while it holds.
- **Invariance needs matching, and sampling breaks it a little.** The disturbance must enter where u enters (Draženović 1969). A sampled relay acts on average as a layer β·K·Ts wide, so under a constant load it keeps an O(Ts) error (about 5 mrad here at Ts = 1 ms, 1.5 mrad at 0.2 ms), inside its chattering band. Do not promise "exact rejection" for the relay on a sampled loop.
- **Chattering has two causes, and the fixes differ** (Utkin & Lee 2006).
  - Sampling: the switching cannot exceed 1/(2Ts). A layer of width β·K·Ts, the implicit discretisation, removes it.
  - Unmodelled fast dynamics: here the armature. The layer must also respect them (ζ in Recommendation 2). Higher-order sliding modes do not remove this kind (Boiko & Fridman 2005; Utkin 2016).
- **A boundary layer is a PD inside the layer** (Kp = K·λ/φ, Kd = K/φ), bang-bang outside. It loses finite-time convergence and invariance: a constant load leaves φ·d_eq/(K·λ). Slotine & Li remark (iii): "there is no free lunch". Comparing it with a softer PD measures gain, not method.
- **Super-twisting is not chattering-free with actuator dynamics.** Its gains are sized by the disturbance's rate bound L at the smallest input gain, and its v needs anti-windup. Even with clamped v, v integrates through a long reaching phase and s overshoots the line afterwards. A load step is an impulse in ẇ: no L bounds it, so the load is rejected in finite time, not instantly.
- **Published gain conditions belong to a specific law.** Seeber & Andritsch's eq. 15 is proven for their implicit, zero-order-hold law; the continuous conditions assume no armature. For the explicit law on this motor they are a guide; simulation decides.
- **Sliding modes need ė.**
  - A noisy speed feeds straight into u: K/φ for the boundary layer, k1/(2√|s|) near s = 0 for super-twisting.
  - A differentiated encoder adds quantisation and one sample of delay. Put the differentiator in the diagram (Finite difference observer), never inside the law.
- **The phase portrait assumes Tr = 0.** Sink e = r − angle is the controller's e only without a prefilter; with Tr > 0 the controller compares the angle with rf.
- **A sampled relay locks to whole samples.** Its period is an integer number of Ts (16 here), so the chattering frequency moves in steps when λ, Ts or τ_a change. Harmonic balance is a guide (68.7 Hz with a Ts/2 delay, 48 Hz with Ts), not an exact prediction.
- **The XY readout depends on the window.** Over a window with reaching arcs, a falls to about 6.5–7 (about 5 at J×3). Start the window after reaching: 0.4 s for the relay and the layer; 0.6 s for super-twisting at J×3. A shorter window also ends the run, because the screen is the record.
- **RMS and heat need a resolved waveform.** Sampled at 4 points per period, a relay-driven current reads 1.5× its true mean square. Read heat at ≥ 10 samples per period; the Measure readout flags less.
- **A relay loop is sensitive to the integration step.** At h = τ/2 of the armature the relay locked into a different limit cycle (23.8 against 42 mrad). Check any number for a switching law at a step of about τ/10 or finer; this example's 0.25 ms record does.
- **Kt and Ke are two separate Gain blocks.** In SI units they must be equal, or the motor creates or destroys energy. A person who edits one should edit the other. The block names say so: `Kt (= Ke)` and `Ke (= Kt)`.
- **Integrator–gain loops have no step bound** (Recommendation 9). This is a physics-is-never-wrong issue for any primitive rebuild of a stiff plant: it can fail silently, not only by diverging.
- **Do not model Coulomb friction as Function `sign(u)`.** A stopped shaft would chatter numerically instead of sticking. Stiction needs its own primitive, for example Karnopp's model. It is not needed for this example.
- **Unverified from memory, not used for any number above:**
  - Utkin's discrete equivalent control as stated in Young, Utkin & Özgüner (1999): u(k) = u_eq(k) if |u_eq(k)| ≤ u0, else u0·u_eq(k)/|u_eq(k)|.
  - The attribution of the s/(|s| + δ) smoothing to Edwards & Spurgeon (1998).
  - Tan et al. (2005): f_S = Vo(1 − Vo/Vi)/(2κL).

## Sources

- Slotine & Li, Applied Nonlinear Control, Prentice Hall 1991, ch. 7 (scan): https://lewisgroup.uta.edu/ee5323/notes/Slotine%20and%20Li%20applied%20nonlinear%20control-%20bad%20quality.pdf
  - eq. 7.3: s = (d/dt + λ)^(n−1)·x̃;
  - eq. 7.5: sliding condition ½·d(s²)/dt ≤ −η|s|, giving t_reach ≤ |s(0)|/η;
  - §7.1.2: equivalent control;
  - eqs. 7.13–7.20: k = F + η; b̂ = √(b_min·b_max), β = √(b_max/b_min); eq. 7.20 k ≥ β(F + η) + (β − 1)|û|;
  - Example 7.2: "excellent tracking … at the price of high control chattering";
  - §7.1.4: PWM motors, switching beyond the unmodelled dynamics;
  - §7.2: boundary layer, ε = Φ/λ^(n−1), balance Φ̇ + λΦ = k, remark (iii) "no free lunch";
  - eqs. 7.41–7.43: λ ≤ (2π/3)·ν_R, λ ≤ 1/(3·T_A), λ ≤ ν_sampling/5 (bounds on λ, not on Φ);
  - integral sliding surface p. 286.
- Slotine, Sliding controller design for non-linear systems, Int. J. Control 40(2), 1984: https://doi.org/10.1080/00207178408933284
- Utkin, Variable structure systems with sliding modes, IEEE TAC 22(2), 1977: https://doi.org/10.1109/TAC.1977.1101446
- Utkin, Sliding mode control design principles and applications to electric drives, IEEE TIE 40(1):23–36, 1993 (abstract: "order reduction, decoupling design procedure, disturbance rejection, insensitivity to parameter variations, and simple implementation by means of power converters"): https://doi.org/10.1109/41.184818
- Utkin & Lee, Chattering problem in sliding mode control systems, VSS'06, pp. 346–350, 2006 (abstract, verified via OpenAlex: two causes, unmodelled fast dynamics and finite sampling; "switching frequency can not exceed that of sampling"; wear and heat losses): https://doi.org/10.1109/VSS.2006.1644542 ; https://api.openalex.org/works/doi:10.1109/VSS.2006.1644542
- Utkin, Discussion aspects of high-order sliding mode control, IEEE TAC 61(3), 2016: https://doi.org/10.1109/TAC.2015.2450571
- Utkin, Guldner & Shi, Sliding Mode Control in Electro-Mechanical Systems, 2nd ed., CRC 2009: https://doi.org/10.1201/9781420065619
- Utkin, Poznyak & Ordaz, Adaptive super-twist control with minimal chattering effect, CDC-ECC 2011 ("the amplitude of chattering is proportional to discontinuity magnitude in control"): https://skoge.folk.ntnu.no/prost/proceedings/cdc-ecc-2011/data/papers/0976.pdf
- Young, Utkin & Özgüner, A control engineer's guide to sliding mode control, IEEE TCST 7(3):328–342, 1999 (record and abstract only; closed access): https://doi.org/10.1109/87.761053
- Draženović, The invariance conditions in variable structure systems, Automatica 5(3):287–295, 1969 (matching condition; citation only).
- DeCarlo, Żak & Matthews, Variable structure control of nonlinear multivariable systems: a tutorial, Proc. IEEE 76(3), 1988: https://doi.org/10.1109/5.4400
- Gao & Hung, Variable structure control of nonlinear systems: a new approach, IEEE TIE 40(1), 1993 (reaching laws: constant, constant plus proportional, power rate): https://doi.org/10.1109/41.184820
- Gao, Wang & Homaifa, Discrete-time variable structure control systems, IEEE TIE 42(2), 1995 (s(k+1) − s(k) = −qT·s(k) − εT·sgn s(k); band εT/(2 − qT)): https://doi.org/10.1109/41.370376 ; the band as δ = β/(1 + α) with α = 1 − qT in https://www.intechopen.com/chapters/71607 (Remark 4). Searches that did not give the formula: https://skoge.folk.ntnu.no/prost/proceedings/ifac2014/media/files/0181.pdf , https://ijra.iaescore.com/index.php/IJRA/article/view/20253 , https://link.springer.com/article/10.1007/s11709-009-0022-5
- Levant, Sliding order and sliding accuracy in sliding mode control, Int. J. Control 58(6), 1993: https://doi.org/10.1080/00207179308923053
- Levant, Higher-order sliding modes, differentiation and output-feedback control, Int. J. Control 76(9–10), 2003 (r-th-order accuracy O(τ^r); differentiator 1.5·L^½, 1.1·L): https://www.tau.ac.il/~levant/ijc_hosm_2003.pdf
- Levant, Principles of 2-sliding mode design, Automatica 43(4), 2007: https://www.tau.ac.il/~levant/levant_2sl_aut2007_pre.pdf
- Levant, Chattering analysis, IEEE TAC 55(6), 2010: https://doi.org/10.1109/TAC.2010.2041973
- Levant & Yu, Sliding-mode-based differentiation and filtering, IEEE TAC 2018 (equivalent control by low-pass filtering, eq. 15): https://www.tau.ac.il/~levant/Levant,Yu-SMbased_filtering,IEEETAC,2018.pdf
- Seeber & Andritsch, Proper implicit discretization of the super-twisting controller, without and with actuator saturation, Automatica 173:112027, 2025 (verified: continuous law eq. 6; implicit law defined by eq. 12 with closed form eq. 13; conditions eq. 15, k1 > √(k2 + L) and k2 > L, with |x| ≤ L·T² after finite time, proven in Theorem 6 for the implicit law under a zero-order hold; conditioned law eq. 18 and conditions eq. 19; "best possible worst-case performance"): https://arxiv.org/abs/2406.16094 ; https://arxiv.org/html/2406.16094
- Seeber & Horn, Stability proof for a well-established super-twisting parameter setting, Automatica 2017 (k1 = 1.5√L, k2 = 1.1L): https://graz.elsevierpure.com/files/23411198/Seeber_2017_Stability_Proof_for_a_Well_Established_Super_Twisting_Parameter_Setting.pdf
- Moreno & Osorio, A Lyapunov approach to second-order sliding mode controllers and observers, CDC 2008: https://skoge.folk.ntnu.no/prost/proceedings/cdc-2008/data/papers/1621.pdf
- Boiko & Fridman, Analysis of chattering in continuous sliding-mode controllers, IEEE TAC 50(9):1442–1446, 2005 (verified via OpenAlex: with an actuator, power-fractional and super-twisting laws converge to a periodic motion): https://doi.org/10.1109/TAC.2005.854655 ; Boiko, Fridman & Iriarte, ACC 2005 ("chattering-free … a misconception"; Table I): https://skoge.folk.ntnu.no/prost/proceedings/acc05/PDFs/Papers/0430_ThB05_3.pdf
- Martínez-Fuentes, Pérez-Ventura & Fridman, chattering of Lipschitz-continuous SMC versus super-twisting, scored by amplitude, frequency and average power, 2020: https://arxiv.org/abs/2004.00819
- Acary & Brogliato, Implicit Euler numerical scheme and chattering-free implementation of sliding mode systems, Systems & Control Letters 59:284–293, 2010: https://inria.hal.science/inria-00423576
- Huber, Acary & Brogliato, Lyapunov stability and performance analysis of the implicit discrete sliding mode control, arXiv 1310.6004 (u_k = −proj_[−α,α]((CB*)⁻¹·σ_k)): https://arxiv.org/abs/1310.6004
- Wang, Brogliato, Acary, Boubakir & Plestan, Experimental comparisons between implicit and explicit implementations of discrete-time sliding mode controllers, IEEE TCST 23(5):2071–2075, 2015 (explicit control "switches between two discrete values … the numerical chattering in the input"; implicit "almost eliminated" input chattering on an electropneumatic actuator): https://inria.hal.science/hal-01087400
- Brogliato, Polyakov & Efimov, The implicit discretization of the super-twisting sliding-mode control algorithm, IEEE TAC 2020: https://hal.archives-ouvertes.fr/hal-02336599
- Yang, Li & Yu, Sliding-mode control for systems with mismatched uncertainties via a disturbance observer, IEEE TIE 2013 (switching gain only above the estimation error): https://research-repository.rmit.edu.au/articles/journal_contribution/Sliding-mode_control_for_systems_with_mismatched_uncertainties_via_a_disturbance_observer/27454131
- Feng, Yu & Man, Non-singular terminal sliding mode control of rigid manipulators, Automatica 38(12), 2002 (not recommended here: same chattering plus a fractional power): https://doi.org/10.1016/S0005-1098(02)00147-4
- Liao et al., review of adaptive-gain SMC (Utkin & Poznyak 2013; Plestan et al. 2010), 2018: https://arxiv.org/abs/1802.09689
- MathWorks, Sliding Mode Controller (Reaching Law) block (verified: sign, relay s/(|s| + φ), tanh, saturation; constant-rate, exponential and power-rate laws; "A larger Phi value results in less chattering but can increase the steady-state error"): https://www.mathworks.com/help/slcontrol/ug/slidingmodecontrollerreachinglaw.html ; mass–spring–damper example (phase plane, u(t), s(t)): https://www.mathworks.com/help/slcontrol/ug/sliding-mode-control-design-for-mass-spring-damper-system.html
- MathWorks Motor Control Blockset, Sliding Mode Observer: https://www.mathworks.com/help/mcb/ref/slidingmodeobserver.html
- Microchip AN1078, Sensorless field oriented control of a PMSM (Zambada & Deb, 2010): PI loops for speed, Id and Iq; sliding-mode current observer with a linear region and low-pass back-EMF filters at 20 kHz: https://ww1.microchip.com/downloads/en/AppNotes/01078B.pdf
- TI C2000 MotorControl SDK, eSMO (z = k·sign(î − i), LPF, angle compensation, PLL): https://ti.com/document-viewer/lit/html/SPRUJ26A/GUID-1C2F237A-DAA4-4401-A967-4E85BBFF333E ; https://software-dl.ti.com/C2000/docs/software_guide/mcsdk.html
- imperix, sensorless motor control (sign "excites high-frequency oscillations … known as chattering"; SMO not suitable for low speed): https://imperix.com/doc/implementation/sensorless-motor-control
- ABB Technical Guide No. 1, Direct Torque Control (two-level hysteresis on torque and flux every 25 µs, no modulator): https://library.e.abb.com/public/758447ffd7a045c0912b7e01483f58ad/TechnicalGuideBook_EN_3AFE64514482_RevH.pdf
- Tan, Lai, Cheung & Tse, On the practical design of a sliding mode voltage controlled buck converter, IEEE TPEL 20(2), 2005 (S = α·x1 + x2, hysteresis κ; the frequency formula could not be extracted and is unverified): https://ira.lib.polyu.edu.hk/bitstream/10397/704/1/practical-design_05.pdf
- Tan, Lai & Tse, General design issues of sliding-mode controllers in DC–DC converters, IEEE TIE 55(3):1160–1174, 2008 ("SM control is still rarely applied in practical dc–dc converters"; variable frequency, EMI, filters, no ICs; PWM-based SMC with d = u_eq): https://ira.lib.polyu.edu.hk/bitstream/10397/692/1/general-design_08.pdf
- TI LM3485 hysteretic buck controller (10 mV hysteresis, no oscillator): https://www.ti.com/document-viewer/LM3485/datasheet
- NASA MSFC, phase-plane attitude control with deadband and Schmitt-trigger hysteresis against thruster chattering: https://ntrs.nasa.gov/api/citations/20160001829/downloads/20160001829.pdf ; https://ntrs.nasa.gov/api/citations/20160001840/downloads/20160001840.pdf
- TI motor-driver guidance on audible switching: https://www.ti.com/document-viewer/lit/html/SLVAES8
- PicoScope measurements (AC RMS, edge count with hysteresis): https://manuals.picotech.com/picoscope6/en/scope_measurements.html
- Repository: /home/user/ctrl/src/core/plants.js (motorDiagram, channels, ctrl), /home/user/ctrl/src/core/blocks.js (Transfer function block), /home/user/ctrl/src/core/controllers.js (prefilter, pidCore, staticLinear, relay), /home/user/ctrl/src/core/diagram.js (step bound, controller sampling), /home/user/ctrl/src/core/sim.js (simulateSystem), /home/user/ctrl/src/core/project.js (defaultSampleTime, simOf, normalizeScope, MAX_SAMPLES), /home/user/ctrl/src/core/systems.js (fromPlant, applySystem, VARIANT_TAGS, TONE), /home/user/ctrl/src/core/autotune.js (tuningSpace, cost), /home/user/ctrl/src/core/metrics.js, /home/user/ctrl/src/core/expr.js, /home/user/ctrl/src/ui/app.js (Auto Scale on load), /home/user/ctrl/src/ui/xyview.js (lineFit), /home/user/ctrl/design/output/instrument.md, /home/user/ctrl/design/output/designs-in-the-page.md
- Checks (scratch, not in the repository), all under /tmp/claude-0/-home-user-ctrl/281fed85-1c0b-52ae-b29a-1fd26dd76401/scratchpad/:
  - smc-verify/ (mathematics review): lib.mjs, the exact motor solution and the laws; table.mjs, the main table; other.mjs, armature, Ts, noise, φ, gains and λ = 20; cmp5.mjs and rk.mjs, the Ts = 5 ms case and the integration step; st.mjs, stsweep.mjs and wdot.mjs, super-twisting at J×3 and the size of L; jit.mjs, controller timing; fast.mjs, sampling bias of the copper loss; dint.mjs, the double-integrator test; hb.mjs, harmonic balance and the model-based law; cause.mjs and stload.mjs, offset cause and load error; ring.mjs, boundary-layer ringing; prim.mjs, the integrator-built motor; implicit.mjs, explicit against implicit super-twisting.
  - smc-review/ (fit review): check1.mjs to check6.mjs, among them the PD with the layer's gains, Auto Scale windows, the Transfer function motor and super-twisting with conditional integration.
  - smc-final/ (this revision): run.mjs, the three variants with the derivative-on-measurement surface on the exact motor; win.mjs, XY windows; page.mjs and ts5.mjs, the recommended example in `simulateSystem` with the Transfer function motor at 0.25, 0.1 and 1 ms records.
  - smc-synth/ (first synthesis, superseded where the above disagree): harness.mjs, table.mjs, final.mjs, sweep1–4.mjs, stcond.mjs, lam20.mjs, jitter.mjs, physmotor.mjs, df.mjs, tests.mjs, energy.mjs.
