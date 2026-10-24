// The System library's systems. Few, and each one does something visible:
// its input moves the plant, its Sinks are on the scope, and its view shows
// the motion (design/output/system-library.md). Each opens running, on its
// view in the Plant tab (ui). Closed-loop systems join once
// the Controller tab exists.

const src = (x, y, unit, signal = 'r') => ({ id: signal, type: 'source', params: { signal, unit }, x, y });
const sink = (id, x, y, unit) => ({ id, type: 'sink', params: { name: id, unit }, x, y });
const channels = (...sources) => [0, 1, 2, 3].map((i) => ({ source: sources[i] ?? '', on: !!sources[i], scale: 1, offset: 0 }));

export const EXAMPLE_PLANTS = [
  {
    name: 'Mass–spring–damper',
    notes: 'A 1 kg mass hangs on a spring (100 N/m) and a damper (1 N·s/m). At 0.1 s a 1 N force pulls it down: it drops about 10 mm and rings at 1.6 Hz while it settles.',
    signals: { r: { period: 2, components: [{ type: 'step', params: { amplitude: 1, time: 0.1 } }] } },
    scope: { channels: channels('r', 'y1') },
    ui: { run: 'run', tab: 'plant', setup: 0.42, view: 'Hanging mass' },
    diagram: {
      blocks: [
        src(30, 112, 'N'),
        { id: 'sum', type: 'sum', params: { signs: '+--' }, x: 130, y: 104 },
        { id: 'm', type: 'gain', name: '1/m', params: { K: 1 }, x: 210, y: 100 },
        { id: 'v', type: 'integrator', name: 'velocity', params: { K: 1 }, x: 330, y: 100 },
        { id: 'x', type: 'integrator', name: 'position', params: { K: 1 }, x: 470, y: 100 },
        sink('y1', 640, 108, 'm'),
        { id: 'c', type: 'gain', name: 'damping c', params: { K: 1 }, x: 330, y: 190, flip: true },
        { id: 'k', type: 'gain', name: 'spring k', params: { K: 100 }, x: 470, y: 260, flip: true },
      ],
      wires: [
        { from: 'r', to: 'sum' }, { from: 'sum', to: 'm' }, { from: 'm', to: 'v' }, { from: 'v', to: 'x' }, { from: 'x', to: 'y1' },
        { from: 'v', to: 'c' }, { from: 'c', to: 'sum:1' }, { from: 'x', to: 'k' }, { from: 'k', to: 'sum:2' },
      ],
    },
    views: [{
      // y1 is the displacement downwards, drawn ×20.
      name: 'Hanging mass', kind: '2d', view: [-0.8, -0.95, 0.8, 0.62],
      shapes: [
        { type: 'ground', x1: -0.35, x2: 0.35, y: 0.5, side: 'above' },
        { type: 'spring', x1: -0.08, y1: 0.5, x2: -0.08, y2: '0 - 20*y1', width: 0.09, coils: 8 },
        { type: 'damper', x1: 0.09, y1: 0.5, x2: 0.09, y2: '0 - 20*y1', width: 0.08 },
        { type: 'rect', x: -0.18, y: '-0.26 - 20*y1', w: 0.36, h: 0.26, fill: 'ch2' },
        { type: 'text', x: 0, y: '-0.13 - 20*y1', text: 'm', size: 18, fill: 'panel' },
        { type: 'arrow', x1: 0, y1: '-0.28 - 20*y1', x2: 0, y2: '-0.28 - 20*y1 - 0.25*r', stroke: 'ch1', lineWidth: 3 },
        { type: 'line', x1: -0.5, y1: -0.26, x2: -0.3, y2: -0.26, stroke: 'muted', lineWidth: 1 },
        { type: 'text', x: -0.6, y: -0.26, text: 'rest', size: 11, fill: 'muted' },
        { type: 'text', x: 0, y: -0.88, text: 'x = {1000*y1} mm down (drawn ×20)   F = {r} N', size: 13 },
      ],
    }, {
      // The same picture as a standard SVG drawing with bindings.
      name: 'Hanging mass (SVG)', kind: 'svg',
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-160 -130 320 300">'
        + '<rect x="-80" y="-118" width="160" height="10" fill="#8a929a"/>'
        + '<line id="spring" x1="-22" y1="-108" x2="-22" y2="0" stroke="#7c858d" stroke-width="3" stroke-dasharray="7 4"/>'
        + '<line id="damper" x1="22" y1="-108" x2="22" y2="0" stroke="#7c858d" stroke-width="6"/>'
        + '<rect id="mass" x="-45" y="0" width="90" height="56" rx="4" fill="#33d17a" stroke="#12703c" stroke-width="2"/>'
        + '<text id="label" x="0" y="150" text-anchor="middle" font-family="monospace" font-size="13" fill="#7c858d">x</text></svg>',
      bind: [
        { select: '#mass', attr: 'y', value: '{2000*y1}' },
        { select: '#spring, #damper', attr: 'y2', value: '{2000*y1}' },
        { select: '#label', attr: 'text', value: 'x = {1000*y1} mm (drawn ×2)' },
      ],
    }],
  },
  {
    name: 'Inverted pendulum',
    notes: 'A pole balanced on a cart (nonlinear, the Cart–pole block). It starts tilted 1°; at 0.1 s a short push (2 N for 0.1 s) moves the cart. With no controller yet the pole falls over in about half a second.',
    signals: { r: { period: 1.5, components: [{ type: 'square', params: { amplitude: 2, time: 0.1, width: 0.1, period: 1, count: 1 } }] } },
    scope: { channels: channels('r', 'y1', 'y2') },
    ui: { run: 'run', tab: 'plant', setup: 0.42, view: 'Cart and pole' },
    diagram: {
      blocks: [
        src(30, 124, 'N'),
        { id: 'cart', type: 'cartPole', name: 'cart and pole', params: { M: 1, m: 0.2, l: 0.5, g: 9.81, b: 0.1, theta0: 0.0175 }, x: 160, y: 104 },
        sink('y1', 380, 100, 'm'), sink('y2', 380, 160, 'rad'),
      ],
      wires: [{ from: 'r', to: 'cart' }, { from: 'cart', to: 'y1' }, { from: 'cart:1', to: 'y2' }],
    },
    views: [{
      name: 'Cart and pole', kind: '2d', view: [-1.2, -0.62, 1.2, 0.85],
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
          { type: 'arrow', x1: '-0.17 - 0.15*r', y1: 0.04, x2: -0.17, y2: 0.04, stroke: 'ch1', lineWidth: 3 },
        ] },
        { type: 'text', x: 0, y: 0.76, text: 'x = {y1} m   θ = {y2*180/pi}°   F = {r} N', size: 13 },
      ],
    }],
  },
  {
    name: 'DC motor',
    notes: 'A 1 V step drives a motor (armature lag, torque constant, load inertia, back-EMF feedback inside a Motor subsystem). The speed y2 settles at 1.43 rad/s; the shaft angle y1 keeps turning.',
    signals: { r: { period: 2, components: [{ type: 'step', params: { amplitude: 1, time: 0.1 } }] } },
    scope: { channels: channels('r', 'y1', 'y2') },
    ui: { run: 'run', tab: 'plant', setup: 0.42, view: 'Motor shaft' },
    diagram: {
      blocks: [
        src(30, 112, 'V'),
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
        sink('y1', 540, 106, 'rad'),
        sink('y2', 540, 200, 'rad/s'),
      ],
      wires: [{ from: 'r', to: 'motor' }, { from: 'motor', to: 'int' }, { from: 'int', to: 'y1' }, { from: 'motor', to: 'y2' }],
    },
    views: [{
      name: 'Motor shaft', kind: '2d', view: [-1.1, -0.8, 1.1, 0.8],
      shapes: [
        { type: 'circle', cx: 0, cy: 0, r: 0.6, fill: 'panel', stroke: 'muted', lineWidth: 2 },
        { type: 'group', angle: '-y1', shapes: [
          { type: 'line', x1: 0, y1: 0, x2: 0, y2: 0.55, stroke: 'ch2', lineWidth: 6 },
          { type: 'circle', cx: 0, cy: 0.42, r: 0.06, fill: 'ch2' },
        ] },
        { type: 'circle', cx: 0, cy: 0, r: 0.07, fill: 'ink' },
        { type: 'text', x: 0, y: -0.72, text: 'angle {y1} rad   speed {y2} rad/s   {r} V', size: 13 },
      ],
    }],
  },
];

// A new project's plant: the reference alone.
export const EMPTY_PLANT = { blocks: [src(60, 104, '1')], wires: [] };
