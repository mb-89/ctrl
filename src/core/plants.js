// The System library's systems. Few, and each one does something visible:
// its input moves the plant, its signals are named for what they are (force F,
// position x, …) and on the scope, and its view shows the motion
// (design/output/system-library.md). Each runs 5 s and opens running, on its
// view in the Plant tab (ui). The controlled ones grow in difficulty: a PID
// on a motor, a gain-scheduled PI on a tank, an energy (Lyapunov) swing-up of
// a pendulum, a swing-up of a triple pendulum planned in the page. Each has a
// reference r and a disturbance d, and a Controller block whose variants can
// be flipped.
//
// Only inputs are stored here: physics, hand gains (PID, the energy pump),
// and the weights, levels and limits of designed variants. Every gain,
// table and start value those compute comes from the plant, in the page
// (design/output/designs.md).

const src = (signal, x, y, unit) => ({ id: signal, type: 'source', params: { signal, unit }, x, y });
const sink = (id, x, y, unit) => ({ id, type: 'sink', params: { name: id, unit }, x, y });
// Scope channels 1–4: a signal name each (on), or { source, on, measure } for
// one that is assigned but off, or carries a Measure line.
const channels = (...sources) => [0, 1, 2, 3].map((i) => {
  const c = typeof sources[i] === 'object' ? sources[i] : { source: sources[i] ?? '' };
  return { source: c.source, on: c.on ?? !!c.source, scale: 1, offset: 0, ...(c.measure ? { measure: true } : {}) };
});
const ui = (view) => ({ run: 'run', tab: 'plant', setup: 0.42, view });
const ctrl = (x, y, inputs, Ts, variants, variant = 0) => ({ id: 'ctrl', type: 'controller', name: 'controller', params: { inputs, Ts }, variants, variant, x, y });
const pulse = (amplitude, time, width) => ({ type: 'square', params: { amplitude, time, width, period: 5, count: 1 } });
const PERIOD = 5;

// The DC motor, shared by the systems built on it: V and the load torque in,
// the speed out. Motor is built from blocks whose parameters are the
// physics, each once (no black box; design/research/sliding-mode.md,
// Recommendation 1):
//   armature 1/(L·s + R)   R = 1 Ω, L = 10 mH; its output is the current i
//   Kt (= Ke), Ke (= Kt)   0.5 N·m/A and 0.5 V·s/rad: equal in SI units, or
//                          the motor would make or lose energy
//   rotor 1/(J·s + b)      J = 0.02 kg·m², b = 0.1 N·m·s/rad; out: the speed
const motorBlock = (x, y) => ({
  id: 'motor', type: 'subsystem', name: 'Motor', params: {}, x, y,
  diagram: {
    blocks: [
      { id: 'V', type: 'inport', name: 'V', params: { port: 1 }, x: 30, y: 112 },
      { id: 'load', type: 'inport', name: 'load torque', params: { port: 2 }, x: 330, y: 220 },
      { id: 'sum', type: 'sum', params: { signs: '+-' }, x: 120, y: 104 },
      { id: 'arm', type: 'tf', name: 'armature 1/(Ls + R)', params: { num: [1], den: [0.01, 1], delay: 0 }, x: 190, y: 96 },
      sink('i', 360, 20, 'A'),
      { id: 'kt', type: 'gain', name: 'Kt (= Ke)', params: { K: 0.5 }, x: 370, y: 100 },
      { id: 'tsum', type: 'sum', params: { signs: '+-' }, x: 460, y: 104 },
      { id: 'rotor', type: 'tf', name: 'rotor 1/(Js + b)', params: { num: [1], den: [0.02, 0.1], delay: 0 }, x: 530, y: 96 },
      { id: 'w', type: 'outport', name: 'speed', params: { port: 1 }, x: 720, y: 112 },
      { id: 'ke', type: 'gain', name: 'Ke (= Kt)', params: { K: 0.5 }, x: 370, y: 290, flip: true },
    ],
    wires: [
      { from: 'V', to: 'sum' }, { from: 'sum', to: 'arm' }, { from: 'arm', to: 'kt' }, { from: 'arm', to: 'i' }, { from: 'kt', to: 'tsum' }, { from: 'load', to: 'tsum:1' },
      { from: 'tsum', to: 'rotor' }, { from: 'rotor', to: 'w' }, { from: 'rotor', to: 'ke' }, { from: 'ke', to: 'sum:1' },
    ],
  },
});
// The motor with its angle: a Controller (variants given) sets the voltage
// V, the load torque d brakes it. opts.inputs 3 also feeds the speed to the
// Controller (input 3), and adds the error e = r − angle as a Sink; opts.Ts
// is the Controller's sample time.
const motorDiagram = (variants, { inputs = 2, Ts = 0.01 } = {}) => ({
      blocks: [
        src('r', 30, 112, 'rad'),
        src('d', 180, 230, 'N·m'),
        ctrl(130, 90, inputs, Ts, variants),
        motorBlock(330, 96),
        { id: 'int', type: 'integrator', name: 'angle', params: { K: 1 }, x: 500, y: 96 },
        sink('angle', 690, 106, 'rad'),
        sink('speed', 690, 30, 'rad/s'),
        sink('V', 330, 20, 'V'),
        ...(inputs >= 3 ? [{ id: 'esum', type: 'sum', params: { signs: '+-' }, x: 130, y: 300 }, sink('e', 200, 303, 'rad')] : []),
      ],
      wires: [
        { from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'motor' }, { from: 'd', to: 'motor:1' }, { from: 'motor', to: 'int' }, { from: 'int', to: 'angle' },
        { from: 'motor', to: 'speed' }, { from: 'int', to: 'ctrl:1' }, { from: 'ctrl', to: 'V' },
        ...(inputs >= 3 ? [{ from: 'motor', to: 'ctrl:2' }, { from: 'r', to: 'esum' }, { from: 'int', to: 'esum:1' }, { from: 'esum', to: 'e' }] : []),
      ],
    });
const motorViews = () => ([{
      // The rotor turns with angle (counter-clockwise positive) inside a fixed
      // dial; the yellow mark on the dial is the reference r.
      name: 'Motor shaft', kind: '2d', view: [-1.1, -0.9, 1.1, 0.9],
      shapes: [
        { type: 'circle', cx: 0, cy: 0, r: 0.62, fill: 'panel', stroke: 'muted', lineWidth: 2 },
        ...ticks(0.62),
        { type: 'group', angle: 'r', shapes: [{ type: 'line', x1: 0, y1: 0.66, x2: 0, y2: 0.8, stroke: 'ch1', lineWidth: 5 }] },
        { type: 'group', angle: 'angle', shapes: [
          { type: 'circle', cx: 0, cy: 0, r: 0.5, fill: 'ink' },
          { type: 'circle', cx: 0, cy: 0.27, r: 0.15, fill: 'ch2' },
          { type: 'line', x1: 0, y1: 0, x2: 0, y2: 0.6, stroke: 'ch2', lineWidth: 6 },
        ] },
        { type: 'circle', cx: 0, cy: 0, r: 0.07, fill: 'muted' },
        { type: 'text', x: 0, y: -0.82, text: 'angle {angle:5.2} rad   r {r:4.1} rad   V {V:5.1} V   i {i:5.1} A   load {d:3.1} N·m', size: 13 },
      ],
    }]);

// A fixed dial: twelve ticks every 30°, the quarter ones longer.
const ticks = (r) => Array.from({ length: 12 }, (_, i) => ({
  type: 'group', angle: (i * Math.PI) / 6, shapes: [{ type: 'line', x1: 0, y1: r, x2: 0, y2: r + (i % 3 ? 0.06 : 0.12), stroke: 'muted', lineWidth: i % 3 ? 1.5 : 3 }],
}));

