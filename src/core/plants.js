// The System library's systems. Few, and each one does something visible:
// its input moves the plant, its signals are named for what they are (force F,
// position x, …) and on the scope, and its view shows the motion
// (design/output/system-library.md). Each opens running, on its view in the
// Plant tab (ui). Closed-loop systems join once the Controller tab exists.

const src = (signal, x, y, unit) => ({ id: signal, type: 'source', params: { signal, unit }, x, y });
const sink = (id, x, y, unit) => ({ id, type: 'sink', params: { name: id, unit }, x, y });
const channels = (...sources) => [0, 1, 2, 3].map((i) => ({ source: sources[i] ?? '', on: !!sources[i], scale: 1, offset: 0 }));
const ui = (view) => ({ run: 'run', tab: 'plant', setup: 0.42, view });

// A fixed dial: twelve ticks every 30°, the quarter ones longer.
const ticks = (r) => Array.from({ length: 12 }, (_, i) => ({
  type: 'group', angle: (i * Math.PI) / 6, shapes: [{ type: 'line', x1: 0, y1: r, x2: 0, y2: r + (i % 3 ? 0.06 : 0.12), stroke: 'muted', lineWidth: i % 3 ? 1.5 : 3 }],
}));

export const EXAMPLE_PLANTS = [
  {
    name: 'Mass–spring–damper',
    notes: 'A 1 kg mass hangs on a spring (100 N/m) and a damper (1 N·s/m). At 0.1 s a force F = 1 N pulls it down: it drops about 10 mm and rings at 1.6 Hz while it settles, its energy swapping between motion (Ekin) and spring (Epot).',
    signals: { F: { period: 2, components: [{ type: 'step', params: { amplitude: 1, time: 0.1 } }] } },
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
        { id: 'c', type: 'gain', name: 'damping c', params: { K: 1 }, x: 330, y: 200, flip: true },
        { id: 'k', type: 'gain', name: 'spring k', params: { K: 100 }, x: 490, y: 270, flip: true },
        { id: 'ek', type: 'fcn', name: 'kinetic ½mv²', params: { expr: '0.5*1*u^2' }, x: 490, y: 360 },
        sink('Ekin', 680, 368, 'J'),
        { id: 'ep', type: 'fcn', name: 'spring ½kx²', params: { expr: '0.5*100*u^2' }, x: 490, y: 440 },
        sink('Epot', 680, 448, 'J'),
      ],
      wires: [
        { from: 'F', to: 'sum' }, { from: 'sum', to: 'm' }, { from: 'm', to: 'vel' }, { from: 'vel', to: 'pos' }, { from: 'pos', to: 'x' },
        { from: 'vel', to: 'c' }, { from: 'c', to: 'sum:1' }, { from: 'pos', to: 'k' }, { from: 'k', to: 'sum:2' },
        { from: 'vel', to: 'v' }, { from: 'vel', to: 'ek' }, { from: 'ek', to: 'Ekin' }, { from: 'pos', to: 'ep' }, { from: 'ep', to: 'Epot' },
      ],
    },
    views: [{
      // x is the displacement downwards, drawn ×20; the energies are bars, 20 per J.
      name: 'Hanging mass', kind: '2d', view: [-0.9, -0.95, 1.1, 0.62],
      shapes: [
        { type: 'ground', x1: -0.35, x2: 0.35, y: 0.5, side: 'above' },
        { type: 'spring', x1: -0.08, y1: 0.5, x2: -0.08, y2: '0 - 20*x', width: 0.09, coils: 8 },
        { type: 'damper', x1: 0.09, y1: 0.5, x2: 0.09, y2: '0 - 20*x', width: 0.08 },
        { type: 'rect', x: -0.18, y: '-0.26 - 20*x', w: 0.36, h: 0.26, fill: 'ch2' },
        { type: 'text', x: 0, y: '-0.13 - 20*x', text: 'm', size: 18, fill: 'panel' },
        { type: 'arrow', x1: 0, y1: '-0.28 - 20*x', x2: 0, y2: '-0.28 - 20*x - 0.25*F', stroke: 'ch1', lineWidth: 3 },
        { type: 'line', x1: -0.55, y1: -0.26, x2: -0.22, y2: -0.26, stroke: 'muted', lineWidth: 1 },
        { type: 'text', x: -0.68, y: -0.26, text: 'rest', size: 11, fill: 'muted' },
        { type: 'line', x1: 0.55, y1: -0.7, x2: 1.0, y2: -0.7, stroke: 'muted', lineWidth: 1 },
        { type: 'rect', x: 0.6, y: -0.7, w: 0.14, h: '20*Ekin', fill: 'ch3' },
        { type: 'rect', x: 0.82, y: -0.7, w: 0.14, h: '20*Epot', fill: 'ch4' },
        { type: 'text', x: 0.67, y: -0.78, text: 'Ekin', size: 11, fill: 'muted' },
        { type: 'text', x: 0.89, y: -0.78, text: 'Epot', size: 11, fill: 'muted' },
        { type: 'text', x: 0.1, y: -0.9, text: 'x = {1000*x} mm down (drawn ×20)   F = {F} N', size: 13 },
      ],
    }],
  },
  {
    name: 'Inverted pendulum',
    notes: 'A pole balanced on a cart (nonlinear, the Cart–pole block). It starts tilted 1°; at 0.1 s a short push (F = 2 N for 0.1 s) moves the cart. With no controller yet the pole falls over in about half a second.',
    signals: { F: { period: 1.5, components: [{ type: 'square', params: { amplitude: 2, time: 0.1, width: 0.1, period: 1, count: 1 } }] } },
    scope: { channels: channels('F', 'x', 'theta') },
    ui: ui('Cart and pole'),
    diagram: {
      blocks: [
        src('F', 30, 124, 'N'),
        { id: 'cart', type: 'cartPole', name: 'cart and pole', params: { M: 1, m: 0.2, l: 0.5, g: 9.81, b: 0.1, theta0: 0.0175 }, x: 160, y: 104 },
        sink('x', 380, 100, 'm'), sink('theta', 380, 160, 'rad'),
      ],
      wires: [{ from: 'F', to: 'cart' }, { from: 'cart', to: 'x' }, { from: 'cart:1', to: 'theta' }],
    },
    views: [{
      name: 'Cart and pole', kind: '2d', view: [-1.2, -0.62, 1.2, 0.85],
      shapes: [
        { type: 'line', x1: -1.2, y1: -0.065, x2: 1.2, y2: -0.065, stroke: 'muted', lineWidth: 3 },
        { type: 'line', x1: 0, y1: -0.12, x2: 0, y2: -0.065, stroke: 'muted', lineWidth: 1 },
        { type: 'group', x: 'clamp(x, -1.05, 1.05)', y: 0, shapes: [
          { type: 'rect', x: -0.16, y: -0.02, w: 0.32, h: 0.12, fill: 'ch2' },
          { type: 'circle', cx: -0.1, cy: -0.03, r: 0.03, fill: 'ink' },
          { type: 'circle', cx: 0.1, cy: -0.03, r: 0.03, fill: 'ink' },
          { type: 'group', y: 0.1, angle: '-theta', shapes: [
            { type: 'line', x1: 0, y1: 0, x2: 0, y2: 0.5, lineWidth: 4 },
            { type: 'circle', cx: 0, cy: 0.5, r: 0.045, fill: 'ch3' },
          ] },
          { type: 'arrow', x1: '-0.17 - 0.15*F', y1: 0.04, x2: -0.17, y2: 0.04, stroke: 'ch1', lineWidth: 3 },
        ] },
        { type: 'text', x: 0, y: 0.76, text: 'x = {x} m   θ = {theta*180/pi}°   F = {F} N', size: 13 },
      ],
    }],
  },
  {
    name: 'DC motor',
    notes: 'A 6 V step drives a motor (armature lag, torque constant, load inertia, back-EMF feedback inside a Motor subsystem). The speed settles at 8.6 rad/s, about 1.4 turns a second; the angle keeps growing.',
    signals: { V: { period: 2, components: [{ type: 'step', params: { amplitude: 6, time: 0.1 } }] } },
    scope: { channels: channels('V', 'angle', 'speed') },
    ui: ui('Motor shaft'),
    diagram: {
      blocks: [
        src('V', 30, 112, 'V'),
        {
          id: 'motor', type: 'subsystem', name: 'Motor', params: {}, x: 150, y: 96,
          diagram: {
            blocks: [
              { id: 'V', type: 'inport', params: { port: 1 }, x: 30, y: 112 },
              { id: 'sum', type: 'sum', params: { signs: '+-' }, x: 120, y: 104 },
              { id: 'arm', type: 'firstOrder', name: 'armature', params: { K: 1, tau: 0.01 }, x: 200, y: 96 },
              { id: 'kt', type: 'gain', name: 'Kt', params: { K: 0.5 }, x: 360, y: 100 },
              { id: 'mech', type: 'firstOrder', name: 'load', params: { K: 10, tau: 0.2 }, x: 460, y: 96 },
              { id: 'w', type: 'outport', params: { port: 1 }, x: 630, y: 112 },
              { id: 'ke', type: 'gain', name: 'Ke', params: { K: 0.5 }, x: 360, y: 200, flip: true },
            ],
            wires: [
              { from: 'V', to: 'sum' }, { from: 'sum', to: 'arm' }, { from: 'arm', to: 'kt' }, { from: 'kt', to: 'mech' },
              { from: 'mech', to: 'w' }, { from: 'mech', to: 'ke' }, { from: 'ke', to: 'sum:1' },
            ],
          },
        },
        { id: 'int', type: 'integrator', name: 'angle', params: { K: 1 }, x: 340, y: 96 },
        sink('angle', 540, 106, 'rad'),
        sink('speed', 540, 200, 'rad/s'),
      ],
      wires: [{ from: 'V', to: 'motor' }, { from: 'motor', to: 'int' }, { from: 'int', to: 'angle' }, { from: 'motor', to: 'speed' }],
    },
    views: [{
      // The rotor turns with angle (counter-clockwise positive) inside a fixed
      // dial; an off-centre lobe and a pointer show where it is.
      name: 'Motor shaft', kind: '2d', view: [-1.1, -0.9, 1.1, 0.9],
      shapes: [
        { type: 'circle', cx: 0, cy: 0, r: 0.62, fill: 'panel', stroke: 'muted', lineWidth: 2 },
        ...ticks(0.62),
        { type: 'group', angle: 'angle', shapes: [
          { type: 'circle', cx: 0, cy: 0, r: 0.5, fill: 'ink' },
          { type: 'circle', cx: 0, cy: 0.27, r: 0.15, fill: 'ch2' },
          { type: 'line', x1: 0, y1: 0, x2: 0, y2: 0.6, stroke: 'ch1', lineWidth: 6 },
        ] },
        { type: 'circle', cx: 0, cy: 0, r: 0.07, fill: 'muted' },
        { type: 'text', x: 0, y: -0.82, text: '{angle/(2*pi)} turns   {speed} rad/s   V = {V} V', size: 13 },
      ],
    }],
  },
];

// A new project's plant: the reference alone.
export const EMPTY_PLANT = { blocks: [src('r', 60, 104, '1')], wires: [] };
