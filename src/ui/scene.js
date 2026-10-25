// Draws a 2D view (core/views.js) as SVG, animated at the scope's time: the
// scan line while it sweeps, the hover cursor while the mouse is on the plot,
// otherwise the right edge of the screen.

import { compileScene, compileBindings } from '../core/views.js';

const NS = 'http://www.w3.org/2000/svg';

function colour(name) {
  const m = /^ch([1-4])$/.exec(name ?? '');
  if (m) return `var(--ch-${m[1]})`;
  return { ink: 'var(--ink)', muted: 'var(--ink-3)', panel: 'var(--surface)', none: 'none' }[name] ?? name;
}

export function createScene(host, app) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'pscene');
  svg.setAttribute('role', 'img');
  host.append(svg);
  let view = null, scene = null, raf = 0, error = '', svgRoot = null, binds = null;

  // An SVG view: the drawing is cleaned (no scripts, event handlers, outside
  // links), inserted once, and its bound attributes updated every frame.
  function mountSvg(v) {
    const doc = new DOMParser().parseFromString(v.svg, 'image/svg+xml');
    if (doc.querySelector('parsererror')) throw new Error('the SVG does not parse');
    doc.querySelectorAll('script, foreignObject, iframe, object, embed').forEach((n) => n.remove());
    for (const el of doc.querySelectorAll('*')) {
      for (const a of [...el.attributes]) {
        if (/^on/i.test(a.name) || (/href$/i.test(a.name) && !a.value.startsWith('#'))) el.removeAttribute(a.name);
      }
    }
    svgRoot = document.importNode(doc.documentElement, true);
    svgRoot.setAttribute('class', 'pscene');
    if (!svgRoot.getAttribute('preserveAspectRatio')) svgRoot.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.replaceWith(svgRoot);
    binds = compileBindings(v);
  }
  function unmountSvg() { if (svgRoot) { svgRoot.replaceWith(svg); svgRoot = null; binds = null; } }

  function drawSvg() {
    for (const { select, attr, value } of binds(app.sceneEnv())) {
      for (const el of svgRoot.querySelectorAll(select)) {
        if (attr === 'text') el.textContent = value; else el.setAttribute(attr, value);
      }
    }
  }

  function draw() {
    raf = 0;
    if (!view || host.hidden) return;
    if (view.kind === 'svg') { try { drawSvg(); } catch { /* a bad selector draws nothing */ } raf = requestAnimationFrame(draw); return; }
    const [x0, y0, x1, y1] = view.view;
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height) { raf = requestAnimationFrame(draw); return; }
    // World to pixels, uniform scale, centred, y up.
    const k = Math.min(r.width / (x1 - x0), r.height / (y1 - y0));
    const ox = (r.width - (x1 - x0) * k) / 2 - x0 * k, oy = (r.height + (y1 - y0) * k) / 2 + y0 * k;
    const X = (p) => (ox + p[0] * k).toFixed(1), Y = (p) => (oy - p[1] * k).toFixed(1);
    const env = app.sceneEnv();
    let html = '<defs><marker id="sc-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="context-stroke"/></marker></defs>';
    try {
      for (const o of scene(env)) {
        if (o.pts?.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) continue;
        const st = `stroke="${colour(o.stroke)}" stroke-width="${o.width}" fill="${colour(o.fill)}" stroke-linejoin="round" stroke-linecap="round"`;
        if (o.op === 'line' || o.op === 'arrow') {
          const [p, q] = o.pts;
          if (o.op === 'arrow' && Math.hypot(X(q) - X(p), Y(q) - Y(p)) < 0.5) continue;  // no length, no arrow (a force of 0)
          html += `<line x1="${X(p)}" y1="${Y(p)}" x2="${X(q)}" y2="${Y(q)}" ${st}${o.op === 'arrow' ? ' marker-end="url(#sc-arrow)"' : ''}/>`;
        } else if (o.op === 'poly') {
          html += `<${o.closed ? 'polygon' : 'polyline'} points="${o.pts.map((p) => `${X(p)},${Y(p)}`).join(' ')}" ${st}/>`;
        } else if (o.op === 'circle' && Number.isFinite(o.c[0])) {
          html += `<circle cx="${X(o.c)}" cy="${Y(o.c)}" r="${(o.r * k).toFixed(1)}" ${st}/>`;
        } else if (o.op === 'text' && Number.isFinite(o.at[0])) {
          html += `<text x="${X(o.at)}" y="${Y(o.at)}" font-size="${o.size}" fill="${colour(o.fill)}" text-anchor="${o.anchor ?? 'middle'}" dominant-baseline="middle" xml:space="preserve">${o.text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</text>`;
        }
      }
      html += `<text class="sctime" x="10" y="${r.height - 10}">t = ${env.t.toFixed(3)} s</text>`;
    } catch (err) { html += `<text class="scerr" x="10" y="20">${String(err.message)}</text>`; }
    svg.innerHTML = html;
    raf = requestAnimationFrame(draw);
  }

  return {
    show(v) {
      view = v;
      error = '';
      unmountSvg();
      try {
        if (v.kind === 'svg') mountSvg(v); else scene = compileScene(v);
      } catch (err) {
        error = err.message;
        view = { ...v, kind: '2d', view: [-1, -1, 1, 1], shapes: [{ type: 'text', x: 0, y: 0, text: `View error: ${err.message.replace(/[{}]/g, '')}` }] };
        scene = compileScene(view);
      }
      if (!raf) raf = requestAnimationFrame(draw);
      return error;
    },
    stop() { if (raf) cancelAnimationFrame(raf); raf = 0; view = null; unmountSvg(); },
  };
}
