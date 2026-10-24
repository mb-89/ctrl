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

## Primitives

| Key | Parameters | Contribution within a period |
|---|---|---|
| DC | level | constant |
| Step | amplitude, time | amplitude from `time` on |
| Ramp | amplitude, start, rise time | rises linearly by `amplitude` over the rise time, then holds |
| Square | amplitude, start, high time, period, count | pulses of `high time` every `period` from `start`; count 0 repeats without end, count 1 is a single pulse (this replaces a separate Pulse key) |
| Sine | amplitude, start, frequency, phase | sine from `start` |
| Chirp | amplitude, start, f₀, f₁, duration | sine sweeping linearly from f₀ to f₁ |
| Noise | σ, seed | Gaussian, held per sample, reproducible from the seed |
| Function | the formula y(t) | any formula in t: `0.3*sin(2*pi*4*t) + 0.5*step(t-0.6)` |
| Arb | gain, time shift, points | piecewise-linear through `t, value` rows loaded from a CSV/TSV file |

## Function formulas

Parsed by Loop Tuner's own small parser (`src/core/expr.js`), never evaluated as code: numbers, `t`, `pi`, `e`, `+ − * / ^`, implicit multiplication (`2t`), and a fixed list of functions (`sin cos tan asin acos atan exp log ln log10 sqrt abs floor ceil round sign step min max pow mod atan2 clamp`). Anything else is a parse error shown under the field. A parser rather than `eval`, as the person asked; a library such as math.js would have tripled the page size for the same result.
