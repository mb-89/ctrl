// Where the 2·10⁻¹² comes from: put the viscous friction back into the
// rotor's transfer function 1/(J·s + b), as main has it, and the rebuilt
// example is main's bit for bit. So the only difference is that the Servo
// motor owns its friction (−b·ωm into the torque sum) and the shaft is a pure
// inertia: the same equation, its floating-point operations in another order.
//   node design/prototypes/servo/why.mjs
import { SYSTEM_LIBRARY, SYSTEM_PARTS, applySystem } from '../../../src/core/systems.js';
import { normalizeProject, evaluateSystem, autoTimebase } from '../../../src/core/project.js';
import { ENCODER_SERVO, rebuilt } from './encoder.mjs';

const entry = SYSTEM_LIBRARY.find((e) => e.name === 'Encoder errors and torque ripple');
const run = (diagram) => {
  const e = diagram ? { ...entry, plant: { ...entry.plant, diagram } } : entry;
  const p = normalizeProject(applySystem(normalizeProject({}), e, SYSTEM_PARTS.filter((k) => e[k])));
  p.scope.timebase = autoTimebase(p);
  return evaluateSystem(p);
};
const d = rebuilt({ ...ENCODER_SERVO, b: 0 });
const rotor = d.blocks.find((b) => b.id === 'rotor');
Object.assign(rotor, { type: 'tf', params: { num: [1], den: [0.001, 0.005], delay: 0 } });
const a = run(), b = run(d);
for (const k of ['speed_m', 'speed', 'V']) {
  let same = true;
  for (let i = 0; i < a.t.length; i++) if (!Object.is(a.signals[k][i], b.signals[k][i])) { same = false; break; }
  console.log(k, same ? 'bit for bit' : 'differs');
}
