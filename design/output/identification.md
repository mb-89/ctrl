# Identify: finding the plant by experiment

Reader: whoever builds the Identify tab, its experiment or its fits, or changes how Auto-tune and Analysis use an identified model. **Status: designed 2026-10-24; being built on branch `feat/identify` in the steps of §18 (done: 0, the record; 2, the numerics in `src/core/fit.js`).** It is the synthesis of a design panel run on 2026-10-24: two proposals (E1, staged experiments then a model; E2, tuning on the plant by experiment), each prototyped in plain JS on the HIL arm's physics, and two judges (a tester's view and a safety view) who re-ran the prototypes. Research and sources: [../research/identification.md](../research/identification.md). Where the code and this plan differ later, the code and [decisions.md](decisions.md) win.

The person's words ([input 10](../input/2026-10-24-10-sliding-mode-and-triple-swingup.md)):

- "Maybe between controller and autotune we have an identification, and I guess then the autotune should also work for hill systems … after controller, before autotune and analysis would come identification … identify the plant that we have modeled actually … we don't know what plant the hill is running … the other side doesn't know it, so we have to identify it."
- "do some research on how you would probably identify this … I wonder if there's something more modern."
- The decision: "it will be experiment first. Like, you can ask some general questions about the system, but really the expectation is the system saves itself … you can start with slow control efforts and then increase this over time … the responsibility of … keeping the system safe is with the plant … somebody's using the system who has no idea of control theory. He doesn't know if this thing is integrating or not … we can have limits on the control effort, and we can have limits on the actual values and reference values … you ease into it and you do it via experiment … he's not going to give you a model. He's not going to give you a gray box."

> **Amended after the panel (the person, 2026-10-24):** the "click into it" rule is for the models we build; an identified model of a real system may be a black box. "If we identify an external system, I can accept that it's black box … if we build a neural network that maps the behavior well, then that's also fine … Obviously preferred is understanding the structure, but if we don't, we don't." So the structured fits stay first, and when none explains the data well enough the tab may offer a black-box model (the kernel model already computed as the reference, or later a neural state-space model) for Auto-tune and Analysis, labelled as such. The sections below that reject black-box models for that reason are superseded on this point.

## 0. Bottom line: what the person sees and does

- **A new tab, Identify**, between Controller and Auto-tune: Input, Plant, Controller, **Identify**, Auto-tune, Analysis ([tabs.md](tabs.md)). It works the same on a simulated plant and on a HIL plant.
- **The tester, who knows no control theory, does three things.**
  1. Reads what the page already knows: "V may go −12 … 12 V, starts at 0 V (from the plant)", "angle never beyond −2.5 … 2.5 rad (from the plant)", "r runs 0 … 1.5 rad".
  2. Confirms two prefilled lines in plain words: "angle may move within [−0.5] … [2.0] rad" and "the test may take [2 min ▾]".
  3. Presses **Start**.
- **The page then runs one automatic test that eases in**, in six stages shown as chips:
  - **Listen**: u held still for 3 s; the page measures the noise and any drift.
  - **Nudge**: tiny open-loop pushes, back and forth, each a little larger or longer than the last, only while the previous one stayed well inside the room.
  - **Hold**: a deliberately gentle controller, built from what the Nudge showed, takes over and brings y to where the tester's reference starts.
  - **Ease in**: the tester's own reference is played again and again, each try asking the controller to be 30 % quicker, disturbances held off, until a try rings, comes near the edge or stops improving.
  - **Shake** (only when the model is unsure): a seeded mix of tones added to u while the gentle loop holds y, at the low and the high end of the reference.
  - **Check**: a test the model has not seen, its prediction drawn on the scope first, the measurement sweeping over it.

  Two meters show **push** (|u − u₀| as % of u's range, the person's "normalised control effort") and **room used**; a status line says in words what is happening; the scope sweeps each try. On the HIL arm this takes about 45 s of plant time without the Shake, and up to about 2 min with it.
- **The plant stays the safety authority**: it clamps, has its watchdog and E-stops, and, new, E-stops when an output leaves the range it declares. The page only eases in and backs off. **Stop** is soft (the excitation ends, the data so far is kept); the red **E-STOP** stays the hard stop.
- **What comes out:**
  - three to six plain sentences, for example: "Responds after 2 ms. Swings at about 1 Hz and settles in about 1.5 s. 1 V more gives 0.53 ± 0.02 rad more. Behaves differently at different places: near 0.1 rad, 1 V moves it 0.5 rad; near 1.4 rad, 6.8 rad. Explains 77 % of a test it was not fitted to !";
  - the model as a clickable chain of blocks (gain, lags or a resonance, an integrator, a dead time), each with ± and a tooltip that says what it means;
  - the candidates the page tried, each with its fit on the Check;
  - the Check plot (measured against predicted);
  - the gentlest controller that held, proven on the plant ("· eased in").
- **Then Auto-tune and Analysis use the model.**
  - Auto-tune's runs (the person's "92 runs") go to the identified model, labelled "on the model".
  - On HIL one key, **Try on the plant**, hands the result over in three checked steps. A prediction monitor falls back to the proven controller by itself if the plant does not behave as predicted.
  - Analysis draws its numbers and plots for the identified model, with ranges for what the model is unsure of.
