// 아주 작은 "무손실" XML 트리 파서/직렬화기 (v7.22.0, 양식 문서의 .docx 편집용).
// DOMParser를 쓰지 않는 이유: Node 단위 테스트와 브라우저에서 똑같이 동작해야 하고, 직렬화 시 원본 문서의
// 네임스페이스 선언·속성 순서·주석·텍스트를 그대로 보존해야 서식이 깨지지 않기 때문이다.
//   · 요소 {t:'el', name, attrs:[[이름, 원문값, 따옴표]], children, self}
//   · 텍스트 {t:'text', raw}(이스케이프된 원문), 그 밖(선언/주석/CDATA/DOCTYPE) {t:'raw', raw}
// 일반 <script>로 로드하면 window.XmlTree, Node에서 eval해도 globalThis.XmlTree로 등록된다.
(function () {
  const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
  function decode(s) {
    return String(s).replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, g) => {
      if (g[0] === '#') {
        const code = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
        try { return String.fromCodePoint(code); } catch (e) { return m; }
      }
      return Object.prototype.hasOwnProperty.call(ENT, g) ? ENT[g] : m;
    });
  }
  function escText(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escAttr(s) {
    return escText(s).replace(/"/g, '&quot;');
  }

  function parse(xml) {
    const root = { t: 'root', children: [] };
    const stack = [root];
    const top = () => stack[stack.length - 1];
    let i = 0;
    const n = xml.length;
    while (i < n) {
      if (xml[i] !== '<') {
        let j = xml.indexOf('<', i);
        if (j === -1) j = n;
        top().children.push({ t: 'text', raw: xml.slice(i, j) });
        i = j;
        continue;
      }
      if (xml.startsWith('<!--', i)) {
        const j = xml.indexOf('-->', i + 4);
        const end = j === -1 ? n : j + 3;
        top().children.push({ t: 'raw', raw: xml.slice(i, end) });
        i = end;
      } else if (xml.startsWith('<![CDATA[', i)) {
        const j = xml.indexOf(']]>', i + 9);
        const end = j === -1 ? n : j + 3;
        top().children.push({ t: 'raw', raw: xml.slice(i, end) });
        i = end;
      } else if (xml.startsWith('<?', i)) {
        const j = xml.indexOf('?>', i + 2);
        const end = j === -1 ? n : j + 2;
        top().children.push({ t: 'raw', raw: xml.slice(i, end) });
        i = end;
      } else if (xml.startsWith('<!', i)) {
        let depth = 0;
        let j = i;
        for (; j < n; j++) {
          if (xml[j] === '<') depth++;
          else if (xml[j] === '>') { depth--; if (depth === 0) break; }
        }
        top().children.push({ t: 'raw', raw: xml.slice(i, j + 1) });
        i = j + 1;
      } else if (xml[i + 1] === '/') {
        const j = xml.indexOf('>', i);
        if (stack.length > 1) stack.pop();
        i = j === -1 ? n : j + 1;
      } else {
        // 여는 태그: 속성값 안의 '>'를 고려해 따옴표를 추적하며 끝을 찾는다.
        let j = i + 1;
        let q = null;
        for (; j < n; j++) {
          const ch = xml[j];
          if (q) { if (ch === q) q = null; } else if (ch === '"' || ch === "'") q = ch; else if (ch === '>') break;
        }
        let inner = xml.slice(i + 1, j);
        const self = inner.endsWith('/');
        if (self) inner = inner.slice(0, -1);
        const m = /^([^\s/>]+)/.exec(inner);
        const name = m ? m[1] : '';
        const attrs = [];
        const re = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
        let am;
        const rest = inner.slice(name.length);
        while ((am = re.exec(rest))) attrs.push(am[2] !== undefined ? [am[1], am[2], '"'] : [am[1], am[3], "'"]);
        const node = { t: 'el', name, attrs, children: [], self };
        top().children.push(node);
        if (!self) stack.push(node);
        i = j + 1;
      }
    }
    return root;
  }

  function serialize(node) {
    if (node.t === 'text' || node.t === 'raw') return node.raw;
    if (node.t === 'root') return node.children.map(serialize).join('');
    let s = `<${node.name}`;
    for (const [k, v, q] of node.attrs) s += ` ${k}=${q || '"'}${v}${q || '"'}`;
    if (!node.children.length && node.self) return `${s}/>`;
    return `${s}>${node.children.map(serialize).join('')}</${node.name}>`;
  }

  // ---- 조회 ----
  const isEl = (n) => n && n.t === 'el';
  function getAttr(node, name) {
    const a = node.attrs.find((x) => x[0] === name);
    return a ? decode(a[1]) : null;
  }
  function setAttr(node, name, value) {
    const a = node.attrs.find((x) => x[0] === name);
    if (a) a[1] = escAttr(value);
    else node.attrs.push([name, escAttr(value), '"']);
  }
  function childEls(node, name) {
    return node.children.filter((c) => isEl(c) && (!name || c.name === name));
  }
  function firstChild(node, name) {
    return node.children.find((c) => isEl(c) && c.name === name) || null;
  }
  /** 문서 순서로 모든 후손 중 이름이 맞는 요소(name 생략 시 전부). skip(node)가 true면 그 하위는 건너뜀. */
  function descendants(node, name, skip) {
    const out = [];
    (function walk(n) {
      for (const c of n.children || []) {
        if (!isEl(c)) continue;
        if (skip && skip(c)) continue;
        if (!name || c.name === name) out.push(c);
        walk(c);
      }
    })(node);
    return out;
  }
  function textOf(node) {
    if (node.t === 'text') return decode(node.raw);
    if (node.t !== 'el' && node.t !== 'root') return '';
    return node.children.map(textOf).join('');
  }
  function setText(node, text) {
    node.children = text === '' ? [] : [{ t: 'text', raw: escText(text) }];
    node.self = false;
  }
  function el(name, attrs = {}, children = []) {
    return {
      t: 'el', name, attrs: Object.entries(attrs).map(([k, v]) => [k, escAttr(v), '"']), children: [].concat(children), self: !children.length,
    };
  }
  function clone(node) {
    if (node.t === 'text' || node.t === 'raw') return { ...node };
    const c = { ...node, children: (node.children || []).map(clone) };
    if (node.attrs) c.attrs = node.attrs.map((a) => a.slice());
    return c;
  }
  function remove(parent, child) {
    const i = parent.children.indexOf(child);
    if (i !== -1) parent.children.splice(i, 1);
    return i;
  }
  function insertAfter(parent, ref, node) {
    const i = parent.children.indexOf(ref);
    parent.children.splice(i === -1 ? parent.children.length : i + 1, 0, node);
    parent.self = false;
  }
  function parentMap(root) {
    const map = new Map();
    (function walk(n) { for (const c of n.children || []) { map.set(c, n); if (isEl(c)) walk(c); } })(root);
    return map;
  }

  const api = { parse, serialize, decode, escText, escAttr, isEl, getAttr, setAttr, childEls, firstChild, descendants, textOf, setText, el, clone, remove, insertAfter, parentMap };
  globalThis.XmlTree = api;
  if (typeof window !== 'undefined') window.XmlTree = api;
})();
