// The PUMA 560 following its circle, kinematically, with the robot core
// alone (no compiler yet): closed-loop inverse kinematics through the damped
// inverse Jacobian, q̇ = J⁺·[v_d + k·e_p; k·e_o], integrated at 1 ms; the
// joint torques along the motion from inverse dynamics, split into their
// shares. test/robot-circle.test.mjs holds it to the plan's numbers;
//
//   node tools/robot-demo.mjs [--shots [folder]]
//
// writes .harness/robot-demo.html (the arm in the 3D view, the dashed circle,
// the fading trail, the frames; ?canvas forces the fallback, ?theme=dark) and
// with --shots takes screenshots of it into .harness/shots/ (or the folder
// given after it) and times a frame.

import { parseUrdf } from '../src/core/urdf.js';
import { createRbd, dampedInverse, orientationError } from '../src/core/rbd.js';
import { PUMA560 } from '../src/core/puma560.js';

const DEG = Math.PI / 180;

// The circle's phase, eased: its rate rises from 0 to ω along a quintic
// smoothstep over Te seconds, so position, speed and acceleration start at 0
// and the path is exactly the circle from t = 0.
export function easedPhase(t, w, Te) {
  if (t >= Te) return { phi: w * (t - Te / 2), dphi: w, ddphi: 0 };
  const s = t / Te;
  return { phi: w * Te * (2.5 * s ** 4 - 3 * s ** 5 + s ** 6), dphi: w * (10 * s ** 3 - 15 * s ** 4 + 6 * s ** 5), ddphi: (w / Te) * (30 * s ** 2 - 60 * s ** 3 + 30 * s ** 4) };
}

export function circleFollow({ radius = 0.15, period = 2.5, ease = 0.5, T = 5, h = 1e-3, k = 10, start = PUMA560.start } = {}) {
  const model = parseUrdf(PUMA560.urdf);
  const r = createRbd(model, { armature: PUMA560.armature });
  const n = r.n, tool = PUMA560.tool, w = (2 * Math.PI) / period;
  const q = Float64Array.from(start, (v) => v * DEG), qd = new Float64Array(n);
  // The circle's frame: at the tool's start point, axes a, b along the base's x, y.
  const { R: Rd, p: origin } = r.linkPose(q, tool);
  const ref = (t) => {
    const { phi, dphi, ddphi } = easedPhase(t, w, ease);
    const a = radius * (Math.cos(phi) - 1), b = radius * Math.sin(phi);
    return {
      p: [origin[0] + a, origin[1] + b, origin[2]],
      v: [-radius * Math.sin(phi) * dphi, radius * Math.cos(phi) * dphi, 0],
      acc: [-radius * (Math.cos(phi) * dphi ** 2 + Math.sin(phi) * ddphi), radius * (-Math.sin(phi) * dphi ** 2 + Math.cos(phi) * ddphi), 0],
    };
  };
  const steps = Math.round(T / h);
  const out = {
    model, rbd: r, origin, Rd, h,
    t: new Float64Array(steps + 1), q: new Float64Array((steps + 1) * n), qd: new Float64Array((steps + 1) * n),
    p: new Float64Array((steps + 1) * 3), pRef: new Float64Array((steps + 1) * 3), error: new Float64Array(steps + 1),
    sigma: new Float64Array(steps + 1), orient: new Float64Array(steps + 1),
  };
  const J = new Float64Array(36), v = new Float64Array(6), eo = new Float64Array(3);
  const rate = (t, qq, dq) => {
    const { R, p } = r.linkPose(qq, tool), d = ref(t);
    const { theta } = orientationError(Rd, R, eo);
    r.jacobian(qq, tool, J);
    const inv = dampedInverse(J, 6, n);
    for (let i = 0; i < 3; i++) { v[i] = d.v[i] + k * (d.p[i] - p[i]); v[3 + i] = k * eo[i]; }
    for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < 6; j++) s += inv.Jinv[i * 6 + j] * v[j]; dq[i] = s; }
    return { p, d, sigma: inv.sigma, theta };
  };
  const k1 = new Float64Array(n), k2 = new Float64Array(n), k3 = new Float64Array(n), k4 = new Float64Array(n), x = new Float64Array(n);
  for (let s = 0; ; s++) {
    const t = s * h, st = rate(t, q, k1);
    out.t[s] = t;
    out.q.set(q, s * n); out.qd.set(k1, s * n);
    out.p.set(st.p, 3 * s); out.pRef.set(st.d.p, 3 * s);
    out.error[s] = Math.hypot(st.p[0] - st.d.p[0], st.p[1] - st.d.p[1], st.p[2] - st.d.p[2]);
    out.sigma[s] = st.sigma; out.orient[s] = st.theta;
    if (s === steps) break;
    for (let i = 0; i < n; i++) x[i] = q[i] + 0.5 * h * k1[i];
    rate(t + h / 2, x, k2);
    for (let i = 0; i < n; i++) x[i] = q[i] + 0.5 * h * k2[i];
    rate(t + h / 2, x, k3);
    for (let i = 0; i < n; i++) x[i] = q[i] + h * k3[i];
    rate(t + h, x, k4);
    for (let i = 0; i < n; i++) q[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  }
  // The torques the motion takes, from inverse dynamics on the recorded
  // q, q̇ and q̈ (q̈ by central differences of q̇), with the drives' friction.
  out.tau = { inertial: new Float64Array((steps + 1) * n), coriolis: new Float64Array((steps + 1) * n), gravity: new Float64Array((steps + 1) * n), friction: new Float64Array((steps + 1) * n), total: new Float64Array((steps + 1) * n) };
  const qdd = new Float64Array(n);
  for (let s = 0; s <= steps; s++) {
    const a = Math.max(0, s - 1), b = Math.min(steps, s + 1);
    for (let i = 0; i < n; i++) qdd[i] = (out.qd[b * n + i] - out.qd[a * n + i]) / ((b - a) * h);
    const sp = r.torqueSplit(out.q.subarray(s * n, s * n + n), out.qd.subarray(s * n, s * n + n), qdd, PUMA560.drive);
    for (const key of Object.keys(out.tau)) out.tau[key].set(sp[key], s * n);
  }
  return out;
}

