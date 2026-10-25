# Tab 1: the signal generator

Reader: whoever changes how the reference is made. Reference: [the generator panel the person shared](../input/images/2026-10-24-signal-generator-panel.png).

**Each signal (r, and any other a Source block plays) is a sum of primitives, repeated with its period, built on a panel that looks and works like a bench function generator.**

## Layout: one compact row, left to right

0. **Edit**: the signal being edited: every signal a Source block in the plant plays (r first).
1. **Waveform**: the keys (DC, Step, Ramp / Square, Sine, Chirp / Noise, Function, Arb) and, under them, the signal's **Period**.
2. **Parameters**: the waveform being drafted or edited, with **Add** (or Apply) and **Cancel** in its header. Clicking a field makes it the active one.
3. **Signal**: the stack of components summed into r(t), each with an on/off switch and delete; click one to edit it.
4. **Entry**: numeric keypad (0–9, `.`, `±`, with Del, Cancel and Enter as three small keys under it) beside the big dial and its ◀ ▶ cursor keys. The active value shows a digit cursor: ◀ ▶ move it, the dial changes that digit, the keypad types a value and Enter sets it. The computer keyboard works the same way.

The whole tab fits without scrolling at common screen sizes.

## Adding a component

1. Press a waveform key. A draft appears with sensible defaults (a step is amplitude 1 at t = 0.1 s, the person's example).
2. The display previews it **dashed**: the primitive on its own, and r(t) with it added. The current r(t) stays solid.
3. Adjust; the preview follows live.
4. **Add** (Enter) puts it into the stack and r(t). **Cancel** (Esc) drops it.

## Period

The input repeats with its period, as a generator repeats its waveform; each repetition covers (k·T, (k+1)·T]. Auto Scale shows one period. Default 1 s.

A run is periodic after its start ([inputs 50–52](../input/2026-10-25-52-a-spike-only-at-the-start.md): a spike at t = 0 is accepted, at no other time). So:

- **An eased Sine eases once**, in the run's first period; every later period runs on its steady phase (w·(t′ − ease/2) + phase, t′ the time since its start in the period). A sine with a whole number of cycles per period then joins up where it repeats, in value and slope; its first period is what it was.
- **The wrap must not be a step.** Under the Signal column a line in the warning colour says when the signal ends the period away from where it starts ("jumps where it repeats"), or, for a smooth signal, with another slope ("kinks where it repeats"). Steps inside a period are deliberate and stay; steps that return are quiet, and so is a sawtooth (a Ramp still rising at the period's end), which is built to drop there. The line follows the draft, as the preview does. `wrapJump(ref)` in `core/signals.js` measures it (value and slope across the wrap in the steady periods; noise left out); `wrapWarning(ref, name)` is the line.
- **Later periods are the same, bit for bit**: their time in the period is taken on a picosecond grid, so a step lands on the same sample in every period after the first (the run's own time carries the rounding of its size).
- A signal written in short (a parameter left out, as the library writes them) plays with the defaults, as the page plays it: `referenceFn` normalizes its components.

## Primitives

| Key | Parameters | Contribution within a period |
|---|---|---|
| DC | level | constant |
| Step | amplitude, time | amplitude from `time` on |
| Ramp | amplitude, start, rise time | rises linearly by `amplitude` over the rise time, then holds |
| Square | amplitude, start, high time, period, count | pulses of `high time` every `period` from `start`; count 0 repeats without end, count 1 is a single pulse (this replaces a separate Pulse key) |
| Sine | amplitude, start, frequency, phase, ease | sine from `start`; with ease the phase rate rises from 0 over that time, in the run's first period only |
| Chirp | amplitude, start, f₀, f₁, duration | sine sweeping linearly from f₀ to f₁ |
| Noise | σ, seed | Gaussian, held per sample, reproducible from the seed |
| Function | the formula y(t) | any formula in t: `0.3*sin(2*pi*4*t) + 0.5*step(t-0.6)` |
| Arb | gain, time shift, points | piecewise-linear through `t, value` rows loaded from a CSV/TSV file |

## Function formulas

Parsed by Loop Tuner's own small parser (`src/core/expr.js`), never evaluated as code: numbers, `t`, `pi`, `e`, `+ − * / ^`, implicit multiplication (`2t`), and a fixed list of functions (`sin cos tan asin acos atan exp log ln log10 sqrt abs floor ceil round sign step min max pow mod atan2 clamp`). Anything else is a parse error shown under the field. A parser rather than `eval`, as the person asked; a library such as math.js would have tripled the page size for the same result.
