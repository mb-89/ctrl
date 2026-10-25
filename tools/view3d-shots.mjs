// Pictures of the 3D view (ui/view3d.js) in a browser, to look at: a harness
// page in .harness/ (git-ignored) with a sample arm of boxes, cylinders and a
// sphere, a dashed circle, a fading trail and frame triads, then screenshots
// in .harness/shots/: WebGL light and dark, the Canvas fallback forced light
// and dark, a narrow viewport, a lost and a restored context, a hovered link
// and a click on the view cube. It also times a frame. Not part of npm test.
//
//   node tools/view3d-shots.mjs             needs Playwright (global install)

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { bundleScript, vendorBlock, MODULES } from '../build.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.harness'), SHOTS = join(OUT, 'shots');

// The sample arm: a pedestal, a shoulder, an upper arm, a forearm, a wrist
// and a tool, with six joints (z, y, y, x, y, x) posed by forward kinematics.
const SAMPLE = String.raw`
const I = [1,0,0, 0,1,0, 0,0,1];
const mul = (A, B) => [0,1,2].flatMap((r) => [0,1,2].map((c) => A[3*r]*B[c] + A[3*r+1]*B[3+c] + A[3*r+2]*B[6+c]));
const mv = (A, v) => [0,1,2].map((r) => A[3*r]*v[0] + A[3*r+1]*v[1] + A[3*r+2]*v[2]);
const rotAxis = (a, q) => { const [x, y, z] = a, c = Math.cos(q), s = Math.sin(q), t = 1 - c;
  return [t*x*x+c, t*x*y-s*z, t*x*z+s*y, t*x*y+s*z, t*y*y+c, t*y*z-s*x, t*x*z-s*y, t*y*z+s*x, t*z*z+c]; };
const box = (size, p, rgba) => ({ origin: { R: I, p }, geom: { type: 'box', size }, rgba, material: null });
const cyl = (radius, length, p, R = I, rgba = null) => ({ origin: { R, p }, geom: { type: 'cylinder', radius, length }, rgba, material: null });
const sph = (radius, p, rgba) => ({ origin: { R: I, p }, geom: { type: 'sphere', radius }, rgba, material: null });
const RX = [1,0,0, 0,0,-1, 0,1,0], RY = [0,0,1, 0,1,0, -1,0,0];
const grey = [0.78, 0.8, 0.82, 1], dark = [0.32, 0.35, 0.38, 1], orange = [0.93, 0.55, 0.2, 1];
const links = [
  { name: 'base', visuals: [cyl(0.16, 0.06, [0, 0, 0.03], I, dark), cyl(0.1, 0.6, [0, 0, 0.36], I, grey)] },
  { name: 'shoulder', visuals: [cyl(0.11, 0.2, [0, 0, 0], RX, orange), box([0.16, 0.16, 0.16], [0, 0, -0.05], orange)] },
  { name: 'upper_arm', visuals: [box([0.44, 0.1, 0.12], [0.22, 0, 0], grey), cyl(0.08, 0.14, [0.44, 0, 0], RX, dark)] },
  { name: 'forearm', visuals: [cyl(0.05, 0.38, [0.19, 0, 0], RY, grey)] },
  { name: 'wrist', visuals: [sph(0.055, [0, 0, 0], orange)] },
  { name: 'flange', visuals: [cyl(0.035, 0.06, [0.03, 0, 0], RY, dark)] },
  { name: 'tool', visuals: [cyl(0.008, 0.08, [0.1, 0, 0], RY, [0.85, 0.2, 0.2, 1])] },
];
// Each joint: its parent, the offset of its frame in the parent's, its axis.
const chain = [
  { name: 'waist', parent: 'base', child: 'shoulder', at: [0, 0, 0.72], axis: [0, 0, 1] },
  { name: 'shoulder', parent: 'shoulder', child: 'upper_arm', at: [0, -0.12, 0], axis: [0, 1, 0] },
  { name: 'elbow', parent: 'upper_arm', child: 'forearm', at: [0.44, 0.0, 0], axis: [0, 1, 0] },
  { name: 'wrist roll', parent: 'forearm', child: 'wrist', at: [0.38, 0, 0], axis: [1, 0, 0] },
  { name: 'wrist pitch', parent: 'wrist', child: 'flange', at: [0, 0, 0], axis: [0, 1, 0] },
  { name: 'flange roll', parent: 'flange', child: 'tool', at: [0, 0, 0], axis: [1, 0, 0] },
];
const joints = chain.map((j) => ({ name: j.name, child: j.child, axis: j.axis }));
function poses(q) {
  const out = { base: { R: I, p: [0, 0, 0] } };
  chain.forEach((j, i) => {
    const P = out[j.parent];
    const R = mul(mul(P.R, I), rotAxis(j.axis, q[i]));
    out[j.child] = { R, p: P.p.map((v, k) => v + mv(P.R, j.at)[k]) };
  });
  return out;
}
const qAt = (t) => [-0.35 + 0.25 * Math.sin(2 * Math.PI * t / 2.5), -0.35 + 0.12 * Math.cos(2 * Math.PI * t / 2.5), 1.0 + 0.2 * Math.sin(2 * Math.PI * t / 2.5), 0.3, -0.5, 0];
const toolOf = (P) => { const f = P.tool; return { R: f.R, p: f.p.map((v, k) => v + mv(f.R, [0.14, 0, 0])[k]) }; };
// The reference: a horizontal circle; the trail: the tool, sampled at 1 ms.
const circle = { c: [0.62, -0.25, 0.52], r: 0.15 };
const ref = [];
for (let i = 0; i <= 720; i++) { const a = 2 * Math.PI * i / 720; ref.push(circle.c[0] + circle.r * Math.cos(a), circle.c[1] + circle.r * Math.sin(a), circle.c[2]); }
const trail = [], times = [];
for (let i = 0; i <= 5000; i++) {
  const t = i / 1000, a = 2 * Math.PI * t / 2.5, e = 0.012 * Math.exp(-t);
  trail.push(circle.c[0] + (circle.r - e) * Math.cos(a), circle.c[1] + (circle.r - e) * Math.sin(a), circle.c[2] + 0.004 * Math.sin(5 * a));
  times.push(t);
}
`;

