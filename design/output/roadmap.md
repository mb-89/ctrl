# Roadmap

Reader: whoever picks the next piece of work.

## Built

- Simulation core: blocks, closed-loop simulation, metrics, goal score, auto-tune (`src/core/`), with tests.
- Agent CLI (`cli.mjs`) and agent playbook (`AGENTS.md`).
- v2 instrument: display with axis labels and direct manipulation, Run Control, Horizontal, Vertical with editable readouts, Auto Scale, draggable separators ([instrument.md](instrument.md)).
- Tab 1, Input: the signal generator with named signals, Period, Square with count, Function formulas ([signal-generator.md](signal-generator.md)).
- Tab 2, Plant: block-diagram editor with Sources, Sinks, Terminator, Switch, subsystems, a resizable folding library, sensors and a cart–pole ([plant-editor.md](plant-editor.md)); 2D views in the plant's JSON ([plant-views.md](plant-views.md)).
- Tab 3, Controller: Controller blocks with variants (PID, state feedback, gain-scheduled PI, energy swing-up, relay, off), the tab to flip and tune them; the PID and the scheduled PI with reference feedforward (Kff, Kv, Ka) and switchable anti-windup; a small diagram of what the running variant does ([controller-proposal.md](controller-proposal.md)).
- Tab 4, Auto-tune: Nelder–Mead on a simulated cost (watched iteration by iteration), relay feedback with Ziegler–Nichols, Tyreus–Luyben and no-overshoot rules, step response with SIMC; results as new variants, one undo step; the Oven, badly tuned example; `node cli.mjs autotune` and `window.loopTuner.autotune()` for agents ([autotune.md](autotune.md)).
- System library: eight 5-second systems, seven of them controlled (motor, following a sine, encoder, conical tank, pendulum swing-up, triple pendulum, the badly tuned oven), with disturbances.
- Earlier runs fade over five runs for comparison.
- (Superseded) System library: three systems that move, loaded whole or by part, opening running on their view ([system-library.md](system-library.md)).
- Units on every signal; scope channels list only names the diagram defines; projects carry how they open (`ui`).

## Next, in order

1. **Auto-tune, more**: the goal saved in the project; a robustness check against plant variations; flipping through a block's variants; AMIGO and Cohen–Coon rules, phase-margin placement from the relay's measured point; simulations in a Worker.
2. **Controller, more**: variants built as diagrams (freeform), MIMO, more library entries (lead/lag, observer-based state feedback, MPC).
3. **Analysis tab**: root locus, Bode, Nyquist, pole-zero, computed step metrics.

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
