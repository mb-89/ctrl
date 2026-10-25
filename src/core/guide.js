// The page's own documentation for an agent that has only a browser on it
// (design/output/hil.md, "For agents"): window.loopTuner.help() returns GUIDE,
// help('text') the same as text, which is also the Help dialog's "For agents"
// section; window.loopTuner.api lists the methods. One source, so the three
// never disagree. No DOM. Nothing in here may say where the page was made
// (test/provenance.test.mjs).

const M = (name, args, does, example, returns = '') => ({ name, args, does, example, ...(returns ? { returns } : {}) });

// One line every page carries where an agent looks first (the head's
// description, a line for screen readers, the Help key's name).
export const AGENT_NOTE = 'Loop Tuner: an oscilloscope for control loops in one page. For agents: window.loopTuner.help() returns a guide to this page and its API (also in Help, For agents).';

export const GUIDE = {
  title: 'Loop Tuner: a guide for agents',
  about: 'Loop Tuner is an oscilloscope for control loops in one HTML page. The display shows the signals; the tabs below set the loop up: Input (signals), Plant (a block diagram), Controller, Auto-tune, Analysis. Everything a person does here an agent can do through window.loopTuner, in plain JSON, and read back from the page: every Live control has a stable id, an accessible name and its state in data-* attributes.',
  start: [
    'Read loopTuner.help() (this guide) and loopTuner.api (every method in one line).',
    'loopTuner.systems() lists the System library; loopTuner.loadSystem(name) loads one whole.',
    'loopTuner.getProject() returns the project (JSON); change it and give it back with setProject(p), or change one controller with setGains(block, params) and pick its variant with setVariant(block, name).',
    'loopTuner.run(), stop(), single() are the scope keys; each returns { ok, why }, why saying why a key was refused. loopTuner.record.screen("csv") reads every signal on the screen.',
    'The last message the page showed stays in #toast[data-last] and loopTuner.live.state().message (a toast is gone after 3 s).',
  ],
  api: [
    M('loopTuner.help(format?)', 'format: "text" for plain text', 'This guide: an object, or text.', 'loopTuner.help("text")'),
    M('loopTuner.api', '', 'Every method: [{ name, does }].', 'loopTuner.api.map((m) => m.name)'),
    M('loopTuner.systems()', '', 'The System library: [{ name, tags, notes }].', 'loopTuner.systems().map((s) => s.name)'),
    M('loopTuner.loadSystem(name, parts?)', 'name: a library name; parts: ["input", "plant", "controller"] (default all)', 'Loads a system, as the System library\'s Load does (one undo step).', 'loopTuner.loadSystem("HIL: an external plant")'),
    M('loopTuner.getProject()', '', 'The project, as the file stores it.', 'const p = loopTuner.getProject()'),
    M('loopTuner.setProject(p)', 'p: a project', 'Loads a project; returns it normalised.', 'loopTuner.setProject(p)'),
    M('loopTuner.setGains(block, params)', 'block: a Controller block\'s id path ("ctrl", "motor/ctrl"); params: { Kp: 3, ... }', 'Changes the running variant\'s parameters (one undo step). While live, they act at the next sample and the controller keeps its state. A name the variant does not have throws, listing the names it has.', 'loopTuner.setGains("ctrl", { Kp: 8, Kd: 0.5 })', 'the variant: { name, type, params }'),
    M('loopTuner.setVariant(block, name)', 'block: a Controller block\'s id path; name: a variant\'s name (or its index)', 'Picks the variant that runs (one undo step), as the Controller tab does. While live, the new variant starts afresh at the next cycle. An unknown name throws, listing the variants.', 'loopTuner.setVariant("ctrl", "PD")', 'the variant: { name, type, params }'),
    M('loopTuner.addComponent(c)', 'c: { type, params }', 'Adds a waveform component to the signal the Input tab edits.', 'loopTuner.addComponent({ type: "step", params: { amplitude: 1, time: 0.5 } })'),
    M('loopTuner.reference()', '', 'The reference r over the screen: { t, r }.', 'loopTuner.reference().r.length'),
    M('loopTuner.autoScale()', '', 'Auto Scale: one period across the screen, every channel fitted (with a live plant, offline: its full scales).', 'loopTuner.autoScale()'),
    M('loopTuner.run()', '', 'Run. With an External plant: starts the plant (connected first), the references ramp in, then the loop runs. The plant answers a moment later: live.state().pending is "run" until then, then state is "running".', 'loopTuner.run()', '{ ok, why, run, live }: why says why it was refused; run is the scope\'s mode; live is live.state() (null without an External plant)'),
    M('loopTuner.stop()', '', 'Stop. With an External plant: stops it (safe inputs, not latched); always sent to a connected plant.', 'loopTuner.stop()', '{ ok, why, run, live }'),
    M('loopTuner.single()', '', 'Single: one sweep, then stop. Pressed while running, the sweep under way finishes, then it stops (live: then the plant stops).', 'loopTuner.single()', '{ ok, why, run, live }'),
    M('loopTuner.speed(x?)', 'x: a factor, or -1 for as fast as possible', 'How fast simulated time runs; held at 1 while a plant is connected.', 'loopTuner.speed(10)', '{ speed, effective, achieved, simulation, locked }'),
    M('loopTuner.selectCandidate(name)', 'name: a candidate', 'Older projects with candidates: runs one.', 'loopTuner.selectCandidate("PID")'),
    M('loopTuner.autotune(opts)', 'opts: { block, method: "iterate" | "relay" | "step", goal, rule, simc, apply }', 'Auto-tunes a Controller block by simulation; refused for an External plant: the page knows only its interface and needs an identified model first (Identify, to come).', 'loopTuner.autotune({ method: "step" })', 'a report: { ok, why, before, after, ... }'),
    M('loopTuner.designs()', '', 'What each running variant computed from the plant (LQR, PI from the plant, a PID\'s feedforward, the swing-ups, a Kalman filter) holds: its status (ok, warn, pending, error), the computed rows, warnings, and why a design was refused (error: { code, message, hint }; the block then puts out u = 0).', 'loopTuner.designs()', '[{ status, values, rows, warnings, error, ... }]'),
    M('loopTuner.whenDesigned()', '', 'Resolves once no design is being computed in the background (a plan for the planned swing-up takes seconds; meanwhile the block runs u = 0 or its previous plan) and the display shows the run that uses it. Await it before judging a run.', 'await loopTuner.whenDesigned()', 'a promise of designs()'),
    M('loopTuner.loopModel(path, op)', 'path: a Controller block\'s id path; op: "origin" (at rest), "initial" (the start), { y: [levels] } or { t: seconds }', 'The loop the Controller closes, as the Analysis tab draws it: the plant it sees linearised at op, and the running variant\'s own law, as state space. Refused, with the reason, where there is none (a relay, a kink at op, a plant outside the page).', 'loopTuner.loopModel("ctrl", "initial")', '{ plant: { A, B, C, D, delay, ... }, ctrl: { A, B, C, D }, Ts, opLabel, variantName, warnings }'),
    M('loopTuner.live.state()', '', 'The live link: state ("offline", "connecting", "open", "running"), pending ("run" or "stop" while the plant has not answered a key yet), message (the last message the page showed), estop ({ by, reason } or null), mode ("control", "reference", "log"), the plant\'s ports, ramp ({ left, to } while the references ramp in), link and plant figures, hold.', 'loopTuner.live.state().state'),
    M('loopTuner.live.connect(url?)', 'url: default the block\'s, ws://127.0.0.1:8765', 'Opens the link and reads the plant\'s description; resolves once the plant has described itself (or the link failed), so Run can follow at once. Nothing starts: the plant stays stopped until Run.', 'await loopTuner.live.connect()', 'a promise of state()'),
    M('loopTuner.live.disconnect()', '', 'Stops the plant, then closes the link.', 'await loopTuner.live.disconnect()', 'a promise of state() once the link is closed'),
    M('loopTuner.live.estop()', '', 'E-STOP: the plant applies its safe inputs and stays stopped until Reset.', 'await loopTuner.live.estop()', 'a promise of state() once the plant has answered'),
    M('loopTuner.live.reset()', '', 'Clears an E-stop. The plant stays stopped; Run goes on, the controllers afresh. A STOP pressed at the plant is reset at the plant only: the page\'s reset is refused, and state().message says so.', 'await loopTuner.live.reset()', 'a promise of state() once the plant has answered (estop is still set if it refused)'),
    M('loopTuner.live.hold(on?)', 'on: true or false (default: toggle)', 'Freezes the screen while the plant runs on (the live record goes on too). The key H does the same.', 'loopTuner.live.hold(true)'),
    M('loopTuner.live.settings(s?)', 's: { ramp: % of full scale per second, scales: { r: [lo, hi] } }', 'The ramp-in and the full scales of the references (one undo step); returns them.', 'loopTuner.live.settings({ ramp: 20 })'),
    M('loopTuner.live.downloadPlant()', '', 'Saves hil-plant.zip (the plant script, runme.sh, runme.cmd, runme.ps1, README.txt).', 'await loopTuner.live.downloadPlant()', 'a promise: true once the file is on its way'),
    M('loopTuner.live.plantFiles()', '', 'The files of hil-plant.zip as text: { name: text }.', 'loopTuner.live.plantFiles()["README.txt"]'),
    M('loopTuner.record.state()', '', 'The live record (seconds kept, signals) and the references shown.', 'loopTuner.record.state()'),
    M('loopTuner.record.screen(format?)', 'format: "csv" (default) or "json"', 'Every signal on the screen (not only those on channels), as text.', 'loopTuner.record.screen("csv")'),
    M('loopTuner.record.live(format?)', 'format: "csv" or "json"', 'The live record: the last minutes of every live signal, across runs.', 'loopTuner.record.live("csv")'),
    M('loopTuner.record.save(what?, format?)', 'what: "screen" or "record"; format: "csv", "json" or "png" (screen only)', 'Saves a file through the page (a download). Anything else is refused with an error.', 'await loopTuner.record.save("screen", "csv")', 'a promise: true once the file is on its way'),
    M('loopTuner.record.screenshot()', '', 'A picture of the screen with its status line and channel badges, at the device pixel ratio.', 'await loopTuner.record.screenshot()', 'a promise of a data: URL (PNG)'),
    M('loopTuner.record.reference(text, name?)', 'text: a saved CSV or JSON trace', 'Shows a saved trace dashed on the channels with the same names.', 'loopTuner.record.reference(csv, "before")'),
    M('loopTuner.record.clearReferences()', '', 'Removes the references.', 'loopTuner.record.clearReferences()'),
  ],
  dom: [
    '#lt-shell carries data-run (run, stop, single), data-live (none, offline, connecting, open, running, estop) and data-hil-mode (control, reference, log) when the system has an External plant.',
    'Header: #estop, the E-STOP key (data-state: armed, latched, off); #syslib, the System library; #speed-in, the speed; #help, the Help (?) key, which has this guide under For agents.',
    '#toast shows a message for 3 s; its data-last keeps the last one.',
    'Run Control: #k-run (Run/Stop), #k-single, #k-auto. The scope\'s status line (#display .status) has data-run, data-live and data-ramp, and says LIVE, CONNECTED, E-STOP and its reason, OFFLINE, HOLD or "ramping to r0: 2.1 s left".',
    'Plant tab, right-hand panel, #live (data-state, data-mode): #live-download (Download the plant (zip)), #live-connect (Connect / Disconnect), #live-reset, #live-hold, #live-url (where the plant listens), #live-status (data-state; while running data-rate, data-rtt, data-missed, data-late; after an E-stop data-reason), #live-mode (what the page sends), #live-ramp and #live-scale-NAME (Live settings).',
    'Plant tab, a HIL system: Interface (#pl-rep-iface) shows #pl-iface, the plant\'s interface as a readout panel, a row per port (li with data-side in or out, data-port, data-kind): unit, full scale, hard range (outputs) or safe value (inputs). It is all the page knows of the plant; live.state() has the same.',
    'Save ▾ under the screen: #rc-save.',
  ],
  live: {
    what: 'A system with an External plant block runs against a plant outside the page, in real time. HIL: an external plant is made for it: the controller against one External plant block, a black box. The page knows only the interface the plant describes when it connects (its inputs and outputs: names, units, full scales, hard ranges, kinds; the Plant tab shows it under Interface, and live.state() has it); the External block takes those ports, and the Sinks and channels follow the outputs. Tuning needs the plant identified first (Identify, to come): Auto-tune and Analysis say so. The downloadable example plant happens to simulate a DC motor swinging an arm, standing in for real hardware; the page is not told. Replace it with your device behind the same protocol, in any language.',
    setup: [
      'Load the system: loopTuner.loadSystem("HIL: an external plant") (or "HIL: an external plant, reference mode"). It opens stopped and OFFLINE: nothing runs until the plant is connected and Run is pressed.',
      'Get the plant: loopTuner.live.downloadPlant() saves hil-plant.zip (Plant tab: Download the plant (zip)). loopTuner.live.plantFiles() has its files as text.',
      'Start it on the computer the browser runs on: unzip, then sh runme.sh (Linux, macOS) or double-click runme.cmd (Windows; it runs runme.ps1). They install uv if it is missing, which brings its own Python (with the window\'s toolkit) and the websockets package, then start the plant. With uv: uv run hil_plant.py. For the reference mode system: sh runme.sh --mode reference. A window opens with a red STOP, Run/Stop, where it listens and the link\'s state; without a display the console takes s (stop), r (run), e (E-stop), x (reset). An agent with only a browser asks someone at that computer to run it, and for the address it listens on if it is not ws://127.0.0.1:8765.',
      'Connect: await loopTuner.live.connect(). It resolves once the plant has described itself: state() is then "open", the link is up, the plant is stopped and applies its safe inputs.',
      'Run: loopTuner.run() returns { ok, why }. The references first ramp from where the plant is to their first value at no more than 10 % of full scale per second (state().ramp says how long is left), then the loop runs; state() is "running" and its link figures fill in.',
      'Tune while it runs: loopTuner.setGains("ctrl", { Kp: 8 }) (the controller keeps its state) or loopTuner.setVariant("ctrl", "Off") (another variant, afresh). The first guess is not a tuned controller: the page does not know the plant; read loopTuner.record.screen("csv") or record.live("csv").',
      'Stop: loopTuner.stop(). E-STOP: await loopTuner.live.estop() (or the header key, or E), then await live.reset() and Run again. A STOP pressed at the plant shows at once (state().estop.by is "plant", the reason "STOP pressed at the plant") and is reset at the plant only: ask whoever is at the plant to press Reset there (x at its console); the page follows.',
      'Save: await loopTuner.record.save("record", "csv") (the live record) or ("screen", "png"). Disconnect: loopTuner.live.disconnect().',
    ],
    modes: 'The plant declares its inputs in describe, and the page follows. Control mode (inputs are efforts): the page is the controller and sends the control effort u every cycle, with the reference r and the error e for the plant\'s log only. Reference mode (an input is a reference): the plant runs its own controller with its own limits and monitoring; the page sends the references and records what comes back, the plant\'s own u included; the page\'s controllers and Auto-tune are not in the loop. A plant without inputs only reports: the page answers each cycle with an empty u, so its watchdog sees a live page.',
    protocol: 'JSON-RPC 2.0 over a WebSocket, one message per text frame, at ws://127.0.0.1:8765 by default; the plant is the server and owns the clock. Requests from the page, each answered with a result or an error: describe (the plant\'s name, rate_hz, watchdog_cycles, inputs [{ name, unit, min, max, safe, kind, measures }], outputs [{ name, unit, min, max, hard_min, hard_max }], running, estop), start (params { log: [{ name, unit }] }: what each u also carries for the plant\'s log), stop, reset, estop ({ reason }). Every cycle the plant sends y { seq, t, y: [...], applied: [...] } (applied: the inputs it applied at the end of that cycle, after its clamps; the live record keeps them as applied.NAME) and the page answers at once with u { seq, u: [...], log: [...] }. The plant also sends estop { reason, t }, running { running, by, reason } whenever it starts or stops (by "page" when the page asked: the page ignores those), and status once a second (rate, jitter, round trip, late, dropped). Frames go out in the order made: the running a start causes comes before start\'s result. Values are in the units describe gives (null for one that is not a number); min and max are full scales, an output\'s hard_min and hard_max its hard range (beyond it the plant E-stops). hard_min, hard_max and applied are optional: a plant without them works as before. Errors: -32700 not JSON, -32600 not a request, -32601 no such method, -32602 params not an object, -32000 refused (E-stop latched, or a STOP pressed at the plant), -32603 the request failed.',
    safety: 'The plant is the safety authority: it clamps every input to its limits, and if 10 of its cycles go unanswered, the page goes away, an output leaves its hard range (describe\'s hard_min … hard_max) or is not a number, its own cycle fails, or STOP is pressed, it applies its safe inputs and latches an E-stop until reset. Who latched it resets it: a STOP pressed at the plant only at the plant; the page\'s E-STOP only on the page while it is connected; the watchdogs\' and the monitoring\'s on either side. The page stops too: E-STOP, its own watchdog (no y for 10 cycles), and an output that is not a number for 3 cycles (it holds the last number meanwhile). Ctrl+C at the plant ends it cleanly. The plant may also limit how fast its inputs change (--slew).',
    plant: 'The example plant has no disturbance input unless started with --dyno (a load torque, an ordinary described input then), as a rig without a dynamometer has none. It varies its physics by up to 15 % at every start (--vary 0.15; --seed N repeats one; --show-params prints it) and never tells the page: the page has to identify it, as it would a real device. --plant heater runs a second, simpler plant; --log FILE.csv writes every cycle and event; --bench S measures the link for S seconds; --help lists everything.',
  },
  errors: [
    ['no plant answered at that address', 'The plant is not running, or listens elsewhere (state().detail, #live-url); or the host of this page blocks connections to the computer: save the page (Export HTML or Copy HTML) and open the file in a browser.'],
    ['busy: another page is connected', 'One page at a time: close the other one.'],
    ['origin not allowed', 'The plant refuses pages from web sites; start it with --allow-origin ORIGIN (its console says which).'],
    ['E-STOP is latched', 'Reset first (loopTuner.live.reset()), then Run.'],
    ['Offline: connect the plant first', 'Run with an External plant needs the link: loopTuner.live.connect().'],
    ['plant silent for N cycles', 'The page heard no y for its watchdog: the plant stalled or the link broke; or the computer is too busy (close other work, or start the plant with --watchdog 30).'],
    ['no u for 10 cycles', 'The plant heard no answer: the page was blocked (on the page instead of a worker, or a background tab), or the computer is too busy: close other work, or start the plant with --watchdog 30 (cycles).'],
    ['connection lost', 'The link closed while running; the plant has stopped itself.'],
    ['STOP pressed at the plant', 'Someone pressed STOP in the plant\'s window or console. Only the plant resets it: ask whoever is at the plant to press Reset there (x at its console); the page clears with it. live.reset() is refused.'],
    ['reset: STOP was pressed at the plant', 'The page cannot reset a STOP pressed at the plant: ask whoever is at the plant to press Reset there.'],
    ['is wired to …, which this plant takes as a reference', 'A Controller block\'s output feeds an input the plant takes as a reference (the plant runs in reference mode, the system is made for control mode). Load "HIL: an external plant, reference mode", or start the plant without --mode reference; Run is refused until then.'],
    ['no number for …', 'The plant sent an output that is not a number for 3 cycles: the page latched an E-stop rather than control on a stale value. Check the plant\'s sensor or its code.'],
    ['… is not a number', 'The plant\'s own monitoring: an output it measured is not a number; it latched an E-stop.'],
    ['the plant\'s cycle failed', 'The plant\'s own code failed (its console has the error): it applied its safe inputs and ended. Fix the plant, start it again, Connect.'],
    ['Saving files is not available here', 'This host has no downloads: copy instead (Save ▾ › Copy, Copy image, Copy HTML), or loopTuner.live.plantFiles() for the plant.'],
    ['the plant was shut down', 'Ctrl+C or its window closed.'],
    ['angle 2.6 rad beyond 2.5', 'The plant\'s monitoring: an output left its hard range (describe\'s hard_min … hard_max) and the plant latched an E-stop. Reset (either side), and run gentler, or with a reference inside the range.'],
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
