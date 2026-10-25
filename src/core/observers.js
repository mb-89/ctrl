// The observer library: estimators an Observer block can run. An observer is
// built like a controller (design/output/controller-proposal.md): variants
// with one interface, run at the block's sample time, held in between.
//
//   inputs  [u, y1, y2, …]   the plant input first, then the measurements
//   outputs [x̂1, x̂2, …]     the estimated states
//
// make(params, Ts) returns { step(inputs) -> Float64Array of estimates }. At a
// sample, u is still the value applied over the interval that just ended (an
// Observer samples before the Controllers), so the estimate is predicted with
// it and then corrected with the new measurements.
//
// The Kalman filter is designed (design/output/designs.md, as the designed
// controllers): its model and gain are computed from the plant the Observer
// sees, and a file holds only Q and R. Copy as numbers turns it into a
// Luenberger observer with the same A, B, C and L, which runs the same.
// A plant the page cannot see (an External plant, Live mode) has no model to
// design with: there a Kalman filter takes the model you type in
// (kalmanModel), and the page computes its gain L from it, Q and R.

import { c2d, dlqe } from './linalg.js';
import { kalmanDesign, placedDesign } from './design.js';
import { normalizeVariant } from './controllers.js';

const num = (key, label, def, extra = {}) => ({ key, label, default: def, ...extra });
const vec = (key, label, def, extra = {}) => ({ key, label, default: def, kind: 'vector', ...extra });

// The model ẋ = A x + B u, y = C x, given row by row as flat lists; n from B.
function model(p) {
  const n = p.B.length, m = p.C.length / n;
  const A = Array.from({ length: n }, (_, i) => p.A.slice(i * n, i * n + n));
  const B = p.B.map((b) => [b]);
  const C = Array.from({ length: m }, (_, i) => p.C.slice(i * n, i * n + n));
  return { n, m, A, B, C };
}
const MODEL = [vec('A', 'Model A (rows)', [0, 1, 0, 0]), vec('B', 'Model B', [0, 1]), vec('C', 'Model C (rows)', [1, 0])];
function checkModel(p) {
  const n = p.B.length;
  if (p.A.length !== n * n) return `A needs n·n = ${n * n} values for n = ${n} states (the length of B)`;
  if (p.C.length % n) return `C needs a multiple of n = ${n} values, one row per measurement`;
  return '';
}

// Predict with the model, then correct with gain L (filter form):
// x̂ = x̂⁻ + L (y − C x̂⁻), every innovation taken from the prediction before
// any correction (the gain is designed for all measurements at once). The
// design (Ad, Bd, C, L) is redone when one of the parameter lists `keys` is
// replaced while running (Live mode edits the params object in place), and
// the estimate carries on unless the number of states changes.
function estimator(p, keys, design) {
  let d = null, seen = [], x, xp, e, out, first = true;
  const current = () => {
    if (d && keys.every((k, i) => p[k] === seen[i])) return d;
    seen = keys.map((k) => p[k]);
    const next = design();
    if (!d || next.n !== d.n) { x = new Float64Array(next.n); xp = new Float64Array(next.n); out = new Float64Array(next.n); first = true; }
    if (!d || next.m !== d.m) e = new Float64Array(next.m);
    d = next;
    return d;
  };
  current();
  return {
    step(inp) {
      const { n, m, Ad, Bd, C, L } = current();
      const u = inp[0] ?? 0;
      if (first) { first = false; } else {
        for (let i = 0; i < n; i++) { let s = Bd[i][0] * u; for (let j = 0; j < n; j++) s += Ad[i][j] * x[j]; xp[i] = s; }
        x.set(xp);
      }
      for (let k = 0; k < m; k++) {
        let s = inp[k + 1] ?? 0;
        for (let j = 0; j < n; j++) s -= C[k][j] * x[j];
        e[k] = s;
      }
      for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < m; k++) s += L[i][k] * e[k]; x[i] += s; }
      out.set(x);
      return out;
    },
  };
}

// The law of a designed observer without values (pending, or failed): zero estimates.
const NONE = new Float64Array(0);
const ZERO = { step: () => NONE };

