# The MCP server

Reader: a person or agent who wants to work with Loop Tuner through MCP, and whoever changes `mcp/mcp.mjs`.

`mcp/mcp.mjs` (`./runme.sh mcp`; `mcp.mjs` in its download) is Loop Tuner as an MCP server (Model Context Protocol, stdio, Node 18+, no dependencies). It does two things:

- **The core alone**: tools that load, run, measure, auto-tune and analyse projects in the server's memory, with no page (input 09: an agent tunes through MCP; input 29: "make it runnable as an MCP ... before the overhaul").
- **The agentic mode** (inputs 30, 31): it also serves the Loop Tuner page on this computer, at `http://127.0.0.1:8766/` by default. Open that page and it connects back, and the `page_` tools act on it. The agent and the person see the same page and the same data, so they can identify and tune a plant together and talk it over.

Register it once:

- **Claude Code**: `claude mcp add loop-tuner -- node /path/to/mcp.mjs`
- **Claude Desktop**, in `claude_desktop_config.json`: `{ "mcpServers": { "loop-tuner": { "command": "node", "args": ["/path/to/mcp.mjs"] } } }`
- **Any client**: the command `node /path/to/mcp.mjs`, stdio transport. Options: `--port N` (the page's port; a taken port falls back to a free one), `--no-page`.

**It explains itself** (input 36), on start (on stderr, since stdout is the protocol) and in `./runme.sh mcp --help` and its README.md, in the same words as README.md here. It covers what an MCP server is, in two sentences; how to connect an agent (Claude Code's `claude mcp add` line, the JSON for Claude Desktop, VS Code and Cursor, the command for any client), with its own path filled in; the page's address, where the agent works on the same page; and what to ask.

**Without this repository**: the page's **Export ▾ › MCP server** saves `loop-tuner-mcp.zip`. It holds `mcp.mjs`, the page's own core (`loop-tuner-core.js`, cut from the page's script, as the HIL plant's zip carries it), the page itself, `README.md`, and `runme.sh` / `runme.cmd` / `runme.ps1`. The HIL plant's zip has the same three runme scripts and a README.md. One click on runme does everything: it installs Node.js if it is missing (the system's package manager on Linux, Homebrew on macOS, winget on Windows; never pip), starts the server, opens the page in the default browser (`--no-open` not to) and prints the explanation. No option is needed; `runme --help` lists them all and installs nothing. The same `mcp.mjs` runs from the source and from the zip: it loads the core from `src/` or from `loop-tuner-core.js` beside it. `test/mcp-zip.test.mjs` checks that both answer alike.

It speaks MCP 2026-07-28 (stateless: the version on every request, `server/discover`) and the earlier revisions that open with `initialize` (2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05). What it relies on from the spec is in [../research/mcp.md](../research/mcp.md).

## Tools

### The core alone

Every one of these tools takes an optional `project`: the name of a project in memory. `load_system`, `set_project` and `page_get_project` (with `as`) make theirs the default.

| Tool | Does | Same as |
|---|---|---|
| `list_systems` | The System library: names, tags, notes; `tag` filters. | `./runme.sh cli systems` |
| `list_projects` | The projects in memory and the default. | |
| `load_system` | A library entry (`system`, or the start of its name) or a project file (`path`: `.json`, or an exported `.html`) into memory under a name (`as`). Returns the Controller blocks, their variants, the signals and the timebase. | `./runme.sh cli new --system` |
| `get_project`, `set_project` | The project as the file stores it; replace it (normalised as the page loads a file, so a designed variant holding computed numbers is refused). | |
| `list_blocks`, `get_block` | The diagram's blocks by id path (`ctrl`, `motor/ctrl`) with their variants; one block whole. | |
| `set_params` | `block` with `params` (the running variant's, `variant`'s, or a plain block's own), `blockParams` (a Controller's own: `Ts`, …) and `select` (make `variant` run); or `signal` with `components` and/or `period`. An unknown name is refused, listing the names there are. | |
| `run` | Simulates for the timebase (or `duration`), says what the run reported (validity, warnings, the integration step and its bound), and measures each Controller block's loop: Auto-tune's cost J with its parts, overshoot, settling, rise time, IAE, ISE, ITAE, the peak and variation of u, and time saturated. Lists every signal; `signals` come back downsampled to `points` (default 200, at most 2000). | `./runme.sh cli run --json` |
| `autotune` | `method` iterate, relay or step; `rule`, `simc`, the goal (`cost`, `effort`, `overshoot`), `iterations`, `ff`, `amplitude`. `apply` keeps the result as a variant of its own (default: report only). Reports progress; cancellable. | `./runme.sh cli autotune --json [--save]` |
| `autotune_history` | Every Auto-tune run since the server started, core and page alike: where, project, method, block, cost before and after, better, applied. `index` returns one run's whole report. | |
| `analyze` | The Analysis tab's numbers at `at` (`"origin"`, `"initial"`, `{ "y": [levels] }`, `{ "t": s }`): stable or not, unstable pole counts, gain margins up and down (dB), phase margin and crossover, delay margin, Ms, Mt, least damping, closed-loop poles (s and z, ωn, ζ), the linear step. | `./runme.sh cli analyze --json` |
| `designs` | What each running designed variant computed from the plant: status, warnings, refusal. | `./runme.sh cli design --json` |
| `identify` | Identify's whole test on a simulated plant (`block`, `band`, `budget`, `vary`, `structure`; `keep` stores the record in the project in memory, for `autotune` with `plant: "identified"`): the same report as `./runme.sh cli identify --json`, without the record. A live plant is identified on the page. | |
| `save_project`, `export_html` | Write `.json`, or the standalone page with the project inside. | `./runme.sh cli html` |

### On the page (the agentic mode)

These tools act on the page that the server served and that is open in a browser, through the page's own agent API (`window.loopTuner`, [AGENTS.md](../../AGENTS.md#through-the-browser)). The person sees every change; each one is a single undo step on the page.

| Tool | Does |
|---|---|
| `page_status` | The page's address, whether a page is connected, and if so its project, Controller blocks and live link. |
| `page_open` | Opens the address in the computer's default browser. |
| `page_load_system`, `page_get_project`, `page_set_project` | Load a library system on the page; read the page's project (with `as`, also into memory for the core-alone tools); put a project on the page. |
| `page_set_gains`, `page_set_variant` | The running variant's parameters, or which variant runs. With a live plant, they act at the next sample. |
| `page_control` | The scope's keys: run, stop, single, auto_scale. With a live plant, run and stop start and stop it. |
| `page_signals` | The data, summary first. `source` screen (the run on the screen) or record (the live record, across runs). Per signal: unit, min, max, mean and last value, within `from` … `to`. With `signals`, those downsampled to `points`. |
| `page_autotune` | Auto-tune on the page; applied by default (undoable there). Recorded in `autotune_history`. |
| `page_analyze`, `page_designs` | The Analysis numbers for the page's project (the same core, from its project); its designs once computed. |
| `page_live` | The live plant: `state` (link, mode, the plant's interface, ramp-in, E-stop), `connect`, `disconnect`, `estop`, `reset`, and `mode` with `control` or `reference` (the switch below). |
| `page_screenshot` | A PNG of the scope, as MCP image content. |

How it works: the server adds one line to the page it serves, `<meta name="loop-tuner-bridge" content="ws://127.0.0.1:PORT/bridge">`. Only a page with that line connects back, over a WebSocket (`src/ui/bridge.js`). It accepts the connection only from the page's own origin and shows the state in `#lt-shell[data-agent]` (connecting, connected, closed), with a toast: "An agent is connected to this page". The standalone file, an exported page and the hosted page have no such line and never connect anywhere (`test/mcp-page.test.mjs`). One page at a time: a newer one takes the link, and the older one is told.

A result is the tool's JSON (`structuredContent`), repeated as text; `page_screenshot` returns an image. A refusal, whether by the arguments' schema, by the core or by the page, is a tool error (`isError`) carrying the core's sentence and its hint, the one the command line prints. For example, `analyze` on the sliding-mode motor answers "ctrl: Relay (theory): an ideal sliding mode switches: it has no linear model; …". `page_autotune` against an External plant says it needs an identified model. An unknown tool or a malformed request is a JSON-RPC error. `null` in place of a number means infinite (a gain margin with no limit) or not measured.

The command line, the server and the page share one module, `src/core/ops.js`. It is pure, so it rides in the page's core and the downloaded server runs it too. `tools/cli.mjs` gained `run` and `analyze` from it, and `test/mcp.test.mjs` checks that the server's numbers equal the command line's on two library systems.

## HIL with an agent

The library's second HIL system (input 31) is the agentic mode with a plant nobody knows. The HIL simulator draws a model at random (`sh runme.sh --random`), varies its physics and tells the page only its interface. The person opens the page the MCP server serves, loads *HIL with an agent*, connects and runs, then asks, for example: "What do you see? Let us identify this plant: which experiment would you run?", then "Now let us tune it together". The agent reads the interface (`page_live`), the live record (`page_signals`, source record) and its own Auto-tune history, and acts only through the page. Reference mode is a switch on the one HIL system, not a system of its own: Live settings, **Mode** ([hil.md](hil.md)), and for the agent `page_live` with `action: "mode"`. `test/mcp-hil.test.mjs` runs this flow end to end: the server, Chromium, the real plant, connect, the live record, the mode switch and back.

## An example session

Played by `node tools/mcp-client.mjs` (a small client that starts the server and speaks the protocol over its stdin and stdout), shortened. `>` is the client, `<` the server. Requests also carry the 2026-07-28 `_meta`, left out here.

```
> server/discover #1 {}
< #1 {"resultType":"complete","supportedVersions":["2026-07-28","2025-11-25","2025-06-18","2025-03-26","2024-11-05"],"capabilities":{"tools":{"listChanged":false}},"instructions":"Loop Tuner simulates and tunes control loops. …"}
> tools/list #2 {}
< #2 {"resultType":"complete","tools":[{"name":"list_systems",…},… 30 tools]}
> tools/call #3 {"name":"load_system","arguments":{"system":"DC motor, position control"}}
< #3 {"project":"DC motor, position control","controllers":[{"block":"ctrl","running":"P, too aggressive","variants":[{"name":"P, too aggressive","type":"pid"},{"name":"PD",…},{"name":"PID with prefilter",…},{"name":"Off",…}]}],"signals":{"r":{"period":5,…},"d":{…}},…}
> tools/call #4 {"name":"run","arguments":{"signals":["r","ctrl.y"],"points":6}}
< #4 {"duration":5,"sampleTime":0.0025,"samples":2001,"unstable":false,
      "loops":[{"block":"ctrl","variant":"P, too aggressive","cost":{"J":1.274,…,"overshoot":23.9,"saturated":0.162},
                "metrics":{"riseTime":0.115,"overshoot":23.9,"settlingTime":0.952,"iae":1.30,"uPeak":12,"saturation":16.2,…}}],
      "signals":["r","d","i","angle","speed","V","ctrl.r","ctrl.y","ctrl.u"],
      "traces":{"t":[0,0.835,1.67,2.505,3.34,4.175,5],"r":[0,2,0,0,2,0,0],"ctrl.y":[0,1.8486,0.0602,0.0195,1.8237,-0.0079,0.0139]}}
> tools/call #5 {"name":"autotune","arguments":{"method":"iterate","apply":true}}  (progressToken tune-1)
< notifications/progress {"progressToken":"tune-1","progress":8,"message":"iteration 2, cost 0.155"}
< notifications/progress {"progressToken":"tune-1","progress":25,"message":"iteration 8, cost 0.116"}
< notifications/progress {"progressToken":"tune-1","progress":43,"message":"iteration 14, cost 0.114"}
< notifications/progress {"progressToken":"tune-1","progress":62,"message":"iteration 21, cost 0.114"}
< #5 {"applied":true,"ok":true,"method":"iterate","better":true,
      "before":{"variant":{"name":"P, too aggressive","params":{"Kp":30,…}},"cost":{"J":1.274,"overshoot":23.9,…}},
      "after":{"variant":{"name":"P, too aggressive · auto-tuned","params":{"Kp":5.97,…}},"cost":{"J":0.1145,"overshoot":6.45,…}},
      "iterations":22,"evals":42,"tuned":["Kp"],…}
> tools/call #6 {"name":"run","arguments":{}}
< #6 {…"loops":[{"variant":"P, too aggressive · auto-tuned","cost":{"J":0.1145,…},
                  "metrics":{"overshoot":6.43,"settlingTime":0.474,"iae":1.14,"uPeak":11.99,"saturation":0,…}}]}
> tools/call #7 {"name":"analyze","arguments":{"at":"initial"}}
< #7 {"variant":"P, too aggressive · auto-tuned","at":"the initial state, V = 0","Ts":0.01,"stable":true,
      "margins":{"gainUp":8.20,"gainUpDb":18.3,"gainDown":0,"phase":61.4,"crossover":7.94,"delay":0.135,"Ms":1.40,"Mt":1.01},
      "zetaMin":0.656,"step":{"overshoot":6.43,"settlingTime":0.48,"settled":true,"final":1},…}
```

`node tools/mcp-client.mjs legacy` plays the same session but opens with `initialize` (protocol 2025-11-25). The results are the same, without `resultType`.

The same on the page, in the agentic mode (a client script with Chromium standing in for the person's browser, shortened):

```
> page_status {}
< {"url":"http://127.0.0.1:8766/","connected":false,"how":"open http://127.0.0.1:8766/ in a browser on this computer (page_open does it); the page connects by itself"}
  (a browser opens http://127.0.0.1:8766/; the page says "An agent is connected")
> page_load_system {"system":"DC motor, position control"}
< {"loaded":"DC motor, position control","controllers":[{"block":"ctrl","running":"P, too aggressive",…}],…}
> page_control {"action":"run"}
< {"ok":true,"why":null,"run":"run","live":null}
> page_signals {"signals":["r","angle"],"points":6}
< {"source":"screen","samples":2001,"span":[0,5],"signals":[{"name":"r","unit":"rad","min":0,"max":2,…},{"name":"angle","unit":"rad","min":-0.478,"max":2.478,…},…],"traces":{…}}
> page_set_gains {"params":{"Kp":8}}
< {"name":"P, too aggressive","type":"pid","params":{"Kp":8,…}}
> page_autotune {"iterations":20}
< {"applied":true,"ok":true,"method":"iterate","better":true,"before":{…"cost":{"J":0.318,"overshoot":12.4,…}},…}
> page_analyze {"at":"initial"}
< {"variant":"P, too aggressive · auto-tuned","stable":true,"margins":{"gainUp":8.20,"phase":61.5,"crossover":7.93,…},…}
> page_screenshot {}
< [image, text]
```

Registered with Claude Code (`claude mcp add`, here as a project's `.mcp.json`) and asked in one sentence to load the motor, run it, auto-tune it with iterate and apply, run it again and analyse it at the initial state, Claude Code called the four tools and answered: "J 1.274, overshoot 23.9 % … Kp 30 → 5.97, J 1.274 → 0.1145, applied as 'P, too aggressive · auto-tuned' … J 0.1145, overshoot 6.45 %, no saturation … phase margin 61.4° at 7.94 rad/s, stable".

## Limits

- **State lives in the process.** Projects are kept in memory under their names until the server exits; nothing is written unless `save_project` or `export_html` is called. The agent's client may restart the server at any time (the protocol is stateless), which forgets them: save what matters. The page keeps its own work in the browser, as always.
- **One request at a time**, in the order they came. A long `autotune` delays the requests behind it, but a cancellation takes effect within about 50 ms. A design that plans (the planned swing-up) computes for seconds without yielding and cannot be cancelled half-way. `page_autotune` runs on the page and blocks it while it tunes, as the tab does.
- **The page tools need the page open** in a browser on the same computer (`127.0.0.1` only); one page at a time. The page is served only while the agent's client keeps the server running.
- **Live plants** are reached only through the page (`page_live`), never by the core-alone tools. The plant is real time: the tool descriptions tell the agent to stop it or E-stop it when in doubt.
- **Identify runs on simulated plants**; a live plant is identified on the page (its Identify tab), where the person sees the test and can stop it.
- **Paths** are read and written as given, relative to the server's working directory. The server has the file access of the user who started it.
- **Traces are downsampled** by keeping every n-th sample (and the last), so a peak between kept samples does not show in them. The metrics and summaries are measured on every sample.
- **The MCP server names MCP clients** (input 36): its start text, `--help` and README.md say how to connect Claude Code, Claude Desktop, VS Code, Cursor or any client, with its own path filled in. The page carries these files, and its provenance rule never lets it name the host it was first shown in, so `test/provenance.test.mjs` sets aside exactly those client names, and only inside the MCP server's own files. `claude.ai`, the host's adapter, the person's identifiers, paths and the rest stay forbidden there too. The protocol revisions in `mcp.mjs` are dates by MCP's naming; the test sets aside those two statements, and only those.
- Not offered: resources, prompts, logging notifications (deprecated in 2026-07-28; the server logs to stderr), `outputSchema`.
