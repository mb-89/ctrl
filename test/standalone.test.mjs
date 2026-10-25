// The page is one standalone HTML file: no scripts, styles, fonts or data
// loaded from anywhere at run time (the person: "we want a standalone HTML …
// we want this working in HTML, everything"). Its two typefaces ride in it as
// data. Tools used to build or check it (Node, the external HIL plant in
// Python) stay outside the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../build.mjs';

test('the built page is standalone: nothing is loaded from elsewhere at run time', () => {
  for (const [name, html] of Object.entries({ standalone: buildHtml(), hosted: buildHtml({ fragment: true }) })) {
    assert.equal(/<script[^>]*\ssrc=/i.exec(html), null, `${name}: an external script`);
    assert.deepEqual([...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]), [], `${name}: a link to a stylesheet or resource`);
    assert.equal(/@import\b/i.exec(html), null, `${name}: a style sheet imported`);
    const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
    assert.deepEqual([...styles.matchAll(/url\(\s*['"]?(?!data:|#)([^)'"]*)/gi)].map((m) => m[1]), [], `${name}: a style loads a file`);
    const script = html.slice(html.indexOf('<script id="lt-script">'));
    for (const re of [/\bfetch\s*\(/, /\bimport\s*\(/, /\bimportScripts\s*\(/, /\bXMLHttpRequest\b/, /\bnavigator\.sendBeacon\b/]) {
      assert.equal(re.exec(script), null, `${name}: the page's code loads something (${re})`);
    }
  }
});

test('the typefaces are in the page, with their licence', () => {
  const html = buildHtml();
  const faces = [...html.matchAll(/@font-face\{font-family:"([^"]+)";font-style:normal;font-weight:(\d+);[^}]*src:url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\)/g)];
  assert.deepEqual(faces.map((m) => `${m[1]} ${m[2]}`).sort(), ['IBM Plex Mono 400', 'IBM Plex Mono 600', 'IBM Plex Sans Condensed 400', 'IBM Plex Sans Condensed 600']);
  for (const m of faces) assert.equal(Buffer.from(m[3], 'base64').subarray(0, 4).toString('latin1'), 'wOF2');
  assert.match(html, /<style id="lt-fonts" data-license="[^"]*SIL Open Font License, Version 1\.1"/);
  assert.match(html, /SIL Open Font License 1\.1, carried in this page/, 'Help names the licence');
});
