// The MCP server (mcp.mjs, design/output/mcp.md), spoken to as a client does:
// a child process, one JSON-RPC message per line. Both eras of the protocol
// open; every tool runs on two library systems, and where the command line
// does the same, the results are the command line's.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, stopAll, MODERN } from '../tools/mcp-client.mjs';

const CORE_TOOLS = ['list_systems', 'list_projects', 'load_system', 'get_project', 'set_project', 'list_blocks', 'get_block', 'set_params', 'run', 'autotune', 'autotune_history', 'analyze', 'designs', 'identify', 'save_project', 'export_html'];
const PAGE_TOOLS = ['page_status', 'page_open', 'page_load_system', 'page_get_project', 'page_set_project', 'page_set_gains', 'page_set_variant', 'page_control', 'page_signals', 'page_autotune', 'page_analyze', 'page_designs', 'page_live', 'page_screenshot'];
const TOOLS = [...CORE_TOOLS, ...PAGE_TOOLS];
const SYSTEMS = ['DC motor, position control', 'Oven, badly tuned'];
const cli = (...args) => JSON.parse(execFileSync(process.execPath, ['cli.mjs', ...args]).toString());
const without = (o, ...keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
// A run as it compares: its wall-clock time (info.ms) set aside.
const steady = (r) => ({ ...r, info: r.info && { ...r.info, ms: null } });
const dir = mkdtempSync(join(tmpdir(), 'lt-mcp-'));
after(stopAll);

test('mcp: a client of the earlier revisions opens with initialize and lists the tools', async () => {
  const s = startServer({ modern: false });
  const init = await s.ready;
  assert.equal(init.result.protocolVersion, '2025-11-25');
  assert.deepEqual(init.result.capabilities, { tools: { listChanged: false } });
  assert.equal(init.result.serverInfo.name, 'loop-tuner');
  const list = await s.request('tools/list');
  assert.equal(list.result.resultType, undefined, 'no 2026 fields for an earlier revision');
  assert.deepEqual(list.result.tools.map((t) => t.name), TOOLS);
  for (const t of list.result.tools) {
    assert.ok(t.description.length > 40, `${t.name} says what it does`);
    assert.equal(t.inputSchema.type, 'object', `${t.name} has a JSON Schema`);
  }
  // A version it does not know: initialize answers with the latest it has.
  const old = startServer({ modern: false, initialize: false });
  assert.equal((await old.request('initialize', { protocolVersion: '2023-01-01', capabilities: {}, clientInfo: { name: 'x', version: '1' } })).result.protocolVersion, '2025-11-25');
  await Promise.all([s.close(), old.close()]);
});

test('mcp: a 2026-07-28 client carries the version on every request; discover, version errors, malformed requests', async () => {
  const s = startServer();
  const d = await s.request('server/discover');
  assert.equal(d.result.resultType, 'complete');
  assert.ok(d.result.supportedVersions.includes(MODERN) && d.result.supportedVersions.includes('2025-11-25'));
  assert.equal(d.result._meta['io.modelcontextprotocol/serverInfo'].name, 'loop-tuner');
  const list = await s.request('tools/list');
  assert.equal(list.result.resultType, 'complete');
  assert.equal(list.result.tools.length, TOOLS.length);
  const bad = await s.request('tools/list', {}, { extraMeta: { 'io.modelcontextprotocol/protocolVersion': '1900-01-01' } });
  assert.equal(bad.error.code, -32022);
  assert.deepEqual(bad.error.data.requested, '1900-01-01');
  // No version and no initialize: invalid params, naming what is supported.
  const bare = startServer({ modern: false, initialize: false });
  const r = await bare.request('tools/list');
  assert.equal(r.error.code, -32602);
  assert.match(r.error.message, /2026-07-28/);
  assert.equal((await s.request('tools/call', { name: 'nope', arguments: {} })).error.code, -32602);
  assert.equal((await s.request('resources/list')).error.code, -32601);
  assert.deepEqual(without((await s.request('ping')).result, '_meta'), { resultType: 'complete' });
  // Arguments the schema refuses are a tool error the model can read.
  await assert.rejects(s.call('list_systems', { tags: 'PID' }), /unknown tags/);
  await Promise.all([s.close(), bare.close()]);
});

for (const system of SYSTEMS) {
  test(`mcp: every tool on "${system}", the command line's results`, async () => {
    const file = join(dir, `${system.split(',')[0].replace(/\W+/g, '-')}.json`);
    execFileSync(process.execPath, ['cli.mjs', 'new', '--system', system, '-o', file]);
    const s = startServer();
    assert.ok((await s.call('list_systems')).systems.some((x) => x.name === system));
    assert.ok((await s.call('list_systems', { tag: 'PID' })).systems.every((x) => x.tags.includes('PID')));
    await assert.rejects(s.call('run'), /no project loaded yet/);
    const loaded = await s.call('load_system', { system });
    assert.equal(loaded.project, system);
    assert.equal(loaded.controllers[0].block, 'ctrl');
    assert.deepEqual((await s.call('list_projects')).default, system);

    // The project is the command line's, so every answer below can be compared.
    const project = await s.call('get_project');
    assert.deepEqual(project, JSON.parse(readFileSync(file, 'utf8')));
    const blocks = (await s.call('list_blocks')).blocks;
    assert.ok(blocks.some((b) => b.path === 'ctrl' && b.type === 'controller' && b.variants.length));
    assert.deepEqual(await s.call('get_block', { block: 'ctrl' }), project.system.plant.diagram.blocks.find((b) => b.id === 'ctrl'));
    await assert.rejects(s.call('get_block', { block: 'nope' }), /no block "nope"; blocks: .*ctrl/);

    const run = await s.call('run', { signals: ['ctrl.r', 'ctrl.y'], points: 50 });
    assert.deepEqual(steady(without(run, 'project', 'traces')), steady(cli('run', file, '--json')));
    assert.equal(run.loops[0].block, 'ctrl');
    assert.ok(run.loops[0].cost.J > 0 && Number.isFinite(run.loops[0].metrics.iae));
    assert.ok(run.traces.t.length <= 51 && run.traces['ctrl.y'].length === run.traces.t.length, 'traces are downsampled');
    await assert.rejects(s.call('run', { signals: ['nope'] }), /no signal "nope"; signals: /);

    const an = await s.call('analyze', { at: 'initial' });
    assert.deepEqual(without(an, 'project'), cli('analyze', file, '--at', 'initial', '--json'));
    assert.equal(typeof an.stable, 'boolean');
    const at = await s.call('analyze', { at: { t: 1 } });
    assert.match(at.at, /t = 1\.00 s/);

    assert.deepEqual((await s.call('designs')).designs, cli('design', file, '--json').designs);
    await assert.rejects(s.call('identify'), /not built yet/);

    // Auto-tune: the command line's report; applied, the result runs if better.
    const tuned = await s.call('autotune', { method: 'relay' });
    assert.deepEqual(without(tuned, 'project', 'applied'), cli('autotune', file, '--method', 'relay', '--json'));
    assert.equal(tuned.applied, false);
    const applied = await s.call('autotune', { method: 'relay', apply: true });
    const ctrl = await s.call('get_block', { block: 'ctrl' });
    assert.ok(ctrl.variants.some((v) => v.name === applied.after.variant.name));
    assert.equal(ctrl.variants[ctrl.variant].name === applied.after.variant.name, applied.better);
    await assert.rejects(s.call('autotune', { method: 'sideways' }), /method: one of iterate, relay, step/);

    // set_params: a variant's gains, a block's own parameters, the input.
    const kp = ctrl.variants[ctrl.variant].params.Kp;
    const changed = await s.call('set_params', { block: 'ctrl', params: { Kp: kp * 0.5 } });
    assert.equal(changed.variant.params.Kp, kp * 0.5);
    await assert.rejects(s.call('set_params', { block: 'ctrl', params: { Kq: 1 } }), /has no Kq; its parameters: Kp, /);
    const pick = await s.call('set_params', { block: 'ctrl', variant: 0, select: true });
    assert.equal(pick.running, ctrl.variants[0].name);
    assert.equal((await s.call('set_params', { block: 'ctrl', blockParams: { Ts: 0.02 } })).params.Ts, 0.02);
    const sig = await s.call('set_params', { signal: 'r', period: 6 });
    assert.equal(sig.period, 6);
    assert.equal((await s.call('run')).duration > 0, true);

    // set_project, save_project, export_html; projects by name.
    await s.call('set_project', { project: 'copy', json: project });
    assert.deepEqual(await s.call('get_project', { project: 'copy' }), project);
    assert.equal((await s.call('list_projects')).default, 'copy');
    const out = await s.call('save_project', { project: 'copy', path: join(dir, 'saved.json') });
    assert.deepEqual(JSON.parse(readFileSync(out.path, 'utf8')), project);
    const page = await s.call('export_html', { path: join(dir, 'page.html') });
    assert.deepEqual(cli('extract', page.path), project);
    const back = await s.call('load_system', { path: page.path, as: 'from-page' });
    assert.equal(back.project, 'from-page');
    await s.close();
  });
}

test('mcp: refusals carry the core\'s sentence; Auto-tune reports progress and can be cancelled', async () => {
  const s = startServer({ modern: false });
  await s.ready;
  await s.call('load_system', { system: 'DC motor, sliding mode' });
  await assert.rejects(s.call('analyze'), /no linear model/);
  await s.call('load_system', { system: 'DC motor, position control' });
  await s.call('autotune', { iterations: 8 }, { extraMeta: { progressToken: 'p1' } });
  const progress = s.notes.filter((n) => n.method === 'notifications/progress' && n.params.progressToken === 'p1').map((n) => n.params.progress);
  assert.ok(progress.length >= 1 && progress.every((v, i) => !i || v > progress[i - 1]), 'progress increases');
  // Cancelled: no answer for it; the next request is served.
  let answered = false;
  s.request('tools/call', { name: 'autotune', arguments: { iterations: 400 } }, { id: 'long' }).then(() => { answered = true; });
  s.notify('notifications/cancelled', { requestId: 'long', reason: 'test' });
  const ping = await s.request('ping');
  assert.deepEqual(ping.result, {});
  assert.equal(answered, false, 'a cancelled request gets no answer');
  await s.close();
});
