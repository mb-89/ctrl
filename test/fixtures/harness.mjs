// Test fixture (not shipped): test 13's harness (identification.md §17).
// A sensor on a project's measurement, so a simulated plant shows noise and
// an encoder's steps to Identify while the project without it stays the
// noise-free truth that results are scored on; then identify, tune on the
// model, and score on the truth against tuning on the truth itself.

import assert from 'node:assert/strict';
import { normalizeProject } from '../../src/core/project.js';
import { identify, modelTune } from '../../src/core/identify.js';
import { autotune } from '../../src/core/autotune.js';

// Noise σ (seeded) and steps q before the Controller's input 2 (block ctrl).
export function withSensor(project, { noise = 0, q = 0, seed = 5, block = 'ctrl' } = {}) {
  const p = structuredClone(project), d = p.system.plant.diagram;
  const w = d.wires.find((x) => x.to === `${block}:1`);
  let from = w.from;
  const chain = [];
  if (noise) chain.push({ id: 'sensor-noise', type: 'noise', params: { std: noise, seed } });
  if (q) chain.push({ id: 'sensor-steps', type: 'quantizer', params: { q } });
  for (const b of chain) { d.blocks.push({ ...b, x: 0, y: 0 }); d.wires.push({ from, to: b.id }); from = b.id; }
  w.from = from;
  return normalizeProject(p);
}

const fmt = (v) => Number(v.toPrecision(3));

// Identify through the sensor, Iterate on the model, score on the truth.
export function harness(truth, sensor) {
  const id = identify(withSensor(truth, sensor));
  assert.ok(id.ok, id.model.sentences?.join(' '));
  const onModel = modelTune(truth, ['ctrl'], id.model, { method: 'iterate', diagram: true });
  const best = autotune(truth, ['ctrl'], { method: 'iterate' });
  return { id, onModel, best, ratio: onModel.onDiagram.after.J / best.after.J };
}
export const line = (name, h) => `${name}: ${h.id.model.label}, Check ${fmt(h.id.model.check.fit)} %, ${fmt(h.id.time)} s of plant time; cost ${fmt(h.onModel.onDiagram.before.J)} → ${fmt(h.onModel.onDiagram.after.J)} tuned on the model, ${fmt(h.best.after.J)} tuned on the plant: ×${fmt(h.ratio)}`;
