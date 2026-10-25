// Checks Auto-tune and Analysis on the identified model in a real browser
// (design/output/identification.md §18 step 9): on the oven and the DC
// motor, identify, press Use for Auto-tune and Analysis, tune on the model
// (Iterate), and read the model's loop in Analysis with its ranges. Light
// and dark, 1440 and 390 px wide; no console errors, nothing wider than the
// viewport. Screenshots into the folder given. Not part of npm test.
//
//   node build.mjs && node tools/identify-model-check.mjs [screenshot folder]

import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { armProject } from '../test/fixtures/arm-project.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const OUT = process.argv[2] || join(tmpdir(), 'identify-model-shots');
mkdirSync(OUT, { recursive: true });

const SYSTEMS = [{ name: 'Oven, badly tuned', slug: 'oven' }, { name: 'DC motor, position', slug: 'motor' }];
const browser = await chromium.launch();
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };
const wide = (page) => page.evaluate(() => {
  const W = document.documentElement.clientWidth;
  const out = [...document.querySelectorAll('body *')].filter((e) => { if (!e.offsetParent && getComputedStyle(e).position !== 'fixed') return false; const r = e.getBoundingClientRect(); if (!(r.width > 0 && (r.right > W + 1 || r.left < -1))) return false;
    // Inside a strip that scrolls or clips sideways, it is reached by scrolling it.
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(a).overflowX)) return false;
    return true; });
  return { scroll: document.documentElement.scrollWidth > W + 1, beyond: out.slice(0, 3).map((e) => `${e.tagName}.${e.className}#${e.id}`) };
});

for (const [width, height] of [[1440, 950], [390, 860]]) {
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height }, colorScheme: scheme });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(pathToFileURL(join(ROOT, 'dist/loop-tuner.html')).href);
    await page.waitForFunction(() => window.loopTuner);
    for (const sys of SYSTEMS) {
      const tag = `${width} ${scheme} ${sys.slug}`;
      await page.evaluate((n) => window.loopTuner.loadSystem(n), sys.name);
      await page.evaluate(() => window.loopTuner.speed(-1));
      const rep = await page.evaluate(() => window.loopTuner.identify());
      check(rep.ok, `${tag}: identified (${rep.structure}, ${rep.check?.fit?.toFixed(1)} %)`);
      await page.click('[data-tab="identify"]');
      await page.waitForSelector('#id-use');
      await page.click('#id-use');
      check(await page.getAttribute('#id-use', 'aria-pressed') === 'true', `${tag}: Use for Auto-tune and Analysis is lit`);
      await page.screenshot({ path: join(OUT, `${sys.slug}-identify-${width}-${scheme}.png`), fullPage: true });
      await page.click('[data-tab="tune"]');
      check(await page.getAttribute('#tu-src [data-plantsrc="identified"]', 'aria-checked') === 'true', `${tag}: Auto-tune's Plant is the identified model`);
      check(/\(model\)/.test(await page.innerText('#tu-target')), `${tag}: the result is named (model)`);
      await page.click('#tu-start');
      await page.waitForFunction(() => document.querySelector('#tu-start')?.textContent === 'Start', null, { timeout: 120000 });
      const status = await page.innerText('#tu-status');
      check(/runs on the model/.test(status) && /on the diagram/.test(status), `${tag}: ${status.slice(0, 160)}`);
      const variant = await page.evaluate(() => { const d = window.loopTuner.getProject().system.plant.diagram; const c = d.blocks.find((b) => b.type === 'controller'); return c.variants[c.variant].name; });
      check(/\(model\)/.test(variant), `${tag}: running ${variant}`);
      await page.screenshot({ path: join(OUT, `${sys.slug}-tune-${width}-${scheme}.png`), fullPage: true });
      await page.click('[data-tab="analysis"]');
      await page.waitForTimeout(300);
      check(await page.getAttribute('#an-src [data-plantsrc="identified"]', 'aria-checked') === 'true', `${tag}: Analysis's Plant is the identified model`);
      const kw = await page.innerText('#an-kw');
      check(/Gain margin/.test(kw) && /\(.+…/.test(kw), `${tag}: key numbers with ranges (${kw.split('\n').slice(0, 2).join(' | ')})`);
      check(/identified over/.test(await page.innerText('#an-notes')), `${tag}: the model's place in the notes`);
      check(await page.isHidden('#an-ops'), `${tag}: no operating point keys on the model`);
      await page.screenshot({ path: join(OUT, `${sys.slug}-analysis-${width}-${scheme}.png`), fullPage: true });
      const w = await wide(page);
      check(!w.scroll && !w.beyond.length, `${tag}: nothing beyond the viewport ${w.beyond.join(', ')}`);
      // Back to the diagram: the operating point keys return.
      await page.click('#an-src [data-plantsrc="diagram"]');
      await page.waitForTimeout(200);
      check(!(await page.isHidden('#an-ops')), `${tag}: the diagram again`);
    }
    // The simulated arm with 5 min for the test: the Shake runs, and its
    // measured points show on Analysis's Bode plot.
    if (width === 1440) {
      await page.evaluate((p) => window.loopTuner.setProject(p), armProject());
      await page.evaluate(() => window.loopTuner.speed(-1));
      const rep = await page.evaluate(() => window.loopTuner.identify({ budget: 300 }));
      check(rep.ok, `${width} ${scheme} arm: identified (${rep.structure})`);
      await page.evaluate(() => window.loopTuner.plantSource('ctrl', 'identified'));
      await page.click('[data-tab="analysis"]');
      await page.waitForTimeout(400);
      check(/measured points/.test(await page.innerText('#an-notes')), `${width} ${scheme} arm: the Shake's points on Bode`);
      await page.screenshot({ path: join(OUT, `arm-analysis-${width}-${scheme}.png`), fullPage: true });
    }
    // A plant outside the page, not identified: both tabs say to identify first.
    await page.evaluate(() => window.loopTuner.loadSystem('HIL: an external plant'));
    await page.click('[data-tab="tune"]');
    check(/identify the plant first/.test(await page.innerText('#tu-src')) && await page.isDisabled('#tu-start'), `${width} ${scheme} HIL: Auto-tune says to identify first, Start is off`);
    await page.click('[data-tab="analysis"]');
    await page.waitForTimeout(200);
    check(/identify the plant first/.test(await page.innerText('#an-src')), `${width} ${scheme} HIL: Analysis says to identify first`);
    await page.screenshot({ path: join(OUT, `hil-analysis-${width}-${scheme}.png`), fullPage: true });
    check(!errors.length, `${width} ${scheme}: no console errors ${errors.slice(0, 3).join(' | ')}`);
    await page.close();
  }
}
await browser.close();
console.log(failed ? `${failed} failed` : `all passed; screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
