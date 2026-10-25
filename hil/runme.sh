#!/bin/sh
# Loop Tuner's external plant (Live mode): installs what it needs, then runs.
# Linux and macOS:  sh runme.sh      (options go to hil_plant.py: sh runme.sh --help)
# It needs uv (https://docs.astral.sh/uv/), which brings Python and the
# websockets package. If uv is missing it installs it into ~/.local/bin with
# uv's own installer, through curl or wget; with neither, it first installs
# curl with the system's package manager (it says so; that asks for sudo).
# uv then runs the plant on a Python of its own, which has tkinter for the
# plant's window (a system Python may not). Run it again any time; what is
# installed stays.
set -e
cd "$(dirname "$0")"
PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
have() { command -v "$1" >/dev/null 2>&1; }
if ! have uv; then
  echo "Installing uv, the Python runner (https://docs.astral.sh/uv/) ..."
  if ! have curl && ! have wget; then
    if have brew; then brew install uv
    else
      SUDO=""; [ "$(id -u)" = 0 ] || SUDO="sudo"
      echo "No curl or wget: installing curl with the package manager${SUDO:+ (with sudo)} ..."
      if have apt-get; then $SUDO apt-get update && $SUDO apt-get install -y curl
      elif have dnf; then $SUDO dnf install -y curl
      elif have yum; then $SUDO yum install -y curl
      elif have zypper; then $SUDO zypper --non-interactive install curl
      elif have pacman; then $SUDO pacman -S --noconfirm curl
      elif have apk; then $SUDO apk add curl
      else
        echo "runme.sh needs curl, wget or a package manager to install uv. Or, with Python 3.9+: pip install websockets && python3 hil_plant.py"
        exit 1
      fi
    fi
  fi
  if ! have uv; then
    # Into ~/.local/bin, which is on this script's PATH whatever the
    # installer would choose; a failed download leaves uv missing (below).
    if have curl; then curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="$HOME/.local/bin" sh || true
    else wget -qO- https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="$HOME/.local/bin" sh || true
    fi
  fi
  if ! have uv; then
    echo "Could not install uv (no connection to astral.sh?). Install it by hand (https://docs.astral.sh/uv/getting-started/installation/), then run sh runme.sh again."
    echo "Or, with Python 3.9+: pip install websockets && python3 hil_plant.py"
    exit 1
  fi
fi
exec uv run --python-preference only-managed hil_plant.py "$@"
