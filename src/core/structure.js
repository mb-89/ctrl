// What a controller or observer variant does, as a small block diagram for
// the Controller tab (design/output/controller-proposal.md). This module only
// describes the picture, with the variant's live values on it; it touches no
// DOM, so it runs in Node for the tests. src/ui/ctldiagram.js draws it.
//
// describeVariant(variant, { inputs, Ts, block, values }) → { title, w, h, nodes, wires }
//   variant  normalised ({ type, params })
//   inputs   names of what feeds the block's inputs (r or u first, then the measurements)
//   Ts       the block's sample time; block: 'controller' or 'observer'
//   values   for a designed type, what its design computed (the Computed
//            box's numbers), when there are any: its picture is its Copy as
//            numbers twin's with those numbers ('–' until they are computed),
//            and a line under it says where they come from
//
// Each type lays out its own picture on a canvas w × h (px at 1:1, about
// the width of the tab's Variants column). Signals flow left to right; r (or
// u) enters at the left, the measurements below it, u leaves at the right.
//
// Nodes, at their centre (x, y), size (w, h):
//   block   lines: [[[text, cls], …], …], cls 'k' a name, 'v' a value, '' plain
//   sum     a summing junction of radius r; signs { w, n, s: '+' | '−' } at its inputs
//   bar     a tall summing bar Σ; signs [[y, '+' | '−'], …] along its left side
//   sat     the actuator limits (text: the range)
//   relay   a relay with hysteresis
//   switch  inputs a, b (points), pivot, to: 'a' | 'b' (where the lever rests)
//   port    a signal's name where it enters or leaves; anchor 'start' | 'end'
//   dot     a junction
//   note    a line of small text; anchor; cls '' | 'warn'
// Any node may have tip (a sentence for its tooltip) and faint (true when its
// gain is 0 or it is off: drawn faint). Wires: { pts: [[x, y], …], arrow
// (default true), dashed, faint, over (drawn over the lines it crosses) }.

import { trackingTime, ANTI_WINDUP } from './controllers.js';

export const DIAGRAM_WIDTH = 276;

// A number as the diagram shows it: 3 significant digits, k for the very
// large and µ for the very small (below 0.001; 0.005 stays 0.005), a true
// minus sign.
export function fmt(v) {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? '–' : v > 0 ? '∞' : '−∞';
  if (v === 0) return '0';
  const a = Math.abs(v);
  let x = v, unit = '';
  if (a >= 1e4) { x = v / 1e3; unit = 'k'; }
  else if (a < 1e-3) { x = v * 1e6; unit = 'µ'; }
  return `${Number(x.toPrecision(3))}${unit}`.replace('-', '−');
}
// A time: in ms below 0.1 s ("20 ms"), else in s ("0.387 s").
const secs = (v) => (Number.isFinite(v) && v !== 0 && Math.abs(v) < 0.1 ? `${fmt(v * 1e3)} ms` : `${fmt(v)} s`);
const range = (xs) => { if (xs.some(Number.isNaN)) return '–'; const lo = Math.min(...xs), hi = Math.max(...xs); return lo === hi ? fmt(lo) : `${fmt(lo)}…${fmt(hi)}`; };
// Times from lo to hi, in the unit the larger one takes.
const secsRange = (xs) => {
  if (!xs.length || xs.some(Number.isNaN)) return '–';
  const lo = Math.min(...xs), hi = Math.max(...xs);
  if (lo === hi) return secs(lo);
  return Math.abs(hi) < 0.1 ? `${fmt(lo * 1e3)}…${fmt(hi * 1e3)} ms` : `${fmt(lo)}…${fmt(hi)} s`;
};
const kv = (k, v) => [[`${k} `, 'k'], [v, 'v']];
const short = (s, n = 8) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

// The actuator limits as a range, or null when there are none.
export function limitsText(lo, hi) {
  const a = Number.isFinite(lo), b = Number.isFinite(hi);
  if (!a && !b) return null;
  if (a && b) return lo === -hi ? `±${fmt(hi)}` : `${fmt(lo)}…${fmt(hi)}`;
  return a ? `≥ ${fmt(lo)}` : `≤ ${fmt(hi)}`;
}

// A note's text is 10 px monospace (--text-2xs): about 6 px a character.
export const NOTE_CHAR = 6;

function sheet(title, w, h) {
  const nodes = [], wires = [];
  const add = (kind) => (o) => { const n = { kind, ...o }; nodes.push(n); return n; };
  // A note is kept inside the canvas: moved in, and cut short (…) when it is
  // wider than the canvas, the whole text then in its tooltip.
  const note = (o) => {
    const room = Math.floor((w - 6) / NOTE_CHAR), chars = [...o.text];
    if (chars.length > room) o = { ...o, text: `${chars.slice(0, room - 1).join('')}…`, tip: o.tip ?? o.text };
    const len = [...o.text].length * NOTE_CHAR, mid = o.anchor === 'middle';
    const x = mid ? Math.min(Math.max(o.x, 3 + len / 2), w - 3 - len / 2) : o.anchor === 'end' ? Math.min(Math.max(o.x, 3 + len), w - 3) : Math.max(3, Math.min(o.x, w - 3 - len));
    return add('note')({ ...o, x });
  };
  return {
    title, w, h, nodes, wires,
    block: add('block'), sum: add('sum'), bar: add('bar'), sat: add('sat'), relay: add('relay'), switch: add('switch'), port: add('port'), dot: add('dot'), note,
    wire: (pts, o = {}) => { wires.push({ pts, arrow: true, ...o }); },
    line: (pts, o = {}) => { wires.push({ pts, arrow: false, ...o }); },
    done() { return { title, w, h, nodes, wires }; },
  };
}

