# Setup tabs

Reader: whoever adds or changes a tab.

**The tabs exist to keep the screen calm.** Below the display, one tab is open at a time, and the person builds the loop in order, one step per tab. What a tab has not set up yet simply does not exist: with only the input defined, the display sweeps the input alone.

| # | Tab | Owns | State |
|---|---|---|---|
| 1 | Input | The named signals (r and any other a Source plays): a signal generator that sums primitives ([signal-generator.md](signal-generator.md)) | built |
| 2 | Plant | The system as a block diagram: Sources play signals, Sinks are what the scope shows ([plant-editor.md](plant-editor.md)) | built |
| 3 | Controller | The plant's Controller blocks and their variants: pick the one that runs, edit its parameters, add more from the controller library ([controller-proposal.md](controller-proposal.md)) | built |
| 4 | Auto-tune | Improving a Controller block's running variant by simulation: the goal (IAE/ITAE/ISE, effort, overshoot bound; d included), and three methods: iterate (Nelder–Mead), relay (Ku, Pu, a rule), step response (SIMC) ([autotune.md](autotune.md)) | built |
| 5 | Analysis | Computed views: root locus, Bode, Nyquist, pole-zero, step metrics | planned |

Tabs not built yet are shown, so the path is visible, but say plainly that they come later.
