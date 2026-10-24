# Tab 4: Auto-tune

Reader: whoever changes the auto-tuner, its methods or the tab. **Status: built 2026-10-24; revised the same day after a review** (the goal is locked during a run, experiments always hand the scope back, work runs in slices, reverse-acting plants, result naming, the command line). The person's words are in [../input/2026-10-24-09-analysis-autotune-triple-swingup.md](../input/2026-10-24-09-analysis-autotune-triple-swingup.md): "one system library element that's maybe badly tuned by default, and then we can use the autotuner to tune it better. And then you would see that over a number of iterations, the tuning parameters improve the behavior … research what common auto-tuning strategies are and put them in there." Background research: [../research/autotune.md](../research/autotune.md).

**The tab improves the running variant of one Controller block by simulating the loop, and puts the result into a variant of its own, so the original stays to compare.** Three methods, each a textbook one. Every number is computed in the page from the plant and the goal when Start is pressed: nothing plant-specific is stored (the person: "it should be computable in principle").

Code: `src/core/autotune.js` (no DOM; runs in Node for the tests and the command line), `src/ui/autotune.js` (the tab). Tests: `test/autotune.test.mjs`. Example: **Oven, badly tuned** in the System library opens on this tab.

## Strategies: what exists, what is here

| Family | Well-known members | Here |
|---|---|---|
| Optimise a performance index by simulation | Minimise IAE, ITAE or ISE of the error over a test run, with a derivative-free search such as Nelder–Mead (1965) | **Iterate** |
| Relay feedback, then ultimate-cycle rules | Åström & Hägglund (1984) relay auto-tuner, as in industrial controllers' "autotune"; rules by Ziegler & Nichols (1942), Tyreus & Luyben (1992), and the "no overshoot" row of the Ziegler–Nichols tables | **Relay** |
| Step test (process reaction curve), then model-based rules | Ziegler–Nichols open loop (1942), Cohen–Coon (1953), IMC-PID (Rivera, Morari & Skogestad 1986), SIMC (Skogestad 2003), AMIGO (Åström & Hägglund 2004) | **Step response** (SIMC) |
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
- **Pacing: the header's Speed** ([instrument.md](instrument.md#speed)). Every method is a generator that yields after **each run of the loop**, also inside an iteration (a shrink runs the loop n times), and says how much time that run simulated. At a finite speed **every run Iterate tries sweeps across the display at that speed**, as a run on a real plant would take its time: a 5 s run takes 5 s at 1×, 0.5 s at 10×, 50 s at 0.1×. At **∞** it computes as fast as it can, in slices of about 30 ms of computing between frames, so the page keeps drawing, and the readout beside Speed shows the simulated seconds it computes per second. An improvement (its gains into the project, the page redrawn) and the next run are separate tasks. The person: "the fast toggle of the autotune, that would go away. If I want to autotune fast, then I just set the toggle to higher speeds" ([input 10](../input/2026-10-24-10-sliding-mode-and-triple-swingup.md)); the **Fast** switch is gone. On the oven (77 runs of 5 s) 10× took 47 s (8× achieved) and ∞ 2–3 s; at 1× the runs alone take 6½ minutes (measurements in [instrument.md](instrument.md#speed)).
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

The controller is replaced by a constant u0 (what the running variant needs at r0), and in a second run by u0 + Δu (default 10 % of the range). **Their difference is the plant's step response from the same start**, so the start transient cancels (exact for a linear plant). If it has not settled within one period of the input, both run once more, four periods long; still not settled, the test refuses (an integrating plant, such as the motor, or a very slow one). Smith's two-point method fits a first order plus dead time from the times at 28.3 % and 63.2 % of the change: K = Δy∞/Δu, τ = 1.5 (t63 − t28), θ = t63 − τ. SIMC (Skogestad 2003): Kp = τ / (K (τc + θ)), Ti = min(τ, 4 (τc + θ)), with τc = θ ("tight" control; at least τ/10 when there is almost no dead time); θ includes half a controller sample. A PI (Kd = 0).

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

Four columns: **Controller** (the block, if several; the running variant and its gains; where the result goes, or in red why it cannot run), **Method** (Iterate, Relay, Step response, with their settings), **Goal** (cost type, effort weight, overshoot bound), **Progress** (Start/Stop, status, a cost-against-iteration plot, and before → after: cost, overshoot, gains, Ku and Pu or K, τ, θ). How fast it runs is the header's Speed, not a setting of the tab. One short line per column; what a method or the cost is lives in tooltips and the help dialog (?). When the columns stack (narrow screens), Progress with Start comes first.

