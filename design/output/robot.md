# The PUMA 560: a robot in 3D from its URDF, controlled in end-effector coordinates

Reader: the agent who builds the PUMA example (vector signals, the URDF, the rigid-body blocks, the 3D view, the robot controller), or who adds another robot or a MIMO loop to Loop Tuner. This is the plan; what is built so far is listed under the notes below. The person's words are in [input 10](../input/2026-10-24-10-sliding-mode-and-triple-swingup.md), section "a PUMA robot in 3D from URDF". The research, its parameter tables and sources are in [../research/robot.md](../research/robot.md). Where the code and this plan differ later, the code and [decisions.md](decisions.md) win.

**The person's notes on this plan (2026-10-25, [input 14](../input/2026-10-25-14-puma-notes-size.md)); they override the plan where they differ:**
- The renderer may be a vendored library (for example three.js, inlined); our own WebGL renderer is not required. It must be real 3D with CAD-like navigation and a fallback where WebGL is missing. Size is no reason to choose (the page may grow to 20 MB).
- **Torques are the point** ([input 15](../input/2026-10-25-15-puma-torques.md)): every joint's torque τ1 … τ6 (N·m at the joint) is a signal, and so are the shares the model computes (inertial, Coriolis, gravity, friction). The scope opens on the two error components in the circle's frame (e_a, e_b, mm) and the shoulder and elbow torques (τ2, τ3). References, actual values, motor currents stay available as sources and Measure lines.
- Hidden probes are accepted to get the view running; later, views bind to visible Sinks and deleting a Sink in use warns.
- No Off variant until joint end stops are modelled (later).
- Built as planned for now; diagram variants may come back if the modelling needs them.


**Built (2026-10-25, branch feat/puma, decisions v2.9): the PUMA runs end to end** — steps 1, 2, 4, 5, 6, 7, 9 and 10 on top of the robot core and the renderer below. What runs, measured, and the deviations are in "The PUMA as built" right after this list; the rest of this page is the plan it was built from.

**Built before (branch feat/robot): step 3, the robot core; step 8's renderer; a kinematic demonstration.**
- **Core** (`src/core/xml.js`, `urdf.js`, `rbd.js`, `puma560.js`, in the bundle before `diagram.js`):
  - `parseUrdf(text, { inertia })` → `{ name, n, root, bodies, frames, links, joints, warnings }`, memoised by text. `joints` are objects (`{ name, child, axis, lower, upper, effort, velocity }`), not names. Every refusal of §3 has its sentence; "moves no mass and has no armature" is checked by `createRbd`, which knows the armature.
  - `createRbd(model, { armature, gravity, scale })`: `fk`, `linkPose`, `linkPoses` (every link's world pose: what the view takes each frame), `jacobian` (base or frame), `jdotqd`, `rnea`, `massMatrix` (CRBA in world coordinates), `bias`, `gravityTorque`, `forwardDynamics` (Cholesky), `torqueSplit(q, q̇, q̈, drive?)` → inertial, Coriolis/centrifugal, gravity, friction and total per joint, `energy`. Pure helpers: `jointFriction` (the drive's friction referred through the gears), `dampedInverse`, `sigmaMin`, `orientationError` (relative rotation, Shepperd, η ≥ 0), `cholesky`, `symEig`. The interface is torque-based: joint torques in, accelerations and the torque split out, so a motor model drives it later.
  - `PUMA560`: `urdf` (4.3 KB, no comments, the kinematics, inertias and limits of §3, our primitive shapes), `drive` (the drive table), `armature` (G²·Jm), `tool` ('flange'), `start` (degrees).
- **Measured** (test/robot.test.mjs, test/robot-circle.test.mjs):

  | Check | Result |
  |---|---|
  | Against the toolbox's own PUMA (values computed by running Robotics Toolbox for Python 1.5.0, stored in `test/fixtures/` with the script), 8 states | \|ΔM\| 8.0·10⁻¹⁵, \|Δg\| 7.1·10⁻¹⁵, \|Δτ\| 1.4·10⁻¹⁴, \|Δp\| 2.2·10⁻¹⁶, \|ΔR\| 1.1·10⁻¹⁶, \|ΔJ\| 3.3·10⁻¹⁶; friction (Coulomb as a step) to 10⁻¹³ |
  | Our URDF against the published set (unregrouped, built from the DH table in the test), 2 000 states | M 7.1·10⁻¹⁵, τ 1.4·10⁻¹⁴, pose 5.6·10⁻¹⁷: the regrouping is exact |
  | At qn | g = [0, 31.4237, 5.8190, 0, 0.0283, 0]; M11 3.6329, M12 −0.4075, M22 4.3868, M23 0.3240, M33 0.9109 |
  | At the start pose | flange (0.7296, −0.1500, 0.7264) m, tool down to 10⁻¹⁵; g = 0, 35.71, 7.84, 0, 0, 0 N·m |
  | CRBA against Σ JᵢᵀMᵢJᵢ and against RNEA column by column; RNEA∘FD; symmetric and positive definite (500 states) | 9.8·10⁻¹⁵, 8.9·10⁻¹⁵, 3.4·10⁻¹⁵ |
  | Torque split against RNEA + friction (300 states) | 2.8·10⁻¹⁴ |
  | J against central differences; J̇q̇ against d/dt(J·q̇) | 2.2·10⁻¹⁰; 4.7·10⁻¹⁰ |
  | Energy, 5 s free swing, RK4 at 1 ms, rotors on | drift 1.7·10⁻¹⁰ J against a peak kinetic energy of 70.8 J; with friction the energy never rises |
  | FK(IK(T)), closed-form IK in the test, 8 configurations × 200 poses | 5.7·10⁻¹⁵ |
  | Singularities (q5 = 0, q3 = −87.3°, wrist centre 0.150 m from the waist) | σ_min < 10⁻⁹; 0.175 at the start pose |
  | Orientation error at tool-down, 20 000 rotations within 2° | 6.9·10⁻¹⁸ (sign always right); θ exact at 10⁻⁹ rad and 179° |
  | The circle, followed kinematically (CLIK through the damped inverse, k 10, RK4 1 ms) | path error 1.4·10⁻¹² m; q1 −14.5…15.6°, q2 39.5…74.3°, q3 −206.5…−149.0°, q5 −70.5…−47.8°; 18.5° inside every range; σ_min 0.175…0.256; peak speeds 0.88, 0.73, 1.21, 0, 0.50, 0.88 rad/s; peak torques (with the drives' friction) 35, 59, 19, 0, 1.3, 1.4 N·m, inside the fuses |
  | Cost (Node 22, idle machine) | FK 0.49 µs, FK + J 0.53, J̇q̇ 1.17, RNEA 2.2, CRBA 1.9, forward dynamics 2.8 µs |
- **The 3D view** (`src/ui/view3d.js`, 1 105 lines; three.js r185.1 vendored unmodified in `src/vendor/three/` with its licence and sha256s, inlined by the build as its own `<script id="lt-vendor-three">` before the page's script; Export HTML copies it). `createView3d(container, { links, joints, camera, renderer, onPick, linkInfo })` → `setPoses`, `setPath(id, { points, times, now, style, fade, dash, gap })`, `setFrames`, `setView`, `fit`, `mode`, `refreshTheme`, `renderNow`, `screenOf`, `destroy`. WebGL with screen-space ribbons for paths and joint axes (the reference dashed by arc length in ch1's colour, the trail in ch2's fading over `fade`), labelled triads, joint labels, a floor grid; CAD navigation (orbit, pan, zoom to the cursor, WASD/QE, keys 0–6 and F, preset buttons, the axis triad and a clickable view cube with 26 targets, animated); hover names the link plus `linkInfo` (the demo shows its joint angle and torque); a Canvas2D painter on the same scene where WebGL is missing or its context is lost, back to WebGL on restore; tokens `--axis-x/y/z` in both themes. **Cel shaded** (branch feat/toon3d, input 25): `MeshToonMaterial` with a 4-texel ramp made in code (`TOON_RAMP`, `toonBand`, `toonRamp`; three bands), `LIGHT` (key 2.2 from the camera's upper left, ambient 0.94: lit = the token's colour, half ≈ 0.65, shadow 0.3 in linear light); each visual has an inverted hull (back faces, smoothed normals, pushed out 1.6 px on the screen) and its hard edges (`EdgesGeometry` at 30°, 1.2 px ribbons with a polygon offset) as children; `partRole(rgba)` turns a URDF colour into a role (saturated: accent; else light or dark by luminance) and `styleRobot` paints the role's token. The painter fills each face in the same band (`toonBand` of its normal), strokes silhouettes (an edge between a drawn and a hidden triangle) and hard edges (`meshEdges`) in `--part-line`, and steps the trail's fade (`bandAlpha`) as the shader does. The page grew by 6.5 KB. Frame cost at 820 px (PUMA demo, headless, SwiftShader): JavaScript about 0.9 ms in WebGL (0.8 before) and 2.4 ms in canvas mode (2.2 before); with the draw finished, 36 ms (26 before) in software GL, the hulls and edges drawing each part again. The page grew from 751 KB to 1 550 KB. A frame costs about 2 ms of JavaScript in WebGL, 4–5 ms in canvas mode (headless, software GL).
- **Demonstration**: `node tools/robot-demo.mjs --shots [folder]` writes `.harness/robot-demo.html` (git-ignored: the arm on its circle at t = 3.4 s, `?t=`, `?play`, `?canvas`, `?theme=dark`), screenshots `.harness/shots/puma-*.png` (WebGL and canvas, both themes, 1280 and 820 px) and times a frame (JavaScript, and with the draw finished). `node tools/view3d-shots.mjs [folder]` checks the view on a sample arm (both renderers and themes at 820 px, context loss and restore, hover, the view cube, flying) and times a frame.
- **Deviations from this plan, with reasons**:
  - **G carries the published signs** (−62.6111, 107.815, −53.7063, …), not the unsigned values of the params block above: Coulomb friction is measured per direction of the motor, and joints 1 and 3 turn their motors backwards, so unsigned ratios would apply their forward and reverse values the wrong way round. The armature (G²·Jm) is unaffected; a current's sign follows G.
  - **No ABA oracle**: CRBA is checked against two other algorithms (Σ JᵀMJ and RNEA column by column) and RNEA against the toolbox; a third algorithm adds no independence.
  - **The energy test runs on `forwardDynamics` directly**, not through the compiled Arm subsystem, which does not exist yet; repeat it through the compiler at step 4.
  - **The toolbox's values were computed by running the toolbox** (the script is stored with them), not copied from tables.
  - **The renderer is three.js**, as the person allowed (input 14); the Canvas2D fallback, ribbons, picking and navigation are ours. §7's line budget no longer applies.
  - **The damped inverse and the orientation error are core functions now**; the blocks of step 4 wrap them.

**The PUMA as built (feat/puma).**
- **Vector signals are a pass before the compiler** (`src/core/vectors.js`, agreed with the foundations branch, decisions v2.9): `flattenVectors(diagram, { ports })` takes a diagram whose wires connect port groups and returns a scalar diagram the compiler runs; a diagram without vectors comes back as itself (the library's fingerprints hold bit for bit, `test/vectors.test.mjs`). Widths are declared (Sources, Constants, robot blocks from the robot's n, Integrators from an x0 list or `width`, Controllers from `lanes`, Mux, Demux) or derived in one forward pass to a fixed point; a subsystem resolves port by port (a loop may leave by one port and come back by another); a block with state decides when nothing else can; a width-1 source broadcasts; a mismatch is refused naming both ends. Today's blocks work element by element (copies `gain[2]`; an Integrator's element takes its x0 and is labelled by it, `PUMA 560/Arm/q3`); Mux and Demux create no block (their outputs are aliases resolved through the wires); a vector Sink records one signal per element (`q` → q1…q6, or `"x,y,z"` with `"m,m,rad"`); a Source with `derivatives` 1 or 2 has outputs ṙ, r̈ (signals.js computes them exactly: the eased sine, chirp, ramp; steps warn; noise is refused); a Controller with `lanes` n is n scalar Controllers `servos[1]`…`servos[n]` sharing its variants, with an `ff` input group; a Finite difference Observer with one u and one y group puts out ŷ and ẏ as wide as y.
- **The blocks only vector diagrams have** register into `ELEMENTS` (`VECTOR_ELEMENTS`): Mux, Demux, Constant (`vectors.js`); Matrix Gain, Product, Solve (Cholesky when symmetric positive definite, else LU; a singular A stops the run with a sentence), Norm, Friction (`mathblocks.js`); Forward kinematics, Jacobian, J̇q̇, Mass matrix, Bias forces, Inverse dynamics, Torque split, Damped inverse, Orientation error, Frame transform, Joint limits (`robotblocks.js`). Each compiles to one scalar `mimo` node (inputs straight through to outputs, allocation-free; blocks of one robot share its rigid-body workspace, cached by q). Costs per call: FK 0.34 µs, Jacobian 0.42, J̇q̇ 0.42, mass matrix 1.5, bias 1.24, inverse dynamics 1.7, torque split 2.3, damped inverse 3.7 (most of it the exact σ_min).
- **Changes to `diagram.js` and `sim.js`**, all small and listed for the foundations branch: the import of the pass and `...VECTOR_ELEMENTS` in `ELEMENTS`; `compileDiagram` calls `flattenVectors` after formulas are resolved; `normalizeDiagram` keeps the extras (`vectorExtras`) and the root's `robots`; vector blocks' number fields may be formulas; the `mimo` node kind (and its taps in model mode); a Source's `derivative`; the Controller's ports count `ff`, its node knows `lane`, `lanes`, `ff` (passed to designs); a grouped observer names its estimates ŷk, ẏk; a hand Finite difference is looked through by designs (`differenceSees`, `job.see`); **the rate slice** (RK4's stages evaluate only what the state rates, the Out and External plants read) and **fewer evaluations at a sample** (the outputs are evaluated again only before a sampled block that reads one sampled since, and once at the end); `info.validity` (Joint limits' reports) in `simulateSystem`. Both fast paths leave every library system bit for bit as it was.
- **The design layer**: `speedPI` (controllers.js; `speedPIDesign` in design.js; its picture in structure.js), per lane: b = ∂ẏ/∂u at the start state by a central difference of the lane's model (the finite difference looked through to the joint's speed state), Kv = 2ζω/b, Ki = ω²/b, u0 = the trim of all lanes at once (B·u = −a0 over the measured speeds' rates, from each lane's model: `ctx.laneModel(k)`) less Kf times the ff input at the start; inputs ω, ζ, Kf, integral, limit per lane, anti-windup. pidCore takes the ff term inside the limits (`g.uff`). The lanes' designs note once that the other lanes hold their outputs.
- **The system** (`src/core/pumasystem.js`, in the library after the triple pendulum): Circle reference (a_r, b_r with derivatives, Mux with a Constant 0, Frame transform "base ← circle" placed at the forward kinematics of the start pose); Robot controller (Encoder speed: a Finite difference; Axes → task; Task law; Task → axes; Model feedforward: inverse dynamics plus G·Friction(G·q̇*); Axis servos: one Controller, 6 lanes, ff, three speedPI variants; torque → current); PUMA 560 (Motor drives: six masked Motor subsystems with G, kt, imax, B, Tcp, Tcn, ωs on the mask and the current a Sink; Arm: τ − h, Solve with the mass matrix, two vector Integrators from the start pose, Joint limits, Torque split). Top level: Tool pose, the error in the circle's frame (Sinks ea, eb, ec in mm, e = ‖·‖), the tool's and the reference's position (x, y, z; xr, yr, zr). Signals: a_r, b_r; q1…q6; i1…i6; tau1…tau6 and the shares tauI, tauC, tauG (each 1…6) and the motors' tauF1…tauF6; eo (°), sigma. Scope: ea (Measure), eb, tau2, tau3. View: the 3D Robot, bound to the Sinks q, x/y/z and xr/yr/zr.
- **Measured** (Node 22, 4 cores, load about 1; `test/puma.test.mjs`):

  | Check | Result |
  |---|---|
  | The compiled PUMA against the loop written plainly (`test/puma-reference.mjs`), 5 s, all three variants | \|Δq\| ≤ 4.9·10⁻¹⁵ rad, \|Δp\| ≤ 1.8·10⁻¹⁵ m |
  | PI + model feedforward | e rms 0.049 mm, max 0.070 mm; orientation ≤ 0.0012°; peak currents 2.47, 2.40, 1.49, 0.00, 0.26, 0.33 A; τ2 peaks at 43.8 N·m, τ3 at 8.9 |
  | PI, no model | 1.80 / 4.30 mm; orientation 0.31° |
  | P only, no model | 8.6 / 10.9 mm; orientation 1.4° |
  | Gains per lane (ω 30, ζ 1) | b 0.2495, 0.2260, 1.171, 5.192, 5.836, 5.152; Kv 240.5, 265.5, 51.2, 11.6, 10.3, 11.7; Ki 3608, 3982, 768, 173, 154, 175; u0 without the model 0, 35.71, 7.84, 0, 0, 0 N·m |
  | Inside the arm | every joint ≥ 15° inside its range, σ_min ≥ 0.175, currents under the fuses, no report; a circle of 0.3 m reports j2 leaving its range |
  | The reference path | a circle of 0.15 m to 10⁻⁹ |
  | A 5 s run (compile, six designs, 5 000 RK4 steps at 1 ms) | 0.44–0.60 s in Node (`node cli.mjs run`: 0.58 s with its output); the plan's target ≤ 0.6 s |
