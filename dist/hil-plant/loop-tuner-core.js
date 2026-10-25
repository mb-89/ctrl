(() => {
'use strict';
if (typeof structuredClone !== 'function') globalThis.structuredClone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const __mods = {};
// ---- core/poly.js
__mods['core/poly.js'] = (() => {

function polyTrim(p) {
  let i = 0;
  while (i < p.length - 1 && p[i] === 0) i++;
  return p.slice(i);
}

function polyMul(a, b) {
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  return out;
}

function polyPow(p, n) {
  let out = [1];
  for (let i = 0; i < n; i++) out = polyMul(out, p);
  return out;
}

function tf2ss(numIn, denIn) {
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

function rootBound(denIn) {
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

function dcGain(num, den) {
  const n0 = num[num.length - 1] ?? 0;
  const d0 = den[den.length - 1] ?? 0;
  return d0 === 0 ? (n0 === 0 ? NaN : Infinity) : n0 / d0;
}

return { polyTrim, polyMul, polyPow, tf2ss, rootBound, dcGain };
})();
// ---- core/linalg.js
__mods['core/linalg.js'] = (() => {

const EPS = Number.EPSILON;
const DEG = 180 / Math.PI;


const isVector = (x) => x.length === 0 || typeof x[0] === 'number';

function square(A, who) {
  if (!Array.isArray(A) || !A.every((r) => r && r.length === A.length)) throw new Error(`${who}: expected a square matrix (an array of rows)`);
  return A.length;
}

function asCol(B, n, who) {
  const M = isVector(B) ? Array.from(B, (v) => [v]) : B;
  if (M.length !== n) throw new Error(`${who}: B must have ${n} rows`);
  return M;
}

function asRow(C, n, who) {
  const M = isVector(C) ? [Array.from(C)] : C;
  if (M.some((r) => r.length !== n)) throw new Error(`${who}: C must have ${n} columns`);
  return M;
}

const asMat = (R) => (typeof R === 'number' ? [[R]] : R);
const sym = (P) => P.map((r, i) => r.map((v, j) => (v + P[j][i]) / 2));
const maxAbs = (A) => A.reduce((m, r) => r.reduce((m2, v) => Math.max(m2, Math.abs(v)), m), 0);
const finite = (A) => A.every((r) => r.every(Number.isFinite));
const norm1 = (A) => (A.length ? Math.max(...A[0].map((_, j) => A.reduce((s, r) => s + Math.abs(r[j]), 0))) : 0);
const cabs = (z) => Math.hypot(z.re, z.im);
const wrap180 = (d) => d - 360 * Math.ceil((d - 180) / 360);


const zeros = (r, c = r) => Array.from({ length: r }, () => new Array(c).fill(0));

function eye(n) {
  const I = zeros(n, n);
  for (let i = 0; i < n; i++) I[i][i] = 1;
  return I;
}

function mul(A, B) {
  const k = B.length;
  if (A.some((r) => r.length !== k)) throw new Error(`mul: inner dimensions differ (${A[0].length} and ${k})`);
  if (isVector(B)) return A.map((row) => row.reduce((s, a, j) => s + a * B[j], 0));
  const m = B[0].length;
  return A.map((row) => {
    const out = new Array(m).fill(0);
    for (let j = 0; j < k; j++) {
      const a = row[j], Bj = B[j];
      for (let c = 0; c < m; c++) out[c] += a * Bj[c];
    }
    return out;
  });
}

function add(A, B, s = 1) {
  if (A.length !== B.length) throw new Error('add: shapes differ');
  return A.map((a, i) => (typeof a === 'number' ? a + s * B[i] : a.map((x, j) => x + s * B[i][j])));
}

const scale = (A, s) => A.map((a) => (typeof a === 'number' ? a * s : a.map((x) => x * s)));

const transpose = (A) => (A.length ? Array.from(A[0], (_, j) => A.map((r) => r[j])) : []);

function lu(A) {
  const n = A.length;
  const M = A.map((r) => Array.from(r));
  const perm = [...Array(n).keys()];
  let sign = 1;
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
    if (p !== k) {
      [M[k], M[p]] = [M[p], M[k]];
      [perm[k], perm[p]] = [perm[p], perm[k]];
      sign = -sign;
    }
    const piv = M[k][k];
    if (piv === 0) return { M, perm, sign, singular: true };
    for (let i = k + 1; i < n; i++) {
      const f = (M[i][k] /= piv);
      if (f !== 0) for (let j = k + 1; j < n; j++) M[i][j] -= f * M[k][j];
    }
  }
  return { M, perm, sign, singular: false };
}

function solve(A, b) {
  const n = square(A, 'solve');
  if (b.length !== n) throw new Error(`solve: right-hand side must have ${n} rows`);
  const vec = isVector(b);
  const { M, perm, singular } = lu(A);
  if (singular) throw new Error('solve: matrix is singular');
  const X = perm.map((i) => (vec ? [b[i]] : Array.from(b[i])));
  const m = n ? X[0].length : 0;
  for (let i = 1; i < n; i++) {
    for (let k = 0; k < i; k++) {
      const f = M[i][k];
      if (f !== 0) for (let j = 0; j < m; j++) X[i][j] -= f * X[k][j];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    for (let k = i + 1; k < n; k++) {
      const f = M[i][k];
      if (f !== 0) for (let j = 0; j < m; j++) X[i][j] -= f * X[k][j];
    }
    for (let j = 0; j < m; j++) X[i][j] /= M[i][i];
  }
  return vec ? X.map((r) => r[0]) : X;
}

const inv = (A) => solve(A, eye(square(A, 'inv')));

function det(A) {
  square(A, 'det');
  const { M, sign, singular } = lu(A);
  return singular ? 0 : M.reduce((d, r, i) => d * r[i], sign);
}


const PADE13 = [64764752532480000, 32382376266240000, 7771770303897600, 1187353796428800, 129060195264000, 10559470521600, 670442572800, 33522128640, 1323241920, 40840800, 960960, 16380, 182, 1];
const THETA13 = 5.371920351148152;

function expm(A) {
  const n = square(A, 'expm');
  if (n === 0) return [];
  const nrm = norm1(A);
  if (!Number.isFinite(nrm)) throw new Error('expm: matrix has non-finite entries');
  const s = nrm > THETA13 ? Math.ceil(Math.log2(nrm / THETA13)) : 0;
  const b = PADE13;
  const X = scale(A, 2 ** -s);
  const X2 = mul(X, X), X4 = mul(X2, X2), X6 = mul(X4, X2), I = eye(n);
  const lin = (cs, Ms) => Ms.reduce((acc, M, i) => add(acc, M, cs[i]), zeros(n, n));
  const U = mul(X, add(mul(X6, lin([b[13], b[11], b[9]], [X6, X4, X2])), lin([b[7], b[5], b[3], b[1]], [X6, X4, X2, I])));
  const V = add(mul(X6, lin([b[12], b[10], b[8]], [X6, X4, X2])), lin([b[6], b[4], b[2], b[0]], [X6, X4, X2, I]));
  let E = solve(add(V, U, -1), add(V, U));
  for (let i = 0; i < s; i++) E = mul(E, E);
  return E;
}

function c2d(A, B, Ts) {
  const n = square(A, 'c2d');
  const Bm = asCol(B, n, 'c2d');
  const m = n ? Bm[0].length : 0;
  const M = zeros(n + m, n + m);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) M[i][j] = A[i][j] * Ts;
    for (let j = 0; j < m; j++) M[i][n + j] = Bm[i][j] * Ts;
  }
  const E = expm(M);
  return { Ad: E.slice(0, n).map((r) => r.slice(0, n)), Bd: E.slice(0, n).map((r) => r.slice(n)) };
}


function balance(a) {
  const n = a.length;
  const d = new Array(n).fill(1);
  let done = false;
  while (!done) {
    done = true;
    for (let i = 0; i < n; i++) {
      let r = 0, c = 0;
      for (let j = 0; j < n; j++) {
        if (j !== i) {
          c += Math.abs(a[j][i]);
          r += Math.abs(a[i][j]);
        }
      }
      if (c === 0 || r === 0 || !Number.isFinite(c + r)) continue;
      const s = c + r;
      let f = 1, g = r / 2;
      while (c < g) { f *= 2; c *= 4; }
      g = r * 2;
      while (c > g) { f /= 2; c /= 4; }
      if ((c + r) / f < 0.95 * s) {
        done = false;
        d[i] *= f;
        for (let j = 0; j < n; j++) a[i][j] /= f;
        for (let j = 0; j < n; j++) a[j][i] *= f;
      }
    }
  }
  return d;
}

function hessenberg(a) {
  const n = a.length;
  for (let m = 1; m < n - 1; m++) {
    let x = 0, p = m;
    for (let j = m; j < n; j++) if (Math.abs(a[j][m - 1]) > Math.abs(x)) { x = a[j][m - 1]; p = j; }
    if (p !== m) {
      for (let j = m - 1; j < n; j++) [a[p][j], a[m][j]] = [a[m][j], a[p][j]];
      for (let j = 0; j < n; j++) [a[j][p], a[j][m]] = [a[j][m], a[j][p]];
    }
    if (x === 0) continue;
    for (let i = m + 1; i < n; i++) {
      const y = a[i][m - 1] / x;
      if (y === 0) continue;
      a[i][m - 1] = 0;
      for (let j = m; j < n; j++) a[i][j] -= y * a[m][j];
      for (let j = 0; j < n; j++) a[j][m] += y * a[j][i];
    }
  }
}

const HQR_MAXITS = 100;

function hqr(a) {
  const n = a.length;
  const out = new Array(n);
  let anorm = 0;
  for (let i = 0; i < n; i++) for (let j = Math.max(i - 1, 0); j < n; j++) anorm += Math.abs(a[i][j]);
  let nn = n - 1, t = 0;
  let p = 0, q = 0, r = 0, s, w, x, y, z;
  while (nn >= 0) {
    let its = 0, l;
    do {
      for (l = nn; l > 0; l--) {
        s = Math.abs(a[l - 1][l - 1]) + Math.abs(a[l][l]);
        if (s === 0) s = anorm;
        if (Math.abs(a[l][l - 1]) <= EPS * s) { a[l][l - 1] = 0; break; }
      }
      x = a[nn][nn];
      if (l === nn) {
        out[nn--] = { re: x + t, im: 0 };
      } else {
        y = a[nn - 1][nn - 1];
        w = a[nn][nn - 1] * a[nn - 1][nn];
        if (l === nn - 1) {
          p = 0.5 * (y - x);
          q = p * p + w;
          z = Math.sqrt(Math.abs(q));
          x += t;
          if (q >= 0) {
            z = p + (p >= 0 ? z : -z);
            out[nn - 1] = { re: x + z, im: 0 };
            out[nn] = { re: z !== 0 ? x - w / z : x + z, im: 0 };
          } else {
            out[nn - 1] = { re: x + p, im: z };
            out[nn] = { re: x + p, im: -z };
          }
          nn -= 2;
        } else {
          if (its === HQR_MAXITS) throw new Error('eig: QR iteration did not converge');
          if (its > 0 && its % 10 === 0) {
            t += x;
            for (let i = 0; i <= nn; i++) a[i][i] -= x;
            s = Math.abs(a[nn][nn - 1]) + Math.abs(a[nn - 1][nn - 2]);
            y = x = 0.75 * s;
            w = -0.4375 * s * s;
          }
          ++its;
          let m;
          for (m = nn - 2; m >= l; m--) {
            z = a[m][m];
            r = x - z;
            s = y - z;
            p = (r * s - w) / a[m + 1][m] + a[m][m + 1];
            q = a[m + 1][m + 1] - z - r - s;
            r = a[m + 2][m + 1];
            s = Math.abs(p) + Math.abs(q) + Math.abs(r);
            p /= s; q /= s; r /= s;
            if (m === l) break;
            const u = Math.abs(a[m][m - 1]) * (Math.abs(q) + Math.abs(r));
            const v = Math.abs(p) * (Math.abs(a[m - 1][m - 1]) + Math.abs(z) + Math.abs(a[m + 1][m + 1]));
            if (u <= EPS * v) break;
          }
          for (let i = m; i < nn - 1; i++) {
            a[i + 2][i] = 0;
            if (i !== m) a[i + 2][i - 1] = 0;
          }
          for (let k = m; k < nn; k++) {
            if (k !== m) {
              p = a[k][k - 1];
              q = a[k + 1][k - 1];
              r = k + 1 !== nn ? a[k + 2][k - 1] : 0;
              if ((x = Math.abs(p) + Math.abs(q) + Math.abs(r)) !== 0) { p /= x; q /= x; r /= x; }
            }
            s = Math.sqrt(p * p + q * q + r * r);
            if (p < 0) s = -s;
            if (s === 0) continue;
            if (k === m) {
              if (l !== m) a[k][k - 1] = -a[k][k - 1];
            } else a[k][k - 1] = -s * x;
            p += s;
            x = p / s; y = q / s; z = r / s;
            q /= p; r /= p;
            for (let j = k; j <= nn; j++) {
              p = a[k][j] + q * a[k + 1][j];
              if (k + 1 !== nn) { p += r * a[k + 2][j]; a[k + 2][j] -= p * z; }
              a[k + 1][j] -= p * y;
              a[k][j] -= p * x;
            }
            const mmin = nn < k + 3 ? nn : k + 3;
            for (let i = l; i <= mmin; i++) {
              p = x * a[i][k] + y * a[i][k + 1];
              if (k + 1 !== nn) { p += z * a[i][k + 2]; a[i][k + 2] -= p * r; }
              a[i][k + 1] -= p * q;
              a[i][k] -= p;
            }
          }
        }
      }
    } while (l + 1 < nn);
  }
  return out;
}

const byRealThenImag = (a, b) => b.re - a.re || b.im - a.im;

function eig(A) {
  const n = square(A, 'eig');
  const a = A.map((r) => Array.from(r));
  if (!finite(a)) throw new Error('eig: matrix has non-finite entries');
  if (n === 0) return [];
  balance(a);
  hessenberg(a);
  return hqr(a).sort(byRealThenImag);
}

function eigPerturbed(A, rel = 1024 * EPS) {
  const n = square(A, 'eigPerturbed');
  const a = A.map((r) => Array.from(r));
  if (!finite(a)) throw new Error('eigPerturbed: matrix has non-finite entries');
  if (n === 0) return [];
  balance(a);
  const s = rel * maxAbs(a);
  let seed = 0x2545f491;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 2147483648 - 1; };
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) a[i][j] += s * rnd();
  hessenberg(a);
  return hqr(a).sort(byRealThenImag);
}


function dareSDA(A, B, Q, R, tol) {
  const n = A.length, I = eye(n);
  let G;
  try { G = sym(mul(B, solve(R, transpose(B)))); } catch { return null; }
  let Ak = A, H = sym(Q);
  for (let k = 1; k <= 64; k++) {
    let X;
    try { X = solve(add(I, mul(G, H)), Ak.map((row, i) => row.concat(G[i]))); } catch { return null; }
    const WA = X.map((r) => r.slice(0, n)), WG = X.map((r) => r.slice(n));
    const Hn = sym(add(H, mul(transpose(Ak), mul(H, WA))));
    G = sym(add(G, mul(Ak, mul(WG, transpose(Ak)))));
    Ak = mul(Ak, WA);
    if (!finite(Hn)) return null;
    const done = maxAbs(add(Hn, H, -1)) <= tol * maxAbs(Hn);
    H = Hn;
    if (done) return { P: H, converged: true, iterations: k };
  }
  return null;
}

function dareIteration(A, B, Q, R, tol, maxIter) {
  const At = transpose(A), Bt = transpose(B);
  let P = sym(Q);
  for (let k = 1; k <= maxIter; k++) {
    const PA = mul(P, A), PB = mul(P, B);
    const K = solve(add(R, mul(Bt, PB)), mul(Bt, PA));
    const Pn = sym(add(add(mul(At, PA), mul(mul(At, PB), K), -1), Q));
    const done = maxAbs(add(Pn, P, -1)) <= tol * maxAbs(Pn);
    P = Pn;
    if (done) return { P, converged: true, iterations: k };
    if (!finite(P)) return { P, converged: false, iterations: k };
  }
  return { P, converged: false, iterations: maxIter };
}

const lqrGain = (A, B, R, P) => {
  const Bt = transpose(B);
  return solve(add(R, mul(Bt, mul(P, B))), mul(Bt, mul(P, A)));
};

const spectralRadius = (A) => eig(A).reduce((m, z) => Math.max(m, cabs(z)), 0);

function dare(A, B, Q, R, { method = 'auto', tol = 1e-12, maxIter = 100000 } = {}) {
  const n = square(A, 'dare');
  const Bm = asCol(B, n, 'dare'), Rm = asMat(R);
  if (method !== 'iteration') {
    const r = dareSDA(A, Bm, Q, Rm, tol);
    if (r && spectralRadius(add(A, mul(Bm, lqrGain(A, Bm, Rm, r.P)), -1)) < 1) return { ...r, method: 'sda' };
  }
  return { ...dareIteration(A, Bm, Q, Rm, tol, maxIter), method: 'iteration' };
}

function dlqr(Ad, Bd, Q, R) {
  const n = square(Ad, 'dlqr');
  const B = asCol(Bd, n, 'dlqr'), Rm = asMat(R);
  const { P, converged } = dare(Ad, B, Q, Rm);
  return { K: lqrGain(Ad, B, Rm, P), P, converged };
}

function dlqe(Ad, C, Qw, Rv) {
  const n = square(Ad, 'dlqe');
  const Cm = asRow(C, n, 'dlqe'), Rm = asMat(Rv);
  const { P, converged } = dare(transpose(Ad), transpose(Cm), Qw, Rm);
  const CP = mul(Cm, P);
  const L = transpose(solve(add(Rm, mul(CP, transpose(Cm))), CP));
  return { L, P, converged };
}


function siso(sys, who) {
  const A = sys.A ?? [];
  const n = square(A, who);
  const B = sys.B ?? [], C = sys.C ?? [];
  const b = isVector(B) ? Array.from(B) : B.map((r) => {
    if (r.length !== 1) throw new Error(`${who}: B must be n×1 (one input)`);
    return r[0];
  });
  const c = isVector(C) ? Array.from(C) : C.length === 1 ? Array.from(C[0]) : null;
  if (!c) throw new Error(`${who}: C must be 1×n (one output)`);
  if (b.length !== n || c.length !== n) throw new Error(`${who}: B and C must have ${n} entries`);
  const D = sys.D ?? 0;
  const d = typeof D === 'number' ? D : isVector(D) ? D[0] ?? 0 : D[0]?.[0] ?? 0;
  return { A, b, c, d };
}

function csolve(Mr, Mi, br, bi) {
  const n = Mr.length;
  for (let k = 0; k < n; k++) {
    let p = k, best = -1;
    for (let i = k; i < n; i++) {
      const a = Math.abs(Mr[i][k]) + Math.abs(Mi[i][k]);
      if (a > best) { best = a; p = i; }
    }
    if (best === 0) return null;
    [Mr[k], Mr[p]] = [Mr[p], Mr[k]]; [Mi[k], Mi[p]] = [Mi[p], Mi[k]];
    [br[k], br[p]] = [br[p], br[k]]; [bi[k], bi[p]] = [bi[p], bi[k]];
    const pr = Mr[k][k], pi = Mi[k][k], d = pr * pr + pi * pi;
    for (let i = k + 1; i < n; i++) {
      const ar = Mr[i][k], ai = Mi[i][k];
      if (ar === 0 && ai === 0) continue;
      const fr = (ar * pr + ai * pi) / d, fi = (ai * pr - ar * pi) / d;
      for (let j = k + 1; j < n; j++) {
        const ur = Mr[k][j], ui = Mi[k][j];
        Mr[i][j] -= fr * ur - fi * ui;
        Mi[i][j] -= fr * ui + fi * ur;
      }
      br[i] -= fr * br[k] - fi * bi[k];
      bi[i] -= fr * bi[k] + fi * br[k];
    }
  }
  const xr = new Array(n), xi = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sr = br[i], si = bi[i];
    for (let j = i + 1; j < n; j++) {
      sr -= Mr[i][j] * xr[j] - Mi[i][j] * xi[j];
      si -= Mr[i][j] * xi[j] + Mi[i][j] * xr[j];
    }
    const pr = Mr[i][i], pi = Mi[i][i], d = pr * pr + pi * pi;
    xr[i] = (sr * pr + si * pi) / d;
    xi[i] = (si * pr - sr * pi) / d;
  }
  return { xr, xi };
}

function respond({ A, b, c, d }, w) {
  const n = A.length;
  const x = csolve(A.map((r) => r.map((v) => -v)), A.map((r, i) => r.map((_, j) => (i === j ? w : 0))), b.slice(), new Array(n).fill(0));
  if (!x) throw new Error(`freqResp: jw = ${w}j is a pole of the system`);
  let re = d, im = 0;
  for (let i = 0; i < n; i++) { re += c[i] * x.xr[i]; im += c[i] * x.xi[i]; }
  return { re, im };
}

const freqResp = (sys, w) => respond(siso(sys, 'freqResp'), w);

function unwrapPhase(s, ws, G) {
  const out = [];
  for (let k = 0; k < G.length; k++) {
    const ph = Math.atan2(G[k].im, G[k].re) * DEG;
    if (k > 0) { out.push(out[k - 1] + wrap180(ph - out[k - 1])); continue; }
    let target = 0;
    if (ws[0] > 0) {
      const slope = Math.log10(cabs(respond(s, ws[0] * 1.01)) / cabs(G[0])) / Math.log10(1.01);
      if (Number.isFinite(slope)) target = 90 * Math.round(slope);
    }
    out.push(ph + 360 * Math.round((target - ph) / 360));
  }
  return out;
}

function bode(sys, ws) {
  const s = siso(sys, 'bode');
  const G = ws.map((w) => respond(s, w));
  const mag = G.map(cabs);
  return { w: ws.slice(), mag, magDb: mag.map((m) => 20 * Math.log10(m)), phaseDeg: unwrapPhase(s, ws, G) };
}

const logspace = (a, b, n = 50) => Array.from({ length: n }, (_, i) => 10 ** (n === 1 ? a : a + ((b - a) * i) / (n - 1)));

const crosses = (f1, f2) => Math.min(f1, f2) < 0 && Math.max(f1, f2) >= 0;

function bisect(f, a, b, fa, fb) {
  if (fa === 0) return a;
  if (fb === 0) return b;
  const mid = (u, v) => (u > 0 ? Math.sqrt(u) * Math.sqrt(v) : (u + v) / 2);
  for (let i = 0; i < 200 && b - a > 4 * EPS * Math.abs(b); i++) {
    const m = mid(a, b), fm = f(m);
    if (fm === 0) return m;
    if (fm < 0 === fa < 0) { a = m; fa = fm; } else b = m;
  }
  return mid(a, b);
}

function margins(sys, ws) {
  const s = siso(sys, 'margins');
  if (!ws.length) throw new Error('margins: empty frequency grid');
  const L = (w) => respond(s, w);
  const G = ws.map(L);
  const phase = unwrapPhase(s, ws, G);
  const logMag = G.map((g) => Math.log(cabs(g)));

  const gainCrossings = [], phaseCrossings = [];
  for (let k = 0; k + 1 < ws.length; k++) {
    if (crosses(logMag[k], logMag[k + 1])) {
      const w = bisect((v) => Math.log(cabs(L(v))), ws[k], ws[k + 1], logMag[k], logMag[k + 1]);
      const g = L(w);
      gainCrossings.push({ w, pm: Math.atan2(-g.im, -g.re) * DEG });
    }
    const theta = -180 + 360 * Math.floor((Math.max(phase[k], phase[k + 1]) + 180) / 360);
    if (crosses(phase[k] - theta, phase[k + 1] - theta)) {
      const g = (v) => { const z = L(v); return wrap180(Math.atan2(z.im, z.re) * DEG - theta); };
      const w = bisect(g, ws[k], ws[k + 1], phase[k] - theta, phase[k + 1] - theta);
      const gm = 1 / cabs(L(w));
      phaseCrossings.push({ w, gm, gmDb: 20 * Math.log10(gm) });
    }
  }
  const pick = (list, key) => list.reduce((best, c) => (best && Math.abs(best[key]) <= Math.abs(c[key]) ? best : c), null);
  const gc = pick(gainCrossings, 'pm'), pc = pick(phaseCrossings, 'gmDb');

  const sens = (w) => { const z = L(w); return 1 / Math.hypot(1 + z.re, z.im); };
  let kMax = 0;
  const S = G.map((z) => 1 / Math.hypot(1 + z.re, z.im));
  S.forEach((v, k) => { if (v > S[kMax]) kMax = k; });
  let ms = S[kMax], wMs = ws[kMax];
  if (ws.length > 1 && Number.isFinite(ms)) {
    const lo = ws[Math.max(kMax - 1, 0)], hi = ws[Math.min(kMax + 1, ws.length - 1)];
    const logs = lo > 0;
    const to = (u) => (logs ? Math.log(u) : u), from = (u) => (logs ? Math.exp(u) : u);
    const gr = (Math.sqrt(5) - 1) / 2;
    let a = to(lo), b = to(hi);
    let c = b - gr * (b - a), d = a + gr * (b - a), fc = sens(from(c)), fd = sens(from(d));
    for (let i = 0; i < 100 && b - a > 1e-12 * Math.max(1, Math.abs(a)); i++) {
      if (fc > fd) { b = d; d = c; fd = fc; c = b - gr * (b - a); fc = sens(from(c)); }
      else { a = c; c = d; fc = fd; d = a + gr * (b - a); fd = sens(from(d)); }
    }
    const wBest = from((a + b) / 2), sBest = sens(wBest);
    if (sBest > ms) { ms = sBest; wMs = wBest; }
  }

  return {
    wc: gc ? gc.w : NaN, pm: gc ? gc.pm : Infinity,
    w180: pc ? pc.w : NaN, gm: pc ? pc.gm : Infinity, gmDb: pc ? pc.gmDb : Infinity,
    ms, wMs, gainCrossings, phaseCrossings,
  };
}


function rootLocus(sys, ks) {
  const { A, b, c, d } = siso(sys, 'rootLocus');
  return ks.map((k) => {
    const den = 1 + k * d;
    if (den === 0) return [];
    const g = k / den;
    return eig(A.map((row, i) => row.map((v, j) => v - g * b[i] * c[j])));
  });
}

const TZ_TOL = 1e-9;

function tzeros(sys) {
  let { A, b, c, d } = siso(sys, 'tzeros');
  A = A.map((r) => Array.from(r));
  const D = balance(A);
  b = b.map((v, i) => v / D[i]);
  c = c.map((v, j) => v * D[j]);
  const norm2 = (v) => Math.hypot(...v);
  const b0 = norm2(b);
  let cErr = norm2(c);
  for (let n = A.length; ; n--) {
    if (d !== 0) return eig(A.map((row, i) => row.map((v, j) => v - (b[i] * c[j]) / d)));
    const cn = norm2(c), bn = norm2(b);
    if (n === 0 || cn <= TZ_TOL * cErr || bn <= TZ_TOL * b0) return [];
    const alpha = c[n - 1] > 0 ? -cn : cn;
    const v = c.slice();
    v[n - 1] -= alpha;
    const vv = v.reduce((s, x) => s + x * x, 0);
    const reflect = (x) => { const f = (2 * x.reduce((s, xi, i) => s + xi * v[i], 0)) / vv; return x.map((xi, i) => xi - f * v[i]); };
    const HA = transpose(transpose(A).map(reflect));
    const HAH = HA.map(reflect);
    const Hb = reflect(b);
    const b2 = Hb[n - 1];
    d = Math.abs(b2) > TZ_TOL * bn * (cErr / cn) ? b2 : 0;
    cErr = Math.sqrt(HAH.reduce((s, r) => s + r.reduce((s2, x) => s2 + x * x, 0), 0));
    c = HAH[n - 1].slice(0, n - 1);
    A = HAH.slice(0, n - 1).map((r) => r.slice(0, n - 1));
    b = Hb.slice(0, n - 1);
  }
}


function ctrb(A, B) {
  const n = square(A, 'ctrb');
  const Bm = asCol(B, n, 'ctrb');
  const blocks = [Bm];
  for (let i = 1; i < n; i++) blocks.push(mul(A, blocks[i - 1]));
  return Bm.map((_, i) => blocks.flatMap((M) => M[i]));
}

function equilibrate(M) {
  const m = M.length, n = m ? M[0].length : 0;
  const S = M.map((row) => Array.from(row)), r = new Array(m).fill(1), c = new Array(n).fill(1);
  const pow2 = (v) => 2 ** -Math.ceil(Math.log2(v));
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < m; i++) {
      let a = 0;
      for (let j = 0; j < n; j++) a = Math.max(a, Math.abs(S[i][j]));
      if (!(a > 0 && Number.isFinite(a))) continue;
      const f = pow2(a);
      r[i] *= f;
      for (let j = 0; j < n; j++) S[i][j] *= f;
    }
    for (let j = 0; j < n; j++) {
      let a = 0;
      for (let i = 0; i < m; i++) a = Math.max(a, Math.abs(S[i][j]));
      if (!(a > 0 && Number.isFinite(a))) continue;
      const f = pow2(a);
      c[j] *= f;
      for (let i = 0; i < m; i++) S[i][j] *= f;
    }
  }
  return { M: S, r, c };
}

function krylov(M, v, tol) {
  const n = M.length, Q = [];
  const norm = (w) => Math.hypot(...w);
  let size = 0;
  for (const row of M) for (const x of row) size += x * x;
  size = Math.sqrt(size);
  const v0 = norm(v);
  if (!(v0 > 0)) return Q;
  Q.push(v.map((x) => x / v0));
  while (Q.length < n) {
    const q = Q.at(-1);
    const w = M.map((row) => row.reduce((s, x, j) => s + x * q[j], 0));
    for (let pass = 0; pass < 2; pass++) {
      for (const b of Q) {
        const s = b.reduce((t, x, i) => t + x * w[i], 0);
        for (let i = 0; i < n; i++) w[i] -= s * b[i];
      }
    }
    const h = norm(w);
    if (!(h > tol * size)) break;
    Q.push(w.map((x) => x / h));
  }
  return Q;
}

function minreal(A, b, c, tol = 1e-8) {
  const n = square(A, 'minreal');
  if (!n) return { A: [], b: [], c: [] };
  const a = A.map((row) => Array.from(row));
  const d = balance(a);
  const project = (M, v, w, Q) => ({
    A: Q.map((p) => Q.map((q) => p.reduce((s, x, i) => s + x * M[i].reduce((t, y, j) => t + y * q[j], 0), 0))),
    b: Q.map((p) => p.reduce((s, x, i) => s + x * v[i], 0)),
    c: Q.map((q) => q.reduce((s, x, i) => s + x * w[i], 0)),
  });
  const ctl = project(a, b.map((v, i) => v / d[i]), c.map((v, i) => v * d[i]), krylov(a, b.map((v, i) => v / d[i]), tol));
  const r = ctl.A.length;
  if (!r) return ctl;
  const At = ctl.A.map((_, i) => ctl.A.map((row) => row[i]));
  return project(ctl.A, ctl.b, ctl.c, krylov(At, ctl.c, tol));
}

function rank(M, tol) {
  const m = M.length, n = m ? M[0].length : 0;
  if (!m || !n) return 0;
  const R = M.map((r) => Array.from(r));
  const colNorm2 = (j, k) => { let s = 0; for (let i = k; i < m; i++) s += R[i][j] * R[i][j]; return s; };
  const diag = [];
  for (let k = 0; k < Math.min(m, n); k++) {
    let p = k, best = -1;
    for (let j = k; j < n; j++) { const s = colNorm2(j, k); if (s > best) { best = s; p = j; } }
    for (const row of R) [row[k], row[p]] = [row[p], row[k]];
    const norm = Math.sqrt(best);
    diag.push(norm);
    if (norm === 0) break;
    const alpha = R[k][k] > 0 ? -norm : norm;
    const v = R.map((r, i) => (i < k ? 0 : r[k]));
    v[k] -= alpha;
    const vv = v.reduce((s, x) => s + x * x, 0);
    for (let j = k; j < n; j++) {
      let s = 0;
      for (let i = k; i < m; i++) s += v[i] * R[i][j];
      const f = (2 * s) / vv;
      for (let i = k; i < m; i++) R[i][j] -= f * v[i];
    }
  }
  const t = tol ?? Math.max(m, n) * EPS * diag[0];
  return diag.filter((x) => x > t).length;
}

return { zeros, eye, mul, add, scale, transpose, solve, inv, det, expm, c2d, balance, eig, eigPerturbed, dare, dlqr, dlqe, csolve, freqResp, bode, logspace, margins, rootLocus, tzeros, ctrb, equilibrate, minreal, rank };
})();
// ---- core/scale.js
__mods['core/scale.js'] = (() => {

function ceil125(v) {
  const e = Math.floor(Math.log10(v));
  for (let k = e; k <= e + 1; k++) for (const m of [1, 2, 5]) { const c = Number((m * 10 ** k).toPrecision(3)); if (c >= v * (1 - 1e-9)) return c; }
  return 10 ** (e + 1);
}

function step125(v, dir) {
  const e = Math.floor(Math.log10(v));
  const ladder = [];
  for (let k = e - 1; k <= e + 1; k++) for (const m of [1, 2, 5]) ladder.push(Number((m * 10 ** k).toPrecision(3)));
  let i = 0;
  for (let j = 0; j < ladder.length; j++) if (Math.abs(Math.log(ladder[j] / v)) < Math.abs(Math.log(ladder[i] / v))) i = j;
  return ladder[Math.max(0, Math.min(ladder.length - 1, i + dir))];
}

const PREFIXES = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']];

function si(v, digits = 3) {
  if (v === 0) return '0 ';
  if (!Number.isFinite(v)) return '— ';
  const a = Math.abs(v);
  const [f, p] = PREFIXES.find(([f]) => a >= f * 0.9995) ?? PREFIXES[PREFIXES.length - 1];
  return `${Number((v / f).toPrecision(digits))} ${p}`;
}

function siUnit(v, unit, digits) {
  return `${si(v, digits)}${unit}`.replace(/ $/, '');
}

return { ceil125, step125, si, siUnit };
})();
// ---- core/speed.js
__mods['core/speed.js'] = (() => {

const SPEED_PRESETS = [0.1, 0.5, 1, 2, 5, 10, Infinity];
const AS_FAST = Infinity;

function parseSpeed(v) {
  if (typeof v === 'number') {
    if (v === -1 || v === Infinity) return AS_FAST;
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  if (typeof v !== 'string') return null;
  const word = v.trim().toLowerCase();
  if (['inf', 'infinite', 'infinity', '∞', 'max', 'as fast as possible'].includes(word)) return AS_FAST;
  const s = word.replace(/−/g, '-').replace(/,/g, '.').replace(/\s*[x×]$/, '').trim();
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? parseSpeed(n) : null;
}

function stepPreset(s, dir) {
  if (dir > 0) return SPEED_PRESETS.find((p) => p > s) ?? AS_FAST;
  return [...SPEED_PRESETS].reverse().find((p) => p < s) ?? SPEED_PRESETS[0];
}

const speedToJson = (s) => (s === AS_FAST ? -1 : s);

function formatSpeed(s) {
  if (s === AS_FAST) return '∞';
  return `${Number(s.toPrecision(6))}×`;
}

function formatAchieved(x, { live = false } = {}) {
  if (!Number.isFinite(x)) return live ? '– live' : '–';
  if (live) return `${x.toFixed(2)}× live`;
  return `${x >= 99.5 ? String(Math.round(x)) : x.toPrecision(2)}×`;
}

const MAX_FRAME = 0.25;

function paceOf(speed, simRate) {
  const cap = Number.isFinite(simRate) && simRate > 0 ? simRate : AS_FAST;
  const s = speed === AS_FAST || (Number.isFinite(speed) && speed > 0) ? speed : 1;
  return Math.min(s, cap);
}

function sweepClock(scan, w0, w1, pace, dt, single = false) {
  const W = w1 - w0;
  if (!(W > 0)) return { scan: w0, advanced: 0, ended: true };  
  const from = scan >= w0 && scan < w1 ? scan : w0;
  const wall = Math.min(MAX_FRAME, Math.max(0, Number.isFinite(dt) ? dt : 0));
  const want = pace === AS_FAST ? Infinity : Math.max(0, Number.isFinite(pace) ? pace : 1) * wall;
  if (from + want < w1) return { scan: from + want, advanced: want, ended: false };
  if (single || want === Infinity) return { scan: w1, advanced: w1 - from, ended: true };
  return { scan: w0 + ((from + want - w0) % W), advanced: want, ended: true };
}

const singleFrom = (mode) => ({ mode: 'single', restart: mode !== 'run' && mode !== 'single' });

function createSpeedMeter(span = 1) {
  let q = [];  
  return {
    add(t, sim) {
      if (!Number.isFinite(t)) return;
      if (q.length) {
        const last = q[q.length - 1][0];
        if (t - last > span) q = [];
        else if (t < last) t = last;  
      }
      q.push([t, Number.isFinite(sim) && sim > 0 ? sim : 0]);
      while (q.length > 2 && q[1][0] <= t - span) q.shift();
    },
    rate(now = q.length ? q[q.length - 1][0] : 0) {
      if (q.length < 2 || now - q[q.length - 1][0] > span) return null;
      const wall = q[q.length - 1][0] - q[0][0];
      if (!(wall > 0.05)) return null;
      let sim = 0;
      for (let i = 1; i < q.length; i++) sim += q[i][1];
      return sim / wall;
    },
    reset() { q = []; },
  };
}

return { SPEED_PRESETS, AS_FAST, parseSpeed, stepPreset, speedToJson, formatSpeed, formatAchieved, MAX_FRAME, paceOf, sweepClock, singleFrom, createSpeedMeter };
})();
// ---- core/blocks.js
__mods['core/blocks.js'] = (() => {

const { polyMul, polyPow } = __mods['core/poly.js'];
const SLOTS = [
  { key: 'reference', label: 'Reference', symbol: 'r', scope: 'system' },
  { key: 'controller', label: 'Controller', symbol: 'C', scope: 'candidate' },
  { key: 'actuator', label: 'Actuator', symbol: 'A', scope: 'system' },
  { key: 'disturbance', label: 'Disturbance', symbol: 'd', scope: 'system' },
  { key: 'plant', label: 'Plant', symbol: 'P', scope: 'system' },
  { key: 'sensor', label: 'Sensor', symbol: 'S', scope: 'system' },
  { key: 'noise', label: 'Noise', symbol: 'n', scope: 'system' },
];

const num = (key, label, def, min, max, scale = 'lin', extra = {}) => ({ key, label, default: def, min, max, scale, ...extra });
const gain = (key, label, def, extra) => num(key, label, def, 0.01, 100, 'log', extra);
const tau = (key, label, def, extra) => num(key, label, def, 0.001, 1000, 'log', { unit: 's', ...extra });
const time = (key, label, def) => num(key, label, def, 0, 'duration', 'lin', { unit: 's' });
const amp = (key, label, def) => num(key, label, def, -10, 10, 'lin');
const vec = (key, label, def) => ({ key, label, default: def, kind: 'vector' });

const lag = (t) => [t, 1];

const SUP = ['', '', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
function polyText(c, paren = false) {
  const n = c.length - 1;
  const terms = [];
  c.forEach((v, i) => {
    const k = n - i;
    if (v === 0) return;
    const mag = Number(Math.abs(v).toPrecision(4));
    const coef = k > 0 && mag === 1 ? '' : String(mag);
    terms.push([v < 0 ? '−' : '+', `${coef}${k > 0 ? `s${SUP[k] ?? `^${k}`}` : ''}`]);
  });
  if (!terms.length) return '0';
  const text = terms.map(([sg, t], i) => (i ? ` ${sg} ${t}` : sg === '−' ? `−${t}` : t)).join('');
  return paren && terms.length > 1 ? `(${text})` : text;
}

const BLOCK_LIST = [
  {
    type: 'step', slots: ['disturbance'], label: 'Step', formula: 'A · 1(t − t₀)',
    params: [amp('amplitude', 'A', 1), time('time', 't₀', 1)],
    signal: (p) => (t) => (t >= p.time ? p.amplitude : 0),
  },
  {
    type: 'square', slots: ['disturbance'], label: 'Square', formula: 'A · square(t − t₀, T)',
    params: [amp('amplitude', 'A', 1), time('time', 't₀', 1), num('period', 'T', 10, 0.01, 1000, 'log', { unit: 's' }), num('duty', 'duty', 0.5, 0.05, 0.95)],
    signal: (p) => (t) => (t >= p.time && ((t - p.time) % p.period) < p.duty * p.period ? p.amplitude : 0),
  },
  {
    type: 'pulse', slots: ['disturbance'], label: 'Pulse', formula: 'A for t₀ ≤ t < t₀ + w',
    params: [amp('amplitude', 'A', 1), time('time', 't₀', 1), num('width', 'w', 1, 0.001, 1000, 'log', { unit: 's' })],
    signal: (p) => (t) => (t >= p.time && t < p.time + p.width ? p.amplitude : 0),
  },
  {
    type: 'ramp', slots: ['disturbance'], label: 'Ramp', formula: 'k · (t − t₀) · 1(t − t₀)',
    params: [amp('slope', 'k', 0.1), time('time', 't₀', 1)],
    signal: (p) => (t) => (t >= p.time ? p.slope * (t - p.time) : 0),
  },
  {
    type: 'sine', slots: ['disturbance'], label: 'Sine', formula: 'A · sin(2πf (t − t₀))',
    params: [amp('amplitude', 'A', 1), time('time', 't₀', 0), num('frequency', 'f', 0.1, 0.001, 100, 'log', { unit: 'Hz' })],
    signal: (p) => (t) => (t >= p.time ? p.amplitude * Math.sin(2 * Math.PI * p.frequency * (t - p.time)) : 0),
  },
  {
    type: 'none', slots: ['disturbance'], label: 'None', formula: '0',
    params: [], signal: () => () => 0,
  },

  {
    type: 'P', slots: ['controller'], label: 'P', formula: 'Kp · e',
    params: [gain('Kp', 'Kp', 1, { tunable: true })], pid: true,
  },
  {
    type: 'PI', slots: ['controller'], label: 'PI', formula: 'Kp (b·r − y) + Ki ∫e',
    params: [gain('Kp', 'Kp', 1, { tunable: true }), num('Ki', 'Ki', 0.5, 0.001, 100, 'log0', { tunable: true }), num('b', 'b', 1, 0, 1)],
    pid: true,
  },
  {
    type: 'PD', slots: ['controller'], label: 'PD', formula: 'Kp e + Kd s/(Tf s + 1) (c·r − y)',
    params: [gain('Kp', 'Kp', 1, { tunable: true }), num('Kd', 'Kd', 0.5, 0.001, 100, 'log0', { tunable: true }), tau('Tf', 'Tf', 0.05), num('c', 'c', 0, 0, 1)],
    pid: true,
  },
  {
    type: 'PID', slots: ['controller'], label: 'PID', formula: 'Kp (b·r − y) + Ki ∫e + Kd s/(Tf s + 1) (c·r − y)',
    params: [
      gain('Kp', 'Kp', 1, { tunable: true }), num('Ki', 'Ki', 0.5, 0.001, 100, 'log0', { tunable: true }),
      num('Kd', 'Kd', 0.5, 0.001, 100, 'log0', { tunable: true }), tau('Tf', 'Tf', 0.05),
      num('b', 'b', 1, 0, 1), num('c', 'c', 0, 0, 1),
    ],
    pid: true,
  },
  {
    type: 'leadLag', slots: ['controller'], label: 'Lead / lag', formula: 'K (Tz s + 1) / (Tp s + 1)',
    params: [gain('K', 'K', 1, { tunable: true }), tau('Tz', 'Tz', 1, { tunable: true }), tau('Tp', 'Tp', 0.1, { tunable: true })],
    tf: (p) => ({ num: [p.K * p.Tz, p.K], den: [p.Tp, 1], delay: 0 }),
  },
  {
    type: 'tf', slots: ['controller', 'actuator', 'plant', 'sensor'], label: 'Transfer function', formula: 'num(s) / den(s) · e^(−T_d·s)',
    params: [vec('num', 'num', [1]), vec('den', 'den', [1, 1]), num('delay', 'Dead time T_d', 0, 0.001, 100, 'log0', { unit: 's' })],
    tf: (p) => ({ num: p.num, den: p.den, delay: p.delay }),
    summary: (p) => `${polyText(p.num)} / ${polyText(p.den, true)}${p.delay > 0 ? ` · e^(−${Number(p.delay.toPrecision(3))}s)` : ''}`,
  },

  {
    type: 'ideal', slots: ['actuator', 'sensor'], label: 'Ideal', formula: '1',
    params: [], tf: () => ({ num: [1], den: [1], delay: 0 }),
  },
  {
    type: 'saturation', slots: ['actuator'], label: 'Saturation', formula: 'clamp(u, u_min, u_max)',
    params: [amp('uMin', 'u min', -2), amp('uMax', 'u max', 2)],
    tf: () => ({ num: [1], den: [1], delay: 0 }), limits: (p) => ({ min: p.uMin, max: p.uMax }),
  },
  {
    type: 'lag', slots: ['actuator', 'sensor'], label: 'First-order lag', formula: '1 / (τ s + 1)',
    params: [tau('tau', 'τ', 0.1)], tf: (p) => ({ num: [1], den: lag(p.tau), delay: 0 }),
  },
  {
    type: 'lagSaturation', slots: ['actuator'], label: 'Lag + saturation', formula: 'clamp(u) → 1 / (τ s + 1)',
    params: [tau('tau', 'τ', 0.1), amp('uMin', 'u min', -2), amp('uMax', 'u max', 2)],
    tf: (p) => ({ num: [1], den: lag(p.tau), delay: 0 }), limits: (p) => ({ min: p.uMin, max: p.uMax }),
  },

  {
    type: 'firstOrder', slots: ['plant'], label: 'First order', formula: 'K / (τ s + 1)',
    params: [gain('K', 'K', 1), tau('tau', 'τ', 1)], tf: (p) => ({ num: [p.K], den: lag(p.tau), delay: 0 }),
  },
  {
    type: 'fopdt', slots: ['plant'], label: 'First order + dead time', formula: 'K e^(−T_d·s) / (τ s + 1)',
    params: [gain('K', 'K', 1), tau('tau', 'τ', 1), num('delay', 'Dead time T_d', 0.5, 0.001, 100, 'log0', { unit: 's' })],
    tf: (p) => ({ num: [p.K], den: lag(p.tau), delay: p.delay }),
  },
  {
    type: 'secondOrder', slots: ['plant'], label: 'Second order', formula: 'K ωn² / (s² + 2ζωn s + ωn²)',
    params: [gain('K', 'K', 1), num('wn', 'ωn', 1, 0.01, 1000, 'log', { unit: 'rad/s' }), num('zeta', 'ζ', 0.3, 0.001, 10, 'log0')],
    tf: (p) => ({ num: [p.K * p.wn * p.wn], den: [1, 2 * p.zeta * p.wn, p.wn * p.wn], delay: 0 }),
  },
  {
    type: 'lagChain', slots: ['plant'], label: 'n equal lags', formula: 'K / (τ s + 1)ⁿ',
    params: [gain('K', 'K', 1), tau('tau', 'τ', 1), num('n', 'n', 3, 1, 8, 'lin', { int: true })],
    tf: (p) => ({ num: [p.K], den: polyPow(lag(p.tau), Math.round(p.n)), delay: 0 }),
  },
  {
    type: 'integratorLag', slots: ['plant'], label: 'Integrator + lag', formula: 'K / (s (τ s + 1))',
    params: [gain('K', 'K', 1), tau('tau', 'τ', 0.5)], tf: (p) => ({ num: [p.K], den: [p.tau, 1, 0], delay: 0 }),
  },
  {
    type: 'doubleIntegrator', slots: ['plant'], label: 'Double integrator', formula: 'K / s²',
    params: [gain('K', 'K', 1)], tf: (p) => ({ num: [p.K], den: [1, 0, 0], delay: 0 }),
  },
  {
    type: 'inverseResponse', slots: ['plant'], label: 'Inverse response', formula: 'K (1 − Tz s) / ((τ₁ s + 1)(τ₂ s + 1))',
    params: [gain('K', 'K', 1), tau('Tz', 'Tz', 0.5), tau('tau1', 'τ₁', 1), tau('tau2', 'τ₂', 2)],
    tf: (p) => ({ num: [-p.K * p.Tz, p.K], den: polyMul(lag(p.tau1), lag(p.tau2)), delay: 0 }),
  },

  {
    type: 'gain', slots: ['sensor'], label: 'Gain', formula: 'K',
    params: [gain('K', 'K', 1)], tf: (p) => ({ num: [p.K], den: [1], delay: 0 }),
  },
  {
    type: 'delay', slots: ['sensor'], label: 'Dead time', formula: 'e^(−T_d·s)',
    params: [num('delay', 'Dead time T_d', 0.1, 0.001, 100, 'log0', { unit: 's' })], tf: (p) => ({ num: [1], den: [1], delay: p.delay }),
  },
  {
    type: 'lagDelay', slots: ['sensor'], label: 'Lag + dead time', formula: 'e^(−T_d·s) / (τ s + 1)',
    params: [tau('tau', 'τ', 0.1), num('delay', 'Dead time T_d', 0.1, 0.001, 100, 'log0', { unit: 's' })],
    tf: (p) => ({ num: [1], den: lag(p.tau), delay: p.delay }),
  },

  { type: 'none', slots: ['noise'], label: 'None', formula: '0', params: [], noise: () => ({ std: 0, seed: 1 }) },
  {
    type: 'white', slots: ['noise'], label: 'White noise', formula: 'n ~ N(0, σ²)',
    params: [num('std', 'σ', 0.01, 0.0001, 1, 'log'), num('seed', 'seed', 1, 1, 999, 'lin', { int: true })],
    noise: (p) => ({ std: p.std, seed: p.seed }),
  },
];

const BLOCKS = {};
for (const s of SLOTS) BLOCKS[s.key] = {};
for (const b of BLOCK_LIST) for (const s of b.slots) BLOCKS[s][b.type] = b;

function blockDef(slot, type) {
  const bySlot = BLOCKS[slot];
  if (!bySlot) throw new Error(`unknown slot "${slot}"; slots: ${SLOTS.map((s) => s.key).join(', ')}`);
  const def = bySlot[type];
  if (!def) throw new Error(`unknown ${slot} type "${type}"; types: ${Object.keys(bySlot).join(', ')}`);
  return def;
}

function paramMax(param, ctx) {
  return param.max === 'duration' ? ctx.duration : param.max;
}

function normalizeBlock(slot, block) {
  if (!block || typeof block.type !== 'string') throw new Error(`${slot}: block needs a "type"`);
  const def = blockDef(slot, block.type);
  const params = {};
  for (const p of def.params) {
    let v = block.params?.[p.key];
    if (v === undefined || v === null) v = p.default;
    if (p.kind === 'vector') {
      if (!Array.isArray(v) || v.length === 0 || !v.every((x) => Number.isFinite(Number(x)))) throw new Error(`${slot}.${p.key}: expected a list of numbers`);
      v = v.map(Number);
    } else {
      v = Number(v);
      if (!Number.isFinite(v)) throw new Error(`${slot}.${p.key}: expected a number`);
      if (p.int) v = Math.round(v);
    }
    params[p.key] = v;
  }
  return { type: block.type, params };
}

function retypeBlock(slot, block, newType, stash = {}) {
  const def = blockDef(slot, newType);
  const params = {};
  for (const p of def.params) {
    if (block.params && p.key in block.params) params[p.key] = block.params[p.key];
    else if (stash[newType] && p.key in stash[newType]) params[p.key] = stash[newType][p.key];
  }
  return normalizeBlock(slot, { type: newType, params });
}

return { SLOTS, polyText, BLOCKS, blockDef, paramMax, normalizeBlock, retypeBlock };
})();
// ---- core/expr.js
__mods['core/expr.js'] = (() => {

const FN1 = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  exp: Math.exp, log: Math.log, ln: Math.log, log10: Math.log10, sqrt: Math.sqrt, abs: Math.abs,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign, step: (x) => (x >= 0 ? 1 : 0),
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
};
const FN2 = { min: Math.min, max: Math.max, pow: Math.pow, mod: (a, b) => a - b * Math.floor(a / b), atan2: Math.atan2 };
const FN3 = { clamp: (x, lo, hi) => Math.min(hi, Math.max(lo, x)) };
const CONST = { pi: Math.PI, e: Math.E };

const EXPR_HELP = 'numbers, t, pi, e; + − * / ^; sin cos tan exp log sqrt abs min max pow mod step clamp …';

function tokenize(src) {
  const toks = [];
  const re = /\s*(?:(\d+\.?\d*(?:e[-+]?\d+)?|\.\d+(?:e[-+]?\d+)?)|([A-Za-z_]\w*)|(\*\*|[-+*/^(),]))/gy;
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < src.length) {
    const at = re.lastIndex;
    if (/^\s*$/.test(src.slice(at))) break;
    m = re.exec(src);
    if (!m) throw new Error(`unexpected "${src.slice(at).trim()[0]}" at ${at + 1}`);
    if (m[1] !== undefined) toks.push({ k: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) toks.push({ k: 'id', v: m[2] });
    else toks.push({ k: 'op', v: m[3] === '**' ? '^' : m[3] });
  }
  return toks;
}

function compileExpr(src, opts = {}) {
  const toks = tokenize(String(src));
  let i = 0;
  const peek = () => toks[i];
  const take = (v) => { const tk = toks[i]; if (!tk || (v && tk.v !== v)) throw new Error(tk ? `expected "${v}" near "${tk.v}"` : `expected "${v}" at the end`); i++; return tk; };

  function expr() {
    let a = term();
    while (peek()?.k === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = take().v, b = term(), l = a;
      a = op === '+' ? (e) => l(e) + b(e) : (e) => l(e) - b(e);
    }
    return a;
  }
  function term() {
    let a = unary();
    for (;;) {
      const tk = peek();
      const explicit = tk?.k === 'op' && (tk.v === '*' || tk.v === '/');
      const implicit = tk && (tk.k === 'num' || tk.k === 'id' || (tk.k === 'op' && tk.v === '('));
      if (!explicit && !implicit) return a;
      const op = explicit ? take().v : '*';
      const b = unary(), l = a;
      a = op === '*' ? (e) => l(e) * b(e) : (e) => l(e) / b(e);
    }
  }
  function unary() {
    if (peek()?.k === 'op' && (peek().v === '-' || peek().v === '+')) {
      const neg = take().v === '-', a = unary();
      return neg ? (e) => -a(e) : a;
    }
    return power();
  }
  function power() {
    const a = atom();
    if (peek()?.k === 'op' && peek().v === '^') { take(); const b = unary(); return (e) => Math.pow(a(e), b(e)); }
    return a;
  }
  function atom() {
    const tk = peek();
    if (!tk) throw new Error('the formula ends too early');
    if (tk.k === 'num') { take(); const v = tk.v; return () => v; }
    if (tk.k === 'op' && tk.v === '(') { take(); const a = expr(); take(')'); return a; }
    if (tk.k === 'id') {
      take();
      const name = tk.v.toLowerCase();
      const own = opts.vars && tk.v !== name && peek()?.v !== '(' ? tk.v : null;
      if (name === 't') return own ? (e) => (Object.hasOwn(e, own) ? e[own] : e.t) : (e) => e.t;
      if (Object.hasOwn(CONST, name)) { const v = CONST[name]; return own ? (e) => (Object.hasOwn(e, own) ? e[own] : v) : () => v; }
      const arity = Object.hasOwn(FN1, name) ? 1 : Object.hasOwn(FN2, name) ? 2 : Object.hasOwn(FN3, name) ? 3 : 0;
      if (!arity && opts.vars && peek()?.v !== '(') { const v = tk.v; return (e) => (Object.hasOwn(e, v) ? e[v] : NaN); }
      if (!arity) throw new Error(`unknown name "${tk.v}"; use t, pi, e or a function such as sin, exp, step`);
      take('(');
      const args = [expr()];
      while (args.length < arity) { take(','); args.push(expr()); }
      take(')');
      const [a, b, c] = args;
      if (arity === 1) { const f = FN1[name]; return (e) => f(a(e)); }
      if (arity === 2) { const f = FN2[name]; return (e) => f(a(e), b(e)); }
      const f = FN3[name]; return (e) => f(a(e), b(e), c(e));
    }
    throw new Error(`unexpected "${tk.v}"`);
  }

  if (!toks.length) throw new Error('enter a formula in t, for example 0.5*sin(2*pi*t)');
  const f = expr();
  if (i < toks.length) throw new Error(`unexpected "${toks[i].v}"`);
  if (opts.vars) return f;
  const env = { t: 0 };
  return (t) => { env.t = t; const v = f(env); return Number.isFinite(v) ? v : 0; };
}

return { FN1, FN2, FN3, EXPR_HELP, compileExpr };
})();
// ---- core/formula.js
__mods['core/formula.js'] = (() => {

const { FN1, FN2, FN3 } = __mods['core/expr.js'];
const { siUnit } = __mods['core/scale.js'];
const CONST = { pi: Math.PI, e: Math.E, inf: Infinity };
const ARITY = (name) => (Object.hasOwn(FN1, name) ? 1 : Object.hasOwn(FN2, name) ? 2 : Object.hasOwn(FN3, name) ? 3 : 0);
const LETTER = 'A-Za-z_Ͱ-Ͽἀ-῿';
const NAME_RE = new RegExp(`^[${LETTER}][${LETTER}0-9]*$`);

const isReserved = (key) => { const k = String(key).toLowerCase(); return k === 't' || Object.hasOwn(CONST, k) || ARITY(k) > 0; };

const isFormula = (v) => typeof v === 'string' && v.trim() !== '' && !Number.isFinite(Number(v));

function tokenize(src) {
  const toks = [];
  const re = new RegExp(`\\s*(?:(\\d+\\.?\\d*(?:e[-+]?\\d+)?|\\.\\d+(?:e[-+]?\\d+)?)|([${LETTER}][${LETTER}0-9]*)|(\\*\\*|[-+*/^(),]))`, 'gy');
  re.lastIndex = 0;
  while (re.lastIndex < src.length) {
    const at = re.lastIndex;
    if (/^\s*$/.test(src.slice(at))) break;
    const m = re.exec(src);
    if (!m) throw new Error(`unexpected "${src.slice(at).trim()[0]}" at ${at + 1}`);
    if (m[1] !== undefined) toks.push({ k: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) toks.push({ k: 'id', v: m[2] });
    else toks.push({ k: 'op', v: m[3] === '**' ? '^' : m[3] });
  }
  return toks;
}

function parseFormula(src) {
  const toks = tokenize(String(src));
  let i = 0;
  const peek = () => toks[i];
  const take = (v) => { const tk = toks[i]; if (!tk || (v && tk.v !== v)) throw new Error(tk ? `expected "${v}" near "${tk.v}"` : `expected "${v}" at the end`); i++; return tk; };
  function expr() {
    let a = term();
    while (peek()?.k === 'op' && (peek().v === '+' || peek().v === '-')) { const op = take().v; a = { k: 'op', op, a, b: term() }; }
    return a;
  }
  function term() {
    let a = unary();
    for (;;) {
      const tk = peek();
      const explicit = tk?.k === 'op' && (tk.v === '*' || tk.v === '/');
      const implicit = tk && (tk.k === 'num' || tk.k === 'id' || (tk.k === 'op' && tk.v === '('));
      if (!explicit && !implicit) return a;
      const op = explicit ? take().v : '*';
      a = { k: 'op', op, a, b: unary() };
    }
  }
  function unary() {
    if (peek()?.k === 'op' && (peek().v === '-' || peek().v === '+')) { const neg = take().v === '-', a = unary(); return neg ? { k: 'neg', a } : a; }
    return power();
  }
  function power() {
    const a = atom();
    if (peek()?.k === 'op' && peek().v === '^') { take(); return { k: 'op', op: '^', a, b: unary() }; }
    return a;
  }
  function atom() {
    const tk = peek();
    if (!tk) throw new Error('the formula ends too early');
    if (tk.k === 'num') { take(); return { k: 'num', v: tk.v }; }
    if (tk.k === 'op' && tk.v === '(') { take(); const a = expr(); take(')'); return a; }
    if (tk.k === 'id') {
      take();
      const f = tk.v.toLowerCase(), arity = ARITY(f);
      if (!arity || peek()?.v !== '(') return { k: 'name', v: tk.v };
      take('(');
      const args = [expr()];
      while (args.length < arity) { take(','); args.push(expr()); }
      take(')');
      return { k: 'call', f, args };
    }
    throw new Error(`unexpected "${tk.v}"`);
  }
  if (!toks.length) throw new Error('enter a formula');
  const tree = expr();
  if (i < toks.length) throw new Error(`unexpected "${toks[i].v}"`);
  return tree;
}

function formulaNames(tree, out = []) {
  if (tree.k === 'name') { if (!out.includes(tree.v)) out.push(tree.v); }
  else if (tree.k === 'neg') formulaNames(tree.a, out);
  else if (tree.k === 'op') { formulaNames(tree.a, out); formulaNames(tree.b, out); }
  else if (tree.k === 'call') for (const a of tree.args) formulaNames(a, out);
  return out;
}

const unknown = (name) => Object.assign(new Error(`unknown name "${name}"`), { code: 'unknown-name', name });

function compileFormula(src, resolve = () => null) {
  const tree = typeof src === 'string' ? parseFormula(src) : src;
  const C = (v) => ({ c: true, v, f: () => v });
  const build = (n) => {
    if (n.k === 'num') return C(n.v);
    if (n.k === 'name') {
      let r = resolve(n.v);
      const low = n.v.toLowerCase();
      if (!r && low === 't' && n.v !== 't') r = resolve('t');
      if (!r && Object.hasOwn(CONST, low)) r = { value: CONST[low] };
      if (!r) throw unknown(n.v);
      if (r.slot === undefined) return C(r.value);
      const s = r.slot;
      return { c: false, f: (v) => v[s] };
    }
    if (n.k === 'neg') {
      const a = build(n.a);
      if (a.c) return C(-a.v);
      const fa = a.f;
      return { c: false, f: (v) => -fa(v) };
    }
    if (n.k === 'call') {
      const args = n.args.map(build), fn = (n.args.length === 1 ? FN1 : n.args.length === 2 ? FN2 : FN3)[n.f];
      if (args.every((a) => a.c)) return C(fn(...args.map((a) => a.v)));
      const [a, b, c] = args.map((x) => x.f);
      if (args.length === 1) return { c: false, f: (v) => fn(a(v)) };
      if (args.length === 2) return { c: false, f: (v) => fn(a(v), b(v)) };
      return { c: false, f: (v) => fn(a(v), b(v), c(v)) };
    }
    const a = build(n.a), b = build(n.b);
    const op = { '+': (x, y) => x + y, '-': (x, y) => x - y, '*': (x, y) => x * y, '/': (x, y) => x / y, '^': Math.pow }[n.op];
    if (a.c && b.c) return C(op(a.v, b.v));
    const fa = a.f, fb = b.f, ca = a.v, cb = b.v;
    switch (n.op) {
      case '+': return { c: false, f: a.c ? (v) => ca + fb(v) : b.c ? (v) => fa(v) + cb : (v) => fa(v) + fb(v) };
      case '-': return { c: false, f: a.c ? (v) => ca - fb(v) : b.c ? (v) => fa(v) - cb : (v) => fa(v) - fb(v) };
      case '*': return { c: false, f: a.c ? (v) => ca * fb(v) : b.c ? (v) => fa(v) * cb : (v) => fa(v) * fb(v) };
      case '/': return { c: false, f: a.c ? (v) => ca / fb(v) : b.c ? (v) => fa(v) / cb : (v) => fa(v) / fb(v) };
      default: return { c: false, f: (v) => Math.pow(fa(v), fb(v)) };
    }
  };
  const out = build(tree);
  const f = out.f;
  f.constant = out.c;
  return f;
}

function evalFormula(src, values = {}) {
  const get = values instanceof Map ? (n) => (values.has(n) ? { value: values.get(n) } : null) : (n) => (Object.hasOwn(values, n) ? { value: values[n] } : null);
  return compileFormula(src, get)(new Float64Array(0));
}

function sentence(text, valueOf) {
  return String(text).replace(/\{([^{}:]+)(?::([^{}]*))?\}/g, (_, src, unit) => {
    const v = valueOf(src.trim());
    if (!Number.isFinite(v)) return v > 0 ? '∞' : v < 0 ? '−∞' : '?';
    return unit !== undefined && unit.trim() !== '1' ? siUnit(v, unit.trim()) : String(Number(v.toPrecision(3)));
  });
}

return { NAME_RE, isReserved, isFormula, parseFormula, formulaNames, compileFormula, evalFormula, sentence };
})();
// ---- core/signals.js
__mods['core/signals.js'] = (() => {

const { compileExpr } = __mods['core/expr.js'];
const p = (key, label, def, unit, extra = {}) => ({ key, label, default: def, unit, ...extra });

const SIGNALS = {
  dc: {
    label: 'DC', params: [p('level', 'Level', 1, '')],
    fn: (q) => () => q.level,
    describe: (q) => `level ${q.level}`,
  },
  step: {
    label: 'Step', params: [p('amplitude', 'Amplitude', 1, ''), p('time', 'Time', 0.1, 's', { min: 0 })],
    fn: (q) => (t) => (t >= q.time ? q.amplitude : 0),
    describe: (q) => `${q.amplitude} at ${q.time} s`,
  },
  ramp: {
    label: 'Ramp', params: [p('amplitude', 'Amplitude', 1, ''), p('time', 'Start', 0.1, 's', { min: 0 }), p('rise', 'Rise time', 0.5, 's', { min: 1e-9 })],
    fn: (q) => (t) => (t < q.time ? 0 : t >= q.time + q.rise ? q.amplitude : (q.amplitude * (t - q.time)) / q.rise),
    describe: (q) => `${q.amplitude} over ${q.rise} s from ${q.time} s`,
  },
  square: {
    label: 'Square', params: [p('amplitude', 'Amplitude', 1, ''), p('time', 'Start', 0.1, 's', { min: 0 }), p('width', 'High time', 0.1, 's', { min: 0 }), p('period', 'Period', 0.2, 's', { min: 1e-9 }), p('count', 'Count', 0, '', { min: 0, int: true, zero: '∞' })],
    fn: (q) => (t) => {
      if (t < q.time) return 0;
      const k = Math.floor((t - q.time) / q.period);
      if (q.count > 0 && k >= q.count) return 0;
      return t - q.time - k * q.period < q.width ? q.amplitude : 0;
    },
    describe: (q) => (q.count === 1 ? `pulse ${q.amplitude} for ${q.width} s at ${q.time} s` : `${q.amplitude}, ${q.width}/${q.period} s${q.count ? `, ${q.count}×` : ''}`),
  },
  sine: {
    label: 'Sine', params: [p('amplitude', 'Amplitude', 1, ''), p('time', 'Start', 0, 's', { min: 0 }), p('frequency', 'Frequency', 5, 'Hz', { min: 0 }), p('phase', 'Phase', 0, '°')],
    fn: (q) => (t) => (t >= q.time ? q.amplitude * Math.sin(2 * Math.PI * q.frequency * (t - q.time) + (q.phase * Math.PI) / 180) : 0),
    describe: (q) => `${q.amplitude}, ${q.frequency} Hz`,
  },
  chirp: {
    label: 'Chirp', params: [p('amplitude', 'Amplitude', 1, ''), p('time', 'Start', 0, 's', { min: 0 }), p('f0', 'Start freq.', 1, 'Hz', { min: 0 }), p('f1', 'End freq.', 20, 'Hz', { min: 0 }), p('duration', 'Duration', 1, 's', { min: 1e-9 })],
    fn: (q) => (t) => {
      if (t < q.time || t >= q.time + q.duration) return 0;
      const s = t - q.time;
      return q.amplitude * Math.sin(2 * Math.PI * (q.f0 * s + ((q.f1 - q.f0) * s * s) / (2 * q.duration)));
    },
    describe: (q) => `${q.amplitude}, ${q.f0} → ${q.f1} Hz over ${q.duration} s`,
  },
  fn: {
    label: 'Function', params: [],
    fn: (q, ctx, comp) => compileExpr(comp.expr),
    describe: (q, comp) => `y = ${comp.expr}`,
  },
  noise: {
    label: 'Noise', params: [p('std', 'σ', 0.05, '', { min: 0 }), p('seed', 'Seed', 1, '', { min: 0, int: true })],
    fn: (q, ctx) => (t) => q.std * gaussAt(q.seed, Math.floor(t / ctx.sampleTime + 1e-9)),
    describe: (q) => `σ ${q.std}, seed ${q.seed}`,
  },
  arb: {
    label: 'Arb', params: [p('gain', 'Gain', 1, ''), p('shift', 'Time shift', 0, 's')],
    fn: (q, ctx, comp) => {
      const pts = comp.points ?? [];
      return (t) => q.gain * interp(pts, t - q.shift);
    },
    describe: (q, comp) => `${(comp.points ?? []).length} points${comp.name ? ` from ${comp.name}` : ''}`,
  },
};

function interp(pts, t) {
  if (!pts.length) return 0;
  if (t <= pts[0][0]) return t < pts[0][0] ? 0 : pts[0][1];
  if (t >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid][0] <= t) lo = mid; else hi = mid; }
  const [t0, v0] = pts[lo], [t1, v1] = pts[hi];
  return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
}

function hash32(a) {
  a = Math.imul(a ^ (a >>> 16), 0x45d9f3b);
  a = Math.imul(a ^ (a >>> 16), 0x45d9f3b);
  return (a ^ (a >>> 16)) >>> 0;
}

function gaussAt(seed, k) {
  const u1 = (hash32((seed * 2654435761 + k * 2) | 0) + 1) / 4294967297;
  const u2 = hash32((seed * 2654435761 + k * 2 + 1) | 0) / 4294967296;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function legacy(c) {
  const q = c.params ?? {};
  if (c.type === 'pulse') return { ...c, type: 'square', params: { amplitude: q.amplitude, time: q.time, width: q.width ?? 0.1, period: (q.width ?? 0.1) * 2, count: 1 } };
  if (c.type === 'square' && q.duty !== undefined && q.width === undefined) return { ...c, params: { ...q, width: ((q.duty ?? 50) / 100) * (q.period ?? 0.2) } };
  return c;
}

function normalizeComponent(cIn, i = 0) {
  const c = cIn ? legacy(cIn) : cIn;
  const def = SIGNALS[c?.type];
  if (!def) throw new Error(`reference.components[${i}]: unknown type "${c?.type}"; types: ${Object.keys(SIGNALS).join(', ')}`);
  const params = {};
  for (const q of def.params) {
    let v = c.params?.[q.key];
    v = v === undefined || v === null ? q.default : Number(v);
    if (!Number.isFinite(v)) throw new Error(`reference.components[${i}].${q.key}: expected a number`);
    if (q.int) v = Math.round(v);
    params[q.key] = v;
  }
  const out = { type: c.type, params };
  if (c.enabled === false) out.enabled = false;
  if (c.type === 'fn') {
    out.expr = String(c.expr ?? '').trim();
    try { compileExpr(out.expr); } catch (e) { throw new Error(`reference.components[${i}].expr: ${e.message}`); }
  }
  if (c.type === 'arb') {
    const pts = (c.points ?? []).map((pt) => [Number(pt[0]), Number(pt[1])]);
    if (!pts.every((pt) => pt.every(Number.isFinite))) throw new Error(`reference.components[${i}].points: expected [[t, v], ...]`);
    pts.sort((a, b) => a[0] - b[0]);
    out.points = pts;
    if (c.name) out.name = String(c.name);
  }
  return out;
}

const DEFAULT_PERIOD = 1;

function normalizeReference(ref) {
  if (!ref) return { period: DEFAULT_PERIOD, components: [] };
  if (!Array.isArray(ref.components)) throw new Error('reference: expected { "period": …, "components": [...] }');
  const period = Number(ref.period ?? DEFAULT_PERIOD);
  if (!(period > 0)) throw new Error('reference.period must be > 0');
  return { period, components: ref.components.map(normalizeComponent) };
}

function componentFn(comp, ctx) {
  return SIGNALS[comp.type].fn(comp.params, ctx, comp);
}

function referenceFn(ref, ctx) {
  const fns = ref.components.filter((c) => c.enabled !== false).map((c) => componentFn(c, ctx));
  const T = ref.period ?? Infinity;
  return (t) => {
    let tp = t;
    if (Number.isFinite(T) && t > T * (1 + 1e-12)) tp = t - Math.ceil(t / T - 1 - 1e-9) * T;
    let s = 0;
    for (const f of fns) s += f(tp);
    return s;
  };
}

function describeComponent(comp) {
  const def = SIGNALS[comp.type];
  return `${def.label} · ${def.describe(comp.params, comp)}`;
}

function sampleSignal(fn, sim) {
  const K = Math.round(sim.duration / sim.sampleTime);
  const t = new Float64Array(K + 1), v = new Float64Array(K + 1);
  for (let k = 0; k <= K; k++) { t[k] = k * sim.sampleTime; v[k] = fn(t[k]); }
  return { t, v };
}

function parseWaveform(text) {
  const pts = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.trim().split(/[\s,;]+/).filter(Boolean);
    if (cells.length < 2) continue;
    const t = Number(cells[0]), v = Number(cells[1]);
    if (Number.isFinite(t) && Number.isFinite(v)) pts.push([t, v]);
  }
  if (pts.length < 2) throw new Error('expected at least two rows of "time, value"');
  return pts.sort((a, b) => a[0] - b[0]);
}

function migrateReferenceBlock(block, duration, period) {
  return { period, ...migrateComponents(block, duration) };
}

function migrateComponents(block, duration) {
  if (!block) return { components: [] };
  const q = block.params ?? {};
  switch (block.type) {
    case 'ramp': {
      const rise = Math.max(1e-9, duration - (q.time ?? 1));
      return { components: [{ type: 'ramp', params: { amplitude: (q.slope ?? 0.1) * rise, time: q.time ?? 1, rise } }] };
    }
    case 'square': return { components: [{ type: 'square', params: { amplitude: q.amplitude, time: q.time, period: q.period, width: (q.duty ?? 0.5) * (q.period ?? 10), count: 0 } }] };
    case 'sine': return { components: [{ type: 'sine', params: { amplitude: q.amplitude, time: q.time, frequency: q.frequency } }] };
    case 'staircase': {
      const comps = [];
      for (let t = q.time ?? 1; t < duration; t += q.interval ?? 5) comps.push({ type: 'step', params: { amplitude: q.height ?? 0.5, time: t } });
      return { components: comps };
    }
    default: return { components: [{ type: block.type, params: q }] };
  }
}

return { SIGNALS, gaussAt, normalizeComponent, DEFAULT_PERIOD, normalizeReference, componentFn, referenceFn, describeComponent, sampleSignal, parseWaveform, migrateReferenceBlock };
})();
// ---- core/metrics.js
__mods['core/metrics.js'] = (() => {

const METRICS = [
  { key: 'riseTime', label: 'Rise time', short: 'Rise', unit: 's', desc: '10 % → 90 % of the first reference step' },
  { key: 'overshoot', label: 'Overshoot', short: 'OS', unit: '%', desc: 'peak beyond the new setpoint, % of the step', scale: 1 },
  { key: 'undershoot', label: 'Undershoot', short: 'US', unit: '%', desc: 'initial move in the wrong direction, % of the step', scale: 1 },
  { key: 'settlingTime', label: 'Settling time', short: 'Settle', unit: 's', desc: 'time after the step until y stays inside the settling band' },
  { key: 'peakTime', label: 'Peak time', short: 'Peak', unit: 's', desc: 'time after the step to the largest output' },
  { key: 'steadyStateError', label: 'Steady-state error', short: 'SSE', unit: '%', desc: 'remaining error at the end of the step window, % of the step', scale: 1 },
  { key: 'iae', label: 'IAE', short: 'IAE', unit: '', desc: '∫|e| dt over the run' },
  { key: 'ise', label: 'ISE', short: 'ISE', unit: '', desc: '∫e² dt over the run' },
  { key: 'itae', label: 'ITAE', short: 'ITAE', unit: '', desc: '∫ (t − t_event)|e| dt: penalises slow, lingering error' },
  { key: 'uPeak', label: 'Peak effort', short: 'u pk', unit: '', desc: 'max |u| applied to the actuator' },
  { key: 'uTV', label: 'Effort variation', short: 'u TV', unit: '', desc: 'Σ|Δu|, total variation of u: low means smooth' },
  { key: 'uEnergy', label: 'Effort energy', short: '∫u²', unit: '', desc: '∫u² dt' },
  { key: 'saturation', label: 'Time saturated', short: 'Sat', unit: '%', desc: 'share of samples where the actuator limits u', scale: 1 },
  { key: 'distPeak', label: 'Disturbance peak', short: 'd pk', unit: '', desc: 'max |r − y| after the disturbance starts' },
  { key: 'distIAE', label: 'Disturbance IAE', short: 'd IAE', unit: '', desc: '∫|e| dt after the disturbance starts' },
];

const METRIC = Object.fromEntries(METRICS.map((m) => [m.key, m]));

function jumps(x, rel) {
  let lo = 0, hi = 0;
  for (const v of x) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const range = hi - lo;
  const out = [];
  if (!(range > 0)) return out;
  for (let k = 0; k < x.length; k++) if (Math.abs(x[k] - (k ? x[k - 1] : 0)) > rel * range) out.push(k);
  return out;
}

function computeMetrics(res, opts = {}) {
  const band = opts.settlingBand ?? 0.02;
  const { t, r, y, u, v, e, d } = res;
  const K = t.length - 1;
  const m = Object.fromEntries(METRICS.map((x) => [x.key, NaN]));
  const events = { step: null, disturbance: null };
  if (res.info.unstable) {
    for (const k in m) m[k] = Infinity;
    return { ...m, unstable: true, blowup: res.info.blowup, events };
  }
  const dt = K > 0 ? t[1] - t[0] : 0;

  const refJumps = jumps(r, 0.01);
  let distJumps = [];
  const kdOnset = d.findIndex((x) => Math.abs(x) > 1e-12);
  if (kdOnset >= 0) distJumps = [...new Set([kdOnset, ...jumps(d, 0.01)])].sort((a, b) => a - b);
  const allEvents = [...new Set([...refJumps, ...distJumps])].sort((a, b) => a - b);
  const nextEvent = (k) => allEvents.find((j) => j > k) ?? K + 1;

  if (refJumps.length) {
    const ks = refJumps[0];
    const kend = nextEvent(ks);
    const r0 = ks ? r[ks - 1] : 0, r1 = r[ks], D = r1 - r0, ts = t[ks];
    events.step = { time: ts, from: r0, to: r1, end: t[Math.min(kend, K)] };
    const yn = (k) => (y[k] - r0) / D;
    const cross = (level) => {
      for (let k = ks; k < kend; k++) {
        if (yn(k) >= level) {
          if (k === ks) return t[k];
          const a = yn(k - 1), b = yn(k);
          return t[k - 1] + (dt * (level - a)) / (b - a);
        }
      }
      return Infinity;
    };
    const t10 = cross(0.1), t90 = cross(0.9);
    m.riseTime = t90 - t10;
    let ymax = -Infinity, ymin = Infinity, kmax = ks;
    for (let k = ks; k < kend; k++) {
      const q = yn(k);
      if (q > ymax) { ymax = q; kmax = k; }
      if (q < ymin) ymin = q;
    }
    m.overshoot = Math.max(0, ymax - 1) * 100;
    m.undershoot = Math.max(0, -ymin) * 100;
    m.peakTime = t[kmax] - ts;
    let last = -1;
    for (let k = kend - 1; k >= ks; k--) if (Math.abs(yn(k) - 1) > band) { last = k; break; }
    if (last < 0) m.settlingTime = 0;
    else if (last >= kend - 1) m.settlingTime = Infinity;
    else {
      const a = Math.abs(yn(last) - 1) - band, b = Math.abs(yn(last + 1) - 1) - band;
      m.settlingTime = t[last] + (dt * a) / (a - b) - ts;
    }
    const tail = Math.max(1, Math.round((kend - ks) * 0.05));
    let s = 0;
    for (let k = kend - tail; k < kend; k++) s += Math.abs(yn(k) - 1);
    m.steadyStateError = (s / tail) * 100;
  }

  let iae = 0, ise = 0, itae = 0, tEvent = 0, ei = 0;
  for (let k = 0; k <= K; k++) {
    if (ei < allEvents.length && allEvents[ei] === k) { tEvent = t[k]; ei++; }
    const a = Math.abs(e[k]);
    iae += a * dt; ise += a * a * dt; itae += (t[k] - tEvent) * a * dt;
  }
  m.iae = iae; m.ise = ise; m.itae = itae;

  let uPeak = 0, uTV = Math.abs(u[0]), uEnergy = 0, sat = 0;
  for (let k = 0; k <= K; k++) {
    uPeak = Math.max(uPeak, Math.abs(u[k]));
    if (k > 0) uTV += Math.abs(u[k] - u[k - 1]);
    uEnergy += u[k] * u[k] * dt;
    if (Math.abs(v[k] - u[k]) > 1e-12) sat++;
  }
  m.uPeak = uPeak; m.uTV = uTV; m.uEnergy = uEnergy; m.saturation = (sat / (K + 1)) * 100;

  if (distJumps.length) {
    const kd = distJumps[0];
    const kend = nextEvent(kd);
    events.disturbance = { time: t[kd], end: t[Math.min(kend, K)] };
    let pk = 0, ia = 0;
    for (let k = kd; k < kend; k++) { pk = Math.max(pk, Math.abs(e[k])); ia += Math.abs(e[k]) * dt; }
    m.distPeak = pk; m.distIAE = ia;
  }
  return { ...m, unstable: false, events };
}

return { METRICS, METRIC, computeMetrics };
})();
// ---- core/goal.js
__mods['core/goal.js'] = (() => {

const { METRIC } = __mods['core/metrics.js'];
const DEFAULT_GOAL = { minimize: { itae: 1 }, subjectTo: { overshoot: { max: 10 } }, settlingBand: 0.02 };

function normalizeGoal(g = {}) {
  const minimize = {};
  for (const [k, w] of Object.entries(g.minimize ?? DEFAULT_GOAL.minimize)) {
    if (!METRIC[k]) throw new Error(`goal.minimize: unknown metric "${k}"; metrics: ${Object.keys(METRIC).join(', ')}`);
    if (!Number.isFinite(Number(w))) throw new Error(`goal.minimize.${k}: weight must be a number`);
    minimize[k] = Number(w);
  }
  const subjectTo = {};
  for (const [k, c] of Object.entries(g.subjectTo ?? {})) {
    if (!METRIC[k]) throw new Error(`goal.subjectTo: unknown metric "${k}"; metrics: ${Object.keys(METRIC).join(', ')}`);
    const b = {};
    if (c?.max !== undefined && c.max !== null) b.max = Number(c.max);
    if (c?.min !== undefined && c.min !== null) b.min = Number(c.min);
    if (!('max' in b) && !('min' in b)) throw new Error(`goal.subjectTo.${k}: needs "max" or "min"`);
    subjectTo[k] = b;
  }
  const settlingBand = g.settlingBand === undefined ? DEFAULT_GOAL.settlingBand : Number(g.settlingBand);
  return { minimize, subjectTo, settlingBand };
}

const CAP = 1e3;

function evaluateGoal(metrics, goal) {
  let score = 0;
  for (const [k, w] of Object.entries(goal.minimize)) {
    const v = metrics[k];
    score += Number.isFinite(v) ? w * v : (w === 0 ? 0 : Infinity);
  }
  if (Object.keys(goal.minimize).length === 0) score = 0;
  const checks = [];
  let violation = metrics.unstable ? CAP : 0;
  for (const [k, b] of Object.entries(goal.subjectTo)) {
    const v = metrics[k];
    const scale = METRIC[k].scale ?? 1e-6;
    let over = 0;
    if (!Number.isFinite(v)) over = CAP;
    else {
      if ('max' in b && v > b.max) over += (v - b.max) / Math.max(Math.abs(b.max), scale);
      if ('min' in b && v < b.min) over += (b.min - v) / Math.max(Math.abs(b.min), scale);
    }
    violation += Math.min(over, CAP);
    checks.push({ metric: k, value: v, ...b, ok: over === 0 });
  }
  const feasible = !metrics.unstable && violation === 0;
  return { score, feasible, violation, checks, unstable: !!metrics.unstable, ...(metrics.unstable ? { blowup: metrics.blowup ?? 0 } : {}) };
}

function compareEvals(a, b) {
  if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
  if (!a.feasible && a.violation !== b.violation) return a.violation - b.violation;
  const sa = Number.isFinite(a.score) ? a.score : Number.MAX_VALUE;
  const sb = Number.isFinite(b.score) ? b.score : Number.MAX_VALUE;
  return sa - sb;
}

function penalized(ev) {
  if (ev.unstable) return 1e12 * (2 - (ev.blowup ?? 0));
  const J = Number.isFinite(ev.score) ? ev.score : 1e9;
  return ev.feasible ? J : J + (Math.abs(J) + 1) * (1 + 100 * ev.violation);
}

return { DEFAULT_GOAL, normalizeGoal, evaluateGoal, compareEvals, penalized };
})();
// ---- core/linearize.js
__mods['core/linearize.js'] = (() => {

const { solve, eig, minreal } = __mods['core/linalg.js'];
class DesignError extends Error {
  constructor(code, message, hint = '') {
    super(message);
    this.name = 'DesignError';
    this.code = code;
    this.hint = hint;
  }
}

const fmt = (v) => (Number.isFinite(v) ? String(Number(Number(v).toPrecision(3))) : String(v));
const maxAbs = (v) => { let m = 0; for (let i = 0; i < v.length; i++) m = Math.max(m, Math.abs(v[i])); return m; };
const sumSq = (v) => { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; return s; };
const REST = 1e-6;
const step = (v) => 1e-6 * Math.max(1, Math.abs(v));

function parseOp(spec, where = 'operating point') {
  if (spec === undefined || spec === null || spec === 'origin') return { kind: 'origin' };
  if (spec === 'initial') return { kind: 'initial' };
  if (typeof spec === 'object' && ['origin', 'initial', 'y', 't'].includes(spec.kind)) return spec;
  if (typeof spec === 'object' && 'y' in spec) {
    const y = Array.isArray(spec.y) ? spec.y : [spec.y];
    if (!y.length || !y.every((v) => v === null || Number.isFinite(v))) throw new DesignError('bad-op', `${where}: y takes levels, one per measurement`, 'null leaves a measurement free');
    return { kind: 'y', y: y.map((v) => (v === null ? null : Number(v))) };
  }
  if (typeof spec === 'object' && 't' in spec) {
    if (!(Number(spec.t) >= 0)) throw new DesignError('bad-op', `${where}: t is a time of the run, in seconds`, 'a time from 0 to the end of the screen');
    return { kind: 't', t: Number(spec.t), u: Number(spec.u) || 0 };
  }
  throw new DesignError('bad-op', `${where}: 'origin', 'initial', { y: [levels] } or { t: seconds }`, 'origin: all states 0; initial: the start state; y: an equilibrium at these levels; t: a moment of the run');
}

function opLabel(op, model = null) {
  op = parseOp(op);
  if (op.kind === 'origin') return 'origin (all states 0, u = 0)';
  if (op.kind === 'initial') return 'the initial state';
  if (op.kind === 't') return `t = ${op.t.toFixed(2)} s of the run`;
  return op.y.map((v, k) => {
    if (v === null) return '';
    const o = model?.outputs[k];
    return `${o?.label ?? `y${k + 1}`} = ${fmt(v)}${o?.unit ? ` ${o.unit}` : ''}`;
  }).filter(Boolean).join(', ') || 'an equilibrium near the initial state';
}

function moving(model, f) {
  let j = 0;
  for (let i = 1; i < f.length; i++) if (Math.abs(f[i]) > Math.abs(f[j])) j = i;
  const s = model.states[j];
  return `${s.label} moves at ${fmt(f[j])}${s.unit ? ` ${s.unit}` : ''}/s`;
}

function operatingPoint(model, op, { umin = -Infinity, umax = Infinity } = {}) {
  op = parseOp(op);
  const { n, m } = model, uName = model.input?.label ?? 'u';
  let x, u;
  if (op.kind === 'origin') { x = new Float64Array(n); u = 0; }
  else if (op.kind === 'initial') { x = Float64Array.from(model.x0); u = restInput(model, x, umin, umax); }
  else if (op.kind === 'y') ({ x, u } = trim(model, op.y, { umin, umax }));
  else { x = Float64Array.from(model.x0); u = op.u; }
  const f = new Float64Array(n), y = new Float64Array(m);
  model.f(x, u, f);
  model.y(x, u, y);
  const drift = maxAbs(f), rest = drift <= REST;
  const warnings = [];
  if (!rest) {
    if (op.kind === 'origin') warnings.push(`the origin is not at rest: ${moving(model, f)} with ${uName} = 0`);
    else if (op.kind === 'initial') warnings.push(`no ${uName} holds the initial state at rest: ${moving(model, f)} at best`);
    else if (op.kind === 't') warnings.push(`t = ${op.t.toFixed(2)} s is not an equilibrium: ${moving(model, f)}`);
  }
  warnings.push(...(model.atLimits?.(x, u) ?? []));
  const base = opLabel(op, model);
  const label = op.kind === 'initial' || op.kind === 'y' ? `${base}, ${uName} = ${fmt(Math.abs(u) < 1e-12 ? 0 : u)}` : base;
  return { kind: op.kind, op, x, u, y, drift, rest, label, warnings };
}

function slope(p, c, q, h) {
  if (!Number.isFinite(q) || (q === c && p !== c)) return (p - c) / h;
  if (!Number.isFinite(p) || (p === c && q !== c)) return (c - q) / h;
  return (p - q) / (2 * h);
}

function restInput(model, x, umin, umax) {
  const n = model.n, f0 = new Float64Array(n), fp = new Float64Array(n), fm = new Float64Array(n);
  const cost = (u) => { model.f(x, u, f0); let s = 0; for (let i = 0; i < n; i++) s += f0[i] * f0[i]; return s; };
  const clamp = (v) => Math.min(umax, Math.max(umin, v));
  let u = clamp(0), c = cost(u);
  for (let it = 0; it < 50 && c > 0; it++) {
    const h = step(u);
    model.f(x, u + h, fp); model.f(x, u - h, fm);
    cost(u);
    let gf = 0, gg = 0;
    for (let i = 0; i < n; i++) { const g = slope(fp[i], f0[i], fm[i], h); gf += g * f0[i]; gg += g * g; }
    if (!(gg > 0)) break;
    let du = -gf / gg, moved = false;
    for (let tries = 0; tries < 30; tries++, du /= 2) {
      const un = clamp(u + du), cn = cost(un);
      if (cn < c) { moved = un !== u; u = un; c = cn; break; }
    }
    if (!moved) break;
  }
  return u;
}

function trim(model, targets, { umin = -Infinity, umax = Infinity } = {}) {
  const { n, m } = model, N = n + 1, uName = model.input?.label ?? 'u';
  const tg = Array.isArray(targets) ? targets : [targets];
  if (tg.length > m) throw new DesignError('bad-op', `${tg.length} levels for ${m} measurement${m === 1 ? '' : 's'} (${model.outputs.map((o) => o.label).join(', ')})`, 'give at most one level per measurement, null to leave one free');
  const free = [];
  tg.forEach((v, k) => { if (v !== null && v !== undefined) free.push(k); });
  const P = n + free.length;
  const label = opLabel({ kind: 'y', y: tg.map((v) => v ?? null) }, model);
  const f = new Float64Array(n), y = new Float64Array(m), goal = new Float64Array(free.length);
  const residual = (zz, r) => {
    const x = zz.subarray(0, n), u = zz[n];
    model.f(x, u, f);
    model.y(x, u, y);
    for (let i = 0; i < n; i++) r[i] = f[i];
    for (let j = 0; j < free.length; j++) r[n + j] = y[free[j]] - goal[j];
  };
  const zt = new Float64Array(N), r = new Float64Array(P), rt = new Float64Array(P), rp = new Float64Array(P), rm = new Float64Array(P);
  const J = Array.from({ length: P }, () => new Array(N).fill(0)), rs = new Float64Array(P), tol = new Float64Array(P);
  const scaledCost = (v) => { let s = 0; for (let i = 0; i < P; i++) s += (rs[i] * v[i]) ** 2; return s; };
  const tolerances = (z) => { for (let i = 0; i < P; i++) { let s = 0; for (let j = 0; j < N; j++) s += Math.abs(J[i][j] * z[j]); tol[i] = 1e-8 + 1e-12 * s; } };
  const worst = () => { let w = 0; for (let i = 0; i < P; i++) w = Math.max(w, Math.abs(r[i]) / tol[i]); return w; };
  const solveFrom = (z, iterations) => {
    residual(z, r);
    let lambda = 0, jacobian = false;
    for (let it = 0; it < iterations; it++) {
      for (let j = 0; j < N; j++) {
        const v = z[j], h = step(v);
        zt.set(z); zt[j] = v + h; residual(zt, rp);
        zt[j] = v - h; residual(zt, rm);
        let pBad = false, mBad = false, pFlat = true, mFlat = true;
        for (let i = 0; i < P; i++) {
          if (!Number.isFinite(rp[i])) pBad = true;
          if (!Number.isFinite(rm[i])) mBad = true;
          if (rp[i] !== r[i]) pFlat = false;
          if (rm[i] !== r[i]) mFlat = false;
        }
        for (let i = 0; i < P; i++) J[i][j] = mBad || (mFlat && !pFlat) ? (rp[i] - r[i]) / h : pBad || (pFlat && !mFlat) ? (r[i] - rm[i]) / h : (rp[i] - rm[i]) / (2 * h);
      }
      jacobian = true;
      tolerances(z);
      if (worst() <= 1) return true;
      for (let i = 0; i < P; i++) { let s = 0; for (let j = 0; j < N; j++) s += J[i][j] * J[i][j]; rs[i] = s > 0 && Number.isFinite(s) ? 1 / Math.sqrt(s) : 1; }
      const Js = J.map((row, i) => row.map((v) => v * rs[i]));
      const JJ = Js.map((a) => Js.map((b) => a.reduce((s, x, k) => s + x * b[k], 0)));
      const scale = Math.max(1e-300, ...JJ.map((row, i) => row[i]));
      lambda = lambda ? Math.max(lambda / 10, 1e-15 * scale) : 1e-12 * scale;
      const cost = scaledCost(r), rsc = Array.from(r, (v, i) => v * rs[i]);
      let accepted = false;
      for (let tries = 0; tries < 12; tries++) {
        let w = null;
        try { w = solve(JJ.map((row, i) => row.map((v, j) => v + (i === j ? lambda : 0))), rsc); } catch {   }
        if (w) {
          for (let j = 0; j < N; j++) { let s = 0; for (let i = 0; i < P; i++) s += Js[i][j] * w[i]; zt[j] = z[j] - s; }
          residual(zt, rt);
          const c = scaledCost(rt);
          if (c < cost) { z.set(zt); r.set(rt); accepted = true; break; }
        }
        lambda *= 10;
      }
      if (!accepted) break;
    }
    if (!jacobian) return false;
    return worst() <= 1;
  };
  const z0 = new Float64Array(N);
  z0.set(model.x0);
  z0[n] = restInput(model, model.x0, umin, umax);
  model.y(model.x0, z0[n], y);
  const y0 = free.map((k) => y[k]);
  free.forEach((k, j) => { goal[j] = tg[k]; });
  const seed = Float64Array.from(z0);
  let seeded = false;
  free.forEach((k, j) => {
    const o = model.outputs[k];
    if (!(o && Number.isInteger(o.state) && Math.abs(o.slope) > 0)) return;
    seed[o.state] = model.x0[o.state] + (tg[k] - y0[j]) / o.slope;
    seeded = true;
  });
  let z = seed, ok = false;
  if (seeded) {
    seed[n] = restInput(model, seed.subarray(0, n), umin, umax);
    ok = solveFrom(z, 50);
  }
  if (!ok) { z = Float64Array.from(z0); ok = solveFrom(z, 50); }
  if (!ok) {
    z = Float64Array.from(z0);
    for (let s = 1; s <= 8; s++) {
      free.forEach((k, j) => { goal[j] = y0[j] + ((tg[k] - y0[j]) * s) / 8; });
      ok = solveFrom(z, s < 8 ? 20 : 50);
    }
  }
  residual(z, r);
  const res = maxAbs(r);
  if (!ok) throw new DesignError('trim-failed', `no equilibrium with ${label}: the best found leaves a residual of ${fmt(res)}`, `the level may be out of reach of ${uName}, or the levels contradict each other`);
  const u = z[n];
  if (u > umax + 1e-12) throw new DesignError('u-limit', `holding ${label} needs ${uName} = ${fmt(u)}, above u max ${fmt(umax)}`, 'choose a level the actuator can hold, or raise u max');
  if (u < umin - 1e-12) throw new DesignError('u-limit', `holding ${label} needs ${uName} = ${fmt(u)}, below u min ${fmt(umin)}`, 'choose a level the actuator can hold, or lower u min');
  return { x: Float64Array.from(z.subarray(0, n)), u, residual: res };
}

function linearize(model, op = 'origin') {
  const pt = op && op.x && 'u' in op ? op : operatingPoint(model, op);
  const { n, m } = model, x = Float64Array.from(pt.x), u = pt.u, uName = model.input?.label ?? 'u';
  const f0 = new Float64Array(n), y0 = new Float64Array(m);
  model.f(x, u, f0); model.y(x, u, y0);
  const c0 = Float64Array.from([...f0, ...y0]);
  const moved = (j, d) => {
    const fv = new Float64Array(n), yv = new Float64Array(m);
    if (j < n) { const v = x[j]; x[j] = v + d; model.f(x, u, fv); model.y(x, u, yv); x[j] = v; } else { model.f(x, u + d, fv); model.y(x, u + d, yv); }
    return Float64Array.from([...fv, ...yv]);
  };
  const rows = n + m, cols = n + 1;
  const S = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const side = [];
  for (let j = 0; j < cols; j++) {
    const v = j < n ? x[j] : u, h = step(v), p = moved(j, h), q = moved(j, -h);
    for (let i = 0; i < rows; i++) S[i][j] = (p[i] - q[i]) / (2 * h);
    side.push({ h, p, q });
  }
  const rowScale = S.map((row) => Math.max(0, ...row.map((v) => (Number.isFinite(v) ? Math.abs(v) : 0))));
  const kinks = [];
  const rowName = (i) => (i < n ? `the rate of ${model.states[i].label}` : model.outputs[i - n].label);
  const colName = (j) => (j < n ? model.states[j].label : uName);
  for (let j = 0; j < cols; j++) {
    const { h, p, q } = side[j];
    let far = null, near = null;
    for (let i = 0; i < rows; i++) {
      const fw = (p[i] - c0[i]) / h, bw = (c0[i] - q[i]) / h, gap = Math.abs(fw - bw);
      const noise = (1e3 * Number.EPSILON * Math.max(Math.abs(c0[i]), Math.abs(p[i]), Math.abs(q[i]))) / h;
      if (Number.isFinite(gap) && !(gap > 1e-3 * Math.max(Math.abs(fw), Math.abs(bw)) + 1e-6 * rowScale[i] + noise)) continue;
      if (!far) far = { p: moved(j, 10 * h), q: moved(j, -10 * h) };
      const gapFar = Math.abs((far.p[i] - c0[i]) / (10 * h) - (c0[i] - far.q[i]) / (10 * h));
      if (Number.isFinite(gap) && Number.isFinite(gapFar) && !(gap > 0.5 * gapFar)) continue;
      if (!near) near = { p: moved(j, h / 10), q: moved(j, -h / 10) };
      const gapNear = Math.abs((near.p[i] - c0[i]) / (h / 10) - (c0[i] - near.q[i]) / (h / 10));
      if (Number.isFinite(gap) && Number.isFinite(gapNear) && gapNear < 0.5 * gap) continue;
      kinks.push(Number.isFinite(gap) ? `the slope of ${rowName(i)} along ${colName(j)} differs left and right (${fmt(bw)} and ${fmt(fw)})` : `${rowName(i)} has no slope along ${colName(j)} there`);
      break;
    }
  }
  const edges = (model.limits?.(x, u) ?? []).filter((s) => s.edge).map((s) => s.sentence);
  const A = S.slice(0, n).map((row) => row.slice(0, n)), B = S.slice(0, n).map((row) => [row[n]]);
  const C = S.slice(n).map((row) => row.slice(0, n)), D = S.slice(n).map((row) => [row[n]]);
  return {
    A, B, C, D, n, m,
    states: model.states, outputs: model.outputs, input: model.input ?? { label: 'u' },
    op: pt, delay: model.delay, sensors: model.sensors,
    kinks: [...edges, ...kinks],
    warnings: [...new Set([...model.warnings, ...pt.warnings, ...kinks.map((k) => `a kink at the operating point: ${k}`)])],
  };
}

function refuseKinks(lin, what) {
  if (!lin.kinks?.length) return;
  throw new DesignError('kink', `${what} needs slopes, and the plant has a kink at ${lin.op.label}: ${lin.kinks[0]}`, 'choose an operating point away from the limit or kink, or move the limit');
}

function pathRealisation(lin, k = 0) {
  if (!(k >= 0 && k < lin.m)) throw new DesignError('bad-output', `no measurement ${k + 1}; this block has ${lin.m}`);
  const label = lin.outputs[k].label, uName = lin.input.label;
  const n = lin.n, d = lin.D[k][0];
  const reach = (seed, edge) => {
    const on = seed.slice(), stack = [];
    on.forEach((v, i) => { if (v) stack.push(i); });
    while (stack.length) { const i = stack.pop(); for (let j = 0; j < n; j++) if (!on[j] && edge(i, j)) { on[j] = true; stack.push(j); } }
    return on;
  };
  const fromU = reach(lin.B.map((b) => b[0] !== 0), (i, j) => lin.A[j][i] !== 0);
  const toY = reach(lin.C[k].map((c) => c !== 0), (i, j) => lin.A[i][j] !== 0);
  const path = [];
  for (let i = 0; i < n; i++) if (fromU[i] && toY[i]) path.push(i);
  if (!path.length && d === 0) throw new DesignError('no-path', `${uName} does not reach ${label}`, 'check the wiring from the controller output to the plant and on to this measurement');
  const mr = minreal(path.map((i) => path.map((j) => lin.A[i][j])), path.map((i) => lin.B[i][0]), path.map((j) => lin.C[k][j]));
  return { A: mr.A, b: mr.b, c: mr.c, d, label, uName };
}

function firstOrderFit(lin, k = 0) {
  const { A, b: B, c: C, d, label, uName } = pathRealisation(lin, k);
  const r = A.length;
  if (!r) {
    if (d === 0) throw new DesignError('zero-gain', `${uName} has no static effect on ${label}`, 'pole cancellation needs a plant whose output settles away from 0');
    return { K: d, tau: 0, theta: lin.delay[k] ?? 0, label, warnings: [] };
  }
  let size = 0;
  for (const row of A) for (const v of row) size += v * v;
  size = Math.sqrt(size);
  const poles = eig(A);
  if (poles.some((p) => Math.hypot(p.re, p.im) <= 1e-9 * size)) throw new DesignError('integrating-plant', `${label} integrates ${uName}: it has no static gain`, 'pole cancellation needs a self-regulating plant; measure a rate, or use another design');
  const rhp = poles.filter((p) => p.re > 1e-9 * size);
  if (rhp.length) throw new DesignError('unstable-plant', `the path from ${uName} to ${label} is unstable: a pole at ${fmt(rhp[0].re)}${rhp[0].im ? ` ± ${fmt(Math.abs(rhp[0].im))}i` : ''} rad/s`, 'pole cancellation needs a stable plant; stabilise it first (an inner loop), or use LQR');
  const x1 = solve(A, B), x2 = solve(A, x1);
  const K = d - C.reduce((s, c, i) => s + c * x1[i], 0);
  if (!(Math.abs(K) > 1e-9 * Math.max(Math.abs(d), Math.hypot(...C) * Math.hypot(...B) / size))) throw new DesignError('zero-gain', `${uName} has no static effect on ${label}`, 'pole cancellation needs a plant whose output settles away from 0');
  const tau = C.reduce((s, c, i) => s + c * x2[i], 0) / K;
  const warnings = tau > 0 ? [] : [`the step response of ${label} is not lag-like (τ = ${fmt(tau)} s): it overshoots or starts the wrong way`];
  return { K, tau, theta: lin.delay[k] ?? 0, label, warnings };
}

return { DesignError, parseOp, opLabel, operatingPoint, trim, linearize, refuseKinks, pathRealisation, firstOrderFit };
})();
// ---- core/planner.js
__mods['core/planner.js'] = (() => {

const { inv } = __mods['core/linalg.js'];
const PLAN_VERSION = 2;

const STAGES = [[3e-3, 1, 120], [1e-3, 10, 80], [3e-4, 100, 80]];
const CAP = 300;          
const HINGE = 3;          
const TRIES = 10;         
const STALL = 4;          
const STARTS = [3, 2, 4]; 

const wrapAngle = (d) => d - 2 * Math.PI * Math.round(d / (2 * Math.PI));
const fmt = (v) => String(Number(Number(v).toPrecision(3)));
const isRate = (s) => /\/s$/.test(s.unit ?? '');
const planTol = (s) => (s.angle ? 0.02 : isRate(s) ? 0.5 : 0.02);
const holdTol = (s) => (s.angle ? 0.05 : isRate(s) ? 0.5 : 0.25);

function stepper(f, n, Ts, sub) {
  const h = Ts / sub, k1 = new Float64Array(n), k2 = new Float64Array(n), k3 = new Float64Array(n), k4 = new Float64Array(n), xt = new Float64Array(n);
  return (x, u) => {
    for (let s = 0; s < sub; s++) {
      f(x, u, k1);
      for (let i = 0; i < n; i++) xt[i] = x[i] + 0.5 * h * k1[i];
      f(xt, u, k2);
      for (let i = 0; i < n; i++) xt[i] = x[i] + 0.5 * h * k2[i];
      f(xt, u, k3);
      for (let i = 0; i < n; i++) xt[i] = x[i] + h * k3[i];
      f(xt, u, k4);
      for (let i = 0; i < n; i++) x[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    }
  };
}

function substeps(model, Ts) {
  const hmax = Math.min(0.005, model.bound > 0 ? 0.5 / model.bound : Infinity);
  return Math.max(1, Math.ceil(Ts / hmax - 1e-9));
}

function* planTransfer(model, { T, Ts, segments = 12, nodesPerSegment = 4, Fmax = Infinity, Fmin = -Fmax } = {}) {
  const n = model.n, M = Math.max(1, Math.round(segments)), nps = Math.max(1, Math.round(nodesPerSegment));
  if (!(Ts > 0) || !(T > 0)) throw new Error('planTransfer: T and Ts must be above 0');
  if (!n) throw new Error('planTransfer: the model has no states');
  if (!(Fmin <= 0 && Fmax >= 0)) throw new Error('planTransfer: Fmin ≤ 0 ≤ Fmax');
  const hold = Math.max(1, Math.ceil(0.005 / Ts - 1e-9)), Th = hold * Ts;
  const P = Math.max(4, Math.round(T / (Th * M)));
  const Tp = M * P * Th, N = M * nps, K = M * P * hold;
  const sub = substeps(model, Ts);
  const step = stepper(model.f, n, Th, substeps(model, Th));
  const states = model.states, angle = states.map((s) => !!s.angle);
  const x0 = Float64Array.from(model.x0);
  const ia = new Int32Array(P), iw = new Float64Array(P);
  for (let i = 0; i < P; i++) { const q = i * nps; ia[i] = Math.floor(q / P); iw[i] = (q - ia[i] * P) / P; }

  const nz = N + 1 + n * (M - 1), nr = n * M + 2 * (N + 1) + N;
  const z = new Float64Array(nz), zt = new Float64Array(nz);
  const sOff = (j) => N + 1 + n * (j - 1);   
  const startsOf = (v) => Array.from({ length: M }, (_, j) => (j === 0 ? x0 : v.subarray(sOff(j), sOff(j) + n)));
  const S = startsOf(z), St = startsOf(zt);
  const ends = new Float64Array(M * n), endsT = new Float64Array(M * n);
  const E = Array.from({ length: M }, (_, j) => ends.subarray(j * n, (j + 1) * n));
  const Et = Array.from({ length: M }, (_, j) => endsT.subarray(j * n, (j + 1) * n));
  const r = new Float64Array(nr), rt = new Float64Array(nr);
  const xs = new Float64Array(n);
  const w = { lam: STAGES[0][0], wd: STAGES[0][1] };

  function segment(v, j, s, out) {
    xs.set(s);
    const b = j * nps;
    for (let i = 0; i < P; i++) { const a = b + ia[i]; step(xs, v[a] + (v[a + 1] - v[a]) * iw[i]); }
    out.set(xs);
  }
  function fill(v, en, res) {
    let q = 0;
    for (let j = 0; j < M - 1; j++) { const s = v.subarray(sOff(j + 1), sOff(j + 1) + n); for (let i = 0; i < n; i++) res[q++] = w.wd * (en[j * n + i] - s[i]); }
    for (let i = 0; i < n; i++) { const d = en[(M - 1) * n + i]; res[q++] = w.wd * (angle[i] ? wrapAngle(d) : d); }
    for (let k = 0; k <= N; k++) res[q++] = w.lam * v[k];
    for (let k = 0; k <= N; k++) res[q++] = HINGE * ((Fmax < Infinity ? Math.max(0, v[k] - Fmax) : 0) + (Fmin > -Infinity ? Math.max(0, Fmin - v[k]) : 0));
    for (let k = 0; k < N; k++) res[q++] = w.lam * (v[k + 1] - v[k]);
  }
  const sumsq = (v) => { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; return s; };
  const norm = (v, a, b) => { let s = 0; for (let i = a; i < b; i++) s += v[i] * v[i]; return Math.sqrt(s); };
  const defectOf = (res) => norm(res, 0, n * (M - 1)) / w.wd;
  const terminalOf = (res) => norm(res, n * (M - 1), n * M) / w.wd;
  const reachOf = (v) => { let p = 0; for (let k = 0; k <= N; k++) p = Math.max(p, v[k] / Fmax, v[k] / Fmin); return p; };

  const ncol = nps + 1 + n, G = new Float64Array(n * ncol), endC = new Float64Array(n), idx = new Int32Array(ncol);
  function columns(j) {
    const cols = j > 0 ? ncol : nps + 1;
    for (let c = 0; c < cols; c++) {
      const zi = c <= nps ? j * nps + c : sOff(j) + c - nps - 1;
      const v = z[zi], vp = v + 1e-6 * Math.max(1, Math.abs(v)), d = vp - v;
      z[zi] = vp;
      segment(z, j, S[j], endC);
      z[zi] = v;
      for (let i = 0; i < n; i++) G[i * ncol + c] = (endC[i] - E[j][i]) / d;
      idx[c] = zi;
    }
    return cols;
  }
  const H = new Float64Array(nz * nz), g = new Float64Array(nz);
  function accumulate(j, cols) {
    const last = j === M - 1, wi = w.wd, base = last ? n * (M - 1) : n * j;
    for (let i = 0; i < n; i++) {
      const ri = r[base + i], gi = i * ncol;
      for (let a = 0; a < cols; a++) {
        const ga = wi * G[gi + a];
        if (ga === 0) continue;
        g[idx[a]] += ga * ri;
        const row = idx[a] * nz;
        for (let b = 0; b < cols; b++) H[row + idx[b]] += ga * wi * G[gi + b];
      }
      if (!last) {
        const s = sOff(j + 1) + i;
        g[s] -= w.wd * ri;
        H[s * nz + s] += w.wd * w.wd;
        for (let a = 0; a < cols; a++) { const v = -w.wd * wi * G[gi + a]; H[idx[a] * nz + s] += v; H[s * nz + idx[a]] += v; }
      }
    }
  }
  const ord = new Int32Array(nz), bw = 2 * n + nps, W = bw + 1;
  for (let j = 0, q = 0; j < M; j++) {
    if (j > 0) for (let i = 0; i < n; i++) ord[q++] = sOff(j) + i;
    for (let c = 0; c < nps; c++) ord[q++] = j * nps + c;
    if (j === M - 1) ord[q] = N;
  }
  const Lb = new Float64Array(nz * W), yb = new Float64Array(nz), dz = new Float64Array(nz);
  function lmSolve(mu) {
    for (let i = 0; i < nz; i++) {
      const hi = ord[i] * nz, i0 = Math.max(0, i - bw), li = i * W + i;
      for (let j = i0; j <= i; j++) {
        let s = H[hi + ord[j]];
        if (j === i) s += mu * (1 + s);
        const lj = j * W + j;
        for (let k = Math.max(i0, j - bw); k < j; k++) s -= Lb[li - k] * Lb[lj - k];
        if (j < i) Lb[li - j] = s / Lb[j * W];
        else if (s > 0) Lb[i * W] = Math.sqrt(s);
        else return false;
      }
    }
    for (let i = 0; i < nz; i++) { const li = i * W + i; let s = g[ord[i]]; for (let k = Math.max(0, i - bw); k < i; k++) s -= Lb[li - k] * yb[k]; yb[i] = s / Lb[i * W]; }
    for (let i = nz - 1; i >= 0; i--) { let s = yb[i]; for (let k = i + 1, e = Math.min(nz - 1, i + bw); k <= e; k++) s -= Lb[k * W + k - i] * yb[k]; yb[i] = s / Lb[i * W]; }
    for (let i = 0; i < nz; i++) dz[ord[i]] = yb[i];
    return true;
  }
  function evaluate(v, St2, en, Ev, res) {
    for (let j = 0; j < M; j++) segment(v, j, St2[j], Ev[j]);
    fill(v, en, res);
    return sumsq(res);
  }

  const dist = Float64Array.from(x0, (v, i) => (angle[i] ? wrapAngle(-v) : -v));
  let span = 0;
  for (let i = 0; i < n; i++) span = Math.max(span, Math.abs(dist[i]));
  const b0 = new Float64Array(n), b1 = new Float64Array(n);
  model.f(x0, 1e-3, b0); model.f(x0, -1e-3, b1);
  let gain = Infinity;
  for (let i = 0; i < n; i++) { const bi = Math.abs(b0[i] - b1[i]) / 2e-3; if (bi > 1e-9) gain = Math.min(gain, bi); }
  const Fchar = Number.isFinite(gain) ? (2 * span * (2 * Math.PI / Tp) ** 2) / gain : 1;
  const amp = 0.5 * Math.min(Fmax, -Fmin, Fchar || 1);
  function guess(k) {
    for (let i = 0; i <= N; i++) z[i] = amp * Math.sin((k * Math.PI * i) / N);
    for (let j = 1; j < M; j++) for (let i = 0; i < n; i++) z[sOff(j) + i] = x0[i] + (j / M) * dist[i];
  }

  function judge() {
    const terminal = Float64Array.from(E[M - 1], (d, i) => (angle[i] ? wrapAngle(d) : d));
    let worst = 0, at = 0;
    terminal.forEach((d, i) => { const q = Math.abs(d) / planTol(states[i]); if (q > worst) { worst = q; at = i; } });
    const defect = defectOf(r), reach = reachOf(z);
    const ok = defect < 1e-4 && worst < 1 && !(reach > 1.05) && Number.isFinite(defect);
    return { ok, terminal, defect, reach, worst, at, badness: Number.isFinite(defect) ? worst + defect / 1e-4 + Math.max(0, reach - 1.05) * 10 : Infinity };
  }

  let total = 0, best = null, tried = 0;
  for (let s = 0; s < STARTS.length && total < CAP; s++) {
    guess(STARTS[s]);
    tried++;
    let mu = 1e-2, done = false, fraction = 0, spare = 0, far0 = 0;
    for (let st = 0; st < STAGES.length && !done && total < CAP; st++) {
      const [lam, wd, own] = STAGES[st], cap = own + spare, first = total;
      w.lam = lam; w.wd = wd;
      for (let j = 0; j < M; j++) { segment(z, j, S[j], E[j]); yield null; }
      fill(z, ends, r);
      let cost = sumsq(r);
      const hist = [];
      for (let it = 0; it < cap && total < CAP; it++) {
        H.fill(0); g.fill(0);
        for (let j = 0; j < M; j++) { accumulate(j, columns(j)); yield null; }
        for (let k = 0; k <= N; k++) {
          H[k * nz + k] += w.lam * w.lam;
          g[k] += w.lam * r[n * M + k];
          const hr = r[n * M + N + 1 + k];
          if (hr > 0) { const sg = Math.sign(z[k]) * HINGE; H[k * nz + k] += sg * sg; g[k] += sg * hr; }
        }
        for (let k = 0; k < N; k++) {
          const e = w.lam, rs = r[n * M + 2 * (N + 1) + k];
          H[k * nz + k] += e * e; H[(k + 1) * nz + k + 1] += e * e; H[k * nz + k + 1] -= e * e; H[(k + 1) * nz + k] -= e * e;
          g[k] -= e * rs; g[k + 1] += e * rs;
        }
        let accepted = false;
        for (let tries = 0; tries < TRIES && !accepted; tries++) {
          const solved = lmSolve(mu);
          yield null;
          if (solved) {
            for (let i = 0; i < nz; i++) zt[i] = z[i] - dz[i];
            const ct = evaluate(zt, St, endsT, Et, rt);
            if (Number.isFinite(ct) && ct < cost) {
              z.set(zt); ends.set(endsT); r.set(rt); cost = ct;
              mu = Math.max(1e-9, mu / 3); accepted = true;
            }
          }
          if (!accepted) mu *= 4;
          yield null;
        }
        total++;
        const defect = defectOf(r), terminal = terminalOf(r);
        const far = Math.max(1, defect / 1e-6, terminal / 1e-3);
        far0 ||= far;
        const near = far0 > 1 ? Math.min(1, Math.max(0, Math.log(far0 / far) / Math.log(far0))) : 1;
        fraction = Math.max(fraction, Math.min(0.99, 0.25 * (st + (it + 1) / cap) / STAGES.length + 0.75 * near));
        yield { stage: st + 1, stages: STAGES.length, iteration: total, cost, defect, terminal, fraction, start: s + 1, starts: STARTS.length };
        if (!accepted) break;   
        if (defect < 1e-6 && terminal < 1e-3 && !(reachOf(z) > 1.05)) { done = true; break; }
        hist.push(cost);
        if (hist.length > STALL && hist[hist.length - 1 - STALL] - cost < 1e-3 * hist[hist.length - 1 - STALL]) break;
      }
      spare = cap - (total - first);
    }
    const q = judge();
    if (!best || q.badness < best.q.badness) best = { q, s, z: Float64Array.from(z) };
    if (q.ok) break;
  }

  z.set(best.z);
  evaluate(z, S, ends, E, r);
  const q = judge();
  const F = new Float64Array(K);
  for (let j = 0; j < M; j++) for (let i = 0; i < P; i++) { const a = j * nps + ia[i], k = (j * P + i) * hold; F.fill(z[a] + (z[a + 1] - z[a]) * iw[i], k, k + hold); }
  let Fpeak = 0, Flo = 0, Fhi = 0;
  for (let k = 0; k < K; k++) { Fpeak = Math.max(Fpeak, Math.abs(F[k])); Flo = Math.min(Flo, F[k]); Fhi = Math.max(Fhi, F[k]); }
  const worst = states[q.at];
  const endError = { label: worst.name ?? worst.label, value: q.terminal[q.at], unit: worst.unit ?? '' };
  const plan = {
    ok: q.ok, code: q.ok ? null : 'plan-not-converged', message: '', hint: '',
    T: Tp, Ts, segments: M, perSegment: P * hold, hold, nodesPerSegment: nps, sub,
    z: Float64Array.from(z), F, S: S.map((v) => Float64Array.from(v)),
    iterations: total, start: best.s + 1, starts: STARTS.length,
    defect: q.defect, terminal: q.terminal, endError, Fpeak, Flo, Fhi, Fmin, Fmax,
  };
  if (!q.ok) {
    const off = `${endError.label} ends ${fmt(Math.abs(endError.value))}${endError.unit ? ` ${endError.unit}` : ''} off`;
    const u = model.input?.label ?? 'u';
    const tries = `${total} iterations, ${tried} start${tried > 1 ? 's' : ''}`;
    const up = Fhi / Fmax >= Flo / Fmin, side = up ? `up to ${fmt(Fhi)}, of the ${fmt(Fmax)}` : `down to ${fmt(Flo)}, of the ${fmt(Fmin)}`;
    if (q.reach > 1.05) {
      plan.message = `no plan found within the limit: it needs ${u} ${side} it may use (${tries})`;
      plan.hint = `needs more force or a longer T (now ${fmt(Tp)} s)`;
    } else if (q.worst >= 1 && q.reach >= 0.95) {
      plan.message = `no plan found: ${off} at T = ${fmt(Tp)} s with ${u} at its limit ${fmt(up ? Fmax : Fmin)} (${tries})`;
      plan.hint = `needs more force or a longer T (now ${fmt(Tp)} s)`;
    } else if (q.defect >= 1e-4) {
      plan.message = `no plan found: the segments do not join (defect ${fmt(q.defect)}, ${tries})`;
      plan.hint = `more segments or a longer T (now ${M} segments, T = ${fmt(Tp)} s)`;
    } else {
      plan.message = `no plan found: ${off} at T = ${fmt(Tp)} s (${tries})`;
      plan.hint = `a longer T (now ${fmt(Tp)} s) or more force`;
    }
  }
  return plan;
}

function runPlan(gen, onProgress) {
  for (;;) {
    const s = gen.next();
    if (s.done) return s.value;
    if (s.value) onProgress?.(s.value);
  }
}

function alongPlan(model, plan) {
  return runPlan(alongPlanSteps(model, plan));
}
function* alongPlanSteps(model, plan) {
  const n = model.n, m = model.m ?? 0, { segments: M, perSegment: P, Ts, sub, F } = plan, K = M * P;
  const step = stepper(model.f, n, Ts, sub);
  const xs = new Float64Array((K + 1) * n), Ad = new Float64Array(K * n * n), Bd = new Float64Array(K * n), Cy = new Float64Array(K * m * n);
  const x = new Float64Array(n), xp = new Float64Array(n), xm = new Float64Array(n), yp = new Float64Array(m), ym = new Float64Array(m);
  for (let j = 0; j < M; j++) {
    x.set(plan.S[j]);
    for (let i = 0; i < P; i++) {
      const k = j * P + i, u = F[k];
      xs.set(x, k * n);
      for (let c = 0; c < n; c++) {
        const d = 1e-6 * Math.max(1, Math.abs(x[c]));
        xp.set(x); xp[c] += d; step(xp, u);
        xm.set(x); xm[c] -= d; step(xm, u);
        for (let r = 0; r < n; r++) Ad[k * n * n + r * n + c] = (xp[r] - xm[r]) / (2 * d);
        if (m) {
          xp.set(x); xp[c] += d; model.y(xp, u, yp);
          xm.set(x); xm[c] -= d; model.y(xm, u, ym);
          for (let r = 0; r < m; r++) Cy[k * m * n + r * n + c] = (yp[r] - ym[r]) / (2 * d);
        }
      }
      const du = 1e-6 * Math.max(1, Math.abs(u));
      xp.set(x); step(xp, u + du);
      xm.set(x); step(xm, u - du);
      for (let r = 0; r < n; r++) Bd[k * n + r] = (xp[r] - xm[r]) / (2 * du);
      step(x, u);
    }
    yield null;
  }
  xs.set(x, K * n);
  return { n, m, K, Ts, sub, xs, F: Float64Array.from(F), Ad, Bd, Cy, angle: model.states.map((s) => !!s.angle) };
}

function tvlqrGains(along, { Q, R, Pend }) {
  const { n, K: steps, Ad, Bd } = along;
  const P = new Float64Array(n * n), PA = new Float64Array(n * n), PB = new Float64Array(n), Ks = new Float64Array(steps * n), Kk = new Float64Array(n), next = new Float64Array(n * n);
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) P[a * n + b] = Pend[a][b];
  for (let k = steps - 1; k >= 0; k--) {
    const A = Ad.subarray(k * n * n, (k + 1) * n * n), B = Bd.subarray(k * n, (k + 1) * n);
    for (let a = 0; a < n; a++) { let s = 0; for (let b = 0; b < n; b++) s += P[a * n + b] * B[b]; PB[a] = s; }
    for (let a = 0; a < n; a++) for (let c = 0; c < n; c++) { let s = 0; for (let b = 0; b < n; b++) s += P[a * n + b] * A[b * n + c]; PA[a * n + c] = s; }
    let S = R;
    for (let a = 0; a < n; a++) S += B[a] * PB[a];
    for (let c = 0; c < n; c++) { let s = 0; for (let a = 0; a < n; a++) s += B[a] * PA[a * n + c]; Kk[c] = s / S; }
    Ks.set(Kk, k * n);
    for (let a = 0; a < n; a++) for (let c = 0; c < n; c++) PA[a * n + c] -= PB[a] * Kk[c];
    for (let a = 0; a < n; a++) for (let c = 0; c < n; c++) { let s = Q[a][c]; for (let b = 0; b < n; b++) s += A[b * n + a] * PA[b * n + c]; next[a * n + c] = s; }
    for (let a = 0; a < n; a++) for (let c = 0; c <= a; c++) { const v = 0.5 * (next[a * n + c] + next[c * n + a]); P[a * n + c] = v; P[c * n + a] = v; }
  }
  return Ks;
}

function planValues(model, along, Kx, { K: Kup, kr }) {
  const n = model.n, m = model.m, steps = along.K;
  const Y = new Float64Array(steps * m), K = new Float64Array(steps * m), y = new Float64Array(m);
  for (let k = 0; k < steps; k++) {
    model.y(along.xs.subarray(k * n, (k + 1) * n), along.F[k], y);
    Y.set(y, k * m);
    const Ck = Array.from({ length: m }, (_, r) => Array.from(along.Cy.subarray((k * m + r) * n, (k * m + r + 1) * n)));
    let Ci;
    try { Ci = inv(Ck); } catch { Ci = null; }
    if (!Ci || !Ci.every((row) => row.every(Number.isFinite))) {
      throw Object.assign(new Error(`the measurements do not tell the states apart at t = ${(k * along.Ts).toFixed(2)} s of the plan`), { code: 'states-not-measured', hint: 'measure each state with a sensor whose slope stays away from 0 along the swing' });
    }
    for (let i = 0; i < m; i++) { let s = 0; for (let c = 0; c < n; c++) s += Kx[k * n + c] * Ci[c][i]; K[k * m + i] = s; }
  }
  return { F: Float64Array.from(along.F), Y, K, Kup: Array.from(Kup), kr, angle: model.outputs.map((o) => !!o.angle) };
}

function planLaw(values, Ts, { start = 0, umin = -Infinity, umax = Infinity } = {}) {
  const { F, Y, K: Kt, Kup, kr, angle } = values, m = Kup.length, steps = F.length, j0 = Math.round(start / Ts);
  let k = 0;
  return {
    step(x) {
      const j = k++ - j0;
      let u = 0;
      if (j >= 0 && j < steps) {
        u = F[j];
        for (let i = 0; i < m; i++) { const d = (x[i + 1] ?? 0) - Y[j * m + i]; u -= Kt[j * m + i] * (angle[i] ? wrapAngle(d) : d); }
      } else if (j >= steps) {
        u = kr * x[0];
        for (let i = 0; i < m; i++) { const y = x[i + 1] ?? 0; u -= Kup[i] * (angle[i] ? wrapAngle(y) : y); }
      }
      return Math.min(umax, Math.max(umin, u));
    },
  };
}

function verifyLoop(model, law, { x0 = model.x0, Ts, sub, duration, umin = -Infinity, umax = Infinity, d = null }) {
  const n = model.n, m = model.m, step = stepper(model.f, n, Ts, sub ?? substeps(model, Ts));
  const x = Float64Array.from(x0), y = new Float64Array(m), inputs = new Array(m + 1).fill(0);
  const steps = Math.round(duration / Ts);
  const pos = model.states.map((s) => !s.angle && !isRate(s));
  let Fpeak = 0, xmax = 0, u = 0, finite = true;
  for (let k = 0; k < steps && finite; k++) {
    model.y(x, u, y);
    for (let i = 0; i < m; i++) inputs[i + 1] = y[i];
    const v = law.step(inputs);
    Fpeak = Math.max(Fpeak, Math.abs(v));
    u = Math.min(umax, Math.max(umin, v));
    step(x, d ? u + d(k * Ts) : u);
    for (let i = 0; i < n; i++) { if (!Number.isFinite(x[i])) finite = false; if (pos[i]) xmax = Math.max(xmax, Math.abs(x[i])); }
  }
  let worst = -1, at = 0;
  for (let i = 0; i < n; i++) {
    const s = model.states[i], e = s.angle ? wrapAngle(x[i]) : x[i];
    const q = Number.isFinite(e) ? Math.abs(e) / holdTol(s) : Infinity;
    if (q > worst) { worst = q; at = i; }
  }
  const s = model.states[at];
  return { ok: finite && worst < 1, endError: { label: s.name ?? s.label, value: s.angle ? wrapAngle(x[at]) : x[at], unit: s.unit ?? '' }, Fpeak, xmax, x };
}

return { PLAN_VERSION, substeps, planTransfer, runPlan, alongPlan, alongPlanSteps, tvlqrGains, planValues, planLaw, verifyLoop };
})();
// ---- core/design.js
__mods['core/design.js'] = (() => {

const { c2d, dlqr, dlqe, eig, solve, inv, rank, mul, transpose, equilibrate, tzeros } = __mods['core/linalg.js'];
const { DesignError, operatingPoint, linearize, firstOrderFit, pathRealisation, refuseKinks } = __mods['core/linearize.js'];
const { PLAN_VERSION, planTransfer, alongPlanSteps, tvlqrGains, planValues, planLaw, verifyLoop, runPlan } = __mods['core/planner.js'];
const fmt = (v) => (Number.isFinite(v) ? String(Number(Number(v).toPrecision(4))) : String(v));
const and = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list.join(''));
const now = () => globalThis.performance?.now() ?? Date.now();


function canonical(x) {
  if (x === null || x === undefined) return 'null';
  if (typeof x === 'number') return Number.isFinite(x) ? JSON.stringify(x === 0 ? 0 : x) : Number.isNaN(x) ? '"nan"' : x > 0 ? '"inf"' : '"-inf"';
  if (typeof x === 'string' || typeof x === 'boolean') return JSON.stringify(x);
  if (Array.isArray(x) || ArrayBuffer.isView(x)) return `[${Array.from(x, canonical).join(',')}]`;
  if (x instanceof Map) return canonical([...x].sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1)));
  if (typeof x === 'object') return `{${Object.keys(x).filter((k) => x[k] !== undefined && typeof x[k] !== 'function').sort().map((k) => `${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`;
  return 'null';
}

function hashKey(s) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0').slice(-4) + (h1 >>> 0).toString(16).padStart(8, '0');
}

function plantKey(diagram) {
  const strip = (d) => ({
    blocks: d.blocks.map(({ x, y, flip, ...b }) => {
      if (b.type === 'sink') return { id: b.id, type: b.type };
      if (b.type === 'controller') { const { variants, variant, ...rest } = b; return rest; }
      if (b.type === 'subsystem') return { ...b, diagram: strip(b.diagram) };
      return b;
    }),
    wires: d.wires,
  });
  return canonical(strip(diagram));
}
function sinkNames(diagram) {
  const out = [];
  const walk = (d, at) => { for (const b of d.blocks) { if (b.type === 'sink') out.push([`${at}${b.id}`, b.params?.name ?? '']); if (b.type === 'subsystem') walk(b.diagram, `${at}${b.id}/`); } };
  walk(diagram, '');
  return canonical(out);
}


function createDesignStore({ mode = 'sync', limit = 64, debounceMs = 150 } = {}) {
  if (mode !== 'sync' && mode !== 'async') throw new Error(`design store mode "${mode}": 'sync' or 'async'`);
  const designs = new Map(), models = new Map(), heavies = new Map();
  const counts = { runs: 0, hits: 0, heavyRuns: 0 };
  const remember = (map, key, value, size) => { map.delete(key); map.set(key, value); if (map.size > size) map.delete(map.keys().next().value); };
  const jobs = new Map(), slots = new Map(), cancelled = new Map(), waitsOn = new Map();
  const listeners = new Set();
  let waiters = [], lastEmit = -Infinity;
  const settleWaiters = () => { if (jobs.size) return; const w = waiters; waiters = []; for (const res of w) res(); };
  const queue = () => [...jobs.values()].map((j) => ({ key: j.key, path: j.path, block: j.block, variant: j.variant, title: j.title, running: !!j.gen, progress: j.progress }));
  const emit = () => { lastEmit = now(); const list = queue(); for (const fn of listeners) fn(list); };

  function run(def, p, block, compiled, seeThrough, plant, slot, asked, guest) {
    const used = { model: null, at: '', warnings: [], heavy: null };
    const lins = new Map();
    const ctx = {
      Ts: block.Ts, idPath: block.idPath, name: block.name, kind: block.kind, inputs: block.inputs, outputs: block.outputs,
      model() {
        if (!used.model) used.model = compiled().seen(block.idPath, seeThrough.size ? { seeThrough } : {});
        return used.model;
      },
      linearize(op = 'origin', limits = {}) {
        const key = canonical([op, limits]);
        if (!lins.has(key)) {
          const lin = linearize(ctx.model(), operatingPoint(ctx.model(), op, limits));
          used.at ||= lin.op.label;
          used.warnings.push(...lin.op.warnings);
          lins.set(key, lin);
        }
        return lins.get(key);
      },
      trim(targets, limits = {}) {
        const pt = operatingPoint(ctx.model(), { y: targets }, limits);
        used.warnings.push(...pt.warnings);
        return pt;
      },
      heavy(kind, inputs, start, { title = '' } = {}) {
        const key = hashKey(canonical([kind, inputs, plant(), block.idPath, block.Ts]));
        used.heavy = { key, status: 'ready' };
        let h = heavies.get(key);
        if (!h && mode === 'sync') {
          counts.heavyRuns++;
          const t0 = now();
          const value = runPlan(start());
          h = { value, ms: now() - t0 };
        }
        if (h) {
          remember(heavies, key, h, 8);
          if (h.error) throw h.error;
          return { status: 'ready', value: h.value, ms: h.ms, key };
        }
        const mark = cancelled.get(slot);
        if (mark === key) { used.heavy.status = 'cancelled'; return { status: 'cancelled', key }; }
        if (mark) cancelled.delete(slot);
        let job = jobs.get(key);
        if (!job && guest) { used.heavy.status = 'pending'; return { status: 'pending', progress: null, key }; }
        if (!job) {
          job = { key, kind, title, path: block.idPath, block: block.name, variant: slot.split('#')[1], start, asked: now(), gen: null, started: 0, progress: null };
          jobs.set(key, job);
        }
        asked.add(key);
        used.heavy.status = 'pending';
        return { status: 'pending', progress: job.progress, key };
      },
    };
    const t0 = now();
    let out;
    try {
      out = def.design(p, ctx);
      if (!out) throw new Error(`${block.idPath}: the design returned nothing`);
      if ('pending' in out) {
        if (!used.heavy || used.heavy.status === 'ready') throw new Error('a design came back pending without waiting on a heavy job');
        const mdl = used.model;
        return {
          pending: true, cancelled: used.heavy.status === 'cancelled', heavy: used.heavy.key, progress: out.pending ?? null,
          status: 'pending', values: null, rows: [], warnings: [...new Set([...(mdl?.warnings ?? []), ...used.warnings, ...(out.warnings ?? [])])],
          quality: null, error: null, at: out.at ?? used.at, states: mdl ? mdl.states.map((s) => s.name) : null, ms: now() - t0,
        };
      }
    } catch (err) {
      out = { error: { code: err.code ?? 'internal', message: err.message, hint: err.hint ?? '' } };
    }
    const mdl = used.model;
    return {
      status: out.error ? 'error' : out.quality && out.quality.ok === false ? 'warn' : 'ok',
      values: out.error ? null : out.values ?? null,
      rows: out.rows ?? [],
      warnings: [...new Set([...(mdl?.warnings ?? []), ...used.warnings, ...(out.warnings ?? [])])],
      quality: out.quality ?? null,
      error: out.error ?? null,
      at: out.at ?? used.at,
      states: mdl ? mdl.states.map((s) => s.name) : null,
      ms: now() - t0,
    };
  }

  const store = {
    mode,
    generation: 0,
    begin(diagram, compileModel, { guest = false } = {}) {
      let pk = null, sk = null, el = null;
      const plant = () => (pk ??= plantKey(diagram));
      const sinks = () => (sk ??= sinkNames(diagram));
      const compiled = () => {
        if (el) return el;
        const key = hashKey(plant() + sinks());
        el = models.get(key) ?? compileModel();
        remember(models, key, el, 8);
        return el;
      };
      const seeThrough = new Map();
      const asked = new Set();
      return {
        resolve(block, variant, lib) {
          const def = lib[variant.type];
          const key = hashKey(canonical([variant.type, def.version ?? 1, variant.params, block.Ts, plant(), block.idPath, block.input, block.inputs, sinks()]));
          const slot = `${block.idPath}#${variant.name}#${variant.type}`;
          let entry = designs.get(key), cached = !!entry;
          if (cached) counts.hits++;
          else { counts.runs++; entry = run(def, variant.params, block, compiled, seeThrough, plant, slot, asked, guest); }
          let { status, values, rows } = entry;
          if (entry.pending) {
            remember(waitsOn, key, { heavy: entry.heavy, slot }, limit);
            const before = slots.get(slot), here = { m: block.inputs.length - 1, Ts: block.Ts };
            const fits = !!before && (def.compatible ? def.compatible(before, here) : before.m === here.m && before.Ts === here.Ts);
            status = entry.cancelled ? 'cancelled' : fits ? 'stale' : 'pending';
            values = fits ? before.values : null;
            rows = fits ? before.rows : [];
          } else {
            remember(designs, key, entry, limit);
            if (values) remember(slots, slot, { values, rows, m: block.inputs.length - 1, Ts: block.Ts }, limit);
          }
          if (block.kind === 'observer' && values?.stateIndex) seeThrough.set(block.idPath, values.stateIndex);
          const seen = entry.states ? `${block.input} → ${block.inputs.slice(1).join(', ')} · ${entry.states.length} state${entry.states.length === 1 ? '' : 's'} (${entry.states.join(', ')})` : '';
          const out = {
            path: block.idPath, block: block.name, variant: variant.name, type: variant.type, key,
            status, ms: Number(entry.ms.toFixed(2)), cached,
            at: entry.at, seen, rows, warnings: entry.warnings, error: entry.error, progress: entry.pending ? entry.progress : null,
          };
          Object.defineProperty(out, 'values', { value: values, enumerable: false });
          return out;
        },
        end() {
          if (mode !== 'async' || guest) return;
          for (const k of [...jobs.keys()]) if (!asked.has(k)) jobs.delete(k);
          settleWaiters();
        },
      };
    },
    runJobs(budgetMs = 8) {
      const t0 = now(), finished = [];
      let waitMs = 0, moved = false;
      while (jobs.size && now() - t0 < budgetMs) {
        const job = jobs.values().next().value;
        if (!job.gen) {
          const wait = job.asked + debounceMs - now();
          if (wait > 0) { waitMs = wait; break; }
          job.started = now();
          job.gen = job.start();
          moved = true;
        }
        let done = null;
        try {
          for (;;) {
            const s = job.gen.next();
            if (s.done) { done = { value: s.value }; break; }
            if (s.value) { job.progress = s.value; moved = true; }
            if (now() - t0 >= budgetMs) break;
          }
        } catch (err) { done = { error: err }; }
        if (!done) continue;
        const ms = now() - job.started;
        jobs.delete(job.key);
        remember(heavies, job.key, { ...done, ms }, 8);
        counts.heavyRuns++;
        store.generation++;
        finished.push({ key: job.key, path: job.path, block: job.block, variant: job.variant, title: job.title, ms, error: done.error ? done.error.message : null });
      }
      if (moved && listeners.size && now() - lastEmit >= 100) emit();
      settleWaiters();
      return { busy: jobs.size > 0, finished, waitMs };
    },
    busy: () => jobs.size > 0,
    queue,
    cancel(key) {
      const w = waitsOn.get(key) ?? [...waitsOn.values()].find((x) => x.heavy === key);
      if (!w) return false;
      jobs.delete(w.heavy);
      cancelled.set(w.slot, w.heavy);
      store.generation++;
      settleWaiters();
      return true;
    },
    retry(key) {
      const w = waitsOn.get(key) ?? [...waitsOn.values()].find((x) => x.heavy === key);
      if (!w || cancelled.get(w.slot) !== w.heavy) return false;
      cancelled.delete(w.slot);
      store.generation++;
      return true;
    },
    onProgress(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    idle: () => (jobs.size ? new Promise((res) => waiters.push(res)) : Promise.resolve()),
    stats: () => ({ ...counts }),
  };
  return store;
}

const SYNC_DESIGNS = createDesignStore();
let fallback = null;
function useDesigns(store) { fallback = store ?? null; }
function defaultDesigns() { return fallback ?? SYNC_DESIGNS; }


function stateText(s) {
  return s.label.endsWith(`.${s.name}`) ? `${s.name} (${s.label.slice(0, -s.name.length - 1)})` : s.label;
}

function lqrDesign(lin, { Q, R, track = 1, Ts }) {
  const { n, m, states, outputs } = lin;
  const labels = outputs.map((o) => o.label);
  if (n > 40) throw new DesignError('too-many-states', `the plant this block sees has ${n} states; LQR here handles up to 40`);
  if (n === 0) throw new DesignError('no-states', `${lin.input.label} moves none of the measurements (${labels.join(', ')})`, lin.warnings.join('; ') || 'wire the controller output to the plant, and the plant to the measurements');
  if (lin.op.kind === 'origin' && !lin.op.rest) throw new DesignError('not-at-rest', `the plant is not at rest at the origin: ${lin.op.warnings[0].replace(/^the origin is not at rest: /, '')}`, 'LQR is designed at the origin, which must be an equilibrium with u = 0');
  refuseKinks(lin, 'LQR');
  const direct = labels.filter((_, k) => lin.D[k][0] !== 0);
  if (direct.length) throw new DesignError('states-not-measured', `LQR needs measurements of states; ${direct.join(', ')} depends on ${lin.input.label} directly`, 'feed back states only (a Sink of u is fine, an input of the controller is not)');
  if (m !== n || rank(equilibrate(lin.C).M) < n) {
    const sole = lin.C.map((row) => { const nz = row.flatMap((v, j) => (Math.abs(v) > 1e-9 ? [j] : [])); return nz.length === 1 ? nz[0] : -1; });
    const seen = [...new Set(sole.filter((j) => j >= 0))].map((j) => states[j]), missing = states.filter((_, j) => !sole.includes(j));
    if (missing.length && m <= n) {
      throw new DesignError('states-not-measured', `LQR needs every state measured. This block sees ${seen.length ? seen.map((s) => s.name).join(', ') : 'none of them'} but not ${and(missing.map(stateText))}.`, `wire ${and(missing.map((s) => s.name))} to ${missing.length > 1 ? 'inputs' : 'an input'}, or add a Kalman Observer`);
    }
    throw new DesignError('states-not-measured', `LQR needs exactly one measurement per state: this block has ${m} measurement${m === 1 ? '' : 's'} (${labels.join(', ')}) for ${n} state${n === 1 ? '' : 's'} (${states.map((s) => s.name).join(', ')})`, 'measure each state once');
  }
  const q = Array.isArray(Q) ? Q : [Q];
  if (q.length !== 1 && q.length !== m) throw new DesignError('q-length', `Q has ${q.length} values; this block has ${m} measurements (${labels.join(', ')})`, 'give one weight per measurement, or one for all');
  const w = q.length === 1 ? new Array(m).fill(q[0]) : q;
  if (!w.every((v) => v >= 0) || !(R > 0)) throw new DesignError('bad-weights', 'Q must be at least 0 and R above 0');
  if (!(Number.isInteger(track) && track >= 0 && track <= m)) throw new DesignError('bad-track', `r applies to measurement ${track}; this block has ${m} (${labels.join(', ')}); 0 for none`);

  const { Ad, Bd } = c2d(lin.A, lin.B, Ts);
  const Ct = transpose(lin.C);
  const Qx = mul(Ct, lin.C.map((row, k) => row.map((v) => v * w[k])));
  const { K: Kr, P, converged } = dlqr(Ad, Bd, Qx, R);
  const Kx = Kr[0];
  const Acl = Ad.map((row, i) => row.map((v, j) => v - Bd[i][0] * Kx[j]));
  const poles = eig(Acl);
  const radius = Math.max(...poles.map((z) => Math.hypot(z.re, z.im)));
  if (!converged || !(radius < 1)) {
    const mode = stuck(Ad, Bd, Qx);
    const zero = labels.filter((_, k) => w[k] === 0);
    if (mode && !mode.unreached && mode.unweighted && zero.length) throw new DesignError('not-stabilisable', `LQR finds no gain that holds this plant: Q gives no weight to ${and(zero)}, and a mode seen only there does not decay by itself (|z| = ${fmt(mode.radius)})`, `give ${and(zero)} a weight above 0`);
    throw new DesignError('not-stabilisable', `LQR finds no gain that holds this plant (a closed-loop pole stays at |z| = ${fmt(radius)})`, `${lin.input.label} may not reach every state; check the wiring`);
  }
  const K = solve(Ct, Kx);
  let kr = 0;
  const warnings = [];
  if (track) {
    const xs = solve(Acl.map((row, i) => row.map((v, j) => (i === j ? 1 : 0) - v)), Bd.map((b) => b[0]));
    const g = lin.C[track - 1].reduce((s, c, j) => s + c * xs[j], 0);
    if (Math.abs(g) > 1e-12) kr = 1 / g;
    else warnings.push(`${labels[track - 1]} has no static gain from r in this loop: kr = 0`);
  }
  const sensed = labels.filter((_, k) => lin.sensors?.[k] && (lin.sensors[k].std > 0 || lin.sensors[k].q > 0));
  if (sensed.length) warnings.push(`quantisers and noise on ${sensed.join(', ')} are not in this design`);
  lin.delay?.forEach((d, k) => { if (d > 0) warnings.push(`dead time ${fmt(d)} s on ${labels[k]} is not in this design`); });
  const rows = [
    { label: 'K', value: K, labels },
    { label: 'kr', value: kr, note: track ? `${labels[track - 1]} follows r` : 'r is not used' },
    { label: 'slowest pole', value: slowest(poles, Ts) },
  ];
  return { K, kr, Kx, P, Qx, Ad, Bd, poles, rows, warnings };
}

function poleOf(lin) {
  const Ci = inv(lin.C), A = mul(mul(lin.C, lin.A), Ci), B = mul(lin.C, lin.B).map((b) => b[0]);
  const c = -B[3] / B[2], row = A[3].map((v, j) => v + c * A[2][j]), gl = row[1];
  const size = Math.max(...row.map(Math.abs));
  if (!(Number.isFinite(c) && c !== 0 && gl > 0 && [0, 2, 3].every((j) => Math.abs(row[j]) <= 1e-4 * size))) {
    throw new DesignError('swing-plant', `the energy swing-up needs one pendulum on a cart, θ̈ = (g/l) θ − ẍ / l at the top; the plant this block sees is not one`, 'use LQR, or the planned swing-up');
  }
  const l = 1 / Math.abs(c);
  return { l, g: gl * l };
}

function slowest(poles, Ts) {
  const slow = poles.reduce((a, z) => (Math.hypot(z.re, z.im) > Math.hypot(a.re, a.im) ? z : a));
  const s = { re: Math.log(Math.hypot(slow.re, slow.im)) / Ts, im: Math.atan2(slow.im, slow.re) / Ts };
  const wn = Math.hypot(s.re, s.im), zeta = wn > 0 ? -s.re / wn : 1;
  return `${fmt(wn)} rad/s, ζ ${fmt(zeta)}`;
}

function stuck(Ad, B, W) {
  const n = Ad.length;
  const full = (M, size) => {
    const { M: S } = equilibrate(M);
    let big = 0;
    for (let j = 0; j < S[0].length; j++) { let c = 0; for (const row of S) c += row[j] * row[j]; big = Math.max(big, Math.sqrt(c)); }
    return rank(S, 1e-8 * big) >= size;
  };
  for (const z of eig(Ad)) {
    const radius = Math.hypot(z.re, z.im);
    if (radius < 1 - 1e-9) continue;
    const cplx = Math.abs(z.im) > 1e-12, k = cplx ? 2 : 1;
    const Z = Array.from({ length: k * n }, (_, i) => Array.from({ length: k * n }, (__, j) => {
      const bi = Math.floor(i / n), bj = Math.floor(j / n), ii = i % n, jj = j % n;
      if (bi === bj) return (ii === jj ? z.re : 0) - Ad[ii][jj];
      return ii === jj ? (bi === 0 ? -z.im : z.im) : 0;
    }));
    const side = (M) => Array.from({ length: k * n }, (_, i) => Array.from({ length: k * M[0].length }, (__, j) => (Math.floor(j / M[0].length) === Math.floor(i / n) ? M[i % n][j % M[0].length] : 0)));
    const below = (M) => Array.from({ length: k * M.length }, (_, i) => Array.from({ length: k * n }, (__, j) => (Math.floor(j / n) === Math.floor(i / M.length) ? M[i % M.length][j % n] : 0)));
    const unreached = !full(Z.map((row, i) => [...row, ...side(B)[i]]), k * n);
    const unweighted = !full([...Z, ...below(W)], k * n);
    if (unreached || unweighted) return { z, radius, unreached, unweighted };
  }
  return null;
}

function kalmanDesign(lin, { Q, R = null, Ts, outputs = lin.n }) {
  const { n, m, states, outputs: meas } = lin;
  const labels = meas.map((o) => o.label), names = states.map((s) => s.name);
  if (n > 40) throw new DesignError('too-many-states', `the plant this observer sees has ${n} states; the filter here handles up to 40`);
  if (!m) throw new DesignError('no-measurement', 'this observer has no measurement to correct its estimate with', 'wire the measurements to inputs 2, 3, …');
  if (n === 0) throw new DesignError('no-states', `${lin.input.label} moves none of the measurements (${labels.join(', ')}), so there is nothing to estimate`, lin.warnings.join('; ') || 'wire input 1 (u) to what drives the plant, and the plant to the measurements');
  if (lin.op.kind === 'origin' && !lin.op.rest) throw new DesignError('not-at-rest', `the plant is not at rest at the origin: ${lin.op.warnings[0].replace(/^the origin is not at rest: /, '')}`, 'the filter is designed at the origin, which must be an equilibrium with u = 0');
  refuseKinks(lin, 'the Kalman filter');
  const direct = labels.filter((_, k) => lin.D[k][0] !== 0);
  if (direct.length) throw new DesignError('feedthrough', `${and(direct)} ${direct.length > 1 ? 'depend' : 'depends'} on ${lin.input.label} directly; the filter needs measurements of states`, 'measure after a block with state, or use a Luenberger observer with your own model');
  const q = Array.isArray(Q) ? Q : [Q];
  if (q.length !== 1 && q.length !== n) throw new DesignError('q-length', `Q has ${q.length} values; the plant this observer sees has ${n} state${n === 1 ? '' : 's'} (${names.join(', ')})`, `give one value (a push on ${lin.input.label}) or one per state`);
  const given = R !== null && R !== undefined;
  const rv = given ? (Array.isArray(R) ? R : [R]) : null;
  if (given && rv.length !== 1 && rv.length !== m) throw new DesignError('r-length', `R has ${rv.length} values; this observer has ${m} measurement${m === 1 ? '' : 's'} (${labels.join(', ')})`, 'give one per measurement, or one for all; empty takes them from the sensor blocks');
  if (!q.every((v) => v >= 0) || (given && !rv.every((v) => v > 0))) throw new DesignError('bad-weights', 'Q must be at least 0 and R above 0');

  const warnings = [];
  const parts = given ? [] : lin.sensors.flatMap((s) => s.parts ?? []);
  const r = given ? (rv.length === 1 ? new Array(m).fill(rv[0]) : rv) : lin.sensors.map((s, k) => {
    const v = s.std ** 2 + s.q ** 2 / 12;
    if (v > 0) return v;
    warnings.push(`no sensor block on ${labels[k]}: R = 1`);
    return 1;
  });
  const { Ad, Bd } = c2d(lin.A, lin.B, Ts);
  const diag = (v) => v.map((x, i) => v.map((_, j) => (i === j ? x : 0)));
  const Qw = q.length === 1 ? Bd.map((a) => Bd.map((b) => q[0] * a[0] * b[0])) : diag(q);
  const { L, converged } = dlqe(Ad, lin.C, Qw, diag(r));
  const ILC = L.map((row, i) => lin.C[0].map((_, j) => (i === j ? 1 : 0) - row.reduce((s, l, k) => s + l * lin.C[k][j], 0)));
  const poles = eig(mul(ILC, Ad));
  const radius = Math.max(...poles.map((z) => Math.hypot(z.re, z.im)));
  if (!converged || !(radius < 1)) {
    const Ct = transpose(lin.C), mode = stuck(transpose(Ad), Ct, transpose(Qw));
    if (mode && !mode.unreached && mode.unweighted) throw new DesignError('not-detectable', `the estimate's error would not die out: Q gives no process noise to a mode that does not decay by itself (|z| = ${fmt(mode.radius)}), so the filter would trust its model there for ever`, 'give Q a value above 0');
    throw new DesignError('not-detectable', `the estimate's error would not die out: a pole of the filter stays at |z| = ${fmt(radius)}`, `the measurements may not show every state (${names.join(', ')}); measure more, or raise Q`);
  }

  if (outputs !== n) warnings.push(`the plant seen has ${n} state${n === 1 ? '' : 's'} (${names.join(', ')}); set Estimates to ${n}`);
  lin.op.y?.forEach((v, k) => { if (Math.abs(v) > 1e-9) warnings.push(`${labels[k]} reads ${fmt(v)} at the origin: the filter does not know that offset`); });
  lin.delay?.forEach((d, k) => { if (d > 0) warnings.push(`dead time ${fmt(d)} s on ${labels[k]} is not in this filter`); });
  const estimates = Array.from({ length: outputs }, (_, j) => (j < n ? names[j] : '0'));
  const rows = [
    { label: 'estimates', value: estimates, labels: estimates.map((_, j) => `x̂${j + 1}`) },
    { label: 'L', head: ['L', ...labels], table: L.map((row, i) => [names[i], ...row]) },
    { label: 'R', value: r, labels, note: given ? '' : parts.length ? `from ${and(parts)}` : 'none: no sensor blocks' },
    q.length === 1 ? { label: 'Q', value: q[0], note: `a push on ${lin.input.label}, per sample` } : { label: 'Q', value: q, labels: names },
    { label: 'slowest pole', value: slowest(poles, Ts), note: 'of the error' },
  ];
  const values = {
    A: lin.A.flat(), B: lin.B.map((b) => b[0]), C: lin.C.flat(), L: L.flat(),
    stateIndex: Array.from({ length: outputs }, (_, j) => (j < n ? states[j].index : -1)),
  };
  return { values, rows, warnings, quality: { ok: outputs === n } };
}

function inverseSeries(path) {
  const { A, b, c, d } = path, n = A.length;
  const P = new Array(n + 1).fill(0), N = new Array(n + 1).fill(0);
  P[n] = 1;
  let M = A.map((row, i) => row.map((_, j) => (i === j ? 1 : 0)));
  for (let k = 1; k <= n + 1; k++) {
    if (k <= n) N[n - k] += c.reduce((s, ci, i) => s + ci * M[i].reduce((t, mij, j) => t + mij * b[j], 0), 0);
    if (k > n) break;
    const AM = mul(A, M);
    P[n - k] = -AM.reduce((s, row, i) => s + row[i], 0) / k;
    M = AM.map((row, i) => row.map((v, j) => v + (i === j ? P[n - k] : 0)));
  }
  for (let j = 0; j <= n; j++) N[j] += d * P[j];
  const scale = Math.max(...N.map(Math.abs));
  const zeros = n ? tzeros({ A, B: b.map((v) => [v]), C: [c], D: d }) : [];
  const poles = n ? eig(A) : [];
  if (!(Math.abs(N[0]) > 1e-12 * scale)) return { h: null, zeros, poles };
  const h0 = P[0] / N[0], h1 = ((P[1] ?? 0) - h0 * (N[1] ?? 0)) / N[0], h2 = ((P[2] ?? 0) - h0 * (N[2] ?? 0) - h1 * (N[1] ?? 0)) / N[0];
  return { h: [h0, h1, h2], zeros, poles };
}

function feedforwardDesign(p, ctx) {
  const lin = ctx.linearize('origin');
  refuseKinks(lin, 'a feedforward from the plant');
  if (!lin.m) throw new DesignError('no-measurement', 'this block has no measurement to follow r with', 'wire the measurement to input 2');
  const path = pathRealisation(lin, 0), { label, uName } = path;
  const { h, zeros, poles } = inverseSeries(path);
  const size = Math.max(1, ...poles.map((q) => Math.hypot(q.re, q.im)));
  const rhp = zeros.filter((z) => z.re > 1e-9 * size);
  if (rhp.length) throw new DesignError('nonminimum-phase', `the path from ${uName} to ${label} has a zero at s = ${fmt(rhp[0].re)}${rhp[0].im ? ` ± ${fmt(Math.abs(rhp[0].im))}i` : ''} in the right half-plane: its inverse is unstable, so no feedforward follows r through it`, 'use the feedback alone, or a hand feedforward (PID)');
  if (!h) throw new DesignError('zero-at-origin', `${uName} has no steady effect on ${label} (a zero at s = 0): no input holds ${label} at a steady r`, 'measure what u moves at rest (an angle, not a speed of a motor that ramps), or use the feedback alone');
  const order = Number(p.order);
  const Kff = h[0] + p.Kp * (1 - p.b), Kv = order >= 1 ? h[1] + p.Kd : 0, Ka = order >= 2 ? h[2] - p.Kd * p.Tf : 0;
  const unit = lin.outputs[0].unit ? ` ${lin.outputs[0].unit}` : '';
  const warnings = [];
  const theta = lin.delay?.[0] ?? 0;
  if (theta > 0) warnings.push(`dead time ${fmt(theta)} s on ${label} is not in this feedforward: u comes ${fmt(theta)} s before ${label} follows`);
  const rows = [
    { label: 'plant inverse', value: h, labels: ['h0', 'h1', 'h2'], note: `1/G(s) ≈ h0 + h1 s + h2 s², ${uName} per ${label}` },
    { label: 'feedforward', value: [Kff, Kv, Ka], labels: ['Kff', 'Kv', 'Ka'], note: order >= 2 ? `with Kp (1 − b), Kd and Kd·Tf of the PID` : order === 1 ? 'with Kp (1 − b) and Kd of the PID; Ka off' : 'with Kp (1 − b) of the PID; Kv and Ka off' },
  ];
  if (theta > 0) rows.push({ label: 'dead time θ', value: theta, note: 's, left out' });
  return { values: { Kff, Kv, Ka }, rows, warnings, at: `${label}${unit} at the origin` };
}

function piCancel(fit, Tcl) {
  return { Kp: fit.tau / (fit.K * Tcl), Ki: 1 / (fit.K * Tcl) };
}

function scheduledPIDesign(p, ctx) {
  const model = ctx.model();
  if (!model.m) throw new DesignError('no-measurement', 'this block has no measurement to design a PI for', 'wire the measurement to input 2');
  const out = model.outputs[0], uName = model.input?.label ?? 'u';
  const unit = out.unit ? ` ${out.unit}` : '';
  const limits = { umin: p.umin, umax: p.umax };
  const warnings = [];
  const pts = p.at.map((level) => {
    const lin = ctx.linearize({ y: [level] }, limits);
    refuseKinks(lin, 'pole cancellation');
    const fit = firstOrderFit(lin, 0);
    warnings.push(...fit.warnings);
    return { level, u: lin.op.u, fit, ...piCancel(fit, p.Tcl) };
  });
  const y = new Float64Array(model.m);
  model.y(model.x0, 0, y);
  let u0 = 0;
  try { u0 = ctx.trim([y[0]], limits).u; } catch (err) { warnings.push(`u0 = 0: ${err.message}`); }
  const theta = pts[0].fit.theta;
  if (theta > 0) warnings.push(`dead time ${fmt(theta)} s on ${out.label} is not in this design: pole cancellation leaves it out`);
  const Ts = ctx.Ts, lag = theta + Ts / 2;
  let ok = true;
  if (p.Tcl < lag) {
    ok = false;
    warnings.push(`Tcl ${fmt(p.Tcl)} s is faster than the loop can be: the dead time ${fmt(theta)} s and half the sample time ${fmt(Ts)} s add ${fmt(lag)} s, and the loop will ring or cycle; make Tcl at least ${fmt(lag)} s`);
  } else if (Ts > p.Tcl / 2) {
    ok = false;
    warnings.push(`the sample time ${fmt(Ts)} s is long against the closed loop Tcl ${fmt(p.Tcl)} s; make Ts at most Tcl / 4 (${fmt(p.Tcl / 4)} s)`);
  } else if (Ts > p.Tcl / 4) warnings.push(`the sample time ${fmt(Ts)} s is long against the closed loop Tcl ${fmt(p.Tcl)} s; Ts ≤ Tcl / 4 (${fmt(p.Tcl / 4)} s) follows it closely`);
  const rows = [
    { label: 'gains', head: [`${out.label}${unit ? ` (${unit.trim()})` : ''}`, uName, 'K', 'τ (s)', 'Kp', 'Ki'], table: pts.map((q) => [q.level, q.u, q.fit.K, q.fit.tau, q.Kp, q.Ki]) },
    { label: 'dead time θ', value: theta, note: theta > 0 ? 's, left out' : 's' },
    { label: 'u0', value: u0, note: `holds ${out.label} = ${fmt(y[0])}${unit}, where it starts` },
  ];
  const at = p.at.length === 1 ? `${out.label} = ${fmt(p.at[0])}${unit}, ${uName} = ${fmt(pts[0].u)}` : `${out.label} = ${fmt(p.at[0])} … ${fmt(p.at.at(-1))}${unit} (${p.at.length} levels)`;
  return { values: { at: [...p.at], Kp: pts.map((q) => q.Kp), Ki: pts.map((q) => q.Ki), u0 }, rows, warnings: [...new Set(warnings)], quality: { ok }, at };
}

function trajectoryDesign(p, ctx) {
  const lin = ctx.linearize('origin');
  const Ts = ctx.Ts;
  if (!(p.umin < 0 && p.umax > 0)) throw new DesignError('bad-limits', `the swing-up pushes both ways: u min must be below 0 and u max above 0 (now ${fmt(p.umin)} to ${fmt(p.umax)})`, 'set the actuator\'s limits; an open limit (empty) is fine');
  const up = lqrDesign(lin, { Q: p.Q, R: p.R, track: 1, Ts });
  const model = ctx.model();
  const labels = lin.outputs.map((o) => o.label), uName = lin.input.label;
  const Fmin = p.planShare * p.umin, Fmax = p.planShare * p.umax;
  const groups = [];
  model.states.forEach((s, i) => {
    const v = model.x0[i], text = `${fmt(v)}${s.unit ? ` ${s.unit}` : ''}`;
    if (Math.abs(v) < 1e-12) return;
    const g = groups.at(-1);
    if (g && g.text === text) g.names.push(s.name); else groups.push({ names: [s.name], text });
  });
  const at = `${groups.length ? groups.map((g) => `${g.names.join(', ')} = ${g.text}`).join(', ') : 'rest'} → origin`;
  const h = ctx.heavy('plan', { version: PLAN_VERSION, T: p.T, segments: p.segments, Fmin, Fmax }, function* plan() {
    const pl = yield* planTransfer(model, { T: p.T, Ts, segments: p.segments, Fmin, Fmax });
    const along = yield* alongPlanSteps(model, pl);
    return { plan: pl, along };
  }, { title: 'Swing-up' });
  if (h.status !== 'ready') return { pending: h.progress ?? null, at, warnings: up.warnings };
  const { plan, along } = h.value;
  const Kx = tvlqrGains(along, { Q: up.Qx, R: p.R, Pend: up.P });
  const values = planValues(model, along, Kx, { K: up.K, kr: up.kr });
  const check = verifyLoop(model, planLaw(values, Ts, { start: p.start }), { Ts, sub: plan.sub, duration: p.start + plan.T + 1, umin: p.umin, umax: p.umax });
  const limText = ` (limits ${fmt(p.umin)} to ${fmt(p.umax)})`;
  const end = check.endError, endText = `${end.label} is ${fmt(Math.abs(end.value))}${end.unit ? ` ${end.unit}` : ''} off`;
  const warnings = [...up.warnings];
  if (p.start > 0) {
    const f = new Float64Array(model.n);
    model.f(model.x0, 0, f);
    if (f.some((v) => Math.abs(v) > 1e-6)) warnings.push(`the plant does not rest at its start state, and the plan assumes it does until start (${fmt(p.start)} s): start at 0, or start the plant at rest`);
  }
  if (!plan.ok) warnings.push(`${plan.message}: ${plan.hint}`);
  const over = check.Fpeak > Math.min(-p.umin, p.umax);
  if (!check.ok) warnings.push(`the loop does not hold: ${endText} 1 s after the plan; peak ${uName} ${fmt(check.Fpeak)}${limText}: ${over ? 'lengthen T or raise the limits' : 'lengthen T, or weigh the states more (Q)'}`);
  const planned = `${plan.ok ? 'Planned' : 'Not converged'} in ${(h.ms / 1000).toFixed(1)} s (${plan.iterations} iterations, start ${plan.start} of ${plan.starts}).`;
  const held = check.ok ? `Verified: at rest at the origin 1 s after T, peak ${uName} ${fmt(check.Fpeak)}${limText}.` : `The loop does not hold: ${endText} 1 s after T.`;
  const every = Math.max(1, Math.ceil(plan.F.length / 120));
  const spark = Array.from(plan.F).filter((_, i) => i % every === 0);
  const ends = model.states.map((s, i) => [s.name, plan.terminal[i]]);
  const rows = [
    { label: 'plan', value: `${planned} ${held}`, sentence: true },
    { label: 'T', value: plan.T, note: `s, ${plan.segments} segments of ${plan.perSegment} samples` },
    { label: `${uName}(t)`, spark, note: `${fmt(plan.Flo)} to ${fmt(plan.Fhi)}${Number.isFinite(Fmax) || Number.isFinite(Fmin) ? `, of ${fmt(Fmin)} to ${fmt(Fmax)} it may use` : ''}` },
    { label: 'end error', value: ends.map(([, v]) => v), labels: ends.map(([n]) => n) },
    { label: 'defect', value: plan.defect, note: 'between segments' },
    { label: 'K at the origin', value: up.K, labels },
    ...up.rows.slice(1),
  ];
  return { values, rows, warnings: [...new Set(warnings)], quality: { ok: plan.ok && check.ok }, at };
}

return { canonical, hashKey, plantKey, createDesignStore, SYNC_DESIGNS, useDesigns, defaultDesigns, lqrDesign, poleOf, kalmanDesign, inverseSeries, feedforwardDesign, piCancel, scheduledPIDesign, trajectoryDesign };
})();
// ---- core/controllers.js
__mods['core/controllers.js'] = (() => {

const { lqrDesign, scheduledPIDesign, trajectoryDesign, feedforwardDesign, poleOf } = __mods['core/design.js'];
const { DesignError } = __mods['core/linearize.js'];
const { planLaw } = __mods['core/planner.js'];
const num = (key, label, def, extra = {}) => ({ key, label, default: def, ...extra });
const vec = (key, label, def, extra = {}) => ({ key, label, default: def, kind: 'vector', ...extra });
const LIMITS = [num('umin', 'u min', -Infinity, { unit: 'u' }), num('umax', 'u max', Infinity, { unit: 'u' })];
const PREFILTER = num('Tr', 'Prefilter Tr', 0, { unit: 's', min: 0, help: 'Vorfilter: a first-order lag on r; 0 is off' });
const START = num('u0', 'Start output u0', 0, { unit: 'u', help: 'the integral part at t = 0, so a loop can start in balance' });
const FEEDFORWARD = [
  num('Kff', 'Feedforward Kff', 0, { unit: 'u per r', help: 'static feedforward: u += Kff · rf; the input that holds y at r, per unit of r' }),
  num('Kv', 'Velocity FF Kv', 0, { unit: 'u per r/s', help: 'velocity feedforward: u += Kv · drf/dt' }),
  num('Ka', 'Acceleration FF Ka', 0, { unit: 'u per r/s²', help: 'acceleration feedforward: u += Ka · d²rf/dt²' }),
];
const ANTI_WINDUP = { clamp: 'clamping', back: 'back-calculation', off: 'off (windup)' };
const WINDUP = [
  { key: 'aw', label: 'Anti-windup', default: 'clamp', kind: 'choice', options: ANTI_WINDUP, help: 'clamping: the integral stops at a limit; back-calculation: it is pulled back with time constant Tt; off: it winds up' },
  num('Tt', 'Tracking Tt', 0, { unit: 's', min: 0, help: 'back-calculation only: how fast the integral follows the limit; 0: √(Ti·Td), or Ti/2 without D' }),
];
const SHARED = ['Kff', 'Kv', 'Ka', 'aw', 'Tt', 'umin', 'umax'];
const SWING = [num('kE', 'Energy gain kE', 1), num('kx', 'Centring kx', 0), num('kv', 'Centring kv', 0), num('l', 'Pole length l', 0.5, { unit: 'm', min: 1e-6 }), num('g', 'g', 9.81, { unit: 'm/s²' }), num('thetaS', 'Catch below θs', 0.4, { unit: 'rad', min: 0 })];
const WEIGHTS = [
  vec('Q', 'Weights Q', [1], { min: 0, per: 'measurement', help: 'what an error in each measurement costs, one per measurement; one value weighs them all' }),
  num('R', 'Effort weight R', 1, { positive: true, help: 'how much u costs: larger is gentler' }),
];

const and = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list.join(''));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

function prefilter(p, Ts) {
  let rf = null, Tr = null, a = 0;
  return (r) => {
    if (!(p.Tr > 0)) { rf = r; return r; }
    if (p.Tr !== Tr) { Tr = p.Tr; a = Math.exp(-Ts / Tr); }
    rf = rf === null ? r : a * rf + (1 - a) * r;
    return rf;
  };
}

function lookup(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1]);
  return ys[ys.length - 1];
}

function trackingTime(g, Ts) {
  if (g.Tt > 0) return g.Tt;
  const Ti = Math.abs(g.Kp / g.Ki), Td = Math.abs(g.Kd / g.Kp);
  const t = Td > 0 ? Math.sqrt(Ti * Td) : Ti / 2;
  return Number.isFinite(t) && t > Ts ? t : Ts;
}

function pidCore(Ts, u0 = 0) {
  let I = u0, D = 0, yPrev = null, r1 = null, r2 = null;
  let kff = 0, kv = 0, ka = 0;   
  return (rf, y, g) => {
    const Kff = g.Kff ?? 0, Kv = g.Kv ?? 0, Ka = g.Ka ?? 0;
    if (yPrev === null) { yPrev = y; r1 = r2 = rf; kff = Kff; kv = Kv; ka = Ka; }
    D = (g.Tf * D - g.Kd * (y - yPrev)) / (g.Tf + Ts);
    yPrev = y;
    const ffOf = (a, b, c) => a * rf + (b * (rf - r1)) / Ts + (c * (rf - 2 * r1 + r2)) / (Ts * Ts);
    const ff = ffOf(Kff, Kv, Ka);
    if (g.Ki && (Kff !== kff || Kv !== kv || Ka !== ka)) I -= ff - ffOf(kff, kv, ka);
    kff = Kff; kv = Kv; ka = Ka;
    r2 = r1; r1 = rf;
    const e = rf - y;
    const v = g.Kp * (g.b * rf - y) + I + D + ff;
    const u = clamp(v, g.umin, g.umax);
    if (!g.Ki) return u;
    if (g.aw === 'back') {
      const vb = v - ff + clamp(ff, g.umin, g.umax);
      I += g.Ki * Ts * e + (1 - Math.exp(-Ts / trackingTime(g, Ts))) * (clamp(vb, g.umin, g.umax) - vb);
    } else if (g.aw === 'off' || u === v || Math.sign(g.Ki * e) !== Math.sign(v - u)) I += g.Ki * Ts * e;
    return u;
  };
}

function pidLinear(g, Ts, m = 1) {
  const pad = (row) => [...row, ...new Array(m + 1 - row.length).fill(0)];
  const A = [], B = [], C = [], D = [pad([g.Kp * g.b, -g.Kp])];
  const state = (b, c) => { for (const row of A) row.push(0); A.push(new Array(A.length + 1).fill(0)); B.push(pad(b)); C.push(c); return A.length - 1; };
  if (g.Ki) { const i = state([g.Ki * Ts, -g.Ki * Ts], 1); A[i][i] = 1; }
  if (g.Kd) {
    const c = 1 / (g.Tf + Ts);
    const d = state([0, -g.Kd * c], g.Tf * c), p = state([0, 1], g.Kd * c);
    A[d][d] = g.Tf * c; A[d][p] = g.Kd * c;
    D[0][1] -= g.Kd * c;
  }
  const kv = (g.Kv ?? 0) / Ts, ka = (g.Ka ?? 0) / (Ts * Ts);
  D[0][0] += (g.Kff ?? 0) + kv + ka;
  if (kv || ka) {
    const r1 = state([1], -kv - 2 * ka);
    if (ka) { const r2 = state([0], ka); A[r2][r1] = 1; }
  }
  return { A, B, C: [C], D, Tr: g.Tr ?? 0 };
}
const staticLinear = (kr, K, Tr = 0) => ({ A: [], B: [], C: [[]], D: [[kr, ...K.map((k) => -k)]], Tr });


const OFF = { step: () => 0 };
const twinLaw = (twin, Ts) => CONTROLLERS[twin.type].make(normalizeVariant(twin).params, Ts);
const noDesign = (type) => new DesignError('no-design', `${CONTROLLERS[type].label} has no design to analyse yet`, 'see its Computed box in the Controller tab: the design is pending, cancelled or refused');
function twinLinear(type) {
  return (p, Ts, at, values) => {
    if (!values) throw noDesign(type);
    const twin = CONTROLLERS[type].manual(p, values);
    return CONTROLLERS[twin.type].linear(normalizeVariant(twin).params, Ts, at);
  };
}

const CONTROLLERS = {
  off: {
    label: 'Off', summary: 'u = 0', params: [],
    make: () => OFF,
    linear: (p, Ts, at) => staticLinear(0, new Array(at?.y?.length || 1).fill(0)),
  },
  pid: {
    label: 'PID', summary: 'u = Kp e + Ki ∫e + Kd ė',
    params: [num('Kp', 'Kp', 1), num('Ki', 'Ki', 0), num('Kd', 'Kd', 0), num('Tf', 'D filter Tf', 0.01, { unit: 's', min: 0 }), num('b', 'Setpoint weight b', 1, { help: 'weights r in the P part only (two degrees of freedom); not feedforward' }), PREFILTER, ...FEEDFORWARD, START, ...LIMITS, ...WINDUP],
    make(p, Ts) {
      const pre = prefilter(p, Ts), core = pidCore(Ts, p.u0);
      return { step: (x) => core(pre(x[0]), x[1] ?? 0, p) };
    },
    linear: (p, Ts, at) => pidLinear(p, Ts, at?.y?.length || 1),
  },
  stateFeedback: {
    label: 'State feedback', summary: 'u = kr r − K · y',
    params: [vec('K', 'Gains K', [1], { per: 'measurement' }), num('kr', 'Prefilter kr', 1), PREFILTER, ...LIMITS],
    make(p, Ts) {
      const pre = prefilter(p, Ts);
      return {
        step(x) {
          let u = p.kr * pre(x[0]);
          for (let i = 0; i < p.K.length; i++) u -= p.K[i] * (x[i + 1] ?? 0);
          return clamp(u, p.umin, p.umax);
        },
      };
    },
    linear: (p) => staticLinear(p.kr, p.K, p.Tr),
  },
  lqr: {
    label: 'LQR', summary: 'u = kr r − K · y, K from the plant (LQR)',
    designed: true, version: 1, computes: ['K', 'kr'], twin: 'stateFeedback',
    params: [...WEIGHTS, num('track', 'r applies to', 1, { int: true, min: 0, help: 'the measurement (1, 2, …) that follows r; 0: none' }), PREFILTER, ...LIMITS],
    design(p, ctx) {
      const d = lqrDesign(ctx.linearize('origin'), { Q: p.Q, R: p.R, track: p.track, Ts: ctx.Ts });
      return { values: { K: d.K, kr: d.kr }, rows: d.rows, warnings: d.warnings };
    },
    make(p, Ts, values) {
      if (!values) return OFF;
      return CONTROLLERS.stateFeedback.make({ K: values.K, kr: values.kr, Tr: p.Tr, umin: p.umin, umax: p.umax }, Ts);
    },
    manual: (p, values) => ({ type: 'stateFeedback', params: { K: [...values.K], kr: values.kr, Tr: p.Tr, umin: p.umin, umax: p.umax } }),
    linear: twinLinear('lqr'),
  },
  gainScheduled: {
    label: 'Gain-scheduled PI', summary: 'PI with Kp, Ki looked up from y',
    params: [vec('at', 'At y =', [0, 1]), vec('Kp', 'Kp', [1, 1]), vec('Ki', 'Ki', [0, 0]), PREFILTER, ...FEEDFORWARD, START, ...LIMITS, ...WINDUP],
    check(p) { if (p.Kp.length !== p.at.length || p.Ki.length !== p.at.length) return 'At, Kp and Ki need the same number of values'; if (p.at.some((v, i) => i && v <= p.at[i - 1])) return 'the At values must increase'; return ''; },
    make(p, Ts) {
      const pre = prefilter(p, Ts), core = pidCore(Ts, p.u0);
      const g = { Kp: 0, Ki: 0, Kd: 0, Tf: 0, b: 1 };
      return {
        step(x) {
          const y = x[1] ?? 0;
          g.Kp = lookup(p.at, p.Kp, y); g.Ki = lookup(p.at, p.Ki, y);
          for (const k of SHARED) g[k] = p[k];
          return core(pre(x[0]), y, g);
        },
      };
    },
    linear(p, Ts, at) {
      const y = at?.y?.[0] ?? p.at[0];
      return pidLinear({ Kp: lookup(p.at, p.Kp, y), Ki: lookup(p.at, p.Ki, y), Kd: 0, Tf: 0, b: 1, Tr: p.Tr, Kff: p.Kff, Kv: p.Kv, Ka: p.Ka }, Ts, at?.y?.length || 1);
    },
  },
  scheduledPI: {
    label: 'PI from the plant', summary: 'PI by pole cancellation at levels of y',
    designed: true, version: 1, computes: ['Kp', 'Ki', 'u0'], twin: ['pid', 'gainScheduled'],
    params: [vec('at', 'At y =', [1], { per: 'level', help: 'the levels of the first measurement to design at; one level gives a fixed PI, several are interpolated' }), num('Tcl', 'Closed loop Tcl', 0.25, { unit: 's', positive: true, help: 'the time constant the loop should have' }), PREFILTER, ...FEEDFORWARD, ...LIMITS, ...WINDUP],
    check(p) { return p.at.some((v, i) => i && v <= p.at[i - 1]) ? 'the At values must increase' : ''; },
    design: (p, ctx) => scheduledPIDesign(p, ctx),
    make(p, Ts, values) { return values ? twinLaw(CONTROLLERS.scheduledPI.manual(p, values), Ts) : OFF; },
    manual(p, values) {
      const common = { Tr: p.Tr, Kff: p.Kff, Kv: p.Kv, Ka: p.Ka, u0: values.u0, umin: p.umin, umax: p.umax, aw: p.aw, Tt: p.Tt };
      return values.at.length === 1
        ? { type: 'pid', params: { Kp: values.Kp[0], Ki: values.Ki[0], Kd: 0, ...common } }
        : { type: 'gainScheduled', params: { at: [...values.at], Kp: [...values.Kp], Ki: [...values.Ki], ...common } };
    },
    linear: twinLinear('scheduledPI'),
  },
  pidFF: {
    label: 'PID + feedforward from the plant', summary: 'PID; Kff, Kv, Ka from the plant\'s inverse',
    designed: true, version: 1, computes: ['Kff', 'Kv', 'Ka'], twin: 'pid',
    params: [
      num('Kp', 'Kp', 1), num('Ki', 'Ki', 0), num('Kd', 'Kd', 0), num('Tf', 'D filter Tf', 0.01, { unit: 's', min: 0 }), num('b', 'Setpoint weight b', 1, { help: 'weights r in the P part only; the feedforward makes up for it' }), PREFILTER,
      { key: 'order', label: 'Feedforward', default: '2', kind: 'choice', options: { 0: 'static: Kff', 1: 'and velocity: Kv', 2: 'and acceleration: Ka' }, help: 'how many terms of the plant\'s inverse: Kff (the input that holds y at r), Kv (per r/s), Ka (per r/s²)' },
      START, ...LIMITS, ...WINDUP,
    ],
    design: (p, ctx) => feedforwardDesign(p, ctx),
    make(p, Ts, values) { return values ? twinLaw(CONTROLLERS.pidFF.manual(p, values), Ts) : OFF; },
    manual: (p, values) => ({ type: 'pid', params: { Kp: p.Kp, Ki: p.Ki, Kd: p.Kd, Tf: p.Tf, b: p.b, Tr: p.Tr, Kff: values.Kff, Kv: values.Kv, Ka: values.Ka, u0: p.u0, umin: p.umin, umax: p.umax, aw: p.aw, Tt: p.Tt } }),
    linear: twinLinear('pidFF'),
  },
  swingUp: {
    label: 'Swing-up (Lyapunov) + state feedback', summary: 'energy pumping, then u = kr r − K · y',
    params: [...SWING, vec('K', 'Gains K', [-1, -30, -2, -5], { per: 'measurement' }), num('kr', 'Prefilter kr', -1), ...LIMITS],
    make(p) {
      let caught = false;
      return {
        step([r, x = 0, th = 0, v = 0, w = 0]) {
          const tw = wrap(th);
          if (Math.abs(tw) < p.thetaS) caught = true;
          else if (Math.abs(tw) > 2 * p.thetaS) caught = false;
          if (caught) {
            const y = [x, tw, v, w];
            let u = p.kr * r;
            for (let i = 0; i < p.K.length; i++) u -= p.K[i] * y[i];
            return clamp(u, p.umin, p.umax);
          }
          const E = 0.5 * p.l * p.l * w * w + p.g * p.l * (Math.cos(tw) - 1);
          const pump = Math.abs(w) < 1e-3 && Math.abs(Math.cos(tw) + 1) < 1e-3 ? 1 : p.kE * E * w * Math.cos(tw);
          return clamp(pump - p.kx * x - p.kv * v, p.umin, p.umax);
        },
      };
    },
    linear(p, Ts, at) {
      const th = wrap(at?.y?.[1] ?? 0);
      if (Math.abs(th) >= p.thetaS) throw new Error(`the swing-up pumps energy at θ = ${th.toFixed(2)} rad; it is a linear loop only where it catches (|θ| < ${p.thetaS} rad)`);
      return staticLinear(p.kr, p.K);
    },
  },
  swingUpLqr: {
    label: 'Swing-up + LQR catch', summary: 'energy pumping, then u = kr r − K · y, K from the plant',
    designed: true, version: 2, computes: ['K', 'kr', 'l', 'g'], twin: 'swingUp',
    params: [...SWING.filter((s) => s.key !== 'l' && s.key !== 'g'), ...WEIGHTS, ...LIMITS],
    design(p, ctx) {
      const lin = ctx.linearize('origin');
      const labels = lin.outputs.map((o) => o.label);
      if (lin.m !== 4 || !lin.outputs[1].angle) throw new DesignError('swing-inputs', `the swing-up reads x, θ, v, ω (θ an angle) from inputs 2 to 5; this block has ${labels.length ? labels.join(', ') : 'no measurements'}`, 'wire the cart–pole\'s x, θ, v, ω to inputs 2 to 5, or use LQR');
      const d = lqrDesign(lin, { Q: p.Q, R: p.R, track: 1, Ts: ctx.Ts });
      const { l, g } = poleOf(lin);
      return { values: { K: d.K, kr: d.kr, l, g }, rows: [...d.rows, { label: 'pole', value: [l, g], labels: ['l', 'g'], note: 'm, m/s²: what the pump measures energy with' }], warnings: d.warnings };
    },
    make(p, Ts, values) { return values ? twinLaw(CONTROLLERS.swingUpLqr.manual(p, values), Ts) : OFF; },
    manual: (p, values) => ({ type: 'swingUp', params: { kE: p.kE, kx: p.kx, kv: p.kv, l: values.l, g: values.g, thetaS: p.thetaS, K: [...values.K], kr: values.kr, umin: p.umin, umax: p.umax } }),
    linear: twinLinear('swingUpLqr'),
  },
  trajectory: {
    label: 'Planned swing-up + TV-LQR', summary: 'u = F(t) − K(t)·(y − y*(t)), then u = kr r − K·y',
    designed: true, version: 1, computes: ['F', 'Y', 'K', 'Kup', 'kr'],
    params: [
      num('T', 'Swing-up time T', 2.4, { unit: 's', positive: true, heavy: true, tune: false, help: 'how long the swing-up takes; rounded to whole samples' }),
      num('segments', 'Segments', 12, { int: true, min: 2, max: 40, heavy: true, tune: false, help: 'pieces the plan is solved in (multiple shooting); more take longer' }),
      num('planShare', 'Plan may use', 0.75, { min: 0.05, max: 1, heavy: true, tune: false, help: 'the share of the force limit the plan may use; the rest is left for the feedback' }),
      num('start', 'Starts at', 0, { unit: 's', min: 0, help: 'until then u = 0' }),
      ...WEIGHTS, ...LIMITS,
    ],
    design: (p, ctx) => trajectoryDesign(p, ctx),
    make(p, Ts, values) { return values ? planLaw(values, Ts, p) : OFF; },
    linear(p, Ts, at, values) {
      if (!values) throw noDesign('trajectory');
      const m = values.Kup.length, steps = values.F.length;
      const j = at?.t === undefined ? Infinity : Math.floor(at.t / Ts + 1e-9) - Math.round(p.start / Ts);
      if (j < 0) return { ...staticLinear(0, new Array(m).fill(0)), note: `before the plan starts (at ${p.start} s) u = 0: the loop is open` };
      if (j >= steps) return staticLinear(values.kr, values.Kup);
      return { ...staticLinear(0, Array.from(values.K.subarray(j * m, (j + 1) * m))), note: `the plan's gains at sample ${j} of ${steps} (t = ${((j + Math.round(p.start / Ts)) * Ts).toFixed(2)} s), frozen: along the plan they change every sample` };
    },
  },
  relay: {
    label: 'Relay (on/off)', summary: 'u = u0 ± d by the sign of e, hysteresis ε',
    params: [num('d', 'Amplitude d', 1, { unit: 'u', help: 'negative for a plant whose y falls when u rises' }), num('eps', 'Hysteresis ε', 0, { min: 0, help: 'switches when e = r − y passes +ε or −ε' }), num('u0', 'Bias u0', 0, { unit: 'u' }), ...LIMITS],
    make(p) {
      let high = null;
      return {
        step(x) {
          const e = x[0] - (x[1] ?? 0);
          if (high === null) high = e >= 0;
          if (e > p.eps) high = true;
          else if (e < -p.eps) high = false;
          return clamp(p.u0 + (high ? p.d : -p.d), p.umin, p.umax);
        },
      };
    },
    linear() { throw new Error('a relay switches between two outputs: it has no linear model'); },
  },
  slidingMode: {
    label: 'Sliding mode', summary: 'u = u0 + K·sign(s) or K·sat(s/φ), s = λe + ė',
    params: [
      num('lambda', 'Surface slope λ', 10, { unit: '1/s', min: 0, help: 'on the line s = 0 the error decays as e^(−λt): λ sets its time constant 1/λ' }),
      num('K', 'Switching gain K', 1, { unit: 'u', help: 'negative for a plant whose y falls when u rises' }),
      num('phi', 'Boundary layer φ', 0, { unit: 'y/s', min: 0, help: '0 is the ideal relay; above 0, proportional inside |s| < φ' }),
      PREFILTER, num('u0', 'Bias u0', 0, { unit: 'u' }), ...LIMITS,
    ],
    check: needsRate,
    make(p, Ts) {
      const surf = surface(p, Ts);
      return {
        step(x) {
          const s = surf(x);
          const sw = p.phi > 0 ? clamp(s / p.phi, -1, 1) : Math.sign(s);
          return clamp(p.u0 + p.K * sw, p.umin, p.umax);
        },
      };
    },
    linear(p, Ts, at) {
      if (!(p.phi > 0)) throw Object.assign(new Error('an ideal sliding mode switches: it has no linear model; give it a boundary layer φ > 0'), { hint: 'give it a boundary layer φ > 0, or analyse another variant' });
      const m = Math.max(2, at?.y?.length ?? 2), k = p.K / p.phi;
      const ys = [k * p.lambda, k, ...new Array(m - 2).fill(0)];
      if (!(p.Tr > 0)) return staticLinear(k * p.lambda, ys);
      const a = Math.exp(-Ts / p.Tr), c = (k * a) / ((1 - a) * p.Tr);
      return { A: [[0]], B: [[1, ...new Array(m).fill(0)]], C: [[-c]], D: [[k * p.lambda + c, ...ys.map((g) => -g)]], Tr: p.Tr };
    },
  },
  superTwisting: {
    label: 'Super-twisting', summary: 'u = k1·√|s|·sign(s) + v, v̇ = k2·sign(s)',
    params: [
      num('lambda', 'Surface slope λ', 10, { unit: '1/s', min: 0, help: 'on the line s = 0 the error decays as e^(−λt): λ sets its time constant 1/λ' }),
      num('k1', 'Gain k1', 1, { unit: 'u per √(y/s)', help: 'negative for a plant whose y falls when u rises' }),
      num('k2', 'Gain k2', 10, { unit: 'u/s', help: 'the rate of the integral part v; negative for a plant whose y falls when u rises' }),
      PREFILTER, START, ...LIMITS,
    ],
    check: needsRate,
    make(p, Ts) {
      const surf = surface(p, Ts);
      let v = clamp(p.u0, p.umin, p.umax);
      return {
        step(x) {
          const s = surf(x), sg = Math.sign(s);
          const u = clamp(p.k1 * Math.sqrt(Math.abs(s)) * sg + v, p.umin, p.umax);
          v = clamp(v + Ts * p.k2 * sg, p.umin, p.umax);
          return u;
        },
      };
    },
    linear() { throw Object.assign(new Error('super-twisting has no linear model: √|s| has infinite slope at s = 0'), { hint: 'analyse another variant (a sliding mode with a boundary layer is linear inside it)' }); },
  },
};

function surface(p, Ts) {
  const pre = prefilter(p, Ts);
  return (x) => {
    const r = x[0], rf = pre(r);
    const rdot = p.Tr > 0 ? (r - rf) / p.Tr : 0;
    return p.lambda * (rf - (x[1] ?? 0)) + rdot - (x[2] ?? 0);
  };
}
function needsRate(p, ctx) {
  return ctx?.inputs !== undefined && ctx.inputs < 3 ? 'sliding mode needs ẏ on input 3: set the Controller block\'s Inputs to 3 in the Plant tab and wire the measured rate there (a Finite difference observer makes it from y)' : '';
}

const CONTROLLER_TYPES = Object.keys(CONTROLLERS);

function normalizeParam(spec, v, where) {
  if (spec.nullable && (v === null || v === '')) return null;
  v ??= spec.default;
  if (spec.kind === 'choice') {
    if (!Object.hasOwn(spec.options, v)) throw new Error(`${where}.${spec.key}: one of ${Object.keys(spec.options).join(', ')}`);
    return v;
  }
  if (spec.kind === 'vector') {
    if (v === null && spec.nullable) return null;   
    if (!Array.isArray(v) || !v.length || !v.every((x) => Number.isFinite(Number(x)))) throw new Error(`${where}.${spec.key}: a list of numbers`);
    if (spec.min !== undefined && v.some((x) => Number(x) < spec.min)) throw new Error(`${where}.${spec.key}: each at least ${spec.min}`);
    return v.map(Number);
  }
  if (v === null || v === '' || v === 'inf' || v === 'Infinity' || v === '-inf' || v === '-Infinity') return v && String(v).startsWith('-') ? -Infinity : spec.default;
  let n = Number(v);
  if (Number.isNaN(n)) throw new Error(`${where}.${spec.key}: expected a number`);
  if (spec.int) n = Math.round(n);
  if (spec.min !== undefined && n < spec.min) throw new Error(`${where}.${spec.key}: at least ${spec.min}`);
  if (spec.max !== undefined && n > spec.max) throw new Error(`${where}.${spec.key}: at most ${spec.max}`);
  if (spec.positive && !(n > 0)) throw new Error(`${where}.${spec.key}: above 0`);
  return n;
}

function normalizeVariant(v, where = 'variant', lib = CONTROLLERS, ctx = undefined) {
  if (lib[v?.type]?.migrate) v = lib[v.type].migrate(v);
  const def = lib[v?.type];
  if (!def) throw new Error(`${where}.type: one of ${Object.keys(lib).join(', ')}`);
  const given = (def.computes ?? []).filter((k) => v.params?.[k] !== undefined);
  if (given.length) {
    const inputs = def.params.map((p) => p.key).filter((k) => !/^(umin|umax|Tr|Kff|Kv|Ka|aw|Tt)$/.test(k));
    const twins = [].concat(def.twin ?? []).map((t) => lib[t]?.label ?? t).join(' or ');
    throw new Error(`${where}.params.${given[0]}: ${v.type} computes ${and(def.computes)} from the plant and ${and(inputs)}; ${twins ? `to set them by hand use Copy as numbers (a ${twins} variant)` : 'they are never kept in a file'}`);
  }
  const params = {};
  for (const spec of def.params) params[spec.key] = normalizeParam(spec, v.params?.[spec.key], where);
  if (params.umin > params.umax) [params.umin, params.umax] = [params.umax, params.umin];
  const bad = def.check?.(params, ctx);
  if (bad) throw new Error(`${where}: ${bad}`);
  return { name: String(v.name ?? def.label).slice(0, 40), type: v.type, params };
}

const same = (a, b) => (Array.isArray(b) ? Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]) : a === b);
function makeLaw(variant, Ts, lib = CONTROLLERS, values = null) {
  if (typeof variant.law === 'function') return variant.law(Ts);
  const { params } = normalizeVariant(variant, 'variant', lib);
  const keep = variant.params && Object.keys(params).every((k) => same(variant.params[k], params[k]));
  return lib[variant.type].make(keep ? variant.params : params, Ts, values);
}


return { ANTI_WINDUP, trackingTime, CONTROLLERS, CONTROLLER_TYPES, normalizeVariant, makeLaw };
})();
// ---- core/structure.js
__mods['core/structure.js'] = (() => {

const { trackingTime, ANTI_WINDUP } = __mods['core/controllers.js'];
const DIAGRAM_WIDTH = 276;

function fmt(v) {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? '–' : v > 0 ? '∞' : '−∞';
  if (v === 0) return '0';
  const a = Math.abs(v);
  let x = v, unit = '';
  if (a >= 1e4) { x = v / 1e3; unit = 'k'; }
  else if (a < 1e-3) { x = v * 1e6; unit = 'µ'; }
  return `${Number(x.toPrecision(3))}${unit}`.replace('-', '−');
}
const secs = (v) => (Number.isFinite(v) && v !== 0 && Math.abs(v) < 0.1 ? `${fmt(v * 1e3)} ms` : `${fmt(v)} s`);
const range = (xs) => { if (xs.some(Number.isNaN)) return '–'; const lo = Math.min(...xs), hi = Math.max(...xs); return lo === hi ? fmt(lo) : `${fmt(lo)}…${fmt(hi)}`; };
const secsRange = (xs) => {
  if (!xs.length || xs.some(Number.isNaN)) return '–';
  const lo = Math.min(...xs), hi = Math.max(...xs);
  if (lo === hi) return secs(lo);
  return Math.abs(hi) < 0.1 ? `${fmt(lo * 1e3)}…${fmt(hi * 1e3)} ms` : `${fmt(lo)}…${fmt(hi)} s`;
};
const kv = (k, v) => [[`${k} `, 'k'], [v, 'v']];
const short = (s, n = 8) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

function limitsText(lo, hi) {
  const a = Number.isFinite(lo), b = Number.isFinite(hi);
  if (!a && !b) return null;
  if (a && b) return lo === -hi ? `±${fmt(hi)}` : `${fmt(lo)}…${fmt(hi)}`;
  return a ? `≥ ${fmt(lo)}` : `≤ ${fmt(hi)}`;
}

const NOTE_CHAR = 6;

function sheet(title, w, h) {
  const nodes = [], wires = [];
  const add = (kind) => (o) => { const n = { kind, ...o }; nodes.push(n); return n; };
  const note = (o) => {
    const room = Math.floor((w - 6) / NOTE_CHAR), chars = [...o.text];
    if (chars.length > room) o = { ...o, text: `${chars.slice(0, room - 1).join('')}…`, tip: o.tip ?? o.text };
    const len = [...o.text].length * NOTE_CHAR, mid = o.anchor === 'middle';
    const x = mid ? Math.min(Math.max(o.x, 3 + len / 2), w - 3 - len / 2) : o.anchor === 'end' ? Math.min(Math.max(o.x, 3 + len), w - 3) : Math.max(3, Math.min(o.x, w - 3 - len));
    return add('note')({ ...o, x });
  };
  return {
    title, w, h, nodes, wires,
    block: add('block'), sum: add('sum'), bar: add('bar'), sat: add('sat'), relay: add('relay'), switch: add('switch'), port: add('port'), dot: add('dot'), note,
    wire: (pts, o = {}) => { wires.push({ pts, arrow: true, ...o }); },
    line: (pts, o = {}) => { wires.push({ pts, arrow: false, ...o }); },
    done() { return { title, w, h, nodes, wires }; },
  };
}

function reference(s, p, y, name = 'r') {
  s.port({ x: 4, y, text: name, anchor: 'start' });
  s.wire([[12, y], [16, y]]);
  s.block({ x: 39, y, w: 46, h: 16, lines: [kv('Tr', p.Tr > 0 ? secs(p.Tr) : '0')], faint: !(p.Tr > 0), tip: 'Prefilter (Vorfilter): a first-order lag that smooths the reference before the controller sees it; 0 is off' });
  s.line([[62, y], [70, y]]);
  s.dot({ x: 70, y });
}

function feedforward(s, p, fromY) {
  const terms = ['Kff', 'Kv', 'Ka'].filter((k) => p[k]).flatMap((k, i) => kv(`${i ? ' ' : ''}${k}`, fmt(p[k])));
  const off = !terms.length;
  s.wire([[70, fromY], [70, 14], [76, 14]], { faint: off });
  s.block({ x: 141, y: 14, w: 130, h: 16, lines: [[['FF ', 'k'], ...(off ? [['0', 'v']] : terms)]], faint: off, tip: `Reference feedforward: u gets Kff·rf + Kv·drf/dt + Ka·d²rf/dt² from the reference alone (Kff ${fmt(p.Kff ?? 0)}, Kv ${fmt(p.Kv ?? 0)}, Ka ${fmt(p.Ka ?? 0)}); 0 is off` });
  s.wire([[206, 14], [213, 14]], { faint: off });
  return off;
}

function output(s, p, top, bottom, signs, yOut) {
  s.bar({ x: 218, y: (top + bottom) / 2, w: 10, h: bottom - top, signs, yOut });
  s.wire([[223, yOut], [230, yOut]]);
  const lim = limitsText(p.umin, p.umax);
  s.sat({ x: 241, y: yOut, w: 22, h: 18, faint: !lim, tip: lim ? `Actuator limits: u stays within ${lim}` : 'No actuator limits' });
  const t = lim ?? 'no limit';
  s.note({ x: Math.max(241, 225 + ([...t].length * NOTE_CHAR) / 2), y: yOut - 15, text: t, anchor: 'middle', faint: !lim });
  s.wire([[252, yOut], [261, yOut]]);
  s.port({ x: 263, y: yOut, text: 'u', anchor: 'start' });
  return !lim;
}

function antiWindup(s, p, ix, iy, y, yOut, noLimits, tts, rule) {
  const aw = p.aw ?? 'clamp';
  const faint = noLimits;
  if (aw === 'off') {
    s.note({ x: ix, y, text: 'no anti-windup: ∫ winds up', anchor: 'middle', cls: 'warn', faint, tip: 'Anti-windup off: while u sits at a limit the integral keeps growing, and the loop overshoots until it has unwound' });
    return;
  }
  if (aw === 'back') {
    const tt = secsRange(tts);
    s.wire([[241, yOut + 9], [241, y], [229, y]], { faint });
    s.block({ x: 214, y, w: 30, h: 16, lines: [[['1/Tt', 'k']]], faint, tip: `Back-calculation: the integral is pulled toward the limit by (u − v)/Tt, Tt ${tt}${p.Tt > 0 ? '' : ` (${rule})`}; a feedforward's own excess beyond a limit is left out` });
    s.wire([[199, y], [ix, y], [ix, iy]], { faint });
    s.note({ x: 245, y: (yOut + y) / 2, text: 'u−v', anchor: 'start', faint });
    s.note({ x: 214, y: y + 16, text: `${ANTI_WINDUP.back}, Tt ${tt}`, anchor: 'middle', faint });
    return;
  }
  s.wire([[241, yOut + 9], [241, y], [ix, y], [ix, iy]], { dashed: true, faint, tip: 'Clamping (conditional integration): the integral stops while u sits at a limit and the error pushes further' });
  s.note({ x: (ix + 241) / 2, y: y + 10, text: `${ANTI_WINDUP.clamp}: ∫ holds at a limit`, anchor: 'middle', faint });
}

function pid(p, { inputs, Ts }) {
  const s = sheet('PID', DIAGRAM_WIDTH, 144);
  const P = p.Kp !== 0, I = p.Ki !== 0, Dd = p.Kd !== 0;
  reference(s, p, 40);
  const ffOff = feedforward(s, p, 40);
  s.wire([[70, 40], [78, 40]], { faint: !P || !p.b });
  s.block({ x: 90, y: 40, w: 24, h: 16, lines: [kv('b', fmt(p.b))], faint: !P || !p.b, tip: 'Setpoint weight b: how much of r the P part sees (two degrees of freedom). It softens the answer to a change of r without changing the loop; it is not feedforward' });
  s.wire([[102, 40], [109, 40]], { faint: !P });
  s.sum({ x: 114, y: 40, r: 5, signs: { w: '+', s: '−' }, faint: !P });
  s.wire([[119, 40], [122, 40]], { faint: !P });
  s.block({ x: 144, y: 40, w: 44, h: 16, lines: [kv('Kp', fmt(p.Kp))], faint: !P, tip: 'Proportional gain Kp' });
  s.wire([[166, 40], [213, 40]], { faint: !P });
  s.port({ x: 4, y: 66, text: 'y', anchor: 'start', tip: `Measurement: ${inputs[1] ?? 'not connected'}` });
  s.line([[12, 66], [114, 66]], { over: true, faint: !(P || I || Dd) });
  s.line([[114, 66], [132, 66]], { faint: !(I || Dd) });
  s.wire([[132, 66], [147, 66]], { faint: !Dd });
  s.dot({ x: 114, y: 66, faint: !P });
  s.dot({ x: 132, y: 66, faint: !I || !Dd });
  s.wire([[114, 66], [114, 45]], { faint: !P });
  s.wire([[132, 66], [132, 87]], { faint: !I });
  s.block({ x: 177, y: 66, w: 60, h: 26, lines: [[['d/dt ', ''], ...kv('Kd', fmt(p.Kd))], kv('Tf', secs(p.Tf))], faint: !Dd, tip: 'D on the measurement, filtered: Kd·dy/dt through a lag Tf, subtracted at the sum, so a step of r gives no kick' });
  s.wire([[207, 66], [213, 66]], { faint: !Dd });
  s.wire([[70, 40], [70, 92], [127, 92]], { faint: !I });
  s.sum({ x: 132, y: 92, r: 5, signs: { w: '+', n: '−' }, faint: !I });
  s.wire([[137, 92], [142, 92]], { faint: !I });
  const iy = p.u0 ? 110 : 100;
  s.block({ x: 168, y: p.u0 ? 97 : 92, w: 52, h: p.u0 ? 26 : 16, lines: [[['∫ ', ''], ...kv('Ki', fmt(p.Ki))], ...(p.u0 ? [kv('u0', fmt(p.u0))] : [])], faint: !I, tip: `Integral gain Ki on the error rf − y; it starts at u0 ${fmt(p.u0)}` });
  s.wire([[194, 92], [213, 92]], { faint: !I });
  const noLimits = output(s, p, 6, 100, [[14, ffOff ? '' : '+'], [40, '+'], [66, '−'], [92, '+']], 53);
  if (I) antiWindup(s, p, 168, iy, 120, 53, noLimits, [Number.isNaN(p.Ki) ? NaN : trackingTime(p, Ts)], '√(Ti·Td), or Ti/2 without D');
  return s.done();
}

function gainScheduled(p, { inputs, Ts }) {
  const s = sheet('Gain-scheduled PI', DIAGRAM_WIDTH, 144);
  const I = p.Ki.some((v) => v !== 0);
  reference(s, p, 44);
  const ffOff = feedforward(s, p, 44);
  s.wire([[70, 44], [95, 44]]);
  s.sum({ x: 100, y: 44, r: 5, signs: { w: '+', s: '−' } });
  s.wire([[105, 44], [112, 44]]);
  const bottom = p.u0 ? 63 : 58;
  s.block({ x: 159, y: 44, w: 94, h: p.u0 ? 38 : 28, lines: [kv('Kp(y)', range(p.Kp)), [['∫ ', ''], ...kv('Ki(y)', range(p.Ki))], ...(p.u0 ? [kv('u0', fmt(p.u0))] : [])], tip: `A PI on the error, Kp and Ki looked up from the measurement y (interpolated between the points of the table); the integral starts at u0 ${fmt(p.u0)}` });
  s.wire([[206, 44], [213, 44]]);
  s.port({ x: 4, y: 92, text: 'y', anchor: 'start', tip: `Measurement: ${inputs[1] ?? 'not connected'}` });
  s.line([[12, 92], [100, 92]]);
  s.dot({ x: 100, y: 92 });
  s.wire([[100, 92], [100, 49]]);
  s.wire([[100, 92], [116, 92]]);
  s.block({ x: 146, y: 92, w: 60, h: 26, lines: [[['table', 'k']], [[`y ${range(p.at)}`, 'v']]], tip: `The schedule: Kp and Ki at y = ${p.at.map(fmt).join(', ')}` });
  s.wire([[146, 79], [146, bottom]], { dotted: true, tip: 'The table sets Kp and Ki' });
  s.note({ x: 142, y: (79 + bottom) / 2, text: 'Kp, Ki', anchor: 'end' });
  const noLimits = output(s, p, 6, 52, [[14, ffOff ? '' : '+'], [44, '+']], 29);
  const tts = p.at.map((_, i) => (Number.isNaN(p.Ki[i]) ? NaN : trackingTime({ Kp: p.Kp[i], Ki: p.Ki[i], Kd: 0, Tt: p.Tt }, Ts))).filter((t, i) => p.Ki[i] !== 0);
  if (I) antiWindup(s, p, 186, bottom, 120, 29, noLimits, tts, 'Ti/2 at each point of the schedule, Ti = Kp/Ki');
  return s.done();
}

function stateFeedback(p, { inputs }) {
  const m = p.K.length;
  const rowY = (i) => 40 + 16 * i;
  const s = sheet('State feedback', DIAGRAM_WIDTH, rowY(m - 1) + 16);
  s.port({ x: 4, y: 14, text: 'r', anchor: 'start' });
  s.wire([[12, 14], [16, 14]]);
  s.block({ x: 39, y: 14, w: 46, h: 16, lines: [kv('Tr', p.Tr > 0 ? secs(p.Tr) : '0')], faint: !(p.Tr > 0), tip: 'Prefilter (Vorfilter) on r; 0 is off' });
  s.wire([[62, 14], [74, 14]], { faint: p.kr === 0 });
  s.block({ x: 100, y: 14, w: 52, h: 16, lines: [kv('kr', fmt(p.kr))], faint: p.kr === 0, tip: 'Static prefilter kr: scales r so the output settles at r' });
  s.wire([[126, 14], [191, 14]], { faint: p.kr === 0 });
  s.sum({ x: 196, y: 14, r: 5, signs: { w: '+', s: '−' } });
  const top = rowY(0) - 8, bottom = rowY(m - 1) + 8, mid = (top + bottom) / 2;
  for (let i = 0; i < m; i++) {
    const y = rowY(i), off = p.K[i] === 0;
    s.port({ x: 4, y, text: short(inputs[i + 1] ?? `y${i + 1}`), anchor: 'start', faint: off, tip: `Input ${i + 2}: ${inputs[i + 1] ?? 'not connected'}` });
    s.wire([[58, y], [74, y]], { faint: off });
    s.block({ x: 100, y, w: 52, h: 14, lines: [kv(`K${i + 1}`, fmt(p.K[i]))], faint: off });
    s.wire([[126, y], [149, y]], { faint: off });
  }
  s.bar({ x: 153, y: mid, w: 8, h: bottom - top, signs: [], yOut: mid, label: false });
  s.wire([[157, mid], [196, mid], [196, 19]]);
  s.note({ x: 192, y: mid - 7, text: 'K·y', anchor: 'end' });
  s.wire([[201, 14], [212, 14]]);
  const lim = limitsText(p.umin, p.umax);
  s.sat({ x: 223, y: 14, w: 22, h: 18, faint: !lim, tip: lim ? `Actuator limits: u stays within ${lim}` : 'No actuator limits' });
  const lt = lim ?? 'no limit';
  s.note({ x: Math.max(223, 207 + ([...lt].length * NOTE_CHAR) / 2), y: 31, text: lt, anchor: 'middle', faint: !lim });
  s.wire([[234, 14], [252, 14]]);
  s.port({ x: 254, y: 14, text: 'u', anchor: 'start' });
  return s.done();
}

function swingUp(p, { inputs }) {
  const s = sheet('Swing-up + state feedback', DIAGRAM_WIDTH, 124);
  const th = inputs[2] ?? 'θ';
  s.port({ x: 4, y: 24, text: 'y', anchor: 'start', tip: `Measurements: ${inputs.slice(1).join(', ') || 'x, θ, v, ω'}` });
  s.wire([[12, 24], [55, 24]]);
  s.dot({ x: 34, y: 24 });
  s.wire([[34, 24], [34, 72], [55, 72]]);
  s.port({ x: 4, y: 90, text: 'r', anchor: 'start' });
  s.wire([[12, 90], [55, 90]]);
  s.block({ x: 125, y: 24, w: 140, h: 38, lines: [[['pump ', 'k'], ['kE·E·ω·cos θ', '']], [['− kx·x − kv·v', '']], [...kv('kE', fmt(p.kE)), ...kv('  kx', fmt(p.kx)), ...kv('  kv', fmt(p.kv))]], tip: 'Energy pumping (a Lyapunov design): E = ½l²ω² + gl(cos θ − 1) is 0 upright; this push makes ½E² fall, so each swing climbs higher, while kx, kv keep the cart near the middle' });
  s.block({ x: 125, y: 80, w: 140, h: 38, lines: [[['catch ', 'k'], ['kr·r − K·y', '']], kv('K', p.K.map(fmt).join(' ')), kv('kr', fmt(p.kr))], tip: 'Near the top: state feedback on x, θ, v, ω holds the pole upright' });
  s.line([[195, 24], [202, 24], [202, 40], [206, 40]]);
  s.line([[195, 80], [202, 80], [202, 64], [206, 64]]);
  s.switch({ a: [208, 40], b: [208, 64], pivot: [224, 52], to: 'a', tip: `Switches to the catch when |${th}| < ${fmt(p.thetaS)} rad, back to pumping when |${th}| > ${fmt(2 * p.thetaS)} rad (hysteresis)` });
  s.wire([[224, 52], [232, 52]]);
  const lim = limitsText(p.umin, p.umax);
  s.sat({ x: 243, y: 52, w: 20, h: 18, faint: !lim });
  s.note({ x: 243, y: 37, text: lim ?? 'no limit', anchor: 'middle', faint: !lim });
  s.wire([[253, 52], [261, 52]]);
  s.port({ x: 263, y: 52, text: 'u', anchor: 'start' });
  s.note({ x: 135, y: 114, text: `catch when |${short(th, 6)}| < ${fmt(p.thetaS)} rad, pump above ${fmt(2 * p.thetaS)} rad`, anchor: 'middle' });
  return s.done();
}

function relay(p) {
  const s = sheet('Relay', DIAGRAM_WIDTH, 76);
  s.port({ x: 4, y: 26, text: 'r', anchor: 'start' });
  s.wire([[12, 26], [51, 26]]);
  s.sum({ x: 56, y: 26, r: 5, signs: { w: '+', s: '−' } });
  s.port({ x: 4, y: 56, text: 'y', anchor: 'start' });
  s.wire([[12, 56], [56, 56], [56, 31]]);
  s.wire([[61, 26], [80, 26]]);
  s.relay({ x: 100, y: 26, w: 40, h: 24, tip: `Relay with hysteresis: +d when e > ε, −d when e < −ε, else as before (d ${fmt(p.d)}, ε ${fmt(p.eps)})` });
  s.note({ x: 100, y: 7, text: `±d ${fmt(p.d)}   ε ${fmt(p.eps)}`, anchor: 'middle' });
  s.wire([[120, 26], [150, 26]]);
  s.sum({ x: 155, y: 26, r: 5, signs: { w: '+', s: '+' } });
  s.block({ x: 155, y: 56, w: 40, h: 16, lines: [kv('u0', fmt(p.u0))], faint: !p.u0, tip: 'Bias u0: the relay swings about it' });
  s.wire([[155, 48], [155, 31]], { faint: !p.u0 });
  s.wire([[160, 26], [196, 26]]);
  const lim = limitsText(p.umin, p.umax);
  s.sat({ x: 207, y: 26, w: 22, h: 18, faint: !lim });
  s.note({ x: 207, y: 46, text: lim ?? 'no limit', anchor: 'middle', faint: !lim });
  s.wire([[218, 26], [252, 26]]);
  s.port({ x: 254, y: 26, text: 'u', anchor: 'start' });
  return s.done();
}

function off() {
  const s = sheet('Off', DIAGRAM_WIDTH, 56);
  s.port({ x: 4, y: 14, text: 'r', anchor: 'start', faint: true });
  s.port({ x: 4, y: 34, text: 'y', anchor: 'start', faint: true });
  s.line([[12, 14], [60, 14]], { faint: true });
  s.line([[12, 34], [60, 34]], { faint: true });
  s.block({ x: 135, y: 24, w: 60, h: 18, lines: [[['u = 0', 'v']]], tip: 'No control: the plant gets u = 0' });
  s.wire([[165, 24], [252, 24]]);
  s.port({ x: 254, y: 24, text: 'u', anchor: 'start' });
  s.note({ x: 135, y: 48, text: 'nothing reads r or y: the plant runs on its own', anchor: 'middle' });
  return s.done();
}

function estimator(p, { inputs }, kind, { n = p.B.length, m = p.C.length / p.B.length, lines = [] } = {}) {
  const s = sheet(kind === 'kalman' ? 'Kalman filter' : 'Luenberger observer', DIAGRAM_WIDTH, 95 + 11 * (kind === 'kalman' ? lines.length : 1));
  s.port({ x: 4, y: 36, text: 'u', anchor: 'start', tip: `Plant input: ${inputs[0] ?? 'not connected'}` });
  s.wire([[12, 36], [24, 36]]);
  s.block({ x: 74, y: 36, w: 100, h: 28, lines: [[['predict', 'k']], [['Ad·x̂ + Bd·u', '']]], tip: 'Predict: the model, discretised at Ts, carries the estimate one sample ahead with the input u' });
  s.wire([[124, 36], [140, 36]]);
  s.block({ x: 190, y: 36, w: 100, h: 28, lines: [[['correct', 'k']], [['+ L·(y − C·x̂)', '']]], tip: 'Correct: the estimate moves toward the measurements by the gain L times what the model did not predict' });
  s.wire([[240, 36], [252, 36]]);
  s.dot({ x: 246, y: 36 });
  s.port({ x: 254, y: 36, text: 'x̂', anchor: 'start', tip: Number.isNaN(n) ? 'the estimated states' : `${n} estimated states` });
  s.wire([[246, 36], [246, 9], [165, 9]]);
  s.block({ x: 150, y: 9, w: 30, h: 13, lines: [[['z⁻¹', '']]], tip: 'The estimate of the sample before' });
  s.wire([[135, 9], [74, 9], [74, 22]]);
  s.port({ x: 4, y: 70, text: 'y', anchor: 'start', tip: `Measurements: ${inputs.slice(1).join(', ') || 'none'}` });
  s.wire([[12, 70], [190, 70], [190, 50]]);
  s.note({ x: 4, y: 87, text: `${Number.isNaN(n) ? 'the states it sees' : `${n} state${n === 1 ? '' : 's'}`}, ${m} measurement${m === 1 ? '' : 's'}`, anchor: 'start' });
  if (kind === 'kalman') lines.forEach((text, i) => s.note({ x: 4, y: 98 + 11 * i, text, anchor: 'start' }));
  else s.note({ x: 4, y: 98, text: `L ${p.L.map(fmt).join(' ')}`, anchor: 'start' });
  return s.done();
}

function difference(p, { inputs }) {
  const s = sheet('Finite difference', DIAGRAM_WIDTH, 76);
  s.port({ x: 4, y: 20, text: 'y', anchor: 'start', tip: `Measurements: ${inputs.slice(1).join(', ') || 'none'}` });
  s.wire([[12, 20], [252, 20]]);
  s.port({ x: 254, y: 20, text: 'y', anchor: 'start' });
  s.dot({ x: 40, y: 20 });
  s.wire([[40, 20], [40, 50], [70, 50]]);
  s.block({ x: 100, y: 50, w: 60, h: 16, lines: [[['Δy / Ts', '']]], tip: 'The rate: the change of each measurement over one sample' });
  s.wire([[130, 50], [155, 50]]);
  s.block({ x: 190, y: 50, w: 70, h: 16, lines: [kv('lag', p.Tf > 0 ? secs(p.Tf) : '0')], faint: !(p.Tf > 0), tip: 'A first-order low-pass on the rate; 0 is off' });
  s.wire([[225, 50], [252, 50]]);
  s.port({ x: 254, y: 50, text: 'ẏ', anchor: 'start' });
  s.note({ x: 4, y: 68, text: 'a quantised or noisy y makes the rate jump', anchor: 'start' });
  return s.done();
}

function generic(v, def) {
  const s = sheet(def?.label ?? v.type, DIAGRAM_WIDTH, 60);
  s.port({ x: 4, y: 20, text: 'r', anchor: 'start' });
  s.port({ x: 4, y: 40, text: 'y', anchor: 'start' });
  s.wire([[12, 20], [40, 20], [40, 26], [58, 26]]);
  s.wire([[12, 40], [40, 40], [40, 34], [58, 34]]);
  s.block({ x: 140, y: 30, w: 164, h: 30, lines: [[[def?.label ?? v.type, 'k']], [[def?.summary ?? '', '']]] });
  s.wire([[222, 30], [252, 30]]);
  s.port({ x: 254, y: 30, text: 'u', anchor: 'start' });
  return s.done();
}

function slidingSurface(s, p, inputs, y0) {
  s.port({ x: 4, y: y0, text: 'r', anchor: 'start' });
  s.wire([[12, y0], [16, y0]]);
  s.block({ x: 39, y: y0, w: 46, h: 16, lines: [kv('Tr', p.Tr > 0 ? secs(p.Tr) : '0')], faint: !(p.Tr > 0), tip: 'Prefilter (Vorfilter) on r; its own derivative ṙf = (r − rf)/Tr goes into ė, so the law never differentiates; 0 is off' });
  s.wire([[62, y0], [77, y0]]);
  s.sum({ x: 82, y: y0, r: 5, signs: { w: '+', s: '−' } });
  const y = short(inputs[1] ?? 'y'), dy = short(inputs[2] ?? 'ẏ');
  const after = (t) => Math.ceil(4 + [...t].length * 6.6 + 3);
  s.port({ x: 4, y: y0 + 26, text: y, anchor: 'start', tip: `Measurement y: ${inputs[1] ?? 'not connected'}` });
  s.line([[after(y), y0 + 26], [82, y0 + 26]]);
  s.wire([[82, y0 + 26], [82, y0 + 5]]);
  s.wire([[87, y0], [96, y0]]);
  s.block({ x: 112, y: y0, w: 32, h: 16, lines: [kv('λ', fmt(p.lambda))], faint: !p.lambda, tip: `Surface slope λ ${fmt(p.lambda)} 1/s: on the line s = 0 the error decays as e^(−λt), whatever the inertia` });
  s.wire([[128, y0], [137, y0]]);
  s.sum({ x: 142, y: y0, r: 5, signs: { w: '+', s: '−' } });
  s.port({ x: 4, y: y0 + 46, text: dy, anchor: 'start', tip: `The rate ẏ, input 3: ${inputs[2] ?? 'not connected'} (ė = ṙf − ẏ)` });
  s.line([[after(dy), y0 + 46], [142, y0 + 46]]);
  s.wire([[142, y0 + 46], [142, y0 + 5]]);
  s.note({ x: 148, y: y0 - 6, text: 's', anchor: 'start' });
  return 147;
}

function slidingMode(p, { inputs }) {
  const s = sheet('Sliding mode', DIAGRAM_WIDTH, 112);
  const y0 = 22, x = slidingSurface(s, p, inputs, y0), relayLaw = !(p.phi > 0);
  s.wire([[x, y0], [154, y0]]);
  if (relayLaw) s.relay({ x: 172, y: y0, w: 34, h: 22, tip: 'sign(s): +1 above the line, −1 below; it switches every sample it crosses' });
  else s.block({ x: 174, y: y0, w: 40, h: 26, lines: [[['sat', 'k']], kv('φ', fmt(p.phi))], tip: `Boundary layer: s/φ inside |s| < φ ${fmt(p.phi)}, ±1 outside` });
  if (relayLaw) s.note({ x: 172, y: 6, text: 'sign', anchor: 'middle' });
  s.wire([[relayLaw ? 189 : 194, y0], [200, y0]]);
  s.block({ x: 218, y: y0, w: 36, h: p.u0 ? 26 : 16, lines: [kv('K', fmt(p.K)), ...(p.u0 ? [kv('+', fmt(p.u0))] : [])], tip: `Switching gain K ${fmt(p.K)}${p.u0 ? `, plus the bias u0 ${fmt(p.u0)}` : ''}` });
  s.wire([[236, y0], [240, y0]]);
  const lim = limitsText(p.umin, p.umax);
  s.sat({ x: 250, y: y0, w: 18, h: 16, faint: !lim, tip: lim ? `Actuator limits: u stays within ${lim}` : 'No actuator limits' });
  s.note({ x: 250, y: y0 + 18, text: lim ?? 'no limit', anchor: 'middle', faint: !lim });
  s.wire([[259, y0], [262, y0]], { arrow: false });
  s.port({ x: 263, y: y0, text: 'u', anchor: 'start' });
  s.note({ x: 4, y: 88, text: `s = λ·e + ė; on s = 0, e decays with 1/λ ${p.lambda > 0 ? secs(1 / p.lambda) : '∞'}`, anchor: 'start' });
  s.note({ x: 4, y: 100, text: relayLaw ? 'φ 0: the ideal relay; it chatters' : `inside |s| < φ a PD: Kp ${fmt((p.K * p.lambda) / p.phi)}, Kd ${fmt(p.K / p.phi)}`, anchor: 'start', cls: relayLaw ? 'warn' : '' });
  return s.done();
}

function superTwisting(p, { inputs, Ts }) {
  const s = sheet('Super-twisting', DIAGRAM_WIDTH, 112);
  const y0 = 22, x = slidingSurface(s, p, inputs, y0);
  s.dot({ x: 154, y: y0 });
  s.line([[x, y0], [154, y0]]);
  s.wire([[154, y0], [159, y0]]);
  s.block({ x: 193, y: y0, w: 68, h: 16, lines: [[['√|s| ', ''], ...kv('k1', fmt(p.k1))]], faint: !p.k1, tip: `The proportional part k1·√|s|·sign(s), k1 ${fmt(p.k1)}: continuous, steepest near s = 0` });
  s.wire([[227, y0], [233, y0]]);
  s.wire([[154, y0], [154, 66], [159, 66]]);
  s.block({ x: 193, y: 66, w: 68, h: p.u0 ? 26 : 16, lines: [[['∫ sgn ', ''], ...kv('k2', fmt(p.k2))], ...(p.u0 ? [kv('v0', fmt(p.u0))] : [])], faint: !p.k2, tip: `The integral part v: it rises at k2 ${fmt(p.k2)} by the sign of s (every Ts ${secs(Ts)}), clamped to the limits; it starts at u0 ${fmt(p.u0)} and rejects a constant load` });
  s.wire([[227, 66], [238, 66], [238, y0 + 5]]);
  s.sum({ x: 238, y: y0, r: 5, signs: { w: '+', s: '+' } });
  s.note({ x: 242, y: 50, text: 'v', anchor: 'start' });
  s.wire([[243, y0], [246, y0]], { arrow: false });
  const lim = limitsText(p.umin, p.umax);
  s.sat({ x: 255, y: y0, w: 16, h: 16, faint: !lim, tip: lim ? `Actuator limits: u and v stay within ${lim} (v's clamp is the anti-windup)` : 'No actuator limits' });
  s.note({ x: 255, y: 7, text: lim ?? 'no limit', anchor: 'middle', faint: !lim });
  s.port({ x: 264, y: y0, text: 'u', anchor: 'start' });
  s.note({ x: 4, y: 88, text: `s = λ·e + ė; on s = 0, e decays with 1/λ ${p.lambda > 0 ? secs(1 / p.lambda) : '∞'}`, anchor: 'start' });
  s.note({ x: 4, y: 100, text: 'continuous u; v rejects a constant load', anchor: 'start' });
  return s.done();
}

const UNKNOWN = NaN;
const unknown = (n) => new Array(n).fill(UNKNOWN);
function below(d, text, title = d.title) {
  const room = Math.floor((d.w - 6) / NOTE_CHAR), chars = [...text];
  const cut = chars.length > room ? `${chars.slice(0, room - 1).join('')}…` : text;
  return { ...d, title, h: d.h + 13, nodes: [...d.nodes, { kind: 'note', x: 4, y: d.h + 6, text: cut, anchor: 'start', ...(cut !== text ? { tip: text } : {}) }] };
}
const weights = (p) => `Q ${p.Q.map(fmt).join(' ')}, R ${fmt(p.R)}`;

function lqr(p, o) {
  const v = o.values, m = Math.max(1, o.inputs.length - 1);
  const d = stateFeedback({ K: v?.K ?? unknown(m), kr: v?.kr ?? UNKNOWN, Tr: p.Tr, umin: p.umin, umax: p.umax }, o);
  return below(d, `K, kr: LQR from the plant at its origin, ${weights(p)}`, 'LQR');
}

function scheduledPI(p, o) {
  const v = o.values, n = p.at.length;
  const common = { Tr: p.Tr, Kff: p.Kff, Kv: p.Kv, Ka: p.Ka, u0: v?.u0 ?? 0, umin: p.umin, umax: p.umax, aw: p.aw, Tt: p.Tt };
  const d = n === 1
    ? pid({ Kp: v?.Kp[0] ?? UNKNOWN, Ki: v?.Ki[0] ?? UNKNOWN, Kd: 0, Tf: 0.01, b: 1, ...common }, o)
    : gainScheduled({ at: p.at, Kp: v?.Kp ?? unknown(n), Ki: v?.Ki ?? unknown(n), ...common }, o);
  return below(d, `Kp, Ki, u0 from the plant at y = ${p.at.map(fmt).join(', ')}; Tcl ${secs(p.Tcl)}`, 'PI from the plant');
}

function pidFF(p, o) {
  const v = o.values;
  const d = pid({ Kp: p.Kp, Ki: p.Ki, Kd: p.Kd, Tf: p.Tf, b: p.b, Tr: p.Tr, Kff: v?.Kff ?? UNKNOWN, Kv: v?.Kv ?? UNKNOWN, Ka: v?.Ka ?? UNKNOWN, u0: p.u0, umin: p.umin, umax: p.umax, aw: p.aw, Tt: p.Tt }, o);
  return below(d, `Kff, Kv, Ka: the plant's inverse at its origin, with the PID's Kp (1 − b) and Kd; order ${p.order}`, 'PID + feedforward from the plant');
}

function swingUpLqr(p, o) {
  const v = o.values;
  const d = swingUp({ ...p, K: v?.K ?? unknown(4), kr: v?.kr ?? UNKNOWN }, o);
  return below(d, `K, kr: LQR from the plant, ${weights(p)}; l, g too`, 'Swing-up + LQR catch');
}

function trajectory(p, { inputs, values }) {
  const v = values, steps = v?.F?.length ?? 0;
  const s = sheet('Planned swing-up + TV-LQR', DIAGRAM_WIDTH, 116);
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < steps; k++) { lo = Math.min(lo, v.F[k]); hi = Math.max(hi, v.F[k]); }
  s.block({ x: 70, y: 20, w: 110, h: 26, lines: [[['plan ', 'k'], ['F(t), y*(t)', '']], [...kv('T', secs(p.T)), ...kv('  seg.', String(p.segments))]], tip: `The plan: the force F(t) that takes the plant from where it starts to rest at the origin in T ${secs(p.T)}, and the measurements y*(t) along it; computed in the page from the plant (${p.segments} segments, multiple shooting), using ${fmt(100 * p.planShare)} % of each force limit` });
  s.wire([[125, 14], [213, 14]]);
  s.note({ x: 132, y: 7, text: 'F(t)', anchor: 'start' });
  s.wire([[100, 33], [100, 55]]);
  s.port({ x: 4, y: 60, text: 'y', anchor: 'start', tip: `Measurements: ${inputs.slice(1).join(', ') || 'none'}` });
  s.wire([[12, 60], [95, 60]]);
  s.sum({ x: 100, y: 60, r: 5, signs: { w: '+', n: '−' } });
  s.wire([[105, 60], [118, 60]]);
  s.block({ x: 148, y: 60, w: 60, h: 16, lines: [[['K(t) ', 'k'], ['TV-LQR', '']]], tip: `Time-varying LQR along the plan (Q ${p.Q.map(fmt).join(' ')}, R ${fmt(p.R)}): it corrects what the plant does off the plan, with the gains of each sample` });
  s.wire([[178, 60], [213, 60]]);
  output(s, p, 6, 68, [[14, '+'], [60, '−']], 37);
  s.note({ x: 4, y: 86, text: 'after T: u = kr·r − K·y, the LQR at the origin', anchor: 'start' });
  s.note({ x: 4, y: 98, text: `u = 0 until ${secs(p.start)}; the plan may use ${fmt(100 * p.planShare)} % of u`, anchor: 'start' });
  s.note({ x: 4, y: 110, text: steps ? `planned from the plant: F ${fmt(lo)}…${fmt(hi)}` : 'planned from the plant: F – (not yet)', anchor: 'start' });
  return s.done();
}

function kalman(p, o) {
  const v = o.values;
  const n = v ? v.B.length : UNKNOWN, m = v ? v.C.length / v.B.length : Math.max(1, o.inputs.length - 1);
  const lines = ['model and L from the plant, at its origin', `Q ${p.Q.map(fmt).join(' ')}  R ${p.R ? p.R.map(fmt).join(' ') : 'from the sensors'}`];
  return estimator(p, o, 'kalman', { n, m, lines });
}

function kalmanModel(p, o) {
  const lines = ['L from your model A, B, C, Q and R (Riccati)', `Q ${p.Q.map(fmt).join(' ')}  R ${p.R.map(fmt).join(' ')}`];
  return estimator(p, o, 'kalman', { lines });
}

const LAYOUTS = { pid, pidFF, gainScheduled, stateFeedback, swingUp, relay, slidingMode, superTwisting, off, lqr, scheduledPI, swingUpLqr, trajectory, kalman, kalmanModel, luenberger: (p, o) => estimator(p, o, 'luenberger'), difference };

function describeVariant(variant, { inputs = [], Ts = 0.01, def = null, values = null } = {}) {
  const layout = LAYOUTS[variant.type];
  return layout ? layout(variant.params, { inputs, Ts, values }) : generic(variant, def);
}

const DESCRIBED_TYPES = Object.keys(LAYOUTS);

return { DIAGRAM_WIDTH, fmt, limitsText, NOTE_CHAR, describeVariant, DESCRIBED_TYPES };
})();
// ---- core/observers.js
__mods['core/observers.js'] = (() => {

const { c2d, dlqe } = __mods['core/linalg.js'];
const { kalmanDesign } = __mods['core/design.js'];
const { normalizeVariant } = __mods['core/controllers.js'];
const num = (key, label, def, extra = {}) => ({ key, label, default: def, ...extra });
const vec = (key, label, def, extra = {}) => ({ key, label, default: def, kind: 'vector', ...extra });

function model(p) {
  const n = p.B.length, m = p.C.length / n;
  const A = Array.from({ length: n }, (_, i) => p.A.slice(i * n, i * n + n));
  const B = p.B.map((b) => [b]);
  const C = Array.from({ length: m }, (_, i) => p.C.slice(i * n, i * n + n));
  return { n, m, A, B, C };
}
const MODEL = [vec('A', 'Model A (rows)', [0, 1, 0, 0]), vec('B', 'Model B', [0, 1]), vec('C', 'Model C (rows)', [1, 0])];
function checkModel(p) {
  const n = p.B.length;
  if (p.A.length !== n * n) return `A needs n·n = ${n * n} values for n = ${n} states (the length of B)`;
  if (p.C.length % n) return `C needs a multiple of n = ${n} values, one row per measurement`;
  return '';
}

function estimator(p, keys, design) {
  let d = null, seen = [], x, xp, e, out, first = true;
  const current = () => {
    if (d && keys.every((k, i) => p[k] === seen[i])) return d;
    seen = keys.map((k) => p[k]);
    const next = design();
    if (!d || next.n !== d.n) { x = new Float64Array(next.n); xp = new Float64Array(next.n); out = new Float64Array(next.n); first = true; }
    if (!d || next.m !== d.m) e = new Float64Array(next.m);
    d = next;
    return d;
  };
  current();
  return {
    step(inp) {
      const { n, m, Ad, Bd, C, L } = current();
      const u = inp[0] ?? 0;
      if (first) { first = false; } else {
        for (let i = 0; i < n; i++) { let s = Bd[i][0] * u; for (let j = 0; j < n; j++) s += Ad[i][j] * x[j]; xp[i] = s; }
        x.set(xp);
      }
      for (let k = 0; k < m; k++) {
        let s = inp[k + 1] ?? 0;
        for (let j = 0; j < n; j++) s -= C[k][j] * x[j];
        e[k] = s;
      }
      for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < m; k++) s += L[i][k] * e[k]; x[i] += s; }
      out.set(x);
      return out;
    },
  };
}

const NONE = new Float64Array(0);
const ZERO = { step: () => NONE };

const OBSERVERS = {
  kalman: {
    label: 'Kalman filter', summary: 'x̂ = prediction + L (y − C x̂), model and L from the plant',
    designed: true, version: 1, computes: ['A', 'B', 'C', 'L'], twin: 'luenberger',
    params: [
      vec('Q', 'Process noise Q', [1], { min: 0, help: 'one value: the variance of a random push on u, per sample; or one per state' }),
      vec('R', 'Measurement noise R', null, { nullable: true, per: 'measurement', empty: 'empty: from the sensor blocks', help: 'the variance of the noise on each measurement (one value: all); empty takes it from the noise and quantizer blocks on its way' }),
    ],
    check(p) { return p.R && !p.R.every((v) => v > 0) ? 'R: each above 0' : ''; },
    design(p, ctx) {
      const d = kalmanDesign(ctx.linearize('origin'), { Q: p.Q, R: p.R, Ts: ctx.Ts, outputs: ctx.outputs });
      return { values: d.values, rows: d.rows, warnings: d.warnings, quality: d.quality };
    },
    make(p, Ts, values) { return values ? OBSERVERS.luenberger.make(normalizeVariant(OBSERVERS.kalman.manual(p, values), 'variant', OBSERVERS).params, Ts) : ZERO; },
    manual: (p, values) => ({ type: 'luenberger', params: { A: [...values.A], B: [...values.B], C: [...values.C], L: [...values.L] } }),
    migrate: (v) => (['A', 'B', 'C'].some((k) => v.params?.[k] !== undefined) && v.params?.L === undefined ? { ...v, type: 'kalmanModel' } : v),
  },
  kalmanModel: {
    label: 'Kalman filter, own model', summary: 'x̂ = model prediction + L (y − C x̂), L from your model, Q and R',
    params: [...MODEL, vec('Q', 'Process noise Q (diag)', [1, 1], { min: 0 }), vec('R', 'Measurement noise R (diag)', [1], { min: 0 })],
    check(p) { const bad = checkModel(p); if (bad) return bad; if (p.Q.length !== p.B.length) return 'Q needs one value per state'; if (p.R.length !== p.C.length / p.B.length) return 'R needs one value per measurement'; if (!p.R.every((v) => v > 0)) return 'R: each above 0'; return ''; },
    make(p, Ts) {
      return estimator(p, ['A', 'B', 'C', 'Q', 'R'], () => {
        const { n, m, A, B, C } = model(p);
        const { Ad, Bd } = c2d(A, B, Ts);
        const diag = (v) => v.map((x, i) => v.map((_, j) => (i === j ? x : 0)));
        const { L } = dlqe(Ad, C, diag(p.Q), diag(p.R));
        return { n, m, Ad, Bd, C, L };
      });
    },
  },
  luenberger: {
    label: 'Luenberger observer', summary: 'x̂ = model prediction + L (y − C x̂), L given',
    params: [...MODEL, vec('L', 'Gain L (rows)', [0.5, 10])],
    check(p) { const bad = checkModel(p); if (bad) return bad; if (p.L.length !== p.C.length) return 'L needs n × m values, row by row'; return ''; },
    make(p, Ts) {
      return estimator(p, ['A', 'B', 'C', 'L'], () => {
        const { n, m, A, B, C } = model(p);
        const { Ad, Bd } = c2d(A, B, Ts);
        const L = Array.from({ length: n }, (_, i) => p.L.slice(i * m, i * m + m));
        return { n, m, Ad, Bd, C, L };
      });
    },
  },
  difference: {
    label: 'Finite difference', summary: 'x̂ = [y, Δy / Ts, filtered]',
    params: [num('Tf', 'Rate filter Tf', 0, { unit: 's', min: 0 })],
    make(p, Ts) {
      let prev = null, rate = null, out = null;
      return {
        step(inp) {
          const a = p.Tf > 0 ? Ts / (p.Tf + Ts) : 1;
          const y = Array.from(inp).slice(1);
          out ??= new Float64Array(2 * y.length);
          prev ??= y; rate ??= y.map(() => 0);
          rate = rate.map((r, i) => r + a * ((y[i] - prev[i]) / Ts - r));
          prev = y;
          out.set([...y, ...rate].slice(0, out.length));
          return out;
        },
      };
    },
  },
};

const OBSERVER_TYPES = Object.keys(OBSERVERS);

return { OBSERVERS, OBSERVER_TYPES };
})();
// ---- core/hil.js
__mods['core/hil.js'] = (() => {

const HIL_URL = 'ws://127.0.0.1:8765';
const HIL_PROTOCOL = 'loop-tuner-hil/1';
const WATCHDOG_CYCLES = 10;

const rpcRequest = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
const rpcNotice = (method, params) => JSON.stringify({ jsonrpc: '2.0', method, params });
const nine = (v) => (Number.isFinite(v) ? Number(v.toPrecision(9)) : null);
const uMessage = (seq, u, log) => rpcNotice('u', { seq, u: Array.from(u, nine), ...(log?.length ? { log: Array.from(log, nine) } : {}) });
const startParams = (log) => (log?.length ? { log: log.map(({ name, unit }) => ({ name, unit })) } : undefined);

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

function parseMessage(text) {
  let m;
  try { m = JSON.parse(text); } catch { return { kind: 'invalid', error: 'not JSON' }; }
  if (!m || typeof m !== 'object' || m.jsonrpc !== '2.0') return { kind: 'invalid', error: 'not a JSON-RPC 2.0 message' };
  if (m.id !== undefined && m.id !== null && !m.method) {
    if (m.error) return { kind: 'error', id: m.id, error: String(m.error.message ?? 'error'), code: m.error.code };
    return { kind: 'result', id: m.id, result: m.result };
  }
  if (m.id === null && m.error) return { kind: 'invalid', error: String(m.error.message ?? 'error') };
  const p = m.params ?? {};
  if (m.method === 'y') {
    if (!Number.isInteger(p.seq) || !finite(p.t) || !Array.isArray(p.y)) return { kind: 'invalid', error: 'y needs seq (integer), t (s) and y (a list)' };
    const applied = Array.isArray(p.applied) ? p.applied.map((v) => (finite(v) ? v : NaN)) : null;
    return { kind: 'y', seq: p.seq, t: p.t, y: p.y.map((v) => (finite(v) ? v : NaN)), applied };
  }
  if (m.method === 'estop') return { kind: 'estop', reason: String(p.reason ?? 'E-stop'), t: finite(p.t) ? p.t : null };
  if (m.method === 'running') {
    if (typeof p.running !== 'boolean') return { kind: 'invalid', error: 'running needs running (true or false)' };
    return { kind: 'running', running: p.running, by: String(p.by ?? 'plant'), reason: p.reason ? String(p.reason) : '' };
  }
  if (m.method === 'status') return { kind: 'status', status: p };
  return { kind: 'invalid', error: `unknown method ${m.method}` };
}

const PORT_NAME = /^[A-Za-z][A-Za-z0-9_]{0,15}$/;
const checkUnit = (u, where) => {
  const s = String(u ?? '1').trim() || '1';
  if (s.length > 12 || /[<>"{},]/.test(s)) throw new Error(`${where}: a short unit such as V, rad/s or 1`);
  return s;
};

const INPUT_KINDS = ['effort', 'reference', 'disturbance'];
const modeOf = (kinds) => (!kinds.length ? 'log' : kinds.includes('reference') ? 'reference' : 'control');
const range = (p, where, [a, b] = ['min', 'max'], what = 'its full scale') => {
  if (p?.[a] === undefined && p?.[b] === undefined) return [null, null];
  const lo = Number(p[a]), hi = Number(p[b]);
  if (!finite(lo) || !finite(hi) || !(lo < hi)) throw new Error(`${where} needs ${a} < ${b} (${what})`);
  return [lo, hi];
};

function checkDescription(d) {
  if (!d || typeof d !== 'object') throw new Error('describe: expected an object');
  const rate = Number(d.rate_hz);
  if (!(rate >= 1 && rate <= 1000)) throw new Error('describe: rate_hz between 1 and 1000');
  const port = (p, i, side) => {
    const where = `describe: ${side}[${i}]`;
    if (!PORT_NAME.test(p?.name ?? '')) throw new Error(`${where}.name: letters, digits and _, up to 16`);
    return { name: p.name, unit: checkUnit(p.unit, `${where}.unit`) };
  };
  if (!Array.isArray(d.inputs) || d.inputs.length > 8) throw new Error('describe: inputs, a list of 0 to 8');
  if (!Array.isArray(d.outputs) || !d.outputs.length || d.outputs.length > 16) throw new Error('describe: outputs, a list of 1 to 16');
  const outputs = d.outputs.map((p, i) => {
    const [min, max] = range(p, `describe: outputs[${i}]`);
    const [hard_min, hard_max] = range(p, `describe: outputs[${i}]`, ['hard_min', 'hard_max'], 'its hard range: beyond it the plant E-stops');
    const kind = p.kind === 'effort' ? 'effort' : 'measurement';
    return { ...port(p, i, 'outputs'), min, max, hard_min, hard_max, kind };
  });
  const byDefault = d.mode === 'reference' ? 'reference' : 'effort';
  const inputs = d.inputs.map((p, i) => {
    const q = port(p, i, 'inputs');
    const min = Number(p.min), max = Number(p.max), safe = Number(p.safe ?? 0);
    if (!finite(min) || !finite(max) || !(min <= max)) throw new Error(`describe: inputs[${i}] needs min <= max`);
    if (!(safe >= min && safe <= max)) throw new Error(`describe: inputs[${i}].safe must lie within min and max`);
    const kind = p.kind ?? byDefault;
    if (!INPUT_KINDS.includes(kind)) throw new Error(`describe: inputs[${i}].kind: one of ${INPUT_KINDS.join(', ')}`);
    const measures = p.measures ? String(p.measures) : '';
    if (measures && !outputs.some((o) => o.name === measures)) throw new Error(`describe: inputs[${i}].measures: "${measures}" is not an output`);
    return { ...q, min, max, safe, kind, measures };
  });
  const slew = Number(d.slew);
  return {
    protocol: String(d.protocol ?? ''),
    name: String(d.name ?? 'external plant').slice(0, 80),
    rate_hz: rate,
    mode: modeOf(inputs.map((p) => p.kind)),
    inputs,
    outputs,
    watchdog: Number.isInteger(d.watchdog_cycles) && d.watchdog_cycles > 0 ? d.watchdog_cycles : WATCHDOG_CYCLES,
    estop: d.estop ? String(d.estop) : null,
    running: !!d.running,
    slew: finite(slew) && slew > 0 ? slew : null,
  };
}


const RAMP_DEFAULT = 10;  
const split = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[,;]/)).map((x) => String(x).trim()).filter((x) => x !== '');
const splitKeep = (v) => (Array.isArray(v) ? v.map((x) => (x === null || x === undefined ? '' : String(x).trim())) : String(v ?? '').trim() === '' ? [] : String(v).split(/[,;]/).map((x) => x.trim()));
const numbers = (v, where) => split(v).map((x) => {
  const n = Number(String(x).replace(/−/g, '-'));
  if (!finite(n)) throw new Error(`${where}: numbers separated by commas`);
  return n;
});
const maybeNumbers = (v, where) => splitKeep(v).map((x) => {
  if (x === '' || x === '–' || /^(none|null|nan)$/i.test(x)) return null;
  const n = Number(x.replace(/−/g, '-'));
  if (!finite(n)) throw new Error(`${where}: numbers separated by commas (empty: not given)`);
  return n;
});
const fit = (list, n, def) => Array.from({ length: n }, (_, i) => list[i] ?? (typeof def === 'function' ? def(i) : def));

const EXTERNAL_BLOCK = {
  label: 'External plant', group: 'Live', formula: 'u → plant → y, live over WebSocket',
  params: [
    { key: 'url', label: 'Plant at', default: HIL_URL, kind: 'text' },
    { key: 'rate', label: 'Cycle rate', default: 100, unit: 'Hz', min: 1, max: 1000 },
    { key: 'inputs', label: 'Inputs u', default: ['u'], kind: 'list' },
    { key: 'inUnits', label: 'Units of u', default: ['1'], kind: 'list' },
    { key: 'min', label: 'u min', default: [-1], kind: 'list' },
    { key: 'max', label: 'u max', default: [1], kind: 'list' },
    { key: 'safe', label: 'Safe u', default: [0], kind: 'list' },
    { key: 'kinds', label: 'Kinds of u', default: [], kind: 'list' },
    { key: 'measures', label: 'u measured as', default: [], kind: 'list' },
    { key: 'outputs', label: 'Outputs y', default: ['y'], kind: 'list' },
    { key: 'outUnits', label: 'Units of y', default: ['1'], kind: 'list' },
    { key: 'outMin', label: 'y full scale min', default: [], kind: 'list' },
    { key: 'outMax', label: 'y full scale max', default: [], kind: 'list' },
    { key: 'ymin', label: 'y hard min', default: [], kind: 'list' },
    { key: 'ymax', label: 'y hard max', default: [], kind: 'list' },
    { key: 'outKinds', label: 'Kinds of y', default: [], kind: 'list' },
    { key: 'ramp', label: 'Ramp-in', default: RAMP_DEFAULT, unit: '%/s', min: 0.01, max: 1000 },
    { key: 'scales', label: 'Full scales', default: {}, kind: 'hidden' },
  ],
  ports: (p) => [p.inputs.length, p.outputs.length],
  outputs: (p) => p.outputs,
  inputNames: (p) => p.inputs,  
  summary: (p) => `${p.rate} Hz${modeOf(p.kinds ?? []) === 'reference' ? ' · reference mode' : !p.inputs.length ? ' · logging' : ''}`,
  normalize(params = {}, where = 'external') {
    const d = Object.fromEntries(EXTERNAL_BLOCK.params.map((p) => [p.key, params[p.key] ?? p.default]));
    const url = String(d.url).trim();
    if (!/^wss?:\/\/[^\s"'<>]{1,200}$/.test(url)) throw new Error(`${where}.url: a WebSocket address such as ${HIL_URL}`);
    const rate = Number(d.rate);
    if (!(rate >= 1 && rate <= 1000)) throw new Error(`${where}.rate: between 1 and 1000 Hz`);
    const names = (v, key, least) => {
      const out = split(v);
      if (out.length < least || out.length > 16) throw new Error(`${where}.${key}: ${least} to 16 names, separated by commas`);
      for (const n of out) if (!PORT_NAME.test(n)) throw new Error(`${where}.${key}: "${n}" is not a name (letters, digits, _)`);
      return out;
    };
    const inputs = names(d.inputs, 'inputs', 0), outputs = names(d.outputs, 'outputs', 1);
    const n = inputs.length, m = outputs.length;
    const min = fit(numbers(d.min, `${where}.min`), n, -1), max = fit(numbers(d.max, `${where}.max`), n, 1);
    for (let i = 0; i < n; i++) if (min[i] > max[i]) [min[i], max[i]] = [max[i], min[i]];
    const safe = fit(numbers(d.safe, `${where}.safe`), n, (i) => Math.min(max[i], Math.max(min[i], 0))).map((v, i) => Math.min(max[i], Math.max(min[i], v)));
    const kinds = fit(splitKeep(d.kinds).map((k) => k || 'effort'), n, 'effort');
    for (const k of kinds) if (!INPUT_KINDS.includes(k)) throw new Error(`${where}.kinds: one of ${INPUT_KINDS.join(', ')} per input`);
    const measures = fit(splitKeep(d.measures), n, '');
    for (const o of measures) if (o && !outputs.includes(o)) throw new Error(`${where}.measures: "${o}" is not an output`);
    const pairs = (a, b) => {
      const lo = fit(maybeNumbers(d[a], `${where}.${a}`), m, null), hi = fit(maybeNumbers(d[b], `${where}.${b}`), m, null);
      for (let j = 0; j < m; j++) if (lo[j] === null || hi[j] === null || !(lo[j] < hi[j])) lo[j] = hi[j] = null;
      return [lo, hi];
    };
    const [outMin, outMax] = pairs('outMin', 'outMax'), [ymin, ymax] = pairs('ymin', 'ymax');
    const outKinds = fit(splitKeep(d.outKinds).map((k) => (k === 'effort' ? 'effort' : 'measurement')), m, 'measurement');
    const ramp = Number(d.ramp);
    if (!(ramp >= 0.01 && ramp <= 1000)) throw new Error(`${where}.ramp: from 0.01 to 1000 % of full scale per second`);
    const scales = {};
    for (const [name, pair] of Object.entries(d.scales && typeof d.scales === 'object' ? d.scales : {})) {
      const [lo, hi] = Array.isArray(pair) ? pair.map(Number) : [NaN, NaN];
      if (!PORT_NAME.test(name) || !finite(lo) || !finite(hi) || !(lo < hi)) throw new Error(`${where}.scales.${name}: [min, max] with min < max`);
      scales[name] = [lo, hi];
    }
    return {
      url, rate, inputs,
      inUnits: fit(split(d.inUnits), n, '1').map((u, i) => checkUnit(u, `${where}.inUnits[${i}]`)),
      min, max, safe, kinds, measures, outputs,
      outUnits: fit(split(d.outUnits), m, '1').map((u, i) => checkUnit(u, `${where}.outUnits[${i}]`)),
      outMin, outMax, ymin, ymax, outKinds, ramp, scales,
    };
  },
};

function externalParams(desc, prev = {}) {
  const keep = typeof prev === 'string' ? { url: prev } : prev ?? {};
  return EXTERNAL_BLOCK.normalize({
    url: keep.url ?? HIL_URL, rate: desc.rate_hz,
    inputs: desc.inputs.map((p) => p.name), inUnits: desc.inputs.map((p) => p.unit),
    min: desc.inputs.map((p) => p.min), max: desc.inputs.map((p) => p.max), safe: desc.inputs.map((p) => p.safe),
    kinds: desc.inputs.map((p) => p.kind ?? 'effort'), measures: desc.inputs.map((p) => p.measures ?? ''),
    outputs: desc.outputs.map((p) => p.name), outUnits: desc.outputs.map((p) => p.unit),
    outMin: desc.outputs.map((p) => p.min ?? null), outMax: desc.outputs.map((p) => p.max ?? null),
    ymin: desc.outputs.map((p) => p.hard_min ?? null), ymax: desc.outputs.map((p) => p.hard_max ?? null),
    outKinds: desc.outputs.map((p) => p.kind ?? 'measurement'),
    ramp: keep.ramp ?? RAMP_DEFAULT, scales: keep.scales ?? {},
  });
}

function interfaceOf(params) {
  const pair = (lo, hi, j) => (lo?.[j] === null || lo?.[j] === undefined || hi?.[j] === null || hi?.[j] === undefined ? null : [lo[j], hi[j]]);
  return {
    mode: modeOf(params.kinds ?? []), rate: params.rate,
    inputs: params.inputs.map((name, i) => ({ name, unit: params.inUnits[i], fullScale: [params.min[i], params.max[i]], safe: params.safe[i], kind: params.kinds?.[i] ?? 'effort', measures: params.measures?.[i] || null })),
    outputs: params.outputs.map((name, j) => ({ name, unit: params.outUnits[j], fullScale: pair(params.outMin, params.outMax, j), hard: pair(params.ymin, params.ymax, j), kind: params.outKinds?.[j] ?? 'measurement' })),
  };
}

const blockMode = (params) => modeOf(params.kinds ?? []);

function findExternal(d) {
  for (const b of d?.blocks ?? []) {
    if (b.type === 'external') return { block: b, level: d };
    if (b.type === 'subsystem') { const hit = findExternal(b.diagram); if (hit) return hit; }
  }
  return null;
}

const samePorts = (params, desc) => params.inputs.join() === desc.inputs.map((p) => p.name).join() && params.outputs.join() === desc.outputs.map((p) => p.name).join();

function sameDescription(params, desc) {
  const want = externalParams(desc, params);
  return JSON.stringify(want) === JSON.stringify(EXTERNAL_BLOCK.normalize(params));
}

function fullScales(params, links) {
  const out = {};
  const outRange = (j) => (j >= 0 && params.outMin?.[j] !== null && params.outMin?.[j] !== undefined && params.outMax?.[j] !== null ? [params.outMin[j], params.outMax[j]] : null);
  const inRange = (i) => [params.min[i], params.max[i]];
  for (const [name, at] of Object.entries(links?.sinks ?? {})) {
    const r = at.output !== undefined ? outRange(at.output) : at.input !== undefined ? inRange(at.input) : null;
    if (r) out[name] = r;
  }
  for (const [name, at] of Object.entries(links?.sources ?? {})) {
    let r = null;
    if (at.measured !== undefined) r = outRange(at.measured);
    if (!r && at.input !== undefined) {
      const j = params.outputs.indexOf(params.measures?.[at.input] ?? '');
      r = (params.kinds?.[at.input] === 'reference' ? outRange(j) : null) ?? inRange(at.input);
    }
    if (r) out[name] = r;
  }
  for (const [name, pair] of Object.entries(params.scales ?? {})) out[name] = [...pair];
  return out;
}

function fullScaleChannel([lo, hi]) {
  const scale = Number(((hi - lo) / 8).toPrecision(4));
  return { scale, offset: Number((-(lo + hi) / 2).toPrecision(6)) || 0 };
}

function pageWatchdog({ now, lastY, rateHz, cycles = WATCHDOG_CYCLES }) {
  const silent = Math.max(0, Math.floor(((now - lastY) / 1000) * rateHz + 1e-9));
  return { silent, trip: silent >= cycles };
}

function createLinkStats(rateHz) {
  let n = 0, t0 = null, last = null, lastSeq = null, jitter = 0, compute = 0, computeMax = 0;
  let missed = 0;
  const period = 1000 / rateHz;
  return {
    add(at, seq, computeMs = 0) {
      if (lastSeq !== null && seq > lastSeq + 1) missed += seq - lastSeq - 1;
      if (last !== null && lastSeq !== null && seq === lastSeq + 1) jitter = Math.max(jitter, Math.abs(at - last - period));
      t0 ??= at;
      n++; last = at; lastSeq = seq;
      compute += computeMs; computeMax = Math.max(computeMax, computeMs);
    },
    read() {
      const span = n > 1 ? (last - t0) / 1000 : 0;
      const out = { rate: span > 0 ? (n - 1) / span : 0, jitter, missed, compute: n ? compute / n : 0, computeMax };
      jitter = 0; compute = 0; computeMax = 0;
      t0 = last; n = last === null ? 0 : 1;
      return out;
    },
  };
}

return { HIL_URL, HIL_PROTOCOL, WATCHDOG_CYCLES, rpcRequest, rpcNotice, uMessage, startParams, parseMessage, INPUT_KINDS, modeOf, checkDescription, RAMP_DEFAULT, EXTERNAL_BLOCK, externalParams, interfaceOf, blockMode, findExternal, samePorts, sameDescription, fullScales, fullScaleChannel, pageWatchdog, createLinkStats };
})();
// ---- core/xml.js
__mods['core/xml.js'] = (() => {

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decode(s, line) {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);?/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    if (!(e in ENTITIES) || !m.endsWith(';')) throw new Error(`XML, line ${line}: unknown entity "${m}"`);
    return ENTITIES[e];
  });
}

function parseXml(text) {
  let i = 0;
  const n = text.length;
  let lk = 0, ll = 1;
  const lineAt = (k) => {
    if (k < lk) { lk = 0; ll = 1; }
    for (; lk < k; lk++) if (text.charCodeAt(lk) === 10) ll++;
    return ll;
  };
  const fail = (msg, k = i) => { throw new Error(`XML, line ${lineAt(k)}: ${msg}`); };
  const stack = [];
  let root = null;
  while (i < n) {
    const lt = text.indexOf('<', i);
    const chunk = text.slice(i, lt < 0 ? n : lt);
    if (stack.length) stack[stack.length - 1].text += decode(chunk, lineAt(i));
    else if (chunk.trim()) fail('text outside the root element');
    if (lt < 0) break;
    i = lt;
    if (text.startsWith('<!--', i)) {
      const e = text.indexOf('-->', i + 4);
      if (e < 0) fail('a comment is not closed');
      i = e + 3;
    } else if (text.startsWith('<![CDATA[', i)) {
      const e = text.indexOf(']]>', i);
      if (e < 0) fail('a CDATA section is not closed');
      if (!stack.length) fail('CDATA outside the root element');
      stack[stack.length - 1].text += text.slice(i + 9, e);
      i = e + 3;
    } else if (text.startsWith('<?', i)) {
      const e = text.indexOf('?>', i);
      if (e < 0) fail('a processing instruction is not closed');
      i = e + 2;
    } else if (text.startsWith('<!', i)) {
      fail('document type declarations are not read');
    } else if (text[i + 1] === '/') {
      const m = /^<\/([^\s>]+)\s*>/.exec(text.slice(i, i + 200));
      if (!m) fail('a malformed closing tag');
      const open = stack.pop();
      if (!open || open.name !== m[1]) fail(open ? `</${m[1]}> closes <${open.name}>` : `</${m[1]}> closes nothing`);
      i += m[0].length;
    } else {
      const start = i;
      const m = /^<([A-Za-z_][\w.:-]*)/.exec(text.slice(i, i + 200));
      if (!m) fail('a malformed tag');
      const el = { name: m[1], attrs: {}, children: [], text: '', line: lineAt(start) };
      i += m[0].length;
      const attr = /\s*([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')|\s*(\/?>)/y;
      for (;;) {
        attr.lastIndex = i;
        const a = attr.exec(text);
        if (!a) fail(`a malformed attribute in <${el.name}>`);
        i = attr.lastIndex;
        if (a[5]) {
          if (stack.length) stack[stack.length - 1].children.push(el);
          else if (root) fail('a second root element', start);
          else root = el;
          if (a[5] === '>') stack.push(el);
          break;
        }
        if (a[1] in el.attrs) fail(`<${el.name}> has two "${a[1]}" attributes`);
        el.attrs[a[1]] = decode(a[3] ?? a[4], el.line);
      }
    }
  }
  if (stack.length) fail(`<${stack[stack.length - 1].name}> is not closed`, n);
  if (!root) throw new Error('XML: no element');
  return root;
}

const xmlChildren = (el, name) => el.children.filter((c) => c.name === name);
const xmlChild = (el, name) => el.children.find((c) => c.name === name) ?? null;

return { parseXml, xmlChildren, xmlChild };
})();
// ---- core/urdf.js
__mods['core/urdf.js'] = (() => {

const { parseXml, xmlChildren, xmlChild } = __mods['core/xml.js'];
const fmt = (v) => String(+v.toPrecision(6));

function numbers(s, k, what) {
  const v = String(s).trim().split(/\s+/).map(Number);
  if (v.length !== k || v.some((x) => !Number.isFinite(x))) throw new Error(`URDF: ${what} must be ${k} numbers, not "${s}"`);
  return v;
}

function rpyMatrix(r, p, y) {
  const cr = Math.cos(r), sr = Math.sin(r), cp = Math.cos(p), sp = Math.sin(p), cy = Math.cos(y), sy = Math.sin(y);
  return [
    cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr,
    sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr,
    -sp, cp * sr, cp * cr,
  ];
}

function origin(el, what) {
  const o = el && xmlChild(el, 'origin');
  const p = o?.attrs.xyz != null ? numbers(o.attrs.xyz, 3, `${what}'s origin xyz`) : [0, 0, 0];
  const rpy = o?.attrs.rpy != null ? numbers(o.attrs.rpy, 3, `${what}'s origin rpy`) : [0, 0, 0];
  return { R: rpyMatrix(...rpy), p };
}

const mm = (A, B) => [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j]));
const mv = (A, v) => [0, 1, 2].map((i) => A[3 * i] * v[0] + A[3 * i + 1] * v[1] + A[3 * i + 2] * v[2]);
const tr = (A) => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
const rotI = (R, I) => mm(mm(R, I), tr(R));

function symEig3(S) {
  const a = [[S[0], S[1], S[2]], [S[3], S[4], S[5]], [S[6], S[7], S[8]]];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = a[0][1] ** 2 + a[0][2] ** 2 + a[1][2] ** 2;
    if (off <= 1e-30 * (a[0][0] ** 2 + a[1][1] ** 2 + a[2][2] ** 2) || off === 0) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (a[p][q] === 0) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
    }
  }
  return [a[0][0], a[1][1], a[2][2]];
}

function inertiaProblem(m, I) {
  if (!(m >= 0)) return `mass ${fmt(m)} kg is below 0`;
  const asym = Math.max(Math.abs(I[1] - I[3]), Math.abs(I[2] - I[6]), Math.abs(I[5] - I[7]));
  const scale = Math.max(Math.abs(I[0]), Math.abs(I[4]), Math.abs(I[8]), 1e-300);
  if (asym > 1e-12 * scale) return 'the inertia tensor is not symmetric';
  const e = symEig3(I), tol = 1e-12 * scale;
  if (Math.min(...e) < -tol) return `moments ${e.map(fmt).join(', ')} are not positive semi-definite: no rigid body has them`;
  for (let k = 0; k < 3; k++) {
    if (e[(k + 1) % 3] + e[(k + 2) % 3] < e[k] - tol) return `moments ${e.map(fmt).join(', ')} break the triangle inequality: no rigid body has them`;
  }
  return null;
}

function readGeometry(g, where) {
  const shape = g && g.children[0];
  if (!shape) throw new Error(`URDF: ${where} has no geometry`);
  const a = shape.attrs;
  if (shape.name === 'box') return { type: 'box', size: numbers(a.size, 3, `${where}'s box size`) };
  if (shape.name === 'cylinder') return { type: 'cylinder', radius: Number(a.radius), length: Number(a.length) };
  if (shape.name === 'sphere') return { type: 'sphere', radius: Number(a.radius) };
  if (shape.name === 'mesh') return { type: 'mesh', filename: a.filename ?? '' };
  throw new Error(`URDF: ${where} has an unknown geometry <${shape.name}>`);
}

function rgbaOf(el) {
  const c = el && xmlChild(el, 'color');
  return c?.attrs.rgba != null ? numbers(c.attrs.rgba, 4, 'a colour') : null;
}

const cache = new Map();

function parseUrdf(text, { inertia: inertiaMode = 'refuse' } = {}) {
  const key = `${inertiaMode}\n${text}`;
  if (cache.has(key)) return cache.get(key);
  const model = readUrdf(text, inertiaMode);
  if (cache.size > 16) cache.delete(cache.keys().next().value);
  cache.set(key, model);
  return model;
}

function readUrdf(text, inertiaMode) {
  if (/<xacro:|xmlns:xacro|\$\{/.test(text)) throw new Error('URDF: this is Xacro (macros); expand it to plain URDF first (xacro robot.urdf.xacro > robot.urdf)');
  const doc = parseXml(text);
  if (doc.name !== 'robot') throw new Error(`URDF: the root element is <${doc.name}>, not <robot>`);
  if (doc.attrs.version != null && doc.attrs.version !== '1.0') throw new Error(`URDF: version ${doc.attrs.version} is not read (only 1.0)`);
  const warnings = [];
  const materials = new Map(xmlChildren(doc, 'material').map((m) => [m.attrs.name, rgbaOf(m)]));

  const links = new Map();
  for (const el of xmlChildren(doc, 'link')) {
    const name = el.attrs.name;
    if (!name) throw new Error('URDF: a link has no name');
    if (links.has(name)) throw new Error(`URDF: two links are named "${name}"`);
    const inert = xmlChild(el, 'inertial');
    let m = 0, c = [0, 0, 0], I = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    if (inert) {
      const o = origin(inert, `link ${name}'s inertial`);
      m = Number(xmlChild(inert, 'mass')?.attrs.value ?? 0);
      const t = xmlChild(inert, 'inertia')?.attrs ?? {};
      const v = (k) => Number(t[k] ?? 0);
      if (![m, ...['ixx', 'ixy', 'ixz', 'iyy', 'iyz', 'izz'].map(v)].every(Number.isFinite)) throw new Error(`URDF: link ${name}'s inertial values must be numbers`);
      I = rotI(o.R, [v('ixx'), v('ixy'), v('ixz'), v('ixy'), v('iyy'), v('iyz'), v('ixz'), v('iyz'), v('izz')]);
      c = o.p;
      const why = inertiaProblem(m, I);
      if (why) {
        const s = `link ${name}: ${why}`;
        if (inertiaMode !== 'warn') throw new Error(`URDF: ${s}`);
        warnings.push(s);
      }
    }
    const collisions = xmlChildren(el, 'collision').map((k) => ({ origin: origin(k, `link ${name}'s collision`), geom: readGeometry(xmlChild(k, 'geometry'), `link ${name}'s collision`) }));
    const visuals = xmlChildren(el, 'visual').map((vis) => {
      const mat = xmlChild(vis, 'material');
      let v = { origin: origin(vis, `link ${name}'s visual`), geom: readGeometry(xmlChild(vis, 'geometry'), `link ${name}'s visual`), material: mat?.attrs.name ?? null, rgba: rgbaOf(mat) ?? (mat ? materials.get(mat.attrs.name) ?? null : null) };
      if (v.geom.type === 'mesh') {
        const prim = collisions.find((k) => k.geom.type !== 'mesh');
        warnings.push(`link ${name}: the mesh "${v.geom.filename}" cannot be loaded by a standalone page; it is drawn as ${prim ? `its collision ${prim.geom.type}` : 'a 5 cm box'}`);
        v = { ...v, ...(prim ? { origin: prim.origin, geom: prim.geom } : { geom: { type: 'box', size: [0.05, 0.05, 0.05] } }) };
      }
      return v;
    });
    links.set(name, { name, m, c, I, visuals });
  }

  const joints = [];
  const parentOf = new Map();
  for (const el of xmlChildren(doc, 'joint')) {
    const name = el.attrs.name, type = el.attrs.type;
    if (!name) throw new Error('URDF: a joint has no name');
    if (type === 'floating' || type === 'planar') throw new Error(`URDF: joint ${name} is ${type}: a free-flying base is not modelled here (only a fixed base)`);
    if (type === 'prismatic') throw new Error(`URDF: joint ${name} is prismatic: sliding joints are not modelled yet (only revolute, continuous and fixed)`);
    if (!['revolute', 'continuous', 'fixed'].includes(type)) throw new Error(`URDF: joint ${name} has an unknown type "${type}"`);
    const parent = xmlChild(el, 'parent')?.attrs.link, child = xmlChild(el, 'child')?.attrs.link;
    for (const [role, l] of [['parent', parent], ['child', child]]) {
      if (!links.has(l)) throw new Error(`URDF: joint ${name}'s ${role} link "${l ?? ''}" does not exist`);
    }
    if (parentOf.has(child)) throw new Error(`URDF: link ${child} has two parent joints (${parentOf.get(child).name}, ${name}): a closed chain is not a tree`);
    const ax = xmlChild(el, 'axis');
    let axis = ax?.attrs.xyz != null ? numbers(ax.attrs.xyz, 3, `joint ${name}'s axis`) : [1, 0, 0];
    const len = Math.hypot(...axis);
    if (type !== 'fixed' && !(len > 0)) throw new Error(`URDF: joint ${name}'s axis has no direction`);
    axis = axis.map((v) => v / (len || 1));
    const lim = xmlChild(el, 'limit');
    if (type === 'revolute' && !lim) throw new Error(`URDF: revolute joint ${name} has no <limit> (lower, upper, effort, velocity)`);
    const dyn = xmlChild(el, 'dynamics');
    if (dyn && (Number(dyn.attrs.damping ?? 0) !== 0 || Number(dyn.attrs.friction ?? 0) !== 0)) {
      throw new Error(`URDF: joint ${name} has damping or friction in <dynamics>: give 0 here, friction lives in the motors, and counting it twice would be wrong`);
    }
    const lv = (k, d) => (lim?.attrs[k] != null ? Number(lim.attrs[k]) : d);
    const j = {
      name, type, parent, child, origin: origin(el, `joint ${name}`), axis,
      lower: type === 'continuous' ? -Infinity : lv('lower', 0), upper: type === 'continuous' ? Infinity : lv('upper', 0),
      effort: lv('effort', Infinity), velocity: lv('velocity', Infinity),
    };
    if (![j.lower, j.upper, j.effort, j.velocity].every((x) => !Number.isNaN(x))) throw new Error(`URDF: joint ${name}'s limits must be numbers`);
    joints.push(j);
    parentOf.set(child, j);
  }

  const roots = [...links.keys()].filter((l) => !parentOf.has(l));
  if (roots.length !== 1) throw new Error(roots.length ? `URDF: ${roots.length} root links (${roots.join(', ')}): a robot has one` : 'URDF: no root link: the joints form a cycle');
  const root = roots[0];

  const bodies = [], frames = new Map([[root, { body: -1, R: rpyMatrix(0, 0, 0), p: [0, 0, 0] }]]);
  const visit = (link) => {
    for (const j of joints.filter((x) => x.parent === link)) {
      const f = frames.get(link);
      const R = mm(f.R, j.origin.R), p = mv(f.R, j.origin.p).map((v, k) => v + f.p[k]);
      if (j.type === 'fixed') frames.set(j.child, { body: f.body, R, p });
      else {
        bodies.push({ joint: j.name, link: j.child, parent: f.body, R0: R, p0: p, axis: j.axis, lower: j.lower, upper: j.upper, effort: j.effort, velocity: j.velocity });
        frames.set(j.child, { body: bodies.length - 1, R: rpyMatrix(0, 0, 0), p: [0, 0, 0] });
      }
      visit(j.child);
    }
  };
  visit(root);
  if (frames.size !== links.size) throw new Error(`URDF: links ${[...links.keys()].filter((l) => !frames.has(l)).join(', ')} are not reached from the root ${root}: the joints form a cycle`);

  const sums = Array.from({ length: bodies.length + 1 }, () => ({ m: 0, mc: [0, 0, 0], parts: [] }));
  for (const [name, f] of frames) {
    const l = links.get(name);
    if (!(l.m > 0) && l.I.every((v) => v === 0)) continue;
    const c = mv(f.R, l.c).map((v, k) => v + f.p[k]);
    const s = sums[f.body + 1];
    s.m += l.m;
    for (let k = 0; k < 3; k++) s.mc[k] += l.m * c[k];
    s.parts.push({ m: l.m, c, I: rotI(f.R, l.I) });
  }
  const inertiaOf = (s) => {
    const c = s.m > 0 ? s.mc.map((v) => v / s.m) : [0, 0, 0];
    const I = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const q of s.parts) {
      const d = q.c.map((v, k) => v - c[k]), d2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) I[3 * a + b] += q.I[3 * a + b] + q.m * ((a === b ? d2 : 0) - d[a] * d[b]);
    }
    return { m: s.m, c, I };
  };
  bodies.forEach((b, i) => { b.inertia = inertiaOf(sums[i + 1]); });

  return {
    name: doc.attrs.name ?? '', n: bodies.length, root, bodies, frames,
    links: [...links.values()].map(({ name, visuals }) => ({ name, visuals })),
    joints: bodies.map((b) => ({ name: b.joint, child: b.link, axis: b.axis, lower: b.lower, upper: b.upper, effort: b.effort, velocity: b.velocity })),
    warnings,
  };
}

return { rpyMatrix, symEig3, inertiaProblem, parseUrdf };
})();
// ---- core/rbd.js
__mods['core/rbd.js'] = (() => {

const len = (v, n, what) => {
  const a = typeof v === 'number' ? new Float64Array(n).fill(v) : Float64Array.from(v);
  if (a.length !== n) throw new Error(`${what} has ${a.length} values; the robot has ${n} joints`);
  return a;
};

function createRbd(model, { armature = 0, gravity = [0, 0, -9.81], scale = 1 } = {}) {
  const n = model.n, B = model.bodies;
  const arm = len(armature, n, 'armature');
  const g = Float64Array.from(gravity);
  const parent = Int32Array.from(B, (b) => b.parent);
  const R0 = new Float64Array(9 * n), K = new Float64Array(9 * n), P = new Float64Array(9 * n), p0 = new Float64Array(3 * n);
  const mass = new Float64Array(n), cB = new Float64Array(3 * n), IB = new Float64Array(9 * n);
  B.forEach((b, i) => {
    const a = b.axis, R = b.R0;
    const ax = [0, -a[2], a[1], a[2], 0, -a[0], -a[1], a[0], 0];
    const Ra = [0, 1, 2].map((r) => R[3 * r] * a[0] + R[3 * r + 1] * a[1] + R[3 * r + 2] * a[2]);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        R0[9 * i + 3 * r + c] = R[3 * r + c];
        K[9 * i + 3 * r + c] = R[3 * r] * ax[c] + R[3 * r + 1] * ax[3 + c] + R[3 * r + 2] * ax[6 + c];
        P[9 * i + 3 * r + c] = Ra[r] * a[c];
      }
      p0[3 * i + r] = b.p0[r];
      cB[3 * i + r] = b.inertia.c[r];
    }
    mass[i] = b.inertia.m * scale;
    for (let k = 0; k < 9; k++) IB[9 * i + k] = b.inertia.I[k] * scale;
  });
  const moved = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    moved[i] += mass[i] + IB[9 * i] + IB[9 * i + 4] + IB[9 * i + 8];
    if (parent[i] >= 0) moved[parent[i]] += moved[i];
  }
  for (let i = 0; i < n; i++) {
    if (!(moved[i] > 0) && !(arm[i] > 0)) throw new Error(`${B[i].joint} moves no mass and has no armature: the mass matrix would have a zero row`);
  }

  const qc = new Float64Array(n).fill(NaN);
  const Rw = new Float64Array(9 * n), o = new Float64Array(3 * n), z = new Float64Array(3 * n);
  const cw = new Float64Array(3 * n), Iw = new Float64Array(9 * n);   
  let inertiaFresh = false;
  const T = new Float64Array(9);
  function fk(q) {
    let same = true;
    for (let i = 0; i < n; i++) if (qc[i] !== q[i]) { same = false; break; }
    if (same) return api;
    for (let i = 0; i < n; i++) {
      const c = Math.cos(q[i]), s = Math.sin(q[i]), v = 1 - c, j = parent[i];
      for (let k = 0; k < 9; k++) T[k] = c * R0[9 * i + k] + s * K[9 * i + k] + v * P[9 * i + k];
      if (j < 0) {
        for (let k = 0; k < 9; k++) Rw[9 * i + k] = T[k];
        for (let k = 0; k < 3; k++) o[3 * i + k] = p0[3 * i + k];
      } else {
        for (let r = 0; r < 3; r++) {
          const a0 = Rw[9 * j + 3 * r], a1 = Rw[9 * j + 3 * r + 1], a2 = Rw[9 * j + 3 * r + 2];
          for (let cc = 0; cc < 3; cc++) Rw[9 * i + 3 * r + cc] = a0 * T[cc] + a1 * T[3 + cc] + a2 * T[6 + cc];
          o[3 * i + r] = o[3 * j + r] + a0 * p0[3 * i] + a1 * p0[3 * i + 1] + a2 * p0[3 * i + 2];
        }
      }
      const a = B[i].axis;
      for (let r = 0; r < 3; r++) z[3 * i + r] = Rw[9 * i + 3 * r] * a[0] + Rw[9 * i + 3 * r + 1] * a[1] + Rw[9 * i + 3 * r + 2] * a[2];
      qc[i] = q[i];
    }
    inertiaFresh = false;
    return api;
  }
  function worldInertia() {
    if (inertiaFresh) return;
    for (let i = 0; i < n; i++) {
      const R = 9 * i;
      for (let r = 0; r < 3; r++) cw[3 * i + r] = o[3 * i + r] + Rw[R + 3 * r] * cB[3 * i] + Rw[R + 3 * r + 1] * cB[3 * i + 1] + Rw[R + 3 * r + 2] * cB[3 * i + 2];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          let s = 0;
          for (let a = 0; a < 3; a++) {
            const ra = Rw[R + 3 * r + a];
            if (ra === 0) continue;
            for (let b = 0; b < 3; b++) s += ra * IB[R + 3 * a + b] * Rw[R + 3 * c + b];
          }
          Iw[R + 3 * r + c] = s;
        }
      }
    }
    inertiaFresh = true;
  }

  function frameOf(link) {
    const f = model.frames.get(link);
    if (!f) throw new Error(`the robot has no link "${link}"`);
    return f;
  }
  function linkPoseInto(link, R, p) {
    const f = frameOf(link), i = f.body;
    if (i < 0) { for (let k = 0; k < 9; k++) R[k] = f.R[k]; for (let k = 0; k < 3; k++) p[k] = f.p[k]; return; }
    for (let r = 0; r < 3; r++) {
      const a0 = Rw[9 * i + 3 * r], a1 = Rw[9 * i + 3 * r + 1], a2 = Rw[9 * i + 3 * r + 2];
      for (let c = 0; c < 3; c++) R[3 * r + c] = a0 * f.R[c] + a1 * f.R[3 + c] + a2 * f.R[6 + c];
      p[r] = o[3 * i + r] + a0 * f.p[0] + a1 * f.p[1] + a2 * f.p[2];
    }
  }
  const pR = new Float64Array(9), pp = new Float64Array(3);

  function jacobian(q, link, J = new Float64Array(6 * n), expressedIn = 'base') {
    fk(q);
    linkPoseInto(link, pR, pp);
    J.fill(0);
    for (let j = frameOf(link).body; j >= 0; j = parent[j]) {
      const zx = z[3 * j], zy = z[3 * j + 1], zz = z[3 * j + 2];
      const dx = pp[0] - o[3 * j], dy = pp[1] - o[3 * j + 1], dz = pp[2] - o[3 * j + 2];
      J[j] = zy * dz - zz * dy; J[n + j] = zz * dx - zx * dz; J[2 * n + j] = zx * dy - zy * dx;
      J[3 * n + j] = zx; J[4 * n + j] = zy; J[5 * n + j] = zz;
    }
    if (expressedIn === 'frame') {
      for (let j = 0; j < n; j++) {
        for (const h of [0, 3]) {
          const v0 = J[h * n + j], v1 = J[(h + 1) * n + j], v2 = J[(h + 2) * n + j];
          for (let r = 0; r < 3; r++) J[(h + r) * n + j] = pR[r] * v0 + pR[3 + r] * v1 + pR[6 + r] * v2;
        }
      }
    } else if (expressedIn !== 'base') throw new Error(`a Jacobian is expressed in 'base' or 'frame', not "${expressedIn}"`);
    return J;
  }

  const w = new Float64Array(3 * n), wd = new Float64Array(3 * n), ao = new Float64Array(3 * n);
  function forward(qd, qdd, a0x, a0y, a0z) {
    for (let i = 0; i < n; i++) {
      const j = parent[i], I3 = 3 * i, J3 = 3 * j;
      const zx = z[I3], zy = z[I3 + 1], zz = z[I3 + 2], v = qd[i], acc = qdd ? qdd[i] : 0;
      if (j < 0) {
        w[I3] = zx * v; w[I3 + 1] = zy * v; w[I3 + 2] = zz * v;
        wd[I3] = zx * acc; wd[I3 + 1] = zy * acc; wd[I3 + 2] = zz * acc;
        ao[I3] = a0x; ao[I3 + 1] = a0y; ao[I3 + 2] = a0z;
        continue;
      }
      const px = w[J3], py = w[J3 + 1], pz = w[J3 + 2];
      w[I3] = px + zx * v; w[I3 + 1] = py + zy * v; w[I3 + 2] = pz + zz * v;
      wd[I3] = wd[J3] + zx * acc + (py * zz - pz * zy) * v;
      wd[I3 + 1] = wd[J3 + 1] + zy * acc + (pz * zx - px * zz) * v;
      wd[I3 + 2] = wd[J3 + 2] + zz * acc + (px * zy - py * zx) * v;
      const dx = o[I3] - o[J3], dy = o[I3 + 1] - o[J3 + 1], dz = o[I3 + 2] - o[J3 + 2];
      const ex = py * dz - pz * dy, ey = pz * dx - px * dz, ez = px * dy - py * dx;   
      ao[I3] = ao[J3] + (wd[J3 + 1] * dz - wd[J3 + 2] * dy) + (py * ez - pz * ey);
      ao[I3 + 1] = ao[J3 + 1] + (wd[J3 + 2] * dx - wd[J3] * dz) + (pz * ex - px * ez);
      ao[I3 + 2] = ao[J3 + 2] + (wd[J3] * dy - wd[J3 + 1] * dx) + (px * ey - py * ex);
    }
  }

  function jdotqd(q, qd, link, out = new Float64Array(6)) {
    fk(q);
    out.fill(0);
    const i = frameOf(link).body;
    if (i < 0) return out;
    forward(qd, null, 0, 0, 0);
    linkPoseInto(link, pR, pp);
    const I3 = 3 * i, wx = w[I3], wy = w[I3 + 1], wz = w[I3 + 2];
    const dx = pp[0] - o[I3], dy = pp[1] - o[I3 + 1], dz = pp[2] - o[I3 + 2];
    const ex = wy * dz - wz * dy, ey = wz * dx - wx * dz, ez = wx * dy - wy * dx;
    out[0] = ao[I3] + (wd[I3 + 1] * dz - wd[I3 + 2] * dy) + (wy * ez - wz * ey);
    out[1] = ao[I3 + 1] + (wd[I3 + 2] * dx - wd[I3] * dz) + (wz * ex - wx * ez);
    out[2] = ao[I3 + 2] + (wd[I3] * dy - wd[I3 + 1] * dx) + (wx * ey - wy * ex);
    out[3] = wd[I3]; out[4] = wd[I3 + 1]; out[5] = wd[I3 + 2];
    return out;
  }

  const fa = new Float64Array(3 * n), na = new Float64Array(3 * n);
  function rnea(q, qd, qdd, out = new Float64Array(n), { gravity: withGravity = true, armature: withArmature = true } = {}) {
    fk(q);
    worldInertia();
    if (withGravity) forward(qd, qdd, -g[0], -g[1], -g[2]); else forward(qd, qdd, 0, 0, 0);
    fa.fill(0); na.fill(0);
    for (let i = n - 1; i >= 0; i--) {
      const I3 = 3 * i, I9 = 9 * i, m = mass[i];
      const wx = w[I3], wy = w[I3 + 1], wz = w[I3 + 2];
      const rx = cw[I3] - o[I3], ry = cw[I3 + 1] - o[I3 + 1], rz = cw[I3 + 2] - o[I3 + 2];
      const ex = wy * rz - wz * ry, ey = wz * rx - wx * rz, ez = wx * ry - wy * rx;
      const Fx = m * (ao[I3] + (wd[I3 + 1] * rz - wd[I3 + 2] * ry) + (wy * ez - wz * ey));
      const Fy = m * (ao[I3 + 1] + (wd[I3 + 2] * rx - wd[I3] * rz) + (wz * ex - wx * ez));
      const Fz = m * (ao[I3 + 2] + (wd[I3] * ry - wd[I3 + 1] * rx) + (wx * ey - wy * ex));
      const Iwx = Iw[I9] * wx + Iw[I9 + 1] * wy + Iw[I9 + 2] * wz;
      const Iwy = Iw[I9 + 3] * wx + Iw[I9 + 4] * wy + Iw[I9 + 5] * wz;
      const Iwz = Iw[I9 + 6] * wx + Iw[I9 + 7] * wy + Iw[I9 + 8] * wz;
      const Nx = Iw[I9] * wd[I3] + Iw[I9 + 1] * wd[I3 + 1] + Iw[I9 + 2] * wd[I3 + 2] + (wy * Iwz - wz * Iwy);
      const Ny = Iw[I9 + 3] * wd[I3] + Iw[I9 + 4] * wd[I3 + 1] + Iw[I9 + 5] * wd[I3 + 2] + (wz * Iwx - wx * Iwz);
      const Nz = Iw[I9 + 6] * wd[I3] + Iw[I9 + 7] * wd[I3 + 1] + Iw[I9 + 8] * wd[I3 + 2] + (wx * Iwy - wy * Iwx);
      const fx = Fx + fa[I3], fy = Fy + fa[I3 + 1], fz = Fz + fa[I3 + 2];
      const nx = Nx + (ry * Fz - rz * Fy) + na[I3];
      const ny = Ny + (rz * Fx - rx * Fz) + na[I3 + 1];
      const nz = Nz + (rx * Fy - ry * Fx) + na[I3 + 2];
      out[i] = z[I3] * nx + z[I3 + 1] * ny + z[I3 + 2] * nz + (withArmature && qdd ? arm[i] * qdd[i] : 0);
      const j = parent[i];
      if (j >= 0) {
        const J3 = 3 * j, dx = o[I3] - o[J3], dy = o[I3 + 1] - o[J3 + 1], dz = o[I3 + 2] - o[J3 + 2];
        fa[J3] += fx; fa[J3 + 1] += fy; fa[J3 + 2] += fz;
        na[J3] += nx + (dy * fz - dz * fy); na[J3 + 1] += ny + (dz * fx - dx * fz); na[J3 + 2] += nz + (dx * fy - dy * fx);
      }
    }
    return out;
  }

  const Cm = new Float64Array(n), Ch = new Float64Array(3 * n), CI = new Float64Array(9 * n);
  function massMatrix(q, out = new Float64Array(n * n)) {
    fk(q);
    worldInertia();
    for (let i = 0; i < n; i++) {
      const I3 = 3 * i, I9 = 9 * i, m = mass[i], cx = cw[I3], cy = cw[I3 + 1], cz = cw[I3 + 2], c2 = cx * cx + cy * cy + cz * cz;
      Cm[i] = m; Ch[I3] = m * cx; Ch[I3 + 1] = m * cy; Ch[I3 + 2] = m * cz;
      const c = [cx, cy, cz];
      for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) CI[I9 + 3 * r + k] = Iw[I9 + 3 * r + k] + m * ((r === k ? c2 : 0) - c[r] * c[k]);
    }
    for (let i = n - 1; i > 0; i--) {
      const j = parent[i];
      if (j < 0) continue;
      Cm[j] += Cm[i];
      for (let k = 0; k < 3; k++) Ch[3 * j + k] += Ch[3 * i + k];
      for (let k = 0; k < 9; k++) CI[9 * j + k] += CI[9 * i + k];
    }
    out.fill(0);
    for (let i = 0; i < n; i++) {
      const I3 = 3 * i, I9 = 9 * i;
      const zx = z[I3], zy = z[I3 + 1], zz = z[I3 + 2];
      const vx = o[I3 + 1] * zz - o[I3 + 2] * zy, vy = o[I3 + 2] * zx - o[I3] * zz, vz = o[I3] * zy - o[I3 + 1] * zx;
      const hx = Ch[I3], hy = Ch[I3 + 1], hz = Ch[I3 + 2], m = Cm[i];
      const nx = CI[I9] * zx + CI[I9 + 1] * zy + CI[I9 + 2] * zz + (hy * vz - hz * vy);
      const ny = CI[I9 + 3] * zx + CI[I9 + 4] * zy + CI[I9 + 5] * zz + (hz * vx - hx * vz);
      const nz = CI[I9 + 6] * zx + CI[I9 + 7] * zy + CI[I9 + 8] * zz + (hx * vy - hy * vx);
      const fx = m * vx + (zy * hz - zz * hy), fy = m * vy + (zz * hx - zx * hz), fz = m * vz + (zx * hy - zy * hx);
      for (let j = i; j >= 0; j = parent[j]) {
        const J3 = 3 * j, ax = z[J3], ay = z[J3 + 1], az = z[J3 + 2];
        const bx = o[J3 + 1] * az - o[J3 + 2] * ay, by = o[J3 + 2] * ax - o[J3] * az, bz = o[J3] * ay - o[J3 + 1] * ax;
        const Mij = ax * nx + ay * ny + az * nz + bx * fx + by * fy + bz * fz;
        out[i * n + j] = Mij; out[j * n + i] = Mij;
      }
      out[i * n + i] += arm[i];
    }
    return out;
  }

  const zero = new Float64Array(n);
  const bias = (q, qd, out = new Float64Array(n)) => rnea(q, qd, null, out);
  const gravityTorque = (q, out = new Float64Array(n)) => rnea(q, zero, null, out);

  const Mw = new Float64Array(n * n), hw = new Float64Array(n);
  function forwardDynamics(q, qd, tau, out = new Float64Array(n)) {
    massMatrix(q, Mw);
    bias(q, qd, hw);
    for (let i = 0; i < n; i++) out[i] = tau[i] - hw[i];
    if (!cholesky(Mw, n)) throw new Error('the mass matrix is not positive definite');
    return cholSolve(Mw, n, out);
  }

  function torqueSplit(q, qd, qdd, drive = null) {
    const inertial = new Float64Array(n), coriolis = new Float64Array(n), grav = new Float64Array(n);
    const friction = drive ? jointFriction(qd, drive) : new Float64Array(n);
    massMatrix(q, Mw);
    for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += Mw[i * n + j] * qdd[j]; inertial[i] = s; }
    rnea(q, qd, null, coriolis, { gravity: false });
    gravityTorque(q, grav);
    const total = Float64Array.from(inertial, (v, i) => v + coriolis[i] + grav[i] + friction[i]);
    return { inertial, coriolis, gravity: grav, friction, total };
  }

  function energy(q, qd) {
    massMatrix(q, Mw);
    let kinetic = 0, potential = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) kinetic += 0.5 * qd[i] * Mw[i * n + j] * qd[j];
    for (let i = 0; i < n; i++) potential -= mass[i] * (g[0] * cw[3 * i] + g[1] * cw[3 * i + 1] + g[2] * cw[3 * i + 2]);
    return { kinetic, potential };
  }

  function linkPose(q, link) {
    fk(q);
    const R = new Array(9), p = new Array(3);
    linkPoseInto(link, R, p);
    return { R, p };
  }
  function linkPoses(q, out = {}) {
    fk(q);
    for (const l of model.links) {
      const e = out[l.name] ?? (out[l.name] = { R: new Float64Array(9), p: new Float64Array(3) });
      linkPoseInto(l.name, e.R, e.p);
    }
    return out;
  }

  const api = {
    n, model, armature: arm, gravity: g,
    fk, linkPose, linkPoses, jacobian, jdotqd, rnea, massMatrix, bias, gravityTorque, forwardDynamics, torqueSplit, energy,
    poses: { R: Rw, o, z },
  };
  return api;
}

function jointFriction(qd, { G, B, Tcp, Tcn, ws }, out = new Float64Array(qd.length)) {
  const at = (v, i) => (typeof v === 'number' ? v : v[i]);
  for (let i = 0; i < qd.length; i++) {
    const Gi = at(G, i), om = Gi * qd[i];
    out[i] = Gi * (at(B, i) * om + (om >= 0 ? at(Tcp, i) : at(Tcn, i)) * Math.tanh(om / at(ws, i)));
  }
  return out;
}


function cholesky(A, n) {
  for (let j = 0; j < n; j++) {
    let d = A[j * n + j];
    for (let k = 0; k < j; k++) d -= A[j * n + k] ** 2;
    if (!(d > 0)) return false;
    d = Math.sqrt(d);
    A[j * n + j] = d;
    for (let i = j + 1; i < n; i++) {
      let s = A[i * n + j];
      for (let k = 0; k < j; k++) s -= A[i * n + k] * A[j * n + k];
      A[i * n + j] = s / d;
    }
  }
  return true;
}

function cholSolve(L, n, b) {
  for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i * n + k] * b[k]; b[i] = s / L[i * n + i]; }
  for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let k = i + 1; k < n; k++) s -= L[k * n + i] * b[k]; b[i] = s / L[i * n + i]; }
  return b;
}

function symEig(S, n) {
  const a = Float64Array.from(S);
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0, diag = 0;
    for (let p = 0; p < n; p++) { diag += a[p * n + p] ** 2; for (let q = p + 1; q < n; q++) off += a[p * n + q] ** 2; }
    if (off === 0 || off <= 1e-32 * diag) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q];
        if (apq === 0) continue;
        const th = (a[q * n + q] - a[p * n + p]) / (2 * apq);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) { const x = a[k * n + p], y = a[k * n + q]; a[k * n + p] = c * x - s * y; a[k * n + q] = s * x + c * y; }
        for (let k = 0; k < n; k++) { const x = a[p * n + k], y = a[q * n + k]; a[p * n + k] = c * x - s * y; a[q * n + k] = s * x + c * y; }
      }
    }
  }
  return Array.from({ length: n }, (_, i) => a[i * n + i]);
}

function sigmaMin(J, m, n) {
  const A = new Float64Array(m * m);
  for (let i = 0; i < m; i++) for (let j = 0; j <= i; j++) { let s = 0; for (let k = 0; k < n; k++) s += J[i * n + k] * J[j * n + k]; A[i * m + j] = s; A[j * m + i] = s; }
  return Math.sqrt(Math.max(0, Math.min(...symEig(A, m))));
}

function dampedInverse(J, m, n, { eps = 0.04, lambdaMax = 0.05 } = {}, out = new Float64Array(n * m)) {
  const sigma = sigmaMin(J, m, n);
  const lambda2 = sigma < eps ? lambdaMax ** 2 * (1 - (sigma / eps) ** 2) : 0;
  const A = new Float64Array(m * m);
  for (let i = 0; i < m; i++) for (let j = 0; j <= i; j++) { let s = 0; for (let k = 0; k < n; k++) s += J[i * n + k] * J[j * n + k]; A[i * m + j] = s; A[j * m + i] = s; }
  for (let i = 0; i < m; i++) A[i * m + i] += lambda2;
  if (!cholesky(A, m)) throw new Error(`the Jacobian is singular (σ_min ${sigma.toExponential(2)}) and the damping is 0: give ε and λ_max above 0`);
  const col = new Float64Array(m);
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < m; i++) col[i] = J[i * n + k];
    cholSolve(A, m, col);
    for (let i = 0; i < m; i++) out[k * m + i] = col[i];
  }
  return { Jinv: out, sigma, lambda2 };
}

function orientationError(Rd, R, out = new Float64Array(3)) {
  const e = new Float64Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) e[3 * i + j] = Rd[3 * i] * R[3 * j] + Rd[3 * i + 1] * R[3 * j + 1] + Rd[3 * i + 2] * R[3 * j + 2];
  const t = e[0] + e[4] + e[8];
  let eta, x, y, zz;
  if (t >= e[0] && t >= e[4] && t >= e[8]) {
    const s = Math.sqrt(1 + t) * 2; eta = s / 4; x = (e[7] - e[5]) / s; y = (e[2] - e[6]) / s; zz = (e[3] - e[1]) / s;
  } else if (e[0] >= e[4] && e[0] >= e[8]) {
    const s = Math.sqrt(1 + e[0] - e[4] - e[8]) * 2; eta = (e[7] - e[5]) / s; x = s / 4; y = (e[1] + e[3]) / s; zz = (e[2] + e[6]) / s;
  } else if (e[4] >= e[8]) {
    const s = Math.sqrt(1 + e[4] - e[0] - e[8]) * 2; eta = (e[2] - e[6]) / s; x = (e[1] + e[3]) / s; y = s / 4; zz = (e[5] + e[7]) / s;
  } else {
    const s = Math.sqrt(1 + e[8] - e[0] - e[4]) * 2; eta = (e[3] - e[1]) / s; x = (e[2] + e[6]) / s; y = (e[5] + e[7]) / s; zz = s / 4;
  }
  if (eta < 0) { eta = -eta; x = -x; y = -y; zz = -zz; }
  out[0] = x; out[1] = y; out[2] = zz;
  return { e: out, theta: 2 * Math.atan2(Math.hypot(x, y, zz), eta), eta };
}

return { createRbd, jointFriction, cholesky, cholSolve, symEig, sigmaMin, dampedInverse, orientationError };
})();
// ---- core/puma560.js
__mods['core/puma560.js'] = (() => {

const U = `<robot name="puma560">
<material name="body"><color rgba="0.86 0.84 0.78 1"/></material>
<material name="dark"><color rgba="0.32 0.34 0.37 1"/></material>
<material name="tool"><color rgba="0.85 0.27 0.2 1"/></material>
<link name="base">
<visual><origin xyz="0 0 0.015"/><geometry><box size="0.42 0.42 0.03"/></geometry><material name="dark"/></visual>
<visual><origin xyz="0 0 0.31"/><geometry><cylinder radius="0.11" length="0.56"/></geometry><material name="body"/></visual>
</link>
<joint name="j1" type="revolute"><parent link="base"/><child link="link1"/><origin xyz="0 0 0.67183"/><axis xyz="0 0 1"/>
<limit lower="-2.792526803190927" upper="2.792526803190927" effort="56" velocity="1.92"/></joint>
<link name="link1">
<inertial><mass value="13"/><inertia ixx="0.175" iyy="0.175" izz="0.34" ixy="0" ixz="0" iyz="0"/></inertial>
<visual><origin xyz="0 0 -0.04"/><geometry><cylinder radius="0.1" length="0.08"/></geometry><material name="dark"/></visual>
<visual><origin xyz="0 0.08 0" rpy="1.5707963267948966 0 0"/><geometry><cylinder radius="0.1" length="0.2"/></geometry><material name="body"/></visual>
</link>
<joint name="j2" type="revolute"><parent link="link1"/><child link="link2"/><origin rpy="1.5707963267948966 0 0"/><axis xyz="0 0 1"/>
<limit lower="-0.7853981633974483" upper="3.9269908169872414" effort="97" velocity="1.51"/></joint>
<link name="link2">
<inertial><origin xyz="0.068 0.006 0.2275"/><mass value="17.4"/><inertia ixx="0.13" iyy="0.524" izz="0.539" ixy="0" ixz="0" iyz="0"/></inertial>
<visual><origin xyz="0 0 0.065"/><geometry><cylinder radius="0.09" length="0.08"/></geometry><material name="dark"/></visual>
<visual><origin xyz="0.2159 0 0.065"/><geometry><box size="0.4318 0.15 0.07"/></geometry><material name="body"/></visual>
<visual><origin xyz="0.4318 0 0.065"/><geometry><cylinder radius="0.075" length="0.07"/></geometry><material name="body"/></visual>
</link>
<joint name="j3" type="revolute"><parent link="link2"/><child link="link3"/><origin xyz="0.4318 0 0.15005"/><axis xyz="0 0 1"/>
<limit lower="-3.9269908169872414" upper="0.7853981633974483" effort="52" velocity="2.4"/></joint>
<link name="link3">
<inertial><origin xyz="0 0.07 0.014"/><mass value="4.8"/><inertia ixx="0.076" iyy="0.0225" izz="0.086" ixy="0" ixz="0" iyz="0"/></inertial>
<visual><origin xyz="0 0 0"/><geometry><cylinder radius="0.065" length="0.08"/></geometry><material name="dark"/></visual>
<visual><origin xyz="0.0102 0.18 0"/><geometry><box size="0.085 0.36 0.07"/></geometry><material name="body"/></visual>
</link>
<joint name="j4" type="revolute"><parent link="link3"/><child link="link4"/><origin xyz="0.0203 0.4318 0" rpy="-1.5707963267948966 0 0"/><axis xyz="0 0 1"/>
<limit lower="-1.9198621771937625" upper="2.9670597283903604" effort="10" velocity="5.34"/></joint>
<link name="link4">
<inertial><origin xyz="0 0 -0.019"/><mass value="0.82"/><inertia ixx="0.0018" iyy="0.0018" izz="0.0013" ixy="0" ixz="0" iyz="0"/></inertial>
<visual><origin xyz="0 0 -0.055"/><geometry><cylinder radius="0.042" length="0.07"/></geometry><material name="dark"/></visual>
</link>
<joint name="j5" type="revolute"><parent link="link4"/><child link="link5"/><origin rpy="1.5707963267948966 0 0"/><axis xyz="0 0 1"/>
<limit lower="-1.7453292519943295" upper="1.7453292519943295" effort="10" velocity="5.09"/></joint>
<link name="link5">
<inertial><mass value="0.34"/><inertia ixx="0.0003" iyy="0.0003" izz="0.0004" ixy="0" ixz="0" iyz="0"/></inertial>
<visual><geometry><cylinder radius="0.038" length="0.09"/></geometry><material name="body"/></visual>
</link>
<joint name="j6" type="revolute"><parent link="link5"/><child link="link6"/><origin rpy="-1.5707963267948966 0 0"/><axis xyz="0 0 1"/>
<limit lower="-4.642575810304916" upper="4.642575810304916" effort="10" velocity="5.74"/></joint>
<link name="link6">
<inertial><origin xyz="0 0 0.032"/><mass value="0.09"/><inertia ixx="0.00015" iyy="0.00015" izz="0.00004" ixy="0" ixz="0" iyz="0"/></inertial>
<visual><origin xyz="0 0 0.038125"/><geometry><cylinder radius="0.03" length="0.03625"/></geometry><material name="dark"/></visual>
</link>
<joint name="flange" type="fixed"><parent link="link6"/><child link="flange"/><origin xyz="0 0 0.05625"/></joint>
<link name="flange">
<visual><geometry><sphere radius="0.012"/></geometry><material name="tool"/></visual>
</link>
</robot>
`;

const DRIVE = {
  G: [-62.6111, 107.815, -53.7063, 76.0364, 71.923, 76.686],
  Jm: [200e-6, 200e-6, 200e-6, 33e-6, 33e-6, 33e-6],
  kt: [0.227, 0.228, 0.238, 0.0675, 0.0718, 0.0534],
  B: [1.48e-3, 0.817e-3, 1.38e-3, 71.2e-6, 82.6e-6, 36.7e-6],
  Tcp: [0.435, 0.126, 0.105, 11.2e-3, 9.26e-3, 3.96e-3],
  Tcn: [0.395, 0.0709, 0.132, 16.9e-3, 14.5e-3, 10.5e-3],
  ws: 2,
  imax: [8.83, 8.77, 8.74, 4.42, 4.42, 4.49],
  fuse: [4, 4, 4, 2, 2, 2],
  Ra: [2.1, 2.1, 2.1, 6.7, 6.7, 6.7],
  Vmax: 40,
};

const PUMA560 = {
  urdf: U,
  drive: DRIVE,
  armature: DRIVE.G.map((G, i) => G * G * DRIVE.Jm[i]),
  tool: 'flange',
  start: [0, 40, -150, 0, -70, 0],
};

return { PUMA560 };
})();
// ---- core/mech.js
__mods['core/mech.js'] = (() => {

const { NAME_RE, isReserved } = __mods['core/formula.js'];
const num = (key, label, def, extra = {}) => ({ key, label, default: def, ...extra });
const coord = (key, label, def) => ({ key, label, default: def, kind: 'coord' });

const MECH_ELEMENTS = {
  world: { label: 'World', group: 'Mechanics', formula: 'g ↓', part: true, frames: () => ['W'], params: [num('g', 'g', 9.81, { unit: 'm/s²' })], ports: () => [0, 0] },
  rail: {
    label: 'Rail', group: 'Mechanics', formula: 'F − b·v', part: true, joint: true, frames: () => ['B', 'F'],
    params: [coord('name', 'Coordinate', 'x'), coord('rate', 'Rate', 'v'), num('b', 'Friction b', 0, { unit: 'N·s/m', min: 0 }), num('incline', 'Incline α', 0, { unit: 'rad' }),
      num('x0', 'Start s₀', 0, { unit: 'm' }), num('v0', 'Start ṡ₀', 0, { unit: 'm/s' }), num('force', 'Force input (0/1)', 1, { int: true, min: 0, max: 1 })],
    ports: (p) => [p.force ? 1 : 0, 2], outputs: (p) => [p.name, p.rate], inputNames: (p) => (p.force ? ['F'] : []),
  },
  hinge: {
    label: 'Hinge', group: 'Mechanics', formula: 'θ from upright', part: true, joint: true, frames: () => ['B', 'F'],
    params: [coord('name', 'Coordinate', 'θ'), coord('rate', 'Rate', 'ω'), num('c', 'Damping c', 0, { unit: 'N·m·s/rad', min: 0 }),
      num('theta0', 'Start θ₀', 0, { unit: 'rad' }), num('omega0', 'Start ω₀', 0, { unit: 'rad/s' }), num('torque', 'Torque input (0/1)', 0, { int: true, min: 0, max: 1 })],
    ports: (p) => [p.torque ? 1 : 0, 2], outputs: (p) => [p.name, p.rate], inputNames: (p) => (p.torque ? ['τ'] : []),
  },
  mass: { label: 'Mass', group: 'Mechanics', formula: 'm', part: true, frames: () => ['F'], params: [num('m', 'Mass m', 1, { unit: 'kg', min: 0 })], ports: () => [0, 0] },
  rod: {
    label: 'Rod', group: 'Mechanics', formula: 'l, m at tip', part: true, frames: () => ['B', 'T'],
    params: [num('l', 'Length l', 0.5, { unit: 'm', min: 0 }), num('m', 'Mass m', 0, { unit: 'kg', min: 0 }), { key: 'at', label: 'Mass at', default: 'tip', kind: 'choice', options: ['tip', 'uniform'] }],
    ports: () => [0, 0],
  },
};
const isPart = (type) => Object.hasOwn(MECH_ELEMENTS, type);

function checkCoord(v, where) {
  const s = String(v ?? '').trim();
  if (!NAME_RE.test(s) || s.length > 8) throw new Error(`${where}: a short name such as x, θ1 or ω1 (letters, digits, _)`);
  if (isReserved(s)) throw new Error(`${where}: "${s}" is the time, a constant or a function; choose another name`);
  return s;
}

const label = (b) => `'${b.name ?? b.id}'`;
const err = (message, blocks) => Object.assign(new Error(message), { code: 'mechanism', blocks });

function parseFrame(end) {
  const s = String(end), at = s.lastIndexOf(':');
  return at < 0 ? { id: s, port: '' } : { id: s.slice(0, at), port: s.slice(at + 1) };
}

function normalizeJoins(joins, blocks, path) {
  if (joins === undefined || joins === null) return undefined;
  if (!Array.isArray(joins)) throw new Error(`${path}.joins: a list of joins, each a list of frame ports such as ["world:W", "rail:B"]`);
  const byId = new Map(blocks.map((b) => [b.id, b])), used = new Map();
  return joins.map((j, i) => {
    const at = `${path}.joins[${i}]`;
    if (!Array.isArray(j) || j.length < 2) throw new Error(`${at}: a join holds two frame ports or more`);
    return j.map((end) => {
      const { id, port } = parseFrame(end), b = byId.get(id);
      if (!b) throw new Error(`${at}: no block "${id}"`);
      const frames = MECH_ELEMENTS[b.type]?.frames(b.params) ?? [];
      if (!frames.includes(port)) throw new Error(`${at}: ${label(b)} has no frame port "${port}"${frames.length ? ` (its frame ports: ${frames.join(', ')})` : ' (only Mechanics parts have frame ports)'}`);
      const key = `${id}:${port}`;
      if (used.has(key)) throw new Error(`${at}: ${key} is already in join ${used.get(key) + 1}; a port is in one join (one point)`);
      used.set(key, i);
      return key;
    });
  });
}

function mechanisms(blocks, joins = []) {
  const parts = blocks.filter((b) => isPart(b.type));
  if (!parts.length) return [];
  const frameOf = new Map();
  joins.forEach((j, i) => { for (const key of j) frameOf.set(key, i); });
  let next = joins.length;
  const atFrame = new Map();   
  for (const b of parts) {
    for (const port of MECH_ELEMENTS[b.type].frames(b.params)) {
      const key = `${b.id}:${port}`;
      if (!frameOf.has(key)) frameOf.set(key, next++);
      const f = frameOf.get(key);
      if (!atFrame.has(f)) atFrame.set(f, []);
      atFrame.get(f).push({ part: b, port });
    }
  }
  const seen = new Set(), out = [];
  for (const world of parts.filter((b) => b.type === 'world')) {
    if (seen.has(world.id)) continue;
    const reached = new Map(), mine = [world], rails = [], hinges = [], bodies = [], base = [];
    seen.add(world.id);
    const start = frameOf.get(`${world.id}:W`);
    reached.set(start, { c: [0, 0], rails: [], rods: [], hinge: -1 });
    const queue = [start];
    while (queue.length) {
      const f = queue.shift(), fr = reached.get(f);
      for (const { part: b, port } of atFrame.get(f)) {
        if (b === world && port === 'W') continue;
        if (seen.has(b.id)) {
          if (mine.includes(b)) continue;
          throw err(`${label(b)} is in two mechanisms`, [b.id]);
        }
        if (b.type === 'world') throw err(`${label(world)} and ${label(b)} are joined: one World per mechanism`, [world.id, b.id]);
        const frames = MECH_ELEMENTS[b.type].frames(b.params);
        if (frames.length === 2 && port !== frames[0]) throw err(`${label(b)} is joined the wrong way round: its base (${frames[0]}) goes on the World's side`, [b.id]);
        seen.add(b.id); mine.push(b);
        const p = b.params;
        if (b.type === 'mass') { bodies.push({ part: b, m: p.m, I: 0, hinge: -1, c: [...fr.c], rails: [...fr.rails], rods: [...fr.rods] }); continue; }
        let g;
        if (b.type === 'rail') {
          if (fr.hinge >= 0) throw err(`${label(b)} sits on a part that turns (${label(hinges[fr.hinge])}): a rail's base must not turn (the World or another rail)`, [b.id, hinges[fr.hinge].id]);
          rails.push(b);
          g = { c: [...fr.c], rails: [...fr.rails, rails.length - 1], rods: [...fr.rods], hinge: -1 };
        } else if (b.type === 'hinge') {
          hinges.push(b); base.push(fr.hinge);
          g = { c: [...fr.c], rails: [...fr.rails], rods: [...fr.rods], hinge: hinges.length - 1 };
        } else {
          const along = (k) => (fr.hinge < 0 ? { c: [fr.c[0], fr.c[1] + k * p.l], rods: [...fr.rods] } : { c: [...fr.c], rods: [...fr.rods, { part: b, hinge: fr.hinge, f: k }] });
          const tip = along(1);
          g = { c: tip.c, rails: [...fr.rails], rods: tip.rods, hinge: fr.hinge };
          if (p.m > 0) {
            if (p.at === 'uniform') { const mid = along(0.5); bodies.push({ part: b, m: p.m, I: (p.m * p.l * p.l) / 12, hinge: fr.hinge, c: mid.c, rails: [...fr.rails], rods: mid.rods }); }
            else bodies.push({ part: b, m: p.m, I: 0, hinge: -1, c: tip.c, rails: [...fr.rails], rods: tip.rods });
          }
        }
        const gi = frameOf.get(`${b.id}:${frames[1]}`);
        if (reached.has(gi)) throw err(`a mechanism must be a tree: ${label(b)} closes a loop`, [b.id]);
        reached.set(gi, g);
        queue.push(gi);
      }
    }
    const order = (list) => list.slice().sort((a, b) => blocks.indexOf(a) - blocks.indexOf(b));
    const rs = order(rails), hs = order(hinges);
    const ri = rails.map((b) => rs.indexOf(b)), hi = hinges.map((b) => hs.indexOf(b));
    for (const body of bodies) {
      body.rails = body.rails.map((r) => ri[r]);
      body.rods = body.rods.map((r) => ({ ...r, hinge: hi[r.hinge] }));
      if (body.hinge >= 0) body.hinge = hi[body.hinge];
    }
    const baseOrdered = new Array(hs.length);
    hinges.forEach((b, j) => { baseOrdered[hi[j]] = base[j] < 0 ? -1 : hi[base[j]]; });
    const joints = order([...rs, ...hs]);
    const names = new Map();
    for (const jn of joints) for (const k of ['name', 'rate']) {
      const nm = jn.params[k];
      if (names.has(nm)) throw err(`${label(names.get(nm))} and ${label(jn)} both name a coordinate or rate ${nm}`, [names.get(nm).id, jn.id]);
      names.set(nm, jn);
    }
    if (joints.length || bodies.length) out.push({ world, parts: mine, rails: rs, hinges: hs, joints, base: baseOrdered, bodies });
  }
  const loose = parts.filter((b) => !seen.has(b.id));
  if (loose.length) throw err(`${loose.map(label).join(', ')} ${loose.length === 1 ? 'is' : 'are'} not joined to a World`, loose.map((b) => b.id));
  return out;
}

function constants(mech) {
  const g = mech.world.params.g, np = mech.rails.length, nh = mech.hinges.length;
  const d = mech.rails.map((r) => [Math.cos(r.params.incline), Math.sin(r.params.incline)]);
  const Mpp = new Float64Array(np * np), Cpr = new Float64Array(np * nh), Crr = new Float64Array(nh * nh), I = new Float64Array(nh), Gp = new Float64Array(np), Gr = new Float64Array(nh);
  for (const b of mech.bodies) {
    const L = new Float64Array(nh);
    for (const r of b.rods) L[r.hinge] += r.f * r.part.params.l;
    const P = new Float64Array(np);
    for (const p of b.rails) P[p] = 1;
    for (let p = 0; p < np; p++) {
      for (let q = 0; q < np; q++) Mpp[p * np + q] += b.m * P[p] * P[q] * (d[p][0] * d[q][0] + d[p][1] * d[q][1]);
      for (let j = 0; j < nh; j++) Cpr[p * nh + j] += b.m * P[p] * L[j];
      Gp[p] -= g * b.m * P[p] * d[p][1];
    }
    for (let j = 0; j < nh; j++) {
      for (let k = 0; k < nh; k++) Crr[j * nh + k] += b.m * L[j] * L[k];
      Gr[j] += g * b.m * L[j];
    }
    if (b.hinge >= 0) I[b.hinge] += b.I;
  }
  return { g, np, nh, d, Mpp, Cpr, Crr, I, Gp, Gr };
}

function mechanismOde(mech) {
  const K = constants(mech), { np, nh, d, Mpp, Cpr, Crr, I, Gp, Gr } = K, N = np + nh;
  const joints = [...mech.rails, ...mech.hinges];
  const outAt = mech.joints.map((b) => joints.indexOf(b));
  const inputs = mech.joints.filter((b) => (b.type === 'rail' ? b.params.force : b.params.torque));
  const railIn = new Int32Array(np).fill(-1), hingeIn = new Int32Array(nh).fill(-1);
  inputs.forEach((b, k) => { if (b.type === 'rail') railIn[mech.rails.indexOf(b)] = k; else hingeIn[mech.hinges.indexOf(b)] = k; });
  const bf = Float64Array.from(mech.rails, (r) => r.params.b), cf = Float64Array.from(mech.hinges, (h) => h.params.c);
  const base = Int32Array.from(mech.base);
  for (let p = 0; p < np; p++) if (!(Mpp[p * np + p] > 0)) throw err(`${label(mech.rails[p])} moves no mass: put a Mass on it`, [mech.rails[p].id]);
  for (let j = 0; j < nh; j++) if (!(Crr[j * nh + j] + I[j] > 0)) throw err(`${label(mech.hinges[j])} moves no mass: put a Rod with a mass, or a Mass, on it`, [mech.hinges[j].id]);
  const ode = {
    n: 2 * N, mechanism: mech, constants: K, nIn: inputs.length, inputs,
    states: () => [
      ...mech.rails.map((b) => ({ name: b.params.name, unit: 'm', angle: false })), ...mech.hinges.map((b) => ({ name: b.params.name, unit: 'rad', angle: true })),
      ...mech.rails.map((b) => ({ name: b.params.rate, unit: 'm/s', angle: false })), ...mech.hinges.map((b) => ({ name: b.params.rate, unit: 'rad/s', angle: false })),
    ],
    init: () => [...mech.rails.map((b) => b.params.x0), ...mech.hinges.map((b) => b.params.theta0), ...mech.rails.map((b) => b.params.v0), ...mech.hinges.map((b) => b.params.omega0)],
    out: (X, o, p, y) => { for (let k = 0; k < outAt.length; k++) { y[2 * k] = X[o + outAt[k]]; y[2 * k + 1] = X[o + N + outAt[k]]; } },
    make() {
      const s = new Float64Array(nh), c = new Float64Array(nh), w2 = new Float64Array(nh), tq = new Float64Array(nh);
      const A = new Float64Array(N * N), r = new Float64Array(N), q = new Float64Array(N), one = inputs.length === 1;
      return (X, o, u, dX, uv) => {
        for (let j = 0; j < nh; j++) { const th = X[o + np + j], w = X[o + N + np + j]; s[j] = Math.sin(th); c[j] = Math.cos(th); w2[j] = w * w; }
        for (let p = 0; p < np; p++) {
          for (let k = 0; k <= p; k++) A[p * N + k] = Mpp[p * np + k];
          let rp = Gp[p] - bf[p] * X[o + N + p];
          if (railIn[p] >= 0) rp += one ? u : uv[railIn[p]];
          for (let k = 0; k < nh; k++) rp += Cpr[p * nh + k] * (d[p][0] * s[k] + d[p][1] * c[k]) * w2[k];
          r[p] = rp;
        }
        for (let j = 0; j < nh; j++) {
          const wj = X[o + N + np + j], wb = base[j] >= 0 ? X[o + N + np + base[j]] : 0;
          tq[j] = (hingeIn[j] >= 0 ? (one ? u : uv[hingeIn[j]]) : 0) - cf[j] * (wj - wb);
        }
        for (let j = 0; j < nh; j++) {
          const row = (np + j) * N;
          for (let p = 0; p < np; p++) A[row + p] = Cpr[p * nh + j] * (d[p][0] * c[j] - d[p][1] * s[j]);
          let rj = Gr[j] * s[j] + tq[j];
          for (let k = 0; k < nh; k++) {
            if (k <= j) A[row + np + k] = Crr[j * nh + k] * (c[j] * c[k] + s[j] * s[k]) + (k === j ? I[j] : 0);
            rj -= Crr[j * nh + k] * (s[j] * c[k] - c[j] * s[k]) * w2[k];
            if (base[k] === j) rj -= tq[k];   
          }
          r[np + j] = rj;
        }
        for (let j = 0; j < N; j++) {
          let dd = A[j * N + j];
          for (let k = 0; k < j; k++) dd -= A[j * N + k] * A[j * N + k] * A[k * N + k];
          A[j * N + j] = dd;
          for (let i = j + 1; i < N; i++) {
            let e = A[i * N + j];
            for (let k = 0; k < j; k++) e -= A[i * N + k] * A[j * N + k] * A[k * N + k];
            A[i * N + j] = e / dd;
          }
        }
        for (let i = 0; i < N; i++) { let e = r[i]; for (let k = 0; k < i; k++) e -= A[i * N + k] * q[k]; q[i] = e; }
        for (let i = 0; i < N; i++) q[i] /= A[i * N + i];
        for (let i = N - 1; i >= 0; i--) { let e = q[i]; for (let k = i + 1; k < N; k++) e -= A[k * N + i] * q[k]; q[i] = e; }
        for (let i = 0; i < N; i++) { dX[o + i] = X[o + N + i]; dX[o + N + i] = q[i]; }
      };
    },
    bound: () => {
      const lens = [];
      for (const b of mech.parts) if (b.type === 'rod' && b.params.l > 0) lens.push(b.params.at === 'uniform' ? (2 * b.params.l) / 3 : b.params.l);
      let w = nh && lens.length ? 4 * Math.sqrt((K.g / Math.min(...lens)) * (1 + nh)) : 0;
      for (let p = 0; p < np; p++) w += bf[p] / Mpp[p * np + p];
      for (let j = 0; j < nh; j++) w += cf[j] / (Crr[j * nh + j] + I[j]);
      return w;
    },
    pose(X, o = 0) {
      const at = (b) => {
        let x = b.c[0], y = b.c[1];
        for (const p of b.rails) { x += X[o + p] * d[p][0]; y += X[o + p] * d[p][1]; }
        for (const rr of b.rods) { const th = X[o + np + rr.hinge], l = rr.f * rr.part.params.l; x += l * Math.sin(th); y += l * Math.cos(th); }
        return [x, y];
      };
      return mech.bodies.map((b) => ({ id: b.part.id, m: b.m, I: b.I, hinge: b.hinge, angle: b.hinge >= 0 ? X[o + np + b.hinge] : 0, at: at(b) }));
    },
  };
  return ode;
}

return { MECH_ELEMENTS, isPart, checkCoord, parseFrame, normalizeJoins, mechanisms, constants, mechanismOde };
})();
// ---- core/physics.js
__mods['core/physics.js'] = (() => {

const field = (key, label, unit, def, extra = {}) => ({ key, label, unit, default: def, ...extra });

const TANK_MASK = [
  field('r0', 'Bottom radius r0', 'm', 0.05, { min: 1e-4 }), field('R', 'Top radius R', 'm', 0.5, { min: 1e-4 }),
  field('H', 'Height H', 'm', 1, { min: 1e-3 }), field('a', 'Outlet area a', 'm²', 0.1, { min: 0 }),
  field('g', 'g', 'm/s²', 9.81), field('h0', 'Start level h₀', 'm', 0.25, { min: 0 }),
];
const CART_POLE_MASK = [
  field('M', 'Cart M', 'kg', 1, { min: 1e-6 }), field('m', 'Bob m', 'kg', 0.2, { min: 1e-6 }), field('l', 'Length l', 'm', 0.5, { min: 1e-6 }),
  field('g', 'g', 'm/s²', 9.81), field('b', 'Friction b', 'N·s/m', 0.1, { min: 0 }), field('theta0', 'Start θ₀', 'rad', 0.05),
];
const chainMask = (n) => [
  field('M', 'Cart M', 'kg', 1, { min: 1e-6 }),
  ...Array.from({ length: n }, (_, i) => [field(`m${i + 1}`, `Mass m${i + 1}`, 'kg', 0.1, { min: 1e-6 }), field(`l${i + 1}`, `Rod l${i + 1}`, 'm', 0.25, { min: 1e-6 })]).flat(),
  field('g', 'g', 'm/s²', 9.81), field('b', 'Friction b', 'N·s/m', 0.1, { min: 0 }),
  ...Array.from({ length: n }, (_, i) => field(`theta${i + 1}0`, `Start θ${i + 1}₀`, 'rad', i === 0 ? 0.05 : 0)),
];

const values = (mask, p = {}) => Object.fromEntries(mask.map((f) => [f.key, p[f.key] ?? f.default]));
const masked = (mask, p, diagram) => ({ type: 'subsystem', mask: mask.map((f) => ({ ...f })), params: values(mask, p), diagram });
const port = (id, type, name, n, x, y) => ({ id, type, name, params: { port: n }, x, y });

function conicalTank(p = {}) {
  return masked(TANK_MASK, p, {
    blocks: [
      port('q', 'inport', 'q', 1, 20, 66),
      { id: 'net', type: 'sum', name: 'net inflow', params: { signs: '+-' }, x: 130, y: 63 },
      { id: 'rate', type: 'fcn', name: 'level rate', params: { inputs: 'Q, h', eqs: 'r = r0 + (R - r0)*h/H\nA = pi*r^2\ndh = Q/A', outputs: 'dh' }, x: 210, y: 50 },
      { id: 'level', type: 'integrator', name: 'h', params: { K: 1, x0: 'h0', min: 0, max: 'H', unit: 'm', angle: 0 }, x: 460, y: 56 },
      { id: 'outlet', type: 'fcn', name: 'outlet (Torricelli)', params: { inputs: 'h', eqs: 'qout = a*sqrt(2*g*h)', outputs: 'qout' }, x: 250, y: 170, flip: true },
      port('o_1', 'outport', 'h', 1, 660, 66),
    ],
    wires: [
      { from: 'q', to: 'net' }, { from: 'net', to: 'rate' }, { from: 'level', to: 'rate:1' }, { from: 'rate', to: 'level' },
      { from: 'level', to: 'o_1' }, { from: 'level', to: 'outlet' }, { from: 'outlet', to: 'net:1' },
    ],
  });
}

function cartChain(n, p, names) {
  const theta = (k) => names.theta(k), omega = (k) => names.omega(k);
  const blocks = [
    port('F', 'inport', 'F', 1, 20, 40),
    { id: 'world', type: 'world', name: 'world', params: { g: 'g' }, x: 20, y: 200 },
    { id: 'rail', type: 'rail', name: 'rail', params: { name: 'x', rate: 'v', b: 'b', force: 1 }, x: 130, y: 120 },
    { id: 'cart', type: 'mass', name: 'cart', params: { m: 'M' }, x: 150, y: 260 },
  ];
  const wires = [{ from: 'F', to: 'rail' }, { from: 'rail', to: 'o_1' }, { from: 'rail:1', to: `o_${n + 2}` }];
  const joins = [['world:W', 'rail:B'], ['rail:F', 'cart:F', `${names.hinge(1)}:B`]];
  for (let k = 1; k <= n; k++) {
    const h = names.hinge(k), r = names.rod(k), x = 130 + 220 * k;
    blocks.push({ id: h, type: 'hinge', name: n === 1 ? 'hinge' : `hinge ${k}`, params: { name: theta(k), rate: omega(k), theta0: names.theta0(k) }, x, y: 120 });
    blocks.push({ id: r, type: 'rod', name: n === 1 ? 'pole' : `rod ${k}`, params: { l: names.l(k), m: names.m(k), at: 'tip' }, x: x + 110, y: 200 });
    wires.push({ from: h, to: `o_${k + 1}` }, { from: `${h}:1`, to: `o_${n + k + 2}` });
    joins.push([`${h}:F`, `${r}:B`]);
    if (k < n) joins.push([`${r}:T`, `${names.hinge(k + 1)}:B`]);
  }
  const outs = ['x', ...Array.from({ length: n }, (_, i) => theta(i + 1)), 'v', ...Array.from({ length: n }, (_, i) => omega(i + 1))];
  outs.forEach((nm, i) => blocks.push(port(`o_${i + 1}`, 'outport', nm, i + 1, 360 + 220 * n, 20 + 36 * i)));
  return { blocks, wires, joins };
}

function cartPole(p = {}) {
  return masked(CART_POLE_MASK, p, cartChain(1, p, {
    theta: () => 'θ', omega: () => 'ω', hinge: () => 'hinge', rod: () => 'pole', theta0: () => 'theta0', l: () => 'l', m: () => 'm',
  }));
}

function pendulumOnCart(n, p = {}) {
  return masked(chainMask(n), p, cartChain(n, p, {
    theta: (k) => `θ${k}`, omega: (k) => `ω${k}`, hinge: (k) => `hinge${k}`, rod: (k) => `rod${k}`, theta0: (k) => `theta${k}0`, l: (k) => `l${k}`, m: (k) => `m${k}`,
  }));
}

const TEMPLATES = {
  conicalTank: { label: 'Conical tank', formula: 'q → h', name: 'tank', make: () => conicalTank() },
};

const OLD_TYPES = {
  conicalTank: (p) => conicalTank(p),
};
const isOldPhysics = (type) => Object.hasOwn(OLD_TYPES, type);

function expandPhysics(b) {
  const sub = OLD_TYPES[b.type](b.params ?? {});
  return { id: b.id, ...(b.name ? { name: b.name } : {}), x: b.x, y: b.y, ...(b.flip ? { flip: true } : {}), ...sub };
}

const physicalMaskKeys = (mask) => mask.filter((f) => f.key !== 'g' && !/^Start\b/.test(f.label)).map((f) => f.key);

return { conicalTank, cartPole, pendulumOnCart, TEMPLATES, isOldPhysics, expandPhysics, physicalMaskKeys };
})();
// ---- core/diagram.js
__mods['core/diagram.js'] = (() => {

const { BLOCKS, blockDef, normalizeBlock } = __mods['core/blocks.js'];
const { tf2ss, rootBound } = __mods['core/poly.js'];
const { eig, csolve } = __mods['core/linalg.js'];
const { siUnit } = __mods['core/scale.js'];
const { gaussAt } = __mods['core/signals.js'];
const { isFormula, parseFormula, formulaNames, compileFormula, isReserved, NAME_RE } = __mods['core/formula.js'];
const { CONTROLLERS, normalizeVariant, makeLaw } = __mods['core/controllers.js'];
const { isOldPhysics, expandPhysics } = __mods['core/physics.js'];
const { MECH_ELEMENTS, isPart, normalizeJoins, mechanisms, mechanismOde, checkCoord } = __mods['core/mech.js'];
const { OBSERVERS } = __mods['core/observers.js'];
const { SYNC_DESIGNS, defaultDesigns } = __mods['core/design.js'];
const { EXTERNAL_BLOCK } = __mods['core/hil.js'];
const num = (key, label, def, extra = {}) => ({ key, label, default: def, ...extra });

const ELEMENTS = {
  source: { label: 'Source', group: 'Signals', params: [{ key: 'signal', label: 'Signal', default: 'r', kind: 'name' }, { key: 'unit', label: 'Unit', default: '1', kind: 'unit' }], ports: () => [0, 1], formula: 'r(t)' },
  sink: { label: 'Sink', group: 'Signals', params: [{ key: 'name', label: 'Name', default: 'y1', kind: 'name' }, { key: 'unit', label: 'Unit', default: '1', kind: 'unit' }], ports: () => [1, 0], formula: 'y' },
  terminator: { label: 'Terminator', group: 'Signals', params: [], ports: () => [1, 0], formula: 'ends a signal' },
  switch: {
    label: 'Switch', group: 'Math', formula: 'passes one input',
    params: [num('inputs', 'Inputs', 2, { min: 2, int: true }), num('position', 'Position', 1, { min: 1, int: true })],
    ports: (p) => [p.inputs, 1],
  },
  inport: { label: 'In', group: 'Ports', params: [num('port', 'Port', 1, { min: 1, int: true })], ports: () => [0, 1], formula: 'u' },
  outport: { label: 'Out', group: 'Ports', params: [num('port', 'Port', 1, { min: 1, int: true })], ports: () => [1, 0], formula: 'y' },
  gain: { label: 'Gain', group: 'Math', params: [num('K', 'K', 1)], ports: () => [1, 1], formula: 'K' },
  sum: { label: 'Sum', group: 'Math', params: [{ key: 'signs', label: 'Signs', default: '+-', kind: 'signs' }], ports: (p) => [p.signs.length, 1], formula: 'Σ' },
  integrator: {
    label: 'Integrator', group: 'Dynamics', formula: 'K / s',
    params: [num('K', 'K', 1), num('x0', 'Start x₀', 0), num('min', 'Min', null, { nullable: 'none', inf: true }), num('max', 'Max', null, { nullable: 'none', inf: true }),
      { key: 'unit', label: 'Unit', default: '1', kind: 'unit' }, num('angle', 'Angle (0/1)', 0, { int: true, min: 0, max: 1 })],
    ports: () => [1, 1], tf: (p) => ({ num: [p.K], den: [1, 0] }),
  },
  delay: { label: 'Dead time', group: 'Dynamics', params: [num('L', 'Dead time T_d', 0.1, { unit: 's', min: 0 }), num('y0', 'Output before T_d', 0, { nullable: 'its input at t = 0' })], ports: () => [1, 1], formula: 'e^(−T_d·s)' },
  fcn: {
    label: 'Equations', group: 'Math', formula: 'y = f(u, t)',
    params: [{ key: 'inputs', label: 'Inputs', default: 'u', kind: 'names' }, { key: 'eqs', label: 'Equations', default: 'y = u^2', kind: 'eqs' }, { key: 'outputs', label: 'Outputs', default: 'y', kind: 'names' }],
    ports: (p) => [nameList(p.inputs).length, nameList(p.outputs).length],
    outputs: (p) => nameList(p.outputs), inputNames: (p) => nameList(p.inputs),
    normalize: (params, where, scope) => normalizeEquations(params, where, scope),
  },
  saturation: { label: 'Saturation', group: 'Nonlinear', params: [num('min', 'Min', -1, { inf: true }), num('max', 'Max', 1, { inf: true })], ports: () => [1, 1], formula: 'clamp' },
  quantizer: { label: 'Quantizer', group: 'Sensors', params: [num('q', 'Step', 0.01, { min: 1e-12 })], ports: () => [1, 1], formula: 'q · round(u / q)' },
  noise: { label: 'Noise', group: 'Sensors', params: [num('std', 'σ', 0.01, { min: 0 }), num('seed', 'Seed', 1, { int: true, min: 0 })], ports: () => [1, 1], formula: 'u + n,  n ~ N(0, σ²)' },
  cartPole: {
    label: 'Cart–pole', group: 'Physics', formula: 'F → x, θ, v, ω', outputs: ['x', 'θ', 'v', 'ω'], ports: () => [1, 4],
    params: [num('M', 'Cart M', 1, { unit: 'kg', min: 1e-6 }), num('m', 'Bob m', 0.2, { unit: 'kg', min: 1e-6 }), num('l', 'Length l', 0.5, { unit: 'm', min: 1e-6 }), num('g', 'g', 9.81, { unit: 'm/s²' }), num('b', 'Friction b', 0.1, { unit: 'N·s/m', min: 0 }), num('theta0', 'Start θ₀', 0.05, { unit: 'rad' })],
    ode: {
      n: 4,
      states: () => [state('x', 'm'), state('v', 'm/s'), state('θ', 'rad', true), state('ω', 'rad/s')],
      init: (p) => [0, 0, p.theta0, 0],
      out: (X, o, p, y) => { y[0] = X[o]; y[1] = X[o + 2]; y[2] = X[o + 1]; y[3] = X[o + 3]; },
      make(p) {
        const { M, m, l, g, b } = p, ml = m * l, mg = m * g;
        return (X, o, u, dX) => {
          const v = X[o + 1], th = X[o + 2], w = X[o + 3];
          const s = Math.sin(th), c = Math.cos(th);
          const a = (u - b * v + ml * w * w * s - mg * s * c) / (M + m * s * s);
          dX[o] = v; dX[o + 1] = a; dX[o + 2] = w; dX[o + 3] = (g * s - a * c) / l;
        };
      },
      bound: (p) => 2 * Math.sqrt(p.g * (p.M + p.m) / (p.M * p.l)) + p.b / p.M,
    },
  },
  pendulumCart: {
    label: 'Pendulum chain on cart', group: 'Physics', formula: 'F → x, θ…, v, ω…',
    outputs: (p) => ['x', ...links(p).map((i) => `θ${i + 1}`), 'v', ...links(p).map((i) => `ω${i + 1}`)],
    ports: (p) => [1, 2 * p.links + 2],
    params: [num('links', 'Links', 3, { min: 1, int: true, max: 3 }), num('M', 'Cart M', 1, { unit: 'kg', min: 1e-6 }),
      ...[1, 2, 3].flatMap((i) => [num(`m${i}`, `Mass m${i}`, 0.1, { unit: 'kg', min: 1e-6 }), num(`l${i}`, `Rod l${i}`, 0.25, { unit: 'm', min: 1e-6 })]),
      num('g', 'g', 9.81, { unit: 'm/s²' }), num('b', 'Friction b', 0.1, { unit: 'N·s/m', min: 0 }),
      ...[1, 2, 3].map((i) => num(`theta${i}0`, `Start θ${i}₀`, i === 1 ? 0.05 : 0, { unit: 'rad' }))],
    ode: {
      n: (p) => 2 * p.links + 2,
      states: (p) => [state('x', 'm'), ...links(p).map((i) => state(`θ${i + 1}`, 'rad', true)), state('v', 'm/s'), ...links(p).map((i) => state(`ω${i + 1}`, 'rad/s'))],
      init: (p) => { const n = p.links; return [0, ...links(p).map((i) => p[`theta${i + 1}0`]), 0, ...new Array(n).fill(0)]; },
      out: (X, o, p, y) => { for (let i = 0; i < 2 * p.links + 2; i++) y[i] = X[o + i]; },
      make: (p) => chainRates(p),
      bound: (p) => 4 * Math.sqrt((p.g / Math.min(...links(p).map((i) => p[`l${i + 1}`]))) * (1 + p.links)) + p.b / p.M,
    },
  },
  controller: {
    label: 'Controller', group: 'Control', formula: 'u = C(r, y)',
    params: [num('inputs', 'Inputs (r, y…)', 2, { min: 1, int: true }), num('Ts', 'Sample time Ts', 0.01, { unit: 's', min: 1e-4 })],
    ports: (p) => [p.inputs, 1],
  },
  observer: {
    label: 'Observer', group: 'Control', formula: 'x̂ = O(u, y)',
    params: [num('inputs', 'Inputs (u, y…)', 2, { min: 2, int: true }), num('outputs', 'Estimates', 2, { min: 1, int: true }), num('Ts', 'Sample time Ts', 0.001, { unit: 's', min: 1e-4 })],
    ports: (p) => [p.inputs, p.outputs],
    outputs: (p) => Array.from({ length: p.outputs }, (_, i) => `x̂${i + 1}`),
  },
  external: EXTERNAL_BLOCK,
  ...MECH_ELEMENTS,
  subsystem: { label: 'Subsystem', group: 'Structure', params: [], ports: null, formula: '' },
};

const VARIANT_LIBS = { controller: CONTROLLERS, observer: OBSERVERS };

const links = (p) => Array.from({ length: p.links }, (_, i) => i);

const state = (name, unit, angle = false) => ({ name, unit, angle });

const nameList = (text) => String(text ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const eqLines = (text) => String(text ?? '').split(/\n|;/).map((x) => x.trim()).filter(Boolean).map((line) => {
  const at = line.indexOf('=');
  return at < 0 ? { name: '', src: line, line } : { name: line.slice(0, at).trim(), src: line.slice(at + 1).trim(), line };
});
function normalizeEquations(params = {}, where, scope) {
  const p = params.eqs === undefined && params.expr !== undefined ? { inputs: 'u', eqs: `y = ${params.expr}`, outputs: 'y' } : params;
  const inputs = nameList(p.inputs ?? 'u'), outputs = nameList(p.outputs ?? 'y'), lines = eqLines(p.eqs ?? 'y = u^2');
  const seen = new Set();
  const named = (n, what) => {
    if (!NAME_RE.test(n)) throw new Error(`${where}.${what}: "${n}" is not a name (letters, digits, _; Greek letters too)`);
    if (isReserved(n)) throw new Error(`${where}.${what}: "${n}" is the time, a constant or a function; choose another name`);
    if (seen.has(n)) throw new Error(`${where}.${what}: "${n}" is defined twice`);
    seen.add(n);
  };
  for (const n of inputs) named(n, 'inputs');
  if (!lines.length) throw new Error(`${where}.eqs: at least one line "name = formula"`);
  for (const [i, l] of lines.entries()) {
    if (!l.name) throw new Error(`${where}.eqs line ${i + 1}: "name = formula", not "${l.line}"`);
    named(l.name, `eqs line ${i + 1}`);
    let tree;
    try { tree = parseFormula(l.src); } catch (e) { throw new Error(`${where}.eqs line ${i + 1} (${l.name}): ${e.message}`); }
    const known = [...inputs, ...lines.slice(0, i).map((x) => x.name)];
    for (const n of formulaNames(tree)) {
      if (known.includes(n) || scopeValue(scope, n) !== undefined || ['t', 'pi', 'e', 'inf'].includes(n.toLowerCase())) continue;
      throw new Error(`${where}.eqs line ${i + 1}: '${n}' is not an input, a name defined above, or a parameter${scope ? ` (${scopeKeys(scope).join(', ')})` : ' (no mask around this block)'}`);
    }
  }
  if (!outputs.length) throw new Error(`${where}.outputs: at least one`);
  for (const n of outputs) if (!lines.some((l) => l.name === n)) throw new Error(`${where}.outputs: "${n}" is not computed by a line`);
  return { inputs: inputs.join(', '), eqs: lines.map((l) => `${l.name} = ${l.src}`).join('\n'), outputs: outputs.join(', ') };
}
function compileEquations(params, consts) {
  const inputs = nameList(params.inputs), lines = eqLines(params.eqs), outputs = nameList(params.outputs);
  const slot = new Map(inputs.map((n, i) => [n, i]));
  slot.set('t', inputs.length);
  const fs = lines.map((l, k) => {
    const f = compileFormula(l.src, (n) => (slot.has(n) ? { slot: slot.get(n) } : consts?.has(n) ? { value: consts.get(n) } : null));
    slot.set(l.name, inputs.length + 1 + k);
    return f;
  });
  const first = inputs.length + 1;
  return { n: first + lines.length, nIn: inputs.length, fs, first, out: outputs.map((n) => slot.get(n)) };
}

function chainRates(p) {
  const n = p.links, N = n + 1, { g, b } = p;
  const mu = new Float64Array(n), ml = new Float64Array(n), mgl = new Float64Array(n), mll = new Float64Array(n * n);
  for (let i = n - 1, acc = 0; i >= 0; i--) { acc += p[`m${i + 1}`]; mu[i] = acc; }
  for (let j = 0; j < n; j++) {
    const lj = p[`l${j + 1}`];
    ml[j] = mu[j] * lj; mgl[j] = mu[j] * g * lj;
    for (let k = 0; k < n; k++) mll[j * n + k] = mu[Math.max(j, k)] * lj * p[`l${k + 1}`];
  }
  const total = p.M + mu[0];
  const s = new Float64Array(n), c = new Float64Array(n), w2 = new Float64Array(n);
  const A = new Float64Array(N * N), r = new Float64Array(N), q = new Float64Array(N);
  return (X, o, u, dX) => {
    for (let j = 0; j < n; j++) {
      const th = X[o + 1 + j], w = X[o + n + 2 + j];
      s[j] = Math.sin(th); c[j] = Math.cos(th); w2[j] = w * w;
    }
    A[0] = total;
    r[0] = u - b * X[o + n + 1];
    for (let j = 0; j < n; j++) {
      const row = (j + 1) * N;
      A[row] = ml[j] * c[j];
      r[0] += ml[j] * s[j] * w2[j];
      let rj = mgl[j] * s[j];
      for (let k = 0; k < n; k++) {
        const cjk = c[j] * c[k] + s[j] * s[k], sjk = s[j] * c[k] - c[j] * s[k];   
        if (k <= j) A[row + k + 1] = mll[j * n + k] * cjk;
        rj -= mll[j * n + k] * sjk * w2[k];
      }
      r[j + 1] = rj;
    }
    for (let j = 0; j < N; j++) {
      let d = A[j * N + j];
      for (let k = 0; k < j; k++) d -= A[j * N + k] * A[j * N + k] * A[k * N + k];
      A[j * N + j] = d;
      for (let i = j + 1; i < N; i++) {
        let e = A[i * N + j];
        for (let k = 0; k < j; k++) e -= A[i * N + k] * A[j * N + k] * A[k * N + k];
        A[i * N + j] = e / d;
      }
    }
    for (let i = 0; i < N; i++) { let e = r[i]; for (let k = 0; k < i; k++) e -= A[i * N + k] * q[k]; q[i] = e; }
    for (let i = 0; i < N; i++) q[i] /= A[i * N + i];
    for (let i = N - 1; i >= 0; i--) { let e = q[i]; for (let k = i + 1; k < N; k++) e -= A[k * N + i] * q[k]; q[i] = e; }
    dX[o] = X[o + n + 1];
    for (let j = 0; j < n; j++) { dX[o + 1 + j] = X[o + n + 2 + j]; dX[o + n + 2 + j] = q[j + 1]; }
    dX[o + n + 1] = q[0];
  };
}

function outputNames(def, params) {
  return typeof def.outputs === 'function' ? def.outputs(params) : def.outputs ?? [];
}

function diagramBlockDef(type) {
  if (ELEMENTS[type]) return ELEMENTS[type];
  const b = BLOCKS.plant[type];
  if (!b) throw new Error(`unknown block type "${type}"; types: ${[...Object.keys(ELEMENTS), ...Object.keys(BLOCKS.plant)].join(', ')}`);
  return { label: b.label, group: 'Models', params: b.params, ports: () => [1, 1], formula: b.formula, tf: (p) => b.tf(p), model: true, ...(b.summary ? { summary: b.summary } : {}) };
}

function diagramTypes() {
  return [...Object.keys(ELEMENTS), ...Object.keys(BLOCKS.plant)];
}

function blockPorts(block) {
  if (block.type === 'subsystem') {
    const count = (t) => Math.max(0, ...block.diagram.blocks.filter((b) => b.type === t).map((b) => b.params.port));
    return [count('inport'), count('outport')];
  }
  return diagramBlockDef(block.type).ports(block.params);
}

function parseEnd(end) {
  const [id, port] = String(end).split(':');
  return { id, port: port === undefined ? 0 : Number(port) };
}

const scopeValue = (scope, name) => { for (let s = scope; s; s = s.outer) if (s.values.has(name)) return s.values.get(name); return undefined; };
const scopeKeys = (scope) => { const out = []; for (let s = scope; s; s = s.outer) for (const k of s.values.keys()) if (!out.includes(k)) out.push(k); return out; };
const scopeMap = (scope) => new Map(scopeKeys(scope).map((k) => [k, scopeValue(scope, k)]));
function unknownName(name, scope) {
  return scope ? `'${name}' is not a parameter of '${scope.label}' (${scopeKeys(scope).join(', ')})` : `'${name}' is not a parameter here: outside a masked subsystem a formula uses numbers, pi, e and inf`;
}
function formulaValue(src, scope, where) {
  let tree;
  try { tree = parseFormula(src); } catch (e) { throw new Error(`${where}: ${e.message}`); }
  for (const name of formulaNames(tree)) {
    if (scopeValue(scope, name) === undefined && !['pi', 'e', 'inf'].includes(name.toLowerCase())) throw new Error(`${where}: ${unknownName(name, scope)}`);
  }
  return compileFormula(tree, (n) => { const v = scopeValue(scope, n); return v === undefined ? null : { value: v }; })(new Float64Array(0));
}
function fieldNumber(raw, p, scope, where) {
  if (!isFormula(raw)) return Number(raw);
  if (p.int) throw new Error(`${where}: a whole number, not a formula`);
  const v = formulaValue(raw, scope, where);
  if (Number.isNaN(v) || (!Number.isFinite(v) && !p.inf)) throw new Error(`${where}: ${String(raw).trim()} = ${Number.isNaN(v) ? 'not a number' : v > 0 ? 'inf' : '-inf'}; it must be finite`);
  return v;
}
function normalizeMask(b, where, outer, resolve) {
  const given = b.params && typeof b.params === 'object' ? Object.keys(b.params) : [];
  if (b.mask === undefined || b.mask === null) {
    if (given.length) throw new Error(`${where}: parameters (${given.join(', ')}) need a mask that lists them`);
    return { scope: outer };
  }
  if (!Array.isArray(b.mask)) throw new Error(`${where}.mask: a list of { key, label, unit }`);
  const keys = new Set();
  const mask = b.mask.map((f, i) => {
    const at = `${where}.mask[${i}]`, key = String(f?.key ?? '');
    if (!NAME_RE.test(key)) throw new Error(`${at}: a key such as m, l1 or θ0 (letters, digits, _)`);
    if (isReserved(key)) throw new Error(`${at}: "${key}" is the time, a constant or a function; choose another key`);
    if (keys.has(key)) throw new Error(`${at}: the key "${key}" twice`);
    keys.add(key);
    const unit = String(f.unit ?? '1').trim() || '1';
    if (unit.length > 12 || /[<>"{}]/.test(unit)) throw new Error(`${at}.unit: a short unit such as m, N, rad/s, or 1`);
    const out = { key, label: String(f.label ?? key), unit };
    for (const k of ['min', 'max', 'default']) {
      if (f[k] === undefined || f[k] === null || f[k] === '') continue;
      const v = Number(f[k]);
      if (Number.isNaN(v)) throw new Error(`${at}.${k}: a number`);
      out[k] = v;
    }
    if (out.min !== undefined && out.max !== undefined && out.min > out.max) throw new Error(`${at}: min ${out.min} is above max ${out.max}`);
    return out;
  });
  for (const k of given) if (!keys.has(k)) throw new Error(`${where}.params: "${k}" is not on the mask (${[...keys].join(', ')})`);
  const label = b.name ?? b.id, values = new Map(), params = {};
  for (const f of mask) {
    const raw = b.params?.[f.key] ?? f.default;
    const at = `${where}.params.${f.key}`;
    if (raw === undefined || raw === null || raw === '') throw new Error(`${at}: needs a value`);
    const v = isFormula(raw) ? formulaValue(raw, outer, at) : Number(raw);
    if (Number.isNaN(v)) throw new Error(`${at}: expected a number or a formula`);
    if (f.min !== undefined && v < f.min) throw new Error(`${at}: ${v} is below its min ${f.min}`);
    if (f.max !== undefined && v > f.max) throw new Error(`${at}: ${v} is above its max ${f.max}`);
    values.set(f.key, v);
    params[f.key] = resolve || !isFormula(raw) ? v : String(raw).trim();
  }
  return { mask, params, scope: { label, values, outer } };
}

function hasFormulas(d) {
  return d.blocks.some((b) => {
    if (isOldPhysics(b.type)) return true;   
    if (b.type === 'subsystem') return b.mask?.length > 0 || hasFormulas(b.diagram);
    const def = ELEMENTS[b.type] ?? (BLOCKS.plant[b.type] ? { params: BLOCKS.plant[b.type].params } : null);
    return !!def?.params?.some((p) => (!p.kind && isFormula(b.params?.[p.key])) || (p.kind === 'vector' && Array.isArray(b.params?.[p.key]) && b.params[p.key].some(isFormula)));
  });
}

function maskValues(diagram, idPath = []) {
  let scope = null, d = diagram;
  for (const id of idPath) {
    const b = d.blocks.find((x) => x.id === id);
    if (!b?.diagram) break;
    scope = normalizeMask(b, id, scope, true).scope;
    d = b.diagram;
  }
  return scopeMap(scope);
}
function formulaIn(src, values) {
  try { return compileFormula(src, (n) => (values.has(n) ? { value: values.get(n) } : null))(new Float64Array(0)); } catch { return NaN; }
}

function normalizeParams(type, params = {}, where, scope = null, resolve = false) {
  if (diagramBlockDef(type).model) {
    const def = diagramBlockDef(type), numeric = { ...params }, kept = {};
    for (const p of def.params) {
      const v = params[p.key], at = `${where}.${p.key}`;
      if (p.kind === 'vector' && Array.isArray(v) && v.some(isFormula)) { numeric[p.key] = v.map((x, j) => fieldNumber(x, p, scope, `${at}[${j}]`)); kept[p.key] = v.map((x) => (isFormula(x) ? String(x).trim() : Number(x))); }
      else if (p.kind !== 'vector' && isFormula(v)) { numeric[p.key] = fieldNumber(v, p, scope, at); kept[p.key] = String(v).trim(); }
    }
    const out = normalizeBlock('plant', { type, params: numeric }).params;
    return resolve ? out : { ...out, ...kept };
  }
  if (ELEMENTS[type].normalize) return ELEMENTS[type].normalize(params, where, scope);  
  const out = {}, values = {};
  for (const p of ELEMENTS[type].params) {
    let v = params[p.key] ?? p.default;
    if (p.kind === 'unit') {
      v = String(v).trim() || '1';
      if (v.length > 12 || /[<>"{}]/.test(v)) throw new Error(`${where}.${p.key}: a short unit such as m, N, rad/s, or 1`);
    } else if (p.kind === 'name') {
      v = String(v);
      if (!/^[A-Za-z][A-Za-z0-9_]{0,11}$/.test(v)) throw new Error(`${where}.${p.key}: a name such as r, d or y1 (letters, digits, _)`);
    } else if (p.kind === 'coord') {
      v = checkCoord(v, `${where}.${p.key}`);
    } else if (p.kind === 'choice') {
      v = String(v);
      if (!p.options.includes(v)) throw new Error(`${where}.${p.key}: one of ${p.options.join(', ')}`);
    } else if (p.kind === 'signs') {
      v = String(v);
      if (!/^[+-]{1,8}$/.test(v)) throw new Error(`${where}.signs: one to eight of + and -`);
    } else if (p.nullable && (params[p.key] === null || params[p.key] === '' || (params[p.key] === undefined && p.default === null))) {
      v = null;   
    } else {
      const raw = v;
      v = fieldNumber(raw, p, scope, `${where}.${p.key}`);
      if (Number.isNaN(v) || (!Number.isFinite(v) && !isFormula(raw))) throw new Error(`${where}.${p.key}: expected a number`);
      if (p.int) v = Math.round(v);
      if (p.min !== undefined && v < p.min) throw new Error(`${where}.${p.key}: at least ${p.min}`);
      if (p.max !== undefined && v > p.max) throw new Error(`${where}.${p.key}: at most ${p.max}`);
      values[p.key] = v;
      if (isFormula(raw) && !resolve) v = String(raw).trim();
    }
    out[p.key] = v;
  }
  if (type === 'integrator' && values.min !== undefined && values.max !== undefined && values.min > values.max) throw new Error(`${where}: min ${values.min} is above max ${values.max}`);
  if (type === 'switch') out.position = Math.min(out.position, out.inputs);
  return out;
}

function normalizeDiagram(d, path = 'plant', opts = {}) {
  const { scope = null, resolve = false } = opts;
  if (!d || !Array.isArray(d.blocks)) throw new Error(`${path}: a diagram needs "blocks" and "wires"`);
  const ids = new Set();
  const blocks = d.blocks.map((given, i) => {
    const where = `${path}.blocks[${i}]`;
    const b = isOldPhysics(given.type) ? expandPhysics(given) : given;
    if (!b.id || typeof b.id !== 'string' || /[:/]/.test(b.id)) throw new Error(`${where}: needs an "id" without ":" or "/"`);
    if (ids.has(b.id)) throw new Error(`${where}: duplicate id "${b.id}"`);
    ids.add(b.id);
    const at = `${where}(${b.id})`;
    const m = b.type === 'subsystem' ? normalizeMask(b, at, scope, resolve) : null;
    const out = { id: b.id, type: b.type, params: m ? m.params ?? {} : normalizeParams(b.type, b.params, at, scope, resolve), x: Number(b.x) || 0, y: Number(b.y) || 0 };
    if (b.name) out.name = String(b.name);
    if (b.flip) out.flip = true;
    if (m?.mask) out.mask = m.mask;
    if (b.type === 'subsystem') out.diagram = normalizeDiagram(b.diagram ?? { blocks: [], wires: [] }, `${path}/${b.id}`, { scope: m.scope, resolve });
    if (resolve && b.type === 'fcn' && scope) Object.defineProperty(out, 'consts', { value: scopeMap(scope) });
    if ((b.type === 'controller' || b.type === 'observer') && resolve && Array.isArray(b.variants) && b.variants.length) {
      out.variants = b.variants;
      out.variant = b.variant ?? 0;
    } else if (b.type === 'controller' || b.type === 'observer') {
      const lib = VARIANT_LIBS[b.type];
      const vs = Array.isArray(b.variants) && b.variants.length ? b.variants : [{ type: b.type === 'observer' ? 'difference' : 'pid' }];
      out.variants = vs.map((v, j) => normalizeVariant(v, `${where}(${b.id}).variants[${j}]`, lib, { inputs: out.params.inputs }));
      out.variant = Math.min(Math.max(0, Math.round(Number(b.variant) || 0)), out.variants.length - 1);
    }
    return out;
  });
  const byId = Object.fromEntries(blocks.map((b) => [b.id, b]));
  const wires = (d.wires ?? []).map((w, i) => {
    const f = parseEnd(w.from), t = parseEnd(w.to);
    for (const [e, side] of [[f, 1], [t, 0]]) {
      const b = byId[e.id];
      if (!b) throw new Error(`${path}.wires[${i}]: no block "${e.id}"`);
      const n = blockPorts(b)[side];
      if (!(e.port >= 0 && e.port < n)) throw new Error(`${path}.wires[${i}]: ${b.id} has no ${side ? 'output' : 'input'} ${e.port}`);
    }
    return { from: f.port ? `${f.id}:${f.port}` : f.id, to: t.port ? `${t.id}:${t.port}` : t.id };
  });
  const taken = new Set();
  for (const w of wires) {
    if (taken.has(w.to)) throw new Error(`${path}: input ${w.to} has two wires`);
    taken.add(w.to);
  }
  const joins = normalizeJoins(d.joins, blocks, path);
  return joins ? { blocks, wires, joins } : { blocks, wires };
}

function wrapPlant(block) {
  return {
    blocks: [
      { id: 'in', type: 'inport', params: { port: 1 }, x: 40, y: 80 },
      { id: 'p1', type: block.type, params: { ...block.params }, x: 180, y: 70 },
      { id: 'out', type: 'outport', params: { port: 1 }, x: 380, y: 80 },
    ],
    wires: [{ from: 'in', to: 'p1' }, { from: 'p1', to: 'out' }],
  };
}

function plantDiagram(plant) {
  return plant.type === 'diagram' ? plant.diagram : wrapPlant(plant);
}

function diagramNames(diagram) {
  const sources = new Set(), sinks = [], units = {};
  const walk = (d) => {
    for (const b of d.blocks) {
      if (b.type === 'source') { sources.add(b.params.signal); units[b.params.signal] ??= b.params.unit ?? '1'; }
      if (b.type === 'sink') { sinks.push(b.params.name); units[b.params.name] = b.params.unit ?? '1'; }
      if (b.type === 'subsystem') walk(b.diagram);
    }
  };
  walk(diagram);
  return { sources: [...sources], sinks, units };
}

function blockInputNames(diagram, idPath) {
  const path = Array.isArray(idPath) ? idPath : String(idPath).split('/');
  const lv = path.slice(0, -1).reduce((d, id) => d?.blocks.find((b) => b.id === id)?.diagram, diagram);
  const blk = lv?.blocks.find((b) => b.id === path.at(-1));
  if (!blk) throw new Error(`no block "${path.join('/')}"`);
  return Array.from({ length: blockPorts(blk)[0] }, (_, k) => {
    const w = lv.wires.find((x) => { const t = parseEnd(x.to); return t.id === blk.id && t.port === k; });
    if (!w) return 'not connected';
    const f = parseEnd(w.from), src = lv.blocks.find((b) => b.id === f.id);
    if (src.type === 'source') return src.params.signal;
    if (src.type === 'subsystem') {
      const out = src.diagram.blocks.find((b) => b.type === 'outport' && b.params.port === f.port + 1);
      return out?.name ? (src.mask ? out.name : `${out.name} (${src.name ?? src.id})`) : (src.name ?? src.id);
    }
    const outNames = outputNames(diagramBlockDef(src.type), src.params);
    if (src.type === 'fcn') return outNames.length > 1 ? `${outNames[f.port]} (${src.name ?? src.id})` : (src.name ?? src.id);
    return outNames[f.port] || (src.name ?? src.id);
  });
}

function modelError(code, message, hint = '') {
  return Object.assign(new Error(message), { code, hint });
}
const fmt = (v) => String(Number(Number(v).toPrecision(3)));
const NONE = [];

function compileDiagram(diagram, path = 'plant', opts = {}) {
  if (hasFormulas(diagram)) diagram = normalizeDiagram(diagram, path, { resolve: true });
  const model = opts.mode === 'model';
  const standalone = opts.standalone || model;
  const laws = opts.laws !== false && !model;
  const nodes = [];
  const warnings = [];
  const probeList = [];
  const add = (node) => { nodes.push({ inputs: [], ...node, i: nodes.length }); return nodes.length - 1; };
  const externals = [];
  let extNode = -1, outNode = -1;
  const ctrlNodes = [];  
  const mechList = [];   

  function level(d, prefix, ids, root) {
    const outs = {}, ins = {};
    for (const b of d.blocks) {
      const name = `${prefix}${b.name ?? b.id}`, idPath = `${ids}${b.id}`;
      if (b.type === 'subsystem') {
        const inner = level(b.diagram, `${name}/`, `${idPath}/`, false);
        const ports = (t) => b.diagram.blocks.filter((x) => x.type === t).sort((a, c) => a.params.port - c.params.port);
        outs[b.id] = ports('outport').map((x) => inner.outs[x.id][0]);
        ins[b.id] = ports('inport').map((x) => inner.ins[x.id][0]);
        continue;
      }
      if (b.type === 'source') {
        const fn = opts.sources?.[b.params.signal];
        if (!fn && !model) warnings.push(`${path}: no signal "${b.params.signal}" for ${name}`);
        const k = add({ kind: 'src', name, signal: b.params.signal, at: 0, ft: false, fn: fn ?? (() => 0) });
        probeList.push([b.params.signal, k]);
        outs[b.id] = [k]; ins[b.id] = [];
        continue;
      }
      if (b.type === 'sink') {
        if (probeList.some(([n2]) => n2 === b.params.name)) throw new Error(`${path}: two signals named "${b.params.name}"`);
        const k = add({ kind: 'pass', name, ft: true, inputs: [-1] });
        probeList.push([b.params.name, k]);
        outs[b.id] = []; ins[b.id] = [[k, 0]];
        continue;
      }
      if (b.type === 'terminator') {
        const k = add({ kind: 'pass', name, ft: true, inputs: [-1] });
        outs[b.id] = []; ins[b.id] = [[k, 0]];
        continue;
      }
      if (b.type === 'inport') {
        if (root && standalone) {
          const k = add({ kind: 'src', name, signal: null, at: 0, ft: false, fn: () => 0 });
          if (!model) warnings.push(`${path}: ${name} reads 0 until a controller drives the plant`);
          outs[b.id] = [k]; ins[b.id] = [];
        } else if (root) {
          if (extNode >= 0) throw new Error(`${path}: one input (In) only, for now`);
          extNode = add({ kind: 'ext', name, ft: false });
          outs[b.id] = [extNode]; ins[b.id] = [];
        } else {
          const k = add({ kind: 'pass', name, ft: true, inputs: [-1] });
          outs[b.id] = [k]; ins[b.id] = [[k, 0]];
        }
        continue;
      }
      if (b.type === 'outport') {
        const k = add({ kind: 'pass', name, ft: true, inputs: [-1] });
        if (root && !standalone) { if (outNode >= 0) throw new Error(`${path}: one output (Out) only, for now`); outNode = k; }
        outs[b.id] = [k]; ins[b.id] = [[k, 0]];
        continue;
      }
      const def = diagramBlockDef(b.type);
      const [nIn, nOut] = blockPorts(b);
      if (def.part) { outs[b.id] = []; ins[b.id] = []; continue; }
      if (b.type === 'controller' || b.type === 'observer') {
        const lib = VARIANT_LIBS[b.type];
        const v = b.variants?.[b.variant ?? 0] ?? normalizeVariant({ type: b.type === 'observer' ? 'difference' : 'pid' }, b.id, lib);
        const k = add({ kind: 'ctrl', name, idPath, ft: false, observer: b.type === 'observer', variant: v, lib, inputs: new Array(nIn).fill(-1), Ts: b.params.Ts, law: null, next: 0, k: 0, u: 0, outv: new Float64Array(nOut), x: new Float64Array(nIn) });
        nodes[k].taps = b.type === 'observer' ? Array.from({ length: nOut }, (_, j) => add({ kind: 'tap', name: `${name}.x̂${j + 1}`, ft: false, parent: k, j, see: -1 })) : [];
        outs[b.id] = b.type === 'observer' ? nodes[k].taps : [k];
        ins[b.id] = nodes[k].inputs.map((_, s) => [k, s]);
        if (b.type === 'controller') ctrlNodes.push([`${ids}${b.id}`, k]); 
        continue;
      }
      if (b.type === 'external') {
        const k = add({ kind: 'xplant', name, ft: false, p: b.params, inputs: new Array(nIn).fill(-1), outv: new Float64Array(nOut) });
        externals.push(k);
        outs[b.id] = outputNames(def, b.params).map((o, j) => add({ kind: 'tap', name: `${name}.${o}`, ft: false, parent: k, j }));
        ins[b.id] = nodes[k].inputs.map((_, s) => [k, s]);
        continue;
      }
      if (def.ode) {
        const k = add({ kind: 'ode', name, short: b.name ?? b.id, ft: false, ode: def.ode, rates: def.ode.make(b.params), p: b.params, inputs: new Array(nIn).fill(-1), uv: nIn > 1 ? new Float64Array(nIn) : null, outv: new Float64Array(nOut), bound: def.ode.bound(b.params) });
        outs[b.id] = outputNames(def, b.params).map((o, j) => add({ kind: 'tap', name: `${name}.${o}`, ft: false, parent: k, j, see: -1 }));
        ins[b.id] = nodes[k].inputs.map((_, s) => [k, s]);
        continue;
      }
      const node = { name, short: b.name ?? b.id, inputs: new Array(nIn).fill(-1) };
      if (b.type === 'integrator') Object.assign(node, { unit: b.params.unit, angle: !!b.params.angle });
      const lo = b.params.min ?? -Infinity, hi = b.params.max ?? Infinity, x0 = b.params.x0 ?? 0;
      if (b.type === 'integrator' && (x0 !== 0 || lo > -Infinity || hi < Infinity)) {
        Object.assign(node, { kind: 'int', K: b.params.K, lo, hi, x0: Math.min(hi, Math.max(lo, x0)), ft: false, bound: 0 });
      } else if (def.tf) {
        const tf = def.tf(b.params);
        const ss = tf2ss(tf.num, tf.den);
        if (ss.n === 1) { ss.B[0] *= ss.C[0]; ss.C[0] = 1; }
        const delay = Number(tf.delay) || 0;
        Object.assign(node, { kind: 'ss', ss, ft: ss.D !== 0 && (model || !(delay > 0)), bound: rootBound(tf.den), delay });
      } else if (b.type === 'gain') Object.assign(node, { kind: 'gain', K: b.params.K, ft: true });
      else if (b.type === 'sum') Object.assign(node, { kind: 'sum', signs: [...b.params.signs].map((c) => (c === '-' ? -1 : 1)), ft: true });
      else if (b.type === 'saturation') Object.assign(node, { kind: 'sat', lo: Math.min(b.params.min, b.params.max), hi: Math.max(b.params.min, b.params.max), ft: true });
      else if (b.type === 'delay') Object.assign(node, { kind: 'delay', L: b.params.L, y0: b.params.y0, ft: model || b.params.L <= 0 });
      else if (b.type === 'switch') Object.assign(node, { kind: 'switch', pick: b.params.position - 1, ft: true });
      else if (b.type === 'fcn') {
        const eq = compileEquations(b.params, b.consts);
        Object.assign(node, { kind: 'fcn', eq, v: new Float64Array(eq.n), outv: new Float64Array(eq.out.length), ft: true });
      }
      else if (b.type === 'quantizer') Object.assign(node, { kind: 'quant', q: b.params.q, ft: true });
      else if (b.type === 'noise') Object.assign(node, { kind: 'noise', std: b.params.std, seed: b.params.seed, ft: true });
      const k = add(node);
      outs[b.id] = [k, ...Array.from({ length: nOut - 1 }, (_, j) => add({ kind: 'pick', name: `${name}.${outputNames(def, b.params)[j + 1]}`, ft: true, inputs: [k], parent: k, j: j + 1 }))];
      ins[b.id] = node.inputs.map((_, s) => [k, s]);
    }
    let mechs;
    try { mechs = mechanisms(d.blocks, d.joins); } catch (e) { throw Object.assign(new Error(`${path}${prefix ? ` (${prefix.slice(0, -1)})` : ''}: ${e.message}`), { code: e.code, blocks: (e.blocks ?? []).map((id) => `${ids}${id}`) }); }
    for (const mech of mechs) {
      let ode;
      try { ode = mechanismOde(mech); } catch (e) { throw Object.assign(new Error(`${path}${prefix ? ` (${prefix.slice(0, -1)})` : ''}: ${e.message}`), { code: e.code, blocks: (e.blocks ?? []).map((id) => `${ids}${id}`) }); }
      const name = prefix ? prefix.slice(0, -1) : (mech.world.name ?? mech.world.id);
      const k = add({ kind: 'ode', name, prefix, short: name, mech, ft: false, ode, rates: ode.make(), p: null, inputs: new Array(ode.nIn).fill(-1), uv: ode.nIn > 1 ? new Float64Array(ode.nIn) : null, outv: new Float64Array(2 * mech.joints.length), bound: ode.bound() });
      mechList.push({ name, idPath: ids.slice(0, -1), node: k, mechanism: mech, ode });
      mech.joints.forEach((jn, j) => {
        outs[jn.id] = [0, 1].map((r) => add({ kind: 'tap', name: `${prefix}${jn.params[r ? 'rate' : 'name']}`, ft: false, parent: k, j: 2 * j + r, see: -1 }));
        const slot = ode.inputs.indexOf(jn);
        ins[jn.id] = slot >= 0 ? [[k, slot]] : [];
      });
    }
    for (const w of d.wires) {
      const f = parseEnd(w.from), t = parseEnd(w.to);
      const src = outs[f.id][f.port], [dst, slot] = ins[t.id][t.port];
      nodes[dst].inputs[slot] = src;
    }
    return { outs, ins };
  }
  level(diagram, '', '', true);
  for (const [key, k] of ctrlNodes) {
    const [r = -1, y = -1] = nodes[k].inputs;
    if (r >= 0) probeList.push([`${key}.r`, r]);
    if (y >= 0) probeList.push([`${key}.y`, y]);
    probeList.push([`${key}.u`, k]);
  }
  if (!standalone) {
    if (outNode < 0) throw new Error(`${path}: add an Out block for the plant output y`);
    if (extNode < 0) warnings.push(`${path}: no In block, so the plant ignores u`);
  }
  for (const nd of nodes) nd.inputs.forEach((s, i) => { if (s < 0) warnings.push(`${path}: ${nd.name} input ${i + 1} is not connected (reads 0)`); });

  const order = nodes.map((nd, i) => i).filter((i) => !nodes[i].ft);
  const pending = new Set(nodes.map((nd, i) => i).filter((i) => nodes[i].ft));
  let progress = true;
  while (pending.size && progress) {
    progress = false;
    for (const i of pending) {
      if (nodes[i].inputs.every((s) => s < 0 || !pending.has(s))) { order.push(i); pending.delete(i); progress = true; }
    }
  }
  if (pending.size) throw new Error(`${path}: algebraic loop through ${[...pending].map((i) => nodes[i].name).join(', ')}; put a block with state (integrator, lag) in the loop${model ? ' (in a model, dead times pass straight through)' : ''}`);
  const origin = (i) => { while (i >= 0 && nodes[i].kind === 'pass') i = nodes[i].inputs[0]; return i; };
  const through = nodes.map((nd, i) => origin(i));
  for (const nd of nodes) for (let s = 0; s < nd.inputs.length; s++) if (nd.inputs[s] >= 0) nd.inputs[s] = through[nd.inputs[s]];
  for (let q = order.length - 1; q >= 0; q--) if (nodes[order[q]].kind === 'pass') order.splice(q, 1);

  let n = 0, bound = 0;
  const stateNodes = [];
  for (const nd of nodes) {
    if (nd.kind !== 'ss' && nd.kind !== 'ode' && nd.kind !== 'int') continue;
    nd.nx = nd.kind === 'int' ? 1 : nd.kind === 'ss' ? nd.ss.n : typeof nd.ode.n === 'function' ? nd.ode.n(nd.p) : nd.ode.n;
    nd.off = n; n += nd.nx; bound = Math.max(bound, nd.bound);
    if (nd.nx > 0) stateNodes.push(nd);
  }
  const states = [];
  for (const nd of stateNodes) {
    if (nd.kind === 'ode') nd.ode.states(nd.p).forEach((s, j) => states.push({ label: nd.mech ? `${nd.prefix}${s.name}` : `${nd.name}.${s.name}`, name: s.name, unit: s.unit, angle: s.angle, index: nd.off + j }));
    else for (let j = 0; j < nd.nx; j++) states.push(nd.nx === 1 ? { label: nd.name, name: nd.short, unit: nd.unit && nd.unit !== '1' ? nd.unit : '', angle: !!nd.angle, index: nd.off } : { label: `${nd.name}.x${j + 1}`, name: `${nd.short}.x${j + 1}`, unit: '', angle: false, index: nd.off + j });
  }

  const vals = new Float64Array(nodes.length);
  const ctrls = nodes.filter((nd) => nd.kind === 'ctrl').sort((a, b) => b.observer - a.observer);
  const minTs = Math.min(Infinity, ...ctrls.map((nd) => nd.Ts));
  const sampleTimes = [...new Set(ctrls.map((nd) => nd.Ts))];

  const designs = [];
  if (laws) {
    const job = (opts.designs ?? defaultDesigns()).begin(diagram, () => compileDiagram(structuredClone(diagram), path, { mode: 'model' }), { guest: !opts.designs && defaultDesigns() !== SYNC_DESIGNS });
    for (const nd of ctrls) {
      if (!nd.lib[nd.variant.type].designed) { nd.law = makeLaw(nd.variant, nd.Ts, nd.lib); continue; }
      const inputs = blockInputNames(diagram, nd.idPath);
      const fed = nd.observer ? nd.inputs[0] : nd.i;
      const sink = fed >= 0 ? probeList.find(([nm, k]) => !nm.includes('.') && nodes[k].kind === 'pass' && nodes[k].inputs[0] === fed) : null;
      const block = { idPath: nd.idPath, name: nd.name, kind: nd.observer ? 'observer' : 'controller', Ts: nd.Ts, inputs, input: sink?.[0] ?? (nd.observer ? inputs[0] : 'u'), outputs: nd.outv.length };
      const status = job.resolve(block, nd.variant, nd.lib);
      nd.law = makeLaw(nd.variant, nd.Ts, nd.lib, status.values);
      designs.push(status);
    }
    job.end();
  }
  const delays = nodes.filter((nd) => nd.kind === 'delay' || (nd.kind === 'ss' && nd.delay > 0)).map((nd) => { nd.hist = []; nd.histL = []; return nd; });
  let h = 0;
  let left = false;
  let ideal = false;
  const histAt = (nd, tau, y0 = 0) => {
    const hist = nd.hist;
    if (tau < 0 || !hist.length) return y0;
    const f = tau / h, i = left ? Math.max(0, Math.ceil(f - 1e-9) - 1) : Math.floor(f + 1e-9);
    if (i >= hist.length - 1) return hist[hist.length - 1];
    return hist[i] + ((nd.histL[i + 1] ?? hist[i + 1]) - hist[i]) * (f - i);
  };
  const inOf = (nd, s = 0) => (nd.inputs[s] < 0 ? 0 : vals[nd.inputs[s]]);

  function outputs(list, t, X, o, u) {
    for (let q = 0; q < list.length; q++) {
      const i = list[q], nd = nodes[i];
      let y;
      switch (nd.kind) {
        case 'ext': y = u; break;
        case 'src': y = model ? nd.at : nd.fn(t); break;
        case 'pass': y = inOf(nd); break;
        case 'gain': y = nd.K * inOf(nd); break;
        case 'sum': y = 0; for (let s = 0; s < nd.signs.length; s++) y += nd.signs[s] * inOf(nd, s); break;
        case 'sat': y = Math.min(nd.hi, Math.max(nd.lo, inOf(nd))); break;
        case 'delay': y = model || nd.L <= 0 ? inOf(nd) : histAt(nd, t - nd.L, nd.y0 ?? (nd.hist.length ? nd.hist[0] : inOf(nd))); break;
        case 'switch': y = inOf(nd, nd.pick); break;
        case 'fcn': {
          const { eq, v } = nd;
          for (let s = 0; s < eq.nIn; s++) v[s] = inOf(nd, s);
          v[eq.nIn] = t;
          for (let k = 0; k < eq.fs.length; k++) v[eq.first + k] = eq.fs[k](v);
          for (let j = 0; j < eq.out.length; j++) nd.outv[j] = v[eq.out[j]];
          y = nd.outv[0];
          break;
        }
        case 'pick': y = nodes[nd.parent].outv[nd.j]; break;
        case 'int': y = Math.min(nd.hi, Math.max(nd.lo, X[o + nd.off])); break;
        case 'quant': y = model || ideal ? inOf(nd) : nd.q * Math.round(inOf(nd) / nd.q); break;
        case 'noise': y = model || ideal ? inOf(nd) : inOf(nd) + nd.std * gaussAt(nd.seed, Math.floor(t / (h || 1) + 1e-9)); break;
        case 'ode': nd.ode.out(X, o + nd.off, nd.p, nd.outv); y = nd.outv[0]; break;
        case 'tap': y = nd.see >= 0 ? X[o + nd.see] : nodes[nd.parent].outv[nd.j]; break;
        case 'ctrl': y = nd.u; break;
        case 'xplant': y = nd.outv[0]; break;
        default: {
          const { ss } = nd;
          const inp = nd.delay > 0 && !model ? histAt(nd, t - nd.delay) : inOf(nd);
          y = ss.D * inp;
          for (let j = 0; j < ss.n; j++) y += ss.C[j] * X[o + nd.off + j];
        }
      }
      vals[i] = y;
    }
  }
  function rates(list, t, X, o, dX) {
    for (let q = 0; q < list.length; q++) {
      const nd = list[q];
      if (nd.kind === 'int') {
        const r = nd.K * inOf(nd), x = X[o + nd.off];
        dX[o + nd.off] = (x <= nd.lo && r < 0) || (x >= nd.hi && r > 0) ? 0 : r;
        continue;
      }
      if (nd.kind === 'ode') {
        if (nd.uv) for (let s = 0; s < nd.uv.length; s++) nd.uv[s] = inOf(nd, s);
        nd.rates(X, o + nd.off, inOf(nd), dX, nd.uv);
        continue;
      }
      const { ss } = nd, base = o + nd.off;
      const inp = nd.delay > 0 && !model ? histAt(nd, t - nd.delay) : inOf(nd);
      for (let r = 0; r < ss.n; r++) {
        let s = ss.B[r] * inp;
        for (let c = 0; c < ss.n; c++) s += ss.A[r * ss.n + c] * X[base + c];
        dX[base + r] = s;
      }
    }
  }

  const probeSrc = probeList.map(([, k]) => origin(k)), outSrc = outNode >= 0 ? origin(outNode) : -1;
  const self = {
    n, bound, warnings, minTs, sampleTimes, states, designs,
    mechanisms: mechList.map(({ node, ...m }) => ({ ...m, offset: nodes[node].off })),
    setStep(step) { h = step; },
    sample(t, X, o, u) {
      for (const nd of ctrls) {
        if (!nd.law || t < nd.next - 1e-9) continue;
        for (let s = 0; s < nd.x.length; s++) nd.x[s] = inOf(nd, s);
        const y = nd.law.step(nd.x);
        if (nd.observer) nd.outv.set(y.subarray ? y.subarray(0, nd.outv.length) : y.slice(0, nd.outv.length)); else nd.u = y;
        while (nd.next <= t + 1e-9) nd.next = ++nd.k * nd.Ts;
        self.eval(t, X, o, u, null);
      }
    },
    nextSample() { let t = Infinity; for (const nd of ctrls) if (nd.next < t) t = nd.next; return t; },
    init(X, o) {
      for (const nd of stateNodes) {
        if (nd.kind === 'ode') nd.ode.init(nd.p).forEach((v, i) => { X[o + nd.off + i] = v; });
        if (nd.kind === 'int') X[o + nd.off] = nd.x0;
      }
    },
    eval(t, X, o, u, dX, end = false) {
      left = end;
      outputs(order, t, X, o, u);
      if (dX) rates(stateNodes, t, X, o, dX);
      return outSrc >= 0 ? vals[outSrc] : 0;
    },
    probes: () => probeList.map(([name, k], j) => [name, probeSrc[j] >= 0 ? vals[probeSrc[j]] : 0]),
    record() { for (const nd of delays) { nd.hist.push(inOf(nd)); if (nd.histL.length < nd.hist.length) nd.histL.push(inOf(nd)); } },
    recordLeft() { for (const nd of delays) nd.histL.push(inOf(nd)); },
    snapshot(t, X, o = 0) {
      const held = {}, inputs = {}, sources = {};
      for (const nd of ctrls) { held[nd.idPath] = nd.observer ? Float64Array.from(nd.outv) : nd.u; inputs[nd.idPath] = Float64Array.from(nd.x); }
      for (const nd of nodes) if (nd.kind === 'src' && nd.signal !== null) sources[nd.signal] = nd.fn(t);
      return { t, X: Float64Array.from(X.subarray(o, o + n)), held, inputs, sources };
    },
    externals: externals.map((k) => ({ name: nodes[k].name, params: nodes[k].p, y: nodes[k].outv, u: () => nodes[k].inputs.map((s) => (s < 0 ? 0 : vals[s])) })),
    links() {
      const ext = externals[0] ?? -1;
      const outOf = (i) => { const o = origin(i); return o >= 0 && nodes[o].kind === 'tap' && nodes[o].parent === ext ? nodes[o].j : undefined; };
      const inputsFrom = (i) => (ext < 0 || i < 0 ? [] : nodes[ext].inputs.flatMap((s, slot) => (s >= 0 && origin(s) === origin(i) ? [slot] : [])));
      const sinks = {}, sources = {}, ctrls = [];
      for (const [name, pk] of probeList) {
        if (name.includes('.')) continue;
        const nd = nodes[pk];
        if (nd.kind === 'pass') {
          const j = outOf(pk), into = inputsFrom(pk);
          if (j !== undefined) sinks[name] = { output: j }; else if (into.length) sinks[name] = { input: into[0] };
        } else if (nd.kind === 'src') {
          const into = inputsFrom(pk);
          if (into.length) sources[name] = { input: into[0] };
        }
      }
      for (const [key, k] of ctrlNodes) {
        const [r = -1, y = -1] = nodes[k].inputs;
        const ro = origin(r), measured = y >= 0 ? outOf(y) : undefined;
        const source = ro >= 0 && nodes[ro].kind === 'src' ? nodes[ro].signal : undefined;
        ctrls.push({ key, source, measured, drives: inputsFrom(k) });
        if (source !== undefined && !sources[source]) sources[source] = { ctrl: key, ...(measured !== undefined ? { measured } : {}) };
      }
      return { sinks, sources, ctrls };
    },
  };

  const jacobian = (X0, t) => {
    const X = Float64Array.from(X0), f0 = new Float64Array(n), f1 = new Float64Array(n);
    const J = Array.from({ length: n }, () => new Array(n).fill(0));
    ideal = true;
    try {
      self.eval(t, X, 0, 0, f0);
      for (let j = 0; j < n; j++) {
        const x = X[j], dx = (x + 1e-6 * Math.max(1, Math.abs(x))) - x;
        X[j] = x + dx;
        self.eval(t, X, 0, 0, f1);
        X[j] = x;
        for (let i = 0; i < n; i++) J[i][j] = (f1[i] - f0[i]) / dx;
      }
    } finally { ideal = false; }
    self.eval(t, X, 0, 0, null);
    return J;
  };
  self.stiffness = (X0, t = 0) => {
    if (!n) return { bound: 0, state: null };
    const J = jacobian(X0, t);
    if (!J.every((row) => row.every(Number.isFinite))) return { bound: 0, state: null, note: 'the rates are not finite at this state' };
    let top = { re: 0, im: 0 }, mag = 0;
    for (const z of eig(J)) { const a = Math.hypot(z.re, z.im); if (a > mag) { mag = a; top = z; } }
    let state = null;
    if (mag > 0) {
      const s = 1 + 1e-7;
      const v = csolve(J.map((row, i) => row.map((a, j) => a - (i === j ? top.re * s : 0))), J.map((row, i) => row.map((a, j) => (i === j ? -top.im * s : 0))), new Array(n).fill(1), new Array(n).fill(0));
      if (v) { let k = 0; for (let i = 1; i < n; i++) if (Math.hypot(v.xr[i], v.xi[i]) > Math.hypot(v.xr[k], v.xi[k])) k = i; state = states[k]?.label ?? null; }
    }
    return { bound: mag, state };
  };
  {
    const X0 = new Float64Array(n);
    self.init(X0, 0);
    const s = self.stiffness(X0, 0);
    self.blockBound = bound;
    self.stiff = s;
    self.bound = s.bound > bound * (1 + 1e-6) ? s.bound : bound;
  }
  self.stiffWarning = (hmax, need, ran, T) => `${self.stiff.state ? `'${self.stiff.state}' needs` : 'this plant needs'} steps of ${siUnit(hmax, 's')}; this ${siUnit(T, 's')} screen would take ${siUnit(need, '', 3)} steps; it ran ${siUnit(ran, '', 3)}: inaccurate. Shorten the screen`;

  if (!model) return self;

  const owner = new Int32Array(n);   
  for (const nd of stateNodes) owner.fill(nd.i, nd.off, nd.off + nd.nx);
  const blockNode = (idPath) => nodes.find((nd) => nd.kind === 'ctrl' && nd.idPath === idPath);
  let active = null;   
  const memo = new Map();
  const sorted = (o) => Object.entries(o ?? {}).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const plain = (v) => (typeof v === 'number' ? v : Array.from(v ?? []));

  function buildModel(idPath, at) {
    const blk = blockNode(idPath);
    if (!blk) throw modelError('no-block', `no Controller or Observer "${idPath}" in the plant`);
    const cut = blk.observer ? blk.inputs[0] : blk.i;
    if (cut < 0) throw modelError('no-cut', `nothing is wired to input 1 (u) of the observer '${blk.name}', so it cannot know what drives the plant`, 'wire the plant input u to it');
    const meas = blk.inputs.slice(1), m = meas.length;
    const see = new Map();
    for (const [obs, idx] of at.seeThrough ?? []) {
      const o = blockNode(obs);
      if (!o?.observer) throw modelError('no-block', `no Observer "${obs}" to look through`);
      o.taps.forEach((tp, j) => { if (Number.isInteger(idx[j]) && idx[j] >= 0 && idx[j] < n) see.set(tp, idx[j]); });
    }
    const deps = (i) => {
      if (i === cut) return NONE;
      const nd = nodes[i];
      if (nd.kind === 'src' || nd.kind === 'ext' || nd.kind === 'ctrl') return NONE;
      if (nd.kind === 'tap') return nodes[nd.parent].kind === 'ode' ? [nd.parent] : see.has(i) ? [owner[see.get(i)]] : NONE;
      if (nd.kind === 'switch') return [nd.inputs[nd.pick]];
      return nd.inputs;
    };
    const reads = (i) => (nodes[i].kind === 'ode' || nodes[i].kind === 'int' || (nodes[i].kind === 'ss' && nodes[i].ss.D === 0) ? NONE : deps(i));
    const users = nodes.map(() => []);
    nodes.forEach((nd, i) => { for (const s of deps(i)) if (s >= 0) users[s].push(i); });
    const walk = (starts, next) => {
      const mark = new Uint8Array(nodes.length), stack = [];
      for (const s of starts) if (s >= 0 && !mark[s]) { mark[s] = 1; stack.push(s); }
      while (stack.length) for (const j of next(stack.pop())) if (j >= 0 && !mark[j]) { mark[j] = 1; stack.push(j); }
      return mark;
    };
    const fromCut = walk([cut], (i) => users[i]);
    const toMeas = walk(meas, deps);
    const kept = stateNodes.filter((nd) => nd.i !== cut && fromCut[nd.i] && toMeas[nd.i]);
    const outside = nodes.find((nd, i) => nd.kind === 'xplant' && (fromCut[i] || nd.i === cut || nodes.some((tp, j) => tp.kind === 'tap' && tp.parent === i && toMeas[j])));
    if (outside) throw modelError('external-plant', `the plant runs outside the page (External plant '${outside.name}'): the page has no model of it to design with or analyse`, 'identify it first (the Identify tab is designed, not built yet), or set the gains by hand and tune it live');
    const sliceOf = (starts) => { const used = walk(starts, reads); return Int32Array.from(order.filter((i) => used[i] && i !== cut)); };
    const sliceF = sliceOf(kept.flatMap((nd) => nd.inputs));
    const slice = sliceOf([...meas, ...kept.flatMap((nd) => nd.inputs)]);
    const keep = Int32Array.from(kept.flatMap((nd) => Array.from({ length: nd.nx }, (_, j) => nd.off + j)));
    const nk = keep.length;

    const X0 = new Float64Array(n);
    if (at.X) {
      if (at.X.length !== n) throw modelError('bad-state', `the state has ${at.X.length} values; this plant has ${n}`);
      X0.set(at.X);
    } else self.init(X0, 0);
    const t0 = Number(at.t) || 0;
    const labels = blockInputNames(diagram, blk.idPath).slice(1);
    const notes = [];

    const held = at.held ?? {}, setU = [], setO = [], setSrc = [], setSee = [], through = new Set();
    for (const i of slice) {
      const nd = nodes[i];
      if (nd.kind === 'tap' && see.has(i)) through.add(nodes[nd.parent].name);
      if (nd.kind === 'ctrl' && !nd.observer) {
        const v = Number(held[nd.idPath] ?? 0);
        setU.push([i, v]);
        notes.push(`controller '${nd.name}' holds its output at ${fmt(v)}: the design sees its loop open`);
      }
      if (nd.kind === 'src') setSrc.push([i, nd.signal === null ? 0 : Number(at.sources?.[nd.signal] ?? 0)]);
      if (nd.kind === 'tap' && nodes[nd.parent].kind === 'ctrl') {
        setSee.push([i, see.has(i) ? see.get(i) : -1]);
        const o = nodes[nd.parent];
        if (!see.has(i) && !setO.some(([k]) => k === o.i)) {
          const v = new Float64Array(o.outv.length), hv = held[o.idPath];
          if (typeof hv === 'number') v.fill(hv); else if (hv) v.set(Array.from(hv).slice(0, v.length));
          setO.push([o.i, v]);
          const extra = o.taps.filter((tp) => !see.has(tp)).map((tp) => nodes[tp].name.slice(o.name.length + 1));
          notes.push(o.taps.some((tp) => see.has(tp)) ? `${extra.join(', ')} of '${o.name}' ${extra.length === 1 ? 'stands' : 'stand'} for no state of this plant and ${extra.length === 1 ? 'is' : 'are'} held` : `estimates of '${o.name}' are held; the design does not look through a hand observer`);
        }
      }
    }

    const sensorPath = meas.map((mk) => walk([mk], reads));
    const sensors = meas.map(() => ({ std: 0, q: 0, parts: [] }));
    for (const i of slice) {
      const nd = nodes[i];
      if ((nd.kind !== 'quant' && nd.kind !== 'noise') || sensorPath.some((on) => on[i])) continue;
      notes.push(nd.kind === 'quant' ? `quantizer '${nd.name}' is the identity in the model (step ${fmt(nd.q)})` : `noise '${nd.name}' adds 0 in the model (σ ${fmt(nd.std)}): it is on no measurement's way`);
    }

    const delayOf = (i) => (nodes[i].kind === 'delay' ? nodes[i].L : nodes[i].kind === 'ss' ? nodes[i].delay : 0);
    const delay = meas.map((mk, k) => {
      if (mk < 0 || !fromCut[mk]) return 0;
      const back = walk([mk], deps), list = [];
      for (let i = 0; i < nodes.length; i++) if (back[i] && fromCut[i] && i !== cut) list.push(i);
      const lo = new Float64Array(nodes.length).fill(Infinity), hi = new Float64Array(nodes.length).fill(-Infinity);
      lo[cut] = hi[cut] = 0;
      let settled = false;
      for (let it = 0; it <= list.length + 1 && !settled; it++) {
        settled = true;
        for (const j of list) {
          const w = delayOf(j);
          for (const s of deps(j)) {
            if (s < 0 || !(s === cut || (back[s] && fromCut[s]))) continue;
            if (lo[s] + w < lo[j]) { lo[j] = lo[s] + w; settled = false; }
            if (hi[s] + w > hi[j] + 1e-12) { hi[j] = hi[s] + w; settled = false; }
          }
        }
      }
      const longest = settled ? hi[mk] : Infinity;
      if (longest - lo[mk] > 1e-12) notes.push(`dead time on the way to ${labels[k]} differs between paths (${fmt(lo[mk])} to ${longest === Infinity ? '∞' : fmt(longest)} s): it sits in a loop or a parallel branch and is left out${lo[mk] > 0 ? `, but for the ${fmt(lo[mk])} s every path has` : ''}`);
      return lo[mk] === Infinity ? 0 : lo[mk];
    });

    const sink = probeList.find(([nm, k]) => !nm.includes('.') && nodes[k].kind === 'pass' && nodes[k].inputs[0] === cut);
    const inputLabel = sink?.[0] ?? (blk.observer ? nodes[cut].name : 'u');
    if (!meas.some((mk) => mk >= 0 && fromCut[mk])) {
      const between = nodes.filter((nd) => nd.kind === 'ctrl' && !nd.observer && nd.i !== cut && nd.inputs.some((s) => s >= 0 && fromCut[s])).map((nd) => `'${nd.name}'`);
      notes.push(`${inputLabel} reaches none of the measurements${between.length ? `: controller ${between.join(', ')} holds its output in between` : ''}`);
    }

    const Xf = Float64Array.from(X0), dXf = new Float64Array(n), yScratch = new Float64Array(m);
    const bind = () => {
      for (const [i, v] of setU) nodes[i].u = v;
      for (const [i, v] of setO) nodes[i].outv.set(v);
      for (const [i, v] of setSrc) nodes[i].at = v;
      for (const [i, s] of setSee) nodes[i].see = s;
      active = mdl;
    };
    const evaluate = (x, u, list) => {
      if (active !== mdl) bind();
      for (let i = 0; i < nk; i++) Xf[keep[i]] = x[i];
      vals[cut] = u;
      outputs(list, t0, Xf, 0, 0);
    };
    const mdl = {
      idPath: blk.idPath, name: blk.name, kind: blk.observer ? 'observer' : 'controller',
      n: nk, m, X0, x0: Float64Array.from(keep, (g) => X0[g]),
      input: { label: inputLabel },
      states: Array.from(keep, (g) => ({ ...states[g] })),
      outputs: labels.map((label) => ({ label, angle: false, unit: '' })),
      delay, sensors, through: [...through],
      bound: Math.max(self.bound, ...kept.map((nd) => nd.bound)),
      warnings: notes,
      f(x, u, dx) {
        evaluate(x, u, sliceF);
        rates(kept, t0, Xf, 0, dXf);
        for (let i = 0; i < nk; i++) dx[i] = dXf[keep[i]];
      },
      y(x, u, out) {
        evaluate(x, u, slice);
        for (let k = 0; k < m; k++) out[k] = meas[k] < 0 ? 0 : vals[meas[k]];
      },
      limits(x, u) {
        mdl.y(x, u, yScratch);
        const out = [];
        for (const i of slice) {
          const nd = nodes[i];
          if (nd.kind !== 'sat') continue;
          const v = inOf(nd), near = 1e-6 * Math.max(1, Math.abs(v)), lim = `(input ${fmt(v)}, limits ${fmt(nd.lo)} to ${fmt(nd.hi)})`;
          if (v < nd.lo || v > nd.hi) out.push({ name: nd.name, edge: false, sentence: `'${nd.name}' is saturated at the operating point ${lim}: the model sees no slope through it` });
          else if (v - nd.lo <= near || nd.hi - v <= near) out.push({ name: nd.name, edge: true, sentence: `'${nd.name}' is at its limit at the operating point ${lim}: the slope differs left and right` });
        }
        return out;
      },
      atLimits: (x, u) => mdl.limits(x, u).map((s) => s.sentence),
    };
    const zx = new Float64Array(nk);
    const gainTo = (i, k) => {
      if (meas[k] === i) return 1;
      const p = slice.indexOf(i);
      if (p < 0 || meas[k] < 0) return 0;
      const head = slice.subarray(0, p + 1), tail = slice.subarray(p + 1);
      evaluate(zx, 0, head);
      const d = 1e-6 * Math.max(1, Math.abs(vals[i]));
      const at = (e) => { evaluate(zx, 0, head); vals[i] += e; outputs(tail, t0, Xf, 0, 0); return vals[meas[k]]; };
      return Math.abs((at(d) - at(-d)) / (2 * d));
    };
    sensors.forEach((sn, k) => {
      let std2 = 0, q2 = 0;
      for (const i of slice) {
        const nd = nodes[i];
        if (!sensorPath[k][i] || (nd.kind !== 'quant' && nd.kind !== 'noise')) continue;
        const g = gainTo(i, k), times = Math.abs(g - 1) > 1e-6 ? ` × ${fmt(g)}` : '';
        if (nd.kind === 'quant') { q2 += (g * nd.q) ** 2; sn.parts.push(`quantizer '${nd.name}' step ${fmt(nd.q)}${times}`); }
        else { std2 += (g * nd.std) ** 2; sn.parts.push(`noise '${nd.name}' σ ${fmt(nd.std)}${times}`); }
      }
      sn.std = Math.sqrt(std2);
      sn.q = Math.sqrt(q2);
    });
    const xs = Float64Array.from(mdl.x0), yp = new Float64Array(m), ym = new Float64Array(m);
    const slopes = Array.from({ length: m }, () => []);
    for (let i = 0; i < nk; i++) {
      const x = xs[i], dx = 1e-6 * Math.max(1, Math.abs(x));
      xs[i] = x + dx; mdl.y(xs, 0, yp);
      xs[i] = x - dx; mdl.y(xs, 0, ym);
      xs[i] = x;
      for (let k = 0; k < m; k++) { const d = (yp[k] - ym[k]) / (2 * dx); if (Math.abs(d) > 1e-9) slopes[k].push([i, d]); }
    }
    slopes.forEach((row, k) => {
      const one = row.length === 1 && Math.abs(row[0][1] - 1) < 1e-6;
      mdl.outputs[k].angle = one && mdl.states[row[0][0]].angle;
      mdl.outputs[k].unit = one ? mdl.states[row[0][0]].unit : '';
      if (row.length === 1) Object.assign(mdl.outputs[k], { state: row[0][0], slope: row[0][1] });
    });
    return mdl;
  }

  self.seen = (idPath, at = {}) => {
    const id = Array.isArray(idPath) ? idPath.join('/') : String(idPath);
    const key = JSON.stringify([id, sorted(at.held).map(([k, v]) => [k, plain(v)]), sorted(at.sources), at.X ? Array.from(at.X) : null, Number(at.t) || 0, at.seeThrough ? [...at.seeThrough].map(([k, v]) => [k, Array.from(v)]).sort() : null]);
    let mdl = memo.get(key);
    if (!mdl) {
      mdl = buildModel(id, at);
      if (memo.size >= 16) memo.delete(memo.keys().next().value);
      memo.set(key, mdl);
    }
    return mdl;
  };
  return self;
}

return { ELEMENTS, outputNames, diagramBlockDef, diagramTypes, blockPorts, parseEnd, maskValues, formulaIn, normalizeDiagram, wrapPlant, plantDiagram, diagramNames, blockInputNames, compileDiagram };
})();
// ---- core/sim.js
__mods['core/sim.js'] = (() => {

const { blockDef, SLOTS } = __mods['core/blocks.js'];
const { tf2ss, rootBound } = __mods['core/poly.js'];
const { compileDiagram, plantDiagram, wrapPlant } = __mods['core/diagram.js'];
const { referenceFn } = __mods['core/signals.js'];
const { siUnit } = __mods['core/scale.js'];
const MAX_SAMPLES = 200000;
const MAX_STEPS = 400000;
const BLOWUP = 1e8;

function simulate(loop, sim, opts = {}) {
  const duration = Number(sim.duration);
  const Ts = Number(sim.sampleTime);
  if (!(duration > 0)) throw new Error('sim.duration must be > 0');
  if (!(Ts > 0)) throw new Error('sim.sampleTime must be > 0');
  for (const s of SLOTS) if (!loop[s.key] && !(opts.openLoop && s.key === 'controller')) throw new Error(`loop is missing slot "${s.key}"`);

  const warnings = [];
  const K = Math.min(Math.round(duration / Ts), MAX_SAMPLES);
  if (K < Math.round(duration / Ts)) warnings.push(`sample count capped at ${MAX_SAMPLES}; increase sampleTime`);

  const refFn = referenceFn(loop.reference ?? { period: 1, components: [] }, { sampleTime: Ts });
  const distFn = blockDef('disturbance', loop.disturbance.type).signal(loop.disturbance.params);
  const actDef = blockDef('actuator', loop.actuator.type);
  const limits = actDef.limits ? actDef.limits(loop.actuator.params) : null;
  const noise = blockDef('noise', loop.noise.type).noise(loop.noise.params);

  const asDiagram = (slot) => {
    const block = loop[slot];
    if (slot === 'plant') return plantDiagram(block);
    const tf = blockDef(slot, block.type).tf(block.params);
    return wrapPlant({ type: 'tf', params: { num: tf.num, den: tf.den, delay: Number(tf.delay) || 0 } });
  };
  const elems = ['actuator', 'plant', 'sensor'].map((slot) => compileDiagram(asDiagram(slot), slot));
  for (const el of elems) warnings.push(...el.warnings);
  let bound = 0;
  for (const el of elems) bound = Math.max(bound, el.bound);
  const hmax = bound > 0 ? 0.5 / bound : Ts;
  let m = Math.max(1, Math.ceil(Ts / hmax - 1e-9));
  if (K * m > MAX_STEPS) {
    m = Math.max(1, Math.floor(MAX_STEPS / K));
    warnings.push('stiff system: integration step limited for speed; results may be inaccurate');
  }
  const h = Ts / m;
  let N = 0;
  for (const el of elems) { el.off = N; N += el.n; el.setStep(h); }
  const sig = new Float64Array(3);

  function chainEval(t, X, u, dX, end = false) {
    sig[0] = elems[0].eval(t, X, elems[0].off, u, dX, end);
    sig[1] = elems[1].eval(t, X, elems[1].off, sig[0] + distFn(t), dX, end);
    sig[2] = elems[2].eval(t, X, elems[2].off, sig[1], dX, end);
  }
  function record() { for (const el of elems) el.record(); }
  function recordLeft() { for (const el of elems) el.recordLeft(); }

  const ctrl = opts.openLoop ? null : makeController(loop.controller, Ts, warnings);
  const rand = gaussian(noise.seed);

  const X = new Float64Array(N);
  for (const el of elems) el.init(X, el.off);
  const Xt = new Float64Array(N);
  const k1 = new Float64Array(N), k2 = new Float64Array(N), k3 = new Float64Array(N), k4 = new Float64Array(N);

  const out = {
    t: new Float64Array(K + 1), r: new Float64Array(K + 1), y: new Float64Array(K + 1), u: new Float64Array(K + 1),
    v: new Float64Array(K + 1), ym: new Float64Array(K + 1), d: new Float64Array(K + 1), e: new Float64Array(K + 1),
  };

  let unstable = false;
  let blowup = 1;
  chainEval(0, X, 0, null);

  for (let k = 0; k <= K; k++) {
    const t = k * Ts;
    const y = sig[1];
    const ym = sig[2] + (noise.std > 0 ? noise.std * rand() : 0);
    const r = refFn(t);
    const v = opts.openLoop ? r : ctrl.step(r, ym);
    let u = v;
    if (limits) u = Math.min(limits.max, Math.max(limits.min, v));
    ctrl?.track(u, v);

    out.t[k] = t; out.r[k] = r; out.y[k] = y; out.u[k] = u; out.v[k] = v; out.ym[k] = ym; out.d[k] = distFn(t); out.e[k] = r - y;
    if (!Number.isFinite(y) || Math.abs(y) > BLOWUP || !Number.isFinite(u)) {
      unstable = true;
      blowup = k / K;
      for (const key in out) if (key !== 't') out[key].fill(NaN, k);
      for (let j = k; j <= K; j++) out.t[j] = j * Ts;
      break;
    }
    if (k === K) break;
    chainEval(t, X, u, null);
    record();

    for (let s = 0; s < m; s++) {
      const ts = t + s * h;
      chainEval(ts, X, u, k1);
      for (let i = 0; i < N; i++) Xt[i] = X[i] + 0.5 * h * k1[i];
      chainEval(ts + 0.5 * h, Xt, u, k2);
      for (let i = 0; i < N; i++) Xt[i] = X[i] + 0.5 * h * k2[i];
      chainEval(ts + 0.5 * h, Xt, u, k3);
      for (let i = 0; i < N; i++) Xt[i] = X[i] + h * k3[i];
      chainEval(ts + h, Xt, u, k4, true);
      for (let i = 0; i < N; i++) X[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
      chainEval(ts + h, X, u, null);
      if (s < m - 1) record(); else recordLeft();
    }
  }

  return { ...out, info: { h, substeps: m, samples: K + 1, unstable, blowup, limits, warnings } };
}

function makeController(block, Ts, warnings) {
  const def = blockDef('controller', block.type);
  return def.pid ? makePid(block.params, Ts) : makeTfController(def.tf(block.params), Ts, warnings);
}

function makePid(p, Ts) {
  const Kp = p.Kp ?? 0, Ki = p.Ki ?? 0, Kd = p.Kd ?? 0;
  const Tf = Math.max(p.Tf ?? 0, 0);
  const b = p.b ?? 1, c = p.c ?? 0;
  const Ti = Ki > 0 ? (Kp > 0 ? Kp / Ki : 1 / Ki) : Infinity;
  const Td = Kp > 0 ? Kd / Kp : 0;
  const Tt = Math.max(Ts, Td > 0 ? Math.sqrt(Ti * Td) : 0.5 * Ti);
  let I = 0, D = 0, prevDin = null, lastE = 0;
  return {
    step(r, y) {
      const din = c * r - y;
      if (prevDin === null) prevDin = din;
      D = (Tf * D + Kd * (din - prevDin)) / (Tf + Ts);
      prevDin = din;
      lastE = r - y;
      return Kp * (b * r - y) + I + D;
    },
    track(u, v) {
      if (Ki > 0) I += Ki * Ts * lastE + (Number.isFinite(Tt) ? (Ts / Tt) * (u - v) : 0);
    },
  };
}

function makeTfController(tf, Ts, warnings) {
  const ss = tf2ss(tf.num, tf.den);
  const bound = rootBound(tf.den);
  const m = Math.max(1, Math.ceil(Ts * bound / 0.5));
  const h = Ts / m;
  const n = ss.n;
  const x = new Float64Array(n), xt = new Float64Array(n);
  const k1 = new Float64Array(n), k2 = new Float64Array(n), k3 = new Float64Array(n), k4 = new Float64Array(n);
  const lag = Math.round((Number(tf.delay) || 0) / Ts);
  if (tf.delay > 0 && lag === 0) warnings.push('controller delay is below one sample and was ignored');
  const queue = new Array(lag).fill(0);
  let e = 0;
  const deriv = (xs, dx) => {
    for (let i = 0; i < n; i++) {
      let s = ss.B[i] * e;
      for (let j = 0; j < n; j++) s += ss.A[i * n + j] * xs[j];
      dx[i] = s;
    }
  };
  return {
    step(r, y) {
      e = r - y;
      let v = ss.D * e;
      for (let i = 0; i < n; i++) v += ss.C[i] * x[i];
      for (let s = 0; s < m; s++) {
        deriv(x, k1);
        for (let i = 0; i < n; i++) xt[i] = x[i] + 0.5 * h * k1[i];
        deriv(xt, k2);
        for (let i = 0; i < n; i++) xt[i] = x[i] + 0.5 * h * k2[i];
        deriv(xt, k3);
        for (let i = 0; i < n; i++) xt[i] = x[i] + h * k3[i];
        deriv(xt, k4);
        for (let i = 0; i < n; i++) x[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
      }
      if (lag > 0) { queue.push(v); v = queue.shift(); }
      return v;
    },
    track() {},
  };
}

function gaussian(seed) {
  let a = (Number(seed) >>> 0) || 1;
  const uni = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare = null;
  return () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    const u1 = Math.max(uni(), 1e-12), u2 = uni();
    const rr = Math.sqrt(-2 * Math.log(u1));
    spare = rr * Math.sin(2 * Math.PI * u2);
    return rr * Math.cos(2 * Math.PI * u2);
  };
}

const ns = (x) => Math.round(x * 1e9);
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
function stepPlan(T, bound, sampleTimes = [], K = 1, warnings = [], who = null) {
  const hmax = bound > 0 ? 0.5 / bound : T;
  let need = Math.max(1, Math.ceil(T / hmax - 1e-9));
  if (K * need > MAX_STEPS) {
    const ran = Math.max(1, Math.floor(MAX_STEPS / K));
    warnings.push(`${who ? `'${who}' needs` : 'this plant needs'} steps of ${siUnit(hmax, 's')}; this ${siUnit(K * T, 's')} screen would take ${siUnit(K * need, '')} steps; it ran ${siUnit(K * ran, '')}: inaccurate. Shorten the screen`);
    need = ran;
  }
  if (!sampleTimes.length) return { m: need, split: false };
  let g = ns(T);
  for (const Ts of sampleTimes) g = gcd(g, ns(Ts));
  const base = g > 0 ? ns(T) / g : Infinity;
  const grid = base * Math.ceil(need / base - 1e-9);
  const cuts = sampleTimes.reduce((n, Ts) => n + Math.ceil(T / Ts - 1e-9), 0);
  return grid <= need + cuts && K * grid <= MAX_STEPS ? { m: grid, split: false } : { m: need, split: true };
}
const substeps = (...a) => stepPlan(...a).m;

const onGrid = (t) => Math.round(t * 1e9) / 1e9;

function simulateSystem(diagram, signals, sim, opts = {}) {
  const { designs, until } = opts;
  const t0 = globalThis.performance?.now() ?? Date.now();
  const Ts = Number(sim.sampleTime), duration = Number(sim.duration);
  let K = Math.min(Math.round(duration / Ts), MAX_SAMPLES);
  if (until !== undefined) {
    if (!(Number(until) >= 0)) throw new Error('until: a time of the run, at least 0 s');
    K = Math.min(K, Math.round(Number(until) / Ts));
  }
  const sources = Object.fromEntries(Object.entries(signals).map(([name, ref]) => [name, referenceFn(ref, { sampleTime: Ts })]));
  const el = compileDiagram(diagram, 'plant', { sources, standalone: true, designs });
  const warnings = [...el.warnings];
  const bound = Math.max(el.bound, Number(opts.bound) || 0);
  const { m, split } = stepPlan(Ts, bound, el.sampleTimes, K, warnings, el.stiff.state);
  const h = Ts / m, N = el.n;
  el.setStep(h);
  const X = new Float64Array(N), Xt = new Float64Array(N);
  el.init(X, 0);
  const k1 = new Float64Array(N), k2 = new Float64Array(N), k3 = new Float64Array(N), k4 = new Float64Array(N);
  const rk4 = (ts, dt) => {
    el.eval(ts, X, 0, 0, k1);
    for (let i = 0; i < N; i++) Xt[i] = X[i] + 0.5 * dt * k1[i];
    el.eval(ts + 0.5 * dt, Xt, 0, 0, k2);
    for (let i = 0; i < N; i++) Xt[i] = X[i] + 0.5 * dt * k2[i];
    el.eval(ts + 0.5 * dt, Xt, 0, 0, k3);
    for (let i = 0; i < N; i++) Xt[i] = X[i] + dt * k3[i];
    el.eval(ts + dt, Xt, 0, 0, k4, true);
    for (let i = 0; i < N; i++) X[i] += (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  };
  const t = new Float64Array(K + 1);
  const out = {};
  el.eval(0, X, 0, 0, null);
  el.sample(0, X, 0, 0);
  el.record();
  let unstable = false, steps = 0;
  for (let k = 0; k <= K; k++) {
    t[k] = k * Ts;
    for (const [name, v] of el.probes()) {
      (out[name] ??= new Float64Array(K + 1).fill(NaN))[k] = v;
      if (!Number.isFinite(v) || Math.abs(v) > BLOWUP) unstable = true;
    }
    if (unstable) { for (let j = k; j <= K; j++) t[j] = j * Ts; warnings.push('a signal diverged; the rest is not drawn'); break; }
    if (k === K) break;
    for (let s = 0; s < m; s++) {
      const ts = t[k] + s * h, te = onGrid(t[k] + (s + 1) * h);
      let a = ts;
      if (split) {
        for (let tn = onGrid(el.nextSample()); tn < te - 1e-9; tn = onGrid(el.nextSample())) {
          if (tn > a) { rk4(a, tn - a); a = tn; steps++; }
          el.eval(tn, X, 0, 0, null);
          el.sample(tn, X, 0, 0);
        }
      }
      rk4(a, ts + h - a);
      steps++;
      el.eval(te, X, 0, 0, null);
      el.recordLeft();
      el.sample(te, X, 0, 0);
      el.record();
    }
  }
  const end = unstable ? null : el.stiffness(X, K * Ts);
  if (end && !(opts.bound > 0) && end.bound > bound * (1 + 1e-6) && stepPlan(Ts, end.bound, el.sampleTimes, K).m > m) {
    const again = simulateSystem(diagram, signals, sim, { ...opts, bound: end.bound });
    again.info.warnings.unshift(`stiffer later in the run: ${end.state ? `'${end.state}'` : 'the plant'} needs steps of ${siUnit(0.5 / end.bound, 's')} at ${siUnit(K * Ts, 's')}, against ${siUnit(h, 's')} at the start; run again with them`);
    again.info.stiffness.start = el.stiff;
    again.info.ms = (globalThis.performance?.now() ?? Date.now()) - t0;
    return again;
  }
  const ms = (globalThis.performance?.now() ?? Date.now()) - t0;
  const res = { t, signals: out, info: { h, substeps: m, split, steps, unstable, warnings, designs: el.designs, bound, stiffness: { start: el.stiff, end }, ms } };
  if (until !== undefined) res.snapshot = unstable ? null : el.snapshot(K * Ts, X);
  return res;
}

return { simulate, stepPlan, substeps, simulateSystem };
})();
// ---- core/plants.js
__mods['core/plants.js'] = (() => {

const { conicalTank } = __mods['core/physics.js'];
const src = (signal, x, y, unit) => ({ id: signal, type: 'source', params: { signal, unit }, x, y });
const sink = (id, x, y, unit) => ({ id, type: 'sink', params: { name: id, unit }, x, y });
const channels = (...sources) => [0, 1, 2, 3].map((i) => {
  const c = typeof sources[i] === 'object' ? sources[i] : { source: sources[i] ?? '' };
  return { source: c.source, on: c.on ?? !!c.source, scale: 1, offset: 0, ...(c.measure ? { measure: true } : {}) };
});
const ui = (view) => ({ run: 'run', tab: 'plant', setup: 0.42, view });
const ctrl = (x, y, inputs, Ts, variants, variant = 0) => ({ id: 'ctrl', type: 'controller', name: 'controller', params: { inputs, Ts }, variants, variant, x, y });
const pulse = (amplitude, time, width) => ({ type: 'square', params: { amplitude, time, width, period: 5, count: 1 } });
const PERIOD = 5;

const motorDiagram = (variants, { inputs = 2, Ts = 0.01 } = {}) => ({
      blocks: [
        src('r', 30, 112, 'rad'),
        src('d', 180, 230, 'N·m'),
        ctrl(130, 90, inputs, Ts, variants),
        {
          id: 'motor', type: 'subsystem', name: 'Motor', params: {}, x: 330, y: 96,
          diagram: {
            blocks: [
              { id: 'V', type: 'inport', name: 'V', params: { port: 1 }, x: 30, y: 112 },
              { id: 'load', type: 'inport', name: 'load torque', params: { port: 2 }, x: 330, y: 220 },
              { id: 'sum', type: 'sum', params: { signs: '+-' }, x: 120, y: 104 },
              { id: 'arm', type: 'tf', name: 'armature 1/(Ls + R)', params: { num: [1], den: [0.01, 1], delay: 0 }, x: 190, y: 96 },
              sink('i', 360, 20, 'A'),
              { id: 'kt', type: 'gain', name: 'Kt (= Ke)', params: { K: 0.5 }, x: 370, y: 100 },
              { id: 'tsum', type: 'sum', params: { signs: '+-' }, x: 460, y: 104 },
              { id: 'rotor', type: 'tf', name: 'rotor 1/(Js + b)', params: { num: [1], den: [0.02, 0.1], delay: 0 }, x: 530, y: 96 },
              { id: 'w', type: 'outport', name: 'speed', params: { port: 1 }, x: 720, y: 112 },
              { id: 'ke', type: 'gain', name: 'Ke (= Kt)', params: { K: 0.5 }, x: 370, y: 290, flip: true },
            ],
            wires: [
              { from: 'V', to: 'sum' }, { from: 'sum', to: 'arm' }, { from: 'arm', to: 'kt' }, { from: 'arm', to: 'i' }, { from: 'kt', to: 'tsum' }, { from: 'load', to: 'tsum:1' },
              { from: 'tsum', to: 'rotor' }, { from: 'rotor', to: 'w' }, { from: 'rotor', to: 'ke' }, { from: 'ke', to: 'sum:1' },
            ],
          },
        },
        { id: 'int', type: 'integrator', name: 'angle', params: { K: 1 }, x: 500, y: 96 },
        sink('angle', 690, 106, 'rad'),
        sink('speed', 690, 30, 'rad/s'),
        sink('V', 330, 20, 'V'),
        ...(inputs >= 3 ? [{ id: 'esum', type: 'sum', params: { signs: '+-' }, x: 130, y: 300 }, sink('e', 200, 303, 'rad')] : []),
      ],
      wires: [
        { from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'motor' }, { from: 'd', to: 'motor:1' }, { from: 'motor', to: 'int' }, { from: 'int', to: 'angle' },
        { from: 'motor', to: 'speed' }, { from: 'int', to: 'ctrl:1' }, { from: 'ctrl', to: 'V' },
        ...(inputs >= 3 ? [{ from: 'motor', to: 'ctrl:2' }, { from: 'r', to: 'esum' }, { from: 'int', to: 'esum:1' }, { from: 'esum', to: 'e' }] : []),
      ],
    });
const motorViews = () => ([{
      name: 'Motor shaft', kind: '2d', view: [-1.1, -0.9, 1.1, 0.9],
      shapes: [
        { type: 'circle', cx: 0, cy: 0, r: 0.62, fill: 'panel', stroke: 'muted', lineWidth: 2 },
        ...ticks(0.62),
        { type: 'group', angle: 'r', shapes: [{ type: 'line', x1: 0, y1: 0.66, x2: 0, y2: 0.8, stroke: 'ch1', lineWidth: 5 }] },
        { type: 'group', angle: 'angle', shapes: [
          { type: 'circle', cx: 0, cy: 0, r: 0.5, fill: 'ink' },
          { type: 'circle', cx: 0, cy: 0.27, r: 0.15, fill: 'ch2' },
          { type: 'line', x1: 0, y1: 0, x2: 0, y2: 0.6, stroke: 'ch2', lineWidth: 6 },
        ] },
        { type: 'circle', cx: 0, cy: 0, r: 0.07, fill: 'muted' },
        { type: 'text', x: 0, y: -0.82, text: 'angle {angle:5.2} rad   r {r:4.1} rad   V {V:5.1} V   i {i:5.1} A   load {d:3.1} N·m', size: 13 },
      ],
    }]);

const ticks = (r) => Array.from({ length: 12 }, (_, i) => ({
  type: 'group', angle: (i * Math.PI) / 6, shapes: [{ type: 'line', x1: 0, y1: r, x2: 0, y2: r + (i % 3 ? 0.06 : 0.12), stroke: 'muted', lineWidth: i % 3 ? 1.5 : 3 }],
}));

function cartView(name, rods, caption, box) {
  let chain = [];
  for (let i = rods.length - 1; i >= 0; i--) {
    const { len, angle } = rods[i];
    chain = [{ type: 'group', y: i ? rods[i - 1].len : 0.1, angle, shapes: [
      { type: 'line', x1: 0, y1: 0, x2: 0, y2: len, lineWidth: 4 },
      { type: 'circle', cx: 0, cy: len, r: 0.04, fill: 'ch3' },
      ...chain,
    ] }];
  }
  return {
    name, kind: '2d', view: box,
    shapes: [
      { type: 'line', x1: -1e3, y1: -0.065, x2: 1e3, y2: -0.065, stroke: 'muted', lineWidth: 3 },
      { type: 'line', x1: 'r', y1: -0.16, x2: 'r', y2: -0.08, stroke: 'ch1', lineWidth: 3 },
      { type: 'group', x: 'x', y: 0, shapes: [
        { type: 'rect', x: -0.16, y: -0.02, w: 0.32, h: 0.12, fill: 'ch2' },
        { type: 'circle', cx: -0.1, cy: -0.03, r: 0.03, fill: 'ink' },
        { type: 'circle', cx: 0.1, cy: -0.03, r: 0.03, fill: 'ink' },
        ...chain,
        { type: 'arrow', x1: '-0.17 - 0.03*F', y1: 0.04, x2: -0.17, y2: 0.04, stroke: 'ch4', lineWidth: 3 },
        { type: 'arrow', x1: '-0.17 - 0.03*d', y1: -0.02, x2: -0.17, y2: -0.02, stroke: 'muted', lineWidth: 3 },
      ] },
      { type: 'text', x: 0, y: box[3] - 0.08, text: caption, size: 13 },
    ],
  };
}

const Q_SINGLE = [10, 50, 1, 1];
const Q_TRIPLE = [10, 100, 100, 100, 1, 1, 1, 1];

const EXAMPLE_PLANTS = [
  {
    name: 'Mass–spring–damper',
    summary: 'A mass on a spring and a damper, pulled down once; no controller. Change the spring or the damping and watch it swing and settle: how stiffness and damping shape a response.',
    notes: 'A 1 kg mass hangs on a spring (25 N/m) and a damper (0.5 N·s/m). At 0.1 s a force F = 1 N pulls it down: it drops about 40 mm and swings at 0.8 Hz while it settles, its energy moving between motion (Ekin) and spring (Epot). No controller.',
    signals: { F: { period: PERIOD, components: [{ type: 'step', params: { amplitude: 1, time: 0.1 } }] } },
    scope: { channels: channels('F', 'x', 'Ekin', 'Epot') },
    ui: ui('Hanging mass'),
    diagram: {
      blocks: [
        src('F', 30, 112, 'N'),
        { id: 'sum', type: 'sum', params: { signs: '+--' }, x: 130, y: 104 },
        { id: 'm', type: 'gain', name: '1/m', params: { K: 1 }, x: 210, y: 100 },
        { id: 'vel', type: 'integrator', name: 'velocity', params: { K: 1 }, x: 330, y: 100 },
        { id: 'pos', type: 'integrator', name: 'position', params: { K: 1 }, x: 490, y: 100 },
        sink('x', 680, 108, 'm'),
        sink('v', 680, 20, 'm/s'),
        { id: 'c', type: 'gain', name: 'damping c', params: { K: 0.5 }, x: 330, y: 200, flip: true },
        { id: 'k', type: 'gain', name: 'spring k', params: { K: 25 }, x: 490, y: 270, flip: true },
        { id: 'ek', type: 'fcn', name: 'kinetic ½mv²', params: { expr: '0.5*1*u^2' }, x: 490, y: 360 },
        sink('Ekin', 680, 368, 'J'),
        { id: 'ep', type: 'fcn', name: 'spring ½kx²', params: { expr: '0.5*25*u^2' }, x: 490, y: 440 },
        sink('Epot', 680, 448, 'J'),
      ],
      wires: [
        { from: 'F', to: 'sum' }, { from: 'sum', to: 'm' }, { from: 'm', to: 'vel' }, { from: 'vel', to: 'pos' }, { from: 'pos', to: 'x' },
        { from: 'vel', to: 'c' }, { from: 'c', to: 'sum:1' }, { from: 'pos', to: 'k' }, { from: 'k', to: 'sum:2' },
        { from: 'vel', to: 'v' }, { from: 'vel', to: 'ek' }, { from: 'ek', to: 'Ekin' }, { from: 'pos', to: 'ep' }, { from: 'ep', to: 'Epot' },
      ],
    },
    views: [{
      name: 'Hanging mass', kind: '2d', view: [-0.9, -0.95, 1.1, 0.62],
      shapes: [
        { type: 'ground', x1: -0.35, x2: 0.35, y: 0.5, side: 'above' },
        { type: 'spring', x1: -0.08, y1: 0.5, x2: -0.08, y2: '0 - 5*x', width: 0.09, coils: 8 },
        { type: 'damper', x1: 0.09, y1: 0.5, x2: 0.09, y2: '0 - 5*x', width: 0.08 },
        { type: 'rect', x: -0.18, y: '-0.26 - 5*x', w: 0.36, h: 0.26, fill: 'ch2' },
        { type: 'text', x: 0, y: '-0.13 - 5*x', text: 'm', size: 18, fill: 'panel' },
        { type: 'arrow', x1: 0, y1: '-0.28 - 5*x', x2: 0, y2: '-0.28 - 5*x - 0.25*F', stroke: 'ch1', lineWidth: 3 },
        { type: 'line', x1: -0.55, y1: -0.26, x2: -0.22, y2: -0.26, stroke: 'muted', lineWidth: 1 },
        { type: 'text', x: -0.68, y: -0.26, text: 'rest', size: 11, fill: 'muted' },
        { type: 'line', x1: 0.55, y1: -0.7, x2: 1.0, y2: -0.7, stroke: 'muted', lineWidth: 1 },
        { type: 'rect', x: 0.6, y: -0.7, w: 0.14, h: '8*Ekin', fill: 'ch3' },
        { type: 'rect', x: 0.82, y: -0.7, w: 0.14, h: '8*Epot', fill: 'ch4' },
        { type: 'text', x: 0.67, y: -0.78, text: 'Ekin', size: 11, fill: 'muted' },
        { type: 'text', x: 0.89, y: -0.78, text: 'Epot', size: 11, fill: 'muted' },
        { type: 'text', x: 0.1, y: -0.9, text: 'x = {1000*x:5.1} mm down (drawn ×5)   F = {F:3.1} N', size: 13 },
      ],
    }],
  },
  {
    name: 'DC motor, position control',
    summary: 'A motor turning its shaft to a commanded angle against a load. Its controller starts too aggressive: switch to PD or PID, or tune it, and see what P, I and D each do.',
    notes: 'A PID controls the shaft angle of a DC motor; the reference r jumps between 0 and 2 rad, and a load torque d brakes the shaft at 3.2 s. The controller it starts with is too aggressive: the shaft overshoots and rings. Flip the Controller tab to PD or PID with prefilter to see it settle, or tune it yourself.',
    signals: {
      r: { period: PERIOD, components: [{ type: 'square', params: { amplitude: 2, time: 0.25, width: 1.25, period: 2.5, count: 0 } }] },
      d: { period: PERIOD, components: [pulse(0.3, 3.2, 0.5)] },
    },
    scope: { channels: channels('r', 'angle', 'V', 'd') },
    ui: ui('Motor shaft'),
    diagram: motorDiagram([

          { name: 'P, too aggressive', type: 'pid', params: { Kp: 30, umin: -12, umax: 12 } },
          { name: 'PD', type: 'pid', params: { Kp: 20, Kd: 1.5, Tf: 0.01, umin: -12, umax: 12 } },
          { name: 'PID with prefilter', type: 'pid', params: { Kp: 20, Ki: 10, Kd: 1.5, Tf: 0.01, Tr: 0.1, umin: -12, umax: 12 } },
          { name: 'Off', type: 'off', params: {} },
    ]),
    views: motorViews(),
  },
  {
    name: 'Following a sine (XY)',
    summary: 'The motor following a slow sine, drawn as error against reference. Step through P, PD, PID and feedforward: why feedback alone lags a moving target, and what feedforward adds.',
    notes: 'The motor follows a slow sine, one period per sweep. The scope opens in XY mode with Δ: across is the reference r, up is the error r − angle. Perfect following would be a flat line on the axis. With P alone the error leads r by a quarter period and the figure is a wide ellipse; PD shrinks it; the integral of the PID turns the error against r, so the figure collapses to a thin tilted line.\n\nPID + feedforward adds a velocity feedforward Kv that the page computes from the motor (the voltage per rad/s its inverse needs, plus the PID\'s Kd, which the derivative on the angle takes away), so the voltage the moving reference needs comes from r itself: once the start-up ringing has died away, the figure lies flat on the axis. Each figure reads out its best line and its spread σ. Press Time to see the same runs over time. Try its Feedforward choice "and acceleration": Ka from the motor\'s inertia flattens the figure about four times more.',
    signals: {
      r: { period: PERIOD, components: [{ type: 'sine', params: { amplitude: 1, frequency: 0.2 } }] },
      d: { period: PERIOD, components: [] },
    },
    scope: { channels: channels('r', 'angle'), view: { mode: 'xy', delta: true } },
    ui: ui('Motor shaft'),
    diagram: motorDiagram([
      { name: 'P', type: 'pid', params: { Kp: 3, umin: -12, umax: 12 } },
      { name: 'PD', type: 'pid', params: { Kp: 20, Kd: 1.5, Tf: 0.01, umin: -12, umax: 12 } },
      { name: 'PID', type: 'pid', params: { Kp: 30, Ki: 80, Kd: 1, Tf: 0.02, umin: -12, umax: 12 } },
      { name: 'PID + feedforward', type: 'pidFF', params: { Kp: 30, Ki: 80, Kd: 1, Tf: 0.02, order: '1', umin: -12, umax: 12 } },
    ]),
    views: motorViews(),
  },
  {
    name: 'DC motor, sliding mode',
    summary: 'The motor under sliding-mode control, on its phase portrait. Compare the ideal relay, a boundary layer and super-twisting: a response the load cannot change, and what chattering costs.',
    notes: 'A sliding-mode controller holds the shaft: it drives s = λ·e + ė to zero (e = r − angle, λ = 10 1/s). On the line s = 0 the error decays as e^(−λt) whatever the load or the inertia, so the slope λ, not the mass, sets how the shaft settles. The scope opens in XY, e across, speed up: after each step the beam runs at full voltage towards the line speed = 10·e, then slides along it into the origin (the whole run\'s fit, a ≈ 7, includes these arcs).\n\nTo read λ, set Horizontal to 100 ms/div at 0.4 s, channel 1 to 0.1 rad/div and channel 2 to 1 rad/s/div: only the sliding is left (the run now ends at 1.4 s), the line rises one division per division across, a reads λ, σ how tightly it slides.\n\nRelay (theory), V = 12 V·sign(s): press Time, switch on channels 3 and 4. V slams between ±12 V at 62.5 Hz (Measure counts both turns: 126/s), the current ripples 11 A peak to peak, and its rms of 2.7 A is 7.3 W of heat (R·i², R = 1 Ω). Boundary layer (practice): a stiff PD inside |s| < 2 rad/s (Kp 60, Kd 6): no chatter, but over the whole run (Auto Scale) the load at 3.2 s leaves 33 mrad (the relay about 5). Super-twisting: a continuous voltage whose integral part rejects the load; a 36 Hz ripple from the armature remains. A PID\'s integral would reject the load too; super-twisting adds convergence in finite time.\n\nTry: open Motor and triple J (rotor den [0.06, 0.1]): the relay and the layer keep the slope, super-twisting first overshoots the line. Or make the armature ten times faster (den [0.001, 1]): the relay chatters at 250 Hz and makes about five times the heat.',
    signals: {
      r: { period: PERIOD, components: [{ type: 'square', params: { amplitude: 1, time: 0.25, width: 1.25, period: 2.5, count: 0 } }] },
      d: { period: PERIOD, components: [pulse(1, 3.2, 0.5)] },
    },
    scope: { channels: channels('e', 'speed', { source: 'V', on: false, measure: true }, { source: 'i', on: false, measure: true }), view: { mode: 'xy' } },
    sim: { sampleTime: 0.00025 },
    ui: ui('Motor shaft'),
    diagram: motorDiagram([
      { name: 'Relay (theory)', type: 'slidingMode', params: { lambda: 10, K: 12, phi: 0, umin: -12, umax: 12 } },
      { name: 'Boundary layer', type: 'slidingMode', params: { lambda: 10, K: 12, phi: 2, umin: -12, umax: 12 } },
      { name: 'Super-twisting', type: 'superTwisting', params: { lambda: 10, k1: 4, k2: 44, umin: -12, umax: 12 } },
    ], { inputs: 3, Ts: 0.001 }),
    views: motorViews(),
  },
  {
    name: 'Encoder errors and torque ripple',
    summary: 'A motor speeding up with encoder errors, torque ripple and a shaft resonance, in the spectrogram. Change the colour scale, try FFT or a notch: tell errors that follow the speed from a resonance, and spot aliasing.',
    notes: 'A speed-controlled motor sweeps from 0 to 300 rad/s. Its encoder is off-centre (an error once per turn, 1×) and its tracks are not quite perpendicular (twice per turn, 2×); the inverter adds torque ripple six times per turn (6×), and the encoder sits behind a flexible shaft that resonates at 70 Hz. The scope opens in Spectrogram mode on the measured speed: each error is a straight line from the origin, rising with speed; the resonance is a horizontal line, and each order flares up as it crosses it (6× at about 73 rad/s, 2× at about 220 rad/s). The 6× line passes the scope\'s Nyquist frequency (200 Hz) and folds back down: aliasing.\n\nUp there it is weaker than the noise at low frequencies, so the absolute levels leave it black. Switch the colour to Above noise (Run Control › Colour, or the key above the levels strip at the right edge): each colour is then dB above the noise at its own frequency, and the whole 6× line shows, up to the Nyquist frequency, its turn there and back down, with the 3×, 4× and 5× orders; drag the ceiling down to brighten the weak ones. In Absolute, zoom the frequency axis to 100–200 Hz (the levels follow what is shown), or drag the floor down to about −60 dB.\n\nTry FFT mode, and a notch filter on the channel.',
    signals: {
      r: { period: PERIOD, components: [{ type: 'ramp', params: { amplitude: 300, time: 0.5, rise: 4 } }] },
    },
    scope: { channels: channels('speed_m', 'r', 'speed', 'V'), view: { mode: 'spectrogram' } },
    ui: { run: 'run', tab: 'plant', setup: 0.42 },
    diagram: {
      blocks: [
        src('r', 30, 112, 'rad/s'),
        ctrl(130, 90, 2, 0.001, [
          { name: 'PI speed', type: 'pid', params: { Kp: 0.5, Ki: 5, umin: -48, umax: 48 } },
          { name: 'Off', type: 'off', params: {} },
        ]),
        {
          id: 'motor', type: 'subsystem', name: 'Motor', params: {}, x: 330, y: 96,
          diagram: {
            blocks: [
              { id: 'V', type: 'inport', name: 'V', params: { port: 1 }, x: 30, y: 112 },
              { id: 'load', type: 'inport', name: 'ripple torque', params: { port: 2 }, x: 300, y: 220 },
              { id: 'sum', type: 'sum', params: { signs: '+-' }, x: 120, y: 104 },
              { id: 'arm', type: 'firstOrder', name: 'armature', params: { K: 1, tau: 0.002 }, x: 200, y: 96 },
              { id: 'kt', type: 'gain', name: 'Kt', params: { K: 0.1 }, x: 360, y: 100 },
              { id: 'tsum', type: 'sum', params: { signs: '++' }, x: 440, y: 104 },
              { id: 'mech', type: 'firstOrder', name: 'inertia and friction', params: { K: 200, tau: 0.2 }, x: 510, y: 96 },
              { id: 'w', type: 'outport', name: 'speed', params: { port: 1 }, x: 690, y: 112 },
              { id: 'ke', type: 'gain', name: 'Ke', params: { K: 0.1 }, x: 360, y: 280, flip: true },
            ],
            wires: [
              { from: 'V', to: 'sum' }, { from: 'sum', to: 'arm' }, { from: 'arm', to: 'kt' }, { from: 'kt', to: 'tsum' }, { from: 'load', to: 'tsum:1' },
              { from: 'tsum', to: 'mech' }, { from: 'mech', to: 'w' }, { from: 'mech', to: 'ke' }, { from: 'ke', to: 'sum:1' },
            ],
          },
        },
        { id: 'int', type: 'integrator', name: 'angle', params: { K: 1 }, x: 500, y: 96 },
        { id: 'ripple', type: 'fcn', name: 'torque ripple 6×', params: { expr: '0.05*sin(6*u)' }, x: 500, y: 230, flip: true },
        { id: 'rough', type: 'noise', name: 'torque noise', params: { std: 0.02, seed: 7 }, x: 330, y: 230, flip: true },
        { id: 'shaft', type: 'secondOrder', name: 'shaft resonance 70 Hz', params: { K: 1, wn: 439.8, zeta: 0.02 }, x: 650, y: 96 },
        { id: 'enc', type: 'fcn', name: 'encoder 1× and 2× errors', params: { expr: 'u + 0.02*sin(u + 0.5) + 0.01*sin(2*u + 1)' }, x: 820, y: 96 },
        { id: 'deriv', type: 'tf', name: 'speed from angle', params: { num: [1, 0], den: [0.001, 1], delay: 0 }, x: 990, y: 96 },
        sink('speed_m', 1160, 106, 'rad/s'),
        sink('speed', 650, 20, 'rad/s'),
        sink('V', 330, 20, 'V'),
      ],
      wires: [
        { from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'motor' }, { from: 'ripple', to: 'rough' }, { from: 'rough', to: 'motor:1' }, { from: 'motor', to: 'int' },
        { from: 'int', to: 'ripple' }, { from: 'int', to: 'shaft' }, { from: 'shaft', to: 'enc' }, { from: 'enc', to: 'deriv' }, { from: 'deriv', to: 'speed_m' }, { from: 'deriv', to: 'ctrl:1' },
        { from: 'motor', to: 'speed' }, { from: 'ctrl', to: 'V' },
      ],
    },
  },
  {
    name: 'Conical tank, gain scheduling',
    summary: 'A tank that widens upwards: quick when nearly empty, slow when full. Compare a gain-scheduled PI with fixed ones: why one set of gains cannot fit a plant that changes.',
    notes: 'A pump fills a tank that widens upwards; its outlet drains by gravity. Nearly empty, the level reacts fast; nearly full, slowly: a PI tuned for one level is wrong at the other.\n\nThe page computes the PI gains from the tank itself at each level (pole cancellation), and the gain-scheduled PI looks them up from the level. The reference climbs 0.15 → 0.45 → 0.8 m; at 2.2 s water is drawn off (d).',
    signals: {
      r: { period: PERIOD, components: [{ type: 'dc', params: { level: 0.15 } }, { type: 'step', params: { amplitude: 0.3, time: 1.5 } }, { type: 'step', params: { amplitude: 0.35, time: 3 } }] },
      d: { period: PERIOD, components: [pulse(0.15, 2.2, 0.5)] },
    },
    scope: { channels: channels('r', 'h', 'q', 'd') },
    ui: ui('Tank'),
    diagram: {
      blocks: [
        src('r', 30, 112, 'm'),
        src('d', 300, 220, 'm³/s'),
        ctrl(130, 90, 2, 0.02, [
          { name: 'Gain-scheduled PI', type: 'scheduledPI', params: { at: [0.1, 0.25, 0.5, 0.75, 0.95], Tcl: 0.25, Tr: 0.1, umin: 0, umax: 3 } },
          { name: 'PI tuned for full', type: 'scheduledPI', params: { at: [0.8], Tcl: 0.25, umin: 0, umax: 3 } },
          { name: 'PI tuned for empty', type: 'scheduledPI', params: { at: [0.15], Tcl: 0.25, umin: 0, umax: 3 } },
          { name: 'Off', type: 'off', params: {} },
        ]),
        { id: 'pipe', type: 'delay', name: 'pipe', params: { L: 0.1, y0: null }, x: 320, y: 96 },
        { id: 'sum', type: 'sum', params: { signs: '+-' }, x: 440, y: 104 },
        { id: 'tank', name: 'tank', x: 510, y: 90, ...conicalTank({ r0: 0.05, R: 0.5, H: 1, a: 0.1, g: 9.81, h0: 0.15 }) },
        sink('h', 720, 106, 'm'),
        sink('q', 320, 20, 'm³/s'),
      ],
      wires: [
        { from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'pipe' }, { from: 'pipe', to: 'sum' }, { from: 'd', to: 'sum:1' }, { from: 'sum', to: 'tank' },
        { from: 'tank', to: 'h' }, { from: 'tank', to: 'ctrl:1' }, { from: 'ctrl', to: 'q' },
      ],
    },
    views: [{
      name: 'Tank', kind: '2d', view: [-1, -0.25, 1, 1.3],
      shapes: [
        { type: 'polygon', points: [[-0.05, 0], [0.05, 0], ['0.05 + 0.45*h', 'h'], ['-0.05 - 0.45*h', 'h']], fill: 'ch3', stroke: 'none' },
        { type: 'line', x1: -0.05, y1: 0, x2: -0.5, y2: 1, stroke: 'ink', lineWidth: 3 },
        { type: 'line', x1: 0.05, y1: 0, x2: 0.5, y2: 1, stroke: 'ink', lineWidth: 3 },
        { type: 'line', x1: '-0.05 - 0.45*r', y1: 'r', x2: '0.05 + 0.45*r', y2: 'r', stroke: 'ch1', lineWidth: 2 },
        { type: 'text', x: '0.12 + 0.45*r', y: 'r', text: 'r', size: 12, fill: 'ch1', anchor: 'start' },
        { type: 'line', x1: -0.9, y1: 1.12, x2: -0.15, y2: 1.12, stroke: 'muted', lineWidth: 6 },
        { type: 'arrow', x1: -0.15, y1: 1.12, x2: -0.15, y2: '1.1 - 0.25*q', stroke: 'ch2', lineWidth: 4 },
        { type: 'line', x1: 0, y1: 0, x2: 0, y2: -0.12, stroke: 'muted', lineWidth: 6 },
        { type: 'arrow', x1: 0.06, y1: -0.08, x2: '0.06 + 0.6*d', y2: -0.08, stroke: 'ch4', lineWidth: 3 },
        { type: 'text', x: 0, y: 1.24, text: 'h {h:4.2} m   r {r:4.2} m   pump q {q:4.2} m³/s   drawn off d {d:4.2} m³/s', size: 13 },
      ],
    }],
  },
  {
    name: 'Pendulum swing-up',
    summary: 'A pendulum below a cart, swung up and balanced. Compare with LQR alone, and push it: energy-based control brings it near the top, a linear controller computed from the cart and pole holds it there.',
    notes: 'A pendulum hangs below a cart. The controller pumps energy into the swing (a Lyapunov function of the energy falls with every push), then, near the top, catches the pole with LQR, its gains computed from the cart and pole, and holds it; at 3.5 s it is pushed (d). Flip to "LQR only" to see why the swing-up is needed.',
    signals: {
      r: { period: PERIOD, components: [] },
      d: { period: PERIOD, components: [pulse(4, 3.5, 0.1)] },
    },
    scope: { channels: channels('x', 'theta', 'F', 'd') },
    ui: ui('Cart and pole'),
    diagram: {
      blocks: [
        src('r', 30, 112, 'm'),
        src('d', 300, 200, 'N'),
        ctrl(130, 80, 5, 0.01, [
          { name: 'Swing-up + LQR catch', type: 'swingUpLqr', params: { kE: 3, kx: 8, kv: 5, thetaS: 0.4, Q: Q_SINGLE, R: 0.1, umin: -25, umax: 25 } },
          { name: 'LQR only', type: 'lqr', params: { Q: Q_SINGLE, R: 0.1, umin: -25, umax: 25 } },
          { name: 'Off', type: 'off', params: {} },
        ]),
        { id: 'sum', type: 'sum', params: { signs: '++' }, x: 330, y: 104 },
        { id: 'cart', type: 'cartPole', name: 'cart and pole', params: { M: 1, m: 0.2, l: 0.5, g: 9.81, b: 0.1, theta0: Math.PI }, x: 400, y: 80 },
        sink('x', 640, 84, 'm'), sink('theta', 640, 120, 'rad'),
        sink('F', 330, 20, 'N'),
      ],
      wires: [
        { from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'sum' }, { from: 'd', to: 'sum:1' }, { from: 'sum', to: 'cart' }, { from: 'ctrl', to: 'F' },
        { from: 'cart', to: 'x' }, { from: 'cart:1', to: 'theta' },
        { from: 'cart', to: 'ctrl:1' }, { from: 'cart:1', to: 'ctrl:2' }, { from: 'cart:2', to: 'ctrl:3' }, { from: 'cart:3', to: 'ctrl:4' },
      ],
    },
    views: [cartView('Cart and pole', [{ len: 0.5, angle: '-theta' }], 'x {x:5.2} m   θ {theta*180/pi:6.1}°   F {F:5.1} N   push {d:3.1} N', [-1.9, -0.75, 1.9, 0.8])],
  },
  {
    name: 'Triple pendulum',
    summary: 'Three rods hanging below a cart, swung up by a plan the page computes, then held by LQR. Push it, or flip to LQR only: why a controller for the top alone cannot get there.',
    notes: 'Three rods hang below a cart. When the system loads, the page plans a swing-up from the cart and rods themselves; until the plan is ready (a few seconds, its progress beside the title) the rods hang.\n\nThe plan is a force that brings all three up in 2.4 s, followed with time-varying LQR, then LQR holds them. At 3.5 s the cart is pushed (d). Flip to "LQR only" to see that a controller for the top alone cannot get there.',
    signals: {
      r: { period: PERIOD, components: [] },
      d: { period: PERIOD, components: [pulse(4, 3.5, 0.1)] },
    },
    scope: { channels: channels('x', 'theta1', 'F', 'd') },
    ui: ui('Cart and triple pendulum'),
    diagram: {
      blocks: [
        src('r', 30, 132, 'm'),
        src('d', 300, 260, 'N'),
        ctrl(130, 70, 9, 0.01, [
          { name: 'Planned swing-up + TV-LQR', type: 'trajectory', params: { T: 2.4, segments: 12, planShare: 0.75, Q: Q_TRIPLE, R: 0.1, umin: -40, umax: 40 } },
          { name: 'LQR only (cannot swing up)', type: 'lqr', params: { Q: Q_TRIPLE, R: 0.1, umin: -40, umax: 40 } },
          { name: 'Off', type: 'off', params: {} },
        ]),
        { id: 'sum', type: 'sum', params: { signs: '++' }, x: 330, y: 124 },
        { id: 'cart', type: 'pendulumCart', name: 'cart and 3 rods', params: { links: 3, M: 1, m1: 0.1, l1: 0.25, m2: 0.1, l2: 0.25, m3: 0.1, l3: 0.25, g: 9.81, b: 0.1, theta10: Math.PI, theta20: Math.PI, theta30: Math.PI }, x: 400, y: 60 },
        sink('x', 640, 64, 'm'), sink('theta1', 640, 100, 'rad'), sink('theta2', 640, 136, 'rad'), sink('theta3', 640, 172, 'rad'),
        sink('F', 330, 20, 'N'),
      ],
      wires: [
        { from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'sum' }, { from: 'd', to: 'sum:1' }, { from: 'sum', to: 'cart' }, { from: 'ctrl', to: 'F' },
        { from: 'cart', to: 'x' }, { from: 'cart:1', to: 'theta1' }, { from: 'cart:2', to: 'theta2' }, { from: 'cart:3', to: 'theta3' },
        ...Array.from({ length: 8 }, (_, i) => ({ from: i ? `cart:${i}` : 'cart', to: `ctrl:${i + 1}` })),
      ],
    },
    views: [cartView('Cart and triple pendulum', [
      { len: 0.25, angle: '-theta1' },
      { len: 0.25, angle: '-(theta2 - theta1)' },
      { len: 0.25, angle: '-(theta3 - theta2)' },
    ], 'x {x:5.2} m   θ1 {theta1*180/pi:6.1}°   θ2 {theta2*180/pi:6.1}°   θ3 {theta3*180/pi:6.1}°   F {F:5.1} N', [-1.3, -0.8, 1.3, 1.1])],
  },
  {
    name: 'Oven, badly tuned',
    summary: 'An oven with a poorly tuned temperature controller and a dead time. It opens on Auto-tune: press Start and watch automatic tuning remove the ringing; without anti-windup, see integrator windup.',
    notes: 'A PID holds an oven\'s temperature: heater, chamber, a dead time and a thermocouple (time scaled to fit 5 s). Its gains were picked badly: every setpoint step overshoots and rings, and so does the door opening at 3.6 s (d). It opens on the Auto-tune tab: press Start and watch the cost fall and the ringing go, iteration by iteration. The variant without anti-windup has the same gains, but its integral winds up while the heater is full on: the first step overshoots to 67 °C instead of 52 °C.',
    signals: {
      r: { period: PERIOD, components: [{ type: 'step', params: { amplitude: 40, time: 0.2 } }, { type: 'step', params: { amplitude: 20, time: 2.2 } }] },
      d: { period: PERIOD, components: [pulse(25, 3.6, 0.8)] },
    },
    scope: { channels: channels('r', 'T', 'P', 'd') },
    ui: { ...ui('Oven'), tab: 'tune' },
    diagram: {
      blocks: [
        src('r', 30, 112, '°C'),
        src('d', 300, 220, '%'),
        ctrl(130, 90, 2, 0.02, [
          { name: 'PID, badly tuned', type: 'pid', params: { Kp: 6, Ki: 12, Kd: 0.1, Tf: 0.02, umin: 0, umax: 100 } },
          { name: 'PID, badly tuned, no anti-windup', type: 'pid', params: { Kp: 6, Ki: 12, Kd: 0.1, Tf: 0.02, umin: 0, umax: 100, aw: 'off' } },
        ]),
        { id: 'heater', type: 'firstOrder', name: 'heater', params: { K: 1, tau: 0.1 }, x: 300, y: 96 },
        { id: 'sum', type: 'sum', params: { signs: '+-' }, x: 420, y: 104 },
        { id: 'oven', type: 'firstOrder', name: 'chamber', params: { K: 1, tau: 0.5 }, x: 490, y: 96 },
        { id: 'lag', type: 'delay', name: 'to sensor', params: { L: 0.1, y0: 0 }, x: 620, y: 96 },
        { id: 'tc', type: 'firstOrder', name: 'thermocouple', params: { K: 1, tau: 0.05 }, x: 740, y: 96 },
        sink('T', 900, 106, '°C'),
        sink('P', 300, 20, '%'),
      ],
      wires: [
        { from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'heater' }, { from: 'heater', to: 'sum' }, { from: 'd', to: 'sum:1' }, { from: 'sum', to: 'oven' },
        { from: 'oven', to: 'lag' }, { from: 'lag', to: 'tc' }, { from: 'tc', to: 'T' }, { from: 'tc', to: 'ctrl:1' }, { from: 'ctrl', to: 'P' },
      ],
    },
    views: [{
      name: 'Oven', kind: '2d', view: [-1.2, -0.75, 1.2, 0.95],
      shapes: [
        { type: 'rect', x: -0.75, y: -0.45, w: 1.1, h: 1.1, fill: 'panel', stroke: 'ink', lineWidth: 3 },
        { type: 'rect', x: -0.65, y: -0.35, w: 0.9, h: 0.9, fill: 'muted' },
        { type: 'line', x1: -0.6, y1: -0.28, x2: 0.2, y2: -0.28, stroke: 'ink', lineWidth: 6 },
        { type: 'line', x1: -0.6, y1: -0.28, x2: '-0.6 + 0.008*P', y2: -0.28, stroke: 'ch3', lineWidth: 6 },
        { type: 'group', x: 0.35, y: -0.45, angle: '-0.012*d', shapes: [{ type: 'rect', x: -0.05, y: 0, w: 0.05, h: 1.1, fill: 'ink' }] },
        { type: 'rect', x: 0.7, y: -0.45, w: 0.12, h: 1.1, fill: 'panel', stroke: 'muted', lineWidth: 2 },
        { type: 'rect', x: 0.72, y: -0.45, w: 0.08, h: '0.011*T', fill: 'ch2' },
        { type: 'line', x1: 0.66, y1: '-0.45 + 0.011*r', x2: 0.86, y2: '-0.45 + 0.011*r', stroke: 'ch1', lineWidth: 3 },
        { type: 'text', x: 0.92, y: '-0.45 + 0.011*r', text: 'r', size: 12, fill: 'ch1', anchor: 'start' },
        { type: 'text', x: 0, y: 0.82, text: 'T {T:5.1} °C   r {r:4.0} °C   heater {P:5.1} %   door loss {d:4.0} %', size: 13 },
      ],
    }],
  },
  {
    name: 'DC motor with an unbalanced arm',
    summary: 'A motor swinging an arm that gravity pulls down, with friction: the plant the example HIL simulator runs. Compare P with PID and see why holding against gravity needs integral action.',
    notes: 'A DC motor swings an arm with an unbalanced mass: gravity pulls it down with mgl·sin(angle), Coulomb and viscous friction brake it, and the motor has 12 V. To hold the arm out sideways the controller needs integral action (gravity leaves a P or PD short of r). It is the plant the example HIL simulator runs by default, there varied by up to 15 % and unknown to the page; here it is open. Flip to "P, a first guess" to see the offset gravity leaves; open Motor and arm to see the physics.',
    signals: {
      r: { period: PERIOD, components: [{ type: 'square', params: { amplitude: 1.5, time: 0.5, width: 2.5, period: 5, count: 0 } }] },
      load: { period: PERIOD, components: [pulse(0.05, 3.5, 0.3)] },
    },
    scope: { channels: channels('r', 'angle', 'V', 'current') },
    ui: ui('Arm'),
    diagram: {
      blocks: [
        src('r', 30, 112, 'rad'),
        src('load', 180, 230, 'N·m'),
        ctrl(130, 90, 2, 0.01, [
          { name: 'PID', type: 'pid', params: { Kp: 10, Ki: 20, Kd: 0.6, Tf: 0.01, umin: -12, umax: 12 } },
          { name: 'P, a first guess', type: 'pid', params: { Kp: 2, umin: -12, umax: 12 } },
          { name: 'Off', type: 'off', params: {} },
        ]),
        {
          id: 'motor', type: 'subsystem', name: 'Motor and arm', params: {}, x: 330, y: 96,
          diagram: {
            blocks: [
              { id: 'V', type: 'inport', name: 'V', params: { port: 1 }, x: 30, y: 112 },
              { id: 'load', type: 'inport', name: 'load torque', params: { port: 2 }, x: 330, y: 300 },
              { id: 'sum', type: 'sum', params: { signs: '+-' }, x: 120, y: 104 },
              { id: 'arm', type: 'tf', name: 'armature 1/(Ls + R)', params: { num: [1], den: [0.004, 2], delay: 0 }, x: 190, y: 96 },
              sink('current', 360, 20, 'A'),
              { id: 'kt', type: 'gain', name: 'K (= Ke)', params: { K: 0.1 }, x: 370, y: 100 },
              { id: 'tsum', type: 'sum', params: { signs: '+--+' }, x: 460, y: 104 },
              { id: 'rotor', type: 'tf', name: 'rotor 1/(Js + b)', params: { num: [1], den: [0.0025, 0.002], delay: 0 }, x: 530, y: 96 },
              { id: 'int', type: 'integrator', name: 'angle', params: { K: 1 }, x: 680, y: 96 },
              { id: 'th', type: 'outport', name: 'angle', params: { port: 1 }, x: 820, y: 112 },
              { id: 'w', type: 'outport', name: 'speed', params: { port: 2 }, x: 820, y: 30 },
              { id: 'ke', type: 'gain', name: 'Ke (= K)', params: { K: 0.1 }, x: 370, y: 380, flip: true },
              { id: 'sgn', type: 'fcn', name: 'Coulomb tanh(ω/0.01)', params: { expr: 'tanh(u/0.01)' }, x: 530, y: 220, flip: true },
              { id: 'tc', type: 'gain', name: 'Tc', params: { K: 0.01 }, x: 400, y: 220, flip: true },
              { id: 'sin', type: 'fcn', name: 'gravity sin(angle)', params: { expr: 'sin(u)' }, x: 680, y: 300, flip: true },
              { id: 'mgl', type: 'gain', name: 'mgl', params: { K: 0.1 }, x: 540, y: 300, flip: true },
            ],
            wires: [
              { from: 'V', to: 'sum' }, { from: 'sum', to: 'arm' }, { from: 'arm', to: 'kt' }, { from: 'arm', to: 'current' }, { from: 'kt', to: 'tsum' },
              { from: 'sgn', to: 'tc' }, { from: 'tc', to: 'tsum:1' }, { from: 'mgl', to: 'tsum:2' }, { from: 'load', to: 'tsum:3' },
              { from: 'tsum', to: 'rotor' }, { from: 'rotor', to: 'int' }, { from: 'rotor', to: 'w' }, { from: 'rotor', to: 'ke' }, { from: 'rotor', to: 'sgn' },
              { from: 'ke', to: 'sum:1' }, { from: 'int', to: 'th' }, { from: 'int', to: 'sin' }, { from: 'sin', to: 'mgl' },
            ],
          },
        },
        sink('angle', 600, 98, 'rad'), sink('speed', 600, 30, 'rad/s'),
        sink('V', 330, 20, 'V'),
      ],
      wires: [
        { from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'motor' }, { from: 'load', to: 'motor:1' }, { from: 'ctrl', to: 'V' },
        { from: 'motor', to: 'angle' }, { from: 'motor:1', to: 'speed' }, { from: 'motor', to: 'ctrl:1' },
      ],
    },
    views: [{
      name: 'Arm', kind: '2d', view: [-1.1, -1.05, 1.1, 1.0],
      shapes: [
        { type: 'circle', cx: 0, cy: 0, r: 0.75, fill: 'panel', stroke: 'muted', lineWidth: 2 },
        ...ticks(0.75),
        { type: 'group', angle: 'r', shapes: [{ type: 'line', x1: 0, y1: -0.8, x2: 0, y2: -0.95, stroke: 'ch1', lineWidth: 5 }] },
        { type: 'group', angle: 'angle', shapes: [
          { type: 'line', x1: 0, y1: 0, x2: 0, y2: -0.6, stroke: 'ch2', lineWidth: 7 },
          { type: 'circle', cx: 0, cy: -0.6, r: 0.11, fill: 'ch2' },
        ] },
        { type: 'circle', cx: 0, cy: 0, r: 0.12, fill: 'ink' },
        { type: 'text', x: 0, y: 0.9, text: 'angle {angle:5.2} rad   r {r:4.1} rad   V {V:5.1} V   load {load:4.2} N·m', size: 13 },
      ],
    }],
  },
  {
    name: 'HIL: an external plant',
    summary: 'A plant outside the page, connected live (hardware in the loop); the page knows only its interface. Download and run the plant, connect, then identify and tune it: working with a plant you cannot see.',
    notes: 'The plant runs outside this page, in real time, and the page knows only its interface: the inputs and outputs it describes when it connects (names, units, full scales, hard ranges), shown in the Plant tab under Interface. What is inside is a black box to be identified before tuning (Identify, to come). The downloadable example plant happens to simulate a DC motor swinging an arm (its physics varied by up to 15 %), which this page does not know. Step by step: 1. Plant tab, Download the plant (zip); unzip it and run runme.sh (Linux, macOS) or double-click runme.cmd (Windows), which install what it needs; a window with a red STOP opens and says where the plant listens. 2. Plant tab, Connect: the External block takes the plant\'s ports, nothing moves, the scope says CONNECTED. 3. Run: r ramps to its first value (at most 10 % of full scale per second), then the loop runs; each channel spans its full scale. The controller is a first guess (a P on the first output), to change in the Controller tab while it runs. Stop stops the plant, Single runs one sweep; E-STOP (header, key E) or STOP in the plant window stops it until Reset (a STOP pressed at the plant is reset there), and so does an output beyond its hard range. Save, Live record keeps the last minutes. Help (?), Live and For agents, has all of it.',
    signals: {
      r: { period: PERIOD, components: [{ type: 'square', params: { amplitude: 1.5, time: 0.5, width: 2.5, period: 5, count: 0 } }] },
    },
    scope: { channels: channels('r', 'angle', 'V', 'current') },
    ui: { ...ui('Interface'), run: 'stop', setup: 0.42 },
    diagram: {
      blocks: [
        src('r', 30, 106, 'rad'),
        ctrl(130, 100, 2, 0.01, [
          { name: 'P, a first guess', type: 'pid', params: { Kp: 2, umin: -12, umax: 12 } },
          { name: 'Off', type: 'off', params: {} },
        ]),
        {
          id: 'plant', type: 'external', name: 'plant', x: 340, y: 96,
          params: {
            url: 'ws://127.0.0.1:8765', rate: 100,
            inputs: ['V'], inUnits: ['V'], min: [-12], max: [12], safe: [0], kinds: ['effort'], measures: [''],
            outputs: ['angle', 'speed', 'current'], outUnits: ['rad', 'rad/s', 'A'], outMin: [-Math.PI, -120, -12], outMax: [Math.PI, 120, 12],
            ymin: [-2.5, -60, -10], ymax: [2.5, 60, 10],
            ramp: 10,
          },
        },
        sink('angle', 600, 98, 'rad'), sink('speed', 600, 134, 'rad/s'), sink('current', 600, 170, 'A'),
        sink('V', 330, 20, 'V'),
      ],
      wires: [
        { from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'plant' }, { from: 'ctrl', to: 'V' },
        { from: 'plant', to: 'angle' }, { from: 'plant:1', to: 'speed' }, { from: 'plant:2', to: 'current' }, { from: 'plant', to: 'ctrl:1' },
      ],
    },
    views: [],
  },
  {
    name: 'HIL: an external plant, reference mode',
    summary: 'An external plant that runs its own controller; the page only sends references and records. Start the plant in reference mode, connect and run: logging a plant that controls itself.',
    notes: 'An external plant in reference mode: it runs its own controller, with its own limits and monitoring; this page only sends the reference r and records what comes back, the plant\'s own control effort included. The page knows only the interface the plant describes (Plant tab, Interface); what is inside is a black box, identified from what it reports. For logging, and for a plant that controls itself; the page\'s controllers and Auto-tune are not in the loop. Start the example plant with sh runme.sh --mode reference (or runme.cmd --mode reference); then Plant tab, Connect, and Run. Everything else as in HIL: an external plant; Help (?), Live.',
    signals: {
      r: { period: PERIOD, components: [{ type: 'square', params: { amplitude: 1.5, time: 0.5, width: 2.5, period: 5, count: 0 } }] },
    },
    scope: { channels: channels('r', 'angle', 'V', 'current') },
    ui: { ...ui('Interface'), run: 'stop', setup: 0.42 },
    tags: [{ label: 'Reference mode', kind: 'feature' }],
    diagram: {
      blocks: [
        src('r', 60, 110, 'rad'),
        {
          id: 'plant', type: 'external', name: 'plant', x: 240, y: 96,
          params: {
            url: 'ws://127.0.0.1:8765', rate: 100,
            inputs: ['r'], inUnits: ['rad'], min: [-3], max: [3], safe: [0], kinds: ['reference'], measures: ['angle'],
            outputs: ['angle', 'speed', 'current', 'V'], outUnits: ['rad', 'rad/s', 'A', 'V'], outMin: [-Math.PI, -120, -12, -12], outMax: [Math.PI, 120, 12, 12],
            ymin: [-2.5, -60, -10, null], ymax: [2.5, 60, 10, null], outKinds: ['measurement', 'measurement', 'measurement', 'effort'],
            ramp: 10,
          },
        },
        sink('angle', 500, 98, 'rad'), sink('speed', 500, 134, 'rad/s'), sink('current', 500, 170, 'A'), sink('V', 500, 206, 'V'),
      ],
      wires: [
        { from: 'r', to: 'plant' },
        { from: 'plant', to: 'angle' }, { from: 'plant:1', to: 'speed' }, { from: 'plant:2', to: 'current' }, { from: 'plant:3', to: 'V' },
      ],
    },
    views: [],
  },
];


const phys = (name, at, unit, same) => ({ name, at, unit, ...(same ? { same } : {}) });
const MOTOR_PHYSICS = [
  phys('R', 'motor/arm.den[1]', 'Ω'), phys('L', 'motor/arm.den[0]', 'H'), phys('Kt', 'motor/kt.K', 'N·m/A'), phys('Ke', 'motor/ke.K', 'V·s/rad', 'Kt'),
  phys('J', 'motor/rotor.den[0]', 'kg·m²'), phys('b', 'motor/rotor.den[1]', 'N·m·s/rad'),
];
const SIMULATOR = {
  'Mass–spring–damper': { physics: [phys('1/m', 'm.K', '1/kg'), phys('c', 'c.K', 'N·s/m'), phys('k', 'k.K', 'N/m')] },
  'DC motor, position control': { physics: MOTOR_PHYSICS },
  'Following a sine (XY)': { physics: MOTOR_PHYSICS },
  'DC motor, sliding mode': { physics: MOTOR_PHYSICS },
  'Encoder errors and torque ripple': {
    physics: [phys('1/R', 'motor/arm.K', 'A/V'), phys('L/R', 'motor/arm.tau', 's'), phys('Kt', 'motor/kt.K', 'N·m/A'), phys('Ke', 'motor/ke.K', 'V·s/rad', 'Kt'),
      phys('1/b', 'motor/mech.K', 'rad/(N·m·s)'), phys('J/b', 'motor/mech.tau', 's'), phys('ωn', 'shaft.wn', 'rad/s'), phys('ζ', 'shaft.zeta', '1')],
    effects: [{ name: 'torque ripple', at: 'ripple', off: 'zero' }, { name: 'torque noise', at: 'rough', off: 'pass' }, { name: 'shaft resonance', at: 'shaft', off: 'pass' }, { name: 'encoder errors', at: 'enc', off: 'pass' }],
  },
  'Conical tank, gain scheduling': {
    physics: [phys('r0', 'tank.r0', 'm'), phys('R', 'tank.R', 'm'), phys('H', 'tank.H', 'm'), phys('a', 'tank.a', 'm²'), phys('Td', 'pipe.L', 's')],
    effects: [{ name: 'pipe dead time', at: 'pipe', off: 'pass' }],
    ports: { h: { scale: [0, 1.2], hard: [0, 1] } },
  },
  'Pendulum swing-up': { physics: [phys('M', 'cart.M', 'kg'), phys('m', 'cart.m', 'kg'), phys('l', 'cart.l', 'm'), phys('b', 'cart.b', 'N·s/m')] },
  'Triple pendulum': {
    physics: [phys('M', 'cart.M', 'kg'), ...[1, 2, 3].flatMap((i) => [phys(`m${i}`, `cart.m${i}`, 'kg'), phys(`l${i}`, `cart.l${i}`, 'm')]), phys('b', 'cart.b', 'N·s/m')],
  },
  'Oven, badly tuned': {
    physics: [phys('heater τ', 'heater.tau', 's'), phys('K', 'oven.K', '1'), phys('τ', 'oven.tau', 's'), phys('Td', 'lag.L', 's'), phys('sensor τ', 'tc.tau', 's')],
    effects: [{ name: 'thermocouple lag', at: 'tc', off: 'pass' }],
    ports: { T: { scale: [0, 120], hard: [-10, 95] } },
  },
  'DC motor with an unbalanced arm': {
    physics: [phys('R', 'motor/arm.den[1]', 'Ω'), phys('L', 'motor/arm.den[0]', 'H'), phys('K', 'motor/kt.K', 'N·m/A'), phys('Ke', 'motor/ke.K', 'V·s/rad', 'K'),
      phys('J', 'motor/rotor.den[0]', 'kg·m²'), phys('b', 'motor/rotor.den[1]', 'N·m·s/rad'), phys('Tc', 'motor/tc.K', 'N·m'), phys('mgl', 'motor/mgl.K', 'N·m')],
    effects: [{ name: 'Coulomb friction', at: 'motor/sgn', off: 'zero' }],
    ports: {
      angle: { scale: [-Math.PI, Math.PI], hard: [-2.5, 2.5] }, speed: { scale: [-120, 120], hard: [-60, 60] }, current: { scale: [-12, 12], hard: [-10, 10] },
      r: { scale: [-3, 3] }, load: { scale: [-0.2, 0.2] },
    },
  },
};
for (const e of EXAMPLE_PLANTS) Object.assign(e, SIMULATOR[e.name] ?? {});

const EMPTY_PLANT = { blocks: [src('r', 60, 104, '1')], wires: [] };

return { EXAMPLE_PLANTS, EMPTY_PLANT };
})();
// ---- core/views.js
__mods['core/views.js'] = (() => {

const { compileExpr } = __mods['core/expr.js'];
const ATTRS = {
  line: ['x1', 'y1', 'x2', 'y2'], arrow: ['x1', 'y1', 'x2', 'y2'],
  rect: ['x', 'y', 'w', 'h', 'angle'], circle: ['cx', 'cy', 'r'],
  spring: ['x1', 'y1', 'x2', 'y2', 'width', 'coils'], damper: ['x1', 'y1', 'x2', 'y2', 'width'],
  ground: ['x1', 'x2', 'y'], text: ['x', 'y', 'size'], group: ['x', 'y', 'angle'], polygon: [],
};

function placeholder(src, where) {
  const m = /^(.*?):(\d*)\.?(\d*)$/.exec(src);
  const f = value(m ? m[1] : src, where);
  if (!m || (m[2] === '' && m[3] === '')) return (env) => fmt(f(env));
  const w = Number(m[2] || 0), d = Number(m[3] || 0);
  return (env) => { const v = f(env); return (Number.isFinite(v) ? v.toFixed(d) : '—').padStart(w, '\u2007'); };
}

function value(v, where) {
  if (typeof v === 'number') { const n = v; return () => n; }
  if (typeof v === 'string') {
    try { return compileExpr(v, { vars: true }); } catch (e) { throw new Error(`${where}: ${e.message}`); }
  }
  return () => 0;
}

function template(src, where) {
  return String(src).split(/(\{[^}]*\})/).map((part) => (part.startsWith('{') ? placeholder(part.slice(1, -1), where) : part));
}

function normalizeSvgView(v, path) {
  const svg = String(v.svg ?? '').trim();
  if (!/^<svg[\s>/]/i.test(svg)) throw new Error(`${path}.svg: an SVG document, starting with <svg`);
  const bind = (v.bind ?? []).map((b, i) => {
    const where = `${path}.bind[${i}]`;
    if (!b?.select || typeof b.select !== 'string') throw new Error(`${where}.select: a CSS selector such as #cart`);
    const attr = String(b.attr ?? '');
    if (!/^[A-Za-z][\w:-]*$/.test(attr) || /^on/i.test(attr) || /href$/i.test(attr)) throw new Error(`${where}.attr: an attribute such as transform, x, fill, or "text"; not an event or link`);
    template(b.value ?? '', `${where}.value`);
    return { select: b.select, attr, value: String(b.value ?? '') };
  });
  return { name: String(v.name ?? 'SVG view'), kind: 'svg', svg, bind };
}

function compileBindings(view) {
  const list = view.bind.map((b) => ({ ...b, parts: String(b.value).split(/(\{[^}]*\})/).map((part) => (part.startsWith('{') ? value(part.slice(1, -1), 'bind') : part)) }));
  return (env) => list.map(({ select, attr, parts }) => ({ select, attr, value: parts.map((p) => (typeof p === 'string' ? p : fmtAttr(p(env)))).join('') }));
}
const fmtAttr = (v) => (Number.isFinite(v) ? String(Number(v.toPrecision(6))) : '0');

function normalizeView(v, path = 'views[0]') {
  if (!v || typeof v !== 'object') throw new Error(`${path}: a view is an object`);
  if (v.kind === 'svg') return normalizeSvgView(v, path);
  if (v.kind !== '2d') throw new Error(`${path}.kind: "2d" (shapes) or "svg" (an SVG drawing with bindings)`);
  const box = v.view ?? [-1, -1, 1, 1];
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite) || box[2] <= box[0] || box[3] <= box[1]) throw new Error(`${path}.view: [xmin, ymin, xmax, ymax]`);
  const check = (shapes, p) => {
    if (!Array.isArray(shapes)) throw new Error(`${p}: "shapes" is a list`);
    shapes.forEach((s, i) => {
      const where = `${p}[${i}]`;
      if (!ATTRS[s?.type]) throw new Error(`${where}.type: one of ${Object.keys(ATTRS).join(', ')}`);
      for (const a of ATTRS[s.type]) if (s[a] !== undefined) value(s[a], `${where}.${a}`);
      if (s.type === 'polygon') {
        if (!Array.isArray(s.points) || s.points.length < 2 || !s.points.every((q) => Array.isArray(q) && q.length === 2)) throw new Error(`${where}.points: a list of [x, y] pairs`);
        s.points.forEach((q, j) => q.forEach((c) => value(c, `${where}.points[${j}]`)));
      }
      if (s.type === 'text') template(s.text ?? '', `${where}.text`);
      if (s.type === 'group') check(s.shapes ?? [], `${where}.shapes`);
    });
  };
  check(v.shapes ?? [], `${path}.shapes`);
  return { name: String(v.name ?? '2D view'), kind: '2d', view: box.map(Number), shapes: structuredClone(v.shapes ?? []) };
}

function compileScene(view) {
  const build = (shapes) => shapes.map((s) => {
    const f = {};
    for (const a of ATTRS[s.type]) f[a] = s[a] === undefined ? null : value(s[a], s.type);
    const parts = s.type === 'text' ? template(s.text ?? '', 'text') : null;
    const pts = s.type === 'polygon' ? s.points.map(([x, y]) => [value(x, 'polygon'), value(y, 'polygon')]) : null;
    return { s, f, parts, pts, kids: s.type === 'group' ? build(s.shapes ?? []) : null };
  });
  const tree = build(view.shapes);
  return (env) => {
    const ops = [];
    const walk = (nodes, T) => {
      for (const { s, f, parts, pts, kids } of nodes) {
        const g = (a, d = 0) => (f[a] ? f[a](env) : d);
        const style = { stroke: s.stroke ?? 'ink', fill: s.fill ?? 'none', width: Number(s.lineWidth ?? 2) };
        const P = (x, y) => T(x, y);
        switch (s.type) {
          case 'group': {
            const tx = g('x'), ty = g('y'), a = g('angle'), c = Math.cos(a), sn = Math.sin(a);
            walk(kids, (x, y) => T(tx + c * x - sn * y, ty + sn * x + c * y));
            break;
          }
          case 'line': case 'arrow': {
            const p = P(g('x1'), g('y1')), q = P(g('x2'), g('y2'));
            ops.push({ op: s.type, pts: [p, q], ...style });
            break;
          }
          case 'rect': {
            const x = g('x'), y = g('y'), w = g('w'), h = g('h'), a = g('angle');
            const cx = x + w / 2, cy = y + h / 2, c = Math.cos(a), sn = Math.sin(a);
            const corner = (dx, dy) => P(cx + c * dx - sn * dy, cy + sn * dx + c * dy);
            ops.push({ op: 'poly', closed: true, pts: [corner(-w / 2, -h / 2), corner(w / 2, -h / 2), corner(w / 2, h / 2), corner(-w / 2, h / 2)], ...style, fill: s.fill ?? 'panel' });
            break;
          }
          case 'circle': {
            const c = P(g('cx'), g('cy')), r = g('r', 0.05);
            const e = P(g('cx') + r, g('cy'));
            ops.push({ op: 'circle', c, r: Math.hypot(e[0] - c[0], e[1] - c[1]), ...style, fill: s.fill ?? 'panel' });
            break;
          }
          case 'spring': case 'damper': {
            const x1 = g('x1'), y1 = g('y1'), x2 = g('x2'), y2 = g('y2'), w = g('width', 0.06);
            const L = Math.hypot(x2 - x1, y2 - y1) || 1e-9, ux = (x2 - x1) / L, uy = (y2 - y1) / L, nx = -uy, ny = ux;
            const at = (s1, o) => P(x1 + ux * s1 + nx * o, y1 + uy * s1 + ny * o);
            if (s.type === 'spring') {
              const n = Math.max(2, Math.round(g('coils', 6))) * 2, lead = Math.min(0.1 * L, 0.03);
              const pts = [at(0, 0), at(lead, 0)];
              for (let i = 1; i < n; i++) pts.push(at(lead + ((L - 2 * lead) * i) / n, (i % 2 ? 1 : -1) * w / 2));
              pts.push(at(L - lead, 0), at(L, 0));
              ops.push({ op: 'poly', closed: false, pts, ...style, fill: 'none', width: Number(s.lineWidth ?? 1.6) });
            } else {
              const mid = L / 2, cyl = Math.max(0.25 * L, 0.04);
              ops.push({ op: 'poly', closed: false, pts: [at(0, 0), at(mid - cyl / 2, 0)], ...style, fill: 'none' });
              ops.push({ op: 'poly', closed: false, pts: [at(mid + cyl / 2, w / 2), at(mid - cyl / 2, w / 2), at(mid - cyl / 2, -w / 2), at(mid + cyl / 2, -w / 2)], ...style, fill: 'none' });
              ops.push({ op: 'poly', closed: false, pts: [at(mid - cyl / 6, w / 2.6), at(mid - cyl / 6, -w / 2.6)], ...style, fill: 'none' });
              ops.push({ op: 'poly', closed: false, pts: [at(mid - cyl / 6, 0), at(L, 0)], ...style, fill: 'none' });
            }
            break;
          }
          case 'ground': {
            const x1 = g('x1'), x2 = g('x2'), y = g('y');
            ops.push({ op: 'poly', closed: false, pts: [P(x1, y), P(x2, y)], ...style, fill: 'none' });
            const step = (x2 - x1) / 24, dir = s.side === 'above' ? 1 : -1;
            for (let x = x1 + step / 2; x < x2; x += step) ops.push({ op: 'poly', closed: false, pts: [P(x, y), P(x - step * 0.8, y + dir * step * 0.8)], ...style, stroke: 'muted', width: 1, fill: 'none' });
            break;
          }
          case 'polygon':
            ops.push({ op: 'poly', closed: true, pts: pts.map(([x, y]) => P(x(env), y(env))), ...style, fill: s.fill ?? 'panel' });
            break;
          case 'text': {
            const text = parts.map((p) => (typeof p === 'string' ? p : p(env))).join('');
            ops.push({ op: 'text', at: P(g('x'), g('y')), text, size: g('size', 13), fill: s.fill ?? 'ink', anchor: ['start', 'end'].includes(s.anchor) ? s.anchor : 'middle' });
            break;
          }
          default:
        }
      }
    };
    walk(tree, (x, y) => [x, y]);
    return ops;
  };
}

function fmt(v) {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  return a !== 0 && (a >= 1e5 || a < 1e-3) ? v.toExponential(2) : String(Number(v.toPrecision(3)));
}

return { compileBindings, normalizeView, compileScene };
})();
// ---- core/project.js
__mods['core/project.js'] = (() => {

const { SLOTS, normalizeBlock } = __mods['core/blocks.js'];
const { normalizeReference, migrateReferenceBlock, referenceFn, sampleSignal } = __mods['core/signals.js'];
const { ceil125 } = __mods['core/scale.js'];
const { simulate, simulateSystem } = __mods['core/sim.js'];
const { computeMetrics } = __mods['core/metrics.js'];
const { normalizeGoal, evaluateGoal, compareEvals } = __mods['core/goal.js'];
const { normalizeDiagram, diagramNames, compileDiagram } = __mods['core/diagram.js'];
const { normalizeView } = __mods['core/views.js'];
const { DesignError, parseOp, operatingPoint, linearize } = __mods['core/linearize.js'];
const { CONTROLLERS } = __mods['core/controllers.js'];
const { parseSpeed, speedToJson } = __mods['core/speed.js'];
const FORMAT = 'loop-tuner/2';
const PALETTE_SIZE = 8;
const LOOP_SIGNALS = ['y', 'u', 'e', 'ym', 'd'];

const SYSTEM_DEFAULTS = {
  actuator: { type: 'ideal' },
  disturbance: { type: 'none' },
  sensor: { type: 'ideal' },
  noise: { type: 'none' },
};
const BLOCK_SLOTS = ['actuator', 'disturbance', 'plant', 'sensor', 'noise'];
const CANDIDATE_KEYS = new Set(['name', 'checked', 'color', 'note', 'controller', ...BLOCK_SLOTS]);

function normalizeProject(p) {
  if (!p || typeof p !== 'object') throw new Error('project must be a JSON object');
  const v1 = p.format === 'loop-tuner/1' || (p.system?.reference && typeof p.system.reference.type === 'string');
  const sim = {};
  if (p.sim?.sampleTime !== undefined) {
    sim.sampleTime = Number(p.sim.sampleTime);
    if (!(sim.sampleTime > 0)) throw new Error('sim.sampleTime must be > 0');
  } else if (v1) sim.sampleTime = 0.01;
  const v1Duration = Number(p.sim?.duration ?? 20);
  const v1Period = 10 * ceil125(v1Duration / 10);
  const signals = {};
  if (v1) signals.r = normalizeReference(migrateReferenceBlock(p.system?.reference ?? { type: 'step' }, v1Duration, v1Period));
  else if (p.system?.signals) for (const [name, ref] of Object.entries(p.system.signals)) signals[checkName(name)] = normalizeReference(ref);
  else if (p.system?.reference) {
    signals.r = normalizeReference(p.system.reference);
    if (p.system.reference.period === undefined && p.sim?.duration) signals.r.period = Number(p.sim.duration);
  }
  const system = { signals };
  for (const [slot, def] of Object.entries(SYSTEM_DEFAULTS)) system[slot] = normalizeBlock(slot, p.system?.[slot] ?? def);
  const plant = p.system?.plant ?? (v1 ? { type: 'firstOrder' } : null);
  system.plant = plant ? normalizePlant(plant) : null;
  if (system.plant?.type === 'diagram') {
    const { sources } = diagramNames(system.plant.diagram);
    for (const name of sources) signals[name] ??= normalizeReference({ period: 1, components: [] });
    for (const name of Object.keys(signals)) if (!sources.includes(name) && (sources.length || name !== 'r')) delete signals[name];
  }
  if (!Object.keys(signals).length) signals.r = normalizeReference({ period: 1, components: [] });
  const goal = normalizeGoal(p.goal);
  const raw = Array.isArray(p.candidates) ? p.candidates : [];
  const candidates = raw.map((c, i) => {
    for (const k of Object.keys(c)) if (!CANDIDATE_KEYS.has(k)) throw new Error(`candidates[${i}]: unknown key "${k}"`);
    const out = {
      name: String(c.name ?? `#${i + 1}`),
      checked: c.checked !== false,
      color: Number.isInteger(c.color) ? c.color % PALETTE_SIZE : null,
      controller: normalizeBlock('controller', c.controller ?? { type: 'PID' }),
    };
    if (c.note) out.note = String(c.note);
    for (const k of BLOCK_SLOTS) if (c[k]) out[k] = k === 'plant' ? normalizePlant(c[k]) : normalizeBlock(k, c[k]);
    return out;
  });
  for (const c of candidates) if (c.color === null) c.color = nextColor(candidates);
  return {
    format: FORMAT,
    title: String(p.title ?? 'Untitled loop'),
    ...(p.notes ? { notes: String(p.notes) } : {}),
    sim, system, scope: pruneChannels(normalizeScope(p.scope, longestPeriod(signals), candidates.length > 0 && !!system.plant), { system, candidates }), goal, candidates,
    ...(Array.isArray(p.library) && p.library.length ? { library: p.library.map(normalizeLibraryEntry) } : {}),
    ...(p.selected !== undefined ? { selected: String(p.selected) } : {}),
    ...(normalizeUi(p.ui) ? { ui: normalizeUi(p.ui) } : {}),
  };
}

const UI_RUN = ['run', 'stop', 'single'];
const UI_TABS = ['input', 'plant', 'controller', 'tune', 'analysis'];
function normalizeUi(ui) {
  if (!ui || typeof ui !== 'object') return null;
  const out = {};
  if (UI_RUN.includes(ui.run)) out.run = ui.run;
  if (UI_TABS.includes(ui.tab)) out.tab = ui.tab;
  if (typeof ui.view === 'string' && ui.view) out.view = ui.view;
  if (Number.isFinite(ui.setup) && ui.setup > 0 && ui.setup < 1) out.setup = ui.setup;
  const speed = parseSpeed(ui.speed);
  if (speed !== null) out.speed = speedToJson(speed);
  return Object.keys(out).length ? out : null;
}

function checkName(name) {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,11}$/.test(name)) throw new Error(`signal name "${name}": letters, digits and _, starting with a letter`);
  return name;
}

const longestPeriod = (signals) => Math.max(...Object.values(signals).map((s) => s.period));

function normalizePlant(plant) {
  if (plant.type === 'diagram') {
    const out = { type: 'diagram', diagram: normalizeDiagram(plant.diagram) };
    if (Array.isArray(plant.views) && plant.views.length) out.views = plant.views.map((v, i) => normalizeView(v, `plant.views[${i}]`));
    return out;
  }
  return normalizeBlock('plant', plant);
}

function normalizeLibraryEntry(e, i) {
  if (!e?.name) throw new Error(`library[${i}]: needs a name`);
  const d = normalizeDiagram({ blocks: [{ ...e.block, id: 'x', x: 0, y: 0 }], wires: [] }, `library[${i}]`);
  const { id, x, y, ...block } = d.blocks[0];
  void id; void x; void y;
  return { name: String(e.name), block };
}

function defaultSampleTime(duration) {
  return Number((duration / 2000).toPrecision(2));
}

const MAX_SAMPLES = 200000;

function simOf(project) {
  const tb = project.scope.timebase;
  const duration = Math.max(tb.position + 10 * tb.scale, tb.scale);
  return { duration, sampleTime: project.sim.sampleTime ?? defaultSampleTime(duration) };
}

function autoTimebase(project) {
  return { scale: ceil125(longestPeriod(project.system.signals) / 10), position: 0 };
}

function fitChannel(values) {
  let lo = Infinity, hi = -Infinity;
  for (const x of values) if (Number.isFinite(x)) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
  if (!Number.isFinite(lo)) return null;
  const span = hi - lo || Math.abs(hi) || 1;
  const scale = ceil125(span / 6);
  const offset = Number((-Math.round((hi + lo) / 2 / scale) * scale).toPrecision(6)) || 0;
  return { scale, offset };
}

const DEFAULT_CHANNELS = [
  { source: 'r', on: true, scale: 0.2, offset: 0 },
  { source: '', on: false, scale: 0.2, offset: 0 },
  { source: '', on: false, scale: 0.5, offset: 0 },
  { source: '', on: false, scale: 0.2, offset: 0 },
];
const LOOP_CHANNELS = ['r', 'y', 'u', 'e'];

function normalizeScope(scope = {}, period, loop = false) {
  const tb = scope.timebase ?? {};
  const timebase = { scale: Number(tb.scale ?? ceil125(period / 10)), position: Number(tb.position ?? 0) };
  if (!(timebase.scale > 0)) throw new Error('scope.timebase.scale must be > 0');
  const channels = DEFAULT_CHANNELS.map((d, i) => {
    const c = scope.channels?.[i] ?? {};
    const ch = { source: c.source ?? (loop ? LOOP_CHANNELS[i] : d.source), on: c.on ?? (loop || d.on), scale: Number(c.scale ?? d.scale), offset: Number(c.offset ?? d.offset) };
    if (ch.source !== '' && !/^[A-Za-z][A-Za-z0-9_]{0,11}$/.test(ch.source)) throw new Error(`scope.channels[${i}].source: a signal name such as r, y1 or u, or "" for none`);
    if (ch.source === '') ch.on = false;
    if (!(ch.scale > 0) || !Number.isFinite(ch.offset)) throw new Error(`scope.channels[${i}]: scale must be > 0 and offset a number`);
    ch.on = !!ch.on;
    const f = normalizeFilter(c.filter, `scope.channels[${i}].filter`);
    if (f) ch.filter = f;
    if (c.measure === true) ch.measure = true;
    return ch;
  });
  const view = normalizeScopeView(scope.view);
  return { timebase, channels, ...(view ? { view } : {}) };
}

const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch'];
function normalizeFilter(f, where) {
  if (!f || !FILTER_TYPES.includes(f.type)) return null;
  const f0 = Number(f.f0), order = [2, 4, 6, 8].includes(Number(f.order)) ? Number(f.order) : 2, q = Number(f.q ?? Math.SQRT1_2);
  if (!(f0 > 0)) throw new Error(`${where}.f0: a frequency above 0 Hz`);
  if (!(q > 0)) throw new Error(`${where}.q: above 0`);
  return { type: f.type, f0, order, q };
}

const VIEW_MODES = ['time', 'fft', 'spectrogram', 'xy'];
function normalizeScopeView(v) {
  if (!v || typeof v !== 'object') return null;
  const out = {};
  if (VIEW_MODES.includes(v.mode) && v.mode !== 'time') out.mode = v.mode;
  if (Number.isInteger(v.right) && v.right >= 0 && v.right < 4) out.right = v.right;
  const fmin = Number(v.fmin), fmax = Number(v.fmax);
  if (fmin >= 0 && fmax > fmin) { out.fmin = fmin; out.fmax = fmax; }
  if (v.db === false) out.db = false;
  if (v.delta === true) out.delta = true;
  if ([64, 128, 256, 512, 1024].includes(Number(v.size))) out.size = Number(v.size);
  const levels = normalizeLevels(v.levels);
  if (levels) out.levels = levels;
  if (v.aboveNoise === true) out.aboveNoise = true;
  const noiseLevels = normalizeLevels(v.noiseLevels);
  if (noiseLevels) out.noiseLevels = noiseLevels;
  return Object.keys(out).length ? out : null;
}

function normalizeLevels(l) {
  if (!l || typeof l !== 'object' || Array.isArray(l)) return null;
  const out = {};
  for (const [name, pair] of Object.entries(l)) {
    const lv = normalizeLevelPair(pair);
    if (name && name !== '__proto__' && lv) out[name] = lv;
  }
  return Object.keys(out).length ? out : null;
}
function normalizeLevelPair(l) {
  if (!Array.isArray(l) || l.length !== 2 || l.some((x) => typeof x !== 'number')) return null;
  const [a, b] = l.map((x) => Math.round(x * 10) / 10).sort((x, y) => x - y);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b - a < 1 || a < -300 || b > 300) return null;
  return [a, b];
}

const levelsKey = (aboveNoise) => (aboveNoise ? 'noiseLevels' : 'levels');
function withLevels(view, source, pair, aboveNoise = !!view?.aboveNoise) {
  const key = levelsKey(aboveNoise), levels = { ...(view?.[key] ?? {}) };
  if (pair) levels[source] = pair; else delete levels[source];
  const out = { ...(view ?? {}), [key]: levels };
  if (!Object.keys(levels).length) delete out[key];
  return out;
}
function levelsOf(view, source, aboveNoise = !!view?.aboveNoise) {
  const l = view?.[levelsKey(aboveNoise)];
  return l && Object.hasOwn(l, source) ? l[source] : null;
}
function withAboveNoise(view, on) {
  const out = { ...(view ?? {}) };
  if (on) out.aboveNoise = true; else delete out.aboveNoise;
  return out;
}

function channelNames(project) {
  const plant = project.system.plant;
  const n = plant?.type === 'diagram' ? diagramNames(plant.diagram) : { sources: [], sinks: [] };
  return [...new Set([...Object.keys(project.system.signals), ...n.sinks, ...(loopReady(project) ? LOOP_SIGNALS : [])])];
}

function pruneChannels(scope, project) {
  const names = channelNames(project);
  for (const ch of scope.channels) if (ch.source && !names.includes(ch.source)) { ch.source = ''; ch.on = false; }
  return scope;
}

function evaluateOpenLoop(project) {
  const loop = resolveLoop(project, { controller: null });
  return simulate(loop, simOf(project), { openLoop: true });
}

function loopReady(project) {
  const plant = project.system.plant;
  if (plant?.type === 'diagram' && diagramNames(plant.diagram).sources.length) return false;
  return !!plant && project.candidates.length > 0;
}

function referenceTrace(project, name = 'r') {
  const sim = simOf(project);
  const ref = project.system.signals[name] ?? { period: 1, components: [] };
  const { t, v } = sampleSignal(referenceFn(ref, sim), sim);
  return { t, r: v };
}

function evaluateSystem(project, { designs } = {}) {
  const plant = project.system.plant;
  const sim = simOf(project);
  if (plant?.type !== 'diagram') {
    const signals = {};
    for (const name of Object.keys(project.system.signals)) signals[name] = referenceTrace(project, name).r;
    return { t: referenceTrace(project).t, signals, info: { warnings: [], designs: [] } };
  }
  return simulateSystem(plant.diagram, project.system.signals, sim, { designs });
}

function designSystem(project, { designs } = {}) {
  const plant = project.system.plant;
  if (plant?.type !== 'diagram') return [];
  return compileDiagram(plant.diagram, 'plant', { standalone: true, designs }).designs ?? [];
}


function blockModel(project, idPath, at, { designs, limits } = {}) {
  const plant = project.system.plant;
  if (plant?.type !== 'diagram') throw new DesignError('no-diagram', 'the plant is not a block diagram, so no block sees a plant in it', 'build the plant in the Plant tab, or load a system from the System library');
  const diagram = plant.diagram, id = Array.isArray(idPath) ? idPath.join('/') : String(idPath);
  const parts = id.split('/');
  const level = parts.slice(0, -1).reduce((d, x) => d?.blocks.find((b) => b.id === x && b.type === 'subsystem')?.diagram, diagram);
  const block = level?.blocks.find((b) => b.id === parts.at(-1));
  if (!block || (block.type !== 'controller' && block.type !== 'observer')) throw new DesignError('no-block', `no Controller or Observer "${id}" in the plant`, 'name a block by its id path, as motor/ctrl');
  const op = parseOp(at);
  const store = designs;
  let statuses, snap = null;
  if (op.kind === 't') {
    const sim = simOf(project);
    const run = simulateSystem(diagram, project.system.signals, { ...sim, duration: Math.max(sim.duration, op.t) }, { designs: store, until: op.t });
    snap = run.snapshot;
    if (!snap) throw new DesignError('diverged', `the run diverges before t = ${op.t} s: there is no state to linearise at`, 'pick an earlier time, or steady the loop first');
    statuses = run.info.designs;
  } else statuses = compileDiagram(diagram, 'plant', { standalone: true, sources: {}, designs: store }).designs;
  const seeThrough = new Map();
  for (const s of statuses) if (s.path !== id && s.values?.stateIndex) seeThrough.set(s.path, s.values.stateIndex);
  const el = compileDiagram(structuredClone(diagram), 'plant', { mode: 'model' });
  const model = el.seen(id, { ...(seeThrough.size ? { seeThrough } : {}), ...(snap ? { X: snap.X, held: snap.held, sources: snap.sources, t: snap.t } : {}) });
  const v = block.variants?.[block.variant ?? 0]?.params ?? {};
  const lim = limits ?? { umin: v.umin ?? -Infinity, umax: v.umax ?? Infinity };
  const pt = snap ? operatingPoint(model, { kind: 't', t: snap.t, u: block.type === 'observer' ? snap.inputs[id]?.[0] ?? 0 : snap.held[id] ?? 0 }, lim) : operatingPoint(model, op, lim);
  return { model, pt, statuses, block, id, snap };
}

function linearizeBlock(project, idPath, at = 'origin', opts = {}) {
  const { model, pt, block, id, snap } = blockModel(project, idPath, at, opts);
  return Object.assign(linearize(model, pt), { idPath: id, Ts: block.params.Ts, ...(snap ? { t: snap.t } : {}) });
}

function loopModel(project, idPath, at = 'origin', { designs } = {}) {
  const { model, pt, statuses, block, id, snap } = blockModel(project, idPath, at, { designs });
  if (block.type !== 'controller') throw new DesignError('not-a-controller', `'${block.name ?? block.id}' is an Observer: a loop is cut at a Controller's output`, 'pick the Controller that drives the plant');
  const plant = Object.assign(linearize(model, pt), { idPath: id, Ts: block.params.Ts });
  if (plant.kinks.length) throw new DesignError('kink', `the plant has a kink at ${plant.op.label}: ${plant.kinks[0]}; a linear loop there would show the slope of neither side`, 'pick Start or Scope time (a state of the run), or a level away from the kink');
  const variant = block.variants[block.variant ?? 0], def = CONTROLLERS[variant.type], Ts = block.params.Ts;
  let values = null;
  if (def.designed) {
    const st = statuses.find((s) => s.path === id);
    values = st?.values ?? null;
    if (!values) {
      const why = st?.error ? `: ${st.error.message}` : st?.status === 'pending' || st?.status === 'cancelled' ? ': its plan is not made yet' : '';
      throw new DesignError('no-design', `${variant.name} has no design to analyse${why}`, st?.error?.hint || 'see its Computed box in the Controller tab');
    }
  }
  if (!def.linear) throw new DesignError('no-linear', `${def.label} has no linear model`, 'analyse another variant');
  const t = snap ? snap.t : parseOp(at).kind === 'initial' ? 0 : undefined;
  let ctrl;
  try { ctrl = def.linear(variant.params, Ts, { y: Array.from(plant.op.y), ...(t !== undefined ? { t } : {}) }, values); } catch (err) {
    throw err instanceof DesignError ? err : new DesignError('not-linear', `${variant.name}: ${err.message}`, err.hint ?? 'pick an operating point where the law is linear, such as at rest');
  }
  const warnings = [...plant.warnings];
  if (ctrl.note) warnings.push(ctrl.note);
  const { umin = -Infinity, umax = Infinity } = variant.params, u = plant.op.u, tol = 1e-9 * Math.max(1, Math.abs(u));
  const atLimit = u >= umax - tol || u <= umin + tol;
  if (atLimit) warnings.push(`${plant.input.label} = ${fmt(u)} is at its limit (${fmt(umin)} to ${fmt(umax)}) there: the controller saturates, and the linear loop does not hold`);
  for (const obs of model.through) warnings.push(`the estimates of '${obs}' are read as the states they stand for: the filter's own dynamics are not in this loop`);
  return { plant, ctrl, Ts, opLabel: plant.op.label, variantName: variant.name, type: variant.type, t, atLimit, warnings: [...new Set(warnings)] };
}

function nextColor(candidates) {
  const count = new Array(PALETTE_SIZE).fill(0);
  for (const c of candidates) if (Number.isInteger(c.color)) count[c.color]++;
  let best = 0;
  for (let i = 1; i < PALETTE_SIZE; i++) if (count[i] < count[best]) best = i;
  return best;
}

function resolveLoop(project, cand) {
  const loop = { reference: project.system.signals.r ?? { period: 1, components: [] } };
  for (const s of SLOTS) if (s.key !== 'reference') loop[s.key] = s.key === 'controller' ? cand.controller : (cand[s.key] ?? project.system[s.key]);
  return loop;
}

function evaluateCandidate(project, cand) {
  if (!project.system.plant) throw new Error('the loop has no plant yet; add one in the Plant tab or set system.plant');
  const result = simulate(resolveLoop(project, cand), simOf(project));
  const metrics = computeMetrics(result, { settlingBand: project.goal.settlingBand });
  const evaluation = evaluateGoal(metrics, project.goal);
  return { result, metrics, evaluation };
}

function evaluateProject(project) {
  const runs = project.candidates.map((c) => evaluateCandidate(project, c));
  const rank = runs.map((_, i) => i).sort((a, b) => compareEvals(runs[a].evaluation, runs[b].evaluation));
  return { runs, rank };
}

function findCandidate(project, ref) {
  if (ref === undefined || ref === null) return project.candidates.length - 1;
  const byName = project.candidates.findIndex((c) => c.name === String(ref));
  if (byName >= 0) return byName;
  const i = Number(ref);
  if (Number.isInteger(i) && i >= 0 && i < project.candidates.length) return i;
  throw new Error(`no candidate "${ref}"; candidates: ${project.candidates.map((c) => c.name).join(', ')}`);
}

function uniqueName(project, base) {
  const names = new Set(project.candidates.map((c) => c.name));
  if (!names.has(base)) return base;
  const stem = base.replace(/ \d+$/, '');
  for (let i = 2; ; i++) if (!names.has(`${stem} ${i}`)) return `${stem} ${i}`;
}

const QUIET_DEFAULTS = { b: 1, c: 0, Tf: 0.05 };

function describeController(block) {
  const ps = Object.entries(block.params)
    .filter(([k, v]) => !(k in QUIET_DEFAULTS) || v !== QUIET_DEFAULTS[k])
    .map(([k, v]) => `${k} ${Array.isArray(v) ? `[${v.join(', ')}]` : fmt(v)}`);
  return `${block.type}${ps.length ? ' · ' + ps.join(' · ') : ''}`;
}

function fmt(v, digits = 3) {
  if (v === Infinity) return '∞';
  if (v === -Infinity) return '−∞';
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e4 || a < 1e-3) return v.toExponential(2);
  return String(Number(v.toPrecision(digits)));
}

return { FORMAT, PALETTE_SIZE, LOOP_SIGNALS, normalizeProject, UI_RUN, UI_TABS, normalizeUi, checkName, normalizePlant, defaultSampleTime, MAX_SAMPLES, simOf, autoTimebase, fitChannel, LOOP_CHANNELS, normalizeScope, FILTER_TYPES, VIEW_MODES, withLevels, levelsOf, withAboveNoise, channelNames, pruneChannels, evaluateOpenLoop, loopReady, referenceTrace, evaluateSystem, designSystem, linearizeBlock, loopModel, nextColor, resolveLoop, evaluateCandidate, evaluateProject, findCandidate, uniqueName, describeController, fmt };
})();
// ---- core/tune.js
__mods['core/tune.js'] = (() => {

const { blockDef, paramMax } = __mods['core/blocks.js'];
const { evaluateCandidate, simOf } = __mods['core/project.js'];
const { penalized } = __mods['core/goal.js'];
function tunableParams(block) {
  return blockDef('controller', block.type).params.filter((p) => p.tunable).map((p) => p.key);
}

function* tuneCandidate(project, cand, opts = {}) {
  const def = blockDef('controller', cand.controller.type);
  const keys = opts.params?.length ? opts.params : tunableParams(cand.controller);
  const ctx = { duration: simOf(project).duration };
  const specs = keys.map((k) => {
    const p = def.params.find((q) => q.key === k);
    if (!p || p.kind === 'vector') throw new Error(`cannot tune "${k}" of ${cand.controller.type}; tunable: ${tunableParams(cand.controller).join(', ')}`);
    const lo = p.min, hi = paramMax(p, ctx);
    const log = p.scale !== 'lin' && lo > 0;
    const enc = (v) => (log ? Math.log(Math.min(hi, Math.max(lo, v > 0 ? v : (p.default > 0 ? p.default : lo * 10)))) : v);
    const dec = (x) => { const v = log ? Math.exp(x) : x; return Math.min(hi, Math.max(lo, v)); };
    return { key: k, enc, dec, step: log ? 0.7 : 0.2 * (hi - lo) };
  });
  const maxEvals = opts.maxEvals ?? 300;

  const paramsAt = (x) => {
    const params = { ...cand.controller.params };
    specs.forEach((s, i) => { params[s.key] = s.dec(x[i]); });
    return params;
  };
  let evals = 0;
  let best = null;
  const f = (x) => {
    const params = paramsAt(x);
    const trial = { ...cand, controller: { type: cand.controller.type, params } };
    const { evaluation } = evaluateCandidate(project, trial);
    const val = penalized(evaluation);
    evals++;
    if (!best || val < best.f) best = { f: val, x: x.slice(), params, evaluation };
    return val;
  };

  let x0 = specs.map((s) => s.enc(cand.controller.params[s.key]));
  f(x0);
  yield { evals, best };
  const rand = lcg(opts.seed ?? 1);
  const scan = Math.min(opts.scan ?? 40, Math.floor(maxEvals / 4));
  for (let i = 0; i < scan; i++) {
    f(x0.map((v, j) => v + (rand() * 2 - 1) * specs[j].step * 4));
    yield { evals, best };
  }
  x0 = best.x;
  const restarts = opts.restarts ?? 2;
  for (let round = 0; round <= restarts && evals < maxEvals; round++) {
    const budget = Math.floor((maxEvals - evals) / (restarts - round + 1));
    yield* nelderMead(f, x0, specs.map((s) => s.step / (round + 1)), budget, () => ({ evals, best }));
    x0 = best.x;
  }
  return { evals, best, keys };
}

function* nelderMead(f, x0, steps, maxEvals, progress) {
  const n = x0.length;
  let simplex = [x0.slice()];
  for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += steps[i]; simplex.push(x); }
  let fs = [];
  let used = 0;
  const ev = function* (x) { const v = f(x); used++; yield progress(); return v; };
  for (const x of simplex) fs.push(yield* ev(x));
  while (used < maxEvals) {
    const order = fs.map((_, i) => i).sort((a, b) => fs[a] - fs[b]);
    simplex = order.map((i) => simplex[i]); fs = order.map((i) => fs[i]);
    if (Math.abs(fs[n] - fs[0]) <= 1e-9 * (Math.abs(fs[0]) + 1e-12) && spread(simplex) < 1e-6) break;
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += simplex[i][j] / n;
    const at = (t) => c.map((cj, j) => cj + t * (simplex[n][j] - cj));
    const xr = at(-1); const fr = yield* ev(xr);
    if (fr < fs[0]) {
      const xe = at(-2); const fe = yield* ev(xe);
      if (fe < fr) { simplex[n] = xe; fs[n] = fe; } else { simplex[n] = xr; fs[n] = fr; }
    } else if (fr < fs[n - 1]) {
      simplex[n] = xr; fs[n] = fr;
    } else {
      const xc = fr < fs[n] ? at(-0.5) : at(0.5);
      const fc = yield* ev(xc);
      if (fc < Math.min(fr, fs[n])) { simplex[n] = xc; fs[n] = fc; } else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]));
          fs[i] = yield* ev(simplex[i]);
        }
      }
    }
  }
}

function lcg(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; };
}

function spread(simplex) {
  let s = 0;
  for (let i = 1; i < simplex.length; i++) for (let j = 0; j < simplex[0].length; j++) s = Math.max(s, Math.abs(simplex[i][j] - simplex[0][j]));
  return s;
}

function runTune(project, cand, opts) {
  const it = tuneCandidate(project, cand, opts);
  for (;;) { const s = it.next(); if (s.done) return s.value; }
}

return { tunableParams, tuneCandidate, runTune };
})();
// ---- core/examples.js
__mods['core/examples.js'] = (() => {

const DEFAULT_PROJECT = {
  format: 'loop-tuner/2',
  title: 'New loop',
  system: {
    signals: { r: { period: 1, components: [{ type: 'step', params: { amplitude: 1, time: 0.1 } }] } },
    plant: { type: 'diagram', diagram: { blocks: [{ id: 'r', type: 'source', params: { signal: 'r' }, x: 60, y: 104 }], wires: [] } },
  },
  scope: {
    timebase: { scale: 0.1, position: 0 },
    channels: [
      { source: 'r', on: true, scale: 0.2, offset: -0.4 },
      { source: '', on: false, scale: 0.2, offset: 0 },
      { source: '', on: false, scale: 0.5, offset: 0 },
      { source: '', on: false, scale: 0.2, offset: 0 },
    ],
  },
  candidates: [],
};

return { DEFAULT_PROJECT };
})();
// ---- core/systems.js
__mods['core/systems.js'] = (() => {

const { EXAMPLE_PLANTS } = __mods['core/plants.js'];
const { CONTROLLERS } = __mods['core/controllers.js'];
const SYSTEM_PARTS = ['input', 'plant', 'controller'];

function fromPlant(e) {
  return {
    name: e.name, summary: e.summary ?? '', notes: e.notes ?? '',
    input: { signals: structuredClone(e.signals) },
    plant: { type: 'diagram', diagram: structuredClone(e.diagram), ...(e.views ? { views: structuredClone(e.views) } : {}) },
    ...(e.scope ? { scope: structuredClone(e.scope) } : {}),
    ...(e.ui ? { ui: structuredClone(e.ui) } : {}),
    ...(e.sim ? { sim: structuredClone(e.sim) } : {}),
    tags: systemTags(e),
  };
}

const NONLINEAR = new Set(['cartPole', 'pendulumCart', 'hinge', 'saturation', 'quantizer', 'fcn', 'switch']);
const VARIANT_TAGS = {
  pid: 'PID', pidFF: 'PID', stateFeedback: 'State feedback', gainScheduled: 'Gain scheduling', swingUp: 'Lyapunov swing-up', trajectory: 'Trajectory planning', lqr: 'LQR', relay: 'Relay', slidingMode: 'Sliding mode', superTwisting: 'Sliding mode', kalman: 'Kalman filter', kalmanModel: 'Kalman filter', luenberger: 'Luenberger observer', difference: 'Finite difference',
  scheduledPI: (v) => (v.params?.at?.length > 1 ? 'Gain scheduling' : 'PID'), swingUpLqr: ['Lyapunov swing-up', 'LQR'],
};
const variantTags = (v, fallback) => { const t = VARIANT_TAGS[v.type]; return [].concat(typeof t === 'function' ? t(v) : t ?? fallback); };
const TAG_TONES = ['blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'slate', 'red'];
const TONE = {
  Linear: 'blue', Nonlinear: 'red', 'Dead time': 'magenta', 'Black box': 'yellow',
  PID: 'aqua', 'State feedback': 'slate', 'Gain scheduling': 'yellow', 'Lyapunov swing-up': 'magenta', LQR: 'orange', 'Trajectory planning': 'green', Relay: 'blue',
  'Sliding mode': 'red',
  'Kalman filter': 'slate', 'Luenberger observer': 'aqua', 'Finite difference': 'orange',
  Disturbance: 'slate', FFT: 'blue', Spectrogram: 'magenta', XY: 'yellow', 'Auto-tune': 'green', HIL: 'orange',
  'Reference mode': 'aqua', 'Controller in the plant': 'green',
};
const toneOf = (label) => TONE[label] ?? TAG_TONES[[...label].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TAG_TONES.length];
function systemTags(e) {
  const blocks = [];
  let nonlinear = false;
  const walk = (d) => {
    for (const b of d.blocks) {
      blocks.push(b);
      if (b.diagram) walk(b.diagram);
      const onlyDisplays = d.wires.filter((w) => w.from.split(':')[0] === b.id).every((w) => ['sink', 'terminator'].includes(d.blocks.find((x) => x.id === w.to.split(':')[0])?.type));
      if (NONLINEAR.has(b.type) && !(b.type === 'fcn' && onlyDisplays)) nonlinear = true;
      if (b.type === 'integrator' && [b.params?.min, b.params?.max].some((v) => v !== null && v !== undefined && !/^\s*[-+]?inf\s*$/i.test(String(v)))) nonlinear = true;
    }
  };
  walk(e.diagram);
  const tags = [];
  const add = (label, kind) => { if (!tags.some((t) => t.label === label)) tags.push({ label, kind, tone: toneOf(label) }); };
  const external = blocks.some((b) => b.type === 'external');
  const own = external ? (e.tags ?? []).filter((t) => t.kind === 'plant') : [];
  if (own.length) for (const t of own) add(t.label, 'plant'); else add(external ? 'Black box' : nonlinear ? 'Nonlinear' : 'Linear', 'plant');
  if (blocks.some((b) => b.type === 'delay')) add('Dead time', 'plant');
  if (blocks.some((b) => b.type === 'external')) add('HIL', 'feature');
  const ctrls = blocks.filter((b) => b.type === 'controller'), obs = blocks.filter((b) => b.type === 'observer');
  const ownLoop = blocks.some((b) => b.type === 'external' && (b.params?.kinds ?? []).includes('reference'));
  if (!ctrls.length) add(ownLoop ? 'Controller in the plant' : 'No controller', 'none');
  for (const b of ctrls) for (const v of b.variants ?? []) if (v.type !== 'off') for (const t of variantTags(v, CONTROLLERS[v.type]?.label ?? v.type)) add(t, 'controller');
  for (const b of obs) for (const v of b.variants ?? []) for (const t of variantTags(v, 'Observer')) add(t, 'observer');
  const plays = (name) => !e.signals || (e.signals[name]?.components?.length ?? 0) > 0;
  if (blocks.some((b) => b.type === 'source' && b.params.signal === 'd') && plays('d')) add('Disturbance', 'feature');
  if (e.scope?.view?.mode) add({ fft: 'FFT', spectrogram: 'Spectrogram', xy: 'XY' }[e.scope.view.mode], 'feature');
  if (e.ui?.tab === 'tune') add('Auto-tune', 'feature');
  for (const t of e.tags ?? []) add(t.label, t.kind ?? 'feature');
  return tags;
}

const SYSTEM_LIBRARY = EXAMPLE_PLANTS.map(fromPlant);

const KIND_ORDER = ['plant', 'none', 'controller', 'observer', 'feature'];
function libraryTags(library = SYSTEM_LIBRARY) {
  const seen = new Map();
  for (const e of library) for (const t of e.tags) if (!seen.has(t.label)) seen.set(t.label, t);
  return [...seen.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}
const filterByTags = (labels, library = SYSTEM_LIBRARY) => library.map((e, i) => i).filter((i) => labels.every((l) => library[i].tags.some((t) => t.label === l)));

function applySystem(project, entry, parts) {
  const p = structuredClone(project);
  p.system ??= {};
  if (parts.includes('input') && entry.input) {
    p.system.signals = { ...(p.system.signals ?? {}), ...structuredClone(entry.input.signals) };
  }
  if (parts.includes('plant') && entry.plant) p.system.plant = structuredClone(entry.plant);
  if (parts.includes('controller') && entry.controller) {
    const c = structuredClone(entry.controller);
    Object.assign(p, { candidates: c.candidates, goal: c.goal, sim: c.sim });
  }
  const whole = SYSTEM_PARTS.filter((k) => entry[k]).every((k) => parts.includes(k));
  if (whole) {
    p.title = entry.name;
    if (entry.notes) p.notes = entry.notes; else delete p.notes;
    if (!entry.controller) { p.candidates = []; delete p.selected; delete p.goal; p.sim = entry.sim ? structuredClone(entry.sim) : {}; }
    if (entry.scope) {
      p.scope = { ...(p.scope ?? {}), channels: structuredClone(entry.scope.channels) };
      if (entry.scope.view) p.scope.view = structuredClone(entry.scope.view); else delete p.scope.view;
    }
    if (entry.ui) p.ui = structuredClone(entry.ui);
  }
  delete p.system.reference;
  return p;
}

return { SYSTEM_PARTS, TAG_TONES, systemTags, SYSTEM_LIBRARY, libraryTags, filterByTags, applySystem };
})();
// ---- core/hilsim.js
__mods['core/hilsim.js'] = (() => {

const { compileDiagram, normalizeDiagram, parseEnd, outputNames, diagramBlockDef, diagramNames } = __mods['core/diagram.js'];
const { simulateSystem, stepPlan } = __mods['core/sim.js'];
const { referenceFn } = __mods['core/signals.js'];
const { EXAMPLE_PLANTS } = __mods['core/plants.js'];
const { physicalMaskKeys } = __mods['core/physics.js'];
const CORE_FILE = 'loop-tuner-core.js';
function simulatorCore(script) {
  const a = script.indexOf('\n// ---- core/'), b = script.indexOf('\n// ---- ui/');
  if (a < 0 || b < a) return null;
  return `(() => {\n'use strict';\nif (typeof structuredClone !== 'function') globalThis.structuredClone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));\nconst __mods = {};${script.slice(a, b)}\nglobalThis.LoopTunerCore = __mods;\n})();\n`;
}


const isLive = (e) => JSON.stringify(e.diagram).includes('"type":"external"');
const simModels = () => EXAMPLE_PLANTS.filter((e) => !isLive(e));

function seededRandom(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


function blockAt(diagram, path) {
  let d = diagram, b = null;
  for (const id of path.split('/')) {
    b = d?.blocks.find((x) => x.id === id);
    if (!b) throw new Error(`no block "${path}" in the model`);
    d = b.diagram;
  }
  return b;
}
function paramAt(diagram, at) {
  const m = /^(.+)\.(\w+)(?:\[(\d+)\])?$/.exec(at);
  if (!m) throw new Error(`"${at}": a parameter as block.key or block.key[i]`);
  const block = blockAt(diagram, m[1]), key = m[2], i = m[3] === undefined ? null : Number(m[3]);
  const now = i === null ? block.params?.[key] : block.params?.[key]?.[i];
  if (typeof now !== 'number') throw new Error(`"${at}": not a number in the model`);
  return {
    get: () => (i === null ? block.params[key] : block.params[key][i]),
    set: (v) => { if (i === null) block.params[key] = v; else block.params[key][i] = v; },
  };
}

const PHYSICAL = {
  cartPole: ['M', 'm', 'l', 'b'],
  pendulumCart: (p) => ['M', 'b', ...Array.from({ length: p.links }, (_, i) => [`m${i + 1}`, `l${i + 1}`]).flat()],
  firstOrder: ['K', 'tau'], fopdt: ['K', 'tau', 'delay'], secondOrder: ['K', 'wn', 'zeta'], lagChain: ['K', 'tau'], integratorLag: ['K', 'tau'],
  doubleIntegrator: ['K'], inverseResponse: ['K', 'Tz', 'tau1', 'tau2'],
  tf: (p) => [...p.num.map((v, i) => (v ? `num[${i}]` : null)), ...p.den.map((v, i) => (v ? `den[${i}]` : null))].filter(Boolean),
  delay: ['L'],
};
function typePhysics(diagram, prefix = '') {
  const out = [];
  for (const b of diagram.blocks) {
    if (b.type === 'subsystem') {
      if (b.mask) for (const k of physicalMaskKeys(b.mask)) if (typeof b.params?.[k] === 'number') out.push({ name: `${prefix}${b.id}.${k}`, at: `${prefix}${b.id}.${k}`, unit: b.mask.find((f) => f.key === k).unit });
      out.push(...typePhysics(b.diagram, `${prefix}${b.id}/`));
      continue;
    }
    const keys = typeof PHYSICAL[b.type] === 'function' ? PHYSICAL[b.type](b.params) : PHYSICAL[b.type] ?? [];
    for (const k of keys) {
      const at = `${prefix}${b.id}.${k}`;
      const unit = (diagramBlockDef(b.type).params.find((p) => p.key === k.replace(/\[.*/, ''))?.unit) ?? '';
      out.push({ name: at, at, unit });
    }
  }
  return out;
}


function drawSystem(opts = {}) {
  const rand = seededRandom(opts.seed ?? 1);
  const models = simModels();
  let entry;
  if (opts.random) entry = models[Math.floor(rand() * models.length)];
  else if (opts.model && typeof opts.model === 'object') entry = opts.model;
  else {
    const name = opts.model ?? DEFAULT_MODEL;
    entry = models.find((e) => e.name === name) ?? models.find((e) => e.name.toLowerCase() === String(name).toLowerCase());
    if (!entry) throw new Error(`no model "${name}"; --list gives the models: ${models.map((e) => e.name).join('; ')}`);
  }
  const diagram = structuredClone(entry.diagram);
  const known = entry.effects ?? [];
  const detail = opts.detail ?? 'random';
  let wanted = null;
  if (detail !== 'random' && detail !== 'all' && detail !== 'none') {
    wanted = (Array.isArray(detail) ? detail : String(detail).split(',')).map((s) => s.trim()).filter(Boolean);
    for (const w of wanted) if (!known.some((f) => f.name === w)) throw new Error(`--detail: no effect "${w}" in ${entry.name}; its effects: ${known.map((f) => f.name).join(', ') || 'none'}`);
  }
  const effects = known.map((f) => {
    const on = detail === 'random' ? rand() < 0.5 : detail === 'all' ? true : detail === 'none' ? false : wanted.includes(f.name);
    if (!on) {
      const b = blockAt(diagram, f.at);
      const keep = { id: b.id, x: b.x, y: b.y, ...(b.name ? { name: `${b.name} (off)` } : {}), ...(b.flip ? { flip: true } : {}) };
      for (const k of Object.keys(b)) delete b[k];
      Object.assign(b, keep, { type: 'gain', params: { K: f.off === 'zero' ? 0 : 1 } });
    }
    return { name: f.name, on };
  });
  const list = entry.physics ?? typePhysics(normalizeDiagram(structuredClone(entry.diagram)));
  const share = Number(opts.vary ?? 0.15);
  const factors = {};
  const params = [];
  for (const p of list) {
    if (p.same && !(p.same in factors)) throw new Error(`${p.name}: tied to ${p.same}, which must come first`);
    let at;
    try { at = paramAt(diagram, p.at); } catch { continue; }   
    const nominal = at.get();
    const f = p.same ? factors[p.same] : 1 + share * (2 * rand() - 1);
    factors[p.name] = f;
    params.push({ name: p.name, unit: p.unit ?? '', nominal, value: nominal * f, at });
  }
  for (const [name, value] of Object.entries(opts.set ?? {})) {
    const p = params.find((x) => x.name === name);
    if (!p) throw new Error(`--set ${name}: not a physical parameter of ${entry.name}; its parameters: ${params.map((x) => x.name).join(', ')}`);
    p.value = Number(value);
    for (const q of params) if (list.find((x) => x.name === q.name)?.same === name) q.value = q.nominal * (p.value / p.nominal);
  }
  for (const p of params) p.at.set(p.value);
  return { entry, diagram, effects, params: params.map(({ at, ...p }) => p) };
}

function varyDiagram(entry, vary, seed) {
  return drawSystem({ model: entry, vary, seed, detail: (entry.effects ?? []).map((f) => f.name) }).diagram;
}

const DEFAULT_MODEL = 'DC motor with an unbalanced arm';


function flatten(diagram) {
  const leaves = new Map(), feeds = new Map();
  const wireTo = (d, id, port) => d.wires.find((w) => { const t = parseEnd(w.to); return t.id === id && t.port === port; });
  const srcOf = (d, prefix, ctx, from) => {
    const { id, port } = parseEnd(from);
    const b = d.blocks.find((x) => x.id === id);
    if (b.type === 'subsystem') {
      const out = b.diagram.blocks.find((x) => x.type === 'outport' && x.params.port === port + 1);
      const w = out && wireTo(b.diagram, out.id, 0);
      return w ? srcOf(b.diagram, `${prefix}${b.id}/`, { d, prefix, sub: b, ctx }, w.from) : null;
    }
    if (b.type === 'inport') {
      if (!ctx) return null;
      const w = wireTo(ctx.d, ctx.sub.id, b.params.port - 1);
      return w ? srcOf(ctx.d, ctx.prefix, ctx.ctx, w.from) : null;
    }
    return { key: `${prefix}${b.id}`, port };
  };
  const walk = (d, prefix, ctx) => {
    for (const b of d.blocks) {
      if (b.type === 'subsystem') { walk(b.diagram, `${prefix}${b.id}/`, { d, prefix, sub: b, ctx }); continue; }
      if (b.type === 'inport' || b.type === 'outport') continue;
      const key = `${prefix}${b.id}`;
      leaves.set(key, b);
      const slots = [];
      for (const w of d.wires) {
        const t = parseEnd(w.to);
        if (t.id === b.id) slots[t.port] = srcOf(d, prefix, ctx, w.from);
      }
      feeds.set(key, slots);
    }
  };
  walk(diagram, '', null);
  const reach = (starts, stop = new Set()) => {
    const seen = new Set(starts), todo = [...starts];
    while (todo.length) {
      const k = todo.pop();
      if (stop.has(k)) continue;
      for (const [key, slots] of feeds) if (!seen.has(key) && slots.some((s) => s?.key === k)) { seen.add(key); todo.push(key); }
    }
    return seen;
  };
  return { leaves, feeds, reach };
}

const ASCII = { θ: 'theta', ω: 'omega', φ: 'phi', α: 'alpha', β: 'beta', τ: 'tau', 'x̂': 'xhat' };
const OUTPUT_UNITS = { x: 'm', v: 'm/s', 'θ': 'rad', 'ω': 'rad/s', h: 'm' };
const asName = (s) => {
  let n = String(s);
  for (const [g, a] of Object.entries(ASCII)) n = n.split(g).join(a);
  n = n.replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z]+/, '');
  return (n || 'y').slice(0, 12);
};


const outward = (v, up) => {
  if (v === 0) return 0;
  const e = 10 ** (Math.floor(Math.log10(Math.abs(v))) - 1);
  return (up ? Math.ceil(v / e - 1e-9) : Math.floor(v / e + 1e-9)) * e;
};
const tidy = (v) => Number(v.toPrecision(12));
function rangesFrom(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { scale: [-1, 1], hard: [-1, 1] };
  if (a === b && a === 0) return { scale: [-1, 1], hard: [-1, 1] };
  if (a < 0 && b > 0) {
    const m = Math.max(-a, b);
    return { scale: [tidy(-outward(4 * m, true)), tidy(outward(4 * m, true))], hard: [tidy(-outward(3 * m, true)), tidy(outward(3 * m, true))] };
  }
  const s = b - a || Math.max(Math.abs(a), Math.abs(b));
  return { scale: [tidy(outward(a - 2 * s, false)), tidy(outward(b + 2 * s, true))], hard: [tidy(outward(a - s, false)), tidy(outward(b + s, true))] };
}

const finiteLimit = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));


function simPlant(opts = {}) {
  const mode = opts.mode ?? 'control', rate = Number(opts.rate ?? 100), dyno = !!opts.dyno;
  if (!['control', 'reference', 'log'].includes(mode)) throw new Error(`mode: control, reference or log, not "${mode}"`);
  const draw = drawSystem(opts);
  const { entry } = draw;
  const own = normalizeDiagram(draw.diagram);
  const signals = structuredClone(entry.signals ?? {});
  const flat = flatten(own);
  const ctrls = own.blocks.filter((b) => b.type === 'controller');
  if (ctrls.length > 1) throw new Error(`${entry.name}: one Controller block, for now`);
  const ctrl = ctrls[0] ?? null;
  if (!ctrl && mode !== 'control') throw new Error(`${entry.name} has no controller of its own: run it in control mode`);
  const sinks = [...flat.leaves].filter(([, b]) => b.type === 'sink').map(([key, b]) => ({ key, name: b.params.name, unit: b.params.unit ?? '1', src: flat.feeds.get(key)[0] ?? null }))
    .sort((a, b) => a.key.split('/').length - b.key.split('/').length);
  const same = (a, b) => a && b && a.key === b.key && a.port === b.port;
  const sinkOf = (src) => sinks.find((s) => same(s.src, src));
  const isSource = (src) => src && flat.leaves.get(src.key)?.type === 'source';
  const added = [];   
  const taken = new Set([...sinks.map((s) => s.name), ...Object.keys(signals)]);
  const fresh = (base) => { let n = asName(base), i = 2; while (taken.has(n)) n = `${asName(base).slice(0, 10)}${i++}`; taken.add(n); return n; };

  const measured = [];
  if (ctrl) {
    const slots = flat.feeds.get(ctrl.id);
    for (let j = 1; j < ctrl.params.inputs; j++) {
      const src = slots[j];
      if (!src) continue;
      let s = sinkOf(src);
      if (!s) {
        const b = flat.leaves.get(src.key);
        const names = outputNames(diagramBlockDef(b.type), b.params);
        const raw = names[src.port];
        const name = fresh(raw ?? (src.port ? `${b.id}${src.port}` : b.id));
        const unit = b.type === 'source' ? b.params.unit : OUTPUT_UNITS[String(raw ?? '').replace(/\d+$/, '')] ?? '1';
        s = { key: null, name, unit, src };
        added.push(s);
      }
      if (!measured.includes(s)) measured.push(s);
    }
  }

  const withSinks = (d, list) => {
    const out = structuredClone(d);
    for (const s of list) {
      const id = `hil_${s.name}`;
      out.blocks.push({ id, type: 'sink', params: { name: s.name, unit: s.unit }, x: 0, y: 0 });
      const [path, ...rest] = s.src.key.split('/');
      if (rest.length) throw new Error(`${entry.name}: a measurement inside a subsystem needs a Sink`);
      out.wires.push({ from: s.src.port ? `${path}:${s.src.port}` : path, to: id });
    }
    return normalizeDiagram(out);
  };
  const ownLoop = withSinks(own, added);
  const later = [];   
  const period = Math.max(1, ...Object.values(signals).map((s) => s.period ?? 1));
  const step = Math.min(1 / rate, entry.sim?.sampleTime ?? 1 / rate);
  const run = simulateSystem(ownLoop, signals, { duration: 2 * period, sampleTime: step });
  const extent = (name) => {
    const v = run.signals[name];
    if (!v) return [NaN, NaN];
    let a = Infinity, b = -Infinity;
    for (const x of v) if (Number.isFinite(x)) { if (x < a) a = x; if (x > b) b = x; }
    return a <= b ? [a, b] : [NaN, NaN];
  };
  const declared = entry.ports ?? {};
  const from = {};
  const rangesOf = (name, ext) => {
    const d = declared[name];
    if (d?.hard || d?.scale) { from[name] = 'model'; return { scale: d.scale ?? d.hard, hard: d.hard ?? d.scale }; }
    from[name] = 'simulation';
    return rangesFrom(...ext);
  };

  const inputs = [], inputOf = {};   
  const plant = structuredClone(ownLoop);
  const dropped = new Set();
  const effortSink = ctrl ? sinks.find((s) => s.src?.key === ctrl.id) : null;
  const variant = ctrl ? ctrl.variants[ctrl.variant] : null;
  const limits = variant ? [finiteLimit(variant.params.umin), finiteLimit(variant.params.umax)] : [null, null];
  const effortRange = () => {
    if (limits[0] !== null && limits[1] !== null) { from[effortSink?.name ?? 'u'] = 'model'; return [limits[0], limits[1]]; }
    const r = rangesOf(effortSink?.name ?? 'u', extent(`${ctrl.id}.u`));
    return r.scale;
  };
  const addInput = (port) => {
    const d = declared[port.name]?.scale;
    if (d) { [port.min, port.max] = d; from[port.name] = 'model'; }
    port.safe = Math.min(port.max, Math.max(port.min, 0));
    inputs.push(port);
    return inputs.length - 1;
  };
  const rSource = ctrl ? flat.feeds.get(ctrl.id)[0] : null;
  const rSignal = rSource && isSource(rSource) ? flat.leaves.get(rSource.key).params.signal : null;
  const sources = [...flat.leaves].filter(([, b]) => b.type === 'source').map(([key, b]) => ({ key, signal: b.params.signal, unit: b.params.unit ?? '1' }));
  if (ctrl && mode === 'control') {
    const [lo, hi] = effortRange();
    const name = effortSink?.name ?? fresh('u');
    const i = addInput({ name, unit: effortSink?.unit ?? '1', min: lo, max: hi, kind: 'effort' });
    const b = plant.blocks.find((x) => x.id === ctrl.id);
    const keep = { id: b.id, x: b.x, y: b.y, name: 'u from the page' };
    for (const k of Object.keys(b)) delete b[k];
    Object.assign(b, keep, { type: 'source', params: { signal: 'hilu0', unit: effortSink?.unit ?? '1' } });
    plant.wires = plant.wires.filter((w) => parseEnd(w.to).id !== ctrl.id);
    inputOf.hilu0 = i;
    if (rSignal) dropped.add(rSource.key);
  }
  if (ctrl && mode === 'reference' && rSignal) {
    const m = measured[0];
    const r = m ? rangesOf(m.name, extent(m.name)) : rangesOf(rSignal, extent(rSignal));
    inputOf[rSignal] = addInput({ name: rSignal, unit: m?.unit ?? sources.find((s) => s.signal === rSignal).unit, min: r.scale[0], max: r.scale[1], kind: 'reference', ...(m ? { measures: m.name } : {}) });
  }
  let first = !ctrl;
  for (const s of sources) {
    if (s.signal === rSignal || dropped.has(s.key)) continue;
    const kind = first ? 'effort' : 'disturbance';
    if (kind === 'disturbance' && !dyno) continue;
    const [a, b] = extent(s.signal), most = Math.max(Math.abs(a), Math.abs(b));
    from[s.signal] = 'simulation';
    const r = kind === 'effort' ? rangesOf(s.signal, [a, b]).scale : most > 0 ? [tidy(-outward(2 * most, true)), tidy(outward(2 * most, true))] : [-1, 1];
    inputOf[s.signal] = addInput({ name: s.signal, unit: s.unit, min: r[0], max: r[1], kind });
    first = false;
  }

  const drop = flat.reach([...dropped], new Set(ctrl ? [ctrl.id] : []));
  const inputKeys = new Set([...sources.filter((s) => s.signal in inputOf).map((s) => s.key), ...(ctrl && mode === 'control' ? [ctrl.id] : [])]);
  const outputs = [];
  const addOutput = (s, kind) => {
    const ext = extent(s.name);
    const r = kind === 'effort' && limits[0] !== null && limits[1] !== null ? (from[s.name] = 'model', { scale: limits, hard: null }) : rangesOf(s.name, ext);
    outputs.push({ name: s.name, unit: s.unit, min: r.scale[0], max: r.scale[1], ...(r.hard ? { hard_min: r.hard[0], hard_max: r.hard[1] } : {}), kind: kind ?? 'measurement' });
  };
  for (const s of measured) addOutput(s);
  for (const s of sinks) {
    if (measured.includes(s) || (s.key && drop.has(s.key))) continue;
    if (s === effortSink && mode !== 'control') continue;
    if (s.src && (inputKeys.has(s.src.key) || isSource(s.src))) continue;
    addOutput(s);
  }
  if (ctrl && mode !== 'control') {
    let s = effortSink;
    if (!s) { s = { key: null, name: fresh('u'), unit: '1', src: { key: 'hil_gate', port: 0 } }; later.push(s); }
    addOutput(s, 'effort');
    for (const w of plant.wires) if (parseEnd(w.from).id === ctrl.id) w.from = 'hil_gate';
    plant.blocks.push({ id: 'hil_gate', type: 'switch', params: { inputs: 2, position: 2 }, x: 0, y: 0 }, { id: 'hil_safe', type: 'source', params: { signal: 'hilsafe', unit: '1' }, x: 0, y: 0 });
    plant.wires.push({ from: ctrl.id, to: 'hil_gate' }, { from: 'hil_safe', to: 'hil_gate:1' });
  }
  let setpointName = null;
  if (mode === 'log' && rSignal) {
    setpointName = fresh('setpoint');
    plant.blocks.push({ id: 'hil_setpoint', type: 'sink', params: { name: setpointName, unit: sources.find((s) => s.signal === rSignal).unit }, x: 0, y: 0 });
    plant.wires.push({ from: rSource.key, to: 'hil_setpoint' });
    outputs.push({ name: setpointName, unit: sources.find((s) => s.signal === rSignal).unit, ...(() => { const r = rangesOf(rSignal, extent(rSignal)); return { min: r.scale[0], max: r.scale[1] }; })(), kind: 'measurement' });
  }
  if (!outputs.length) throw new Error(`${entry.name}: nothing to measure (no Sink, no Controller input)`);
  const final = withSinks(plant, later);
  const shown = diagramNames(final).sinks;
  for (const o of outputs) if (!shown.includes(o.name)) throw new Error(`${o.name}: no Sink`);
  for (const p of inputs) if (p.min > p.max) [p.min, p.max] = [p.max, p.min];

  const sourcePlays = {};
  for (const s of sources) {
    if (s.signal in inputOf) sourcePlays[s.signal] = { input: inputOf[s.signal] };
    else if (mode === 'log' && s.signal === rSignal) sourcePlays[s.signal] = opts.setpoint !== undefined && opts.setpoint !== null ? { value: Number(opts.setpoint) } : { wave: signals[s.signal] ?? null };
    else sourcePlays[s.signal] = { value: 0 };
  }
  sourcePlays.hilu0 = { input: inputOf.hilu0 ?? 0 };
  sourcePlays.hilsafe = { value: 0 };
  return {
    name: `Simulated plant${mode === 'control' ? '' : `, ${mode} mode`}`,
    mode, rate, inputs, outputs, diagram: final, sources: sourcePlays, signals, loop: ownLoop, gate: !!ctrl && mode !== 'control',
    draws: { system: entry.name, seed: opts.seed ?? 1, vary: Number(opts.vary ?? 0.15), effects: draw.effects, params: draw.params, ranges: from },
  };
}

function drawsText(spec) {
  const d = spec.draws;
  const pct = (p) => (p.nominal ? `${((p.value / p.nominal - 1) * 100).toFixed(1)} %` : '');
  const g = (v) => Number(Number(v).toPrecision(4));
  return [
    `system: ${d.system} (seed ${d.seed}, vary ±${(d.vary * 100).toFixed(0)} %)`,
    `effects: ${d.effects.length ? d.effects.map((f) => `${f.name} ${f.on ? 'on' : 'off'}`).join(', ') : 'none'}`,
    `parameters: ${d.params.map((p) => `${p.name} ${g(p.value)}${p.unit ? ` ${p.unit}` : ''} (${g(p.nominal)}, ${pct(p)})`).join(', ') || 'none'}`,
    `ranges: ${[...spec.inputs, ...spec.outputs].map((p) => `${p.name} from the ${d.ranges[p.name] ?? 'simulation'}`).join(', ')}`,
  ].join('\n');
}


function createSimPlant(spec) {
  const u = spec.inputs.map((p) => p.safe);
  const fns = {};
  for (const [name, play] of Object.entries(spec.sources)) {
    if (play.input !== undefined) { const i = play.input; fns[name] = () => u[i]; } else if (play.wave) {
      const f = referenceFn(play.wave, { sampleTime: 1 / spec.rate });
      fns[name] = f;
    } else { const v = play.value ?? 0; fns[name] = () => v; }
  }
  const sources = new Proxy({}, { get: (_, n) => fns[n] ?? (() => 0) });
  const dt = 1 / spec.rate;
  let el, m, split, h, names, index, running = false;
  const X = new Float64Array(compileDiagram(spec.diagram, 'plant', { standalone: true, sources }).n);
  const N = X.length;
  const build = () => {
    const d = structuredClone(spec.diagram);
    if (spec.gate) d.blocks.find((b) => b.id === 'hil_gate').params.position = running ? 1 : 2;
    el = compileDiagram(d, 'plant', { standalone: true, sources });
    ({ m, split } = stepPlan(dt, el.bound, el.sampleTimes, 1));
    h = dt / m;
    el.setStep(h);
    names = el.probes().map(([n]) => n);
    index = spec.outputs.map((o) => names.indexOf(o.name));
  };
  build();
  const Xt = new Float64Array(N), k1 = new Float64Array(N), k2 = new Float64Array(N), k3 = new Float64Array(N), k4 = new Float64Array(N);
  el.init(X, 0);
  const rk4 = (ts, d) => {
    el.eval(ts, X, 0, 0, k1);
    for (let i = 0; i < N; i++) Xt[i] = X[i] + 0.5 * d * k1[i];
    el.eval(ts + 0.5 * d, Xt, 0, 0, k2);
    for (let i = 0; i < N; i++) Xt[i] = X[i] + 0.5 * d * k2[i];
    el.eval(ts + 0.5 * d, Xt, 0, 0, k3);
    for (let i = 0; i < N; i++) Xt[i] = X[i] + d * k3[i];
    el.eval(ts + d, Xt, 0, 0, k4, true);
    for (let i = 0; i < N; i++) X[i] += (d / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  };
  const onGrid = (t) => Math.round(t * 1e9) / 1e9;
  let pending = true;
  const recordAt = (t) => { if (!pending) return; el.eval(t, X, 0, 0, null); el.record(); pending = false; };
  el.eval(0, X, 0, 0, null);
  el.sample(0, X, 0, 0);
  let k = 0, s = 0, a = 0;   
  const part = (b) => {
    const tk = k * dt, ts = tk + s * h;
    if (a === 0) recordAt(s ? onGrid(ts) : tk);
    let at = ts + a;
    const end = b >= h * (1 - 1e-9);
    const stop = end ? onGrid(tk + (s + 1) * h) : ts + b;
    if (split) {
      for (let tn = onGrid(el.nextSample()); tn < stop - 1e-9; tn = onGrid(el.nextSample())) {
        if (tn > at) { rk4(at, tn - at); at = tn; }
        el.eval(tn, X, 0, 0, null);
        el.sample(tn, X, 0, 0);
      }
    }
    if (end) {
      rk4(at, ts + h - at);
      el.eval(stop, X, 0, 0, null);
      el.recordLeft();
      el.sample(stop, X, 0, 0);
      pending = true;
      a = 0;
      if (++s === m) { s = 0; k++; }
    } else {
      rk4(at, ts + b - at);
      el.eval(ts + b, X, 0, 0, null);
      a = b;
    }
  };
  return {
    rate: spec.rate, substeps: m,
    get t() { return k * dt + s * h + a; },
    advance(span, values) {
      for (let i = 0; i < u.length; i++) {
        const v = Number(values?.[i]);
        u[i] = Number.isFinite(v) ? Math.min(spec.inputs[i].max, Math.max(spec.inputs[i].min, v)) : spec.inputs[i].safe;
      }
      let left = Number(span);
      if (!(left > 0)) return;
      while (left > h * 1e-9) {
        const room = h - a;
        if (left >= room * (1 - 1e-9)) { left -= room; part(h); } else { part(a + left); left = 0; }
      }
    },
    outputs() { const all = el.probes(); return index.map((i) => all[i][1]); },
    restore() {
      el.init(X, 0);
      const t = k * dt + s * h + a;
      el.eval(t, X, 0, 0, null);
    },
    running(on) {
      if (!spec.gate || running === !!on) return;
      running = !!on;
      const t = k * dt + s * h + a;
      build();
      el.eval(t, X, 0, 0, null);
      el.sample(t, X, 0, 0);
    },
    cycle(segments) {
      for (const [span, values] of segments) this.advance(span, values);
      return this.outputs();
    },
  };
}

function startSimPlant(opts) {
  const spec = simPlant(opts);
  const plant = createSimPlant(spec);
  globalThis.__plant = plant;
  return JSON.stringify({ name: spec.name, mode: spec.mode, inputs: spec.inputs, outputs: spec.outputs, draws: spec.draws, text: drawsText(spec), substeps: plant.substeps });
}

function listModels() {
  return simModels().map((e) => {
    try {
      const p = simPlant({ model: e.name, vary: 0, detail: 'all', dyno: true });
      return `${e.name}: in ${p.inputs.map((x) => `${x.name} [${x.unit}]`).join(', ')}; out ${p.outputs.map((x) => `${x.name} [${x.unit}]`).join(', ')}`;
    } catch (err) { return `${e.name}: ${err.message}`; }
  }).join('\n');
}

function checkText(opts = {}) {
  const spec = simPlant({ ...opts, vary: 0, detail: 'all', mode: 'control', dyno: false });
  const period = Math.max(1, ...Object.values(spec.signals).map((s) => s.period ?? 1));
  const run = simulateSystem(spec.loop, spec.signals, { duration: period, sampleTime: 1 / spec.rate });
  const last = (n) => run.signals[n]?.[run.t.length - 1];
  const g = (v) => (Number.isFinite(v) ? String(Number(v.toPrecision(4))) : 'not a number');
  return `${spec.draws.system}, nominal, after ${period} s of its own controller: ${spec.outputs.map((o) => `${o.name} ${g(last(o.name))} ${o.unit}`).join(', ')}`;
}

return { CORE_FILE, simulatorCore, simModels, seededRandom, drawSystem, varyDiagram, DEFAULT_MODEL, rangesFrom, simPlant, drawsText, createSimPlant, startSimPlant, listModels, checkText };
})();
// ---- core/spectrum.js
__mods['core/spectrum.js'] = (() => {

function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function prevPow2(n) {
  if (!(n >= 1)) return 0;
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return p;
}

function checkDt(dt) {
  if (!(dt > 0) || !Number.isFinite(dt)) throw new Error(`dt must be a positive number, got ${dt}`);
}

const TWIDDLES = new Map();
function twiddles(n) {
  let t = TWIDDLES.get(n);
  if (!t) {
    if (TWIDDLES.size >= 8) TWIDDLES.clear();
    const half = n >> 1;
    const cos = new Float64Array(half), sin = new Float64Array(half);
    for (let k = 0; k < half; k++) {
      cos[k] = Math.cos((2 * Math.PI * k) / n);
      sin[k] = Math.sin((2 * Math.PI * k) / n);
    }
    t = { cos, sin };
    TWIDDLES.set(n, t);
  }
  return t;
}

function fft(re, im) {
  const n = re.length;
  if (im.length !== n) throw new Error(`fft: re and im differ in length (${n}, ${im.length})`);
  if (n & (n - 1)) throw new Error(`fft: length ${n} is not a power of two`);
  if (n <= 1) return;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }
  const { cos, sin } = twiddles(n);
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1, step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0, t = 0; k < half; k++, t += step) {
        const wr = cos[t], wi = -sin[t];
        const a = i + k, b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

function cosineSum(N, a) {
  const w = new Float64Array(N);
  if (N <= 1) return w.fill(1);
  for (let n = 0; n < N; n++) {
    const x = (2 * Math.PI * n) / N;
    let v = 0;
    for (let k = 0; k < a.length; k++) v += (k % 2 ? -a[k] : a[k]) * Math.cos(k * x);
    w[n] = v;
  }
  return w;
}

const WINDOWS = {
  rect: (N) => new Float64Array(N).fill(1),
  hann: (N) => cosineSum(N, [0.5, 0.5]),
  hamming: (N) => cosineSum(N, [0.54, 0.46]),
  blackman: (N) => cosineSum(N, [0.42, 0.5, 0.08]),
  flattop: (N) => cosineSum(N, [0.21557895, 0.41663158, 0.277263158, 0.083578947, 0.006947368]),
};

function coherentGain(w) {
  let s = 0;
  for (let k = 0; k < w.length; k++) s += w[k];
  return w.length ? s / w.length : 0;
}

const WINDOW_CACHE = new Map();
function windowOf(name, N) {
  if (!WINDOWS[name]) throw new Error(`window "${name}": expected one of ${Object.keys(WINDOWS).join(', ')}`);
  const key = `${name}:${N}`;
  let w = WINDOW_CACHE.get(key);
  if (!w) {
    if (WINDOW_CACHE.size >= 16) WINDOW_CACHE.clear();
    w = WINDOWS[name](N);
    WINDOW_CACHE.set(key, w);
  }
  return w;
}

function detrendInPlace(seg, n, mode) {
  if (mode === 'none' || n === 0) return;
  let mean = 0;
  for (let k = 0; k < n; k++) mean += seg[k];
  mean /= n;
  if (mode === 'mean') {
    for (let k = 0; k < n; k++) seg[k] -= mean;
    return;
  }
  if (mode !== 'linear') throw new Error(`detrend "${mode}": expected none, mean or linear`);
  const kMid = (n - 1) / 2;
  let sxy = 0, sxx = 0;
  for (let k = 0; k < n; k++) { sxy += (k - kMid) * (seg[k] - mean); sxx += (k - kMid) * (k - kMid); }
  const slope = sxx > 0 ? sxy / sxx : 0;
  for (let k = 0; k < n; k++) seg[k] -= mean + slope * (k - kMid);
}

function frameAmplitudes(re, im, n, w, out) {
  const size = re.length;
  let sw = 0;
  for (let k = 0; k < n; k++) { re[k] *= w[k]; sw += w[k]; }
  re.fill(0, n);
  im.fill(0);
  fft(re, im);
  const half = size >> 1;
  const scale = sw > 0 ? 1 / sw : 0;
  for (let k = 0; k <= half; k++) {
    const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]) * scale;
    out[k] = k === 0 || k === half ? m : 2 * m;
  }
}

function amplitudeSpectrum(x, dt, { window = 'hann', detrend = 'mean', pad = true } = {}) {
  checkDt(dt);
  const len = x.length;
  const n = pad ? len : prevPow2(len);
  const size = n === 0 ? 0 : pad ? nextPow2(n) : n;
  const bins = size ? (size >> 1) + 1 : 0;
  const df = size ? 1 / (size * dt) : 1 / dt;
  const f = new Float64Array(bins), amp = new Float64Array(bins);
  for (let k = 0; k < bins; k++) f[k] = k * df;
  if (!size) return { f, amp, df, fNyquist: 0.5 / dt };
  const re = new Float64Array(size), im = new Float64Array(size);
  const start = len - n;
  for (let k = 0; k < n; k++) re[k] = x[start + k];
  detrendInPlace(re, n, detrend);
  frameAmplitudes(re, im, n, windowOf(window, n), amp);
  return { f, amp, df, fNyquist: 0.5 / dt };
}

function spectrogram(x, dt, { window = 'hann', size = 256, overlap = 0.75, detrend = 'mean', maxFrames = 2048 } = {}) {
  checkDt(dt);
  const n = x.length;
  let m = Math.max(16, prevPow2(size));
  while (m > 16 && m > n) m >>= 1;
  const bins = (m >> 1) + 1;
  const f = new Float64Array(bins);
  for (let k = 0; k < bins; k++) f[k] = k / (m * dt);
  if (n < m) return { t: new Float64Array(0), f, amp: new Float32Array(0), frames: 0, bins, size: m, hop: 0 };
  const ov = Math.min(Math.max(Number(overlap) || 0, 0), 0.99);
  let hop = Math.max(1, Math.round(m * (1 - ov)));
  let frames = Math.floor((n - m) / hop) + 1;
  const cap = Math.max(2, Math.floor(maxFrames));
  if (frames > cap) {
    hop = Math.ceil((n - m) / (cap - 1));
    frames = Math.floor((n - m) / hop) + 1;
  }
  const w = windowOf(window, m);
  const re = new Float64Array(m), im = new Float64Array(m);
  const t = new Float64Array(frames);
  const amp = new Float32Array(frames * bins);
  for (let i = 0; i < frames; i++) {
    const s = i * hop;
    for (let k = 0; k < m; k++) re[k] = x[s + k];
    detrendInPlace(re, m, detrend);
    frameAmplitudes(re, im, m, w, amp.subarray(i * bins, (i + 1) * bins));
    t[i] = (s + (m - 1) / 2) * dt;
  }
  return { t, f, amp, frames, bins, size: m, hop };
}


const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch'];
const fmt = (v) => String(Number(v.toPrecision(4)));

function biquad(type, w0, q) {
  const c = Math.cos(w0), alpha = Math.sin(w0) / (2 * q);
  const omc = 2 * Math.sin(w0 / 2) ** 2, opc = 2 * Math.cos(w0 / 2) ** 2;
  const num = {
    lowpass: [omc / 2, omc, omc / 2],
    highpass: [opc / 2, -opc, opc / 2],
    bandpass: [alpha, 0, -alpha],
    notch: [1, -2 * c, 1],
  }[type];
  const a0 = 1 + alpha;
  return { b0: num[0] / a0, b1: num[1] / a0, b2: num[2] / a0, a1: (-2 * c) / a0, a2: (1 - alpha) / a0 };
}

function designFilter({ type = 'lowpass', f0, q = Math.SQRT1_2, order = 2, dt } = {}) {
  if (!FILTER_TYPES.includes(type)) throw new Error(`filter type "${type}": expected one of ${FILTER_TYPES.join(', ')}`);
  checkDt(dt);
  const asked = Number(f0);
  if (!Number.isFinite(asked)) throw new Error(`filter f0: expected a number, got ${f0}`);
  const fMin = 1e-5 / dt, fMax = 0.49 / dt;
  const fc = Math.min(Math.max(asked, fMin), fMax);
  const clamped = fc !== asked;
  const w0 = 2 * Math.PI * fc * dt;
  const notes = [];
  if (clamped) notes.push(`f0 ${fmt(asked)} Hz clamped to ${fmt(fc)} Hz (${asked > fc ? 'limit 0.49/dt' : 'limit 1e-5/dt'})`);
  let sections, describe, ord = 2, Q = Number(q);
  if (type === 'lowpass' || type === 'highpass') {
    const want = Number(order);
    ord = Number.isFinite(want) ? Math.min(8, Math.max(2, 2 * Math.round(want / 2))) : 2;
    if (ord !== want) notes.push(`order ${order} taken as ${ord}`);
    sections = [];
    for (let k = 1; k <= ord / 2; k++) sections.push(biquad(type, w0, 1 / (2 * Math.cos(((2 * k - 1) * Math.PI) / (2 * ord)))));
    describe = `Butterworth ${type} ${fmt(fc)} Hz, order ${ord}`;
  } else {
    if (!(Q > 0)) throw new Error(`filter q: expected a number > 0, got ${q}`);
    sections = [biquad(type, w0, Q)];
    describe = `${type} ${fmt(fc)} Hz, Q ${fmt(Q)}`;
  }
  if (notes.length) describe += `; ${notes.join('; ')}`;
  return { type, f0: fc, q: Q, order: ord, dt, sections, describe, clamped };
}

function runSection({ b0, b1, b2, a1, a2 }, y) {
  const x0 = y[0];
  const den = 1 + a1 + a2;
  const ys = den !== 0 ? ((b0 + b1 + b2) / den) * x0 : 0;
  let z1 = (b1 + b2) * x0 - (a1 + a2) * ys;
  let z2 = b2 * x0 - a2 * ys;
  for (let k = 0; k < y.length; k++) {
    const xk = y[k];
    const yk = b0 * xk + z1;
    z1 = b1 * xk - a1 * yk + z2;
    z2 = b2 * xk - a2 * yk;
    y[k] = yk;
  }
}

function settleSamples(filter) {
  let r = 0;
  for (const { a1, a2 } of filter.sections) {
    const d = a1 * a1 - 4 * a2;
    const rs = d < 0 ? Math.sqrt(a2) : Math.max(Math.abs(-a1 + Math.sqrt(d)), Math.abs(-a1 - Math.sqrt(d))) / 2;
    r = Math.max(r, rs);
  }
  return r > 0 && r < 1 ? Math.ceil(Math.log(1e-3) / Math.log(r)) : Infinity;
}

function applyFilter(filter, x, { zeroPhase = false } = {}) {
  const n = x.length;
  if (!zeroPhase || n < 2) {
    const y = Float64Array.from(x);
    if (n) for (const s of filter.sections) runSection(s, y);
    if (n && zeroPhase) for (const s of filter.sections) runSection(s, y);
    return y;
  }
  const pad = Math.min(n - 1, settleSamples(filter));
  const y = new Float64Array(n + 2 * pad);
  for (let k = 0; k < n; k++) y[pad + k] = x[k];
  for (let k = 1; k <= pad; k++) {
    y[pad - k] = 2 * x[0] - x[k];
    y[pad + n - 1 + k] = 2 * x[n - 1] - x[n - 1 - k];
  }
  for (const s of filter.sections) runSection(s, y);
  y.reverse();
  for (const s of filter.sections) runSection(s, y);
  y.reverse();
  return y.slice(pad, pad + n);
}

function filterResponse(filter, f, dt = filter.dt) {
  checkDt(dt);
  const n = f.length;
  const mag = new Float64Array(n), phaseDeg = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = 2 * Math.PI * f[i] * dt;
    const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    let m = 1, ph = 0;
    for (const { b0, b1, b2, a1, a2 } of filter.sections) {
      const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2);
      const dr = 1 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
      m *= Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
      ph += Math.atan2(ni * dr - nr * di, nr * dr + ni * di);
    }
    mag[i] = m;
    phaseDeg[i] = (ph * 180) / Math.PI;
  }
  return { mag, phaseDeg };
}

const PEAK_EXPONENT = { hann: 0.23, hamming: 0.19, blackman: 0.13 };

function peaks(f, amp, { count = 8, minRel = 0.01, window = 'hann' } = {}) {
  if (!WINDOWS[window]) throw new Error(`window "${window}": expected one of ${Object.keys(WINDOWS).join(', ')}`);
  const e = PEAK_EXPONENT[window];
  const n = amp.length;
  let max = 0;
  for (let k = 1; k < n; k++) if (amp[k] > max) max = amp[k];
  if (!(max > 0)) return [];
  const floor = max * minRel;
  const found = [];
  for (let k = 1; k < n - 1; k++) {
    const a = amp[k];
    if (a > amp[k - 1] && a >= amp[k + 1] && a >= floor) found.push(k);
  }
  found.sort((i, j) => amp[j] - amp[i]);
  return found.slice(0, count).map((k) => {
    const b = amp[k];
    const A = (amp[k - 1] / b) ** (e ?? 1), C = (amp[k + 1] / b) ** (e ?? 1);
    const d = A - 2 + C;
    const p = d < 0 ? (0.5 * (A - C)) / d : 0;
    const gain = e ? Math.max(1 - 0.25 * (A - C) * p, 0) ** (1 / e) : 1;
    return { f: f[k] + (p * (f[k + 1] - f[k - 1])) / 2, amp: b * gain };
  });
}

function dbScale(amp, floorDb = -100) {
  const out = new Float32Array(amp.length);
  const floor = Math.pow(10, floorDb / 20);
  for (let k = 0; k < amp.length; k++) {
    const a = Math.abs(amp[k]);
    out[k] = a > floor ? 20 * Math.log10(a) : floorDb;
  }
  return out;
}


const DB_FLOOR = -240;

function framesIn(sg, t0, t1) {
  const hop = sg.t.length > 1 ? sg.t[1] - sg.t[0] : 0, frames = [];
  for (let i = 0; i < sg.frames; i++) if (sg.t[i] + hop / 2 >= t0 && sg.t[i] - hop / 2 <= t1) frames.push(i);
  return frames;
}

function spectrogramWindow(sg, values, { t0 = -Infinity, t1 = Infinity, f0 = 0, f1 = Infinity } = {}) {
  if (!sg.frames) return new Float32Array(0);
  const df = sg.f.length > 1 ? sg.f[1] - sg.f[0] : 1;
  const b0 = Math.max(0, Math.ceil(f0 / df - 0.5)), b1 = Math.min(sg.bins - 1, Math.floor(f1 / df + 0.5));
  const frames = framesIn(sg, t0, t1);
  if (b1 < b0 || !frames.length) return new Float32Array(0);
  const out = new Float32Array(frames.length * (b1 - b0 + 1));
  let q = 0;
  for (const i of frames) for (let b = b0; b <= b1; b++) out[q++] = values[i * sg.bins + b];
  return out;
}

function levelHistogram(values, lo, hi, bins) {
  const n = Math.max(1, Math.floor(bins)), width = (hi - lo) / n;
  if (!(width > 0)) throw new Error(`levelHistogram: need lo < hi, got ${lo}, ${hi}`);
  const counts = new Uint32Array(n);
  let below = 0, above = 0, total = 0;
  for (let k = 0; k < values.length; k++) {
    const v = values[k];
    if (Number.isNaN(v)) continue;
    total++;
    if (v < lo) below++;
    else if (v > hi) above++;
    else counts[Math.min(n - 1, Math.floor((v - lo) / width))]++;
  }
  return { lo, hi, width, counts, below, above, total };
}

function quantileSorted(sorted, q) {
  const n = sorted.length;
  if (!n) return NaN;
  const r = Math.min(1, Math.max(0, q)) * (n - 1), i = Math.floor(r), f = r - i;
  return i + 1 < n ? sorted[i] + f * (sorted[i + 1] - sorted[i]) : sorted[i];
}

function firstAbove(sorted, zero) {
  let a = 0, b = sorted.length;
  while (a < b) { const m = (a + b) >> 1; if (sorted[m] <= zero) a = m + 1; else b = m; }
  return a;
}

const AUTO_LEVELS = { margin: 10, depth: 80, span: 20, noiseMargin: 6 };
function autoLevels(values, { margin = AUTO_LEVELS.margin, depth = AUTO_LEVELS.depth, span = AUTO_LEVELS.span, zero = DB_FLOOR, noise = null } = {}) {
  const sorted = Float32Array.from(values).filter((v) => !Number.isNaN(v)).sort();
  const zeros = firstAbove(sorted, zero), real = sorted.subarray(zeros);
  if (!real.length) return null;
  const ceiling = real[real.length - 1], median = quantileSorted(real, 0.5);
  const from = Number.isFinite(noise) ? noise : median, raw = from + margin;
  const rule = raw > ceiling - span ? 'span' : raw < ceiling - depth ? 'depth' : Number.isFinite(noise) ? 'noise' : 'median';
  const floor = rule === 'span' ? ceiling - span : rule === 'depth' ? ceiling - depth : raw;
  return { floor, ceiling, median, rule, zeros, sorted };
}


const NOISE_EST = { reach: 4, line: 6, clip: 8, start: 0.1 };
const START_SHIFT = 10 * Math.log10(Math.LN2 / -Math.log(1 - NOISE_EST.start));
function rowNoise(s, clip) {
  let e = quantileSorted(s, NOISE_EST.start) + START_SHIFT;
  for (let k = 0; k < 4; k++) {
    let c = 0;
    while (c < s.length && s[c] <= e + clip) c++;
    if (!c) break;
    e = quantileSorted(s.subarray(0, c), 0.5);
  }
  return e;
}
function noiseLevel(sg, values, { t0 = -Infinity, t1 = Infinity, reach = NOISE_EST.reach, line = NOISE_EST.line, clip = NOISE_EST.clip, zero = DB_FLOOR } = {}) {
  if (!sg.frames) return null;
  const frames = framesIn(sg, t0, t1), bins = sg.bins;
  if (!frames.length) return null;
  const row = new Float32Array(bins).fill(NaN), col = new Float32Array(frames.length);
  for (let b = 0; b < bins; b++) {
    let m = 0, z = 0;
    for (const i of frames) { const v = values[i * bins + b]; if (v > zero) col[m++] = v; else z++; }
    if (m > z) row[b] = rowNoise(col.subarray(0, m).sort(), clip);
  }
  const has = [];
  for (let b = 0; b < bins; b++) if (!Number.isNaN(row[b])) has.push(b);
  if (!has.length) return null;
  for (let b = 0, j = 0; b < bins; b++) {
    if (!Number.isNaN(row[b])) continue;
    while (j + 1 < has.length && Math.abs(has[j + 1] - b) < Math.abs(has[j] - b)) j++;
    row[b] = row[has[j]];
  }
  const out = Float32Array.from(row);
  if (bins > 2) out.set(acrossRows(row.subarray(1, bins - 1), reach, line), 1);
  return out;
}
function acrossRows(row, reach, line) {
  const n = row.length, isLine = new Uint8Array(n);
  let bridged = row;
  for (let pass = 0; pass < 6; pass++) {
    const guess = runningMedian(bridged, reach);
    let added = false;
    for (let b = 0; b < n; b++) if (!isLine[b] && row[b] > guess[b] + line) { isLine[b] = 1; added = true; }
    if (!added) break;
    bridged = Float32Array.from(row);
    for (let b = 0; b < n; b++) {
      if (!isLine[b]) continue;
      let a = b - 1, z = b + 1;
      while (a >= 0 && isLine[a]) a--;
      while (z < n && isLine[z]) z++;
      bridged[b] = a < 0 && z >= n ? guess[b] : a < 0 ? row[z] : z >= n ? row[a] : row[a] + ((row[z] - row[a]) * (b - a)) / (z - a);
    }
  }
  const med = runningMedian(bridged, reach, true), out = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    const r = Math.min(1, b, n - 1 - b);
    let s = 0;
    for (let k = b - r; k <= b + r; k++) s += med[k];
    out[b] = s / (2 * r + 1);
  }
  return out;
}
function runningMedian(x, reach, centred = false) {
  const n = x.length, out = new Float32Array(n), win = new Float32Array(2 * reach + 1);
  for (let b = 0; b < n; b++) {
    const r = centred ? Math.min(reach, b, n - 1 - b) : reach;
    const a = Math.max(0, b - r), z = Math.min(n - 1, b + r), w = win.subarray(0, z - a + 1);
    w.set(x.subarray(a, z + 1));
    out[b] = quantileSorted(w.sort(), 0.5);
  }
  return out;
}

const NOISE_SPECTROGRAM = { window: 'blackman', reach: 6 };
function spectrogramNoise(x, dt, opts = {}, { t0 = -Infinity, t1 = Infinity, shown = null } = {}) {
  const sg = shown?.sg ?? spectrogram(x, dt, opts);
  if (!sg.frames) return null;
  const est = noiseLevel(sg, shown?.db ?? dbScale(sg.amp, DB_FLOOR), { t0, t1 });
  if (!est) return null;
  const sgB = spectrogram(x, dt, { ...opts, window: NOISE_SPECTROGRAM.window });
  const estB = noiseLevel(sgB, dbScale(sgB.amp, DB_FLOOR), { t0, t1, reach: NOISE_SPECTROGRAM.reach });
  if (!estB) return est;
  const bw = (name) => { const w = windowOf(name, sg.size); let s = 0, s2 = 0; for (const v of w) { s += v; s2 += v * v; } return (s2 * w.length) / (s * s); };
  const c = 10 * Math.log10(bw(NOISE_SPECTROGRAM.window) / bw(opts.window ?? 'hann'));
  for (let b = 0; b < est.length; b++) est[b] = Math.min(est[b], estB[b] - c);
  return est;
}

function aboveNoise(values, noise, bins, zero = DB_FLOOR) {
  const out = new Float32Array(values.length);
  for (let k = 0; k < values.length; k++) {
    const v = values[k];
    out[k] = v > zero ? v - noise[k % bins] : zero;
  }
  return out;
}

function levelRange(sorted, levels, zero = DB_FLOOR) {
  let lo = -100, hi = 0;
  const real = sorted.subarray ? sorted.subarray(firstAbove(sorted, zero)) : sorted.slice(firstAbove(sorted, zero));
  if (real.length) {
    hi = 10 * Math.ceil((real[real.length - 1] + 5) / 10) + 0;   
    lo = Math.max(hi - 200, 10 * Math.floor((quantileSorted(real, 0.01) - 5) / 10));
  }
  if (levels) { lo = Math.min(lo, 10 * Math.floor(levels[0] / 10)); hi = Math.max(hi, 10 * Math.ceil(levels[1] / 10)); }
  if (hi - lo < 20) lo = hi - 20;
  return [lo, hi];
}

return { nextPow2, fft, WINDOWS, coherentGain, amplitudeSpectrum, spectrogram, designFilter, applyFilter, filterResponse, peaks, dbScale, DB_FLOOR, spectrogramWindow, levelHistogram, quantileSorted, AUTO_LEVELS, autoLevels, NOISE_EST, noiseLevel, NOISE_SPECTROGRAM, spectrogramNoise, aboveNoise, levelRange };
})();
// ---- core/analysis.js
__mods['core/analysis.js'] = (() => {

const { c2d, eig, eigPerturbed, csolve, solve } = __mods['core/linalg.js'];
const zerosM = (r, c) => Array.from({ length: r }, () => new Array(c).fill(0));
const col = (M, j) => M.map((row) => row[j]);
const cabs = (z) => Math.hypot(z.re, z.im);
const byRealThenImag = (a, b) => b.re - a.re || b.im - a.im;
const angleDeg = (g) => (Math.atan2(g.im, g.re) * 180) / Math.PI;
const rotate = (g, a) => { const c = Math.cos(a), s = Math.sin(a); return { re: g.re * c - g.im * s, im: g.re * s + g.im * c }; };

const ON_CIRCLE = 1e-7;
const NEAR = 1e-3;
const AT_ORIGIN = 1e-3;

const sideOf = (r) => (r > 1 + ON_CIRCLE ? 'out' : r < 1 - ON_CIRCLE ? 'in' : 'on');

function groups(idx, link) {
  const root = new Map(idx.map((i) => [i, i]));
  const find = (i) => (root.get(i) === i ? i : find(root.get(i)));
  for (let a = 0; a < idx.length; a++) for (let b = a + 1; b < idx.length; b++) if (link(idx[a], idx[b])) root.set(find(idx[a]), find(idx[b]));
  const out = new Map();
  for (const i of idx) { const r = find(i); if (!out.has(r)) out.set(r, []); out.get(r).push(i); }
  return [...out.values()];
}

function poleSides(poles, M) {
  const sides = poles.map((p) => sideOf(cabs(p)));
  if (!M) return sides;
  const dist = (p, q) => Math.hypot(p.re - q.re, p.im - q.im);
  const near = poles.map((p, i) => i).filter((i) => Math.abs(cabs(poles[i]) - 1) < NEAR);
  const mixed = groups(near, (i, j) => dist(poles[i], poles[j]) < NEAR).filter((g) => g.length > 1 && new Set(g.map((i) => sides[i])).size > 1);
  if (!mixed.length) return sides;
  const moved = eigPerturbed(M);
  for (const g of mixed) {
    const move = new Map(g.map((i) => [i, Math.min(...moved.map((q) => dist(poles[i], q)))]));
    const loose = g.filter((i) => move.get(i) > 0.25 * Math.min(...poles.map((q, j) => (j === i ? Infinity : dist(poles[i], q)))));
    for (const ring of groups(loose, (i, j) => dist(poles[i], poles[j]) <= 4 * Math.max(move.get(i), move.get(j)))) {
      if (ring.length < 2) continue;
      const re = ring.reduce((s, i) => s + poles[i].re, 0) / ring.length, im = ring.reduce((s, i) => s + poles[i].im, 0) / ring.length;
      for (const i of ring) sides[i] = sideOf(Math.hypot(re, im));
    }
  }
  return sides;
}

function discretePlant(plant, Ts, { use, drop = 0 } = {}) {
  const { Ad, Bd } = c2d(plant.A, plant.B, Ts);
  const n = Ad.length, m = plant.C.length, D0 = plant.D ?? zerosM(m, 1);
  const delaySamples = Array.from({ length: m }, (_, k) => Math.max(0, (plant.delay?.[k] ?? 0) / Ts));
  const taps = delaySamples.map((ds, k) => {
    const whole = Math.floor(ds + 1e-9), frac = ds - whole;
    if (frac <= 1e-9) return { len: whole, c: plant.C[k], d: D0[k][0] };
    const { Ad: Phi, Bd: Gam } = c2d(plant.A, plant.B, (1 - frac) * Ts);
    const c = Array.from({ length: n }, (_, j) => plant.C[k].reduce((s, v, i) => s + v * Phi[i][j], 0));
    return { len: whole + 1, c, d: D0[k][0] + plant.C[k].reduce((s, v, i) => s + v * Gam[i][0], 0) };
  });
  const len = taps.map((t, k) => (use && !use[k] ? 0 : Math.max(0, t.len - drop)));
  const N = n + len.reduce((a, b) => a + b, 0);
  const A = zerosM(N, N), B = zerosM(N, 1), C = zerosM(m, N), D = zerosM(m, 1);
  for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) A[i][j] = Ad[i][j]; B[i][0] = Bd[i][0]; }
  let o = n;
  for (let k = 0; k < m; k++) {
    const t = taps[k];
    if (!len[k]) { for (let j = 0; j < n; j++) C[k][j] = t.c[j]; D[k][0] = t.d; continue; }
    for (let j = 0; j < n; j++) A[o][j] = t.c[j];
    B[o][0] = t.d;
    for (let i = 1; i < len[k]; i++) A[o + i][o + i - 1] = 1;
    C[k][o + len[k] - 1] = 1;
    o += len[k];
  }
  return { A, B, C, D, delaySamples, delayStates: len, Ad, Bd, plantStates: n, taps: taps.map((t, k) => ({ c: t.c, d: t.d, len: len[k] })) };
}

function assemble(P, ctrl, Bcy, Dcy) {
  const Ad = P.A, Bd = P.B, Cp = P.C, Dp = P.D;
  const n = Ad.length, m = Cp.length, nc = ctrl.A.length, N = n + nc;
  const A = zerosM(N, N), B = zerosM(N, 1), C = [new Array(N).fill(0)];
  for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) A[i][j] = Ad[i][j]; B[i][0] = Bd[i][0]; }
  for (let i = 0; i < nc; i++) {
    for (let j = 0; j < nc; j++) A[n + i][n + j] = ctrl.A[i][j];
    for (let j = 0; j < n; j++) { let s = 0; for (let k = 0; k < m; k++) s += Bcy[i][k] * Cp[k][j]; A[n + i][j] = s; }
    let s = 0; for (let k = 0; k < m; k++) s += Bcy[i][k] * Dp[k][0]; B[n + i][0] = s;
  }
  for (let j = 0; j < n; j++) { let s = 0; for (let k = 0; k < m; k++) s += Dcy[k] * Cp[k][j]; C[0][j] = -s; }
  for (let j = 0; j < nc; j++) C[0][n + j] = -ctrl.C[0][j];
  let D = 0; for (let k = 0; k < m; k++) D -= Dcy[k] * Dp[k][0];
  return { A, B, C, D };
}

function openLoop(plant, ctrl, Ts) {
  const m = plant.C.length;
  const cols = (row) => Array.from({ length: m }, (_, k) => row[1 + k] ?? 0);
  const Bcy = ctrl.B.map(cols), Dcy = cols(ctrl.D[0]);
  const use = Array.from({ length: m }, (_, k) => Dcy[k] !== 0 || Bcy.some((r) => r[k] !== 0));
  const P = discretePlant(plant, Ts, { use });
  const L = assemble(P, ctrl, Bcy, Dcy);
  const read = P.delayStates.filter((_, k) => use[k]);
  const d = read.length ? Math.min(...read) : 0;
  const core = d ? { ...assemble(discretePlant(plant, Ts, { use, drop: d }), ctrl, Bcy, Dcy), Ts } : null;
  const freq = { Ad: P.Ad, Bd: P.Bd, taps: P.taps, use, ctrl: { A: ctrl.A, B: Bcy, C: ctrl.C[0] ?? [], D: Dcy } };
  return {
    ...L, Ts, n: L.A.length, delaySamples: P.delaySamples, pureDelay: d, core, freq,
    spread: read.length ? Math.max(...read) - d : 0,
    parts: { plant: P.Ad, chains: P.A.length - P.plantStates, ctrl: ctrl.A },
  };
}

function openLoopSides(L) {
  if (!L.parts) { const poles = eig(L.A); return { poles, sides: poleSides(poles, L.A) }; }
  const pl = eig(L.parts.plant), ct = eig(L.parts.ctrl), sp = poleSides(pl, L.parts.plant), sc = poleSides(ct, L.parts.ctrl);
  const all = [
    ...pl.map((z, i) => [z, sp[i]]),
    ...Array.from({ length: L.parts.chains }, () => [{ re: 0, im: 0 }, 'in']),
    ...ct.map((z, i) => [z, sc[i]]),
  ].sort((a, b) => byRealThenImag(a[0], b[0]));
  return { poles: all.map((x) => x[0]), sides: all.map((x) => x[1]) };
}
const openLoopPoles = (L) => openLoopSides(L).poles;

function closedLoopMatrix(L, k) {
  const den = 1 + k * L.D;
  if (Math.abs(den) < 1e-12) return null;
  return L.A.map((row, i) => row.map((v, j) => v - (k * L.B[i][0] * L.C[0][j]) / den));
}

function closedLoop(L, k = 1) {
  const M = closedLoopMatrix(L, k);
  return M ? eig(M) : [];
}

function closedLoopSides(L, k = 1) {
  const M = closedLoopMatrix(L, k);
  if (!M) return { poles: [], sides: [] };
  const poles = eig(M);
  return { poles, sides: poleSides(poles, M) };
}

const classOf = (sides) => (sides.includes('out') ? 'unstable' : sides.includes('on') ? 'marginal' : 'stable');

function sOf(z, Ts) {
  const r = Math.hypot(z.re, z.im);
  if (r < 1e-300) return { re: -Infinity, im: 0, wn: Infinity, zeta: 1 };
  const re = Math.log(r) / Ts, im = Math.atan2(z.im, z.re) / Ts, wn = Math.hypot(re, im);
  return { re, im, wn, zeta: wn > 0 ? -re / wn : 1 };
}

function sPlanePoint(z, Ts) {
  if (Math.hypot(z.re, z.im) < AT_ORIGIN) return null;
  const s = sOf(z, Ts);
  return Number.isFinite(s.re) ? [s.re, s.im] : null;
}

function respondAt(L, w) {
  if (L.freq) return respondParts(L.freq, L.Ts, w, 0);
  if (L.core) return rotate(respondAt(L.core, w), -w * L.Ts * L.pureDelay);
  const N = L.A.length, zr = Math.cos(w * L.Ts), zi = Math.sin(w * L.Ts);
  if (!N) return { re: L.D, im: 0 };
  const Mr = L.A.map((row, i) => row.map((v, j) => (i === j ? zr : 0) - v));
  const Mi = L.A.map((row, i) => row.map((_, j) => (i === j ? zi : 0)));
  const x = csolve(Mr, Mi, col(L.B, 0), new Array(N).fill(0));
  if (!x) return { re: NaN, im: NaN };
  let re = L.D, im = 0;
  for (let i = 0; i < N; i++) { re += L.C[0][i] * x.xr[i]; im += L.C[0][i] * x.xi[i]; }
  return { re, im };
}

function coreAt(L, w) {
  if (L.freq) return respondParts(L.freq, L.Ts, w, L.pureDelay);
  return respondAt(L.core ?? L, w);
}

function respondParts(F, Ts, w, shift) {
  const zr = Math.cos(w * Ts), zi = Math.sin(w * Ts);
  const n = F.Ad.length;
  let X = { xr: [], xi: [] };
  if (n) X = csolve(F.Ad.map((row, i) => row.map((v, j) => (i === j ? zr : 0) - v)), F.Ad.map((row, i) => row.map((_, j) => (i === j ? zi : 0))), col(F.Bd, 0), new Array(n).fill(0));
  const c = F.ctrl, nc = c.A.length;
  let Y = { xr: [], xi: [] };
  if (nc) Y = csolve(c.A.map((row, i) => row.map((_, j) => (i === j ? zr : 0) - c.A[j][i])), c.A.map((row, i) => row.map((_, j) => (i === j ? zi : 0))), c.C.slice(), new Array(nc).fill(0));
  if (!X || !Y) return { re: NaN, im: NaN };
  let re = 0, im = 0;
  F.taps.forEach((t, k) => {
    if (!F.use[k]) return;
    let gr = t.d, gi = 0;
    for (let j = 0; j < n; j++) { gr += t.c[j] * X.xr[j]; gi += t.c[j] * X.xi[j]; }
    let kr = c.D[k], ki = 0;
    for (let j = 0; j < nc; j++) { kr += Y.xr[j] * c.B[j][k]; ki += Y.xi[j] * c.B[j][k]; }
    const g = rotate({ re: gr * kr - gi * ki, im: gr * ki + gi * kr }, -w * Ts * (t.len - shift));
    re -= g.re; im -= g.im;
  });
  return { re, im };
}

function frequencyData(L, { points = 400, wmin } = {}) {
  const wN = Math.PI / L.Ts, hi = 0.999 * wN, lo = Math.min(wmin ?? wN * 1e-4, wN * 1e-2);
  const delay = L.core || L.freq ? L.pureDelay * L.Ts : 0;
  let w = Array.from({ length: points }, (_, i) => lo * (hi / lo) ** (i / (points - 1)));
  if (L.spread > 0) {
    const dw = (2 * Math.PI) / (L.spread * L.Ts) / 24;
    w = [...new Set([...w, ...Array.from({ length: Math.floor((hi - lo) / dw) }, (_, i) => lo + (i + 1) * dw)])].sort((a, b) => a - b);
  }
  const cap = 4 * w.length;
  let G = w.map((x) => coreAt(L, x));
  for (let pass = 0; pass < 8; pass++) {
    const nw = [w[0]], nG = [G[0]];
    let added = 0;
    for (let i = 1; i < w.length; i++) {
      let step = Math.abs(angleDeg(G[i]) - angleDeg(G[i - 1]));
      step = Math.min(step, 360 - step);
      if (step > 45 && w.length + added < cap) { const wm = Math.sqrt(w[i - 1] * w[i]); nw.push(wm); nG.push(coreAt(L, wm)); added++; }
      nw.push(w[i]); nG.push(G[i]);
    }
    w = nw; G = nG;
    if (!added) break;
  }
  const phase0 = [];
  for (let i = 0; i < G.length; i++) {
    let ph = angleDeg(G[i]);
    if (i) ph += 360 * Math.round((phase0[i - 1] - ph) / 360);
    else if (ph > 0) ph -= 360;   
    phase0.push(ph);
  }
  const full = delay ? G.map((g, i) => rotate(g, -w[i] * delay)) : G;
  return {
    w, re: full.map((g) => g.re), im: full.map((g) => g.im), mag: G.map((g) => Math.hypot(g.re, g.im)),
    phase: phase0.map((p, i) => p - (w[i] * delay * 180) / Math.PI), phase0, delay,
  };
}

function phaseAt(fd, L, w) {
  const ws = fd.w;
  let i = 1, j = ws.length - 1;
  while (i < j) { const m = (i + j) >> 1; if (ws[m] < w) i = m + 1; else j = m; }
  const f = Math.min(1, Math.max(0, (Math.log(w) - Math.log(ws[i - 1])) / (Math.log(ws[i]) - Math.log(ws[i - 1]))));
  const ref = fd.phase0[i - 1] + f * (fd.phase0[i] - fd.phase0[i - 1]);
  let ph = angleDeg(coreAt(L, w));
  ph += 360 * Math.round((ref - ph) / 360);
  return ph - (w * fd.delay * 180) / Math.PI;
}

function bisect(fn, a, b, fa = fn(a)) {
  for (let it = 0; it < 48; it++) {
    const m = (a + b) / 2, fm = fn(m);
    if ((fm <= 0) === (fa <= 0)) { a = m; fa = fm; } else b = m;
  }
  return (a + b) / 2;
}

function gainRange(L, gains, probe = []) {
  const memo = new Map();
  const cls = (k) => {
    if (!memo.has(k)) { const { poles, sides } = closedLoopSides(L, k); memo.set(k, poles.length ? classOf(sides) : 'unstable'); }
    return memo.get(k);
  };
  const ks = [...new Set(gains.filter((k) => k > 0 && Number.isFinite(k)))].sort((a, b) => a - b);
  for (let i = 1; i < probe.length; i++) {
    const a = probe[i - 1], b = probe[i], ca = a.sides ? classOf(a.sides) : cls(a.k), cb = b.sides ? classOf(b.sides) : cls(b.k);
    if (ca === cb || ks.some((k) => k > a.k && k <= b.k)) continue;
    let lo = a.k, hi = b.k;
    for (let it = 0; it < 50; it++) { const m = Math.sqrt(lo * hi); if (cls(m) === ca) lo = m; else hi = m; }
    ks.push(Math.sqrt(lo * hi));
  }
  ks.sort((a, b) => a - b);
  const edges = [0, ...ks, Infinity], n = edges.length - 1;
  let h = 0;
  while (h < n - 1 && edges[h + 1] <= 1) h++;
  const at = (i) => { const a = edges[i], b = edges[i + 1]; return cls(i === h ? 1 : a === 0 ? b / 2 : b === Infinity ? 2 * a : Math.sqrt(a * b)); };
  const grow = (i, ok) => { let lo = i, hi = i; while (lo > 0 && ok(at(lo - 1))) lo--; while (hi < n - 1 && ok(at(hi + 1))) hi++; return { lo, hi }; };
  const tuned = at(h), kept = (c) => c !== 'unstable', isStable = (c) => c === 'stable';
  const here = grow(h, kept(tuned) ? kept : (c) => c === 'unstable'), down = edges[here.lo], up = edges[here.hi + 1];
  if (kept(tuned)) return { down, up, ok: true, stable: { lo: down, hi: up } };
  for (let a = here.lo - 1, b = here.hi + 1; a >= 0 || b < n;) {
    const da = a >= 0 ? -Math.log(edges[a + 1]) : Infinity, db = b < n ? Math.log(edges[b]) : Infinity;
    const i = da <= db ? a-- : b++;
    if (isStable(at(i))) { const s = grow(i, isStable); return { down, up, ok: false, stable: { lo: edges[s.lo], hi: edges[s.hi + 1] } }; }
  }
  return { down, up, ok: false, stable: null };
}

function loopMargins(fd, Ts, { L, poles = [], probe = [] } = {}) {
  const { w, mag, phase, re, im } = fd;
  const lerp = (a, b, f) => a + (b - a) * f;
  const gainCrossings = [], phaseCrossings = [];
  for (let i = 1; i < w.length; i++) {
    const a = Math.log(mag[i - 1]), b = Math.log(mag[i]), la = Math.log(w[i - 1]), lb = Math.log(w[i]);
    if (Number.isFinite(a) && Number.isFinite(b) && a * b <= 0 && a !== b) {
      const f = a / (a - b);
      const wc = L ? Math.exp(bisect((x) => Math.log(cabs(respondAt(L, Math.exp(x)))), la, lb, a)) : Math.exp(lerp(la, lb, f));
      const ph = L ? phaseAt(fd, L, wc) : lerp(phase[i - 1], phase[i], f);
      const pm = ((((ph + 180) % 360) + 540) % 360) - 180;
      const dm = ((((ph + 180) % 360) + 360) % 360) * (Math.PI / 180) / wc;
      gainCrossings.push({ w: wc, pm, dm, dmSamples: dm / Ts });
    }
    const pa = phase[i - 1], pb = phase[i];
    for (let k = Math.ceil((Math.min(pa, pb) + 180) / 360); 360 * k - 180 <= Math.max(pa, pb); k++) {
      const target = 360 * k - 180;
      if (target === Math.min(pa, pb) && pa !== pb) continue;   
      let wx, mx;
      if (L) {
        wx = Math.exp(bisect((x) => phaseAt(fd, L, Math.exp(x)) - target, la, lb, pa - target));
        mx = cabs(respondAt(L, wx));
      } else {
        const f = (target - pa) / (pb - pa);
        wx = Math.exp(lerp(la, lb, f)); mx = Math.exp(lerp(Math.log(mag[i - 1]), Math.log(mag[i]), f));
      }
      phaseCrossings.push({ w: wx, mag: mx, gm: 1 / mx, gmDb: -20 * Math.log10(mx) });
    }
  }
  if (L) {
    for (const [wx, z, at] of [[0, 1, 'dc'], [Math.PI / Ts, -1, 'nyquist']]) {
      if (poles.some((p) => Math.hypot(p.re - z, p.im) < 1e-6)) continue;
      const g = respondAt(L, wx).re;
      if (!(g < 0) || !Number.isFinite(g)) continue;
      if (phaseCrossings.some((c) => Math.abs(Math.log(c.mag / -g)) < 1e-6)) continue;
      phaseCrossings.push({ w: wx, mag: -g, gm: -1 / g, gmDb: -20 * Math.log10(-g), at });
    }
  }
  let ms = 0, wMs = NaN, mt = 0, wMt = NaN, iS = -1, iT = -1;
  for (let i = 0; i < w.length; i++) {
    const d = Math.hypot(1 + re[i], im[i]);
    if (1 / d > ms) { ms = 1 / d; wMs = w[i]; iS = i; }
    if (mag[i] / d > mt) { mt = mag[i] / d; wMt = w[i]; iT = i; }
  }
  if (L) {
    const peak = (i, g) => {
      let a = Math.log(w[Math.max(0, i - 1)]), b = Math.log(w[Math.min(w.length - 1, i + 1)]);
      const q = (Math.sqrt(5) - 1) / 2;
      let c = b - q * (b - a), d = a + q * (b - a), fc = g(Math.exp(c)), fd = g(Math.exp(d));
      for (let it = 0; it < 60 && b - a > 1e-12; it++) {
        if (fc > fd) { b = d; d = c; fd = fc; c = b - q * (b - a); fc = g(Math.exp(c)); } else { a = c; c = d; fc = fd; d = a + q * (b - a); fd = g(Math.exp(d)); }
      }
      return fc > fd ? [fc, Math.exp(c)] : [fd, Math.exp(d)];
    };
    const S = (x) => { const v = respondAt(L, x); return 1 / Math.hypot(1 + v.re, v.im); };
    const T = (x) => { const v = respondAt(L, x); return Math.hypot(v.re, v.im) / Math.hypot(1 + v.re, v.im); };
    if (iS >= 0) { const [v, x] = peak(iS, S); if (v > ms) { ms = v; wMs = x; } }
    if (iT >= 0) { const [v, x] = peak(iT, T); if (v > mt) { mt = v; wMt = x; } }
  }
  let range;
  if (L) range = gainRange(L, [...phaseCrossings.map((c) => c.gm), ...(L.D < 0 ? [-1 / L.D] : [])], probe);
  else {
    const up = phaseCrossings.filter((c) => c.gm > 1).map((c) => c.gm), down = phaseCrossings.filter((c) => c.gm < 1).map((c) => c.gm);
    range = { up: up.length ? Math.min(...up) : Infinity, down: down.length ? Math.max(...down) : 0, ok: true, stable: null };
  }
  const main = gainCrossings.reduce((best, c) => (!best || Math.abs(c.pm) < Math.abs(best.pm) ? c : best), null);
  return {
    gainCrossings, phaseCrossings,
    wc: main?.w ?? NaN, pm: main?.pm ?? Infinity, dm: main ? Math.min(...gainCrossings.map((c) => c.dm)) : Infinity,
    get dmSamples() { return this.dm / Ts; },
    gmUp: range.up, gmDown: range.down, stableGains: range.ok ? { lo: range.down, hi: range.up } : range.stable,
    ms, wMs, mt, wMt,
  };
}

function stepResponse(plant, ctrl, Ts, K = 200) {
  const P = discretePlant(plant, Ts), n = P.A.length, m = P.C.length, nc = ctrl.A.length;
  const col = (row, j) => row[j] ?? 0;
  const a = ctrl.Tr > 0 ? Math.exp(-Ts / ctrl.Tr) : 0;
  let xp = new Array(n).fill(0), xc = new Array(nc).fill(0), rf = 0;
  const t = [], y = [], u = [];
  for (let k = 0; k <= K; k++) {
    rf = a * rf + (1 - a);
    const ym = P.C.map((row) => row.reduce((s, c, j) => s + c * xp[j], 0));
    let uk = col(ctrl.D[0], 0) * rf;
    for (let j = 0; j < m; j++) uk += col(ctrl.D[0], 1 + j) * ym[j];
    for (let j = 0; j < nc; j++) uk += ctrl.C[0][j] * xc[j];
    t.push(k * Ts); y.push(ym[0]); u.push(uk);
    xp = P.A.map((row, i) => row.reduce((s, a, j) => s + a * xp[j], 0) + P.B[i][0] * uk);
    xc = ctrl.A.map((row, i) => row.reduce((s, a, j) => s + a * xc[j], 0) + col(ctrl.B[i], 0) * rf + ym.reduce((s, v, j) => s + col(ctrl.B[i], 1 + j) * v, 0));
  }
  return { t, y, u };
}

function closedLoopModel(plant, ctrl, Ts) {
  const S = loopModel(plant, ctrl, Ts);
  if (!(ctrl.Tr > 0)) return S;
  const a = Math.exp(-Ts / ctrl.Tr), N = S.A.length;
  const A = S.A.map((row, i) => [...row, S.B[i] * a]);
  A.push([...new Array(N).fill(0), a]);
  return { A, B: [...S.B.map((b) => b * (1 - a)), 1 - a], C: [...S.C, S.D * a], D: S.D * (1 - a), Ts };
}

function loopModel(plant, ctrl, Ts) {
  const m = plant.C.length, at = (row, j) => row[j] ?? 0;
  const dr = at(ctrl.D[0], 0), Dcy = Array.from({ length: m }, (_, k) => at(ctrl.D[0], 1 + k));
  const Bcr = ctrl.B.map((row) => at(row, 0)), Bcy = ctrl.B.map((row) => Array.from({ length: m }, (_, k) => at(row, 1 + k)));
  const use = Array.from({ length: m }, (_, k) => k === 0 || Dcy[k] !== 0 || Bcy.some((r) => r[k] !== 0));
  const P = discretePlant(plant, Ts, { use }), n = P.A.length, nc = ctrl.A.length, N = n + nc;
  const g = 1 / (1 - Dcy.reduce((s, d, k) => s + d * P.D[k][0], 0));
  const uRow = new Array(N).fill(0);
  for (let j = 0; j < n; j++) uRow[j] = g * Dcy.reduce((s, d, k) => s + d * P.C[k][j], 0);
  for (let j = 0; j < nc; j++) uRow[n + j] = g * ctrl.C[0][j];
  const ur = g * dr;
  const yRow = P.C.map((row, k) => Array.from({ length: N }, (_, j) => (j < n ? row[j] : 0) + P.D[k][0] * uRow[j]));
  const yr = P.D.map((d) => d[0] * ur);
  const A = zerosM(N, N), B = new Array(N).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < N; j++) A[i][j] = (j < n ? P.A[i][j] : 0) + P.B[i][0] * uRow[j];
    B[i] = P.B[i][0] * ur;
  }
  for (let i = 0; i < nc; i++) {
    for (let j = 0; j < N; j++) A[n + i][j] = (j >= n ? ctrl.A[i][j - n] : 0) + Bcy[i].reduce((s, b, k) => s + b * yRow[k][j], 0);
    B[n + i] = Bcr[i] + Bcy[i].reduce((s, b, k) => s + b * yr[k], 0);
  }
  return { A, B, C: yRow[0], D: yr[0], Ts };
}

function stepInfo(plant, ctrl, Ts, { clPoles, T, steps = 20000, budget = 3e8 } = {}) {
  const S = closedLoopModel(plant, ctrl, Ts), N = S.A.length;
  let yf = NaN;
  try {
    const x = solve(S.A.map((row, i) => row.map((v, j) => (i === j ? 1 : 0) - v)), S.B);
    yf = S.C.reduce((s, c, j) => s + c * x[j], 0) + S.D;
  } catch {   }
  const modes = (clPoles ? [...clPoles.map((p) => p.z), ...(ctrl.Tr > 0 ? [{ re: Math.exp(-Ts / ctrl.Tr), im: 0 }] : [])] : eig(S.A)).filter((z) => cabs(z) >= AT_ORIGIN).map((z) => sOf(z, Ts)).filter((v) => Number.isFinite(v.re));
  if (T === undefined) {
    const rates = modes.map((v) => -v.re).filter((v) => v > 0);
    T = Math.max(20 * Ts, 10 / Math.min(...rates, 1 / (5 * Ts)));
  }
  const K = Math.max(1, Math.ceil(T / Ts - 1e-9));
  const strideFor = (k1) => { let M = 1; while (M * steps < K - k1) M *= 2; return M; };
  let K1 = Math.min(K, steps);
  const cap = Math.max(steps, Math.floor(budget / Math.max(1, N * N)));
  for (let it = 0; it < 8 && K1 < K; it++) {
    const h = strideFor(K1) * Ts;
    const alive = modes.filter((v) => -v.re * h > 0.05 || Math.abs(v.im) * h > 0.2).map((v) => (v.re < 0 ? 20 / -v.re : Infinity));
    const need = Math.min(K, cap, Math.ceil(Math.max(0, ...alive) / Ts));
    if (need <= K1) break;
    K1 = need;
  }
  const A = S.A.map((row) => Float64Array.from(row)), B = Float64Array.from(S.B), C = Float64Array.from(S.C);
  const next = (x, AM, BM) => {
    const nx = new Float64Array(N);
    for (let i = 0; i < N; i++) { let v = BM[i]; const row = AM[i]; for (let j = 0; j < N; j++) v += row[j] * x[j]; nx[i] = v; }
    return nx;
  };
  const out = (x) => { let v = S.D; for (let j = 0; j < N; j++) v += C[j] * x[j]; return v; };
  const graded = Number.isFinite(yf) && Math.abs(yf) >= 1e-12;
  const outside = (v) => graded && Math.abs(v / yf - 1) > 0.02;
  let peak = -Infinity, last = -1;
  const see = (k, v) => { if (graded) { peak = Math.max(peak, v / yf); if (outside(v)) last = k; } };
  const t = [], y = [], q = Math.max(1, Math.ceil(K1 / steps));
  let bucket = [];
  const flush = () => { if (!bucket.length) return; const lo = bucket.reduce((a, b) => (b[1] < a[1] ? b : a)), hi = bucket.reduce((a, b) => (b[1] > a[1] ? b : a)); for (const p of lo[0] <= hi[0] ? [lo, hi] : [hi, lo]) if (t.at(-1) !== p[0] * Ts) { t.push(p[0] * Ts); y.push(p[1]); } bucket = []; };
  let x = new Float64Array(N), k = 0;
  const y0 = out(x);
  see(0, y0); t.push(0); y.push(y0);
  for (; k < K1; k++) {
    x = next(x, A, B);
    const v = out(x);
    see(k + 1, v);
    bucket.push([k + 1, v]);
    if (bucket.length >= q || k + 1 === K1) flush();
  }
  if (k < K) {
    const M = strideFor(k);
    let AM = A, BM = B;
    for (let m = 1; m < M; m *= 2) {
      BM = next(BM, AM, BM);
      AM = AM.map((row) => { const r = new Float64Array(N); for (let j = 0; j < N; j++) { let v = 0; for (let l = 0; l < N; l++) v += row[l] * AM[l][j]; r[j] = v; } return r; });
    }
    let lastX = null, lastK = -1;
    for (; k < K; k += M) {
      x = next(x, AM, BM);
      const v = out(x);
      see(k + M, v);
      if (last === k + M) { lastX = x; lastK = k + M; }
      t.push((k + M) * Ts); y.push(v);
    }
    if (lastX && lastK < k) {
      let xs = lastX;
      for (let j = lastK + 1; j < lastK + M; j++) { xs = next(xs, A, B); if (outside(out(xs))) last = j; }
    }
  }
  const res = { t, y, yf, T: k * Ts };
  if (!graded) return res;
  const settled = last < k;
  return { ...res, overshoot: Math.max(0, (peak - 1) * 100), settled, settle: settled ? (last + 1) * Ts : NaN };
}

function locus(L, ks) { return ks.map((k) => ({ k, ...closedLoopSides(L, k) })); }

function lowFrequency(L, sets) {
  const wN = Math.PI / L.Ts;
  let r = Infinity;
  for (const [poles, sides] of sets) poles.forEach((z, i) => {
    if (cabs(z) < AT_ORIGIN || (sides[i] === 'on' && Math.abs(Math.atan2(z.im, z.re)) < 1e-6)) return;
    const s = sOf(z, L.Ts), a = Math.hypot(s.re, s.im);
    if (a > 0) r = Math.min(r, a);
  });
  let lo = Math.min(Math.max(Number.isFinite(r) ? 0.1 * r : wN * 1e-4, wN * 1e-9), wN * 1e-2);
  const mag = (w) => cabs(respondAt(L, w));
  for (let i = 0; i < 6 && lo > wN * 1e-9; i++) {
    const a = mag(lo), b = mag(lo / 10);
    if (!((a < 1 && b > 1.2 * a) || (a > 1 && b < a / 1.2))) break;
    lo /= 10;
    if ((a - 1) * (b - 1) <= 0) break;
  }
  return lo;
}

function analyzeLoop(plant, ctrl, Ts, { points = 400 } = {}) {
  const L = openLoop(plant, ctrl, Ts);
  const { poles: olPoles, sides: olSides } = openLoopSides(L), { poles: clZ, sides: clSides } = closedLoopSides(L, 1);
  const count = (sides, s) => sides.filter((x) => x === s).length;
  const P = count(olSides, 'out'), Z = count(clSides, 'out'), onClosed = count(clSides, 'on');
  const fd = frequencyData(L, { points, wmin: lowFrequency(L, [[olPoles, olSides], [clZ, clSides]]) });
  const nk = L.n <= 40 ? 121 : Math.max(41, Math.round((121 * 40) / L.n));
  const ks = Array.from({ length: nk }, (_, i) => 10 ** (-2 + (4 * i) / (nk - 1)));
  const loc = locus(L, ks);
  const margins = loopMargins(fd, Ts, { L, poles: olPoles, probe: loc });
  const cl = clZ.map((z, i) => {
    if (clSides[i] !== 'on') return { z, s: sOf(z, Ts), side: clSides[i] };
    const im = Math.atan2(z.im, z.re) / Ts;
    return { z, s: { re: 0, im, wn: Math.abs(im), zeta: Math.abs(im) > 1e-6 ? 0 : 1 }, side: 'on' };
  });
  const oscillating = cl.filter((p) => Math.abs(p.s.im) > 1e-6);
  const zetaMin = oscillating.length ? Math.min(...oscillating.map((p) => p.s.zeta)) : 1;
  const slowest = cl.filter((p) => Number.isFinite(p.s.re) && cabs(p.z) >= AT_ORIGIN).reduce((a, p) => (!a || p.s.re > a.s.re ? p : a), null);
  return {
    L, Ts, olPoles, olSides, clPoles: cl, P, Z, N: Z - P,
    stable: Z === 0 && onClosed === 0, marginal: Z === 0 && onClosed > 0,
    onCircle: { open: count(olSides, 'on'), closed: onClosed },
    zetaMin, slowest, fd, margins, locus: loc,
  };
}

return { ON_CIRCLE, AT_ORIGIN, poleSides, discretePlant, openLoop, openLoopPoles, closedLoop, closedLoopSides, sOf, sPlanePoint, respondAt, frequencyData, phaseAt, gainRange, loopMargins, stepResponse, closedLoopModel, stepInfo, locus, analyzeLoop };
})();
// ---- core/autotune.js
__mods['core/autotune.js'] = (() => {

const { simulateSystem } = __mods['core/sim.js'];
const { defaultSampleTime, loopModel } = __mods['core/project.js'];
const { analyzeLoop } = __mods['core/analysis.js'];
const { normalizeVariant, makeLaw, CONTROLLERS } = __mods['core/controllers.js'];
const { parseEnd, blockPorts, compileDiagram } = __mods['core/diagram.js'];
const { blockMode, EXTERNAL_BLOCK } = __mods['core/hil.js'];
const { amplitudeSpectrum } = __mods['core/spectrum.js'];
const DIVERGED = 100;        
const OVERSHOOT_WEIGHT = 2;  
const LOG_LIMIT = Math.log(1000);

function drain(gen) {
  for (;;) { const s = gen.next(); if (s.done) return s.value; }
}

function controllerBlocks(diagram) {
  const out = [];
  const walk = (d, path, where) => {
    for (const b of d.blocks) {
      if (b.type === 'controller') out.push({ path: [...path, b.id], key: [...path, b.id].join('/'), block: b, where: [...where, b.name ?? b.id].join(' / ') });
      if (b.type === 'subsystem') walk(b.diagram, [...path, b.id], [...where, b.name ?? b.id]);
    }
  };
  if (diagram) walk(diagram, [], []);
  return out;
}

function externalBlock(diagram) {
  for (const b of diagram.blocks) {
    if (b.type === 'external') return b;
    const inner = b.type === 'subsystem' ? externalBlock(b.diagram) : null;
    if (inner) return inner;
  }
  return null;
}

function locate(diagram, path) {
  let level = diagram;
  for (const id of path.slice(0, -1)) level = level.blocks.find((b) => b.id === id).diagram;
  return { level, block: level.blocks.find((b) => b.id === path.at(-1)) };
}

function withVariant(diagram, path, variant) {
  const d = structuredClone(diagram);
  const { block } = locate(d, path);
  block.variants = [variant];
  block.variant = 0;
  return d;
}

const wireTo = (level, id, port) => level.wires.find((w) => { const e = parseEnd(w.to); return e.id === id && e.port === port; });
const portBlocks = (d, type) => d.blocks.filter((b) => b.type === type).sort((a, c) => a.params.port - c.params.port);

function upstreamSource(diagram, path, port) {
  const frames = [{ d: diagram }];
  for (const id of path.slice(0, -1)) frames.push({ d: frames.at(-1).d.blocks.find((b) => b.id === id).diagram, sub: id });
  let id = path.at(-1), p = port;
  for (let hop = 0; hop < 200; hop++) {
    const { d } = frames.at(-1);
    const w = wireTo(d, id, p);
    if (!w) return null;
    const from = parseEnd(w.from);
    const b = d.blocks.find((x) => x.id === from.id);
    if (!b) return null;
    if (b.type === 'source') return b.params.signal;
    if (b.type === 'inport') {
      if (frames.length < 2) return null;
      const { d: inner, sub } = frames.pop();
      id = sub; p = portBlocks(inner, 'inport').indexOf(b);
      continue;
    }
    if (b.type === 'subsystem') {
      const out = portBlocks(b.diagram, 'outport')[from.port];
      if (!out) return null;
      frames.push({ d: b.diagram, sub: b.id });
      id = out.id; p = 0;
      continue;
    }
    if (blockPorts(b)[0] !== 1) return null;
    id = b.id; p = 0;
  }
  return null;
}

function tuneContext(project, path) {
  const plant = project.system.plant;
  if (plant?.type !== 'diagram') throw new Error('the plant is not a block diagram yet');
  const ext = externalBlock(plant.diagram);
  if (ext && blockMode(EXTERNAL_BLOCK.normalize(ext.params)) !== 'control') throw new Error(`the plant runs its own controller (External plant ${ext.name ?? ext.id}, reference mode): the page's controllers and Auto-tune are not in the loop`);
  if (ext) throw new Error(`the plant runs outside the page (External plant ${ext.name ?? ext.id}) and is a black box: the page knows only its interface, and Auto-tune needs an identified model of it (Identify, not built yet). Until then, tune it live in the Controller tab`);
  const all = controllerBlocks(plant.diagram);
  const key = path ? [].concat(path).join('/') : null;
  const hit = (key && all.find((c) => c.key === key)) || all[0];
  if (!hit) throw new Error('there is no Controller block in the plant');
  const { block } = hit;
  if (block.params.inputs < 2) throw new Error(`${hit.where} needs r on input 1 and the measurement y on input 2`);
  const { level } = locate(plant.diagram, hit.path);
  if (!wireTo(level, block.id, 0)) throw new Error(`${hit.where}: wire the reference r to input 1`);
  if (!wireTo(level, block.id, 1)) throw new Error(`${hit.where}: wire the measurement y to input 2`);
  const running = normalizeVariant(block.variants[block.variant ?? 0]);
  const { variant, designed } = asTuned(plant.diagram, hit, running);
  const period = Math.max(...Object.values(project.system.signals).map((s) => s.period));
  const sim = { duration: period, sampleTime: project.sim?.sampleTime ?? defaultSampleTime(period) };
  const ctx = { diagram: structuredClone(plant.diagram), signals: structuredClone(project.system.signals), path: hit.path, key: hit.key, where: hit.where, block, variant, designed, sim, Ts: block.params.Ts };
  ctx.source = upstreamSource(ctx.diagram, ctx.path, 0);
  ctx.others = ctx.source ? Object.keys(ctx.signals).filter((k) => k !== ctx.source) : [];
  return ctx;
}

function asTuned(diagram, hit, running) {
  const def = CONTROLLERS[running.type];
  if (!def?.designed) return { variant: running, designed: null };
  let st = null;
  try { st = compileDiagram(diagram, 'plant', { standalone: true }).designs.find((x) => x.path === hit.key); } catch { st = null; }
  if (!def.manual || !st?.values) return { variant: running, designed: { label: def.label, type: running.type, error: st?.error?.message ?? (st && st.status !== 'ok' && st.status !== 'warn' ? `its design is ${st.status}` : '') } };
  const twin = normalizeVariant(def.manual(running.params, st.values));
  return { variant: { ...twin, name: running.name }, designed: { label: def.label, type: running.type, from: twin.type } };
}

function runVariant(ctx, variant, signals = ctx.signals, sim = ctx.sim) {
  return simulateSystem(withVariant(ctx.diagram, ctx.path, variant), signals, sim);
}

function loopSignals(run, key) {
  const s = run.signals;
  return { t: run.t, r: s[`${key}.r`], y: s[`${key}.y`], u: s[`${key}.u`] };
}

function loopOverlays(channels, signals, unitOf = () => '') {
  const same = (a, b) => a && b && a.length === b.length && a.every((v, k) => Object.is(v, b[k]));
  const groups = [];
  for (const key of Object.keys(signals)) {
    if (!key.endsWith('.r')) continue;
    const r = signals[key], y = signals[`${key.slice(0, -2)}.y`];
    const showing = (probe) => channels.map((ch, i) => (ch.on && same(signals[ch.source], probe) ? i : -1)).filter((i) => i >= 0);
    const g = [...showing(r), ...showing(y)];
    if (new Set(g).size > 1 && new Set(g.map((i) => unitOf(channels[i].source))).size === 1) groups.push([...new Set(g)]);
  }
  return groups;
}

const limitsOf = (v) => ({ lo: v.params.umin ?? -Infinity, hi: v.params.umax ?? Infinity });
const finiteRange = (a, from = 0, to = a.length) => {
  let lo = Infinity, hi = -Infinity;
  for (let k = from; k < to; k++) if (Number.isFinite(a[k])) { lo = Math.min(lo, a[k]); hi = Math.max(hi, a[k]); }
  return { lo, hi };
};
const mean = (a, from = 0, to = a.length) => { let s = 0; for (let k = from; k < to; k++) s += a[k]; return s / Math.max(1, to - from); };


const COSTS = {
  IAE: 'mean |e|: every error counts by its size',
  ITAE: 'mean |e| weighted by the time since the last reference step: errors that last count most',
  ISE: 'mean e²: large errors count most',
};
const GOAL = { cost: 'IAE', effort: 0.05, overshoot: 10, saturation: 0.2 };

function costScales(run, key, variant) {
  const { r, y, u } = loopSignals(run, key);
  const rr = finiteRange(r);
  let e = rr.hi - rr.lo;
  if (!(e > 1e-9)) { e = 0; for (let k = 0; k < r.length; k++) if (Number.isFinite(y[k])) e = Math.max(e, Math.abs(r[k] - y[k])); }
  const { lo, hi } = limitsOf(variant);
  let U = hi - lo;
  if (!Number.isFinite(U)) { const ur = finiteRange(u); U = ur.hi - ur.lo; }
  return { e: e > 1e-9 ? e : 1, u: U > 1e-9 && Number.isFinite(U) ? U : 1 };
}

function runCost(run, key, goal = {}, how = {}) {
  const g = { ...GOAL, ...goal };
  const { scales = { e: 1, u: 1 }, variant = null, others = [] } = how;
  const { t, r, y, u } = loopSignals(run, key);
  if (!r || !y || !u) throw new Error('the run has no r, y and u for this Controller block');
  const n = t.length;
  let valid = n;
  for (let k = 0; k < n; k++) if (!Number.isFinite(r[k]) || !Number.isFinite(y[k]) || !Number.isFinite(u[k])) { valid = k; break; }
  if (valid < n || run.info?.unstable) {
    return { J: DIVERGED * (2 - valid / n), diverged: true, parts: { error: DIVERGED, effort: 0, overshoot: 0, saturation: 0 }, overshoot: Infinity, saturated: 0 };
  }
  const R = scales.e, U = scales.u;
  const steps = [];
  for (let k = 1; k < n; k++) if (Math.abs(r[k] - r[k - 1]) > 0.05 * R) steps.push(k);
  const Tseg = (t[n - 1] - t[0]) / (steps.length + 1) || 1;
  let err = 0, since = t[0], s = 0;
  for (let k = 0; k < n; k++) {
    if (k === steps[s]) { since = t[k]; s++; }
    const e = (r[k] - y[k]) / R;
    err += g.cost === 'ISE' ? e * e : g.cost === 'ITAE' ? ((t[k] - since) / Tseg) * Math.abs(e) : Math.abs(e);
  }
  err /= n;
  const um = mean(u);
  let swing = 0;
  for (let k = 0; k < n; k++) swing += (u[k] - um) ** 2;
  const effort = g.effort * swing / (n * U * U);
  const cuts = [];
  for (const name of others) {
    const v = run.signals[name];
    if (!v) continue;
    const vr = finiteRange(v), jump = 0.05 * (vr.hi - vr.lo);
    for (let k = 1; k < n; k++) if (Math.abs(v[k] - v[k - 1]) > jump) cuts.push(k);
  }
  cuts.sort((a, b) => a - b);
  let worst = 0, over = 0;
  steps.forEach((k0, i) => {
    const k1 = Math.min(steps[i + 1] ?? n, cuts.find((c) => c > k0) ?? n), dr = r[k0] - r[k0 - 1], dir = Math.sign(dr);
    let peak = 0;
    for (let k = k0; k < k1; k++) peak = Math.max(peak, dir * (y[k] - r[k]));
    const pct = (100 * peak) / Math.abs(dr);
    worst = Math.max(worst, pct);
    over += Math.max(0, pct - g.overshoot) / 100;
  });
  let sat = 0;
  if (variant) {
    const { lo, hi } = limitsOf(variant), tol = 1e-9 * (U + 1);
    if (Number.isFinite(lo) || Number.isFinite(hi)) for (let k = 0; k < n; k++) if (u[k] <= lo + tol || u[k] >= hi - tol) sat++;
  }
  const parts = { error: err, effort, overshoot: OVERSHOOT_WEIGHT * over, saturation: g.saturation * sat / n };
  const J = parts.error + parts.effort + parts.overshoot + parts.saturation;
  return { J: Number.isFinite(J) ? Math.min(J, DIVERGED) : 2 * DIVERGED, diverged: false, parts, overshoot: worst, saturated: sat / n };
}

function variantCost(ctx, variant, goal, scales) {
  return runCost(runVariant(ctx, variant), ctx.key, goal, { scales, variant, others: ctx.others });
}


const UNTUNABLE = {
  off: 'Off has nothing to tune. Add a PID to this block in the Controller tab, then tune that.',
  swingUp: 'A swing-up switches between pumping energy and catching the pole; its gains do not act on r − y. Tune its catching gains as a State feedback variant.',
  relay: 'A relay has no gains to tune; the relay method uses one to find Ku and Pu.',
  trajectory: 'A planned swing-up follows a plan computed from the plant: it has no gains of its own to tune. Change its inputs (T, Q, R) in the Controller tab.',
};
const undesigned = (v) => `${CONTROLLERS[v.type].label} computes its numbers from the plant, and has none now; see its Computed box in the Controller tab, or tune a hand variant`;

const FF_KEYS = ['Kff', 'Kv', 'Ka'];
const isOn = (v) => Number.isFinite(v) && v !== 0;
function tuningSpace(variant, { start = null, part = 'all' } = {}) {
  const p = { ...variant.params };
  const started = start ? FF_KEYS.filter((k) => p[k] === 0 && isOn(start[k])) : [];
  for (const k of started) p[k] = start[k];
  const f = (x) => Math.exp(Math.max(-LOG_LIMIT, Math.min(LOG_LIMIT, x)));
  const on = isOn;
  const fb = part !== 'feedforward', ff = part === 'feedback' ? [] : FF_KEYS.filter((k) => on(p[k]));
  let names, apply;
  if (variant.type === 'pid') {
    const keys = [...(fb ? ['Kp', 'Ki', 'Kd'] : []), ...ff].filter((k) => on(p[k]));
    names = keys;
    apply = (x) => { const q = { ...p }; keys.forEach((k, i) => { q[k] = p[k] * f(x[i]); }); return q; };
  } else if (variant.type === 'gainScheduled') {
    const keys = fb ? ['Kp', 'Ki'].filter((k) => p[k].some(on)) : [];
    names = [...keys.map((k) => `${k} table ×`), ...ff];
    apply = (x) => {
      const q = { ...p };
      keys.forEach((k, i) => { q[k] = p[k].map((v) => v * f(x[i])); });
      ff.forEach((k, j) => { q[k] = p[k] * f(x[keys.length + j]); });
      return q;
    };
  } else if (variant.type === 'stateFeedback') {
    const idx = p.K.map((v, i) => i).filter((i) => on(p.K[i]));
    names = [...idx.map((i) => `K${i + 1}`), ...(on(p.kr) ? ['kr'] : [])];
    apply = (x) => {
      const q = { ...p, K: p.K.slice() };
      idx.forEach((i, j) => { q.K[i] = p.K[i] * f(x[j]); });
      if (on(p.kr)) q.kr = p.kr * f(x[idx.length]);
      return q;
    };
  } else if (variant.type === 'slidingMode' || variant.type === 'superTwisting') {
    const keys = fb ? (variant.type === 'slidingMode' ? ['lambda', 'phi'] : ['lambda', 'k1', 'k2']).filter((k) => on(p[k])) : [];
    names = keys.map((k) => (k === 'lambda' ? 'λ' : k === 'phi' ? 'φ' : k));
    apply = (x) => { const q = { ...p }; keys.forEach((k, i) => { q[k] = p[k] * f(x[i]); }); return q; };
  } else throw new Error(UNTUNABLE[variant.type] ?? (CONTROLLERS[variant.type]?.designed ? undesigned(variant) : `a ${variant.type} variant cannot be tuned`));
  if (!names.length) throw new Error('every gain of this variant is 0; give the gains it should use a start value, then tune');
  return { names, started, base: started.length ? { ...variant, params: p } : variant, apply: (x) => ({ ...variant, params: apply(x) }) };
}

function feedforwardStart(run, key, variant, others = []) {
  const { t, r, y, u } = loopSignals(run, key);
  const n = t.length, out = { Kff: 0, Kv: 0, Ka: 0 };
  if (n < 5) return out;
  const dt = (t[n - 1] - t[0]) / (n - 1), Tr = variant.params.Tr ?? 0;
  const a = Tr > 0 ? Math.exp(-dt / Tr) : 0;
  const rf = new Float64Array(n);
  for (let k = 0; k < n; k++) rf[k] = k && a ? a * rf[k - 1] + (1 - a) * r[k] : r[k];
  const d1 = new Float64Array(n), d2 = new Float64Array(n);
  for (let k = 1; k < n - 1; k++) { d1[k] = (rf[k + 1] - rf[k - 1]) / (2 * dt); d2[k] = (rf[k + 1] - 2 * rf[k] + rf[k - 1]) / (dt * dt); }
  const quiet = (k) => others.every((name) => { const v = run.signals[name]?.[k]; return !Number.isFinite(v) || Math.abs(v) < 1e-12; });
  const rows = []; for (let k = 1; k < n - 1; k++) if (Number.isFinite(u[k]) && Number.isFinite(rf[k]) && quiet(k)) rows.push(k);
  if (rows.length < 4) return out;
  const sd = (x) => { const mu = x.reduce((s, v) => s + v, 0) / x.length; return Math.sqrt(x.reduce((s, v) => s + (v - mu) ** 2, 0) / x.length); };
  const swing = sd(rows.map((k) => u[k]));
  const { lo, hi } = finiteRange(rf), span = hi - lo;
  const rest = rows.filter((k) => Math.abs(rf[k + 1] - rf[k - 1]) <= 1e-6 * span && Number.isFinite(y[k]) && Math.abs(y[k] - rf[k]) <= 0.02 * span);
  if (rest.length >= 4 && sd(rest.map((k) => rf[k])) > 1e-3 * span) {
    const [, Kff] = leastSquares([rest.map(() => 1), rest.map((k) => rf[k])], rest.map((k) => u[k]));
    if (Number.isFinite(Kff) && Math.abs(Kff) * sd(rows.map((k) => rf[k])) >= 0.02 * swing) out.Kff = Kff;
  }
  const z = rows.map((k) => u[k] - out.Kff * rf[k]);
  const c = leastSquares([rows.map(() => 1), rows.map((k) => d1[k]), rows.map((k) => d2[k])], z);
  [['Kv', d1, c[1]], ['Ka', d2, c[2]]].forEach(([name, col, g]) => {
    if (Number.isFinite(g) && Math.abs(g) * sd(rows.map((k) => col[k])) >= 0.02 * swing) out[name] = g;
  });
  return out;
}

function leastSquares(cols, y) {
  const dot = (x, z) => x.reduce((s, v, i) => s + v * z[i], 0);
  const basis = [], kept = [];
  cols.forEach((col, j) => {
    let w = col.slice();
    for (const q of basis) { const s = dot(w, q); w = w.map((v, i) => v - s * q[i]); }
    const norm = Math.sqrt(dot(w, w)), full = Math.sqrt(dot(col, col));
    if (norm > 1e-6 * full && norm > 1e-12) { basis.push(w.map((v) => v / norm)); kept.push(j); }
  });
  const m = kept.length, M = kept.map((i) => kept.map((j) => dot(cols[i], cols[j]))), b = kept.map((i) => dot(cols[i], y));
  for (let i = 0; i < m; i++) {
    let piv = i; for (let k = i + 1; k < m; k++) if (Math.abs(M[k][i]) > Math.abs(M[piv][i])) piv = k;
    [M[i], M[piv]] = [M[piv], M[i]]; [b[i], b[piv]] = [b[piv], b[i]];
    for (let k = i + 1; k < m; k++) { const f = M[k][i] / M[i][i]; for (let j = i; j < m; j++) M[k][j] -= f * M[i][j]; b[k] -= f * b[i]; }
  }
  const x = new Array(m).fill(0);
  for (let i = m - 1; i >= 0; i--) { let s = b[i]; for (let j = i + 1; j < m; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
  const c = new Array(cols.length).fill(NaN);
  kept.forEach((j, i) => { c[j] = x[i]; });
  return c;
}

function tunedValues(variant) {
  const p = variant.params;
  const ff = FF_KEYS.filter((k) => isOn(p[k])).map((k) => [k, p[k]]);
  if (variant.type === 'pid') return [...['Kp', 'Ki', 'Kd'].map((k) => [k, p[k]]), ...ff];
  if (variant.type === 'gainScheduled') return [['Kp', p.Kp], ['Ki', p.Ki], ...ff];
  if (variant.type === 'stateFeedback') return [['K', p.K], ['kr', p.kr]];
  if (variant.type === 'slidingMode') return [['λ', p.lambda], ['φ', p.phi]];
  if (variant.type === 'superTwisting') return [['λ', p.lambda], ['k1', p.k1], ['k2', p.k2]];
  return [];
}


function* iterate(project, path, goal = {}, opts = {}) {
  const g = { ...GOAL, ...goal };
  const ctx = tuneContext(project, path);
  tuningSpace(ctx.variant);   
  const maxIter = opts.maxIter ?? 60, patience = opts.patience ?? 15;
  const startRun = runVariant(ctx, ctx.variant);
  const scales = costScales(startRun, ctx.key, ctx.variant);
  const detail = runCost(startRun, ctx.key, g, { scales, variant: ctx.variant, others: ctx.others });
  const start = { cost: detail.J, detail, variant: ctx.variant };
  const seconds = ctx.sim.duration;
  const ffStart = opts.feedforward && ['pid', 'gainScheduled'].includes(ctx.variant.type) ? feedforwardStart(startRun, ctx.key, ctx.variant, ctx.others) : null;
  const whole = tuningSpace(ctx.variant, { start: ffStart });
  const ffNames = whole.names.filter((k) => FF_KEYS.includes(k)), quiet = !disturbed(startRun, ctx.others);
  const stages = ffNames.length && ffNames.length < whole.names.length ? ['feedforward', 'feedback'] : ['all'];
  let names = whole.names;
  const notes = [];
  let evals = 1, best = { variant: ctx.variant, cost: detail, x: null }, tried = [detail.J], iteration = 0, stage = stages[0], space = whole;
  const report = (partial) => {
    const out = { iteration, evals, cost: best.cost.J, start, best, tried, names, stage, notes, key: ctx.key, path: ctx.path, goal: g, scales };
    if (partial) return { ...out, partial: true };
    tried = [];
    return out;
  };
  function* f(x) {
    const variant = space.apply(x);
    let cost, run = null;
    try {
      run = runVariant(ctx, variant);
      cost = runCost(run, ctx.key, g, { scales, variant, others: ctx.others });
    } catch { cost = { J: 2 * DIVERGED, diverged: true, parts: {} }; }
    evals++;
    tried.push(cost.J);
    if (cost.J < best.cost.J) best = { variant, cost, x: x.slice() };
    yield { ...report(true), seconds, run };
    return cost.J;
  }
  yield { ...report(true), seconds, run: startRun };
  for (const [i, part] of stages.entries()) {
    if (part === 'feedback' && quiet && FF_KEYS.some((k) => isOn(best.variant.params[k]))) {
      names = ffNames;
      notes.push('this run has no disturbance, so it cannot judge the feedback once the feedforward follows r: the feedback gains were held and only the feedforward was tuned. To tune the feedback too, give d a step in the Input tab, or set the feedforward to 0 first');
      break;
    }
    stage = part;
    space = part === 'all' ? whole : tuningSpace(i ? best.variant : ctx.variant, { part, start: i ? null : ffStart });
    const n = space.names.length, x0 = new Array(n).fill(0);
    const until = part === 'feedforward' ? Math.ceil(maxIter / 2) : maxIter;
    let step = opts.step ?? Math.log(2), restarts = opts.restarts ?? 2;
    const at0 = best.cost.J;
    best = { ...best, x: null };
    let simplex = [], fs = [];
    function* build(xb, fb) {
      simplex = [xb.slice()]; fs = [fb];
      for (let j = 0; j < n; j++) { const x = xb.slice(); x[j] += step; simplex.push(x); fs.push(yield* f(x)); }
    }
    const f0 = !i && space.started.length ? yield* f(x0) : at0;
    yield* build(x0, f0);
    yield report(false);
    let mark = best.cost.J, since = iteration;
    while (iteration < until) {
      iteration++;
      const order = fs.map((_, j) => j).sort((a, b) => fs[a] - fs[b]);
      simplex = order.map((j) => simplex[j]); fs = order.map((j) => fs[j]);
      let spread = 0;
      for (let j = 1; j <= n; j++) for (let k = 0; k < n; k++) spread = Math.max(spread, Math.abs(simplex[j][k] - simplex[0][k]));
      if (spread < 1e-2 || fs[n] - fs[0] <= 1e-4 * Math.abs(fs[0])) {
        if (!restarts--) break;
        step /= 4;
        yield* build(best.x ?? x0, best.x ? best.cost.J : f0);
      } else {
        const c = new Array(n).fill(0);
        for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) c[k] += simplex[j][k] / n;
        const along = (a) => c.map((ck, k) => ck + a * (simplex[n][k] - ck));
        const xr = along(-1), fr = yield* f(xr);
        if (fr < fs[0]) {
          const xe = along(-2), fe = yield* f(xe);
          if (fe < fr) { simplex[n] = xe; fs[n] = fe; } else { simplex[n] = xr; fs[n] = fr; }
        } else if (fr < fs[n - 1]) {
          simplex[n] = xr; fs[n] = fr;
        } else {
          const xc = fr < fs[n] ? along(-0.5) : along(0.5), fc = yield* f(xc);
          if (fc < Math.min(fr, fs[n])) { simplex[n] = xc; fs[n] = fc; } else {
            for (let j = 1; j <= n; j++) { simplex[j] = simplex[j].map((v, k) => simplex[0][k] + 0.5 * (v - simplex[0][k])); fs[j] = yield* f(simplex[j]); }
          }
        }
      }
      yield report(false);
      if (best.cost.J < 0.999 * mark) { mark = best.cost.J; since = iteration; }
      if (iteration - since >= patience) break;
    }
  }
  return { ...report(false), done: true };
}

function disturbed(run, others) {
  return others.some((k) => { const v = run.signals[k]; if (!v) return false; const { lo, hi } = finiteRange(v); return lo < -1e-12 || hi > 1e-12; });
}

function runIterate(project, path, goal, opts) {
  return drain(iterate(project, path, goal, opts));
}


const NO_RANGE = 'there is no scale for the test signal: the running variant has no actuator limits and its u does not move. Give it limits (u min, u max) in the Controller tab, or run a variant that controls';

function* operatingPoint(ctx) {
  const ownRun = runVariant(ctx, ctx.variant);
  yield { partial: true, phase: 'operating point', seconds: ctx.sim.duration };
  const own = loopSignals(ownRun, ctx.key);
  const rr = finiteRange(own.r);
  const name = ctx.source, notes = [];
  let signals = ctx.signals, level = null;
  if (name) {
    const sr = finiteRange(ownRun.signals[name] ?? []);
    level = Number.isFinite(sr.lo) ? (sr.lo + sr.hi) / 2 : 0;
    signals = holding(ctx, level);
  } else notes.push('input 1 is not fed by a Source (through gains, lags or subsystem ports), so r cannot be held: the experiment runs with the inputs as they are, and the estimate is rough');
  const sim = { ...ctx.sim };
  const holdRun = runVariant(ctx, ctx.variant, signals, sim);
  yield { partial: true, phase: 'operating point', seconds: sim.duration };
  const hold = loopSignals(holdRun, ctx.key);
  const k0 = Math.floor(0.75 * hold.u.length);
  const r0 = name ? mean(hold.r, k0) : (rr.lo + rr.hi) / 2;
  let u0 = mean(hold.u, k0);
  const { lo, hi } = limitsOf(ctx.variant);
  if (!Number.isFinite(u0)) u0 = Number.isFinite(lo + hi) ? (lo + hi) / 2 : 0;
  u0 = Math.min(hi, Math.max(lo, u0));
  return { r0, name, level, signals, sim, u0, span: rr.hi - rr.lo, rRange: rr, own, ownRun, holdRun, notes };
}

function holding(ctx, level) {
  const signals = {};
  for (const [k, s] of Object.entries(ctx.signals)) signals[k] = { ...s, components: k === ctx.source ? [{ type: 'dc', params: { level } }] : [] };
  return signals;
}

function actuatorRange(ctx, own) {
  const { lo, hi } = limitsOf(ctx.variant);
  if (Number.isFinite(hi - lo)) return hi - lo;
  const ur = finiteRange(own.u);
  const span = Math.max(ur.hi - ur.lo, Math.abs(ur.hi), Math.abs(ur.lo));
  return span > 1e-9 ? span : 0;
}

const constantU = (u, lo, hi) => normalizeVariant({ name: 'Step test', type: 'pid', params: { Kp: 0, Ki: 0, Kd: 0, u0: u, umin: lo, umax: hi } });

function* openLoopStep(ctx, op, du, sim) {
  const { lo, hi } = limitsOf(ctx.variant);
  const runA = runVariant(ctx, constantU(op.u0, lo, hi), op.signals, sim);
  yield { partial: true, phase: 'open loop', seconds: sim.duration };
  const runB = runVariant(ctx, constantU(op.u0 + du, lo, hi), op.signals, sim);
  yield { partial: true, phase: 'open loop', seconds: sim.duration };
  const yA = loopSignals(runA, ctx.key).y, yB = loopSignals(runB, ctx.key).y;
  return { runA, runB, dy: yB.map((v, k) => v - yA[k]) };
}

const longer = (sim, f) => ({ duration: sim.duration * f, sampleTime: sim.sampleTime });


const RULES = {
  zn: { label: 'Ziegler–Nichols', short: 'Z–N', kp: 0.6, ti: 1 / 2, td: 1 / 8, about: 'Ziegler & Nichols (1942): fast, about a quarter decay; overshoots' },
  tl: { label: 'Tyreus–Luyben', short: 'T–L', kp: 1 / 2.2, ti: 2.2, td: 1 / 6.3, about: 'Tyreus & Luyben (1992): calmer and more robust, slower to remove errors' },
  calm: { label: 'No overshoot', short: 'no overshoot', kp: 0.2, ti: 1 / 2, td: 1 / 3, about: 'the "no overshoot" row of the Ziegler–Nichols tables: gentle' },
};

function pidFromUltimate(Ku, Pu, rule = 'zn') {
  const r = RULES[rule];
  if (!r) throw new Error(`rule: one of ${Object.keys(RULES).join(', ')}`);
  const Kp = r.kp * Ku, Ti = r.ti * Pu, Td = r.td * Pu;
  return { Kp, Ki: Kp / Ti, Kd: Kp * Td, Ti, Td };
}

function readOscillation(run, key, mid, eps) {
  const { t, y, u } = loopSignals(run, key);
  const n = t.length;
  let valid = n;
  for (let k = 0; k < n; k++) if (!Number.isFinite(y[k])) { valid = k; break; }
  const ups = [];
  let switched = false;
  for (let k = 1; k < valid; k++) {
    if ((u[k] > mid) !== (u[k - 1] > mid)) switched = true;
    if (u[k] > mid && u[k - 1] <= mid) ups.push(k);
  }
  const out = { switched, cycles: Math.max(0, ups.length - 1), diverged: valid < n };
  if (ups.length < 4) return out;
  const last = ups.length - 1, j0 = Math.max(1, last - 4);
  const Pu = (t[ups[last]] - t[ups[j0]]) / (last - j0);
  const P1 = t[ups[last]] - t[ups[last - 1]], P2 = t[ups[last - 1]] - t[ups[last - 2]];
  const amp = (a, b) => { const r = finiteRange(y, a, b); return (r.hi - r.lo) / 2; };
  const a = amp(ups[last - 1], ups[last]), a2 = amp(ups[last - 2], ups[last - 1]);
  let high = 0;
  for (let k = ups[last - 1]; k < ups[last]; k++) if (u[k] > mid) high++;
  const yMean = mean(y, ups[last - 1], ups[last]), yPrev = mean(y, ups[last - 2], ups[last - 1]);
  const k0 = ups[last - 1], k1 = ups[last], w = (2 * Math.PI) / (t[k1] - t[k0]);
  let c = 0, sn = 0;
  for (let k = k0; k < k1; k++) { c += (y[k] - yMean) * Math.cos(w * t[k]); sn += (y[k] - yMean) * Math.sin(w * t[k]); }
  const a1 = (2 / (k1 - k0)) * Math.hypot(c, sn);
  return {
    ...out, Pu, a, a1, high: high / (ups[last] - ups[last - 1]), uMean: mean(u, ups[last - 1], ups[last]),
    settled: Math.abs(P1 - P2) <= 0.05 * Pu && Math.abs(a - a2) <= 0.05 * a, drift: Math.abs(yMean - yPrev) > 0.2 * a,
    hysteresisOnly: a < 1.5 * eps,
  };
}

function siso(ctx) {
  const m = ctx.block.params.inputs - 1;
  return m > 1 ? `${ctx.where} uses ${m} measurements; the relay and step tests are for loops with one (r, y). Use the iterative method.` : '';
}

function whyNot(ctx, method) {
  if (method !== 'iterate') return siso(ctx);
  try { tuningSpace(ctx.variant); return ''; } catch (err) { return err.message; }
}

function* relayExperimentSteps(project, path, opts = {}) {
  const ctx = tuneContext(project, path);
  if (siso(ctx)) return { ctx, ok: false, notes: [], why: siso(ctx) };
  const op = yield* operatingPoint(ctx);
  const { lo, hi } = limitsOf(ctx.variant);
  const notes = [...op.notes];
  const base = { ctx, r0: op.r0, notes, source: op.name };
  const range = actuatorRange(ctx, op.own);
  if (opts.d === undefined && !range) return { ...base, ok: false, u0: op.u0, why: NO_RANGE };
  const want = Math.abs(opts.d ?? (opts.amplitude ?? 0.1) * range);
  const eps = opts.hysteresis ?? 0.001 * (op.span > 1e-9 ? op.span : Math.abs(op.r0) || 1);
  const probe = hi - op.u0 >= Math.min(want, op.u0 - lo) ? want : -want;
  const { dy } = yield* openLoopStep(ctx, op, probe, op.sim);
  let moved = 0;
  for (const v of dy) if (Number.isFinite(v)) moved += v;
  const sign = moved * probe < 0 ? -1 : 1;
  if (sign < 0) notes.push('y falls when u rises (a reverse-acting plant): the relay is reversed and Ku is negative');
  let u0 = op.u0, sim = op.sim, run = null, osc = null, d = want;
  for (let tries = 0; tries < 8; tries++) {
    d = Math.min(want, hi - u0, u0 - lo);
    if (!(d > 0.1 * want)) return { ...base, ok: false, u0, d, run, sign, why: `the bias u0 = ${fmtN(u0)} needed to hold r0 = ${fmtN(op.r0)} sits at an actuator limit (${fmtN(lo)} … ${fmtN(hi)}): no room for the relay to swing` };
    const relay = normalizeVariant({ name: 'Relay experiment', type: 'relay', params: { d: sign * d, eps, u0, umin: lo, umax: hi } });
    run = runVariant(ctx, relay, op.signals, sim);
    yield { partial: true, phase: 'relay', run, seconds: sim.duration };
    osc = readOscillation(run, ctx.key, u0, eps);
    if (osc.diverged) return { ...base, ok: false, u0, d, run, sign, why: 'the relay run diverged: the plant may be unstable without its controller' };
    if (!osc.switched) {
      const { y } = loopSignals(run, ctx.key);
      u0 += sign * (y[y.length - 1] < op.r0 ? 1 : -1) * want;
      if (u0 > hi || u0 < lo) return { ...base, ok: false, u0, d, run, sign, why: `the relay never switched: with u0 ± d inside the limits the measurement does not cross r0 = ${fmtN(op.r0)}` };
      continue;
    }
    if (osc.cycles < 4) {
      if (sim.duration >= 16 * ctx.sim.duration) break;
      sim = longer(sim, 4);
      continue;
    }
    if (Math.abs(osc.high - 0.5) > 0.03 && tries < 6) { u0 = Math.min(hi, Math.max(lo, osc.uMean)); continue; }
    break;
  }
  const res = { ...base, u0, d, run, sim, osc, sign };
  if (!osc?.switched) return { ...res, ok: false, why: `the relay never switched: the measurement does not cross r0 = ${fmtN(op.r0)}` };
  if (osc.cycles < 4) return { ...res, ok: false, why: `only ${osc.cycles} cycle${osc.cycles === 1 ? '' : 's'} in ${fmtN(sim.duration)} s: the plant is too slow for this window (lengthen the input's period)` };
  if (osc.hysteresisOnly) return { ...res, ok: false, why: 'the oscillation is no larger than the relay\'s hysteresis: the plant has too little lag for a relay test (an integrator or a first-order lag alone)' };
  if (osc.drift) notes.push('y drifts from cycle to cycle (an integrating plant, or a load the bias does not balance): the estimate is rough');
  if (!osc.settled) notes.push('the oscillation had not quite settled: the estimate is rough');
  if (Math.abs(osc.high - 0.5) > 0.05) notes.push(`the oscillation is asymmetric (relay high ${Math.round(100 * osc.high)} % of the time)`);
  if (d < 0.999 * want) notes.push(`the relay amplitude was reduced to ${fmtN(d)} to stay inside the actuator limits`);
  const a = osc.a1;
  const Ku = (4 * sign * d) / (Math.PI * Math.sqrt(Math.max(a * a - eps * eps, 1e-30)));
  return { ...res, ok: true, Ku, Pu: osc.Pu, a };
}

const relayExperiment = (project, path, opts) => drain(relayExperimentSteps(project, path, opts));

function* relayTuneSteps(project, path, rule = 'tl', opts = {}) {
  if (!RULES[rule]) throw new Error(`rule: one of ${Object.keys(RULES).join(', ')}`);
  const ex = yield* relayExperimentSteps(project, path, opts);
  if (!ex.ok) return ex;
  const g = pidFromUltimate(ex.Ku, ex.Pu, rule);
  const variant = pidVariant(ex.ctx.variant, g, opts.name ?? `${baseName(ex.ctx.variant.name)} · relay ${RULES[rule].short}`, ex.ctx.Ts);
  return { ...ex, rule, gains: g, variant };
}

const relayTune = (project, path, rule, opts) => drain(relayTuneSteps(project, path, rule, opts));


function trailing(y, m) {
  const n = y.length, s = new Float64Array(n);
  let acc = 0;
  for (let k = 0; k < n; k++) { acc += y[k]; if (k >= m) acc -= y[k - m]; s[k] = acc / Math.min(k + 1, m); }
  return s;
}
function centred(y, m) {
  const n = y.length, s = new Float64Array(n), h = Math.floor(m / 2);
  const at = (k) => y[Math.min(n - 1, Math.max(0, k))];
  let acc = 0;
  for (let j = -h; j < m - h; j++) acc += at(j);
  for (let k = 0; k < n; k++) { s[k] = acc / m; acc += at(k + m - h) - at(k - h); }
  return s;
}
const smooth = (y, m, how = trailing) => (m > 1 ? how(how(y, m), m) : Float64Array.from(y));

function lastStretch(t, last) {
  const n = t.length, t1 = t[n - 1] - last * (t[n - 1] - t[0]);
  let k = n - 1;
  while (k > 0 && t[k - 1] >= t1) k--;
  return k;
}

function lineFit(x, y, from = 0, to = y.length) {
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  const N = to - from;
  for (let k = from; k < to; k++) { sx += x[k]; sy += y[k]; sxx += x[k] * x[k]; sxy += x[k] * y[k]; }
  const b = (N * sxy - sx * sy) / (N * sxx - sx * sx || 1);
  return { a: (sy - b * sx) / N, b };
}

function ripplePeriod(y, dt, size) {
  const n = y.length, k0 = Math.floor(0.6 * n);
  if (n - k0 < 32 || !(size > 0)) return 0;
  const { f, amp } = amplitudeSpectrum(y.slice(k0), dt, { detrend: 'linear' });
  const fmin = 6 / ((n - k0) * dt);
  let top = 0;
  for (let k = 1; k < amp.length; k++) if (f[k] >= fmin) top = Math.max(top, amp[k]);
  if (!(top >= 0.002 * size)) return 0;
  for (let k = 1; k < amp.length - 1; k++) {
    if (f[k] >= fmin && amp[k] >= top / 4 && amp[k] >= amp[k - 1] && amp[k] >= amp[k + 1]) return Math.max(2, Math.round(1 / (f[k] * dt)));
  }
  return 0;
}

function rippleOf(y, m, from) {
  const n = y.length;
  let lo = Infinity, hi = -Infinity;
  if (m > 1) {
    const s = smooth(y, m, centred);
    for (let k = from; k < n - m; k++) { lo = Math.min(lo, y[k] - s[k]); hi = Math.max(hi, y[k] - s[k]); }
  } else {
    const x = Array.from({ length: n }, (_, k) => k), { a, b } = lineFit(x, y, from, n);
    for (let k = from; k < n; k++) { const e = y[k] - a - b * k; lo = Math.min(lo, e); hi = Math.max(hi, e); }
  }
  return hi > lo ? (hi - lo) / 2 : 0;
}

function settledLevel(t, y, { band = 0.02, last = 0.2 } = {}) {
  const n = y.length;
  if (n < 16) return { settled: false, final: y[n - 1], size: 0, ripple: 0, m: 0 };
  const dt = (t[n - 1] - t[0]) / (n - 1), k1 = lastStretch(t, last);
  const m = ripplePeriod(y, dt, Math.abs(mean(y, k1) - y[0]));
  const s = smooth(y, m);
  const final = s[n - 1], size = Math.abs(final - y[0]);
  const from = Math.min(n - 1, Math.max(k1, 2 * m));
  let dev = 0;
  for (let k = from; k < n; k++) dev = Math.max(dev, Math.abs(s[k] - final));
  return { settled: size > 0 && dev <= band * size, final, size, m, ripple: rippleOf(y, m, from) };
}

function settledSlope(t, y, { band = 0.02, last = 0.2 } = {}) {
  const n = y.length;
  const no = { ramps: false, slope: 0, tSteady: t[n - 1], m: 0, ripple: 0 };
  if (n < 16) return no;
  const dt = (t[n - 1] - t[0]) / (n - 1), k1 = lastStretch(t, last);
  const m = ripplePeriod(y, dt, Math.abs(y[n - 1] - y[0]));
  const s = smooth(y, m), q = Math.max(m, Math.round(0.02 * n), 1);
  const from = Math.max(k1, 2 * m + q);
  if (from >= n - 1) return no;
  const g = (k) => (s[k] - s[k - q]) / (t[k] - t[k - q]);
  const gF = g(n - 1);
  let dev = 0;
  for (let k = from; k < n; k++) dev = Math.max(dev, Math.abs(g(k) - gF));
  const ramps = Number.isFinite(gF) && gF !== 0 && dev <= band * Math.abs(gF) && Math.abs(gF) * (t[n - 1] - t[0]) >= 0.5 * Math.abs(s[n - 1] - y[0]);
  let ks = n - 1;
  while (ks > 2 * m + q && Math.abs(g(ks - 1) - gF) <= band * Math.abs(gF)) ks--;
  return { ramps, slope: gF, tSteady: t[ks], m, ripple: rippleOf(y, m, from) };
}

function settleTime(t, y, scale) {
  const n = y.length, dt = (t[n - 1] - t[0]) / (n - 1);
  const moved = Math.abs(mean(y, lastStretch(t, 0.2)) - y[0]);
  const m = ripplePeriod(y, dt, Math.max(moved, scale));
  const s = smooth(y, m), final = s[n - 1];
  const tol = 0.02 * Math.max(Math.abs(final - y[0]), scale);
  let k = n - 1;
  while (k > 0 && Math.abs(s[k - 1] - final) <= tol) k--;
  if (m > 1 && n > 4 * m) {
    const c = smooth(y, m, centred), kEnd = n - m, swing = (j) => Math.abs(y[j] - c[j]);
    let end = 0;
    for (let j = Math.min(lastStretch(t, 0.2), kEnd - 1); j < kEnd; j++) end = Math.max(end, swing(j));
    let j = kEnd - 1;
    while (j > 0 && swing(j - 1) <= end + tol) j--;
    k = Math.max(k, j);
  }
  return { settled: Number.isFinite(final) && t[k] <= t[0] + 0.8 * (t[n - 1] - t[0]), time: t[k] };
}

function fitFopdt(t, y, du, final, m = 0) {
  const s = smooth(y, m, centred), n = s.length;
  const cross = (level) => {
    for (let k = 1; k < n; k++) if ((s[k] - level * final) * Math.sign(final) >= 0) {
      const f = (level * final - s[k - 1]) / (s[k] - s[k - 1] || 1);
      return t[k - 1] + f * (t[k] - t[k - 1]);
    }
    return t[n - 1];
  };
  const t28 = cross(0.283), t63 = cross(0.632), t2 = cross(0.02);
  let tau = Math.max(1.5 * (t63 - t28), 1e-6), theta = Math.max(0, t63 - tau);
  if (theta < 0.5 * t2) { theta = t2; tau = Math.max(t63 - t2, 1e-6); }
  return { K: final / du, tau, theta, t28, t63 };
}

function fitIntegrating(t, y, du, from) {
  const n = y.length, { a, b } = lineFit(t, y, from, n);
  const L = Math.max(0, -a / b);
  const sse = (tau2) => {
    const th = L - tau2;
    let e = 0;
    for (let k = 0; k < n; k++) {
      const x = t[k] - th;
      const model = x <= 0 ? 0 : tau2 > 1e-12 ? b * (x - tau2 * (1 - Math.exp(-x / tau2))) : b * x;
      e += (y[k] - model) ** 2;
    }
    return e;
  };
  let best = 0, bestE = Infinity;
  for (let i = 0; i <= 40; i++) { const e = sse((i / 40) * L); if (e < bestE) { bestE = e; best = i; } }
  let lo = (Math.max(0, best - 1) / 40) * L, hi = (Math.min(40, best + 1) / 40) * L;
  const gr = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 40; i++) { const c = hi - gr * (hi - lo), d = lo + gr * (hi - lo); if (sse(c) < sse(d)) hi = d; else lo = c; }
  const tau2 = (lo + hi) / 2;
  return { kp: b / du, slope: b, L, tau2, theta: L - tau2 };
}


function holdThen(variant, tSwitch, u, lo, hi) {
  const v = Math.min(hi, Math.max(lo, u));
  return {
    name: 'Step test', type: variant.type, params: variant.params,
    law: (Ts) => {
      const inner = makeLaw(variant, Ts), kSwitch = Math.round(tSwitch / Ts);
      let k = 0;
      return { step: (x) => (k++ < kSwitch ? inner.step(x) : v) };
    },
  };
}

const cutRun = (run, k) => ({ ...run, t: run.t.subarray(0, k), signals: Object.fromEntries(Object.entries(run.signals).map(([name, v]) => [name, v.subarray(0, k)])) });

function* stepAt(ctx, point, du, bound = Infinity) {
  const { lo, hi } = limitsOf(ctx.variant);
  const hold = loopSignals(point.hold, ctx.key);
  const st = settleTime(hold.t, hold.y, point.scale);
  const notes = [];
  if (!st.settled) notes.push(`${ctx.variant.name} does not settle at r0 = ${fmtN(point.r0)}, so the test starts one sample after t = 0, from the plant's start: exact for a linear plant, rough otherwise`);
  const tHold = st.settled ? Math.ceil(st.time / ctx.Ts - 1e-6) * ctx.Ts : ctx.Ts;
  const out = { du, u0: point.u0, r0: point.r0, tHold, notes };
  let W = ctx.sim.duration, runB = null;
  for (let tries = 0; tries < 2; tries++, W *= 4) {
    const sim = { duration: tHold + W, sampleTime: ctx.sim.sampleTime };
    const runA = runVariant(ctx, holdThen(ctx.variant, tHold, point.u0, lo, hi), point.signals, sim);
    yield { partial: true, phase: 'step test', seconds: sim.duration };
    runB = runVariant(ctx, holdThen(ctx.variant, tHold, point.u0 + du, lo, hi), point.signals, sim);
    yield { partial: true, phase: 'step test', seconds: sim.duration };
    const yA = loopSignals(runA, ctx.key).y, { t: tB, y: yB } = loopSignals(runB, ctx.key);
    let k0 = 0;
    while (k0 < tB.length - 1 && tB[k0] < tHold - 1e-9) k0++;
    const n = tB.length - k0, t = new Float64Array(n), dy = new Float64Array(n);
    let kBad = n, kOut = n;
    for (let k = 0; k < n; k++) {
      t[k] = tB[k0 + k] - tHold;
      dy[k] = yB[k0 + k] - yA[k0 + k];
      if (!Number.isFinite(dy[k]) && kBad === n) kBad = k;
      if (Math.abs(dy[k]) > bound && kOut === n) kOut = k;
    }
    if (kBad <= kOut && kBad < n) return { ...out, ok: false, run: runB, why: 'the open-loop run diverged: the plant is unstable without its controller; use the relay or iterative method' };
    let moved = 0;
    for (let k = 0; k < n; k++) if (Number.isFinite(dy[k])) moved = Math.max(moved, Math.abs(dy[k]));
    if (!(moved > 1e-9 * point.scale)) return { ...out, ok: false, still: true, run: runB, why: `y does not respond to a step of u (Δu = ${fmtN(du)}) at r0 = ${fmtN(point.r0)}: is the controller's output wired to the plant, or does the plant sit at a limit of its own there?` };
    const level = settledLevel(t, dy);
    if (level.settled) {
      if (Math.abs(level.final) > bound) return { ...out, ok: false, exceeded: true, final: level.final, run: runB };
      const fit = fitFopdt(t, dy, du, level.final, level.m);
      return { ...out, ok: true, model: 'fopdt', ...fit, ripple: level.ripple, rippleT: level.m > 1 ? level.m * ctx.sim.sampleTime : 0, size: level.size, run: runB, tEnd: t[n - 1] };
    }
    const kEnd = Math.min(n, kOut);
    const ramp = settledSlope(t.subarray(0, kEnd), dy.subarray(0, kEnd));
    if (ramp.ramps) {
      let kStop = 16;
      while (kStop < kEnd && t[kStop - 1] < ramp.tSteady / 0.8) kStop++;
      let r = settledSlope(t.subarray(0, kStop), dy.subarray(0, kStop));
      while (!r.ramps && kStop < kEnd) { kStop = Math.min(kEnd, Math.ceil(1.05 * kStop) + 1); r = settledSlope(t.subarray(0, kStop), dy.subarray(0, kStop)); }
      let fit = null, faded = false;
      for (let pass = 0; pass < 4; pass++) {
        const tt = t.subarray(0, kStop);
        fit = fitIntegrating(tt, dy.subarray(0, kStop), du, lastStretch(tt, 0.2));
        const tNeed = (fit.L + 5 * fit.tau2) / 0.8;
        faded = t[kStop - 1] >= 0.98 * tNeed;
        if (faded || kStop >= n) break;
        let k = kStop;
        while (k < n && t[k - 1] < tNeed) k++;
        if (k > kEnd) return { ...out, ok: false, exceeded: true, reach: Math.abs(fit.slope) * Math.max(tNeed - fit.L, 0), run: runB };
        kStop = k;
      }
      r = settledSlope(t.subarray(0, kStop), dy.subarray(0, kStop));
      const tt = t.subarray(0, kStop), yy = dy.subarray(0, kStop);
      return { ...out, ok: true, model: 'integrating', ...fit, faded, ripple: r.ripple, rippleT: r.m > 1 ? r.m * ctx.sim.sampleTime : 0, moved: yy[kStop - 1], run: cutRun(runB, k0 + kStop), tEnd: tt[kStop - 1] };
    }
    if (kOut < n) return { ...out, ok: false, exceeded: true, reach: moved, run: runB };
  }
  return { ...out, ok: false, run: runB, why: 'the step response settled neither to a level nor to a steady slope in four periods of the input: a very slow plant (lengthen the input\'s period)' };
}

function* boundedStep(ctx, point, want, dir, bound, boundWhy, responds = false) {
  const { lo, hi } = limitsOf(ctx.variant);
  const room = (s) => (s > 0 ? hi - point.u0 : point.u0 - lo);
  const enough = (s) => room(s) >= (dir ? 0.1 : 1) * want;
  const first = dir || 1;
  const s = enough(first) ? first : room(-first) >= want ? -first : room(first) >= room(-first) ? first : -first;
  let du = s * Math.min(want, room(s));
  if (!(Math.abs(du) >= 0.1 * want)) return { du, u0: point.u0, r0: point.r0, notes: [], ok: false, why: `the actuator is at a limit at r0 = ${fmtN(point.r0)} (u0 = ${fmtN(point.u0)}): no room for a step` };
  const notes = [], unit = measurement(ctx).unit, u = unit ? ` ${unit}` : '';
  if (dir && s !== dir) notes.push(`the step went the other way (Δu = ${fmtN(du)}): no room for it in u`);
  else if (Math.abs(du) < want) notes.push(`the step was made smaller, Δu = ${fmtN(du)}, to stay inside the actuator limits`);
  let moved = null;
  for (let tries = 0; ; tries++) {
    const r = yield* stepAt(ctx, point, du, bound);
    if (r.still && (moved || responds)) {
      r.why = `y does not respond to a step of u (Δu = ${fmtN(du)}) at r0 = ${fmtN(point.r0)}${u}, ${moved ? `though a step of Δu = ${fmtN(moved)} moved it by more than ${fmtN(bound)}${u}` : 'though it does at other points'}: the plant sits at a limit of its own there`;
    }
    if (!r.exceeded) { r.notes.unshift(...notes); return { ...r, bound, boundWhy }; }
    if (tries === 5) return { ...r, ok: false, notes, why: `even a step of Δu = ${fmtN(du)} moves y by more than ${fmtN(bound)}${u} (${boundWhy}) before it settles` };
    moved = du;
    const far = Math.abs(r.final ?? r.reach ?? NaN);
    du *= far > 0 && Number.isFinite(far) ? Math.min(0.5, (0.8 * bound) / far) : 0.5;
    notes.splice(0, notes.length, `the step was made smaller, Δu = ${fmtN(du)}, so y moves by at most ${fmtN(bound)}${u} (${boundWhy})`);
  }
}

function* holdAt(ctx, op, target, scale) {
  let level = target, signals, run, r, y, u, sim = ctx.sim;
  for (let i = 0; i < 3; i++) {
    signals = holding(ctx, level);
    run = runVariant(ctx, ctx.variant, signals, sim);
    yield { partial: true, phase: 'hold', seconds: sim.duration };
    const s = loopSignals(run, ctx.key), k0 = Math.floor(0.75 * s.t.length);
    r = mean(s.r, k0); y = mean(s.y, k0); u = mean(s.u, k0);
    if (Math.abs(r - target) > 1e-3 * scale && Math.abs(op.r0 - r) > 1e-12 && level !== op.level && i === 0) {
      level += ((target - r) * (op.level - level)) / (op.r0 - r);
      continue;
    }
    if (sim !== ctx.sim || settleTime(s.t, s.y, scale).settled) break;
    sim = longer(ctx.sim, 4);
  }
  const { lo, hi } = limitsOf(ctx.variant);
  return { signals, hold: run, r0: r, y, u0: Math.min(hi, Math.max(lo, u)), scale, reached: Math.abs(y - target) <= 0.02 * scale };
}

function* scheduleExperiment(ctx, op, want, base, scale) {
  const at = ctx.variant.params.at;
  const mid = (at[0] + at[at.length - 1]) / 2;
  const order = at.map((_, i) => i).sort((a, b) => Math.abs(at[a] - mid) - Math.abs(at[b] - mid) || a - b);
  const points = new Array(at.length);
  let sign = 0;
  for (const i of order) {
    const target = at[i];
    const point = yield* holdAt(ctx, op, target, scale);
    if (!point.reached) { points[i] = { at: target, ok: false, notes: [], why: `${ctx.variant.name} holds y at ${fmtN(point.y)}, not at ${fmtN(target)}` }; continue; }
    const toward = target <= mid ? 1 : -1, next = at[i + toward] ?? at[i - toward];
    const bound = next === undefined ? (op.span > 1e-9 ? op.span / 2 : Infinity) : Math.abs(next - target) / 2;
    const r = yield* boundedStep(ctx, point, want, sign ? toward * sign : 0, bound, 'half the way to the next point', sign !== 0);
    if (r.ok && !sign) sign = Math.sign(r.model === 'integrating' ? r.kp : r.K) || 1;
    points[i] = { at: target, ...r, notes: [...r.notes, ...stepNotes(r, measurement(ctx).unit)] };
  }
  const ok = points.filter((p) => p.ok);
  const show = points[order.find((i) => points[i].ok) ?? order[0]];
  if (!ok.length) return { ...base, ...show, ok: false, model: 'schedule', points, shownAt: show.at, why: `no step test worked; at ${fmtN(show.at)}: ${show.why}` };
  const y0 = loopSignals(op.ownRun, ctx.key).y[0];
  let trim = ok.find((p) => Math.abs(p.at - y0) <= 1e-6 * scale)?.u0;
  const notes = [...base.notes];
  if (trim === undefined) {
    const h = yield* holdAt(ctx, op, y0, scale);
    trim = h.u0;
    if (!h.reached) notes.push(`${ctx.variant.name} does not hold y at its start level ${fmtN(y0)}: u0 is rough`);
  }
  return { ...base, ok: true, model: 'schedule', points, trim, y0, notes, run: show.run, u0: show.u0, r0: show.r0, du: show.du, tHold: show.tHold, shownAt: show.at };
}

function* stepExperimentSteps(project, path, opts = {}) {
  const ctx = tuneContext(project, path);
  if (siso(ctx)) return { ctx, ok: false, notes: [], why: siso(ctx) };
  const op = yield* operatingPoint(ctx);
  const range = actuatorRange(ctx, op.own);
  const base = { ctx, r0: op.r0, u0: op.u0, notes: [...op.notes] };
  if (opts.du === undefined && !range) return { ...base, ok: false, why: NO_RANGE };
  const want = Math.abs(opts.du ?? (opts.amplitude ?? 0.1) * range);
  const scale = op.span > 1e-9 ? op.span : Math.abs(op.r0) || 1;
  if (ctx.variant.type === 'gainScheduled' && op.name) return yield* scheduleExperiment(ctx, op, want, base, scale);
  const point = { signals: op.signals, hold: op.holdRun, u0: op.u0, r0: op.r0, scale };
  const r = yield* boundedStep(ctx, point, want, 0, op.span > 1e-9 ? op.span / 2 : Infinity, 'half of r\'s span');
  return { ...base, ...r, notes: [...base.notes, ...r.notes, ...stepNotes(r, measurement(ctx).unit)] };
}

const stepExperiment = (project, path, opts) => drain(stepExperimentSteps(project, path, opts));

function stepNotes(r, unit = '') {
  if (!r.ok) return [];
  const notes = [], u = unit ? ` ${unit}` : '';
  if (r.model === 'integrating') notes.push(`y ramps (an integrating plant): the test ended ${fmtN(r.tEnd)} s after the step, once its slope was steady${r.faded ? ' and its lag\'s transient had faded below 1 %' : ', before its lag had faded (the record is too short, so the estimate is rough)'}, with y moved by ${fmtN(Math.abs(r.moved))}${u}${Number.isFinite(r.bound) ? ` (it may move ${fmtN(r.bound)}${u}, ${r.boundWhy})` : ''}`);
  const size = r.model === 'integrating' ? Math.abs(r.moved) : r.size;
  if (r.ripple > 0.005 * size) notes.push(`y ripples by ±${fmtN(r.ripple)}${u} (${fmtN((100 * r.ripple) / size)} % of the step response)${r.rippleT ? `, slowest strong period ${fmtN(r.rippleT)} s; the test reads y averaged over it` : ''}`);
  return notes;
}

const SIMC = {
  tight: { label: 'Tight', short: '', f: 1, about: 'τc = θ (Skogestad 2003): fast; his margins on the model: Ms 1.6–1.7, gain margin about 3' },
  smooth: { label: 'Smooth', short: ' smooth', f: 3, about: 'τc = 3θ: slower and gentler on u, more robust' },
};
const simcFactor = (rule) => {
  if (!SIMC[rule]) throw new Error(`SIMC τc: one of ${Object.keys(SIMC).join(', ')}`);
  return SIMC[rule].f;
};

function tauCSource(g, rule = 'tight') {
  const f = SIMC[rule]?.f ?? 1, x = f === 1 ? '' : `${f} × `;
  if (g.by === 'ripple') return `${x}the ripple's period on y (our floor), not the dead time θ = ${fmtN(g.theta)} s (half a controller sample included)`;
  if (g.by === 'lag') return `${x}a tenth of the lag τ (our floor), not the dead time θ = ${fmtN(g.theta)} s (half a controller sample included), which is shorter`;
  if (g.by === 'given') return 'given';
  const dead = `the dead time${g.Tf ? ' with the derivative\'s filter' : ''}`;
  return f === 1 ? `θ, ${dead} (Skogestad's tight rule)` : `${f}θ (θ = ${fmtN(g.theta)} s, ${dead})`;
}

function tauCShort(g, rule = 'tight') {
  const f = SIMC[rule]?.f ?? 1, x = f === 1 ? '' : `${f} × `;
  return g.by === 'ripple' ? `${x}ripple period` : g.by === 'lag' ? `${x}τ/10` : g.by === 'given' ? 'given' : `${f === 1 ? '' : f}θ`;
}

function simcGains(K, tau, theta, Ts = 0, tauC = null, rule = 'tight', minTauC = 0) {
  const th = theta + Ts / 2, base = Math.max(th, tau / 10, minTauC);
  const by = tauC !== null ? 'given' : base === th ? 'theta' : minTauC >= tau / 10 ? 'ripple' : 'lag';
  const tc = tauC ?? simcFactor(rule) * base;
  const Kp = tau / (K * (tc + th)), Ti = Math.min(tau, 4 * (tc + th));
  return { Kp, Ki: Kp / Ti, Kd: 0, Ti, Td: 0, tauC: tc, theta: th, thetaPlant: th, Ts, by, byRipple: by === 'ripple' };
}

function simcIntegrating(kp, theta, tau2 = 0, Ts = 0, { rule = 'tight', pid = null, minTauC = 0, dFilter = null } = {}) {
  const withD = pid ?? tau2 > theta + Ts / 2, f = simcFactor(rule);
  const own = withD && dFilter;
  const thPlant = (withD ? theta : theta + tau2 / 2) + Ts / 2;
  let Tf = own ? dFilter(tau2) : 0, g = null;
  for (let i = 0; i < 50; i++) {
    const th = thPlant + (own ? Tf : 0), base = Math.max(th, minTauC);
    const tc = f * base;
    const Kc = 1 / (kp * (tc + th)), tauI = 4 * (tc + th), tauD = withD ? tau2 : 0;
    const Kp = Kc * (1 + tauD / tauI), Ki = Kc / tauI, Kd = Kc * tauD;
    g = { Kp, Ki, Kd, Ti: Kp / Ki, Td: Kd / Kp, tauC: tc, theta: th, thetaPlant: thPlant, Ts, Tf: own ? Tf : undefined, Kc, tauI, tauD, by: base === th ? 'theta' : 'ripple', byRipple: base !== th };
    if (!own) break;
    const next = dFilter(g.Td);
    if (Math.abs(next - Tf) <= 1e-12 + 1e-9 * Tf) break;
    Tf = next;
  }
  return g;
}

function simcFor(m, Ts, rule, pid = null) {
  return m.model === 'integrating'
    ? simcIntegrating(m.kp, m.theta, m.tau2, Ts, { rule, pid, minTauC: m.rippleT ?? 0, dFilter: (Td) => derivativeFilter(Td, Ts) })
    : simcGains(m.K, m.tau, m.theta, Ts, null, rule, m.rippleT ?? 0);
}

function* stepTuneSteps(project, path, opts = {}) {
  const rule = opts.simc ?? 'tight';
  simcFactor(rule);
  const ex = yield* stepExperimentSteps(project, path, opts);
  if (!ex.ok) return ex;
  const from = ex.ctx.variant, Ts = ex.ctx.Ts;
  const name = (opts.name ?? `${baseName(from.name)} · SIMC${SIMC[rule].short}`).slice(0, 40);
  if (ex.model === 'schedule') {
    const ok = ex.points.filter((p) => p.ok);
    const notes = [...ex.notes];
    const points = ex.points.map((p) => {
      if (p.ok) {
        const gains = simcFor(p, Ts, rule, false);
        return { ...p, gains, notes: [...p.notes, ...simcNotes(p, gains, true)] };
      }
      const near = ok.reduce((a, b) => (Math.abs(b.at - p.at) < Math.abs(a.at - p.at) ? b : a));
      notes.push(`at ${fmtN(p.at)}: ${p.why}; its gains are those found at ${fmtN(near.at)}`);
      return { ...p, gains: simcFor(near, Ts, rule, false), from: near.at };
    });
    const p = from.params;
    const variant = normalizeVariant({ name, type: 'gainScheduled', params: { at: p.at, Kp: points.map((q) => q.gains.Kp), Ki: points.map((q) => q.gains.Ki), Tr: p.Tr, Kff: p.Kff, Kv: p.Kv, Ka: p.Ka, u0: ex.trim, umin: p.umin, umax: p.umax, aw: p.aw, Tt: p.Tt } });
    return { ...ex, points, notes, simc: rule, variant };
  }
  const g = simcFor(ex, Ts, rule);
  return { ...ex, notes: [...ex.notes, ...simcNotes(ex, g)], simc: rule, gains: g, variant: pidVariant(from, g, name, Ts) };
}

function simcNotes(m, g, scheduled = false) {
  const notes = [];
  if (g.by === 'ripple') notes.push(`τc = ${fmtN(g.tauC)} s is set from the ripple's period (${fmtN(m.rippleT)} s), not from the dead time (${fmtN(g.theta)} s, half a controller sample included): a faster loop would chase the ripple`);
  if (g.by === 'lag') notes.push(`τc = ${fmtN(g.tauC)} s is set from a tenth of the lag τ = ${fmtN(m.tau)} s (our floor), not from the dead time θ = ${fmtN(g.theta)} s (half a controller sample included), which is shorter`);
  if (m.model === 'integrating' && m.tau2 > 0.02 * m.L) {
    if (g.Kd) notes.push(`the lag τ2 = ${fmtN(m.tau2)} s is longer than the dead time θ = ${fmtN(g.thetaPlant)} s (half a controller sample included), so the PI gets a derivative that cancels it (SIMC PID)`);
    else notes.push(`${scheduled ? 'a gain-scheduled PI has no derivative' : `the lag τ2 = ${fmtN(m.tau2)} s is no longer than the dead time`}, so half of τ2 counts as dead time (the half rule)`);
  }
  if (g.Tf) notes.push(`SIMC's margins are for an unfiltered derivative; this PID filters it at Tf = ${fmtN(g.Tf)} s (Td/10, at least a sample), a lag that counts as dead time: θ = ${fmtN(g.thetaPlant)} + ${fmtN(g.Tf)} = ${fmtN(g.theta)} s`);
  return notes;
}

const stepTune = (project, path, opts) => drain(stepTuneSteps(project, path, opts));


const METHODS = ['iterate', 'relay', 'step'];

function* autotuneSteps(project, path, opts = {}) {
  const method = opts.method ?? 'iterate';
  if (!METHODS.includes(method)) throw new Error(`method: one of ${METHODS.join(', ')}`);
  const g = { ...GOAL, ...opts.goal };
  const ctx = tuneContext(project, path);
  const head = { method, key: ctx.key, path: ctx.path, where: ctx.where, goal: g };
  const why = whyNot(ctx, method);
  if (why) return { ...head, ok: false, why, notes: [] };
  const name = opts.name ?? resultName(ctx.block, method, opts.rule, opts.simc);
  if (method === 'iterate') {
    const r = yield* iterate(project, path, g, { maxIter: opts.maxIter, feedforward: opts.feedforward });
    const better = r.best.cost.J < r.start.cost;
    return {
      ...head, ok: true, notes: r.notes, before: { variant: ctx.variant, cost: r.start.detail },
      variant: { ...r.best.variant, name }, after: r.best.cost, better, iterations: r.iteration, evals: r.evals, names: r.names,
    };
  }
  const startRun = runVariant(ctx, ctx.variant);
  const scales = costScales(startRun, ctx.key, ctx.variant);
  const before = { variant: ctx.variant, cost: runCost(startRun, ctx.key, g, { scales, variant: ctx.variant, others: ctx.others }) };
  yield { partial: true, phase: 'start', before, seconds: ctx.sim.duration };
  const res = method === 'relay'
    ? yield* relayTuneSteps(project, path, opts.rule ?? 'tl', { amplitude: opts.amplitude, d: opts.d, name })
    : yield* stepTuneSteps(project, path, { amplitude: opts.amplitude, du: opts.du, simc: opts.simc, name });
  if (!res.ok) return { ...res, ...head, before };
  const after = variantCost(ctx, res.variant, g, scales);
  yield { partial: true, phase: 'score', seconds: ctx.sim.duration };
  if (res.model === 'integrating' && res.variant.params.Ki && !res.variant.params.Tr && after.overshoot > g.overshoot) {
    const Tr = res.gains.tauI, pre = variantCost(ctx, { ...res.variant, params: { ...res.variant.params, Tr } }, g, scales);
    yield { partial: true, phase: 'score', seconds: ctx.sim.duration };
    res.notes = [...res.notes, `plant and controller both integrate, so y overshoots a step in r (${fmtN(after.overshoot)} %); with a prefilter on r of Tr = τI = ${fmtN(Tr)} s it would overshoot ${fmtN(pre.overshoot)} %, at the price of a slower response to r: cost ×${fmtN(pre.J / before.cost.J)} of ${ctx.variant.name}, against ×${fmtN(after.J / before.cost.J)} without the prefilter`];
  }
  const out = { ...res, ...head, before, after, better: after.J < before.cost.J };
  if (!out.better) out.worse = whyWorse(out, ctx);
  const start = unstableAtStart(project, ctx, res.variant);
  if (start && !unstableAtStart(project, ctx, ctx.variant)) {
    out.unstableAtStart = start;
    out.worse = [start.sentence, out.better ? whyWorse(out, ctx, { cost: false }) : out.worse].filter(Boolean).join('; ');
    out.better = false;
  }
  return out;
}

function unstableAtStart(project, ctx, variant) {
  let m, r;
  try {
    const p = { ...project, system: { ...project.system, plant: { ...project.system.plant, diagram: withVariant(ctx.diagram, ctx.path, variant) } } };
    m = loopModel(p, ctx.path, 'initial');
    if (m.atLimit) return null;
    r = analyzeLoop(m.plant, m.ctrl, m.Ts);
  } catch { return null; }
  if (r.stable || r.marginal) return null;
  return { Z: r.Z, label: m.opLabel, sentence: `it is unstable where the run starts (${m.opLabel}: ${r.Z} closed-loop pole${r.Z > 1 ? 's' : ''} outside the unit circle); the run rests there only because it starts in exact balance, and the first disturbance there sets it off` };
}

const autotune = (project, path, opts) => drain(autotuneSteps(project, path, opts));

function measurement(ctx) {
  const { level } = locate(ctx.diagram, ctx.path);
  const w = wireTo(level, ctx.block.id, 1);
  if (!w) return { name: '', unit: '' };
  const from = parseEnd(w.from);
  const byId = (id) => level.blocks.find((b) => b.id === id);
  const src = byId(from.id);
  if (src?.type === 'source') return { name: src.params.signal, unit: src.params.unit ?? '' };
  const sink = level.wires.map((x) => ({ x, to: byId(parseEnd(x.to).id) })).find(({ x, to }) => to?.type === 'sink' && parseEnd(x.from).id === from.id && parseEnd(x.from).port === from.port)?.to;
  return sink ? { name: sink.params.name, unit: sink.params.unit && sink.params.unit !== '1' ? sink.params.unit : '' } : { name: '', unit: '' };
}

function whyWorse(res, ctx, { cost = true } = {}) {
  const was = res.before.variant, now = res.variant, a = res.before.cost, b = res.after, goal = res.goal;
  const y = measurement(ctx), yName = y.name || 'y', at = (v) => `${yName} = ${fmtN(v)}${y.unit ? ` ${y.unit}` : ''}`;
  const kind = (v) => (v.type === 'gainScheduled' ? 'gain-scheduled PI' : v.params.Kd ? 'PID' : v.params.Ki ? 'PI' : 'P controller');
  const out = [];
  if (was.type === 'gainScheduled' && now.type !== 'gainScheduled') {
    const kp = was.params.Kp.map(Math.abs), lo = Math.min(...kp), hi = Math.max(...kp);
    const test = res.method === 'relay' ? 'a relay test' : 'a step test';
    if (hi > 1.5 * lo) out.push(`one ${kind(now)} from ${test} at ${at(res.r0)}; ${was.name} changes its gains with ${yName} (Kp ${fmtN(lo)} … ${fmtN(hi)}), which a single ${kind(now)} cannot`);
  } else if (was.type === 'pid' && was.params.Kd && now.type === 'pid' && !now.params.Kd) {
    out.push(`the result is a PI: SIMC from a first order plus dead time has no derivative action, and ${was.name} uses one`);
  }
  if (res.notes?.some((n) => /estimate is rough/.test(n))) out.push('the experiment\'s estimate is rough (see the notes)');
  const { lo, hi } = limitsOf(was), kp = Math.abs(now.params.Kp ?? 0);
  if (res.ripple && !Array.isArray(now.params.Kp) && Number.isFinite(hi - lo) && kp * res.ripple >= 0.05 * (hi - lo)) {
    out.push(`${yName} ripples by ±${fmtN(res.ripple)}${y.unit ? ` ${y.unit}` : ''}, and its Kp passes ±${fmtN(kp * res.ripple)} of that to u (${fmtN((100 * kp * res.ripple) / (hi - lo))} % of u's range)`);
  }
  if (!cost) return out.join('; ');
  if (b.diverged) out.push('the loop diverges with it');
  else {
    const [part] = Object.keys(b.parts).map((k) => [k, b.parts[k] - (a.parts?.[k] ?? 0)]).sort((p, q) => q[1] - p[1])[0];
    const x = (k) => (a.parts?.[k] > 0 ? `×${fmtN(b.parts[k] / a.parts[k])}` : `${fmtN(b.parts[k])}, was 0`);
    if (part === 'overshoot') out.push(`it overshoots ${fmtN(b.overshoot)} % (the goal allows ${fmtN(goal.overshoot)} %; ${was.name}: ${fmtN(a.overshoot)} %)`);
    else if (part === 'error') out.push(`r − y is larger (${goal.cost} ${x('error')})`);
    else if (part === 'effort') out.push(`u swings more (effort ${x('effort')})`);
    else out.push(`u sits at a limit ${fmtN(100 * b.saturated)} % of the time (${was.name}: ${fmtN(100 * a.saturated)} %)`);
  }
  return out.join('; ');
}

function tuneReport(res) {
  const cost = (c) => c && { J: c.J, overshoot: c.overshoot, saturated: c.saturated, diverged: c.diverged, parts: c.parts };
  const out = { ok: res.ok, method: res.method, block: res.key, where: res.where, goal: res.goal };
  const model = (m) => (m.model === 'integrating' ? { model: m.model, kp: m.kp, L: m.L, tau2: m.tau2, theta: m.theta, tEnd: m.tEnd, faded: m.faded } : { model: m.model, K: m.K, tau: m.tau, theta: m.theta });
  if (!res.ok) Object.assign(out, { why: res.why, notes: res.notes ?? [] });
  else {
    Object.assign(out, { better: res.better, before: { variant: res.before.variant, cost: cost(res.before.cost) }, after: { variant: res.variant, cost: cost(res.after) }, notes: res.notes });
    if (!res.better) out.worse = res.worse;
    if (res.unstableAtStart) out.unstableAtStart = { Z: res.unstableAtStart.Z, at: res.unstableAtStart.label };
    if (res.method === 'iterate') Object.assign(out, { iterations: res.iterations, evals: res.evals, tuned: res.names });
    if (res.method === 'relay') Object.assign(out, { Ku: res.Ku, Pu: res.Pu, amplitude: res.a, r0: res.r0, u0: res.u0, d: res.d, rule: res.rule, gains: res.gains });
    if (res.method === 'step') {
      Object.assign(out, { simc: res.simc, r0: res.r0, u0: res.u0, du: res.du, tHold: res.tHold });
      if (res.model === 'schedule') {
        Object.assign(out, { model: 'schedule', trim: res.trim, points: res.points.map((p) => ({ at: p.at, ok: p.ok, ...(p.ok ? { ...model(p), u0: p.u0, du: p.du, notes: p.notes } : { why: p.why }), ...(p.from !== undefined ? { gainsFrom: p.from } : {}), gains: p.gains })) });
      } else Object.assign(out, { ...model(res), gains: res.gains });
    }
  }
  return JSON.parse(JSON.stringify(out));
}


function baseName(name) {
  return String(name).replace(/( · (auto-tuned|relay [^·]+?|SIMC( smooth)?)( \d+)?)+$/, '');
}

function resultName(block, method, rule = 'tl', simc = 'tight') {
  const running = block.variants[block.variant ?? 0];
  const base = baseName(running.name);
  const suffix = method === 'iterate' ? ' · auto-tuned' : method === 'relay' ? ` · relay ${RULES[rule ?? 'tl']?.short ?? rule}` : ` · SIMC${SIMC[simc ?? 'tight']?.short ?? ''}`;
  const named = (s) => `${base.slice(0, Math.max(0, 40 - s.length))}${s}`;
  const plain = named(suffix);
  if (running.name === plain || (running.name.startsWith(plain) && /^ \d+$/.test(running.name.slice(plain.length)))) return running.name;
  const taken = new Set(block.variants.map((v) => v.name));
  for (let i = 1; ; i++) { const s = named(i === 1 ? suffix : `${suffix} ${i}`); if (!taken.has(s)) return s; }
}

function placeVariant(project, path, variant, { run = true } = {}) {
  const { block } = locate(project.system.plant.diagram, path);
  let i = block.variants.findIndex((v) => v.name === variant.name);
  if (i < 0) { i = (block.variant ?? 0) + 1; block.variants.splice(i, 0, null); }
  block.variants[i] = structuredClone(variant);
  if (run) block.variant = i;
  return i;
}

const derivativeFilter = (Td, Ts) => Math.max(Ts, Td / 10);

function pidVariant(from, g, name, Ts) {
  const p = from.params ?? {};
  const pid = from.type === 'pid';
  const b = pid ? p.b : 1, KpWas = pid ? p.Kp : 0, KdWas = pid ? p.Kd : 0;
  const Kv = isOn(p.Kv) ? p.Kv + g.Kd - KdWas : 0;
  const Kff = isOn(p.Kff) ? p.Kff + (g.Kp - KpWas) * (1 - b) : 0;
  return normalizeVariant({
    name: name.slice(0, 40), type: 'pid',
    params: {
      Kp: g.Kp, Ki: g.Ki, Kd: g.Kd, Tf: g.Kd ? (g.Tf ?? derivativeFilter(g.Td ?? 0, Ts)) : (pid ? p.Tf : 0.01), b, Tr: p.Tr ?? 0,
      Kff, Kv, Ka: p.Ka ?? 0, u0: p.u0 ?? 0, umin: p.umin ?? -Infinity, umax: p.umax ?? Infinity, aw: p.aw ?? 'clamp', Tt: p.Tt ?? 0,
    },
  });
}

function fmtN(v) {
  if (!Number.isFinite(v)) return String(v);
  return String(Number(v.toPrecision(3)));
}

return { drain, controllerBlocks, withVariant, upstreamSource, tuneContext, runVariant, loopSignals, loopOverlays, COSTS, GOAL, costScales, runCost, variantCost, tuningSpace, feedforwardStart, tunedValues, iterate, runIterate, RULES, pidFromUltimate, whyNot, relayExperimentSteps, relayExperiment, relayTuneSteps, relayTune, ripplePeriod, settledLevel, settledSlope, fitFopdt, fitIntegrating, stepExperimentSteps, stepExperiment, SIMC, tauCSource, tauCShort, simcGains, simcIntegrating, stepTuneSteps, stepTune, METHODS, autotuneSteps, unstableAtStart, autotune, measurement, whyWorse, tuneReport, baseName, resultName, placeVariant, derivativeFilter, pidVariant };
})();
// ---- core/ramp.js
__mods['core/ramp.js'] = (() => {

function fallbackScale(fn, L) {
  let lo = Infinity, hi = -Infinity;
  const n = 256, span = Number.isFinite(L) && L > 0 ? L : 1;
  for (let i = 0; i <= n; i++) { const v = fn((i / n) * span); if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
  const w = hi - lo;
  return w > 0 ? w : Math.max(Math.abs(fn(0)) || 0, 1);
}

function createRampIn({ refs, period, rate = 0.1 }) {
  const L = Number.isFinite(period) && period > 0 ? period : Infinity;
  const list = refs.map((r) => {
    const fs = Number.isFinite(r.fs) && r.fs > 0 ? r.fs : fallbackScale(r.fn, L);
    return { name: r.name, fn: r.fn, fs, R: Math.max(1e-12, rate * fs), from: 0, to: 0, v: 0 };
  });
  const byName = Object.fromEntries(list.map((r) => [r.name, r]));
  let phase = 'ramp', first = true, tR = 0, loopStart = 0, loop0 = null, loop = 0, tLast = null;

  const along = (r, s) => {
    const d = r.to - r.from, go = r.R * Math.max(0, s - tR);
    return Math.abs(d) <= go ? r.to : r.from + Math.sign(d) * go;
  };
  const arrived = (s) => list.every((r) => along(r, s) === r.to);
  const same = (a, b, r) => Math.abs(a - b) <= 1e-9 * r.fs;
  function beginRamp(s, fromValues) {
    phase = 'ramp'; tR = s;
    for (const r of list) { r.from = fromValues(r); r.to = r.fn(0); }
  }
  function beginLoop(s) {
    phase = 'loop'; loopStart = s;
    if (loop0 === null) loop0 = s; else loop++;
    first = false;
  }

  const self = {
    start(t, present = {}) {
      first = true; loop0 = null; loop = 0; tLast = null;
      beginRamp(t, (r) => (Number.isFinite(present[r.name]) ? present[r.name] : r.fn(0)));
      self.advance(t);
    },
    advance(t) {
      if (phase === 'ramp') {
        if (arrived(t)) beginLoop(t);
      } else if (t - loopStart > L * (1 + 1e-12) + 1e-9) {
        if (list.every((r) => same(r.fn(L), r.fn(0), r))) {
          while (t - loopStart > L * (1 + 1e-12) + 1e-9) { loopStart += L; loop++; }
        } else {
          beginRamp(tLast ?? t, (r) => r.v);
          if (arrived(t)) beginLoop(t);
        }
      }
      for (const r of list) r.v = self.value(r.name, t);
      tLast = t;
    },
    value(name, s) {
      const r = byName[name];
      if (!r) return NaN;
      if (phase === 'ramp') return along(r, s);
      return r.fn(Math.max(0, s - loopStart));
    },
    values: () => Object.fromEntries(list.map((r) => [r.name, r.v])),
    state() {
      const left = phase === 'ramp' ? Math.max(0, ...list.map((r) => Math.abs(r.to - r.v) / r.R)) : 0;
      return {
        phase, first: phase === 'ramp' && first,
        runT: loop0 === null || tLast === null ? null : tLast - loop0,
        tau: phase === 'loop' && tLast !== null ? tLast - loopStart : null,
        left, loop,
        to: phase === 'ramp' ? Object.fromEntries(list.map((r) => [r.name, r.to])) : null,
      };
    },
    scale: (name) => (byName[name] ? { fs: byName[name].fs, rate: byName[name].R } : null),
  };
  return self;
}

return { fallbackScale, createRampIn };
})();
// ---- core/live.js
__mods['core/live.js'] = (() => {

const { compileDiagram, normalizeDiagram, diagramNames, parseEnd } = __mods['core/diagram.js'];
const { CONTROLLERS } = __mods['core/controllers.js'];
const { OBSERVERS } = __mods['core/observers.js'];
const { referenceFn } = __mods['core/signals.js'];
const { createRampIn } = __mods['core/ramp.js'];
const { HIL_PROTOCOL, WATCHDOG_CYCLES, rpcRequest, uMessage, startParams, parseMessage, checkDescription, pageWatchdog, createLinkStats, fullScales, blockMode } = __mods['core/hil.js'];
const NAN_CYCLES = 3;

function controllerOnReference(params, links) {
  for (const c of links.ctrls) {
    for (const i of c.drives ?? []) {
      if ((params.kinds?.[i] ?? 'effort') !== 'reference') continue;
      return `Controller "${c.key}" is wired to ${params.inputs[i]}, which this plant takes as a reference (reference mode: the plant runs its own controller). Wire the Controller's output elsewhere, load a system made for reference mode (such as "HIL: an external plant, reference mode"), or start the plant in control mode (hil_plant.py without --mode reference).`;
    }
  }
  return null;
}

const SAMPLED = ['controller', 'observer'];
const LIBS = { controller: CONTROLLERS, observer: OBSERVERS };
function structureKey(diagram) {
  return JSON.stringify(diagram, function (k, v) {
    if ((k === 'x' || k === 'y') && typeof v === 'number' && this.id !== undefined) return undefined;
    if (k === 'variants' && SAMPLED.includes(this.type) && Array.isArray(v)) return v.map((x, i) => (LIBS[this.type][x.type]?.designed && i === (this.variant ?? 0) ? { type: x.type, params: x.params } : x.type));
    if (k === 'params' && this.type === 'external' && v) { const { ramp, scales, ...rest } = v; void ramp; void scales; return rest; }
    return v;
  });
}

function copyParams(own, next) {
  own.blocks.forEach((b, i) => {
    const n = next.blocks[i];
    if (SAMPLED.includes(b.type)) Object.assign(b.variants[b.variant].params, n.variants[n.variant].params);
    if (b.type === 'subsystem') copyParams(b.diagram, n.diagram);
  });
}

function createLiveRunner(diagram, signals) {
  const fns = {};
  let own, key, el, ext, keep, X, Xt, k1, k2, k3, k4, tPrev, h, links, ramp = null, started = false, log = [], period = Infinity;
  let sigs = {};

  function setSignals(next) {
    sigs = next ?? {};
    for (const name of Object.keys(fns)) delete fns[name];
    for (const [name, ref] of Object.entries(sigs)) fns[name] = referenceFn(ref, { sampleTime: h ?? 0.01 });
  }
  const wave = (name) => (tau) => (fns[name] ? fns[name](tau) : 0);
  function build(d) {
    own = normalizeDiagram(structuredClone(d));
    key = structureKey(own);
    const sources = new Proxy({}, { get: (_, name) => (t) => (started && ramp ? ramp.value(name, t) : wave(name)(0)) });
    el = compileDiagram(own, 'plant', { standalone: true, sources });
    keep = el.probes().flatMap(([n], i) => (n.includes('.') ? [] : [i]));
    if (el.externals.length !== 1) throw new Error(el.externals.length ? 'one External plant per system, for now' : 'this system has no External plant block: add one from the Live group in the Plant tab');
    ext = el.externals[0];
    links = el.links();
    const why = controllerOnReference(ext.params, links);
    if (why) throw new Error(why);
    const dt = 1 / ext.params.rate;
    const m = Math.max(1, Math.ceil(dt / (el.bound > 0 ? Math.min(0.5 / el.bound, el.minTs) : Math.min(dt, el.minTs)) - 1e-9));
    h = dt / m;
    el.setStep(h);
    X = new Float64Array(el.n); Xt = new Float64Array(el.n);
    k1 = new Float64Array(el.n); k2 = new Float64Array(el.n); k3 = new Float64Array(el.n); k4 = new Float64Array(el.n);
    el.init(X, 0);
    tPrev = null;
    started = false;
    const units = diagramNames(own).units;
    const ctrls = blockMode(ext.params) === 'control' ? links.ctrls : [];
    log = ctrls.flatMap((c) => {
      const unit = c.measured !== undefined ? ext.params.outUnits[c.measured] : units[c.source] ?? '1';
      const pre = ctrls.length > 1 ? `${c.key.replace(/\//g, '_')}_` : '';
      return [{ name: `${pre}r`, unit, probe: `${c.key}.r` }, { name: `${pre}e`, unit, probe: [`${c.key}.r`, `${c.key}.y`] }];
    });
  }
  function makeRamp() {
    const played = diagramNames(own).sources.filter((n) => sigs[n]);
    period = Math.max(...played.map((n) => sigs[n].period), 0) || Infinity;
    const fs = fullScales(ext.params, links);
    ramp = createRampIn({ refs: played.map((name) => ({ name, fn: wave(name), fs: fs[name] ? fs[name][1] - fs[name][0] : null })), period, rate: ext.params.ramp / 100 });
    return played;
  }
  setSignals(signals);
  build(diagram);
  const names = () => { const all = el.probes(); return keep.map((i) => all[i][0]); };
  const probe = (all, name) => { for (const [n, v] of all) if (n === name) return v; return NaN; };

  function present(y) {
    const out = {};
    const all = el.probes();
    for (const [name, at] of Object.entries(links.sources)) {
      if (at.ctrl !== undefined) {
        const v = probe(all, `${at.ctrl}.y`);
        if (Number.isFinite(v)) out[name] = v;
      } else if (at.input !== undefined) {
        const j = ext.params.outputs.indexOf(ext.params.measures?.[at.input] ?? '');
        out[name] = ext.params.kinds?.[at.input] === 'reference' && j >= 0 && Number.isFinite(y[j]) ? y[j] : ext.params.safe[at.input];
      }
    }
    return out;
  }

  function rk4(t, dt) {
    const N = el.n;
    el.eval(t, X, 0, 0, k1);
    for (let i = 0; i < N; i++) Xt[i] = X[i] + 0.5 * dt * k1[i];
    el.eval(t + 0.5 * dt, Xt, 0, 0, k2);
    for (let i = 0; i < N; i++) Xt[i] = X[i] + 0.5 * dt * k2[i];
    el.eval(t + 0.5 * dt, Xt, 0, 0, k3);
    for (let i = 0; i < N; i++) Xt[i] = X[i] + dt * k3[i];
    el.eval(t + dt, Xt, 0, 0, k4, true);
    for (let i = 0; i < N; i++) X[i] += (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  }

  return {
    names,
    get port() { return ext.params; },
    get log() { return log.map(({ name, unit }) => ({ name, unit })); },
    get period() { return period; },
    ramp: () => (ramp && started ? ramp.state() : null),
    step(t, y) {
      const missing = [];
      for (let j = 0; j < ext.y.length; j++) {
        if (Number.isFinite(y[j])) ext.y[j] = y[j];
        else missing.push(ext.params.outputs[j]);
      }
      if (!started) {
        el.eval(t, X, 0, 0, null);
        makeRamp();
        ramp.start(t, present(y));
        started = true;
      } else {
        ramp.advance(t);
        if (tPrev !== null && t > tPrev) {
          const m = Math.max(1, Math.round((t - tPrev) / h));
          const dt = (t - tPrev) / m;
          for (let s = 0; s < m; s++) {
            const ts = tPrev + s * dt;
            if (el.n) rk4(ts, dt);
            if (s < m - 1) { el.eval(ts + dt, X, 0, 0, null); el.recordLeft(); el.sample(ts + dt, X, 0, 0); el.record(); }
          }
        }
      }
      el.eval(t, X, 0, 0, null);
      if (tPrev !== null) el.recordLeft();
      el.sample(t, X, 0, 0);
      el.record();
      tPrev = t;
      const p = ext.params;
      const all = el.probes();
      const values = keep.map((i) => all[i][1]);
      const logged = log.map((l) => (Array.isArray(l.probe) ? probe(all, l.probe[0]) - probe(all, l.probe[1]) : probe(all, l.probe)));
      const u = ext.u().map((v, i) => (Number.isFinite(v) ? Math.min(p.max[i], Math.max(p.min[i], v)) : p.safe[i]));
      return { u, values, log: logged, ramp: ramp.state(), missing };
    },
    update(d, nextSigs) {
      if (nextSigs) setSignals(nextSigs);
      if (!d) return 'signals';
      const next = normalizeDiagram(structuredClone(d));
      if (structureKey(next) === key) { copyParams(own, next); return 'kept'; }
      build(next);
      return 'rebuilt';
    },
    restart() { build(own); },
  };
}

function liveScales(diagram) {
  if (!diagram) return { scales: {}, refs: [] };
  let el;
  try { el = compileDiagram(normalizeDiagram(structuredClone(diagram)), 'plant', { standalone: true, sources: new Proxy({}, { get: () => () => 0 }) }); } catch { return { scales: {}, refs: [] }; }
  if (el.externals.length !== 1) return { scales: {}, refs: [] };
  const links = el.links();
  return { scales: fullScales(el.externals[0].params, links), refs: Object.keys(links.sources) };
}

function keptWires(wires, id, was, now) {
  const sig = (p, i) => `${p.inputs[i]}:${p.kinds?.[i] || 'effort'}`;
  const changed = (i) => i >= now.inputs.length || i >= was.inputs.length || sig(was, i) !== sig(now, i);
  return wires.filter((w) => { const f = parseEnd(w.from), t = parseEnd(w.to); return !(t.id === id && changed(t.port)) && !(f.id === id && f.port >= now.outputs.length); });
}

const SIGNAL_NAME = /^[A-Za-z][A-Za-z0-9_]{0,11}$/;
function followPorts(level, id, was, now) {
  const ext = level.blocks.find((b) => b.id === id);
  const fromPort = (w) => { const f = parseEnd(w.from); return f.id === id ? f.port : -1; };
  const fed = (b) => level.wires.filter((w) => parseEnd(w.to).id === b.id);
  const renamed = {};
  const gone = new Set(level.blocks.filter((b) => b.type === 'sink' && fed(b).length && fed(b).every((w) => fromPort(w) >= now.outputs.length && b.params.name === was.outputs[fromPort(w)])).map((b) => b.id));
  for (const b of level.blocks) if (gone.has(b.id)) renamed[b.params.name] = null;
  const blocks = level.blocks.filter((b) => !gone.has(b.id)).map((b) => structuredClone(b));
  const wires = keptWires(level.wires, id, was, now).filter((w) => !gone.has(parseEnd(w.to).id));
  const taken = new Set(diagramNames({ blocks, wires }).sinks.concat(diagramNames({ blocks, wires }).sources));
  now.outputs.forEach((name, j) => {
    const unit = now.outUnits?.[j] ?? '1';
    const sinks = blocks.filter((b) => b.type === 'sink' && wires.some((w) => parseEnd(w.to).id === b.id && fromPort(w) === j));
    for (const b of sinks) {
      if (b.params.name !== was.outputs[j]) continue;  
      if (name !== b.params.name && SIGNAL_NAME.test(name) && !taken.has(name)) { taken.delete(b.params.name); renamed[b.params.name] = name; b.params.name = name; taken.add(name); }
      b.params.unit = unit;
    }
    if (sinks.length || !SIGNAL_NAME.test(name) || taken.has(name)) return;
    let sid = name;
    for (let k = 2; blocks.some((b) => b.id === sid); k++) sid = `${name}_${k}`;
    blocks.push({ id: sid, type: 'sink', params: { name, unit }, x: (ext?.x ?? 0) + 260, y: (ext?.y ?? 0) + 36 * j });
    wires.push({ from: j ? `${id}:${j}` : id, to: sid });
    taken.add(name);
  });
  return { blocks, wires, renamed };
}

function liveProblem(diagram) {
  let el;
  try { el = compileDiagram(normalizeDiagram(structuredClone(diagram)), 'plant', { standalone: true, sources: new Proxy({}, { get: () => () => 0 }) }); } catch (err) { return err.message; }
  if (el.externals.length !== 1) return null;
  return controllerOnReference(el.externals[0].params, el.links());
}

function liveKey(key, { link, latched = false, display = 'stop' } = {}) {
  const running = link === 'running';
  const out = (d, restart, plant, why = null) => ({ display: d, restart, plant, why });
  if (key === 'stop' || key === 'swept') return out('stop', false, running ? 'stop' : null);
  if (latched) return out('stop', false, running ? 'stop' : null, 'E-STOP is latched: Reset first, then Run.');
  if (!running && link !== 'open') return out('stop', false, null, link === 'connecting' ? 'Still connecting to the plant.' : 'Offline: connect the plant first (Plant tab, Connect); Run then starts it.');
  if (key === 'single') return running ? out('single', false, null) : out('single', true, 'start');
  return running ? out('run', display === 'stop', null) : out('run', true, 'start');
}

function createLiveLoop(post, env = globalThis) {
  const now = () => env.performance.now();
  let ws = null, desc = null, runner = null, program = null;
  let running = false, latched = null, lastY = 0, watchdog = 0, armed = false;
  let stats = null, plantStatus = null, lastStats = 0;
  const empty = () => ({ t: [], rt: [], values: [] });
  let batch = empty(), lastFlush = 0, names = [], lastRamp = null;
  let appliedOn = false, appliedUnits = {};
  let id = 0, gen = 0, bad = 0;
  const calls = new Map();
  const programWaiters = [], closeWaiters = [];

  const say = (state, detail = '') => post({ type: 'state', state, detail });
  const fail = (message) => post({ type: 'error', message });
  const open = () => ws?.readyState === 1;
  function call(method, params) {
    return new Promise((resolve, reject) => {
      if (!open()) { reject(new Error('not connected')); return; }
      const i = ++id;
      calls.set(i, { resolve, reject });
      ws.send(rpcRequest(i, method, params));
    });
  }

  function flush() {
    if (!batch.t.length) return;
    post({ type: 'samples', names, units: appliedUnits, ...batch, ramp: lastRamp });
    batch = empty();
  }
  function halt() { running = false; stopWatchdog(); flush(); }
  function latch(by, reason) {
    if (latched) return;
    latched = { by, reason };
    halt();
    post({ type: 'estop', by, reason });
    if (open()) say('open', 'e-stop');
  }
  function trip(reason, toPlant) {
    latch('page', reason);
    call('estop', { reason: toPlant }).catch(() => {});
  }
  function stopWatchdog() { if (watchdog) env.clearInterval(watchdog); watchdog = 0; }
  function startWatchdog() {
    stopWatchdog();
    lastY = now();
    const armAt = lastY + 1000;
    armed = false;
    const cycles = desc?.watchdog ?? WATCHDOG_CYCLES;
    watchdog = env.setInterval(() => {
      if (!running || latched) return;
      if (!armed) { if (now() < armAt) return; armed = true; }
      const w = pageWatchdog({ now: now(), lastY, rateHz: desc.rate_hz, cycles });
      if (w.trip) trip(`plant silent for ${w.silent} cycles`, 'the page heard no y');
    }, Math.max(5, 1000 / desc.rate_hz));
  }

  function sampleNames() {
    const p = runner.port;
    appliedUnits = appliedOn ? Object.fromEntries(p.inputs.map((n, i) => [`applied.${n}`, p.inUnits[i]])) : {};
    names = [...runner.names(), ...Object.keys(appliedUnits)];
  }
  function makeRunner() {
    if (!program) throw new Error('nothing to run yet');
    runner = createLiveRunner(program.diagram, program.signals);
    appliedOn = false;
    sampleNames();
  }
  function begin(by) {
    makeRunner();
    post({ type: 'run', by });  
    stats = createLinkStats(desc.rate_hz);
    lastStats = now();
    bad = 0;
    running = true;
    startWatchdog();
  }

  function onY(m) {
    const at = now();
    lastY = at;
    armed = true;
    if (!runner || !running) return;
    let res;
    try { res = runner.step(m.t, m.y); } catch (err) { trip(`the diagram failed: ${err.message}`, 'the page\'s diagram failed'); return; }
    if (res.missing.length) {
      if (++bad >= NAN_CYCLES) { trip(`no number for ${res.missing.join(', ')} in ${bad} cycles`, `the page got no number for ${res.missing.join(', ')}`); return; }
    } else bad = 0;
    if (!latched && open()) ws.send(uMessage(m.seq, res.u, res.log));
    stats?.add(at, m.seq, now() - at);
    const n = runner.port.inputs.length;
    if (!appliedOn && m.applied?.length === n && n) { flush(); appliedOn = true; sampleNames(); }
    batch.t.push(m.t);
    batch.rt.push(res.ramp?.runT ?? NaN);
    batch.values.push(appliedOn ? [...res.values, ...Array.from({ length: n }, (_, i) => (m.applied?.length === n ? m.applied[i] : NaN))] : res.values);
    lastRamp = res.ramp && res.ramp.phase === 'ramp' ? { left: res.ramp.left, to: res.ramp.to, first: res.ramp.first } : null;
    if (at - lastFlush >= 33) { lastFlush = at; flush(); }
    if (stats && at - lastStats >= 500) { lastStats = at; post({ type: 'stats', link: stats.read(), plant: plantStatus }); }
  }

  function onText(text) {
    const m = parseMessage(text);
    if (m.kind === 'y') onY(m);
    else if (m.kind === 'result' || m.kind === 'error') {
      const c = calls.get(m.id);
      calls.delete(m.id);
      if (m.kind === 'result') c?.resolve(m.result); else c?.reject(new Error(m.error));
    } else if (m.kind === 'estop') latch('plant', m.reason);
    else if (m.kind === 'running') {
      if (m.by === 'page') return;
      if (!m.running && running) { gen++; halt(); post({ type: 'stopped', by: m.by, reason: m.reason }); say('open', 'stopped at the plant'); }
      else if (m.running && !running && !latched && desc && program) { gen++; try { begin('plant'); say('running', desc.name); } catch (err) { fail(err.message); } }
    } else if (m.kind === 'status') {
      plantStatus = m.status;
      if (latched?.by === 'plant' && m.status?.estop === null && !running) { latched = null; post({ type: 'cleared', by: 'plant' }); say('open', 'reset'); }
    }
    else fail(`the plant sent something unexpected: ${m.error}`);
  }

  async function start() {
    const my = ++gen;
    if (!desc) throw new Error('not connected');
    if (latched) throw new Error(`E-STOP is latched (${latched.reason}): Reset first`);
    if (!program) await new Promise((r) => { programWaiters.push(r); env.setTimeout(r, 1000); });
    if (my !== gen || latched) return;
    try {
      if (running) { halt(); await call('stop'); if (my !== gen || latched) return; }
      begin('page');
      await call('start', startParams(runner.log));
    } catch (err) {
      halt();
      if (my === gen && open() && !latched) say('open', 'stopped');
      throw err;
    }
    if (my !== gen || !running || latched) return;
    if (!armed) { armed = true; lastY = now(); }
    say('running', desc.name);
  }

  const handlers = {
    connect({ url }) {
      if (ws) return;
      say('connecting', url);
      try { ws = new env.WebSocket(url); } catch (err) { ws = null; say('closed', `cannot open ${url}: ${err.message}`); return; }
      let opened = false;
      ws.onopen = async () => {
        opened = true;
        try {
          desc = checkDescription(await call('describe'));
          latched = desc.estop ? { by: 'plant', reason: desc.estop } : null;
          if (desc.protocol !== HIL_PROTOCOL) fail(`the plant speaks ${desc.protocol || 'an unnamed protocol'}, this page ${HIL_PROTOCOL}: it may not work`);
          post({ type: 'described', desc });
          if (latched) post({ type: 'estop', by: 'plant', reason: desc.estop });
          if (desc.running && !latched) await call('stop').catch(() => {});
          if (open()) say('open', url);
        } catch (err) { fail(`describe: ${err.message}`); ws?.close(); }
      };
      ws.onmessage = (e) => onText(e.data);
      ws.onclose = (e) => {
        const wasRunning = running;
        halt(); ws = null; desc = null; gen++;
        for (const c of calls.values()) c.reject(new Error('connection closed'));
        calls.clear();
        if (wasRunning && !latched) latch('page', 'connection lost');
        say('closed', e.reason || (opened ? 'the connection was lost' : e.code === 1006 ? 'no plant answered at that address (or this page may not open connections)' : `code ${e.code}`));
        for (const w of closeWaiters.splice(0)) w();
      };
      ws.onerror = () => {};  
    },
    program(p) {
      program = p;
      for (const w of programWaiters.splice(0)) w();
      if (!runner) return;
      try {
        const how = runner.update(p.diagram, p.signals);
        if (how === 'rebuilt') { flush(); sampleNames(); }
        post({ type: 'programmed', how });
      } catch (err) { if (running) trip(err.message, 'the page\'s diagram failed'); }
    },
    async start() {
      try { await start(); return {}; } catch (err) { fail(err.message); post({ type: 'refused', message: err.message }); return { error: err.message }; }
    },
    async stop() {
      const my = ++gen;
      halt();
      try { await call('stop'); } catch {   }
      if (my !== gen) return {};
      halt();
      if (open()) say('open', latched ? 'e-stop' : 'stopped');
      return {};
    },
    async estop() {
      gen++;
      latch('page', 'pressed on this page');
      try { await call('estop', { reason: 'E-STOP pressed on the page' }); } catch {   }
      return {};
    },
    async reset() {
      try {
        await call('reset');
        latched = null;
        say('open', 'reset');
        return {};
      } catch (err) { fail(`reset: ${err.message}`); return { error: err.message }; }
    },
    async disconnect() {
      if (!ws) return {};
      halt();
      gen++;
      await Promise.race([call('stop').catch(() => {}), new Promise((r) => env.setTimeout(r, 300))]);
      if (!ws) return {};
      const closed = new Promise((r) => { closeWaiters.push(r); env.setTimeout(r, 1000); });
      ws.close(1000, 'disconnected by the page');
      await closed;
      return {};
    },
  };
  return {
    handle(msg) {
      const f = handlers[msg.type];
      if (!f) return;
      const res = f(msg);
      if (msg.id !== undefined) Promise.resolve(res).then((r) => post({ type: 'done', id: msg.id, ...(r ?? {}) }));
    },
    protocol: HIL_PROTOCOL,
  };
}

function liveWorker(scope) {
  const loop = createLiveLoop((msg) => scope.postMessage(msg), scope);
  scope.onmessage = (e) => loop.handle(e.data);
  scope.postMessage({ type: 'ready' });
}

return { NAN_CYCLES, createLiveRunner, liveScales, keptWires, followPorts, liveProblem, liveKey, createLiveLoop, liveWorker };
})();
// ---- core/trace.js
__mods['core/trace.js'] = (() => {

const TRACE_FORMAT = 'loop-tuner-trace/1';
const MAX_RECORD_VALUES = 2 ** 24;

const sweepStart = (t, w0, W) => w0 + W * Math.floor((t - w0) / W + 1e-9);

function refShift(t0, t1, w0, W, step = 0) {
  const base = t1 >= w0 && t0 < w0 + W ? 0 : w0 - sweepStart(t0, w0, W);
  return base - step * W;
}
function refSteps(t0, t1, w0, W) {
  const base = refShift(t0, t1, w0, W);
  return { min: Math.floor((t0 + base - w0 - W) / W + 1e-9) + 1, max: Math.max(0, Math.ceil((t1 + base - w0) / W - 1e-9) - 1) };
}

function createRecorder(seconds = 300, maxValues = MAX_RECORD_VALUES) {
  let names = [], units = {}, cap = 0, n = 0, head = 0, t = new Float64Array(0), cols = [];
  let lastIn = null, map = [];
  const limit = () => Math.floor(maxValues / (names.length + 1));
  const oldest = () => (head - n + cap) % cap;
  function relayout(c) {
    const keep = Math.min(n, c), from = (head - keep + cap) % (cap || 1);
    const move = (src) => { const dst = new Float64Array(c).fill(NaN); for (let i = 0; i < keep; i++) dst[i] = src[(from + i) % cap]; return dst; };
    t = move(t); cols = cols.map(move);
    cap = c; n = keep; head = keep % c;
  }
  function column(name) {
    let j = names.indexOf(name);
    if (j >= 0) return j;
    names.push(name);
    cols.push(new Float64Array(cap).fill(NaN));
    if (cap > limit()) relayout(limit());
    j = names.length - 1;
    return j;
  }
  function evict(now) { while (n && t[oldest()] < now - seconds - 1e-9) n--; }
  const self = {
    get seconds() { return seconds; },
    get names() { return names; },
    get length() { return n; },
    span() { return n > 1 ? t[(head - 1 + cap) % cap] - t[oldest()] : 0; },
    last() { return n ? t[(head - 1 + cap) % cap] : null; },
    longest() {
      const s = self.span();
      return n > 1 && s > 0 ? (limit() * s) / (n - 1) : Infinity;
    },
    setUnits(u) { Object.assign(units, u); },
    setLength(s) { seconds = s; const now = self.last(); if (now !== null) evict(now); },
    clear() { names = []; units = {}; cap = 0; n = 0; head = 0; t = new Float64Array(0); cols = []; lastIn = null; map = []; },
    push(time, nms, values) {
      if (nms !== lastIn) { map = nms.map(column); lastIn = nms; }
      evict(time);
      if (n === cap) {
        if (cap < limit()) relayout(Math.min(limit(), Math.max(1024, 2 * cap)));
        else n--;  
      }
      t[head] = time;
      for (let j = 0; j < cols.length; j++) cols[j][head] = NaN;
      for (let i = 0; i < map.length; i++) cols[map[i]][head] = values[i];
      head = (head + 1) % cap;
      n++;
    },
    snapshot() {
      const out = { t: new Float64Array(n), signals: {}, units: Object.fromEntries(names.map((nm) => [nm, units[nm] ?? '1'])) };
      const from = oldest();
      const copy = (src, dst) => { for (let i = 0; i < n; i++) dst[i] = src[(from + i) % cap]; };
      if (n) copy(t, out.t);
      names.forEach((nm, j) => { out.signals[nm] = new Float64Array(n); if (n) copy(cols[j], out.signals[nm]); });
      return out;
    },
  };
  return self;
}

function traceWindow(trace, a, b) {
  let i0 = 0, i1 = trace.t.length;
  while (i0 < i1 && trace.t[i0] < a - 1e-9) i0++;
  while (i1 > i0 && trace.t[i1 - 1] > b + 1e-9) i1--;
  return { t: trace.t.slice(i0, i1), signals: Object.fromEntries(Object.entries(trace.signals).map(([nm, v]) => [nm, v.slice(i0, i1)])), units: { ...trace.units } };
}

const cell = (v) => (Number.isFinite(v) ? String(Number(v.toPrecision(9))) : '');
const ROWS = 20000;  

function traceToCsvParts(trace, { title = '', source = '' } = {}) {
  const names = Object.keys(trace.signals);
  const unit = (nm) => trace.units?.[nm] ?? '1';
  const head = `# ${TRACE_FORMAT}${title ? ` · ${title}` : ''}${source ? ` · ${source}` : ''} · ${trace.t.length} samples\n${['t [s]', ...names.map((nm) => `${nm} [${unit(nm)}]`)].join(',')}\n`;
  const parts = [head], cs = names.map((nm) => trace.signals[nm]);
  for (let a = 0; a < trace.t.length; a += ROWS) {
    const lines = [];
    for (let i = a; i < Math.min(trace.t.length, a + ROWS); i++) lines.push(`${cell(trace.t[i])}${cs.map((v) => `,${cell(v[i])}`).join('')}`);
    parts.push(`${lines.join('\n')}\n`);
  }
  return parts;
}
const traceToCsv = (trace, meta) => traceToCsvParts(trace, meta).join('');

function traceToJsonParts(trace, { title = '', source = '' } = {}) {
  const arr = (a) => {
    const out = [];
    for (let i = 0; i < a.length; i += ROWS) out.push(Array.from(a.subarray ? a.subarray(i, i + ROWS) : a.slice(i, i + ROWS), (v) => (Number.isFinite(v) ? Number(v.toPrecision(9)) : 'null')).join(','));
    return `[${out.join(',')}]`;
  };
  const parts = [`{"format":${JSON.stringify(TRACE_FORMAT)},"title":${JSON.stringify(title)},"source":${JSON.stringify(source)},"units":${JSON.stringify({ t: 's', ...trace.units })},"t":${arr(trace.t)},"signals":{`];
  Object.entries(trace.signals).forEach(([nm, v], i) => parts.push(`${i ? ',' : ''}${JSON.stringify(nm)}:${arr(v)}`));
  parts.push('}}');
  return parts;
}
const traceToJson = (trace, meta) => traceToJsonParts(trace, meta).join('');

function parseTrace(text) {
  const s = String(text).replace(/^\uFEFF/, '');
  if (/^\s*\{/.test(s)) {
    const j = JSON.parse(s);
    if (!Array.isArray(j.t) || !j.signals || typeof j.signals !== 'object') throw new Error('a trace needs "t" and "signals"');
    const num = (a) => Float64Array.from(a, (v) => (v === null || v === '' ? NaN : Number(v)));
    const signals = {};
    for (const [nm, v] of Object.entries(j.signals)) {
      if (!Array.isArray(v) || v.length !== j.t.length) throw new Error(`signal ${nm}: one value per time`);
      signals[nm] = num(v);
    }
    const units = { ...(j.units ?? {}) };
    delete units.t;
    return { title: String(j.title ?? ''), t: num(j.t), signals, units };
  }
  const lines = s.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  if (lines.length < 2) throw new Error('a CSV trace needs a header and at least one row');
  const head = lines[0].split(/[,;\t]/).map((h) => h.trim().replace(/^"|"$/g, ''));
  const cols = head.map((h) => /^(.*?)\s*(?:\[(.*)\])?$/.exec(h));
  const t = new Float64Array(lines.length - 1);
  const values = cols.slice(1).map(() => new Float64Array(lines.length - 1));
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(/[,;\t]/);
    t[i - 1] = f[0] === '' ? NaN : Number(f[0]);
    for (let j = 1; j < cols.length; j++) values[j - 1][i - 1] = f[j] === undefined || f[j].trim() === '' ? NaN : Number(f[j]);
  }
  if (!t.every(Number.isFinite)) throw new Error('the first column must be the time, in seconds');
  const signals = {}, units = {};
  cols.slice(1).forEach((c, j) => { const nm = c[1] || `col${j + 2}`; signals[nm] = values[j]; units[nm] = c[2] || '1'; });
  return { title: '', t, signals, units };
}

return { TRACE_FORMAT, MAX_RECORD_VALUES, sweepStart, refShift, refSteps, createRecorder, traceWindow, traceToCsvParts, traceToCsv, traceToJsonParts, traceToJson, parseTrace };
})();
// ---- core/zip.js
__mods['core/zip.js'] = (() => {

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipFiles(files, date = new Date()) {
  const enc = new TextEncoder();
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const common = (v) => { v.setUint16(0, 20, true); v.setUint16(2, 0x0800, true); v.setUint16(4, 0, true); v.setUint16(6, time, true); v.setUint16(8, day, true); v.setUint32(10, crc, true); v.setUint32(14, data.length, true); v.setUint32(18, data.length, true); v.setUint16(22, name.length, true); };
    const local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    common(new DataView(local.buffer, 4));
    local.set(name, 30);
    const head = new Uint8Array(46 + name.length), cv = new DataView(head.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, (3 << 8) | 20, true);  
    common(new DataView(head.buffer, 6));
    cv.setUint32(38, (((f.mode ?? 0o644) | 0o100000) << 16) >>> 0, true);
    cv.setUint32(42, offset, true);
    head.set(name, 46);
    parts.push(local, data);
    central.push(head);
    offset += local.length + data.length;
  }
  const size = central.reduce((s, h) => s + h.length, 0);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, size, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22);
  let at = 0;
  for (const p of [...parts, ...central, end]) { out.set(p, at); at += p.length; }
  return out;
}

return { crc32, zipFiles };
})();
// ---- core/guide.js
__mods['core/guide.js'] = (() => {

const M = (name, args, does, example, returns = '') => ({ name, args, does, example, ...(returns ? { returns } : {}) });

const AGENT_NOTE = 'Loop Tuner: an oscilloscope for control loops in one page. For agents: window.loopTuner.help() returns a guide to this page and its API (also in Help, For agents).';

const GUIDE = {
  title: 'Loop Tuner: a guide for agents',
  about: 'Loop Tuner is an oscilloscope for control loops in one HTML page. The display shows the signals; the tabs below set the loop up: Input (signals), Plant (a block diagram), Controller, Auto-tune, Analysis. Everything a person does here an agent can do through window.loopTuner, in plain JSON, and read back from the page: every Live control has a stable id, an accessible name and its state in data-* attributes.',
  start: [
    'Read loopTuner.help() (this guide) and loopTuner.api (every method in one line).',
    'loopTuner.systems() lists the System library; loopTuner.loadSystem(name) loads one whole.',
    'loopTuner.getProject() returns the project (JSON); change it and give it back with setProject(p), or change one controller with setGains(block, params) and pick its variant with setVariant(block, name).',
    'loopTuner.run(), stop(), single() are the scope keys; each returns { ok, why }, why saying why a key was refused. loopTuner.record.screen("csv") reads every signal on the screen.',
    'The last message the page showed stays in #toast[data-last] and loopTuner.live.state().message (a toast is gone after 3 s).',
  ],
  api: [
    M('loopTuner.help(format?)', 'format: "text" for plain text', 'This guide: an object, or text.', 'loopTuner.help("text")'),
    M('loopTuner.api', '', 'Every method: [{ name, does }].', 'loopTuner.api.map((m) => m.name)'),
    M('loopTuner.systems()', '', 'The System library: [{ name, tags, notes }].', 'loopTuner.systems().map((s) => s.name)'),
    M('loopTuner.loadSystem(name, parts?)', 'name: a library name; parts: ["input", "plant", "controller"] (default all)', 'Loads a system, as the System library\'s Load does (one undo step).', 'loopTuner.loadSystem("HIL: an external plant")'),
    M('loopTuner.getProject()', '', 'The project, as the file stores it.', 'const p = loopTuner.getProject()'),
    M('loopTuner.setProject(p)', 'p: a project', 'Loads a project; returns it normalised.', 'loopTuner.setProject(p)'),
    M('loopTuner.setGains(block, params)', 'block: a Controller block\'s id path ("ctrl", "motor/ctrl"); params: { Kp: 3, ... }', 'Changes the running variant\'s parameters (one undo step). While live, they act at the next sample and the controller keeps its state. A name the variant does not have throws, listing the names it has.', 'loopTuner.setGains("ctrl", { Kp: 8, Kd: 0.5 })', 'the variant: { name, type, params }'),
    M('loopTuner.setVariant(block, name)', 'block: a Controller block\'s id path; name: a variant\'s name (or its index)', 'Picks the variant that runs (one undo step), as the Controller tab does. While live, the new variant starts afresh at the next cycle. An unknown name throws, listing the variants.', 'loopTuner.setVariant("ctrl", "PD")', 'the variant: { name, type, params }'),
    M('loopTuner.addComponent(c)', 'c: { type, params }', 'Adds a waveform component to the signal the Input tab edits.', 'loopTuner.addComponent({ type: "step", params: { amplitude: 1, time: 0.5 } })'),
    M('loopTuner.reference()', '', 'The reference r over the screen: { t, r }.', 'loopTuner.reference().r.length'),
    M('loopTuner.autoScale()', '', 'Auto Scale: one period across the screen, every channel fitted (with a live plant, offline: its full scales).', 'loopTuner.autoScale()'),
    M('loopTuner.run()', '', 'Run. With an External plant: starts the plant (connected first), the references ramp in, then the loop runs. The plant answers a moment later: live.state().pending is "run" until then, then state is "running".', 'loopTuner.run()', '{ ok, why, run, live }: why says why it was refused; run is the scope\'s mode; live is live.state() (null without an External plant)'),
    M('loopTuner.stop()', '', 'Stop. With an External plant: stops it (safe inputs, not latched); always sent to a connected plant.', 'loopTuner.stop()', '{ ok, why, run, live }'),
    M('loopTuner.single()', '', 'Single: one sweep, then stop. Pressed while running, the sweep under way finishes, then it stops (live: then the plant stops).', 'loopTuner.single()', '{ ok, why, run, live }'),
    M('loopTuner.speed(x?)', 'x: a factor, or -1 for as fast as possible', 'How fast simulated time runs; held at 1 while a plant is connected.', 'loopTuner.speed(10)', '{ speed, effective, achieved, simulation, locked }'),
    M('loopTuner.selectCandidate(name)', 'name: a candidate', 'Older projects with candidates: runs one.', 'loopTuner.selectCandidate("PID")'),
    M('loopTuner.autotune(opts)', 'opts: { block, method: "iterate" | "relay" | "step", goal, rule, simc, apply }', 'Auto-tunes a Controller block by simulation; refused for an External plant: the page knows only its interface and needs an identified model first (Identify, to come).', 'loopTuner.autotune({ method: "step" })', 'a report: { ok, why, before, after, ... }'),
    M('loopTuner.designs()', '', 'What each running variant computed from the plant (LQR, PI from the plant, a PID\'s feedforward, the swing-ups, a Kalman filter) holds: its status (ok, warn, pending, error), the computed rows, warnings, and why a design was refused (error: { code, message, hint }; the block then puts out u = 0).', 'loopTuner.designs()', '[{ status, values, rows, warnings, error, ... }]'),
    M('loopTuner.info()', '', 'What the screen\'s last run reported: validity reports (a model used outside where it holds), warnings (a stiff plant and the step it needs, a run made again because the plant grew stiffer, a signal that diverged, an input not connected), the integration step h, steps, the step bound (the blocks\' own and the Jacobian\'s largest eigenvalue at the start), the Jacobian\'s at the start and the end, and the run\'s ms. The status line under the screen shows the first report or warning.', 'loopTuner.info()', '{ validity, warnings, h, substeps, steps, bound, stiffness: { start, end }, ms } or null'),
    M('loopTuner.whenDesigned()', '', 'Resolves once no design is being computed in the background (a plan for the planned swing-up takes seconds; meanwhile the block runs u = 0 or its previous plan) and the display shows the run that uses it. Await it before judging a run.', 'await loopTuner.whenDesigned()', 'a promise of designs()'),
    M('loopTuner.loopModel(path, op)', 'path: a Controller block\'s id path; op: "origin" (at rest), "initial" (the start), { y: [levels] } or { t: seconds }', 'The loop the Controller closes, as the Analysis tab draws it: the plant it sees linearised at op, and the running variant\'s own law, as state space. Refused, with the reason, where there is none (a relay, a kink at op, a plant outside the page).', 'loopTuner.loopModel("ctrl", "initial")', '{ plant: { A, B, C, D, delay, ... }, ctrl: { A, B, C, D }, Ts, opLabel, variantName, warnings }'),
    M('loopTuner.live.state()', '', 'The live link: state ("offline", "connecting", "open", "running"), pending ("run" or "stop" while the plant has not answered a key yet), message (the last message the page showed), estop ({ by, reason } or null), mode ("control", "reference", "log"), the plant\'s ports, ramp ({ left, to } while the references ramp in), link and plant figures, hold.', 'loopTuner.live.state().state'),
    M('loopTuner.live.connect(url?)', 'url: default the block\'s, ws://127.0.0.1:8765', 'Opens the link and reads the plant\'s description; resolves once the plant has described itself (or the link failed), so Run can follow at once. Nothing starts: the plant stays stopped until Run.', 'await loopTuner.live.connect()', 'a promise of state()'),
    M('loopTuner.live.disconnect()', '', 'Stops the plant, then closes the link.', 'await loopTuner.live.disconnect()', 'a promise of state() once the link is closed'),
    M('loopTuner.live.estop()', '', 'E-STOP: the plant applies its safe inputs and stays stopped until Reset.', 'await loopTuner.live.estop()', 'a promise of state() once the plant has answered'),
    M('loopTuner.live.reset()', '', 'Clears an E-stop. The plant stays stopped; Run goes on, the controllers afresh. A STOP pressed at the plant is reset at the plant only: the page\'s reset is refused, and state().message says so.', 'await loopTuner.live.reset()', 'a promise of state() once the plant has answered (estop is still set if it refused)'),
    M('loopTuner.live.hold(on?)', 'on: true or false (default: toggle)', 'Freezes the screen while the plant runs on (the live record goes on too). The key H does the same.', 'loopTuner.live.hold(true)'),
    M('loopTuner.live.settings(s?)', 's: { ramp: % of full scale per second, scales: { r: [lo, hi] } }', 'The ramp-in and the full scales of the references (one undo step); returns them.', 'loopTuner.live.settings({ ramp: 20 })'),
    M('loopTuner.live.downloadPlant()', '', 'Saves hil-plant.zip (the plant script, runme.sh, runme.cmd, runme.ps1, README.txt).', 'await loopTuner.live.downloadPlant()', 'a promise: true once the file is on its way'),
    M('loopTuner.live.plantFiles()', '', 'The files of hil-plant.zip as text: { name: text }.', 'loopTuner.live.plantFiles()["README.txt"]'),
    M('loopTuner.record.state()', '', 'The live record (seconds kept, signals) and the references shown.', 'loopTuner.record.state()'),
    M('loopTuner.record.screen(format?)', 'format: "csv" (default) or "json"', 'Every signal on the screen (not only those on channels), as text.', 'loopTuner.record.screen("csv")'),
    M('loopTuner.record.live(format?)', 'format: "csv" or "json"', 'The live record: the last minutes of every live signal, across runs.', 'loopTuner.record.live("csv")'),
    M('loopTuner.record.save(what?, format?)', 'what: "screen" or "record"; format: "csv", "json" or "png" (screen only)', 'Saves a file through the page (a download). Anything else is refused with an error.', 'await loopTuner.record.save("screen", "csv")', 'a promise: true once the file is on its way'),
    M('loopTuner.record.screenshot()', '', 'A picture of the screen with its status line and channel badges, at the device pixel ratio.', 'await loopTuner.record.screenshot()', 'a promise of a data: URL (PNG)'),
    M('loopTuner.record.reference(text, name?)', 'text: a saved CSV or JSON trace', 'Shows a saved trace dashed on the channels with the same names.', 'loopTuner.record.reference(csv, "before")'),
    M('loopTuner.record.clearReferences()', '', 'Removes the references.', 'loopTuner.record.clearReferences()'),
  ],
  dom: [
    '#lt-shell carries data-run (run, stop, single), data-live (none, offline, connecting, open, running, estop) and data-hil-mode (control, reference, log) when the system has an External plant.',
    'Header: #estop, the E-STOP key (data-state: armed, latched, off); #syslib, the System library; #speed-in, the speed; #help, the Help (?) key, which has this guide under For agents.',
    '#toast shows a message for 3 s; its data-last keeps the last one.',
    'Run Control: #k-run (Run/Stop), #k-single, #k-auto. The scope\'s status line (#display .status) has data-run, data-live and data-ramp, and says LIVE, CONNECTED, E-STOP and its reason, OFFLINE, HOLD or "ramping to r0: 2.1 s left".',
    'Plant tab, right-hand panel, #live (data-state, data-mode): #live-download (Download the plant (zip)), #live-connect (Connect / Disconnect), #live-reset, #live-hold, #live-url (where the plant listens), #live-status (data-state; while running data-rate, data-rtt, data-missed, data-late; after an E-stop data-reason), #live-mode (what the page sends), #live-ramp and #live-scale-NAME (Live settings).',
    'Plant tab, a HIL system: Interface (#pl-rep-iface) shows #pl-iface, the plant\'s interface as a readout panel, a row per port (li with data-side in or out, data-port, data-kind): unit, full scale, hard range (outputs) or safe value (inputs). It is all the page knows of the plant; live.state() has the same.',
    'Save ▾ under the screen: #rc-save.',
  ],
  live: {
    what: 'A system with an External plant block runs against a plant outside the page, in real time. HIL: an external plant is made for it: the controller against one External plant block, a black box. The page knows only the interface the plant describes when it connects (its inputs and outputs: names, units, full scales, hard ranges, kinds; the Plant tab shows it under Interface, and live.state() has it); the External block takes those ports, and the Sinks and channels follow the outputs. Tuning needs the plant identified first (Identify, to come): Auto-tune and Analysis say so. The downloadable example plant happens to simulate a DC motor swinging an arm, standing in for real hardware; the page is not told. Replace it with your device behind the same protocol, in any language.',
    setup: [
      'Load the system: loopTuner.loadSystem("HIL: an external plant") (or "HIL: an external plant, reference mode"). It opens stopped and OFFLINE: nothing runs until the plant is connected and Run is pressed.',
      'Get the plant: loopTuner.live.downloadPlant() saves hil-plant.zip (Plant tab: Download the plant (zip)). loopTuner.live.plantFiles() has its files as text.',
      'Start it on the computer the browser runs on: unzip, then sh runme.sh (Linux, macOS) or double-click runme.cmd (Windows; it runs runme.ps1). They install uv if it is missing, which brings its own Python (with the window\'s toolkit) and the websockets package, then start the plant. With uv: uv run hil_plant.py. For the reference mode system: sh runme.sh --mode reference. A window opens with a red STOP, Run/Stop, where it listens and the link\'s state; without a display the console takes s (stop), r (run), e (E-stop), x (reset). An agent with only a browser asks someone at that computer to run it, and for the address it listens on if it is not ws://127.0.0.1:8765.',
      'Connect: await loopTuner.live.connect(). It resolves once the plant has described itself: state() is then "open", the link is up, the plant is stopped and applies its safe inputs.',
      'Run: loopTuner.run() returns { ok, why }. The references first ramp from where the plant is to their first value at no more than 10 % of full scale per second (state().ramp says how long is left), then the loop runs; state() is "running" and its link figures fill in.',
      'Tune while it runs: loopTuner.setGains("ctrl", { Kp: 8 }) (the controller keeps its state) or loopTuner.setVariant("ctrl", "Off") (another variant, afresh). The first guess is not a tuned controller: the page does not know the plant; read loopTuner.record.screen("csv") or record.live("csv").',
      'Stop: loopTuner.stop(). E-STOP: await loopTuner.live.estop() (or the header key, or E), then await live.reset() and Run again. A STOP pressed at the plant shows at once (state().estop.by is "plant", the reason "STOP pressed at the plant") and is reset at the plant only: ask whoever is at the plant to press Reset there (x at its console); the page follows.',
      'Save: await loopTuner.record.save("record", "csv") (the live record) or ("screen", "png"). Disconnect: loopTuner.live.disconnect().',
    ],
    modes: 'The plant declares its inputs in describe, and the page follows. Control mode (inputs are efforts): the page is the controller and sends the control effort u every cycle, with the reference r and the error e for the plant\'s log only. Reference mode (an input is a reference): the plant runs its own controller with its own limits and monitoring; the page sends the references and records what comes back, the plant\'s own u included; the page\'s controllers and Auto-tune are not in the loop. A plant without inputs only reports: the page answers each cycle with an empty u, so its watchdog sees a live page.',
    protocol: 'JSON-RPC 2.0 over a WebSocket, one message per text frame, at ws://127.0.0.1:8765 by default; the plant is the server and owns the clock. Requests from the page, each answered with a result or an error: describe (the plant\'s name, rate_hz, watchdog_cycles, inputs [{ name, unit, min, max, safe, kind, measures }], outputs [{ name, unit, min, max, hard_min, hard_max }], running, estop), start (params { log: [{ name, unit }] }: what each u also carries for the plant\'s log), stop, reset, estop ({ reason }). Every cycle the plant sends y { seq, t, y: [...], applied: [...] } (applied: the inputs it applied at the end of that cycle, after its clamps; the live record keeps them as applied.NAME) and the page answers at once with u { seq, u: [...], log: [...] }. The plant also sends estop { reason, t }, running { running, by, reason } whenever it starts or stops (by "page" when the page asked: the page ignores those), and status once a second (rate, jitter, round trip, late, dropped). Frames go out in the order made: the running a start causes comes before start\'s result. Values are in the units describe gives (null for one that is not a number); min and max are full scales, an output\'s hard_min and hard_max its hard range (beyond it the plant E-stops). hard_min, hard_max and applied are optional: a plant without them works as before. Errors: -32700 not JSON, -32600 not a request, -32601 no such method, -32602 params not an object, -32000 refused (E-stop latched, or a STOP pressed at the plant), -32603 the request failed.',
    safety: 'The plant is the safety authority: it clamps every input to its limits, and if 10 of its cycles go unanswered, the page goes away, an output leaves its hard range (describe\'s hard_min … hard_max) or is not a number, its own cycle fails, or STOP is pressed, it applies its safe inputs and latches an E-stop until reset. Who latched it resets it: a STOP pressed at the plant only at the plant; the page\'s E-STOP only on the page while it is connected; the watchdogs\' and the monitoring\'s on either side. The page stops too: E-STOP, its own watchdog (no y for 10 cycles), and an output that is not a number for 3 cycles (it holds the last number meanwhile). Ctrl+C at the plant ends it cleanly. The plant may also limit how fast its inputs change (--slew).',
    plant: 'The example plant simulates a model of the System library with this page\'s own code (loop-tuner-core.js in the zip): by default a DC motor swinging an unbalanced arm; --model NAME another (--list lists them, with their inputs and outputs), --random one drawn at random. It varies every physical parameter by up to 15 % (--vary 0.15) and switches the model\'s effects (friction, ripple, a resonance) on or off at random (--detail), from one seed (--seed N repeats it; --show-params prints what was drawn at the plant), and never tells the page the model or its physics: the page knows only the inputs and outputs describe lists and has to identify the plant, as it would a real device. It has no disturbance input unless started with --dyno (the model\'s disturbances, ordinary described inputs then), as a rig without a dynamometer has none. --log FILE.csv writes every cycle and event; --bench S measures the link for S seconds; --help lists everything.',
  },
  errors: [
    ['no plant answered at that address', 'The plant is not running, or listens elsewhere (state().detail, #live-url); or the host of this page blocks connections to the computer: save the page (Export HTML or Copy HTML) and open the file in a browser.'],
    ['busy: another page is connected', 'One page at a time: close the other one.'],
    ['origin not allowed', 'The plant refuses pages from web sites; start it with --allow-origin ORIGIN (its console says which).'],
    ['E-STOP is latched', 'Reset first (loopTuner.live.reset()), then Run.'],
    ['Offline: connect the plant first', 'Run with an External plant needs the link: loopTuner.live.connect().'],
    ['plant silent for N cycles', 'The page heard no y for its watchdog: the plant stalled or the link broke; or the computer is too busy (close other work, or start the plant with --watchdog 30).'],
    ['no u for 10 cycles', 'The plant heard no answer: the page was blocked (on the page instead of a worker, or a background tab), or the computer is too busy: close other work, or start the plant with --watchdog 30 (cycles).'],
    ['connection lost', 'The link closed while running; the plant has stopped itself.'],
    ['STOP pressed at the plant', 'Someone pressed STOP in the plant\'s window or console. Only the plant resets it: ask whoever is at the plant to press Reset there (x at its console); the page clears with it. live.reset() is refused.'],
    ['reset: STOP was pressed at the plant', 'The page cannot reset a STOP pressed at the plant: ask whoever is at the plant to press Reset there.'],
    ['is wired to …, which this plant takes as a reference', 'A Controller block\'s output feeds an input the plant takes as a reference (the plant runs in reference mode, the system is made for control mode). Load "HIL: an external plant, reference mode", or start the plant without --mode reference; Run is refused until then.'],
    ['no number for …', 'The plant sent an output that is not a number for 3 cycles: the page latched an E-stop rather than control on a stale value. Check the plant\'s sensor or its code.'],
    ['… is not a number', 'The plant\'s own monitoring: an output it measured is not a number; it latched an E-stop.'],
    ['the plant\'s cycle failed', 'The plant\'s own code failed (its console has the error): it applied its safe inputs and ended. Fix the plant, start it again, Connect.'],
    ['Saving files is not available here', 'This host has no downloads: copy instead (Save ▾ › Copy, Copy image, Copy HTML), or loopTuner.live.plantFiles() for the plant.'],
    ['the plant was shut down', 'Ctrl+C or its window closed.'],
    ['angle 2.6 rad beyond 2.5', 'The plant\'s monitoring: an output left its hard range (describe\'s hard_min … hard_max) and the plant latched an E-stop. Reset (either side), and run gentler, or with a reference inside the range.'],
    ['the plant speaks another protocol', 'Connected anyway; messages may not fit.'],
  ],
};

const apiList = (g = GUIDE) => g.api.map(({ name, does }) => ({ name, does }));

function guideText(g = GUIDE) {
  const out = [g.title, '', g.about, '', 'Start', ...g.start.map((s) => `- ${s}`), '', 'Methods'];
  for (const m of g.api) out.push(`- ${m.name}${m.args ? ` (${m.args})` : ''}: ${m.does}${m.returns ? ` Returns ${m.returns}.` : ''} Example: ${m.example}`);
  out.push('', 'Reading the page without JavaScript', ...g.dom.map((s) => `- ${s}`));
  out.push('', 'Live (HIL)', g.live.what, '', 'Setup, step by step', ...g.live.setup.map((s, i) => `${i + 1}. ${s}`));
  out.push('', `Modes. ${g.live.modes}`, '', `Protocol. ${g.live.protocol}`, '', `Safety. ${g.live.safety}`, '', `The plant. ${g.live.plant}`);
  out.push('', 'What messages mean', ...g.errors.map(([m, means]) => `- "${m}": ${means}`));
  return out.join('\n');
}

return { AGENT_NOTE, GUIDE, apiList, guideText };
})();
globalThis.LoopTunerCore = __mods;
})();
