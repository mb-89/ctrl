# The design system

Reader: whoever styles anything in Loop Tuner, or adds a control to it.

The person ([input 10](../input/2026-10-24-10-sliding-mode-and-triple-swingup.md)): "every button looks different … See that you put everything through a single master style sheet. There's no need for 5 different types of buttons. Pick one. And this goes, that goes for all the design elements … the styles are supposed to be semantic. And then we choose a semantic style and we change it in one place." Before this, the page had about 19 button looks and 12 ways of showing "selected" (the audit, summarised in [decisions.md](decisions.md), v2.7).

**The rule: a look belongs to a meaning.** Every colour, size and radius is a token, every look is a component, and both live in one place: [src/ui/style.css](../../src/ui/style.css), tokens at the top, components below them, then layout, which only places components. To change how something looks, change its token or its component. A new meaning gets a token or a component variant there; a module never gets a one-off style, and no colour is written anywhere else. `test/design-system.test.mjs` holds the page to it: no colour outside the token block, and none in a UI module or the page's shell (`build.mjs`): no hex, colour function, `color-mix()` or colour name (canvases read the tokens, below); every type size a token; no opacity but `--disabled` (and 0 or 1 to show and hide); no canvas strength outside `palette.js`; none of the old one-off classes; one lit look for keys and rows.

## Tokens

