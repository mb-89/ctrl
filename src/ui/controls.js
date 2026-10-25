// The control panel right of the display: Run Control, Horizontal, Vertical.
// Every knob has a readout below it; click the readout to type a value
// ("20m", "100 ms", "-0.4").

import { createDial } from './dial.js';
import { siUnit, num, parseSI } from './units.js';
import { step125 } from '../core/scale.js';
import { withAboveNoise } from '../core/project.js';

export function createControls(root, app) {
  root.innerHTML = `
    <section class="group">
      <h3 class="label">Run Control</h3>
      <div class="keyrow">
        <button class="btn" id="k-run" title="Run / Stop (R)">Run<br>Stop</button>
        <button class="btn" id="k-single" title="One sweep, then stop (S)">Single</button>
        <button class="btn" id="k-auto" title="Fit the display to one period of the input (A)">Auto<br>Scale</button>
      </div>
      <div class="viewrow">
        <div class="seg seg-fill" id="view-keys" role="group" aria-label="Display mode">
          <button class="btn btn-sm" data-view="time" title="Signals over time">Time</button>
          <button class="btn btn-sm" data-view="fft" title="Amplitude spectrum of every channel (what has run so far)">FFT</button>
          <button class="btn btn-sm" data-view="spectrogram" title="The selected channel's spectrum over time, its trace on the right axis">Spectrogram</button>
          <button class="btn btn-sm" data-view="xy" title="XY: channel 1 across, the other channels against it (a Lissajous figure)">XY</button>
        </div>
        <button class="btn btn-sm btn-icon" id="k-delta" title="XY: draw channel 1 minus each channel (r on 1 and y on 2: the error e = r − y over r)">Δ</button>
      </div>
      <div class="srcrow" id="lv-mode" hidden><span class="flabel">Colour</span>
        <div class="seg seg-fill" role="group" aria-label="Spectrogram colour">
          <button class="btn btn-sm" id="lv-abs" title="Absolute: the colour is dB of the signal's unit (0 dB is 1 unit), the same everywhere">Absolute</button>
          <button class="btn btn-sm" id="lv-noise" title="Above noise: the colour is dB above the noise at each frequency, so a weak line where the noise is low shows as well as a strong one where it is high">Above noise</button></div></div>
      <div class="srcrow lvrow" id="lv-row" hidden><span class="flabel">Levels</span>
        <input class="field field-sm mono" data-lv="0" aria-label="Spectrogram floor, dB" title="Floor: below it black. Type a level in dB; ↑ ↓ step 1 dB, Shift 10 dB">
        <span class="muted">…</span>
        <input class="field field-sm mono" data-lv="1" aria-label="Spectrogram ceiling, dB" title="Ceiling: above it the brightest colour. Type a level in dB; ↑ ↓ step 1 dB, Shift 10 dB">
        <span class="muted">dB</span>
        <button class="btn btn-sm" id="lv-auto" title="Automatic levels: the ceiling at the largest amplitude shown, the floor 10 dB above the median (the noise); above the noise, 6 dB above it">Auto</button></div>
    </section>
    <section class="group">
      <h3 class="label">Horizontal</h3>
      <div class="row dials" id="h-dials"></div>
    </section>
    <section class="group">
      <h3 class="label">Vertical</h3>
      <div class="chkeys" id="ch-keys" role="group" aria-label="Channels"></div>
      <div class="srcrow"><span class="flabel">Source</span><select id="ch-src" class="field field-sm"></select><button class="btn btn-sm" id="ch-right" title="Show this channel's values on a second axis at the right of the screen">R axis</button><button class="btn btn-sm" id="ch-meas" title="Measure: a line under the screen with this channel's mean, rms, ac rms, peak to peak, total variation per second and reversals per second, over what the screen shows">Measure</button></div>
      <div class="srcrow"><span class="flabel">Filter</span><select id="ch-filt" class="field field-sm" title="A display filter: changes what the scope shows and analyses, not the system">
          <option value="">none</option><option value="lowpass">Low-pass</option><option value="highpass">High-pass</option><option value="bandpass">Band-pass</option><option value="notch">Notch</option></select>
        <span class="filtparams" id="filt-params"></span></div>
      <div class="row dials dials-ch" id="v-dials"></div>
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
    lab.className = 'flabel';
    lab.textContent = label;
    const val = document.createElement('input');
    val.className = 'field field-sm readout mono';
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
  [1, 2, 3, 4].forEach((n, i) => {
    const b = document.createElement('button');
    b.className = 'btn btn-ch';
    b.style.setProperty('--cc', `var(--ch-${n})`);
    b.textContent = String(i + 1);
    b.title = `Channel ${i + 1}: select; press again to turn off`;
    b.addEventListener('click', () => app.channelKey(i));
    keys.append(b);
  });
  // Display mode: time, FFT or spectrogram (the scope's view setting).
  // A channel that switches between X − Y and itself is fitted again.
  root.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setScope((sc) => {
    const before = structuredClone(sc), view = { ...(sc.view ?? {}) };
    if (b.dataset.view === 'time') delete view.mode; else view.mode = b.dataset.view;
    sc.view = view;
    app.refitSwitched?.(before, sc);
  })));
  // XY: the channels draw channel 1 minus themselves (the error, for r and y).
  $('#k-delta').addEventListener('click', () => setScope((sc) => {
    const before = structuredClone(sc), view = { ...(sc.view ?? {}) };
    if (view.delta) delete view.delta; else view.delta = true;
    sc.view = view;
    app.refitSwitched?.(before, sc);
  }));
  // The selected channel's display filter.
  const filt = $('#ch-filt');
  filt.addEventListener('change', () => setScope((sc) => {
    const c = sc.channels[app.channel];
    if (!filt.value) { delete c.filter; return; }
    const fn = app.nyquist?.() ?? 100;
    c.filter = { type: filt.value, f0: c.filter?.f0 ?? Number((fn / 10).toPrecision(2)), order: c.filter?.order ?? 4, q: c.filter?.q ?? (filt.value === 'notch' ? 5 : filt.value === 'bandpass' ? 2 : Math.SQRT1_2) };
  }));
  const fparams = $('#filt-params');
  fparams.addEventListener('change', (e) => {
    const el = e.target, key = el.dataset.f;
    const v = key === 'order' ? Number(el.value) : parseSI(el.value, key === 'f0' ? 'Hz' : '');
    if (!(v > 0)) { app.toast(key === 'f0' ? 'Type a frequency, e.g. 50, 1.2k, 50 Hz.' : 'Q must be above 0.'); render(); return; }
    setScope((sc) => { sc.channels[app.channel].filter[key] = v; });
  });
  fparams.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); });
  // The wheel over the frequency nudges it, so the filter can be swept live.
  fparams.addEventListener('wheel', (e) => {
    if (e.target.dataset.f !== 'f0') return;
    e.preventDefault();
    const f = ch().filter;
    app.editScope((sc) => { sc.channels[app.channel].filter.f0 = Number((f.f0 * (e.shiftKey ? 1.01 : 1.06) ** (e.deltaY < 0 ? 1 : -1)).toPrecision(4)); });
    clearTimeout(fparams.wheelTimer);
    fparams.wheelTimer = setTimeout(() => app.endEdit(), 400);
  }, { passive: false });
  // A Measure line under the screen for the selected channel.
  $('#ch-meas').addEventListener('click', () => setScope((sc) => {
    const c = sc.channels[app.channel];
    if (c.measure) delete c.measure; else c.measure = true;
  }));
  $('#ch-right').addEventListener('click', () => setScope((sc) => {
    const view = { ...(sc.view ?? {}) };
    if (view.right === app.channel) delete view.right; else view.right = app.channel;
    sc.view = view;
  }));
  // The spectrogram's levels, typed (the same as the strip at the right of
  // the screen): for the signal the spectrogram shows.
  const lvRow = $('#lv-row'), lvIn = [...lvRow.querySelectorAll('[data-lv]')];
  const shownLevels = () => app.display?.levels;
  function typeLevel(j, v) {
    const lv = shownLevels();
    if (!lv) return;
    const pair = [lv.floor, lv.ceiling];
    pair[j] = v;
    if (!(pair[1] - pair[0] >= 1)) { app.toast('The floor must be at least 1 dB below the ceiling.'); renderLevels(true); return; }
    if (pair[0] < -300 || pair[1] > 300) { app.toast('Levels between −300 and 300 dB.'); renderLevels(true); return; }
    app.display.setLevels(lv.source, pair);
  }
  lvIn.forEach((el, j) => {
    el.addEventListener('change', () => {
      const v = parseSI(el.value, 'dB');
      if (!Number.isFinite(v)) { app.toast('Type a level in dB, e.g. −60.'); renderLevels(true); return; }
      typeLevel(j, v);
    });
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') el.blur();
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const lv = shownLevels();
      if (!lv) return;
      typeLevel(j, Math.round(((j ? lv.ceiling : lv.floor) + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1)) * 10) / 10);
      renderLevels(true);
    });
  });
  $('#lv-auto').addEventListener('click', () => { const lv = shownLevels(); if (lv && !lv.auto) app.display.setLevels(lv.source, null); });
  // What a colour means: dB of the unit (Absolute, the default) or dB above
  // the noise at each frequency; the levels above follow (each has its own).
  const lvMode = $('#lv-mode');
  $('#lv-abs').addEventListener('click', () => setScope((sc) => { sc.view = withAboveNoise(sc.view, false); }));
  $('#lv-noise').addEventListener('click', () => setScope((sc) => { sc.view = withAboveNoise(sc.view, true); }));
  function renderLevels(force = false) {
    const lv = shownLevels(), vm = app.project.scope.view?.mode, above = !!app.project.scope.view?.aboveNoise;
    lvRow.hidden = lvMode.hidden = vm !== 'spectrogram';
    for (const [id, on] of [['#lv-abs', !above], ['#lv-noise', above]]) $(id).setAttribute('aria-pressed', String(on));
    // Above the noise with a sign: +6 dB is 6 dB above it.
    const fmt = (d) => { const r = Math.round(d * 10) / 10; return `${r < 0 ? '−' : lv?.aboveNoise && r > 0 ? '+' : ''}${Math.abs(r)}`; };
    lvIn.forEach((el, j) => {
      el.disabled = !lv;
      if (force || document.activeElement !== el) el.value = lv ? fmt(j ? lv.ceiling : lv.floor) : '';
    });
    const auto = $('#lv-auto');
    auto.disabled = !lv;
    auto.setAttribute('aria-pressed', String(!!lv?.auto));
    lvRow.title = !lv ? '' : lv.aboveNoise ? `The spectrogram's levels of ${lv.source} in dB above the noise at each frequency (0 dB: the noise there)${lv.auto ? ', automatic' : ''}`
      : `The spectrogram's levels of ${lv.source} (dB of ${lv.unit}: 0 dB is 1 ${lv.unit})${lv.auto ? ', automatic' : ''}`;
  }
  const src = $('#ch-src');
  // Picking a source switches the channel on; "none" switches it off.
  src.addEventListener('change', () => setScope((sc) => { const c = sc.channels[app.channel]; c.source = src.value; c.on = src.value !== ''; }));

  let mode = 'stop';
  function render(m = mode) {
    mode = m;
    const sc = app.project.scope;
    // Run/Stop: lit green while running, red while stopped; Single amber while it sweeps.
    $('#k-run').dataset.lamp = mode === 'stop' ? 'bad' : 'ok';
    if (mode === 'single') $('#k-single').dataset.lamp = 'warn'; else delete $('#k-single').dataset.lamp;
    for (const k of Object.values(knobs)) if (document.activeElement !== k.val) k.val.value = k.read();
    $('#v-dials').style.setProperty('--cc', `var(--ch-${app.channel + 1})`);
    [...keys.children].forEach((b, i) => {
      b.setAttribute('aria-pressed', String(sc.channels[i].on));
      b.setAttribute('aria-current', String(i === app.channel));
    });
    const names = [...new Set([...app.signalNames(), ch().source].filter(Boolean))];
    if (src.dataset.names !== names.join(',') + '|' + names.map(app.unitOf).join(',')) {
      src.innerHTML = '<option value="">— none</option>' + names.map((n) => `<option value="${n}">${n}${app.unitOf(n) === '1' ? '' : ` (${app.unitOf(n)})`}</option>`).join('');
      src.dataset.names = names.join(',');
    }
    src.value = ch().source;
    src.dataset.names = names.join(',') + '|' + names.map(app.unitOf).join(',');
    const vm = sc.view?.mode ?? 'time';
    root.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === vm)));
    $('#k-delta').hidden = vm !== 'xy';
    $('#k-delta').setAttribute('aria-pressed', String(!!sc.view?.delta));
    const f = ch().filter;
    filt.value = f?.type ?? '';
    const fsig = f ? `${f.type}|${f.f0}|${f.order}|${f.q}` : '';
    if (fparams.dataset.sig !== fsig && !fparams.contains(document.activeElement)) {
      fparams.innerHTML = !f ? '' : `<input class="field field-sm mono" data-f="f0" value="${siUnit(f.f0, 'Hz', 3)}" aria-label="Filter frequency" title="Corner or centre frequency; the wheel sweeps it">`
        + (f.type === 'lowpass' || f.type === 'highpass'
          ? `<select class="field field-sm" data-f="order" aria-label="Filter order" title="Order">${[2, 4, 6, 8].map((o) => `<option value="${o}" ${o === f.order ? 'selected' : ''}>${o}.</option>`).join('')}</select>`
          : `<input class="field field-sm mono" data-f="q" value="${num(f.q, 3)}" aria-label="Filter Q" title="Q">`);
      fparams.dataset.sig = fsig;
    }
    $('#ch-right').setAttribute('aria-pressed', String(sc.view?.right === app.channel));
    $('#ch-meas').setAttribute('aria-pressed', String(!!ch().measure));
    knobs.vScale.lab.textContent = `Scale · ${app.channel + 1}`;
    knobs.vPos.lab.textContent = `Position · ${app.channel + 1}`;
    renderLevels();
  }

  return { render, renderLevels };
}
