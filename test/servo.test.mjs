// The Servo motor component (design/output/servo.md §12.2, §12.3): a use is
// a reference, each switch at its neutral value is the switch off bit for
// bit, each effect shows its signature, and the energy balances.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDiagram } from '../src/core/diagram.js';
import { componentUse } from '../src/core/components.js';
import { simulateSystem } from '../src/core/sim.js';
import { normalizeReference } from '../src/core/signals.js';

const SRC = (id, signal) => ({ id, type: 'source', params: { signal }, x: 0, y: 0 });
const SINK = (id, name) => ({ id, type: 'sink', params: { name }, x: 0, y: 0 });
// The motor driven by the source u, its load torque (free) or a load
// inertia JL (coupled) wired around it; every output a Sink.
function rig(params, { JL = 0.01, prefix } = {}) {
  const coupled = params.shaft === 'coupled';
  const blocks = [SRC('u', 'u'), componentUse('servo-motor@1', { id: 'motor', params, prefix }),
    SINK('s_tau', 'tau'), SINK('s_th', 'th'), SINK('s_wm', 'wmeas'), SINK('s_w', 'w')];
  const wires = [{ from: 'u', to: 'motor' }, { from: 'motor', to: 's_tau' }, { from: 'motor:1', to: 's_th' }, { from: 'motor:2', to: 's_wm' }, { from: 'motor:3', to: 's_w' }];
  if (coupled) {
    blocks.push({ id: 'lw', type: 'integrator', name: 'load 1/JL', params: { K: 1 / JL }, x: 0, y: 0 }, { id: 'lq', type: 'integrator', params: { K: 1 }, x: 0, y: 0 }, SINK('s_q', 'q'), SINK('s_lw', 'lw'));
    wires.push({ from: 'motor', to: 'lw' }, { from: 'lw', to: 'lq' }, { from: 'lq', to: 'motor:1' }, { from: 'lw', to: 'motor:2' }, { from: 'lq', to: 's_q' }, { from: 'lw', to: 's_lw' });
  } else {
    blocks.push(SRC('d', 'd'));
    wires.push({ from: 'd', to: 'motor:1' });
  }
  return { blocks, wires };
}
const sig = (amp, f = 0) => normalizeReference({ period: 1, components: [f ? { type: 'sine', params: { amplitude: amp, frequency: f, time: 0 } } : { type: 'step', params: { amplitude: amp, time: 0.05 } }] });
const run = (params, opts = {}) => simulateSystem(normalizeDiagram(rig(params, opts)), { u: opts.u ?? sig(12, 3), d: opts.d ?? sig(0.1) }, { duration: opts.T ?? 0.5, sampleTime: opts.Ts ?? 0.0005 });
const bits = (a) => Array.from(new Uint32Array(Float64Array.from(a).buffer)).join(',');
const same = (a, b, names) => { for (const n of names) assert.equal(bits(a.signals[n]), bits(b.signals[n]), n); };
const OUT = ['tau', 'th', 'wmeas', 'w', 'i', 'tau_m'];

test('a use is saved as its reference and the values that differ, and reloads bit for bit', () => {
  const d = normalizeDiagram(rig({ drive: 'current', imax: 5, coulomb: 1, Tcp: 0.2 }));
  const saved = JSON.parse(JSON.stringify(d)).blocks[1];
  assert.deepEqual(saved, { id: 'motor', type: 'subsystem', name: 'Servo motor', component: 'servo-motor@1', params: { drive: 'current', imax: 5, coulomb: 1, Tcp: 0.2 }, x: 0, y: 0 });
  const back = normalizeDiagram(JSON.parse(JSON.stringify(d)));
  const sigs = { u: sig(2), d: sig(0) }, sim = { duration: 0.2, sampleTime: 0.001 };
  same(simulateSystem(d, sigs, sim), simulateSystem(back, sigs, sim), OUT);
  assert.throws(() => normalizeDiagram({ blocks: [{ id: 'm', component: 'servo-motor@2', params: {} }], wires: [] }), /no component "servo-motor@2"; built in: servo-motor@1/);
  assert.throws(() => normalizeDiagram({ blocks: [{ ...saved, params: { nope: 1 } }], wires: [] }), /"nope" is not on the mask/);
  // A prefix names a second use's Sinks.
  const two = simulateSystem(normalizeDiagram(rig({}, { prefix: 'm2_' })), sigs, sim);
  assert.ok('m2_i' in two.signals && !('i' in two.signals));
});

