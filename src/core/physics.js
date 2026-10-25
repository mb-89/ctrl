// The physics models as subsystems you can open (design/output/transparent-models.md
// §2): each generator returns a masked subsystem, { type, mask, params,
// diagram }, whose mask holds the old block's parameters and whose diagram
// is the model drawn from parts: the tank from Equations, a Sum and a
// limited Integrator; the carts from Mechanics parts joined at frames. The
// old block types (cartPole, pendulumCart, conicalTank) load as these
// (expandPhysics, called by normalizeDiagram), keeping id, name, place and ports.

const field = (key, label, unit, def, extra = {}) => ({ key, label, unit, default: def, ...extra });

// The old blocks' parameters, with their defaults: the mask's fields, and
// what an old file's partial params are completed with.
const TANK_MASK = [
  field('r0', 'Bottom radius r0', 'm', 0.05, { min: 1e-4 }), field('R', 'Top radius R', 'm', 0.5, { min: 1e-4 }),
  field('H', 'Height H', 'm', 1, { min: 1e-3 }), field('a', 'Outlet area a', 'm²', 0.1, { min: 0 }),
  field('g', 'g', 'm/s²', 9.81), field('h0', 'Start level h₀', 'm', 0.25, { min: 0 }),
];
const CART_POLE_MASK = [
  field('M', 'Cart M', 'kg', 1, { min: 1e-6 }), field('m', 'Bob m', 'kg', 0.2, { min: 1e-6 }), field('l', 'Length l', 'm', 0.5, { min: 1e-6 }),
  field('g', 'g', 'm/s²', 9.81), field('b', 'Friction b', 'N·s/m', 0.1, { min: 0 }), field('theta0', 'Start θ₀', 'rad', 0.05),
];
const chainMask = (n) => [
  field('M', 'Cart M', 'kg', 1, { min: 1e-6 }),
  ...Array.from({ length: n }, (_, i) => [field(`m${i + 1}`, `Mass m${i + 1}`, 'kg', 0.1, { min: 1e-6 }), field(`l${i + 1}`, `Rod l${i + 1}`, 'm', 0.25, { min: 1e-6 })]).flat(),
  field('g', 'g', 'm/s²', 9.81), field('b', 'Friction b', 'N·s/m', 0.1, { min: 0 }),
  ...Array.from({ length: n }, (_, i) => field(`theta${i + 1}0`, `Start θ${i + 1}₀`, 'rad', i === 0 ? 0.05 : 0)),
];

// The mask's values: the given ones, completed with the defaults.
const values = (mask, p = {}) => Object.fromEntries(mask.map((f) => [f.key, p[f.key] ?? f.default]));
const masked = (mask, p, diagram) => ({ type: 'subsystem', mask: mask.map((f) => ({ ...f })), params: values(mask, p), diagram });
const port = (id, type, name, n, x, y) => ({ id, type, name, params: { port: n }, x, y });

// The conical tank: q (the net flow in) → net inflow (q − qout) → level rate
// (dh = Q / A at the level's cross-section) → ∫ h, limited to [0, H] (it
// overflows at the brim and stops when dry) → Out h; the outlet (Torricelli)
// feeds back into the Sum.
export function conicalTank(p = {}) {
  return masked(TANK_MASK, p, {
    blocks: [
      port('q', 'inport', 'q', 1, 20, 66),
      { id: 'net', type: 'sum', name: 'net inflow', params: { signs: '+-' }, x: 130, y: 63 },
      { id: 'rate', type: 'fcn', name: 'level rate', params: { inputs: 'Q, h', eqs: 'r = r0 + (R - r0)*h/H\nA = pi*r^2\ndh = Q/A', outputs: 'dh' }, x: 210, y: 50 },
      { id: 'level', type: 'integrator', name: 'h', params: { K: 1, x0: 'h0', min: 0, max: 'H', unit: 'm', angle: 0 }, x: 460, y: 56 },
      { id: 'outlet', type: 'fcn', name: 'outlet (Torricelli)', params: { inputs: 'h', eqs: 'qout = a*sqrt(2*g*h)', outputs: 'qout' }, x: 250, y: 170, flip: true },
      port('o_1', 'outport', 'h', 1, 660, 66),
    ],
    wires: [
      { from: 'q', to: 'net' }, { from: 'net', to: 'rate' }, { from: 'level', to: 'rate:1' }, { from: 'rate', to: 'level' },
      { from: 'level', to: 'o_1' }, { from: 'level', to: 'outlet' }, { from: 'outlet', to: 'net:1' },
    ],
  });
}

