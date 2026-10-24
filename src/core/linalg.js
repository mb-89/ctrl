// Linear algebra for analysing and designing loops: matrix basics, the matrix
// exponential and zero-order-hold discretisation, eigenvalues of a general
// real matrix, discrete LQR and Kalman gains (Riccati equations), and the
// frequency response, stability margins, root locus and zeros of SISO models.
// Pure functions, no DOM: shared by browser and Node.
//
// Conventions
// - A matrix is an array of row arrays of numbers, [[1, 2], [3, 4]]; a vector
//   is a plain array of numbers. No function modifies its arguments.
// - A complex number is an object { re, im }.
// - A SISO state-space model is sys = { A, B, C, D }, for
//     x' = A x + B u,  y = C x + D u,
//   with A n×n, B an n×1 matrix or a plain n-vector, C a 1×n matrix or a
//   plain n-vector, and D a number (missing means 0).

const EPS = Number.EPSILON;
const DEG = 180 / Math.PI;

// ---- Shapes and small helpers

const isVector = (x) => x.length === 0 || typeof x[0] === 'number';

function square(A, who) {
  if (!Array.isArray(A) || !A.every((r) => r && r.length === A.length)) throw new Error(`${who}: expected a square matrix (an array of rows)`);
  return A.length;
}

// B as an n×m matrix: a plain vector is one column.
function asCol(B, n, who) {
  const M = isVector(B) ? Array.from(B, (v) => [v]) : B;
  if (M.length !== n) throw new Error(`${who}: B must have ${n} rows`);
  return M;
}

// C as a p×n matrix: a plain vector is one row.
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
// An angle in degrees wrapped to (−180, 180].
const wrap180 = (d) => d - 360 * Math.ceil((d - 180) / 360);

// ---- Basics

export const zeros = (r, c = r) => Array.from({ length: r }, () => new Array(c).fill(0));

export function eye(n) {
  const I = zeros(n, n);
  for (let i = 0; i < n; i++) I[i][i] = 1;
  return I;
}

