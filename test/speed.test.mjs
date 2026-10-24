// Time control (design/output/instrument.md#speed): the speed factor as typed
// and stored, the sweep clock, and the achieved-speed meter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpeed, speedToJson, formatSpeed, formatAchieved, stepPreset, sweepClock, createSpeedMeter, SPEED_PRESETS, AS_FAST, MAX_FRAME } from '../src/core/speed.js';
import { normalizeProject, normalizeUi } from '../src/core/project.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('a speed is any positive factor, or as fast as possible (-1, inf, ∞)', () => {
  for (const [v, want] of [[1, 1], [10, 10], [0.1, 0.1], [2.5, 2.5], [1e-3, 1e-3], [1000, 1000], ['5', 5], ['5x', 5], ['0.1×', 0.1], [' 20 x ', 20], ['2,5', 2.5], ['1e2', 100], ['.5', 0.5]]) {
    assert.equal(parseSpeed(v), want, JSON.stringify(v));
  }
  for (const v of [-1, '-1', '−1', '-1x', 'inf', 'INF', 'Infinity', '∞', 'max', Infinity]) assert.equal(parseSpeed(v), AS_FAST, JSON.stringify(v));
  for (const v of [0, '0', -2, '-0.5', NaN, 'fastest', '', 'x', '5 s', null, undefined, {}, [5]]) assert.equal(parseSpeed(v), null, JSON.stringify(v));
  assert.equal(speedToJson(AS_FAST), -1, 'as fast as possible is stored as -1');
  assert.equal(speedToJson(5), 5);
});

test('the project keeps the speed in ui, normalised like the other ui fields', () => {
  assert.deepEqual(normalizeUi({ speed: 10 }), { speed: 10 });
  assert.deepEqual(normalizeUi({ speed: -1 }), { speed: -1 });
  assert.deepEqual(normalizeUi({ speed: 'inf' }), { speed: -1 }, 'a typed "inf" is stored as -1');
  assert.deepEqual(normalizeUi({ speed: '0.1x', tab: 'tune' }), { tab: 'tune', speed: 0.1 });
  assert.equal(normalizeUi({ speed: 0 }), null, 'an invalid speed is dropped');
  assert.equal(normalizeUi({ speed: 'fast-ish' }), null);
  assert.deepEqual(normalizeProject({ ui: { run: 'stop', speed: 5 } }).ui, { run: 'stop', speed: 5 });
  assert.equal(normalizeProject({}).ui, undefined, 'no ui: the page keeps its speed (1× when it opens)');
  // A saved file carries it through JSON: -1, never Infinity (which JSON cannot hold).
  assert.equal(JSON.parse(JSON.stringify(normalizeProject({ ui: { speed: Infinity } }))).ui.speed, -1);
});

test('the control shows the factor; the readout shows what was achieved', () => {
  assert.equal(formatSpeed(1), '1×');
  assert.equal(formatSpeed(0.1), '0.1×');
  assert.equal(formatSpeed(2.5), '2.5×');
  assert.equal(formatSpeed(1 / 3), '0.3333×');
  assert.equal(formatSpeed(AS_FAST), '∞');
  assert.equal(formatAchieved(9.8123), '9.8×');
  assert.equal(formatAchieved(12.3), '12×');
  assert.equal(formatAchieved(0.1), '0.10×');
  assert.equal(formatAchieved(1), '1.0×');
  assert.equal(formatAchieved(297.6), '298×');
  assert.equal(formatAchieved(1.0012, { live: true }), '1.00× live');
  assert.equal(formatAchieved(null), '–');
  assert.equal(formatAchieved(null, { live: true }), '– live');
  assert.deepEqual(SPEED_PRESETS, [0.1, 0.5, 1, 2, 5, 10, AS_FAST]);
  assert.equal(stepPreset(1, 1), 2);
  assert.equal(stepPreset(1, -1), 0.5);
  assert.equal(stepPreset(3, 1), 5, 'a typed value steps to the next preset');
  assert.equal(stepPreset(3, -1), 2);
  assert.equal(stepPreset(10, 1), AS_FAST);
  assert.equal(stepPreset(AS_FAST, 1), AS_FAST, 'the top stays');
  assert.equal(stepPreset(AS_FAST, -1), 10);
  assert.equal(stepPreset(0.1, -1), 0.1, 'the bottom stays');
});

