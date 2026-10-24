# Roadmap

Reader: whoever picks the next piece of work.

## Built

- Simulation core: blocks, closed-loop simulation, metrics, goal score, auto-tune (`src/core/`), with tests.
- Agent CLI (`cli.mjs`) and agent playbook (`AGENTS.md`).
- v2 instrument: display with axis labels and direct manipulation, Run Control, Horizontal, Vertical with editable readouts, Auto Scale, draggable separators ([instrument.md](instrument.md)).
- Tab 1, Input: the signal generator with named signals, Period, Square with count, Function formulas ([signal-generator.md](signal-generator.md)).
- Tab 2, Plant: block-diagram editor with Sources, Sinks, Terminator, Switch, subsystems, a resizable folding library, sensors and a cart–pole ([plant-editor.md](plant-editor.md)); 2D views in the plant's JSON ([plant-views.md](plant-views.md)).
- Tab 3, Controller: Controller blocks with variants (PID, state feedback, gain-scheduled PI, energy swing-up, off), the tab to flip and tune them ([controller-proposal.md](controller-proposal.md)).
- System library: five 5-second systems, four of them controlled (motor, conical tank, pendulum swing-up, triple pendulum), with disturbances.
- Earlier runs fade over five runs for comparison.
- Live (HIL) mode: an External plant block, a plant outside the page over WebSocket (JSON-RPC 2.0, 100 Hz, the plant sets the cycle and defines the signals), watchdogs and a latched E-stop on both sides (the page's E-STOP key, the plant's stop key), Run and Stop through the plant, the loop in a Web Worker, live edits of every controller and observer parameter; `hil-plant.zip` (`hil_plant.py` with runme.sh and runme.ps1) and the "HIL: external motor" system; `window.loopTuner.live` for agents ([hil.md](hil.md)).
- Saving traces: Save ▾ stores the screen with every signal (CSV, JSON) or as a picture (PNG); the live record keeps the last minutes of every live signal; saved traces open as dashed references, stepped through when longer than the screen ([instrument.md](instrument.md#save-the-live-record-and-references)).
- (Superseded) System library: three systems that move, loaded whole or by part, opening running on their view ([system-library.md](system-library.md)).
- Units on every signal; scope channels list only names the diagram defines; projects carry how they open (`ui`).

## Next, in order

1. **Auto-tune tab**: goal editor (following r, rejecting d, effort, bounds), score, optimiser (v1's, reshaped) over a Controller block's parameters, flipping through its variants. Add robustness: check against plant variations.
2. **Controller, more**: variants built as diagrams (freeform), MIMO, more library entries (lead/lag, observer-based state feedback, MPC).
3. **Analysis tab**: root locus, Bode, Nyquist, pole-zero, computed step metrics.

## Later

- Live, more ([hil.md](hil.md#not-yet)), from the person's words of 2026-10-24: a plant that runs its own loop and takes the reference r from the page ("we could also be sending the reference value"); signals the plant only logs ("use our page here just to log stuff"); an agent tuning a live loop through MCP ("could we also connect an agent to that web page"); then several External blocks, remote plants (wss://, a token), a trigger for live sweeps, a plant recording on its own side. Check `runme.ps1` and the plant's timing on Windows (untested here).
- 3D views (URDF); MIMO; WebAssembly for the simulation core if a feature needs the speed (the person: fine, not required); system identification from measured data (Arb input + measured output); WebAssembly if a feature needs the speed.

## Plant editor, not yet

- Subsystem mask: subsystem parameters that set inner blocks' parameters (the person, 2026-10-24).
- Ungroup; copy and paste; multiple plant inputs and outputs; the disturbance as a Source at the plant input.

## Open questions

- Header bar: move the file actions into a menu? (Person raised it, 2026-10-24.)
- Sweep speed: real time is the rule for now; long windows (minutes) may want a faster mode.
- Auto Scale with a reaction signal: one period of the input, or until the response settles? (Person: "we will see later".)
- Should the input repeat with its period, or stop after one? Repeating is built; see decisions.md.
- Candidates on the display: a channel per candidate, or one channel with overlaid candidates (like reference waveforms on a scope)?
