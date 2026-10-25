# The controller benchmark: which controller for this plant

Reader: the person, deciding whether this is the benchmark they asked for; then whoever builds it, after the overhaul. **Status: designed 2026-10-25, prototyped in Node (`tools/benchmark-prototype.mjs`), not built; the person answered its five questions the same day ([input 48](../input/2026-10-25-48-bumpless-velocity-form-and-benchmark-answers.md), §12) and then asked for disturbances always, feedforward judged fairly, a five-point scale, a gate on the main job and a weight sensitivity, all mechanical ([input 55](../input/2026-10-25-55-benchmark-scale-disturbance-sensitivity.md)); this page follows both.** The research is [../research/benchmark.md](../research/benchmark.md); the prototype's full output is [../research/benchmark-prototype.md](../research/benchmark-prototype.md).

The person's words:
- Input 10: "we identify a plant. If we are sure that we have identified it, then we run a controller benchmark against all the controllers we know. And then we produce a report … You tune all of them. You look up what a [Pugh] matrix is. You would create a [Pugh] matrix with criteria. You judge the different options by, and then you would select the best option."
- Input 29: "you take the current plant and you run all controllers that we have against it and try to figure out which ones fit and which would be the best with which tuning."
- Input 35: "a big matrix where you compare which controller can I use for this plant, how good are the results … To make a decision on which controller to use in which plant."
- Input 48, the answers: "We have to set a good datum and then the others are either plus or minus one, right? Don't make it too complicated. The winner is added as a variant but not switched on. In the report just makes a suggestion … Controllers that would need the plant rewired, say an observer for a missing speed signal … can stay in the report, but they would have a high complexity ruling. This could also go the other way around. Like you have an observer that maybe doesn't work that well. What would happen if you replaced that with a sensor?"
- Input 55: "it can't only weigh following, it also needs to weigh disturbance reaction … if we find one tuning that reacts well to disturbances and well to following, that would be better than one that just follows well. And feed forward doesn't gain anything on steps. That's very hard for me to believe … if 99% or 95% of the effort come out of a feed forward, that's always better than having an error to be integrated up … plus minus one is not enough … probably a 5-point scale … a reverse sensitivity search … assume our weights are wrong. How robust is a solution against change of weights? … how would the weights have to change for a close-up to win? And is that change reasonable? … the benchmark needs to run without an LLM. So it can't be judgment. It can be just mechanical."

## 0. Bottom line: what the person sees and does

