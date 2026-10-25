// Identify's experiment (design/output/identification.md §2–§5, tests 1–4 of
// §17): what is known without asking, the settings and the plan, every
// refusal with its sentence, and the causal state machine on plants whose
// truth the fixtures know: hil_plant.py's arm ported with its ±15 % draws
// (test/fixtures/arm.mjs), a lag, an integrator, an unstable and an unwired
// plant, a drifting one (test/fixtures/plants.mjs). Test 5, the ladder on the
// oven, the motor, the tank and five arms, is in ladder.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createExperiment, EXPERIMENT, IDENTIFY_VERSION, gentleGains, gentleTauC, piLaw, bumpless, tryCost, tryMargin, listenStats, staircase, halved,
} from '../src/core/experiment.js';
import { knownFor, identifySettings, planExperiment, IdentifyError, defaultBand, BUDGET, varyDiagram } from '../src/core/identify.js';
import { makeLaw, normalizeVariant } from '../src/core/controllers.js';
import { runCost } from '../src/core/autotune.js';
import { multisine, multisineLines } from '../src/core/fit.js';
import { bundleScript } from '../build.mjs';
import { createArm, drawArm, armAt, NOMINAL } from './fixtures/arm.mjs';
import { transferPlant, lag, integrator, unstable, unwired, swapped, libraryProject, runExperiment, diagramPlant } from './fixtures/plants.mjs';

const Ts = 0.01;
// The HIL arm's loop as the page knows it (§2): V ±12 V from 0 V, angle with
// the plant's range ±2.5 rad, r a square 0 → 1.5 rad over a 5 s period.
const armR = Array.from({ length: 500 }, (_, k) => (k * Ts > 0.5 && k * Ts <= 3.0 ? 1.5 : 0));
const ARM_KNOWN = {
  block: { path: ['ctrl'], key: 'ctrl', where: 'controller' }, live: true,
  u: { name: 'V', unit: 'V', min: -12, max: 12, u0: 0, from: 'both' },
  y: { name: 'angle', unit: 'rad', hard: [-2.5, 2.5], from: 'plant' },
  r: { lo: 0, hi: 1.5, span: 1.5, source: 'r', period: 5, samples: armR, Ts }, Ts, others: [{ name: 'd', value: 0, input: 'load' }],
};
const armPlan = (settings = {}) => planExperiment(ARM_KNOWN, settings);
// A generic loop: u ±2 from 0, r 0 → 1 → 0 over 6 s, the band from r.
const stepR = Array.from({ length: 600 }, (_, k) => (k >= 50 && k < 550 ? 1 : 0));
const plainKnown = (over = {}) => ({
  block: { path: ['c'], key: 'c', where: 'c' }, live: false,
  u: { name: 'u', unit: '', min: -2, max: 2, u0: 0, from: 'controller' },
  y: { name: 'y', unit: '', hard: null, from: null },
  r: { lo: 0, hi: 1, span: 1, source: 'r', period: 6, samples: stepR, Ts }, Ts, others: [], ...over,
});
const plainPlan = (over, settings) => planExperiment(plainKnown(over), settings);
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const untilHold = (exp) => exp.state.stage === 'hold';

// ---- Known without asking, the settings, the plan (§2, §3)

test('knownFor reads u, y, r, Ts and the other inputs from the project, never asking (§2)', () => {
  const oven = knownFor(libraryProject('Oven'));
  assert.deepEqual([oven.u.name, oven.u.unit, oven.u.min, oven.u.max, oven.u.u0, oven.u.from], ['P', '%', 0, 100, 0, 'controller']);
  assert.deepEqual([oven.y.name, oven.y.unit, oven.y.hard], ['T', '°C', null]);
  assert.deepEqual([oven.r.lo, oven.r.hi, oven.r.source, oven.r.samples.length, oven.Ts], [0, 60, 'r', 250, 0.02]);
  assert.deepEqual(oven.others, [{ name: 'd', value: 0 }]);
  assert.equal(oven.live, false);
  // A simulated plant starts from the running variant's start output: the
  // tank's PI from the plant computes the pump that holds it where it starts
  // (0.15 m: 0.172 m³/s), so the loop starts in balance.
  const tank = knownFor(libraryProject('Conical tank'));
  assert.deepEqual([tank.u.name, tank.u.start], ['q', 'controller']);
  assert.ok(Math.abs(tank.u.u0 - 0.1716) < 1e-3, String(tank.u.u0));
  // A live plant: u's range within the port's, its safe value as u₀; d is held
  // at the safe value of the plant input it drives; the hard range from describe.
  const hil = libraryProject('HIL: an external plant');
  const k = knownFor(hil, 'ctrl', { describe: { outputs: [{ name: 'angle', min: -Math.PI, max: Math.PI, hard_min: -2.4, hard_max: 2.4 }, { name: 'speed' }, { name: 'current' }] } });
  assert.deepEqual([k.live, k.u.name, k.u.min, k.u.max, k.u.u0, k.u.from], [true, 'V', -12, 12, 0, 'both']);
  assert.deepEqual([k.y.name, k.y.unit, k.y.hard, k.y.from], ['angle', 'rad', [-2.4, 2.4], 'plant']);
  assert.deepEqual(k.others, []);
  // Without describe at hand, the External block's hard range (ymin, ymax:
  // the arm's ±2.5 rad), never its full scale (outMin, outMax: ±π), which
  // the plant does not stop at (§15). A typed band beyond it is refused.
  const ext = hil.system.plant.diagram.blocks.find((b) => b.type === 'external');
  assert.deepEqual([ext.params.outMin[0], ext.params.outMax[0]], [-Math.PI, Math.PI]);
  const kb = knownFor(hil);
  assert.deepEqual(kb.y.hard, [-2.5, 2.5]);
  assert.throws(() => planExperiment(kb, { band: [-0.5, 2.8] }), (err) => err instanceof IdentifyError && err.code === 'band-hard');
  assert.deepEqual(defaultBand(kb).band, [-0.5, 2], 'the default band backs off inside ±2.5, not ±π');
  const fullOnly = structuredClone(hil);
  Object.assign(fullOnly.system.plant.diagram.blocks.find((b) => b.type === 'external').params, { ymin: [null, null, null], ymax: [null, null, null] });
  assert.equal(knownFor(fullOnly).y.hard, null, 'a full scale alone is no hard range');
  // Another input, held at the safe value of the plant input it drives.
  const two = structuredClone(hil);
  const d2 = two.system.plant.diagram, e2 = d2.blocks.find((b) => b.type === 'external');
  Object.assign(e2.params, { inputs: ['V', 'load'], inUnits: ['V', 'N·m'], min: [-12, -1], max: [12, 1], safe: [0, 0.25], kinds: ['effort', 'effort'], measures: ['', ''] });
  d2.blocks.push({ id: 'd', type: 'source', params: { signal: 'd', unit: 'N·m' } });
  d2.wires.push({ from: 'd', to: `${e2.id}:1` });
  two.system.signals.d = { period: 5, components: [] };
  assert.deepEqual(knownFor(two).others, [{ name: 'd', value: 0.25, input: 'load' }]);
});

