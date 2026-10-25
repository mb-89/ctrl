# Detail levels

Reader: whoever builds detail levels (levels of a subsystem, the step bound they need, the validity checks, the op-amp example) or changes a model so it can have them. The person's words are in [input 10](../input/2026-10-24-10-sliding-mode-and-triple-swingup.md), last section; the research, with every number checked, is in [../research/detail-levels.md](../research/detail-levels.md). Three prerequisites are shared with [transparent-models.md](transparent-models.md) and defined there:
- subsystem masks and formula parameters;
- the Integrator with limits;
- the Equations block.

Where the code and this page differ once it is built, the code wins and this page is fixed.

**Any subsystem can hold several levels of detail: ordered, named diagrams with identical ports, each one openable.** The person picks the level per subsystem on its block (a badge `L2/4`), or caps every subsystem at once in the Plant tab ("Detail ≤ 1"). The level that runs is the chosen one, lowered by the cap. Each level says what it adds ("+ output resistance and cable"), how many states and parameters it costs, and where it is valid. When a run leaves that validity, the page says so. A design can be made on a simple level while a more detailed one runs ("designed on Motor L1, runs Motor L2; not in the design: + armature inductance"). That is the person's experiment: design and tune on a simple level, then raise the detail and watch the loop get worse. The first example is a circuit board: an op-amp follower driving a cable. At levels 1 and 2 the follower is perfect. At level 3 the op-amp's output resistance meets the cable's capacitance, and the same steps overshoot 38 % and ring for 3 µs. Level 4 adds slewing, which changes the large step.

(The person: "you can have a model of something and it has different detail levels … the interfaces stay more or less the same, but … the model introduces more calculations and more parameters … if I increase detail level, the control works worse because then there are some effects that we didn't model right, and everything we model should support this detail level separation.")

## 1. Rules (they go into decisions.md)

1. **Levels are ordered and named.** Level k + 1 is level k plus named effects. Its name says what it adds ("+ gain–bandwidth"), as LTspice's op-amp levels do. A level is a rank inside one subsystem, not a model index as SPICE's `LEVEL` is. Unordered alternatives stay where they are: variants of Controller and Observer blocks.
2. **Identical ports.** Every level has the same In and Out ports: the same numbers, names and units. The ports are the device's terminals at its most detailed level. A quantity only a higher level models (the cable current, the op-amp's internal node) is a Sink inside that level, never a port. A level that does not use an input ends it in a Terminator, where it can be seen.
3. **A level may not change the causality of its ports.** Draw level boundaries where signals are causal by nature: commands, measurements, a voltage driving a load that is inside the subsystem. An ideal op-amp inside a feedback loop is an algebraic loop in a block diagram, so the subsystem with levels is the whole stage (op-amp, feedback and load), never the bare op-amp.
4. **One parameter set.** Physical parameters live on the subsystem (its mask), once. Every level reads the ones it needs through formulas. No physics number is typed twice.
5. **Each level is valid somewhere and says where.** A level carries a validity sentence. It may also carry machine checks: parameter conditions, and Valid range blocks on its own signals. The page reports when a run leaves them. Each level is held by tests to its own physics inside that validity (§10).
6. **Neutral values reproduce the level below.** With the added parameters at their neutral values (a limit at ±∞, a coefficient of 1, a time constant of 0), level k + 1 equals level k, bit for bit, where the neutral value can be represented. Where it cannot (a resistance going to 0), it equals level k in the limit, and a test bounds the gap.
7. **No black boxes.** Every level is an ordinary diagram of blocks that can be opened. Nothing is compiled or hidden.
8. **Only the running level runs; every level is checked.** Normalisation checks all levels (ports, names, units, formulas). The compile builds only the running level, so unused levels cost nothing. Changing a level or the cap is a structural edit: the system compiles and runs again, and the previous run fades for comparison.
9. **A design may be made on less detail than runs, never more.** By default a design sees the levels that run. A designed variant may pin `designDetail: k`, and then it sees each subsystem at min(running level, k). The Controller tab says so whenever the two differ.
10. **Every model is built so a level can be added.** A new physics model is a subsystem whose ports are its terminals, with its parameters on its mask, and each effect a named block or group of blocks.

## 2. Data model

### 2.1 A subsystem with levels

```json
{ "id": "board", "type": "subsystem", "name": "Board", "x": 200, "y": 96,
  "mask": [ { "key": "GBW", "label": "Gain–bandwidth", "unit": "Hz" }, { "key": "AOL", "label": "Open-loop gain", "unit": "dB" },
            { "key": "Ro", "label": "Output resistance", "unit": "Ω" }, { "key": "CL", "label": "Cable C_L", "unit": "F" } ],
  "params": { "GBW": 1e6, "AOL": 112, "Ro": 496, "CL": 1e-9 },
  "levels": [
    { "name": "Ideal", "adds": "a virtual short: v_out = v_in",
      "valid": "An ideal op-amp: signals much slower than {GBW/1e6:3} MHz, inside the swing, a cable below {1e12/(20*pi*GBW*Ro):3.0} pF.",
      "requires": [ { "value": "CL", "max": "1/(20*pi*GBW*Ro)", "says": "a cable below {1e12/(20*pi*GBW*Ro):3.0} pF (its pole a decade above the crossover)" } ],
      "diagram": { "blocks": [ … ], "wires": [ … ] } },
    { "name": "+ gain–bandwidth", "adds": "…", "valid": "…", "diagram": { … } }
  ],
  "level": 1 }
```

