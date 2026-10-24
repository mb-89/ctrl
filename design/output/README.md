# Design output

Reader: an agent or person about to change Loop Tuner. Read this folder before you start; it is what was decided, so nobody has to explain it twice.

The person's raw words are in [../input](../input/README.md). This folder is what we made of them. When the person gives new direction: save their words verbatim in `input/`, then update the documents here, and add a line to the decision log.

| Document | What it settles |
|---|---|
| [product.md](product.md) | What Loop Tuner is for, and the principles every change is held to |
| [instrument.md](instrument.md) | The oscilloscope: display, channels, horizontal, run control, Auto |
| [tabs.md](tabs.md) | The setup tabs below the display, their order, and what each one owns |
| [signal-generator.md](signal-generator.md) | Tab 1, the signal generator |
| [plant-editor.md](plant-editor.md) | Tab 2, the plant as a block diagram |
| [plant-views.md](plant-views.md) | 2D views of a plant, configured in its JSON (shapes, or SVG with bindings) |
| [system-library.md](system-library.md) | Complete example systems, loaded whole or by part |
| [controller-proposal.md](controller-proposal.md) | Tab 3, the Controller: blocks with variants, the controller library |
| [designs.md](designs.md) | Designs computed in the page from the plant (nothing plant-specific stored): the plant a block sees, model mode, designed variants, the swing-up plan; build status ([full plan](designs-in-the-page.md)) |
| [project-format.md](project-format.md) | The project file (JSON), version 2 |
| [decisions.md](decisions.md) | Dated log of decisions, including the interpretations we made |
| [roadmap.md](roadmap.md) | What is built, what is next, and open questions |

## Status (2026-10-24)

- Repository: [github.com/mb-89/ctrl](https://github.com/mb-89/ctrl).
- **v1** (commit `b13ff03`): everything on one screen: scope, goal, candidates, a rack of knobs, auto-tune. It works, but the person found it overloaded; it is superseded by v2.
- **v2, in progress**: the oscilloscope layout with the Input tab (signal generator) and the Plant tab (block diagram) built. The screen is the record; the display can be zoomed and panned directly. Until a controller exists, the diagram is the whole system: Sources play signals, Sinks are what the scope shows. Every signal has a unit. Plants carry 2D views (JSON only); three systems load from the System library and open running on their view. The Controller tab is built: Controller blocks hold variants (PID, state feedback, gain scheduling, Lyapunov swing-up) and the library has four controlled systems up to a triple pendulum. Auto-tune and Analysis come next ([roadmap.md](roadmap.md)).
- The simulation core (`src/core/`) and the agent CLI (`cli.mjs`, see `AGENTS.md`) carry over from v1.
