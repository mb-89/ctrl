Loop Tuner: the external plant for Live (HIL) mode
==================================================

What it is
  hil_plant.py is a plant that runs outside the page, in real time, on your
  computer: a simulated DC motor swinging an unbalanced arm, at 100 Hz. It
  stands in for real hardware. It is the plant of the systems "HIL: external
  motor" and "HIL: external motor, reference mode" in Loop Tuner's System
  library. It listens on ws://127.0.0.1:8765 (this computer only), sends its
  outputs every cycle and applies the inputs the page sends back.

Start it
  Linux, macOS:  sh runme.sh
  Windows:       right-click runme.ps1 > Run with PowerShell
                 (or: powershell -ExecutionPolicy Bypass -File runme.ps1)
  With uv:       uv run hil_plant.py
  With Python:   pip install websockets, then python3 hil_plant.py

  The runme scripts install uv if it is missing (uv's installer through curl
  or wget on Linux and macOS, or curl from the package manager first;
  winget, else uv's installer, on Windows); uv fetches Python and the
  websockets package. Options go through: sh runme.sh --help.

  A window opens with a big red STOP (an emergency stop, latched until
  Reset), Run/Stop, Reset and the state of the link. Without a display, or
  with --no-gui, the console takes the same commands, one per line:
  s stop, r run, e E-stop, x reset, q quit.

Then, in Loop Tuner
  System library > HIL: external motor > Load. Plant tab: Connect. Nothing
  moves yet: the plant stays stopped until Run. Run starts it: the
  reference first ramps to its first value (at most 10 % of its full scale
  per second), then the loop runs and the arm follows. Stop stops it; Single
  runs one sweep and stops it. Tune the controller while it runs.

Safety, on both sides
  The plant clamps every input to its limits. If it hears nothing for 10
  cycles, if the page goes away while running, if the arm turns more than a
  full turn, or if STOP is pressed (in its window, in its console, or the
  page's E-STOP), it applies its safe inputs (0 V) and stays stopped until
  Reset. The page stops too if it hears nothing for 10 cycles. Ctrl+C ends
  the plant cleanly. --slew PCT also limits how fast each input may change.

Two modes
  Control (the default): the page is the controller and sends the control
  effort (the motor voltage) every cycle, with its reference r and error e,
  which the plant only writes to its log.
  Reference (--mode reference): the plant runs its own controller, with its
  own limits and monitoring; the page sends the reference and records what
  comes back, the plant's own voltage included. Use it with "HIL: external
  motor, reference mode".
  --mode log is a plant with no inputs that holds its own setpoint: the page
  only records (it answers each cycle with an empty message).

The plant the page does not know
  Each physical parameter differs from nominal by a random factor within
  15 % (--vary 0.15, the default; --vary 0 is the nominal plant), a new plant
  every start; --seed N gives the same one again, --show-params prints it.
  Loop Tuner is told the ports, their units and full scales, never the
  physics: it has to identify the plant, as with a real device.
  --plant heater runs a second, simpler plant (a heater and a temperature).

More
  --log FILE.csv   every cycle (t, outputs, inputs, r and e) and every event
  --bench S        measure the next run for S seconds: rate, jitter, round
                   trip, late and dropped cycles; then end
  --rate, --port, --watchdog, --allow-origin, --strict-origin, --check,
  --describe: sh runme.sh --help

The protocol, in a paragraph
  JSON-RPC 2.0 over a WebSocket, one message per text frame; the plant is the
  server and owns the clock. The page asks "describe" (name, rate_hz,
  watchdog_cycles, inputs [{name, unit, min, max, safe, kind}], outputs
  [{name, unit, min, max}], running, estop), then "start" (params {log:
  [{name, unit}]}: what each answer also carries for the plant's log),
  "stop", "reset" and "estop". Every cycle the plant sends y {seq, t, y: [...]}
  and the page answers at once with u {seq, u: [...], log: [...]}, values in
  the units "describe" gave. The plant also sends estop {reason, t}, running
  {running, by, reason} when it starts or stops at its own keys, and status
  once a second. The header of hil_plant.py has every message.

Real hardware in its place
  Keep the server, the cycle, the watchdog and the window of hil_plant.py and
  replace the Motor class with your device's I/O: its ports (name, unit, full
  scale, safe value) are the description, advance(span, u) applies the inputs
  for a span of time, outputs() reads the measurements. Or write the same in
  any language that speaks the protocol above: Loop Tuner's External plant
  block takes whatever ports the plant describes.
