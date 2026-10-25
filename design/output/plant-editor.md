# Tab 2: the Plant editor

Reader: whoever changes how the plant is built or simulated.

**The plant is a block diagram, edited like Simulink: a library on the left, a canvas in the middle, the selected block's parameters on the right.** Until a controller exists, the diagram is the whole system: Source blocks play signals from the Input tab, Sink blocks are what the scope can show.

## Sources and sinks (the person, 2026-10-24)

- A **Source** plays a named signal (r, r1, d, …) made in the Input tab. The Input tab's Edit column lists every signal the Sources use; adding a Source with a new name adds a signal.
- A **Sink** records its input under a name (y1, y2, …); every Sink anywhere in the diagram, also inside subsystems (and later controllers), is a channel source on the scope, as is every Source.
- Three ways for a signal to end (the person): **Out** passes it up to the enclosing block, **Sink** records it for the scope, **Terminator** just ends it.
- A diagram with only a Source shows only that signal. **A new plant is exactly Source r.** Any Source can be renamed (an input force is F, not r); the last Source cannot be deleted.
- **Every Source and Sink has a unit** (parameter `unit`, default `1`); so does every physical block parameter. The scope shows the units.
- **Block labels stay short**; a masked model shows how many blocks it holds, and its parameters are on its mask.
- **Masks** ([transparent-models.md](transparent-models.md) §1.4): a subsystem may carry parameters that the blocks inside read by name. Selected, it shows them under **Mask** in the Parameters panel (typed with SI prefixes, the wheel nudging 5 %, Shift 1 %; the hint gives the unit and any min and max), with Open. Inside, any number field, and each coefficient of a Transfer function, may be a formula in the names of the masks around it (`1/k`, `m/k`); the field shows it and its hint the value ("1/k → 0.5"). An unknown name is refused with the names that are there. Adding or renaming a mask parameter is JSON only for now. A mask may also hold **toggles** (a key carrying its label, lit when on) and **choices** (a list), with the fields under them folded away while they are off ([servo.md](servo.md) §15); a number field is named by its key, its label, unit and range below. A Switch the mask sets is a wire: what only feeds its other inputs is not compiled and is drawn faint inside.
- **Components** (library group *Components*; [servo.md](servo.md)): built-in masked subsystems, the **Servo motor** first. A use shows its mask's choices and the toggles that are on on its face and names its ports; it opens read-only (an edit inside is refused with a sentence) and **Edit a copy** makes it the project's own subsystem. Saved as a reference and the values set.
- **Equations** (group Math, the former Function): named inputs (`Q, h`), lines `name = formula` and named outputs, one port each, labelled on the block; the face shows the first line (all of them in the tooltip). A formula may use the inputs, the names defined above it, the masks' parameters, `t`, `pi`, `e`, `inf` and the Input tab's functions; an unknown name is refused, as are a name defined twice and an output no line computes. The lines are edited in a text area (Ctrl+Enter or leaving it commits). A loop through Equations without a state is an algebraic loop.
- **Integrator** (group Dynamics): K, a start value x₀, Min and Max (empty: none), a unit and an angle flag, which label its state for the design layer. At a limit the rate is 0 while the input pushes beyond it, and the output is the state clamped: a tank that overflows at its brim and stops when dry. The face shows `∫ [0, H]` when limited.
- **Double-click a Source or Sink on the canvas to rename it.** Renaming a Source renames its signal (the Input tab follows); renaming a Sink carries into the scope channels that showed it.
- **In** and **Out** blocks are the ports of a subsystem.
- **Controller** (group Control): a digital controller, inputs r then the measurements, output u held between samples at its own Ts. It holds variants; double-click it (or "Open in the Controller tab") to choose and tune them ([controller-proposal.md](controller-proposal.md)). Its canvas label shows the variant that runs.
- **Physics** (templates; [transparent-models.md](transparent-models.md)): Cart–pole (`F → x, θ, v, ω`), Pendulum, Double and Triple pendulum on cart (`F → x, θ1…, v, ω1…`) and Conical tank (`q → h`, Torricelli outlet; q is the net flow in, so a draw-off larger than the pump's flow drains it until it is empty). Each inserts a **masked subsystem you can open**: the carts are Mechanics parts, the tank is Equations, a Sum and an Integrator limited to [0, H]. The mask holds the old block's parameters (M, m, l, g, b, the start angles; r0, R, H, a, g, h0), so the Parameters panel shows the same fields. The models give their coordinates and rates as outputs, so state feedback can use them. A file with the old `cartPole`, `pendulumCart` or `conicalTank` block opens it as its subsystem.
- **Mechanics** ([transparent-models.md](transparent-models.md) §1.1): World (gravity g), Rail (a prismatic joint: coordinate and rate, friction b, an incline, an optional force input), Hinge (a revolute joint: the angle from upright, positive towards +x, damping c, an optional torque input), Mass, Rod (length l, its mass at the tip or uniform). They meet at **frame ports**, the small squares on their bottom edge (base B on the left, follower F or tip T on the right; W and a Mass's F in the middle), joined by thick grey **joins**: a join is one point and carries no signal; a dot marks one of three ports or more. Parts joined through frames form one mechanism, which must be a tree rooted at one World, with rails on parts that do not turn; it compiles to one state node (positions, then rates), its equations derived from the geometry. Refused, with the parts outlined: a closed loop, a part not joined to a World, two Worlds joined, a part joined the wrong way round (its base goes on the World's side), a rail on a part that turns, a joint that moves no mass, two joints with one coordinate name. A new Rail or Hinge takes coordinate names no other joint in the diagram has (x1, θ2).
- **Equations of motion**: selecting any part of a mechanism, or a masked subsystem that holds one, shows a fold *Equations of motion* (open on the World): the coordinates, one row per coordinate (Σ M·q̈ = Q with the velocity terms), V and T, in the names of the parameters as typed (a number shows as that number), common factors taken out (`l1·l2·(m2 + m3)`); hovering a coefficient shows its value for this plant.
- **Dead time** T_d (`e^(−T_d·s)`; the key stays `L`) has an output before T_d (default 0). Left empty (`null` in the JSON) it puts out its input at t = 0, as a pipe that was already flowing, so no start flow has to be computed and typed in ([designs.md](designs.md)). Every block with a dead time labels it "Dead time T_d" (the Transfer function's key stays `delay`): L is an inductance in the motor.
- **Transfer function** blocks show num(s) / den(s) with their coefficients on the canvas (`1 / (0.01s + 1)`); the Servo motor's armature is one of them, den `[L, R]` from its mask ([system-library.md](system-library.md)).
- **External plant** (group Live): a plant outside the page, run live over a WebSocket ([hil.md](hil.md)). Its inputs are what the page sends, its outputs what the plant measures; their names, units, limits (full scales) and safe values, the inputs' kinds (effort, reference, disturbance) and what a reference measures, the outputs' full scales, the cycle rate and the address are its parameters (comma lists), taken from the plant when it connects, and kept while it is connected (an edit or Undo that changes them is put back). The ramp-in (% of full scale per second) and full scales set for references are the page's own, kept across a reconnect and edited in the Live settings. Both sides' ports are labelled on the canvas; its summary says reference mode or logging. A system with one is not simulated offline ([hil.md](hil.md)). The design layer has no model of it: a variant from the plant on such a loop, and the Analysis tab, say so ([designs.md](designs.md)).

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
| Drag from a frame port to another, or onto a join's dot | Join them (Mechanics); joining two joins merges them |
| Click a join, `Del` | Select it, remove it; deleting a part takes its ports out of their joins |
| `Ctrl+G` on part of a mechanism | Refused: "rail and cart are joined to hinge 1, which is not selected: a mechanism stays in one diagram (select all of it, or none of it)" |
| Double-click a Switch | Move it to its next input (its number of inputs is a parameter) |
| Representation switch (Diagram, views) | Show the block diagram or one of the plant's views ([plant-views.md](plant-views.md)) |

## Library

The column can be resized by its separator, and each group folds open or closed (both remembered in the browser).

Signals (Source, Sink, Terminator) · Math (Gain, Sum with signs such as `+--`, Switch, Equations: named inputs and outputs, lines in the formula language of the Input tab, e.g. `E = 0.5*100*u^2`) · Dynamics (Integrator with start value and limits, Dead time, First order, Second order, Transfer function) · Models (first order with dead time, n equal lags, integrator with lag, double integrator, inverse response) · Sensors (Quantizer, Noise; lags and dead time are in Dynamics) · Physics (templates: Cart–pole, Pendulum, Double and Triple pendulum on cart, Conical tank, each a masked subsystem you can open) · Mechanics (World, Rail, Hinge, Mass, Rod) · Nonlinear (Saturation) · Structure (Subsystem, In, Out) · **My blocks**: subsystems the person saved, kept in the project file · **System library**: complete systems; a click here loads the plant ([system-library.md](system-library.md)).

## Simulation

`compileDiagram` (`src/core/diagram.js`) flattens subsystems and orders the blocks as Simulink does: blocks whose output depends on their state only (integrators, lags, dead time) first, then blocks that pass their input straight through (gain, sum, saturation) after their inputs. A loop made only of pass-through blocks is an **algebraic loop** and is refused with the names of the blocks in it; feedback through a block with state is fine. Everything is integrated with fixed-step RK4. Masks and formulas are resolved to numbers first, outermost first. In, Out, Sink and Terminator blocks only forward a value and are not evaluated (a subsystem costs nothing per step). The step comes from the fastest dynamics: each block's own poles, and the largest eigenvalue of the rates' Jacobian at the start state, so a fast loop of Integrators and Gains gets small enough steps ([detail-levels.md](detail-levels.md) §5); a run that is stiffer at its end runs again with the end's step, and when the step cap (400 000 steps) binds the run says which state needs which step. The run's warnings show on the status line under the screen (`loopTuner.info()`, `./runme.sh cli run`). In a closed loop (once a controller exists) the actuator, the plant and the sensor all run through the same compiler.

## Parameters panel

One block: label, parameters (typed, SI prefixes accepted, or a formula in the mask's names; the wheel nudges a number), its mask if it has one, Flip; Open and Save to library for a subsystem; "Edit signal" for a Source. Several blocks: Group, Delete. Nothing: the diagram's sources, sinks, and whether it is valid (errors in red, with the offending blocks outlined).

A mechanism integrates its state inside the diagram as one node; its joints' outputs are labelled at their ports, and their start values are the joints' parameters.

## Not yet

Ungroup; multiple plant inputs/outputs for a controller (MIMO); the disturbance as a Source on the plant input; copy and paste.
