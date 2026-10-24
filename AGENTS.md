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
- `node cli.mjs design <project> [--block <path>] [--json]`: what each running designed variant (LQR, PI from the plant, a planned swing-up) computed from the plant, its warnings, or why it was refused; `node cli.mjs new --system "Triple pendulum" -o p.json` writes a System library entry as a project.
- Project file: [design/output/project-format.md](design/output/project-format.md).
- In a browser (for example through Playwright), the page exposes `window.loopTuner`: `getProject()`, `setProject(p)`, `addComponent(c)`, `reference()`, `autoScale()`, `run()`, `stop()`, `selectCandidate(name)`.
