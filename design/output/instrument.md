# The instrument

Reader: whoever changes the display or its controls. Reference: [the Keysight panel the person shared](../input/images/2026-10-24-oscilloscope-keysight-dsox4104g.png).

**The page is an oscilloscope.** The trace display is always the main thing on screen; its controls sit to its right, grouped as on a bench scope: Run Control, Horizontal, Vertical. Setup happens in tabs below ([tabs.md](tabs.md)). It looks like a scope; where a scope's behaviour can be improved (direct manipulation, typed values, axis labels), it is.

## The screen is the record

What the screen shows is what is simulated and swept: from t = 0 to the right edge (horizontal position + 10 divisions). A simulation has no separate record length: **Save ▾** stores what the screen holds, every signal (below); only live data, which never repeats, also has a record of its own, the last minutes ([Save, the live record and references](#save-the-live-record-and-references)). The sweep crosses the screen in real time: at 100 ms/div it takes 1 s. While it sweeps, the current run is drawn only up to the scan line: what has happened so far. **Earlier runs stay, whole and fading**: the last run at 40 % strength, then 30, 20, 10, and gone after five runs, for every channel. So after an edit the old run shows what lies ahead and the new one can be compared with it. (The person, 2026-10-24.) Loading a project clears them. Stopped, the screen shows the whole last sweep.

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
- **Spectrogram**: the selected channel's short-time spectrum over the screen's time (frequency up the left axis, a heat map 80 dB deep) with the channel's own time trace drawn over it against a **second axis at the right**. The wheel over the plot zooms frequency; over the time axis, time. In the encoder example the error orders rise as straight lines from the origin, and the 6× line folds back at the Nyquist frequency (aliasing).
- **XY**: channel 1 drives the beam across at its own scale, the other shown channels draw against it, as on a bench scope; the beam draws the samples inside the timebase window, so moving the window past the start-up leaves the settled figure. The **Δ** key (shown in XY) makes every channel in channel 1's unit draw channel 1 minus itself: with r on 1 and y on 2 that is the error e = r − y over r, the person's plot ("ideally a line, usually an ellipse"): perfect following is a flat line, a gain error tilts it, a lag opens it into an ellipse. Each figure reads out its best line Y ≈ a·X + b and its spread σ around it (σ ≈ 0: a line). Wheel, drag and Shift-drag on the screen act on the Y channels, below it on channel 1. Auto Scale fits the Δ figure. It sits on the display rather than the Analysis tab because it needs no linear model and works for any plant (research: [analysis.md](../research/analysis.md) §6). Example: *Following a sine (XY)*.
- **Display filters**: each channel can have one (Vertical › Filter: low-pass or high-pass Butterworth of order 2–8, band-pass, notch), applied live in every mode: the scope shows and analyses the filtered signal; the system is not changed. The wheel over its frequency sweeps it. Implemented in `src/core/spectrum.js` (second-order sections, bilinear transform with prewarping).
- **R axis**: one channel can have its values on a second axis at the right of the screen (Vertical › R axis); the left axis then shows another channel.

Code: `src/ui/freqview.js` (drawing, caching of filtered signals and spectra), `src/ui/xyview.js` (XY), hooks in `src/ui/display.js`.

## Horizontal

- **Scale** knob: seconds per division, 1-2-5 steps. **Position** knob: the time at the left edge; double-click sets it to 0.

## Readouts

Every knob has a readout below it. Click it to type a value: `20m`, `100 ms`, `2u`, `-0.4`. Typed values need not be 1-2-5.

## Run Control

- **Run/Stop**: lit green while running, red while stopped. Stop freezes the sweep, not the data: edits still show at once.
- **Single**: one sweep from the start of the screen (t = 0 at position 0), then stop; lit amber meanwhile. The plant's view replays it (the pendulum drops again). With a live plant, Run, Stop and Single go through the plant ([Live](#live-an-external-plant)).
- **A project or system may say how it opens** (`ui`: run state, tab, view, setup height); the System library's systems open running on their view in the Plant tab, except the badly tuned oven, which opens on the Auto-tune tab ([project-format.md](project-format.md)).
- **Auto Scale**: the timebase shows one period of the input (the smallest 1-2-5 step whose 10 divisions hold the period, position 0); each channel with a signal is scaled to about 6 divisions and centred on a whole division. The channels showing a Controller block's r and the y it compares with r share one scale and offset (if they have one unit), so the reference and the output that follows it overlay (r and T of the oven); nothing else is grouped, and XY mode is left alone ([autotune.md](autotune.md)).

## Live (an external plant)

A system with an External plant block runs against a plant outside the page ([hil.md](hil.md)). Run Control then has a second row of keys, **Connect / Disconnect**, **E-STOP**, **Reset**, and under it two lines that keep their height: where the plant listens and the state, an E-stop and its cause, or while running the link's rate, jitter and round trip. **Run and Stop go through the plant** (the person): Run starts a fresh run (the plant's clock and the controllers from 0), Stop stops it, Single runs one screen and stops. Live data sweeps the screen as a simulated run does: at position w0 a run's plant time w0 … w0 + W is drawn where the axis says, later screen widths sweep the same window again, and earlier sweeps fade. The status line says LIVE (with the plant's time), CONNECTED, E-STOP (with the reason) or OFFLINE.

