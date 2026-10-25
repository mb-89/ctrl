// Tab 2, the Plant: a block-diagram editor. Library on the left, canvas in the
// middle, the selected block's parameters on the right. Blocks are dragged in
// from the library, wired output to input, grouped into subsystems that nest,
// and subsystems can be saved to the library. See design/output/plant-editor.md.

import { diagramBlockDef, blockPorts, parseEnd, normalizeDiagram, plantDiagram, diagramNames, compileDiagram, outputNames } from '../core/diagram.js';
import { SYSTEM_LIBRARY } from '../core/systems.js';
import { num, parseSI } from './units.js';
import { createScene } from './scene.js';

const NS = 'http://www.w3.org/2000/svg';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const GROUPS = [
  ['Signals', ['source', 'sink', 'terminator']],
  ['Control', ['controller']],
  ['Math', ['gain', 'sum', 'switch', 'fcn']],
  ['Dynamics', ['integrator', 'delay', 'firstOrder', 'secondOrder', 'tf']],
  ['Models', ['fopdt', 'lagChain', 'integratorLag', 'doubleIntegrator', 'inverseResponse']],
  ['Sensors', ['quantizer', 'noise']],
  ['Physics', ['cartPole', 'pendulumCart', 'conicalTank']],
  ['Live', ['external']],  // a plant outside the page (design/output/hil.md)
  ['Nonlinear', ['saturation']],
  ['Structure', ['subsystem', 'inport', 'outport']],
];
// Library groups the viewer has folded, remembered in this browser.
const FOLD_KEY = 'loop-tuner:library-folded';
const LAYOUT_KEY = 'loop-tuner:plant-layout';
const loadJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };
const saveJson = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ } };

// Block geometry in canvas units.
function size(b) {
  if (b.type === 'sum') return [34, 34];
  if (b.type === 'gain') return [58, 40];
  if (['source', 'sink', 'inport', 'outport'].includes(b.type)) return [70, 28];
  if (diagramBlockDef(b.type).ode) return [150, Math.max(60, 18 * blockPorts(b)[1] + 12)];
  if (b.type === 'controller') return [150, Math.max(60, 18 * blockPorts(b)[0] + 12)];
  if (b.type === 'terminator') return [26, 26];
  if (b.type === 'external') return [150, 18 * Math.max(...blockPorts(b)) + 32];  // room for both sides' port labels
  if (b.type === 'switch') { const n = b.params.inputs; return [56, Math.max(40, 18 * n + 8)]; }
  const [ni, no] = blockPorts(b);
  return [130, Math.max(48, 18 * Math.max(ni, no) + 12)];
}
function geom(b) {
  const [w, h] = size(b);
  const [ni, no] = blockPorts(b);
  const L = b.x, R = b.x + w;
  const at = (n, i) => b.y + (h * (i + 1)) / (n + 1);
  return {
    w, h,
    ins: Array.from({ length: ni }, (_, i) => ({ x: b.flip ? R : L, y: at(ni, i), dir: b.flip ? -1 : 1 })),
    outs: Array.from({ length: no }, (_, i) => ({ x: b.flip ? L : R, y: at(no, i), dir: b.flip ? -1 : 1 })),
  };
}

