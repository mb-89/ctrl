// Test fixtures (not shipped): plants for Identify's experiment, and a
// harness that runs the experiment on one as the page's runner will
// (design/output/identification.md §17).
//
// A plant: { Ts, output() → the y the page reads now, advance(u) → holds u
// over one sample, applied? (what it applied), estop? (it stopped itself),
// truth() → the noise-free y }.
//
//   transferPlant   a transfer function (lag, integrator, unstable) by fine
//                   RK4 with an exact dead time (continuous.mjs), with
//                   measurement noise, an encoder's step and a drift
//   unwired         a plant u does not reach: y is noise only
//   diagramPlant    a library system's plant through its own block diagram
//                   (oven, motor, tank): the Controller block is cut out, u
//                   enters where it drove, y is what fed its input 2, every
//                   other Source held as the plan says
//   swapped         a plant that becomes another one at a given sample

import { contSim } from './continuous.mjs';
import { gaussAt } from '../../src/core/signals.js';
import { compileDiagram, normalizeDiagram, parseEnd } from '../../src/core/diagram.js';
import { stepPlan } from '../../src/core/sim.js';
import { createExperiment } from '../../src/core/experiment.js';
import { normalizeProject } from '../../src/core/project.js';
import { SYSTEM_LIBRARY, applySystem } from '../../src/core/systems.js';
import { DEFAULT_PROJECT } from '../../src/core/examples.js';

const quant = (v, q) => (q > 0 ? q * Math.round(v / q) : v);

// num/den in s (highest power first) with dead time theta, at Ts. opts: noise
// (std), q (encoder step), drift (y units per second, added to the output),
// bias (added to u at the plant's input: an integrator drifts with it), y0
// (the output's level at rest), seed.
export function transferPlant({ num, den, theta = 0 }, Ts, { noise = 0, q = 0, drift = 0, bias = 0, y0 = 0, seed = 3 } = {}) {
  const cs = contSim(num, den, theta, Ts);
  let k = 0, last = 0;
  const truth = () => y0 + cs.output() + drift * k * Ts;
  return {
    Ts,
    truth,
    output() { return quant(truth() + (noise > 0 ? noise * gaussAt(seed, k) : 0), q); },
    advance(u) { last = u; cs.advance(u + bias); k++; return u; },
    get applied() { return last; },
  };
}

export const lag = (K = 2, tau = 0.5, theta = 0.05) => ({ num: [K], den: [tau, 1], theta });
export const integrator = (kp = 3, tau = 0.1, theta = 0.03) => ({ num: [kp], den: [tau, 1, 0], theta });
export const unstable = (K = 1, tau = 1, theta = 0) => ({ num: [K], den: [tau, -1], theta });

export function unwired(Ts, { noise = 0.01, seed = 5 } = {}) {
  let k = 0;
  return { Ts, truth: () => 0, output() { return noise * gaussAt(seed, k); }, advance(u) { k++; return u; } };
}

// A plant that is `a` until sample `at`, then `b` (each advanced only while it is in charge).
export function swapped(a, b, at) {
  let k = 0;
  const cur = () => (k < at ? a : b);
  return { Ts: a.Ts, truth: () => cur().truth(), output: () => cur().output(), advance(u) { const v = cur().advance(u); k++; return v; } };
}

// A library system as a project, the way the page loads it.
export function libraryProject(name) {
  const entry = SYSTEM_LIBRARY.find((s) => s.name.startsWith(name));
  if (!entry) throw new Error(`no library system ${name}`);
  return normalizeProject(applySystem(DEFAULT_PROJECT, entry, ['input', 'plant', 'controller']));
}

