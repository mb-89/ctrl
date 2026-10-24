// Response metrics. Step metrics are measured on the first reference step, in
// the window up to the next reference change or disturbance onset. Integral
// metrics cover the whole run; ITAE weights the error by the time since the
// latest event (reference change or disturbance), so it generalises to square
// waves and load steps.

export const METRICS = [
  { key: 'riseTime', label: 'Rise time', short: 'Rise', unit: 's', desc: '10 % → 90 % of the first reference step' },
  { key: 'overshoot', label: 'Overshoot', short: 'OS', unit: '%', desc: 'peak beyond the new setpoint, % of the step', scale: 1 },
  { key: 'undershoot', label: 'Undershoot', short: 'US', unit: '%', desc: 'initial move in the wrong direction, % of the step', scale: 1 },
  { key: 'settlingTime', label: 'Settling time', short: 'Settle', unit: 's', desc: 'time after the step until y stays inside the settling band' },
  { key: 'peakTime', label: 'Peak time', short: 'Peak', unit: 's', desc: 'time after the step to the largest output' },
  { key: 'steadyStateError', label: 'Steady-state error', short: 'SSE', unit: '%', desc: 'remaining error at the end of the step window, % of the step', scale: 1 },
  { key: 'iae', label: 'IAE', short: 'IAE', unit: '', desc: '∫|e| dt over the run' },
  { key: 'ise', label: 'ISE', short: 'ISE', unit: '', desc: '∫e² dt over the run' },
  { key: 'itae', label: 'ITAE', short: 'ITAE', unit: '', desc: '∫ (t − t_event)|e| dt: penalises slow, lingering error' },
  { key: 'uPeak', label: 'Peak effort', short: 'u pk', unit: '', desc: 'max |u| applied to the actuator' },
  { key: 'uTV', label: 'Effort variation', short: 'u TV', unit: '', desc: 'Σ|Δu|, total variation of u: low means smooth' },
  { key: 'uEnergy', label: 'Effort energy', short: '∫u²', unit: '', desc: '∫u² dt' },
  { key: 'saturation', label: 'Time saturated', short: 'Sat', unit: '%', desc: 'share of samples where the actuator limits u', scale: 1 },
  { key: 'distPeak', label: 'Disturbance peak', short: 'd pk', unit: '', desc: 'max |r − y| after the disturbance starts' },
  { key: 'distIAE', label: 'Disturbance IAE', short: 'd IAE', unit: '', desc: '∫|e| dt after the disturbance starts' },
];

export const METRIC = Object.fromEntries(METRICS.map((m) => [m.key, m]));

// Indices where x jumps. The loop starts at rest, so the value before t = 0 is 0.
function jumps(x, rel) {
  let lo = 0, hi = 0;
  for (const v of x) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const range = hi - lo;
  const out = [];
  if (!(range > 0)) return out;
  for (let k = 0; k < x.length; k++) if (Math.abs(x[k] - (k ? x[k - 1] : 0)) > rel * range) out.push(k);
  return out;
}

export function computeMetrics(res, opts = {}) {
  const band = opts.settlingBand ?? 0.02;
  const { t, r, y, u, v, e, d } = res;
  const K = t.length - 1;
  const m = Object.fromEntries(METRICS.map((x) => [x.key, NaN]));
  const events = { step: null, disturbance: null };
  if (res.info.unstable) {
    for (const k in m) m[k] = Infinity;
    // blowup: share of the run completed before the output diverged.
    return { ...m, unstable: true, blowup: res.info.blowup, events };
  }
  const dt = K > 0 ? t[1] - t[0] : 0;

  const refJumps = jumps(r, 0.01);
  let distJumps = [];
  const kdOnset = d.findIndex((x) => Math.abs(x) > 1e-12);
  if (kdOnset >= 0) distJumps = [...new Set([kdOnset, ...jumps(d, 0.01)])].sort((a, b) => a - b);
  const allEvents = [...new Set([...refJumps, ...distJumps])].sort((a, b) => a - b);
  const nextEvent = (k) => allEvents.find((j) => j > k) ?? K + 1;

  // Step metrics
  if (refJumps.length) {
    const ks = refJumps[0];
    const kend = nextEvent(ks);
    const r0 = ks ? r[ks - 1] : 0, r1 = r[ks], D = r1 - r0, ts = t[ks];
    events.step = { time: ts, from: r0, to: r1, end: t[Math.min(kend, K)] };
    const yn = (k) => (y[k] - r0) / D;
    const cross = (level) => {
      for (let k = ks; k < kend; k++) {
        if (yn(k) >= level) {
          if (k === ks) return t[k];
          const a = yn(k - 1), b = yn(k);
          return t[k - 1] + (dt * (level - a)) / (b - a);
        }
      }
      return Infinity;
    };
    const t10 = cross(0.1), t90 = cross(0.9);
    m.riseTime = t90 - t10;
    let ymax = -Infinity, ymin = Infinity, kmax = ks;
    for (let k = ks; k < kend; k++) {
      const q = yn(k);
      if (q > ymax) { ymax = q; kmax = k; }
      if (q < ymin) ymin = q;
    }
    m.overshoot = Math.max(0, ymax - 1) * 100;
    m.undershoot = Math.max(0, -ymin) * 100;
    m.peakTime = t[kmax] - ts;
    let last = -1;
    for (let k = kend - 1; k >= ks; k--) if (Math.abs(yn(k) - 1) > band) { last = k; break; }
    if (last < 0) m.settlingTime = 0;
    else if (last >= kend - 1) m.settlingTime = Infinity;
    else {
      const a = Math.abs(yn(last) - 1) - band, b = Math.abs(yn(last + 1) - 1) - band;
      m.settlingTime = t[last] + (dt * a) / (a - b) - ts;
    }
    const tail = Math.max(1, Math.round((kend - ks) * 0.05));
    let s = 0;
    for (let k = kend - tail; k < kend; k++) s += Math.abs(yn(k) - 1);
    m.steadyStateError = (s / tail) * 100;
  }

  // Integral metrics
  let iae = 0, ise = 0, itae = 0, tEvent = 0, ei = 0;
  for (let k = 0; k <= K; k++) {
    if (ei < allEvents.length && allEvents[ei] === k) { tEvent = t[k]; ei++; }
    const a = Math.abs(e[k]);
    iae += a * dt; ise += a * a * dt; itae += (t[k] - tEvent) * a * dt;
  }
  m.iae = iae; m.ise = ise; m.itae = itae;

  // Effort
  let uPeak = 0, uTV = Math.abs(u[0]), uEnergy = 0, sat = 0;
  for (let k = 0; k <= K; k++) {
    uPeak = Math.max(uPeak, Math.abs(u[k]));
    if (k > 0) uTV += Math.abs(u[k] - u[k - 1]);
    uEnergy += u[k] * u[k] * dt;
    if (Math.abs(v[k] - u[k]) > 1e-12) sat++;
  }
  m.uPeak = uPeak; m.uTV = uTV; m.uEnergy = uEnergy; m.saturation = (sat / (K + 1)) * 100;

  // Disturbance rejection
  if (distJumps.length) {
    const kd = distJumps[0];
    const kend = nextEvent(kd);
    events.disturbance = { time: t[kd], end: t[Math.min(kend, K)] };
    let pk = 0, ia = 0;
    for (let k = kd; k < kend; k++) { pk = Math.max(pk, Math.abs(e[k])); ia += Math.abs(e[k]) * dt; }
    m.distPeak = pk; m.distIAE = ia;
  }
  return { ...m, unstable: false, events };
}
