# Roadmap

Reader: whoever picks the next piece of work.

## Built

- Simulation core: blocks, closed-loop simulation, metrics, goal score, auto-tune (`src/core/`), with tests.
- Agent CLI (`cli.mjs`) and agent playbook (`AGENTS.md`).
- v2 instrument: display with axis labels and direct manipulation, Run Control, Horizontal, Vertical with editable readouts, Auto Scale, draggable separators ([instrument.md](instrument.md)).
- Tab 1, Input: the signal generator with named signals, Period, Square with count, Function formulas ([signal-generator.md](signal-generator.md)).
- Tab 2, Plant: block-diagram editor with Sources, Sinks, Terminator, Switch, subsystems, a resizable folding library, sensors and a cart–pole ([plant-editor.md](plant-editor.md)); 2D views in the plant's JSON ([plant-views.md](plant-views.md)).
- Tab 3, Controller: Controller blocks with variants (PID, state feedback, gain-scheduled PI, energy swing-up, relay, sliding mode, super-twisting, off), the tab to flip and tune them; the PID and the scheduled PI with reference feedforward (Kff, Kv, Ka) and switchable anti-windup; a small diagram of what the running variant does, for every type ([controller-proposal.md](controller-proposal.md)); Observer blocks (Kalman filter, Luenberger observer, by hand or with placed poles, finite differences).
- Designs computed in the page from the plant, nothing plant-specific stored ([designs.md](designs.md)): LQR, PI from the plant (pole cancellation at trim points, scheduled), a PID's feedforward from the plant's inverse, the swing-up's LQR catch, the triple pendulum's planned swing-up with time-varying LQR (made in the background, with progress), the Kalman filter, a Luenberger observer's placed poles; the Computed box and Copy as numbers; `node cli.mjs design`.
- Tab 4, Auto-tune: Nelder–Mead on a simulated cost (watched iteration by iteration), relay feedback with Ziegler–Nichols, Tyreus–Luyben and no-overshoot rules, step response with SIMC (plants that settle or integrate, read through ripple, a gain schedule tested point by point, Tight or Smooth); results as new variants, a worse one with the reason, one undo step; a variant from the plant tuned as its Copy as numbers twin; the Oven, badly tuned example; `node cli.mjs autotune` and `window.loopTuner.autotune()` for agents ([autotune.md](autotune.md)).
- Tab 5, Analysis: key numbers (stable, marginal or unstable; gain interval on both sides, phase and delay margins, Ms, Mt, poles, P/N/Z, the linear step with its DC-gain final value), root locus, Bode, Nyquist, step; discrete as simulated, dead time exact to a fraction of a sample; reviewed and fixed ([analysis.md](analysis.md)). Its models come from the design layer: snapshots of a run, the plant a block sees linearised at rest, a level, the start or a moment of the run (`linearizeBlock`), and the loop a Controller closes (`loopModel`, every law's linear model, `app.loopModel`); a law with no linear model there, or a plant outside the page, is named with its reason.
- The scope's XY mode with Δ (the error over the reference), its gestures, status and refit on a mode change ([instrument.md](instrument.md)).
- System library: ten 5-second systems, nine of them controlled (motor, following a sine, the motor in sliding mode, encoder errors with a shaft resonance, conical tank, pendulum swing-up, triple pendulum swinging up from hanging, the badly tuned oven, the HIL motor), with disturbances.
- No black boxes ([transparent-models.md](transparent-models.md), v2.9): the cart–pole, the pendulum chains and the conical tank are masked subsystems you can open; Mechanics parts (World, Rail, Hinge, Mass, Rod) joined at frame ports on the canvas, compiled to one state node per mechanism; the equations of motion in the parameters' names; old files open the old blocks as these.
- Earlier runs fade over five runs for comparison.
- Live (HIL) mode: an External plant block, a plant outside the page over WebSocket (JSON-RPC 2.0, 100 Hz, the plant sets the cycle and defines the signals), watchdogs and a latched E-stop on both sides (the header's E-STOP, the plant's window with its red STOP), Run and Stop through the plant and nothing running by itself, Single finishing the run, full scales and the ramp-in, both modes (control with r and e for the plant's log; reference, with its own library system), Hold, the Live controls in the Plant tab's panel, the loop in a Web Worker, live edits of every controller and observer parameter; `hil-plant.zip` (`hil_plant.py` with its window or console, `--mode`, `--plant`, `--vary`, `--log`, `--bench`; runme.sh, runme.cmd and runme.ps1, on uv's own Python); 200 Hz measured sound; the page's own guide for agents (`loopTuner.help()`), every key answering through the API; who latched an E-stop resets it ([hil.md](hil.md)).
- Speed in the header: simulated time at any factor (1× real time, 0.1× … ∞ as fast as possible), never faster than the page simulates the screen (∞ runs at that speed), saved with the project; the achieved speed measured beside it; Auto-tune runs at it, each run lasting its own length; held at 1× while a live plant is connected ([instrument.md](instrument.md#speed)).
- Saving traces: Save ▾ stores the screen with every signal (CSV, JSON) or as a picture (PNG); the live record keeps the last minutes of every live signal; saved traces open as dashed references, stepped through when longer than the screen ([instrument.md](instrument.md#save-the-live-record-and-references)).
- Spectrogram levels: a strip with the amplitudes' histogram and draggable levels (after pyqtgraph), automatic by default, per signal; and a colour switch, Absolute or Above noise (dB above the noise at each frequency) ([instrument.md](instrument.md)).
- (Superseded) System library: three systems that move, loaded whole or by part, opening running on their view ([system-library.md](system-library.md)).
- Units on every signal; scope channels list only names the diagram defines; projects carry how they open (`ui`).
- Sliding mode: the `slidingMode` (relay, boundary layer) and `superTwisting` controller types, the *DC motor, sliding mode* system (XY phase portrait), the motor rebuilt from Transfer function blocks with its current as a Sink, the scope's Measure readout, controllers sampling exactly at k·Ts, a library entry's own record step ([sliding-mode.md](../research/sliding-mode.md), [instrument.md](instrument.md#measure)).

## Next, in order

1. **Identify** (a tab between Controller and Auto-tune; designed in [identification.md](identification.md), research [../research/identification.md](../research/identification.md); being built on branch `feat/identify` in the steps of its §18): find the plant a Controller block sees by one eased-in experiment (Listen, Nudge, Hold, Ease in, Shake when needed, Check), fit small continuous-time models by replaying the closed loop, and let Auto-tune and Analysis use the model, so both work for HIL plants the page does not know (input 10). Its protocol step (hard output ranges and `applied`, §15) is built.
2. **Auto-tune, more**: the goal saved in the project; a robustness check against plant variations; flipping through a block's variants; AMIGO and Cohen–Coon rules, phase-margin placement from the relay's measured point; simulations in a Worker; tuning a designed variant's own inputs (Q, R, Tcl) rather than its twin's numbers.
3. **Controller, more**: variants built as diagrams (freeform), MIMO, more library entries (lead/lag, observer-based state feedback, MPC).
4. **Analysis, more**: the gain marker on the locus, the gang of four, Nichols, disk margins, and the root locus in a Worker for loops with long dead times ([analysis.md](analysis.md), "Not built yet"); an Observer's own dynamics in the loop (observer types need `linear`, [designs.md](designs.md)).
5. **The diagram lays itself out** ([diagram-layout.md](diagram-layout.md), designed, not built; the person's [input 11](../input/2026-10-25-11-diagram-auto-layout.md)). In its §12 steps:
   - vendor ELK (elkjs 0.12.0) with its manifest and licence notice;
   - the layout in `src/core/layout.js`: feedback found from the wires, the return path mirrored, ELK called synchronously, cached, re-measured on an idle machine;
   - the build's vendored section and the provenance and standalone tests;
   - the edits in core: insert on a wire, delete with joining, move, swap, branch, group, Ungroup;
   - x, y and flip dropped from the format and the library;
   - the Plant tab drawing the layout with a 200 ms glide;
   - the gestures (drop onto a wire, click to insert, Del joins, drag along a wire to branch, keyboard, Quick insert);
   - the narrow window and the Playwright checks.

   Coordinate with feat/design-system and feat/designs, which touch `src/ui/plant.js`.

6. **One Servo motor** ([servo.md](servo.md), designed, not built; the person's [input 18](../input/2026-10-25-18-servo-motor-detail.md)). In its §11 steps:
   - the minimal mask (numbers, toggles, a choice) and switches resolved at compile time;
   - built-in components stored by reference (`component`, `params`), opened read-only, Edit a copy into My blocks;
   - the DC motor examples, then the encoder example, on the component (free shaft);
   - the eigenvalue step bound (shared with detail-levels.md §5);
   - the coupled shaft with backlash, and the new **Gear backlash** example with its Dual loop fix ([input 23](../input/2026-10-25-23-servo-answers-backlash.md));
   - the PUMA's Motor drives on it (rotor inertia in the motors, Coulomb on), with or after robot.md's motors.

   Shares the mask with [transparent-models.md](transparent-models.md) and [detail-levels.md](detail-levels.md): whichever reaches it first builds it.

## Later

- Live, more ([hil.md](hil.md#not-yet)), from the person's words of 2026-10-24: signals the plant only logs (outputs that are not ports); an agent tuning a live loop through MCP ("could we also connect an agent to that web page"; simulated loops through MCP are built, [mcp.md](mcp.md), a live one is not); identifying the live plant, which varies by up to ±15 % and is not described to the page, so Auto-tune and Analysis work for HIL ([input 10](../input/2026-10-24-10-sliding-mode-and-triple-swingup.md)); then several External blocks, remote plants (wss://, a token), a trigger for live sweeps, binary frames above 200 Hz. Check `runme.cmd`, `runme.ps1` and the plant's timing on Windows (untested here; `--bench 30` before relying on 100 Hz).
- 3D views (URDF); MIMO; WebAssembly for the simulation core if a feature needs the speed (the person: fine, not required); system identification from measured data (Arb input + measured output); WebAssembly if a feature needs the speed.

- Sliding mode, later (research Recommendation 9): a model-based law (equivalent control) and implicit super-twisting as designed twins, now that the design layer is in; `s` as a controller signal on the scope; the Motor in Gain/Sum/Integrator form (the step bound that sees integrator loops is built, v2.8), and a **Product** primitive (copper loss, electrical and mechanical power as exact signals; the cart–pole rebuild needs it too); Levant's robust differentiator as an Observer; a spacecraft axis with on/off thrusters (phase-plane control with deadband and hysteresis) as a second example; "time at a limit" in the CLI's metrics.

## Plant editor, not yet

- Subsystem mask: subsystem parameters that set inner blocks' parameters (the person, 2026-10-24). Built (v2.8, model foundations): masks, formula parameters and the mask panel; editing the mask's own fields in the page ("Make this a parameter") is later.
- Copy and paste; multiple plant inputs and outputs; the disturbance as a Source at the plant input. (Ungroup is now part of [diagram-layout.md](diagram-layout.md).)
- After the layout ([diagram-layout.md](diagram-layout.md) §13):
  - vector wires for the triple pendulum's 8 state wires, with [robot.md](robot.md) §2;
  - best of several seeds or thoroughness 50, if the idle-machine timings allow;
  - the layout in a Worker, only if a level exceeds 100 ms;
  - a CLI command that draws a diagram.

## Open questions

- The Hu–Lin variable gain (v2.9, [research](../research/hu-lin.md)) is a designed variant beside LQR. For the person: offer it also as an option on LQR, or as a variant in other examples (the pendulums' catch: the ellipsoids hold for the linearised plant only, untested)? Add an integral state under the schedule (LQI), so a load leaves no offset?
- The triple pendulum's plan in a Web Worker? v2.7.1 set 10 s in the page as the point to revisit it; on a machine at a load of 10 to 15 (four cores) the plan took 7.6 to 12.1 s in the page (v2.7.4). Idle, 5 to 7 s.
- Super-twisting's k2 = 44 in *DC motor, sliding mode* is Levant's 1.1·L/β with the motor's β = Kt/(J·R) = 25 and a guessed L = 1000 rad/s³: a number derived from the plant, stored (the library review, v2.7.4). A designed super-twisting (L and the multipliers as inputs, β from the plant) needs the person's view on how to take β where the armature's inductance makes the relative degree 3 (β is the gain of ë in u only with L neglected), and on k1 = 4, raised by hand from the rule's 1.9.

- Header bar: move the file actions into a menu? (Person raised it, 2026-10-24; later: keep the header as it is for now, with the time control and E-STOP joining it.)
- Diagram layout ([diagram-layout.md](diagram-layout.md) §4, interpretations): should Del join a block's neighbours by default, with Shift+Del deleting without joining? Most tools make joining the variant. And is the main line the longest path to a Sink? In the mass–spring–damper that makes the spring energy the line's end and x a tap.
- Speed at ∞ on a plain sweep: answered by review (not by the person yet; decisions.md, time control after review). The screen's simulation is timed, ∞ runs at that speed and no setting runs faster, so ∞ reads the simulation's own speed, as Auto-tune's ∞ does. It still depends on the time per division, since the simulation takes 2000 steps for any screen: the oven reads 170–300× on a 5 s screen and 0.7× on a 10 ms one, the DC motor 5–9× on a 100 ms one, the encoder 32× and the triple pendulum 63× on 5 s screens (build container). Ask the person: is that the limit they meant, and should a finite speed above it replay the screen faster than it can be simulated (1× real time on a 10 ms screen) instead of being held to it?
- ~~Earlier runs at high speed~~: answered: no change (2026-10-25, [input 13](../input/2026-10-25-13-detail-levels-answers.md)). At a finite speed every sweep still fades the earlier runs; at ∞ only a changed run does. To compare (detail levels, or any edit), the person runs Single runs and compares the traces, which stay and fade over five runs. ("So we don't need to change anything about the system.")
- Selected in the light theme (design system, after review): a lit violet key differs from an unlit one by under 3:1 in brightness, less than WCAG asks for a state shown by colour; a darker violet would put the dark text on it below 4.5:1. A cue that is not colour would fix it: a small lamp mark on every lit key and row. Ask the person: add one, or is the violet fill enough?
- Auto Scale with a reaction signal: one period of the input, or until the response settles? (Person: "we will see later".)
- ~~Should the input repeat with its period?~~ Settled (2026-10-24): it repeats; no play-once mode.
- Candidates on the display: a channel per candidate, or one channel with overlaid candidates (like reference waveforms on a scope)?
- An accuracy step bound for every system: today's bound h ≤ 0.5/bound is a stability bound, and a switching law can lock into a different limit cycle at h = τ/2 (the relay at a 5 ms step: 24 against 42 mrad). The sliding-mode system avoids it by its own record step; tightening the bound everywhere changes other systems' runs slightly and needs its own check.
- ~~Spectrogram levels by default~~: answered (2026-10-24): the automatic floor stays the default, with a switch to dB above the local noise, built (decisions.md, instrument.md).

## Backlog, at the very end (the person, 2026-10-24)

- **Controller benchmark with a Pugh matrix and a report.** Once a plant is identified (and we trust the model), tune every controller type the library knows on it (PID with feedforward and anti-windup, state feedback/LQR, gain scheduling, sliding mode variants, …), score each against criteria (following, disturbance rejection, overshoot, robustness to the plant's ±15 % variation, effort and actuator wear, noise sensitivity, complexity) in a Pugh matrix against a datum (the PID), pick the best and produce a report. The person: "If we have nothing else … you can try to do that benchmark mode on your own." Input file 10.
- **Changes apply at the instant, and every controller switches in without a bump** ([input 37](../input/2026-10-25-37-changes-apply-while-running-bumpless.md); after the PUMA, "not important for now"). Today a change to the Controller during a run (another variant, or one value) restarts the screen's simulation from t = 0 with the new setting. The person wants it applied at that instant in the running sweep, the loop switching from one law to the other, and every law able to start step free, as industrial controllers do. Generic routes, to research when built:
  - *Incremental (velocity) form*, the person's idea: every law gives Δu and one integrator after the switch holds u. Exact for laws with integral action; a law without one (P, state feedback, LQR) keeps the offset of the switch for ever, so that offset has to fade.
  - *Tracking*: the laws not running follow the applied u, so the one switched in already agrees (back-calculation; Hanus's conditioning, 1987; Graebe and Ahlén's LQ bumpless transfer, 1996; Zaccarian and Teel, 2002, treat bumpless transfer and anti-windup as one problem).
  - *Initialise at the switch*: set the new law's state so its output equals the applied u (a PID's integrator, I = u − P − D; a state-space law, the smallest such state); what a law with no state cannot absorb is an offset that fades.
  - Proposed shape: one mechanism in the Controller block for every type (absorb what the law's state can, fade the rest), held by a test that u is continuous across any switch and any edit. It belongs after the overhaul, which makes the run engines one: a change mid-run lands there.
- **Detail levels** ([detail-levels.md](detail-levels.md), designed and answered): at the very end; "If we get everything else done, then we can add detail levels" (2026-10-25, input 14).

## Later, from the PUMA notes (2026-10-25, input 14)

- Views bind to visible Sinks; deleting a Sink that a view or a channel uses warns and names who uses it (replaces the hidden probes once the 3D view runs).
- Joint end stops for the robot, then an Off variant (without stops the arm would fall through itself).
- Revisit how the robot controller is modelled (diagram variants) once it runs.

