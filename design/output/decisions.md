# Decisions

Reader: anyone who wants to know why something is the way it is. Newest first. "Interpretation" marks a choice we made where the person's words left it open; ask the person before reversing one silently.

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
