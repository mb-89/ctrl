// The Controller tab's small diagram of what the running variant does: draws
// the description from src/core/structure.js as inline SVG, styled by the
// theme's colours (style.css, ".cdg"). It is redrawn with the tab, so it
// follows every parameter change.

import { describeVariant } from '../core/structure.js';
import { normalizeVariant } from '../core/controllers.js';

const CH = 6;       // px per character at the diagram's 10 px monospace
const LINE = 11;    // px between the lines of a block

// Draws the running variant of a Controller or Observer block into el.
// lib: the block's library; names: what feeds each input; values: what a
// designed variant's design computed (its status's values), if it has any.
export function drawStructure(el, block, lib, names, values = null) {
  const v = block.variants[block.variant ?? 0];
  let d = null;
  try { d = describeVariant(normalizeVariant(v, 'variant', lib), { inputs: names, Ts: block.params.Ts, def: lib[v.type], values }); } catch { d = null; }
  if (!d) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const svg = structureSvg(d);
  el.innerHTML = `<figcaption><h4 class="glabel">What it does</h4><span>faint: 0 or off · click to enlarge</span></figcaption>${svg}`;
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', `What ${v.name} does: a diagram; click to enlarge`);
  el.onclick = () => enlarge(svg, v.name);
  el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); enlarge(svg, v.name); } };
}

// The same diagram, large, over the page; a click or Esc closes it.
let big = null;
function enlarge(svg, name) {
  if (!big) {
    big = document.createElement('div');
    big.className = 'ctdiag-big';
    big.hidden = true;
    document.body.append(big);
    big.addEventListener('click', () => { big.hidden = true; });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !big.hidden) { big.hidden = true; e.stopImmediatePropagation(); } }, true);
  }
  big.innerHTML = `<figure><figcaption><b>${esc(name)}</b> · what it does</figcaption>${svg}<figcaption>Hover a block for what it is. Click or Esc to close.</figcaption></figure>`;
  big.hidden = false;
}

export function structureSvg(d) {
  const out = [];
  const wire = (w, halo) => {
    const pts = w.pts.map(([x, y]) => `${x},${y}`).join(' ');
    let s = halo ? `<polyline class="halo" points="${pts}"/>` : '';
    s += `<polyline class="w${w.dashed ? ' d' : ''}${w.dotted ? ' o' : ''}" points="${pts}"/>`;
    if (w.arrow !== false) s += arrow(w.pts);
    return group(s, w.faint, w.tip);
  };
  for (const w of d.wires) if (!w.over) out.push(wire(w, false));
  for (const w of d.wires) if (w.over) out.push(wire(w, true));
  for (const n of d.nodes) out.push(group(NODE[n.kind](n), n.faint, n.tip));
  return `<svg class="cdg" viewBox="0 0 ${d.w} ${d.h}" width="${d.w}" height="${d.h}" role="img" aria-label="${esc(`Diagram: ${d.title}`)}">${out.join('')}</svg>`;
}

const group = (s, faint, tip) => (faint || tip ? `<g${faint ? ' class="f"' : ''}>${tip ? `<title>${esc(tip)}</title>` : ''}${s}</g>` : s);

// An arrowhead at the end of a polyline.
function arrow(pts) {
  const [x1, y1] = pts.at(-1), [x0, y0] = pts.at(-2);
  const L = Math.hypot(x1 - x0, y1 - y0) || 1, ux = (x1 - x0) / L, uy = (y1 - y0) / L;
  const bx = x1 - 5 * ux, by = y1 - 5 * uy;
  return `<polygon class="ah" points="${x1},${y1} ${bx - 2.6 * uy},${by + 2.6 * ux} ${bx + 2.6 * uy},${by - 2.6 * ux}"/>`;
}

