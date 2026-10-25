# Loop Tuner's MCP server

**Start it with one click**: double-click `runme.cmd` (Windows), or run `sh runme.sh` (Linux, macOS). It installs Node.js if it is missing, starts the server, opens the Loop Tuner page in your browser, and prints how to connect an agent, with this folder's path filled in. No option is needed; every option: `sh runme.sh --help` (or `runme.cmd --help`), which installs nothing.

## What an MCP server is

An MCP server gives an AI agent tools. MCP, the Model Context Protocol, is how agent apps (MCP clients) start a program like this one and call what it offers. This one lets an agent load, run, measure, tune and analyse control loops, and work on the Loop Tuner page you have open, so you both see the same page.

## Connect an agent

Register the server once with your MCP client. Use the full path of `mcp.mjs` in this folder; runme prints these lines with it filled in.

- **Claude Code**: `claude mcp add loop-tuner -- node "/full/path/to/mcp.mjs"`
- **Claude Desktop**: Settings › Developer › Edit Config (`claude_desktop_config.json`), then add
  ```json
  { "mcpServers": { "loop-tuner": { "command": "node", "args": ["/full/path/to/mcp.mjs"] } } }
  ```
- **VS Code**: `.vscode/mcp.json` in your folder:
  ```json
  { "servers": { "loop-tuner": { "type": "stdio", "command": "node", "args": ["/full/path/to/mcp.mjs"] } } }
  ```
- **Cursor**: `~/.cursor/mcp.json`:
  ```json
  { "mcpServers": { "loop-tuner": { "command": "node", "args": ["/full/path/to/mcp.mjs"] } } }
  ```
- **Any other client**: an MCP server over stdio, the command `node "/full/path/to/mcp.mjs"`.

After that, the client starts the server by itself whenever the agent needs it. You do not have to keep runme running: started from a terminal, it only serves the page, and no agent talks to that window.

## The page

The server serves the Loop Tuner page at `http://127.0.0.1:8766/` (or another port, if that one is taken; it prints which). Open it in a browser on this computer, or ask the agent to open it. The page says "An agent is connected", and from then on the agent works on the same page as you: it sees what you see, reads the data itself, and every change it makes is one undo step for you.

## What to ask

- "Help me tune this system."
- "Let's look at this identification together: what do you see?"
- "Why does this loop ring?"
- "Load the DC motor, run it and tell me the margins."

With a live plant (the HIL plant from Export ▾ › HIL plant), load "HIL with an agent" on the page, connect, and identify and tune it together.

## Options

```
--port N     the page's port (default 8766; a free one if it is taken)
--no-page    serve no page (the tools that run the core alone still work)
--no-open    started from a terminal: do not open the browser
--help       this, with the paths filled in
```

## Files

`mcp.mjs` (the server), `loop-tuner-core.js` (the page's simulation core, which the server runs), `loop-tuner.html` (the page it serves), `runme.sh`, `runme.cmd`, `runme.ps1`, and this `README.md`. Nothing else is needed but Node.js 18 or later.
