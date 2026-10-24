# Live mode (HIL): an external plant

Reader: whoever changes Live mode, its protocol, the plant script or Record. **Status: built 2026-10-24 (v2.7).** The person's words are the last section of [../input/2026-10-24-09-analysis-autotune-triple-swingup.md](../input/2026-10-24-09-analysis-autotune-triple-swingup.md): "a HIL mode … a Python script that you run with uv … our external plant … 100 Hertz … if we miss 10 cycles, we push an emergency stop … tune a controller here … against the external thing running … store traces. So if I set a trace to 5 minutes, I should be able to store that."

**A system can have its plant outside the page. The plant runs in real time on its own clock; every cycle it sends its outputs, the page runs the rest of the diagram (Sources, Controller blocks, anything else) against them and answers at once with the inputs to apply. The controller is tuned in the page while the plant runs.** The System library's **HIL: external motor** is made for it, and its plant, `hil/hil_plant.py`, ships in the page.

## Why the plant is the server

A web page cannot listen on a TCP or UDP port. It can open a WebSocket client to `ws://127.0.0.1:PORT`: localhost counts as a potentially trustworthy origin, so even an https page may connect to it (no mixed-content block). So the plant script is the server, and the page connects to it. A standalone HTML file opened from disk works; the claude.ai artifact viewer may block the connection (see Limits).

## The protocol: `loop-tuner-hil/1`

JSON-RPC 2.0, one message per WebSocket text frame, by default at `ws://127.0.0.1:8765`. Requests carry an `id` and get a `result` or an `error`; notifications have no `id` and get no answer.

| From → to | Method | Kind | Params → result |
|---|---|---|---|
| page → plant | `describe` | request | → `{ protocol, name, rate_hz, watchdog_cycles, inputs: [{ name, unit, min, max, safe }], outputs: [{ name, unit }], running, estop }` |
| page → plant | `start` | request | → `{ rate_hz }`. The plant restarts its clock (seq 0, t 0) and sends `y` every cycle. Refused (`-32000`) while an E-stop is latched. |
| page → plant | `stop` | request | → `{}`. Safe inputs, no more `y`. A clean stop, not an E-stop. |
| page → plant | `reset` | request | → `{}`. Clears a latched E-stop. |
| page → plant | `estop` | request | `{ reason }` → `{}`. Latches an E-stop now (the page's E-STOP key, the page's watchdog). |
| plant → page | `y` | notification, every cycle | `{ seq, t, y: [...] }`: seq counts cycles from 0 at `start`, t = seq / rate_hz in seconds, y in the order and units of `outputs`. |
| page → plant | `u` | notification, one per `y` | `{ seq, u: [...] }`: seq of the `y` it answers, u in the order and units of `inputs`. |
| plant → page | `estop` | notification | `{ reason, t }` when the plant stops itself. |
| plant → page | `status` | notification, once a second | `{ t, rate_hz, jitter_ms: { mean, max }, rtt_ms: { mean, max }, late, overruns, dropped, running, estop }` |

Errors use the JSON-RPC codes: `-32700` not JSON, `-32600` not a request, `-32601` no such method (the message lists the methods), `-32000` refused (E-stop latched).

**Units**: every value is in the unit its port declares in `describe`; times are in seconds. Names and units go once, in the description, which is the contract; each cycle's messages carry only `seq`, `t` and the numbers, so 100 Hz stays small (about 80 bytes a message). Interpretation of "units and seq/t in every message".

```
→ {"jsonrpc":"2.0","id":1,"method":"describe"}
← {"jsonrpc":"2.0","id":1,"result":{"protocol":"loop-tuner-hil/1","name":"DC motor with an unbalanced arm (simulated)","rate_hz":100,"watchdog_cycles":10,
     "inputs":[{"name":"V","unit":"V","min":-12,"max":12,"safe":0},{"name":"load","unit":"N·m","min":-0.2,"max":0.2,"safe":0}],
     "outputs":[{"name":"angle","unit":"rad"},{"name":"speed","unit":"rad/s"},{"name":"current","unit":"A"}],"running":false,"estop":null}}
→ {"jsonrpc":"2.0","id":2,"method":"start"}
← {"jsonrpc":"2.0","id":2,"result":{"rate_hz":100}}
← {"jsonrpc":"2.0","method":"y","params":{"seq":0,"t":0,"y":[0,0,0]}}
→ {"jsonrpc":"2.0","method":"u","params":{"seq":0,"u":[0,0]}}
   … at t = 0.5 s the reference steps to 1.5 rad; the P controller (Kp 2) answers
← {"jsonrpc":"2.0","method":"y","params":{"seq":50,"t":0.5,"y":[0,0,0]}}
→ {"jsonrpc":"2.0","method":"u","params":{"seq":50,"u":[3,0]}}
← {"jsonrpc":"2.0","method":"y","params":{"seq":51,"t":0.51,"y":[0.002,0.41,1.38]}}
→ {"jsonrpc":"2.0","method":"u","params":{"seq":51,"u":[2.996,0]}}
```

