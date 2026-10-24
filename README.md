# Loop Tuner

Reader: a person meeting Loop Tuner for the first time.

Tune a feedback loop's step response in the browser, side by side, like patches on a synthesizer. One HTML file, no install, no server: send it to someone and they can play with your loop. The same simulation runs in Node, so an agent can tune the loop too (see [AGENTS.md](AGENTS.md)).

## Use it

Open `dist/loop-tuner.html` in a browser. It is an oscilloscope for a control loop:

- **Display**: four channels on a 10 × 8 graticule, any of the system's named signals; the screen is the record, swept in real time. Wheel to zoom (over an axis: that axis only), drag to pan, click a trace to work on it alone, Shift-drag to zoom to a box.
- **Controls** to the right, as on a bench scope: Run/Stop, Single, Auto Scale; Horizontal and Vertical knobs whose readouts you can also type into.
- **Tabs** below set the loop up one step at a time:
  - **Input**: a signal generator that sums primitives (DC, step, ramp, square/pulse train, sine, chirp, noise, a typed formula y(t), or a waveform loaded from a CSV file) into named signals, repeated with their period, with a dashed preview before each one is added.
  - **Plant**: the system as a block diagram, Simulink-style: Source blocks play signals, Sink blocks (x, speed, …) are what the scope shows, blocks nest into subsystems. A plant can carry 2D views (simple shapes, or standard SVG bound to signals) that move with the simulation.
  - **Controller**: Controller blocks in the diagram hold interchangeable variants (PID, state feedback, gain-scheduled PI, energy swing-up); flip and tune them here. The run before stays faded on the display, for comparison.
  - The **System library** in the header holds complete systems, from a mass–spring–damper to a triple pendulum on a cart; load one whole, or only its input or plant.
  - Auto-tune and Analysis come next.

Projects are plain JSON, including how the display is set. Save, open, drop or paste them; **Export HTML** writes a copy of the page with the project inside, to send to someone. The built page carries no comments and no trace of where it was made (enforced by `test/provenance.test.mjs`). Where a hosting page offers a save adapter, saving goes through it; otherwise through a download link, and Copy JSON and Copy HTML remain.

The design, its decisions and what comes next are in [design/output](design/output/README.md); the person's original words are in [design/input](design/input/README.md).

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
| `src/core/signals.js` | The signal generator's primitives; a signal is their sum. |
| `src/core/diagram.js` | Block diagrams: blocks, subsystems, and the compiler that simulates them. |
| `src/core/plants.js`, `src/core/systems.js` | Example plants and the System library. |
| `src/core/views.js` | 2D views of a plant. |
| `src/core/blocks.js` | The block library (plant, controller, actuator, sensor, disturbance, noise): every type registers its slot, parameters and behaviour. |
| `src/core/sim.js` | The closed loop: a digital controller (sampled, zero-order hold) driving continuous actuator, plant and sensor models integrated with RK4; dead time, saturation and seeded measurement noise. |
| `src/core/metrics.js` | Step-response and effort metrics (`node cli.mjs metrics` lists them). |
| `src/core/goal.js` | Score and feasibility from the goal. |
| `src/core/tune.js` | Auto-tune: a seeded scan, then Nelder–Mead on the penalised score. |
| `src/core/project.js` | The project file: normalisation, evaluation, candidates. |
| `src/ui/` | The page: display, controls, dial, signal generator, app wiring. |
| `build.mjs` | Bundles core and UI into one HTML file. |
| `cli.mjs` | The command line, for agents and scripts. |

The core has no DOM code, so the browser and Node compute identical results.
