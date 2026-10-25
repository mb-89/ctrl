// three.js is vendored unmodified (src/vendor/three/README.md): its files
// match the checksums the README records, and the page carries exactly the
// script the build makes from them, licence included.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { buildHtml, vendorBlock, vendorScript, readVendorThree, THREE_FILES } from '../build.mjs';
import * as THREE from '../src/vendor/three/three.module.min.js';

const DIR = new URL('../src/vendor/three/', import.meta.url);
const readme = readFileSync(new URL('README.md', DIR), 'utf8');
const recorded = Object.fromEntries([...readme.matchAll(/^\| (\S+) \| `([0-9a-f]{64})` \|$/gm)].map((m) => [m[1], m[2]]));

test('the vendored files match the checksums in their README, and the build checks the same ones', () => {
  assert.deepEqual(Object.keys(recorded).sort(), ['LICENSE', 'three.core.min.js', 'three.module.min.js']);
  for (const [f, sha] of Object.entries(recorded)) {
    assert.equal(createHash('sha256').update(readFileSync(new URL(f, DIR))).digest('hex'), sha, f);
  }
  assert.deepEqual(THREE_FILES, recorded);
  assert.match(readme, /^Reader: /m);
  assert.match(readme, /0\.185\.1/);
  const files = readVendorThree();
  assert.equal(files.LICENSE, readFileSync(new URL('LICENSE', DIR), 'utf8'));
  // A file changed by one byte stops the build.
  const dir = mkdtempSync(join(tmpdir(), 'lt-vendor-'));
  try {
    for (const f of Object.keys(files)) writeFileSync(join(dir, f), files[f]);
    readVendorThree(dir);
    writeFileSync(join(dir, 'three.core.min.js'), `${files['three.core.min.js']} `);
    assert.throws(() => readVendorThree(dir), /sha256/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the page carries the vendor block once, as the build makes it, before its own script', () => {
  const files = readVendorThree();
  const block = vendorBlock(files);
  for (const html of [buildHtml(), buildHtml({ fragment: true }), buildHtml({ project: { title: 'x' } })]) {
    // (The page's own script names the block too: it exports the page.)
    const own = html.indexOf('<script id="lt-script">'), at = html.indexOf('<script id="lt-vendor-three">');
    assert.ok(at > 0 && html.lastIndexOf('<script id="lt-vendor-three">', own) === at, 'one vendor block');
    assert.equal(html.slice(at, at + block.length), block);
    assert.equal(html.slice(at + block.length, own), '\n');
  }
  // The transform is mechanical: the licence on top, then the files' own
  // text with only their import and export statements replaced.
  const js = vendorScript(files);
  assert.ok(js.startsWith(`/*\n${files.LICENSE.trim()}\n*/\n`));
  const core = files['three.core.min.js'], mod = files['three.module.min.js'];
  assert.ok(js.includes(core.slice(0, core.lastIndexOf('export{'))), 'the core up to its export, verbatim');
  const mi = mod.indexOf('import{'), mr = mod.indexOf('export{'), me = mod.lastIndexOf('export{');
  assert.ok(js.includes(mod.slice(0, mi)), 'the module header, verbatim');
  const body = mod.slice(mod.indexOf(';', mr) + 1, me);
  assert.ok(body.length > 300000 && js.includes(body), 'the module body, verbatim');
  assert.equal(js.replace(/<\/script/gi, '<\\/script'), block.slice('<script id="lt-vendor-three">'.length, -'</script>'.length));
});

test('the vendor script defines a frozen globalThis.THREE with every export of the module', () => {
  const ctx = {};
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(vendorScript(), ctx);
  const G = ctx.THREE;
  assert.ok(Object.isFrozen(G));
  for (const k of Object.keys(THREE)) assert.equal(typeof G[k], typeof THREE[k], k);
  assert.equal(G.REVISION, '185');
  const v = new G.Vector3(1, 2, 3).applyMatrix4(new G.Matrix4().makeTranslation(1, 0, 0));
  assert.deepEqual([v.x, v.y, v.z], [2, 2, 3]);
});
