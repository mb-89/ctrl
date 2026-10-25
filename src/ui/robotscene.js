// Draws a 3D view (core/views.js, kind "3d"; design/output/robot.md §7) in
// the Plant tab: the robot from its URDF posed by the joint signals at the
// scope's time (the scan line while it sweeps, the hover cursor while the
// mouse is on the plot, otherwise the right edge of the screen), its paths
// from the recorded arrays, and triads for the base, the tool and the
// reference path's start.

import { parseUrdf } from '../core/urdf.js';
import { createRbd } from '../core/rbd.js';
import { createView3d } from './view3d.js';

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// A path's samples as [x, y, z, …] with their times, dropping samples that
// are not finite (a live sweep not yet there).
function pathSamples(data, p) {
  const xs = data.signals[p.x], ys = data.signals[p.y], zs = data.signals[p.z];
  if (!xs || !ys || !zs) return null;
  const points = [], times = [];
  for (let i = 0; i < data.t.length; i++) {
    if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i]) || !Number.isFinite(zs[i])) continue;
    points.push(xs[i], ys[i], zs[i]);
    times.push(data.t[i]);
  }
  return { points, times };
}

export function createRobotScene(host, app) {
  let spec = null, view = null, model = null, rbd = null, raf = 0, drawn = 0;
  let jointNames = [], last = { data: null, k: -1 }, samples = [], rec = { data: null, k: null };

  // The signal that poses joint i: a Sink's base name numbered (q1 …), or
  // the map by the joint's name (or j1 …).
  const jointSignal = (i) => (typeof spec.joints === 'string' ? `${spec.joints}${i + 1}` : spec.joints[model.joints[i].name] ?? spec.joints[`j${i + 1}`]);
  const valueAt = (name) => { const v = rec.data?.signals[name]; return v && rec.k !== null ? v[rec.k] : undefined; };

  // Hovering a link: its joint's angle and torque (the Sink tau1 …) at the instant.
  function linkInfo(name) {
    const j = model.joints.findIndex((x) => x.child === name);
    if (j < 0) return '';
    const q = valueAt(jointNames[j]), tau = valueAt(`tau${j + 1}`);
    return [Number.isFinite(q) ? `${jointNames[j]} ${(q * 180 / Math.PI).toFixed(1)}°` : '', Number.isFinite(tau) ? `τ${j + 1} ${tau.toFixed(2)} N·m` : ''].filter(Boolean).join(', ');
  }

  function update() {
    rec = app.sceneRecord();
    const { data, k } = rec;
    if (data === last.data && k === last.k) return;
    const fresh = data !== last.data;
    last = { data, k };
    const q = jointNames.map((n) => { const v = valueAt(n); return Number.isFinite(v) ? v : 0; });
    const poses = rbd.linkPoses(q);
    view.setPoses(poses);
    if (fresh) samples = spec.paths.map((p) => (data ? pathSamples(data, p) : null));
    const now = data ? data.t[k] : 0;
    spec.paths.forEach((p, i) => {
      const s = samples[i];
      if (!s?.points.length) { view.setPath(`path${i}`, null); return; }
      if (p.span === 'all') { if (fresh) view.setPath(`path${i}`, { points: s.points, style: p.style }); return; }
      // Up to the instant: the actual path fades behind it; a reference is cut there.
      if (p.style === 'actual') view.setPath(`path${i}`, { points: s.points, times: s.times, now, style: 'actual', ...(p.fade ? { fade: p.fade } : {}) });
      else { let n = 0; while (n < s.times.length && s.times[n] <= now) n++; view.setPath(`path${i}`, n > 1 ? { points: s.points.slice(0, 3 * n), style: p.style } : null); }
    });
    const tool = poses[model.links[model.links.length - 1].name];
    const frames = [{ label: 'base', R: IDENTITY, p: [0, 0, 0] }];
    if (tool) frames.push({ label: 'tool', R: tool.R, p: tool.p });
    const ref = spec.paths.findIndex((p) => p.style === 'reference');
    if (samples[ref]?.points.length) frames.push({ label: 'circle', R: IDENTITY, p: samples[ref].points.slice(0, 3) });
    view.setFrames(frames);
  }

  // While the page makes a plan, at most 20 frames a second (app.frameMs).
  function draw(t = 0) {
    raf = 0;
    if (!view) return;
    raf = requestAnimationFrame(draw);
    if (host.hidden) return;
    const every = app.frameMs?.() ?? 0;
    if (every && t - drawn < every) return;
    drawn = t;
    update();
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    view?.destroy();
    view = null; spec = null; last = { data: null, k: -1 }; samples = [];
    host.replaceChildren();
  }

  return {
    // v: a normalised 3D view; robots: the diagram's robots map. Returns an
    // error's text, or ''.
    show(v, robots) {
      stop();
      try {
        const urdf = v.urdf ?? robots?.[v.robot]?.urdf;
        if (!urdf) throw new Error(`no robot "${v.robot}" in the diagram's robots`);
        model = parseUrdf(urdf);
        rbd = createRbd(model);
        spec = v;
        jointNames = model.joints.map((_, i) => jointSignal(i));
        view = createView3d(host, { links: model.links, joints: model.joints, camera: v.camera, linkInfo });
      } catch (err) {
        stop();
        host.innerHTML = `<p class="note text-bad">View error: ${esc(err.message)}</p>`;
        return err.message;
      }
      update();
      raf = requestAnimationFrame(draw);
      return '';
    },
    stop,
    get view() { return view; },
  };
}
