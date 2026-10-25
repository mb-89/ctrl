// Bundles the core and the UI into one self-contained HTML file. No
// dependencies: modules are concatenated in dependency order with their
// import lines dropped and their export keywords stripped, inside one IIFE.
//
//   node build.mjs            -> dist/loop-tuner.html (standalone) and dist/artifact.html (page fragment)
//   import { buildHtml } ...  -> used by the CLI to embed a project

import { stripComments } from './tools/strip-comments.mjs';
import { AGENT_NOTE } from './src/core/guide.js';
import { simulatorCore, CORE_FILE } from './src/core/hilsim.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
export const MODULES = [
  'core/poly.js', 'core/linalg.js', 'core/scale.js', 'core/speed.js', 'core/blocks.js', 'core/expr.js', 'core/formula.js', 'core/signals.js', 'core/metrics.js', 'core/goal.js', 'core/linearize.js', 'core/planner.js', 'core/design.js', 'core/controllers.js', 'core/structure.js', 'core/observers.js', 'core/hil.js', 'core/xml.js', 'core/urdf.js', 'core/rbd.js', 'core/puma560.js', 'core/mathblocks.js', 'core/robotblocks.js', 'core/vectors.js', 'core/diagram.js', 'core/sim.js', 'core/pumasystem.js', 'core/plants.js', 'core/views.js', 'core/project.js', 'core/tune.js', 'core/examples.js', 'core/systems.js', 'core/hilsim.js', 'core/spectrum.js', 'core/analysis.js', 'core/autotune.js',
  'core/ramp.js', 'core/live.js', 'core/trace.js', 'core/zip.js', 'core/guide.js',
  'ui/units.js', 'ui/palette.js', 'ui/dial.js', 'ui/freqview.js', 'ui/xyview.js', 'ui/measure.js', 'ui/display.js', 'ui/plots.js', 'ui/analysis.js', 'ui/controls.js', 'ui/generator.js', 'ui/scene.js', 'ui/view3d.js', 'ui/robotscene.js', 'ui/plant.js', 'ui/ctldiagram.js', 'ui/controller.js', 'ui/autotune.js', 'ui/layout.js', 'ui/record.js', 'ui/live.js', 'ui/speed.js', 'ui/limited.js', 'ui/app.js',
];

// Live mode offers the external plant for download: the files of hil/ ride in
// the bundle as __HIL_FILES (ui/live.js zips them), so an exported page has
// them too. They are kept as written (no comment stripping), so they must
// carry no provenance either (test/provenance.test.mjs).
const HIL_FILES = ['hil_plant.py', 'runme.sh', 'runme.cmd', 'runme.ps1', 'README.txt'];
const hilFiles = () => `// hil/: the external plant, offered under Live\nconst __HIL_FILES = ${JSON.stringify(Object.fromEntries(HIL_FILES.map((f) => [f, readFileSync(join(ROOT, 'hil', f), 'utf8')])))};`;

