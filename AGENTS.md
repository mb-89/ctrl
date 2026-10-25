# Tuning a loop as an agent

Reader: an agent asked to tune a control loop with Loop Tuner.

You work on a project file (`.json`, or an exported `.html` page with the project inside) through `node cli.mjs`, or through the MCP server `mcp.mjs` (see **Through MCP** below), which has the same operations as tools. Everything you add with `--save` shows up as a candidate when a person opens the file, so leave the project better than you found it: good candidates with names that say what they are.

## The loop

0. **Check the loop exists.** A new project is a reference signal and a plant diagram with just a Source (`node cli.mjs signal p.json [--name r]` lists a signal; `--add <type> --set k=v --save` adds a component). The plant is a block diagram in `system.plant` (see [design/output/plant-editor.md](design/output/plant-editor.md)). The commands below tune controller candidates of a plant with In and Out blocks: start from `node cli.mjs new --example 0`. A system whose diagram holds Controller blocks (every System library entry: `node cli.mjs systems`, `node cli.mjs new --system "Conical tank, gain scheduling" -o p.json`) runs the variants of those blocks instead ([design/output/controller-proposal.md](design/output/controller-proposal.md)).
1. **Read the problem.** `node cli.mjs eval <project>` shows the goal and every candidate, best first. `--json` gives all metrics. The goal is the contract: `minimize` is the objective, `subjectTo` the bounds. If the person's request differs from the goal in the file, change the goal in the JSON first, and say so.
2. **Explore by hand, then refine.** Try variations and read the metrics:
   ```
   node cli.mjs try p.json --from "Detuned PID" --set Kp=2.5 --set Kd=1.2
   node cli.mjs try p.json --type PI --set Ki=0.4          # change structure
   node cli.mjs try p.json --set plant.tau=1.5             # what-if: a slower plant, this candidate only
   ```
   Then refine with the optimiser, from a few different starting points or structures:
   ```
   node cli.mjs tune p.json --from "Detuned PID" --save
   node cli.mjs tune p.json --from "Z–N PI" --params Kp,Ki --evals 500 --seed 2 --save
   ```
   The tuner is a local search: it improves a start point, it does not prove a global optimum. Compare results from different starts.
3. **Check robustness before you recommend.** A gain set that only works for the nominal plant is fragile. Re-run the best candidate with `--set plant.<param>=…` at ±20–50 % of the uncertain parameters, and with noise if the sensor is noisy.
4. **Hand it back.** Save the candidates worth looking at (`--save --name "…"`), then `node cli.mjs html p.json -o p.html` for a page the person can open. Report the best candidate, its score and its margins on each bound, and the trade-off you saw (for example "faster than this costs overshoot").

## A v2 project: auto-tune a Controller block

