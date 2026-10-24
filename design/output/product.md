# Product

Reader: anyone deciding whether a change fits Loop Tuner.

**Loop Tuner is a control-loop tuning instrument that runs entirely in the browser, and that an agent can drive just as well as a person.** A person tunes by hand on a page that feels like lab equipment; an agent tunes through the same simulation in Node; both work on the same human-readable project file.

## Principles

1. **The UI comes first.** It is what people touch most. It must be snappy, and it must feel like an instrument: an oscilloscope for watching signals, a signal generator for making them, a synthesizer for trying variations.
2. **Show little at a time.** The display is always there; everything else is set up in tabs, one step at a time (input, plant, controller, auto-tune, analysis). A screen that shows everything at once is a failure (v1 was).
3. **Build up from simple.** Every part starts trivial (a step input, a gain-1 sensor) and can be swapped for something richer, and swapped back.
4. **One file to share.** The page is a single self-contained HTML file. Exported, it carries the project inside, so the person can send it to someone who just opens it.
5. **Human-editable, agent-readable data.** Projects are plain JSON. No binary formats.
6. **Agents are first-class.** Everything the page computes, the CLI computes identically (one core, no DOM in it). An agent must be able to take "tune this loop" and do it.
7. **Quality is a number under constraints.** A response gets one score: minimise an objective subject to bounds ("as fast as possible with low overshoot", "smoothest effort while settling within T").

## Scope

Now: linear SISO loops, textbook blocks. Later: robustness against plant changes, MIMO, system identification from measured data, WebAssembly where speed demands it.
