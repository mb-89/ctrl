// Vector signals (design/output/robot.md §2, §11 tests 10, 11, 13): the pass
// before the compiler. A diagram without vectors is itself; a vector diagram
// runs as its hand-flattened scalar twin; widths are refused with a sentence;
// Mux and Demux create no block; a lanes Controller runs one law per lane.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDiagram, compileDiagram, blockPorts } from '../src/core/diagram.js';
import { flattenVectors } from '../src/core/vectors.js';
import { simulateSystem } from '../src/core/sim.js';
import { normalizeReference } from '../src/core/signals.js';
import { SYSTEM_LIBRARY } from '../src/core/systems.js';

const dc = (level) => normalizeReference({ period: 10, components: [{ type: 'dc', params: { level } }] });
const sine = normalizeReference({ period: 10, components: [{ type: 'sine', params: { amplitude: 1, frequency: 1 } }] });
const flat = (d) => flattenVectors(d, { ports: blockPorts });

test('a diagram without vectors is returned as it is (every library system but the PUMA)', () => {
  for (const s of SYSTEM_LIBRARY) {
    const d = normalizeDiagram(s.plant.diagram);
    if (!s.name.startsWith('PUMA')) assert.equal(flat(d), d, s.name);
  }
});

test('a vector diagram runs bit for bit as its scalar twin; Mux and Demux create no block', () => {
  // Two masses, x'' = u − c·x' − k·x, as one 2-wide loop and as two scalar loops.
  const vec = normalizeDiagram({
    blocks: [
      { id: 'a', type: 'source', params: { signal: 'a' } }, { id: 'b', type: 'source', params: { signal: 'b' } },
      { id: 'u', type: 'mux', params: { inputs: '2' } },
      { id: 's', type: 'sum', params: { signs: '+--' } },
      { id: 'v', type: 'integrator', params: { K: 1, x0: [0, 0.5] } }, { id: 'x', type: 'integrator', params: { K: 1, x0: [1, 0] } },
      { id: 'c', type: 'gain', params: { K: 0.4 } }, { id: 'k', type: 'matrixGain', params: { K: [4, 9] } },
      { id: 'dm', type: 'demux', params: { sizes: '1,1' } }, { id: 'y1', type: 'sink', params: { name: 'y1' } }, { id: 'y2', type: 'sink', params: { name: 'y2' } },
    ],
    wires: [{ from: 'a', to: 'u' }, { from: 'b', to: 'u:1' }, { from: 'u', to: 's' }, { from: 'v', to: 'c' }, { from: 'c', to: 's:1' }, { from: 'x', to: 'k' }, { from: 'k', to: 's:2' },
      { from: 's', to: 'v' }, { from: 'v', to: 'x' }, { from: 'x', to: 'dm' }, { from: 'dm', to: 'y1' }, { from: 'dm:1', to: 'y2' }],
  });
  const scalar = (i, x0, v0, K) => [
    { id: `s${i}`, type: 'sum', params: { signs: '+--' } }, { id: `v${i}`, type: 'integrator', params: { K: 1, x0: v0 } }, { id: `x${i}`, type: 'integrator', params: { K: 1, x0 } },
    { id: `c${i}`, type: 'gain', params: { K: 0.4 } }, { id: `k${i}`, type: 'gain', params: { K } }, { id: `y${i}`, type: 'sink', params: { name: `y${i}` } },
  ];
  const wires = (i, src) => [{ from: src, to: `s${i}` }, { from: `v${i}`, to: `c${i}` }, { from: `c${i}`, to: `s${i}:1` }, { from: `x${i}`, to: `k${i}` }, { from: `k${i}`, to: `s${i}:2` }, { from: `s${i}`, to: `v${i}` }, { from: `v${i}`, to: `x${i}` }, { from: `x${i}`, to: `y${i}` }];
  const twin = normalizeDiagram({ blocks: [{ id: 'a', type: 'source', params: { signal: 'a' } }, { id: 'b', type: 'source', params: { signal: 'b' } }, ...scalar(1, 1, 0, 4), ...scalar(2, 0, 0.5, 9)], wires: [...wires(1, 'a'), ...wires(2, 'b')] });
  const sig = { a: sine, b: dc(1) }, sim = { duration: 3, sampleTime: 0.01 };
  const A = simulateSystem(vec, sig, sim), B = simulateSystem(twin, sig, sim);
  for (const n of ['y1', 'y2']) assert.ok(Math.max(...A.signals[n].map((v, k) => Math.abs(v - B.signals[n][k]))) < 1e-15, n);
  const f = flat(vec);
  assert.ok(!f.blocks.some((b) => b.type === 'mux' || b.type === 'demux'));
  assert.deepEqual(compileDiagram(vec, 'plant', { standalone: true }).states.map((s) => s.label), ['v1', 'v2', 'x1', 'x2']);
});

