// Representations of a plant besides its block diagram. They are configured
// in the project JSON, not drawn in an editor. Two kinds exist:
//   "2d"  a small scene of shapes, below; easy for a person or an agent to write.
//   "svg" a standard SVG drawing (made in any vector editor) plus bindings that
//         set element attributes from formulas:
//         { "name": "Cart", "kind": "svg", "svg": "<svg viewBox=…>…<g id=\"cart\">…</g></svg>",
//           "bind": [ { "select": "#cart", "attr": "transform", "value": "translate({100*y1}, 0)" } ] }
//         "attr": "text" sets an element's text. Event handlers and links cannot be bound.
// 3D (URDF, joints bound to signals) is planned the same way.
//
// The "2d" kind: A 2D view is a small
// scene in world coordinates (y up) whose numbers may be formulas in t and
// the signal names (Sources and Sinks), so the scene moves with the signals:
//
//   { "name": "Cart", "kind": "2d", "view": [-1.2, -0.3, 1.2, 0.8],
//     "shapes": [
//       { "type": "ground", "x1": -1.2, "x2": 1.2, "y": 0 },
//       { "type": "group", "x": "y1", "y": 0, "shapes": [
//         { "type": "rect", "x": -0.15, "y": 0, "w": 0.3, "h": 0.12, "fill": "ch2" },
//         { "type": "group", "y": 0.12, "angle": "-y2", "shapes": [
//           { "type": "line", "x1": 0, "y1": 0, "x2": 0, "y2": 0.5, "width": 4 } ] } ] } ] }
//
// Shapes: line, arrow (x1 y1 x2 y2), rect (x y w h, angle about its centre),
// circle (cx cy r), spring and damper (x1 y1 x2 y2, width; spring: coils),
// ground (x1 x2 y; "side": "above" hatches upwards, as a ceiling), text (x y text size; "{formula}" inside text is replaced
// by its value), group (x y angle: translate then rotate; shapes inside).
// Style: stroke, fill (ink, muted, panel, ch1 … ch4, or any CSS colour) and
// lineWidth (pixels). Angles in radians,
// counter-clockwise. evalScene turns a view and the signal values at one
// instant into flat drawing operations; the UI only draws them.

import { compileExpr } from './expr.js';

const ATTRS = {
  line: ['x1', 'y1', 'x2', 'y2'], arrow: ['x1', 'y1', 'x2', 'y2'],
  rect: ['x', 'y', 'w', 'h', 'angle'], circle: ['cx', 'cy', 'r'],
  spring: ['x1', 'y1', 'x2', 'y2', 'width', 'coils'], damper: ['x1', 'y1', 'x2', 'y2', 'width'],
  ground: ['x1', 'x2', 'y'], text: ['x', 'y', 'size'], group: ['x', 'y', 'angle'],
};

function value(v, where) {
  if (typeof v === 'number') { const n = v; return () => n; }
  if (typeof v === 'string') {
    try { return compileExpr(v, { vars: true }); } catch (e) { throw new Error(`${where}: ${e.message}`); }
  }
  return () => 0;
}

function template(src, where) {
  return String(src).split(/(\{[^}]*\})/).map((part) => (part.startsWith('{') ? value(part.slice(1, -1), where) : part));
}

function normalizeSvgView(v, path) {
  const svg = String(v.svg ?? '').trim();
  if (!/^<svg[\s>/]/i.test(svg)) throw new Error(`${path}.svg: an SVG document, starting with <svg`);
  const bind = (v.bind ?? []).map((b, i) => {
    const where = `${path}.bind[${i}]`;
    if (!b?.select || typeof b.select !== 'string') throw new Error(`${where}.select: a CSS selector such as #cart`);
    const attr = String(b.attr ?? '');
    if (!/^[A-Za-z][\w:-]*$/.test(attr) || /^on/i.test(attr) || /href$/i.test(attr)) throw new Error(`${where}.attr: an attribute such as transform, x, fill, or "text"; not an event or link`);
    template(b.value ?? '', `${where}.value`);
    return { select: b.select, attr, value: String(b.value ?? '') };
  });
  return { name: String(v.name ?? 'SVG view'), kind: 'svg', svg, bind };
}

// The bindings of an SVG view at one instant: [{ select, attr, value }].
export function compileBindings(view) {
  const list = view.bind.map((b) => ({ ...b, parts: template(b.value, 'bind') }));
  return (env) => list.map(({ select, attr, parts }) => ({ select, attr, value: parts.map((p) => (typeof p === 'string' ? p : fmtAttr(p(env)))).join('') }));
}
const fmtAttr = (v) => (Number.isFinite(v) ? String(Number(v.toPrecision(6))) : '0');

export function normalizeView(v, path = 'views[0]') {
  if (!v || typeof v !== 'object') throw new Error(`${path}: a view is an object`);
  if (v.kind === 'svg') return normalizeSvgView(v, path);
  if (v.kind !== '2d') throw new Error(`${path}.kind: "2d" (shapes) or "svg" (an SVG drawing with bindings)`);
  const box = v.view ?? [-1, -1, 1, 1];
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite) || box[2] <= box[0] || box[3] <= box[1]) throw new Error(`${path}.view: [xmin, ymin, xmax, ymax]`);
  const check = (shapes, p) => {
    if (!Array.isArray(shapes)) throw new Error(`${p}: "shapes" is a list`);
    shapes.forEach((s, i) => {
      const where = `${p}[${i}]`;
      if (!ATTRS[s?.type]) throw new Error(`${where}.type: one of ${Object.keys(ATTRS).join(', ')}`);
      for (const a of ATTRS[s.type]) if (s[a] !== undefined) value(s[a], `${where}.${a}`);
      if (s.type === 'group') check(s.shapes ?? [], `${where}.shapes`);
    });
  };
  check(v.shapes ?? [], `${path}.shapes`);
  return { name: String(v.name ?? '2D view'), kind: '2d', view: box.map(Number), shapes: structuredClone(v.shapes ?? []) };
}

