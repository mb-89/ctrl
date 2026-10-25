// Save and references, under the screen beside the channel badges, like a
// scope's save keys (the person, 2026-10-24: store the traces "either as a
// screenshot or as data … if there are 20, then we store all 20"):
//   Screen       what the scope acquired over the screen's window, every
//                signal (not only those on channels): a simulated run, or the
//                live sweep. CSV, JSON, or a PNG picture of the screen.
//   Live record  the last minutes of every live signal (Rec length), across
//                runs, in real time (core/trace.js).
//   Open         a saved trace, drawn dashed on the channels with the same
//                names until cleared; ◀ ▶ step it through a trace longer
//                than the screen.
// Files leave through app.download, the page's one download path (a host's
// download capability where it has one, else a link); Copy and Copy image
// put the same on the clipboard.
// See design/output/instrument.md and design/output/hil.md.

import { findExternal } from '../core/hil.js';
import { createRecorder, traceToCsv, traceToCsvParts, traceToJsonParts, parseTrace, traceWindow, refShift, refSteps } from '../core/trace.js';
import { num } from './units.js';
import { fitPopover } from './layout.js';

const RECORD_KEY = 'loop-tuner:record-seconds';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Record lengths: "5 min", "30 s", "1 h"; a bare number is seconds, m is minutes.
function parseDuration(text) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(h|min|m|s)?\s*$/i.exec(String(text).replace(',', '.'));
  if (!m) return NaN;
  return Number(m[1]) * ({ h: 3600, min: 60, m: 60, s: 1 }[(m[2] ?? 's').toLowerCase()]);
}
function duration(s) {
  if (!Number.isFinite(s)) return '–';
  if (s >= 3600 && s % 3600 === 0) return `${s / 3600} h`;
  if (s >= 60) return Number.isInteger(s / 60) ? `${s / 60} min` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')} min`;
  return `${Number(s.toFixed(s < 10 ? 1 : 0))} s`;
}
const span = (tr) => (tr.t.length > 1 ? tr.t[tr.t.length - 1] - tr.t[0] : 0);
const listed = (names) => (names.length > 6 ? `${names.slice(0, 6).join(', ')} and ${names.length - 6} more` : names.join(', '));

