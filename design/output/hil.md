# Live mode (HIL): an external plant

Reader: whoever changes Live mode, its protocol, the plant and its download, or the live record. **Status: built 2026-10-24 (v2.7), reworked the same day after review and the person's later words; the follow-ups of input 10 built 2026-10-25 (both modes, the Live controls in the Plant panel and E-STOP in the header, nothing running by itself, Single finishing the run, full scales and the ramp-in, the plant's window, log and bench, the agent guide, the rate test).** The person's words are the HIL sections of [../input/2026-10-24-09-analysis-autotune-triple-swingup.md](../input/2026-10-24-09-analysis-autotune-triple-swingup.md):

- "a HIL mode … a Python script or something that you run with UV … our external plant … 100 Hertz … if we miss 10 cycles, we push an emergency stop … tune a controller here … against the external thing running … store traces. So if I set a trace to 5 minutes, I should be able to store that."
- "I'm not bound on Python … a zip file that is included in the HTML … contains a runme script, runme sh and runme ps1 … they install everything they need and run everything they need."
- "the page receives a number of signals … And there's one signal that is the output signal that goes out … the outside program sets the cycle … Security we don't need. The plant will listen only locally … we don't need a one-time token … we could either use our page here just to log stuff, or … implement an experimental control loop … could we also connect an agent to that web page …?"
- "we could also be sending the reference value … The limiting needs to happen on the plant side and the monitoring … it needs to work via the browser tool … He needs to find all the documentation."
- "we should also provide a stop signal … a red stop button in the hill plant … the other side is also needs to have it."
- "our stop and run signal that would also have to go through the plant."
- And in [input 10](../input/2026-10-24-10-sliding-mode-and-triple-swingup.md): "in hill we are fixed to 1.0"; "our hill simulator will always have some variation up to like 15% or so … we can set it on the hill side. It's going to have a command line interface, so we can set the plant that is running, but the other side doesn't know it, so we have to identify it."; both modes, settled; "Just put them in the plant controls in the bottom right corner … that's too small, the download button for the script"; "put it [E-STOP] into the header bar, right in the middle, next to system library"; "when the hill is offline, I also don't want the traces to run"; "if I press the single button while something is already running … I actually just want the current run to finish"; "in hill mode, we're going to have the full scale for all these values … go to the initial value at no more than 10% full scale per second".

**A system can have its plant outside the page. The plant runs in real time on its own clock; every cycle it sends its outputs, the page runs the rest of the diagram (Sources, Controller and Observer blocks, anything else) against them and answers at once with the inputs to apply. The controller is tuned in the page while the plant runs; the scope's Run and Stop start and stop the plant, and nothing runs by itself.** The System library's **HIL: external motor** (control mode) and **HIL: external motor, reference mode** are made for it; their plant ships in the page as `hil-plant.zip`.

## Two modes (settled; see decisions.md v2.7 before changing)

| Mode | The page sends each cycle | Who controls | In the page |
|---|---|---|---|
| **Control** (tune a controller) | the control effort u, plus r and e for the plant's log | the page's Controller blocks | tuning live; Auto-tune and Analysis wait for identification (designed, [identification.md](identification.md)) |
| **Reference** (log data, or drive a plant with its own controller) | reference values | the plant's own controller | the Controller and Auto-tune tabs say **not in the loop** (Auto-tune does not start); recording, the scope and (partly) identification work |

