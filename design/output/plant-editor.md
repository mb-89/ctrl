# Tab 2: the Plant editor

Reader: whoever changes how the plant is built or simulated.

**The plant is a block diagram, edited like Simulink: a library on the left, a canvas in the middle, the selected block's parameters on the right.** Until a controller exists, the diagram is the whole system: Source blocks play signals from the Input tab, Sink blocks are what the scope can show.

## Sources and sinks (the person, 2026-10-24)

- A **Source** plays a named signal (r, r1, d, …) made in the Input tab. The Input tab's Edit column lists every signal the Sources use; adding a Source with a new name adds a signal.
- A **Sink** records its input under a name (y1, y2, …); every Sink is a channel source on the scope.
- A diagram with only a Source shows only that signal.
- **In** and **Out** blocks are the ports of a subsystem (and, later, the plant's connection to the controller).

## Canvas

| Gesture | Effect |
|---|---|
| Drag a library item onto the canvas, or click it | Add the block (clicked blocks avoid covering others) |
| Drag from an output (right) to an input (left) | Wire them; an input takes one wire, a new one replaces it |
| Click a block / a wire | Select it; Shift-click adds to the selection |
| Shift-drag the background | Select the blocks inside the box |
| Drag a block | Move the selection |
| Drag the background, wheel | Pan, zoom |
| `Del` | Delete the selection |
| `Ctrl+G` or Group | Put the selection into a subsystem; wires crossing the boundary become its In/Out ports |
| Double-click a subsystem, or Open | Go inside; the breadcrumb or `Esc` goes back up |
| Flip | Mirror a block (inputs right, outputs left), for feedback paths |

## Library

Signals (Source, Sink) · Math (Gain, Sum with signs such as `+--`) · Dynamics (Integrator, Dead time, First order, Second order, Transfer function) · Models (first order with dead time, n equal lags, integrator with lag, double integrator, inverse response) · Nonlinear (Saturation) · Structure (Subsystem, In, Out) · **My blocks**: subsystems the person saved, kept in the project file · **Example plants**: whole systems to load (first order, third-order lag, dead time, inverse response, mass–spring–damper from integrators, DC motor with a nested Motor subsystem).

## Simulation

`compileDiagram` (`src/core/diagram.js`) flattens subsystems and orders the blocks as Simulink does: blocks whose output depends on their state only (integrators, lags, dead time) first, then blocks that pass their input straight through (gain, sum, saturation) after their inputs. A loop made only of pass-through blocks is an **algebraic loop** and is refused with the names of the blocks in it; feedback through a block with state is fine. Everything is integrated with fixed-step RK4. In a closed loop (once a controller exists) the actuator, the plant and the sensor all run through the same compiler.

## Parameters panel

One block: label, parameters (typed, SI prefixes accepted), Flip; Open and Save to library for a subsystem; "Edit signal" for a Source. Several blocks: Group, Delete. Nothing: the diagram's sources, sinks, and whether it is valid (errors in red, with the offending blocks outlined).

## Not yet

Ungroup; multiple plant inputs/outputs for a controller (MIMO); the disturbance as a Source on the plant input; copy and paste.
