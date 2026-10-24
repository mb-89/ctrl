// The side column: the goal editor and the candidate table.

import { METRICS, METRIC } from '../core/metrics.js';
import { fmt, describeController } from '../core/project.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const unitOf = (k) => (METRIC[k].unit ? ` ${METRIC[k].unit}` : '');

function metricSelect(id, value, exclude = []) {
  const opts = METRICS.filter((m) => m.key === value || !exclude.includes(m.key))
    .map((m) => `<option value="${m.key}" ${m.key === value ? 'selected' : ''}>${esc(m.label)}</option>`).join('');
  return `<select class="field" id="${id}" aria-label="Metric">${opts}</select>`;
}

export function createGoalPanel(root, app) {
  function render() {
    const g = app.project.goal;
    const min = Object.entries(g.minimize);
    const cons = Object.entries(g.subjectTo);
    let html = '<div class="label">Goal</div>';
    min.forEach(([k, w], i) => {
      html += `<div class="goal-row">
        <span class="word">${i === 0 ? 'Minimize' : '+'}</span>
        ${metricSelect(`gm-${i}`, k, min.map(([q]) => q))}
        <span class="word" style="min-width:0">×</span>
        <input class="field" id="gw-${i}" value="${fmt(w)}" aria-label="Weight" title="Weight of this metric in the score">
        ${min.length > 1 ? `<button class="x" data-rm-min="${k}" aria-label="Remove term" title="Remove term">✕</button>` : ''}
      </div>`;
    });
    html += '<div class="goal-row"><span class="word">subject to</span>';
    if (!cons.length) html += '<span class="word" style="color:var(--muted)">no constraints</span>';
    html += '</div>';
    cons.forEach(([k, b], i) => {
      const op = 'max' in b ? 'max' : 'min';
      html += `<div class="goal-row">
        <span class="word"></span>
        ${metricSelect(`gc-${i}`, k, cons.map(([q]) => q))}
        <select class="field" id="go-${i}" aria-label="Bound"><option value="max" ${op === 'max' ? 'selected' : ''}>≤</option><option value="min" ${op === 'min' ? 'selected' : ''}>≥</option></select>
        <input class="field" id="gv-${i}" value="${fmt(b[op])}" aria-label="Limit">
        <span class="word" style="min-width:0;color:var(--muted)">${esc(METRIC[k].unit)}</span>
        <button class="x" data-rm-con="${k}" aria-label="Remove constraint" title="Remove constraint">✕</button>
      </div>`;
    });
    html += `<div class="goal-row"><span class="word"></span>
      <button class="link" id="add-con">Add constraint</button>
      <button class="link" id="add-term">Add objective term</button>
      <span style="margin-left:auto" class="word" title="Settling band, % of the step">band ±<input class="field" id="gband" style="width:44px" value="${fmt(g.settlingBand * 100)}" aria-label="Settling band in percent"> %</span>
    </div>`;
    root.innerHTML = html;

    const keys = min.map(([k]) => k);
    min.forEach(([k], i) => {
      root.querySelector(`#gm-${i}`).addEventListener('change', (e) => app.editGoal((goal) => {
        const entries = Object.entries(goal.minimize).map(([q, w]) => (q === k ? [e.target.value, w] : [q, w]));
        goal.minimize = Object.fromEntries(entries);
      }));
      numberInput(`#gw-${i}`, (v) => app.editGoal((goal) => { goal.minimize[k] = v; }));
    });
    cons.forEach(([k, b], i) => {
      root.querySelector(`#gc-${i}`).addEventListener('change', (e) => app.editGoal((goal) => {
        goal.subjectTo = Object.fromEntries(Object.entries(goal.subjectTo).map(([q, c]) => (q === k ? [e.target.value, c] : [q, c])));
      }));
      root.querySelector(`#go-${i}`).addEventListener('change', (e) => app.editGoal((goal) => {
        const v = b.max ?? b.min;
        goal.subjectTo[k] = { [e.target.value]: v };
      }));
      numberInput(`#gv-${i}`, (v) => app.editGoal((goal) => { goal.subjectTo[k] = { ['max' in b ? 'max' : 'min']: v }; }));
    });
    root.querySelectorAll('[data-rm-min]').forEach((btn) => btn.addEventListener('click', () => app.editGoal((goal) => { delete goal.minimize[btn.dataset.rmMin]; })));
    root.querySelectorAll('[data-rm-con]').forEach((btn) => btn.addEventListener('click', () => app.editGoal((goal) => { delete goal.subjectTo[btn.dataset.rmCon]; })));
    root.querySelector('#add-con').addEventListener('click', () => app.editGoal((goal) => {
      const free = ['overshoot', 'settlingTime', 'uPeak', 'riseTime', 'uTV', ...METRICS.map((m) => m.key)].find((q) => !(q in goal.subjectTo));
      if (free) goal.subjectTo[free] = { max: defaultLimit(free, app) };
    }));
    root.querySelector('#add-term').addEventListener('click', () => app.editGoal((goal) => {
      const free = ['uTV', 'iae', 'settlingTime', ...METRICS.map((m) => m.key)].find((q) => !keys.includes(q));
      if (free) goal.minimize[free] = 0.1;
    }));
    numberInput('#gband', (v) => app.editGoal((goal) => { goal.settlingBand = Math.max(0.0001, v / 100); }));
  }

  function numberInput(sel, apply) {
    const el = root.querySelector(sel);
    el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') el.blur(); });
    el.addEventListener('change', () => {
      const v = Number(el.value.replace(',', '.').replace('−', '-'));
      if (!Number.isFinite(v)) { app.toast('Enter a number.'); render(); return; }
      apply(v);
    });
  }

  return { render };
}

