// What the command line (tools/cli.mjs) and the MCP server (mcp/mcp.mjs) both do with
// a project: read a project file's text and put a project into a page, find
// a library system, run a project and measure its loops, analyse a loop at
// an operating point, the designs, Auto-tune's options. Each function throws
// an Error with the sentence the core gives; each adapter reports it its own
// way. Pure, so it rides in the page's core too: the MCP server's download
// runs on the core cut from the page (core/hilsim.js simulatorCore).

import { normalizeProject, simOf, autoTimebase, defaultSampleTime, loopModel, loopReady, evaluateProject } from './project.js';
import { DEFAULT_PROJECT } from './examples.js';
import { SYSTEM_LIBRARY, SYSTEM_PARTS, applySystem } from './systems.js';
import { compileDiagram } from './diagram.js';
import { simulateSystem } from './sim.js';
import { computeMetrics } from './metrics.js';
import { analyzeLoop, stepInfo } from './analysis.js';
import { controllerBlocks, upstreamSource, costScales, runCost, GOAL, METHODS, RULES, SIMC, COSTS } from './autotune.js';

// ---- Project files: .json, or an exported .html page with the project inside

export function extractJson(html, path) {
  const m = html.match(/<script type="application\/json" id="loop-tuner-project">([\s\S]*?)<\/script>/);
  if (!m || !m[1].trim()) throw new Error(`${path} has no Loop Tuner project inside`);
  return m[1];
}

// A project file's text (path says which kind: .html or .json), normalised.
export function parseProject(text, path) {
  const raw = /\.html?$/i.test(path) ? extractJson(text, path) : text;
  try { return normalizeProject(JSON.parse(raw)); } catch (e) { throw new Error(`${path}: ${e.message}`); }
}