test('ports follow the shaft: free 2 inputs, coupled 3', () => {
  assert.throws(() => normalizeDiagram({ ...rig({}), wires: [...rig({}).wires, { from: 'u', to: 'motor:2' }] }), /motor has no input 2/);
  assert.doesNotThrow(() => normalizeDiagram(rig({ shaft: 'coupled', k: 400, c: 0.3 })));
});

test('each switch on at its neutral value is the motor without it, bit for bit', () => {
  const cases = [
    [{}, { coulomb: 1, Tcp: 0, Tcn: 0 }],
    [{}, { ripple: 1, Ar1: 0, Ar2: 0, Ar3: 0 }],
    [{}, { torqueNoise: 1, sigma: 0 }],
    [{}, { vlimit: 1, Vmax: 'inf' }],
    [{}, { encErrors: 1, Ae1: 0, Ae2: 0, Ae3: 0 }],
    [{}, { encDelay: 1, Td: 0 }],
    [{ drive: 'current', imax: 30 }, { currentLoop: 1, tauc: 0 }],
    [{ shaft: 'coupled', k: 400, c: 0.3 }, { backlash: 1, beta: 0 }],
  ];
  for (const [base, on] of cases) {
    const a = run(base), b = run({ ...base, ...on });
    assert.equal(a.info.substeps, b.info.substeps, JSON.stringify(on));
    same(a, b, OUT);
  }
});

test('each effect shows: ripple, angle errors, counts, Coulomb, the current loop, the supply limit, v', () => {
  // Encoder errors: θ measured − θm/G is the sum of the orders, to 1e-12.
  const G = 4, errs = { encErrors: 1, ke1: 1, Ae1: 0.02, pe1: 0.5, ke2: 2, Ae2: 0.01, pe2: 1, Ae3: 0 };
  const e = run({ G, ...errs });
  const plain = run({ G });
  for (let k = 0; k < e.t.length; k += 37) {
    const tm = plain.signals.th[k] * G, want = (tm + 0.02 * Math.sin(tm + 0.5) + 0.01 * Math.sin(2 * tm + 1)) / G;
    assert.ok(Math.abs(e.signals.th[k] - want) < 1e-12 * Math.max(1, Math.abs(want)), `errors at ${k}`);
  }
  // Counts: steps of 2π/(N·G).
  const N = 100, c = run({ G, counts: 1, N });
  for (const v of c.signals.th) assert.ok(Math.abs(v / ((2 * Math.PI) / (N * G)) - Math.round(v / ((2 * Math.PI) / (N * G)))) < 1e-9);
  // Coulomb: at a steady speed the friction is Tc± beyond the smoothing, whichever way it turns.
  const T = 3, cou = (u) => run({ coulomb: 1, Tcp: 0.3, Tcn: 0.2, ws: 0.01 }, { u: sig(u), d: sig(0), T });
  for (const [u, Tc] of [[12, 0.3], [-12, -0.2]]) {
    const r = cou(u), k = r.t.length - 1, w = r.signals.w[k];
    assert.ok(Math.abs(r.signals.tau_f[k] - (0.1 * w + Tc)) < 1e-6, `Coulomb ${u}`);
  }
  // The current loop: i lags i* by τc (a first-order lag).
  const tauc = 0.01, il = run({ drive: 'current', imax: 30, currentLoop: 1, tauc }, { u: sig(2), Ts: 0.0005 });
  for (const k of [110, 120, 140]) assert.ok(Math.abs(il.signals.i[k] - 2 * (1 - Math.exp(-(il.t[k] - 0.05) / tauc))) < 0.02, `lag ${il.signals.i[k]} at ${il.t[k]}`);
  // v = R·i + K·ωm for a current drive.
  const cd = run({ drive: 'current', imax: 30, R: 2, K: 0.5 }, { u: sig(1, 3) });
  cd.signals.v.forEach((v, j) => assert.ok(Math.abs(v - (2 * cd.signals.i[j] + 0.5 * cd.signals.w[j])) < 1e-12 * Math.max(1, Math.abs(v))));
  // The supply limit: the speed saturates at (Vmax − R·i)/K (L 0, no load: i = b·ω/K).
  const vl = run({ vlimit: 1, Vmax: 6, L: 0 }, { u: sig(12), d: sig(0), T: 4 }), w = vl.signals.w.at(-1), i = vl.signals.i.at(-1);
  assert.ok(Math.abs(w - (6 - 1 * i) / 0.5) < 1e-6, `${w}`);
  // Ripple: the order line in τm's spectrum at a steady speed (6× per motor turn).
  const rp = run({ ripple: 1, kr1: 6, Ar1: 0.05, Ar2: 0, Ar3: 0 }, { u: sig(12), d: sig(0), T: 4 });
  const dev = rp.signals.tau_r.slice(-2000), th = rp.signals.th.slice(-2000).map((x) => x);
  dev.forEach((x, j) => assert.ok(Math.abs(x - 0.05 * Math.sin(6 * th[j])) < 1e-12));
});

