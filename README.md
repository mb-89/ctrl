# Loop Tuner

Reader: a person meeting Loop Tuner for the first time.

Tune a feedback loop's step response in the browser, side by side, like patches on a synthesizer. One HTML file, no install, no server: send it to someone and they can play with your loop. The same simulation runs in Node, so an agent can tune the loop too (see [AGENTS.md](AGENTS.md)).

## Use it

Open `dist/loop-tuner.html` in a browser. It starts with Åström's third-order test process and four textbook controllers.

- **Scope**: output `y` over the reference `r`, and the control effort `u` below. Every checked candidate is overlaid in its own colour, and the scan line sweeps the selected one. Hatched areas are the goal's limits. Hover to read values; click a trace to select it.
- **Goal**: minimize a metric (ITAE, settling time, effort variation…) subject to bounds on others. Each candidate gets one score; ✓ means it meets every bound, and the best feasible one is marked BEST.
- **Candidates**: one controller per row. Step through them with ↑/↓, press N to duplicate one, then turn its knobs. Press T to auto-tune.
- **Rack**: the block diagram, then one module per block. The controller module edits the selected candidate; the other blocks (reference, actuator, disturbance, plant, sensor, noise) are shared, so changing the plant shows how every candidate copes. Each block's type can be swapped (P → PI → PID, ideal sensor → lag + dead time), and switching back restores the old parameters.

Projects are plain JSON. Save, open, drop or paste them; **Export HTML** writes a copy of the page with the project inside.

## Build and test

Node 18 or later, no dependencies.

```
node build.mjs        # writes dist/loop-tuner.html (and dist/artifact.html, a page fragment)
npm test
node cli.mjs help
```

## How it works

| Where | What |
|---|---|
| `src/core/blocks.js` | The block library: every block type registers its slot, parameters and behaviour. Add a block here and it appears in the UI, the CLI and the tuner. |
| `src/core/sim.js` | The closed loop: a digital controller (sampled, zero-order hold) driving continuous actuator, plant and sensor models integrated with RK4; dead time, saturation and seeded measurement noise. |
| `src/core/metrics.js` | Step-response and effort metrics (`node cli.mjs metrics` lists them). |
| `src/core/goal.js` | Score and feasibility from the goal. |
| `src/core/tune.js` | Auto-tune: a seeded scan, then Nelder–Mead on the penalised score. |
| `src/core/project.js` | The project file: normalisation, evaluation, candidates. |
| `src/ui/` | The page: knobs, scope, rack, candidate table, app wiring. |
| `build.mjs` | Bundles core and UI into one HTML file. |
| `cli.mjs` | The command line, for agents and scripts. |

The core has no DOM code, so the browser and Node compute identical results.