test('the band defaults to r\'s range widened by a third, clipped inside the plant\'s range; the plan holds the references (§2, §5.7)', () => {
  // The HIL arm: r 0 … 1.5, the plant's ±2.5 shrunk by 5 %: −0.5 … 2.0.
  assert.deepEqual(defaultBand(ARM_KNOWN).band, [-0.5, 2]);
  assert.deepEqual(defaultBand(ARM_KNOWN, [-1, 1.8]), { band: [-0.5, 1.8 - 0.05 * 2.8], from: 'r' });
  // r does not move: r₀ ± 10 % of the hard range; neither: no default.
  const still = { ...ARM_KNOWN, r: { ...ARM_KNOWN.r, lo: 0.3, hi: 0.3, span: 0, samples: new Array(500).fill(0.3) } };
  const b = defaultBand(still).band;
  assert.ok(Math.abs(b[0] - (0.3 - 0.5)) < 1e-12 && Math.abs(b[1] - (0.3 + 0.5)) < 1e-12, String(b));
  assert.equal(defaultBand({ ...still, y: { ...still.y, hard: null } }).band, null);
  // The settings: the stored design inputs, else the defaults, each with its source.
  const p = libraryProject('Oven');
  assert.deepEqual(identifySettings(p).band, { value: [-20, 80], from: 'r' });
  assert.deepEqual(identifySettings(p).budget, { value: BUDGET, from: 'default' });
  p.system.identify = { ctrl: { band: [-10, 90], budget: 300, hard: [-30, 200] } };
  const s = identifySettings(p);
  assert.deepEqual([s.band, s.budget, s.hard], [{ value: [-10, 90], from: 'yours' }, { value: 300, from: 'yours' }, { value: [-30, 200], from: 'yours' }]);
  // The plan: data only, the test reference one period of r, the Check's halved about the middle.
  const plan = armPlan();
  assert.equal(plan.version, IDENTIFY_VERSION);
  assert.deepEqual([plan.Ts, plan.u0, plan.umin, plan.umax, plan.budget], [Ts, 0, -12, 12, 120]);
  assert.deepEqual(plan.test.r, armR);
  assert.deepEqual([Math.min(...plan.check.r), Math.max(...plan.check.r)], [0.375, 1.125]);
  assert.deepEqual(JSON.parse(JSON.stringify(plan)), plan, 'the plan is plain data');
  // r moving less than 10 % of the band: a staircase, built by the experiment.
  const flat = planExperiment(still);
  assert.deepEqual([flat.test, flat.check], [{ r0: 0.3 }, null]);
  const st = staircase(0.3, [-0.2, 0.8], 0.25, 3);
  assert.deepEqual(st, [0.3, 0.3, 0.3, 0.55, 0.55, 0.55, 0.3, 0.3, 0.3]);
  assert.deepEqual(staircase(0.6, [-0.2, 0.8], 0.25, 1), [0.6, 0.35, 0.6], 'toward the side with more room');
  assert.deepEqual(halved([0, 1.5, 0]), [0.375, 1.125, 0.375]);
});

test('every reason Identify cannot run is an IdentifyError with a sentence (§2, §4)', () => {
  const refuses = (fn, code, sentence) => {
    assert.throws(fn, (err) => err instanceof IdentifyError && err.code === code && sentence.test(err.message), `${code}: ${sentence}`);
  };
  const oven = libraryProject('Oven');
  const edit = (p, f) => { const q = structuredClone(p); f(q.system.plant.diagram); return q; };
  refuses(() => knownFor(edit(oven, (d) => { d.wires = d.wires.filter((w) => w.to !== 'ctrl:1'); })), 'unwired', /^wire the measurement to input 2$/);
  refuses(() => knownFor(edit(oven, (d) => { d.blocks.find((b) => b.id === 'ctrl').params.inputs = 5; })), 'measurements', /one measurement \(r, y\): this one has 4$/);
  refuses(() => knownFor(edit(oven, (d) => { d.blocks.find((b) => b.id === 'ctrl').variants.forEach((v) => { v.params.umin = -Infinity; v.params.umax = Infinity; }); })), 'u-range', /^set u min and u max in the Controller tab: Identify needs to know how far P may go$/);
  refuses(() => knownFor(edit(oven, (d) => { d.blocks = d.blocks.filter((b) => b.id !== 'ctrl'); d.wires = d.wires.filter((w) => !w.to.startsWith('ctrl') && !w.from.startsWith('ctrl')); })), 'no-controller', /no Controller block/);
  const hil = libraryProject('HIL: an external plant');
  refuses(() => knownFor(hil, 'ctrl', { link: { connected: false } }), 'connect', /^connect the plant first$/);
  refuses(() => knownFor(hil, 'ctrl', { link: { connected: true, estop: 'stop pressed at the plant' } }), 'estop', /^the plant is E-stopped: Reset$/);
  refuses(() => knownFor(hil, 'ctrl', { describe: { inputs: [{ name: 'V', kind: 'reference' }] } }), 'reference-mode', /takes references \(reference mode\): identifying through its own controller comes later/);
  // The band: r must stay inside; the page must know a range for y; inside the plant's.
  refuses(() => armPlan({ band: [-0.5, 1.2] }), 'r-band', /^r leaves 'may move within' \(r reaches 1\.5, the band ends at 1\.2\)$/);
  const still = { ...ARM_KNOWN, y: { ...ARM_KNOWN.y, hard: null }, r: { ...ARM_KNOWN.r, lo: 0, hi: 0, span: 0, samples: new Array(500).fill(0) } };
  refuses(() => planExperiment(still), 'no-band', /^the page knows no range for angle: say how far it may move$/);
  refuses(() => armPlan({ band: [-0.5, 2.6] }), 'band-hard', /reaches 2\.6 rad, beyond 2\.5/);
});

