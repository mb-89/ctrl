# Loop Tuner

Reader: a person meeting Loop Tuner for the first time.

Tune a feedback loop's step response in the browser, side by side, like patches on a synthesizer. One HTML file, no install, no server: send it to someone and they can play with your loop. The same simulation runs in Node, so an agent can tune the loop too (see [AGENTS.md](AGENTS.md)).

## Use it

Open `dist/loop-tuner.html` in a browser. It is an oscilloscope for a control loop:

- **Display**: four channels on a 10 × 8 graticule, any of the system's named signals; the screen is the record, swept at the **Speed** set in the header (1× real time by default; any factor, or ∞ as fast as the page simulates it, with the speed achieved beside it; Auto-tune runs at it too, and a live plant holds it at 1×). Wheel to zoom (over an axis: that axis only), drag to pan, click a trace to work on it alone, Shift-drag to zoom to a box.
- **Controls** to the right, as on a bench scope: Run/Stop, Single, Auto Scale; Horizontal and Vertical knobs whose readouts you can also type into.
- **Save ▾**, under the screen, stores what the screen holds with every signal (CSV, JSON), as a screenshot (PNG, with the status line and channel badges) or copies the picture; **Open** shows a saved trace dashed behind the live ones.
- **Live (HIL)**: a system's plant can run outside the page, in real time. Load **HIL: an external plant**, press **Download the plant (zip)** in the Plant tab (or Export ▾ › HIL plant), unzip it and run `runme.sh` (Linux, macOS) or double-click `runme.cmd` (Windows), which install what they need and open the plant's window with a red STOP and the address it listens on; press **Connect**, then **Run**, and tune the controller while the plant runs at 100 Hz (200 Hz measured sound). The page knows only the plant's interface (its inputs and outputs, with units, full scales and hard ranges, shown in the Plant tab under Interface): what is inside is a black box, to be identified before tuning; the downloadable example happens to simulate a DC motor swinging an arm. Nothing runs by itself: the scope's Run and Stop start and stop the plant, the references ramp in first, every channel spans its signal's full scale. The red E-STOP in the header (key E), STOP at the plant, and ten silent cycles on either side are E-stops; who pressed STOP resets it. The Live settings' **Mode** switches the plant (while stopped) to run its own controller while the page sends r and records, for logging. **HIL with an agent** is the same with a plant drawn at random and an agent on the page through the MCP server, to identify and tune it together. The plant varies by up to 15 % at every start and does not say how: the page has to identify it. **Rec** keeps the last minutes of every live signal (5 min unless set). The protocol (JSON-RPC 2.0 over a WebSocket) is in [design/output/hil.md](design/output/hil.md), for plants of your own, in any language.
- **Tabs** below set the loop up one step at a time:
  - **Input**: a signal generator that sums primitives (DC, step, ramp, square/pulse train, sine, chirp, noise, a typed formula y(t), or a waveform loaded from a CSV file) into named signals, repeated with their period, with a dashed preview before each one is added.
  - **Plant**: the system as a block diagram, Simulink-style: Source blocks play signals, Sink blocks (x, speed, …) are what the scope shows, blocks nest into subsystems. A plant can carry 2D views (simple shapes, or standard SVG bound to signals) that move with the simulation.
  - **Controller**: Controller blocks in the diagram hold interchangeable variants, set by hand (PID with feedforward and anti-windup, state feedback, gain-scheduled PI, energy swing-up, relay, sliding mode) or computed in the page from the plant as it is wired (LQR, a PI from the plant, a swing-up with an LQR catch, a planned swing-up, a Kalman filter): nothing plant-specific is stored, and changing a mass changes the gains with it. Flip and tune them here; a small diagram shows what the running variant does. The run before stays faded on the display, for comparison.
  - The **System library** in the header holds complete systems, from a mass–spring–damper to a triple pendulum on a cart; load one whole, or only its input or plant.
  - **Auto-tune**: improves a Controller block's running variant by simulation (iterate with Nelder–Mead, relay feedback, step response with SIMC); the result is a new variant to compare.
  - **Analysis**: a Controller block's loop, linearised at rest, at the start or at the scope's time: stability, gain and phase margins, Ms, poles, root locus, Bode, Nyquist and the linear step, discrete as simulated. A law that is not linear there (a relay, a swing-up pumping energy) is named with the reason.

