# The design system

Reader: whoever styles anything in Loop Tuner, or adds a control to it.

The person ([input 10](../input/2026-10-24-10-sliding-mode-and-triple-swingup.md)): "every button looks different … See that you put everything through a single master style sheet. There's no need for 5 different types of buttons. Pick one. And this goes, that goes for all the design elements … the styles are supposed to be semantic. And then we choose a semantic style and we change it in one place." Before this, the page had about 19 button looks and 12 ways of showing "selected" (the audit, summarised in [decisions.md](decisions.md), v2.7).

**The rule: a look belongs to a meaning.** Every colour, size and radius is a token, every look is a component, and both live in one place: [src/ui/style.css](../../src/ui/style.css), tokens at the top, components below them, then layout, which only places components. To change how something looks, change its token or its component. A new meaning gets a token or a component variant there; a module never gets a one-off style, and no colour is written anywhere else. `test/design-system.test.mjs` holds the page to it: no colour outside the token block, none in a UI module (canvases read the tokens, below), none of the old one-off classes.

## Tokens

Theme colours are `light-dark()` pairs. The colour scheme in effect picks one: the system's, or `data-theme="light"` or `"dark"` on `<html>`. The instrument's dark parts set `color-scheme: dark` (`.on-dark` on the bezel's lines, `.lcd` on readout panels), so a component inside them takes its dark values by itself: a key in the bezel is a dark key in both themes, a field in an LCD panel a dark field. Popovers, dialogs and toasts set the page's scheme back (`--page-scheme`). `light-dark()` needs a browser from 2024 on (Chrome 123, Safari 17.5, Firefox 120).

| Group | Tokens | Meaning |
|---|---|---|
| Surfaces | `--surface` (the page), `--surface-2` (panels: controls, tab panel, popovers, dialogs), `--surface-sunken` (code), `--field` (text entry), `--hover` | Where things sit |
| Instrument | `--bezel` (the display's frame), `--screen` (the scope's screen and every plot), `--lcd` (readouts and readout panels), `--rim` | Dark in both themes (the screen and the LCD the same in both; the bezel a little darker in dark) |
| Ink | `--ink` (text), `--ink-2` (secondary: field labels, notes), `--ink-3` (muted: group labels, hints, units), `--ink-on-lit` (text on a lit key, a lamp, a filled badge) | Text, by importance |
| Lines | `--line`, `--line-strong` | Borders and dividers |
| Keys | `--key-top`, `--key-bot`, `--key-hover`, `--key-ink`, `--key-edge`, `--key-glint` | The one button |
| Selection | `--accent` (the lamp of a selection), `--accent-ink` (the accent as text or a stroke: a primary action, a selected block or wire), `--glint`, `--focus` (the keyboard ring: the ink of the surface it is on), `--disabled` | What is chosen, where to act, where the keyboard is |
| Status | `--ok`, `--warn`, `--bad` (as text on a surface); `--lamp-ok`, `--lamp-warn`, `--lamp-bad` (fills: the same in both themes) | Running, waiting, stopped or wrong. Always with a word or a symbol (✓ ! ✕, "Live", "E-STOP"), never colour alone |
| Channels | `--ch-1` … `--ch-4`: yellow, green, blue, magenta | The scope's channels. Plots elsewhere (Analysis, Auto-tune's cost) take their series colours in this order: the open loop L first, the closed loop second, poles and margins fourth |
| Screen | `--screen-ink`, `--screen-label`, `--screen-line`, `--screen-mark` | Text, labels, grid and markers drawn on the dark screen |
| Diagram | `--source`, `--source-line`, `--sink`, `--sink-line` | Blocks that play a signal and blocks that record one |
| Tags | `--tone-blue` … `--tone-red`, `--ink-on-tone` | The System library's tag tones (a palette checked for colour-vision deficiency on each theme) |
| Knob | `--knob-skirt`, `--knob-knurl`, `--knob-cap`, `--knob-cap-line`, `--knob-dot` | The knurled knobs |
| Type | `--font-ui` (IBM Plex Sans Condensed), `--font-mono` (IBM Plex Mono); `--text-2xs` 10, `--text-xs` 11, `--text-sm` 12, `--text-md` 13, `--text-base` 14, `--text-lg` 18 px | Six sizes (there were 13) |
| Space | `--space-1` … `--space-6`: 2, 4, 6, 8, 12, 16 px | Gaps and padding |
| Radii | `--radius-sm` 4 (chips, badges, the screen, rows), `--radius` 6 (keys, fields), `--radius-lg` 10 (panels, cards, popovers, dialogs), `--radius-pill` | Three, and the pill (there were eleven) |
| Sizes | `--h-sm` 24, `--h-md` 30, `--h-lg` 34 px | A small key or field, a key or field, the project title |

