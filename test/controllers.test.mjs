// The standard controller's reference feedforward and anti-windup
// (design/output/controller-proposal.md), and the examples that show them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTROLLERS, normalizeVariant, makeLaw, trackingTime } from '../src/core/controllers.js';
import { normalizeProject, evaluateSystem, autoTimebase } from '../src/core/project.js';
import { SYSTEM_LIBRARY, SYSTEM_PARTS, applySystem } from '../src/core/systems.js';
import { DEFAULT_PROJECT } from '../src/core/examples.js';

const OPEN = { umin: -Infinity, umax: Infinity };
const law = (params, Ts = 0.01, type = 'pid') => makeLaw(normalizeVariant({ type, params }), Ts);

// A library system with its controller block running the named variant.
function runSystem(name, variant) {
  const p = normalizeProject(applySystem(DEFAULT_PROJECT, SYSTEM_LIBRARY.find((s) => s.name.startsWith(name)), SYSTEM_PARTS));
  p.scope.timebase = autoTimebase(p);
  const c = p.system.plant.diagram.blocks.find((b) => b.type === 'controller');
  c.variant = c.variants.findIndex((v) => v.name === variant);
  assert.ok(c.variant >= 0, `${name} has a variant "${variant}"`);
  return { p, res: evaluateSystem(p) };
}

test('feedforward and anti-windup default to what was there: a project from before runs the same', () => {
  const v = normalizeVariant({ type: 'pid', params: { Kp: 2, Ki: 1 } });
  assert.deepEqual([v.params.Kff, v.params.Kv, v.params.Ka, v.params.aw, v.params.Tt], [0, 0, 0, 'clamp', 0]);
  const g = normalizeVariant({ type: 'gainScheduled', params: { at: [0, 1], Kp: [1, 2], Ki: [1, 1] } });
  assert.deepEqual([g.params.Kff, g.params.Kv, g.params.Ka, g.params.aw], [0, 0, 0, 'clamp']);
  assert.throws(() => normalizeVariant({ type: 'pid', params: { aw: 'sometimes' } }), /aw: one of clamp, back, off/);
  assert.equal(JSON.parse(JSON.stringify(v)).params.aw, 'clamp', 'the mode is saved as its name');
});

test('feedforward: Kff·r, Kv·dr/dt and Ka·d²r/dt² on the prefiltered reference, without a kick at the first sample', () => {
  const Ts = 0.01;
  // A reference that starts at 3 and then ramps at 2 per second; the measurement stays at 0, no feedback.
  const ff = law({ Kp: 0, Kff: 0.5, Kv: 0.1, Ka: 0.01, ...OPEN }, Ts);
  const u = Array.from({ length: 5 }, (_, k) => ff.step([3 + 2 * k * Ts, 0]));
  assert.ok(Math.abs(u[0] - 1.5) < 1e-12, `first sample: only Kff·r (${u[0]})`);
  // Sample 1: the ramp starts, so velocity 2 and an acceleration of 2/Ts for one sample.
  assert.ok(Math.abs(u[1] - (0.5 * 3.02 + 0.1 * 2 + 0.01 * 2 / Ts)) < 1e-9, `${u[1]}`);
  for (const k of [2, 3, 4]) assert.ok(Math.abs(u[k] - (0.5 * (3 + 2 * k * Ts) + 0.1 * 2)) < 1e-9, `sample ${k}: ${u[k]}`);
  // It acts on rf: with a prefilter, a step of r reaches u through the lag, not as a jump.
  const pre = law({ Kp: 0, Kv: 1, Tr: 0.1, ...OPEN }, Ts);
  pre.step([0, 0]);
  assert.ok(pre.step([1, 0]) < 1 / Ts * 0.2, 'the velocity of the prefiltered step is bounded');
  // The scheduled PI has the same feedforward.
  const gs = law({ at: [0, 1], Kp: [0, 0], Ki: [0, 0], Kff: 2, ...OPEN }, Ts, 'gainScheduled');
  assert.equal(gs.step([0.25, 0]), 0.5);
});

