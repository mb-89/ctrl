// Built-in components (design/output/servo.md §9): masked subsystems of
// primitives the page ships, used by reference. A use is
//   { "type": "subsystem", "component": "servo-motor@1", "params": { … } }
// and normalizeDiagram puts the component's mask and diagram into it, so it
// compiles and opens like any subsystem; a file stores only the reference
// and the mask values that differ from the defaults. A change that alters a
// result is a new version; old versions stay, so saved projects run as saved.
//
// Data only: nothing here compiles or checks (diagram.js does).

// ---- The Servo motor (servo.md) -------------------------------------------
// The drive, the torque the motor makes, its friction and ripple, its rotor
// (the rotor's inertia is inside), the gear and the encoder on the motor
// shaft. What it turns is outside: a load torque (shaft free), an inertia
// it drives through the gear's stiffness (shaft coupled), or a mechanism
// that carries the rotor's inertia and turns it rigidly (shaft rigid).
//   In 1 u (V, or the current i* for a current drive), In 2 τ_L (free) or the
//   load's θ (coupled), In 3 the load's ω (coupled only).
//   Out 1 τ (the gear's torque on the load; free: τ_L), Out 2 θ measured
//   (the motor's encoder, referred to the output), Out 3 ω measured (speed
//   from the angle, or an ideal tachometer), Out 4 ω (the true speed at the
//   output).
// Every non-ideality is a toggle on the mask; each sits behind a Switch whose
// position is that toggle, so off it is not compiled (the motor without it,
// bit for bit), and on at its neutral value (an amplitude of 0, a lag of 0, a
// play of 0) it computes the same numbers. Formulas read the mask's names.
const B = (id, type, params, x, y, extra = {}) => ({ id, type, params, x, y, ...extra });
const eqs = (eq) => ({ inputs: 'u', eqs: `y = ${eq}`, outputs: 'y' });
const order = (k, A, ph) => `${A}*sin(${k}*u + ${ph})`;
const SERVO_DIAGRAM = {
  blocks: [
    B('u', 'inport', { port: 1 }, 20, 140, { name: 'u (V or i*)' }),
    B('tl', 'inport', { port: 2 }, 20, 620, { name: 'τ_L or θ' }),
    B('w', 'inport', { port: 3 }, 20, 700, { name: 'ω', when: 'shaft - 1' }),
    // Drive, voltage: the supply limit, back-EMF, the armature's R and L.
    B('vlim', 'saturation', { min: '-Vmax', max: 'Vmax' }, 120, 40, { name: 'supply ±Vmax' }),
    B('sw_vlim', 'switch', { inputs: 2, position: '1 + vlimit' }, 250, 60, { name: 'supply limit' }),
    B('esum', 'sum', { signs: '+-' }, 360, 68),
    B('arm', 'tf', { num: [1], den: ['L', 'R'], delay: 0 }, 430, 60, { name: 'armature 1/(L·s + R)' }),
    B('ke', 'gain', { K: 'K' }, 360, 170, { name: 'K (back-EMF)', flip: true }),
    // Drive, current: the limit and the current loop's lag; the voltage it
    // needs, R·i + K·ωm (L·di/dt left out). v is the voltage the drive applies:
    // for a voltage drive, u after the supply limit.
    B('ilim', 'saturation', { min: '-imax', max: 'imax' }, 120, 250, { name: 'current limit ±imax' }),
    B('iloop', 'tf', { num: [1], den: ['tauc', 1], delay: 0 }, 250, 300, { name: 'current loop 1/(τc·s + 1)' }),
    B('sw_iloop', 'switch', { inputs: 2, position: '1 + currentLoop' }, 430, 250, { name: 'current loop' }),
    B('vr', 'gain', { K: 'R' }, 560, 330, { name: 'R' }),
    B('vk', 'gain', { K: 'K' }, 560, 400, { name: 'K' }),
    B('vsum', 'sum', { signs: '++' }, 680, 360),
    B('sw_v', 'switch', { inputs: 2, position: 'drive' }, 760, 300, { name: 'drive' }),
    B('v', 'sink', { name: 'v', unit: 'V' }, 860, 308),
    B('sw_drive', 'switch', { inputs: 2, position: 'drive' }, 600, 140, { name: 'drive' }),
    B('i', 'sink', { name: 'i', unit: 'A' }, 720, 60),
    B('kt', 'gain', { K: 'K' }, 720, 140, { name: 'K (torque)' }),
    B('tau_e', 'sink', { name: 'tau_e', unit: 'N·m' }, 840, 60),
    // Torque disturbances from the motor's angle: ripple and cogging, then noise.
    B('zero', 'gain', { K: 0 }, 720, 470, { name: '0', flip: true }),
    B('rip', 'fcn', eqs([order('kr1', 'Ar1', 'pr1'), order('kr2', 'Ar2', 'pr2'), order('kr3', 'Ar3', 'pr3')].join(' + ')), 720, 540, { name: 'torque ripple and cogging', flip: true }),
    B('sw_rip', 'switch', { inputs: 2, position: '1 + ripple' }, 600, 500, { name: 'ripple', flip: true }),
    B('tn', 'noise', { std: 'sigma', seed: 'seed' }, 480, 540, { name: 'torque noise', flip: true }),
    B('sw_tn', 'switch', { inputs: 2, position: '1 + torqueNoise' }, 380, 500, { name: 'torque noise', flip: true }),
    B('tau_r', 'sink', { name: 'tau_r', unit: 'N·m' }, 380, 440),
    // Friction at the motor: viscous, and Coulomb smoothed over ωs.
    B('visc', 'gain', { K: 'b' }, 1240, 250, { name: 'viscous b', flip: true }),
    B('coul', 'fcn', eqs('Tcp*max(tanh(u/ws), 0) + Tcn*min(tanh(u/ws), 0)'), 1240, 320, { name: 'Coulomb friction', flip: true }),
    B('zero2', 'gain', { K: 0 }, 1240, 390, { name: '0', flip: true }),
    B('sw_coul', 'switch', { inputs: 2, position: '1 + coulomb' }, 1110, 340, { name: 'Coulomb', flip: true }),
    B('fsum', 'sum', { signs: '++' }, 1010, 268, { flip: true }),
    B('tau_f', 'sink', { name: 'tau_f', unit: 'N·m' }, 1010, 190),
    // τm = K·i + disturbances − friction; the rotor (its inertia Jm) and its angle.
    B('tsum', 'sum', { signs: '++-' }, 900, 148),
    B('tau_m', 'sink', { name: 'tau_m', unit: 'N·m' }, 960, 60),
    B('rsum', 'sum', { signs: '+-' }, 1000, 148),
    B('wm', 'integrator', { K: '1/Jm' }, 1070, 140, { name: 'rotor 1/Jm' }),
    B('thm', 'integrator', { K: 1 }, 1240, 140, { name: 'rotor angle' }),
    B('gv', 'gain', { K: '1/G' }, 1240, 60, { name: 'gear 1/G' }),
    // The output shaft. Free: the load torque through the gear. Coupled: the
    // gear's deflection δ = θm/G − θ and its rate, a spring k and damper c in
    // contact and nothing in the play β (the damper inside the dead zone's
    // argument, so the teeth never pull as they part).
    B('tlg', 'gain', { K: '1/G' }, 120, 620, { name: 'gear 1/G (load torque)' }),
    B('gd', 'gain', { K: '1/G' }, 1380, 620, { name: 'gear 1/G', flip: true }),
    B('dsum', 'sum', { signs: '+-' }, 250, 660),
    B('delta', 'sink', { name: 'delta', unit: 'rad' }, 330, 590),
    B('vsum2', 'sum', { signs: '+-' }, 250, 740),
    B('cr', 'gain', { K: 'c/k' }, 330, 732, { name: 'c/k' }),
    B('xsum', 'sum', { signs: '++' }, 460, 700),
    B('gap', 'fcn', eqs('max(u - beta/2, 0) + min(u + beta/2, 0)'), 540, 760, { name: 'backlash β (dead zone)' }),
    B('sw_bl', 'switch', { inputs: 2, position: '1 + backlash' }, 700, 700, { name: 'backlash' }),
    B('kgear', 'gain', { K: 'k' }, 820, 700, { name: 'gear stiffness k' }),
    B('react', 'gain', { K: '1/G' }, 940, 620, { name: 'gear 1/G (reaction)' }),
    B('sw_shr', 'switch', { inputs: 2, position: 'min(shaft, 2)' }, 1000, 230, { name: 'shaft' }),
    B('sw_sht', 'switch', { inputs: 3, position: 'shaft' }, 1380, 700, { name: 'shaft' }),
    // Rigid: the rotor turns with the load (its inertia, G²·Jm, is the
    // mechanism's): θm = G·θ, ωm = G·ω come in, τ = G·τm goes out.
    B('thr', 'gain', { K: 'G' }, 120, 820, { name: 'θm = G·θ (rigid)' }),
    B('wr', 'gain', { K: 'G' }, 120, 880, { name: 'ωm = G·ω (rigid)' }),
    B('sw_th', 'switch', { inputs: 2, position: '1 + (shaft - 1)*(shaft - 2)/2' }, 1300, 260, { name: 'rotor angle' }),
    B('sw_w', 'switch', { inputs: 2, position: '1 + (shaft - 1)*(shaft - 2)/2' }, 1160, 260, { name: 'rotor speed' }),
    B('gtau', 'gain', { K: 'G' }, 1240, 780, { name: 'gear G (rigid)' }),
    B('tau', 'outport', { port: 1 }, 1520, 708, { name: 'τ' }),
    // The encoder on the motor shaft: coupling resonance, angle errors,
    // counts, delay; referred to the output. Speed from its angle, or ideal.
    B('cpl', 'tf', { num: ['wc*wc'], den: [1, '2*zc*wc', 'wc*wc'], delay: 0 }, 1380, 200, { name: 'encoder coupling resonance' }),
    B('sw_cpl', 'switch', { inputs: 2, position: '1 + coupling' }, 1520, 140, { name: 'coupling' }),
    B('err', 'fcn', eqs(['u', order('ke1', 'Ae1', 'pe1'), order('ke2', 'Ae2', 'pe2'), order('ke3', 'Ae3', 'pe3')].join(' + ')), 1620, 200, { name: 'encoder angle errors' }),
    B('sw_err', 'switch', { inputs: 2, position: '1 + encErrors' }, 1760, 140, { name: 'angle errors' }),
    B('cnt', 'quantizer', { q: '2*pi/N' }, 1860, 200, { name: 'encoder counts' }),
    B('sw_cnt', 'switch', { inputs: 2, position: '1 + counts' }, 2000, 140, { name: 'counts' }),
    B('edel', 'delay', { L: 'Td', y0: 0 }, 2100, 200, { name: 'measurement delay' }),
    B('sw_del', 'switch', { inputs: 2, position: '1 + encDelay' }, 2240, 140, { name: 'delay' }),
    B('gin', 'gain', { K: '1/G' }, 2340, 140, { name: 'gear 1/G' }),
    B('thmeas', 'outport', { port: 2 }, 2600, 148, { name: 'θ measured' }),
    B('deriv', 'tf', { num: [1, 0], den: ['Tf', 1], delay: 0 }, 2340, 260, { name: 'speed from angle' }),
    B('sw_sfa', 'switch', { inputs: 2, position: '1 + speedFromAngle' }, 2480, 60, { name: 'speed from angle' }),
    B('wmeas', 'outport', { port: 3 }, 2600, 68, { name: 'ω measured' }),
    B('wtrue', 'outport', { port: 4 }, 2600, 8, { name: 'ω' }),
  ],
  wires: [
    // drive
    { from: 'u', to: 'vlim' }, { from: 'u', to: 'sw_vlim' }, { from: 'vlim', to: 'sw_vlim:1' },
    { from: 'sw_vlim', to: 'esum' }, { from: 'ke', to: 'esum:1' }, { from: 'esum', to: 'arm' }, { from: 'sw_w', to: 'ke' },
    { from: 'u', to: 'ilim' }, { from: 'ilim', to: 'iloop' }, { from: 'ilim', to: 'sw_iloop' }, { from: 'iloop', to: 'sw_iloop:1' },
    { from: 'sw_iloop', to: 'vr' }, { from: 'sw_w', to: 'vk' }, { from: 'vr', to: 'vsum' }, { from: 'vk', to: 'vsum:1' }, { from: 'sw_vlim', to: 'sw_v' }, { from: 'vsum', to: 'sw_v:1' }, { from: 'sw_v', to: 'v' },
    { from: 'arm', to: 'sw_drive' }, { from: 'sw_iloop', to: 'sw_drive:1' }, { from: 'sw_drive', to: 'i' }, { from: 'sw_drive', to: 'kt' }, { from: 'kt', to: 'tau_e' },
    // disturbances
    { from: 'sw_th', to: 'zero' }, { from: 'sw_th', to: 'rip' }, { from: 'zero', to: 'sw_rip' }, { from: 'rip', to: 'sw_rip:1' },
    { from: 'sw_rip', to: 'tn' }, { from: 'sw_rip', to: 'sw_tn' }, { from: 'tn', to: 'sw_tn:1' }, { from: 'sw_tn', to: 'tau_r' },
    // friction
    { from: 'sw_w', to: 'visc' }, { from: 'sw_w', to: 'coul' }, { from: 'sw_w', to: 'zero2' }, { from: 'zero2', to: 'sw_coul' }, { from: 'coul', to: 'sw_coul:1' },
    { from: 'visc', to: 'fsum' }, { from: 'sw_coul', to: 'fsum:1' }, { from: 'fsum', to: 'tau_f' },
    // torque and rotor
    { from: 'kt', to: 'tsum' }, { from: 'sw_tn', to: 'tsum:1' }, { from: 'fsum', to: 'tsum:2' }, { from: 'tsum', to: 'tau_m' },
    { from: 'tsum', to: 'rsum' }, { from: 'sw_shr', to: 'rsum:1' }, { from: 'rsum', to: 'wm' }, { from: 'sw_w', to: 'thm' }, { from: 'sw_w', to: 'gv' },
    // the shaft
    { from: 'wm', to: 'sw_w' }, { from: 'wr', to: 'sw_w:1' }, { from: 'thm', to: 'sw_th' }, { from: 'thr', to: 'sw_th:1' },
    { from: 'w', to: 'wr' }, { from: 'tl', to: 'thr' }, { from: 'tsum', to: 'gtau' },
    { from: 'tl', to: 'tlg' }, { from: 'sw_th', to: 'gd' }, { from: 'gd', to: 'dsum' }, { from: 'tl', to: 'dsum:1' }, { from: 'dsum', to: 'delta' },
    { from: 'gv', to: 'vsum2' }, { from: 'w', to: 'vsum2:1' }, { from: 'vsum2', to: 'cr' }, { from: 'dsum', to: 'xsum' }, { from: 'cr', to: 'xsum:1' },
    { from: 'xsum', to: 'gap' }, { from: 'xsum', to: 'sw_bl' }, { from: 'gap', to: 'sw_bl:1' }, { from: 'sw_bl', to: 'kgear' }, { from: 'kgear', to: 'react' },
    { from: 'tlg', to: 'sw_shr' }, { from: 'react', to: 'sw_shr:1' }, { from: 'tl', to: 'sw_sht' }, { from: 'kgear', to: 'sw_sht:1' }, { from: 'gtau', to: 'sw_sht:2' }, { from: 'sw_sht', to: 'tau' },
    // the encoder
    { from: 'sw_th', to: 'cpl' }, { from: 'sw_th', to: 'sw_cpl' }, { from: 'cpl', to: 'sw_cpl:1' },
    { from: 'sw_cpl', to: 'err' }, { from: 'sw_cpl', to: 'sw_err' }, { from: 'err', to: 'sw_err:1' },
    { from: 'sw_err', to: 'cnt' }, { from: 'sw_err', to: 'sw_cnt' }, { from: 'cnt', to: 'sw_cnt:1' },
    { from: 'sw_cnt', to: 'edel' }, { from: 'sw_cnt', to: 'sw_del' }, { from: 'edel', to: 'sw_del:1' },
    { from: 'sw_del', to: 'gin' }, { from: 'gin', to: 'thmeas' }, { from: 'gin', to: 'deriv' },
    { from: 'gv', to: 'sw_sfa' }, { from: 'deriv', to: 'sw_sfa:1' }, { from: 'sw_sfa', to: 'wmeas' }, { from: 'gv', to: 'wtrue' },
  ],
};

