// Rebuilds "Encoder errors and torque ripple" from the Servo motor prototype
// and compares every signal with main's example, run the same way the page
// runs it (normalizeProject, applySystem, autoTimebase, evaluateSystem).
//   node design/prototypes/servo/encoder.mjs
import { SYSTEM_LIBRARY, SYSTEM_PARTS, applySystem } from '../../../src/core/systems.js';
import { normalizeProject, evaluateSystem, autoTimebase } from '../../../src/core/project.js';
import { servoMotor, shaft } from './servo.mjs';

// The example's numbers, as physical inputs (main has them as K and τ of two
// first-order blocks: armature K 1, τ 2 ms; "inertia and friction" K 200, τ 0.2 s).
export const ENCODER_SERVO = {
  drive: 'voltage', R: 1, L: 0.002, K: 0.1, b: 0.005, G: 1,
  ripple: true, orders: [{ k: 6, A: 0.05 }],
  torqueNoise: true, torqueStd: 0.02, torqueSeed: 7,
  coupling: true, wc: 439.8, zc: 0.02,
  encErrors: true, errors: [{ k: 1, A: 0.02, phase: 0.5 }, { k: 2, A: 0.01, phase: 1 }],
  speedFromAngle: true, Tf: 0.001,
};
const J = 0.001;   // rotor and load: τ = J/b = 0.2 s, 1/b = 200 rad/s per N·m

const entry = SYSTEM_LIBRARY.find((e) => e.name === 'Encoder errors and torque ripple');
const load = (diagram) => {
  const e = diagram ? { ...entry, plant: { ...entry.plant, diagram } } : entry;
  const p = normalizeProject(applySystem(normalizeProject({}), e, SYSTEM_PARTS.filter((k) => e[k])));
  p.scope.timebase = autoTimebase(p);
  return p;
};

export function rebuilt(P = ENCODER_SERVO, opts = {}) {
  const old = entry.plant.diagram;
  const keep = old.blocks.filter((b) => ['r', 'ctrl', 'speed_m', 'speed', 'V'].includes(b.id));
  const s = shaft('servo', J, null);
  return {
    blocks: [...keep, servoMotor('servo', P, opts), ...s.blocks],
    wires: [
      { from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'servo' }, { from: 'ctrl', to: 'V' },
      ...s.wires,
      { from: 'servo:2', to: 'ctrl:1' }, { from: 'servo:2', to: 'speed_m' }, { from: 'rotor', to: 'speed' },
    ],
  };
}

const compare = (a, b) => {
  const rows = [];
  for (const name of Object.keys(a.signals)) {
    if (!(name in b.signals) || name.includes('.')) continue;
    const x = a.signals[name], y = b.signals[name];
    let d = 0, m = 0;
    for (let k = 0; k < x.length; k++) { d = Math.max(d, Math.abs(x[k] - y[k])); m = Math.max(m, Math.abs(x[k])); }
    rows.push({ signal: name, maxAbsDiff: d, maxAbs: m, relative: m ? d / m : 0 });
  }
  return rows;
};
const rmsErr = (run) => { let a = 0, n = 0; for (let k = 0; k < run.t.length; k++) if (run.t[k] >= 0.5) { a += (run.signals.r[k] - run.signals.speed[k]) ** 2; n++; } return Math.sqrt(a / n); };

if (import.meta.url === `file://${process.argv[1]}`) {
  const main = evaluateSystem(load());
  for (const [label, opts] of [['switches resolved at compile time', {}], ['Switch blocks compiled', { switches: true }]]) {
    const run = evaluateSystem(load(rebuilt(ENCODER_SERVO, opts)));
    console.log(`\n${label}: substeps ${run.info.substeps} (main ${main.info.substeps}), samples ${run.t.length}`);
    console.table(compare(main, run));
    console.log('rms speed error after 0.5 s:', rmsErr(run), '(main', rmsErr(main), ')');
  }
}
