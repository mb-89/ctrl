// The built page must not say where it was made: no person's name, account,
// repository, session, e-mail address or local path, and no quotes from the
// design conversation (the person, 2026-10-24: "I don't want this to have any
// provenance information"). The repository keeps its history; the page is
// built without the source's comments, and only the hosted build carries the
// host's save adapter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHtml, vendorBlock } from '../tools/build.mjs';

const FORBIDDEN = [
  /github|gitlab|bitbucket/i, /mb-89/i, /markus/i, /gmail/i, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i,
  /claude\.ai|anthropic/i, /session_[0-9A-Za-z]{6,}/, /co-authored-by/i, /claude-session/i,
  /\/home\/[a-z]|\/Users\/[A-Za-z]|[A-Z]:\\\\Users/, /\/tmp\/claude|scratchpad/i,
  /the person/i, /\b20\d\d-\d\d-\d\d\b/,
];
const snippet = (s, m) => s.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\s+/g, ' ');

// The vendored renderer (src/vendor/three) keeps its licence and its text as
// they are; it is checked against its checksums (test/vendor.test.mjs). Only
// that block, exactly as the build makes it, is set aside: all the rest of
// the page, our own text, gets the full check.
const VENDOR = vendorBlock();
function ownText(name, html) {
  const at = html.indexOf(VENDOR);
  assert.ok(at > 0, `${name}: the vendor block is the build's`);
  const rest = html.slice(0, at) + html.slice(at + VENDOR.length);
  assert.equal(rest.indexOf(VENDOR), -1, `${name}: a second vendor block`);
  return rest;
}

test('the built page carries no provenance (names, accounts, repositories, sessions, paths, conversation quotes)', () => {
  const pages = Object.fromEntries(Object.entries({ standalone: buildHtml(), hosted: buildHtml({ fragment: true }), exported: buildHtml({ project: { title: 'x' } }) }).map(([k, v]) => [k, ownText(k, v)]));
  for (const [name, html] of Object.entries(pages)) {
    for (const re of FORBIDDEN) {
      // The MCP server the page carries (Export › Download the MCP server)
      // names the protocol revisions it speaks, which MCP names by dates:
      // identifiers of the protocol, not when or where this was made. Only
      // those two statements are set aside, exactly as mcp.mjs writes them.
      const page = re.source.includes('20\\d\\d') ? html.replace(/const (MODERN|LEGACY) = \[(?:'20\d\d-\d\d-\d\d'(?:, )?)+\];/g, '') : html;
      const m = re.exec(page);
      assert.equal(m, null, `${name}: ${re} matches "…${m && snippet(page, m)}…"`);
    }
  }
  // The standalone page does not even name the host it was first shown in.
  // One exception (input 36): the MCP server the page carries explains how to
  // connect an agent, naming MCP clients as instructions (Claude Code's
  // command, Claude Desktop's config file). Those names are set aside in its
  // own files only (__MCP_FILES: mcp.mjs's help, README.md), and only them:
  // claude.ai, the host's adapter and anything else still fail, there too.
  const CLIENTS = /Claude (?:Code|Desktop)|claude mcp add|claude_desktop_config\.json/g;
  const own = pages.standalone.replace(/^const __MCP_FILES = .*$/m, (line) => line.replace(CLIENTS, ''));
  assert.ok(own !== pages.standalone, 'the MCP server\'s files name the clients it explains');
  assert.equal(/claude/i.exec(own), null, 'the standalone page mentions the host');
  assert.equal(/claude/i.exec(pages.standalone.replace(/^const __MCP_FILES = .*$/m, '')), null, 'client names only in the MCP server\'s own files');
  assert.ok(!/\/\/ ---- ui\//.test('') && pages.standalone.includes('\n// ---- ui/'), 'module markers stay (the live worker finds the core by them)');
});

test('dist holds what the build makes and nothing else', async () => {
  // An archive of the source once sat there, with its .git folder: logs with
  // a name, an e-mail address and a session link, which no page check saw.
  const { readdirSync } = await import('node:fs');
  const dist = new URL('../dist/', import.meta.url);
  assert.deepEqual(readdirSync(dist).sort(), ['artifact.html', 'hil-plant', 'loop-tuner.html']);
  const plant = readdirSync(new URL('hil-plant/', dist));
  assert.deepEqual(plant.filter((f) => !/^(README\.md|hil_plant\.py|loop-tuner-core\.js|runme\.(sh|cmd|ps1))$/.test(f)), [], 'the plant\'s files only');
});
