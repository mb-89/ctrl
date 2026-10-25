# Identify: finding the plant by experiment

Reader: whoever builds the Identify tab, its experiment or its fits, or changes how Auto-tune and Analysis use an identified model. **Status: designed 2026-10-24; being built on branch `feat/identify` in the steps of §18 (done: 0, the record; 1, the protocol and the plant (§15), built 2026-10-25; 2, the numerics in `src/core/fit.js`; 3, the kernel, the multisine and the frequency response, also in `fit.js`; 4, the experiment: `src/core/identify.js` and `src/core/experiment.js`; 5, the runner and the whole test in Node: `createStepRunner`, the hidden `experiment` law, the model from the record, `identify()` and `node cli.mjs identify`, measured below in "Measured: the whole test in Node"; 6, the tab, §4.1; 7, live, §5.11 and §14.1; input 56, the onset test and the discriminating test, §6.10; 8, the Shake, §5.12; 9, Auto-tune and Analysis on the model, §10.1).** It is the synthesis of a design panel run on 2026-10-24: two proposals (E1, staged experiments then a model; E2, tuning on the plant by experiment), each prototyped in plain JS on the HIL arm's physics, and two judges (a tester's view and a safety view) who re-ran the prototypes. Research and sources: [../research/identification.md](../research/identification.md). Where the code and this plan differ later, the code and [decisions.md](decisions.md) win.

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
| u's start value u₀ | HIL: the port's `safe` value. Simulated: the running variant's start output `u0` (the integral at t = 0, which a person sets so the loop starts in balance), else 0; clamped into the range (built; the design said 0, and the library's tank drained to empty at 0) |
| y's name and unit | The block's input 2 (`blockInputNames`), the Sink's or External port's unit |
| y's hard range | **New, optional** (built): `outputs[].hard_min/hard_max` in `describe`, kept in the External block as `ymin`/`ymax`; the plant E-stops beyond it (§15). Simulated plants have none unless the tester types one |
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

### 4.1 Built (step 6)

`src/ui/identify.js`, between the Controller and Auto-tune tabs (`UI_TABS`). Where the build made §4 more precise ([decisions.md](decisions.md), v2.9):

- **One runner for the page and Node.** `identifyRun(project, path, settings)` is the whole test as a generator: it yields each controller sample (plant time passes) and each slice of a fit (none passes), and returns what `identify()` returns; `identify()` drains it. The page steps it at the header's Speed (∞: in 30 ms slices between frames); at the fit pause it fits before the next sample, so the record is the same at any speed and the same as `identify()`'s (test `identify-page`).
- **The scope** takes the run through the display's feed, as Live does: sweeps of the scope's window, a new sweep at each closed-loop stage and try (the sweeps before fade). y and u go onto channels 3 and 4 only when no channel shows either. The status line reads `IDENTIFY · ease in 3 · push 32 % · room 35 %`. The scope's Stop stops the test softly.
- **The Check's prediction** (`predictCheck`) is the pause's model replayed as the fits replay the record (from the last rest fitted, under the logged laws, fed its own y) on into the Check's reference, drawn dashed as "y · predicted" when the Check's reference starts (the experiment's `state.checkAt`). Replaying from where the plant is at the Check's start instead (the oven still cooling) missed by 3 °C; as built it is the final model's Check replay to 1e-8.
- **After the run** the record and the model's Check are references ("identify · record", "identify · T · model"), stepped to the Check; the overview strip under the experiment shows u and y with the stages, and a click brings that stage onto the scope.
- **The model column** shows the test just run (memory only, until the plant's blocks change or another system loads), else the kept test in use, computed from its record in slices and cached by the record's hash. Clicking a candidate stores `structure` (one undo step) and recomputes from the same fits.
- **The plots** (Check, Bode, Step, Where, Size, More) draw with `ui/plots.js`. Bode is the sampled model's response (`modelBode`: the zero-order hold and the fractional dead time, as §6.7 asks), with its 2σ band from the parameter samples; the kernel's step is dotted on Step; More shows the residuals' autocorrelation against its band and χ²/dof per candidate.
- **Keep** stores `{ name, plan, record }` (one undo step); **Copy as blocks** saves `twinSubsystem(model)` to My blocks; **Add as variant** adds the eased-in PI as "<name> · eased in" without running it. `loopTuner.identify(opts)` runs the tab's test and resolves with the model's report; `loopTuner.identified(block)` returns the model in use.
- **Measured** in Chromium (1440 and 390 px, light and dark, no console errors, nothing beyond the viewport): the oven at ∞ in 0.4 s (two lags, 98.9 % on the Check, the CLI's numbers), the DC motor in 0.9 s (integrator · lag, 99.9 %); at 20× the oven's 112 s take 6 s.
- **Not yet**: Try on the plant (10), Compare and Hide a variation (11).

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

**Back-off.** If a rung uses 80 % of the room on its side, it ends at once: u = u₀, and the rung is marked. (After review: rest, averages and the sentences, §5.10.)

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

**Soft guard.** If y leaves the band, the incumbent takes over at once (bumpless), the try is ✕ with g = −0.1, and the ladder ends. The plant's clamp, watchdog and E-stop stay the hard authority. (After review: r ramps back, the effort cap and the tail, §5.10.)

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
- The crest factor is lowered by 20 fixed clip-and-restore iterations. Built: each clips at 1.4 × the rms, keeps the phases the spectrum then has and restores the lines (clipping at a share of the peak converged more slowly). Measured over 10 seeds: crest factor 1.7–1.9 at N 256 (18 lines), 1.8–2.0 at 512 (34 lines), 2.3–2.7 at 4096 (60 lines over 765 harmonics); random phases alone give 2.5–3.8 and Schroeder's 2.4–3.3 on such sparse lines. `multisineLines` chooses the lines (the candidates thinned by a ratio when there are more than 90), `multisine` makes one period, both from the seed.

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

### 5.10 Built (step 4)

`src/core/experiment.js` holds the state machine, `createExperiment(plan)`, and `src/core/identify.js` what feeds it (`knownFor`, `identifySettings`, `planExperiment`). Tests 1–5 (`test/experiment.test.mjs`, `test/ladder.test.mjs`) run it on hil_plant.py's arm ported with ±15 % draws, an encoder and noise (`test/fixtures/arm.mjs`), on a lag, an integrator, unstable and unwired plants, and on the library's oven, motor and tank through their own diagrams (`test/fixtures/plants.mjs`). Where the build made the sections above more precise ([decisions.md](decisions.md) has the measurements):

- **Listen** reads its last half (a plant still settling from before would read as noise and drift); drift counts only 4 standard errors out of the noise; a noise-free simulation's floor is 1e-5 of the band.
- **Nudge.**
  - A rung's **reach** (how far y went from y₀, both ways) feeds the move rule and the next rung's bound; its **response**, read from where the rung started, decides visible, plateau, slope, ringing and p.
  - **A rung waits for rest** after its planned rest (y still within 5 % of its peak over half a window), at most 8 × its length and never past the Nudge's 40 %. An unstable plant never rests: still growing at the end, beyond 1.5 × the push's reach, it runs away.
  - **p is clamped to [1, 2] for a doublet and is 1 for a pulse**: a doublet's spectrum at most quadruples when T doubles, a pulse's at most doubles, for any linear plant and dead time. Unreadable (a dead time longer than the push), p takes that largest value.
  - **Doubling a push that has not visibly moved y predicts × 3, from at least 5 floors** (friction lies at tiny amplitudes: the arm moved 2.9–3.5 × further at 0.48 → 0.96 V). A visible push keeps × 2, T keeps 2^p.
  - A pulse's two sides are held to their own rooms; a doublet's to the smaller room.
  - The response's sign is the direction of its first clear move.
  - Nothing visible within the room: the test ends with "angle moves too little to read within half of 'may move within' (its noise is …): widen it".
  - Measured over 50 arms (default band): reach +0.21 / −0.16 rad, a Nudge of at most 2.0 s with its waits, last push 0.48–1.92 V, no back-off, every rung within the bound predicted before it ran (worst 0.98 of it). E1's prototype: +0.18 / −0.14 rad, 3.4 s, 0.96–1.92 V.
- **First look.** The 1 s rest comes first; then, still at u₀, a lag, an integrator with a lag and a resonance are fitted on one segment (the whole Nudge and the rest, drift taken out), LM in slices of 4 iterations a sample; the lowest BIC decides. "Rings": a resonance with ζ < 0.5, or two swings in the rest. A resonance counts for the Hold as a lag of its gain and 1/(ζωn) (it rings) or its slower time constant. Still moving away from y₀ after the rest: it runs away.
  - On the arm with its friction the first look sees an overdamped second order (Coulomb stops a ±0.2 rad swing within half of it); without the friction it rings, K, f and ζ within 1 %.
- **Hold.** τc is doubled only for a loop that swings about r(0); one that creeps toward it (an arm held 0.1 rad off by friction) keeps its gains and waits as long again, and if still closing in, inside the band, the ladder starts from there with a note.
- **Ease in.** Each candidate is 0.7 × the last try's τc (after a try that was no better, the same τc would repeat it). After a soft guard the incumbent has up to 4 s to bring y back before the hard guard applies. J is `runCost`'s with the default goal (`tryCost`, equal to it on the same arrays); g is `tryMargin`.
- **Fit pause**: at least 2 s and until `supply('fit', data)`, at most 30 s; Node supplies at once.
- **The record** is plain data: `null` where y was not measured or nothing was echoed, `gaps` as `[i, len]` (len cycles lost before record sample i).
- **Measured** (2 min budget, as first built): oven 7 tries in 83 s, motor 3 in 36 s, tank 5 in 56 s, arms 4–7 in 53–77 s; never out of the band, every ladder stopped by its rules.

**After review** (2026-10-25: the experiment run on the arm, the oven, the motor, the tank, 50 tanks and 50 arms drawn within ±15 %, 240 random plants and unstable ones; [decisions.md](decisions.md)). Where the experiment now does more than §5.1–§5.9 say:

- **Listen guards the band from its first sample** (three in a row outside): a plant that runs off at u₀ ends at once with "y drifts out of 'may move within' with u held at 0 (from … to … in 1.5 s): it needs a controller first"; one that starts outside, with the sentence of §5.1. Measured: an unstable plant with a small bias reached 220 in Listen's 3 s (a band of ±1.3), now 1.43.
- **A rung rests before the next one starts.** Rest is declared only after a wait that covers the delay a response may have (twice the longest delay a visible rung showed; 1 s while none has been seen) and when the last window's spread is small, not only its halves' means (equal mid-swing). The next rung's level is the mean of the window it rested over. Measured: tanks within ±15 % that read the sign the wrong way round, 8 of 50 → 0 (and none emptied); random plants 5 of 240 → 1 (it ended before any loop ran); rungs beyond their predicted bound, 30 of 1173 (up to 48×) → 2 of the arms' (1.09×). The arm's Nudge now takes 5.4–6.9 s, the oven's 30–40 s (its pushes grow until the response truly levels off; first built, a level read mid-decay looked like a plateau).
- **A rung's response is read through a moving mean over half its push**, against the noise of that mean and of the level, floor·√(1/m + 1/n): single samples hid clear responses. A longer push after one that did not visibly move y predicts dead/2 × 2^p (friction lies here too: from rest an arm's push of twice the length moved it 4.8×).
- **The Nudge's sentences.** "is u wired?" only when nothing was seen with the push grown to its largest and as long as the time or T's limit allowed; stopped short by the room, "y moves too little to read within half of 'may move within' (its noise is …): widen it", or, when y starts within 20 floors of an edge, "angle starts 0.0018 rad from the edge of 'may move within' (its noise is …): widen it below −0.002 rad, so the pushes have room both ways". When y did move, but not yet clearly, and the next push could leave half the room: "h moved 0.0204 m at pushes up to 0.03 m³/s, and a larger push could take it beyond half of 'may move within' (0.181 m below where it rests): widen it below −0.0667 m, or narrow q's range in the Controller tab (the pushes start at 1 % of it)" (3 of 50 tanks within ±15 %, resting near empty, where it is most sensitive; as first built "h moves too little"). With nothing seen when the time ran out: "P has not moved T at all, at pushes up to 32 % for 2.6 s: is P wired to the plant? A longer test would push harder". The band left at the very first push: "y moves too far at the smallest push (0.04, 1 % of u's range, took it to 1.57): narrow u's range in the Controller tab, or widen 'may move within'". Measured: at noise 1 % of the room on random plants, 78 of 88 read "is u wired?" as first built, 0 now (they read the room).
- **Runaway is read while it accelerates**: over three equal windows after the push, after the wait, beyond 1.5 × the push's peak; a band exit counts as a runaway only when accelerating. Measured (band to 1.33): unstable lags at τ 0.3 and 1 s stopped at 0.32 and 0.09, an inverted pendulum (ω 3) at 0.07, where all were stopped at the edge; at τ 0.05 s it still reaches the edge (1.44).
- **A first look that settles slower than all the data it saw** is read as an integrator when that fits within 2 of BIC (a resonance at ζ 20 for an integrator drifting on a bias), and a time scale beyond ten times the whole test ends with "y does not come back after a push (its time scale reads … s): it needs a controller that holds it before it can be identified" (a double integrator; first built, "Allow 10 min").
- **The Hold's wrong-way guard**: y moving away from r(0) the way it started, never having crossed it, by more than a quarter of the room on that side, ends the test at once (u₀ and `stop`): "the gentle controller pushed angle away from 0 rad (… at … s): the page stopped the plant; the pushes may have been read the wrong way round". A try started from rest has the same guard against where r asks. Measured: it caught every tank that had read its sign wrong, 5.7–7.9 s in, at 0.062–0.088 m instead of empty, and never tripped on 50 arms, 240 random plants, the oven, the motor or the tank.
- **The effort eases in**: a try's push |u − u₀| is capped at twice the largest one proven before it (the Nudge's, the Hold's, each accepted try's); the cap is logged with its law, so the replay runs the same limits. Measured: the first try pushed 4–15 × the Nudge's (motor 30 %, oven 32 % of u's range), now 2 × (8 %, 16 %); the oven's later tries reach 81 % as its reference needs.
- **A try is scored with its tail**: the candidate holds the reference's last value until y settles at it or stops moving (a gentle loop held off by friction creeps), at most 4 s; J sums over the test's length (a long tail adds its cost, it does not dilute the mean). A try is accepted only when J improves by 3 %, so ✓ and the incumbent agree. Measured: random plants ending out of the band under the incumbent, 23 of 240 → 3 (an integrator with a lag ended a try on its way back).
- **After a soft guard** the incumbent takes over bumplessly at the reference the try had, which ramps back to r(0) over 2(τc + θ) (at most 2 s); the guard's grace ends early if y goes a twentieth of the band's span further out than where it left, and is over only after y has been back inside for 0.5 s. A test that then ends with y out of the band under the incumbent ends softly (below). Measured: the kick at the hand-over 37 % → 2 % of u's range; arms in a tight band (−0.15 … 1.65) ended 0.51–0.71 rad beyond it and spun over the top when released, now at most 0.27 rad and they come back.
- **Stop is soft (§5.8)**: the excitation ends, the incumbent (or the loop that runs) brings y back to r(0) by the same ramp and holds it until settled, at most 4 s, and only then is `stop` asked for; before any loop ran, u₀ at once. Measured: arms stopped at 1.3 rad stay within −0.11 … 1.37 rad, where u₀ at once swung them to −0.45.
- **The budget (§5.9)** reserves both of the Hold's windows and a try's settle, reference and tail; too short, the sentence names the shortest length that fits: "30 s is too short for this plant: the test so far took 11 s, and one try needs about 35 s more. Allow 1 min." (first built: "0.5 min … the Nudge alone took 6 s. Allow 5 min."; 60 s completes all 50 arms). No run ends "Done" without a try for a lack of time; never over the budget (worst 1.5 s under, 700 arm runs at 26–60 s).
- **A lost measurement** (y not a number) is held over in every statistic (the rung's level and response, the rest test, a try's J and g).
- **Measured after review** (2 min): oven 6 tries in 107 s (budget), motor 4 in 42 s, tank 5 in 69 s, five arms 5 tries in 74–80 s; 50 arms all done in 39–92 s, never out of the band.

