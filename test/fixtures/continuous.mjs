// Test fixture (not shipped): a continuous-time plant simulated in fine
// steps, independent of src/core/fit.js, to check the fits against.
//
// contSim(num, den, theta, Ts) integrates num(s)/den(s) (controllable
// canonical form, poly.js) by RK4 under the input u(t − θ), where u[k] is
// held over [kTs, (k+1)Ts). The input switches where t − θ crosses a sample
// instant, so each sample interval is cut there and RK4 runs on pieces with
// a constant input: the dead time is exact to the step's accuracy, with no
// decomposition into whole and fractional samples.

import { tf2ss } from '../../src/core/poly.js';
import { gaussAt } from '../../src/core/signals.js';

export function contSim(num, den, theta, Ts, sub = 40) {
  const r = tf2ss(num, den), n = den.length - 1, A = r.A, B = r.B, C = r.C, D = r.D ?? 0;
  const x = new Float64Array(n), hist = [];
  const k1 = new Float64Array(n), k2 = new Float64Array(n), k3 = new Float64Array(n), k4 = new Float64Array(n), t = new Float64Array(n);
  const f = (xx, u, out) => {
    for (let i = 0; i < n; i++) {
      let s = B[i] * u;
      for (let j = 0; j < n; j++) s += A[i * n + j] * xx[j];
      out[i] = s;
    }
  };
  const rk = (u, T, steps) => {
    const h = T / steps;
    for (let s = 0; s < steps; s++) {
      f(x, u, k1);
      for (let i = 0; i < n; i++) t[i] = x[i] + (h / 2) * k1[i];
      f(t, u, k2);
      for (let i = 0; i < n; i++) t[i] = x[i] + (h / 2) * k2[i];
      f(t, u, k3);
      for (let i = 0; i < n; i++) t[i] = x[i] + h * k3[i];
      f(t, u, k4);
      for (let i = 0; i < n; i++) x[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    }
  };
  // The input the plant sees at time tt: the sample that was held θ earlier.
  const uAt = (tt) => {
    const i = Math.floor((tt - theta) / Ts + 1e-12);
    return i >= 0 && i < hist.length ? hist[i] : 0;
  };
  return {
    // y at the current sample instant (D = 0 for the structures fitted here).
    output() {
      let s = D * uAt(hist.length * Ts);
      for (let i = 0; i < n; i++) s += C[i] * x[i];
      return s;
    },
    // Holds u from this sample instant to the next and integrates over it.
    advance(u) {
      hist.push(u);
      const k = hist.length - 1, t0 = k * Ts, t1 = t0 + Ts;
      const cuts = [t0, t1];
      for (let j = Math.floor((t0 - theta) / Ts); j <= Math.ceil((t1 - theta) / Ts); j++) {
        const c = j * Ts + theta;
        if (c > t0 + 1e-12 && c < t1 - 1e-12) cuts.push(c);
      }
      cuts.sort((a, b) => a - b);
      for (let i = 0; i + 1 < cuts.length; i++) {
        const T = cuts[i + 1] - cuts[i];
        rk(uAt((cuts[i] + cuts[i + 1]) / 2), T, Math.max(2, Math.ceil((sub * T) / Ts)));
      }
    },
  };
}

// A structure's plant (STRUCTURES[name].tf(p)) run for N samples, open loop
// on u or closed loop under law() ((k, y) => u), with measurement noise
// noise(k) added to y (what the law reads and what is recorded).
//   input: a static map from the recorded u to what drives the plant (an
//     actuator's nonlinearity, such as u + a·u³).
//   gaps: [[k, len], …], seq gaps: just before sample k the plant runs len
//     cycles more with the last u held, and none of them is recorded (the
//     law's k counts recorded samples only).
export function runPlant(tf, Ts, N, { u = null, law = null, noise = null, input = null, gaps = [] } = {}) {
  const cs = contSim(tf.num, tf.den, tf.delay ?? 0, Ts);
  const y = new Float64Array(N), uu = new Float64Array(N);
  const l = law ? law() : null;
  const lost = new Map(gaps.map(([k, len]) => [k, len]));
  const drive = (v) => (input ? input(v) : v);
  for (let k = 0; k < N; k++) {
    for (let j = 0; j < (lost.get(k) ?? 0); j++) cs.advance(drive(uu[k - 1] ?? 0));
    y[k] = cs.output() + (noise ? noise(k) : 0);
    uu[k] = l ? l(k, y[k]) : u[k];
    cs.advance(drive(uu[k]));
  }
  return { y, u: uu };
}

// A PI law u = Kp e + Ki Ts Σe (the sum up to the sample before), e = r − y,
// as a factory of fresh laws, the shape fit.js replays.
export function piLaw(Kp, Ki, r, Ts) {
  return () => {
    let I = 0;
    return (k, y) => {
      const e = r[k] - y;
      const u = Kp * e + I;
      I += Ki * Ts * e;
      return u;
    };
  };
}

// Doublets of growing length: +a for T, −a for T, 0 for 2T; T grows by 1.6.
export function doublets(N, a = 1, T0 = 5) {
  const u = new Float64Array(N);
  let k = 0, T = T0;
  while (k < N) {
    for (let i = 0; i < T && k < N; i++) u[k++] = a;
    for (let i = 0; i < T && k < N; i++) u[k++] = -a;
    for (let i = 0; i < 2 * T && k < N; i++) u[k++] = 0;
    T = Math.round(T * 1.6);
  }
  return u;
}

// A square wave between lo and hi, half-period `half` samples.
export const square = (N, lo, hi, half) => Float64Array.from({ length: N }, (_, k) => (Math.floor(k / half) % 2 ? hi : lo));

// White noise of standard deviation sigma, seeded.
export const white = (sigma, seed) => (k) => sigma * gaussAt(seed, k);

// AR(1) noise v[k] = a v[k−1] + e[k] of standard deviation sigma, seeded
// (memoised per sample, so it can be read in order once).
export function ar1(a, sigma, seed) {
  const s = sigma * Math.sqrt(1 - a * a);
  let v = 0, last = -1;
  return (k) => {
    while (last < k) { last++; v = a * v + s * gaussAt(seed, last); }
    return v;
  };
}