// The prefilter on r and the branch point after it (x 70), at height y.
function reference(s, p, y, name = 'r') {
  s.port({ x: 4, y, text: name, anchor: 'start' });
  s.wire([[12, y], [16, y]]);
  s.block({ x: 39, y, w: 46, h: 16, lines: [kv('Tr', p.Tr > 0 ? secs(p.Tr) : '0')], faint: !(p.Tr > 0), tip: 'Prefilter (Vorfilter): a first-order lag that smooths the reference before the controller sees it; 0 is off' });
  s.line([[62, y], [70, y]]);
  s.dot({ x: 70, y });
}

// The reference feedforward on rf, on the top row, into the summing bar:
// the gains that are not 0, by name.
function feedforward(s, p, fromY) {
  const terms = ['Kff', 'Kv', 'Ka'].filter((k) => p[k]).flatMap((k, i) => kv(`${i ? ' ' : ''}${k}`, fmt(p[k])));
  const off = !terms.length;
  s.wire([[70, fromY], [70, 14], [76, 14]], { faint: off });
  s.block({ x: 141, y: 14, w: 130, h: 16, lines: [[['FF ', 'k'], ...(off ? [['0', 'v']] : terms)]], faint: off, tip: `Reference feedforward: u gets Kff·rf + Kv·drf/dt + Ka·d²rf/dt² from the reference alone (Kff ${fmt(p.Kff ?? 0)}, Kv ${fmt(p.Kv ?? 0)}, Ka ${fmt(p.Ka ?? 0)}); 0 is off` });
  s.wire([[206, 14], [213, 14]], { faint: off });
  return off;
}

// The summing bar (x 218), the limits and u.
function output(s, p, top, bottom, signs, yOut) {
  s.bar({ x: 218, y: (top + bottom) / 2, w: 10, h: bottom - top, signs, yOut });
  s.wire([[223, yOut], [230, yOut]]);
  const lim = limitsText(p.umin, p.umax);
  s.sat({ x: 241, y: yOut, w: 22, h: 18, faint: !lim, tip: lim ? `Actuator limits: u stays within ${lim}` : 'No actuator limits' });
  // Over the limits, clear of the bar.
  const t = lim ?? 'no limit';
  s.note({ x: Math.max(241, 225 + ([...t].length * NOTE_CHAR) / 2), y: yOut - 15, text: t, anchor: 'middle', faint: !lim });
  s.wire([[252, yOut], [261, yOut]]);
  s.port({ x: 263, y: yOut, text: 'u', anchor: 'start' });
  return !lim;
}

// Anti-windup, from the limits back to the integrator block whose bottom
// centre is (ix, iy), along the row y. tts: the tracking times in use (one,
// or one per point of a schedule); rule: how Tt 0 is chosen.
function antiWindup(s, p, ix, iy, y, yOut, noLimits, tts, rule) {
  const aw = p.aw ?? 'clamp';
  const faint = noLimits;
  if (aw === 'off') {
    s.note({ x: ix, y, text: 'no anti-windup: ∫ winds up', anchor: 'middle', cls: 'warn', faint, tip: 'Anti-windup off: while u sits at a limit the integral keeps growing, and the loop overshoots until it has unwound' });
    return;
  }
  if (aw === 'back') {
    const tt = secsRange(tts);
    s.wire([[241, yOut + 9], [241, y], [229, y]], { faint });
    s.block({ x: 214, y, w: 30, h: 16, lines: [[['1/Tt', 'k']]], faint, tip: `Back-calculation: the integral is pulled toward the limit by (u − v)/Tt, Tt ${tt}${p.Tt > 0 ? '' : ` (${rule})`}; a feedforward's own excess beyond a limit is left out` });
    s.wire([[199, y], [ix, y], [ix, iy]], { faint });
    s.note({ x: 245, y: (yOut + y) / 2, text: 'u−v', anchor: 'start', faint });
    s.note({ x: 214, y: y + 16, text: `${ANTI_WINDUP.back}, Tt ${tt}`, anchor: 'middle', faint });
    return;
  }
  s.wire([[241, yOut + 9], [241, y], [ix, y], [ix, iy]], { dashed: true, faint, tip: 'Clamping (conditional integration): the integral stops while u sits at a limit and the error pushes further' });
  s.note({ x: (ix + 241) / 2, y: y + 10, text: `${ANTI_WINDUP.clamp}: ∫ holds at a limit`, anchor: 'middle', faint });
}