// A·B for a matrix B, or A·b (a vector) for a vector b.
export function mul(A, B) {
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

// A + s·B, for matrices or vectors of the same shape.
export function add(A, B, s = 1) {
  if (A.length !== B.length) throw new Error('add: shapes differ');
  return A.map((a, i) => (typeof a === 'number' ? a + s * B[i] : a.map((x, j) => x + s * B[i][j])));
}

export const scale = (A, s) => A.map((a) => (typeof a === 'number' ? a * s : a.map((x) => x * s)));

export const transpose = (A) => (A.length ? Array.from(A[0], (_, j) => A.map((r) => r[j])) : []);

// LU factorisation with partial pivoting of a copy of A: P·A = L·U, with the
// unit lower triangle L (below the diagonal) and U (on and above it) in M.
// Stops at the first exactly zero pivot (singular).
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

// Solves A·X = B by Gaussian elimination with partial pivoting. B is a vector
// (the result is a vector) or a matrix with as many rows as A. Throws on an
// exactly singular A; a nearly singular one gives large, inaccurate results
// (check with rank).
export function solve(A, b) {
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

export const inv = (A) => solve(A, eye(square(A, 'inv')));

export function det(A) {
  square(A, 'det');
  const { M, sign, singular } = lu(A);
  return singular ? 0 : M.reduce((d, r, i) => d * r[i], sign);
}

// ---- Matrix exponential and discretisation

// Padé(13) coefficients and the norm up to which it is accurate to double
// precision without scaling (Higham 2005, "The scaling and squaring method
// for the matrix exponential revisited").
const PADE13 = [64764752532480000, 32382376266240000, 7771770303897600, 1187353796428800, 129060195264000, 10559470521600, 670442572800, 33522128640, 1323241920, 40840800, 960960, 16380, 182, 1];
const THETA13 = 5.371920351148152;

// e^A by scaling and squaring: A / 2^s has 1-norm at most THETA13, its
// exponential is the [13/13] Padé approximant, squared s times.
export function expm(A) {
  const n = square(A, 'expm');
  if (n === 0) return [];
  const nrm = norm1(A);
  if (!Number.isFinite(nrm)) throw new Error('expm: matrix has non-finite entries');
  const s = nrm > THETA13 ? Math.ceil(Math.log2(nrm / THETA13)) : 0;
  const b = PADE13;
  const X = scale(A, 2 ** -s);
  const X2 = mul(X, X), X4 = mul(X2, X2), X6 = mul(X4, X2), I = eye(n);
  const lin = (cs, Ms) => Ms.reduce((acc, M, i) => add(acc, M, cs[i]), zeros(n, n));
  // e^X ≈ (V − U)⁻¹ (V + U), with U the odd and V the even part of the numerator.
  const U = mul(X, add(mul(X6, lin([b[13], b[11], b[9]], [X6, X4, X2])), lin([b[7], b[5], b[3], b[1]], [X6, X4, X2, I])));
  const V = add(mul(X6, lin([b[12], b[10], b[8]], [X6, X4, X2])), lin([b[6], b[4], b[2], b[0]], [X6, X4, X2, I]));
  let E = solve(add(V, U, -1), add(V, U));
  for (let i = 0; i < s; i++) E = mul(E, E);
  return E;
}

// Zero-order-hold discretisation of x' = A x + B u with sample time Ts:
// x[k+1] = Ad x[k] + Bd u[k]. Both come from one exponential,
// exp([[A, B], [0, 0]]·Ts) = [[Ad, Bd], [0, I]], which also covers a singular
// A (integrators). B is n×m (a plain vector is one input); Bd is n×m.
export function c2d(A, B, Ts) {
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

// ---- Eigenvalues

// Balancing (Parlett–Reinsch, EISPACK balanc), in place: a similarity scaling
// by powers of 2 that evens out row and column norms. The eigenvalues stay
// exactly the same but become less sensitive to rounding. Returns the
// scaling d: the result is D⁻¹ A D with D = diag(d).
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

// Reduction to upper Hessenberg form by stabilised elementary similarity
// transformations (EISPACK elmhes), in place; below the subdiagonal is zeroed.
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

// Eigenvalues of an upper Hessenberg matrix by the Francis double-shift QR
// algorithm (EISPACK hqr, as in Numerical Recipes 3rd ed.), destroying a.
// Small subdiagonal entries split the problem; each converged 1×1 block is a
// real eigenvalue, each 2×2 block a real or complex pair. Exceptional shifts
// every 10 iterations break the cycles the standard shift can fall into.
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
      // Look for a single small subdiagonal element to split at.
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
          // Form the shift and look for two consecutive small subdiagonal elements.
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
          // Double QR step on rows l..nn and columns m..nn (chase the bulge).
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

// All eigenvalues of a general real square matrix, as complex numbers sorted
// by real part, then imaginary part, both descending. Complex ones come in
// conjugate pairs with equal real parts. A repeated eigenvalue of a defective
// matrix (a Jordan block, e.g. a double integrator after a similarity
// transformation) is only accurate to about sqrt(machine epsilon), as with any
// eigenvalue solver.
export function eig(A) {
  const n = square(A, 'eig');
  const a = A.map((r) => Array.from(r));
  if (!finite(a)) throw new Error('eig: matrix has non-finite entries');
  if (n === 0) return [];
  balance(a);
  hessenberg(a);
  return hqr(a).sort(byRealThenImag);
}

// ---- Riccati equations, LQR and Kalman gains

// Structure-preserving doubling algorithm (Chu, Fan, Lin 2005) for the DARE.
// With G = B R⁻¹ Bᵀ and H = Q, each step doubles the horizon of the Riccati
// recursion, so H converges to P quadratically: a few dozen steps instead of
// thousands of iterations for slow (fast-sampled) plants. null if R is
// singular or the steps fail.
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

// The Riccati difference equation iterated from P = Q. P is symmetrised every
// step: without it rounding makes P drift asymmetric and the iteration
// diverges on unstable plants (seen on a cart–pole).
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

// Stabilising solution P of the discrete algebraic Riccati equation
//   P = Aᵀ P A − Aᵀ P B (R + Bᵀ P B)⁻¹ Bᵀ P A + Q,
// for Q symmetric ≥ 0, R symmetric > 0 (a number for one input), (A, B)
// stabilisable and (A, Q) detectable. Tries the doubling algorithm first and
// accepts it when it converged and A − B K is stable; otherwise, or with
// method: 'iteration', iterates the Riccati difference equation until the
// largest change is below tol relative to the largest entry of P, or maxIter.
// Returns { P, converged, iterations, method: 'sda' | 'iteration' }
// (iterations counts doubling steps for 'sda').
export function dare(A, B, Q, R, { method = 'auto', tol = 1e-12, maxIter = 100000 } = {}) {
  const n = square(A, 'dare');
  const Bm = asCol(B, n, 'dare'), Rm = asMat(R);
  if (method !== 'iteration') {
    const r = dareSDA(A, Bm, Q, Rm, tol);
    if (r && spectralRadius(add(A, mul(Bm, lqrGain(A, Bm, Rm, r.P)), -1)) < 1) return { ...r, method: 'sda' };
  }
  return { ...dareIteration(A, Bm, Q, Rm, tol, maxIter), method: 'iteration' };
}

// Discrete LQR: the state feedback u = −K x that minimises
// Σ xᵀ Q x + uᵀ R u for x[k+1] = Ad x[k] + Bd u[k]. K is m×n, P the Riccati
// solution; R may be a number for a single input.
export function dlqr(Ad, Bd, Q, R) {
  const n = square(Ad, 'dlqr');
  const B = asCol(Bd, n, 'dlqr'), Rm = asMat(R);
  const { P, converged } = dare(Ad, B, Q, Rm);
  return { K: lqrGain(Ad, B, Rm, P), P, converged };
}

// Steady-state Kalman filter for
//   x[k+1] = Ad x[k] + Bd u[k] + w[k],  y[k] = C x[k] + v[k],
// with white, uncorrelated noises of covariance E[w wᵀ] = Qw (n×n) and
// E[v vᵀ] = Rv (p×p, or a number for one output). C is p×n (a plain vector is
// one output). Each sample the filter runs
//   measurement update  x̂⁺ = x̂⁻ + L (y − C x̂⁻)
//   time update         x̂⁻[k+1] = Ad x̂⁺ + Bd u[k]
// with L = P Cᵀ (C P Cᵀ + Rv)⁻¹ (n×p), where P is the steady-state a-priori
// error covariance E[(x − x̂⁻)(x − x̂⁻)ᵀ], from the dual Riccati equation
// (dare with Adᵀ, Cᵀ). The error x − x̂⁻ evolves with Ad (I − L C), which has
// the same eigenvalues as (I − L C) Ad. The one-step predictor form
// x̂⁻[k+1] = Ad x̂⁻ + Bd u + Lp (y − C x̂⁻) uses Lp = Ad L.
export function dlqe(Ad, C, Qw, Rv) {
  const n = square(Ad, 'dlqe');
  const Cm = asRow(C, n, 'dlqe'), Rm = asMat(Rv);
  const { P, converged } = dare(transpose(Ad), transpose(Cm), Qw, Rm);
  const CP = mul(Cm, P);
  // L = P Cᵀ S⁻¹ = (S⁻¹ C P)ᵀ, since S = C P Cᵀ + Rv and P are symmetric.
  const L = transpose(solve(add(Rm, mul(CP, transpose(Cm))), CP));
  return { L, P, converged };
}

// ---- SISO frequency response

// sys as { A, b, c, d } with plain vectors b and c and a number d.
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

// Solves (Mr + j·Mi) x = br + j·bi by Gaussian elimination with partial
// pivoting, in place (the arguments are overwritten). null if the matrix is
// exactly singular. Returns { xr, xi }.
export function csolve(Mr, Mi, br, bi) {
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

// G(jw) = c (jwI − A)⁻¹ b + d for a normalised model.
function respond({ A, b, c, d }, w) {
  const n = A.length;
  const x = csolve(A.map((r) => r.map((v) => -v)), A.map((r, i) => r.map((_, j) => (i === j ? w : 0))), b.slice(), new Array(n).fill(0));
  if (!x) throw new Error(`freqResp: jw = ${w}j is a pole of the system`);
  let re = d, im = 0;
  for (let i = 0; i < n; i++) { re += c[i] * x.xr[i]; im += c[i] * x.xi[i]; }
  return { re, im };
}

// Complex G(jw) = C (jwI − A)⁻¹ B + D of a SISO model at one frequency w
// (rad/s). Throws if jw is exactly a pole.
export const freqResp = (sys, w) => respond(siso(sys, 'freqResp'), w);

// Phase in degrees along the grid, unwrapped so that it changes by less than
// 180° from point to point (the grid must be fine enough for that). The
// branch at the first point is the one closest to 90° times the local slope
// of |G| in decades per decade (rounded): an integrator (slope −1) starts
// near −90°, a double integrator near −180°, rather than wherever atan2 puts
// them.
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

// Bode data of a SISO model on the frequencies ws (rad/s, increasing):
// { w, mag, magDb, phaseDeg }, the phase unwrapped continuously along w.
export function bode(sys, ws) {
  const s = siso(sys, 'bode');
  const G = ws.map((w) => respond(s, w));
  const mag = G.map(cabs);
  return { w: ws.slice(), mag, magDb: mag.map((m) => 20 * Math.log10(m)), phaseDeg: unwrapPhase(s, ws, G) };
}

// n points from 10^a to 10^b, evenly spaced in log w.
export const logspace = (a, b, n = 50) => Array.from({ length: n }, (_, i) => 10 ** (n === 1 ? a : a + ((b - a) * i) / (n - 1)));

// True if the target lies in (lo, hi] of two neighbouring samples: each
// crossing is counted once, also when it falls exactly on a grid point.
const crosses = (f1, f2) => Math.min(f1, f2) < 0 && Math.max(f1, f2) >= 0;

// Bisection for a sign change of the continuous f on [a, b] (f(a) = fa,
// f(b) = fb), halving in log w for positive frequencies.
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

// Stability margins of an open loop L(s) (SISO model) under negative
// feedback, found on the grid ws (rad/s, increasing) and refined by bisection
// on the continuous response:
// - gain crossovers |L(jwc)| = 1, each with phase margin pm = 180° + ∠L(jwc)
//   in (−180°, 180°];
// - phase crossovers ∠L(jw180) = −180° (mod 360°), each with gain margin
//   gm = 1 / |L(jw180)| (a ratio; gmDb in dB);
// - the peak sensitivity ms = max 1/|1 + L(jw)| (refined by golden section)
//   at wMs.
// wc/pm and w180/gm are the most critical crossings (smallest |pm|, smallest
// |gmDb|); all are listed in gainCrossings and phaseCrossings. Without a
// crossing in the grid: wc = NaN, pm = Infinity; w180 = NaN, gm = gmDb =
// Infinity. Crossings outside ws are not seen.
export function margins(sys, ws) {
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
    // The odd multiple of 180° in (lo, hi]; neighbouring phases differ by at most 180°.
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

  // Peak of 1/|1 + L|: best grid point, then golden section between its neighbours.
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

// ---- Root locus and zeros

// Closed-loop eigenvalues of the SISO open loop L = (A, B, C, D) under
// negative feedback u = −k·y, for each gain in ks: eig(A − k B (1 + k D)⁻¹ C),
// one sorted array of complex numbers per k ([] where 1 + k D = 0, an
// ill-posed algebraic loop).
export function rootLocus(sys, ks) {
  const { A, b, c, d } = siso(sys, 'rootLocus');
  return ks.map((k) => {
    const den = 1 + k * d;
    if (den === 0) return [];
    const g = k / den;
    return eig(A.map((row, i) => row.map((v, j) => v - g * b[i] * c[j])));
  });
}

// Below this, relative to its rounding-error scale, a feedthrough counts as
// zero in tzeros. Large on purpose: a realisation computed in floating point
// (a change of basis, residues) carries rounding noise in its higher Markov
// parameters, which smaller values turn into spurious far zeros.
const TZ_TOL = 1e-9;

// Transmission zeros of a SISO model: the finite roots of
// det [[sI − A, −B], [C, D]] = det(sI − A)·G(s), the numerator of G before
// any pole–zero cancellation. For a minimal realisation these are the zeros
// of G; for a non-minimal one they also include the modes that cancel
// (uncontrollable or unobservable). Sorted like eig.
// With D ≠ 0 they are eig(A − B D⁻¹ C). With D = 0 the system pencil is
// deflated (the SISO case of Emami-Naeini and Van Dooren 1982): an orthogonal
// change of state basis V makes C V = (0, …, 0, c), which forces the last
// state to zero; dropping it leaves a system of order n − 1 with
// A ← A₁₁, B ← B₁, C ← A₂₁ and D ← B₂, with the same zeros. Each step uses
// only orthogonally transformed data, so unlike powers C Aᵏ B it stays
// accurate for non-normal A. Limitations: deciding whether the new D is zero
// takes a tolerance (TZ_TOL against its rounding-error scale), so a zero
// about 1e9 times farther out than the plant's dynamics counts as infinite
// (omitted); a strongly non-normal realisation (‖A‖ far above its
// eigenvalues) can still show a spurious far zero or lose one. Clustered
// zeros are as ill-conditioned as clustered eigenvalues. [] if there are no
// finite zeros, or if G(s) ≡ 0.
export function tzeros(sys) {
  let { A, b, c, d } = siso(sys, 'tzeros');
  // Balance first (zeros are invariant under a change of basis): in a
  // companion form ‖A‖ is far above the dynamics and would make the rounding
  // scale below much too pessimistic.
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
    // Householder reflector H = I − 2 v vᵀ/(vᵀ v), symmetric and orthogonal,
    // with H cᵀ = alpha·e_n.
    const alpha = c[n - 1] > 0 ? -cn : cn;
    const v = c.slice();
    v[n - 1] -= alpha;
    const vv = v.reduce((s, x) => s + x * x, 0);
    const reflect = (x) => { const f = (2 * x.reduce((s, xi, i) => s + xi * v[i], 0)) / vv; return x.map((xi, i) => xi - f * v[i]); };
    const HA = transpose(transpose(A).map(reflect));
    const HAH = HA.map(reflect);
    const Hb = reflect(b);
    // The new feedthrough Hb[n − 1] = c·b/|c|: zero unless it stands out
    // from the rounding error, which is relative to the error in c.
    const b2 = Hb[n - 1];
    d = Math.abs(b2) > TZ_TOL * bn * (cErr / cn) ? b2 : 0;
    cErr = Math.sqrt(HAH.reduce((s, r) => s + r.reduce((s2, x) => s2 + x * x, 0), 0));
    c = HAH[n - 1].slice(0, n - 1);
    A = HAH.slice(0, n - 1).map((r) => r.slice(0, n - 1));
    b = Hb.slice(0, n - 1);
  }
}

// ---- Controllability and rank

// Controllability matrix [B, A B, A² B, …, Aⁿ⁻¹ B] (n × n·m).
export function ctrb(A, B) {
  const n = square(A, 'ctrb');
  const Bm = asCol(B, n, 'ctrb');
  const blocks = [Bm];
  for (let i = 1; i < n; i++) blocks.push(mul(A, blocks[i - 1]));
  return Bm.map((_, i) => blocks.flatMap((M) => M[i]));
}

// Numerical rank: the number of diagonal entries of R above tol in a
// Householder QR with column pivoting (each step takes the remaining column
// of largest norm, so |R₁₁| ≥ |R₂₂| ≥ …). The default tol is
// max(m, n)·eps·|R₁₁|, |R₁₁| being the largest column norm. Reliable for
// ordinary matrices, though unlike the SVD not for every contrived one.
export function rank(M, tol) {
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
    // Reflect column k onto alpha·e_k, alpha of opposite sign to R[k][k] (no cancellation).
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
