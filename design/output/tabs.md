# Setup tabs

Reader: whoever adds or changes a tab.

**The tabs exist to keep the screen calm.** Below the display, one tab is open at a time, and the person builds the loop in order, one step per tab. What a tab has not set up yet simply does not exist: with only the input defined, the display sweeps the input alone.

| # | Tab | Owns | State |
|---|---|---|---|
| 1 | Input | The reference r(t): a signal generator that sums primitives ([signal-generator.md](signal-generator.md)) | built |
| 2 | Plant | The plant model; likely also actuator, sensor and disturbance, as swappable blocks that start trivial (gain 1) | next |
| 3 | Controller | Hand-tuned controller candidates, overlaid on the display and stepped through like patches | planned |
| 4 | Auto-tune | The goal (objective and bounds), the score, the optimiser | planned |
| 5 | Analysis | Computed views: root locus, Bode, Nyquist, pole-zero, step metrics | planned |

Tabs not built yet are shown, so the path is visible, but say plainly that they come later.
