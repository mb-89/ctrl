# Research: the Model Context Protocol

Reader: whoever changes `mcp.mjs`. What the server relies on from the MCP specification, read from modelcontextprotocol.io on 2026-10-25. The current revision is **2026-07-28** (schema `schema/2026-07-28/schema.ts`); the previous one, **2025-11-25**, is the one most clients in use speak. The server serves both.

## The two eras

The 2026-07-28 revision made the protocol **stateless**: there is no handshake. The spec calls revisions from 2026-07-28 on *modern* and those with an `initialize` handshake (2025-11-25 and earlier) *legacy*; a server that serves both is *dual-era* and picks per request ([versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)):

- A request whose `params._meta` carries `io.modelcontextprotocol/protocolVersion` is served statelessly by 2026-07-28. Required on every modern request: `io.modelcontextprotocol/protocolVersion` and `io.modelcontextprotocol/clientCapabilities`; optional: `io.modelcontextprotocol/clientInfo`, `io.modelcontextprotocol/logLevel`. A request missing a required field is malformed: `-32602` ([basic, `_meta`](https://modelcontextprotocol.io/specification/2026-07-28/basic)).
- A version the server does not serve: error **`-32022` UnsupportedProtocolVersion**, `data: { supported: [...], requested }`; the client retries with one of `supported`.
- **`server/discover`** (MUST be implemented): `{ resultType: "complete", supportedVersions, capabilities, instructions?, _meta: { "io.modelcontextprotocol/serverInfo": { name, version } } }`. A dual-era client probes with it on stdio and falls back to `initialize` on any other error ([stdio, backward compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio)).
- Every modern result carries **`resultType`** (`"complete"`; `"input_required"` is for multi round-trip requests, which this server does not use) and SHOULD carry `_meta["io.modelcontextprotocol/serverInfo"]`.
- **Legacy**: `initialize` with `{ protocolVersion, capabilities, clientInfo }`; the server answers `{ protocolVersion, capabilities, serverInfo, instructions? }` with the requested version if it serves it, else the latest it serves; the client then sends `notifications/initialized` ([2025-11-25 lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)). Its semantics are scoped to the stdio process.

**What mcp.mjs does**: modern `2026-07-28`; legacy `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05` (all four have the same tools shape the server uses: `content`, `isError`, and `structuredContent` as an object). A request with neither the modern `_meta` nor a prior `initialize` is answered `-32602`, naming what is supported. `ping` is answered in both eras. `resultType` and the result `_meta` are added only to modern answers, so a legacy client's schema sees what it expects.

## stdio

From the [stdio binding](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio): the client starts the server as a subprocess; one JSON-RPC message per line on stdin and stdout, UTF-8, **no embedded newlines**; nothing on stdout that is not an MCP message; the server MAY log to **stderr**, which the client may ignore. The server must not send requests on stdout (2026-07-28). Shutdown: the client closes the server's stdin and waits; the server SHOULD exit promptly at end of file.

**What mcp.mjs does**: `JSON.stringify` (never pretty) and `\n`; logs to stderr only; at the end of stdin the request under way finishes, then the process exits. Parse errors answer `-32700` with `id: null`; a line that is not one JSON-RPC 2.0 object (a batch, say) answers `-32600`.

## JSON-RPC

JSON-RPC 2.0; a request's `id` is a string or an integer, never `null`; a notification has no `id` and gets no answer. Error codes: the standard `-32700`, `-32600`, `-32601` (method not found), `-32602` (invalid params, also an unknown tool), `-32603`; `-32020 … -32099` are reserved for the spec (`-32022` above); `-32000 … -32019` are legacy and new code SHOULD NOT use them.

## Tools

From [server/tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools):

- Capability `{ tools: { listChanged } }`. `tools/list` answers `{ tools: [{ name, title?, description, inputSchema, outputSchema?, annotations? }] }` in a deterministic order, the same for every connection. Names: 1–128 characters of `A–Z a–z 0–9 _ - .`.
- `inputSchema` is a JSON Schema object (2020-12 when no `$schema`); a tool without parameters: `{ "type": "object", "additionalProperties": false }`.
- `tools/call` `{ name, arguments }` answers `{ content: [{ type: "text", text }], structuredContent?, isError? }`. A tool that returns `structuredContent` SHOULD also return it serialised as a text block. If a tool declares an `outputSchema`, its structured results MUST conform.
- **Two kinds of error**: protocol errors (unknown tool, a malformed request) are JSON-RPC errors (`-32602`); **tool execution errors** (bad input values, a business-logic refusal) are results with `isError: true` and a text the model can act on.
- No sessions: state across calls is held under an explicit handle the model passes back ("Stateful Tools", non-normative), and an unknown handle is a tool error that says so.

**What mcp.mjs does**: 30 tools (16 on the core alone, 14 on the page it serves), each with a title, a description and an `inputSchema` (`additionalProperties: false`, so a misspelt argument is refused with the names there are). It checks arguments against the schema itself (types, enums, required, unknown names) and answers a failure as a tool error. Results are `structuredContent` (always an object) plus the same JSON as text; `page_screenshot` answers with image content (`{ type: "image", data, mimeType: "image/png" }`) and a line of text. No `outputSchema`: clients validate structured results against it, and the core's reports have optional parts that a schema would have to restate. A refusal by the core (for example the Analysis tab's "Relay (theory): an ideal sliding mode switches: it has no linear model") is a tool error with that sentence. Projects in memory are named; the name is the handle, and an unknown one is a tool error listing the names there are.

## Progress and cancellation

- [Progress](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/progress): a request opts in with `_meta.progressToken` (string or integer); the server MAY send `notifications/progress` `{ progressToken, progress, total?, message? }`; `progress` MUST increase with each notification; none after the answer.
- [Cancellation](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/cancellation): on stdio the client sends `notifications/cancelled` `{ requestId, reason? }`; the server SHOULD stop and MUST NOT answer the cancelled request; an unknown or finished id is ignored.

**What mcp.mjs does**: `autotune` runs the core's generator (`autotuneSteps`) and, at most every 50 ms, lets the event loop in: it sends a progress notification when the request has a token (the number of the core's steps so far, increasing, and a message such as "iteration 14, cost 0.114"), and stops if the request was cancelled. Requests are served one at a time in the order they came; a cancellation acts at once, also on a request still waiting its turn, which is then dropped unanswered.

## What it does not use

- **Logging** (`notifications/message`) is deprecated in 2026-07-28 ([logging](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/logging)); servers on stdio log to stderr. Not declared.
- **Resources and prompts**: not offered. Everything an agent needs is a tool result; the guide for agents is in the tools' descriptions and the `instructions` string. (Interpretation: one surface, the tools, is enough for "tune through MCP".)
- **Tasks**, **multi round-trip requests** (elicitation, sampling), **subscriptions** and `listChanged`: not needed; the tool list never changes.
- **Authorization**: for HTTP only; stdio takes credentials from the environment, and this server needs none.