const HARNESS = String.raw`
const V = __mods['ui/view3d.js'];
window.__view3d = V;
const params = new URLSearchParams(location.search);
if (params.get('theme')) document.documentElement.dataset.theme = params.get('theme');
${SAMPLE}
const view = V.createView3d(document.getElementById('host'), {
  links, joints,
  camera: { target: [0.35, -0.1, 0.45], view: params.get('view') || 'iso', distance: 2.1 },
  renderer: params.get('renderer') || 'auto',
  linkInfo: (name) => name === 'upper_arm' ? 'q2 = -20.1°   τ2 = 41.7 N·m' : '',
  onPick: (info) => { window.__picked = info; },
});
function show(t) {
  const P = poses(qAt(t));
  view.setPoses(P);
  view.setPath('ref', { points: ref, style: 'reference' });
  view.setPath('tool', { points: trail, times, now: t, fade: 2.5, style: 'actual' });
  view.setFrames([{ label: 'base', R: I, p: [0, 0, 0] }, { label: 'tool', ...toolOf(P), size: 0.08 }, { label: 'circle', R: I, p: circle.c, size: 0.1 }]);
}
show(Number(params.get('t') || 3.2));
window.__view = view;
window.__show = show;
window.__poses = (t) => poses(qAt(t));
// The JavaScript cost of a frame: new poses, paths and frames, then a draw.
window.__time = (n = 120) => {
  const t0 = performance.now();
  for (let i = 0; i < n; i++) { show(2 + i / 60); view.renderNow(); }
  return (performance.now() - t0) / n;
};
`;

