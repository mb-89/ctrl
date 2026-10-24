# The instrument

Reader: whoever changes the display or its controls. Reference: [the Keysight panel the person shared](../input/images/2026-10-24-oscilloscope-keysight-dsox4104g.png).

**The page is an oscilloscope.** The trace display is always the main thing on screen; its controls sit to its right, grouped as on a bench scope: Run Control, Horizontal, Vertical. Setup happens in tabs below ([tabs.md](tabs.md)).

## Display

- 10 horizontal × 8 vertical divisions, dashed minor ticks on the centre axes, like a scope graticule.
- The screen is dark in both page themes (a scope screen is a screen); the panel around it follows the page theme.
- A status line on top shows the run state, the timebase (`100 ms/div`) and the horizontal position. Channel badges along the bottom show each active channel's source and scale (`1  r  200 m/div`).
- A ground marker on the left edge shows each channel's zero level, in the channel's colour.
- Hovering shows a cursor with the time and every active channel's value there.

## Channels (Vertical)

Four channels, in the classic colours: 1 yellow, 2 green, 3 blue, 4 magenta. Each has a source signal, an on/off state, a scale (units per division, 1-2-5 steps) and an offset (position).

| Channel | Default source |
|---|---|
| 1 | r, the reference |
| 2 | y, the plant output |
| 3 | u, the control effort |
| 4 | e, the error r − y |

A channel whose source does not exist yet (no plant, no controller) is shown as "no signal" and draws nothing.

- A channel key selects that channel for the Vertical knobs; pressing the selected channel's key again turns it off; pressing an off channel turns it on and selects it.
- **Scale** knob: 1-2-5 steps per detent. **Position** knob: 0.1 division per detent; double-click (the push of a real knob) sets it to 0.

## Horizontal

- **Scale** knob: seconds per division, 1-2-5 steps.
- **Position** knob: the time at the left edge, 0.1 division per detent; double-click sets it to 0.

## Run Control

- **Run/Stop**: lit green while running, red while stopped. Running repeats the sweep.
- **Single**: one sweep from t = 0, then stop. Lit amber while that sweep runs.
- **Auto**: fits the display to the data: the timebase so the whole record fills the 10 divisions, and for each active channel the scale and offset so its signal spans about 6 divisions, centred.

## The sweep

The sweep runs **in real time over the record**: a 1 s record sweeps in 1 s (the person: "in quotes, we can change that later"). Left of the scan line the trace is the current acquisition, drawn bright; right of it the previous acquisition, dimmed, like phosphor persistence. Stopped, the whole last acquisition is shown bright and there is no scan line.

## Knobs

The knobs are endless rotary encoders, like a scope's: no end stops, each detent is one step. Drag up or right to turn clockwise, scroll, or use the arrow keys when focused. Double-click is the push.

## Keyboard

`R` run/stop, `S` single, `A` auto. Ctrl+Z / Ctrl+Shift+Z undo and redo. Digit keys belong to the numeric entry of the active tab.
