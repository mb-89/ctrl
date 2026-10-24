# System library

Reader: whoever adds an example system or changes how systems load.

**A system is a complete example: its input (the named signals), its plant (diagram and views) and, once it has one, its controller (candidates, goal, sample time). It loads whole or by part, so the input of one system can drive the plant of another.** (The person, 2026-10-24: "call them system library".)

**Few systems, each one working and moving: they are the first impression.** (The person, 2026-10-24.) Today there are three, none with a controller yet:

| System | Input | What you see |
|---|---|---|
| Mass–spring–damper | 1 N step at 0.1 s | The hanging mass drops about 10 mm and rings at 1.6 Hz (views: shapes and SVG) |
| Inverted pendulum | 2 N push for 0.1 s | The Cart–pole starts tilted 1° and the pole falls over |
| DC motor | 1 V step | The shaft turns; speed settles at 1.43 rad/s (Motor is a subsystem) |

- **Loading a system shows it running**: a whole load takes the system's title, scope channels and `ui` (run, Plant tab, its first view, setup area at 42 % of the page), so the trace is drawn as time passes and the view moves with it. (The person, 2026-10-24.)
- **Header, "System library ▾"**: every system, with Load (all its parts) and one button per part it has (Input, Plant, Controller). Loading is one undo step; any load of input or plant runs Auto Scale.
- **Plant tab, library column, "System library" group**: the same systems; a click loads the plant only.
- Entries live in `src/core/systems.js`, built from `src/core/plants.js`. v1's closed-loop examples stay in `src/core/examples.js` for the CLI only; closed-loop systems return with the Controller tab.

To add a system: add it to `plants.js` (name, notes, `signals`, `scope`, `ui`, `diagram`, `views`); it must move visibly with its own input, and a test checks its behaviour against something known.
