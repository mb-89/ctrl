// Draggable separators: between the display and the setup tabs, and between
// the display and its controls. The sizes belong to the viewer, not the
// project: they live in this browser and do not change when a tab changes.

const KEY = 'loop-tuner:layout';
const MIN_SETUP = 110, MIN_TOP = 240, MIN_CONTROLS = 220, MAX_CONTROLS = 560, MIN_DISPLAY = 320;

// A popover just opened stays inside the window: moved sideways (and made
// narrower if it must) when its anchor would put it past an edge, as the
// System library's did on a narrow screen.
export function fitPopover(el, margin = 8) {
  el.style.translate = '';
  el.style.maxWidth = '';
  if (el.hidden) return;
  const W = document.documentElement.clientWidth;
  let r = el.getBoundingClientRect();
  if (r.width > W - 2 * margin) { el.style.maxWidth = `${W - 2 * margin}px`; r = el.getBoundingClientRect(); }
  const dx = r.left < margin ? margin - r.left : r.right > W - margin ? W - margin - r.right : 0;
  if (dx) el.style.translate = `${Math.round(dx)}px 0`;
}

export function createSplitters(shell) {
  const setup = shell.querySelector('.setup');
  const instrument = shell.querySelector('.instrument');
  const splitH = shell.querySelector('#split-h');
  const splitV = shell.querySelector('#split-v');
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') ?? {}; } catch { /* storage unavailable */ }
  const store = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* storage unavailable */ } };

  // The setup height defaults to what the Input tab needs, measured while it
  // is the open tab (a project may open on another tab).
  function naturalSetup() {
    if (shell.querySelector('#tab-input')?.hidden) return defaultSetup;
    shell.style.removeProperty('--setup-h');
    setup.style.height = 'auto';
    const h = setup.getBoundingClientRect().height;
    setup.style.height = '';
    return Math.ceil(h);
  }
  let defaultSetup = 0;
  defaultSetup = naturalSetup();
  const maxSetup = () => Math.max(MIN_SETUP, shell.getBoundingClientRect().height - MIN_TOP);
  const maxControls = () => Math.min(MAX_CONTROLS, instrument.getBoundingClientRect().width - MIN_DISPLAY);

  function apply() {
    const h = Math.round(Math.min(maxSetup(), Math.max(MIN_SETUP, saved.setupH ?? defaultSetup)));
    shell.style.setProperty('--setup-h', `${h}px`);
    if (saved.controlsW) shell.style.setProperty('--controls-w', `${Math.round(Math.min(maxControls(), Math.max(MIN_CONTROLS, saved.controlsW)))}px`);
    else shell.style.removeProperty('--controls-w');
    splitH.setAttribute('aria-valuenow', String(h));
  }

  function drag(el, axis, onMove) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('active');
      const start = axis === 'y' ? e.clientY : e.clientX;
      const base = axis === 'y' ? setup.getBoundingClientRect().height : shell.querySelector('.controls').getBoundingClientRect().width;
      const move = (ev) => { onMove(base - ((axis === 'y' ? ev.clientY : ev.clientX) - start)); apply(); };
      const up = () => { el.classList.remove('active'); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); store(); };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
  }
  drag(splitH, 'y', (v) => { saved.setupH = v; });
  drag(splitV, 'x', (v) => { saved.controlsW = v; });

  const keys = (el, prop, cur) => el.addEventListener('keydown', (e) => {
    const d = { ArrowUp: 16, ArrowLeft: 16, ArrowDown: -16, ArrowRight: -16 }[e.key];
    if (!d) return;
    e.preventDefault(); e.stopPropagation();
    saved[prop] = cur() + d;
    apply(); store();
  });
  keys(splitH, 'setupH', () => setup.getBoundingClientRect().height);
  keys(splitV, 'controlsW', () => shell.querySelector('.controls').getBoundingClientRect().width);
  splitH.addEventListener('dblclick', () => { delete saved.setupH; apply(); store(); });
  splitV.addEventListener('dblclick', () => { delete saved.controlsW; apply(); store(); });

  apply();
  document.fonts?.ready.then(() => { defaultSetup = naturalSetup(); apply(); });
  window.addEventListener('resize', apply);
  return {
    // A project's opening layout: the setup area's share of the page height,
    // set as if the viewer had dragged it there.
    setupShare() { return Math.round(100 * setup.getBoundingClientRect().height / shell.getBoundingClientRect().height) / 100; },
    setSetup(share) { saved.setupH = share * shell.getBoundingClientRect().height; apply(); store(); },
  };
}
