// Formulas and masks (design/output/transparent-models.md §1.4, §8.5;
// detail-levels.md §2.3: inf, transfer-function coefficients, mask min and
// max, sentences with SI prefixes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileFormula, evalFormula, parseFormula, formulaNames, isFormula, isReserved, sentence } from '../src/core/formula.js';
import { compileExpr } from '../src/core/expr.js';
import { normalizeDiagram, compileDiagram, maskValues, formulaIn } from '../src/core/diagram.js';
import { simulateSystem } from '../src/core/sim.js';
import { normalizeReference } from '../src/core/signals.js';
import { normalizeProject } from '../src/core/project.js';
import { plantKey } from '../src/core/design.js';

const bits = (x) => new Uint32Array(Float64Array.of(x).buffer).join(',');

test('a formula computes expr.js\'s numbers bit for bit', () => {
  const srcs = ['u^2', '0.5*sin(2*pi*3*t) + step(t - 0.2)', '-u^2 + 2u*(t+1) - 2^-u', 'sqrt(abs(u))/3 - e^-t', 'min(u, 0.3) * max(t, 1e-3) / pow(u, 3)', 'clamp(u, -1, 1) + mod(t, 0.7) - atan2(u, t)', '3(u + 1)(u - 2) / 7', 'u * 2 + T + PI', 'tanh(u)*log10(1+t) - ln(2) + floor(u*10)/10'];
  for (const src of srcs) {
    const old = compileExpr(src, { vars: true });
    const f = compileFormula(src, (n) => ({ u: { slot: 0 }, t: { slot: 1 } }[n] ?? null));
    for (const u of [-1.7, 0, 0.3, 2.5]) for (const t of [0, 0.123, 4.5]) {
      const want = old({ u, t });
      assert.equal(bits(f(Float64Array.of(u, t))), bits(want), `${src} at u ${u}, t ${t}`);
    }
  }
  // U: expr.js read NaN; a formula refuses it.
  assert.throws(() => compileFormula('U * 2', (n) => (n === 'u' ? { slot: 0 } : null)), (e) => e.code === 'unknown-name' && e.name === 'U');
});

test('names: Greek, case-sensitive, constants and functions in any case, inf; constant subtrees fold', () => {
  assert.deepEqual(formulaNames(parseFormula('θ1 + ω*l1 - sin(φ) + PI')), ['θ1', 'ω', 'l1', 'φ', 'PI']);
  assert.equal(evalFormula('2*θ0 + PI', { θ0: 0.5 }), 1 + Math.PI);
  assert.equal(evalFormula('L', { L: 2, l: 3 }), 2);
  assert.equal(evalFormula('-inf'), -Infinity);
  assert.equal(evalFormula('1/(20*pi*GBW*Ro)', { GBW: 1e6, Ro: 496 }), 1 / (20 * Math.PI * 1e6 * 496));
  assert.ok(compileFormula('2*pi*m', (n) => (n === 'm' ? { value: 3 } : null)).constant);
  assert.ok(!compileFormula('2*pi*t', (n) => (n === 't' ? { slot: 0 } : null)).constant);
  assert.ok(isFormula('l1') && isFormula('inf') && !isFormula('0.5') && !isFormula(0.5) && !isFormula(''));
  assert.ok(isReserved('t') && isReserved('Pi') && isReserved('sqrt') && isReserved('inf') && !isReserved('m'));
});

test('sentences put values in with SI prefixes', () => {
  const v = (src) => evalFormula(src, { CL: 1e-9, Ro: 496, f: 541e3 });
  assert.equal(sentence('C_L {CL:F}, a pole at {1/(2*pi*Ro*CL):Hz}; gain {2*Ro}; no top {inf:m}', v), 'C_L 1 nF, a pole at 321 kHz; gain 992; no top ∞');
  assert.equal(sentence('{CL*1e-3:F}', v), '1 pF');
});

