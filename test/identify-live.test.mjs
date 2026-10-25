// Identify on a live plant, step 7 of design/output/identification.md §18,
// and test 14 (the safety rules): the live loop (core/live.js) runs the
// experiment as the Controller block's law against a plant outside the page
// (here hil_plant.py's arm, ported: test/fixtures/arm.mjs, behind a fake
// WebSocket that speaks loop-tuner-hil/1); the page fits at the pause and
// supplies the fit back; the plant is stopped at the end; an E-stop mid-test
// keeps the record, marked, and Reset does not resume; Stop is soft; the
// pause waits for the page's fit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveLoop } from '../src/core/live.js';
import { knownFor, identifySettings, planExperiment, identifySteps, compactRecord, planRecheck, recheckFit, discriminateSteps, fitSupply, shakeWanted } from '../src/core/identify.js';
import { normalizeDiagram } from '../src/core/diagram.js';
import { drain } from '../src/core/autotune.js';
import { libraryProject } from './fixtures/plants.mjs';
import { createArm, drawArm } from './fixtures/arm.mjs';

const DESC = { protocol: 'loop-tuner-hil/1', name: 'arm', rate_hz: 100, inputs: [{ name: 'V', unit: 'V', min: -12, max: 12, safe: 0 }], outputs: [{ name: 'angle', unit: 'rad', min: -3.1416, max: 3.1416, hard_min: -2.5, hard_max: 2.5 }, { name: 'speed', unit: 'rad/s', min: -120, max: 120 }, { name: 'current', unit: 'A', min: -12, max: 12 }], running: false, estop: null };

// The arm behind a fake socket. cycle() sends one y and steps the physics
// with the u that came back.
function armPlant(arm) {
  const sent = [];
  let ws = null, u = 0, seq = 0;
  class FakeWS {
    constructor() { ws = this; this.readyState = 0; setTimeout(() => { this.readyState = 1; this.onopen?.(); }); }
    send(text) {
      const m = JSON.parse(text);
      sent.push(m);
      if (m.method === 'u') { u = m.params.u[0]; return; }
      if (m.method === 'describe') this.reply(m.id, DESC);
      else if (m.id !== undefined) this.reply(m.id, m.method === 'start' ? { rate_hz: 100 } : {});
      if (m.method === 'start') seq = 0;
    }
    reply(id, result) { setTimeout(() => this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id, result }) })); }
    close() { this.readyState = 3; setTimeout(() => this.onclose?.({ code: 1000, reason: '' })); }
  }
  const env = { WebSocket: FakeWS, performance, setInterval: () => 1, clearInterval: () => {}, setTimeout };
  return {
    env, sent,
    cycle() {
      const st = arm.state;
      ws.onmessage({ data: JSON.stringify({ jsonrpc: '2.0', method: 'y', params: { seq, t: seq * 0.01, y: [arm.output(), st.w, st.i], applied: [arm.applied] } }) });
      arm.advance(u);
      seq++;
    },
    notify: (method, params) => ws.onmessage({ data: JSON.stringify({ jsonrpc: '2.0', method, params }) }),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 2));

// The page's side: the library's HIL system, its plan from what the plant
// describes; a loop connected to the arm; the page fits at the pause
// (supply: false leaves it waiting). Returns { project, plan, plant, loop,
// out, run(cycles, until) }.
async function setup({ seed = 1, supply = true } = {}) {
  const project = libraryProject('HIL: an external plant');
  const known = knownFor(project, null, { describe: DESC, link: { connected: true, estop: false } });
  const plan = planExperiment(known, identifySettings(project, null, { known }));
  const arm = createArm(drawArm(seed), { Ts: 0.01 });
  const plant = armPlant(arm);
  const out = [];
  let pre = null;
  const loop = createLiveLoop((m) => {
    out.push(m);
    if (m.type === 'identify' && m.needs?.kind === 'fit' && supply) {
      pre = drain(identifySteps(compactRecord(m.record), { plan, upto: m.needs.upto }));
      loop.handle({ type: 'supply', kind: 'fit', data: { ...fitSupply(pre), shake: !m.record.log.some((e) => e.kind === 'shake') && shakeWanted(pre) } });
    }
    if (m.type === 'identify' && m.needs?.kind === 'discriminate') loop.handle({ type: 'supply', kind: 'discriminate', data: drain(discriminateSteps(m.record, plan, pre)) });
  }, plant.env);
  loop.handle({ type: 'program', diagram: normalizeDiagram(structuredClone(project.system.plant.diagram)), signals: project.system.signals });
  loop.handle({ type: 'connect', url: 'ws://x' });
  for (let i = 0; i < 5; i++) await tick();
  const done = () => out.find((m) => m.type === 'identify' && m.done);
  async function run(cycles, until = done) {
    for (let k = 0; k < cycles && !until(); k++) { plant.cycle(); if (k % 500 === 0) await tick(); }
    await tick();
  }
  return { project, plan, arm, plant, loop, out, run, done, pre: () => pre };
}

