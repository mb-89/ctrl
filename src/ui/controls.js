// The control panel right of the display: Run Control, Horizontal, Vertical.
// Every knob has a readout below it; click the readout to type a value
// ("20m", "100 ms", "-0.4").

import { createDial } from './dial.js';
import { CHANNEL_COLORS } from './display.js';
import { siUnit, num, parseSI } from './units.js';
import { step125 } from '../core/scale.js';

export function createControls(root, app) {
  root.innerHTML = `
    <section class="group">
      <h3 class="glabel">Run Control</h3>
      <div class="row">
        <button class="key runstop" id="k-run" title="Run / Stop (R)">Run<br>Stop</button>
        <button class="key single" id="k-single" title="One sweep, then stop (S)">Single</button>
        <button class="key auto" id="k-auto" title="Fit the display to one period of the input (A)">Auto<br>Scale</button>
      </div>
    </section>
    <section class="group">
      <h3 class="glabel">Horizontal</h3>
      <div class="row dials" id="h-dials"></div>
    </section>
    <section class="group">
      <h3 class="glabel">Vertical</h3>
      <div class="row chkeys" id="ch-keys"></div>
      <label class="srcrow"><span>Source</span><select id="ch-src" class="field"></select></label>
      <div class="row dials" id="v-dials"></div>
    </section>`;
  const $ = (s) => root.querySelector(s);

  $('#k-run').addEventListener('click', () => app.toggleRun());
  $('#k-single').addEventListener('click', () => app.single());
  $('#k-auto').addEventListener('click', () => app.autoScale());

  const tb = () => app.project.scope.timebase;
  const ch = () => app.project.scope.channels[app.channel];
  const round = (v) => Number(v.toPrecision(6));
  const setScope = (fn) => { const ok = app.editScope(fn); app.endEdit(); return ok; };

  // One knob with its label and an editable readout.
  function knob({ id, label, size, title, turn, push, read, write, unit = '' }) {
    const dial = createDial({
      size, label, title,
      onTurn: (s, fine) => app.editScope((sc) => turn(sc, s, fine)),
      onPush: push && (() => setScope(push)),
      onRelease: () => app.endEdit(),
    });
    const wrap = document.createElement('div');
    wrap.className = 'dialbox';
    const lab = document.createElement('div');
    lab.className = 'dlabel';
    lab.textContent = label;
    const val = document.createElement('input');
    val.className = 'dval';
    val.id = id;
    val.spellcheck = false;
    val.setAttribute('aria-label', `${label} value`);
    val.title = 'Click to type a value';
    val.addEventListener('focus', () => val.select());
    val.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') val.blur();
      if (e.key === 'Escape') { val.dataset.cancel = '1'; val.blur(); }
    });
    val.addEventListener('blur', () => {
      if (val.dataset.cancel) { delete val.dataset.cancel; render(); return; }
      const v = parseSI(val.value, unit);
      if (!Number.isFinite(v)) { app.toast(`Type a number, optionally with a prefix: 20m, 100 m${unit}, 2u`); render(); return; }
      write(v);
      render();
    });
    wrap.append(lab, dial.el, val);
    return { wrap, lab, val, read };
  }

  const positive = (fn) => (v) => (v > 0 ? setScope((sc) => fn(sc, v)) : app.toast('The scale must be above 0.'));
  const knobs = {
    hScale: knob({
      id: 'v-hscale', label: 'Scale', size: 48, unit: 's', title: 'Seconds per division · drag, scroll or arrow keys',
      turn: (sc, s) => { for (let i = 0; i < Math.abs(s); i++) sc.timebase.scale = step125(sc.timebase.scale, -Math.sign(s)); },
      read: () => `${siUnit(tb().scale, 's')}/div`,
      write: positive((sc, v) => { sc.timebase.scale = v; }),
    }),
    hPos: knob({
      id: 'v-hpos', label: 'Position', size: 36, unit: 's', title: 'Time at the left edge · double-click to zero',
      turn: (sc, s, fine) => { sc.timebase.position = round(sc.timebase.position + s * sc.timebase.scale * (fine ? 0.02 : 0.1)); },
      push: (sc) => { sc.timebase.position = 0; },
      read: () => siUnit(tb().position, 's', 4),
      write: (v) => setScope((sc) => { sc.timebase.position = v; }),
    }),
    vScale: knob({
      id: 'v-vscale', label: 'Scale', size: 48, title: 'Units per division of the selected channel',
      turn: (sc, s) => { const c = sc.channels[app.channel]; for (let i = 0; i < Math.abs(s); i++) c.scale = step125(c.scale, -Math.sign(s)); },
      read: () => `${num(ch().scale)} ${app.unitOf(ch().source)}/div`,
      write: positive((sc, v) => { sc.channels[app.channel].scale = v; }),
    }),
    vPos: knob({
      id: 'v-vpos', label: 'Position', size: 36, title: 'Offset of the selected channel · double-click to zero',
      turn: (sc, s, fine) => { const c = sc.channels[app.channel]; c.offset = round(c.offset + s * c.scale * (fine ? 0.02 : 0.1)); },
      push: (sc) => { sc.channels[app.channel].offset = 0; },
      read: () => `${num(ch().offset)} ${app.unitOf(ch().source)}`,
      write: (v) => setScope((sc) => { sc.channels[app.channel].offset = v; }),
    }),
  };
  $('#h-dials').append(knobs.hScale.wrap, knobs.hPos.wrap);
  $('#v-dials').append(knobs.vScale.wrap, knobs.vPos.wrap);

  const keys = $('#ch-keys');
  CHANNEL_COLORS.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'key ch';
    b.style.setProperty('--cc', c);
    b.textContent = String(i + 1);
    b.title = `Channel ${i + 1}: select; press again to turn off`;
    b.addEventListener('click', () => app.channelKey(i));
    keys.append(b);
  });
  const src = $('#ch-src');
  // Picking a source switches the channel on; "none" switches it off.
  src.addEventListener('change', () => setScope((sc) => { const c = sc.channels[app.channel]; c.source = src.value; c.on = src.value !== ''; }));

  let mode = 'stop';
  function render(m = mode) {
    mode = m;
    const sc = app.project.scope;
    $('#k-run').className = `key runstop ${mode === 'stop' ? 'lit-red' : 'lit-green'}`;
    $('#k-single').className = `key single ${mode === 'single' ? 'lit-amber' : ''}`;
    for (const k of Object.values(knobs)) if (document.activeElement !== k.val) k.val.value = k.read();
    root.style.setProperty('--sel', CHANNEL_COLORS[app.channel]);
    [...keys.children].forEach((b, i) => {
      b.classList.toggle('lit', sc.channels[i].on);
      b.classList.toggle('sel', i === app.channel);
      b.setAttribute('aria-pressed', String(sc.channels[i].on));
    });
    const names = [...new Set([...app.signalNames(), ch().source].filter(Boolean))];
    if (src.dataset.names !== names.join(',') + '|' + names.map(app.unitOf).join(',')) {
      src.innerHTML = '<option value="">— none</option>' + names.map((n) => `<option value="${n}">${n}${app.unitOf(n) === '1' ? '' : ` (${app.unitOf(n)})`}</option>`).join('');
      src.dataset.names = names.join(',');
    }
    src.value = ch().source;
    src.dataset.names = names.join(',') + '|' + names.map(app.unitOf).join(',');
    knobs.vScale.lab.textContent = `Scale · ${app.channel + 1}`;
    knobs.vPos.lab.textContent = `Position · ${app.channel + 1}`;
  }

  return { render };
}