// A cart on a track carrying a chain of rods (angles from upright), with the
// control force F and the disturbance d as arrows on the cart, and the
// reference r as a mark on the track.
function cartView(name, rods, caption, box) {
  let chain = [];
  for (let i = rods.length - 1; i >= 0; i--) {
    const { len, angle } = rods[i];
    chain = [{ type: 'group', y: i ? rods[i - 1].len : 0.1, angle, shapes: [
      { type: 'line', x1: 0, y1: 0, x2: 0, y2: len, lineWidth: 4 },
      { type: 'circle', cx: 0, cy: len, r: 0.04, fill: 'ch3' },
      ...chain,
    ] }];
  }
  return {
    name, kind: '2d', view: box,
    shapes: [
      // The rail has no end, as in the model: a cart pushed away leaves the picture.
      { type: 'line', x1: -1e3, y1: -0.065, x2: 1e3, y2: -0.065, stroke: 'muted', lineWidth: 3 },
      { type: 'line', x1: 'r', y1: -0.16, x2: 'r', y2: -0.08, stroke: 'ch1', lineWidth: 3 },
      { type: 'group', x: 'x', y: 0, shapes: [
        { type: 'rect', x: -0.16, y: -0.02, w: 0.32, h: 0.12, fill: 'ch2' },
        { type: 'circle', cx: -0.1, cy: -0.03, r: 0.03, fill: 'ink' },
        { type: 'circle', cx: 0.1, cy: -0.03, r: 0.03, fill: 'ink' },
        ...chain,
        { type: 'arrow', x1: '-0.17 - 0.03*F', y1: 0.04, x2: -0.17, y2: 0.04, stroke: 'ch4', lineWidth: 3 },
        { type: 'arrow', x1: '-0.17 - 0.03*d', y1: -0.02, x2: -0.17, y2: -0.02, stroke: 'muted', lineWidth: 3 },
      ] },
      { type: 'text', x: 0, y: box[3] - 0.08, text: caption, size: 13 },
    ],
  };
}

// LQR weights for the cart–poles, one per measurement (x, θ…, v, ω…): the
// cart's position, the angles, the rates.
const Q_SINGLE = [10, 50, 1, 1];
const Q_TRIPLE = [10, 100, 100, 100, 1, 1, 1, 1];

// Live mode (design/output/hil.md): the plant is outside the page and a
// black box (input 20): the page knows its interface only, the inputs and
// outputs its describe lists (names, units, full scales, hard ranges,
// kinds), which the External block keeps (here: what the example plant,
// hil_plant.py, describes) and takes anew on Connect. No model, no
// disturbance it does not offer, no picture: the Plant tab shows the
// interface. The controller is a first guess, not tuned on a model:
// tuning needs the plant identified first (identification.md). It opens
// stopped: nothing runs until the plant is connected and Run is pressed.
const HIL_SYSTEM = {
  name: 'HIL: an external plant',
  summary: 'A plant outside the page, connected live (hardware in the loop); the page knows only its interface. Download and run the plant, connect, then identify and tune it: working with a plant you cannot see.',
  notes: 'The plant runs outside this page, in real time, and the page knows only its interface: the inputs and outputs it describes when it connects (names, units, full scales, hard ranges), shown in the Plant tab under Interface. What is inside is a black box to be identified before tuning (Identify, to come). The downloadable example plant happens to simulate a DC motor swinging an arm (its physics varied by up to 15 %), which this page does not know. Step by step: 1. Plant tab, Download the plant (zip); unzip it and run runme.sh (Linux, macOS) or double-click runme.cmd (Windows), which install what it needs; a window with a red STOP opens and says where the plant listens. 2. Plant tab, Connect: the External block takes the plant\'s ports, nothing moves, the scope says CONNECTED. 3. Run: r ramps to its first value (at most 10 % of full scale per second), then the loop runs; each channel spans its full scale. The controller is a first guess (a P on the first output), to change in the Controller tab while it runs. Stop stops the plant, Single runs one sweep; E-STOP (header, key E) or STOP in the plant window stops it until Reset (a STOP pressed at the plant is reset there), and so does an output beyond its hard range. Save, Live record keeps the last minutes. Reference mode is a switch, not another system: Plant tab, Live settings, Mode, "Plant": while it is stopped the plant runs its own controller with its own limits, the page sends r straight to it and records what comes back, its own effort V included (the page\'s controllers and Auto-tune are out of the loop); "Page" puts the Controller back. A plant that cannot switch says so: start it with --mode reference instead, and the page follows what it describes. Help (?), Live and For agents, has all of it.',
  signals: {
    r: { period: PERIOD, components: [{ type: 'square', params: { amplitude: 1.5, time: 0.5, width: 2.5, period: 5, count: 0 } }] },
  },
  scope: { channels: channels('r', 'angle', 'V', 'current') },
  ui: { ...ui('Interface'), run: 'stop', setup: 0.42 },
  diagram: {
    blocks: [
      src('r', 30, 106, 'rad'),
      ctrl(130, 100, 2, 0.01, [
        { name: 'P, a first guess', type: 'pid', params: { Kp: 2, umin: -12, umax: 12 } },
        { name: 'Off', type: 'off', params: {} },
      ]),
      {
        id: 'plant', type: 'external', name: 'plant', x: 340, y: 96,
        params: {
          url: 'ws://127.0.0.1:8765', rate: 100,
          inputs: ['V'], inUnits: ['V'], min: [-12], max: [12], safe: [0], kinds: ['effort'], measures: [''],
          outputs: ['angle', 'speed', 'current'], outUnits: ['rad', 'rad/s', 'A'], outMin: [-Math.PI, -120, -12], outMax: [Math.PI, 120, 12],
          ymin: [-2.5, -60, -10], ymax: [2.5, 60, 10],
          ramp: 10,
        },
      },
      sink('angle', 600, 98, 'rad'), sink('speed', 600, 134, 'rad/s'), sink('current', 600, 170, 'A'),
      sink('V', 330, 20, 'V'),
    ],
    wires: [
      { from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'plant' }, { from: 'ctrl', to: 'V' },
      { from: 'plant', to: 'angle' }, { from: 'plant:1', to: 'speed' }, { from: 'plant:2', to: 'current' }, { from: 'plant', to: 'ctrl:1' },
    ],
  },
  views: [],
};

