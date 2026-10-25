// Representations of a plant besides its block diagram. They are configured
// in the project JSON, not drawn in an editor. Two kinds exist:
//   "2d"  a small scene of shapes, below; easy for a person or an agent to write.
//   "svg" a standard SVG drawing (made in any vector editor) plus bindings that
//         set element attributes from formulas:
//         { "name": "Cart", "kind": "svg", "svg": "<svg viewBox=…>…<g id=\"cart\">…</g></svg>",
//           "bind": [ { "select": "#cart", "attr": "transform", "value": "translate({100*y1}, 0)" } ] }
//         "attr": "text" sets an element's text. Event handlers and links cannot be bound.
//   "3d"  a robot from its URDF, posed by signals (design/output/robot.md §7):
//         { "name": "Robot", "kind": "3d", "robot": "puma560", "joints": "q",
//           "paths": [ { "x": "xr", "y": "yr", "z": "zr", "style": "reference", "span": "all" },
//                      { "x": "x", "y": "y", "z": "z", "style": "actual", "span": "to-now", "fade": 2.5 } ],
//           "camera": { "target": [0.45, -0.1, 0.55], "view": "iso", "distance": 2.3 } }
//         robot names one of the diagram's robots (or "urdf" holds the text, for
//         a Live plant). joints: a Sink's base name ("q": q1 … qn, the movable
//         joints in order) or { "j1": "q1", … }. Paths are drawn from the
//         recorded signals: reference dashed in ch1's colour over the whole run,
//         actual in ch2's, fading over fade seconds behind the instant. It
//         binds by Sink names, so the Sinks are visible signals. "part":
//         { "radius", "height", "drop" } draws a cylinder to work on at the
//         centre of the reference path, its top drop below the path.
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
// ground (x1 x2 y; "side": "above" hatches upwards, as a ceiling), polygon
// (points: [[x, y], …]), text (x y text size anchor; "{formula}" inside text
// is replaced by its value, "{formula:6.1}" with 1 decimal in 6 characters),
// group (x y angle: translate then rotate; shapes inside).
// Style: stroke, fill (ink, muted, panel, ch1 … ch4, or any CSS colour) and
// lineWidth (pixels). Angles in radians,
// counter-clockwise. evalScene turns a view and the signal values at one
// instant into flat drawing operations; the UI only draws them.

import { compileExpr } from './expr.js';

const ATTRS = {
  line: ['x1', 'y1', 'x2', 'y2'], arrow: ['x1', 'y1', 'x2', 'y2'],
  rect: ['x', 'y', 'w', 'h', 'angle'], circle: ['cx', 'cy', 'r'],
  spring: ['x1', 'y1', 'x2', 'y2', 'width', 'coils'], damper: ['x1', 'y1', 'x2', 'y2', 'width'],
  ground: ['x1', 'x2', 'y'], text: ['x', 'y', 'size'], group: ['x', 'y', 'angle'], polygon: [],
};

// A text placeholder is {formula} or {formula:w.d}: d decimals, padded to w
// characters, so a caption keeps its width while the numbers change.
function placeholder(src, where) {
  const m = /^(.*?):(\d*)\.?(\d*)$/.exec(src);
  const f = value(m ? m[1] : src, where);
  if (!m || (m[2] === '' && m[3] === '')) return (env) => fmt(f(env));
  const w = Number(m[2] || 0), d = Number(m[3] || 0);
  return (env) => { const v = f(env); return (Number.isFinite(v) ? v.toFixed(d) : '—').padStart(w, '\u2007'); };
}

function value(v, where) {
  if (typeof v === 'number') { const n = v; return () => n; }
  if (typeof v === 'string') {
    try { return compileExpr(v, { vars: true }); } catch (e) { throw new Error(`${where}: ${e.message}`); }
  }
  return () => 0;
}

function template(src, where) {
  return String(src).split(/(\{[^}]*\})/).map((part) => (part.startsWith('{') ? placeholder(part.slice(1, -1), where) : part));
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
  const list = view.bind.map((b) => ({ ...b, parts: String(b.value).split(/(\{[^}]*\})/).map((part) => (part.startsWith('{') ? value(part.slice(1, -1), 'bind') : part)) }));
  return (env) => list.map(({ select, attr, parts }) => ({ select, attr, value: parts.map((p) => (typeof p === 'string' ? p : fmtAttr(p(env)))).join('') }));
}
const fmtAttr = (v) => (Number.isFinite(v) ? String(Number(v.toPrecision(6))) : '0');