## Timing

- **The plant owns the clock.** It runs a fixed step at `rate_hz` against absolute deadlines (start + k·dt), so sleep errors never add up, and it reports how late each cycle starts (jitter). A stall longer than 5 cycles is skipped over in one physics step; the skipped cycles show as a gap in `seq`.
- **Each cycle** the plant integrates its physics over the cycle just ended, applying each `u` from the moment it arrived (so the loop's delay is the real round trip, about 2 ms, not a whole cycle), then checks its watchdog, then sends `y`.
- **The page answers each `y` at once**: the External plant block's outputs become y; the rest of the diagram advances to t (Sources play at t, Controller blocks sample at their own Ts on the plant's clock, continuous blocks integrate between cycles with y held); the block's inputs are read, clamped to [min, max] (a value that is not a number becomes the safe one) and sent as `u` with the same seq.

## Safety

- **The plant is the safety authority.** If 10 of its `y` in a row go unanswered (cycles it skipped itself do not count), it applies the safe inputs, sends `estop` and stays latched until `reset`. Also when the page goes away while running ("connection lost") and on an `estop` request. Inputs are clamped to their limits in the plant too; a malformed `u` is ignored and a non-number is the safe value.
- **The page's watchdog**: no `y` for 10 of the plant's cycles is "plant silent": the page shows E-STOP, stops answering (its controller stops), and asks the plant to E-stop as well. Latched until Reset.
- **Reset** clears both latches and starts again with the controllers afresh, so no integral wound up during the stop is carried over. Connecting to a plant that is still latched (from a lost page) shows the E-STOP; Reset starts.
- **Disconnect** sends `stop` first, so a clean disconnect is not an E-stop.
- **The script listens on 127.0.0.1 only and accepts pages from a file (Origin `null`), from localhost, or from `--allow-origin`.** WebSockets have no CORS: without the check, any web site the person visits could drive the plant. One page at a time; a second gets "busy".
- The plant's sending never blocks its cycle: if the page stops reading, `y` are dropped and counted.

## In the page

