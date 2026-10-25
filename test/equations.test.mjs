// Equations (the Function block, generalised) and the Integrator's start
// value, limits, unit and angle (design/output/transparent-models.md §1.2,
// §1.3, §8.5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDiagram, compileDiagram, blockPorts, blockInputNames } from '../src/core/diagram.js';
import { simulateSystem } from '../src/core/sim.js';
import { normalizeReference } from '../src/core/signals.js';
import { systemTags } from '../src/core/systems.js';

const sig = (components, period = 100) => normalizeReference({ period, components });
const dc = (level) => sig([{ type: 'dc', params: { level } }]);

// transparent-models.md §2's open tank: q → Σ(+ −) → level rate → ∫ h [0, H]
// → h, and h → outlet (Torricelli) back into the Σ; the mask holds the old
// block's parameters.
const P = { r0: 0.05, R: 0.5, H: 1, a: 0.1, g: 9.81, h0: 0.25 };
const openTank = (p = P) => ({
  blocks: [{ id: 'q', type: 'source', params: { signal: 'q' } },
    { id: 'tank', type: 'subsystem', name: 'tank', mask: Object.keys(P).map((key) => ({ key, unit: key === 'a' ? 'm²' : key === 'g' ? 'm/s²' : 'm' })), params: p,
      diagram: {
        blocks: [{ id: 'q', type: 'inport', name: 'q', params: { port: 1 } },
          { id: 'net', type: 'sum', name: 'net inflow', params: { signs: '+-' } },
          { id: 'rate', type: 'fcn', name: 'level rate', params: { inputs: 'Q, h', eqs: 'r = r0 + (R - r0)*h/H\nA = pi*r^2\ndh = Q/A', outputs: 'dh' } },
          { id: 'level', type: 'integrator', name: 'h', params: { x0: 'h0', min: 0, max: 'H', unit: 'm' } },
          { id: 'outlet', type: 'fcn', name: 'outlet (Torricelli)', params: { inputs: 'h', eqs: 'qout = a*sqrt(2*g*h)', outputs: 'qout' } },
          { id: 'o_1', type: 'outport', name: 'h', params: { port: 1 } }],
        wires: [{ from: 'q', to: 'net' }, { from: 'net', to: 'rate' }, { from: 'level', to: 'rate:1' }, { from: 'rate', to: 'level' }, { from: 'level', to: 'o_1' },
          { from: 'level', to: 'outlet' }, { from: 'outlet', to: 'net:1' }],
      } },
    { id: 'h', type: 'sink', params: { name: 'h', unit: 'm' } }],
  wires: [{ from: 'q', to: 'tank' }, { from: 'tank', to: 'h' }],
});
// An old file's conicalTank block: it loads as the open tank (physics.js).
const blockTank = { blocks: [{ id: 'q', type: 'source', params: { signal: 'q' } }, { id: 'tank', type: 'conicalTank', name: 'tank', params: P }, { id: 'h', type: 'sink', params: { name: 'h' } }],
  wires: [{ from: 'q', to: 'tank' }, { from: 'tank', to: 'h' }] };

test('the tank from Equations, Sum and a limited Integrator runs as an old file\'s tank block loads: filling, overflowing, draining dry', () => {
  // Pump hard (overflow at H = 1 m), then draw off more than it pumps (dry at 0).
  const q = sig([{ type: 'dc', params: { level: 0.6 } }, { type: 'step', params: { amplitude: -1.4, time: 10 } }], 100);
  const sim = { duration: 30, sampleTime: 1e-3 };
  const a = simulateSystem(normalizeDiagram(openTank()), { q }, sim).signals.h, b = simulateSystem(normalizeDiagram(blockTank), { q }, sim).signals.h;
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  assert.equal(worst, 0, `h differs by ${worst} m`);
  const loaded = normalizeDiagram(blockTank).blocks[1];
  assert.deepEqual([loaded.id, loaded.name, loaded.type, loaded.params], ['tank', 'tank', 'subsystem', P], 'id, name and the old parameters on the mask');
  assert.equal(Math.max(...a), 1, 'it overflows at the brim');
  assert.equal(a.at(-1), 0, 'and stops when dry');
  assert.equal(a[0], 0.25, 'x0 from the mask');
});

