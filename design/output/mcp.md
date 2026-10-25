# The MCP server

Reader: a person or agent who wants to tune with Loop Tuner through MCP, and whoever changes `mcp.mjs`.

`mcp.mjs` is Loop Tuner as an MCP server: the core the page and `cli.mjs` run, as tools an agent calls (the person, input 09: an agent should be able to tune through MCP; input 29: "make it runnable as an MCP ... before the overhaul"). Node 18+, stdio, no dependencies. Register it once, then ask for things in plain words:

- **Claude Code**: `claude mcp add loop-tuner -- node /path/to/mcp.mjs`
- **Claude Desktop**, in `claude_desktop_config.json`: `{ "mcpServers": { "loop-tuner": { "command": "node", "args": ["/path/to/mcp.mjs"] } } }`
- **Any client**: the command `node /path/to/mcp.mjs`, stdio transport.

It speaks MCP 2026-07-28 (stateless: the version on every request, `server/discover`) and the earlier revisions that open with `initialize` (2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05). What it relies on from the spec is in [../research/mcp.md](../research/mcp.md).

## Tools

Every tool takes an optional `project`: the name of a project in memory. `load_system` and `set_project` make theirs the default.

| Tool | Does | Same as |
|---|---|---|
| `list_systems` | The System library: names, tags, notes; `tag` filters. | `node cli.mjs systems` |
| `list_projects` | The projects in memory and the default. | |
| `load_system` | A library entry (`system`, or the start of its name) or a project file (`path`: `.json`, or an exported `.html`) into memory under a name (`as`). Returns the Controller blocks, their variants, the signals, the timebase. | `node cli.mjs new --system` |
| `get_project`, `set_project` | The project as the file stores it; replace it (normalised as the page loads a file, so a designed variant holding computed numbers is refused). | |
| `list_blocks`, `get_block` | The diagram's blocks by id path (`ctrl`, `motor/ctrl`) with their variants; one block whole. | |
| `set_params` | `block` with `params` (the running variant's, or `variant`'s, or a plain block's own), `blockParams` (a Controller's own: `Ts`, …), `select` (make `variant` run); or `signal` with `components` and/or `period`. An unknown name is refused, listing the names there are. | the page's `setGains`, `setVariant` |
| `run` | Simulates for the timebase (or `duration`) and measures each Controller block's loop: Auto-tune's cost J with its parts, overshoot, settling, rise, IAE, ISE, ITAE, peak and variation of u, time saturated; lists every signal; `signals` come back downsampled to `points` (default 200, at most 2000). | `node cli.mjs run --json` |
| `autotune` | `method` iterate, relay or step; `rule`, `simc`, the goal (`cost`, `effort`, `overshoot`), `iterations`, `ff`, `amplitude`; `apply` keeps the result as a variant of its own (default: report only). Progress while it runs; cancellable. | `node cli.mjs autotune --json [--save]` |
| `analyze` | The Analysis tab's numbers at `at` (`"origin"`, `"initial"`, `{ "y": [levels] }`, `{ "t": s }`): stable, unstable pole counts, gain margins up and down (dB), phase margin and crossover, delay margin, Ms, Mt, least damping, closed-loop poles (s and z, ωn, ζ), the linear step. | `node cli.mjs analyze --json` |
| `designs` | What each running designed variant computed from the plant, its status, warnings, refusal. | `node cli.mjs design --json` |
| `identify` | **Not built yet**: answers that it is not, until the Identify core lands. | |
| `save_project` | Writes `.json`, or `.html` (the page with the project inside). | `--save`, `node cli.mjs html` |
| `export_html` | The standalone page with the project inside. | `node cli.mjs html` |

A result is the tool's JSON (`structuredContent`) and the same as text. A refusal, by the arguments' schema or by the core, is a tool error (`isError`) whose text is the core's sentence, the one the command line prints, with its hint: for example `analyze` on the sliding-mode motor answers "ctrl: Relay (theory): an ideal sliding mode switches: it has no linear model; …". An unknown tool or a malformed request is a JSON-RPC error. `null` in a number's place means infinite (a gain margin with no limit) or not measured.

The command line and the server share one module, `src/node/ops.mjs`; `cli.mjs` got `run` and `analyze` from it, so every number above has a command-line twin, and `test/mcp.test.mjs` checks that they agree on two library systems.

## An example session

Played by `node tools/mcp-client.mjs` (a small client: it starts the server and speaks the protocol over its stdin and stdout), shortened. `>` is the client, `<` the server; requests also carry the 2026-07-28 `_meta` (left out).

```
> server/discover #1 {}
< #1 {"resultType":"complete","supportedVersions":["2026-07-28","2025-11-25","2025-06-18","2025-03-26","2024-11-05"],"capabilities":{"tools":{"listChanged":false}},"instructions":"Loop Tuner simulates and tunes control loops. …"}
> tools/list #2 {}
< #2 {"resultType":"complete","tools":[{"name":"list_systems",…},… 15 tools]}
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

`node tools/mcp-client.mjs legacy` plays the same session opening with `initialize` (protocol 2025-11-25); the results are the same, without `resultType`.

Registered with Claude Code (`claude mcp add`, here as a project's `.mcp.json`) and asked in one sentence to load the motor, run it, auto-tune it with iterate and apply, run again and analyse at the initial state, Claude Code called the four tools and answered: "J 1.274, overshoot 23.9 % … Kp 30 → 5.97, J 1.274 → 0.1145, applied as 'P, too aggressive · auto-tuned' … J 0.1145, overshoot 6.45 %, no saturation … phase margin 61.4° at 7.94 rad/s, stable".

## Limits

- **State lives in the process.** Projects are kept in memory under their names until the server exits; nothing is written unless `save_project` or `export_html` is called. Restarting the server (the client may restart it at any time, the protocol being stateless) forgets them: save what matters.
- **One request at a time**, in the order they came. A long `autotune` blocks the requests after it, but answers a cancellation within about 50 ms. A design that plans (the planned swing-up) computes for seconds without yielding; it cannot be cancelled half-way.
- **No live plant.** The server runs simulations only; a system with an External plant is refused by `autotune` and `analyze`, as in the page (it needs an identified model). Live runs are the page's (AGENTS.md, Through the browser).
- **Identify is a stub** until the Identify core lands on main; the tool is listed so clients see it, and answers that it is not built.
- **Paths** are read and written as given, relative to the server's working directory; the server has the file access of the user who started it.
- **Traces are downsampled** by keeping every n-th sample (and the last), so a peak between kept samples does not show in them; the metrics are measured on every sample.
- Not offered: resources, prompts, logging notifications (deprecated in 2026-07-28; the server logs to stderr), `outputSchema`.
