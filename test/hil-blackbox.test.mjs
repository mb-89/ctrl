// Live (HIL): the plant is a black box (input 20). The library's HIL systems
// are a controller against one External plant block and nothing else; the
// block's ports, and the Sinks and channels around it, come from the plant's
// description; a disturbance only where the plant offers one (hil_plant.py
// --dyno). See design/output/hil.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { checkDescription, externalParams, sameDescription, interfaceOf } from '../src/core/hil.js';
import { followPorts, createLiveRunner, liveProblem } from '../src/core/live.js';
import { normalizeDiagram, diagramNames } from '../src/core/diagram.js';
import { normalizeReference } from '../src/core/signals.js';
import { SCRIPT } from './plant.mjs';

const library = async () => (await import('../src/core/systems.js')).SYSTEM_LIBRARY;
const hilSystems = async () => (await library()).filter((s) => s.plant.diagram.blocks.some((b) => b.type === 'external'));
const signalsOf = (sys) => Object.fromEntries(Object.entries(sys.input.signals).map(([k, v]) => [k, normalizeReference(v)]));

test('the HIL systems: a controller against one External plant block and nothing else on the plant side', async () => {
  const sys = await hilSystems();
  assert.deepEqual(sys.map((s) => s.name), ['HIL: an external plant', 'HIL: an external plant, reference mode']);
  for (const s of sys) {
    const types = new Set(s.plant.diagram.blocks.map((b) => b.type));
    assert.deepEqual([...types].filter((t) => !['source', 'controller', 'external', 'sink'].includes(t)), [], `${s.name}: no model of the plant`);
    assert.equal(s.plant.diagram.blocks.filter((b) => b.type === 'external').length, 1);
    assert.deepEqual(diagramNames(s.plant.diagram).sources, ['r'], `${s.name}: no disturbance the plant does not offer`);
    assert.deepEqual(Object.keys(s.input.signals), ['r']);
    assert.ok(!s.plant.views?.length, `${s.name}: no picture`);
    assert.equal(s.ui.view, 'Interface');
    assert.ok(s.tags.some((t) => t.label === 'Black box' && t.kind === 'plant') && !s.tags.some((t) => ['Linear', 'Nonlinear'].includes(t.label)));
    assert.ok(/black box/.test(s.notes) && /identif/.test(s.notes), `${s.name}: its notes say the page does not know what is inside`);
    assert.equal(liveProblem(normalizeDiagram(s.plant.diagram)), null);
  }
});

test('the interface: all the page knows, from the block as describe set it', async () => {
  const [control, reference] = await hilSystems();
  const f = interfaceOf(normalizeDiagram(control.plant.diagram).blocks.find((b) => b.type === 'external').params);
  assert.equal(f.mode, 'control');
  assert.deepEqual(f.inputs, [{ name: 'V', unit: 'V', fullScale: [-12, 12], safe: 0, kind: 'effort', measures: null }]);
  assert.deepEqual(f.outputs.map((o) => [o.name, o.unit, o.hard, o.kind]), [['angle', 'rad', [-2.5, 2.5], 'measurement'], ['speed', 'rad/s', [-60, 60], 'measurement'], ['current', 'A', [-10, 10], 'measurement']]);
  const g = interfaceOf(normalizeDiagram(reference.plant.diagram).blocks.find((b) => b.type === 'external').params);
  assert.deepEqual([g.mode, g.inputs[0].measures, g.outputs.at(-1).kind, g.outputs.at(-1).hard], ['reference', 'angle', 'effort', null]);
});

// What the page draws is what the plant describes: here the library system
// meets the example's heater (other inputs, one output) and a plant that
// renames and adds outputs.
const HEATER = { protocol: 'loop-tuner-hil/1', name: 'heater', rate_hz: 100, inputs: [{ name: 'P', unit: '%', min: 0, max: 100, safe: 0, kind: 'effort' }], outputs: [{ name: 'T', unit: '°C', min: 0, max: 120, hard_min: 0, hard_max: 110 }] };
const WIDER = { ...HEATER, inputs: [{ name: 'V', unit: 'V', min: -12, max: 12, safe: 0, kind: 'effort' }, { name: 'd', unit: 'N·m', min: -1, max: 1, safe: 0, kind: 'disturbance' }], outputs: [{ name: 'theta', unit: 'rad' }, { name: 'speed', unit: 'rad/s' }, { name: 'current', unit: 'A' }, { name: 'temp', unit: '°C' }] };
async function take(desc, edit = (d) => d) {
  const [sys] = await hilSystems();
  const d = edit(normalizeDiagram(structuredClone(sys.plant.diagram)));
  const ext = d.blocks.find((b) => b.type === 'external');
  const now = externalParams(checkDescription(desc), ext.params);
  const out = followPorts(d, ext.id, ext.params, now);
  const next = normalizeDiagram({ ...d, blocks: out.blocks.map((b) => (b.id === ext.id ? { ...b, params: now } : b)), wires: out.wires });
  return { sys, d, next, renamed: out.renamed, sinks: next.blocks.filter((b) => b.type === 'sink').map((b) => [b.params.name, b.params.unit]) };
}

