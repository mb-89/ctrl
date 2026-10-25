# Research: running the page's simulation core outside the browser

Reader: whoever changes how the external HIL simulator runs the page's JavaScript core, or wants to know why it runs the way it does ([../output/hil-simulator.md](../output/hil-simulator.md)).

**Bottom line: the simulator stays a Python script run by uv, and runs the page's own core in V8 inside the Python process (PyPI `mini-racer`, one more dependency in the script's header, installed by uv like websockets).** It keeps the window with its STOP, the asyncio server and the reviewed safety code, installs exactly as today, in one click (the runme script bootstraps uv from winget or, on Linux, uv's installer; uv runs the script and installs everything it needs, never pip: [inputs 26](../input/2026-10-25-26-hil-python-through-uv.md) and [27](../input/2026-10-25-27-runme-bootstraps-from-winget.md)), and its per-cycle cost on the heaviest library plants is 0.8–1.1 ms on average, at most 13 ms, well inside 100 and 200 Hz. Node.js is faster per call but has no window toolkit and comes in uneven versions from Linux package managers; QuickJS has no Windows or macOS wheels for current Pythons and computes transcendental functions differently from V8.

## How this was measured (2026-10-25)

- In the build container: 4 cores, load average below 1, Linux x86_64; Node 22.22 (V8 12.4), Python 3.13 by uv, `mini-racer` 0.14.1 (V8 inside Python), `quickjs` 1.19.4 (QuickJS inside Python), `nodejs-wheel-binaries` 24.19 (Node from PyPI, run as a child process), Bun 1.4.4 (JavaScriptCore), headless Chromium 153.
- **The code run is the page's own**: the core modules of the page's bundle (`build.mjs`'s `bundleScript`, everything before its first `ui/` module, 384 KB), so every runtime ran the same text the page runs.
- **The plant**: a library system's diagram with its Controller block replaced by a Source `u` (the page's u), compiled with `compileDiagram` and stepped one cycle at a time with the page's RK4, in as many substeps as the diagram's step bound asks (the triple pendulum: 2 at 100 Hz; the encoder example: 20 at 100 Hz, its 70 Hz shaft and 2 ms armature).
- **The loop**: as `hil_plant.py` runs it, absolute deadlines (start + k·dt) and `asyncio.sleep`, one call into the engine per cycle, 15 s per run. Node: the same loop with `setTimeout`. "Calc" is the time of one cycle's call, as the Python plant sees it (with the crossing into the engine); "late" is how late a cycle began.

## Cycle time and jitter

Calc and late in ms: mean / p99 / max.

| Runtime | Plant | Rate | Calc | Late |
|---|---|---|---|---|
| Node 22 (in process) | Triple pendulum | 100 Hz | 0.046 / 0.137 / 1.99 | −0.29 / 0.38 / 1.02 |
| | | 200 Hz | 0.037 / 0.097 / 0.57 | −0.33 / 0.21 / 4.72 |
| | Encoder example | 100 Hz | 0.090 / 0.171 / 1.02 | −0.28 / 0.31 / 0.72 |
| | | 200 Hz | 0.061 / 0.126 / 0.93 | −0.32 / 0.26 / 1.84 |
| **V8 in Python (mini-racer)** | Triple pendulum | 100 Hz | 0.93 / 1.76 / 9.0 | 1.15 / 2.20 / 3.91 |
| | | 200 Hz | 0.77 / 1.45 / 8.0 | 0.65 / 1.21 / 3.28 |
| | Encoder example | 100 Hz | 1.11 / 1.77 / 9.6 | 1.15 / 2.25 / 3.78 |
| | | 200 Hz | 0.76 / 1.45 / 13.0 | 0.67 / 1.19 / 9.07 |
| QuickJS in Python | Triple pendulum | 100 Hz | 0.26 / 0.43 / 1.73 | 1.22 / 2.20 / 2.38 |
| | | 200 Hz | 0.17 / 0.26 / 0.67 | 0.67 / 1.22 / 3.35 |
| | Encoder example | 100 Hz | 1.25 / 1.60 / 3.07 | 1.13 / 2.23 / 2.33 |
| | | 200 Hz | 0.63 / 0.84 / 9.26 | 0.69 / 1.23 / 9.04 |
| Node from PyPI, a child of Python (a line of JSON each way) | Triple pendulum | 100 Hz | 0.39 / 0.74 / 2.84 | 1.23 / 2.22 / 6.11 |
| | | 200 Hz | 0.35 / 0.75 / 7.73 | 0.70 / 1.25 / 3.28 |
| | Encoder example | 100 Hz | 0.44 / 0.80 / 5.38 | 1.25 / 2.22 / 3.29 |
| | | 200 Hz | 0.36 / 0.72 / 6.06 | 0.67 / 1.23 / 1.87 |
| Bun 1.4 (single binary) | Triple pendulum | 100 / 200 Hz | 0.041 / 0.123 / 2.26; 0.025 / 0.088 / 0.52 | −0.28 / 0.21 / 17.5; −0.35 / 0.17 / 0.66 |
| | Encoder example | 100 / 200 Hz | 0.065 / 0.152 / 2.80; 0.040 / 0.106 / 2.31 | −0.34 / 0.20 / 0.50; −0.36 / 0.24 / 2.30 |

- **The physics is not the cost.** V8 computes a cycle of the heaviest plants in 0.04–0.09 ms. Through mini-racer the call costs about 0.7 ms more: mini-racer runs V8 on a thread of its own and hands each call over through an asyncio future; in a tight loop a trivial call costs 0.2 ms (p99.9 3.4 ms). Its occasional 8–13 ms is that thread handover under the GIL.
- **What that means for the plant**: at 100 Hz the worst call is one cycle; at 200 Hz the worst (13 ms) makes two or three cycles late once in a while, which the plant already handles (a late cycle integrates the time it missed; the watchdog counts only unanswered `y`). Both rates hold: 100.1 and 200.1 Hz achieved in every run. The round trip through the browser (2.2–2.4 ms on average, p99 10–11 ms, hil.md) stays the larger part.
- **Lateness of the cycle's start** (about 1.2 ms at 100 Hz, 0.7 at 200) is Python's `asyncio.sleep`, the same for every engine inside Python, and the same as today's plant.

## Loading

| Runtime | Load the core and build the plant |
|---|---|
| Node 22 | 18–22 ms |
| V8 in Python (mini-racer) | 59–64 ms |
| QuickJS in Python | 37–38 ms |
| Node child of Python | 43–91 ms |

## Install

| Runtime | What the person installs | Size | Windows (winget only) | Linux (package manager only) |
|---|---|---|---|---|
| **V8 in Python (mini-racer)** | nothing new: uv installs `mini-racer` with websockets, from the script's header | installed 39 MB (Windows), 61 MB (macOS arm64), 82 MB (Linux x86_64 and arm64), once into uv's cache; the Linux download is 21 MB (measured from an empty cache: with uv's Python, 3 s here) | uv by winget, as today | uv by its installer (curl from the package manager if needed), as today |
| QuickJS in Python | nothing new (uv) | 3.8 MB | **no wheel** for Python 3.13 or later on Windows or macOS (wheels stop at 3.12); uv would have to be pinned to an older Python, or compile C | Linux x86_64 only for 3.13; none for arm64 |
| Node from PyPI, a child of Python | nothing new (uv installs `nodejs-wheel-binaries`) | 204 MB installed (Node 24 with npm) | yes | yes |
| Node.js alone | Node: `winget install OpenJS.NodeJS.LTS`; Linux: the distribution's `nodejs` | about 30 MB download, 100 MB installed | yes | **uneven**: Ubuntu 22.04's is Node 12, too old for the core (`??=`, `structuredClone`, `Object.hasOwn`); Debian 12 and Ubuntu 24.04 have 18; others current |
| Bun | a single binary, by its installer or winget | 103 MB | yes | its own installer (curl) |

## The same numbers in every engine?

The core's arithmetic (+, −, ×, ÷, √) is exact IEEE 754 everywhere, so a diagram's sums, gains, state-space products and RK4 combine to the same bits in every engine. **Transcendental functions are not**: a hash of 20 000 results of each function, per engine:

| Function | Node 22 | Chromium 153 | V8 in Python | QuickJS | Bun |
|---|---|---|---|---|---|
| sqrt, tanh | A | A | A | A | A |
| sin, cos, tan | A | **B** | C (tan: A) | D | D |
| exp, log | A | **B** | A | D | D |
| pow | A | B | B | B | B |
| atan2, atan | A | B (atan2) | A | D | D |

(same letter: the same bits.) **Not even Node and Chromium agree**: V8 changed its math library between 12.4 (Node 22) and the Chromium of today. So no runtime outside the page is bit for bit the person's browser, and the browser of next year will not be bit for bit this one. What the simulator promises instead:

- **The same code**: the page's own bundle, never a port (input 22: "don't duplicate code").
- **Sample for sample within one engine**: the simulator's plant, fed the u the page's simulation computed, gives the page's simulation's outputs bit for bit when both run in the same engine. The tests check it in Node, for every library system (the output design, Tests).
- **Across engines**: differences in the last bit of a sine, which a chaotic plant (the triple pendulum without control) grows over seconds, and a controlled plant does not. They are far below the ±15 % the simulator varies the plant by on purpose.

## The window, the server and the safety

- **Python** has tkinter in uv's own Python builds (hil.md): the STOP window, as today. The asyncio server, the watchdog, who-latched-resets, frames in order, the log, the bench and the two reviews' fixes stay as they are, with their tests.
- **Node and Bun** have no window toolkit. A STOP there would be a page the plant serves on localhost, opened in a browser: a second browser tab is a weaker STOP than a window of the plant's own (it depends on the browser that also runs the page under test), and the whole safety layer would be written again in JavaScript, with its tests: a rewrite of reviewed code with nothing gained for the person.
- **Node from PyPI as a child** keeps the window but adds a second process the plant must watch (a child that dies is a lost plant) and a 200 MB install, for 0.4 ms less per cycle.

## Choice

**V8 inside the Python plant, through `mini-racer`, installed by uv.** It is the only option that keeps the plant's window and its reviewed safety code, installs exactly as today (one dependency more in the script's header, fetched by uv; the runme scripts still bootstrap uv from winget or uv's installer, inputs 26 and 27), has wheels for every platform the runme scripts serve (Windows, macOS, Linux on x86_64 and arm64, any CPython from 3.10), and runs the same engine family as the page. Its cost, about 1 ms a cycle with rare spikes to 13 ms, fits 100 and 200 Hz.

Kept in reserve, measured: Node from PyPI as a child process (`nodejs-wheel-binaries`), if mini-racer ever lags behind a platform; the plant's code would change only in how it calls the core.

Not chosen: QuickJS (no wheels for current Pythons on Windows and macOS; an older engine that needed two polyfills, `Object.hasOwn` and `structuredClone`, to run the core, and will need more as the core grows; other bits than V8); Node or Bun alone (no window; the safety rewritten; Node's Linux packages too old in places).

## Notes for whoever builds on it

- mini-racer's context must be closed (`close()`) at the end, or its V8 thread keeps the process alive after the plant ends.
- mini-racer needs Python 3.10 or later: the script's header says so (uv picks its own Python anyway).
- The core needs `structuredClone`, which V8 inside Python does not have (it is a host function, not JavaScript): the bundle's prelude defines it as a JSON round trip, which is exact for the core's plain-data use.
