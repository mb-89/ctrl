// The PUMA 560 following a circle in space (design/output/robot.md): the
// library system built from the robot's data (puma560.js) as a diagram of
// vector blocks. Only inputs are stored: the URDF, the drives as published,
// the start pose, the circle (two references in its own frame), the task
// gains and the speed loops' ω and ζ. The axis gains, the trim and the
// circle's place are computed in the page.
//
// Each motor's drive numbers are on its mask (G, kt, imax, friction), its
// blocks' fields formulas in them. Masks hold numbers, not lists, so the
// controller's model of the six drives (1/(G·kt), G, the friction) and the
// start pose (on the Arm's Integrator and the Constant the circle's frame is
// placed from) are lists on the blocks that use them, until masks take
// lists (robot.md §3).

import { PUMA560 } from './puma560.js';
import { componentUse } from './components.js';

const D = PUMA560.drive, N = 6, DEG = Math.PI / 180;
// The start pose (degrees): the probe's ball on the circle, its stylus 45°
// from the vertical, coming in from outside and looking onto the circle's
// inside (inputs 40, 41, 43). Chosen by a kinematic sweep of the circle
// (robot.md, "The probe"): every joint moves, the wrist stays clear of
// q5 = 0, every joint at least 20° inside its range; joint 6, which turns
// the probe round, starts near one end of its range.
export const PUMA_START = [0, 50.1, -204.6, 38.7, -19, 175];
const Q0 = PUMA_START.map((v) => v * DEG);
const RADIUS = 0.08, PERIOD_S = 10;
// The circle's frame: its a axis points from the circle's centre out to where
// the ball starts (the stylus's lean, reversed), 165.3° about z.
const YAW = 2.8858;
const J = Array.from({ length: N }, (_, j) => j);
const blk = (id, type, params, x, y, name) => ({ id, type, params, x, y, ...(name ? { name } : {}) });
const sink = (id, name, unit, x, y) => blk(id, 'sink', { name, unit }, x, y);
const inp = (id, port, x, y, name) => blk(id, 'inport', { port }, x, y, name);
const outp = (id, port, x, y, name) => blk(id, 'outport', { port }, x, y, name);
const w = (from, to) => ({ from, to });
const R = 'puma560';
const KX = 10, KO = 10;   // the task law's gains (1/s): the error's time constant 0.1 s

// Motor j: the Servo motor (servo.md §7.3, §15.5) on a current drive with
// its limit, from the drive table. Its shaft is rigid: the rotor turns with
// the joint (θm = G·q), its inertia G²·Jm on the Arm's mass matrix, so the
// arm's states stay the arm's; τ_j = G·(kt·i − τ_f). Coulomb friction is
// on (the robot's results assume it); every other effect is off, its
// fields at realistic sizes (research/servo.md §1–2), for the person to
// switch on: ripple 1 % of kt·imax at 6× per motor turn; encoder errors
// 20″ (1×) and 10″ (2×) at the motor; the encoder's counts; the current
// loop at 400 Hz; torque noise 0.002 N·m. The coupled shaft (an elastic
// gear, backlash 3′ ready) is a choice on the mask: its k and c are typed
// for 20 Hz with ζ 0.1 at the start pose, ωr² = k·(1/(G²·Jm) + 1/J_L),
// 2ζ·ωr = c·(1/(G²·Jm) + 1/J_L), J_L the joint's diagonal entry of M(q0)
// without the armature; with it, the Arm's armature must be 0.
const SEC = Math.PI / (180 * 3600);
const COUNTS = [1000, 800, 1000, 1000, 1000, 500];
// k, c (N·m/rad, N·m·s/rad at the joint) for 20 Hz, ζ 0.1 at the start pose.
export const PUMA_GEAR = { k: [9400, 15900, 3510, 26.3, 24.4, 2.35], c: [15, 25.3, 5.59, 0.0418, 0.0389, 0.00375] };
const motorParams = (j) => ({
  drive: 'current', R: D.Ra[j], K: D.kt[j], b: D.B[j], Jm: D.Jm[j], G: D.G[j], imax: D.imax[j], shaft: 'rigid',
  k: PUMA_GEAR.k[j], c: PUMA_GEAR.c[j], beta: 3 * 60 * SEC,
  coulomb: 1, Tcp: D.Tcp[j], Tcn: D.Tcn[j], ws: D.ws,
  kr1: 6, Ar1: Number((0.01 * D.kt[j] * D.imax[j]).toPrecision(3)), Ar2: 0, Ar3: 0, sigma: 0.002, seed: 7 + j,
  tauc: Number((1 / (2 * Math.PI * 400)).toPrecision(4)),
  ke1: 1, Ae1: Number((20 * SEC).toPrecision(4)), pe1: 0.5, ke2: 2, Ae2: Number((10 * SEC).toPrecision(4)), pe2: 1, Ae3: 0, N: COUNTS[j],
});
const motor = (j) => componentUse('servo-motor@1', { id: `m${j + 1}`, name: `Motor ${j + 1}`, prefix: `m${j + 1}_`, params: motorParams(j), x: 200, y: 40 + 100 * j });