The plant declares which it takes, through its inputs in `describe` (each input's `kind`: `effort`, `reference` or `disturbance`; `"mode": "reference"` makes them references by default); the page follows (`blockMode`, `src/core/hil.js`). The person went back and forth on this once and then settled on both: keep both.

- **Control mode, the log values**: each `u` also carries the page's reference r and error e of each Controller block, declared once in `start`'s params as `log: [{ name, unit }]` (r and e in the unit of the measurement; with several Controller blocks, prefixed by the block's path), then values per cycle in `u.log`. The plant only writes them to its log; its physics ignores them. Interpretation of "we should send it to the other system so they can log it on their side".
- **Reference mode**: the plant runs its own controller with its own limits and monitoring (in `hil_plant.py`: `--mode reference`, a PID on the motor angle, clamped to ±12 V, the integral held at the limits); its inputs are the reference r (`measures: "angle"`) and the test input `load`. The plant also reports its own control effort as an output (`V`, `kind: "effort"`), so identification can use u to y and not only r to y.
- **Logging only** is reference mode with references the person sets or holds (a constant Source). A plant with **no inputs at all** (`--mode log`, which holds its own setpoint) is the one case without a mode of its own: the page answers each `y` with an empty `u`, so the plant's watchdog still sees a live page. Interpretation of "use our page here just to log stuff".

## Why the plant is the server

A web page cannot listen on a TCP or UDP port. It can open a WebSocket client to `ws://127.0.0.1:PORT`: localhost counts as a potentially trustworthy origin, so even an https page may connect to it (no mixed-content block). So the plant is the server, and the page connects to it. A standalone HTML file opened from disk works; the claude.ai artifact viewer may block the connection (see Limits).

## The protocol: `loop-tuner-hil/1`

JSON-RPC 2.0, one message per WebSocket text frame, by default at `ws://127.0.0.1:8765`. Requests carry an `id` and get a `result` or an `error`; notifications have no `id` and get no answer. Any language can implement it; `hil/hil_plant.py` is the reference.

| From → to | Method | Kind | Params → result |
|---|---|---|---|
| page → plant | `describe` | request | → `{ protocol, name, mode, rate_hz, watchdog_cycles, inputs: [{ name, unit, min, max, safe, kind, measures }], outputs: [{ name, unit, min, max, kind }], running, estop, slew? }`. `min … max` is each port's **full scale** (for inputs also its limits); `kind` and `measures` as under Two modes; `slew`, if the plant limits how fast its inputs change (fraction of full scale per second). Never the plant's physics. |
| page → plant | `start` | request | `{ log: [{ name, unit }] }` → `{ rate_hz }`. The plant restarts its clock (seq 0, t 0) and sends `y` every cycle; `log` names what each `u` also carries for the plant's log. Refused (`-32000`) while an E-stop is latched. |
| page → plant | `stop` | request | → `{}`. Safe inputs, no more `y`. A clean stop, not an E-stop. |
| page → plant | `reset` | request | → `{}`. Clears a latched E-stop. The plant stays stopped. |
| page → plant | `estop` | request | `{ reason }` → `{}`. Latches an E-stop now (the page's E-STOP key, the page's watchdog). |
| plant → page | `y` | notification, every cycle | `{ seq, t, y: [...] }`: seq counts cycles from 0 at `start`, t = seq / rate_hz in seconds, y in the order and units of `outputs`. |
| page → plant | `u` | notification, one per `y` | `{ seq, u: [...], log?: [...] }`: seq of the `y` it answers, values in the order and units of `inputs` (empty for a plant without inputs); `log` in the order `start` declared. |
| plant → page | `estop` | notification | `{ reason, t }` when the plant stops itself (its watchdog, its STOP key, its monitoring, a lost page, shutting down). |
| plant → page | `running` | notification | `{ running, by, reason, t }` whenever the plant starts or stops: at the page's request, at its own Run/Stop keys, or after an E-stop. The page follows. |
| plant → page | `status` | notification, once a second, and at once after a reset | `{ t, rate_hz, jitter_ms: { mean, max }, rtt_ms: { mean, max }, mode, late, overruns, dropped, running, estop }` |

Errors use the JSON-RPC codes: `-32700` not JSON, `-32600` not a request, `-32601` no such method (the message lists the methods), `-32000` refused (E-stop latched). A plant whose `protocol` is not `loop-tuner-hil/1` is still connected, with a warning. The new fields are optional both ways (a plant without `kind`, `min`/`max` on outputs, `log` or `running` still works), so the protocol keeps its name.

**The plant defines the signals.** Its `inputs` are what the page sends, its `outputs` what it receives; the External plant block takes exactly these ports. Limits and monitoring stay on the plant's side (the person).

**Units**: every value is in the unit its port declares in `describe`; times are in seconds. Names and units go once, in the description and in `start`, which are the contract; each cycle's messages carry only `seq`, `t` and the numbers, so 100 Hz stays small (about 80 bytes a message). Interpretation of "units and seq/t in every message".

```
→ {"jsonrpc":"2.0","id":1,"method":"describe"}
← {"jsonrpc":"2.0","id":1,"result":{"protocol":"loop-tuner-hil/1","name":"DC motor with an unbalanced arm (simulated)","mode":"control","rate_hz":100,"watchdog_cycles":10,
     "inputs":[{"name":"V","unit":"V","min":-12,"max":12,"safe":0,"kind":"effort"},{"name":"load","unit":"N·m","min":-0.2,"max":0.2,"safe":0,"kind":"disturbance"}],
     "outputs":[{"name":"angle","unit":"rad","min":-3.14159,"max":3.14159},{"name":"speed","unit":"rad/s","min":-120,"max":120},{"name":"current","unit":"A","min":-12,"max":12}],"running":false,"estop":null}}
→ {"jsonrpc":"2.0","id":2,"method":"start","params":{"log":[{"name":"r","unit":"rad"},{"name":"e","unit":"rad"}]}}   (the scope's Run)
← {"jsonrpc":"2.0","method":"running","params":{"running":true,"by":"page","reason":"","t":0}}
← {"jsonrpc":"2.0","id":2,"result":{"rate_hz":100}}
← {"jsonrpc":"2.0","method":"y","params":{"seq":0,"t":0,"y":[0,0,0]}}
→ {"jsonrpc":"2.0","method":"u","params":{"seq":0,"u":[0,0],"log":[0,0]}}
   … at t = 0.5 s the reference steps to 1.5 rad; the P controller (Kp 2) answers
← {"jsonrpc":"2.0","method":"y","params":{"seq":50,"t":0.5,"y":[0,0,0]}}
→ {"jsonrpc":"2.0","method":"u","params":{"seq":50,"u":[3,0],"log":[1.5,1.5]}}
← {"jsonrpc":"2.0","method":"estop","params":{"reason":"STOP pressed at the plant","t":1.23}}   (STOP in the plant's window)
← {"jsonrpc":"2.0","method":"running","params":{"running":false,"by":"plant","reason":"E-STOP: STOP pressed at the plant","t":1.23}}
```

## Timing

- **The plant owns the clock** (the person: "the outside program sets the cycle"). It runs a fixed step at `rate_hz` against absolute deadlines (start + k·dt), so sleep errors never add up, and it reports how late each cycle starts (jitter). A stall longer than 5 cycles is skipped over in one physics step; the skipped cycles show as a gap in `seq`.
- **Each cycle** the plant integrates its physics over the cycle just ended, applying each `u` from the moment it arrived (so the loop's delay is the real round trip, about 2 ms, not a whole cycle), then checks its watchdog and its monitoring, then sends `y`. The physics goes on while stopped (the arm falls back on its safe 0 V), as a real device's would.
- **The header's Speed is held at 1× while a plant is connected** ([instrument.md](instrument.md#speed)): the field is read-only in the secondary ink with a lock at its left, ▾ opens nothing, and a click or tap on either gives the reason in a toast ("the external plant owns the clock"; also the title); the setting comes back on Disconnect. The readout beside it shows the plant's clock against the page's: "1.00× live". Measured with `hil_plant.py` at 100 Hz: 1.00–1.02× live.
- **The page answers each `y` at once**: the External plant block's outputs become y; the rest of the diagram advances to t (Sources play their waveform in the loop's time, after the ramp-in; Controller and Observer blocks sample at their own Ts on the plant's clock; continuous blocks integrate between cycles with y held); the block's inputs are read, clamped to [min, max] (a value that is not a number becomes the safe one) and sent with the same seq. A `y` that arrives before the answer to `start` is answered too.

## Full scale and the ramp-in

(The person, input 10: "in hill mode, we're going to have the full scale for all these values … so we have some orientation … when we start a new loop, the first thing we're going to do is we're going to go to the first value of the loop with a gradient filter … 10% of full scale per second … so if somebody programs a waveform that doesn't end where it starts, we don't have a hard jump.")

- **Every live signal has a full scale**: an output's is the plant's `min … max`; a signal that feeds an input has that input's range; a reference compared with an output (a Controller block's r, or a reference input that `measures` an output) has that output's; a full scale set in **Live settings** wins (`fullScales` in `src/core/hil.js`, `liveScales` in `src/core/live.js`). The scope's channels showing them span it (8 divisions; `fullScaleChannel`): when the system loads (Auto Scale offline gives full scales), and when the plant brings other ports. Auto Scale while live fits the sweep instead.
- **Before every loop the references ramp in** (`src/core/ramp.js`): at Run, each reference moves from where it is to its waveform's first value at no more than the ramp-in rate (10 % of its full scale per second by default) and only when the last one arrives does the loop's time start (the Sources' τ = 0, the run time the scope sweeps on). "Where it is": a reference on a Controller's r starts at the measurement it is compared with, a reference input that names its measurement at that measurement, any other at the input's safe value (a stopped plant applies it). The same at each repetition of the input's period when the waveform does not end where it starts; one that ends where it starts goes on without a ramp, so the example's square wave never ramps between loops.
- **On the screen**: the first ramp is drawn as a sweep of its own, from the left edge in plant time, and fades behind the loop when it starts; the status line says "ramping to r0: 2.1 s left" (`data-ramp="yes"`), the Live panel's second line too, and `loopTuner.live.state().ramp` gives `{ left, to }`. A ramp between loops lies inside the run's time: the sweeps run free, as a scope without a trigger does (Not yet: a trigger).
- **The rate is a setting**: Live settings › Ramp-in (% of full scale per second, 0.01–1000), saved with the system in the External plant block (`ramp`, and `scales` for full scales set here). Changing either takes effect at the next Run, not in the run under way.
- **The plant may enforce a limit too** (it is the safety authority): `hil_plant.py --slew PCT` limits how fast each input moves, in % of its full scale per second, and says so in `describe` (`slew`). Off by default: on an effort it would slow the controller itself; it is meant for reference inputs and for plants whose actuators need it.
- Interpretations: the "gradient filter" is a rate limit, a straight line at the rate; every reference ramps at its own rate and the loop waits for the last one; the ramp is the page's (it knows the waveform), the plant's `--slew` is a second, independent guard.

## Run, Stop and the keys

The scope's Run and Stop go through the plant (the person), and **nothing runs by itself** (the person: "when the hill is offline, I also don't want the traces to run. So even when you have connected, you still need to press the run button"). `liveKey` in `src/core/live.js` decides; the scope's keys and `loopTuner.run()`, `.stop()`, `.single()` all go through it.

| Key | Offline | Connected, stopped | Running |
|---|---|---|---|
| **Connect** (Plant panel) | `describe`; the block takes the plant's ports if they differ (one undo step) and the channels their full scales; the plant stays stopped (a plant left running by a lost page gets `stop`) | – (Disconnect: `stop`, then close) | Disconnect: `stop`, then close; the screen keeps the last sweeps (OFFLINE) |
| **Run** | refused: "Offline: connect the plant first" | `start`: a fresh run, the plant's clock and the controllers from 0, the references ramp in; the sweep under way stays as an earlier, fading run | Run/Stop is Stop: `stop` |
| **Stop** | – | – | `stop` (safe inputs, not latched); the screen holds the last sweep |
| **Single** | refused | `start`, one sweep (after the ramp-in), then `stop` | the sweep under way finishes, then `stop` |
| **Hold** (`H`) | – | – | freezes the screen; the plant and the live record run on; `H` again releases |
| **E-STOP** (header, `E`) | disabled | `estop`: latched | `estop`: latched, the screen holds |
| **Reset** (Plant panel) | – | `reset` clears the latch; the plant stays stopped until Run | – |

- **The plant's own keys reach the page at once**: STOP (or E-stop at its console) sends `estop` and `running: false`; the page shows E-STOP with the reason ("STOP pressed at the plant") and its Run/Stop key turns to Stop. Run/Stop at the plant sends `running`; the page starts a run of its own (fresh controllers, the ramp-in) or stops its sweep. Reset at the plant sends `status` at once; an E-stop the plant latched clears on the page too, one the page latched waits for the page's Reset.
- **Freezing the screen while the plant runs** is Hold now that Stop stops the plant. Interpretation: a scope's Stop freezes the display; here that word belongs to the plant.
- Interpretation: Single maps to "start, sweep the window once, stop", as a simulated Single from Stop; that each Run is a fresh run follows from the plant's clock restarting at `start`. The physical plant is not reset by Run: the arm stays where it is, and the ramp-in starts from there.

## Safety

- **The plant is the safety authority.** If 10 of its `y` in a row go unanswered (cycles it skipped itself do not count), it applies the safe inputs, sends `estop` and stays latched until `reset`. Also when the page goes away while running ("connection lost"), on an `estop` request, at its STOP key, and when an output leaves its monitored range (the arm turning more than a full turn either way). Inputs are clamped to their limits in the plant too; a malformed `u` is ignored and a non-number is the safe value.
- **A stop in both directions** (the person): the page has its **E-STOP** key in the header (and `E`) and its watchdog (no `y` for 10 of the plant's cycles: E-STOP, it stops answering, and asks the plant to E-stop as well; it counts from the run's first `y` or `start`'s answer, a second after Run at the latest, so a plant that takes a moment to start its clock is not taken for a silent one); the plant has its big red **STOP** in its window (Space or Esc there too; `e` or Enter at its console), which latches an E-stop the page hears and shows ("STOP pressed at the plant"). **Ctrl+C** or closing the plant's window ends it cleanly: safe inputs, then an `estop` ("the plant was shut down") if it was running and a close with code 1001, so the page says why instead of "connection lost".
- **Both latch until Reset**, on either side, which leaves the plant stopped: Run then goes on with the controllers afresh, so no integral wound up during the stop is carried over. Connecting to a plant that is still latched (from a lost page) shows the E-STOP; Reset clears it.
- **While latched, the scope shows what the plant applies**: the Sinks on the signals that feed the External block show its safe values, not what the controller would compute.
- **Disconnect** sends `stop` first, so a clean disconnect is not an E-stop.
- **Origins.** WebSockets have no CORS, so the script checks the Origin a browser sends: it accepts no Origin (scripts), localhost, `--allow-origin` ones, and `null`, which a page opened from a file sends (Loop Tuner's usual case). It refuses other web sites. But a sandboxed frame on any web site also sends `null`, so the default check does not stop a determined web page; `--strict-origin` refuses `null` too (then serve Loop Tuner from localhost). The person asked for no token ("Security we don't need. The plant will listen only locally"); for real hardware, use `--strict-origin`, and a token is on the roadmap. One page at a time; a second gets "busy".
- The plant's sending never blocks its cycle: if the page stops reading, `y` are dropped and counted.

## In the page

- **Where the controls are** (the person, input 10): the Live controls sit at the top of the **Plant tab's right-hand panel** (above the block's parameters or the view's description), shown for a system with an External plant: **Download the plant (zip)** (a full-width key), **Connect / Disconnect** (green while running, amber while connected and stopped), **Reset**, **Hold**, **Plant at** (where the plant listens; typed, kept in the block), two lines of state (not connected; connected and stopped; while running the cycle rate, arrival jitter, worker or page, round trip, missed `y`, late answers, or the ramp-in's countdown; an E-stop and its cause), the mode in a sentence ("Control mode: the page is the controller and sends V …", "Reference mode … not in the loop"), **Live settings** (the ramp-in and the references' full scales) and "Agents: `loopTuner.help()`". Run Control holds only the scope's keys again. What the plant is and how to run it is in the page's Help (?), Live, not beside the button; the button's tooltip points there (the person: "the two sentences on what it is, they can go into the help").
- **E-STOP** is a red key in the header, between the System library and Undo, after the Speed group (the person: "Make it red, put it into the header bar, right in the middle, next to system library"), shown for a system with an External plant and enabled while connected; outlined when latched. The key `E` presses it from anywhere but a text field. Its colour is the one danger red (`--danger`), defined once.
- **The status line** says LIVE with the plant's time or the ramp-in's countdown, HOLD, CONNECTED (Run starts the plant), E-STOP with the reason, or OFFLINE.
- **External plant block** (Plant tab, library group Live): its ports are the plant's, labelled on the canvas on both sides. The description is stored in the block's parameters (`url`, `rate`, `inputs`, `inUnits`, `min`, `max`, `safe`, `kinds`, `measures`, `outputs`, `outUnits`, `outMin`, `outMax`, comma lists in the Plant tab) as design inputs, so the diagram is valid offline; its summary says "reference mode" or "logging". Two parameters are the page's own and stay when the plant's ports are taken: `ramp` and `scales`. Connecting to a plant that describes other ports gives the block the plant's (one undo step; wires to ports that no longer exist go). **While connected the block keeps the plant's ports**: an edit or an Undo that changes them is put back, with a toast, since values travel by position.
- **Offline nothing is simulated**: a system with an External plant gets an empty screen and OFFLINE, not a run against a plant that reads 0 (the person). Its views show "—" for what they read.
- **The scope**: live data sweeps the screen as a simulated run does, on the run's time (from the loop's start, after the first ramp-in). The screen shows the window [w0, w0 + W); a run's time w0 … w0 + W is drawn where the axis says so, and each later screen width sweeps the same window again. Before w0 nothing is drawn, as in a simulated run. Earlier sweeps fade over five; every channel, scale, position and timebase control works, and so do the FFT, Spectrogram and XY views. Views (the arm) follow the live sweep.
- **Tuning while it runs**: every parameter of a Controller or Observer variant takes effect at the next sample and the block keeps its state (integral, filters, estimate): the laws read their parameters at every step (`controllers.js`, `observers.js`). Only a PID's start output u0 waits for the next run. Renaming a variant changes nothing. Anything else (blocks, wires, flipping the variant, Ts) rebuilds the page's diagram: the controllers start afresh, and a toast says so. The ramp-in and full scales count from the next Run.
- **Reference mode in the tabs**: the Controller tab and the Auto-tune tab carry a banner, or in place of their content (when the plant has no Controller block) a box, saying plainly that the page's controllers and Auto-tune are not in the loop; Auto-tune's Start stays off (`tuneContext` refuses with "the plant runs its own controller … not in the loop").
- **Save and the live record**: Save ▾ stores the screen (every signal, a screenshot, or Copy image) and the live record, the last minutes of every live signal across runs ([instrument.md](instrument.md#save-the-live-record-and-references)).
- **The plant's download**: **Download the plant (zip)** saves `hil-plant.zip` (`hil_plant.py`, `runme.sh`, `runme.ps1`, `README.txt`) through the page's one download path (`app.download`: the host's download capability where there is one, else a link). `build.mjs` puts the files of `hil/` into the bundle (`__HIL_FILES`, kept as written, so they carry no provenance either); the page zips them (`src/core/zip.js`, stored entries with CRC-32, Unix modes so runme.sh stays executable). The script alone is no longer a separate download (it is in the zip; `loopTuner.live.plantFiles()` has its text).

## The plant: `hil/`

- **`hil_plant.py`** (Python 3.9+, `websockets`; uv brings both): the server, the cycle, the watchdog, the monitoring, the window, the console, the log and the bench, around a plant class (`Motor`, `Heater`).
- **Its window** (tkinter, from the standard library; uv's Python builds include it): a big red **STOP** (an E-stop, latched until Reset; Space and Esc press it too), **Run/Stop** (R), **Reset** (X) and a status block: running, stopped or E-STOP and its reason; the page (or "no page connected"); the cycle rate, jitter and round trip; late and dropped cycles; the mode; the outputs. The asyncio server runs in a thread beside it; closing the window ends the plant cleanly. `--no-gui`, or no display (no `DISPLAY` or `WAYLAND_DISPLAY` on Linux, or no tkinter), gives a **console** with the same commands, one per line: `s` stop, `r` run, `e` (or Enter) E-stop, `x` reset, `q` quit; it prints the state once a second.
- **Plants and modes**: `--plant motor` (a DC motor swinging an unbalanced arm with friction and a load-torque input; the default) or `--plant heater` (a heater and a lagging thermometer, the second, simpler plant); `--mode control` (the default), `reference` (its own PID or PI, limits, monitoring; reports its own u) or `log` (no inputs, holds `--setpoint`).
- **The plant the page does not know**: each physical parameter (the motor: R, L, k, J, b, Tc, m g l; the heater: C, G, Pmax, tau, Ta) differs from nominal by a random factor within ±15 % (`--vary 0.15`, the default; `--vary 0` the nominal plant), a new plant each start; `--seed N` gives the same one again (the seed is printed), `--set J=0.003` fixes a parameter, `--show-params` prints the true values for the person at the plant. The page is not told: `describe` carries ports and full scales, never physics, as with a real device; the page has to identify it (an Identify tab is designed: [identification.md](identification.md)). The library's hand-picked gains hold across the range.
- **`--log FILE.csv`**: a row per cycle while running (`t`, every output, every input applied, then the page's log values such as r and e, each `name [unit]`) and a row per event (page connected, start and stop with who and why, E-STOP and its reason, reset, page disconnected, shut down). A new run that declares other log values starts a new header, after a `#` line.
- **`--bench S`**: measures the next run for S seconds and prints the rate, how late cycles start (mean, p99, max), the round trip (mean, p99, max), answered cycles, late (began without a new u), dropped and skipped, then `bench-json: {…}`, and ends.
- **`--slew PCT`**, `--rate`, `--port`, `--watchdog`, `--allow-origin`, `--strict-origin`, `--spin`, `--check` (the nominal physics for 3 s: PD, the own PID, the heater's PI), `--describe` (the answer to describe).
- **`runme.sh`** (Linux, macOS): installs uv if missing, with uv's official installer through curl or wget; with neither, first curl from the package manager (apt-get, dnf, yum, zypper, pacman, apk; brew installs uv itself), with sudo only when not root, said before it asks; then `uv run hil_plant.py "$@"`. **`runme.ps1`** (Windows): `winget install astral-sh.uv` if uv is missing, else uv's PowerShell installer, then `uv run`. **`README.txt`**: what it is, how to run it, the window and console, both modes, the variation, the options, the protocol in a paragraph, and how to put real hardware in its place.

## A plant of your own

Keep `hil_plant.py`'s server, cycle, watchdog, window and status, and replace its `Motor` with your device's I/O: its ports (`EFFORT`, `TESTS`, `OUTPUTS`, `REFERENCE` with names, units, full scales and safe values) are the description, `advance(span, u)` applies the inputs for a span of time, `outputs()` reads the measurements, `TRIPS` are the ranges it monitors. Any language works if it speaks the protocol above (the person: "I'm not bound on Python"). Then add an External plant block to a system, or connect "HIL: external motor": the block takes the new plant's ports.

## For agents (through the browser)

The person: "it needs to work via the browser tool … we can't assume that the external program will be accessible to an agent … He needs to find all the documentation that he needs to find and needs to understand how to set everything up. And then we describe all of that in our hil example." So the page carries its own documentation and API:

- **`window.loopTuner.help()`** returns a structured guide (`src/core/guide.js`): every API method with its arguments, what it does and an example; the DOM an agent can read without JavaScript; the Live setup step by step; the two modes; the protocol; safety; the plant's options; what each error means. `help('text')` is the same as text, and it is the Help dialog's **For agents** section (the `?` key), so the three never disagree. **`window.loopTuner.api`** lists every method in one line each.
- New methods: `systems()`, `loadSystem(name)`, `setGains(block, params)` (one undo step; live, at the next sample), `live.hold(on?)`, `live.settings({ ramp, scales })`, `live.downloadPlant()`, `live.plantFiles()`, `record.save(what, format)` (through the page's download path), `record.screenshot()` (a PNG data URL). `live.connect()` returns a promise of the state once the link is up or has failed. The others as before: `live.connect/disconnect/estop/reset/state`, `run/stop/single`, `getProject/setProject`, `record.screen/live/reference/clearReferences/state`.
- **State in the DOM**: `#lt-shell[data-run][data-live][data-hil-mode]`, the status line's `data-run`, `data-live`, `data-ramp`, `#live[data-state][data-mode]`, `#live-status[data-state][data-rate][data-rtt][data-missed][data-late][data-reason]`, `#estop[data-state]` (off, armed, latched). Stable ids on every Live control (`#live-download`, `#live-connect`, `#live-reset`, `#live-hold`, `#live-url`, `#live-ramp`, `#live-scale-NAME-lo/hi`, `#estop`) and accessible names (`aria-label`, `title`, `aria-pressed` on Hold).
- A short visible pointer in the Live panel: "Agents: `loopTuner.help()`". The HIL examples' notes (System library) give the setup step by step.
- Interpretation: an agent that has only a browser cannot run the plant; the guide says to ask someone at that computer to run `runme.sh`, and everything after that (connect, run, tune, record, save) it can do through the page. Connecting an agent through MCP is on the roadmap.

### Checked as an agent would (2026-10-25)

With Playwright on headless Chromium, driving the built `dist/loop-tuner.html` from a file and nothing but the page:

1. Read the guide from the DOM (`#help-agents`; 32 methods in `loopTuner.api`).
2. `loopTuner.loadSystem('HIL: external motor')`: the shell read `data-live="offline"`, `data-run="stop"`, the E-STOP `data-state="off"`; `run()` was refused with "Offline: connect the plant first (Plant tab, Connect); Run then starts it."; the screen stayed empty.
3. Started the plant with uv in the container (`uv run hil_plant.py --no-gui --port …`, console mode; the window was checked separately under Xvfb: STOP, Run/Stop, Reset and the status block with the page "opened from a file", 99.9 Hz, round trip 1.4 ms).
4. `await loopTuner.live.connect(url)`: state `open`, plant stopped, the status line "Stop · Connected · stopped · Run starts the plant".
5. `loopTuner.run()`: running in a worker at 100.0 Hz, round trip 2.2 ms, missed 0; `#live-status` carried `data-rate="100.2"`, `data-rtt`, `data-missed="0"`.
6. Stepped the reference (an added 1 rad DC level, so r0 = 1 rad away from the hanging arm): the status line counted "ramping to r0: 1.3 s left … 0.4 s left", `data-ramp="yes"`, `live.state().ramp.left` fell at 0.628 rad/s (10 % of 2π per second), the loop started at 1.6 s and the ramp stayed on the screen as a faded sweep.
7. `setGains('ctrl', { Kp: 6 })` while running: taken in place (`updates.kept`).
8. `single()` while running: the sweep under way ran to its end at 10.0 s of run time, then the plant stopped (its log: "stop by the page" at 10.01 s).
9. `live.estop()`: E-STOP latched on both sides (`data-live="estop"`, the header key `data-state="latched"`); `live.reset()` cleared it, the plant stayed stopped.
10. At the plant's console: `e` reached the page as "E-STOP from the plant: STOP pressed at the plant" in 66–94 ms (including the console's line read), the Run/Stop key turned to Stop; `x` cleared it on the page too; `r` started a run the page followed; `s` stopped it.
11. Reference mode (`HIL: external motor, reference mode`, plant `--mode reference`): connected as `mode: "reference"`, the Controller and Auto-tune tabs said "not in the loop", the arm followed r on the plant's own PID, V recorded from the plant.
12. `await loopTuner.record.save('record', 'csv')`, `('screen', 'png')` and `live.downloadPlant()`: three downloads in plain Chromium (the live record's CSV, the screenshot with title, status line and badges, `hil-plant.zip`).

## Architecture

| Where | What |
|---|---|
| `src/core/hil.js` | Protocol messages (`u` with its log, `start`'s params, `running`), the description check (kinds, full scales), the External plant block, `blockMode`, `fullScales`, `fullScaleChannel`, `findExternal`, the page's watchdog and link statistics |
| `src/core/ramp.js` | The ramp-in: `createRampIn` (a pure function of the plant's time) |
| `src/core/live.js` | `createLiveRunner` (a compiled diagram stepped one cycle at a time, the ramp-in, the log values, parameter edits taken in place, safe values while latched), `createLiveLoop` (socket, runner, watchdog, Run/Stop, the plant's own keys, statistics), `liveKey` (the scope's keys through the plant), `liveScales`, `liveWorker` |
| `src/core/diagram.js` | The `external` block: a node whose outputs are set from outside, whose inputs are read back, the Sinks that show its inputs (`externals`), and who feeds what around it (`links()`) |
| `src/core/guide.js` | The guide for agents: `GUIDE`, `apiList`, `guideText` |
| `src/core/speed.js` | `singleFrom`: Single while running finishes the sweep |
| `src/core/trace.js` | Where live sweeps and references land on the screen (`sweepStart`, `refShift`), the live record, CSV and JSON |
| `src/core/zip.js` | A stored zip, for the plant's download |
| `src/ui/live.js` | The Plant panel's Live section, the header's E-STOP, the worker, the keys through the plant, Hold, the sweeps fed to the display (the first ramp as its own sweep), Live settings, the data-* state, `loopTuner.live` |
| `src/ui/record.js` | Save ▾ (screen, live record, screenshot, copy image), the record length, Open and references, `loopTuner.record` |
| `hil/` | `hil_plant.py`, `runme.sh`, `runme.ps1`, `README.txt` |

**The loop runs in a Web Worker**, made from the page's own script: the bundle's core modules (everything before its first `ui/` module) and a call to `liveWorker(self)`, as a Blob URL. So an exported page carries it too, and drawing never delays an answer. Where a host blocks Blob workers (a strict Content Security Policy), the same loop runs on the page.

## Measured (2026-10-25, in the build container: headless Chromium with software rendering, Python 3.13 and websockets 17 by uv, the page in a worker unless said; `hil_plant.py --bench`; 4 cores shared with other work, load average 6–11, so the tails are pessimistic)

| Plant rate | Run | Achieved | Cycle start late: mean / p99 / max | Round trip: mean / p99 / max | Answered | Late (no new u) | Skipped | E-stop |
|---|---|---|---|---|---|---|---|---|
| 100 Hz | 30 s | 100.0 Hz | 1.0 / 3.9 / 23.5 ms | 2.4 / 11.0 / 42.3 ms | 3001 of 3002 | 29 (1 %) | 0 | none |
| 200 Hz | 30 s | 200.0 Hz | 0.9 / 4.0 / 18.3 ms | 2.2 / 9.8 / 28.5 ms | 5999 of 6001 | 370 (6 %) | 0 | none |
| 500 Hz | 10 s | (stopped) | 0.8 / 4.2 / 7.4 ms | 2.7 / 14.9 / 24.7 ms | 2630 of 2641 | 750 (28 %) | 5 | after 5.3 s: "no u for 10 cycles" (20 ms) |
| 500 Hz, `--watchdog 50` (100 ms) | 10 s | 470 Hz | 1.1 / 6.0 / 9.5 ms | 4.6 / 30.3 / 91.3 ms | 4694 of 4698 | 1762 (38 %) | 304 | none |
| 1000 Hz | 10 s | (stopped) | 0.6 / 3.5 / 4.6 ms | 3.2 / 20.5 / 35.1 ms | 1782 of 1793 | 764 (43 %) | 43 | after 1.8 s: "no u for 10 cycles" (10 ms) |
| 1000 Hz, `--watchdog 100` (100 ms) | 10 s | 947 Hz | 0.7 / 3.8 / 5.0 ms | 3.9 / 23.6 / 45.6 ms | 9469 of 9471 | 4278 (45 %) | 532 | none |
| 100 Hz, on the page | 10 s | 100.1 Hz | 1.1 / 4.4 / 29.8 ms | 10.1 / 43.3 / 66.2 ms | 999 of 1002 | 206 (21 %) | 0 | none |

The page's own time per cycle was 0.1–0.25 ms on average (at most 4–17 ms, a garbage collection or a drawn frame); its arrival jitter, the largest deviation from the cycle in a second, 10–26 ms. Earlier (2026-10-24): three 400 ms blocks of the main thread left the worker untouched and tripped the plant's watchdog with the loop on the page.

**The documented maximum is 200 Hz**: every cycle answered, no E-stop over 30 s with the default watchdog of 10 cycles, 6 % of cycles beginning before the answer to the previous one arrived. At 500 and 1000 Hz the round trip's tail (p99 15–30 ms, a few tens of ms at worst, in this container) is longer than 10 cycles, so the default watchdog trips within seconds; with a 100 ms watchdog they run, but 40–45 % of cycles begin without a fresh u and the plant itself skips hundreds of cycles: not a usable loop. Above 200 Hz the limit is the round trip through a browser and an asyncio Python plant with JSON frames, not the protocol. A desktop browser with a GPU will do better on the page side; a plant in a compiled language with binary frames would raise the ceiling. The External plant block still accepts 1–1000 Hz.

## Limits

- **Browser timing**: the page answers on message events, never on timers; the plant owns the clock. Desktop operating systems give the plant about 1 ms of timer jitter; Windows timers are coarse (about 15 ms), so the script waits out the last 2 ms of each cycle actively there (`--spin`). Untested on Windows, as is `runme.ps1` (no PowerShell in the build container); `runme.sh` was run here with uv present (`sh runme.sh --check`); its install path (uv's installer through curl, tested in an earlier version on a clean home) and the new package-manager fallback could not be run in this container.
- **Background tabs**: drawing stops, the worker keeps answering. In the on-page fallback a background tab's timers are throttled, so the page's watchdog may trip late; the plant's watchdog still protects.
- **The claude.ai artifact viewer** may block `ws://127.0.0.1` (its Content Security Policy) and Blob workers. Saving goes through its download capability where the page has it (CSV, JSON, PNG, the zip). To go live from there: Copy HTML, save it as a file, open that in the browser. The script also refuses the viewer's origin unless started with `--allow-origin`.
- **Live runs at 1×**: the plant's clock is real time (the person, [input 10](../input/2026-10-24-10-sliding-mode-and-triple-swingup.md): "in hill we are fixed to 1.0"). See Timing.
- One External plant per system, one page per plant; 0–8 inputs, 1–16 outputs; 1–1000 Hz accepted, **200 Hz measured sound** (Measured); text frames (JSON).

## Not yet

- Identifying the plant from the page (it varies by ±15 % and is not described), so Auto-tune and Analysis work for HIL: designed in [identification.md](identification.md).
- A trigger for live sweeps, so that loops separated by a ramp-in line up on the screen.
- Signals the plant only logs (outputs that are not ports).
- An agent tuning through MCP; remote plants (wss://, a token); several External blocks; binary frames for rates above 200 Hz.
