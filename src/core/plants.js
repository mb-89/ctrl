// The System library's systems. Few, and each one does something visible:
// its input moves the plant, its signals are named for what they are (force F,
// position x, …) and on the scope, and its view shows the motion
// (design/output/system-library.md). Each runs 5 s and opens running, on its
// view in the Plant tab (ui). The controlled ones grow in difficulty: a PID
// on a motor, a gain-scheduled PI on a tank, an energy (Lyapunov) swing-up of a
// pendulum, state feedback on a triple pendulum. Each has a reference r and a
// disturbance d, and a Controller block whose variants can be flipped.

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

// The DC motor with its angle, shared by the systems built on it: a
// Controller (variants given) sets the voltage V, the load torque d brakes it.
// Motor is built from blocks whose parameters are the physics, each once
// (no black box; design/research/sliding-mode.md, Recommendation 1):
//   armature 1/(L·s + R)   R = 1 Ω, L = 10 mH; its output is the current i
//   Kt (= Ke), Ke (= Kt)   0.5 N·m/A and 0.5 V·s/rad: equal in SI units, or
//                          the motor would make or lose energy
//   rotor 1/(J·s + b)      J = 0.02 kg·m², b = 0.1 N·m·s/rad; out: the speed
// opts.inputs 3 also feeds the speed to the Controller (input 3), and adds
// the error e = r − angle as a Sink; opts.Ts is the Controller's sample time.
const motorDiagram = (variants, { inputs = 2, Ts = 0.01 } = {}) => ({
      blocks: [
        src('r', 30, 112, 'rad'),
        src('d', 180, 230, 'N·m'),
        ctrl(130, 90, inputs, Ts, variants),
        {
          id: 'motor', type: 'subsystem', name: 'Motor', params: {}, x: 330, y: 96,
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
        },
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

// Cart–pole gains: discrete LQR (Ts = 10 ms) at the upright rest, for the
// outputs in block order (x, θ…, v, ω…); see design/output/system-library.md.
const K_SINGLE = [-9.177, -63.18, -10.33, -13.34];
const K_TRIPLE = [-6.9896, -497.8, 1400.5, -1011.7, -12.018, -18.079, 79.602, -102.41];
const K_TRIPLE_GENTLE = [-2.3, -417, 1050, -686, -4.496, -14.83, 62.84, -67.32];

export const EXAMPLE_PLANTS = [
  {
    name: 'Mass–spring–damper',
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
    notes: 'The motor follows a slow sine, one period per sweep. The scope opens in XY mode with Δ: across is the reference r, up is the error r − angle. Perfect following would be a flat line on the axis. With P alone the error leads r by a quarter period and the figure is a wide ellipse; PD shrinks it; the integral of the PID turns the error against r, so the figure collapses to a thin tilted line. PID + feedforward adds a velocity feedforward Kv, set by hand, so the voltage the moving reference needs comes from r itself: once the start-up ringing has died away, the figure lies flat on the axis. Each figure reads out its best line and its spread σ. Press Time to see the same runs over time.',
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
      // Kv set by hand: raised until the figure lay flat.
      { name: 'PID + feedforward', type: 'pid', params: { Kp: 30, Ki: 80, Kd: 1, Tf: 0.02, Kv: 1.7, umin: -12, umax: 12 } },
    ]),
    views: motorViews(),
  },
  {
    // Sliding mode on the library motor (design/research/sliding-mode.md):
    // three variants, each showing one thing; the gains are design inputs
    // (λ, φ, limits) and hand gains (K, k1, k2), nothing computed from the plant.
    name: 'DC motor, sliding mode',
    notes: 'A sliding-mode controller holds the shaft: it drives s = λ·e + ė to zero (e = r − angle, λ = 10 1/s). On the line s = 0 the error decays as e^(−λt) whatever the load or the inertia, so the slope λ, not the mass, sets how the shaft settles. The scope opens in XY, e across, speed up: after each step the beam runs at full voltage towards the line speed = 10·e, then slides along it into the origin (the whole run\'s fit, a ≈ 7, includes these arcs). To read λ, set Horizontal to 100 ms/div at 0.4 s, channel 1 to 0.1 rad/div and channel 2 to 1 rad/s/div: only the sliding is left (the run now ends at 1.4 s), the line rises one division per division across, a reads λ, σ how tightly it slides. Relay (theory), V = 12 V·sign(s): press Time, switch on channels 3 and 4. V slams between ±12 V at 62.5 Hz (Measure counts both turns: 126/s), the current ripples 11 A peak to peak, and its rms of 2.7 A is 7.3 W of heat (R·i², R = 1 Ω). Boundary layer (practice): a stiff PD inside |s| < 2 rad/s (Kp 60, Kd 6): no chatter, but over the whole run (Auto Scale) the load at 3.2 s leaves 33 mrad (the relay about 5). Super-twisting: a continuous voltage whose integral part rejects the load; a 36 Hz ripple from the armature remains. A PID\'s integral would reject the load too; super-twisting adds convergence in finite time. Try: open Motor and triple J (rotor den [0.06, 0.1]): the relay and the layer keep the slope, super-twisting first overshoots the line. Or make the armature ten times faster (den [0.001, 1]): the relay chatters at 250 Hz and makes about five times the heat.',
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
    notes: 'A speed-controlled motor sweeps from 0 to 300 rad/s. Its encoder is off-centre (an error once per turn, 1×) and its tracks are not quite perpendicular (twice per turn, 2×); the inverter adds torque ripple six times per turn (6×), and the encoder sits behind a flexible shaft that resonates at 70 Hz. The scope opens in Spectrogram mode on the measured speed: each error is a straight line from the origin, rising with speed; the resonance is a horizontal line, and each order flares up as it crosses it (6× at about 73 rad/s, 2× at about 220 rad/s). The 6× line passes the scope\'s Nyquist frequency (200 Hz) and folds back down: aliasing. Up there it is weaker than the noise at low frequencies, so the absolute levels leave it black. Switch the colour to Above noise (Run Control › Colour, or the key above the levels strip at the right edge): each colour is then dB above the noise at its own frequency, and the whole 6× line shows, up to the Nyquist frequency, its turn there and back down, with the 3×, 4× and 5× orders; drag the ceiling down to brighten the weak ones. In Absolute, zoom the frequency axis to 100–200 Hz (the levels follow what is shown), or drag the floor down to about −60 dB. Try FFT mode, and a notch filter on the channel.',
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
    name: 'Conical tank, gain scheduling',
    notes: 'A pump fills a tank that widens upwards; its outlet drains by gravity. Nearly empty, the level reacts fast; nearly full, slowly: a PI tuned for one level is wrong at the other. The gain-scheduled PI looks its gains up from the level. The reference climbs 0.15 → 0.45 → 0.8 m; at 2.2 s water is drawn off (d).',
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
        // PI by pole cancellation for a 0.25 s closed loop at level h:
        // Kp = A(h) / 0.25, Ki = a √(2g) / (2 √h · 0.25); u0 balances the outlet at 0.15 m.
        ctrl(130, 90, 2, 0.02, [
          { name: 'Gain-scheduled PI', type: 'gainScheduled', params: { at: [0.1, 0.25, 0.5, 0.75, 1], Kp: [0.113, 0.332, 0.95, 1.887, 3.142], Ki: [2.801, 1.772, 1.253, 1.023, 0.886], u0: 0.172, Tr: 0.1, umin: 0, umax: 3 } },
          { name: 'PI tuned for full', type: 'pid', params: { Kp: 2.112, Ki: 0.99, Kd: 0, u0: 0.172, umin: 0, umax: 3 } },
          { name: 'PI tuned for empty', type: 'pid', params: { Kp: 0.173, Ki: 2.287, Kd: 0, u0: 0.172, umin: 0, umax: 3 } },
          { name: 'Off', type: 'off', params: {} },
        ]),
        { id: 'pipe', type: 'delay', name: 'pipe', params: { L: 0.1, y0: 0.172 }, x: 320, y: 96 },
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
    notes: 'A pendulum hangs below a cart. The controller pumps energy into the swing (a Lyapunov function of the energy falls with every push), then, near the top, catches the pole with state feedback and holds it; at 3.5 s it is pushed (d). Flip to "State feedback only" to see why the swing-up is needed.',
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
          { name: 'Swing-up + state feedback', type: 'swingUp', params: { kE: 3, kx: 8, kv: 5, l: 0.5, g: 9.81, thetaS: 0.4, K: K_SINGLE, kr: K_SINGLE[0], umin: -25, umax: 25 } },
          { name: 'State feedback only', type: 'stateFeedback', params: { K: K_SINGLE, kr: K_SINGLE[0], umin: -25, umax: 25 } },
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
    notes: 'Three rods balanced on top of each other on a cart, held up by state feedback from all eight states (positions, angles and their rates; gains from LQR). It starts with the lowest rod tilted 3°, is pushed at 1 s (d), and the cart is moved 0.5 m at 2.5 s (r). Flip to the gentle LQR to see a softer, slower controller.',
    signals: {
      r: { period: PERIOD, components: [{ type: 'step', params: { amplitude: 0.5, time: 2.5 } }] },
      d: { period: PERIOD, components: [pulse(4, 1, 0.1)] },
    },
    scope: { channels: channels('r', 'x', 'theta1', 'F') },
    ui: ui('Cart and triple pendulum'),
    diagram: {
      blocks: [
        src('r', 30, 132, 'm'),
        src('d', 300, 260, 'N'),
        ctrl(130, 70, 9, 0.01, [
          { name: 'LQR', type: 'stateFeedback', params: { K: K_TRIPLE, kr: K_TRIPLE[0], umin: -40, umax: 40 } },
          { name: 'LQR, gentle', type: 'stateFeedback', params: { K: K_TRIPLE_GENTLE, kr: K_TRIPLE_GENTLE[0], umin: -40, umax: 40 } },
          { name: 'Off', type: 'off', params: {} },
        ]),
        { id: 'sum', type: 'sum', params: { signs: '++' }, x: 330, y: 124 },
        { id: 'cart', type: 'pendulumCart', name: 'cart and 3 rods', params: { links: 3, M: 1, m1: 0.1, l1: 0.25, m2: 0.1, l2: 0.25, m3: 0.1, l3: 0.25, g: 9.81, b: 0.1, theta10: 0.05, theta20: 0, theta30: 0 }, x: 400, y: 60 },
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
    ], 'x {x:5.2} m   θ1 {theta1*180/pi:5.1}°   θ2 {theta2*180/pi:5.1}°   θ3 {theta3*180/pi:5.1}°   F {F:5.1} N', [-1.3, -0.4, 1.3, 1.1])],
  },
  {
    // Made for the Auto-tune tab: a classic process (three lags and a dead
    // time) under a PID that was tuned badly by hand. Time is scaled so the
    // demo fits 5 s. The gains are hand-picked to be poor; the tab computes
    // better ones from the plant.
    name: 'Oven, badly tuned',
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
  // Live mode (design/output/hil.md): the plant is outside the page and a
  // black box (input 20): the page knows its interface only, the inputs and
  // outputs its describe lists (names, units, full scales, hard ranges,
  // kinds), which the External block keeps (here: what the example plant,
  // hil_plant.py, describes) and takes anew on Connect. No model, no
  // disturbance it does not offer, no picture: the Plant tab shows the
  // interface. The controller is a first guess, not tuned on a model:
  // tuning needs the plant identified first (identification.md). It opens
  // stopped: nothing runs until the plant is connected and Run is pressed.
  {
    name: 'HIL: an external plant',
    notes: 'The plant runs outside this page, in real time, and the page knows only its interface: the inputs and outputs it describes when it connects (names, units, full scales, hard ranges), shown in the Plant tab under Interface. What is inside is a black box to be identified before tuning (Identify, to come). The downloadable example plant happens to simulate a DC motor swinging an arm (its physics varied by up to 15 %), which this page does not know. Step by step: 1. Plant tab, Download the plant (zip); unzip it and run runme.sh (Linux, macOS) or double-click runme.cmd (Windows), which install what it needs; a window with a red STOP opens and says where the plant listens. 2. Plant tab, Connect: the External block takes the plant\'s ports, nothing moves, the scope says CONNECTED. 3. Run: r ramps to its first value (at most 10 % of full scale per second), then the loop runs; each channel spans its full scale. The controller is a first guess (a P on the first output), to change in the Controller tab while it runs. Stop stops the plant, Single runs one sweep; E-STOP (header, key E) or STOP in the plant window stops it until Reset (a STOP pressed at the plant is reset there), and so does an output beyond its hard range. Save, Live record keeps the last minutes. Help (?), Live and For agents, has all of it.',
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
  },
  // The same in reference mode (the person, settled: both modes): the plant
  // runs its own controller, with its limits and monitoring; the page sends
  // the reference and records what comes back, the plant's own u included.
  // The page's controllers and Auto-tune are not in the loop.
  {
    name: 'HIL: an external plant, reference mode',
    notes: 'An external plant in reference mode: it runs its own controller, with its own limits and monitoring; this page only sends the reference r and records what comes back, the plant\'s own control effort included. The page knows only the interface the plant describes (Plant tab, Interface); what is inside is a black box, identified from what it reports. For logging, and for a plant that controls itself; the page\'s controllers and Auto-tune are not in the loop. Start the example plant with sh runme.sh --mode reference (or runme.cmd --mode reference); then Plant tab, Connect, and Run. Everything else as in HIL: an external plant; Help (?), Live.',
    signals: {
      r: { period: PERIOD, components: [{ type: 'square', params: { amplitude: 1.5, time: 0.5, width: 2.5, period: 5, count: 0 } }] },
    },
    scope: { channels: channels('r', 'angle', 'V', 'current') },
    ui: { ...ui('Interface'), run: 'stop', setup: 0.42 },
    tags: [{ label: 'Reference mode', kind: 'feature' }],
    diagram: {
      blocks: [
        src('r', 60, 110, 'rad'),
        {
          id: 'plant', type: 'external', name: 'plant', x: 240, y: 96,
          params: {
            url: 'ws://127.0.0.1:8765', rate: 100,
            inputs: ['r'], inUnits: ['rad'], min: [-3], max: [3], safe: [0], kinds: ['reference'], measures: ['angle'],
            outputs: ['angle', 'speed', 'current', 'V'], outUnits: ['rad', 'rad/s', 'A', 'V'], outMin: [-Math.PI, -120, -12, -12], outMax: [Math.PI, 120, 12, 12],
            ymin: [-2.5, -60, -10, null], ymax: [2.5, 60, 10, null], outKinds: ['measurement', 'measurement', 'measurement', 'effort'],
            ramp: 10,
          },
        },
        sink('angle', 500, 98, 'rad'), sink('speed', 500, 134, 'rad/s'), sink('current', 500, 170, 'A'), sink('V', 500, 206, 'V'),
      ],
      wires: [
        { from: 'r', to: 'plant' },
        { from: 'plant', to: 'angle' }, { from: 'plant:1', to: 'speed' }, { from: 'plant:2', to: 'current' }, { from: 'plant:3', to: 'V' },
      ],
    },
    views: [],
  },
];

// A new project's plant: the reference alone.
export const EMPTY_PLANT = { blocks: [src('r', 60, 104, '1')], wires: [] };
