// The HIL simulator's core (src/core/hilsim.js; design/output/hil-simulator.md):
// the plant is the page's simulation of the same model, sample for sample;
// the draws are seeded; the interface is the model's; the zip's core is the
// page's own. And the page's library runs as it did before the simulator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { simPlant, createSimPlant, simModels, drawSystem, varyDiagram, simulatorCore, rangesFrom, seededRandom, listModels, DEFAULT_MODEL } from '../src/core/hilsim.js';
import { simulateSystem } from '../src/core/sim.js';
import { checkDescription } from '../src/core/hil.js';
import { normalizeDiagram } from '../src/core/diagram.js';
import { plantFiles } from '../src/ui/live.js';
import { bundleScript } from '../build.mjs';
import { libraryFingerprints } from '../tools/library-fingerprints.mjs';

const FINGERPRINTS = JSON.parse(readFileSync(new URL('./fixtures/library-fingerprints.json', import.meta.url), 'utf8'));

test('every library system runs in the page bit for bit as before the simulator', () => {
  const now = libraryFingerprints();
  for (const [name, fp] of Object.entries(FINGERPRINTS)) assert.deepEqual(now[name], fp, name);
});

// Feeds the plant the u the page's simulation computed, a cycle at a time,
// and compares every output at every sample. The disturbance Sources play
// nothing on either side: the page's RK4 reads a Source at the end of its
// step, which an input held over the cycle cannot (a held input equals a
// continuous one only where it is constant over the step).
function samePlant(entry, opts = {}) {
  const ctrl = entry.diagram.blocks.find((b) => b.type === 'controller');
  const rate = ctrl ? 1 / ctrl.params.Ts : 100;
  const spec = simPlant({ model: entry.name, rate, vary: 0, detail: (entry.effects ?? []).map((f) => f.name), ...opts });
  const plant = createSimPlant(spec);
  const signals = structuredClone(entry.signals);
  if (ctrl) for (const n of Object.keys(signals)) if (n !== 'r') signals[n] = { period: signals[n].period, components: [] };
  const loop = opts.vary ? normalizeDiagram(withSinks(varyDiagram(entry, opts.vary, opts.seed), spec.loop)) : spec.loop;
  const page = simulateSystem(loop, signals, { duration: 1.5, sampleTime: 1 / rate });
  let diffs = 0, compared = 0;
  for (let k = 0; k < page.t.length - 1; k++) {
    plant.advance(1 / rate, spec.inputs.map((p) => (p.kind === 'effort' && ctrl ? page.signals[`${ctrl.id}.u`][k] : page.signals[p.name][k])));
    const y = plant.outputs();
    spec.outputs.forEach((o, j) => { compared++; if (!Object.is(y[j], page.signals[o.name][k + 1])) diffs++; });
  }
  return { diffs, compared, spec };
}
// The Sinks the plant added for measurements without one, put on a diagram.
function withSinks(diagram, loop) {
  const d = structuredClone(diagram);
  for (const b of loop.blocks) if (b.id.startsWith('hil_')) d.blocks.push(b);
  for (const w of loop.wires) if (w.to.startsWith('hil_')) d.wires.push(w);
  return d;
}

test('the plant is the page\'s simulation of the same model, sample for sample, for every library system', () => {
  assert.equal(simModels().length, 11, 'every library system but the HIL ones');
  for (const e of simModels()) {
    const { diffs, compared } = samePlant(e);
    assert.ok(compared > 50, e.name);
    assert.equal(diffs, 0, `${e.name}: ${diffs} of ${compared} samples differ`);
  }
});

