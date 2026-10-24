# Tab 4: Auto-tune

Reader: whoever changes the auto-tuner, its methods or the tab. **Status: built 2026-10-24; revised the same day after a review** (the goal is locked during a run, experiments always hand the scope back, work runs in slices, reverse-acting plants, result naming, the command line), **and again for the step method** (integrating plants such as the DC motor, ripple, a schedule per point, why a result scores worse; see *Step response*). The person's words are in [../input/2026-10-24-09-analysis-autotune-triple-swingup.md](../input/2026-10-24-09-analysis-autotune-triple-swingup.md): "one system library element that's maybe badly tuned by default, and then we can use the autotuner to tune it better. And then you would see that over a number of iterations, the tuning parameters improve the behavior … research what common auto-tuning strategies are and put them in there." Background research: [../research/autotune.md](../research/autotune.md).

**The tab improves the running variant of one Controller block by simulating the loop, and puts the result into a variant of its own, so the original stays to compare.** Three methods, each a textbook one. Every number is computed in the page from the plant and the goal when Start is pressed: nothing plant-specific is stored (the person: "it should be computable in principle").

Code: `src/core/autotune.js` (no DOM; runs in Node for the tests and the command line), `src/ui/autotune.js` (the tab). Tests: `test/autotune.test.mjs`. Example: **Oven, badly tuned** in the System library opens on this tab.

## Strategies: what exists, what is here

| Family | Well-known members | Here |
|---|---|---|
| Optimise a performance index by simulation | Minimise IAE, ITAE or ISE of the error over a test run, with a derivative-free search such as Nelder–Mead (1965) | **Iterate** |
| Relay feedback, then ultimate-cycle rules | Åström & Hägglund (1984) relay auto-tuner, as in industrial controllers' "autotune"; rules by Ziegler & Nichols (1942), Tyreus & Luyben (1992), and the "no overshoot" row of the Ziegler–Nichols tables | **Relay** |
| Step test (process reaction curve), then model-based rules | Ziegler–Nichols open loop (1942), Cohen–Coon (1953), IMC-PID (Rivera, Morari & Skogestad 1986), SIMC (Skogestad 2003), AMIGO (Åström & Hägglund 2004) | **Step response** (SIMC, for plants that settle and plants that integrate) |
| Iterate on the real plant | Iterative feedback tuning (Hjalmarsson et al. 1998), extremum seeking | Later, with a real (HIL) plant |
| Adaptive control | Self-tuning regulators, model-reference adaptive control | Not planned |

Interpretation: the person asked for "common auto-tuning strategies"; these three cover the three families an engineer meets first (optimisation, relay, step test), and the first one is the "over a number of iterations" the person described.

## The goal: the cost of one run

The tuner runs the loop over **one period of the input** (every reference step and disturbance in it; the screen may be zoomed elsewhere), sampled as the display samples it. It reads the block's own signals: r (input 1), y (input 2) and u. The cost J, smaller is better, is a plain number:

| Part | Formula |
|---|---|
| Error | IAE: mean \|e\|/R; ITAE: mean (τ/T̄)·\|e\|/R; ISE: mean (e/R)². e = r − y; R the span of r (or the largest error when r does not move); τ the time since the last reference step, T̄ the mean time between steps |
| Effort | weight × mean (u − ū)² / U²: the swing of u about its mean; U the actuator range (or the swing of u in the starting run when there are no limits) |
| Overshoot | 2 × Σ over reference steps of the overshoot beyond the bound (as a fraction of the step), measured until the next step or until another input (d) jumps |
| Saturation | 0.2 × the fraction of the time u sits at a limit |

- The **disturbance d plays in the run**, so rejecting it counts in the error.
- A run that **diverges** costs 100–200 (the earlier, the more), a large but finite number, so the search can still find its way back.
- Interpretation: the brief said effort = mean(u²). That counts the power needed to hold a setpoint (an oven at 60 °C needs 60 %), which no tuning can change; the swing about the mean is what a tuner can change. And the recovery from a disturbance is not counted as a step's overshoot: it pushed the optimiser to a weak integral.
- **The goal is fixed for a run**: it is copied when Start is pressed (the core copies it too), and the tab's goal, method and option controls are locked until the run ends. Changing the cost under a running search would compare costs of two different goals.

Settings in the tab: cost type (IAE, ITAE, ISE), effort weight (default 0.05), overshoot bound (default 10 %). They belong to the page session, not the project file (yet).