// One line of text segments, squeezed to fit when it is wider than room.
function text(x, y, segs, room, anchor = 'middle', cls = 't') {
  const chars = segs.reduce((s, [t]) => s + [...t].length, 0);
  const fit = room && chars * CH > room ? ` textLength="${room}" lengthAdjust="spacingAndGlyphs"` : '';
  return `<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="central"${fit} xml:space="preserve">${segs.map(([t, c]) => `<tspan${c ? ` class="${c}"` : ''}>${esc(t)}</tspan>`).join('')}</text>`;
}

const NODE = {
  block(n) {
    const lines = n.lines.map((segs, i) => text(n.x, n.y + (i - (n.lines.length - 1) / 2) * LINE, segs, n.w - 6));
    return `<rect class="b" x="${n.x - n.w / 2}" y="${n.y - n.h / 2}" width="${n.w}" height="${n.h}" rx="3"/>${lines.join('')}`;
  },
  sum(n) {
    const sign = { w: [-n.r - 2, -5, 'end'], n: [3, -n.r - 3, 'start'], s: [3, n.r + 5, 'start'] };
    const signs = Object.entries(n.signs ?? {}).map(([at, s]) => { const [dx, dy, a] = sign[at]; return `<text class="sg" x="${n.x + dx}" y="${n.y + dy}" text-anchor="${a}" dominant-baseline="central">${s}</text>`; });
    return `<circle class="b" cx="${n.x}" cy="${n.y}" r="${n.r}"/>${signs.join('')}`;
  },
  bar(n) {
    const signs = (n.signs ?? []).filter(([, s]) => s).map(([y, s]) => `<text class="sg" x="${n.x - n.w / 2 - 1}" y="${y - 5}" text-anchor="end" dominant-baseline="central">${s}</text>`);
    const label = n.label === false ? '' : `<text class="sg" x="${n.x}" y="${n.yOut}" text-anchor="middle" dominant-baseline="central">Σ</text>`;
    return `<rect class="b" x="${n.x - n.w / 2}" y="${n.y - n.h / 2}" width="${n.w}" height="${n.h}" rx="2"/>${label}${signs.join('')}`;
  },
  sat(n) {
    const { x, y } = n;
    return `<rect class="b" x="${x - n.w / 2}" y="${y - n.h / 2}" width="${n.w}" height="${n.h}" rx="2"/><polyline class="w" points="${x - 7},${y + 4} ${x - 3},${y + 4} ${x + 3},${y - 4} ${x + 7},${y - 4}"/>`;
  },
  relay(n) {
    const { x, y } = n;
    return `<rect class="b" x="${x - n.w / 2}" y="${y - n.h / 2}" width="${n.w}" height="${n.h}" rx="2"/><polyline class="w" points="${x - 13},${y + 6} ${x + 4},${y + 6} ${x + 4},${y - 6} ${x + 13},${y - 6}"/><polyline class="w" points="${x + 13},${y - 6} ${x - 4},${y - 6} ${x - 4},${y + 6} ${x - 13},${y + 6}"/>`;
  },
  switch(n) {
    const [ax, ay] = n.a, [bx, by] = n.b, [px, py] = n.pivot, [tx, ty] = n.to === 'b' ? n.b : n.a;
    return `<circle class="dot" cx="${ax}" cy="${ay}" r="2"/><circle class="dot" cx="${bx}" cy="${by}" r="2"/><circle class="dot" cx="${px}" cy="${py}" r="2"/><line class="w" x1="${px}" y1="${py}" x2="${tx + 2}" y2="${ty + (ty < py ? 2 : -2)}"/>`;
  },
  port: (n) => `<text class="p" x="${n.x}" y="${n.y}" text-anchor="${n.anchor ?? 'start'}" dominant-baseline="central">${esc(n.text)}</text>`,
  dot: (n) => `<circle class="dot" cx="${n.x}" cy="${n.y}" r="2.2"/>`,
  note: (n) => text(n.x, n.y, [[n.text, '']], 0, n.anchor ?? 'start', `n${n.cls ? ` ${n.cls}` : ''}`),
};

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
