import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeProject, evaluateCandidate, evaluateProject } from '../src/core/project.js';
import { computeMetrics } from '../src/core/metrics.js';
import { runTune } from '../src/core/tune.js';
import { EXAMPLES } from '../src/core/examples.js';
import { buildHtml, bundleScript } from '../build.mjs';
import { referenceFn, normalizeReference, parseWaveform } from '../src/core/signals.js';
import { referenceTrace } from '../src/core/project.js';
import { DEFAULT_PROJECT } from '../src/core/examples.js';

const loopProject = (system, controller, sim = { duration: 10, sampleTime: 0.01 }, goal) =>
  normalizeProject({ sim, system: { reference: { type: 'step', params: { amplitude: 1, time: 0 } }, ...system }, goal, candidates: [{ name: 'c', controller }] });
const run = (p) => evaluateCandidate(p, p.candidates[0]);

test('P control of a first-order plant settles at Kp K / (1 + Kp K)', () => {
  const p = loopProject({ plant: { type: 'firstOrder', params: { K: 1, tau: 1 } } }, { type: 'P', params: { Kp: 1 } }, { duration: 5, sampleTime: 0.01 });
  const { result, metrics } = run(p);
  assert.ok(Math.abs(result.y.at(-1) - 0.5 * (1 - Math.exp(-10))) < 1e-4);
  assert.ok(Math.abs(metrics.steadyStateError - 50) < 0.1);
});

test('dead time delays the response', () => {
  const p = loopProject({ plant: { type: 'fopdt', params: { K: 1, tau: 1, delay: 1 } } }, { type: 'P', params: { Kp: 0.5 } });
  const { result } = run(p);
  assert.equal(result.y[90], 0);
  assert.ok(result.y[150] > 0.05);
});

test('overshoot of a second-order step matches exp(−ζπ/√(1−ζ²))', () => {
  const zeta = 0.3, wn = 2, dt = 0.001, n = 10001;
  const t = new Float64Array(n), y = new Float64Array(n), r = new Float64Array(n), z = new Float64Array(n);
  const wd = wn * Math.sqrt(1 - zeta * zeta);
  for (let k = 0; k < n; k++) {
    t[k] = k * dt;
    r[k] = k >= 1000 ? 1 : 0;
    const s = t[k] - 1;
    y[k] = s < 0 ? 0 : 1 - Math.exp(-zeta * wn * s) * (Math.cos(wd * s) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * s));
  }
  const e = r.map((v, k) => v - y[k]);
  const m = computeMetrics({ t, r, y, u: z, v: z, e, d: z, info: { unstable: false } });
  assert.ok(Math.abs(m.overshoot - 100 * Math.exp(-zeta * Math.PI / Math.sqrt(1 - zeta * zeta))) < 0.05);
  assert.ok(Math.abs(m.peakTime - Math.PI / wd) < 0.01);
});

test('PI with actuator saturation removes the error and respects the limits', () => {
  const p = loopProject(
    { plant: { type: 'firstOrder', params: { K: 1, tau: 2 } }, actuator: { type: 'saturation', params: { uMin: -1.2, uMax: 1.2 } } },
    { type: 'PI', params: { Kp: 5, Ki: 5 } }, { duration: 20, sampleTime: 0.01 });
  const { result, metrics } = run(p);
  assert.ok(Math.max(...result.u) <= 1.2 + 1e-12);
  assert.ok(metrics.steadyStateError < 0.1);
  assert.ok(metrics.saturation > 0);
});

test('an unstable loop is flagged and infeasible', () => {
  const p = loopProject({ plant: { type: 'lagChain', params: { K: 1, tau: 1, n: 3 } } }, { type: 'P', params: { Kp: 20 } }, { duration: 200, sampleTime: 0.01 });
  const { metrics, evaluation } = run(p);
  assert.equal(metrics.unstable, true);
  assert.equal(evaluation.feasible, false);
});