const F = (key, label, unit, def, extra = {}) => ({ key, label, unit, default: def, ...extra });
const T = (key, label, under) => ({ key, label, kind: 'toggle', default: 0, ...(under ? { under } : {}) });
const slots = (p, what, unitA, defs, under) => defs.flatMap(([k, A], j) => [
  F(`k${p}${j + 1}`, `${what} ${j + 1}: order`, '1', k, { under }),
  F(`A${p}${j + 1}`, `${what} ${j + 1}: amplitude`, unitA, A, { under }),
  F(`p${p}${j + 1}`, `${what} ${j + 1}: phase`, 'rad', 0, { under }),
]);
const SERVO_MASK = [
  { key: 'drive', label: 'Drive', kind: 'choice', options: ['voltage', 'current'], default: 'voltage' },
  F('R', 'Armature resistance', 'Ω', 1, { min: 1e-9, physical: true }),
  F('L', 'Armature inductance', 'H', 0.01, { min: 0, physical: true }),
  F('K', 'Torque and back-EMF constant', 'N·m/A', 0.5, { min: 1e-12, physical: true }),
  F('b', 'Viscous friction (motor)', 'N·m·s/rad', 0.1, { min: 0, physical: true }),
  F('Jm', 'Rotor inertia', 'kg·m²', 0.02, { min: 1e-12, physical: true }),
  F('G', 'Gear ratio (motor turns per output turn)', '1', 1),
  F('imax', 'Current limit', 'A', 10, { min: 1e-9, under: 'drive:current' }),
  { key: 'shaft', label: 'Output shaft', kind: 'choice', options: ['free', 'coupled', 'rigid'], default: 'free' },
  F('k', 'Gear stiffness (output)', 'N·m/rad', 1000, { min: 1e-9, under: 'shaft:coupled', physical: true }),
  F('c', 'Gear damping (output)', 'N·m·s/rad', 1, { min: 0, under: 'shaft:coupled', physical: true }),
  T('coulomb', 'Coulomb friction'),
  F('Tcp', 'Coulomb torque, forwards', 'N·m', 0.1, { min: 0, under: 'coulomb' }),
  F('Tcn', 'Coulomb torque, backwards', 'N·m', 0.1, { min: 0, under: 'coulomb' }),
  F('ws', 'Coulomb smoothing speed', 'rad/s', 2, { min: 1e-9, under: 'coulomb' }),
  T('ripple', 'Torque ripple and cogging'),
  ...slots('r', 'Ripple', 'N·m', [[6, 0.01], [12, 0], [1, 0]], 'ripple'),
  T('torqueNoise', 'Torque noise'),
  F('sigma', 'Torque noise σ', 'N·m', 0.01, { min: 0, under: 'torqueNoise' }),
  F('seed', 'Torque noise seed', '1', 7, { min: 0, under: 'torqueNoise' }),
  T('currentLoop', 'Current loop', 'drive:current'),
  F('tauc', 'Current loop time constant τc', 's', 0.0004, { min: 0, under: 'currentLoop' }),
  T('vlimit', 'Supply limit', 'drive:voltage'),
  F('Vmax', 'Supply voltage', 'V', 'inf', { min: 0, under: 'vlimit' }),
  T('backlash', 'Backlash', 'shaft:coupled'),
  F('beta', 'Backlash β (total play, output)', 'rad', 0.00087, { min: 0, under: 'backlash' }),
  T('coupling', 'Encoder coupling resonance'),
  F('wc', 'Coupling resonance ωc', 'rad/s', 3000, { min: 1e-9, under: 'coupling' }),
  F('zc', 'Coupling damping ζc', '1', 0.05, { min: 0, under: 'coupling' }),
  T('encErrors', 'Encoder angle errors'),
  ...slots('e', 'Error', 'rad', [[1, 1e-4], [2, 5e-5], [3, 0]], 'encErrors'),
  T('counts', 'Encoder counts'),
  F('N', 'Counts per motor turn', '1', 1000, { min: 1, under: 'counts' }),
  T('encDelay', 'Measurement delay'),
  F('Td', 'Delay T_d', 's', 0.0005, { min: 0, under: 'encDelay' }),
  T('speedFromAngle', 'Speed from the angle'),
  F('Tf', 'Speed filter T_f', 's', 0.001, { min: 1e-9, under: 'speedFromAngle' }),
];

export const COMPONENTS = {
  'servo-motor@1': {
    name: 'Servo motor',
    summary: 'A DC motor with its drive, rotor, gear and encoder; each non-ideality a switch on its mask.',
    mask: SERVO_MASK,
    diagram: SERVO_DIAGRAM,
  },
};

// A use of a component, as a diagram holds it (expanded, so it can be
// walked before it is normalized): id, name, x, y, its mask values, and
// prefix (put before the names of its Sinks, for a second use).
export function componentUse(ref, { id, name, params = {}, x = 0, y = 0, prefix } = {}) {
  const c = COMPONENTS[ref];
  if (!c) throw new Error(`no component "${ref}"`);
  return { id, type: 'subsystem', name: name ?? c.name, component: ref, ...(prefix ? { prefix } : {}), params: { ...params }, x, y, mask: structuredClone(c.mask), diagram: withPrefix(c.diagram, prefix) };
}

// The component's diagram with its Sinks renamed prefix + name.
export function withPrefix(diagram, prefix) {
  const d = structuredClone(diagram);
  if (prefix) for (const b of d.blocks) if (b.type === 'sink') b.params.name = `${prefix}${b.params.name}`;
  return d;
}
