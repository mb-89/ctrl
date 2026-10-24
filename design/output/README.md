# Design output

Reader: an agent or person about to change Loop Tuner. Read this folder before you start; it is what was decided, so nobody has to explain it twice.

The person's raw words are in [../input](../input/README.md). This folder is what we made of them. When the person gives new direction: save their words verbatim in `input/`, then update the documents here, and add a line to the decision log.

| Document | What it settles |
|---|---|
| [product.md](product.md) | What Loop Tuner is for, and the principles every change is held to |
| [instrument.md](instrument.md) | The oscilloscope: display, channels, horizontal, run control, Auto |
| [tabs.md](tabs.md) | The setup tabs below the display, their order, and what each one owns |
| [signal-generator.md](signal-generator.md) | Tab 1, the reference signal generator |
| [project-format.md](project-format.md) | The project file (JSON), version 2 |
| [decisions.md](decisions.md) | Dated log of decisions, including the interpretations we made |
| [roadmap.md](roadmap.md) | What is built, what is next, and open questions |

## Status (2026-10-24)

- **v1** (git tag `v1`): everything on one screen: scope, goal, candidates, a rack of knobs, auto-tune. It works, but the person found it overloaded; it is superseded by v2.
- **v2, in progress**: the oscilloscope layout, with the Input tab (signal generator) built. The screen is the record; the display can be zoomed and panned directly. With only the reference defined, the display sweeps the reference alone. Plant, Controller, Auto-tune and Analysis tabs come next, one at a time (see [roadmap.md](roadmap.md)).
- The simulation core (`src/core/`) and the agent CLI (`cli.mjs`, see `AGENTS.md`) carry over from v1.
