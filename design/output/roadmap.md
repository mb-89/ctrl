# Roadmap

Reader: whoever picks the next piece of work.

## Built

- Simulation core: blocks, closed-loop simulation, metrics, goal score, auto-tune (`src/core/`), with tests.
- Agent CLI (`cli.mjs`) and agent playbook (`AGENTS.md`).
- v2 instrument: display with axis labels and direct manipulation, Run Control, Horizontal, Vertical with editable readouts, Auto Scale, draggable separators ([instrument.md](instrument.md)).
- Tab 1, Input: the signal generator with named signals, Period, Square with count, Function formulas ([signal-generator.md](signal-generator.md)).
- Tab 2, Plant: block-diagram editor with Sources, Sinks, Terminator, Switch, subsystems, a resizable folding library, sensors and a cart–pole ([plant-editor.md](plant-editor.md)); 2D views in the plant's JSON ([plant-views.md](plant-views.md)).
- Tab 3, Controller: Controller blocks with variants (PID, state feedback, gain-scheduled PI, energy swing-up, off), the tab to flip and tune them ([controller-proposal.md](controller-proposal.md)); Observer blocks (Kalman filter, Luenberger observer, finite differences).
- Designs computed in the page from the plant, nothing plant-specific stored ([designs.md](designs.md)): LQR, PI from the plant (pole cancellation at trim points, scheduled), the swing-up's LQR catch, the triple pendulum's planned swing-up with time-varying LQR (made in the background, with progress), the Kalman filter; the Computed box and Copy as numbers; `node cli.mjs design`.
- The models for the Analysis tab: snapshots of a run, the plant a block sees linearised at rest, a level, the start or a moment of the run (`linearizeBlock`), and the loop a Controller closes (`loopModel`, every law's linear model).
- System library: six 5-second systems, five of them controlled (motor, encoder errors with a shaft resonance, conical tank, pendulum swing-up, triple pendulum swinging up from hanging), with disturbances.
- Earlier runs fade over five runs for comparison.
- (Superseded) System library: three systems that move, loaded whole or by part, opening running on their view ([system-library.md](system-library.md)).
- Units on every signal; scope channels list only names the diagram defines; projects carry how they open (`ui`).

## Next, in order

1. **Auto-tune tab**: goal editor (following r, rejecting d, effort, bounds), score, optimiser (v1's, reshaped) over a Controller block's parameters, flipping through its variants. Add robustness: check against plant variations.
2. **Controller, more**: variants built as diagrams (freeform), MIMO, more library entries (lead/lag, observer-based state feedback, MPC).
3. **Analysis tab**: root locus, Bode, Nyquist, pole-zero, computed step metrics. Its models are built (`loopModel`, [designs.md](designs.md)); still to do there: an Observer's own dynamics in the loop (observer types need `linear`).

## Later

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
