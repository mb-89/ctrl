# Live mode (HIL): an external plant

Reader: whoever changes Live mode, its protocol, the plant and its download, or the live record. **Status: built 2026-10-24 (v2.7), reworked the same day after review and the person's later words.** The person's words are the HIL sections of [../input/2026-10-24-09-analysis-autotune-triple-swingup.md](../input/2026-10-24-09-analysis-autotune-triple-swingup.md):

- "a HIL mode … a Python script or something that you run with UV … our external plant … 100 Hertz … if we miss 10 cycles, we push an emergency stop … tune a controller here … against the external thing running … store traces. So if I set a trace to 5 minutes, I should be able to store that."
- "I'm not bound on Python … a zip file that is included in the HTML … contains a runme script, runme sh and runme ps1 … they install everything they need and run everything they need."
- "the page receives a number of signals … And there's one signal that is the output signal that goes out … the outside program sets the cycle … Security we don't need. The plant will listen only locally … we don't need a one-time token … we could either use our page here just to log stuff, or … implement an experimental control loop … could we also connect an agent to that web page …?"
- "we could also be sending the reference value … The limiting needs to happen on the plant side and the monitoring … it needs to work via the browser tool … He needs to find all the documentation."
- "we should also provide a stop signal … a red stop button in the hill plant … the other side is also needs to have it."
- "our stop and run signal that would also have to go through the plant."
- And in [input 10](../input/2026-10-24-10-sliding-mode-and-triple-swingup.md): "in hill we are fixed to 1.0"; "our hill simulator will always have some variation up to like 15% or so … we can set it on the hill side. It's going to have a command line interface, so we can set the plant that is running, but the other side doesn't know it, so we have to identify it."

**A system can have its plant outside the page. The plant runs in real time on its own clock; every cycle it sends its outputs, the page runs the rest of the diagram (Sources, Controller and Observer blocks, anything else) against them and answers at once with the inputs to apply. The controller is tuned in the page while the plant runs; the scope's Run and Stop start and stop the plant.** The System library's **HIL: external motor** is made for it; its plant ships in the page as `hil-plant.zip`.


## Two modes (settled; see decisions.md v2.7 before changing)

| Mode | The page sends each cycle | Who controls | In the page |
|---|---|---|---|
| **Control** (tune a controller) | the control effort u, plus r and e for the plant's log | the page's Controller blocks | everything works: tuning, Auto-tune, Analysis on an identified model |
| **Reference** (log data, or drive a plant with its own controller) | reference values | the plant's own controller | the Controller blocks and Auto-tune are shown as **not in the loop**; recording, the scope and (partly) identification work |

The plant declares which it takes, through its inputs in `describe`; the page follows. The person went back and forth on this once and then settled on both: keep both.

## Why the plant is the server

A web page cannot listen on a TCP or UDP port. It can open a WebSocket client to `ws://127.0.0.1:PORT`: localhost counts as a potentially trustworthy origin, so even an https page may connect to it (no mixed-content block). So the plant is the server, and the page connects to it. A standalone HTML file opened from disk works; the claude.ai artifact viewer may block the connection (see Limits).

## The protocol: `loop-tuner-hil/1`

JSON-RPC 2.0, one message per WebSocket text frame, by default at `ws://127.0.0.1:8765`. Requests carry an `id` and get a `result` or an `error`; notifications have no `id` and get no answer. Any language can implement it; `hil/hil_plant.py` is the reference.

| From → to | Method | Kind | Params → result |
|---|---|---|---|
| page → plant | `describe` | request | → `{ protocol, name, rate_hz, watchdog_cycles, inputs: [{ name, unit, min, max, safe }], outputs: [{ name, unit }], running, estop }` |
| page → plant | `start` | request | → `{ rate_hz }`. The plant restarts its clock (seq 0, t 0) and sends `y` every cycle. Refused (`-32000`) while an E-stop is latched. |
| page → plant | `stop` | request | → `{}`. Safe inputs, no more `y`. A clean stop, not an E-stop. |
| page → plant | `reset` | request | → `{}`. Clears a latched E-stop. |
| page → plant | `estop` | request | `{ reason }` → `{}`. Latches an E-stop now (the page's E-STOP key, the page's watchdog). |
| plant → page | `y` | notification, every cycle | `{ seq, t, y: [...] }`: seq counts cycles from 0 at `start`, t = seq / rate_hz in seconds, y in the order and units of `outputs`. |
| page → plant | `u` | notification, one per `y` | `{ seq, u: [...] }`: seq of the `y` it answers, values in the order and units of `inputs`. |
| plant → page | `estop` | notification | `{ reason, t }` when the plant stops itself (its watchdog, its own stop key, a lost page, shutting down). |
| plant → page | `status` | notification, once a second | `{ t, rate_hz, jitter_ms: { mean, max }, rtt_ms: { mean, max }, late, overruns, dropped, running, estop }` |