test('energy balance, free shaft, L = 0: V·i = R·i² + d/dt(½Jm·ωm²) + b·ωm² + τ_L·ω', () => {
  const P = { L: 0, R: 1.5, K: 0.4, b: 0.05, Jm: 0.01 };
  const r = run(P, { u: sig(6, 2), d: sig(0.2), Ts: 0.0001, T: 0.4 });
  const { i, w, u, d } = r.signals, h = r.t[1] - r.t[0];
  let worst = 0, scale = 0;
  for (let k = 1; k < r.t.length - 1; k++) {
    if (Math.abs(r.t[k] - 0.05) < 3 * h) continue;   // the load torque's step
    const Ek = (j) => 0.5 * P.Jm * w[j] ** 2;
    const lhs = u[k] * i[k], rhs = P.R * i[k] ** 2 + (Ek(k + 1) - Ek(k - 1)) / (2 * h) + P.b * w[k] ** 2 + d[k] * w[k];
    worst = Math.max(worst, Math.abs(lhs - rhs)); scale = Math.max(scale, Math.abs(lhs));
  }
  assert.ok(worst < 2e-3 * scale, `${worst} of ${scale}`);
});

test('the coupled gear rings at its two-mass resonance, its energy balances, and backlash never pulls', () => {
  // Rotor Jr = G²·Jm = 0.008, load 0.01: ωr² = k(1/Jr + 1/JL).
  const G = 20, Jm = 2e-5, JL = 0.01, Jr = G * G * Jm, k = 439, c = 0.0;
  const wr = Math.sqrt(k * (1 / Jr + 1 / JL));
  const P = { shaft: 'coupled', drive: 'current', imax: 5, G, Jm, k, c, b: 0, K: 0.05 };
  const r = run(P, { u: normalizeReference({ period: 1, components: [{ type: 'square', params: { amplitude: 1, time: 0, width: 0.002, period: 1, count: 1 } }] }), Ts: 0.0001, T: 0.2, JL });
  const delta = r.signals.delta, zc = [];
  for (let j = 200; j < delta.length; j++) if (delta[j - 1] < 0 && delta[j] >= 0) zc.push(r.t[j]);
  const f = (zc.length - 1) / (zc.at(-1) - zc[0]);
  assert.ok(Math.abs(f * 2 * Math.PI - wr) < 0.01 * wr, `${f * 2 * Math.PI} vs ${wr}`);
  // Energy, no damping and nothing driving after the pulse: ½Jr·(ωm/G·G)²… conserved.
  const E = (j) => 0.5 * Jm * (r.signals.w[j] * G) ** 2 + 0.5 * JL * r.signals.lw[j] ** 2 + 0.5 * k * delta[j] ** 2;
  const e0 = E(300);
  for (let j = 300; j < delta.length; j += 50) assert.ok(Math.abs(E(j) - e0) < 1e-3 * e0, `energy ${E(j)} vs ${e0}`);
  // Backlash with damping: no torque in the play, and τ never against the argument's sign.
  const beta = 0.0175, cc = 0.28;
  const b = run({ ...P, c: cc, backlash: 1, beta }, { u: sig(1, 8), Ts: 0.0001, T: 0.5, JL });
  b.signals.tau.forEach((tq, j) => {
    const x = b.signals.delta[j] + (cc / k) * (b.signals.w[j] - b.signals.lw[j]);
    if (Math.abs(x) < beta / 2) assert.equal(tq, 0);
    else assert.ok(tq * x >= 0);
  });
  // The step bound sees the gear: a stiffer gear, more substeps.
  assert.ok(run({ ...P, k: 100 * k }, { Ts: 0.001, T: 0.05, JL }).info.substeps > run({ ...P, k }, { Ts: 0.001, T: 0.05, JL }).info.substeps);
});

