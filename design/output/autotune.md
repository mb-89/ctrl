# Tab 4: Auto-tune

Reader: whoever changes the auto-tuner, its methods or the tab. **Status: built 2026-10-24.** The person's words are in [../input/2026-10-24-09-analysis-autotune-triple-swingup.md](../input/2026-10-24-09-analysis-autotune-triple-swingup.md): "one system library element that's maybe badly tuned by default, and then we can use the autotuner to tune it better. And then you would see that over a number of iterations, the tuning parameters improve the behavior … research what common auto-tuning strategies are and put them in there."

**The tab improves the running variant of one Controller block by simulating the loop, and puts the result into a variant of its own, so the original stays to compare.** Three methods, each a textbook one. Every number is computed in the page from the plant and the goal when Start is pressed: nothing plant-specific is stored (the person: "it should be computable in principle").

Code: `src/core/autotune.js` (no DOM; runs in Node for the tests), `src/ui/autotune.js` (the tab). Tests: `test/autotune.test.mjs`. Example: **Oven, badly tuned** in the System library opens on this tab.

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

Settings in the tab: cost type (IAE, ITAE, ISE), effort weight (default 0.05), overshoot bound (default 10 %). They belong to the page session, not the project file (yet).

## Iterate: Nelder–Mead

- **What it turns**, as log factors on the variant's own values (x = 0 is the variant as it is; ln 2 doubles a gain), bounded to ×1/1000 … ×1000. Signs never flip; a gain at 0 stays off, because the structure is the person's choice. PID: Kp, Ki, Kd. Gain-scheduled PI: the Kp table and the Ki table, each scaled as a whole. State feedback: each gain in K and the prefilter kr. Off, swing-up and relay say why they cannot be tuned.
- **The search**: Nelder–Mead simplex (reflect, expand, contract, shrink) from a simplex of steps ln 2; one iteration per step of the page, about **six per second** so a person can watch (**Fast** runs as fast as the browser can). When the simplex collapses it restarts around the best point with smaller steps, twice at most. It stops after the maximum number of iterations (60) or when 15 iterations have not lowered the cost by 0.1 %. Deterministic: the same project gives the same gains.
- On the oven it takes the cost from 1.28 to 0.12 (×0.09) in about 37 iterations: the ringing goes, overshoot falls from 42 % to the 10 % bound. The motor's aggressive P goes from Kp 30 to 6 (×0.09).

## Relay: Åström–Hägglund

1. **Operating point**: r0 in the middle of r's range, held constant; every other Source (d) at 0. The running variant holds r0 first; the u it needs there is the bias u0.
2. **Relay**: the controller is replaced by a relay, u = u0 ± d, switching when e passes ±ε. d is a fraction of the actuator range (default 10 %), ε is 0.1 % of r's span. The relay is kept inside the limits, so it is symmetric about u0.
3. **Bias correction**: if the relay is not high half the time, u0 becomes the mean of u over the last cycle and the test runs again (up to six times); if it never switches, u0 moves by d.
4. **Read the cycle**: the run grows (×4, up to 16 input periods) until it holds four cycles. Pu is the mean period of the last cycles; a is the amplitude of the fundamental of y over the last cycle (a Fourier coefficient: the describing function assumes a sine); **Ku = 4d / (π √(a² − ε²))**, the describing function of a relay with hysteresis (Åström & Hägglund, *PID Controllers: Theory, Design, and Tuning*, 1995).
5. **Rule** (Ti = Kp/Ki, Td = Kd/Kp):

| Rule | Kp | Ti | Td | Character |
|---|---|---|---|---|
| Ziegler–Nichols (1942) | 0.6 Ku | Pu / 2 | Pu / 8 | Fast, about a quarter decay; overshoots |
| Tyreus–Luyben (1992) | Ku / 2.2 (≈ 0.45 Ku) | 2.2 Pu | Pu / 6.3 | Calmer, more robust (the default) |
| No overshoot | 0.2 Ku | Pu / 2 | Pu / 3 | Gentle; the row usually tabulated with Ziegler–Nichols. Despite its name it overshoots on integrating plants (the motor: 44 %) |

