// A small formula language for y(t), compiled to a function without eval, so
// the page and Node compute the same values and nothing typed can run code.
//   numbers, t, pi, e;  + - * / ^ (power), unary minus, parentheses;
//   sin cos tan asin acos atan exp log ln log10 sqrt abs floor ceil round sign
//   min(a, b) max(a, b) pow(a, b) mod(a, b), step(x) (1 for x >= 0), clamp(x, lo, hi)
// Example: 0.5*sin(2*pi*3*t) + step(t - 0.2)

const FN1 = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  exp: Math.exp, log: Math.log, ln: Math.log, log10: Math.log10, sqrt: Math.sqrt, abs: Math.abs,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign, step: (x) => (x >= 0 ? 1 : 0),
};
const FN2 = { min: Math.min, max: Math.max, pow: Math.pow, mod: (a, b) => a - b * Math.floor(a / b), atan2: Math.atan2 };
const FN3 = { clamp: (x, lo, hi) => Math.min(hi, Math.max(lo, x)) };
const CONST = { pi: Math.PI, e: Math.E };

export const EXPR_HELP = 'numbers, t, pi, e; + − * / ^; sin cos tan exp log sqrt abs min max pow mod step clamp …';

function tokenize(src) {
  const toks = [];
  const re = /\s*(?:(\d+\.?\d*(?:e[-+]?\d+)?|\.\d+(?:e[-+]?\d+)?)|([A-Za-z_]\w*)|(\*\*|[-+*/^(),]))/gy;
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < src.length) {
    const at = re.lastIndex;
    if (/^\s*$/.test(src.slice(at))) break;
    m = re.exec(src);
    if (!m) throw new Error(`unexpected "${src.slice(at).trim()[0]}" at ${at + 1}`);
    if (m[1] !== undefined) toks.push({ k: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) toks.push({ k: 'id', v: m[2] });
    else toks.push({ k: 'op', v: m[3] === '**' ? '^' : m[3] });
  }
  return toks;
}

// Compiles src to t => value. Throws with a readable message on bad input.
// With opts.vars, other names are variables: the result is env => value,
// reading env[name] (NaN when absent), as 2D views use signal names.
export function compileExpr(src, opts = {}) {
  const toks = tokenize(String(src));
  let i = 0;
  const peek = () => toks[i];
  const take = (v) => { const tk = toks[i]; if (!tk || (v && tk.v !== v)) throw new Error(tk ? `expected "${v}" near "${tk.v}"` : `expected "${v}" at the end`); i++; return tk; };

  // expr := term (('+'|'-') term)*
  function expr() {
    let a = term();
    while (peek()?.k === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = take().v, b = term(), l = a;
      a = op === '+' ? (e) => l(e) + b(e) : (e) => l(e) - b(e);
    }
    return a;
  }
  // term := unary (('*'|'/')? unary)*   (a missing operator multiplies: 2t, 3(t+1))
  function term() {
    let a = unary();
    for (;;) {
      const tk = peek();
      const explicit = tk?.k === 'op' && (tk.v === '*' || tk.v === '/');
      const implicit = tk && (tk.k === 'num' || tk.k === 'id' || (tk.k === 'op' && tk.v === '('));
      if (!explicit && !implicit) return a;
      const op = explicit ? take().v : '*';
      const b = unary(), l = a;
      a = op === '*' ? (e) => l(e) * b(e) : (e) => l(e) / b(e);
    }
  }
  // unary := '-' unary | power
  function unary() {
    if (peek()?.k === 'op' && (peek().v === '-' || peek().v === '+')) {
      const neg = take().v === '-', a = unary();
      return neg ? (e) => -a(e) : a;
    }
    return power();
  }
  // power := atom ('^' unary)?   (right-associative)
  function power() {
    const a = atom();
    if (peek()?.k === 'op' && peek().v === '^') { take(); const b = unary(); return (e) => Math.pow(a(e), b(e)); }
    return a;
  }
  function atom() {
    const tk = peek();
    if (!tk) throw new Error('the formula ends too early');
    if (tk.k === 'num') { take(); const v = tk.v; return () => v; }
    if (tk.k === 'op' && tk.v === '(') { take(); const a = expr(); take(')'); return a; }
    if (tk.k === 'id') {
      take();
      const name = tk.v.toLowerCase();
      if (name === 't') return (e) => e.t;
      // Own properties only: names such as "constructor" must not resolve.
      if (Object.hasOwn(CONST, name)) { const v = CONST[name]; return () => v; }
      const arity = Object.hasOwn(FN1, name) ? 1 : Object.hasOwn(FN2, name) ? 2 : Object.hasOwn(FN3, name) ? 3 : 0;
      if (!arity && opts.vars && peek()?.v !== '(') { const v = tk.v; return (e) => (Object.hasOwn(e, v) ? e[v] : NaN); }
      if (!arity) throw new Error(`unknown name "${tk.v}"; use t, pi, e or a function such as sin, exp, step`);
      take('(');
      const args = [expr()];
      while (args.length < arity) { take(','); args.push(expr()); }
      take(')');
      const [a, b, c] = args;
      if (arity === 1) { const f = FN1[name]; return (e) => f(a(e)); }
      if (arity === 2) { const f = FN2[name]; return (e) => f(a(e), b(e)); }
      const f = FN3[name]; return (e) => f(a(e), b(e), c(e));
    }
    throw new Error(`unexpected "${tk.v}"`);
  }

  if (!toks.length) throw new Error('enter a formula in t, for example 0.5*sin(2*pi*t)');
  const f = expr();
  if (i < toks.length) throw new Error(`unexpected "${toks[i].v}"`);
  if (opts.vars) return f;
  const env = { t: 0 };
  return (t) => { env.t = t; const v = f(env); return Number.isFinite(v) ? v : 0; };
}