test('with the same draws: the varied plant is the page\'s simulation of the varied diagram, sample for sample', () => {
  for (const name of [DEFAULT_MODEL, 'Triple pendulum', 'Encoder errors and torque ripple', 'Conical tank, gain scheduling']) {
    const e = simModels().find((x) => x.name === name);
    const { diffs, compared, spec } = samePlant(e, { vary: 0.15, seed: 11 });
    assert.equal(diffs, 0, `${name}: ${diffs} of ${compared} differ`);
    assert.ok(spec.draws.params.some((p) => p.value !== p.nominal), `${name} was varied`);
  }
});

test('the draws are seeded: the same seed the same plant, another seed another, within ±vary, ties kept, nothing else touched', () => {
  const a = drawSystem({ seed: 7 }), b = drawSystem({ seed: 7 }), c = drawSystem({ seed: 8 });
  assert.deepEqual(a.params, b.params);
  assert.deepEqual(a.diagram, b.diagram);
  assert.notDeepEqual(a.params.map((p) => p.value), c.params.map((p) => p.value));
  for (const p of a.params) assert.ok(Math.abs(p.value / p.nominal - 1) <= 0.15 + 1e-12, p.name);
  const K = a.params.find((p) => p.name === 'K'), Ke = a.params.find((p) => p.name === 'Ke');
  assert.equal(Ke.value / Ke.nominal, K.value / K.nominal, 'Ke follows K: one number');
  assert.equal(new Set(a.params.map((p) => p.value / p.nominal)).size, a.params.length - 1, 'each other parameter its own factor');
  // Only the flagged parameters change: the controller, the Sources and g stay.
  const nominal = simModels().find((e) => e.name === DEFAULT_MODEL).diagram;
  assert.deepEqual(a.diagram.blocks.find((x) => x.id === 'ctrl'), nominal.blocks.find((x) => x.id === 'ctrl'));
  const tri = drawSystem({ model: 'Triple pendulum', seed: 3 });
  const cart = (d) => d.blocks.find((x) => x.id === 'cart').params;
  const tn = cart(simModels().find((e) => e.name === 'Triple pendulum').diagram);
  assert.equal(cart(tri.diagram).g, tn.g, 'g is not the plant\'s');
  assert.equal(cart(tri.diagram).theta10, tn.theta10, 'nor its start');
  assert.notEqual(cart(tri.diagram).M, tn.M);
  // --set after the draw; a tie follows it.
  const set = drawSystem({ seed: 7, set: { K: 0.2 } });
  assert.equal(set.params.find((p) => p.name === 'K').value, 0.2);
  assert.equal(set.params.find((p) => p.name === 'Ke').value, 0.2);
  assert.throws(() => drawSystem({ set: { X: 1 } }), /--set X: not a physical parameter of DC motor with an unbalanced arm; its parameters: R, L, K, Ke, J, b, Tc, mgl/);
  // vary 0: nominal.
  for (const p of drawSystem({ vary: 0, seed: 5 }).params) assert.equal(p.value, p.nominal);
  // The generator is the core's own, the same in every engine.
  const r = seededRandom(42);
  assert.deepEqual([r(), r()].map((x) => Math.round(x * 1e6)), [Math.round(seededRandom(42)() * 1e6), Math.round((() => { const g = seededRandom(42); g(); return g(); })() * 1e6)]);
});