const SIGNAL = /^[A-Za-z][A-Za-z0-9_]{0,11}$/;
function normalize3dView(v, path) {
  if (!!v.robot === !!v.urdf) throw new Error(`${path}: "robot" (a robot of the diagram) or "urdf" (its text), one of them`);
  if (v.robot !== undefined && !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(String(v.robot))) throw new Error(`${path}.robot: the name of a robot in the diagram's robots`);
  if (v.urdf !== undefined && typeof v.urdf !== 'string') throw new Error(`${path}.urdf: the robot's description as text`);
  const joints = v.joints ?? 'q';
  if (typeof joints === 'string' ? !SIGNAL.test(joints) : !(joints && typeof joints === 'object' && Object.values(joints).every((s) => SIGNAL.test(String(s))))) throw new Error(`${path}.joints: a Sink's base name ("q": q1, q2, …) or { "j1": "q1", … }`);
  const paths = (v.paths ?? []).map((q, i) => {
    const at = `${path}.paths[${i}]`;
    for (const k of ['x', 'y', 'z']) if (!SIGNAL.test(String(q?.[k] ?? ''))) throw new Error(`${at}.${k}: a signal's name`);
    if (!['reference', 'actual'].includes(q.style ?? 'actual')) throw new Error(`${at}.style: "reference" or "actual"`);
    if (!['all', 'to-now'].includes(q.span ?? 'to-now')) throw new Error(`${at}.span: "all" or "to-now"`);
    const fade = q.fade === undefined ? null : Number(q.fade);
    if (fade !== null && !(fade > 0)) throw new Error(`${at}.fade: seconds, above 0`);
    return { x: q.x, y: q.y, z: q.z, style: q.style ?? 'actual', span: q.span ?? 'to-now', ...(fade ? { fade } : {}) };
  });
  const out = { name: String(v.name ?? '3D view'), kind: '3d', ...(v.robot ? { robot: v.robot } : { urdf: v.urdf }), joints: typeof joints === 'string' ? joints : { ...joints }, paths };
  if (v.camera) out.camera = structuredClone(v.camera);
  // A part to work on, drawn at the centre of the reference path: a
  // cylinder of radius r and height h, its top at the path's height less drop.
  if (v.part !== undefined) {
    const { radius, height, drop = 0 } = v.part ?? {};
    if (!(radius > 0 && height > 0 && drop >= 0)) throw new Error(`${path}.part: { "radius", "height" } in m, above 0 (and "drop", the top below the path)`);
    out.part = { radius: Number(radius), height: Number(height), drop: Number(drop) };
  }
  return out;
}

export function normalizeView(v, path = 'views[0]') {
  if (!v || typeof v !== 'object') throw new Error(`${path}: a view is an object`);
  if (v.kind === 'svg') return normalizeSvgView(v, path);
  if (v.kind === '3d') return normalize3dView(v, path);
  if (v.kind !== '2d') throw new Error(`${path}.kind: "2d" (shapes), "svg" (an SVG drawing with bindings) or "3d" (a robot from its URDF)`);
  const box = v.view ?? [-1, -1, 1, 1];
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite) || box[2] <= box[0] || box[3] <= box[1]) throw new Error(`${path}.view: [xmin, ymin, xmax, ymax]`);
  const check = (shapes, p) => {
    if (!Array.isArray(shapes)) throw new Error(`${p}: "shapes" is a list`);
    shapes.forEach((s, i) => {
      const where = `${p}[${i}]`;
      if (!ATTRS[s?.type]) throw new Error(`${where}.type: one of ${Object.keys(ATTRS).join(', ')}`);
      for (const a of ATTRS[s.type]) if (s[a] !== undefined) value(s[a], `${where}.${a}`);
      if (s.type === 'polygon') {
        if (!Array.isArray(s.points) || s.points.length < 2 || !s.points.every((q) => Array.isArray(q) && q.length === 2)) throw new Error(`${where}.points: a list of [x, y] pairs`);
        s.points.forEach((q, j) => q.forEach((c) => value(c, `${where}.points[${j}]`)));
      }
      if (s.type === 'text') template(s.text ?? '', `${where}.text`);
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
    const parts = s.type === 'text' ? template(s.text ?? '', 'text') : null;
    const pts = s.type === 'polygon' ? s.points.map(([x, y]) => [value(x, 'polygon'), value(y, 'polygon')]) : null;
    return { s, f, parts, pts, kids: s.type === 'group' ? build(s.shapes ?? []) : null };
  });
  const tree = build(view.shapes);
  return (env) => {
    const ops = [];
    const walk = (nodes, T) => {
      for (const { s, f, parts, pts, kids } of nodes) {
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
          case 'polygon':
            ops.push({ op: 'poly', closed: true, pts: pts.map(([x, y]) => P(x(env), y(env))), ...style, fill: s.fill ?? 'panel' });
            break;
          case 'text': {
            const text = parts.map((p) => (typeof p === 'string' ? p : p(env))).join('');
            ops.push({ op: 'text', at: P(g('x'), g('y')), text, size: g('size', 13), fill: s.fill ?? 'ink', anchor: ['start', 'end'].includes(s.anchor) ? s.anchor : 'middle' });
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
