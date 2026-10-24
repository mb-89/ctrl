# Decisions

Reader: anyone who wants to know why something is the way it is. Newest first. "Interpretation" marks a choice we made where the person's words left it open; ask the person before reversing one silently.

## 2026-10-24 · v2.7 ([input](../input/2026-10-24-09-analysis-autotune-triple-swingup.md))

- **The spectrogram has a levels strip, after pyqtgraph's HistogramLUTItem** ([input](../input/2026-10-24-10-sliding-mode-and-triple-swingup.md), [instrument.md](instrument.md)). (Person: "a histogram of the amplitudes where you can select the cutoff. I mean, so see how PyQt graph does it, where I can select which amplitudes I want to show, because I feel like the amplitudes we see in the spectrogram are not clear enough because there's too much noise. And if we could like cut off lower amplitudes, then we would reduce that noise. I just wonder where we put that, but yeah, figure it out.") A histogram of the amplitudes shown, in dB, beside the colour bar, with a floor (below it black) and a ceiling (above it the brightest colour) to drag; the wheel moves the floor, Shift + wheel the ceiling, a double-click returns to automatic levels. Interpretations: **where**: at the right edge of the screen, right of the time trace's second axis, so that axis stays beside the plot it labels and the strip keeps its own dB scale; the colour bar is drawn on the histogram's dB scale (each bar beside the colour it gets) instead of pyqtgraph's full-height gradient with lines to the region, which needs more width; counts are linear, as in pyqtgraph. **Automatic levels by default**, unlike pyqtgraph's (the minimum to the maximum, which keeps all the noise): the ceiling at the largest amplitude, the floor 10 dB above the median of the shown bins, 20 to 80 dB below the ceiling. On the encoder example the speckle between the lines turns black and 1×, 2×, the resonance and 6× up to 100 Hz stay; the noise there is coloured, so the 6× line's fold-back at the Nyquist frequency, weaker than the low-frequency noise, needs the floor dragged down to about −60 dB (the notes say so). The levels are saved in the scope view (`scope.view.levels`). **The FFT keeps its range**: its amplitudes are heights, and its noise level per bin depends on the record length, so the same dB levels would not mean the same thing there.
- **The physics is never wrong; a controller may be.** (Person: "The control loops can be stupid, but the physics can't be wrong.") Each physics block is held by tests to conservation laws and textbook results (`test/physics.test.mjs`). A picture draws the state as it is: no clamped positions, so it never shows what the model does not do. Found by the person: the pendulum on "State feedback only" (designed for upright, started hanging) saturates and accelerates the cart at 20 m/s², and the picture pinned the cart at the rail's end while the pole trailed at 64°, which looked impossible. The model was right; the picture lied.
- **A runaway cart leaves the picture.** (Person: "having the car just shooting into the distance is kind of funny… we can leave it in.") The rail is drawn without end, as the model has none. Interpretation: no end stops in the model.
- **The conical tank overflows at its height H** and reports a level inside the tank. Interpretation: before, the model kept filling above H while the picture showed a full tank.
- **The System library filters by tag.** (Person: "show all available tags. And if we click on it, we filter for them.") Interpretation: several chosen tags narrow the list (a system must carry all of them); the filter lasts while the page is open.
- **The X–Y plot is a scope mode, XY, with a Δ key**, not a diagram in the Analysis tab. (Person: "the x-axis is the reference value and the y-axis is the delta … ideally a line … usually an ellipse".) Interpretation, after the research: a bench scope has XY; it needs no linear model, so it works for nonlinear plants, swing-ups and the external plant. Δ applies only to channels in channel 1's unit. A new example, *Following a sine (XY)*, shows the ellipse closing to a line.
- **Tags: style by what a tag is about, tone by value.** (Person: "values that are different should show up different at first glance".) Linear and Nonlinear take opposite poles (blue, red, filled); *No controller* is an empty dashed chip; controllers a coloured bar, observers an outline, features a dot. Interpretation: an eight-slot validated palette cannot give eighteen values eighteen hues, so the chip's style carries the dimension.
- **Auto-tune tab built** ([autotune.md](autotune.md)): it improves a Controller block's running variant by simulation, with three researched strategies: **Iterate** (Nelder–Mead on a cost, watched iteration by iteration), **Relay** (Åström–Hägglund: Ku, Pu, then Ziegler–Nichols, Tyreus–Luyben or "no overshoot") and **Step response** (FOPDT fit, SIMC). (Person: "research what common auto-tuning strategies are and put them in there"; the choice of three is ours, interpretation.)
- **Auto-tune: results go into a variant of their own**, "<original> · auto-tuned", "· relay T–L", "· SIMC", so the original stays to compare; one name per method so the rules can be compared by flipping variants (interpretation). An earlier result is never overwritten: a second one is numbered ("· auto-tuned 2"); tuning from a result updates it. Iterate creates its variant at the first improvement. **A relay or step result that scores worse than the running variant is added but does not run**, and the status says so (interpretation, after review: the conical tank's gain scheduling is ×3.6 better than a relay rule's fixed PID). **A whole run is one undo step.**
- **Auto-tune: watching**: while iterating, the display stops sweeping and shows each whole run, earlier ones fading; the experiments sweep in real time, labelled as the experiment (a Fast switch skips the pacing), and afterwards the loop's own run and run mode always come back, with or without a result; at the end the starting run stays faded against the result. About six iterations a second. Every method yields after each run of the loop and the tab computes in slices of about 30 ms, so the page keeps drawing ("snappy", product principle 1). (Person: "over a number of iterations … improve the behavior"; the pacing is ours.)
- **Auto-tune: the cost** is IAE, ITAE or ISE of r − y plus effort, overshoot beyond a bound and time at the limits, over one period of the input, d included; a diverged run costs a large finite amount. Interpretation: effort is the swing of u about its mean (holding a setpoint's power cannot be tuned away), and recovery from a disturbance is not counted as a step's overshoot. **The goal is fixed for a run**: copied at Start, its controls locked until the end. The goal settings live in the page session, not yet in the file.
- **Auto-tune: nothing plant-specific is stored**: gains, Ku, Pu and models are computed in the page when Start is pressed. (Person: "it should be computable in principle".)
- **Relay (on/off) joins the controller library**: u = u0 ± d with hysteresis, a real on/off controller and the relay experiment's law; a negative d reverses it. The relay experiment checks the plant's direction with a short open-loop step and reverses itself for a reverse-acting plant (Ku and the gains negative). It holds r's Source, found through gains, lags and subsystem ports, and reads r0 from the run.
- **Auto-tune for agents**: `node cli.mjs autotune` and `window.loopTuner.autotune()` run the same core as the tab (product principle 6: the CLI computes what the page computes).
- **Oven, badly tuned** joins the System library, made for this tab: three lags and a dead time, a PID that rings, reference steps and a door opening (d); it opens on the Auto-tune tab. (Person: "one system library element that's maybe badly tuned by default".)
- **Auto Scale overlays a Controller block's r and y**: the channels showing the r and the y a Controller block compares share one scale and offset, if they have one unit; nothing else is grouped, and XY is left alone (interpretation: without it the oven's r showed at 10 °C/div and T at 20, and T seemed never to reach r). A first version grouped every same-unit channel of similar range, which changed Auto Scale for every system; review narrowed it. **The person has not seen this: ask.**
- **Undo kept open actuator limits as null**, so a restored PID without limits put out 0; the controller library now normalises a variant before running it.
- **In a view's formulas, a signal named T, E or PI is that signal**: names were read case-insensitively, so the oven's temperature T showed the time. Without such a signal they mean t, e and π as before.