The two typefaces are in the page (Latin subsets, 400 and 600, as data), so the page loads nothing (`test/standalone.test.mjs`). They are under the SIL Open Font License 1.1: the licence is in `src/ui/fonts/OFL.txt`, named on the fonts' style element (`data-license`) and in Help › Credits.

## Components

### Button: the instrument's key

One look for every button in the page: a rubber key with a drop, `.btn`. Variants by meaning only:

| Variant | Class | Use |
|---|---|---|
| Default | `.btn` | Any action |
| Primary | `.btn-primary` | The action a column or dialog is for: Add/Apply, Start, Load, Save, Download hil-plant.zip, Open in the Controller tab, Group into subsystem. Outlined in the accent ink |
| Danger | `.btn-danger` | It stops or removes: E-STOP, Delete, a component's ✕, Auto-tune's Stop. Outlined in `--bad` |

Size: `.btn-sm` (24 px) or regular (30 px). Layout only, no look of their own: `.btn-icon` (square), `.btn-block` (full width, left-aligned), `.btn-col` (lines stacked: a waveform key, a method, a controller in the library), `.btn-note` (a key's second, quieter text: a formula, a description). States: hover (lighter top), pressed (moves down), disabled (`--disabled`), focus (the ring), **lit**.

### Lit: the one selected look

**A key, tab or row that is on or chosen is lit**: its lamp is on, it fills with the lamp's colour (`--lit`), with dark ink and a glow. It comes from the element's state, never a class: `aria-pressed="true"`, `aria-selected="true"` or `aria-checked="true"` (or a lamp, below). It is the same everywhere: the generator's r and d keys, the waveform being drafted, the parameter being typed into, the component being edited, the display mode and Δ, R axis, Measure, the spectrogram's Colour and Auto, the Analysis operating point and s/z, the block choosers, the Auto-tune method and cost, the running variant (with ▶), the open tab, the plant's Diagram or view, the speed preset in effect, a component's on/off (which also says *on* or *off*).

The lamp's colour says what kind of on it is:

| `--lit` | Where |
|---|---|
| `--accent` (violet) | A selection, everywhere: no channel and no status uses this hue |
| `--cc`, the channel's colour | A channel's key (`.btn-ch`) while the channel is on |
| `data-lamp="ok"` (green) | Run/Stop while running; Connect while the live plant runs; the RUN badge |
| `data-lamp="bad"` (red) | Run/Stop while stopped; E-STOP while latched; the STOP and E-STOP badges |
| `data-lamp="warn"` (amber) | Single while it sweeps; Connect while connected and waiting |

**Current** (`aria-current="true"` on a key): the one the knobs act on, the selected channel, on or off: a bar under the key's label (in the bezel's channel keys too). It is not the focus ring.

### Segmented

`.seg`: one choice among keys, joined into one row (`.seg-fill` stretches them). The same keys, the same lit look: the display mode, Colour, the operating point, s/z, the cost, Diagram | views. A field and its key join the same way (Speed and its ▾).

### Tab

`.btn.tab` in the tab strip (`role="tab"`): a key, lit while its tab is open; `.tab-num` its number, a neutral badge for a tab that comes later.

### Field

