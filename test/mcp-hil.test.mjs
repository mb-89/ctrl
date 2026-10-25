// HIL with an agent (input 31), end to end: the MCP server serves the page,
// Chromium opens it, the example plant runs (hil_plant.py), and the agent's
// page tools connect it, read its interface and the live record, switch its
// mode and back, and are refused where the page cannot help yet (Auto-tune
// needs an identified model). Skipped where Playwright or the plant cannot
// run here.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer, stopAll } from '../tools/mcp-client.mjs';
import { startPlant } from './plant.mjs';

const require = createRequire(import.meta.url);
let chromium = null;
try { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); } catch { /* not installed */ }
after(stopAll);
const wires = (p) => p.system.plant.diagram.wires.map((w) => `${w.from}>${w.to}`);

test('HIL with an agent: the agent connects the plant on the page, reads it, switches its mode and back', { skip: !chromium && 'Playwright is not installed' }, async (t) => {
  const plant = await startPlant(['--seed', '5']);
  if (!plant) { t.skip('the plant cannot run here (uv with websockets and mini-racer)'); return; }
  const s = startServer();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto((await s.call('page_status')).url);
    await page.waitForSelector('#lt-shell[data-agent="connected"]', { timeout: 20000 });
    const loaded = await s.call('page_load_system', { system: 'HIL with an agent' });
    assert.equal(loaded.loaded, 'HIL with an agent');
    assert.equal((await s.call('page_live')).state, 'offline');

    const open = await s.call('page_live', { action: 'connect', url: `ws://127.0.0.1:${plant.port}` });
    assert.equal(open.state, 'open');
    assert.deepEqual(open.plant.inputs.map((p) => p.name), ['V'], 'the plant\'s interface, all the page knows');
    await assert.rejects(s.call('page_autotune'), /black box|identified model/);

    // Run a little, read the live record in brief.
    assert.equal((await s.call('page_control', { action: 'run' })).ok, true);
    await page.waitForFunction(() => window.loopTuner.live.state().state === 'running', null, { timeout: 15000 });
    await page.waitForFunction(() => window.loopTuner.record.state().recorded > 1, null, { timeout: 15000 });
    const rec = await s.call('page_signals', { source: 'record' });
    assert.ok(rec.samples > 50 && rec.signals.some((x) => x.name === 'angle' && x.unit === 'rad'));
    await assert.rejects(s.call('page_live', { action: 'mode', mode: 'reference' }).then((st) => { if (st.mode !== 'reference') throw new Error(st.message); }), /Stop the plant first/);
    await s.call('page_control', { action: 'stop' });
    await page.waitForFunction(() => window.loopTuner.live.state().state === 'open', null, { timeout: 15000 });

    // The switch: the plant runs its own controller, r goes straight to it.
    const ref = await s.call('page_live', { action: 'mode', mode: 'reference' });
    assert.equal(ref.mode, 'reference');
    const p = await s.call('page_get_project');
    assert.ok(wires(p).includes('r>plant') && !wires(p).includes('ctrl>plant'));
    assert.equal(await page.$eval('#live-mode-switch [data-mode="reference"]', (b) => b.getAttribute('aria-pressed')), 'true');
    const back = await s.call('page_live', { action: 'mode', mode: 'control' });
    assert.equal(back.mode, 'control');
    assert.ok(wires(await s.call('page_get_project')).includes('ctrl>plant'));
    assert.equal((await s.call('page_live', { action: 'disconnect' })).state, 'offline');
  } finally {
    await browser.close();
    await s.close();
    plant.proc.kill('SIGINT');
    await Promise.race([plant.exited, new Promise((r) => setTimeout(r, 3000))]);
  }
});
