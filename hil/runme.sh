#!/bin/sh
# Loop Tuner's external plant (Live mode): installs what it needs, then runs.
# Linux and macOS:  sh runme.sh      (options go to hil_plant.py: sh runme.sh --help)
# It needs only curl or wget: uv (https://docs.astral.sh/uv/) installs itself
# into ~/.local/bin, then fetches Python and the websockets package for
# hil_plant.py. Run it again any time; what is installed stays.
set -e
cd "$(dirname "$0")"
PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
if ! command -v uv >/dev/null 2>&1; then
  echo "Installing uv, the Python runner (https://docs.astral.sh/uv/) ..."
  if command -v curl >/dev/null 2>&1; then curl -LsSf https://astral.sh/uv/install.sh | sh
  elif command -v wget >/dev/null 2>&1; then wget -qO- https://astral.sh/uv/install.sh | sh
  else
    echo "runme.sh needs curl or wget to install uv. Or, with Python 3.9+: pip install websockets && python3 hil_plant.py"
    exit 1
  fi
fi
exec uv run hil_plant.py "$@"
