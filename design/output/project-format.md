# Project format, version 2

Reader: whoever reads or writes project files, by hand, by agent or in code. The code that enforces it is `normalizeProject` in `src/core/project.js`.

One JSON document. Everything the person sets up is in it, including how the display is set, so a shared file opens exactly as it was left.

```json
{
  "format": "loop-tuner/2",
  "title": "Step at 0.1 s",
  "sim": {},
  "system": {
    "reference": { "period": 1, "components": [
      { "type": "step", "params": { "amplitude": 1, "time": 0.1 } },
      { "type": "fn", "params": {}, "expr": "0.2*sin(2*pi*5*t)" }
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

- **The simulated window is the screen**: t = 0 to `scope.timebase.position + 10 × scope.timebase.scale`. There is no stored duration.
- `sim.sampleTime` is the controller's sample time, present once a controller defines it; without it the window is sampled at 2000 points.
- `system.reference`: `period` (the input repeats with it) and the summed `components` (see [signal-generator.md](signal-generator.md)). A component may carry `"enabled": false`; a Function carries `"expr"`; an Arb carries `"points": [[t, v], …]`.
- `system.plant` is `null` until the Plant tab defines one. Actuator, sensor, disturbance and noise default to ideal / none.
- `scope.channels[i].offset` is in the channel's units: the value drawn on the centre line is `−offset`.
- Older files still load: version 1 (one reference block, `sim.duration`) becomes one component with a period no shorter than the old run; a `pulse` becomes a Square with count 1; a Square's `duty` becomes its high time.
