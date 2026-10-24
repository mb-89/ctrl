// The page is one standalone HTML file: no scripts, styles or data loaded from
// anywhere at run time (the person: "we want a standalone HTML … we want this
// working in HTML, everything"). Tools used to build or check it (Node, the
// external HIL plant in Python) stay outside the page. The one tolerated
// exception is the web font stylesheet, which falls back to system fonts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml } from '../build.mjs';

test('the built page is standalone: nothing is loaded from elsewhere at run time', () => {
  for (const [name, html] of Object.entries({ standalone: buildHtml(), hosted: buildHtml({ fragment: true }) })) {
    assert.equal(/<script[^>]*\ssrc=/i.exec(html), null, `${name}: an external script`);
    const links = [...html.matchAll(/<link[^>]*href="([^"]+)"/gi)].map((m) => m[1]);
    assert.deepEqual(links.filter((h) => !h.startsWith('https://fonts.googleapis.com/')), [], `${name}: an external stylesheet or resource`);
    const script = html.slice(html.indexOf('<script id="lt-script">'));
    for (const re of [/\bfetch\s*\(/, /\bimport\s*\(/, /\bimportScripts\s*\(/, /\bXMLHttpRequest\b/, /\bnavigator\.sendBeacon\b/]) {
      assert.equal(re.exec(script), null, `${name}: the page's code loads something (${re})`);
    }
  }
});
