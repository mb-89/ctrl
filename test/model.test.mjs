// The physics blocks' rate functions and the plant a block sees (model mode):
// design/output/designs.md, tests 1 and 2 of designs-in-the-page.md §11.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ELEMENTS, normalizeDiagram } from '../src/core/diagram.js';

// Seeded uniform numbers (mulberry32), so a failure can be reproduced.
function rng(seed) {
  let a = seed >>> 0;
  return (lo = 0, hi = 1) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return lo + (hi - lo) * (((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}

// The rate functions as they were before ode.make (straight from the
// equations, Gaussian elimination with pivoting): the reference.
const REFERENCE = {
  cartPole(X, u, p, dX) {
    const v = X[1], th = X[2], w = X[3];
    const s = Math.sin(th), c = Math.cos(th);
    const a = (u - p.b * v + p.m * p.l * w * w * s - p.m * p.g * s * c) / (p.M + p.m * s * s);
    dX[0] = v; dX[1] = a; dX[2] = w; dX[3] = (p.g * s - a * c) / p.l;
  },
  pendulumCart(X, u, p, dX) {
    const n = p.links, N = n + 1;
    const m = [], l = [], mu = [], th = [], w = [];
    for (let i = 0; i < n; i++) { m[i] = p[`m${i + 1}`]; l[i] = p[`l${i + 1}`]; th[i] = X[1 + i]; w[i] = X[n + 2 + i]; }
    for (let i = n - 1, acc = 0; i >= 0; i--) { acc += m[i]; mu[i] = acc; }
    const A = Array.from({ length: N }, () => new Array(N + 1).fill(0));
    A[0][0] = p.M + mu[0];
    A[0][N] = u - p.b * X[n + 1];
    for (let j = 0; j < n; j++) {
      A[0][j + 1] = A[j + 1][0] = mu[j] * l[j] * Math.cos(th[j]);
      A[0][N] += mu[j] * l[j] * Math.sin(th[j]) * w[j] * w[j];
      let r = mu[j] * p.g * l[j] * Math.sin(th[j]);
      for (let k = 0; k < n; k++) {
        const mk = mu[Math.max(j, k)] * l[j] * l[k];
        A[j + 1][k + 1] = mk * Math.cos(th[j] - th[k]);
        r -= mk * Math.sin(th[j] - th[k]) * w[k] * w[k];
      }
      A[j + 1][N] = r;
    }
    for (let c = 0; c < N; c++) {
      let piv = c;
      for (let r = c + 1; r < N; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]];
      for (let r = c + 1; r < N; r++) { const f = A[r][c] / A[c][c]; for (let k = c; k <= N; k++) A[r][k] -= f * A[c][k]; }
    }
    const q = new Array(N);
    for (let r = N - 1; r >= 0; r--) { let s = A[r][N]; for (let k = r + 1; k < N; k++) s -= A[r][k] * q[k]; q[r] = s / A[r][r]; }
    dX[0] = X[n + 1];
    for (let j = 0; j < n; j++) { dX[1 + j] = w[j]; dX[n + 2 + j] = q[j + 1]; }
    dX[n + 1] = q[0];
  },
  conicalTank(X, u, p, dX) {
    const h = Math.max(0, X[0]);
    const r = p.r0 + ((p.R - p.r0) * Math.min(h, p.H)) / p.H;
    const flow = Math.max(0, u) - p.a * Math.sqrt(2 * p.g * h);
    dX[0] = h <= 0 && flow < 0 ? 0 : flow / (Math.PI * r * r);
  },
};

// A block's parameters as the diagram normalises them.
const paramsOf = (type, params) => normalizeDiagram({ blocks: [{ id: 'b', type, params }], wires: [] }).blocks[0].params;

test('physics: ode.make equals the equations on 1000 seeded states; states are labelled', () => {
  const cases = [
    ['cartPole', paramsOf('cartPole', { M: 1, m: 0.2, l: 0.5, b: 0.1 })],
    ['pendulumCart', paramsOf('pendulumCart', { links: 1, M: 1.3, m1: 0.4, l1: 0.6, b: 0.2 })],
    ['pendulumCart', paramsOf('pendulumCart', { links: 2, M: 0.8, m1: 0.2, l1: 0.3, m2: 0.15, l2: 0.25 })],
    ['pendulumCart', paramsOf('pendulumCart', { links: 3, M: 1, m1: 0.1, l1: 0.25, m2: 0.1, l2: 0.25, m3: 0.1, l3: 0.25, b: 0.1 })],
    ['conicalTank', paramsOf('conicalTank', { r0: 0.05, R: 0.5, H: 1, a: 0.1 })],
  ];
  const rand = rng(42);
  for (const [type, p] of cases) {
    const { ode } = ELEMENTS[type];
    const n = typeof ode.n === 'function' ? ode.n(p) : ode.n;
    const f = ode.make(p), o = 3;   // an offset, as inside a larger diagram
    const X = new Float64Array(n + o), dX = new Float64Array(n + o), ref = new Float64Array(n);
    const states = ode.states(p);
    assert.equal(states.length, n);
    for (let trial = 0; trial < 1000; trial++) {
      for (let i = 0; i < n; i++) X[o + i] = states[i].angle ? rand(-2 * Math.PI, 2 * Math.PI) : states[i].unit === 'm' ? rand(-1.2, 1.2) : rand(-8, 8);
      const u = rand(-40, 40);
      f(X, o, u, dX);
      REFERENCE[type](X.subarray(o), u, p, ref);
      const scale = Math.max(1, ...ref.map(Math.abs));
      for (let i = 0; i < n; i++) assert.ok(Math.abs(dX[o + i] - ref[i]) <= 1e-12 * scale, `${type} (${p.links ?? ''}) state ${states[i].name}: ${dX[o + i]} vs ${ref[i]}`);
    }
  }
  const label = (type, p) => ELEMENTS[type].ode.states(p).map((s) => `${s.name}${s.angle ? '∠' : ''}`).join(' ');
  assert.equal(label('cartPole', cases[0][1]), 'x v θ∠ ω');
  assert.equal(label('pendulumCart', cases[3][1]), 'x θ1∠ θ2∠ θ3∠ v ω1 ω2 ω3');
  assert.equal(label('conicalTank', cases[4][1]), 'h');
  assert.deepEqual(ELEMENTS.cartPole.ode.states(cases[0][1]).map((s) => s.unit), ['m', 'm/s', 'rad', 'rad/s']);
});
