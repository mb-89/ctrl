// Test fixture (not shipped): hil/hil_plant.py's plant, a DC motor swinging an
// unbalanced arm, ported line by line, so the experiment can be scored against
// the plant it really ran on (design/output/identification.md §14, §17).
//
//   di/dt = (V − R i − k ω) / L
//   dω/dt = (k i − b ω − Tc tanh(ω/ω_eps) − mgl sin(angle) + load) / J
//   d angle/dt = ω
//
// integrated by RK4 in substeps of at most H = 0.5 ms, as the script does.
// Each physical parameter is drawn within ±vary of nominal from a seed (the
// script's --vary, --seed; a JS generator, so the draws are not the script's).
// The page reads the angle through an encoder (2π/4096 per count) with
// measurement noise; u reaches the motor a little after y left the plant (the
// round trip), as the script applies each u from the moment it arrives. The
// plant declares a hard range for the angle and E-stops beyond it (§15): it
// then applies its safe inputs and holds them.

import { gaussAt } from '../../src/core/signals.js';

export const NOMINAL = { R: 2.0, L: 4e-3, k: 0.1, J: 2.5e-3, b: 2e-3, Tc: 0.01, mgl: 0.1 };
export const W_EPS = 0.01, H = 5e-4;
export const PHYSICS = Object.keys(NOMINAL);

// mulberry32: a seeded uniform generator in [0, 1).
export function uniform(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The parameters of one plant: each within ±vary of nominal, from the seed.
export function drawArm(seed, vary = 0.15) {
  const rnd = uniform(seed * 7919 + 13);
  return Object.fromEntries(PHYSICS.map((n) => [n, NOMINAL[n] * (1 + vary * (2 * rnd() - 1))]));
}

// The arm's static and linear figures at an angle (for the tests' bounds):
// the voltage that holds it there, and the gain, swing frequency and damping
// of its linearisation (L neglected: the electrical time constant is 2 ms).
export function armAt(p, angle) {
  const stiff = p.mgl * Math.cos(angle);                       // N·m/rad
  const damp = p.b + (p.k * p.k) / p.R;                         // N·m·s/rad
  const wn = Math.sqrt(Math.max(stiff, 1e-12) / p.J);
  return { hold: (p.R / p.k) * p.mgl * Math.sin(angle), gain: (p.k / p.R) / stiff, f: wn / (2 * Math.PI), zeta: damp / (2 * Math.sqrt(p.J * Math.max(stiff, 1e-12))) };
}

// One arm at Ts. opts: noise (rad, std), counts (encoder counts per turn; 0:
// none), latency (s from y to the u it answers), hard ([lo, hi] of the angle;
// E-stop beyond), seed (the noise's), umin/umax (the plant's clamp).
export function createArm(params = NOMINAL, { Ts = 0.01, noise = 0.001, counts = 4096, latency = 0.002, hard = [-2.5, 2.5], seed = 1, umin = -12, umax = 12, load = 0 } = {}) {
  const p = { ...NOMINAL, ...params };
  let i = 0, w = 0, angle = 0;
  let uNow = 0, k = 0, estop = null, maxAngle = 0, minAngle = 0;
  const q = counts > 0 ? (2 * Math.PI) / counts : 0;
  const rates = (ii, ww, aa, V, ld) => [
    (V - p.R * ii - p.k * ww) / p.L,
    (p.k * ii - (p.b * ww + p.Tc * Math.tanh(ww / W_EPS)) - p.mgl * Math.sin(aa) + ld) / p.J,
    ww,
  ];
  // RK4 over span with V held, in substeps of at most H.
  function advance(span, V) {
    if (span <= 0) return;
    const n = Math.max(1, Math.ceil(span / H - 1e-9)), h = span / n;
    for (let s = 0; s < n; s++) {
      const k1 = rates(i, w, angle, V, load);
      const k2 = rates(i + 0.5 * h * k1[0], w + 0.5 * h * k1[1], angle + 0.5 * h * k1[2], V, load);
      const k3 = rates(i + 0.5 * h * k2[0], w + 0.5 * h * k2[1], angle + 0.5 * h * k2[2], V, load);
      const k4 = rates(i + h * k3[0], w + h * k3[1], angle + h * k3[2], V, load);
      i += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
      w += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
      angle += (h / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
      maxAngle = Math.max(maxAngle, angle); minAngle = Math.min(minAngle, angle);
    }
  }
  return {
    params: p, Ts,
    truth: () => angle,
    get state() { return { i, w, angle, k, estop, maxAngle, minAngle }; },
    get estop() { return estop; },
    // What the page reads at sample k: the encoder's count of the angle with noise.
    output() {
      const v = angle + (noise > 0 ? noise * gaussAt(seed, k) : 0);
      return q > 0 ? q * Math.round(v / q) : v;
    },
    // u answers the y just read: it arrives `latency` later and is held to the
    // next arrival. Beyond the hard range the plant stops itself.
    advance(u) {
      let V = Math.min(umax, Math.max(umin, Number.isFinite(u) ? u : 0));
      if (estop) V = 0;
      advance(latency, uNow);
      uNow = V;
      advance(Ts - latency, uNow);
      k++;
      if (!estop && hard && (angle < hard[0] || angle > hard[1])) { estop = `angle ${angle.toFixed(2)} rad beyond ${angle > hard[1] ? hard[1] : hard[0]}`; uNow = 0; }
      return uNow;
    },
    // What it applied over the cycle just ended.
    get applied() { return uNow; },
  };
}
