# Setup tabs

Reader: whoever adds or changes a tab.

**The tabs exist to keep the screen calm.** Below the display, one tab is open at a time, and the person builds the loop in order, one step per tab. What a tab has not set up yet simply does not exist: with only the input defined, the display sweeps the input alone.

| # | Tab | Owns | State |
|---|---|---|---|
| 1 | Input | The named signals (r and any other a Source plays): a signal generator that sums primitives ([signal-generator.md](signal-generator.md)) | built |
| 2 | Plant | The system as a block diagram: Sources play signals, Sinks are what the scope shows ([plant-editor.md](plant-editor.md)) | built |
| 3 | Controller | The plant's Controller blocks and their variants: pick the one that runs, edit its parameters, add more from the controller library ([controller-proposal.md](controller-proposal.md)) | built |
| 4 | Identify | Finding the plant a Controller block sees, by experiment: what is known (u's and y's ranges, r's range), two plain questions (how far y may move, how long the test may take), one eased-in test (Listen, Nudge, Hold, Ease in, Shake when needed, Check), the model as sentences and a chain of blocks, the record kept on Keep. The same on simulated and HIL plants ([identification.md](identification.md)) | designed, not built |
| 5 | Auto-tune | Improving a Controller block's running variant by simulation: the goal (IAE/ITAE/ISE, effort, overshoot bound; d included), and three methods: iterate (Nelder–Mead), relay (Ku, Pu, a rule), step response (SIMC) ([autotune.md](autotune.md)). With Identify: on the diagram or on the identified model (always the model on HIL), and Try on the plant | built; the model as plant source is designed |
| 6 | Analysis | Computed views of the loop: key numbers and margins, root locus, Bode, Nyquist, linear step ([analysis.md](analysis.md)). Its plant is the diagram's linearisation (the design layer) or the identified model (always on HIL) | built; its plant comes with the design layer and Identify |

Tabs not built yet are shown, so the path is visible, but say plainly that they come later.

**Order: Input, Plant, Controller, Identify, Auto-tune, Analysis** (the person, [input 10](../input/2026-10-24-10-sliding-mode-and-triple-swingup.md): "after controller, before autotune and analysis would come identification"). Identify comes first among the three because Auto-tune and Analysis need a plant model, and a HIL plant has none until it is identified. In code the tab keys are `input`, `plant`, `controller`, `identify`, `tune`, `analysis` (`UI_TABS` in `src/core/project.js`; `identify` is added when the tab is built).
