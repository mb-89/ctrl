#!/usr/bin/env node
// Run a Pugh decision matrix from a file (design/output/pugh.md):
//   node tools/pugh.mjs matrix.json [-o report.html] [--html | --json]
// The report is HTML (-o writes it; --html prints it); without -o the
// terminal gets the same decision as Markdown text; --json prints the result
// as data.

import { readFileSync, writeFileSync } from 'node:fs';
import { decide, renderMarkdown, renderHtml, bottomLine, PughError } from '../src/core/pugh.js';

const args = process.argv.slice(2), at = args.indexOf('-o'), outFile = at >= 0 ? args[at + 1] : null;
const file = args.find((a, i) => !a.startsWith('-') && (at < 0 || i !== at + 1));
if (!file) { console.error('usage: node tools/pugh.mjs matrix.json [-o report.html] [--html | --json]'); process.exit(2); }
try {
  const res = decide(JSON.parse(readFileSync(file, 'utf8')));
  if (outFile) {
    writeFileSync(outFile, renderHtml(res));
    console.log(`${bottomLine(res).replace(/\*\*/g, '')}\nThe report: ${outFile}`);
  } else process.stdout.write(args.includes('--json') ? `${JSON.stringify(res, null, 1)}\n` : args.includes('--html') ? renderHtml(res) : renderMarkdown(res));
} catch (err) {
  console.error(err instanceof PughError ? `${file}: ${err.message}` : err.message);
  process.exit(1);
}
