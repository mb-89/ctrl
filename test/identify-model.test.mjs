// Auto-tune and Analysis on the identified model (design/output/
// identification.md §10, §12; §18 step 9): the twin in the plant's place,
// the test push, names, the loop Analysis reads with its ranges, the
// Shake's measured points, and the command line's --plant identified.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { identify, twinDiagram, twinProject, twinOp, twinSubsystem, modelPush, modelTune, identifiedLoop, loopRanges, measuredPoints, modelBode, keptModel, linearModel } from '../src/core/identify.js';
import { resultName, baseName, tuneContext, controllerBlocks } from '../src/core/autotune.js';
import { analyzeLoop } from '../src/core/analysis.js';
import { simulateSystem } from '../src/core/sim.js';
import { normalizeDiagram, diagramNames } from '../src/core/diagram.js';
import { normalizeProject } from '../src/core/project.js';
import { libraryProject } from './fixtures/plants.mjs';

const oven = (() => { const p = libraryProject('Oven'); return { p, res: identify(p) }; })();
const motor = (() => { const p = libraryProject('DC motor, position'); return { p, res: identify(p) }; })();

test('the twin takes the plant\'s place: u into it, its y into the measurement, the plant cut off, the Sinks that showed the plant gone', () => {
  const { diagram, twin, cut, kept } = twinDiagram(motor.p.system.plant.diagram, ['ctrl'], motor.res.model, { push: 'push' });
  const ends = diagram.wires.map((w) => `${w.from}>${w.to}`);
  assert.ok(ends.includes(`ctrl>${twin}`) && ends.includes(`${twin}>ctrl:1`));
  assert.ok(!ends.includes('ctrl>motor'), 'u no longer drives the plant');
  assert.ok(ends.includes('ctrl>V'), 'u\'s Sink stays');
  assert.ok(ends.includes(`${twin}>angle`), 'the measurement\'s Sink shows the twin');
  assert.deepEqual(kept.sort(), ['V', 'angle']);
  assert.ok(cut.includes('speed') && !diagramNames(diagram).sinks.includes('speed'));
  assert.ok(ends.some((w) => w.endsWith(`>${twin}:1`)), 'the push enters the twin');
  // The project's own diagram is untouched.
  assert.ok(motor.p.system.plant.diagram.wires.some((w) => w.from === 'ctrl' && w.to === 'motor'));
});

test('the twin rests where the test began (u₀ holds y₀), with negative values too; its loop follows the diagram\'s', () => {
  const model = { ...structuredClone(oven.res.model), holds: [{ y: -3.5, u: -1.25 }] };
  const sub = twinSubsystem(model, { op: twinOp(model), noise: false });
  const d = normalizeDiagram({ blocks: [{ id: 'u', type: 'source', params: { signal: 'u' } }, sub, { id: 'y', type: 'sink', params: { name: 'y' } }], wires: [{ from: 'u', to: 'twin' }, { from: 'twin', to: 'y' }] });
  const run = simulateSystem(d, { u: { period: 2, components: [{ type: 'step', params: { amplitude: -1.25, time: 0 } }] } }, { duration: 2, sampleTime: 0.01 });
  assert.ok(run.signals.y.every((v) => Math.abs(v + 3.5) < 1e-9), 'at rest at y₀');
  // The oven's loop on the twin against its loop on the diagram (no d, no push): within 2 °C over a 0 … 60 °C run.
  const signals = structuredClone(oven.p.system.signals); signals.d.components = [];
  const p = { ...oven.p, system: { ...oven.p.system, signals } };
  const tw = twinProject(p, ['ctrl'], oven.res.model);
  tw.project.system.signals[tw.push.name].components = [];
  const a = simulateSystem(tw.project.system.plant.diagram, tw.project.system.signals, { duration: 5, sampleTime: 0.01 }).signals['ctrl.y'];
  const b = simulateSystem(p.system.plant.diagram, signals, { duration: 5, sampleTime: 0.01 }).signals['ctrl.y'];
  let rms = 0; for (let k = 0; k < a.length; k++) rms += (a[k] - b[k]) ** 2;
  assert.ok(Math.sqrt(rms / a.length) < 2, `rms ${Math.sqrt(rms / a.length)}`);
});

test('the test push: 20 % of the u between the reference\'s levels (at least 1 % of u\'s range), where d steps, its sign leaving the controller room', () => {
  const o = modelPush(oven.p, ['ctrl'], oven.res.model);
  // r spans 60 °C, K ≈ 0.98: about 12 % of heat; d steps at 3.6 s; u holds 60 °C at ~61 % of 0 … 100: more room below, so the push heats.
  assert.ok(Math.abs(o.size - (0.2 * 60) / oven.res.model.params.K) < 1e-9, `${o.size}`);
  assert.equal(o.at, 3.6);
  assert.equal(o.sign, 1);
  const m = modelPush(motor.p, ['ctrl'], motor.res.model);
  assert.equal(m.at, 3.2);
  assert.ok(m.size > 0);
});