test('anti-windup judges the total output: feedforward that saturates u stops the integral (clamping)', () => {
  const Ts = 0.01;
  // Kff alone asks for 2 at r = 1, the limit is 1: the error keeps pushing up, so the integral holds.
  const c = law({ Kp: 0, Ki: 5, Kff: 2, umin: -1, umax: 1 }, Ts);
  for (let k = 0; k < 100; k++) c.step([1, 0.5]);
  // When r drops to 0, u = I alone: it was clamped at its start (0), so u is 0, not 5·1·0.5 = 2.5.
  assert.ok(Math.abs(c.step([0, 0])) < 1e-9);
  const off = law({ Kp: 0, Ki: 5, Kff: 2, umin: -1, umax: 1, aw: 'off' }, Ts);
  for (let k = 0; k < 100; k++) off.step([1, 0.5]);
  assert.equal(off.step([0, 0]), 1, 'without anti-windup the integral wound up to 2.5 and holds u at the limit');
});

test('back-calculation tracks the limit with time constant Tt; the rule gives √(Ti·Td), or Ti/2 for a PI', () => {
  assert.equal(trackingTime({ Kp: 1, Ki: 4, Kd: 0 }, 0.01), 0.125, 'PI: Ti/2');
  assert.ok(Math.abs(trackingTime({ Kp: 1, Ki: 4, Kd: 0.0625 }, 0.01) - 0.125) < 1e-12, 'PID: √(Ti·Td) = √(0.25 · 0.0625)');
  assert.equal(trackingTime({ Kp: 1, Ki: 4, Kd: 0, Tt: 0.3 }, 0.01), 0.3, 'a given Tt wins');
  assert.equal(trackingTime({ Kp: 0, Ki: 4, Kd: 0 }, 0.01), 0.01, 'never below Ts');
  // An integrator alone (v = I) at the limit 0.5 with error 1: I settles at 0.5 + Ki·Tt·e = 0.9.
  // When the error reverses to −1, I falls toward 0.5 − 0.4 and passes the limit after Tt·ln 2.
  const Ts = 0.001, Tt = 0.2;
  const c = law({ Kp: 0, Ki: 2, aw: 'back', Tt, umin: -0.5, umax: 0.5 }, Ts);
  for (let k = 0; k < 3000; k++) c.step([1, 0]);
  let k = 0;
  while (c.step([0, 1]) >= 0.5 - 1e-12 && k < 5000) k++;
  const t = k * Ts;
  assert.ok(Math.abs(t - Tt * Math.LN2) < 3 * Ts, `leaves the limit after ${t} s, expected ${Tt * Math.LN2}`);
  // Clamping leaves at once (the integral never passed the limit); off takes as long as it wound up.
  const leave = (aw) => {
    const l = law({ Kp: 0, Ki: 2, aw, umin: -0.5, umax: 0.5 }, Ts);
    for (let i = 0; i < 3000; i++) l.step([1, 0]);
    let n = 0;
    while (l.step([0, 1]) >= 0.5 - 1e-12 && n < 10000) n++;
    return n * Ts;
  };
  assert.ok(leave('clamp') < 2 * Ts && leave('off') > 2.4, `clamp ${leave('clamp')} s, off ${leave('off')} s`);
});

test('the oven without anti-windup overshoots much more after the heater saturates than with clamping or back-calculation', () => {
  const peak = (name, aw) => {
    const { p, res } = runSystem('Oven', name);
    if (aw) {
      const c = p.system.plant.diagram.blocks.find((b) => b.type === 'controller');
      c.variants[c.variant].params.aw = aw;
      Object.assign(res, evaluateSystem(p));
    }
    const { t, signals: { T, P } } = res;
    let top = 0, full = 0;
    for (let k = 0; k < t.length; k++) if (t[k] > 0.2 && t[k] < 2.2) { top = Math.max(top, T[k]); if (P[k] >= 100 - 1e-9) full++; }
    return { over: (top - 40) / 40, full };
  };
  const clamp = peak('PID, badly tuned'), off = peak('PID, badly tuned, no anti-windup'), back = peak('PID, badly tuned', 'back');
  assert.ok(off.full > 0 && clamp.full > 0, 'the heater saturates');
  assert.ok(off.over > 2 * clamp.over && off.over > 2 * back.over, `overshoot: off ${off.over}, clamping ${clamp.over}, back-calculation ${back.over}`);
  assert.ok(off.over > 0.6 && clamp.over < 0.35, `${off.over} ${clamp.over}`);
});