// ---- The harness page

async function main() {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const build = await import('./build.mjs');
  const run = circleFollow();
  const n = run.rbd.n, steps = run.t.length - 1;
  // Every 10th sample is enough for the picture (10 ms).
  const every = 10, idx = [];
  for (let s = 0; s <= steps; s += every) idx.push(s);
  const data = {
    t: idx.map((s) => run.t[s]),
    q: idx.map((s) => Array.from(run.q.subarray(s * n, s * n + n))),
    p: idx.flatMap((s) => Array.from(run.p.subarray(3 * s, 3 * s + 3))),
    pRef: Array.from(run.pRef),
    tau: idx.map((s) => Array.from(run.tau.total.subarray(s * n, s * n + n))),
    gravity: idx.map((s) => Array.from(run.tau.gravity.subarray(s * n, s * n + n))),
    origin: run.origin,
  };
  const tail = `
const { parseUrdf } = __mods['core/urdf.js'], { createRbd } = __mods['core/rbd.js'], { PUMA560 } = __mods['core/puma560.js'], { createView3d } = __mods['ui/view3d.js'];
const D = ${JSON.stringify(data)};
const qs = new URLSearchParams(location.search);
if (qs.get('theme')) document.documentElement.dataset.theme = qs.get('theme');
const model = parseUrdf(PUMA560.urdf), rbd = createRbd(model, { armature: PUMA560.armature });
let at = Number(qs.get('t') ?? 3.4), k = 0;
const host = document.getElementById('view');
const view = createView3d(host, {
  links: model.links, joints: model.joints, renderer: qs.has('canvas') ? 'canvas' : 'auto',
  camera: { target: [0.45, -0.1, 0.55], view: 'iso', distance: 2.3 },
  linkInfo: (name) => {
    const j = model.joints.findIndex((x) => x.child === name);
    return j < 0 ? '' : 'q' + (j + 1) + ' ' + (D.q[k][j] * 180 / Math.PI).toFixed(1) + '°, τ' + (j + 1) + ' ' + D.tau[k][j].toFixed(2) + ' N·m';
  },
});
view.setPath('reference', { points: D.pRef, style: 'reference' });
const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
function show(t) {
  k = Math.min(D.t.length - 1, Math.max(0, Math.round(t / (D.t[1] - D.t[0]))));
  const poses = rbd.linkPoses(D.q[k]);
  view.setPoses(poses);
  view.setPath('trail', { points: D.p, times: D.t, now: D.t[k], style: 'actual', fade: 2.5 });
  view.setFrames([{ label: 'base', R: I, p: [0, 0, 0], size: 0.25 }, { label: 'tool', R: poses.flange.R, p: poses.flange.p, size: 0.1 }, { label: 'circle', R: I, p: D.origin, size: 0.12 }]);
  document.getElementById('read').textContent = 't ' + D.t[k].toFixed(2) + ' s   τ2 ' + D.tau[k][1].toFixed(2) + ' N·m (gravity ' + D.gravity[k][1].toFixed(2) + ')   τ3 ' + D.tau[k][2].toFixed(2) + ' N·m (gravity ' + D.gravity[k][2].toFixed(2) + ')   ' + view.mode;
}
show(at);
if (qs.has('play')) { const t0 = performance.now(); const tick = () => { show(((performance.now() - t0) / 1000) % 5); requestAnimationFrame(tick); }; tick(); }
window.__demo = { view, show };
`;
  const css = (await import('node:fs')).readFileSync(join(ROOT, 'src/ui/style.css'), 'utf8');
  const js = build.bundleScript(build.MODULES.slice(0, build.MODULES.indexOf('ui/view3d.js') + 1), tail).replace(/<\/script/gi, '<\\/script');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>PUMA 560 demo</title>
<style>${css}
body { display: flex; flex-direction: column; height: 100vh; margin: 0; }
#view { flex: 1; min-height: 0; position: relative; }
#read { font: 12px var(--mono); padding: 6px 10px; color: var(--ink-2); }</style></head>
<body><div id="read"></div><div id="view"></div>${build.vendorBlock()}<script>${js}</script></body></html>`;
  mkdirSync(join(ROOT, '.harness'), { recursive: true });
  const file = join(ROOT, '.harness/robot-demo.html');
  writeFileSync(file, html);
  console.log(`${file}  ${(html.length / 1024).toFixed(0)} KB`);
  const at = process.argv.indexOf('--shots'), folder = process.argv[at + 1];
  if (at >= 0) await shots(file, join(ROOT, folder && !folder.startsWith('-') ? folder : '.harness/shots'));
}

async function shots(file, dir) {
  const { mkdirSync } = await import('node:fs');
  const { createRequire } = await import('node:module');
  const { chromium } = createRequire(import.meta.url)('/opt/node22/lib/node_modules/playwright');
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const cases = [
    ['puma-webgl-light', '?theme=light', 1280], ['puma-webgl-dark', '?theme=dark', 1280],
    ['puma-canvas-light', '?theme=light&canvas', 1280], ['puma-canvas-dark', '?theme=dark&canvas', 1280],
    ['puma-820-light', '?theme=light', 820], ['puma-820-dark', '?theme=dark', 820],
    ['puma-820-canvas-light', '?theme=light&canvas', 820], ['puma-820-canvas-dark', '?theme=dark&canvas', 820],
  ];
  for (const [name, query, width] of cases) {
    const page = await browser.newPage({ viewport: { width, height: 760 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`file://${file}${query}`);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${dir}/${name}.png` });
    const mode = await page.evaluate(() => window.__demo?.view.mode);
    // The cost of a frame: new poses, trail and frames, then a draw; its
    // JavaScript, then with the draw finished (one pixel read back from WebGL).
    const ms = await page.evaluate(() => {
      const gl = document.querySelector('.v3d-gl').getContext('webgl2'), px = new Uint8Array(4), time = (sync) => {
        const t0 = performance.now();
        for (let i = 0; i < 60; i++) { window.__demo.show(2 + i / 60); window.__demo.view.renderNow(); if (sync) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
        return ((performance.now() - t0) / 60).toFixed(2);
      };
      return window.__demo.view.mode === 'webgl' ? `${time(false)} ms/frame JS, ${time(true)} ms drawn` : `${time(false)} ms/frame`;
    });
    console.log(name, mode, ms, errors.length ? errors : '');
    await page.close();
  }
  await browser.close();
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) await main();
