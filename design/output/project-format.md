# Project format, version 2

Reader: whoever reads or writes project files, by hand, by agent or in code. The code that enforces it is `normalizeProject` in `src/core/project.js`.

One JSON document. Everything the person sets up is in it, including how the display is set, so a shared file opens exactly as it was left.

```json
{
  "format": "loop-tuner/2",
  "title": "Step at 0.1 s",
  "sim": { "duration": 1, "sampleTime": 0.0005 },
  "system": {
    "reference": { "components": [
      { "type": "step", "params": { "amplitude": 1, "time": 0.1 } }
    ] },
    "plant": null
  },
  "scope": {
    "timebase": { "scale": 0.1, "position": 0 },
    "channels": [
      { "source": "r", "on": true, "scale": 0.2, "offset": -0.4 },
      { "source": "y", "on": true, "scale": 0.2, "offset": -0.4 },
      { "source": "u", "on": false, "scale": 0.5, "offset": 0 },
      { "source": "e", "on": false, "scale": 0.2, "offset": 0 }
    ]
  },
  "goal": { "minimize": { "itae": 1 }, "subjectTo": {} },
  "candidates": []
}
```

- `sim.duration` is the record length (and the sweep time). `sim.sampleTime` is the controller's sample time.
- `system.reference.components`: the summed primitives (see [signal-generator.md](signal-generator.md)); a component may carry `"enabled": false`, and an Arb component carries `"points": [[t, v], …]`.
- `system.plant` is `null` until the Plant tab defines one. Actuator, sensor, disturbance and noise default to ideal / none.
- `scope.channels[i].offset` is in the channel's units: the value drawn at the centre line is `−offset`.
- Version 1 files (`"format": "loop-tuner/1"`) still load: their single reference block becomes one component, and missing slots take the v1 defaults.
