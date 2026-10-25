// The MCP server's download (Export › Download the MCP server): the files
// the page carries and zips, and the server running from them, away from the
// source, on the core cut from the page: it answers as the source's server
// does. The menu itself, in Chromium where Playwright is installed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { startServer, stopAll } from '../tools/mcp-client.mjs';
import { buildHtml, bundleScript } from '../build.mjs';
import { simulatorCore } from '../src/core/hilsim.js';

const require = createRequire(import.meta.url);
let chromium = null;
try { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright')); } catch { /* not installed */ }
after(stopAll);
const FILES = ['README.md', 'loop-tuner-core.js', 'loop-tuner.html', 'mcp.mjs', 'runme.cmd', 'runme.ps1', 'runme.sh'];
const root = new URL('../', import.meta.url);

// The download's folder as the page makes it, from the source (the same
// files the bundle carries, the core cut from the page's script).
function folder(files) {
  const dir = mkdtempSync(join(tmpdir(), 'lt-mcp-zip-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text, { mode: name.endsWith('.sh') ? 0o755 : 0o644 });
  return dir;
}
const fromSource = () => ({
  'mcp.mjs': readFileSync(new URL('mcp.mjs', root), 'utf8'),
  ...Object.fromEntries(['README.md', 'runme.sh', 'runme.cmd', 'runme.ps1'].map((f) => [f, readFileSync(new URL(`mcp/${f}`, root), 'utf8')])),
  'loop-tuner-core.js': simulatorCore(bundleScript()),
  'loop-tuner.html': buildHtml(),
});

test('mcp download: away from the source, the server runs on the page\'s own core and answers as the source\'s does', async () => {
  const dir = folder(fromSource());
  const away = startServer({ script: join(dir, 'mcp.mjs') }), here = startServer();
  try {
    const tools = (s) => s.request('tools/list').then((r) => r.result.tools.map((t) => t.name));
    assert.deepEqual(await tools(away), await tools(here));
    for (const s of [away, here]) await s.call('load_system', { system: 'Oven, badly tuned' });
    const steady = (r) => ({ ...r, info: { ...r.info, ms: null } });   // its wall-clock time set aside
    assert.deepEqual(steady(await away.call('run')), steady(await here.call('run')));
    assert.deepEqual(await away.call('analyze', { at: 'initial' }), await here.call('analyze', { at: 'initial' }));
    assert.deepEqual(await away.call('autotune', { method: 'relay' }), await here.call('autotune', { method: 'relay' }));
    // Its page is the page it carries, with the project put inside.
    const out = await away.call('export_html', { path: join(dir, 'oven.html') });
    const html = readFileSync(out.path, 'utf8');
    assert.match(html, /<title>Oven, badly tuned · Loop Tuner<\/title>/);
    const back = await away.call('load_system', { path: out.path, as: 'back' });
    assert.equal(back.title, 'Oven, badly tuned');
    // It serves that page, with the line that makes it connect back.
    const { url } = await away.call('page_status');
    const served = await (await fetch(url)).text();
    assert.match(served, /<meta name="loop-tuner-bridge" content="ws:\/\/127\.0\.0\.1:\d+\/bridge">/);
    assert.ok(served.includes('id="lt-script"'));
  } finally { await Promise.all([away.close(), here.close()]); }
  assert.ok(statSync(join(dir, 'runme.sh')).mode & 0o100, 'runme.sh is executable');
  const readme = readFileSync(join(dir, 'README.md'), 'utf8');
  assert.match(readme, /mcp add loop-tuner -- node/);
  assert.match(readme, /"mcpServers"/);
  for (const f of ['runme.sh', 'runme.ps1']) assert.doesNotMatch(readFileSync(join(dir, f), 'utf8'), /\bpip\b/, `${f} never uses pip`);
  assert.match(readFileSync(join(dir, 'runme.ps1'), 'utf8'), /winget install --id=OpenJS\.NodeJS\.LTS/);
});

test('mcp download: the Export menu offers it, and the page zips the files it carries', { skip: !chromium && 'Playwright is not installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lt-export-'));
  const file = join(dir, 'page.html');
  writeFileSync(file, buildHtml());
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 740 }, acceptDownloads: true });
    await page.goto(pathToFileURL(file).href);
    await page.waitForFunction(() => !!window.loopTuner);
    // One menu for the file keys, inside the window at phone width.
    await page.click('#export-menu');
    const items = await page.$$eval('#export-pop [role="menuitem"]:not([hidden])', (els) => els.map((e) => e.id));
    assert.deepEqual(items, ['save', 'copy', 'export', 'copy-html', 'dl-plant', 'dl-mcp']);
    const box = await page.$eval('#export-pop', (e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right }; });
    assert.ok(box.left >= 0 && box.right <= 360, `the menu stays inside the window (${box.left} … ${box.right})`);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dl-mcp')]);
    assert.equal(dl.suggestedFilename(), 'loop-tuner-mcp.zip');
    const zip = readFileSync(await dl.path()).toString('latin1');
    for (const f of FILES) assert.ok(zip.includes(`loop-tuner-mcp/${f}`), `the zip holds ${f}`);
    // The files are the source's; the page and its core are this page's.
    const files = await page.evaluate(() => window.loopTuner.mcpFiles());
    assert.deepEqual(Object.keys(files).sort(), FILES);
    const src = fromSource();
    for (const f of ['mcp.mjs', 'README.md', 'runme.sh', 'runme.cmd', 'runme.ps1']) assert.equal(files[f], src[f], f);
    assert.equal(files['loop-tuner-core.js'], simulatorCore(await page.evaluate(() => document.getElementById('lt-script').textContent)));
    assert.match(files['loop-tuner.html'], /id="loop-tuner-project">\n\{/);
  } finally { await browser.close(); }
});

