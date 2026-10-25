#!/usr/bin/env node
// Run a Pugh decision matrix from a file (design/output/pugh.md):
//   node tools/pugh.mjs matrix.json [--md | --html | --json]
// Markdown by default; --json prints the result as data.

import { readFileSync } from 'node:fs';
import { decide, renderMarkdown, renderHtml, PughError } from '../src/core/pugh.js';

const args = process.argv.slice(2), file = args.find((a) => !a.startsWith('--'));
if (!file) { console.error('usage: node tools/pugh.mjs matrix.json [--md | --html | --json]'); process.exit(2); }
try {
  const res = decide(JSON.parse(readFileSync(file, 'utf8')));
  process.stdout.write(args.includes('--json') ? `${JSON.stringify(res, null, 1)}\n` : args.includes('--html') ? `${renderHtml(res)}\n` : renderMarkdown(res));
} catch (err) {
  console.error(err instanceof PughError ? `${file}: ${err.message}` : err.message);
  process.exit(1);
}