export const EXAMPLE_PLANTS = [
  {
    name: 'Mass–spring–damper',
    summary: 'A mass on a spring and a damper, pulled down once; no controller. Change the spring or the damping and watch it swing and settle: how stiffness and damping shape a response.',
    notes: 'A 1 kg mass hangs on a spring (25 N/m) and a damper (0.5 N·s/m). At 0.1 s a force F = 1 N pulls it down: it drops about 40 mm and swings at 0.8 Hz while it settles, its energy moving between motion (Ekin) and spring (Epot). No controller.',
    signals: { F: { period: PERIOD, components: [{ type: 'step', params: { amplitude: 1, time: 0.1 } }] } },
    scope: { channels: channels('F', 'x', 'Ekin', 'Epot') },
    ui: ui('Hanging mass'),
    diagram: {
      blocks: [
        src('F', 30, 112, 'N'),
        { id: 'sum', type: 'sum', params: { signs: '+--' }, x: 130, y: 104 },
        { id: 'm', type: 'gain', name: '1/m', params: { K: 1 }, x: 210, y: 100 },
        { id: 'vel', type: 'integrator', name: 'velocity', params: { K: 1 }, x: 330, y: 100 },
        { id: 'pos', type: 'integrator', name: 'position', params: { K: 1 }, x: 490, y: 100 },
        sink('x', 680, 108, 'm'),
        sink('v', 680, 20, 'm/s'),
        { id: 'c', type: 'gain', name: 'damping c', params: { K: 0.5 }, x: 330, y: 200, flip: true },
        { id: 'k', type: 'gain', name: 'spring k', params: { K: 25 }, x: 490, y: 270, flip: true },
        { id: 'ek', type: 'fcn', name: 'kinetic ½mv²', params: { expr: '0.5*1*u^2' }, x: 490, y: 360 },
        sink('Ekin', 680, 368, 'J'),
        { id: 'ep', type: 'fcn', name: 'spring ½kx²', params: { expr: '0.5*25*u^2' }, x: 490, y: 440 },
        sink('Epot', 680, 448, 'J'),
      ],
      wires: [
        { from: 'F', to: 'sum' }, { from: 'sum', to: 'm' }, { from: 'm', to: 'vel' }, { from: 'vel', to: 'pos' }, { from: 'pos', to: 'x' },
        { from: 'vel', to: 'c' }, { from: 'c', to: 'sum:1' }, { from: 'pos', to: 'k' }, { from: 'k', to: 'sum:2' },
        { from: 'vel', to: 'v' }, { from: 'vel', to: 'ek' }, { from: 'ek', to: 'Ekin' }, { from: 'pos', to: 'ep' }, { from: 'ep', to: 'Epot' },
      ],
    },
    views: [{
      // x is the displacement downwards, drawn ×5; the energies are bars, 8 per J.
      name: 'Hanging mass', kind: '2d', view: [-0.9, -0.95, 1.1, 0.62],
      shapes: [
        { type: 'ground', x1: -0.35, x2: 0.35, y: 0.5, side: 'above' },
        { type: 'spring', x1: -0.08, y1: 0.5, x2: -0.08, y2: '0 - 5*x', width: 0.09, coils: 8 },
        { type: 'damper', x1: 0.09, y1: 0.5, x2: 0.09, y2: '0 - 5*x', width: 0.08 },
        { type: 'rect', x: -0.18, y: '-0.26 - 5*x', w: 0.36, h: 0.26, fill: 'ch2' },
        { type: 'text', x: 0, y: '-0.13 - 5*x', text: 'm', size: 18, fill: 'panel' },
        { type: 'arrow', x1: 0, y1: '-0.28 - 5*x', x2: 0, y2: '-0.28 - 5*x - 0.25*F', stroke: 'ch1', lineWidth: 3 },
        { type: 'line', x1: -0.55, y1: -0.26, x2: -0.22, y2: -0.26, stroke: 'muted', lineWidth: 1 },
        { type: 'text', x: -0.68, y: -0.26, text: 'rest', size: 11, fill: 'muted' },
        { type: 'line', x1: 0.55, y1: -0.7, x2: 1.0, y2: -0.7, stroke: 'muted', lineWidth: 1 },
        { type: 'rect', x: 0.6, y: -0.7, w: 0.14, h: '8*Ekin', fill: 'ch3' },
        { type: 'rect', x: 0.82, y: -0.7, w: 0.14, h: '8*Epot', fill: 'ch4' },
        { type: 'text', x: 0.67, y: -0.78, text: 'Ekin', size: 11, fill: 'muted' },
        { type: 'text', x: 0.89, y: -0.78, text: 'Epot', size: 11, fill: 'muted' },
        { type: 'text', x: 0.1, y: -0.9, text: 'x = {1000*x:5.1} mm down (drawn ×5)   F = {F:3.1} N', size: 13 },
      ],
    }],
  },
  {
    name: 'DC motor, position control',
    summary: 'A motor turning its shaft to a commanded angle against a load. Its controller starts too aggressive: switch to PD or PID, or tune it, and see what P, I and D each do.',
    notes: 'A PID controls the shaft angle of a DC motor; the reference r jumps between 0 and 2 rad, and a load torque d brakes the shaft at 3.2 s. The controller it starts with is too aggressive: the shaft overshoots and rings. Flip the Controller tab to PD or PID with prefilter to see it settle, or tune it yourself.',
    signals: {
      r: { period: PERIOD, components: [{ type: 'square', params: { amplitude: 2, time: 0.25, width: 1.25, period: 2.5, count: 0 } }] },
      d: { period: PERIOD, components: [pulse(0.3, 3.2, 0.5)] },
    },
    scope: { channels: channels('r', 'angle', 'V', 'd') },
    ui: ui('Motor shaft'),
    diagram: motorDiagram([

          { name: 'P, too aggressive', type: 'pid', params: { Kp: 30, umin: -12, umax: 12 } },
          { name: 'PD', type: 'pid', params: { Kp: 20, Kd: 1.5, Tf: 0.01, umin: -12, umax: 12 } },
          { name: 'PID with prefilter', type: 'pid', params: { Kp: 20, Ki: 10, Kd: 1.5, Tf: 0.01, Tr: 0.1, umin: -12, umax: 12 } },
          { name: 'Off', type: 'off', params: {} },
    ]),
    views: motorViews(),
  },
  {
    name: 'Following a sine (XY)',
    summary: 'The motor following a slow sine, drawn as error against reference. Step through P, PD, PID and feedforward: why feedback alone lags a moving target, and what feedforward adds.',
    notes: 'The motor follows a slow sine, one period per sweep. The scope opens in XY mode with Δ: across is the reference r, up is the error r − angle. Perfect following would be a flat line on the axis. With P alone the error leads r by a quarter period and the figure is a wide ellipse; PD shrinks it; the integral of the PID turns the error against r, so the figure collapses to a thin tilted line.\n\nPID + feedforward adds a velocity feedforward Kv that the page computes from the motor (the voltage per rad/s its inverse needs, plus the PID\'s Kd, which the derivative on the angle takes away), so the voltage the moving reference needs comes from r itself: once the start-up ringing has died away, the figure lies flat on the axis. Each figure reads out its best line and its spread σ. Press Time to see the same runs over time. Try its Feedforward choice "and acceleration": Ka from the motor\'s inertia flattens the figure about four times more.',
    signals: {
      r: { period: PERIOD, components: [{ type: 'sine', params: { amplitude: 1, frequency: 0.2 } }] },
      d: { period: PERIOD, components: [] },
    },
    scope: { channels: channels('r', 'angle'), view: { mode: 'xy', delta: true } },
    ui: ui('Motor shaft'),
    diagram: motorDiagram([
      { name: 'P', type: 'pid', params: { Kp: 3, umin: -12, umax: 12 } },
      { name: 'PD', type: 'pid', params: { Kp: 20, Kd: 1.5, Tf: 0.01, umin: -12, umax: 12 } },
      { name: 'PID', type: 'pid', params: { Kp: 30, Ki: 80, Kd: 1, Tf: 0.02, umin: -12, umax: 12 } },
      // The same PID, its feedforward computed from the motor: Kv = Ke + R·b/Kt
      // (0.7) + Kd (1) = 1.7, the velocity term only (order 1).
      { name: 'PID + feedforward', type: 'pidFF', params: { Kp: 30, Ki: 80, Kd: 1, Tf: 0.02, order: '1', umin: -12, umax: 12 } },
    ]),
    views: motorViews(),
  },
  {
    // Sliding mode on the library motor (design/research/sliding-mode.md):
    // three variants, each showing one thing; the gains are design inputs
    // (λ, φ, limits) and hand gains (K, k1). k2 = 44 is Levant's 1.1·L/β with
    // this motor's β = Kt/(J·R) and a guessed L: derived from the plant, an
    // open question for the person (roadmap).
    name: 'DC motor, sliding mode',
    summary: 'The motor under sliding-mode control, on its phase portrait. Compare the ideal relay, a boundary layer and super-twisting: a response the load cannot change, and what chattering costs.',
    notes: 'A sliding-mode controller holds the shaft: it drives s = λ·e + ė to zero (e = r − angle, λ = 10 1/s). On the line s = 0 the error decays as e^(−λt) whatever the load or the inertia, so the slope λ, not the mass, sets how the shaft settles. The scope opens in XY, e across, speed up: after each step the beam runs at full voltage towards the line speed = 10·e, then slides along it into the origin (the whole run\'s fit, a ≈ 7, includes these arcs).\n\nTo read λ, set Horizontal to 100 ms/div at 0.4 s, channel 1 to 0.1 rad/div and channel 2 to 1 rad/s/div: only the sliding is left (the run now ends at 1.4 s), the line rises one division per division across, a reads λ, σ how tightly it slides.\n\nRelay (theory), V = 12 V·sign(s): press Time, switch on channels 3 and 4. V slams between ±12 V at 62.5 Hz (Measure counts both turns: 126/s), the current ripples 11 A peak to peak, and its rms of 2.7 A is 7.3 W of heat (R·i², R = 1 Ω). Boundary layer (practice): a stiff PD inside |s| < 2 rad/s (Kp 60, Kd 6): no chatter, but over the whole run (Auto Scale) the load at 3.2 s leaves 33 mrad (the relay about 5). Super-twisting: a continuous voltage whose integral part rejects the load; a 36 Hz ripple from the armature remains. A PID\'s integral would reject the load too; super-twisting adds convergence in finite time.\n\nTry: open Motor and triple J (rotor den [0.06, 0.1]): the relay and the layer keep the slope, super-twisting first overshoots the line. Or make the armature ten times faster (den [0.001, 1]): the relay chatters at 250 Hz and makes about five times the heat.',
    signals: {
      r: { period: PERIOD, components: [{ type: 'square', params: { amplitude: 1, time: 0.25, width: 1.25, period: 2.5, count: 0 } }] },
      d: { period: PERIOD, components: [pulse(1, 3.2, 0.5)] },
    },
    // No channel scales: Auto Scale sets them on load.
    scope: { channels: channels('e', 'speed', { source: 'V', on: false, measure: true }, { source: 'i', on: false, measure: true }), view: { mode: 'xy' } },
    // Four records per controller sample: the relay's current is resolved and
    // every switch of V lands between two records (Recommendation 6).
    sim: { sampleTime: 0.00025 },
    ui: ui('Motor shaft'),
    diagram: motorDiagram([
      { name: 'Relay (theory)', type: 'slidingMode', params: { lambda: 10, K: 12, phi: 0, umin: -12, umax: 12 } },
      { name: 'Boundary layer', type: 'slidingMode', params: { lambda: 10, K: 12, phi: 2, umin: -12, umax: 12 } },
      { name: 'Super-twisting', type: 'superTwisting', params: { lambda: 10, k1: 4, k2: 44, umin: -12, umax: 12 } },
    ], { inputs: 3, Ts: 0.001 }),
    views: motorViews(),
  },
  {
    name: 'Encoder errors and torque ripple',
    summary: 'A motor speeding up with encoder errors, torque ripple and a shaft resonance, in the spectrogram. Change the colour scale, try FFT or a notch: tell errors that follow the speed from a resonance, and spot aliasing.',
    notes: 'A speed-controlled motor sweeps from 0 to 300 rad/s. Its encoder is off-centre (an error once per turn, 1×) and its tracks are not quite perpendicular (twice per turn, 2×); the inverter adds torque ripple six times per turn (6×), and the encoder sits behind a flexible shaft that resonates at 70 Hz. The scope opens in Spectrogram mode on the measured speed: each error is a straight line from the origin, rising with speed; the resonance is a horizontal line, and each order flares up as it crosses it (6× at about 73 rad/s, 2× at about 220 rad/s). The 6× line passes the scope\'s Nyquist frequency (200 Hz) and folds back down: aliasing.\n\nUp there it is weaker than the noise at low frequencies, so the absolute levels leave it black. Switch the colour to Above noise (Run Control › Colour, or the key above the levels strip at the right edge): each colour is then dB above the noise at its own frequency, and the whole 6× line shows, up to the Nyquist frequency, its turn there and back down, with the 3×, 4× and 5× orders; drag the ceiling down to brighten the weak ones. In Absolute, zoom the frequency axis to 100–200 Hz (the levels follow what is shown), or drag the floor down to about −60 dB.\n\nTry FFT mode, and a notch filter on the channel.',
    signals: {
      r: { period: PERIOD, components: [{ type: 'ramp', params: { amplitude: 300, time: 0.5, rise: 4 } }] },
    },
    scope: { channels: channels('speed_m', 'r', 'speed', 'V'), view: { mode: 'spectrogram' } },
    ui: { run: 'run', tab: 'plant', setup: 0.42 },
    diagram: {
      blocks: [
        src('r', 30, 112, 'rad/s'),
        ctrl(130, 90, 2, 0.001, [
          { name: 'PI speed', type: 'pid', params: { Kp: 0.5, Ki: 5, umin: -48, umax: 48 } },
          { name: 'Off', type: 'off', params: {} },
        ]),
        {
          id: 'motor', type: 'subsystem', name: 'Motor', params: {}, x: 330, y: 96,
          diagram: {
            blocks: [
              { id: 'V', type: 'inport', name: 'V', params: { port: 1 }, x: 30, y: 112 },
              { id: 'load', type: 'inport', name: 'ripple torque', params: { port: 2 }, x: 300, y: 220 },
              { id: 'sum', type: 'sum', params: { signs: '+-' }, x: 120, y: 104 },
              { id: 'arm', type: 'firstOrder', name: 'armature', params: { K: 1, tau: 0.002 }, x: 200, y: 96 },
              { id: 'kt', type: 'gain', name: 'Kt', params: { K: 0.1 }, x: 360, y: 100 },
              { id: 'tsum', type: 'sum', params: { signs: '++' }, x: 440, y: 104 },
              { id: 'mech', type: 'firstOrder', name: 'inertia and friction', params: { K: 200, tau: 0.2 }, x: 510, y: 96 },
              { id: 'w', type: 'outport', name: 'speed', params: { port: 1 }, x: 690, y: 112 },
              { id: 'ke', type: 'gain', name: 'Ke', params: { K: 0.1 }, x: 360, y: 280, flip: true },
            ],
            wires: [
              { from: 'V', to: 'sum' }, { from: 'sum', to: 'arm' }, { from: 'arm', to: 'kt' }, { from: 'kt', to: 'tsum' }, { from: 'load', to: 'tsum:1' },
              { from: 'tsum', to: 'mech' }, { from: 'mech', to: 'w' }, { from: 'mech', to: 'ke' }, { from: 'ke', to: 'sum:1' },
            ],
          },
        },
        { id: 'int', type: 'integrator', name: 'angle', params: { K: 1 }, x: 500, y: 96 },
        { id: 'ripple', type: 'fcn', name: 'torque ripple 6×', params: { expr: '0.05*sin(6*u)' }, x: 500, y: 230, flip: true },
        { id: 'rough', type: 'noise', name: 'torque noise', params: { std: 0.02, seed: 7 }, x: 330, y: 230, flip: true },
        // The encoder sits on the load, behind a flexible shaft that resonates at 70 Hz.
        { id: 'shaft', type: 'secondOrder', name: 'shaft resonance 70 Hz', params: { K: 1, wn: 439.8, zeta: 0.02 }, x: 650, y: 96 },
        { id: 'enc', type: 'fcn', name: 'encoder 1× and 2× errors', params: { expr: 'u + 0.02*sin(u + 0.5) + 0.01*sin(2*u + 1)' }, x: 820, y: 96 },
        { id: 'deriv', type: 'tf', name: 'speed from angle', params: { num: [1, 0], den: [0.001, 1], delay: 0 }, x: 990, y: 96 },
        sink('speed_m', 1160, 106, 'rad/s'),
        sink('speed', 650, 20, 'rad/s'),
        sink('V', 330, 20, 'V'),
      ],
      wires: [
        { from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'motor' }, { from: 'ripple', to: 'rough' }, { from: 'rough', to: 'motor:1' }, { from: 'motor', to: 'int' },
        { from: 'int', to: 'ripple' }, { from: 'int', to: 'shaft' }, { from: 'shaft', to: 'enc' }, { from: 'enc', to: 'deriv' }, { from: 'deriv', to: 'speed_m' }, { from: 'deriv', to: 'ctrl:1' },
        { from: 'motor', to: 'speed' }, { from: 'ctrl', to: 'V' },
      ],
    },
  },
  {
    name: 'DC motor, speed from an encoder',
    summary: 'A motor whose speed is not measured: only a coarse encoder angle is. Flip the observer from a raw difference to a Luenberger observer and a Kalman filter, and see the noise leave the voltage and the loop hold its speed.',
    notes: 'A PI holds the speed of the DC motor (the same motor as the position examples) while the reference r steps to 10 rad/s and down to 3 rad/s, and a load of 0.2 N·m brakes it from 3.5 to 4.3 s. The speed is not measured: an encoder counts 1024 steps per turn (6.1 mrad), with a little noise on its signal (σ 1 mrad), and an Observer block makes the speed the PI sees from those counts. Channel 3 is the voltage V, channel 4 the estimate\'s error (estimate − true speed); both carry Measure lines.\n\nIt opens on the raw finite difference: at Ts = 1 ms one count is 6.1 rad/s, so the estimate jumps between whole counts (3.1 rad/s rms of error) and the PI (Kp 2, Ki 40) passes that on: V chatters between its ±12 V limits (σ 6.1 V at 10 rad/s), and since the limits clip it the motor runs at 8.99 rad/s, not 10.\n\nThe Luenberger observer predicts the motor from its model (the page takes the model from the motor\'s blocks) and corrects it with the counts, its error dying out at the poles you place (s = −400 1/s here): 0.47 rad/s of error, V σ 0.96 V, the speed on 10. The Kalman filter takes the same model and computes its gain from the noise: R from the encoder\'s blocks (σ² + q²/12), Q a random push on V of variance 1 V² per sample. Its error is 0.056 rad/s rms and V σ 0.080 V, 55 and 76 times below the difference\'s; its slowest pole is at 101 rad/s. Neither model knows the load: under it the Kalman estimate reads 0.1 rad/s high and the motor runs at 2.90 rad/s, where the faster Luenberger is off by 0.02.\n\nTry: the Luenberger at w = 100 (as calm as the Kalman filter, slower to see the load); the Kalman filter with Q = 100 (it follows the load, with more noise); the difference with Tf = 0.02 s (a filter calms it, with a lag); an encoder of 4096 counts (q = 0.001534). FFT mode on V shows the difference\'s noise spread up to the Nyquist frequency.',
    signals: {
      r: { period: PERIOD, components: [{ type: 'step', params: { amplitude: 10, time: 0.2 } }, { type: 'step', params: { amplitude: -7, time: 2.5 } }] },
      d: { period: PERIOD, components: [pulse(0.2, 3.5, 0.8)] },
    },
    scope: { channels: channels('r', 'speed', { source: 'V', measure: true }, { source: 'est_error', measure: true }) },
    ui: ui('Motor speed'),
    sim: { sampleTime: 0.001 },
    diagram: {
      blocks: [
        src('r', 30, 112, 'rad/s'),
        src('d', 180, 230, 'N·m'),
        ctrl(130, 90, 2, 0.001, [
          { name: 'PI speed', type: 'pid', params: { Kp: 2, Ki: 40, umin: -12, umax: 12 } },
        ]),
        motorBlock(330, 96),
        { id: 'int', type: 'integrator', name: 'angle', params: { K: 1 }, x: 500, y: 96 },
        // The encoder: 1024 counts per turn (q = 2π/1024 rad), with a little
        // noise on its signal (edge jitter) before it is counted.
        { id: 'jitter', type: 'noise', name: 'encoder noise', params: { std: 0.001, seed: 5 }, x: 640, y: 96 },
        { id: 'enc', type: 'quantizer', name: 'encoder 1024 counts/turn', params: { q: (2 * Math.PI) / 1024 }, x: 780, y: 96 },
        sink('encoder', 920, 106, 'rad'),
        {
          id: 'obs', type: 'observer', name: 'speed estimator', params: { inputs: 2, outputs: 3, Ts: 0.001 }, x: 780, y: 260, flip: true,
          variants: [
            { name: 'Finite difference', type: 'difference', params: { Tf: 0 } },
            { name: 'Luenberger, placed poles', type: 'luenbergerPlaced', params: { w: [400] } },
            { name: 'Kalman filter', type: 'kalman', params: { Q: [1], R: null } },
          ],
          variant: 0,
        },
        sink('estimate', 600, 340, 'rad/s'),
        { id: 'esum', type: 'sum', params: { signs: '+-' }, x: 600, y: 420 },
        sink('est_error', 720, 428, 'rad/s'),
        sink('speed', 690, 30, 'rad/s'),
        sink('angle', 640, 20, 'rad'),
        sink('V', 330, 20, 'V'),
      ],
      wires: [
        { from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'motor' }, { from: 'd', to: 'motor:1' }, { from: 'motor', to: 'int' }, { from: 'int', to: 'angle' },
        { from: 'int', to: 'jitter' }, { from: 'jitter', to: 'enc' }, { from: 'enc', to: 'encoder' },
        { from: 'ctrl', to: 'obs' }, { from: 'enc', to: 'obs:1' }, { from: 'obs:1', to: 'ctrl:1' }, { from: 'obs:1', to: 'estimate' },
        { from: 'obs:1', to: 'esum' }, { from: 'motor', to: 'esum:1' }, { from: 'esum', to: 'est_error' },
        { from: 'motor', to: 'speed' }, { from: 'ctrl', to: 'V' },
      ],
    },
    views: [{
      // The rotor turns with angle in a fixed dial; at the right, the true
      // speed and the estimate the controller sees as bars (0.04 per rad/s),
      // the reference r a yellow mark on the scale.
      name: 'Motor speed', kind: '2d', view: [-1.1, -0.9, 1.1, 0.9],
      shapes: [
        { type: 'group', x: -0.5, y: 0.05, shapes: [
          { type: 'circle', cx: 0, cy: 0, r: 0.45, fill: 'panel', stroke: 'muted', lineWidth: 2 },
          ...ticks(0.45),
          { type: 'group', angle: 'angle', shapes: [
            { type: 'circle', cx: 0, cy: 0, r: 0.36, fill: 'ink' },
            { type: 'circle', cx: 0, cy: 0.2, r: 0.1, fill: 'ch2' },
            { type: 'line', x1: 0, y1: 0, x2: 0, y2: 0.43, stroke: 'ch2', lineWidth: 5 },
          ] },
          { type: 'circle', cx: 0, cy: 0, r: 0.05, fill: 'muted' },
        ] },
        { type: 'line', x1: 0.15, y1: -0.3, x2: 0.15, y2: 0.5, stroke: 'muted', lineWidth: 1 },
        { type: 'line', x1: '0.15 + 0.04*r', y1: -0.3, x2: '0.15 + 0.04*r', y2: 0.5, stroke: 'ch1', lineWidth: 3 },
        { type: 'rect', x: 0.15, y: 0.18, w: '0.04*speed', h: 0.16, fill: 'ch2' },
        { type: 'rect', x: 0.15, y: -0.22, w: '0.04*estimate', h: 0.16, fill: 'ch4' },
        { type: 'text', x: 0.55, y: 0.42, text: 'speed', size: 12, fill: 'muted' },
        { type: 'text', x: 0.55, y: 0.02, text: 'estimate', size: 12, fill: 'muted' },
        { type: 'text', x: 0.15, y: -0.38, text: '0', size: 11, fill: 'muted' },
        { type: 'text', x: 0.95, y: -0.38, text: '20 rad/s', size: 11, fill: 'muted' },
        { type: 'text', x: 0, y: -0.78, text: 'speed {speed:5.2} rad/s   estimate {estimate:5.2} rad/s   r {r:4.1} rad/s   V {V:5.1} V   load {d:3.1} N·m', size: 13 },
      ],
    }],
  },
  {
    name: 'Conical tank, gain scheduling',
    summary: 'A tank that widens upwards: quick when nearly empty, slow when full. Compare a gain-scheduled PI with fixed ones: why one set of gains cannot fit a plant that changes.',
    notes: 'A pump fills a tank that widens upwards; its outlet drains by gravity. Nearly empty, the level reacts fast; nearly full, slowly: a PI tuned for one level is wrong at the other.\n\nThe page computes the PI gains from the tank itself at each level (pole cancellation), and the gain-scheduled PI looks them up from the level. The reference climbs 0.15 → 0.45 → 0.8 m; at 2.2 s water is drawn off (d).',
    signals: {
      r: { period: PERIOD, components: [{ type: 'dc', params: { level: 0.15 } }, { type: 'step', params: { amplitude: 0.3, time: 1.5 } }, { type: 'step', params: { amplitude: 0.35, time: 3 } }] },
      d: { period: PERIOD, components: [pulse(0.15, 2.2, 0.5)] },
    },
    scope: { channels: channels('r', 'h', 'q', 'd') },
    ui: ui('Tank'),
    diagram: {
      blocks: [
        src('r', 30, 112, 'm'),
        src('d', 300, 220, 'm³/s'),
        // PIs by pole cancellation for a 0.25 s closed loop, computed from
        // the tank at these levels; each starts in balance at the start level.
        // The top level is 0.95 m, not the brim: at H = 1 m the tank
        // overflows, so its slope differs left and right there (decisions.md).
        ctrl(130, 90, 2, 0.02, [
          { name: 'Gain-scheduled PI', type: 'scheduledPI', params: { at: [0.1, 0.25, 0.5, 0.75, 0.95], Tcl: 0.25, Tr: 0.1, umin: 0, umax: 3 } },
          { name: 'PI tuned for full', type: 'scheduledPI', params: { at: [0.8], Tcl: 0.25, umin: 0, umax: 3 } },
          { name: 'PI tuned for empty', type: 'scheduledPI', params: { at: [0.15], Tcl: 0.25, umin: 0, umax: 3 } },
          { name: 'Off', type: 'off', params: {} },
        ]),
        // The pipe was already flowing: before 0.1 s it delivers what the pump gives at t = 0.
        { id: 'pipe', type: 'delay', name: 'pipe', params: { L: 0.1, y0: null }, x: 320, y: 96 },
        { id: 'sum', type: 'sum', params: { signs: '+-' }, x: 440, y: 104 },
        { id: 'tank', type: 'conicalTank', name: 'tank', params: { r0: 0.05, R: 0.5, H: 1, a: 0.1, g: 9.81, h0: 0.15 }, x: 510, y: 90 },
        sink('h', 720, 106, 'm'),
        sink('q', 320, 20, 'm³/s'),
      ],
      wires: [
        { from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'pipe' }, { from: 'pipe', to: 'sum' }, { from: 'd', to: 'sum:1' }, { from: 'sum', to: 'tank' },
        { from: 'tank', to: 'h' }, { from: 'tank', to: 'ctrl:1' }, { from: 'ctrl', to: 'q' },
      ],
    },
    views: [{
      name: 'Tank', kind: '2d', view: [-1, -0.25, 1, 1.3],
      shapes: [
        { type: 'polygon', points: [[-0.05, 0], [0.05, 0], ['0.05 + 0.45*h', 'h'], ['-0.05 - 0.45*h', 'h']], fill: 'ch3', stroke: 'none' },
        { type: 'line', x1: -0.05, y1: 0, x2: -0.5, y2: 1, stroke: 'ink', lineWidth: 3 },
        { type: 'line', x1: 0.05, y1: 0, x2: 0.5, y2: 1, stroke: 'ink', lineWidth: 3 },
        { type: 'line', x1: '-0.05 - 0.45*r', y1: 'r', x2: '0.05 + 0.45*r', y2: 'r', stroke: 'ch1', lineWidth: 2 },
        { type: 'text', x: '0.12 + 0.45*r', y: 'r', text: 'r', size: 12, fill: 'ch1', anchor: 'start' },
        { type: 'line', x1: -0.9, y1: 1.12, x2: -0.15, y2: 1.12, stroke: 'muted', lineWidth: 6 },
        { type: 'arrow', x1: -0.15, y1: 1.12, x2: -0.15, y2: '1.1 - 0.25*q', stroke: 'ch2', lineWidth: 4 },
        { type: 'line', x1: 0, y1: 0, x2: 0, y2: -0.12, stroke: 'muted', lineWidth: 6 },
        { type: 'arrow', x1: 0.06, y1: -0.08, x2: '0.06 + 0.6*d', y2: -0.08, stroke: 'ch4', lineWidth: 3 },
        { type: 'text', x: 0, y: 1.24, text: 'h {h:4.2} m   r {r:4.2} m   pump q {q:4.2} m³/s   drawn off d {d:4.2} m³/s', size: 13 },
      ],
    }],
  },
  {
    name: 'Pendulum swing-up',
    summary: 'A pendulum below a cart, swung up and balanced. Compare with LQR alone, and push it: energy-based control brings it near the top, a linear controller computed from the cart and pole holds it there.',
    notes: 'A pendulum hangs below a cart. The controller pumps energy into the swing (a Lyapunov function of the energy falls with every push), then, near the top, catches the pole with LQR, its gains computed from the cart and pole, and holds it; at 3.5 s it is pushed (d). Flip to "LQR only" to see why the swing-up is needed.',
    signals: {
      r: { period: PERIOD, components: [] },
      d: { period: PERIOD, components: [pulse(4, 3.5, 0.1)] },
    },
    scope: { channels: channels('x', 'theta', 'F', 'd') },
    ui: ui('Cart and pole'),
    diagram: {
      blocks: [
        src('r', 30, 112, 'm'),
        src('d', 300, 200, 'N'),
        ctrl(130, 80, 5, 0.01, [
          { name: 'Swing-up + LQR catch', type: 'swingUpLqr', params: { kE: 3, kx: 8, kv: 5, thetaS: 0.4, Q: Q_SINGLE, R: 0.1, umin: -25, umax: 25 } },
          { name: 'LQR only', type: 'lqr', params: { Q: Q_SINGLE, R: 0.1, umin: -25, umax: 25 } },
          { name: 'Off', type: 'off', params: {} },
        ]),
        { id: 'sum', type: 'sum', params: { signs: '++' }, x: 330, y: 104 },
        { id: 'cart', type: 'cartPole', name: 'cart and pole', params: { M: 1, m: 0.2, l: 0.5, g: 9.81, b: 0.1, theta0: Math.PI }, x: 400, y: 80 },
        sink('x', 640, 84, 'm'), sink('theta', 640, 120, 'rad'),
        sink('F', 330, 20, 'N'),
      ],
      wires: [
        { from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'sum' }, { from: 'd', to: 'sum:1' }, { from: 'sum', to: 'cart' }, { from: 'ctrl', to: 'F' },
        { from: 'cart', to: 'x' }, { from: 'cart:1', to: 'theta' },
        { from: 'cart', to: 'ctrl:1' }, { from: 'cart:1', to: 'ctrl:2' }, { from: 'cart:2', to: 'ctrl:3' }, { from: 'cart:3', to: 'ctrl:4' },
      ],
    },
    views: [cartView('Cart and pole', [{ len: 0.5, angle: '-theta' }], 'x {x:5.2} m   θ {theta*180/pi:6.1}°   F {F:5.1} N   push {d:3.1} N', [-1.9, -0.75, 1.9, 0.8])],
  },
  {
    name: 'Triple pendulum',
    summary: 'Three rods hanging below a cart, swung up by a plan the page computes, then held by LQR. Push it, or flip to LQR only: why a controller for the top alone cannot get there.',
    notes: 'Three rods hang below a cart. When the system loads, the page plans a swing-up from the cart and rods themselves; until the plan is ready (a few seconds, its progress beside the title) the rods hang.\n\nThe plan is a force that brings all three up in 2.4 s, followed with time-varying LQR, then LQR holds them. At 3.5 s the cart is pushed (d). Flip to "LQR only" to see that a controller for the top alone cannot get there.',
    signals: {
      r: { period: PERIOD, components: [] },
      d: { period: PERIOD, components: [pulse(4, 3.5, 0.1)] },
    },
    scope: { channels: channels('x', 'theta1', 'F', 'd') },
    ui: ui('Cart and triple pendulum'),
    diagram: {
      blocks: [
        src('r', 30, 132, 'm'),
        src('d', 300, 260, 'N'),
        // The plan may use 75 % of the ±40 N, leaving the rest to the feedback.
        ctrl(130, 70, 9, 0.01, [
          { name: 'Planned swing-up + TV-LQR', type: 'trajectory', params: { T: 2.4, segments: 12, planShare: 0.75, Q: Q_TRIPLE, R: 0.1, umin: -40, umax: 40 } },
          { name: 'LQR only (cannot swing up)', type: 'lqr', params: { Q: Q_TRIPLE, R: 0.1, umin: -40, umax: 40 } },
          { name: 'Off', type: 'off', params: {} },
        ]),
        { id: 'sum', type: 'sum', params: { signs: '++' }, x: 330, y: 124 },
        { id: 'cart', type: 'pendulumCart', name: 'cart and 3 rods', params: { links: 3, M: 1, m1: 0.1, l1: 0.25, m2: 0.1, l2: 0.25, m3: 0.1, l3: 0.25, g: 9.81, b: 0.1, theta10: Math.PI, theta20: Math.PI, theta30: Math.PI }, x: 400, y: 60 },
        sink('x', 640, 64, 'm'), sink('theta1', 640, 100, 'rad'), sink('theta2', 640, 136, 'rad'), sink('theta3', 640, 172, 'rad'),
        sink('F', 330, 20, 'N'),
      ],
      wires: [
        { from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'sum' }, { from: 'd', to: 'sum:1' }, { from: 'sum', to: 'cart' }, { from: 'ctrl', to: 'F' },
        { from: 'cart', to: 'x' }, { from: 'cart:1', to: 'theta1' }, { from: 'cart:2', to: 'theta2' }, { from: 'cart:3', to: 'theta3' },
        ...Array.from({ length: 8 }, (_, i) => ({ from: i ? `cart:${i}` : 'cart', to: `ctrl:${i + 1}` })),
      ],
    },
    views: [cartView('Cart and triple pendulum', [
      { len: 0.25, angle: '-theta1' },
      { len: 0.25, angle: '-(theta2 - theta1)' },
      { len: 0.25, angle: '-(theta3 - theta2)' },
    ], 'x {x:5.2} m   θ1 {theta1*180/pi:6.1}°   θ2 {theta2*180/pi:6.1}°   θ3 {theta3*180/pi:6.1}°   F {F:5.1} N', [-1.3, -0.8, 1.3, 1.1])],
  },
  {
    // Made for the Auto-tune tab: a classic process (three lags and a dead
    // time) under a PID that was tuned badly by hand. Time is scaled so the
    // demo fits 5 s. The gains are hand-picked to be poor; the tab computes
    // better ones from the plant.
    name: 'Oven, badly tuned',
    summary: 'An oven with a poorly tuned temperature controller and a dead time. It opens on Auto-tune: press Start and watch automatic tuning remove the ringing; without anti-windup, see integrator windup.',
    notes: 'A PID holds an oven\'s temperature: heater, chamber, a dead time and a thermocouple (time scaled to fit 5 s). Its gains were picked badly: every setpoint step overshoots and rings, and so does the door opening at 3.6 s (d). It opens on the Auto-tune tab: press Start and watch the cost fall and the ringing go, iteration by iteration. The variant without anti-windup has the same gains, but its integral winds up while the heater is full on: the first step overshoots to 67 °C instead of 52 °C.',
    signals: {
      r: { period: PERIOD, components: [{ type: 'step', params: { amplitude: 40, time: 0.2 } }, { type: 'step', params: { amplitude: 20, time: 2.2 } }] },
      d: { period: PERIOD, components: [pulse(25, 3.6, 0.8)] },
    },
    scope: { channels: channels('r', 'T', 'P', 'd') },
    ui: { ...ui('Oven'), tab: 'tune' },
    diagram: {
      blocks: [
        src('r', 30, 112, '°C'),
        src('d', 300, 220, '%'),
        ctrl(130, 90, 2, 0.02, [
          { name: 'PID, badly tuned', type: 'pid', params: { Kp: 6, Ki: 12, Kd: 0.1, Tf: 0.02, umin: 0, umax: 100 } },
          { name: 'PID, badly tuned, no anti-windup', type: 'pid', params: { Kp: 6, Ki: 12, Kd: 0.1, Tf: 0.02, umin: 0, umax: 100, aw: 'off' } },
        ]),
        { id: 'heater', type: 'firstOrder', name: 'heater', params: { K: 1, tau: 0.1 }, x: 300, y: 96 },
        { id: 'sum', type: 'sum', params: { signs: '+-' }, x: 420, y: 104 },
        { id: 'oven', type: 'firstOrder', name: 'chamber', params: { K: 1, tau: 0.5 }, x: 490, y: 96 },
        { id: 'lag', type: 'delay', name: 'to sensor', params: { L: 0.1, y0: 0 }, x: 620, y: 96 },
        { id: 'tc', type: 'firstOrder', name: 'thermocouple', params: { K: 1, tau: 0.05 }, x: 740, y: 96 },
        sink('T', 900, 106, '°C'),
        sink('P', 300, 20, '%'),
      ],
      wires: [
        { from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'heater' }, { from: 'heater', to: 'sum' }, { from: 'd', to: 'sum:1' }, { from: 'sum', to: 'oven' },
        { from: 'oven', to: 'lag' }, { from: 'lag', to: 'tc' }, { from: 'tc', to: 'T' }, { from: 'tc', to: 'ctrl:1' }, { from: 'ctrl', to: 'P' },
      ],
    },
    views: [{
      // The oven with its heating element (lit along its length by the
      // power P, which the controller keeps within 0–100 %), a thermometer
      // column for T (0–100 °C; an overshoot past that leaves the tube, as
      // nothing is clamped) with the setpoint r marked, and the door, which
      // opens while heat is lost (d).
      name: 'Oven', kind: '2d', view: [-1.2, -0.75, 1.2, 0.95],
      shapes: [
        { type: 'rect', x: -0.75, y: -0.45, w: 1.1, h: 1.1, fill: 'panel', stroke: 'ink', lineWidth: 3 },
        { type: 'rect', x: -0.65, y: -0.35, w: 0.9, h: 0.9, fill: 'muted' },
        { type: 'line', x1: -0.6, y1: -0.28, x2: 0.2, y2: -0.28, stroke: 'ink', lineWidth: 6 },
        { type: 'line', x1: -0.6, y1: -0.28, x2: '-0.6 + 0.008*P', y2: -0.28, stroke: 'ch3', lineWidth: 6 },
        { type: 'group', x: 0.35, y: -0.45, angle: '-0.012*d', shapes: [{ type: 'rect', x: -0.05, y: 0, w: 0.05, h: 1.1, fill: 'ink' }] },
        { type: 'rect', x: 0.7, y: -0.45, w: 0.12, h: 1.1, fill: 'panel', stroke: 'muted', lineWidth: 2 },
        { type: 'rect', x: 0.72, y: -0.45, w: 0.08, h: '0.011*T', fill: 'ch2' },
        { type: 'line', x1: 0.66, y1: '-0.45 + 0.011*r', x2: 0.86, y2: '-0.45 + 0.011*r', stroke: 'ch1', lineWidth: 3 },
        { type: 'text', x: 0.92, y: '-0.45 + 0.011*r', text: 'r', size: 12, fill: 'ch1', anchor: 'start' },
        { type: 'text', x: 0, y: 0.82, text: 'T {T:5.1} °C   r {r:4.0} °C   heater {P:5.1} %   door loss {d:4.0} %', size: 13 },
      ],
    }],
  },
  // The DC motor swinging an unbalanced arm that hil_plant.py simulated by
  // hand until the simulator ran the library (design/output/hil-simulator.md
  // §6): now the example plant's default model, and a system of its own.
  //   armature 1/(L·s + R)   R = 2 Ω, L = 4 mH; out: the current i
  //   K (= Ke)               0.1 N·m/A = 0.1 V·s/rad, once (Ke follows K)
  //   rotor 1/(J·s + b)      J = 2.5e-3 kg·m², b = 2e-3 N·m·s/rad
  //   Coulomb friction       Tc·tanh(ω/0.01), Tc = 0.01 N·m
  //   gravity                mgl·sin(angle), mgl = 0.1 N·m; angle 0 hangs down
  {
    name: 'DC motor with an unbalanced arm',
    summary: 'A motor swinging an arm that gravity pulls down, with friction: the plant the example HIL simulator runs. Compare P with PID and see why holding against gravity needs integral action.',
    notes: 'A DC motor swings an arm with an unbalanced mass: gravity pulls it down with mgl·sin(angle), Coulomb and viscous friction brake it, and the motor has 12 V. To hold the arm out sideways the controller needs integral action (gravity leaves a P or PD short of r). It is the plant the example HIL simulator runs by default, there varied by up to 15 % and unknown to the page; here it is open. Flip to "P, a first guess" to see the offset gravity leaves; open Motor and arm to see the physics.',
    signals: {
      r: { period: PERIOD, components: [{ type: 'square', params: { amplitude: 1.5, time: 0.5, width: 2.5, period: 5, count: 0 } }] },
      load: { period: PERIOD, components: [pulse(0.05, 3.5, 0.3)] },
    },
    scope: { channels: channels('r', 'angle', 'V', 'current') },
    ui: ui('Arm'),
    diagram: {
      blocks: [
        src('r', 30, 112, 'rad'),
        src('load', 180, 230, 'N·m'),
        ctrl(130, 90, 2, 0.01, [
          { name: 'PID', type: 'pid', params: { Kp: 10, Ki: 20, Kd: 0.6, Tf: 0.01, umin: -12, umax: 12 } },
          { name: 'P, a first guess', type: 'pid', params: { Kp: 2, umin: -12, umax: 12 } },
          { name: 'Off', type: 'off', params: {} },
        ]),
        {
          id: 'motor', type: 'subsystem', name: 'Motor and arm', params: {}, x: 330, y: 96,
          diagram: {
            blocks: [
              { id: 'V', type: 'inport', name: 'V', params: { port: 1 }, x: 30, y: 112 },
              { id: 'load', type: 'inport', name: 'load torque', params: { port: 2 }, x: 330, y: 300 },
              { id: 'sum', type: 'sum', params: { signs: '+-' }, x: 120, y: 104 },
              { id: 'arm', type: 'tf', name: 'armature 1/(Ls + R)', params: { num: [1], den: [0.004, 2], delay: 0 }, x: 190, y: 96 },
              sink('current', 360, 20, 'A'),
              { id: 'kt', type: 'gain', name: 'K (= Ke)', params: { K: 0.1 }, x: 370, y: 100 },
              { id: 'tsum', type: 'sum', params: { signs: '+--+' }, x: 460, y: 104 },
              { id: 'rotor', type: 'tf', name: 'rotor 1/(Js + b)', params: { num: [1], den: [0.0025, 0.002], delay: 0 }, x: 530, y: 96 },
              { id: 'int', type: 'integrator', name: 'angle', params: { K: 1 }, x: 680, y: 96 },
              { id: 'th', type: 'outport', name: 'angle', params: { port: 1 }, x: 820, y: 112 },
              { id: 'w', type: 'outport', name: 'speed', params: { port: 2 }, x: 820, y: 30 },
              { id: 'ke', type: 'gain', name: 'Ke (= K)', params: { K: 0.1 }, x: 370, y: 380, flip: true },
              { id: 'sgn', type: 'fcn', name: 'Coulomb tanh(ω/0.01)', params: { expr: 'tanh(u/0.01)' }, x: 530, y: 220, flip: true },
              { id: 'tc', type: 'gain', name: 'Tc', params: { K: 0.01 }, x: 400, y: 220, flip: true },
              { id: 'sin', type: 'fcn', name: 'gravity sin(angle)', params: { expr: 'sin(u)' }, x: 680, y: 300, flip: true },
              { id: 'mgl', type: 'gain', name: 'mgl', params: { K: 0.1 }, x: 540, y: 300, flip: true },
            ],
            wires: [
              { from: 'V', to: 'sum' }, { from: 'sum', to: 'arm' }, { from: 'arm', to: 'kt' }, { from: 'arm', to: 'current' }, { from: 'kt', to: 'tsum' },
              { from: 'sgn', to: 'tc' }, { from: 'tc', to: 'tsum:1' }, { from: 'mgl', to: 'tsum:2' }, { from: 'load', to: 'tsum:3' },
              { from: 'tsum', to: 'rotor' }, { from: 'rotor', to: 'int' }, { from: 'rotor', to: 'w' }, { from: 'rotor', to: 'ke' }, { from: 'rotor', to: 'sgn' },
              { from: 'ke', to: 'sum:1' }, { from: 'int', to: 'th' }, { from: 'int', to: 'sin' }, { from: 'sin', to: 'mgl' },
            ],
          },
        },
        sink('angle', 600, 98, 'rad'), sink('speed', 600, 30, 'rad/s'),
        sink('V', 330, 20, 'V'),
      ],
      wires: [
        { from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'motor' }, { from: 'load', to: 'motor:1' }, { from: 'ctrl', to: 'V' },
        { from: 'motor', to: 'angle' }, { from: 'motor:1', to: 'speed' }, { from: 'motor', to: 'ctrl:1' },
      ],
    },
    // The arm hangs at angle 0 and turns counter-clockwise; the yellow mark is r.
    views: [{
      name: 'Arm', kind: '2d', view: [-1.1, -1.05, 1.1, 1.0],
      shapes: [
        { type: 'circle', cx: 0, cy: 0, r: 0.75, fill: 'panel', stroke: 'muted', lineWidth: 2 },
        ...ticks(0.75),
        { type: 'group', angle: 'r', shapes: [{ type: 'line', x1: 0, y1: -0.8, x2: 0, y2: -0.95, stroke: 'ch1', lineWidth: 5 }] },
        { type: 'group', angle: 'angle', shapes: [
          { type: 'line', x1: 0, y1: 0, x2: 0, y2: -0.6, stroke: 'ch2', lineWidth: 7 },
          { type: 'circle', cx: 0, cy: -0.6, r: 0.11, fill: 'ch2' },
        ] },
        { type: 'circle', cx: 0, cy: 0, r: 0.12, fill: 'ink' },
        { type: 'text', x: 0, y: 0.9, text: 'angle {angle:5.2} rad   r {r:4.1} rad   V {V:5.1} V   load {load:4.2} N·m', size: 13 },
      ],
    }],
  },
  HIL_SYSTEM,
  // The same plant in the agentic mode (input 31): the person and an agent
  // look at the same page through the MCP server, identify the plant
  // together and tune it together. The plant is drawn at random, so neither
  // knows what is inside.
  {
    ...HIL_SYSTEM,
    name: 'HIL with an agent',
    summary: 'A plant nobody here knows, drawn at random and run live, and an agent on the same page through the MCP server: identify it together, then tune it together.',
    notes: 'The agentic mode: an agent (an AI assistant whose client speaks MCP) works on this page with you. It sees what you see, reads the data itself (the screen, the live record, the plant\'s interface, Auto-tune runs, Analysis) and can act, and you talk it over. The plant is drawn at random from the System library\'s models, its physics varied, so it is a black box to you both: identify it together, then tune it together. Step by step: 1. Export ▾, MCP server: unzip loop-tuner-mcp.zip and register it with your agent\'s client as its README.md says (runme.sh or runme.cmd prints the exact lines), then start the agent. 2. Ask the agent to open the Loop Tuner page (it gives the address, http://127.0.0.1:8766/ unless that port is taken) and load this system there: on that page it says "An agent is connected". 3. Export ▾, HIL plant: unzip hil-plant.zip and run sh runme.sh --random (Linux, macOS) or runme.cmd --random (Windows). 4. Plant tab, Connect; Run. 5. Ask: "What do you see? Let us identify this plant: which experiment would you run?", then "Now let us tune it together". The agent changes the controller only when you agree, and says what it did; Ctrl+Z takes any change back. Everything else as in HIL: an external plant.',
    tags: [{ label: 'Agent', kind: 'feature' }],
  },
];


