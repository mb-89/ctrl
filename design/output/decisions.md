# Decisions

Reader: anyone who wants to know why something is the way it is. Newest first. "Interpretation" marks a choice we made where the person's words left it open; ask the person before reversing one silently.

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
- **v1 is superseded, not deleted**: git tag `v1`. Its blocks, metrics, goal, auto-tune and CLI carry over into the later tabs.

## 2026-10-24 · v1

- Browser-only, one self-contained HTML file; the same core runs in Node for agents (CLI). (Person.)
- The controller is digital (sampled, zero-order hold) and the actuator, plant and sensor continuous, integrated with RK4; this removes algebraic loops and matches real controllers. Interpretation.
- One score per candidate: minimise a weighted sum of metrics subject to bounds; feasible beats infeasible. (Person: "as good as possible under certain constraints".)
- Auto-tune is our own: seeded scan, then Nelder–Mead on a penalised score. No library.
- The candidate checkbox means "show on the scope". Interpretation of "check them off".