- **External plant block** (Plant tab, library group Live): its ports are the plant's. The description is stored in the block's parameters (`url`, `rate`, `inputs`, `inUnits`, `min`, `max`, `safe`, `outputs`, `outUnits`, comma lists in the Plant tab) as design inputs, so the diagram is valid offline, where the outputs hold 0. When the plant describes different ports, connecting gives the block the plant's (one undo step; wires to ports that no longer exist go).
- **Run Control** gets a second row for a system with an External plant, in the same keys: **Connect / Disconnect** (lit green while running), **E-STOP** (lit red when latched, by either side), **Reset**. Under it, where the plant listens (click to type) and **plant script…**; while running instead: cycle rate, arrival jitter, worker or page; round trip, missed `y`, late answers (the tooltip has the plant's own figures). Systems without one show nothing of Live. Interpretation: the person asked for a Live mode in the run control; a separate group would push the Vertical knobs off the screen.
- **The status line** says LIVE with the plant's time, E-STOP with the reason, or OFFLINE.
- **The scope**: live data sweeps the screen as the simulation does. Each sweep is one run, so earlier sweeps fade over five, and a change can be compared with the sweeps before. A sweep starts at a multiple of the screen's width in plant time, so sweeps line up with an input whose period fits the screen, as simulated runs do (they start at t = 0). Run/Stop freezes the screen, never the loop; Single freezes after the sweep under way; the time axis is time within the sweep. Every channel, scale, position and timebase control works as before. The first full sweep fits the channels, as Auto Scale does, unless they were set meanwhile: offline they were scaled on a plant that reads 0. Views (the arm) follow the live sweep.
- **Tuning while it runs**: a parameter of a Controller variant takes effect at the next cycle and the controller keeps its state (its integral, its filters). Anything else (blocks, wires, flipping the variant, Ts, a prefilter Tr) rebuilds the page's diagram: the controllers start afresh, and a toast says so.
- After Disconnect the last live sweeps stay on the screen (OFFLINE) until Connect, or until a system without an External plant loads.
- `window.loopTuner.live`: `connect()`, `disconnect()`, `estop()`, `reset()`, `state()` (state, where the loop runs, link and plant figures, how edits were taken), `csv()`; `worker = false` runs the loop on the page.

## Architecture

| Where | What |
|---|---|
| `src/core/hil.js` | Protocol messages, the description check, the External plant block, the page's watchdog (a pure function of time) and link statistics |
| `src/core/live.js` | `createLiveRunner` (a compiled diagram stepped one cycle at a time, parameter edits taken in place), `createLiveLoop` (socket, runner, watchdog, statistics), `liveWorker` |
| `src/core/diagram.js` | The `external` block: a node whose outputs are set from outside and whose inputs are read back (`externals`) |
| `src/ui/live.js` | The Run Control row, the worker, the sweeps fed to the display, Record and references, the plant script dialog |
| `hil/hil_plant.py` | The plant: physics, server, cycle, watchdog, status. `build.mjs` embeds its text (`__HIL_PLANT_PY`) for download |

**The loop runs in a Web Worker**, made from the page's own script: the bundle's core modules (everything before its first `ui/` module) and a call to `liveWorker(self)`, as a Blob URL. So an exported page carries it too, and drawing never delays an answer. Where a host blocks Blob workers (a strict Content Security Policy), the same loop runs on the page.

## Measured (2026-10-24, in the build container: headless Chromium 153, Python 3.13, websockets 17, the plant started with uv)

| | In a worker (default) | On the page |
|---|---|---|
| Plant cycle | 100.0 Hz; starts late by 1.0–1.2 ms on average (asyncio's millisecond sleep), at most 4–8 ms | the same |
| Round trip y → u | 1.7–2.9 ms on average, at most 10–15 ms | 21–44 ms on average, at most 54–126 ms |
| Page time per cycle | 0.13–0.27 ms (at most 0.5–3 ms) | similar |
| Cycles without a fresh u | 2–5 in the first 6 s | 120 in the first 6 s (20 %) |
| Main thread blocked 3 × 400 ms | no E-stop; late answers grow at their usual rate (2 → 2, 6 → 9 in two runs) | the plant's watchdog trips: E-stop |

Headless software rendering makes the page's drawing slow, which exaggerates the right column, but it shows why the loop is not on the page. A desktop browser with a GPU will do better on both.

## Limits

- **Browser timing**: the page answers on message events, never on timers; the plant owns the clock. Desktop operating systems give the plant about 1 ms of timer jitter; Windows timers are coarse (about 15 ms), so the script waits out the last 2 ms of each cycle actively there (`--spin`).
- **Background tabs**: drawing stops, the worker keeps answering. In the on-page fallback a background tab's timers are throttled, so the page's watchdog may trip late; the plant's watchdog still protects.
- **The claude.ai artifact viewer** may block `ws://127.0.0.1` (its Content Security Policy), Blob workers and downloads. There: Copy HTML and open the page from a file; Save becomes Copy CSV; the plant script dialog offers Copy. The script also refuses that viewer's origin unless started with `--allow-origin`.
- One External plant per system, one page per plant; 1–8 inputs, 1–16 outputs, 1–1000 Hz (100 Hz tested); text frames (JSON), fine at 100 Hz, binary would be needed far above.
- The plant's clock restarts at each `start`; sweeps and the record use it.

## Record

The scope's deep memory, live or simulated: [instrument.md](instrument.md#record-and-references).

## A plant of your own

Keep `hil_plant.py`'s server, cycle, watchdog and status, and replace its `Motor` with your device's I/O: `INPUTS` and `OUTPUTS` are the description, `advance(span, u)` applies the inputs for a span of time, `outputs()` reads the measurements. Any language works if it speaks the protocol above. Then add an External plant block to a system, or connect "HIL: external motor": the block takes the new plant's ports.

## Not yet

- Signals the plant only logs (not ports), several External blocks, remote plants (wss://, authentication), the plant recording on its side, a trigger for live sweeps beyond the period alignment.