test('Equations: several named inputs and outputs, names from earlier lines, mask constants, Greek names, t', () => {
  const d = normalizeDiagram({
    blocks: [{ id: 'a', type: 'source', params: { signal: 'a' } }, { id: 'b', type: 'source', params: { signal: 'b' } },
      { id: 'sub', type: 'subsystem', name: 'sub', mask: [{ key: 'κ' }], params: { κ: 3 },
        diagram: { blocks: [{ id: 'i1', type: 'inport', params: { port: 1 } }, { id: 'i2', type: 'inport', params: { port: 2 } },
          { id: 'f', type: 'fcn', name: 'mix', params: { inputs: 'θ, ω', eqs: 's = θ + ω\nd = θ - ω\np = κ*s*d + t', outputs: 'p, s' } },
          { id: 'o1', type: 'outport', params: { port: 1 } }, { id: 'o2', type: 'outport', params: { port: 2 } }],
        wires: [{ from: 'i1', to: 'f' }, { from: 'i2', to: 'f:1' }, { from: 'f', to: 'o1' }, { from: 'f:1', to: 'o2' }] } },
      { id: 'p', type: 'sink', params: { name: 'p' } }, { id: 's', type: 'sink', params: { name: 's' } }],
    wires: [{ from: 'a', to: 'sub' }, { from: 'b', to: 'sub:1' }, { from: 'sub', to: 'p' }, { from: 'sub:1', to: 's' }],
  });
  const f = d.blocks[2].diagram.blocks[2];
  assert.deepEqual(blockPorts(f), [2, 2]);
  const out = simulateSystem(d, { a: dc(2), b: dc(0.5) }, { duration: 1, sampleTime: 0.5 });
  assert.equal(out.signals.s[1], 2.5);
  assert.equal(out.signals.p[2], 3 * 2.5 * 1.5 + 1);
});

test('Equations refuses an unknown name (listing what is there), a name twice, an output not computed, a reserved name; a loop through it is algebraic', () => {
  const one = (params, scope = true) => ({ blocks: [{ id: 's', type: 'subsystem', name: 'tank', ...(scope ? { mask: [{ key: 'H' }, { key: 'a' }], params: { H: 1, a: 0.1 } } : {}),
    diagram: { blocks: [{ id: 'f', type: 'fcn', params }], wires: [] } }], wires: [] });
  const refuse = (d, re) => assert.throws(() => normalizeDiagram(d), (e) => re.test(e.message), re.source);
  refuse(one({ inputs: 'Q, h', eqs: 'r = h/H\ny = r*l4', outputs: 'y' }), /eqs line 2: 'l4' is not an input, a name defined above, or a parameter \(H, a\)/);
  refuse(one({ inputs: 'u', eqs: 'y = r\nr = u', outputs: 'y' }), /eqs line 1: 'r' is not an input, a name defined above, or a parameter/);
  refuse(one({ inputs: 'u', eqs: 'y = u\ny = 2*u', outputs: 'y' }), /eqs line 2: "y" is defined twice/);
  refuse(one({ inputs: 'u', eqs: 'u = 2', outputs: 'u' }), /eqs line 1: "u" is defined twice/);
  refuse(one({ inputs: 'u', eqs: 'y = u', outputs: 'z' }), /outputs: "z" is not computed by a line/);
  refuse(one({ inputs: 'pi', eqs: 'y = 1', outputs: 'y' }), /inputs: "pi" is the time, a constant or a function/);
  refuse(one({ inputs: 'u', eqs: 'y u', outputs: 'y' }), /eqs line 1: "name = formula"/);
  refuse(one({ inputs: 'u', eqs: 'y = u*H', outputs: 'y' }, false), /'H' is not an input, a name defined above, or a parameter \(no mask around this block\)/);
  const loop = normalizeDiagram({ blocks: [{ id: 'f', type: 'fcn', params: { inputs: 'u', eqs: 'y = u/2', outputs: 'y' } }], wires: [{ from: 'f', to: 'f' }] });
  assert.throws(() => compileDiagram(loop, 'plant', { standalone: true }), /algebraic loop through f/);
});

