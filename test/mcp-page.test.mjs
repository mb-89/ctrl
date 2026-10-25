// The agentic mode (design/output/mcp.md): the MCP server serves the page, a
// browser opens it, the page connects back, and the page_ tools change what
// the person sees. Driven as a client and a person would: an MCP client over
// the server's stdio, Chromium on the page. Skipped where Playwright is not
// installed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startServer, stopAll } from '../tools/mcp-client.mjs';
import { buildHtml } from '../tools/build.mjs';

const require = createRequire(import.meta.url);
let chromium = null;
try { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); } catch { /* not installed */ }
after(stopAll);

test('agentic mode: the page served by the MCP server connects back, and the page tools act on it', { skip: !chromium && 'Playwright is not installed' }, async () => {
  const s = startServer();
  const browser = await chromium.launch();
  try {
    const status0 = await s.call('page_status');
    assert.match(status0.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.equal(status0.connected, false);
    await assert.rejects(s.call('page_set_gains', { params: { Kp: 1 } }), /no page is connected: open http/);

    const page = await browser.newPage();
    await page.goto(status0.url);
    await page.waitForSelector('#lt-shell[data-agent="connected"]', { timeout: 20000 });
    assert.equal((await s.call('page_status')).connected, true);

    // What the agent does, the person sees.
    const loaded = await s.call('page_load_system', { system: 'DC motor, position control' });
    assert.equal(loaded.loaded, 'DC motor, position control');
    assert.equal(await page.evaluate(() => window.loopTuner.getProject().title), 'DC motor, position control');
    const v = await s.call('page_set_gains', { params: { Kp: 7 } });
    assert.equal(v.params.Kp, 7);
    assert.equal(await page.evaluate(() => { const b = window.loopTuner.getProject().system.plant.diagram.blocks.find((x) => x.id === 'ctrl'); return b.variants[b.variant].params.Kp; }), 7);
    await assert.rejects(s.call('page_set_gains', { params: { Kq: 1 } }), /has no Kq/);
    assert.equal((await s.call('page_set_variant', { variant: 'PD' })).name, 'PD');
    assert.equal((await s.call('page_control', { action: 'stop' })).ok, true);
    assert.equal((await s.call('page_control', { action: 'run' })).ok, true);

    // The data, summaries first.
    await page.waitForFunction(() => window.loopTuner.record.screen('csv').length > 0, null, { timeout: 20000 });
    const sig = await s.call('page_signals');
    const angle = sig.signals.find((x) => x.name === 'angle');
    assert.equal(angle.unit, 'rad');
    assert.ok(sig.samples > 100 && angle.max > 1, 'the screen\'s run, in brief');
    assert.equal(sig.traces, undefined, 'no samples unless asked');
    const tr = await s.call('page_signals', { signals: ['r', 'angle'], points: 20, from: 0, to: 2 });
    assert.ok(tr.traces.t.length <= 21 && tr.traces.t.at(-1) <= 2);
    assert.equal((await s.call('page_live')).state, 'offline', 'no live plant in this system: offline');

    // Auto-tune on the page: applied, it runs there, and the history keeps it.
    const rep = await s.call('page_autotune', { iterations: 6 });
    assert.equal(rep.ok, true);
    assert.equal(await page.evaluate(() => { const b = window.loopTuner.getProject().system.plant.diagram.blocks.find((x) => x.id === 'ctrl'); return b.variants.some((x) => / · auto-tuned/.test(x.name)); }), true);
    const hist = await s.call('autotune_history');
    assert.equal(hist.runs.at(-1).where, 'page');
    assert.equal((await s.call('autotune_history', { index: hist.runs.at(-1).index })).report.method, 'iterate');

    const an = await s.call('page_analyze', { at: 'initial' });
    assert.equal(typeof an.stable, 'boolean');
    assert.ok(Array.isArray((await s.call('page_designs')).designs));
    const own = await s.call('page_get_project', { as: 'from-page' });
    assert.equal(own.title, 'DC motor, position control');
    assert.equal((await s.call('run', { project: 'from-page' })).loops[0].block, 'ctrl');

    // A picture of the scope.
    const shot = await s.request('tools/call', { name: 'page_screenshot', arguments: {} });
    assert.equal(shot.result.content[0].type, 'image');
    assert.ok(Buffer.from(shot.result.content[0].data, 'base64').subarray(1, 4).toString() === 'PNG');

    // A second page takes the link over; the first is told.
    const second = await browser.newPage();
    await second.goto(status0.url);
    await second.waitForSelector('#lt-shell[data-agent="connected"]', { timeout: 20000 });
    await page.waitForSelector('#lt-shell[data-agent="closed"]', { timeout: 20000 });
  } finally {
    await browser.close();
    await s.close();
  }
});

test('agentic mode: a page not served by the MCP server never connects anywhere', { skip: !chromium && 'Playwright is not installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lt-page-'));
  const file = join(dir, 'page.html');
  writeFileSync(file, buildHtml());
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const sockets = [];
    page.on('websocket', (ws) => sockets.push(ws.url()));
    await page.goto(pathToFileURL(file).href);
    await page.waitForFunction(() => !!window.loopTuner);
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => document.getElementById('lt-shell').dataset.agent ?? null), null);
    assert.deepEqual(sockets, []);
  } finally { await browser.close(); }
});
