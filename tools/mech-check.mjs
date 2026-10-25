// Checks the Plant tab's mechanics in a real browser (design/output/
// transparent-models.md §1.7, step 6): a mechanism written in JSON draws with
// its frame ports and joins; removing the join under a rod gives the
// mechanism's error with the parts outlined, joining it again by dragging
// from one frame port to the other makes it run; Group refuses a selection
// that holds part of a mechanism. Screenshots light and dark. Not part of npm test.
//
//   node tools/build.mjs && node tools/mech-check.mjs [screenshot folder]
//
// Needs Playwright with Chromium (PLAYWRIGHT names the module if it is not
// resolvable from here). Exits non-zero if a step is wrong.

import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const OUT = process.argv[2] || join(tmpdir(), 'mech-shots');
mkdirSync(OUT, { recursive: true });

// A cart and pole at the top level, written by hand: F → rail, x and θ to Sinks.
const DIAGRAM = {
  blocks: [
    { id: 'F', type: 'source', params: { signal: 'F', unit: 'N' }, x: 20, y: 60 },
    { id: 'world', type: 'world', name: 'world', params: { g: 9.81 }, x: 20, y: 200 },
    { id: 'rail', type: 'rail', name: 'rail', params: { name: 'x', rate: 'v', b: 0.1, force: 1 }, x: 150, y: 120 },
    { id: 'cart', type: 'mass', name: 'cart', params: { m: 1 }, x: 170, y: 250 },
    { id: 'hinge', type: 'hinge', name: 'hinge', params: { name: 'θ', rate: 'ω', theta0: 0.3 }, x: 360, y: 120 },
    { id: 'pole', type: 'rod', name: 'pole', params: { l: 0.5, m: 0.2, at: 'tip' }, x: 400, y: 250 },
    { id: 'x', type: 'sink', params: { name: 'x', unit: 'm' }, x: 600, y: 90 },
    { id: 'theta', type: 'sink', params: { name: 'theta', unit: 'rad' }, x: 600, y: 140 },
  ],
  wires: [{ from: 'F', to: 'rail' }, { from: 'rail', to: 'x' }, { from: 'hinge', to: 'theta' }],
  joins: [['world:W', 'rail:B'], ['rail:F', 'cart:F', 'hinge:B'], ['hinge:F', 'pole:B']],
};

const browser = await chromium.launch();
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: scheme });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pathToFileURL(join(ROOT, 'dist/loop-tuner.html')).href);
  await page.waitForFunction(() => window.loopTuner);
  await page.evaluate((d) => {
    const p = window.loopTuner.getProject();
    p.system.plant = { type: 'diagram', diagram: d, views: [] };
    p.system.signals = { F: { period: 5, components: [] } };
    window.loopTuner.setProject(p);
  }, DIAGRAM);
  await page.click('[data-tab="plant"]');
  await page.click('#pl-fit');
  const props = () => page.locator('#pl-props').innerText();
  check((await page.locator('.pdiag .fport').count()) === 8, `${scheme}: eight frame ports drawn`);
  check((await page.locator('.pdiag .join').count()) === 3 && (await page.locator('.pdiag .jdot').count()) === 1, `${scheme}: three joins, one dot where three ports meet`);
  check(/valid/.test(await props()), `${scheme}: the diagram is valid`);
  await page.screenshot({ path: join(OUT, `mech-${scheme}.png`) });
  // Remove the join under the pole: click its line, Del.
  const f = await page.locator('[data-frame="pole:B"]').boundingBox();
  await page.mouse.click(f.x + f.width / 2, f.y + f.height + 6);
  await page.keyboard.press('Delete');
  const said = await props();
  check(/'pole' is not joined to a World/.test(said), `${scheme}: unjoined, the pole's sentence: ${said.split('\n').find((l) => /pole/.test(l))}`);
  check(await page.locator('.blk.err[data-block="pole"]').count() === 1, `${scheme}: the pole outlined`);
  await page.screenshot({ path: join(OUT, `mech-unjoined-${scheme}.png`) });
  // Join it again: drag from hinge:F to pole:B.
  const a = await page.locator('[data-frame="hinge:F"]').boundingBox(), b = await page.locator('[data-frame="pole:B"]').boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
  check(/valid/.test(await props()) && (await page.locator('.pdiag .join').count()) === 3, `${scheme}: joined again, valid`);
  const joins = await page.evaluate(() => window.loopTuner.getProject().system.plant.diagram.joins);
  check(JSON.stringify(joins.at(-1)) === '["hinge:F","pole:B"]', `${scheme}: the join stored as ${JSON.stringify(joins.at(-1))}`);
  // Group refuses part of a mechanism.
  await page.locator('.blk[data-block="rail"] .body').click();
  await page.keyboard.press('Control+g');
  const toast = await page.locator('#toast').innerText();
  check(/rail is joined to .*which .* not selected: a mechanism stays in one diagram/.test(toast), `${scheme}: Group refused: "${toast}"`);
  check(!errors.length, `${scheme}: no page errors ${errors.join(' | ')}`);
  await page.close();
}
await browser.close();
console.log(`screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
