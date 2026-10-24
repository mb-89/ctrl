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
  'core/poly.js', 'core/linalg.js', 'core/scale.js', 'core/blocks.js', 'core/expr.js', 'core/signals.js', 'core/metrics.js', 'core/goal.js', 'core/controllers.js', 'core/observers.js', 'core/hil.js', 'core/diagram.js', 'core/sim.js', 'core/plants.js', 'core/views.js', 'core/project.js', 'core/tune.js', 'core/examples.js', 'core/systems.js', 'core/spectrum.js', 'core/analysis.js',
  'core/live.js', 'core/trace.js', 'core/zip.js',
  'ui/units.js', 'ui/dial.js', 'ui/freqview.js', 'ui/xyview.js', 'ui/display.js', 'ui/plots.js', 'ui/analysis.js', 'ui/controls.js', 'ui/generator.js', 'ui/scene.js', 'ui/plant.js', 'ui/controller.js', 'ui/layout.js', 'ui/record.js', 'ui/live.js', 'ui/app.js',
];

// Live mode offers the external plant for download: the files of hil/ ride in
// the bundle as __HIL_FILES (ui/live.js zips them), so an exported page has
// them too.
const HIL_FILES = ['hil_plant.py', 'runme.sh', 'runme.ps1', 'README.txt'];
const hilFiles = () => `// hil/: the external plant, offered under Live\nconst __HIL_FILES = ${JSON.stringify(Object.fromEntries(HIL_FILES.map((f) => [f, readFileSync(join(ROOT, 'hil', f), 'utf8')])))};`;

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
  return `(() => {\n'use strict';\nconst __mods = {};\n${hilFiles()}\n${parts.join('\n')}\n})();\n`;
}

const FONTS = '<link id="lt-fonts" rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@400;600&display=swap">';

