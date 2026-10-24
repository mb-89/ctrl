# The instrument

Reader: whoever changes the display or its controls. Reference: [the Keysight panel the person shared](../input/images/2026-10-24-oscilloscope-keysight-dsox4104g.png).

**The page is an oscilloscope.** The trace display is always the main thing on screen; its controls sit to its right, grouped as on a bench scope: Run Control, Horizontal, Vertical. Setup happens in tabs below ([tabs.md](tabs.md)). It looks like a scope; where a scope's behaviour can be improved (direct manipulation, typed values, axis labels), it is.

## The screen is the record

What the screen shows is what is simulated and swept: from t = 0 to the right edge (horizontal position + 10 divisions). There is no separate record length. The sweep crosses the screen in real time: at 100 ms/div it takes 1 s. While it sweeps, the current run is drawn only up to the scan line: what has happened so far. **Earlier runs stay, whole and fading**: the last run at 40 % strength, then 30, 20, 10, and gone after five runs, for every channel. So after an edit the old run shows what lies ahead and the new one can be compared with it. (The person, 2026-10-24.) Loading a project clears them. Stopped, the screen shows the whole last sweep.

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
| Spectrogram, on the levels strip | Drag a handle or the band between them; wheel: floor, Shift + wheel: ceiling; double-click: automatic levels |

Wheel and knob zooms step 1-2-5; a box zoom shows exactly the marked region.

## Channels (Vertical)

Four channels, in the classic colours: 1 yellow, 2 green, 3 blue, 4 magenta. Each has a source, an on/off state, a scale (units per division) and an offset.

- **A channel's source is any Source or Sink in the plant diagram** (at any depth), picked under Vertical › Source, and nothing else: the list holds only names the person made in the diagram, each with its unit. Once a controller exists, its signals join. (The person, 2026-10-24.)
- **Every signal has a unit**, set on its Source or Sink (default `1`, unitless); badges, readouts and the source list show it.
- **Channel 1 shows r; channels 2–4 start with no source ("none").** Nothing the person adds is put on the scope by itself. (The person, 2026-10-24.) Picking a source switches the channel on; "none" switches it off. A closed-loop system from the library starts with r, y, u, e.
- A channel whose source has no data shows "no signal" and draws nothing.

