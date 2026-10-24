// Time control: how fast simulated time runs against the wall clock.
//   speed      a factor: 1 is real time, 10 ten times faster, 0.1 slower;
//              Infinity is "as fast as possible" (written -1 in a project file,
//              as the person put it, design/output/instrument.md#speed).
//   paceOf     the speed the sweep really runs at: the setting, but never
//              faster than the page simulates the screen (∞ is that speed).
//   sweepClock one frame of the display's sweep: a pure function of the scan
//              line, the window, the pace and the wall time since the last
//              frame.
//   meter      the achieved speed: simulated seconds per wall-clock second over
//              a moving window, measured from what really ran.
// No DOM; the page (ui/speed.js, ui/display.js, ui/autotune.js) and the tests
// use it.

export const SPEED_PRESETS = [0.1, 0.5, 1, 2, 5, 10, Infinity];
export const AS_FAST = Infinity;

// A speed from what was typed or stored: a positive number ("5", "5x", "0.1×",
// "2,5"), or as fast as possible ("inf", "∞", "max", -1). Anything else
// (0, other negatives, words, a number too large to hold such as 1e400) is
// null.
export function parseSpeed(v) {
  if (typeof v === 'number') {
    if (v === -1 || v === Infinity) return AS_FAST;
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  if (typeof v !== 'string') return null;
  const word = v.trim().toLowerCase();
  if (['inf', 'infinite', 'infinity', '∞', 'max', 'as fast as possible'].includes(word)) return AS_FAST;
  const s = word.replace(/−/g, '-').replace(/,/g, '.').replace(/\s*[x×]$/, '').trim();
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? parseSpeed(n) : null;
}

// The next preset above (dir > 0) or below a speed, for the arrow keys.
export function stepPreset(s, dir) {
  if (dir > 0) return SPEED_PRESETS.find((p) => p > s) ?? AS_FAST;
  return [...SPEED_PRESETS].reverse().find((p) => p < s) ?? SPEED_PRESETS[0];
}

// How a speed is stored in a project's ui: a positive number, or -1.
export const speedToJson = (s) => (s === AS_FAST ? -1 : s);

// The factor as the control shows it, to six digits: "1×", "0.1×", "2.5×",
// "123456×", "∞".
export function formatSpeed(s) {
  if (s === AS_FAST) return '∞';
  return `${Number(s.toPrecision(6))}×`;
}

// The achieved speed as the readout shows it: two digits ("9.8×", "12×",
// "0.10×"), whole numbers from 100 on; a live plant's clock ratio to three
// ("1.00× live"); "–" when nothing runs.
export function formatAchieved(x, { live = false } = {}) {
  if (!Number.isFinite(x)) return live ? '– live' : '–';
  if (live) return `${x.toFixed(2)}× live`;
  return `${x >= 99.5 ? String(Math.round(x)) : x.toPrecision(2)}×`;
}

// A frame counts at most this much wall time, so a hidden tab or a stall does
// not throw the sweep forward.
export const MAX_FRAME = 0.25;

// The pace of the sweep: the speed set, but never faster than the page
// simulates the screen. simRate is that, measured: the screen's simulated
// seconds over the wall time its simulation took (Infinity or null when not
// known). As fast as possible runs at it; so does any faster setting, and the
// readout shows it (design/output/instrument.md#speed).
export function paceOf(speed, simRate) {
  const cap = Number.isFinite(simRate) && simRate > 0 ? simRate : AS_FAST;
  const s = speed === AS_FAST || (Number.isFinite(speed) && speed > 0) ? speed : 1;
  return Math.min(s, cap);
}

// One frame of the sweep over the window [w0, w1].
//   scan    where the scan line was; at w1 (a sweep just ended) or outside
//           the window (it moved), a new sweep starts at w0
//   pace    simulated seconds per wall second (paceOf); Infinity, with no
//           simulation speed to pace it, completes the sweep in this frame
//   dt      wall seconds since the last frame (counted up to MAX_FRAME)
//   single  a Single: the sweep that ends here is the last one
// Returns { scan, advanced, ended }: the new scan line, the simulated seconds
// swept in this frame (what the achieved speed counts) and whether a sweep
// ended. A finite pace keeps time across sweeps: what is left of a frame when
// a sweep ends goes on into the next, round the screen as often as it takes
// (at 1× a 10 ms screen ends a sweep or two in every frame), and all of it
// counts. A Single stops at w1.
export function sweepClock(scan, w0, w1, pace, dt, single = false) {
  const W = w1 - w0;
  if (!(W > 0)) return { scan: w0, advanced: 0, ended: true };  // nothing to sweep (a window before t = 0): a Single ends at once
  const from = scan >= w0 && scan < w1 ? scan : w0;
  const wall = Math.min(MAX_FRAME, Math.max(0, Number.isFinite(dt) ? dt : 0));
  const want = pace === AS_FAST ? Infinity : Math.max(0, Number.isFinite(pace) ? pace : 1) * wall;
  if (from + want < w1) return { scan: from + want, advanced: want, ended: false };
  if (single || want === Infinity) return { scan: w1, advanced: w1 - from, ended: true };
  return { scan: w0 + ((from + want - w0) % W), advanced: want, ended: true };
}

// The achieved speed: samples (wall time t in seconds, simulated seconds run
// since the sample before), over a moving window of `span` seconds. The rate
// is what ran between the window's first and last samples over the wall time
// between them, so whatever happened in between counts: simulation, drawing,
// a pause between two runs. A gap longer than the window starts afresh (the
// scope was stopped); with no sample for `span` seconds the rate is null.
export function createSpeedMeter(span = 1) {
  let q = [];  // [t, simulated seconds since the sample before]
  return {
    add(t, sim) {
      if (!Number.isFinite(t)) return;
      if (q.length) {
        const last = q[q.length - 1][0];
        if (t - last > span) q = [];
        else if (t < last) t = last;  // a frame's time stamp may lie just before a task's
      }
      q.push([t, Number.isFinite(sim) && sim > 0 ? sim : 0]);
      // The first sample only marks where the window starts.
      while (q.length > 2 && q[1][0] <= t - span) q.shift();
    },
    rate(now = q.length ? q[q.length - 1][0] : 0) {
      if (q.length < 2 || now - q[q.length - 1][0] > span) return null;
      const wall = q[q.length - 1][0] - q[0][0];
      if (!(wall > 0.05)) return null;
      let sim = 0;
      for (let i = 1; i < q.length; i++) sim += q[i][1];
      return sim / wall;
    },
    reset() { q = []; },
  };
}
