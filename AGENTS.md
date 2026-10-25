# Tuning a loop as an agent

Reader: an agent asked to tune a control loop with Loop Tuner.

You work on a project file (`.json`, or an exported `.html` page with the project inside) through `node cli.mjs`. Everything you add with `--save` shows up as a candidate when a person opens the file, so leave the project better than you found it: good candidates with names that say what they are.

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
- `node cli.mjs blocks [slot]`: block types and their parameters with ranges; `node cli.mjs metrics`: what a goal can use.
- `node cli.mjs design <project> [--block <path>] [--json]`: what each running designed variant (LQR, PI from the plant, PID + feedforward from the plant, a swing-up with an LQR catch, a planned swing-up, a Kalman filter, a Luenberger observer with placed poles) computed from the plant, its warnings, or why it was refused; `node cli.mjs new --system "Triple pendulum" -o p.json` writes a System library entry as a project.
- **Designed variants hold inputs only** ([design/output/designs.md](design/output/designs.md)): tune them through their inputs (Q, R, the levels `at`, Tcl, T), never by writing K, kr, Kp, Ki, u0 or a model into them: a file that has those is refused. For numbers of your own, use a hand type (`stateFeedback`, `pid`, `gainScheduled`, `swingUp`, `luenberger`), as the page's Copy as numbers does.
- Project file: [design/output/project-format.md](design/output/project-format.md).
- In a browser: see **Through the browser** below.

## Through the browser

When all you have is a browser on the page (a browser tool, Playwright), the page documents itself:

- **Finding it**: every page says so where an agent looks first: the head's `<meta name="description">`, a line for screen readers at the top of the body (`#agent-note`), and the Help key's accessible name ("Help, and a guide for agents: loopTuner.help()").
- **`window.loopTuner.help()`** returns the guide: every method with its arguments and an example, the DOM you can read without JavaScript, the Live setup step by step, the two HIL modes, the protocol, safety, and what each message means. `loopTuner.help('text')` is the same as text, and it is the Help dialog's **For agents** section (the `?` key, `#help-agents`). **`loopTuner.api`** lists every method in one line. The source is `src/core/guide.js`; keep it in step with `window.loopTuner` (`test/hil-agent.test.mjs` checks that every method it names is defined and every id it names exists).
- **Driving it**: `loopTuner.systems()`, `loadSystem(name)`, `getProject()` / `setProject(p)`, `setGains(block, params)` (a Controller block's running variant; live, at the next sample, the controller keeping its state; a name the variant does not have throws and lists the ones it has), `setVariant(block, name)` (which variant runs; live, it starts afresh), `run()`, `stop()`, `single()` (while running: the sweep under way finishes, then it stops; each returns `{ ok, why, run, live }`, `why` saying why a key was refused), `autoScale()`, `speed(x?)` (returns `{ speed, effective, achieved, simulation, locked }`; Auto-tune runs at it, so `speed(-1)` tunes as fast as the page can), `selectCandidate(name)`, `autotune({ block, method, goal, rule, simc, amplitude, maxIter, feedforward, apply })`, which returns the same report as `node cli.mjs autotune --json` and, applied (the default), puts the result into the project as one undo step, `designs()` (what the designed variants computed), `whenDesigned()` and `loopModel(path, op)` (the loop a Controller closes, linearised at `'origin'`, `'initial'`, `{ y: [levels] }` or `{ t: seconds }`: `{ plant: { A, B, C, D, delay, … }, ctrl: { A, B, C, D }, Ts, opLabel, variantName, warnings }`, the models the Analysis tab draws, for margins and poles of your own). A plan (the planned swing-up) is made in the background after a load or an edit, and the block runs u = 0 or its previous plan until then: `await window.loopTuner.whenDesigned()` before judging a run.
- **Reading it**: `loopTuner.record.screen('csv')` (every signal on the screen), `.live('csv')` (the last minutes of live data), `.state()`; `await loopTuner.record.save('screen' | 'record', 'csv' | 'json' | 'png')` saves a file through the page's download path (anything else, and `png` of the record, is refused with an error); `await loopTuner.record.screenshot()` gives a PNG data URL; `.reference(text, name)` shows a saved trace dashed to compare runs. The last message the page showed stays in `#toast[data-last]` and `loopTuner.live.state().message` (a toast is gone after 3 s). Without JavaScript: `#lt-shell[data-run][data-live][data-hil-mode]`, the status line's `data-*`, `#live[data-state]`, `#live-status[data-state][data-rate][data-rtt][data-missed][data-late][data-reason]`, `#estop[data-state]`.
- **A live plant** (Live mode, [design/output/hil.md](design/output/hil.md)): `loopTuner.loadSystem('HIL: an external plant')` (or `'HIL: an external plant, reference mode'`; the plant is a black box: the page knows only the interface it describes, `live.state()` and the Plant tab's Interface, `#pl-iface`, show it); `await loopTuner.live.downloadPlant()` saves `hil-plant.zip` (`live.plantFiles()` has its files as text); someone at that computer unzips it and runs `sh runme.sh` (Linux, macOS) or double-clicks `runme.cmd` (Windows), or, from this repository, `node build.mjs` then `uv run --python-preference only-managed dist/hil-plant/hil_plant.py` (the plant runs the page's own core, `loop-tuner-core.js`, which the build puts beside it; `--mode reference` for the reference-mode system; `--model NAME` any library model, `--list` lists them, `--random` one at random; `--show-params` prints what it drew, for you, never for the page); its window says where it listens. Then `await loopTuner.live.connect(url?)`, which resolves once the plant has described itself, so `run()` can follow at once. Nothing runs by itself: `run()` starts the plant (`live.state().pending` is `"run"` until it has answered; the references ramp in first; `live.state().ramp` says how long is left), `stop()` stops it (always sent to a connected plant: the last key has the last word), `await live.estop()` latches an E-stop and `await live.reset()` clears it (both resolve to `live.state()` once the plant has answered; the plant then stays stopped until `run()`), `live.hold()` freezes the screen while it runs on, `live.state()` tells the connection, the mode, the plant's ports, the ramp-in, the link's figures and any E-stop and who latched it. A STOP pressed at the plant shows at once (`state().estop.by === 'plant'`) and only the plant resets it: `live.reset()` is refused, so ask whoever is at the plant to press Reset there. An output beyond the hard range the plant declares (`describe`'s `hard_min … hard_max`, kept in the block as `ymin`/`ymax`) E-stops it with a sentence such as "angle 2.6 rad beyond 2.5"; that one is reset from either side. When the plant echoes the inputs it applied, `record.live('csv')` has them as `applied.V`, … (one sample behind the page's `V`). Connecting a control-mode system to a plant started with `--mode reference` drops the wire into the input that changed; a Controller wired to a reference input is refused at Run, with why. A variant from the plant cannot be designed on a plant outside the page: it is refused, saying so, and puts out u = 0. Auto-tune and Analysis refuse such a plant and say why: they need an identified model of it (Identify, designed, not built); in reference mode the page's controllers are not in the loop at all. The plant is real time: never leave it running unattended in a state you have not checked, and use `estop()` when in doubt.
