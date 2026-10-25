// Live (HIL), after review: keys pressed faster than the plant answers, the
// plant's frames in the order made, who may reset whose STOP, malformed
// messages, a cycle that fails, outputs that are not numbers, a control-mode
// system against a reference-mode plant, and the loop's answers to the API.
// See design/output/hil.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLiveLoop, createLiveRunner, liveProblem, keptWires, NAN_CYCLES } from '../src/core/live.js';
import { checkDescription, externalParams } from '../src/core/hil.js';
import { normalizeDiagram } from '../src/core/diagram.js';
import { normalizeReference } from '../src/core/signals.js';
import { SCRIPT, UV, startPlant, connectPlant, coreFile, pyProbe } from './plant.mjs';
import { buildHtml } from '../build.mjs';

const DESC = {
  protocol: 'loop-tuner-hil/1', name: 'fake', rate_hz: 100, running: false, estop: null,
  inputs: [{ name: 'V', unit: 'V', min: -12, max: 12, safe: 0, kind: 'effort' }, { name: 'load', unit: 'N·m', min: -0.2, max: 0.2, safe: 0, kind: 'disturbance' }],
  outputs: [{ name: 'angle', unit: 'rad', min: -3.14, max: 3.14 }, { name: 'speed', unit: 'rad/s' }, { name: 'current', unit: 'A' }],
};
// The same motor started with --mode reference: its first input is now r.
const REF_DESC = { ...DESC, inputs: [{ name: 'r', unit: 'rad', min: -3, max: 3, safe: 0, kind: 'reference', measures: 'angle' }, DESC.inputs[1]], outputs: [...DESC.outputs, { name: 'V', unit: 'V', min: -12, max: 12, kind: 'effort' }] };

const system = async (name = 'HIL: an external plant') => (await import('../src/core/systems.js')).SYSTEM_LIBRARY.find((s) => s.name === name);
const signalsOf = (sys) => Object.fromEntries(Object.entries(sys.input.signals).map(([k, v]) => [k, normalizeReference(v)]));
const program = (sys, diagram = sys.plant.diagram) => ({ type: 'program', diagram: normalizeDiagram(diagram), signals: signalsOf(sys) });
// Lets every chain of the fakes' zero-delay timers run out (a fixed wait
// would not, on a busy computer); with ms, waits that long.
const tick = async (ms = 0) => { if (ms) await new Promise((r) => setTimeout(r, ms)); for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };
const states = (out) => out.filter((m) => m.type === 'state').map((m) => `${m.state}${m.detail ? `:${m.detail}` : ''}`);

// A fake plant whose answers can be held back (a plant slow to start, a
// drive enabling) and then released in order. No watchdog timers.
function slowPlant(desc = DESC) {
  const sent = [], held = [];
  let sock = null, holding = false;
  class FakeWS {
    constructor() { sock = this; this.readyState = 0; setTimeout(() => { this.readyState = 1; this.onopen?.(); }); }
    send(text) {
      const m = JSON.parse(text);
      sent.push(m);
      if (m.id === undefined) return;
      const body = m.method === 'reset' && fake.refuseReset ? { error: { code: -32000, message: fake.refuseReset } } : { result: m.method === 'describe' ? desc : m.method === 'start' ? { rate_hz: 100 } : {} };
      const reply = () => this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: m.id, ...body }) });
      if (holding && m.method !== 'describe') held.push(reply); else setTimeout(reply);
    }
    close() { this.readyState = 3; setTimeout(() => this.onclose?.({ code: 1000, reason: '' })); }
  }
  const fake = {
    env: { WebSocket: FakeWS, performance, setInterval: () => 1, clearInterval: () => {}, setTimeout },
    sent, refuseReset: null,
    requests: () => sent.filter((m) => m.id !== undefined).map((m) => m.method),
    us: () => sent.filter((m) => m.method === 'u'),
    hold(on) { holding = on; },
    release() { for (const r of held.splice(0)) r(); },
    notify: (method, params) => sock.onmessage({ data: JSON.stringify({ jsonrpc: '2.0', method, params }) }),
  };
  return fake;
}
async function connected(sys, plant, out) {
  const loop = createLiveLoop((m) => out.push(m), plant.env);
  loop.handle(program(sys));
  loop.handle({ type: 'connect', url: 'ws://x' });
  await tick();
  return loop;
}