### 5.11 Built (step 7): on a live plant

The live loop (`core/live.js` `createLiveLoop`, in the page's worker) runs the experiment; the page fits and supplies. Where the build made §3–§5.8 and §14 more precise ([decisions.md](decisions.md), v2.9):

- **The page asks, the loop runs.** `identify { key, plan, source, hold, applied }` starts a fresh run (a running plant is stopped first) in which the block at `key` runs the hidden law, the r Source plays `reference(k)`, the other Sources hold their values and nothing ramps in (the experiment eases in itself). The sample k is the plant's time over Ts (a jump is a gap); `law.at(k, applied)` names it and the u the plant applied, before the block samples. The tab refuses a Ts that is not a whole number of the plant's cycles.
- **Messages.** The loop posts the state at most 10 times a second; the whole record when the experiment needs the fit, when the Check starts (for its prediction) and at the end. Interpretation of "the record in chunks": three whole records, at 100 Hz and 2 min about 1 MB each through the worker's structured clone, simpler than chunks and measured without a late cycle. The page fits in slices and posts `supply`; the experiment holds y meanwhile (at least 2 s, at most 30 s, then "the page could not fit in time").
- **Endings.** Done: the loop stops the plant (`stop`). Stop (the tab's, or the scope's while the test runs) is soft: the loop's `identifyStop` lets the controller bring y back, then the plant stops. An E-stop from either side or a lost link aborts at once (`abort`), and the record so far comes back marked ("ended by the plant's stop at 12 s: pressed on this page"); the model column shows it "from a test that ended early"; Reset does not resume.
- **Measured** against the real `hil_plant.py` (the default model, the unbalanced arm, `--seed 1` and `--seed 2`, Coulomb friction off in both draws), in Chromium at 1×: done in 33–34 s of plant time, a resonance, K 0.70 and 0.61 rad/V, f 0.91 and 0.85 Hz, ζ 0.30, θ 3 ms ("Responds after 3.1 ms": the round trip), 90 % and 85 % on the Check (the noise allows 99.98 %), both "Behaves differently at different places"; Check again on seed 1: still fits (96 % now, 95 % then); an E-STOP 12 s into a second test on seed 2 ended it with the record marked and a model "from a stopped test" (no Check ran). No console errors, at 1440 px light and 390 px dark.

### 5.12 Built (step 8): the Shake

`shake()` in `experiment.js` (EXPERIMENT.shake), `excitationOf` for the replay, `shakeResponses` and `fitSupply`/`shakeWanted` in `identify.js`; tests in `test/shake.test.mjs`. Where the build made §5.6 and §6.7 more precise ([decisions.md](decisions.md), v2.9):

- **When.** The page answers the first fit pause with `shake: true` when the model there is unsure (! or ✕ for any reason but that no Check has run yet, which is always so at the pause; interpretation of "graded ! or ✕"). The experiment plays it when the two places, the Check and a second pause fit the time left; else the note "a closer look (the Shake) needs about 47 s more: allow 5 min".
- **Size.** The target peak is half the largest push proven (|u − u₀| of the Nudge, the Hold and the accepted tries), interpretation of "half the largest |u − u_hold| the incumbent used": the cap that eased the tries in already tracks it. The three transient periods at ¼, ½, 1 × are each raised only while the period before used at most half the room at that place.
- **A band exit** stops the tones at once and ends the Shake; the incumbent brings y back with the soft guard's grace (first built, the pause after it saw y outside and stopped the plant), and the test goes on to its second pause and the Check.
- **Fitting.** The Shake's places are closed-loop fitting segments (cut where the tones start), their tones rebuilt from the log (N, the highest line, the seed, each period's start and amplitude) and added to the replayed law's output, as played; the fitting data end at the second pause. The Where refit now sees the high place held: on the arm (seed 1, 5 min) 1.86 rad/V near 1.25 rad where the arm's is about 1.55 (0.83 without the Shake).
- **The response.** At each place the measured periods (at the final amplitude, none with a lost cycle; a period with one is played once more) give `frf`: Ĝ with its 2σ at the excited lines, the distortion share, the model's sampled response there and the share of lines within 2σ (`model.frf`); `model.distortion` is the largest share, graded (! from 10 %, ✕ above 30 %) and said ("About 17 % of the response at this size is not linear.", before the Nudge's friction hint, within the six sentences). The Bode plot draws the points with their bars, a colour per place.
- **Measured.** A lag (K 2, τ 0.5 s, θ 0.05 s, σ 0.002) at 5 min: two places, Ĝ within 2σ of the model at 92 % of the lines (F(2, 6) predicts 92 %), distortion 0.1 %; a lost cycle in the fifth period: one period more, four kept, 92 % again. Behind a cubic actuator u + u³: 18 % not linear, !; at + 0.5 u³ the tones reached the band's edge and stopped, the test went on. The conical tank at 5 min: 17 % not linear at 0.15 m, 3 % at 0.8 m, the measured gains on either side of the one model (the Bode plot shows it). The arm at 2 min (seeds 2 and 3 now fit the Shake in): the Shake's data at 1.5 rad weigh in, and two equal lags with θ ≈ 50 ms come within a point of the resonance on the Check; the test that tells them apart (a burst at 0.87 Hz at rest, in the friction's regime) is predicted at 68 % by the lags and 44 % by the resonance, and the lags are kept (§6.10). The oven and the motor are sure enough at the pause: no Shake.

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
- **Damping** (after review): Marquardt's μ·diag(JᵀJ) with μ₀ = 10⁻³, a number without units, so the uniform weight 1/floor² leaves the path unchanged (bit for bit at weights that are powers of two). First built, μ₀ was 10⁻³ · max diag(JᵀJ): at a noise-free simulation's floor the same lag took 29–36 iterations instead of 8–10, and the resonance ended in a local minimum from 8 of 25 random starts instead of 2.
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
- **Coloured noise** (after review). S·v assumes v white. The noise's own colour is read from Listen's last half less its drift, pure noise with no model involved: an AR(p), p ≤ 10 by AIC, by Burg's method (Yule–Walker shrinks a pole near the unit circle on 150 samples), and its impulse response is convolved into each segment's S. Skipped when Listen is quiet or shows an encoder's steps. Measured (a lag under a brisk PI, AR(1) at 0.95, σ 0.02, 80 seeds, the colour from 150 samples): K, τ, θ covered in 67, 75, 78 of 80, against 26, 32, 34 read as white; two lags, the resonance and an integrator with a lag 70–79 of 80 (20–46 as white); open loop 72–76 (22–34); white noise unchanged. The estimates are unbiased either way; only the bars were 3–7× too narrow. Coloured, the noise's level is its spread about the drift, not Listen's σ from differences (σ√(1 − ρ) for an AR(1)): it sets the noise ceiling and the noise sentence.
- **A controller at its limit** (after review). The bars take the loop as linear; a law at its clamp passes no noise back, and when it leaves the clamp is set by the noise. When u sat at a limit anywhere in the closed-loop data, the model says so: "P was at its limit in 3 % of the loop's test: the ± bars may be too narrow". Measured: u clamped at a segment's start, K's spread 1.6× its bar; reading S at the first unclamped sample instead made it 3.3×.

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
- the share of excited lines where the model lies within 2σ, against the model's discretised response G_d(e^{jωTs}) (the zero-order hold and the fractional dead time), not G(jω): at ωTs = 1.36 (line 111 of 512 at 10 ms) the two differ by 72–76 % (review, for step 8);
- the distortion sentence;
- the grade.

**Built** (`frf`, `wholePeriods` in `fit.js`; tests 8 and 9):
- Exact on a linear plant in closed loop: Ĝ equals the plant's discrete transfer function to 1e-8 at every excited line (lag, resonance, integrator with lag, each with a fractional dead time).
- `sd` is the standard deviation of Ĝ as a complex number, √E|Ĝ − G|². Measured with noise under a brisk PI (40 seeds, 800 lines): the ±2σ bars hold the truth at 91.9 % of lines, as the F(2, 6) distribution of four periods predicts (92 %). Near crossover the mean squared error is 1.09 × sd² with the U–Y covariance term and 0.55 × the variance without it, so leaving it out would make those bars 1.4× too wide.
- The spread between periods assumes the noise forgets within a period. Where the loop's noise spectrum is steep (the lowest lines, under integral action) the spread overstates the variance of the mean up to 3×; a lightly damped loop's ringing noise does the same near its resonance. The bars are then too wide there; pooled over the lines they were never too narrow in these measurements.
- **The distortion share** is per line, as designed, with the noise removed in power (the detection line's |Ȳ|² less σ²_Ȳ), not in amplitude. The odd and the even detection lines each give a share against the response at their neighbouring excited lines; the share adds the two in power. Pooling all detection lines into one ratio instead would dilute a cubic's odd distortion by the empty even lines (7.8 % would read 3.8 %).
- Measured with a cubic actuator v = u + a·u³ under the Shake (a lag under a PI): about u = 0 only odd distortion (a = 1: 7.8 %, even 0.000 %); half the push, a quarter of it (2.0 %), as a cubic must; a = 6: 33 %; held at r = 0.5, where the cubic also bends one way, odd 7.9 % and even 7.2 %; a linear plant 0.000 % with noise. In open loop, what the odd detection lines show is what lands on the excited lines: the spread of Ĝ·Ū over 30 phase realisations is 0.87 × the detection lines' level. In closed loop that spread is larger by |1 + GC|² (the loop feeds the distortion back), so the share is read from the detection lines, not from Ĝ's spread.
- A period with a `seq` gap at or inside it, or a guard event, is dropped (`wholePeriods`); the Shake will play one more (step 8: no experiment plays a Shake yet; test 9 plays a fifth period itself). Measured: the four kept periods give Ĝ to 3e-6 (the period after the gap still carries a 1e-5 transient), the four taken across the gap 6 % off.
- The grade's ✕ above 30 % comes with the Shake (step 8).

### 6.8 The kernel reference (one click deep)

- **The estimate.** A regularised impulse response from u to y (lags 1…n; the TC kernel, P(i, j) = c·λ^max(i,j); Pillonetto et al. 2014; Chen, Ohlsson & Ljung 2012).
  - It is computed on the whole fitting record, block-averaged and decimated so that n ≤ 150 taps cover the slowest settling seen.
  - Integrating plants are fitted on Δy.
- **Hyperparameters** (c, λ, σ²) come from the marginal likelihood: a fixed grid over λ, then golden-section refinement, at most 40 evaluations. The TC kernel's inverse is tridiagonal (Carli, Chen & Ljung 2017), so each evaluation is one Cholesky.
- **Uses:**
  - an order-free curve with its band on the Step and Bode plots ("what the data say without choosing a shape");
  - start values for §6.3;
  - a ceiling: when the chosen structure's Check fit is 5 or more points under the kernel's (replayed the same way), the model says "the shapes on offer miss something here", and the grade drops to !.

**Built** (`tcKernel`, `tcKernelSteps`, `kernelStep`, `kernelGuess`, `tcInverse` in `fit.js`; `eigSym` in `linalg.js`; test 10):
- **Decimation keeps y at its full rate.** A tap is the sum of the impulse response over D lags, and its regressor the mean of u over those lags; every regressor lies strictly in the past, so with white noise the estimate is consistent in closed loop (measured: a lag and an integrator under a PI, the steady gain within 3σ of the truth). Block-averaging y as well would add a lag-0 term that feedback biases. Measured on the research's example: 150 taps of 20 ms fit as well as 300 of 10 ms (below).
- **An integrating plant is fitted as a rate**, not on Δy: y − y0 = r·Σ(u − u0) plus a TC part that holds the difference from the rate, r with a flat prior, integrated out of the likelihood. On Δy the noise is coloured (v[k] − v[k−1]) and the loop feeds it back: under a PI, k′ came out 3.45 for a true 3 on every seed; as a rate it is within 1.3σ. g is then y's own impulse response, the same for both kinds.
- **The search.** λ = e^(−a/n), a on a grid of 9 decays (0.5 … 128 over the n taps), then golden section in log a to 1 %: about 22 evaluations, never above 40. Each evaluation is one symmetric eigendecomposition of E^½ Uᵀ ΦᵀΦ U E^½, where K = U E Uᵀ and K⁻¹ = U⁻ᵀ E⁻¹ U⁻¹ is the tridiagonal inverse; it gives −2 log L for every c in O(n), with σ² profiled exactly. "One Cholesky per evaluation" cannot search λ alone: c and σ² would need their own search at each λ. An eigendecomposition costs about four Choleskys (10 ms at 150 taps). The estimate and its covariance then take one Cholesky.
- **Checked against the direct N×N formulas**: −2 log L, the posterior mean and covariance, and the rate with its variance agree to 1e-9; 1 % changes of c, λ or σ² all raise −2 log L.
- **The research's example** (2e^(−0.1s)/((0.5s + 1)(0.1s + 1)), Ts 10 ms, a random binary ±1, 30 s, SNR 3): impulse-response fit 94.3–96.1 %, mean 95.1 % over 10 seeds; gain 1.93–2.05; σ within 6 %. SNR here is the ratio of standard deviations; with it, 300 taps undecimated give 94.4–95.3 %, the research's 95.6 %. As a ratio of variances (more noise) the fit is 91.4–94.2 %.
- **Start values** (`kernelGuess`): the gain from the sum (k′ from the rate), θ where the step reaches 2 %, τ at 63 % less θ, f and ζ from an overshoot. Measured: two lags K 2.0, θ 0.14 (true 0.1), τ 0.55; a resonance f within 15 %, ζ within 30 %; an integrator k′ within 2 %.
- The kernel is a generator (`tcKernelSteps`, a yield per evaluation) so the page can slice it.

### 6.9 Built (step 5)

`identifySteps(record, { plan })` in `src/core/identify.js` (test 12: the same record gives the same model, bit for bit). Where the build made §6 more precise ([decisions.md](decisions.md) has the measurements):

- **Segments.** The Nudge and the rest after it are one open-loop segment (u as applied, drift taken out). The Hold, then each try from a settle that succeeded to the next one, are closed-loop segments up to the fit pause's start (the record's `supply`): the pause and the Check are never fitted. A try whose settle ran out (the oven cooling with its heater off takes longer than the 4 s) does not cut: its data stay in the segment before. A segment starts from the mean of y and u over the 0.5 s before it, and its law starts bumpless there (the integral that holds that rest, against r just before the segment); every later switch in the log is replayed bumpless on the model's own y. Fed the measured y, the replayed law gives back every u the experiment sent (to the 6 digits the record keeps). Lost cycles are put back with u held and no measurement.
- **The Check is replayed from the last rest**: the Check reference's start if the incumbent settled y there, else the pause's end, else the last settled point fitted, and it is graded from the Check's start. Measured: the oven's pause (2 s) ends with T still at 13 °C, falling, and a replay "at rest" there scored 87 % where the model is 99.8 %.
- **No Check** (a stopped test, a band exit before it) or a Check on which y did not move: the candidate with the lowest BIC on the fitting data (differences below 2 go to the simpler), graded on the fitting data and at best !, "no Check ran".
- **Where** refits the chosen structure's gain and main time scale (τ, τ₁ or f) per third of the levels visited (y₀ and every level r held), θ, ζ and a second lag held at the main fit's, on all the fitting data at once: the model switches by where its own y is, and so that switching is physics its restoring part runs through the hold curve u*(y), continuous, with slope 1/K of the place it is in (ẋ = (A + bC)x + bK(u − u*(y)), b = B/K; an integrator holds anywhere with the same u). Cutting the record into step pieces and refitting each third alone, as first built, measured the path of each large step, not the place: on the arm it put the gain near 1.5 rad at 0.45 rad/V, where the arm's is 7. Places differ when gain or time scale differ by more than 25 % and beyond their 2σ bars, among the places the model spent a twentieth of its time in (a tenth as first built; after review the tries' tails add rest at the low place). The hold curve beside it is measured where y stood still at r (the mean u over 0.5 s). Measured below: the tank's three places within 3 % in gain and 2–12 % in time constant of its linearisation; the arm's low place within 4 %, its high place understated (§ Measured).
- **Size**: the rungs at the Nudge's last length, gain = y at the end of the first half over the push; when the smallest push moves y less than 0.75 × as far per unit as the largest, the sentence about friction or a dead band.
- **The bands** (the Check plot's 2σ) come from 50 parameter samples drawn with `gaussAt` in the fit's own coordinates (logs, θ in samples); a sample that cannot be discretised is left out.
- **The kernel** is fitted on everything from Listen to the fit pause, covering 1.5 × (θ + 4τ) of the first look; its replay on the Check (an FIR with its rate, fed back through the same law) is the ceiling of §6.8.
- **Noise**: "no noise" when Listen's σ and q are below half the floor the experiment allows (a simulation); an encoder's steps are Listen's q or, when y stood still in Listen (a motor at rest), the grid y moved on during the test above the grid the record is rounded to.

### 6.10 Built (input 56): a dead time and a resonance told apart

The person ([input 56](../input/2026-10-25-56-dead-time-vs-resonance-another-check.md)): "They are two different things … if you run into that situation, there should be another check." Built on branch `feat/identify-tab`, before the Shake ([decisions.md](decisions.md), v2.9):

- **The onset test** (`ONSET`, in `identifySteps`): after each visible push of the Nudge, the time y has gone a tenth of the way to its peak in the push's direction and stays beyond four noise floors for two samples; the earliest over the pushes is the onset. A candidate whose dead time is longer than the onset by more than a sample is ✕ "moves before its dead time: after a push angle had gone a tenth of its way in 30 ms, before this shape's 157 ms". Interpretation of "the time y first leaves its noise band": a tenth of the response, beyond the noise, since a fitted dead time also stands for a slow start (the oven's three lags and 0.1 s pipe read as 0.137 s; by then y has moved far less than a tenth; on a noise-free simulation the first sample out of the noise would refute every oven shape).
- **Measured**: on the five arm draws of "Measured" below, the lag and the two lags (θ 0.15 s) are refuted on every draw and the resonance is chosen: K 0.43–0.60 rad/V, f 0.82–1.00 Hz, ζ 0.36–0.43, θ 6–16 ms, 78–84 % on the Check (as before); the first sentence reads "Responds after 6–16 ms" where it read 157 ms. The oven (two lags), the motor (integrator · lag) and the tank (lag) keep their shapes.
- **The discriminating test** (`designDiscrimination`, the experiment's stage after the Check, `tellApart`): when two supported shapes still lie within 1 point on the Check, the experiment brings y back to r(0) and asks the page; the page simulates both under the incumbent from there for a pulse, a step and a burst at either shape's frequency (faded in and out), sized at the largest push the loop used and smaller where a shape predicts more than half the room, and picks the input whose predictions differ most against the noise (Box and Hill; T-optimality). Below 20 floors apart (the floor at least a thousandth of the band) they "predict the same within the noise on any test the room allows: the simpler is kept", a note, and nothing is played. Otherwise the experiment plays it on the incumbent's output and logs it (`discriminate`: shape, size, length, frequency, the two shapes); the model keeps the shape that predicts it, if clearly: its miss at most 0.9 of the other's and its own fit at least 60 %; else the simpler stays and the reason says the test did not tell them apart either. The live loop asks and supplies the same way (`discriminateSteps`).
- **Measured**: a resonance at 0.6 Hz with 30–50 ms of dead time, the lag made to tie with it on the Check by hand: a burst at 0.52 and 0.43 Hz, the resonance predicts it at 95 % and 97 %, the lag at 68 % and 81 %. On the library's oven, motor and tank the shapes that tie predict the same, and no test runs. On the arm, with the onset test left aside, a burst at the resonance's frequency is predicted worse by the resonance (34–47 %) than by the lag (57–63 %): at r(0) the arm moves within its friction, where neither linear shape holds; hence the 60 % floor, and the onset test, which settles the arm.

## 7. Validation and grades

**Measures:**
- **Fit** on the Check: 100 (1 − ‖y − ŷ‖ / ‖y − ȳ‖), as MATLAB's `compare` defines it.
- **The noise ceiling**: 100 (1 − floor·√N / ‖y − ȳ‖), the best any model could do on this noise.
- **Pattern in what is left**:
  - the residuals' autocorrelation over lags 1–25 within ±2.58/√N;
  - their cross-correlation with past u over lags 0–25.
  - "A pattern" is two or more lags outside the band, or one beyond 1.5 × it (white residuals show one in about 3 % of records). The autocorrelation removes no mean (Ljung), so an offset is a pattern; the cross-correlation uses u less its mean.
  - **On the Check** (after review) each lag is read against what the replayed loop gives white noise, Σh_q h_{q+τ} / Σh² with h the loop's noise transfer: its residual is S·v, coloured even for the true model. Measured (a lag under its SIMC PI at τc = θ, 100 seeds): the true model read "a pattern" in 68 as built, 6 so; τ 20 % off in all 100. The noise's own colour is not taken out: from Listen's 150 samples it is too unsure for the Check's band (white noise then read "a pattern" in a third of seeds). When Listen heard coloured noise, the reason says so.
  - The cross-correlation in closed loop is shown, never graded: under feedback lag 0 is always correlated (it flagged 13 % of true models at τc = θ).
  - In words: "what is left looks like noise", "what is left has a pattern", or "what is left has a pattern, as the noise at rest has".

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

**Built (step 5, `modelSentences`):**
- "Responds after …" only when the dead time is at least a tenth of a sample and stands beyond its 2σ bar (after review: a bar alone let "0.0028 ms" through at 10 ms; the review asked for half a sample, which would drop the design's own "2 ms" at 10 ms, so a tenth).
- "Swings at about … Hz" only below ζ 0.7 (an overshoot of 5 % or more), at the frequency the swing is seen at, f·√(1 − ζ²); the design's example said f. "Settles in about …" is the model's 2 % settling time.
- The where sentence names the lowest and the highest place the model spent a twentieth of its time in (a tenth as first built); the size sentence comes when the smallest push moved y less than 0.75 × as far per unit as the largest: "At ±0.48 V it moves less than at larger pushes (friction, or a dead band): this model is for pushes near ±0.96 V and more."
- Noise: "This plant has no noise; real plants do." (a simulation), "Noise on angle: only its steps of 0.0015 rad (an encoder)." or "Noise on angle: 0.0011 rad, in steps of 0.0015 rad (an encoder)."
- The grade's sentence gives whole points, one decimal from 99 % ("99.7 %", at most 99.9 %, rounded as the Check line and the candidates round it; first built it truncated, so 99.75 read 99.7 beside a Check of 99.8); without a Check, "explains … % of what it was fitted to; no Check ran"; ✕ adds "Auto-tune can tune on it, but Try on the plant will tell; a larger room or a longer test helps." Above six sentences the noise one is left out first.

## Measured: the whole test in Node (step 5)

`identify()` runs the experiment as the block's hidden law in a copy of the diagram (`createStepRunner`, the r Source playing `reference(k)`, d held at 0) and computes the model from the record as Keep stores it; `node cli.mjs identify` prints it. Wall time 4–9 s per run in Node, CLI start included; the fits take 1–4 s of it.

**The command line on the library's oven and motor** (their own diagrams, which have no noise, so the residuals of any approximate model are a pattern and the grade is !):

| | Plant time, tries | Model, Check fit | Parameters (±2σ) | The truth |
|---|---|---|---|---|
| Oven | 119 s, 7 (6 ✓, ! rang) | two lags, 99.8 % (kernel 99.7 %) | K 0.99917 ± 0.00011 °C/%, τ₁ 0.494 s, τ₂ 0.120 s, θ 0.135 s | K 1; lags 0.5, 0.1 and 0.05 s, 0.1 s to the sensor (τ₂ + θ = 0.255 s stand for 0.1 + 0.05 + 0.1) |
| Motor, position | 36 s, 3 | integrator · lag, 99.9 % | k′ 1.4298 ± 0.0002 rad/(V·s), τ 0.0502 s, θ 0.0101 s | k′ = Kt/(R·b + Kt·Ke) = 1.4286; lags 0.0481 and 0.0119 s (τ + θ 0.0603 s for 0.0600 s) |

The sentences, for the oven: "Responds after 135 ms. Settles in about 2.2 s. 1 % more gives 0.99917 ± 0.00011 °C more. This plant has no noise; real plants do. Explains 99.7 % of a test it was not fitted to; what is left has a pattern !". The gentlest controller that held: the oven's try 6 (Kp 1.68, Ki 1.42), the motor's try 1 (Kp 3.46, Ki 4.28).

**The command line on five arm draws**: `test/fixtures/arm-project.mjs` builds the HIL arm as a simulated project (hil_plant.py's physics in blocks, 1 mrad of noise, a 4096-count encoder, the 2 ms round trip; it agrees with the ported arm within 5 mrad), and `--vary 0.15 --seed 1…5` hides a draw of each physical parameter. The truth is the arm's linearisation at a place, (k/R)/(mgl·cos θ), from the factors drawn.

| Seed | Plant time, tries | Model, Check fit (kernel) | K, τ, θ | At rest: true K, f, ζ | Near 0.25 rad: found (true) | Near 1.2–1.3 rad: found (true) |
|---|---|---|---|---|---|---|
| 1 | 68 s, 6 | lag, 79.5 % (81.3 %) | 0.562 rad/V, 0.168 s, 0.157 s | 0.489, 0.93 Hz, 0.20 | 0.504 (0.504) | 0.83 (1.55) |
| 2 | 63 s, 5 | lag, 83.0 % (83.4 %) | 0.487, 0.119 s, 0.147 s | 0.419, 1.09 Hz, 0.20 | 0.436 (0.433) | 0.98 (1.33) |
| 3 | 63 s, 5 | lag, 82.7 % (83.1 %) | 0.450, 0.114 s, 0.149 s | 0.384, 1.11 Hz, 0.18 | 0.397 (0.396) | 0.94 (1.22) |
| 4 | 71 s, 6 | lag, 80.3 % (83.0 %) | 0.619, 0.174 s, 0.147 s | 0.549, 0.94 Hz, 0.23 | 0.554 (0.566) | 0.94 (1.74) |
| 5 | 77 s, 7 | lag, 77.3 % (63.8 %) | 0.590, 0.187 s, 0.148 s | 0.531, 0.90 Hz, 0.20 | 0.530 (0.548) | 0.70 (1.68) |

- Every run ends done, inside the band, in 63–77 s of plant time; the noise ceiling is 99.6 %, so the 77–83 % is the arm's nonlinearity, not its noise (E2 measured 71–77 % for its resonance).
- **The model chosen is a lag with an apparent dead time of about 0.15 s** on every draw: the Check cannot tell the lag, two lags and the resonance apart (within 1 point of each other), so the rule of §6.4 takes the simplest. The resonance fits the fitting data better (81–86 % against 76–81 %), with θ 7–17 ms, f 0.81–1.01 Hz and ζ 0.38–0.43 (against the arm's 0.20 at rest: its friction damps the swing). So the first sentence reads "Responds after 157 ms" for an arm that starts moving within 2 ms, slowly: the lag's dead time stands for the arm's slow start.
- **Where**: near rest the arm's own gain within 0–4 %; near 1.2–1.3 rad 0.70–0.98 rad/V, where the arm's is 1.22–1.74 there and 5.4–7.8 at 1.5 rad: the right direction, understated by 25–60 %. The arm holds 1.5 rad still, so the high third is seen only while the arm passes through it; a closer look needs the Shake there (step 8). Four of five draws say "Behaves differently at different places"; on the fifth only the low place had a tenth of the model's time (the high one 9.5 %), so there was nothing to compare it with.
- On two draws the kernel's step still rose at its end and the integrating structures were tried too (✕, the Check fit below 30 %).

**Test 13's identify part** (the library's systems through their diagrams with a sensor's noise, as in test 5, and the ported arm):

| Plant | Model, Check fit (ceiling) | Grade | Against the truth |
|---|---|---|---|
| Oven, σ 0.1 °C | two lags, 99.0 % (99.0 %) | ✓ | its step within 0.45 % of the three lags' and dead time's |
| Motor, encoder | integrator · lag, 99.9 % | ! (a pattern: an encoder only) | k′ within 0.1 %, the step within 0.06 % over 1 s |
| Conical tank, σ 1 mm | lag, 92.3 % (98.9 %) | ! (places, pattern) | per place K 2.24, 3.19, 3.82 m/(m³/s) and τ 0.223, 0.696, 1.51 s at 0.26, 0.48, 0.69 m, where the tank's linearisation has 2.29, 3.11, 3.76 and 0.199, 0.680, 1.54 |
| Five arms (±15 %) | lag (4) or resonance (1), 79.6–83.4 % (99.6–99.7 %) | ! | near 0.25 rad within 4 %; near 1.2–1.3 rad 0.74–1.13 rad/V against 1.32–1.69 |

**After review** (the numerics, the experiment and the sentences reworked, §5.10, §6.5, §7; the same commands):

| | Plant time, tries | Model, Check fit (kernel) | Parameters | Notes |
|---|---|---|---|---|
| Oven (no noise) | 112 s, 6 ✓ | two lags, 98.9 % | K 0.9765 ± 0.0005 °C/%, τ₁ 0.480 s, τ₂ 0.122 s, θ 0.137 s | ! (a pattern: no noise); K 2 % low where it was 0.1 %: the capped first tries ramp the heater up, so the record has more of the oven rising than holding |
| Motor | 49 s, 5 (3 ✓) | integrator · lag, 99.9 % | k′ 1.4295 ± 0.0013, τ 0.0500 s, θ 0.0102 s | the settling candidates ✕ (time constants beyond 10 × the test, ζ 600) |
| Arm, seed 1 | 78 s, 5 | lag, 79.6 % (81.3) | K 0.557, τ 0.152 s, θ 0.167 s | near 1.25 rad 1.43 rad/V (true about 1.55) |
| Arm, seed 2 | 62 s, 4 | resonance, 84.1 % (84.2) | K 0.490, f 0.98 Hz, ζ 0.37, θ 9 ms | near 1.25 rad 0.88 (1.33) |
| Arm, seed 3 | 64 s, 4 | lag, 81.9 % (82.6) | K 0.446, τ 0.121 s, θ 0.147 s | near 1.25 rad 0.86 (1.22) |
| Arm, seed 4 | 79 s, 5 | lag, 80.0 % (81.8) | K 0.612, τ 0.162 s, θ 0.154 s | near 1.25 rad 1.04 (1.74) |
| Arm, seed 5 | 78 s, 5 | lag, 77.6 % (79.6) | K 0.591, τ 0.160 s, θ 0.173 s | near 1.25 rad 1.29 (1.68) |

All five arms now say "Behaves differently at different places" (a place counts from 5 % of the model's time: the tries' tails at rest added time at the low place, and the high one held 7–9 %; its bars must still part the places); the high place is still understated (0.51–0.92 of the truth there), for the Shake (step 8). Test 13's arm part asserts it two-sided around the truth.

**Fixed after review: the library's tank without noise.** With the rest wait of §5.10 ("After review") it is identified: 5 tries in 68 s, a lag, 92 % on the Check (!: places and a pattern), "near 0.26 m, 1 m³/s moves it 2.2 m; near 0.69 m, 3.6 m". As first built: `identify()` on its own diagram (no Noise block): Listen's floor is the smallest allowed, so the first push (0.03 m³/s for 40 ms) is already "visible"; the Nudge doubles a twice and stops at half the room below, with pushes of 40 ms against a pipe of 0.1 s, and a rung's wait for rest ends while the delayed response is still under way. The first look reads the tank as reverse-acting, the gentle loop fills it to its rim (1 m, inside the band, which reaches 1.02 m), and the model is ✕ with "The Check did not move h, so the model could not be checked". With 1 mm of sensor noise (test 13) the Nudge grows longer pushes and the tank is identified. The rest wait (§5.10) should cover the dead time it has seen; for the experiment's next pass.

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
- **Built (step 5):** `normalizeIdentify` in `project.js` keeps `band`, `budget`, `hard`, `vary` ({ share, seed }), `seed`, `structure`, `use` and `kept` ([{ name, plan, record }]), checks each, and refuses any other key, there or in a kept test, its plan or its record, with the sentence. After review, at every depth: the plan's parts (`test`, `check`, `names`, `others`), the record's `ports`, and the log, whose entries keep the experiment's own decisions (Listen's noise, each rung, the first look it steered by, each law, try and stop), each kind with its own fields and the objects inside them theirs (interpretation of "nothing computed in the file": the log is what the experiment measured and chose as it ran, never a model of the record; `identifySteps` reads the look's sign, class and time scale from it to replay what ran). The record is kept as the run made it once compacted (u, r and applied to 6 significant digits, y to a tenth of Listen's floor), and Identify computes its model from that compact form too, so the model a run shows and the one its kept record gives are one.

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

### 10.1 Built (step 9)

`twinDiagram`, `testPush`, `modelProject`, `identifiedLoop`, `loopRanges` and `keptModel` in `identify.js`; `diagramCost` and `resultName(…, { onModel })` in `autotune.js`; the plant source in the Auto-tune and Analysis tabs; `node cli.mjs autotune <project> --plant identified`; test 13's harness in `test/identify-e2e.test.mjs`. Where the build made §10 and §12 more precise ([decisions.md](decisions.md), v2.9):

- **One switch per block**, `system.identify[key].source` ("identified"; absent: the diagram), set from either tab's "Plant: Diagram | Identified model" or the Identify tab's **Use for Auto-tune and Analysis**; on a live plant always the model (Diagram greyed out: "a plant outside the page has no diagram to tune on"), and without one both tabs say in red "the plant runs outside the page and is a black box: … identify the plant first (Identify tab)".
- **The twin sits where it was measured.** The model is incremental; the twin takes u₀ off its input and adds y₀ to its output (Equations blocks; Listen's rest), so in the loop it rests where the plant did. **Its dead time follows its dynamics** (they commute): the Dead time block interpolates its input between steps, and on the held u the twin was 1–3 % off the exact replay; after the dynamics, where its input is smooth, it agrees with the replay to 3e-7 (test 11 now asserts 2e-6 with a dead time too). A Sink that showed the measurement shows the twin's; a simulated plant runs on beside it, cut off; an External plant leaves the copy.
- **The test push follows the tester's d** where d plays (its shape and times, scaled to the push), else a step at 60 % of the period. Interpretation of "where the tester's d steps": the oven's d is a 0.8 s pulse, and a push that stayed on left the tuner blind to its release; tuned against the pulse, the oven's result scores 0.92 × the best on the true plant (2.17 × against a step).
- **Analysis on the model** linearises the twin where the run starts (it is linear), labels it with the range identified, leaves out "u at its limit" (the model holds about its range, not at a state), shows the grade's sentences as notes, and gives the gain margin, phase margin and Ms across 12 parameter samples and the places ("×2.47 (×2.44 … ×2.52)"); its Bode plot shows the Shake's points as L̂ = Ĝ·C. The operating point keys are hidden: they do not apply.
- **Results are named "· auto-tuned (model)"** (and "· relay T–L (model)", "· SIMC (model)"); on a simulated plant the status reads "115 runs on the model (identified 15:55, ! explains 99 %). On the model 0.0969 · on the diagram 0.11 (it was 1.28)."
- **Measured (test 13)**, tuned on the model, scored on the true plant against Nelder–Mead on the true plant itself: oven 0.110 against 0.120 (× 0.92), motor 0.114 against 0.114 (× 1.00), tank 0.141 against 0.073 (× 1.95: one linear model across its nonlinear range, reported as designed; its loaded schedule started at 0.085), arms 0.70–0.87 against 0.38–0.39 (× 1.8–2.3: tuned on the low place's model, the PI overshoots 31–41 % where the arm's gain is 3–4 × higher). E2 measured × 1.1–1.5 on its arms. Interpretation: the arms are reported, not held to 1.3; what they need is tuning over the places (§19, robust tuning), and Try on the plant (step 10) screens each step on the places' models.
- **On the real plant script** (seed 1): before identifying, both tabs say the plant must be identified first; after a 33 s test (a resonance, 90 % on the Check), `loopTuner.autotune()` tuned the P on the model (Kp 1.37), Analysis gave stable, gain margin ×13.7 (×9.9 … ×14.6), phase margin 48° (40 … 53°), Ms 1.75 (1.68 … 1.93), and the tuned variant ran on the plant.
- **Not yet**: Auto-tune on the model while a live plant is connected sweeps at 1× (the plant owns the clock); `loopTuner.autotune` runs at once.

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

- **The plant.** With the identified source, `app.loopModel(path, 'identified')` returns the model's `LinearModel` (§16): A, B, C, D of the chosen structure, its states labelled by the chain ("lag", "resonance.x1"), `delay: [θ]`, `sensors: [{ std: σ, q }]`, `op: { kind: 'identified', label: 'identified 14:02 over 0 … 1.5 rad' }` (built: the levels the test visited, the Where places' outer edges, not the band), and the grade's sentences in `warnings`. Discretisation, margins and plots are unchanged ([analysis.md](analysis.md)).
- **Ranges.** Every key number is computed for the nominal model and, as a range, over the per-place fits and the band samples: "gain margin 3.1 (2.4 … 4.0 across what the model is unsure of)".
- **Measured points.** When a Shake ran, the Bode plot shows the measured points with their bars.
- **Notes** carry the grade and the where sentence.
- **On HIL** only the identified model exists. Designed variants (LQR, PI from the plant) reading the identified model on HIL come later (§19).

## 13. Simulated plants: the teaching comparison

**The experiment** runs on a copy of the diagram, exactly as on HIL. The diagram's own Noise and Quantizer blocks apply. A diagram without noise gives near-perfect data, and the model says so: "this plant has no noise; real plants do".

**Compare with the diagram** (a toggle in the Check column, simulated plants only). It needs the design layer's `linearizeBlock` ([designs-in-the-page.md](designs-in-the-page.md) §5; merged).
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
- **Built (step 5, `varyDiagram`):** flagged in the block definitions are a Gain's K, a dead time, every plant block's gains and time constants (first and second order, n lags, integrator with lag, inverse response), a transfer function's denominator term by term (the motor's 1/(L·s + R): L and R; its numerator is structure), and the physics models' masses, lengths, friction and the tank's radii, height and outlet. Since the physics models are masked subsystems (transparent-models.md), a masked model varies its mask's physical fields (`physicalMaskKeys`, as the HIL simulator does: every field but g and the start values), each drawn on its own and labelled by the model's name and the field ("tank, Outlet area a"); the Mechanics parts drawn directly flag a Mass's m, a Rod's l and m, a Rail's friction and a Hinge's damping. A mask that flags its own physical fields (`physical`: the Servo motor's R, L, K, b, Jm and the coupled gear's k and c) varies those, and a field folded under a toggle or choice that is off (the gear's stiffness on a free shaft) is left; a component's insides are its table's, set by its mask, and are not walked. The Servo motor's K is one field for Kt and Ke, so the motor's examples keep them one constant by construction ("Motor, Torque and back-EMF constant −7.4 %"). Not flagged: g, start values, an Integrator's K (angle = ∫ speed is kinematics, not a part), limits, noise, quantisers, Sources, Sinks, Controllers, Observers, ports. Two Gain blocks with one value in one subsystem are one constant and get one factor (a motor drawn from Gains, as the unbalanced arm's: its Kt and Ke equal in SI units, or the motor would make energy); every other parameter is drawn on its own, in the order the blocks are listed. The factors carry the block's name and the parameter, for the reveal, and (after review) a plain label: a gain by its block's name, a transfer function's coefficient by its power of s ("armature 1/(Ls + R), its s term +0.48 %"). **A known limit** (review): equal values are linked whether or not they are one constant, so unrelated equal gains (a damping c equal to a spring k) share a factor and structural gains (−1, a unit conversion) are varied as if physics; the arm fixture keeps its mgl in a subsystem of its own for that. An explicit link (a tag on the parameter) is the fix; it changes the library's data, so it waits for the overhaul's shared configuration.

## 14. The HIL plant's unknown variation

- **The page measures the plant that is connected.** `hil_plant.py` draws its plant within ±15 % at each script start (`--vary`, `--seed`, `--set`; [hil.md](hil.md)). The page is not told, as with a real device.
- **A new connection may be a new plant.**
  - The model remembers the connection it was measured on.
  - After a reconnect it is marked "measured on an earlier connection: the plant may have changed", in all three tabs.
  - **Check again** runs Hold and Check alone, about 10 s. A fit within 5 points of the original is "still fits ✓"; a worse fit is "the plant has changed: identify again".
  - A `start` request alone does not change the plant: the variation is drawn per script start.
- **Kept records from several plant draws** show the spread ("0.49 … 0.56 rad/V over 3 kept tests"). Tuning for all of them at once (the worst case) is the Auto-tune robustness item, later.
- **The truth is printed only at the plant.** For the tests, the arm's physics is ported to a test fixture with the same ±15 % draws, so the end-to-end harness (§17) scores every result against the plant it really ran on.

### 14.1 Built (step 7): the connection and Check again

- **The connection.** The page counts its connections; a test run on a live plant remembers the one it ran on (a kept record, for this page session). On another connection, or for a record kept in an earlier session, the model column says "Measured on an earlier connection: the plant may have changed. Check again tells." (Auto-tune and Analysis say it with step 9.)
- **Check again** (`planRecheck`, the experiment's plan kind `recheck`) runs Listen (3 s: the noise, which the controller's settling needs), then the controller that held the Check before (its gains and limits from the log) brings y to the Check's start, and the Check's reference as it was played; 10–15 s on the oven and the motor. Interpretation: "Hold and Check alone" with Listen first. **The verdict** (`recheckFit`) replays the model over the new Check from its settled start, and compares it with the same replay of the original record's Check, not with the model's graded Check fit: on the arm the graded fit replays from the last rest before the Check (79–84 %) and the replay from the Check's own start reads about 10 points lower on the same plant, which called every arm "changed". Measured on the simulated arm (±15 %, seeds 1–5): the same draw 0–1 points apart, still fits; on the oven and the motor varied by ±30 % (seed 2), 99 % → 82 % and 99 % → 86 %, "the plant has changed".

## 15. Protocol and plant changes (built first)

**Built 2026-10-25** ([hil.md](hil.md#hard-ranges-and-applied-inputs-2026-10-25), `test/hil-protocol.test.mjs`), with these deviations from the plan below:
- **The hard range is `hard_min`/`hard_max`**, not `min`/`max`: an output's `min … max` was already its full scale (what the scope spans, hil.md v2.7). The hard range normally lies inside it (the arm: full scale ±π, hard range ±2.5 rad).
- **Current ±10 A**, not ±7 A: the library's PID peaks at 6.9 A on a plant varied by 15 %. The heater's T is 0 … 110 °C. These ranges replace the plant's earlier monitoring.
- **`applied` is the inputs in effect at the end of the cycle** (the last u that arrived in it, after the clamps and `--slew`), not a time average over it, so `applied` at sample k is the answer to y k−1 as the plant applied it.
- **The live record names them `applied.NAME`** (`applied.V`, `applied.load`), in the inputs' units; the screen's save leaves them out.
- **"Used"** (test 15's third point) waits for the experiment (step 4), which reads them; this step records them. `--check` now also E-stops each plant beyond a hard range (the "`--check` E-stops" of test 15).

**Additions to `loop-tuner-hil/1`.** Both are optional; the protocol name stays, and the page works without them.

| Where | Addition | Why |
|---|---|---|
| `describe` → `outputs[i]` | `hard_min`, `hard_max` (the hard range; planned as `min`, `max`) | "The plant keeps itself safe" is not yet true for outputs: today it E-stops only on its watchdog, its stop key, a lost page or a request, and it clamps only u |
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
// src/core/identify.js (no DOM; built in step 4 up to planExperiment)
export class IdentifyError extends Error { constructor(code, message, hint) }  // code, message (the sentence), hint
export function knownFor(project, path, { describe, link } = {}) // → Known: { block: { path, key, where }, live,
                                                            //   u: { name, unit, min, max, u0, from, start }, y: { name, unit, hard, from },
                                                            //   r: { lo, hi, span, source, period, samples, Ts } | null, Ts, others: [{ name, value, input? }] }
                                                            //   link: { connected, estop } on a live plant; throws IdentifyError
export function defaultBand(known, hard)                    // → { band, from: 'r' | 'plant' | null } (§2)
export function identifySettings(project, path, opts)       // → { band, budget, hard: { value, from }, vary, structure, seed }
export function settingsFor(known, stored)                  //   the same from a Known and system.identify[key]
export function planExperiment(known, settings)             // → Plan (data): { version, kind, Ts, u0, umin, umax, band, hard,
                                                            //   budget, seed, names, test: { r } | { r0 }, check: { r } | null, others }
export const BUDGETS, BUDGET, BAND                          // 30 s … 10 min, 120 s; the band's widen, still, inset
// src/core/experiment.js (no DOM; built in step 4): the state machine, apart so that controllers.js's hidden
// 'experiment' type (step 5) can import it without a cycle through autotune.js
export const IDENTIFY_VERSION = 1
export const EXPERIMENT                                     // every threshold, named (Listen, Nudge, look, Hold, ease, pause, check)
export function createExperiment(plan)                      // → Experiment, the causal state machine:
//   step(k, y, applied?) → u              one controller sample (k: the plant's seq; a jump is a gap)
//   reference(k) → r                      what the r Source plays at sample k (asked before step(k))
//   needs → null | { kind: 'fit', upto }  a heavy job the runner must supply
//   supply(kind, data)                    the fit and the Check's prediction, as data
//   stop(), abort(reason)                 Stop (soft); an E-stop or a lost plant
//   state → { stage, chips: [{ stage, label, mark }], rung, try, tries, push, pushMax, room, roomMax, marks,
//             status, t, budget, done, end: { code, message, i, t }, stop }
//   found → { listen, rungs, look, gentle, incumbent, test, check }   (computed, never stored)
//   record() → Record                     { version, Ts, u, y, r, applied, gaps, log, end }, plain data
export function gentleGains(look, tauC, Ts), gentleTauC(look, Ts)   // SIMC's robust branch (§5.3)
export function piLaw(gains, I0, lo, hi, Ts), bumpless(gains, u, r, y) // the PI = controllers.js's pid (Kd 0, clamping)
export function tryCost(r, y, u, { R, U, lo, hi })          // runCost with the default goal, on a try's arrays
export function tryMargin(r, y, band, h)                    // → { g, gRoom, gRing } (§5.4)
export function listenStats(y, Ts, { span })                // → { y0, sigma, q, floor, slope, drift, drifts } (§5.1)
export function staircase(r0, band, share, hold), halved(r) // the references (§5.4, §5.7)
// src/core/identify.js, built in step 5 (no DOM)
export function* identifySteps(record, { plan, structure, upto, reuse } = {}) // yields progress (LM iterations, kernel
                                                            //   evaluations); returns IdentifiedModel. plan: the plan the record
                                                            //   ran (its names, band, limits; Keep stores it beside the record);
                                                            //   upto: the last sample fitted (default the fit pause's start);
                                                            //   reuse: a model of the same data whose fits it takes (identify())
export function segmentsOf(record, plan, { upto })          // → { F, open, closed: [segment], check, holds: [{ y, u }], levels }
export function replay(record, model, segment)              // → Float64Array, the model's y for a segment of segmentsOf
export function compactRecord(record)                       // the record as Keep stores it: u, r to 6 digits, y to a tenth of its floor
export function modelSentences(model, names)                // → [string]; names: the plan's names or a Known
export function gradeOf({ fit, ceiling, white, distortion, spread, kernelGap, left, checked }) // → { mark, why } (§7); GRADE
export function withBar(value, sd)                          // "0.53 ± 0.02": a number to the digits its ±2σ allows (§8)
export function linearModel(model)                          // → LinearModel { A, B, C, D, states, inputs, outputs, op, delay,
                                                            //   sensors, warnings } (continuous; Analysis discretises)
export function twinSubsystem(model, { push, noise, id, name }) // → a subsystem block of the Plant library's own blocks: gain,
                                                            //   dead time, first or second order, integrator, noise, quantiser
export function varyDiagram(diagram, share, seed)           // → { diagram, factors: [{ path, block, param, value, factor }] }
export function identify(project, path, settings)           // Node and CLI: the whole test on a simulated plant, synchronously:
                                                            //   → { ok, block, plan, settings, vary, record, model, end, time, tries }
// the later steps
export function planTry(known, model, steps, incumbent)     // → Plan of kind 'try' (§11)
export function twinDiagram(diagram, path, model, opts)     // → a diagram with the twin in the plant's place

// IdentifiedModel (built) = { version, ok, Ts, names, band, end, structure, label, glyph, params, sd, cov, chosen
//   (why), chain: [{ kind, key, label, value, sd, unit, tip }], candidates: [{ structure, label, glyph, params, sd,
//   fit (on the Check), fitted (on the fitting data), chi2dof, bic, unsupported, grade, why }], noise: { sigma, q,
//   floor, drift, none, steps, coloured }, fit, check: { fit, ceiling, white, independent, grade, why, kernel, i0, i1, left,
//   y, yhat, band, autocorrelation, crossCorrelation, limit } | null, where: [{ level, from, to, gain, gainSd,
//   scale, scaleSd, scaleKey, samples, seen, hold, holdAt }], holds: [{ y, u }], whereSpread: { spread, flagged },
//   size: [{ a, gain, complete }], sizeNote, kernel: { g, sd, Ts, decimate, integrating, rate, fit } | null,
//   eased: { Kp, Ki, tauC, umin, umax, try }, grade, why, warnings, segments, sentences, connection }
//   (frf, with the Shake, step 8). ok: false carries message, why and sentences only.
// The Experiment's machine runs as a hidden controller law: controllers.js HIDDEN.experiment, made by makeLaw from
//   { type: 'experiment', params: { plan } }; law.experiment is the machine, law.at(seq, applied) names the plant's
//   sample before a live step. normalizeVariant refuses the type ("experiment is the page's own: …").
// project.js: normalizeIdentify (system.identify; IDENTIFY_COMPUTED, the sentence that refuses computed keys).

// src/core/fit.js (no DOM; built in steps 2 and 3)
// A segment: { y, yStart, uStart, u (open loop: as applied) | law (closed loop: () => (k, ŷ) => u), weight }
export const STRUCTURES                                    // lag, lags, resonance, intLag, intRes:
                                                           //   { name, label, glyph, integrating, params, tf(p), ss(p),
                                                           //     chain(p, { sd, units }), start(guess), times(p) }
export function discretise(structure, p, Ts)              // exact ZOH with a fractional input delay → { Phi, G0, G1, C, m, f }
export function simulateSegment(d, segment)               // → { y, u }: the replay at rest about the segment's start
export function* lmSteps(residual, p0, { maxIter = 60, lower, upper }) // Levenberg–Marquardt, deterministic, yields
export const lm                                            //   per iteration; lm drains it
export function* fitStructureSteps(segments, structure, starts, { Ts, maxIter, noise }) // → { p, cov, sd, cost,
export const fitStructure                                  //   chi2dof, bic, n, np, start, iterations, converged }
export function noiseTransfer(d, segment)                 // the replayed loop's noise transfer S (impulse response)
export function parameterCov(J, A, parts, s2)             // σ̂²A⁻¹, or with S on closed-loop segments (§6.5)
export function unsupported(structure, p, { length })     // the ✕ reason, or null (§6.4)
export function chooseStructure(candidates)               // → { index, why } (§6.4); CHOICE holds the thresholds
export function* tcKernelSteps(u, y, { n, decimate, cover, integrating, u0, y0, from, Ts }) // built in step 3: yields per
export const tcKernel                                      //   evaluation; → { g, sd, cov, n, decimate, integrating, rate?,
                                                           //   Ts, hyper: { c, lambda, sigma2, eta }, logLik, evaluations }
export function tcInverse(n, lambda)                       // the TC kernel's tridiagonal inverse → { diag, off }
export function kernelStep(kernel, count)                  // → { t, s, sd }: y's step response with its band
export function kernelGuess(kernel, Ts)                    // → { K | kp, tau, theta, f?, zeta? }: start values (§6.3)
export const KERNEL                                        // maxTaps 150, maxEvaluations 40, the grid of decays, tol
export function multisineLines({ N, kmax, kmin, count, seed }) // → { excited, detect: { odd, even } }
export function multisine({ N, lines, peak, seed, phases })   // → Float64Array (one period); MULTISINE: 20 passes, clip
export function crestFactor(x)
export function wholePeriods({ start, N, count, gaps, breaks }) // → { kept, dropped, starts }
export function frf(U, Y, { excited, detect, Ts })         // U, Y: whole periods → { lines, f?, G, sd, U, Y, noise,
                                                           //   distortion: { share, odd, even, level, near }, periods }
export function fitPercent(y, yhat)
export function noiseCeiling(y, floor)
export function whiteness(res, lags = 25, h = null)         // → { r, expected, band, outside, worst, white }; h: a closed
                                                           //   loop's noise transfer, each lag read against Σh_q h_{q+τ}/Σh²
export function noiseColour(v, pmax = 10)                   // a stretch of pure noise's AR colour (Burg, AIC) as 1/A(z)'s
                                                           //   impulse response; [1] when white
export function convolve(a, b)                              // a * b (b null: a): a loop's noise transfer with the noise's colour
export function crossCorrelation(res, u, lags = 25)         // → { r, band, outside, worst, independent }

// src/core/linalg.js gains cholesky(A) and cholSolve(L, b) (the kernel, LM), and eigSym(A, { vectors, project })
//   (symmetric eigenvalues by Householder and QL; the kernel's search).
// src/core/live.js gains createStepRunner(diagram, signals, { Ts, sources, variants }) (built in step 5), sharing
//   its RK4 step with createLiveRunner: one controller sample at a time, the same as simulateSystem bit for bit,
//   Sources overridable, a variant set by key after normalising (the hidden law), law(key) to reach it. Step 7:
//   the worker runs the experiment law and posts { identify: state } and record chunks; the page posts { supply }.
// src/core/controllers.js gains the hidden type 'experiment' ({ plan }) (built in step 5: HIDDEN); it is never in the
//   library, and normalizeVariant refuses it in files ("experiment is the page's own").
// src/core/autotune.js: tuneContext(project, path, { plant: 'diagram' | 'identified', model }).
// src/core/hil.js: outputs[].hard_min/hard_max, y.applied, the External block's ymin/ymax (built).
```

**CLI and browser:**
- `node cli.mjs identify <project> [--block ctrl] [--band lo,hi] [--budget 120] [--vary 0.15 --seed 7] [--json] [--keep]` runs the same core, gives the same numbers, and prints the sentences. `--keep` stores the record in the project. Built in step 5, with `--structure <name>` (the tester's choice of candidate); it prints the sentences, the chain with its bars, the candidates with their Check fits and marks, the Check against the noise ceiling and the kernel, the places, the gentlest controller that held, notes, and with `--vary` the factors drawn. `--keep` stores the plan and the record (named "angle · test n": no clock in the core), makes it the one in use, and stores the flags given as the settings.
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
   - a lag settles; an integrator ramps; the arm rings (built: without its Coulomb friction; with it, the Nudge's ±0.2 rad swings stop within half a swing and the first look sees an overdamped second order, §5.10);
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
9. **Frequency response.** Exact at the excited lines on a linear plant in closed loop. A period with a `seq` gap is dropped (and repeated by the Shake, step 8).
10. **Kernel.**
    - The tridiagonal inverse equals the inverse.
    - The research's example (2e^(−0.1s)/((0.5s + 1)(0.1s + 1)), 30 s, SNR 3) fits the impulse response to at least 94 %.
    - At most 40 evaluations.
11. **Models.**
    - `linearModel` matches each structure's transfer function.
    - The twin subsystem simulates the same as `replay`.
    - Copy as blocks contains primitives only.
    - Built (step 5, `test/identify.test.mjs`): to 1e-9 at five frequencies; the twin in a loop under a staircase and under a PI agrees with the exact replay to RK4's accuracy (2e-6) without a dead time, and within 3.5 % with one: the diagram's Dead time block interpolates its input between integration steps, so a jump of a held input arrives up to half a step off (h = Ts = 10 ms here). Step 9 should run the twin with a finer step or let the Dead time hold a sampled input.
12. **Storage.**
    - Keep round-trips through the project file with no computed fields; computed keys are refused with the sentence.
    - A kept record recomputes the same model bit for bit.
    - Built (step 5): the motor's record kept, through JSON and `normalizeProject`, gives the model `identify()` gave, the same JSON text; two runs give the same record and model; a computed key anywhere (beside the settings, in a kept test, in its record or plan) is refused with the sentence; the closed-loop replay fed the measured y gives back every u.
13. **End to end, the acceptance test** (E2's harness): oven, motor, tank and five arms. Identify, then Auto-tune Iterate on the model, then score the result noise-free on the true plant. The identify part is built (step 5, `test/identify-e2e.test.mjs`; numbers in "Measured" above): each model against the true plant's step and, per place, its linearisation.
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
    - `varyDiagram` with a seed is reproducible and varies only flagged parameters. Built (step 5): and keeps the motor's Kt = Ke one constant; `identify()` on the varied motor finds k′ within 1 % of the drawn Kt/(R·b + Kt·Ke).
    - The Compare table equals `linearizeBlock` at each level.
18. **The plant changed.** Check again against another arm draw says "the plant has changed".
19. **CLI.** `node cli.mjs identify` prints the sentences; `--json` parses; it gives the same numbers as `identify()`. Built (step 5), with `--keep` storing the record that recomputes the same model.

## 18. Implementation steps

Each step is one agent, with `npm test` green at the end.

0. **Record.**
   - The decisions.md entry is made with this design; check it.
   - Add the roadmap item.
   - Point hil.md's "Not yet" at this file.
1. **Protocol and plant first** (§15). **Built 2026-10-25**, with the deviations in §15.
   - `outputs[].hard_min/hard_max` and `y.applied` in `hil.js` and `checkDescription`; the External block's `ymin`/`ymax`.
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
    - Compare with the diagram (the design layer is merged); Hide a variation and the reveal.
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