// Orthogonal route from an output (leaving in dir) to an input (entered in dir).
function route(p, q, pd, qd) {
  const p1 = { x: p.x + pd * 14, y: p.y }, q1 = { x: q.x - qd * 14, y: q.y };
  if (pd === qd && (q1.x - p1.x) * pd >= 0) {
    const mx = (p1.x + q1.x) / 2;
    return [p, { x: mx, y: p.y }, { x: mx, y: q.y }, q];
  }
  const lane = Math.max(p.y, q.y) + 34;
  return [p, p1, { x: p1.x, y: lane }, { x: q1.x, y: lane }, q1, q];
}
const pathOf = (pts) => pts.map((pt, i) => `${i ? 'L' : 'M'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');

export function createPlantEditor(root, app) {
  root.innerHTML = `
    <div class="plant">
      <section class="plib" aria-label="Block library"><div id="pl-lib"></div></section>
      <div class="split split-v plsplit" id="pl-split" role="separator" aria-orientation="vertical" aria-label="Resize the library" tabindex="0" title="Drag to resize · double-click to reset"></div>
      <section class="pcan" aria-label="Diagram">
        <div class="ptool">
          <div class="reps" id="pl-reps" role="tablist" aria-label="Representation"></div>
          <nav class="crumbs" id="pl-crumbs"></nav>
          <button class="key small" id="pl-group" title="Put the selected blocks into a subsystem (Ctrl+G)">Group</button>
          <button class="key small" id="pl-del" title="Delete the selection (Del)">Delete</button>
          <button class="key small" id="pl-fit" title="Fit the diagram to the view">Fit</button>
        </div>
        <div class="pview" id="pl-view" tabindex="0" aria-label="Diagram canvas: drag blocks in from the library; drag from an output to an input to wire; Shift-drag to select; double-click a subsystem to open it"></div>
        <div class="pview pscenebox" id="pl-scene" hidden></div>
      </section>
      <section class="pprops" aria-label="Block parameters"><div id="pl-props"></div></section>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const viewEl = $('#pl-view');
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'pdiag');
  viewEl.append(svg);

  let path = [];                 // ids of the subsystems we are inside
  let sel = new Set();           // selected block ids at this level
  let wireSel = -1;              // selected wire index at this level
  const views = {};              // per level: { x, y, k }
  let gesture = null;
  let lastClick = { id: null, t: 0 };
  let saveName = null;           // library name being typed for a subsystem
  let rep = -1;                  // -1: the block diagram; otherwise a 2D view index
  const folded = new Set(loadJson(FOLD_KEY, ['Models', 'Sensors', 'Physics', 'Nonlinear', 'Structure']));
  const scene = createScene($('#pl-scene'), app);

  // The library column's width, set by its separator and kept in this browser.
  const layout = loadJson(LAYOUT_KEY, {});
  const plantEl = root.querySelector('.plant');
  const applyWidth = () => { if (layout.libW) plantEl.style.setProperty('--lib-w', `${Math.round(Math.max(130, Math.min(420, layout.libW)))}px`); else plantEl.style.removeProperty('--lib-w'); };
  applyWidth();
  {
    const sp = $('#pl-split');
    sp.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      sp.setPointerCapture(e.pointerId);
      const x0 = e.clientX, w0 = $('.plib').getBoundingClientRect().width;
      const move = (ev) => { layout.libW = w0 + ev.clientX - x0; applyWidth(); };
      const up = () => { sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); saveJson(LAYOUT_KEY, layout); };
      sp.addEventListener('pointermove', move);
      sp.addEventListener('pointerup', up);
    });
    sp.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: -16, ArrowRight: 16 }[e.key];
      if (!d) return;
      e.preventDefault(); e.stopPropagation();
      layout.libW = $('.plib').getBoundingClientRect().width + d; applyWidth(); saveJson(LAYOUT_KEY, layout);
    });
    sp.addEventListener('dblclick', () => { delete layout.libW; applyWidth(); saveJson(LAYOUT_KEY, layout); });
  }

  // The diagram being edited (root, or a subsystem's inner diagram).
  const rootDiagram = () => (app.project.system.plant ? plantDiagram(app.project.system.plant) : { blocks: [], wires: [] });
  function levelOf(d, p = path) {
    let cur = d;
    for (const id of p) cur = cur.blocks.find((b) => b.id === id)?.diagram ?? cur;
    return cur;
  }
  const level = () => levelOf(rootDiagram());
  const view = () => (views[path.join('/')] ??= { x: 20, y: 10, k: 1 });

  // Edits work on a copy, are validated, then committed with undo history.
  function edit(fn, { quiet } = {}) {
    const next = structuredClone(rootDiagram());
    const lv = levelOf(next);
    if (fn(lv, next) === false) return false;
    try { app.setPlant(normalizeDiagram(next)); } catch (err) { app.toast(err.message); return false; }
    if (!quiet) render();
    return true;
  }

  function uniqueId(d, base) {
    const ids = new Set(d.blocks.map((b) => b.id));
    if (!ids.has(base)) return base;
    for (let i = 2; ; i++) if (!ids.has(`${base}${i}`)) return `${base}${i}`;
  }
  function freeName(prefix, used, first) {
    if (first && !used.has(first)) return first;
    for (let i = 1; ; i++) if (!used.has(`${prefix}${i}`)) return `${prefix}${i}`;
  }

  function newBlock(d, type, x, y, template) {
    const all = diagramNames(rootDiagram());
    const b = template ? structuredClone(template) : { type, params: {} };
    if (!template) for (const p of diagramBlockDef(type).params) b.params[p.key] = p.default;
    if (type === 'source') b.params.signal = freeName('r', new Set([...all.sources, ...all.sinks]), 'r');
    if (type === 'sink') b.params.name = freeName('y', new Set([...all.sinks, ...all.sources]));
    if (type === 'inport' || type === 'outport') b.params.port = d.blocks.filter((x2) => x2.type === type).length + 1;
    if (type === 'subsystem' && !b.diagram) b.diagram = { blocks: [{ id: 'in', type: 'inport', params: { port: 1 }, x: 30, y: 60 }, { id: 'out', type: 'outport', params: { port: 1 }, x: 260, y: 60 }], wires: [{ from: 'in', to: 'out' }] };
    const base = type === 'source' ? b.params.signal : type === 'sink' ? b.params.name : { firstOrder: 'lag', secondOrder: 'so', integrator: 'int', subsystem: 'sub', saturation: 'sat' }[type] ?? type;
    b.id = uniqueId(d, base);
    const [w, h] = size(b);
    b.x = Math.round(x - w / 2); b.y = Math.round(y - h / 2);
    // Step down until the new block does not cover another one.
    const hits = () => d.blocks.some((o) => { const [ow, oh] = size(o); return b.x < o.x + ow + 10 && o.x < b.x + w + 10 && b.y < o.y + oh + 10 && o.y < b.y + h + 10; });
    for (let i = 0; i < 20 && hits(); i++) b.y += 60;
    d.blocks.push(b);
    return b;
  }

  // Library
  function renderLibrary() {
    const lib = app.project.library ?? [];
    const item = (data, label, title, extra = '') => `<button class="litem" draggable="true" data-add="${esc(data)}" title="${esc(title)}">${label}${extra}</button>`;
    const group = (name, body) => {
      const open = !folded.has(name);
      return `<div class="lgroup"><button class="lgname" data-fold="${esc(name)}" aria-expanded="${open}"><span class="chev">${open ? '▾' : '▸'}</span>${esc(name)}</button>${open ? body : ''}</div>`;
    };
    let html = '<h3 class="glabel">Library</h3>';
    for (const [g, types] of GROUPS) {
      html += group(g, types.map((t) => { const def = diagramBlockDef(t); return item(`type:${t}`, esc(def.label), `${def.label}: ${def.formula}. Drag onto the canvas, or click to add.`, `<span class="lf">${esc(def.formula)}</span>`); }).join(''));
    }
    html += group('My blocks', lib.length ? lib.map((e, i) => item(`lib:${i}`, esc(e.name), 'Your saved subsystem. Drag onto the canvas, or click to add.')).join('') : '<div class="lempty">Select a subsystem and save it here.</div>');
    html += group('System library', SYSTEM_LIBRARY.map((e, i) => (e.plant ? `<button class="litem ex" data-system="${i}" title="${esc(`${e.tags.map((t) => t.label).join(' · ')}\n${e.notes} Loads this system's plant; the header's System library loads the rest.`)}">${esc(e.name)}<span class="lf">plant</span></button>` : '')).join(''));
    $('#pl-lib').innerHTML = html;
    $('#pl-lib').querySelectorAll('[data-fold]').forEach((b) => b.addEventListener('click', () => {
      const n = b.dataset.fold;
      if (folded.has(n)) folded.delete(n); else folded.add(n);
      saveJson(FOLD_KEY, [...folded]);
      renderLibrary();
    }));
    $('#pl-lib').querySelectorAll('[data-add]').forEach((b) => {
      b.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', b.dataset.add); e.dataTransfer.effectAllowed = 'copy'; });
      b.addEventListener('click', () => {
        if (rep >= 0) showRep(-1);
        const r = viewEl.getBoundingClientRect(), v = view();
        addFrom(b.dataset.add, (r.width / 2 - v.x) / v.k, (r.height / 2 - v.y) / v.k);
      });
    });
    $('#pl-lib').querySelectorAll('[data-system]').forEach((b) => b.addEventListener('click', () => {
      app.loadSystem(SYSTEM_LIBRARY[Number(b.dataset.system)], ['plant']);
    }));
  }

  function addFrom(data, x, y) {
    let added = null;
    edit((d) => {
      if (data.startsWith('type:')) added = newBlock(d, data.slice(5), x, y);
      else if (data.startsWith('lib:')) {
        const e = (app.project.library ?? [])[Number(data.slice(4))];
        if (!e) return false;
        added = newBlock(d, 'subsystem', x, y, { ...e.block, name: e.block.name ?? e.name });
      }
      return added ? undefined : false;
    });
    if (added) { sel = new Set([added.id]); wireSel = -1; render(); }
  }

  viewEl.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  viewEl.addEventListener('drop', (e) => {
    const data = e.dataTransfer.getData('text/plain');
    if (!data || !/^(type|lib):/.test(data)) return;
    e.preventDefault();
    const p = toWorld(e);
    addFrom(data, p.x, p.y);
  });

  // Canvas
  function toWorld(e) {
    const r = svg.getBoundingClientRect(), v = view();
    return { x: (e.clientX - r.left - v.x) / v.k, y: (e.clientY - r.top - v.y) / v.k };
  }

  function blockSvg(b, errs) {
    const g = geom(b);
    const def = diagramBlockDef(b.type);
    const selected = sel.has(b.id);
    const cls = `blk t-${b.type}${selected ? ' sel' : ''}${errs.has(b.id) ? ' err' : ''}`;
    const title = b.name ?? (b.type === 'source' ? b.params.signal : b.type === 'sink' ? b.params.name : b.type === 'inport' ? `In ${b.params.port}` : b.type === 'outport' ? `Out ${b.params.port}` : def.label);
    let shape, text = '';
    const cx = b.x + g.w / 2, cy = b.y + g.h / 2;
    if (b.type === 'sum') {
      shape = `<circle class="body" cx="${cx}" cy="${cy}" r="${g.w / 2}"/>`;
      text = `<text class="bt" x="${cx}" y="${cy + 5}" text-anchor="middle">Σ</text>`
        + g.ins.map((p, i) => `<text class="sign" x="${p.x + (b.flip ? -9 : 9)}" y="${p.y + (p.y < cy ? 9 : -2)}" text-anchor="middle">${b.params.signs[i]}</text>`).join('');
    } else if (b.type === 'terminator') {
      shape = `<rect class="body" x="${b.x}" y="${b.y}" width="${g.w}" height="${g.h}" rx="4"/>`;
      const x = b.flip ? b.x + 8 : b.x + g.w - 8;
      text = `<path class="term" d="M${b.x + (b.flip ? g.w : 0)},${cy} H${x} M${x},${cy - 7} V${cy + 7}"/>`;
    } else if (b.type === 'switch') {
      // The switch symbol: the active input joined to the output.
      shape = `<rect class="body" x="${b.x}" y="${b.y}" width="${g.w}" height="${g.h}" rx="5"/>`;
      const p = g.ins[b.params.position - 1], q = g.outs[0];
      const ix = p.x + (b.flip ? -10 : 10), ox = q.x + (b.flip ? 10 : -10);
      text = g.ins.map((pt) => `<circle class="swdot" cx="${pt.x + (b.flip ? -10 : 10)}" cy="${pt.y}" r="2.2"/>`).join('')
        + `<path class="swline" d="M${p.x},${p.y} H${ix} L${ox},${q.y} H${q.x}"/>`
        + (b.name ? `<text class="bn" x="${cx}" y="${b.y - 5}" text-anchor="middle">${esc(b.name)}</text>` : '');
    } else if (b.type === 'gain') {
      const pts = b.flip ? `${b.x + g.w},${b.y} ${b.x + g.w},${b.y + g.h} ${b.x},${cy}` : `${b.x},${b.y} ${b.x},${b.y + g.h} ${b.x + g.w},${cy}`;
      shape = `<polygon class="body" points="${pts}"/>`;
      text = `<text class="bp" x="${b.x + (b.flip ? g.w * 0.62 : g.w * 0.38)}" y="${cy + 4}" text-anchor="middle">${esc(num(b.params.K, 3))}</text>`
        + (b.name ? `<text class="bn" x="${cx}" y="${b.y - 5}" text-anchor="middle">${esc(b.name)}</text>` : '');
    } else {
      const round = ['source', 'sink', 'inport', 'outport'].includes(b.type) ? 14 : 5;
      shape = `<rect class="body" x="${b.x}" y="${b.y}" width="${g.w}" height="${g.h}" rx="${round}"/>`;
      if (b.type === 'source' || b.type === 'sink') {
        text = `<text class="bt sig" x="${cx}" y="${cy + 4.5}" text-anchor="middle">${esc(b.type === 'source' ? `${b.params.signal} ▸` : `▸ ${b.params.name}`)}</text>`;
      } else if (b.type === 'inport' || b.type === 'outport') {
        text = `<text class="bt" x="${cx}" y="${cy + 4.5}" text-anchor="middle">${esc(title)}</text>`;
      } else {
        const sub = b.type === 'subsystem' ? `${b.diagram.blocks.length} blocks · open ↵` : summary(b);
        text = `<text class="bt" x="${b.x + 9}" y="${b.y + 18}">${esc(title)}</text><text class="bp" x="${b.x + 9}" y="${b.y + g.h - 10}">${esc(sub)}</text>`;
      }
    }
    const outNames = outputNames(def, b.params), inNames = def.inputNames?.(b.params) ?? [];
    const ports = g.outs.map((p, i) => (outNames[i] ? `<text class="pn" x="${p.x + (b.flip ? 8 : -8)}" y="${p.y + 3.5}" text-anchor="${b.flip ? 'start' : 'end'}">${esc(outNames[i])}</text>` : '')).join('')
      + g.ins.map((p, i) => (inNames[i] ? `<text class="pn" x="${p.x + (b.flip ? -8 : 8)}" y="${p.y + 3.5}" text-anchor="${b.flip ? 'end' : 'start'}">${esc(inNames[i])}</text>` : '')).join('')
      + g.ins.map((p, i) => `<circle class="port in" data-port="in" data-block="${b.id}" data-k="${i}" cx="${p.x}" cy="${p.y}" r="4.5"/>`).join('')
      + g.outs.map((p, i) => `<circle class="port out" data-port="out" data-block="${b.id}" data-k="${i}" cx="${p.x}" cy="${p.y}" r="4.5"/>`).join('');
    const stack = b.type === 'subsystem' ? `<rect class="stack" x="${b.x + 4}" y="${b.y + 4}" width="${g.w}" height="${g.h}" rx="5"/>` : '';
    return `<g class="${cls}" data-block="${b.id}">${stack}${shape}${text}${ports}</g>`;
  }

  // The line under a block's title: its formula for physics blocks (their
  // parameters are on the right), else its first parameters, cut to fit.
  function summary(b) {
    const def = diagramBlockDef(b.type);
    const text = def.summary ? def.summary(b.params) : def.ode ? def.formula : b.type === 'fcn' ? `y = ${b.params.expr}` : b.type === 'controller' ? `▸ ${b.variants?.[b.variant]?.name ?? ''}` : def.params.filter((p) => p.kind !== 'vector').slice(0, 3).map((p) => `${p.label} ${typeof b.params[p.key] === 'number' ? num(b.params[p.key], 3) : b.params[p.key]}`).join(' · ') || def.formula;
    const room = Math.floor((size(b)[0] - 18 - (def.outputs ? 16 : 0)) / 6.4);
    return text.length > room ? `${text.slice(0, room - 1)}…` : text;
  }

  const plantViews = () => app.project.system.plant?.views ?? [];
  function renderReps() {
    const vs = plantViews();
    if (rep >= vs.length) rep = -1;
    $('#pl-reps').innerHTML = `<button class="rep ${rep < 0 ? 'on' : ''}" data-rep="-1" role="tab" aria-selected="${rep < 0}">Diagram</button>`
      + vs.map((v, i) => `<button class="rep ${rep === i ? 'on' : ''}" data-rep="${i}" role="tab" aria-selected="${rep === i}" title="A view of this plant, from its JSON">${esc(v.name)}</button>`).join('');
    $('#pl-reps').querySelectorAll('[data-rep]').forEach((b) => b.addEventListener('click', () => showRep(Number(b.dataset.rep))));
  }

  function showRep(i) {
    rep = i;
    const inView = rep >= 0;
    viewEl.hidden = inView;
    $('#pl-scene').hidden = !inView;
    for (const id of ['#pl-crumbs', '#pl-group', '#pl-del', '#pl-fit']) $(id).hidden = inView;
    if (inView) scene.show(plantViews()[rep]); else scene.stop();
    render();
  }

  // Views come from the project's JSON; the panel only says what is shown.
  function renderViewProps() {
    const v = plantViews()[rep];
    const used = [...new Set((JSON.stringify(v).match(/[A-Za-z_]\w*/g) ?? []).filter((n) => app.signalNames().includes(n)))];
    $('#pl-props').innerHTML = `<h3 class="glabel">${esc(v.name)}</h3>
      <p class="phelp">A ${v.kind === 'svg' ? 'SVG drawing' : '2D scene'} of this plant, moving with ${used.length ? used.map(esc).join(', ') : 'its signals'}. It follows the scope: the scan line while it runs (press <b>Single</b> for one run from t = 0), the cursor while you hover the plot.</p>
      <p class="phelp">Views are set in the plant's JSON (<code>system.plant.views</code>); the format is in design/output/plant-views.md.</p>`;
  }

  let compileMsg = '';
  function render() {
    renderReps();
    if (rep >= 0) { renderViewProps(); return; }
    const d = level();
    // Validity of the whole diagram, shown in the parameters panel.
    compileMsg = '';
    const errs = new Set();
    try {
      const el = compileDiagram(rootDiagram(), 'plant', { standalone: true, sources: Object.fromEntries(Object.keys(app.project.system.signals).map((n) => [n, () => 0])) });
      compileMsg = el.warnings.join('\n');
    } catch (err) {
      compileMsg = err.message;
      for (const b of d.blocks) if (err.message.includes(b.name ?? b.id)) errs.add(b.id);
    }
    const v = view();
    const byId = Object.fromEntries(d.blocks.map((b) => [b.id, b]));
    const wires = d.wires.map((w, i) => {
      const f = parseEnd(w.from), t = parseEnd(w.to);
      const fb = byId[f.id], tb = byId[t.id];
      const p = geom(fb).outs[f.port], q = geom(tb).ins[t.port];
      const pts = route(p, q, p.dir, q.dir);
      return `<g class="wire${i === wireSel ? ' sel' : ''}" data-wire="${i}"><path class="hit" d="${pathOf(pts)}"/><path class="line" d="${pathOf(pts)}" marker-end="url(#pl-arrow)"/></g>`;
    }).join('');
    svg.innerHTML = `<defs><marker id="pl-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" class="arrowhead"/></marker></defs>
      <g transform="translate(${v.x},${v.y}) scale(${v.k})">${wires}${d.blocks.map((b) => blockSvg(b, errs)).join('')}<g id="pl-temp"></g></g>`;
    renderCrumbs();
    renderProps();
    $('#pl-group').disabled = sel.size === 0;
    $('#pl-del').disabled = sel.size === 0 && wireSel < 0;
  }

  function renderCrumbs() {
    const parts = [['Plant', 0]];
    let cur = rootDiagram();
    path.forEach((id, i) => { const b = cur.blocks.find((x) => x.id === id); parts.push([b?.name ?? id, i + 1]); cur = b?.diagram ?? cur; });
    $('#pl-crumbs').innerHTML = parts.map(([n, depth], i) => (i < parts.length - 1 ? `<button class="crumb" data-depth="${depth}">${esc(n)}</button><span class="csep">›</span>` : `<span class="crumb cur">${esc(n)}</span>`)).join('');
    $('#pl-crumbs').querySelectorAll('[data-depth]').forEach((b) => b.addEventListener('click', () => { path = path.slice(0, Number(b.dataset.depth)); sel.clear(); wireSel = -1; render(); }));
  }

  // Parameters panel
  function renderProps() {
    const d = level();
    const box = $('#pl-props');
    if (sel.size === 1) {
      const b = d.blocks.find((x) => x.id === [...sel][0]);
      if (!b) { sel.clear(); return renderProps(); }
      const def = diagramBlockDef(b.type);
      let html = `<h3 class="glabel">${esc(def.label)}</h3><div class="pform">`;
      if (!['source', 'sink', 'inport', 'outport'].includes(b.type)) html += field('name', 'Label', b.name ?? '', 'text', 'optional');
      for (const p of def.params) {
        if (p.kind === 'hidden') continue;  // set elsewhere (the External block's full scales: Live settings)
        const v = b.params[p.key];
        const hint = p.kind === 'vector' ? 'highest power first' : p.kind === 'expr' ? 'u: the input, t: time' : p.kind ? '' : `unit: ${p.unit ?? '1'}`;
        html += field(`p:${p.key}`, p.label, p.kind === 'vector' || Array.isArray(v) ? v.join(', ') : p.kind ? v : num(v, 6), p.kind ?? 'number', hint);
      }
      html += '</div><div class="pbtns">';
      if (b.type !== 'sum' && blockPorts(b)[0] + blockPorts(b)[1] > 0) html += `<button class="key small" data-act="flip">Flip</button>`;
      if (b.type === 'subsystem') html += `<button class="key small" data-act="open">Open</button><button class="key small" data-act="save">Save to library</button>`;
      if (b.type === 'source') html += `<button class="key small" data-act="signal">Edit signal ${esc(b.params.signal)}</button>`;
      if (b.type === 'controller') html += `<button class="key small primary" data-act="controller">Open in the Controller tab</button>`;
      html += '</div>';
      if (saveName !== null && b.type === 'subsystem') html += `<div class="pform">${field('libname', 'Library name', saveName, 'text', '')}</div><div class="pbtns"><button class="key small primary" data-act="saveok">Save</button><button class="key small" data-act="savecancel">Cancel</button></div>`;
      const role = { sink: ' · recorded: pick it as a scope channel source', source: ' · plays the signal made in the Input tab', terminator: ' · ends a signal without recording it', outport: ' · passes the signal up to the enclosing block', inport: ' · takes the signal from the enclosing block', switch: ' · double-click it on the canvas to move to the next input', controller: ` · runs “${esc(b.variants?.[b.variant]?.name ?? '')}”; double-click it to open the Controller tab` }[b.type] ?? '';
      html += `<p class="phelp">${esc(def.formula)}${role}</p>`;
      box.innerHTML = html;
      bindFields(b);
      box.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', () => act(btn.dataset.act, b)));
      return;
    }
    if (sel.size > 1) {
      box.innerHTML = `<h3 class="glabel">${sel.size} blocks</h3><div class="pbtns"><button class="key small primary" data-act="group">Group into subsystem</button><button class="key small" data-act="delete">Delete</button></div><p class="phelp">Grouping keeps the wires: those that cross the boundary become the subsystem's In and Out ports.</p>`;
      box.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', () => act(btn.dataset.act)));
      return;
    }
    const names = diagramNames(rootDiagram());
    box.innerHTML = `<h3 class="glabel">Plant</h3>
      <p class="phelp"><b>Sources</b> ${names.sources.map(esc).join(', ') || 'none'} · <b>Sinks</b> ${names.sinks.map(esc).join(', ') || 'none'}</p>
      ${compileMsg ? `<p class="pmsg">${esc(compileMsg).replace(/\n/g, '<br>')}</p>` : '<p class="phelp">The diagram is valid.</p>'}
      <p class="phelp">Drag blocks in from the library. Drag from an output (right) to an input (left) to wire. Shift-drag to select several; <kbd>Ctrl</kbd> <kbd>G</kbd> groups them. Double-click a subsystem to open it. Wheel zooms, dragging the background pans.</p>`;
  }

  function field(key, label, value, kind, hint) {
    return `<label class="pf"><span class="pfl">${esc(label)}</span><input class="field pfi" data-f="${esc(key)}" data-kind="${kind}" value="${esc(value)}" spellcheck="false"><span class="pfh">${esc(hint)}</span></label>`;
  }

  function bindFields(b) {
    $('#pl-props').querySelectorAll('[data-f]').forEach((inp) => {
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.dataset.cancel = '1'; inp.blur(); } });
      inp.addEventListener('blur', () => {
        if (inp.dataset.cancel) { delete inp.dataset.cancel; renderProps(); return; }
        const f = inp.dataset.f, kind = inp.dataset.kind, raw = inp.value.trim();
        if (f === 'libname') { saveName = raw; return; }
        let value = raw;
        if (kind === 'number') { value = parseSI(raw); if (!Number.isFinite(value)) { app.toast('Enter a number, e.g. 0.5, 20m, 2k.'); renderProps(); return; } }
        if (kind === 'vector') { value = raw.split(/[\s,;]+/).filter(Boolean).map(Number); if (!value.length || !value.every(Number.isFinite)) { app.toast('Enter numbers separated by commas, highest power of s first.'); renderProps(); return; } }
        edit((d) => {
          const blk = d.blocks.find((x) => x.id === b.id);
          if (f === 'name') { if (raw) blk.name = raw; else delete blk.name; return; }
          const key = f.slice(2);
          if ((blk.type === 'source' && key === 'signal') || (blk.type === 'sink' && key === 'name')) { renameNamed(blk, value); return false; }
          if (blk.type === 'sum' && key === 'signs') d.wires = d.wires.filter((w) => { const t = parseEnd(w.to); return t.id !== blk.id || t.port < value.length; });
          if (blk.type === 'controller' && key === 'inputs') d.wires = d.wires.filter((w) => { const t = parseEnd(w.to); return t.id !== blk.id || t.port < value; });
          if (blk.type === 'switch' && key === 'inputs') {
            d.wires = d.wires.filter((w) => { const t = parseEnd(w.to); return t.id !== blk.id || t.port < value; });
            blk.params.position = Math.min(blk.params.position, value);
          }
          blk.params[key] = value;
        });
      });
    });
  }

  function act(what, b) {
    if (what === 'flip') edit((d) => { const blk = d.blocks.find((x) => x.id === b.id); blk.flip = !blk.flip; if (!blk.flip) delete blk.flip; });
    if (what === 'open') enter(b.id);
    if (what === 'signal') app.editSignal(b.params.signal);
    if (what === 'controller') app.openController([...path, b.id]);
    if (what === 'save') { saveName = b.name ?? 'My block'; renderProps(); $('#pl-props [data-f="libname"]')?.focus(); }
    if (what === 'savecancel') { saveName = null; renderProps(); }
    if (what === 'saveok') {
      const inp = $('#pl-props [data-f="libname"]');
      const name = (inp?.value ?? saveName ?? '').trim();
      if (!name) { app.toast('Give the block a name.'); return; }
      const { id, x, y, ...block } = structuredClone(b);
      void id; void x; void y;
      app.saveToLibrary(name, { ...block, name: block.name ?? name });
      saveName = null;
      renderLibrary(); renderProps();
    }
    if (what === 'group') group();
    if (what === 'delete') remove();
  }

  // Renames a Source (its signal) or a Sink, everywhere it is used: the
  // Input tab's signal list and the scope channels follow.
  function renameNamed(b, to) {
    const from = b.type === 'source' ? b.params.signal : b.params.name;
    if (to === from) return true;
    if (!/^[A-Za-z][A-Za-z0-9_]{0,11}$/.test(to)) { app.toast('A name is letters, digits and _, starting with a letter: r2, d, y1, pos.'); return false; }
    const names = diagramNames(rootDiagram());
    if (b.type === 'sink' && (names.sinks.includes(to) || names.sources.includes(to))) { app.toast(`“${to}” is already used.`); return false; }
    if (b.type === 'source' && names.sinks.includes(to)) { app.toast(`“${to}” is already a Sink.`); return false; }
    if (b.type === 'source') app.renameSignal(from, to, names.sources.filter((n) => n === from).length);
    else app.renameSink(from, to);
    return edit((d) => { const x = d.blocks.find((q) => q.id === b.id); if (x.type === 'source') x.params.signal = to; else x.params.name = to; });
  }

  function renameOnCanvas(b) {
    const v = view(), [w, h] = size(b);
    const input = document.createElement('input');
    input.className = 'canvas-rename';
    input.value = b.type === 'source' ? b.params.signal : b.params.name;
    input.setAttribute('aria-label', `Rename ${b.type}`);
    Object.assign(input.style, { left: `${v.x + b.x * v.k}px`, top: `${v.y + b.y * v.k}px`, width: `${Math.max(70, w * v.k)}px`, height: `${h * v.k}px` });
    viewEl.append(input);
    requestAnimationFrame(() => { input.focus(); input.select(); });
    let done = false;
    const finish = (save) => { if (done) return; done = true; const to = input.value.trim(); input.remove(); if (save && to) renameNamed(b, to); else render(); };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
  }

  function enter(id) {
    const b = level().blocks.find((x) => x.id === id);
    if (b?.type !== 'subsystem') return;
    path = [...path, id]; sel.clear(); wireSel = -1;
    render();
    fit();
  }

  function remove() {
    if (!sel.size && wireSel < 0) return;
    // A system keeps at least one Source: the last one cannot be deleted.
    const doomed = level().blocks.filter((b) => b.type === 'source' && sel.has(b.id));
    if (doomed.length && doomed.length >= diagramNames(rootDiagram()).sources.length) {
      sel.delete(doomed[0].id);
      app.toast(`A system keeps at least one Source; “${doomed[0].params.signal}” stays.`);
      if (!sel.size) { render(); return; }
    }
    edit((d) => {
      if (sel.size) {
        d.blocks = d.blocks.filter((b) => !sel.has(b.id));
        d.wires = d.wires.filter((w) => !sel.has(parseEnd(w.from).id) && !sel.has(parseEnd(w.to).id));
      } else d.wires.splice(wireSel, 1);
    });
    sel.clear(); wireSel = -1;
    render();
  }

  // Group the selection into a subsystem. Wires crossing the boundary become
  // ports: one In per distinct outside source, one Out per inside source that
  // feeds the outside.
  function group() {
    if (!sel.size) return;
    let made = null;
    edit((d) => {
      const inside = (end) => sel.has(parseEnd(end).id);
      const chosen = d.blocks.filter((b) => sel.has(b.id));
      const minX = Math.min(...chosen.map((b) => b.x)), minY = Math.min(...chosen.map((b) => b.y));
      const maxX = Math.max(...chosen.map((b) => b.x + size(b)[0])), maxY = Math.max(...chosen.map((b) => b.y + size(b)[1]));
      const inner = { blocks: chosen.map((b) => ({ ...b, x: b.x - minX + 140, y: b.y - minY + 40 })), wires: [] };
      const outer = [];
      const inPorts = new Map(), outPorts = new Map();
      for (const w of d.wires) {
        const fi = inside(w.from), ti = inside(w.to);
        if (fi && ti) inner.wires.push(w);
        else if (!fi && !ti) outer.push(w);
        else if (ti) {
          if (!inPorts.has(w.from)) {
            const k = inPorts.size;
            const id = uniqueId(inner, `in${k + 1}`);
            inner.blocks.push({ id, type: 'inport', params: { port: k + 1 }, x: 20, y: 40 + k * 50 });
            inPorts.set(w.from, { k, id });
            outer.push({ from: w.from, to: `@sub:${k}` });
          }
          inner.wires.push({ from: inPorts.get(w.from).id, to: w.to });
        } else {
          if (!outPorts.has(w.from)) {
            const k = outPorts.size;
            const id = uniqueId(inner, `out${k + 1}`);
            inner.blocks.push({ id, type: 'outport', params: { port: k + 1 }, x: maxX - minX + 260, y: 40 + k * 50 });
            outPorts.set(w.from, { k, id });
            inner.wires.push({ from: w.from, to: id });
          }
          outer.push({ from: `@sub:${outPorts.get(w.from).k}`, to: w.to });
        }
      }
      const id = uniqueId(d, 'sub');
      made = { id, type: 'subsystem', name: 'Subsystem', params: {}, x: Math.round((minX + maxX) / 2 - 65), y: Math.round((minY + maxY) / 2 - 24), diagram: inner };
      d.blocks = d.blocks.filter((b) => !sel.has(b.id)).concat([made]);
      d.wires = outer.map((w) => ({ from: w.from.replace(/^@sub:(\d+)$/, (_, k) => (k === '0' ? id : `${id}:${k}`)), to: w.to.replace(/^@sub:(\d+)$/, (_, k) => (k === '0' ? id : `${id}:${k}`)) }));
    });
    if (made) { sel = new Set([made.id]); render(); app.toast('Grouped into a subsystem. Double-click it to open; Save to library keeps it.'); }
  }

  function fit() {
    const d = level();
    const r = viewEl.getBoundingClientRect();
    if (!d.blocks.length || !r.width) { views[path.join('/')] = { x: 20, y: 10, k: 1 }; render(); return; }
    const x0 = Math.min(...d.blocks.map((b) => b.x)) - 30, y0 = Math.min(...d.blocks.map((b) => b.y)) - 30;
    const x1 = Math.max(...d.blocks.map((b) => b.x + size(b)[0])) + 30, y1 = Math.max(...d.blocks.map((b) => b.y + size(b)[1])) + 60;
    const k = Math.min(1.4, r.width / (x1 - x0), r.height / (y1 - y0));
    views[path.join('/')] = { k, x: (r.width - (x1 - x0) * k) / 2 - x0 * k, y: (r.height - (y1 - y0) * k) / 2 - y0 * k };
    render();
  }

  // Pointer interaction on the canvas
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    viewEl.focus({ preventScroll: true });
    const t = e.target;
    const p = toWorld(e);
    const portEl = t.closest?.('[data-port]');
    if (portEl?.dataset.port === 'out') {
      gesture = { kind: 'wire', from: portEl.dataset.k === '0' ? portEl.dataset.block : `${portEl.dataset.block}:${portEl.dataset.k}`, start: p };
      svg.setPointerCapture(e.pointerId);
      return;
    }
    const wireEl = t.closest?.('[data-wire]');
    if (wireEl) { sel.clear(); wireSel = Number(wireEl.dataset.wire); render(); return; }
    const blkEl = t.closest?.('[data-block]');
    if (blkEl) {
      // A single-model plant becomes a diagram before its blocks can move.
      if (app.project.system.plant?.type !== 'diagram') app.setPlant(normalizeDiagram(rootDiagram()));
      const id = blkEl.dataset.block;
      // Double-click, detected here: the first click re-renders the canvas,
      // so the browser's dblclick would lose its target.
      const now = performance.now();
      if (lastClick.id === id && now - lastClick.t < 400) {
        lastClick = { id: null, t: 0 };
        const blk = level().blocks.find((x) => x.id === id);
        // preventDefault keeps this mouse-down from moving focus off the new field.
        if (blk?.type === 'source' || blk?.type === 'sink') { e.preventDefault(); renameOnCanvas(blk); }
        else if (blk?.type === 'switch') edit((d) => { const s2 = d.blocks.find((x) => x.id === id); s2.params.position = (s2.params.position % s2.params.inputs) + 1; });
        else if (blk?.type === 'controller') app.openController([...path, id]);
        else enter(id);
        return;
      }
      lastClick = { id, t: now };
      if (e.shiftKey) { if (sel.has(id)) sel.delete(id); else sel.add(id); }
      else if (!sel.has(id)) sel = new Set([id]);
      wireSel = -1;
      gesture = { kind: 'move', last: p, moved: false };
      svg.setPointerCapture(e.pointerId);
      render();
      return;
    }
    svg.setPointerCapture(e.pointerId);
    if (e.shiftKey) gesture = { kind: 'marquee', start: p, end: p };
    else gesture = { kind: 'pan', x: e.clientX, y: e.clientY, moved: false };
  });

  svg.addEventListener('pointermove', (e) => {
    if (!gesture) return;
    const p = toWorld(e);
    if (gesture.kind === 'pan') {
      const v = view();
      v.x += e.clientX - gesture.x; v.y += e.clientY - gesture.y;
      gesture.x = e.clientX; gesture.y = e.clientY; gesture.moved = true;
      svg.firstElementChild.nextElementSibling.setAttribute('transform', `translate(${v.x},${v.y}) scale(${v.k})`);
      return;
    }
    if (gesture.kind === 'move') {
      const dx = p.x - gesture.last.x, dy = p.y - gesture.last.y;
      if (!gesture.moved && Math.hypot(dx, dy) < 2) return;
      if (!gesture.moved) app.beginEdit();
      gesture.moved = true;
      gesture.last = p;
      // Moving changes no dynamics: blocks move in place, committed on release.
      for (const b of level().blocks) if (sel.has(b.id)) { b.x += dx; b.y += dy; }
      render();
      return;
    }
    const temp = svg.querySelector('#pl-temp');
    if (gesture.kind === 'wire') {
      temp.innerHTML = `<path class="wire-temp" d="M${gesture.start.x},${gesture.start.y} L${p.x},${p.y}"/>`;
      return;
    }
    if (gesture.kind === 'marquee') {
      gesture.end = p;
      const x = Math.min(gesture.start.x, p.x), y = Math.min(gesture.start.y, p.y);
      temp.innerHTML = `<rect class="marquee" x="${x}" y="${y}" width="${Math.abs(p.x - gesture.start.x)}" height="${Math.abs(p.y - gesture.start.y)}"/>`;
    }
  });

  svg.addEventListener('pointerup', (e) => {
    const g = gesture;
    gesture = null;
    if (!g) return;
    if (g.kind === 'move') {
      if (g.moved) {
        for (const b of level().blocks) if (sel.has(b.id)) { b.x = Math.round(b.x); b.y = Math.round(b.y); }
        app.endEdit();
        app.plantMoved();
      }
      return;
    }
    if (g.kind === 'pan') { if (!g.moved) { sel.clear(); wireSel = -1; } render(); return; }
    if (g.kind === 'wire') {
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-port="in"]');
      if (target) {
        const to = target.dataset.k === '0' ? target.dataset.block : `${target.dataset.block}:${target.dataset.k}`;
        edit((d) => { d.wires = d.wires.filter((w) => w.to !== to); d.wires.push({ from: g.from, to }); });
      } else render();
      return;
    }
    if (g.kind === 'marquee') {
      const x0 = Math.min(g.start.x, g.end.x), x1 = Math.max(g.start.x, g.end.x), y0 = Math.min(g.start.y, g.end.y), y1 = Math.max(g.start.y, g.end.y);
      sel = new Set(level().blocks.filter((b) => { const [w, h] = size(b); return b.x >= x0 && b.y >= y0 && b.x + w <= x1 && b.y + h <= y1; }).map((b) => b.id));
      wireSel = -1;
      render();
    }
  });


  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const v = view(), r = svg.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = Math.min(3, Math.max(0.25, v.k * Math.exp(-e.deltaY * 0.0015)));
    v.x = mx - ((mx - v.x) * k) / v.k; v.y = my - ((my - v.y) * k) / v.k; v.k = k;
    render();
  }, { passive: false });

  $('#pl-group').addEventListener('click', group);
  $('#pl-del').addEventListener('click', remove);
  $('#pl-fit').addEventListener('click', fit);

  // Keys while the Plant tab is open. Returns true when the key was used.
  function handleKey(e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && (sel.size || wireSel >= 0)) { remove(); return true; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') { group(); return true; }
    if (e.key === 'Escape') {
      if (sel.size || wireSel >= 0) { sel.clear(); wireSel = -1; render(); return true; }
      if (path.length) { path = path.slice(0, -1); render(); return true; }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { sel = new Set(level().blocks.map((b) => b.id)); render(); return true; }
    return false;
  }

  let first = true;
  return {
    render() { renderLibrary(); render(); },
    shown() { renderLibrary(); if (rep >= 0) showRep(rep); else render(); if (first) { first = false; fit(); } },
    hidden() { scene.stop(); },
    // The representation by name ('' or unknown: the diagram); shown when the tab is.
    view(name) { rep = plantViews().findIndex((v) => v.name === name); },
    viewName() { return rep >= 0 ? plantViews()[rep]?.name ?? '' : ''; },
    fit,
    handleKey,
    reset() { path = []; sel.clear(); wireSel = -1; first = true; if (rep >= 0) { rep = -1; scene.stop(); viewEl.hidden = false; $('#pl-scene').hidden = true; for (const id of ['#pl-crumbs', '#pl-group', '#pl-del', '#pl-fit']) $(id).hidden = false; } },
  };
}