function pid(p, { inputs, Ts }) {
  const s = sheet('PID', DIAGRAM_WIDTH, 144);
  // A gain at 0 is off (faint); one not computed yet (NaN, a design pending) is not.
  const P = p.Kp !== 0, I = p.Ki !== 0, Dd = p.Kd !== 0;
  reference(s, p, 40);
  const ffOff = feedforward(s, p, 40);
  // P: b·rf − y, then Kp.
  s.wire([[70, 40], [78, 40]], { faint: !P || !p.b });
  s.block({ x: 90, y: 40, w: 24, h: 16, lines: [kv('b', fmt(p.b))], faint: !P || !p.b, tip: 'Setpoint weight b: how much of r the P part sees (two degrees of freedom). It softens the answer to a change of r without changing the loop; it is not feedforward' });
  s.wire([[102, 40], [109, 40]], { faint: !P });
  s.sum({ x: 114, y: 40, r: 5, signs: { w: '+', s: '−' }, faint: !P });
  s.wire([[119, 40], [122, 40]], { faint: !P });
  s.block({ x: 144, y: 40, w: 44, h: 16, lines: [kv('Kp', fmt(p.Kp))], faint: !P, tip: 'Proportional gain Kp' });
  s.wire([[166, 40], [213, 40]], { faint: !P });
  // The measurement: to P, to the error and to D. It crosses the reference's branch.
  s.port({ x: 4, y: 66, text: 'y', anchor: 'start', tip: `Measurement: ${inputs[1] ?? 'not connected'}` });
  s.line([[12, 66], [114, 66]], { over: true, faint: !(P || I || Dd) });
  s.line([[114, 66], [132, 66]], { faint: !(I || Dd) });
  s.wire([[132, 66], [147, 66]], { faint: !Dd });
  s.dot({ x: 114, y: 66, faint: !P });
  s.dot({ x: 132, y: 66, faint: !I || !Dd });
  s.wire([[114, 66], [114, 45]], { faint: !P });
  s.wire([[132, 66], [132, 87]], { faint: !I });
  s.block({ x: 177, y: 66, w: 60, h: 26, lines: [[['d/dt ', ''], ...kv('Kd', fmt(p.Kd))], kv('Tf', secs(p.Tf))], faint: !Dd, tip: 'D on the measurement, filtered: Kd·dy/dt through a lag Tf, subtracted at the sum, so a step of r gives no kick' });
  s.wire([[207, 66], [213, 66]], { faint: !Dd });
  // I: the error rf − y, integrated.
  s.wire([[70, 40], [70, 92], [127, 92]], { faint: !I });
  s.sum({ x: 132, y: 92, r: 5, signs: { w: '+', n: '−' }, faint: !I });
  s.wire([[137, 92], [142, 92]], { faint: !I });
  // A start output u0 is a second line, below: the block grows downward.
  const iy = p.u0 ? 110 : 100;
  s.block({ x: 168, y: p.u0 ? 97 : 92, w: 52, h: p.u0 ? 26 : 16, lines: [[['∫ ', ''], ...kv('Ki', fmt(p.Ki))], ...(p.u0 ? [kv('u0', fmt(p.u0))] : [])], faint: !I, tip: `Integral gain Ki on the error rf − y; it starts at u0 ${fmt(p.u0)}` });
  s.wire([[194, 92], [213, 92]], { faint: !I });
  const noLimits = output(s, p, 6, 100, [[14, ffOff ? '' : '+'], [40, '+'], [66, '−'], [92, '+']], 53);
  if (I) antiWindup(s, p, 168, iy, 120, 53, noLimits, [Number.isNaN(p.Ki) ? NaN : trackingTime(p, Ts)], '√(Ti·Td), or Ti/2 without D');
  return s.done();
}

function gainScheduled(p, { inputs, Ts }) {
  const s = sheet('Gain-scheduled PI', DIAGRAM_WIDTH, 144);
  const I = p.Ki.some((v) => v !== 0);
  reference(s, p, 44);
  const ffOff = feedforward(s, p, 44);
  s.wire([[70, 44], [95, 44]]);
  s.sum({ x: 100, y: 44, r: 5, signs: { w: '+', s: '−' } });
  s.wire([[105, 44], [112, 44]]);
  // A start output u0 is a third line (the block grows by one; its second
  // line stays on the wire).
  const bottom = p.u0 ? 63 : 58;
  s.block({ x: 159, y: 44, w: 94, h: p.u0 ? 38 : 28, lines: [kv('Kp(y)', range(p.Kp)), [['∫ ', ''], ...kv('Ki(y)', range(p.Ki))], ...(p.u0 ? [kv('u0', fmt(p.u0))] : [])], tip: `A PI on the error, Kp and Ki looked up from the measurement y (interpolated between the points of the table); the integral starts at u0 ${fmt(p.u0)}` });
  s.wire([[206, 44], [213, 44]]);
  s.port({ x: 4, y: 92, text: 'y', anchor: 'start', tip: `Measurement: ${inputs[1] ?? 'not connected'}` });
  s.line([[12, 92], [100, 92]]);
  s.dot({ x: 100, y: 92 });
  s.wire([[100, 92], [100, 49]]);
  s.wire([[100, 92], [116, 92]]);
  s.block({ x: 146, y: 92, w: 60, h: 26, lines: [[['table', 'k']], [[`y ${range(p.at)}`, 'v']]], tip: `The schedule: Kp and Ki at y = ${p.at.map(fmt).join(', ')}` });
  // The schedule sets the gains: dotted, unlike the anti-windup's dashed line.
  s.wire([[146, 79], [146, bottom]], { dotted: true, tip: 'The table sets Kp and Ki' });
  s.note({ x: 142, y: (79 + bottom) / 2, text: 'Kp, Ki', anchor: 'end' });
  const noLimits = output(s, p, 6, 52, [[14, ffOff ? '' : '+'], [44, '+']], 29);
  // Tt 0: Ti/2 at each point of the schedule (Ti = Kp/Ki there).
  const tts = p.at.map((_, i) => (Number.isNaN(p.Ki[i]) ? NaN : trackingTime({ Kp: p.Kp[i], Ki: p.Ki[i], Kd: 0, Tt: p.Tt }, Ts))).filter((t, i) => p.Ki[i] !== 0);
  if (I) antiWindup(s, p, 186, bottom, 120, 29, noLimits, tts, 'Ti/2 at each point of the schedule, Ti = Kp/Ki');
  return s.done();
}

