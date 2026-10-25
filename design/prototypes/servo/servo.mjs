// Prototype (not product code): the Servo motor component built from
// today's primitives, as design/output/servo.md §2 describes it.
//
// What the built component does at compile time is emulated here in JS:
//   - the mask: every parameter below is a number baked into the blocks,
//     as formula parameters would resolve to at compile time;
//   - the switches: an effect that is off is not built at all (a Switch whose
//     position is a mask constant, resolved at compile time, its other branch
//     not compiled). With opts.switches = true the Switch blocks are built
//     instead, both branches compiled, to show that the Switch passes its
//     input exactly.
//
// Ports (servo.md §2.1): In 1 u (V or A, by `drive`), In 2 θ and In 3 ω of
// the output shaft (after the gear), from the mechanism that integrates the
// inertia. Out 1 τ (N·m at the output shaft), Out 2 θ measured, Out 3 ω
// measured. Inside: Sinks i, tau_m (at the motor shaft) and, for a current
// drive, v (the voltage the drive needs).

export const PLAIN = {
  drive: 'voltage',          // 'voltage' | 'current'
  R: 1, L: 0.01, K: 0.5,     // armature (Ω, H), torque and back-EMF constant (N·m/A = V·s/rad)
  b: 0.1,                    // viscous friction at the motor (N·m·s/rad)
  G: 1,                      // gear ratio, motor turns per output turn
  imax: 10,                  // current limit of a current drive (A)
  // The switches and their parameters. Every switch is off in PLAIN.
  coulomb: false, Tcp: 0, Tcn: 0, ws: 2,               // Coulomb friction, smoothed over ws (rad/s at the motor)
  ripple: false, orders: [],                          // [{ k, A, phase }] per motor turn, N·m
  torqueNoise: false, torqueStd: 0, torqueSeed: 7,    // N·m
  currentLoop: false, tauc: 0,                        // current drive: loop lag (s)
  vlimit: false, Vmax: 1e12,                          // voltage drive: the supply (V); "inf" once formula.js has it
  coupling: false, wc: 1000, zc: 0.5,                     // the encoder disk's coupling resonance (rad/s, ζ)
  encErrors: false, errors: [],                       // [{ k, A, phase }] per motor turn, rad at the motor
  counts: false, N: 1000,                               // encoder counts per motor turn
  encDelay: false, Td: 0,                             // measurement delay (s)
  speedFromAngle: false, Tf: 0.001,
  // The rotor in the motor (input 20): Jm > 0 integrates the rotor here and
  // couples it to the output shaft through the gear's stiffness k and damping
  // c (output side); backlash β is the gear's total play (rad at the output).
  // Jm = 0 is the first design: the rotor's inertia left to the mechanism.
  // shaft 'free': In 2 is a load torque at the output (a lone motor; no gear
  // spring, nothing to couple). 'coupled': In 2, 3 are θ, ω of the inertia it
  // drives, through the elastic gear (k, c) and its backlash.
  Jm: 0, shaft: 'coupled', k: 0, c: 0,
  backlash: false, beta: 0,                      // ω measured = s/(Tf·s + 1) of θ measured
};

const harmonics = (list) => (list.length ? list : [{ k: 1, A: 0 }]).map(({ k, A, phase = 0 }) => `${A}*sin(${k === 1 ? '' : `${k}*`}u${phase ? ` + ${phase}` : ''})`).join(' + ');