// Compiles once; returns env => [ops]. env holds t and every signal's value.
export function compileScene(view) {
  const build = (shapes) => shapes.map((s) => {
    const f = {};
    for (const a of ATTRS[s.type]) f[a] = s[a] === undefined ? null : value(s[a], s.type);
    const parts = s.type === 'text' ? String(s.text ?? '').split(/(\{[^}]*\})/).map((part) => (part.startsWith('{') ? value(part.slice(1, -1), 'text') : part)) : null;
    return { s, f, parts, kids: s.type === 'group' ? build(s.shapes ?? []) : null };
  });
  const tree = build(view.shapes);
  return (env) => {
    const ops = [];
    const walk = (nodes, T) => {
      for (const { s, f, parts, kids } of nodes) {
        const g = (a, d = 0) => (f[a] ? f[a](env) : d);
        const style = { stroke: s.stroke ?? 'ink', fill: s.fill ?? 'none', width: Number(s.lineWidth ?? 2) };
        const P = (x, y) => T(x, y);
        switch (s.type) {
          case 'group': {
            const tx = g('x'), ty = g('y'), a = g('angle'), c = Math.cos(a), sn = Math.sin(a);
            walk(kids, (x, y) => T(tx + c * x - sn * y, ty + sn * x + c * y));
            break;
          }
          case 'line': case 'arrow': {
            const p = P(g('x1'), g('y1')), q = P(g('x2'), g('y2'));
            ops.push({ op: s.type, pts: [p, q], ...style });
            break;
          }
          case 'rect': {
            const x = g('x'), y = g('y'), w = g('w'), h = g('h'), a = g('angle');
            const cx = x + w / 2, cy = y + h / 2, c = Math.cos(a), sn = Math.sin(a);
            const corner = (dx, dy) => P(cx + c * dx - sn * dy, cy + sn * dx + c * dy);
            ops.push({ op: 'poly', closed: true, pts: [corner(-w / 2, -h / 2), corner(w / 2, -h / 2), corner(w / 2, h / 2), corner(-w / 2, h / 2)], ...style, fill: s.fill ?? 'panel' });
            break;
          }
          case 'circle': {
            const c = P(g('cx'), g('cy')), r = g('r', 0.05);
            const e = P(g('cx') + r, g('cy'));
            ops.push({ op: 'circle', c, r: Math.hypot(e[0] - c[0], e[1] - c[1]), ...style, fill: s.fill ?? 'panel' });
            break;
          }
          case 'spring': case 'damper': {
            const x1 = g('x1'), y1 = g('y1'), x2 = g('x2'), y2 = g('y2'), w = g('width', 0.06);
            const L = Math.hypot(x2 - x1, y2 - y1) || 1e-9, ux = (x2 - x1) / L, uy = (y2 - y1) / L, nx = -uy, ny = ux;
            const at = (s1, o) => P(x1 + ux * s1 + nx * o, y1 + uy * s1 + ny * o);
            if (s.type === 'spring') {
              const n = Math.max(2, Math.round(g('coils', 6))) * 2, lead = Math.min(0.1 * L, 0.03);
              const pts = [at(0, 0), at(lead, 0)];
              for (let i = 1; i < n; i++) pts.push(at(lead + ((L - 2 * lead) * i) / n, (i % 2 ? 1 : -1) * w / 2));
              pts.push(at(L - lead, 0), at(L, 0));
              ops.push({ op: 'poly', closed: false, pts, ...style, fill: 'none', width: Number(s.lineWidth ?? 1.6) });
            } else {
              const mid = L / 2, cyl = Math.max(0.25 * L, 0.04);
              ops.push({ op: 'poly', closed: false, pts: [at(0, 0), at(mid - cyl / 2, 0)], ...style, fill: 'none' });
              ops.push({ op: 'poly', closed: false, pts: [at(mid + cyl / 2, w / 2), at(mid - cyl / 2, w / 2), at(mid - cyl / 2, -w / 2), at(mid + cyl / 2, -w / 2)], ...style, fill: 'none' });
              ops.push({ op: 'poly', closed: false, pts: [at(mid - cyl / 6, w / 2.6), at(mid - cyl / 6, -w / 2.6)], ...style, fill: 'none' });
              ops.push({ op: 'poly', closed: false, pts: [at(mid - cyl / 6, 0), at(L, 0)], ...style, fill: 'none' });
            }
            break;
          }
          case 'ground': {
            const x1 = g('x1'), x2 = g('x2'), y = g('y');
            ops.push({ op: 'poly', closed: false, pts: [P(x1, y), P(x2, y)], ...style, fill: 'none' });
            const step = (x2 - x1) / 24, dir = s.side === 'above' ? 1 : -1;
            for (let x = x1 + step / 2; x < x2; x += step) ops.push({ op: 'poly', closed: false, pts: [P(x, y), P(x - step * 0.8, y + dir * step * 0.8)], ...style, stroke: 'muted', width: 1, fill: 'none' });
            break;
          }
          case 'text': {
            const text = parts.map((p) => (typeof p === 'string' ? p : fmt(p(env)))).join('');
            ops.push({ op: 'text', at: P(g('x'), g('y')), text, size: g('size', 13), fill: s.fill ?? 'ink' });
            break;
          }
          default:
        }
      }
    };
    walk(tree, (x, y) => [x, y]);
    return ops;
  };
}

function fmt(v) {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  return a !== 0 && (a >= 1e5 || a < 1e-3) ? v.toExponential(2) : String(Number(v.toPrecision(3)));
}