function stateFeedback(p, { inputs }) {
  const m = p.K.length;
  const rowY = (i) => 40 + 16 * i;
  const s = sheet('State feedback', DIAGRAM_WIDTH, rowY(m - 1) + 16);
  s.port({ x: 4, y: 14, text: 'r', anchor: 'start' });
  s.wire([[12, 14], [16, 14]]);
  s.block({ x: 39, y: 14, w: 46, h: 16, lines: [kv('Tr', p.Tr > 0 ? secs(p.Tr) : '0')], faint: !(p.Tr > 0), tip: 'Prefilter (Vorfilter) on r; 0 is off' });
  s.wire([[62, 14], [74, 14]], { faint: p.kr === 0 });
  s.block({ x: 100, y: 14, w: 52, h: 16, lines: [kv('kr', fmt(p.kr))], faint: p.kr === 0, tip: 'Static prefilter kr: scales r so the output settles at r' });
  s.wire([[126, 14], [191, 14]], { faint: p.kr === 0 });
  s.sum({ x: 196, y: 14, r: 5, signs: { w: '+', s: '−' } });
  const top = rowY(0) - 8, bottom = rowY(m - 1) + 8, mid = (top + bottom) / 2;
  for (let i = 0; i < m; i++) {
    const y = rowY(i), off = p.K[i] === 0;
    s.port({ x: 4, y, text: short(inputs[i + 1] ?? `y${i + 1}`), anchor: 'start', faint: off, tip: `Input ${i + 2}: ${inputs[i + 1] ?? 'not connected'}` });
    s.wire([[58, y], [74, y]], { faint: off });
    s.block({ x: 100, y, w: 52, h: 14, lines: [kv(`K${i + 1}`, fmt(p.K[i]))], faint: off });
    s.wire([[126, y], [149, y]], { faint: off });
  }
  s.bar({ x: 153, y: mid, w: 8, h: bottom - top, signs: [], yOut: mid, label: false });
  s.wire([[157, mid], [196, mid], [196, 19]]);
  s.note({ x: 192, y: mid - 7, text: 'K·y', anchor: 'end' });
  s.wire([[201, 14], [212, 14]]);
  const lim = limitsText(p.umin, p.umax);
  s.sat({ x: 223, y: 14, w: 22, h: 18, faint: !lim, tip: lim ? `Actuator limits: u stays within ${lim}` : 'No actuator limits' });
  const lt = lim ?? 'no limit';
  s.note({ x: Math.max(223, 207 + ([...lt].length * NOTE_CHAR) / 2), y: 31, text: lt, anchor: 'middle', faint: !lim });
  s.wire([[234, 14], [252, 14]]);
  s.port({ x: 254, y: 14, text: 'u', anchor: 'start' });
  return s.done();
}

function swingUp(p, { inputs }) {
  const s = sheet('Swing-up + state feedback', DIAGRAM_WIDTH, 124);
  const th = inputs[2] ?? 'θ';
  s.port({ x: 4, y: 24, text: 'y', anchor: 'start', tip: `Measurements: ${inputs.slice(1).join(', ') || 'x, θ, v, ω'}` });
  s.wire([[12, 24], [55, 24]]);
  s.dot({ x: 34, y: 24 });
  s.wire([[34, 24], [34, 72], [55, 72]]);
  s.port({ x: 4, y: 90, text: 'r', anchor: 'start' });
  s.wire([[12, 90], [55, 90]]);
  s.block({ x: 125, y: 24, w: 140, h: 38, lines: [[['pump ', 'k'], ['kE·E·ω·cos θ', '']], [['− kx·x − kv·v', '']], [...kv('kE', fmt(p.kE)), ...kv('  kx', fmt(p.kx)), ...kv('  kv', fmt(p.kv))]], tip: 'Energy pumping (a Lyapunov design): E = ½l²ω² + gl(cos θ − 1) is 0 upright; this push makes ½E² fall, so each swing climbs higher, while kx, kv keep the cart near the middle' });
  s.block({ x: 125, y: 80, w: 140, h: 38, lines: [[['catch ', 'k'], ['kr·r − K·y', '']], kv('K', p.K.map(fmt).join(' ')), kv('kr', fmt(p.kr))], tip: 'Near the top: state feedback on x, θ, v, ω holds the pole upright' });
  s.line([[195, 24], [202, 24], [202, 40], [206, 40]]);
  s.line([[195, 80], [202, 80], [202, 64], [206, 64]]);
  s.switch({ a: [208, 40], b: [208, 64], pivot: [224, 52], to: 'a', tip: `Switches to the catch when |${th}| < ${fmt(p.thetaS)} rad, back to pumping when |${th}| > ${fmt(2 * p.thetaS)} rad (hysteresis)` });
  s.wire([[224, 52], [232, 52]]);
  const lim = limitsText(p.umin, p.umax);
  s.sat({ x: 243, y: 52, w: 20, h: 18, faint: !lim });
  s.note({ x: 243, y: 37, text: lim ?? 'no limit', anchor: 'middle', faint: !lim });
  s.wire([[253, 52], [261, 52]]);
  s.port({ x: 263, y: 52, text: 'u', anchor: 'start' });
  s.note({ x: 135, y: 114, text: `catch when |${short(th, 6)}| < ${fmt(p.thetaS)} rad, pump above ${fmt(2 * p.thetaS)} rad`, anchor: 'middle' });
  return s.done();
}

