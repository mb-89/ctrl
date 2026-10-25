// The math blocks on vector signals (src/core/mathblocks.js): each law held
// to a plain computation, then end to end through a diagram and a run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATH_BLOCKS as M } from '../src/core/mathblocks.js';
import { jointFriction } from '../src/core/rbd.js';
import { normalizeDiagram, compileDiagram } from '../src/core/diagram.js';
import { simulateSystem } from '../src/core/sim.js';

const ctx = (inW, outW, extra = {}) => ({ inW, outW, name: "'b'", model: false, report: () => {}, ...extra });
const run = (key, params, inW, u, extra) => {
  const def = M[key], p = def.normalize(params, 'b');
  const w = def.widths(p, inW, { name: "'b'" });
  const y = new Float64Array(w.outs.reduce((s, n) => s + n, 0));
  def.make(p, ctx(w.ins, w.outs, extra))(Float64Array.from(u), y, 0.5);
  return Array.from(y);
};
const close = (a, b, tol = 1e-12) => { assert.equal(a.length, b.length); a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) <= tol * (1 + Math.abs(b[i])), `${i}: ${x} vs ${b[i]}`)); };

test('Matrix Gain: a number, a list element by element, rows K·u', () => {
  assert.deepEqual(run('matrixGain', { K: 2 }, [3], [1, 2, 3]), [2, 4, 6]);
  assert.deepEqual(run('matrixGain', { K: [1, 2, 3] }, [3], [1, 1, 2]), [1, 2, 6]);
  assert.deepEqual(run('matrixGain', { K: '[[1,2,3],[4,5,6]]' }, [3], [1, 0, -1]), [-2, -2]);
  assert.deepEqual(M.matrixGain.normalize({ K: [[1, 2], [3, 4]] }, 'b'), { K: [[1, 2], [3, 4]] });
  assert.equal(M.matrixGain.widths({ K: 2 }, [undefined], { name: "'g'" }), null);
  assert.throws(() => M.matrixGain.widths({ K: [[1, 2]] }, [3], { name: "'g'" }), /'g': K is 1×2, so it takes 2 elements, but gets 3/);
  assert.throws(() => M.matrixGain.normalize({ K: [[1, 2], [3]] }, 'b'), /b\.K: every row needs 2 values/);
});

test('Product: A·B against hand loops, the inner size from B or given', () => {
  const A = [1, 2, 3, 4, 5, 6], B = [7, 8, 9, 10, 11, 12];   // A 2×3, B 3×2
  const want = [];
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { let s = 0; for (let m = 0; m < 3; m++) s += A[i * 3 + m] * B[m * 2 + j]; want.push(s); }
  assert.deepEqual(run('product', { inner: 3 }, [6, 6], [...A, ...B]), want);
  assert.deepEqual(run('product', {}, [6, 3], [...A, 1, 0, -1]), [-2, -2]);   // a matrix times a vector
  assert.deepEqual(M.product.widths({ inner: 3 }, [6, 6], {}), { ins: [6, 6], outs: [4] });
  assert.equal(M.product.widths({ inner: 0 }, [6, undefined], {}), null);
  assert.throws(() => M.product.widths({ inner: 0 }, [36, 5], { name: "'J⁺v*'" }), /'J⁺v\*': A has 36 elements but B has 5: the inner sizes must agree/);
  assert.throws(() => M.product.normalize({ inner: -1 }, 'b'), /b\.inner/);
});

test('Solve: SPD by Cholesky, other matrices by LU, a singular A stops the run', () => {
  const x = [1, -2, 3];
  const mul = (A, v) => [0, 1, 2].map((i) => A[i * 3] * v[0] + A[i * 3 + 1] * v[1] + A[i * 3 + 2] * v[2]);
  const spd = [4, 1, 0.5, 1, 3, 0.2, 0.5, 0.2, 2];
  close(run('solve', {}, [9, 3], [...spd, ...mul(spd, x)]), x);
  const nonsym = [0, 2, 1, 1, 0, 3, 4, 1, 0];   // a zero pivot first: needs the row swap
  close(run('solve', {}, [9, 3], [...nonsym, ...mul(nonsym, x)]), x);
  const indefinite = [1, 2, 0, 2, 1, 0, 0, 0, 1];   // symmetric, not positive definite
  close(run('solve', {}, [9, 3], [...indefinite, ...mul(indefinite, x)]), x);
  assert.throws(() => run('solve', {}, [9, 3], [1, 2, 3, 2, 4, 6, 0, 0, 1, 1, 1, 1]), /'b': A is singular at t = 0.5 s; the run stops here/);
  assert.throws(() => M.solve.widths({}, [8, 3], { name: "'s'" }), /'s': A has 8 elements; it must be square/);
  assert.throws(() => M.solve.widths({}, [9, 2], { name: "'s'" }), /'s': A is 3×3, so b needs 3 elements, but it has 2/);
});

test('Norm: √Σu²', () => {
  assert.deepEqual(run('norm', {}, [3], [3, 4, 12]), [13]);
  assert.deepEqual(M.norm.widths({}, [5]), { ins: [5], outs: [1] });
});