## Iterate: Nelder–Mead

- **What it turns**, as log factors on the variant's own values (x = 0 is the variant as it is; ln 2 doubles a gain), bounded to ×1/1000 … ×1000. Signs never flip; a gain at 0 stays off, because the structure is the person's choice. PID: Kp, Ki, Kd. Gain-scheduled PI: the Kp table and the Ki table, each scaled as a whole. State feedback: each gain in K and the prefilter kr. Off, swing-up and relay say why they cannot be tuned.
- **The search**: Nelder–Mead simplex (reflect, expand, contract, shrink) from a simplex of steps ln 2. When the simplex collapses it restarts around the best point with smaller steps, twice at most. It stops after the maximum number of iterations (60) or when 15 iterations have not lowered the cost by 0.1 %. Deterministic: the same project gives the same gains.
- **Pacing**: the page shows one iteration at a time, about **six per second**, so a person can watch (**Fast** runs as fast as the browser can). Every method is a generator that yields after **each run of the loop**, also inside an iteration (a shrink runs the loop n times), and the tab computes in slices of about 30 ms between frames, so the page keeps drawing: on the triple pendulum (9 gains, 25 ms per run) the longest task is under 90 ms.
- On the oven it takes the cost from 1.28 to 0.12 (×0.09) in about 37 iterations: the ringing goes, overshoot falls from 42 % to the 10 % bound. The motor's aggressive P goes from Kp 30 to 6 (×0.09).

## Relay: Åström–Hägglund

1. **Operating point**: the Source that feeds r is found back along the wires, through gains, lags and subsystem ports, and held at the middle of its own range; every other Source (d) is held at 0; **r0 is the r this gives** (read from the run). The running variant holds r0 first; the u it needs there is the bias u0. Without such a Source (r made from several signals) the experiment runs with the inputs as they are and says the estimate is rough.
2. **Direction**: a short open-loop step (u held at u0 and at u0 ± d) shows which way y goes. If y falls when u rises (a reverse-acting plant), the relay is reversed (negative d), Ku comes out negative and so do the gains, as they must.
3. **Relay**: the controller is replaced by a relay, u = u0 ± d, switching when e passes ±ε. d is a fraction of the actuator range (default 10 %; the range is the variant's limits, else the swing of u in its own run; with neither, the test refuses and asks for limits); ε is 0.1 % of r's span. The relay is kept inside the limits, so it is symmetric about u0; with less than a tenth of the asked swing left, the bias is at a limit and the test refuses.
4. **Bias correction**: if the relay is not high half the time, u0 becomes the mean of u over the last cycle and the test runs again (up to six times); if it never switches, u0 moves by d.
5. **Read the cycle**: the run grows (×4, up to 16 input periods) until it holds four cycles. Pu is the mean period of the last cycles; a is the amplitude of the fundamental of y over the last cycle (a Fourier coefficient: the describing function assumes a sine); **Ku = 4d / (π √(a² − ε²))**, the describing function of a relay with hysteresis (Åström & Hägglund, *PID Controllers: Theory, Design, and Tuning*, 1995).
6. **Rule** (Ti = Kp/Ki, Td = Kd/Kp):

| Rule | Kp | Ti | Td | Character |
|---|---|---|---|---|
| Ziegler–Nichols (1942) | 0.6 Ku | Pu / 2 | Pu / 8 | Fast, about a quarter decay; overshoots |
| Tyreus–Luyben (1992) | Ku / 2.2 (≈ 0.45 Ku) | 2.2 Pu | Pu / 6.3 | Calmer, more robust (the default) |
| No overshoot | 0.2 Ku | Pu / 2 | Pu / 3 | Gentle; the row usually tabulated with Ziegler–Nichols. Despite its name it overshoots on integrating plants (the motor: 44 %) |

The new PID keeps the running variant's limits, start output, setpoint weight and prefilter; its derivative is filtered at Td/10.

**When it cannot run, it says why**: a block with more than one measurement (state feedback: use Iterate); an input not wired; no actuator range; the bias at an actuator limit; the relay never switched; too few cycles (a slow plant: lengthen the input's period); an oscillation no larger than the hysteresis (an integrator or first-order lag alone has no ultimate point); a diverging run (unstable without its controller). Drift, an unsettled cycle, asymmetry and a reduced amplitude are noted with the result.

**Accuracy**: the describing function is an approximation (the research notes give −19 % … +27 % on Ku depending on the plant). For K/(s+1)³ with K = 8 (Ku = 1, Pu = 2π/√3 ≈ 3.63 s) the test finds Ku within 6 % and Pu within 3 % (about 0.95 and 3.72 s at Ts = 10 ms: the relay cycle sits slightly off the −180° point, and sampling adds half a sample of delay); with K = −8 it finds Ku ≈ −0.94.

## Step response: SIMC

Revised 2026-10-24 after the person found it did nothing on the DC motor ([input](../input/2026-10-24-10-sliding-mode-and-triple-swingup.md): "the step response tuning on the DC motor doesn't seem to work at all"). It refused there because the motor's angle never settles: it integrates the speed. It now handles integrating plants, reads through ripple, and builds a gain schedule.

**The experiment.** r's Source is held at the middle of its range, as for the relay, and the running variant holds r0 **until y has settled** (2 % of how far it moved, or of r's span; y averaged over its ripple, below). Then the controller is replaced by a constant: u0 in one run (what the variant needed at r0), u0 + Δu in a second (default 10 % of the range; upwards if there is room). **Their difference dy, from the switch on, is the plant's step response from that state** (exact for a linear plant; for a nonlinear one it starts where the loop works). A variant that keeps swinging at r0 (the badly tuned oven sits in a limit cycle) cannot hand over a plant at rest; the test then starts at t = 0 from the plant's own start, and the notes say it is exact only for a linear plant. Interpretation: before, the test always started at t = 0, which on the conical tank stepped from 0.15 m and overflowed the tank; holding r first tests the plant where the loop works.

**How far y may move.** Half of r's span (r0 is its middle): a step that would move y further is made smaller (to 80 % of what fits, at least halved; three times at most), and the notes say so. Interpretation: the test should stay in the range the loop works in; a large step on a nonlinear plant fits an average of several operating points (the tank's fixed PI gave θ = 0 that way).

