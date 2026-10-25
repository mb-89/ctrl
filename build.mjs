// Bundles the core and the UI into one self-contained HTML file. No
// dependencies: modules are concatenated in dependency order with their
// import lines dropped and their export keywords stripped, inside one IIFE.
//
//   node build.mjs            -> dist/loop-tuner.html (standalone) and dist/artifact.html (page fragment)
//   import { buildHtml } ...  -> used by the CLI to embed a project

import { stripComments } from './tools/strip-comments.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MODULES = [
  'core/poly.js', 'core/linalg.js', 'core/scale.js', 'core/speed.js', 'core/blocks.js', 'core/expr.js', 'core/signals.js', 'core/metrics.js', 'core/goal.js', 'core/linearize.js', 'core/planner.js', 'core/design.js', 'core/controllers.js', 'core/structure.js', 'core/observers.js', 'core/hil.js', 'core/diagram.js', 'core/sim.js', 'core/plants.js', 'core/views.js', 'core/project.js', 'core/tune.js', 'core/examples.js', 'core/systems.js', 'core/spectrum.js', 'core/analysis.js', 'core/autotune.js',
  'core/live.js', 'core/trace.js', 'core/zip.js',
  'ui/units.js', 'ui/dial.js', 'ui/freqview.js', 'ui/xyview.js', 'ui/measure.js', 'ui/display.js', 'ui/plots.js', 'ui/analysis.js', 'ui/controls.js', 'ui/generator.js', 'ui/scene.js', 'ui/plant.js', 'ui/ctldiagram.js', 'ui/controller.js', 'ui/autotune.js', 'ui/layout.js', 'ui/record.js', 'ui/live.js', 'ui/speed.js', 'ui/app.js',
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
    // The page carries code, not the repository's comments (and no trace of
    // where it was made: test/provenance.test.mjs).
    const src = stripComments(readFileSync(join(ROOT, 'src', m), 'utf8'));
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
  lock: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 7 V5 a2.5 2.5 0 0 1 5 0 V7" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
};