// A starting limit near what the selected candidate achieves, so a new
// constraint is meaningful straight away.
function defaultLimit(key, app) {
  const v = app.runOf(app.candidate)?.metrics[key];
  if (Number.isFinite(v) && v > 0) return Number(v.toPrecision(2));
  return { overshoot: 5, settlingTime: 5, uPeak: 5 }[key] ?? 1;
}

export function createCandidateTable(root, app) {
  const head = document.createElement('div');
  head.className = 'cands-head';
  head.innerHTML = `<span class="label">Candidates</span>
    <button class="btn small" id="c-sort" title="Order the list best first">Sort by score</button>
    <button class="btn small primary" id="c-new" title="Duplicate the selected candidate (N)">Duplicate</button>`;
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  root.append(head, wrap);
  head.querySelector('#c-new').addEventListener('click', () => app.duplicate());
  head.querySelector('#c-sort').addEventListener('click', () => app.sortByScore());

  let renaming = null;

  function render() {
    const p = app.project;
    if (!p.candidates.length) {
      wrap.innerHTML = '<div class="empty">No candidates yet. Press <kbd>N</kbd> or Duplicate to add one.</div>';
      return;
    }
    const cons = Object.entries(p.goal.subjectTo);
    const objLabel = Object.keys(p.goal.minimize).length === 1 ? METRIC[Object.keys(p.goal.minimize)[0]].short : 'Score';
    const best = app.bestIndex();
    let html = `<table class="ct"><thead><tr><th class="l" title="Show in the scope"></th><th class="l">Name</th><th title="Objective value; lower is better">${esc(objLabel)}</th>`;
    for (const [k, b] of cons) html += `<th title="${esc(METRIC[k].label)}">${esc(METRIC[k].short)} <span class="lim">${'max' in b ? '≤' : '≥'}${fmt(b.max ?? b.min)}</span></th>`;
    html += '<th class="l"></th></tr></thead><tbody>';
    p.candidates.forEach((c, i) => {
      const run = app.runOf(c);
      const ev = run?.evaluation;
      const color = app.colorOf(c);
      const sel = i === app.sel;
      html += `<tr data-i="${i}" class="${sel ? 'sel' : ''} ${c.checked ? '' : 'off'}" style="--c:${color}">
        <td class="chk"><input type="checkbox" ${c.checked ? 'checked' : ''} data-chk="${i}" aria-label="Show ${esc(c.name)} in the scope"></td>
        <td class="name">${renaming === i ? `<input class="rename" id="rename" value="${esc(c.name)}" aria-label="Candidate name">` : `<div class="nm"><span class="swatch"></span><span title="Double-click to rename">${esc(c.name)}</span></div>`}
          <div class="sum">${esc(describeController(c.controller))}</div></td>
        <td class="score">${ev ? scoreCell(ev, i === best) : '…'}</td>`;
      for (const [k] of cons) {
        const chk = ev?.checks.find((x) => x.metric === k);
        html += `<td class="${chk && !chk.ok ? 'bad' : ''}">${chk ? fmt(chk.value) : '…'}</td>`;
      }
      html += `<td class="l"><button class="x" data-del="${i}" aria-label="Delete ${esc(c.name)}" title="Delete (Del)">✕</button></td></tr>`;
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;

    wrap.querySelectorAll('tbody tr').forEach((tr) => {
      const i = Number(tr.dataset.i);
      tr.addEventListener('click', (e) => {
        if (e.target.closest('input, button')) return;
        app.select(i);
      });
      tr.addEventListener('dblclick', (e) => {
        if (!e.target.closest('td.name')) return;
        renaming = i; render();
        const inp = wrap.querySelector('#rename');
        inp.focus(); inp.select();
      });
      tr.addEventListener('pointerenter', () => app.setHot(i));
      tr.addEventListener('pointerleave', () => app.setHot(null));
    });
    wrap.querySelectorAll('[data-chk]').forEach((cb) => cb.addEventListener('change', () => app.toggleChecked(Number(cb.dataset.chk))));
    wrap.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => app.remove(Number(b.dataset.del))));
    const inp = wrap.querySelector('#rename');
    if (inp) {
      const done = (save) => {
        const i = renaming;
        renaming = null;
        if (save && inp.value.trim()) app.rename(i, inp.value.trim()); else render();
      };
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
      inp.addEventListener('blur', () => { if (renaming !== null) done(true); });
    }
    wrap.querySelector('tr.sel')?.scrollIntoView({ block: 'nearest' });
  }

  function scoreCell(ev, isBest) {
    if (ev.unstable) return '<span class="bad-i">unstable ✕</span>';
    const icon = ev.feasible ? '<span class="ok-i" title="Meets every constraint">✓</span>' : '<span class="bad-i" title="Violates a constraint">✕</span>';
    return `${isBest ? '<span class="star" title="Best feasible candidate">BEST</span>' : ''}${fmt(ev.score)} ${icon}`;
  }

  return { render };
}

export function renderReadout(root, app) {
  const c = app.candidate;
  const run = c && app.runOf(c);
  if (!run) { root.innerHTML = ''; return; }
  const g = app.project.goal;
  const shown = ['riseTime', 'overshoot', 'settlingTime', 'steadyStateError', 'itae', 'iae', 'uPeak', 'uTV'];
  for (const k of [...Object.keys(g.minimize), ...Object.keys(g.subjectTo)]) if (!shown.includes(k)) shown.push(k);
  root.innerHTML = shown.map((k) => {
    const m = METRIC[k];
    const v = run.metrics[k];
    const chk = run.evaluation.checks.find((x) => x.metric === k);
    const lim = chk ? ` <span class="lim">${'max' in chk ? '≤' : '≥'}${fmt(chk.max ?? chk.min)}</span>` : '';
    const cls = ['cell', chk && !chk.ok ? 'bad' : '', k in g.minimize ? 'obj' : ''].join(' ');
    return `<div class="${cls}" title="${esc(m.label)}: ${esc(m.desc)}"><div class="k">${esc(m.label)}</div><div class="v">${fmt(v)}${esc(unitOf(k))}${lim}</div></div>`;
  }).join('');
}
