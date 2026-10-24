# Roadmap

Reader: whoever picks the next piece of work.

## Built

- Simulation core: blocks, closed-loop simulation, metrics, goal score, auto-tune (`src/core/`), with tests.
- Agent CLI (`cli.mjs`) and agent playbook (`AGENTS.md`).
- v2 instrument: display with axis labels and direct manipulation, Run Control, Horizontal, Vertical with editable readouts, Auto Scale, draggable separators ([instrument.md](instrument.md)).
- Tab 1, Input: the signal generator with named signals, Period, Square with count, Function formulas ([signal-generator.md](signal-generator.md)).
- Tab 2, Plant: block-diagram editor with Sources, Sinks, Terminator, Switch, subsystems, a resizable folding library, sensors and a cart–pole ([plant-editor.md](plant-editor.md)); 2D views in the plant's JSON ([plant-views.md](plant-views.md)).
- System library: three systems that move, loaded whole or by part, opening running on their view ([system-library.md](system-library.md)).
- Units on every signal; scope channels list only names the diagram defines; projects carry how they open (`ui`).

## Next, in order

1. **Controller tab**: as decided in [controller-proposal.md](controller-proposal.md): Controller block (2 inputs, own Ts, variants), double-click to the tab, candidates overlaid and stepped through like patches; then closed-loop systems in the library (pendulum balanced, MSD position control).
2. **Auto-tune tab**: goal editor, score, optimiser (v1's, reshaped). Add robustness: check a candidate against plant variations.
3. **Analysis tab**: root locus, Bode, Nyquist, pole-zero, computed step metrics.

## Later

- 3D views (URDF); a triple inverted pendulum; MIMO; system identification from measured data (Arb input + measured output); WebAssembly if a feature needs the speed.

## Plant editor, not yet

- Subsystem mask: subsystem parameters that set inner blocks' parameters (the person, 2026-10-24).
- Ungroup; copy and paste; multiple plant inputs and outputs; the disturbance as a Source at the plant input.

## Open questions

- Header bar: move the file actions into a menu? (Person raised it, 2026-10-24.)
- Sweep speed: real time is the rule for now; long windows (minutes) may want a faster mode.
- Auto Scale with a reaction signal: one period of the input, or until the response settles? (Person: "we will see later".)
- Should the input repeat with its period, or stop after one? Repeating is built; see decisions.md.
- Candidates on the display: a channel per candidate, or one channel with overlaid candidates (like reference waveforms on a scope)?
