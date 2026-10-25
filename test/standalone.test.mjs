// The page is one standalone HTML file: no scripts, styles or data loaded from
// anywhere at run time (the person: "we want a standalone HTML … we want this
// working in HTML, everything"). Tools used to build or check it (Node, the
// external HIL plant in Python) stay outside the page. The one tolerated
// exception is the web font stylesheet, which falls back to system fonts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml, vendorBlock } from '../build.mjs';

test('the built page is standalone: nothing is loaded from elsewhere at run time', () => {
  for (const [name, html] of Object.entries({ standalone: buildHtml(), hosted: buildHtml({ fragment: true }) })) {
    assert.equal(/<script[^>]*\ssrc=/i.exec(html), null, `${name}: an external script`);
    const links = [...html.matchAll(/<link[^>]*href="([^"]+)"/gi)].map((m) => m[1]);
    assert.deepEqual(links.filter((h) => !h.startsWith('https://fonts.googleapis.com/')), [], `${name}: an external stylesheet or resource`);
    const script = html.slice(html.indexOf('<script id="lt-script">'));
    for (const re of [/\bfetch\s*\(/, /\bimport\s*\(/, /\bimportScripts\s*\(/, /\bXMLHttpRequest\b/, /\bnavigator\.sendBeacon\b/]) {
      assert.equal(re.exec(script), null, `${name}: the page's code loads something (${re})`);
    }
    // The only other code is the vendored renderer, exactly as the build makes
    // it from its checksummed files (test/vendor.test.mjs).
    const own = html.indexOf('<script id="lt-script">');
    const before = html.slice(0, own), vendor = vendorBlock(), at = before.indexOf(vendor);
    assert.ok(at > 0, `${name}: the vendor block is not the build's`);
    const tags = [...(before.slice(0, at) + before.slice(at + vendor.length)).matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
    // The limited-environment check runs inline before the first paint (ui/limited.js); it loads nothing either.
    const check = /<script id="lt-limited-check">([\s\S]*?)<\/script>/.exec(before)?.[1] ?? '';
    for (const re of [/\bfetch\s*\(/, /\bimport\s*\(/, /\bimportScripts\s*\(/, /\bXMLHttpRequest\b/, /\bnavigator\.sendBeacon\b/]) {
      assert.equal(re.exec(check), null, `${name}: the limited-environment check loads something (${re})`);
    }
    const head = name === 'hosted' ? ['<script id="lt-host">', '<script id="lt-limited-check">'] : ['<script id="lt-limited-check">'];
    assert.deepEqual(tags, [...head, '<script type="application/json" id="loop-tuner-project">'], `${name}: the scripts before the page's own`);
    const end = html.indexOf('</script>', own);   // its own </script are escaped
    assert.equal(/<script\b/i.exec(html.slice(end)), null, `${name}: a script after the page's own`);
  }
});
