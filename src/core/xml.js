// A small XML reader, enough for robot descriptions (URDF): elements,
// attributes, text, comments, CDATA, the prolog and the five named entities
// plus numeric ones. Node has no DOMParser, and the page and the tests share
// this code. No DTDs, no namespaces beyond keeping prefixed names as written.
//
//   parseXml(text) -> { name, attrs: { … }, children: [element, …], text, line }
//
// A malformed document is refused with a sentence that names the line.

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decode(s, line) {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);?/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    if (!(e in ENTITIES) || !m.endsWith(';')) throw new Error(`XML, line ${line}: unknown entity "${m}"`);
    return ENTITIES[e];
  });
}

export function parseXml(text) {
  let i = 0;
  const n = text.length;
  // Line numbers are counted forwards from the last position asked for.
  let lk = 0, ll = 1;
  const lineAt = (k) => {
    if (k < lk) { lk = 0; ll = 1; }
    for (; lk < k; lk++) if (text.charCodeAt(lk) === 10) ll++;
    return ll;
  };
  const fail = (msg, k = i) => { throw new Error(`XML, line ${lineAt(k)}: ${msg}`); };
  const stack = [];
  let root = null;
  while (i < n) {
    const lt = text.indexOf('<', i);
    const chunk = text.slice(i, lt < 0 ? n : lt);
    if (stack.length) stack[stack.length - 1].text += decode(chunk, lineAt(i));
    else if (chunk.trim()) fail('text outside the root element');
    if (lt < 0) break;
    i = lt;
    if (text.startsWith('<!--', i)) {
      const e = text.indexOf('-->', i + 4);
      if (e < 0) fail('a comment is not closed');
      i = e + 3;
    } else if (text.startsWith('<![CDATA[', i)) {
      const e = text.indexOf(']]>', i);
      if (e < 0) fail('a CDATA section is not closed');
      if (!stack.length) fail('CDATA outside the root element');
      stack[stack.length - 1].text += text.slice(i + 9, e);
      i = e + 3;
    } else if (text.startsWith('<?', i)) {
      const e = text.indexOf('?>', i);
      if (e < 0) fail('a processing instruction is not closed');
      i = e + 2;
    } else if (text.startsWith('<!', i)) {
      fail('document type declarations are not read');
    } else if (text[i + 1] === '/') {
      const m = /^<\/([^\s>]+)\s*>/.exec(text.slice(i, i + 200));
      if (!m) fail('a malformed closing tag');
      const open = stack.pop();
      if (!open || open.name !== m[1]) fail(open ? `</${m[1]}> closes <${open.name}>` : `</${m[1]}> closes nothing`);
      i += m[0].length;
    } else {
      const start = i;
      const m = /^<([A-Za-z_][\w.:-]*)/.exec(text.slice(i, i + 200));
      if (!m) fail('a malformed tag');
      const el = { name: m[1], attrs: {}, children: [], text: '', line: lineAt(start) };
      i += m[0].length;
      const attr = /\s*([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')|\s*(\/?>)/y;
      for (;;) {
        attr.lastIndex = i;
        const a = attr.exec(text);
        if (!a) fail(`a malformed attribute in <${el.name}>`);
        i = attr.lastIndex;
        if (a[5]) {
          if (stack.length) stack[stack.length - 1].children.push(el);
          else if (root) fail('a second root element', start);
          else root = el;
          if (a[5] === '>') stack.push(el);
          break;
        }
        if (a[1] in el.attrs) fail(`<${el.name}> has two "${a[1]}" attributes`);
        el.attrs[a[1]] = decode(a[3] ?? a[4], el.line);
      }
    }
  }
  if (stack.length) fail(`<${stack[stack.length - 1].name}> is not closed`, n);
  if (!root) throw new Error('XML: no element');
  return root;
}

// The children of an element with a given name.
export const xmlChildren = (el, name) => el.children.filter((c) => c.name === name);
export const xmlChild = (el, name) => el.children.find((c) => c.name === name) ?? null;
