# Plant views

Reader: whoever writes or renders a plant's 2D (later 3D) representation.

**A plant has one editable representation, its block diagram, and any number of views that are configured in the plant's JSON, not drawn in an editor.** A view shows the plant moving: it follows the scope's time (the scan line while running, the cursor while hovering the plot, else the screen's right edge). The Plant tab's representation switch (Diagram | each view | + 2D) shows them; the right panel edits a view's JSON directly.

Where a standard exists, we use it (the person, 2026-10-24): SVG for 2D drawings, URDF for robots later.

## `"kind": "svg"`: a standard SVG drawing with bindings

Draw the scene in any vector editor, give the moving elements ids, then bind their attributes to formulas in t and the signal names (Sources and Sinks):

```json
{ "name": "Hanging mass (SVG)", "kind": "svg",
  "svg": "<svg viewBox=\"-160 -130 320 280\">…<rect id=\"mass\" …/>…</svg>",
  "bind": [
    { "select": "#mass", "attr": "y", "value": "{4000*y1}" },
    { "select": "#spring, #damper", "attr": "y2", "value": "{4000*y1}" },
    { "select": "#label", "attr": "text", "value": "x = {1000*y1} mm" } ] }
```

`select` is a CSS selector; `value` is text with `{formula}` parts; `attr` is any attribute, or `text` for an element's text. Before display the drawing loses scripts, event handlers and outside links, and bindings cannot target events or links: a shared file cannot run code.

## `"kind": "2d"`: a scene of shapes

Easier to write by hand or by an agent. World coordinates, y up, `view: [xmin, ymin, xmax, ymax]`. Every number may be a formula string.

| Shape | Attributes |
|---|---|
| line, arrow | x1 y1 x2 y2 |
| rect | x y w h, angle (about its centre) |
| circle | cx cy r |
| spring | x1 y1 x2 y2, width, coils |
| damper | x1 y1 x2 y2, width |
| ground | x1 x2 y, side ("above" hatches upwards: a ceiling) |
| text | x y text size; `{formula}` inside text shows a value |
| group | x y angle (translate, then rotate) and its own shapes |

Style: `stroke`, `fill` (ink, muted, panel, ch1–ch4, or a CSS colour), `lineWidth` in pixels. Angles in radians, counter-clockwise.

## Examples in the System library

- Mass–spring–damper: "Hanging mass" (shapes; the mass hangs from a ceiling, as the person asked) and "Hanging mass (SVG)" (the same picture as SVG with bindings).
- Inverted pendulum: "Cart and pole" (shapes; nested groups move the cart and rotate the pole).

## Later

- 3D: URDF (links, joints, meshes as glTF/STL), each joint bound to a signal the same way, rendered with a WebGL library loaded from the CDN.
- A triple inverted pendulum on a cart (needs a three-link physics block).

Code: `src/core/views.js` (validation, scene evaluation, bindings), `src/ui/scene.js` (drawing).
