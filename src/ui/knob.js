// A rotary knob for one block parameter. Drag up/down (Shift: fine), scroll,
// arrow keys, double-click to reset, click the value to type one.

import { fmt } from '../core/project.js';

const SWEEP = 270;
const OFF = 0.04; // log0: the bottom of the travel is "off" (0)

export function knobPos(param, value, max) {
  const { min, scale } = param;
  if (scale === 'lin') return clamp01((value - min) / (max - min));
  if (scale === 'log0' && !(value > 0)) return 0;
  const p = Math.log(Math.max(value, min) / min) / Math.log(max / min);
  return scale === 'log0' ? OFF + (1 - OFF) * clamp01(p) : clamp01(p);
}

export function knobValue(param, pos, max) {
  const { min, scale } = param;
  let v;
  if (scale === 'lin') v = min + pos * (max - min);
  else if (scale === 'log0') v = pos < OFF ? 0 : min * Math.pow(max / min, (pos - OFF) / (1 - OFF));
  else v = min * Math.pow(max / min, pos);
  if (param.int) v = Math.round(v);
  else if (v !== 0) v = Number(v.toPrecision(4));
  return v;
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }

const NS = 'http://www.w3.org/2000/svg';
function arcPath(a0, a1, r = 17) {
  const p = (a) => [22 + r * Math.sin(a), 22 - r * Math.cos(a)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

// opts: { param, value, max, color, onInput(v), onCommit(v), onStart() }
export function createKnob(opts) {
  const { param } = opts;
  let value = opts.value;
  const max = opts.max;
  const root = document.createElement('div');
  root.className = 'knob';
  const unit = param.unit ? ` ${param.unit}` : '';
  root.title = `${param.label}${unit ? ` (${param.unit})` : ''} · drag, scroll or use arrow keys · Shift for fine · double-click to reset`;
  const label = document.createElement('div');
  label.className = 'kl';
  label.textContent = param.label;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 44 44');
  svg.setAttribute('tabindex', '0');
  svg.setAttribute('role', 'slider');
  svg.setAttribute('aria-label', param.label);
  if (opts.color) svg.style.setProperty('--kc', opts.color);
  const a0 = (-SWEEP / 2) * Math.PI / 180, a1 = (SWEEP / 2) * Math.PI / 180;
  const track = document.createElementNS(NS, 'path');
  track.setAttribute('class', 'track');
  track.setAttribute('d', arcPath(a0, a1));
  const arc = document.createElementNS(NS, 'path');
  arc.setAttribute('class', 'val');
  const cap = document.createElementNS(NS, 'circle');
  cap.setAttribute('class', 'cap');
  cap.setAttribute('cx', 22); cap.setAttribute('cy', 22); cap.setAttribute('r', 11.5);
  const ptr = document.createElementNS(NS, 'line');
  ptr.setAttribute('class', 'ptr');
  svg.append(track, arc, cap, ptr);
  const input = document.createElement('input');
  input.className = 'kv';
  input.setAttribute('aria-label', `${param.label} value`);
  input.spellcheck = false;
  root.append(label, svg, input);

  function show() {
    const pos = knobPos(param, value, max);
    const a = a0 + pos * (a1 - a0);
    // Lin knobs that span zero draw their arc from the centre.
    const zeroPos = param.scale === 'lin' && param.min < 0 && max > 0 ? knobPos(param, 0, max) : 0;
    const az = a0 + zeroPos * (a1 - a0);
    const lo = Math.min(a, az), hi = Math.max(a, az);
    arc.setAttribute('d', hi - lo > 0.01 ? arcPath(lo, hi) : '');
    ptr.setAttribute('x1', 22 + 4 * Math.sin(a)); ptr.setAttribute('y1', 22 - 4 * Math.cos(a));
    ptr.setAttribute('x2', 22 + 10 * Math.sin(a)); ptr.setAttribute('y2', 22 - 10 * Math.cos(a));
    const text = param.scale === 'log0' && value === 0 ? 'off' : fmt(value);
    if (document.activeElement !== input) input.value = text;
    svg.setAttribute('aria-valuenow', String(value));
    svg.setAttribute('aria-valuetext', `${text}${unit}`);
  }

  function setFromPos(pos, commit) {
    const v = knobValue(param, clamp01(pos), max);
    if (v !== value) { value = v; show(); opts.onInput(v); }
    if (commit) opts.onCommit(value);
  }

  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    svg.focus();
    svg.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, pos: knobPos(param, value, max) };
    root.classList.add('active');
    opts.onStart?.();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const k = e.shiftKey ? 1 / 3000 : 1 / 320;
    drag.pos = clamp01(drag.pos + (drag.y - e.clientY + (e.clientX - drag.x)) * k);
    drag.x = e.clientX; drag.y = e.clientY;
    setFromPos(drag.pos, false);
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    root.classList.remove('active');
    opts.onCommit(value);
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('dblclick', () => { opts.onStart?.(); value = param.default; show(); opts.onInput(value); opts.onCommit(value); });

  let wheelTimer = null;
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!wheelTimer) opts.onStart?.();
    clearTimeout(wheelTimer);
    const step = (e.shiftKey ? 0.002 : 0.015) * (e.deltaY < 0 ? 1 : -1);
    setFromPos(knobPos(param, value, max) + step, false);
    wheelTimer = setTimeout(() => { wheelTimer = null; opts.onCommit(value); }, 350);
  }, { passive: false });

  svg.addEventListener('keydown', (e) => {
    const steps = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 };
    let pos = null;
    if (e.key in steps) pos = knobPos(param, value, max) + steps[e.key] * (e.shiftKey ? 0.002 : 0.01);
    else if (e.key === 'Home') pos = 0;
    else if (e.key === 'End') pos = 1;
    if (pos === null) return;
    e.preventDefault();
    e.stopPropagation();
    opts.onStart?.();
    if (param.int) {
      const dir = Math.sign(pos - knobPos(param, value, max));
      const v = Math.min(max, Math.max(param.min, value + dir));
      if (v !== value) { value = v; show(); opts.onInput(v); }
      opts.onCommit(value);
    } else setFromPos(pos, true);
  });

  input.addEventListener('focus', () => { input.select(); });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { show(); input.dataset.cancel = '1'; input.blur(); }
  });
  input.addEventListener('blur', () => {
    if (input.dataset.cancel) { delete input.dataset.cancel; show(); return; }
    const txt = input.value.trim().toLowerCase();
    const v = txt === 'off' ? 0 : Number(txt.replace(',', '.').replace('−', '-'));
    if (!Number.isFinite(v)) { show(); return; }
    if (v !== value) { opts.onStart?.(); value = param.int ? Math.round(v) : v; opts.onInput(value); opts.onCommit(value); }
    show();
  });

  show();
  return { el: root, set(v) { value = v; show(); } };
}
