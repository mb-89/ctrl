// Bundles the core and the UI into one self-contained HTML file. No
// dependencies: modules are concatenated in dependency order with their
// import lines dropped and their export keywords stripped, inside one IIFE.
//
//   node build.mjs            -> dist/loop-tuner.html (standalone) and dist/artifact.html (page fragment)
//   import { buildHtml } ...  -> used by the CLI to embed a project

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MODULES = [
  'core/poly.js', 'core/blocks.js', 'core/metrics.js', 'core/goal.js', 'core/sim.js', 'core/project.js', 'core/tune.js', 'core/examples.js',
  'ui/knob.js', 'ui/scope.js', 'ui/rack.js', 'ui/candidates.js', 'ui/app.js',
];

// Each module runs in its own function scope; its exports go into a registry
// and its imports are read back from it.
export function bundleScript() {
  const parts = MODULES.map((m) => {
    const src = readFileSync(join(ROOT, 'src', m), 'utf8');
    if (/^export\s+(default|\{)/m.test(src)) throw new Error(`${m}: only "export function/const" is supported`);
    const names = [...src.matchAll(/^export\s+(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map((x) => x[1]);
    const body = src
      .replace(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';\s*$/gm, (_, list, from) => {
        const key = join(dirname(m), from).replace(/\\/g, '/');
        if (!MODULES.includes(key)) throw new Error(`${m}: unknown import ${from}`);
        return `const {${list}} = __mods['${key}'];`;
      })
      .replace(/^export\s+(?=(function|const|let|class))/gm, '');
    if (/^import\s/m.test(body)) throw new Error(`${m}: only single-line named imports are supported`);
    return `// ---- ${m}\n__mods['${m}'] = (() => {\n${body}\nreturn { ${names.join(', ')} };\n})();`;
  });
  return `(() => {\n'use strict';\nconst __mods = {};\n${parts.join('\n')}\n})();\n`;
}

const FONTS = '<link id="lt-fonts" rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@400;600&display=swap">';

const ICON = {
  logo: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4 17 H8 V7 H20" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.45"/><path d="M4 17 H8 C10 4 12 4.5 14 8.2 C15.5 11 17 6.5 20 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  undo: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3 L2.5 6.5 L6 10 M2.5 6.5 H10 a3.5 3.5 0 0 1 0 7 H7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  redo: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 L13.5 6.5 L10 10 M13.5 6.5 H6 a3.5 3.5 0 0 0 0 7 H9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const HELP = `
<h2 id="help-title">Loop Tuner</h2>
<p>Tune a feedback loop by trying controller settings side by side. Each row in <b>Candidates</b> is one controller; its response is drawn on the scope in the same colour. The hatched areas are the limits from your <b>Goal</b>: a candidate that stays out of them is feasible (✓), and the feasible one with the lowest score is marked BEST.</p>
<h3>Working with it</h3>
<div class="keys">
  <span><kbd>↑</kbd> <kbd>↓</kbd></span><span>Step through the candidates</span>
  <span><kbd>Space</kbd></span><span>Show or hide the selected candidate on the scope</span>
  <span><kbd>N</kbd></span><span>Duplicate the selected candidate, to try a variation</span>
  <span><kbd>Del</kbd></span><span>Delete the selected candidate</span>
  <span><kbd>T</kbd></span><span>Auto-tune: search the gains for the best feasible score</span>
  <span><kbd>1</kbd> … <kbd>7</kbd></span><span>Jump to a module: reference, controller, actuator, disturbance, plant, sensor, noise</span>
  <span><kbd>P</kbd></span><span>Play or pause the scan sweep</span>
  <span><kbd>Ctrl</kbd> <kbd>Z</kbd> / <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>Z</kbd></span><span>Undo / redo</span>
</div>
<p>Knobs: drag up or down (hold <kbd>Shift</kbd> for fine steps), scroll, or use the arrow keys. Double-click a knob to reset it; click its value to type one. Gains that can be switched off read “off” at the bottom of their travel.</p>
<p>The controller module edits the selected candidate. Every other module is shared by all candidates, so changing the plant shows how every controller copes with it. Changing a block’s type keeps the parameters both types share, and switching back restores the rest.</p>
<h3>Files</h3>
<p>The whole project is one JSON document. <b>Save JSON</b> and <b>Open</b> read and write it; you can also drop a file on the page or paste JSON. <b>Export HTML</b> writes this page with the project inside, ready to send to someone.</p>
<h3>For agents</h3>
<p>The same simulation runs in Node. With the project file (or an exported HTML file):</p>
<pre>node cli.mjs eval project.json          # metrics, score and feasibility of every candidate
node cli.mjs try project.json --type PID --set Kp=2 --set Ki=0.8 --set Kd=1 --save
node cli.mjs tune project.json --from "Z–N PID" --save
node cli.mjs html project.json -o shared.html</pre>
<p>In the browser, <code>window.loopTuner</code> offers <code>getProject()</code>, <code>setProject(p)</code>, <code>evaluate()</code>, <code>select(name)</code> and <code>addCandidate(c)</code>.</p>
<p><button class="btn primary" id="help-close">Close</button></p>`;

const SHELL = `<div id="lt-shell" class="app">
<header class="bar">
  <div class="brand">${ICON.logo}Loop Tuner</div>
  <input id="title" class="title" aria-label="Project title" spellcheck="false">
  <div class="actions">
    <select id="examples" class="btn" aria-label="Load an example"><option value="">Examples…</option></select>
    <span class="sep"></span>
    <button id="undo" class="btn icon" title="Undo (Ctrl+Z)" aria-label="Undo">${ICON.undo}</button>
    <button id="redo" class="btn icon" title="Redo (Ctrl+Shift+Z)" aria-label="Redo">${ICON.redo}</button>
    <span class="sep"></span>
    <button id="open" class="btn" title="Open a project (.json, or an exported .html)">Open…</button>
    <button id="save" class="btn" data-standalone title="Download the project as JSON (Ctrl+S)">Save JSON</button>
    <button id="export" class="btn" data-standalone title="Download this page with the project inside, to send to someone">Export HTML</button>
    <button id="copy" class="btn" title="Copy the project JSON">Copy JSON</button>
    <button id="copy-html" class="btn" data-framed title="Copy a standalone HTML page with the project inside">Copy HTML</button>
    <button id="help" class="btn icon" title="Help and keyboard shortcuts (?)" aria-label="Help">?</button>
    <input type="file" id="file" accept=".json,.html,application/json,text/html" hidden>
  </div>
</header>
<main class="main">
  <section class="panel scope-panel" aria-label="Scope">
    <div class="scope-head">
      <span class="label">Response</span>
      <span id="warn" class="warn" hidden></span>
      <div class="transport">
        <button id="play" class="btn icon"></button>
        <select id="speed" class="btn" aria-label="Sweep speed"><option value="1.5">Sweep 1.5 s</option><option value="3" selected>Sweep 3 s</option><option value="6">Sweep 6 s</option><option value="12">Sweep 12 s</option></select>
      </div>
    </div>
    <div class="scope-wrap" id="scope"></div>
    <div class="readout" id="readout"></div>
  </section>
  <aside class="side">
    <section class="panel goal" id="goal" aria-label="Goal"></section>
    <section class="panel cands" id="cands" aria-label="Candidates"></section>
  </aside>
  <section class="panel rack" id="rack" aria-label="Loop"></section>
</main>
<div id="toast" class="toast" role="status" hidden></div>
<div id="drop" class="drop" hidden>Drop a project file (.json or .html)</div>
<div id="help-dlg" class="overlay" hidden><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="help-title">${HELP}</div></div>
</div>`;

const jsonScript = (project) => `<script type="application/json" id="loop-tuner-project">\n${JSON.stringify(project, null, 2).replace(/</g, '\\u003c')}\n</script>`;

// fragment: the page body for hosts that supply their own document skeleton.
export function buildHtml({ project = null, fragment = false } = {}) {
  const css = readFileSync(join(ROOT, 'src/ui/style.css'), 'utf8');
  const js = bundleScript().replace(/<\/script/gi, '<\\/script');
  const title = project?.title ? `${project.title} · Loop Tuner` : 'Loop Tuner';
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const body = `${SHELL}\n${project ? jsonScript(project) : '<script type="application/json" id="loop-tuner-project"></script>'}\n<script id="lt-script">${js}</script>`;
  if (fragment) {
    return `<title>${esc(title)}</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n${FONTS}\n<style id="lt-style">${css}</style>\n${body}\n`;
  }
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<title>${esc(title)}</title>\n${FONTS}\n<style id="lt-style">${css}</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync(join(ROOT, 'dist'), { recursive: true });
  const standalone = buildHtml();
  writeFileSync(join(ROOT, 'dist/loop-tuner.html'), standalone);
  writeFileSync(join(ROOT, 'dist/artifact.html'), buildHtml({ fragment: true }));
  console.log(`dist/loop-tuner.html  ${(standalone.length / 1024).toFixed(0)} KB`);
}
