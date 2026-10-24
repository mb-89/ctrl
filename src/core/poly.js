// Polynomials (coefficients highest power first) and transfer-function to
// state-space conversion. Pure functions, no DOM: shared by browser and Node.

export function polyTrim(p) {
  let i = 0;
  while (i < p.length - 1 && p[i] === 0) i++;
  return p.slice(i);
}

export function polyMul(a, b) {
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  return out;
}

export function polyPow(p, n) {
  let out = [1];
  for (let i = 0; i < n; i++) out = polyMul(out, p);
  return out;
}

// Controllable canonical form of num(s)/den(s). Requires a proper transfer
// function (deg num <= deg den). Returns flat row-major A.
export function tf2ss(numIn, denIn) {
  const den = polyTrim(denIn.map(Number));
  let num = polyTrim(numIn.map(Number));
  if (den.length === 0 || den[0] === 0) throw new Error('denominator must be non-zero');
  if (num.length > den.length) throw new Error(`improper transfer function: deg num ${num.length - 1} > deg den ${den.length - 1}`);
  const n = den.length - 1;
  const a0 = den[0];
  const a = den.map((c) => c / a0);
  const b = new Array(n + 1 - num.length).fill(0).concat(num.map((c) => c / a0));
  const D = b[0];
  const A = new Float64Array(n * n);
  const B = new Float64Array(n);
  const C = new Float64Array(n);
  for (let j = 0; j < n; j++) A[j] = -a[j + 1];
  for (let i = 1; i < n; i++) A[i * n + i - 1] = 1;
  if (n > 0) B[0] = 1;
  for (let j = 0; j < n; j++) C[j] = b[j + 1] - a[j + 1] * D;
  return { n, A, B, C, D };
}

// Upper bound on the magnitude of the roots of den (Fujiwara). Used to pick a
// stable integration step without solving for the poles.
export function rootBound(denIn) {
  const den = polyTrim(denIn.map(Number));
  const n = den.length - 1;
  if (n <= 0) return 0;
  let m = 0;
  for (let i = 1; i <= n; i++) {
    let c = Math.abs(den[i] / den[0]);
    if (i === n) c /= 2;
    m = Math.max(m, Math.pow(c, 1 / i));
  }
  return 2 * m;
}

// Steady-state gain num(0)/den(0); Infinity for an integrator.
export function dcGain(num, den) {
  const n0 = num[num.length - 1] ?? 0;
  const d0 = den[den.length - 1] ?? 0;
  return d0 === 0 ? (n0 === 0 ? NaN : Infinity) : n0 / d0;
}