test('Friction: rbd.jointFriction with G = 1 bit for bit; B·ω only in a model', () => {
  const drive = { B: [0.1, 0.2, 0.3], Tcp: [0.5, 0, 1.2], Tcn: 0.7, ws: [0.05, 1, 0.3] };
  for (const w of [[-2, 0, 0.01], [0, -0.001, 3], [-1e-9, 1e-9, -0.3]]) {
    assert.deepEqual(run('friction', drive, [3], w), Array.from(jointFriction(Float64Array.from(w), { G: 1, ...drive })));
  }
  const notes = [];
  assert.deepEqual(run('friction', drive, [3], [-2, 1, 4], { model: true, report: (s) => notes.push(s) }), [0.1 * -2, 0.2 * 1, 0.3 * 4]);
  assert.match(notes[0], /viscous friction B·ω only/);
  assert.deepEqual(run('friction', { B: [1, 2] }, [1], [3]).length, 2);   // a width-1 ω broadcasts to the lists
  assert.throws(() => M.friction.normalize({ ws: 0 }, 'b'), /b\.ws: above 0/);
  assert.throws(() => M.friction.normalize({ Tcp: -1 }, 'b'), /b\.Tcp: at least 0/);
  assert.throws(() => M.friction.normalize({ B: [1, 2], ws: [1, 2, 3] }, 'b'), /one length/);
  assert.throws(() => M.friction.widths({ B: [1, 2], Tcp: 0, Tcn: 0, ws: 1 }, [3], { name: "'f'" }), /'f': B has 2 values but ω has 3/);
});

// ---- End to end

const OPTS = { duration: 0.1, sampleTime: 0.01 };
const last = (out, name) => out.signals[name].at(-1);
const diagram = (blocks, wires) => normalizeDiagram({ blocks, wires });

test('a diagram: Product, Solve, Matrix Gain and Norm feed Sinks', () => {
  const d = diagram([
    { id: 'A', type: 'constant', params: { value: [[2, 1], [1, 3]] } },
    { id: 'b', type: 'constant', params: { value: [3, 5] } },
    { id: 'p', type: 'product' },
    { id: 's', type: 'solve' },
    { id: 'g', type: 'matrixGain', params: { K: [[1, 1], [0, 2]] } },
    { id: 'n', type: 'norm' },
    { id: 'y1', type: 'sink', params: { name: 'p1,p2' } },
    { id: 'y2', type: 'sink', params: { name: 'x' } },
    { id: 'y3', type: 'sink', params: { name: 'k' } },
    { id: 'y4', type: 'sink', params: { name: 'nrm' } },
  ], [
    { from: 'A', to: 'p' }, { from: 'b', to: 'p:1' }, { from: 'p', to: 'y1' },
    { from: 'A', to: 's' }, { from: 'p', to: 's:1' }, { from: 's', to: 'y2' },
    { from: 's', to: 'g' }, { from: 'g', to: 'y3' }, { from: 'b', to: 'n' }, { from: 'n', to: 'y4' },
  ]);
  const out = simulateSystem(d, {}, OPTS);
  assert.deepEqual([last(out, 'p1'), last(out, 'p2')], [11, 18]);
  close([last(out, 'x1'), last(out, 'x2')], [3, 5]);   // A·x = A·b: x = b
  close([last(out, 'k1'), last(out, 'k2')], [8, 10]);
  close([last(out, 'nrm')], [Math.sqrt(34)]);
});

test('a diagram: Friction on a vector speed, and a singular A stops the run', () => {
  const d = diagram([
    { id: 'w', type: 'constant', params: { value: [-1, 0.5] } },
    { id: 'f', type: 'friction', params: { B: 0.1, Tcp: [1, 2], Tcn: 0.5, ws: 0.2 } },
    { id: 'y', type: 'sink', params: { name: 'tf' } },
  ], [{ from: 'w', to: 'f' }, { from: 'f', to: 'y' }]);
  const out = simulateSystem(d, {}, OPTS);
  assert.deepEqual([last(out, 'tf1'), last(out, 'tf2')], Array.from(jointFriction(Float64Array.of(-1, 0.5), { G: 1, B: 0.1, Tcp: [1, 2], Tcn: 0.5, ws: 0.2 })));
  const sing = diagram([
    { id: 'A', type: 'constant', params: { value: [[1, 2], [2, 4]] } },
    { id: 'b', type: 'constant', params: { value: [1, 1] } },
    { id: 's', type: 'solve', name: 'IK' },
    { id: 'y', type: 'sink', params: { name: 'x' } },
  ], [{ from: 'A', to: 's' }, { from: 'b', to: 's:1' }, { from: 's', to: 'y' }]);
  assert.throws(() => simulateSystem(sing, {}, OPTS), /IK: A is singular at t = 0 s; the run stops here/);
});

test('width mismatches are refused with a sentence when compiled', () => {
  const d = diagram([
    { id: 'A', type: 'constant', params: { value: [[1, 2, 3], [4, 5, 6]] } },
    { id: 'b', type: 'constant', params: { value: [1, 2, 3, 4] } },
    { id: 'p', type: 'product', name: 'Jv' },
    { id: 'y', type: 'sink', params: { name: 'y' } },
  ], [{ from: 'A', to: 'p' }, { from: 'b', to: 'p:1' }, { from: 'p', to: 'y' }]);
  assert.throws(() => compileDiagram(d, 'plant', { standalone: true }), /'Jv': A has 6 elements but B has 4: the inner sizes must agree/);
  const g = diagram([
    { id: 'u', type: 'constant', params: { value: [1, 2, 3] } },
    { id: 'g', type: 'matrixGain', params: { K: [[1, 0], [0, 1]] } },
    { id: 'y', type: 'sink', params: { name: 'y' } },
  ], [{ from: 'u', to: 'g' }, { from: 'g', to: 'y' }]);
  assert.throws(() => simulateSystem(g, {}, OPTS), /'g': K is 2×2, so it takes 2 elements, but gets 3/);
});
