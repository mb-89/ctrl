// Speed, in the header bar: how fast simulated time runs (the person,
// 2026-10-24: "normally it is 1x, but we can also increase it to like 5x or
// 10x or infinite … with a -1 would be infinite … And also show how fast the
// time is actually running"). A factor with presets and a typed value, and
// beside it the achieved speed, measured from what really ran (core/speed.js).
// The sweep (ui/display.js) and Auto-tune (ui/autotune.js) run at it, never
// faster than the page simulates (∞ is that speed); with a live plant
// connected it is held at 1×, as the plant owns the clock (ui/live.js), shown
// by a lock and "live" beside the readout, and a tap says why. The setting
// travels with the project as ui.speed.
// See design/output/instrument.md#speed.

import { SPEED_PRESETS, AS_FAST, parseSpeed, formatSpeed, formatAchieved, createSpeedMeter, stepPreset, paceOf } from '../core/speed.js';

const NOTES = new Map([[0.1, 'slow motion'], [1, 'real time'], [AS_FAST, 'as fast as possible']]);
const HELP = 'Speed: simulated seconds per second. 1× is real time. Type a factor (5, 0.1, 20) or -1 or inf for as fast as possible (∞); ↑ ↓ step through the presets, Esc goes back.';

export function createSpeed(app) {
  const $ = (id) => document.getElementById(id);
  const box = $('speed'), inp = $('speed-in'), btn = $('speed-menu'), pop = $('speed-pop'), got = $('speed-got');
  const meter = createSpeedMeter(1);
  let set = 1;      // the setting: a factor, or AS_FAST
  let lock = null;  // why it is held at 1×, or null
  let before = 1;   // the setting when the field took the focus, for Esc

  const effective = () => (lock ? 1 : set);

  function render() {
    const was = lock;
    lock = app.speedLock?.() ?? null;
    if (!was !== !lock) meter.reset();  // the plant's clock and the page's are not one reading
    if (document.activeElement !== inp || lock) inp.value = formatSpeed(effective());
    // Held: read-only, not disabled, so a click or tap can say why.
    inp.readOnly = !!lock;
    for (const el of [inp, btn]) el.setAttribute('aria-disabled', String(!!lock));
    box.classList.toggle('locked', !!lock);
    for (const el of [box, inp, btn]) el.title = lock ?? (el === btn ? 'Speed presets' : HELP);
    if (lock) closePop();
    readout();
  }

  // The achieved speed, a few times a second.
  function readout() {
    const r = meter.rate(performance.now() / 1000);
    const text = formatAchieved(r, { live: !!lock });
    if (got.textContent !== text) got.textContent = text;
    const sim = app.simRate?.(), held = !lock && effective() !== AS_FAST && paceOf(effective(), sim) < effective();
    got.classList.toggle('held', held);
    got.title = lock ? 'Achieved: the live plant\'s clock against this page\'s clock, over the last second. The plant runs in real time.'
      : 'Achieved: simulated seconds per second of wall-clock time, over the last second, as the sweep and Auto-tune really ran.'
        + (Number.isFinite(sim) ? ` This page simulates the screen at about ${formatAchieved(sim)} (timed); no speed runs faster, and ∞ runs at that.${held ? ' The speed set is faster, so it is held there.' : ''}` : '');
  }
  setInterval(readout, 250);

  function setSpeed(v) {
    const s = parseSpeed(v);
    if (s === null) return false;
    if (s !== set) { set = s; meter.reset(); app.speedChanged?.(); }
    render();
    return true;
  }

  // ---- Typing a factor
  inp.addEventListener('focus', () => { before = set; inp.select(); });
  inp.addEventListener('click', () => { if (lock) app.toast(lock); });
  inp.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') inp.blur();
    else if (lock) { if (e.key === 'Escape') inp.blur(); }
    // Esc undoes what was typed and the arrow keys' steps: the speed from before.
    else if (e.key === 'Escape') { setSpeed(before); inp.value = formatSpeed(effective()); inp.blur(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      setSpeed(stepPreset(set, e.key === 'ArrowUp' ? 1 : -1));
      inp.value = formatSpeed(set);
      inp.select();
    }
  });
  inp.addEventListener('blur', () => {
    if (lock) { render(); return; }
    if (inp.value.trim() === formatSpeed(set) || setSpeed(inp.value)) { render(); return; }
    app.toast('Speed: a factor above 0 (0.1, 5, 20), or -1 or inf for as fast as possible.');
    render();
  });

  // ---- The presets
  const items = () => [...pop.querySelectorAll('[role="menuitemradio"]')];
  function openPop() {
    if (lock) { app.toast(lock); return; }
    document.dispatchEvent(new MouseEvent('click'));  // one menu open at a time: the others close
    pop.innerHTML = SPEED_PRESETS.map((s) => `<button type="button" class="speed-item" role="menuitemradio" aria-checked="${s === set}" data-speed="${s === AS_FAST ? 'inf' : s}" tabindex="-1">
      <b>${formatSpeed(s)}</b><span>${NOTES.get(s) ?? ''}</span></button>`).join('');
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    (items().find((b) => b.getAttribute('aria-checked') === 'true') ?? items()[0]).focus();
  }
  function closePop(focusButton = false) {
    if (pop.hidden) return;
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (focusButton) btn.focus();
  }
  btn.addEventListener('click', (e) => { e.stopPropagation(); if (pop.hidden) openPop(); else closePop(); });
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); openPop(); }
  });
  pop.addEventListener('click', (e) => {
    e.stopPropagation();
    const b = e.target.closest('[data-speed]');
    if (!b) return;
    setSpeed(b.dataset.speed);
    closePop(true);
  });
  pop.addEventListener('keydown', (e) => {
    e.stopPropagation();
    const list = items(), i = list.indexOf(document.activeElement);
    const go = (k) => { e.preventDefault(); list[(k + list.length) % list.length].focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(list.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); closePop(true); }
    else if (e.key === 'Tab') closePop();
  });
  document.addEventListener('click', () => closePop());

  render();
  return {
    // The factor the clocks run at: the setting, or 1× while held.
    effective,
    get set() { return set; },
    setSpeed,
    // Simulated seconds that ran up to wall time t (seconds): the sweep each
    // frame, Auto-tune's computing at ∞, a live plant's clock.
    ran(t, seconds) { meter.add(t, seconds); },
    achieved: () => meter.rate(performance.now() / 1000),
    locked: () => lock,
    render,
  };
}

