// The equations sheet (design/output/transparent-models.md §1.6): a
// mechanism's equations of motion in the names of its parameters, derived
// from the same topology as the simulation (mech.js), with common factors
// taken out: l1·l2·(m2 + m3). One row per coordinate, Σ_b M_ab·q̈_b = Q_a,
// the potential V(q) and T = ½·q̇ᵀ·M(q)·q̇. check() evaluates every
// coefficient, so a test holds the sheet to the matrices the simulation uses.

import { NAME_RE } from './formula.js';

// ---- Polynomials in the parameters: Map(monomial → coefficient), a
// monomial being its symbols sorted and joined by '*' ('' for a number).
const poly = (entries = []) => new Map(entries);
const cnum = (c) => (c ? poly([['', c]]) : poly());
const csym = (s) => poly([[s, 1]]);
const key = (syms) => syms.filter(Boolean).sort().join('*');
function add(a, b, k = 1) {
  const out = new Map(a);
  for (const [m, c] of b) { const v = (out.get(m) ?? 0) + k * c; if (Math.abs(v) < 1e-15) out.delete(m); else out.set(m, v); }
  return out;
}
function mul(a, b) {
  let out = poly();
  for (const [ma, ca] of a) for (const [mb, cb] of b) out = add(out, poly([[key([...ma.split('*'), ...mb.split('*')]), ca * cb]]));
  return out;
}
const isZero = (p) => p.size === 0;

// A parameter as written: a number, a name (a symbol), or a formula (a
// symbol in brackets).
function param(raw) {
  if (typeof raw === 'number') return cnum(raw);
  const s = String(raw).trim();
  if (s !== '' && Number.isFinite(Number(s))) return cnum(Number(s));
  return csym(NAME_RE.test(s) ? s : `(${s})`);
}

const fmtNum = (v) => String(Number(v.toPrecision(6)));
// A monomial's symbols as text: l·l·m → l²·m.
const SUP = { 2: '²', 3: '³', 4: '⁴' };
function symsText(m) {
  if (!m) return '';
  const count = new Map();
  for (const s of m.split('*')) count.set(s, (count.get(s) ?? 0) + 1);
  return [...count].map(([s, n]) => `${s.startsWith('cos(') || s.startsWith('sin(') ? s.replace(/^(cos|sin)\((.*)\)$/, '$1 $2') : s}${n > 1 ? SUP[n] ?? `^${n}` : ''}`).join('·');
}
// A polynomial as a product: [sign, text], the common symbols and number taken out.
function polyText(p) {
  const terms = [...p].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (!terms.length) return [1, '0'];
  // The symbols every term has (with their least power).
  const counts = terms.map(([m]) => { const c = new Map(); for (const s of m ? m.split('*') : []) c.set(s, (c.get(s) ?? 0) + 1); return c; });
  const common = new Map([...counts[0]].map(([s, n]) => [s, Math.min(...counts.map((c) => c.get(s) ?? 0))]).filter(([, n]) => n > 0));
  const commonSyms = [...common].flatMap(([s, n]) => Array(n).fill(s));
  const sign = terms.every(([, c]) => c < 0) ? -1 : 1;
  const same = terms.every(([, c]) => Math.abs(c - terms[0][1]) < 1e-15 * Math.abs(c));
  const k = same ? Math.abs(terms[0][1]) : 1;
  const rest = terms.map(([m, c], i) => {
    const left = new Map(counts[i]);
    for (const [s, n] of common) left.set(s, left.get(s) - n);
    const syms = [...left].flatMap(([s, n]) => Array(n).fill(s));
    const v = (sign * c) / k, t = symsText(key(syms));
    const mag = Math.abs(v), body = t ? `${Math.abs(mag - 1) < 1e-15 ? '' : `${fmtNum(mag)}·`}${t}` : fmtNum(mag);
    return { neg: v < 0, body };
  });
  if (terms.length === 1) {
    const [m, c] = terms[0], mag = Math.abs(c), t = symsText(m);
    return [c < 0 ? -1 : 1, [Math.abs(mag - 1) < 1e-15 && t ? '' : fmtNum(mag), t].filter(Boolean).join('·')];
  }
  const head = [k !== 1 ? fmtNum(k) : '', symsText(key(commonSyms))].filter(Boolean).join('·');
  const inner = rest.map((r, i) => (i ? `${r.neg ? ' − ' : ' + '}${r.body}` : `${r.neg ? '−' : ''}${r.body}`)).join('');
  return [sign, head ? `${head}·(${inner})` : `(${inner})`];
}
function polyValue(p, value) {
  let s = 0;
  for (const [m, c] of p) { let t = c; for (const sym of m ? m.split('*') : []) t *= value(sym); s += t; }
  return s;
}

// ---- The sheet