test('the experiment ends with a sentence when y starts outside the band or drifts too fast (§5.1)', () => {
  const plan = plainPlan();
  const outside = runExperiment(plan, transferPlant(lag(1, 0.3), Ts, { y0: 1.6, noise: 0.001 }));
  assert.equal(outside.exp.state.end.code, 'outside');
  assert.match(outside.exp.state.end.message, /^y is at 1\.6\d*, outside 'may move within': widen it, or bring the plant inside first$/);
  const fast = runExperiment(plan, transferPlant(lag(1, 0.3), Ts, { drift: 0.4, noise: 0.001 }));
  assert.equal(fast.exp.state.end.code, 'drift');
  assert.match(fast.exp.state.end.message, /^y drifts too fast to test: it needs a controller first \(it moves 0\.4\d*\/s with u at 0\)$/);
  assert.ok(outside.exp.state.stop && fast.exp.state.stop, 'both ask for the plant\'s stop');
});

// ---- 1. Determinism

test('1. Determinism: the same plan and the same y give the same u, bit for bit; two runs give identical records', () => {
  const plan = armPlan();
  const a = runExperiment(plan, createArm(drawArm(3), { Ts, seed: 3 }));
  const b = runExperiment(plan, createArm(drawArm(3), { Ts, seed: 3 }));
  assert.equal(a.exp.state.end.code, 'done');
  assert.deepEqual(b.record, a.record, 'two runs, identical records');
  assert.equal(JSON.stringify(b.record), JSON.stringify(a.record));
  // The measured y fed again into a fresh experiment gives every u again,
  // bit for bit (Object.is: no rounding anywhere), with the fit supplied at
  // the same sample.
  const exp = createExperiment(plan);
  const y = a.record.y;
  for (let k = 0; k < y.length; k++) {
    const u = exp.step(k, y[k]);
    assert.ok(Object.is(u + 0, a.record.u[k]), `sample ${k}: ${u} against ${a.record.u[k]}`);
    if (exp.needs) exp.supply('fit', {});
  }
  assert.equal(exp.state.end.code, 'done');
  // The plan is data: through JSON it gives the same experiment.
  const c = runExperiment(JSON.parse(JSON.stringify(plan)), createArm(drawArm(3), { Ts, seed: 3 }));
  assert.deepEqual(c.record, a.record);
  // The record is plain data, as Keep will store it.
  assert.deepEqual(JSON.parse(JSON.stringify(a.record)), a.record);
  // The multisine (the Shake's) depends only on its seed.
  const lines = multisineLines({ N: 256, kmax: 40, seed: 9 });
  assert.deepEqual(multisine({ N: 256, lines: lines.excited, seed: 9 }), multisine({ N: 256, lines: multisineLines({ N: 256, kmax: 40, seed: 9 }).excited, seed: 9 }));
  // No clock and no randomness in the core that runs the experiment.
  for (const f of ['experiment.js', 'identify.js', 'fit.js']) {
    const src = readFileSync(new URL(`../src/core/${f}`, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
    assert.equal(/Date\.now|Math\.random|performance\.now|new Date\b|setTimeout|setInterval/.exec(src), null, f);
  }
});

// ---- 2. Nudge safety

test('2. Nudge safety: 50 arms at ±15 % with the default band: no rung uses half the room on its side, no back-off, never over the top, every rung within 1.15 × the bound predicted before it ran', () => {
  const plan = armPlan();
  let worst = 0, longest = 0, up = 0, down = 0, lastPush = [Infinity, 0];
  for (let seed = 1; seed <= 50; seed++) {
    const arm = createArm(drawArm(seed), { Ts, seed });
    const { exp } = runExperiment(plan, arm, { until: untilHold, maxSeconds: 60 });
    const f = exp.found, L = f.listen;
    assert.ok(!exp.state.done, `arm ${seed}: ${exp.state.end?.message}`);
    const roomUp = plan.band[1] - L.y0, roomDown = L.y0 - plan.band[0];
    for (const R of f.rungs) {
      assert.ok(R.up <= 0.5 * roomUp && R.down <= 0.5 * roomDown, `arm ${seed} rung ${R.n}: ${R.up}, ${R.down} of ${roomUp}, ${roomDown}`);
      assert.equal(R.backoff, false, `arm ${seed} rung ${R.n} backed off`);
      if (R.bound) worst = Math.max(worst, R.up / R.bound[0], R.down / R.bound[1]);
      up = Math.max(up, R.up); down = Math.max(down, R.down);
    }
    longest = Math.max(longest, (f.rungs.at(-1).i1 - f.rungs[0].i0) * Ts);
    const a = f.rungs.at(-1).a;
    lastPush = [Math.min(lastPush[0], a), Math.max(lastPush[1], a)];
    const s = arm.state;
    assert.ok(s.maxAngle < 2 && s.minAngle > -0.5, `arm ${seed} went to ${s.minAngle} … ${s.maxAngle}`);
    assert.ok(s.maxAngle < Math.PI, 'never over the top');
  }
  // The design measured E1's Nudge on 50 arms: +0.18 / −0.14 rad, 3.4 s, last
  // push 0.96–1.92 V. Each rung now starts from rest (waiting at least 1 s,
  // or twice the delay seen, until y is still), so the Nudge is longer
  // (measured 5.4–6.9 s), and from rest the arm's friction makes a doubled
  // push move it up to 1.10 × the bound predicted (2 rungs of 50 arms); the
  // room on each side is never half used.
  assert.ok(up < 0.25 && down < 0.25 && longest < 8 && worst <= 1.15, `reach +${up} / −${down}, Nudge ${longest} s, worst ${worst} of its bound`);
  assert.ok(lastPush[0] >= 0.48 && lastPush[1] <= 1.92, String(lastPush));
});

// ---- 3. Classification

test('3. Classification: a lag settles, an integrator ramps, the arm rings without its friction, and with it the small pushes lie', () => {
  const plan = plainPlan();
  const look = (plant, p = plan) => runExperiment(p, plant, { until: untilHold, maxSeconds: 60 }).exp.found.look;
  const near = (got, want, tol, what) => { for (const [k, v] of Object.entries(want)) assert.ok(rel(got[k], v) < tol, `${what} ${k}: ${got[k]} against ${v}`); };
  const L1 = look(transferPlant(lag(2, 0.5, 0.05), Ts, { noise: 0.001 }));
  assert.deepEqual([L1.cls, L1.structure, L1.integrating], ['settles', 'lag', false]);
  near(L1, { K: 2, tau: 0.5, theta: 0.05 }, 0.05, 'lag');
  // Reverse acting: the sign comes out, so the gentle loop's gains are negative.
  const L2 = look(transferPlant(lag(-2, 0.5, 0.05), Ts, { noise: 0.001 }));
  assert.equal(L2.sign, -1);
  near(L2, { K: -2, tau: 0.5 }, 0.05, 'reverse lag');
  assert.ok(gentleGains(L2, 1, Ts).Kp < 0);
  const L3 = look(transferPlant(integrator(3, 0.1, 0.03), Ts, { noise: 0.001 }));
  assert.deepEqual([L3.cls, L3.structure, L3.integrating], ['ramps', 'intLag', true]);
  near(L3, { kp: 3, tau: 0.1, theta: 0.03 }, 0.05, 'integrator');
  // The arm without Coulomb friction (its viscous and back-EMF damping only):
  // the rest after the Nudge rings, and the first look finds K, f, ζ.
  const armPlanned = armPlan();
  for (const seed of [1, 2, 3]) {
    const p = { ...drawArm(seed), Tc: 0 }, t = armAt(p, 0);
    const L = look(createArm(p, { Ts, seed }), armPlanned);
    assert.deepEqual([L.cls, L.structure], ['rings', 'resonance'], `arm ${seed}`);
    near(L.p, { K: t.gain, f: t.f, zeta: t.zeta }, 0.03, `arm ${seed}`);
  }
  // With its friction (0.01 N·m, about 0.2 V) the Nudge's ±0.2 rad stop
  // within half a swing (Coulomb takes 4·Tc/mgl ≈ 0.4 rad a cycle): no swing
  // in the rest, and an overdamped second order: tiny amplitudes lie (the
  // research's warning), which is why the ladder and the Shake follow.
  for (const seed of [1, 2, 3]) {
    const L = look(createArm(drawArm(seed), { Ts, seed }), armPlanned);
    assert.equal(L.swing.count, 0, `arm ${seed}`);
    assert.ok(L.structure === 'resonance' && L.p.zeta > 0.5, `arm ${seed}: ${L.structure} ζ ${L.p.zeta}`);
  }
});

test('3. Classification: an unstable plant runs away and the experiment asks for stop; an unwired plant does not move', () => {
  const plan = plainPlan();
  for (const tau of [0.3, 1]) {
    const res = runExperiment(plan, transferPlant(unstable(1, tau), Ts, { noise: 0.001 }));
    const s = res.exp.state;
    assert.equal(s.end?.code, 'runaway', `τ ${tau}: ${s.end?.message}`);
    assert.equal(s.end.message, 'y runs away when pushed and does not come back: it needs a stabilising controller before it can be identified');
    assert.ok(s.done && s.stop && res.exp.stopAsked, 'it asks for the plant\'s stop');
    assert.equal(res.exp.step(res.steps, 0), plan.u0, 'after the end: u₀');
  }
  const res = runExperiment(plan, unwired(Ts, { noise: 0.001 }));
  assert.equal(res.exp.state.end.code, 'none');
  assert.equal(res.exp.state.end.message, 'u does not move y: is u wired to the plant?');
  // It grew the pushes to their limits first: half the free range, and long.
  const last = res.exp.found.rungs.at(-1);
  assert.ok(last.a === 0.5 * 2 && last.T * Ts >= 2, `${last.a}, ${last.T}`);
});

test('3. Classification: drift is noted and subtracted', () => {
  const plan = plainPlan();
  // A lag whose output drifts 0.02 /s: noted, and the look finds the lag through it.
  const a = runExperiment(plan, transferPlant(lag(2, 0.5, 0.05), Ts, { noise: 0.001, drift: 0.02 }), { until: untilHold, maxSeconds: 60 });
  const L = a.exp.found.listen;
  assert.ok(L.drifts && rel(L.drift, 0.02) < 0.05, String(L.drift));
  assert.ok(a.record.log.some((e) => e.kind === 'note' && /does not stay put with u at 0/.test(e.text)));
  const look = a.exp.found.look;
  assert.equal(look.cls, 'settles');
  for (const [k, v] of Object.entries({ K: 2, tau: 0.5, theta: 0.05 })) assert.ok(rel(look[k], v) < 0.05, `${k}: ${look[k]}`);
  // An integrator pushed by a constant offset drifts by itself; its look and
  // the whole test come through, and the gentle loop's integral holds it.
  const b = runExperiment(plan, transferPlant(integrator(3, 0.1, 0.03), Ts, { noise: 0.001, bias: 0.01 }));
  assert.ok(b.exp.found.listen.drifts && rel(b.exp.found.listen.drift, 0.03) < 0.1);
  assert.ok(rel(b.exp.found.look.kp, 3) < 0.05, String(b.exp.found.look.kp));
  assert.equal(b.exp.state.end.code, 'done');
  // Without the drift taken out the lag's look would be off: the Listen's
  // slope is what made it right.
  const st = listenStats(Array.from({ length: 300 }, (_, k) => 0.5 + 0.0002 * k), Ts, { span: 1 });
  assert.ok(st.drifts && Math.abs(st.drift - 0.02) < 1e-9 && Math.abs(st.y0 - (0.5 + 0.0002 * 299)) < 1e-9);
});

// ---- 4. Hold

test('4. Hold: SIMC\'s robust branch (τc₀ = 2(τ + θ) or 3(θ + τ), Ti = 4(τc + θ)), the same PI as controllers.js', () => {
  const settles = { integrating: false, K: 2, tau: 0.5, theta: 0.05 };
  const th = 0.05 + Ts / 2;
  assert.ok(Math.abs(gentleTauC(settles, Ts) - 2 * (0.5 + th)) < 1e-15);
  const g = gentleGains(settles, 1.2, Ts);
  assert.ok(Math.abs(g.Kp - 0.5 / (2 * (1.2 + th))) < 1e-15 && Math.abs(g.Ti - 4 * (1.2 + th)) < 1e-15 && Math.abs(g.Ki - g.Kp / g.Ti) < 1e-15);
  const ramps = { integrating: true, kp: 3, tau: 0.1, theta: 0.03 };
  const thI = 0.03 + 0.1 + Ts / 2;
  assert.ok(Math.abs(gentleTauC(ramps, Ts) - 3 * thI) < 1e-15);
  const gi = gentleGains(ramps, 0.5, Ts);
  assert.ok(Math.abs(gi.Kp - 1 / (3 * (0.5 + thI))) < 1e-15 && Math.abs(gi.Ti - 4 * (0.5 + thI)) < 1e-15);
  assert.ok(gentleGains({ ...settles, K: -2 }, 1.2, Ts).Kp === -g.Kp, 'a reverse-acting plant: negative gains');
  // The law is controllers.js's PID (Kd 0, b 1, clamping) started at its
  // integral: "Add as variant" gives the same u, sample for sample.
  const I0 = 0.37, lo = -1, hi = 1.5;
  const mine = piLaw(g, I0, lo, hi, Ts);
  const theirs = makeLaw(normalizeVariant({ type: 'pid', params: { Kp: g.Kp, Ki: g.Ki, Kd: 0, u0: I0, umin: lo, umax: hi } }), Ts);
  for (let k = 0; k < 2000; k++) {
    const r = k < 300 ? 0 : k < 1200 ? 5 : -3, y = Math.sin(k / 37) * 2;
    assert.ok(Object.is(mine.step(r, y), theirs.step([r, y])), `sample ${k}`);
  }
  // Bumpless: the integral that makes the first u the current one.
  const law = piLaw(g, bumpless(g, 0.8, 1, 0.3), lo, hi, Ts);
  assert.ok(Math.abs(law.step(1, 0.3) - 0.8) < 1e-15);
});

test('4. Hold: every switch is bumpless; a band exit under the gentle loop gives u₀ and stop', () => {
  // Each law switch in a whole run (the Hold's takeover, every try and back) keeps u.
  const res = runExperiment(armPlan(), createArm(drawArm(5), { Ts, seed: 5 }));
  const { u, log } = res.record;
  const laws = log.filter((e) => e.kind === 'law');
  assert.ok(laws.length >= 4);
  for (const e of laws) assert.ok(Math.abs(u[e.i] - u[e.i - 1]) < 1e-9, `switch at ${e.i} (${e.role}): ${u[e.i - 1]} → ${u[e.i]}`);
  // The Hold took over at u₀ with the gentle gains from the first look.
  const hold = laws[0], look = res.exp.found.look;
  assert.equal(hold.role, 'hold');
  const g = gentleGains(look, gentleTauC(look, Ts), Ts);
  assert.ok(Object.is(hold.Kp, g.Kp) && Object.is(hold.Ki, g.Ki));
  assert.equal(u[hold.i], 0);
  // A plant that turns the other way once the Hold starts: the gentle loop,
  // bringing y to where r starts, pushes it away; the wrong-way guard ends
  // the test before y reaches the band's edge (a quarter of the room on that
  // side), u goes to u₀ and the plant is asked to stop.
  const from05 = stepR.map((v) => (v ? 1.5 : 0.5));
  const plan = plainPlan({ r: { lo: 0.5, hi: 1.5, span: 1, source: 'r', period: 6, samples: from05, Ts } });
  const rest = { noise: 0.001, y0: 0.3 };
  const probe = runExperiment(plan, transferPlant(lag(2, 0.5, 0.05), Ts, rest), { until: untilHold, maxSeconds: 60 });
  const at = probe.steps;
  assert.equal(probe.exp.state.stage, 'hold');
  const plant = swapped(transferPlant(lag(2, 0.5, 0.05), Ts, rest), transferPlant(lag(-2, 0.5, 0.05), Ts, { ...rest, seed: 4 }), at);
  const out = runExperiment(plan, plant);
  const s = out.exp.state;
  assert.equal(s.end.code, 'away', s.end.message);
  assert.match(s.end.message, /^the gentle controller pushed y away from 0\.5 \(.+\): the page stopped the plant; the pushes may have been read the wrong way round$/);
  assert.ok(s.stop);
  assert.equal(out.record.u.at(-1), plan.u0);
  for (const v of out.truth) assert.ok(v >= plan.band[0] && v <= plan.band[1], `the plant at ${v}`);
  // A band exit under the gentle loop (the plant's output jumps out): u₀ and stop, at once.
  const jump = swapped(transferPlant(lag(2, 0.5, 0.05), Ts, rest), transferPlant(lag(2, 0.5, 0.05), Ts, { ...rest, y0: 5 }), at);
  const out2 = runExperiment(plan, jump);
  assert.equal(out2.exp.state.end.code, 'band', out2.exp.state.end.message);
  assert.match(out2.exp.state.end.message, /^y left 'may move within' under the gentle controller \(.+\): the page stopped the plant$/);
  assert.ok(out2.exp.state.stop);
  assert.equal(out2.record.u.at(-1), plan.u0);
});

// ---- Scoring a try

test('a try\'s J is Auto-tune\'s cost of the run; its margin is room kept and ringing (§5.4)', () => {
  const n = 400;
  const r = Float64Array.from({ length: n }, (_, k) => (k < 50 ? 0 : k < 250 ? 1 : 0.4));
  const y = Float64Array.from({ length: n }, (_, k) => { const t = k < 50 ? 0 : k < 250 ? k - 50 : k - 250; const r1 = k < 50 ? 0 : k < 250 ? 1 : 0.4, r0 = k < 50 ? 0 : k < 250 ? 0 : 1; return r1 + (r0 - r1) * Math.exp(-t / 15) * Math.cos(t / 6); });
  const u = Float64Array.from({ length: n }, (_, k) => Math.min(2, 1.5 * (r[k] - y[k]) + 0.5 * r[k]));
  const run = { t: Float64Array.from({ length: n }, (_, k) => k * Ts), signals: { 'c.r': r, 'c.y': y, 'c.u': u } };
  const theirs = runCost(run, 'c', {}, { scales: { e: 1, u: 4 }, variant: { params: { umin: -2, umax: 2 } } });
  const mine = tryCost(r, y, u, { R: 1, U: 4, lo: -2, hi: 2 });
  assert.ok(Math.abs(mine.J - theirs.J) < 1e-12, `${mine.J} against ${theirs.J}`);
  assert.ok(Math.abs(mine.overshoot - theirs.overshoot) < 1e-9 && mine.parts.saturation > 0);
  // Room kept: y's closest approach to the band's edge over r's own.
  const band = [-0.5, 2];
  const m = tryMargin(r, y, band);
  let dy = Infinity;
  for (let k = 0; k < n; k++) dy = Math.min(dy, y[k] + 0.5, 2 - y[k]);
  assert.ok(Math.abs(m.gRoom - dy / 0.5) < 1e-12);
  // Ringing: the third half-wave after each step, against 20 % of the step.
  const flat = tryMargin(r, Float64Array.from(r), band);
  assert.deepEqual([flat.gRing, flat.gRoom], [1, 1]);
  assert.ok(m.gRing < 1 && m.g === Math.min(m.gRoom, m.gRing));
});

// ---- The machine's interface

test('the experiment says what it is doing: stages, chips, meters, status, needs and supply (§4, §5.5)', () => {
  const plan = armPlan();
  const arm = createArm(drawArm(7), { Ts, seed: 7 });
  const exp = createExperiment(plan);
  const seen = new Set(), stages = [];
  let waited = null;
  for (let k = 0; !exp.state.done && k < 20000; k++) {
    const r = exp.reference(k);
    const u = exp.step(k, arm.output(), k ? arm.applied : undefined);
    const s = exp.state;
    if (stages.at(-1) !== s.stage) stages.push(s.stage);
    seen.add(s.status.split(/[:,]/)[0]);
    assert.ok(s.push >= 0 && s.push <= 1 && s.pushMax >= s.push);
    assert.equal(exp.record().r[k], r, 'reference(k) is what the sample used');
    if (exp.needs) {
      assert.equal(exp.needs.kind, 'fit');
      // On HIL the page fits while the loop holds; here the supply comes 3 s late.
      waited ??= k;
      if (k - waited >= 300) exp.supply('fit', { prediction: [] });
    }
    arm.advance(u);
  }
  assert.deepEqual(stages, ['listen', 'nudge', 'hold', 'ease', 'check']);
  assert.equal(exp.state.end.code, 'done');
  assert.deepEqual(exp.state.chips.map((c) => `${c.label} ${c.mark}`), ['Listen ✓', 'Nudge ✓', 'Hold ✓', 'Ease in ✓', 'Shake –', 'Check ✓']);
  assert.ok(exp.state.tries.length >= 2 && exp.state.tries.every((t) => /^(✓ quicker|· no better|! rang|! near the edge|✕ left the range, back to the last good one)$/.test(t)));
  for (const s of ['Listening', 'Nudge 3', 'Holding angle at 0 rad with a gentle controller', 'Ease in', 'Fitting the model while the controller holds angle at 0 rad', 'Check']) assert.ok([...seen].some((x) => x.startsWith(s)), s);
  // The pause waited for the supply, then went on.
  const pause = exp.record().log.find((e) => e.kind === 'pause');
  assert.ok(pause.waited >= 3 && pause.waited < 3.05, String(pause.waited));
  assert.throws(() => exp.supply('fit', {}), /nothing waits for fit/);
  // Applied u is recorded where the plant echoed it.
  const rec = exp.record();
  assert.ok(rec.applied.slice(0, -1).every((v, k) => Object.is(v, rec.u[k])) && rec.applied.at(-1) === null);
  // Stop is soft, an E-stop ends at once; both keep the record and ask for stop.
  const e2 = createExperiment(plan), arm2 = createArm(NOMINAL, { Ts });
  for (let k = 0; k < 500; k++) arm2.advance(e2.step(k, arm2.output()));
  e2.stop();
  assert.deepEqual([e2.state.end.code, e2.state.stop, e2.record().u.length], ['stopped', true, 500]);
  const e3 = createExperiment(plan);
  e3.step(0, 0);
  e3.abort('stop pressed at the plant');
  assert.match(e3.state.end.message, /^ended by the plant's stop at 0 s: stop pressed at the plant$/);
  // A gap in seq: the plant held u; it is recorded where it happened.
  const e4 = createExperiment(plan);
  e4.step(0, 0); e4.step(1, 0); e4.step(5, 0);
  assert.deepEqual(e4.record().gaps, [[2, 3]]);
  assert.throws(() => e4.step(5, 0), /came after/);
});

// ---- Nothing of the fixtures in the page

// ---- After review: the experiment on many plants (decisions.md)

// Runs a plan on a plant sample by sample, as runExperiment does, with a hook
// that may change y before the experiment reads it (a lost measurement).
function runLosing(plan, plant, lose, maxSeconds = plan.budget + 30) {
  const exp = createExperiment(plan);
  const truth = [];
  let k = 0;
  for (; k < Math.ceil(maxSeconds / plan.Ts) && !exp.state.done; k++) {
    const yv = plant.output();
    truth.push(plant.truth ? plant.truth() : plant.state?.angle);
    const u = exp.step(k, lose(k, exp) ? NaN : yv);
    if (exp.needs) exp.supply(exp.needs.kind, {});
    plant.advance(u);
  }
  return { exp, record: exp.record(), truth, steps: k };
}

test('a lost measurement (y not a number) is held over: one in Listen, in a rung, in each try and in the Check changes nothing that matters', () => {
  const plan = armPlan();
  const clean = runLosing(plan, createArm(drawArm(1), { Ts, seed: 1 }), () => false);
  const tried = new Set();
  const lossy = runLosing(plan, createArm(drawArm(1), { Ts, seed: 1 }), (k, exp) => {
    const s = exp.state;
    if (k === 150 || k === 330) return true;                       // Listen, the first rung
    if (s.stage === 'ease' && !tried.has(s.try) && /quicker than/.test(s.status) && exp.reference(k) > 1) { tried.add(s.try); return true; }
    return s.stage === 'check' && k % 97 === 0;
  });
  assert.equal(lossy.exp.state.end.code, 'done', lossy.exp.state.end.message);
  assert.ok(lossy.record.y.filter((v) => v === null).length >= 4, 'samples were lost');
  // (First built, one lost sample in a rung read "is V wired?", and one per try made every try "· no better".)
  assert.ok(lossy.exp.state.tries.filter((m) => m.startsWith('✓')).length >= clean.exp.state.tries.filter((m) => m.startsWith('✓')).length - 1, `${lossy.exp.state.tries} against ${clean.exp.state.tries}`);
  for (const T of lossy.record.log.filter((e) => e.kind === 'try')) assert.ok(Number.isFinite(T.J) && Number.isFinite(T.g), `try ${T.n}: J ${T.J}, g ${T.g}`);
});

test('the sign is read from rest: tanks drawn within ±15 % whose sign was read the wrong way round (and emptied) now read it right and never empty', () => {
  const base = libraryProject('Conical tank');
  const known = knownFor(base);
  const plan = planExperiment(known, identifySettings(base, null, { known }));
  // As first built these eight read the sign as −1 mid-swing, and the gentle loop emptied the tank.
  for (const seed of [13, 15, 24, 25, 30, 33, 41, 50]) {
    const project = structuredClone(base);
    project.system.plant.diagram = varyDiagram(project.system.plant.diagram, 0.15, seed).diagram;
    const res = runExperiment(plan, diagramPlant(project, 'ctrl', { hold: { d: 0 }, noise: 0.001 }));
    const look = res.exp.found.look;
    assert.ok(!look || look.sign === 1, `tank ${seed}: sign ${look?.sign}`);
    // The measured level passes a 0.1 s pipe that reads 0 before it fills: after that, never empty.
    const empty = res.truth.slice(Math.round(0.2 / plan.Ts)).filter((v) => v <= 1e-6).length;
    assert.equal(empty, 0, `tank ${seed}: empty for ${empty} samples (${res.exp.state.end.message})`);
    assert.ok(['done', 'room'].includes(res.exp.state.end.code), `tank ${seed}: ${res.exp.state.end.message}`);
  }
});

test('an unstable plant is stopped while it accelerates away, not at the band\'s edge; one that runs off in Listen is stopped there', () => {
  const plan = plainPlan();
  const hi = plan.band[1];
  // As first built, every one was declared a runaway only at the edge (|y| 1.34–1.5 for a band ending at 1.33).
  for (const [label, plant, most] of [
    ['τ 0.3', transferPlant(unstable(1, 0.3), Ts, { noise: 0.001 }), 0.5],
    ['τ 1', transferPlant(unstable(1, 1), Ts, { noise: 0.001 }), 0.3],
    ['inverted pendulum ω 3', transferPlant({ num: [9], den: [1, 0, -9] }, Ts, { noise: 0.001 }), 0.3],
  ]) {
    const res = runExperiment(plan, plant);
    assert.equal(res.exp.state.end.code, 'runaway', `${label}: ${res.exp.state.end.message}`);
    const far = Math.max(...res.truth.map(Math.abs));
    assert.ok(far < most * hi, `${label}: reached ${far}`);
  }
  // With a small bias it runs off at u₀ during Listen (as built, to 220 for a band of ±1.3).
  const res = runExperiment(plan, transferPlant(unstable(1, 0.3), Ts, { noise: 0.001, bias: 0.01 }));
  assert.equal(res.exp.state.end.code, 'drift');
  assert.match(res.exp.state.end.message, /^y drifts out of 'may move within' with u held at 0 \(from .+ to .+ in .+ s\): it needs a controller first$/);
  assert.ok(res.exp.state.stop && Math.max(...res.truth) < hi + 0.1 * (hi - plan.band[0]), String(Math.max(...res.truth)));
});

test('a try that leaves the band hands over without a kick, r ramping back; a test ending under the incumbent ends softly, and Stop is soft', () => {
  // A tight band on the arm (−0.15 … 1.65): try 1 leaves it.
  const plan = armPlan({ band: [-0.15, 1.65] });
  const U = plan.umax - plan.umin;
  const arm = createArm(drawArm(6), { Ts, seed: 6 });
  const res = runExperiment(plan, arm);
  const T = res.record.log.find((e) => e.kind === 'try' && e.left);
  assert.ok(T, 'a soft guard');
  const { u, r } = res.record;
  let kick = 0;
  for (let k = T.iEnd; k <= T.iEnd + 3; k++) kick = Math.max(kick, Math.abs(u[k] - u[k - 1]));
  // As first built, r jumped to r(0) and u kicked by Kp × the step, 37 % of the range.
  assert.ok(kick < 0.05 * U, `kick ${kick}`);
  assert.ok(Math.abs(r[T.iEnd + 1] - r[T.iEnd]) <= Math.abs(r[T.iEnd] - plan.test.r[0]) / 10 + 1e-12, 'r does not step back: it ramps');
  // However the test ended, the plant was not released on its way out: run on at u₀ for 5 s, the arm stays below the top.
  for (let k = 0; k < 500; k++) arm.advance(plan.u0);
  assert.ok(arm.state.maxAngle < Math.PI && arm.state.minAngle > -Math.PI, `${arm.state.minAngle} … ${arm.state.maxAngle}`);
  // Stop pressed while a try holds the arm up near 1.3 rad: the loop brings it back, then the plant stops.
  const plan2 = armPlan();
  const arm2 = createArm(drawArm(1), { Ts, seed: 1 });
  const exp = createExperiment(plan2);
  let k = 0, lo = Infinity, hiA = -Infinity;
  for (; k < 20000; k++) {
    const uu = exp.step(k, arm2.output());
    if (exp.needs) exp.supply('fit', {});
    arm2.advance(uu);
    if (exp.state.stage === 'ease' && exp.state.try >= 2 && exp.reference(k) > 1.4 && arm2.truth() > 1.3) break;
  }
  const before = exp.record().u.at(-1);
  exp.stop();
  assert.equal(exp.state.done, false, 'the loop holds before the plant stops');
  const after = exp.step(++k, arm2.output());
  assert.ok(Math.abs(after - before) < 0.05 * (plan2.umax - plan2.umin), `${before} → ${after}`);
  for (let j = 0; j < 500; j++) { const uu = exp.step(++k, arm2.output()); arm2.advance(uu); lo = Math.min(lo, arm2.truth()); hiA = Math.max(hiA, arm2.truth()); }
  // As first built, u went to 0 V at once and the arm swung to −0.45 rad.
  assert.ok(lo > -0.2 && hiA < plan2.band[1], `${lo} … ${hiA}`);
  assert.equal(exp.state.end.code, 'stopped');
  assert.ok(exp.state.stop);
});

test('the sentences say what is true: noise against the room, an edge too near, the smallest push already too far, a plant that does not come back, the length that fits', () => {
  const end = (plan, plant) => runExperiment(plan, plant).exp.state.end;
  // Noise 3 % of the room: not "is u wired?" (as first built) but the room.
  const noisy = end(plainPlan(), transferPlant(lag(2, 0.5, 0.05), Ts, { noise: 0.01, seed: 1 }));
  assert.equal(noisy.code, 'room');
  assert.match(noisy.message, /^y moves too little to read within half of 'may move within' \(its noise is 0\.0\d+\): widen it$/);
  // r(0) at the band's edge.
  const edge = end(armPlan({ band: [-0.005, 2] }), createArm(drawArm(1), { Ts, seed: 1 }));
  assert.match(edge.message, /^angle starts 0\.00\d+ rad from the edge of 'may move within' \(its noise is .+\): widen it below -0\.005 rad, so the pushes have room both ways$/);
  // A gain of 1000: not a runaway.
  const far = end(plainPlan(), transferPlant(lag(1000, 0.5, 0), Ts, { noise: 0.001 }));
  assert.match(far.message, /^y moves too far at the smallest push \(0\.04, 1 % of u's range, took it to .+\): narrow u's range in the Controller tab, or widen 'may move within'$/);
  // A double integrator: its time scale is beyond any test.
  const dbl = end(plainPlan(), transferPlant({ num: [1], den: [1, 0, 0] }, Ts, { noise: 0.001 }));
  assert.equal(dbl.code, 'slow');
  assert.match(dbl.message, /^y does not come back after a push \(its time scale reads .+ s\): it needs a controller that holds it before it can be identified$/);
  // 30 s for the arm: the length that fits is named (as first built: "0.5 min … the Nudge alone took 6 s. Allow 5 min.").
  const short = end(armPlan({ budget: 30 }), createArm(drawArm(2), { Ts, seed: 2 }));
  assert.match(short.message, /^30 s is too short for this plant: the test so far took \d+ s, and one try needs about \d+ s more\. Allow 1 min\.$/);
  assert.equal(end(armPlan({ budget: 60 }), createArm(drawArm(2), { Ts, seed: 2 })).code, 'done');
  // Short budgets reserve both of the Hold's windows: never "Done" without a try.
  for (const budget of [31, 33, 36]) {
    for (const seed of [1, 2, 3]) {
      const res = runExperiment(armPlan({ budget }), createArm(drawArm(seed), { Ts, seed }));
      const tries = res.record.log.filter((e) => e.kind === 'try').length;
      assert.ok(res.exp.state.end.code !== 'done' || tries > 0, `budget ${budget}, arm ${seed}: done with no try`);
    }
  }
});

test('the fixtures stay out of the page: no plant numbers or test code in the bundle', () => {
  const bundle = bundleScript();
  // The shipped plant script rides along on purpose (Live mode offers it); the code does not.
  const code = bundle.replace(/^const __HIL_FILES = .*$/m, '');
  // (The library's own physics may name mgl, as the pendulum chain does: the
  // examples are data. What must stay out is the fixtures' code and names.)
  for (const word of ['W_EPS', 'w_eps', 'drawArm', 'createArm', 'armProject', 'armSubsystem', 'transferPlant', 'diagramPlant', 'runExperiment', 'contSim', 'fixtures', 'NOMINAL']) {
    assert.equal(code.includes(word), false, word);
  }
  const build = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');
  assert.ok(!/test\//.test(build.slice(build.indexOf('const MODULES'), build.indexOf('];', build.indexOf('const MODULES')))));
  assert.ok(code.includes("__mods['core/experiment.js']") && code.includes("__mods['core/identify.js']"));
});