**Settled, robustly.** dy has settled when, **averaged over the period of its ripple**, it stays within 2 % of the size of the response for the last fifth of the record. The ripple's period is the slowest strong periodic part of the last 40 % of the record (Hann-windowed spectrum, trend removed; peaks at least a quarter of the largest, six periods or more in the stretch; none when the largest is under 0.2 % of the response). The average is taken twice (a triangle two periods long), so the ripple's harmonics drop out too. Steady ripple and noise count as settled; their amplitude (half the peak-to-peak about the average) goes into the notes. Interpretation: the encoder example's step response carries ±10.7 rad/s of encoder error (17 % of the 64 rad/s step), 1× and 2× at two speeds and the shaft resonance; a raw 2 % band never passed, so the test refused although the speed follows V with a time constant of 0.07 s.

**A ramp: an integrating plant.** If dy does not settle but **its slope does** (the secant over the ripple period, and over at least 2 % of the record, stays within 2 % of its final value for the last fifth, and that slope accounts for at least half of how far y went), the plant integrates. **The test then ends once the slope is steady**: the record is cut where the last fifth of it lies on the steady slope, or earlier where y would leave its bound, so the plant does not run away; the display shows the cut run and the notes say when it ended and how far y moved ("the test ended 0.257 s after the step … y moved by 0.678 rad (it may move 1 rad, half of r's span)"). Before, the test ran four periods and refused (the motor turned 68 rad). A ramp that leaves its bound before its slope settles makes the step smaller, as above.

**Models.**

| Response | Model | Fit |
|---|---|---|
| Settles | First order plus dead time, K e^(−θs)/(τs + 1) | Smith's two-point method on dy averaged over its ripple period (without lag): K = Δy∞/Δu, τ = 1.5 (t63 − t28), θ = t63 − τ. If that θ is less than half the time y takes to move 2 %, θ is that time and τ = t63 − θ (interpretation: a response that is no first order, such as the tank stepped far, gave θ = 0, which no plant with a pipe has) |
| Ramps | Integrator with lag and dead time, k' e^(−θs)/(s (τ2 s + 1)) | The least-squares line through the last fifth gives the slope k'·Δu (k' per unit of u) and, where it crosses the start level, the apparent dead time L = θ + τ2 (the asymptote's intercept). τ2 is the lag in [0, L] that fits the whole response best (least squares: a scan, then golden section); θ = L − τ2 |

