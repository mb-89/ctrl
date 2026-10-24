# Controller tab

Reader: whoever builds the Controller tab. **Status: decided 2026-10-24 (the person answered the proposal's questions); not built yet.**

The person proposed: the controller is one block in the plant diagram; the number of its inputs is set; double-clicking it opens the Controller tab, which has a library of common controllers. Our proposal, with the person's answers:

1. **A Controller block in the plant diagram, two inputs by default**: r and the measurement (2-DOF), one output u. A single error input is a setting. Several Controller blocks make cascade or feedforward structures. (Person: "default two inputs".)
2. **Double-click opens the Controller tab**, scoped to that block. Going back is the Plant tab, or a "Back to plant" button.
3. **The Controller tab reuses the diagram editor** with a controller library: PID (derivative filter, setpoint weights, anti-windup), PI, lead/lag, state feedback, feedforward gain, rate limiter, sample delay.
4. **One sample time per Controller block**; different blocks may differ. The inside runs digitally at Ts, output held between samples. (Person: "yes".)
5. **Variants, as in Simulink**: a Controller block holds several selectable implementations behind the same interface (inputs, output, Ts), each with its own parameters. A candidate is a variant with its parameter values; the tab lists, steps through and overlays them like synthesizer patches, and **Auto-tune may flip through variants** as well as tune parameters. (Person: "Simulink-variant-like selectable implementations with the same interface … the tuner can flip through".)
