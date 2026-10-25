// The colours a canvas needs (the scope, the plots, the saved picture), read
// once from the design tokens in style.css, so that every colour is set in
// one place (design/output/design-system.md). The screen is dark in both
// themes, so these do not change with the theme. How strongly each is drawn
// (its alpha) is named here, once; modules use the names.

const TOKENS = {
  screen: '--screen', ink: '--screen-ink', label: '--screen-label', line: '--screen-line', mark: '--screen-mark',
  ch1: '--ch-1', ch2: '--ch-2', ch3: '--ch-3', ch4: '--ch-4',
  accent: '--accent', inkOnLit: '--ink-on-lit', ok: '--lamp-ok', warn: '--lamp-warn', bad: '--lamp-bad',
};

// A colour with another alpha: rgb()/rgba() as getComputedStyle gives them.
export function fade(color, a) {
  const m = String(color).match(/[\d.]+/g);
  return m && m.length >= 3 ? `rgba(${m[0]}, ${m[1]}, ${m[2]}, ${a})` : color;
}

let cached = null;
export function palette() {
  if (cached) return cached;
  const probe = document.createElement('i');
  probe.hidden = true;
  document.body.append(probe);
  const t = {};
  for (const [k, name] of Object.entries(TOKENS)) {
    probe.style.color = `var(${name})`;
    t[k] = getComputedStyle(probe).color;
  }
  probe.remove();
  const mono = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim();
  cached = Object.freeze({
    bg: t.screen,
    // Lines: the dotted grid, the centre axes and box borders, the frame.
    grid: fade(t.line, 0.32), gridFaint: fade(t.line, 0.18), tick: fade(t.line, 0.4), axis: fade(t.line, 0.5),
    // Text: axis labels, readouts.
    label: fade(t.label, 0.75), rule: fade(t.label, 0.16), ruleStrong: fade(t.label, 0.4), hist: fade(t.label, 0.8),
    ink: fade(t.ink, 0.9), preview: fade(t.ink, 0.75), cursor: fade(t.ink, 0.5), scan: fade(t.ink, 0.35), hover: fade(t.ink, 0.08), handle: t.ink,
    // Behind a label or a readout on the screen.
    veil: fade(t.screen, 0.85),
    // A marker that must stand out from every channel: the selected line, a point.
    mark: t.mark,
    ch: [t.ch1, t.ch2, t.ch3, t.ch4],
    accent: t.accent, inkOnLit: t.inkOnLit, ok: t.ok, warn: t.warn, bad: t.bad,
    mono: mono || 'monospace',
  });
  return cached;
}

// The spectrogram's colour map (inferno: dark to bright, readable in grey and
// for colour-vision deficiency), from 0 (the floor) to 1 (the ceiling).
export const HEAT_STOPS = [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]];
