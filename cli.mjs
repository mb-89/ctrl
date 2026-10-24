#!/usr/bin/env node
// Loop Tuner on the command line: the same simulation the page runs, for
// agents and scripts. A project is a .json file, or an exported .html page
// with the project inside; --save writes back in the same format.

import { readFileSync, writeFileSync } from 'node:fs';
import { buildHtml } from './build.mjs';
import { SLOTS, BLOCKS, blockDef, normalizeBlock } from './src/core/blocks.js';
import { METRICS, METRIC } from './src/core/metrics.js';
import { normalizeProject, evaluateProject, evaluateCandidate, findCandidate, uniqueName, nextColor, describeController, fmt, loopReady, referenceTrace } from './src/core/project.js';
import { SIGNALS, normalizeComponent, describeComponent } from './src/core/signals.js';
import { runTune, tunableParams } from './src/core/tune.js';
import { EXAMPLES, DEFAULT_PROJECT } from './src/core/examples.js';
import { autotune, tuneReport, placeVariant, controllerBlocks, tunedValues, METHODS as TUNE_METHODS, RULES, COSTS } from './src/core/autotune.js';

const HELP = `Loop Tuner: tune SISO feedback loops. Usage: node cli.mjs <command> [options]

  new [--example <n|title>] [-o file]   write a starter project (default: a step at 0.1 s, no loop yet)
  examples                              list the example loops
  signal <project> [--name r] [--add <type> --set k=v ...] [--remove <n>] [--save]
                                        list or change a named signal (default r), a sum of components
  blocks [slot]                         the block library: types, parameters and ranges (JSON);
                                        slot "reference" lists the signal generator's primitives
  metrics                               the metrics a goal can use (JSON)
  eval <project> [--candidate <name>]   score every candidate against the goal, best first
  try <project> [--from <name>] [--type <T>] [--set k=v]... [--name <n>] [--save]
                                        evaluate a variation of a candidate; --save adds it
  tune <project> [--from <name>] [--params Kp,Ki] [--evals 300] [--seed 1] [--name <n>] [--save]
                                        auto-tune a candidate's gains; --save adds the result
  autotune <project> [--block <id path>] [--method iterate|relay|step] [--rule tl|zn|calm]
           [--cost IAE|ITAE|ISE] [--effort 0.05] [--overshoot 10] [--iterations 60] [--amplitude 10] [--save]
                                        improve a Controller block's running variant by simulation, as the
                                        page's Auto-tune tab does; --save puts the result into the block as a
                                        variant of its own (running if it scores better)
  trace <project> [--candidate <name>] [--every 10] [--json]
                                        time series t, r, y, u, ym, d as CSV
  html <project> [-o out.html]          a standalone page with the project inside, to share
  extract <page.html>                   print the project inside an exported page

  --json prints machine-readable output for eval, try, tune and autotune.
  --set takes controller parameters (Kp=2) or slot.param for a what-if on another
  slot of this candidate only (plant.tau=2, sensor.type=lag). Lists: num=[1,2].
`;

function parseArgs(argv) {
  const pos = [], opt = { set: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o') { opt.o = argv[++i]; continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (['json', 'save', 'help'].includes(key)) { opt[key] = true; continue; }
      const val = argv[++i];
      if (val === undefined) fail(`--${key} needs a value`);
      if (key === 'set') opt.set.push(val); else opt[key] = val;
      continue;
    }
    pos.push(a);
  }
  return { pos, opt };
}

function fail(msg) { console.error(`error: ${msg}`); process.exit(1); }

function readProject(path) {
  if (!path) fail('give a project file (.json or .html)');
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { fail(`cannot read ${path}`); }
  const raw = /\.html?$/i.test(path) ? extractJson(text, path) : text;
  try { return normalizeProject(JSON.parse(raw)); } catch (e) { fail(`${path}: ${e.message}`); }
}

function extractJson(html, path) {
  const m = html.match(/<script type="application\/json" id="loop-tuner-project">([\s\S]*?)<\/script>/);
  if (!m || !m[1].trim()) fail(`${path} has no Loop Tuner project inside`);
  return m[1];
}

