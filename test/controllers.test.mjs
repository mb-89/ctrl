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
  // It acts on rf. A first-order prefilter (Tr) turns a step of r into a jump
  // of the velocity term to Kv·Δr·(1 − a)/Ts ≈ Kv·Δr/Tr (not Kv·Δr/Ts), which
  // then falls by a = e^(−Ts/Tr) a sample. It is smaller, not smooth: the
  // acceleration term still spikes, Ka·Δr·(1 − a)/Ts² and then
  // −Ka·Δr·(1 − a)²/Ts². Only a reference that is itself smooth (a sine, a
  // ramp) gives smooth Kv and Ka terms.
  const a = Math.exp(-Ts / 0.1);
  const pre = law({ Kp: 0, Kv: 1, Tr: 0.1, ...OPEN }, Ts);
  pre.step([0, 0]);
  const v1 = pre.step([2, 0]), v2 = pre.step([2, 0]);
  assert.ok(Math.abs(v1 - 2 * (1 - a) / Ts) < 1e-9 && Math.abs(v2 - a * v1) < 1e-9, `${v1} ${v2}`);
  assert.ok(v1 > 0.9 * 2 / 0.1 && v1 < 2 / 0.1, 'about Kv·Δr/Tr');
  const acc = law({ Kp: 0, Ka: 0.03, Tr: 0.1, ...OPEN }, Ts);
  acc.step([0, 0]);
  const a1 = acc.step([2, 0]), a2 = acc.step([2, 0]);
  assert.ok(Math.abs(a1 - 0.03 * 2 * (1 - a) / Ts ** 2) < 1e-9 && a1 > 50, `a spike of ${a1} V`);
  assert.ok(Math.abs(a2 + 0.03 * 2 * (1 - a) ** 2 / Ts ** 2) < 1e-9, `${a2}`);
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

test('back-calculation leaves the feedforward\'s own excess beyond a limit alone: no integral offset after a kick', () => {
  // The measurement follows rf exactly, so e = 0 at every sample: whatever u
  // is left with once r has settled is the integral. The velocity
  // feedforward's kick as r steps saturates u for a few samples; tracking it
  // left I at −0.54 V (Tt 0.39 s) or −3.4 V (Tt 0.05 s), and the motor
  // stalled 5 % short of r.
  const Ts = 0.01, a = Math.exp(-Ts / 0.1);
  for (const extra of [{}, { Tt: 0.05 }, { aw: 'clamp' }]) {
    const l = law({ Kp: 20, Ki: 10, Kd: 1.5, Tf: 0.01, Tr: 0.1, Kv: 2.2, umin: -12, umax: 12, aw: 'back', ...extra }, Ts);
    let rf = 0, u = 0, sat = 0;
    for (let k = 0; k < 200; k++) {
      const r = k < 10 ? 0 : 2;
      rf = k ? a * rf + (1 - a) * r : r;
      u = l.step([r, rf]);
      if (Math.abs(u) >= 12) sat++;
    }
    assert.ok(sat > 0 && Math.abs(u) < 1e-6, `${JSON.stringify(extra)}: ${sat} samples at the limit, u after ${u}`);
  }
  // What the feedback part asks beyond the limit is still tracked: the
  // integral of a PI held at its limit settles, as before.
  const pi = law({ Kp: 1, Ki: 2, Kff: 0.5, aw: 'back', Tt: 0.2, umin: -1, umax: 1 }, Ts);
  let u = 0;
  for (let k = 0; k < 2000; k++) u = pi.step([1, 0]);
  assert.equal(u, 1);
  // v settles where Ki·Ts·e and the tracking cancel, v = umax + Ki·Ts·e / (1 − e^(−Ts/Tt))
  // (about umax + Ki·Tt·e = 1.4), so I = v − Kp·e − Kff·r; with r = y = 0 that is u.
  const I = 1 + (2 * Ts) / (1 - Math.exp(-Ts / 0.2)) - 1 - 0.5;
  assert.ok(Math.abs(pi.step([0, 0]) - I) < 1e-9, 'I settled where back-calculation puts it');
});