The new PID keeps the running variant's limits, start output, setpoint weight and prefilter; its derivative is filtered at Td/10.

**When it cannot run, it says why**: a block with more than one measurement (state feedback: use Iterate); the bias at an actuator limit; the relay never switched; too few cycles (a slow plant: lengthen the input's period); an oscillation no larger than the hysteresis (an integrator or first-order lag alone has no ultimate point); a diverging run (unstable without its controller). Drift, an unsettled cycle and asymmetry are noted with the result.

**Accuracy**: the describing function is an approximation. For K/(s+1)³ with K = 8 (Ku = 1, Pu = 2π/√3 ≈ 3.63 s) the test finds Ku within 6 % and Pu within 3 % (about 0.95 and 3.72 s at Ts = 10 ms: the relay cycle sits slightly off the −180° point, and sampling adds half a sample of delay).

## Step response: SIMC

The controller is replaced by a constant u0 (what the running variant needs at r0), and in a second run by u0 + Δu (default 10 % of the range). **Their difference is the plant's step response from the same start**, so the start transient cancels (exact for a linear plant). Smith's two-point method fits a first order plus dead time from the times at 28.3 % and 63.2 % of the change: K = Δy∞/Δu, τ = 1.5 (t63 − t28), θ = t63 − τ. SIMC (Skogestad 2003): Kp = τ / (K (τc + θ)), Ti = min(τ, 4 (τc + θ)), with τc = θ ("tight" control; at least τ/10 when there is almost no dead time); θ includes half a controller sample. A PI (Kd = 0). It needs a plant that settles on its own: an integrating one (the motor) is refused with that reason.

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

The rules give a sound loop in one experiment; the optimiser, which knows the goal, does best on it.

## The tab

Four columns: **Controller** (the block, if several; the running variant and its gains; where the result goes), **Method** (Iterate, Relay, Step response, with their settings and a sentence on each), **Goal** (cost type, effort weight, overshoot bound, what the cost is), **Progress** (Start/Stop, Fast, status, a cost-against-iteration plot, and before → after: cost, overshoot, gains, Ku and Pu or K, τ, θ).

- **Results go into a variant of their own**: "<original> · auto-tuned" for Iterate, "· relay T–L" (or Z–N, no overshoot) and "· SIMC" for the others, after the original in the block's variant list, and it runs. Interpretation: one name per method, so the rules can be compared by flipping variants in the Controller tab. Tuning again from a tuned variant updates it in place.
- **Watching**: while iterating, the display stops sweeping and shows each whole run; each improvement replaces it and the run before fades (the display's five-run memory). The cost plot (dark, log scale) shows the best cost so far (green) and every run tried (blue dots). The relay and step tests sweep their experiment across the display in real time (Fast: at once), then show the result.
- **At the end** the display holds the run it started from, faded, against the result, and the run mode is restored. A toast gives the cost ratio.
- **One undo step for a whole run**: Ctrl+Z restores the project as it was before Start.
- **Stop** keeps the best gains found so far (Iterate) or applies nothing (experiments). Loading another system or undoing during a run stops it.

## How the core reads a loop

`compileDiagram` adds, for every Controller block, probes under its id path: `ctrl.r` (input 1), `ctrl.y` (input 2), `ctrl.u` (output); inside a subsystem `motor/ctrl.u`. A signal name never has a dot, so no scope channel lists them. `tuneContext` copies the plant and runs variants on the copy (`withVariant`), never touching the project.

## Not yet

- The goal saved in the project file; tuning several blocks together; flipping through a block's variants to pick the best structure.
- A robustness check: score the result against plant variations (±20–50 % of uncertain parameters).
- AMIGO and Cohen–Coon rules; a noise-aware relay (hysteresis from the measured noise).
- The CLI and `window.loopTuner` do not offer auto-tune yet (v1's `tune` command still tunes v1 candidates).
- With an external plant (HIL), iterating needs real runs; iterative feedback tuning or extremum seeking fit that case.
