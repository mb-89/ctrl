// The system library: complete systems (input signals, plant, controller and
// its parameters) that load whole or by part, so the input of one system can
// drive the plant of another. Built from the example plants (no controller
// yet) and the closed-loop examples (plant with a tuned controller).

import { EXAMPLE_PLANTS } from './plants.js';
import { EXAMPLES } from './examples.js';
import { normalizeProject, LOOP_CHANNELS } from './project.js';

const STEP = { r: { period: 1, components: [{ type: 'step', params: { amplitude: 1, time: 0.1 } }] } };

export const SYSTEM_PARTS = ['input', 'plant', 'controller'];

function fromPlant(e) {
  return {
    name: e.name, notes: e.notes ?? '',
    input: { signals: structuredClone(e.signals ?? STEP) },
    plant: { type: 'diagram', diagram: structuredClone(e.diagram), ...(e.views ? { views: structuredClone(e.views) } : {}) },
  };
}

function fromLoop(ex) {
  const p = normalizeProject(structuredClone(ex));
  return {
    name: `${p.title} (closed loop)`, notes: p.notes ?? '',
    input: { signals: p.system.signals },
    plant: p.system.plant,
    controller: {
      candidates: p.candidates, goal: p.goal, sim: p.sim, selected: p.selected,
      actuator: p.system.actuator, sensor: p.system.sensor, disturbance: p.system.disturbance, noise: p.system.noise,
    },
  };
}

export const SYSTEM_LIBRARY = [...EXAMPLE_PLANTS.map(fromPlant), ...EXAMPLES.map(fromLoop)];

// Copies the chosen parts of a library entry into a raw project (before
// normalisation). parts: any of 'input', 'plant', 'controller'.
export function applySystem(project, entry, parts) {
  const p = structuredClone(project);
  p.system ??= {};
  if (parts.includes('input') && entry.input) p.system.signals = structuredClone(entry.input.signals);
  if (parts.includes('plant') && entry.plant) p.system.plant = structuredClone(entry.plant);
  if (parts.includes('controller') && entry.controller) {
    const c = structuredClone(entry.controller);
    Object.assign(p, { candidates: c.candidates, goal: c.goal, sim: c.sim });
    if (c.selected) p.selected = c.selected; else delete p.selected;
    for (const k of ['actuator', 'sensor', 'disturbance', 'noise']) p.system[k] = c[k];
    // A closed loop shows its own signals: r, y, u, e.
    if (p.scope?.channels) p.scope.channels.forEach((ch, i) => { ch.source = LOOP_CHANNELS[i]; ch.on = true; });
  }
  if (SYSTEM_PARTS.filter((k) => entry[k]).every((k) => parts.includes(k))) p.title = entry.name;
  delete p.system.reference;
  return p;
}