const ICON = {
  logo: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4 17 H8 V7 H20" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.45"/><path d="M4 17 H8 C10 4 12 4.5 14 8.2 C15.5 11 17 6.5 20 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  undo: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3 L2.5 6.5 L6 10 M2.5 6.5 H10 a3.5 3.5 0 0 1 0 7 H7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  redo: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 L13.5 6.5 L10 10 M13.5 6.5 H6 a3.5 3.5 0 0 0 0 7 H9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const HELP = `
<h2 id="help-title">Loop Tuner</h2>
<p>An oscilloscope for control loops. The display shows the signals of the loop; you set the loop up in the tabs below, one step at a time: the Input tab makes the signals, the Plant tab wires the system as a block diagram, the Controller tab chooses and tunes its controllers. Earlier runs stay faded on the display for five runs, so a change can be compared with before.</p>
<h3>Display</h3>
<div class="keys">
  <span><kbd>R</kbd></span><span>Run / Stop. Running sweeps the record in real time, over and over.</span>
  <span><kbd>S</kbd></span><span>Single: one sweep, then stop</span>
  <span><kbd>A</kbd></span><span>Auto Scale: fit the timebase and every channel to the data</span>
  <span>Knobs</span><span>Drag, scroll, or focus and use the arrow keys. Double-click a Position knob to zero it. Click a readout to type a value (20m, 100 ms).</span>
  <span>Channel keys</span><span>Select a channel for the Vertical knobs; press again to turn it off</span>
  <span>Wheel</span><span>On the plot: zoom time and values around the cursor. On the time axis or the value axis: that axis only.</span>
  <span>Drag</span><span>Pan. Click a trace or its marker first to move and zoom that line alone; <kbd>Esc</kbd> releases it.</span>
  <span><kbd>Shift</kbd> + drag</span><span>Zoom to the marked box; a flat band zooms time only, a narrow band values only</span>
  <span>Separators</span><span>Drag the gaps between display, controls and tabs to resize; double-click to reset</span>
</div>
<p>The screen is the record: what you see is simulated and swept, in real time. <b>Save ▾</b>, under the screen, stores it: every signal as CSV or JSON, or a picture (PNG). <b>Open…</b> shows a saved trace dashed on the channels with the same names, until you clear it (<b>ref ✕</b>); <b>◀ ▶</b> step through one longer than the screen.</p>
<h3>Signal generator</h3>
<p>Press a waveform key to draft a component: the display shows it dashed on its own and added to the signal. Adjust it, then <b>Add</b>. Click a component in the stack to edit it. The input repeats with its <b>Period</b>; Auto Scale shows one period. <b>Function</b> takes a formula in t, such as <code>0.3*sin(2*pi*4*t) + step(t-0.5)</code>.</p>
<div class="keys">
  <span><kbd>0</kbd>–<kbd>9</kbd> <kbd>.</kbd> <kbd>-</kbd></span><span>Type a value for the active field; <kbd>Enter</kbd> sets it</span>
  <span><kbd>Enter</kbd></span><span>With nothing typed: add (or apply) the draft</span>
  <span><kbd>Esc</kbd></span><span>Clear what you typed, or cancel the draft</span>
  <span><kbd>←</kbd> <kbd>→</kbd></span><span>Move the digit cursor</span>
  <span><kbd>↑</kbd> <kbd>↓</kbd></span><span>Change the digit under the cursor (the dial does the same)</span>
  <span><kbd>Tab</kbd></span><span>Next field</span>
  <span><kbd>Ctrl</kbd> <kbd>Z</kbd></span><span>Undo; <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>Z</kbd> redo</span>
</div>
<h3>Plant</h3>
<p>The plant is a block diagram. Drag blocks in from the library (or click to add), drag from an output to an input to wire them, click a block to set its parameters on the right. <b>Source</b> blocks play a signal made in the Input tab; <b>Sink</b> blocks (x, speed, …) can be shown on any channel. Double-click a <b>Controller</b> block to open it in the Controller tab. Shift-drag or Shift-click to select several, <kbd>Ctrl</kbd> <kbd>G</kbd> to group them into a subsystem, double-click a subsystem to open it, <kbd>Esc</kbd> to go back up. A subsystem can be saved to My blocks. Double-click a Switch to move it to its next input. Wheel zooms the canvas; dragging the background pans.</p>
<p>A plant can also have <b>2D views</b> (Diagram | views above the canvas), set in the project's JSON: they move with the signals, following the scope's scan line (press <b>Single</b> for one run from t = 0) or your cursor.</p>
<h3>Controller</h3>
<p>A Controller block takes the reference r and the measurements, and drives the plant at its sample time Ts. It holds <b>variants</b>, implementations with the same inputs and output: click one to run it. Edit the running variant's parameters (the wheel over a number nudges it by 5 %, Shift 1 %), or add a variant from the library: PID, state feedback, gain-scheduled PI, energy swing-up.</p>
<h3>Live (HIL)</h3>
<p>A system with an <b>External plant</b> block (Plant tab, group Live) runs against a plant outside the page, in real time. Try <b>HIL: external motor</b> from the System library: Run Control gets a second row, <b>Connect</b>, <b>E-STOP</b>, <b>Reset</b>. <b>plant script…</b> under it gives you <code>hil-plant.zip</code>: unzip it and run <code>sh runme.sh</code> (Linux, macOS) or <code>runme.ps1</code> (Windows), which install what they need; with uv, <code>uv run hil_plant.py</code>. Then Connect. Every cycle the plant sends its outputs, the page runs the diagram and answers with the controller's output; edit the controller meanwhile and it takes effect at the next sample. <b>Run</b> and <b>Stop</b> start and stop the plant (each Run is a fresh run from t = 0), <b>Single</b> runs one screen. E-STOP on the page, Enter in the plant's window, or 10 silent cycles on either side stop it (safe inputs) until Reset. <b>Rec</b> keeps the last minutes of every live signal (click the length to change it); Save ▾ › Live record writes them.</p>
<h3>System library</h3>
<p>Complete example systems, from a mass–spring–damper to a triple pendulum, each with its input, plant and controllers. Load a whole system, or only one part of it, for example the input of one system with the plant of another.</p>
<h3>Files</h3>
<p>The project is one JSON document, including how the display is set. Save it, open it, drop it on the page or paste it. <b>Export HTML</b> writes this page with the project inside, to send to someone.</p>
<h3>For agents</h3>
<pre>node cli.mjs help</pre>
<p>In the browser, <code>window.loopTuner</code> offers <code>getProject()</code>, <code>setProject(p)</code>, <code>addComponent(c)</code>, <code>reference()</code>, <code>autoScale()</code>, <code>run()</code>, <code>stop()</code> and <code>single()</code> (with a live plant these start and stop it).</p>
<p>Live: <code>loopTuner.live.connect(url?)</code>, <code>.disconnect()</code>, <code>.estop()</code>, <code>.reset()</code>, <code>.state()</code> (connection, run mode, the plant's ports and figures, how edits were taken). To tune while it runs, change a variant's parameters with <code>getProject()</code> and <code>setProject(p)</code>: they take effect at the next sample. Traces: <code>loopTuner.record.screen('csv' | 'json')</code> (every signal on the screen), <code>.live(format)</code> (the live record), <code>.reference(text, name)</code>, <code>.clearReferences()</code>, <code>.state()</code>. The protocol, for plants of your own: JSON-RPC 2.0 over a WebSocket, described in <code>hil_plant.py</code>'s header and in the repository's design/output/hil.md.</p>
<p><button class="key primary" id="help-close">Close</button></p>`;

const SHELL = `<div id="lt-shell" class="app">
<header class="bar">
  <div class="brand">${ICON.logo}Loop Tuner</div>
  <input id="title" class="title" aria-label="Project title" spellcheck="false">
  <span id="loopnote" class="loopnote"></span>
  <div class="actions">
    <div class="popwrap"><button id="syslib" class="btn" aria-haspopup="true" aria-expanded="false" title="Complete systems: load one whole, or only its input, plant or controller">System library ▾</button><div id="syslib-pop" class="popover" hidden></div></div>
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
<main class="instrument">
  <section class="display" id="display" aria-label="Display">
    <div class="status"></div>
    <div class="screen"></div>
    <div class="badges"></div>
  </section>
  <div class="split split-v" id="split-v" role="separator" aria-orientation="vertical" aria-label="Resize the controls" tabindex="0" title="Drag to resize · double-click to reset"></div>
  <aside class="controls" id="controls" aria-label="Controls"></aside>
</main>
<div class="split split-h" id="split-h" role="separator" aria-orientation="horizontal" aria-label="Resize the setup area" tabindex="0" title="Drag to resize · double-click to reset"></div>
<section class="setup" aria-label="Setup">
  <div class="tabbar" id="tabbar" role="tablist"></div>
  <div class="tabpanel">
    <div id="tab-input" role="tabpanel"></div>
    <div id="tab-plant" role="tabpanel" hidden></div>
    <div id="tab-controller" role="tabpanel" hidden></div>
    <div id="tab-analysis" role="tabpanel" hidden></div>
    <div id="tab-later" role="tabpanel" hidden></div>
  </div>
</section>
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