export const OBSERVERS = {
  kalman: {
    // The steady-state Kalman filter on the plant this Observer sees, at its
    // origin (design.js, kalmanDesign): the estimates are the states it can
    // see, so a Controller designed on them looks through to the states.
    label: 'Kalman filter', summary: 'x̂ = prediction + L (y − C x̂), model and L from the plant',
    designed: true, version: 1, computes: ['A', 'B', 'C', 'L'], twin: 'luenberger',
    params: [
      vec('Q', 'Process noise Q', [1], { min: 0, help: 'one value: the variance of a random push on u, per sample; or one per state' }),
      vec('R', 'Measurement noise R', null, { nullable: true, per: 'measurement', empty: 'empty: from the sensor blocks', help: 'the variance of the noise on each measurement (one value: all); empty takes it from the noise and quantizer blocks on its way' }),
    ],
    check(p) { return p.R && !p.R.every((v) => v > 0) ? 'R: each above 0' : ''; },
    design(p, ctx) {
      const d = kalmanDesign(ctx.linearize('origin'), { Q: p.Q, R: p.R, Ts: ctx.Ts, outputs: ctx.outputs });
      return { values: d.values, rows: d.rows, warnings: d.warnings, quality: d.quality };
    },
    make(p, Ts, values) { return values ? OBSERVERS.luenberger.make(normalizeVariant(OBSERVERS.kalman.manual(p, values), 'variant', OBSERVERS).params, Ts) : ZERO; },
    manual: (p, values) => ({ type: 'luenberger', params: { A: [...values.A], B: [...values.B], C: [...values.C], L: [...values.L] } }),
    // A file from before the design layer typed its model in (A, B, C with Q
    // and R): it opens as the Kalman filter on that model.
    migrate: (v) => (['A', 'B', 'C'].some((k) => v.params?.[k] !== undefined) && v.params?.L === undefined ? { ...v, type: 'kalmanModel' } : v),
  },
  luenbergerPlaced: {
    // A Luenberger observer on the plant this Observer sees, as the Kalman
    // filter (the same model, the same filter form), but with L placed so
    // the estimate's error dies out at the rates you give (design.js,
    // placedDesign): fast poles follow the measurement and its noise, slow
    // ones trust the model. One measurement.
    label: 'Luenberger observer, placed poles', summary: 'x̂ = prediction + L (y − C x̂), model from the plant, L from the poles',
    designed: true, version: 1, computes: ['A', 'B', 'C', 'L'], twin: 'luenberger',
    params: [vec('w', 'Error poles at s = −w', [100], { unit: '1/s', help: 'how fast the estimate\'s error dies out: one value puts every pole there; or one per state' })],
    check(p) { return p.w.every((v) => v > 0) ? '' : 'w: each above 0'; },
    design(p, ctx) {
      const d = placedDesign(ctx.linearize('origin'), { w: p.w, Ts: ctx.Ts, outputs: ctx.outputs });
      return { values: d.values, rows: d.rows, warnings: d.warnings, quality: d.quality };
    },
    make(p, Ts, values) { return values ? OBSERVERS.luenberger.make(normalizeVariant(OBSERVERS.luenbergerPlaced.manual(p, values), 'variant', OBSERVERS).params, Ts) : ZERO; },
    manual: (p, values) => OBSERVERS.kalman.manual(p, values),
  },
  kalmanModel: {
    // The steady-state Kalman filter on a model you give (ẋ = A x + B u,
    // y = C x, row by row): the page discretises it at Ts and computes L by
    // the Riccati equation from the variances Q (per state) and R (per
    // measurement). For a plant the page cannot see; on one it can, the
    // Kalman filter from the plant computes the model too.
    label: 'Kalman filter, own model', summary: 'x̂ = model prediction + L (y − C x̂), L from your model, Q and R',
    params: [...MODEL, vec('Q', 'Process noise Q (diag)', [1, 1], { min: 0 }), vec('R', 'Measurement noise R (diag)', [1], { min: 0 })],
    check(p) { const bad = checkModel(p); if (bad) return bad; if (p.Q.length !== p.B.length) return 'Q needs one value per state'; if (p.R.length !== p.C.length / p.B.length) return 'R needs one value per measurement'; if (!p.R.every((v) => v > 0)) return 'R: each above 0'; return ''; },
    make(p, Ts) {
      return estimator(p, ['A', 'B', 'C', 'Q', 'R'], () => {
        const { n, m, A, B, C } = model(p);
        const { Ad, Bd } = c2d(A, B, Ts);
        const diag = (v) => v.map((x, i) => v.map((_, j) => (i === j ? x : 0)));
        const { L } = dlqe(Ad, C, diag(p.Q), diag(p.R));
        return { n, m, Ad, Bd, C, L };
      });
    },
  },
  luenberger: {
    label: 'Luenberger observer', summary: 'x̂ = model prediction + L (y − C x̂), L given',
    params: [...MODEL, vec('L', 'Gain L (rows)', [0.5, 10])],
    check(p) { const bad = checkModel(p); if (bad) return bad; if (p.L.length !== p.C.length) return 'L needs n × m values, row by row'; return ''; },
    make(p, Ts) {
      return estimator(p, ['A', 'B', 'C', 'L'], () => {
        const { n, m, A, B, C } = model(p);
        const { Ad, Bd } = c2d(A, B, Ts);
        const L = Array.from({ length: n }, (_, i) => p.L.slice(i * m, i * m + m));
        return { n, m, Ad, Bd, C, L };
      });
    },
  },
  difference: {
    // The naive estimate: each measurement and its rate by a filtered
    // finite difference. Outputs y1…ym, then ẏ1…ẏm.
    label: 'Finite difference', summary: 'x̂ = [y, Δy / Ts, filtered]',
    params: [num('Tf', 'Rate filter Tf', 0, { unit: 's', min: 0 })],
    make(p, Ts) {
      let prev = null, rate = null, out = null;
      return {
        step(inp) {
          const a = p.Tf > 0 ? Ts / (p.Tf + Ts) : 1;
          const y = Array.from(inp).slice(1);
          out ??= new Float64Array(2 * y.length);
          prev ??= y; rate ??= y.map(() => 0);
          rate = rate.map((r, i) => r + a * ((y[i] - prev[i]) / Ts - r));
          prev = y;
          out.set([...y, ...rate].slice(0, out.length));
          return out;
        },
      };
    },
  },
};

export const OBSERVER_TYPES = Object.keys(OBSERVERS);