export function servoMotor(id, P, opts = {}) {
  const p = { ...PLAIN, ...P };
  const B = [], W = [];
  const blk = (b) => { B.push(b); return b.id; };
  const wire = (from, to) => W.push({ from, to });
  // A switch: on → the effect's output, off → the input passed through.
  // Built only when opts.switches; else the off branch is simply not there.
  const effect = (on, input, build, name) => {
    if (!opts.switches) return on ? build(input) : input;
    const out = build(input);
    const sw = blk({ id: `sw_${name}`, type: 'switch', name, params: { inputs: 2, position: on ? 2 : 1 } });
    wire(input, sw); wire(out, `${sw}:1`);
    return sw;
  };

  blk({ id: 'u', type: 'inport', name: p.drive === 'current' ? 'i* (A)' : 'V (V)', params: { port: 1 } });
  const free = p.Jm > 0 && p.shaft === 'free';
  blk({ id: 'th', type: 'inport', name: free ? 'τ_L' : 'θ', params: { port: 2 } });
  if (!free) blk({ id: 'w', type: 'inport', name: 'ω', params: { port: 3 } });
  const rotor = p.Jm > 0;
  if (rotor) {
    // The rotor: (τm − τ/G) / Jm integrated to ωm, then θm (motor side).
    blk({ id: 'rsum', type: 'sum', params: { signs: '+-' } });
    blk({ id: 'wm', type: 'integrator', name: 'rotor 1/Jm', params: { K: 1 / p.Jm } }); wire('rsum', 'wm');
    blk({ id: 'thm', type: 'integrator', name: 'rotor angle', params: { K: 1 } }); wire('wm', 'thm');
    blk({ id: 'gv', type: 'gain', name: 'gear 1/G', params: { K: 1 / p.G } }); wire('wm', 'gv');
  }
  if (rotor && p.shaft === 'free') {
    blk({ id: 'tl', type: 'gain', name: 'gear 1/G (load torque)', params: { K: 1 / p.G } }); wire('th', 'tl'); wire('tl', 'rsum:1');
  } else if (rotor) {
    // The gear: deflection δ = θm/G − θ and its rate, at the output.
    blk({ id: 'gd', type: 'gain', name: 'gear 1/G', params: { K: 1 / p.G } }); wire('thm', 'gd');
    blk({ id: 'dsum', type: 'sum', params: { signs: '+-' } }); wire('gd', 'dsum'); wire('th', 'dsum:1');
    blk({ id: 'vsum2', type: 'sum', params: { signs: '+-' } }); wire('gv', 'vsum2'); wire('w', 'vsum2:1');
    blk({ id: 'delta', type: 'sink', params: { name: 'delta', unit: 'rad' } }); wire('dsum', 'delta');
    // τ = k·dz(δ + (c/k)·δ̇, β/2): a spring and damper in contact, nothing
    // in the gap (with β = 0, k·δ + c·δ̇). The damper acts through the dead
    // zone's argument, so contact never pulls (it ends when the predicted
    // deflection leaves the flank) and one-input Function blocks suffice.
    blk({ id: 'cr', type: 'gain', name: 'c/k', params: { K: p.c / p.k } }); wire('vsum2', 'cr');
    blk({ id: 'xsum', type: 'sum', params: { signs: '++' } }); wire('dsum', 'xsum'); wire('cr', 'xsum:1');
    const x = effect(p.backlash, 'xsum', (y) => { blk({ id: 'gap', type: 'fcn', name: 'backlash β (dead zone)', params: { expr: `max(u - ${p.beta / 2}, 0) + min(u + ${p.beta / 2}, 0)` } }); wire(y, 'gap'); return 'gap'; }, 'backlash');
    blk({ id: 'kgear', type: 'gain', name: 'gear stiffness k', params: { K: p.k } }); wire(x, 'kgear');
    blk({ id: 'react', type: 'gain', name: 'gear 1/G', params: { K: 1 / p.G } }); wire('kgear', 'react'); wire('react', 'rsum:1');
    // Stands in for the eigenvalue step bound (detail-levels.md §5), which
    // today's per-block bound lacks: an unused lag at the gear's fastest mode.
    const Jr = p.G * p.G * p.Jm, JL = p.JL ?? Jr;
    const wr = Math.max(Math.sqrt(p.k * (1 / Jr + 1 / JL)), p.c * (1 / Jr + 1 / JL));
    blk({ id: 'z0', type: 'gain', name: '0', params: { K: 0 } }); wire('thm', 'z0');
    blk({ id: 'bound', type: 'tf', name: 'step bound (stand-in)', params: { num: [0], den: [1 / wr, 1], delay: 0 } }); wire('z0', 'bound');
    blk({ id: 'bt', type: 'terminator', params: {} }); wire('bound', 'bt');
  } else {
    blk({ id: 'thm', type: 'gain', name: 'gear G (θm = G·θ)', params: { K: p.G } }); wire('th', 'thm');
    blk({ id: 'wm', type: 'gain', name: 'gear G (ωm = G·ω)', params: { K: p.G } }); wire('w', 'wm');
  }

  // Drive: the current i.
  let i;
  if (p.drive === 'voltage') {
    const V = effect(p.vlimit, 'u', (x) => { blk({ id: 'vlim', type: 'saturation', name: 'supply ±Vmax', params: { min: -p.Vmax, max: p.Vmax } }); wire(x, 'vlim'); return 'vlim'; }, 'vlimit');
    blk({ id: 'esum', type: 'sum', params: { signs: '+-' } }); wire(V, 'esum');
    blk({ id: 'ke', type: 'gain', name: 'K (back-EMF)', params: { K: p.K } }); wire('wm', 'ke'); wire('ke', 'esum:1');
    blk({ id: 'arm', type: 'tf', name: 'armature 1/(L·s + R)', params: { num: [1], den: [p.L, p.R], delay: 0 } }); wire('esum', 'arm');
    i = 'arm';
  } else {
    blk({ id: 'ilim', type: 'saturation', name: 'current limit ±imax', params: { min: -p.imax, max: p.imax } }); wire('u', 'ilim');
    i = effect(p.currentLoop, 'ilim', (x) => { blk({ id: 'iloop', type: 'tf', name: 'current loop 1/(τc·s + 1)', params: { num: [1], den: [p.tauc, 1], delay: 0 } }); wire(x, 'iloop'); return 'iloop'; }, 'currentLoop');
    // The voltage the drive needs at steady current: R·i + K·ωm (a check, not a state).
    blk({ id: 'vr', type: 'gain', name: 'R', params: { K: p.R } }); wire(i, 'vr');
    blk({ id: 'vk', type: 'gain', name: 'K', params: { K: p.K } }); wire('wm', 'vk');
    blk({ id: 'vsum', type: 'sum', params: { signs: '++' } }); wire('vr', 'vsum'); wire('vk', 'vsum:1');
    blk({ id: 'v', type: 'sink', params: { name: 'v', unit: 'V' } }); wire('vsum', 'v');
  }
  blk({ id: 'i', type: 'sink', params: { name: 'i', unit: 'A' } }); wire(i, 'i');
  blk({ id: 'kt', type: 'gain', name: 'K (torque)', params: { K: p.K } }); wire(i, 'kt');

  // Torque disturbances from the motor angle: ripple and cogging, then noise.
  let dist = null;
  if (p.ripple || p.torqueNoise || opts.switches) {
    blk({ id: 'zero', type: 'gain', name: '0', params: { K: 0 } }); wire('thm', 'zero');
    let x = effect(p.ripple, 'zero', () => { blk({ id: 'rip', type: 'fcn', name: 'torque ripple and cogging', params: { expr: harmonics(p.orders) } }); wire('thm', 'rip'); return 'rip'; }, 'ripple');
    x = effect(p.torqueNoise, x, (y) => { blk({ id: 'tn', type: 'noise', name: 'torque noise', params: { std: p.torqueStd, seed: p.torqueSeed } }); wire(y, 'tn'); return 'tn'; }, 'torqueNoise');
    dist = x;
  }
  // τm = K·i + disturbances − b·ωm − Coulomb(ωm)
  const signs = ['+'], ins = ['kt'];
  if (dist) { signs.push('+'); ins.push(dist); }
  blk({ id: 'visc', type: 'gain', name: 'viscous b', params: { K: p.b } }); wire('wm', 'visc'); signs.push('-'); ins.push('visc');
  if (p.coulomb || opts.switches) {
    const c = effect(p.coulomb, 'zero2', () => {
      // Tc⁺ for ωm ≥ 0, Tc⁻ below, smoothed: tanh(ωm/ws) written with exp (expr.js has no tanh).
      const th = '(1 - 2/(exp(2*u/' + p.ws + ') + 1))';
      blk({ id: 'coul', type: 'fcn', name: 'Coulomb friction', params: { expr: `${p.Tcp}*max(${th}, 0) + ${p.Tcn}*min(${th}, 0)` } }); wire('wm', 'coul'); return 'coul';
    }, 'coulomb');
    if (opts.switches) { blk({ id: 'zero2', type: 'gain', name: '0', params: { K: 0 } }); wire('wm', 'zero2'); }
    signs.push('-'); ins.push(c);
  }
  blk({ id: 'tsum', type: 'sum', params: { signs: signs.join('') } });
  ins.forEach((x, k) => wire(x, k ? `tsum:${k}` : 'tsum'));
  blk({ id: 'tau_m', type: 'sink', params: { name: 'tau_m', unit: 'N·m' } }); wire('tsum', 'tau_m');
  blk({ id: 'tau', type: 'outport', name: 'τ', params: { port: 1 } });
  if (rotor) { wire('tsum', 'rsum'); wire(p.shaft === 'free' ? 'th' : 'kgear', 'tau'); }
  else { blk({ id: 'gout', type: 'gain', name: 'gear G (τ = G·τm)', params: { K: p.G } }); wire('tsum', 'gout'); wire('gout', 'tau'); }

  // Encoder on the motor shaft: coupling, errors, counts, delay; referred to the output.
  let e = effect(p.coupling, 'thm', (x) => { blk({ id: 'cpl', type: 'tf', name: 'encoder coupling resonance', params: { num: [p.wc * p.wc], den: [1, 2 * p.zc * p.wc, p.wc * p.wc], delay: 0 } }); wire(x, 'cpl'); return 'cpl'; }, 'coupling');
  e = effect(p.encErrors, e, (x) => { blk({ id: 'err', type: 'fcn', name: 'encoder errors', params: { expr: `u + ${harmonics(p.errors)}` } }); wire(x, 'err'); return 'err'; }, 'encErrors');
  e = effect(p.counts, e, (x) => { blk({ id: 'cnt', type: 'quantizer', name: 'encoder counts', params: { q: (2 * Math.PI) / p.N } }); wire(x, 'cnt'); return 'cnt'; }, 'counts');
  e = effect(p.encDelay, e, (x) => { blk({ id: 'edel', type: 'delay', name: 'measurement delay', params: { L: p.Td, y0: 0 } }); wire(x, 'edel'); return 'edel'; }, 'encDelay');
  blk({ id: 'gin', type: 'gain', name: 'gear 1/G', params: { K: 1 / p.G } }); wire(e, 'gin');
  blk({ id: 'thmeas', type: 'outport', name: 'θ measured', params: { port: 2 } }); wire('gin', 'thmeas');
  // Off: an ideal tachometer on the motor (with the rotor here), else ω.
  let wmeas = rotor ? 'gv' : 'w';
  if (p.speedFromAngle || opts.switches) {
    wmeas = effect(p.speedFromAngle, wmeas, () => { blk({ id: 'deriv', type: 'tf', name: 'speed from angle', params: { num: [1, 0], den: [p.Tf, 1], delay: 0 } }); wire('gin', 'deriv'); return 'deriv'; }, 'speedFromAngle');
  }
  blk({ id: 'wmeas', type: 'outport', name: 'ω measured', params: { port: 3 } }); wire(wmeas, 'wmeas');
  // Out 4: the true speed at the output (the motor's, through the gear).
  blk({ id: 'wtrue', type: 'outport', name: 'ω', params: { port: 4 } }); wire(rotor ? 'gv' : 'w', 'wtrue');

  // Default ports when switches are off and the Switch blocks are not built.
  for (const b of B) { b.params ??= {}; b.x ??= 0; b.y ??= 0; }
  return { id, type: 'subsystem', name: 'Servo motor', params: {}, x: 0, y: 0, diagram: { blocks: B, wires: W } };
}

// A rigid shaft for a standalone motor: (τ − τL) / J integrated to ω, then θ.
// Returns blocks and wires around a servo with id `sid`; `load` is the
// load-torque signal's block id or null.
export function shaft(sid, J, load) {
  const blocks = [
    { id: 'tl', type: 'sum', params: { signs: '+-' }, x: 0, y: 0 },
    { id: 'rotor', type: 'integrator', name: 'rotor and load inertia 1/J', params: { K: 1 / J }, x: 0, y: 0 },
    { id: 'int', type: 'integrator', name: 'angle', params: { K: 1 }, x: 0, y: 0 },
  ];
  const wires = [
    { from: sid, to: 'tl' }, { from: 'tl', to: 'rotor' }, { from: 'rotor', to: 'int' },
    { from: 'int', to: `${sid}:1` }, { from: 'rotor', to: `${sid}:2` },
  ];
  if (load) wires.push({ from: load, to: 'tl:1' });
  else { blocks.push({ id: 'noload', type: 'gain', name: '0', params: { K: 0 }, x: 0, y: 0 }); wires.push({ from: 'rotor', to: 'noload' }, { from: 'noload', to: 'tl:1' }); }
  return { blocks, wires };
}