test('widths are declared or derived; a mismatch is refused with a sentence naming both ends', () => {
  const d = normalizeDiagram({
    blocks: [{ id: 'c', type: 'constant', params: { value: [1, 2, 3] } }, { id: 'k', type: 'matrixGain', params: { K: [[1, 0], [0, 1]] } }, { id: 'y', type: 'sink', params: { name: 'y' } }],
    wires: [{ from: 'c', to: 'k' }, { from: 'k', to: 'y' }],
  });
  assert.throws(() => compileDiagram(d, 'plant', { standalone: true }), /'k'.*takes 2 elements.*3/);
  // A loop of blocks without state has no width to start from.
  const loop = normalizeDiagram({ blocks: [{ id: 's', type: 'sum', params: { signs: '++' } }, { id: 'g', type: 'gain', params: { K: 0.5 } }, { id: 'c', type: 'constant', params: { value: [1, 2] } }],
    wires: [{ from: 'c', to: 's' }, { from: 'g', to: 's:1' }, { from: 's', to: 'g' }] });
  assert.throws(() => compileDiagram(loop, 'plant', { standalone: true }));
  // A vector Sink names its elements, or numbers them.
  const s = normalizeDiagram({ blocks: [{ id: 'c', type: 'constant', params: { value: [1, 2, 3] } }, { id: 'p', type: 'sink', params: { name: 'x,y,z', unit: 'm,m,rad' } }, { id: 'q', type: 'sink', params: { name: 'q' } }],
    wires: [{ from: 'c', to: 'p' }, { from: 'c', to: 'q' }] });
  const out = simulateSystem(s, {}, { duration: 0.1, sampleTime: 0.01 });
  assert.deepEqual(Object.keys(out.signals).sort(), ['q1', 'q2', 'q3', 'x', 'y', 'z']);
  assert.equal(out.signals.z[3], 3);
});

test('a lanes Controller runs one law per lane; with one lane it is today\'s Controller', () => {
  const plant = (lanes) => normalizeDiagram({
    blocks: [
      { id: 'r', type: 'source', params: { signal: 'r' } },
      { id: 'ctrl', type: 'controller', params: { inputs: 2, Ts: 0.01, ...(lanes > 1 ? { lanes } : {}) }, variants: [{ type: 'pid', params: { Kp: 2, Ki: 1 } }] },
      { id: 'p', type: 'firstOrder', params: { K: 1, tau: 0.5 } }, { id: 'y', type: 'sink', params: { name: 'y' } },
    ],
    wires: [{ from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'p' }, { from: 'p', to: 'y' }, { from: 'p', to: 'ctrl:1' }],
  });
  const one = simulateSystem(plant(1), { r: dc(1) }, { duration: 2, sampleTime: 0.01 });
  const three = simulateSystem(plant(3), { r: dc(1) }, { duration: 2, sampleTime: 0.01 });
  for (const j of [1, 2, 3]) assert.deepEqual(Array.from(three.signals[`y${j}`]), Array.from(one.signals.y));
});
