// The system library: complete systems (input signals, plant with its views,
// how the scope shows them and, once controllers exist, a controller and its
// parameters) that load whole or by part, so the input of one system can
// drive the plant of another. The systems are defined in plants.js.

import { EXAMPLE_PLANTS } from './plants.js';

export const SYSTEM_PARTS = ['input', 'plant', 'controller'];

function fromPlant(e) {
  return {
    name: e.name, notes: e.notes ?? '',
    input: { signals: structuredClone(e.signals) },
    plant: { type: 'diagram', diagram: structuredClone(e.diagram), ...(e.views ? { views: structuredClone(e.views) } : {}) },
    ...(e.scope ? { scope: structuredClone(e.scope) } : {}),
    ...(e.ui ? { ui: structuredClone(e.ui) } : {}),
  };
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
    if (entry.scope) p.scope = { ...(p.scope ?? {}), channels: structuredClone(entry.scope.channels) };
    if (entry.ui) p.ui = structuredClone(entry.ui);
  }
  delete p.system.reference;
  return p;
}
