// Loop analysis for the Analysis tab: from the plant a Controller block sees
// (linearised, continuous) and the controller's own discrete model, the open
// loop L(z) cut at the actuator, and what control engineers read from it:
// closed-loop poles (with ζ and ωn), the root locus, the frequency response
// (Bode, Nyquist / Ortskurve), and the margins. Everything is discrete-time,
// as the simulation samples (zero-order hold at the controller's Ts), so the
// margins include the sampling delay. Research and sources:
// design/research/analysis.md.
//
// Conventions: a state-space model is { A, B, C, D } with matrices as arrays
// of rows. The plant has one input u and m outputs (the controller's
// measurement inputs, in port order). The controller model has inputs
// [r, y1 … ym] and one output u. L is SISO with negative feedback: the loop is
// stable when 1 + L(z) has no zero on or outside the unit circle.

import { c2d, eig, eigPerturbed, csolve, solve } from './linalg.js';

const zerosM = (r, c) => Array.from({ length: r }, () => new Array(c).fill(0));
const col = (M, j) => M.map((row) => row[j]);
const cabs = (z) => Math.hypot(z.re, z.im);
const byRealThenImag = (a, b) => b.re - a.re || b.im - a.im;
const angleDeg = (g) => (Math.atan2(g.im, g.re) * 180) / Math.PI;
const rotate = (g, a) => { const c = Math.cos(a), s = Math.sin(a); return { re: g.re * c - g.im * s, im: g.re * s + g.im * c }; };

// Where a pole sits. A pole within ON_CIRCLE of |z| = 1 is on the unit circle
// (an integrator, an undamped mode): neither inside nor outside, so it is in
// neither P nor Z. A repeated pole of a defective matrix (a double or triple
// integrator in a rotated basis, say) comes out of eig split into a small
// ring around its true place, a few 1e-7 wide at most here, and the ring's
// mean is accurate to rounding. Which close poles are such a ring is checked
// on the matrix itself (see poleSides), not guessed from how close they are:
// two real poles 3e-5 either side of z = 1 (s = ±0.03 at 1 ms) are two poles.
export const ON_CIRCLE = 1e-7;
// Poles closer than NEAR to the circle and to each other are checked.
const NEAR = 1e-3;
// A pole with |z| below AT_ORIGIN is z = 0 for the s-plane: a dead-time chain
// or a previous-measurement state, which eig splits to about eps^(1/k) for k
// such states. s = ln z / Ts would put it thousands of rad/s out.
export const AT_ORIGIN = 1e-3;

const sideOf = (r) => (r > 1 + ON_CIRCLE ? 'out' : r < 1 - ON_CIRCLE ? 'in' : 'on');

// Connected groups of the indices idx, linked when link(i, j).
function groups(idx, link) {
  const root = new Map(idx.map((i) => [i, i]));
  const find = (i) => (root.get(i) === i ? i : find(root.get(i)));
  for (let a = 0; a < idx.length; a++) for (let b = a + 1; b < idx.length; b++) if (link(idx[a], idx[b])) root.set(find(idx[a]), find(idx[b]));
  const out = new Map();
  for (const i of idx) { const r = find(i); if (!out.has(r)) out.set(r, []); out.get(r).push(i); }
  return [...out.values()];
}

