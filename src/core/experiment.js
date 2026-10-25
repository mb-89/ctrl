// Identify's experiment (design/output/identification.md §5): one causal
// state machine that, sample by sample, reads the Controller block's
// measurement y and returns u, easing in from the smallest pushes:
//
//   Listen     u held at u₀; the noise, the encoder's step, any drift
//   Nudge      growing open-loop doublets (pulses when u₀ sits at a limit),
//              each larger or longer only while the last stayed well inside
//              the room (§5.2)
//   first look a rest at u₀, then, still at rest, a small fit in work-unit
//              slices: the sign, the dead time, settles / ramps / rings,
//              K and τ or k′
//   Hold       a deliberately gentle PI (SIMC, slow τc, Ti = 4(τc + θ)) takes
//              over bumplessly and brings y to where the test reference starts
//   Ease in    the test reference again and again, each try asking for a
//              controller 30 % quicker, until a try rings, comes near the edge,
//              stops improving, or the time runs out (§5.4)
//   fit pause  the best controller holds y while the page fits and supplies the
//              Check's prediction (needs / supply)
//   Check      a test the model has not seen: the reference's steps halved
//
// The Shake (§5.6) comes later and is skipped (its chip shows –).
//
// The same code runs in simulation, in the live worker (the plan is data, not
// code) and in Node. It has no clock and no randomness: its time is the plant's
// sample count, and the fit it runs is sliced by LM iterations, never by time,
// so the same plan and the same y give the same u, bit for bit.
//
// The plant is the safety authority (it clamps u, has its watchdog and stops
// itself beyond its output ranges). This machine only eases in, backs off,
// and asks for the plant's `stop` when a test must end: state.stop.

import { STRUCTURES, fitStructureSteps } from './fit.js';

export const IDENTIFY_VERSION = 1;

// Every threshold of the experiment, named. Times in seconds of plant time,
// shares as fractions.
export const EXPERIMENT = {
  listen: {
    seconds: 3, samples: 100,  // at least this long, and at least this many samples
    floor: 1e-5,               // the smallest floor, as a share of the band's span: a noise-free simulation
    drift: 4,                  // a slope is drift when it is this many standard errors from 0 …
    outside: 3,                // y outside the band this many samples in a row ends Listen
  },
  nudge: {
    a0: 0.01,                  // the first push: this share of u's range
    T0: 2,                     // the first half-length, in samples
    budget: 0.4,               // the Nudge may use this share of the test's time
    safety: 1.5,               // a move is allowed when its predicted excursion × safety …
    room: 0.5,                 // … stays within this share of the smaller room (a pulse: of its side's)
    push: 0.5,                 // and a ≤ push × the distance from u₀ to the nearer limit
    backoff: 0.8,              // a rung that uses this share of the room on its side ends at once
    visible: 20,               // a response under visible × floor is not visible yet
    response: 5,               // nothing above response × floor in the whole Nudge: no response
    dead: 3,                   // doubling a push not yet visible predicts this growth, not 2
    enough: 0.2,               // a complete response above this share of the smaller room ends the Nudge
    Tmax: 20,                  // the longest half-length (s)
    plateau: 0.1,              // a plateau: the last quarter of the push changes y by less than this share
    slope: 0.25,               // a constant slope: successive quarter increments within this share
    grow: [1, 2],              // the growth exponent p from y(T)/y(T/2), clamped (a pulse's at most 1)
    runaway: 1.5,              // still growing through the rest, beyond this × the push's peak
    start: 5,                  // samples before a rung that give the level it starts from
    still: 0.05,               // at rest: y moves less than this share of the rung's peak over half a window
    restMax: 8, restMin: 1,    // a rung waits for rest at most restMax × its length, at least restMin s
    drift: 0.25,               // with drift, the Nudge lasts until the drift would use this share of the room
    read: 1,                   // … and the test is refused when that leaves less than this (s)
  },
  look: {
    rest: 1,                   // s at u₀ after the Nudge, before the fit
    perSample: 4,              // LM iterations per controller sample while it fits
    maxIter: 60,
    structures: ['lag', 'intLag', 'resonance'],
    rings: 0.5,                // a resonance below this ζ rings
    edge: 40,                  // a fit with a parameter beyond e^±edge ran off (LM's range is e^±46)
  },
  hold: {
    settles: 2,                // τc₀ = 2(τ + θ) when the plant settles,
    integrates: 3,             // 3(θ + τ) when it integrates
    Ti: 4,                     // Ti = 4(τc + θ) always (SIMC's robust branch)
    settle: 0.5,               // settled: inside the tolerance for this long
    slack: 2,                  // it may take 4(τc + θ) + slack before the Hold looks again (§5.3)
    sigmas: 3, bandShare: 0.01, steps: 2,   // the tolerance: max(3σ, 1 % of the band, 2q)
    away: 0.25,                // y moving away from r(0) by this share of the room on its side: the wrong way
  },
  ease: {
    quicker: 0.7,              // each try asks for τc × 0.7
    gMin: 0.3,                 // a try is accepted when g ≥ gMin and J improves
    better: 0.03,              // an improvement below this share does not count …
    stale: 2,                  // … and this many such tries in a row end the ladder
    tries: 12,
    thetaShare: 0.5,           // τc below θ/2 is not asked for
    settleMax: 4,              // a try's incumbent holds r(0) until settled (hold.settle), at most this (s)
    ring: 0.2,                 // g_ring = 1 − (third half-wave) / (ring × the step)
    guardG: -0.1,              // a try that left the band scores this
    staircase: 0.1,            // r moving less than this share of the band: a staircase is played
    stair: 0.25,               // the staircase's step, as a share of the band's span
    hold: 5,                   // each stair is held hold × (τc₀ + θ)
    stepShare: 0.05,           // a reference step: a jump of more than this share of r's span
    cap: 2,                    // a try pushes |u − u₀| at most this × the largest push proven before it
    beyond: 0.05,              // after a soft guard, y this share of the band's span further out than at the exit ends the test
    recover: 2,                // after a soft guard r ramps back to r(0) over 2(τc + θ) of the incumbent, at most this (s)
  },
  pause: { seconds: 2, wait: 30 },
  check: { stair: 0.125 },
  // Auto-tune's default goal (autotune.js GOAL, runCost): IAE, effort 0.05,
  // overshoot beyond 10 % at 2 per 100 %, saturation 0.2.
  goal: { effort: 0.05, overshoot: 10, overshootWeight: 2, saturation: 0.2 },
};

export const STAGES = ['listen', 'nudge', 'hold', 'ease', 'shake', 'check'];
export const STAGE_LABELS = { listen: 'Listen', nudge: 'Nudge', hold: 'Hold', ease: 'Ease in', shake: 'Shake', check: 'Check' };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Numbers for sentences: three significant digits, no trailing zeros.
export function fmtNum(v, digits = 3) {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const a = Math.abs(v);
  const d = Math.max(0, digits - 1 - Math.floor(Math.log10(a)));
  return String(Number(v.toFixed(Math.min(d, 12))));
}
const withUnit = (v, unit) => `${fmtNum(v)}${unit ? ` ${unit}` : ''}`;
const pct = (x) => `${Math.round(100 * x)} %`;
// The test's lengths the tester can choose (s; identify.js offers them), in words.
export const LENGTHS = [30, 60, 120, 300, 600];
export const budgetText = (t) => (t < 60 ? `${fmtNum(t, 2)} s` : `${fmtNum(t / 60, 2)} min`);

// ---- The gentle PI and its law

// SIMC (Skogestad 2003) with a chosen closed-loop time τc and its robust
// integral time, from the first look:
//   settles      Kp = τ / (K (τc + θ)),       Ti = 4 (τc + θ)
//   integrates   Kp = 1 / (k′ (τc + θ′)),     Ti = 4 (τc + θ′),  θ′ = θ + τ
// θ includes half a controller sample (the hold on u). The sign follows the
// plant's, so a reverse-acting plant gets negative gains.
export function gentleGains(look, tauC, Ts) {
  if (look.integrating) {
    const th = look.theta + look.tau + Ts / 2;
    const Kp = Math.sign(look.kp) / (Math.abs(look.kp) * (tauC + th));
    const Ti = EXPERIMENT.hold.Ti * (tauC + th);
    return { Kp, Ki: Kp / Ti, Ti, tauC, theta: th };
  }
  const th = look.theta + Ts / 2;
  const Kp = (Math.sign(look.K) * look.tau) / (Math.abs(look.K) * (tauC + th));
  const Ti = EXPERIMENT.hold.Ti * (tauC + th);
  return { Kp, Ki: Kp / Ti, Ti, tauC, theta: th };
}

// τc₀, the Hold's closed-loop time: 2(τ + θ) when it settles, 3(θ + τ) when
// it integrates (θ with half a sample, as in gentleGains).
export function gentleTauC(look, Ts) {
  const th = look.theta + Ts / 2;
  return look.integrating ? EXPERIMENT.hold.integrates * (th + look.tau) : EXPERIMENT.hold.settles * (look.tau + th);
}