- **Results go into a variant of their own**: "<original> · auto-tuned" for Iterate, "· relay T–L" (or Z–N, no overshoot) and "· SIMC" for the others, after the original in the block's variant list. Interpretation: one name per method, so the rules can be compared by flipping variants in the Controller tab. **An earlier result is never overwritten**: running a method again from the original makes "… · auto-tuned 2". Tuning again from a result updates that result in place (the target line says "Updates …").
- **Iterate** creates its variant at the first improvement (none if nothing improves) and runs it; each better set of gains replaces it.
- **A relay or step result that scores worse than the running variant is added but does not run**: the status says so with the cost ratio, and the original keeps running (flip to the result in the Controller tab to see it).
- **Watching**: at a finite speed each run Iterate tries sweeps across the display (as a Single), the best runs so far faded behind it (the display's five-run memory); when the sweep ends, a better run becomes the best (its gains go into the result variant) and the next run sweeps. The status says which run and iteration is on the display and at what speed. At ∞ the display stands still and shows each improvement whole, the run before fading, as fast as they come. The cost plot (dark, log scale) shows the best cost so far (green) and every run tried (blue dots). The relay and step tests compute first, as fast as they can (the status counts the runs; they are not shown), then **sweep their experiment across the display at the Speed, labelled as the experiment** in the status (the relay shows its last period, where the cycle has settled; at ∞ at once), hold it 0.4 s, and then the loop's own run comes back, **whether or not the experiment gave a result**; the result's numbers appear after the sweep. Interpretation: the person's "set the toggle to higher speeds" read as: each run is shown at the speed (so 1× is a run in real time, like tuning a real plant), while the experiments' preparatory runs are computed first, as before.
- **At the end** the display holds the loop's run, with the run it started from faded behind a new result, and the run mode is restored. A toast gives the cost ratio.
- **One undo step for a whole run**: Ctrl+Z restores the project as it was before Start, and the progress column forgets a result that undo removed.
- **Stop** keeps the best gains found so far (Iterate) or applies nothing (experiments). Loading another system or undoing during a run stops it.

## How the core reads a loop

`compileDiagram` adds, for every Controller block (not Observer blocks), probes under its id path: `ctrl.r` (input 1), `ctrl.y` (input 2), `ctrl.u` (output); inside a subsystem `motor/ctrl.u`. A signal name never has a dot, so no scope channel lists them. `tuneContext` checks that inputs 1 and 2 are wired (else: "wire the measurement y to input 2"), copies the plant and runs variants on the copy (`withVariant`), never touching the project.

**Auto Scale** uses the probes too (`loopOverlays`): the channels that show a Controller block's r and the y it compares with r (the same values), in one unit, share one scale and offset, so they overlay; nothing else is grouped, and XY mode is left alone. Interpretation: without it the oven's r showed at 10 °C/div and T at 20, and T seemed never to reach r. The person has not seen this yet.

## For agents

- `node cli.mjs autotune <project> [--block ctrl] [--method iterate|relay|step] [--rule tl|zn|calm] [--cost IAE|ITAE|ISE] [--effort 0.05] [--overshoot 10] [--iterations 60] [--amplitude 10] [--save] [--json]`: the same core, the same numbers as the tab; `--save` puts the result into the block as a variant of its own (running if it scores better).
- In the page, `window.loopTuner.autotune({ block, method, goal, rule, amplitude, maxIter, apply })` runs a method at once and returns the same report as `--json`; applied (the default), it is one undo step.

## Not yet

- The goal saved in the project file; tuning several blocks together; flipping through a block's variants to pick the best structure.
- A robustness check: score the result against plant variations (±20–50 % of uncertain parameters).
- AMIGO and Cohen–Coon rules; phase-margin placement from the relay's measured point; a noise-aware relay (hysteresis from the measured noise).
- One simulation is still one task: a long experiment on a heavy plant (the encoder example's four-period step test, about 0.35 s) holds the page that long. A Worker would remove it.
- With an external plant (HIL), iterating needs real runs; iterative feedback tuning or extremum seeking fit that case.
