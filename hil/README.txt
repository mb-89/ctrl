Loop Tuner: the external plant for Live (HIL) mode
==================================================

hil_plant.py is a DC motor swinging an unbalanced arm, simulated in real time
at 100 Hz on your computer: the plant of the system "HIL: external motor" in
Loop Tuner's System library. It listens on ws://127.0.0.1:8765 (this computer
only), sends its outputs every cycle and applies the inputs the page sends
back.

Start it
  Linux, macOS:  sh runme.sh
  Windows:       right-click runme.ps1 > Run with PowerShell
                 (or: powershell -ExecutionPolicy Bypass -File runme.ps1)
  With uv:       uv run hil_plant.py
  With Python:   pip install websockets, then python3 hil_plant.py

The runme scripts install uv if it is missing (curl or wget on Linux and
macOS; winget on Windows), and uv fetches Python and the websockets package.

Then, in Loop Tuner: System library > HIL: external motor > Load, and press
Connect under Run Control. Run and Stop on the scope start and stop the plant.

Safety: if the plant hears nothing for 10 cycles, or you press Enter in its
window, it applies its safe inputs (0 V) and stays stopped (E-stop) until the
page's Reset. Ctrl+C ends it.

The plant is not quite the nominal one: each physical parameter differs by up
to 15 % (--vary 0.15), a new plant each start unless --seed is given; --set
J=0.003 fixes a parameter, --vary 0 gives the nominal plant. It prints the
plant it runs; Loop Tuner is not told, as with a real device.

Options: --port, --rate, --watchdog, --vary, --seed, --set, --allow-origin,
--strict-origin, --check, --describe (sh runme.sh --help).

The protocol is JSON-RPC 2.0 over a WebSocket, described in hil_plant.py's
header; any language can implement it, so real hardware can take the motor's
place.
