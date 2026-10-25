// The step bound sees loops through integrators (design/output/detail-levels.md
// §5): the Jacobian's largest |λ| at the start state joins the blocks' own
// bounds in el.bound; simulateSystem checks the end state again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDiagram, compileDiagram } from '../src/core/diagram.js';
import { simulateSystem, simulate } from '../src/core/sim.js';
import { normalizeReference } from '../src/core/signals.js';
import { SYSTEM_LIBRARY } from '../src/core/systems.js';
import { defaultSampleTime } from '../src/core/project.js';

const dc = (level) => normalizeReference({ period: 100, components: [{ type: 'dc', params: { level } }] });

// r → Σ → Gain k → ∫ → y, y fed back: ẏ = k (r − y), λ = −k. Integrators and
// a Gain, so no block's own bound sees it. extra: blocks put between the
// integrator and the feedback (a quantizer, noise).
function loop(k, extra = []) {
  const chain = ['int', ...extra.map((b) => b.id)];
  return normalizeDiagram({
    blocks: [{ id: 'r', type: 'source', params: { signal: 'r' } }, { id: 'sum', type: 'sum', params: { signs: '+-' } }, { id: 'k', type: 'gain', params: { K: k } },
      { id: 'int', type: 'integrator', params: { K: 1 } }, ...extra, { id: 'y', type: 'sink', params: { name: 'y' } }],
    wires: [{ from: 'r', to: 'sum' }, { from: 'sum', to: 'k' }, { from: 'k', to: 'int' }, ...chain.slice(1).map((id, i) => ({ from: chain[i], to: id })),
      { from: chain.at(-1), to: 'sum:1' }, { from: 'int', to: 'y' }],
  });
}

test('every library system keeps its step: the eigenvalue is at or below its blocks\' bound, at the start and at the end', () => {
  const seen = {};
  for (const sys of SYSTEM_LIBRARY) {
    if (JSON.stringify(sys.plant).includes('"external"')) continue;
    const d = normalizeDiagram(sys.plant.diagram);
    const el = compileDiagram(d, 'plant', { standalone: true, laws: false });
    seen[sys.name] = [el.blockBound, el.stiff.bound];
    // The mass–spring–damper's blocks are Integrators (bound 0): its 5 1/s
    // loop now counts, and still takes one step per 2.5 ms record.
    if (el.blockBound > 0) assert.equal(el.bound, el.blockBound, sys.name);
    const duration = Math.max(...Object.values(sys.input.signals).map((s) => s.period), 1);
    const out = simulateSystem(d, sys.input.signals, { duration, sampleTime: sys.sim?.sampleTime ?? defaultSampleTime(duration) });
    assert.ok(!out.info.warnings.some((w) => /stiffer|needs steps/.test(w)), `${sys.name}: ${out.info.warnings}`);
    assert.ok(out.info.stiffness.start.bound >= 0 && out.info.ms > 0);
  }
  // As measured in detail-levels.md §5 (the tank's start level and inflow differ: 17 here).
  assert.ok(Math.abs(seen['Encoder errors and torque ripple'][1] - 1000) < 1e-3);
  assert.ok(Math.abs(seen['DC motor, position control'][1] - 84.2) < 0.1);
  assert.ok(seen['Triple pendulum'][1] < 20 && seen['Conical tank, gain scheduling'][1] < 20);
});

test('a fast loop of Integrator and Gain gets its step, and its run does not diverge', () => {
  const d = loop(1e4);
  const el = compileDiagram(d, 'plant', { standalone: true, laws: false });
  assert.equal(el.blockBound, 0);
  assert.ok(Math.abs(el.bound - 1e4) < 1e-2, `bound ${el.bound}`);
  assert.equal(el.stiff.state, 'int');
  const out = simulateSystem(d, { r: dc(1) }, { duration: 0.1, sampleTime: 1e-3 });
  assert.equal(out.info.substeps, 20);        // 0.5/1e4 = 50 µs per step
  assert.ok(Math.abs(out.signals.y.at(-1) - 1) < 1e-12);
  assert.ok(Math.abs(out.info.bound - 1e4) < 1e-2);
});

