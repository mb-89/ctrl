# The instrument

Reader: whoever changes the display or its controls. Reference: [the Keysight panel the person shared](../input/images/2026-10-24-oscilloscope-keysight-dsox4104g.png).

**The page is an oscilloscope.** The trace display is always the main thing on screen; its controls sit to its right, grouped as on a bench scope: Run Control, Horizontal, Vertical. Setup happens in tabs below ([tabs.md](tabs.md)). It looks like a scope; where a scope's behaviour can be improved (direct manipulation, typed values, axis labels), it is.

## The screen is the record

What the screen shows is what is simulated and swept: from t = 0 to the right edge (horizontal position + 10 divisions). There is no separate record length. The sweep crosses the screen in real time: at 100 ms/div it takes 1 s. Left of the scan line the trace is the current sweep, bright; right of it the previous one, dimmed.

## Display

- 10 × 8 divisions, dotted graticule with ticked centre axes. Time labels below the plot; the active channel's values on the left, in its colour (the active channel is the selected line, or else the Vertical channel).
- The screen is dark in both page themes; the panel around it follows the theme.
- Status line on top: run state, timebase, position, and which line is selected. Channel badges below: source and scale.
- A coloured marker in the left margin shows each channel's zero level.
- Hovering the plot shows a cursor with t and every active channel's value.

## Direct manipulation

Every gesture sets the same settings as the knobs, and is undoable.

| Gesture | Effect |
|---|---|
| Wheel over the plot | Zoom time and all shown channels, around the cursor (the point under the cursor stays put) |
| Wheel over the time axis (below the plot) | Zoom time only |
| Wheel over the value axis (left of the plot) | Zoom values only |
| Click a trace or its marker | Select that line; drag and wheel now act on it alone (wheel zooms its values) |
| Click empty plot, or Esc | Release the line |
| Drag | Pan: sideways moves time, up/down moves all lines (or the selected one) |
| Shift + drag | Zoom to the marked box; a flat band zooms time only, a narrow band values only |

Wheel and knob zooms step 1-2-5; a box zoom shows exactly the marked region.

## Channels (Vertical)

Four channels, in the classic colours: 1 yellow, 2 green, 3 blue, 4 magenta. Each has a source signal, an on/off state, a scale (units per division) and an offset.

| Channel | Default source |
|---|---|
| 1 | r, the reference |
| 2 | y, the plant output |
| 3 | u, the control effort |
| 4 | e, the error r − y |

A channel whose source does not exist yet (no plant, no controller) shows "no signal" and draws nothing.

- A channel key selects that channel for the Vertical knobs; pressing the selected channel's key again turns it off; pressing an off channel turns it on and selects it.
- **Scale** knob: 1-2-5 steps. **Position** knob: 0.1 division per detent; double-click (the knob's push) sets it to 0.

## Horizontal

- **Scale** knob: seconds per division, 1-2-5 steps. **Position** knob: the time at the left edge; double-click sets it to 0.

## Readouts

Every knob has a readout below it. Click it to type a value: `20m`, `100 ms`, `2u`, `-0.4`. Typed values need not be 1-2-5.

## Run Control

- **Run/Stop**: lit green while running, red while stopped. Stop freezes the sweep, not the data: edits still show at once.
- **Single**: one sweep across the screen, then stop; lit amber meanwhile.
- **Auto Scale**: the timebase shows one period of the input (the smallest 1-2-5 step whose 10 divisions hold the period, position 0); each channel with a signal is scaled to about 6 divisions and centred on a whole division.

## Knobs

Endless rotary encoders, like a scope's: every detent is one step. Drag up or right to turn clockwise, scroll, or use the arrow keys when focused.

## Layout

Two separators can be dragged: between the display and the setup tabs, and between the display and its controls. The sizes belong to the viewer (kept in their browser), never change when a tab changes, and double-clicking a separator resets it. The setup area starts at the height the Input tab needs, so nothing scrolls; the tab strip never scrolls.

## Keyboard

`R` run/stop, `S` single, `A` auto scale, `Esc` release the selected line. Ctrl+Z / Ctrl+Shift+Z undo and redo. Digits belong to the numeric entry of the active tab.
