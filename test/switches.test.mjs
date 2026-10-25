// Mask toggles and choices, compile-time switches, ports from the mask
// (design/output/servo.md §8 items 2, 6, 7; tests §12.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDiagram, compileDiagram, blockPorts } from '../src/core/diagram.js';
import { simulateSystem } from '../src/core/sim.js';

const step = { r: { period: 1, components: [{ type: 'step', params: { amplitude: 1, time: 0.1 } }] } };
const sim = { duration: 1, sampleTime: 0.002 };
const B = (id, type, params = {}, extra = {}) => ({ id, type, params, x: 0, y: 0, ...extra });

// A lag with an effect behind a Switch: a fast filter (a state, and a step
// bound) whose toggle is `on`, and a Sink inside the effect.
const masked = (on, inner = {}) => ({
  blocks: [
    B('r', 'source', { signal: 'r' }),
    {
      ...B('sub', 'subsystem', { lag: on, a: 0.2 }), name: 'plant',
      mask: [{ key: 'lag', label: 'Lag', kind: 'toggle' }, { key: 'a', label: 'Time constant', unit: 's', under: 'lag' }],
      diagram: {
        blocks: [
          B('in', 'inport', { port: 1 }), B('out', 'outport', { port: 1 }),
          B('slow', 'firstOrder', { K: 1, tau: 0.3 }),
          B('fast', 'tf', { num: [1], den: [inner.tau ?? 'a/1000', 1], delay: 0 }),
          B('sw', 'switch', { inputs: 2, position: '1 + lag' }),
          B('seen', 'sink', { name: 'inner', unit: '1' }),
        ],
        wires: [{ from: 'in', to: 'slow' }, { from: 'slow', to: 'sw' }, { from: 'slow', to: 'fast' }, { from: 'fast', to: 'sw:1' }, { from: 'fast', to: 'seen' }, { from: 'sw', to: 'out' }],
      },
    },
    B('y', 'sink', { name: 'y' }),
  ],
  wires: [{ from: 'r', to: 'sub' }, { from: 'sub', to: 'y' }],
});
const plain = {
  blocks: [B('r', 'source', { signal: 'r' }), B('slow', 'firstOrder', { K: 1, tau: 0.3 }), B('y', 'sink', { name: 'y' })],
  wires: [{ from: 'r', to: 'slow' }, { from: 'slow', to: 'y' }],
};
const bits = (a) => Array.from(new Uint32Array(Float64Array.from(a).buffer)).join(',');

test('a toggle that is off is not compiled: states, step and run bit for bit those of the diagram without it', () => {
  const off = compileDiagram(normalizeDiagram(masked(0)), 'plant', { standalone: true });
  const ref = compileDiagram(normalizeDiagram(plain), 'plant', { standalone: true });
  assert.equal(off.n, ref.n);
  assert.equal(off.bound, ref.bound);
  assert.deepEqual(off.off, ['inner']);
  const a = simulateSystem(normalizeDiagram(masked(0)), step, sim), b = simulateSystem(normalizeDiagram(plain), step, sim);
  assert.equal(a.info.substeps, b.info.substeps);
  assert.equal(bits(a.signals.y), bits(b.signals.y));
  assert.ok(!('inner' in a.signals), 'a Sink in an off branch reads off');
  assert.deepEqual(a.info.off, ['inner']);
  // On: the effect is compiled, with its state and its step.
  const on = simulateSystem(normalizeDiagram(masked(1)), step, sim);
  assert.ok(on.info.substeps > a.info.substeps);
  assert.ok('inner' in on.signals);
  assert.notEqual(bits(on.signals.y), bits(a.signals.y));
});

test('mask kinds: toggles and choices are checked, kept as written, and folded fields name a toggle or a choice', () => {
  const d = normalizeDiagram(masked(true));
  assert.equal(d.blocks[1].params.lag, 1);
  assert.equal(d.blocks[1].mask[0].kind, 'toggle');
  assert.throws(() => normalizeDiagram(masked(2)), /a toggle is 0 or 1/);
  const bad = masked(1); bad.blocks[1].mask[1].under = 'a';
  assert.throws(() => normalizeDiagram(bad), /under: a toggle's key/);
  const choice = masked(1);
  choice.blocks[1].mask[0] = { key: 'lag', label: 'Mode', kind: 'choice', options: ['plain', 'filtered'] };
  choice.blocks[1].mask[1].under = 'lag:filtered';
  choice.blocks[1].params.lag = 'filtered';
  choice.blocks[1].diagram.blocks[4].params.position = 'lag';
  const c = normalizeDiagram(choice);
  assert.equal(c.blocks[1].params.lag, 'filtered');
  assert.equal(bits(simulateSystem(c, step, sim).signals.y), bits(simulateSystem(normalizeDiagram(masked(1)), step, sim).signals.y));
  choice.blocks[1].params.lag = 'other';
  assert.throws(() => normalizeDiagram(choice), /one of plain, filtered/);
});

test('a formula in a Switch position resolves to a whole number; other integer fields still refuse one', () => {
  const d = masked(1);
  d.blocks[1].diagram.blocks[4].params.position = 'lag + 0.5';
  assert.throws(() => normalizeDiagram(d), /must be a whole number/);
  d.blocks[1].diagram.blocks[4].params.position = '2 + lag';
  assert.throws(() => normalizeDiagram(d), /the Switch has 2 inputs/);
  const e = masked(1);
  e.blocks[1].diagram.blocks.push(B('int', 'integrator', { K: 1, angle: 'lag' }));
  assert.throws(() => normalizeDiagram(e), /a whole number, not a formula/);
});

test('a port with `when` is there only where its formula is not 0; the ports follow the mask', () => {
  const d = masked(1);
  const sub = d.blocks[1];
  sub.diagram.blocks.push({ ...B('in2', 'inport', { port: 2 }), when: 'lag' }, B('t2', 'terminator'));
  sub.diagram.wires.push({ from: 'in2', to: 't2' });
  assert.deepEqual(blockPorts(normalizeDiagram(d).blocks[1]), [2, 1]);
  sub.params.lag = 0;
  assert.deepEqual(blockPorts(normalizeDiagram(d).blocks[1]), [1, 1]);
  d.wires.push({ from: 'r', to: 'sub:1' });
  assert.throws(() => normalizeDiagram(d), /sub has no input 1/);
  sub.params.lag = 1;
  const el = compileDiagram(normalizeDiagram(d), 'plant', { standalone: true });
  assert.ok(!el.warnings.some((w) => /not connected/.test(w)), el.warnings.join('; '));
});
