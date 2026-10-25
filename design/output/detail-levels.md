# Detail levels

Reader: whoever builds detail levels (levels of a subsystem, the step bound they need, the validity checks, the op-amp example) or changes a model so it can have them. The person's words are in [input 10](../input/2026-10-24-10-sliding-mode-and-triple-swingup.md), last section; their answers to this page's questions are in [input 13](../input/2026-10-25-13-detail-levels-answers.md) (§14). The research, with every number checked, is in [../research/detail-levels.md](../research/detail-levels.md); its first section lists what two reviews corrected in this plan. Three prerequisites are shared with [transparent-models.md](transparent-models.md) and defined there:
- subsystem masks and formula parameters;
- the Integrator with limits;
- the Equations block.

Where the code and this page differ once it is built, the code wins and this page is fixed.

**Any subsystem can hold several levels of detail: ordered, named diagrams with identical ports, each one openable.** A global level (**Detail**, in the Plant tab) applies to every subsystem with levels. A subsystem may override it on its block (a level chip, `L2/4`), above or below. The level that runs is the override if there is one, else the global level, in both cases at most the highest level the subsystem has: a global 4 runs level 2 on a block with two. **Clear**, beside the global level, removes every override at once; undo restores them. Each chip shows whether its block is overridden or clamped. Each level's name says what it adds ("+ output resistance and cable"); the page shows how many states and parameters it costs and where it is valid. When a run leaves that validity, the page says so. The person's experiment works with what runs: set the global level low, design or tune, keep the numbers, raise it, and watch the loop get worse. Levels are compared with Single runs: earlier runs stay on screen, fading, as after any edit. The first example is a circuit board: an op-amp follower driving a cable. At levels 1 and 2 the follower is perfect. At level 3 the op-amp's output resistance meets the cable's capacitance, and the same steps overshoot 38 % and ring at 541 kHz for 4 µs: the ringing every electrical engineer knows, more as the cable grows. Level 4 adds slewing, which changes the large step.

(The person: "you can have a model of something and it has different detail levels … the interfaces stay more or less the same, but … the model introduces more calculations and more parameters … if I increase detail level, the control works worse because then there are some effects that we didn't model right, and everything we model should support this detail level separation.")

## 1. Rules (they go into decisions.md)