function relay(p) {
  const s = sheet('Relay', DIAGRAM_WIDTH, 76);
  s.port({ x: 4, y: 26, text: 'r', anchor: 'start' });
  s.wire([[12, 26], [51, 26]]);
  s.sum({ x: 56, y: 26, r: 5, signs: { w: '+', s: '−' } });
  s.port({ x: 4, y: 56, text: 'y', anchor: 'start' });
  s.wire([[12, 56], [56, 56], [56, 31]]);
  s.wire([[61, 26], [80, 26]]);
  s.relay({ x: 100, y: 26, w: 40, h: 24, tip: `Relay with hysteresis: +d when e > ε, −d when e < −ε, else as before (d ${fmt(p.d)}, ε ${fmt(p.eps)})` });
  s.note({ x: 100, y: 7, text: `±d ${fmt(p.d)}   ε ${fmt(p.eps)}`, anchor: 'middle' });
  s.wire([[120, 26], [150, 26]]);
  s.sum({ x: 155, y: 26, r: 5, signs: { w: '+', s: '+' } });
  s.block({ x: 155, y: 56, w: 40, h: 16, lines: [kv('u0', fmt(p.u0))], faint: !p.u0, tip: 'Bias u0: the relay swings about it' });
  s.wire([[155, 48], [155, 31]], { faint: !p.u0 });
  s.wire([[160, 26], [196, 26]]);
  const lim = limitsText(p.umin, p.umax);
  s.sat({ x: 207, y: 26, w: 22, h: 18, faint: !lim });
  s.note({ x: 207, y: 46, text: lim ?? 'no limit', anchor: 'middle', faint: !lim });
  s.wire([[218, 26], [252, 26]]);
  s.port({ x: 254, y: 26, text: 'u', anchor: 'start' });
  return s.done();
}

function off() {
  const s = sheet('Off', DIAGRAM_WIDTH, 56);
  s.port({ x: 4, y: 14, text: 'r', anchor: 'start', faint: true });
  s.port({ x: 4, y: 34, text: 'y', anchor: 'start', faint: true });
  s.line([[12, 14], [60, 14]], { faint: true });
  s.line([[12, 34], [60, 34]], { faint: true });
  s.block({ x: 135, y: 24, w: 60, h: 18, lines: [[['u = 0', 'v']]], tip: 'No control: the plant gets u = 0' });
  s.wire([[165, 24], [252, 24]]);
  s.port({ x: 254, y: 24, text: 'u', anchor: 'start' });
  s.note({ x: 135, y: 48, text: 'nothing reads r or y: the plant runs on its own', anchor: 'middle' });
  return s.done();
}

// An observer predicts with its model, then corrects with the measurements.
// n, m: the states and measurements (NaN: not known yet); lines: the notes
// under it for a Kalman filter.
function estimator(p, { inputs }, kind, { n = p.B.length, m = p.C.length / p.B.length, lines = [] } = {}) {
  const s = sheet(kind === 'kalman' ? 'Kalman filter' : 'Luenberger observer', DIAGRAM_WIDTH, 95 + 11 * (kind === 'kalman' ? lines.length : 1));
  s.port({ x: 4, y: 36, text: 'u', anchor: 'start', tip: `Plant input: ${inputs[0] ?? 'not connected'}` });
  s.wire([[12, 36], [24, 36]]);
  s.block({ x: 74, y: 36, w: 100, h: 28, lines: [[['predict', 'k']], [['Ad·x̂ + Bd·u', '']]], tip: 'Predict: the model, discretised at Ts, carries the estimate one sample ahead with the input u' });
  s.wire([[124, 36], [140, 36]]);
  s.block({ x: 190, y: 36, w: 100, h: 28, lines: [[['correct', 'k']], [['+ L·(y − C·x̂)', '']]], tip: 'Correct: the estimate moves toward the measurements by the gain L times what the model did not predict' });
  s.wire([[240, 36], [252, 36]]);
  s.dot({ x: 246, y: 36 });
  s.port({ x: 254, y: 36, text: 'x̂', anchor: 'start', tip: Number.isNaN(n) ? 'the estimated states' : `${n} estimated states` });
  s.wire([[246, 36], [246, 9], [165, 9]]);
  s.block({ x: 150, y: 9, w: 30, h: 13, lines: [[['z⁻¹', '']]], tip: 'The estimate of the sample before' });
  s.wire([[135, 9], [74, 9], [74, 22]]);
  s.port({ x: 4, y: 70, text: 'y', anchor: 'start', tip: `Measurements: ${inputs.slice(1).join(', ') || 'none'}` });
  s.wire([[12, 70], [190, 70], [190, 50]]);
  s.note({ x: 4, y: 87, text: `${Number.isNaN(n) ? 'the states it sees' : `${n} state${n === 1 ? '' : 's'}`}, ${m} measurement${m === 1 ? '' : 's'}`, anchor: 'start' });
  if (kind === 'kalman') lines.forEach((text, i) => s.note({ x: 4, y: 98 + 11 * i, text, anchor: 'start' }));
  else s.note({ x: 4, y: 98, text: `L ${p.L.map(fmt).join(' ')}`, anchor: 'start' });
  return s.done();
}

function difference(p, { inputs }) {
  const s = sheet('Finite difference', DIAGRAM_WIDTH, 76);
  s.port({ x: 4, y: 20, text: 'y', anchor: 'start', tip: `Measurements: ${inputs.slice(1).join(', ') || 'none'}` });
  s.wire([[12, 20], [252, 20]]);
  s.port({ x: 254, y: 20, text: 'y', anchor: 'start' });
  s.dot({ x: 40, y: 20 });
  s.wire([[40, 20], [40, 50], [70, 50]]);
  s.block({ x: 100, y: 50, w: 60, h: 16, lines: [[['Δy / Ts', '']]], tip: 'The rate: the change of each measurement over one sample' });
  s.wire([[130, 50], [155, 50]]);
  s.block({ x: 190, y: 50, w: 70, h: 16, lines: [kv('lag', p.Tf > 0 ? secs(p.Tf) : '0')], faint: !(p.Tf > 0), tip: 'A first-order low-pass on the rate; 0 is off' });
  s.wire([[225, 50], [252, 50]]);
  s.port({ x: 254, y: 50, text: 'ẏ', anchor: 'start' });
  s.note({ x: 4, y: 68, text: 'a quantised or noisy y makes the rate jump', anchor: 'start' });
  return s.done();
}