// ---- The examples on the component, against main's (servo.md §12.4) ----------
import { SYSTEM_LIBRARY, SYSTEM_PARTS, applySystem } from '../src/core/systems.js';
import { normalizeProject, evaluateSystem, autoTimebase } from '../src/core/project.js';
import { legacyMotorDiagram, legacyEncoderDiagram } from './fixtures/legacy-motors.mjs';

const runEntry = (entry, diagram, variant) => {
  const e = { ...entry, plant: { ...entry.plant, diagram: { ...diagram, blocks: diagram.blocks.map((b) => (b.id === 'ctrl' ? { ...b, variant } : b)) } } };
  const p = normalizeProject(applySystem(normalizeProject({}), e, SYSTEM_PARTS.filter((k) => e[k])));
  p.scope.timebase = autoTimebase(p);
  return evaluateSystem(p);
};
// The largest difference of any signal both runs have, relative to its peak.
const worst = (a, b) => Math.max(...Object.keys(a.signals).filter((k) => k in b.signals).map((k) => {
  let d = 0, m = 0;
  for (let i = 0; i < a.t.length; i++) { d = Math.max(d, Math.abs(a.signals[k][i] - b.signals[k][i])); m = Math.max(m, Math.abs(a.signals[k][i])); }
  return m ? d / m : d;
}));

test('the DC motor examples on the Servo motor run as main\'s, every variant, to 10⁻¹²', () => {
  for (const name of ['DC motor, position control', 'Following a sine (XY)', 'DC motor, sliding mode']) {
    const entry = SYSTEM_LIBRARY.find((e) => e.name === name), now = entry.plant.diagram;
    const c = now.blocks.find((b) => b.id === 'ctrl');
    const old = legacyMotorDiagram(c.variants, { inputs: c.params.inputs, Ts: c.params.Ts });
    for (let v = 0; v < c.variants.length; v++) {
      const a = runEntry(entry, old, v), b = runEntry(entry, now, v);
      assert.equal(b.info.substeps, a.info.substeps, `${name} · ${c.variants[v].name}`);
      assert.ok(worst(a, b) < 1e-12, `${name} · ${c.variants[v].name}: ${worst(a, b)}`);
    }
  }
});

test('the encoder example on the Servo motor runs as main\'s to 10⁻⁹ (the motor owns its friction)', () => {
  const entry = SYSTEM_LIBRARY.find((e) => e.name === 'Encoder errors and torque ripple');
  const a = runEntry(entry, legacyEncoderDiagram(), 0), b = runEntry(entry, entry.plant.diagram, 0);
  assert.equal(b.info.substeps, a.info.substeps);
  assert.ok(worst(a, b) < 1e-9, `${worst(a, b)}`);
});