// Each module runs in its own function scope; its exports go into a registry
// and its imports are read back from it. A harness may bundle other modules
// (in dependency order) and run a tail of code inside the bundle, with
// __mods in scope; the defaults make the page's script.
export function bundleScript(modules = MODULES, tail = '') {
  const parts = modules.map((m) => {
    // The page carries code, not the repository's comments (and no trace of
    // where it was made: test/provenance.test.mjs).
    const src = stripComments(readFileSync(join(ROOT, 'src', m), 'utf8'));
    if (/^export\s+(default|\{)/m.test(src)) throw new Error(`${m}: only "export function/const" is supported`);
    const names = [...src.matchAll(/^export\s+(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map((x) => x[1]);
    const body = src
      .replace(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';\s*$/gm, (_, list, from) => {
        const key = join(dirname(m), from).replace(/\\/g, '/');
        if (!modules.includes(key)) throw new Error(`${m}: unknown import ${from}`);
        return `const {${list.replace(/\s+as\s+/g, ': ')}} = __mods['${key}'];`;  // import { a as b }: const { a: b }
      })
      .replace(/^export\s+(?=(function|const|let|class))/gm, '');
    if (/^import\s/m.test(body)) throw new Error(`${m}: only single-line named imports are supported`);
    return `// ---- ${m}\n__mods['${m}'] = (() => {\n${body}\nreturn { ${names.join(', ')} };\n})();`;
  });
  return `(() => {\n'use strict';\nconst __mods = {};\n${hilFiles()}\n${parts.join('\n')}\n${tail ? `${tail}\n` : ''}})();\n`;
}

// ui/limited.js runs inline as well, before the first paint: it hides the
// warning below the header where the environment is full, so it never
// flashes; where no script runs, the warning stays.
const limitedCheck = () => `<script id="lt-limited-check">(() => {\n${stripComments(readFileSync(join(ROOT, 'src/ui/limited.js'), 'utf8')).replace(/^export\s+/gm, '')}\ntry { markLimited(window); } catch { }\n})();</script>`;

// three.js, vendored unmodified (src/vendor/three/README.md), runs as its own
// classic script before the page's: its ES module syntax becomes plain
// statements and its exports globalThis.THREE. Its text, licence comments
// included, is kept as it is; the files are checked against their checksums.
export const THREE_FILES = {
  'three.core.min.js': '05b2609338c76cd65daf74f3ac515bc9a5045e1b3b33edc07d8c9bd55250fa90',
  'three.module.min.js': '86bcee248b64f44bcfc23c331ae74619061957d59cab040171dcb6fb5900beb6',
  LICENSE: '8b378ebe60e2fe500158cb0ac71cb5e8b7d92953c2abcc63a0eb90499653b5bc',
};
const CORE_URL = '"./three.core.min.js"';

export function readVendorThree(dir = join(ROOT, 'src/vendor/three')) {
  const out = {};
  for (const [f, sha] of Object.entries(THREE_FILES)) {
    const buf = readFileSync(join(dir, f));
    const got = createHash('sha256').update(buf).digest('hex');
    if (got !== sha) throw new Error(`src/vendor/three/${f}: sha256 ${got}, expected ${sha} (README.md)`);
    out[f] = buf.toString('utf8');
  }
  return out;
}

// `a as B, c` -> [['a', 'B'], ['c', 'c']]
const specifiers = (list) => list.split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
  const m = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(x);
  if (!m) throw new Error(`three.js: unexpected specifier ${x}`);
  return [m[1], m[2] ?? m[1]];
});
// The one statement `re` matches in src (exactly one, or the build stops).
function only(src, re, what) {
  const all = [...src.matchAll(new RegExp(re.source, 'g'))];
  if (all.length !== 1) throw new Error(`three.js: expected one ${what}, found ${all.length}`);
  return all[0];
}

export function vendorScript(files = readVendorThree()) {
  const core = files['three.core.min.js'], mod = files['three.module.min.js'];
  for (const [name, src] of [['core', core], ['module', mod]]) {
    if (/\bimport\s*\(|\bimport\.meta\b/.test(src)) throw new Error(`three.js ${name}: dynamic import or import.meta`);
  }
  const ce = only(core, /export\{([^}]*)\};?/, 'export in the core');
  if (/\bimport\s*\{/.test(core)) throw new Error('three.js core: an import');
  const mi = only(mod, new RegExp(`import\\{([^}]*)\\}from${CORE_URL};`), 'import of the core');
  const mr = only(mod, new RegExp(`export\\{([^}]*)\\}from${CORE_URL};`), 're-export of the core');
  const me = only(mod, /export\{([^}]*)\};?(?=\s*$)/, 'export at the end of the module');
  if ((mod.match(/export\s*\{/g) ?? []).length !== 2 || (mod.match(/\bimport\s*\{/g) ?? []).length !== 1) throw new Error('three.js module: unexpected imports or exports');
  const obj = (pairs) => `{${pairs.map(([local, name]) => `${name}:${local}`).join(',')}}`;
  const cut = (src, ...ms) => {
    let out = src;
    for (const m of [...ms].sort((a, b) => b.index - a.index)) out = `${out.slice(0, m.index)}${m.repl}${out.slice(m.index + m[0].length)}`;
    return out;
  };
  ce.repl = `;return${obj(specifiers(ce[1]))};`;
  mi.repl = `const{${specifiers(mi[1]).map(([name, local]) => `${name}:${local}`).join(',')}}=__threeCore;`;
  mr.repl = `const __threeAgain=${obj(specifiers(mr[1]).map(([local, name]) => [`__threeCore.${local}`, name]))};`;
  me.repl = `;return Object.assign({},__threeCore,__threeAgain,${obj(specifiers(me[1]))});`;
  return `/*\n${files.LICENSE.trim()}\n*/\n(()=>{\n'use strict';\nconst __threeCore=(()=>{\n'use strict';\n${cut(core, ce)}\n})();\nglobalThis.THREE=Object.freeze((()=>{\n'use strict';\n${cut(mod, mi, mr, me)}\n})());\n})();\n`;
}
export const vendorBlock = (files) => `<script id="lt-vendor-three">${vendorScript(files).replace(/<\/script/gi, '<\\/script')}</script>`;

// The page's two typefaces ride in it (Latin subsets, the weights it uses), so
// it loads nothing from anywhere (test/standalone.test.mjs). IBM Plex is under
// the SIL Open Font License 1.1 (src/ui/fonts/OFL.txt); the notice goes with
// the fonts as the style's data-license, and Help names it.
const FONT_FILES = [
  ['IBM Plex Sans Condensed', 400, 'ibm-plex-sans-condensed-latin-400-normal.woff2'],
  ['IBM Plex Sans Condensed', 600, 'ibm-plex-sans-condensed-latin-600-normal.woff2'],
  ['IBM Plex Mono', 400, 'ibm-plex-mono-latin-400-normal.woff2'],
  ['IBM Plex Mono', 600, 'ibm-plex-mono-latin-600-normal.woff2'],
];
const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const FONT_LICENSE = 'IBM Plex Sans Condensed and IBM Plex Mono, copyright IBM Corp., with Reserved Font Name Plex; licensed under the SIL Open Font License, Version 1.1';
const fontFaces = () => FONT_FILES.map(([family, weight, file]) => `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${readFileSync(join(ROOT, 'src/ui/fonts', file)).toString('base64')}) format("woff2");unicode-range:${LATIN}}`).join('\n');
const FONTS = () => `<style id="lt-fonts" data-license="${FONT_LICENSE}">\n${fontFaces()}\n</style>`;

const ICON = {
  logo: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4 17 H8 V7 H20" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="1.5 1.5"/><path d="M4 17 H8 C10 4 12 4.5 14 8.2 C15.5 11 17 6.5 20 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  undo: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3 L2.5 6.5 L6 10 M2.5 6.5 H10 a3.5 3.5 0 0 1 0 7 H7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  redo: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 L13.5 6.5 L10 10 M13.5 6.5 H6 a3.5 3.5 0 0 0 0 7 H9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  lock: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 7 V5 a2.5 2.5 0 0 1 5 0 V7" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
};

const HELP = `
<h2 id="help-title">Loop Tuner</h2>
<p>An oscilloscope for control loops. The display shows the signals of the loop; you set the loop up in the tabs below, one step at a time: the Input tab makes the signals, the Plant tab wires the system as a block diagram, the Controller tab chooses and tunes its controllers, the Auto-tune tab improves them by simulation. Earlier runs stay faded on the display for five runs, so a change can be compared with before.</p>
<h3 class="label">Display</h3>
<div class="keys">
  <span><kbd>R</kbd></span><span>Run / Stop. Running sweeps the record at the speed set in the header (1×: real time), over and over. With an External plant, Run and Stop start and stop it.</span>
  <span><kbd>S</kbd></span><span>Single: one sweep, then stop. Pressed while running, the sweep under way finishes, then the scope stops.</span>
  <span><kbd>E</kbd></span><span>E-STOP, with an External plant connected (also the red key in the header)</span>
  <span><kbd>H</kbd></span><span>Hold, while a live plant runs: the screen freezes, the plant and the live record go on</span>
  <span><kbd>A</kbd></span><span>Auto Scale: fit the timebase and every channel to the data</span>
  <span>Knobs</span><span>Drag, scroll, or focus and use the arrow keys. Double-click a Position knob to zero it. Click a readout to type a value (20m, 100 ms).</span>
  <span>Lit keys</span><span>A key that is lit is on or chosen, everywhere on the page: the display mode, the open tab, the signal or variant you edit. Run/Stop is lit green while running and red while stopped; Single amber while it sweeps.</span>
  <span>Channel keys</span><span>Under Vertical and under the screen, the same keys: lit in the channel's colour while the channel is on. Press one to select it for the Vertical knobs (a bar under its number marks it); press the selected one again to turn it off</span>
  <span>Wheel</span><span>On the plot: zoom time and values around the cursor. On the time axis or the value axis: that axis only.</span>
  <span>Drag</span><span>Pan. Click a trace or its marker first to move and zoom that line alone; <kbd>Esc</kbd> releases it.</span>
  <span><kbd>Shift</kbd> + drag</span><span>Zoom to the marked box; a flat band zooms time only, a narrow band values only</span>
  <span>Separators</span><span>Drag the gaps between display, controls and tabs to resize; double-click to reset</span>
  <span>Measure</span><span>Vertical › Measure: a line under the screen for the selected channel with its mean, rms, ac rms, peak to peak, total variation per second (TV, how far it travels: an actuator's wear) and reversals per second (turns larger than a tenth of a division), over what the screen shows. A waveform with fewer than 10 samples per period is marked under-resolved: its rms is then wrong.</span>
  <span>Spectrogram levels</span><span>The strip at the right edge: a histogram of the amplitudes shown (dB) beside the colour bar. Below the floor is black, above the ceiling the brightest colour. Drag a handle or the band between them; the wheel moves the floor, <kbd>Shift</kbd> + wheel the ceiling; double-click for automatic levels (the floor 10 dB above the median, the noise). Levels belong to the signal shown; Run Control › Levels types them (↑ ↓: 1 dB, Shift: 10 dB).</span>
</div>
<p><b>Speed</b>, in the header, sets how fast simulated time runs: 1× is real time, 10× ten times faster, 0.1× slower; type any factor, or -1 or inf for <b>∞</b>, as fast as possible. No speed runs faster than this page simulates the screen (timed after each change); ∞ runs at that, so it depends on the system and on the time per division (a finer screen takes more steps per second). Beside it, the speed achieved over the last second; its tooltip gives the simulation's speed. Auto-tune runs at it too. With a live plant connected it stays at 1× (a lock shows it): the plant owns the clock.</p>
<p>The screen is the record: what you see is simulated and swept, at that speed. <b>Save ▾</b>, under the screen, stores it: every signal as CSV or JSON, <b>Screenshot (PNG)</b> (the screen with its status line and channel keys), or <b>Copy image</b> to the clipboard. <b>Open…</b> shows a saved trace dashed on the channels with the same names, until you clear it (<b>ref ✕</b>); <b>◀ ▶</b> step through one longer than the screen.</p>
<h3 class="label">Signal generator</h3>
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
<h3 class="label">Plant</h3>
<p>The plant is a block diagram. Drag blocks in from the library (or click to add), drag from an output to an input to wire them, click a block to set its parameters on the right. <b>Source</b> blocks play a signal made in the Input tab; <b>Sink</b> blocks (x, speed, …) can be shown on any channel. Double-click a <b>Controller</b> block to open it in the Controller tab. Shift-drag or Shift-click to select several, <kbd>Ctrl</kbd> <kbd>G</kbd> to group them into a subsystem, double-click a subsystem to open it, <kbd>Esc</kbd> to go back up. A subsystem can be saved to My blocks. Double-click a Switch to move it to its next input. Wheel zooms the canvas; dragging the background pans.</p>
<p>A plant can also have <b>2D views</b> (Diagram | views above the canvas), set in the project's JSON: they move with the signals, following the scope's scan line (press <b>Single</b> for one run from t = 0) or your cursor. A robot has a <b>3D view</b> drawn from its description (URDF): the arm posed by its joint angles, the reference path dashed and the tool's trail; drag to orbit, right-drag or <kbd>Shift</kbd>-drag to pan, the wheel zooms, <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> <kbd>Q</kbd> <kbd>E</kbd> fly, the cube in the corner picks a view.</p>
<p>A wire may carry a <b>vector</b> (drawn double, with its count): <b>Mux</b> joins signals, <b>Demux</b> splits them, a Sink on it records one signal per element (q → q1 … q6). The Math blocks Matrix Gain, Product, Solve and Norm work on vectors and matrices, and the <b>Robot</b> group's blocks (forward kinematics, Jacobian, mass matrix, inverse dynamics, the damped inverse, frame transforms, joint limits) read the robot's URDF. Try <b>PUMA 560, a circle in space</b>.</p>
<h3 class="label">Controller</h3>
<p>A Controller block takes the reference r and the measurements, and drives the plant at its sample time Ts. It holds <b>variants</b>, implementations with the same inputs and output: click one to run it. Edit the running variant's parameters (the wheel over a number nudges it by 5 %, Shift 1 %; in a list such as Q, click into a value first), or add a variant from the library.</p>
<p>Variants <b>from the plant</b> (LQR, PI from the plant, PID + feedforward from the plant, swing-up with an LQR catch, the planned swing-up, and an Observer's Kalman filter) hold only inputs (weights, levels, times, limits and hand gains such as a feedforward or the swing-up's energy gain): their numbers are computed in the page from the plant as it is wired, every time it changes. The <b>Computed</b> box shows what was computed, from which plant, and why a design was refused (the block then puts out u = 0). A plan takes a few seconds and is made in the background: until it is ready the block puts out u = 0, or runs its previous plan, and the box shows the progress, with <b>Cancel</b>; the display then takes the new run from its start. <b>Copy as numbers</b> turns the numbers into a hand variant, which no longer follows the plant. Variants <b>by hand</b>: PID, state feedback, gain-scheduled PI, energy swing-up, relay (on/off), sliding mode, super-twisting; for an Observer, a Kalman filter on a model you give (for a plant the page cannot see), a Luenberger observer and finite differences. The sliding modes read the measured rate on input 3. A Controller with <b>lanes</b> runs one law per element of its vector inputs (the PUMA's six axis loops), each lane's numbers computed for that lane; its <b>ff</b> input adds a feedforward (the torque the arm's model says the motion takes) inside the limits. <b>Speed PI from the plant</b> puts each lane's speed loop at a bandwidth ω you choose. Try <b>DC motor, sliding mode</b>: its XY view is the phase portrait, and the line's slope λ sets how the error decays.</p>
<h3 class="label">Auto-tune</h3>
<p>Improves a Controller block's running variant by simulation, into a new variant (the original stays to compare). <b>Iterate</b> runs the loop again and again, keeping gains that lower the cost (IAE, ITAE or ISE of r − y, plus effort and overshoot beyond a bound): watch each improvement on the display and the cost fall in the plot. <b>Relay</b> makes the loop oscillate to find its ultimate gain and period, then applies a rule (Ziegler–Nichols, Tyreus–Luyben, no overshoot). <b>Step response</b> fits a lag and a dead time and tunes a PI by SIMC. Every run the tuner tries sweeps across the display at the header's <b>Speed</b> and lasts its own length, one period of the input, whatever the screen shows (a 5 s run takes 5 s at 1×, half a second at 10×); at ∞ it computes as fast as it can and shows each improvement. The scope's Stop stops the tuning too. One <kbd>Ctrl</kbd> <kbd>Z</kbd> undoes a whole run. Try it on <b>Oven, badly tuned</b>. A relay or step result that scores worse than what runs, or that is unstable where the run starts, is added but does not run. A variant from the plant is tuned as its Copy as numbers twin, from the numbers its design computes now, and the result is a hand variant beside it; a planned swing-up has no gains to tune (change its inputs in the Controller tab).</p>
<h3 class="label">Analysis</h3>
<p>The loop a Controller block closes, linearised from the plant it sees, with the running variant's own law: whether it is stable, its gain, phase and delay margins, Ms, the poles, root locus, Bode, Nyquist and the linear step, discrete at the block's Ts as it runs. <b>At rest</b>, <b>Start</b> or <b>Scope time</b> picks where it is linearised (the scope's time follows the cursor or the sweep). A law that has no linear model there (a relay, the ideal sliding mode, super-twisting, a swing-up pumping energy), a plan not made yet, or a plant outside the page is named, with the reason. A kink at that point (the empty tank at rest) has no slope to draw: it is refused, saying where to look instead. Where u sits at a limit, the linear loop does not hold: it says so first and grades nothing.</p>
<h3 class="label" id="help-live">Live (HIL)</h3>
<p>A system with an <b>External plant</b> block (Plant tab, group Live) runs against a plant outside the page, in real time; <b>HIL: an external plant</b> in the System library is made for it. Its plant, <b>hil-plant.zip</b> (Plant tab, <b>Download the plant (zip)</b>), stands in for real hardware: it simulates a model of the System library with this page's own code (by default a DC motor swinging an arm; <code>--model NAME</code> another, <code>--list</code> lists them, <code>--random</code> one at random), varies its physics by up to 15 % and switches its effects (friction, ripple, a resonance) at random, and tells the page only its inputs and outputs: the page has to identify it. Replace it with your device behind the same protocol, in any language. To run it, unzip it and run <code>sh runme.sh</code> (Linux, macOS) or double-click <code>runme.cmd</code> (Windows; it runs <code>runme.ps1</code>); they install what it needs (uv, which brings its own Python, websockets and the V8 engine that runs this page's code) and start it, in a window with a red <b>STOP</b> that also says where it listens. Then <b>Connect</b> in the Plant tab.</p>
<p>Nothing runs by itself. Offline the scope stands still and says OFFLINE. Connect opens the link and reads the plant's ports; the plant stays stopped. <b>Run</b> starts the plant and the sweep: first every reference moves to its waveform's first value at no more than 10 % of its full scale per second (the status line counts down), then the loop runs. Every channel spans its signal's full scale, for orientation. <b>Stop</b> stops both; <b>Single</b> runs one sweep and stops the plant (pressed while running, the sweep under way finishes first). <b>Hold</b> (<kbd>H</kbd>) freezes the screen while the plant runs on. Tune the controller meanwhile: a parameter takes effect at the next sample. A variant from the plant does not run against an External plant (the page has no model of a plant outside it): it puts out u = 0 and says why; a Kalman filter on a model you give does run.</p>
<p><b>E-STOP</b> (the red key in the header, or <kbd>E</kbd>), <b>STOP</b> in the plant's window, or 10 silent cycles on either side stop it (safe inputs) until <b>Reset</b>: a STOP pressed at the plant is reset at the plant, the page's E-STOP on the page. The plant tells the page when it stops or starts at its own keys, and the page follows at once. In <b>reference mode</b> (<b>HIL: an external plant, reference mode</b>, with the plant started as <code>sh runme.sh --mode reference</code>) the plant runs its model's own controller and the page sends the references: the page's controllers and Auto-tune are not in the loop. With <code>--dyno</code> the plant also offers its model's disturbances as inputs. <b>Rec</b> keeps the last minutes of every live signal (click the length to change it); Save ▾ › Live record writes them. <b>Live settings</b> in the Plant tab set the ramp-in and the references' full scales, saved with the system.</p>
<h3 class="label">System library</h3>
<p>Complete example systems, from a mass–spring–damper to a triple pendulum and a six-axis robot arm, each with its input, plant and controllers. Load a whole system, or only one part of it, for example the input of one system with the plant of another. Each card says in a few words what the system is and what to try; <b>Details</b> opens its full description, which the Plant tab keeps under <b>About this system</b> once it is loaded.</p>
<h3 class="label">Files</h3>
<p>The project is one JSON document, including how the display is set. Save it, open it, drop it on the page or paste it. <b>Export HTML</b> writes this page with the project inside, to send to someone.</p>
<p>Shown in a limited environment, such as a file preview that runs the page in a sandbox, a warning below the header stays, says what does not work there, and what to do: download the file and open it in your browser.</p>
<h3 class="label" id="help-for-agents">For agents</h3>
<p>Everything a person does here an agent can do through <code>window.loopTuner</code>: <code>loopTuner.help()</code> returns this guide as data, <code>loopTuner.api</code> lists every method. (In the Loop Tuner repository, <code>node cli.mjs help</code> gives the command line's own help.)</p>
<pre class="guide" id="help-agents"></pre>
<h3 class="label">Credits</h3>
<p>Type: IBM Plex Sans Condensed and IBM Plex Mono, copyright IBM Corp., under the SIL Open Font License 1.1, carried in this page.</p>
<p><button class="btn" id="help-close">Close</button></p>`;

const SHELL = `<div id="lt-shell" class="app">
<p class="sr-only" id="agent-note">${AGENT_NOTE}</p>
<header class="bar">
  <div class="brand">${ICON.logo}Loop Tuner</div>
  <input id="title" class="field field-lg field-inline" aria-label="Project title" spellcheck="false">
  <span id="loopnote" class="hint mono"></span>
  <div class="actions">
    <div class="speed" id="speed" role="group" aria-label="Speed of simulated time">
      <label class="flabel" for="speed-in">Speed</label>
      <div class="seg popwrap"><span class="speed-lock" title="Held at 1×: a live plant is connected">${ICON.lock}</span><input id="speed-in" class="field" spellcheck="false" autocomplete="off" aria-describedby="speed-got"><button type="button" id="speed-menu" class="btn btn-icon" aria-haspopup="menu" aria-expanded="false" aria-controls="speed-pop" aria-label="Speed presets">▾</button><div id="speed-pop" class="popover menu speed-pop" role="menu" aria-label="Speed presets" hidden></div></div>
      <span id="speed-got" class="speed-got muted mono">–</span>
    </div>
    <span class="sep"></span>
    <div class="popwrap"><button id="syslib" class="btn" aria-haspopup="true" aria-expanded="false" title="Complete systems: load one whole, or only its input, plant or controller">System library ▾</button><div id="syslib-pop" class="popover" hidden></div></div>
    <button id="estop" class="btn btn-danger btn-estop" type="button" aria-label="Emergency stop (E)" data-state="off" hidden disabled>E-STOP</button>
    <span class="sep"></span>
    <button id="undo" class="btn btn-icon" title="Undo (Ctrl+Z)" aria-label="Undo">${ICON.undo}</button>
    <button id="redo" class="btn btn-icon" title="Redo (Ctrl+Shift+Z)" aria-label="Redo">${ICON.redo}</button>
    <span class="sep"></span>
    <button id="open" class="btn" title="Open a project (.json, or an exported .html)">Open…</button>
    <button id="save" class="btn" data-standalone title="Download the project as JSON (Ctrl+S)">Save JSON</button>
    <button id="export" class="btn" data-standalone title="Download this page with the project inside, to send to someone">Export HTML</button>
    <button id="copy" class="btn" title="Copy the project JSON">Copy JSON</button>
    <button id="copy-html" class="btn" data-framed title="Copy a standalone HTML page with the project inside">Copy HTML</button>
    <button id="help" class="btn btn-icon" title="Help and keyboard shortcuts (?); for agents: loopTuner.help()" aria-label="Help, and a guide for agents: loopTuner.help()">?</button>
    <input type="file" id="file" accept=".json,.html,application/json,text/html" hidden>
  </div>
  <div id="lt-limited" class="banner limited" data-lamp="warn" role="alert">
    <span class="banner-icon" aria-hidden="true">⚠</span>
    <div class="banner-text"><b>Warning: limited environment.</b> This page is running in a limited environment, such as a file preview, and its performance is degraded: saving and the autosave, downloads and Live (HIL) do not work here, and it may run slower. For full function, <b>download this file and open it in your browser.</b> <span id="lt-limited-why"></span></div>
  </div>
</header>
<main class="instrument">
  <section class="display bezel" id="display" aria-label="Display">
    <div class="status on-dark"></div>
    <div class="screen"></div>
    <div class="chbar on-dark" role="group" aria-label="Channels"></div>
  </section>
  <div class="split split-v" id="split-v" role="separator" aria-orientation="vertical" aria-label="Resize the controls" tabindex="0" title="Drag to resize · double-click to reset"></div>
  <aside class="controls panel" id="controls" aria-label="Controls"></aside>
</main>
<div class="split split-h" id="split-h" role="separator" aria-orientation="horizontal" aria-label="Resize the setup area" tabindex="0" title="Drag to resize · double-click to reset"></div>
<section class="setup" aria-label="Setup">
  <div class="tabbar" id="tabbar" role="tablist" aria-label="Setup"></div>
  <div class="tabpanel panel">
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
  const body = `${SHELL}\n${project ? jsonScript(project) : '<script type="application/json" id="loop-tuner-project"></script>'}\n${vendorBlock()}\n<script id="lt-script">${js}</script>`;
  if (fragment) {
    // Only the hosted page gets the host's save adapter; the standalone page
    // (and every page it exports) knows nothing of the host.
    const host = '<script id="lt-host">window.__ltHost = { saver: () => window.claude?.use?.(\'downloads\') ?? Promise.resolve(null) };</script>';
    return `<title>${esc(title)}</title>\n<meta name="description" content="${esc(AGENT_NOTE)}">\n<meta name="claude:viewport-fit-sides" content="cover">\n${FONTS()}\n<style id="lt-style">${css}</style>\n${host}\n${limitedCheck()}\n${body}\n`;
  }
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<title>${esc(title)}</title>\n<meta name="description" content="${esc(AGENT_NOTE)}">\n${FONTS()}\n<style id="lt-style">${css}</style>\n${limitedCheck()}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync(join(ROOT, 'dist'), { recursive: true });
  const standalone = buildHtml();
  writeFileSync(join(ROOT, 'dist/loop-tuner.html'), standalone);
  writeFileSync(join(ROOT, 'dist/artifact.html'), buildHtml({ fragment: true }));
  // The plant's zip, unpacked: hil/ and the page's own core, as the page zips them.
  const plant = join(ROOT, 'dist/hil-plant');
  mkdirSync(plant, { recursive: true });
  for (const f of HIL_FILES) writeFileSync(join(plant, f), readFileSync(join(ROOT, 'hil', f)), { mode: f.endsWith('.sh') ? 0o755 : 0o644 });
  writeFileSync(join(plant, CORE_FILE), simulatorCore(bundleScript()));
  console.log(`dist/loop-tuner.html  ${(standalone.length / 1024).toFixed(0)} KB`);
}