// What the HIL simulator reads of each model (design/output/hil-simulator.md
// §4): its physical parameters (name, where, unit; same: tied to another, as
// Ke to Kt), its effects (a block; off, a Gain of 1, pass, or 0, zero) and the
// ranges it declares for its ports (full scale, hard range; an input's
// full scale is its limits). The page's
// simulation never reads these.
const phys = (name, at, unit, same) => ({ name, at, unit, ...(same ? { same } : {}) });
const MOTOR_PHYSICS = [
  phys('R', 'motor/arm.den[1]', 'Ω'), phys('L', 'motor/arm.den[0]', 'H'), phys('Kt', 'motor/kt.K', 'N·m/A'), phys('Ke', 'motor/ke.K', 'V·s/rad', 'Kt'),
  phys('J', 'motor/rotor.den[0]', 'kg·m²'), phys('b', 'motor/rotor.den[1]', 'N·m·s/rad'),
];
const SIMULATOR = {
  'Mass–spring–damper': { physics: [phys('1/m', 'm.K', '1/kg'), phys('c', 'c.K', 'N·s/m'), phys('k', 'k.K', 'N/m')] },
  'DC motor, position control': { physics: MOTOR_PHYSICS },
  'Following a sine (XY)': { physics: MOTOR_PHYSICS },
  'DC motor, sliding mode': { physics: MOTOR_PHYSICS },
  'Encoder errors and torque ripple': {
    physics: [phys('1/R', 'motor/arm.K', 'A/V'), phys('L/R', 'motor/arm.tau', 's'), phys('Kt', 'motor/kt.K', 'N·m/A'), phys('Ke', 'motor/ke.K', 'V·s/rad', 'Kt'),
      phys('1/b', 'motor/mech.K', 'rad/(N·m·s)'), phys('J/b', 'motor/mech.tau', 's'), phys('ωn', 'shaft.wn', 'rad/s'), phys('ζ', 'shaft.zeta', '1')],
    effects: [{ name: 'torque ripple', at: 'ripple', off: 'zero' }, { name: 'torque noise', at: 'rough', off: 'pass' }, { name: 'shaft resonance', at: 'shaft', off: 'pass' }, { name: 'encoder errors', at: 'enc', off: 'pass' }],
  },
  'Conical tank, gain scheduling': {
    physics: [phys('r0', 'tank.r0', 'm'), phys('R', 'tank.R', 'm'), phys('H', 'tank.H', 'm'), phys('a', 'tank.a', 'm²'), phys('Td', 'pipe.L', 's')],
    effects: [{ name: 'pipe dead time', at: 'pipe', off: 'pass' }],
    ports: { h: { scale: [0, 1.2], hard: [0, 1] } },
  },
  'Pendulum swing-up': { physics: [phys('M', 'cart.M', 'kg'), phys('m', 'cart.m', 'kg'), phys('l', 'cart.l', 'm'), phys('b', 'cart.b', 'N·s/m')] },
  'Triple pendulum': {
    physics: [phys('M', 'cart.M', 'kg'), ...[1, 2, 3].flatMap((i) => [phys(`m${i}`, `cart.m${i}`, 'kg'), phys(`l${i}`, `cart.l${i}`, 'm')]), phys('b', 'cart.b', 'N·s/m')],
  },
  'Oven, badly tuned': {
    physics: [phys('heater τ', 'heater.tau', 's'), phys('K', 'oven.K', '1'), phys('τ', 'oven.tau', 's'), phys('Td', 'lag.L', 's'), phys('sensor τ', 'tc.tau', 's')],
    effects: [{ name: 'thermocouple lag', at: 'tc', off: 'pass' }],
    // An over-temperature trip below what full power reaches (100 °C).
    ports: { T: { scale: [0, 120], hard: [-10, 95] } },
  },
  'DC motor with an unbalanced arm': {
    physics: [phys('R', 'motor/arm.den[1]', 'Ω'), phys('L', 'motor/arm.den[0]', 'H'), phys('K', 'motor/kt.K', 'N·m/A'), phys('Ke', 'motor/ke.K', 'V·s/rad', 'K'),
      phys('J', 'motor/rotor.den[0]', 'kg·m²'), phys('b', 'motor/rotor.den[1]', 'N·m·s/rad'), phys('Tc', 'motor/tc.K', 'N·m'), phys('mgl', 'motor/mgl.K', 'N·m')],
    effects: [{ name: 'Coulomb friction', at: 'motor/sgn', off: 'zero' }],
    // As the plant has always declared them: what a PID reaches with room to spare.
    ports: {
      angle: { scale: [-Math.PI, Math.PI], hard: [-2.5, 2.5] }, speed: { scale: [-120, 120], hard: [-60, 60] }, current: { scale: [-12, 12], hard: [-10, 10] },
      r: { scale: [-3, 3] }, load: { scale: [-0.2, 0.2] },
    },
  },
};
for (const e of EXAMPLE_PLANTS) Object.assign(e, SIMULATOR[e.name] ?? {});

// A new project's plant: the reference alone.
export const EMPTY_PLANT = { blocks: [src('r', 60, 104, '1')], wires: [] };
