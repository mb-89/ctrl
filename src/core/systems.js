// The system library: complete systems (input signals, plant with its views,
// how the scope shows them and, once controllers exist, a controller and its
// parameters) that load whole or by part, so the input of one system can
// drive the plant of another. The systems are defined in plants.js.

import { EXAMPLE_PLANTS } from './plants.js';
import { CONTROLLERS } from './controllers.js';

export const SYSTEM_PARTS = ['input', 'plant', 'controller'];

function fromPlant(e) {
  return {
    name: e.name, notes: e.notes ?? '',
    input: { signals: structuredClone(e.signals) },
    plant: { type: 'diagram', diagram: structuredClone(e.diagram), ...(e.views ? { views: structuredClone(e.views) } : {}) },
    ...(e.scope ? { scope: structuredClone(e.scope) } : {}),
    ...(e.ui ? { ui: structuredClone(e.ui) } : {}),
    tags: systemTags(e),
  };
}

// What a system shows, as tags for the library overview (the person,
// 2026-10-24: "is it linear, non-linear, what kind of controllers, has it
// observers, what are the features"). Derived from the system itself, plus
// any the entry adds by hand ({ label, kind }). kind picks the colour:
// plant, controller, observer, signal, feature.
const NONLINEAR = new Set(['cartPole', 'pendulumCart', 'conicalTank', 'saturation', 'quantizer', 'fcn', 'switch']);
// A type's tags; a function reads the variant (a PI from the plant at one
// level is a plain PI, at several it is scheduled).
const VARIANT_TAGS = {
  pid: 'PID', stateFeedback: 'State feedback', gainScheduled: 'Gain scheduling', swingUp: 'Lyapunov swing-up', trajectory: 'Trajectory planning', lqr: 'LQR', kalman: 'Kalman filter', luenberger: 'Luenberger observer',
  scheduledPI: (v) => (v.params?.at?.length > 1 ? 'Gain scheduling' : 'PI'), swingUpLqr: ['Lyapunov swing-up', 'LQR'],
};
const variantTags = (v, fallback) => { const t = VARIANT_TAGS[v.type]; return [].concat(typeof t === 'function' ? t(v) : t ?? fallback); };
export function systemTags(e) {
  const blocks = [];
  let nonlinear = false;
  const walk = (d) => {
    for (const b of d.blocks) {
      blocks.push(b);
      if (b.diagram) walk(b.diagram);
      // A Function block that only feeds Sinks (an energy shown on the
      // scope, say) leaves the dynamics linear.
      const onlyDisplays = d.wires.filter((w) => w.from.split(':')[0] === b.id).every((w) => ['sink', 'terminator'].includes(d.blocks.find((x) => x.id === w.to.split(':')[0])?.type));
      if (NONLINEAR.has(b.type) && !(b.type === 'fcn' && onlyDisplays)) nonlinear = true;
    }
  };
  walk(e.diagram);
  const tags = [];
  const add = (label, kind) => { if (!tags.some((t) => t.label === label)) tags.push({ label, kind }); };
  add(nonlinear ? 'Nonlinear' : 'Linear', 'plant');
  if (blocks.some((b) => b.type === 'delay')) add('Dead time', 'plant');
  if (blocks.some((b) => b.type === 'external')) add('HIL', 'feature');
  const ctrls = blocks.filter((b) => b.type === 'controller'), obs = blocks.filter((b) => b.type === 'observer');
  if (!ctrls.length) add('No controller', 'controller');
  for (const b of ctrls) for (const v of b.variants ?? []) if (v.type !== 'off') for (const t of variantTags(v, CONTROLLERS[v.type]?.label ?? v.type)) add(t, 'controller');
  for (const b of obs) for (const v of b.variants ?? []) for (const t of variantTags(v, 'Observer')) add(t, 'observer');
  if (blocks.some((b) => b.type === 'source' && b.params.signal === 'd')) add('Disturbance', 'signal');
  if (e.scope?.view?.mode) add(e.scope.view.mode === 'fft' ? 'FFT' : 'Spectrogram', 'feature');
  if (e.ui?.tab === 'tune') add('Auto-tune', 'feature');
  for (const t of e.tags ?? []) add(t.label, t.kind ?? 'feature');
  return tags;
}

export const SYSTEM_LIBRARY = EXAMPLE_PLANTS.map(fromPlant);

// Copies the chosen parts of a library entry into a raw project (before
// normalisation). parts: any of 'input', 'plant', 'controller'. A whole load
// also takes the system's title, its scope setup and how it opens (ui).
export function applySystem(project, entry, parts) {
  const p = structuredClone(project);
  p.system ??= {};
  if (parts.includes('input') && entry.input) {
    // Keep signals the current plant still plays; take the system's for the rest.
    p.system.signals = { ...(p.system.signals ?? {}), ...structuredClone(entry.input.signals) };
  }
  if (parts.includes('plant') && entry.plant) p.system.plant = structuredClone(entry.plant);
  if (parts.includes('controller') && entry.controller) {
    const c = structuredClone(entry.controller);
    Object.assign(p, { candidates: c.candidates, goal: c.goal, sim: c.sim });
  }
  const whole = SYSTEM_PARTS.filter((k) => entry[k]).every((k) => parts.includes(k));
  if (whole) {
    p.title = entry.name;
    // A whole system brings its controller, or none: candidates an older
    // project carried do not stay behind.
    if (!entry.controller) { p.candidates = []; delete p.selected; delete p.goal; p.sim = {}; }
    if (entry.scope) {
      p.scope = { ...(p.scope ?? {}), channels: structuredClone(entry.scope.channels) };
      if (entry.scope.view) p.scope.view = structuredClone(entry.scope.view); else delete p.scope.view;
    }
    if (entry.ui) p.ui = structuredClone(entry.ui);
  }
  delete p.system.reference;
  return p;
}
