# Design input

Reader: an agent or person picking up Loop Tuner who needs to know what the person asked for.

The person's own words, verbatim, one file per conversation, dated, with the images they shared in `images/`. Nothing here is edited after the fact: when the person says something new, add a new file. What we made of these words, and every decision taken on them, lives in [../output](../output/README.md).

| File | What it covers |
|---|---|
| [2026-10-24-01-brief.md](2026-10-24-01-brief.md) | The idea: a browser control-loop tuner that agents can drive; first scope; quality number; interchangeable blocks; goals as constrained optimisation |
| [2026-10-24-02-oscilloscope-ui.md](2026-10-24-02-oscilloscope-ui.md) | The UI must feel like an oscilloscope; signal-generator tab for the reference; tabs to reduce what is on screen; design folders |
| [2026-10-24-03-record-autoscale-input-layout.md](2026-10-24-03-record-autoscale-input-layout.md) | The record is the screen; Auto Scale fits the input's period; the Input tab in one compact row; a Period field under the waveform keys |
| [2026-10-24-04-plant-tab.md](2026-10-24-04-plant-tab.md) | A signal-selector column in the Input tab; the Plant tab as a Simulink-like block diagram with a library, nesting and example plants; Source and Sink blocks |
| [2026-10-24-05-library-controller-views.md](2026-10-24-05-library-controller-views.md) | Resizable, collapsible library column; the controller as a block configured in its own tab; 2D (later 3D) representations of a plant in its JSON |
