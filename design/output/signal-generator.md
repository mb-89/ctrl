# Tab 1: the signal generator

Reader: whoever changes how the reference is made. Reference: [the generator panel the person shared](../input/images/2026-10-24-signal-generator-panel.png).

**The reference r(t) is a sum of primitives, built on a panel that looks and works like a bench function generator.**

## Layout, left to right

1. **Waveform keys**: DC, Step, Ramp, Pulse, Square, Sine, Chirp, Noise, Arb (load from file).
2. **Parameters**: one field per parameter of the waveform being edited. Clicking a field makes it the active parameter.
3. **Entry**: a big dial with ◀ ▶ cursor keys and a numeric keypad (0–9, `.`, `±`, Enter, Cancel, Del). The active value shows a digit cursor: ◀ ▶ move it, the dial changes that digit, the keypad types a new value and Enter commits it. The computer keyboard works the same way.
4. **Signal**: the stack of components summed into r(t), each with an on/off switch and delete; and the record **Length**, which is also the sweep time.

## Adding a component

1. Press a waveform key. A draft of that primitive appears with sensible defaults (a step is amplitude 1 at t = 0.1 s, the person's example).
2. The display previews it **dashed**: the primitive on its own, and the current signal with the primitive added. The current signal stays solid.
3. Adjust the parameters; the preview follows live.
4. **Add** (Enter) appends it to the stack and to r(t). **Cancel** (Esc) drops the draft.

Clicking a component in the stack opens it for editing the same way: the dashed preview shows the edited version, **Apply** replaces it.

## Primitives

| Key | Parameters | r(t) contribution |
|---|---|---|
| DC | level | constant |
| Step | amplitude, time | amplitude from `time` on |
| Ramp | amplitude, time, rise | rises linearly by `amplitude` over `rise` seconds from `time`, then holds |
| Pulse | amplitude, time, width | amplitude for `width` seconds from `time` |
| Square | amplitude, time, period, duty | square wave between 0 and amplitude from `time` |
| Sine | amplitude, time, frequency, phase | sine from `time` |
| Chirp | amplitude, time, f₀, f₁, duration | sine sweeping linearly from f₀ to f₁ over `duration` |
| Noise | σ, seed | Gaussian, held per sample, reproducible from the seed |
| Arb | gain, time shift, points | piecewise-linear through points loaded from a CSV/TSV file of `t, value` rows |

## Length

The record length is the simulated window and the real-time sweep duration. Default 1 s.
