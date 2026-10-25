// Live (HIL): the plant is a black box (input 20). The library's HIL systems
// are a controller against one External plant block and nothing else; the
// block's ports, and the Sinks and channels around it, come from the plant's
// description; a disturbance only where the plant offers one (hil_plant.py
// --dyno). See design/output/hil.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDescription, externalParams, sameDescription, interfaceOf } from '../src/core/hil.js';
import { followPorts, createLiveRunner, liveProblem } from '../src/core/live.js';
import { normalizeDiagram, diagramNames } from '../src/core/diagram.js';
import { normalizeReference } from '../src/core/signals.js';
import { runPlant, pyProbe } from './plant.mjs';

const library = async () => (await import('../src/core/systems.js')).SYSTEM_LIBRARY;
const hilSystems = async () => (await library()).filter((s) => s.plant.diagram.blocks.some((b) => b.type === 'external'));
const signalsOf = (sys) => Object.fromEntries(Object.entries(sys.input.signals).map(([k, v]) => [k, normalizeReference(v)]));

test('the HIL systems: a controller against one External plant block and nothing else on the plant side', async () => {
  const sys = await hilSystems();
  assert.deepEqual(sys.map((s) => s.name), ['HIL: an external plant', 'HIL with an agent']);
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
  const [control] = await hilSystems();
  const f = interfaceOf(normalizeDiagram(control.plant.diagram).blocks.find((b) => b.type === 'external').params);
  assert.equal(f.mode, 'control');
  assert.deepEqual(f.inputs, [{ name: 'V', unit: 'V', fullScale: [-12, 12], safe: 0, kind: 'effort', measures: null }]);
  assert.deepEqual(f.outputs.map((o) => [o.name, o.unit, o.hard, o.kind]), [['angle', 'rad', [-2.5, 2.5], 'measurement'], ['speed', 'rad/s', [-60, 60], 'measurement'], ['current', 'A', [-10, 10], 'measurement']]);
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

test('hil_plant.py: no disturbance input unless --dyno offers one; the library matches the default (when uv can run it here)', async (t) => {
  const py = (args) => { const out = runPlant(['--describe', ...args]); return out === null ? null : JSON.parse(out); };
  const plain = py([]);
  if (!plain) { t.skip('uv with websockets and mini-racer in its cache is not here'); return; }
  const dyno = py(['--dyno']), ref = py(['--mode', 'reference', '--dyno']), oven = py(['--model', 'Oven, badly tuned', '--dyno']), enc = py(['--model', 'Encoder errors and torque ripple', '--dyno']);
  assert.deepEqual(plain.inputs.map((p) => p.name), ['V']);
  assert.deepEqual(dyno.inputs.map((p) => [p.name, p.kind]), [['V', 'effort'], ['load', 'disturbance']]);
  assert.deepEqual(ref.inputs.map((p) => [p.name, p.kind]), [['r', 'reference'], ['load', 'disturbance']]);
  assert.deepEqual(oven.inputs.map((p) => [p.name, p.kind]), [['P', 'effort'], ['d', 'disturbance']], 'the oven offers its door loss');
  assert.deepEqual(enc.inputs.map((p) => p.name), ['V'], 'the encoder example has no disturbance Source to offer');
  const [control, agent] = await hilSystems();
  const block = (s) => normalizeDiagram(s.plant.diagram).blocks.find((b) => b.type === 'external');
  assert.ok(sameDescription(block(control).params, checkDescription(plain)), 'connecting the library system to the default plant changes nothing');
  assert.ok(sameDescription(block(agent).params, checkDescription(plain)), 'HIL with an agent: the same interface');
  assert.ok(!sameDescription(block(control).params, checkDescription(dyno)), 'with --dyno the block takes the load input, an ordinary described input');
  // Without --dyno the model's load holds 0: the plant on one input runs as
  // the plant with --dyno whose load is 0.
  const out = pyProbe(`
for dyno in (False, True):
    p = m.Plant(args(dyno=dyno, vary=0.15, seed=4))
    p.running = True
    p.u = [1.0] + ([0.0] if dyno else [])
    for k in range(50):
        p.cycle(0.0, 0.0, p.dt)
    print(p.applied(), p.last_y)
    p.model.close()
`);
  const [one, two] = out.trim().split('\n');
  assert.ok(one.startsWith('[1.0] ') && two.startsWith('[1.0, 0.0] '), out);
  assert.equal(one.slice(6), two.slice(11), 'the same outputs');
  assert.ok(!/nan/.test(one) && JSON.parse(one.slice(6))[0] > 0.05, 'the arm moved, untripped');
});

// Reference mode is a switch (input 31): the example plant described in
// reference mode, as hil_plant.py --mode reference describes it.
const REFERENCE = {
  protocol: 'loop-tuner-hil/1', name: 'DC motor with an unbalanced arm', mode: 'reference', rate_hz: 100,
  inputs: [{ name: 'r', unit: 'rad', min: -3, max: 3, safe: 0, kind: 'reference', measures: 'angle' }],
  outputs: [{ name: 'angle', unit: 'rad', min: -Math.PI, max: Math.PI, hard_min: -2.5, hard_max: 2.5 }, { name: 'speed', unit: 'rad/s', min: -120, max: 120, hard_min: -60, hard_max: 60 }, { name: 'current', unit: 'A', min: -12, max: 12, hard_min: -10, hard_max: 10 }, { name: 'V', unit: 'V', min: -12, max: 12, kind: 'effort' }],
};
const wired = (d) => d.wires.map((w) => `${w.from}>${w.to}`).sort();

test('the mode switch: in reference mode r goes straight to the plant and its own effort comes back; control mode puts the Controller back', async () => {
  const { sys, d, next, sinks } = await take(REFERENCE);
  const ext = next.blocks.find((b) => b.type === 'external');
  const g = interfaceOf(ext.params);
  assert.deepEqual([g.mode, g.inputs[0].measures, g.outputs.at(-1).kind], ['reference', 'angle', 'effort']);
  assert.ok(wired(next).includes('r>plant'), 'r feeds the plant');
  assert.ok(!wired(next).some((w) => w.startsWith('ctrl>plant')), 'the page\'s Controller drives nothing');
  assert.ok(wired(next).includes('plant:3>V'), 'the Sink V shows the plant\'s own effort');
  assert.deepEqual(sinks.find(([n]) => n === 'V'), ['V', 'V']);
  assert.equal(liveProblem(next), null, 'Run is not refused');
  // And back: the diagram is the library's again.
  const control = d.blocks.find((b) => b.type === 'external').params;
  const back = followPorts(next, ext.id, ext.params, control);
  const again = normalizeDiagram({ ...next, blocks: back.blocks.map((b) => (b.id === ext.id ? { ...b, params: control } : b)), wires: back.wires });
  assert.deepEqual(wired(again), wired(normalizeDiagram(sys.plant.diagram)));
  assert.deepEqual(again.blocks.map((b) => b.id).sort(), normalizeDiagram(sys.plant.diagram).blocks.map((b) => b.id).sort());
  assert.equal(liveProblem(again), null);
});