function writeProject(path, project) {
  writeFileSync(path, /\.html?$/i.test(path) ? buildHtml({ project }) : JSON.stringify(project, null, 2) + '\n');
}

const clean = (m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'events').map(([k, v]) => [k, typeof v === 'number' && !Number.isFinite(v) ? null : v]));

function report(project, cand, run, rank) {
  return {
    name: cand.name, ...(rank !== undefined ? { rank } : {}),
    score: Number.isFinite(run.evaluation.score) ? run.evaluation.score : null,
    feasible: run.evaluation.feasible, violation: run.evaluation.violation,
    checks: run.evaluation.checks.map((c) => ({ ...c, value: Number.isFinite(c.value) ? c.value : null })),
    controller: cand.controller,
    ...Object.fromEntries(SLOTS.filter((s) => s.key !== 'controller' && cand[s.key]).map((s) => [s.key, cand[s.key]])),
    metrics: clean(run.metrics),
    warnings: run.result.info.warnings,
  };
}

function goalText(goal) {
  const min = Object.entries(goal.minimize).map(([k, w]) => `${w === 1 ? '' : `${w}×`}${k}`).join(' + ');
  const st = Object.entries(goal.subjectTo).map(([k, b]) => ('max' in b ? `${k} ≤ ${b.max}` : `${k} ≥ ${b.min}`) + (METRIC[k].unit ? ` ${METRIC[k].unit}` : '')).join(', ');
  return `minimize ${min || '0'}${st ? `  subject to ${st}` : ''}`;
}

function table(rows) {
  const w = rows[0].map((_, j) => Math.max(...rows.map((r) => String(r[j]).length)));
  return rows.map((r) => r.map((c, j) => (j < 2 ? String(c).padEnd(w[j]) : String(c).padStart(w[j]))).join('  ')).join('\n');
}

function printEval(project, entries) {
  const cons = Object.keys(project.goal.subjectTo);
  const extra = ['riseTime', 'settlingTime', 'overshoot', 'uPeak'].filter((k) => !cons.includes(k));
  const rows = [['#', 'candidate', 'score', 'ok', ...cons, ...extra, 'controller']];
  for (const e of entries) {
    rows.push([e.rank ?? '', e.name, fmt(e.score ?? Infinity), e.feasible ? '✓' : '✕',
      ...cons.map((k) => { const c = e.checks.find((x) => x.metric === k); return `${fmt(c.value ?? Infinity)}${c.ok ? '' : '!'}`; }),
      ...extra.map((k) => fmt(e.metrics[k] ?? Infinity)), describeController(e.controller)]);
  }
  console.log(`${project.title}: ${goalText(project.goal)}\n`);
  console.log(table(rows));
  console.log('\n! marks a violated constraint; score is lower-is-better and counts only when ✓.');
}

// Apply --type and --set to a copy of a candidate.
function variant(project, base, opt) {
  const cand = structuredClone(base);
  if (opt.type) cand.controller = normalizeBlock('controller', { type: opt.type, params: cand.controller.params });
  for (const s of opt.set) {
    const m = s.match(/^(?:([a-z]+)\.)?([A-Za-z0-9_]+)=(.*)$/);
    if (!m) fail(`--set ${s}: expected key=value or slot.key=value`);
    const [, slotIn, key, rawVal] = m;
    const slot = slotIn ?? 'controller';
    if (!SLOTS.some((x) => x.key === slot)) fail(`--set ${s}: unknown slot "${slot}"`);
    let val;
    try { val = rawVal.startsWith('[') ? JSON.parse(rawVal) : (key === 'type' ? rawVal : Number(rawVal)); } catch { fail(`--set ${s}: bad value`); }
    const cur = slot === 'controller' ? cand.controller : (cand[slot] ?? project.system[slot]);
    const next = key === 'type' ? { type: val, params: cur.params } : { type: cur.type, params: { ...cur.params, [key]: val } };
    if (key !== 'type' && !blockDef(slot, cur.type).params.some((p) => p.key === key)) fail(`--set ${s}: ${cur.type} has no parameter "${key}"; it has ${blockDef(slot, cur.type).params.map((p) => p.key).join(', ') || 'none'}`);
    try {
      const block = normalizeBlock(slot, next);
      if (slot === 'controller') cand.controller = block; else cand[slot] = block;
    } catch (e) { fail(`--set ${s}: ${e.message}`); }
  }
  return cand;
}