// 'in', 'on' or 'out' of the unit circle, for each pole (eigenvalue) of the
// matrix M. Where close poles near the circle fall on different sides, M is
// changed a little (eigPerturbed) to see which of them rounding can move: a
// pole split by rounding moves by about as much as its pieces lie apart,
// a pole eig resolves hardly moves. The pieces of a split pole are graded
// together by their mean; resolved poles each on their own. Without M every
// pole is graded on its own.
export function poleSides(poles, M) {
  const sides = poles.map((p) => sideOf(cabs(p)));
  if (!M) return sides;
  const dist = (p, q) => Math.hypot(p.re - q.re, p.im - q.im);
  const near = poles.map((p, i) => i).filter((i) => Math.abs(cabs(poles[i]) - 1) < NEAR);
  const mixed = groups(near, (i, j) => dist(poles[i], poles[j]) < NEAR).filter((g) => g.length > 1 && new Set(g.map((i) => sides[i])).size > 1);
  if (!mixed.length) return sides;
  const moved = eigPerturbed(M);
  for (const g of mixed) {
    // How far each pole moves, against how far it is from its nearest neighbour.
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

// The plant as the controller samples it: discretised with a zero-order hold
// at Ts, and each measurement's dead time (plant.delay[k], seconds) exact.
// Whole samples are a chain of unit delays. A fraction f of a sample more is
// the modified z-transform: the value read f·Ts before a sample instant is
// the plant (1 − f)·Ts after the instant before, under the input held since
// then, read one unit delay later. use[k] = false leaves measurement k
// without a chain (the loop does not read it); drop takes that many unit
// delays off every chain (a delay common to the whole loop, factored out).
export function discretePlant(plant, Ts, { use, drop = 0 } = {}) {
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
    // The first delay state takes this sample's reading, each next one the one before.
    for (let j = 0; j < n; j++) A[o][j] = t.c[j];
    B[o][0] = t.d;
    for (let i = 1; i < len[k]; i++) A[o + i][o + i - 1] = 1;
    C[k][o + len[k] - 1] = 1;
    o += len[k];
  }
  return { A, B, C, D, delaySamples, delayStates: len, Ad, Bd, plantStates: n, taps: taps.map((t, k) => ({ c: t.c, d: t.d, len: len[k] })) };
}

// The loop from the plant and controller models (see openLoop).
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

// The open loop cut at u (u_p = v, the controller output u_c read but not
// applied): L(z) = −u_c / v with r = 0. Plant discretised with a ZOH at Ts.
// Every path round the loop passes a measurement, so the shortest chain of
// unit delays among the measurements the controller reads is a factor z^−d
// of the whole loop: L.core is the loop without it (L = z^−d · L.core).
// L.freq keeps the loop's parts for the frequency response: the plant, each
// measurement's reading of it and its chain of len unit delays, and the
// controller from each measurement, so that
//   L(z) = −Σ_k K_k(z) · z^−len_k · (c_k (zI − Ad)⁻¹ Bd + d_k),
// solved at each frequency without the delay states, every z^−len exact.
export function openLoop(plant, ctrl, Ts) {
  const m = plant.C.length;
  // Controller columns that act on the measurements (inputs 1 … m); a law
  // with fewer gains than measurements ignores the rest.
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
    // The longest chain the core keeps (measurements read with different dead times).
    spread: read.length ? Math.max(...read) - d : 0,
    // The state matrix is block triangular: plant, delay chains, controller.
    parts: { plant: P.Ad, chains: P.A.length - P.plantStates, ctrl: ctrl.A },
  };
}

// The open loop's poles and their sides. Its state matrix is block
// triangular, so they are the plant's, z = 0 for every delay state, and the
// controller's, each found on its own: a plant integrator and a controller
// integrator stay two simple poles at z = 1 instead of one split double root,
// and the delay chains stay exactly at 0.
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
export const openLoopPoles = (L) => openLoopSides(L).poles;

// The closed loop's state matrix for the loop gain multiplied by k (k = 1:
// as tuned); null where 1 + k·D = 0 (no proper closed loop).
function closedLoopMatrix(L, k) {
  const den = 1 + k * L.D;
  if (Math.abs(den) < 1e-12) return null;
  return L.A.map((row, i) => row.map((v, j) => v - (k * L.B[i][0] * L.C[0][j]) / den));
}

// Closed-loop poles in z for the loop gain multiplied by k.
export function closedLoop(L, k = 1) {
  const M = closedLoopMatrix(L, k);
  return M ? eig(M) : [];
}

// The closed-loop poles for the gain k and their sides of the unit circle.
export function closedLoopSides(L, k = 1) {
  const M = closedLoopMatrix(L, k);
  if (!M) return { poles: [], sides: [] };
  const poles = eig(M);
  return { poles, sides: poleSides(poles, M) };
}

// Stable: every pole inside; marginal: none outside, some on the circle.
const classOf = (sides) => (sides.includes('out') ? 'unstable' : sides.includes('on') ? 'marginal' : 'stable');

// A z-plane pole as its continuous equivalent s = ln(z)/Ts, with ωn and ζ.
export function sOf(z, Ts) {
  const r = Math.hypot(z.re, z.im);
  if (r < 1e-300) return { re: -Infinity, im: 0, wn: Infinity, zeta: 1 };
  const re = Math.log(r) / Ts, im = Math.atan2(z.im, z.re) / Ts, wn = Math.hypot(re, im);
  return { re, im, wn, zeta: wn > 0 ? -re / wn : 1 };
}