// The Arm: M(q)·q̈ = τ − h(q, q̇), rotors on M's diagonal; q̈ integrated
// twice from the start pose; the joint torque and its shares as Sinks.
const arm = {
  id: 'arm', type: 'subsystem', name: 'Arm', x: 420, y: 60,
  diagram: {
    blocks: [
      inp('tau', 1, 20, 60, 'τ'),
      sink('taus', 'tau', 'N·m', 120, 0),
      blk('sum', 'sum', { signs: '+-' }, 120, 64, 'τ − h'),
      blk('solve', 'solve', {}, 230, 60, 'M·q̈ = τ − h'),
      blk('qd', 'integrator', { K: 1, x0: new Array(N).fill(0), unit: 'rad/s' }, 360, 60, 'q̇'),
      blk('q', 'integrator', { K: 1, x0: Q0, unit: 'rad', angle: 1 }, 480, 60, 'q'),
      outp('oq', 1, 620, 60, 'q'), outp('oqd', 2, 620, 120, 'q̇'),
      blk('M', 'massMatrix', { robot: R, armature: PUMA560.armature }, 230, 160, 'Mass matrix'),
      blk('h', 'biasForces', { robot: R }, 120, 160, 'Bias forces'),
      blk('lims', 'jointLimits', { robot: R }, 620, 200, 'Joint limits'),
      blk('split', 'torqueSplit', { robot: R, armature: PUMA560.armature }, 360, 240, 'Torque split'),
      sink('ti', 'tauI', 'N·m', 500, 220), sink('tc', 'tauC', 'N·m', 500, 260), sink('tg', 'tauG', 'N·m', 500, 300),
      sink('qq', 'q', 'rad', 620, 10),
    ],
    wires: [
      w('tau', 'sum'), w('tau', 'taus'), w('h', 'sum:1'), w('M', 'solve'), w('sum', 'solve:1'), w('solve', 'qd'), w('qd', 'q'),
      w('q', 'oq'), w('qd', 'oqd'), w('q', 'qq'),
      w('q', 'M'), w('q', 'h'), w('qd', 'h:1'), w('q', 'lims'), w('qd', 'lims:1'),
      w('q', 'split'), w('qd', 'split:1'), w('solve', 'split:2'), w('split', 'ti'), w('split:1', 'tc'), w('split:2', 'tg'),
    ],
  },
};

