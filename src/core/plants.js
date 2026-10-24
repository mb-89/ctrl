// Example plants for the Plant tab's library. Each is a whole system: a
// Source plays r, Sinks record what the scope can show.

const src = (x, y, signal = 'r') => ({ id: signal, type: 'source', params: { signal }, x, y });
const sink = (id, x, y) => ({ id, type: 'sink', params: { name: id }, x, y });
const chain = (model, params, name) => ({
  name,
  diagram: {
    blocks: [src(40, 104), { id: 'p', type: model, params, x: 170, y: 96 }, sink('y1', 360, 104)],
    wires: [{ from: 'r', to: 'p' }, { from: 'p', to: 'y1' }],
  },
});

export const EXAMPLE_PLANTS = [
  chain('firstOrder', { K: 1, tau: 0.2 }, 'First order'),
  chain('lagChain', { K: 1, tau: 0.1, n: 3 }, 'Third-order lag'),
  chain('fopdt', { K: 2, tau: 0.3, delay: 0.1 }, 'Process with dead time'),
  chain('inverseResponse', { K: 1, Tz: 0.05, tau1: 0.1, tau2: 0.2 }, 'Inverse response'),
  {
    name: 'Mass–spring–damper',
    notes: 'm ẍ + c ẋ + k x = F, built from integrators: m = 1, c = 2, k = 400 (ωn = 20 rad/s, ζ = 0.05). Has a 2D view.',
    views: [{
      // Hanging: x (y1) is measured downwards, drawn ×40 so millimetres show.
      name: 'Hanging mass', kind: '2d', view: [-0.75, -0.75, 0.75, 0.62],
      shapes: [
        { type: 'ground', x1: -0.35, x2: 0.35, y: 0.5, side: 'above' },
        { type: 'spring', x1: -0.08, y1: 0.5, x2: -0.08, y2: '0.02 - 40*y1', width: 0.08, coils: 7 },
        { type: 'damper', x1: 0.09, y1: 0.5, x2: 0.09, y2: '0.02 - 40*y1', width: 0.07 },
        { type: 'rect', x: -0.17, y: '-0.2 - 40*y1', w: 0.34, h: 0.22, fill: 'ch2' },
        { type: 'text', x: 0, y: '-0.09 - 40*y1', text: 'm', size: 16, fill: 'panel' },
        { type: 'arrow', x1: 0, y1: '-0.22 - 40*y1', x2: 0, y2: '-0.22 - 40*y1 - 0.12*r', stroke: 'ch1', lineWidth: 3 },
        { type: 'line', x1: -0.45, y1: -0.2, x2: -0.3, y2: -0.2, stroke: 'muted', lineWidth: 1 },
        { type: 'text', x: -0.55, y: -0.2, text: 'rest', size: 11, fill: 'muted' },
        { type: 'text', x: 0, y: -0.68, text: 'x = {1000*y1} mm down (drawn ×40)   F = {r} N', size: 13 },
      ],
    }, {
      // The same picture as a standard SVG drawing: element attributes are
      // bound to formulas in the signal names. Any vector editor can make the drawing.
      name: 'Hanging mass (SVG)', kind: 'svg',
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-160 -130 320 280">'
        + '<rect x="-80" y="-118" width="160" height="10" fill="#8a929a"/>'
        + '<line id="spring" x1="-22" y1="-108" x2="-22" y2="0" stroke="#4b535b" stroke-width="3" stroke-dasharray="7 4"/>'
        + '<line id="damper" x1="22" y1="-108" x2="22" y2="0" stroke="#4b535b" stroke-width="6"/>'
        + '<rect id="mass" x="-45" y="0" width="90" height="56" rx="4" fill="#33d17a" stroke="#12703c" stroke-width="2"/>'
        + '<text id="label" x="0" y="130" text-anchor="middle" font-family="monospace" font-size="13" fill="#7c858d">x</text></svg>',
      bind: [
        { select: '#mass', attr: 'y', value: '{4000*y1}' },
        { select: '#spring, #damper', attr: 'y2', value: '{4000*y1}' },
        { select: '#label', attr: 'text', value: 'x = {1000*y1} mm (drawn ×4)' },
      ],
    }],
    diagram: {
      blocks: [
        src(30, 112),
        { id: 'sum', type: 'sum', params: { signs: '+--' }, x: 130, y: 104 },
        { id: 'm', type: 'gain', name: '1/m', params: { K: 1 }, x: 210, y: 100 },
        { id: 'v', type: 'integrator', name: 'velocity', params: { K: 1 }, x: 330, y: 100 },
        { id: 'x', type: 'integrator', name: 'position', params: { K: 1 }, x: 470, y: 100 },
        sink('y1', 620, 108),
        { id: 'c', type: 'gain', name: 'damping c', params: { K: 2 }, x: 330, y: 190, flip: true },
        { id: 'k', type: 'gain', name: 'spring k', params: { K: 400 }, x: 470, y: 260, flip: true },
      ],
      wires: [
        { from: 'r', to: 'sum' }, { from: 'sum', to: 'm' }, { from: 'm', to: 'v' }, { from: 'v', to: 'x' }, { from: 'x', to: 'y1' },
        { from: 'v', to: 'c' }, { from: 'c', to: 'sum:1' }, { from: 'x', to: 'k' }, { from: 'k', to: 'sum:2' },
      ],
    },
  },
  {
    name: 'DC motor',
    notes: 'Voltage r drives a motor subsystem (armature lag, torque constant, mechanical lag, back-EMF feedback); y1 is the shaft angle, y2 the speed.',
    diagram: {
      blocks: [
        src(30, 112),
        {
          id: 'motor', type: 'subsystem', name: 'Motor', params: {}, x: 150, y: 96,
          diagram: {
            blocks: [
              { id: 'V', type: 'inport', params: { port: 1 }, x: 30, y: 112 },
              { id: 'sum', type: 'sum', params: { signs: '+-' }, x: 120, y: 104 },
              { id: 'arm', type: 'firstOrder', name: 'armature 1/(Ls+R)', params: { K: 1, tau: 0.01 }, x: 200, y: 96 },
              { id: 'kt', type: 'gain', name: 'Kt', params: { K: 0.5 }, x: 350, y: 100 },
              { id: 'mech', type: 'firstOrder', name: 'load 1/(Js+b)', params: { K: 10, tau: 0.2 }, x: 460, y: 96 },
              { id: 'w', type: 'outport', params: { port: 1 }, x: 620, y: 112 },
              { id: 'ke', type: 'gain', name: 'Ke', params: { K: 0.5 }, x: 350, y: 200, flip: true },
            ],
            wires: [
              { from: 'V', to: 'sum' }, { from: 'sum', to: 'arm' }, { from: 'arm', to: 'kt' }, { from: 'kt', to: 'mech' },
              { from: 'mech', to: 'w' }, { from: 'mech', to: 'ke' }, { from: 'ke', to: 'sum:1' },
            ],
          },
        },
        { id: 'int', type: 'integrator', name: 'angle', params: { K: 1 }, x: 340, y: 96 },
        sink('y1', 540, 106),
        sink('y2', 540, 200),
      ],
      wires: [{ from: 'r', to: 'motor' }, { from: 'motor', to: 'int' }, { from: 'int', to: 'y1' }, { from: 'motor', to: 'y2' }],
    },
  },
];

