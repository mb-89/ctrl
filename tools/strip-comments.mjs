// Removes the comments from a JavaScript source, keeping its code, strings,
// template literals and regular expressions as they are, and its line breaks
// (so error positions stay near the source's). The page is built without
// comments: they are for the repository, not for whoever opens the page.

const REGEX_AFTER = new Set([...'(,=:[!&|?{};+-*%<>~^']);
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);

export function stripComments(src) {
  let out = '', i = 0, last = '';   // last: the previous significant token's last character, or a keyword
  const n = src.length;
  // Inside template literals: the brace depth of each ${ … } we are in.
  const braces = [];
  const word = () => { const m = /[A-Za-z_$][\w$]*$/.exec(out.trimEnd()); return m ? m[0] : ''; };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && (d === '/' || d === '*')) {
      const end = d === '/' ? src.indexOf('\n', i) : src.indexOf('*/', i + 2) + 2;
      i = end < (d === '/' ? 0 : 2) ? n : end;
      // A comment on a line of its own takes the line with it.
      const lineStart = out.lastIndexOf('\n') + 1;
      if (/^[ \t]*$/.test(out.slice(lineStart)) && (src[i] === '\n' || i >= n)) { out = out.slice(0, lineStart); i++; }
      else if (d === '*') out += ' ';
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      out += src.slice(i, j + 1); i = j + 1; last = c; continue;
    }
    if (c === '`') { i = template(i); last = out.endsWith('${') ? '{' : '`'; continue; }
    if (c === '/' && (REGEX_AFTER.has(last) || last === '' || REGEX_KEYWORDS.has(word()))) {
      let j = i + 1, cls = false;
      while (j < n && (src[j] !== '/' || cls)) {
        if (src[j] === '\\') j++;
        else if (src[j] === '[') cls = true;
        else if (src[j] === ']') cls = false;
        else if (src[j] === '\n') break;
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(src[j])) j++;
      out += src.slice(i, j); i = j; last = 'x'; continue;
    }
    if (c === '}' && braces.length && braces[braces.length - 1] === 0) {
      // The end of a ${ … } inside a template literal: back into the template.
      braces.pop(); out += c; i = template(i, true); last = out.endsWith('${') ? '{' : '`'; continue;
    }
    if (c === '{' && braces.length) braces[braces.length - 1]++;
    if (c === '}' && braces.length) braces[braces.length - 1]--;
    out += c;
    if (!/\s/.test(c)) last = /[\w$]/.test(c) ? 'x' : c;
    i++;
  }
  return out;

  // Copies a template literal from its opening backtick (or, resumed, from
  // the } that closed an expression) up to its end or the next ${, which
  // pushes a brace counter so the expression is scanned as code.
  function template(k, resumed = false) {
    let j = k + 1;
    if (!resumed) out += '`';
    while (j < n) {
      const t = src[j];
      if (t === '\\') { out += src.slice(j, j + 2); j += 2; continue; }
      if (t === '`') { out += t; return j + 1; }
      if (t === '$' && src[j + 1] === '{') { out += '${'; braces.push(0); return j + 2; }
      out += t; j++;
    }
    return j;
  }
}
