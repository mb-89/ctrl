// One design system (the person: "put everything through a single master
// style sheet … the styles are supposed to be semantic. And then we choose a
// semantic style and we change it in one place"). Every colour, type size and
// strength (opacity) is a token in the one block at the top of
// src/ui/style.css; nothing else in the style sheet, no UI module and not the
// page's shell (build.mjs) writes one of its own (a canvas reads them through
// src/ui/palette.js). See design/output/design-system.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { buildHtml, reportStyle } from '../build.mjs';
import { decide, renderHtml } from '../src/core/pugh.js';

const ui = new URL('../src/ui/', import.meta.url);
const css = readFileSync(new URL('style.css', ui), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const COLOUR = /#[0-9a-f]{3,8}\b|(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|(?<![\w-])(?:white|black|red|green|blue|yellow|gray|grey|orange|purple|magenta|cyan|violet)(?![\w-])/gi;
const NAMED = 'white|black|red|green|blue|yellow|gray|grey|orange|purple|magenta|cyan|violet';
// In code, the same colours as the style sheet's pattern, where code can write
// one: a quoted hex or name, a colour function with a literal value or
// color-mix(), or a name given to a colour property. (Prose such as "below the
// floor black" is not a colour.)
const CODE_COLOUR = new RegExp(String.raw`['"\x60]#[0-9a-f]{3,8}['"\x60]|(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[\d.#]|(?<![\w-])color-mix\(|['"\x60](?:${NAMED})['"\x60]|(?:fill|stroke|color|background|fillStyle|strokeStyle|shadowColor)\s*[:=]\s*['"\x60]?\s*(?:${NAMED})\b`, 'gi');
// Code without its comments.
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const modules = readdirSync(ui).filter((x) => x.endsWith('.js') && x !== 'palette.js').map((f) => [f, code(readFileSync(new URL(f, ui), 'utf8'))]);
const shell = ['build.mjs', code(readFileSync(new URL('../build.mjs', import.meta.url), 'utf8'))];
const around = (s, i) => s.slice(Math.max(0, i - 40), i + 30).replace(/\s+/g, ' ');

test('every colour in the style sheet is a token in its one token block', () => {
  const start = css.indexOf(':root {'), end = css.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, 'the token block (:root { … }) is at the top');
  const rest = css.slice(0, start) + css.slice(end);
  const found = [...rest.matchAll(COLOUR)].map((m) => around(rest, m.index));
  assert.deepEqual(found, [], 'colours written outside the tokens');
});

test('no UI module and not the shell writes a colour; canvases read the tokens through palette.js', () => {
  for (const [f, src] of [...modules, shell]) {
    const found = [...src.matchAll(CODE_COLOUR)].map((m) => around(src, m.index));
    assert.deepEqual(found, [], `${f} writes colours`);
  }
});

