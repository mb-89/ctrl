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
const channels = (...sources) => [0, 1, 2, 3].map((i) => ({ source: sources[i] ?? '', on: !!sources[i], scale: 1, offset: 0 }));
const ui = (view) => ({ run: 'run', tab: 'plant', setup: 0.42, view });
const ctrl = (x, y, inputs, Ts, variants, variant = 0) => ({ id: 'ctrl', type: 'controller', name: 'controller', params: { inputs, Ts }, variants, variant, x, y });
const pulse = (amplitude, time, width) => ({ type: 'square', params: { amplitude, time, width, period: 5, count: 1 } });
const PERIOD = 5;

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
    diagram: {
      blocks: [
        src('r', 30, 112, 'rad'),
        src('d', 180, 230, 'N·m'),
        ctrl(130, 90, 2, 0.01, [
          { name: 'P, too aggressive', type: 'pid', params: { Kp: 30, umin: -12, umax: 12 } },
          { name: 'PD', type: 'pid', params: { Kp: 20, Kd: 1.5, Tf: 0.01, umin: -12, umax: 12 } },
          { name: 'PID with prefilter', type: 'pid', params: { Kp: 20, Ki: 10, Kd: 1.5, Tf: 0.01, Tr: 0.1, umin: -12, umax: 12 } },
          { name: 'Off', type: 'off', params: {} },
        ]),
        {
          id: 'motor', type: 'subsystem', name: 'Motor', params: {}, x: 330, y: 96,
          diagram: {
            blocks: [
              { id: 'V', type: 'inport', name: 'V', params: { port: 1 }, x: 30, y: 112 },
              { id: 'load', type: 'inport', name: 'load torque', params: { port: 2 }, x: 300, y: 220 },
              { id: 'sum', type: 'sum', params: { signs: '+-' }, x: 120, y: 104 },
              { id: 'arm', type: 'firstOrder', name: 'armature', params: { K: 1, tau: 0.01 }, x: 200, y: 96 },
              { id: 'kt', type: 'gain', name: 'Kt', params: { K: 0.5 }, x: 360, y: 100 },
              { id: 'tsum', type: 'sum', params: { signs: '+-' }, x: 440, y: 104 },
              { id: 'mech', type: 'firstOrder', name: 'load', params: { K: 10, tau: 0.2 }, x: 510, y: 96 },
              { id: 'w', type: 'outport', name: 'speed', params: { port: 1 }, x: 690, y: 112 },
              { id: 'ke', type: 'gain', name: 'Ke', params: { K: 0.5 }, x: 360, y: 280, flip: true },
            ],
            wires: [
              { from: 'V', to: 'sum' }, { from: 'sum', to: 'arm' }, { from: 'arm', to: 'kt' }, { from: 'kt', to: 'tsum' }, { from: 'load', to: 'tsum:1' },
              { from: 'tsum', to: 'mech' }, { from: 'mech', to: 'w' }, { from: 'mech', to: 'ke' }, { from: 'ke', to: 'sum:1' },
            ],
          },
        },
        { id: 'int', type: 'integrator', name: 'angle', params: { K: 1 }, x: 500, y: 96 },
        sink('angle', 690, 106, 'rad'),
        sink('speed', 690, 30, 'rad/s'),
        sink('V', 330, 20, 'V'),
      ],
      wires: [
        { from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'motor' }, { from: 'd', to: 'motor:1' }, { from: 'motor', to: 'int' }, { from: 'int', to: 'angle' },
        { from: 'motor', to: 'speed' }, { from: 'int', to: 'ctrl:1' }, { from: 'ctrl', to: 'V' },
      ],
    },
    views: [{
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
        { type: 'text', x: 0, y: -0.82, text: 'angle {angle:5.2} rad   r {r:4.1} rad   V {V:5.1} V   load {d:3.1} N·m', size: 13 },
      ],
    }],
  },
  {
    name: 'Encoder errors and torque ripple',
    notes: 'A speed-controlled motor sweeps from 0 to 300 rad/s. Its encoder is off-centre (an error once per turn, 1×) and its tracks are not quite perpendicular (twice per turn, 2×); the inverter adds torque ripple six times per turn (6×), and the encoder sits behind a flexible shaft that resonates at 70 Hz. The scope opens in Spectrogram mode on the measured speed: each error is a straight line from the origin, rising with speed; the resonance is a horizontal line, and each order flares up as it crosses it (6× at about 73 rad/s, 2× at about 220 rad/s). The 6× line passes the scope\'s Nyquist frequency (200 Hz) and folds back down: aliasing. Try FFT mode, and a notch filter on the channel.',
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
];

// A new project's plant: the reference alone.
export const EMPTY_PLANT = { blocks: [src('r', 60, 104, '1')], wires: [] };
