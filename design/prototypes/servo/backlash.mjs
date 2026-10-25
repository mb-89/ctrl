// The rotor in the motor, coupled: (1) the PUMA-like joint, rigid (the first
// design: G²·Jm on the mechanism) against the elastic gear at a
// non-problematic 50 Hz, then backlash with and without gravity, then the
// encoder and ripple at realistic sizes; (2) the backlash example: a motor
// turning a load arm through a gearhead with play, position control on the
// load's angle, its variants.
//   node design/prototypes/servo/backlash.mjs
import { simulateSystem } from '../../../src/core/sim.js';
import { normalizeDiagram } from '../../../src/core/diagram.js';
import { servoMotor } from './servo.mjs';
import { gearFor } from './rotor.mjs';

const after = (run, t0, f, init = 0) => run.t.reduce((a, t, k) => (t >= t0 ? f(a, k) : a), init);
const rms = (run, x, t0 = 1) => Math.sqrt(after(run, t0, (a, k) => a + x[k] ** 2) / after(run, t0, (a) => a + 1));
const peak = (run, x, t0 = 1) => after(run, t0, (a, k) => Math.max(a, Math.abs(x[k])));
const src = (name, unit) => ({ id: name, type: 'source', params: { signal: name, unit }, x: 0, y: 0 });
const sink = (name, unit = '1') => ({ id: `s_${name}`, type: 'sink', params: { name, unit }, x: 0, y: 0 });
const pidCtrl = (variants, Ts = 0.001, variant = 0) => ({ id: 'ctrl', type: 'controller', name: 'controller', params: { inputs: 2, Ts }, x: 0, y: 0, variant, variants });

// A load inertia at the output: τ − τ_ext → 1/JL → ω → θ. ext: the external
// torque's block id (gravity, friction) or null.
const load = (sid, JL, ext) => ({
  blocks: [
    { id: 'tl', type: 'sum', params: { signs: '+-' }, x: 0, y: 0 },
    { id: 'lw', type: 'integrator', name: 'load inertia 1/JL', params: { K: 1 / JL }, x: 0, y: 0 },
    { id: 'lq', type: 'integrator', name: 'load angle', params: { K: 1 }, x: 0, y: 0 },
    ...(ext ? [] : [{ id: 'z', type: 'gain', name: '0', params: { K: 0 }, x: 0, y: 0 }]),
  ],
  wires: [
    { from: sid, to: 'tl' }, { from: 'tl', to: 'lw' }, { from: 'lw', to: 'lq' },
    { from: 'lq', to: `${sid}:1` }, { from: 'lw', to: `${sid}:2` },
    ext ? { from: ext, to: 'tl:1' } : { from: 'lq', to: 'z' }, ...(ext ? [] : [{ from: 'z', to: 'tl:1' }]),
  ],
});

