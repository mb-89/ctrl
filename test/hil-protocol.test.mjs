// Live (HIL), the protocol additions for identification (identification.md
// §15, test 15 of §17): each output's hard range in describe (hard_min …
// hard_max, beyond which the plant E-stops), the inputs the plant applied in
// each y (applied), the External block's ymin/ymax, the live record's
// applied.NAME signals; and both ways back: an old plant with this page, this
// plant with an old page. See design/output/hil.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { checkDescription, externalParams, sameDescription, parseMessage, EXTERNAL_BLOCK } from '../src/core/hil.js';
import { createLiveLoop } from '../src/core/live.js';
import { normalizeDiagram } from '../src/core/diagram.js';
import { normalizeReference } from '../src/core/signals.js';
import { SCRIPT, startPlant, connectPlant } from './plant.mjs';

const OLD = {
  protocol: 'loop-tuner-hil/1', name: 'fake', rate_hz: 100, running: false, estop: null,
  inputs: [{ name: 'V', unit: 'V', min: -12, max: 12, safe: 0, kind: 'effort' }, { name: 'load', unit: 'N·m', min: -0.2, max: 0.2, safe: 0, kind: 'disturbance' }],
  outputs: [{ name: 'angle', unit: 'rad', min: -Math.PI, max: Math.PI }, { name: 'speed', unit: 'rad/s', min: -120, max: 120 }, { name: 'current', unit: 'A', min: -12, max: 12 }],
};
const NEW = { ...OLD, outputs: OLD.outputs.map((o, j) => ({ ...o, hard_min: [-2.5, -60, -10][j], hard_max: [2.5, 60, 10][j] })) };

const tick = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };
const system = async (name = 'HIL: external motor') => (await import('../src/core/systems.js')).SYSTEM_LIBRARY.find((s) => s.name === name);
const signalsOf = (sys) => Object.fromEntries(Object.entries(sys.input.signals).map(([k, v]) => [k, normalizeReference(v)]));

// A fake plant that answers requests at once; the test sends its y.
function fakePlant(desc) {
  const sent = [];
  let sock = null;
  class FakeWS {
    constructor() { sock = this; this.readyState = 0; setTimeout(() => { this.readyState = 1; this.onopen?.(); }); }
    send(text) {
      const m = JSON.parse(text);
      sent.push(m);
      if (m.id !== undefined) setTimeout(() => this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: m.id, result: m.method === 'describe' ? desc : m.method === 'start' ? { rate_hz: 100 } : {} }) }));
    }
    close() { this.readyState = 3; setTimeout(() => this.onclose?.({ code: 1000, reason: '' })); }
  }
  return {
    env: { WebSocket: FakeWS, performance, setInterval: () => 1, clearInterval: () => {}, setTimeout },
    sent,
    y: (params) => sock.onmessage({ data: JSON.stringify({ jsonrpc: '2.0', method: 'y', params }) }),
  };
}
async function running(desc) {
  const sys = await system();
  const plant = fakePlant(desc), out = [];
  const loop = createLiveLoop((m) => out.push(m), plant.env);
  loop.handle({ type: 'program', diagram: normalizeDiagram(sys.plant.diagram), signals: signalsOf(sys) });
  loop.handle({ type: 'connect', url: 'ws://x' });
  await tick();
  loop.handle({ type: 'start' });
  await tick();
  return { loop, plant, out };
}