test('following a sine: PID + feedforward flattens the error figure (σ at least 5 times smaller than the PID)', async () => {
  const { lineFit, ySignal } = await import('../src/ui/xyview.js');
  const figure = (name) => {
    const { p, res } = runSystem('Following a sine', name);
    const unit = (s) => ({ r: 'rad', angle: 'rad', V: 'V' })[s];
    const e = ySignal(res, p.scope, 1, unit), n = res.t.length;
    return lineFit(res.signals.r, e, Math.round(n * 0.3), n - 1);
  };
  const pid = figure('PID'), ff = figure('PID + feedforward');
  assert.ok(ff.sigma * 5 < pid.sigma, `σ: PID ${pid.sigma}, PID + feedforward ${ff.sigma}`);
  assert.ok(Math.abs(ff.a) < 0.005 && Math.abs(ff.a) < Math.abs(pid.a) / 5, `the line lies flat: slope ${ff.a} (PID ${pid.a})`);
  const v = SYSTEM_LIBRARY.find((s) => s.name.startsWith('Following a sine')).plant.diagram.blocks.find((b) => b.type === 'controller').variants;
  const a = v.find((x) => x.name === 'PID').params, b = v.find((x) => x.name === 'PID + feedforward').params;
  assert.deepEqual({ ...b, Kv: 0 }, { ...a, Kv: 0 }, 'the same PID, plus Kv');
  assert.ok(b.Kv > 0);
});

test('every type in the library still runs its default and keeps u inside its limits', () => {
  for (const [type, def] of Object.entries(CONTROLLERS)) {
    const v = normalizeVariant({ type, params: def.params.some((p) => p.key === 'umin') ? { umin: -1, umax: 1 } : {} });
    const l = makeLaw(v, 0.01);
    for (let k = 0; k < 50; k++) {
      const u = l.step([1, 0, 0, 0, 0]);
      assert.ok(Number.isFinite(u) && u >= -1 && u <= 1, `${type}: ${u}`);
    }
  }
});

