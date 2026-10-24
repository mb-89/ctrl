// The rack: the block diagram of the loop, and below it one module per slot
// with its type selector and knobs. The controller module edits the selected
// candidate; every other module edits the shared system (or the candidate's
// own override of that slot, if it has one).

import { SLOTS, BLOCKS, blockDef, paramMax } from '../core/blocks.js';
import { fmt } from '../core/project.js';
import { createKnob } from './knob.js';

const SIM_PARAMS = [
  { key: 'duration', label: 'length', default: 20, min: 0.1, max: 1000, scale: 'log', unit: 's' },
  { key: 'sampleTime', label: 'Ts', default: 0.01, min: 0.0001, max: 1, scale: 'log', unit: 's' },
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function summary(block, n = 3) {
  const def = blockDef(block.slot, block.type);
  return def.params.filter((p) => p.kind !== 'vector').slice(0, n)
    .map((p) => `${p.label} ${def.params.length && p.scale === 'log0' && block.params[p.key] === 0 ? 'off' : fmt(block.params[p.key])}`).join(' · ');
}

export function createRack(root, app) {
  const diagramWrap = document.createElement('div');
  diagramWrap.className = 'diagram-wrap';
  const modules = document.createElement('div');
  modules.className = 'modules';
  root.append(diagramWrap, modules);
  const moduleEls = {};

  function blockFor(slot) {
    const p = app.project, c = app.candidate;
    if (slot === 'controller') return c ? { ...c.controller, slot } : null;
    return { ...(c?.[slot] ?? p.system[slot]), slot };
  }

  function drawDiagram() {
    const c = app.candidate;
    const b = Object.fromEntries(SLOTS.map((s) => [s.key, blockFor(s.key)]));
    const box = (slot, x, y, w, h) => {
      const blk = b[slot];
      const def = blk ? blockDef(slot, blk.type) : null;
      const color = slot === 'controller' && c ? app.colorOf(c) : null;
      const label = SLOTS.find((s) => s.key === slot).label.toUpperCase();
      return `<g class="blk" data-slot="${slot}" tabindex="0" role="button" aria-label="${label}: ${esc(def ? def.label : 'none')}">
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" ${color ? `style="stroke:${color};stroke-width:2"` : ''}></rect>
        <text class="t-slot" x="${x + 8}" y="${y + 13}">${label}</text>
        <text class="t-type" x="${x + 8}" y="${y + 29}">${esc(def ? def.label : '—')}</text>
        <text class="t-par" x="${x + 8}" y="${y + h - 7}">${esc(blk ? summary(blk, slot === 'controller' ? 3 : 2) : '')}</text>
      </g>`;
    };
    const arrow = (x, y, dir = 'r') => {
      const p = { r: `${x},${y} ${x - 7},${y - 4} ${x - 7},${y + 4}`, d: `${x},${y} ${x - 4},${y - 7} ${x + 4},${y - 7}`, u: `${x},${y} ${x - 4},${y + 7} ${x + 4},${y + 7}` }[dir];
      return `<polygon class="arrow" points="${p}"></polygon>`;
    };
    const wire = (d) => `<path class="wire" d="${d}"></path>`;
    const sum = (x, y) => `<circle class="sum" cx="${x}" cy="${y}" r="10"></circle><path class="wire" d="M${x - 5},${y} H${x + 5} M${x},${y - 5} V${y + 5}"></path>`;
    const t = (x, y, s, cls = 't-sig', anchor = 'middle') => `<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${s}</text>`;
    const Y = 82, FB = 138;
    const noiseOn = b.noise.type !== 'none';
    const svg = `<svg class="diagram" viewBox="0 0 1000 164" role="group" aria-label="Block diagram of the control loop">
      ${box('reference', 6, Y - 25, 128, 50)}
      ${wire(`M134,${Y} H150`)}${arrow(150, Y)}
      ${sum(160, Y)}
      ${t(150, Y + 22, '−')}
      ${wire(`M170,${Y} H203`)}${arrow(203, Y)}${t(186, Y - 6, 'e')}
      ${box('controller', 203, Y - 30, 176, 60)}
      ${wire(`M379,${Y} H407`)}${arrow(407, Y)}${t(393, Y - 6, 'u')}
      ${box('actuator', 407, Y - 25, 130, 50)}
      ${wire(`M537,${Y} H565`)}${arrow(565, Y)}
      ${sum(575, Y)}
      ${box('disturbance', 515, 1, 120, 46)}
      ${wire(`M575,47 V${Y - 10}`)}${arrow(575, Y - 10, 'd')}${t(583, Y - 16, 'd', 't-sig', 'start')}
      ${wire(`M585,${Y} H613`)}${arrow(613, Y)}
      ${box('plant', 613, Y - 25, 160, 50)}
      ${wire(`M773,${Y} H850`)}${arrow(850, Y)}
      <circle cx="812" cy="${Y}" r="2.6" class="arrow"></circle>
      ${t(864, Y + 4, 'y', 't-sig', 'start')}
      ${wire(`M812,${Y} V${FB} H735`)}<polygon class="arrow" points="728,${FB} 735,${FB - 4} 735,${FB + 4}"></polygon>
      ${box('sensor', 600, FB - 22, 128, 44)}
      ${wire(`M600,${FB} H160 V${Y + 10}`)}${arrow(160, Y + 10, 'u')}
      ${t(330, FB - 6, 'y<tspan baseline-shift="sub" font-size="8">m</tspan>')}
      ${noiseOn ? `${sum(470, FB)}${wire(`M470,${FB + 24} V${FB + 10}`)}<polygon class="arrow" points="470,${FB + 10} 466,${FB + 17} 474,${FB + 17}"></polygon>
        <g class="blk lite" data-slot="noise" tabindex="0" role="button" aria-label="Noise: ${esc(blockDef('noise', b.noise.type).label)}">
          <rect x="480" y="${FB + 8}" width="110" height="18" rx="3" style="fill:transparent;stroke:none"></rect>
          ${t(484, FB + 21, `n · ${esc(summary(b.noise, 1))}`, 't-par', 'start')}
        </g>` : ''}
    </svg>`;
    diagramWrap.innerHTML = svg;
    diagramWrap.querySelectorAll('.blk').forEach((g) => {
      const slot = g.dataset.slot;
      const go = () => focusModule(slot);
      g.addEventListener('click', go);
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      g.addEventListener('pointerenter', () => moduleEls[slot]?.classList.add('hl'));
      g.addEventListener('pointerleave', () => moduleEls[slot]?.classList.remove('hl'));
    });
  }

  function focusModule(slot) {
    const m = moduleEls[slot];
    if (!m) return;
    m.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    m.classList.add('flash');
    setTimeout(() => m.classList.remove('flash'), 600);
    m.querySelector('svg[role="slider"], select')?.focus({ preventScroll: true });
  }

  function makeModule(slot) {
    const meta = SLOTS.find((s) => s.key === slot);
    const blk = blockFor(slot);
    const el = document.createElement('div');
    el.className = 'module';
    el.dataset.slot = slot;
    if (!blk) { el.innerHTML = `<div class="mod-head"><span class="label">${meta.label}</span></div><div class="empty">Add a candidate first.</div>`; return el; }
    const def = blockDef(slot, blk.type);
    const cand = app.candidate;
    const color = slot === 'controller' ? app.colorOf(cand) : null;
    if (color) { el.classList.add('cand'); el.style.setProperty('--c', color); }

    const head = document.createElement('div');
    head.className = 'mod-head';
    const lab = document.createElement('span');
    lab.className = 'label';
    lab.textContent = meta.label;
    if (slot === 'controller') lab.title = `Edits the selected candidate, ${cand.name}`;
    const sel = document.createElement('select');
    sel.className = 'mod-type';
    sel.id = `type-${slot}`;
    sel.setAttribute('aria-label', `${meta.label} type`);
    for (const [type, d] of Object.entries(BLOCKS[slot])) {
      const o = document.createElement('option');
      o.value = type; o.textContent = d.label;
      sel.append(o);
    }
    sel.value = blk.type;
    sel.addEventListener('change', () => app.retype(slot, sel.value));
    head.append(lab, sel);
    if (slot === 'controller') {
      const tune = document.createElement('button');
      tune.className = 'btn small';
      tune.id = 'tune-btn';
      tune.textContent = app.tuning ? 'Stop' : 'Auto-tune';
      tune.title = 'Search the tunable gains for the best score under the goal; the result becomes a new candidate (T)';
      tune.addEventListener('click', () => app.toggleTune());
      head.append(tune);
    }
    el.append(head);

    if (slot !== 'controller' && cand?.[slot]) {
      const who = document.createElement('div');
      who.className = 'mod-cand';
      who.textContent = `Only for ${cand.name}`;
      el.append(who);
    }
    const f = document.createElement('div');
    f.className = 'mod-formula';
    f.textContent = def.formula;
    f.title = def.formula;
    el.append(f);

    const knobs = document.createElement('div');
    knobs.className = 'knobs';
    const ctx = { duration: app.project.sim.duration };
    for (const p of def.params) {
      if (p.kind === 'vector') knobs.append(vectorField(slot, p, blk.params[p.key]));
      else {
        const k = createKnob({
          param: p, value: blk.params[p.key], max: paramMax(p, ctx), color,
          onStart: () => app.beginEdit(),
          onInput: (v) => app.setParam(slot, p.key, v, true),
          onCommit: (v) => app.setParam(slot, p.key, v, false),
        });
        knobs.append(k.el);
      }
    }
    el.append(knobs);
    el.addEventListener('pointerenter', () => diagramWrap.querySelector(`.blk[data-slot="${slot}"]`)?.classList.add('hl'));
    el.addEventListener('pointerleave', () => diagramWrap.querySelector(`.blk[data-slot="${slot}"]`)?.classList.remove('hl'));
    return el;
  }

  function vectorField(slot, p, value) {
    const wrap = document.createElement('label');
    wrap.className = 'vec';
    const lab = document.createElement('span');
    lab.className = 'kl';
    lab.style.fontSize = '11.5px';
    lab.style.color = 'var(--ink-2)';
    lab.textContent = `${p.label} (highest power first)`;
    const input = document.createElement('input');
    input.className = 'field';
    input.id = `vec-${slot}-${p.key}`;
    input.value = value.join(', ');
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') input.blur(); });
    input.addEventListener('change', () => {
      const parts = input.value.split(/[\s,;]+/).filter(Boolean).map((x) => Number(x.replace('−', '-')));
      if (!parts.length || !parts.every(Number.isFinite)) { input.classList.add('err'); app.toast('Enter numbers separated by commas, highest power of s first.'); return; }
      input.classList.remove('err');
      app.beginEdit();
      if (!app.setParam(slot, p.key, parts, false)) input.classList.add('err');
    });
    wrap.append(lab, input);
    return wrap;
  }

  function simModule() {
    const el = document.createElement('div');
    el.className = 'module';
    el.innerHTML = '<div class="mod-head"><span class="label">Simulation</span></div><div class="mod-formula">window and controller sample time</div>';
    const knobs = document.createElement('div');
    knobs.className = 'knobs';
    for (const p of SIM_PARAMS) {
      const k = createKnob({
        param: p, value: app.project.sim[p.key], max: p.max,
        onStart: () => app.beginEdit(),
        onInput: (v) => app.setSim(p.key, v, true),
        onCommit: (v) => app.setSim(p.key, v, false),
      });
      knobs.append(k.el);
    }
    el.append(knobs);
    return el;
  }

  function render() {
    drawDiagram();
    const focused = document.activeElement;
    const focusId = focused && modules.contains(focused) ? focused.id : null;
    modules.textContent = '';
    for (const s of SLOTS) {
      const el = makeModule(s.key);
      moduleEls[s.key] = el;
      modules.append(el);
    }
    modules.append(simModule());
    if (focusId) document.getElementById(focusId)?.focus();
  }

  return { render, refresh: drawDiagram, focusModule };
}