// Frames of the clock at a fixed frame time; returns the scan lines, the
// simulated time swept and the sweeps that ended.
function runClock({ w0 = 0, w1 = 5, speed, fps = 60, seconds, single = false, scan = w0 }) {
  const dt = 1 / fps, frames = Math.round(seconds * fps);
  let swept = 0, ended = 0, i = 0;
  const scans = [];
  for (; i < frames; i++) {
    const c = sweepClock(scan, w0, w1, speed, i ? dt : 0, single);
    scan = c.scan; swept += c.advanced; scans.push(scan);
    if (c.ended) { ended++; if (single) break; }
  }
  return { scan, swept, ended, scans, frames: Math.min(i + 1, frames) };
}

test('the sweep clock runs simulated time at speed × wall time', () => {
  // 1×: a 5 s window takes 5 s.
  const one = runClock({ speed: 1, seconds: 4.9 });
  close(one.scan, 4.9 - 1 / 60, 1e-9, '1×: the scan line after 4.9 s (the first frame starts the clock)');
  assert.equal(one.ended, 0);
  close(runClock({ speed: 1, seconds: 10 }).swept, 10 - 1 / 60, 1e-9, '1×: 10 s swept in 10 s');
  // 10×: 2 s of wall time sweep 20 s, four windows, carried across their ends.
  const ten = runClock({ speed: 10, seconds: 2 });
  close(ten.swept, 20 - 10 / 60, 1e-9, '10×: what was swept');
  assert.equal(ten.ended, 3, '10×: three sweeps ended in 2 s');
  // 0.1×: 10 s of wall time sweep 1 s.
  close(runClock({ speed: 0.1, seconds: 10 }).swept, 1 - 0.1 / 60, 1e-9, '0.1×');
  // A frame counts at most MAX_FRAME of wall time (a hidden tab, a stall).
  assert.equal(sweepClock(1, 0, 5, 1, 30).advanced, MAX_FRAME);
  assert.equal(sweepClock(1, 0, 5, 2, -1).advanced, 0, 'time never runs backwards');
});

test('as fast as possible completes a sweep each frame and starts the next', () => {
  const inf = runClock({ speed: AS_FAST, seconds: 1 });
  assert.equal(inf.ended, 60, 'one sweep per frame');
  assert.ok(inf.scans.every((x) => x === 5), 'every frame shows the whole run: the scan line at the right edge');
  close(inf.swept, 60 * 5, 1e-9, 'a screen per frame: 300 s at 60 frames a second');
  // From the middle of a sweep it finishes that one first.
  assert.deepEqual(sweepClock(2, 0, 5, AS_FAST, 0), { scan: 5, advanced: 3, ended: true });
  // No finite speed sweeps more than as fast as possible: a frame ends at most one sweep.
  for (const speed of [400, 1000, 1e6]) {
    const r = runClock({ speed, seconds: 1 });
    assert.ok(r.swept <= inf.swept + 1e-9, `${speed}× sweeps no more than ∞ (${r.swept} s)`);
    assert.ok(r.ended <= 60, `${speed}×: at most one sweep per frame`);
  }
  // Just under a screen per frame: a little short of ∞, never above.
  const near = runClock({ speed: 280, seconds: 1 });
  assert.ok(near.swept <= inf.swept && near.swept > 0.9 * inf.swept, `280×: ${near.swept} s`);
});

test('Single sweeps once and stops at the right edge, at every speed', () => {
  for (const speed of [0.5, 1, 10, 1000, AS_FAST]) {
    const r = runClock({ speed, seconds: 30, single: true });
    assert.equal(r.ended, 1, `${speed}×: one sweep`);
    assert.equal(r.scan, 5, `${speed}×: it stops at the right edge`);
    close(r.swept, 5, 1e-9, `${speed}×: exactly one screen swept`);
  }
  const atOnce = runClock({ speed: AS_FAST, seconds: 1, single: true });
  assert.equal(atOnce.frames, 1, 'as fast as possible: a Single takes one frame');
  const slow = runClock({ speed: 1, seconds: 30, single: true });
  close(slow.frames / 60, 5 + 1 / 60, 1.5 / 60, '1×: a Single of a 5 s screen takes 5 s');
});

