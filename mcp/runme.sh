#!/bin/sh
# Loop Tuner's MCP server (Linux, macOS): installs Node.js if it is missing,
# then starts the server from this terminal, which serves the page and prints
# how to register the server with your agent's client. Options go to mcp.mjs
# (--port 8766). Run it again any time; what is installed stays.
set -e
cd "$(dirname "$0")"
ok() { command -v node >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)'; }
if ! ok; then
  echo "Loop Tuner's MCP server needs Node.js 18 or later; installing it ..."
  if command -v apt-get >/dev/null 2>&1; then sudo apt-get update && sudo apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then sudo dnf install -y nodejs
  elif command -v pacman >/dev/null 2>&1; then sudo pacman -S --noconfirm nodejs
  elif command -v zypper >/dev/null 2>&1; then sudo zypper install -y nodejs
  elif command -v apk >/dev/null 2>&1; then sudo apk add nodejs
  elif command -v brew >/dev/null 2>&1; then brew install node
  else echo "No package manager found: install Node.js 18 or later from https://nodejs.org, then run this again."; exit 1
  fi
fi
ok || { echo "This Node.js is older than 18: install a newer one from https://nodejs.org, then run this again."; exit 1; }
exec node mcp.mjs "$@"