test('a Stop sent while the plant is still starting wins, and a Run right after a Stop too: the last key has the last word', async () => {
  const sys = await system();
  const plant = slowPlant();
  const out = [];
  const loop = await connected(sys, plant, out);
  assert.deepEqual(states(out), ['connecting:ws://x', 'open:ws://x']);
  // Run, then Stop before the plant has answered start.
  plant.hold(true);
  loop.handle({ type: 'start' });
  await tick();
  loop.handle({ type: 'stop' });
  await tick();
  plant.release();
  await tick();
  assert.deepEqual(plant.requests(), ['describe', 'start', 'stop'], 'the plant hears both, in order');
  assert.deepEqual(states(out).slice(2), ['open:stopped'], 'and the page never says running');
  // Running; then Stop and Run at once: the plant stops, then starts.
  plant.hold(false);
  loop.handle({ type: 'start' });
  await tick();
  assert.equal(states(out).at(-1), 'running:fake');
  const n = states(out).length;
  plant.hold(true);
  loop.handle({ type: 'stop' });
  loop.handle({ type: 'start' });
  await tick();
  plant.release();
  await tick();
  plant.release();
  await tick();
  assert.deepEqual(plant.requests().slice(-2), ['stop', 'start']);
  assert.deepEqual(states(out).slice(n), ['running:fake'], 'the overtaken Stop reports nothing');
  // The plant's echo of a change the page asked for, arriving late, does not
  // stop the run under way.
  plant.notify('running', { running: false, by: 'page', reason: 'stopped by the page' });
  assert.ok(!out.some((m) => m.type === 'stopped'));
  plant.notify('y', { seq: 0, t: 0, y: [0, 0, 0] });
  assert.equal(plant.us().length, 1, 'still answering');
  // The plant's own Stop key is followed.
  plant.notify('running', { running: false, by: 'plant', reason: 'stop pressed at the plant' });
  assert.equal(states(out).at(-1), 'open:stopped at the plant');
});

test('Connect is open once the plant has described itself; a Run right after it waits for the diagram', async () => {
  const sys = await system();
  const plant = slowPlant();
  const out = [];
  const loop = createLiveLoop((m) => out.push(m), plant.env);
  loop.handle({ type: 'connect', url: 'ws://x' });
  await tick();
  const types = out.map((m) => (m.type === 'state' ? m.state : m.type));
  assert.ok(types.indexOf('described') < types.indexOf('open'), types.join(' '));
  // The page sends the diagram when it has the description; a Run that
  // comes first waits for it instead of failing with "nothing to run yet".
  loop.handle({ type: 'start', id: 1 });
  await tick(20);
  assert.ok(!plant.requests().includes('start'));
  loop.handle(program(sys));
  await tick();
  assert.ok(plant.requests().includes('start'));
  assert.equal(states(out).at(-1), 'running:fake');
  assert.deepEqual(out.find((m) => m.type === 'done' && m.id === 1), { type: 'done', id: 1 });
  loop.handle({ type: 'stop' });
  await tick();
});

test(`an output that is not a number holds its last number; ${NAN_CYCLES} in a row latch an E-stop`, async () => {
  const sys = await system();
  const plant = slowPlant();
  const out = [];
  const loop = await connected(sys, plant, out);
  loop.handle({ type: 'start' });
  await tick();
  const y = (seq, v) => plant.notify('y', { seq, t: seq / 100, y: v });
  y(0, [0.2, 0, 0]);
  y(1, [null, 0, 0]);
  y(2, [null, 0, 0]);
  y(3, [0.2, 0, 0]);
  assert.equal(plant.us().length, 4, 'a gap of two is bridged and answered');
  assert.ok(!out.some((m) => m.type === 'estop'));
  for (let s = 4; s < 4 + NAN_CYCLES; s++) y(s, [null, 0, 0]);
  assert.equal(plant.us().length, 4 + NAN_CYCLES - 1, 'the last one is not answered');
  const stop = out.find((m) => m.type === 'estop');
  assert.deepEqual([stop.by, stop.reason], ['page', `no number for angle in ${NAN_CYCLES} cycles`]);
  assert.ok(plant.sent.some((m) => m.method === 'estop'), 'and the plant is asked to E-stop');
  loop.handle({ type: 'disconnect' });
  await tick();
});

