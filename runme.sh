#!/bin/sh
# Loop Tuner (Linux, macOS): installs what it needs, builds the page and opens
# it. No option is needed: sh runme.sh. Every command: sh runme.sh --help (it
# installs nothing). Run it again any time; what is installed stays.
#
# It installs Node.js 18 or later with the system's package manager (or brew)
# when it is missing, and uv (https://docs.astral.sh/uv/, the Python runner
# the external plant needs) with uv's own installer; the plant's own runme
# (hil/runme.sh, built with the page's core into dist/hil-plant/) does the rest.
set -e
cd "$(dirname "$0")"
PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
have() { command -v "$1" >/dev/null 2>&1; }
SUDO=""; [ "$(id -u)" = 0 ] || SUDO="sudo"

usage() {
  cat <<'EOF'
sh runme.sh [command]: installs what Loop Tuner needs, then

  (none)       builds the page and opens it in the browser
  build        builds the page: dist/loop-tuner.html (and dist/artifact.html, dist/hil-plant/)
  open         opens the built page in the browser
  test         runs the tests (npm test); test-slow runs the slow ones
  mcp [opts]   starts the MCP server (mcp/runme.sh: it serves the page and explains how to connect an agent)
  plant [opts] starts the external plant for Live mode (the built dist/hil-plant/runme.sh; --help lists its options)
  cli [args]   the command line for agents and scripts (tools/cli.mjs; cli --help lists it)

README.md says what each part is.
EOF
}
case "${1:-}" in --help|-h|help) usage; exit 0;; esac

node_ok() { have node && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)'; }
need_node() {
  node_ok && return 0
  echo "Loop Tuner needs Node.js 18 or later; installing it ..."
  if have apt-get; then $SUDO apt-get update && $SUDO apt-get install -y nodejs
  elif have dnf; then $SUDO dnf install -y nodejs
  elif have pacman; then $SUDO pacman -S --noconfirm nodejs
  elif have zypper; then $SUDO zypper --non-interactive install nodejs
  elif have apk; then $SUDO apk add nodejs
  elif have brew; then brew install node
  else echo "No package manager found: install Node.js 18 or later from https://nodejs.org, then run this again."; exit 1
  fi
  if ! have node; then echo "Node.js did not install: install it from https://nodejs.org, then run this again."; exit 1; fi
  node_ok || { echo "This Node.js is older than 18: install a newer one from https://nodejs.org, then run this again."; exit 1; }
}
# uv only matters for the external plant: a failure here is said, not fatal.
want_uv() {
  have uv && return 0
  echo "Installing uv, the Python runner the external plant uses (https://docs.astral.sh/uv/) ..."
  if have brew; then brew install uv || true
  elif have curl; then curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="$HOME/.local/bin" sh || true
  elif have wget; then wget -qO- https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="$HOME/.local/bin" sh || true
  fi
  have uv || echo "(uv is not installed: the page works without it; 'sh runme.sh plant' installs it when you need the external plant.)"
}
open_page() {
  page="$(pwd)/dist/loop-tuner.html"
  if have xdg-open; then xdg-open "$page" >/dev/null 2>&1 &
  elif have open; then open "$page"
  else echo "Open this file in a browser: $page"; return 0
  fi
  echo "Opened $page"
}

cmd="${1:-}"; [ $# -gt 0 ] && shift
case "$cmd" in
  ""|start) need_node; want_uv; node tools/build.mjs; open_page;;
  build) need_node; node tools/build.mjs;;
  open) [ -f dist/loop-tuner.html ] || { need_node; node tools/build.mjs; }; open_page;;
  test) need_node; node --test test/*.test.mjs;;
  test-slow) need_node; node --test test/planner.slow.mjs;;
  mcp) exec sh mcp/runme.sh "$@";;
  plant) [ -f dist/hil-plant/loop-tuner-core.js ] || { need_node; node tools/build.mjs; }; exec sh dist/hil-plant/runme.sh "$@";;
  cli) need_node; exec node tools/cli.mjs "$@";;
  *) echo "Unknown command: $cmd"; echo; usage; exit 1;;
esac
