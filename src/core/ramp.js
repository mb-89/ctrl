// Live (HIL) mode: the ramp-in before every loop (design/output/hil.md, "Full
// scale and the ramp-in"). In Live the references are not played from t = 0
// at once: first every reference moves from its present value to its
// waveform's first value at no more than `rate` of its full scale per second
// (10 % by default), and only when all have arrived does the loop's time
// start. The same at each repetition of the input's period, when the waveform
// does not end where it starts. So a waveform never makes a hard jump between
// loops, and a run never starts with a jump from where the plant is. A loop
// that follows on carries on in the waveform's own run time, as the page's
// simulation plays it: its second period is the waveform's second period (an
// eased Sine eases in the first only), and it follows on where the period's
// end joins up with the next period's start. After a ramp the waveform
// starts again from its first period.
//
// No DOM, no clock of its own: the caller gives the plant's time t (seconds)
// at each cycle. One object per run.
//
//   refs    [{ name, fn: τ -> value (periodic, as core/signals.js
//           referenceFn: τ the time since the waveform started, fn(k·L) the
//           last value of a period, fn.after(k·L) the next period's first),
//           fs: full-scale width (hi − lo) or null }]
//   period  L, the loop's length: the input's (longest) period
//   rate    fraction of full scale per second (0.1 is 10 %/s)
//
//   start(t, present)  the run's first cycle; present: { name: value } where
//                      the present value is known (a reference not listed
//                      starts at its first value: no ramp)
//   advance(t)         each cycle (t not decreasing): decides the phase
//   value(name, s)     a reference's value at time s in the cycle just
//                      advanced to (between cycles too, for blocks that
//                      integrate on the page)
//   state()            { phase: 'ramp' | 'loop', first (the run's first ramp,
//                      before the loop's time starts), runT (time since the
//                      first loop began, null before), tau (loop time, null in
//                      a ramp), left (seconds left of a ramp), loop (count),
//                      to (the values a ramp goes to) }

// A full scale for a reference without one: the waveform's own span over a
// period, or its first value's size, or 1 (in its unit).
export function fallbackScale(fn, L) {
  let lo = Infinity, hi = -Infinity;
  const n = 256, span = Number.isFinite(L) && L > 0 ? L : 1;
  for (let i = 0; i <= n; i++) { const v = fn((i / n) * span); if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
  const w = hi - lo;
  return w > 0 ? w : Math.max(Math.abs(fn(0)) || 0, 1);
}

export function createRampIn({ refs, period, rate = 0.1 }) {
  const L = Number.isFinite(period) && period > 0 ? period : Infinity;
  const list = refs.map((r) => {
    const fs = Number.isFinite(r.fs) && r.fs > 0 ? r.fs : fallbackScale(r.fn, L);
    return { name: r.name, fn: r.fn, fs, R: Math.max(1e-12, rate * fs), from: 0, to: 0, v: 0 };
  });
  const byName = Object.fromEntries(list.map((r) => [r.name, r]));
  // seq: the loops that followed on since the waveform last started (after
  // a ramp); a loop plays the waveform at seq·L + its own time.
  let phase = 'ramp', first = true, tR = 0, loopStart = 0, loop0 = null, loop = 0, seq = 0, tLast = null;

  // How far a ramp has got at time s: each reference at its own rate, held
  // once it has arrived.
  const along = (r, s) => {
    const d = r.to - r.from, go = r.R * Math.max(0, s - tR);
    return Math.abs(d) <= go ? r.to : r.from + Math.sign(d) * go;
  };
  const arrived = (s) => list.every((r) => along(r, s) === r.to);
  // Two values are the same if they differ by less than a billionth of full scale.
  const same = (a, b, r) => Math.abs(a - b) <= 1e-9 * r.fs;
  // Does the waveform join up where the loop ends (at τ of its own time)? Its
  // last value there against the one right after (a function without
  // .after is taken as continuous).
  const joins = (r, tau) => same(r.fn(tau), r.fn.after ? r.fn.after(tau) : r.fn(tau), r);
  function beginRamp(s, fromValues) {
    phase = 'ramp'; tR = s;
    for (const r of list) { r.from = fromValues(r); r.to = r.fn(0); }
  }
  function beginLoop(s) {
    phase = 'loop'; loopStart = s; seq = 0;
    if (loop0 === null) loop0 = s; else loop++;
    first = false;
  }

  const self = {
    start(t, present = {}) {
      first = true; loop0 = null; loop = 0; tLast = null;
      beginRamp(t, (r) => (Number.isFinite(present[r.name]) ? present[r.name] : r.fn(0)));
      self.advance(t);
    },
    advance(t) {
      if (phase === 'ramp') {
        if (arrived(t)) beginLoop(t);
      } else if (t - loopStart > L * (1 + 1e-12) + 1e-9) {
        // A loop has ended, at (seq + 1)·L of the waveform's time. Where
        // every reference joins up there (its period's last value is the next
        // period's first) the next loop follows on, the waveform's time
        // running on; else a ramp goes from where each reference is to its
        // first value, and the waveform starts again.
        if (list.every((r) => joins(r, (seq + 1) * L))) {
          while (t - loopStart > L * (1 + 1e-12) + 1e-9) { loopStart += L; loop++; seq++; }
        } else {
          beginRamp(tLast ?? t, (r) => r.v);
          if (arrived(t)) beginLoop(t);
        }
      }
      for (const r of list) r.v = self.value(r.name, t);
      tLast = t;
    },
    value(name, s) {
      const r = byName[name];
      if (!r) return NaN;
      if (phase === 'ramp') return along(r, s);
      return r.fn((seq ? seq * L : 0) + Math.max(0, s - loopStart));
    },
    values: () => Object.fromEntries(list.map((r) => [r.name, r.v])),
    state() {
      const left = phase === 'ramp' ? Math.max(0, ...list.map((r) => Math.abs(r.to - r.v) / r.R)) : 0;
      return {
        phase, first: phase === 'ramp' && first,
        runT: loop0 === null || tLast === null ? null : tLast - loop0,
        tau: phase === 'loop' && tLast !== null ? tLast - loopStart : null,
        left, loop,
        to: phase === 'ramp' ? Object.fromEntries(list.map((r) => [r.name, r.to])) : null,
      };
    },
    // The reference's full scale and rate (for the status line and tests).
    scale: (name) => (byName[name] ? { fs: byName[name].fs, rate: byName[name].R } : null),
  };
  return self;
}
