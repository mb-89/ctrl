// Formulas in parameters (design/output/transparent-models.md §1.2, §1.4):
// a number field may hold a formula in the names of the masks around it
// ("2*m", "1/Jm", "inf"), and an Equations block holds lines of them. Parsed
// to a tree, constant subtrees folded, compiled to closures over a
// Float64Array of slots; no eval, no new Function. The grammar and the
// floating-point operations are expr.js's (the same tree, the same
// functions), so a formula computes the same numbers bit for bit:
//   numbers, names (Latin or Greek letters, digits, _), pi, e, inf;
//   + - * / ^ (power, right-associative), unary minus, parentheses,
//   a missing operator multiplies (2t, 3(x+1)); expr.js's functions.
// Names are case-sensitive; the constants, t and the functions are found
// in any case, as in expr.js.

import { FN1, FN2, FN3 } from './expr.js';
import { siUnit } from './scale.js';

const CONST = { pi: Math.PI, e: Math.E, inf: Infinity };
const ARITY = (name) => (Object.hasOwn(FN1, name) ? 1 : Object.hasOwn(FN2, name) ? 2 : Object.hasOwn(FN3, name) ? 3 : 0);
const LETTER = 'A-Za-z_Ͱ-Ͽἀ-῿';
export const NAME_RE = new RegExp(`^[${LETTER}][${LETTER}0-9]*$`);

// What a mask key may not be: the time, a constant or a function.
export const isReserved = (key) => { const k = String(key).toLowerCase(); return k === 't' || Object.hasOwn(CONST, k) || ARITY(k) > 0; };

// A value that is a formula rather than a number: a string that is not a
// plain number ("0.5" is a number, "l1", "2*m" and "inf" are formulas).
export const isFormula = (v) => typeof v === 'string' && v.trim() !== '' && !Number.isFinite(Number(v));

