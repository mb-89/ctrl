# Research: sliding mode control

Reader: whoever implements sliding mode control in Loop Tuner: the controller types, the example system, and the scope's one new readout. The person's words are in [input 10](../input/2026-10-24-10-sliding-mode-and-triple-swingup.md). This synthesis was made on 2026-10-24 from four research sweeps: the classic theory, gentler variants, industrial use, and how sliding modes are drawn. Every number for the example was then re-run in Loop Tuner's own simulator: `simulateSystem` on the library motor, with the laws added to `CONTROLLERS` at runtime only, and recorded at 1 ms. Where the sweeps disagreed, that simulation decided. The corrections come first.

Marks used below: **(inference)** is my reasoning, not a source. **(simulation)** is my run of the repository's code; scripts are listed under Sources.

## Where the sweeps disagreed, and what the simulation settled

- **Stimuli.** The sweeps used different setups: λ = 10 or 20 1/s, steps of 1 or 2 rad, loads of 0.3, 0.5 or 1 N·m. Some also recorded at the page's default 2.5 ms, which jitters a 1 ms controller (next bullet). Their numbers therefore do not compare. All numbers below come from one setup (Recommendation 1), recorded at 1 ms.
- **The page samples a 1 ms controller unevenly.** A 5 s screen records at duration/2000 = 2.5 ms. `simulateSystem` then integrates in steps of 2.5/3 = 0.833 ms, and a Controller samples at the first step boundary at or after each due time. The intervals between samples come out as 0.833 and 1.667 ms instead of 1 ms (jitter.mjs). The average rate is right; the instants are not. For the relay SMC this moves the chattering from 63 Hz to 50 Hz, the copper loss while holding (0.6–1.45 s) from 7.5 W to 10.3 W, and the residual load error from 5.5 to 8.5 mrad. The encoder example (Ts = 1 ms) is affected as well. Fix: Recommendation 6.
- **"The PD draws a curve, not a line" is wrong on this motor.** A linear loop also ends on a line in the phase plane: the direction of its slowest mode. For the library PD (Kp 20, Kd 1.5), the reduced model gives closed-loop poles −11.5 and −43.5 1/s (inference). Over 0.4–1.4 s the XY readout gives a = 10.13 for the PD and 9.89 for the relay: on the nominal motor they look alike. What separates them is robustness. With the rotor inertia tripled, the relay's slope stays at 10.02, while the PD's moves to 18.6 and the PD overshoots 2.3 % (simulation). The example teaches that difference instead.
- **A boundary layer as thin as one sample, φ = β·K·Ts = 0.3 rad/s, is not the practical choice.** This is the implicit-discretisation width of Acary and Brogliato. It removes chattering caused by sampling, but not chattering caused by the armature. Its inner gain is K/φ = 40 V·s/rad. After every reaching phase it rings at ±12 V for about 0.15 s, which gives 27 reversals/s and 940 V of total variation per run. With φ = 1 the ring is ±8 V; with φ = 2 it is ±3.7 V and over in 30 ms (simulation). Use φ = 2 rad/s (Recommendation 2).
- **Slotine's bandwidth rule λ ≤ 1/(3·T_A), applied to the layer, gives φ ≈ 9 rad/s.** That is a softer PD than the library PD: 147 mrad of error under the 1 N·m load, against 99 mrad. Too thick for an example meant to show what sliding modes buy.
- **The textbook super-twisting gains fail when J triples.** With k1 = 1.5√L/β and k2 = 1.1L/β at the nominal β (k1 = 1.9, k2 = 44 for L = 1000 rad/s³), J×3 gives 18 % overshoot and a 6 Hz oscillation. The gains must hold at the smallest input gain β. k1 = 4, k2 = 44 do (Recommendation 3).
- **λ = 20 1/s loses sliding when J triples.** On the line, V_eq = (a − λ)·λ·e/β. With J×3 and λ = 20 that is −34 V/rad·e, so the 12 V actuator can hold the line only for |e| ≤ 0.35 rad. The XY slope then wanders, and super-twisting overshoots 21 %. With λ = 10, sliding holds for |e| ≤ 2.4 rad. Keep λ = 10.
- **The relay is not exactly invariant to the load here.** The armature puts V one integration further from the load than the reduced model assumes. Under 1 N·m the relay keeps a 5.5 mrad offset inside its chattering band, after a 15.5 mrad peak. Super-twisting ends at 0.15 mrad.
- **No effort number reaches the page.** `computeMetrics` (uTV, ∫u², peak, % saturated) is called only by the CLI's v1 path (`project.js`, tests). No file in `src/ui` uses it, and diagram systems never get metrics. "Use the existing uTV" therefore shows nothing to the person. Recommendation 5 adds a measurement readout instead.
- **Rebuilding the motor from Gain, Sum and Integrator blocks is not safe yet.** The step bound in `compileDiagram` comes only from transfer-function denominators. A loop of gains and integrators reports bound = 0. The physical armature V − R·i − Ke·ω → 1/L → ∫ with L/R = 0.3 ms then blows up numerically at a 1 ms step (physmotor.mjs). The same form with a firstOrder block adapts its step. This matters for the no-black-box task (Pitfalls).

## Summary

**What sliding mode control is.** Choose a sliding variable s = λe + ė, with e = r − y, λ in 1/s and s in y's unit per second. Drive s to zero with a switching law u = K·sgn(s). Once s = 0, the error obeys ė = −λe and decays as e^(−λt). This holds whatever the plant's parameters and whatever disturbances enter through the input channel, as long as the switching gain dominates them. That robustness is the point of the method (Utkin 1977, 1993; Slotine & Li ch. 7; matching condition: Draženović 1969).

**Why it is hard on actuators.** The person's suspicion is right. An ideal sliding mode switches infinitely fast. A real one switches as fast as the sampling and the actuator's own fast dynamics allow. That chattering causes "low control accuracy, high wear of moving mechanical parts, and high heat losses in power circuits" (Utkin & Lee 2006).

On the library DC motor at Ts = 1 ms, the textbook relay V = 12·sgn(s) holds the shaft almost perfectly. To do so it slams ±12 V at 63 Hz. That drives 10 A peak-to-peak of current ripple, which is 5 N·m of torque ripple on a motor whose stall torque is 6 N·m, and 7.9 W of heat into a shaft standing still. Over the 5 s run, 97 % of the electrical energy becomes copper heat (simulation).