// ---- Gear backlash (servo.md §7.4, §12.5) -------------------------------------
const GB = SYSTEM_LIBRARY.find((e) => e.name === 'Gear backlash');
const HOLDS = [[1.0, 1.5], [2.25, 2.75], [3.5, 4.0], [4.75, 5.0]];   // the last half of each hold
function backlash({ variant = 0, feedback = 1, motor = {} } = {}) {
  const p = normalizeProject(applySystem(normalizeProject({}), GB, SYSTEM_PARTS.filter((k) => GB[k])));
  const d = p.system.plant.diagram;
  d.blocks.find((b) => b.id === 'ctrl').variant = variant;
  d.blocks.find((b) => b.id === 'fb').params.position = feedback;
  Object.assign(d.blocks.find((b) => b.id === 'motor').params, motor);
  p.scope.timebase = autoTimebase(p);
  const r = evaluateSystem(normalizeProject(p));
  // Per hold: the load error's peak to peak, its largest size, and how often
  // the gear's torque changes sign (twice per cycle of hunting).
  let pp = 0, eMax = 0, n = 0, flips = 0;
  for (const [a, b] of HOLDS) {
    let lo = Infinity, hi = -Infinity, last = 0;
    for (let k = 0; k < r.t.length; k++) if (r.t[k] >= a && r.t[k] < b) {
      const e = r.signals.e_L[k]; lo = Math.min(lo, e); hi = Math.max(hi, e); eMax = Math.max(eMax, Math.abs(e)); n++;
      const tq = r.signals.tau[k], sg = Math.abs(tq) > 1e-3 ? Math.sign(tq) : 0;
      if (sg && last && sg !== last) flips++;
      if (sg) last = sg;
    }
    pp = Math.max(pp, hi - lo);
  }
  return { pp, eMax, flipsPerS: flips / (n * (r.t[1] - r.t[0])), run: r };
}
const BETA = Math.PI / 180;

test('Gear backlash: the load-encoder loop hunts, with PID and with PD; the amplitude follows the play', () => {
  for (const variant of [0, 1]) {
    const h = backlash({ variant });
    assert.ok(h.pp > 0.8 * BETA, `${variant}: p-p ${h.pp}`);           // 20.6 mrad
    assert.ok(h.flipsPerS >= 20, `${variant}: ${h.flipsPerS} sign changes/s`);   // 62
  }
  const quarter = backlash({ motor: { beta: BETA / 4 } }), full = backlash();
  assert.ok(Math.abs(quarter.pp / full.pp - 0.25) < 0.05, `${quarter.pp} against ${full.pp}`);   // 5.12 against 20.6
});

test('Gear backlash: the motor encoder holds still, the load anywhere in the play; the dual loop holds; no play settles all', () => {
  const m = backlash({ feedback: 2 });
  assert.ok(m.pp < 1e-3 && m.flipsPerS === 0, `motor encoder p-p ${m.pp}`);
  assert.ok(m.eMax <= BETA / 2 + 1e-4, `off by ${m.eMax}, at most half the play`);
  for (const motor of [{}, { k: 70.2, c: 0.1117 }]) {   // 50 Hz and 20 Hz
    const d = backlash({ variant: 2, motor });
    assert.ok(d.pp < 0.5e-3 && d.flipsPerS === 0, `dual loop ${JSON.stringify(motor)}: p-p ${d.pp}, ${d.flipsPerS}/s`);
  }
  for (const variant of [0, 1, 2]) {
    const s = backlash({ variant, motor: { backlash: 0 } });
    assert.ok(s.pp < 1e-3 && s.flipsPerS < 5, `${variant} without play: p-p ${s.pp}, ${s.flipsPerS}/s`);
  }
});
