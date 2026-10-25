// Two uses of the same Servo motor prototype:
// 1. "DC motor, position control" rebuilt (voltage drive, position loop),
//    compared with main's example signal by signal.
// 2. A robot-like joint: PUMA 560 joint 2's motor data (research/robot.md §3),
//    geared 107.8:1, current drive, one link with gravity; switches off, then
//    each switch alone, then all on: the joint torque τ and the path error.
//   node design/prototypes/servo/joint.mjs
import { SYSTEM_LIBRARY, SYSTEM_PARTS, applySystem } from '../../../src/core/systems.js';
import { normalizeProject, evaluateSystem, autoTimebase } from '../../../src/core/project.js';
import { simulateSystem } from '../../../src/core/sim.js';
import { normalizeDiagram } from '../../../src/core/diagram.js';
import { servoMotor, shaft } from './servo.mjs';

const runEntry = (name, diagram) => {
  const entry = SYSTEM_LIBRARY.find((e) => e.name === name);
  const e = diagram ? { ...entry, plant: { ...entry.plant, diagram } } : entry;
  const p = normalizeProject(applySystem(normalizeProject({}), e, SYSTEM_PARTS.filter((k) => e[k])));
  p.scope.timebase = autoTimebase(p);
  return { run: evaluateSystem(p), entry };
};
const maxDiff = (a, b) => Object.keys(a.signals).filter((k) => !k.includes('.') && k in b.signals).map((k) => {
  let d = 0, m = 0, same = true;
  for (let i = 0; i < a.t.length; i++) { const x = a.signals[k][i], y = b.signals[k][i]; d = Math.max(d, Math.abs(x - y)); m = Math.max(m, Math.abs(x)); if (!Object.is(x, y)) same = false; }
  return { signal: k, maxAbsDiff: d, relative: m ? d / m : 0, bitForBit: same };
});

// 1. DC motor, position control: R 1 Ω, L 10 mH, K 0.5, J 0.02, b 0.1.
{
  const name = 'DC motor, position control';
  const { run: main, entry } = runEntry(name);
  const old = entry.plant.diagram;
  const s = shaft('servo', 0.02, 'd');
  const d = {
    blocks: [...old.blocks.filter((b) => ['r', 'd', 'ctrl', 'angle', 'speed', 'V'].includes(b.id)), servoMotor('servo', { R: 1, L: 0.01, K: 0.5, b: 0.1 }), ...s.blocks],
    wires: [
      { from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'servo' }, { from: 'ctrl', to: 'V' }, ...s.wires,
      { from: 'servo:1', to: 'ctrl:1' }, { from: 'servo:1', to: 'angle' }, { from: 'rotor', to: 'speed' },
    ],
  };
  const { run } = runEntry(name, d);
  console.log(`\n${name}, rebuilt (every switch off): substeps ${run.info.substeps} (main ${main.info.substeps})`);
  console.table(maxDiff(main, run));
}

// 2. The joint. Link side: J = link 2.04 + G²·Jm 2.32 kg·m² (the rotor's
// reflected inertia belongs to the mechanism), gravity 35.7·cos q N·m.
const G = 107.815, Jm = 200e-6, JL = 2.04, J = JL + G * G * Jm;
const JOINT = { drive: 'current', R: 2.1, L: 0.001, K: 0.228, b: 0.817e-3, G, imax: 8.77 };
const SWITCHES = {
  coulomb: { coulomb: true, Tcp: 0.126, Tcn: 0.0709, ws: 2 },
  ripple: { ripple: true, orders: [{ k: 6, A: 0.02 }] },             // 1 % of K·imax at the motor, 6× per motor turn
  torqueNoise: { torqueNoise: true, torqueStd: 0.005, torqueSeed: 7 },
  currentLoop: { currentLoop: true, tauc: 1 / (2 * Math.PI * 400) },  // the Unimate's 400 Hz
  encErrors: { encErrors: true, errors: [{ k: 1, A: 0.002, phase: 0.5 }, { k: 2, A: 0.001, phase: 1 }] },
  counts: { counts: true, N: 1000 },
};
const ALL = Object.assign({}, ...Object.values(SWITCHES));
// Position PID on the measured angle, i* out; gains for 30 rad/s with
// b = G·K/J = 5.64 rad/s² per A: Kp = ω²/b, Kd = 2ω/b; u0 holds gravity at q = 0.
// The D part acts on the measurement, so Kv = Kd (plus the viscous share) and
// Ka = J/(G·K) feed the reference's speed and acceleration forward.
const bq = (G * JOINT.K) / J;
const ctrl = { id: 'ctrl', type: 'controller', name: 'controller', params: { inputs: 2, Ts: 0.001 }, x: 0, y: 0, variant: 0,
  variants: [{ name: 'PID', type: 'pid', params: { Kp: 900 / bq, Ki: 900 / bq * 5, Kd: 60 / bq, Tf: 0.002, Ka: J / (G * JOINT.K), Kv: 60 / bq + (G * G * JOINT.b) / (G * JOINT.K), u0: 35.7 / (G * JOINT.K), umin: -8.77, umax: 8.77 } }] };