test('7. the live loop runs the experiment as the block\'s law: the page fits at the pause and supplies the fit; the plant is stopped at the end', async () => {
  const s = await setup();
  s.loop.handle({ type: 'identify', key: 'ctrl', plan: s.plan, source: 'r', hold: {}, applied: 0 });
  for (let i = 0; i < 5; i++) await tick();
  assert.ok(s.plant.sent.some((m) => m.method === 'start'), 'Identify starts the plant');
  await s.run(20000);
  const end = s.done();
  assert.ok(end, 'the test ended');
  assert.equal(end.record.end, 'done', end.state.status);
  assert.ok(s.out.some((m) => m.type === 'identify' && m.needs), 'it asked for the fit');
  assert.ok(s.out.some((m) => m.type === 'identify' && m.check), 'the record for the Check\'s prediction');
  assert.ok(end.record.log.some((e) => e.kind === 'supply'), 'the fit was supplied');
  // The applied u is in the record (the plant echoes it).
  assert.ok(end.record.applied.filter((v) => v !== null).length > end.record.y.length / 2);
  const stops = s.plant.sent.filter((m) => m.method === 'stop');
  assert.ok(stops.length >= 1, 'the plant is stopped at the end');
  assert.ok(!s.arm.estop, 'the plant never stopped itself');
  const model = drain(identifySteps(compactRecord(end.record), { plan: s.plan, reuse: s.pre() }));
  assert.ok(model.ok && model.check.fit > 70, `a model, ${model.check?.fit} % on the Check`);
  // 18 (part): Check again on the same arm still fits.
  const plan = planRecheck(s.plan, model, compactRecord(end.record));
  const s2 = await setup();
  s2.loop.handle({ type: 'identify', key: 'ctrl', plan, source: 'r', hold: {}, applied: 0 });
  for (let i = 0; i < 5; i++) await tick();
  await s2.run(5000);
  const rc = recheckFit(model, compactRecord(s2.done().record), compactRecord(end.record));
  assert.ok(rc.still, rc.message);
});

test('14. an E-stop mid-test ends it at once, keeps the record marked, and Reset does not resume', async () => {
  const s = await setup();
  s.loop.handle({ type: 'identify', key: 'ctrl', plan: s.plan, source: 'r', hold: {}, applied: 0 });
  for (let i = 0; i < 5; i++) await tick();
  await s.run(900);
  assert.ok(!s.done());
  s.plant.notify('estop', { reason: 'STOP pressed at the plant', t: 9 });
  await tick();
  const end = s.done();
  assert.ok(end, 'the test ended');
  assert.equal(end.record.end, 'estop');
  assert.match(end.record.log.at(-1).message, /ended by the plant's stop at .* STOP pressed at the plant/);
  assert.ok(end.record.y.length >= 890, 'the record so far is kept');
  s.plant.notify('status', { estop: null, running: false });
  const n = s.out.length;
  await s.run(200, () => false);
  assert.ok(!s.out.slice(n).some((m) => m.type === 'identify'), 'nothing resumes');
});

test('14. Stop is soft: the controller brings y back, then the plant is stopped', async () => {
  const s = await setup();
  s.loop.handle({ type: 'identify', key: 'ctrl', plan: s.plan, source: 'r', hold: {}, applied: 0 });
  for (let i = 0; i < 5; i++) await tick();
  // Into the ladder (the Hold has run).
  await s.run(20000, () => s.out.some((m) => m.type === 'identify' && m.state?.stage === 'ease' && m.state.try >= 1));
  const stopsBefore = s.plant.sent.filter((m) => m.method === 'stop').length;
  s.loop.handle({ type: 'identifyStop' });
  s.plant.cycle();
  await tick();
  assert.equal(s.plant.sent.filter((m) => m.method === 'stop').length, stopsBefore, 'not stopped at once');
  await s.run(2000);
  const end = s.done();
  assert.ok(end && end.record.end === 'stopped', end?.state.status);
  assert.ok(end.record.log.some((e) => e.kind === 'stop'), 'the soft stop ran');
  assert.ok(s.plant.sent.filter((m) => m.method === 'stop').length > stopsBefore, 'then the plant is stopped');
});

test('14. the fit pause on a live plant waits for the page\'s fit, at most 30 s', async () => {
  const s = await setup({ supply: false });
  s.loop.handle({ type: 'identify', key: 'ctrl', plan: s.plan, source: 'r', hold: {}, applied: 0 });
  for (let i = 0; i < 5; i++) await tick();
  await s.run(30000);
  const end = s.done();
  assert.ok(end);
  assert.equal(end.record.end, 'fit');
  const ask = s.out.find((m) => m.type === 'identify' && m.needs);
  const pause = end.record.log.find((e) => e.kind === 'end');
  assert.ok((pause.i - ask.needs.upto) * 0.01 >= 29.9, 'it waited the 30 s');
});