test('connecting to a plant with other ports: the block takes them, and the Sinks and channels follow the outputs', async () => {
  // The heater: one input that is not V, one output.
  const h = await take(HEATER);
  assert.deepEqual(h.sinks, [['T', '°C'], ['V', 'V']], 'angle\'s Sink is now T; speed and current went with their ports; the controller\'s V stays');
  assert.deepEqual(h.renamed, { angle: 'T', speed: null, current: null }, 'what the scope\'s channels follow');
  assert.ok(!h.next.wires.some((w) => w.to === 'plant'), 'what fed V does not feed P');
  assert.ok(h.next.wires.some((w) => w.from === 'plant' && w.to === 'ctrl:1'), 'the controller still measures the first output');
  const run = createLiveRunner(h.next, signalsOf(h.sys));
  assert.deepEqual(run.port.inputs, ['P']);
  assert.deepEqual(run.step(0, [21]).u, [0], 'it runs: P unwired is 0');
  // More outputs, one renamed, and a disturbance input the plant offers.
  const w = await take(WIDER);
  assert.deepEqual(w.sinks.map(([n]) => n).sort(), ['V', 'current', 'speed', 'temp', 'theta']);
  assert.deepEqual(w.renamed, { angle: 'theta' });
  assert.ok(w.next.wires.some((x) => x.from === 'plant:3' && w.next.blocks.find((b) => b.id === x.to)?.params.name === 'temp'), 'a new output gets a Sink, wired');
  assert.ok(w.next.wires.some((x) => x.from === 'ctrl' && x.to === 'plant'), 'V is still V');
  assert.ok(!w.next.wires.some((x) => x.to === 'plant:1'), 'd is offered, and left to the person to wire');
  assert.deepEqual(createLiveRunner(w.next, signalsOf(w.sys)).step(0, [0, 0, 0, 20]).u, [0, 0]);
  // A Sink the person named stays as it is.
  const own = await take(HEATER, (d) => { d.blocks.find((b) => b.id === 'angle').params.name = 'arm'; return d; });
  assert.ok(own.sinks.some(([n]) => n === 'arm') && !own.sinks.some(([n]) => n === 'T'), 'the person\'s name stays; T has a Sink already (port 0 is wired)');
  // The same ports change nothing.
  const [sys] = await hilSystems();
  const d = normalizeDiagram(sys.plant.diagram), ext = d.blocks.find((b) => b.type === 'external');
  const same = followPorts(d, ext.id, ext.params, ext.params);
  assert.deepEqual([same.blocks, same.wires, same.renamed], [d.blocks, d.wires, {}]);
});

test('hil_plant.py: no disturbance input unless --dyno offers one; the library matches the default (when python3 is here)', async (t) => {
  const py = (args) => JSON.parse(execFileSync('python3', ['-I', '-B', SCRIPT, '--describe', ...args]).toString());
  let plain;
  try { plain = py([]); } catch (err) { if (err.code === 'ENOENT') { t.skip('no python3'); return; } throw err; }
  const dyno = py(['--dyno']), ref = py(['--mode', 'reference', '--dyno']), heater = py(['--plant', 'heater', '--dyno']);
  assert.deepEqual(plain.inputs.map((p) => p.name), ['V']);
  assert.deepEqual(dyno.inputs.map((p) => [p.name, p.kind]), [['V', 'effort'], ['load', 'disturbance']]);
  assert.deepEqual(ref.inputs.map((p) => [p.name, p.kind]), [['r', 'reference'], ['load', 'disturbance']]);
  assert.deepEqual(heater.inputs.map((p) => p.name), ['P'], 'the heater has none to offer');
  const [control, reference] = await hilSystems();
  const block = (s) => normalizeDiagram(s.plant.diagram).blocks.find((b) => b.type === 'external');
  assert.ok(sameDescription(block(control).params, checkDescription(plain)), 'connecting the library system to the default plant changes nothing');
  assert.ok(sameDescription(block(reference).params, checkDescription(py(['--mode', 'reference']))));
  assert.ok(!sameDescription(block(control).params, checkDescription(dyno)), 'with --dyno the block takes the load input, an ordinary described input');
  // Without --dyno the model's load holds its safe value: the plant runs on
  // one input (the physics is unchanged).
  const probe = `
import importlib.util, sys, types
spec = importlib.util.spec_from_file_location('hp', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.say = lambda text: None
for dyno in (False, True):
    a = types.SimpleNamespace(rate=100.0, plant='motor', mode='control', setpoint=None, log=None, bench=0, watchdog=10, slew=0.0, vary=0.0, seed=1, set=[], allow_origin=[], strict_origin=False, dyno=dyno)
    p = m.Plant(a)
    p.u = [3.0] + ([0.1] if dyno else [])
    print(p.applied())
`;
  assert.deepEqual(execFileSync('python3', ['-I', '-B', '-c', probe, SCRIPT]).toString().trim().split('\n'), ['[3.0, 0.0]', '[3.0, 0.1]']);
});
