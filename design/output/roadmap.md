# Roadmap

Reader: whoever picks the next piece of work.

## Built

- Simulation core: blocks, closed-loop simulation, metrics, goal score, auto-tune (`src/core/`), with tests.
- Agent CLI (`cli.mjs`) and agent playbook (`AGENTS.md`).
- v2 instrument: display, Run Control, Horizontal, Vertical, Auto ([instrument.md](instrument.md)).
- Tab 1, Input: the signal generator ([signal-generator.md](signal-generator.md)).

## Next, in order

1. **Plant tab**: pick a plant from the block library, set it with knobs; channel 2 shows its open-loop response to r until a controller exists. Decide where actuator, sensor, disturbance and noise live (probably here, starting as ideal / none).
2. **Controller tab**: hand-tuned candidates, overlaid and stepped through like patches; the v1 candidate list and knobs, reshaped to fit the instrument.
3. **Auto-tune tab**: goal editor, score, optimiser (v1's, reshaped). Add robustness: check a candidate against plant variations.
4. **Analysis tab**: root locus, Bode, Nyquist, pole-zero, computed step metrics.

## Later

- MIMO; system identification from measured data (Arb input + measured output); WebAssembly if a feature needs the speed.

## Open questions

- Header bar: move the file actions into a menu? (Person raised it, 2026-10-24.)
- Sweep speed: real time is the rule for now; long records (minutes) may want a faster mode.
- Candidates on the display: a channel per candidate, or one channel with overlaid candidates (like reference waveforms on a scope)?