// The PI the experiment runs, the same as controllers.js's PID with Kd = 0,
// setpoint weight 1, no prefilter, no feedforward and clamping anti-windup,
// started with its integral at I: v = Kp e + I, u = v held to [lo, hi]; the
// integral runs on while u is inside the limits or the error pulls it back.
// So "Add as variant" is { type: 'pid', params: { Kp, Ki, umin, umax, u0: I } }
// and a replay rebuilds the law from the log (gains, limits, the integral at
// the switch).
export function piLaw({ Kp, Ki }, I0, lo, hi, Ts) {
  let I = I0;
  return {
    get I() { return I; },
    step(r, y) {
      const e = r - y;
      const v = Kp * e + I;
      const u = clamp(v, lo, hi);
      if (Ki && (u === v || Math.sign(Ki * e) !== Math.sign(v - u))) I += Ki * Ts * e;
      return u;
    },
  };
}

// The integral that makes a PI's first output equal u (a bumpless switch).
export const bumpless = (g, u, r, y) => u - g.Kp * (r - y);

// ---- Scoring a try (§5.4)

// Auto-tune's cost of a run (autotune.js runCost with the default goal),
// on the try's r, y and u: IAE of e = r − y over r's span (R), the swing of u
// about its mean over u's range (U), the overshoot beyond 10 % at each
// reference step (a jump of more than 5 % of R in one sample), and the time u
// sits at a limit. Other inputs are held during the test, so no step window
// is cut by them. per: the samples each sum is shared by (default all of
// them): a try is scored with its tail, which must add what it costs, not
// dilute the mean (a slow loop's long tail would read as a better try).
export function tryCost(r, y, u, { R, U, lo, hi, per = r.length }) {
  const G = EXPERIMENT.goal, n = r.length;
  // A lost measurement (y not a number) is left out of the error.
  let err = 0, m = 0;
  for (let k = 0; k < n; k++) if (Number.isFinite(y[k])) { err += Math.abs((r[k] - y[k]) / R); m++; }
  err /= Math.max(1, (m * per) / n);
  let um = 0;
  for (let k = 0; k < n; k++) um += u[k];
  um /= n;
  let swing = 0;
  for (let k = 0; k < n; k++) swing += (u[k] - um) ** 2;
  const effort = (G.effort * swing) / (per * U * U);
  const steps = [];
  for (let k = 1; k < n; k++) if (Math.abs(r[k] - r[k - 1]) > EXPERIMENT.ease.stepShare * R) steps.push(k);
  let over = 0, worst = 0;
  steps.forEach((k0, i) => {
    const k1 = steps[i + 1] ?? n, dr = r[k0] - r[k0 - 1], dir = Math.sign(dr);
    let peak = 0;
    for (let k = k0; k < k1; k++) if (Number.isFinite(y[k])) peak = Math.max(peak, dir * (y[k] - r[k]));
    const p = (100 * peak) / Math.abs(dr);
    worst = Math.max(worst, p);
    over += Math.max(0, p - G.overshoot) / 100;
  });
  let sat = 0;
  const tol = 1e-9 * (U + 1);
  for (let k = 0; k < n; k++) if (u[k] <= lo + tol || u[k] >= hi - tol) sat++;
  const parts = { error: err, effort, overshoot: G.overshootWeight * over, saturation: (G.saturation * sat) / per };
  return { J: parts.error + parts.effort + parts.overshoot + parts.saturation, parts, overshoot: worst };
}

// The margin of a try, g = min(g_room, g_ring) (§5.4):
//   g_room  the smallest distance from y to the band's edge during the try,
//           over the smallest distance r itself keeps from it ("room kept")
//   g_ring  1 − (the third half-wave of e after each reference step) / (20 %
//           of the step): 1 when it does not swing back ("ringing")
// Half-waves are told apart with a hysteresis h (the noise), so noise does
// not count as swings.
export function tryMargin(r, y, band, h = 0) {
  const [lo, hi] = band, n = r.length;
  let dy = Infinity, dr = Infinity;
  for (let k = 0; k < n; k++) {
    if (Number.isFinite(y[k])) dy = Math.min(dy, y[k] - lo, hi - y[k]);
    dr = Math.min(dr, r[k] - lo, hi - r[k]);
  }
  const gRoom = dy / Math.max(dr, 1e-12 * (hi - lo));
  let R = 0;
  { let a = Infinity, b = -Infinity; for (let k = 0; k < n; k++) { a = Math.min(a, r[k]); b = Math.max(b, r[k]); } R = b - a; }
  const steps = [];
  for (let k = 1; k < n; k++) if (Math.abs(r[k] - r[k - 1]) > EXPERIMENT.ease.stepShare * R && R > 0) steps.push(k);
  let gRing = 1;
  steps.forEach((k0, i) => {
    const k1 = steps[i + 1] ?? n, step = r[k0] - r[k0 - 1];
    let s = Math.sign(step), wave = 0, peak3 = 0;
    for (let k = k0; k < k1; k++) {
      if (!Number.isFinite(y[k])) continue;
      const e = r[k] - y[k];
      if (s > 0 && e < -h) { s = -1; wave++; } else if (s < 0 && e > h) { s = 1; wave++; }
      if (wave === 2) peak3 = Math.max(peak3, Math.abs(e));
      if (wave > 2) break;
    }
    gRing = Math.min(gRing, 1 - peak3 / (EXPERIMENT.ease.ring * Math.abs(step)));
  });
  return { g: Math.min(gRoom, gRing), gRoom, gRing };
}

// ---- Listen (§5.1)

// What a stretch of y at rest says: the noise σ = std(Δy)/√2 (robust to
// drift), the encoder's step q (the common nonzero |Δy| when the values sit
// on a grid), floor = max(σ, q/√12, a tiny share of the band) and the drift
// by least squares, noted only when it stands out of the noise.
export function listenStats(y, Ts, { span = 1, half = true } = {}) {
  const all = Array.from(y);
  const n0 = all.length;
  // The last half: a plant still settling from before (a tank emptying at
  // u₀ = 0, an arm still swinging) would read as noise and drift.
  const ys = half ? all.slice(Math.floor(n0 / 2)) : all;
  const n = ys.length;
  let m = 0;
  for (const v of ys) m += v;
  m /= n;
  let d2 = 0, dm = 0;
  for (let k = 1; k < n; k++) dm += ys[k] - ys[k - 1];
  dm /= Math.max(1, n - 1);
  for (let k = 1; k < n; k++) d2 += (ys[k] - ys[k - 1] - dm) ** 2;
  const sigma = n > 2 ? Math.sqrt(d2 / (n - 2)) / Math.SQRT2 : 0;
  const q = gridStep(all);
  const floor = Math.max(sigma, q / Math.sqrt(12), EXPERIMENT.listen.floor * span);
  // The slope per sample, and its standard error.
  const tc = (n - 1) / 2;
  let stt = 0, sty = 0;
  for (let k = 0; k < n; k++) { stt += (k - tc) ** 2; sty += (k - tc) * (ys[k] - m); }
  const b = stt > 0 ? sty / stt : 0;
  let rr = 0;
  for (let k = 0; k < n; k++) rr += (ys[k] - m - b * (k - tc)) ** 2;
  const se = stt > 0 && n > 2 ? Math.sqrt(rr / (n - 2) / stt) : Infinity;
  const drifts = Math.abs(b) > EXPERIMENT.listen.drift * se && Math.abs(b) * n > floor;
  const slope = drifts ? b : 0;        // per sample
  // y₀: where y is at the end of Listen (the mean, carried along any drift).
  const y0 = m + slope * (n - 1 - tc);
  return { y0, mean: m, sigma, q, floor, slope, drift: slope / Ts, drifts, n: n0 };
}

// The step of a grid the values sit on (an encoder's count), or 0: the
// smallest nonzero |Δy|, when every difference is a whole multiple of it.
function gridStep(y) {
  let q = Infinity;
  const diffs = [];
  for (let k = 1; k < y.length; k++) {
    const d = Math.abs(y[k] - y[k - 1]);
    if (d > 0) { diffs.push(d); q = Math.min(q, d); }
  }
  if (!diffs.length || !Number.isFinite(q)) return 0;
  const tol = 1e-6;
  let on = 0;
  for (const d of diffs) { const x = d / q; if (Math.abs(x - Math.round(x)) < tol * Math.max(1, x)) on++; }
  // Most differences a whole multiple of the smallest, and not just one value.
  return on >= 0.9 * diffs.length && diffs.length >= 3 && diffs.some((d) => Math.abs(d / q - 1) < tol) ? q : 0;
}

// ---- The test and check references

// The reference a try plays: the tester's r over one period (plan.test.r),
// or, when r moves less than 10 % of the band, a staircase r₀ → r₀ + ¼ of the
// band (toward the side with more room) → r₀, each level held 5(τc₀ + θ).
// The Check's: the same with its steps halved about the middle (a staircase:
// ⅛ of the band).
export function staircase(r0, band, share, hold) {
  const [lo, hi] = band, span = hi - lo;
  const up = hi - r0 >= r0 - lo;
  const r1 = r0 + (up ? 1 : -1) * share * span;
  const out = new Array(3 * hold);
  for (let k = 0; k < out.length; k++) out[k] = k >= hold && k < 2 * hold ? r1 : r0;
  return out;
}

export function halved(r) {
  let a = Infinity, b = -Infinity;
  for (const v of r) { a = Math.min(a, v); b = Math.max(b, v); }
  const mid = (a + b) / 2;
  return Array.from(r, (v) => mid + (v - mid) / 2);
}

// ---- The first look (§5.2)