// The cart–pole: a nonlinear physics block, falling until a controller holds it.
EXAMPLE_PLANTS.push({
  name: 'Inverted pendulum',
  notes: 'A pole balanced on a cart (nonlinear). r is the force on the cart: a short push. Without a controller the pole falls. Has a 2D view.',
  signals: { r: { period: 1.5, components: [{ type: 'square', params: { amplitude: 2, time: 0.1, width: 0.1, period: 1, count: 1 } }] } },
  diagram: {
    blocks: [
      src(30, 120),
      { id: 'cart', type: 'cartPole', name: 'cart and pole', params: { M: 1, m: 0.2, l: 0.5, g: 9.81, b: 0.1, theta0: 0.02 }, x: 160, y: 100 },
      sink('y1', 360, 96), sink('y2', 360, 150),
    ],
    wires: [{ from: 'r', to: 'cart' }, { from: 'cart', to: 'y1' }, { from: 'cart:1', to: 'y2' }],
  },
  views: [{
    name: 'Cart and pole', kind: '2d', view: [-1.2, -0.55, 1.2, 0.85],
    shapes: [
      { type: 'line', x1: -1.2, y1: -0.065, x2: 1.2, y2: -0.065, stroke: 'muted', lineWidth: 3 },
      { type: 'group', x: 'clamp(y1, -1.05, 1.05)', y: 0, shapes: [
        { type: 'rect', x: -0.16, y: -0.02, w: 0.32, h: 0.12, fill: 'ch2' },
        { type: 'circle', cx: -0.1, cy: -0.03, r: 0.03, fill: 'ink' },
        { type: 'circle', cx: 0.1, cy: -0.03, r: 0.03, fill: 'ink' },
        { type: 'group', y: 0.1, angle: '-y2', shapes: [
          { type: 'line', x1: 0, y1: 0, x2: 0, y2: 0.5, lineWidth: 4 },
          { type: 'circle', cx: 0, cy: 0.5, r: 0.045, fill: 'ch3' },
        ] },
        { type: 'arrow', x1: '-0.16 - 0.15*r', y1: 0.04, x2: -0.17, y2: 0.04, stroke: 'ch1', lineWidth: 3 },
      ] },
      { type: 'text', x: 0, y: 0.75, text: 'x = {y1} m   θ = {y2*180/pi}°   F = {r} N', size: 13 },
    ],
  }],
});

// A new project's plant: the reference alone.
export const EMPTY_PLANT = { blocks: [src(60, 104)], wires: [] };
