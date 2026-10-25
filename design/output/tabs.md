# Setup tabs

Reader: whoever adds or changes a tab.

**The tabs exist to keep the screen calm.** Below the display, one tab is open at a time, and the person builds the loop in order, one step per tab. What a tab has not set up yet simply does not exist: with only the input defined, the display sweeps the input alone.

| # | Tab | Owns | State |
|---|---|---|---|
| 1 | Input | The named signals (r and any other a Source plays): a signal generator that sums primitives ([signal-generator.md](signal-generator.md)) | built |
| 2 | Plant | The system as a block diagram: Sources play signals, Sinks are what the scope shows ([plant-editor.md](plant-editor.md)) | built |
| 3 | Controller | The plant's Controller blocks and their variants: pick the one that runs, edit its parameters, add more from the controller library ([controller-proposal.md](controller-proposal.md)) | built |
| 4 | Identify | Finding the plant a Controller block sees, by experiment: what is known (u's and y's ranges, r's range), two plain questions (how far y may move, how long the test may take), one eased-in test (Listen, Nudge, Hold, Ease in, Shake when needed, Check), the model as sentences and a chain of blocks, the record kept on Keep, Check again. The same on simulated and HIL plants; on a simulated one, Compare with the diagram and Hide a variation ([identification.md](identification.md)) | built (§18 steps 6–11) |
| 5 | Auto-tune | Improving a Controller block's running variant by simulation: the goal (IAE/ITAE/ISE, effort, overshoot bound; d included), and three methods: iterate (Nelder–Mead), relay (Ku, Pu, a rule), step response (a settling or integrating model, SIMC; a schedule for a gain-scheduled PI) ([autotune.md](autotune.md)). With Identify: on the diagram or on the identified model (always the model on HIL), and Try on the plant. A second mode, Benchmark: every controller type tuned and compared in a Pugh matrix ([benchmark.md](benchmark.md)) | built, the identified model as plant source and Try on the plant included; the Benchmark mode is designed |
| 6 | Analysis | Computed views of the loop: key numbers and margins, root locus, Bode, Nyquist, linear step ([analysis.md](analysis.md)). Its plant is the diagram's linearisation (the design layer) or the identified model (always on HIL) | built, its plant from the design layer (`app.loopModel`) or the identified model, with its ranges over the model's uncertainty |

Tabs not built yet are shown, so the path is visible, but say plainly that they come later. A tab that is built but still needs a part from another branch says what it waits for.

**Order: Input, Plant, Controller, Identify, Auto-tune, Analysis** (the person, [input 10](../input/2026-10-24-10-sliding-mode-and-triple-swingup.md): "after controller, before autotune and analysis would come identification"). Identify comes first among the three because Auto-tune and Analysis need a plant model, and a HIL plant has none until it is identified. In code the tab keys are `input`, `plant`, `controller`, `identify`, `tune`, `analysis` (`UI_TABS` in `src/core/project.js`).

## Progressive disclosure

**Each place shows what is actionable and needed for the decision made there; explanations and secondary numbers sit one click away, behind a Details control** (the person, [input 19](../input/2026-10-25-19-progressive-disclosure.md)). Details are collapsed by default and work by keyboard (a native disclosure: Tab to it, Enter or Space). A one-line reason for a verdict may be a tooltip instead. Warnings, errors and what a control will do stay visible. Built as `<details class="more">` whose `<summary>` is the design system's Disclosure (`.disclosure.label`, [design-system.md](design-system.md)); the Plant tab's panel keeps one open across its re-renders.

Where it is applied (2026-10-25): the System library (a bottom line per system; Details for the full description, also the Plant tab's *About this system*: [system-library.md](system-library.md)); the Plant tab's panel (the editing help under *How to edit*; on a view, how it follows the scope and where views are set under *Details*); the Controller tab (the controller type's explanation under *About this type*); Auto-tune before a run (*Press Start.*; how the runs are shown, in its tooltip); Analysis (the verdict's reason in its tooltip; under the key numbers, what was analysed and any warning stay, the scope time, the dead time and the linear assumptions go under *Details*).