const puma = {
  id: 'puma', type: 'subsystem', name: 'PUMA 560', x: 640, y: 140,
  diagram: {
    blocks: [
      inp('i', 1, 20, 60, 'i*'),
      {
        id: 'drives', type: 'subsystem', name: 'Motor drives', x: 160, y: 50,
        diagram: {
          blocks: [
            inp('i', 1, 20, 200, 'i*'), inp('qd', 2, 20, 320, 'q̇'), inp('q', 3, 20, 440, 'q'),
            blk('di', 'demux', { sizes: '1,1,1,1,1,1' }, 100, 200), blk('dq', 'demux', { sizes: '1,1,1,1,1,1' }, 100, 320), blk('dqq', 'demux', { sizes: '1,1,1,1,1,1' }, 100, 440),
            ...J.map(motor),
            blk('mx', 'mux', { inputs: '6' }, 520, 200), outp('tau', 1, 620, 200, 'τ'),
            blk('mq', 'mux', { inputs: '6' }, 520, 400, 'the encoders'), outp('qm', 2, 620, 400, 'q measured'),
          ],
          wires: [w('i', 'di'), w('qd', 'dq'), w('q', 'dqq'), ...J.flatMap((j) => [w(`di:${j}`, `m${j + 1}`), w(`dqq:${j}`, `m${j + 1}:1`), w(`dq:${j}`, `m${j + 1}:2`), w(`m${j + 1}`, `mx:${j}`), w(`m${j + 1}:1`, `mq:${j}`)]), w('mx', 'tau'), w('mq', 'qm')],
        },
      },
      arm,
      outp('q', 1, 620, 60, 'q'), outp('qm', 2, 620, 120, 'q measured'),
    ],
    // The tool's pose reads the true q (Out 1); the controller reads the
    // motors' encoders (Out 2), as on the real arm.
    wires: [w('i', 'drives'), w('drives', 'arm'), w('arm:1', 'drives:1'), w('arm', 'drives:2'), w('arm', 'q'), w('drives:1', 'qm')],
  },
};

