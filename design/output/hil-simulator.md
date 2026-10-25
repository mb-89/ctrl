# The HIL simulator: any library model as an external plant

Reader: whoever changes the external plant (`hil/hil_plant.py` and the core it runs), the library metadata it reads (physical parameters, effects, ranges), or the plant's download. The person's words: [input 20](../input/2026-10-25-20-hil-plant-is-a-black-box.md), [input 21](../input/2026-10-25-21-hil-simulator-runs-any-model.md), [input 22](../input/2026-10-25-22-node-is-fine.md), [input 25](../input/2026-10-25-25-hil-python-through-uv.md). The protocol and the safety are in [hil.md](hil.md); why it runs the way it does, measured, in [../research/hil-simulator.md](../research/hil-simulator.md). **Status: designed 2026-10-25; being built on feat/hil-sim.**

> "the external [HIL] can be configured to simulate something else ... a startup flag where you can specify what you simulate ... any of the models that we have ... You can just reuse the code we already have ... it adds its parameter fluctuations ... flick on or off effects on any detail level more or less randomly, unless we specify what we want ... a complete random mode ... the interface description, it has to come over the wire". And: "don't duplicate code"; "if you use Python, use UV".

## 0. Bottom line

- **One simulation code**: the plant script runs **the page's own core** (the JavaScript of `src/core`, as the page carries it) in V8 inside the Python plant, through `mini-racer`, which uv installs like websockets. The hand-written motor and heater physics go. The window with its STOP, the asyncio server, the watchdogs, who-latched-resets, the log and the bench stay as they are.
- **The core comes from the page**: `hil-plant.zip` holds `loop-tuner-core.js`, cut from the page's own script when the zip is made (the same cut the Live worker uses), so the plant always runs what the page runs, an exported page included. Nothing is kept twice.
- **Any library system** (`--model "Triple pendulum"`), or one at random (`--random`); its plant only: the page's u takes the place of the system's Controller (control mode), or the system's own controller runs inside the plant (reference mode). The arm the plant simulated until now is a library system: **DC motor with an unbalanced arm**, the default.
- **Varied and switched, seeded**: every physical parameter the model flags varies by up to ±15 % (`--vary`), every effect it flags is on or off at random (`--detail`), from one seed (`--seed`, printed); `--show-params` prints what was drawn, for the person at the plant only.
- **The interface over the wire**: `describe` lists the inputs (the effort, or the reference; a disturbance only with `--dyno`) and the outputs (what the controller measures, and the model's other Sinks), with names, units, full scales, hard ranges and kinds, taken from the model. The page knows nothing else (input 20) and identifies the plant before tuning.

## 1. The runtime

V8 in Python through `mini-racer`, chosen over Node.js, QuickJS, Node from PyPI as a child process and Bun (measured: [research](../research/hil-simulator.md)):

- it keeps the plant's window (tkinter in uv's Python) and its reviewed safety code; Node and Bun have no window toolkit, and the safety would be written again;
- it installs exactly as today: winget (Windows) or the package manager (Linux, for curl) installs only uv, uv installs Python, websockets and `mini-racer` from the script's header (input 25: "you're only going to use Winget to install UV, and then you're going to run through UV");
- wheels for Windows, macOS and Linux on x86_64 and arm64, any CPython from 3.10 (39–83 MB, once, into uv's cache);
- the heaviest library plants cost 0.8–1.1 ms a cycle on average, at most 13 ms (the call into V8, not the physics): 100 and 200 Hz both hold.
- **Python earns its place** (input 22: "if it makes sense to keep Python if you're going to run Node anyways ... don't duplicate code"): it carries the window, the server and the safety; the physics is the page's JavaScript, once.

## 2. The core, from the page

- **What the file is**: the core modules of the page's bundle (`build.mjs`'s `bundleScript`, from its first `core/` module to its first `ui/` module), in the same IIFE, with a two-line prelude (`structuredClone` as a JSON round trip, which V8 outside a browser lacks) and a last line `globalThis.LoopTunerCore = __mods`. `simulatorCore(script)` in `src/core/hilsim.js` makes it; the page and `build.mjs` both call it, so the cut is written once.
- **In the page**: `plantZip()` (ui/live.js) adds `loop-tuner-core.js`, made from the page's own `<script id="lt-script">`, to the files of `hil/` it zips. The Live worker cuts the same script the same way. An exported page carries its core, so its zip matches it.
- **In the repository**: `node build.mjs` also writes `dist/hil-plant/`, the zip's contents unpacked (the core included), to run and test from: `sh dist/hil-plant/runme.sh`. The tests make the core with the same function.
- **The plant finds it** beside itself (`loop-tuner-core.js`), or at `--core PATH`. Missing, it says how to get it (download the zip from the page, or `node build.mjs`) and ends.
- **No provenance**: the file is the page's own stripped code (test/provenance.test.mjs covers the page; the zip's test checks the file is the page's core, byte for byte).