// A type without its own picture: one block with what it does.
function generic(v, def) {
  const s = sheet(def?.label ?? v.type, DIAGRAM_WIDTH, 60);
  s.port({ x: 4, y: 20, text: 'r', anchor: 'start' });
  s.port({ x: 4, y: 40, text: 'y', anchor: 'start' });
  s.wire([[12, 20], [40, 20], [40, 26], [58, 26]]);
  s.wire([[12, 40], [40, 40], [40, 34], [58, 34]]);
  s.block({ x: 140, y: 30, w: 164, h: 30, lines: [[[def?.label ?? v.type, 'k']], [[def?.summary ?? '', '']]] });
  s.wire([[222, 30], [252, 30]]);
  s.port({ x: 254, y: 30, text: 'u', anchor: 'start' });
  return s.done();
}

// The sliding variable s = λ·e + ė from r (prefiltered), y and ẏ, on the row
// y0; returns the x where s leaves its sum. Shared by both sliding-mode laws.
function slidingSurface(s, p, inputs, y0) {
  s.port({ x: 4, y: y0, text: 'r', anchor: 'start' });
  s.wire([[12, y0], [16, y0]]);
  s.block({ x: 39, y: y0, w: 46, h: 16, lines: [kv('Tr', p.Tr > 0 ? secs(p.Tr) : '0')], faint: !(p.Tr > 0), tip: 'Prefilter (Vorfilter) on r; its own derivative ṙf = (r − rf)/Tr goes into ė, so the law never differentiates; 0 is off' });
  s.wire([[62, y0], [77, y0]]);
  s.sum({ x: 82, y: y0, r: 5, signs: { w: '+', s: '−' } });
  const y = short(inputs[1] ?? 'y'), dy = short(inputs[2] ?? 'ẏ');
  // A port's name is about 6.6 px a character; its line starts just after it.
  const after = (t) => Math.ceil(4 + [...t].length * 6.6 + 3);
  s.port({ x: 4, y: y0 + 26, text: y, anchor: 'start', tip: `Measurement y: ${inputs[1] ?? 'not connected'}` });
  s.line([[after(y), y0 + 26], [82, y0 + 26]]);
  s.wire([[82, y0 + 26], [82, y0 + 5]]);
  s.wire([[87, y0], [96, y0]]);
  s.block({ x: 112, y: y0, w: 32, h: 16, lines: [kv('λ', fmt(p.lambda))], faint: !p.lambda, tip: `Surface slope λ ${fmt(p.lambda)} 1/s: on the line s = 0 the error decays as e^(−λt), whatever the inertia` });
  s.wire([[128, y0], [137, y0]]);
  s.sum({ x: 142, y: y0, r: 5, signs: { w: '+', s: '−' } });
  s.port({ x: 4, y: y0 + 46, text: dy, anchor: 'start', tip: `The rate ẏ, input 3: ${inputs[2] ?? 'not connected'} (ė = ṙf − ẏ)` });
  s.line([[after(dy), y0 + 46], [142, y0 + 46]]);
  s.wire([[142, y0 + 46], [142, y0 + 5]]);
  s.note({ x: 148, y: y0 - 6, text: 's', anchor: 'start' });
  return 147;
}

function slidingMode(p, { inputs }) {
  const s = sheet('Sliding mode', DIAGRAM_WIDTH, 112);
  const y0 = 22, x = slidingSurface(s, p, inputs, y0), relayLaw = !(p.phi > 0);
  s.wire([[x, y0], [154, y0]]);
  if (relayLaw) s.relay({ x: 172, y: y0, w: 34, h: 22, tip: 'sign(s): +1 above the line, −1 below; it switches every sample it crosses' });
  else s.block({ x: 174, y: y0, w: 40, h: 26, lines: [[['sat', 'k']], kv('φ', fmt(p.phi))], tip: `Boundary layer: s/φ inside |s| < φ ${fmt(p.phi)}, ±1 outside` });
  if (relayLaw) s.note({ x: 172, y: 6, text: 'sign', anchor: 'middle' });
  s.wire([[relayLaw ? 189 : 194, y0], [200, y0]]);
  s.block({ x: 218, y: y0, w: 36, h: p.u0 ? 26 : 16, lines: [kv('K', fmt(p.K)), ...(p.u0 ? [kv('+', fmt(p.u0))] : [])], tip: `Switching gain K ${fmt(p.K)}${p.u0 ? `, plus the bias u0 ${fmt(p.u0)}` : ''}` });
  s.wire([[236, y0], [240, y0]]);
  const lim = limitsText(p.umin, p.umax);
  s.sat({ x: 250, y: y0, w: 18, h: 16, faint: !lim, tip: lim ? `Actuator limits: u stays within ${lim}` : 'No actuator limits' });
  s.note({ x: 250, y: y0 + 18, text: lim ?? 'no limit', anchor: 'middle', faint: !lim });
  s.wire([[259, y0], [262, y0]], { arrow: false });
  s.port({ x: 263, y: y0, text: 'u', anchor: 'start' });
  s.note({ x: 4, y: 88, text: `s = λ·e + ė; on s = 0, e decays with 1/λ ${p.lambda > 0 ? secs(1 / p.lambda) : '∞'}`, anchor: 'start' });
  s.note({ x: 4, y: 100, text: relayLaw ? 'φ 0: the ideal relay; it chatters' : `inside |s| < φ a PD: Kp ${fmt((p.K * p.lambda) / p.phi)}, Kd ${fmt(p.K / p.phi)}`, anchor: 'start', cls: relayLaw ? 'warn' : '' });
  return s.done();
}