**How it is used in practice.** Industry uses sliding modes in three ways.
1. Where the actuator already is a switch, the sliding law is the switching rule and a hysteresis band bounds its frequency. Examples are hysteretic DC–DC regulators, hysteresis current control, ABB's Direct Torque Control (two-level hysteresis every 25 µs), and NASA's phase-plane thruster control with deadband and a Schmitt trigger.
2. As sliding-mode observers, where the switching happens only in software. Examples are sensorless PMSM drives: Microchip AN1078, TI's eSMO, and the MathWorks SMO block. Their speed and current loops stay PI.
3. On continuous actuators, smoothed: a boundary layer sat(s/φ), which is a saturated high-gain PD near the surface (MathWorks' reaching-law block; Slotine & Li §7.2).

Higher-order laws such as super-twisting give a continuous u. They keep finite-time convergence and reject slowly varying loads exactly (Levant 1993, 2003). But they still oscillate when the actuator has dynamics (Boiko & Fridman 2005). I found them validated on lab benches, not in shipped products. Tan, Lai and Tse (2008) explain why switching SMC stays rare even in converters: variable switching frequency, EMI, filter design, no ICs, no design procedure.

**What to build.**
- One example, *DC motor, sliding mode*, on the library motor. It is already an openable subsystem of primitives, and its 10 ms armature is the physical "unmodelled fast dynamics" that makes chattering real.
- Two controller types: `slidingMode` (relay, or boundary layer with φ > 0) and `superTwisting`.
- Four variants: relay (theory) · boundary layer (practice) · super-twisting (the continuous improvement) · PD (linear, for comparison).
- The existing XY mode **without Δ**, with e across and the speed up, is the phase portrait. The sliding line is speed = λ·e, the readout's slope a is λ, and its σ is the chattering band. No new display mode is needed.
- One scope addition: a **Measure** readout per channel (mean, RMS, AC RMS, p-p, TV/s, reversals/s). It makes "hard on the actuator" a number.
- One simulation fix: controllers sample exactly on their own clock, and this system records at its controller's Ts.

## Recommendations

### 1. The example: "DC motor, sliding mode", built on the library motor

**What.** A fifth motor system, opening on its own view of the motor, in XY mode. It shows two things:
1. What sliding is: a reaching arc, then a straight line whose slope is λ and does not move when the plant changes.
2. What the textbook law costs the actuator, and what the practical laws give up instead.

**How.**

*Plant.* Use `motorDiagram` from `src/core/plants.js` unchanged in physics. All values are physics parameters or design inputs, so nothing is computed and stored:

| Physics | Value | Where in the Motor subsystem |
|---|---|---|
| Armature resistance R | 1 Ω | `armature` firstOrder K = 1/R = 1 A/V |
| Armature inductance L | 10 mH | `armature` τ = L/R = 10 ms |
| Torque and back-EMF constants Kt = Ke | 0.5 N·m/A = 0.5 V·s/rad | Gains `Kt`, `Ke` |
| Rotor inertia J | 0.02 kg·m² | `load` firstOrder τ = J/b = 0.2 s |
| Viscous friction b | 0.1 N·m·s/rad | `load` K = 1/b = 10 rad/s per N·m |
| Voltage limit | ±12 V | Controller umin, umax |
| Controller sample time Ts | 1 ms | Controller Ts |

Changes for this system:
- Controller Inputs = 3: r, angle, speed. Wire the Motor output (speed) to `ctrl:2`.
- A top-level Sum (+−) of r and angle feeding a Sink **e** (rad).
- Inside Motor, a Sink **i** (A) on the `armature` output. Any Sink at any depth is a scope source.
- Rename the two firstOrder blocks so their physics reads: `armature 1/(R + L s)` and `rotor 1/(J s + b)`. Today the rotor is named `load`, beside the `load torque` port.
- `motorDiagram(variants, { inputs: 3, Ts: 0.001 })` keeps the other two motor systems as they are.

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
- The rotor inertia J. Open Motor and set the rotor τ from 0.2 to 0.6 s, which is J×3, a heavier load coupled to the shaft. β drops to 8.3 and a to 5.8; with λ = 10 the sliding condition still holds for |e| ≤ 2.4 rad.

*Actuator effects that make chattering real.*
- The armature lag L/R = 10 ms. It sets the relay's chattering at about 63 Hz, close to the harmonic-balance prediction of 69 Hz (df.mjs; Boiko et al.). A sampled relay locks to whole samples: 62.5 Hz is 16 samples. Hand check: Δi_pp ≈ U/(2·L·f) = 12/(2·0.01·62.5) = 9.6 A, against 10.3 A simulated.
- Sampling at Ts = 1 ms. The switching cannot be faster than 1/(2Ts) (Utkin & Lee 2006).
- Measurement noise is left out of the default, so the example stays at two lessons. It is a "try this" (Pitfalls).
- The ±12 V source stands for a PWM bridge's average voltage (inference). The 63 Hz swing is therefore real at the motor terminals.

*Scope* (the `scope` field of the library entry):
- Channel 1: e, 0.2 rad/div, on.
- Channel 2: speed, 2 rad/s/div, on. With channel 2's scale = λ × channel 1's scale, the sliding line λ = 10 1/s is the screen's diagonal.
- Channel 3: V, 5 V/div, assigned but off.
- Channel 4: i, 5 A/div, assigned but off.
- `view: { mode: 'xy' }`, with Δ off.
- `sim: { sampleTime: 0.001 }` (Recommendation 6).
- Opens on the Plant tab with the motor view.
- The view's caption adds `i {i:5.1} A`. Use a `motorViews({ current: true })` flag, because the other motor systems have no `i` and the caption would read NaN.

*Notes text* (draft; numbers from Recommendation 4):

> A sliding-mode controller holds the shaft. It computes s = λ·e + ė (e = r − angle, λ = 10 1/s) and pushes s to zero; once there, the error can only decay as e^(−λt), whatever the load or the inertia. The scope opens in XY: across is the error e, up is the speed. After each step the beam runs at full voltage towards the diagonal, speed = 10·e (reaching), then slides along it into the origin (sliding). Set Horizontal to 100 ms/div at 0.4 s: the readout's slope a is λ, its σ is how tightly the motor slides. The first variant is the textbook relay, V = 12 V·sign(s): the shaft looks perfect, but press Time and switch on channels 3 and 4. The voltage slams between ±12 V 63 times a second, the current ripples 10 A peak to peak (5 N·m of torque ripple: a hum), and the motor turns 8 W into heat standing still. Boundary layer: the same law, proportional inside |s| < 2 rad/s. No chatter, PD-like effort, but a constant load now leaves an error (33 mrad at 1 N·m). Super-twisting: a continuous voltage that still rejects the load exactly; a small 35 Hz ripple is left, caused by the armature (open Motor). PD: the linear controller from the position example; under the load at 3.2 s it errs 99 mrad. Try: open Motor and triple the inertia (rotor τ 0.2 → 0.6 s). The sliding line stays at 10, the PD's tilts to 18. Or make the armature faster (τ 10 → 1 ms): the relay's chatter jumps to 250 Hz and it burns 52 W.

*Tags:* `systemTags` derives Linear, the controller tags, Disturbance and XY. Add `slidingMode` and `superTwisting` to `VARIANT_TAGS` as one tag, "Sliding mode", with a tone of its own.

**Why.**
- The DC motor position servo is the canonical SMC plant for electric drives (Utkin 1993; Slotine & Li §7.1.4; Utkin, Guldner & Shi).
- Its actuator is a voltage, so chattering is a visible square wave and a measurable current.
- Its reduced model is second order, so the phase plane fits XY.
- It is already a subsystem of primitives, which meets the person's "no black boxes". The cause of the chattering, the armature lag, can be opened and changed.
- Alternatives that were rejected:
  - The cart–pole is underactuated and still a physics block.
  - A buck converter switches at tens of kHz, beyond a 5 s screen, and needs a Product primitive and a limited integrator.
  - A thruster (attitude) example is a good later second example (Recommendation 8).

### 2. Controller type `slidingMode`: the relay (φ = 0) and the boundary layer (φ > 0)

**What.** A model-free first-order sliding-mode law for a plant whose output rises with u:
- inputs [r, y, ẏ] (r first, as every law);
- output u, digital at Ts with a zero-order hold.

**How.**
- Parameters:
  - `lambda`, label "Surface slope λ", unit 1/s, default 10, min 0.
  - `K`, label "Switching gain K", unit u, default 1. Help text: negative for a plant whose y falls when u rises, as the relay's d.
  - `phi`, label "Boundary layer φ", in the unit of s, i.e. y's unit per second (rad/s here), default 0, min 0. Help text: 0 is the ideal relay.
  - `PREFILTER` (Tr), `START` (u0, a bias here), `LIMITS`.
- Law, per sample:
  ```
  rf = prefilter(r)                       // existing Vorfilter; rf = r when Tr = 0
  ṙf = (rf − rf_prev)/Ts                  // 0 at the first sample
  ẏ = x[2], or (y − y_prev)/Ts when the block has only 2 inputs
  e = rf − y;   ė = ṙf − ẏ;   s = λ·e + ė
  sw = φ > 0 ? clamp(s/φ, −1, 1) : sign(s)   // sign(0) = 0
  u = clamp(u0 + K·sw, umin, umax)
  ```
  - With Tr = 0, a step in r makes ṙf a one-sample spike Δr/Ts. It has the sign of λ·Δr, so the relay and a layer thinner than λ·|Δr| are at the limit anyway. Set Tr > 0 to avoid it.
  - Units: s in y/s (rad/s), K in u (V), φ in y/s.
- `linear(p, Ts, at)` for the Analysis tab:
  - φ = 0: throw "an ideal sliding mode switches: it has no linear model; give it a boundary layer φ > 0".
  - φ > 0, inside the layer and the limits, with the prefilter left out as the convention says: one state x = r_prev.
    - A = [[0]], B = [[1, 0, 0]], C = [[−K/(φ·Ts)]], D = [[K·(λ + 1/Ts)/φ, −K·λ/φ, −K/φ]] on [r, y, ẏ].
    - With 2 inputs, add the state y_prev and move the −K/φ into it the same way.
  - The Analysis tab then shows the boundary layer for what it is: a PD with Kp = K·λ/φ = 60 V/rad and Kd = K/φ = 6 V·s/rad for the example's values.
- The structure diagram of the running variant (task 21) gets one entry: e, ė → λ·e + ė = s → sign / sat(·/φ) → K → u.
- A test, an `ABOUT` sentence, and a row in [controller-proposal.md](../output/controller-proposal.md).

The example's values:
- Relay: λ = 10, K = 12 V, φ = 0, limits ±12 V. K equals the limit, so the law is V = 12·sgn(s).
- Boundary layer: the same, with φ = 2 rad/s.

How φ was chosen (inference, checked in simulation):
- Floor: φ ≥ β·K·Ts = 0.3 rad/s. This is the implicit-discretisation width (Huber, Acary & Brogliato): thinner than this and sampling alone makes it chatter.
- The layer's speed loop, β·K/φ, should stay near the armature corner 1/τ_a = 100 1/s. For φ = 2 it is 150 1/s, and the reduced loop τ_a·σ² + σ + β·K/φ has ζ ≈ 0.41. φ = 1 gives ζ ≈ 0.29 and φ = 0.3 gives 0.16; both ring after reaching.
- Price: a constant load leaves e_ss = φ·(d·R/Kt)/(K·λ) = 2·2/(12·10) = 33 mrad at 1 N·m (simulated 33.2). The PD leaves 2 V/Kp = 100 mrad.

**Why.**
- Utkin's relay u = U·sgn(s) is the form used for electric drives. It needs only λ, U and the sign of the input gain, so nothing plant-specific is stored.
- sat(s/φ) is the most common smoothing (Slotine & Li §7.2; MathWorks' block offers sign, s/(|s| + φ), tanh(s/φ) and sat(s/φ)). MathWorks: "A larger Phi value results in less chattering but can increase the steady-state error."
- One type with φ = 0 meaning the relay keeps the two variants one parameter apart. Flipping between them then shows exactly what the layer changes.

### 3. Controller type `superTwisting`: continuous, with exact rejection of slow loads

**What.** Levant's second-order sliding-mode law on the same s. It has the same inputs [r, y, ẏ] and the same surface code as `slidingMode`.

**How.**
- Parameters:
  - `lambda` (1/s, default 10);
  - `k1`, label "Gain k1", unit u per √(y/s), V·s^½/rad^½ here, default 1;
  - `k2`, label "Gain k2", unit u/s, default 10;
  - `PREFILTER`, `START` (u0, the starting value of v), `LIMITS`.
- Law, explicit Euler. The sign is flipped from Levant's form because raising u lowers s here:
  ```
  u = clamp(k1·√|s|·sign(s) + v, umin, umax)
  v = clamp(v + Ts·k2·sign(s), umin, umax)     // v is the integral part; clamping it is the anti-windup
  ```
- `linear()` throws "super-twisting has no linear model: √|s| has infinite slope at s = 0".
- The example's gains: λ = 10, k1 = 4 V·s^½/rad^½, k2 = 44 V/s, limits ±12 V. They are hand gains, chosen with the rule below and checked by simulation, like the swing-up gains.
  - In s-units, where ṡ = −β·V + w and w = (a − λ)·ω + d/J, the gains are k1·β = 100 and k2·β = 1100 rad/s³.
  - Seeber and Andritsch (2025, eq. 15) require k2 > L and k1 > √(k2 + L), with L ≥ |ẇ|.
  - On the sliding line, |ẇ| = |a − λ|·λ·|ω| ≤ 7.5·10·8.6 ≈ 645 rad/s³ at the nominal J. Both conditions hold: 1100 > 645 and 100 > 42.
  - At J×3 (β = 8.3, |a − λ|·λ·|ω| ≈ 367) the gains are 33 and 367. The k1 condition holds (33 > 27); the k2 condition is just at its limit (367 against an L of about 367). This is why the line is reached more slowly there (a = 15 in the window).
  - The textbook setting k1 = 1.5√L/β, k2 = 1.1L/β (Levant; proved by Seeber & Horn 2017) gives 1.9 and 44. At J×3 its k1 is 15.8 < 27, which explains the 18 % overshoot and the 6 Hz oscillation.
  - The rule: size the gains for the smallest β, i.e. the largest J. These conditions are for a perfect first-order sliding variable without the armature, so they are a guide, not a proof (inference).
- Discretisation:
  - Explicit Euler has |s| = O(Ts²) accuracy without parasitic dynamics, plus small discretisation chattering (Levant 2003).
  - The proper implicit law of Seeber and Andritsch (2025, eq. 13; conditioned for saturation in eq. 18) reaches |s| ≤ L·Ts² and is proven worst-case optimal. It costs one branch and a square root.
  - Here the armature dominates the residual oscillation. The practical sweep found the implicit and explicit forms behave the same with the armature present. So explicit Euler with clamped v is enough for v1; offer the implicit form when a plant without parasitic dynamics needs it.

**Why.** Super-twisting is the literature's answer to the person's question: an SMC that is not hard on the actuator.
- u is continuous.
- v integrates sgn(s), so a constant load is rejected exactly: the error under the load is 0.15 mrad, against 5.5 mrad for the relay and 33 mrad for the boundary layer.
- It needs no derivative of s.

Its honest limits belong in the notes:
- With actuator dynamics it converges to a small periodic motion, not to rest (Boiko & Fridman 2005). Here that is 0.64 V AC RMS at 35 Hz, 0.26 A of current ripple and 0.07 W while holding.
- Its gains must be sized for the weakest plant.
- No shipped product built on it was found (industry sweep).

### 4. The variants and the numbers each must reach

**What.** Four variants, the first one running:
1. **Sliding mode, relay (theory)**: `slidingMode` λ 10, K 12, φ 0.
2. **Sliding mode, boundary layer (practice)**: `slidingMode` λ 10, K 12, φ 2.
3. **Super-twisting (continuous)**: `superTwisting` λ 10, k1 4, k2 44.
4. **PD (linear, for comparison)**: `pid` Kp 20, Kd 1.5, Tf 0.01.

All variants have limits ±12 V. There is no Off: it would only show the load spinning a free shaft.

**How.** Expected values with the nominal motor, recorded at 1 ms (table.mjs, final.mjs).
- *Whole run* is the 5 s screen.
- *Hold* is 1.0–1.49 s: r = 1 held, no load.
- *Load* is 3.2–3.69 s.
- *XY* is the readout over the window 0.4–1.4 s.
- Copper loss is R·i² with R = 1 Ω.

| | Relay (theory) | Boundary layer φ = 2 | Super-twisting 4 / 44 | PD 20 / 1.5 |
|---|---|---|---|---|
| V total variation per second, whole run | 2796 V/s | 34 V/s | 130 V/s | 26 V/s |
| V reversals per second (hysteresis 0.5 V), whole run | 116 | 3 | 64 | 3 |
| V AC RMS while holding, and its frequency | 12.0 V at 63 Hz | 0.00 V | 0.64 V at 35 Hz | 0.00 V |
| Current ripple while holding, AC RMS (p-p) | 2.80 A (10.3 A; 5.1 N·m of torque) | 0.00 A | 0.26 A (0.78 A) | 0.00 A |
| Copper loss while holding | 7.9 W | 0.00 W | 0.07 W | 0.00 W |
| Mean copper loss, whole run | 10.3 W | 3.2 W | 2.8 W | 3.7 W |
| Error under 1 N·m: peak / at 3.69 s | 15.5 / 5.5 mrad | 33.2 / 33.2 mrad | 17.8 / 0.15 mrad | 99.4 / 99.4 mrad |
| Reaching: \|s\| < 0.5 rad/s after the 0.25 s step | 43 ms | 44 ms | 49 ms | 44 ms |
| Settling (2 %) of the first step | 0.43 s | 0.44 s | 0.42 s | 0.41 s |
| XY slope a and spread σ (0.4–1.4 s) | 9.89, 0.177 rad/s | 9.48, 0.001 | 10.06, 0.029 | 10.13, 0.036 |
| XY slope a with J×3 | 10.02 | 10.90 | 15.35 | 18.59 (and 2.3 % overshoot) |

Other conditions (final.mjs all):
- Armature τ 10 → 1 ms: the relay chatters at 250 Hz (f_s/4) and loses 52 W while holding. Boundary layer, super-twisting and PD are unchanged.
- Ts = 5 ms: the relay chatters at 34 Hz, loses 28 W while holding, and its load error grows to 26 mrad.
- Speed noise σ = 0.2 rad/s on the speed input: the boundary layer's TV rises to 1309 V/s and super-twisting's to 1609 V/s. The PD is unchanged because it differentiates the angle. This is the sliding modes' dependence on a clean ė.

**Why.** Each variant shows one thing:
- The relay: perfect tracking that costs 2.8 kV/s of switching and 8 W of heat standing still.
- The boundary layer: smoothness bought with invariance ("no free lunch", Slotine & Li §7.2). Inside the layer it is a PD with Kp 60, Kd 6.
- Super-twisting: a continuous voltage with exact rejection, and an honest residual ripple.
- The PD: on the nominal plant it looks like the sliding modes; under load and with J×3 it does not.

The XY window has to start after the reaching phase. Over the whole 5 s screen every variant reads a ≈ 6.5–7, because the reaching arcs pull the fit (simulation).

### 5. The scope: XY without Δ is the phase portrait; one addition, a Measure readout

**What.**
- *Phase portrait.* Channel 1 = e (across), channel 2 = speed (up), Δ off. While r is held, ė = −ω, so s = 0 is the line speed = λ·e, a slope of +λ through the origin. Slotine's figure plots ė against e and has slope −λ.
- *Reading the figure.*
  - The beam first runs along a reaching arc at full voltage, then along the line.
  - The existing readout Y ≈ a·X + b gives a ≈ λ.
  - Its σ, the RMS distance of the points from the line, is the quasi-sliding band in rad/s.
- *Why not Δ.* Δ draws channel 1 minus a channel of the same unit, and e (rad) and speed (rad/s) differ. With r and angle on the channels, Δ gives the following error over r, which for square steps degenerates into vertical lines ([analysis.md](analysis.md) Pitfalls).
- *Alternative rejected.* The diagrams sweep built s in the diagram, so that Δ draws s: a Gain λ on e and a Sum λe − speed. That puts λ in the diagram as well as in the controller. It goes stale when either is edited, and Auto-tune cannot reach it.
- *The rest from existing modes:*
  - Time on V and i shows the cost.
  - FFT on V shows the chattering line: 62.5 Hz at 14.6 V, about 4·12/π, with odd harmonics.
  - The Spectrogram shows the line switch on when reaching ends.
  - A 10 Hz low-pass display filter on a second V channel shows the equivalent control (Utkin's filtered-average reading; Levant & Yu 2018).
- *No s(t) trace in v1.* σ measures the band, and the figure's distance from the line shows it. Showing s over time is the general "controller signals join the scope" feature that [instrument.md](../output/instrument.md) already anticipates (Recommendation 8).

**How: the Measure readout.** This is the one addition, and it applies to every mode.
- Format: `scope.channels[i].measure: true`; absent means off. Toggled under Vertical › Measure for the Vertical channel.
- Each measured channel gets one line under the screen, in its colour. It covers the samples inside the timebase window, up to the sweep (the same samples XY uses), on the display-filtered signal when a filter is set. The values are:
  - mean = (1/n)·Σx;
  - RMS = √((1/n)·Σx²);
  - AC RMS = √((1/n)·Σ(x − mean)²);
  - p-p = max − min;
  - TV/s = Σ|x_j − x_(j−1)| / (t_last − t_first);
  - reversals/s: the number of times x turns after moving more than h, divided by the window length, with h = 0.1 division (the channel's scale/10), shown in the line. It is an edge count with hysteresis, as bench scopes offer (PicoScope: AC RMS, edge count with hysteresis).
- Example line: `3 V  mean 0.00 V  rms 12.0 V  ac 12.0 V  p-p 24.0 V  TV 2.80 kV/s  rev 116/s (h 0.5 V)`.
- The example turns it on for channels 3 and 4. For i, the RMS gives the heat directly, P = R·i_rms².
- Code goes beside `lineFit` (`src/ui/measure.js` or in `xyview.js`); a test is in Recommendation 7.

**Why.** "Hard on the actuator" has to be a number the person reads, not an impression of a dense trace. The quantities are the ones the literature scores chattering by: amplitude, frequency and average power (Martínez-Fuentes, Pérez-Ventura & Fridman 2020). TV is the repository's own uTV, per second so that windows compare. The readout is generic, so it serves any system: the oven's heater, a HIL plant.

A dashed XY guide line Y = f(X) is not needed: a and σ already compare the figure with a line, and a guide would repeat λ outside the controller.

### 6. Simulation: controllers sample on their own clock; this system records at its Ts

**What.** Two changes.
1. A correctness fix for every diagram system: a Controller or Observer at Ts samples exactly at k·Ts.
2. A library entry may carry `sim: { sampleTime }`. This example sets 0.001 s, so the scope records every controller sample.

**How.**
1. In `simulateSystem`, choose the substep count m so that every sample instant lies on the integration grid.
   - Let g be the gcd of the record step T and every sampled block's Ts, computed on integers of 1 ns.
   - m is the smallest multiple of T/g that is ≥ T/hmax.
   - For T = 2.5 ms and Ts = 1 ms: g = 0.5 ms, m = 5, h = 0.5 ms (today 0.833 ms). Integration cost rises by 1.67×.
   - If m would exceed the step budget, split the step at the sample instant instead, or warn.
2. `applySystem` copies `entry.sim` on a whole load instead of setting `p.sim = {}`. [project-format.md](../output/project-format.md) already defines `sim.sampleTime` as the controller's sample time. Keep the global default (duration/2000): the encoder example relies on aliasing at 200 Hz.

**Why.**
- Without fix 1, the relay's chattering frequency, heat and residual error depend on the screen's record step, not on the controller (first correction above).
- Without fix 2:
  - TV and reversals miss switches between recorded samples: 11 988 V against 13 980 V per run (part of that difference is the jitter).
  - The 250 Hz chattering of the faster-armature "try this" aliases at the 200 Hz Nyquist frequency of a 2.5 ms record.
  - At 1 ms, a 5 s screen is 5000 samples, well inside `MAX_SAMPLES`.

### 7. Tests that prove it works

**What.** These go in `test/core.test.mjs`, or in a new `test/smc.test.mjs` for the system. Each is checked with the scripts listed; values in parentheses are measured.

**How.**
- *Laws.*
  - `slidingMode` with φ = 0 returns u0 ± K by the sign of s, and u0 at s = 0. It is clamped, and a negative K reverses it.
  - With φ > 0 it returns u0 + K·s/φ inside the layer and ±K outside.
  - `linear()` agrees with `step()` within 1e-12 for small random inputs inside the layer, like the existing check of every linear law against its step. For φ = 0 it throws.
  - `superTwisting`: with v fixed, |u(s = +1e-10) − u(s = −1e-10)| < 1e-4·k1, i.e. continuous. v moves by exactly Ts·k2 per sample and stays within the limits. `linear()` throws.
  - With 2 inputs, ẏ is the backward difference of y.
- *Finite-time reaching, textbook plant.* A double integrator ÿ = b·u from two Integrators, an ideal actuator, a relay `slidingMode`, a unit step at t = 0 (tests.mjs).
  - The first switch must fall within 2·Ts of t_r = (−1 + √(1 + 2λ·s0/(b·K)))/λ, with s0 = λ. For b = 1, K = 20, λ = 4: 153.1 ms, measured 154 ms.
  - After reaching, |s| ≤ 2·b·K·Ts (0.030 against 0.04). This is the O(Ts) quasi-sliding band (Levant 1993; Utkin & Lee 2006).
  - This needs sliding to exist, |u_eq| = λ·|ẏ|/b < K. The cases with K = 5, λ = 10 and K = 3, λ = 5 (b = 2) violate it and cross the line instead. That makes a useful negative test: after the first switch, |s| grows again far beyond 2·b·K·Ts (to 4.9 and 0.69).
- *Reaching on the motor.* After the 0.25 s step, |s| < 0.5 rad/s within 60 ms for every SMC variant (43–49 ms).
  - The reduced-model bound is t ≤ |s(0)|/η with η = β·K − |a − λ|·ω_max = 300 − 7.5·8.6 ≈ 235 rad/s², so 10/235 = 43 ms. The armature adds a few ms.
  - With J×3: within 160 ms (91–96 ms).
- *Robustness, 1 N·m load.*
  - Relay: peak |e| < 25 mrad (15.5), and the PD's peak is above 5× the relay's (99.4).
  - Super-twisting: |e(3.69 s)| < 1 mrad (0.15).
  - Boundary layer: |e(3.69 s)| within 10 % of φ·d·R/(Kt·K·λ) = 33.3 mrad (33.2).
  - J×3: the relay's XY slope over 0.4–1.4 s is within 5 % of λ (10.02) and the boundary layer's within 15 % (10.90). The PD's is more than 50 % off (18.6) and it overshoots (2.3 %).
- *Chattering.*
  - Relay while holding: V at ±12 V in ≥ 99 % of samples (100 %); fundamental of V between 55 and 75 Hz (62.5; harmonic balance 69 Hz); i AC RMS 2.4–3.2 A (2.80).
  - Boundary layer: V AC RMS while holding < 0.05 V (0.00).
  - Super-twisting: 0.2 V < V AC RMS < 1.5 V (0.64). The lower bound is the honest residual and guards against a later change hiding the armature. Its TV/s is below the relay's / 10 (130 against 2796).
  - No chattering frequency exceeds 1/(2Ts).
- *Physics.*
  - Energy balance for each variant, recorded at 0.1 ms, with V held over each step in the quadrature: ∫V·i dt = ∫R·i² dt + ∫b·ω² dt + ∫d·ω dt + ½L·i² + ½J·ω² within 0.5 %. Measured 0.030 % for the relay, which converts 50.6 J of its 52.4 J into heat; 0.001 % for the others (energy.mjs).
  - Armature τ 10 → 1 ms: the relay's chattering rises to ≥ 200 Hz (250) and its copper loss while holding above 40 W (52). This shows the chattering is set by the plant's own fast dynamics.
- *Simulation timing.* With T = 2.5 ms, a Controller at Ts = 1 ms is called at exactly k·1 ms. Today the intervals are 0.833 and 1.667 ms (jitter.mjs).
- *Measure readout.* A ±12 V square wave at 62.5 Hz recorded at 1 ms over 1 s gives AC RMS 12 V, TV/s = 2·24·62.5 = 3000 V/s and reversals 125/s. A sine A·sin(2πft) gives AC RMS A/√2 and reversals 2f. A constant gives zeros.

**Why.** These pin down what each variant is for (reaching, robustness, chattering per variant) and keep the physics honest under the fastest switching the library produces.

### 8. Later, not in this change

- **Model-based sliding mode (equivalent control).** This is Slotine's û: switch only for what the model does not know.
  - Law: u = u0 + (â·ẏ + λ·ė)/b̂ + K·sw(s), with K ≥ (sup|w − ŵ| + η)/b̂_min.
  - â and b̂ are computed from the plant, so per [designs-in-the-page.md](../output/designs-in-the-page.md) they must not be stored. Make it a designed twin `slidingModeDesigned`. Its `design(p, ctx)` linearises the plant the block sees (cut at u, measurements [y, ẏ]) and fits the speed path with `firstOrderFit`: K_fit = 1.43 rad/s per V and τ = 0.06 s, so â = 1/τ = 16.7 1/s and b̂ = K_fit/τ = 23.8 rad/s² per V (my computation from V→ω = 0.5/(0.0002s² + 0.021s + 0.35)). Stored inputs stay λ, K and φ.
  - In simulation, K = 3 V with these values cut the relay's TV fourfold (3207 V against 13 980 V per run) and the copper loss while holding (0.6–1.45 s) from 7.5 to 0.4 W, still chattering at 71 Hz. With φ = 0.1 it was smooth.
  - A disturbance-observer form, with the Observer block in the diagram, is the visible-model version (Yang, Li & Yu 2013).
- **s as a controller signal.** `make()` may return `signals: { s: () => s }`, listed as `controller.s` (unit y/s). A PID could later expose its P, I and D the same way.
- **The motor in physical form, and a Product primitive.**
  - For the no-black-box task, rebuild Motor from Gain, Sum and Integrator blocks named R, 1/L, Ke, Kt, b and 1/J, so that every parameter appears once.
  - Add one primitive, **Product**: inputs per a string of `*` and `/` as in Simulink, y = Π u_k^(±1), passing straight through. With it, copper loss P_cu = i·(R·i), electrical power V·i and mechanical power Kt·i·ω become exact signals that follow every edit. The cart–pole rebuild needs it too (m·l·ω²·sin θ).
  - Prerequisite: the step bound must see loops through integrators. It is 0 today, and the armature at L/R = 0.3 ms then diverges. Estimate the fastest mode from the model's Jacobian at the start, for example its ∞-norm, which the design layer already computes by finite differences.
  - Until then, the example uses the Measure RMS of i for the heat. A Function `1*u^2` would hard-code R and go stale.
- **Measurement noise.** A Noise block (σ 0.2 rad/s) on the speed input shows that sliding modes need a clean ė; the boundary layer's gain K/φ = 6 V·s/rad amplifies it. Levant's robust differentiator (ż0 = −1.5·L^½·|z0 − y|^½·sign(z0 − y) + z1, ż1 = −1.1·L·sign(z0 − y)) is the matching observer, with an error of order ε^½ under noise ε (Levant 2003, 2007).
- **Another SMC example.** A spacecraft axis with on/off thrusters. It needs only a Gain 1/J and two Integrators. The law is the existing relay generalised from e to s, with hysteresis and a deadband, as NASA's phase-plane control. It shows the practical fix for actuators that cannot be smoothed: firings and propellant against the size of the limit cycle.
- **Defer:**
  - a sliding-mode observer in `observers.js`, until there is a PMSM plant;
  - a buck converter, which needs Product, an integrator with a lower limit and µs steps.
- **Metrics in the CLI.** metrics.js `saturation` counts v ≠ u, so the relay, whose K equals its limit, reads 0 % while it sits at ±12 V 95 % of the run. Add "time at a limit" (|u − umax| or |u − umin| below 1e-9 of the span).

## Pitfalls

- **Sign convention.** Loop Tuner uses e = r − y, so s = λe + ė and u = +K·sgn(s) for a plant whose y rises with u. Slotine and Levant write x̃ = y − r and u = −k·sgn(s); MathWorks writes e = x_d − x as here. With r held, ė = −ẏ, so the line in the e–speed plane has slope +λ.
- **Sliding must exist over the whole uncertainty range.** The condition is |u_eq| < U along the line: here |V_eq| = |(a − λ)·λ·e + d/J|/β < 12 V. It bounds λ against the weakest actuator authority (λ = 20 fails at J×3). The reaching condition ½·d(s²)/dt ≤ −η|s| gives t_reach ≤ |s(0)|/η only while it holds.
- **Invariance needs matching.** The disturbance must enter where u enters (Draženović 1969). With the armature, the load enters one integration after V, so even the relay keeps a small offset (5.5 mrad) and a relative-degree-2 chattering. Do not promise "exact rejection" for the relay on the full motor.
- **Chattering has two causes, and the fixes differ** (Utkin & Lee 2006).
  - Sampling: the switching cannot exceed 1/(2Ts). A layer of width β·K·Ts, the implicit discretisation, removes it.
  - Unmodelled fast dynamics: here the armature. The layer must also respect them (ζ above). Higher-order sliding modes do not remove this kind (Boiko & Fridman 2005; Utkin 2016).
- **A boundary layer is a PD inside the layer** (Kp = K·λ/φ, Kd = K/φ), bang-bang outside. It loses finite-time convergence and invariance: a constant load leaves φ·d_eq/(K·λ). Slotine & Li remark (iii): "there is no free lunch".
- **Super-twisting is not chattering-free with actuator dynamics.** Its gains are sized by the disturbance's rate bound L at the smallest input gain, and its v needs anti-windup. A load step is an impulse in ẇ: no L bounds it, so the load is rejected in finite time, not instantly.
- **Sliding modes need ė.**
  - A noisy speed feeds straight into u: K/φ for the boundary layer, k1/(2√|s|) near s = 0 for super-twisting.
  - A differentiated encoder adds quantisation and one sample of delay.
  - The PD here differentiates the angle through Tf, which is why noise on the speed input does not touch it.
- **A sampled relay locks to whole samples.** Its period is an integer number of Ts (16 here), so the chattering frequency moves in steps when λ, Ts or τ_a change. Harmonic balance (69 Hz) is a guide, not an exact prediction.
- **The XY readout depends on the window.** Over a window with reaching arcs, a falls to about 6.5. Start the window after reaching (0.4 s here); 0.1–0.15 s after a step is enough for this motor.
- **Kt and Ke are two separate Gain blocks.** In SI units they must be equal, or the motor creates or destroys energy. A person who edits one should edit the other. The physical rebuild (Recommendation 8) should share one parameter or say so in the block names.
- **The page record step and controller jitter** (Recommendation 6) quietly change every chattering number. Check any number for this example at a 1 ms record.
- **Integrator–gain loops have no step bound** (Recommendation 8). This is a physics-is-never-wrong issue for any primitive rebuild of a stiff plant.
- **Do not model Coulomb friction as Function `sign(u)`.** A stopped shaft would chatter numerically instead of sticking. Stiction needs its own primitive, for example Karnopp's model. It is not needed for this example.
- **Unverified from memory, not used for any number above:**
  - Utkin's discrete equivalent control as stated in Young, Utkin & Özgüner (1999): u(k) = u_eq(k) if |u_eq(k)| ≤ u0, else u0·u_eq(k)/|u_eq(k)|.
  - The attribution of the s/(|s| + δ) smoothing to Edwards & Spurgeon (1998).

## Sources

- Slotine & Li, Applied Nonlinear Control, Prentice Hall 1991, ch. 7 (scan): https://lewisgroup.uta.edu/ee5323/notes/Slotine%20and%20Li%20applied%20nonlinear%20control-%20bad%20quality.pdf
  - eq. 7.3: s = (d/dt + λ)^(n−1)·x̃;
  - eq. 7.5: sliding condition ½·d(s²)/dt ≤ −η|s|, giving t_reach ≤ |s(0)|/η;
  - §7.1.2: equivalent control;
  - eqs. 7.13–7.20: k = F + η; b̂ = √(b_min·b_max), β = √(b_max/b_min);
  - Example 7.2: "excellent tracking … at the price of high control chattering";
  - §7.1.4: PWM motors, switching beyond the unmodelled dynamics;
  - §7.2: boundary layer, ε = Φ/λ^(n−1), balance Φ̇ + λΦ = k, remark (iii) "no free lunch";
  - eqs. 7.41–7.43: λ ≤ (2π/3)·ν_R, λ ≤ 1/(3·T_A), λ ≤ ν_sampling/5;
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
- Gao, Wang & Homaifa, Discrete-time variable structure control systems, IEEE TIE 42(2), 1995 (s(k+1) − s(k) = −qT·s(k) − εT·sgn s(k); band εT/(2 − qT)): https://doi.org/10.1109/41.370376 ; band also in https://intechopen.com/chapters/71607
- Levant, Sliding order and sliding accuracy in sliding mode control, Int. J. Control 58(6), 1993: https://doi.org/10.1080/00207179308923053
- Levant, Higher-order sliding modes, differentiation and output-feedback control, Int. J. Control 76(9–10), 2003 (r-th-order accuracy O(τ^r); differentiator 1.5·L^½, 1.1·L): https://www.tau.ac.il/~levant/ijc_hosm_2003.pdf
- Levant, Principles of 2-sliding mode design, Automatica 43(4), 2007: https://www.tau.ac.il/~levant/levant_2sl_aut2007_pre.pdf
- Levant, Chattering analysis, IEEE TAC 55(6), 2010: https://doi.org/10.1109/TAC.2010.2041973
- Levant & Yu, Sliding-mode-based differentiation and filtering, IEEE TAC 2018 (equivalent control by low-pass filtering, eq. 15): https://www.tau.ac.il/~levant/Levant,Yu-SMbased_filtering,IEEETAC,2018.pdf
- Seeber & Andritsch, Proper implicit discretization of the super-twisting controller, without and with actuator saturation, Automatica 173:112027, 2025 (verified: continuous law eq. 6; explicit form eq. 13; conditions eq. 15 k1 > √(k2 + L), k2 > L; conditioned law eq. 18 and conditions eq. 19; |x| ≤ L·T² after finite time; "best possible worst-case performance"): https://arxiv.org/abs/2406.16094 ; https://arxiv.org/html/2406.16094
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
- Tan, Lai, Cheung & Tse, On the practical design of a sliding mode voltage controlled buck converter, IEEE TPEL 20(2), 2005 (S = α·x1 + x2, hysteresis κ, fS = Vo(1 − Vo/Vi)/(2κL)): https://ira.lib.polyu.edu.hk/bitstream/10397/704/1/practical-design_05.pdf
- Tan, Lai & Tse, General design issues of sliding-mode controllers in DC–DC converters, IEEE TIE 55(3):1160–1174, 2008 ("SM control is still rarely applied in practical dc–dc converters"; variable frequency, EMI, filters, no ICs; PWM-based SMC with d = u_eq): https://ira.lib.polyu.edu.hk/bitstream/10397/692/1/general-design_08.pdf
- TI LM3485 hysteretic buck controller (10 mV hysteresis, no oscillator): https://www.ti.com/document-viewer/LM3485/datasheet
- NASA MSFC, phase-plane attitude control with deadband and Schmitt-trigger hysteresis against thruster chattering: https://ntrs.nasa.gov/api/citations/20160001829/downloads/20160001829.pdf ; https://ntrs.nasa.gov/api/citations/20160001840/downloads/20160001840.pdf
- TI motor-driver guidance on audible switching: https://www.ti.com/document-viewer/lit/html/SLVAES8
- PicoScope measurements (AC RMS, edge count with hysteresis): https://manuals.picotech.com/picoscope6/en/scope_measurements.html
- Repository: /home/user/ctrl/src/core/plants.js (motorDiagram), /home/user/ctrl/src/core/controllers.js, /home/user/ctrl/src/core/diagram.js (step bound, controller sampling), /home/user/ctrl/src/core/sim.js (simulateSystem), /home/user/ctrl/src/core/project.js (defaultSampleTime, simOf), /home/user/ctrl/src/core/systems.js (applySystem, VARIANT_TAGS), /home/user/ctrl/src/core/metrics.js, /home/user/ctrl/src/ui/xyview.js (lineFit), /home/user/ctrl/design/output/instrument.md, /home/user/ctrl/design/output/designs-in-the-page.md
- Checks run for this synthesis (scratch, not in the repository), in /tmp/claude-0/-home-user-ctrl/281fed85-1c0b-52ae-b29a-1fd26dd76401/scratchpad/smc-synth/:
  - harness.mjs: the motor diagram with Sinks e and i, and the laws as specified above;
  - table.mjs and final.mjs: Recommendation 4 and the other conditions;
  - sweep1.mjs: boundary-layer widths;
  - sweep2.mjs, sweep4.mjs and stcond.mjs: super-twisting gains and anti-windup;
  - lam20.mjs: λ = 20;
  - jitter.mjs: controller sample instants;
  - physmotor.mjs: step bound of an integrator armature;
  - df.mjs: harmonic balance;
  - tests.mjs and energy.mjs: reaching formula and energy balance.
- Earlier sweep scripts, superseded by the above where they disagree: /tmp/claude-0/-home-user-ctrl/281fed85-1c0b-52ae-b29a-1fd26dd76401/scratchpad/smc-classic/sim/, /tmp/claude-0/-home-user-ctrl/281fed85-1c0b-52ae-b29a-1fd26dd76401/scratchpad/sim/smc*.mjs, /tmp/claude-0/-home-user-ctrl/281fed85-1c0b-52ae-b29a-1fd26dd76401/scratchpad/smc/, /tmp/claude-0/-home-user-ctrl/281fed85-1c0b-52ae-b29a-1fd26dd76401/scratchpad/smc_motor.mjs