// Where a pole goes on the s-plane plot: [Re s, Im s], or null for a pole at
// z = 0 (|z| < AT_ORIGIN), which is faster than anything the plot shows.
export function sPlanePoint(z, Ts) {
  if (Math.hypot(z.re, z.im) < AT_ORIGIN) return null;
  const s = sOf(z, Ts);
  return Number.isFinite(s.re) ? [s.re, s.im] : null;
}

// L(e^{jωTs}) at one angular frequency ω (rad/s), from the loop's parts
// (L.freq) where it has them, else from its state space.
export function respondAt(L, w) {
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

// The core, L · z^d: the loop without the dead time common to it.
function coreAt(L, w) {
  if (L.freq) return respondParts(L.freq, L.Ts, w, L.pureDelay);
  return respondAt(L.core ?? L, w);
}

// The loop from its parts (see openLoop), times z^shift.
function respondParts(F, Ts, w, shift) {
  const zr = Math.cos(w * Ts), zi = Math.sin(w * Ts);
  // The plant's state for a unit input, X = (zI − Ad)⁻¹ Bd ...
  const n = F.Ad.length;
  let X = { xr: [], xi: [] };
  if (n) X = csolve(F.Ad.map((row, i) => row.map((v, j) => (i === j ? zr : 0) - v)), F.Ad.map((row, i) => row.map((_, j) => (i === j ? zi : 0))), col(F.Bd, 0), new Array(n).fill(0));
  // ... and the controller's row Y = Cc (zI − Ac)⁻¹, from (zI − Ac)ᵀ Yᵀ = Ccᵀ.
  const c = F.ctrl, nc = c.A.length;
  let Y = { xr: [], xi: [] };
  if (nc) Y = csolve(c.A.map((row, i) => row.map((_, j) => (i === j ? zr : 0) - c.A[j][i])), c.A.map((row, i) => row.map((_, j) => (i === j ? zi : 0))), c.C.slice(), new Array(nc).fill(0));
  if (!X || !Y) return { re: NaN, im: NaN };
  let re = 0, im = 0;
  F.taps.forEach((t, k) => {
    if (!F.use[k]) return;
    // The reading c·X + d, delayed by len − shift samples.
    let gr = t.d, gi = 0;
    for (let j = 0; j < n; j++) { gr += t.c[j] * X.xr[j]; gi += t.c[j] * X.xi[j]; }
    // The controller from measurement k: Y·Bc[:, k] + Dc[k].
    let kr = c.D[k], ki = 0;
    for (let j = 0; j < nc; j++) { kr += Y.xr[j] * c.B[j][k]; ki += Y.xi[j] * c.B[j][k]; }
    const g = rotate({ re: gr * kr - gi * ki, im: gr * ki + gi * kr }, -w * Ts * (t.len - shift));
    re -= g.re; im -= g.im;
  });
  return { re, im };
}

// Frequency response on a log grid from wmin up to just below Nyquist (π/Ts).
// The phase: the loop's common dead time is factored out (L = z^−d · core)
// and added back as exactly −ω·d·Ts; the phase of the core is unwrapped along
// the grid, which is refined where it moves more than 45° between points.
export function frequencyData(L, { points = 400, wmin } = {}) {
  const wN = Math.PI / L.Ts, hi = 0.999 * wN, lo = Math.min(wmin ?? wN * 1e-4, wN * 1e-2);
  const delay = L.core || L.freq ? L.pureDelay * L.Ts : 0;
  let w = Array.from({ length: points }, (_, i) => lo * (hi / lo) ** (i / (points - 1)));
  // Measurements read with different dead times leave a chain of `spread`
  // samples in the core, whose phase turns once every 2π/(spread·Ts) rad/s:
  // a linear grid 24 points to each turn follows it.
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
    else if (ph > 0) ph -= 360;   // start on the lagging branch, as an engineer reads it
    phase0.push(ph);
  }
  const full = delay ? G.map((g, i) => rotate(g, -w[i] * delay)) : G;
  return {
    w, re: full.map((g) => g.re), im: full.map((g) => g.im), mag: G.map((g) => Math.hypot(g.re, g.im)),
    phase: phase0.map((p, i) => p - (w[i] * delay * 180) / Math.PI), phase0, delay,
  };
}