// Swings about the level y started from, in a stretch at rest (from sample
// `from` on): the count of crossings beyond a hysteresis of 3 floors, and the
// frequency their spacing gives (two or more), in Hz.
function restSwings(y, from, level, floor, Ts) {
  let peak = 0;
  for (let j = from; j < y.length; j++) peak = Math.max(peak, Math.abs(y[j] - level));
  const h = Math.max(3 * floor, 0.05 * peak);
  let s = 0, count = 0, first = -1, lastAt = -1;
  for (let j = from; j < y.length; j++) {
    const d = y[j] - level;
    const now = d > h ? 1 : d < -h ? -1 : 0;
    if (now && s && now !== s) { count++; if (first < 0) first = j; lastAt = j; }
    if (now) s = now;
  }
  return { count, f: count >= 2 ? (count - 1) / (2 * (lastAt - first) * Ts) : null, peak };
}

// Start values from the largest rung: its sign (measure), the dead time to
// the first clear move, the gain at its peak in the push, the rate, and the
// time to 63 %.
function lookGuess(rung, Ts) {
  const { d, T, a, floor } = rung, n = d.length;
  // The response's peak anywhere in the rung (a dead time puts it after the push).
  let peak = 0, kp = 0;
  for (let j = 0; j < n; j++) if (Math.abs(d[j]) > Math.abs(peak)) { peak = d[j]; kp = j; }
  const sign = rung.sign, big = Math.abs(peak);
  const thr = Math.max(3 * floor, 0.1 * big);
  let j0 = 0;
  while (j0 < kp && Math.abs(d[j0]) <= thr) j0++;
  const theta = Math.max(0, (j0 - 1) * Ts);
  let j63 = j0;
  while (j63 < kp && Math.abs(d[j63]) < 0.63 * big) j63++;
  const tau = Math.max(Ts, (j63 - j0 + 1) * Ts);
  // A push of a for T: the gain at least peak/a; an integrator's rate about peak/(a·T).
  return { K: (sign * big) / a, kp: (sign * big) / (a * T * Ts), tau, theta };
}

// ---- The machine

