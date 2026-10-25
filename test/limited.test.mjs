// A limited environment (ui/limited.js): the decision from the probes, and the
// warning's place in the built page. The browser cases (a sandboxed frame, no
// JavaScript, the hosted viewer) are checked by tools/limited-check.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitedVerdict, limitedProbe } from '../src/ui/limited.js';
import { buildHtml } from '../build.mjs';

const full = { host: false, localStorage: true, sessionStorage: true, opaqueOrigin: false, file: false, framed: false, downloads: null, workers: true };
const verdict = (p) => limitedVerdict({ ...full, ...p });

test('a full environment is not limited', () => {
  assert.deepEqual(verdict({}), { limited: false, reasons: [] });
  assert.deepEqual(verdict({ framed: true }), { limited: false, reasons: [] }, 'framed by its own site, with everything');
  assert.deepEqual(verdict({ framed: true, downloads: true }), { limited: false, reasons: [] }, 'a sandbox that allows downloads, same origin');
});

test('a file opened directly has an opaque origin, and is not limited', () => {
  assert.deepEqual(verdict({ file: true, opaqueOrigin: true }), { limited: false, reasons: [] });
});

test('a sandboxed preview is limited, with its reasons', () => {
  assert.deepEqual(verdict({ framed: true, opaqueOrigin: true, localStorage: false, sessionStorage: false }), { limited: true, reasons: ['sandbox', 'storage'] });
  assert.deepEqual(verdict({ framed: true, opaqueOrigin: true, localStorage: false, workers: false }), { limited: true, reasons: ['sandbox', 'storage', 'workers'] });
  assert.deepEqual(verdict({ framed: true, opaqueOrigin: true, file: true }), { limited: true, reasons: ['sandbox'] }, 'a file in a sandboxed frame');
  assert.deepEqual(verdict({ opaqueOrigin: true }), { limited: true, reasons: ['sandbox'] }, 'served from a site with a sandbox policy');
  assert.deepEqual(verdict({ framed: true, downloads: false }), { limited: true, reasons: ['downloads'] });
  assert.deepEqual(verdict({ workers: false }), { limited: true, reasons: ['workers'] }, 'workers forbidden (a policy of worker-src none)');
});

test('missing storage alone counts only in a frame (a private window is not a preview)', () => {
  assert.equal(verdict({ localStorage: false, sessionStorage: false }).limited, false);
  assert.deepEqual(verdict({ localStorage: false, framed: true }), { limited: true, reasons: ['storage'] });
});

test('a known host is never limited', () => {
  assert.deepEqual(verdict({ host: true, framed: true, opaqueOrigin: true, localStorage: false, workers: false, downloads: false }), { limited: false, reasons: [] });
});

test('the probes never throw: every missing feature reads as missing', () => {
  const thrower = new Proxy({}, { get() { throw new Error('denied'); } });
  const p = limitedProbe(thrower);
  assert.deepEqual(p, { host: false, localStorage: false, sessionStorage: false, opaqueOrigin: false, file: false, framed: true, downloads: null, workers: false });
});

test('the warning is in the page from the start, with the check before the first paint', () => {
  for (const html of [buildHtml(), buildHtml({ fragment: true })]) {
    const check = html.indexOf('<script id="lt-limited-check">'), banner = html.indexOf('id="lt-limited"'), shell = html.indexOf('id="lt-shell"');
    assert.ok(check > 0 && check < shell && shell < banner, 'the check runs before the shell, which holds the warning');
    assert.match(html, /download this file and open it in your browser/i);
    assert.equal(/\bexport\s+function/.exec(html.slice(check, html.indexOf('</script>', check))), null, 'the inline check is plain script');
  }
  const hosted = buildHtml({ fragment: true });
  assert.ok(hosted.indexOf('id="lt-host"') < hosted.indexOf('id="lt-limited-check"'), 'the host is known before the check');
});