- **Deviations from the plan, with reasons**:
  - **The 3D view binds to visible Sinks** (q, x, y, z, xr, yr, zr), not hidden probes: what the person prefers in the end (input 14), and the Live form already binds by name. Deleting a Sink a view uses does not warn yet (roadmap).
  - **The circle's frame is placed from a Constant start pose through Forward kinematics**, not by an Initial value block: a latch is state the model compile would see at the wrong instant; the start pose is then on two blocks (the Arm's Integrator and this Constant) until masks take lists.
  - **Masks hold numbers, not lists** (the foundations' masks): each Motor has its drive's numbers on its mask, its blocks' fields are formulas in them; the controller's model of the six drives (1/(G·kt), G and the friction lists) and the start pose stay lists on blocks. The root mask with vectors and `[j]` is left.
  - **P only tracks to 8.6 mm, not 14**: its u0 is the trim (gravity held), as speedPI computes it for every variant without the model; the plan's 14 mm had none.
  - **No Copy as numbers for speedPI**: its twin would need a PID with an ff input; left.
  - **Analysis closes the other lanes by their own law** (`closeLanes` in project.js), instead of holding them at their trim (§5): held, gravity makes the arm unstable at about 1.3 rad/s and every lane would read unstable. A lane's "Start" is the run at t = 0. Per lane at Start, with the model: crossover 68.7–70.7 rad/s, phase margin 78–82°, gain margin ×28.8, Ms 1.04, delay margin about 20 ms. The PI variants read "marginal": one pole stays at z = 1 (where a joint comes to rest under its own integral is free; the task law holds it, which the analysis leaves out, and its note says so); P only reads unstable for the same reason (gravity pulls the free joints slowly, ×e in 12 s). At rest (q = 0) is refused as a kink (the arm is singular there). Auto-tune refuses a lanes Controller with a sentence.
  - **The HIL simulator does not offer the PUMA** (`vectors: true` on the entry): its plant rewriting is scalar; a HIL robot plant was not built (§13).
  - **Not built**: the root mask; Initial value; frame labels on wires and frame warnings; the cheap σ_min trigger (a block cannot yet tell whether its σ_min output is read); Joint limits checks position and velocity, not effort; the voltage check of the drives; per-lane Relay and step Auto-tune.

**How this plan was made.** Two designs were prototyped on 2026-10-25 and scored by two judges. Design A ("vector signals first": vector wires, explicit transformation blocks, control in end-effector coordinates on the measured pose, the arm opening to M(q)·q̈ = τ − h) won, 8/10 and narrowly 6.9 against 7.0. Design B ("joint space first": a closed-loop inverse kinematics reference, scalar wires drawn as ribbons, a sealed Robot block) scored 6.5/10 and 7.0. This plan takes A and grafts from B:
- the circle in its own frame, given by two references a_r and b_r, and a Frame transform block;
- a pure circle with an eased phase, from B's start pose;
- frame labels on wires;
- an orientation error that cannot flip sign;
- speed measured as the encoder's difference over Ts;
- B's range reports;
- B's compile strategy (declared widths, a scalar graph underneath) and its fast paths;
- one openable motor per joint;
- the inline URDF view for Live plants.

It also drops A's Controller variants that are diagrams. §5 says why. The numbers below were measured on the prototypes in the session scratchpad (§9 lists them), on Node 22.22 on a shared 2.8 GHz Xeon with a load average of 6 to 13, so times are ±30 %. Nothing in the repository was changed.

## 0. Bottom line: what the person sees

**System library › "PUMA 560, a circle in space" opens running, on the Plant tab's 3D view "Robot".**

- **The arm** is drawn from its URDF in simple shapes: pedestal, shoulder, upper arm, forearm, wrist, flange and a pointer for the tool. It is posed by the joint angles at the scope's instant: the scan line while it sweeps, the cursor while the mouse is on the plot.
- **The reference path** is drawn dashed in channel 1's colour. It is a horizontal circle of 0.15 m radius, 0.726 m above the floor, through the tool's start point, with its centre towards the robot. It takes 2.5 s per turn after a 0.5 s eased start, so the 5 s screen holds about two turns.
- **The tool's trail** is drawn in channel 2's colour and fades over one turn (2.5 s).
- **Three frames are drawn as triads**: the base, the tool (flange), and the circle's own frame, whose axes a and b are the person's two reference values. Thin labelled lines j1…j6 mark the joint axes.
- **Navigation is CAD's** ([decisions.md](decisions.md)): orbit, pan, zoom, WASD/QE, preset views, the axis triad and the clickable view cube.

**The scope** shows, at 0.5 s/div:

| Channel | Signal | What it is |
|---|---|---|
| ch1 | `a_r` (m) | the reference along the circle frame's a axis: a Source the person edits in the Input tab |
| ch2 | `a` (m) | the tool's actual position along a, from forward kinematics of the true joint angles, mapped back into the circle's frame |
| ch3 | `e` (mm) | the tracking error ‖p_d − p‖, with its Measure line (rms 0.049 mm) |
| ch4 | `i2` (A) | the shoulder motor's current: about 1.45 A of gravity load plus the circle's frequency and the friction's odd harmonics. It is the selected channel, so pressing Spectrogram shows its harmonics |

Interpretation: the person's "in the spectrogram, we see reference values, actual values, current on one of the motors" is read as the scope. It opens in Time, and one key shows i2's spectrogram.

**The Controller tab** shows "Axis servos", one Controller block with six lanes. Its variants are computed by the design layer:

| Variant | Tracking error (rms / max) | What you see |
|---|---|---|
| PI + model feedforward (runs first) | 0.049 / 0.070 mm | The trail lies on the dashed circle |
| PI, no model | 1.8 / 4.3 mm | Visible on the scope (e) and in the current; the integrals carry gravity and friction late |
| P only, no model | 14 / 22 mm, orientation 3.4° | The trail runs visibly inside and behind the circle in 3D |

**Double-clicking opens everything** ([transparent-models.md](transparent-models.md): no black boxes):
- Circle reference: two Sources, Muxes, a Frame transform "base ← circle".
- Robot controller: encoder speed, the two transformation groups **Axes → task** and **Task → axes**, the task law, the model feedforward, the Axis servos, torque to current.
- PUMA 560: six Motor subsystems and the Arm. Each Motor j opens to its current limit, kt, friction and gear, with the current as a Sink. The Arm opens to M(q)·q̈ = τ − h(q, q̇), with Mass matrix, Bias forces, Solve and two Integrators, plus a sheet of the URDF's links and joints with the equations.

**The two things this example shows** (judge's rule: one or two things per example):
1. A reference given in end-effector coordinates, transformed into speed and acceleration targets for six single-axis loops. This is the person's "controlling in end effector coordinates and then transforming the values into speed and acceleration values for the single axis".
2. What a model of the arm buys. With model feedforward the error is 0.05 mm. With feedback alone and integral action it is 2 mm, seen on the scope. With P alone it is 2 cm, seen in 3D.

## 1. Coordinate systems and transformation blocks

**Four coordinate systems, each named on every wire that carries one** (from B). A port group carries its frame as metadata, and the wire is labelled with it ("q1…q6 rad · joints", "x, y, z m · base", "a, b, c m · circle"):

| Frame | What it is | Where it comes from |
|---|---|---|
| `joints` | the six joint angles q1…q6 (rad), speeds, torques, currents | the arm's Integrators; the motors |
| `base` | Cartesian, origin on the floor under the waist axis, z up | the URDF's root link |
| `tool` | the flange's frame, 56.25 mm beyond the wrist centre | the URDF's fixed joint `flange`; R (base ← tool) is a 3×3 output |
| `circle` | the reference's own frame: axes a, b in the circle's plane, c normal to it | a Frame transform placed at the tool's start point (§6) |

Element-wise blocks pass their input's frame through. A Sum of two different frames gets a warning ("adds a vector in base to one in circle"). A wire whose frame differs from what the input declares gets a warning too ("v* is in base; r of 'Axis servos' expects joints"). These are warnings, not refusals: a hand-built diagram may know better.

**The transformation blocks** (Robot group). Each reads the robot named in its `robot` parameter (§3) and shows its one-line law on its face. Hovering shows its values at the scope's instant, with J and M as 6×6 tables.

| Block | Parameters | In → Out | Law (its face) |
|---|---|---|---|
| Forward kinematics | robot, frame (link, default the last), base (link, default root) | q (6, joints) → p (3, base), R (9, base ← tool) | T(q) = Π T_joint,i(q_i) · T_fixed; "q → p, R (base ← flange)" |
| Jacobian | robot, frame, expressedIn (base or frame) | q → J (6×6, rows v then ω) | geometric: J_j = [z_j × (p − o_j); z_j] (Corke's jacob0; jacobn when expressed in the frame) |
| J̇q̇ | robot, frame | q, q̇ → 6 (base) | the frame's acceleration with q̈ = 0 and no gravity (one forward Newton–Euler pass) |
| Damped inverse | ε 0.04, λ_max 0.05 | J (m×n) → J⁺ (n×m), σ_min (1) | J⁺ = Jᵀ(JJᵀ + λ²I)⁻¹, λ² = λ_max²(1 − (σ_min/ε)²) when σ_min < ε, else 0 (the exact inverse). It is dormant away from singularities |
| Orientation error | – | R_d (9), R (9) → e_o (3, base), θ (1, rad) | the relative rotation R_e = R_d·Rᵀ, its quaternion (η_e, ε_e) by Shepperd's method with η_e ≥ 0; e_o = ε_e = sin(θ/2)·k; θ = 2·atan2(‖ε_e‖, η_e) |
| Frame transform | rpy (3), groups ("p, v, a"), origin (input), inverse 0/1 | per group 3 (+ origin 3) → the same groups | p = o + R(rpy)·p_c; v = R·v_c; a = R·a_c. Inverse: p_c = Rᵀ(p − o). Face "base ← circle". Its origin and rotation are recorded as probes for the 3D triad |

**Two masked groups give the person the transformation at one glance** (A):
- **Axes → task**: Forward kinematics, Jacobian, J̇q̇ and a Product J·q̇. It maps q, q̇ (joints) to p, R, v, J, J̇q̇ (base).
- **Task → axes**: Damped inverse, two Products and a Sum. It maps v*, a*, J, J̇q̇ (base) to q̇* = J⁺·v* and q̈* = J⁺·(a* − J̇q̇) (joints), with σ_min. This is the person's "transforming the values into speed and acceleration values for the single axis".

**Why the orientation error is built this way.** At the start pose the tool points straight down: R = diag(−1, 1, −1), a half turn about y, whose quaternion has a scalar part of 0. A's specified form, e_o = η·ε_d − η_d·ε − ε_d × ε, takes the quaternions of R and R_d separately. B found that the sign then flips with rounding: the wrist turned a full revolution and the tool missed by up to 103 mm. Measured for this plan, over 20 000 random rotations within 2° of tool-down:
- the separate-quaternion form, each quaternion with its scalar part made ≥ 0, gives the error the wrong sign in 9 847 cases (positive feedback);
- the relative rotation's quaternion is exact to 2.1·10⁻¹⁷, because R_e is near the identity, so η_e is near 1 and no sign is in doubt.

The textbook display form acos((tr(R_dᵀR) − 1)/2) reads 0 for an error of 10⁻⁹ rad. The atan2 form reads it exactly. A test holds both at the tool-down pose (§11).

## 2. Vector signals

**A wire carries a vector or a matrix; the compiler flattens it into the scalar nodes it already has** (A's model, built B's way). Model mode, `el.seen`, `linearize.js` and the planner keep seeing scalars.

**Port groups.** A block definition gains `portGroups(p)` → `[{ side, name, shape, names, unit, frame }]`.
- `shape` is `[n]` or `[r, c]`. A matrix wire carries r·c elements row by row (J is [6, 6]).
- `names` are the element names (`q1…q6`, `x, y, z`).
- `unit` is one unit or a list (v is "m/s ×3, rad/s ×3").
- Today's blocks have one group of width 1 per port, so a port index is a group index, and every existing file and wire (`sum:1`) means what it meant.

**Wires connect whole groups.** In the file a vector wire is one entry: `{ "from": "fk:1", "to": "law:2" }`, where the indices count groups. Elements are taken apart with Demux and joined with Mux, never addressed in a wire. The top level of the PUMA has about 20 wire entries; B's scalar form had about 125.

**No inference in Simulink's sense** (the engineer's rule). Each output's shape is either declared or a function of its inputs' shapes, computed in one forward pass in signal order:
- **Declared** where a value starts:
  - Sources and Constants;
  - robot blocks (from the robot's n);
  - Integrators (from x0's shape or `width`);
  - Controllers (from `lanes`);
  - Mux (from its inputs' widths);
  - Demux (from `sizes`).
- **Derived**:
  - element-wise blocks take the widest input, and a width-1 input broadcasts;
  - Gain with a matrix K maps c to r;
  - Product maps A (r×c) and B (c×k) to r×k;
  - Solve maps A (n×n) and b (n) to n.
- A loop passes through a state block whose shape is declared, so the pass has an anchor.
- A mismatch is refused with a sentence naming both ends: "Product 'J⁺v*': J⁺ is 6×6 but v* has 3 elements (the inner sizes must agree)", or "'q̇*' has 6 elements; input r of 'Axis servos' takes 3 lanes".

**New primitives (Signals and Math).**

| Block | Parameters | In → Out | Law |
|---|---|---|---|
| Constant | value (number, vector or matrix), unit | → shape of value | y = value |
| Mux | inputs: a count or widths ("3,3") | ports → Σ widths | joins; creates no node |
| Demux | sizes ("3,3"); unused outputs may stay open | ═w═ → ports | splits; creates no node |
| Initial value | – | u → u(0) | latches its input at t = 0 and holds no state. In model mode it reads the model's start state |
| Product | – | A (r×c), B (c×k) → r×k | A·B |
| Solve | – | A (n×n), b (n) → x (n) | A·x = b. Cholesky when A is symmetric positive definite, else LU with pivoting. A singular A is refused at that instant with a sentence, and the run stops there |
| Norm | – | ═n═ → 1 | √Σu² |
| Friction (Nonlinear) | B, Tcp, Tcn, ω_s (scalars or vectors) | ω (n) → τ_f (n) | τ_f = B·ω + Tc±·tanh(ω/ω_s), Tc⁺ for ω ≥ 0, Tc⁻ below. Its power τ_f·ω is never negative. In model mode it is B·ω only, with a note: a Coulomb step has no slope at 0, and the smoothing's slope is an artefact |

**Changed blocks.** All are backward compatible: their defaults reproduce today's behaviour bit for bit.
- **Gain**: K may be a scalar, a vector (element-wise) or a matrix (K·u). The JSON shape decides.
- **Sum, Saturation, Integrator, the lags, Dead time, Quantizer, Noise**: element-wise, with `width` (default 1) or a vector parameter's length. Width-1 inputs broadcast.
- **Integrator**: transparent-models' fields (x0, min, max, unit, angle), each a scalar or a vector.
- **Sink**: on an n-wide wire it records n channels. A base name is numbered (`i` → i1…i6). A comma list names each element (`x, y, z`). The unit is one unit or a comma list.
- **Source**: `derivatives` 0–2 adds outputs ṙ and r̈, computed analytically per component (§6).
- **Observer**: its u and y ports are groups. Its estimates form groups named by its variant (Finite difference: y and ẏ, each as wide as the measurements). An Observer whose running variant does not read u may leave u open without a warning.
- **Controller**: `lanes` and `ff` (§5).

**On the canvas** (not prototyped):
- A vector wire is drawn as a hollow double stroke labelled with its count and frame ("6 · joints"), so it cannot be mistaken for the selected state.
- A port group shows a bracket.
- Hovering a wire lists its elements by name with their values at the scope's instant. A matrix shows as a table.
- A width-1 wire stays a single line.

## 3. The robot description (URDF) and the physics

**The URDF lives once, in the plant diagram's `robots` map, keyed by name** (A). It is not a block parameter, and not referenced by id path (B), which would break on a rename or regroup. About ten blocks and the 3D view read it:
- the Arm's Mass matrix, Bias forces and Joint limits;
- the top-level Tool pose;
- the controller's Forward kinematics, Jacobian, J̇q̇ and Inverse dynamics.

```json
"plant": { "type": "diagram", "diagram": {
  "robots": { "puma560": { "urdf": "<robot name=\"puma560\">…</robot>", "gravity": [0, 0, -9.81] } },
  "mask":   [ { "key": "G", "label": "Gear ratio", "unit": "1" }, { "key": "Jm", "label": "Rotor inertia", "unit": "kg·m²" },
              { "key": "kt", "label": "Torque constant", "unit": "N·m/A" }, { "key": "B", "label": "Viscous friction (motor)", "unit": "N·m·s/rad" },
              { "key": "Tcp", "label": "Coulomb friction forward (motor)", "unit": "N·m" }, { "key": "Tcn", "label": "Coulomb friction reverse (motor)", "unit": "N·m" },
              { "key": "ws", "label": "Friction smoothing ω_s (motor)", "unit": "rad/s" }, { "key": "imax", "label": "Current limit", "unit": "A" },
              { "key": "Ra", "label": "Armature resistance", "unit": "Ω" }, { "key": "Vmax", "label": "Amplifier voltage", "unit": "V" },
              { "key": "q0", "label": "Start pose", "unit": "rad" } ],
  "params": { "G": [62.6111, 107.815, 53.7063, 76.0364, 71.923, 76.686], "Jm": [2e-4, 2e-4, 2e-4, 3.3e-5, 3.3e-5, 3.3e-5],
              "kt": [0.227, 0.228, 0.238, 0.0675, 0.0718, 0.0534], "B": [1.48e-3, 8.17e-4, 1.38e-3, 7.12e-5, 8.26e-5, 3.67e-5],
              "Tcp": [0.435, 0.126, 0.105, 0.0112, 0.00926, 0.00396], "Tcn": [0.395, 0.0709, 0.132, 0.0169, 0.0145, 0.0105],
              "ws": 2, "imax": [8.83, 8.77, 8.74, 4.42, 4.42, 4.49], "Ra": [2.1, 2.1, 2.1, 6.7, 6.7, 6.7], "Vmax": 40,
              "q0": "[0, 40, -150, 0, -70, 0]*pi/180" },
  "blocks": [ … ], "wires": [ … ] },
  "views": [ { "name": "Robot", "kind": "3d", … } ] }
```

**System parameters.** `mask`/`params` on the root diagram is transparent-models' subsystem mask, put at the root as a model workspace. The plant (motors, the arm's armature) and the controller (torque-to-current, friction feedforward, the axis limits) both need G, kt and the friction values, and no number is typed twice.
- Values may be vectors.
- Formulas act element by element: the armature `G^2*Jm` shows as "G^2*Jm → 0.78, 2.32, 0.58, 0.19, 0.17, 0.19 kg·m²".
- `X[j]` takes element j, 1-based as the joints are numbered (from B). Motor j's mask sets `j`, and its blocks read `G[j]`, `kt[j]`.
- With nothing selected, the Plant tab shows these parameters and the robots: "puma560 · URDF 4.3 KB · 6 joints · View". The URDF is read-only in the page for now and edited in the JSON.

**Parsing** (`core/xml.js` and `core/urdf.js`). Our own XML reader, about 50 lines: Node has no DOMParser, and the tests and the page share the code. The text becomes a read-only robot model, memoised by its text per page:

```
{ name, n, root, gravity,
  bodies: [{ joint, link, parent, E, r, axis, lower, upper, effort, velocity, inertia: { m, c, I } }],
  frames: Map(link → { body, R, p }), links: [{ name, visuals: [{ R, p, geom, material, rgba }] }],
  joints: ['j1', …], warnings }
```

- Fixed joints merge into their body: they give a frame, and their link's inertia is added.
- rpy follows urdfdom: R = Rz(yaw)·Ry(pitch)·Rx(roll). An inertial origin's rpy rotates the inertia. A missing axis is (1, 0, 0) and a missing origin the identity.
- **Refused, with a sentence each:**
  - floating or planar joints;
  - prismatic joints (in v1);
  - Xacro;
  - two roots, or a cycle;
  - a revolute joint without `<limit>`;
  - a non-physical inertia ("link3: moments 0.066, 0.0125, 0.086 break the triangle inequality: no rigid body has them"; also one that is not positive semi-definite);
  - a movable joint that moves no mass and has no armature.
- A mesh cannot be fetched by a standalone page. It is drawn as its collision primitive, or as a box, and the panel says so.
- Joint `<dynamics damping friction>` must be 0 or absent, with a sentence otherwise. Friction lives in the motors, and counting it twice would be wrong.
- Each block builds an allocation-free workspace from the model. Blocks of one robot in one evaluation group share it through a kinematics cache keyed by q.

**Our URDF** (4.3 KB, our own primitive geometry, no meshes, no XML comments, numbers at full precision):
- **Kinematics**: Corke's standard DH (Paul's convention) re-indexed as URDF joints.
  - j1 at xyz (0, 0, 0.67183), the pedestal;
  - j2 at rpy (π/2, 0, 0);
  - j3 at xyz (0.4318, 0, 0.15005);
  - j4 at xyz (0.0203, 0.4318, 0), rpy (−π/2, 0, 0);
  - j5 at rpy (π/2, 0, 0);
  - j6 at rpy (−π/2, 0, 0);
  - a fixed joint `flange` 0.05625 m beyond the wrist centre.
- **Inertias**: Armstrong, Khatib & Burdick's, in those frames, with the research's corrections: link 4's centre of mass at −0.019, link 3's at −0.014, and link 1's mass 13 kg.
- **Limits**: the toolbox's ranges. Effort is the fuse-limited torque (56, 97, 52, 10, 10, 10 N·m). Velocity is the back-EMF limit (1.92, 1.51, 2.40, 5.34, 5.09, 5.74 rad/s).

**A finding the parser forces** (A): the published link-3 moments (0.066, 0.0125, 0.086 kg·m² in the URDF frame) break Ixx + Iyy ≥ Izz. No rigid body has them, and B's prototype shipped them because its parser did not check.
- **The fix keeps the dynamics exactly**: add δ = 0.01 kg·m² to link 3's ixx and iyy, the two axes normal to joint 3, and take δ from link 1's izz, the waist axis. That gives 0.076, 0.0225, 0.086 and 0.34.
- **Why it is exact**: joint 3 is parallel to joint 2, and joint 2 is normal to the waist axis. So δ·(I − z₃z₃ᵀ) on link 3 adds ½·δ·q̇1² of kinetic energy, the same as δ on link 1's waist moment (base-parameter regrouping).
- **Checked**: M(q) and RNEA's τ agree with the published set to 1.8·10⁻¹⁵ kg·m² and 7.1·10⁻¹⁵ N·m over 2 000 random states.
- Link 3 is then a plausible forearm: rms extents 0.06 × 0.12 × 0.04 m for 4.8 kg.

**The Arm** (subsystem "Arm" inside "PUMA 560"):

```
In τ ═6═► Σ(+,−) ═6═► Solve ═ q̈ (6) ═► ∫ q̇ (x0 0) ═6═► ∫ q (x0 "q0", angle) ═6═► Out q
          ▲ h                ▲ M                ║ q̇ ══════════════════════════════════► Out q̇
Bias forces (q, q̇) ═6═╝   Mass matrix (q; armature "G^2*Jm") ═36═╝          Joint limits (position, velocity, effort)
```

- **States**: q1…q6 (rad, angle) and q̇1…q̇6 (rad/s): two vector Integrators, 12 states, labelled `PUMA 560/Arm/q1…`. The q Integrator is first in the diagram, so the order is positions then rates, as for mechanisms.
- **Forward dynamics is CRBA + RNEA + Cholesky, not ABA.**
  - The open form (M, h, Solve) is CRBA-shaped. ABA cannot be opened into blocks a person reads.
  - CRBA takes 3.25 µs, RNEA 1.24 µs, and the whole forward dynamics 4.33 µs. Dense, unoptimised ABA takes 13.6 µs; Featherstone and Orin put the crossover above 9 links.
  - The controller needs M(q) and RNEA anyway, so the physics and the controller's model read side by side, from the same blocks.
  - ABA stays as the test oracle; it agrees to 1.7·10⁻¹³ rad/s².
- **Rotor inertia G²·Jm sits on M's diagonal** (the arm's `armature`), not in the motor. A motor block that needed q̈ would make an algebraic loop through Solve. Drake (`rotor_inertia`) and MuJoCo (`armature`) do the same. The motor's face says "its rotor turns with the joint: G²·Jm is in the arm's mass matrix".
- **Joint limits** (Robot group) is a Valid range ([detail-levels.md](detail-levels.md) §4) whose limits come from the URDF. `check`: position (lower/upper), velocity, effort. Element-wise, it reports each joint's first violation: "j3 left its range (−225 … 45°) at 2.31 s: the real arm stops there". In model mode it is a Terminator.
- **The sheet**: selecting the Arm, its Mass matrix or its Bias forces shows a fold "Links and joints". It holds a table read from the URDF (link, parent, origin, axis, limits, mass, centre of mass, inertia), the equation M(q)·q̈ + C(q, q̇)·q̇ + g(q) = τ with M = Σ JᵢᵀMᵢJᵢ + diag(armature), and each block's algorithm sentence.
- **No "Off" variant.** Without joint stops the arm would fall through its own range, which "physics can never be wrong" forbids drawing as if it were real. The Joint limits block reports the first violation instead.

**Physics checks** (prototype A, re-run in the B prototype):

| Check | Result |
|---|---|
| Against Corke's Robotics Toolbox for Python 1.5.0, run on 8 states (qz, qr, qs, qn and 4 random; pedestal 0) | \|ΔM\| 8.9·10⁻¹⁶, \|Δg\| 7.1·10⁻¹⁵, \|Δτ\| 7.1·10⁻¹⁵, \|Δp\| 5.6·10⁻¹⁷, \|ΔR\| 2.4·10⁻¹⁶, \|ΔJ\| 2.2·10⁻¹⁶ |
| The corrected set at qn | g = [0, 31.4237, 5.8190, 0, 0.0283, 0] N·m; M11 3.6329, M12 −0.4075, M22 4.3868, M23 0.3240, M33 0.9109 (matching the research to 4 decimals) |
| RNEA∘FD = identity | 2.8·10⁻¹⁵ (relative) |
| M(q) | symmetric and positive definite in all 500 random states |
| J against central differences; J̇q̇ against d/dt(J·q̇) | 2.8·10⁻¹⁰; 1.9·10⁻⁹ |
| Energy, 5 s free swing, no torque or friction, RK4 at 1 ms, rotors on | \|E − E0\| ≤ 2.8·10⁻¹⁰ J against a peak kinetic energy of 72 J (1.7·10⁻⁷ J at 5 ms) |
| Gravity at the start pose [0, 40°, −150°, 0, −70°, 0] | 0, 35.71, 7.84, 0, 0, 0 N·m, held by 0, 1.453, 0.614, 0, 0, 0 A |

## 4. Motors

**Superseded in part by [servo.md](servo.md) (2026-10-25, [input 23](../input/2026-10-25-23-servo-answers-backlash.md)):** each Motor j is the shared Servo motor component (current drive, coupled shaft). The rotor's inertia moves into the motor, so the arm's plant mass matrix loses G²·Jm (the controller's model keeps it), and the joint couples through an elastic gear (50 Hz) with backlash as a switch. Coulomb friction is on by default, and the encoder and ripple errors are switches, off, at realistic sizes. The sketch below is the first design.

**"Motor drives" opens to six subsystems, Motor 1 … Motor 6, one per joint, as the person was told** (judge's graft). Each is the same masked subsystem with its own `j`, and its wires are scalar:

```
i*_j ─►[Saturation ±imax[j]]─ i_j ─┬─►[Gain kt[j]]─►(Σ + −)─►[Gain G[j]]─► τ_j  (link side, N·m)
                                   └─► Sink i{j} (A)        ▲
q̇_j ─►[Gain G[j]]─ ω_m ─►[Friction B[j], Tcp[j], Tcn[j], ws]┘
                     └─►[Drive voltage: v = Ra[j]·i + kt[j]·ω_m]─►[Valid range ±Vmax]
```

- Around them: Demux i* (6) and q̇ (6) in, Mux τ (6) out. Its face reads "6 geared DC motors, current drives".
- **Level 1, the default: an ideal current source with a limit.** The Unimate drive was a current amplifier; its current loop is flat to 400 Hz and settles in under 0.5 ms. So there are no electrical states, and the run steps at the 1 ms record.
- **The voltage check** catches what level 1 cannot model: "Motor 2's amplifier needs 41 V at 2.31 s: beyond its 40 V, the current loop cannot hold i* (a voltage-drive level models it)". On the circle the drives need at most about 23 V.
- Detail levels for later ([detail-levels.md](detail-levels.md)): level 2 adds the 400 Hz current loop; level 3 adds the voltage drive with R–L winding and back-EMF.
- **Friction** is referred to the motor as published, at the motor speed G·q̇. It is smoothed over ω_s = 2 rad/s at the motor, which is 0.02–0.04 rad/s at the joints. Its validity sentence: "below ω_s a joint creeps under a steady load instead of sticking; breakaway (stiction) is not modelled". The smoothing makes the stiffest mode at rest Tc·G²/(ω_s·J_eff), 213 1/s on joint 1. RK4 at the 1 ms record is far inside its stability limit. A's prototype found the run within 2.3·10⁻⁹ rad of a 0.05 ms reference, so the smoothing forces no small step.
- **The wrist's gears are independent**, as in Corke's toolbox. The real wrist couples motor 6 to joint 5 (13/72·G6) and motors 5 and 6 to joint 4. On this circle q4 stays 0, so only motor 6's speed and friction differ. This is stated in Motor drives' validity sentence (§13).

## 5. Control

**Architecture: a cascade.**
1. A task-space law on the measured pose.
2. The damped inverse Jacobian, which gives speed and acceleration targets per axis.
3. Six PI speed loops.
4. A model torque feedforward from inverse dynamics.

The research recommends it (Siciliano §8.6.1, and Corke), the person sketched it, and it was the most robust scheme tried: with the controller's link masses 20 % low it tracks to 0.19 mm, where resolved acceleration with computed torque reaches 3.4 mm. Resolved-acceleration control is the same law for a 6-joint arm with a 6-D task away from singularities, and so is Khatib's operational-space law. Both differ only in where the model sits, so neither is a variant (research §2).

**"Robot controller"** is a subsystem with a mask: k_x 10 1/s, k_o 10 1/s, ε 0.04, λ_max 0.05, Ts 1 ms.

```
In q ═6═►[Encoder speed: Observer, finite difference, Ts]══ q_m (6) ══╦═══════════════╦═══════════════╗
                                                          ══ q̇_m (6) ══╬═══╗           ║               ║
                                                                       ▼   ▼           ▼               ▼
                     [Axes → task: FK · Jacobian · J̇q̇ · J·q̇] ═ p, R, v, J, J̇q̇ (base) ═╗
In p_d, v_d, a_d ═9═►[Task law]════════════════════ v*, a* (12, base) ═════════════════╬═►[Task → axes] ═ q̇*, q̈* (12, joints), σ_min
In R_d ═9═══════════╝  e_p = p_d − p;  e_o, θ = Orientation error(R_d, R)
                       v* = [v_d + k_x·e_p ; k_o·e_o]    a* = [a_d + k_x·(v_d − v_lin) ; −k_o·ω]
                     [Model feedforward: Inverse dynamics(q_m, q̇_m, q̈*) + G·Friction(G·q̇*)] ═ τ_ff (6, joints) ═╗
                     [Axis servos: Controller, 6 lanes, ff]  r = q̇*, y = q̇_m, ff = τ_ff ════ τ* (6, N·m) ═►[Torque → current: Gain 1/(G·kt)] ═ i* ═► Out
Valid range on σ_min (min ε): "near a singularity: the damped inverse trades accuracy for bounded joint speeds; the tool lags the path"
Sinks: eo (orientation error θ, °), sigma (σ_min)
```

- **Encoder speed** is today's Observer block with its Finite difference variant (Tf 0) on six measurements: q̇_m = (q_k − q_{k−1})/Ts (from B; the PUMA had no tachometer). It samples before the Controller at the same instant (observers first, as today), so everything between them sees one sample's values.
- **The task law** is plain Sum and Gain blocks in a masked group, faced "v* = v_d + k_x·e, a* = a_d + k_x·(v_d − v)". a* is the time derivative of v* along the path, so q̈* is consistent with q̇*. k_x and k_o are design inputs: the time constant of the task error is 1/k_x = 0.1 s.
- **Model feedforward** is RNEA on the measured state with the commanded acceleration, plus friction by the commanded speed q̇*, not the measured one, which avoids chatter (research). Inverse dynamics has `armature` ("G^2*Jm") and `scale` (1). `scale` multiplies the model's masses and inertias and is the "model mismatch" try-this.
- **Torque → current** is the drive's torque constant through the gear, the Gain 1/(G·kt), so the Axis servos work in link-side N·m.

**Why there are no diagram variants** (A's task controller was a Controller block whose variants are diagrams):
1. The variants worth flipping are on the axis loops.
2. A diagram variant would copy the 25-block cascade into each variant, where edits drift apart.
3. The task loop cannot be analysed either way (below).
4. It removes A's largest compiler addition.

The static blocks between the sampled Observer and the sampled Controller are evaluated, with B's fast path, only at sample and record instants, so the cascade costs what a sampled block costs. Diagram variants stay on the roadmap.

**The Controller with lanes** (`lanes` 6, `ff` 1):
- **Ports** are grouped by role: r ×6, y ×6 (one group per measurement), ff ×6, then u ×6.
- Each lane runs its own instance of the variant's law; `law.step(inputs)` is unchanged.
- A parameter is one value for all lanes, or a list with one value per lane.
- **ff** is added to u inside the limits and before anti-windup, like the FF input of an industrial PIDE (Rockwell's).
- The PID and the designed types gain **Kf**, the gain on the ff input (default 1). A path with Kf = 0 is drawn faint in the structure diagram.
- **Limits** per lane: ±G·kt·imax (link side), from the mask: 125.5, 215.6, 111.7, 22.7, 22.8, 18.4 N·m.

**The variants and their designed type `speedPI`** (design layer, §10):

| Variant | Inputs (design) | Computed per lane at the start pose |
|---|---|---|
| PI + model feedforward | ω 30 rad/s, ζ 1, Kf 1 | b = ∂ẏ/∂u (the plant's acceleration per N·m: 0.249, 0.226, 1.17, 5.18, 5.85, 5.15 rad/s² per N·m); Kv = 2ζω/b: 240, 266, 51, 11.6, 10.3, 11.6 N·m·s/rad; Ki = ω²/b: 3610, 3980, 768, 173, 154, 175 N·m/rad; u0 = 0 |
| PI, no model | ω 30, ζ 1, Kf 0 | the same Kv, Ki; u0 = the trim (the torques that hold the start pose: 0, 35.7, 7.84, 0, 0, 0 N·m), so the loop starts balanced |
| P only, no model | ω 30, ζ 1, Kf 0, integral off | Kv only |

u0 is "the trim's u at the start state minus Kf times what the ff input reads there". With the model on, the feedforward already holds gravity, so u0 is 0.

**What Analysis and Auto-tune cover.** They work per lane: "Axis servos · lane 2 (q̇2)". The cut is lane i's output, and the other lanes hold their trim values. The task loop (k_x) closes through r, not through the cut. It is not analysed, and the Analysis tab's notes say so: "q̇* depends on the plant through the task law (k_x): this is the speed loop alone". Its error dynamics are ė = −k_x·e by construction while the axis loops track, and the scope's e shows whether they do.

## 6. Reference

**Two Sources, `a_r` and `b_r`, are the person's two reference values.** They live in the circle's own frame and are edited in the Input tab.

| Signal | Components | Period |
|---|---|---|
| a_r (m) | Sine: amplitude 0.15, 0.4 Hz, phase 90° (a cosine), ease 0.5 s; DC −0.15 | 5 s |
| b_r (m) | Sine: amplitude 0.15, 0.4 Hz, phase 0, ease 0.5 s | 5 s |

- a_r = R·(cos φ(t) − 1) and b_r = R·sin φ(t): a circle through the frame's origin with its centre at a = −R.
- **`ease` eases the phase, not the amplitude** (from B). The phase rate rises from 0 to ω along a quintic smoothstep over `ease` seconds: φ(t) = ω·T_e·(2.5s⁴ − 3s⁵ + s⁶) for s = t/T_e < 1, then ω·(t − T_e/2). So the dashed path in 3D is exactly a circle from t = 0, and speed and acceleration start at 0 and stay continuous (C²).
- A's spiral (the amplitude eased in) drew a path that is not the circle.
- A step start would be a jump in velocity: tens of mm of transient in the research's prototype, against 0.2 mm with the ramp.
- The period is the screen, so the eased start plays once per run. A repetition covers (k·T, (k+1)·T], so the sample at 5 s is still the first period's.

**`derivatives` (0–2) on a Source** adds outputs ṙ and r̈, computed analytically per component:
- DC: 0.
- Sine and Chirp: exact, ease included.
- Ramp: its slope. A kink's impulse is left out, with a warning.
- Step and Square: 0, with the warning "the step at 0.10 s has no finite derivative: use a ramp or an eased sine".
- Function: a 5-point central difference with h = 10 µs.
- Arb: piecewise slopes.
- Noise: refused.

**"Circle reference"** (subsystem): Mux (a_r, b_r, 0) → p_c, Mux (ȧ_r, ḃ_r, 0) → v_c, Mux (ä_r, b̈_r, 0) → a_c, then a Frame transform "base ← circle" (rpy 0, 0, 0: horizontal) with its origin from the In port. Out p_d, v_d, a_d (9, base).

**Where the circle sits.**
- The Frame's origin is the tool's start position: an Initial value of the top-level Tool pose (forward kinematics of the true q).
- The target orientation R_d is the Initial value of the tool's R, which is tool-down.
- Both are computed in the page at t = 0 from the start pose (a design input), not typed.
- From the start pose [0, 40°, −150°, 0, −70°, 0] the tool starts at (0.730, −0.150, 0.726) m, and the centre is at (0.580, −0.150, 0.726) m.
- Over the circle (B's scan, re-run for this plan):
  - q1 −15…16°, q2 39…74°, q3 −207…−149°, q4 0, q5 −70…−48°, q6 −15…16°: at least 18.5° inside every limit;
  - σ_min 0.175…0.256;
  - peak joint speeds 0.88, 0.73, 1.21, 0, 0.50, 0.88 rad/s, against limits of 1.5 rad/s and up.

**The traps.**
- **B's**: A's start pose [0, 60°, −180°, 0, −60°, 0], with the circle through the tool and its centre towards the base, takes q3 to −227°: 1.6° beyond the URDF's limit, and nothing reported it. With its centre away from the base, the circle crosses the elbow singularity (σ_min 0, 13.6 mm of error).
- **Found for this plan**: from B's pose the tool starts 0.73 m out. A circle centred away from the base or to either side leaves the arm's reach (the kinematic scan meets σ_min = 0). Only the centre towards the base is offered.
- Hence B's start pose, and the Joint limits block, which reports such a run within the first run after load or after an edit. A test holds the library circle at least 15° inside every limit.

**Try-these** in the system's notes (each checked on the kinematic scan):
- a period of 2 s: the peak joint speed rises to 1.51 rad/s on j3, against its limit of 2.40;
- an amplitude of 0.2 m: q3 reaches −222°, 3.4° from its limit, with σ_min 0.174;
- the Axis servos' Ts at 10 ms (0.49 mm);
- Inverse dynamics' `scale` 0.8 (0.19 mm).

A circle turned away from the base (rpy (0, 0, π)) would show the damped inverse and the σ_min report at work. It is offered only once step 7 has run it through the full loop with the damped inverse, which the prototypes did not do.

## 7. 3D view

**`"kind": "3d"`, configured in the plant's JSON like every view** ([plant-views.md](plant-views.md)):

```json
{ "name": "Robot", "kind": "3d", "robot": "puma560",
  "joints": "puma/arm/q",
  "paths": [ { "from": "ref/frame:0", "style": "reference", "span": "all" },
             { "from": "pose:0", "style": "actual", "span": "to-now", "fade": 2.5 } ],
  "frames": [ { "link": "base" }, { "link": "flange" }, { "block": "ref/frame", "label": "circle" } ],
  "axes": true,
  "camera": { "target": [0.58, -0.15, 0.6], "view": "iso", "distance": 2.2 } }
```

- **A simulated plant binds by block output** (an id path and a port group), recorded as hidden probes (dotted names, never offered as scope channels). So deleting a Sink never breaks the picture (the engineer's graft). `joints` names a 6-wide output; its elements pose the URDF's movable joints in order.
- **A Live plant binds by signal name** (from B): `{ "kind": "3d", "urdf": "<robot…>", "joints": { "j1": "q1", … }, "paths": [ { "x": "x", "y": "y", "z": "z", … } ] }`. A view with both `robot` and `urdf` is refused.
- **Paths**: `reference` is dashed by arc length in channel 1's colour. `actual` is solid in channel 2's colour; `fade` (s) fades it over that time behind the instant. `span` is `all` (the whole run, so the dashed circle is there from the start) or `to-now`.
- **Frames** are triads with labels; `axes` adds thin labelled lines along j1…j6.
- **`app.sceneEnv`** hands the view the recorded arrays and the current index, not only the values at one instant.

**The renderer** (`ui/view3d.js`, our own, no dependencies, after the research's prototype):
- **Size**: the prototype is 375 lines, 27 KB, 9.8 KB gzipped. The budget is ≤ 650 lines and ≤ 35 KB source with navigation, ≤ 5 % of today's 751 KB page.
- **Drawing**: cel shaded ([decisions.md](decisions.md), v2.8, input 25): three.js's toon material on every surface, its light ramp four texels made in code (three flat bands: shadow, half, lit, from a key light that turns with the camera plus an ambient); dark outlines on silhouettes (an inverted hull pushed out on the screen, so 1.6 px at every zoom) and on hard edges (folds over 30°, 1.2 px ribbons); parts coloured by role from tokens (`--part`, `--part-dark`, `--part-accent`, outlines `--part-line`). No texture but the ramp, nothing loaded (`test/view3d.test.mjs`). Lines (grid, paths, triads, axes) stay flat colours; the trail fades in three steps, not a gradient.
- **Lines** are depth-tested screen-space ribbons. `gl.lineWidth` is stuck at 1: Chromium reports `ALIASED_LINE_WIDTH_RANGE` [1, 1].
- **The Canvas2D fallback is required.** Chrome no longer falls back to software WebGL, so a context fails on machines without a usable GPU (office PCs, VMs, remote desktops). The fallback uses coarser meshes: the prototype took 45 ms per frame for 2 700 triangles in a headless VM. It shows painter's-algorithm artefacts where primitives overlap, which is acceptable for a fallback.
- **A lost context**: on `webglcontextlost` the view prevents the default and draws with Canvas2D. On `webglcontextrestored` it rebuilds its buffers. The prototype did not handle this; the engineer flagged it.
- **Picking** casts a ray on the CPU against the analytic primitives, never `readPixels`. Hovering a link shows its name, joint angle, speed, torque and motor current at the instant. Double-clicking opens the Arm subsystem.
- **Navigation** follows [decisions.md](decisions.md): orbit about a target, wheel zoom, right- or Shift-drag pan, WASD and Q/E to fly, preset views (front, back, left, right, top, bottom, isometric), and a corner gizmo with the axis triad and a clickable view cube that snaps, animated, to faces, edges and corners. About 150 lines.
- **One design system**: colours come from the stylesheet's tokens, read at mount and on a theme change. The axis colours become semantic tokens `--axis-x`, `--axis-y`, `--axis-z` (red, green, blue), defined for both themes.
- **Cost**: the prototype's JavaScript took about 1.3 ms per frame in WebGL.

## 8. Scope

- **Channels**: as in §0 (a_r, a, e, i2), Time mode, 0.5 s/div, the record step 1 ms (`sim: { sampleTime: 0.001 }`).
- **Measure** is on e: rms 0.049 mm with model feedforward.
- **The selected channel is i2**, so Spectrogram shows the shoulder current. At A's start pose its harmonics over one turn were DC 1.16 A, 1f 1.15 A, 3f 0.21 A, 5f 0.11 A. At this pose i2 runs from −0.12 to 2.40 A. The waist current i1 is the alternative: Coulomb friction makes it nearly a ±2 A square wave, a comb in the spectrogram.
- **The other signals on offer**: b_r, b, x, y, z, xr, yr, zr, eo (°), sigma, i1…i6.
- **XY with channel 1 = a and channel 2 = b draws the tool's circle.** This is a try-this, not the default.

## 9. Performance, measured

**Tracking: the merged law** (A's task cascade on the measured pose, B's start pose, the eased circle, speed from the encoder difference, gains from b = 1/(M⁻¹)_ii at the start pose).
- Hand-written loop in `robot-final/merged.mjs`, Ts = 1 ms, 5 s.
- On the same arm, drives, circle and speed sensing, B's own law (CLIK to joint references) gives 0.048 mm through main's compiler with B's patch. The two laws differ by a few per cent in every case.

| Case | rms / max error (mm) | Orientation (°) | Peak currents (A) |
|---|---|---|---|
| PI + model feedforward | 0.049 / 0.070 | 0.0012 | 2.52, 2.40, 1.38, 0, 0.26, 0.33 |
| PI, no model | 1.81 / 4.3 | 0.31 | 2.74, 2.51, 1.38, 0.01, 0.28, 0.36 |
| P only, no model | 14.4 / 22.1 | 3.4 | 2.66, 2.45, 1.36, 0.08, 0.26, 0.35 |
| Model feedforward, controller's masses ×0.8 (`scale` 0.8) | 0.19 / 0.86 | 0.13 | – |
| Model feedforward, Ts = 10 ms | 0.49 / 0.69 | 0.014 | – |
| Model feedforward, link 2 2 mm longer in the controller's model | 2.0 / 2.0 | 0.0013 | – (the encoders cannot see this error) |
| Model feedforward without the friction term | 1.76 / 4.3 | 0.28 | – |
| PI, no model, ω = 60 rad/s | 0.47 / 1.28 | 0.09 | – |

- A's own headline, 0.0043 mm, came from reading the exact q̇ state. With the speed differenced over Ts it is 0.049 mm.
- Gains from M_ii (B) instead of 1/(M⁻¹)_ii (the design layer) give 0.0487 mm too.

**Cost.**

| What | Time |
|---|---|
| Forward kinematics + flange pose · + Jacobian · + J̇q̇ | 0.67 · 0.78 · 0.87 µs |
| RNEA · CRBA · forward dynamics (RNEA + CRBA + Cholesky) | 1.24 · 3.25 · 4.33 µs |
| The same split as the diagram does it (M, h, Solve) | 6.0 µs |
| ABA (dense, the oracle) | 13.6 µs |
| σ_min(J) by Jacobi on JᵀJ | 4.7 µs |
| The plant alone, 5 s at 1 ms (20 000 RK4 evaluations) | 87 ms (fused), 120 ms (split) |
| A's flattened node graph (321 nodes, hand-ordered), a 5 s run | 0.27–0.40 s with the fast paths, 0.58–0.69 s without |
| B's whole diagram through main's compiler with B's patch (101 blocks, 182 nodes), a 5 s run | 0.62 s with the fast paths, 1.37 s without |
| The library's 10 systems with B's patch and fast paths | bit for bit identical (re-run for this plan), 6–130 ms each |

- **Target**: a 5 s PUMA run in ≤ 0.6 s in Node, measured in step 7.
- At Speed 1× the sweep takes 5 s, so the simulation runs about 10 times faster than real time.
- A wheel notch on ω or `scale` re-designs (b is one difference per lane, under 1 ms) and re-simulates in about 0.4–0.6 s. That is slower than the triple pendulum's 35 ms. The previous run stays faded until the new one arrives. A Web Worker comes later (§13).

**Size.** The URDF is 4.3 KB. The core adds about 1 100 lines (xml 50, urdf 220, rbd 380, the robot blocks 300, vector helpers 150), and the renderer ≤ 650 lines.

**Prototypes** (session scratch, may be gone), all under `/tmp/claude-0/-home-user-ctrl/281fed85-1c0b-52ae-b29a-1fd26dd76401/scratchpad/`:

| Folder | What is in it |
|---|---|
| `pumaA/` | A: the URDF (`puma560.urdf`, `make-urdf.mjs`), `urdf.mjs`, `xml.mjs`, `rbd.mjs`, the checks (`check.mjs` → `check-out.txt`), the hand loop (`loopA.mjs`, `runA.mjs` → `runA.out`), the flattened graph (`diag.mjs`) |
| `puma-b/` | B: `patch.mjs` (main's compiler patched), `identical.mjs` (the library bit-identity check), `build.mjs` and `run.mjs` (B's diagram), `compare.mjs` (both laws on one setup), `workspace.mjs` (the kinematic scan) |
| `robot-final/` | This plan's checks: `merged.mjs` and `ponly.mjs` (the merged law), `pose.mjs` and `flip.mjs` (the start pose and the orientation-error trap), `gains.mjs` (b, Kv, Ki, the trim), `ws2.mjs` (circle placements from the start pose) |
| `urdf3d/` | The renderer (`view3d.html`) and its screenshots |
| `ctrl-research/` | `ref.py` and `ref.json`: the values computed by Corke's toolbox |

## 10. Compiler changes and the design layer

**Where the design branch stands** (read only: `/home/user/ctrl/.claude/worktrees/designs`).
- `feat/designs` is merging main's newest commits: `decisions.md` and `detail-levels.md` are still marked unmerged, with no conflict markers left.
- Its `diagram.js` resolves physics blocks through `ode.make(p)` (main has `ode.f`).
- `seen()` cuts one scalar node per Controller (`cut = blk.i`).

So B's patch points must be re-ported there, and the per-lane cut is new work.

**Compiler** (`core/diagram.js`; each item gated on the library staying bit for bit identical):
1. **Port groups** (§2): `portGroups(p)`, shapes declared or derived in one forward pass, frames as metadata, the refusals and warnings.
2. **Vector wires expand at compile**: a group wire becomes n scalar slot connections, and a width-1 wire into an n-wide group connects to all n slots. The file and the editor keep one wire per group.
3. **Element-wise blocks compile to n scalar nodes.** Each state is labelled by its element (`Arm/q3`), so model mode, labels and reduction work per element.
4. **Multi-output pass-through nodes with taps** (B's `multi`) for the robot blocks, Product, Solve and Damped inverse. **State nodes with several inputs** (`uv`, as in transparent-models). Integrator x0 as a vector.
5. **B's fast paths**:
   - each RK4 stage evaluates only the rate slice, the nodes the state derivatives read;
   - parents write their taps;
   - nodes read only by sampled blocks and Sinks are evaluated once per sample instant and at record instants.
6. **Sampling order**: observers first (as today), then Controllers in signal-flow order. A Controller fed by another Controller through pass-through blocks samples after it.
7. **Initial value** latches at `init()` after the start state is set.
8. **Sinks** on n-wide wires record n probes. Views' bindings record hidden probes. Frame transform records its origin and rotation.
9. **`robots` and the root mask** reach every level. Formulas take vectors, element-wise operations and 1-based `[j]` (on transparent-models' `formula.js`). `plantKey` includes both.
10. **Model mode**:
    - the robot blocks run as in the simulation;
    - Friction is B·ω only, with a note;
    - Joint limits and Valid range are Terminators;
    - Initial value reads the start state;
    - **the Finite difference observer is looked through**: estimate y_k reads measurement k, and ẏ_k reads its rate. When measurement k is one state at slope c (`Model.outputs[k].state`), that rate is c times that state's rate in f. Otherwise the observer is held, with a warning.
11. **Validity reports** go to `info.validity` ([detail-levels.md](detail-levels.md) §4), with Joint limits as a Valid range.

**Design layer** (`core/design.js`, `core/linearize.js`; on top of [designs.md](designs.md)):
- **Per-lane cut**: `seen('…/axis servos[2]', at)`. Lane 2's output is u. The other lanes hold `at.held` or their trim. The measurements are lane 2's y group. The suffix `[k]` is 1-based; `#` and `@` are taken by design slots and detail levels.
- **Trim over all lanes at once**: u ∈ ℝⁿ holding the start state, by Gauss–Newton on ∂q̈/∂u, which is M⁻¹ and well conditioned. Holding the arm needs all six torques together, so a per-lane trim with the others at 0 would fail.
- **`speedPI`** (designed). Inputs: ω, ζ, Kf, integral (on/off), limits.
  - Per lane it computes b = ∂ẏ/∂u at the start state (C·B of the lane's model: the plant's acceleration per unit u), then Kv = 2ζω/b, Ki = ω²/b, and u0 = trim − Kf·ff(start).
  - Rows: a table per lane (b, Kv, Ki, u0).
  - Its Copy as numbers twin is `pid` (Kp = Kv, Ki, Kd 0, Kf, u0), one value per lane.
  - Refusals: `not-a-rate` ("q̇_m2 does not accelerate with u2 (∂ẏ/∂u = 0): speedPI needs a measured speed"), `kink`, `no-states`.
  - `linear()` is its twin's.
- **Analysis** chooses the lane, and its notes add the task-loop sentence (§5).
- **Auto-tune** works on one lane at a time (lane chooser), the others running their variant. Iterate tunes the variant's design inputs (ω, ζ, shared by all lanes) on the summed cost over lanes.
- **Nothing plant-specific is stored.** In the file: the URDF and the drive table (published physics inputs), the start pose, ω, ζ, k_x, k_o, ε, λ_max, the circle's radius, period and ease. Computed in the page: b, Kv, Ki, u0, the trim, the circle's origin and R_d.

**Project format** ([project-format.md](project-format.md)). The format stays `loop-tuner/2`, and every addition is optional:
- a diagram's `robots`;
- the root diagram's `mask` and `params`, whose values may be vectors and formulas;
- vector and matrix numbers in block parameters;
- group indices in wire ends;
- Sink names as comma lists;
- Source `derivatives`; Sine `ease`;
- the new block types (§§1–3);
- Controller `lanes`, `ff`, and `Kf` in variants;
- views of `kind: "3d"` in both forms.

Older files load unchanged.

## 11. Tests

**Physics** (`test/robot.test.mjs`; fixtures computed by the toolbox are stored in the test, never in the page):
1. **Toolbox agreement**: M, g, RNEA's τ, FK and J against Corke's Robotics Toolbox for Python 1.5.0 on 8 states (the toolbox's own link set, loaded with the parser's test-only `inertia: 'warn'`, since its link 3 is non-physical). Bound 10⁻¹².
2. **Our URDF against the published set**: M and τ over 2 000 seeded random states to 10⁻¹² (the link-3/link-1 regrouping is exact). The corrected set at qn to 4 decimals, as in §3.
3. RNEA∘FD = identity; CRBA + Cholesky against ABA; M symmetric and positive definite (500 states).
4. J against central differences; J̇q̇ against d/dt(J·q̇).
5. **Energy**: 5 s of free swing with no torque or friction, through the compiled Arm subsystem (not the hand loop), drifting < 10⁻⁶ of the peak kinetic energy. Friction alone only removes energy.
6. **FK/IK round trip**: a closed-form PUMA IK in the test only (Paul, Shimano & Mayer; Corke's `ikine_a`) as an independent oracle. All 8 configurations at 200 random reachable poses: FK(IK(T)) = T to 10⁻¹⁰.
7. **Singularities where the research puts them**: q5 = 0, q3 = −87.3°, and the wrist centre 0.150 m from the waist axis, σ_min < 10⁻⁹ there.
8. **The parser**: every refusal in §3 with its sentence. Joint dynamics must be 0. Mesh fallback.
9. **Orientation error**: at the tool-down pose, 20 000 rotations within 2° with the right sign (to 10⁻¹⁵); θ for 10⁻⁹ rad and for 179°; e_o against the quaternion form away from η = 0.

**Compiler** (`test/vector.test.mjs`):
10. Every library system bit for bit as before, with the fast paths on (B's `identical.mjs` as a test, hashing all signals).
11. A vector diagram compiles to the same nodes as its hand-flattened scalar twin. Width and shape refusals with their sentences. Broadcasting. Mux and Demux create no node. Matrix Gain, Product, Solve (and its singular refusal), Norm, Initial value.
12. **The compiled PUMA equals a hand-written reference loop** (`test/puma-reference.mjs`, the merged law of §9 written plainly) over 5 s to 10⁻¹². This replaces A's 1.7·10⁻¹⁶, which compared a hand-ordered node list.
13. Sampling order (an Observer, then Controllers in signal order). Per-lane probes. A lanes Controller with one lane runs bit for bit as today's.

**Design layer** (`test/design.test.mjs`):
14. `speedPI` on the PUMA reproduces b, Kv, Ki of §5 to 10⁻⁶; the joint trim gives the gravity torques; the per-lane cut; the difference observer looked through; `not-a-rate`. Copy as numbers runs bit for bit alike.

**Behaviour** (`test/puma.test.mjs`, in `core.test.mjs`'s style):
15. With model feedforward: e rms < 0.1 mm. PI, no model: 1–3 mm. P only: > 8 mm. `scale` 0.8: < 0.3 mm. Ts 10 ms: < 1 mm.
16. No validity report on the library circle; every joint ≥ 15° inside its limits; σ_min ≥ 0.15; currents within the fuses (4 A, 2 A); drive voltage < 30 V.
17. A's start pose with the circle towards the base reports j3 leaving its range.
18. The view's bindings exist and the reference path is a circle of 0.15 m to 10⁻⁹.

**Renderer and page**:
19. In Node: projection and view matrices, the orbit and view-cube targets, ray picking against box, cylinder and sphere, ribbon and dash geometry, path building from records.
20. Playwright (headless Chromium with `--enable-unsafe-swiftshader`): the system loads on the Robot view in both themes; Canvas2D forced; context loss and restore; hovering a link; the view cube; a variant flip changes the trail.
21. Provenance: the built page passes `test/provenance.test.mjs`, and the URDF text has no XML comments. Standalone: `test/standalone.test.mjs` passes, with nothing loaded from elsewhere.

## 12. Implementation steps (each ends with `npm test` green)

0. **Prerequisites and record.**
   - `feat/designs` merged into main (its merge with main's input 11–13 work is in progress).
   - From [transparent-models.md](transparent-models.md) steps 1–3: pass nodes elided, `uv` state nodes, `formula.js` and masks, Equations, the Integrator's fields. **Built** (2026-10-25, branch `feat/model-foundations`), scalar only: formulas, mask values and Integrator fields are numbers; vectors, `X[j]`, a mask on the root diagram and multi-output nodes beyond Equations' `pick` nodes are this plan's. The eigenvalue step bound is built too (detail-levels.md §5).
   - From [detail-levels.md](detail-levels.md): the Valid range block and `info.validity`, with the status line showing reports.
   - Record the decisions in §14 in `decisions.md`.
   - Add this plan's row to the output README (done with this plan).
1. **Vector signals in the compiler.**
   - Port groups, shapes, frames; group wires expanding at compile; element-wise `width` and broadcasting; Mux, Demux, Constant, Initial value; vector Sinks; multi-output nodes with taps; vector Integrator.
   - B's fast paths. Sampling in signal order.
   - Tests 10, 11, 13.
   - Port B's patch onto the merged `diagram.js` (`ode.make`).
2. **Math and Friction.** Matrix Gain, Product, Solve, Norm, Friction (with its model-mode form). Tests.
3. **The robot core.**
   - `core/xml.js`, `core/urdf.js` (the model, refusals, inertia checks, visuals), `core/rbd.js` (kinematics with the q cache, J, J̇q̇, RNEA, CRBA, Cholesky; ABA only in `test/`).
   - The PUMA URDF and drive table as a data module (`core/puma560.js`, physics inputs).
   - Tests 1–8. Bundle: MODULES lists `xml`, `urdf`, `rbd`, `puma560` before `diagram`, and the new modules export the names they are imported by (the bundler cannot rename an import).
4. **Robot blocks and system parameters.**
   - Forward kinematics, Jacobian, J̇q̇, Mass matrix, Bias forces, Inverse dynamics, Damped inverse (with the cheap trigger 1/‖J⁻¹‖_F ≥ ε; σ_min computed only when it fires or a Sink reads it), Orientation error, Frame transform, Joint limits.
   - The diagram's `robots`; the root mask with vectors and `[j]`; model mode (§10); the faces.
   - Tests 9, 11.
5. **Controller lanes and the design layer.**
   - `lanes`, `ff`, `Kf` on pid and the designed types. Observer port groups; open u allowed for Finite difference.
   - Per-lane cut, joint trim, the difference observer looked through, `speedPI`. Per-lane Analysis and Auto-tune.
   - The Controller tab: lane tables, the lanes badge in the structure diagram, ff drawn faint at Kf = 0.
   - Test 14.
6. **Source derivatives and the eased Sine.** Analytic ṙ, r̈ per component, with the warnings and refusals. The Input tab shows `ease`. Tests (derivatives against central differences; C² at the end of the ease).
7. **The PUMA system.**
   - `puma560System()` in `plants.js` builds the diagram of §§3–6 from the data module. Name, notes (the two things, the try-these; no citations or names in the page), signals, scope, `ui` (run, Plant tab, view Robot), `sim: { sampleTime: 0.001 }`.
   - Tags: Nonlinear, MIMO (a Controller with lanes > 1), 3D, Feedforward.
   - Tests 12, 15–17.
   - Log the 5 s run's time (target ≤ 0.6 s in Node).
   - `node cli.mjs run` and `design` print the statuses and validity.
8. **The 3D view.**
   - `kind: "3d"` in `core/views.js` (normalising, bindings, both forms).
   - `ui/view3d.js`: WebGL1, the Canvas2D fallback, context loss, ribbons, picking, CAD navigation, gizmo and view cube, tokens.
   - `app.sceneEnv` with records and the index.
   - Tests 18–20.
9. **The editor for vectors and robots.**
   - Double-stroke vector wires with count and frame; group brackets; hover lists and tables; Demux branching; frame warnings outlined.
   - The robot blocks' faces and hover values; the Links and joints sheet; the system parameters and robots in the empty-selection panel.
   - Playwright: open every level of the PUMA; hover J and M; break a wire's width and read the refusal.
10. **Docs sweep.**
    - [plant-editor.md](plant-editor.md): vector wires, the new blocks, MIMO leaves "Not yet".
    - [plant-views.md](plant-views.md): 3D. Correct its line "rendered with a WebGL library loaded from the CDN": our own renderer, since three.js r160 alone (671 KB) is about the whole page and the page must stand alone.
    - [system-library.md](system-library.md): the PUMA row and "how the controllers were designed".
    - [controller-proposal.md](controller-proposal.md): lanes, ff, Kf, `speedPI`.
    - [project-format.md](project-format.md) (§10's list); [roadmap.md](roadmap.md); the output README's status; `AGENTS.md` (building a robot system in JSON, lanes); the page's Help.

Size, from the prototypes: about 1 100 lines of core, `diagram.js` about +400, `ui/view3d.js` ≤ 650, `ui/plant.js` about +400 (not prototyped), tests about +900 including the reference loop and the toolbox fixtures. About 3 500 lines written.

## 13. Not built (and why)

- **The Arm as URDF links and joints joined on the canvas**, the parts form [transparent-models.md](transparent-models.md) chose for rigid bodies (its §10 names this). The M/h/Solve form opens and reads; a 3D articulated-parts editor is its own design.
- **Prismatic joints** (a SCARA's z) and **a floating base** (a quadcopter). The parser refuses both. A quadcopter can be built from blocks: matrix Gain, Product and Mux express its rotations and mixer.
- **Closed chains.**
- **Meshes** (STL, glTF): a standalone page cannot fetch them. Primitives are drawn instead, and the panel says so.
- **The wrist's gear coupling** (motors 5 and 6 on joints 4 and 5). A Gear block with a matrix ratio expresses it: ω_m = G_m·q̇, τ = G_mᵀ·τ_m, armature G_mᵀ·diag(Jm)·G_m. Until then the Motor drives' sentence says the gears are independent.
- **Stiction and stick–slip** (Karnopp): the smoothed Coulomb law, with its validity sentence.
- **The current loop and the voltage drive** as Motor detail levels 2 and 3.
- **Encoder quantisation**: a Quantizer on q is a try-this (motor-side counts 1 000, 800, 1 000, 1 000, 1 000, 500 per revolution, times G at the joint).
- **A singularity example** with singularity decoupling (the wrist centre exact from joints 1–3, only the 3×3 wrist block damped). Plain damped least squares on the full 6×6 mixes metres and radians: the research saw 8–59 mm through the wrist singularity.
- **Closed-form IK in the page**: it lives in the tests. The start pose is a joint-space design input.
- **Controller variants that are diagrams** and **sampled subsystems** (Simulink's atomic subsystem with a sample time). §5 gives the reasons.
- **Resolved acceleration with computed torque, and Khatib's law, as variants**: they are the same law away from singularities, and their dependence on the model (3.4 mm with masses ×0.8) could be a third thing later.
- **Relay and step Auto-tune per lane.**
- **Editing the URDF in the page**: JSON only.
- **A Web Worker** for the 0.4–0.6 s re-simulation.
- **A HIL robot plant**: the inline 3D form is specified; the plant script is not.

## 14. Decisions to record (step 0)

- **The PUMA 560 is controlled in end-effector coordinates on top of six joint speed loops** (a cascade: the task law on the measured pose, the damped inverse Jacobian to per-axis speed and acceleration targets, PI speed loops, model torque feedforward). (Person: "controlling the system actually in end effector coordinates and then transforming the values into speed and acceleration values for the single axis.") Interpretation, after research: of computed torque and resolved acceleration, which the person was offered, the cascade won on robustness to model error (0.19 against 3.4 mm with masses ×0.8). Resolved acceleration and Khatib's law are the same law for this arm.
- **Coordinate systems are named on wires** (joints, base, tool, circle), and **the transformation is two openable groups, Axes → task and Task → axes**. (Person: "you're going to have the coordinate systems of the axes … of the end effector … a transformation block".)
- **MIMO by vector signals**: a wire carries a vector or a matrix, flattened by the compiler to scalar nodes; widths declared, not inferred; Mux and Demux; a Controller with lanes. (Person: "this is a multi-input, multi-output control system".)
- **One URDF per robot, in the diagram's `robots` map, is the single source** for the physics, the controller's model and the 3D picture. Our own URDF from published data (Corke's toolbox kinematics, Armstrong, Khatib and Burdick's inertias with two corrections and an exact regrouping that makes link 3 physical), our own primitive shapes. (Person: "integrate the URDF format … a 3D rendering from this URDF".)
- **The arm opens to M(q)·q̈ = τ − h(q, q̇)** with CRBA and RNEA blocks that read the URDF; rotor inertia on M's diagonal. Interpretation: the URDF parts on the canvas come later.
- **Our own WebGL renderer with a Canvas2D fallback**, no library: the page stays one file. (Person: "the plant diagram … it's going to be 3D".) The 3D view is the PUMA's default view.
- **The reference is two signals in the circle's own frame** (a_r, b_r), placed at the tool's start point. The path and the trail are drawn in 3D. (Person: "I guess it would be two reference values … a circle in space … plot the reference values into that plot".)
- **The scope shows reference, actual, error and the shoulder motor's current.** Interpretation: "in the spectrogram" means the scope; i2 is selected, so Spectrogram shows it.
- **The axis gains are computed by the design layer** (`speedPI`, from the plant's acceleration per unit torque at the start pose); the published robot data are physics inputs.
- **No "Off" variant for a robot without joint stops**; the Joint limits block reports instead.