Theme colours are `light-dark()` pairs. The colour scheme in effect picks one: the system's, or `data-theme="light"` or `"dark"` on `<html>`. The instrument's dark parts set `color-scheme: dark` (`.on-dark` on the bezel's lines, `.lcd` on readout panels), so a component inside them takes its dark values by itself: a key in the bezel is a dark key in both themes, a field in an LCD panel a dark field. Popovers and dialogs set the page's scheme back (`--page-scheme`); toasts and tooltips stay dark in both themes, as the screen does. `light-dark()` needs a browser from 2024 on (Chrome 123, Safari 17.5, Firefox 120).

| Group | Tokens | Meaning |
|---|---|---|
| Surfaces | `--surface` (the page), `--surface-2` (panels: controls, tab panel, popovers, dialogs), `--surface-sunken` (code), `--field` (text entry), `--hover` | Where things sit |
| Instrument | `--bezel` (the display's frame), `--screen` (the scope's screen and every plot), `--lcd` (readouts and readout panels), `--rim` | Dark in both themes (the screen and the LCD the same in both; the bezel a little darker in dark) |
| Ink | `--ink` (text), `--ink-2` (secondary: field labels, notes), `--ink-3` (muted: group labels, hints, units), `--ink-on-lit` (text on a lit key, a lamp, a filled badge) | Text, by importance |
| Lines | `--line`, `--line-strong` | Borders and dividers |
| Keys | `--key-top`, `--key-bot`, `--key-hover`, `--key-ink`, `--key-edge`, `--key-glint` | The one button |
| Selection | `--accent` (the lamp of a selection), `--accent-ink` (the selection as a stroke or a ring: a selected block or wire, a pressed tag filter), `--glint`, `--focus` (the keyboard ring: the ink of the surface it is on; on a lit row, `--ink-on-lit`), `--disabled` (the one opacity: unavailable, or a diagram's part that is 0 or off) | What is chosen, where the keyboard is, what is not available. **Violet means selected and nothing else**: no tag tone, primary key or drop target uses it |
| Status | `--ok`, `--warn`, `--bad` (as text on a surface); `--lamp-ok`, `--lamp-warn`, `--lamp-bad` (fills: the same in both themes) | Running, waiting, stopped or wrong. Always with a word or a symbol (✓ ! ✕, "Live", "E-STOP"), never colour alone |
| Channels | `--ch-1` … `--ch-4`: yellow, green, blue, magenta | The scope's channels. Plots elsewhere (Analysis, Auto-tune's cost) take their series colours in this order: the open loop L first, the closed loop second, poles and margins fourth |
| Screen | `--screen-ink`, `--screen-label`, `--screen-line`, `--screen-mark` | Text, labels, grid and markers drawn on the dark screen |
| Diagram | `--source`, `--source-line`, `--sink`, `--sink-line` | Blocks that play a signal and blocks that record one |
| Tags | `--tone-blue`, `-orange`, `-aqua`, `-yellow`, `-magenta`, `-green`, `-slate`, `-red`, each with its `-ink` (white, `--ink-on-tone`, or the lit ink, whichever reads at 4.5:1 or more on it as a fill) | The System library's tag tones (a palette checked for colour-vision deficiency on each theme). Slate took violet's place, which is the selection's |
| Axes | `--axis-x`, `--axis-y`, `--axis-z` (red, green, blue) | The axes of 3D views: triads, the gizmo |
| Parts | `--part` (a body), `--part-dark` (bases, motors, flanges), `--part-accent` (a tool, a part that stands out), `--part-line` (outlines) | The parts of 3D views, cel shaded: each colour is the lit band (below, Canvases) |
| Knob | `--knob-skirt`, `--knob-knurl`, `--knob-cap`, `--knob-cap-line`, `--knob-dot` | The knurled knobs |
| Type | `--font-ui` (IBM Plex Sans Condensed), `--font-mono` (IBM Plex Mono); `--text-2xs` 10, `--text-xs` 11, `--text-sm` 12, `--text-md` 13, `--text-base` 14, `--text-lg` 18 px | Six sizes (there were 13) |
| Space | `--space-1` … `--space-8`: 2, 4, 6, 8, 10, 12, 14, 16 px | Gaps, padding and margins; nothing else is written (a hairline of 1 px aside) |
| Radii | `--radius-sm` 4 (chips, badges, the screen), `--radius` 6 (keys, fields, list rows), `--radius-lg` 10 (panels, cards, popovers, dialogs), `--radius-pill` | Three, and the pill (there were eleven) |
| Sizes | `--h-sm` 24, `--h-md` 30, `--h-lg` 34 px | A small key or field, a key or field, the project title |

The two typefaces are in the page (Latin subsets, 400 and 600, as data), so the page loads nothing (`test/standalone.test.mjs`). They are under the SIL Open Font License 1.1: the licence is in `src/ui/fonts/OFL.txt`, named on the fonts' style element (`data-license`) and in Help › Credits.

## Components

### Button: the instrument's key

One look for every button in the page: a rubber key with a drop, `.btn`. Variants by meaning only:

| Variant | Class | Use |
|---|---|---|
| Default | `.btn` | Any action |
| Danger | `.btn-danger` | It stops or removes: E-STOP, Delete, a component's ✕, Auto-tune's Stop. Outlined in `--bad`. The E-STOP alone is also filled red (`.btn-estop`, `--lamp-bad`) at all times, so it is found at a glance (the person: "Make it red"); latched, it is lit as well |

**There is no primary key** (decisions.md, v2.7 after review): the action a column is for (Add, Start, Load, Download hil-plant.zip) is a default key; its words and its place say what it is for. An outline in the accent made it look half-selected beside lit keys.

Size: `.btn-sm` (24 px) or regular (30 px). Layout only, no look of their own: `.btn-icon` (square), `.btn-block` (full width, left-aligned), `.btn-col` (lines stacked: a waveform key, a method, a controller in the library; its note wraps), `.btn-note` (a key's second, quieter text: a formula, a description, a channel's scale). States: hover (lighter top), pressed (moves down), disabled (`:disabled`, or `aria-disabled="true"` for one that stays reachable to say why, such as Speed held at 1×: both faded by `--disabled`), focus (the ring), **lit**.

### Lit: the one selected look

**A key, tab or row that is on or chosen is lit**: its lamp is on, it fills with the lamp's colour (`--lit`), with dark ink at weight 600, its drop and a glow. A lit row is a lit key: the same radius, weight, drop and glow; a chip on a lit key takes the key's ink. It comes from the element's state, never a class: `aria-pressed="true"`, `aria-selected="true"` or `aria-checked="true"` (or a lamp, below). It is the same everywhere: the generator's r and d keys, the waveform being drafted, the parameter being typed into, the component being edited, the display mode and Δ, R axis, Measure, the spectrogram's Colour and Auto, the Analysis operating point and s/z, the block choosers, the Auto-tune method and cost, the running variant (with ▶), the open tab, the plant's Diagram or view, the speed preset in effect, a component's on/off (which also says *on* or *off*).

The lamp's colour says what kind of on it is:

| `--lit` | Where |
|---|---|
| `--accent` (violet) | A selection, everywhere: no channel and no status uses this hue |
| `--cc`, the channel's colour | A channel's key (`.btn-ch`) while the channel is on: under Vertical and under the screen alike, the same key with the same press (the one under the screen also shows the source and its scale) |
| `data-lamp="ok"` (green) | Run/Stop while running; Connect while the live plant runs; the RUN badge |
| `data-lamp="bad"` (red) | Run/Stop while stopped; E-STOP while latched; the STOP and E-STOP badges |
| `data-lamp="warn"` (amber) | Single while it sweeps; Connect while connected and waiting |

**Current** (`aria-current="true"` on a key): the one the knobs act on, the selected channel, on or off: a bar under the key's number (`.num`), in both rows of channel keys. It is not the focus ring.

### Segmented

`.seg`: one choice among keys, joined into one row (`.seg-fill` stretches them). The same keys, the same lit look: the display mode, Colour, the operating point, s/z, the cost, Diagram | views. A field and its key join the same way (Speed and its ▾).

### Tab

`.btn.tab` in the tab strip (`role="tab"`): a key, lit while its tab is open; `.tab-num` its number, a neutral badge for a tab that comes later.

### Field

`.field` for every input, select and text area; `.field-sm`, `.field-lg` (the project title). `.field-inline`: a value edited in place, read as text until hovered or focused (the project title, the plant's address). `.readout`: an instrument readout you type into (under each knob), the LCD in both themes. `aria-invalid="true"`: the entry cannot be taken (a formula that does not parse). Values and formulas use `.mono`.

### ListRow

`.item`: a row of a list, full width, flat. Selectable rows light up exactly as keys do (`aria-selected`, `aria-pressed`, `aria-checked`): the variant list (a list box: click, Enter or Space runs one, the arrows move, F2 renames and Enter or Esc returns to the row), the generator's parameters and components, the speed presets. Rows are reachable by keyboard; the focus ring on a lit row is drawn in the lit ink.

**Key or row?** A *key* is one of a few choices shown at once, each a name: the signal r or d, a waveform, a mode, a block, a method, a tab. A *row* is an entry of a list or a menu: the list may grow and scroll, and an entry carries more than its name (a value, a unit, a type, keys of its own): the variants, the parameters, the components, the speed presets. Lit, both look the same.

### Chip, Tag, Badge

- `.chip`: a small name or value in a box: a port (`1 r`), a signal's symbol on its key (on a lit key: no fill, its border and text in the key's ink).
- `.tag`: a System library tag. Its style says what it is about (plant: filled; controller: a bar; observer: an outline; feature: a dot; none: dashed), its tone which value it is (decisions.md, v2.7: style by what a tag is about, tone by value). A tag that filters is a button: pressed, it gets the accent's ring and a ✓, and keeps its own colours.
- `.banner`: a state in a sentence, across the page, that stays: ⚠ (`.banner-icon`), then the words (`.banner-text`); with a lamp, filled in its colour, as a lit badge is. The limited environment's warning (`data-lamp="warn"`).
- `.badge`: a state in a word, small capitals. Neutral (outlined): SPECTROGRAM, an XY note, a tab's *later*. With a lamp (`data-lamp`): filled (RUN, STOP, SINGLE, E-STOP), or `.badge-outline` in the lamp's colour (LIVE, CONNECTED, OFFLINE neutral).

### Progress

`.progress`: how far a long computation is (the planned swing-up's plan): a track, and its fill (`<span>`, its width the fraction) in the waiting lamp's colour (`--lamp-warn`); `role="progressbar"` carries the number, and a line beside it says what is happening in words.

### Panel, Card, LCD, Bezel

`.panel` (a raised area: the controls, the tab panel), `.card` (a thing on a panel: the controller's diagram, which opens larger), `.lcd` (a readout panel: the generator's parameters and signal, the variants, Auto-tune's rows; dark in both themes), `.bezel` (the instrument's frame: the display, the Analysis plots). `.list` lays out a list.

### Popover, Dialog, Toast, Tooltip

`.popover` (System library), `.popover.menu` (Speed's presets, Save ▾, the header's Export ▾ of `.item` rows, each a name and a hint; `.popover-up` opens upwards); a popover just opened is kept inside the window (`fitPopover`). `.overlay` and `.dialog` (Help, the plant script, the controller's diagram enlarged, `.dialog-wide`). `.toast` and `.tip` (the levels strip's readout): messages, dark in both themes. `.drop`: where a dropped file goes, dashed in the secondary ink.

### Text: Heading and Label

`.label` (a column's name: small capitals, muted), `.disclosure` (a `.label` that opens and closes its group: a chevron, then the name, `aria-expanded`; the Plant library's groups; also the `<summary>` of a native `<details class="more">`, details one click away, its chevron drawn from the open state: [tabs.md](tabs.md#progressive-disclosure)), `.heading` and `.heading-lg` (a thing's name, a title), `.flabel` (a field's label), `.note` (secondary prose), `.hint` (small muted text: a hint, a unit, a count), `.muted` (the muted colour inline), `.mono` (values, formulas), `.text-ok` / `.text-warn` / `.text-bad` (status as text, with its word or mark), `kbd`, `code`.

### Canvases

The screen, the plots, the levels strip and the saved picture are drawn, not styled: they read the tokens once through [src/ui/palette.js](../../src/ui/palette.js), which names how strongly each colour is drawn (grid, axis, label, cursor, veil …) and how strongly a whole line is (`alpha`: *unselected* while another line is selected, *past* for the earlier runs, *guide* for a line read against the data, *over* for data drawn over data), and holds the one colour table that is data, the spectrogram's colour map. A colour or a strength on a canvas is changed there, like any other.

**3D views are cel shaded** ([decisions.md](decisions.md), v2.8): a surface is drawn in three flat bands of one light (shadow, half, lit), never a gradient, with outlines in `--part-line` on its silhouette and hard edges; a part's token is its lit band, the others are drawn darker from it. A URDF colour only picks the part's role (a saturated colour: accent; else light or dark). No textures and no assets: the light's ramp is four bytes made in code. Lines in 3D (the floor grid, paths, triads, joint axes) are flat colours; a trail fades in three steps. WebGL and the Canvas fallback draw the same bands and outlines (`src/ui/view3d.js`).

The controller's structure diagram is SVG styled by `.cdg`: its text is `--text-2xs` (notes too: the sheet is 276 units wide so they fit), and a part that is 0 or off is drawn as disabled (`--disabled`).

## How to add something

1. Find the meaning in the tables above. A new key is a `.btn` with a variant by meaning; something selectable sets `aria-pressed`, `aria-selected` or `aria-checked` and is lit by itself; a status shows a word with a lamp.
2. If the meaning is new, add it here and in `style.css` once: a token (and its dark value), or a component variant. Then use it.
3. Never: a colour literal outside the token block, a colour in a module, a type size, space or radius off the scale, a class that only one place uses for its look, opacity to mean anything but disabled, violet for anything but a selection.

## Where the old looks went

| Before | Now |
|---|---|
| `.btn` (header), `.key` and its sizes, `.wkey`, `.pk`, `.key.arrow`, `.key.ch`, `.sigkey`, `.tumethod`, `.ctlibitem`, `.litem`, `.rkey`, `.speed-btn`, `.lv-link`, `.crumb`, `.sw`, `.x`, the channel `.badge` | `.btn` (with `-sm`, `-icon`, `-block`, `-col`, `-ch`, `-danger`) |
| `.btn-primary` (after review) | a default `.btn` |
| The channel bar's filled or hollow number (`.chbtn .num`, `.chbtn.off`) (after review) | `.btn-ch`, lit from `aria-pressed`, as under Vertical |
| `.keypad .fn` (smaller Del, Cancel, Enter), `.pfield .pu`'s opacity, `.cdg .f`'s opacity 0.3, the diagram's 9 px notes (after review) | the keypad's keys alike; `.muted`; `--disabled`; `--text-2xs` |
| The limited environment's own colours and sizes (`.limited`, from main) | `.banner` with `data-lamp="warn"`; `.limited` only places it |
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
| `.rc-pop`, `.speed-pop`, `.ctdiag-big`, `.striptip`, `.later-box` | `.popover.menu`, `.overlay` + `.dialog`, `.tip`, `.notice` (`.speed-pop`, `.ctdiag-big` and `.tustatus` stay as layout hooks only: where it sits and how wide, no look) |
