# Roadmap

Reader: whoever picks the next piece of work.

## Built

- Simulation core: blocks, closed-loop simulation, metrics, goal score, auto-tune (`src/core/`), with tests.
- Agent CLI (`cli.mjs`) and agent playbook (`AGENTS.md`).
- v2 instrument: display with axis labels and direct manipulation, Run Control, Horizontal, Vertical with editable readouts, Auto Scale, draggable separators ([instrument.md](instrument.md)).
- Tab 1, Input: the signal generator with named signals, Period, Square with count, Function formulas ([signal-generator.md](signal-generator.md)).
- Tab 2, Plant: block-diagram editor with Sources, Sinks, Terminator, Switch, subsystems, a resizable folding library, sensors and a cart–pole ([plant-editor.md](plant-editor.md)); 2D views in the plant's JSON ([plant-views.md](plant-views.md)).
- Tab 3, Controller: Controller blocks with variants (PID, state feedback, gain-scheduled PI, energy swing-up, relay, off), the tab to flip and tune them; the PID and the scheduled PI with reference feedforward (Kff, Kv, Ka) and switchable anti-windup; a small diagram of what the running variant does ([controller-proposal.md](controller-proposal.md)).
- Tab 4, Auto-tune: Nelder–Mead on a simulated cost (watched iteration by iteration), relay feedback with Ziegler–Nichols, Tyreus–Luyben and no-overshoot rules, step response with SIMC (plants that settle or integrate, read through ripple, a gain schedule tested point by point, Tight or Smooth); results as new variants, a worse one with the reason, one undo step; the Oven, badly tuned example; `node cli.mjs autotune` and `window.loopTuner.autotune()` for agents ([autotune.md](autotune.md)).
- Tab 5, Analysis: key numbers (stable, marginal or unstable; gain interval on both sides, phase and delay margins, Ms, Mt, poles, P/N/Z, the linear step with its DC-gain final value), root locus, Bode, Nyquist, step; discrete as simulated, dead time exact to a fraction of a sample; reviewed and fixed ([analysis.md](analysis.md)). It waits for the design layer's plant model (`app.loopModel`, branch `feat/designs`) and says so until then.
- The scope's XY mode with Δ (the error over the reference), its gestures, status and refit on a mode change ([instrument.md](instrument.md)).
- System library: eight 5-second systems, seven of them controlled (motor, following a sine, encoder, conical tank, pendulum swing-up, triple pendulum, the badly tuned oven), with disturbances.
- Earlier runs fade over five runs for comparison.
- Live (HIL) mode: an External plant block, a plant outside the page over WebSocket (JSON-RPC 2.0, 100 Hz, the plant sets the cycle and defines the signals), watchdogs and a latched E-stop on both sides (the page's E-STOP key, the plant's stop key), Run and Stop through the plant, the loop in a Web Worker, live edits of every controller and observer parameter; `hil-plant.zip` (`hil_plant.py` with runme.sh and runme.ps1) and the "HIL: external motor" system; `window.loopTuner.live` for agents ([hil.md](hil.md)).
- Speed in the header: simulated time at any factor (1× real time, 0.1× … ∞ as fast as possible), never faster than the page simulates the screen (∞ runs at that speed), saved with the project; the achieved speed measured beside it; Auto-tune runs at it, each run lasting its own length; held at 1× while a live plant is connected ([instrument.md](instrument.md#speed)).
- Saving traces: Save ▾ stores the screen with every signal (CSV, JSON) or as a picture (PNG); the live record keeps the last minutes of every live signal; saved traces open as dashed references, stepped through when longer than the screen ([instrument.md](instrument.md#save-the-live-record-and-references)).
- (Superseded) System library: three systems that move, loaded whole or by part, opening running on their view ([system-library.md](system-library.md)).
- Units on every signal; scope channels list only names the diagram defines; projects carry how they open (`ui`).

## Next, in order

1. **Auto-tune, more**: the goal saved in the project; a robustness check against plant variations; flipping through a block's variants; AMIGO and Cohen–Coon rules, phase-margin placement from the relay's measured point; simulations in a Worker.
2. **Controller, more**: variants built as diagrams (freeform), MIMO, more library entries (lead/lag, observer-based state feedback, MPC).
3. **Analysis, wired**: merge the design layer so `app.loopModel` gives the tab its plant; then the gain marker on the locus, the gang of four, Nichols, disk margins, and the root locus in a Worker for loops with long dead times ([analysis.md](analysis.md), "Not built yet").

## Later

- Live, more ([hil.md](hil.md#not-yet)), from the person's words of 2026-10-24: a plant that runs its own loop and takes the reference r from the page ("we could also be sending the reference value"); signals the plant only logs ("use our page here just to log stuff"); an agent tuning a live loop through MCP ("could we also connect an agent to that web page"); identifying the live plant, which varies by up to ±15 % and is not described to the page, so Auto-tune and Analysis work for HIL ([input 10](../input/2026-10-24-10-sliding-mode-and-triple-swingup.md)); then several External blocks, remote plants (wss://, a token), a trigger for live sweeps, a plant recording on its own side. Check `runme.ps1` and the plant's timing on Windows (untested here).
- 3D views (URDF); MIMO; WebAssembly for the simulation core if a feature needs the speed (the person: fine, not required); system identification from measured data (Arb input + measured output); WebAssembly if a feature needs the speed.

## Plant editor, not yet

- Subsystem mask: subsystem parameters that set inner blocks' parameters (the person, 2026-10-24).
- Ungroup; copy and paste; multiple plant inputs and outputs; the disturbance as a Source at the plant input.

## Open questions

- Header bar: move the file actions into a menu? (Person raised it, 2026-10-24; later: keep the header as it is for now, with the time control and E-STOP joining it.)
- Speed at ∞ on a plain sweep: answered by review (not by the person yet; decisions.md, time control after review). The screen's simulation is timed, ∞ runs at that speed and no setting runs faster, so ∞ reads the simulation's own speed, as Auto-tune's ∞ does. It still depends on the time per division, since the simulation takes 2000 steps for any screen: the oven reads 170–300× on a 5 s screen and 0.7× on a 10 ms one, the DC motor 5–9× on a 100 ms one, the encoder 32× and the triple pendulum 63× on 5 s screens (build container). Ask the person: is that the limit they meant, and should a finite speed above it replay the screen faster than it can be simulated (1× real time on a 10 ms screen) instead of being held to it?
- Earlier runs at high speed: at ∞ only a changed run fades the others; at 100× on a 5 s screen the run before an edit is gone in about 0.2 s. Count only changed runs at every speed (then at 1× an old run stays until the next edit), or fade by time? Ask the person.
- Auto Scale with a reaction signal: one period of the input, or until the response settles? (Person: "we will see later".)
- ~~Should the input repeat with its period?~~ Settled (2026-10-24): it repeats; no play-once mode.
- Candidates on the display: a channel per candidate, or one channel with overlaid candidates (like reference waveforms on a scope)?
- ~~Spectrogram levels by default~~: answered (2026-10-24): the automatic floor stays the default, with a switch to dB above the local noise (decisions.md).

## Backlog, at the very end (the person, 2026-10-24)

- **Controller benchmark with a Pugh matrix and a report.** Once a plant is identified (and we trust the model), tune every controller type the library knows on it (PID with feedforward and anti-windup, state feedback/LQR, gain scheduling, sliding mode variants, …), score each against criteria (following, disturbance rejection, overshoot, robustness to the plant's ±15 % variation, effort and actuator wear, noise sensitivity, complexity) in a Pugh matrix against a datum (the PID), pick the best and produce a report. The person: "If we have nothing else … you can try to do that benchmark mode on your own." Input file 10.