function addCandidate(project, cand, name) {
  const c = { ...cand, name: uniqueName(project, name), checked: true, color: nextColor(project.candidates) };
  delete c.note;
  project.candidates.push(c);
  project.selected = c.name;
  return c;
}

const { pos, opt } = parseArgs(process.argv.slice(2));
const cmd = pos[0];
if (!cmd || opt.help || cmd === 'help') { console.log(HELP); process.exit(0); }

switch (cmd) {
  case 'examples':
    EXAMPLES.forEach((e, i) => console.log(`${i}  ${e.title}: ${e.notes}`));
    break;
  case 'new': {
    const ref = opt.example;
    const ex = ref === undefined ? DEFAULT_PROJECT : EXAMPLES[Number(ref)] ?? EXAMPLES.find((e) => e.title.toLowerCase() === String(ref).toLowerCase());
    if (!ex) fail(`no example "${ref}"; see "examples"`);
    const p = normalizeProject(ex);
    if (opt.o) { writeProject(opt.o, p); console.log(`wrote ${opt.o}`); } else console.log(JSON.stringify(p, null, 2));
    break;
  }
  case 'blocks': {
    const slots = pos[1] ? [pos[1]] : SLOTS.map((s) => s.key);
    const out = {};
    if (slots.includes('reference')) out.reference = Object.entries(SIGNALS).map(([type, d]) => ({ type, label: d.label, params: d.params, ...(type === 'arb' ? { points: '[[t, v], ...]' } : {}) }));
    for (const s of slots.filter((x) => x !== 'reference')) {
      if (!BLOCKS[s]) fail(`unknown slot "${s}"; slots: ${SLOTS.map((x) => x.key).join(', ')}`);
      out[s] = Object.values(BLOCKS[s]).map((b) => ({
        type: b.type, label: b.label, formula: b.formula,
        params: b.params.map(({ key, label, default: d, min, max, scale, unit, int, kind, tunable }) => ({ key, label, default: d, min, max, scale, unit, int, kind, tunable })),
      }));
    }
    console.log(JSON.stringify(out, null, 2));
    break;
  }
  case 'metrics':
    console.log(JSON.stringify(METRICS, null, 2));
    break;
  case 'eval': {
    const project = readProject(pos[1]);
    if (!loopReady(project)) {
      const msg = `${project.title}: no loop yet (${project.system.plant ? 'no controller candidates' : 'no plant'}); signals: ${Object.keys(project.system.signals).join(', ')}. See "signal".`;
      if (opt.json) console.log(JSON.stringify({ title: project.title, loop: false, message: msg }, null, 2)); else console.log(msg);
      break;
    }
    const { runs, rank } = evaluateProject(project);
    let entries = rank.map((i, r) => report(project, project.candidates[i], runs[i], r + 1));
    if (opt.candidate) { const name = project.candidates[findCandidate(project, opt.candidate)].name; entries = entries.filter((e) => e.name === name); }
    if (opt.json) console.log(JSON.stringify({ title: project.title, goal: project.goal, best: entries.find((e) => e.feasible)?.name ?? null, candidates: entries }, null, 2));
    else printEval(project, entries);
    break;
  }
  case 'signal': {
    const project = readProject(pos[1]);
    const name = opt.name ?? 'r';
    project.system.signals[name] ??= { period: 1, components: [] };
    const comps = project.system.signals[name].components;
    if (opt.add) {
      if (!SIGNALS[opt.add]) fail(`unknown waveform "${opt.add}"; types: ${Object.keys(SIGNALS).join(', ')}`);
      const params = {};
      for (const kv of opt.set) {
        const m = kv.match(/^([A-Za-z0-9_]+)=(.*)$/);
        if (!m || !SIGNALS[opt.add].params.some((q) => q.key === m[1])) fail(`--set ${kv}: ${opt.add} takes ${SIGNALS[opt.add].params.map((q) => q.key).join(', ')}`);
        params[m[1]] = Number(m[2]);
      }
      try { comps.push(normalizeComponent({ type: opt.add, params })); } catch (e) { fail(e.message); }
    }
    if (opt.remove !== undefined) {
      const i = Number(opt.remove) - 1;
      if (!(i >= 0 && i < comps.length)) fail(`--remove takes 1 to ${comps.length}`);
      comps.splice(i, 1);
    }
    if (opt.save) writeProject(pos[1], project);
    const { t, r } = referenceTrace(project, name);
    if (opt.json) console.log(JSON.stringify({ signal: name, period: project.system.signals[name].period, components: comps, min: Math.min(...r), max: Math.max(...r), final: r[r.length - 1] }, null, 2));
    else {
      console.log(`${name}(t), period ${fmt(project.system.signals[name].period)} s, = sum of:`);
      comps.forEach((c, i) => console.log(`  ${i + 1}  ${describeComponent(c)}${c.enabled === false ? '  (off)' : ''}`));
      if (!comps.length) console.log('  nothing (r = 0)');
      console.log(`range ${fmt(Math.min(...r))} … ${fmt(Math.max(...r))}, final ${fmt(r[r.length - 1])} at t = ${fmt(t[t.length - 1])} s`);
      if (opt.save) console.log(`saved ${pos[1]}`);
    }
    break;
  }
  case 'try': {
    const project = readProject(pos[1]);
    const base = project.candidates[findCandidate(project, opt.from ?? project.selected)] ?? fail('the project has no candidates');
    const cand = variant(project, base, opt);
    const run = evaluateCandidate(project, cand);
    const name = opt.name ?? `${base.name} try`;
    if (opt.save) { addCandidate(project, cand, name); writeProject(pos[1], project); }
    const r = report(project, { ...cand, name }, run);
    if (opt.json) console.log(JSON.stringify(r, null, 2));
    else { printEval(project, [r]); if (opt.save) console.log(`\nadded “${project.selected}” to ${pos[1]}`); }
    break;
  }
  case 'tune': {
    const project = readProject(pos[1]);
    const base = project.candidates[findCandidate(project, opt.from ?? project.selected)] ?? fail('the project has no candidates');
    const params = opt.params ? opt.params.split(',').map((s) => s.trim()) : tunableParams(base.controller);
    let res;
    try { res = runTune(project, base, { params, maxEvals: Number(opt.evals ?? 300), seed: Number(opt.seed ?? 1) }); } catch (e) { fail(e.message); }
    const cand = { ...base, controller: { type: base.controller.type, params: res.best.params } };
    const run = evaluateCandidate(project, cand);
    const name = opt.name ?? `${base.name} tuned`;
    if (opt.save) { addCandidate(project, cand, name); writeProject(pos[1], project); }
    const r = { ...report(project, { ...cand, name }, run), tuned: params, evaluations: res.evals };
    if (opt.json) console.log(JSON.stringify(r, null, 2));
    else {
      printEval(project, [r]);
      console.log(`\ntuned ${params.join(', ')} in ${res.evals} runs${opt.save ? `; added “${project.selected}” to ${pos[1]}` : ''}`);
    }
    break;
  }
  case 'autotune': {
    const project = readProject(pos[1]);
    const method = opt.method ?? 'iterate';
    if (!TUNE_METHODS.includes(method)) fail(`--method: one of ${TUNE_METHODS.join(', ')}`);
    if (opt.rule && !RULES[opt.rule]) fail(`--rule: one of ${Object.keys(RULES).join(', ')}`);
    const goal = {};
    if (opt.cost) { goal.cost = opt.cost.toUpperCase(); if (!COSTS[goal.cost]) fail(`--cost: one of ${Object.keys(COSTS).join(', ')}`); }
    for (const k of ['effort', 'overshoot']) if (opt[k] !== undefined) { goal[k] = Number(opt[k]); if (!(goal[k] >= 0)) fail(`--${k}: a number, 0 or more`); }
    const amplitude = opt.amplitude === undefined ? undefined : Number(opt.amplitude) / 100;
    if (amplitude !== undefined && !(amplitude > 0 && amplitude <= 1)) fail('--amplitude: a percentage of the actuator range above 0, up to 100');
    const path = opt.block ? opt.block.split('/') : null;
    if (path && !controllerBlocks(project.system.plant?.diagram).some((c) => c.key === opt.block)) fail(`--block ${opt.block}: no Controller block there; blocks: ${controllerBlocks(project.system.plant?.diagram).map((c) => c.key).join(', ') || 'none'}`);
    let res;
    try { res = autotune(project, path, { method, goal, rule: opt.rule, amplitude, maxIter: opt.iterations ? Number(opt.iterations) : undefined }); } catch (e) { fail(e.message); }
    if (res.ok && opt.save) { placeVariant(project, res.path, res.variant, { run: res.better }); writeProject(pos[1], project); }
    const rep = tuneReport(res);
    if (opt.json) { console.log(JSON.stringify(rep, null, 2)); if (!res.ok) process.exitCode = 1; break; }
    const g = rep.goal;
    console.log(`${project.title}: ${rep.where} (${rep.block}), ${method}; goal ${g.cost}, effort ${fmt(g.effort)}, overshoot ≤ ${fmt(g.overshoot)} %`);
    if (!res.ok) fail(`could not tune: ${res.why}`);
    const gains = (v) => tunedValues(v).map(([k, x]) => `${k} ${Array.isArray(x) ? `[${x.map((y) => fmt(y)).join(', ')}]` : fmt(x)}`).join('  ');
    const line = (label, v, c) => `  ${label}  ${v.name}: cost ${fmt(c.J)}, overshoot ${fmt(c.overshoot)} %, ${gains(v)}`;
    console.log(line('before', res.before.variant, res.before.cost));
    console.log(line('after ', res.variant, res.after) + `  (cost ×${fmt(res.after.J / res.before.cost.J)})`);
    if (method === 'iterate') console.log(`  ${res.iterations} iterations, ${res.evals} runs of the loop`);
    if (method === 'relay') console.log(`  relay around r0 = ${fmt(res.r0)}: Ku ${fmt(res.Ku)}, Pu ${fmt(res.Pu)} s; rule ${RULES[res.rule].label}`);
    if (method === 'step') console.log(`  step at r0 = ${fmt(res.r0)}: K ${fmt(res.K)}, τ ${fmt(res.tau)} s, θ ${fmt(res.theta)} s; SIMC, τc ${fmt(res.gains.tauC)} s`);
    for (const n of res.notes ?? []) console.log(`  note: ${n}`);
    if (!res.better) console.log('  the result scores no better than the running variant');
    if (opt.save) console.log(res.better ? `saved: “${res.variant.name}” now runs in ${pos[1]}` : `saved: “${res.variant.name}” added to ${pos[1]}; “${res.before.variant.name}” keeps running`);
    break;
  }
  case 'trace': {
    const project = readProject(pos[1]);
    let result;
    if (loopReady(project)) result = evaluateCandidate(project, project.candidates[findCandidate(project, opt.candidate ?? project.selected)]).result;
    else { const { t, r } = referenceTrace(project); const z = new Float64Array(t.length).fill(NaN); result = { t, r, y: z, u: z, ym: z, d: z }; }
    const every = Math.max(1, Number(opt.every ?? 1));
    const keys = ['t', 'r', 'y', 'u', 'ym', 'd'];
    if (opt.json) {
      const o = {};
      for (const k of keys) o[k] = Array.from(result[k]).filter((_, i) => i % every === 0);
      console.log(JSON.stringify(o));
    } else {
      const lines = [keys.join(',')];
      for (let i = 0; i < result.t.length; i += every) lines.push(keys.map((k) => +result[k][i].toPrecision(6)).join(','));
      console.log(lines.join('\n'));
    }
    break;
  }
  case 'html': {
    const project = readProject(pos[1]);
    const out = opt.o ?? pos[1].replace(/\.json$/i, '') + '.html';
    writeFileSync(out, buildHtml({ project }));
    console.log(`wrote ${out}`);
    break;
  }
  case 'extract': {
    const p = pos[1] ?? fail('give an exported .html file');
    console.log(JSON.stringify(normalizeProject(JSON.parse(extractJson(readFileSync(p, 'utf8'), p))), null, 2));
    break;
  }
  default:
    fail(`unknown command "${cmd}"\n\n${HELP}`);
}