export function harnessHtml() {
  const css = readFileSync(join(ROOT, 'src/ui/style.css'), 'utf8');
  const mods = MODULES.slice(0, MODULES.indexOf('ui/view3d.js') + 1);
  const js = bundleScript(mods, HARNESS).replace(/<\/script/gi, '<\\/script');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>3D view harness</title><style>${css}
html, body { height: 100%; margin: 0; } body { padding: 16px; } #host { height: calc(100vh - 32px); border: 1px solid var(--line-strong); border-radius: 8px; overflow: hidden; }</style></head>
<body><div id="host"></div>
${vendorBlock()}
<script>${js}</script>
</body></html>
`;
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const page0 = join(OUT, 'view3d.html');
  writeFileSync(page0, harnessHtml());
  const require = createRequire(import.meta.url);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  const url = (q = '') => `${pathToFileURL(page0).href}${q}`;
  const report = {};
  const errors = [];
  async function open(q, width = 1280, height = 800, scheme = 'light') {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: scheme });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${q}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${q}: console ${m.type()}: ${m.text()}`); });
    await page.goto(url(q));
    await page.waitForTimeout(400);
    return { page, ctx };
  }
  const shot = async (page, name) => { await page.screenshot({ path: join(SHOTS, `${name}.png`) }); report[name] = await page.evaluate(() => window.__view.mode); };

  for (const [name, q, scheme] of [['webgl-light', '?theme=light', 'light'], ['webgl-dark', '?theme=dark', 'dark'], ['canvas-light', '?renderer=canvas&theme=light', 'light'], ['canvas-dark', '?renderer=canvas&theme=dark', 'dark']]) {
    const { page, ctx } = await open(q, 1280, 800, scheme);
    await shot(page, name);
    report[`${name} frame ms`] = await page.evaluate(() => window.__time(60).toFixed(2));
    await ctx.close();
  }
  {
    const { page, ctx } = await open('?theme=light', 820, 640);
    await shot(page, 'narrow-820');
    // Fly: W held for half a second moves the eye and the target forward.
    const before = await page.evaluate(() => window.__view.camera.target);
    await page.focus('.v3d');
    await page.keyboard.down('w'); await page.waitForTimeout(500); await page.keyboard.up('w');
    const after = await page.evaluate(() => window.__view.camera.target);
    report['fly W 0.5 s'] = `target moved ${Math.hypot(...after.map((v, i) => v - before[i])).toFixed(3)} m`;
    await shot(page, 'fly-w');
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`dpr2: ${e.message}`));
    await page.goto(url('?theme=dark'));
    await page.waitForTimeout(400);
    await shot(page, 'webgl-dark-dpr2');
    await ctx.close();
  }
  {
    // The built page itself: it loads with the vendored script, without errors.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`dist: ${e.message}`));
    await page.goto(pathToFileURL(join(ROOT, 'dist/loop-tuner.html')).href);
    await page.waitForTimeout(800);
    report['dist page THREE'] = await page.evaluate(() => `${typeof THREE} r${THREE.REVISION}, frozen ${Object.isFrozen(THREE)}, app ${typeof window.loopTuner}`);
    await ctx.close();
  }
  {
    const { page, ctx } = await open('?theme=dark', 1280, 800, 'dark');
    await page.evaluate(() => { window.__lose = document.querySelector('.v3d-gl').getContext('webgl2').getExtension('WEBGL_lose_context'); window.__lose.loseContext(); });
    await page.waitForTimeout(300);
    await shot(page, 'context-lost');
    await page.evaluate(() => window.__lose.restoreContext());
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__view.renderNow());
    await shot(page, 'context-restored');
    await ctx.close();
  }
  {
    const { page, ctx } = await open('?theme=light', 1280, 800);
    // Hover the upper arm: its middle, in the view.
    const at = await page.evaluate(() => {
      const P = window.__poses(3.2).upper_arm, p = [0, 1, 2].map((r) => P.p[r] + P.R[3 * r] * 0.22);
      const s = window.__view.screenOf(p), r = document.querySelector('.v3d').getBoundingClientRect();
      return [r.left + s[0], r.top + s[1]];
    });
    await page.mouse.move(at[0], at[1]);
    await page.waitForTimeout(200);
    report.tooltip = await page.evaluate(() => document.querySelector('.v3d-tip').hidden ? '(hidden)' : document.querySelector('.v3d-tip').textContent);
    await shot(page, 'hover-link');
    await page.mouse.down(); await page.mouse.up();
    report.picked = await page.evaluate(() => JSON.stringify(window.__picked));
    // Click the cube's top face, wait for the snap.
    const cube = await page.evaluate(() => {
      const V = window.__view3d, c = window.__view.camera, b = V.orbitBasis(c.yaw, c.pitch), [x, y] = V.cubeToScreen(b, [0, 0, 1], 26);
      const r = document.querySelector('.v3d-cube').getBoundingClientRect();
      return [r.left + r.width / 2 + x, r.top + r.height / 2 + y];
    });
    await page.mouse.move(cube[0], cube[1]);
    await page.waitForTimeout(100);
    await shot(page, 'cube-hover-top');
    await page.mouse.click(cube[0], cube[1]);
    await page.waitForTimeout(700);
    report['cube-click camera'] = await page.evaluate(() => { const c = window.__view.camera; return `yaw ${(c.yaw * 180 / Math.PI).toFixed(1)}°, pitch ${(c.pitch * 180 / Math.PI).toFixed(1)}°`; });
    await shot(page, 'cube-click-top');
    // A corner: the cube's front-right-top corner region, from the top view.
    const corner = await page.evaluate(() => {
      const V = window.__view3d, c = window.__view.camera, b = V.orbitBasis(c.yaw, c.pitch), [x, y] = V.cubeToScreen(b, [0.85, -0.85, 1], 26);
      const r = document.querySelector('.v3d-cube').getBoundingClientRect();
      return [r.left + r.width / 2 + x, r.top + r.height / 2 + y];
    });
    await page.mouse.click(corner[0], corner[1]);
    await page.waitForTimeout(700);
    report['cube-corner camera'] = await page.evaluate(() => { const c = window.__view.camera; return `yaw ${(c.yaw * 180 / Math.PI).toFixed(1)}°, pitch ${(c.pitch * 180 / Math.PI).toFixed(1)}°`; });
    await shot(page, 'cube-click-corner');
    // Orbit by dragging, zoom by the wheel, then the front view by its key.
    await page.mouse.move(640, 420); await page.mouse.down(); await page.mouse.move(760, 380, { steps: 6 }); await page.mouse.up();
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(150);
    await shot(page, 'orbit-zoom');
    await page.keyboard.press('1');
    await page.waitForTimeout(600);
    await shot(page, 'key-front');
    await ctx.close();
  }
  await browser.close();
  for (const [k, v] of Object.entries(report)) console.log(`${k.padEnd(22)} ${v}`);
  if (errors.length) console.log(`errors:\n  ${errors.join('\n  ')}`);
  console.log(`shots in ${SHOTS}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