On a known plant, 2 e^(−0.3s)/(s (0.2s + 1)), the test finds k' 1.98, L 0.488 s, θ 0.307 s, τ2 0.18 s (k' and θ within 2.5 %). On the motor it finds k' 1.41 rad/s per V (the motor's 0.5 · 10 / (1 + 0.5 · 0.5 · 10) = 1.43), τ2 45 ms, θ 13 ms (its speed has two lags, 48 ms and 12 ms: armature and mechanics coupled by the back-EMF).

**SIMC rules** (Skogestad 2003, *Simple analytic rules for model reduction and PID controller tuning*, J. Process Control 13: 291–309, Table 1, checked against the paper). θ includes half a controller sample (Ts/2), the delay a digital controller adds.

| Model | Kc (series) | τI | τD |
|---|---|---|---|
| First order plus dead time | τ / (K (τc + θ)) | min(τ, 4 (τc + θ)) | – |
| Integrating | 1 / (k' (τc + θ)) | 4 (τc + θ) | – |
| Integrating with lag | 1 / (k' (τc + θ)) | 4 (τc + θ) | τ2 |

The PID is in Skogestad's series form; this code's PID is parallel, so (his eq. 36) Kp = Kc (1 + τD/τI), Ki = Kc/τI, Kd = Kc τD. Check: his example after eq. 38 (series Kc 0.5, τI 1, τD 1 is ideal Kc' 1, τI' 2, τD' 0.5) is a test. **The derivative is used when the lag is longer than the dead time** (τ2 > θ: Skogestad recommends PID "for processes with dominant second order dynamics (with τ2 > θ, approximately)"); otherwise a PI, with half of τ2 counted as dead time (his half rule). The derivative is filtered at Td/10 as for the relay's PID. A first order plus dead time gives a PI, as before.

**τc, the one knob**, offered in the tab as **Tight** (τc = θ, Skogestad's rule "for fast response with good robustness") or **Smooth** (τc = 3θ). Skogestad gives only "τc > θ" for smooth control (smoother input, less noise sensitivity, more robustness); **the factor 3 is ours** (interpretation). Two floors, both ours, on the θ that sets τc (not on the θ in the gain): at least τ/10 (almost no dead time, as before) and **at least the ripple's period** when y ripples, so the loop does not chase the ripple (interpretation: on the encoder, τc = τ/10 = 6.7 ms gave Kp 0.9, which keeps u at its limits a quarter of the time and scores ×7.2 of the running PI; τc = 42.5 ms, the ripple's period, gives Kp 0.21 and ×0.93). The notes say when the ripple set τc.

**Two integrators overshoot.** With a PI on an integrating plant, the integral of r − y after a step in r must come back to zero, so y overshoots. When it overshoots beyond the goal's bound, one more run tries the result with a prefilter Tr = τI on r (it cancels the PI's zero; Skogestad: "the setpoint response can always be modified by introducing a 'feedforward' filter on the setpoint") and the notes say what it would give ("Smooth" on the motor: 11.6 % → 0.8 %, cost ×0.89). The prefilter is not set: on *Following a sine* it would lag the sine (cost ×8).

**A gain-scheduled PI gets a schedule.** When the running variant is a gain-scheduled PI, the step test runs **at each of its points** (the table's y values): the running variant holds r there first (four periods when y has not settled in one; r's Source is set to the target, and once more on the line through the operating point when r is not the Source's own value), then the step. Each step goes **toward the middle of the table** (the first test, nearest the middle, steps u up and tells which way y goes) and **may move y half the way to the next point**, so each model is local. Each point gets SIMC PI gains (a gain-scheduled PI has no derivative); a point whose test fails takes the nearest working point's gains, and the notes say why. **u0**, the PI's integral part at the start, is the trim at the start level: what the running variant needs to hold y where the plant starts. One result variant, "· SIMC", with the same table points, prefilter and limits. On the tank the points 0.1 … 0.75 m give K 1.57 … 3.8 and τ 0.055 … 1.6 s, as the tank widens; at 1 m the tank is full and overflows, so y does not respond, and the point takes 0.75 m's gains; u0 = 0.172 = a √(2 g · 0.15 m).

## The step method on the library

`node cli.mjs autotune <system> --method step` (Tight), the same goal as below. Before: main at `a4eec40`; after: this revision.

| System (running variant) | Before | After |
|---|---|---|
| DC motor, position control (P, too aggressive: 1.27, 24 %) | refused: "has not settled in four periods" | ramps: k' 1.41, τ2 45 ms, θ 13 ms; SIMC PID Kp 26.6, Ki 143, Kd 0.91: **0.122 (×0.096), 6 %** |
| Following a sine (P: 0.087) | refused, the same | the same model: **0.0068 (×0.078)** |
| Encoder errors and torque ripple (PI speed: 0.0159) | refused, the same | K 6.69 rad/s per V, τ 67 ms, θ 4 ms, ripple ±10.7 rad/s; PI Kp 0.21, Ki 3.2: **0.0148 (×0.93)** |
| Conical tank, gain scheduling (scheduled PI: 0.085, 7.6 %) | one PI Kp 4.81, Ki 18.9 from a step at 0.475 m that overflowed: 1.96 (×23), 74 % | a schedule from four step tests: 0.139 (×1.6), 12 %; added, not run: "it overshoots 12.3 % (the goal allows 10 %; Gain-scheduled PI: 7.61 %)" |
| Conical tank, "PI tuned for full" running (0.78, 45 %) | one PI from a step from 0.15 m that overflowed: 2.97 (×3.8), 101 % | one PI from a step at 0.475 m, Δu made smaller: **0.079 (×0.10)** |
| Conical tank, "PI tuned for empty" running (0.96, 45 %) | the same kind: 3.83 (×4.0), 142 % | 0.36 (×0.38); it keeps swinging at r0, so the test starts at t = 0 |
| Oven, badly tuned (1.28, 42 %) | K 1.0, τ 0.52 s, θ 0.24 s: 0.152 (×0.12) | the same |
| Pendulum swing-up, Triple pendulum | refused: several measurements | the same |

Smooth on the same systems: motor 0.254 (×0.20), sine 0.018 (×0.21), encoder 0.029 (×1.8: slower than the running PI), tank 0.112 (×1.3), oven 0.246 (×0.19).

On the scheduled tank SIMC's integral times (τI = 4 (τc + θ) where that is shorter than τ, for disturbances) overshoot the reference steps more than the hand-designed schedule (pole cancellation for a 0.25 s loop); Iterate improves that schedule instead (×0.85).

## What the methods give on the oven

The default goal (IAE, effort 0.05, overshoot ≤ 10 %) scores every result the same way, so the methods can be compared:

| Variant | Cost | Overshoot |
|---|---|---|
| PID, badly tuned (Kp 6, Ki 12, Kd 0.1) | 1.28 | 42 % |
| Iterate (37 iterations: Kp 3.17, Ki 6.57, Kd 0.36) | 0.12 (×0.09) | 9 % |
| Relay, Ziegler–Nichols (Ku 5.0, Pu 0.86 s) | 0.20 | 14 % |
| Relay, Tyreus–Luyben | 0.17 | 0 % |
| Relay, no overshoot | 0.22 | 14 % |
| Step response, SIMC (K 1.0, τ 0.52 s, θ 0.24 s) | 0.15 | 5 % |

The rules give a sound loop in one experiment; the optimiser, which knows the goal, does best on it. A rule can also do worse than what runs: on the conical tank a relay rule's fixed PID costs ×3.6 the gain-scheduled PI it would replace.

## The tab

Four columns: **Controller** (the block, if several; the running variant and its gains; where the result goes, or in red why it cannot run), **Method** (Iterate, Relay, Step response, with their settings: the relay's rule; the step's SIMC τc, Tight or Smooth; the size of the relay or step), **Goal** (cost type, effort weight, overshoot bound), **Progress** (Start/Stop, Fast, status, a cost-against-iteration plot, and before → after: cost, overshoot, gains, Ku and Pu, or the step test's model: K, τ, θ, or k′, τ2, θ, or one row per point of a schedule, and Tight or Smooth). One short line per column; what a method or the cost is lives in tooltips and the help dialog (?). When the columns stack (narrow screens), Progress with Start comes first.

- **Results go into a variant of their own**: "<original> · auto-tuned" for Iterate, "· relay T–L" (or Z–N, no overshoot) and "· SIMC" (or "· SIMC smooth") for the others, after the original in the block's variant list. Interpretation: one name per method, so the rules can be compared by flipping variants in the Controller tab. **An earlier result is never overwritten**: running a method again from the original makes "… · auto-tuned 2". Tuning again from a result updates that result in place (the target line says "Updates …").
- **Iterate** creates its variant at the first improvement (none if nothing improves) and runs it; each better set of gains replaces it.
- **A relay or step result that scores worse than the running variant is added but does not run**: the status says so with the cost ratio and **why, in plain words, as far as it can be known**, and the original keeps running (flip to the result in the Controller tab to see it). Why: first what the result cannot do that the running variant does ("one PID from a relay test at h = 0.475 m; Gain-scheduled PI changes its gains with h (Kp 0.113 … 3.14), which a single PID cannot"; a PI where the running PID has a derivative), that the experiment's estimate was rough, that y's ripple passes through Kp into u (when that moves u by 5 % of its range or more); then the part of the cost that grew most ("it overshoots 19.4 % (the goal allows 10 %; Gain-scheduled PI: 7.61 %)", "r − y is larger (IAE ×2.22)", u swings more, u sits at a limit). The command line and `--json` (`worse`) say the same. Interpretation: before, the person was told only the cost ratio; we say what is measured or structural, never a guess about the plant (a relay test at one level cannot tell that the tank's gain changes with the level, so the text does not claim it).
- **Watching**: while iterating, the display stops sweeping and shows each whole run; each improvement replaces it and the run before fades (the display's five-run memory). The cost plot (dark, log scale) shows the best cost so far (green) and every run tried (blue dots). The relay and step tests compute first (the status counts the runs), then **sweep their experiment across the display, labelled as the experiment** in the status (the relay shows its last period, where the cycle has settled; the step test from a tenth of a period before the step, with the hold and the step in words; Fast: at once), and then the loop's own run comes back, **whether or not the experiment gave a result**; the result's numbers appear after the sweep.
- **At the end** the display holds the loop's run, with the run it started from faded behind a new result, and the run mode is restored. A toast gives the cost ratio.
- **One undo step for a whole run**: Ctrl+Z restores the project as it was before Start, and the progress column forgets a result that undo removed.
- **Stop** keeps the best gains found so far (Iterate) or applies nothing (experiments). Loading another system or undoing during a run stops it.

## How the core reads a loop

`compileDiagram` adds, for every Controller block (not Observer blocks), probes under its id path: `ctrl.r` (input 1), `ctrl.y` (input 2), `ctrl.u` (output); inside a subsystem `motor/ctrl.u`. A signal name never has a dot, so no scope channel lists them. `tuneContext` checks that inputs 1 and 2 are wired (else: "wire the measurement y to input 2"), copies the plant and runs variants on the copy (`withVariant`), never touching the project.

**Auto Scale** uses the probes too (`loopOverlays`): the channels that show a Controller block's r and the y it compares with r (the same values), in one unit, share one scale and offset, so they overlay; nothing else is grouped, and XY mode is left alone. Interpretation: without it the oven's r showed at 10 °C/div and T at 20, and T seemed never to reach r. The person has not seen this yet.

## For agents

- `node cli.mjs autotune <project> [--block ctrl] [--method iterate|relay|step] [--rule tl|zn|calm] [--simc tight|smooth] [--cost IAE|ITAE|ISE] [--effort 0.05] [--overshoot 10] [--iterations 60] [--amplitude 10] [--save] [--json]`: the same core, the same numbers as the tab; `--save` puts the result into the block as a variant of its own (running if it scores better).
- In the page, `window.loopTuner.autotune({ block, method, goal, rule, simc, amplitude, maxIter, apply })` runs a method at once and returns the same report as `--json`; applied (the default), it is one undo step.

## Not yet

- The goal saved in the project file; tuning several blocks together; flipping through a block's variants to pick the best structure.
- A robustness check: score the result against plant variations (±20–50 % of uncertain parameters).
- AMIGO and Cohen–Coon rules; phase-margin placement from the relay's measured point; a noise-aware relay (hysteresis from the measured noise).
- The step method: a PID for plants that settle (a second-order fit and SIMC's τD = τ2); a least-squares fit over the whole response for strongly nonlinear plants; telling a ripple that is a real disturbance (to reject) from measurement error (to ignore): today either sets τc's floor.
- One simulation is still one task: a long experiment on a heavy plant (a run of the encoder example's step test, its hold and one period, up to 0.2 s) holds the page that long. A Worker would remove it.
- With an external plant (HIL), iterating needs real runs; iterative feedback tuning or extremum seeking fit that case.