test('a feedforward gain changed while running (Live) is bumpless with an integral; the scheduled PI reads its parameters like the PID', () => {
  const Ts = 0.01, sine = (k) => Math.sin(2 * Math.PI * 0.2 * k * Ts);
  const p = normalizeVariant({ type: 'pid', params: { Kp: 30, Ki: 80, Kd: 1, Tf: 0.02, umin: -12, umax: 12 } }).params;
  const l = CONTROLLERS.pid.make(p, Ts);
  for (let k = 0; k < 100; k++) l.step([sine(k), sine(k) - 0.01]);
  // The same sample with and without the edit: the integral takes the step.
  const twin = CONTROLLERS.pid.make({ ...p }, Ts);
  for (let k = 0; k < 100; k++) twin.step([sine(k), sine(k) - 0.01]);
  p.Kv = 1.7;
  const kept = l.step([sine(100), sine(100) - 0.01]), before = twin.step([sine(100), sine(100) - 0.01]);
  assert.ok(Math.abs(kept - before) < 1e-12, `u ${kept} where the old gains gave ${before}`);
  // Without an integral nothing could carry the step: u jumps by Kv·dr/dt.
  const q = normalizeVariant({ type: 'pid', params: { Kp: 30, Kd: 1 } }).params, pd = CONTROLLERS.pid.make(q, Ts);
  for (let k = 0; k < 100; k++) pd.step([sine(k), sine(k)]);
  const u0 = pd.step([sine(100), sine(100)]);
  q.Kv = 1.7;
  const u1 = pd.step([sine(101), sine(101)]);
  assert.ok(Math.abs(u1 - u0 - 1.7 * (sine(101) - sine(100)) / Ts) < 0.05, `${u0} → ${u1}`);
  // A flat schedule is a PI: edited the same way in place, mid-run, both agree.
  const gp = normalizeVariant({ type: 'pid', params: { Kp: 2, Ki: 1, Kd: 0, Tf: 0, umin: -1, umax: 1 } }).params;
  const gs = normalizeVariant({ type: 'gainScheduled', params: { at: [0, 1], Kp: [2, 2], Ki: [1, 1], umin: -1, umax: 1 } }).params;
  const A = CONTROLLERS.pid.make(gp, Ts), B = CONTROLLERS.gainScheduled.make(gs, Ts);
  const edits = { 30: { Kff: 2 }, 60: { umax: 5 }, 90: { aw: 'back', Tt: 0.05 }, 120: { Kv: 0.3, Ka: 0.01 }, 150: { aw: 'off' }, 180: { umin: -0.2 } };
  for (let k = 0; k < 220; k++) {
    if (edits[k]) { Object.assign(gp, edits[k]); Object.assign(gs, edits[k]); }
    const x = [Math.sin(k / 9), 0.3 * Math.cos(k / 13)];
    assert.ok(Math.abs(A.step(x) - B.step(x)) < 1e-12, `sample ${k}`);
  }
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

// Where a diagram draws something over one of its notes: a block, another
// note, a sign or port, or a wire passing through it (boxes at the font's
// size: notes and signs 10 px, about NOTE_CHAR a character).
function collisions(d, NOTE_CHAR) {
  const box = (x0, y0, x1, y1, what) => ({ x0, y0, x1, y1, what });
  const textBox = (x, y, chars, cw, anchor, h, what) => {
    const len = chars * cw, x0 = anchor === 'middle' ? x - len / 2 : anchor === 'end' ? x - len : x;
    return box(x0, y - h / 2, x0 + len, y + h / 2, what);
  };
  const notes = [], solid = [];
  for (const n of d.nodes) {
    if (n.kind === 'note') notes.push(textBox(n.x, n.y, [...n.text].length, NOTE_CHAR, n.anchor ?? 'start', 10, `note "${n.text}"`));
    else if (n.kind === 'port') solid.push(textBox(n.x, n.y, [...n.text].length, 6.6, n.anchor ?? 'start', 11, `port ${n.text}`));
    else if (n.kind === 'sum') {
      solid.push(box(n.x - n.r, n.y - n.r, n.x + n.r, n.y + n.r, 'a sum'));
      const at = { w: [n.x - n.r - 2, n.y - 5, 'end'], n: [n.x + 3, n.y - n.r - 3, 'start'], s: [n.x + 3, n.y + n.r + 5, 'start'] };
      for (const [k, sg] of Object.entries(n.signs ?? {})) if (sg) solid.push(textBox(at[k][0], at[k][1], 1, 6, at[k][2], 10, `the sign ${sg}`));
    } else if (n.kind === 'bar') {
      solid.push(box(n.x - n.w / 2, n.y - n.h / 2, n.x + n.w / 2, n.y + n.h / 2, 'the bar'));
      for (const [y, sg] of n.signs ?? []) if (sg) solid.push(textBox(n.x - n.w / 2 - 1, y - 5, 1, 6, 'end', 10, `the sign ${sg}`));
    } else if (n.w) solid.push(box(n.x - n.w / 2, n.y - n.h / 2, n.x + n.w / 2, n.y + n.h / 2, `${n.kind} ${(n.lines ?? []).map((l) => l.map(([t]) => t).join('')).join(' / ')}`));
  }
  const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  // A wire segment (horizontal or vertical) through a box.
  const cuts = (b, [x1, y1], [x2, y2]) => hit(b, box(Math.min(x1, x2) - 0.5, Math.min(y1, y2) - 0.5, Math.max(x1, x2) + 0.5, Math.max(y1, y2) + 0.5));
  const out = [];
  // A wire through the inside of a block (it may end on its edge).
  for (const n of d.nodes) {
    if (!['block', 'sat', 'relay'].includes(n.kind)) continue;
    const inner = box(n.x - n.w / 2 + 1.5, n.y - n.h / 2 + 1.5, n.x + n.w / 2 - 1.5, n.y + n.h / 2 - 1.5);
    if (d.wires.some((w) => w.pts.some((p, k) => k && cuts(inner, w.pts[k - 1], p)))) out.push(`a wire runs through ${n.kind} ${(n.lines ?? []).map((l) => l.map(([t]) => t).join('')).join(' / ')}`);
  }
  notes.forEach((a, i) => {
    for (const b of [...solid, ...notes.slice(i + 1)]) if (hit(a, b)) out.push(`${a.what} on ${b.what}`);
    for (const w of d.wires) for (let k = 1; k < w.pts.length; k++) if (cuts(a, w.pts[k - 1], w.pts[k])) { out.push(`${a.what} crossed by a wire`); break; }
  });
  return out;
}

test('the structure diagram: every type has its picture, inside its canvas, with the live values on it', async () => {
  const { describeVariant, DESCRIBED_TYPES, NOTE_CHAR } = await import('../src/core/structure.js');
  const { OBSERVERS } = await import('../src/core/observers.js');
  assert.deepEqual([...Object.keys(CONTROLLERS), ...Object.keys(OBSERVERS)].filter((t) => !DESCRIBED_TYPES.includes(t)), [], 'a type without its own picture');
  const text = (n) => (n.lines ?? []).map((l) => l.map(([t]) => t).join('')).join(' / ') + (n.text ?? '');
  // Every variant of every library system, and each type's defaults.
  const cases = [];
  for (const e of SYSTEM_LIBRARY) for (const b of e.plant.diagram.blocks) if (b.type === 'controller') for (const v of b.variants) {
    const inputs = ['r', ...Array.from({ length: b.params.inputs - 1 }, (_, i) => `y${i + 1}`)];
    cases.push({ v: normalizeVariant(v), inputs });
    // Each anti-windup mode, and a start output, on every variant that has them.
    // (A start output only where it is an input: a PI from the plant computes its u0.)
    if (CONTROLLERS[v.type].params.some((p) => p.key === 'aw')) for (const aw of ['back', 'off']) cases.push({ v: normalizeVariant({ ...v, params: { ...v.params, aw, ...(CONTROLLERS[v.type].computes?.includes('u0') ? {} : { u0: 1.5 }) } }), inputs });
  }
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
    // Nothing is drawn over a note: no block, no other note or sign, no wire.
    const clash = collisions(d, NOTE_CHAR);
    assert.deepEqual(clash, [], `${where}: ${clash.join('; ')}`);
  }
  const pid = (params) => describeVariant(normalizeVariant({ type: 'pid', params: { Kp: 30, Ki: 80, Kd: 1, umin: -12, umax: 12, ...params } }), { inputs: ['r', 'angle'], Ts: 0.01 });
  const find = (d, re) => d.nodes.find((n) => re.test(text(n)));
  // The values on the blocks; a path whose gain is 0 is faint.
  let d = pid({});
  assert.ok(find(d, /^Kp 30$/) && find(d, /Ki 80/) && find(d, /^d\/dt Kd 1 \/ Tf 10 ms$/) && !find(d, /^Kp 30$/).faint);
  assert.match(find(d, /d\/dt/).tip, /Kd·dy\/dt .*subtracted at the sum/, 'the sign is said once, at the sum');
  assert.ok(find(d, /^FF 0$/).faint, 'no feedforward: faint');
  assert.ok(find(d, /^Tr 0$/).faint, 'no prefilter: faint');
  assert.equal(find(d, /^±12$/).kind, 'note');
  d = pid({ Kv: 1.7, Kd: 0 });
  assert.ok(!find(d, /^FF Kv 1\.7$/).faint && find(d, /^d\/dt Kd 0/).faint);
  // The anti-windup as it is set: clamping (a dashed line to the integral), back-calculation (1/Tt), off (a warning).
  assert.ok(pid({}).wires.some((w) => w.dashed) && find(pid({}), /clamping/));
  d = pid({ aw: 'back' });
  assert.ok(find(d, /^1\/Tt$/) && find(d, /^back-calculation, Tt 0\.112 s$/), 'Tt = √(Ti·Td) = √(0.375 · 0.0333)');
  assert.ok(find(pid({ aw: 'back', Tt: 0.02 }), /, Tt 20 ms$/));
  // A start output is a line of the integrator's block, not a note over it.
  assert.ok(find(pid({ u0: 2.5 }), /^∫ Ki 80 \/ u0 2\.5$/));
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
  assert.ok(d.wires.some((w) => w.dotted) && d.wires.filter((w) => w.dashed).length === 1, 'the schedule\'s line is dotted, the anti-windup\'s dashed');
  // Back-calculation's Tt as the scheduled PI uses it: Ti/2 at each point,
  // here 0.25 and 0.75 s (a flat schedule Kp 2, Ki 1: 1 s, not the sample time).
  d = describeVariant(normalizeVariant({ type: 'gainScheduled', params: { at: [0.1, 1], Kp: [1, 3], Ki: [2, 2], aw: 'back' } }), { inputs: ['r', 'h'], Ts: 0.02 });
  assert.ok(find(d, /^back-calculation, Tt 0\.25…0\.75 s$/), d.nodes.map(text).join(' | '));
  d = describeVariant(normalizeVariant({ type: 'gainScheduled', params: { at: [0, 1], Kp: [2, 2], Ki: [1, 1], aw: 'back' } }), { inputs: ['r', 'h'], Ts: 0.02 });
  assert.ok(find(d, /^back-calculation, Tt 1 s$/));
  // Numbers: SI-prefixed units, µ below 0.001.
  const { fmt } = await import('../src/core/structure.js');
  assert.deepEqual([fmt(0.005), fmt(0.0001), fmt(-2.5e-7), fmt(12345)], ['0.005', '100µ', '−0.25µ', '12.3k']);
  // An observer's long note is cut to the canvas, the whole of it in the tooltip.
  const { OBSERVERS: OBS } = await import('../src/core/observers.js');
  // (The Kalman filter is designed: its model and L come from the plant, as values.)
  const big = normalizeVariant({ type: 'kalman', params: { Q: [1, 2, 3, 4], R: [0.0001, 0.0002] } }, 'variant', OBS);
  d = describeVariant(big, { inputs: ['u', 'y1', 'y2'], values: { A: new Array(16).fill(0.5), B: [1, 0, 0, 1], C: [1, 0, 0, 0, 0, 1, 0, 0], L: new Array(8).fill(0.1) } });
  assert.deepEqual(collisions(d, NOTE_CHAR), []);
  assert.ok(find(d, /^Q 1 2 3 4 {2}R 100µ 200µ$/), d.nodes.map(text).join(' | '));
});

test('the designed types draw as their Copy as numbers twin, with the numbers their design computed', async () => {
  const { describeVariant, fmt } = await import('../src/core/structure.js');
  const text = (n) => (n.lines ?? []).map((l) => l.map(([t]) => t).join('')).join(' / ') + (n.text ?? '');
  const all = (d) => d.nodes.map(text).join(' | ');
  let seen = 0;
  for (const [name, inputs] of [['Pendulum swing-up', ['r', 'x', 'θ', 'v', 'ω']], ['Conical tank', ['r', 'h']], ['Triple', ['r', 'x', 'θ1', 'θ2', 'θ3', 'v', 'ω1', 'ω2', 'ω3']]]) {
    const e = SYSTEM_LIBRARY.find((s) => s.name.startsWith(name));
    const p = normalizeProject(applySystem(DEFAULT_PROJECT, e, ['input', 'plant']));
    const ctrl = p.system.plant.diagram.blocks.find((b) => b.id === 'ctrl');
    for (let i = 0; i < ctrl.variants.length; i++) {
      const v = normalizeVariant(ctrl.variants[i]);
      if (!CONTROLLERS[v.type].designed) continue;
      ctrl.variant = i;
      const st = evaluateSystem(p).info.designs[0];
      // Before the design: '–' where its numbers go; after: the numbers.
      const before = describeVariant(v, { inputs, Ts: 0.01 }), after = describeVariant(v, { inputs, Ts: 0.01, values: st.values });
      assert.match(all(before), /–/, `${v.type}: ${all(before)}`);
      assert.match(all(before), /from the plant/);
      const has = (want) => assert.ok(all(after).includes(want), `${v.type}: "${want}" in ${all(after)}`);
      if (v.type === 'lqr') has(`K2 ${fmt(st.values.K[1])}`);
      if (v.type === 'scheduledPI') has(st.values.at.length > 1 ? `Kp(y) ${fmt(Math.min(...st.values.Kp))}…${fmt(Math.max(...st.values.Kp))}` : `Kp ${fmt(st.values.Kp[0])}`);
      if (v.type === 'swingUpLqr') has(`K ${st.values.K.map(fmt).join(' ')}`);
      if (v.type === 'trajectory') has('planned from the plant: F ');
      seen++;
    }
  }
  assert.ok(seen >= 6, `${seen} designed variants`);
});