// A masked subsystem: a gain of k·m into an integrator, x0-free.
const masked = (params, inner = 'k*m', extra = {}) => ({
  blocks: [{ id: 'r', type: 'source', params: { signal: 'r' } },
    { id: 'sub', type: 'subsystem', name: 'drive', mask: [{ key: 'k', label: 'Gain', unit: '1', min: 0 }, { key: 'm', label: 'Mass', unit: 'kg', max: 10 }], params,
      diagram: { blocks: [{ id: 'i', type: 'inport', params: { port: 1 } }, { id: 'g', type: 'gain', params: { K: inner } }, { id: 'o', type: 'outport', params: { port: 1 } }, ...(extra.blocks ?? [])],
        wires: [{ from: 'i', to: 'g' }, { from: 'g', to: 'o' }, ...(extra.wires ?? [])] } },
    { id: 'y', type: 'sink', params: { name: 'y' } }],
  wires: [{ from: 'r', to: 'sub' }, { from: 'sub', to: 'y' }],
});
const one = normalizeReference({ period: 10, components: [{ type: 'dc', params: { level: 1 } }] });
const run = (d) => simulateSystem(normalizeDiagram(d), { r: one }, { duration: 0.02, sampleTime: 0.01 }).signals.y[1];

test('a mask\'s values reach the formulas inside; formulas stay as written in the file', () => {
  const d = normalizeDiagram(masked({ k: 2, m: '1.5' }));
  assert.deepEqual(d.blocks[1].mask, [{ key: 'k', label: 'Gain', unit: '1', min: 0 }, { key: 'm', label: 'Mass', unit: 'kg', max: 10 }]);
  assert.deepEqual(d.blocks[1].params, { k: 2, m: 1.5 });
  assert.equal(d.blocks[1].diagram.blocks[1].params.K, 'k*m');
  assert.equal(run(d), 3);
  // The project file keeps it (loop-tuner/2, no version bump).
  const p = normalizeProject({ format: 'loop-tuner/2', system: { signals: { r: one }, plant: { type: 'diagram', diagram: d } } });
  assert.deepEqual(normalizeProject(JSON.parse(JSON.stringify(p))).system.plant.diagram, d);
  // The panel's values at a level, innermost first.
  assert.deepEqual([...maskValues(d, ['sub'])], [['k', 2], ['m', 1.5]]);
  assert.equal(formulaIn('k*m', maskValues(d, ['sub'])), 3);
});

test('masks nest and shadow; a mask value may be a formula in the mask outside', () => {
  const inner = masked({ k: 'k0/2', m: 4 }).blocks[1];
  const outer = {
    blocks: [{ id: 'r', type: 'source', params: { signal: 'r' } },
      { id: 'top', type: 'subsystem', name: 'top', mask: [{ key: 'k0', unit: '1' }, { key: 'm', unit: 'kg' }], params: { k0: 3, m: 100 },
        diagram: { blocks: [{ id: 'i', type: 'inport', params: { port: 1 } }, inner, { id: 'o', type: 'outport', params: { port: 1 } }], wires: [{ from: 'i', to: 'sub' }, { from: 'sub', to: 'o' }] } },
      { id: 'y', type: 'sink', params: { name: 'y' } }],
    wires: [{ from: 'r', to: 'top' }, { from: 'top', to: 'y' }],
  };
  assert.equal(run(outer), 1.5 * 4);   // k = k0/2 = 1.5; m is the inner 4, not the outer 100
  assert.deepEqual([...maskValues(normalizeDiagram(outer), ['top', 'sub'])], [['k', 1.5], ['m', 4], ['k0', 3]]);
});

