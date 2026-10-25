// Math blocks on vector signals (design/output/robot.md §2): Matrix Gain,
// Product, Solve, Norm, Friction. Each is a block of vectors.js's kind:
// ports, widths and make (see vectors.js). A matrix travels row by row.
// vectors.js imports this file, so the few helpers it shares are copied here.

import { cholesky, cholSolve } from './rbd.js';

// A number, a list (a vector) or a list of rows (a matrix): its elements row
// by row and its shape ([] a number, [n] a list, [r, c] rows).
function parseValue(v, where) {
  const say = `${where}: a number, a list [1, 2] or rows [[1, 0], [0, 1]]`;
  if (typeof v === 'string' && v.trim().startsWith('[')) { try { v = JSON.parse(v); } catch { throw new Error(say); } }
  if (Array.isArray(v) && v.length && Array.isArray(v[0])) {
    const c = v[0].length;
    if (!c || !v.every((row) => Array.isArray(row) && row.length === c)) throw new Error(`${where}: every row needs ${c || 'some'} values`);
    const flat = v.flat().map(Number);
    if (!flat.every(Number.isFinite)) throw new Error(`${where}: numbers only`);
    return { value: flat, shape: [v.length, c] };
  }
  if (Array.isArray(v)) {
    const flat = v.map(Number);
    if (!flat.length || !flat.every(Number.isFinite)) throw new Error(`${where}: numbers only`);
    return { value: flat, shape: [flat.length] };
  }
  const x = Number(v);
  if (v === null || v === '' || !Number.isFinite(x)) throw new Error(say);
  return { value: [x], shape: [] };
}
// A parameter that is a number or a list of numbers, each at least min (above
// it when strict).
function numOrList(v, where, min, strict = false) {
  const list = Array.isArray(v) ? v.map(Number) : [Number(v)];
  if (!list.length || !list.every(Number.isFinite) || v === null || v === '') throw new Error(`${where}: a number or a list of numbers`);
  if (list.some((x) => (strict ? x <= min : x < min))) throw new Error(`${where}: ${strict ? 'above' : 'at least'} ${min}`);
  return Array.isArray(v) ? list : list[0];
}
const at = (v, i) => (typeof v === 'number' ? v : v[i]);
const plural = (n) => `${n} element${n === 1 ? '' : 's'}`;
const known = (inW) => inW.every((w) => w !== undefined);

// Matrix Gain's K as stored: a number, a list, or rows.
const asRows = ({ value, shape }) => (shape.length === 2 ? Array.from({ length: shape[0] }, (_, r) => value.slice(r * shape[1], (r + 1) * shape[1])) : shape.length === 1 ? value : value[0]);

const FRICTION_KEYS = ['B', 'Tcp', 'Tcn', 'ws'];

