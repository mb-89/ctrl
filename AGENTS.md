# Tuning a loop as an agent

Reader: an agent asked to tune a control loop with Loop Tuner.

You work on a project file (`.json`, or an exported `.html` page with the project inside) through `node cli.mjs`. Everything you add with `--save` shows up as a candidate when a person opens the file, so leave the project better than you found it: good candidates with names that say what they are.

## The loop

0. **Check the loop exists.** A new project is a reference signal and a plant diagram with just a Source (`node cli.mjs signal p.json [--name r]` lists a signal; `--add <type> --set k=v --save` adds a component). The plant is a block diagram in `system.plant` (see [design/output/plant-editor.md](design/output/plant-editor.md)). Tuning needs a plant with In and Out blocks and controller candidates; until the Controller tab exists, write them into the JSON, or start from `node cli.mjs new --example 0`.
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

Projects whose plant is a block diagram with a **Controller block** (every controlled system in the page's System library) are tuned with `autotune`, the same core as the page's Auto-tune tab ([design/output/autotune.md](design/output/autotune.md)):

```
node cli.mjs autotune p.json                                   # Nelder–Mead on IAE + effort + overshoot beyond 10 %
node cli.mjs autotune p.json --method relay --rule tl          # relay experiment: Ku, Pu, then Tyreus–Luyben
node cli.mjs autotune p.json --method step                     # open-loop step, model fit (settling or integrating), SIMC
node cli.mjs autotune p.json --method step --simc smooth       # the same with τc = 3θ: slower, gentler on u
node cli.mjs autotune p.json --cost ITAE --overshoot 5 --save  # another goal; keep the result
node cli.mjs autotune p.json --ff                              # also tune the feedforward gains that are 0
```

It prints the running variant and the result side by side (cost, overshoot, gains) and, for the experiments, what they measured. `--save` puts the result into the block as a variant of its own, "<name> · auto-tuned" (or "· relay T–L", "· SIMC"), and makes it run only if it scores better; the original stays, so the person can flip between them in the Controller tab. `--block motor/ctrl` picks a block by its id path when there are several; `--json` gives the full report. When a method cannot run it says why (a swing-up has no r − y to tune; the relay and step tests need one measurement). The step test fits a plant that settles (K, τ, θ) or one that integrates (k′, τ2, θ: a motor's angle, a tank's level without outflow) and, for a gain-scheduled PI, every point of its table; its notes say how it ended, any ripple, and when the step was made smaller. A result that scores worse than the running variant says why (`worse` in `--json`). Compare methods: the optimiser knows the goal and usually wins on it; a rule gives a sound loop in one experiment.

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
- Project file: [design/output/project-format.md](design/output/project-format.md).
- In a browser (for example through Playwright or a browser tool), the page exposes `window.loopTuner`: `getProject()`, `setProject(p)`, `addComponent(c)`, `reference()`, `autoScale()`, `run()`, `stop()`, `single()`, `selectCandidate(name)`, and `autotune({ block, method, goal, rule, simc, amplitude, maxIter, feedforward, apply })`, which returns the same report as `node cli.mjs autotune --json` and, applied (the default), puts the result into the project as one undo step. The page's Help (?) lists the same under For agents.
- **A live plant** (Live mode, [design/output/hil.md](design/output/hil.md)): load "HIL: external motor" (or any system with an External plant block), have the person start the plant (`hil-plant.zip` from Run Control's plant script…, or `uv run hil/hil_plant.py`), then `loopTuner.live.connect(url?)`; `run()` and `stop()` start and stop the plant, `loopTuner.live.estop()` and `.reset()` stop it and go on, `loopTuner.live.state()` tells the connection, the plant's ports and the link's figures. Tune it live by changing a variant's parameters through `getProject()` / `setProject(p)`: they take effect at the next sample and the controller keeps its state. Auto-tune refuses such a plant: every method simulates the loop, and the page has no model of a plant outside it yet. Read what happened with `loopTuner.record.screen('csv')` (every signal on the screen) or `loopTuner.record.live('csv')` (the last minutes of live data), and compare runs by loading a saved trace with `loopTuner.record.reference(text, name)`. The plant is real time: never leave it running unattended in a state you have not checked, and use `estop()` when in doubt.