## Save, the live record and references

Under the screen, beside the channel badges, like a scope's save keys. Storing traces is a general scope feature (the person: "if we set our oscilloscope to 50 seconds and we measure a 50 second thing … I want to be able to store that … either as a screenshot or as … data … if there are 20, then we store all 20").

- **Save ▾ › Screen**: what the scope acquired over the screen's window, **every signal** of the system (every Source and Sink, not only the four on channels): a simulated run, or the live sweep on the screen (its time is screen time; the file says the offset to plant time). **CSV** (`t [s]`, then every signal as `name [unit]`; a `#` line says what it is; a UTF-8 mark first, so spreadsheets read units such as N·m), **JSON** (`format`, `title`, `source`, `units`, `t`, `signals`), **PNG** (a picture of the screen as it is, with the title, the status line and the channels' scales), or **Copy** (CSV to the clipboard).
- **Rec** and **Save ▾ › Live record**: for a system with an External plant, the last *length* of every live signal (5 min unless set; click the length to type 30 s, 10 min, 1 h; kept per viewer). (The person: "if I set a trace to 5 minutes, I should be able to store that".) It runs across Run, Stop and reconnects on one real-time axis: each run's samples keep the plant's time, placed when the run started, with a gap while the plant was stopped. A Sink added while live gets a column of its own (empty before). It holds up to 2²⁴ numbers (128 MB) in all; the tooltip says how long that lasts at the current rate when it is less than the length. Simulated data is not recorded here: a simulation repeats the same run, which the Screen already holds whole. (Changed after review: the first version appended every simulated sweep into one long, misleading record.)
- Files leave through the page's one download path: a download link, or in the claude.ai viewer its download capability, which asks the viewer to confirm. Where neither works, the keys are **Copy CSV**. Long records are written in parts, never as one string.
- **Open…** reads a saved trace (CSV or JSON; any CSV whose first column is time) and draws it **dashed** on every channel showing a signal of the same name, until cleared (**ref ✕**). A trace with any part in the window is drawn at its own time (one saved from the same screen lines up exactly); one outside it, such as minute 5 of a live record, is folded in like a live sweep, its first sample at the left edge. **◀ ▶** move it by a screen width through a trace longer than the screen; the toast and tooltip say which part is shown. References never fade (earlier runs do); several can be open.
- For agents: `window.loopTuner.record` ([hil.md](hil.md#for-agents-through-the-browser)).

## Knobs

Endless rotary encoders, like a scope's: every detent is one step. Drag up or right to turn clockwise, scroll, or use the arrow keys when focused.

## Layout

Two separators can be dragged: between the display and the setup tabs, and between the display and its controls. The sizes belong to the viewer (kept in their browser), never change when a tab changes, and double-clicking a separator resets it. The setup area starts at the height the Input tab needs, so nothing scrolls; the tab strip never scrolls.

## Keyboard

`R` run/stop, `S` single, `A` auto scale, `Esc` release the selected line. Ctrl+Z / Ctrl+Shift+Z undo and redo. Digits belong to the numeric entry of the active tab.
