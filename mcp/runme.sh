#!/bin/sh
# Loop Tuner's MCP server (Linux, macOS): installs Node.js if it is missing,
# then starts the server from this terminal: it serves the page, opens it in
# the default browser and explains how to connect an agent. No option is
# needed; every option: sh runme.sh --help (it installs nothing). Run it
# again any time; what is installed stays.
set -e
cd "$(dirname "$0")"
case " $* " in *" --help "*|*" -h "*)
  if command -v node >/dev/null 2>&1; then exec node mcp.mjs --help; fi
  echo "sh runme.sh [options]: installs Node.js if it is missing, then starts the MCP server (mcp.mjs)."
  echo "Node.js is not installed yet, so its options cannot be listed here: README.md has them."
  exit 0;;
esac
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
