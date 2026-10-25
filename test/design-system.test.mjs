// One design system (the person: "put everything through a single master
// style sheet … the styles are supposed to be semantic. And then we choose a
// semantic style and we change it in one place"). Every colour is a token in
// the one block at the top of src/ui/style.css; nothing else in the style
// sheet, and no UI module, writes a colour of its own (a canvas reads them
// through src/ui/palette.js). See design/output/design-system.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { buildHtml } from '../build.mjs';

const ui = new URL('../src/ui/', import.meta.url);
const css = readFileSync(new URL('style.css', ui), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const COLOUR = /#[0-9a-f]{3,8}\b|(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|(?<![\w-])(?:white|black|red|green|blue|yellow|gray|grey|orange|purple|magenta|cyan|violet)(?![\w-])/gi;

test('every colour in the style sheet is a token in its one token block', () => {
  const start = css.indexOf(':root {'), end = css.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, 'the token block (:root { … }) is at the top');
  const rest = css.slice(0, start) + css.slice(end);
  const found = [...rest.matchAll(COLOUR)].map((m) => rest.slice(Math.max(0, m.index - 40), m.index + 20).replace(/\s+/g, ' '));
  assert.deepEqual(found, [], 'colours written outside the tokens');
});

test('no UI module writes a colour; canvases read the tokens through palette.js', () => {
  for (const f of readdirSync(ui).filter((x) => x.endsWith('.js') && x !== 'palette.js')) {
    const src = readFileSync(new URL(f, ui), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    const found = [...src.matchAll(/['"`]#[0-9a-f]{3,8}['"`]|\brgba?\(\s*\d/gi)].map((m) => src.slice(m.index - 30, m.index + 20));
    assert.deepEqual(found, [], `${f} writes colours`);
  }
});

test('the old one-off looks are gone: one button, one selected state', () => {
  const html = buildHtml();
  for (const old of [/class="key[ "]/, /'key /, /\bsigkey\b/, /\blit-(view|green|red|amber)\b/, /\brkey\b/, /class="rep[ "]/, /\bglabel\b/, /class="sw[ "]/, /\bspeed-(btn|item)\b/, /\bctlibitem\b/, /\blater-box\b/]) {
    assert.equal(old.exec(html)?.[0], undefined, `the page still uses ${old}`);
  }
  // The one selected look: lit, from aria-pressed / aria-selected / aria-checked.
  assert.match(css, /:is\(\.btn, \.item\):is\(\[aria-pressed="true"\], \[aria-selected="true"\], \[aria-checked="true"\], \[data-lamp\]\)/);
});
