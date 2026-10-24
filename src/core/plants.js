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
    notes: 'm ẍ + c ẋ + k x = F, built from integrators: m = 1, c = 2, k = 400 (ωn = 20 rad/s, ζ = 0.05).',
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

// A new project's plant: the reference alone.
export const EMPTY_PLANT = { blocks: [src(60, 104)], wires: [] };