// The circle in its own frame: a_r, b_r and their derivatives, joined with
// c = 0, placed in the base by the Frame transform "base ← circle". The
// tool's orientation R_d is its start orientation R0 turned about the
// circle's axis by the circle's phase φ (cos φ = (a_r + R)/R, sin φ = b_r/R;
// R on the mask): R_d = Rz(φ)·R0, so the stylus looks onto the inside all
// the way round; ω_d = φ̇·ẑ and α_d = φ̈·ẑ are its feedforward.
const ref = {
  id: 'ref', type: 'subsystem', name: 'Circle reference', x: 140, y: 60,
  mask: [{ key: 'R', label: 'Radius (the sines\' amplitude)', unit: 'm' }], params: { R: RADIUS },
  diagram: {
    blocks: [
      inp('R0', 2, 160, 420, 'R0'),
      blk('dir', 'fcn', {
        inputs: 'a, b, va, vb, aa, ab',
        eqs: ['c = (a + R)/R', 's = b/R', 'w = (c*vb - s*va)/R', 'dw = (c*ab - s*aa)/R', 'ns = -s', 'o = 0', 'l = 1'].join('\n'),
        outputs: 'c, ns, o, s, l, w, dw',
      }, 320, 330, 'the circle\'s phase'),
      blk('mz', 'mux', { inputs: '9' }, 440, 300, 'Rz(φ)'), blk('rd', 'product', { inner: 3 }, 520, 330, 'R_d = Rz(φ)·R0'),
      blk('mw', 'mux', { inputs: '3' }, 440, 380, 'ω_d'), blk('mal', 'mux', { inputs: '3' }, 440, 440, 'α_d'),
      outp('Rd', 4, 620, 330, 'R_d'), outp('wd', 5, 620, 380, 'ω_d'), outp('ald', 6, 620, 440, 'α_d'),
      blk('a', 'source', { signal: 'a_r', unit: 'm', derivatives: 2 }, 20, 40),
      blk('b', 'source', { signal: 'b_r', unit: 'm', derivatives: 2 }, 20, 140),
      blk('zero', 'constant', { value: 0, unit: 'm' }, 20, 240),
      blk('mp', 'mux', { inputs: '3' }, 160, 40, 'p_c'), blk('mv', 'mux', { inputs: '3' }, 160, 140, 'v_c'), blk('ma', 'mux', { inputs: '3' }, 160, 240, 'a_c'),
      inp('o', 1, 160, 330, 'origin'),
      blk('frame', 'frameTransform', { rpy: [0, 0, YAW], groups: 'p,v,a', inverse: 0 }, 300, 130, 'base ← circle'),
      outp('p', 1, 460, 100, 'p_d'), outp('v', 2, 460, 150, 'v_d'), outp('acc', 3, 460, 200, 'a_d'),
    ],
    wires: [
      w('a', 'mp'), w('b', 'mp:1'), w('zero', 'mp:2'), w('a:1', 'mv'), w('b:1', 'mv:1'), w('zero', 'mv:2'), w('a:2', 'ma'), w('b:2', 'ma:1'), w('zero', 'ma:2'),
      w('mp', 'frame'), w('mv', 'frame:1'), w('ma', 'frame:2'), w('o', 'frame:3'),
      w('frame', 'p'), w('frame:1', 'v'), w('frame:2', 'acc'),
      w('a', 'dir'), w('b', 'dir:1'), w('a:1', 'dir:2'), w('b:1', 'dir:3'), w('a:2', 'dir:4'), w('b:2', 'dir:5'),
      // Rz(φ) row by row: c −s 0 / s c 0 / 0 0 1.
      w('dir', 'mz'), w('dir:1', 'mz:1'), w('dir:2', 'mz:2'), w('dir:3', 'mz:3'), w('dir', 'mz:4'), w('dir:2', 'mz:5'), w('dir:2', 'mz:6'), w('dir:2', 'mz:7'), w('dir:4', 'mz:8'),
      w('mz', 'rd'), w('R0', 'rd:1'), w('rd', 'Rd'),
      w('dir:2', 'mw'), w('dir:2', 'mw:1'), w('dir:5', 'mw:2'), w('dir:2', 'mal'), w('dir:2', 'mal:1'), w('dir:6', 'mal:2'),
      w('mw', 'wd'), w('mal', 'ald'),
    ],
  },
};