- A channel key selects that channel for the Vertical knobs; pressing the selected channel's key again turns it off; pressing an off channel turns it on and selects it.
- **Scale** knob: 1-2-5 steps. **Position** knob: 0.1 division per detent; double-click (the knob's push) sets it to 0.

## Display modes: Time, FFT, Spectrogram, XY (the person, 2026-10-24)

Four keys under Run Control switch what the screen shows; the setting is part of the project (`scope.view`, [project-format.md](project-format.md)).

- **Time**: the default, as above.
- **FFT**: the amplitude spectrum (single-sided, Hann window, amplitude-correct: a sine of amplitude A reads A) of every shown channel, from what has run so far, so it fills in while the sweep runs. 10 dB per division against a reference level rounded up from the run's largest peak; the Nyquist frequency (half the scope's sampling rate) is marked; the selected channel's peaks are labelled; its display filter is drawn as a dashed response curve. Wheel, drag and Shift-drag act on the frequency axis.
- **Spectrogram**: the selected channel's short-time spectrum over the screen's time (frequency up the left axis, a heat map) with the channel's own time trace drawn over it against a **second axis at the right**. The wheel over the plot zooms frequency; over the time axis, time. Hovering reads t, f and the amplitude there (in the channel's unit and in dB). In the encoder example the error orders rise as straight lines from the origin, and the 6× line folds back at the Nyquist frequency (aliasing).
- **Spectrogram levels** (the person, 2026-10-24: "a histogram of the amplitudes where you can select the cutoff … see how PyQt graph does it"). A strip at the right edge of the screen, right of the second axis, after pyqtgraph's HistogramLUTItem: a **histogram of the amplitudes shown** beside the **colour bar**, both on one dB scale (dB of the channel's unit: 0 dB is 1 unit, as on the FFT's axis). The histogram counts every frame and frequency row on the screen, from the whole run, so it does not change while the sweep fills in; its bars grow from the colour bar to the left, linear in the count, so the noise is the big hump and the lines the thin tail above it. Two handles set the **floor** (below it a bin is black) and the **ceiling** (above it a bin has the brightest colour); in between the colour follows the dB value. The handles carry their level in dB; the status line shows both, the ceiling also in the channel's unit, and *auto* or *levels set*.
  - **Gestures**: drag a handle, or the band between them (both move); a press above or below the band takes the nearer handle to the pointer. The wheel over the strip moves the floor (2 dB a step), Shift + wheel the ceiling. Double-click: automatic levels again. Hovering the strip reads the level under the pointer (dB and the channel's unit) and the share of the shown bins above it. Every change is undoable.
  - **Automatic levels** (the default): the ceiling at the largest amplitude shown; the floor 10 dB above the median of the shown bins. Most bins of a spectrogram are noise, so their median is the noise's level; a bin of white noise lies 10 dB above its median 0.1 % of the time (its amplitude is Rayleigh distributed: 6.3 dB above the median at the 95th percentile, 10 dB at the 99.9th), so the noise turns black and whatever stands 10 dB above it stays. The floor stays between 20 and 80 dB below the ceiling: 80 dB was the scope's fixed depth before, and 20 dB keeps a picture of noise alone showing its noise rather than a few specks. Zooming the frequency recomputes them for what is shown.
  - **Checked on *Encoder errors and torque ripple*** (`test/spectrum.test.mjs`): 7670 bins on the screen (118 frames × 65 rows), median −42 dB, so the floor is at −32 dB and the ceiling at 20 dB (9.7 rad/s). The 1× and 2× lines and the 70 Hz resonance are above the floor on every frame, the 6× line up to 100 Hz; 36 % of the bins are above the floor, against 71 % with the old 80 dB range, and the speckle between the lines is gone. The noise here is coloured (about −20 dB at the lowest frequencies, −85 dB near 200 Hz), so no single floor removes it and keeps the 6× line above 100 Hz, which is weaker than the low-frequency noise: dragging the floor down to about −60 dB shows the 6× line folding back at the Nyquist frequency, and the 3× and 4× orders. The example's notes say so.
  - The levels belong to the scope view (`scope.view.levels`, [project-format.md](project-format.md)): set by hand, they stay when the channel or the display mode changes, and are saved with the project. They apply while the sweep runs and when stopped.
  - **The FFT view is unchanged** (interpretation): there an amplitude is a height, not a colour, so noise does not hide a line; and an FFT bin's noise level depends on the record length (an amplitude spectrum, not a density), so the spectrogram's dB levels would not line up with it.
- **XY**: channel 1 drives the beam across at its own scale, the other shown channels draw against it, as on a bench scope; the beam draws the samples inside the timebase window, so moving the window past the start-up leaves the settled figure. The **Δ** key (shown in XY) makes every channel in channel 1's unit draw channel 1 minus itself: with r on 1 and y on 2 that is the error e = r − y over r, the person's plot ("ideally a line, usually an ellipse"): perfect following is a flat line, a gain error tilts it, a lag opens it into an ellipse. Each figure reads out its best line Y ≈ a·X + b and its spread σ around it (σ ≈ 0: a line). Wheel, drag and Shift-drag on the screen act on the Y channels, below it on channel 1. Auto Scale fits the Δ figure. It sits on the display rather than the Analysis tab because it needs no linear model and works for any plant (research: [analysis.md](../research/analysis.md) §6). Example: *Following a sine (XY)*.
- **Display filters**: each channel can have one (Vertical › Filter: low-pass or high-pass Butterworth of order 2–8, band-pass, notch), applied live in every mode: the scope shows and analyses the filtered signal; the system is not changed. The wheel over its frequency sweeps it. Implemented in `src/core/spectrum.js` (second-order sections, bilinear transform with prewarping).
- **R axis**: one channel can have its values on a second axis at the right of the screen (Vertical › R axis); the left axis then shows another channel.

Code: `src/ui/freqview.js` (drawing, caching of filtered signals and spectra, the levels strip), `src/ui/xyview.js` (XY), hooks in `src/ui/display.js` (layout, the strip's gestures); the levels' arithmetic (histogram, automatic levels, the strip's dB range) in `src/core/spectrum.js`.

## Horizontal

- **Scale** knob: seconds per division, 1-2-5 steps. **Position** knob: the time at the left edge; double-click sets it to 0.

## Readouts

Every knob has a readout below it. Click it to type a value: `20m`, `100 ms`, `2u`, `-0.4`. Typed values need not be 1-2-5.

## Run Control

- **Run/Stop**: lit green while running, red while stopped. Stop freezes the sweep, not the data: edits still show at once.
- **Single**: one sweep from the start of the screen (t = 0 at position 0), then stop; lit amber meanwhile. The plant's view replays it (the pendulum drops again).
- **A project or system may say how it opens** (`ui`: run state, tab, view, setup height); the System library's systems open running on their view in the Plant tab, except the badly tuned oven, which opens on the Auto-tune tab ([project-format.md](project-format.md)).
- **Auto Scale**: the timebase shows one period of the input (the smallest 1-2-5 step whose 10 divisions hold the period, position 0); each channel with a signal is scaled to about 6 divisions and centred on a whole division. The channels showing a Controller block's r and the y it compares with r share one scale and offset (if they have one unit), so the reference and the output that follows it overlay (r and T of the oven); nothing else is grouped, and XY mode is left alone ([autotune.md](autotune.md)).

## Knobs

Endless rotary encoders, like a scope's: every detent is one step. Drag up or right to turn clockwise, scroll, or use the arrow keys when focused.

## Layout

Two separators can be dragged: between the display and the setup tabs, and between the display and its controls. The sizes belong to the viewer (kept in their browser), never change when a tab changes, and double-clicking a separator resets it. The setup area starts at the height the Input tab needs, so nothing scrolls; the tab strip never scrolls.

## Keyboard

`R` run/stop, `S` single, `A` auto scale, `Esc` release the selected line. Ctrl+Z / Ctrl+Shift+Z undo and redo. Digits belong to the numeric entry of the active tab.