1. **Levels are ordered and named.** Level k + 1 is level k plus named effects. Its name says what it adds ("+ gain–bandwidth"), as LTspice's op-amp levels do. A level is a rank inside one subsystem, not a model index as SPICE's `LEVEL` is. Unordered alternatives stay where they are: variants of Controller and Observer blocks.
2. **Identical ports.** Every level has the same In and Out ports: the same numbers and names. The ports are the device's terminals at its most detailed level. A quantity only a higher level models (the cable current, the op-amp's internal node) is a Sink inside that level, never a port. A level that does not use an input ends it in a Terminator, where it can be seen.
3. **A level may not change the causality of its ports.** Draw level boundaries where signals are causal by nature: commands, measurements, a voltage driving a load that is inside the subsystem. An ideal op-amp inside a feedback loop is an algebraic loop in a block diagram, so the subsystem with levels is the whole stage (op-amp, feedback and load), never the bare op-amp.
4. **One parameter set.** Physical parameters live on the subsystem (its mask), once. Every level reads the ones it needs through formulas. No physics number is typed twice: the motor's torque and back-EMF constants, equal in SI units, become one `K`.
5. **Each level is valid somewhere and says where.** A level carries a validity sentence and Valid range blocks: on a signal's value, on its rate, or on a parameter formula. The page reports when a run leaves them. What the checks cannot catch, the sentence says. Each level is held by tests to its own physics inside that validity (§9).
6. **Neutral values reproduce the level below.** With the added parameters at their neutral values (a limit at ±∞, a coefficient of 1, a time constant of 0), level k + 1 equals level k, bit for bit, where the neutral value can be represented. Where it cannot (a resistance going to 0), it approaches level k as the parameter goes to its floor, and a test bounds the gap by the physics.
7. **No black boxes.** Every level is an ordinary diagram of blocks that can be opened, its validity checks included. Nothing is compiled or hidden.
8. **Only the running level runs; every level is checked.** Normalisation checks all levels (ports, names, formulas). The compile builds only the running level, so unused levels cost nothing. Changing the global level or an override, or Clear, is a structural edit: the system compiles and runs again, and earlier runs stay, fading, as after any edit.
9. **A design sees what runs.** Designs, Auto-tune and Analysis use the running levels. To keep a design made on a simple level, copy it as numbers (Auto-tune's results already are numbers) before raising the detail. Pinning a design to less detail than runs waits for an example that needs it (§13).
10. **Controllers, Observers and live plants sit outside subsystems with levels.** Their variants, designs, tuning and probes are keyed by the block's path, which would be ambiguous across levels.
11. **Every model is built so a level can be added.** A new physics model is a subsystem whose ports are its terminals, with its parameters on its mask, and each effect a named block or group of blocks.

## 2. Data model

### 2.1 A subsystem with levels

```json
{ "id": "board", "type": "subsystem", "name": "Board", "x": 200, "y": 96,
  "mask": [ { "key": "GBW", "label": "Gain–bandwidth", "unit": "Hz", "min": 1 }, { "key": "AOL", "label": "Open-loop gain", "unit": "dB" },
            { "key": "Ro", "label": "Output resistance", "unit": "Ω", "min": 1 }, { "key": "CL", "label": "Cable C_L", "unit": "F", "min": 1e-12 }, … ],
  "params": { "GBW": 1e6, "AOL": 112, "Ro": 496, "CL": 1e-9, … },
  "levels": [
    { "name": "Ideal",
      "valid": "An ideal op-amp: signals much slower than {GBW:Hz} and inside the swing, a cable below {1/(20*pi*GBW*Ro):F}. Its checks catch every step; slower signals near the bandwidth are not caught.",
      "diagram": { "blocks": [ …,
        { "id": "cable", "type": "validRange", "name": "cable C_L",
          "params": { "value": "CL", "max": "1/(20*pi*GBW*Ro)", "says": "it assumes a cable below {1/(20*pi*GBW*Ro):F}, its pole a decade above the crossover (level 3 models the cable)" } } ],
        "wires": [ … ] } },
    { "name": "+ gain–bandwidth", "valid": "…", "diagram": { … } }
  ] }
```

With `"level": 3` beside `levels`, the Board would run level 3 whatever the global level. The example has no override.

- `mask` and `params` are the subsystem mask of [transparent-models.md](transparent-models.md) §1.4. Levels add optional `min` and `max` to a mask field, as block parameters have them (`num(…, { min })` in `diagram.js`). Loading refuses a value outside them with a sentence; the wheel and SI entry stop at them.
- `levels`: two or more `{ name, valid, diagram }`.
  - `name` is short (at most 32 characters), unique within the subsystem, and says what the level adds. The page uses it wherever it must say what a lower level leaves out.
  - `valid` is a sentence. `{formula:unit}` in it is evaluated over the mask and printed with an SI prefix (`{GBW:Hz}` reads "1 MHz"; `siUnit` from `ui/units.js`, which has no DOM, so the CLI uses it too; it gains the prefix `p`). Its numbers follow the parameters, and it needs no unit constants.
  - `diagram` is an ordinary diagram. Its Valid range blocks are the level's machine checks (§4).
- `level` (optional): the subsystem's **local override**, **1-based** (`L3` is `"level": 3`). Absent, the subsystem runs the global level. It is 1-based because the person reads levels as numbers ("Detail 2", `L2/4`). A Controller's `variant` is 0-based: that is a different thing.
- A subsystem without `levels` keeps its `diagram`, exactly as today: it is a one-level subsystem. A subsystem with both `diagram` and `levels` is refused with a sentence. Deleting levels down to one turns the subsystem back into a plain one with `diagram`, without `level`.
- In code, every read goes through `core/levels.js`, which imports only `formula.js`:
  - `subLevels(b)` returns `b.levels`, or `[{ name: '', diagram: b.diagram }]`;
  - `levelDiagram(b, k)`;
  - `runningLevel(b, global)`;
  - `applyDetail(diagram, global)`: a copy in which every subsystem with levels, at every depth, has `level` set to its running level;
  - `clearOverrides(diagram)`: a copy without `level` on any subsystem, at every depth, inside every level (also those that do not run);
  - `checkPorts(b, where)`;
  - `maskScope(b, outer)`;
  - `levelText(sentence, scope)`.

**Which level runs** ([input 13](../input/2026-10-25-13-detail-levels-answers.md)).
- `runningLevel = min(level ?? global, n)`, where `level` is the subsystem's override, `global` the project's global level `sim.detail` (default 1, §3.2) and `n` the number of levels the subsystem has.
  - Global 4 on a subsystem with 2 levels runs level 2: it is **clamped**. So is an override above `n`, which only a file written by hand or a deleted level can leave.
  - An override may be above or below the global level. Global 1 with the Board overridden to 3 runs the Board at 3 and every other subsystem at 1.
  - There is no separate "Highest": the global level at its largest number runs every subsystem without an override at its most detailed level.
- Nested subsystems with levels are resolved independently, at every depth: a nested subsystem follows the global level unless it has its own override; its parent's override does not pass down.
- **One place applies the detail.** `runDiagram(project)` in `project.js` returns `applyDetail(plantDiagram(project.system.plant), project.sim.detail)`: the diagram as it runs. Every compile site uses it instead of reading `system.plant.diagram`:
  - `simulateSystem` through `evaluateSystem`;
  - the Plant tab's check (`ui/plant.js`, the `compileDiagram` call near line 336; it forces the viewed level, §3.1);
  - Live (`live.js` `build`). Its `update()` compares the applied diagram, so changing the global level, an override or Clear during Live rebuilds;
  - the v1 loop path (`sim.js`, via `plantDiagram`);
  - the model compiles of the design layer (`project.js` and the closure in `compileDiagram`, on feat/designs);
  - `cli.mjs`.
  
  The editors (Plant tab, Controller tab) keep editing the stored diagram.
- `simOf(project)` gains `detail`, so the acquisition key (`acqKeyOf` in `app.js`, which hashes `simOf(p)`) changes with the global level and the screen runs again. Overrides sit in the plant, which the key already hashes (`p.system`).
- **Paths through levels.** A subsystem inside a level is addressed with the level in its path segment: `board@3/opamp`. The Plant tab's open path, `loopTuner.level()` and `el.levels` use these paths. Top-level subsystems are plain ids (`board`).
- The compile records `el.levels: [{ path, name, override, running, clamped, n, names, states, blocks, params, valid }]` for the UI, the CLI and agents. `override` is the subsystem's `level` or `null`; `clamped` is true when the override or the global level is above `n`. `states`, `blocks` and `params` are lists, one entry per level, counted from the diagrams without compiling them: an Integrator is 1 state, a transfer function its order; `params` counts the mask fields read by blocks (not by validity checks). The running level's step comes from the run (§5).

### 2.2 The port check

`normalizeDiagram` checks every level against level 1:
- the In ports and Out ports: the same set of port numbers, contiguous from 1;
- the same port names (the In or Out block's `name`; unnamed ports are `In k` and `Out k`).

In and Out carry no unit: nothing propagates units through wires, so a unit there would be an unchecked label.

**Refusals name the subsystem, the level and the port:**
- "Board: level 3 has In ports 1 and 2, level 1 has In port 1. Every level has the same ports: add or remove a port in all levels."
- "Board: Out 1 is 'v_out' in level 1 but 'vo' in level 2."

**Ports belong to the subsystem, as in PLECS.** In the Plant tab, adding, renaming or deleting an In or Out inside one level does the same in every level. A new Out in another level is left unconnected, and that level is marked as not compiling (§3.1). Deleting a port that has wires in other levels asks first. So the refusals above come only from files written by hand.

`blockPorts(subsystem)` reads level 1's ports, since all levels have the same.

**Sinks inside levels.**
- The same Sink name may appear in several levels of one subsystem, since only one of them runs. It must have the same unit in each.
- A name used in two different subsystems, or both inside and outside one, is refused, as today.
- `diagramNames` returns the union over all levels. Each name carries `from: { path, level }`, the lowest level that has it, so the scope can say "not modelled at level 1".

**Other blocks inside levels.**
- Sources may sit in levels. The Input tab lists every Source in any level.
- Controller, Observer and External plant blocks are refused anywhere inside a subsystem with levels, at any depth (Rule 10): "Board L3: a Controller cannot sit inside a subsystem with detail levels, since its variants, designs and tuning are found by its path. Put it outside the Board."

### 2.3 Parameters: the subsystem mask, shared by every level

The mask is [transparent-models.md](transparent-models.md) §1.4, built in that plan's step 2:
- `mask: [{ key, label, unit }]` and `params: { key: number | formula }` on a subsystem;
- number fields inside, at any depth, may be formulas in the mask names (innermost first), compiled by `core/formula.js` at compile time;
- Equations blocks read the names as constants;
- refusals name the unknown name and list what is there.

Levels add five things to it:
- **Every level reads the same mask.** The mask sits on the subsystem, beside `levels`, not inside a level. A level uses the subset it needs.
  - The Parameters panel shows, for each mask field, the lowest level whose blocks use it ("used from L3"). Validity checks do not count: level 1's cable check reads C_L, but level 1 does not model the cable.
  - It greys a field with "not used at L2" when the running level's blocks do not read it.
  - That greyed list is what the running level leaves out: the person's "more parameters".
  - A mask name that only some levels use is not an error.
  - A formula naming a key the mask does not have is refused, as in that plan.
- **`min` and `max` on a mask field** (§2.1).
- **`inf`.** `formula.js` gains the constant `inf`, so an effect can be switched off by its neutral value in a file: `"SR": "inf"`. A formula that comes out infinite is allowed only where the block allows it, and is refused elsewhere with a sentence ("Board L3/cable: K = 1/CL = inf; a gain must be finite"):
  - Saturation limits;
  - the Integrator's `min` and `max`, where ±inf means none;
  - Valid range limits.
- **Transfer-function coefficients** (`num`, `den`) may be formulas too, entry by entry: `"den": ["L", "R"]`. The motor's armature needs this.
- **Level-only constants, and the guard.** Structural constants a level needs (a sum's signs, an integrator's K of 1) are typed in place. Physics values are not. A guard test reads every block parameter inside the levels of a library system, numbers and the numeric literals in formula text, and allows only 0, ±1, 2, 10 and 20: decibels (`10^(AOL/20)`) and a decade (`1/(20*pi*GBW*Ro)` is 2π times ten) need the last two. Validity sentences are not read: they print with SI prefixes, so they need no unit constants.

Editing the mask's fields themselves (adding or renaming a parameter) is JSON only for now, as in that plan.

## 3. In the page

### 3.1 Per subsystem: the level chip, the panel, the level tabs

**On the canvas**, a subsystem with levels carries a level chip at its top right, in the chip style of the one design system. At a glance it says which level runs and why:
- `L2/4`, outlined: level 2 of 4 runs, from the global level.
- `L3/4`, filled: **overridden** on this block. Its tooltip reads "set on this block; global level 1".
- `L2/2 ↓`: **clamped**: the global level (or the override) is above the levels the block has. Its tooltip reads "global level 4; Board has 2 levels". An overridden block that is clamped is filled and carries the `↓`.
- The chip turns `--warn` with a `!` when the running level left its validity (§4), and `--bad` when the run needed more steps than the step cap allows (§5). The tooltip gives the sentence.

Filled against outlined is a difference of shape, not only of colour, so it reads in both themes and without colour vision.

**The block's formula line** shows the running level's name ("+ output resistance and cable").

**A click on the chip** opens a menu: **Global level (L1)** at the top, then the levels by name, with the running one marked. Choosing a level sets this block's override (`level`); choosing Global level removes it. Each is one undo step. This is the quick way to step through one block's levels. The menu stays inside the viewport, as every popover must ([input 12](../input/2026-10-25-12-popovers-cut-off.md)).

**The parameters panel** (subsystem selected) has three parts:
- **Parameters**: the mask's fields (§2.3), with SI prefixes and the wheel, as everywhere. Each is marked "used from L3", and greyed "not used at L2" when the running level's blocks do not read it.
- **Levels**: a list like the Controller tab's variants. Each row shows:
  - `L3 + output resistance and cable`;
  - `2 states · 14 blocks · 5 parameters`;
  - the validity sentence;
  - on the running level, the last run: "2000 steps of 10 ns; needs ≤ 140 ns".
  - A level that does not compile is marked with its first error. The levels are compiled when the panel is shown, not on every compile.
  - Opening a row that does not run shows its step on demand, from that level's Jacobian at rest (§5).

  A click on a row sets the override to that level, as the chip's menu does. **Duplicate as next level** inserts a copy after it, named "<name> (copy)", and sets the override to it, so the copy runs. **Rename**, **Delete** and **↑ ↓** reorder. Deleting down to one level makes the subsystem a plain one again.
  - A one-level subsystem shows only **Add a level**, which turns it into two levels with the same diagram.
  - Moving a level keeps an override on the same diagram. Deleting the overridden level removes the override: the subsystem follows the global level again.
- **Open**, as today.

**Opening.**
- Double-clicking the subsystem opens the running level. The breadcrumb reads "Plant › Board (L3 + output resistance and cable)".
- A row of level tabs sits above the canvas inside the subsystem: `L1 Ideal · L2 + gain–bandwidth · ● L3 + output resistance and cable · L4 + large signal`. The dot marks the level that runs. The tab being viewed uses `.tab.on`, the one "selected" style.
- Viewing a level does not change what runs. A level that does not run is fully editable, under a quiet line: "Level 4 does not run (Board runs level 3) · Run this level". Run this level sets the override.
- **The Plant tab's check compiles what is viewed.** Today it compiles the root diagram and outlines errors by matching node names (`ui/plant.js`, near line 340). With levels it compiles `applyDetail` with each subsystem on the open path forced to its viewed level, so an error outlines the block in the level on screen, never a same-named block in another level.
- Each level's diagram is laid out like any diagram, as the auto-layout plan decides ([input 11](../input/2026-10-25-11-diagram-auto-layout.md)).
- Esc and the breadcrumb go back up, as today.

### 3.2 Globally: the global level, in the Plant tab

The person: "I have a global level that sets everything that I didn't set by hand. Then I have a local override … And then I have a … clear button where I clear the local overrides and everything is put back onto the global level" ([input 13](../input/2026-10-25-13-detail-levels-answers.md)).

- **The Plant tab's panel, with nothing selected**, gains a **Detail** row:
  - a select of the global level, **1**, **2**, … up to the most levels any subsystem has; default 1;
  - beside it, **Clear**, with the number of overrides ("Clear 2 overrides"). Its tooltip lists them ("Board L3, Motor L1"). It is disabled when there is none.
  
  The row appears only when some subsystem has levels.
- Detail 1 is Amesim's "Premier submodel": every model at its simplest, except the blocks overridden by hand. The largest number puts every block without an override at its most detailed level.
- **Clear** removes every override, at every depth and inside every level (`clearOverrides`, §2.1), so every subsystem runs the global level again. It is one undo step; undo restores the overrides.
- **Only in the Plant tab** ("it belongs into the plant. It doesn't belong into the header"). The header and the display carry no Detail control and no Detail chip. The display's status line still shows the first validity report of the run, which names the subsystem and its level (§4). In Live mode the row's tooltip says it applies to the page's models, not the live plant.
- No table of subsystems: no example has two subsystems with levels, and each block's chip already says whether it is overridden or clamped.
- Saved as `sim.detail` (§10): absent (1) or an integer ≥ 1. A stored value above every subsystem's levels is kept and clamped per subsystem. Undo covers it.
- **The library.** Each System library entry carries the global level that runs its models as today, and no overrides (§7). Loading a whole system, or its plant alone, sets the global level from the entry, since it belongs to the plant; loading only its input leaves it.
- Agents:
  - `window.loopTuner.detail(k?)` sets or reads the global level (a number) and returns `{ detail, subsystems: el.levels }`.
  - `window.loopTuner.level(path, k?)` sets or reads one subsystem's override; `k = null` removes it. It returns that subsystem's entry of `el.levels`.
  - `window.loopTuner.clearOverrides()` does what Clear does and returns as `detail()`.
  - `window.loopTuner.info()` returns the last run's information: `{ validity, warnings, steps, h }` (§4).
  - The CLI takes, on `run`, `design` and `autotune`: `--detail <k>` (the global level), `--level <path>=<k>` (an override, repeatable) and `--clear-overrides` (applied before `--level`). It prints validity reports and warnings.

### 3.3 The scope and missing signals

- A scope channel whose source is a Sink that the running level does not have draws nothing. Its badge uses the existing `.badge.nosig` style and reads "i_out: not modelled at L1 (Board)". It never draws 0: zero would be a lie about the physics. Simulink and PLECS output zero for inactive outputs; Loop Tuner does not.
- Loading a project or a system keeps channel names that exist in any level (today, names that no longer exist are cleared).
- Saved traces and references are unchanged: they hold what ran.

### 3.4 Words and colours

- **Words.** "Level" already means three other things in the code: diagram nesting (`level()` in `diagram.js`, `level` and `levelOf` in `ui/plant.js`, `levelOf` in `ui/controller.js`, "a diagram level" in transparent-models.md §1.1), the spectrogram's colour levels (`normalizeLevels`, `withLevels`, `levelsOf` in `project.js`), and the scheduled PI's operating levels. So the nesting helpers are renamed (`flatten`, `openDiagram`), UI text says "detail level", and the block's marker is the "level chip" ("badge" already means a scope channel's badge in `display.js`).
- **Colours.** Main has `--bad` in both themes, and `--lit-amber`, a lit key's colour; feat/designs adds `--lcd-warn` for LCD readouts only. Levels add one named pair readable on panels, `--warn` beside `--bad`, defined for both themes. The chip's `!`, the amber validity line and the red step warning use it, and so do the Controller tab's glyphs.

## 4. Validity: each level says where it holds, and the run says when it leaves

**One mechanism, drawn on the canvas: the Valid range block**, new in the Signals group. It is the fourth way for a signal to end, beside Out, Sink and Terminator. It has three modes:
1. **Value** (default): one input; `min` and `max`. It reports the first record sample at or beyond a limit: a level is valid strictly inside its range.
2. **Rate** (`of: 'rate'`): one input; `min` and `max` bound |Δu|/Δt between record samples. It sees what the screen resolves. Level 1's check that v_in changes no faster than the slew rate catches every step on a 20 µs screen (80 mV in 10 ns is 8 V/µs), passes the 1 kHz test sine (3.1·10⁻³ V/µs), and does not fire at 1 ms/div, where a 5 µs record step hides the 0.35 µs edge that level 2 would add.
3. **Parameter** (`value`, a formula, and no input): a condition on the mask, evaluated at compile, so no run is needed.

Its fields:
- `min` and `max` are formulas; either may be absent (no limit); `±inf` is allowed.
- `says` is a sentence: what is beyond, and which level models it.
- Its `name` is a label for what it checks ("v+ − v−"). It is not a Sink name: it makes no probe and no scope channel.
- In model mode (designs) it is a Terminator.
- It may sit anywhere, not only in levels. A model can carry its validity even with one level.

**The reports.**
- At load or after an edit: "Board L1 is outside its validity: C_L 1 nF; it assumes a cable below 32.1 pF, its pole a decade above the crossover (level 3 models the cable)."
- In a run: "Board L3 left its validity at 10.0 µs: v+ − v− 0.42 V is beyond ±95.5 mV (the op-amp slews; level 4 models it)."
- Each check reports once per run, its first violation.

**Where the results go.** Today they would go nowhere: the page's acquisition keeps only `{ t, signals }` (`app.js`, after `evaluateSystem`), so even today's "stiff system" and "a signal diverged" warnings never reach the person, and `loopTuner.run()` returns nothing. So:
- `simulateSystem` returns `info: { validity, warnings, steps, h }`. `validity` is `[{ path, level, block, t, value, min, max, says }]`, the first violation per check, with `t: null` for parameter checks.
- The acquisition keeps `info`, in both of its branches (the system run and the v1 loop's candidate run).
- The display's status line shows the first validity report, or the first warning. The level chip turns `--warn`. The Plant tab's panel lists all of them.
- The CLI prints them. Agents read them with `window.loopTuner.info()`.

**What this promises.** Where a level's checks reach, it is never silently used outside its physics: the page says which effect is missing and which level has it. What the checks cannot reach, the level's sentence says (level 1: signals slower than the slew rate but near the bandwidth). Together with the tests (§9), this is how "the physics can never be wrong at every level" holds in use.

What validity is not: it does not choose the level for the person. SPICE's model binning picks parameter sets by range automatically. Here the person chooses, and the page says when the choice does not fit.

## 5. Simulation: stiffness, step size, cost

**Levels make models stiffer.**
- The op-amp's level 2 adds a loop at 2π·GBW·(1 + 1/A0) = 6.28·10⁶ 1/s; level 3 a complex pair of magnitude 3.56·10⁶ 1/s.
- The motor's level 2 adds the armature's R/L = 100 1/s.

**The step bound must see loops through integrators (prerequisite).**
- Today `hmax = 0.5/bound` uses each block's own poles (`rootBound` per transfer function, `ode.bound` per physics block). An integrator's bound is 0, so a fast loop built from Integrator and Gain blocks (the op-amp model, the sliding-mode research's motor in integrator form) is invisible to it.
- On the op-amp example's 20 µs screen this happens not to matter: without a Controller, the record step is the window / 2000 = 10 ns, finer than the loop needs.
- Set the timebase to 1 ms/div and the record step is 5 µs. Then RK4 runs level 2 at λh = 31 (stable only below 2.8), and levels 2 and 3 diverge within two record steps of the first edge.

**The fix: the largest eigenvalue of the Jacobian.**
- `compileDiagram` computes a finite-difference Jacobian of the rates at the start state X0 and t = 0: n + 1 evaluations of `eval`, step 1e-6·max(1, |x|). Sampled blocks hold their outputs. Quantizers count as identity and Noise as 0, as model mode does, so a perturbation that crosses a quantizer step does not inflate the bound.
- Its largest eigenvalue magnitude (`eig`, already in `linalg.js`, bundled before `diagram.js`) joins the block bounds by max, **in `el.bound` at compile**. So every place that takes a step from `el.bound` gets it: `simulateSystem`, Live (`live.js`, its substeps), the v1 loop path (`sim.js`), and the design layer's `Model.bound` (the planner, `alongPlan`, `verifyLoop`).
- `simulateSystem` alone checks the bound again at the final state. If it is larger, it runs once more with it, with the note "stiffer later in the run". Live cannot run again, so it keeps the start bound.
- This is the sliding-mode research's Recommendation 9, needed here first.

**Why not a norm.** The ∞-norm of J bounds every eigenvalue but depends on how the states are scaled, and transfer functions are realised in companion form. Measured on main, at each library system's start state:

| System | Today's bound | ∞-norm | Largest eigenvalue magnitude |
|---|---|---|---|
| Encoder errors | 1000 | 1.99·10⁵ (a 2.5 µs step, 200× finer) | 1000 |
| Triple pendulum | 50.2 | 363 (2 substeps per record instead of 1) | 17 |
| Motor | 100 | 125 | 84 |
| Tank | 282 | 13.3 | 13.3 |

With the norm, the encoder example would hit the step cap and the triple's run would change (breaking transparent-models' "triple within 10⁻⁶" migration test). With the eigenvalue, no library system's step changes. [transparent-models.md](transparent-models.md) §10 leaves a computed bound out because it would not restore the open tank's old step; that still holds, and this bound changes nothing there. Levels need it for another reason: stiff linear loops built from Integrators.

**The op-amp's steps.** Level 2 needs steps ≤ 80 ns, levels 3 and 4 ≤ 140 ns. On the 20 µs screen every level takes the record's 2000 steps of 10 ns. At 1 ms/div, level 2 takes 63 substeps per 5 µs record (126 k steps) and level 3 takes 36 (72 k).

**Too many steps.**
- A detailed level on a long screen can need more steps than the step cap (400 000). At 10 ms/div the op-amp needs 1.26 M steps at level 2 and 712 k at level 3.
- The run is still drawn, as today, but the warning becomes specific and reaches the page (§4). It names the fastest state's subsystem and level: "Board L3 needs steps of 140 ns; this 100 ms screen would take 712 k steps; it ran 400 k: inaccurate. Shorten the screen or lower the level."
- The level chip turns `--bad`.
- An implicit or multirate solver is not built (§13).

**Floors.** The neutral values that cannot be represented are also the stiff ones, so the mask stops short of them:
- C_L ≥ 1 pF: level 3 then needs 0.24 ns steps (86 k on the 20 µs screen);
- R_o ≥ 1 Ω: 0.50 ns steps (40 k). At 0.1 Ω it would need exactly the 400 k step cap.

Each floor alone fits a screen. Both at once (|λ| ≈ 1/(R_o·C_L) = 10¹² 1/s) do not, and the warning says so.

**Cost: "more calculations".** For each level the panel shows:
- states, blocks and mask parameters read by blocks: counted for every level, without compiling;
- on the running level, the step it needs and the last run's steps and time (`info.h`, `info.steps`, `info.ms`);
- on another level, its step on demand, when its row is opened: that level compiled alone, its In ports at 0, its Jacobian at rest. For a nonlinear level this is a linear estimate, and the row says "at rest".

The header's Speed readout shows the same cost live. At ∞ it runs at the simulation's own speed ([instrument.md](instrument.md#speed)): the page's limit for this level on this screen.

**Example costs.** Op-amp board, levels 1 to 4: 0, 1, 2, 2 states; about 2, 7, 14, 15 blocks, not counting validity checks; 0, 2, 5, 8 parameters. The higher levels cost more per step, not more steps, on the example's screen.

## 6. The design layer, Auto-tune and Analysis on levels

All three use the running levels, through `runDiagram` (§2.1). Nothing in them chooses a level.

**The design layer** (merged from feat/designs):
- **Model compiles** take the applied diagram, so the plant a block sees ([designs-in-the-page.md](designs-in-the-page.md) §4) is the running levels.
- **`plantKey`** replaces each subsystem with levels by its running level's diagram with formulas resolved to numbers, and leaves out Valid range blocks and the level fields (`name`, `valid`), as it leaves out Sink names today. Consequences:
  - editing a level that does not run, or a mask value that only other levels or validity checks read (C_L while level 1 runs), never re-designs;
  - editing the running level or a value it reads does, and so does changing which level runs, by an override, the global level or Clear.
  
  This refines transparent-models.md §1.4's "plantKey includes the mask values": a mask value counts when a running block reads it.
- **Refusals gain a hint about detail.** LQR on the motor at level 2 sees the armature current, which no input measures: "LQR needs every state measured. This block sees angle and speed but not Motor/armature (Motor L2): set Detail to 1 or the Motor to L1, wire the current to an input, or add a Kalman Observer."
- **Copy as numbers** ([designs-in-the-page.md](designs-in-the-page.md)) names what the design saw when the plant has levels: "LQR (numbers, Motor L1)".
- A Kalman Observer and the Controller it serves see the same levels, since both see what runs.
- **Plans** (`trajectory`) are keyed by the plant they see, so they follow the same rules.

**Auto-tune** tunes by simulating what runs. Its result variant holds numbers, as today. When the plant has levels, the result row names the levels it ran ("tuned on Motor L1").

**Analysis** linearises the loop as it runs. When the plant has levels, its header names them. Snapshot operating points (`{ t }`) belong to the running levels. An analog loop with no Controller block, such as the op-amp follower, has nothing for Analysis to cut. Analysis at a wire (a loop probe, as SPICE's Middlebrook or Tian probes) is not built (§13); the example's margins are checked by tests.

**Identify** (designed, not built) experiments on the plant as it runs.

**The person's experiment, with a Controller:**
1. Set Detail to 1 in the Plant tab (Clear first if a block is overridden), and press Single.
2. Design (then Copy as numbers), or run Auto-tune, or tune by hand.
3. Set Detail back up (2 for the motor examples) and press Single. The numbers run on the detailed levels; the earlier run stays on screen, faded, beside the new one.

To change one model only, override its block instead (its chip) and Clear afterwards. A designed variant left live would re-design on the detailed plant at step 3 and hide the degradation. That is why step 2 keeps numbers.

## 7. Every model gets levels

What "everything we model should support this detail level separation" means here:
- the mechanism is generic: any subsystem;
- every shipped model is built as a subsystem that can take levels (Rule 11);
- each model gets the levels that are physically meaningful, valid and cheap to test.

The level each System library entry runs today is kept: each entry carries the global level that runs it (`sim.detail` 2 for the motor examples and the carts, 1 for the tank and the op-amp board) and no overrides. So no example changes when its model gains levels, and the person's experiment (§6) needs no Clear first. A test checks this bit for bit.

| Model (systems that use it) | Levels (today's model in bold) | Validity of the lowest level | When |
|---|---|---|---|
| **DC motor**: the Motor subsystem (DC motor position control, Following a sine, Encoder errors, Sliding mode) | L1 rigid, no inductance: i = (V − K·ω)/R, 1 state, 4 parameters · L2 **+ armature inductance** (today: L·di/dt = V − R·i − K·ω), 2 states, 5 parameters · L3 + compliant coupling (rotor and load as two inertias on a shaft of stiffness k and damping c; ports unchanged, speed is the load's), later, when an example needs it | Voltages that change slowly compared with L/R = {L/R:s} (10 ms): no relay, no chopping | Step 8. The mask is R, L, K, J, b: one K for torque and back-EMF, which today are two Gains of 0.5 that must stay equal. The armature is already a transfer function on main (num [1], den [L, R]), so **L2 with L = 0 is L1 bit for bit** (`polyTrim` makes den [0, R] a gain 1/R) |
| **Cart–pole** (Pendulum swing-up) | L1 ideal: frictionless cart and hinge, point mass · L2 **+ friction** (today's cart friction b; hinge damping c, 0 by default so today's run is unchanged) · L3 + drive: the commanded force F goes through a belt-driven motor with a current loop (a lag τ_i, a current limit I_max, the bus voltage limiting the force at speed, R·i + K·v/r ≤ V_bus), and the rotor's inertia J_m/r² joins the cart. Ports unchanged: F is now the command | Small friction. At L2: a drive much faster than the pendulum, with force to spare at every speed | After [transparent-models.md](transparent-models.md) step 7 (the carts open). In its parts: L1 is the open cart with the Rail's b and the Hinge's c set to 0; L2 reads them from the mask; L3 adds an Equations block, a limited Integrator for the current and a second Mass (J_m/r²) at the cart's frame. Wrapping today's black-box block first would mean building it twice. L3 is where a swing-up planned on L2 may fail: the plan asks for force at speeds the drive cannot deliver. A candidate later example |
| **Pendulum chain on cart** (Triple pendulum) | As the cart–pole: L1 ideal · L2 **+ friction** (today) · L3 + drive. Later: + rod mass (a uniform Rod part, `at: uniform`, beside each bob) | As the cart–pole | As the cart–pole |
| **Conical tank** (Conical tank, gain scheduling) | L1 **Torricelli**: an ideal orifice and pump (today) · L2 + real outlet and pump: a discharge coefficient Cd in the outlet's equation (`qout = Cd*a*sqrt(2*g*h)`; about 0.61 for a sharp-edged orifice, neutral 1) and the pump's spin-up lag τ_p (a Transfer function before the pump, den [τ_p, 1], neutral 0) | An outlet without contraction losses, a pump that follows its command at once | After transparent-models.md step 4 (the tank opens). With the neutral values L2 is L1 exactly |
| **Oven** | One level. Heater, chamber, dead time and thermocouple already are its detail; a lumped level (one lag with τ = the sum, and the dead time) only if an example needs it | – | – |
| **Mass–spring–damper** | One level (primitives, not a subsystem) | – | – |
| **HIL: an external plant** | None: its physics is outside the page (a black box), and a live plant may not sit in a level | – | – |
| **Op-amp board** (new example) | Four levels (§8) | – | Step 7 |

Each level of each model has more states or more mask parameters read by blocks than the one below: the person's "more calculations and more parameters". The motor goes from 4 to 5 parameters, the carts gain b and c, the op-amp reads 0, 2, 5 and 8.

**With the openable-physics plan.** [transparent-models.md](transparent-models.md) rebuilds the cart–pole, the chain and the tank from physical parts (World, Rail, Hinge, Mass, Rod) and primitives (Equations, the limited Integrator).
- Each gains its levels on top of that rebuild, as whole subsystems. That plan keeps frame ports off subsystem boundaries (its §10), so a level is the whole mechanism, never one part inside it. That is all levels need, as its §10 also says.
- The two plans share the mask and formula parameters, the limited Integrator and the Equations block, built there.
- This plan adds the eigenvalue step bound (§5). Whichever plan reaches a shared piece first builds it.

The PUMA 560 robot is built the same way: rigid bodies are L1; joint friction, motors with gears and flexible joints are later levels.

## 8. The example: "Op-amp follower and a cable"

**One thing, with a second on request:** the effect the simpler levels did not model makes a loop that looked perfect ring. Then large signals change it again.

**The misbehaviour every electrical engineer knows.** The person asked for one ("I guess it should ring", [input 13](../input/2026-10-25-13-detail-levels-answers.md)). An op-amp follower driving a cable rings, and rings more, longer and slower as the cable's capacitance grows: the op-amp's output resistance and the cable add a pole inside the loop. That is level 3 here.

**The board.**
- An op-amp of the MCP6001 class (1 MHz CMOS, rail-to-rail; numbers from datasheet DS20001733L, typical at 25 °C) on ±2.5 V, so signals are ground-referenced and everything starts at rest at 0.
- Wired as a voltage follower.
- It drives 1 nF of cable (about 10 m of coax) into a 10 kΩ input.
- **What the datasheet states, and under which conditions.** The 10 kΩ is the load of its AC table, which is specified at 60 pF. Its 45° phase margin at 500 pF is a typical value on the front page, with no load stated; R_o is fitted to it assuming the same 10 kΩ (without a load resistor the same fit gives 450 Ω). The short-circuit current (23 mA) and the swing (25 mV from the rails, with 0.5 V of input overdrive) are stated at 5.5 V; this board runs on 5 V.

**Diagram.** Source `v_in` (V) → **Board** In `v_in`; Board Out `v_out` → Sink `v_out` (V). Inside levels 3 and 4: Sink `i_out` (A).

**Input `v_in`**, period 20 µs:
- a step to 80 mV at 1 µs: a small signal, at 84 % of the 95.5 mV at which this model starts to slew;
- then to 0.5 V at 10 µs: a large one.

Both read on one scale. A 50 mV step and a 1.45 V step, as first researched, cannot share 8 divisions: the small step's ringing would be a tenth of a division.

**Screen and opening.**
- 2 µs/div, position 0.
- Channels: 1 v_in and 2 v_out at 0.1 V/div, offset −0.4 V (0 to 0.8 V, so the 10 nF experiment's first peak, 0.79 V at level 3, stays on screen); 3 i_out at 0.5 mA/div (at 10 nF it leaves the screen, 3.9 mA at level 3; Auto brings it back); 4 off.
- Opens running in the Plant tab on the diagram (no view), at global level 1 (`sim.detail: 1`) with no override, so the Board's level chip is what the person sees.
- **Comparing levels: with Single runs, nothing new.** The person: "if I want to compare levels, … I would run a number of single runs and compare the traces. So we don't need to change anything" ([input 13](../input/2026-10-25-13-detail-levels-answers.md)). Running, the 20 µs screen sweeps many times a second, so an earlier level's run fades at once. After Single, earlier runs stay on screen and fade over five runs, as today ([instrument.md](instrument.md)). The notes say to step through the levels with Single. The display, its fading and the speed do not change for levels, and the entry carries no speed.
- Tags: No controller, Nonlinear (some level is), **Detail levels** (a new feature tag: `systemTags` gives it to any system with a subsystem that has levels).

**Mask** (8 parameters):

| Key | Parameter | Value | Read by blocks of | Read by checks of |
|---|---|---|---|---|
| GBW | Gain–bandwidth | 1 MHz | L2 | L1 |
| AOL | Open-loop gain | 112 dB (A0 = 3.98·10⁵, so the dominant pole is GBW/A0 = 2.5 Hz) | L2 | – |
| Ro | Output resistance | 496 Ω, at least 1 Ω: with the 10 kΩ load it reproduces the datasheet's 45° phase margin at 500 pF (44.997°) | L3 | L1, L2, L4 |
| CL | Cable C_L | 1 nF, at least 1 pF | L3 | L1, L2, L4 |
| RL | Load R_L | 10 kΩ | L3 | – |
| SR | Slew rate | 0.6 V/µs | L4 | L1, L2, L3 |
| Vs | Supply ± | 2.5 V | L4 | L1, L2, L3 |
| Vsw | Swing from the rails | 25 mV | L4 | L1, L2, L3 |

R_o is a physics input, as a motor's R and L are; the test names its source and its assumption. The test recomputes the 45° from it (§9), so the calibration is checked, not trusted.

**Levels**, each built from primitives:

| Level | Blocks (inside) | Validity checks (Valid range) | Validity sentence |
|---|---|---|---|
| **L1 Ideal**: a virtual short, v_out = v_in | In → Out | parameter: C_L ≤ 1/(20π·GBW·R_o) (32.1 pF); rate: v_in within ±SR; value: v_in within ±(Vs − Vsw), "beyond the output swing (level 4)" | An ideal op-amp: signals much slower than 1 MHz, inside the swing, a cable below 32.1 pF. Its checks catch every step and a cable too large; slower signals near the bandwidth are not caught |
| **L2 + gain–bandwidth**: the open-loop gain and its dominant pole, one state | e = v_in − v_op (Sum +−) → input stage `2*pi*GBW` (Gain: gm/Cc) → Sum +− → Integrator **v_op** → Out; leak `2*pi*GBW/10^(AOL/20)` (Gain, flipped) from v_op back to the second Sum; v_op back to e | parameter: as L1; value: e within ±SR/(2π·GBW) (95.5 mV), "the op-amp slews (level 4)"; value: v_op within ±(Vs − Vsw) | Small signals (v+ − v− well inside ±95.5 mV), inside the swing, a cable below 32.1 pF. One pole: no second pole, offset or noise |
| **L3 + output resistance and cable**: R_o between the op-amp and its pin, the cable C_L and the load R_L; one more state, the cable voltage v_out. The output current (v_op − v_out)/R_o is algebraic and goes to a Sink | L2's op-amp, then v_op − v_out (Sum) → `1/Ro` (Gain) → **i** (Sink i_out) → i − v_out/R_L (Sum) → `1/CL` (Gain) → Integrator **v_out** → Out; `1/RL` (Gain, flipped) from v_out; the follower's feedback now from v_out (the pin) | value: e and v_op, as L2 | Small signals, inside the swing. R_o is the small-signal output resistance near the crossover. It gives the datasheet's 45° at 500 pF ∥ 10 kΩ, but 80.5° at its 60 pF test load where the datasheet says 90° typical: a CMOS output's impedance changes with frequency |
| **L4 + large signal**: slewing and the output swing | L3 plus one Saturation ±SR after the input stage (a hard limit on the current into the compensation capacitor, as LTspice's level 2 sets its output current to slew·Cout); v_op's Integrator held within ±(Vs − Vsw) without windup | parameter: C_L·SR·R_o ≤ Vs − Vsw (C_L up to 8.3 nF), "slewing this cable takes C_L·SR through R_o; a constant R_o cannot pass it inside the swing, while the real output can (23 mA into a short)"; value: v_op within ±(Vs − Vsw), "the pin falls (Vs − Vsw)·R_o/(R_o + R_L) = 0.12 V short of the swing: the real output's resistance is lower near the rails" | Signals inside the supply, a cable up to 8.3 nF. The slew limit is hard: a real input pair (Boyle's macromodel) compresses gradually before 95.5 mV. Not modelled: offset (±4.5 mV max), noise, input capacitance, CMRR, PSRR, temperature, a second pole; the output current limit (23 mA at 5.5 V): a constant R_o passes at most (Vs − Vsw)/R_o = 5.0 mA into a short, and 9.7 mA in this circuit (with R_L, v_out cannot go below −2.358 V), so the limit could never act here. That is a flaw of the constant R_o, not a property of the part; the cable check stops the level before it matters |

- **States**: 0, 1, 2, 2. **Parameters read** by blocks: 0, 2, 5, 8. The validity checks read others.
- **Why L4's current check is on the cable, not on i_out.** A constant R_o starves a large cable: at 10 nF the model's i_out peaks at 2.42 mA while slewing that cable at SR needs 6 mA. A check on i_out at a fixed few mA would sit on a knife-edge (10 nF against 2.5 mA). The parameter check fires at 10 nF (2.98 V against 2.475 V) and passes 2.2 nF (0.65 V).
- **Neutral values**: L4 with SR = inf and Vs = inf is L3 bit for bit (checked). L3 approaches L2 as R_o goes to its floor: on the first step, the gap is at most ωT·R_o·C_L·ΔV, the delay R_o·C_L of an edge rising at ωT·ΔV. With the load resistor in the loop, C_L → 0 alone does not reach L2: at 1 pF they are 26 mV apart on a 1.45 V step, from the R_L divider.

**Notes** (shipped, so no quotes, names or dates):

> A circuit board: an op-amp (a 1 MHz CMOS part on ±2.5 V) wired as a voltage follower drives 1 nF of cable into a 10 kΩ input. The input steps to 80 mV at 1 µs (a small signal), then to 0.5 V at 10 µs (a large one). The Board has four levels of detail with the same ports, and opens at level 1, an ideal op-amp: v_out is exactly v_in. Press Single (S), then raise the level one at a time (click L1/4 on the Board, or Detail with nothing selected) and press Single after each: the earlier levels stay on screen, fading. Level 2 adds the gain–bandwidth: the edges take 0.35 µs, a perfect follower. Level 3 adds the op-amp's output resistance driving the cable, a pole inside the loop: both steps now overshoot 38 % and ring at 540 kHz for 4 µs. That is the ringing of an op-amp driving a cable, which the simpler levels left out (they say so: they assume a cable below 32 pF). At 10 µs level 3 also says it has left its validity: a step that large makes the op-amp slew. Level 4 adds slewing and the output swing: the small step rings exactly as at level 3, the large one rises more slowly (0.8 µs) and overshoots 19 %. Turn the cable C_L on the Board at level 3: the more cable, the more it rings, and the longer and slower (500 pF: 23 % at 730 kHz; 10 nF: 74 % at 180 kHz, still ringing at the end of the screen).

**Expected numbers.** RK4 at the record step of 10 ns, the same to the digits shown at 1 ns. Steps are measured 10–90 %. "Within x %" is the time after the step when the output stays within x % of the step. L3's small step is quoted at 1 % and L4's large step at 2 %, because those are the bands that do not sit on a knife-edge (research, Reviewer's corrections 1).

| Level | 80 mV step at 1 µs | step to 0.5 V at 10 µs | i_out peak | Validity reported |
|---|---|---|---|---|
| L1 | exact copy | exact copy | not modelled | at load: "C_L 1 nF; it assumes a cable below 32.1 pF"; at 1.00 µs: v_in changes at 8 V/µs, beyond the 0.6 V/µs slew rate |
| L2 | no overshoot (< 0.001 %), 350 ns, within 2 % after 0.62 µs; phase margin 90° | the same shape | not modelled | at load: as L1; at 10.00 µs: v+ − v− 0.42 V beyond ±95.5 mV (slewing) |
| L3 | **37.6 %** (peak 110 mV, 0.92 µs after the step), 370 ns, **rings at 541 kHz** (1.85 µs period), within 1 % after 4.0 µs; **phase margin 33.0° at 519 kHz** | 37.6 % (peak 0.658 V) | 1.04 mA | at 10.00 µs: slewing |
| L4 | identical to L3, bit for bit, until 10 µs | 0.80 µs, peak 0.579 V (**18.7 %**), within 2 % after 3.6 µs | 0.54 mA | none (v_op peaks at 0.73 V; C_L·SR·R_o = 0.30 V) |

**Turning the knob C_L at level 3** (follower phase margin; small-step overshoot, ringing frequency and settling). The more cable, the more it rings, the longer, and the slower. The ringing frequency is the damped frequency of the closed-loop poles; the RK4 run measures it within 0.3 % from the crossings of the final value. All of this table was recomputed for this revision (research, Sources: the ringing check).

| C_L | Phase margin | Overshoot | Ringing | Within 1 % after | L4's cable check |
|---|---|---|---|---|---|
| 60 pF | 80.5° | none | none (damping ratio 1.21) | 0.64 µs | passes |
| 500 pF | 45.0° | 23.3 % | 727 kHz | 2.2 µs | passes |
| 1 nF | 33.0° | 37.6 % | 541 kHz | 4.0 µs | passes |
| 2.2 nF | 22.6° | 52.6 % | 374 kHz | 8.5 µs | passes |
| 10 nF | 10.7° | 74.3 % | 178 kHz | not before the next step; still ringing at 20 µs | fails: above 8.3 nF |

**This op-amp rings; it never oscillates.** A one-pole op-amp plus the R_o·C_L pole is a two-pole loop, so its phase margin approaches 0° as C_L grows but never crosses it, and the limiters' gain cannot add phase. An op-amp with a second pole below its gain–bandwidth could oscillate outright with enough cable; that is not built (§13; research, "The capacitive-load trap"). Ringing is what the person asked for, and it keeps the example to one thing.

**The fix the notes do not take:** an isolation resistor (datasheet §4.3). It is a later "try" if the person wants a second experiment.

## 9. Tests

New `test/levels.test.mjs` and `test/opamp.test.mjs`; edits to `physics.test.mjs`, `core.test.mjs` and `design.test.mjs`. Step inputs need care: the Step signal is `t >= time`, and the last RK4 stage before an edge already sees the new value (99e-8 + 1e-8 is exactly 1e-6), so a simulated response starts about h/6 early. Comparisons with exact responses therefore start from the simulated state one record step after each edge, and the sample on an edge is bounded separately by ωT·h/6 of the step.

1. **Each level against its own physics** (the board, with the level forced):
   - L2:
     - the 10–90 % rise is ln 9/(2π·GBW·(1 + 1/A0)) = 349.7 ns ± 10 ns;
     - the DC gain is A0/(1 + A0);
     - from one record step after each edge, the simulation equals the exact response of the linearised level from the simulated state (matrix exponential) to 10⁻⁶ of the step (measured 4.7·10⁻⁸); the sample on an edge is within ωT·h/6 of the step (1.05·10⁻² at 10 ns).
   - L3:
     - the phase margin from the linearised level (closed loop T, open loop L = T/(1 − T)) equals 180° − atan(ωc/ωd) − atan(ωc·Rp·C_L), Rp = R_o ∥ R_L, to 0.1°;
     - it is 45.0° ± 0.5° at 500 pF ∥ 10 kΩ: the calibration, under the stated assumption that the datasheet's 45° is at its AC table's 10 kΩ;
     - the exact-response comparison as L2 (measured 1.7·10⁻⁸);
     - **energy balance**, independent of how the blocks are wired: ∫v_op·i dt = ∫i²·R_o dt + ∫v_out²/R_L dt + ½·C_L·v_out², Simpson's rule over the records, to 10⁻⁵ of the energy delivered (measured 3.5·10⁻⁶);
     - **Kirchhoff's current law at the pin**, as a charge balance: C_L·v_out(t) = ∫(i_out − v_out/R_L) dt, trapezoidal over the records, to 2·10⁻⁴ of C_L·0.5 V (measured 8.9·10⁻⁵).
   - L4:
     - while slewing (|e| beyond SR/ωT at both ends of a record step), a test Sink on v_op reads a slope of SR − (2π·GBW/A0)·v_op to 10⁻⁶ of SR. The leak term is 2.3·10⁻⁶ to 6.5·10⁻⁵ of SR, so comparing with SR alone would fail;
     - v_out's slope never exceeds SR;
     - v_op never leaves ±(Vs − Vsw). For a 2.4 V step, where L3 peaks at 3.30 V, L4 holds v_op at 2.475 V, the pin reaches 2.358 V, and the v_op check reports;
     - energy and charge balance as L3 (measured 1.1·10⁻⁶ and 2.0·10⁻⁵).
   - Motor:
     - L1 and L2 settle to the same speed K·V/(R·b + K²) (1.43 rad/s per V);
     - L2's current rises with L/R.
2. **Neutral values give the level below, bit for bit:**
   - board L4 with SR, Vs = inf equals L3 on the example's input;
   - motor L2 with L = 0 equals L1;
   - tank L2 with Cd = 1 and τ_p = 0 equals L1 (once built).

   **Limits:**
   - board L3 → L2 as R_o falls to its floor: on a 2 µs screen (the example's first step), |L3 − L2| ≤ ωT·R_o·C_L·ΔV at R_o = 4, 2 and 1 Ω (measured 0.87, 0.92 and 0.95 of it; 2000 to 4000 steps);
   - L2 → L1 as GBW and AOL grow: on the 1 kHz sine of test 3, the gap falls tenfold from GBW 1 MHz, AOL 112 dB to 10 MHz, 132 dB (0.500 mV to 0.050 mV). On steps it cannot: the edge sample differs by the whole step at any GBW.
3. **Agreement where they must agree** (inside the lower level's validity):
   - 1 kHz, 0.5 V sine on a 1 ms screen:
     - |L1 − L2| ≤ 1.05·A·f/GBW (0.525 mV; measured 0.500), from the start;
     - |L2 − L3| ≤ 1.2·(R_o/R_L)·A·f/GBW (0.030 mV; measured 0.0248) after the first 10 µs. Before, the sine's slope jump at t = 0 gives 0.53 mV. The cause is the R_o/R_L divider: the op-amp must drive v_op = (1 + R_o/R_L)·v_out, so its error grows by that factor. The output pole adds about 1.5 µV.
   - Steps below SR/(2π·GBW): L3 and L4 identical bit for bit (90 mV). Above, they differ (100 mV: 0.635 mV).
   - Motor: L1 and L2 within 1 % for a 0.2 Hz voltage sine (0.4 % by the transfer functions), and more than a factor 2 apart at 50 Hz, so the level adds something.
4. **The example's degradation** (the library entry as loaded, each level run in turn by the global level): the table of §8 within the stated digits (overshoot ± 0.3 %; rise and peak times ± 1 record step; settling times ± 0.05 µs; the 18.7 % and 0.579 V ± 0.5 %), the validity reports of §8's last column, and L4 reporting none. **The ringing grows with the cable**: at level 3, over the C_L table of §8, the overshoot rises (none, 23.3, 37.6, 52.6, 74.3 %, ± 0.3 %), and the ringing frequency, measured from the crossings of the final value, is within 1 % of the closed-loop poles' damped frequency (727, 541, 374, 178 kHz).
5. **Guards over every library system with levels:**
   - every level has a name and a validity sentence;
   - identical ports (port check);
   - every level compiles alone;
   - each level has more states or more mask parameters read by blocks than the one below;
   - no physics literal inside levels (§2.3's guard);
   - no Controller, Observer or External plant inside a subsystem with levels;
   - the running levels of every system are unchanged by this work: the motor examples' runs are bit for bit the same as before;
   - `systemTags` gives "Detail levels".
6. **Data:**
   - round-trip of `levels`, `level` (present and absent), `inf`, mask `min` and `max`, the three kinds of Valid range, and `sim.detail` (present and absent), inside a masked subsystem with formulas (the mask's own tests are transparent-models.md §8.5);
   - every refusal sentence of §2;
   - old files load unchanged;
   - a file with both `diagram` and `levels` is refused;
   - a mask value outside its `min` or `max` is refused;
   - deleting down to one level gives a plain subsystem with `diagram`.
7. **Step bound:**
   - board L2 at 1 ms/div (record 5 µs, 63 substeps of 79.4 ns) does not diverge; from one record step after each edge it equals the exact response to 10⁻⁶; the sample on an edge is within ωT·h/6 of the step (8 % at this step);
   - board L3 at 10 ms/div warns with the level and the step it needs (140 ns; 712 k steps);
   - no library system's step changes, including after the end-of-run check (the eigenvalue is at or below each one's block bound: encoder 1000 against 1000, triple 17 against 50.2, motor 84 against 100, tank 13.3 against 282);
   - a Quantizer crossed by the perturbation does not change the bound;
   - Live, the v1 loop path and `Model.bound` get the bound through `el.bound`.
8. **Design layer** (a test project: the motor's angle loop, measurements angle and speed, an `lqr` variant):
   - with the motor at L2: `states-not-measured` with the detail hint;
   - at Detail 1: status ok;
   - cache, at Detail 1: a hit after editing L2's diagram, after editing a Valid range, after moving a block, and after overriding the Motor to L1 (L1 runs either way); a re-design after editing L1, after editing R, after setting Detail to 2, and after overriding the Motor to L2 at Detail 1;
   - Copy as numbers at Detail 1 names "Motor L1", and its numbers run unchanged at Detail 2.
9. **Validity:**
   - a value check reports the first sample at or beyond its range, with t and value, once;
   - a rate check reports a step on a 20 µs screen and not the 1 kHz sine, nor the step at 1 ms/div;
   - a parameter check is evaluated at compile, with `t: null`;
   - none changes a run; in model mode a Valid range is a Terminator (no probe, no channel);
   - `info` reaches the page: after a run, `loopTuner.info()` returns the validity reports and warnings, and the status line shows the first.
10. **Readers of a subsystem's diagram:** a project whose subsystem has levels goes through each reader listed in §11 (copy for Live, the HIL finder, Auto-tune's walks, the Controller, Analysis and Auto-tune tabs, the Plant tab's navigation and summary, `systemTags`) without error, and each reads the running level. This replaces a grep for `.diagram`, which would also hit the legitimate `plant.diagram`, `ctx.diagram` and `e.diagram`.
11. **Bundle:** `bundleScript()` parses with `core/levels.js` in MODULES before `diagram`.
12. **Which level runs** (`test/levels.test.mjs`; a project with subsystems of 2 and 4 levels, one nested inside a level of the other):
    - at global levels 1, 2 and 4, with no override, an override below and one above the global level, the running level of each is min(override, else global, n): global 4 runs the 2-level subsystem at 2, marked `clamped`;
    - a parent's override does not pass to a nested subsystem;
    - an override above `n` in a file is clamped and marked;
    - Clear (`clearOverrides`) removes every override, at every depth and inside levels that do not run, in one undo step; undo restores them all;
    - `el.levels` reports `override`, `running` and `clamped` for each; `loopTuner.detail`, `level` and `clearOverrides` and the CLI's `--detail`, `--level` and `--clear-overrides` give the same running levels.

## 10. Project format (additions; still `loop-tuner/2`)

- **Subsystem:**
  - `mask` and `params`, and formula strings in number fields: as [transparent-models.md](transparent-models.md) §1.4 and §6 define them. A mask field may carry `min` and `max`. Formulas may also stand in a transfer function's `num` and `den` entries, and may use `inf`.
  - `levels` (optional, two or more): `[{ name, valid, diagram }]`.
  - `level` (optional, 1-based): the local override. Absent, the subsystem runs the global level.

  Without `levels`, `diagram` as today.
- **Block changes:**
  - The Integrator's `x0`, `min`, `max`, `unit` and `angle`: as transparent-models.md §1.3 defines them. A limit of ±inf counts as none.
  - New block `validRange`: `name`, and `params: { of?: "value" | "rate", value?, min?, max?, says }`. With `value` it has no input.
- **`sim.detail`** (optional): the global level, an integer ≥ 1; absent means 1. A subsystem runs min(its `level`, else `sim.detail`, its number of levels) (§2.1).
- **System library entries** carry `sim.detail` (§7) and no `level`.

```json
"sim": { "detail": 2 }
```

With this, a subsystem of 4 levels without `level` runs level 2, one with `"level": 4` runs level 4, and one of 2 levels with `"level": 3` runs level 2.

## 11. Migration

- **Old files load unchanged.** Subsystems without levels keep `diagram`, numbers stay numbers, and nothing old changes meaning, so the format version stays.
- **Scope channels** naming a Sink in any level are kept on load.
- **Library entries:**
  - The motor's Motor subsystem gains its mask (R, L, K, J, b) and levels, and the motor examples carry `sim.detail: 2`, so they run as before (test 5).
  - The open tank gains its L2, and its entries keep global level 1; the carts gain theirs, and their entries carry `sim.detail: 2`.
  - No entry carries an override.
  - My blocks keep a subsystem whole: mask, levels and its override, if any.
- **Code that reads a subsystem's `.diagram`** moves to the `levels.js` helpers, each covered by test 10:
  - core: `blockPorts`, `normalizeDiagram`, `compileDiagram`'s nesting walk (renamed `flatten`), `diagramNames` (`diagram.js`); `copyParams` (`live.js`, near line 35: a TypeError in any live system with levels otherwise); `findExternal` (`hil.js`, near line 161); Auto-tune's walks and `locate` (`autotune.js`, near lines 48, 59, 68, 91, 110 and 112); `systemTags` (`systems.js`, near line 57); `plantKey` and `blockInputNames` (feat/designs);
  - UI: the Controller tab (`ui/controller.js`, near lines 66, 72 and 101), Analysis (`ui/analysis.js`, near line 74), the Auto-tune tab (`ui/autotune.js`, near line 84), the Plant tab's navigation, new subsystem, summary and breadcrumb (`ui/plant.js`, near lines 132, 165, 277 and 362), the views' signal lists.
- **Compile sites** use `runDiagram(project)` (§2.1).
- **Older pages cannot read levels.** A file and its page travel together (Export HTML), so this is accepted.

## 12. Implementation steps (each one agent; `npm test` green at the end of each)

**First, merge feat/designs into main.** It rewrote large parts of `diagram.js` (641 lines changed against main) and `simulateSystem`, so building the step bound or levels on main first means doing them twice. transparent-models.md's step 0 needs the same merge. The branch has main merged in (decisions v2.7.2) and waits to land.

0. **Record.** Rules of §1 and the interpretations of §14 into decisions.md. The person's answers are already there (v2.8, detail levels answered), and their words are saved (inputs 10 and 13). The README's row for this page is current. Roadmap entries.
1. **Eigenvalue step bound and run info** (§5, §4):
   - the Jacobian's largest eigenvalue at compile, folded into `el.bound` (and so into Live, `sim.js` and `Model.bound`), with Quantizer as identity and Noise as 0; the end-of-run check in `simulateSystem`; the specific stiffness warning naming the fastest state's block (levels come later);
   - `info` kept by the page's acquisition in both branches, shown on the status line, and `loopTuner.info()`. Today's warnings reach the person from here on.

   Tests 7 (first and last parts) and the `info` part of test 9. Independent of levels; it also unblocks the sliding-mode research's integrator-form motor.
2. **Shared prerequisites, from [transparent-models.md](transparent-models.md):**
   - its step 2: masks and formula parameters;
   - its step 3: the Integrator's limits and the Equations block.

   If that plan has not built them yet, build them here, by its definitions, once.

   Here add:
   - `inf` in `formula.js`;
   - formulas in transfer-function coefficients;
   - `min` and `max` on mask fields (loading, the wheel, SI entry);
   - `{formula:unit}` sentences with SI prefixes (`siUnit` gains `p`).

   Their tests.
3. **The Valid range block** in its three modes, with `info.validity`, the status sentence and the CLI's print. Test 9.
4. **Levels in the core:**
   - `core/levels.js` (in MODULES before `diagram`); `levels` and `level` on subsystems; the port check; Sinks across levels; the refusal of Controllers, Observers and live plants inside levels;
   - the global level `sim.detail` (default 1) and the override `level`; `runningLevel`, `applyDetail` and `clearOverrides`; `runDiagram(project)` at every compile site (§2.1); `detail` in `simOf`;
   - `el.levels` with `override`, `running`, `clamped` and static counts; paths with `@k`; compile messages with the level ("Board L3/sat"), state labels without;
   - `diagramNames` with `from`; channel names kept;
   - every reader of §11 through the helpers; the nesting helpers renamed;
   - `--detail`, `--level` and `--clear-overrides` in the CLI; `loopTuner.detail()`, `level()` and `clearOverrides()`.

   Tests 5 (structure guards), 6, 10, 11 and 12.
5. **Levels in the Plant tab:**
   - the level chip, outlined or filled (overridden), with `↓` when clamped, and its menu (Global level, then the levels); the Levels list (a click overrides, Add a level, Duplicate as next level, rename, delete, reorder; counts, step, last run; levels that do not compile marked);
   - level tabs inside, ports edited across levels, and the check compiled at the viewed level;
   - the Detail row in the Plant tab's panel (only when levels exist): the global level and Clear, with the count of overrides;
   - "not modelled at Lk" on channel badges (`.badge.nosig`); the `--warn` and `--bad` pair; undo for each, and one undo step for Clear.

   Checked in the browser (Playwright): set the global level; override one block above it and one below, and see both chips filled; see a clamped chip; Clear, and undo it; open a level; edit a port in one level; an error outlined in the viewed level only.
6. **Stiffness warning by level**: the warning names the subsystem and level, and the chip turns `--bad`. Test 7, middle part.
7. **The example** "Op-amp follower and a cable" (§8):
   - the board's four levels from primitives, with their Valid range blocks, the notes, the tag; the entry at global level 1 (`sim.detail: 1`), with no override and no speed of its own.

   Tests 1, 2 and 3 for the board, and test 4. Then system-library.md's table and a "How the board was modelled" paragraph. Browser check: step through the levels with Single runs and see the earlier levels stay, fading, and the validity line; turn C_L at level 3 and see the ringing grow.
8. **Motor levels.** Mask (R, L, K, J, b) and L1 and L2 on the shared Motor subsystem (`motorDiagram` and the encoder's); the motor examples at global level 2. Tests 1, 2 and 3 for the motor, and the bit-for-bit guard. The sliding-mode example's notes gain one sentence: Motor L1 makes the relay look perfect; L2, the real motor, chatters.
9. **The design layer, Auto-tune and Analysis on levels** (§6): model compiles from `runDiagram`; `plantKey` of the running level resolved to numbers; the detail hint in refusals; Copy as numbers naming the levels; Auto-tune's rows and Analysis's header naming the levels. Test 8. Browser check: the experiment of §6 on the motor.
10. **Physics levels**, each after its open subsystem exists ([transparent-models.md](transparent-models.md) steps 4 and 7):
    - the tank's L2 (Cd, pump lag); its entries at global level 1;
    - the carts' L1 (ideal) and L3 (drive) around today's model as L2; their entries at global level 2.

    Tests 1 and 2 for each. The carts' behaviour tests stay green unchanged.
11. **Docs sweep:**
    - plant-editor.md (levels, the level chip, the global level and Clear, Valid range), project-format.md, system-library.md, controller-proposal.md (Copy as numbers with levels), autotune.md, analysis.md;
    - AGENTS.md (`--detail`, `--level`, `--clear-overrides`, `loopTuner.detail`, `level`, `clearOverrides`, `info`);
    - the roadmap, the output README's status, the page's Help (a short "Detail levels" section).

Dependencies:
- feat/designs merged first, then steps 1 to 8 in order.
- Step 2 is shared with transparent-models.md.
- Step 10 needs transparent-models.md's steps 4 and 7.

## 13. Not built

- **Choosing the level automatically** when a run leaves a level's validity (SPICE binning). The page reports it; the person chooses.
- **Switching a level during a run** (Simulink's runtime activation). Levels are fixed per compile.
- **Ports that differ between levels** (Simulink's flexible interface, Simscape's conditional ports). Refused by design.
- **Unordered alternatives for plant subsystems** (variant subsystems). Controllers have variants; a level is an ordered rank.
- **Linearised levels.** A level is a physical model; linearising is the design layer's job.
- **Designing on less detail than runs** (`designDetail` on a designed variant, Simulink Control Design's `blocksub`), until an example needs it. Lowering the global level, designing and Copy as numbers does the same by hand (§6). When built: in the plant a block sees, each subsystem runs min(its running level, k); the Computed box names what the design does not know from the level names between; a Kalman Observer and its Controller must see the same levels. The candidate example is an LQR on the motor's angle loop with angle and speed measured: designed on L1, it runs on L2, which has the current.
- **A separate "Highest".** The global level at its largest number does it (§2.1, input 13).
- **Auto-tune's "Tune on" field and Analysis's "Plant" choice and "as designed" overlay.** The global level does the same: lower it, tune or look, raise it.
- **Anything new on the display for comparing levels**: no change to the fading, no slow speed for the example, no count of changed runs. Levels are compared with Single runs, as any edit is (input 13).
- **A table of subsystems with levels** in the Plant tab. Each block's chip shows its state.
- **Units on In and Out ports.** Nothing propagates units through wires.
- **Parameter corners and Monte Carlo sets** (SPICE `.lib` corners). These belong to robustness against plant variations (roadmap).
- **An implicit or multirate solver** for stiff levels on long screens: the warning names the level instead. **Breakpoints** that put steps exactly on source edges.
- **Analysis at a wire** (a loop probe), for analog loops without a Controller block such as the op-amp follower.
- **The op-amp:**
  - offset, noise, input capacitance, CMRR, PSRR, temperature, a second pole;
  - a frequency- and current-dependent output impedance, and with it the short-circuit current limit;
  - a smooth slewing onset (Boyle's input pair);
  - the isolation-resistor fix;
  - a two-pole op-amp, which could oscillate outright with enough cable; the example rings (§8).
- **Motor and pendulum levels beyond those in §7:** Coulomb and stick–slip friction (they need a stick state, not a sign function, to stay right in RK4), cogging, thermal drift, PWM switching. The research found that PWM and dead time are invisible to a ms speed loop.
- **Encrypted or compiled models**: never.

## 14. The person's answers, and interpretations (for the decision log)

The person answered this page's four questions on 2026-10-25 ([input 13](../input/2026-10-25-13-detail-levels-answers.md); decisions.md, "v2.8: detail levels, answered"):
1. **Comparing levels: no change.** "if I want to compare levels, what I would do is that I would run a number of single runs and compare the traces. So we don't need to change anything about the system." Earlier runs keep fading as today. Both proposals (count only changed runs at every speed, or a slow speed for the example) are dropped, and the roadmap's "Earlier runs at high speed" is closed with no change (§8).
2. **A global level with local overrides, not a cap.** "a global level that sets everything that I didn't set by hand. Then I have a local override … a … clear button where I clear the local overrides and everything is put back onto the global level … if I say global level is 4, but one element only has 2 detail levels, then it can only go to level 2." No separate "Highest" (§2.1, §3.1, §3.2).
3. **Detail is in the Plant tab.** "it belongs into the plant. It doesn't belong into the header." (§3.2.)
4. **The op-amp rings.** "Choose a behavior that is something that a electrical engineer will be familiar with. I guess it should ring." The follower driving a cable rings, more as C_L grows; a two-pole op-amp that oscillates is not built (§8, §13).

**Interpretations:**
- **"The interfaces stay more or less the same"** is read as **identical ports**. Extra quantities a higher level models are Sinks inside it. "More or less" is covered by the parameters: a lower level ignores some.
- **The global level and overrides.** The level that runs is min(override, else global, n). An override may be above or below the global level. A nested subsystem follows the global level unless it has its own override. The person said "a lock on or clear button where I clear the local overrides": Clear removes the overrides, and undo restores them; nothing locks them away. The chip's menu also removes one override (Global level). A filled chip marks an override, `↓` a clamp.
- **The global level's default and the library.** Absent, it is 1. Each library entry carries the global level that runs its models as today and no overrides, so the experiment needs no Clear first. Loading a system's plant sets it, since it belongs to the plant.
- **Only in the Plant tab.** No Detail control in the header and no Detail chip on the display. The display's status line keeps the validity report, which names the level.
- **Designs see what runs.** Designs, Auto-tune and Analysis use the running levels. The experiment is: set the global level low, design or tune, keep the numbers, raise it. Pinning a design to a lower level waits for an example.
- **Validity is drawn, not hidden.** A level's machine checks are Valid range blocks on its canvas, editable in the existing panel, in three modes (value, rate, parameter). Where they cannot reach, the sentence says so.
- **The example opens at level 1** (global level 1), whose validity line already says the cable is too large for it (C_L 1 nF > 32 pF). Build up from simple: the simple model knew its limit, and the run shows why.
- **The ringing is the familiar one**: an op-amp driving a capacitive load through its output resistance. At level 3 it overshoots 23.3 to 74.3 % and rings at 727 to 178 kHz as C_L goes from 500 pF to 10 nF (§8).
- **R_o** is a physics input taken from the datasheet's 500 pF point, assuming the AC table's 10 kΩ load, and checked by a test, not computed in the page.
- **One K for the motor.** Torque and back-EMF constants are equal in SI units, so the mask holds one (Rule 4).

**Still open:** none. The interpretations that go beyond the person's words (the default of 1, entries carrying their global level, a plant load setting it, no Detail chip on the display, the chip's Global level item) are this page's, and change if the person says otherwise.