// The plant a Controller block (top level) drives, through the project's own
// diagram. hold: { name: value } for the Sources (the plan's others); noise,
// q, seed: on the measurement, as a sensor would add them.
export function diagramPlant(project, blockId = 'ctrl', { hold = {}, noise = 0, q = 0, seed = 11 } = {}) {
  const d = normalizeDiagram(structuredClone(project.system.plant.diagram));
  const ctrl = d.blocks.find((b) => b.id === blockId);
  const Ts = ctrl.params.Ts;
  const toCtrl = (w) => parseEnd(w.to).id === blockId;
  const meas = d.wires.find((w) => toCtrl(w) && parseEnd(w.to).port === 1);
  d.wires = d.wires.filter((w) => !toCtrl(w));
  // u enters where the block drove; y leaves from what fed its input 2.
  Object.assign(ctrl, { type: 'inport', params: { port: 1 } });
  delete ctrl.variants; delete ctrl.variant;
  d.blocks.push({ id: '__y', type: 'outport', params: { port: 1 }, x: 0, y: 0 });
  d.wires.push({ from: meas.from, to: '__y' });
  const sources = new Proxy({}, { get: (_, name) => () => hold[name] ?? 0 });
  const el = compileDiagram(d, 'plant', { sources });
  const { m } = stepPlan(Ts, el.bound, [], 1);
  const h = Ts / m, N = el.n;
  el.setStep(h);
  const X = new Float64Array(N), Xt = new Float64Array(N);
  const k1 = new Float64Array(N), k2 = new Float64Array(N), k3 = new Float64Array(N), k4 = new Float64Array(N);
  el.init(X, 0);
  let k = 0, u = 0, yNow = el.eval(0, X, 0, 0, null);
  el.record();
  const rk4 = (ts) => {
    el.eval(ts, X, 0, u, k1);
    for (let i = 0; i < N; i++) Xt[i] = X[i] + 0.5 * h * k1[i];
    el.eval(ts + 0.5 * h, Xt, 0, u, k2);
    for (let i = 0; i < N; i++) Xt[i] = X[i] + 0.5 * h * k2[i];
    el.eval(ts + 0.5 * h, Xt, 0, u, k3);
    for (let i = 0; i < N; i++) Xt[i] = X[i] + h * k3[i];
    el.eval(ts + h, Xt, 0, u, k4);
    for (let i = 0; i < N; i++) X[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  };
  return {
    Ts, warnings: el.warnings,
    truth: () => yNow,
    output() { return quant(yNow + (noise > 0 ? noise * gaussAt(seed, k) : 0), q); },
    advance(v) {
      u = v;
      for (let s = 0; s < m; s++) {
        const ts = k * Ts + s * h;
        rk4(ts);
        yNow = el.eval(ts + h, X, 0, u, null);
        el.record();
      }
      k++;
      return u;
    },
    // What the Sources play now (to show d is held).
    sources: (t) => Object.fromEntries(el.probes().filter(([n]) => !n.includes('.')).map(([n, v]) => [n, v])),
    probes: () => el.probes(),
  };
}

// Runs the experiment on a plant as the page's runner will: each sample the
// plant's y goes in, u comes out and is held over the sample; the fit is
// supplied at once when asked (Node supplies synchronously, §5.5); a plant
// that stops itself ends the test (abort). Returns { exp, record, truth, u, y,
// steps, plant }. onSample(k, exp, plant) may look at each sample.
export function runExperiment(plan, plant, { maxSeconds = plan.budget + 30, supply = () => ({}), onSample = null, applied = false, until = null } = {}) {
  const exp = createExperiment(plan);
  const K = Math.ceil(maxSeconds / plan.Ts);
  const truth = [];
  let k = 0;
  for (; k < K && !exp.state.done && !(until && until(exp)); k++) {
    const yv = plant.output();
    truth.push(plant.truth ? plant.truth() : plant.state?.angle);
    const u = exp.step(k, yv, applied && k > 0 ? plant.applied : undefined);
    if (exp.needs) exp.supply(exp.needs.kind, supply(exp));
    onSample?.(k, exp, plant);
    plant.advance(u);
    if (plant.estop && !exp.state.done) exp.abort(plant.estop);
  }
  return { exp, record: exp.record(), truth, steps: k, plant };
}
