// v7.24.0 — 한글(.hwpx) 양식 → .docx 변환 다리. 일반 <script>(Node 테스트에서는 globalThis).
// HWPX는 zip + XML이라 브라우저에서 바로 읽을 수 있다. 표(병합 포함)와 문단 글자만 옮겨 docx를 만들고,
// 이후는 기존 Word 양식 엔진이 그대로 처리한다. 결과 .docx는 한글에서 열어 .hwp/.hwpx로 다시 저장할 수 있다.
// 한계: 그림·도형·글상자·머리말 등은 옮기지 않는다. 바이너리 .hwp(OLE)는 읽지 않는다 → 한글에서 .hwpx로 저장하도록 안내.
(function () {
  const XT = globalThis.XmlTree;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const local = (n) => String(n).replace(/^.*:/, '');
  class HwpError extends Error {}

  // 문단(hp:p)의 글자: hp:t 안의 텍스트 + tab/lineBreak. 표(hp:tbl)는 건너뛴다(별도 처리).
  function paraText(p) {
    let s = '';
    (function walk(n) {
      for (const c of n.children || []) {
        if (!XT.isEl(c)) { if (c.t === 'text') s += XT.decode(c.raw); continue; }
        const ln = local(c.name);
        if (ln === 'tbl' || ln === 'pic' || ln === 'rect' || ln === 'ctrl' || ln === 'secPr' || ln === 'linesegarray') continue;
        if (ln === 'tab') s += '\t';
        else if (ln === 'lineBreak') s += '\n';
        else if (ln === 't' || ln === 'run' || ln === 'p') walk(c);
        else walk(c);
      }
    })(p);
    return s;
  }
  function childrenByLocal(node, ln) { return (node.children || []).filter((c) => XT.isEl(c) && local(c.name) === ln); }
  function firstByLocal(node, ln) { return childrenByLocal(node, ln)[0] || null; }
  function descByLocal(node, ln) { return XT.descendants(node, null).filter((c) => local(c.name) === ln); }
  const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; };
  const numAttr = (node, name, d) => { if (!node) return d; const a = node.attrs.find((x) => local(x[0]) === name); return a ? num(XT.decode(a[1]), d) : d; };
  const numAttr0 = (node, name) => { if (!node) return 0; const a = node.attrs.find((x) => local(x[0]) === name); const n = a ? parseInt(XT.decode(a[1]), 10) : 0; return Number.isFinite(n) && n >= 0 ? n : 0; };

  const para = (text) => {
    const lines = String(text).split('\n');
    const runs = lines.map((ln, i) => `${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${esc(ln)}</w:t>`).join('');
    return `<w:p><w:r>${runs}</w:r></w:p>`;
  };

  // 컨테이너(본문/셀 subList)의 문단들을 docx XML로. 문단 안에 표가 있으면 표를 그 자리에 낸다(셀 안 표는 글자만 평탄화).
  function containerXml(node, nested) {
    let out = '';
    for (const p of childrenByLocal(node, 'p')) {
      const t = paraText(p);
      const tbls = descByLocal(p, 'tbl').filter((tb) => !descByLocal(p, 'tbl').some((o) => o !== tb && XT.descendants(o, null).includes(tb)));
      if (t.trim() || !tbls.length) out += para(t);
      for (const tb of tbls) out += nested ? flattenTable(tb) : tableXml(tb);
    }
    return out;
  }
  function flattenTable(tbl) {
    let out = '';
    for (const tr of childrenByLocal(tbl, 'tr')) {
      const cells = childrenByLocal(tr, 'tc').map((tc) => descByLocal(tc, 'p').map(paraText).filter((x) => x.trim()).join(' ')).filter(Boolean);
      if (cells.length) out += para(cells.join(' | '));
    }
    return out;
  }

  function tableXml(tbl) {
    const trs = childrenByLocal(tbl, 'tr');
    const cells = [];
    let maxC = 0; let maxR = trs.length;
    trs.forEach((tr, ri) => {
      let ci = 0;
      for (const tc of childrenByLocal(tr, 'tc')) {
        const addr = firstByLocal(tc, 'cellAddr');
        const span = firstByLocal(tc, 'cellSpan');
        const r = addr ? numAttr0(addr, 'rowAddr') : ri;
        const c = addr ? numAttr0(addr, 'colAddr') : ci;
        const cs = numAttr(span, 'colSpan', 1); const rs = numAttr(span, 'rowSpan', 1);
        cells.push({ tc, r, c, cs, rs });
        ci = c + cs;
        maxC = Math.max(maxC, c + cs); maxR = Math.max(maxR, r + rs);
      }
    });
    if (!cells.length) return '';
    const grid = Array.from({ length: maxR }, () => Array(maxC).fill(null));
    for (const cell of cells) {
      for (let dr = 0; dr < cell.rs; dr++) for (let dc = 0; dc < cell.cs; dc++) {
        if (grid[cell.r + dr] && cell.c + dc < maxC) grid[cell.r + dr][cell.c + dc] = { cell, dr, dc };
      }
    }
    let rows = '';
    for (let r = 0; r < maxR; r++) {
      let tcs = '';
      for (let c = 0; c < maxC;) {
        const g = grid[r][c];
        if (!g) { tcs += `<w:tc><w:tcPr><w:tcW w:w="1000" w:type="dxa"/></w:tcPr><w:p/></w:tc>`; c += 1; continue; }
        if (g.dc > 0) { c += 1; continue; }
        const { cell } = g;
        const pr = `<w:tcPr><w:tcW w:w="${Math.max(1, cell.cs) * 1500}" w:type="dxa"/>${cell.cs > 1 ? `<w:gridSpan w:val="${cell.cs}"/>` : ''}${cell.rs > 1 ? (g.dr === 0 ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>') : ''}</w:tcPr>`;
        const sub = firstByLocal(cell.tc, 'subList') || cell.tc;
        const body = g.dr === 0 ? (containerXml(sub, true) || '<w:p/>') : '<w:p/>';
        tcs += `<w:tc>${pr}${body}</w:tc>`;
        c += cell.cs;
      }
      rows += `<w:tr>${tcs}</w:tr>`;
    }
    const b = (n) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`;
    return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(b).join('')}</w:tblBorders></w:tblPr><w:tblGrid>${Array(maxC).fill('<w:gridCol w:w="1500"/>').join('')}</w:tblGrid>${rows}</w:tbl><w:p/>`;
  }

  /** HWPX 바이트 → { bytes:Uint8Array(.docx), stats } */
  async function hwpxToDocx(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u8.length > 4 && u8[0] === 0xd0 && u8[1] === 0xcf && u8[2] === 0x11 && u8[3] === 0xe0) {
      throw new HwpError('바이너리 .hwp(구형)는 직접 읽지 못합니다 → 한글에서 "다른 이름으로 저장 → 한글 문서(*.hwpx)"로 저장한 뒤 올려 주세요.');
    }
    const JSZip = globalThis.JSZip;
    let zip;
    try { zip = await JSZip.loadAsync(u8); } catch { throw new HwpError('한글 문서(.hwpx)를 열 수 없습니다. 손상되었거나 .hwpx 형식이 아닙니다.'); }
    if (zip.file('Contents/encryption.xml') || zip.file(/encrypt/i).length) throw new HwpError('암호가 걸린 한글 문서는 지원하지 않습니다. 암호를 해제한 뒤 다시 시도해 주세요.');
    const names = Object.keys(zip.files).filter((n) => /^Contents\/section\d+\.xml$/.test(n))
      .sort((a, b) => parseInt(a.match(/(\d+)\.xml$/)[1], 10) - parseInt(b.match(/(\d+)\.xml$/)[1], 10));
    if (!names.length) throw new HwpError('한글 문서(.hwpx) 구조가 아닙니다(Contents/section0.xml 없음).');
    let body = ''; let tables = 0; let paragraphs = 0;
    for (const n of names) {
      const root = XT.parse(await zip.file(n).async('string'));
      const top = root.children.find((c) => XT.isEl(c));
      if (!top) continue;
      tables += descByLocal(top, 'tbl').length;
      paragraphs += childrenByLocal(top, 'p').length;
      body += containerXml(top, false);
    }
    const out = new JSZip();
    out.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    out.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    out.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`);
    const docx = await out.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    return { bytes: docx, stats: { tables, paragraphs } };
  }

  const api = { HwpError, hwpxToDocx };
  globalThis.HwpBridge = api;
  if (typeof window !== 'undefined') window.HwpBridge = api;
})();