const joint = (P, opts = {}) => {
  const s = shaft('servo', J, 'grav');
  return normalizeDiagram({
    blocks: [
      { id: 'r', type: 'source', params: { signal: 'r', unit: 'rad' }, x: 0, y: 0 }, ctrl,
      servoMotor('servo', { ...JOINT, ...P }, opts), ...s.blocks,
      { id: 'grav', type: 'fcn', name: 'gravity m·g·l·cos q', params: { expr: '35.7*cos(u)' }, x: 0, y: 0 },
      { id: 'esum', type: 'sum', params: { signs: '+-' }, x: 0, y: 0 },
      ...['tau', 'q', 'e', 'istar'].map((n) => ({ id: `s_${n}`, type: 'sink', params: { name: n }, x: 0, y: 0 })),
    ],
    wires: [
      { from: 'r', to: 'ctrl' }, { from: 'servo:1', to: 'ctrl:1' }, { from: 'ctrl', to: 'servo' }, ...s.wires,
      { from: 'int', to: 'grav' }, { from: 'servo', to: 's_tau' }, { from: 'int', to: 's_q' }, { from: 'ctrl', to: 's_istar' },
      { from: 'r', to: 'esum' }, { from: 'int', to: 'esum:1' }, { from: 'esum', to: 's_e' },
    ],
  });
};
const signals = { r: { period: 5, components: [{ type: 'sine', params: { amplitude: 0.3, time: 0, frequency: 0.5, phase: 0 } }] } };
const sim = { duration: 5, sampleTime: 0.0005 };
const after = (run, f) => run.t.reduce((a, t, k) => (t >= 1 ? f(a, k) : a), 0);
const rms = (run, x) => Math.sqrt(after(run, (a, k) => a + x[k] ** 2) / after(run, (a) => a + 1));
const peak = (run, x) => after(run, (a, k) => Math.max(a, Math.abs(x[k])));
const off = simulateSystem(joint({}), signals, sim);
const rows = [];
for (const [label, P] of [['all off', {}], ...Object.entries(SWITCHES).map(([k, v]) => [`${k} only`, v]), ['all on', ALL]]) {
  const run = label === 'all off' ? off : simulateSystem(joint(P), signals, sim);
  const dtau = run.signals.tau.map((v, k) => v - off.signals.tau[k]);
  rows.push({ case: label, substeps: run.info.substeps, 'rms τ (N·m)': rms(run, run.signals.tau), 'rms Δτ vs off': rms(run, dtau), 'peak Δτ': peak(run, dtau),
    'rms e (mrad)': 1000 * rms(run, run.signals.e), 'peak e (mrad)': 1000 * peak(run, run.signals.e), 'peak i* (A)': peak(run, run.signals.istar) });
}
console.log(`\nRobot-like joint (PUMA joint 2 motor, G ${G}, J ${J.toFixed(3)} kg·m², current drive), r = 0.3 sin(2π·0.5 t) rad, from 1 s on:`);
console.table(rows);
// Where the 6× ripple sits: per joint turn 6·G; at the peak joint speed 0.3·π rad/s.
console.log(`6× motor ripple at the joint's peak speed: ${(6 * G * 0.3 * Math.PI / (2 * Math.PI)).toFixed(1)} Hz; link-side amplitude ${(G * 0.02).toFixed(2)} N·m. One count at the joint: ${(2 * Math.PI / 1000 / G * 1e6).toFixed(1)} µrad.`);

// Neutral values: every switch on, its size at the neutral value, against
// every switch off. The encoder's counts have no neutral value (N → ∞) and
// stay off; the Switch blocks, all off, are the third case.
const NEUTRAL = { ...ALL, Tcp: 0, Tcn: 0, orders: [{ k: 6, A: 0 }], torqueStd: 0, tauc: 0, errors: [{ k: 1, A: 0, phase: 0.5 }, { k: 2, A: 0, phase: 1 }], counts: false };
const same = (a, b) => Object.keys(a.signals).every((k) => a.signals[k].every((v, i) => Object.is(v, b.signals[k][i])));
console.log('\nswitches on at neutral values, against all off: bit for bit', same(off, simulateSystem(joint(NEUTRAL), signals, sim)));
const built = simulateSystem(joint({}, { switches: true }), signals, sim);
console.log('Switch blocks built, all off, against all off: bit for bit', same(off, built), `(substeps ${built.info.substeps} against ${off.info.substeps}: the unused branches' poles set the step)`);
