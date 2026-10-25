// Checks the limited-environment warning (ui/limited.js) in a real browser:
// the built page served normally, in sandboxed frames, without JavaScript, and
// in the hosted build with a host. Writes a screenshot of each case, light and
// dark, at phone and desktop width.
//
//   node build.mjs && node tools/limited-check.mjs [screenshot folder]
//
// Needs Playwright with Chromium (PLAYWRIGHT names the module if it is not
// resolvable from here). Exits non-zero if a case is wrong.

import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
const OUT = process.argv[2] || join(tmpdir(), 'limited-shots');
mkdirSync(OUT, { recursive: true });

const page = readFileSync(join(ROOT, 'dist/loop-tuner.html'));
// The hosted build is a fragment; the viewer supplies the document and the
// host's save adapter (stubbed: no window.claude here).
const hosted = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${readFileSync(join(ROOT, 'dist/artifact.html'), 'utf8')}</body></html>`;
const frame = (sandbox, src = '/loop-tuner.html') => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%;display:block}</style></head><body><iframe src="${src}" sandbox="${sandbox}"></iframe></body></html>`;
const ROUTES = {
  '/loop-tuner.html': page,
  '/artifact.html': hosted,
  '/sandbox-scripts.html': frame('allow-scripts'),
  '/sandbox-same-origin.html': frame('allow-scripts allow-same-origin allow-downloads'),
  '/sandbox-policy.html': frame('allow-scripts', '/loop-tuner-policy.html'),
  '/loop-tuner-policy.html': page,
};
// As the research describes SharePoint's HTML viewer: no connections, no
// workers, no frames (design/research/limited-environment.md).
const HEADERS = { '/loop-tuner-policy.html': { 'content-security-policy': "connect-src 'none'; worker-src 'none'; frame-src 'none'" } };
const server = createServer((req, res) => {
  const body = ROUTES[req.url];
  res.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8', ...HEADERS[req.url] });
  res.end(body ?? 'not found');
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

// expect: shown or not; reasons the warning must list (in the page's words).
const CASES = [
  { key: 'a-normal', url: '/loop-tuner.html', shown: false },
  { key: 'b-sandbox-scripts', url: '/sandbox-scripts.html', framed: true, shown: true, why: ['sandboxed', 'no storage'] },
  { key: 'c-no-javascript', url: '/loop-tuner.html', js: false, shown: true, why: [] },
  { key: 'd-sandbox-same-origin-downloads', url: '/sandbox-same-origin.html', framed: true, shown: false },
  { key: 'f-sandbox-with-policy', url: '/sandbox-policy.html', framed: true, shown: true, why: ['sandboxed', 'no storage', 'no background workers'] },
  { key: 'e-hosted', url: '/artifact.html', shown: false },
];

const browser = await chromium.launch();
let failed = 0;
for (const c of CASES) {
  for (const scheme of ['light', 'dark']) {
    for (const width of [390, 1440]) {
      const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, colorScheme: scheme, javaScriptEnabled: c.js !== false });
      const tab = await ctx.newPage();
      const errors = [];
      tab.on('pageerror', (e) => errors.push(e.message));
      await tab.goto(base + c.url);
      const doc = c.framed ? tab.frameLocator('iframe') : tab;
      const banner = doc.locator('#lt-limited');
      await banner.waitFor({ state: 'attached' });
      if (c.js !== false) await doc.locator('.screen canvas, .screen svg').first().waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
      if (c.why?.length) await doc.getByText(c.why.at(-1)).waitFor({ timeout: 3000 }).catch(() => {});
      const shown = await banner.isVisible();
      const text = shown ? await banner.innerText() : '';
      const why = c.why?.filter((w) => !text.includes(w)) ?? [];
      // The warning must not cover a control: the display starts below it.
      const covers = shown && c.js !== false && await (async () => {
        const b = await banner.boundingBox(), d = await doc.locator('#display').boundingBox();
        return !b || !d || d.y < b.y + b.height;
      })();
      const ok = shown === c.shown && !why.length && !covers && !errors.length;
      if (!ok) failed++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.key} ${scheme} ${width}px: warning ${shown ? 'shown' : 'hidden'}${why.length ? `, missing ${why.join(', ')}` : ''}${covers ? ', covers the display' : ''}${errors.length ? `, errors: ${errors.join(' | ')}` : ''}`);
      if (shown && scheme === 'light' && width === 1440) console.log(`     ${text.replace(/\s+/g, ' ')}`);
      await tab.screenshot({ path: join(OUT, `${c.key}-${scheme}-${width}.png`) });
      await ctx.close();
    }
  }
}
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
