// 양식 문서 엔진 (v7.22.0) — ExcelJS(.xlsx)와 JSZip + 직접 XML 편집(.docx)으로 양식을 읽고 채우고 미리보기를 만든다.
// 모든 처리는 브라우저 안에서만 이루어진다(파일을 어떤 서버/서드파티에도 올리지 않는다).
// 라이브러리는 전역 window.ExcelJS / window.JSZip(js/vendor, 양식 문서 탭을 열 때 지연 로딩)을 호출 시점에 참조한다.
// 일반 <script>로 로드되면 window.FormEngine, Node 테스트에서는 globalThis.FormEngine.
(function () {
  const FT = globalThis.FormTemplate;
  const XT = globalThis.XmlTree;
  const g = () => globalThis;

  // ------------------------------------------------------------------
  // 유틸
  // ------------------------------------------------------------------
  class FormError extends Error {}

  function toU8(bytes) { return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); }
  function bytesToBase64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return g().btoa(s);
  }
  function base64ToBytes(b64) {
    const bin = g().atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function dataUrlToBytes(dataUrl) {
    const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl || '');
    if (!m) throw new FormError('이미지 데이터를 읽을 수 없습니다.');
    return { bytes: m[2] ? base64ToBytes(m[3]) : new TextEncoder().encode(decodeURIComponent(m[3])), mime: m[1] };
  }

  /** PNG/JPEG/GIF 헤더에서 크기를 읽는다. 지원하지 않는 형식이면 null. */
  function imageInfo(bytes) {
    const b = toU8(bytes);
    if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      return { ext: 'png', mime: 'image/png', w: dv.getUint32(16), h: dv.getUint32(20) };
    }
    if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { ext: 'gif', mime: 'image/gif', w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) };
    if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        if (marker === 0xff) { i++; continue; }
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { ext: 'jpeg', mime: 'image/jpeg', h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
        i += 2 + ((b[i + 2] << 8) | b[i + 3]);
      }
      return { ext: 'jpeg', mime: 'image/jpeg', w: 0, h: 0 };
    }
    return null;
  }

  // ------------------------------------------------------------------
  // 파일 검사 / 종류 판별
  // ------------------------------------------------------------------
  // [변환 대상, 안내] — 메시지 형식: "이 형식은 지원하지 않습니다: .doc → .docx로 저장 후 다시 시도"
  const UNSUPPORTED = {
    doc: ['.docx', 'Word에서 "다른 이름으로 저장 → Word 문서(*.docx)"를 선택하세요.'],
    xls: ['.xlsx', 'Excel에서 "다른 이름으로 저장 → Excel 통합 문서(*.xlsx)"를 선택하세요.'],
    xlsm: ['.xlsx', '매크로가 있는 파일은 지원하지 않습니다. 매크로를 뺀 .xlsx로 저장하세요.'],
    xlsb: ['.xlsx', 'Excel에서 .xlsx로 저장하세요.'],
    docm: ['.docx', '매크로가 있는 파일은 지원하지 않습니다. 매크로를 뺀 .docx로 저장하세요.'],
    pdf: ['.docx/.xlsx 원본', 'PDF(스캔 포함)는 글자 칸을 찾을 수 없습니다. 원본 Word/Excel 양식 파일을 사용하세요.'],
    hwp: ['.hwpx', '구형 .hwp는 직접 읽지 못합니다. 한글에서 "다른 이름으로 저장 → 한글 문서(*.hwpx)"로 저장해 올리세요(또는 .docx로 저장).'],
    odt: ['.docx', '.docx로 저장하세요.'],
    ods: ['.xlsx', '.xlsx로 저장하세요.'],
    csv: ['.xlsx', 'CSV는 서식이 없어 양식으로 쓸 수 없습니다. .xlsx로 저장하세요.'],
  };
  /** @returns {{ok:boolean, kind?:'xlsx'|'docx', message?:string}} 확장자만으로 1차 판별 */
  function checkFileName(name) {
    const ext = String(name || '').split('.').pop().toLowerCase();
    if (ext === 'xlsx') return { ok: true, kind: 'xlsx' };
    if (ext === 'docx') return { ok: true, kind: 'docx' };
    if (ext === 'hwpx') return { ok: true, kind: 'docx', convert: 'hwpx' };
    if (UNSUPPORTED[ext]) return { ok: false, message: `이 형식은 지원하지 않습니다: .${ext} → ${UNSUPPORTED[ext][0]}로 저장 후 다시 시도해 주세요. ${UNSUPPORTED[ext][1]}` };
    return { ok: false, message: `이 형식은 지원하지 않습니다: .${ext || '(확장자 없음)'} → Excel(.xlsx), Word(.docx), 한글(.hwpx) 양식만 가져올 수 있습니다.` };
  }
  const MB = 1024 * 1024;
  async function openZip(bytes, kind) {
    const u8 = toU8(bytes);
    if (u8.length > 10 * MB) throw new FormError(`파일이 너무 큽니다(${(u8.length / MB).toFixed(1)}MB). 양식 파일은 10MB까지 지원합니다.`);
    if (u8.length > 4 && u8[0] === 0xd0 && u8[1] === 0xcf && u8[2] === 0x11 && u8[3] === 0xe0) {
      throw new FormError('이 파일은 암호가 걸렸거나 구형(.doc/.xls) 형식입니다 → 암호를 해제하고 .docx/.xlsx로 저장한 뒤 다시 시도해 주세요.');
    }
    let zip;
    try { zip = await g().JSZip.loadAsync(u8); } catch (e) { throw new FormError('파일을 열 수 없습니다. 손상되었거나 .docx/.xlsx 형식이 아닙니다.'); }
    if (kind === 'docx' && !zip.file('word/document.xml')) throw new FormError('Word 문서(.docx) 구조가 아닙니다(word/document.xml 없음).');
    if (kind === 'xlsx' && !zip.file('xl/workbook.xml')) throw new FormError('Excel 문서(.xlsx) 구조가 아닙니다(xl/workbook.xml 없음).');
    if (zip.file(/vbaProject\.bin$/).length) throw new FormError('매크로가 포함된 파일은 지원하지 않습니다 → 매크로를 제거한 .docx/.xlsx로 저장해 주세요.');
    return zip;
  }

  // ------------------------------------------------------------------
  // DOCX
  // ------------------------------------------------------------------
  async function loadDocx(bytes) {
    const zip = await openZip(bytes, 'docx');
    const names = Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n)).sort((a, b) => (a === 'word/document.xml' ? -1 : b === 'word/document.xml' ? 1 : a.localeCompare(b)));
    const parts = [];
    for (const name of names) parts.push({ name, root: XT.parse(await zip.file(name).async('string')) });
    const model = FT.buildDocxModel(parts);
    return { zip, parts, model };
  }

  const W = (n) => `w:${n}`;
  /** 문단의 텍스트 조각(순서 = FormTemplate.paraText와 동일) */
  function paraSegs(p) {
    const segs = [];
    (function walk(n) {
      for (const c of n.children) {
        if (!XT.isEl(c)) continue;
        if (c.name === 'w:t') segs.push({ t: 'text', node: c, text: XT.textOf(c) });
        else if (c.name === 'w:tab') segs.push({ t: 'special', text: '\t' });
        else if (c.name === 'w:br' || c.name === 'w:cr') segs.push({ t: 'special', text: '\n' });
        else if (c.name === 'w:del' || c.name === 'w:pPr' || c.name === 'mc:Fallback') continue;
        else walk(c);
      }
    })(p);
    return segs;
  }
  function writeT(node, text) {
    XT.setText(node, text);
    XT.setAttr(node, 'xml:space', 'preserve');
  }
  function runOf(node, parents) { let n = node; while (n && !(XT.isEl(n) && n.name === 'w:r')) n = parents.get(n); return n; }
  
  function makeRun(rPr, text) {
    const kids = [];
    if (rPr) kids.push(XT.clone(rPr));
    const lines = String(text).split(/\r?\n/);
    lines.forEach((ln, i) => {
      if (i > 0) kids.push(XT.el('w:br'));
      const t = XT.el('w:t', {}, []);
      writeT(t, ln);
      kids.push(t);
    });
    return XT.el('w:r', {}, kids);
  }
  function paragraphRPr(p) {
    const pPr = XT.firstChild(p, 'w:pPr');
    const rpr = pPr && XT.firstChild(pPr, 'w:rPr');
    if (rpr) {
      const c = XT.clone(rpr);
      c.children = c.children.filter((x) => !(XT.isEl(x) && (x.name === 'w:ins' || x.name === 'w:del' || x.name === 'w:rPrChange')));
      return c;
    }
    // 마지막 run의 서식
    const runs = XT.descendants(p, 'w:r');
    for (let i = runs.length - 1; i >= 0; i--) { const r = XT.firstChild(runs[i], 'w:rPr'); if (r) return r; }
    return null;
  }

  /** 문단 텍스트 범위 [s,e)를 text로 바꾼다(첫 영향 run의 서식 유지). 줄바꿈은 <w:br/>. 문단에 텍스트가 없으면 새 run 생성. */
  function replaceRange(p, s, e, text, parents) {
    const segs = paraSegs(p);
    let pos = 0;
    for (const sg of segs) { sg.start = pos; pos += sg.text.length; sg.end = pos; }
    const total = pos;
    s = Math.max(0, Math.min(s, total));
    e = Math.max(s, Math.min(e, total));
    const tsegs = segs.filter((x) => x.t === 'text');
    if (!tsegs.length) {
      p.children.push(makeRun(paragraphRPr(p), text));
      p.self = false;
      return;
    }
    const overl = tsegs.filter((x) => x.end > s && x.start < e);
    let target;
    let at;
    if (overl.length) { target = overl[0]; at = Math.max(s, target.start) - target.start; } else {
      // 순수 삽입(빈 범위): s 직전 글자가 속한 조각(없으면 s 이후 첫 조각)
      target = [...tsegs].reverse().find((x) => x.start < s) || tsegs[0];
      at = target.start < s ? Math.min(s, target.end) - target.start : 0;
      if (s === total) { target = tsegs[tsegs.length - 1]; at = target.text.length; }
    }
    // 겹친 조각에서 범위 제거
    for (const sg of overl) {
      const ls = Math.max(s, sg.start) - sg.start;
      const le = Math.min(e, sg.end) - sg.start;
      sg.text = sg.text.slice(0, ls) + sg.text.slice(le);
      if (sg === target) at = ls;
    }
    const lines = String(text).split(/\r?\n/);
    const head = target.text.slice(0, at);
    const tail = target.text.slice(at);
    if (lines.length === 1) {
      target.text = head + lines[0] + tail;
    } else {
      target.text = head + lines[0];
      let prev = target.node;
      const run = runOf(target.node, parents);
      const holder = run || p;
      lines.slice(1).forEach((ln, i) => {
        const br = XT.el('w:br');
        const t = XT.el('w:t', {}, []);
        writeT(t, i === lines.length - 2 ? ln + tail : ln);
        XT.insertAfter(holder, prev, br);
        XT.insertAfter(holder, br, t);
        prev = t;
      });
    }
    for (const sg of tsegs) writeT(sg.node, sg.text);
  }
  function setParagraphText(p, text, parents) {
    const total = FT.paraText(p).length;
    replaceRange(p, 0, total, text, parents);
  }
  const firstPara = (tc) => XT.childEls(tc, 'w:p')[0] || null;

  function cloneBlankRow(tr) {
    const c = XT.clone(tr);
    (function strip(n) {
      n.children = n.children.filter((x) => !(XT.isEl(x) && ['w:bookmarkStart', 'w:bookmarkEnd', 'w:drawing', 'w:pict', 'w:sdt'].includes(x.name)));
      for (const k of n.children) if (XT.isEl(k)) { if (k.name === 'w:t') XT.setText(k, ''); else strip(k); }
    })(c);
    return c;
  }

  function twipToEmu(tw) { return Math.round(tw * 635); }
  function drawingRun(rid, cx, cy, id, name) {
    const xml = `<w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="${name}" descr="증명사진"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    return XT.parse(xml).children.find(XT.isEl);
  }
  function fitEmu(info, boxWEmu) {
    // 기본 3x4cm(증명사진) — 이미지 비율을 지키고, 칸 너비를 넘으면 줄인다.
    const aspect = info.w && info.h ? info.w / info.h : 3 / 4;
    let hE = 1440000; // 4cm
    let wE = Math.round(hE * aspect);
    if (boxWEmu && wE > boxWEmu) { wE = boxWEmu; hE = Math.round(wE / aspect); }
    return { cx: wE, cy: hE };
  }
  function setParaCenter(p) {
    let pPr = XT.firstChild(p, 'w:pPr');
    if (!pPr) { pPr = XT.el('w:pPr', {}, []); p.children.unshift(pPr); p.self = false; }
    const jc = XT.firstChild(pPr, 'w:jc');
    if (jc) { XT.setAttr(jc, 'w:val', 'center'); return; }
    const node = XT.el('w:jc', { 'w:val': 'center' });
    const rpr = XT.firstChild(pPr, 'w:rPr');
    const idx = rpr ? pPr.children.indexOf(rpr) : pPr.children.length;
    pPr.children.splice(idx, 0, node);
    pPr.self = false;
  }

  async function ensureDocxImage(ctx, photo) {
    if (ctx.photoRel) return ctx.photoRel;
    const { zip } = ctx;
    const relsPath = 'word/_rels/document.xml.rels';
    const relsFile = zip.file(relsPath);
    const rels = relsFile ? XT.parse(await relsFile.async('string')) : XT.parse('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
    const root = rels.children.find(XT.isEl);
    let max = 0;
    for (const r of XT.childEls(root, 'Relationship')) { const m = /^rId(\d+)$/.exec(XT.getAttr(r, 'Id') || ''); if (m) max = Math.max(max, +m[1]); }
    const rid = `rId${max + 1}`;
    const target = `media/formphoto_${ctx.photoSeq}.${photo.info.ext}`;
    root.children.push(XT.el('Relationship', { Id: rid, Type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', Target: target }));
    root.self = false;
    zip.file(relsPath, XT.serialize(rels));
    zip.file(`word/${target}`, photo.bytes);
    // [Content_Types].xml 에 확장자 기본 타입 보장
    const ctPath = '[Content_Types].xml';
    const ct = XT.parse(await zip.file(ctPath).async('string'));
    const ctRoot = ct.children.find(XT.isEl);
    const has = XT.childEls(ctRoot, 'Default').some((d) => (XT.getAttr(d, 'Extension') || '').toLowerCase() === photo.info.ext);
    if (!has) { ctRoot.children.unshift(XT.el('Default', { Extension: photo.info.ext, ContentType: photo.info.mime })); ctRoot.self = false; zip.file(ctPath, XT.serialize(ct)); }
    ctx.photoRel = rid;
    return rid;
  }

  /** docx 채우기(트리 수정까지). ctx: { zip, parts, model, highlights:Set, overflow:[...] } */
  async function applyDocx(loaded, mapping, values, extra) {
    const { zip, model } = loaded;
    const parents = new Map();
    for (const part of loaded.parts) for (const [k, v] of parentMap(part.root)) parents.set(k, v);
    const highlights = new Set();
    const notes = [];
    const opts = mapping.options || {};

    // 1) 반복 표
    for (const rep of mapping.repeats || []) {
      const t = model.tables[rep.target.ti];
      if (!t) continue;
      const rows = (values.repeats && values.repeats[rep.id]) || [];
      const { first, cap } = rep.target;
      const rowEls = [];
      for (let i = 0; i < cap; i++) rowEls.push({ tr: t.trs[first + i], gridRow: first + i });
      if (rows.length > cap) {
        if (opts.addRows !== false) {
          const last = t.trs[first + cap - 1];
          const parent = parents.get(last);
          let prev = last;
          for (let i = 0; i < rows.length - cap; i++) {
            const c = cloneBlankRow(last);
            XT.insertAfter(parent, prev, c);
            parents.set(c, parent);
            for (const [k, v] of parentMap(c)) parents.set(k, v);
            rowEls.push({ tr: c, gridRow: first + cap - 1, clone: true });
            prev = c;
          }
        } else notes.push(`${rep.title}: ${rows.length - cap}건이 양식 행 수(${cap})를 넘어 들어가지 못했습니다.`);
      }
      const n = Math.min(rows.length, rowEls.length);
      for (let i = 0; i < n; i++) {
        const { tr, gridRow } = rowEls[i];
        const tcs = XT.childEls(tr, 'w:tc');
        rep.cols.forEach((col, ci) => {
          const text = (rows[i].cells || [])[ci];
          if (text === undefined || text === null || text === '') return;
          const gc = t.rows[gridRow][col.c];
          const m = gc && !gc.virtual ? (gc.covered ? t.rows[gc.mr][gc.mc] : gc) : null;
          if (!m || !m.tc) return;
          const idx = XT.childEls(m.tr, 'w:tc').indexOf(m.tc);
          const tc = tcs[idx];
          const p = tc && firstPara(tc);
          if (!p) return;
          setParagraphText(p, String(text), parents);
          highlights.add(tc);
        });
      }
    }

    // 2) 개별 필드 — 같은 문단의 여러 범위는 뒤에서부터
    const ops = [];
    for (const f of mapping.fields || []) {
      if (f.kind === 'photo') continue;
      const val = values.scalars ? values.scalars[f.id] : '';
      const text = val == null ? '' : String(val);
      if (f.how !== 'placeholder' && text === '') continue;
      ops.push({ f, text });
    }
    ops.sort((a, b) => {
      const ka = a.f.target.k === 'para' ? a.f.target.pi : -1;
      const kb = b.f.target.k === 'para' ? b.f.target.pi : -1;
      if (ka !== kb) return ka - kb;
      return ((b.f.target.range || [0])[0]) - ((a.f.target.range || [0])[0]);
    });
    for (const { f, text } of ops) {
      const tg = f.target;
      if (tg.k === 'para') {
        const u = model.paras[tg.pi];
        if (!u) continue;
        replaceRange(u.el, tg.range[0], tg.range[1], text, parents);
        highlights.add(u.cell ? model.tables[u.cell.ti].rows[u.cell.r][u.cell.c].tc : u.el);
      } else {
        const cell = model.tables[tg.ti] && model.tables[tg.ti].rows[tg.r][tg.c];
        if (!cell || !cell.tc) continue;
        const p = firstPara(cell.tc);
        if (!p) continue;
        setParagraphText(p, text, parents);
        highlights.add(cell.tc);
      }
    }

    // 3) 사진
    for (const f of mapping.fields || []) {
      if (f.kind !== 'photo') continue;
      const photo = extra.photos && extra.photos[f.id];
      const tg = f.target;
      if (!photo) {
        if (f.how === 'placeholder') { const u = model.paras[tg.pi]; if (u) replaceRange(u.el, tg.range[0], tg.range[1], '', parents); }
        continue;
      }
      extra.ctxState.photoSeq = (extra.ctxState.photoSeq || 0) + 1;
      const rid = await ensureDocxImage({ zip, photoSeq: extra.ctxState.photoSeq }, photo);
      const idNum = 5000 + extra.ctxState.photoSeq;
      if (tg.k === 'cell') {
        const cell = model.tables[tg.ti].rows[tg.r][tg.c];
        const tcW = XT.firstChild(XT.firstChild(cell.tc, 'w:tcPr') || { children: [] }, 'w:tcW');
        const w = tcW ? parseInt(XT.getAttr(tcW, 'w:w') || '0', 10) : 0;
        const box = w ? Math.max(twipToEmu(w - 240), 360000) : 0;
        const { cx, cy } = fitEmu(photo.info, box);
        const p = firstPara(cell.tc);
        const run = drawingRun(rid, cx, cy, idNum, `증명사진${extra.ctxState.photoSeq}`);
        // 기존 문구("사진") 제거 후 그림 삽입
        for (const r of XT.descendants(p, 'w:r')) { const par = parents.get(r); if (par && par.name !== 'w:pPr') XT.remove(par, r); }
        p.children.push(run);
        p.self = false;
        parents.set(run, p);
        setParaCenter(p);
        highlights.add(cell.tc);
      } else {
        const u = model.paras[tg.pi];
        replaceRange(u.el, tg.range[0], tg.range[1], '', parents);
        const { cx, cy } = fitEmu(photo.info, 0);
        const run = drawingRun(rid, cx, cy, idNum, `증명사진${extra.ctxState.photoSeq}`);
        const segs = paraSegs(u.el).filter((x) => x.t === 'text');
        // 토큰 위치(앞쪽 텍스트 길이) 다음 run 뒤에 넣는다 — 앞쪽 글자 수만큼 지난 첫 run
        let acc = 0;
        let host = segs.length ? runOf(segs[0].node, parents) : null;
        for (const sg of segs) { if (acc >= tg.range[0]) break; host = runOf(sg.node, parents); acc += sg.text.length; }
        if (host && parents.get(host)) XT.insertAfter(parents.get(host), host, run);
        else { u.el.children.push(run); u.el.self = false; }
        highlights.add(u.el);
      }
    }
    return { highlights, notes };
  }
  function parentMap(root) { return XT.parentMap(root); }

  async function fillDocx(bytes, mapping, values, extra = {}) {
    const loaded = await loadDocx(bytes);
    extra.ctxState = {};
    const res = await applyDocx(loaded, mapping, values, extra);
    for (const part of loaded.parts) loaded.zip.file(part.name, XT.serialize(part.root));
    const out = await loaded.zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    return { bytes: out, notes: res.notes };
  }

  // ---- DOCX 미리보기(근사) ----
  async function docxMediaMap(zip, partName) {
    const map = {};
    const relsFile = zip.file('word/_rels/document.xml.rels');
    if (!relsFile) return map;
    const rels = XT.parse(await relsFile.async('string')).children.find(XT.isEl);
    for (const r of XT.childEls(rels, 'Relationship')) {
      const type = XT.getAttr(r, 'Type') || '';
      if (!/\/image$/.test(type)) continue;
      const target = XT.getAttr(r, 'Target');
      const f = zip.file(`word/${target}`.replace('word//', 'word/'));
      if (!f) continue;
      const u8 = await f.async('uint8array');
      const info = imageInfo(u8);
      if (info) map[XT.getAttr(r, 'Id')] = `data:${info.mime};base64,${bytesToBase64(u8)}`;
    }
    void partName;
    return map;
  }
  const escH = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function renderDocxHtml(parts, highlights, media) {
    function runHtml(r) {
      const rPr = XT.firstChild(r, 'w:rPr');
      const st = [];
      if (rPr) {
        const has = (n) => { const x = XT.firstChild(rPr, n); return x && XT.getAttr(x, 'w:val') !== '0' && XT.getAttr(x, 'w:val') !== 'false'; };
        if (has('w:b')) st.push('font-weight:700');
        if (has('w:i')) st.push('font-style:italic');
        const u = XT.firstChild(rPr, 'w:u');
        if (u && XT.getAttr(u, 'w:val') !== 'none') st.push('text-decoration:underline');
        if (has('w:strike')) st.push('text-decoration:line-through');
        const col = XT.firstChild(rPr, 'w:color');
        if (col && /^[0-9a-fA-F]{6}$/.test(XT.getAttr(col, 'w:val') || '')) st.push(`color:#${XT.getAttr(col, 'w:val')}`);
        const sz = XT.firstChild(rPr, 'w:sz');
        if (sz) st.push(`font-size:${Math.round((parseInt(XT.getAttr(sz, 'w:val') || '21', 10) / 2) * 1.333)}px`);
      }
      let inner = '';
      for (const c of r.children) {
        if (!XT.isEl(c)) continue;
        if (c.name === 'w:t') inner += escH(XT.textOf(c));
        else if (c.name === 'w:tab') inner += '&emsp;';
        else if (c.name === 'w:br') inner += '<br>';
        else if (c.name === 'w:drawing') {
          const blip = XT.descendants(c, 'a:blip')[0];
          const ext = XT.descendants(c, 'wp:extent')[0];
          const rid = blip && XT.getAttr(blip, 'r:embed');
          if (rid && media[rid]) {
            const cx = ext ? parseInt(XT.getAttr(ext, 'cx'), 10) / 9525 : 100;
            const cy = ext ? parseInt(XT.getAttr(ext, 'cy'), 10) / 9525 : 130;
            inner += `<img src="${media[rid]}" style="width:${Math.round(cx)}px;height:${Math.round(cy)}px;vertical-align:middle" alt="">`;
          }
        }
      }
      return inner ? `<span style="${st.join(';')}">${inner}</span>` : '';
    }
    function paraHtml(p) {
      const pPr = XT.firstChild(p, 'w:pPr');
      const st = [];
      if (pPr) {
        const jc = XT.firstChild(pPr, 'w:jc');
        const v = jc && XT.getAttr(jc, 'w:val');
        if (v) st.push(`text-align:${{ both: 'justify', center: 'center', right: 'right', end: 'right' }[v] || 'left'}`);
        const numPr = XT.firstChild(pPr, 'w:numPr');
        if (numPr) st.push('padding-left:1.2em');
      }
      let inner = '';
      (function walk(n) {
        for (const c of n.children) {
          if (!XT.isEl(c)) continue;
          if (c.name === 'w:r') inner += runHtml(c);
          else if (c.name === 'w:hyperlink' || c.name === 'w:ins' || c.name === 'w:smartTag' || c.name === 'w:sdt' || c.name === 'w:sdtContent') walk(c);
        }
      })(p);
      const hl = highlights.has(p) ? ' fd-hl' : '';
      return `<p class="fd-p${hl}" style="${st.join(';')}">${inner || '&nbsp;'}</p>`;
    }
    function tableHtml(tbl) {
      const grid = XT.firstChild(tbl, 'w:tblGrid');
      const widths = grid ? XT.childEls(grid, 'w:gridCol').map((x) => Math.round(parseInt(XT.getAttr(x, 'w:w') || '0', 10) / 15)) : [];
      const tblPr = XT.firstChild(tbl, 'w:tblPr');
      const borders = tblPr && XT.firstChild(tblPr, 'w:tblBorders');
      const styleRef = tblPr && XT.firstChild(tblPr, 'w:tblStyle');
      const bordered = !!borders || (styleRef && /grid/i.test(XT.getAttr(styleRef, 'w:val') || ''));
      const trs = XT.childEls(tbl, 'w:tr');
      // 세로 병합 rowspan 계산
      const spans = new Map();
      const open = {};
      trs.forEach((tr, r) => {
        let col = 0;
        for (const tc of XT.childEls(tr, 'w:tc')) {
          const tcPr = XT.firstChild(tc, 'w:tcPr');
          const gs = tcPr && XT.firstChild(tcPr, 'w:gridSpan');
          const span = gs ? parseInt(XT.getAttr(gs, 'w:val') || '1', 10) || 1 : 1;
          const vm = tcPr && XT.firstChild(tcPr, 'w:vMerge');
          if (vm) {
            if (XT.getAttr(vm, 'w:val') === 'restart') { open[col] = tc; spans.set(tc, 1); } else if (open[col]) { spans.set(open[col], spans.get(open[col]) + 1); spans.set(tc, 0); }
          } else delete open[col];
          col += span;
        }
      });
      let html = `<table class="fd-table${bordered ? ' fd-bordered' : ''}">`;
      if (widths.length) html += `<colgroup>${widths.map((w) => `<col style="width:${w}px">`).join('')}</colgroup>`;
      for (const tr of trs) {
        html += '<tr>';
        for (const tc of XT.childEls(tr, 'w:tc')) {
          if (spans.get(tc) === 0) continue;
          const tcPr = XT.firstChild(tc, 'w:tcPr');
          const gs = tcPr && XT.firstChild(tcPr, 'w:gridSpan');
          const cs = gs ? parseInt(XT.getAttr(gs, 'w:val') || '1', 10) || 1 : 1;
          const rs = spans.get(tc) || 1;
          const shd = tcPr && XT.firstChild(tcPr, 'w:shd');
          const fill = shd && XT.getAttr(shd, 'w:fill');
          const st = [];
          if (fill && /^[0-9a-fA-F]{6}$/.test(fill)) st.push(`background:#${fill}`);
          const va = tcPr && XT.firstChild(tcPr, 'w:vAlign');
          if (va) st.push(`vertical-align:${XT.getAttr(va, 'w:val') === 'center' ? 'middle' : XT.getAttr(va, 'w:val') === 'bottom' ? 'bottom' : 'top'}`);
          const hl = highlights.has(tc) ? ' fd-hl' : '';
          html += `<td class="${hl.trim()}" colspan="${cs}" rowspan="${rs}" style="${st.join(';')}">${bodyHtml(tc)}</td>`;
        }
        html += '</tr>';
      }
      return `${html}</table>`;
    }
    function bodyHtml(node) {
      let out = '';
      for (const c of node.children) {
        if (!XT.isEl(c)) continue;
        if (c.name === 'w:p') out += paraHtml(c);
        else if (c.name === 'w:tbl') out += tableHtml(c);
        else if (c.name === 'w:sdt') { const content = XT.firstChild(c, 'w:sdtContent'); if (content) out += bodyHtml(content); }
      }
      return out;
    }
    const doc = parts.find((p) => p.name === 'word/document.xml');
    const rootEl = doc.root.children.find(XT.isEl);
    return bodyHtml(XT.firstChild(rootEl, 'w:body') || rootEl);
  }
  async function previewDocx(bytes, mapping, values, extra = {}) {
    const loaded = await loadDocx(bytes);
    extra.ctxState = {};
    const res = await applyDocx(loaded, mapping, values, extra);
    for (const part of loaded.parts) loaded.zip.file(part.name, XT.serialize(part.root));
    const media = await docxMediaMap(loaded.zip);
    const html = renderDocxHtml(loaded.parts, res.highlights, media);
    return { sheets: [{ name: '문서', html }], notes: res.notes, filledCount: res.highlights.size };
  }

  // ------------------------------------------------------------------
  // XLSX (ExcelJS)
  // ------------------------------------------------------------------
  async function loadXlsx(bytes) {
    await openZip(bytes, 'xlsx');
    const wb = new (g().ExcelJS.Workbook)();
    const u8 = toU8(bytes);
    try { await wb.xlsx.load(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)); } catch (e) { throw new FormError(`Excel 파일을 읽지 못했습니다: ${e.message || e}`); }
    const model = FT.buildXlsxModel(wb);
    return { wb, model };
  }

  function parseRangeA1(a1) {
    const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(a1);
    const col = (s) => s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
    return m ? { top: +m[2], left: col(m[1]), bottom: +m[4], right: col(m[3]) } : null;
  }
  function a1Of(r) { return `${FT.colLetter(r.left - 1)}${r.top}:${FT.colLetter(r.right - 1)}${r.bottom}`; }

  /** after(1-based) 행 뒤에 n행을 끼워 넣는다(스타일/행 높이는 after 행을 복제, 병합 범위는 이동/확장/복제). */
  function insertRowsAfter(ws, after, n) {
    const merges = ((ws.model && ws.model.merges) || []).map(parseRangeA1).filter(Boolean);
    for (const m of merges) ws.unMergeCells(a1Of(m));
    ws.getRow(after); // 행 객체 보장
    ws.duplicateRow(after, n, true);
    for (let k = 1; k <= n; k++) ws.getRow(after + k).eachCell({ includeEmpty: true }, (cell) => { cell.value = null; });
    for (const m of merges) {
      let { top, bottom } = m;
      if (top > after) { top += n; bottom += n; } else if (top <= after && bottom >= after && bottom > top) bottom += n;
      ws.mergeCells(a1Of({ ...m, top, bottom }));
      if (m.top === m.bottom && m.top === after) for (let k = 1; k <= n; k++) ws.mergeCells(a1Of({ ...m, top: after + k, bottom: after + k }));
    }
  }

  function colPx(ws, c1) { const w = ws.getColumn(c1).width; return Math.round((w || (ws.properties && ws.properties.defaultColWidth) || 8.43) * 7 + 5); }
  function rowPx(ws, r1) { const h = ws.getRow(r1).height; return Math.round((h || (ws.properties && ws.properties.defaultRowHeight) || 15) * (96 / 72)); }

  async function applyXlsx(loaded, mapping, values, extra) {
    const { wb } = loaded;
    const filled = new Set(); // `${wsIndex}:${row1}:${col1}`
    const notes = [];
    const opts = mapping.options || {};
    const shifts = {};
    const wsOf = (ti) => wb.worksheets[ti];
    const cur = (ti, r0) => { let add = 0; for (const s of shifts[ti] || []) if (s.after < r0) add += s.n; return r0 + add + 1; };
    const mark = (ti, r1, c1) => filled.add(`${ti}:${r1}:${c1}`);
    function setCell(ws, r1, c1, text) {
      const cell = ws.getCell(r1, c1);
      const target = cell.master || cell;
      target.value = text;
      if (/\n/.test(text)) target.alignment = { ...(target.alignment || {}), wrapText: true, vertical: (target.alignment && target.alignment.vertical) || 'top' };
      return target;
    }

    // 1) 반복 표
    const reps = [...(mapping.repeats || [])].sort((a, b) => a.target.ti - b.target.ti || a.target.header - b.target.header);
    for (const rep of reps) {
      const { ti, first, cap } = rep.target;
      const ws = wsOf(ti);
      if (!ws) continue;
      const rows = (values.repeats && values.repeats[rep.id]) || [];
      let usable = cap;
      if (rows.length > cap) {
        if (opts.addRows !== false) {
          const lastOrig = first + cap - 1;
          const after = cur(ti, lastOrig);
          insertRowsAfter(ws, after, rows.length - cap);
          (shifts[ti] = shifts[ti] || []).push({ after: lastOrig, n: rows.length - cap });
          usable = rows.length;
        } else notes.push(`${rep.title}: ${rows.length - cap}건이 양식 행 수(${cap})를 넘어 들어가지 못했습니다.`);
      }
      const startRow = cur(ti, first);
      for (let i = 0; i < Math.min(rows.length, usable); i++) {
        rep.cols.forEach((col, ci) => {
          const text = (rows[i].cells || [])[ci];
          if (text === undefined || text === null || text === '') return;
          setCell(ws, startRow + i, col.c + 1, String(text));
          mark(ti, startRow + i, col.c + 1);
        });
      }
    }

    // 2) 개별 필드 (같은 칸의 범위 치환은 뒤에서부터)
    const ops = [];
    for (const f of mapping.fields || []) {
      if (f.kind === 'photo') continue;
      const val = values.scalars ? values.scalars[f.id] : '';
      const text = val == null ? '' : String(val);
      if (f.how !== 'placeholder' && text === '') continue;
      ops.push({ f, text });
    }
    ops.sort((a, b) => ((b.f.target.range || [0])[0]) - ((a.f.target.range || [0])[0]));
    for (const { f, text } of ops) {
      const tg = f.target;
      const ws = wsOf(tg.ti);
      if (!ws) continue;
      const r1 = cur(tg.ti, tg.r);
      const c1 = tg.c + 1;
      if (tg.range) {
        const cell = ws.getCell(r1, c1);
        const curText = typeof cell.value === 'string' ? cell.value : (cell.value && cell.value.richText ? cell.value.richText.map((x) => x.text).join('') : String(cell.value == null ? '' : cell.value));
        setCell(ws, r1, c1, curText.slice(0, tg.range[0]) + text + curText.slice(tg.range[1]));
      } else setCell(ws, r1, c1, text);
      mark(tg.ti, r1, c1);
    }

    // 3) 사진
    for (const f of mapping.fields || []) {
      if (f.kind !== 'photo') continue;
      const photo = extra.photos && extra.photos[f.id];
      const tg = f.target;
      const ws = wsOf(tg.ti);
      if (!ws) continue;
      const r1 = cur(tg.ti, tg.r);
      const c1 = tg.c + 1;
      if (tg.range) {
        const cell = ws.getCell(r1, c1);
        const t0 = typeof cell.value === 'string' ? cell.value : '';
        cell.value = t0.slice(0, tg.range[0]) + t0.slice(tg.range[1]);
      } else if (photo) ws.getCell(r1, c1).value = null; // "사진" 문구 제거
      if (!photo) continue;
      const rs = tg.rs || 1;
      const cs = tg.cs || 1;
      let W2 = 0;
      let H2 = 0;
      for (let c = 0; c < cs; c++) W2 += colPx(ws, c1 + c);
      for (let r = 0; r < rs; r++) H2 += rowPx(ws, r1 + r);
      const aspect = photo.info.w && photo.info.h ? photo.info.w / photo.info.h : 3 / 4;
      const pad = 4;
      let w = W2 - pad * 2;
      let h = Math.round(w / aspect);
      if (h > H2 - pad * 2) { h = H2 - pad * 2; w = Math.round(h * aspect); }
      w = Math.max(w, 10);
      h = Math.max(h, 10);
      const offX = Math.max(0, Math.round((W2 - w) / 2));
      const offY = Math.max(0, Math.round((H2 - h) / 2));
      // 오프셋(px) → 소수 열/행 좌표
      let col = c1 - 1;
      let remX = offX;
      while (remX >= colPx(ws, col + 1)) { remX -= colPx(ws, col + 1); col++; }
      let row = r1 - 1;
      let remY = offY;
      while (remY >= rowPx(ws, row + 1)) { remY -= rowPx(ws, row + 1); row++; }
      const imgId = wb.addImage({ base64: bytesToBase64(photo.bytes), extension: photo.info.ext });
      ws.addImage(imgId, { tl: { nativeCol: col, nativeColOff: Math.round(remX * 9525), nativeRow: row, nativeRowOff: Math.round(remY * 9525) }, ext: { width: w, height: h }, editAs: 'oneCell' });
      mark(tg.ti, r1, c1);
      extra.placedPhotos = (extra.placedPhotos || []).concat([{ ti: tg.ti, r1, c1, w, h, rs, cs, bytes: photo.bytes, ext: photo.info.ext }]);
    }
    return { filled, notes };
  }

  async function fillXlsx(bytes, mapping, values, extra = {}) {
    const loaded = await loadXlsx(bytes);
    const res = await applyXlsx(loaded, mapping, values, extra);
    const buf = await loaded.wb.xlsx.writeBuffer();
    return { bytes: new Uint8Array(buf), notes: res.notes };
  }

  // ---- XLSX 미리보기(근사) ----
  function argbToCss(c) {
    if (!c || !c.argb) return null;
    const s = String(c.argb);
    return `#${s.length === 8 ? s.slice(2) : s}`;
  }
  function renderXlsxHtml(wb, filled, photos) {
    const sheets = [];
    wb.worksheets.forEach((ws, ti) => {
      if (ws.state && ws.state !== 'visible') return;
      const maxR = Math.min(ws.rowCount || 1, 150);
      const maxC = Math.min(ws.columnCount || 1, 30);
      const merges = (ws.model.merges || []).map(parseRangeA1).filter(Boolean);
      const cover = new Map();
      for (const m of merges) for (let r = m.top; r <= m.bottom; r++) for (let c = m.left; c <= m.right; c++) cover.set(`${r}:${c}`, r === m.top && c === m.left ? { rs: m.bottom - m.top + 1, cs: m.right - m.left + 1 } : null);
      let html = '<table class="fd-xl"><colgroup><col style="width:34px">';
      for (let c = 1; c <= maxC; c++) html += `<col style="width:${colPx(ws, c)}px">`;
      html += '</colgroup><thead><tr><th></th>';
      for (let c = 1; c <= maxC; c++) html += `<th>${FT.colLetter(c - 1)}</th>`;
      html += '</tr></thead><tbody>';
      for (let r = 1; r <= maxR; r++) {
        html += `<tr style="height:${rowPx(ws, r)}px"><th>${r}</th>`;
        for (let c = 1; c <= maxC; c++) {
          const key = `${r}:${c}`;
          const mg = cover.get(key);
          if (cover.has(key) && mg === null) continue;
          const cell = ws.getCell(r, c);
          const st = [];
          const f = cell.font || {};
          if (f.bold) st.push('font-weight:700');
          if (f.italic) st.push('font-style:italic');
          if (f.size) st.push(`font-size:${Math.round(f.size * 1.333)}px`);
          const fc = argbToCss(f.color);
          if (fc) st.push(`color:${fc}`);
          const fill = cell.fill && cell.fill.type === 'pattern' ? argbToCss(cell.fill.fgColor) : null;
          if (fill) st.push(`background:${fill}`);
          const al = cell.alignment || {};
          if (al.horizontal) st.push(`text-align:${al.horizontal === 'centerContinuous' ? 'center' : al.horizontal}`);
          if (al.vertical) st.push(`vertical-align:${al.vertical === 'center' ? 'middle' : al.vertical}`);
          const b = cell.border || {};
          const side = (n, key) => (b[key] && b[key].style ? `border-${n}:1px solid #666;` : '');
          st.push(side('top', 'top') + side('right', 'right') + side('bottom', 'bottom') + side('left', 'left'));
          const raw = cell.value;
          let text = '';
          if (raw !== null && raw !== undefined) text = typeof raw === 'object' ? (raw.richText ? raw.richText.map((x) => x.text).join('') : raw.result !== undefined ? String(raw.result) : raw.text !== undefined ? String(raw.text) : raw instanceof Date ? raw.toISOString().slice(0, 10) : '') : String(raw);
          const hl = filled.has(`${ti}:${r}:${c}`) ? ' fd-hl' : '';
          const span = mg ? ` rowspan="${mg.rs}" colspan="${mg.cs}"` : '';
          const ph = (photos || []).find((p) => p.ti === ti && p.r1 === r && p.c1 === c);
          const img = ph ? `<img src="data:image/${ph.ext};base64,${bytesToBase64(ph.bytes)}" style="max-width:100%;max-height:${Math.max(40, ph.h)}px;display:block;margin:auto" alt="">` : '';
          html += `<td class="${hl.trim()}"${span} style="${st.join(';')}${al.wrapText || /\n/.test(text) ? ';white-space:pre-wrap' : ''}">${img || escH(text)}</td>`;
        }
        html += '</tr>';
      }
      html += '</tbody></table>';
      if ((ws.rowCount || 0) > maxR || (ws.columnCount || 0) > maxC) html += '<p class="fd-note">※ 미리보기는 앞부분(150행×30열)만 보여줍니다. 다운로드 파일에는 전체가 들어갑니다.</p>';
      sheets.push({ name: ws.name, html });
    });
    return sheets;
  }
  async function previewXlsx(bytes, mapping, values, extra = {}) {
    const loaded = await loadXlsx(bytes);
    const res = await applyXlsx(loaded, mapping, values, extra);
    const sheets = renderXlsxHtml(loaded.wb, res.filled, extra.placedPhotos);
    return { sheets, notes: res.notes, filledCount: res.filled.size };
  }

  // ------------------------------------------------------------------
  // 공개 API
  // ------------------------------------------------------------------
  /** 템플릿 분석. @returns {{ analysis, warnings:string[] }} */
  async function analyzeTemplate(bytes, kind) {
    const warnings = [];
    if (kind === 'docx') {
      const loaded = await loadDocx(bytes);
      const xml = XT.serialize(loaded.parts[0].root);
      if (/<w:txbxContent|<wps:txbx/.test(xml)) warnings.push('텍스트 상자(도형) 안의 내용은 자동으로 찾지 못합니다. 필요하면 표/문단으로 바꾸거나 {{이름}} 같은 자리표시자를 쓰세요.');
      const analysis = FT.analyze(loaded.model);
      if (!loaded.model.paras.some((p) => p.text.trim())) warnings.push('문서에 글자가 거의 없습니다. 스캔한 이미지 양식이면 사용할 수 없습니다.');
      return { analysis, warnings: warnings.concat(analysis.warnings), stats: { tables: loaded.model.tables.length, paragraphs: loaded.model.paras.length } };
    }
    const zip = await openZip(bytes, 'xlsx');
    const drawings = zip.file(/^xl\/drawings\/drawing\d+\.xml$/);
    for (const d of drawings) {
      const x = await d.async('string');
      if (/<xdr:sp[ >]|<xdr:graphicFrame|<xdr:grpSp/.test(x)) { warnings.push('이 양식에는 도형/텍스트 상자/차트가 있어 결과 파일에서 사라지거나 달라질 수 있습니다(그림은 유지됩니다). 결과 파일을 꼭 열어 확인하세요.'); break; }
    }
    const loaded = await loadXlsx(bytes);
    const analysis = FT.analyze(loaded.model);
    return { analysis, warnings: warnings.concat(analysis.warnings), stats: { tables: loaded.model.tables.length, sheets: loaded.model.tables.map((t) => t.name) } };
  }

  /** photos: { [fieldId]: { bytes:Uint8Array, info:{ext,mime,w,h} } } */
  async function fillTemplate(kind, bytes, mapping, values, extra = {}) {
    return kind === 'docx' ? fillDocx(bytes, mapping, values, extra) : fillXlsx(bytes, mapping, values, extra);
  }
  async function previewTemplate(kind, bytes, mapping, values, extra = {}) {
    return kind === 'docx' ? previewDocx(bytes, mapping, values, extra) : previewXlsx(bytes, mapping, values, extra);
  }
  function mimeOf(kind) {
    return kind === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }

  const api = { FormError, checkFileName, analyzeTemplate, fillTemplate, previewTemplate, imageInfo, bytesToBase64, base64ToBytes, dataUrlToBytes, mimeOf, loadDocx, loadXlsx, replaceRange, paraSegs, toU8 };
  globalThis.FormEngine = api;
  if (typeof window !== 'undefined') window.FormEngine = api;
})();