Errors use the JSON-RPC codes: `-32700` not JSON, `-32600` not a request, `-32601` no such method (the message lists the methods), `-32000` refused (E-stop latched). A plant whose `protocol` is not `loop-tuner-hil/1` is still connected, with a warning.

**The plant defines the signals.** Its `inputs` are what the page sends, its `outputs` what it receives; the External plant block takes exactly these ports. Usually the input is the controller's output u; a plant that runs its own loop can declare its reference r as the input instead, and the page then sends r (a Source wired to that port). Limits and monitoring stay on the plant's side (the person). Interpretation: "the page may send the reference" needs nothing new in the protocol; a plant script that does it is on the roadmap.

**Units**: every value is in the unit its port declares in `describe`; times are in seconds. Names and units go once, in the description, which is the contract; each cycle's messages carry only `seq`, `t` and the numbers, so 100 Hz stays small (about 80 bytes a message). Interpretation of "units and seq/t in every message".

```
→ {"jsonrpc":"2.0","id":1,"method":"describe"}
← {"jsonrpc":"2.0","id":1,"result":{"protocol":"loop-tuner-hil/1","name":"DC motor with an unbalanced arm (simulated)","rate_hz":100,"watchdog_cycles":10,
     "inputs":[{"name":"V","unit":"V","min":-12,"max":12,"safe":0},{"name":"load","unit":"N·m","min":-0.2,"max":0.2,"safe":0}],
     "outputs":[{"name":"angle","unit":"rad"},{"name":"speed","unit":"rad/s"},{"name":"current","unit":"A"}],"running":false,"estop":null}}
→ {"jsonrpc":"2.0","id":2,"method":"start"}                       (the scope's Run)
← {"jsonrpc":"2.0","id":2,"result":{"rate_hz":100}}
← {"jsonrpc":"2.0","method":"y","params":{"seq":0,"t":0,"y":[0,0,0]}}
→ {"jsonrpc":"2.0","method":"u","params":{"seq":0,"u":[0,0]}}
   … at t = 0.5 s the reference steps to 1.5 rad; the P controller (Kp 2) answers
← {"jsonrpc":"2.0","method":"y","params":{"seq":50,"t":0.5,"y":[0,0,0]}}
→ {"jsonrpc":"2.0","method":"u","params":{"seq":50,"u":[3,0]}}
← {"jsonrpc":"2.0","method":"y","params":{"seq":51,"t":0.51,"y":[0.002,0.41,1.38]}}
→ {"jsonrpc":"2.0","method":"u","params":{"seq":51,"u":[2.996,0]}}
→ {"jsonrpc":"2.0","id":3,"method":"stop"}                        (the scope's Stop)
```

## Timing

- **The plant owns the clock** (the person: "the outside program sets the cycle"). It runs a fixed step at `rate_hz` against absolute deadlines (start + k·dt), so sleep errors never add up, and it reports how late each cycle starts (jitter). A stall longer than 5 cycles is skipped over in one physics step; the skipped cycles show as a gap in `seq`.
- **Each cycle** the plant integrates its physics over the cycle just ended, applying each `u` from the moment it arrived (so the loop's delay is the real round trip, about 2 ms, not a whole cycle), then checks its watchdog, then sends `y`.
- **The header's Speed is held at 1× while a plant is connected** ([instrument.md](instrument.md#speed)): the field is read-only in the secondary ink with a lock at its left, ▾ opens nothing, and a click or tap on either gives the reason in a toast ("the external plant owns the clock"; also the title); the setting comes back on Disconnect. The readout beside it shows the plant's clock against the page's: the plant time the `y` messages advanced over the page's wall-clock time, in a moving window of a second, "1.00× live". A plant that falls behind real time reads below 1 (a plant that skips cycles to keep time, as `hil_plant.py` does, stays at 1.00). Measured with `hil_plant.py` at 100 Hz: 1.00–1.01× live.
- **The page answers each `y` at once**: the External plant block's outputs become y; the rest of the diagram advances to t (Sources play at t, Controller and Observer blocks sample at their own Ts on the plant's clock, continuous blocks integrate between cycles with y held); the block's inputs are read, clamped to [min, max] (a value that is not a number becomes the safe one) and sent with the same seq. A `y` that arrives before the answer to `start` is answered too.