// A chain of n rods on a cart (n = 1 is the cart–pole's structure): In F →
// rail (x, v, friction b) carrying the cart (Mass M), then for each rod a
// hinge θk (from upright) and a rod lk with its bob mk at the tip; Out ports
// x, θ1…θn, v, ω1…ωn. names: the coordinates' names (the cart–pole's θ, ω).
function cartChain(n, p, names) {
  const theta = (k) => names.theta(k), omega = (k) => names.omega(k);
  const blocks = [
    port('F', 'inport', 'F', 1, 20, 40),
    { id: 'world', type: 'world', name: 'world', params: { g: 'g' }, x: 20, y: 200 },
    { id: 'rail', type: 'rail', name: 'rail', params: { name: 'x', rate: 'v', b: 'b', force: 1 }, x: 130, y: 120 },
    { id: 'cart', type: 'mass', name: 'cart', params: { m: 'M' }, x: 150, y: 260 },
  ];
  const wires = [{ from: 'F', to: 'rail' }, { from: 'rail', to: 'o_1' }, { from: 'rail:1', to: `o_${n + 2}` }];
  const joins = [['world:W', 'rail:B'], ['rail:F', 'cart:F', `${names.hinge(1)}:B`]];
  for (let k = 1; k <= n; k++) {
    const h = names.hinge(k), r = names.rod(k), x = 130 + 220 * k;
    blocks.push({ id: h, type: 'hinge', name: n === 1 ? 'hinge' : `hinge ${k}`, params: { name: theta(k), rate: omega(k), theta0: names.theta0(k) }, x, y: 120 });
    blocks.push({ id: r, type: 'rod', name: n === 1 ? 'pole' : `rod ${k}`, params: { l: names.l(k), m: names.m(k), at: 'tip' }, x: x + 110, y: 200 });
    wires.push({ from: h, to: `o_${k + 1}` }, { from: `${h}:1`, to: `o_${n + k + 2}` });
    joins.push([`${h}:F`, `${r}:B`]);
    if (k < n) joins.push([`${r}:T`, `${names.hinge(k + 1)}:B`]);
  }
  const outs = ['x', ...Array.from({ length: n }, (_, i) => theta(i + 1)), 'v', ...Array.from({ length: n }, (_, i) => omega(i + 1))];
  outs.forEach((nm, i) => blocks.push(port(`o_${i + 1}`, 'outport', nm, i + 1, 360 + 220 * n, 20 + 36 * i)));
  return { blocks, wires, joins };
}

// The cart–pole: a point mass m on a massless pole of length l, hinged on a
// cart of mass M; θ = 0 is upright, positive leaning towards +x; b is the
// cart's friction. F → x, θ, v, ω.
export function cartPole(p = {}) {
  return masked(CART_POLE_MASK, p, cartChain(1, p, {
    theta: () => 'θ', omega: () => 'ω', hinge: () => 'hinge', rod: () => 'pole', theta0: () => 'theta0', l: () => 'l', m: () => 'm',
  }));
}

// A chain of n rods on a cart (point masses m1…mn at the ends of massless
// rods l1…ln, each hinged on the one before); angles from upright. F → x,
// θ1…θn, v, ω1…ωn.
export function pendulumOnCart(n, p = {}) {
  return masked(chainMask(n), p, cartChain(n, p, {
    theta: (k) => `θ${k}`, omega: (k) => `ω${k}`, hinge: (k) => `hinge${k}`, rod: (k) => `rod${k}`, theta0: (k) => `theta${k}0`, l: (k) => `l${k}`, m: (k) => `m${k}`,
  }));
}

// The Plant tab's Physics group: each template inserts its masked subsystem.
export const TEMPLATES = {
  conicalTank: { label: 'Conical tank', formula: 'q → h', name: 'tank', make: () => conicalTank() },
};

// The generator of each old type, and the mask a project's draw varies
// (hilsim.js): its physical parameters, never g or a start value.
const OLD_TYPES = {
  conicalTank: (p) => conicalTank(p),
};
export const isOldPhysics = (type) => Object.hasOwn(OLD_TYPES, type);

// An old physics block as its subsystem: the same id, name, place and ports.
export function expandPhysics(b) {
  const sub = OLD_TYPES[b.type](b.params ?? {});
  return { id: b.id, ...(b.name ? { name: b.name } : {}), x: b.x, y: b.y, ...(b.flip ? { flip: true } : {}), ...sub };
}

// The physical parameters of a masked subsystem, for the HIL simulator's
// draw: its fields but g and the start values.
export const physicalMaskKeys = (mask) => mask.filter((f) => f.key !== 'g' && !/^Start\b/.test(f.label)).map((f) => f.key);