export function createRecord(app, display) {
  const bar = document.createElement('div');
  bar.className = 'recbar on-dark';
  bar.setAttribute('aria-label', 'Save and references');
  bar.innerHTML = `
    <span class="rc-rec" id="rc-rec" hidden><span class="label" title="Rec: the last minutes of every live signal are kept, to be saved">Rec</span>
      <span class="muted mono" id="rc-state"></span><input class="field field-sm mono rc-len" id="rc-len" spellcheck="false" aria-label="Record length" title="How much live data is kept: 5 min, 30 s, 1 h"></span>
    <span class="popwrap"><button class="btn btn-sm" id="rc-save" aria-haspopup="true" aria-expanded="false" title="Save the screen (every signal, or a picture) or the live record">Save ▾</button><span class="popover menu popover-up" id="rc-pop" role="menu" hidden></span></span>
    <button class="btn btn-sm" id="rc-open" title="Open a saved trace (CSV or JSON): it is drawn dashed on the channels with the same names">Open…</button>
    <span class="rc-refs" id="rc-refs" hidden></span>
    <input type="file" id="rc-file" accept=".csv,.json,text/csv,application/json" hidden>`;
  document.getElementById('display').append(bar);
  const $ = (id) => document.getElementById(id);
  const unitsOf = (list) => Object.fromEntries(list.map((nm) => [nm, app.unitOf(nm)]));
  const windowOf = () => { const tb = app.project.scope.timebase; const w0 = Math.max(0, tb.position); return [w0, tb.position + 10 * tb.scale]; };

  // ---- The screen: a simulated run over the window, or a live sweep (which
  // carries plantOffset, ui/live.js).
  function screenTrace() {
    const d = display.data;
    if (!(d?.t?.length > 1)) return null;
    const live = d.plantOffset !== undefined;
    const [w0, w1] = windowOf();
    const tr = traceWindow(d, live ? -Infinity : w0, live ? Infinity : w1);
    if (tr.t.length < 2) return null;
    // Every signal the scope can show; auto-tune's "ctrl.u" probes (a dot in
    // the name) are not among them.
    for (const nm of Object.keys(tr.signals)) if (nm.includes('.')) delete tr.signals[nm];
    tr.units = unitsOf(Object.keys(tr.signals));
    return { trace: tr, what: 'screen', source: live ? `the screen: a live sweep, t is screen time (plant time = t + ${num(d.plantOffset, 6)} s)` : 'the screen: a simulated run' };
  }

  // ---- The live record: plant time, run after run, on one real-time axis.
  let seconds = 300;
  try { seconds = Number(localStorage.getItem(RECORD_KEY)) || 300; } catch { /* storage unavailable */ }
  const rec = createRecorder(seconds);
  let began = null, runOffset = null, lastPlantT = null, lastT = null, recKey = '', recNames = null;
  const clock = () => performance.now() / 1000;
  const recordTrace = () => (rec.length > 1 ? { trace: rec.snapshot(), what: 'live record', source: 'the live record: t in seconds from its first sample; each run is the plant\'s own time, placed when it started' } : null);
  const live = {
    // A new run starts: the plant's clock restarts at 0.
    run() { runOffset = null; },
    samples(names, ts, values) {
      const key = names.join('\n');
      if (key !== recKey) { recKey = key; recNames = names; rec.setUnits(unitsOf(names)); }
      for (let i = 0; i < ts.length; i++) {
        const t = ts[i];
        if (runOffset === null || (lastPlantT !== null && t < lastPlantT)) {
          began ??= clock() - t;
          runOffset = Math.max(clock() - began - t, lastT === null ? -Infinity : lastT - t + 1e-6);
        }
        lastPlantT = t; lastT = t + runOffset;
        rec.push(lastT, recNames, values[i]);
      }
    },
  };

  // ---- Saving
  const stem = (what) => `${app.project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'trace'}-${what === 'screen' ? 'screen' : 'record'}-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}`;
  // Saves the screen or the live record as CSV, JSON, or (the screen) a
  // screenshot; copy and image put them on the clipboard. Resolves true once
  // done.
  async function save(what, kind) {
    closePop();
    if (kind === 'png') { const ok = await app.download(`${stem('screen')}.png`, await screenshot(), 'image/png', 'use Save ▾ › Copy image'); if (ok) app.toast('Saved a screenshot of the scope (PNG)'); return ok; }
    if (kind === 'image') return copyImage();
    const x = what === 'screen' ? screenTrace() : recordTrace();
    if (!x) { app.toast(what === 'screen' ? 'Nothing on the screen yet.' : 'The live record is empty: connect a plant and Run.'); return false; }
    const meta = { title: app.project.title, source: x.source };
    const names = Object.keys(x.trace.signals), n = x.trace.t.length;
    if (kind === 'copy') { await app.copy(traceToCsv(x.trace, meta), `The ${x.what} (${n} samples of ${names.length} signals, CSV)`); return true; }
    // Built in parts, as a Blob; CSV with a UTF-8 mark first, so spreadsheets
    // read units such as N·m right.
    const file = kind === 'json' ? new Blob(traceToJsonParts(x.trace, meta), { type: 'application/json' }) : new Blob(['\uFEFF', ...traceToCsvParts(x.trace, meta)], { type: 'text/csv' });
    const ok = await app.download(`${stem(what)}.${kind}`, file, file.type, 'use Save ▾ › Copy (CSV to the clipboard)');
    if (ok) app.toast(`Saved ${duration(span(x.trace))} of ${listed(names)} (${x.what}, ${kind.toUpperCase()})`);
    return ok;
  }
  async function copyImage() {
    try {
      if (!window.ClipboardItem || !navigator.clipboard?.write) throw new Error('no image clipboard');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': screenshot() })]);
      app.toast('Screenshot copied to the clipboard');
      return true;
    } catch { app.toast('This browser does not let the page copy an image here; use Screenshot (PNG).'); return false; }
  }
  // A screenshot of the scope as it is: the title and the status line, the
  // screen, the channel badges, on the display's own background (the
  // theme's), at the device pixel ratio. Every piece keeps its colours.
  function screenshot() {
    const box = document.getElementById('display');
    const src = box.querySelector('.screen canvas');
    const k = src.width / Math.max(1, src.getBoundingClientRect().width) || window.devicePixelRatio || 1;
    const css = (el) => getComputedStyle(el);
    const pad = Math.round(10 * k), line = Math.round(26 * k);
    const c = document.createElement('canvas');
    c.width = src.width + 2 * pad; c.height = src.height + 2 * line + 2 * pad;
    const g = c.getContext('2d');
    g.fillStyle = css(box).backgroundColor;
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(src, pad, pad + line);
    g.textBaseline = 'middle';
    const clear = (col) => !col || col === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(col);
    const font = (st, weight = st.fontWeight) => `${weight} ${Math.round(parseFloat(st.fontSize) * k)}px ${st.fontFamily}`;
    // The title, then the status line's pieces as drawn (badges on their
    // lamp or outlined, the rest in its colour).
    const status = box.querySelector('.status');
    let x = pad, y = pad + line / 2;
    const sst = css(status);
    g.font = font(sst, 600); g.fillStyle = sst.color;
    g.fillText(app.project.title, x, y);
    x += g.measureText(app.project.title).width + 14 * k;
    for (const el of status.children) {
      const st = css(el), text = el.textContent.replace(/\s+/g, ' ').trim();
      if (!text || st.display === 'none') continue;
      g.font = font(st);
      const boxed = !clear(st.backgroundColor) || st.borderTopStyle !== 'none' && !clear(st.borderTopColor) && parseFloat(st.borderTopWidth) > 0;
      const w = g.measureText(text).width + (boxed ? 12 * k : 0);
      if (x + w > c.width - pad) break;
      if (!clear(st.backgroundColor)) { g.fillStyle = st.backgroundColor; g.fillRect(x, y - 9 * k, w, 18 * k); }
      else if (boxed) { g.strokeStyle = st.borderTopColor; g.lineWidth = k; g.strokeRect(x + k / 2, y - 9 * k, w - k, 18 * k); }
      g.fillStyle = st.color;
      g.fillText(text, x + (boxed ? 6 * k : 0), y);
      x += w + 12 * k;
    }
    // The channel keys that are on, lit as on the page: their colour, with
    // the number, the source and the scale in the lit ink.
    x = pad; y = c.height - pad - line / 2;
    for (const b of box.querySelectorAll('.chbar .btn-ch[aria-pressed="true"]')) {
      const st = css(b);
      g.font = font(st, 600);
      const text = [...b.children].map((e) => e.textContent.trim()).filter(Boolean).join('  ');
      const w = g.measureText(text).width + 16 * k;
      if (x + w > c.width - pad) break;
      g.fillStyle = st.backgroundColor; g.fillRect(x, y - 11 * k, w, 22 * k);
      g.fillStyle = st.color; g.fillText(text, x + 8 * k, y);
      x += w + 8 * k;
    }
    return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
  }

  // The menu: what there is to save, and how.
  const pop = $('rc-pop');
  function renderPop() {
    const scr = screenTrace(), lr = rec.length > 1;
    // Where the host offers no downloads, only the copy keys (as the
    // header's Save JSON and Export HTML hide there).
    const files = app.canSave();
    const key = (what, kind, text, title) => `<button class="btn btn-sm" role="menuitem" data-save="${what}:${kind}" title="${esc(title)}">${text}</button>`;
    const file = (what, kind, text, title) => (files ? key(what, kind, text, title) : '');
    const pics = (what) => file(what, 'png', 'Screenshot (PNG)', 'a picture of the scope as it is: the status line, the screen and the channel keys') + key(what, 'image', 'Copy image', 'the same picture to the clipboard');
    const keys = (what, png) => file(what, 'csv', 'CSV', 't and every signal, units in the header: for spreadsheets') + file(what, 'json', 'JSON', 'the same as JSON: for scripts')
      + key(what, 'copy', 'Copy', 'CSV to the clipboard') + (png ? pics(what) : '');
    const row = (label, note, body) => `<div class="rc-row"><span class="rc-what">${label}<span class="hint">${esc(note)}</span></span><span class="rc-keys">${body}</span></div>`;
    pop.innerHTML = row('Screen', scr ? `${duration(span(scr.trace))} · ${Object.keys(scr.trace.signals).length} signals` : 'nothing yet', scr ? keys('screen', true) : pics('screen'))
      + (lr ? row('Live record', `${duration(rec.span())} · ${rec.names.length} signals`, keys('record', false)) : '');
    pop.querySelectorAll('[data-save]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); const [what, kind] = b.dataset.save.split(':'); save(what, kind); }));
  }
  function closePop() { if (!pop.hidden) { pop.hidden = true; $('rc-save').setAttribute('aria-expanded', 'false'); } }
  $('rc-save').addEventListener('click', (e) => {
    e.stopPropagation();
    if (pop.hidden) { document.dispatchEvent(new MouseEvent('click')); renderPop(); }  // one menu open at a time: the others close
    pop.hidden = !pop.hidden;
    fitPopover(pop);
    $('rc-save').setAttribute('aria-expanded', String(!pop.hidden));
  });
  document.addEventListener('click', closePop);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { closePop(); e.stopImmediatePropagation(); } }, true);

  // ---- The record length, per viewer
  const lenEl = $('rc-len');
  lenEl.value = duration(seconds);
  lenEl.addEventListener('focus', () => lenEl.select());
  lenEl.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') lenEl.blur(); if (e.key === 'Escape') { lenEl.value = duration(seconds); lenEl.blur(); } });
  lenEl.addEventListener('blur', () => {
    const s = parseDuration(lenEl.value);
    if (!(s >= 1 && s <= 24 * 3600)) { if (lenEl.value !== duration(seconds)) app.toast('A record length from 1 s to 24 h: 5 min, 30 s, 1 h.'); lenEl.value = duration(seconds); return; }
    seconds = s;
    rec.setLength(s);
    lenEl.value = duration(s);
    try { localStorage.setItem(RECORD_KEY, String(s)); } catch { /* storage unavailable */ }
    const most = rec.longest();
    if (most < s) app.toast(`At this rate the memory holds about ${duration(Math.floor(most))} of these signals; older samples go first.`);
    renderRec();
  });
  function renderRec() {
    if (!app.project) return;  // (made before the project loads)
    const shown = !!findExternal(app.project.system.plant?.diagram) || rec.length > 0;
    $('rc-rec').hidden = !shown;
    if (!shown) return;
    const st = $('rc-state'), most = rec.longest();
    st.textContent = `${duration(rec.span())} /`;
    st.title = rec.length > 1 ? `${duration(rec.span())} of live data kept, ${rec.names.length} signals; the last ${duration(seconds)} are kept${most < seconds ? ` (at this rate the memory holds ${duration(Math.floor(most))})` : ''}. Save ▾ › Live record.` : 'Nothing recorded yet: the record fills while a live plant runs';
  }
  setInterval(renderRec, 500);

  // ---- References: saved traces, dashed, until cleared. Each is placed by
  // refShift (core/trace.js); ◀ ▶ move them all by a screen width.
  const refs = [];
  function placeRefs() {
    const [w0, w1] = windowOf(), W = Math.max(w1 - w0, 1e-9);
    display.setRefs(refs.map((r) => {
      const { min, max } = refSteps(r.t0, r.t1, w0, W);
      r.step = Math.min(max, Math.max(min, r.step));
      r.range = [min, max];
      const shift = refShift(r.t0, r.t1, w0, W, r.step);
      if (r.shift !== shift) { r.shift = shift; r.shown = { t: r.t.map((x) => x + shift), signals: r.signals }; }
      r.part = [Math.max(r.t0, w0 - shift), Math.min(r.t1, w1 - shift)];
      return r.shown;
    }));
    renderRefs();
  }
  const partText = (r) => (r.part[1] < r.part[0] ? 'nothing on the screen' : `${num(r.part[0], 5)}–${num(r.part[1], 5)} s of ${num(r.t0, 5)}–${num(r.t1, 5)} s`);
  function renderRefs() {
    const box = $('rc-refs');
    box.hidden = !refs.length;
    if (!refs.length) { box.innerHTML = ''; return; }
    const lo = Math.max(...refs.map((r) => r.range[0])), hi = Math.min(...refs.map((r) => r.range[1]));
    const stepping = refs.some((r) => r.range[0] < r.range[1]);
    const at = refs[0].step;
    box.innerHTML = `${stepping ? `<button class="btn btn-sm btn-icon" id="rc-back" title="Show the screen width before" ${at <= lo ? 'disabled' : ''}>◀</button>` : ''}<button class="btn btn-sm" id="rc-clear" title="References (dashed): ${esc(refs.map((r) => `${r.name}: ${partText(r)}`).join('; '))}. Click to clear them.">ref${refs.length > 1 ? ` ×${refs.length}` : ''} ✕</button>${stepping ? `<button class="btn btn-sm btn-icon" id="rc-fwd" title="Show the next screen width" ${at >= hi ? 'disabled' : ''}>▶</button>` : ''}`;
    $('rc-clear').addEventListener('click', () => { refs.length = 0; display.setRefs([]); renderRefs(); app.toast('References cleared'); });
    const step = (d) => { for (const r of refs) r.step += d; placeRefs(); app.toast(`Reference: ${partText(refs[0])}`); };
    $('rc-back')?.addEventListener('click', () => step(-1));
    $('rc-fwd')?.addEventListener('click', () => step(1));
  }
  function addReference(text, name) {
    const tr = parseTrace(text);
    if (tr.t.length < 1) throw new Error('no samples');
    const r = { name, ...tr, t0: tr.t[0], t1: tr.t[tr.t.length - 1], step: 0, shift: null };
    refs.push(r);
    placeRefs();
    const all = Object.keys(tr.signals), shown = all.filter((nm) => app.project.scope.channels.some((c) => c.on && c.source === nm));
    const where = r.part[1] < r.part[0] ? '' : `, ${partText(r)}${r.range[0] < r.range[1] ? ' (◀ ▶ move through it)' : ''}`;
    app.toast(shown.length ? `Reference “${name}”: ${listed(shown)} dashed on the scope${where}${shown.length < all.length ? `; ${listed(all.filter((x) => !shown.includes(x)))} not on a channel` : ''}`
      : `Reference “${name}” holds ${listed(all)}; none of them is on a channel.`);
    return all;
  }
  $('rc-open').addEventListener('click', () => $('rc-file').click());
  $('rc-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { addReference(await f.text(), f.name.replace(/\.(csv|json)$/i, '')); } catch (err) { app.toast(`Could not read ${f.name}: ${err.message}`); }
  });

  renderRec();
  return {
    live,
    // After every change of the project: references follow the window.
    changed() { if (refs.length) placeRefs(); renderRec(); },
    // For agents (window.loopTuner.record): the same as the keys.
    api: {
      screen: (format = 'csv') => { const x = screenTrace(); return x ? (format === 'json' ? traceToJsonParts : traceToCsvParts)(x.trace, { title: app.project.title, source: x.source }).join('') : ''; },
      live: (format = 'csv') => { const x = recordTrace(); return x ? (format === 'json' ? traceToJsonParts : traceToCsvParts)(x.trace, { title: app.project.title, source: x.source }).join('') : ''; },
      save: async (what = 'screen', format = 'csv') => {
        const w = what === 'live' ? 'record' : what;
        if (!['screen', 'record'].includes(w)) throw new Error(`record.save: what is "screen" or "record", not ${JSON.stringify(what)}`);
        if (!['csv', 'json', 'png'].includes(format)) throw new Error(`record.save: format is "csv", "json" or "png", not ${JSON.stringify(format)}`);
        if (format === 'png' && w !== 'screen') throw new Error('record.save: "png" is a picture of the screen; the live record saves as "csv" or "json"');
        return save(w, format);
      },
      screenshot: async () => { const blob = await screenshot(); return new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); }); },
      reference: (text, name = 'reference') => addReference(text, name),
      clearReferences: () => { refs.length = 0; display.setRefs([]); renderRefs(); },
      state: () => ({ recorded: rec.span(), seconds, signals: [...rec.names], references: refs.map((r) => ({ name: r.name, shown: r.part })) }),
    },
  };
}
