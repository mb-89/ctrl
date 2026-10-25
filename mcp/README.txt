Loop Tuner's MCP server
=======================

An agent (an AI assistant whose client speaks MCP, the Model Context
Protocol) uses Loop Tuner through this server: it loads systems, runs and
measures them, auto-tunes, analyses, and saves the project. The server also
serves the Loop Tuner page on this computer; open it in a browser and the
agent works on the page you see (the agentic mode): you and the agent look
at the same data, identify and tune together.

Needs Node.js 18 or later; runme installs it if it is missing. Nothing else.

1. Register the server with your agent's client, once. The server is the
   command

       node /full/path/to/this/folder/mcp.mjs

   over stdio. A command-line client usually takes

       <client> mcp add loop-tuner -- node /full/path/to/this/folder/mcp.mjs

   and a desktop client a JSON configuration such as

       { "mcpServers": { "loop-tuner": { "command": "node",
           "args": ["/full/path/to/this/folder/mcp.mjs"] } } }

   runme prints these lines with this folder's full path filled in:
   sh runme.sh (Linux, macOS) or double-click runme.cmd (Windows). It
   installs Node.js first if needed (the system's package manager on Linux,
   Homebrew on macOS, winget on Windows).

2. Start your agent. Its client starts the server by itself; ask the agent
   "where is the Loop Tuner page?" (it calls page_status) or "open the Loop
   Tuner page" (page_open). The page is at http://127.0.0.1:8766/ unless that
   port is taken (then another; the agent knows which).

3. Ask in plain words: "load the DC motor, run it and tune it", "what do you
   see in this step response?", "how much margin does the loop have?".

Started from a terminal (runme), the server only serves the page, since no
agent is talking to it, and prints how to register it. Ctrl+C ends it.

Files: mcp.mjs (the server), loop-tuner-core.js (the page's simulation core,
which the server runs), loop-tuner.html (the page it serves), runme.sh,
runme.cmd, runme.ps1, this README.txt. Options: --port N, --no-page.