## 2026-10-24 · v2.6: controllers ([input](../input/2026-10-24-08-controllers-and-5-seconds.md))

- **Demos run 5 s**, and the mass–spring–damper moves slower (k 25 N/m, 0.8 Hz). (Person.)
- **View captions keep their width** with `{formula:w.d}`. (Person.)
- **The Controller block and tab are built** as decided: variants with one interface, flipped in the tab, one Ts per block. (Person.) A controller samples on its own clock; the simulation steps no longer than its Ts.
- **Controller library**: off, PID (with prefilter Tr, the Vorfilter, anti-windup, start output), state feedback (matrix gains, prefilter kr), gain-scheduled PI, energy swing-up with state feedback (Lyapunov). (Person asked for PID, "the simple matrix controllers", Lyapunov, a gain scheduler, a Vorfilter.)
- **Controlled systems of increasing difficulty**: DC motor with a deliberately mediocre P (person: "not that good … so we see it oscillating"), conical tank needing a gain scheduler, pendulum swing-up, and a **triple pendulum** for the complex controller (person: a simple pendulum for something simple, a triple one for the complex). The single pendulum's job became the swing-up (interpretation: two upright single pendulums would repeat each other).
- **Every controlled system has a disturbance d** besides r (person), entering where it would physically: load torque inside the motor, water drawn off the tank, a push on the cart.
- **Gains are computed, not guessed**: LQR by Riccati iteration on the linearised physics, tank PI by pole cancellation; the design is in system-library.md.
- **WebAssembly**: not needed now; the person is fine with it if the speed is ever needed.

