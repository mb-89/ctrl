// Example projects. DEFAULT_PROJECT is what a fresh page opens with: the
// reference alone, a step at 0.1 s (design/output/signal-generator.md).
// EXAMPLES are complete textbook loops (version 1 files, still loadable).

export const DEFAULT_PROJECT = {
  format: 'loop-tuner/2',
  title: 'New loop',
  system: {
    signals: { r: { period: 1, components: [{ type: 'step', params: { amplitude: 1, time: 0.1 } }] } },
    plant: { type: 'diagram', diagram: { blocks: [{ id: 'r', type: 'source', params: { signal: 'r' }, x: 60, y: 104 }], wires: [] } },
  },
  scope: {
    timebase: { scale: 0.1, position: 0 },
    channels: [
      { source: 'r', on: true, scale: 0.2, offset: -0.4 },
      { source: '', on: false, scale: 0.2, offset: 0 },
      { source: '', on: false, scale: 0.5, offset: 0 },
      { source: '', on: false, scale: 0.2, offset: 0 },
    ],
  },
  candidates: [],
};

export const EXAMPLES = [
  {
    format: 'loop-tuner/1',
    title: 'Third-order lag',
    notes: 'Åström & Hägglund\'s classic test process 1/(s+1)³ with a load step at t = 16 s. Goal: fast with little overshoot, effort kept below 4. The Ziegler–Nichols settings are the textbook starting point (Ku = 8, Pu = 3.63 s).',
    sim: { duration: 30, sampleTime: 0.01 },
    system: {
      reference: { type: 'step', params: { amplitude: 1, time: 1 } },
      actuator: { type: 'ideal' },
      disturbance: { type: 'step', params: { amplitude: 0.5, time: 16 } },
      plant: { type: 'lagChain', params: { K: 1, tau: 1, n: 3 } },
      sensor: { type: 'ideal' },
      noise: { type: 'none' },
    },
    goal: { minimize: { itae: 1 }, subjectTo: { overshoot: { max: 5 }, uPeak: { max: 4 } }, settlingBand: 0.02 },
    candidates: [
      { name: 'P only', color: 0, controller: { type: 'P', params: { Kp: 1 } } },
      { name: 'Z–N PI', color: 1, controller: { type: 'PI', params: { Kp: 3.6, Ki: 1.19, b: 1 } } },
      { name: 'Z–N PID', color: 2, controller: { type: 'PID', params: { Kp: 4.8, Ki: 2.65, Kd: 2.18, Tf: 0.05, b: 1, c: 0 } } },
      { name: 'Detuned PID', color: 3, controller: { type: 'PID', params: { Kp: 1.5, Ki: 0.6, Kd: 1, Tf: 0.05, b: 1, c: 0 } } },
    ],
    selected: 'Detuned PID',
  },
  {
    format: 'loop-tuner/1',
    title: 'Process with dead time',
    notes: 'First order plus dead time, K = 2, τ = 5 s, L = 1 s, with measurement noise. SIMC rule (τc = L): Kp = τ / (K (τc + L)) = 1.25, Ti = τ = 5 s.',
    sim: { duration: 40, sampleTime: 0.02 },
    system: {
      reference: { type: 'step', params: { amplitude: 1, time: 2 } },
      actuator: { type: 'ideal' },
      disturbance: { type: 'step', params: { amplitude: -0.3, time: 22 } },
      plant: { type: 'fopdt', params: { K: 2, tau: 5, delay: 1 } },
      sensor: { type: 'ideal' },
      noise: { type: 'white', params: { std: 0.005, seed: 7 } },
    },
    goal: { minimize: { iae: 1 }, subjectTo: { overshoot: { max: 10 }, uTV: { max: 6 } }, settlingBand: 0.05 },
    candidates: [
      { name: 'SIMC PI', color: 0, controller: { type: 'PI', params: { Kp: 1.25, Ki: 0.25, b: 1 } } },
      { name: 'Aggressive PI', color: 1, controller: { type: 'PI', params: { Kp: 2.2, Ki: 0.5, b: 1 } } },
      { name: 'PID, noisy D', color: 2, controller: { type: 'PID', params: { Kp: 1.8, Ki: 0.3, Kd: 1.2, Tf: 0.02, b: 1, c: 0 } } },
    ],
  },
  {
    format: 'loop-tuner/1',
    title: 'Motor position',
    notes: 'DC motor shaft angle: integrator plus a 0.5 s mechanical lag, voltage limited to ±2. Goal: settle fast with almost no overshoot.',
    sim: { duration: 12, sampleTime: 0.005 },
    system: {
      reference: { type: 'step', params: { amplitude: 1, time: 0.5 } },
      actuator: { type: 'saturation', params: { uMin: -2, uMax: 2 } },
      disturbance: { type: 'none' },
      plant: { type: 'integratorLag', params: { K: 1, tau: 0.5 } },
      sensor: { type: 'ideal' },
      noise: { type: 'none' },
    },
    goal: { minimize: { settlingTime: 1 }, subjectTo: { overshoot: { max: 2 } }, settlingBand: 0.02 },
    candidates: [
      { name: 'P', color: 0, controller: { type: 'P', params: { Kp: 1 } } },
      { name: 'P, high gain', color: 1, controller: { type: 'P', params: { Kp: 4 } } },
      { name: 'PD', color: 2, controller: { type: 'PD', params: { Kp: 4, Kd: 0.8, Tf: 0.02, c: 0 } } },
    ],
  },
  {
    format: 'loop-tuner/1',
    title: 'Lightly damped resonance',
    notes: 'Second-order plant with ζ = 0.1. Goal: the smoothest control effort that still settles within 8 s with under 5 % overshoot.',
    sim: { duration: 20, sampleTime: 0.01 },
    system: {
      reference: { type: 'step', params: { amplitude: 1, time: 1 } },
      actuator: { type: 'ideal' },
      disturbance: { type: 'none' },
      plant: { type: 'secondOrder', params: { K: 1, wn: 2, zeta: 0.1 } },
      sensor: { type: 'ideal' },
      noise: { type: 'none' },
    },
    goal: { minimize: { uTV: 1 }, subjectTo: { settlingTime: { max: 8 }, overshoot: { max: 5 } }, settlingBand: 0.02 },
    candidates: [
      { name: 'Integral only', color: 0, controller: { type: 'PI', params: { Kp: 0.01, Ki: 0.3, b: 1 } } },
      { name: 'PI', color: 1, controller: { type: 'PI', params: { Kp: 0.3, Ki: 0.6, b: 1 } } },
      { name: 'PID', color: 2, controller: { type: 'PID', params: { Kp: 0.5, Ki: 0.8, Kd: 0.3, Tf: 0.05, b: 1, c: 0 } } },
    ],
  },
  {
    format: 'loop-tuner/1',
    title: 'Inverse response',
    notes: 'Non-minimum-phase plant K (1 − 0.5 s) / ((s + 1)(2 s + 1)): the output first moves the wrong way. Pushing for speed increases the undershoot.',
    sim: { duration: 30, sampleTime: 0.01 },
    system: {
      reference: { type: 'step', params: { amplitude: 1, time: 1 } },
      actuator: { type: 'ideal' },
      disturbance: { type: 'none' },
      plant: { type: 'inverseResponse', params: { K: 1, Tz: 0.5, tau1: 1, tau2: 2 } },
      sensor: { type: 'ideal' },
      noise: { type: 'none' },
    },
    goal: { minimize: { itae: 1 }, subjectTo: { undershoot: { max: 20 }, overshoot: { max: 5 } }, settlingBand: 0.02 },
    candidates: [
      { name: 'Slow PI', color: 0, controller: { type: 'PI', params: { Kp: 0.5, Ki: 0.25, b: 1 } } },
      { name: 'Fast PI', color: 1, controller: { type: 'PI', params: { Kp: 1.5, Ki: 0.6, b: 1 } } },
    ],
  },
];
