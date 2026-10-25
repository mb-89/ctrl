Loop Tuner: the external plant for Live (HIL) mode
==================================================

What it is
  hil_plant.py is a plant that runs outside the page, in real time, on your
  computer, and stands in for real hardware. It simulates a model of Loop
  Tuner's System library with the page's own simulation code
  (loop-tuner-core.js, which the page put beside it in this zip), at 100 Hz:
  by default a DC motor swinging an unbalanced arm, or any other model
  (--model, --list), or one drawn at random (--random). It is the plant of
  the systems "HIL: an external plant" and "HIL with an agent" (the same,
  with an agent on the page), which know only the inputs and outputs it
  describes: to
  the page it is a black box, identified before tuning. It listens on
  ws://127.0.0.1:8765 (this computer only), sends its outputs every cycle
  and applies the inputs the page sends back.

Start it
  Linux, macOS:  sh runme.sh
  Windows:       double-click runme.cmd (it runs runme.ps1; or right-click
                 runme.ps1 > Run with PowerShell, or in a terminal:
                 powershell -ExecutionPolicy Bypass -File runme.ps1)
  With uv:       uv run --python-preference only-managed hil_plant.py
                 (uv's own Python, which has tkinter for the window;
                 plain uv run hil_plant.py may pick a system Python without)

  The runme scripts install uv if it is missing (winget on Windows, else
  uv's installer; uv's installer through curl or wget on Linux and macOS,
  or curl from the package manager first) and say what to do if that
  fails. uv then fetches a Python of its own and what the script needs:
  websockets, and mini-racer (V8, the engine that runs the page's code).
  Options go through: sh runme.sh --help, runme.cmd --help.

  A window opens with a big red STOP (an emergency stop, latched until
  Reset), Run/Stop, Reset, where it listens (ws://127.0.0.1:8765; the title
  says so too) and the state of the link. Without a display, or with
  --no-gui, the console takes the same commands, one per line:
  s stop, r run, e E-stop, x reset, q quit.

Then, in Loop Tuner
  System library > HIL: an external plant > Load. Plant tab: Connect: the
  page takes the inputs and outputs the plant describes. Nothing moves yet:
  the plant stays stopped until Run. Run starts it: the reference first
  ramps to its first value (at most 10 % of its full scale per second),
  then the loop runs. Stop stops it; Single runs one sweep and stops it.
  Tune the controller while it runs.

Which model
  --model NAME     a model of the System library (--list lists them, with
                   their inputs and outputs), or a project file (.json)
                   saved by the page; default "DC motor with an unbalanced arm"
  --random         any model, drawn with the seed
  --list           the models it can run

The plant the page does not know
  Each physical parameter of the model differs from nominal by a random
  factor within 15 % (--vary 0.15, the default; --vary 0 is the nominal
  plant); its effects (friction, torque ripple, a resonance, a dead time,
  as the model has them) are each on or off at random (--detail random,
  the default; all, none, or the names of those on, with commas). One seed
  draws everything, a new one every start; --seed N gives the same plant
  again; --set NAME=VALUE fixes a parameter; --show-params prints what was
  drawn. Loop Tuner is told the inputs and outputs, their units, full
  scales and hard ranges, never the model or its physics: it has to
  identify the plant, as with a real device. It has no disturbance input,
  as a rig without a dynamometer has none; --dyno offers the model's
  disturbances (the arm's load torque, "load"), which the page then shows
  as more described inputs.

Safety, on both sides
  The plant clamps every input to its limits. If it hears nothing for 10
  cycles, if the page goes away while running, if an output leaves its hard
  range (the arm: angle beyond 2.5 rad either way, speed beyond 60 rad/s,
  current beyond 10 A; other models: as they declare, or from their own
  run), if an output is not a number, if its own cycle fails, or if STOP is
  pressed (in its window, in its console, or the page's E-STOP), it applies
  its safe inputs and stays stopped until Reset. Who pressed STOP resets it:
  a STOP pressed here only here, the page's E-STOP only on the page (while
  it is connected). The page stops too if it hears nothing for 10 cycles,
  or no number for an output for 3. Ctrl+C ends the plant cleanly; a cycle
  that fails ends it with the error, its inputs safe. --slew PCT also
  limits how fast each input may change.

Three modes
  Control (the default): the page is the controller and sends the control
  effort (the arm's voltage) every cycle, with its reference r and error e,
  which the plant only writes to its log.
  Reference (--mode reference): the model's own controller runs in the
  plant, with its limits, while the plant runs (stopped, its effort is
  safe); the page sends the reference and records what comes back, the
  plant's own effort included. The page's Live settings switch the mode
  (Mode: "Plant") while the plant is stopped; starting it with
  --mode reference does the same from the start.
  --mode log: no inputs; the model's own controller plays its own reference
  (or --setpoint X): the page only records.

More
  --log FILE.csv   every cycle (t, outputs, inputs, r and e) and every event
  --bench S        measure the next run for S seconds: rate, jitter, round
                   trip, late and dropped cycles; then end
  --check          the nominal model with its own controller for one period,
                   then full effort until an output leaves its hard range
  --rate, --port, --watchdog, --allow-origin, --strict-origin, --core,
  --describe: sh runme.sh --help

The protocol, in a paragraph
  JSON-RPC 2.0 over a WebSocket, one message per text frame; the plant is the
  server and owns the clock. The page asks "describe" (name, rate_hz,
  watchdog_cycles, inputs [{name, unit, min, max, safe, kind}], outputs
  [{name, unit, min, max, hard_min, hard_max}], running, estop; min ... max
  is a full scale, hard_min ... hard_max where the plant E-stops), then
  "start" (params {log: [{name, unit}]}: what each answer also carries for
  the plant's log), "stop", "reset" and "estop". Every cycle the plant sends
  y {seq, t, y: [...], applied: [...]} (applied: the inputs it applied,
  after its clamps) and the page answers at once with u {seq, u: [...],
  log: [...]}, values in the units "describe" gave (null for an output that
  is not a number). The plant also sends estop {reason, t}, running
  {running, by, reason} whenever it starts or stops, and status once a
  second, every frame in the order made. Errors: -32700 not JSON, -32600 not
  a request, -32601 no such method, -32602 params not an object, -32000
  refused (E-stop latched, or a STOP pressed at the plant), -32603 failed.
  The header of hil_plant.py has every message.

Real hardware in its place
  Keep the server, the cycle, the watchdog and the window of hil_plant.py and
  replace the CorePlant class with your device's I/O: its inputs and outputs
  (name, unit, full scale, safe value; for an output its hard range) are
  the description, cycle(segments) applies the inputs for each span of the
  cycle and returns the measurements, running(on) starts and stops it, and
  safe(u) puts the safe inputs on the device at once (hil_plant.py calls it
  on every E-stop, stop, failed cycle and shutdown: it must not fail). Give
  the device a watchdog of its own as well (its drive goes safe when nobody
  writes to it for a while): if this script's process dies, nothing here
  can act. Or write the same in any language that speaks the protocol
  above: Loop Tuner's External plant block takes whatever ports the plant
  describes.