test('the loop answers estop, reset and disconnect once the plant has; a reset the plant refuses leaves the latch', async () => {
  const sys = await system();
  const plant = slowPlant();
  const out = [];
  const loop = await connected(sys, plant, out);
  const done = (id) => out.find((m) => m.type === 'done' && m.id === id);
  loop.handle({ type: 'estop', id: 7 });
  await tick();
  assert.ok(out.findIndex((m) => m.type === 'estop') < out.indexOf(done(7)), 'done after the latch');
  plant.refuseReset = 'STOP was pressed at the plant: reset it there';
  loop.handle({ type: 'reset', id: 8 });
  await tick();
  assert.match(done(8).error, /STOP was pressed at the plant/);
  loop.handle({ type: 'start', id: 9 });
  await tick();
  assert.match(done(9).error, /E-STOP is latched/, 'still latched');
  plant.refuseReset = null;
  loop.handle({ type: 'reset', id: 10 });
  await tick();
  assert.equal(done(10).error, undefined);
  assert.equal(states(out).at(-1), 'open:reset');
  loop.handle({ type: 'disconnect', id: 11 });
  await tick(20);
  assert.ok(done(11));
  assert.ok(out.findIndex((m) => m.type === 'state' && m.state === 'closed') < out.indexOf(done(11)), 'done once the link is closed');
});

test('a control-mode system against a reference-mode plant: the wire into the changed input goes, and a Controller on a reference input is refused', async () => {
  const sys = await system();
  const d = normalizeDiagram(sys.plant.diagram);
  const ext = d.blocks.find((b) => b.type === 'external');
  const now = externalParams(checkDescription(REF_DESC), ext.params);
  const kept = keptWires(d.wires, ext.id, ext.params, now);
  const has = (from, to) => kept.some((w) => w.from === from && w.to === to);
  assert.ok(!has('ctrl', 'plant'), 'what fed V (volts) must not feed r (rad)');
  assert.ok(has('plant', 'ctrl:1') && has('ctrl', 'V'), 'the rest stays');
  assert.deepEqual(keptWires(d.wires, ext.id, ext.params, ext.params), d.wires, 'the same ports keep every wire');
  // Wired anyway (by hand, or an older page): Run is refused, and why.
  const wired = normalizeDiagram({ ...d, blocks: d.blocks.map((b) => (b === ext ? { ...b, params: now } : b)) });
  assert.match(liveProblem(wired), /^Controller "ctrl" is wired to r, which this plant takes as a reference/);
  assert.throws(() => createLiveRunner(wired, signalsOf(sys)), /takes as a reference/);
  assert.equal(liveProblem(normalizeDiagram({ ...wired, wires: kept })), null);
  assert.equal(liveProblem(d), null, 'the library system as it is');
  const plant = slowPlant(REF_DESC);
  const out = [];
  const loop = createLiveLoop((m) => out.push(m), plant.env);
  loop.handle(program(sys, wired));
  loop.handle({ type: 'connect', url: 'ws://x' });
  await tick();
  loop.handle({ type: 'start' });
  await tick();
  assert.ok(out.some((m) => m.type === 'refused' && /takes as a reference/.test(m.message)));
  assert.ok(!plant.requests().includes('start'), 'nothing reached the plant');
});

test('every page names loopTuner.help() where an agent looks first: the head, the top of the body, the Help key', () => {
  for (const html of [buildHtml(), buildHtml({ fragment: true }), buildHtml({ project: { title: 'x' } })]) {
    assert.match(html, /<meta name="description" content="[^"]*For agents: window\.loopTuner\.help\(\) returns a guide/);
    assert.match(html, /<div id="lt-shell" class="app">\n<p class="sr-only" id="agent-note">[^<]*window\.loopTuner\.help\(\)/);
    assert.match(html, /<button id="help"[^>]*aria-label="Help, and a guide for agents: loopTuner\.help\(\)"/);
  }
  // A page exported from the page (Export HTML, Copy HTML) carries the head's line too.
  assert.ok(readFileSync(new URL('../src/ui/app.js', import.meta.url), 'utf8').includes('<meta name="description" content="${esc(AGENT_NOTE)}">'));
});