function superTwisting(p, { inputs, Ts }) {
  const s = sheet('Super-twisting', DIAGRAM_WIDTH, 112);
  const y0 = 22, x = slidingSurface(s, p, inputs, y0);
  s.dot({ x: 154, y: y0 });
  s.line([[x, y0], [154, y0]]);
  s.wire([[154, y0], [159, y0]]);
  s.block({ x: 193, y: y0, w: 68, h: 16, lines: [[['√|s| ', ''], ...kv('k1', fmt(p.k1))]], faint: !p.k1, tip: `The proportional part k1·√|s|·sign(s), k1 ${fmt(p.k1)}: continuous, steepest near s = 0` });
  s.wire([[227, y0], [233, y0]]);
  s.wire([[154, y0], [154, 66], [159, 66]]);
  s.block({ x: 193, y: 66, w: 68, h: p.u0 ? 26 : 16, lines: [[['∫ sgn ', ''], ...kv('k2', fmt(p.k2))], ...(p.u0 ? [kv('v0', fmt(p.u0))] : [])], faint: !p.k2, tip: `The integral part v: it rises at k2 ${fmt(p.k2)} by the sign of s (every Ts ${secs(Ts)}), clamped to the limits; it starts at u0 ${fmt(p.u0)} and rejects a constant load` });
  s.wire([[227, 66], [238, 66], [238, y0 + 5]]);
  s.sum({ x: 238, y: y0, r: 5, signs: { w: '+', s: '+' } });
  s.note({ x: 242, y: 50, text: 'v', anchor: 'start' });
  s.wire([[243, y0], [246, y0]], { arrow: false });
  const lim = limitsText(p.umin, p.umax);
  s.sat({ x: 255, y: y0, w: 16, h: 16, faint: !lim, tip: lim ? `Actuator limits: u and v stay within ${lim} (v's clamp is the anti-windup)` : 'No actuator limits' });
  s.note({ x: 255, y: 7, text: lim ?? 'no limit', anchor: 'middle', faint: !lim });
  s.port({ x: 264, y: y0, text: 'u', anchor: 'start' });
  s.note({ x: 4, y: 88, text: `s = λ·e + ė; on s = 0, e decays with 1/λ ${p.lambda > 0 ? secs(1 / p.lambda) : '∞'}`, anchor: 'start' });
  s.note({ x: 4, y: 100, text: 'continuous u; v rejects a constant load', anchor: 'start' });
  return s.done();
}

// ---- Designed types (design/output/designs.md) ---------------------------
// A designed variant runs as its Copy as numbers twin, so it draws as its
// twin with the numbers its design computed (o.values; NaN, drawn '–', while
// none are), and a line under the picture says where they come from.
const UNKNOWN = NaN;
const unknown = (n) => new Array(n).fill(UNKNOWN);
// A line of small text in a row of its own under a picture.
function below(d, text, title = d.title) {
  const room = Math.floor((d.w - 6) / NOTE_CHAR), chars = [...text];
  const cut = chars.length > room ? `${chars.slice(0, room - 1).join('')}…` : text;
  return { ...d, title, h: d.h + 13, nodes: [...d.nodes, { kind: 'note', x: 4, y: d.h + 6, text: cut, anchor: 'start', ...(cut !== text ? { tip: text } : {}) }] };
}
const weights = (p) => `Q ${p.Q.map(fmt).join(' ')}, R ${fmt(p.R)}`;

function lqr(p, o) {
  const v = o.values, m = Math.max(1, o.inputs.length - 1);
  const d = stateFeedback({ K: v?.K ?? unknown(m), kr: v?.kr ?? UNKNOWN, Tr: p.Tr, umin: p.umin, umax: p.umax }, o);
  return below(d, `K, kr: LQR from the plant at its origin, ${weights(p)}`, 'LQR');
}

// The variable gain: state feedback on the error from where y rests at r,
// drawn with the gains near r; the schedule in the lines under it.
function huLin(p, o) {
  const v = o.values, m = Math.max(1, o.inputs.length - 1);
  const K = v ? v.K.slice((v.N - 1) * v.m, v.N * v.m).map((g) => g * p.k) : unknown(m);
  const kr = v ? v.us + K.reduce((s, g, i) => s + g * v.ys[i], 0) : UNKNOWN;
  const d = stateFeedback({ K, kr, Tr: p.Tr, umin: p.umin, umax: p.umax }, o);
  const far = v ? `${fmt(p.k * v.K[0])}` : '–';
  return below(below(d, `K near r; far from r it falls to ${far}… (ε ${fmt(p.low)}), so u stays inside`), `K(ε): LQR from the plant at ${p.levels} levels on nested ellipsoids, ${weights(p)}${p.k > 1 ? `, ×${fmt(p.k)}` : ''}`, 'Variable gain (Hu–Lin)');
}

