# Controller tab: proposal

Reader: the person, to decide; then whoever builds the Controller tab. **Status: proposed 2026-10-24, waiting for the person's answer to the questions at the end.**

The person proposed: the controller is one block in the plant diagram; the number of its inputs is set; double-clicking it opens the Controller tab, which has a library of common controllers; asked whether controllers should be completely freeform. This is our answer.

## Proposal

1. **A Controller block in the plant diagram.** It wires like any block: by default two inputs, r and the measurement, and one output, u (a 2-degree-of-freedom controller; a single error input is a setting). Several Controller blocks make cascade or feedforward structures without anything special.
2. **Double-click opens the Controller tab**, scoped to that block (not inside it, as a subsystem would). Going back is the Plant tab, or a "Back to plant" button.
3. **The Controller tab reuses the diagram editor** with a controller library: PID (derivative filter, setpoint weights, anti-windup), PI, lead/lag, state feedback, feedforward gain, rate limiter, sample delay. Common controllers are single blocks with knobs; freeform controllers are diagrams of them.
4. **Freeform, but sampled.** A controller's inside runs digitally at its sample time Ts (a setting of the Controller block), with its output held between samples. That is how real controllers run, keeps "continuous plant, discrete controller" meaningful, and lets library blocks be discretised properly (the v1 PID already is).
5. **Candidates are parameter sets for the controller's structure** (the synthesizer "patches" from the first brief): the tab lists them, steps through them, overlays their responses on the scope, and Auto-tune searches the parameters marked tunable. Changing the structure starts a new structure with its own candidates.

## Questions for the person

1. Default inputs: r and the measurement separately (2-DOF), or one error input?
2. One sample time per Controller block: agreed?
3. Do candidates vary only parameters (proposed), or also the structure?