test('names: "… (model)", and the base name stripped of it; Auto-tune runs unchanged on the twin', () => {
  const block = controllerBlocks(oven.p.system.plant.diagram)[0].block;
  const name = resultName(block, 'iterate', 'tl', 'tight', { model: true });
  assert.match(name, / · auto-tuned \(model\)$/);
  assert.equal(baseName(name), baseName(block.variants[block.variant].name));
  assert.match(resultName(block, 'step', 'tl', 'smooth', { model: true }), / · SIMC smooth \(model\)$/);
  const ctx = tuneContext(twinProject(oven.p, ['ctrl'], oven.res.model).project, ['ctrl']);
  assert.ok(ctx.others.includes('push'));
  const res = modelTune(motor.p, ['ctrl'], motor.res.model, { method: 'step', diagram: true });
  assert.ok(res.ok && res.on === 'model' && /· SIMC \(model\)$/.test(res.variant.name), res.why);
  assert.ok(res.onDiagram.after.J < res.onDiagram.before.J);
});

test('a plant outside the page: the twin drops the External block, and Auto-tune runs on the model', () => {
  const p = libraryProject('HIL: an external plant');
  const t = twinDiagram(p.system.plant.diagram, ['ctrl'], motor.res.model);
  assert.ok(!JSON.stringify(t.diagram).includes('"external"'));
  assert.throws(() => tuneContext(p, ['ctrl']), /identify the plant first/);
  const res = modelTune(p, ['ctrl'], motor.res.model, { method: 'iterate', maxIter: 5, diagram: true });
  assert.ok(res.ok && !res.onDiagram, 'no diagram to score on');
});

test('Analysis on the model: the model\'s loop is the identified structure\'s with the running law; ranges hold the nominal; a variant from the plant is refused', () => {
  const m = identifiedLoop(motor.p, ['ctrl'], motor.res.model);
  const lin = linearModel(motor.res.model);
  assert.deepEqual(m.plant.A, lin.A);
  assert.equal(m.plant.delay[0], motor.res.model.params.theta);
  assert.match(m.opLabel, /^identified over/);
  const a = analyzeLoop(m.plant, m.ctrl, m.Ts);
  const r = loopRanges(motor.p, ['ctrl'], motor.res.model);
  assert.equal(r.n, 50 + motor.res.model.where.filter((pl) => pl.seen >= 0.05).length);
  assert.ok(r.gm[0] <= a.margins.gmUp * 1.05 && r.gm[1] >= a.margins.gmUp * 0.95, `${r.gm} ${a.margins.gmUp}`);
  assert.ok(r.ms[0] <= a.margins.ms * 1.05 && r.ms[1] >= a.margins.ms * 0.95);
  const p = structuredClone(motor.p);
  const c = p.system.plant.diagram.blocks.find((b) => b.id === 'ctrl');
  c.variants = [{ name: 'LQR', type: 'lqr', params: {} }]; c.variant = 0;
  assert.throws(() => identifiedLoop(normalizeProject(p), ['ctrl'], motor.res.model), /computed from the plant's diagram/);
});

test('the Shake\'s measured points: a measured response equal to the model\'s gives ratio 1 at each line, its bars from σ', () => {
  const model = structuredClone(motor.res.model);
  const f = [0.5, 1, 2, 5];
  const b = modelBode(model, f.map((x) => 2 * Math.PI * x));
  model.frf = { f, G: b.mag.map((g, i) => ({ re: g * Math.cos((b.phase[i] * Math.PI) / 180), im: g * Math.sin((b.phase[i] * Math.PI) / 180) })), sd: b.mag.map((g) => 0.05 * g) };
  const pts = measuredPoints(model);
  assert.equal(pts.length, 4);
  for (const q of pts) { assert.ok(Math.abs(q.ratio.re - 1) < 1e-9 && Math.abs(q.ratio.im) < 1e-9); assert.ok(Math.abs(q.bar - 0.1) < 1e-12); }
  assert.deepEqual(measuredPoints(motor.res.model), [], 'none without a Shake');
});

test('the command line: autotune --plant identified tunes on the kept test\'s model and scores on the diagram; refused before one is kept', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lt-model-'));
  const file = join(dir, 'oven.json');
  writeFileSync(file, JSON.stringify(oven.p));
  const cli = (...a) => execFileSync(process.execPath, ['cli.mjs', ...a], { encoding: 'utf8' });
  assert.throws(() => execFileSync(process.execPath, ['cli.mjs', 'autotune', file, '--plant', 'identified'], { stdio: 'pipe' }), /identify the plant first/);
  cli('identify', file, '--keep');
  const rep = JSON.parse(cli('autotune', file, '--plant', 'identified', '--method', 'step', '--json'));
  assert.ok(rep.ok && rep.plant.on === 'model' && rep.plant.onDiagram.after < rep.plant.onDiagram.before);
  assert.match(rep.after.variant.name, /\(model\)$/);
  const kept = keptModel(normalizeProject(JSON.parse(readFileSync(file, 'utf8'))));
  assert.equal(kept.model.structure, oven.res.model.structure);
});
