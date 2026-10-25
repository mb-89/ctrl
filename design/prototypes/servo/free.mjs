// The rotor in the motor, free shaft: the four motor systems and the encoder
// example with the rotor's inertia inside the Servo motor and the load as a
// torque (no Shaft outside), against main.
//   node design/prototypes/servo/free.mjs
import { SYSTEM_LIBRARY, SYSTEM_PARTS, applySystem } from '../../../src/core/systems.js';
import { normalizeProject, evaluateSystem, autoTimebase } from '../../../src/core/project.js';
import { servoMotor } from './servo.mjs';
import { ENCODER_SERVO } from './encoder.mjs';

const run = (entry, diagram) => {
  const e = diagram ? { ...entry, plant: { ...entry.plant, diagram } } : entry;
  const p = normalizeProject(applySystem(normalizeProject({}), e, SYSTEM_PARTS.filter((k) => e[k])));
  p.scope.timebase = autoTimebase(p);
  return evaluateSystem(p);
};
const worst = (a, b) => Object.keys(a.signals).filter((k) => !k.includes('.') && k in b.signals).map((k) => {
  let d = 0, m = 0; for (let i = 0; i < a.t.length; i++) { d = Math.max(d, Math.abs(a.signals[k][i] - b.signals[k][i])); m = Math.max(m, Math.abs(a.signals[k][i])); }
  return [k, m ? d / m : 0];
}).sort((x, y) => y[1] - x[1])[0];
const zero = { id: 'z', type: 'gain', name: 'no load', params: { K: 0 }, x: 0, y: 0 };

for (const entry of SYSTEM_LIBRARY.filter((e) => e.plant.diagram.blocks.some((b) => b.id === 'motor' && b.diagram?.blocks.some((x) => x.id === 'rotor')))) {
  const old = entry.plant.diagram, three = old.blocks.some((b) => b.id === 'esum');
  const d = {
    blocks: [...old.blocks.filter((b) => ['r', 'd', 'ctrl', 'angle', 'speed', 'V', 'esum', 'e'].includes(b.id)), servoMotor('servo', { R: 1, L: 0.01, K: 0.5, b: 0.1, Jm: 0.02, shaft: 'free' })],
    wires: [
      { from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'servo' }, { from: 'ctrl', to: 'V' }, { from: 'd', to: 'servo:1' },
      { from: 'servo:1', to: 'ctrl:1' }, { from: 'servo:1', to: 'angle' }, { from: 'servo:3', to: 'speed' },
      ...(three ? [{ from: 'servo:2', to: 'ctrl:2' }, { from: 'r', to: 'esum' }, { from: 'servo:1', to: 'esum:1' }, { from: 'esum', to: 'e' }] : []),
    ],
  };
  const variants = old.blocks.find((b) => b.id === 'ctrl').variants;
  for (let v = 0; v < variants.length; v++) {
    const pick = (dd) => ({ ...dd, blocks: dd.blocks.map((b) => (b.id === 'ctrl' ? { ...b, variant: v } : b)) });
    const a = run(entry, pick(old)), b = run(entry, pick(d)), [k, r] = worst(a, b);
    console.log(`${entry.name} · ${variants[v].name}: worst ${k}, relative ${r.toExponential(2)}, substeps ${b.info.substeps}/${a.info.substeps}`);
  }
}
{
  const entry = SYSTEM_LIBRARY.find((e) => e.name === 'Encoder errors and torque ripple');
  const keep = entry.plant.diagram.blocks.filter((b) => ['r', 'ctrl', 'speed_m', 'speed', 'V'].includes(b.id));
  const d = {
    blocks: [...keep, zero, servoMotor('servo', { ...ENCODER_SERVO, Jm: 0.001, shaft: 'free' })],
    wires: [{ from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'servo' }, { from: 'ctrl', to: 'V' }, { from: 'r', to: 'z' }, { from: 'z', to: 'servo:1' },
      { from: 'servo:2', to: 'ctrl:1' }, { from: 'servo:2', to: 'speed_m' }, { from: 'servo:3', to: 'speed' }],
  };
  const a = run(entry), b = run(entry, d), [k, r] = worst(a, b);
  let x = 0, n = 0; for (let i = 0; i < b.t.length; i++) if (b.t[i] >= 0.5) { x += (b.signals.r[i] - b.signals.speed[i]) ** 2; n++; }
  console.log(`Encoder errors and torque ripple: worst ${k}, relative ${r.toExponential(2)}, substeps ${b.info.substeps}/${a.info.substeps}, rms speed error ${Math.sqrt(x / n)}`);
}