`.field` for every input, select and text area; `.field-sm`, `.field-lg` (the project title). `.field-inline`: a value edited in place, read as text until hovered or focused (the project title, the plant's address). `.readout`: an instrument readout you type into (under each knob), the LCD in both themes. `aria-invalid="true"`: the entry cannot be taken (a formula that does not parse). Values and formulas use `.mono`.

### ListRow

`.item`: a row of a list, full width, flat. Selectable rows light up exactly as keys do (`aria-selected`, `aria-pressed`, `aria-checked`): the variant list (a list box: click, Enter or Space runs one, the arrows move, F2 renames), the generator's parameters and components, the speed presets. Rows are reachable by keyboard.

### Chip, Tag, Badge

- `.chip`: a small name or value in a box: a port (`1 r`), a signal's symbol on its key.
- `.tag`: a System library tag. Its style says what it is about (plant: filled; controller: a bar; observer: an outline; feature: a dot; none: dashed), its tone which value it is (decisions.md, v2.7: style by what a tag is about, tone by value). A tag that filters is a button: pressed, it gets the accent's ring and a ✓, and keeps its own colours.
- `.badge`: a state in a word, small capitals. Neutral (outlined): SPECTROGRAM, an XY note, a tab's *later*. With a lamp (`data-lamp`): filled (RUN, STOP, SINGLE, E-STOP), or `.badge-outline` in the lamp's colour (LIVE, CONNECTED, OFFLINE neutral).

### Panel, Card, LCD, Bezel

`.panel` (a raised area: the controls, the tab panel), `.card` (a thing on a panel: the controller's diagram, which opens larger), `.lcd` (a readout panel: the generator's parameters and signal, the variants, Auto-tune's rows; dark in both themes), `.bezel` (the instrument's frame: the display, the Analysis plots). `.list` lays out a list.

### Popover, Dialog, Toast, Tooltip

`.popover` (System library), `.popover.menu` (Speed's presets, Save ▾; `.popover-up` opens upwards); a popover just opened is kept inside the window (`fitPopover`). `.overlay` and `.dialog` (Help, the plant script, the controller's diagram enlarged, `.dialog-wide`). `.toast` and `.tip` (the levels strip's readout): messages, dark in both themes.

### Text: Heading and Label

`.label` (a column's name: small capitals, muted), `.heading` and `.heading-lg` (a thing's name, a title), `.flabel` (a field's label), `.note` (secondary prose), `.hint` (small muted text: a hint, a unit, a count), `.muted` (the muted colour inline), `.mono` (values, formulas), `.text-ok` / `.text-warn` / `.text-bad` (status as text, with its word or mark), `kbd`, `code`.

### Canvases

The screen, the plots, the levels strip and the saved picture are drawn, not styled: they read the tokens once through [src/ui/palette.js](../../src/ui/palette.js), which names how strongly each is drawn (grid, axis, label, cursor, veil …) and holds the one colour table that is data, the spectrogram's colour map. A colour on a canvas is changed in its token, like any other.

## How to add something

1. Find the meaning in the tables above. A new key is a `.btn` with a variant by meaning; something selectable sets `aria-pressed`, `aria-selected` or `aria-checked` and is lit by itself; a status shows a word with a lamp.
2. If the meaning is new, add it here and in `style.css` once: a token (and its dark value), or a component variant. Then use it.
3. Never: a colour literal outside the token block, a colour in a module, a class that only one place uses for its look, opacity to mean anything but disabled.

## Where the old looks went

| Before | Now |
|---|---|
| `.btn` (header), `.key` and its sizes, `.wkey`, `.pk`, `.key.arrow`, `.key.ch`, `.sigkey`, `.tumethod`, `.ctlibitem`, `.litem`, `.rkey`, `.speed-btn`, `.lv-link`, `.crumb`, `.sw`, `.x`, the channel `.badge` | `.btn` (with `-sm`, `-icon`, `-block`, `-col`, `-ch`, `-primary`, `-danger`) |
| `.rep`/`.reps`, the view-key row, `.an-op`, `.an-tg`, `.lvmode` | `.seg` of `.btn` |
| `.tab` | `.btn.tab` |
| `.lit`, `.lit-view`, `.on`, `.sel`, `.active`, `.editing`, `.sigkey.on`, `.rep.on`, `.sw.on`, the checked checkbox | lit, from `aria-pressed` / `aria-selected` / `aria-checked` |
| `.lit-green`, `.lit-red`, `.lit-amber` | `data-lamp="ok" / "bad" / "warn"` |
| `.st`, `.st-*`, `.soon` | `.badge` (with `data-lamp`, `.badge-outline`) |
| `.dval`, `.fnin`, `.rc-len`, `.lv-url`, `.speed-in`, `.title`, `.canvas-rename`, `.pfi`, `.vjson` | `.field` (with `-sm`, `-lg`, `-inline`, `.readout`) |
| `.pfield`, `.srow`, `.vrow`, `.speed-item` | `.item` |
| `.sigsym`, `.ctport` | `.chip` |
| `.glabel`, `.lgname`, `.rc-label`, dialog `h3`; `.pophead`, `.sysname`, `.ctname`; `.dlabel`, `.pfl`, `.speed-label`; `.phelp`, `.sysnote`, `.tustatus`; `.pfh`, `.sighint`, `.lempty`, `.rc-note`; `.dim` | `.label`; `.heading`; `.flabel`; `.note`; `.hint`; `.muted` |
| `.grade-*`, `.tucost`, `.tuworse`, `.tuwhy`, `.lv-stats .ok/.bad`, `.pmsg` | `.text-ok`, `.text-warn`, `.text-bad` |
| `.plist`, `.slist`, `.lenrow`, `.turows` (their LCD look) | `.lcd` |
| `.rc-pop`, `.speed-pop`, `.ctdiag-big`, `.striptip`, `.later-box` | `.popover.menu`, `.overlay` + `.dialog`, `.tip`, `.notice` |