test('describe with output hard ranges parses, and the External block keeps them as ymin and ymax', () => {
  const d = checkDescription(NEW);
  assert.deepEqual(d.outputs.map((o) => [o.min, o.max, o.hard_min, o.hard_max]), [[-Math.PI, Math.PI, -2.5, 2.5], [-120, 120, -60, 60], [-12, 12, -10, 10]], 'the full scale and the hard range side by side');
  const p = externalParams(d);
  assert.deepEqual([p.ymin, p.ymax], [[-2.5, -60, -10], [2.5, 60, 10]]);
  assert.deepEqual([p.outMin, p.outMax], [[-Math.PI, -120, -12], [Math.PI, 120, 12]], 'full scales unchanged');
  assert.ok(sameDescription(p, d));
  assert.ok(!sameDescription({ ...p, ymax: [2, 60, 10] }, d), 'another hard range is another description: connecting takes it');
  // Either both or neither, numbers, hard_min < hard_max.
  const one = (o) => checkDescription({ ...OLD, outputs: [{ name: 'angle', unit: 'rad', ...o }] });
  assert.throws(() => one({ hard_min: -2.5 }), /outputs\[0\] needs hard_min < hard_max \(its hard range/);
  assert.throws(() => one({ hard_min: 2, hard_max: 1 }), /hard_min < hard_max/);
  assert.throws(() => one({ hard_min: 'a', hard_max: 1 }), /hard_min < hard_max/);
  assert.deepEqual([one({ hard_min: -1, hard_max: 1 }).outputs[0].min, one({ hard_min: -1, hard_max: 1 }).outputs[0].hard_max], [null, 1], 'a hard range without a full scale');
  // Typed in the Plant tab: an empty place is "not given".
  const typed = EXTERNAL_BLOCK.normalize({ inputs: 'V', outputs: 'a, b, c', ymin: '-1, , 3', ymax: '1, 2, 2' });
  assert.deepEqual([typed.ymin, typed.ymax], [[-1, null, null], [1, null, null]], 'incomplete or reversed pairs are not given');
  assert.ok(['ymin', 'ymax'].every((k) => EXTERNAL_BLOCK.params.some((q) => q.key === k)));
});

test('the library\'s HIL systems carry the plant\'s hard ranges', async () => {
  for (const name of ['HIL: external motor', 'HIL: external motor, reference mode']) {
    const b = (await system(name)).plant.diagram.blocks.find((x) => x.type === 'external');
    assert.deepEqual([b.params.ymin.slice(0, 3), b.params.ymax.slice(0, 3)], [[-2.5, -60, -10], [2.5, 60, 10]], name);
  }
});

test('y carries applied: parsed; the loop records it as applied.NAME signals with their units', async () => {
  assert.deepEqual(parseMessage('{"jsonrpc":"2.0","method":"y","params":{"seq":3,"t":0.03,"y":[1,2,3],"applied":[12,"x"]}}').applied, [12, NaN]);
  assert.equal(parseMessage('{"jsonrpc":"2.0","method":"y","params":{"seq":3,"t":0.03,"y":[1],"applied":"12"}}').applied, null, 'not a list: not given, the y stands');
  const { plant, out, loop } = await running(NEW);
  plant.y({ seq: 0, t: 0, y: [0, 0, 0], applied: [0, 0] });
  plant.y({ seq: 1, t: 0.01, y: [0.1, 0, 0], applied: [12, -0.2] });
  plant.y({ seq: 2, t: 0.02, y: [0.2, 0, 0] });
  assert.equal(plant.sent.filter((m) => m.method === 'u').length, 3, 'every y answered');
  loop.handle({ type: 'stop' });
  await tick();
  const batches = out.filter((m) => m.type === 'samples');
  const b = batches.at(-1);
  assert.deepEqual(b.names.slice(-2), ['applied.V', 'applied.load']);
  assert.deepEqual(b.units, { 'applied.V': 'V', 'applied.load': 'N·m' });
  const rows = batches.flatMap((x) => x.values.map((v) => v.slice(-2)));
  assert.deepEqual(rows.slice(0, 2), [[0, 0], [12, -0.2]], 'what the plant applied, after its clamps');
  assert.ok(rows[2].every(Number.isNaN), 'a y without applied: NaN, not a made-up value');
  assert.ok(batches.every((x) => x.values.every((v) => v.length === x.names.length)));
});

test('an old plant (no hard ranges, no applied) with this page: it connects, runs and records as before', async () => {
  const d = checkDescription(OLD);
  assert.ok(d.outputs.every((o) => o.hard_min === null && o.hard_max === null));
  assert.deepEqual(externalParams(d).ymin, [null, null, null]);
  const { plant, out, loop } = await running(OLD);
  for (let s = 0; s < 5; s++) plant.y({ seq: s, t: s / 100, y: [0, 0, 0] });
  await tick();
  loop.handle({ type: 'stop' });
  await tick();
  assert.equal(plant.sent.filter((m) => m.method === 'u').length, 5);
  const batches = out.filter((m) => m.type === 'samples'), b = batches.at(-1);
  assert.equal(batches.flatMap((x) => x.values).length, 5);
  assert.deepEqual(b.units, {});
  assert.ok(!b.names.some((n) => n.startsWith('applied.')), 'no applied columns');
  assert.ok(!out.some((m) => m.type === 'error' || m.type === 'estop'));
});

// The plant itself, without a server: its declared hard ranges are its
// monitoring, and the sentence names the output and the value.
test('hil_plant.py: an output beyond its hard range latches an E-stop that names it; --check shows it (when python3 is here)', (t) => {
  const probe = `
import importlib.util, json, sys, types
spec = importlib.util.spec_from_file_location('hp', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.say = lambda text: None
out = {}
for plant, mode in (('motor', 'control'), ('motor', 'reference'), ('heater', 'control')):
    a = types.SimpleNamespace(rate=100.0, plant=plant, mode=mode, setpoint=None, log=None, bench=0, watchdog=10, slew=0.0, vary=0.0, seed=1, set=[], allow_origin=[], strict_origin=False)
    p = m.Plant(a)
    out[plant + ' ' + mode] = [[o['name'], o.get('hard_min'), o.get('hard_max')] for o in p.describe()['outputs']]
    trips = []
    for y in ([2.4, 59, 9.9] + [0] * (len(p.outputs) - 3), [2.6, 0, 0] + [0] * (len(p.outputs) - 3), [-2.6, 0, 0] + [0] * (len(p.outputs) - 3), [0, 61, 0] + [0] * (len(p.outputs) - 3), [0, 0, -10.5] + [0] * (len(p.outputs) - 3), [0, 0, 0, 13]) if plant == 'motor' else ([109.9], [110.04], [-1]):
        p.running, p.estop_reason, p.estop_by = True, None, None
        p.monitor(y[:len(p.outputs)])
        trips.append(p.estop_reason)
    out[plant + ' ' + mode + ' trips'] = trips
print(json.dumps(out))
`;
  let res, check;
  try {
    res = execFileSync('python3', ['-I', '-B', '-c', probe, SCRIPT], { stdio: 'pipe' }).toString();
    check = ['motor', 'heater'].map((plant) => execFileSync('python3', ['-I', '-B', SCRIPT, '--check', '--plant', plant], { stdio: 'pipe' }).toString());
  } catch (err) {
    if (err.code === 'ENOENT') { t.skip('no python3'); return; }
    throw err;
  }
  const out = JSON.parse(res.trim().split('\n').at(-1));
  assert.deepEqual(out['motor control'], [['angle', -2.5, 2.5], ['speed', -60, 60], ['current', -10, 10]]);
  assert.deepEqual(out['motor reference'].at(-1), ['V', null, null], 'its own effort, an output it clamps, has no hard range');
  assert.deepEqual(out['heater control'], [['T', 0, 110]]);
  assert.deepEqual(out['motor control trips'], [null, 'angle 2.6 rad beyond 2.5', 'angle -2.6 rad beyond -2.5', 'speed 61 rad/s beyond 60', 'current -10.5 A beyond -10', null]);
  assert.deepEqual(out['motor reference trips'].at(-1), null, 'V beyond 12 is not monitored');
  assert.deepEqual(out['heater control trips'], [null, 'T 110.04 °C beyond 110', 'T -1 °C beyond 0']);
  assert.match(check[0], /E-stop after [\d.]+ s at full V: angle 2\.\d+ rad beyond 2\.5\n/);
  assert.match(check[1], /E-stop after [\d.]+ s at full P: T 110\.\d+ °C beyond 110\n/);
});

// The real plant over its socket, with test/plant.mjs's page, which knows
// nothing of the additions (the old page's view): describe's full scales and
// y's values are as before, the new fields only add. Full voltage swings the
// arm up beyond its hard range within a fraction of a second.
test('hil_plant.py echoes the inputs it applied after its clamps, and E-stops when the arm leaves its hard range; an old page runs it as before (when it can run here)', async (t) => {
  if (typeof WebSocket !== 'function') { t.skip('no WebSocket in this Node'); return; }
  const plant = await startPlant(['--seed', '1']);
  if (!plant) { t.skip('neither python3 with websockets nor uv with websockets in its cache'); return; }
  const page = await connectPlant(plant.port);
  try {
    const d = (await page.call('describe')).result;
    assert.deepEqual(d.outputs.map((o) => [o.name, Number(o.min.toFixed(4)), Number(o.max.toFixed(4))]), [['angle', -3.1416, 3.1416], ['speed', -120, 120], ['current', -12, 12]], 'min … max is still the full scale');
    assert.deepEqual(d.outputs.map((o) => [o.hard_min, o.hard_max]), [[-2.5, 2.5], [-60, 60], [-10, 10]]);
    page.answer([30, 'x']);  // beyond V's limit, and not a number
    await page.call('start');
    const estop = await page.until(() => page.notes.find((m) => m.method === 'estop'), 5000);
    assert.match(estop.params.reason, /^angle 2\.\d+ rad beyond 2\.5$/);
    const ys = page.notes.filter((m) => m.method === 'y');
    assert.ok(ys.length >= 5);
    assert.ok(ys.every((m) => Array.isArray(m.params.y) && m.params.y.length === 3), 'y as before');
    assert.deepEqual(ys[0].params.applied, [0, 0], 'the first cycle: the safe inputs');
    assert.deepEqual(ys.at(-1).params.applied, [12, 0], 'V 30 is applied as 12 V, its limit; load "x" as the safe 0');
    assert.ok(ys.every((m) => [0, 12].includes(m.params.applied[0]) && m.params.applied[1] === 0), 'only ever what it applied');
    assert.ok(ys.at(-1).params.y[0] <= 2.5, 'the y beyond the range is not sent: the E-stop comes in its place');
    assert.equal((await page.call('describe')).result.estop, estop.params.reason, 'latched');
    assert.deepEqual((await page.call('reset')).result, {}, 'the monitoring\'s E-stop is reset from either side');
  } finally {
    page.ws.close();
    plant.proc.kill('SIGINT');
    await Promise.race([plant.exited, new Promise((r) => setTimeout(r, 3000))]);
  }
});