// ---- 1. The joint ----------------------------------------------------------
const G = 107.815, Jm = 200e-6, JL = 2.04, Jr = G * G * Jm;
const COULOMB = { coulomb: true, Tcp: 0.126, Tcn: 0.0709, ws: 2 };
const JOINT = { drive: 'current', R: 2.1, L: 0.001, K: 0.228, b: 0.817e-3, G, imax: 8.77, ...COULOMB };
const GEAR = { Jm, JL, shaft: 'coupled', ...gearFor(50, 0.1, Jr, JL) };
const bq = (G * JOINT.K) / (JL + Jr);
const jointCtrl = (g) => pidCtrl([{ name: 'PID', type: 'pid', params: { Kp: 900 / bq, Ki: (900 / bq) * 5, Kd: 60 / bq, Tf: 0.002, Ka: (JL + Jr) / (G * JOINT.K), Kv: 60 / bq + (G * G * JOINT.b) / (G * JOINT.K), u0: g / (G * JOINT.K), umin: -8.77, umax: 8.77 } }]);
// rigid: the first design (Jm in the mechanism); else the rotor in the motor.
const joint = (P, { rigid = false, g = 35.7 } = {}) => {
  const L = load('servo', rigid ? JL + Jr : JL, 'grav');
  return normalizeDiagram({
    blocks: [src('r', 'rad'), jointCtrl(g), servoMotor('servo', { ...JOINT, ...(rigid ? {} : GEAR), ...P }), ...L.blocks,
      { id: 'grav', type: 'fcn', name: 'gravity', params: { expr: `${g}*cos(u)` }, x: 0, y: 0 },
      { id: 'esum', type: 'sum', params: { signs: '+-' }, x: 0, y: 0 }, sink('tau', 'N·m'), sink('e', 'rad')],
    wires: [{ from: 'r', to: 'ctrl' }, { from: 'servo:1', to: 'ctrl:1' }, { from: 'ctrl', to: 'servo' }, ...L.wires,
      { from: 'lq', to: 'grav' }, { from: 'servo', to: 's_tau' }, { from: 'r', to: 'esum' }, { from: 'lq', to: 'esum:1' }, { from: 'esum', to: 's_e' }],
  });
};
const sine = { r: { period: 5, components: [{ type: 'sine', params: { amplitude: 0.3, time: 0, frequency: 0.5, phase: 0 } }] } };
const sim = { duration: 5, sampleTime: 0.0005 };
const ARCMIN = Math.PI / (180 * 60);
const REAL = { // realistic sizes, not exaggerated (research/servo.md §1–2)
  ripple: true, orders: [{ k: 6, A: 0.02 }],                      // 1 % of K·imax
  encErrors: true, errors: [{ k: 1, A: 20 / 3600 * Math.PI / 180, phase: 0.5 }, { k: 2, A: 10 / 3600 * Math.PI / 180, phase: 1 }],   // 20″ and 10″ at the motor
  counts: true, N: 1000, currentLoop: true, tauc: 1 / (2 * Math.PI * 400), torqueNoise: true, torqueStd: 0.002, torqueSeed: 7,
};
const rigid = simulateSystem(joint({}, { rigid: true }), sine, sim);
const rows = [];
const add = (label, run, ref = rigid) => {
  const dt = run.signals.tau.map((v, k) => v - ref.signals.tau[k]);
  rows.push({ case: label, substeps: run.info.substeps, 'rms τ': rms(run, run.signals.tau), 'rms Δτ': rms(run, dt), 'peak Δτ': peak(run, dt), 'rms e (mrad)': 1000 * rms(run, run.signals.e), 'peak e (mrad)': 1000 * peak(run, run.signals.e) });
  return run;
};
add('rigid, Coulomb (first design)', rigid);
const elastic = add('elastic 50 Hz, Coulomb (the default)', simulateSystem(joint({}), sine, sim));
for (const am of [3, 15]) add(`+ backlash ${am}′, gravity 35.7 N·m`, simulateSystem(joint({ backlash: true, beta: am * ARCMIN }), sine, sim), elastic);
const noG = simulateSystem(joint({}, { g: 0 }), sine, sim);
add('elastic, no gravity (as joint 1)', noG, elastic);
for (const am of [3, 15]) add(`+ backlash ${am}′, no gravity`, simulateSystem(joint({ backlash: true, beta: am * ARCMIN }, { g: 0 }), sine, sim), noG);
add('elastic + realistic ripple, encoder, counts, current loop, noise', simulateSystem(joint(REAL), sine, sim), elastic);
console.log(`Joint: PUMA joint 2's motor, G ${G}, rotor G²·Jm ${Jr.toFixed(2)} + link ${JL} kg·m²; gear k ${GEAR.k.toExponential(3)} N·m/rad, c ${GEAR.c.toFixed(1)} N·m·s/rad (50 Hz, ζ 0.1). Δτ against the row's reference (the rigid run, the elastic run, or the elastic run without gravity). From 1 s on.`);
console.table(rows);

