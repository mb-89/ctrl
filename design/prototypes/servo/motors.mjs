// The four systems built on main's motorDiagram, rebuilt on the Servo motor
// prototype with every switch off: each signal's largest difference.
//   node design/prototypes/servo/motors.mjs
import { SYSTEM_LIBRARY, SYSTEM_PARTS, applySystem } from '../../../src/core/systems.js';
import { normalizeProject, evaluateSystem, autoTimebase } from '../../../src/core/project.js';
import { servoMotor, shaft } from './servo.mjs';

const run = (entry, diagram) => {
  const e = diagram ? { ...entry, plant: { ...entry.plant, diagram } } : entry;
  const p = normalizeProject(applySystem(normalizeProject({}), e, SYSTEM_PARTS.filter((k) => e[k])));
  p.scope.timebase = autoTimebase(p);
  return evaluateSystem(p);
};
for (const entry of SYSTEM_LIBRARY.filter((e) => e.plant.diagram.blocks.some((b) => b.id === 'motor' && b.diagram?.blocks.some((x) => x.id === 'rotor')))) {
  const old = entry.plant.diagram, three = old.blocks.some((b) => b.id === 'esum');
  const s = shaft('servo', 0.02, 'd');
  const d = {
    blocks: [...old.blocks.filter((b) => ['r', 'd', 'ctrl', 'angle', 'speed', 'V', 'esum', 'e'].includes(b.id)), servoMotor('servo', { R: 1, L: 0.01, K: 0.5, b: 0.1 }), ...s.blocks],
    wires: [
      { from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'servo' }, { from: 'ctrl', to: 'V' }, ...s.wires,
      { from: 'servo:1', to: 'ctrl:1' }, { from: 'servo:1', to: 'angle' }, { from: 'rotor', to: 'speed' },
      ...(three ? [{ from: 'servo:2', to: 'ctrl:2' }, { from: 'r', to: 'esum' }, { from: 'servo:1', to: 'esum:1' }, { from: 'esum', to: 'e' }] : []),
    ],
  };
  const variants = old.blocks.find((b) => b.id === 'ctrl').variants;
  for (let v = 0; v < variants.length; v++) {
    const pick = (dd) => ({ ...dd, blocks: dd.blocks.map((b) => (b.id === 'ctrl' ? { ...b, variant: v } : b)) });
    const a = run(entry, pick(old)), b = run(entry, pick(d));
    const worst = Object.keys(a.signals).filter((k) => !k.includes('.') && k in b.signals).map((k) => {
      let dd = 0, m = 0; for (let i = 0; i < a.t.length; i++) { dd = Math.max(dd, Math.abs(a.signals[k][i] - b.signals[k][i])); m = Math.max(m, Math.abs(a.signals[k][i])); }
      return [k, dd, m ? dd / m : 0];
    }).sort((x, y) => y[2] - x[2])[0];
    console.log(`${entry.name} · ${variants[v].name}: worst ${worst[0]} ${worst[1].toExponential(2)} (relative ${worst[2].toExponential(2)}), substeps ${b.info.substeps}/${a.info.substeps}`);
  }
}