function scheduledPI(p, o) {
  const v = o.values, n = p.at.length;
  const common = { Tr: p.Tr, Kff: p.Kff, Kv: p.Kv, Ka: p.Ka, u0: v?.u0 ?? 0, umin: p.umin, umax: p.umax, aw: p.aw, Tt: p.Tt };
  const d = n === 1
    ? pid({ Kp: v?.Kp[0] ?? UNKNOWN, Ki: v?.Ki[0] ?? UNKNOWN, Kd: 0, Tf: 0.01, b: 1, ...common }, o)
    : gainScheduled({ at: p.at, Kp: v?.Kp ?? unknown(n), Ki: v?.Ki ?? unknown(n), ...common }, o);
  return below(d, `Kp, Ki, u0 from the plant at y = ${p.at.map(fmt).join(', ')}; Tcl ${secs(p.Tcl)}`, 'PI from the plant');
}

function pidFF(p, o) {
  const v = o.values;
  const d = pid({ Kp: p.Kp, Ki: p.Ki, Kd: p.Kd, Tf: p.Tf, b: p.b, Tr: p.Tr, Kff: v?.Kff ?? UNKNOWN, Kv: v?.Kv ?? UNKNOWN, Ka: v?.Ka ?? UNKNOWN, u0: p.u0, umin: p.umin, umax: p.umax, aw: p.aw, Tt: p.Tt }, o);
  return below(d, `Kff, Kv, Ka: the plant's inverse at its origin, with the PID's Kp (1 − b) and Kd; order ${p.order}`, 'PID + feedforward from the plant');
}

function swingUpLqr(p, o) {
  const v = o.values;
  const d = swingUp({ ...p, K: v?.K ?? unknown(4), kr: v?.kr ?? UNKNOWN }, o);
  return below(d, `K, kr: LQR from the plant, ${weights(p)}; l, g too`, 'Swing-up + LQR catch');
}

// The planned swing-up: the plan's force F(t) ahead, TV-LQR on the error
// from the planned measurements y*(t), the upright LQR after it.
function trajectory(p, { inputs, values }) {
  const v = values, steps = v?.F?.length ?? 0;
  const s = sheet('Planned swing-up + TV-LQR', DIAGRAM_WIDTH, 116);
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < steps; k++) { lo = Math.min(lo, v.F[k]); hi = Math.max(hi, v.F[k]); }
  s.block({ x: 70, y: 20, w: 110, h: 26, lines: [[['plan ', 'k'], ['F(t), y*(t)', '']], [...kv('T', secs(p.T)), ...kv('  seg.', String(p.segments))]], tip: `The plan: the force F(t) that takes the plant from where it starts to rest at the origin in T ${secs(p.T)}, and the measurements y*(t) along it; computed in the page from the plant (${p.segments} segments, multiple shooting), using ${fmt(100 * p.planShare)} % of each force limit` });
  s.wire([[125, 14], [213, 14]]);
  s.note({ x: 132, y: 7, text: 'F(t)', anchor: 'start' });
  s.wire([[100, 33], [100, 55]]);
  s.port({ x: 4, y: 60, text: 'y', anchor: 'start', tip: `Measurements: ${inputs.slice(1).join(', ') || 'none'}` });
  s.wire([[12, 60], [95, 60]]);
  s.sum({ x: 100, y: 60, r: 5, signs: { w: '+', n: '−' } });
  s.wire([[105, 60], [118, 60]]);
  s.block({ x: 148, y: 60, w: 60, h: 16, lines: [[['K(t) ', 'k'], ['TV-LQR', '']]], tip: `Time-varying LQR along the plan (Q ${p.Q.map(fmt).join(' ')}, R ${fmt(p.R)}): it corrects what the plant does off the plan, with the gains of each sample` });
  s.wire([[178, 60], [213, 60]]);
  output(s, p, 6, 68, [[14, '+'], [60, '−']], 37);
  s.note({ x: 4, y: 86, text: 'after T: u = kr·r − K·y, the LQR at the origin', anchor: 'start' });
  s.note({ x: 4, y: 98, text: `u = 0 until ${secs(p.start)}; the plan may use ${fmt(100 * p.planShare)} % of u`, anchor: 'start' });
  s.note({ x: 4, y: 110, text: steps ? `planned from the plant: F ${fmt(lo)}…${fmt(hi)}` : 'planned from the plant: F – (not yet)', anchor: 'start' });
  return s.done();
}

function kalman(p, o) {
  const v = o.values;
  const n = v ? v.B.length : UNKNOWN, m = v ? v.C.length / v.B.length : Math.max(1, o.inputs.length - 1);
  const lines = ['model and L from the plant, at its origin', `Q ${p.Q.map(fmt).join(' ')}  R ${p.R ? p.R.map(fmt).join(' ') : 'from the sensors'}`];
  return estimator(p, o, 'kalman', { n, m, lines });
}

// A Kalman filter on your model: the page computes L from it, Q and R.
function kalmanModel(p, o) {
  const lines = ['L from your model A, B, C, Q and R (Riccati)', `Q ${p.Q.map(fmt).join(' ')}  R ${p.R.map(fmt).join(' ')}`];
  return estimator(p, o, 'kalman', { lines });
}

const LAYOUTS = { pid, pidFF, gainScheduled, stateFeedback, swingUp, relay, slidingMode, superTwisting, off, lqr, huLin, scheduledPI, swingUpLqr, trajectory, kalman, kalmanModel, luenberger: (p, o) => estimator(p, o, 'luenberger'), difference };

// def: the type's library entry, for the generic picture of a type without its own.
export function describeVariant(variant, { inputs = [], Ts = 0.01, def = null, values = null } = {}) {
  const layout = LAYOUTS[variant.type];
  return layout ? layout(variant.params, { inputs, Ts, values }) : generic(variant, def);
}

// The types that have their own picture.
export const DESCRIBED_TYPES = Object.keys(LAYOUTS);