- **Stored only on Keep**: the measured record (u, y, r, the experiment's log and settings), like a saved trace. The model is always recomputed from it, giving the same numbers. **Copy as blocks** freezes a model into My blocks, and only by explicit choice.
- **On simulated plants**, the same test runs on the simulation, and two teaching aids come with it:
  - **Compare with the diagram** shows the identified model against the diagram's true linearisation.
  - **Hide a variation** (±15 %, seeded) makes a simulated plant as unknown as the HIL one, and reveals afterwards what was drawn.

## 1. The panel, and what this design takes from each proposal

| | Tester judge | Safety judge | Verdict |
|---|---|---|---|
| E1: staged experiments at rest (Listen, Nudge, a multisine Shake, Check), then a model | 5/10 | 7/10 | The best structure and explanation layer; its default test identifies the wrong plant on the arm |
| E2: an eased-in closed-loop ladder, in its recommended form (the ladder is the experiment, a model is fitted from its record, Auto-tune runs on the model, one verify goes to the plant) | 7/10 | 6/10 (≈7 in the recommended form) | The right experiment, measured end to end; a thin account of what was found |

**The winner is E2 in its recommended form**: its ladder is the experiment, because it is the person's "start with slow control efforts and then increase this over time" taken literally, and it was the only test measured end to end. Both judges arrived at the same graft: E2's experiment inside E1's architecture and explanation layer.

**Taken from E2:**
- the gentle closed loop built from the Nudge (SIMC with a slow τc and the robust Ti = 4(τc + θ));
- the ladder that asks for 30 % quicker per try, on the tester's own reference, with disturbances held off;
- the plain-word margin ("room kept", "ringing") and its stop rules;
- the measured evidence: oven, motor, tank and five ±15 % arms, every result safe, within 2–25 % of the best possible cost;
- the E-stop rules;
- "On the plant", but only as an opt-in fallback.

**Taken from E1:**
- the architecture: one deterministic state machine running as a hidden controller law (the same code in simulation, the live worker and Node), and the model as a pure function of the record;
- the explanation layer: sentences with ± ranges, the clickable chain, stage chips, the push and room meters, status lines, the overview strip, scope references;
- the Check predicted before it runs;
- the Nudge's growth rule;
- the Size plot, extended to a **Where** plot;
- the multisine with detection lines, now ridden on the gentle loop and run only when needed;
- refusal sentences, the table of what is known without asking, Compare with the diagram;
- Try on the plant with a prediction monitor;
- the 2 min default.

**Taken from the safety judge's list ("needed by both, missing from both"):**
- output ranges in `describe` and an output-range E-stop in `hil_plant.py`, built first;
- the plant echoes the u it applied;
- gaps in `seq` handled;
- a runaway ends with the plant's `stop`;
- distortion overrides χ²;
- the twin sits in the plant's place in the diagram, with a test push at its input;
- the hand-over runs in screened steps.

**Dropped, with the reason measured:**

| Dropped | Why |
|---|---|
| E1's question "Test at rest / around r" | A control question the tester cannot answer, and its default (rest) is the wrong plant on the arm: the table below |
| E1's Shake at rest as the main test | The arm's Coulomb friction (0.01 N·m ≈ 0.2 V) dominates at the amplitudes a rest test can use. At 0.15 V and 0.25 V peak the fits came out ζ 22 and ζ 11, and χ²/dof 0.25–0.32 marked them good |
| E1's band default (reference range ± 10 %) | It allows only 0.15 rad below rest, which keeps every test in the friction regime. Replaced by ± a third of the span (E2) |
| E2's fixed amplitude schedule (1, 2, 5, 10, 20, 50 % of the range) | Jumps of up to ×2.5 with only a reactive guard; on the arm 2.1–2.4 V (9–10 % of ±12 V) sends it over the top |
| E2's compass search on the plant as the way to tune | 22–43 trials, 3–5 min, 5–9 margin crossings and 1–3 soft aborts per arm run; J scattered 0.056–0.29 |
| IFT, SafeOpt, safe-UCB | IFT's gradient experiments left the band on the integrating motor; the GP methods stopped expanding on the arm after 3–4 trials; a GP is a box the tester cannot open |

**Why "where" matters (the arm, from `hil/hil_plant.py`, nominal):**

| | At rest (0 rad) | At r = 1.5 rad |
|---|---|---|
| Gravity stiffness mgl·cos θ | 0.1 N·m/rad | 0.007 N·m/rad |
| Gain (rad/V) | 0.50 | 7.07 |
| Swing frequency | 1.0 Hz | 0.27 Hz |
| Damping ζ (viscous and back-EMF) | 0.22 | 0.83 |
| Voltage to hold | 0 V | about 2 V |

A model taken at rest is not the plant the loop runs at. The ladder follows the tester's reference, so it visits the places of use without anyone being asked.

## 2. What is known, what is asked, what is never asked

| Known without asking | From |
|---|---|
| u's name and unit | The External port the block's output drives (`inputs[i].name`, `unit`); on a simulated plant, the block's output label and the unit of the Sink that shows it |
| u's range | The variant's `umin`/`umax`, intersected with the External port's `min`/`max`. With neither, Identify refuses: "set u min and u max in the Controller tab: Identify needs to know how far V may go" |
| u's start value u₀ | HIL: the port's `safe` value. Simulated: 0, clamped into the range |
| y's name and unit | The block's input 2 (`blockInputNames`), the Sink's or External port's unit |
| y's hard range | **New, optional**: `outputs[].min/max` in `describe`; the plant E-stops beyond it (§15). Simulated plants have none unless the tester types one |
| The reference range | Min and max over one period of the Source that feeds r (`upstreamSource`) |
| The sample time | The Controller block's Ts; on HIL, the block samples at its Ts on the plant's clock |
| The other inputs (d, load) | Held at 0 (simulated) or at their safe values (HIL) for the whole test |

**Asked, in plain words, one line each, both prefilled:**

1. **"angle may move within [lo] … [hi] rad"**: the comfortable band.
   - Default: the reference range widened by a third of its span on each side. It is clipped to the hard range shrunk by 5 % of that range's span, so the page backs off before the plant E-stops. For the HIL arm, r runs 0 … 1.5 rad, so the default is −0.5 … 2.0 rad.
   - When r does not move, the default is r₀ ± 10 % of the hard range.
   - When there is neither a reference span nor a hard range, the line is required: "the page knows no range for angle: say how far it may move".
   - A grey note says where the default came from (from r's range, from the plant, or yours).
   - The line turns red with a sentence when the reference leaves the band.
2. **"the test may take [2 min ▾]"**: plant time, with choices of 30 s, 1, 2, 5 and 10 min.

On a simulated plant there is also **Hide a variation** (off by default; §13). With several Controller blocks, a chooser picks one.

**Never asked:** whether the plant integrates; its delay, gain, order or time constants; where it should sit during the test; a model of any kind, grey or black. **Start** is the "may it move now?".

## 3. Data flow

```
Identify tab ── settings (design inputs) ──► knownFor(project, path) + planExperiment(known, settings) → Plan (data)
                                                  │
     simulated: createStepRunner on a copy        │        HIL: the live worker runs the same copy
     (the block runs the hidden law                │        (the plant sends y, the worker answers u,
      { type: 'experiment', params: { plan } };    │         posts state ≤ 10 Hz and the record in chunks)
      the r Source plays exp.reference(k);         │
      other Sources hold 0)                        ▼
             createExperiment(plan): a causal state machine, u = f(y so far)
             Listen → Nudge → rest (first look) → Hold → Ease in ×n → fit pause* → [Shake → fit pause*] → Check → end
                     * the experiment holds y while the page fits and supplies the prediction
                                                  │ record: u, y, r, applied, gaps, log (stages, rungs, tries, laws, seed)
                                                  ▼
             identifySteps(record): segments → structures by closed-loop replay (LM) → kernel reference
                                    → Check grade → where / size → [FRF, distortion] → IdentifiedModel
                                                  │
         ┌───────────────────────┬────────────────┴───────────┬──────────────────────────────┐
         ▼                       ▼                            ▼                              ▼
   Model column, plots    Keep → project              Auto-tune: twinDiagram()        Analysis: plant source
   (+ the diagram's true  system.identify[path]       → Iterate, Relay, Step          'identified' → model.lin
   linearisation and the  .kept[] (the record only)   "on the model"                  (a LinearModel)
   hidden variation on                                → Try on the plant (HIL)
   simulated plants)
```

- **The experiment is a pure function of the plan and the y it receives.**
- **The model is a pure function of the record.**
- Both run in Node, for the tests and the CLI.

## 4. The tab: what the tester sees and clicks

It has the same frame as Auto-tune: four columns, one short line each, with details in tooltips and the help dialog (?). On narrow screens the Experiment column (with Start) comes first.

It uses only the existing semantic styles (task #15):
- one selected state for keys;
- the marks ✓, ! and ✕, never colour alone;
- the Controller tab's readout for numbers;
- the channel colours of u and y for the meters.

There are no new colours.

**1. What we know**
- The block chooser, only if there are several Controller blocks.
- "V → angle · Ts 10 ms".
- "V may go −12 … 12 V · starts at 0 V (from the plant)", drawn as a small range bar with the start value marked.
- "angle never beyond −2.5 … 2.5 rad (from the plant)", or a field "never beyond [ ] … [ ]" with "don't know" allowed.
- "r runs 0 … 1.5 rad (Input tab)".
- "angle may move within [−0.5] … [2.0] rad", with the grey source note.
- "The test may take [2 min ▾]".
- Simulated only: "Hide a variation [off ▾]".
- In red, when it cannot run, why ({ code, message, hint }, as Auto-tune does). For example:
  - "wire the measurement to input 2";
  - "Identify is for a block with one measurement (r, y): this one has 4";
  - "connect the plant first";
  - "the plant is E-stopped: Reset";
  - "this plant takes references (reference mode): identifying through its own controller comes later";
  - "r leaves 'may move within' (r reaches 1.5, the band ends at 1.2)".

**2. Experiment**
- **Start** and **Stop**.
- Stage chips: Listen · Nudge · Hold · Ease in · Shake · Check. The current stage is lit, done ones show ✓, and skipped ones show –.
- Two level meters:
  - **push**: |u − u₀| as % of u's range, with the largest so far;
  - **room used**: how much of the room y may still use has been used (§5.4). Each meter has two marks: where easing in stops, and where the page backs off.
- A status line in plain words, for example:
  - "Nudge 6: pushing ±0.96 V (4 % of the range) for 0.16 s; angle moved 0.08 rad (16 % of its room)";
  - "Ease in, try 3: asking the controller to be 30 % quicker than the last good one".
- Try chips, one per try:
  - ✓ quicker;
  - · no better;
  - ! rang;
  - ! near the edge;
  - ✕ left the range, back to the last good one;
  - ✕ the plant stopped itself.
- "Plant time 0:48 of 2:00".
- After the run, an **overview strip** of the whole record: u and y with stage bands. Clicking a stage shows that part of the record on the scope.

**3. Model**
- Three to six sentences (§8) and the grade with its reason.
- The chosen model as a clickable chain: In → K 0.53 ± 0.02 rad/V → e^(−0.002 s) → f 0.96 ± 0.02 Hz, ζ 0.74 ± 0.05 → Out. Each block's tooltip says what it means ("ζ: how quickly a swing dies out; 0.7 swings once, 0.1 rings for a long time").
- The candidates, simplest first. Each shows a chain glyph ("gain · resonance · dead time"), its fit % on the Check and its mark. The chosen one is lit, with the reason ("the simplest within 1 point of the best"). Clicking another uses it instead; that choice is saved as `structure` (a design input).
- The eased-in controller: "The gentlest controller that held: PI, Kp …, Ti …" with **Add as variant** ("<name> · eased in", a hand PI like Auto-tune's results).
- Keys:
  - **Keep** (one undo step; stores the record);
  - **Use for Auto-tune and Analysis** (simulated plants; on HIL the identified model is always used);
  - **Copy as blocks**;
  - **Check again** (§14).
- "Not kept: Keep saves it with the project" while the run is unkept.

**4. Check** (small plots in the scope's dark style, `ui/plots.js`; one key row picks the plot):
- **Check** (the default): the Check's measured y against the model's prediction and its 2σ band, with the reference. This is the plot a tester reads first.
- **Bode**:
  - the model line with a 2σ band from 50 parameter samples;
  - when the Shake ran, the measured points at the excited lines with ±2σ bars, and grey ticks for the distortion level;
  - on simulated plants with Compare on, the diagram's true linearisation, dashed.
- **Step**: the model's step response with its band (and the diagram's, dashed, when comparing).
- **Where**: the gain and the main time scale at each place the test sat, with bars, and the u it needed to hold each place. This is where "behaves differently at different places" is seen.
- **Size**: the apparent gain against push size from the Nudge rungs; with a Shake, the share that is not linear.
- **More** (one click deep, for those who want it): the residuals' autocorrelation and their cross-correlation with past u, with the 99 % band; χ²/dof per candidate; the kernel estimate (§6.8) as a dotted curve on the Step and Bode plots.

**The scope during the run**
- It shows whatever its channels show. If no channel shows the block's y or u, Start puts them on channels 3 and 4, as part of the run's single undo step.
- Listen and Nudge sweep as usual.
- In Hold, Ease in, Shake and Check, **each try starts a new sweep**, as Run does. The sweep before fades (the five-run memory), so tries are seen getting tighter. The stage name is written small at the left of each sweep.
- A try ended by the soft guard ends with a red tick and "back to the last good controller".
- The header status reads `IDENTIFY · ease in 3 · push 22 % · room 31 %`.
- Pacing:
  - HIL runs at 1×.
  - Simulated plants run at the header's speed (task #16); until that exists, at 1× with a Fast switch, as Auto-tune does now.

**After the run**
- The record shows as a dashed reference.
- The model's replay of it shows as a second reference, "angle · model", through the existing references (`record.reference`). Stepping the scope through the record then shows measured against model.
- On HIL the page sends `stop`. The status says "Done. The plant is stopped; Run starts it again with the controller."
- On simulated plants the loop's own run comes back, as after Auto-tune's experiments.

## 5. The experiment

**One causal state machine, `createExperiment(plan)`.** Each controller sample it reads the block's measurement y (and, when the plant echoes it, the u applied in the cycle before) and returns u. It also says which reference the r Source plays at that sample.

**Where it runs.** It runs as the law of a hidden variant type, `experiment` (params `{ plan }`), in a copy of the diagram. So the same code runs:
- in simulation, through `createStepRunner`;
- in the live worker, which receives the plan as data, not code;
- in Node tests.

**Determinism.** There is no clock and no randomness, except the multisine, which is seeded from the plan.

**Heavy work.** Light work happens inside the law, sliced by work units (LM iterations), never by time, so results do not depend on the machine. Heavy work (the fits) never runs inside the law: the experiment holds y and asks for it (§5.5).

Notation:
- U = umax − umin;
- u₀ = the start value;
- y₀ = the Listen mean;
- band = [lo, hi];
- room up = hi − y₀ and room down = y₀ − lo; rMin = the smaller of the two;
- floor = the noise floor from Listen;
- τc, θ = the gentle loop's closed-loop time and the dead time.

### 5.1 Listen (3 s, at least 100 samples)

- u = u₀. On HIL, Start sends `start` first.
- It measures:
  - σ = std(Δy)/√2, which is robust to drift;
  - the quantisation step q, the common nonzero |Δy| when the values sit on a grid (the arm's encoder gives 2π/4096 ≈ 1.5 mrad);
  - floor = max(σ, q/√12);
  - the drift slope, by least squares;
  - on HIL, gaps in `seq`.
- y outside the band: Identify refuses, "angle is at 2.3 rad, outside 'may move within': widen it, or bring the plant inside first".
- **Drift is noted, not refused.**
  - "angle does not stay put with V at 0 V (it moves 0.02 rad/s)".
  - The slope is subtracted from each Nudge rung.
  - The Nudge may then last at most until the drift would use a quarter of the room, so the Hold takes over sooner.
  - If the drift would use half the room before one rung can be read: "angle drifts too fast to test: it needs a controller first" (later: test under the running variant, §19).

### 5.2 Nudge: growing doublets (E1's rule; at most 40 % of the budget)

**Rung shape.**
- A doublet: +a for T, −a for T, then u₀ for 2T. Its net area is zero, so an integrating plant comes back.
- When u₀ sits at an actuator limit (a heater at 0 %), the rung is a pulse instead: +a for T, then u₀ for 3T.
- The first half pushes toward the side with more room.

**Start.** a = 1 % of U, T = 2·Ts.

**Measured per rung:**
- the excursions up and down;
- the growth exponent p during the push, from y(T)/y(T/2), clamped to [1, 3]. It is 2 at short times for a mechanical plant (acceleration) and 1 for a lag or an integrator;
- whether the push reached a plateau (last-quarter change under 10 %);
- whether it reached a constant slope (successive quarter increments within 25 %);
- ringing (zero crossings about the final value);
- whether it **runs away**: |y − y₀| still growing through the rest phase, beyond 1.5× the push peak.

**Next rung.**
- While the response is not complete, double T.
- While it is not even visible (under 20·floor), alternate doubling T with doubling a.
- Once it is complete, double a.
- A move is allowed only if both hold:
  - growth × 1.5 × max(up, down) ≤ 0.5 · rMin, where growth is 2 for a and 2^p for T;
  - a ≤ 0.5 · min(umax − u₀, u₀ − umin), unless u₀ sits at a limit.
- If neither move is allowed, the Nudge ends.

**Back-off.** If a rung uses 80 % of the room on its side, it ends at once: u = u₀, and the rung is marked.

**Runaway.** The page sends `stop` on HIL (on simulated plants the run ends) and says: "angle runs away when pushed and does not come back: it needs a stabilising controller before it can be identified." Holding u₀ does not stop an unstable plant; the plant's own stop is the authority.

**No response.** At a = 50 % of the half-range and T = 20 s, nothing rose above 5·floor: "V does not move angle: is V wired to the plant?"

**The Nudge ends when:**
- the response is complete and above max(20·floor, 20 % of rMin);
- or no move is allowed;
- or it has used 40 % of the budget;
- or T would pass 20 s.

**First look.** A 1 s rest at u₀ follows the Nudge, during which a small least-squares fit runs in work-unit slices:
- the sign;
- the dead time θ;
- the class: settles, ramps (integrates), rings;
- either FOPDT K and τ, or integrator k′ and θ.

**Measured** (E1's prototype, 50 arms at ±15 %, 1 mrad noise, a 4096-count encoder, band −0.5 … 2.0 rad, re-run for this design): largest excursion +0.18 / −0.14 rad, longest Nudge 3.4 s, no back-off, last push 0.96–1.92 V. With E1's narrower band (−0.15 … 1.65 rad): 0.062 rad and 2.6 s.

### 5.3 Hold: the gentle controller (E2)

**The law.** A PI with clamps and anti-windup, from the first look, by SIMC with a deliberately slow closed-loop time:
- τc₀ = 2(τ + θ) when the plant settles, 3(θ + τ) when it integrates;
- Kp = τ / (K (τc + θ)), or Kp = 1 / (k′ (τc + θ)) for an integrator;
- **Ti = 4(τc + θ) always.** This is SIMC's robust branch. The plain Ti = τ made the "gentle" PI ring at 40 % on the tank at 0.8 m, where the tank is 28× slower than where it was nudged.
- The sign follows the first look, so a reverse-acting plant gets negative gains.

**Takeover.** The integral is set so that the first u equals the current u (bumpless). The setpoint is r(0) of the test reference.

**Settled** means |y − r(0)| < max(3σ, 1 % of the band's span, 2q) for 0.5 s. If it does not settle within 4(τc + θ) + 2 s, τc is doubled once. If it still does not settle: `stop`, "the gentle controller does not hold angle at 0 rad".

**This first closed loop has no fallback**, so its guard is the hardest the page has: if y leaves the band, u = u₀ (the safe value) and the page sends `stop`, with a sentence.

### 5.4 Ease in: the ladder (E2)

**A try:**
1. The incumbent (at first, the Hold's PI) brings y to r(0) and holds it until settled (0.5–4 s).
2. A bumpless switch to the candidate: the same PI form with τc × 0.7.
3. One period of the **test reference**.
4. A bumpless switch back.

The switches happen inside the one law, so nothing is rebuilt. Today, flipping a variant live rebuilds the diagram and restarts the controllers ([hil.md](hil.md)).

**The test reference** is the tester's r over one period, with every other input held. If r moves by less than 10 % of the band's span, a staircase is played instead: r₀ → r₀ + ¼ of the band's span (toward the side with more room) → r₀, each level held 5(τc₀ + θ).

**Scoring a try:**
- J is Auto-tune's cost of the try (the default goal: IAE, effort 0.05, overshoot 10 %; `runCost`).
- The margin is g = min(g_room, g_ring). In plain words, "room kept" and "ringing":
  - g_room = the smallest distance from y to the band's edge during the try, divided by the distance r itself keeps from that edge;
  - g_ring = 1 − (the third half-wave of e after each reference step) / (20 % of the step), with windows cut where another input jumps.
- **room used** (the meter) = 1 − g_room.

**Accepting.** A try is accepted when g ≥ 0.3 and J improves. The best accepted try becomes the incumbent.

**Soft guard.** If y leaves the band, the incumbent takes over at once (bumpless), the try is ✕ with g = −0.1, and the ladder ends. The plant's clamp, watchdog and E-stop stay the hard authority.

**The ladder stops on the first of:**
- g < 0.3;
- a soft guard;
- two tries without 3 % improvement;
- τc below θ/2;
- 12 tries;
- the budget left cannot hold another try plus the fit pause and the Check.

**Measured (E2's prototype; J is scored noise-free on the true plant):**

| Plant | Tries | Plant time | Best J of the ladder | Left the band |
|---|---|---|---|---|
| Oven (σ 0.1 °C) | 8 | 96 s | 0.216 | never |
| Motor, integrating (encoder) | 5 | 62 s | 0.397 | never |
| Conical tank, nonlinear (σ 2 mm) | 6 | 56 s | 0.167 | never |
| HIL arm, five ±15 % plants | 2–3 | 24–35 s | 0.32–0.42 | never |

With the tester's d left on, the gentle loop left the band on the tank and came within 5 % of the edge on the arm. That is why every other input is held during the test.

### 5.5 Fit pause

- After the ladder, the incumbent holds y at r(0) while the page fits (§6) and supplies the Check's prediction.
- In simulation and in Node the pause is a fixed 2 s and the fit is supplied synchronously, so the record is deterministic.
- On HIL the pause lasts at least 2 s and until the page supplies the fit. The log notes how long it took; after 30 s the test ends with "the page could not fit in time".
- A second pause follows the Shake.

### 5.6 Shake (only when needed)

**It runs only when** the ladder's model is graded ! or ✕ (§7) and the budget has room for it. Otherwise the status says "a closer look needs about 40 s more: allow 5 min".

**Where.** It runs at two places, the low and the high end of the test reference. At each, the incumbent settles, and then a multisine s(k) is added to its output: u = C(r − y) + s.

**Amplitude.** The target peak is half the largest |u − u_hold| the incumbent used on the reference steps of its accepted try: the u swing the controller will really use.
- It eases in over three transient periods at ¼, ½ and 1 × the target, each raised only while the period before used no more than 50 % of the room at that place.
- Then four measured periods follow at the target.
- A band exit stops the excitation at once, the incumbent holds, and the Shake ends.

**The signal** is a random-phase odd multisine with detection lines, seeded:
- Period: N samples, the smallest power of two with N·Ts ≥ max(2 × the incumbent's settling time, 256·Ts), and at most 8192.
- Lines:
  - odd harmonics of f₀ = 1/(N·Ts), from f₀ up to min(0.4/Ts, 10/(2π(τc + θ)));
  - at most about 60 lines, log-spaced;
  - in each group of three consecutive odd candidates, one is left out at random (an odd detection line);
  - even lines are left out.
- The crest factor is lowered by 20 fixed clip-and-restore iterations.

**Gaps.** A period with a `seq` gap or a guard event is dropped and repeated once. The DFT is never computed across a gap.

**Cost.** On the arm, N = 256–512 (2.6–5.1 s), so 2 places × 7 periods come to about 36–72 s: on the 2 min default it fits when the ladder was short. E2's proxy for this test (a multisine under the gentle loop) took 68–72 s and tuned to J 0.063–0.089.

### 5.7 Check

**What it plays.** A test the model has not seen: under the incumbent, the test reference with its steps halved about their middle. On the arm that is 0.375 ↔ 1.125 rad instead of 0 ↔ 1.5 rad: other places and smaller steps than any try. A staircase test reference becomes r₀ → r₀ + ⅛ of the span → r₀.

**Prediction first.** Before the Check starts, the model and its band are replayed with the incumbent's law on this reference and drawn on the scope as a reference, "angle · predicted". The measurement then sweeps over it.

The Check is never used for fitting. It is graded in §7.

### 5.8 End, Stop, E-stop

- **Done.** On HIL the page sends `stop` (safe inputs). On simulated plants the loop's own run comes back.
- **Stop** (soft):
  - the excitation ends;
  - the incumbent, if there is one, holds; otherwise u = u₀;
  - then `stop`.
  - The record so far is kept, marked "stopped". A model is fitted if the data allow it, marked "from a stopped test".
- **E-stop from either side, or a lost connection:**
  - the test ends at once;
  - the record so far is kept and marked ("ended by the plant's stop at 34.2 s: stop pressed at the plant");
  - Reset does not resume;
  - Start begins again at Listen.

### 5.9 The budget

- It is plant time. Wall time on a fast simulation does not count.
- The Nudge may use at most 40 %. Time for the Check is always reserved. The Shake runs only if its estimated time fits.
- If not one try fits, the test ends after the first look, graded ✕: "2 min is too short for this plant: the Nudge alone took 50 s. Allow 5 min."

## 6. The fits

### 6.1 Segments and the closed-loop replay

**Segments.** The record is cut into segments, each running from one settled point to the next (Listen's end, each rung, each try from its settle, each Shake place).

**How u was made** is logged for each segment:
- **Open loop** (Nudge, rests): u as applied. The plant's `applied` echo is used when it sends one; otherwise the page's clamped u.
- **Closed loop** (Hold, tries, Shake, Check): the law, with its parameters, switching samples, the integral at the segment's start, the reference samples and the excitation s(k).

**The replay of a candidate model over a segment** is incremental about the segment's start: ŷ = y_start + Δŷ, with the model at rest at the start. y_start is the settled mean before the segment, not one noisy sample: under a gentle loop a noisy start is an offset the replay carries for seconds (built: one sample's noise moved K by 9σ).
- Open-loop segments are driven by the applied u.
- Closed-loop segments are driven by **the same law fed by ŷ**, with the same clamps.

So the measurement noise never enters the replayed u. This is closed-loop output error. It is consistent under feedback with any noise colour, because the replay depends only on r, s and the logged law (Landau & Karimi 1997). The direct output-error fit on closed-loop data that E2 used is biased by the noise the controller feeds back (Forssell & Ljung 1999).

**Further rules:**
- Across a `seq` gap, u is held for the gap's length, as the plant held it.
- When the plant's `applied` differs from the u sent, beyond its clamps, the model warns: "the plant applied a different V than sent at 34 s: a limit the page does not know".
- Residuals are weighted by 1/floor².

### 6.2 Structures

Every structure also has a dead time θ ≥ 0, fitted as a continuous value: zero-order hold with an input delay of m + f samples, split into the two exact terms of the delayed input.

| Name (chain glyph) | G(s) | Parameters |
|---|---|---|
| lag | K / (τs + 1) | K, τ, θ |
| two lags | K / ((τ₁s + 1)(τ₂s + 1)), τ₁ ≥ τ₂ | K, τ₁, τ₂, θ |
| resonance | K ωn² / (s² + 2ζωn s + ωn²) | K, f = ωn/2π, ζ, θ |
| integrator · lag | k′ / (s (τs + 1)) | k′, τ, θ |
| integrator · resonance | k′ ωn² / (s (s² + 2ζωn s + ωn²)) | k′, f, ζ, θ |

- The integrator structures are tried only when the first look said "ramps" or the kernel's step keeps rising. The others are always tried.
- Each one is built from blocks the Plant library has (gain, first order, second order, integrator, dead time), so the twin can be opened like any subsystem (no black boxes, task #14).

### 6.3 Fitting

- **Method.** Levenberg–Marquardt on the replay residuals, with positive parameters in logs. K's sign is fixed by the first look. θ is fitted in samples and bounded below by 0 (logs cannot reach θ = 0, a common answer).
- **Starts.** Two per structure:
  - from the first look;
  - from the kernel estimate (§6.8): its sum gives the gain, its first significant tap θ, its decay the time scale, and its oscillation f and ζ.
- **Caps.** At most 60 iterations per start. Deterministic.
- **Cost.**
  - About 5 structures × 2 starts × 60 iterations × (p + 1) replays of up to 12 000 samples.
  - The research measured a two-lag-plus-delay fit at 1 934 simulations in 0.9 s.
  - Expect about 1 s in Node. In the page it runs in Auto-tune's 30 ms slices.

### 6.4 Choosing the structure

- Every candidate is scored on the Check (§7).
- The page takes the **fewest parameters within 1 point of the best Check fit**, with BIC on the fitting data as the tie-break. A BIC difference below 2 decides nothing; then the structure listed first in §6.2 wins (a resonance with ζ ≥ 1 is exactly two lags, and two lags read more easily).
- A fit is marked ✕ ("not supported by the data") when it is unstable (other than the integrator), when ζ > 5, or when a time constant exceeds 10 × the test's length.
- The tester may click another candidate. That choice is saved as `structure`.

### 6.5 Uncertainty

- **Covariance:** σ̂²(JᵀJ)⁻¹, with σ̂² the residual variance per weighted sample. So the bars grow when the model misses.
  - That holds on open-loop segments. On closed-loop segments the replay leaves the measurement noise filtered by the loop (S·v), so the covariance is (JᵀJ)⁻¹ (σv² (SᵀJ)ᵀ(SᵀJ)) (JᵀJ)⁻¹, with S the replayed loop's noise transfer at the fit (one extra replay per segment) and σv² scaled from σ̂². Built and measured: under a brisk PI the plain formula covered f in 31 of 40 seeds and overstated K's bar 1.6×; with S every parameter is covered in 36–40 of 40.
- **In the sentences:** ±2σ, rounded to the digits that matter.
- **The bands** come from 50 seeded parameter samples.
- These bars understate the truth when the structure is wrong (Schoukens & Ljung 2019). So the where-spread and the distortion are shown beside them, never folded into them.

### 6.6 Where and Size

**Where.**
- The chosen structure is refitted per place: the fitting segments are grouped by the reference level they sit at, in at most three groups (low, middle and high thirds of the levels visited).
- The gain and the main time scale (τ, or f) are refitted per group; θ and ζ are shared.
- The **hold curve** comes with it: the mean u needed to hold y at each settled level. On the arm it reads "0 V at 0 rad, 2 V at 1.5 rad"; its slope is the static gain there.
- When groups differ by more than 25 % and beyond their 2σ bars, the model says "behaves differently at different places", and that lowers the grade (§7).

**Size.** The apparent gain of each Nudge rung that completed at the final T, against its push. With a Shake, the distortion share at each place is added.

### 6.7 Frequency response and distortion (Shake only)

**Estimate.** At each place: the DFT of u and y over the four measured periods at every line, and Ĝ = Ȳ/Ū at the excited lines. With a periodic excitation, averaging over periods removes the noise from both, so the ratio is consistent under feedback (Pintelon & Schoukens 2012).

**Variance.** From the spread between periods, including the U–Y covariance term, which matters in closed loop.

**Levels:**
- the noise level, from the spread between periods at all lines;
- the odd distortion level, at the odd detection lines;
- the even distortion level, at the even lines;
- **the distortion share** = (the detection-line level − the noise level) / |Ȳ| at the neighbouring excited lines, in %.

**Used for:**
- the Bode dots with ±2σ bars;
- the share of excited lines where the model lies within 2σ;
- the distortion sentence;
- the grade.

### 6.8 The kernel reference (one click deep)

- **The estimate.** A regularised impulse response from u to y (lags 1…n; the TC kernel, P(i, j) = c·λ^max(i,j); Pillonetto et al. 2014; Chen, Ohlsson & Ljung 2012).
  - It is computed on the whole fitting record, block-averaged and decimated so that n ≤ 150 taps cover the slowest settling seen.
  - Integrating plants are fitted on Δy.
- **Hyperparameters** (c, λ, σ²) come from the marginal likelihood: a fixed grid over λ, then golden-section refinement, at most 40 evaluations. The TC kernel's inverse is tridiagonal (Carli, Chen & Ljung 2017), so each evaluation is one Cholesky.
- **Uses:**
  - an order-free curve with its band on the Step and Bode plots ("what the data say without choosing a shape");
  - start values for §6.3;
  - a ceiling: when the chosen structure's Check fit is 5 or more points under the kernel's (replayed the same way), the model says "the shapes on offer miss something here", and the grade drops to !.

## 7. Validation and grades

**Measures:**
- **Fit** on the Check: 100 (1 − ‖y − ŷ‖ / ‖y − ȳ‖), as MATLAB's `compare` defines it.
- **The noise ceiling**: 100 (1 − floor·√N / ‖y − ȳ‖), the best any model could do on this noise.
- **Pattern in what is left**:
  - the residuals' autocorrelation over lags 1–25 within ±2.58/√N;
  - their cross-correlation with past u over lags 0–25.
  - "A pattern" is two or more lags outside the band, or one beyond 1.5 × it (white residuals show one in about 3 % of records). The autocorrelation removes no mean (Ljung), so an offset is a pattern; the cross-correlation uses u less its mean.
  - In words: "what is left looks like noise", or "what is left has a pattern".

**Grades** (thresholds are named constants in the code; they inform and never block):

| Grade | When |
|---|---|
| ✓ | Fit ≥ 85 % (or within 3 points of the ceiling); distortion, if measured, < 10 %; where-spread < 25 % |
| ! | Fit 60–85 %; or distortion 10–30 %; or where-spread ≥ 25 %; or a pattern in what is left; or the kernel ceiling 5+ points above |
| ✕ | Fit < 60 %; or **distortion > 30 %, whatever χ² says**; or the Check left the band |

The judges measured χ²/dof 0.25–0.32 on badly wrong models at 0.15–0.25 V, so χ² is shown, one click deep, and never decides the grade. With ✕, the model adds: "Auto-tune can tune on it, but Try on the plant will tell; a larger room or a longer test helps".

## 8. What the tester reads

**Sentences.** Three to six, built from the model and the known labels and units, numbers rounded to the digits the bars allow:

| About | Example |
|---|---|
| Delay | "Responds after 2 ms." |
| Shape | "Settles in about 2 s." · "Swings at about 1.0 Hz and settles in about 1.5 s." · "Keeps moving as long as it is pushed: 1 V for 1 s turns it 2.3 rad (it integrates)." |
| Gain | "1 V more gives 0.53 ± 0.02 rad more." |
| Where | "Behaves differently at different places: near 0.1 rad, 1 V moves it 0.5 rad; near 1.4 rad, 6.8 rad. The model is a compromise between them." |
| Size | "At ±0.24 V it creeps (friction); this model is for pushes near ±1 V." · "About 20 % of the response at this size is not linear." |
| Noise | "Noise on angle: 1.3 mrad, in steps of 1.5 mrad (an encoder)." |
| Grade | "Explains 91 % of a test it was not fitted to; what is left looks like noise ✓." |

**The chain**, the candidates and the plots are as described in §4. Nothing on the main screen needs a word of control theory. ζ, χ², the kernel and the correlations sit in tooltips and in More.

## 9. Storage

```json
"system": {
  "identify": {
    "ctrl": {
      "band": [-0.5, 2.0], "budget": 120, "vary": null, "structure": null, "use": 0,
      "kept": [
        { "name": "angle · 14:02", "plan": { "version": 1, "seed": 1, "...": "..." },
          "record": { "Ts": 0.01, "u": [], "y": [], "r": [], "applied": [], "gaps": [[1234, 3]],
                      "log": [], "end": "done", "ports": { "u": "V", "y": "angle", "units": ["V", "rad"] } } }
      ]
    }
  }
}
```

- **Keys.** Keyed by the block's id path. The settings (`band`, `budget`, `vary`, `structure`) are design inputs and are stored as such. Records are stored only on **Keep**.
- **Nothing computed in the file:** no K, τ, model, frequency response, kernel or eased-in gains. `normalizeProject` refuses them with a sentence: "Identify keeps the measurements; the model is computed from them. To keep numbers, use Copy as blocks."
- **Same numbers.** A kept record gives the same model whenever it is recomputed: the same code on the same numbers, bit for bit in the same JS engine. A computed model is cached in memory by the record's hash.
- **Size.** 2 min at 100 Hz is about 12 000 samples × 3 signals, about 250 KB of JSON. u and r are written to 6 significant digits, y to a tenth of its floor.
- **Several kept records.** They are listed with their dates and gains ("0.49 … 0.56 rad/V over 3 kept tests"). The one in use is lit (`use`).
- **Not kept** means memory only. It is lost on reload or when another system loads.
- **Copy as blocks** puts the twin subsystem (§10) into My blocks (`library`). The toast says "these numbers no longer follow the plant", as Copy as numbers does.
- **Add as variant** puts the eased-in PI into the block as "<name> · eased in": hand numbers the person chose to keep, like Auto-tune's results.
- The project format stays version 2; `system.identify` is optional ([project-format.md](project-format.md), docs step).

## 10. Auto-tune on the model

**Plant source.** Auto-tune and Analysis share one selector: "Plant: [the diagram | the identified model]".
- Simulated plants default to the diagram; **Use for Auto-tune and Analysis** switches to the identified model.
- On HIL the identified model is always used. Without one, both tabs say in red: "identify the plant first (Identify tab)".

**The twin.** `twinDiagram(diagram, path, model)` puts the model in the plant's place inside a copy of the diagram. The Controller's output goes into a twin subsystem of primitives:
- the chosen structure and its dead time;
- a Noise block of σ and a Quantizer of q on its output, so the tuner sees the noise the plant has;
- an added Sum at its input for the test push.

The twin's output feeds the Controller's measurement input. The real plant (or the External block) stays in the copy, cut off; channels that show it read "not modelled" during model runs.

**The test push.** The model has no path for the tester's d, and scoring r alone pushes the tuner to a weak integral (safety judge). So the twin gets a step at its input:
- size: 20 % of the u the eased-in loop needed to move between the reference levels, at least 1 % of u's range;
- when: where the tester's d steps, or else at 60 % of the period;
- labelled "push at the input (model only)".

**Methods.**
- Iterate, Relay and Step run unchanged on the twin.
- The status reads "92 runs on the model (identified 14:02, ! explains 77 %)".
- Results are named "· auto-tuned (model)", "· relay T–L (model)" and "· SIMC (model)".

**Teaching on simulated plants.** With the identified source, the result also runs on the diagram, and the status gives both costs: "on the model 0.061 · on the diagram 0.070".

**Measured (E2):** tuning on a model fitted to the ladder's record came within 2–25 % of the best possible cost (Nelder–Mead on the true plant), with every margin ≥ 0.66:

| | Oven | Motor | Tank | HIL arm (5 plants) |
|---|---|---|---|---|
| Model and fit | SOPDT 99 % | IPDT 97 % | FOPDT 85 % | resonance 71–77 % |
| J tuned on the model | 0.143 | 0.125 | 0.220 | 0.061–0.084 |
| Best possible J | 0.140 | 0.120 | 0.073 | 0.049–0.056 |

The tank shows the limit of one linear model across a strongly nonlinear range. The Where plot flags it ("behaves differently at different places"), and the opt-in **On the plant** search (§11) beat it there: 0.085 against 0.220.

## 11. Try on the plant (HIL)

On a simulated plant the same key runs the same procedure at the header's speed, as a demonstration.

**1. Screening on the model.**
- The path from the eased-in controller to the result has three steps, interpolated in log-gains (⅓, ⅔, 1).
- Each step is simulated on the twin, on its 50 band samples and on the per-place fits. It must be:
  - stable for all of them;
  - Ms ≤ 2 (`loopMargins` on the linear model);
  - predicted to use no more than 70 % of the room.
- Interpolated gains are not guaranteed stable, so each step is screened. A step that fails ends the path there: "the result is bolder than what the model knows: tried up to step 2".

**2. On the plant.**
1. `start`.
2. The eased-in controller holds y at r(0).
3. For each step:
   - its predicted y is drawn as a reference, "angle · predicted";
   - a bumpless switch;
   - one period of the test reference, d held;
   - a switch back.

   This runs as the same `experiment` law with a plan of kind `try`.

**The monitor** falls back to the eased-in controller at once, bumplessly, if either happens:
- |y − ŷ| > max(5 × the Check's residual std, 20 % of the room) for 0.2 s;
- y leaves the band.

The step is then "✕ did not behave as predicted".

**3. Accepting.**
- A step is accepted when room used ≤ 70 %, g ≥ 0.3, and the measured cost is within 30 % of the predicted.
- After step 3 the result runs on the plant, d back on, and becomes the running variant.
- If a step fails, the last good step is added as "<name> · tried 2/3" and runs. The status explains, and offers Check again or identifying again.

**Chips:** "step 1 ✓ as predicted · step 2 ✓ · step 3 ! rang more than predicted (kept step 2)".

**v1 limits.** Try on the plant takes PI and PID results; other laws say so.

**On the plant (opt-in, last implementation step).** E2's compass search, every trial a sweep on the scope, as an Auto-tune method under a fold, with this note: "tries gains on the real plant, about 10 s each; for plants that change across their range". Every candidate is screened on the model and its band before it runs on hardware. It is the fallback when the verify misses, or when the Where plot shows a large spread.

## 12. Analysis

- **The plant.** With the identified source, `app.loopModel(path, 'identified')` returns the model's `LinearModel` (§16): A, B, C, D of the chosen structure, its states labelled by the chain ("lag", "resonance.x1"), `delay: [θ]`, `sensors: [{ std: σ, q }]`, `op: { kind: 'identified', label: 'identified 14:02 over 0 … 1.5 rad' }`, and the grade's sentences in `warnings`. Discretisation, margins and plots are unchanged ([analysis.md](analysis.md)).
- **Ranges.** Every key number is computed for the nominal model and, as a range, over the per-place fits and the band samples: "gain margin 3.1 (2.4 … 4.0 across what the model is unsure of)".
- **Measured points.** When a Shake ran, the Bode plot shows the measured points with their bars.
- **Notes** carry the grade and the where sentence.
- **On HIL** only the identified model exists. Designed variants (LQR, PI from the plant) reading the identified model on HIL come later (§19).

## 13. Simulated plants: the teaching comparison

**The experiment** runs on a copy of the diagram, exactly as on HIL. The diagram's own Noise and Quantizer blocks apply. A diagram without noise gives near-perfect data, and the model says so: "this plant has no noise; real plants do".

**Compare with the diagram** (a toggle in the Check column, simulated plants only). It needs the design layer's `linearizeBlock` ([designs-in-the-page.md](designs-in-the-page.md) §5, branch feat/designs).
- On Bode and Step, the diagram's true linearisation is drawn dashed at each place the test sat (`linearizeBlock(project, path, { y: level })`).
- A small table, "found vs the diagram", lists gain, time scale or f, ζ and dead time per place.
- A sentence. For example, on a plant whose gain changes with its level: "The identified gain sits between the diagram's gains at the two places the test sat: one linear model is a compromise for this plant."
- With several Controller blocks, the experiment ran the others while the linearisation holds them at 0. The comparison says so.

**Hide a variation** (off by default; "±15 % · seed 7"):
- `varyDiagram(diagram, share, seed)` scales every physical parameter by 1 + share·(2ρ − 1), from a seeded generator. Physical parameters are those flagged `vary` in ELEMENTS: masses, lengths, gains, time constants, friction, resistances. Sources, Sinks, Controllers, Observers, limits, Ts, noise and quantiser settings and ports are not varied.
- The experiment, Compare, and the "on the diagram" score of §10 use the varied copy.
- After the run, the reveal lists the factors drawn ("the plant was: J +8 %, mgl −12 %, …"), as `hil_plant.py` prints the plant it drew.
- The project stores only the share and the seed.
- This makes the person's "identify the plant that we have modeled" a fair test.

## 14. The HIL plant's unknown variation

- **The page measures the plant that is connected.** `hil_plant.py` draws its plant within ±15 % at each script start (`--vary`, `--seed`, `--set`; [hil.md](hil.md)). The page is not told, as with a real device.
- **A new connection may be a new plant.**
  - The model remembers the connection it was measured on.
  - After a reconnect it is marked "measured on an earlier connection: the plant may have changed", in all three tabs.
  - **Check again** runs Hold and Check alone, about 10 s. A fit within 5 points of the original is "still fits ✓"; a worse fit is "the plant has changed: identify again".
  - A `start` request alone does not change the plant: the variation is drawn per script start.
- **Kept records from several plant draws** show the spread ("0.49 … 0.56 rad/V over 3 kept tests"). Tuning for all of them at once (the worst case) is the Auto-tune robustness item, later.
- **The truth is printed only at the plant.** For the tests, the arm's physics is ported to a test fixture with the same ±15 % draws, so the end-to-end harness (§17) scores every result against the plant it really ran on.

## 15. Protocol and plant changes (built first)

**Additions to `loop-tuner-hil/1`.** Both are optional; the protocol name stays, and the page works without them.

| Where | Addition | Why |
|---|---|---|
| `describe` → `outputs[i]` | `min`, `max` (the hard range) | "The plant keeps itself safe" is not yet true for outputs: today it E-stops only on its watchdog, its stop key, a lost page or a request, and it clamps only u |
| `y` notification | `applied: [...]`, the inputs the plant applied over the cycle just ended, after its clamps | On real hardware, clamps, rate limits or a dead band make what was applied differ from what was sent; the model must be fitted to what was applied |

**`hil_plant.py`:**
- It declares output ranges (for example angle −2.5 … 2.5 rad, speed ±60 rad/s, current ±7 A; the plant chooses them).
- It E-stops when an output leaves its range ("angle 2.6 rad beyond 2.5").
- It echoes `applied`.

**The page:**
- The External block gains `ymin`, `ymax` (design inputs from `describe`, like `min` and `max`).
- `checkDescription` validates the new fields.
- The live record stores `applied` as its own signals.

## 16. Core APIs

```js
// src/core/identify.js (no DOM)
export const IDENTIFY_VERSION = 1
export class IdentifyError extends Error { constructor(code, message, hint) }
export function knownFor(project, path, { describe } = {})  // → Known: { u: { name, unit, min, max, u0, from },
                                                            //   y: { name, unit, hard, from }, r: { lo, hi, source }, Ts, live }
export function identifySettings(project, path)             // → { band, budget, vary, structure } with defaults and their sources
export function planExperiment(known, settings)             // → Plan (data): Ts, u0, U, band, hard, budget, test reference
                                                            //   samples, check reference, seed, version
export function planTry(known, model, steps, incumbent)     // → Plan of kind 'try' (§11)
export function createExperiment(plan)                      // → Experiment, the causal state machine:
//   step(k, y, applied?) → u              one controller sample
//   reference(k) → r                      what the r Source plays at sample k
//   needs → null | { kind: 'fit', upto }  a heavy job the runner must supply
//   supply(kind, data)                    the fit and the Check's prediction, as data
//   state → { stage, rung, try, push, room, status, chips, done, end }
//   record() → Record                     u, y, r, applied, gaps, log
export function* identifySteps(record, { structure } = {})  // yields progress; returns IdentifiedModel
export function replay(record, model, segment)              // → Float64Array, the model's y for a segment
export function modelSentences(model, known)                // → [string]
export function linearModel(model)                          // → LinearModel { A, B, C, D, states, outputs, op, delay, sensors, warnings }
export function twinSubsystem(model, { push })              // → a subsystem block of primitives (Copy as blocks uses it too)
export function twinDiagram(diagram, path, model, opts)     // → a diagram with the twin in the plant's place
export function varyDiagram(diagram, share, seed)           // → { diagram, factors: [{ path, param, factor }] }
export function identify(project, path, settings)           // Node and CLI: the whole test on a simulated plant, synchronously

// IdentifiedModel = { version, structure, params, cov, chain: [{ kind, value, sd, unit, tip }],
//   candidates: [{ structure, fit, chi2dof, grade, why }], noise: { sigma, q, drift }, check: { fit, ceiling,
//   white, cross, grade, why }, where: [{ level, K, Ksd, scale, scaleSd, hold }], size: [{ a, gain }],
//   frf?: [{ level, f, G, sd, noise, distortion }], kernel?: { g, sd, Ts }, eased: { Kp, Ki, tauC },
//   sentences, grade, warnings, connection }

// src/core/fit.js (no DOM; built in step 2)
// A segment: { y, yStart, uStart, u (open loop: as applied) | law (closed loop: () => (k, ŷ) => u), weight }
export const STRUCTURES                                    // lag, lags, resonance, intLag, intRes:
                                                           //   { name, label, glyph, integrating, params, tf(p), ss(p),
                                                           //     chain(p, { sd, units }), start(guess), times(p) }
export function discretise(structure, p, Ts)              // exact ZOH with a fractional input delay → { Phi, G0, G1, C, m, f }
export function simulateSegment(d, segment)               // → { y, u }: the replay at rest about the segment's start
export function* lmSteps(residual, p0, { maxIter = 60, lower, upper }) // Levenberg–Marquardt, deterministic, yields
export const lm                                            //   per iteration; lm drains it
export function* fitStructureSteps(segments, structure, starts, { Ts, maxIter }) // → { p, cov, sd, cost,
export const fitStructure                                  //   chi2dof, bic, n, np, start, iterations, converged }
export function noiseTransfer(d, segment)                 // the replayed loop's noise transfer S (impulse response)
export function parameterCov(J, A, parts, s2)             // σ̂²A⁻¹, or with S on closed-loop segments (§6.5)
export function unsupported(structure, p, { length })     // the ✕ reason, or null (§6.4)
export function chooseStructure(candidates)               // → { index, why } (§6.4); CHOICE holds the thresholds
export function tcKernel(u, y, { n, decimate, integrating }) // → { g, sd, hyper }            (step 3)
export function multisine({ N, lines, detect, peak, seed })  // → Float64Array (one period)  (step 3)
export function frf(U, Y, { excited, detect })             // → { G, sd, noise, distortion } (step 3)
export function fitPercent(y, yhat)
export function noiseCeiling(y, floor)
export function whiteness(res, lags = 25)                   // → { r, band, outside, worst, white }
export function crossCorrelation(res, u, lags = 25)         // → { r, band, outside, worst, independent }

// src/core/linalg.js gains cholesky(A) and cholSolve(L, b) (the kernel, LM).
// src/core/live.js gains createStepRunner(diagram, signals, { Ts, sources }), shared with createLiveRunner:
//   one controller sample at a time, Sources overridable; the worker runs the experiment law and
//   posts { identify: state } and record chunks; the page posts { supply }.
// src/core/controllers.js gains the hidden type 'experiment' ({ plan }); it is never in the library,
//   and normalizeVariant refuses it in files ("experiment is the page's own").
// src/core/autotune.js: tuneContext(project, path, { plant: 'diagram' | 'identified', model }).
// src/core/hil.js: outputs[].min/max, y.applied, the External block's ymin/ymax.
```

**CLI and browser:**
- `node cli.mjs identify <project> [--block ctrl] [--band lo,hi] [--budget 120] [--vary 0.15 --seed 7] [--json] [--keep]` runs the same core, gives the same numbers, and prints the sentences. `--keep` stores the record in the project.
- `node cli.mjs autotune <project> --plant identified` tunes on the kept record in use.
- In the page: `window.loopTuner.identify({ block, band, budget, vary, keep })` returns a Promise of the report, and `loopTuner.identified(block?)` returns the model in use. Both are documented in the page's Help (For agents) and in AGENTS.md.

## 17. Tests

Fixtures live in `test/fixtures/`, are not shipped, and carry no plant numbers into the bundle (the guard test checks this):
- `arm.mjs`: `hil_plant.py`'s physics ported, with ±15 % draws, an encoder and noise;
- lag, integrator and unstable plants;
- the library's oven, motor and tank, through the diagram.

1. **Determinism.** The same plan and the same y give the same u, bit for bit. Two runs of `identify()` give identical records and models. The multisine depends only on its seed.
2. **Nudge safety.** Over 50 arms at ±15 % with the default band, no rung uses more than half the room on its side, there are no back-offs, and the arm never goes over the top. Each rung stays within the bound predicted before it ran.
3. **Classification.**
   - a lag settles; an integrator ramps; the arm rings;
   - an unstable plant runs away and the experiment asks for `stop`;
   - an unwired plant gives "does not move";
   - drift is subtracted.
4. **Hold.** The SIMC robust branch formulas hold. The takeover is bumpless (|Δu| at the switch < 1e-9). A band exit gives u₀ and `stop`.
5. **The ladder** on the oven, motor, tank and five arms: it never leaves the band; it stops by its rules; plant time stays within the budget; d is held.
6. **Fits.**
   - Each structure recovers known parameters to 1 % on noise-free data, open and closed loop.
   - With noise, the ±2σ bars cover the truth in at least 90 % of 40 seeds.
   - A closed-loop test with coloured noise, where a direct output-error fit is biased, is not biased with the replay.
7. **Choice.** The true structure is chosen on clean data, and the fewest-parameters-within-1-point rule holds.
8. **Validation.**
   - The fit % equals MATLAB `compare`'s definition.
   - The whiteness band is ±2.58/√N.
   - A cubic nonlinearity under the Shake shows distortion at the detection lines; a linear plant shows none. The grade becomes ✕ above 30 % whatever χ² says.
9. **Frequency response.** Exact at the excited lines on a linear plant in closed loop. A period with a `seq` gap is dropped and repeated.
10. **Kernel.**
    - The tridiagonal inverse equals the inverse.
    - The research's example (2e^(−0.1s)/((0.5s + 1)(0.1s + 1)), 30 s, SNR 3) fits the impulse response to at least 94 %.
    - At most 40 evaluations.
11. **Models.**
    - `linearModel` matches each structure's transfer function.
    - The twin subsystem simulates the same as `replay`.
    - Copy as blocks contains primitives only.
12. **Storage.**
    - Keep round-trips through the project file with no computed fields; computed keys are refused with the sentence.
    - A kept record recomputes the same model bit for bit.
13. **End to end, the acceptance test** (E2's harness): oven, motor, tank and five arms. Identify, then Auto-tune Iterate on the model, then score the result noise-free on the true plant.
    - J ≤ 1.3 × the best possible on the oven, the motor and the arms. The tank is reported, with its where-spread flagged.
    - Every Try-on-the-plant step keeps g ≥ 0.3.
    - Arms within 2 min of plant time.
14. **Safety rules.**
    - An E-stop mid-test keeps the record, marked; Reset does not resume.
    - Stop is soft.
    - The fit pause on HIL waits for the supply; Node supplies synchronously.
15. **Protocol.**
    - `describe` with output ranges parses.
    - `hil_plant.py --check` E-stops beyond an output range.
    - `applied` is recorded and used.
16. **Try on the plant.**
    - Screening refuses a step that is unstable on a band sample.
    - The monitor falls back when the fixture's plant is swapped mid-run for another draw.
17. **Teaching.**
    - `varyDiagram` with a seed is reproducible and varies only flagged parameters.
    - The Compare table equals `linearizeBlock` at each level.
18. **The plant changed.** Check again against another arm draw says "the plant has changed".
19. **CLI.** `node cli.mjs identify` prints the sentences; `--json` parses; it gives the same numbers as `identify()`.

## 18. Implementation steps

Each step is one agent, with `npm test` green at the end.

0. **Record.**
   - The decisions.md entry is made with this design; check it.
   - Add the roadmap item.
   - Point hil.md's "Not yet" at this file.
1. **Protocol and plant first** (§15).
   - `outputs[].min/max` and `y.applied` in `hil.js` and `checkDescription`; the External block's `ymin`/`ymax`.
   - `hil_plant.py`'s output ranges, output E-stop and `applied`.
   - Tests 15. Run the real plant once with `--seed`.
2. **Numerics.**
   - `cholesky` and `cholSolve` in linalg.js.
   - `fit.js`: `STRUCTURES`, `discretise` with a fractional delay, `lm`, `fitStructure` on segments, `fitPercent`, `whiteness`, `crossCorrelation`.
   - Tests 6, 7, 8 (fit % and whiteness), 11 (`linearModel`).
3. **Kernel and multisine.** `tcKernel`, `multisine`, `frf` with detection lines. Tests 8 (distortion), 9, 10.
4. **The experiment.**
   - `knownFor`, `identifySettings`, `planExperiment`, and `createExperiment` with Listen, Nudge, first look, Hold, Ease in, fit pause and Check (Shake comes in step 8).
   - Refusals with sentences.
   - The arm fixture and the other fixtures.
   - Tests 1–5.
5. **Runner and the whole test in Node.**
   - `createStepRunner` (shared with the live runner) and the hidden `experiment` type.
   - The r Source played from `reference(k)`; other Sources held.
   - `identifySteps`: segments, replay, choice, grade, where, size, sentences.
   - `identify()` and `cli.mjs identify`.
   - Tests 12, 13 (identify part), 19.
6. **The Identify tab.**
   - `UI_TABS` gains `identify` after `controller`.
   - The four columns, meters, chips, status, overview strip.
   - The scope: channels 3 and 4, a sweep per try, references.
   - Keep and `system.identify` in `normalizeProject`, Copy as blocks, Add as variant, Help text, `loopTuner.identify`.
   - Check in the browser on the oven and the motor.
7. **Live.**
   - The experiment in the worker; state and record chunks; the supply round trip.
   - E-stop and Stop rules; `stop` at the end.
   - The connection mark and Check again.
   - Check in the browser against the real `hil_plant.py` with two seeds.
   - Test 14.
8. **Shake.** The multisine under the incumbent at two places; frequency-response points and distortion; grade rules. Test 8 (grade).
9. **Auto-tune and Analysis on the model.**
   - The shared plant-source selector, `twinDiagram` with the test push, labelled runs and result names.
   - `app.loopModel(path, 'identified')`, ranges in Analysis, measured points on Bode.
   - Test 13 (the whole harness).
10. **Try on the plant.** `planTry`, screening, steps, monitor, fallback, chips. Test 16.
11. **Teaching.**
    - Compare with the diagram (after feat/designs is merged); Hide a variation and the reveal.
    - A System library entry, **Unknown oven: identify, then tune**: the badly tuned oven with a hidden variation (seed 3), opening on Identify. Two things: identification, and tuning on the model.
    - Tests 17 and 18.
12. **Docs sweep.**
    - tabs.md (state built), autotune.md (Tab 5, plant source, on the model), analysis.md (Tab 6, identified source), hil.md, project-format.md (`system.identify`), AGENTS.md, roadmap.md, the README status.
13. **Optional: On the plant** (§11), opt-in, screened on the model. E2's compass search with its measured rules.

## 19. Not built

- **Reference-mode plants.** The plant runs its own controller and the page sends r. The decision log says identification works partly there: r → y of the closed loop, and u → y if the plant reports its u. It would be an eased-in staircase on r, using the same replay with the plant's loop as an unknown part.
- **Plants that do not stay put without a controller** (unstable, or drifting fast): identify under the running variant, which must hold the plant. The replay fit already takes any logged law.
- MIMO, and blocks with several measurements.
- A model per place (gain scheduling from the Where plot), and robust tuning over the where-spread and over several kept records.
- **Grey-box fits of physical parameters.** The person: the tester gives no grey box. It is only conceivable later as a teaching tool on simulated plants, with identifiability shown.
- Subspace (N4SID), AAA or vector fitting, the Local Polynomial Method, Ljung's model error model, SINDy.
- Gaussian-process models, SafeOpt, IFT, VRFT, DeePC, neural or Koopman models. They are black boxes, or they were measured worse here (§1).
- Designed variants (LQR, PI from the plant, Kalman) reading the identified model on HIL.
- **The controller benchmark** (roadmap, last): tune every controller type on an identified plant and judge them in a Pugh matrix.
- Detecting a changed plant without a reconnect (beyond Check again).

## 20. Interpretations for the decision log

- "Experiment first" with "general questions": the page asks two things, the band y may move within and the test's length, both prefilled. Where the test runs is not asked; the ladder follows the tester's own reference.
- "Start with slow control efforts and then increase": open-loop pushes that grow only while the last one stayed within half the room, then a gentle controller asked to be 30 % quicker per try. Disturbances are held off during the test.
- "The responsibility of keeping the system safe is with the plant": the plant gains an output-range E-stop. The page's guards (back-off at 80 % of the room, the band as a soft guard, `stop` on a runaway) exist so that a test ends cleanly, not in an E-stop.
- "Normalised control effort": the push meter, |u − u₀| as % of u's range.
- Identify's product is the model plus the gentlest controller proven on the plant. Auto-tune's runs go to the model, and one checked hand-over goes to the plant.
- What is stored: the measured record, only on Keep. The model is recomputed from it. Copy as blocks and Add as variant are the explicit ways to keep numbers.
- Grades never block. ✕ means "the model explains little", and Try on the plant is the final check.
