// The project a fresh page opens with: the reference alone, a step at 0.1 s
// (design/output/signal-generator.md). The v1 example loops are in
// examples-v1.js, which only Node loads (the command line, the tests).

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