// ---- 2. The backlash example -------------------------------------------------
// A small motor on a current drive (5 A) turns a load arm (no gravity)
// through a 20:1 gearhead with 1° of play. The controller holds the load's angle (an encoder on the
// load); the reference steps 0 → 1 rad → 0. Signals: the load angle, the
// motor angle through the gear (θm/G), the gear's deflection δ and torque τ.
const BL = { drive: 'current', imax: 5, R: 1, L: 0.001, K: 0.05, b: 1e-5, G: 20, Jm: 2e-5, shaft: 'coupled' };
const BJL = 0.01, BJr = BL.G * BL.G * BL.Jm;
Object.assign(BL, { JL: BJL, ...gearFor(50, 0.1, BJr, BJL) });
const beta = Math.PI / 180;
export let VARIANTS = [
  // For 30 rad/s on b = K·G/(Jr + JL) = 55.6 rad/s² per A: Kp = ω²/b, Kd = 1.4·ω/b, Ki = 6·Kp.
  { name: 'PID', type: 'pid', params: { Kp: 16, Ki: 100, Kd: 0.76, Tf: 0.003, umin: -5, umax: 5 } },
  { name: 'PD', type: 'pid', params: { Kp: 16, Kd: 0.76, Tf: 0.003, umin: -5, umax: 5 } },
];
const square = { r: { period: 5, components: [{ type: 'square', params: { amplitude: 1, time: 0.25, width: 1.25, period: 2.5, count: 0 } }] } };
// feedback: 'load' (an encoder on the load) or 'motor' (the motor's encoder, θm/G).
const backlashSystem = (P, variant, feedback = 'load') => {
  const L = load('servo', BJL, null);
  return normalizeDiagram({
    blocks: [src('r', 'rad'), pidCtrl(VARIANTS, 0.001, variant), servoMotor('servo', { ...BL, ...P }), ...L.blocks,
      sink('theta_L', 'rad'), sink('theta_m', 'rad'), sink('tau', 'N·m'), sink('V', 'V'), { id: 'esum', type: 'sum', params: { signs: '+-' }, x: 0, y: 0 }, sink('e', 'rad')],
    wires: [{ from: 'r', to: 'ctrl' }, { from: feedback === 'load' ? 'lq' : 'servo:1', to: 'ctrl:1' }, { from: 'ctrl', to: 'servo' }, ...L.wires,
      { from: 'lq', to: 's_theta_L' }, { from: 'servo:1', to: 's_theta_m' }, { from: 'servo', to: 's_tau' }, { from: 'ctrl', to: 's_V' },
      { from: 'r', to: 'esum' }, { from: 'lq', to: 'esum:1' }, { from: 'esum', to: 's_e' }],
  });
};
const bsim = { duration: 5, sampleTime: 0.0005 };
const holds = [[1.0, 1.5], [2.25, 2.75], [3.5, 4.0], [4.75, 5.0]];   // the last half of each hold
const inHold = (t) => holds.some(([a, b]) => t >= a && t < b);
// Per hold: the load error's peak to peak (a limit cycle if it stays), its
// largest size, and how often the gear's torque changes sign (the flanks
// knocking: 2 per cycle of hunting).
const holdStats = (run) => {
  let pp = 0, eMax = 0, n = 0, flips = 0;
  for (const [a, b] of holds) {
    let lo = Infinity, hi = -Infinity, last = 0;
    for (let k = 0; k < run.t.length; k++) if (run.t[k] >= a && run.t[k] < b) {
      const e = run.signals.e[k]; lo = Math.min(lo, e); hi = Math.max(hi, e); eMax = Math.max(eMax, Math.abs(e)); n++;
      const tq = run.signals.tau[k], sg = Math.abs(tq) > 1e-3 ? Math.sign(tq) : 0;
      if (sg && last && sg !== last) flips++; if (sg) last = sg;
    }
    pp = Math.max(pp, hi - lo);
  }
  return { 'e p-p within a hold (mrad)': 1000 * pp, 'largest |e| in holds (mrad)': 1000 * eMax, 'τ sign changes per s': flips / (n * bsim.sampleTime) };
};
const brows = [];
for (const [label, P, v, fb] of [
  ['PID, load encoder, no backlash', {}, 0, 'load'],
  ['PID, load encoder, backlash 1°', { backlash: true, beta }, 0, 'load'],
  ['PD, load encoder, backlash 1°', { backlash: true, beta }, 1, 'load'],
  ['PID, motor encoder, no backlash', {}, 0, 'motor'],
  ['PID, motor encoder, backlash 1°', { backlash: true, beta }, 0, 'motor'],
  ['PID, load encoder, backlash 0.25°', { backlash: true, beta: beta / 4 }, 0, 'load'],
]) {
  const run = simulateSystem(backlashSystem(P, v, fb), square, bsim);
  // the load's lag behind the motor at the reversals: θm/G − θ_L when the gear carries no torque.
  brows.push({ case: label, substeps: run.info.substeps, ...holdStats(run), 'peak |θm/G − θ_L| (mrad)': 1000 * peak(run, run.signals.theta_m.map((v, k) => v - run.signals.theta_L[k]), 0) });
}
console.log(`\nBacklash example: motor G ${BL.G}, rotor G²·Jm ${BJr} + load ${BJL} kg·m², gear k ${BL.k.toFixed(1)} N·m/rad, c ${BL.c.toFixed(4)} (50 Hz, ζ 0.1), play 1° = ${(1000 * beta).toFixed(2)} mrad; r steps 0 ↔ 1 rad every 1.25 s. Holds: the last 0.5 s of each.`);
console.table(brows);
