// The page's own documentation for an agent that has only a browser on it
// (design/output/hil.md, "For agents"): window.loopTuner.help() returns GUIDE,
// help('text') the same as text, which is also the Help dialog's "For agents"
// section; window.loopTuner.api lists the methods. One source, so the three
// never disagree. No DOM. Nothing in here may say where the page was made
// (test/provenance.test.mjs).

const M = (name, args, does, example, returns = '') => ({ name, args, does, example, ...(returns ? { returns } : {}) });

export const GUIDE = {
  title: 'Loop Tuner: a guide for agents',
  about: 'Loop Tuner is an oscilloscope for control loops in one HTML page. The display shows the signals; the tabs below set the loop up: Input (signals), Plant (a block diagram), Controller, Auto-tune, Analysis. Everything a person does here an agent can do through window.loopTuner, in plain JSON, and read back from the page: every Live control has a stable id, an accessible name and its state in data-* attributes.',
  start: [
    'Read loopTuner.help() (this guide) and loopTuner.api (every method in one line).',
    'loopTuner.systems() lists the System library; loopTuner.loadSystem(name) loads one whole.',
    'loopTuner.getProject() returns the project (JSON); change it and give it back with setProject(p), or change one controller with setGains(block, params).',
    'loopTuner.run(), stop(), single() are the scope keys; loopTuner.record.screen("csv") reads every signal on the screen.',
  ],
  api: [
    M('loopTuner.help(format?)', 'format: "text" for plain text', 'This guide: an object, or text.', 'loopTuner.help("text")'),
    M('loopTuner.api', '', 'Every method: [{ name, does }].', 'loopTuner.api.map((m) => m.name)'),
    M('loopTuner.systems()', '', 'The System library: [{ name, tags, notes }].', 'loopTuner.systems().map((s) => s.name)'),
    M('loopTuner.loadSystem(name, parts?)', 'name: a library name; parts: ["input", "plant", "controller"] (default all)', 'Loads a system, as the System library\'s Load does (one undo step).', 'loopTuner.loadSystem("HIL: external motor")'),
    M('loopTuner.getProject()', '', 'The project, as the file stores it.', 'const p = loopTuner.getProject()'),
    M('loopTuner.setProject(p)', 'p: a project', 'Loads a project; returns it normalised.', 'loopTuner.setProject(p)'),
    M('loopTuner.setGains(block, params)', 'block: a Controller block\'s id path ("ctrl", "motor/ctrl"); params: { Kp: 3, ... }', 'Changes the running variant\'s parameters (one undo step). While live, they act at the next sample and the controller keeps its state.', 'loopTuner.setGains("ctrl", { Kp: 8, Kd: 0.5 })', 'the variant: { name, type, params }'),
    M('loopTuner.addComponent(c)', 'c: { type, params }', 'Adds a waveform component to the signal the Input tab edits.', 'loopTuner.addComponent({ type: "step", params: { amplitude: 1, time: 0.5 } })'),
    M('loopTuner.reference()', '', 'The reference r over the screen: { t, r }.', 'loopTuner.reference().r.length'),
    M('loopTuner.autoScale()', '', 'Auto Scale: one period across the screen, every channel fitted (with a live plant, offline: its full scales).', 'loopTuner.autoScale()'),
    M('loopTuner.run()', '', 'Run. With an External plant: starts the plant (connected first), the references ramp in, then the loop runs.', 'loopTuner.run()'),
    M('loopTuner.stop()', '', 'Stop. With an External plant: stops it (safe inputs, not latched).', 'loopTuner.stop()'),
    M('loopTuner.single()', '', 'Single: one sweep, then stop. Pressed while running, the sweep under way finishes, then it stops (live: then the plant stops).', 'loopTuner.single()'),
    M('loopTuner.speed(x?)', 'x: a factor, or -1 for as fast as possible', 'How fast simulated time runs; held at 1 while a plant is connected.', 'loopTuner.speed(10)', '{ speed, effective, achieved, simulation, locked }'),
    M('loopTuner.selectCandidate(name)', 'name: a candidate', 'Older projects with candidates: runs one.', 'loopTuner.selectCandidate("PID")'),
    M('loopTuner.autotune(opts)', 'opts: { block, method: "iterate" | "relay" | "step", goal, rule, simc, apply }', 'Auto-tunes a Controller block by simulation; refused for an External plant (the page has no model of it).', 'loopTuner.autotune({ method: "step" })', 'a report: { ok, why, before, after, ... }'),
    M('loopTuner.live.state()', '', 'The live link: state ("offline", "connecting", "open", "running"), estop ({ by, reason } or null), mode ("control", "reference", "log"), the plant\'s ports, ramp ({ left, to } while the references ramp in), link and plant figures, hold.', 'loopTuner.live.state().state'),
    M('loopTuner.live.connect(url?)', 'url: default the block\'s, ws://127.0.0.1:8765', 'Opens the link and reads the plant\'s description. Nothing starts: the plant stays stopped until Run.', 'await loopTuner.live.connect()', 'a promise of state()'),
    M('loopTuner.live.disconnect()', '', 'Stops the plant, then closes the link.', 'loopTuner.live.disconnect()'),
    M('loopTuner.live.estop()', '', 'E-STOP: the plant applies its safe inputs and stays stopped until Reset.', 'loopTuner.live.estop()'),
    M('loopTuner.live.reset()', '', 'Clears an E-stop (either side). The plant stays stopped; Run goes on, the controllers afresh.', 'loopTuner.live.reset()'),
    M('loopTuner.live.hold(on?)', 'on: true or false (default: toggle)', 'Freezes the screen while the plant runs on (the live record goes on too). The key H does the same.', 'loopTuner.live.hold(true)'),
    M('loopTuner.live.settings(s?)', 's: { ramp: % of full scale per second, scales: { r: [lo, hi] } }', 'The ramp-in and the full scales of the references (one undo step); returns them.', 'loopTuner.live.settings({ ramp: 20 })'),
    M('loopTuner.live.downloadPlant()', '', 'Saves hil-plant.zip (the plant script, runme.sh, runme.ps1, README.txt).', 'await loopTuner.live.downloadPlant()', 'a promise: true once the file is on its way'),
    M('loopTuner.live.plantFiles()', '', 'The files of hil-plant.zip as text: { name: text }.', 'loopTuner.live.plantFiles()["README.txt"]'),
    M('loopTuner.record.state()', '', 'The live record (seconds kept, signals) and the references shown.', 'loopTuner.record.state()'),
    M('loopTuner.record.screen(format?)', 'format: "csv" (default) or "json"', 'Every signal on the screen (not only those on channels), as text.', 'loopTuner.record.screen("csv")'),
    M('loopTuner.record.live(format?)', 'format: "csv" or "json"', 'The live record: the last minutes of every live signal, across runs.', 'loopTuner.record.live("csv")'),
    M('loopTuner.record.save(what?, format?)', 'what: "screen" or "record"; format: "csv", "json" or "png" (screen only)', 'Saves a file through the page (a download).', 'await loopTuner.record.save("screen", "csv")', 'a promise: true once the file is on its way'),
    M('loopTuner.record.screenshot()', '', 'A picture of the screen with its status line and channel badges, at the device pixel ratio.', 'await loopTuner.record.screenshot()', 'a promise of a data: URL (PNG)'),
    M('loopTuner.record.reference(text, name?)', 'text: a saved CSV or JSON trace', 'Shows a saved trace dashed on the channels with the same names.', 'loopTuner.record.reference(csv, "before")'),
    M('loopTuner.record.clearReferences()', '', 'Removes the references.', 'loopTuner.record.clearReferences()'),
  ],
  dom: [
    '#lt-shell carries data-run (run, stop, single), data-live (none, offline, connecting, open, running, estop) and data-hil-mode (control, reference, log) when the system has an External plant.',
    'Header: #estop, the E-STOP key (data-state: armed, latched, off); #syslib, the System library; #speed-in, the speed.',
    'Run Control: #k-run (Run/Stop), #k-single, #k-auto. The scope\'s status line (#display .status) has data-run, data-live and data-ramp, and says LIVE, CONNECTED, E-STOP and its reason, OFFLINE, HOLD or "ramping to r0: 2.1 s left".',
    'Plant tab, right-hand panel, #live (data-state, data-mode): #live-download (Download the plant (zip)), #live-connect (Connect / Disconnect), #live-reset, #live-hold, #live-url (where the plant listens), #live-status (data-rate, data-rtt, data-missed), #live-mode (what the page sends), #live-ramp and #live-scale-NAME (Live settings).',
    'Save ▾ under the screen: #rc-save; Help: #help (the ? key), which has this guide under For agents.',
  ],
  live: {
    what: 'A system with an External plant block runs against a plant outside the page, in real time. HIL: external motor is made for it: its plant is a simulated DC motor swinging an unbalanced arm, standing in for real hardware. Replace it with your device behind the same protocol, in any language.',
    setup: [
      'Load the system: loopTuner.loadSystem("HIL: external motor") (or "HIL: external motor, reference mode"). It opens stopped and OFFLINE: nothing runs until the plant is connected and Run is pressed.',
      'Get the plant: loopTuner.live.downloadPlant() saves hil-plant.zip (Plant tab: Download the plant (zip)). loopTuner.live.plantFiles() has its files as text.',
      'Start it on the computer the browser runs on: unzip, then sh runme.sh (Linux, macOS) or runme.ps1 (Windows: right-click, Run with PowerShell). They install uv if it is missing, which brings Python and the websockets package, then start the plant. With uv: uv run hil_plant.py. For the reference mode system: sh runme.sh --mode reference. A window opens with a red STOP, Run/Stop and the link\'s state; without a display the console takes s (stop), r (run), e (E-stop), x (reset). An agent with only a browser asks someone at that computer to run it.',
      'Connect: await loopTuner.live.connect(). state() is then "open": the link is up, the plant is stopped and applies its safe inputs.',
      'Run: loopTuner.run(). The references first ramp from where the plant is to their first value at no more than 10 % of full scale per second (state().ramp says how long is left), then the loop runs; state() is "running" and its link figures fill in.',
      'Tune while it runs: loopTuner.setGains("ctrl", { Kp: 8 }) (the controller keeps its state); read loopTuner.record.screen("csv") or record.live("csv").',
      'Stop: loopTuner.stop(). E-STOP: loopTuner.live.estop() (or the header key, or E), then live.reset() and Run again. A STOP at the plant shows at once: state().estop.by is "plant".',
      'Save: await loopTuner.record.save("record", "csv") (the live record) or ("screen", "png"). Disconnect: loopTuner.live.disconnect().',
    ],
    modes: 'The plant declares its inputs in describe, and the page follows. Control mode (inputs are efforts): the page is the controller and sends the control effort u every cycle, with the reference r and the error e for the plant\'s log only. Reference mode (an input is a reference): the plant runs its own controller with its own limits and monitoring; the page sends the references and records what comes back, the plant\'s own u included; the page\'s controllers and Auto-tune are not in the loop. A plant without inputs only reports: the page answers each cycle with an empty u, so its watchdog sees a live page.',
    protocol: 'JSON-RPC 2.0 over a WebSocket, one message per text frame, at ws://127.0.0.1:8765 by default; the plant is the server and owns the clock. Requests from the page: describe (the plant\'s name, rate_hz, watchdog_cycles, inputs [{ name, unit, min, max, safe, kind, measures }], outputs [{ name, unit, min, max }], running, estop), start (params { log: [{ name, unit }] }: what each u also carries for the plant\'s log), stop, reset, estop ({ reason }). Every cycle the plant sends y { seq, t, y: [...] } and the page answers at once with u { seq, u: [...], log: [...] }. The plant also sends estop { reason, t }, running { running, by, reason } when it starts or stops by itself, and status once a second (rate, jitter, round trip, late, dropped). Values are in the units describe gives; min and max are full scales.',
    safety: 'The plant is the safety authority: it clamps every input to its limits, and if 10 of its cycles go unanswered, the page goes away, an output leaves its range, or STOP is pressed, it applies its safe inputs and latches an E-stop until reset. The page stops too: E-STOP, and its own watchdog (no y for 10 cycles). Ctrl+C at the plant ends it cleanly. The plant may also limit how fast its inputs change (--slew).',
    plant: 'The plant script varies its physics by up to 15 % at every start (--vary 0.15; --seed N repeats one; --show-params prints it) and never tells the page: the page has to identify it, as it would a real device. --plant heater runs a second, simpler plant; --log FILE.csv writes every cycle and event; --bench S measures the link for S seconds; --help lists everything.',
  },
  errors: [
    ['no plant answered at that address', 'The plant is not running, or listens elsewhere (state().detail, #live-url); or the host of this page blocks connections to the computer: save the page (Export HTML or Copy HTML) and open the file in a browser.'],
    ['busy: another page is connected', 'One page at a time: close the other one.'],
    ['origin not allowed', 'The plant refuses pages from web sites; start it with --allow-origin ORIGIN (its console says which).'],
    ['E-STOP is latched', 'Reset first (loopTuner.live.reset()), then Run.'],
    ['Offline: connect the plant first', 'Run with an External plant needs the link: loopTuner.live.connect().'],
    ['plant silent for N cycles', 'The page heard no y for its watchdog: the plant stalled or the link broke.'],
    ['no u for 10 cycles', 'The plant heard no answer: the page was blocked (on the page instead of a worker, or a background tab).'],
    ['connection lost', 'The link closed while running; the plant has stopped itself.'],
    ['STOP pressed at the plant', 'Someone pressed STOP in the plant\'s window or console.'],
    ['the plant was shut down', 'Ctrl+C or its window closed.'],
    ['the arm turned more than a full turn', 'The plant\'s monitoring: an output left its range.'],
    ['the plant speaks another protocol', 'Connected anyway; messages may not fit.'],
  ],
};

// Every method in one line, for window.loopTuner.api.
export const apiList = (g = GUIDE) => g.api.map(({ name, does }) => ({ name, does }));

// The guide as plain text (help('text') and the Help dialog's For agents).
export function guideText(g = GUIDE) {
  const out = [g.title, '', g.about, '', 'Start', ...g.start.map((s) => `- ${s}`), '', 'Methods'];
  for (const m of g.api) out.push(`- ${m.name}${m.args ? ` (${m.args})` : ''}: ${m.does}${m.returns ? ` Returns ${m.returns}.` : ''} Example: ${m.example}`);
  out.push('', 'Reading the page without JavaScript', ...g.dom.map((s) => `- ${s}`));
  out.push('', 'Live (HIL)', g.live.what, '', 'Setup, step by step', ...g.live.setup.map((s, i) => `${i + 1}. ${s}`));
  out.push('', `Modes. ${g.live.modes}`, '', `Protocol. ${g.live.protocol}`, '', `Safety. ${g.live.safety}`, '', `The plant. ${g.live.plant}`);
  out.push('', 'What messages mean', ...g.errors.map(([m, means]) => `- "${m}": ${means}`));
  return out.join('\n');
}