## 2026-10-24 · v2.5: old runs fade; the examples move ([input](../input/2026-10-24-07-old-runs-and-views-that-move.md))

- **Earlier runs stay on the screen, whole and fading, gone after five** (all channels). (Person.) This revises v2.4's "nothing ahead of the scan line": the current run still stops at the scan line, the old ones show what lies ahead.
- **Why nothing moved for the person**: their browser restored work saved by an older page, with v1 controller candidates in it; loading the Mass–spring–damper kept them, so the diagram was run as a closed-loop plant, failed, and every Sink had "no signal". Fixed three ways: a whole system load replaces the controller part; a diagram with its own Sources is never run as a loop plant; saved work is only restored onto the project the page opened with (a new page version starts fresh).
- **The page opens the Mass–spring–damper** when it has no project inside, auto-scaled, running, on its view. (Person.)
- **Signals are named for what they are**: F, x, v, Ekin, Epot; F, x, theta; V, angle, speed. r is no longer required: it is a new plant's Source, renamable, and a system keeps at least one Source. (Person: "what is the reference signal here?") Revises v2.3's "r always stays"; interpretation of how far to take it.
- **Function block** (`y = f(u)`), so the mass–spring–damper can show kinetic and potential energy. (Person suggested the energies.)
- **One view per system**; the motor's view gets a fixed dial and a marked rotor. (Person.)

## 2026-10-24 · v2.4: examples that work ([input](../input/2026-10-24-06-make-examples-work.md))

