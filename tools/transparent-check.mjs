// Checks the open models in a real browser (design/output/transparent-models.md
// steps 7 and 8): in the Triple pendulum, the Pendulum swing-up and the
// Conical tank, a double-click on the model opens it into its parts; the
// World shows the equations of motion in the parameters' names; the Physics
// templates insert and the diagram stays valid. Screenshots light and dark.
// Not part of npm test.
//
//   node tools/build.mjs && node tools/transparent-check.mjs [screenshot folder]
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
const OUT = process.argv[2] || join(tmpdir(), 'transparent-shots');
mkdirSync(OUT, { recursive: true });

const SYSTEMS = [
  { name: 'Triple pendulum', id: 'cart', parts: ['world', 'rail', 'cart', 'hinge1', 'rod1', 'hinge2', 'rod2', 'hinge3', 'rod3'], sheet: /\(M \+ m1 \+ m2 \+ m3\)·v̇ \+ l1·\(m1 \+ m2 \+ m3\)·cos θ1·ω̇1/ },
  { name: 'Pendulum swing-up', id: 'cart', parts: ['world', 'rail', 'cart', 'hinge', 'pole'], sheet: /\(M \+ m\)·v̇ \+ l·m·cos θ·ω̇ = F − b·v \+ l·m·sin θ·ω²/ },
  { name: 'Conical tank, gain scheduling', id: 'tank', parts: ['net', 'rate', 'level', 'outlet'], sheet: null },
];

const browser = await chromium.launch();
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, colorScheme: scheme });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pathToFileURL(join(ROOT, 'dist/loop-tuner.html')).href);
  await page.waitForFunction(() => window.loopTuner);
  for (const sys of SYSTEMS) {
    const tag = `${scheme} ${sys.name}`;
    await page.evaluate((n) => window.loopTuner.loadSystem(n), sys.name);
    await page.click('[data-tab="plant"]');
    await page.click('[data-rep="-1"]');
    await page.click('#pl-fit');
    await page.locator(`.blk[data-block="${sys.id}"] .body`).dblclick();
    await page.waitForTimeout(150);
    const ids = await page.locator('.pdiag .blk').evaluateAll((els) => els.map((e) => e.dataset.block));
    check(sys.parts.every((p) => ids.includes(p)), `${tag}: opens into ${sys.parts.join(', ')}`);
    check(/valid/.test(await page.locator('#pl-props').innerText()), `${tag}: valid inside`);
    const slug = sys.name.split(/[ ,]/)[0].toLowerCase();
    if (sys.sheet) {
      await page.locator('.blk[data-block="world"] .body').click();
      const text = await page.locator('#pl-props .eom').innerText().catch(() => '');
      check(sys.sheet.test(text), `${tag}: the World shows the equations of motion`);
      const title = await page.locator('#pl-props .eom .coef').first().getAttribute('title').catch(() => null);
      check(/=\s*[\d.]+/.test(title ?? ''), `${tag}: a coefficient's value on hover (${title})`);
    } else {
      await page.locator('.blk[data-block="rate"] .body').click();
    }
    await page.screenshot({ path: join(OUT, `open-${slug}-${scheme}.png`) });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  }
  // A template inserts its masked model; the diagram stays valid, the mask shows.
  await page.evaluate(() => window.loopTuner.loadSystem('Triple pendulum'));
  await page.click('[data-tab="plant"]');
  await page.click('[data-rep="-1"]');
  const before = await page.locator('.pdiag .blk').count();
  await page.locator('[data-add="tpl:pendulum2"]').click().catch(async () => { await page.locator('[data-fold="Physics"]').click(); await page.locator('[data-add="tpl:pendulum2"]').click(); });
  check((await page.locator('.pdiag .blk').count()) === before + 1, `${scheme}: the Double pendulum template inserts one block`);
  const props = await page.locator('#pl-props').innerText();
  check(/Mask/i.test(props) && /Rod l2/.test(props) && /Equations of motion/i.test(props), `${scheme}: it shows its mask and its equations of motion`);
  await page.screenshot({ path: join(OUT, `template-${scheme}.png`) });
  check(!errors.length, `${scheme}: no page errors ${errors.join(' | ')}`);
  await page.close();
}
await browser.close();
console.log(`screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
