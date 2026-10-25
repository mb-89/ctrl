// The agentic mode (design/output/mcp.md), the page's two parts: the MCP
// server's download, and the link back to a server that served this page.

import { zipFiles } from '../core/zip.js';
import { simulatorCore, CORE_FILE } from '../core/hilsim.js';

// mcp.mjs and mcp/'s files, put into the bundle by build.mjs.
const MCP_FILES = typeof __MCP_FILES === 'object' ? __MCP_FILES : {};
export const MCP_ZIP = 'loop-tuner-mcp.zip';

// The server's files: mcp.mjs, its README and runme scripts, this page's own
// core cut from its script (the server runs it, so it computes what this page
// computes), and the page (page: Export HTML's text) that it serves.
export function mcpFiles(script, page) {
  const core = simulatorCore(script);
  return { ...MCP_FILES, ...(core ? { [CORE_FILE]: core } : {}), ...(page ? { 'loop-tuner.html': page } : {}) };
}
// As one zip, in a folder of its own; runme.sh stays executable.
export const mcpZip = (files) => zipFiles(Object.entries(files).map(([name, data]) => ({ name: `loop-tuner-mcp/${name}`, data, mode: name.endsWith('.sh') ? 0o755 : 0o644 })));

// A page served by the MCP server
// carries <meta name="loop-tuner-bridge" content="ws://…">, and only such a
// page connects back to that address. The server's page_ tools then call the
// page's own agent API (window.loopTuner) through it: a request is
// { id, method: "record.screen", params: [...] }, the answer { id, result }
// or { id, error }. Any other page (the standalone file, a hosted one) has no
// such line, and this does nothing. #lt-shell[data-agent] says where the link
// stands: connecting, connected, closed.

export function startBridge(api, { toast = () => {}, doc = document } = {}) {
  const url = doc.querySelector('meta[name="loop-tuner-bridge"]')?.content;
  if (!url) return null;
  const shell = doc.getElementById('lt-shell');
  const mark = (state) => { if (shell) shell.dataset.agent = state; };
  let ws = null, was = false;
  // "record.screen" → the function and the object it belongs to.
  const find = (method) => {
    const keys = String(method).split('.');
    let owner = api;
    for (const k of keys.slice(0, -1)) owner = owner?.[k];
    const fn = owner?.[keys.at(-1)];
    if (typeof fn !== 'function') throw new Error(`the page has no method ${method}`);
    return [fn, owner];
  };
  function open() {
    mark('connecting');
    ws = new WebSocket(url);
    ws.onopen = () => {
      mark('connected');
      if (!was) toast('An agent is connected to this page: it sees what you see and can act on it.');
      was = true;
      ws.send(JSON.stringify({ hello: { version: api.version } }));
    };
    ws.onmessage = async (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      let reply;
      try {
        const [fn, owner] = find(m.method);
        const result = await fn.apply(owner, Array.isArray(m.params) ? m.params : []);
        reply = { id: m.id, result: result === undefined ? null : result };
      } catch (err) { reply = { id: m.id, error: err?.message ?? String(err) }; }
      if (ws.readyState === 1) ws.send(JSON.stringify(reply));
    };
    // Gone: try again every 2 s (the server restarts with the agent's
    // client), unless a newer page took the link over.
    ws.onclose = (e) => {
      mark('closed');
      if (e.code === 4000) { toast('Another page took over the link to the agent.'); return; }
      setTimeout(open, 2000);
    };
  }
  open();
  return { url, connected: () => ws?.readyState === 1 };
}