Projects are plain JSON, including how the display is set. Save, open, drop or paste them; the header's **Export ▾** has Save and Copy JSON, **Export HTML** (a copy of the page with the project inside, to send to someone), Copy HTML, and the downloads of the HIL plant and the MCP server. The built page carries no comments and no trace of where it was made (enforced by `test/provenance.test.mjs`). Where a hosting page offers a save adapter, saving goes through it; otherwise through a download link, and Copy JSON and Copy HTML remain.

The design, its decisions and what comes next are in [design/output](design/output/README.md); the person's original words are in [design/input](design/input/README.md).

## Use it from an agent (MCP)

**What an MCP server is**: it gives an AI agent tools. MCP, the Model Context Protocol, is how agent apps (MCP clients) start a program like `mcp.mjs` and call what it offers. This one runs Loop Tuner's core (Node 18+, stdio, no dependencies): an agent loads a system or a project file, runs it and reads the loop's numbers, auto-tunes, analyses, and saves the project or the page with it inside. It also serves the page at `http://127.0.0.1:8766/`. Open that page, and the agent works on the page you see (the **agentic mode**: you look at the same data, identify and tune together; the library's **HIL with an agent** is made for it).

**Connect an agent**: register the server once with your MCP client. After that, the client starts it by itself whenever the agent needs it.

- **Claude Code**: `claude mcp add loop-tuner -- node /path/to/mcp.mjs`
- **Claude Desktop**: Settings › Developer › Edit Config (`claude_desktop_config.json`):
  ```json
  { "mcpServers": { "loop-tuner": { "command": "node", "args": ["/path/to/mcp.mjs"] } } }
  ```
- **VS Code**: `.vscode/mcp.json`: `{ "servers": { "loop-tuner": { "type": "stdio", "command": "node", "args": ["/path/to/mcp.mjs"] } } }`
- **Cursor**: `~/.cursor/mcp.json`, as Claude Desktop's.
- **Any other client**: the command `node /path/to/mcp.mjs`, stdio transport.

`node mcp.mjs --help` prints the same, with the path filled in; so does the server on start (on stderr, since stdout is the protocol).

**Without this repository**: the page's **Export ▾ › MCP server** saves `loop-tuner-mcp.zip`. Click `runme` in it: it installs Node.js if it is missing, starts the server, opens the page and prints these lines with its folder's path. **What to ask**: "help me tune this system", "let's look at this identification together", "why does this loop ring?". The tools, example sessions and the limits are in [design/output/mcp.md](design/output/mcp.md); how to tune well is in [AGENTS.md](AGENTS.md).

## Build and test

Node 18 or later, no dependencies. (The plant script needs Python 3.9+ and the websockets package, which `uv run` installs; the tests run its physics with `python3` if it is there, and the whole protocol against it when websockets can be had, from python3 or uv's cache, and skip that otherwise.)

```
node build.mjs        # writes dist/loop-tuner.html (and dist/artifact.html, a page fragment)
npm test
node cli.mjs help
node tools/robot-demo.mjs --shots   # the PUMA 560 in the 3D view, following its circle: .harness/robot-demo.html and screenshots (needs Playwright)
node tools/view3d-shots.mjs         # the 3D view's own checks in headless Chromium: .harness/shots/
```

## How it works

| Where | What |
|---|---|
| `src/core/signals.js` | The signal generator's primitives; a signal is their sum. |
| `src/core/diagram.js` | Block diagrams: blocks, subsystems and their masks, and the compiler that simulates them (its step bound includes the Jacobian's largest eigenvalue). |
| `src/core/formula.js` | Formulas in parameters and in Equations blocks: parsed, folded and compiled to closures, no eval. |
| `src/core/plants.js`, `src/core/systems.js` | Example plants and the System library. |
| `src/core/views.js` | 2D views of a plant. |
| `src/core/xml.js`, `src/core/urdf.js`, `src/core/rbd.js`, `src/core/puma560.js` | Robots: URDF read into a model; kinematics, Jacobian, inverse and forward dynamics, the torque split; the PUMA 560's description and drives. |
| `src/ui/view3d.js`, `src/vendor/three/` | The 3D view (three.js, vendored and inlined, with a Canvas fallback). |
| `src/core/blocks.js` | The block library (plant, controller, actuator, sensor, disturbance, noise): every type registers its slot, parameters and behaviour. |
| `src/core/sim.js` | The closed loop: a digital controller (sampled, zero-order hold) driving continuous actuator, plant and sensor models integrated with RK4; dead time, saturation and seeded measurement noise. |
| `src/core/metrics.js` | Step-response and effort metrics (`node cli.mjs metrics` lists them). |
| `src/core/goal.js` | Score and feasibility from the goal. |
| `src/core/tune.js` | The v1 tuner for projects with candidates: a seeded scan, then Nelder–Mead on the penalised score. |
| `src/core/controllers.js`, `src/core/observers.js` | The Controller and Observer blocks' variants: hand laws (PID with feedforward and anti-windup, state feedback, gain-scheduled PI, swing-up, relay, sliding mode, super-twisting; Luenberger, finite differences) and the types designed from the plant; each law's linear model for the Analysis tab. |
| `src/core/linearize.js`, `src/core/design.js`, `src/core/planner.js` | The design layer: the plant a block sees, trimmed and linearised at an operating point (kinks refused); LQR, the PI from the plant, the swing-up's catch, the Kalman filter; the triple pendulum's swing-up plan and TV-LQR; the design store, which caches in memory only. Nothing plant-specific is stored ([design/output/designs.md](design/output/designs.md)). |
| `src/core/structure.js`, `src/ui/ctldiagram.js` | The picture of what the running variant does, for every controller type. |
| `src/core/autotune.js` | The Auto-tune tab's methods: Iterate (Nelder–Mead on a simulated cost), relay feedback with its rules, the step response with SIMC (also integrating plants and per point of a gain schedule). |
| `src/core/analysis.js` | The Analysis tab's numbers: the loop discretised at Ts, margins, Ms, poles, root locus, Bode, Nyquist, the linear step. |
| `src/core/project.js` | The project file: normalisation, evaluation, candidates; the loop a Controller closes (`loopModel`), for the Analysis tab. |
| `src/core/hil.js`, `src/core/live.js`, `src/core/ramp.js` | Live mode: the protocol, the External plant block, full scales, the ramp-in, watchdogs, the scope's keys through the plant, and the loop that steps the diagram against an external plant (in a Web Worker). |
| `src/core/guide.js` | The page's guide for agents: `window.loopTuner.help()`, `.api`, and the Help dialog's For agents. |
| `src/core/trace.js`, `src/ui/record.js` | Saving traces: the screen or the live record (a ring buffer of every live signal) as CSV, JSON or PNG, and back as references; where live and saved time lands on the screen. |
| `src/core/zip.js` | A stored zip, for the plant's download. |
| `hil/` | The external plant of the HIL systems: `hil_plant.py` (`uv run hil_plant.py`; a window with STOP, Run/Stop, Reset and where it listens, or a console; it simulates any library model with the page's own core, `loop-tuner-core.js`, in V8: `--model`, `--random`, `--list`, `--vary`, `--detail`, `--seed`, `--show-params`, `--dyno`, `--mode reference`, `--log`, `--bench`), `runme.sh`, `runme.cmd` (Windows: a double-click runs `runme.ps1`), `runme.ps1`, `README.md`; the page offers them with its own core as `hil-plant.zip`, and `node build.mjs` writes the same into `dist/hil-plant/`. |
| `src/core/hilsim.js` | The HIL simulator's core: a library system's plant as an external plant (its interface from the model, the seeded variation and effects, stepped on the page's grid), and the cut of the page's core for the zip ([design/output/hil-simulator.md](design/output/hil-simulator.md)). |
| `src/ui/` | The page: display, controls, dial, signal generator, app wiring. |
| `build.mjs` | Bundles core and UI into one HTML file. |
| `cli.mjs` | The command line, for agents and scripts. |
| `mcp.mjs`, `mcp/`, `tools/mcp-client.mjs` | The MCP server ([design/output/mcp.md](design/output/mcp.md)): the core's tools and the page's (it serves the page; `src/ui/bridge.js` connects a page it served back to it); `mcp/` the download's README and runme scripts; a small client that speaks to it (the tests' and the example session's). |
| `src/core/ops.js` | What `cli.mjs` and `mcp.mjs` both do with a project: read a file's text, put a project into a page, the library, run and measure, analyse, the designs, Auto-tune's options, a trace in brief. Pure, so the downloaded server runs it from the page's core. |

The core has no DOM code, so the browser and Node compute identical results.