test('type sizes are the six tokens', () => {
  // In the sheet: a token, or relative to the size around it (em, inherit).
  const sizes = [...css.matchAll(/font-size:\s*([^;}]+)/g)].map((m) => m[1].trim()).filter((v) => !/^(var\(--text-[a-z0-9]+\)|inherit|[\d.]+em)$/.test(v));
  assert.deepEqual(sizes, [], 'font sizes that are not tokens');
  const shorthand = [...css.matchAll(/\bfont:\s*([^;}]+)/g)].map((m) => m[1].trim()).filter((v) => v !== 'inherit' && !/^var\(--text-[a-z0-9]+\)/.test(v));
  assert.deepEqual(shorthand, [], 'font shorthands without a size token');
  // In a module or the shell: no size written into the page's elements.
  for (const [f, src] of [...modules, shell]) {
    const found = [...src.matchAll(/font-size\s*[:=]\s*['"]?\s*[\d.]/g)].map((m) => around(src, m.index));
    assert.deepEqual(found, [], `${f} writes a font size`);
  }
});

test('opacity means disabled only; how strongly a canvas draws is named in palette.js', () => {
  // Show and hide (0, 1) are not a meaning; anything between is --disabled.
  const values = [...css.matchAll(/(?<![\w-])opacity:\s*([^;}]+)/g)].map((m) => m[1].trim()).filter((v) => !/^(0|1|var\(--disabled\))$/.test(v));
  assert.deepEqual(values, [], 'opacities that are not --disabled');
  for (const [f, src] of [...modules, shell]) {
    const found = [...src.matchAll(/opacity\s*[:=]\s*['"]?\s*0?\.\d|globalAlpha\s*=\s*0?\.\d|\balpha:\s*0?\.\d|\bfade\([^\n]*?,\s*0?\.\d+\)/g)].map((m) => around(src, m.index));
    assert.deepEqual(found, [], `${f} writes a strength of its own`);
  }
});

test('the old one-off looks are gone: one button, one selected state', () => {
  const html = buildHtml();
  for (const old of [/class="key[ "]/, /'key /, /\bsigkey\b/, /\blit-(view|green|red|amber)\b/, /\brkey\b/, /class="rep[ "]/, /\bglabel\b/, /class="sw[ "]/, /\bspeed-(btn|item)\b/, /\bctlibitem\b/, /\blater-box\b/, /\bbtn-primary\b/, /\btone-violet\b/]) {
    assert.equal(old.exec(html)?.[0], undefined, `the page still uses ${old}`);
  }
  assert.doesNotMatch(css, /\.btn-primary|--tone-violet/, 'no primary key, no violet tag tone: violet means selected');
  // The one selected look: lit, from aria-pressed / aria-selected / aria-checked.
  assert.match(css, /:is\(\.btn, \.item\):is\(\[aria-pressed="true"\], \[aria-selected="true"\], \[aria-checked="true"\], \[data-lamp\]\)/);
  // A lit row is a lit key: no look of its own.
  assert.doesNotMatch(css, /\.item:is\(\[aria-pressed="true"\], \[aria-selected="true"\], \[aria-checked="true"\]\) \{/);
});

test('both rows of channel keys show "on" the one way: lit, from aria-pressed', () => {
  assert.doesNotMatch(css, /\.chbtn\.off|\.chbtn \.num/, 'the channel bar has no on/off look of its own');
});

// The decision report (src/core/pugh.js) goes through the same sheet (input
// 65: "make sure we have one master style sheet. Everything goes through
// there"): its markup carries classes only, every class it uses is the
// sheet's, every key is .btn, and a chosen key reads pressed.
test('the decision report has no look of its own: classes from the one sheet only', () => {
  const engine = code(readFileSync(new URL('../src/core/pugh.js', import.meta.url), 'utf8'));
  assert.deepEqual([...engine.matchAll(CODE_COLOUR)].map((m) => around(engine, m.index)), [], 'pugh.js writes colours');
  assert.doesNotMatch(engine, /font-size\s*[:=]|opacity\s*[:=]|\bstyle="|\bstyle=\$|<style>|\.style\./, 'pugh.js writes a style of its own');
  // A report with every part: overrides, vetoes lifted and standing,
  // figures, the sensitivity, the toolbar.
  const mx = JSON.parse(readFileSync(new URL('fixtures/pugh-deadbeat.json', import.meta.url), 'utf8'));
  const series = (k) => ({ x: [0, 1, 2], y: [0, k, 1], role: ['option', 'datum', 'reference', 'other'][k] });
  for (const c of mx.candidates) c.figures = [{ title: 'run', xLabel: 't', panels: [{ yLabel: 'y', series: [0, 1, 2, 3].map(series) }] }];
  const first = decide(mx), out = first.candidates.find((c) => !c.fits && c.vetoes.some((v) => v.by === 'tool'));
  const res = decide({ ...mx, overrides: [
    { kind: 'criterion', criterion: first.criteria[0].key, weight: 2, comment: 'a' },
    { kind: 'cell', candidate: first.ranking[1], criterion: first.criteria[1].key, action: 'veto', comment: 'b' },
    { kind: 'option', candidate: first.ranking[2], action: 'nudge', by: -1, comment: 'c' },
    { kind: 'lift', candidate: out.key, veto: out.vetoes[0].id, comment: 'd' },
  ] });
  const html = renderHtml(res, { style: reportStyle(), live: true }).replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, '');
  const tags = html.match(/<[^>]+>/g);
  const inTags = tags.join('\n');
  assert.deepEqual([...inTags.matchAll(COLOUR)].map((m) => around(inTags, m.index)), [], 'colours in the report\'s markup');
  assert.doesNotMatch(inTags, /\sstyle=|\sfill="|\sstroke="|\sopacity=|font-size|stroke-dasharray|stroke-width/, 'presentation written into the markup');
  // Every class is the sheet's (it is defined there, as a selector).
  const classes = new Set(tags.flatMap((t) => t.match(/\sclass="([^"]*)"/)?.[1].split(/\s+/).filter(Boolean) ?? []));
  const missing = [...classes].filter((c) => !new RegExp(`\\.${c.replace(/[-]/g, '\\-')}(?![\\w-])`).test(css));
  assert.deepEqual(missing, [], 'classes the style sheet does not define');
  // One button: every key is .btn; a chosen key is pressed, not a class.
  const buttons = tags.filter((t) => /^<button\b/.test(t));
  assert.ok(buttons.length > 10);
  assert.deepEqual(buttons.filter((t) => !/\sclass="btn[ "]/.test(t)), [], 'keys that are not .btn');
  assert.deepEqual([...classes].filter((c) => /^(active|selected|on|chosen|current|pressed)$/.test(c)), [], 'a selected look of its own');
  assert.equal(tags.filter((t) => /aria-pressed="true"/.test(t)).length, 1, 'the theme in use reads pressed');
});