test('effects switch: at random from the seed, all, none, or by name; an unknown one is refused with the names', () => {
  const name = 'Encoder errors and torque ripple';
  const names = simModels().find((e) => e.name === name).effects.map((f) => f.name);
  assert.deepEqual(names, ['torque ripple', 'torque noise', 'shaft resonance', 'encoder errors']);
  const on = (detail, seed = 1) => drawSystem({ model: name, detail, seed }).effects.filter((f) => f.on).map((f) => f.name);
  assert.deepEqual(on('all'), names);
  assert.deepEqual(on('none'), []);
  assert.deepEqual(on('shaft resonance, torque ripple'), ['torque ripple', 'shaft resonance']);
  assert.deepEqual(on('random', 9), on('random', 9), 'seeded');
  const draws = new Set(Array.from({ length: 12 }, (_, s) => on('random', s + 1).join('|')));
  assert.ok(draws.size > 4, 'random draws differ');
  assert.throws(() => on('backlash'), /--detail: no effect "backlash" in Encoder errors and torque ripple; its effects: torque ripple, torque noise, shaft resonance, encoder errors/);
  // Off is the block replaced by a Gain: 0 for what an effect adds, 1 for what it passes on.
  const d = drawSystem({ model: name, detail: 'none' }).diagram;
  assert.deepEqual(['ripple', 'rough', 'shaft', 'enc'].map((id) => [d.blocks.find((b) => b.id === id).type, d.blocks.find((b) => b.id === id).params.K]), [['gain', 0], ['gain', 1], ['gain', 1], ['gain', 1]]);
  // The arm's Coulomb friction off: the plant runs on without it.
  const arm = drawSystem({ detail: 'none' }).diagram.blocks.find((b) => b.id === 'motor').diagram.blocks.find((b) => b.id === 'sgn');
  assert.deepEqual([arm.type, arm.params.K], ['gain', 0]);
});

test('random mode: a model of the library, the same for a seed', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const a = simPlant({ random: true, seed }), b = simPlant({ random: true, seed });
    assert.equal(a.draws.system, b.draws.system);
    assert.ok(simModels().some((e) => e.name === a.draws.system));
    assert.equal(a.name, 'Simulated plant', 'its name says nothing of the model');
    checkDescription({ protocol: 'loop-tuner-hil/1', rate_hz: 100, inputs: a.inputs, outputs: a.outputs });
    seen.add(a.draws.system);
  }
  assert.ok(seen.size >= 6, `${seen.size} different models in 40 seeds`);
});

test('the description is the model\'s: inputs, outputs, units, kinds, full scales and hard ranges, in every mode', () => {
  const desc = (opts) => { const s = simPlant({ vary: 0, detail: 'all', ...opts }); return checkDescription({ protocol: 'loop-tuner-hil/1', rate_hz: 100, mode: s.mode, inputs: s.inputs, outputs: s.outputs }); };
  // The arm, as the plant always described itself.
  const arm = desc({});
  assert.deepEqual(arm.inputs.map((p) => [p.name, p.unit, p.min, p.max, p.safe, p.kind]), [['V', 'V', -12, 12, 0, 'effort']]);
  assert.deepEqual(arm.outputs.map((p) => [p.name, p.unit, p.min, p.max, p.hard_min, p.hard_max]), [['angle', 'rad', -Math.PI, Math.PI, -2.5, 2.5], ['speed', 'rad/s', -120, 120, -60, 60], ['current', 'A', -12, 12, -10, 10]]);
  const armRef = desc({ mode: 'reference', dyno: true });
  assert.deepEqual(armRef.inputs.map((p) => [p.name, p.kind, p.measures, p.min, p.max]), [['r', 'reference', 'angle', -3, 3], ['load', 'disturbance', '', -0.2, 0.2]]);
  assert.deepEqual(armRef.outputs.map((p) => [p.name, p.kind]), [['angle', 'measurement'], ['speed', 'measurement'], ['current', 'measurement'], ['V', 'effort']]);
  const armLog = desc({ mode: 'log' });
  assert.deepEqual([armLog.inputs.length, armLog.outputs.map((p) => p.name)], [0, ['angle', 'speed', 'current', 'V', 'setpoint']]);
  // The triple pendulum: its controller's eight measurements, named and in units.
  const tri = desc({ model: 'Triple pendulum' });
  assert.deepEqual(tri.inputs.map((p) => [p.name, p.unit, p.min, p.max]), [['F', 'N', -40, 40]], 'the effort\'s limits are the controller\'s');
  assert.deepEqual(tri.outputs.map((p) => `${p.name} ${p.unit}`), ['x m', 'theta1 rad', 'theta2 rad', 'theta3 rad', 'v m/s', 'omega1 rad/s', 'omega2 rad/s', 'omega3 rad/s']);
  for (const o of tri.outputs) assert.ok(o.min < o.hard_min && o.hard_max < o.max && o.hard_min < 0 && o.hard_max > 0, `${o.name}: the hard range inside the full scale, around 0`);
  // The sliding-mode motor: e = r − angle depends on r, which goes with the controller.
  assert.ok(!desc({ model: 'DC motor, sliding mode' }).outputs.some((o) => o.name === 'e'));
  // Without a controller: its Source is the effort; reference mode is refused.
  assert.deepEqual(desc({ model: 'Mass–spring–damper' }).inputs.map((p) => [p.name, p.kind]), [['F', 'effort']]);
  assert.throws(() => simPlant({ model: 'Mass–spring–damper', mode: 'reference' }), /has no controller of its own: run it in control mode/);
  // Every model in control mode, with and without --dyno.
  for (const e of simModels()) for (const dyno of [false, true]) desc({ model: e.name, dyno });
  assert.equal(listModels().split('\n').length, simModels().length);
});