test('the structure diagram: every type has its picture, inside its canvas, with the live values on it', async () => {
  const { describeVariant, DESCRIBED_TYPES, NOTE_CHAR } = await import('../src/core/structure.js');
  const { OBSERVERS } = await import('../src/core/observers.js');
  assert.deepEqual([...Object.keys(CONTROLLERS), ...Object.keys(OBSERVERS)].filter((t) => !DESCRIBED_TYPES.includes(t)), [], 'a type without its own picture');
  const text = (n) => (n.lines ?? []).map((l) => l.map(([t]) => t).join('')).join(' / ') + (n.text ?? '');
  // Every variant of every library system, and each type's defaults.
  const cases = [];
  for (const e of SYSTEM_LIBRARY) for (const b of e.plant.diagram.blocks) if (b.type === 'controller') for (const v of b.variants) cases.push({ v: normalizeVariant(v), inputs: ['r', ...Array.from({ length: b.params.inputs - 1 }, (_, i) => `y${i + 1}`)] });
  for (const t of Object.keys(CONTROLLERS)) cases.push({ v: normalizeVariant({ type: t }), inputs: ['r', 'y'] });
  for (const t of Object.keys(OBSERVERS)) cases.push({ v: normalizeVariant({ type: t }, 'variant', OBSERVERS), inputs: ['u', 'y'] });
  for (const { v, inputs } of cases) {
    const d = describeVariant(v, { inputs, Ts: 0.01 });
    const where = `${v.type} "${v.name}"`;
    for (const n of d.nodes) {
      if (n.kind === 'switch') { assert.ok([n.a, n.b, n.pivot].every(([x, y]) => x >= 0 && x <= d.w && y >= 0 && y <= d.h), `${where}: the switch leaves the canvas`); continue; }
      const w = n.w ?? 0, h = n.h ?? 0;
      assert.ok(n.x - w / 2 >= 0 && n.x + w / 2 <= d.w && n.y - h / 2 >= 0 && n.y + h / 2 <= d.h, `${where}: ${n.kind} ${text(n)} outside the canvas`);
      if (n.kind === 'note') {
        const len = [...n.text].length * NOTE_CHAR, x0 = n.anchor === 'middle' ? n.x - len / 2 : n.anchor === 'end' ? n.x - len : n.x;
        assert.ok(x0 >= 0 && x0 + len <= d.w && n.y + 5 <= d.h, `${where}: note "${n.text}" leaves the canvas`);
      }
      // A block's text fits, or is squeezed a little (the renderer fits it to the block).
      if (n.kind === 'block') for (const l of n.lines) assert.ok(l.reduce((s, [t]) => s + [...t].length, 0) * 6 <= 1.45 * (n.w - 6), `${where}: "${text({ lines: [l] })}" is far too long for its block`);
    }
    for (const wr of d.wires) for (const [x, y] of wr.pts) assert.ok(x >= 0 && x <= d.w && y >= 0 && y <= d.h, `${where}: a wire leaves the canvas`);
  }
  const pid = (params) => describeVariant(normalizeVariant({ type: 'pid', params: { Kp: 30, Ki: 80, Kd: 1, umin: -12, umax: 12, ...params } }), { inputs: ['r', 'angle'], Ts: 0.01 });
  const find = (d, re) => d.nodes.find((n) => re.test(text(n)));
  // The values on the blocks; a path whose gain is 0 is faint.
  let d = pid({});
  assert.ok(find(d, /^Kp 30$/) && find(d, /Ki 80/) && find(d, /^Kd 1 \/ Tf 0\.01 s$/) && !find(d, /^Kp 30$/).faint);
  assert.ok(find(d, /^FF 0$/).faint, 'no feedforward: faint');
  assert.ok(find(d, /^Tr 0$/).faint, 'no prefilter: faint');
  assert.equal(find(d, /^±12$/).kind, 'note');
  d = pid({ Kv: 1.7, Kd: 0 });
  assert.ok(!find(d, /^FF Kv 1\.7$/).faint && find(d, /^Kd 0/).faint);
  // The anti-windup as it is set: clamping (a dashed line to the integral), back-calculation (1/Tt), off (a warning).
  assert.ok(pid({}).wires.some((w) => w.dashed) && find(pid({}), /clamping/));
  d = pid({ aw: 'back' });
  assert.ok(find(d, /^1\/Tt 0\.112 s$/), 'Tt = √(Ti·Td) = √(0.375 · 0.0333)');
  assert.ok(find(pid({ aw: 'back', Tt: 0.2 }), /^1\/Tt 0\.2 s$/));
  d = pid({ aw: 'off' });
  assert.equal(find(d, /no anti-windup/).cls, 'warn');
  assert.ok(!d.wires.some((w) => w.dashed));
  // State feedback: a row per gain, named by what feeds it; a gain at 0 is faint.
  d = describeVariant(normalizeVariant({ type: 'stateFeedback', params: { K: [2, 0, 3], kr: 2 } }), { inputs: ['r', 'x', 'theta', 'v'] });
  assert.ok(find(d, /^K1 2$/) && find(d, /^K2 0$/).faint && find(d, /^theta$/).faint && !find(d, /^x$/).faint);
  // The swing-up's switch and its condition; the scheduled PI's table.
  d = describeVariant(normalizeVariant({ type: 'swingUp', params: { thetaS: 0.3 } }), { inputs: ['r', 'x', 'θ', 'v', 'ω'] });
  assert.ok(d.nodes.some((n) => n.kind === 'switch') && find(d, /\|θ\| < 0\.3 rad, pump above 0\.6/));
  d = describeVariant(normalizeVariant({ type: 'gainScheduled', params: { at: [0.1, 1], Kp: [1, 3], Ki: [2, 2] } }), { inputs: ['r', 'h'] });
  assert.ok(find(d, /Kp\(y\) 1…3/) && find(d, /Ki\(y\) 2$/) && find(d, /^table/));
});