## 3. Flags

| Flag | What |
|---|---|
| `--model NAME` | A library system, by its name as the System library shows it (`--list` lists them); its plant runs. A path to a project file (`.json`, as the page saves it) runs that project's system. Default: **DC motor with an unbalanced arm**. |
| `--random` | Any system: drawn from `--list` with the seed, then varied and switched as below. Only `--show-params` says which. |
| `--list` | The models it can run, a line each: name, inputs, outputs; then ends. |
| `--vary F` | Each physical parameter differs from nominal by a factor 1 + F·(2ρ − 1), ρ uniform in [0, 1) (default 0.15; 0: nominal). |
| `--seed N` | One seed for every draw (system, effects, parameters); default a new one each start, printed. The same seed gives the same plant. |
| `--detail random\|all\|none\|LIST` | The model's effects: each on or off at random (default `random`, p = ½ each), all on, all off, or the comma list of those on (`--detail "torque ripple,shaft resonance"`; the others off). A name it does not know is refused with the names it knows. A detail level's name (when levels exist, [detail-levels.md](detail-levels.md)) sets that level. |
| `--set NAME=VALUE` | Fixes a physical parameter (its name as `--show-params` prints it), after the draw. |
| `--show-params` | Prints what was drawn: the system, each effect on or off, each parameter (nominal → drawn, %), and each port's ranges and where they came from (model or simulation). The page is never told. |
| `--dyno` | Offers the model's disturbance Sources as inputs (`kind: "disturbance"`), as a rig with a dynamometer would; without it they hold 0. |
| `--mode control\|reference\|log` | As today ([hil.md](hil.md#two-modes-settled-see-decisionsmd-v27-before-changing)): the page sends u; or the page sends r and the system's own controller runs in the plant; or no inputs and the system's own controller holds its reference (the system's own r waveform, or `--setpoint`). A system without a Controller block runs in control mode only. |
| `--setpoint X` | Log mode: hold X instead of playing the system's r. |
| `--core PATH` | Where `loop-tuner-core.js` is (default: beside the script). |
| unchanged | `--rate`, `--port`, `--host`, `--watchdog`, `--slew`, `--log`, `--bench`, `--no-gui`, `--allow-origin`, `--strict-origin`, `--spin`, `--check` (now: the system's own loop for one period, then full effort until an output leaves its hard range), `--describe`. |
| gone | `--plant motor\|heater`: the motor is `--model "DC motor with an unbalanced arm"`; the heater's place is taken by the library's **Oven, badly tuned** (`--model "Oven, badly tuned"`). `--plant` is refused with that sentence. |

## 4. From a library system to a plant

`simPlant(options)` in `src/core/hilsim.js` turns a system into the plant's diagram and its interface; `createSimPlant(spec)` steps it. Both are pure and run in Node, the page and V8 in Python alike.

### 4.1 Inputs

| Mode | Inputs | Range (full scale = limits) |
|---|---|---|
| control | the Controller block's output u, `kind: "effort"`, named by the Sink that shows it (V, F, q, P), else `u` | the running variant's `umin … umax` (the model's limits); a variant without both: from a short simulation (4.3) |
| reference | the Source on the Controller's r, `kind: "reference"`, `measures` the output its y is | the measured output's full scale |
| log | none | |
| any, with `--dyno` | each Source that feeds the plant (not a Controller's r): `kind: "disturbance"` | from a short simulation of its own signal |
| a system without a Controller | its Sources that feed the plant: the first is the effort, the others disturbances (`--dyno`) | from a short simulation of its signal |

Every input's safe value is 0, clamped into its range. In control mode the Sources only the Controller read (r) are dropped. Interpretation: the library's d waveforms are the page's test signals, not the plant's; without `--dyno` a disturbance holds 0, as a rig without a dynamometer has none (input 20).

**Several Controller blocks**: none in the library has more than one; a system with more is refused ("one Controller block, for now").

### 4.2 Outputs

In this order:

1. **What the Controller measures**: each of its inputs after r, named by the Sink that shows the same signal, else by the block's output name in letters (θ1 → `theta1`, ω1 → `omega1`), else the block's id. The triple pendulum's eight states, the encoder's measured speed. A Sink is added for each that has none (it changes nothing in the dynamics).
2. **The model's other Sinks**, in diagram order, except one that only copies an input (V in control mode) or depends on a dropped Source (the sliding-mode motor's e = r − angle).
3. **Reference and log modes**: the Controller's u, `kind: "effort"` (the plant's own control effort, as today); in log mode also the reference it holds.

A system without a Controller: every Sink but a copy of an input.

### 4.3 Full scales and hard ranges

Each output has a full scale (`min … max`, what the scope spans) and a hard range (`hard_min … hard_max`, beyond which the plant E-stops, [hil.md](hil.md#hard-ranges-and-applied-inputs-2026-10-25)):

- **From the model, where it declares them**: a library entry may declare `ports: { angle: { scale: [-π, π], hard: [-2.5, 2.5] } }` (the arm declares all three outputs as today's plant does; the tank declares h's 0 … H). Inputs' limits from the Controller's `umin`/`umax`.
- **From a short simulation otherwise**: the system's own loop (its controller, its signals, the drawn parameters and effects), two of its periods at the plant's rate, gives each signal's extent [a, b]. With s = b − a (or the largest magnitude, if 0): a range that crosses 0 becomes symmetric, ±m with m = max(|a|, |b|): hard ±1.5·m, full scale ±2·m; one that does not becomes [a − s/2, b + s/2] (hard) and [a − s, b + s] (full scale); both rounded outwards to two significant digits. An extent of 0 (a signal that never moves) gives ±1.
- `--show-params` says which each came from.

Interpretation: the hard range is where the model's own controller never goes in its own run, with half its extent to spare; an unstable plant (a pendulum) E-stops when it falls, as a rig with end stops would.

### 4.4 Physical parameters: which vary

- **Flagged in the model**: a library entry lists its physical parameters, each with a name and a unit: `physics: [{ name: 'R', at: 'motor/arm.den[1]', unit: 'Ω' }, …]`, and ties where two numbers are one (`same: 'Kt'`: the motor's Ke follows Kt, or it would make or lose energy). These names are what `--show-params` prints and `--set` takes.
- **A system without a list** (a project file) varies the parameters the block types flag as physical: masses, lengths, friction and tank geometry of the physics blocks; K, τ, ωn, ζ of the model blocks; the coefficients of a Transfer function; a Dead time's T_d.
- **Never**: controller and observer parameters (gains, Ts, limits), Sources and Sinks, Sum signs, Switch positions, noise and quantiser settings, seeds, ports, g (a constant of nature, not of the plant), start values.

### 4.5 Effects: which switch

- **Flagged in the model**: `effects: [{ name: 'torque ripple', at: 'ripple', off: 'zero' }, …]`: a named block that is the effect; off, it is replaced by a Gain of 1 (`pass`: the signal goes through unchanged, an encoder without its errors) or 0 (`zero`: the effect adds nothing, no ripple). Today: the encoder example's torque ripple, torque noise, shaft resonance and encoder errors; the tank's pipe dead time; the arm's Coulomb friction.
- **Detail levels and the servo's switches**, once built ([detail-levels.md](detail-levels.md), [servo.md](servo.md)): a subsystem's levels and the Servo motor's mask switches register as effects the same way (a level by its name, a switch by its mask key), so `--detail` draws them too. Not built here: neither exists on main yet.

### 4.6 The draws

One generator (mulberry32, the core's own) from `--seed`, drawn in this order so a seed always gives the same plant: the system (`--random` only), then each effect in list order (unless `--detail` names them), then each physical parameter in list order (a tied one takes its partner's factor). `--set` applies last. Identification §13's `varyDiagram` (a page-side variation for the teaching comparison) uses the same function.

### 4.7 Stepping

`createSimPlant` compiles the plant's diagram with the page's `compileDiagram` and steps it with the page's RK4 on the page's grid (`stepPlan`: substeps of h = dt/m, every sample instant of a Controller on the grid, the same time arithmetic as `simulateSystem`). `advance(span, u)` integrates a span with u held, cutting a substep where a span ends inside it; the Python cycle hands it the segments between the arrivals of u, in one call per cycle. Fed whole cycles, it is `simulateSystem` of the same diagram, sample for sample (Tests).

## 5. What stays of `hil_plant.py`, and what goes

| Stays | Goes |
|---|---|
| the protocol (`describe`, `start`, `stop`, `reset`, `estop`, `u`, `y` with `applied`, `running`, `status`, frames in order, error codes) | `Motor`, `Heater` and their constants |
| the cycle (absolute deadlines, stalls skipped, u applied from its arrival), the watchdog, the hard ranges' E-stop, not-a-number, a failed cycle, shutdown | `OwnController` (reference mode runs the system's own Controller block, in JS) |
| the window (STOP, Run/Stop, Reset, where it listens) and the console | `plant_params` (the draws are the core's) |
| who latched it resets it, origins, one page at a time | `--plant` |
| `--log`, `--bench`, `--slew`, `--check`, `--describe` | |

The plant class becomes `CorePlant`: it loads the core into V8, asks it for the plant (`describe`'s ports, the draws), and its `advance`, `outputs` and `safe` are the core's (`safe` does nothing in a simulation, as before). **A plant of your own** (real hardware) keeps the same three methods and its own ports, as [hil.md](hil.md#a-plant-of-your-own) says; it needs no core.

## 6. The arm as a library system

**DC motor with an unbalanced arm** (System library, tags Nonlinear, PID): today's plant as blocks. V → armature 1/(L·s + R) → current i → K → torque; Coulomb friction Tc·tanh(ω/0.01) and gravity mgl·sin(angle) brake it; rotor 1/(J·s + b) → ω → angle. R 2 Ω, L 4 mH, K 0.1 N·m/A (= V·s/rad), J 2.5·10⁻³ kg·m², b 2·10⁻³ N·m·s/rad, Tc 0.01 N·m, mgl 0.1 N·m: the plant's constants. Its Controller has the plant's own PID (Kp 10, Ki 20, Kd 0.6, Tf 0.01, ±12 V), which reference mode runs, and the HIL example's first guess (P, Kp 2). Its signals: r the HIL example's square wave, a load pulse d. It runs in the page like any system (so the page can show what the plant is, for teaching; the HIL systems still know only the interface). The expression language gains `tanh` (and `sinh`, `cosh`) for its friction; no existing expression changes.

## 7. Tests

- **The plant is the page's simulation**: for every library system, its plant (no variation, every effect as the library has it, `--dyno`), fed the u and d the page's `simulateSystem` computed, gives the page's outputs at every sample, bit for bit (in Node). Systems whose Sources are smooth are run with a square wave in their place (a held input equals a continuous one only where it is piecewise constant on the grid).
- **The same draws**: the plant with a seed equals the page's simulation of `varyDiagram(system, seed)` sample for sample.
- **Seeded draws are reproducible**: the same seed gives the same system (`--random`), effects, parameters and description; another seed another; every factor within ±vary; ties hold; nothing outside the flagged parameters changes.
- **The description matches the model**: per mode, the inputs and outputs listed above, with names, units, kinds, ranges; `checkDescription` accepts every one; the triple pendulum's eight outputs; the arm's ports as today's plant had them.
- **Random mode**: the plant it draws is in `--list`, and describes itself.
- **The core is the page's**: the zip's `loop-tuner-core.js` is `simulatorCore` of the page's own script; it runs in a plain V8 context (no DOM, no Node).
- **Every library system runs bit-identically in the page**: each system's `simulateSystem` against fingerprints recorded before the change.
- **The safety tests still pass**, now against the plant running the core (the script's own tests under `uv run`).
- **End to end** (Playwright against the running plant): connect, the description in the Interface, run, stop, E-stop from both sides; recorded in [hil.md](hil.md).

## 8. Interpretations (for the decision log)

- Python stays because it carries the window, the server and the safety; the physics is JavaScript, once (input 22).
- The page's d waveforms are test signals of the page: without `--dyno` the plant has no disturbance (input 20).
- Full scales and hard ranges from the model where it declares them, else from its own loop's extent, with margins (4.3).
- g, start values, noise and seeds are not physical parameters of the plant; gains and sample times never vary.
- An effect switched off is its block replaced by a Gain of 1 or 0, as the library entry says.
- `--detail` covers effects today and detail levels and the servo's switches when they are built.
- The heater goes; the library's oven takes its place.