// A page with this project inside (as Export HTML makes it): the page's
// first project script (the shell's; the script's own copies come later)
// and its title replaced.
export function embedProject(html, project) {
  const json = JSON.stringify(project, null, 2).replace(/</g, '\\u003c');
  const tag = '<script type="application/json" id="loop-tuner-project">';
  const a = html.indexOf(tag), b = html.indexOf('</script>', a);
  if (a < 0 || b < 0) throw new Error('the page has no place for a project');
  const title = String(project.title ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `${html.slice(0, a)}${tag}\n${json}\n${html.slice(b)}`.replace(/<title>[^<]*<\/title>/, `<title>${title ? `${title} · ` : ''}Loop Tuner</title>`);
}

// ---- The System library

export const listSystems = () => SYSTEM_LIBRARY.map((e) => ({ name: e.name, tags: e.tags.map((t) => t.label), notes: e.notes }));

// An entry by its exact name (any case), else the first that starts with it.
export function findSystem(name) {
  const q = String(name).toLowerCase();
  const entry = SYSTEM_LIBRARY.find((e) => e.name.toLowerCase() === q) ?? SYSTEM_LIBRARY.find((e) => e.name.toLowerCase().startsWith(q));
  if (!entry) throw new Error(`no system "${name}"; systems: ${SYSTEM_LIBRARY.map((e) => e.name).join(', ')}`);
  return entry;
}

// A library entry as a whole project, its timebase one period of the input.
export function systemProject(entry) {
  const p = normalizeProject(applySystem(DEFAULT_PROJECT, entry, SYSTEM_PARTS.filter((k) => entry[k])));
  p.scope.timebase = autoTimebase(p);
  return p;
}

// ---- Blocks

const diagramOf = (project) => {
  const plant = project.system.plant;
  if (plant?.type !== 'diagram') throw new Error(`${project.title}: the plant is not a block diagram`);
  return plant.diagram;
};

// Every block at any depth: { path, block }, subsystems before their insides.
export function allBlocks(project) {
  const out = [];
  const walk = (d, path) => {
    for (const b of d.blocks) {
      out.push({ path: [...path, b.id].join('/'), block: b });
      if (b.type === 'subsystem') walk(b.diagram, [...path, b.id]);
    }
  };
  walk(diagramOf(project), []);
  return out;
}

export function findBlock(project, path) {
  const all = allBlocks(project);
  const hit = all.find((x) => x.path === String(path));
  if (!hit) throw new Error(`no block "${path}"; blocks: ${all.map((x) => x.path).join(', ')}`);
  return hit.block;
}

// A Controller block by its id path (default: the first), as Auto-tune and
// the Analysis tab name it.
function controllerAt(project, path) {
  const all = controllerBlocks(diagramOf(project));
  if (!all.length) throw new Error(`${project.title}: there is no Controller block in the plant`);
  if (path === undefined || path === null || path === '') return all[0];
  const hit = all.find((c) => c.key === String(path));
  if (!hit) throw new Error(`no Controller block "${path}"; Controller blocks: ${all.map((c) => c.key).join(', ')}`);
  return hit;
}

// ---- Designs

// What each running designed variant computed from the plant, now, as the
// page's Computed box shows it (a plan takes a few seconds). block: one id path.
export function projectDesigns(project, block) {
  const plant = project.system.plant;
  if (plant?.type !== 'diagram') throw new Error(`${project.title}: the plant is not a diagram, so nothing is designed from it`);
  let statuses;
  try { statuses = compileDiagram(plant.diagram, 'plant', { standalone: true, sources: {} }).designs; } catch (e) { throw new Error(`${project.title}: ${e.message}`); }
  if (block) {
    statuses = statuses.filter((s) => s.path === block);
    if (!statuses.length) throw new Error(`no designed variant runs in "${block}"`);
  }
  return statuses;
}

// ---- Run and measure

const finite = (v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v);
const round = (v) => (Number.isFinite(v) ? Number(v.toPrecision(6)) : null);

// Every n-th sample, and the last, so at most `points` values per signal.
export function downsample(t, signals, names, points) {
  const n = t.length, step = Math.max(1, Math.ceil(n / Math.max(2, points)));
  const idx = [];
  for (let k = 0; k < n; k += step) idx.push(k);
  if (idx.at(-1) !== n - 1) idx.push(n - 1);
  const out = { t: idx.map((k) => round(t[k])) };
  for (const name of names) out[name] = idx.map((k) => round(signals[name][k]));
  return out;
}

// One Controller block's loop in a run: Auto-tune's cost (its goal, scaled
// from this run, as Auto-tune scales its start) and the step metrics of r, y, u.
function loopReport(project, run, c, goal) {
  const s = run.signals, key = c.key, r = s[`${key}.r`], y = s[`${key}.y`], u = s[`${key}.u`];
  const variant = c.block.variants[c.block.variant ?? 0];
  const head = { block: key, where: c.where, variant: variant.name, type: variant.type };
  if (!r || !y || !u) return { ...head, why: 'the block has no r on input 1 and y on input 2, so its loop is not measured' };
  const source = upstreamSource(project.system.plant.diagram, c.path, 0);
  const others = source ? Object.keys(project.system.signals).filter((k) => k !== source) : [];
  const cost = runCost(run, key, goal, { scales: costScales(run, key, variant), variant, others });
  const n = run.t.length, e = new Float64Array(n), d = (others.length && s[others[0]]) || new Float64Array(n);
  for (let k = 0; k < n; k++) e[k] = r[k] - y[k];
  const m = computeMetrics({ t: run.t, r, y, u, v: u, e, d, info: { unstable: run.info.unstable } });
  const pick = ['riseTime', 'overshoot', 'undershoot', 'settlingTime', 'peakTime', 'steadyStateError', 'iae', 'ise', 'itae', 'uPeak', 'uTV', 'distPeak', 'distIAE'];
  return {
    ...head,
    cost: { J: cost.J, diverged: cost.diverged, overshoot: finite(cost.overshoot), saturated: cost.saturated, parts: cost.parts },
    metrics: { ...Object.fromEntries(pick.map((k) => [k, finite(m[k])])), saturation: 100 * cost.saturated },
  };
}

// Runs the project for its timebase (the page's run: from 0 to the right edge
// of the screen) or for `duration` seconds, and measures every Controller
// block's loop. opts: duration, goal (Auto-tune's: cost, effort, overshoot),
// signals (names to return downsampled), points (default 200).
export function runProject(project, { duration, goal = {}, signals = [], points = 200 } = {}) {
  if (loopReady(project)) {
    // An older project: a plant and controller candidates, scored against its goal.
    const { runs, rank } = evaluateProject(project);
    return { title: project.title, kind: 'candidates', goal: project.goal, candidates: rank.map((i, r) => ({ rank: r + 1, name: project.candidates[i].name, score: finite(runs[i].evaluation.score), feasible: runs[i].evaluation.feasible, metrics: Object.fromEntries(Object.entries(runs[i].metrics).filter(([k]) => k !== 'events').map(([k, v]) => [k, finite(v)])) })) };
  }
  const diagram = diagramOf(project);
  if (duration !== undefined && !(Number(duration) > 0)) throw new Error('duration: a time in seconds, above 0');
  const base = simOf(project);
  const sim = duration === undefined ? base : { duration: Number(duration), sampleTime: project.sim.sampleTime ?? defaultSampleTime(Number(duration)) };
  const run = simulateSystem(diagram, project.system.signals, sim);
  const names = Object.keys(run.signals);
  const missing = signals.filter((x) => !names.includes(x));
  if (missing.length) throw new Error(`no signal ${missing.map((x) => `"${x}"`).join(', ')}; signals: ${names.join(', ')}`);
  const g = { ...GOAL, ...goal };
  const out = {
    title: project.title, kind: 'system', duration: sim.duration, sampleTime: sim.sampleTime, samples: run.t.length,
    unstable: run.info.unstable, warnings: run.info.warnings, goal: g,
    // What the run reported (the integration: step, steps, bound, the
    // Jacobian's at start and end, time; validity where the diagram has one).
    info: (({ validity = [], h, substeps, steps, bound, stiffness, ms }) => ({ validity, h, substeps, steps, bound, stiffness, ms }))(run.info),
    loops: controllerBlocks(diagram).map((c) => loopReport(project, run, c, g)),
    designs: (run.info.designs ?? []).map((st) => ({ block: st.path, variant: st.variant, type: st.type, status: st.status, ...(st.error ? { error: st.error.message } : {}) })),
    signals: names,
  };
  if (signals.length) out.traces = downsample(run.t, run.signals, signals, Math.min(2000, Math.max(2, Number(points) || 200)));
  return out;
}

// ---- Analysis

// An operating point from text: origin, initial, t=1.5, y=0.3 or y=0.3,null.
export function parseAt(text) {
  if (text === undefined || text === null) return 'origin';
  if (typeof text === 'object') return text;
  const s = String(text).trim();
  if (s === 'origin' || s === 'initial') return s;
  let m = s.match(/^t\s*=\s*(.+)$/);
  if (m) return { t: Number(m[1]) };
  m = s.match(/^y\s*=\s*(.+)$/);
  if (m) return { y: m[1].split(',').map((v) => (v.trim() === 'null' ? null : Number(v))) };
  throw new Error(`at: origin, initial, t=<seconds> or y=<level>[,<level>…]; not "${text}"`);
}

const sPole = (p) => ({ re: finite(p.s.re), im: p.s.im, wn: finite(p.s.wn), zeta: p.s.zeta, z: { re: p.z.re, im: p.z.im }, side: p.side });

// The Analysis tab's numbers for a Controller block's loop at an operating
// point ('origin', 'initial', { y: [levels] }, { t: seconds }): stability,
// the margins, the closed-loop poles, the linear step. Where there is no
// linear loop, the core's refusal: its sentence, then its hint.
export function analyzeProject(project, { block, at = 'origin' } = {}) {
  const c = controllerAt(project, block);
  let m;
  try { m = loopModel(project, c.path, at); } catch (e) {
    const err = new Error(`${c.key}: ${e.message}${e.hint ? ` (${e.hint})` : ''}`);
    err.code = e.code;
    throw err;
  }
  const r = analyzeLoop(m.plant, m.ctrl, m.Ts), g = r.margins;
  const st = r.stable ? stepInfo(m.plant, m.ctrl, m.Ts, { clPoles: r.clPoles }) : null;
  const poles = [...r.clPoles].sort((a, b) => (b.s.re ?? -Infinity) - (a.s.re ?? -Infinity));
  return {
    block: c.key, where: c.where, variant: m.variantName, type: m.type, at: m.opLabel, Ts: m.Ts,
    stable: r.stable, marginal: r.marginal, openLoopUnstable: r.P, closedLoopUnstable: r.Z,
    margins: {
      gainUp: finite(g.gmUp), gainUpDb: Number.isFinite(g.gmUp) ? 20 * Math.log10(g.gmUp) : null, gainDown: g.gmDown,
      phase: finite(g.pm), crossover: finite(g.wc), delay: finite(g.dm), delaySamples: finite(g.dm / m.Ts),
      Ms: g.ms, Mt: g.mt,
    },
    zetaMin: r.zetaMin, slowest: r.slowest ? sPole(r.slowest) : null,
    closedLoopPoles: poles.slice(0, 40).map(sPole), poleCount: poles.length,
    step: st ? { overshoot: st.overshoot ?? null, settlingTime: st.settled ? st.settle : null, settled: st.settled ?? null, final: finite(st.yf), window: st.T } : null,
    atLimit: m.atLimit, warnings: m.warnings,
  };
}

// ---- Auto-tune's options

// Checks options as the command line and the MCP server take them and turns
// them into autotune()'s: { path, opts }. amplitude is a percentage of the
// actuator range; iterations the optimiser's limit.
export function autotuneOptions(project, o = {}) {
  const method = o.method ?? 'iterate';
  if (!METHODS.includes(method)) throw new Error(`method: one of ${METHODS.join(', ')}`);
  if (o.rule && !RULES[o.rule]) throw new Error(`rule: one of ${Object.keys(RULES).join(', ')}`);
  if (o.simc && !SIMC[o.simc]) throw new Error(`simc: one of ${Object.keys(SIMC).join(', ')}`);
  const goal = {};
  if (o.cost) { goal.cost = String(o.cost).toUpperCase(); if (!COSTS[goal.cost]) throw new Error(`cost: one of ${Object.keys(COSTS).join(', ')}`); }
  for (const k of ['effort', 'overshoot']) if (o[k] !== undefined) { goal[k] = Number(o[k]); if (!(goal[k] >= 0)) throw new Error(`${k}: a number, 0 or more`); }
  const amplitude = o.amplitude === undefined ? undefined : Number(o.amplitude) / 100;
  if (amplitude !== undefined && !(amplitude > 0 && amplitude <= 1)) throw new Error('amplitude: a percentage of the actuator range above 0, up to 100');
  const path = o.block ? String(o.block).split('/') : null;
  if (path && !controllerBlocks(project.system.plant?.diagram).some((c) => c.key === o.block)) throw new Error(`block ${o.block}: no Controller block there; blocks: ${controllerBlocks(project.system.plant?.diagram).map((c) => c.key).join(', ') || 'none'}`);
  return { path, opts: { method, goal, rule: o.rule, simc: o.simc, amplitude, maxIter: o.iterations ? Number(o.iterations) : undefined, feedforward: !!o.ff } };
}

// ---- Traces (the screen, the live record) for an agent

// A saved trace (core/trace.js parseTrace's { t, signals, units }) in brief:
// its span and, per signal, unit, min, max, mean and last value within
// [from, to]; with signals, those downsampled to points. Summaries first, so
// an agent reads a few numbers before it asks for samples.
export function traceSummary(trace, { from = -Infinity, to = Infinity, signals = [], points = 200 } = {}) {
  const names = Object.keys(trace.signals);
  const missing = signals.filter((x) => !names.includes(x));
  if (missing.length) throw new Error(`no signal ${missing.map((x) => `"${x}"`).join(', ')}; signals: ${names.join(', ')}`);
  let i0 = 0, i1 = trace.t.length;
  while (i0 < i1 && trace.t[i0] < from - 1e-9) i0++;
  while (i1 > i0 && trace.t[i1 - 1] > to + 1e-9) i1--;
  const t = Array.from(trace.t.slice(i0, i1));
  const stats = names.map((name) => {
    const v = trace.signals[name];
    let n = 0, lo = Infinity, hi = -Infinity, sum = 0, last = null;
    for (let k = i0; k < i1; k++) if (Number.isFinite(v[k])) { n++; lo = Math.min(lo, v[k]); hi = Math.max(hi, v[k]); sum += v[k]; last = v[k]; }
    return { name, unit: trace.units?.[name] ?? '1', min: n ? round(lo) : null, max: n ? round(hi) : null, mean: n ? round(sum / n) : null, last: n ? round(last) : null };
  });
  const out = { samples: t.length, span: t.length ? [round(t[0]), round(t.at(-1))] : null, signals: stats };
  if (signals.length && t.length) {
    const sliced = Object.fromEntries(signals.map((n) => [n, trace.signals[n].slice(i0, i1)]));
    out.traces = downsample(t, sliced, signals, Math.min(2000, Math.max(2, Number(points) || 200)));
  }
  return out;
}
