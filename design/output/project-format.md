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
  "ui": { "run": "run", "tab": "plant", "view": "Hanging mass", "setup": 0.42, "speed": 1 }
}
```

- **The simulated window is the screen**: t = 0 to `scope.timebase.position + 10 × scope.timebase.scale`. There is no stored duration.
- `sim.sampleTime`: for a diagram, **the scope's record step** (the spacing of the samples the screen shows and the Measure, FFT and XY read); without it the window is recorded at 2000 points. Controller and Observer blocks sample at their own `Ts` whatever the record step: every k·Ts lies on the integration grid. A library entry may carry it (*DC motor, sliding mode* records at 0.25 ms); loading that system whole keeps it, and loading another whole system clears it. In an older closed loop (`candidates`) it is the controller's sample time.
- `system.signals`: named signals, each a `period` (it repeats with it) and summed `components` (see [signal-generator.md](signal-generator.md)). A component may carry `"enabled": false`; a Function carries `"expr"`; an Arb carries `"points": [[t, v], …]`. Every Source block's signal exists here.
- `system.plant`: a diagram (`"type": "diagram"`, see [plant-editor.md](plant-editor.md)) or a single model block (`{ "type": "firstOrder", "params": … }`). A diagram block is `id`, `type`, `params`, `x`, `y`, optional `name` and `flip`; a subsystem carries its own `diagram`. A wire end is a block id, with `:k` for port k (0-based). A diagram plant may carry `views`, its 2D representations ([plant-views.md](plant-views.md)). Actuator, sensor, disturbance and noise (used in a closed loop) default to ideal / none.
- `scope.channels[i].source` is a name the diagram defines: a Source signal or a Sink, or a loop signal once a controller exists; `""` is no source. Names that no longer exist are cleared when the file loads.
- `library`: subsystems the person saved to My blocks.
- A Controller block (`"params": { "inputs", "Ts" }`) and an Observer block (`"params": { "inputs", "outputs", "Ts" }`) carry `variants` and `variant` ([controller-proposal.md](controller-proposal.md)).
- **Variants hold inputs only.** A designed variant (`lqr`, `scheduledPI`, `swingUpLqr`, `trajectory`; an Observer's `kalman`) keeps its weights, levels, times, limits and hand gains (a PI's feedforward and anti-windup); the numbers it runs on (K, kr, Kp, Ki, u0, a swing-up's pole length and g, a plan, a Kalman model and L) are computed in the page from the plant and are never in the file ([designs.md](designs.md)). A file that has them is refused with a sentence, such as "lqr computes K and kr from the plant and Q, R and track; to set them by hand use Copy as numbers (a State feedback variant)". Copy as numbers writes a hand variant (`stateFeedback`, `pid`, `gainScheduled`, `swingUp`, `luenberger`) with the numbers, which no longer follow the plant. A `kalman` variant with A, B, C, Q and R typed in and no L (main's before the design layer) opens as `kalmanModel`, the Kalman filter on that model, whose gain L the page computes from it, Q and R (v2.7.4; it was refused, and the whole file with it).
- **Empty fields** (`null`) mean "from the plant" or "open": a Dead time's `y0` (before T_d it puts out its input at t = 0, as a pipe already flowing), a Kalman filter's `R` (from the noise and quantizer blocks on each measurement), and open actuator limits (`umin`, `umax`: ∓∞).
- An External plant block (`"type": "external"`, [hil.md](hil.md)) carries the plant's ports: `{ "url": "ws://127.0.0.1:8765", "rate": 100, "inputs": ["V", "load"], "inUnits": ["V", "N·m"], "min": [-12, -0.2], "max": [12, 0.2], "safe": [0, 0], "outputs": ["angle", "speed", "current"], "outUnits": ["rad", "rad/s", "A"] }`. The lists may also be written as comma-separated strings.
- Saved traces are files of their own, not part of the project: CSV (`t [s]`, then `name [unit]` columns) or JSON (`{ "format": "loop-tuner-trace/1", "title", "source", "units", "t": [...], "signals": { name: [...] } }`).
- `ui` (optional): how the page opens: `run` (`run`, `stop`, `single`), `tab` (`input`, `plant`, `controller`, `tune`, `analysis`), `view` (a view's name; else the diagram), `setup` (the setup area's share of the page height, 0–1), `speed` (how fast simulated time runs: a positive factor, 1 real time, or `-1` as fast as possible; [instrument.md](instrument.md#speed)). Saving and Export HTML write the page's current state here; opening a file or loading a system applies it once. Unknown values are dropped. `speed` may also be written as a string as typed in the page (`"10x"`, `"inf"`); it is stored as a number; 0, other negatives and words are dropped, and a file without it leaves the page's speed as it is.
- Source and Sink blocks carry `unit` (default `"1"`). `system.signals` holds one signal per Source name, nothing else (`r` when the diagram has no Source).
- A diagram with its own Sources is a whole system: old `candidates` beside it are not run as a closed loop, and loading a whole system from the library replaces them.
- `scope.channels[i].filter` (optional): a display filter `{ "type": "lowpass" | "highpass" | "bandpass" | "notch", "f0": Hz, "order": 2 | 4 | 6 | 8, "q": … }`.
- `scope.channels[i].measure` (optional): `true` puts the channel's **Measure** line under the screen (mean, rms, ac rms, p-p, total variation per second, reversals per second; [instrument.md](instrument.md#measure)); absent is off. It stays while the channel is off; the line shows when the channel is on. Example: `{ "source": "V", "on": false, "scale": 5, "offset": 0, "measure": true }`.
- `scope.view` (optional): `{ "mode": "fft" | "spectrogram" | "xy", "fmin", "fmax" (Hz), "db": false for a linear FFT, "size": spectrogram frame length, "levels": { signal: [floor, ceiling] } for the spectrogram, "aboveNoise": true for the spectrogram's colour as dB above the noise at each frequency, "noiseLevels": { signal: [floor, ceiling] } its levels, "delta": true for XY Δ (channels in channel 1's unit draw channel 1 minus themselves), "right": channel index on the right axis }`; absent means the time view.
- `scope.view.levels` (optional): the spectrogram's colour levels per signal, `{ name: [floor, ceiling] }` in dB of that signal's unit (0 dB = 1 unit): below the floor black, above the ceiling the brightest colour. Each pair is rounded to 0.1 dB; a reversed pair is swapped; two numbers at least 1 dB apart, within ±300 dB, or that signal's pair is dropped. A signal without a pair, or no `levels` at all, has automatic levels (the ceiling at the largest amplitude shown, the floor 10 dB above the median; [instrument.md](instrument.md)). Example: `"view": { "mode": "spectrogram", "levels": { "speed_m": [-60, 20] } }`.
- `scope.view.aboveNoise` (optional): `true` shows the spectrogram's colour as dB above the noise at each frequency (Above noise); absent (any other value) is Absolute, dB of the signal's unit, the default. One switch for the whole view, not per signal: it is a way of reading the picture, and stays when the mode or the channel changes.
- `scope.view.noiseLevels` (optional): the levels used Above noise, per signal, `{ name: [floor, ceiling] }` in dB above the noise (0 dB = the noise at that frequency), with the same rules as `levels`. They are kept apart from `levels` because the units differ: switching shows the other unit's levels, switching back returns these. A signal without a pair has automatic levels (the floor 6 dB above the noise, the ceiling at the largest value shown). Example: `"view": { "mode": "spectrogram", "aboveNoise": true, "levels": { "speed_m": [-60, 20] }, "noiseLevels": { "speed_m": [3, 30] } }`.
- `scope.channels[i].offset` is in the channel's units: the value drawn on the centre line is `−offset`.
- Older files still load: `system.reference` becomes `system.signals.r`; version 1 (one reference block, `sim.duration`) becomes one component with a period no shorter than the old run; a `pulse` becomes a Square with count 1; a Square's `duty` becomes its high time.