test('a Function block in a file loads as Equations and runs as before; a Controller fed by it still names it by its label', () => {
  const d = normalizeDiagram({ blocks: [{ id: 'f', type: 'fcn', name: 'cube', params: { expr: 'u^3 + sin(t)' } }], wires: [] });
  assert.deepEqual(d.blocks[0].params, { inputs: 'u', eqs: 'y = u^3 + sin(t)', outputs: 'y' });
  const ctl = normalizeDiagram({ blocks: [{ id: 'r', type: 'source', params: { signal: 'r' } }, { id: 'f', type: 'fcn', name: 'cube', params: { expr: 'u^3' } },
    { id: 'c', type: 'controller', params: { inputs: 2, Ts: 0.01 } }], wires: [{ from: 'r', to: 'c' }, { from: 'r', to: 'f' }, { from: 'f', to: 'c:1' }] });
  assert.deepEqual(blockInputNames(ctl, 'c'), ['r', 'cube']);
});

test('the Integrator: limits stop the rate and clamp the output, x0 as a formula, its label, unit and angle reach the model', () => {
  const d = normalizeDiagram({
    blocks: [{ id: 'u', type: 'source', params: { signal: 'u' } },
      { id: 'sub', type: 'subsystem', name: 'arm', mask: [{ key: 'lim', unit: 'rad' }], params: { lim: 0.5 },
        diagram: { blocks: [{ id: 'i', type: 'inport', params: { port: 1 } }, { id: 'x', type: 'integrator', name: 'φ', params: { K: 2, x0: '-lim/2', min: '-lim', max: 'lim', unit: 'rad', angle: 1 } }, { id: 'o', type: 'outport', params: { port: 1 } }],
          wires: [{ from: 'i', to: 'x' }, { from: 'x', to: 'o' }] } },
      { id: 'y', type: 'sink', params: { name: 'y' } }],
    wires: [{ from: 'u', to: 'sub' }, { from: 'sub', to: 'y' }],
  });
  const out = simulateSystem(d, { u: sig([{ type: 'dc', params: { level: 1 } }, { type: 'step', params: { amplitude: -2, time: 1 } }]) }, { duration: 2, sampleTime: 0.01 });
  const y = out.signals.y;
  assert.equal(y[0], -0.25);
  assert.ok(Math.abs(y[25] - 0.25) < 1e-12, `rising at 2·1: ${y[25]}`);
  assert.equal(y[100], 0.5, 'held at max while pushed beyond');
  // (RK4's last stage before the edge already sees the step: h/6 of it.)
  assert.ok(Math.abs(y[110] - 0.3) < 1e-5, `leaves the limit at once when the push turns: ${y[110]}`);
  assert.equal(y.at(-1), -0.5, 'held at min');
  const el = compileDiagram(d, 'plant', { standalone: true });
  assert.deepEqual(el.states.map(({ label, unit, angle }) => ({ label, unit, angle })), [{ label: 'arm/φ', unit: 'rad', angle: true }]);
  assert.throws(() => normalizeDiagram({ blocks: [{ id: 'x', type: 'integrator', params: { min: 1, max: 0 } }], wires: [] }), /min 1 is above max 0/);
  // With its fields at their defaults it is K/s as before; limits ±inf are none.
  assert.deepEqual(normalizeDiagram({ blocks: [{ id: 'x', type: 'integrator', params: { K: 2 } }], wires: [] }).blocks[0].params, { K: 2, x0: 0, min: null, max: null, unit: '1', angle: 0 });
  const open = normalizeDiagram({ blocks: [{ id: 'u', type: 'source', params: { signal: 'u' } }, { id: 'x', type: 'integrator', params: { min: '-inf', max: 'inf' } }, { id: 'y', type: 'sink', params: { name: 'y' } }], wires: [{ from: 'u', to: 'x' }, { from: 'x', to: 'y' }] });
  assert.ok(Math.abs(simulateSystem(open, { u: dc(-3) }, { duration: 1, sampleTime: 0.01 }).signals.y.at(-1) + 3) < 1e-12);
});

test('tags: a limited Integrator is nonlinear, an open one linear', () => {
  const tags = (params) => systemTags({ diagram: { blocks: [{ id: 'u', type: 'source', params: { signal: 'u' } }, { id: 'x', type: 'integrator', params }], wires: [{ from: 'u', to: 'x' }] } }).map((t) => t.label);
  assert.ok(tags({ K: 1, min: 0, max: null }).includes('Nonlinear'));
  assert.ok(tags({ K: 1, min: null, max: null }).includes('Linear'));
  assert.ok(tags({ K: 1, min: '-inf', max: 'inf' }).includes('Linear'));
});