- **Auto-tune gets a second mode, Benchmark** (a switch at the top of the tab: *This variant* | *Every type*). The person picks nothing else and presses **Start**. The plant is the current one: the diagram, or the identified model when Identify has one (always the model on HIL).
- **The page then, on its own:**
  1. lists every controller type the library knows, and says which ones **cannot run here and why** ("Sliding mode reads ẏ on input 3; this block measures 1 signal"; "LQR needs every state measured: this block sees thermocouple but not heater and chamber");
  2. **tunes each one that can** on the same goal (the Auto-tune goal) and the same experiment (the input's period, with its disturbance), within the same robustness bound. **Disturbance rejection always counts**: a system whose own d plays nothing gets a standard load step at the plant's input (§2.5);
  3. **scores each** on thirteen criteria: following steps, **following a smooth move** (the same moves eased, so feedforward can show what it does, §2.5), rejecting d, overshoot, settling, effort, actuator wear, time at a limit, robustness margin (Ms), behaviour on plants varied by ±15 %, noise passed to u, complexity, tuning effort;
  4. drops what **does not fit** (diverges, unstable where it runs, fragile: Ms above 2, or **much worse at the main job**: more than twice the datum's error at following or rejecting, §2.7), with the reason;
  5. also scores **plant changes** it could suggest, marked ⚙ and never applied: an observer that makes a measurement a refused type needs ("Sliding mode ⚙ rate observer"), and a sensor in place of an observer ("PID ⚙ sensor": the loop reads the true speed instead of the encoder's difference); each carries a high complexity;
  6. puts the rest in **one Pugh matrix** against the datum, the tuned PID, on a **five-point scale** (++ +2, + +1, S 0, − −1, −− −2) set by the ratio of each number to the datum's: S within the criterion's tolerance, ++ or −− beyond a factor 2 (§2.8); weighted and summed under each column;
  7. **suggests** the winner in one sentence with its reasons ("Sliding mode with a boundary layer: follows and rejects the load as well as the PID, with the same wear, a sixth of the noise in u and Ms 1.6 against 2.1"), and adds it to the block as a variant, not switched on. A plant change that ranks higher is named beside it ("measuring the speed instead of estimating it would rank +36");
  8. **tests the suggestion against its own weights** (§2.9): how much a weight would have to change for each runner-up to tie, whether that change is reasonable (within one step of the default), and the share of random weights within one step that the winner wins. The verdict is *robust* or *sensitive*, by rule.
- **What the person sees while it runs**: the matrix filling column by column; each candidate's run sweeping on the scope at the header's Speed, the best runs fading behind (as Auto-tune shows its runs); a progress line ("4 of 8 · tuning Super-twisting · 12 s left").
- **What they can change**: the weights (the matrix re-ranks at once, nothing re-runs), which candidates take part (a tick per column), the variation (±15 % by default) and the Ms bound. Each candidate's column opens its numbers, its gains and its runs.
- **The report**: **Download report** gives one HTML page (or Markdown, `--report x.md`) with the plant, the goal, the refusals, the matrix, the numbers, the runs overlaid, and the reasons.
- **The same from an agent**: `node cli.mjs benchmark <project>` and the MCP tool `benchmark` return the matrix as JSON and the report.
- **Cost**: 2–4 s for most library systems, about 30 s for the 1 ms sliding-mode motor (measured, §8), in a Worker so the page stays live.
- **No judgement anywhere** (input 55): every test, mark, gate and verdict is a rule on measured numbers; the benchmark runs the same without an agent.

What the prototype found (§7), with the input-55 rules:
- **DC motor, sliding mode**: the boundary-layer sliding mode wins (+10 against the PID; robust: 86 % of the weight draws), super-twisting second (+7.5). The loaded ideal relay, the scheduled PI and the on/off relay fail the main job (2.6×, 2.9× and 3× the PID's following error).
- **Oven**: the PID, the PI from the plant and the scheduled PI are the same within tolerance (a linear plant needs no schedule); the feedforward wins the smooth move (+) and settling (+) but pays in wear and complexity (−0.5). The suggestion is the PID, **sensitive**: the PI from the plant ties it outright and the feedforward ties if complexity's weight drops from 1 to 0.75. A boundary-layer sliding mode with a rate observer ⚙ ranks +1, named beside it.
- **Conical tank**: a single PID or PI does not fit (unstable where the tank starts); keep the loaded schedule (robust).
- **DC motor, deadbeat** (no disturbance of its own, so the standard load step): state feedback wins (+16, robust); Hu–Lin, which "won" on the three-mark scale with 7.3× the PID's following error, now fails the main job, as do LQR, the planned swing-up and the relay.
- **Feedforward**: on the position motor it supplies 16 % of the effort on the raw steps and **75 % on the smooth move**, where it halves the PID's error (IAE 0.061 against 0.078; on the deadbeat motor 0.036 against 0.080, ++).
- **Plant changes**: on *DC motor, speed from an encoder* the same PI reading a speed sensor instead of the encoder's finite difference scores +36 against the tuned PID (J 3.0 → 0.013); the suggestion stays the feedforward PID (+3, robust), which needs no change, and the report names the sensor.
- The pendulum and the triple pendulum showed the limit: a swing-up is not judged by following r (§10).

## 1. Where it lives: a mode of Auto-tune, not a tab

| | A sixth tab, Benchmark | A mode of Auto-tune (chosen) |
|---|---|---|
| The person's word | — | "that benchmark **mode**" (input 10) |
| Goal | A second copy of the goal settings, or shared state between tabs | The same Goal column: one goal for the benchmark and for tuning one variant |
| Block, result | Its own block picker; results into variants | Auto-tune's: the block picker, results into variants, Undo as one step |
| Pacing, display | A second implementation | Auto-tune's: Speed, the sweeps, the cost plot |
| Tabs | Seven tabs, against "the tabs exist to keep the screen calm" ([tabs.md](tabs.md)) | Six |

**Decision (interpretation): a mode of Auto-tune.** The benchmark is tuning applied to every type instead of one, scored more widely; it shares everything Auto-tune owns. Its matrix needs width, so in Benchmark mode the tab's four columns become two: **Setup** (the mode switch, the block, the goal, the variation and the Ms bound, Start) and **Matrix** (the matrix, the suggestion, Download report). Progressive disclosure ([tabs.md](tabs.md)): the matrix shows marks and totals; each cell's number is its tooltip; a column's Details open its numbers, gains and how it was tuned; the refusals sit under the matrix in one folded line ("7 types cannot run here ▸").

## 2. The flow

```
plant (diagram | identified twin)
  → candidates: every registered type → applies? (refusal with its sentence) → starts
  → the tests: the system's run (with a standard load step when its d plays nothing) and the same moves as a smooth move
  → tune each (same goal, same budget, same Ms bound)
  → score each (both runs, linear loop, ±15 % sweep, noise run, registry facts)
  → plant changes (⚙): candidates on a changed copy (an observer added, a sensor for an observer), tuned and scored the same
  → gates (fits / why not, the main job against the datum) → one five-point Pugh matrix against the datum (the tuned PID)
  → suggestion → weight sensitivity → report
```

### 2.1 The plant
- **The diagram**, as Auto-tune uses it (`tuneContext`): a copy, the block's other variants left alone.
- **The identified model**, when Identify has one in use: its twin diagram (`twinDiagram`, [identification.md](identification.md) §10), with its test push at the input. On HIL the benchmark refuses without one ("identify the plant first (Identify tab)") and runs on the twin with one; the suggestion then goes through **Try on the plant** (identification.md §11). This is input 10's order: identify, then benchmark.
- The **±15 % sweep** uses `varyDiagram(diagram, 0.15, seed)` from the Identify design (the prototype has a stand-in, `vary`): every physical number of the plant's blocks scaled by a seeded factor. On an identified model it varies the model's parameters, or uses its uncertainty where Identify reports one (each fitted parameter ± 2 σ, the larger of the two).

### 2.2 The candidates: every type the registry knows
The list is `CONTROLLER_TYPES`, read at run time, so the Hu–Lin variable-gain type, deadbeat and the PUMA's speed PI join by registering, with no list in the benchmark to update (decisions: locality). **Each type says how it takes part, in its own registry entry**, as an optional `bench` hook:

```js
bench: {
  applies(c) → '' | sentence      // why it cannot run on this block; c: the block's facts (below)
  start(c) → [{ name?, params, how }]   // one or more starting variants (sliding mode: ideal and boundary layer)
  tune: 'iterate' | 'knob' | 'none'     // its gains by Iterate; one speed input searched (designed types); nothing
  knob: 'Tcl'                     // for 'knob': the input that sets its speed
  after: 'pid'                    // a type that starts from another's result (the PID's feedforward from the PID)
  reads(p, m) → n                 // the measurements it reads (complexity); default 1
}
c = { m, umin, umax, rLo, rHi, rMid, rSpan, Ts, model (the step test's), tauGuess, lambda, tuned: {type: variant}, refused: {type: sentence}, design(variant) }
```

**A type without the hook still takes part**: a designed type is computed with its defaults and refused when its design refuses (the design's own sentence: "PI from the plant: angle integrates V: it has no static gain"); a hand type is iterated from its defaults when `tuningSpace` can tune it, else scored as it is. So a new type is never silently left out; the hook only makes it start well. Types that are not controllers (`off`, the hidden `experiment`) declare `applies: () => 'not a candidate'`.

What each type on main declares (the prototype's table, `BENCH` in the script):

| Type | Applies when | Starts from | Tuned by |
|---|---|---|---|
| PID | always | the step test's SIMC gains, else the relay's Tyreus–Luyben, else Kp = 1 | Iterate |
| PID + feedforward from the plant | its design works (no kink, minimum phase) | the PID row's gains; Kff, Kv, Ka computed | knob: the prefilter Tr (a feedforward on a stepped r kicks; Tr shapes r) |
| PI from the plant | its design works (a static gain, no kink) | one level, r's middle | knob: Tcl |
| Gain-scheduled PI | r moves | the step tests' SIMC schedule, else PI from the plant at three levels of r, else the PID's gains flat | Iterate (the tables scaled) |
| LQR | its design works (every state measured, at rest) | Q = 1 per measurement | knob: R |
| State feedback | LQR worked | the LQR row's gains | Iterate |
| Swing-up, swing-up + LQR, planned swing-up | a pendulum on a cart (4 measurements, an angle) | defaults; designs | none, or knob R |
| Relay | finite actuator limits | the full range, hysteresis 0.5 % of r | none |
| Sliding mode | finite limits and ẏ on input 3 | two: ideal (φ = 0) and boundary layer; λ = 1/τc from the step test, K the full swing | Iterate (λ, φ) |
| Super-twisting | finite limits and ẏ | λ as above, k1 = U/3, k2 = 3.7 U | Iterate |
| Off | never: "the open loop, not a candidate" | | |

**The running variant takes part as it is** ("As loaded: …"), untuned: it shows what the person has now and can be the datum.

A type that needs a measurement the block lacks is refused on the plant as it is, with what it needs; §2.3 then scores it on a changed copy.

### 2.3 Plant changes: scored, never applied
The person (input 48): candidates that need the plant rewired "can stay in the report, but they would have a high complexity ruling. This could also go the other way around … an observer that maybe doesn't work that well. What would happen if you replaced that with a sensor?" So the benchmark builds **changed copies of the diagram**, tunes and scores candidates on them exactly as on the plant (same goal, scales, budget, gates, the ±15 % sweep with the same seeds, the noise run), and puts them in the same matrix, marked **⚙** with the change in words. They are **never applied**: no variant is added for them (a variant cannot carry a plant change) and the person's diagram is untouched; the report describes the change, and the person makes it in the Plant tab if they want it. Each carries **+5 complexity** (`PLANT_CHANGE`), so against a datum that needs no change it is always − on complexity: what it costs to build, beside what it buys.

| Change | When the benchmark makes it | How it is modelled | Candidates on it |
|---|---|---|---|
| **Add an observer** for a missing measurement | a type was refused for a measurement the block lacks: ẏ (sliding modes, super-twisting), the full state (LQR, state feedback, Hu–Lin, deadbeat) | ẏ: a Finite difference Observer on y (rate filter Tf = τc/10, at least Ts), its rate wired to a new input 3. Full state: a designed Kalman Observer on the measurements and u, its estimates wired to the Controller (the design layer looks through it, so LQR on x̂ designs as on the states, [designs.md](designs.md)) | the refused types, each from its usual start |
| **A sensor instead of an observer** | the Controller reads an Observer's estimate | The estimate is replaced by the true signal it stands for, found **by matching, not by reading the plant's structure**: back from the observer's measurement through sensor blocks (Noise, Quantizer) to the signal they measure; then, in one loaded run with every block output at that level probed, the output whose run matches that signal's derivative best, within 5 % rms (a Finite difference's rate). It works whether the rate is a bare integrator's input or a Servo subsystem's speed output: on *DC motor, speed from an encoder* (now a Servo motor) it picks the Servo's ω output, which matches the rate of its angle within 0.18 %. A Kalman or placed Luenberger estimate is matched the same way against the state its design names (`values.stateIndex`); no match within 5 % is a refusal ("no block output matches the rate of motor:1: it cannot be measured by wiring"). The sensor is ideal in the nominal run; in the noise run it gets the same σ (0.5 % of its span) as every measurement, so it is not judged noiseless | the running variant as it is (what the sensor alone does) and the PID tuned on the measured signal |

**Interpretation**: the sensor is modelled as ideal plus the benchmark's common noise, not as a particular product; a quantizer or noise of the person's own on the true signal would be theirs to add. Only Finite difference is matched in the prototype; the Kalman and Luenberger paths follow the design layer's `stateIndex` and are the build's.

**What the prototype found**: on *DC motor, speed from an encoder* the PI as loaded with a speed sensor scores **+36** against the tuned PID on the five-point scale (J 3.0 → 0.013; its V travels 0.39 ranges/s instead of 390), the PID tuned on the sensor +31; the suggestion is the feedforward PID (+3, robust), which needs no change, with the sensor named beside it. On the oven, the boundary-layer sliding mode with a rate observer ranks first (+1: it rejects the door better, IAE 0.098 against 0.11, at Ms 2.4 and more noise in u); the suggestion stays the PID, with the observer named beside it. On the tank the sliding modes with a rate observer do not fit (one fails the main job, the other is unstable at r's middle).

### 2.4 Tuning: how fair
- **The same goal**: the Auto-tune goal (cost type, effort weight, overshoot bound), copied at Start; the same experiment (one period of the input, its disturbance or the standard load step included), the same cost scales for everyone (r's span, the actuator range). **The cost a candidate is tuned to is the sum of both tests' costs**, the system's run and the smooth move (§2.5), so a structure is tuned for both kinds of following and for the load. The prototype does this for the knob searches; its Iterate, which is Auto-tune's, still tunes on the system's run alone (the build passes Iterate both runs).
- **The same budget**: Iterate up to 60 iterations from each start (the prototype: 15–120 runs per candidate); a knob search 15 designs; a type with nothing to tune one run. The runs are reported as *Tuning runs*, a criterion.
- **Each from its best start**: a rule or a design first (SIMC, the plant's pole cancellation, LQR), then the search. A structure is judged at its best on the goal, not as it happened to be set (research §2, fairness).
- **Designed types stay designed**: their numbers are computed from the plant; only the input that sets their speed (Tcl, R, Tr) is searched. So *PI from the plant* is what the plant model gives, and *PID* is what the search gives; both are in the matrix and the person sees whether the search earned its runs.
- **The same robustness bound**: tuning must keep **Ms ≤ 2** where the loop works and stay stable where the run starts and on every varied plant. Iterate's cost has no robustness term, and tuning to J alone buys a little IAE with a lot of margin: on the tank Iterate took the schedule to Ms 12, phase margin 9°; on the sliding-mode motor the PID to Ms 2.1, phase margin 34°. The build adds the bound to Iterate (`goal.msMax`, a penalty like the overshoot's, on the linear loop at r's middle, each run; research §2, MIGO). The prototype, which leaves the core alone, **backs off** instead: a tuned result that fails a gate is moved back along the way it came (¾, ½, ¼ of the way from its start, then the start) until it passes; the tank's schedule passed at ¼ of the way (Ms 2.5 with the prototype's bound of 3).
- **What is not equal, and is said**: a type that cannot be tuned (the relay) is scored at its start; the gain-scheduled PI scales whole tables, not each entry; switching laws have no Ms, so the sweep alone judges their robustness. The report states each.

### 2.5 The tests: the system's run, a standard disturbance, a smooth move
Every candidate runs the same three experiments, built mechanically from the system (input 55: "just mechanical"):

1. **The system's own run**: one period of its input, its reference and its disturbance, as Auto-tune runs it.
2. **A standard disturbance, when the system has none.** If no input but r plays anything (*DC motor, deadbeat*, *Following a sine*, *Encoder errors*), the benchmark adds, on a copy of the diagram, a **load step at the plant's input**: u_plant = u + d, d = −10 % of the actuator range (of u's swing in the loaded run when the range is open), from the middle of the longest stretch between r's steps to the end of the run. *Where*: the plant's input is the one place every plant has, and a load there passes through the whole plant, as a load torque or a heat loss does, so only integral action or an equivalent removes it; it is the disturbance control practice judges rejection by (research §5: Åström–Hägglund, Garpinger–Hägglund, Grimholt–Skogestad). *Size*: a tenth of the actuator range leaves the controller nine tenths to answer with, the same share on every plant. *When*: the middle of the longest stretch gives the step before it and the load after it each half a stretch to settle. A system's own d, when it plays, is used as it is: it is where that plant's disturbance really enters. On the deadbeat motor: −2.4 V from 3.35 s.
3. **The same moves as a smooth move.** r's steps, each turned into a smooth move of the same size by 1/(τs + 1)³ on the wire into the Controller (r, ṙ and r̈ continuous), τ such that the move is 99 % done in a fifth of the shortest stretch between steps (8.4 τ; on the motors τ = 24 ms, a 0.2 s move). A third-order lag stands in for a jerk-limited trajectory (research §5, Lambrechts et al.): mechanical, any size, no new signal type. Following is scored against the smooth r, over the same windows as the steps. A system whose r has no steps (a sine) has no smooth-move test; its row reads "?" and counts as S.

**Why the smooth move (input 55: "feed forward doesn't gain anything on steps. That's very hard for me to believe").** The person is right about moves, and the steps hid it. On a raw step only the static feedforward Kff·r acts, and Kff is 0 for an integrating plant such as the motor's angle; Kv·ṙ and Ka·r̈ are one-sample impulses, clipped at the actuator's limits, or smoothed away by the prefilter the step needs. On a move they are what drives the plant. Measured, as the feedforward's share of the effort, Σ|ff| / (Σ|ff| + Σ|u − ff|), and the following error (IAE / r's span) against the tuned PID's:

| System | Feedforward | Share on the steps | Share on the smooth move | IAE steps: FF / PID | IAE move: FF / PID |
|---|---|---|---|---|---|
| DC motor, position control | Kv 1.34, Ka 0.036 | 16 % | **75 %** | 0.12 / 0.11 | **0.061 / 0.078** |
| DC motor, deadbeat | Kv 1.66, Ka 0.032 | 26 % | 43 % | 0.091 / 0.096 | **0.036 / 0.080** |
| DC motor, sliding mode | Kv 2.45, Ka 0.036 | 3.7 % | 58 % | 0.077 / 0.077 | **0.021 / 0.040** |
| Oven (self-regulating) | Kff 1, Kv 0.65, Ka 0.08 | 85 % | 88 % | 0.14 / 0.14 | 0.11 / 0.14 |

On the oven, a plant with a static gain, the static part does most of the work even on steps; on the motors the feedforward carries most of a move and halves the error, and the matrix marks it + or ++ there. The tuned PID's feedback is fast enough on a raw step that a feedforward adds little: that is what the first matrices measured.

### 2.6 Scoring: the criteria
Each candidate is run on the nominal plant (the system's run and the smooth move), once with measurement noise, once on each of 8 varied plants, and its loop is linearised where it works. All are deterministic.

| Criterion | Measure | Better | Tolerance (S within) | Weight |
|---|---|---|---|---|
| Following steps | IAE of r − y per sample over the windows after each step of r (until the next step or a jump of d), / r's span | lower | 10 % | 1.5 |
| Following a smooth move | the same, in the smooth-move run, against the smooth r | lower | 10 % | 1.5 |
| Rejecting d | IAE after each jump of d until the next step of r, / r's span | lower | 10 % | 3 |
| Overshoot | the worst step's, % of the step | lower | 20 %, 2 points | 2 |
| Settling | mean time into the 2 % band after a step (a window that never settles counts whole) | lower | 15 % | 1 |
| Effort | rms of u about its mean, / the actuator range | lower | 15 % | 1 |
| Wear | total variation of u per second, / the range (Σ\|Δu\|/U/T) | lower | 25 % | 2 |
| Time at a limit | share of samples at u min or u max | lower | 25 %, 2 points | 1 |
| Robustness | Ms of the loop linearised at r's middle (Analysis core); PM, GM, delay margin shown | lower | 10 % | 2 |
| Plant ±15 % | the worst J over 8 seeded varied plants | lower | 15 % | 3 |
| Noise → u | rms change of u with white noise of σ = 0.5 % of each measurement's span on every measurement, / range | lower | 25 % | 2 |
| Complexity | numbers in the law + measurements read + 2 when it needs a plant model | lower | ½ | 1 |
| Tuning effort | runs the tuning took | lower | 50 %, 5 runs | 1 |

- **Weights**: the defaults above (following, rejection and plant change count most; following's 3 is split between the steps and the smooth move, so following and rejecting d keep the weights the person approved, 3 and 3 (interpretation); the person's list in input 10 named "following, disturbance rejection, overshoot, robustness to the plant's ±15 % variation, effort and actuator wear, noise sensitivity, complexity"). Editable in the tab and by `--weights track=3,dist=3,…`; a weight of 0 removes the row. Saved with the project's benchmark settings, not per viewer (they are the person's decision criteria and belong with the report).
- **A missing number is "?"**, counted as S, and named: Ms for a law with no linear model ("no linear model: the sweep judges its robustness").
- **The tolerances** make "better" mean something: without them a 0.1 % difference would be a +. They are per criterion, relative to the datum's value with an absolute floor; they are the S band of the five-point scale (§2.8).
- **Interpretation**: the linear loop is taken at r's middle (a trim of y1 there), where the loop works, not at the start: the oven starts with the heater at 0, at its limit, where no linear loop holds. A system may name its own operating point (§10).

### 2.7 Gates: which ones fit
A candidate **fits** when it (1) does not diverge on the nominal plant, (2) does not diverge on any of the varied plants, (3) is not unstable at r's middle, (4) is not unstable where the run starts (Auto-tune's check, v2.7.3: a loop that starts in exact balance rests even where it is unstable; marginal passes), (5) has Ms ≤ 2 where linear, and (6) **does its main job**: its following error (steps or smooth move) and its rejection error are at most **twice the datum's** (with the criterion's floor, as in the marks). A candidate that does not fit stays in the matrix, greyed, with its reason in the Fits row ("unstable where the run starts (2 poles outside); it rests there only because it starts in balance"; "fragile: Ms 12 at r's middle, PM 9°"); it is not ranked. This is input 29's "which ones fit".

**Interpretation**: the prototype used Ms ≤ 3 to see the back-off work; the design takes **2**, the usual "acceptable" bound ([analysis.md](analysis.md) grades Ms ≤ 2 fair).

**The main-job gate** (input 55: "if we find one tuning that reacts well to disturbances and well to following, that would be better than one that just follows well"; the orchestrator's finding: Hu–Lin "won" with 7.3× the PID's following error). A weighted sum lets many small wins buy one large loss; for the job a controller exists to do, that trade is not allowed. **×2 is where a mark turns to −−**, so the rule reads "a −− on following steps, following a smooth move or rejecting d means it does not fit". The prototype's ratios to the datum support the line: the candidates that compete stay at ×1.6 or below (the loaded deadbeat 1.56 on steps, the scheduled PI on the sliding motor 1.56), the clearly worse ones lie at ×2.1 and above (the scheduled PI on the deadbeat motor 2.1, the loaded relay on a move 2.6, the on/off relay 3, LQR 5.6, Hu–Lin 7.3, the planned swing-up 7.7, the tank's relay on rejection 5.5). The datum itself is exempt; when the datum falls back to the running variant, the gate is against it.

### 2.8 The Pugh matrix and the ranking
- Columns: the candidates (the running variant first); rows: the criteria with their weights; cells: a **five-point mark** against the datum's number, **D** in the datum's column, **?** where a number is missing (counted 0). Under them: the weighted total, Σ w·mark, and Fits.
- **The five-point scale** (input 55: "plus minus one is not enough … probably a 5-point scale"), by rule. For a criterion where lower is better (all thirteen), with a the candidate's number, b the datum's and f the criterion's floor, q = (a + f)/(b + f):

  | Mark | Value | When |
  |---|---|---|
  | ++ | +2 | q < ½: more than twice as good |
  | + | +1 | ½ ≤ q ≤ 1/(1 + tol): better beyond the tolerance |
  | S | 0 | 1/(1 + tol) < q < 1 + tol: the same within the tolerance |
  | − | −1 | 1 + tol ≤ q ≤ 2 |
  | −− | −2 | q > 2: more than twice as bad |

  **Why this scale** (research §3, which compares Pugh's three marks, the five- and seven-point Pugh variants, QFD's 0-1-3-9 and normalised utilities with TOPSIS): the five marks are the usual extension of Pugh's matrix and keep it readable against a datum; the ratio is what control engineers read ("half the error"); a factor 2 is a round, plant-independent line for "much"; the floor keeps 0 % against 1 % overshoot from reading as an infinite ratio; and each mark depends only on the candidate and the datum, so adding or removing a candidate changes no other column (min–max normalisation and TOPSIS rescale everyone and can reverse ranks). QFD's 1-3-9 grades how strongly one thing affects another, without a sign; its point, that a large difference counts more than linearly, is the −− mark. The bands are the criterion's own tolerance and ×2: nothing is judged.
- **The datum**: the tuned PID, the controller everyone knows (roadmap: "against a datum (the PID)"; the person, input 48: "we have to set a good datum and then the others are either plus or minus one"). If the tuned PID does not fit, the running variant is the datum; if neither fits, the tuned PID stays the datum and the matrix says it does not fit. The datum is not chosen in the tab: one rule, nothing to set.
- **One round** (input 48: "Don't make it too complicated"): no second matrix against the winner. Pugh's iteration (research §1) is left to the person, who can run the benchmark again after changing the plant or the candidates.
- **Ranking**: fitting candidates by weighted total, ties by J. **The suggestion** is the top one that needs no plant change (or "keep the running variant: nothing beats it" when that is the top one), with the + rows that carried it and its worst − row in words, a plant change that ranks above it, and the runner-up when within 2 points ("PID + feedforward (+2) and the PID (0) are close; the feedforward settles faster and holds up better on the varied plants, at the price of more wear and a model").
- **Interpretation**: Pugh warned against summing the marks. The total is shown because the person asked to "select the best option"; the marks and the numbers stay under it, the suggestion names the reasons, and §2.9 says how much the order depends on the weights (research §1, §4).

### 2.9 Reverse sensitivity: are the weights deciding it?
The person (input 55): "assume our weights are wrong. How robust is a solution against change of weights? … how would the weights have to change for a close-up to win? And is that change reasonable?" A candidate's total is linear in the weights, T = Σ wᵢ mᵢ, so each question has an exact, mechanical answer (research §4). Among the candidates the suggestion is chosen from (fitting, no plant change):

- **One weight at a time** (Triantaphyllou and Sánchez 1997): for each of the three runners-up, the smallest change of a single weight at which it ties the winner, Δ = (T_win − T_j)/(m_ji − m_win,i), with the weight kept ≥ 0. It names the criterion the decision hangs on: "Super-twisting ties if Wear goes 2 → 0.75".
- **All weights together**: the smallest Euclidean change of the whole weight vector that makes the runner-up tie (the distance to the hyperplane where the totals are equal, kept ≥ 0), as a share of the weights' size, and its largest single change.
- **Random weights** (Butler, Jia and Dyer 1997; SMAA's rank-1 acceptability, Lahdelma et al.): 4000 seeded draws, each weight uniform within one step of its default; the share each candidate wins.
- **Reasonable** (interpretation, mechanical): the default weights sit on a scale of 1 to 3, so one step is 1. A change is reasonable when every weight stays within ±1 of its default and above 0. **The verdict**: *robust* when no reasonable single-weight change makes a runner-up tie and the winner takes at least 75 % of the draws; otherwise *sensitive*, naming the runner-up and the weight. A tie at the current weights (two candidates with the same marks: the oven's PID and PI from the plant) is reported as "tied now: J breaks the tie", and is sensitive.
- **What the report shows**: the verdict in the bottom line ("Sliding mode (boundary layer), robust: 86 % of weight draws within one step"); a table of the runners-up with their tie points (weight, from → to, reasonable or not), the all-weights change, and their share of the draws. In the tab, the same under the matrix; changing a weight re-ranks at once and the sensitivity follows (no runs: it is arithmetic on the marks).

### 2.10 What comes out
- **Variants**: the winner is added to the block as "<type> · benchmark", not switched on (flip it in the Controller tab); with **Add all** every fitting candidate without a plant change is added. One undo step. The person (input 48): "The winner is added as a variant but not switched on. In the report just makes a suggestion. It doesn't switch anything on."
- **The report** (`benchmarkReport(result, { format: 'html' | 'md' })`), one self-contained file:
  1. the bottom line: the suggestion in two sentences, its sensitivity verdict, and a plant change that would rank higher;
  2. the plant (system name, diagram or identified model and its fit), the goal, the tests (the standard disturbance if one was added, the smooth move's τ), the variation and the date;
  3. the five-point matrix with the weights, the ⚙ columns marked with their change, and the weight sensitivity (§2.9);
  4. the numbers table (every criterion, PM, GM, delay margin), and the feedforward's share of the effort on both tests where a candidate has one;
  5. the runs: r, y and u of every fitting candidate overlaid, nominal and the worst varied plant (inline SVG in HTML; in Markdown a CSV block per run, or omitted with `--no-runs`);
  6. per candidate: how it was tuned, its gains, why it does or does not fit;
  7. the refusals with their sentences, and the plant changes in words (what to add or rewire, and what it would give);
  8. what was not judged (switching laws' margins, the task of a swing-up).
  It leaves through the page's one download path (Export menu, [decisions.md](decisions.md) v2.9) and carries no provenance (input 10).

## 3. In the page
- Auto-tune, mode switch **This variant | Every type**. In Every type: Setup (block; plant source, shared with the tab; goal; variation ±15 %, plants 8; Ms bound 2; Start/Stop) and Matrix.
- **While running**: columns appear in registry order as candidates finish; the current one's runs sweep the display at the Speed (at ∞ the display stands still and the matrix fills as fast as it computes, as Auto-tune does). Stop keeps what is finished and ranks it.
- **After**: weights change the matrix at once (pure recomputation from the stored scores, no runs). Clicking a column shows that candidate's nominal run on the scope, its varied runs faded behind; Details lists its numbers.
- `window.loopTuner.benchmark({ block, plant, weights, sweep, vary, msMax, include, changes, apply })` returns a Promise of the result (the CLI's `--json`); `loopTuner.benchmarkReport(format)` returns the last report's text. Documented in Help (For agents) and AGENTS.md.

## 4. CLI and MCP
- `node cli.mjs benchmark <project> [--block ctrl] [--plant diagram|identified] [--no-changes] [--weights track=3,dist=3,…] [--include pid,slidingMode] [--vary 0.15] [--sweep 8] [--ms-max 2] [--iterations 60] [--report out.html|out.md] [--save] [--json]`: the same core, the same numbers as the tab; prints the matrix and the suggestion; `--save` adds the winner as a variant.
- **MCP tool `benchmark`** (on feat/mcp's server, beside `autotune` and `analyze`; snake case like its siblings): arguments `project`, `block`, `plant`, `weights`, `include`, `changes` (score plant changes, default true), `vary`, `sweep`, `msMax`, `report` (`'md' | 'html' | null`), `apply`. It sends progress notifications per candidate (as `autotune` does with its progress token), returns the result JSON (`structuredContent`: candidates, refusals, plant changes, scores, the matrix, ranking, suggestion) and, as text, the matrix in Markdown so an agent can show it as it is. A refusal (no Controller block, an External plant without a model) is a tool error with the core's sentence. When the server hosts the page (agentic mode), the tool runs in the page, so the person watches the matrix fill.

## 5. Core API

```js
// src/core/benchmark.js (no DOM; Node, the Worker, the page)
export const CRITERIA                        // [{ key, label, dir, tol, abs, weight, unit, from: 'run'|'linear'|'sweep'|'noise'|'registry' }]
export function candidates(project, path)    // → { facts: c, list: [{ type, name, start, how, tune }], refused: [{ type, label, why, needs? }] }
export function plantChanges(project, path, refused)  // → [{ kind: 'observer' | 'sensor', change (words), diagram, types }]; never applied
export function* benchmarkSteps(project, path, opts)  // yields { partial, phase, candidate, run, seconds } per run; returns BenchResult
export const benchmark = (project, path, opts) => drain(benchmarkSteps(project, path, opts))
export function scoreRun(run, key, ctx, scales, variant)   // → the run criteria (pure)
export function gates(row, opts)             // → '' | why not
export function standardTests(project, path) // → { project (with the standard load step if its d plays nothing), disturbance?, tau, moveDiagram }
export function datum(rows)                  // → the tuned PID; the running variant if the PID does not fit
export function mark(criterion, a, b)        // → −2 … +2, or null: the five-point rule (pure)
export function mainJob(row, datum)          // → '' | why not: following or rejecting more than ×2 the datum's
export function pugh(rows, datum, weights)   // → [{ type, marks, plus, minus, total }] (pure: re-run on a weight change)
export function rank(rows, weights)          // → { matrix, ranking, suggestion: { type, sentence, runnerUp, changeAbove } }
export function sensitivity(rank, weights, { step = 1, draws = 4000, seed }) // → { verdict, flips, minChange, acceptability } (pure)
export function benchmarkReport(result, { format })  // → string
// BenchResult = { version, plant: { source, label, fit? }, goal, opts, facts, refused, rows: [{ type, name, how,
//   variant, start, evals, scores: { track, move, dist, … }, ffShare?: { steps, move }, margins: { ms, pm, gm, dm, marginal }, fits, whyNot, plantChange?, runs? }],
//   tests, datum, matrix, ranking, suggestion, sensitivity, ms }
```
- `autotune.js` gains `goal.msMax` (Iterate's penalty), a cost over several runs (the system's and the smooth move), and exports what the benchmark reuses (`iterate`, the step test, `runCost`, `costScales`, `unstableAtStart`).
- `controllers.js` gains the optional `bench` hook per type (§2.2); `identify.js` provides `varyDiagram` and `twinDiagram` (designed there).
- `diagram.js` or a small helper gains `spliceNoise(diagram, path, sigmas)` and `probeMeasurements(diagram, path)` (the prototype's `withNoise` and the Sink probes).

## 6. Tests
- **Registry-driven**: a fake type registered in a test library takes part with no change to `benchmark.js`; one with `applies` returning a sentence is listed as refused with it; one without a hook is computed or iterated from its defaults (the GENERIC path).
- **Refusals are the designs' sentences**: the oven lists LQR's "needs every state measured … thermocouple but not heater and chamber", the motor *PI from the plant*'s "integrates V".
- **The five-point rule**: q at each band edge (½, 1/(1 + tol), 1 + tol, 2) gives the documented mark; the floor keeps 0 against 0 at S.
- **The standard tests**: a system with a playing d gets none; *DC motor, deadbeat* gets −2.4 V at the plant's input from the middle of its longest stretch, on a copy (the project untouched); the smooth move is 99 % done in a fifth of the shortest stretch; a sine has none.
- **The main job**: Hu–Lin on the deadbeat motor (×7.3) does not fit; a candidate at ×1.9 does.
- **Sensitivity**: hand-made marks with a known tie point give that Δ; the all-weights change equals the hyperplane distance; the draws are seeded and give the same shares twice; a tie now reads as such.
- **Pugh, pure**: hand-made rows give known marks, totals and tolerances; a weight of 0 removes a row; changing the weights changes the matrix without any run (a counting fake of `simulateSystem` stays at 0 calls).
- **Plant changes**: on *DC motor, speed from an encoder* the sensor change wires the Servo's ω output (matched within 5 %) into input 2 and the original diagram is untouched (deep-equal before and after); the ⚙ rows carry +5 complexity and never become variants; on the oven the rate observer appears for the sliding modes only; a Kalman estimate of a state no block outputs is refused with its sentence.
- **Gates**: a diverging candidate, one unstable at the start (the tank's PID), one fragile (Ms above the bound), one marginal (the encoder's speed loop, which passes).
- **Fairness**: every candidate's runs use the same goal and scales (asserted on the cost's inputs); the budget cap holds.
- **Determinism**: two runs give the same result bit for bit (seeded variation and noise).
- **The three systems** once, slow-marked or on shared fixtures (the overhaul's "expensive once"): the motor's winner is the boundary-layer sliding mode (robust); the oven's three PI types are S against each other; on the tank no single PID fits; on the deadbeat motor Hu–Lin fails the main job and state feedback wins. Other tests use a recorded BenchResult.
- **Report**: HTML is self-contained (no external URL, no provenance; the provenance test's rules) and Markdown has the matrix table; both name every refused type.
- **CLI and MCP**: `benchmark --json` equals the core's result; the MCP tool's schema refuses unknown arguments and returns the core's sentences.

## 7. The prototype's matrices

`node tools/benchmark-prototype.mjs` on main's controller types, Iterate 60, 8 varied plants, the prototype's Ms bound 3 with back-off, and the input-55 rules: the standard disturbance where a system has none, the smooth move, five-point marks, the main-job gate, the weight sensitivity. Full output with every number: [../research/benchmark-prototype.md](../research/benchmark-prototype.md). The types main gained (deadbeat, Hu–Lin, the speed PI) take part through the generic path, with their designs' own refusals ("deadbeat places every pole of the loop at z = 0, but the dead time … holds inputs this law does not see").

**DC motor, sliding mode** (Ts 1 ms; measures angle and speed; its own load pulse; datum **PID**):

| Criterion (weight) | Loaded: Relay (theory) | **PID** | Gain-sched. PI | PID + FF | Relay | SMC ideal | SMC layer | Super-twisting |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Following steps (1.5) | − | D | − | S | −− | S | S | S |
| Following a smooth move (1.5) | −− | D | −− | + | −− | + | S | − |
| Rejecting d (3) | ++ | D | −− | S | −− | ++ | + | ++ |
| Overshoot (2) | S | D | −− | S | −− | S | S | − |
| Settling (1) | −− | D | −− | S | −− | + | + | S |
| Effort (1) | −− | D | + | S | −− | −− | S | + |
| Wear (2) | −− | D | ++ | S | −− | −− | S | −− |
| Time at a limit (1) | −− | D | ++ | S | −− | −− | S | ++ |
| Ms (2) | ? | D | + | S | ? | ? | + | ? |
| Plant ±15 % (3) | −− | D | − | S | −− | −− | S | + |
| Noise → u (2) | −− | D | ++ | S | −− | −− | ++ | ++ |
| Complexity (1) | + | D | − | −− | + | + | − | − |
| Tuning runs (1) | ++ | D | S | ++ | ++ | ++ | + | S |
| **Weighted** | −15.5 | 0 | −7.5 | +1.5 | −33 | −6.5 | **+10** | +7.5 |
| **Fits** | no: move ×2.6 | yes | no: move ×2.9 | yes | no: steps ×3 | yes | **yes** | yes |

Ranking: the boundary-layer sliding mode (+10), super-twisting (+7.5), PID + feedforward (+1.5), the PID (0), the ideal sliding mode (−6.5). Suggestion: **Sliding mode (boundary layer)**; **robust**: it wins 86 % of the weight draws within one step; super-twisting would tie only if wear's weight fell from 2 to 0.75 (more than a step), the feedforward only if the smooth move's rose from 1.5 to 10. Refused: LQR, state feedback, Hu–Lin and deadbeat (the armature current is not measured), PI from the plant (the angle integrates), the speed PI, the three swing-ups. The ideal relay still rejects the load best (IAE 0.0012 against the PID's 0.015) and still sits at a limit 95 % of the time: input 10's "theoretical but hard on the actuator", now −− on four rows.

**Oven, badly tuned** (dead time; its own door opening; datum **PID**): the PID, the PI from the plant (0) and the scheduled PI (−2: complexity) are S on every performance row: the oven is linear, so a schedule buys nothing. PID + feedforward from the plant (its prefilter searched on both tests to 0.40 s) wins the smooth move (+, 0.11 against 0.14) and settling (+, 1.3 s against 1.7 s), loses wear (−, 0.80 against 0.55) and complexity (−−), so −0.5. Suggestion: **PID**, **sensitive**: the PI from the plant ties it at the current weights (J breaks the tie) and the feedforward ties if complexity's weight drops from 1 to 0.75 (reasonable); the draws split 43 % PID, 29 % feedforward, 28 % PI from the plant. That is the honest answer for a linear plant: three PI-type controllers that do the same job. The boundary-layer sliding mode ⚙ with a rate observer ranks +1 and is named beside the suggestion. The loaded PID does not fit (unstable at r's middle: it lives in a limit cycle at the heater's limits); the relay fits the main job (×1.2) and ranks −23.5.

**Conical tank** (nonlinear; its own draw-off; datum **the loaded schedule**, because the tuned PID is unstable where the tank starts): the loaded schedule (0), the tuned schedule (−5: same performance, more tuning runs and wear) and PI from the plant at its start (−8). Suggestion: **keep the loaded schedule**, robust (100 % of the draws). Not ranked: the PID (unstable where the tank starts), the speed PI (unstable at r's middle), the relay (rejection ×5.5), the sliding modes ⚙ with a rate observer.

**DC motor, deadbeat** (measures angle, speed and current; its d plays nothing, so the **standard load step**, −2.4 V at the plant's input from 3.35 s; datum **PID**): state feedback (tuned from LQR) **+16**, super-twisting +9, the boundary-layer sliding mode +9, PID + feedforward +8 (++ on the smooth move: 0.036 against 0.080), the ideal sliding mode +5.5. Suggestion: **State feedback**, robust (100 % of the draws; the nearest flip needs rejection's weight at 10). **Hu–Lin, which ranked first with three marks (+3), now does not fit**: its following error is 7.3× the PID's; so do LQR (×5.6, R searched for both tests), the planned swing-up (×7.7), the relay (×3), the scheduled PI (×2.1) and the loaded 100 ms deadbeat (the move ×2.2); the fast deadbeat is fragile (Ms 5.2).

## 8. Cost

Measured with the prototype in this container (Node 22, one core; the container's load moves single runs by up to ±50 %), the full benchmark: starts, tuning with the plant changes (the knob searches on both tests), scoring both tests, the 8-plant sweep:

| System | One run | Benchmark | Mostly |
|---|---|---|---|
| Oven, badly tuned | 3.1 ms | 1.7 s | tuning 1.3 s |
| Conical tank | 4.4 ms | 2.4 s | tuning 1.6 s |
| Pendulum swing-up | 4 ms | 2.7 s | |
| DC motor, position control | 7.5 ms | 3.3 s | |
| Following a sine (standard load step) | 8.2 ms | 3.4 s | |
| DC motor with an unbalanced arm | 13 ms | 7.3 s | |
| DC motor, deadbeat (standard load step) | 8.4 ms | 8.4 s | 13 candidates |
| Triple pendulum | 9.5 ms | 8.9 s | its plan (3.5 s) |
| DC motor, speed from an encoder | 25 ms | 13.1 s | with both plant changes (the sensor's match is one probed run) |
| Encoder errors and torque ripple (standard load step) | 65 ms | 18.1 s | |
| **DC motor, sliding mode** | **48 ms** | **31.6 s** | tuning 25.7 s (5 candidates iterated at Ts 1 ms) |
| Mass–spring–damper | | refused: no Controller block | |
| HIL systems | | refused until Identify; then on the twin, like the oven | |

The smooth move adds one run per scored candidate and doubles the knob searches; the weight sensitivity is arithmetic (4000 draws in milliseconds). A benchmark is about 300–1000 runs (the triple pendulum 1600): roughly 100 per tuned candidate, 2 + 8 per scored one. **It costs about one Auto-tune Iterate run per candidate**, plus 11 runs each to score. The build's Iterate on both tests would roughly double the tuning, so the sliding-mode motor would take about a minute on one core and 15–20 s on four Workers.

**Keeping the page responsive.**
- **A Worker**, as Live and the HIL loop already use one made from the page's own script ([decisions.md](decisions.md), Live): `benchmarkSteps` is a generator that yields after every run, so the Worker posts each finished candidate (its scores, its nominal run decimated to the screen's points) and the page fills the matrix. The page never computes a run itself. Where Workers are blocked (the limited environment), the same generator runs in **slices of about 30 ms** on the main thread, as Auto-tune does today.
- **Several Workers**: the candidates are independent once the PID row exists (only the feedforward and the scheduled PI start from another row). With `navigator.hardwareConcurrency − 1` Workers (at most 4), the sliding-mode motor's 32 s becomes about 8–10 s; a library plant stays under 1 s. Results are merged in registry order, so the outcome does not depend on which Worker finishes first.
- **At a finite Speed** the display shows the current candidate's runs sweeping, while the Workers compute ahead (Auto-tune's pacing); at ∞ nothing waits on the display.
- **Feedback within a second**: the candidate list and the refusals come from the registry and the designs before the first run (about 50 ms); the matrix grows from there. A progress line counts candidates and estimates the rest from the runs so far.
- **Budgets**: one per candidate (Iterate's 60 iterations) and one for the whole (default 2 minutes of computing; the person sees "stopped at the budget: 6 of 8 tuned" and the matrix of what is done).

## 9. Implementation steps (after the overhaul, in order)
1. **Iterate with an Ms bound** (`goal.msMax`, a penalty on the linear loop at r's middle; Auto-tune gains the setting too). Tests: the tank's schedule stays under the bound; the library's Auto-tune results unchanged where they already meet it.
2. **`varyDiagram`** (from Identify's step list, if Identify has not built it yet), **`spliceNoise` / `probeMeasurements`**, and **`standardTests`**: the standard load step and the smooth move. Iterate takes a cost over several runs.
3. **The `bench` hook** on each type of main, and the GENERIC path; `candidates()`. Tests: registry-driven, refusals.
4. **`plantChanges()`**: the rate observer, the Kalman observer for the full state, the sensor for a Finite difference, Kalman or Luenberger estimate. Tests §6 (plant changes).
5. **`benchmark.js`**: tuning, scoring, gates (the main job too), the datum, `mark`, `pugh`, `rank`, `sensitivity`, deterministic. Tests §6.
6. **CLI `benchmark`** and its `--json`; then the **MCP tool** on the server (if merged by then).
7. **The report**, HTML and Markdown, through the Export path.
8. **The page**: Auto-tune's mode switch, Setup and Matrix, the Worker (and several), weights live, Add the winner; `loopTuner.benchmark`. Help and AGENTS.md.
9. **On the identified model**: the plant selector and HIL's refusal without a model; the suggestion into Try on the plant.

Each step keeps the library's fingerprints and the tests green (the overhaul's gate).

## 10. Not built, and the limits found
- **Tasks other than following r.** On the pendulum the benchmark ranked a PID that holds the cart while the pole hangs first, and on the triple pendulum nothing fit: the shared cost cannot see that a swing-up must bring the pole up (the autotune research's "per-variant goals"). **A system may declare its task** (a library entry's `bench.task`: a Sink and a band, "θ within 0.2 rad of 0 from 3 s on"), which joins the gates and the criteria; and its **operating point** for the linear loop (the pendulums' upright rest). Until then the benchmark says, on a system with swing-up types, that it judges following r only.
- **Applying a plant change**: the benchmark scores it and the report describes it (§2.3); making it is the person's, in the Plant tab. A sensor of a particular kind (its noise, resolution, lag) is not modelled beyond the common noise.
- **Hybrids** (Pugh's step 5: combine two concepts, a PID with a sliding-mode outer loop): the person's.
- **Several Controller blocks** (cascades, the PUMA's joints): one block at a time, the others as they are; the PUMA's six joints would each be a benchmark.
- **Real runs on HIL**: the benchmark runs on the identified model; only the chosen controller goes to the plant (Try on the plant).
- **Statistical confidence**: 8 plants give a worst case, not a probability; more plants are an option (`--sweep`), at proportional cost.
- **A disturbance elsewhere than the plant's input** (at the output, on the measurement) is not added; a system that has its own d keeps it as it is, wherever it enters.
- **A true minimum-jerk trajectory** (a planned fourth-order profile with limits on velocity, acceleration and jerk) would be closer to motion practice than the third-order lag; it needs a new signal type and is left for later.

## 11. Interpretations for the decision log
- A **mode of Auto-tune** (This variant | Every type), not a seventh tab: the person said "benchmark mode", and it shares the goal, the block, the results and the pacing.
- **Candidates are every registered type**, each declaring in its own entry whether and how it takes part (`bench`); a type without the hook takes part from its defaults. Types that need measurements the block lacks are refused on the plant as it is, with what they need.
- **Plant changes are scored, never applied** (input 48): an observer for a missing measurement, a sensor in place of an observer; the same tuning and scoring on a changed copy, marked ⚙, +5 complexity, no variant; the sensor is ideal plus the common noise.
- **Fairness**: one goal, one experiment, one budget, one robustness bound; each candidate from its best start (a rule or its design), then searched. **Designed types stay designed**: only their speed input is searched.
- **Gates before marks**: diverging, unstable at r's middle or where the run starts, Ms above **2**, diverging on a ±15 % plant, or **following or rejecting more than ×2 the datum's error** (input 55) means "does not fit", with the reason; not a −.
- **The tests** (input 55): a standard load step of −10 % of the actuator range at the plant's input, from the middle of the longest stretch between r's steps, when no input but r plays anything; the same moves as a smooth move (r through 1/(τs + 1)³, 99 % done in a fifth of the shortest stretch); following counts 1.5 on each, rejecting d keeps 3; the tuning cost is the sum over both tests.
- **Five-point marks** (input 55) by the ratio q = (a + f)/(b + f) to the datum: S within the criterion's tolerance, ±1 up to ×2, ±2 beyond.
- **Weight sensitivity** (input 55): one weight at a time, all weights together, and 4000 seeded draws within one step; reasonable means each weight within ±1 of its default and above 0; robust means no reasonable single change ties a runner-up and the winner takes at least 75 % of the draws.
- **Mechanical throughout** (input 55): no step of the benchmark needs an agent.
- **Datum**: the tuned PID (input 48); the running variant only when the PID does not fit. **One round**, weighted and summed (input 48: "Don't make it too complicated"); the second round against the winner is dropped; the marks are five-point since input 55.
- **Weighted totals are shown** with the marks, the counts and the numbers, though Pugh warned against summing; the suggestion names its reasons.
- **The winner is added, not switched on**; the report only suggests (input 48).
- **The linear loop at r's middle** for the margins; the start is checked for stability only.
- **Default weights** 3 (following, split 1.5 steps and 1.5 smooth move; rejection; plant change), 2 (overshoot, wear, Ms, noise), 1 (settling, effort, time at a limit, complexity, tuning runs); tolerances per criterion; ±15 % over 8 seeded plants; noise σ 0.5 % of each measurement's span.
- **MCP tool name `benchmark`**.

## 12. The person's answers (input 48)
1. **Weights**: "the weights, I guess they are okay." They stand.
2. **The datum**: the tuned PID. "We have to set a good datum and then the others are either plus or minus one, right? Don't make it too complicated." One round against it (interpretation, decisions v2.9).
3. **The winner**: "added as a variant but not switched on. In the report just makes a suggestion. It doesn't switch anything on."
4. **Rewiring**: "can stay in the report, but they would have a high complexity ruling. This could also go the other way around … an observer that maybe doesn't work that well. What would happen if you replaced that with a sensor?" Both kinds are §2.3.
5. **Swing-up systems**: judged on following r only: "Yeah, I guess that's okay."

## 13. Input 55, point by point
1. **Disturbance rejection always counts**: the standard load step at the plant's input when a system's d plays nothing (§2.5); rejection keeps weight 3 and joins the main-job gate.
2. **Feedforward, judged fairly**: the smooth-move test (§2.5); measured, the feedforward carries 43–75 % of the effort on a move against 4–26 % on the raw steps of the motors, and halves the following error there.
3. **A finer scale**: five marks by the ratio to the datum (§2.8), chosen over QFD's 1-3-9 and normalised utilities or TOPSIS (research §3).
4. **A gate on the main job**: more than ×2 the datum's following or rejection error does not fit (§2.7); it removes Hu–Lin's false win on the deadbeat motor.
5. **Reverse sensitivity**: one weight at a time, all together, and random weights within one step, with a mechanical verdict (§2.9).
6. **Mechanical**: every rule above is a formula on measured numbers.