// The robot controller (robot.md §5): the encoder's speed, the task law on
// the measured pose, the damped inverse to speed and acceleration targets
// per axis, the model's torque feedforward, six PI speed loops, torque to
// current.
const lanesLimit = J.map((j) => Math.abs(D.G[j]) * D.kt[j] * D.imax[j]);
const ctl = {
  id: 'ctl', type: 'subsystem', name: 'Robot controller', x: 380, y: 140,
  diagram: {
    blocks: [
      inp('q', 1, 20, 300, 'q'), inp('pd', 2, 20, 40, 'p_d'), inp('vd', 3, 20, 90, 'v_d'), inp('ad', 4, 20, 140, 'a_d'), inp('zd', 5, 20, 190, 'R_d'), inp('wd', 6, 20, 210, 'ω_d'), inp('ald', 7, 20, 230, 'α_d'),
      { id: 'enc', type: 'observer', name: 'Encoder speed', params: { inputs: 2, outputs: 2, Ts: 0.001 }, variants: [{ name: 'Finite difference', type: 'difference', params: { Tf: 0 } }], variant: 0, x: 100, y: 290 },
      {
        id: 'axes', type: 'subsystem', name: 'Axes → task', x: 230, y: 280,
        diagram: {
          blocks: [
            inp('q', 1, 20, 40, 'q'), inp('qd', 2, 20, 160, 'q̇'),
            blk('fk', 'forwardKinematics', { robot: R }, 140, 30, 'Forward kinematics'),
            blk('jac', 'jacobian', { robot: R }, 140, 100, 'Jacobian'),
            blk('jdq', 'jdotqd', { robot: R }, 140, 170, 'J̇q̇'),
            blk('v', 'product', {}, 280, 120, 'v = J·q̇'),
            outp('p', 1, 420, 20, 'p'), outp('R', 2, 420, 60, 'R'), outp('ov', 3, 420, 110, 'v'), outp('J', 4, 420, 150, 'J'), outp('Jd', 5, 420, 190, 'J̇q̇'),
          ],
          wires: [w('q', 'fk'), w('q', 'jac'), w('q', 'jdq'), w('qd', 'jdq:1'), w('jac', 'v'), w('qd', 'v:1'),
            w('fk', 'p'), w('fk:1', 'R'), w('v', 'ov'), w('jac', 'J'), w('jdq', 'Jd')],
        },
      },
      {
        id: 'law', type: 'subsystem', name: 'Task law', x: 380, y: 60,
        diagram: {
          blocks: [
            inp('pd', 1, 20, 20, 'p_d'), inp('vd', 2, 20, 70, 'v_d'), inp('ad', 3, 20, 120, 'a_d'), inp('zd', 4, 20, 170, 'R_d'),
            inp('wd', 5, 20, 370, 'ω_d'), inp('ald', 6, 20, 420, 'α_d'),
            inp('p', 7, 20, 220, 'p'), inp('R', 8, 20, 270, 'R'), inp('v', 9, 20, 320, 'v'),
            blk('ep', 'sum', { signs: '+-' }, 120, 24, 'e_p = p_d − p'),
            blk('eo', 'orientationError', {}, 120, 180, 'Orientation error'),
            blk('vw', 'sum', { signs: '++' }, 320, 190, 'ω_d + k_o·e'),
            blk('ew', 'sum', { signs: '+-' }, 220, 380, 'ω_d − ω'), blk('aw', 'sum', { signs: '++' }, 380, 400, 'α_d + k_o·(ω_d − ω)'),
            blk('dv', 'demux', { sizes: '3,3' }, 120, 320),
            blk('kx', 'gain', { K: KX }, 220, 20, 'k_x'), blk('vl', 'sum', { signs: '++' }, 320, 30),
            blk('ko', 'gain', { K: KO }, 220, 180, 'k_o'), blk('vs', 'mux', { inputs: '3,3' }, 420, 60, 'v*'),
            blk('ev', 'sum', { signs: '+-' }, 220, 90, 'v_d − v'), blk('kv', 'gain', { K: KX }, 300, 90, 'k_x'), blk('al', 'sum', { signs: '++' }, 380, 120),
            blk('kw', 'gain', { K: KO }, 300, 380, 'k_o'), blk('as', 'mux', { inputs: '3,3' }, 470, 160, 'a*'),
            outp('ovs', 1, 560, 60, 'v*'), outp('oas', 2, 560, 160, 'a*'), outp('th', 3, 560, 240, 'θ'),
          ],
          wires: [
            w('pd', 'ep'), w('p', 'ep:1'), w('zd', 'eo'), w('R', 'eo:1'), w('v', 'dv'),
            w('ep', 'kx'), w('vd', 'vl'), w('kx', 'vl:1'), w('eo', 'ko'), w('wd', 'vw'), w('ko', 'vw:1'), w('vl', 'vs'), w('vw', 'vs:1'), w('vs', 'ovs'),
            w('vd', 'ev'), w('dv', 'ev:1'), w('ev', 'kv'), w('ad', 'al'), w('kv', 'al:1'), w('al', 'as'),
            w('wd', 'ew'), w('dv:1', 'ew:1'), w('ew', 'kw'), w('ald', 'aw'), w('kw', 'aw:1'), w('aw', 'as:1'), w('as', 'oas'),
            w('eo:1', 'th'),
          ],
        },
      },
      {
        id: 'inv', type: 'subsystem', name: 'Task → axes', x: 540, y: 160,
        diagram: {
          blocks: [
            inp('vs', 1, 20, 40, 'v*'), inp('as', 2, 20, 120, 'a*'), inp('J', 3, 20, 200, 'J'), inp('Jd', 4, 20, 260, 'J̇q̇'),
            blk('di', 'dampedInverse', { eps: 0.04, lambdaMax: 0.05, rows: 6 }, 140, 200, 'Damped inverse'),
            blk('pv', 'product', {}, 280, 40, 'q̇* = J⁺·v*'),
            blk('da', 'sum', { signs: '+-' }, 140, 124, 'a* − J̇q̇'),
            blk('pa', 'product', {}, 280, 120, 'q̈* = J⁺·(a* − J̇q̇)'),
            outp('qd', 1, 420, 40, 'q̇*'), outp('qdd', 2, 420, 120, 'q̈*'), outp('sig', 3, 420, 210, 'σ_min'),
          ],
          wires: [w('J', 'di'), w('di', 'pv'), w('vs', 'pv:1'), w('as', 'da'), w('Jd', 'da:1'), w('di', 'pa'), w('da', 'pa:1'),
            w('pv', 'qd'), w('pa', 'qdd'), w('di:1', 'sig')],
        },
      },
      {
        id: 'ff', type: 'subsystem', name: 'Model feedforward', x: 680, y: 300,
        diagram: {
          blocks: [
            inp('q', 1, 20, 20, 'q_m'), inp('qd', 2, 20, 70, 'q̇_m'), inp('qds', 3, 20, 170, 'q̇*'), inp('qdds', 4, 20, 120, 'q̈*'),
            blk('id', 'inverseDynamics', { robot: R, armature: PUMA560.armature }, 140, 60, 'Inverse dynamics'),
            blk('Gm', 'matrixGain', { K: D.G }, 140, 170, 'ω_m = G·q̇*'),
            blk('fr', 'friction', { B: D.B, Tcp: D.Tcp, Tcn: D.Tcn, ws: D.ws }, 260, 170, 'friction'),
            blk('Gj', 'matrixGain', { K: D.G }, 380, 170, 'at the joints'),
            blk('s', 'sum', { signs: '++' }, 480, 80),
            outp('tff', 1, 580, 80, 'τ_ff'),
          ],
          wires: [w('q', 'id'), w('qd', 'id:1'), w('qdds', 'id:2'), w('qds', 'Gm'), w('Gm', 'fr'), w('fr', 'Gj'), w('id', 's'), w('Gj', 's:1'), w('s', 'tff')],
        },
      },
      {
        id: 'servos', type: 'controller', name: 'Axis servos', x: 820, y: 160,
        params: { inputs: 2, Ts: 0.001, lanes: N, ff: 1 },
        variants: [
          { name: 'PI + model feedforward', type: 'speedPI', params: { omega: 30, zeta: 1, Kf: 1, limit: lanesLimit } },
          { name: 'PI, no model', type: 'speedPI', params: { omega: 30, zeta: 1, Kf: 0, limit: lanesLimit } },
          { name: 'P only, no model', type: 'speedPI', params: { omega: 30, zeta: 1, Kf: 0, integral: 'off', limit: lanesLimit } },
        ],
        variant: 0,
      },
      blk('t2i', 'matrixGain', { K: J.map((j) => 1 / (D.G[j] * D.kt[j])) }, 960, 164, 'torque → current'),
      outp('i', 1, 1080, 170, 'i*'),
      blk('deg', 'gain', { K: 180 / Math.PI }, 700, 60, 'θ in °'), sink('eo', 'eo', '°', 800, 64),
      sink('sig', 'sigma', '1', 700, 230),
    ],
    wires: [
      w('q', 'enc:1'), w('enc', 'axes'), w('enc:1', 'axes:1'),
      w('pd', 'law'), w('vd', 'law:1'), w('ad', 'law:2'), w('zd', 'law:3'), w('wd', 'law:4'), w('ald', 'law:5'), w('axes', 'law:6'), w('axes:1', 'law:7'), w('axes:2', 'law:8'),
      w('law', 'inv'), w('law:1', 'inv:1'), w('axes:3', 'inv:2'), w('axes:4', 'inv:3'),
      w('enc', 'ff'), w('enc:1', 'ff:1'), w('inv', 'ff:2'), w('inv:1', 'ff:3'),
      w('inv', 'servos'), w('enc:1', 'servos:1'), w('ff', 'servos:2'),
      w('servos', 't2i'), w('t2i', 'i'),
      w('law:2', 'deg'), w('deg', 'eo'), w('inv:2', 'sig'),
    ],
  },
};

