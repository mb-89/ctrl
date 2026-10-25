// The system library: complete systems (input signals, plant with its views,
// how the scope shows them and, once controllers exist, a controller and its
// parameters) that load whole or by part, so the input of one system can
// drive the plant of another. The systems are defined in plants.js.

import { EXAMPLE_PLANTS } from './plants.js';
import { CONTROLLERS } from './controllers.js';

export const SYSTEM_PARTS = ['input', 'plant', 'controller'];

function fromPlant(e) {
  return {
    // Two levels (progressive disclosure): the summary is the bottom line the
    // library shows; the notes are the full description, one click away.
    name: e.name, summary: e.summary ?? '', notes: e.notes ?? '',
    input: { signals: structuredClone(e.signals) },
    plant: { type: 'diagram', diagram: structuredClone(e.diagram), ...(e.views ? { views: structuredClone(e.views) } : {}) },
    ...(e.scope ? { scope: structuredClone(e.scope) } : {}),
    ...(e.ui ? { ui: structuredClone(e.ui) } : {}),
    // Its record step, when the system needs its own (sim.sampleTime).
    ...(e.sim ? { sim: structuredClone(e.sim) } : {}),
    tags: systemTags(e),
  };
}

// What a system shows, as tags for the library overview (the person,
// 2026-10-24: "is it linear, non-linear, what kind of controllers, has it
// observers, what are the features"). Derived from the system itself, plus
// any the entry adds by hand ({ label, kind }).
//
// Values that differ look different at a glance (the person, same day): the
// kind sets the chip's style (plant: filled; controller: a coloured bar;
// observer: an outline; feature: a dot; none: an empty dashed chip) and each
// value has its own tone, the same on every card. The opposites Linear and
// Nonlinear take the warm and cool poles. Tones are the eight slots of a
// palette validated for colour-vision deficiency; the label is always shown.
// A tone is not shared with a tag a value appears beside, nor by two values
// of one kind in the filter row: Disturbance is slate (red is Nonlinear,
// beside it on three cards), so XY moved to yellow. No tone is violet: in the
// page violet means selected (design/output/design-system.md).
const NONLINEAR = new Set(['cartPole', 'pendulumCart', 'conicalTank', 'saturation', 'quantizer', 'fcn', 'switch']);
// A type's tags; a function reads the variant (a PI from the plant at one
// level is a plain PI, at several it is scheduled).
const VARIANT_TAGS = {
  pid: 'PID', pidFF: 'PID', stateFeedback: 'State feedback', gainScheduled: 'Gain scheduling', swingUp: 'Lyapunov swing-up', trajectory: 'Trajectory planning', lqr: 'LQR', relay: 'Relay', slidingMode: 'Sliding mode', superTwisting: 'Sliding mode', kalman: 'Kalman filter', kalmanModel: 'Kalman filter', luenberger: 'Luenberger observer', luenbergerPlaced: 'Luenberger observer', difference: 'Finite difference',
  scheduledPI: (v) => (v.params?.at?.length > 1 ? 'Gain scheduling' : 'PID'), swingUpLqr: ['Lyapunov swing-up', 'LQR'],
};
const variantTags = (v, fallback) => { const t = VARIANT_TAGS[v.type]; return [].concat(typeof t === 'function' ? t(v) : t ?? fallback); };
export const TAG_TONES = ['blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'slate', 'red'];
const TONE = {
  Linear: 'blue', Nonlinear: 'red', 'Dead time': 'magenta', 'Black box': 'yellow',
  // LQR sits beside Disturbance (slate) on both pendulums, so it took State
  // feedback's orange, and State feedback, on no card with a disturbance
  // now that the library's gains are computed, took slate.
  PID: 'aqua', 'State feedback': 'slate', 'Gain scheduling': 'yellow', 'Lyapunov swing-up': 'magenta', LQR: 'orange', 'Trajectory planning': 'green', Relay: 'blue',
  // Seven of the eight tones are taken by controller tags: this one is set.
  'Sliding mode': 'red',
  // The observers sit together on one card, beside PID (aqua) and
  // Disturbance (slate): Luenberger took blue, the Kalman filter green.
  'Kalman filter': 'green', 'Luenberger observer': 'blue', 'Finite difference': 'orange',
  Disturbance: 'slate', FFT: 'blue', Spectrogram: 'magenta', XY: 'yellow', 'Auto-tune': 'green', HIL: 'orange',
  'Reference mode': 'aqua', 'Controller in the plant': 'green',
};
// A value without its own tone gets one from its label, so it stays put.
const toneOf = (label) => TONE[label] ?? TAG_TONES[[...label].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TAG_TONES.length];
export function systemTags(e) {
  const blocks = [];
  let nonlinear = false;
  const walk = (d) => {
    for (const b of d.blocks) {
      blocks.push(b);
      if (b.diagram) walk(b.diagram);
      // An Equations block that only feeds Sinks (an energy shown on the
      // scope, say) leaves the dynamics linear.
      const onlyDisplays = d.wires.filter((w) => w.from.split(':')[0] === b.id).every((w) => ['sink', 'terminator'].includes(d.blocks.find((x) => x.id === w.to.split(':')[0])?.type));
      if (NONLINEAR.has(b.type) && !(b.type === 'fcn' && onlyDisplays)) nonlinear = true;
      // An Integrator with a limit (a tank's brim and bottom) is nonlinear.
      if (b.type === 'integrator' && [b.params?.min, b.params?.max].some((v) => v !== null && v !== undefined && !/^\s*[-+]?inf\s*$/i.test(String(v)))) nonlinear = true;
    }
  };
  walk(e.diagram);
  const tags = [];
  const add = (label, kind) => { if (!tags.some((t) => t.label === label)) tags.push({ label, kind, tone: toneOf(label) }); };
  // An External plant is outside the page, a black box until identified
  // (input 20): its entry may say more, the diagram cannot.
  const external = blocks.some((b) => b.type === 'external');
  const own = external ? (e.tags ?? []).filter((t) => t.kind === 'plant') : [];
  if (own.length) for (const t of own) add(t.label, 'plant'); else add(external ? 'Black box' : nonlinear ? 'Nonlinear' : 'Linear', 'plant');
  if (blocks.some((b) => b.type === 'delay')) add('Dead time', 'plant');
  if (blocks.some((b) => b.type === 'external')) add('HIL', 'feature');
  const ctrls = blocks.filter((b) => b.type === 'controller'), obs = blocks.filter((b) => b.type === 'observer');
  // In reference mode the plant runs its own controller: none in the page.
  const ownLoop = blocks.some((b) => b.type === 'external' && (b.params?.kinds ?? []).includes('reference'));
  if (!ctrls.length) add(ownLoop ? 'Controller in the plant' : 'No controller', 'none');
  for (const b of ctrls) for (const v of b.variants ?? []) if (v.type !== 'off') for (const t of variantTags(v, CONTROLLERS[v.type]?.label ?? v.type)) add(t, 'controller');
  for (const b of obs) for (const v of b.variants ?? []) for (const t of variantTags(v, 'Observer')) add(t, 'observer');
  // A disturbance only when d plays something: a Source d whose signal has
  // no components stays at 0 (Following a sine keeps one for the person to fill).
  const plays = (name) => !e.signals || (e.signals[name]?.components?.length ?? 0) > 0;
  if (blocks.some((b) => b.type === 'source' && b.params.signal === 'd') && plays('d')) add('Disturbance', 'feature');
  if (e.scope?.view?.mode) add({ fft: 'FFT', spectrogram: 'Spectrogram', xy: 'XY' }[e.scope.view.mode], 'feature');
  if (e.ui?.tab === 'tune') add('Auto-tune', 'feature');
  for (const t of e.tags ?? []) add(t.label, t.kind ?? 'feature');
  return tags;
}

export const SYSTEM_LIBRARY = EXAMPLE_PLANTS.map(fromPlant);

// Every tag the library uses, once, grouped by what it is about (plant,
// controller, observer, feature) in the order the systems show them.
const KIND_ORDER = ['plant', 'none', 'controller', 'observer', 'feature'];
export function libraryTags(library = SYSTEM_LIBRARY) {
  const seen = new Map();
  for (const e of library) for (const t of e.tags) if (!seen.has(t.label)) seen.set(t.label, t);
  return [...seen.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}
// The systems that carry every one of the given tags (no tags: all).
export const filterByTags = (labels, library = SYSTEM_LIBRARY) => library.map((e, i) => i).filter((i) => labels.every((l) => library[i].tags.some((t) => t.label === l)));

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
    // Its full description comes along, so the Plant tab can show it.
    if (entry.notes) p.notes = entry.notes; else delete p.notes;
    // A whole system brings its controller, or none: candidates an older
    // project carried do not stay behind.
    // Its record step comes along (a library entry may carry sim.sampleTime);
    // without one the scope's default applies.
    if (!entry.controller) { p.candidates = []; delete p.selected; delete p.goal; p.sim = entry.sim ? structuredClone(entry.sim) : {}; }
    if (entry.scope) {
      p.scope = { ...(p.scope ?? {}), channels: structuredClone(entry.scope.channels) };
      if (entry.scope.view) p.scope.view = structuredClone(entry.scope.view); else delete p.scope.view;
    }
    if (entry.ui) p.ui = structuredClone(entry.ui);
  }
  delete p.system.reference;
  return p;
}
