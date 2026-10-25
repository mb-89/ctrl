// The compiler's groundwork (design/output/transparent-models.md §1.5, step 1):
// pass nodes elided, Sinks read through, state nodes with several inputs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ELEMENTS, normalizeDiagram, compileDiagram } from '../src/core/diagram.js';
import { simulateSystem } from '../src/core/sim.js';
import { normalizeReference } from '../src/core/signals.js';

const dc = (level) => normalizeReference({ period: 10, components: [{ type: 'dc', params: { level } }] });
const step = dc(1);

test('a Sink behind subsystem ports reads its origin, and the ports cost no evaluation', () => {
  // Source → (In → Gain 2 → Out, nested twice) → Sink, beside the plain wiring.
  const inner = { blocks: [{ id: 'i', type: 'inport', params: { port: 1 } }, { id: 'g', type: 'gain', params: { K: 2 } }, { id: 'o', type: 'outport', params: { port: 1 } }],
    wires: [{ from: 'i', to: 'g' }, { from: 'g', to: 'o' }] };
  const outer = { blocks: [{ id: 'i', type: 'inport', params: { port: 1 } }, { id: 's', type: 'subsystem', diagram: inner }, { id: 'o', type: 'outport', params: { port: 1 } }],
    wires: [{ from: 'i', to: 's' }, { from: 's', to: 'o' }] };
  const d = normalizeDiagram({
    blocks: [{ id: 'r', type: 'source', params: { signal: 'r' } }, { id: 'sub', type: 'subsystem', diagram: outer }, { id: 'int', type: 'integrator', params: { K: 1 } },
      { id: 'y', type: 'sink', params: { name: 'y' } }, { id: 'x', type: 'sink', params: { name: 'x' } }, { id: 'open', type: 'sink', params: { name: 'open' } }],
    wires: [{ from: 'r', to: 'sub' }, { from: 'sub', to: 'y' }, { from: 'sub', to: 'int' }, { from: 'int', to: 'x' }],
  });
  const out = simulateSystem(d, { r: step }, { duration: 1, sampleTime: 0.01 });
  assert.equal(out.signals.y[50], 2);
  assert.ok(Math.abs(out.signals.x[100] - 2) < 1e-12);
  assert.equal(out.signals.open[10], 0);   // an unconnected Sink reads 0, as before
});

test('a state node with several inputs gets them all (uv)', () => {
  // A test-only physics block: ẋ = u1 − u2, two inputs.
  ELEMENTS.twoIn = { label: 'Two in', group: 'Test', params: [], ports: () => [2, 1], outputs: ['x'],
    ode: { n: 1, states: () => [{ name: 'x', unit: '1', angle: false }], init: () => [0], out: (X, o, p, y) => { y[0] = X[o]; },
      make: () => (X, o, u, dX, uv) => { dX[o] = uv[0] - uv[1]; }, bound: () => 0 } };
  try {
    const d = normalizeDiagram({
      blocks: [{ id: 'a', type: 'source', params: { signal: 'a' } }, { id: 'b', type: 'source', params: { signal: 'b' } }, { id: 'p', type: 'twoIn' }, { id: 'y', type: 'sink', params: { name: 'y' } }],
      wires: [{ from: 'a', to: 'p' }, { from: 'b', to: 'p:1' }, { from: 'p', to: 'y' }],
    });
    const out = simulateSystem(d, { a: step, b: dc(0.25) }, { duration: 2, sampleTime: 0.01 });
    assert.ok(Math.abs(out.signals.y.at(-1) - 1.5) < 1e-12);
    // A one-input physics block keeps reading u alone (no uv).
    assert.equal(compileDiagram(normalizeDiagram({ blocks: [{ id: 'p', type: 'conicalTank' }], wires: [] }), 'plant', { standalone: true }).n, 1);
  } finally { delete ELEMENTS.twoIn; }
});