const HELP = `
<h2 id="help-title">Loop Tuner</h2>
<p>An oscilloscope for control loops. The display shows the signals of the loop; you set the loop up in the tabs below, one step at a time: the Input tab makes the signals, the Plant tab wires the system as a block diagram, the Controller tab chooses and tunes its controllers, the Auto-tune tab improves them by simulation. Earlier runs stay faded on the display for five runs, so a change can be compared with before.</p>
<h3>Display</h3>
<div class="keys">
  <span><kbd>R</kbd></span><span>Run / Stop. Running sweeps the record at the speed set in the header (1×: real time), over and over.</span>
  <span><kbd>S</kbd></span><span>Single: one sweep, then stop</span>
  <span><kbd>A</kbd></span><span>Auto Scale: fit the timebase and every channel to the data</span>
  <span>Knobs</span><span>Drag, scroll, or focus and use the arrow keys. Double-click a Position knob to zero it. Click a readout to type a value (20m, 100 ms).</span>
  <span>Channel keys</span><span>Select a channel for the Vertical knobs; press again to turn it off</span>
  <span>Wheel</span><span>On the plot: zoom time and values around the cursor. On the time axis or the value axis: that axis only.</span>
  <span>Drag</span><span>Pan. Click a trace or its marker first to move and zoom that line alone; <kbd>Esc</kbd> releases it.</span>
  <span><kbd>Shift</kbd> + drag</span><span>Zoom to the marked box; a flat band zooms time only, a narrow band values only</span>
  <span>Separators</span><span>Drag the gaps between display, controls and tabs to resize; double-click to reset</span>
  <span>Measure</span><span>Vertical › Measure: a line under the screen for the selected channel with its mean, rms, ac rms, peak to peak, total variation per second (TV, how far it travels: an actuator's wear) and reversals per second (turns larger than a tenth of a division), over what the screen shows. A waveform with fewer than 10 samples per period is marked under-resolved: its rms is then wrong.</span>
  <span>Spectrogram levels</span><span>The strip at the right edge: a histogram of the amplitudes shown (dB) beside the colour bar. Below the floor is black, above the ceiling the brightest colour. Drag a handle or the band between them; the wheel moves the floor, <kbd>Shift</kbd> + wheel the ceiling; double-click for automatic levels (the floor 10 dB above the median, the noise). Levels belong to the signal shown; Run Control › Levels types them (↑ ↓: 1 dB, Shift: 10 dB).</span>
</div>
<p><b>Speed</b>, in the header, sets how fast simulated time runs: 1× is real time, 10× ten times faster, 0.1× slower; type any factor, or -1 or inf for <b>∞</b>, as fast as possible. No speed runs faster than this page simulates the screen (timed after each change); ∞ runs at that, so it depends on the system and on the time per division (a finer screen takes more steps per second). Beside it, the speed achieved over the last second; its tooltip gives the simulation's speed. Auto-tune runs at it too. With a live plant connected it stays at 1× (a lock shows it): the plant owns the clock.</p>
<p>The screen is the record: what you see is simulated and swept, at that speed. <b>Save ▾</b>, under the screen, stores it: every signal as CSV or JSON, or a picture (PNG). <b>Open…</b> shows a saved trace dashed on the channels with the same names, until you clear it (<b>ref ✕</b>); <b>◀ ▶</b> step through one longer than the screen.</p>
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
<p>A Controller block takes the reference r and the measurements, and drives the plant at its sample time Ts. It holds <b>variants</b>, implementations with the same inputs and output: click one to run it. Edit the running variant's parameters (the wheel over a number nudges it by 5 %, Shift 1 %; in a list such as Q, click into a value first), or add a variant from the library.</p>
<p>Variants <b>from the plant</b> (LQR, PI from the plant, swing-up with an LQR catch, the planned swing-up, and an Observer's Kalman filter) hold only weights, levels and limits: their numbers are computed in the page from the plant as it is wired, every time it changes. The <b>Computed</b> box shows what was computed, from which plant, and why a design was refused (the block then puts out u = 0). A plan takes a few seconds and is made in the background: until it is ready the block puts out u = 0, or runs its previous plan, and the box shows the progress, with <b>Cancel</b>; the display then takes the new run from its start. <b>Copy as numbers</b> turns the numbers into a hand variant, which no longer follows the plant. Variants <b>by hand</b>: PID, state feedback, gain-scheduled PI, energy swing-up, relay (on/off), sliding mode, super-twisting; for an Observer, a Luenberger observer and finite differences. The sliding modes read the measured rate on input 3. Try <b>DC motor, sliding mode</b>: its XY view is the phase portrait, and the line's slope λ sets how the error decays.</p>
<h3>Auto-tune</h3>
<p>Improves a Controller block's running variant by simulation, into a new variant (the original stays to compare). <b>Iterate</b> runs the loop again and again, keeping gains that lower the cost (IAE, ITAE or ISE of r − y, plus effort and overshoot beyond a bound): watch each improvement on the display and the cost fall in the plot. <b>Relay</b> makes the loop oscillate to find its ultimate gain and period, then applies a rule (Ziegler–Nichols, Tyreus–Luyben, no overshoot). <b>Step response</b> fits a lag and a dead time and tunes a PI by SIMC. Every run the tuner tries sweeps across the display at the header's <b>Speed</b> and lasts its own length, one period of the input, whatever the screen shows (a 5 s run takes 5 s at 1×, half a second at 10×); at ∞ it computes as fast as it can and shows each improvement. The scope's Stop stops the tuning too. One <kbd>Ctrl</kbd> <kbd>Z</kbd> undoes a whole run. Try it on <b>Oven, badly tuned</b>. A relay or step result that scores worse than what runs, or that is unstable where the run starts, is added but does not run. A variant from the plant is tuned as its Copy as numbers twin, from the numbers its design computes now, and the result is a hand variant beside it; a planned swing-up has no gains to tune (change its inputs in the Controller tab).</p>
<h3>Analysis</h3>
<p>The loop a Controller block closes, linearised from the plant it sees, with the running variant's own law: whether it is stable, its gain, phase and delay margins, Ms, the poles, root locus, Bode, Nyquist and the linear step, discrete at the block's Ts as it runs. <b>At rest</b>, <b>Start</b> or <b>Scope time</b> picks where it is linearised (the scope's time follows the cursor or the sweep). A law that has no linear model there (a relay, the ideal sliding mode, super-twisting, a swing-up pumping energy), a plan not made yet, or a plant outside the page is named, with the reason. Where the linear model does not hold (a kink at that point, or u at a limit), it says so first and grades nothing.</p>
<h3>Live (HIL)</h3>
<p>A system with an <b>External plant</b> block (Plant tab, group Live) runs against a plant outside the page, in real time. Try <b>HIL: external motor</b> from the System library: Run Control gets a second row, <b>Connect</b>, <b>E-STOP</b>, <b>Reset</b>. <b>plant script…</b> under it gives you <code>hil-plant.zip</code>: unzip it and run <code>sh runme.sh</code> (Linux, macOS) or <code>runme.ps1</code> (Windows), which install what they need; with uv, <code>uv run hil_plant.py</code>. Then Connect. Every cycle the plant sends its outputs, the page runs the diagram and answers with the controller's output; edit the controller meanwhile and it takes effect at the next sample. <b>Run</b> and <b>Stop</b> start and stop the plant (each Run is a fresh run from t = 0), <b>Single</b> runs one screen. E-STOP on the page, Enter in the plant's window, or 10 silent cycles on either side stop it (safe inputs) until Reset. <b>Rec</b> keeps the last minutes of every live signal (click the length to change it); Save ▾ › Live record writes them.</p>
<h3>System library</h3>
<p>Complete example systems, from a mass–spring–damper to a triple pendulum, each with its input, plant and controllers. Load a whole system, or only one part of it, for example the input of one system with the plant of another.</p>
<h3>Files</h3>
<p>The project is one JSON document, including how the display is set. Save it, open it, drop it on the page or paste it. <b>Export HTML</b> writes this page with the project inside, to send to someone.</p>
<h3>For agents</h3>
<pre>node cli.mjs help</pre>
<p>In the browser, <code>window.loopTuner</code> offers <code>getProject()</code>, <code>setProject(p)</code>, <code>addComponent(c)</code>, <code>reference()</code>, <code>autoScale()</code>, <code>run()</code>, <code>stop()</code>, <code>single()</code> (with a live plant these start and stop it), <code>speed(x?)</code> (sets the speed: a factor, or -1 for as fast as possible; returns the setting, the factor in effect, the achieved speed, the simulation's speed and why it is held at 1×, if it is), <code>autotune({ method, goal })</code>, <code>designs()</code> (what the designed controllers and observers computed), <code>whenDesigned()</code> (resolves once no plan is being made, with the same list) and <code>loopModel(path, op)</code> (the loop a Controller closes, linearised at <code>'origin'</code>, <code>'initial'</code>, <code>{ y: [levels] }</code> or <code>{ t: seconds }</code>: the plant it sees and its law, as state space); <code>node cli.mjs autotune</code> tunes a Controller block from the command line.</p>
<p>Live: <code>loopTuner.live.connect(url?)</code>, <code>.disconnect()</code>, <code>.estop()</code>, <code>.reset()</code>, <code>.state()</code> (connection, run mode, the plant's ports and figures, how edits were taken). To tune while it runs, change a variant's parameters with <code>getProject()</code> and <code>setProject(p)</code>: they take effect at the next sample. Traces: <code>loopTuner.record.screen('csv' | 'json')</code> (every signal on the screen), <code>.live(format)</code> (the live record), <code>.reference(text, name)</code>, <code>.clearReferences()</code>, <code>.state()</code>. The protocol, for plants of your own: JSON-RPC 2.0 over a WebSocket, described in <code>hil_plant.py</code>'s header and in the repository's design/output/hil.md.</p>
<p><button class="key primary" id="help-close">Close</button></p>`;