test('auto-tune finds a feasible PID for the third-order example and is reproducible', () => {
  const p = normalizeProject(EXAMPLES[0]);
  const start = p.candidates.find((c) => c.name === 'Detuned PID');
  const a = runTune(p, start, { maxEvals: 200 });
  const b = runTune(p, start, { maxEvals: 200 });
  assert.equal(a.best.evaluation.feasible, true);
  assert.ok(a.best.evaluation.score < evaluateCandidate(p, start).evaluation.score);
  assert.deepEqual(a.best.params, b.best.params);
});

test('every example evaluates', () => {
  for (const ex of EXAMPLES) {
    const { runs } = evaluateProject(normalizeProject(ex));
    assert.ok(runs.every((r) => !r.metrics.unstable), ex.title);
  }
});

test('bad input fails with the valid choices named', () => {
  assert.throws(() => normalizeProject({ system: { plant: { type: 'nope' } } }), /types: .*firstOrder/);
  assert.throws(() => normalizeProject({ goal: { minimize: { speed: 1 } } }), /unknown metric "speed"/);
  assert.throws(() => normalizeProject({ candidates: [{ controller: { type: 'PID', params: { Kp: 'x' } } }] }), /Kp: expected a number/);
});

test('the bundle parses and the CLI round-trips a project through HTML', () => {
  assert.doesNotThrow(() => new Function(bundleScript()));
  const dir = mkdtempSync(join(tmpdir(), 'lt-'));
  const json = join(dir, 'p.json'), html = join(dir, 'p.html');
  execFileSync('node', ['cli.mjs', 'new', '--example', '0', '-o', json]);
  execFileSync('node', ['cli.mjs', 'try', json, '--from', 'P only', '--set', 'Kp=2', '--name', 'P2', '--save']);
  execFileSync('node', ['cli.mjs', 'html', json, '-o', html]);
  assert.ok(readFileSync(html, 'utf8').includes('"P2"'));
  const out = JSON.parse(execFileSync('node', ['cli.mjs', 'eval', html, '--json']).toString());
  assert.ok(out.candidates.some((c) => c.name === 'P2' && c.controller.params.Kp === 2));
  assert.ok(buildHtml({ fragment: true }).startsWith('<title>'));
});

test('the reference is the sum of its enabled components', () => {
  const ref = normalizeReference({ components: [
    { type: 'step', params: { amplitude: 1, time: 0.1 } },
    { type: 'ramp', params: { amplitude: 0.5, time: 0.4, rise: 0.5 } },
    { type: 'dc', params: { level: 9 }, enabled: false },
  ] });
  const r = referenceFn(ref, { sampleTime: 0.001 });
  assert.equal(r(0.05), 0);
  assert.equal(r(0.2), 1);
  assert.ok(Math.abs(r(0.65) - 1.25) < 1e-12);
  assert.equal(r(2), 1.5);
});

test('noise is reproducible and an arbitrary waveform interpolates its points', () => {
  const ref = normalizeReference({ components: [{ type: 'noise', params: { std: 1, seed: 3 } }] });
  const a = referenceFn(ref, { sampleTime: 0.01 }), b = referenceFn(ref, { sampleTime: 0.01 });
  assert.equal(a(0.537), b(0.537));
  assert.equal(a(0.531), a(0.539));
  const pts = parseWaveform('time,value\n0,0\n1,2\n2,2\n');
  const arb = referenceFn(normalizeReference({ components: [{ type: 'arb', params: { gain: 2, shift: 0 }, points: pts }] }), { sampleTime: 0.01 });
  assert.equal(arb(0.5), 2);
  assert.equal(arb(5), 4);
});

test('a new project is the reference alone; a v1 file still loads with its loop', () => {
  const p = normalizeProject(structuredClone(DEFAULT_PROJECT));
  assert.equal(p.system.plant, null);
  assert.throws(() => evaluateCandidate(p, { controller: { type: 'P', params: { Kp: 1 } } }), /no plant/);
  const { r } = referenceTrace(p);
  assert.equal(r[0], 0);
  assert.equal(r[r.length - 1], 1);
  const v1 = normalizeProject(EXAMPLES[0]);
  assert.equal(v1.system.reference.components[0].type, 'step');
  assert.equal(v1.system.plant.type, 'lagChain');
  assert.equal(v1.scope.channels[0].source, 'r');
});
