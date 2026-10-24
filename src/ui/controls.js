// The control panel right of the display: Run Control, Horizontal, Vertical.

import { createDial } from './dial.js';
import { CHANNEL_COLORS, SOURCE_LABEL } from './display.js';
import { siUnit, step125, num } from './units.js';
import { CHANNEL_SOURCES } from '../core/project.js';

export function createControls(root, app) {
  root.innerHTML = `
    <section class="group">
      <h3 class="glabel">Run Control</h3>
      <div class="row">
        <button class="key runstop" id="k-run" title="Run / Stop (R)">Run<br>Stop</button>
        <button class="key single" id="k-single" title="One sweep, then stop (S)">Single</button>
        <button class="key auto" id="k-auto" title="Fit the display to the data (A)">Auto<br>Scale</button>
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

  const readout = (dial, cls) => {
    const wrap = document.createElement('div');
    wrap.className = `dialbox ${cls ?? ''}`;
    const lab = document.createElement('div'); lab.className = 'dlabel';
    const val = document.createElement('div'); val.className = 'dval';
    wrap.append(lab, dial.el, val);
    return { wrap, lab, val };
  };

  const hScale = createDial({
    size: 64, label: 'Horizontal scale', title: 'Seconds per division · drag, scroll or arrow keys',
    onTurn: (s) => app.editScope((sc) => { for (let i = 0; i < Math.abs(s); i++) sc.timebase.scale = step125(sc.timebase.scale, -Math.sign(s)); }),
    onRelease: () => app.endEdit(),
  });
  const hPos = createDial({
    size: 44, label: 'Horizontal position', title: 'Time at the left edge · double-click to zero',
    onTurn: (s, fine) => app.editScope((sc) => { sc.timebase.position = round(sc.timebase.position + s * sc.timebase.scale * (fine ? 0.02 : 0.1)); }),
    onPush: () => { app.editScope((sc) => { sc.timebase.position = 0; }); app.endEdit(); },
    onRelease: () => app.endEdit(),
  });
  const vScale = createDial({
    size: 64, label: 'Vertical scale', title: 'Units per division of the selected channel',
    onTurn: (s) => app.editScope((sc) => { const ch = sc.channels[app.channel]; for (let i = 0; i < Math.abs(s); i++) ch.scale = step125(ch.scale, -Math.sign(s)); }),
    onRelease: () => app.endEdit(),
  });
  const vPos = createDial({
    size: 44, label: 'Vertical position', title: 'Offset of the selected channel · double-click to zero',
    onTurn: (s, fine) => app.editScope((sc) => { const ch = sc.channels[app.channel]; ch.offset = round(ch.offset + s * ch.scale * (fine ? 0.02 : 0.1)); }),
    onPush: () => { app.editScope((sc) => { sc.channels[app.channel].offset = 0; }); app.endEdit(); },
    onRelease: () => app.endEdit(),
  });
  const hs = readout(hScale), hp = readout(hPos, 'small'), vs = readout(vScale), vp = readout(vPos, 'small');
  hs.lab.textContent = 'Scale'; hp.lab.textContent = 'Position';
  vs.lab.textContent = 'Scale'; vp.lab.textContent = 'Position';
  $('#h-dials').append(hs.wrap, hp.wrap);
  $('#v-dials').append(vs.wrap, vp.wrap);

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
  for (const s of CHANNEL_SOURCES) { const o = document.createElement('option'); o.value = s; o.textContent = SOURCE_LABEL[s]; src.append(o); }
  src.addEventListener('change', () => { app.editScope((sc) => { sc.channels[app.channel].source = src.value; }); app.endEdit(); });

  function render(mode) {
    const sc = app.project.scope;
    const ch = sc.channels[app.channel];
    $('#k-run').className = `key runstop ${mode === 'stop' ? 'lit-red' : 'lit-green'}`;
    $('#k-single').className = `key single ${mode === 'single' ? 'lit-amber' : ''}`;
    hs.val.textContent = `${siUnit(sc.timebase.scale, 's')}/div`;
    hp.val.textContent = siUnit(sc.timebase.position, 's', 4);
    vs.val.textContent = `${num(ch.scale)}/div`;
    vp.val.textContent = num(ch.offset);
    root.style.setProperty('--sel', CHANNEL_COLORS[app.channel]);
    [...keys.children].forEach((b, i) => {
      b.classList.toggle('lit', sc.channels[i].on);
      b.classList.toggle('sel', i === app.channel);
      b.setAttribute('aria-pressed', String(sc.channels[i].on));
    });
    src.value = ch.source;
    vs.lab.textContent = `Scale · ${app.channel + 1}`;
    vp.lab.textContent = `Position · ${app.channel + 1}`;
  }

  return { render };
}

function round(v) { return Number(v.toPrecision(6)); }
