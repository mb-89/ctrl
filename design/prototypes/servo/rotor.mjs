// The rotor in the motor (input 20): the motor examples and the encoder
// example with the rotor's inertia inside the Servo motor and an elastic gear
// at non-problematic values, against main; and the PUMA-like joint, rigid
// (the first design) against elastic.
//   node design/prototypes/servo/rotor.mjs
import { SYSTEM_LIBRARY, SYSTEM_PARTS, applySystem } from '../../../src/core/systems.js';
import { normalizeProject, evaluateSystem, autoTimebase } from '../../../src/core/project.js';
import { servoMotor, shaft } from './servo.mjs';
import { ENCODER_SERVO } from './encoder.mjs';

const TWO_PI = 2 * Math.PI;
// k and c for a two-mass resonance fr (Hz) with damping ζ, rotor Jr = G²·Jm
// and load JL at the output: ωr² = k·(1/Jr + 1/JL), 2ζωr = c·(1/Jr + 1/JL).
export const gearFor = (fr, zeta, Jr, JL) => { const s = 1 / Jr + 1 / JL, w = TWO_PI * fr; return { k: (w * w) / s, c: (2 * zeta * w) / s }; };

const load = (entry, diagram) => {
  const e = diagram ? { ...entry, plant: { ...entry.plant, diagram } } : entry;
  const p = normalizeProject(applySystem(normalizeProject({}), e, SYSTEM_PARTS.filter((k) => e[k])));
  p.scope.timebase = autoTimebase(p);
  return p;
};
const timed = (p) => { const t0 = performance.now(); let r; for (let i = 0; i < 3; i++) r = evaluateSystem(p); return { r, ms: (performance.now() - t0) / 3 }; };
const worst = (a, b, names) => names.map((k) => {
  let d = 0, m = 0; for (let i = 0; i < a.t.length; i++) { d = Math.max(d, Math.abs(a.signals[k][i] - b.signals[k][i])); m = Math.max(m, Math.abs(a.signals[k][i])); }
  return `${k} ${d.toExponential(2)} (${(100 * d / m).toFixed(3)} % of its peak)`;
}).join(', ');

if (import.meta.url === `file://${process.argv[1]}`) {
// 1. The motor examples: J 0.02 split into rotor 0.01 and load 0.01; the gear at 100 Hz, ζ 0.1.
const MOTOR = { R: 1, L: 0.01, K: 0.5, b: 0.1, Jm: 0.01, JL: 0.01, ...gearFor(100, 0.1, 0.01, 0.01) };
console.log(`Motor examples: rotor 0.01 + load 0.01 kg·m², gear k ${MOTOR.k.toFixed(0)} N·m/rad, c ${MOTOR.c.toFixed(3)} N·m·s/rad (100 Hz, ζ 0.1)`);
for (const entry of SYSTEM_LIBRARY.filter((e) => e.plant.diagram.blocks.some((b) => b.id === 'motor' && b.diagram?.blocks.some((x) => x.id === 'rotor')))) {
  const old = entry.plant.diagram, three = old.blocks.some((b) => b.id === 'esum');
  const s = shaft('servo', MOTOR.JL, 'd');
  const d = {
    blocks: [...old.blocks.filter((b) => ['r', 'd', 'ctrl', 'angle', 'speed', 'V', 'esum', 'e'].includes(b.id)), servoMotor('servo', MOTOR), ...s.blocks],
    wires: [
      { from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'servo' }, { from: 'ctrl', to: 'V' }, ...s.wires,
      { from: 'servo:1', to: 'ctrl:1' }, { from: 'servo:1', to: 'angle' }, { from: 'servo:2', to: 'speed' },
      ...(three ? [{ from: 'servo:2', to: 'ctrl:2' }, { from: 'r', to: 'esum' }, { from: 'servo:1', to: 'esum:1' }, { from: 'esum', to: 'e' }] : []),
    ],
  };
  const variants = old.blocks.find((b) => b.id === 'ctrl').variants;
  for (let v = 0; v < variants.length; v++) {
    const pick = (dd) => ({ ...dd, blocks: dd.blocks.map((b) => (b.id === 'ctrl' ? { ...b, variant: v } : b)) });
    const a = timed(load(entry, pick(old))), b = timed(load(entry, pick(d)));
    console.log(`  ${entry.name} · ${variants[v].name}: ${worst(a.r, b.r, ['angle', 'speed', 'V', 'i'])}; substeps ${b.r.info.substeps}/${a.r.info.substeps}, ${b.ms.toFixed(0)}/${a.ms.toFixed(0)} ms`);
  }
}

// 2. The encoder example: J 0.001 split in two halves; the gear at 500 Hz, ζ 0.1
// (above the record's 200 Hz Nyquist frequency, out of the spectrogram).
{
  const entry = SYSTEM_LIBRARY.find((e) => e.name === 'Encoder errors and torque ripple');
  const P = { ...ENCODER_SERVO, Jm: 0.0005, JL: 0.0005, ...gearFor(500, 0.1, 0.0005, 0.0005) };
  const s = shaft('servo', P.JL, null);
  const keep = entry.plant.diagram.blocks.filter((b) => ['r', 'ctrl', 'speed_m', 'speed', 'V'].includes(b.id));
  const d = {
    blocks: [...keep, servoMotor('servo', P), ...s.blocks],
    wires: [{ from: 'r', to: 'ctrl' }, { from: 'ctrl', to: 'servo' }, { from: 'ctrl', to: 'V' }, ...s.wires,
      { from: 'servo:2', to: 'ctrl:1' }, { from: 'servo:2', to: 'speed_m' }, { from: 'gv', to: 'speed' }].filter((w) => w.from !== 'gv'),
  };
  // speed: the motor's true speed, as main's "speed" is the rotor's. Read it through a Sink inside.
  const a = timed(load(entry)), b = timed(load(entry, d));
  const rms = (run, sp) => { let x = 0, n = 0; for (let k = 0; k < run.t.length; k++) if (run.t[k] >= 0.5) { x += (run.signals.r[k] - sp[k]) ** 2; n++; } return Math.sqrt(x / n); };
  console.log(`\nEncoder example, rotor 0.0005 + load 0.0005, gear k ${P.k.toFixed(0)}, c ${P.c.toFixed(4)} (500 Hz, ζ 0.1):`);
  console.log(`  ${worst(a.r, b.r, ['speed_m', 'V'])}; rms of r − speed_m after 0.5 s: ${rms(b.r, b.r.signals.speed_m).toFixed(4)} against ${rms(a.r, a.r.signals.speed_m).toFixed(4)}; substeps ${b.r.info.substeps}/${a.r.info.substeps}, ${b.ms.toFixed(0)}/${a.ms.toFixed(0)} ms`);
}
}
