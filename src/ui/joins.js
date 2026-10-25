// Mechanics on the Plant canvas (design/output/transparent-models.md §1.7):
// frame ports, the joins between them, and the edits a join gesture makes.
// Pure: the Plant tab (ui/plant.js) asks for geometry and SVG, and hands the
// level's diagram to the edits.

import { diagramBlockDef } from '../core/diagram.js';
import { parseFrame } from '../core/mech.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const isPartType = (type) => !!diagramBlockDef(type).part;

// A part's frame ports, small squares on its bottom edge: the base (B) on the
// left, the follower (F, T) on the right, a World's W and a Mass's F in the middle.
export function framePorts(b, w, h) {
  const frames = diagramBlockDef(b.type).frames?.(b.params) ?? [];
  const y = b.y + h;
  if (frames.length === 1) return [{ key: `${b.id}:${frames[0]}`, port: frames[0], x: b.x + w / 2, y }];
  return frames.map((port, i) => ({ key: `${b.id}:${port}`, port, x: (i === 0) === !b.flip ? b.x + 16 : b.x + w - 16, y }));
}

// Where each join's lines meet: below its lowest port, at the middle of its ports.
function hub(points) {
  const xs = points.map((p) => p.x);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.max(...points.map((p) => p.y)) + 18 };
}

// The joins as SVG: thick grey lines without arrowheads, down from each port
// and across to the hub; a dot where three ports or more meet. sel: the
// selected join's index.
export function joinsSvg(joins, portAt, sel) {
  return (joins ?? []).map((j, i) => {
    const pts = j.map(portAt).filter(Boolean);
    if (pts.length < 2) return '';
    const c = hub(pts);
    const d = pts.map((p) => `M${p.x.toFixed(1)},${p.y.toFixed(1)} V${c.y.toFixed(1)} H${c.x.toFixed(1)}`).join(' ');
    return `<g class="join${i === sel ? ' sel' : ''}" data-join="${i}"><title>${esc(j.join(' · '))}</title><path class="hit" d="${d}"/><path class="line" d="${d}"/>${pts.length > 2 ? `<circle class="jdot" data-join="${i}" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="4.5"/>` : ''}</g>`;
  }).join('');
}

export const framesSvg = (ports) => ports.map((p) => `<rect class="fport" data-frame="${esc(p.key)}" x="${p.x - 4.5}" y="${p.y - 4.5}" width="9" height="9"><title>${esc(p.port)}</title></rect>`).join('');

// The join gesture: from a frame port to another (a new join, or into the
// join the other is in, merging two joins) or onto a join's dot (index).
export function join(d, from, to) {
  d.joins ??= [];
  const of = (key) => d.joins.findIndex((j) => j.includes(key));
  const a = of(from), b = typeof to === 'number' ? to : of(to);
  if (typeof to !== 'number' && from === to) return false;
  if (a >= 0 && a === b) return false;
  if (a >= 0 && b >= 0) { d.joins[b].push(...d.joins[a]); d.joins.splice(a, 1); return true; }
  if (b >= 0) { d.joins[b].push(from); return true; }
  if (a >= 0) { d.joins[a].push(to); return true; }
  d.joins.push([from, to]);
  return true;
}

// Blocks deleted: their ports leave their joins; a join left with one port goes.
export function dropParts(d, ids) {
  if (!d.joins) return;
  d.joins = d.joins.map((j) => j.filter((key) => !ids.has(parseFrame(key).id))).filter((j) => j.length >= 2);
  if (!d.joins.length) delete d.joins;
}

// Group: a mechanism stays in one diagram. Returns the refusal's sentence,
// or the joins that move inside (every port selected) and those that stay.
export function splitJoins(d, sel) {
  const inside = [], outside = [];
  for (const j of d.joins ?? []) {
    const ids = [...new Set(j.map((key) => parseFrame(key).id))];
    const picked = ids.filter((id) => sel.has(id)), left = ids.filter((id) => !sel.has(id));
    const name = (id) => { const b = d.blocks.find((x) => x.id === id); return b?.name ?? id; };
    if (picked.length && left.length) {
      return { refusal: `${picked.map(name).join(' and ')} ${picked.length === 1 ? 'is' : 'are'} joined to ${left.map(name).join(' and ')}, which ${left.length === 1 ? 'is' : 'are'} not selected: a mechanism stays in one diagram (select all of it, or none of it)` };
    }
    (picked.length ? inside : outside).push(j);
  }
  return { inside, outside };
}

// A part's face: its one-line law, with its parameters as written.
export function partFace(b, v) {
  const p = b.params;
  switch (b.type) {
    case 'world': return `g ${v(p.g)} ↓`;
    case 'rail': return `${p.name}, ${p.rate} · ${p.force ? 'F − b·v' : '−b·v'}`;
    case 'hinge': return `${p.name} from upright${p.torque ? ' · τ' : ''}`;
    case 'mass': return `m ${v(p.m)}`;
    case 'rod': return `l ${v(p.l)}, m ${v(p.m)} ${p.at === 'uniform' ? 'uniform' : 'at tip'}`;
    default: return '';
  }
}
