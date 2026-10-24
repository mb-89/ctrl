# Decisions

Reader: anyone who wants to know why something is the way it is. Newest first. "Interpretation" marks a choice we made where the person's words left it open; ask the person before reversing one silently.

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
