# System library

Reader: whoever adds an example system or changes how systems load.

**A system is a complete example: its input (the named signals), its plant (diagram and views) and, once it has one, its controller (candidates, goal, sample time). It loads whole or by part, so the input of one system can drive the plant of another.** (The person, 2026-10-24: "call them system library".)

- **Header, "System library ▾"**: every system, with Load (all its parts) and one button per part it has (Input, Plant, Controller). Loading is one undo step; a whole load also takes the system's title; any load of input or plant runs Auto Scale.
- **Plant tab, library column, "System library" group**: the same systems; a click loads the plant only.
- Entries live in `src/core/systems.js`, built from `src/core/plants.js` (systems without a controller yet: first order, third-order lag, dead time, inverse response, mass–spring–damper, DC motor, inverted pendulum) and `src/core/examples.js` (closed-loop systems from v1, with tuned controller candidates).

To add a system: add it to `plants.js` (name, notes, optional `signals`, `diagram`, optional `views`), and add a test that checks its behaviour against something known.
