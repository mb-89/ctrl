# Research: browserio

Reader: whoever implements this part of Loop Tuner. Gathered by a research agent and checked by a skeptical reviewer on 2026-10-24; the reviewer's corrections are listed first and override the findings where they disagree.

## Reviewer's corrections

- performance.now resolution. '100 µs normally, 5 µs when cross-origin isolated' is the Chrome/MDN value only. Firefox (privacy.reduceTimerPrecision) and Safari coarsen non-isolated pages to about 1 ms. So in Firefox or Safari, the in-app rate test cannot resolve the ~1 ms p50 round trip it is meant to measure. Compute RTT and jitter from plant-side time.perf_counter timestamps (echoed k) and treat page-side numbers as coarse.
- 'The artifact CSP blocks WebRTC' is unreliable. The CSP 'webrtc' directive is absent from MDN browser-compat-data. Secondary sources (a CSP docs site and a Drupal issue) report that Chrome ignores it as an unrecognized directive, and WebKit bug 255651 asking for it is still open. What actually stops WebRTC from an artifact is connect-src 'self' (no signalling to a local server) and, once Chrome gates WebRTC, LNA. Say 'connect-src blocks the signalling path' instead. Do not build on WebRTC either way.
- 'Not for pendulum-stabilising loops' overreaches on the stated phase-budget argument. A single cart-pendulum has an unstable pole p = sqrt(g/l) of about 4–6 rad/s (l = 0.3–0.6 m) and needs a crossover of about 2p, roughly 10 rad/s. That fits inside the research's own 13 rad/s budget at 100 Hz. A delay of τ = 1.5·Ts = 15 ms gives p·τ < 0.1, well inside the usual stabilisability bound. The 0.2 rad budget is a self-chosen conservative margin, not a limit. The valid reasons to keep pendulums out of browser-in-the-loop mode are non-deterministic stalls (measured max 9–58 ms; GC; tab freezing) and safety, plus faster unstable poles for double and triple pendulums. State those reasons instead.
- Energy Saver freezing is stated too broadly and its exemption list is incomplete. Per chromestatus 5158599457767424, Chrome freezes a hidden, silent tab after 5 minutes only when Energy Saver is active AND the tab exceeds a CPU threshold (calibrated to freeze about 10% of background tabs). The exemptions also include Web Bluetooth, holding a Web Lock (or an IndexedDB connection that blocks another), and a BackgroundPageFreezeOptOut origin trial, not only Serial/USB/HID and an open RTCDataChannel. A Web Lock is a cheap mitigation to test.
- Hidden-tab claims conflate two things. Window-timer throttling (1/s, intensive 1/min) and the rAF stop do not affect a controller that runs in a dedicated Worker and is driven by WebSocket onmessage, which is exactly the recommended design. So 'the plant watchdog will trip' in hidden tabs holds only for freezing, discarding or OS sleep. The 'disarm on visibilitychange' policy also has a usability cost. Chrome reports a fully occluded window as hidden (native occlusion tracking on Windows, a heuristic on macOS), so covering the browser with the terminal or IDE running the plant would disarm the loop. Present it as an option, not a necessity.
- Windows/Python timing is partly outdated. Since Python 3.13, time.monotonic (and therefore asyncio's loop.time) uses QueryPerformanceCounter (<1 µs), not GetTickCount64. The asyncio-platforms '15.6 ms' text is stale. What still quantises is the Proactor/IOCP wait timeout (ms granularity, 15.6 ms system tick unless timeBeginPeriod). The thread + time.sleep (3.11+ high-resolution waitable timer) + spin advice stays valid.
- The benchmark figures are only partly backed by saved artifacts. /tmp/claude-0/-home-user-ctrl/281fed85-1c0b-52ae-b29a-1fd26dd76401/scratchpad/wsbench/plant.out holds one 5 s run (500 ticks: RTT p50 0.94, p99 3.68, max 8.4 ms; tick lateness max 6.2 ms), then a crash with 'address already in use'. The 'p99 14 ms, max 53 ms' upper ends cannot be traced, and a p99 from 500 samples is statistically weak. A 20 s rerun here (2000 ticks) gave RTT p50 0.93, p99 4.1, max 11.7 ms, and plant tick lateness p99 4.0 ms, max 57.9 ms. That is a 58 ms stall on the Python plant side.
- The 58 ms plant-side stall undercuts 'the plant (or bridge) owns the real-time clock' and 'Mode C: controller runs inside the plant or bridge at ≥1 kHz'. An asyncio Python or Node process on a desktop OS is soft real time at best. Deterministic ≥1 kHz loops belong on an MCU, PLC or RT kernel; a desktop bridge should be described as ≤100–200 Hz soft real time or supervisory. Also, the watchdog counts ticks, so a stall in the plant's own loop never trips it. Add a wall-clock check: monotonic time since the last valid u > 100 ms, plus a tick-overrun counter.
- The cited template plant.py contradicts the research's own safety advice. Its clamp max(-1.0, min(1.0, float(u))) maps NaN to +1.0, i.e. full output (verified: Python min/max return the first argument when compared with NaN). Python's json.loads also accepts NaN and Infinity tokens by default, so a non-browser client can deliver NaN. Validate with math.isfinite (or json.loads(parse_constant=...) that raises) before clamping. The script also has no Origin or token check and no E-stop on socket close. Fix it before reusing it as the HIL template.
- The protocol note on ws.bufferedAmount ('skip telemetry, never u') mixes directions. Telemetry flows plant→page, and ws.bufferedAmount is a browser API that only covers what the page sends, which is u. The plant side must check its own write buffer (e.g. the websockets connection's transport.get_write_buffer_size()) to drop telemetry.

## Missing (per the reviewer)

- wss:// to a local server with a locally trusted certificate (e.g. mkcert installing a local CA for 127.0.0.1/localhost) is the only route that also works from an https-hosted page in Safari, which blocks ws:// to localhost as mixed content. Chrome and Firefox still show the LNA prompt for it.
- LNA prompt from a Worker. Chrome's LNA blog says Service and Shared Workers need the permission already granted, and a way for workers to trigger the prompt is still in progress (crbug 404887282). Dedicated workers are not addressed. For the https-hosted case (c), open the first WebSocket (or a probe fetch) from the document to get the grant, then hand over to the Worker. Add this to the test matrix.
- DNS rebinding and the 'null' Origin. The bridge should validate the Host header (only 127.0.0.1:PORT / localhost:PORT), especially for any HTTP/JSON-RPC endpoint, because the Origin check does not stop rebinding against plain HTTP. In file:// mode the Origin allowlist must accept 'null', which any sandboxed iframe on any site can also send. The session token is then the only real control, so make it mandatory.
- fetch/XHR from a file:// page (Origin null) to the bridge needs CORS response headers (Access-Control-Allow-Origin: null or *); WebSocket does not. The research mentions fetch but not this asymmetry.
- Delay-aware design in the Design layer. Besides simulating the extra z⁻¹, state-feedback/LQR gains for browser-in-the-loop mode should be computed on the delay-augmented discrete model (state [x_k; u_{k−1}]) or with a one-step state predictor. Otherwise the gains the tool computes do not account for the one-sample delay.
- The matrix covers only loopback. If the plant or bridge sits on another LAN host (Raspberry Pi, PLC at 192.168.x.x), Chrome https pages need the separate 'local-network' permission (mixed content is relaxed for private IP literals only after it is granted). Firefox 153+/154+ prompt too. Safari blocks it as mixed content from https. File:// and LAN-served cases are untested.
- Chrome Memory Saver can discard an inactive tab entirely, which is separate from freezing. The plant watchdog covers it, but the UI should say the HIL session ends if the tab is discarded.
- IWA platform outlook. Chrome 152 admin release notes (secondary source, helentech.jp) list policy-based IWA installation on enterprise-managed Windows as planned for Chrome 161. 'ChromeOS only' is correct today but should be dated.
- Firefox 153 added a developer 'Local Mode' that loads a local directory under a custom origin without a web server. It could avoid file:// opaque-origin restrictions in Firefox; it is untested here and worth noting alongside the file:// caveats.
- Functional-safety references. Beyond ISO 13850 and IEC 60204-1, the safety levels of the stop function are rated under ISO 13849-1 / IEC 62061. Worth one line, since a software watchdog over WebSocket cannot claim any rated level.

Reviewer confidence: high

## Summary

No. An ordinary HTML page cannot listen on a TCP or UDP port in any browser. The only API that can is Direct Sockets (TCPServerSocket, bound UDPSocket, shipped in Chrome 131), and it works only in Isolated Web Apps. Those can be installed by policy only on enterprise-managed ChromeOS. Firefox's position on it is negative and WebKit has given no signal. What a page can do is connect out as a WebSocket client (or fetch) to a small local bridge on 127.0.0.1. The bridge talks UDP, JSON-RPC or serial to the plant, or is the uv-run Python plant itself. Which browsers allow that link depends on where the page comes from. Served by the bridge at http://127.0.0.1:PORT, it works everywhere with no prompt. Opened from file://, it works in Chrome with no prompt, because Chromium treats file: as loopback. Hosted on an https site, Chrome 147+ and Firefox 154+ ask for a local-network permission first, and Safari blocks ws://localhost outright (WebKit bug 171934, still open). A claude.ai artifact is almost certainly blocked: a third-party analysis reports connect-src 'self' and webrtc 'block' in its CSP, and the cross-origin iframe has no loopback-network delegation. The plant (or the bridge) should own the real-time clock, the watchdog and the fail-safe output; the browser should react to each sample in a Worker and do control at ≤100–200 Hz, or only supervise and tune. In a shared VM, a uv/websockets plant at 100 Hz with a Node WHATWG-WebSocket client standing in for the browser gave round-trip p50 ≈ 1 ms, p99 3.7–14 ms, max 9–53 ms, with no 10-tick watchdog trips.

## Recommendations

### 1. Answer the question: a page cannot listen, so it connects out to a local bridge

**What.** Tell the person plainly that no standard web API lets a page bind, listen or accept connections on TCP or UDP. Pages are untrusted clients by design. The only exception is the Direct Sockets API (TCPSocket, UDPSocket with a bound mode, TCPServerSocket), and it is limited to Isolated Web Apps. A JSON-RPC server or UDP endpoint therefore has to live in a separate process, and the page connects to it as a WebSocket client.

**How.** Status details for the answer:
- Direct Sockets shipped in Chrome 131, for IWAs only.
- IWAs shipped in Chrome 128 and are installable only through the IsolatedWebAppInstallForceList policy on enterprise-managed ChromeOS. Other desktops get them only through a developer-mode flag.
- Multicast was added in Chrome 144.
- In Chrome 151, IWA manifests swap 'direct-sockets-private' for the 'local-network' and 'loopback-network' policies.
- Firefox position: negative. WebKit: no signal.
- WebRTC is not a listening socket either: it only accepts traffic from a peer that has finished signalling, ICE and DTLS.

Architecture: plant or device ⇄ (UDP, JSON-RPC over TCP/HTTP, serial, CAN, …) ⇄ bridge process ⇄ WebSocket ⇄ page. In the HIL mode the person described, the uv-run Python plant can itself be the WebSocket server, so no separate bridge is needed. Use the ws://127.0.0.1:PORT literal rather than 'localhost', to avoid mismatches between IPv6 ::1 and an IPv4 bind.

**Why.** This is the direct answer to 'can a standalone HTML listen at some port'. It also sets the shape for the HIL feature.

### 1. Have the bridge serve the page (http://127.0.0.1:PORT); support file:// as second choice

**What.** The best way to open the page in HIL mode is from the bridge itself, with the same single HTML file and the WebSocket on the same host and port. Then the link is same-origin and loopback→loopback: no CORS, no mixed content, no Local Network Access prompt, and a secure context in Chrome and Firefox. Opening the file from disk (file://) also works, with caveats. A page on a public https site works only after a permission prompt in Chrome and Firefox, and not at all in Safari.

**How.** The bridge answers GET / with the HTML and upgrades /ws to a WebSocket.

Matrix to document and test:
(a) http://127.0.0.1:PORT page → ws://127.0.0.1:PORT: works in Chrome, Firefox and Safari; no prompt.
(b) file:// page:
- Chromium classifies file: documents as loopback (ip_address_space_util.cc: 'if (url.SchemeIsFile()) return kLoopback'), so there is no LNA prompt.
- The origin is opaque, so the WebSocket handshake carries Origin 'null' (or 'file://').
- Workers must be created from a Blob URL of inline source. new Worker('w.js') fails from file://.
- Firefox 153+ LNA behaviour for file:// and Safari behaviour are untested; test them.
(c) https://public page → ws://127.0.0.1:
- Chrome: loopback counts as potentially trustworthy, so it is not mixed content. Since Chrome 147 it needs the 'loopback-network' permission prompt. Chrome 145 split the permission into local-network and loopback-network; the old name 'local-network-access' remains an alias.
- Firefox: localhost has been exempt from mixed content since 55/84, and WebSockets since bug 1376309 (fixed 2020). LNA has been on by default since Firefox 153 and covers WebSockets since 154.
- Safari: blocks it as mixed content (WebKit 171934 is still NEW as of Aug 2026). Safari is unsupported here.
- An http:// public page cannot request the permission at all; requests fail outside secure contexts.
(d) Only if the bridge serves the page: it may add COOP/COEP headers for cross-origin isolation (performance.now resolution 5 µs instead of 100 µs). This is not needed at 100 Hz.

**Why.** Option (a) avoids every browser restriction researched here: mixed content, LNA prompts, Safari's localhost block and CSP. It also needs no build step, since the bridge just serves the same file.

### 2. claude.ai artifacts: assume no direct link to localhost, and test with a short probe

**What.** The published artifact runs in a sandboxed cross-origin iframe (<uuid>.frame.claudeusercontent.com). A third-party analysis (Aug 2026) reports its CSP as 'default-src 'self'; connect-src 'self'; webrtc 'block''. connect-src governs WebSocket, fetch and XHR, so ws://127.0.0.1 would be refused before LNA is even reached. Separately, the default allowlist for loopback-network, local-network and serial is 'self', so a cross-origin iframe without an allow= delegation cannot get those permissions. Web Serial and WebHID are therefore unavailable too.

**How.** Probe to run in the artifact and in each other hosting mode:
- document.addEventListener('securitypolicyviolation', e => log(e.violatedDirective, e.blockedURI))
- const ws = new WebSocket('ws://127.0.0.1:8765'); ws.onopen = () => log('open'); ws.onerror = () => log('error')
- navigator.permissions.query({name:'loopback-network'}).then(s => log(s.state)).catch(e => log(e))
- log('serial' in navigator)

If the probe confirms the block, the HIL mode should say 'open the exported HTML locally or from the bridge'. For low-rate supervision from inside an artifact, the artifact runtime's 'mcp' capability can call a local MCP server on the viewer's machine ('host:<name>', Claude desktop app only). That is for supervision only, not a 100 Hz loop, and its latency is unmeasured.

**Why.** The person explicitly asked about the sandboxed artifact case. What is generally true (CSP and permissions-policy inheritance) can be stated now, but the exact claude.ai CSP is undocumented and must be checked live.

### 2. Message protocol: JSON-RPC 2.0 notifications indexed by tick number k

**What.** A small versioned protocol. Each tick the plant sends y as a notification. The browser answers with u for the same k. Requests with an id carry the handshake and supervisory commands. Use latest-value semantics: never queue control messages.

**How.** Plant→page each tick, a notification (no id, no reply):
{"jsonrpc":"2.0","method":"y","params":{"k":1234,"t":12.34,"y":[...],"state":"armed"}}
The plant timestamps t from its own monotonic clock as k·Ts. The page plots against plant time, not arrival time.

Page→plant:
{"jsonrpc":"2.0","method":"u","params":{"k":1234,"u":[...]}}
Echoing k gives the round-trip time and lets the plant drop stale replies.

Requests with an id:
- hello → {proto:1, name, Ts, inputs:[{name,unit,min,max,rate_max,safe}], outputs:[{name,unit}], watchdog_ticks:10}
- arm (only after a user click)
- disarm
- estop
- reset (clears a latched E-stop; needs a user gesture)
- set {param: value} (gains when the controller runs in the plant)
- step {k, dt, u} → {k, t, y} (lockstep co-simulation mode, below)

If the plant streams faster than the browser draws, send telemetry as JSON-RPC batch arrays or as binary Float64Array frames (binaryType = 'arraybuffer'). Before each send, check ws.bufferedAmount and skip telemetry, never u, if it is above about 64 KB.

Optional clock-offset estimate (NTP-style, from timestamps t0..t3): θ = ((t1−t0)+(t2−t3))/2, δ = (t3−t0)−(t2−t1).

**Why.** The tick index makes delay, staleness and missed cycles measurable. JSON-RPC 2.0 notifications match what the person asked for, and the hello message lets the page learn signals and limits from the plant, so nothing plant-specific has to be baked into the HTML.

### 2. Timing: the plant is the clock master; the page reacts to each sample in a dedicated Worker, with a modelled one-sample delay

**What.** Do not drive a real-time loop from page timers. The plant ticks at Ts on absolute deadlines. The page's Worker computes u_k when y_k arrives. The plant applies the newest u at tick k+1 and holds the last u (zero-order hold) if the reply is late. Include that extra z⁻¹ delay in the page's simulation model so that offline and HIL tuning agree.

**How.** Browser side:
- Run the WebSocket and the controller in a Worker created from a Blob URL of inline source. Send display batches to the main thread, which draws with requestAnimationFrame.
- Do not use setTimeout or setInterval for the loop. HTML clamps nested timers to 4 ms after 5 levels. Hidden tabs run timers at most about once per second (Firefox and Chrome). Chrome 88+ intensive throttling runs chained timers about once per minute after 5 minutes hidden. requestAnimationFrame stops in hidden tabs.
- Chrome's Energy Saver freezing (Chrome 133) can freeze a tab hidden and silent for more than 5 minutes. An open WebSocket does not exempt the tab; Web Serial/USB/HID or an open RTCDataChannel do. So the plant watchdog must assume the browser can stop at any time.
- performance.now resolution is 100 µs normally and 5 µs when cross-origin isolated.

Delay budget: ZOH plus computation and transport delay T_d ≈ Ts (one sample). Phase loss at crossover: Δφ ≈ ω_c·(Ts/2 + T_d). Keep Δφ ≤ 0.2 rad (about 11°), i.e. ω_c ≤ 0.2/(1.5·Ts). For Ts = 10 ms that is ω_c ≈ 13 rad/s (about 2 Hz closed-loop bandwidth). That is fine for a tank level or motor-speed outer loop, not for current or pendulum-stabilising loops.

Realistic rates:
- Browser in the loop over loopback WebSocket: 50–200 Hz.
- 1 kHz is possible in the foreground but not deterministic. The measured p99 round trip already exceeds 1 ms.
- Telemetry streaming of 1–10 kHz, batched into 60 Hz frames, is easy.

Plant side:
- next = t0 + k·Ts. Sleep until next − 1 ms, then spin on time.perf_counter().
- On Windows, asyncio's clock and sleeps can quantise to about 15.6 ms. Run the tick loop in its own thread using time.sleep (Python 3.11+ uses a high-resolution waitable timer) plus a spin, or call timeBeginPeriod(1).

**Why.** This puts determinism where an OS process can provide it and makes browser jitter visible as a known one-sample delay instead of random timing. It is consistent with the person's request: 100 Hz and E-stop after 10 missed cycles.

### 2. Safety layer lives in the plant/bridge, not the page

**What.** The plant owns:
- a consecutive-miss watchdog that trips the E-stop
- an immediate E-stop when the socket closes
- clamping (saturation) and slew limiting of u
- state limits
- a latched E-stop that clears only on an explicit reset
The page owns a link monitor and arms or disarms only on explicit user action.

**How.** Plant:
- c = consecutive ticks without a valid u for the current or previous k. If c ≥ N_wd = 10 (100 ms at 100 Hz), set u := u_safe (0 V, brake, valve closed), state = 'estop', latched.
- On WebSocket close or error: E-stop at once.
- u := clamp(u, u_min, u_max). Slew limit: |u_k − u_{k−1}| ≤ r_max·Ts.
- Reject non-finite values. JSON turns NaN into null; treat null as a fault.
- Accept at most one u per tick (keep the latest, ignore stale k < k_now − 1).
- Leave the safe state only on reset followed by arm.
- Optional soft position or level limits that trigger the E-stop.

Page:
- If no y for 3–5·Ts, show 'link lost' and stop sending.
- On visibilitychange to hidden, send disarm or switch to plant-local hold.
- On pagehide, send estop (best effort).
- Show the E-stop state prominently with an E-stop button (keyboard Space or Esc).

Security: bind to 127.0.0.1 only, never 0.0.0.0. WebSockets are not covered by CORS, so any website the user visits could try to reach ws://127.0.0.1 (cross-site WebSocket hijacking).
- Check the Origin header against an allowlist (websockets serve(origins=[...])).
- Require a random session token printed by the plant ('open http://127.0.0.1:8765/?t=…'), which must arrive in hello.
- Set compression=None for tiny frames.

**Why.** The browser can be throttled, frozen, garbage-collected or closed at any moment. Only the process next to the hardware can guarantee the fail-safe within a bounded time.

### 3. Offer three modes: lockstep co-simulation, browser-in-the-loop real time, and supervisory tuning

**What.** Name the modes in the UI so the person can pick the right one.
- Mode A, lockstep (SIL/co-simulation): the page is master and sends step {k, dt, u}; the external plant integrates one step and returns y. There is no real-time requirement, and it can run faster than real time. The 'step {t,u} → {t,y}' idea fits here.
- Mode B, real-time HIL with the controller in the browser: the plant is clock master at 100 Hz, with the watchdog.
- Mode C, supervisory: the controller (PID or state feedback) runs inside the plant or bridge at ≥1 kHz. The page sends gains and setpoints with 'set' and receives decimated traces. This is hardware-in-the-loop in the usual sense; the browser only supervises.

**How.** Mode A: await one JSON-RPC request per step. The round trip of about 1 ms gives up to roughly 1000 steps/s, and the results are bit-reproducible.
Mode B: as in the timing recommendation.
Mode C: the plant implements the same controller block equations the page uses, with gains received via set. The page shows reference and measured traces and can run the auto-tune iterations against the real plant: apply a gain set, record a step response over N seconds, compute the cost, and iterate.

Add a 'rate test' button before arming: run 1000 ticks of echo traffic, then show round-trip p50/p99/max, tick lateness and missed ticks against the watchdog margin. Arm only if p99 round trip < Ts.

**Why.** The modes separate what the browser can do well (tuning, plotting, optimisation) from what it cannot guarantee (hard real time). Mode C is the only safe choice for fast or unstable hardware such as pendulums.

### 3. Python plant/bridge implementation details (uv, websockets 17)

**What.** A single-file Python plant run with 'uv run plant.py', using PEP 723 inline metadata (requires-python ≥3.11, dependencies = ["websockets>=15"]; the current release is 17.3). It uses one asyncio WebSocket server and an absolute-deadline tick loop. A UDP or serial bridge variant adds asyncio DatagramProtocol or pyserial 3.5.

**How.** Use 'from websockets.asyncio.server import serve' and 'serve(handler, "127.0.0.1", 8765, compression=None, origins=[...])'.
- asyncio sets TCP_NODELAY on its sockets by default. In any hand-written Node server, call socket.setNoDelay(true) to avoid Nagle/delayed-ACK stalls of 40–200 ms.
- For serial plants, beware FTDI adapters' default 16 ms latency timer. Set it to 1 ms, or use native USB-CDC microcontrollers.
- A dependency-free Node bridge is about 60 lines (http 'upgrade' handshake: Sec-WebSocket-Accept = base64(sha1(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')), plus frame parse and unmask). Node 22 has only a WebSocket client built in, not a server.

The benchmark scripts used for the numbers above are in /tmp/claude-0/-home-user-ctrl/281fed85-1c0b-52ae-b29a-1fd26dd76401/scratchpad/wsbench/:
- plant.py: uv plant with the watchdog
- ws-min-server.mjs: dependency-free Node WebSocket server
- client.mjs: browser stand-in

**Why.** This matches the person's request ('a Python script you run with uv … 100 Hertz … watchdog') and avoids the known timing traps.

### 4. Optional direct-device paths (no bridge), and transports not worth using on loopback

**What.** For a microcontroller plant, the page can talk to it directly without a bridge.
- Web Serial: Chrome/Edge 89+ desktop, Firefox 151+ (per MDN compat data), Android Chrome 148; Safari has none.
- WebHID: Chrome 89+, raw 64-byte reports with 1 ms polling.
- WebUSB: Chrome 61+; CDC devices claimed by an OS driver need Web Serial instead.
- Web MIDI: Chrome 43+, Firefox 108+; usable but hacky.

WebTransport (Chrome 97, Firefox 114, Safari 26.4) and WebRTC data channels add nothing on loopback.

**How.** Web Serial:
- port = await navigator.serial.requestPort() (needs a user gesture and a secure context; file:// and http://localhost both count as secure)
- await port.open({baudRate: 115200})
- then use port.readable and port.writable streams
- in iframes it needs allow="serial"

WebTransport needs an HTTP/3 server (for example Python aioquic) plus serverCertificateHashes: a self-signed ECDSA P-256 certificate valid for ≤14 days. Its unreliable datagrams bring no benefit on lossless loopback.

WebRTC needs a signalling channel and an ICE/DTLS peer (for example aiortc). Its {ordered:false, maxRetransmits:0} channels are UDP-like, and an open RTCDataChannel exempts the tab from Energy Saver freezing. But the artifact CSP blocks WebRTC, and the setup is heavy.

All of WebSocket, WebTransport and WebRTC to local addresses are subject to LNA in Chrome (WebSocket and WebTransport since Chrome 147; WebRTC planned).

**Why.** Web Serial removes the bridge entirely for Arduino, STM32 or RP2040-class plants, and the device APIs exempt the tab from Chrome's freezing. The other transports are listed so the person knows why they are not recommended.

## Pitfalls

- Safari blocks ws://localhost and http://127.0.0.1 fetches from https pages as mixed content (WebKit bug 171934, still NEW as of Aug 2026). The 2025 fix in bug 279249 was only a narrow one. Serve the page from the bridge over http://127.0.0.1, or open it from file://.
- Chrome 147+ (stable 2026-04-07) prompts for the 'loopback-network' permission when a public https page opens a WebSocket to 127.0.0.1. Firefox 153 enabled LNA by default and 154 extended it to WebSockets. A denied permission persists and Chrome may not re-prompt; the user must reset it in site settings. The temporary enterprise opt-out policy LocalNetworkAccessRestrictionsTemporaryOptOut is removed in Chrome 156 (stable 2026-10-20). An http:// public page cannot get the permission at all.
- WebSocket target-address-space hint: a WebSocket to a public hostname that resolves to a local address needs { targetAddressSpace } in the constructor (Chrome 154+). Use IP literals (127.0.0.1) instead.
- WebSockets are not covered by CORS, so any website can try to open ws://127.0.0.1:PORT. Check the Origin header and require a session token. Bind to 127.0.0.1, never 0.0.0.0.
- claude.ai artifacts: CSP connect-src 'self' and webrtc 'block' (third-party report, Aug 2026) plus a cross-origin iframe without loopback-network or serial delegation means no direct link to localhost. Verify with the probe before promising anything.
- Hidden tabs: requestAnimationFrame stops, Window timers fire at most about 1/s, and Chrome's intensive throttling drops chained timers to 1/min after 5 minutes. Energy Saver freezing (Chrome 133+) can pause the whole tab, and an open WebSocket does not exempt it. The plant watchdog will trip; design for that (disarm on visibilitychange).
- Never run the control loop on main-thread setTimeout or setInterval: HTML clamps nested timers to 4 ms after 5 levels, and plot rendering and GC add jank. Use an event-driven Worker created from a Blob URL. new Worker('file.js') fails from file://.
- Queued control messages add latency without bound. Use latest-value conflation and drop stale k. Watch ws.bufferedAmount on the page and the write buffer in the plant.
- Windows: asyncio timing can quantise to about 15.6 ms (GetTickCount64 and IOCP timeouts). Run the tick loop in a thread with time.perf_counter() deadlines plus time.sleep (high-resolution since Python 3.11) and a final spin, or call timeBeginPeriod(1).
- Nagle plus delayed ACK can add 40–200 ms on small writes in hand-written servers. Set TCP_NODELAY (asyncio does this by default; in Node call socket.setNoDelay(true)). Disable permessage-deflate for tiny frames (websockets compression=None).
- Serial: FTDI USB-serial adapters have a 16 ms default latency timer, which would eat the whole 10 ms cycle. Set it to 1 ms or use native USB-CDC microcontrollers.
- 'localhost' may resolve to ::1 while the server binds only 127.0.0.1. Use the 127.0.0.1 literal on both sides.
- JSON cannot carry NaN or Infinity: JSON.stringify turns them into null. Validate that every received value is finite and treat anything else as a fault.
- With the controller in the browser, the effective delay is about one sample plus the zero-order hold. If the simulation used for tuning omits this z⁻¹, gains tuned offline will be too aggressive on the real loop. Keep ω_c·1.5·Ts ≤ about 0.2.
- A software watchdog is not a safety function. Real machines need a hardware E-stop chain (ISO 13850 / IEC 60204-1 stop categories); the browser may only request stops, never be the only way to stop.
- The benchmark numbers (round-trip p50 ≈ 1 ms, p99 3.7–14 ms, max 9–53 ms at 100 Hz) come from a shared Linux VM with a Node WHATWG-WebSocket client standing in for the browser. Real browser and Windows numbers must be measured with the in-app rate test.
- Behaviour of file:// pages under Firefox 153+ LNA and in Safari, and Web Serial permission persistence on opaque file:// origins, are not documented. Test them.
- performance.now() is coarsened to 100 µs unless the page is cross-origin isolated (5 µs), which needs COOP/COEP headers and is impossible from file://. Timestamp samples in the plant instead.

## Sources

- https://developer.chrome.com/blog/local-network-access
- https://chromestatus.com/feature/5152728072060928
- https://chromestatus.com/feature/5197681148428288
- https://chromestatus.com/feature/5126430912544768
- https://chromestatus.com/feature/5068298146414592
- https://chromestatus.com/feature/4779920606756864
- https://chromestatus.com/feature/5065884686876672
- https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Local_network_access
- https://github.com/WICG/local-network-access/blob/main/explainer.md
- https://wicg.github.io/private-network-access/
- https://chromium.googlesource.com/chromium/src/+/main/services/network/public/cpp/ip_address_space_util.cc
- https://www.firefox.com/en-US/firefox/153.0/releasenotes/
- https://www.firefox.com/en-US/firefox/154.0/releasenotes/
- https://bugzilla.mozilla.org/show_bug.cgi?id=903966
- https://bugzilla.mozilla.org/show_bug.cgi?id=1376309
- https://bugzilla.mozilla.org/show_bug.cgi?id=1488740
- https://bugs.webkit.org/show_bug.cgi?id=171934
- https://bugs.webkit.org/show_bug.cgi?id=279249
- https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content
- https://w3c.github.io/webappsec-mixed-content/
- https://developer.chrome.com/docs/iwa/direct-sockets
- https://chromestatus.com/feature/6398297361088512
- https://chromestatus.com/feature/5146307550248960
- https://chromestatus.com/feature/5073740211814400
- https://chromestatus.com/feature/6046077976444928
- https://groups.google.com/a/chromium.org/g/blink-dev/c/5R0P_aYBWQI/m/rFMq-qYAEQAJ
- https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout
- https://developer.mozilla.org/en-US/docs/Web/API/Performance/now
- https://chromestatus.com/feature/4718288976216064
- https://chromestatus.com/feature/5158599457767424
- https://github.com/mdn/browser-compat-data (api/WebTransport.json, api/Serial.json, api/USB.json, api/HID.json, api/MIDIAccess.json, api/WebSocket.json, http/headers/Permissions-Policy.json)
- https://www.w3.org/TR/webtransport/
- https://www.jsonrpc.org/specification
- https://pypi.org/project/websockets/ (v17.3, Python >=3.11)
- https://docs.python.org/3/library/asyncio-platforms.html
- https://discuss.python.org/t/higher-resolution-timers-on-windows/16153
- https://pluto.security/blog/inside-claude-artifacts-how-your-agent-publishes-to-the-web/ (third-party, Aug 2026: artifact CSP connect-src 'self', webrtc 'block')
- https://chromiumdash.appspot.com/fetch_milestone_schedule (Chrome 142/147/154/156 stable dates)
- Local benchmark scripts: /tmp/claude-0/-home-user-ctrl/281fed85-1c0b-52ae-b29a-1fd26dd76401/scratchpad/wsbench/plant.py, ws-min-server.mjs, client.mjs