// mech: a compiled mechanism (mech.js's topology, its parts resolved to
// numbers); raw(id): the part's parameters as written (numbers or
// formulas); value(text): a parameter's or formula's value (hover, check);
// inputName(id): what is wired into a joint's force or torque (F).
export function equationSheet(mech, raw, value, inputName = () => null) {
  const np = mech.rails.length, nh = mech.hinges.length;
  const g = param(raw(mech.world.id).g);
  // Rail directions (cos α, sin α): numbers, or cos(α), sin(α) for a formula.
  const dir = mech.rails.map((r) => {
    const a = raw(r.id).incline;
    if (typeof a === 'number' || Number.isFinite(Number(a))) { const v = Number(a); return v === 0 ? [cnum(1), cnum(0)] : [cnum(Math.cos(v)), cnum(Math.sin(v))]; }
    const t = NAME_RE.test(String(a).trim()) ? String(a).trim() : `(${String(a).trim()})`;
    return [csym(`cos(${t})`), csym(`sin(${t})`)];
  });
  const Mpp = [], Cpr = [], Crr = [], I = [], Gp = [], Gr = [];
  for (let p = 0; p < np; p++) { Mpp.push(Array.from({ length: np }, () => poly())); Cpr.push(Array.from({ length: nh }, () => poly())); Gp.push(poly()); }
  for (let j = 0; j < nh; j++) { Crr.push(Array.from({ length: nh }, () => poly())); I.push(poly()); Gr.push(poly()); }
  for (const b of mech.bodies) {
    const m = param(raw(b.part.id).m);
    const L = Array.from({ length: nh }, () => poly());
    for (const r of b.rods) L[r.hinge] = add(L[r.hinge], mul(cnum(r.f), param(raw(r.part.id).l)));
    const P = new Set(b.rails);
    for (let p = 0; p < np; p++) {
      if (!P.has(p)) continue;
      for (let q = 0; q < np; q++) if (P.has(q)) Mpp[p][q] = add(Mpp[p][q], mul(m, add(mul(dir[p][0], dir[q][0]), mul(dir[p][1], dir[q][1]))));
      for (let j = 0; j < nh; j++) Cpr[p][j] = add(Cpr[p][j], mul(m, L[j]));
      Gp[p] = add(Gp[p], mul(mul(g, m), dir[p][1]), -1);
    }
    for (let j = 0; j < nh; j++) {
      for (let k = 0; k < nh; k++) Crr[j][k] = add(Crr[j][k], mul(m, mul(L[j], L[k])));
      Gr[j] = add(Gr[j], mul(g, mul(m, L[j])));
    }
    if (b.hinge >= 0 && b.I > 0) { const l = param(raw(b.part.id).l); I[b.hinge] = add(I[b.hinge], mul(cnum(1 / 12), mul(m, mul(l, l)))); }
  }

  const coord = (b) => b.params.name, rate = (b) => b.params.rate;
  // A rate's derivative: the dot on its letter (ω̇1).
  const dot = (s) => { const [first, ...rest] = [...s]; return `${first}\u0307${rest.join('')}`; };
  const joints = [...mech.rails, ...mech.hinges];
  // A term: coefficient (polynomial) · trig · var; the side's list of them.
  const term = (c, trig, v) => ({ c, trig, v });
  const rows = [];
  for (let p = 0; p < np; p++) {
    const lhs = [], rhs = [];
    for (let q = 0; q < np; q++) lhs.push(term(Mpp[p][q], '', dot(rate(mech.rails[q]))));
    for (let j = 0; j < nh; j++) {
      const th = coord(mech.hinges[j]), w = dot(rate(mech.hinges[j]));
      lhs.push(term(mul(Cpr[p][j], dir[p][0]), `cos ${th}`, w), term(mul(Cpr[p][j], dir[p][1]), `sin ${th}`, w));
      lhs.at(-1).c = mul(lhs.at(-1).c, cnum(-1));
    }
    const r = mech.rails[p], rr = raw(r.id);
    if (r.params.force) rhs.push(term(cnum(1), '', inputName(r.id) ?? `F_${r.name ?? r.id}`));
    if (r.params.b) rhs.push(term(mul(param(rr.b), cnum(-1)), '', rate(r)));
    rhs.push(term(Gp[p], '', ''));
    for (let k = 0; k < nh; k++) {
      const th = coord(mech.hinges[k]), w2 = `${rate(mech.hinges[k])}²`;
      rhs.push(term(mul(Cpr[p][k], dir[p][0]), `sin ${th}`, w2), term(mul(Cpr[p][k], dir[p][1]), `cos ${th}`, w2));
    }
    rows.push({ of: coord(r), lhs, rhs });
  }
  for (let j = 0; j < nh; j++) {
    const h = mech.hinges[j], th = coord(h), lhs = [], rhs = [];
    for (let p = 0; p < np; p++) {
      const v = dot(rate(mech.rails[p]));
      lhs.push(term(mul(Cpr[p][j], dir[p][0]), `cos ${th}`, v), term(mul(mul(Cpr[p][j], dir[p][1]), cnum(-1)), `sin ${th}`, v));
    }
    for (let k = 0; k < nh; k++) {
      const c = k === j ? add(Crr[j][j], I[j]) : Crr[j][k];
      lhs.push(term(c, k === j ? '' : `cos(${th} − ${coord(mech.hinges[k])})`, dot(rate(mech.hinges[k]))));
    }
    rhs.push(term(Gr[j], `sin ${th}`, ''));
    for (let k = 0; k < nh; k++) if (k !== j) rhs.push(term(mul(Crr[j][k], cnum(-1)), `sin(${th} − ${coord(mech.hinges[k])})`, `${rate(mech.hinges[k])}²`));
    // Its torque and damping; the reactions of the hinges mounted on what it turns.
    const torque = (k, sign) => {
      const hk = mech.hinges[k], b = mech.base[k], out = [];
      if (hk.params.torque) out.push(term(cnum(sign), '', inputName(hk.id) ?? `τ_${hk.name ?? hk.id}`));
      if (hk.params.c) out.push(term(mul(param(raw(hk.id).c), cnum(-sign)), '', b >= 0 ? `(${rate(hk)} − ${rate(mech.hinges[b])})` : rate(hk)));
      return out;
    };
    rhs.push(...torque(j, 1));
    mech.base.forEach((b, k) => { if (b === j) rhs.push(...torque(k, -1)); });
    rows.push({ of: th, lhs, rhs });
  }
  // V = Σ m·g·y (up to a constant).
  const V = [...mech.rails.map((r, p) => term(mul(Gp[p], cnum(-1)), '', coord(r))), ...mech.hinges.map((h, j) => term(Gr[j], `cos ${coord(h)}`, ''))];

  const valueOf = (sym) => { const m = /^(cos|sin)\((.*)\)$/.exec(sym); return m ? Math[m[1]](value(m[2].replace(/^\((.*)\)$/, '$1'))) : value(sym.replace(/^\((.*)\)$/, '$1')); };
  // A side as text, or as HTML with each coefficient's value on hover.
  const side = (terms, html) => {
    const parts = terms.filter((t) => !isZero(t.c)).map((t) => {
      const [sign, text] = polyText(t.c);
      const factors = [text === '1' && (t.trig || t.v) ? '' : text, t.trig, t.v].filter(Boolean);
      let body = factors.join('·');
      if (html) {
        const esc = (s) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
        const coef = text === '1' && (t.trig || t.v) ? '' : `<span class="coef" title="${esc(`${text} = ${fmtNum(Math.abs(polyValue(t.c, valueOf)))}`)}">${esc(text)}</span>`;
        body = [coef, ...[t.trig, t.v].filter(Boolean).map(esc)].filter(Boolean).join('·');
      }
      return { sign, body };
    });
    if (!parts.length) return '0';
    return parts.map((x, i) => (i ? `${x.sign < 0 ? ' − ' : ' + '}${x.body}` : `${x.sign < 0 ? '−' : ''}${x.body}`)).join('');
  };
  const coords = joints.map((b) => (b.type === 'rail' ? `${coord(b)} (rail), rate ${rate(b)}` : `${coord(b)} (hinge, from upright), rate ${rate(b)}`)).join('; ');
  const render = (html) => ({
    coords,
    rows: rows.map((r) => `${side(r.lhs, html)} = ${side(r.rhs, html)}`),
    V: `V = ${side(V, html)}`,
    T: 'T = ½·q̇ᵀ·M(q)·q̇',
  });
  return {
    ...render(false),
    html: () => render(true),
    text: () => { const r = render(false); return [r.coords, ...r.rows, r.V, r.T].join('\n'); },
    // The largest relative difference between the sheet's coefficients,
    // evaluated, and the constants the simulation uses (mech.js's constants()).
    check(K) {
      let worst = 0;
      const cmp = (p, v) => { const a = polyValue(p, valueOf), m = Math.max(Math.abs(v), Math.abs(a)); if (m > 1e-300) worst = Math.max(worst, Math.abs(a - v) / m); };
      for (let p = 0; p < np; p++) {
        for (let q = 0; q < np; q++) cmp(Mpp[p][q], K.Mpp[p * np + q]);
        for (let j = 0; j < nh; j++) cmp(Cpr[p][j], K.Cpr[p * nh + j]);
        cmp(Gp[p], K.Gp[p]);
      }
      for (let j = 0; j < nh; j++) {
        for (let k = 0; k < nh; k++) cmp(Crr[j][k], K.Crr[j * nh + k]);
        cmp(I[j], K.I[j]);
        cmp(Gr[j], K.Gr[j]);
      }
      return worst;
    },
  };
}