test('the clock follows the window: a new window starts its sweep at its left edge', () => {
  assert.deepEqual(sweepClock(7, 0, 5, 1, 0.1), { scan: 0.1, advanced: 0.1, ended: false }, 'outside the window: start over');
  assert.deepEqual(sweepClock(1, 2, 4, 1, 0.1), { scan: 2.1, advanced: 0.1, ended: false });
  assert.deepEqual(sweepClock(0, 0, 0, 1, 0.1), { scan: 0, advanced: 0, ended: true }, 'an empty window (all of it before t = 0) sweeps nothing, and a Single on it ends at once');
  // At position w0 > 0 the sweep covers w0 … w1.
  const r = runClock({ w0: 2, w1: 3, speed: 1, seconds: 3 });
  assert.ok(r.scans.every((x) => x >= 2 && x <= 3));
  assert.equal(r.ended, 2);
});

test('the achieved speed: what ran over the wall time it took, in a moving window', () => {
  const m = createSpeedMeter(1);
  assert.equal(m.rate(0), null, 'nothing ran yet');
  // 10× at 60 frames a second for 3 s.
  for (let i = 0; i <= 180; i++) m.add(i / 60, i ? 10 / 60 : 0);
  close(m.rate(3), 10, 1e-9, 'a steady 10×');
  // The clock slows to 2×: within about a second the reading follows.
  for (let i = 181; i <= 300; i++) m.add(i / 60, 2 / 60);
  close(m.rate(5), 2, 1e-9, 'the window forgets what is older than a second');
  // A pause between two runs (Auto-tune computing the next one) counts.
  const g = createSpeedMeter(1);
  g.add(0, 0); g.add(0.4, 4); g.add(0.6, 0); g.add(1, 4);
  close(g.rate(1), 8, 1e-9, '8 s ran in 1 s, 0.2 s of it a pause');
  // Nothing for longer than the window: stopped.
  assert.equal(g.rate(2.5), null);
  // A gap longer than the window starts afresh (the scope was stopped).
  g.add(10, 0); g.add(10.5, 5);
  close(g.rate(10.5), 10, 1e-9, 'after a stop the reading starts afresh');
  // Time stamps from two sources (a frame's, a task's) may cross a little.
  const h = createSpeedMeter(1);
  h.add(0, 0); h.add(0.5, 1); h.add(0.499, 1); h.add(1, 1);
  close(h.rate(1), 3, 1e-9, 'a time stamp just before the last is taken as the last');
  m.reset();
  assert.equal(m.rate(5), null);
});

test('the clock and the meter together: the readout of a 60 Hz page', () => {
  // Frames of 1/60 s, the meter fed as the display feeds it.
  const reading = (speed, fps = 60, W = 5) => {
    const m = createSpeedMeter(1);
    let scan = 0;
    for (let i = 0; i < 4 * fps; i++) {
      const c = sweepClock(scan, 0, W, speed, i ? 1 / fps : 0);
      scan = c.scan;
      m.add(i / fps, c.advanced);
    }
    return m.rate((4 * fps - 1) / fps);
  };
  close(reading(1), 1, 1e-9, '1×');
  close(reading(10), 10, 1e-9, '10×');
  close(reading(0.1), 0.1, 1e-9, '0.1×');
  close(reading(AS_FAST), 300, 1e-6, '∞ on a 5 s screen at 60 frames a second caps at 300×');
  close(reading(AS_FAST, 20), 100, 1e-6, '… and at 100× when drawing takes 50 ms a frame');
  close(reading(AS_FAST, 60, 1), 60, 1e-6, '… and at 60× on a 1 s screen');
  // Slow frames (a heavy page): 1× falls behind once a frame takes longer than MAX_FRAME.
  close(reading(1, 2), MAX_FRAME / 0.5, 1e-9, '2 frames a second: 1× reads 0.5×');
});