const SHELL = `<div id="lt-shell" class="app">
<header class="bar">
  <div class="brand">${ICON.logo}Loop Tuner</div>
  <input id="title" class="title" aria-label="Project title" spellcheck="false">
  <span id="loopnote" class="loopnote"></span>
  <div class="actions">
    <div class="speed" id="speed" role="group" aria-label="Speed of simulated time">
      <label class="speed-label" for="speed-in">Speed</label>
      <div class="speed-set popwrap"><span class="speed-lock" title="Held at 1×: a live plant is connected">${ICON.lock}</span><input id="speed-in" class="speed-in" spellcheck="false" autocomplete="off" aria-describedby="speed-got"><button type="button" id="speed-menu" class="speed-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="speed-pop" aria-label="Speed presets">▾</button><div id="speed-pop" class="popover speed-pop" role="menu" aria-label="Speed presets" hidden></div></div>
      <span id="speed-got" class="speed-got">–</span>
    </div>
    <span class="sep"></span>
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
    <div id="tab-tune" role="tabpanel" hidden></div>
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
  const css = readFileSync(join(ROOT, 'src/ui/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n\s*\n+/g, '\n');
  const js = bundleScript().replace(/<\/script/gi, '<\\/script');
  const title = project?.title ? `${project.title} · Loop Tuner` : 'Loop Tuner';
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const body = `${SHELL}\n${project ? jsonScript(project) : '<script type="application/json" id="loop-tuner-project"></script>'}\n<script id="lt-script">${js}</script>`;
  if (fragment) {
    // Only the hosted page gets the host's save adapter; the standalone page
    // (and every page it exports) knows nothing of the host.
    const host = '<script id="lt-host">window.__ltHost = { saver: () => window.claude?.use?.(\'downloads\') ?? Promise.resolve(null) };</script>';
    return `<title>${esc(title)}</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n${FONTS}\n<style id="lt-style">${css}</style>\n${host}\n${body}\n`;
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