test('ranges from a simulation: symmetric when they cross zero, with the hard range inside the full scale', () => {
  assert.deepEqual(rangesFrom(-0.5, 1.2), { scale: [-4.8, 4.8], hard: [-3.6, 3.6] });
  assert.deepEqual(rangesFrom(0, 300), { scale: [-600, 900], hard: [-300, 600] });
  assert.deepEqual(rangesFrom(20, 60), { scale: [-60, 140], hard: [-20, 100] });
  assert.deepEqual(rangesFrom(0, 0), { scale: [-1, 1], hard: [-1, 1] });
  assert.deepEqual(rangesFrom(NaN, 1), { scale: [-1, 1], hard: [-1, 1] });
});

test('the reference mode plant runs the model\'s own controller, gated off while stopped', () => {
  const spec = simPlant({ mode: 'reference', vary: 0, detail: 'all' });
  const p = createSimPlant(spec);
  const run = (n) => { for (let i = 0; i < n; i++) p.advance(0.01, [1]); return p.outputs(); };
  assert.deepEqual(run(100), [0, 0, 0, 0], 'stopped: no effort, the arm hangs');
  p.running(true);
  const [angle, , , V] = run(300);
  assert.ok(Math.abs(angle - 1) < 0.02 && V > 0, `running: its PID holds r (angle ${angle})`);
  p.running(false);
  assert.equal(run(1).at(-1), 0, 'stopped again: the safe effort at once');
});

test('the zip carries the page\'s own core; it runs in a bare V8 context, no DOM, no Node', () => {
  const script = bundleScript();
  const files = plantFiles(script);
  // (In Node the page's hil/ files are not bundled in; in the page they are, beside it.)
  assert.ok(script.includes('const __HIL_FILES = {"hil_plant.py"'), 'the page carries hil/');
  assert.equal(files['loop-tuner-core.js'], simulatorCore(script));
  assert.ok(!files['loop-tuner-core.js'].includes("__mods['ui/") && !files['loop-tuner-core.js'].includes('const __HIL_FILES'), 'the core only');
  assert.equal(readFileSync(new URL('../dist/hil-plant/loop-tuner-core.js', import.meta.url), 'utf8'), simulatorCore(script), 'the build writes the same');
  const ctx = vm.createContext({});
  vm.runInContext(files['loop-tuner-core.js'], ctx);
  const d = JSON.parse(vm.runInContext("LoopTunerCore['core/hilsim.js'].startSimPlant({ model: 'Triple pendulum', seed: 2 })", ctx));
  assert.equal(d.outputs.length, 8);
  const y = JSON.parse(vm.runInContext('JSON.stringify(__plant.cycle([[0.01, [1]]]))', ctx));
  assert.equal(y.length, 8);
  assert.ok(y.every(Number.isFinite));
});
