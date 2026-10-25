#!/usr/bin/env node
// Run a Pugh decision matrix from a file (design/output/pugh.md):
//   node tools/pugh.mjs matrix.json [--overrides changes.json] [-o report.html] [--html | --json]
// The report is HTML (-o writes it; --html prints it); without -o the
// terminal gets the same decision as Markdown text; --json prints the result
// as data. --overrides adds the person's changes (a report's Export changes)
// to the matrix's own.

import { readFileSync, writeFileSync } from 'node:fs';
import { decide, renderMarkdown, renderHtml, bottomLine, PughError } from '../src/core/pugh.js';
import { reportStyle } from '../build.mjs';

const args = process.argv.slice(2), valueOf = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const outFile = valueOf('-o'), ovFile = valueOf('--overrides');
const file = args.find((a, i) => !a.startsWith('-') && !['-o', '--overrides'].includes(args[i - 1]));
if (!file) { console.error('usage: node tools/pugh.mjs matrix.json [--overrides changes.json] [-o report.html] [--html | --json]'); process.exit(2); }
try {
  const matrix = JSON.parse(readFileSync(file, 'utf8'));
  if (ovFile) matrix.overrides = [...(matrix.overrides ?? []), ...JSON.parse(readFileSync(ovFile, 'utf8'))];
  const res = decide(matrix);
  if (outFile) {
    writeFileSync(outFile, renderHtml(res, { style: reportStyle() }));
    console.log(`${bottomLine(res).replace(/\*\*/g, '')}\nThe report: ${outFile}`);
  } else process.stdout.write(args.includes('--json') ? `${JSON.stringify(res, null, 1)}\n` : args.includes('--html') ? renderHtml(res, { style: reportStyle() }) : renderMarkdown(res));
} catch (err) {
  console.error(err instanceof PughError ? `${file}: ${err.message}` : err.message);
  process.exit(1);
}
