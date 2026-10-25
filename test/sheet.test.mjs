// The equations sheet (design/output/transparent-models.md §1.6, §8.4): the
// equations of motion in the parameters' names, from the same walk as the
// simulation; its coefficients equal the mechanism's matrices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDiagram, compileDiagram, equationSheets } from '../src/core/diagram.js';
import { SYSTEM_LIBRARY } from '../src/core/systems.js';

const sheetsOf = (d) => { const n = normalizeDiagram(d); return equationSheets(n, compileDiagram(n, 'plant', { standalone: true, laws: false })); };
const library = (name) => sheetsOf(SYSTEM_LIBRARY.find((s) => s.name === name).plant.diagram);

test("the sheet reads the cart–pole's and the triple's equations in their parameters' names", () => {
  const [cp] = library('Pendulum swing-up');
  assert.equal(cp.name, 'cart and pole');
  assert.deepEqual(cp.sheet.rows, [
    '(M + m)·v̇ + l·m·cos θ·ω̇ = F − b·v + l·m·sin θ·ω²',
    'l·m·cos θ·v̇ + l²·m·ω̇ = g·l·m·sin θ',
  ]);
  assert.equal(cp.sheet.V, 'V = g·l·m·cos θ');
  assert.equal(cp.sheet.coords, 'x (rail), rate v; θ (hinge, from upright), rate ω');
  const [tri] = library('Triple pendulum');
  assert.equal(tri.sheet.rows[0], '(M + m1 + m2 + m3)·v̇ + l1·(m1 + m2 + m3)·cos θ1·ω̇1 + l2·(m2 + m3)·cos θ2·ω̇2 + l3·m3·cos θ3·ω̇3'
    + ' = F − b·v + l1·(m1 + m2 + m3)·sin θ1·ω1² + l2·(m2 + m3)·sin θ2·ω2² + l3·m3·sin θ3·ω3²');
  assert.equal(tri.sheet.V, 'V = g·l1·(m1 + m2 + m3)·cos θ1 + g·l2·(m2 + m3)·cos θ2 + g·l3·m3·cos θ3');
  // Each coefficient's value for this plant on hover: l1·(m1 + m2 + m3) = 0.075.
  assert.match(tri.sheet.html().rows[0], /title="l1·\(m1 \+ m2 \+ m3\) = 0\.075"/);
  for (const s of [cp, tri]) assert.ok(s.check() <= 1e-15, `${s.name}: ${s.check()}`);
});

test('the sheet equals the matrices on an inclined, damped, branched mechanism with uniform rods and a torque', () => {
  // A rail inclined by α (a mask parameter) carrying a cart; on it two
  // hinges: a uniform rod, and a rod with a damped hinge at its tip driven by
  // a torque.
  const sub = {
    id: 'm', type: 'subsystem', name: 'rig', mask: [{ key: 'α' }, { key: 'M' }, { key: 'm' }, { key: 'l' }, { key: 'c' }], params: { α: 0.3, M: 1.5, m: 0.4, l: 0.6, c: 0.05 },
    diagram: {
      blocks: [{ id: 'F', type: 'inport', name: 'F', params: { port: 1 } }, { id: 'T', type: 'inport', name: 'T', params: { port: 2 } },
        { id: 'w', type: 'world', params: { g: 9.81 } }, { id: 'r', type: 'rail', params: { name: 's', rate: 'u', incline: 'α', b: 0.2 } }, { id: 'cart', type: 'mass', params: { m: 'M' } },
        { id: 'h1', type: 'hinge', params: { name: 'φ', rate: 'ψ' } }, { id: 'r1', type: 'rod', params: { l: 'l', m: 'm', at: 'uniform' } },
        { id: 'h2', type: 'hinge', params: { name: 'θ1', rate: 'ω1' } }, { id: 'r2', type: 'rod', params: { l: '2*l', m: 0.3 } },
        { id: 'h3', type: 'hinge', params: { name: 'θ2', rate: 'ω2', c: 'c', torque: 1 } }, { id: 'r3', type: 'rod', params: { l: 0.25, m: 'm' } },
        { id: 'o', type: 'outport', params: { port: 1 } }],
      wires: [{ from: 'F', to: 'r' }, { from: 'T', to: 'h3' }, { from: 'r', to: 'o' }],
      joins: [['w:W', 'r:B'], ['r:F', 'cart:F', 'h1:B', 'h2:B'], ['h1:F', 'r1:B'], ['h2:F', 'r2:B'], ['r2:T', 'h3:B'], ['h3:F', 'r3:B']],
    },
  };
  const [s] = sheetsOf({ blocks: [sub], wires: [] });
  assert.ok(s.check() <= 1e-15, `worst ${s.check()}`);
  // The incline as factors; the damping and its reaction; the torque named by its input.
  assert.match(s.sheet.rows[0], /cos α/);
  assert.match(s.sheet.rows[0], /= F − 0\.2·u/);
  assert.match(s.sheet.rows.at(-1), /\+ T − c·\(ω2 − ω1\)$/);
  assert.match(s.sheet.rows[2], /− T \+ c·\(ω2 − ω1\)$/);
  assert.match(s.sheet.rows[1], /0\.333333·l²·m·ψ̇/);   // the uniform rod about its hinge: m·(l/2)² + m·l²/12
});