test('a quantizer or noise crossed by the perturbation does not change the bound', () => {
  const plain = compileDiagram(loop(1e4), 'plant', { standalone: true, laws: false }).bound;
  const q = compileDiagram(loop(1e4, [{ id: 'q', type: 'quantizer', params: { q: 0.5 } }]), 'plant', { standalone: true, laws: false }).bound;
  const n = compileDiagram(loop(1e4, [{ id: 'n', type: 'noise', params: { std: 1, seed: 3 } }]), 'plant', { standalone: true, laws: false }).bound;
  assert.equal(q, plain);
  assert.equal(n, plain);
});

test('a plant stiffer at the end of the run runs again with the end\'s step, and says so', () => {
  // ẋ = r − x³: J = 0 at the start, −3x² = −300 once x reaches 10.
  const d = normalizeDiagram({
    blocks: [{ id: 'r', type: 'source', params: { signal: 'r' } }, { id: 'sum', type: 'sum', params: { signs: '+-' } }, { id: 'x', type: 'integrator', params: { K: 1 } },
      { id: 'cube', type: 'fcn', params: { expr: 'u^3' } }, { id: 'y', type: 'sink', params: { name: 'y' } }],
    wires: [{ from: 'r', to: 'sum' }, { from: 'sum', to: 'x' }, { from: 'x', to: 'cube' }, { from: 'cube', to: 'sum:1' }, { from: 'x', to: 'y' }],
  });
  const out = simulateSystem(d, { r: dc(1000) }, { duration: 2, sampleTime: 0.01 });
  // The first run's end, at 10 ms steps (λh beyond RK4's 2.8 there), is
  // itself rough; the second run's steps are fine enough for x³.
  assert.match(out.info.warnings[0], /^stiffer later in the run: 'x' needs steps of [\d.]+ ms at 2 s, against 10 ms at the start/);
  assert.ok(out.info.substeps > 1);
  assert.equal(out.info.stiffness.start.bound, 0);
  assert.ok(Math.abs(out.signals.y.at(-1) - 10) < 1e-9, `x ends at ${out.signals.y.at(-1)}`);
});

test('when the step cap binds, the warning names the state that needs the step', () => {
  const out = simulateSystem(loop(1e6), { r: dc(1) }, { duration: 10, sampleTime: 0.01 });
  assert.ok(out.info.warnings.includes("'int' needs steps of 500 ns; this 10 s screen would take 20 M steps; it ran 400 k: inaccurate. Shorten the screen"), out.info.warnings.join(' | '));
});

test('the loop path and a Model take the bound through el.bound', () => {
  // The same fast loop as a plant between In and Out, under a Controller.
  const plant = { blocks: [{ id: 'in', type: 'inport', params: { port: 1 } }, { id: 'sum', type: 'sum', params: { signs: '+-' } }, { id: 'k', type: 'gain', params: { K: 1e4 } },
    { id: 'int', type: 'integrator', params: { K: 1 } }, { id: 'out', type: 'outport', params: { port: 1 } }],
  wires: [{ from: 'in', to: 'sum' }, { from: 'sum', to: 'k' }, { from: 'k', to: 'int' }, { from: 'int', to: 'sum:1' }, { from: 'int', to: 'out' }] };
  const v1 = simulate({
    reference: dc(1), controller: { type: 'PID', params: { Kp: 1, Ki: 0, Kd: 0, Tf: 0.05, b: 1, c: 0 } },
    actuator: { type: 'ideal', params: {} }, disturbance: { type: 'none', params: {} },
    plant: { type: 'diagram', diagram: plant }, sensor: { type: 'ideal', params: {} }, noise: { type: 'none', params: {} },
  }, { duration: 0.01, sampleTime: 1e-3 }, { openLoop: true });
  assert.equal(v1.info.substeps, 20);
  const d = normalizeDiagram({
    blocks: [{ id: 'r', type: 'source', params: { signal: 'r' } }, { id: 'ctrl', type: 'controller', params: { inputs: 2, Ts: 0.001 } }, { id: 'p', type: 'subsystem', diagram: plant }],
    wires: [{ from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'p' }, { from: 'p', to: 'ctrl:1' }],
  });
  const model = compileDiagram(d, 'plant', { mode: 'model' }).seen('ctrl');
  assert.ok(Math.abs(model.bound - 1e4) < 1e-2, `Model.bound ${model.bound}`);
});