export const PUMA_SYSTEM = {
  name: 'PUMA 560, a circle in space',
  summary: 'A six-axis robot arm takes a touch probe round a circle: the ruby ball traces it while the stylus leans in from outside, so every joint moves. Watch the error and the torques; switch the model off.',
  notes: 'The PUMA 560, a six-axis arm, carries a touch probe like a measuring machine\'s: a short silver threaded mount, a black collar, a long thin steel shaft and a ruby ball, on an adapter that holds it 40° off the flange. The probe is part of the arm, its mass in the arm\'s model. The ball traces a horizontal circle of 0.08 m radius, once round and back in each 10 s period, smoothly, so the run repeats exactly (a full turn every period would wind joint 6, which turns the probe, past its stops). The stylus comes in at 45° from outside, as it would to reach the edge of a round part in the middle, and looks onto the inside of the circle all the way round: the whole tool turns once about the circle\'s axis with the ball, and no joint keeps a constant angle (each moves 31° to 360°, peak to peak; joint 6 turns the probe round and back). Its reference is two signals in the circle\'s own frame, a_r and b_r (Input tab), placed where the ball starts by a Frame transform; the tool\'s orientation follows from them (Circle reference, its radius R on the mask). The 3D view draws the arm and its probe from the robot description (URDF), the circle dashed and the ball\'s trail.\n\nThe controller works in the tool\'s coordinates: from the measured joint angles (their speed by a finite difference of the encoders), Axes → task gives the ball\'s position, the tool\'s orientation, its speed and Jacobian; the task law corrects both (time constant 0.1 s), with the reference\'s speed, turn rate and accelerations as feedforward; Task → axes turns the result through the damped inverse Jacobian into a speed and an acceleration target per joint; six PI speed loops (Axis servos, one Controller with six lanes, its gains computed from the arm at the start pose) follow them, with the torque the arm\'s model says the motion takes as feedforward. The motors are six Servo motors (the library\'s component) on current drives, with their friction; the controller reads their encoders.\n\nThe scope shows the error in the circle\'s frame (e_a, e_b, mm) and the torques at the shoulder and elbow (τ2, τ3, N·m): gravity and the arm\'s inertia are in them. Every joint torque is a signal (tau1 … tau6), and so are its shares the model computes: inertial (tauI), Coriolis and centrifugal (tauC), gravity (tauG) and each motor\'s friction at its shaft (m1_tau_f … m6_tau_f; ×G at the joint); the motor currents are m1_i … m6_i; eo is the tool\'s orientation error (°).\n\nTry: Controller tab, PI without the model: the error grows a hundredfold; P only: the trail leaves the circle in 3D. Make the circle faster (the sines\' frequency) and watch the torques, the wrist\'s currents and the Joint limits report.\n\nThe motors\' own errors show in the robot. Open PUMA 560 › Motor drives and select Motor 2 (the shoulder): every effect but Coulomb friction is off, at a realistic size. Switch Torque ripple and cogging on (1 % of its peak torque, 6 times per motor turn, about 650 times per joint turn): the path error grows from 0.017 to 0.054 mm rms. Switch Encoder counts on and set N to 100 (counts per motor turn): the speed the loop computes from the counts jumps, and τ2 chatters (34 → 76 N·m rms). The encoder\'s angle errors are small at the joint (divided by the gear\'s 108): raise them on a motor to see them; Current loop adds the drive\'s lag (400 Hz).',
  signals: {
    // Once round the circle and back in each period, smoothly: the phase
    // φ = π·(1 − cos(2π·t/10)) goes 0 → 2π → 0, so every joint (joint 6
    // turning the probe a full turn and back) is where it started each
    // period, and the run repeats exactly.
    a_r: { period: PERIOD_S, components: [{ type: 'fn', params: {}, expr: `${RADIUS}*(cos(pi*(1 - cos(2*pi*t/${PERIOD_S}))) - 1)` }] },
    b_r: { period: PERIOD_S, components: [{ type: 'fn', params: {}, expr: `${RADIUS}*sin(pi*(1 - cos(2*pi*t/${PERIOD_S})))` }] },
  },
  scope: { channels: [
    { source: 'ea', on: true, scale: 1, offset: 0 }, { source: 'eb', on: true, scale: 1, offset: 0 },
    { source: 'tau2', on: true, scale: 1, offset: 0 }, { source: 'tau3', on: true, scale: 1, offset: 0 },
  ] },
  ui: { run: 'run', tab: 'plant', setup: 0.42, view: 'Robot' },
  sim: { sampleTime: 0.001 },
  vectors: true,   // vector wires: the HIL simulator does not offer it (hilsim.js)
  tags: [{ label: 'MIMO', kind: 'plant' }, { label: '3D', kind: 'feature' }],
  diagram: {
    robots: { [R]: { urdf: PUMA560.urdfProbe } },
    blocks: [
      blk('q0', 'constant', { value: Q0, unit: 'rad' }, 20, 20, 'start pose'),
      blk('pose0', 'forwardKinematics', { robot: R }, 20, 80, 'start pose of the tool'),
      ref, ctl, puma,
      blk('tool', 'forwardKinematics', { robot: R }, 820, 60, 'Tool pose'),
      sink('xyz', 'x,y,z', 'm', 960, 40), sink('refp', 'xr,yr,zr', 'm', 300, 20),
      blk('err', 'sum', { signs: '+-' }, 960, 120, 'p_d − p'),
      blk('ec', 'frameTransform', { rpy: [0, 0, YAW], groups: 'v', inverse: 1 }, 1060, 120, 'circle ← base'),
      blk('o0', 'constant', { value: [0, 0, 0], unit: 'm' }, 960, 180),
      blk('mm', 'gain', { K: 1000 }, 1160, 120, 'in mm'),
      sink('e3', 'ea,eb,ec', 'mm', 1260, 120),
      blk('en', 'norm', {}, 1160, 180, '‖e‖'), sink('e', 'e', 'mm', 1260, 180),
    ],
    wires: [
      w('q0', 'pose0'), w('pose0', 'ref'), w('pose0:1', 'ref:1'),
      w('puma:1', 'ctl'), w('ref', 'ctl:1'), w('ref:1', 'ctl:2'), w('ref:2', 'ctl:3'), w('ref:3', 'ctl:4'), w('ref:4', 'ctl:5'), w('ref:5', 'ctl:6'), w('ctl', 'puma'),
      w('puma', 'tool'), w('tool', 'xyz'), w('ref', 'refp'),
      w('ref', 'err'), w('tool', 'err:1'), w('err', 'ec'), w('o0', 'ec:1'), w('ec', 'mm'), w('mm', 'e3'), w('mm', 'en'), w('en', 'e'),
    ],
  },
  views: [{ name: 'Robot', kind: '3d', robot: R, joints: 'q', paths: [{ x: 'xr', y: 'yr', z: 'zr', style: 'reference', span: 'all' }, { x: 'x', y: 'y', z: 'z', style: 'actual', span: 'to-now', fade: 2.5 }], camera: { target: [0.4, -0.1, 0.55], view: 'iso', distance: 2.0 } }],
};
