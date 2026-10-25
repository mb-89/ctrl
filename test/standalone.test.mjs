// The page is one standalone HTML file: no scripts, styles, fonts or data
// loaded from anywhere at run time (the person: "we want a standalone HTML …
// we want this working in HTML, everything"). Its two typefaces ride in it as
// data. Tools used to build or check it (Node, the external HIL plant in
// Python) stay outside the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml, vendorBlock } from '../tools/build.mjs';

test('the built page is standalone: nothing is loaded from elsewhere at run time', () => {
  for (const [name, html] of Object.entries({ standalone: buildHtml(), hosted: buildHtml({ fragment: true }) })) {
    assert.equal(/<script[^>]*\ssrc=/i.exec(html), null, `${name}: an external script`);
    // Only markup can link a resource: code holds strings that look like tags
    // (the renderer's, a robot's URDF); scripts are checked below.
    const page = html.replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, '$1</script>');
    assert.deepEqual([...page.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]), [], `${name}: a link to a stylesheet or resource`);
    assert.equal(/@import\b/i.exec(html), null, `${name}: a style sheet imported`);
    const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
    assert.deepEqual([...styles.matchAll(/url\(\s*['"]?(?!data:|#)([^)'"]*)/gi)].map((m) => m[1]), [], `${name}: a style loads a file`);
    // The MCP server's files ride in the page as one string (__MCP_FILES, the
    // Export menu's download): data handed to the person's computer, never
    // run here. mcp.mjs imports its modules there; the page's code must not.
    const carried = /^const __MCP_FILES = (\{.*\});$/m.exec(html);
    assert.ok(carried && typeof JSON.parse(carried[1])['mcp.mjs'] === 'string', `${name}: the MCP server's files are carried as data`);
    const script = html.slice(html.indexOf('<script id="lt-script">')).replace(carried[0], '');
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

test('the typefaces are in the page, with their licence', () => {
  const html = buildHtml();
  const faces = [...html.matchAll(/@font-face\{font-family:"([^"]+)";font-style:normal;font-weight:(\d+);[^}]*src:url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\)/g)];
  assert.deepEqual(faces.map((m) => `${m[1]} ${m[2]}`).sort(), ['IBM Plex Mono 400', 'IBM Plex Mono 600', 'IBM Plex Sans Condensed 400', 'IBM Plex Sans Condensed 600']);
  for (const m of faces) assert.equal(Buffer.from(m[3], 'base64').subarray(0, 4).toString('latin1'), 'wOF2');
  assert.match(html, /<style id="lt-fonts" data-license="[^"]*SIL Open Font License, Version 1\.1"/);
  assert.match(html, /SIL Open Font License 1\.1, carried in this page/, 'Help names the licence');
});