// ---- The plant script.

test('hil_plant.py, without a server: numbers, its own controller and monitoring on NaN, a failed cycle, who resets whose STOP (when uv can run it here)', (t) => {
  const res = pyProbe(`
import asyncio
p = m.Plant(args(mode='reference'))
safe = []
p.model.safe = lambda u: safe.append(list(u))
out = {'number': [m.number(10 ** 400), m.number(True), m.number(1.5), m.number(float('nan')), m.number('1')]}
# The model's own controller acts only while the plant runs: stopped, its effort is safe.
p.u = [1.0]
p.cycle(0.0, 0.0, p.dt)
stopped = p.last_y[-1]
p.set_running(True, 'page', '')
p.cycle(0.0, 0.0, p.dt)
out['own'] = [stopped, p.last_y[-1] > 0]
p.set_running(False, 'page', '')
p.running = True
p.take_u({'seq': [1], 'u': [10 ** 400]})
out['u'] = p.pending[-1][1]
p.monitor([float('nan'), 0.0, 0.0, 0.0])
out['nan'] = [p.estop_reason, p.estop_by, p.running, len(safe) > 0]
p.reset(by='page')
p.trip('STOP pressed at the plant', 'key')
try:
    p.reset(by='page'); out['page_resets_key'] = 'cleared'
except RuntimeError as err:
    out['page_resets_key'] = str(err)
p.reset(by='plant')
out['plant_resets_key'] = p.estop_reason
p.trip('pressed on the page', 'page')
p.client = object()
p.reset(by='plant')
out['plant_resets_page'] = p.estop_reason
p.client = None
p.reset(by='plant')
out['plant_resets_page_gone'] = p.estop_reason
loop = asyncio.new_event_loop()
p.done = asyncio.Event()
f = loop.create_future(); f.set_exception(ZeroDivisionError('float division by zero'))
safe.clear()
p.cycle_ended(f)
out['failed'] = [p.estop_reason, p.failed, p.done.is_set(), len(safe) > 0]
p.model.close()
print(json.dumps(out))
`);
  if (res === null) { t.skip('uv with websockets and mini-racer in its cache is not here'); return; }
  const out = JSON.parse(res.trim().split('\n').at(-1));
  assert.deepEqual(out.number, [null, null, 1.5, null, null], 'too large for a float, a bool, NaN, a string: not numbers');
  assert.deepEqual(out.own, [0, true], 'the model\'s own controller: the safe effort while stopped, acting while running');
  assert.deepEqual(out.u, [0], 'a u of 10^400 is the safe value, and a seq that is a list does no harm');
  assert.deepEqual(out.nan, ['angle is not a number', 'monitor', false, true], 'monitoring: latched, stopped, safe inputs on the device');
  assert.match(out.page_resets_key, /STOP was pressed at the plant: reset it there/);
  assert.equal(out.plant_resets_key, null);
  assert.equal(out.plant_resets_page, 'pressed on the page', 'the page\'s E-STOP is the page\'s to reset while it is connected');
  assert.equal(out.plant_resets_page_gone, null, 'once that page is gone, the plant may');
  assert.deepEqual(out.failed, ['the plant\'s cycle failed (ZeroDivisionError: float division by zero)', 'ZeroDivisionError: float division by zero', true, true]);
});