// plan: from planExperiment (identify.js). Returns the Experiment:
//   step(k, y, applied?) → u   one controller sample: k the plant's sample
//                              number (seq; a jump is a gap the plant held
//                              u over), y the block's measurement, applied
//                              the u the plant applied over the cycle just
//                              ended, when it echoes one
//   reference(k) → r           what the r Source plays at sample k (asked
//                              before step(k))
//   needs                      null, or { kind: 'fit', upto }: the page fits
//                              the record up to sample upto and supplies
//   supply(kind, data)         the fit and the Check's prediction, as data
//   stop()                     Stop (soft): the excitation ends; a closed loop
//                              brings y back to r(0) (r ramps there, at most
//                              settleMax), and only then state.stop asks for
//                              the plant's `stop`; before any loop ran, u₀ at once
//   abort(reason)              an E-stop or a lost plant: ends at once
//   state                      { stage, chips, status, push, room, … , done,
//                              end, stop }
//   record()                   { version, Ts, u, y, r, applied, gaps, log, end }:
//                              plain data; null where y was not measured or
//                              the plant echoed no applied u
export function createExperiment(plan) {
  checkPlan(plan);
  const P = plan, E = EXPERIMENT, Ts = P.Ts, U = P.umax - P.umin;
  const [lo, hi] = P.band, span = hi - lo;
  const names = { u: 'u', uUnit: '', y: 'y', yUnit: '', ...(P.names ?? {}) };
  const yU = (v) => withUnit(v, names.yUnit), uU = (v) => withUnit(v, names.uUnit);
  const atLimit = P.u0 <= P.umin || P.u0 >= P.umax;
  const freeSide = atLimit ? (P.u0 <= P.umin ? P.umax - P.u0 : P.u0 - P.umin) : Math.min(P.umax - P.u0, P.u0 - P.umin);
  const aMax = E.nudge.push * freeSide;
  const rec = { u: [], y: [], r: [], applied: [], gaps: [], log: [] };
  const log = (entry) => { rec.log.push(entry); return entry; };
  // The current sample: plant sample k (from k0), record index i, y, r.
  let k = null, k0 = null, i = -1, y = NaN, r = NaN, uLast = P.u0;
  let rFn = () => r0;
  let needs = null, supplied = null, endInfo = null, stopAsked = false;
  const testR = P.test.r ? P.test.r.slice() : null;
  let r0 = testR ? testR[0] : P.test.r0;
  const chips = Object.fromEntries(STAGES.map((s) => [s, '']));
  const st = {
    stage: 'listen', rung: 0, try: 0, push: 0, pushMax: 0, room: 0, roomMax: 0, status: '', tries: [],
    marks: { push: [null, null], room: [E.nudge.room, E.nudge.backoff] },
    t: 0, budget: P.budget, done: false, end: null, stop: false,
  };
  const now = () => (k - k0) * Ts;
  const left = () => P.budget - now();
  let listenInfo = null, look = null, gentle = null, inc = null, test = null, check = null, rungs = [];

  function enter(stage) {
    for (const s of STAGES) if (chips[s] === 'lit') chips[s] = '✓';
    chips[stage] = 'lit';
    st.stage = stage;
    log({ kind: 'stage', stage, i });
  }
  function finish(code, message, extra = {}) {
    for (const s of STAGES) if (chips[s] === 'lit') chips[s] = code === 'done' ? '✓' : '✕';
    for (const s of STAGES) if (!chips[s]) chips[s] = '–';
    endInfo = { code, message, i, t: now(), ...extra };
    log({ kind: 'end', ...endInfo });
    st.done = true; st.end = endInfo; st.stop = true; stopAsked = true;
    st.status = message;
  }
  const meters = (u) => {
    st.push = Math.abs(u - P.u0) / U;
    st.pushMax = Math.max(st.pushMax, st.push);
  };
  const roomUsed = (yy) => {
    if (!listenInfo) return 0;
    const y0 = listenInfo.y0, up = hi - y0, down = y0 - lo;
    return yy >= y0 ? (yy - y0) / Math.max(up, 1e-300) : (y0 - yy) / Math.max(down, 1e-300);
  };
  const inBand = (yy) => yy >= lo && yy <= hi;
  const beyond = (yy) => Math.max(lo - yy, yy - hi, 0);
  // After a soft guard the incumbent brings y back (§5.4): for at most
  // settleMax a closed-loop stage does not end the test while y is outside,
  // unless y goes further beyond the band than where it left it (plus a
  // twentieth of the band's span: what the plant's momentum carries on);
  // the recovery is over once y has been back inside for hold.settle.
  let recovering = null;
  const holds = () => {
    if (recovering === null) return inBand(y);
    if (inBand(y)) {
      if (++recovering.inside >= Math.ceil(E.hold.settle / Ts - 1e-9)) recovering = null;
      return true;
    }
    recovering.inside = 0;
    if (beyond(y) > recovering.beyond + E.ease.beyond * span) return false;
    return (k - recovering.k) * Ts < E.ease.settleMax;
  };
  // The reference while the incumbent brings y back: from the try's own
  // value at the exit, a ramp to r(0), so its first sample does not kick u
  // by Kp times the step (measured: 37 % of the range on an arm).
  let ramp = null;
  const aim = (sp) => {
    if (ramp && k < ramp.k1) { const { k0: a, k1: b, from } = ramp; rFn = (kk) => (kk >= b ? sp : from + ((sp - from) * (kk - a)) / (b - a)); } else { ramp = null; rFn = () => sp; }
  };

  // ---- Listen

  function* listen() {
    enter('listen');
    const n = Math.max(E.listen.samples, Math.ceil(E.listen.seconds / Ts - 1e-9));
    const i0 = i, kEnd = k + n, yFirst = y;
    // The band is guarded from the first sample: a plant that runs off at
    // u₀ ends the test at once (an unstable plant with a small bias reached
    // 220 in Listen's 3 s, for a band of ±1.3), a few samples in a row so
    // that noise at the band's edge does not.
    let out = 0;
    while (k < kEnd) {
      out = inBand(y) ? 0 : out + 1;
      if (out >= E.listen.outside) {
        if (!inBand(yFirst)) return finish('outside', `${names.y} is at ${yU(y)}, outside 'may move within': widen it, or bring the plant inside first`);
        return finish('drift', `${names.y} drifts out of 'may move within' with ${names.u} held at ${uU(P.u0)} (from ${yU(yFirst)} to ${yU(y)} in ${fmtNum(now(), 2)} s): it needs a controller first`);
      }
      st.status = `Listening: ${names.u} held at ${uU(P.u0)} while the page measures the noise on ${names.y} (${fmtNum(now(), 2)} of ${fmtNum(n * Ts, 2)} s)`;
      yield P.u0;
    }
    const ys = rec.y.slice(i0, i).filter(Number.isFinite);
    listenInfo = { ...listenStats(ys, Ts, { span }), i0, i1: i };
    log({ kind: 'listen', ...listenInfo });
  }

  // ---- Nudge

  // One rung: a doublet (+a for T, −a for T, u₀ for 2T) or, at a limit, a
  // pulse (+a for T, u₀ for 3T), T in samples; dir the sign of the first half.
  function* rung(n, a, T, dir, bound, kLast) {
    const shape = atLimit ? 'pulse' : 'doublet';
    const L = listenInfo;
    // The level the rung starts from (its response is read against it),
    // carried along the drift: the last few samples before it.
    let base, ic, nBase;
    if (!rungs.length) { base = L.y0; ic = L.i1 - 1; nBase = L.i1 - L.i0; } else {
      // The rest the last rung ended in (the window it was still over).
      const last = rungs[rungs.length - 1];
      const from = Math.max(last.i0, i - Math.max(E.nudge.start, last.w ?? 0));
      base = meanOf(from, i); ic = (from + i - 1) / 2; nBase = i - from;
      if (!Number.isFinite(base)) base = y;
    }
    const R = { kind: 'rung', n, shape, a, T, dir, i0: i, i1: null, base, ic, nBase, slope: L.slope, bound, backoff: false, runaway: false };
    const level = (j) => R.base + R.slope * (j - R.ic);
    const kStart = k, len = 4 * T;
    // After its planned rest the rung waits, at u₀, until y has stopped
    // moving (at most `most` samples): the next rung then starts from rest,
    // and its response can be read against the level it starts from. Rest
    // is declared only once the wait covers a delay the response may have
    // (twice the longest one a visible rung showed; 1 s while none has been
    // seen), and only when the last window's spread is small, not just its
    // two halves' means: in the middle of a swing they can be equal (a tank
    // read mid-swing had its sign read the wrong way round).
    const seen = rungs.filter((Q) => Q.visible && Number.isFinite(Q.delay)).map((Q) => Q.delay);
    const minWait = seen.length ? 2 * Math.max(...seen) : Math.ceil(E.nudge.restMin / Ts - 1e-9);
    const most = Math.max(E.nudge.restMax * len, Math.ceil(E.nudge.restMin / Ts), minWait);
    const w = Math.max(8, T);
    R.w = w;
    const uOf = (j) => (j < T ? P.u0 + dir * a : shape === 'doublet' && j < 2 * T ? P.u0 - dir * a : P.u0);
    let peak = 0, peakPlanned = 0, grows = false;
    st.rung = n;
    for (;;) {
      const j = k - kStart;
      const dy = y - level(i);
      peak = Math.max(peak, Math.abs(dy));
      if (j < len) peakPlanned = peak;
      st.room = roomUsed(y); st.roomMax = Math.max(st.roomMax, st.room);
      if (!inBand(y)) {
        R.i1 = i; R.left = true; R.at = y;
        // Out of the band with u held at u₀ after the push, and accelerating
        // away (three equal windows since the push ended): it ran away by
        // itself. A response still arriving slows down (a high-gain lag, or
        // one with a dead time longer than the push): not a runaway.
        const after = shape === 'doublet' ? 2 * T : T, m = Math.floor((j - after) / 3);
        if (m >= 2) {
          const lv = level(i), sg = Math.sign(y - lv);
          const a0 = sg * (meanOf(i - 3 * m, i - 2 * m) - lv), a1 = sg * (meanOf(i - 2 * m, i - m) - lv), a2 = sg * (meanOf(i - m, i) - lv);
          R.runaway = a2 - a1 > a1 - a0 && a1 - a0 > 0;
        }
        measure(R, level);
        rungs.push(R); log(R);
        return R;
      }
      if (j >= len && i - R.i0 >= w) {
        const m1 = meanOf(i - w, i - w / 2), m2 = meanOf(i - w / 2, i);
        const tol = Math.max((6 * L.floor) / Math.sqrt(w), E.nudge.still * peak);
        grows = Math.abs(m2 - level(i)) > Math.abs(m1 - level(i)) + tol;
        let a = Infinity, b = -Infinity;
        for (let q = i - w; q < i; q++) if (Number.isFinite(rec.y[q])) { a = Math.min(a, rec.y[q]); b = Math.max(b, rec.y[q]); }
        const still = Math.abs(m2 - m1) <= tol && b - a <= 2 * tol + 6 * L.floor;
        // Accelerating away from where it started over three windows, after
        // the wait, beyond 1.5 × the push's peak: it runs away, now, not at
        // the band's edge (a slow response still arriving slows down).
        if (i - R.i0 >= 3 * w && j >= len + minWait) {
          const lv = level(i), sg = Math.sign(y - lv), n3 = (6 * L.floor) / Math.sqrt(w);
          const a0 = sg * (meanOf(i - 3 * w, i - 2 * w) - lv), a1 = sg * (meanOf(i - 2 * w, i - w) - lv), a2 = sg * (m1 + m2 - 2 * lv) / 2;
          if (a2 - a1 > a1 - a0 + n3 && a1 - a0 > n3 && Math.abs(y - lv) > E.nudge.runaway * peakPlanned && peak > E.nudge.visible * L.floor) { grows = true; break; }
        }
        if ((still && j >= len + minWait) || j >= len + most || k >= kLast) break;
      }
      // Back-off: 80 % of the room on its side.
      if (!R.backoff && st.room >= E.nudge.backoff) R.backoff = true;
      const u = R.backoff ? P.u0 : uOf(j);
      meters(u);
      st.status = `Nudge ${n}: pushing ${shape === 'doublet' ? '±' : dir > 0 ? '+' : '−'}${uU(a)} (${pct(a / U)} of the range) for ${fmtNum(T * Ts, 2)} s; ${names.y} moved ${yU(Math.abs(dy))} (${pct(st.room)} of its room)`;
      yield u;
    }
    R.i1 = i;
    // Still growing when the rest ran out, beyond 1.5 × where a response to
    // the push would have peaked: it runs away.
    R.runaway = grows && Math.abs(y - level(i)) > E.nudge.runaway * peakPlanned && peak > E.nudge.visible * L.floor;
    measure(R, level);
    rungs.push(R);
    log(R);
    return R;
  }
  // The mean of y over samples a … b − 1, leaving out lost measurements (NaN when all are).
  const meanOf = (a, b) => { let s = 0, m = 0; for (let j = a; j < b; j++) if (Number.isFinite(rec.y[j])) { s += rec.y[j]; m++; } return m ? s / m : NaN; };

  // What a rung showed (§5.2). Its reach: how far y went from y₀ (the Listen
  // level, carried along the drift) up and down, the room it used; the move
  // rule and the next rung's bound are on the reach, because the room is
  // what must not run out, and a plant still swinging from the rung before
  // starts the next one away from rest. Its response, read against the level
  // it started from: its size, the growth exponent p during the push, a
  // plateau or a constant slope, ringing.
  function measure(R, level) {
    const { i0, T } = R, n = R.i1 - i0, L = listenInfo;
    const raw = new Float64Array(n);
    let up = 0, down = 0;
    // A lost measurement holds the last one (none yet: the level it started from).
    let yj = level(i0);
    for (let j = 0; j < n; j++) {
      if (Number.isFinite(rec.y[i0 + j])) yj = rec.y[i0 + j];
      raw[j] = yj - level(i0 + j);
      const e = yj - (L.y0 + L.slope * (i0 + j - (L.i1 - 1)));
      up = Math.max(up, e); down = Math.max(down, -e);
    }
    // The response is read through a moving mean over half the push
    // (m samples), against the noise of such a mean and of the level it is
    // read from, floor·√(1/m + 1/nBase): single samples hid a clear response
    // in noise (a lag at 1 % noise of its room read "is u wired?"). The reach
    // (up, down) stays sample by sample: it is what the room must hold.
    const m = Math.max(1, Math.floor(T / 2)), h0 = Math.floor((m - 1) / 2);
    const floor = L.floor * Math.sqrt(1 / m + 1 / Math.max(1, R.nBase));
    const d = new Float64Array(n);
    let size = 0;
    for (let j = 0; j < n; j++) {
      const a = Math.max(0, j - h0), b = Math.min(n, a + m);
      let s = 0;
      for (let q = a; q < b; q++) s += raw[q];
      d[j] = s / (b - a);
      size = Math.max(size, Math.abs(d[j]));
    }
    const at = (j) => d[Math.min(n - 1, Math.max(0, Math.round(j)))];
    const yT = at(T), yH = at(T / 2), y3 = at((3 * T) / 4), yQ = at(T / 4);
    const vis = (v) => Math.abs(v) > 3 * floor;
    // p, from y(T)/y(T/2) during the push, at most what any linear plant can
    // do: a doublet's spectrum 4a·sin²(ωT/2)/ω at most quadruples when T
    // doubles (p ≤ 2), a pulse's 2a·|sin(ωT/2)|/ω at most doubles (p ≤ 1),
    // whatever the dead time; unreadable (a dead time, noise): the most.
    const pMax = R.shape === 'doublet' ? E.nudge.grow[1] : E.nudge.grow[0];
    let p = pMax;
    if (vis(yT) && vis(yH)) p = Math.abs(yT) <= Math.abs(yH) ? E.nudge.grow[0] : clamp(Math.log2(Math.abs(yT) / Math.abs(yH)), E.nudge.grow[0], pMax);
    const big = Math.abs(yT) > E.nudge.visible * floor;
    const plateau = T >= 4 && big && Math.abs(yT - y3) < E.nudge.plateau * Math.abs(yT);
    const d1 = yH - yQ, d2 = y3 - yH, d3 = yT - y3;
    const near = (a, b) => Math.abs(a - b) <= E.nudge.slope * Math.max(Math.abs(a), Math.abs(b));
    const ramp = T >= 8 && big && !plateau && Math.sign(d1) === Math.sign(d2) && Math.sign(d2) === Math.sign(d3) && near(d1, d2) && near(d2, d3);
    // Ringing: swings about the start level after the push's first half.
    const h = Math.max(3 * floor, 0.05 * size);
    let s = Math.sign(yT) || 1, cross = 0;
    for (let j = T; j < n; j++) {
      if (s > 0 && d[j] < -h) { s = -1; cross++; } else if (s < 0 && d[j] > h) { s = 1; cross++; }
    }
    Object.assign(R, {
      d, up, down, max: Math.max(up, down), size, p, plateau, ramp, complete: plateau || ramp,
      rings: cross >= (R.shape === 'doublet' ? 2 : 1), visible: size > E.nudge.visible * floor,
      seen: size > E.nudge.response * floor, floor, mean: m,
    });
    // The response's sign: the direction of its first clear move, which
    // answers the push's first half whatever the dead time.
    const thr = Math.max(3 * floor, 0.25 * size);
    let jf = 0;
    while (jf < n - 1 && Math.abs(d[jf]) <= thr) jf++;
    R.sign = (Math.sign(d[jf]) || 1) * R.dir;
    R.delay = jf;   // samples from the push to that move: the next rungs wait twice as long
    if (R.bound !== null) R.within = up <= R.bound[0] * (1 + 1e-12) && down <= R.bound[1] * (1 + 1e-12);
  }

  function* nudge() {
    enter('nudge');
    const L = listenInfo, floor = L.floor;
    const y0 = L.y0, roomUp = hi - y0, roomDown = y0 - lo, rMin = Math.min(roomUp, roomDown);
    st.marks.push = [null, aMax / U];
    // Drift: the Nudge lasts until the drift would use a quarter of the room.
    let tDrift = Infinity;
    if (L.slope !== 0) {
      const room = L.slope > 0 ? roomUp : roomDown;
      tDrift = (E.nudge.drift * room) / Math.abs(L.drift);
      if (tDrift < E.nudge.read) {
        return finish('drift', `${names.y} drifts too fast to test: it needs a controller first (it moves ${yU(Math.abs(L.drift))}/s with ${names.u} at ${uU(P.u0)})`);
      }
    }
    const tStart = now(), budget = E.nudge.budget * P.budget;
    let a = E.nudge.a0 * U, T = E.nudge.T0, dir = atLimit ? (P.u0 <= P.umin ? 1 : -1) : 1;
    let sign = 0, flip = 0, bound = null, why = '';
    for (let n = 1; ; n++) {
      if (now() - tStart + 4 * T * Ts > budget) { why = 'budget'; break; }
      if (now() - tStart + 4 * T * Ts > tDrift) { why = 'drift'; break; }
      const R = yield* rung(n, a, T, dir, bound, k0 + Math.floor((tStart + Math.min(budget, tDrift)) / Ts));
      if (R.runaway) {
        return finish('runaway', `${names.y} runs away when pushed and does not come back: it needs a stabilising controller before it can be identified`);
      }
      // The smallest push already took y out: the plant is too sensitive for
      // this room (a gain of 1000), not unstable.
      if (R.left && n === 1) return finish('band', `${names.y} moves too far at the smallest push (${uU(a)}, ${pct(a / U)} of ${names.u}'s range, took it to ${yU(R.at)}): narrow ${names.u}'s range in the Controller tab, or widen 'may move within'`);
      if (R.left) return finish('band', `${names.y} left 'may move within' during the Nudge (${yU(R.at)}): the page stopped the plant`);
      if (R.backoff) { why = 'backoff'; break; }
      if (R.visible && !sign) {
        // Which way y goes when u rises; then push toward the side with more room first.
        sign = R.sign;
        if (!atLimit) dir = sign * (roomUp >= roomDown ? 1 : -1);
      }
      if (R.complete && R.size >= Math.max(E.nudge.visible * R.floor, E.nudge.enough * rMin)) { why = 'enough'; break; }
      // The next move: double T while the response is not complete; while it
      // is not even visible, alternate T and a; once complete, double a. A
      // move predicts growth × safety × the reach (2 for a, 2^p for T). Two
      // precisions: doubling a push that has not visibly moved y can move it
      // more than twice as far (friction, a dead band: tiny pushes lie), so
      // that predicts × dead from at least the noise's level (response ×
      // floor); and a pulse moves y one way, so its two sides are predicted
      // and held to their own rooms, where a doublet's swing both ways is
      // held to the smaller room.
      // A longer push after one that did not visibly move y lies the same
      // way (measured from rest: an arm's T 4 → 8 at 0.48 V moved 4.8× where
      // 2^p gave 4), so it predicts dead/2 × 2^p.
      const predict = (growth, amp) => {
        const lift = (e) => (amp && !R.visible ? Math.max(e, E.nudge.response * R.floor) : e);
        const g = !R.visible ? (amp ? E.nudge.dead : (E.nudge.dead / 2) * growth) : growth;
        if (R.shape === 'doublet') { const m = g * E.nudge.safety * lift(R.max); return [m, m]; }
        return [g * E.nudge.safety * lift(R.up), g * E.nudge.safety * lift(R.down)];
      };
      const allowed = ([pu, pd]) => (R.shape === 'doublet' ? Math.max(pu, pd) <= E.nudge.room * rMin : pu <= E.nudge.room * roomUp && pd <= E.nudge.room * roomDown);
      const nextA = predict(2, true), nextT = predict(2 ** R.p, false);
      const canA = a < aMax * (1 - 1e-12) && allowed(nextA);
      const canT = 2 * T * Ts <= E.nudge.Tmax && allowed(nextT);
      let move = null;
      if (R.complete) move = canA ? 'a' : null;
      else if (!R.visible) {
        const want = flip++ % 2 === 0 ? 'T' : 'a';
        move = want === 'T' ? (canT ? 'T' : canA ? 'a' : null) : canA ? 'a' : canT ? 'T' : null;
      } else move = canT ? 'T' : canA ? 'a' : null;
      if (!move) { why = 2 * T * Ts > E.nudge.Tmax ? 'longest' : 'room'; break; }
      if (move === 'a') { a = Math.min(2 * a, aMax); bound = nextA; } else { T *= 2; bound = nextT; }
    }
    log({ kind: 'nudge', why, rungs: rungs.length, i });
    // Nothing at all, with the push grown to the largest the Nudge allows
    // (half of u's way to its nearer limit) and as long as its time or T's
    // limit let it: not wired. Stopped short of that by the room, the noise
    // was too large for it, and the sentence says so.
    const R = rungs[rungs.length - 1];
    const largest = R && R.a >= aMax * (1 - 1e-9) && (why === 'budget' || why === 'longest');
    if (!rungs.some((Q) => Q.seen) && largest) {
      return finish('none', `${names.u} does not move ${names.y}: is ${names.u} wired to the plant?`);
    }
    if (!rungs.some((Q) => Q.seen) && why === 'budget') {
      return finish('none', `${names.u} has not moved ${names.y} at all, at pushes up to ${uU(R.a)} for ${fmtNum(R.T * Ts, 2)} s: is ${names.u} wired to the plant? A longer test would push harder`);
    }
    // Something moved, but never clearly: a first look would read noise.
    if (!rungs.some((Q) => Q.visible)) {
      if (why === 'budget') return finish('budget', `${budgetText(P.budget)} is too short to see ${names.y} move clearly: allow longer`);
      if (rMin < E.nudge.visible * floor) {
        const side = roomUp < roomDown ? `above ${yU(hi)}` : `below ${yU(lo)}`;
        return finish('room', `${names.y} starts ${yU(rMin)} from the edge of 'may move within' (its noise is ${yU(floor)}): widen it ${side}, so the pushes have room both ways`);
      }
      // It did move, but not yet clearly, and the next push might take it
      // beyond half the room (a near-empty tank moved 0.02 m at the smallest
      // push): that is the room, not too little a move.
      const moved = rungs.filter((Q) => Q.seen).reduce((m, Q) => Math.max(m, Q.max), 0);
      if (moved > 0 && why === 'room') {
        const side = roomUp < roomDown ? 'above' : 'below';
        return finish('room', `${names.y} moved ${yU(moved)} at pushes up to ${uU(R.a)}, and a larger push could take it beyond half of 'may move within' (${yU(rMin)} ${side} where it rests): widen it ${side === 'above' ? `above ${yU(hi)}` : `below ${yU(lo)}`}, or narrow ${names.u}'s range in the Controller tab (the pushes start at ${pct(E.nudge.a0)} of it)`);
      }
      return finish('room', `${names.y} moves too little to read within half of 'may move within' (its noise is ${yU(floor)}): widen it`);
    }
    return null;
  }

  // ---- First look (§5.2): a rest at u₀, then, still at rest, a small fit
  // in work-unit slices. The rest comes first because its record shows how
  // the last push dies out: a resonance rings there, a lag returns, an
  // integrator stays. One segment covers the whole Nudge and the rest, drift
  // taken out; a lag, an integrator with a lag and a resonance are fitted,
  // and the lowest BIC decides the class.

  function* firstLook() {
    st.status = `A first look at what the pushes showed (${names.u} at ${uU(P.u0)})`;
    const L = listenInfo, w = 1 / (L.floor * L.floor);
    const kRest = k + Math.ceil(E.look.rest / Ts - 1e-9), iRest = i;
    while (k < kRest) {
      if (!inBand(y)) return 'runaway';
      meters(P.u0); st.room = roomUsed(y); yield P.u0;
    }
    // Still moving away from y₀ at the end of the rest, faster than at its
    // start, beyond 1.5 × the largest reach a push gave: it runs away by itself.
    {
      const m = Math.max(4, Math.floor((i - iRest) / 4));
      const away = (a, b) => Math.abs(meanOf(a, b) - (L.y0 + L.slope * ((a + b - 1) / 2 - (L.i1 - 1))));
      const first = away(iRest, iRest + m), last = away(i - m, i);
      const reach = Math.max(...rungs.map((R) => R.max));
      if (last > E.nudge.runaway * reach && last > first + E.nudge.visible * L.floor) return 'runaway';
    }
    const i0 = rungs[0].i0, n = i - i0, iL = L.i1 - 1;
    const yy = new Float64Array(n), uu = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      yy[j] = rec.y[i0 + j] - L.slope * (i0 + j - iL);
      const ap = rec.applied[i0 + j];
      uu[j] = Number.isFinite(ap) ? ap : rec.u[i0 + j];
    }
    const seg = { y: yy, u: uu, yStart: L.y0 + L.slope * (i0 - iL), uStart: P.u0, weight: w };
    // Swings in the rest after the last push: the frequency to start from.
    const last = rungs[rungs.length - 1], from = last.i1 - i0;
    const swing = restSwings(yy, from, seg.yStart, L.floor, Ts);
    const best = rungs.filter((R) => R.seen).reduce((a, b) => (b.size > a.size ? b : a));
    const guess = lookGuess(best, Ts);
    const gr = { ...guess, f: swing.f ?? 1 / (2 * Math.PI * Math.max(guess.tau, Ts)), zeta: swing.f ? 0.3 : 0.8 };
    const fits = {};
    const jobs = E.look.structures.map((name) => ({ name, gen: fitStructureSteps([seg], name, [STRUCTURES[name].start(name === 'resonance' ? gr : guess)], { Ts, maxIter: E.look.maxIter }) }));
    let job = 0;
    while (job < jobs.length) {
      for (let s2 = 0; s2 < E.look.perSample && job < jobs.length; s2++) {
        let s;
        try { s = jobs[job].gen.next(); } catch (err) { s = { done: true, value: null }; }
        if (s.done) { fits[jobs[job].name] = s.value; job++; }
      }
      meters(P.u0);
      st.room = roomUsed(y);
      yield P.u0;
    }
    // A fit that ran to the end of its range (a parameter e^±40 or more)
    // found no shape in the data; it does not compete.
    const sane = (f) => f && Number.isFinite(f.bic) && STRUCTURES[f.structure].params.every((key) => key === 'theta' || Math.abs(Math.log(Math.abs(f.p[key]))) < E.look.edge);
    const ok = Object.values(fits).filter(sane);
    if (!ok.length) return null;
    let pick = ok.reduce((a, b) => (b.bic < a.bic ? b : a));
    // A settling fit whose slower time constant is longer than all the data
    // it was fitted to cannot be told from an integrator there (a resonance
    // at ζ 20 for an integrator drifting on a bias); within 2 of BIC, the
    // integrator is taken, and its gentle loop holds.
    const slowOf = (f) => (f.structure === 'lag' ? f.p.tau : f.structure === 'resonance' ? (f.p.zeta >= 1 ? (f.p.zeta + Math.sqrt(f.p.zeta ** 2 - 1)) / (2 * Math.PI * f.p.f) : 0) : 0);
    if (pick.structure !== 'intLag' && sane(fits.intLag) && fits.intLag.bic < pick.bic + 2 && slowOf(pick) > n * Ts) pick = fits.intLag;
    const integrating = pick.structure === 'intLag';
    const rings = !integrating && (swing.count >= 2 || (pick.structure === 'resonance' && pick.p.zeta < E.look.rings));
    let model;
    if (integrating) model = { kp: pick.p.kp, tau: pick.p.tau, theta: pick.p.theta };
    else if (pick.structure === 'resonance') {
      // As a lag for SIMC: the gain, and the time the swing takes to die out
      // when it rings (1/(ζωn)), else the pair's slower time constant.
      const wn = 2 * Math.PI * pick.p.f, z = pick.p.zeta;
      const tau = z < 1 ? 1 / (z * wn) : (z + Math.sqrt(z * z - 1)) / wn;
      model = { K: pick.p.K, tau, theta: pick.p.theta };
    } else model = { K: pick.p.K, tau: pick.p.tau, theta: pick.p.theta };
    look = {
      cls: integrating ? 'ramps' : rings ? 'rings' : 'settles', integrating,
      sign: Math.sign(integrating ? model.kp : model.K) || 1,
      K: model.K ?? null, kp: model.kp ?? null, tau: model.tau, theta: model.theta,
      structure: pick.structure, p: pick.p, swing,
      bic: Object.fromEntries(Object.entries(fits).map(([k2, f]) => [k2, f?.bic ?? null])), guess,
    };
    log({ kind: 'look', ...look, i });
    return look;
  }

  // ---- Closed loop: the PI, bumpless switches, settling

  let law = null, lawInfo = null;
  // A switch to new gains at this sample: the integral makes u continue.
  // lim: the limits it runs within (u's range, or a try's cap on the push).
  function switchTo(g, role, lim = [P.umin, P.umax]) {
    const I = bumpless(g, uLast, r, y);
    law = piLaw(g, I, lim[0], lim[1], Ts);
    lawInfo = { Kp: g.Kp, Ki: g.Ki, tauC: g.tauC, umin: lim[0], umax: lim[1], I, role };
    log({ kind: 'law', i, ...lawInfo });
  }
  // The largest push proven so far, |u − u₀|: the Nudge's, the Hold's, then
  // each accepted try's. A try may push at most ease.cap × that (§5.4: the
  // effort eases in; measured, a motor's first try pushed 15× the Nudge's).
  let proven = 0;
  const provenIn = (a, b) => { let m = 0; for (let j = a; j < b; j++) if (Number.isFinite(rec.u[j])) m = Math.max(m, Math.abs(rec.u[j] - P.u0)); return m; };
  const capOf = () => {
    const c = E.ease.cap * Math.max(proven, E.nudge.a0 * U);
    return [Math.max(P.umin, P.u0 - c), Math.min(P.umax, P.u0 + c)];
  };
  const tolerance = () => Math.max(E.hold.sigmas * listenInfo.sigma, E.hold.bandShare * span, E.hold.steps * listenInfo.q);

  // Holds y at sp under the current law until it has been settled for
  // `settle` s or `most` s have passed. Returns whether it settled; a band
  // exit returns 'left'. guard: y moving away from sp, the way it has been
  // going and without ever crossing it, by more than a quarter of the room
  // on that side beyond where it started, returns 'away' (a loop pushing the
  // wrong way: the sign read wrong; measured, it caught every such tank
  // before it emptied, and never tripped on a loop that holds).
  // How the last settle went: whether y swung across sp (beyond the
  // tolerance, after first reaching it), and how far y was from sp at its
  // start and at its end.
  let swing = { swung: false, from: 0, to: 0 };
  function* settle(sp, most, status, guard = false) {
    aim(sp);
    const tol = tolerance(), need = Math.ceil(E.hold.settle / Ts - 1e-9), kEnd = k + Math.ceil(most / Ts - 1e-9);
    let inside = 0, side = 0;
    swing = { swung: false, from: Math.abs(y - sp), to: Math.abs(y - sp) };
    const yStart = y, awayStart = Math.abs(y - sp);
    for (;;) {
      if (!holds()) return 'left';
      if (guard && !swing.swung && Math.abs(y - sp) - awayStart > E.hold.away * (y >= sp ? hi - sp : sp - lo) && Math.sign(y - yStart) === Math.sign(y - sp)) return 'away';
      const e = y - sp;
      inside = Math.abs(e) < tol ? inside + 1 : 0;
      if (Math.abs(e) >= tol) {
        const s2 = Math.sign(e);
        if (side && s2 !== side) swing.swung = true;
        side = s2;
      }
      swing.to = Math.abs(e);
      if (inside >= need) return true;
      if (k >= kEnd) return false;
      const u = law.step(r, y);
      meters(u);
      st.room = roomUsed(y);
      st.status = status;
      yield u;
    }
  }

  // The Hold (§5.3). Not settled in 4(τc + θ) + 2 s: a loop that swings
  // about r(0) gets τc doubled, once, as designed; a loop that only creeps
  // toward it (friction holds a gentle loop back) keeps its gains, since a
  // slower loop creeps slower, and gets the same time again. Still not
  // settled: the test stops, unless y is still closing in on r(0) inside the
  // band, when the ladder starts from there (and says so).
  function* hold() {
    enter('hold');
    let tauC = gentleTauC(look, Ts);
    gentle = gentleGains(look, tauC, Ts);
    switchTo(gentle, 'hold');
    log({ kind: 'hold', ...gentle, i });
    const status = `Holding ${names.y} at ${yU(r0)} with a gentle controller`;
    let ok = yield* settle(r0, 4 * (tauC + gentle.theta) + E.hold.slack, status, true);
    if (ok === false) {
      const first = { ...swing };
      if (first.swung) {
        tauC *= 2;
        gentle = gentleGains(look, tauC, Ts);
        switchTo(gentle, 'hold');
        log({ kind: 'hold', ...gentle, doubled: true, i });
      } else log({ kind: 'hold', ...gentle, again: true, i });
      ok = yield* settle(r0, 4 * (tauC + gentle.theta) + E.hold.slack, status, true);
      if (ok === false && !first.swung && !swing.swung && swing.to < swing.from - 2 * listenInfo.floor) {
        log({ kind: 'note', i, text: `${names.y} creeps toward ${yU(r0)} under the gentle controller (${yU(swing.to)} away): the tries start from there` });
        ok = true;
      }
    }
    proven = Math.max(proven, provenIn(rungs[0]?.i0 ?? i, i));
    if (ok === 'away') return finish('away', `the gentle controller pushed ${names.y} away from ${yU(r0)} (${yU(y)} at ${fmtNum(now(), 3)} s): the page stopped the plant; the pushes may have been read the wrong way round`);
    if (ok === 'left') return finish('band', `${names.y} left 'may move within' under the gentle controller (${yU(y)} at ${fmtNum(now(), 3)} s): the page stopped the plant`);
    if (!ok) return finish('hold', `the gentle controller does not hold ${names.y} at ${yU(r0)}`);
    inc = { gains: gentle, tauC, J: Infinity, n: 0, lim: [P.umin, P.umax] };
    return null;
  }

  // ---- Ease in

  function* tryOnce(n, g) {
    const status = `Ease in, try ${n}: asking the controller to be ${pct(1 - E.ease.quicker)} quicker than ${n === 1 ? 'the gentle one' : 'the last try'}`;
    // 1. The incumbent brings y to r(0) and holds it.
    const i0 = i;
    const settled = yield* settle(r0, E.ease.settleMax, status);
    if (settled === 'left') return { left: true, i0 };
    // 2. A bumpless switch to the candidate; 3. one period of the test reference.
    const lim = capOf();
    switchTo(g, 'try', lim);
    const iS = i, kS = k, N = test.length;
    rFn = (kk) => test[Math.min(N - 1, kk - kS)];
    let left = false, away = false, toward = false;
    // From a settled start: y going the other way from where r asks, never
    // having gone toward it, by more than a quarter of the room on that side
    // (the Hold's guard, for a loop that held r(0) by luck).
    const yS = y;
    while (k - kS < N) {
      if (!inBand(y)) { left = true; break; }
      if (settled === true && r !== r0) {
        const want = Math.sign(r - r0), moved = y - yS;
        if (Math.sign(moved) === want && Math.abs(moved) > 0.1 * Math.abs(r - r0)) toward = true;
        if (!toward && Math.sign(moved) === -want && Math.abs(moved) > E.hold.away * (moved > 0 ? hi - yS : yS - lo)) { left = true; away = true; break; }
      }
      const u = law.step(r, y);
      meters(u);
      st.room = roomUsed(y); st.roomMax = Math.max(st.roomMax, st.room);
      st.status = status;
      yield u;
    }
    // The try's tail: the candidate holds the reference's last value until
    // y has come to rest (settled at it, or stopped moving: a gentle loop
    // held off by friction creeps), at most settleMax, and the tail is
    // scored with the try, so the incumbent takes over at rest and the next
    // stage does not start from a moving y (an integrator with a lag ended a
    // try on its way back and left the band under the incumbent).
    let tail = null;
    if (!left) {
      const sp = test[N - 1], tol = tolerance(), need = Math.ceil(E.hold.settle / Ts - 1e-9), kEnd = k + Math.ceil(E.ease.settleMax / Ts - 1e-9);
      rFn = () => sp;
      let inside = 0;
      const iT = i;
      for (;;) {
        if (!inBand(y)) { left = true; break; }
        inside = Math.abs(y - sp) < tol ? inside + 1 : 0;
        if (inside >= need) { tail = true; break; }
        if (i - iT >= need) {
          let a = Infinity, b = -Infinity;
          for (let q = i - need; q <= i; q++) if (Number.isFinite(rec.y[q])) { a = Math.min(a, rec.y[q]); b = Math.max(b, rec.y[q]); }
          if (b - a <= tol) { tail = 'still'; break; }
        }
        if (k >= kEnd) { tail = false; break; }
        const u = law.step(r, y);
        meters(u);
        st.room = roomUsed(y); st.roomMax = Math.max(st.roomMax, st.room);
        st.status = `${status} (settling)`;
        yield u;
      }
    }
    const iE = i;
    // 4. A bumpless switch back to the incumbent; at once when y left the
    // band, with r ramping from where the try had it back to r(0).
    if (left) {
      ramp = { k0: k, k1: k + Math.max(1, Math.ceil(Math.min(E.ease.recover, 2 * (inc.tauC + gentle.theta)) / Ts - 1e-9)), from: r };
      recovering = { k, beyond: beyond(y), inside: 0 };
    }
    aim(r0);
    switchTo(inc.gains, 'incumbent', inc.lim);
    const T = { kind: 'try', n, tauC: g.tauC, Kp: g.Kp, Ki: g.Ki, umin: lim[0], umax: lim[1], push: provenIn(iS, iE), i0, iSwitch: iS, iEnd: iE, settled: settled === true, tail };
    if (left) return { ...T, left: true, away, g: E.ease.guardG, gRoom: E.ease.guardG, gRing: null, J: null };
    const rr = rec.r.slice(iS, iE), yy = rec.y.slice(iS, iE), uu = rec.u.slice(iS, iE);
    const cost = tryCost(rr, yy, uu, { R: test.span, U, lo: P.umin, hi: P.umax, per: N });
    const m = tryMargin(rr, yy, P.band, Math.max(3 * listenInfo.sigma, 2 * listenInfo.q));
    return { ...T, J: cost.J, parts: cost.parts, overshoot: cost.overshoot, ...m };
  }

  function* ease() {
    enter('ease');
    let tauC = inc.tauC, stale = 0, why = 'tries';
    const theta = gentle.theta;
    const reserve = E.pause.seconds + E.ease.settleMax + check.length * Ts;
    for (let n = 1; n <= E.ease.tries; n++) {
      tauC *= E.ease.quicker;
      if (tauC < E.ease.thetaShare * theta) { why = 'quick'; break; }
      // A try: the incumbent's settle, the reference, the candidate's tail.
      if (left() < 2 * E.ease.settleMax + test.length * Ts + reserve) { why = 'budget'; break; }
      const g = gentleGains(look, tauC, Ts);
      st.try = n;
      const T = yield* tryOnce(n, g);
      if (T.left && T.n === undefined) {
        // y left the band while the incumbent settled it: nothing proven holds.
        return endBand(`${names.y} left 'may move within' under the controller that held it: the page stopped the plant`);
      }
      const before = inc.J;
      let mark;
      if (T.left) mark = '✕ left the range, back to the last good one';
      else if (T.g < E.ease.gMin) mark = T.gRing < T.gRoom ? '! rang' : '! near the edge';
      else if (T.J < (1 - E.ease.better) * before) mark = '✓ quicker';
      else mark = '· no better';
      // Accepted only when it is quicker by the margin that counts, so the
      // mark and the incumbent agree (a try 1 % better read "· no better" and
      // could still become the controller the end message names).
      T.accepted = mark === '✓ quicker';
      if (T.accepted) { inc = { gains: g, tauC, J: T.J, n, lim: [T.umin, T.umax] }; proven = Math.max(proven, T.push); }
      T.mark = mark;
      st.tries.push(mark);
      st.room = T.left ? 1 : Math.max(0, 1 - T.gRoom);
      log(T);
      if (T.away) return finish('away', `the controller pushed ${names.y} the other way from where r asked (${yU(y)} at ${fmtNum(now(), 3)} s): the page stopped the plant; the pushes may have been read the wrong way round`);
      if (T.left) { why = 'guard'; break; }
      if (T.g < E.ease.gMin) { why = 'margin'; break; }
      stale = T.J < (1 - E.ease.better) * before ? 0 : stale + 1;
      if (stale >= E.ease.stale) { why = 'stale'; break; }
      if (n === E.ease.tries) why = 'tries';
    }
    log({ kind: 'ladder', why, incumbent: inc.n, tauC: inc.tauC, i });
    return null;
  }

  // ---- Fit pause: the incumbent holds y while the page fits.

  function* pause() {
    aim(r0);
    const i0 = i, kMin = k + Math.ceil(E.pause.seconds / Ts - 1e-9), kMax = k + Math.ceil(E.pause.wait / Ts - 1e-9);
    needs = { kind: 'fit', upto: i };
    supplied = null;
    for (;;) {
      if (!holds()) return endBand(`${names.y} left 'may move within' while the controller held it: the page stopped the plant`);
      if (supplied && k >= kMin) break;
      if (k >= kMax) { needs = null; return finish('fit', 'the page could not fit in time'); }
      const u = law.step(r, y);
      meters(u);
      st.status = `Fitting the model while the controller holds ${names.y} at ${yU(r0)}`;
      yield u;
    }
    log({ kind: 'pause', i0, i1: i, waited: (i - i0) * Ts });
    return null;
  }

  // ---- Check: the halved reference under the incumbent.

  function* runCheck() {
    enter('check');
    const status = 'Check: a test the model has not seen';
    const i0 = i;
    const s = yield* settle(check[0], E.ease.settleMax, status);
    if (s === 'left') return endBand(`${names.y} left 'may move within' before the Check: the page stopped the plant`);
    const iS = i, kS = k, N = check.length;
    rFn = (kk) => check[Math.min(N - 1, kk - kS)];
    while (k - kS < N) {
      if (!holds()) return endBand(`${names.y} left 'may move within' during the Check: the page stopped the plant`, { check: { i0, iStart: iS } });
      const u = law.step(r, y);
      meters(u);
      st.status = status;
      yield u;
    }
    log({ kind: 'check', i0, iStart: iS, iEnd: i });
    return null;
  }

  // ---- The whole test

  function* program() {
    yield* listen();
    if (st.done || stopping) return null;
    const L = listenInfo;
    if (!inBand(L.y0)) {
      return finish('outside', `${names.y} is at ${yU(L.y0)}, outside 'may move within': widen it, or bring the plant inside first`);
    }
    if (L.drifts) log({ kind: 'note', i, text: `${names.y} does not stay put with ${names.u} at ${uU(P.u0)} (it moves ${yU(Math.abs(L.drift))}/s)` });
    yield* nudge();
    if (st.done || stopping) return null;
    // The first look, during the rest that follows the Nudge.
    const seen = yield* firstLook();
    if (seen === 'runaway') return finish('runaway', `${names.y} runs away when pushed and does not come back: it needs a stabilising controller before it can be identified`);
    if (!look) return finish('none', `${names.u} does not move ${names.y}: is ${names.u} wired to the plant?`);
    // The references, now that the time scale is known.
    const tc0 = gentleTauC(look, Ts), th = look.theta + (look.integrating ? look.tau : 0) + Ts / 2;
    if (testR) {
      test = testR;
      check = P.check?.r ? P.check.r.slice() : halved(testR);
    } else {
      const hold = Math.max(2, Math.ceil((E.ease.hold * (tc0 + th)) / Ts));
      test = staircase(r0, P.band, E.ease.stair, hold);
      check = staircase(r0, P.band, E.check.stair, hold);
    }
    {
      let a = Infinity, b = -Infinity;
      for (const v of test) { a = Math.min(a, v); b = Math.max(b, v); }
      test.span = b - a > 1e-12 ? b - a : Math.max(Math.abs(r0), 1) * 1e-3;
    }
    log({ kind: 'references', i, test: test.length, check: check.length, staircase: !testR });
    // A time scale beyond ten times the whole test: what was pushed does
    // not come back within any test (an unstable plant read slowly, an
    // integrator twice over); it needs a controller that holds it first.
    const slowest = look.theta + look.tau;
    if (slowest > 10 * P.budget) {
      return finish('slow', `${names.y} does not come back after a push (its time scale reads ${fmtNum(slowest, 2)} s): it needs a controller that holds it before it can be identified`);
    }
    // Not one try fits the budget: the test ends after the first look. The
    // Hold may take two windows (τc doubled, or a creep given more time),
    // and a try is its settle, the reference and its tail.
    const holdMost = 4 * (tc0 + th) + E.hold.slack;
    const need = 2 * holdMost + 2 * E.ease.settleMax + test.length * Ts + E.pause.seconds + E.ease.settleMax + check.length * Ts;
    if (need > left()) {
      const fits = LENGTHS.find((b) => b >= now() + need);
      const advice = fits ? `Allow ${budgetText(fits)}.` : `Even ${budgetText(LENGTHS.at(-1))} is too short for it.`;
      return finish('budget', `${budgetText(P.budget)} is too short for this plant: the test so far took ${Math.round(now())} s, and one try needs about ${Math.round(need)} s more. ${advice}`);
    }
    yield* hold();
    if (st.done || stopping) return null;
    yield* ease();
    if (st.done || stopping) return null;
    yield* pause();
    if (st.done || stopping) return null;
    chips.shake = '–';
    yield* runCheck();
    if (st.done || stopping) return null;
    return finish('done', `Done: the plant is stopped; ${inc?.n ? `the gentlest controller that held, eased in, is try ${inc.n}` : 'the gentle controller held, and no try was quicker'}`);
  }

  const gen = program();

  // Stop (§5.8): the excitation ends; the incumbent (or the loop that runs)
  // brings y back to r(0) from wherever r is, by a ramp (no kick), and holds
  // it until settled, at most settleMax; then the plant's stop. Measured: an
  // arm held at 1.3 rad and dropped to 0 V at once swung to −0.45 rad. A test
  // that ends because y left the band under the incumbent ends the same way
  // (endBand): released at u₀ on its way out, an arm above the horizontal
  // flew over the top. Only y going further out still (a twentieth of the
  // band's span beyond where the stop began) ends it at once.
  let stopping = null;
  function* softStop(code = 'stopped', message = 'Stopped: the record so far is kept', extra = {}) {
    const status = `Stopping: the controller brings ${names.y} back to ${yU(r0)}, then the plant stops`;
    if (law) {
      if (inc && lawInfo?.role === 'try') switchTo(inc.gains, 'incumbent', inc.lim);
      ramp = { k0: k, k1: k + Math.max(1, Math.ceil(Math.min(E.ease.recover, 2 * ((inc?.tauC ?? gentle?.tauC ?? 0) + (gentle?.theta ?? 0))) / Ts - 1e-9)), from: r };
      recovering = null;
      log({ kind: 'stop', i, code });
      aim(r0);
      const tol = tolerance(), need = Math.ceil(E.hold.settle / Ts - 1e-9), kEnd = k + Math.ceil(E.ease.settleMax / Ts - 1e-9), b0 = beyond(y);
      let inside = 0;
      for (;;) {
        if (beyond(y) > b0 + E.ease.beyond * span) break;
        inside = Math.abs(y - r0) < tol ? inside + 1 : 0;
        if (inside >= need || k >= kEnd) break;
        const u = law.step(r, y);
        meters(u);
        st.status = status;
        yield u;
      }
    }
    finish(code, message, extra);
  }
  // The test ends with y out of the band under a loop that has a fallback.
  function endBand(message, extra = {}) {
    if (!law || !inc) return finish('band', message, extra);
    needs = null;
    stopping = softStop('band', message, extra);
    return null;
  }

  function stepOnce(kk, yy, applied) {
    if (st.done) return P.u0;
    if (!Number.isInteger(kk)) throw new Error('experiment: k must be a whole sample number');
    if (k !== null && kk <= k) throw new Error(`experiment: sample ${kk} came after ${k}`);
    if (k !== null && kk > k + 1) rec.gaps.push([i + 1, kk - k - 1]);
    if (k0 === null) k0 = kk;
    k = kk; i++;
    if (i >= 1 && Number.isFinite(applied)) rec.applied[i - 1] = applied;
    r = rFn(k);
    // A measurement that is not a number: u is held, as over a gap.
    if (!Number.isFinite(yy)) {
      rec.u.push(uLast); rec.y.push(NaN); rec.r.push(r); rec.applied.push(NaN);
      return uLast;
    }
    y = yy;
    st.t = now();
    let res = (stopping ?? gen).next();
    // The test just turned to its soft end: this sample is the stop's first.
    if (res.done && stopping && !st.done) res = stopping.next();
    const u = res.done || st.done ? P.u0 : res.value;
    rec.u.push(u); rec.y.push(y); rec.r.push(r); rec.applied.push(NaN);
    uLast = u;
    return u;
  }

  return {
    plan: P,
    step: stepOnce,
    reference(kk) { return st.done ? r : rFn(kk); },
    get needs() { return needs; },
    supply(kind, data = {}) {
      if (!needs || needs.kind !== kind) throw new Error(`experiment: nothing waits for ${kind}`);
      supplied = data;
      log({ kind: 'supply', what: kind, i, upto: needs.upto });
      needs = null;
    },
    stop() {
      if (st.done || stopping) return;
      if (!law) { finish('stopped', 'Stopped: the record so far is kept'); return; }
      needs = null;
      stopping = softStop();
    },
    abort(reason = 'the plant stopped itself') {
      if (st.done) return;
      finish('estop', `ended by the plant's stop at ${fmtNum(now(), 3)} s: ${reason}`);
    },
    get state() {
      return { ...st, chips: STAGES.map((s) => ({ stage: s, label: STAGE_LABELS[s], mark: chips[s] })), tries: st.tries.slice() };
    },
    get stopAsked() { return stopAsked; },
    // What the experiment found so far, for the tests and the page (computed,
    // never stored).
    get found() { return { listen: listenInfo, rungs: rungs.map(({ d, ...R }) => R), look, gentle, incumbent: inc, test, check }; },
    record() {
      return {
        version: IDENTIFY_VERSION, Ts,
        // Plain data, as Keep stores it: null where nothing was measured or
        // echoed, and −0 as 0 (JSON has no −0).
        u: rec.u.map(orNull), y: rec.y.map(orNull), r: rec.r.map(orNull), applied: rec.applied.map(orNull),
        gaps: rec.gaps.map((g) => g.slice()), log: rec.log.map((e) => cleanEntry(e)), end: endInfo ? endInfo.code : null,
      };
    },
  };
}

const orNull = (v) => (Number.isFinite(v) ? v + 0 : null);

// A log entry as data (no typed arrays: the rung's response is recomputed
// from the record).
function cleanEntry(e) {
  const { d, ...rest } = e;
  return JSON.parse(JSON.stringify(rest));
}

function checkPlan(p) {
  if (!p || p.version !== IDENTIFY_VERSION) throw new Error(`experiment: a plan of version ${IDENTIFY_VERSION} (from planExperiment)`);
  for (const key of ['Ts', 'u0', 'umin', 'umax', 'budget']) if (!Number.isFinite(p[key])) throw new Error(`experiment: plan.${key} must be a number`);
  if (!(p.Ts > 0)) throw new Error('experiment: plan.Ts must be positive');
  if (!(p.umax > p.umin)) throw new Error('experiment: plan.umax must be above plan.umin');
  if (!Array.isArray(p.band) || !(p.band[1] > p.band[0])) throw new Error('experiment: plan.band must be [lo, hi] with lo < hi');
  if (!p.test || !(Array.isArray(p.test.r) ? p.test.r.length >= 2 : Number.isFinite(p.test.r0))) throw new Error('experiment: plan.test needs r (samples) or r0 (a staircase)');
}