- `mask` and `params` are the subsystem mask of [transparent-models.md](transparent-models.md) §1.4, unchanged.
- `levels`: two or more `{ name, adds, valid, requires?, diagram }`. `name` is short (at most 32 characters) and unique within the subsystem. `adds` is a short sentence of what this level adds to the one below. `valid` is a sentence; `{formula:fmt}` in it is evaluated over the mask (formula.js, formatted as the views' text), so its numbers follow the parameters. `requires` is a list of parameter ranges (§4). `diagram` is an ordinary diagram.
- `level`: the chosen level, **1-based** (`L1` is `"level": 1`; default 1). It is 1-based because the person reads levels and the cap as numbers ("Detail ≤ 2"). A Controller's `variant` is 0-based: that is a different thing.
- A subsystem without `levels` keeps its `diagram`, exactly as today: it is a one-level subsystem. A subsystem with both `diagram` and `levels` is refused with a sentence.
- In code, every read goes through `core/levels.js`, which imports only `formula.js`:
  - `subLevels(b)` returns `b.levels`, or `[{ name: '', diagram: b.diagram }]`.
  - `levelDiagram(b, k)`.
  - `runningLevel(b, detail)`.
  - `seenLevel(b, detail, designDetail)`.
  - `checkPorts(b, where)`.
  - `maskScope(b, outer)`.

  Nothing else reads a subsystem's `.diagram` directly. A test greps `src/` for it.

**Which level runs.**
- `runningLevel = detail === 'max' ? n : min(level, detail ?? ∞, n)`, where `detail` is the project's global setting (§3.2).
- Nested subsystems with levels are resolved independently, at every depth.
- The compile records `el.levels: [{ path, name, chosen, running, n, names, states, blocks, params, bound, valid }]` for the UI, the CLI and agents.

### 2.2 The port check

`normalizeDiagram` checks every level against level 1:
- the In ports and Out ports: the same set of port numbers, contiguous from 1;
- the same port names (the In or Out block's `name`; unnamed ports are `In k` and `Out k`);
- the same units. In and Out gain a `unit` parameter, default `1`.

**Refusals name the subsystem, the level and the port:**
- "Board: level 3 has In ports 1 and 2, level 1 has In port 1. Every level has the same ports: add or remove a port in all levels."
- "Board: Out 1 is 'v_out' (V) in level 1 but 'vo' (V) in level 2."

**Ports belong to the subsystem, as in PLECS.** In the Plant tab, adding, renaming or deleting an In or Out inside one level does the same in every level. A new Out in another level is left unconnected, and that level's warning says so. Deleting a port that has wires in other levels asks first. So the refusals above come only from files written by hand.

`blockPorts(subsystem)` reads level 1's ports, since all levels have the same.

**Sinks inside levels.**
- The same Sink name may appear in several levels of one subsystem, since only one of them runs. It must have the same unit in each.
- A name used in two different subsystems, or both inside and outside one, is refused, as today.
- `diagramNames` returns the union over all levels. Each name carries `from: { path, level }`, the lowest level that has it, so the scope can say "not modelled at level 1".

**Other blocks inside levels.**
- Sources in levels: the Input tab lists every Source in any level.
- Controller and Observer blocks may sit in a level. The Controller tab lists those that do not run greyed: "in Board L3, not running".
- An External plant (Live) may not sit in a level. It is refused with "a live plant cannot be switched off by a level".

### 2.3 Parameters: the subsystem mask, shared by every level

The mask is [transparent-models.md](transparent-models.md) §1.4, built in that plan's step 2:
- `mask: [{ key, label, unit }]` and `params: { key: number | formula }` on a subsystem;
- number fields inside, at any depth, may be formulas in the mask names (innermost first), compiled by `core/formula.js` at compile time;
- Equations blocks read the names as constants;
- refusals name the unknown name and list what is there.

Levels add four things to it:
- **Every level reads the same mask.** The mask sits on the subsystem, beside `levels`, not inside a level. A level uses the subset it needs.
  - The Parameters panel shows, for each mask field, the lowest level that uses it ("used from L3").
  - It greys a field with "not used at L2" when the running level does not read it.
  - That greyed list is what the running level leaves out: the person's "more parameters".
  - A mask name that only some levels use is not an error.
  - A formula naming a key the mask does not have is refused, as in that plan.
- **`inf`.** `formula.js` gains the constant `inf`, so an effect can be switched off by its neutral value in a file: `"SR": "inf"`. A formula that comes out infinite is allowed only where the block allows it, and is refused elsewhere with a sentence ("Board/L3/cable K = 1/CL = inf: a gain must be finite"):
  - Saturation limits;
  - the Integrator's `min` and `max`, where ±inf means none;
  - Valid range limits and `requires` bounds.
- **Transfer-function coefficients** (`num`, `den`) may be formulas too, entry by entry: `"den": ["L", "R"]`. The motor's armature needs this.
- **Level-only constants.** Structural constants a level needs (a sum's signs, an integrator's K of 1) are typed in place. Physics values are not: a guard test flags any number other than 0, ±1 and 2 inside the levels of a library system.

Editing the mask's fields themselves (adding or renaming a parameter) is JSON only for now, as in that plan.

## 3. In the page

### 3.1 Per subsystem: the badge, the panel, the level tabs

**On the canvas**, a subsystem with levels carries a badge at its top right, in the chip style of the one design system:
- `L2/4`: level 2 of 4 runs.
- `L1/4 ↓`: the cap lowered it. Its tooltip reads "capped by Detail ≤ 1; chosen: L3".
- `L4/4 ↑`: raised by Detail: Highest.
- An amber `!` when the running level is outside its validity (§4). The tooltip gives the sentence.

**The block's formula line** shows the running level's name ("+ output resistance and cable").

**A click on the badge** opens a menu of the levels by name, with the running one marked. Choosing one sets `level`, as one undo step. This is the quick way to step through levels while watching the scope.

**The parameters panel** (subsystem selected) has three parts:
- **Parameters**: the mask's fields (§2.3), with SI prefixes and the wheel, as everywhere. Each is marked "used from L3", and greyed "not used at L2" when the running level does not read it.
- **Levels**: a list like the Controller tab's variants. Each row shows:
  - `L3 + output resistance and cable`;
  - what it adds;
  - `2 states · 14 blocks · 5 parameters · steps ≤ 80 ns`;
  - the validity sentence;
  - on the running level, the last run: "2000 steps of 10 ns, 1.3 ms".

  A click chooses a level. **Duplicate as next level** inserts a copy after it, named "<name> (copy)", and chooses it. **Rename**, **Delete** (not the last level) and **↑ ↓** reorder.
  - A one-level subsystem shows only **Add a level**, which turns it into two levels with the same diagram.
  - Moving or deleting the chosen level keeps the choice on the same diagram.
- **Open**, as today.

**Opening.**
- Double-clicking the subsystem opens the running level. The breadcrumb reads "Plant › Board (L3 + output resistance and cable)".
- A row of level tabs sits above the canvas inside the subsystem: `L1 Ideal · L2 + gain–bandwidth · ● L3 + output resistance and cable · L4 + large signal`. The dot marks the level that runs. The tab being viewed carries the one "selected" style.
- Viewing a level does not change what runs. A level that does not run is fully editable, under a quiet line: "Level 4 does not run (Board runs level 3) · Run this level".
- Esc and the breadcrumb go back up, as today.

### 3.2 Globally: Detail

- **The Plant tab's panel, with nothing selected**, gains a **Detail** row with a select: **As chosen** (default) · **≤ 1** · **≤ 2** · … (up to one below the most levels any subsystem has) · **Highest**. Below it is a table of every subsystem with levels: path, chosen level, running level, and validity (✓, or the amber sentence). A click on a row selects that subsystem.
  - "≤ 1" is Amesim's "Premier submodel": every model at its simplest.
  - "Highest" raises every subsystem to its most detailed level, the "validate on the detailed model" step (interpretation; the person said "capped globally").
- **On the display**, the status line carries a chip whenever the setting is not As chosen ("Detail ≤ 1"). A click opens the Plant tab on that panel. It also carries the first validity sentence of the run, if there is one.
- Saved as `sim.detail` (§11). Loading a whole system from the library sets it from the entry, which has none: As chosen. Undo covers it.
- Agents:
  - `window.loopTuner.detail(x?)` sets or reads it (`null`, a number, or `'max'`) and returns `{ detail, subsystems: el.levels }`.
  - `window.loopTuner.level(path, k?)` does the same for one subsystem.
  - The CLI takes `--detail <k|max>` on `run`, `design` and `autotune`.

### 3.3 The scope and missing signals

- A scope channel whose source is a Sink that the running level does not have draws nothing. Its badge reads "i_out: not modelled at L1 (Board)". It never draws 0: zero would be a lie about the physics. Simulink and PLECS output zero for inactive outputs; Loop Tuner does not.
- Loading a project or a system keeps channel names that exist in any level (today, names that no longer exist are cleared).
- Saved traces and references are unchanged: they hold what ran.

## 4. Validity: each level says where it holds, and the run says when it leaves

Two machine checks, both visible:

1. **Parameter ranges.** A level's `requires: [{ value, min?, max?, says }]`, all formulas over the mask (`value: "CL"`, `max: "1/(20*pi*GBW*Ro)"`). They are evaluated at compile, so no run is needed. A failed one reads: "Board L1 is outside its validity: C_L 1 nF; it assumes a cable below 32 pF (its pole a decade above the crossover)."
2. **Valid range**, a new block in the Signals group. It is the fourth way for a signal to end, beside Out, Sink and Terminator.
   - One input; `min` and `max` (formulas; `±inf` allowed); `says` (what is beyond, and which level models it).
   - Its name is what it checks ("v+ − v−").
   - In a run it records the first sample outside [min, max]: "Board L3 left its validity at 10.0 µs: v+ − v− 0.42 V is beyond ±95.5 mV (the op-amp slews; level 4 models it)."
   - In model mode (designs) it is a Sink, nothing more.
   - It may sit anywhere, not only in levels. A model can carry its validity even with one level.

**Where the results go.**
- `simulateSystem` returns them in `info.validity: [{ path, level, block, t, value, min, max, says }]`, the first violation per check, and the parameter failures with `t: null`.
- The display's status line shows the first one, and the canvas badge turns amber.
- The CLI prints them.
- Agents read them from `window.loopTuner.run()` info.

This is how "the physics can never be wrong at every level" holds in use, not only in tests. A level is never silently used outside the range where its physics holds: the page says which effect is missing and which level has it.

What validity is not: it does not choose the level for the person. SPICE's model binning picks parameter sets by range automatically. Here the person chooses, and the page says when the choice does not fit.

## 5. Simulation: stiffness, step size, cost

**Levels make models stiffer.**
- The op-amp's level 2 adds a loop at 2π·GBW = 6.3·10⁶ 1/s.
- The motor's level 2 adds the armature's R/L = 100 1/s.

**The step bound must see loops through integrators (prerequisite).**
- Today `hmax = 0.5/bound` uses each block's own poles (`rootBound` per transfer function, `ode.bound` per physics block). An integrator's bound is 0, so a fast loop built from Integrator and Gain blocks (the op-amp model, the sliding-mode research's motor in integrator form) is invisible to it.
- On the op-amp example's 20 µs screen this happens not to matter. Without a Controller, the record step is the window / 2000 = 10 ns, finer than the 80 ns the loop needs.
- Set the timebase to 1 ms/div and the record step is 5 µs. Then RK4 runs at λh = 31 (stable only below 2.8): the run diverges.
- **The fix:**
  - `compileDiagram` gains `el.jacobianBound(X, t)`: a finite-difference Jacobian of the rates at the start state (n + 1 evaluations of `eval`, step 1e-6·max(1, |x|)), with sampled blocks holding their outputs.
  - Its ∞-norm bounds every eigenvalue. `simulateSystem` takes `bound = max(block bounds, ‖J‖∞)`.
  - At the end of the run it checks ‖J‖∞ at the final state. If that is larger, it runs once more with it, with the note "stiffer later in the run".
  - This is the sliding-mode research's Recommendation 9, needed here first.
- [transparent-models.md](transparent-models.md) §10 leaves a computed bound out, because it would not restore the open tank's old step. That still holds: the tank's |λ| at its start (13–17) allows steps far longer than its record's 2.5 ms, so the bound changes nothing there. Levels need it for another reason: stiff linear loops built from Integrators.

**Too many steps.**
- A detailed level on a long screen can need more steps than the cap (400 000). The op-amp at 10 ms/div needs 1.25 M.
- The run is still drawn, as today, but the warning becomes specific and red. It names the fastest state's subsystem and level: "Board L3 needs steps of 80 ns; this 100 ms screen would take 1.25 M steps; it ran 400 k: inaccurate. Shorten the screen or lower the level."
- The badge turns red.
- An implicit or multirate solver is not built (§14).

**Cost: "more calculations".** For each level the panel shows:
- states;
- blocks evaluated per step;
- mask parameters used;
- the step it needs on its own (0.5/bound of that level compiled alone, its In ports at 0);
- on the running level, the last run's steps and time (`info.steps`, `info.ms`).

The header's Speed readout shows the same cost live. At ∞ it runs at the simulation's own speed ([instrument.md](instrument.md#speed)): the page's limit for this level on this screen.

**Example costs.**
- Op-amp board, levels 1 to 4: 0, 1, 2, 2 states; about 2, 7, 14, 15 blocks, not counting validity checks; 0, 2, 5, 8 parameters. Levels 2 to 4 all need steps ≤ 80 ns.
- On the 20 µs screen every level takes the record's 2000 steps of 10 ns. The higher levels cost more per step, not more steps.
- Lowering C_L makes level 3 stiffer: at 1 pF it needs 0.12 ns steps, which is why C_L has a lower limit (1 pF).

## 6. The design layer on levels (the design layer is merged)

**The plant a block sees** ([designs-in-the-page.md](designs-in-the-page.md) §4) is compiled at the **seen** level of every subsystem with levels:
- `seenLevel = min(runningLevel, designDetail ?? ∞)`;
- `designDetail` is a design input of the running designed variant.

By default it is empty, so a design sees what runs, and raising a level re-designs. A design never sees more detail than runs.

- **`designDetail`** is a common optional parameter of every designed type. In the Controller tab it is labelled "Design on detail ≤", with the choices "as it runs", 1, 2, …. It is an input, allowed in the file (Rule 1 of the design layer). It applies to every subsystem with levels in the plant the block sees. The person sets it to 1 to run the experiment. No library example needs it yet: the op-amp board has no Controller. The motor and the carts, once they have levels, are where a designed variant would show it.
- **Model compiles.**
  - `store.begin(diagram, compileModel)` becomes `compileModel(detail)` → `compileDiagram(copy, path, { mode: 'model', detail })`.
  - The store keeps model compiles by `plantKey(diagram, seen)`, still an LRU of 8.
  - In one compile, two variants that see different levels get two model compiles.
- **`plantKey(diagram, seen)`** replaces each subsystem with levels by its seen level's diagram, together with the subsystem's mask. Unseen levels are dropped. Consequences:
  - These never re-design a `designDetail: 1` variant: editing level 3, choosing level 3 to run, capping to 2.
  - These do: editing level 1, editing a mask parameter that level 1 reads.
  - A variant without `designDetail` re-designs whenever the level that runs changes, since that is the plant it sees.
- **The status** gains `detail: { seen: [{ path, name, level, of }], runs: [...], missing: [adds…] }`. When seen and running levels differ:
  - The Computed box shows an amber line: "Designed on Motor L1 · runs Motor L2 · not in the design: + armature inductance". The `adds` sentences of the levels in between are exactly "the effects that we didn't model".
  - The variant's glyph reads "computed · L1".
  - Not an error: the design runs.
- **Refusals gain a hint about detail.** For example, LQR on the motor at level 2 sees the armature current, which no input measures: "LQR needs every state measured: it sees angle and speed but not Motor/armature (Motor L2). Design on detail ≤ 1, wire the current to an input, or add a Kalman Observer."
- **Observers.**
  - A Kalman observer's look-through holds only when the Observer and the Controller see the same levels (the global state order changes with levels). Otherwise: `detail-mismatch`, "the Observer is designed on detail ≤ 1, this Controller on ≤ 2; design both on the same detail".
  - A Kalman filter designed on a lower level and running on a higher one estimates the lower level's states, which is a real model mismatch: its rows say so.
- **Plans** (`trajectory`) are keyed by the seen plant, so they follow the same rules.

## 7. Auto-tune and Analysis on levels

**Auto-tune** tunes by simulating what runs.
- A field **Tune on: [as it runs ▾ | detail ≤ 1 | …]** makes its cost runs and its experiments (relay, step) use that detail instead.
- When the tuning detail differs from what runs, each result also reports its cost as it runs: "×0.42 on detail ≤ 1 · ×1.7 as it runs (Motor L2; not tuned for: + armature inductance)". The person sees in one number what the simpler model hid.
- A result variant holds hand numbers, as today, and runs on the running levels.
- The CLI takes the same as `--tune-detail`.

**Analysis** linearises the loop as it runs (`loopModel(…, { detail })`, the running levels).
- When the running variant is designed on less detail, the tab overlays the loop as designed, dashed, on Bode, Nyquist, the root locus and the step. The key numbers table gains a column "as designed (Motor L1)".
- A **Plant** choice, "as it runs | detail ≤ k", lets the person look at any level.
- Snapshot operating points (`{ t }`) exist only as it runs: a snapshot's state belongs to the running levels.
- An analog loop with no Controller block, such as the op-amp follower, has nothing for Analysis to cut. Analysis at a wire (a loop probe, as SPICE's Middlebrook or Tian probes) is not built (§14). The example's margins are checked by tests.

**Identify** (designed, not built) experiments on the plant as it runs.

## 8. Every model gets levels

What "everything we model should support this detail level separation" means here:
- the mechanism is generic: any subsystem;
- every shipped model is built as a subsystem that can take levels (Rule 10);
- each model gets the levels that are physically meaningful, valid and cheap to test.

The level each System library entry runs today is kept as its chosen level, so no example changes when its model gains levels. A test checks this bit for bit.

| Model (systems that use it) | Levels (today's model in bold) | Validity of the lowest level | When |
|---|---|---|---|
| **DC motor**: the Motor subsystem (DC motor position control, Following a sine, Encoder errors; Sliding mode on feat/smc) | L1 rigid, no inductance: i = (V − Ke·ω)/R, 1 state · L2 **+ armature inductance** (today: L·di/dt = V − R·i − Ke·ω), 2 states · L3 + compliant coupling (rotor and load as two inertias on a shaft of stiffness k and damping c; ports unchanged, speed is the load's), later, when an example needs it | Voltages that change slowly compared with L/R = {L/R} (10 ms): no relay, no chopping | Step 8. The mask is R, L, Kt, Ke, J, b. Built on feat/smc's Transfer function form (armature num [1], den [L, R]), so **L2 with L = 0 is L1 bit for bit** (`polyTrim` makes den [0, R] a gain 1/R) |
| **Cart–pole** (Pendulum swing-up) | L1 ideal: frictionless cart and hinge, point mass · L2 **+ friction** (today's cart friction b; hinge damping c, 0 by default so today's run is unchanged) · L3 + drive: the commanded force F goes through a belt-driven motor with a current loop (a lag τ_i, a current limit I_max, the bus voltage limiting the force at speed, R·i + Ke·v/r ≤ V_bus), and the rotor's inertia J_m/r² joins the cart. Ports unchanged: F is now the command | Small friction. At L2: a drive much faster than the pendulum, with force to spare at every speed | After [transparent-models.md](transparent-models.md) step 7 (the carts open). In its parts: L1 is the open cart with the Rail's b and the Hinge's c set to 0; L2 reads them from the mask; L3 adds an Equations block, a limited Integrator for the current and a second Mass (J_m/r²) at the cart's frame. Wrapping today's black-box block first would mean building it twice. L3 is where a swing-up planned on L2 may fail: the plan asks for force at speeds the drive cannot deliver. A candidate later example |
| **Pendulum chain on cart** (Triple pendulum) | As the cart–pole: L1 ideal · L2 **+ friction** (today) · L3 + drive. Later: + rod mass (a uniform Rod part, `at: uniform`, beside each bob) | As the cart–pole | As the cart–pole |
| **Conical tank** (Conical tank, gain scheduling) | L1 **Torricelli**: an ideal orifice and pump (today) · L2 + real outlet and pump: a discharge coefficient Cd in the outlet's equation (`qout = Cd*a*sqrt(2*g*h)`; about 0.61 for a sharp-edged orifice, neutral 1) and the pump's spin-up lag τ_p (a Transfer function before the pump, den [τ_p, 1], neutral 0) | An outlet without contraction losses, a pump that follows its command at once | After transparent-models.md step 4 (the tank opens). With the neutral values L2 is L1 exactly |
| **Oven** | One level. Heater, chamber, dead time and thermocouple already are its detail; a lumped level (one lag with τ = the sum, and the dead time) only if an example needs it | – | – |
| **Mass–spring–damper** | One level (primitives, not a subsystem) | – | – |
| **HIL: external motor** | None: its physics is outside the page | – | – |
| **Op-amp board** (new example) | Four levels (§9) | – | Step 7 |

**With the openable-physics plan.** [transparent-models.md](transparent-models.md) rebuilds the cart–pole, the chain and the tank from physical parts (World, Rail, Hinge, Mass, Rod) and primitives (Equations, the limited Integrator).
- Each gains its levels on top of that rebuild, as whole subsystems. That plan keeps frame ports off subsystem boundaries (its §10), so a level is the whole mechanism, never one part inside it. That is all levels need, as its §10 also says.
- The two plans share the mask and formula parameters, the limited Integrator and the Equations block, built there.
- This plan adds the Jacobian step bound (§5). Whichever plan reaches a shared piece first builds it.

The PUMA 560 robot is built the same way: rigid bodies are L1; joint friction, motors with gears and flexible joints are later levels.

## 9. The example: "Op-amp follower and a cable"

**One thing, with a second on request:** the effect the simpler levels did not model makes a loop that looked perfect ring. Then large signals change it again.

**The board.**
- An op-amp of the MCP6001 class (1 MHz CMOS, rail-to-rail; numbers from datasheet DS20001733L, typical at 25 °C) on ±2.5 V, so signals are ground-referenced and everything starts at rest at 0.
- Wired as a voltage follower.
- It drives 1 nF of cable (about 10 m of coax) into a 10 kΩ input. That is the datasheet's own load resistor, so its 500 pF phase-margin figure can calibrate R_o.

**Diagram.** Source `v_in` (V) → **Board** In `v_in` (V); Board Out `v_out` (V) → Sink `v_out` (V). Inside levels 3 and 4: Sink `i_out` (A).

**Input `v_in`**, period 20 µs:
- a step to 80 mV at 1 µs: a small signal, below the 95.5 mV at which this op-amp slews;
- then to 0.5 V at 10 µs: a large one.

Both read on one scale. A 50 mV step and a 1.45 V step, as first researched, cannot share 8 divisions: the small step's ringing would be a tenth of a division.

**Screen and opening.**
- 2 µs/div, position 0.
- Channels: 1 v_in and 2 v_out at 0.1 V/div, offset −0.3 V; 3 i_out at 0.5 mA/div; 4 off.
- Opens running in the Plant tab on the diagram (no view), so the Board's badge is what the person sees.
- Its `ui.speed` is **4·10⁻⁶×**, so the 20 µs screen sweeps in 5 s. At 1× a sweep takes a frame, and the faded earlier runs, one per sweep, would be gone within five frames, so the comparison between levels would never be seen.
- This needs one change to the time control (now on main, [instrument.md](instrument.md#speed)), which today leaves the speed as it is when a system carries none: a whole load from the System library sets the entry's `ui.speed`, or 1× when it has none. Without that, the next system would sweep at 4·10⁻⁶×. The speed field shows up to six digits, so it reads `0.000004×`.
- Tags: No controller, Nonlinear (some level is), **Detail levels** (a new feature tag: `systemTags` gives it to any system with a subsystem that has levels).

**Mask** (8 parameters):

| Key | Parameter | Value | Read by |
|---|---|---|---|
| GBW | Gain–bandwidth | 1 MHz | L2 (validity of L1) |
| AOL | Open-loop gain | 112 dB (A0 = 3.98·10⁵, so the dominant pole is GBW/A0 = 2.5 Hz) | L2 |
| Ro | Output resistance | 496 Ω: with the 10 kΩ load it reproduces the datasheet's 45° phase margin at 500 pF (44.997°) | L3 (validity of L1, L2) |
| CL | Cable C_L | 1 nF (at least 1 pF) | L3 (validity of L1, L2) |
| RL | Load R_L | 10 kΩ | L3 |
| SR | Slew rate | 0.6 V/µs | L4 (validity of L2, L3) |
| Vs | Supply ± | 2.5 V | L4 (validity of L1–L3) |
| Vsw | Swing from the rails | 25 mV | L4 |

R_o is a physics input, as a motor's R and L are; the test names its source. The test recomputes the 45° from it (§10), so the calibration is checked, not trusted.

**Levels**, each built from primitives:

| Level | Adds | Blocks (inside) | Validity checks | Validity sentence |
|---|---|---|---|---|
| **L1 Ideal** | a virtual short: v_out = v_in | In → Out | requires CL ≤ 1/(20π·GBW·Ro) (32 pF); Valid range on v_in, ±(Vs − Vsw), "beyond the output swing (level 4)" | An ideal op-amp: signals much slower than 1 MHz, inside the swing, a cable below 32 pF |
| **L2 + gain–bandwidth** | the open-loop gain and its dominant pole: one state | e = v_in − v_op (Sum +−) → input stage `2*pi*GBW` (Gain: gm/Cc) → Sum +− → Integrator **v_op** → Out; leak `2*pi*GBW/10^(AOL/20)` (Gain, flipped) from v_op back to the second Sum; v_op back to e | requires as L1; Valid range on e, ±SR/(2π·GBW) (95.5 mV), "the op-amp slews (level 4)"; Valid range on v_op, ±(Vs − Vsw) | Small signals (v+ − v− within ±95.5 mV), inside the swing, a cable below 32 pF. One pole: no second pole, offset or noise |
| **L3 + output resistance and cable** | R_o between the op-amp and its pin, the cable C_L and the load R_L: one more state, the output current | L2's op-amp, then v_op − v_out (Sum) → `1/Ro` (Gain) → **i** (Sink i_out) → i − v_out/R_L (Sum) → `1/CL` (Gain) → Integrator **v_out** → Out; `1/RL` (Gain, flipped) from v_out; the follower's feedback now from v_out (the pin) | Valid ranges on e and v_op, as L2 | Small signals, inside the swing. R_o is the small-signal output resistance near the crossover. It gives the datasheet's 45° at 500 pF ∥ 10 kΩ, but 80.5° at its 60 pF test load where the datasheet says 90° typical: a CMOS output's impedance changes with frequency |
| **L4 + large signal** | slewing (the input stage's current into the compensation capacitor is limited: Saturation ±SR after the input stage) and the output swing (v_op's Integrator held within ±(Vs − Vsw) without windup) | L3 plus one Saturation; v_op's Integrator gains limits | none | Signals inside the supply. Not modelled: offset (±4.5 mV max), noise, input capacitance, CMRR, PSRR, temperature, a second pole. Also not the short-circuit current: R_o = 496 Ω cannot pass more than about 10 mA (4.95 V across it), below the 23 mA limit, so the limit is left out. Also not the lower DC output resistance near the rails: into 10 kΩ this level's swing ends up to 0.12 V short of the datasheet's 25 mV |

- **States**: 0, 1, 2, 2. **Parameters read** by the blocks: 0, 2, 5, 8. The lower levels' validity checks read some of the others.
- **Neutral values**: L4 with SR = inf and Vs = inf is L3 bit for bit (checked). L3 tends to L2 as R_o → 0: on a 1.45 V step they are 8.7 mV apart at 1 Ω and 0.9 mV at 0.1 Ω. With the load resistor in the loop, C_L → 0 alone does not reach L2: at 1 pF they are 26 mV apart on that step, from the R_L divider.

**Notes** (shipped, so no quotes, names or dates):

> A circuit board: an op-amp (a 1 MHz CMOS part on ±2.5 V) wired as a voltage follower drives 1 nF of cable into a 10 kΩ input. The input steps to 80 mV at 1 µs (a small signal), then to 0.5 V at 10 µs (a large one); the 20 µs screen plays slowly. The Board has four levels of detail with the same ports, and opens at level 1, an ideal op-amp: v_out is exactly v_in. Raise it one level at a time (click L1/4 on the Board); the previous run stays, faded. Level 2 adds the gain–bandwidth: the edges take 0.35 µs, a perfect follower. Level 3 adds the op-amp's output resistance driving the cable: both steps now overshoot 38 % and ring for 3 µs, the effect the simpler levels left out (they say so: they assume a cable below 32 pF). At 10 µs level 3 also says it has left its validity: a step that large makes the op-amp slew. Level 4 adds slewing and the output swing: the small step rings exactly as at level 3, the large one rises more slowly (0.8 µs) and overshoots 19 %. Try the cable C_L on the Board: at 10 nF level 3 keeps ringing past the end of the screen.

**Expected numbers.** RK4 at the record step of 10 ns, the same to the digits shown at 1 ns. Steps are measured 10–90 %, and "within 2 %" is the time after the step when the output stays within 2 % of the step.

| Level | 80 mV step at 1 µs | step to 0.5 V at 10 µs | i_out peak | Validity reported |
|---|---|---|---|---|
| L1 | exact copy | exact copy | not modelled | at load: "C_L 1 nF; it assumes a cable below 32 pF" |
| L2 | no overshoot (< 0.001 %), 350 ns, within 2 % after 0.62 µs; phase margin 90° | the same shape | not modelled | as L1; and at 10.00 µs: v+ − v− 0.42 V beyond ±95.5 mV (slewing) |
| L3 | **37.6 %** (peak 110 mV, 0.92 µs after the step), 370 ns, within 2 % after 3.15 µs; **phase margin 33.0° at 519 kHz** | 37.6 % (peak 0.658 V) | 1.04 mA | at 10.00 µs: slewing |
| L4 | identical to L3, bit for bit, until 10 µs | 0.80 µs, peak 0.579 V (**18.7 %**), within 2 % after 3.6 µs | 0.54 mA | none |

**Turning the knob C_L at level 3** (follower phase margin; small-step overshoot):

| C_L | Phase margin | Overshoot |
|---|---|---|
| 60 pF | 80.5° | none |
| 500 pF | 45.0° | 23 % |
| 1 nF | 33.0° | 37.6 % |
| 2.2 nF | 22.6° | 53 % |
| 10 nF | 10.7° | 74 %, still ringing at the screen's end |

**This op-amp rings but never oscillates.** A one-pole op-amp plus the R_o·C_L pole is a two-pole loop, so its phase margin approaches 0° as C_L grows but never crosses it. Real oscillation needs an op-amp with a second pole below its gain–bandwidth (research §3). Ringing makes the person's point, and it keeps the example to one thing.

**The fix the notes do not take:** an isolation resistor (datasheet §4.3). It is a later "try" if the person wants a second experiment.

## 10. Tests

New `test/levels.test.mjs` and `test/opamp.test.mjs`; edits to `physics.test.mjs`, `core.test.mjs` and `design.test.mjs`.

1. **Each level against its own physics** (the board, with the level forced):
   - L2:
     - the 10–90 % rise is ln 9/(2π·GBW·(1 + 1/A0)) = 349.7 ns ± 10 ns;
     - the DC gain is A0/(1 + A0);
     - the simulation equals the linearised level's exact step response (matrix exponential) to 10⁻⁶ of the step.
   - L3:
     - the phase margin from the linearised level (closed loop T, open loop L = T/(1 − T)) equals the analytic 90° − atan(ωc·Rp·C_L) − (the dominant pole's lag) to 0.1°;
     - it is 45.0° ± 0.5° at 500 pF ∥ 10 kΩ, which is the datasheet calibration;
     - simulation equals the linear model to 10⁻⁶.
   - L4:
     - during the large step a test Sink on v_op reads a slope of SR to 10⁻⁶, and v_out's slope never exceeds SR;
     - v_op and v_out never leave ±(Vs − Vsw), also for a 2.4 V step, where L3 peaks at 3.30 V.
   - Motor:
     - L1 and L2 settle to the same speed Kt·V/(R·b + Kt·Ke) (1.43 rad/s per V);
     - L2's current rises with L/R.
2. **Neutral values give the level below, bit for bit:**
   - board L4 with SR, Vs = inf equals L3 on the example's input;
   - motor L2 with L = 0 equals L1;
   - tank L2 with Cd = 1 and τ_p = 0 equals L1 (once built).

   **Limits:**
   - board L3 → L2 as R_o → 0: the gap is at most 10 mV·(R_o/1 Ω) on the example's input, at R_o = 1 Ω and 0.1 Ω;
   - L2 → L1 as GBW grows.
3. **Agreement where they must agree** (inside the lower level's validity):
   - 1 kHz, 0.5 V sine: |L1 − L2| ≤ 1.05·A·f/GBW (0.53 mV; measured 0.500); |L2 − L3| ≤ 0.05 mV at C_L 1 nF (measured 0.025: the loop gain hides the output pole at low frequency).
   - Steps below SR/(2π·GBW): L3 and L4 identical bit for bit (90 mV). Above, they differ (100 mV: 0.63 mV).
   - Motor: L1 and L2 within 1 % for a 0.2 Hz voltage sine (0.4 % by the transfer functions), and more than a factor 2 apart at 50 Hz, so the level adds something.
4. **The example's degradation** (the library entry as loaded, each level forced in turn): the table of §9 within the stated digits (overshoot ± 0.3 %, times ± 1 record step, the 18.7 % and 0.579 V ± 0.5 %), the validity reports of §9's last column, and L4 reporting none.
5. **Guards over every library system with levels:**
   - every level has a name, `adds` and `valid`;
   - identical ports (port check);
   - every level compiles alone;
   - not counting Valid range blocks, each level has more blocks than the one below;
   - no physics literal inside levels (Rule 4);
   - the running levels of every system are unchanged by this work: the motor examples' runs are bit for bit the same as before;
   - `systemTags` gives "Detail levels".
6. **Data:**
   - round-trip of `levels`, `level`, `inf`, `requires`, Valid range, In/Out units, `sim.detail` and `designDetail`, inside a masked subsystem with formulas (the mask's own tests are transparent-models.md §8.5);
   - every refusal sentence of §2;
   - old files load unchanged;
   - a file with both `diagram` and `levels` is refused.
7. **Step bound:**
   - board L2 at a 1 ms/div screen does not diverge and equals the linear model to 10⁻⁶;
   - L3 at 100 ms/div warns with the level and the step it needs;
   - the existing systems' runs: any whose step changes is listed in the commit (it was too long before).
8. **Design layer** (a test project: the motor's angle loop, measurements angle and speed, an `lqr` variant):
   - with the motor at L2 and no `designDetail`: `states-not-measured` with the detail hint;
   - with `designDetail: 1`: status ok, with `detail.missing` = ["+ armature inductance"];
   - cache: a hit after editing L2's diagram or choosing L2 to run; a re-design after editing L1 or R;
   - Kalman and LQR on different details: `detail-mismatch`;
   - Analysis's "as designed" loop has the poles of the L1 design.
9. **Validity:**
   - a Valid range reports the first sample outside its range with t and value, once;
   - `requires` is evaluated at compile;
   - neither changes a run.
10. **Bundle:** `bundleScript()` parses with `core/levels.js` in MODULES before `diagram`.

## 11. Project format (additions; still `loop-tuner/2`)

- **Subsystem:**
  - `mask` and `params`, and formula strings in number fields: as [transparent-models.md](transparent-models.md) §1.4 and §6 define them. Formulas may also stand in a transfer function's `num` and `den` entries, and may use `inf`.
  - `levels` (optional, two or more): `[{ name, adds, valid, requires?: [{ value, min?, max?, says }], diagram }]`.
  - `level` (1-based, default 1).

  Without `levels`, `diagram` as today.
- **Block changes:**
  - In and Out blocks: `unit` (default `"1"`).
  - The Integrator's `x0`, `min`, `max`, `unit` and `angle`: as transparent-models.md §1.3 defines them. A limit of ±inf counts as none.
  - New block `validRange`: `{ min, max, says }`.
- **`sim.detail`** (optional): absent (as chosen), an integer ≥ 1 (a cap), or `"max"` (every subsystem at its highest level).
- **Designed variants**: `designDetail` (optional, an integer ≥ 1; absent: as it runs).
- **System library entries**: `ui.speed`, as the time control defines it.

```json
"sim": { "detail": 1 },
"variants": [ { "name": "LQR, designed on level 1", "type": "lqr", "params": { "Q": [10, 1], "R": 0.1, "designDetail": 1 } } ]
```

## 12. Migration

- **Old files load unchanged.** Subsystems without levels keep `diagram`, numbers stay numbers, and nothing old changes meaning, so the format version stays.
- **Scope channels** naming a Sink in any level are kept on load.
- **Library entries:**
  - The motor's Motor subsystem gains its mask and levels with `level: 2`, so the motor examples run as before (test 5).
  - The open tank gains its L2 with `level: 1`; the carts gain theirs with `level: 2`.
  - My blocks keep a subsystem whole: mask and levels.
- **Code that read `subsystem.diagram`** moves to the `levels.js` helpers:
  - `blockPorts`, `normalizeDiagram`, `compileDiagram`'s `level()`, `diagramNames`;
  - `plantKey` (feat/designs) and `blockInputNames`;
  - the Plant tab's open, breadcrumb and Group;
  - `systemTags` and the views' signal lists.
- **Older pages cannot read levels.** A file and its page travel together (Export HTML), so this is accepted.

## 13. Implementation steps (each one agent; `npm test` green at the end of each)

0. **Record.** Rules of §1 and the interpretations of §15 into decisions.md, replacing "being designed". Roadmap entries. The person's words are already saved (input 10).
1. **Jacobian step bound** (§5) in `compileDiagram` and `simulateSystem`, with the end-of-run check and the specific stiffness warning (naming the fastest state's block; levels come later). Test 7, first and last parts. Independent of levels; it also unblocks the sliding-mode research's integrator-form motor.
2. **Shared prerequisites, from [transparent-models.md](transparent-models.md):**
   - its step 2: masks and formula parameters;
   - its step 3: the Integrator's limits and the Equations block.

   If that plan has not built them yet, build them here, by its definitions, once.
   
   Here add:
   - `inf` in `formula.js`;
   - formulas in transfer-function coefficients;
   - `unit` on In and Out.

   Their tests.
3. **The Valid range block**, with `info.validity` and the display's status sentence (`requires` waits for step 4). Test 9 for the block.
4. **Levels in the core:**
   - `core/levels.js` (in MODULES before `diagram`); `levels` and `level` on subsystems; the port check; Sinks across levels;
   - `compileDiagram(…, { detail })` building the running levels; `el.levels` with states, blocks, params and the level's own bound;
   - `requires`; `sim.detail` in the project and `simOf`; `diagramNames` with `from`; channel names kept;
   - `--detail` in the CLI; `loopTuner.detail()` and `level()`.
   
   Tests 5 (structure guards), 6 and 9.
5. **Levels in the Plant tab:**
   - the badge with its menu; the Levels list (choose, Add a level, Duplicate as next level, rename, delete, reorder; states, blocks, parameters, step, last run);
   - level tabs inside, and ports edited across levels;
   - the Detail select and table, and the display's chip;
   - "not modelled at Lk" on channel badges; undo for each.
   
   Checked in the browser (Playwright): choose levels by badge, cap, open a level, edit a port in one level.
6. **Stiffness warning by level**: the warning names the subsystem and level, and the badge turns red. Test 7, middle part.
7. **The example** "Op-amp follower and a cable" (§9):
   - the board's four levels from primitives, the notes, the tag;
   - `ui.speed` 4·10⁻⁶, and the time control's change: a whole load sets the entry's speed, 1× when it has none ([instrument.md](instrument.md#speed)).
   
   Tests 1, 2 and 3 for the board, and test 4. Then system-library.md's table and a "How the board was modelled" paragraph. Browser check: step through the levels and see the faded comparison and the validity line.
8. **Motor levels.** Mask (R, L, Kt, Ke, J, b) and L1 and L2 on the shared Motor subsystem (`motorDiagram` and the encoder's), chosen level 2. Merge feat/smc first, for its Transfer function form. Tests 1, 2 and 3 for the motor, and the bit-for-bit guard. If the sliding-mode example is merged, its notes gain one sentence: Motor L1 makes the relay look perfect; L2, the real motor, chatters.
9. **The design layer on levels** (§6; feat/designs is merged):
   - `designDetail` on every designed type; `compileModel(detail)`; `plantKey(diagram, seen)`;
   - `status.detail`, the Computed box line and glyph, the detail hints in refusals, `detail-mismatch`.
   
   Test 8.
10. **Auto-tune and Analysis on levels** (§7): the Tune on field and the as-it-runs cost; Analysis's as-designed overlay, column and Plant choice. Test 8, last part. Browser check.
11. **Physics levels**, each after its open subsystem exists ([transparent-models.md](transparent-models.md) steps 4 and 7):
    - the tank's L2 (Cd, pump lag), chosen level 1;
    - the carts' L1 (ideal) and L3 (drive) around today's model as L2, chosen level 2.

    Tests 1 and 2 for each. The carts' behaviour tests stay green unchanged.
12. **Docs sweep:**
    - plant-editor.md (levels, the badge, Valid range), project-format.md, system-library.md, controller-proposal.md (designDetail), autotune.md, analysis.md;
    - AGENTS.md (`--detail`, `loopTuner.detail`, validity in run info);
    - the roadmap, the output README's status, the page's Help (a short "Detail levels" section).

Dependencies:
- Steps 1 and 3 to 7 need nothing from other branches. The time control is on main.
- Step 2 is shared with transparent-models.md.
- Step 8 wants feat/smc (the motor as transfer functions).
- Steps 9 and 10 build on the design layer (merged from feat/designs).
- Step 11 needs transparent-models.md's steps 4 and 7.

## 14. Not built

- **Choosing the level automatically** when a run leaves a level's validity (SPICE binning). The page reports it; the person chooses.
- **Switching a level during a run** (Simulink's runtime activation). Levels are fixed per compile.
- **Ports that differ between levels** (Simulink's flexible interface, Simscape's conditional ports). Refused by design.
- **Unordered alternatives for plant subsystems** (variant subsystems). Controllers have variants; a level is an ordered rank.
- **Linearised levels.** A level is a physical model; linearising is the design layer's job.
- **Parameter corners and Monte Carlo sets** (SPICE `.lib` corners). These belong to robustness against plant variations (roadmap).
- **An implicit or multirate solver** for stiff levels on long screens: the warning names the level instead. **Breakpoints** that put steps exactly on source edges.
- **Analysis at a wire** (a loop probe), for analog loops without a Controller block such as the op-amp follower.
- **The op-amp:**
  - offset, noise, input capacitance, CMRR, PSRR, temperature, a second pole;
  - a frequency-dependent output impedance;
  - the short-circuit current (unreachable with this R_o);
  - the isolation-resistor fix;
  - a real oscillation (it needs a two-pole op-amp).
- **Motor and pendulum levels beyond those in §8:** Coulomb and stick–slip friction (they need a stick state, not a sign function, to stay right in RK4), cogging, thermal drift, PWM switching. The research found that PWM and dead time are invisible to a ms speed loop.
- **Encrypted or compiled models**: never.

## 15. Interpretations (for the decision log) and questions for the person

- **"The interfaces stay more or less the same"** is read as **identical ports**. Extra quantities a higher level models are Sinks inside it. "More or less" is covered by the parameters: a lower level ignores some.
- **The cap.** The global setting caps ("≤ k"), as told to the person. It also offers **Highest**, every subsystem at its most detailed, for validating a design (ours).
- **Designs see what runs, unless pinned.** By default a design sees the running levels, so raising a level re-designs. To see the loop "work worse", a designed variant pins `designDetail`; the page then says what the design does not know.
- **The example opens at level 1**, whose validity line already says the cable is too large for it (C_L 1 nF > 32 pF). Build up from simple: the simple model knew its limit, and the run shows why.
- **Its 20 µs screen plays at 4·10⁻⁶×**, so it sweeps in 5 s and the faded run of the previous level stays to compare. The "5 s" rule for µs systems becomes "one screen, watched for about 5 s".
- **R_o** is a physics input taken from the datasheet's 500 pF point, and checked by a test, not computed in the page.
- **Questions:** is "Highest" wanted beside the cap? Should the global Detail sit in the header with the time control instead of the Plant tab? Ringing, or a real oscillation with a two-pole op-amp?
