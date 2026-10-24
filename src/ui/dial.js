// An endless rotary encoder, like a scope's or a generator's knob: no end
// stops, every detent is one step. Drag up or right to turn clockwise, scroll,
// or use the arrow keys when focused. Double-click is the push.

const NS = 'http://www.w3.org/2000/svg';
const PX_PER_DETENT = 14;
const DEG_PER_DETENT = 18;

// opts: { size, label, onTurn(steps, fine), onPush(), title }
export function createDial(opts) {
  const size = opts.size ?? 52;
  const root = document.createElement('div');
  root.className = 'dial';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-50 -50 100 100');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('tabindex', '0');
  svg.setAttribute('role', 'slider');
  svg.setAttribute('aria-label', opts.label);
  if (opts.title) root.title = opts.title;
  // Knurled skirt, cap, indicator.
  let ticks = '';
  for (let i = 0; i < 36; i++) {
    const a = (i * 10 * Math.PI) / 180;
    ticks += `<line x1="${(46 * Math.sin(a)).toFixed(2)}" y1="${(-46 * Math.cos(a)).toFixed(2)}" x2="${(40 * Math.sin(a)).toFixed(2)}" y2="${(-40 * Math.cos(a)).toFixed(2)}"/>`;
  }
  svg.innerHTML = `<circle class="skirt" r="47"/><g class="knurl">${ticks}</g><circle class="cap" r="36"/><g class="rot"><circle class="dot" cx="0" cy="-26" r="4.5"/></g>`;
  const rot = svg.querySelector('.rot');
  root.append(svg);
  let angle = 0;
  const turn = (steps, fine) => {
    if (!steps) return;
    angle += steps * DEG_PER_DETENT;
    rot.setAttribute('transform', `rotate(${angle})`);
    opts.onTurn(steps, fine);
  };

  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    svg.focus();
    svg.setPointerCapture(e.pointerId);
    drag = { acc: 0, x: e.clientX, y: e.clientY };
    root.classList.add('active');
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.acc += (e.clientX - drag.x) + (drag.y - e.clientY);
    drag.x = e.clientX; drag.y = e.clientY;
    const steps = Math.trunc(drag.acc / PX_PER_DETENT);
    if (steps) { drag.acc -= steps * PX_PER_DETENT; turn(steps, e.shiftKey); }
  });
  const end = () => { drag = null; root.classList.remove('active'); opts.onRelease?.(); };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('dblclick', () => opts.onPush?.());
  let wheelAcc = 0;
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    wheelAcc += -e.deltaY;
    const unit = e.deltaMode === 1 ? 3 : 60;
    const steps = Math.trunc(wheelAcc / unit);
    if (steps) { wheelAcc -= steps * unit; turn(steps, e.shiftKey); opts.onRelease?.(); }
  }, { passive: false });
  svg.addEventListener('keydown', (e) => {
    const k = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 }[e.key];
    if (k) { e.preventDefault(); e.stopPropagation(); turn(k, e.shiftKey); opts.onRelease?.(); }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); opts.onPush?.(); }
  });
  return { el: root, svg };
}