- **Scope channel sources are only the names the diagram defines** (r always), no implicit y, u, e or "effort". (Person.) Names that disappear are cleared from the channels.
- **Every signal has a unit, default `1`**, set on Sources and Sinks; physics parameters carry units. (Person.)
- **The System library is three systems that move**: mass–spring–damper, inverted pendulum, DC motor. Inverse response, dead time, third-order lag and the closed-loop duplicates are gone from it (v1's loops stay for the CLI). (Person.)
- **While sweeping, the trace is drawn only up to the scan line**; nothing ahead of it is shown. (Person: "I don't need to see in advance what happened.") This replaces the dimmed previous sweep.
- **Single restarts from the start of the screen**, so the pendulum drops again. (Person.)
- **A project or system says how it opens (`ui`)**: run state, tab, view, setup height. The systems open running on their view in the Plant tab with the setup area at 42 % of the page. Saving writes the current state. (Person: "an example can also contain the default settings on the run control and on the panels and tabs".) The setup height from `ui` is applied as if the viewer had dragged it, so it overrides the per-viewer size once; interpretation.
- **No view-editing UI**: views are JSON only. (Person.)
- **Controller decided** ([controller-proposal.md](controller-proposal.md)): two inputs by default, one sample time per Controller block, variants with the same interface that Auto-tune can flip through. (Person.)
- **Short block labels**: the cart–pole shows `F → x, θ`. Subsystem masks (parameters that reach inner blocks) are on the roadmap. (Person.)

## 2026-10-24 · v2.3: views, system library, library column ([input](../input/2026-10-24-05-library-controller-views.md))

- **The library column resizes and its groups fold**; both kept per viewer. Rarely used groups start folded. (Person; the starting fold is our choice.)
- **Sensors and Physics groups**: Quantizer and Noise; a nonlinear Cart–pole with two outputs and an initial angle. Interpretation of "sensors would also be selected from that".
- **Terminator and Switch blocks**; Out passes up, Sink records, Terminator ends. Double-click a Switch to move it to its next input. (Person.)
- **Scope channels list every Source and Sink in the diagram** at any depth, whether or not the system simulates. (Person: they were "not in sync".)
- **A new plant is Source r alone; r always stays.** Channels 2–4 start with no source and nothing is put on the scope by itself; picking a source switches a channel on. Double-click a Source or Sink on the canvas to rename it; renames follow into the Input tab and the channels. (Person.)
- **Plants carry views in their JSON; there is no view editor beyond the JSON panel.** (Person.) Two kinds: `2d` shapes (ours, simple for agents) and `svg`, a standard SVG drawing with attribute bindings. 3D will use URDF. (Person: "if there are standards … we can use them".) Formulas in views read signals by name, through the same parser as the Function waveform.
- **Views follow the scope's time**: the scan line, the hover cursor, or the screen's right edge. Interpretation: it ties the animation to the sweep the person already has.
- **SVG views are cleaned before display** (no scripts, handlers, outside links) and bindings cannot target events or links: a shared file cannot run code. Interpretation, for safety.
- **The mass–spring–damper hangs vertically** from a ceiling. (Person.) Its motion is drawn exaggerated (×40) and says so.
- **Examples become the System library**: complete systems (input, plant with views, controller) loaded whole or by part from the header; the Plant tab's list draws from the same library. (Person.)
- **The controller as a block**: proposed in [controller-proposal.md](controller-proposal.md); decided in v2.4.
- **Repository**: github.com/mb-89/ctrl. The v1 tag could not be pushed (the session's git proxy refuses tag pushes); v1 is commit `b13ff03`.

## 2026-10-24 · v2.2: the Plant tab ([input](../input/2026-10-24-04-plant-tab.md))

- **The plant is a Simulink-like block diagram**: library left, canvas middle, parameters right; blocks nest as subsystems; subsystems can be saved to the library. (Person.)
- **Until a controller exists, the diagram is the whole system: Source blocks play named signals, Sink blocks (y1, y2, …) are scope channel sources.** (Person.) In and Out are subsystem ports, and later the plant's connection to the controller.
- **Signals are named and live in `system.signals`**; the Input tab gets an Edit column listing them, in front of the Waveform keys. Del / Cancel / Enter became three small keys under the keypad to make room. (Person.)
- **Diagrams are simulated as Simulink does**: state blocks first, pass-through blocks after their inputs; an algebraic loop is refused with its block names. Interpretation: the standard, robust choice; reducing the diagram to one transfer function would not survive saturation or dead time.
- **Actuator, plant and sensor share one compiler**: a single block is a diagram of one block. The existing closed-loop tests pass unchanged through it.
- **Flip** mirrors a block for feedback paths. Interpretation, after Simulink.
- **Saved blocks live in the project file** (`library`), so they travel with a shared file. Interpretation: a per-browser library would be lost when the file is sent.
- **On Simulink**: the interaction (drag, wire, group, nest) is common to every block-diagram tool and is borrowed freely; Simulink's look, icons and file format are not copied. The person: this is never going to be sold.
- **Example plants are whole systems** (Source r → … → Sink y1), including a mass–spring–damper from integrators and a DC motor with a nested Motor subsystem; each is checked in tests against its analytic or single-block equivalent.

## 2026-10-24 · v2.1: the screen is the record ([input](../input/2026-10-24-03-record-autoscale-input-layout.md))

- **No record length: the screen is simulated and swept**, from 0 to its right edge, in real time. (Person.)
- **The input has a Period, under the waveform keys; Auto Scale shows one period.** (Person.) **The input repeats with its period**, as a generator does. Interpretation of "period": the person also called it "length"; if repetition is unwanted it is one line in `referenceFn`.
- The person's earlier fallback, "1 s after the last change, at least 1 s", is superseded by the Period; it may return as the default period for a new signal.
- **Auto Scale centres channels on a whole division**, so the value labels are round numbers.
- **Input tab order: Waveform | Parameters | Signal | Entry**, one row, no scrolling. The person said both "right of the entry" and "left of the entry"; we followed the closing summary (left of it), which also keeps dial and keypad at the right edge as on a real generator. Interpretation.
- **Add / Cancel sit in the Parameters header** to save height.
- **Knob readouts are editable**: click and type, with SI prefixes. (Person.)
- **Two draggable separators** (display | setup, display | controls); sizes belong to the viewer, kept in the browser, unchanged by tab switches. (Person.) The setup area starts at the Input tab's natural height. Interpretation: per-viewer layout is not part of the shared project file.
- **Direct manipulation on the display** (wheel zoom by zone, drag to pan, select a line, Shift-drag box zoom), all setting the same scope settings as the knobs. (Person.) With a line selected, the wheel zooms its values only, not time. Interpretation.
- **Axis labels on the screen** (time below, active channel's values left), so the axes are targets for wheel zoom. Interpretation: needed for the person's "scroll on the x-axis"; not on a real scope, an improvement in behaviour.
- **Pulse merged into Square**, which gains a Count (0 = unlimited, 1 = single pulse); its duty became a high time in seconds. (Person.) Interpretation: high time instead of duty, so one parameter set covers pulse and square.
- **Function key: y(t) as a formula**, parsed by our own small parser, not `eval`. (Person: a parser is preferred if not much effort; it is about 100 lines.) Names resolve only from a fixed list (own properties), so nothing typed can reach the JavaScript runtime.

## 2026-10-24 · v2: the oscilloscope

- **The page is an oscilloscope, not a dashboard.** Display left and always visible; Run Control, Horizontal and Vertical to its right; setup in tabs below. (Person, [input](../input/2026-10-24-02-oscilloscope-ui.md).)
- **Tabs in build order: Input, Plant, Controller, Auto-tune, Analysis**, to reduce what is on screen. (Person.)
- **The sweep runs in real time over the record length.** (Person, "we can change that later".)
- **Four channels with fixed default sources r, y, u, e**, and colours yellow, green, blue, magenta after bench-scope convention. Interpretation: the person asked for four selectable traces; the sources are our choice.
- **The scope screen is dark in both themes.** Interpretation: it is an instrument display; the panel around it follows the theme.
- **Knobs are endless encoders with detents**, and double-click is the knob's push (zero a position). Interpretation, after real scopes.
- **The reference is a sum of primitives with a dashed preview before it is added.** (Person.) The default first primitive is a step at 0.1 s. (Person's example.)
- **The generator edits values with a digit cursor, dial and keypad**, as on the panel the person shared. Interpretation of "look like a physical signal generator".
- **Record length lives in the Input tab** with the signal it bounds. Interpretation.
- **The header bar (file actions) stays for now.** The person may want it moved into a menu; open question.
- **Stop freezes the sweep, not the data.** Edits made while stopped still show at once. Interpretation: a tuning tool that hid edits while stopped would mislead.
- **A loop defined in the file is shown before its tabs exist.** Projects from v1 or the CLI carry a plant and candidates; the display then shows y, u, e for the selected candidate.
- **Auto Scale uses 1-2-5 steps**, so a 30 s record gets 5 s/div and fills 6 of 10 divisions, as on a real scope.
- **Unitless channel values are plain numbers** (`0.2/div`, `-0.4`); SI prefixes only for seconds, so `-400 m` is never read as metres.
- **v1 is superseded, not deleted**: commit `b13ff03`. Its blocks, metrics, goal, auto-tune and CLI carry over into the later tabs.

## 2026-10-24 · v1

- Browser-only, one self-contained HTML file; the same core runs in Node for agents (CLI). (Person.)
- The controller is digital (sampled, zero-order hold) and the actuator, plant and sensor continuous, integrated with RK4; this removes algebraic loops and matches real controllers. Interpretation.
- One score per candidate: minimise a weighted sum of metrics subject to bounds; feasible beats infeasible. (Person: "as good as possible under certain constraints".)
- Auto-tune is our own: seeded scan, then Nelder–Mead on a penalised score. No library.
- The candidate checkbox means "show on the scope". Interpretation of "check them off".