test('refusals name the field and what is there', () => {
  const refuse = (d, re) => assert.throws(() => normalizeDiagram(d), (e) => re.test(e.message), re.source);
  refuse(masked({ k: 2, m: 1 }, 'k*l4'), /plant\/sub\.blocks\[1\]\(g\)\.K: 'l4' is not a parameter of 'drive' \(k, m\)/);
  refuse(masked({ k: 2, m: 1 }, 'k*'), /\(g\)\.K: the formula ends too early/);
  refuse(masked({ k: 2 }), /params\.m: needs a value/);
  refuse(masked({ k: 2, m: 1, q: 3 }), /params: "q" is not on the mask \(k, m\)/);
  refuse(masked({ k: -1, m: 1 }), /params\.k: -1 is below its min 0/);
  refuse(masked({ k: 1, m: 11 }), /params\.m: 11 is above its max 10/);
  refuse(masked({ k: 1, m: 'k2' }), /params\.m: 'k2' is not a parameter here/);
  refuse({ ...masked({ k: 1, m: 1 }), blocks: masked({ k: 1, m: 1 }).blocks.map((b) => (b.id === 'sub' ? { ...b, mask: [...b.mask, { key: 'pi' }] } : b)) }, /mask\[2\]: "pi" is the time, a constant or a function/);
  refuse({ ...masked({ k: 1, m: 1 }), blocks: masked({ k: 1, m: 1 }).blocks.map((b) => (b.id === 'sub' ? { ...b, mask: [...b.mask, { key: 'k' }] } : b)) }, /mask\[2\]: the key "k" twice/);
  refuse(masked({ k: 1, m: 1 }, 'k/0'), /\(g\)\.K: k\/0 = inf; it must be finite/);
  // A formula in an integer field.
  refuse(masked({ k: 1, m: 1 }, 1, { blocks: [{ id: 'sw', type: 'switch', params: { inputs: 'k+1' } }] }), /\(sw\)\.inputs: a whole number, not a formula/);
  // Parameters without a mask.
  refuse({ blocks: [{ id: 's', type: 'subsystem', params: { k: 1 }, diagram: { blocks: [], wires: [] } }], wires: [] }, /parameters \(k\) need a mask/);
});

test('inf where a limit allows it; formulas in transfer-function coefficients', () => {
  // Saturation [−inf, k]: an open lower limit.
  const sat = masked({ k: 0.5, m: 1 }, 1, { blocks: [{ id: 'sat', type: 'saturation', params: { min: '-inf', max: 'k' } }] });
  sat.blocks[1].diagram.wires = [{ from: 'i', to: 'sat' }, { from: 'sat', to: 'o' }];
  assert.equal(run(sat), 0.5);
  // A lag 1/(τ s + 1) with τ = m/k from the mask: 1 − e^(−t/τ) at t = 10 ms.
  const lag = masked({ k: 4, m: 2 }, 1, { blocks: [{ id: 'tf', type: 'tf', params: { num: [1], den: ['m/k', 1] } }] });
  lag.blocks[1].diagram.wires = [{ from: 'i', to: 'tf' }, { from: 'tf', to: 'o' }];
  const d = normalizeDiagram(lag);
  assert.deepEqual(d.blocks[1].diagram.blocks.at(-1).params.den, ['m/k', 1]);
  assert.ok(Math.abs(run(lag) - (1 - Math.exp(-0.01 / 0.5))) < 1e-9);
});

test('plantKey follows a mask value, not a move', () => {
  const d = normalizeDiagram(masked({ k: 2, m: 1 }));
  const moved = structuredClone(d); moved.blocks[1].x += 40;
  const edited = structuredClone(d); edited.blocks[1].params.m = 1.5;
  assert.equal(plantKey(moved), plantKey(d));
  assert.notEqual(plantKey(edited), plantKey(d));
  // A compile of the masked diagram runs the same as the same numbers typed in.
  const typed = normalizeDiagram(masked({ k: 2, m: 1 }, 2));
  assert.equal(compileDiagram(d, 'plant', { standalone: true }).n, compileDiagram(typed, 'plant', { standalone: true }).n);
  assert.equal(run(d), run(typed));
});