// The unwrapped phase of L at any ω (degrees), on the branch the grid's phase
// is on: the core's angle taken nearest the grid's core phase there, minus
// the factored dead time.
export function phaseAt(fd, L, w) {
  const ws = fd.w;
  let i = 1, j = ws.length - 1;
  while (i < j) { const m = (i + j) >> 1; if (ws[m] < w) i = m + 1; else j = m; }
  const f = Math.min(1, Math.max(0, (Math.log(w) - Math.log(ws[i - 1])) / (Math.log(ws[i]) - Math.log(ws[i - 1]))));
  const ref = fd.phase0[i - 1] + f * (fd.phase0[i] - fd.phase0[i - 1]);
  let ph = angleDeg(coreAt(L, w));
  ph += 360 * Math.round((ref - ph) / 360);
  return ph - (w * fd.delay * 180) / Math.PI;
}

// Bisection for a sign change of fn over [a, b] (log ω).
function bisect(fn, a, b, fa = fn(a)) {
  for (let it = 0; it < 48; it++) {
    const m = (a + b) / 2, fm = fn(m);
    if ((fm <= 0) === (fa <= 0)) { a = m; fa = fm; } else b = m;
  }
  return (a + b) / 2;
}

// The gain interval: the factors k by which the loop gain may be scaled
// before a closed-loop pole crosses the unit circle. Stability can change
// only at the gains where k·L passes −1 (gains), or where 1 + k·D = 0; probes
// ({ k, poles, sides } of the root locus) catch a change those missed, which
// is then found by bisection. The stretches between changes are judged on
// their poles, outwards from the tuned gain (k = 1). With no pole outside at
// k = 1 the interval is where none goes outside (a pole that only touches
// the circle is passed over). An unstable loop gets instead the stretch
// nearest to k = 1 where every pole is strictly inside (null if there is
// none): a stretch where poles sit on the circle is not stable.
export function gainRange(L, gains, probe = []) {
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
  // Stretch i runs from edges[i] to edges[i + 1]. The stretch k = 1 is in
  // is judged at k = 1, every other one in its middle.
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

// Margins from the frequency data. Gain crossings |L| = 1 give phase margins
// and delay margins ((∠L + 180°) mod 360° / ωc, valid for unstable loops too);
// phase crossings ∠L = −180° (mod 360°) give the gain factors at which the
// loop would cross −1, including where L is real at the ends of the band,
// z = 1 (ω = 0) and z = −1 (ω = π/Ts). Ms = max |S| = max 1/|1 + L|,
// Mt = max |T| = max |L/(1+L)|. With the loop L, each crossing is solved for
// exactly (bisection between grid points); poles are the open-loop poles
// (to skip an end that is a pole) and probe the root locus (see gainRange).
export function loopMargins(fd, Ts, { L, poles = [], probe = [] } = {}) {
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
    // Every −180° + k·360° the phase passes between the two points.
    const pa = phase[i - 1], pb = phase[i];
    for (let k = Math.ceil((Math.min(pa, pb) + 180) / 360); 360 * k - 180 <= Math.max(pa, pb); k++) {
      const target = 360 * k - 180;
      if (target === Math.min(pa, pb) && pa !== pb) continue;   // counted in the neighbouring interval
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
    // The ends of the band, where L is real: a negative L(1) or L(−1) is a
    // crossing of −1 at the gain −1/L (unless that end is a pole of L).
    for (const [wx, z, at] of [[0, 1, 'dc'], [Math.PI / Ts, -1, 'nyquist']]) {
      if (poles.some((p) => Math.hypot(p.re - z, p.im) < 1e-6)) continue;
      const g = respondAt(L, wx).re;
      if (!(g < 0) || !Number.isFinite(g)) continue;
      if (phaseCrossings.some((c) => Math.abs(Math.log(c.mag / -g)) < 1e-6)) continue;
      phaseCrossings.push({ w: wx, mag: -g, gm: -1 / g, gmDb: -20 * Math.log10(-g), at });
    }
  }
  let ms = 0, wMs = NaN, mt = 0, wMt = NaN;
  for (let i = 0; i < w.length; i++) {
    const d = Math.hypot(1 + re[i], im[i]);
    if (1 / d > ms) { ms = 1 / d; wMs = w[i]; }
    if (mag[i] / d > mt) { mt = mag[i] / d; wMt = w[i]; }
  }
  // The gain interval that keeps the loop where it is: the nearest changes of
  // stability above and below the present gain.
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

// The closed loop's response to a unit step in r: the first measurement y
// and the controller output u at each sample, for K samples. The step goes
// through the controller's prefilter (ctrl.Tr, outside the loop) as the law
// does, from rest at 0: rf = 1 − a^(k+1), a = e^(−Ts/Tr). The plant must not
// pass u straight to a measurement (D = 0), as physical plants do not.
export function stepResponse(plant, ctrl, Ts, K = 200) {
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

// The closed loop from r to the first measurement y as one discrete state
// space, x⁺ = A x + B r, y = C x + D r. A first-order prefilter on r (the
// law's Tr) is one more state, last: the loop sees rf = a q + (1 − a) r and
// q⁺ = rf, as stepResponse runs it.
export function closedLoopModel(plant, ctrl, Ts) {
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
  // u = g · (dr r + Dcy·(Cp xp) + Cc xc), the measurements' direct part solved for.
  const g = 1 / (1 - Dcy.reduce((s, d, k) => s + d * P.D[k][0], 0));
  const uRow = new Array(N).fill(0);
  for (let j = 0; j < n; j++) uRow[j] = g * Dcy.reduce((s, d, k) => s + d * P.C[k][j], 0);
  for (let j = 0; j < nc; j++) uRow[n + j] = g * ctrl.C[0][j];
  const ur = g * dr;
  // Each measurement as a row over x, and its part from r.
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

// The linear step r → y and its numbers. The final value is the closed loop's
// DC gain, solved from (I − A) x = B, not the last sample. The window is ten
// time constants of the slowest closed-loop pole, so the response settles
// inside it. It is stepped sample by sample while any mode is alive that a
// stride would not follow, then in strides of M samples (A^M and its input
// sum), so a long window costs about the same as a short one. A mode is
// followed by the strides when it changes little over one (decays by under
// 5 %, turns by under 0.2 rad); one that does not is run out sample by sample
// first (e^−20 of it left), within a budget of work. Overshoot and the 2 %
// settling band are measured against the final value on every sample run;
// the stride in which the response last leaves the band is run again sample
// by sample, so the settling time is exact to the sample. A response still
// outside the band at the end of the window has not settled. The samples
// kept for the plot are thinned to the extremes of each bucket.
export function stepInfo(plant, ctrl, Ts, { clPoles, T, steps = 20000, budget = 3e8 } = {}) {
  const S = closedLoopModel(plant, ctrl, Ts), N = S.A.length;
  let yf = NaN;
  try {
    const x = solve(S.A.map((row, i) => row.map((v, j) => (i === j ? 1 : 0) - v)), S.B);
    yf = S.C.reduce((s, c, j) => s + c * x[j], 0) + S.D;
  } catch { /* a pole at z = 1: no final value */ }
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
  // The plot keeps, per bucket of q samples, its lowest and highest sample.
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
    // Then in strides of M = 2^p samples: x ← A^M x + (Σ A^i) B.
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
    // The stride after the last point outside the band, sample by sample.
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

// Root locus: closed-loop poles for the loop gain scaled by each k.
export function locus(L, ks) { return ks.map((k) => ({ k, ...closedLoopSides(L, k) })); }

// The low end of the frequency grid: a decade below the slowest pole of the
// open or the closed loop (s = ln z / Ts, leaving out integrators at z = 1
// and poles at z = 0), at least two decades below Nyquist; then lower, a
// decade at a time, while |L| below it still moves towards 1 (a slow
// crossover the poles do not show).
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

// Everything the tab shows, from the plant and controller models.
export function analyzeLoop(plant, ctrl, Ts, { points = 400 } = {}) {
  const L = openLoop(plant, ctrl, Ts);
  const { poles: olPoles, sides: olSides } = openLoopSides(L), { poles: clZ, sides: clSides } = closedLoopSides(L, 1);
  const count = (sides, s) => sides.filter((x) => x === s).length;
  const P = count(olSides, 'out'), Z = count(clSides, 'out'), onClosed = count(clSides, 'on');
  const fd = frequencyData(L, { points, wmin: lowFrequency(L, [[olPoles, olSides], [clZ, clSides]]) });
  // The root locus at gains ×0.01 … ×100: 121 of them, fewer for a big loop
  // (a long dead time), where each costs an eigenvalue problem of its size.
  const nk = L.n <= 40 ? 121 : Math.max(41, Math.round((121 * 40) / L.n));
  const ks = Array.from({ length: nk }, (_, i) => 10 ** (-2 + (4 * i) / (nk - 1)));
  const loc = locus(L, ks);
  const margins = loopMargins(fd, Ts, { L, poles: olPoles, probe: loc });
  // A pole on the unit circle is undamped: Re s = 0 exactly, not ± rounding.
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