function tokenize(src) {
  const toks = [];
  const re = new RegExp(`\\s*(?:(\\d+\\.?\\d*(?:e[-+]?\\d+)?|\\.\\d+(?:e[-+]?\\d+)?)|([${LETTER}][${LETTER}0-9]*)|(\\*\\*|[-+*/^(),]))`, 'gy');
  re.lastIndex = 0;
  while (re.lastIndex < src.length) {
    const at = re.lastIndex;
    if (/^\s*$/.test(src.slice(at))) break;
    const m = re.exec(src);
    if (!m) throw new Error(`unexpected "${src.slice(at).trim()[0]}" at ${at + 1}`);
    if (m[1] !== undefined) toks.push({ k: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) toks.push({ k: 'id', v: m[2] });
    else toks.push({ k: 'op', v: m[3] === '**' ? '^' : m[3] });
  }
  return toks;
}

// The tree of src: { k: 'num', v } | { k: 'name', v } | { k: 'neg', a } |
// { k: 'op', op, a, b } | { k: 'call', f, args }. Throws a readable message.
export function parseFormula(src) {
  const toks = tokenize(String(src));
  let i = 0;
  const peek = () => toks[i];
  const take = (v) => { const tk = toks[i]; if (!tk || (v && tk.v !== v)) throw new Error(tk ? `expected "${v}" near "${tk.v}"` : `expected "${v}" at the end`); i++; return tk; };
  function expr() {
    let a = term();
    while (peek()?.k === 'op' && (peek().v === '+' || peek().v === '-')) { const op = take().v; a = { k: 'op', op, a, b: term() }; }
    return a;
  }
  function term() {
    let a = unary();
    for (;;) {
      const tk = peek();
      const explicit = tk?.k === 'op' && (tk.v === '*' || tk.v === '/');
      const implicit = tk && (tk.k === 'num' || tk.k === 'id' || (tk.k === 'op' && tk.v === '('));
      if (!explicit && !implicit) return a;
      const op = explicit ? take().v : '*';
      a = { k: 'op', op, a, b: unary() };
    }
  }
  function unary() {
    if (peek()?.k === 'op' && (peek().v === '-' || peek().v === '+')) { const neg = take().v === '-', a = unary(); return neg ? { k: 'neg', a } : a; }
    return power();
  }
  function power() {
    const a = atom();
    if (peek()?.k === 'op' && peek().v === '^') { take(); return { k: 'op', op: '^', a, b: unary() }; }
    return a;
  }
  function atom() {
    const tk = peek();
    if (!tk) throw new Error('the formula ends too early');
    if (tk.k === 'num') { take(); return { k: 'num', v: tk.v }; }
    if (tk.k === 'op' && tk.v === '(') { take(); const a = expr(); take(')'); return a; }
    if (tk.k === 'id') {
      take();
      const f = tk.v.toLowerCase(), arity = ARITY(f);
      if (!arity || peek()?.v !== '(') return { k: 'name', v: tk.v };
      take('(');
      const args = [expr()];
      while (args.length < arity) { take(','); args.push(expr()); }
      take(')');
      return { k: 'call', f, args };
    }
    throw new Error(`unexpected "${tk.v}"`);
  }
  if (!toks.length) throw new Error('enter a formula');
  const tree = expr();
  if (i < toks.length) throw new Error(`unexpected "${toks[i].v}"`);
  return tree;
}

// The names a tree reads (not the functions), in order of appearance.
export function formulaNames(tree, out = []) {
  if (tree.k === 'name') { if (!out.includes(tree.v)) out.push(tree.v); }
  else if (tree.k === 'neg') formulaNames(tree.a, out);
  else if (tree.k === 'op') { formulaNames(tree.a, out); formulaNames(tree.b, out); }
  else if (tree.k === 'call') for (const a of tree.args) formulaNames(a, out);
  return out;
}

// An error naming the name a formula reads that is nowhere: the caller's
// sentence says where it looked (err.code 'unknown-name', err.name).
const unknown = (name) => Object.assign(new Error(`unknown name "${name}"`), { code: 'unknown-name', name });

// Compiles src (text or a tree) to v => value, v a Float64Array of slots.
// resolve(name) gives { slot } (read from v at run time), { value } (a
// constant, folded) or null; a null name is looked up in any case as t
// (resolve('t')), a constant or else refused (err.code 'unknown-name').
// Constant subtrees are computed once here, by the same operations.
export function compileFormula(src, resolve = () => null) {
  const tree = typeof src === 'string' ? parseFormula(src) : src;
  const C = (v) => ({ c: true, v, f: () => v });
  const build = (n) => {
    if (n.k === 'num') return C(n.v);
    if (n.k === 'name') {
      let r = resolve(n.v);
      const low = n.v.toLowerCase();
      if (!r && low === 't' && n.v !== 't') r = resolve('t');
      if (!r && Object.hasOwn(CONST, low)) r = { value: CONST[low] };
      if (!r) throw unknown(n.v);
      if (r.slot === undefined) return C(r.value);
      const s = r.slot;
      return { c: false, f: (v) => v[s] };
    }
    if (n.k === 'neg') {
      const a = build(n.a);
      if (a.c) return C(-a.v);
      const fa = a.f;
      return { c: false, f: (v) => -fa(v) };
    }
    if (n.k === 'call') {
      const args = n.args.map(build), fn = (n.args.length === 1 ? FN1 : n.args.length === 2 ? FN2 : FN3)[n.f];
      if (args.every((a) => a.c)) return C(fn(...args.map((a) => a.v)));
      const [a, b, c] = args.map((x) => x.f);
      if (args.length === 1) return { c: false, f: (v) => fn(a(v)) };
      if (args.length === 2) return { c: false, f: (v) => fn(a(v), b(v)) };
      return { c: false, f: (v) => fn(a(v), b(v), c(v)) };
    }
    const a = build(n.a), b = build(n.b);
    const op = { '+': (x, y) => x + y, '-': (x, y) => x - y, '*': (x, y) => x * y, '/': (x, y) => x / y, '^': Math.pow }[n.op];
    if (a.c && b.c) return C(op(a.v, b.v));
    const fa = a.f, fb = b.f, ca = a.v, cb = b.v;
    switch (n.op) {
      case '+': return { c: false, f: a.c ? (v) => ca + fb(v) : b.c ? (v) => fa(v) + cb : (v) => fa(v) + fb(v) };
      case '-': return { c: false, f: a.c ? (v) => ca - fb(v) : b.c ? (v) => fa(v) - cb : (v) => fa(v) - fb(v) };
      case '*': return { c: false, f: a.c ? (v) => ca * fb(v) : b.c ? (v) => fa(v) * cb : (v) => fa(v) * fb(v) };
      case '/': return { c: false, f: a.c ? (v) => ca / fb(v) : b.c ? (v) => fa(v) / cb : (v) => fa(v) / fb(v) };
      default: return { c: false, f: (v) => Math.pow(fa(v), fb(v)) };
    }
  };
  const out = build(tree);
  const f = out.f;
  f.constant = out.c;
  return f;
}

// The value of a formula in constants alone: values maps names to numbers
// (a Map, or an object read for its own keys), as a mask's scope does.
export function evalFormula(src, values = {}) {
  const get = values instanceof Map ? (n) => (values.has(n) ? { value: values.get(n) } : null) : (n) => (Object.hasOwn(values, n) ? { value: values[n] } : null);
  return compileFormula(src, get)(new Float64Array(0));
}

// A sentence with values put in: {formula:unit} becomes the value with an SI
// prefix ("{CL:F}" → "1 nF"), {formula} a plain number. valueOf(src) gives
// a formula's value (evalFormula with a mask's scope, say).
export function sentence(text, valueOf) {
  return String(text).replace(/\{([^{}:]+)(?::([^{}]*))?\}/g, (_, src, unit) => {
    const v = valueOf(src.trim());
    if (!Number.isFinite(v)) return v > 0 ? '∞' : v < 0 ? '−∞' : '?';
    return unit !== undefined && unit.trim() !== '1' ? siUnit(v, unit.trim()) : String(Number(v.toPrecision(3)));
  });
}
