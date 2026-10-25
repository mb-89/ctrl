// Test fixture (not shipped): the HIL arm as a simulated project, so the
// command line can identify it with a hidden variation (identification.md
// §13, §17): the library's "HIL: an external plant" with its External plant
// replaced by hil_plant.py's physics in blocks (arm.mjs ports the same
// physics line by line; test 17 checks the two agree):
//
//   motor   V, 2 ms late (the round trip) → armature 1/(L·s + R) → current i
//           → Kt → torque; Ke · ω back against V (Kt = Ke = k: one constant,
//           drawn once by the hidden variation, as hil_plant.py draws k once)
//   arm     torque − b·ω − Tc·tanh(ω/ω_eps) − mgl·sin(angle) + load → 1/J
//           → ω → angle (its own subsystem: mgl = k = 0.1 by coincidence, and
//           the variation draws one factor per value and level)
//   sensor  noise σ and a 4096-count encoder on the angle
//
// Run it to print the project: node test/fixtures/arm-project.mjs > arm.json

import { NOMINAL, W_EPS } from './arm.mjs';
import { libraryProject } from './plants.mjs';
import { pathToFileURL } from 'node:url';

const block = (id, type, params, name) => ({ id, type, params, ...(name ? { name } : {}), x: 0, y: 0 });

// The arm's physics as a subsystem with the External block's ports: in V,
// load; out angle (measured), speed, current.
export function armSubsystem(p = NOMINAL, { noise = 0.001, counts = 4096, seed = 1, latency = 0.002 } = {}) {
  const tanh = `sign(u)*(1-exp(-2*abs(u)/${W_EPS}))/(1+exp(-2*abs(u)/${W_EPS}))`;
  const arm = {
    id: 'arm', type: 'subsystem', name: 'arm', params: {}, x: 0, y: 0,
    diagram: {
      blocks: [
        block('torque', 'inport', { port: 1 }), block('load', 'inport', { port: 2 }),
        block('sum', 'sum', { signs: '+---+' }, 'torques'),
        block('b', 'gain', { K: p.b }, 'viscous b'),
        block('fr', 'fcn', { expr: tanh }, 'tanh(ω/ω_eps)'), block('Tc', 'gain', { K: p.Tc }, 'Coulomb Tc'),
        block('sin', 'fcn', { expr: 'sin(u)' }, 'sin'), block('grav', 'gain', { K: p.mgl }, 'gravity'),
        block('invJ', 'gain', { K: 1 / p.J }, '1/J'),
        block('wi', 'integrator', { K: 1 }, 'ω'), block('ai', 'integrator', { K: 1 }, 'angle'),
        block('w', 'outport', { port: 1 }, 'ω'), block('a', 'outport', { port: 2 }, 'angle'),
      ],
      wires: [
        { from: 'torque', to: 'sum' }, { from: 'b', to: 'sum:1' }, { from: 'Tc', to: 'sum:2' }, { from: 'grav', to: 'sum:3' }, { from: 'load', to: 'sum:4' },
        { from: 'sum', to: 'invJ' }, { from: 'invJ', to: 'wi' }, { from: 'wi', to: 'ai' },
        { from: 'wi', to: 'b' }, { from: 'wi', to: 'fr' }, { from: 'fr', to: 'Tc' }, { from: 'ai', to: 'sin' }, { from: 'sin', to: 'grav' },
        { from: 'wi', to: 'w' }, { from: 'ai', to: 'a' },
      ],
    },
  };
  const blocks = [
    block('V', 'inport', { port: 1 }), block('load', 'inport', { port: 2 }),
    block('late', 'delay', { L: latency, y0: 0 }, 'round trip'),
    block('emf', 'sum', { signs: '+-' }),
    block('arm_tf', 'tf', { num: [1], den: [p.L, p.R], delay: 0 }, 'armature 1/(Ls + R)'),
    block('kt', 'gain', { K: p.k }, 'Kt (= Ke)'), block('ke', 'gain', { K: p.k }, 'Ke (= Kt)'),
    arm,
    block('angle', 'outport', { port: 1 }, 'angle'), block('speed', 'outport', { port: 2 }, 'speed'), block('current', 'outport', { port: 3 }, 'current'),
  ];
  const wires = [
    { from: 'V', to: 'late' }, { from: 'late', to: 'emf' }, { from: 'ke', to: 'emf:1' }, { from: 'emf', to: 'arm_tf' }, { from: 'arm_tf', to: 'kt' },
    { from: 'kt', to: 'arm' }, { from: 'load', to: 'arm:1' }, { from: 'arm', to: 'ke' }, { from: 'arm', to: 'speed' }, { from: 'arm_tf', to: 'current' },
  ];
  let last = 'arm:1';
  if (noise > 0) { blocks.push(block('noise', 'noise', { std: noise, seed }, 'noise')); wires.push({ from: last, to: 'noise' }); last = 'noise'; }
  if (counts > 0) { blocks.push(block('enc', 'quantizer', { q: (2 * Math.PI) / counts }, 'encoder')); wires.push({ from: last, to: 'enc' }); last = 'enc'; }
  wires.push({ from: last, to: 'angle' });
  return { id: 'motor', type: 'subsystem', name: 'motor', params: {}, x: 340, y: 96, diagram: { blocks, wires } };
}

// The HIL arm's project, simulated: the External plant replaced by the arm.
export function armProject(p = NOMINAL, opts = {}) {
  const project = libraryProject('HIL: an external plant');
  const d = project.system.plant.diagram;
  const i = d.blocks.findIndex((b) => b.type === 'external');
  d.blocks[i] = { ...armSubsystem(p, opts), id: d.blocks[i].id };
  project.title = 'Arm (simulated)';
  return project;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) console.log(JSON.stringify(armProject(), null, 2));