test('hil_plant.py: frames in the order made, malformed messages answered and survived, who resets whose STOP (when it can run here)', async (t) => {
  if (typeof WebSocket !== 'function') { t.skip('no WebSocket in this Node'); return; }
  const plant = await startPlant(['--seed', '1']);
  if (!plant) { t.skip('neither python3 with websockets nor uv with websockets in its cache'); return; }
  const page = await connectPlant(plant.port);
  const order = (from) => page.frames.slice(from).filter((m) => m.method !== 'y' && m.method !== 'status').map((m) => (m.id !== undefined ? `result ${m.id}` : `${m.method} ${m.params.running} ${m.params.by}`));
  try {
    await page.call('describe');
    const k = page.frames.length;
    await page.call('start');
    await page.call('stop');
    await page.call('start');
    assert.deepEqual(order(k), ['running true page', 'result 2', 'running false page', 'result 3', 'running true page', 'result 4'], 'a notification a request causes comes before its result');
    // Malformed: answered, or ignored; never the end of the link.
    assert.equal((await page.call('estop', [1, 2])).error.code, -32602);
    page.raw(`{"jsonrpc":"2.0","method":"u","params":{"seq":4,"u":[1${'0'.repeat(400)}]}}`);
    page.raw(JSON.stringify({ jsonrpc: '2.0', method: 'u', params: [1, 2] }));
    page.raw(JSON.stringify({ jsonrpc: '2.0', method: 'u', params: { seq: [1], u: [0] } }));
    await tick(150);
    assert.ok(!page.notes.some((m) => m.method === 'estop'), 'no E-stop');
    assert.equal(page.closed(), null, 'the link stays');
    assert.equal((await page.call('describe')).result.running, true);
    // A STOP pressed at the plant is reset at the plant only.
    plant.key('e');
    await page.until(() => page.notes.find((m) => m.method === 'estop'));
    const refused = await page.call('reset');
    assert.equal(refused.error.code, -32000);
    assert.match(refused.error.message, /^STOP was pressed at the plant: reset it there/);
    assert.equal((await page.call('describe')).result.estop, 'STOP pressed at the plant');
    plant.key('x');
    await page.until(() => /reset by the plant/.test(plant.out()));
    assert.equal((await page.call('describe')).result.estop, null);
    // The page's E-STOP is reset on the page only (while it is connected):
    // the plant's Reset and Run refuse it, and say so.
    await page.call('estop', { reason: 'pressed on the page' });
    plant.key('x');
    plant.key('r');
    await page.until(() => /reset it on the page, then Run/.test(plant.out()));
    assert.match(plant.out(), /E-STOP from the page \(pressed on the page\): reset it on the page\n/);
    assert.equal((await page.call('describe')).result.estop, 'pressed on the page');
    assert.deepEqual((await page.call('reset')).result, {});
    assert.equal((await page.call('describe')).result.estop, null);
  } finally {
    page.ws.close();
    plant.proc.kill('SIGINT');
    await Promise.race([plant.exited, tick(3000)]);
  }
});

test('hil_plant.py: a cycle that fails ends the script with the error, its inputs safe (when it can run here)', async (t) => {
  // A model whose cycle fails at once (a core whose plant throws, as a device
  // that stops answering would); what the page hears then is checked
  // without a server above.
  const broken = join(tmpdir(), `loop-tuner-core-broken-${process.pid}.js`);
  writeFileSync(broken, `${readFileSync(coreFile(), 'utf8')}
(() => { const lib = LoopTunerCore['core/hilsim.js'], start = lib.startSimPlant;
  lib.startSimPlant = (o) => { const r = start(o); globalThis.__plant.cycle = () => { throw new Error('the device stopped answering'); }; return r; }; })();\n`);
  let res;
  try { execFileSync('uv', [...UV, SCRIPT, '--no-gui', '--port', '0', '--core', broken], { stdio: 'pipe', timeout: 20000, input: '' }); res = { status: 0 }; } catch (err) {
    if (err.code === 'ENOENT' || /No solution|offline/.test(String(err.stderr))) { t.skip('uv with websockets and mini-racer in its cache is not here'); return; }
    res = { status: err.status, text: `${err.stdout}${err.stderr}` };
  } finally { rmSync(broken, { force: true }); }
  assert.equal(res.status, 1);
  assert.match(res.text, /Traceback[\s\S]*RuntimeError: the device stopped answering/);
  assert.match(res.text, /the plant's cycle failed \(RuntimeError: the device stopped answering\): it applied its safe inputs and ended/);
});
