# Project format, version 2

Reader: whoever reads or writes project files, by hand, by agent or in code. The code that enforces it is `normalizeProject` in `src/core/project.js`.

One JSON document. Everything the person sets up is in it, including how the display is set, so a shared file opens exactly as it was left.

```json
{
  "format": "loop-tuner/2",
  "title": "Step at 0.1 s",
  "sim": {},
  "system": {
    "signals": {
      "r": { "period": 1, "components": [
        { "type": "step", "params": { "amplitude": 1, "time": 0.1 } },
        { "type": "fn", "params": {}, "expr": "0.2*sin(2*pi*5*t)" }
      ] }
    },
    "plant": { "type": "diagram", "diagram": {
      "blocks": [
        { "id": "r", "type": "source", "params": { "signal": "r" }, "x": 40, "y": 104 },
        { "id": "p", "type": "firstOrder", "params": { "K": 1, "tau": 0.2 }, "x": 170, "y": 96 },
        { "id": "y1", "type": "sink", "params": { "name": "y1" }, "x": 360, "y": 104 }
      ],
      "wires": [ { "from": "r", "to": "p" }, { "from": "p", "to": "y1" } ]
    } }
  },
  "scope": {
    "timebase": { "scale": 0.1, "position": 0 },
    "channels": [
      { "source": "r", "on": true, "scale": 0.2, "offset": -0.4 },
      { "source": "y1", "on": true, "scale": 0.2, "offset": -0.4 },
      { "source": "", "on": false, "scale": 0.5, "offset": 0 },
      { "source": "", "on": false, "scale": 0.2, "offset": 0 }
    ]
  },
  "goal": { "minimize": { "itae": 1 }, "subjectTo": {} },
  "candidates": [],
  "library": [ { "name": "My motor", "block": { "type": "subsystem", "name": "Motor", "params": {}, "diagram": { "blocks": [], "wires": [] } } } ],
  "ui": { "run": "run", "tab": "plant", "view": "Hanging mass", "setup": 0.42 }
}
```

- **The simulated window is the screen**: t = 0 to `scope.timebase.position + 10 × scope.timebase.scale`. There is no stored duration.
- `sim.sampleTime` is the controller's sample time, present once a controller defines it; without it the window is sampled at 2000 points.
- `system.signals`: named signals, each a `period` (it repeats with it) and summed `components` (see [signal-generator.md](signal-generator.md)). A component may carry `"enabled": false`; a Function carries `"expr"`; an Arb carries `"points": [[t, v], …]`. Every Source block's signal exists here.
- `system.plant`: a diagram (`"type": "diagram"`, see [plant-editor.md](plant-editor.md)) or a single model block (`{ "type": "firstOrder", "params": … }`). A diagram block is `id`, `type`, `params`, `x`, `y`, optional `name` and `flip`; a subsystem carries its own `diagram`. A wire end is a block id, with `:k` for port k (0-based). A diagram plant may carry `views`, its 2D representations ([plant-views.md](plant-views.md)). Actuator, sensor, disturbance and noise (used in a closed loop) default to ideal / none.
- `scope.channels[i].source` is a name the diagram defines: a Source signal or a Sink, or a loop signal once a controller exists; `""` is no source. Names that no longer exist are cleared when the file loads.
- `library`: subsystems the person saved to My blocks.
- A Controller block carries `variants` and `variant` ([controller-proposal.md](controller-proposal.md)).
- An External plant block (`"type": "external"`, [hil.md](hil.md)) carries the plant's ports: `{ "url": "ws://127.0.0.1:8765", "rate": 100, "inputs": ["V", "load"], "inUnits": ["V", "N·m"], "min": [-12, -0.2], "max": [12, 0.2], "safe": [0, 0], "outputs": ["angle", "speed", "current"], "outUnits": ["rad", "rad/s", "A"] }`. The lists may also be written as comma-separated strings.
- Saved traces are files of their own, not part of the project: CSV (`t [s]`, then `name [unit]` columns) or JSON (`{ "format": "loop-tuner-trace/1", "title", "source", "units", "t": [...], "signals": { name: [...] } }`).
- `ui` (optional): how the page opens: `run` (`run`, `stop`, `single`), `tab` (`input`, `plant`, `controller`), `view` (a view's name; else the diagram), `setup` (the setup area's share of the page height, 0–1). Saving and Export HTML write the page's current state here; opening a file or loading a system applies it once. Unknown values are dropped.
- Source and Sink blocks carry `unit` (default `"1"`). `system.signals` holds one signal per Source name, nothing else (`r` when the diagram has no Source).
- A diagram with its own Sources is a whole system: old `candidates` beside it are not run as a closed loop, and loading a whole system from the library replaces them.
- `scope.channels[i].offset` is in the channel's units: the value drawn on the centre line is `−offset`.
- Older files still load: `system.reference` becomes `system.signals.r`; version 1 (one reference block, `sim.duration`) becomes one component with a period no shorter than the old run; a `pulse` becomes a Square with count 1; a Square's `duty` becomes its high time.