## Run, Stop and the keys

The scope's Run and Stop go through the plant (the person). With a plant connected:

| Key | To the plant | On the page |
|---|---|---|
| **Connect** | `describe`; then `start` if the scope is running | the block takes the plant's ports if they differ (one undo step) |
| **Run** | `start`: a fresh run, the plant's clock from 0 | the controllers start afresh; the sweep under way stays as an earlier, fading run, so run can be compared with run |
| **Stop** | `stop`: safe inputs, not latched | the screen holds the last sweep |
| **Single** | `start`, then `stop` once the screen's window has been swept | as a simulated Single: one run, from t = 0 to the window's right edge |
| **E-STOP** | `estop` | latched, lit red |
| **Reset** | `reset`; `start` if the scope is running and the plant is not | the controllers start afresh |
| **Disconnect** | `stop`, then close | the scope stops on the last sweeps (OFFLINE); Run then shows the simulation, where the plant reads 0 |

Interpretation: Single maps to "start, sweep the window once, stop", the way a simulated Single runs from t = 0; that each Run is a fresh run follows from the plant's clock restarting at `start`. The physical plant itself is not reset by Run: the arm stays where it is.

## Safety

- **The plant is the safety authority.** If 10 of its `y` in a row go unanswered (cycles it skipped itself do not count), it applies the safe inputs, sends `estop` and stays latched until `reset`. Also when the page goes away while running ("connection lost") and on an `estop` request. Inputs are clamped to their limits in the plant too; a malformed `u` is ignored and a non-number is the safe value.
- **A stop in both directions** (the person): the page has its **E-STOP** key and its watchdog (no `y` for 10 of the plant's cycles: E-STOP, it stops answering, and asks the plant to E-stop as well); the plant has its own stop key, **Enter** in its window, which latches an E-stop the page hears and shows ("stop pressed at the plant"). **Ctrl+C** on the plant ends it cleanly: safe inputs, then an `estop` ("the plant was shut down") if it was running and a close with code 1001, so the page says why instead of "connection lost".
- **Both latch until Reset**, which goes on with the controllers afresh, so no integral wound up during the stop is carried over. Connecting to a plant that is still latched (from a lost page) shows the E-STOP; Reset clears it.
- **While latched, the scope shows what the plant applies**: the Sinks on the signals that feed the External block show its safe values, not what the controller would compute.
- **Disconnect** sends `stop` first, so a clean disconnect is not an E-stop.
- **Origins.** WebSockets have no CORS, so the script checks the Origin a browser sends: it accepts no Origin (scripts), localhost, `--allow-origin` ones, and `null`, which a page opened from a file sends (Loop Tuner's usual case). It refuses other web sites. But a sandboxed frame on any web site also sends `null`, so the default check does not stop a determined web page; `--strict-origin` refuses `null` too (then serve Loop Tuner from localhost). The person asked for no token ("Security we don't need. The plant will listen only locally"); for real hardware, use `--strict-origin`, and a token is on the roadmap. One page at a time; a second gets "busy".
- The plant's sending never blocks its cycle: if the page stops reading, `y` are dropped and counted.

## In the page

- **External plant block** (Plant tab, library group Live): its ports are the plant's, labelled on the canvas on both sides. The description is stored in the block's parameters (`url`, `rate`, `inputs`, `inUnits`, `min`, `max`, `safe`, `outputs`, `outUnits`, comma lists in the Plant tab) as design inputs, so the diagram is valid offline, where the outputs hold 0. Connecting to a plant that describes other ports gives the block the plant's (one undo step; wires to ports that no longer exist go). **While connected the block keeps the plant's ports**: an edit or an Undo that changes them is put back, with a toast, since values travel by position.
- **Speed** (header): held at 1× while connected; the readout shows "1.00× live" (Timing).
- **Run Control** gets a second row for a system with an External plant, in the same keys: **Connect / Disconnect** (green while running, amber while connected and stopped), **E-STOP** (red when latched, by either side), **Reset**. Under them always two lines, so the knobs below never move: where the plant listens (click to type) and **plant script…**, and the state; or the E-stop and its cause; or, while running, cycle rate, arrival jitter, worker or page, round trip, missed `y`, late answers (the tooltip has the plant's own figures). Systems without one show nothing of Live.
- **The status line** says LIVE with the plant's time, CONNECTED (Run starts the plant), E-STOP with the reason, or OFFLINE.
- **The scope**: live data sweeps the screen as a simulated run does. The screen shows the window [w0, w0 + W) (position w0, width W = 10 divisions); a run's plant time w0 … w0 + W is drawn where the axis says so, and each later screen width of plant time sweeps the same window again (sweep k covers w0 + kW … w0 + (k+1)W). Before w0 (the start of a run at a position > 0) nothing is drawn, as in a simulated run. Earlier sweeps fade over five; every channel, scale, position and timebase control works, and so do the FFT, Spectrogram and XY views. The first full sweep fits the channels, as Auto Scale does, unless they were set meanwhile: offline they were scaled on a plant that reads 0. Views (the arm) follow the live sweep.
- **Tuning while it runs**: every parameter of a Controller or Observer variant takes effect at the next sample and the block keeps its state (integral, filters, estimate): the laws read their parameters at every step (`controllers.js`, `observers.js`). Only a PID's start output u0 waits for the next run, as it is the integral at the start. Renaming a variant changes nothing. Anything else (blocks, wires, flipping the variant, Ts) rebuilds the page's diagram: the controllers start afresh, and a toast says so.
- **Save and the live record**: Save ▾ stores the screen (every signal, or a picture) and the live record, the last minutes of every live signal across runs ([instrument.md](instrument.md#save-the-live-record-and-references)).
- **The plant**, under **plant script…**: **hil-plant.zip** (`hil_plant.py`, `runme.sh`, `runme.ps1`, `README.txt`), the script alone, or a copy of it. The runme scripts install uv if it is missing (curl or wget on Linux and macOS; winget, else uv's own installer, on Windows) and start the plant with `uv run`, which brings Python and the websockets package. `build.mjs` puts the files of `hil/` into the bundle (`__HIL_FILES`); the page zips them (`src/core/zip.js`, stored, Unix modes so runme.sh stays executable). The claude.ai viewer's download capability takes a `.zip` but not a `.py`, so there it offers the zip and Copy.

## For agents (through the browser)

Everything a person does here an agent can do through `window.loopTuner`, documented in the page's Help (For agents) and in [AGENTS.md](../../AGENTS.md):

- `loopTuner.live.connect(url?)`, `.disconnect()`, `.estop()`, `.reset()`, `.state()` (state, run mode, the plant's description, worker or page, link and plant figures, how edits were taken); `.worker = false` runs the loop on the page.
- `loopTuner.run()`, `.stop()`, `.single()`: the scope's keys, so through the plant.
- `loopTuner.getProject()` / `setProject(p)`: change a variant's parameters while live; the loop takes them at the next sample.
- `loopTuner.record.screen(format)`, `.live(format)` (CSV or JSON text), `.reference(text, name)`, `.clearReferences()`, `.state()`.

Interpretation of "it needs to work via the browser tool": the page carries its own documentation and API, so an agent needs nothing outside it. Connecting an agent through MCP is on the roadmap.

## Architecture

| Where | What |
|---|---|
| `src/core/hil.js` | Protocol messages, the description check, the External plant block, `findExternal`, the page's watchdog (a pure function of time) and link statistics |
| `src/core/live.js` | `createLiveRunner` (a compiled diagram stepped one cycle at a time, parameter edits taken in place, safe values while latched), `createLiveLoop` (socket, runner, watchdog, Run/Stop, statistics), `liveWorker` |
| `src/core/diagram.js` | The `external` block: a node whose outputs are set from outside, whose inputs are read back, and which knows the Sinks that show its inputs (`externals`) |
| `src/core/trace.js` | Where live sweeps and references land on the screen (`sweepStart`, `refShift`), the live record, CSV and JSON |
| `src/core/zip.js` | A stored zip, for the plant's download |
| `src/ui/live.js` | The Run Control row, the worker, Run/Stop through the plant, the sweeps fed to the display, the plant dialog |
| `src/ui/record.js` | Save ▾ (screen, live record, PNG), the record length, Open and references |
| `hil/` | `hil_plant.py` (physics, server, cycle, watchdog, stop key, status), `runme.sh`, `runme.ps1`, `README.txt` |

**The loop runs in a Web Worker**, made from the page's own script: the bundle's core modules (everything before its first `ui/` module) and a call to `liveWorker(self)`, as a Blob URL. So an exported page carries it too, and drawing never delays an answer. Where a host blocks Blob workers (a strict Content Security Policy), the same loop runs on the page.

## Measured (2026-10-24, in the build container: headless Chromium, Python 3.13, websockets 17, the plant started with uv)

| | In a worker (default) | On the page |
|---|---|---|
| Plant cycle | 100.0 Hz; starts late by 1.0–1.3 ms on average (asyncio's millisecond sleep), at most 3–8 ms | the same |
| Round trip y → u | 1.2–2.9 ms on average, at most 10–15 ms | 21–44 ms on average, at most 54–126 ms |
| Page time per cycle | 0.13–0.27 ms (at most 0.5–3 ms) | similar |
| Main thread blocked 3 × 400 ms | no E-stop | the plant's watchdog trips: E-stop |

Headless software rendering makes the page's drawing slow, which exaggerates the right column, but it shows why the loop is not on the page. A desktop browser with a GPU will do better on both.

## Limits

- **Browser timing**: the page answers on message events, never on timers; the plant owns the clock. Desktop operating systems give the plant about 1 ms of timer jitter; Windows timers are coarse (about 15 ms), so the script waits out the last 2 ms of each cycle actively there (`--spin`). Untested on Windows, as is `runme.ps1` (no PowerShell in the build container); `runme.sh` was tested with uv present and on a clean home without it.
- **Background tabs**: drawing stops, the worker keeps answering. In the on-page fallback a background tab's timers are throttled, so the page's watchdog may trip late; the plant's watchdog still protects.
- **The claude.ai artifact viewer** may block `ws://127.0.0.1` (its Content Security Policy) and Blob workers. Saving goes through its download capability where the page has it (CSV, JSON, PNG, the zip); else Copy. To go live from there: Copy HTML, save it as a file, open that in the browser. The script also refuses the viewer's origin unless started with `--allow-origin`.
- **Live runs at 1×**: the plant's clock is real time (the person, [input 10](../input/2026-10-24-10-sliding-mode-and-triple-swingup.md): "in hill we are fixed to 1.0"). See Timing.
- One External plant per system, one page per plant; 1–8 inputs, 1–16 outputs, 1–1000 Hz (100 Hz tested); text frames (JSON), fine at 100 Hz, binary would be needed far above.

## The plant the page does not know

`hil_plant.py` varies its plant (the person, input 10): each physical parameter (R, L, k, J, b, Tc, m g l) differs from nominal by a random factor within ±15 % (`--vary 0.15`, the default; `--vary 0` is the nominal plant). `--seed N` gives the same plant again (the seed is printed; a new one each start otherwise), `--set J=0.003` fixes a parameter. The script prints the plant it runs, for the person at the plant; the page is not told, as with a real device: the description carries ports, not physics. The library's hand-picked gains hold across the range. Identifying the plant from the page (the person: an Identification step before Auto-tune and Analysis, so both work for HIL) is separate work on the roadmap. `--check` runs the nominal physics.

## A plant of your own

Keep `hil_plant.py`'s server, cycle, watchdog and status, and replace its `Motor` with your device's I/O: `INPUTS` and `OUTPUTS` are the description, `advance(span, u)` applies the inputs for a span of time, `outputs()` reads the measurements. Any language works if it speaks the protocol above (the person: "I'm not bound on Python"). Then add an External plant block to a system, or connect "HIL: external motor": the block takes the new plant's ports.

## Not yet

- A plant that runs its own loop and takes the reference r from the page (the protocol allows it; `hil_plant.py` does not do it yet).
- Signals the plant only logs (outputs it sends that are not ports, for "just to log stuff"); today every output is a port, and the live record logs them all.
- Identifying the plant from the page (it varies by ±15 % and is not described), so Auto-tune and Analysis work for HIL: designed in [identification.md](identification.md) (the Identify tab, being built), with the protocol's additions it needs first (output ranges in `describe` and an E-stop beyond them, `applied` in each `y`; its §15).
- An agent tuning through MCP; remote plants (wss://, a token); several External blocks; the plant recording on its side; a trigger for live sweeps beyond the window alignment.