Projects whose plant is a block diagram with a **Controller block** (every controlled system in the page's System library) are tuned with `autotune`, the same core as the page's Auto-tune tab ([design/output/autotune.md](design/output/autotune.md)). A variant computed from the plant (LQR, PI from the plant, PID + feedforward from the plant, swing-up with an LQR catch) is tuned as its Copy as numbers twin, from the numbers its design computes, and the result is a hand variant; a planned swing-up has no gains to tune (change its inputs instead):

```
node cli.mjs autotune p.json                                   # Nelder–Mead on IAE + effort + overshoot beyond 10 %
node cli.mjs autotune p.json --method relay --rule tl          # relay experiment: Ku, Pu, then Tyreus–Luyben
node cli.mjs autotune p.json --method step                     # open-loop step, model fit (settling or integrating), SIMC
node cli.mjs autotune p.json --method step --simc smooth       # the same with τc = 3θ: slower, gentler on u
node cli.mjs autotune p.json --cost ITAE --overshoot 5 --save  # another goal; keep the result
node cli.mjs autotune p.json --ff                              # also tune the feedforward gains that are 0
```

It prints the running variant and the result side by side (cost, overshoot, gains) and, for the experiments, what they measured. `--save` puts the result into the block as a variant of its own, "<name> · auto-tuned" (or "· relay T–L", "· SIMC"), and makes it run only if it scores better; the original stays, so the person can flip between them in the Controller tab. `--block motor/ctrl` picks a block by its id path when there are several; `--json` gives the full report. When a method cannot run it says why (a swing-up has no r − y to tune; the relay and step tests need one measurement). The step test fits a plant that settles (K, τ, θ) or one that integrates (k′, τ2, θ: a motor's angle, a tank's level without outflow) and, for a gain-scheduled PI, every point of its table; its notes say how it ended, any ripple, and when the step was made smaller. A result that scores worse than the running variant says why (`worse` in `--json`); a relay or step result that is unstable where the run starts is not run either, whatever its run scores (`unstableAtStart`: a loop that starts in exact balance rests even where it is unstable). Compare methods: the optimiser knows the goal and usually wins on it; a rule gives a sound loop in one experiment.

## Identify a plant (simulated)

`identify` runs the Identify tab's whole test on the project's own plant, as a tester with no model would ([design/output/identification.md](design/output/identification.md)): the page eases in (Listen, growing pushes, a gentle loop asked to be quicker try by try, a Check it was not fitted to), then fits small models and grades them on the Check.

```
node cli.mjs identify p.json                          # the sentences, the chain with ±2σ, the candidates, the places
node cli.mjs identify p.json --vary 0.15 --seed 7     # a hidden ±15 % variation of the plant, revealed at the end
node cli.mjs identify p.json --band -0.5,2 --budget 300 --keep   # settings, and keep the record in the project
node cli.mjs identify p.json --structure resonance    # use this candidate instead of the page's choice
```

`--json` gives the whole model (the same numbers as the page's core); `--keep` stores the measured record and its plan, never the model, which is always recomputed from them. A grade ! or ✕ says why (it explains under 85 %, it behaves differently at different places, what is left has a pattern). When the test cannot run or ends early, the sentence says why and what to change (the band, the length, u's range). A live plant will be identified in the page, connected (the Identify tab and Live, not built yet), not here.

## A robot, or any loop with vectors

`node cli.mjs new --system "PUMA 560, a circle in space" -o puma.json` writes the PUMA as a project ([design/output/robot.md](design/output/robot.md)). Its wires carry vectors: a wire end's port counts a block's groups (q is 6 wide, a Jacobian 36), Mux and Demux join and split, a Sink on a wide wire records one signal per element (`q` → q1…q6, or names it `"x,y,z"`). The robot blocks (`forwardKinematics`, `jacobian`, `inverseDynamics`, …) read the URDF in the diagram's `robots` map by name. The axis loops are one Controller with `lanes: 6` and an `ff` input; its variants are `speedPI` (inputs ω, ζ, Kf, integral), designed per lane: `node cli.mjs design puma.json` prints b, Kv, Ki and u0 for each lane `ctl/servos[k]`, and `node cli.mjs run puma.json` the run's reports (a joint leaving its range, at what time). To change the circle, edit the Sines of a_r and b_r (amplitude, frequency, `ease`); to see what the model buys, set the Axis servos' `variant` to 1 (PI, no model) or 2 (P only) and compare the Sink `e` (mm). Auto-tune works on one lane at a time at most; a widths mismatch is refused with a sentence naming both ends.

## Rules of thumb

| Symptom | Usual move |
|---|---|
| Overshoot too high | Lower Ki, add or raise Kd, or set setpoint weight b < 1 |
| Too slow | Raise Kp (watch overshoot and effort) |
| Remaining offset | Add integral action (Ki) |
| Effort too large or jumpy | Lower Kp/Kd, raise the derivative filter Tf, or keep c = 0 (no derivative kick) |
| Noisy effort (`uTV` high) | Raise Tf, lower Kd |
| Saturation most of the time | The goal may be unreachable with these limits; lower the gains or relax a bound |
| Wrong-way first move (`undershoot`) | A right-half-plane zero: slow the loop down; it cannot be tuned away |

## Reference

- `node cli.mjs help`: every command.
- `node cli.mjs run <project> [--duration s] [--signals a,b] [--json]`: simulate the system's diagram over the screen (or --duration) as the page does, and print what the run reported: its step, steps and step bound (the blocks' own and the largest eigenvalue of the rates' Jacobian), its warnings (a stiff plant names the state that needs the step; a run made again because the plant grew stiffer says so), and each Controller block's Auto-tune cost and step metrics; `node cli.mjs analyze <project> [--block <path>] [--at origin|initial|t=1.5|y=0.3] [--json]`: the Analysis tab's numbers there (margins, poles, the linear step), or why there is no linear loop.
- `node cli.mjs blocks [slot]`: block types and their parameters with ranges; `node cli.mjs metrics`: what a goal can use.
- **Masks and formulas in the JSON** ([design/output/project-format.md](design/output/project-format.md)): a subsystem may carry `mask` and `params`; number fields inside may be formulas in the mask's names (`"K": "1/Jm"`, `"den": ["L", "R"]`); an Equations block (`fcn`) has `inputs`, `eqs` and `outputs`; an Integrator has `x0`, `min`, `max`, `unit`, `angle`. A physics number belongs on the mask once, not typed into several blocks. A mask field may be a toggle (`"kind": "toggle"`, 0 or 1) or a choice (`"kind": "choice"`, `"options"`; its 1-based index in formulas), so a Switch's `"position": "1 + coulomb"` or `"drive"` follows it; a Switch the mask sets is a wire, and what only feeds its other inputs is not compiled (a run's `info.off` lists the Sinks that read nothing).
- **Built-in components** ([design/output/servo.md](design/output/servo.md)): a block `{ "type": "subsystem", "component": "servo-motor@1", "params": { … } }` is the Servo motor (drive, rotor, gear, encoder; its non-idealities as toggles, all off by default); the file stores only the reference and the values that differ from the defaults. Its ports: In u (V, or i* with `"drive": "current"`), In 2 the load torque (`"shaft": "free"`) or the load's θ, In 3 its ω (`"coupled"`: an elastic gear; `"rigid"`: the rotor turns with the load, its inertia on the mechanism, as the PUMA's six joints); Out τ, θ measured, ω measured, ω. A second use takes `"prefix": "m2_"` for its Sinks. To change a non-ideality, set its toggle and fields in `params`, never edit its insides.
- **Mechanisms in the JSON** ([design/output/transparent-models.md](design/output/transparent-models.md) §1.1, §2): parts `world`, `rail`, `hinge`, `mass`, `rod`, joined by a diagram's `"joins": [["world:W", "rail:B"], ["rail:F", "cart:F", "hinge:B"], ["hinge:F", "pole:B"]]` (B the base, F the follower, T a rod's tip; the base goes on the World's side). A rail's and a hinge's outputs are their coordinate and rate (ports 0, 1); `force: 1` or `torque: 1` gives them an input. The states are positions, then rates (`cart and pole/x, /θ, /v, /ω`). The library's carts and tank are masked subsystems from `src/core/physics.js` (`cartPole(p)`, `pendulumOnCart(n, p)`, `conicalTank(p)`); old `cartPole`, `pendulumCart` and `conicalTank` blocks still load and open as those. `equationSheets(diagram, el)` (`src/core/diagram.js`) gives a mechanism's equations of motion in its parameters' names.
- `node cli.mjs design <project> [--block <path>] [--json]`: what each running designed variant (LQR, PI from the plant, PID + feedforward from the plant, a swing-up with an LQR catch, a planned swing-up, a Kalman filter, a Luenberger observer with placed poles) computed from the plant, its warnings, or why it was refused; `node cli.mjs new --system "Triple pendulum" -o p.json` writes a System library entry as a project.
- **Designed variants hold inputs only** ([design/output/designs.md](design/output/designs.md)): tune them through their inputs (Q, R, the levels `at`, Tcl, T), never by writing K, kr, Kp, Ki, u0 or a model into them: a file that has those is refused. For numbers of your own, use a hand type (`stateFeedback`, `pid`, `gainScheduled`, `swingUp`, `luenberger`), as the page's Copy as numbers does.
- Project file: [design/output/project-format.md](design/output/project-format.md).
- In a browser: see **Through the browser** below.

## Through MCP

`mcp.mjs` serves the core as MCP tools over stdio (no dependencies). Register it: Claude Code `claude mcp add loop-tuner -- node /path/to/mcp.mjs`; Claude Desktop `{ "mcpServers": { "loop-tuner": { "command": "node", "args": ["/path/to/mcp.mjs"] } } }` in `claude_desktop_config.json`; any client: the command `node /path/to/mcp.mjs`. Without the repository, the page's Export ▾ › MCP server saves the same server as a zip.

Two sets of tools:

| Tool | Does |
|---|---|
| `list_systems`, `load_system` | The System library; load an entry, or a project file (`path`), into memory under a name (`as`). The one loaded last is the default `project` of every core tool. |
| `list_projects`, `get_project`, `set_project` | The projects in memory; one as JSON; replace one (normalised as the page loads a file). |
| `list_blocks`, `get_block`, `set_params` | The diagram's blocks by id path; one block whole; change a variant's parameters (the running one, or `variant`), a block's own (`blockParams`), which variant runs (`select`), or an input signal (`signal` with `components`, `period`). An unknown name is refused, listing the names there are. |
| `run` | Simulate for the timebase (or `duration`): each Controller block's Auto-tune cost J and overshoot, settling, rise time, IAE, effort; `signals` downsampled to `points` (≤ 2000). The same as `node cli.mjs run --json`. |
| `autotune`, `autotune_history` | `method` iterate, relay or step, the goal (`cost`, `effort`, `overshoot`), `apply` to keep the result as a variant (default: report only). The same report as `node cli.mjs autotune --json`; progress while it runs; cancellable. The history keeps every run, the page's too. |
| `analyze` | The Analysis tab's numbers at `at` (`"origin"`, `"initial"`, `{ "y": [...] }`, `{ "t": s }`): stable, margins, poles, the linear step. The same as `node cli.mjs analyze --json`. |
| `designs` | What the designed variants computed, as `node cli.mjs design --json`. |
| `identify` | Not built yet: says so. |
| `save_project`, `export_html` | Write `.json` (or `.html`), or the standalone page with the project inside. |
| `page_status`, `page_open` | **The agentic mode**: the server serves the page (`http://127.0.0.1:8766/` unless taken); give the person the address or open it. The `page_` tools then act on the page they see. |
| `page_load_system`, `page_get_project`, `page_set_project`, `page_set_gains`, `page_set_variant`, `page_control` | Act on the page as its keys do: load, read and set the project, gains, variant, run/stop/single/auto_scale (one undo step each for the person). |
| `page_signals` | The page's data in brief (per signal: unit, min, max, mean, last), the screen's run or the live record; samples only when asked (`signals`, `points`, `from`, `to`). |
| `page_autotune`, `page_analyze`, `page_designs`, `page_screenshot` | Auto-tune on the page (applied, undoable), its Analysis numbers, its designs, a PNG of the scope. |
| `page_live` | The live plant on the page: state and interface, connect, disconnect, estop, reset, and `mode` (`control` or `reference`, while stopped). |

Working with the person on the page: read before you act (`page_status`, `page_signals`, `page_live`, `autotune_history`), say what you see and what you would change, and change it when they agree; each change is one undo step for them. A refusal is a tool error with the core's sentence (and its hint), the same sentence the command line prints. Example sessions and limits: [design/output/mcp.md](design/output/mcp.md).

## Through the browser

When all you have is a browser on the page (a browser tool, Playwright), the page documents itself:

- **Finding it**: every page says so where an agent looks first: the head's `<meta name="description">`, a line for screen readers at the top of the body (`#agent-note`), and the Help key's accessible name ("Help, and a guide for agents: loopTuner.help()").
- **`window.loopTuner.help()`** returns the guide: every method with its arguments and an example, the DOM you can read without JavaScript, the Live setup step by step, the two HIL modes, the protocol, safety, and what each message means. `loopTuner.help('text')` is the same as text, and it is the Help dialog's **For agents** section (the `?` key, `#help-agents`). **`loopTuner.api`** lists every method in one line. The source is `src/core/guide.js`; keep it in step with `window.loopTuner` (`test/hil-agent.test.mjs` checks that every method it names is defined and every id it names exists).
- **Driving it**: `loopTuner.systems()`, `loadSystem(name)`, `getProject()` / `setProject(p)`, `setGains(block, params)` (a Controller block's running variant; live, at the next sample, the controller keeping its state; a name the variant does not have throws and lists the ones it has), `setVariant(block, name)` (which variant runs; live, it starts afresh), `run()`, `stop()`, `single()` (while running: the sweep under way finishes, then it stops; each returns `{ ok, why, run, live }`, `why` saying why a key was refused), `autoScale()`, `speed(x?)` (returns `{ speed, effective, achieved, simulation, locked }`; Auto-tune runs at it, so `speed(-1)` tunes as fast as the page can), `selectCandidate(name)`, `autotune({ block, method, goal, rule, simc, amplitude, maxIter, feedforward, apply })`, which returns the same report as `node cli.mjs autotune --json` and, applied (the default), puts the result into the project as one undo step, `designs()` (what the designed variants computed), `whenDesigned()` and `loopModel(path, op)` (the loop a Controller closes, linearised at `'origin'`, `'initial'`, `{ y: [levels] }` or `{ t: seconds }`: `{ plant: { A, B, C, D, delay, … }, ctrl: { A, B, C, D }, Ts, opLabel, variantName, warnings }`, the models the Analysis tab draws, for margins and poles of your own). A plan (the planned swing-up) is made in the background after a load or an edit, and the block runs u = 0 or its previous plan until then: `await window.loopTuner.whenDesigned()` before judging a run.
- **Reading it**: `loopTuner.info()` (what the screen's last run reported: `{ validity, warnings, h, substeps, steps, bound, stiffness: { start, end }, ms }`; the status line under the screen shows the first warning, also in its `data-note`), `loopTuner.record.screen('csv')` (every signal on the screen), `.live('csv')` (the last minutes of live data), `.state()`; `await loopTuner.record.save('screen' | 'record', 'csv' | 'json' | 'png')` saves a file through the page's download path (anything else, and `png` of the record, is refused with an error); `await loopTuner.record.screenshot()` gives a PNG data URL; `.reference(text, name)` shows a saved trace dashed to compare runs. The last message the page showed stays in `#toast[data-last]` and `loopTuner.live.state().message` (a toast is gone after 3 s). Without JavaScript: `#lt-shell[data-run][data-live][data-hil-mode]`, the status line's `data-*`, `#live[data-state]`, `#live-status[data-state][data-rate][data-rtt][data-missed][data-late][data-reason]`, `#estop[data-state]`.
- **A live plant** (Live mode, [design/output/hil.md](design/output/hil.md)): `loopTuner.loadSystem('HIL: an external plant')` (or `'HIL with an agent'`, the same for working with the person through the MCP server; reference mode is `await loopTuner.live.setMode('reference')` while the plant is stopped; the plant is a black box: the page knows only the interface it describes, `live.state()` and the Plant tab's Interface, `#pl-iface`, show it); `await loopTuner.live.downloadPlant()` saves `hil-plant.zip` (`live.plantFiles()` has its files as text); someone at that computer unzips it and runs `sh runme.sh` (Linux, macOS) or double-clicks `runme.cmd` (Windows), or, from this repository, `node build.mjs` then `uv run --python-preference only-managed dist/hil-plant/hil_plant.py` (the plant runs the page's own core, `loop-tuner-core.js`, which the build puts beside it; `--mode reference` for the reference-mode system; `--model NAME` any library model, `--list` lists them, `--random` one at random; `--show-params` prints what it drew, for you, never for the page); its window says where it listens. Then `await loopTuner.live.connect(url?)`, which resolves once the plant has described itself, so `run()` can follow at once. Nothing runs by itself: `run()` starts the plant (`live.state().pending` is `"run"` until it has answered; the references ramp in first; `live.state().ramp` says how long is left), `stop()` stops it (always sent to a connected plant: the last key has the last word), `await live.estop()` latches an E-stop and `await live.reset()` clears it (both resolve to `live.state()` once the plant has answered; the plant then stays stopped until `run()`), `live.hold()` freezes the screen while it runs on, `live.state()` tells the connection, the mode, the plant's ports, the ramp-in, the link's figures and any E-stop and who latched it. A STOP pressed at the plant shows at once (`state().estop.by === 'plant'`) and only the plant resets it: `live.reset()` is refused, so ask whoever is at the plant to press Reset there. An output beyond the hard range the plant declares (`describe`'s `hard_min … hard_max`, kept in the block as `ymin`/`ymax`) E-stops it with a sentence such as "angle 2.6 rad beyond 2.5"; that one is reset from either side. When the plant echoes the inputs it applied, `record.live('csv')` has them as `applied.V`, … (one sample behind the page's `V`). Connecting a control-mode system to a plant started with `--mode reference` drops the wire into the input that changed; a Controller wired to a reference input is refused at Run, with why. A variant from the plant cannot be designed on a plant outside the page: it is refused, saying so, and puts out u = 0. Auto-tune and Analysis refuse such a plant and say why: they need an identified model of it (Identify, designed, not built); in reference mode the page's controllers are not in the loop at all. The plant is real time: never leave it running unattended in a state you have not checked, and use `estop()` when in doubt.