export const MATH_BLOCKS = {
  matrixGain: {
    label: 'Matrix Gain', group: 'Math', formula: 'y = K·u',
    params: [{ key: 'K', label: 'K', default: 1, kind: 'value', help: 'a number, a list [1, 2] (element by element) or rows [[1, 0], [0, 1]] (y = K·u)' }],
    inputs: () => ['u'], outputs: () => ['y'],
    normalize: (p, where) => ({ K: asRows(parseValue(p.K ?? 1, `${where}.K`)) }),
    ports: () => [1, 1],
    widths(p, inW, env) {
      const { value, shape } = parseValue(p.K, 'K'), w = inW[0];
      if (!shape.length) return w === undefined ? null : { ins: [w], outs: [w] };
      const [r, c] = shape.length === 2 ? shape : [value.length, value.length];
      // A width-1 input broadcasts to a list K's elements, not into a matrix's columns.
      if (w !== undefined && w !== c && !(w === 1 && shape.length === 1)) throw new Error(`${env.name}: K is ${shape.length === 2 ? `${r}×${c}` : `a list of ${c}`}, so it takes ${plural(c)}, but gets ${w}`);
      return { ins: [c], outs: [r] };
    },
    make(p) {
      const { value: K, shape } = parseValue(p.K, 'K');
      if (!shape.length) { const k = K[0]; return (u, y) => { for (let i = 0; i < y.length; i++) y[i] = k * u[i]; }; }
      if (shape.length === 1) return (u, y) => { for (let i = 0; i < y.length; i++) y[i] = K[i] * u[i]; };
      const [r, c] = shape;
      return (u, y) => { for (let i = 0; i < r; i++) { let s = 0; for (let j = 0; j < c; j++) s += K[i * c + j] * u[j]; y[i] = s; } };
    },
  },
  product: {
    label: 'Product', group: 'Math', formula: 'A·B',
    params: [{ key: 'inner', label: 'Inner size', default: 0, help: 'c: the columns of A and the rows of B; 0 means B\'s width (a matrix times a vector)' }],
    inputs: () => ['A', 'B'], outputs: () => ['A·B'],
    normalize(p, where) {
      const c = Number(p.inner ?? 0);
      if (!(Number.isInteger(c) && c >= 0 && c <= 4096)) throw new Error(`${where}.inner: a whole number, 0 (B's width) or more`);
      return { inner: c };
    },
    ports: () => [2, 1],
    widths(p, inW, env) {
      if (!known(inW)) return null;
      const [wA, wB] = inW, c = p.inner || wB;
      if (wA % c || wB % c) throw new Error(p.inner ? `${env.name}: A has ${plural(wA)} and B has ${wB}: the inner size ${c} must divide both` : `${env.name}: A has ${plural(wA)} but B has ${wB}: the inner sizes must agree (A is r×c, B is c×k)`);
      return { ins: [wA, wB], outs: [(wA / c) * (wB / c)] };
    },
    make(p, { inW }) {
      const [wA, wB] = inW, c = p.inner || wB, r = wA / c, k = wB / c;
      return (u, y) => {
        for (let i = 0; i < r; i++) for (let j = 0; j < k; j++) {
          let s = 0;
          for (let m = 0; m < c; m++) s += u[i * c + m] * u[wA + m * k + j];
          y[i * k + j] = s;
        }
      };
    },
  },
  solve: {
    label: 'Solve', group: 'Math', formula: 'A·x = b', params: [],
    inputs: () => ['A', 'b'], outputs: () => ['x'],
    normalize: () => ({}),
    ports: () => [2, 1],
    widths(p, inW, env) {
      const [wA, wB] = inW;
      if (wA === undefined) return null;
      const n = Math.round(Math.sqrt(wA));
      if (n * n !== wA) throw new Error(`${env.name}: A has ${plural(wA)}; it must be square (n×n)`);
      if (wB !== undefined && wB !== n && wB !== 1) throw new Error(`${env.name}: A is ${n}×${n}, so b needs ${plural(n)}, but it has ${wB}`);
      return { ins: [wA, n], outs: [n] };
    },
    make(p, { outW, name }) {
      const n = outW[0], L = new Float64Array(n * n), piv = new Int32Array(n);
      return (u, y, t) => {
        for (let i = 0; i < n * n; i++) L[i] = u[i];
        for (let i = 0; i < n; i++) y[i] = u[n * n + i];
        // Cholesky when A is symmetric (to rounding) and positive definite.
        let scale = 0, sym = true;
        for (let i = 0; i < n * n; i++) scale = Math.max(scale, Math.abs(L[i]));
        for (let i = 0; i < n && sym; i++) for (let j = 0; j < i; j++) if (Math.abs(L[i * n + j] - L[j * n + i]) > 1e-12 * scale) { sym = false; break; }
        if (sym && cholesky(L, n)) { cholSolve(L, n, y); return; }
        // Else LU with partial pivoting, on a fresh copy.
        for (let i = 0; i < n * n; i++) L[i] = u[i];
        for (let j = 0; j < n; j++) {
          let m = j;
          for (let i = j + 1; i < n; i++) if (Math.abs(L[i * n + j]) > Math.abs(L[m * n + j])) m = i;
          if (!(Math.abs(L[m * n + j]) > 1e-13 * n * scale)) throw new Error(`${name}: A is singular at t = ${t} s; the run stops here`);
          piv[j] = m;
          if (m !== j) for (let k = 0; k < n; k++) { const s = L[j * n + k]; L[j * n + k] = L[m * n + k]; L[m * n + k] = s; }
          for (let i = j + 1; i < n; i++) {
            const f = (L[i * n + j] /= L[j * n + j]);
            for (let k = j + 1; k < n; k++) L[i * n + k] -= f * L[j * n + k];
          }
        }
        for (let j = 0; j < n; j++) { const m = piv[j]; if (m !== j) { const s = y[j]; y[j] = y[m]; y[m] = s; } }
        for (let i = 1; i < n; i++) { let s = y[i]; for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k]; y[i] = s; }
        for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[i * n + k] * y[k]; y[i] = s / L[i * n + i]; }
      };
    },
  },
  norm: {
    label: 'Norm', group: 'Math', formula: '√Σu²', params: [],
    inputs: () => ['u'], outputs: () => ['‖u‖'],
    normalize: () => ({}),
    ports: () => [1, 1],
    widths: (p, inW) => (inW[0] === undefined ? null : { ins: [inW[0]], outs: [1] }),
    make: () => (u, y) => { let s = 0; for (let i = 0; i < u.length; i++) s += u[i] * u[i]; y[0] = Math.sqrt(s); },
  },
  friction: {
    label: 'Friction', group: 'Nonlinear', formula: 'B·ω + Tc·tanh(ω/ωs)',
    params: [
      { key: 'B', label: 'Viscous B', default: 0, unit: 'N·m·s/rad', help: 'a number, or one per element' },
      { key: 'Tcp', label: 'Coulomb Tc⁺', default: 0, unit: 'N·m', help: 'for ω ≥ 0; a magnitude' },
      { key: 'Tcn', label: 'Coulomb Tc⁻', default: 0, unit: 'N·m', help: 'for ω < 0; a magnitude' },
      { key: 'ws', label: 'Smoothing ωs', default: 1, unit: 'rad/s', help: 'the speed over which the Coulomb step is smoothed (tanh)' },
    ],
    inputs: () => ['ω'], outputs: () => ['τ_f'],
    normalize(p, where) {
      const out = {};
      for (const k of FRICTION_KEYS) out[k] = numOrList(p[k] ?? (k === 'ws' ? 1 : 0), `${where}.${k}`, 0, k === 'ws');
      const lens = new Set(FRICTION_KEYS.filter((k) => typeof out[k] !== 'number').map((k) => out[k].length));
      if (lens.size > 1) throw new Error(`${where}: the lists B, Tcp, Tcn and ws must have one length`);
      return out;
    },
    ports: () => [1, 1],
    widths(p, inW, env) {
      const list = FRICTION_KEYS.find((k) => typeof p[k] !== 'number'), n = list ? p[list].length : undefined, w = inW[0];
      if (w === undefined) return null;
      if (n !== undefined && w !== n && w !== 1) throw new Error(`${env.name}: ${list} has ${n} values but ω has ${w}`);
      return { ins: [n ?? w], outs: [n ?? w] };
    },
    make(p, { model, report, name }) {
      const { B, Tcp, Tcn, ws } = p;
      // In a model compile the linear part only: a Coulomb step has no slope at 0.
      if (model) {
        if ([Tcp, Tcn].some((v) => (typeof v === 'number' ? v : Math.max(...v)) > 0)) report(`${name}: the model keeps the viscous friction B·ω only; a Coulomb step has no slope at 0, and its smoothing's slope is an artefact`);
        return (u, y) => { for (let i = 0; i < y.length; i++) y[i] = at(B, i) * u[i]; };
      }
      // The same expression as rbd.js's jointFriction (with G = 1), bit for bit.
      return (u, y) => { for (let i = 0; i < y.length; i++) { const om = u[i]; y[i] = at(B, i) * om + (om >= 0 ? at(Tcp, i) : at(Tcn, i)) * Math.tanh(om / at(ws, i)); } };
    },
  },
};
