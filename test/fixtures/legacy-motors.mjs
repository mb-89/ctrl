// The DC motor and encoder examples as main built them before the Servo
// motor (design/output/servo.md §12.4): the references the rebuilt examples
// are held to (10⁻¹² for the motors, 10⁻⁹ for the encoder).
const src = (signal, x, y, unit) => ({ id: signal, type: 'source', params: { signal, unit }, x, y });
const sink = (id, x, y, unit) => ({ id, type: 'sink', params: { name: id, unit }, x, y });
const ctrl = (x, y, inputs, Ts, variants, variant = 0) => ({ id: 'ctrl', type: 'controller', name: 'controller', params: { inputs, Ts }, variants, variant, x, y });
export const legacyMotorDiagram = (variants, { inputs = 2, Ts = 0.01 } = {}) => ({
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

// The encoder example's diagram (variants as given).
export const legacyEncoderDiagram = (variants) => ({
      blocks: [
        src('r', 30, 112, 'rad/s'),
        ctrl(130, 90, 2, 0.001, variants ?? [
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
});