// Input 36: both downloads alike, one click, options in --help; the MCP
// server explains itself.
const carried = (html, name) => JSON.parse(new RegExp(`^const ${name} = (\\{.*\\});$`, 'm').exec(html)[1]);
const ONE_CLICK = ['README.md', 'runme.cmd', 'runme.ps1', 'runme.sh'];

test('both downloads alike: runme.sh, runme.ps1, runme.cmd and README.md beside the program', () => {
  const html = buildHtml();
  const hil = Object.keys(carried(html, '__HIL_FILES')).sort(), mcp = Object.keys(carried(html, '__MCP_FILES')).sort();
  assert.deepEqual(hil, [...ONE_CLICK, 'hil_plant.py'].sort());
  assert.deepEqual(mcp, [...ONE_CLICK, 'mcp.mjs'].sort());
  // (each zip adds the page's core, loop-tuner-core.js; the server's also the page)
  for (const files of [carried(html, '__HIL_FILES'), carried(html, '__MCP_FILES')]) {
    assert.match(files['README.md'], /^# /, 'README.md is Markdown');
    assert.match(files['README.md'], /one click/i);
    assert.match(files['runme.cmd'], /runme\.ps1/, 'a double-click on Windows runs runme.ps1');
    for (const f of ['runme.sh', 'runme.ps1']) assert.doesNotMatch(files[f], /\bpip\b/, `${f} never uses pip`);
  }
});

test('runme --help lists the options and installs nothing', () => {
  const run = (dir, env = {}) => spawnSync('/bin/sh', [join(dir, 'runme.sh'), '--help'], { encoding: 'utf8', env: { ...process.env, ...env } });
  const zip = folder(fromSource());   // runme.sh beside mcp.mjs, as unzipped
  const mcp = run(zip);
  assert.equal(mcp.status, 0);
  assert.match(mcp.stdout, /--port N/);
  assert.doesNotMatch(mcp.stdout + mcp.stderr, /installing/i);
  // Without Node, it says where the options are, and still installs nothing.
  const noNode = ['/usr/bin', '/bin'].filter((d) => !existsSync(join(d, 'node'))).join(':');
  const bare = run(zip, { PATH: noNode });
  assert.equal(bare.status, 0, bare.stderr);
  assert.match(bare.stdout, /README\.md has them/);
  const hil = run(fileURLToPath(new URL('hil/', root)));
  assert.equal(hil.status, 0);
  assert.match(hil.stdout, /--model NAME/);
  assert.doesNotMatch(hil.stdout + hil.stderr, /Installing uv/);
});

test('the MCP server explains itself when it starts: what MCP is, the page\'s address, the connect lines with its path', async () => {
  const me = fileURLToPath(new URL('mcp.mjs', root));
  const child = spawn(process.execPath, [me, '--port', '0'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.setEncoding('utf8');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no start text: ${err}`)), 20000);
    child.stderr.on('data', (d) => { err += d; if (/Options \(none is needed\)/.test(err)) { clearTimeout(timer); resolve(); } });
  });
  child.stdin.end();
  assert.match(err, /An MCP server gives an AI agent tools/);
  assert.match(err, /The page: http:\/\/127\.0\.0\.1:\d+\//);
  assert.ok(err.includes(`claude mcp add loop-tuner -- node "${me}"`), 'Claude Code, with the path');
  assert.ok(err.includes(JSON.stringify({ mcpServers: { 'loop-tuner': { command: 'node', args: [me] } } })), 'the JSON config, with the path');
  assert.match(err, /VS Code/);
  assert.match(err, /help me tune this system/);
  const help = spawnSync(process.execPath, [me, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.ok(help.stdout.includes(`node "${me}"`));
});
