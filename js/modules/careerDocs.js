// 이력/경력 → 📄 양식 문서 화면 (v7.22.0). 이 파일은 탭을 처음 열 때 js/services/libLoader.js가 불러온다.
//   목록(검색·상태 필터·정렬·선택 삭제·복제·다운로드·첨부) ↔ 편집 화면(자동 매칭 결과 편집 + 미리보기 + 임시저장/저장/최종본 목록)
// 모든 파일 처리는 브라우저 안에서만 한다(양식/이력서를 외부 서비스로 보내지 않는다).
(function () {
  const { appState, el, toast, confirmDialog, openModal, todayISO } = window;
  const FT = window.FormTemplate;
  const FE = window.FormEngine;
  const CL = window.CareerLogic;

  const MAX_FINALS = 5;
  const AUTOSAVE_MS = 20000;
  const KIND_ICON = { xlsx: '📗', docx: '📘' };
  const STATUS_LABEL = { draft: '임시저장', saved: '저장완료' };
  const TABLE = 'career_documents';

  const pad2 = (n) => String(n).padStart(2, '0');
  function fmtDT(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '-';
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  const safeName = (s) => String(s || '문서').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 60) || '문서';
  const ymd = () => todayISO().replace(/-/g, '');

  function downloadBytes(bytes, name, mime) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  async function attachmentBytes(attId) {
    const dataUrl = await appState.getAttachmentData(attId);
    return FE.dataUrlToBytes(dataUrl).bytes;
  }

  // 증명사진 → { bytes, info } (캐시)
  const photoCache = new Map();
  async function loadPhotoPayload(photoRecId) {
    if (!photoRecId) return null;
    if (photoCache.has(photoRecId)) return photoCache.get(photoRecId);
    const att = appState.getAttachments('career_photos', photoRecId).find((a) => (a.mime_type || '').startsWith('image/'));
    if (!att) return null;
    const { bytes } = FE.dataUrlToBytes(await appState.getAttachmentData(att.id));
    const info = FE.imageInfo(bytes);
    const payload = info ? { bytes, info } : { unsupported: true, mime: att.mime_type };
    photoCache.set(photoRecId, payload);
    return payload;
  }

  function renderCareerDocuments(host) {
    host.innerHTML = '';
    host.classList.add('cd-host');
    const ui = { query: '', status: 'all', sort: { key: 'updated_at', dir: 'desc' }, selected: new Set() };
    let editor = null;
    const listBox = el('div', {});
    const editorBox = el('div', { class: 'hidden' });
    host.append(listBox, editorBox);

    // ================================================================
    // 목록
    // ================================================================
    function docsFiltered() {
      let rows = (appState.careerDocuments || []).filter((d) => !d._pending || true);
      if (ui.status !== 'all') rows = rows.filter((d) => d.status === ui.status);
      const q = ui.query.trim().toLowerCase();
      if (q) rows = rows.filter((d) => `${d.title} ${d.template_name}`.toLowerCase().includes(q));
      const { key, dir } = ui.sort;
      rows = rows.slice().sort((a, b) => {
        const av = String(a[key] || '');
        const bv = String(b[key] || '');
        const c = av.localeCompare(bv);
        return dir === 'asc' ? c : -c;
      });
      return rows;
    }

    function helpBlock() {
      return el('details', { class: 'cd-help' }, [
        el('summary', {}, '❔ 이 기능은 이렇게 동작해요 (가능한 것 / 한계)'),
        el('div', { class: 'cd-help__body' }, [
          el('p', {}, '회사/기관이 준 Excel(.xlsx)·Word(.docx)·한글(.hwpx) 양식을 올리면, 등록해 둔 학력·자격증·교육이수·가입단체·포상·경력·증명사진과 기본정보를 자동으로 칸에 맞춰 넣어 보여 드립니다. 값을 고친 뒤 임시저장/저장(최종 파일 생성)할 수 있고, 모든 처리는 이 브라우저 안에서만 이루어집니다(파일을 외부로 보내지 않음).'),
          el('p', {}, [el('strong', {}, '찾는 방법 '), '① {{이름}} · [[학력.1.학교]] 같은 자리표시자 → ② "성 명", "생 년 월 일", "자격증명"처럼 알려진 라벨 옆(오른쪽, 없으면 아래)의 빈 칸 → ③ 헤더에 "기간·학교명·전공"처럼 라벨이 여러 개인 반복 표(빈 행을 순서대로 채우고, 모자라면 행 추가). "사진"/"증명사진" 칸에는 사진을 넣습니다.']),
          el('p', {}, [el('strong', {}, '한계(정직하게) '), '자동 매칭은 추측(휴리스틱)이라 "자동 매칭 결과"를 꼭 확인·수정하세요. 자유 배치 양식(텍스트 상자·도형 안의 글자, 그림으로 된 양식, 스캔 PDF), 구형 .doc/.xls/.hwp(한글에서 .hwpx로 저장 후 사용), 암호 걸린 파일, 매크로(.xlsm)는 지원하지 않습니다(.doc → .docx로 저장 후 다시 시도). 미리보기는 근사치이며 내려받는 파일은 원본 서식을 유지합니다. Excel 수식은 유지되지만 다시 계산하지 않고, 도형/차트는 결과 파일에서 사라질 수 있습니다. 사진은 PNG/JPEG/GIF만 넣을 수 있습니다. 한글(.hwpx) 양식은 표와 글자만 Word 형식으로 옮겨 처리하므로 그림·도형·글상자는 빠지고, 결과는 .docx로 나옵니다(한글에서 열어 .hwp/.hwpx로 다시 저장하세요).']),
        ]),
      ]);
    }

    function sortableTh(label, key) {
      const active = ui.sort.key === key;
      return el('th', { class: active ? 'is-sorted' : '', onclick: () => { ui.sort = active ? { key, dir: ui.sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'updated_at' ? 'desc' : 'asc' }; drawList(); } }, [label, active ? el('span', { class: 'sort-arrow' }, ui.sort.dir === 'asc' ? '▲' : '▼') : null]);
    }

    function drawList() {
      listBox.innerHTML = '';
      const all = appState.careerDocuments || [];
      const rows = docsFiltered();
      ui.selected = new Set([...ui.selected].filter((id) => rows.some((r) => r.id === id)));
      const selCount = ui.selected.size;
      listBox.append(helpBlock());
      listBox.append(el('div', { class: 'filter-bar', style: 'margin-bottom:8px' }, [
        el('input', {
          class: 'nm-input cd-search', style: 'max-width:240px', placeholder: '제목/양식 파일명 검색', value: ui.query,
          oninput: (e) => { const pos = e.target.selectionStart; ui.query = e.target.value; drawList(); const n = listBox.querySelector('.cd-search'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) { /* noop */ } } },
        }),
        el('select', { class: 'nm-select cd-status-filter', 'aria-label': '상태 필터', onchange: (e) => { ui.status = e.target.value; drawList(); } },
          [['all', '상태: 전체'], ['draft', '임시저장'], ['saved', '저장완료']].map(([v, l]) => el('option', { value: v, selected: ui.status === v || undefined }, l))),
        el('span', { class: 'text-muted', style: 'font-size:12px' }, `${rows.length}건${rows.length !== all.length ? ` / 전체 ${all.length}건` : ''}`),
      ]));
      if (!all.length) {
        listBox.append(el('div', { class: 'empty-state' }, [
          el('div', {}, '아직 만든 양식 문서가 없습니다.'),
          el('button', { class: 'nm-btn nm-btn--primary', style: 'margin-top:10px', onclick: openNew }, '+ 첫 양식 문서 만들기'),
        ]));
        return;
      }
      listBox.append(el('div', { class: 'row row--between', style: 'margin-bottom:8px; align-items:center' }, [
        el('label', { class: 'row', style: 'gap:6px; align-items:center; cursor:pointer; font-size:13px' }, [
          el('input', { type: 'checkbox', checked: rows.length > 0 && selCount === rows.length ? true : undefined, onchange: (e) => { if (e.target.checked) rows.forEach((r) => ui.selected.add(r.id)); else ui.selected.clear(); drawList(); } }),
          el('span', { class: 'text-muted' }, '전체선택'),
        ]),
        el('button', {
          class: 'nm-btn nm-btn--danger cd-bulk-delete', disabled: selCount === 0 || undefined,
          onclick: async () => {
            if (!confirmDialog(`선택한 ${selCount}건을 삭제할까요? (양식 원본과 최종본 파일도 함께 삭제됩니다)`)) return;
            const ids = [...ui.selected];
            ui.selected.clear();
            try { await appState.deleteCareerDocuments(ids); toast(`${ids.length}건 삭제했습니다.`, 'success'); } catch (e) { toast(`삭제 실패: ${e.message || e}`, 'error'); }
          },
        }, `선택 삭제${selCount ? ` (${selCount})` : ''}`),
      ]));
      if (!rows.length) { listBox.append(el('div', { class: 'empty-state' }, '검색/필터 결과가 없습니다.')); return; }

      const table = el('table', { class: 'data-table cd-table' });
      table.append(el('thead', {}, [el('tr', {}, [
        el('th', {}, [el('input', { type: 'checkbox', 'aria-label': '전체 선택', checked: selCount === rows.length ? true : undefined, onchange: (e) => { if (e.target.checked) rows.forEach((r) => ui.selected.add(r.id)); else ui.selected.clear(); drawList(); } })]),
        el('th', {}, 'No'),
        sortableTh('제목', 'title'), sortableTh('양식 파일', 'template_name'), sortableTh('상태', 'status'), sortableTh('수정일', 'updated_at'),
        el('th', {}, '첨부'), el('th', {}, '작업'),
      ])]));
      const tbody = el('tbody', {});
      rows.forEach((d, idx) => {
        const attCount = appState.getAttachments(TABLE, d.id).length;
        tbody.append(el('tr', { dataset: { id: d.id } }, [
          el('td', {}, [el('input', { type: 'checkbox', checked: ui.selected.has(d.id) || undefined, onchange: (e) => { if (e.target.checked) ui.selected.add(d.id); else ui.selected.delete(d.id); drawList(); } })]),
          el('td', {}, String(idx + 1)),
          el('td', { style: 'cursor:pointer', onclick: () => openEditorFor(d) }, [el('strong', {}, d.title || '(제목 없음)')]),
          el('td', {}, [el('span', { class: `cd-kind cd-kind--${d.template_kind}`, title: d.template_kind }, `${KIND_ICON[d.template_kind] || '📄'} ${d.template_kind}`), ' ', el('span', { class: 'cd-tname' }, d.template_name)]),
          el('td', {}, [el('span', { class: `cd-badge cd-badge--${d.status}` }, STATUS_LABEL[d.status] || d.status)]),
          el('td', {}, fmtDT(d.updated_at || d.created_at)),
          el('td', {}, [el('button', { class: 'nm-btn nm-btn--icon', title: '첨부파일(양식 원본·최종본)', onclick: () => window.openAttachmentsModal(TABLE, d.id, d.title) }, attCount ? `📎${attCount}` : '📎')]),
          el('td', {}, [el('div', { class: 'icon-row' }, [
            el('button', { class: 'nm-btn nm-btn--icon cd-act-edit', title: '편집', onclick: () => openEditorFor(d) }, '✎'),
            el('button', { class: 'nm-btn nm-btn--icon cd-act-download', title: d.finals && d.finals.length ? '최종본 다운로드' : '현재 저장된 값으로 파일 만들어 다운로드', onclick: (e) => downloadDoc(d, e.currentTarget) }, '⬇'),
            el('button', { class: 'nm-btn nm-btn--icon cd-act-dup', title: '복제(다른 회사 양식 등으로 새 임시저장 문서 만들기)', onclick: async () => { try { await appState.duplicateCareerDocument(d.id); toast('복제했습니다(임시저장).', 'success'); } catch (e) { toast(`복제 실패: ${e.message || e}`, 'error'); } } }, '⧉'),
            el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger cd-act-delete', title: '삭제', onclick: async () => { if (!confirmDialog(`"${d.title}" 문서를 삭제할까요? (양식 원본과 최종본 파일도 함께 삭제됩니다)`)) return; try { await appState.deleteCareerDocuments([d.id]); toast('삭제했습니다.', 'success'); } catch (e) { toast(`삭제 실패: ${e.message || e}`, 'error'); } } }, '🗑'),
          ])]),
        ]));
      });
      table.append(tbody);
      listBox.append(el('div', { class: 'data-table-wrap' }, [table]));
    }

    async function downloadDoc(d, btn) {
      if (btn) btn.disabled = true;
      try {
        const live = (d.finals || []).filter((f) => appState.getAttachments(TABLE, d.id).some((a) => a.id === f.attachment_id));
        if (live.length) {
          const f = live[0];
          downloadBytes(await attachmentBytes(f.attachment_id), f.name, FE.mimeOf(d.template_kind));
          return;
        }
        if (!d.template_attachment_id) { toast('양식 원본이 없어 파일을 만들 수 없습니다. 편집 화면에서 양식을 다시 올려 주세요.', 'error'); return; }
        const bytes = await attachmentBytes(d.template_attachment_id);
        const mapping = d.mapping || {};
        const photos = await photosFor(mapping, (d.field_values || {}).photo || {});
        const res = await FE.fillTemplate(d.template_kind, bytes, mapping, d.field_values || {}, { photos });
        downloadBytes(res.bytes, `임시_${safeName(d.title)}_${ymd()}.${d.template_kind}`, FE.mimeOf(d.template_kind));
        toast('아직 "저장"한 최종본이 없어 현재 저장된 값으로 임시 파일을 만들었습니다.', 'info');
      } catch (e) {
        toast(`다운로드 실패: ${e.message || e}`, 'error');
      } finally { if (btn) btn.disabled = false; }
    }
    async function photosFor(mapping, photoSel) {
      const out = {};
      for (const f of mapping.fields || []) {
        if (f.kind !== 'photo') continue;
        const recId = photoSel[f.id];
        if (!recId) continue;
        const p = await loadPhotoPayload(recId).catch(() => null);
        if (p && !p.unsupported) out[f.id] = p;
      }
      return out;
    }

    // ================================================================
    // 새 문서 모달 (양식 업로드)
    // ================================================================
    function openNew() {
      openModal({
        title: '📄 새 양식 문서', width: '600px',
        contentBuilder(body, close) {
          const titleInput = el('input', { class: 'nm-input', type: 'text', name: 'doc-title', placeholder: '예: ○○회사 입사지원 이력서', required: true });
          const err = el('div', { class: 'cd-error hidden', role: 'alert' });
          const status = el('div', { class: 'text-muted', style: 'font-size:12px; margin-top:8px' });
          const fileInput = el('input', { type: 'file', class: 'hidden', id: 'cd-file-input' });
          const drop = el('div', { class: 'attach-dropzone cd-drop' }, [
            el('div', { style: 'font-size:28px' }, '📥'),
            el('div', {}, 'Excel(.xlsx)·Word(.docx)·한글(.hwpx) 양식 파일을 여기로 끌어다 놓으세요'),
            el('button', { type: 'button', class: 'nm-btn', style: 'margin-top:8px', onclick: () => fileInput.click() }, '파일 선택'),
            el('div', { class: 'text-muted', style: 'font-size:11px; margin-top:6px' }, '파일은 이 브라우저에서만 처리되며 어디로도 전송되지 않습니다. 최대 10MB.'),
          ]);
          let busy = false;
          async function start(bytes, name, fromDoc) {
            if (busy) return;
            busy = true;
            err.classList.add('hidden');
            try {
              const chk = FE.checkFileName(name);
              if (!chk.ok) throw new Error(chk.message);
              status.textContent = '⏳ 양식을 분석하는 중…';
              if (chk.convert === 'hwpx') {
                // 한글(.hwpx) → .docx로 변환해 같은 엔진으로 처리한다. 결과 .docx는 한글에서 열어 .hwp/.hwpx로 다시 저장할 수 있다.
                const conv = await window.HwpBridge.hwpxToDocx(bytes);
                bytes = conv.bytes;
                name = name.replace(/\.hwpx$/i, '') + '.docx';
              }
              const { analysis, warnings, stats } = await FE.analyzeTemplate(bytes, chk.kind);
              const title = titleInput.value.trim() || name.replace(/\.[^.]+$/, '');
              close();
              openEditorNew({ title, name, kind: chk.kind, bytes, analysis, warnings, stats, fromDoc });
            } catch (e) {
              err.textContent = e.message || String(e);
              err.classList.remove('hidden');
              status.textContent = '';
            } finally { busy = false; }
          }
          async function onFile(file) {
            if (!file) return;
            const chk = FE.checkFileName(file.name);
            if (!chk.ok) { err.textContent = chk.message; err.classList.remove('hidden'); return; }
            if (file.size > 10 * 1024 * 1024) { err.textContent = `파일이 너무 큽니다(${(file.size / 1048576).toFixed(1)}MB). 양식 파일은 10MB까지 지원합니다.`; err.classList.remove('hidden'); return; }
            const bytes = new Uint8Array(await file.arrayBuffer());
            await start(bytes, file.name, null);
          }
          fileInput.addEventListener('change', () => { onFile(fileInput.files[0]); fileInput.value = ''; });
          let depth = 0;
          drop.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; drop.classList.add('attach-dropzone--active'); });
          drop.addEventListener('dragover', (e) => e.preventDefault());
          drop.addEventListener('dragleave', (e) => { e.preventDefault(); depth = Math.max(0, depth - 1); if (!depth) drop.classList.remove('attach-dropzone--active'); });
          drop.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; drop.classList.remove('attach-dropzone--active'); onFile(e.dataTransfer && e.dataTransfer.files[0]); });

          body.append(window.nmField('문서 제목', titleInput, { required: true, hint: '비워 두면 파일 이름을 제목으로 씁니다.' }), drop, fileInput, err, status);

          // 이전에 올린 양식 재사용(양식 보관함)
          const seen = new Map();
          for (const d of appState.careerDocuments || []) {
            if (!d.template_attachment_id) continue;
            const k = `${d.template_name}|${d.template_kind}`;
            if (!seen.has(k)) seen.set(k, d);
          }
          if (seen.size) {
            const lib = el('div', { class: 'stack', style: 'gap:6px; margin-top:14px' }, [el('strong', { style: 'font-size:13px' }, '📚 이전에 올린 양식 다시 쓰기')]);
            for (const d of seen.values()) {
              lib.append(el('button', {
                type: 'button', class: 'nm-btn cd-lib-item', style: 'justify-content:flex-start; text-align:left',
                onclick: async () => {
                  try {
                    status.textContent = '⏳ 보관된 양식을 불러오는 중…';
                    const bytes = await attachmentBytes(d.template_attachment_id);
                    await start(bytes, d.template_name, d);
                  } catch (e) { err.textContent = `양식을 불러오지 못했습니다: ${e.message || e}`; err.classList.remove('hidden'); status.textContent = ''; }
                },
              }, `${KIND_ICON[d.template_kind]} ${d.template_name}`));
            }
            body.append(lib);
          }
        },
      });
    }

    // ================================================================
    // 편집 화면
    // ================================================================
    function datasetFor(options) {
      return FT.buildDataset({ career: appState.career, basic: appState.careerBasic, profile: appState.profile, todayIso: todayISO(), order: options.order || 'asc' });
    }
    function findRec(cat, id) { return (appState.career[cat] || []).find((r) => r.id === id) || null; }
    const defaultOptions = () => ({ dateFormat: CL.DEFAULT_DATE_FORMAT, order: 'asc', addRows: true });

    function openEditorNew({ title, name, kind, bytes, analysis, warnings, stats, fromDoc }) {
      const options = defaultOptions();
      const ds = datasetFor(options);
      const mapping = { version: 1, kind, fields: analysis.fields, repeats: analysis.repeats, options, warnings, stats };
      const values = FT.buildInitialValues(analysis, ds, options);
      openEditor({ doc: null, title, name, kind, bytes, mapping, values, fromDoc });
    }

    async function openEditorFor(doc) {
      let bytes = null;
      if (doc.template_attachment_id) {
        try { bytes = await attachmentBytes(doc.template_attachment_id); } catch (e) { toast(`양식 원본을 불러오지 못했습니다: ${e.message || e}`, 'error'); }
      }
      let mapping = doc.mapping && doc.mapping.fields ? JSON.parse(JSON.stringify(doc.mapping)) : null;
      let values = doc.field_values && doc.field_values.scalars ? JSON.parse(JSON.stringify(doc.field_values)) : null;
      if ((!mapping || !values) && bytes) {
        // 백업에서 가져온 문서 등: 양식을 다시 분석해 처음부터 채운다
        try {
          const { analysis, warnings } = await FE.analyzeTemplate(bytes, doc.template_kind);
          const options = (mapping && mapping.options) || defaultOptions();
          mapping = { version: 1, kind: doc.template_kind, fields: analysis.fields, repeats: analysis.repeats, options, warnings };
          values = FT.buildInitialValues(analysis, datasetFor(options), options);
        } catch (e) { toast(`양식을 분석하지 못했습니다: ${e.message || e}`, 'error'); return; }
      }
      if (!mapping) mapping = { version: 1, kind: doc.template_kind, fields: [], repeats: [], options: defaultOptions(), warnings: [] };
      if (!values) values = { scalars: {}, repeats: {}, photo: {} };
      values.photo = values.photo || {};
      openEditor({ doc, title: doc.title, name: doc.template_name, kind: doc.template_kind, bytes, mapping, values });
    }

    function openEditor(init) {
      if (editor) return;
      const S = {
        docId: init.doc ? init.doc.id : null,
        status: init.doc ? init.doc.status : 'draft',
        title: init.title,
        name: init.name,
        kind: init.kind,
        bytes: init.bytes,
        mapping: init.mapping,
        values: init.values,
        saving: false,
        touched: false,
        saved: null,
        lastSavedAt: init.doc ? init.doc.updated_at : null,
        previewSeq: 0,
        templateFile: init.bytes ? new File([init.bytes], init.name, { type: FE.mimeOf(init.kind) }) : null,
      };
      S.mapping.options = { ...defaultOptions(), ...(S.mapping.options || {}) };
      let ds = datasetFor(S.mapping.options);
      let saveChain = Promise.resolve();
      let autosaveTimer = null;
      let previewTimer = null;
      let sheetIdx = 0;
      let lastSheets = [];

      const snapshot = () => JSON.stringify([S.title, S.mapping.options, S.mapping.fields.map((f) => f.source), S.mapping.repeats.map((r) => r.cols.map((c) => c.source)), S.values]);
      if (S.docId) S.saved = snapshot();
      const isDirty = () => (S.docId ? snapshot() !== S.saved : S.touched);

      // ---- DOM 뼈대 ----
      const root = el('div', { class: 'cd-editor' });
      const topbar = el('div', { class: 'cd-topbar' });
      const banners = el('div', {});
      const optionsBar = el('div', { class: 'cd-options' });
      const grid = el('div', { class: 'cd-grid' });
      const left = el('div', { class: 'cd-left' });
      const right = el('div', { class: 'cd-right' });
      const previewHead = el('div', { class: 'cd-preview__head' });
      const previewBody = el('div', { class: 'cd-preview__body' });
      right.append(el('div', { class: 'cd-preview' }, [previewHead, previewBody]));
      grid.append(left, right);
      const finalsBox = el('div', { class: 'cd-finals' });
      const attachBox = el('div', { class: 'cd-attach' });
      root.append(topbar, banners, optionsBar, grid, finalsBox, attachBox);

      listBox.classList.add('hidden');
      editorBox.classList.remove('hidden');
      editorBox.innerHTML = '';
      editorBox.append(root);

      const setTouched = () => { S.touched = true; updateStatusLine(); schedulePreview(); };

      // ---- 상단 바 ----
      const titleInput = el('input', { class: 'nm-input cd-title', type: 'text', name: 'doc-title', value: S.title, required: true, oninput: (e) => { S.title = e.target.value; setTouched(); } });
      const statusLine = el('span', { class: 'cd-statusline text-muted' });
      const badge = el('span', { class: 'cd-badge' });
      const btnDraft = el('button', { class: 'nm-btn cd-save-draft', onclick: () => persist({ final: false }) }, '💾 임시저장');
      const btnFinal = el('button', { class: 'nm-btn nm-btn--primary cd-save-final', onclick: () => persist({ final: true }) }, '✅ 저장 (최종본 만들기)');
      const btnDl = el('button', { class: 'nm-btn cd-download-now', title: '지금 화면의 값으로 파일을 만들어 받습니다(저장하지 않음)', onclick: () => downloadNow() }, '⬇ 지금 상태 받기');
      const btnHwpx = el('button', { class: 'nm-btn cd-download-hwpx hidden', title: '한글(.hwpx) 양식으로 올린 문서를 같은 .hwpx 파일로 받습니다(표 안의 값만 되씀)', onclick: () => downloadHwpx() }, '⬇ 한글(.hwpx)로 받기');
      async function detectHwpx() {
        try { if (S.bytes && S.kind === 'docx' && window.JSZip) btnHwpx.classList.toggle('hidden', !(await window.JSZip.loadAsync(S.bytes)).file('hwpx/original.hwpx')); } catch { /* 무시 */ }
      }
      async function downloadHwpx() {
        btnHwpx.disabled = true;
        try {
          const res = await FE.fillTemplate(S.kind, S.bytes, S.mapping, S.values, { photos: await collectPhotos() });
          const out = await window.HwpBridge.docxToHwpx(res.bytes);
          downloadBytes(out.bytes, `${safeName(S.title)}_${ymd()}.hwpx`, 'application/hwp+zip');
          toast(`한글 파일로 받았습니다(${out.changed}칸 채움).${out.skipped.length ? ` ⚠ ${out.skipped.join(' / ')}` : ''} 사진은 .docx로 받아야 들어갑니다.`, out.skipped.length ? 'info' : 'success');
        } catch (e) { toast(`한글 파일 만들기 실패: ${e.message || e}`, 'error'); } finally { btnHwpx.disabled = false; }
      }
      topbar.append(
        el('button', { class: 'nm-btn cd-back', onclick: () => requestClose() }, '← 목록'),
        el('div', { class: 'cd-title-wrap' }, [window.nmField('문서 제목', titleInput, { required: true })]),
        el('div', { class: 'cd-top-meta' }, [el('span', { class: 'cd-kind' }, `${KIND_ICON[S.kind]} ${S.name}`), badge, statusLine]),
        el('div', { class: 'cd-top-actions' }, [btnDraft, btnFinal, btnDl, btnHwpx]),
      );
      detectHwpx();
      function updateStatusLine() {
        badge.className = `cd-badge cd-badge--${S.status}`;
        badge.textContent = STATUS_LABEL[S.status];
        if (S.saving) statusLine.textContent = '⏳ 저장 중…';
        else if (isDirty()) statusLine.textContent = '● 저장하지 않은 변경이 있습니다 (20초마다 자동 임시저장)';
        else statusLine.textContent = S.lastSavedAt ? `✓ ${fmtDT(S.lastSavedAt)} 저장됨` : (S.docId ? '✓ 저장됨' : '아직 저장하지 않은 새 문서');
        statusLine.classList.toggle('cd-dirty', isDirty());
      }

      // ---- 배너(경고) ----
      function drawBanners() {
        banners.innerHTML = '';
        for (const w of S.mapping.warnings || []) banners.append(el('div', { class: 'cd-banner cd-banner--warn' }, `⚠ ${w}`));
        if (!S.bytes) {
          const fi = el('input', { type: 'file', class: 'hidden' });
          fi.addEventListener('change', async () => {
            const f = fi.files[0];
            if (!f) return;
            const chk = FE.checkFileName(f.name);
            if (!chk.ok) { toast(chk.message, 'error'); return; }
            if (chk.kind !== S.kind) { toast(`이 문서는 .${S.kind} 양식입니다. 같은 종류의 파일을 올려 주세요.`, 'error'); return; }
            let rb = new Uint8Array(await f.arrayBuffer());
            let rf = f;
            if (chk.convert === 'hwpx') { rb = (await window.HwpBridge.hwpxToDocx(rb)).bytes; rf = new File([rb], f.name.replace(/\.hwpx$/i, '') + '.docx', { type: FE.mimeOf('docx') }); }
            S.bytes = rb;
            S.templateFile = rf;
            S.name = rf.name;
            detectHwpx();
            drawBanners();
            schedulePreview(true);
            setTouched();
            toast('양식 원본을 다시 연결했습니다. 저장하면 보관됩니다.', 'success');
          });
          banners.append(el('div', { class: 'cd-banner cd-banner--err' }, [
            '양식 원본 파일이 없습니다(백업에서 가져왔거나 첨부를 삭제함). 같은 양식 파일을 다시 올려 주세요. ',
            el('button', { class: 'nm-btn', onclick: () => fi.click() }, '양식 파일 선택'), fi,
          ]));
        }
      }

      // ---- 옵션 바 ----
      function drawOptions() {
        optionsBar.innerHTML = '';
        const o = S.mapping.options;
        const dateSel = el('select', { class: 'nm-select cd-opt-date', onchange: (e) => changeDateFormat(e.target.value) },
          CL.DATE_FORMATS.map((f) => el('option', { value: f.id, selected: o.dateFormat === f.id || undefined }, f.label)));
        const orderSel = el('select', { class: 'nm-select cd-opt-order', onchange: (e) => changeOrder(e.target.value) }, [
          el('option', { value: 'asc', selected: o.order === 'asc' || undefined }, '오래된 순 → 최근'),
          el('option', { value: 'desc', selected: o.order === 'desc' || undefined }, '최근 순 → 오래된'),
        ]);
        const addRows = el('input', { type: 'checkbox', class: 'cd-opt-addrows', checked: o.addRows !== false ? true : undefined, onchange: (e) => { o.addRows = e.target.checked; setTouched(); drawRepeats(); } });
        optionsBar.append(
          el('label', { class: 'cd-opt' }, ['날짜 형식', dateSel]),
          el('label', { class: 'cd-opt' }, ['표 정렬', orderSel]),
          el('label', { class: 'cd-opt cd-opt--check' }, [addRows, '양식 행이 모자라면 행 자동 추가']),
          el('button', { class: 'nm-btn cd-rematch', title: '등록 데이터로 모든 값을 다시 채웁니다(편집한 값은 사라짐)', onclick: rematch }, '🔄 등록 데이터로 다시 매칭'),
        );
      }
      function changeDateFormat(fmt) {
        const prev = { ...S.mapping.options };
        S.mapping.options.dateFormat = fmt;
        const analysis = { fields: S.mapping.fields, repeats: S.mapping.repeats };
        S.values = FT.reapplyOptions(analysis, ds, prev, S.mapping.options, S.values);
        for (const rep of S.mapping.repeats) {
          (S.values.repeats[rep.id] || []).forEach((row) => {
            const rec = row.src && findRec(rep.category, row.src);
            if (!rec) return;
            rep.cols.forEach((col, ci) => {
              if (col.source === 'seq' || col.source === 'none') return;
              if (row.cells[ci] === FT.recordField(rep.category, rec, col.source, prev.dateFormat, ds.todayIso)) row.cells[ci] = FT.recordField(rep.category, rec, col.source, fmt, ds.todayIso);
            });
          });
        }
        setTouched();
        drawMatching();
      }
      function changeOrder(order) {
        const prev = { ...S.mapping.options };
        const prevDs = ds;
        S.mapping.options.order = order;
        ds = datasetFor(S.mapping.options);
        let edited = false;
        for (const rep of S.mapping.repeats) {
          const auto = JSON.stringify(FT.repeatRows(prevDs, rep, prev.dateFormat));
          if (auto !== JSON.stringify(S.values.repeats[rep.id] || [])) edited = true;
        }
        if (edited && !confirmDialog('표의 행을 직접 편집했습니다. 정렬을 바꾸면 표 내용을 등록 데이터 기준으로 다시 채웁니다(편집한 행은 사라짐). 계속할까요?')) {
          S.mapping.options.order = prev.order;
          ds = prevDs;
          drawOptions();
          return;
        }
        for (const rep of S.mapping.repeats) S.values.repeats[rep.id] = FT.repeatRows(ds, rep, S.mapping.options.dateFormat);
        // 개별 필드 중 #N 번호로 연결된 것은 새 순서로 다시 계산(손대지 않은 값만)
        S.values = FT.reapplyOptions({ fields: S.mapping.fields, repeats: S.mapping.repeats }, ds, { ...prev }, { ...S.mapping.options }, S.values);
        for (const f of S.mapping.fields) if (f.kind !== 'photo' && /^[a-z]+\.\d+\./.test(f.source) && !S.values.scalars[f.id]) S.values.scalars[f.id] = FT.resolveSource(ds, f.source, S.mapping.options.dateFormat);
        setTouched();
        drawMatching();
      }
      async function rematch() {
        if (!S.bytes) { toast('양식 원본이 없어 다시 매칭할 수 없습니다.', 'error'); return; }
        if (!confirmDialog('양식을 다시 분석하고 등록 데이터로 모든 값을 새로 채웁니다. 지금까지 편집한 값은 사라집니다. 계속할까요?')) return;
        try {
          const { analysis, warnings } = await FE.analyzeTemplate(S.bytes, S.kind);
          ds = datasetFor(S.mapping.options);
          S.mapping.fields = analysis.fields; S.mapping.repeats = analysis.repeats; S.mapping.warnings = warnings;
          S.values = FT.buildInitialValues(analysis, ds, S.mapping.options);
          drawBanners(); drawMatching(); setTouched();
          toast('다시 매칭했습니다.', 'success');
        } catch (e) { toast(`다시 매칭 실패: ${e.message || e}`, 'error'); }
      }

      // ---- 매칭 결과(왼쪽) ----
      function confBadge(f) {
        return el('span', { class: `cd-conf cd-conf--${f.level || FT.confLevel(f.confidence)}`, title: `신뢰도 ${Math.round(f.confidence * 100)}%` }, { high: '높음', mid: '보통', low: '낮음' }[f.level || FT.confLevel(f.confidence)]);
      }
      function sourceSelect(field) {
        const groups = FT.scalarSourceOptions(ds);
        const flat = groups.flatMap((g) => g.options.map((o) => o.value));
        const sel = el('select', { class: 'nm-select cd-src', 'aria-label': `${field.label} 소스`, onchange: (e) => onSourceChange(field, e.target.value) });
        if (!flat.includes(field.source)) sel.append(el('option', { value: field.source, selected: true }, FT.sourceLabel(field.source, ds)));
        for (const g of groups) {
          const og = el('optgroup', { label: g.group });
          for (const o of g.options) og.append(el('option', { value: o.value, selected: o.value === field.source || undefined }, o.label));
          sel.append(og);
        }
        return sel;
      }
      function onSourceChange(field, src) {
        field.source = src;
        field.suggested = undefined;
        if (src === 'manual') { /* 현재 값 유지 */ } else if (src === 'none') S.values.scalars[field.id] = '';
        else S.values.scalars[field.id] = FT.resolveSource(ds, src, S.mapping.options.dateFormat);
        setTouched();
        drawMatching();
      }
      const isMultiline = (f) => f.source === 'summary.narrative' || /\.note$/.test(f.source) || /\n/.test(S.values.scalars[f.id] || '');

      function scalarSection() {
        const scalars = S.mapping.fields.filter((f) => f.kind === 'scalar');
        const box = el('section', { class: 'cd-sec' }, [el('h3', {}, `① 개별 항목 (${scalars.length})`), el('p', { class: 'text-muted cd-sec__hint' }, '양식의 어느 칸에 무엇을 넣을지(소스)와 실제 들어갈 값을 고칠 수 있습니다. 소스를 바꾸면 등록 데이터에서 값을 다시 가져옵니다.')]);
        if (!scalars.length) { box.append(el('div', { class: 'empty-state' }, '라벨/자리표시자로 찾은 개별 입력 칸이 없습니다.')); return box; }
        const table = el('table', { class: 'data-table cd-fields' });
        table.append(el('thead', {}, [el('tr', {}, ['위치', '라벨', '소스', '들어갈 값', '신뢰도'].map((h) => el('th', {}, h)))]));
        const tb = el('tbody', {});
        for (const f of scalars) {
          const val = S.values.scalars[f.id] || '';
          const input = isMultiline(f)
            ? el('textarea', { class: 'nm-textarea cd-val', rows: Math.min(6, Math.max(2, val.split('\n').length)), 'aria-label': `${f.label} 값`, oninput: (e) => { S.values.scalars[f.id] = e.target.value; setTouched(); } }, val)
            : el('input', { class: 'nm-input cd-val', type: 'text', value: val, 'aria-label': `${f.label} 값`, oninput: (e) => { S.values.scalars[f.id] = e.target.value; setTouched(); } });
          const sugg = f.suggested ? el('button', { class: 'nm-btn cd-sugg', type: 'button', title: f.note || '', onclick: () => onSourceChange(f, f.suggested) }, `추천: ${FT.sourceLabel(f.suggested, ds)} 넣기`) : null;
          tb.append(el('tr', { dataset: { fieldId: f.id } }, [
            el('td', { class: 'cd-loc' }, f.loc),
            el('td', {}, [el('strong', {}, f.label), f.how === 'placeholder' ? el('span', { class: 'cd-tag' }, '자리표시자') : null]),
            el('td', {}, [sourceSelect(f), sugg]),
            el('td', { class: 'cd-valcell' }, [input]),
            el('td', {}, [confBadge(f)]),
          ]));
        }
        table.append(tb);
        box.append(el('div', { class: 'data-table-wrap' }, [table]));
        return box;
      }

      function photoSection() {
        const photoFields = S.mapping.fields.filter((f) => f.kind === 'photo');
        if (!photoFields.length) return null;
        const photos = appState.career.photos || [];
        const box = el('section', { class: 'cd-sec' }, [el('h3', {}, `② 증명사진 (${photoFields.length})`), el('p', { class: 'text-muted cd-sec__hint' }, '양식의 "사진" 칸/{{사진}} 자리에 넣을 증명사진을 고르세요(PNG/JPEG/GIF). 비율을 유지해 칸 안에 맞춥니다.')]);
        for (const f of photoFields) {
          const cur = S.values.photo[f.id] || '';
          const thumb = el('div', { class: 'cd-photo-thumb' }, cur ? '⏳' : '없음');
          const sel = el('select', { class: 'nm-select cd-photo-sel', 'aria-label': '증명사진 선택', onchange: (e) => { S.values.photo[f.id] = e.target.value || null; f.source = e.target.value ? 'photo' : 'none'; setTouched(); loadThumb(thumb, e.target.value); } }, [
            el('option', { value: '' }, '(사진 넣지 않음)'),
            ...photos.map((p) => el('option', { value: p.id, selected: p.id === cur || undefined }, `${p.label || '(캡션 없음)'}${p.taken_date ? ` · ${p.taken_date}` : ''}`)),
          ]);
          box.append(el('div', { class: 'cd-photo-row' }, [thumb, el('div', {}, [el('div', { class: 'cd-loc' }, f.loc), sel, !photos.length ? el('div', { class: 'text-muted', style: 'font-size:12px' }, '등록된 증명사진이 없습니다(이력/경력 → 증명사진 탭에서 등록).') : null]), confBadge(f)]));
          loadThumb(thumb, cur);
        }
        return box;
      }
      async function loadThumb(node, recId) {
        node.innerHTML = '';
        if (!recId) { node.textContent = '없음'; return; }
        try {
          const p = await loadPhotoPayload(recId);
          if (!p) { node.textContent = '이미지 없음'; return; }
          if (p.unsupported) { node.textContent = '지원 안 함'; toast(`이 사진 형식(${p.mime || '알 수 없음'})은 양식에 넣을 수 없습니다. PNG/JPEG/GIF로 다시 등록해 주세요.`, 'error'); return; }
          node.append(el('img', { src: `data:${p.info.mime};base64,${FE.bytesToBase64(p.bytes)}`, alt: '선택한 증명사진' }));
        } catch (e) { node.textContent = '불러오기 실패'; }
      }

      let repeatsBox = null;
      function repeatCard(rep) {
        const rows = S.values.repeats[rep.id] || (S.values.repeats[rep.id] = []);
        const over = rows.length - rep.capacity;
        const card = el('div', { class: 'cd-rep', dataset: { repeatId: rep.id } });
        card.append(el('div', { class: 'cd-rep__head' }, [
          el('strong', {}, `${rep.title} 표`), el('span', { class: 'cd-loc' }, rep.loc), confBadge(rep),
          el('span', { class: over > 0 ? 'cd-rep__cap cd-rep__cap--over' : 'cd-rep__cap' }, `양식 빈 행 ${rep.capacity}개 · 입력 ${rows.length}건${over > 0 ? (S.mapping.options.addRows !== false ? ` → 저장 시 ${over}행 자동 추가` : ` → ${over}건은 들어가지 못함(행 자동 추가 꺼짐)`) : ''}`),
        ]));
        const table = el('table', { class: 'data-table cd-rep__table' });
        table.append(el('thead', {}, [el('tr', {}, [
          el('th', {}, '#'),
          ...rep.cols.map((col) => el('th', {}, [
            el('div', { class: 'cd-colhead' }, col.label),
            el('select', { class: 'nm-select cd-colsrc', 'aria-label': `${col.label} 열 소스`, onchange: (e) => onColSource(rep, col, e.target.value) },
              FT.repeatSourceOptions(rep.category).map((o) => el('option', { value: o.value, selected: o.value === col.source || undefined }, o.label))),
          ])),
          el('th', {}, ''),
        ])]));
        const tb = el('tbody', {});
        rows.forEach((row, ri) => {
          tb.append(el('tr', { class: ri >= rep.capacity ? 'cd-rep__extra' : '' }, [
            el('td', {}, String(ri + 1)),
            ...rep.cols.map((col, ci) => el('td', {}, [el('input', { class: 'nm-input cd-cell', type: 'text', value: row.cells[ci] || '', 'aria-label': `${rep.title} ${ri + 1}행 ${col.label}`, oninput: (e) => { row.cells[ci] = e.target.value; setTouched(); } })])),
            el('td', { class: 'cd-rowops' }, [
              el('button', { class: 'nm-btn nm-btn--icon', title: '위로', disabled: ri === 0 || undefined, onclick: () => { [rows[ri - 1], rows[ri]] = [rows[ri], rows[ri - 1]]; setTouched(); drawRepeats(); } }, '↑'),
              el('button', { class: 'nm-btn nm-btn--icon', title: '아래로', disabled: ri === rows.length - 1 || undefined, onclick: () => { [rows[ri + 1], rows[ri]] = [rows[ri], rows[ri + 1]]; setTouched(); drawRepeats(); } }, '↓'),
              el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '이 행 빼기', onclick: () => { rows.splice(ri, 1); setTouched(); drawRepeats(); drawUnmatched(); } }, '✕'),
            ]),
          ]));
        });
        table.append(tb);
        card.append(el('div', { class: 'data-table-wrap' }, [table]));
        // 행 추가
        const missing = (appState.career[rep.category] || []).filter((r) => !rows.some((x) => x.src === r.id));
        const addSel = el('select', { class: 'nm-select cd-addrec', 'aria-label': `${rep.title} 등록 항목에서 추가`, onchange: (e) => {
          const rec = findRec(rep.category, e.target.value);
          if (rec) { rows.push(FT.repeatRowFor(ds, rep, rec, rows.length, S.mapping.options.dateFormat)); setTouched(); drawRepeats(); drawUnmatched(); }
        } }, [el('option', { value: '' }, `+ 등록된 ${rep.title} 항목에서 추가…`), ...missing.map((r) => el('option', { value: r.id }, FT.summarizeRecord(rep.category, r)))]);
        card.append(el('div', { class: 'row', style: 'gap:8px; margin-top:6px; flex-wrap:wrap' }, [
          el('button', { class: 'nm-btn cd-addrow', onclick: () => { rows.push({ src: null, cells: rep.cols.map((c) => (c.source === 'seq' ? String(rows.length + 1) : '')) }); setTouched(); drawRepeats(); } }, '+ 빈 행'),
          missing.length ? addSel : null,
        ]));
        return card;
      }
      function onColSource(rep, col, src) {
        col.source = src;
        const ci = rep.cols.indexOf(col);
        (S.values.repeats[rep.id] || []).forEach((row, ri) => {
          if (src === 'seq') { row.cells[ci] = String(ri + 1); return; }
          if (src === 'none') { row.cells[ci] = ''; return; }
          const rec = row.src && findRec(rep.category, row.src);
          if (rec) row.cells[ci] = FT.recordField(rep.category, rec, src, S.mapping.options.dateFormat, ds.todayIso);
        });
        setTouched();
        drawRepeats();
      }
      function repeatSection() {
        const box = el('section', { class: 'cd-sec' }, [el('h3', {}, `③ 반복 표 (${S.mapping.repeats.length})`), el('p', { class: 'text-muted cd-sec__hint' }, '학력·경력·자격증처럼 여러 줄이 들어가는 표입니다. 열 머리의 소스를 바꾸거나 행을 고치고, 빼고, 순서를 바꿀 수 있습니다.')]);
        repeatsBox = el('div', { class: 'stack', style: 'gap:14px' });
        box.append(repeatsBox);
        drawRepeats();
        return box;
      }
      function drawRepeats() {
        if (!repeatsBox) return;
        repeatsBox.innerHTML = '';
        if (!S.mapping.repeats.length) repeatsBox.append(el('div', { class: 'empty-state' }, '헤더 라벨이 여러 개인 반복 표를 찾지 못했습니다.'));
        for (const rep of S.mapping.repeats) repeatsBox.append(repeatCard(rep));
        schedulePreview();
      }

      let unmatchedBox = null;
      function unmatchedSection() {
        const box = el('section', { class: 'cd-sec' }, [el('h3', {}, '④ 매칭되지 않은 항목'), el('p', { class: 'text-muted cd-sec__hint' }, '양식에 들어갈 자리를 찾지 못했거나 표에서 뺀 등록 데이터입니다. 조용히 버려지지 않도록 모두 보여 드립니다.')]);
        unmatchedBox = el('div', { class: 'cd-unmatched' });
        box.append(unmatchedBox);
        drawUnmatched();
        return box;
      }
      function drawUnmatched() {
        if (!unmatchedBox) return;
        unmatchedBox.innerHTML = '';
        const list = FT.unmatchedItems({ fields: S.mapping.fields, repeats: S.mapping.repeats }, ds, S.values);
        if (!list.length) { unmatchedBox.append(el('div', { class: 'cd-ok' }, '✓ 등록된 데이터가 모두 양식에 들어갔습니다.')); return; }
        for (const g of list) {
          unmatchedBox.append(el('div', { class: 'cd-um-group' }, [
            el('strong', {}, `${g.label} ${g.items.length}건`),
            g.group !== 'basic' && g.group !== 'summary' && g.group !== 'photos' && !g.hasRepeat ? el('span', { class: 'text-muted', style: 'font-size:12px' }, ' — 이 양식에는 해당 표가 없습니다') : null,
            el('ul', {}, g.items.map((it) => el('li', {}, [
              it.text,
              g.hasRepeat ? el('button', { class: 'nm-btn cd-um-add', style: 'margin-left:8px', onclick: () => {
                const rep = S.mapping.repeats.find((r) => r.category === g.group);
                const rec = findRec(g.group, it.id);
                if (rep && rec) { (S.values.repeats[rep.id] = S.values.repeats[rep.id] || []).push(FT.repeatRowFor(ds, rep, rec, S.values.repeats[rep.id].length, S.mapping.options.dateFormat)); setTouched(); drawRepeats(); drawUnmatched(); }
              } }, '+ 표에 추가') : null,
            ]))),
            el('button', { class: 'nm-btn cd-um-copy', onclick: async () => { const txt = g.items.map((i) => i.text).join('\n'); try { await navigator.clipboard.writeText(txt); toast('복사했습니다.', 'success'); } catch (e) { toast('복사하지 못했습니다. 직접 선택해 복사해 주세요.', 'error'); } } }, '📋 텍스트 복사'),
          ]));
        }
      }

      function drawMatching() {
        left.innerHTML = '';
        left.append(el('div', { class: 'cd-statsline text-muted' }, `양식: ${S.name} · 개별 항목 ${S.mapping.fields.filter((f) => f.kind === 'scalar').length}개 · 반복 표 ${S.mapping.repeats.length}개 · 사진 ${S.mapping.fields.filter((f) => f.kind === 'photo').length}곳`));
        left.append(scalarSection());
        const ps = photoSection();
        if (ps) left.append(ps);
        left.append(repeatSection());
        left.append(unmatchedSection());
        schedulePreview();
      }

      // ---- 미리보기(오른쪽) ----
      function schedulePreview(now) {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(runPreview, now ? 0 : 400);
      }
      async function collectPhotos() {
        const photos = {};
        for (const f of S.mapping.fields) {
          if (f.kind !== 'photo') continue;
          const recId = S.values.photo[f.id];
          if (!recId) continue;
          const p = await loadPhotoPayload(recId).catch(() => null);
          if (p && !p.unsupported) photos[f.id] = p;
        }
        return photos;
      }
      async function runPreview() {
        const seq = ++S.previewSeq;
        if (!S.bytes) { previewBody.textContent = '양식 원본이 없어 미리보기를 만들 수 없습니다.'; return; }
        previewHead.innerHTML = '';
        previewHead.append(el('strong', {}, '미리보기'), el('span', { class: 'cd-approx' }, '근사치 · 다운로드 파일은 원본 서식 유지'));
        try {
          const photos = await collectPhotos();
          const res = await FE.previewTemplate(S.kind, S.bytes, S.mapping, S.values, { photos });
          if (seq !== S.previewSeq) return;
          lastSheets = res.sheets;
          if (sheetIdx >= lastSheets.length) sheetIdx = 0;
          drawPreview(res);
        } catch (e) {
          if (seq !== S.previewSeq) return;
          previewBody.innerHTML = '';
          previewBody.append(el('div', { class: 'cd-error' }, `미리보기를 만들지 못했습니다: ${e.message || e}`));
        }
      }
      function drawPreview(res) {
        previewHead.innerHTML = '';
        previewHead.append(el('strong', {}, '미리보기'), el('span', { class: 'cd-approx' }, `근사치 · 다운로드 파일은 원본 서식 유지 · 채운 칸 ${res.filledCount}곳 강조`));
        if (lastSheets.length > 1) {
          previewHead.append(el('div', { class: 'quick-tabs cd-sheets' }, lastSheets.map((s, i) => el('button', { class: `quick-tab ${i === sheetIdx ? 'quick-tab--active' : ''}`, onclick: () => { sheetIdx = i; drawPreview(res); } }, s.name))));
        }
        previewBody.innerHTML = '';
        previewBody.append(el('div', { class: `cd-sheet cd-sheet--${S.kind}`, html: (lastSheets[sheetIdx] || { html: '' }).html }));
        for (const n of res.notes || []) previewBody.append(el('div', { class: 'cd-banner cd-banner--warn' }, `⚠ ${n}`));
      }

      // ---- 저장 ----
      function payload() {
        return { title: S.title.trim() || S.name, mapping: S.mapping, field_values: S.values };
      }
      function aliveFinals(doc) {
        const atts = appState.getAttachments(TABLE, doc.id);
        return (doc.finals || []).filter((f) => atts.some((a) => a.id === f.attachment_id));
      }
      async function ensureRow() {
        if (S.docId) return appState.careerDocuments.find((d) => d.id === S.docId);
        const p = payload();
        const row = await appState.addCareerDocument({ title: p.title, template_name: S.name, template_kind: S.kind, mapping: p.mapping, field_values: p.field_values, status: 'draft' });
        S.docId = row.id;
        if (S.templateFile) {
          const att = await appState.addAttachment(TABLE, row.id, S.templateFile);
          await appState.updateCareerDocument(row.id, { template_attachment_id: att.id });
        }
        drawAttach();
        return row;
      }
      function persist({ final, silent }) {
        const run = async () => {
          if (S.saving) return;
          if (!S.title.trim()) { if (!silent) { toast('문서 제목을 입력해 주세요.', 'error'); titleInput.focus(); } return; }
          S.saving = true; updateStatusLine();
          try {
            await ensureRow();
            const doc = appState.careerDocuments.find((d) => d.id === S.docId) || {};
            const p = payload();
            // 템플릿 원본을 다시 연결했거나 아직 저장되지 않았다면 첨부
            const tplAlive = doc.template_attachment_id && appState.getAttachments(TABLE, S.docId).some((a) => a.id === doc.template_attachment_id);
            if (S.bytes && !tplAlive && S.templateFile) {
              const att = await appState.addAttachment(TABLE, S.docId, S.templateFile);
              await appState.updateCareerDocument(S.docId, { template_attachment_id: att.id, template_name: S.name });
            }
            if (!final) {
              await appState.updateCareerDocument(S.docId, { title: p.title, mapping: p.mapping, field_values: p.field_values, status: 'draft' });
              S.status = 'draft';
              if (!silent) toast('임시저장했습니다.', 'success');
            } else {
              if (!S.bytes) throw new Error('양식 원본이 없어 최종 파일을 만들 수 없습니다.');
              const photos = await collectPhotos();
              const res = await FE.fillTemplate(S.kind, S.bytes, S.mapping, S.values, { photos });
              const fname = `최종_${safeName(p.title)}_${ymd()}.${S.kind}`;
              const file = new File([res.bytes], fname, { type: FE.mimeOf(S.kind) });
              const chk = window.checkAttachmentSize(TABLE, file.size, fname);
              if (!chk.ok) throw new Error(chk.message);
              const att = await appState.addAttachment(TABLE, S.docId, file);
              let finals = [{ attachment_id: att.id, name: fname, size: file.size, created_at: new Date().toISOString() }, ...aliveFinals(doc)];
              const drop = finals.slice(MAX_FINALS);
              finals = finals.slice(0, MAX_FINALS);
              for (const f of drop) await appState.deleteAttachment(f.attachment_id).catch(() => {});
              await appState.updateCareerDocument(S.docId, { title: p.title, mapping: p.mapping, field_values: p.field_values, status: 'saved', saved_at: new Date().toISOString(), finals });
              S.status = 'saved';
              downloadBytes(res.bytes, fname, FE.mimeOf(S.kind));
              toast(`저장했습니다. 최종본 "${fname}"을 만들어 내려받았습니다.${res.notes && res.notes.length ? ` (${res.notes.join(' ')})` : ''}`, 'success');
            }
            S.saved = snapshot();
            S.touched = false;
            S.lastSavedAt = new Date().toISOString();
          } catch (e) {
            toast(`${final ? '저장' : '임시저장'} 실패: ${e.message || e}`, 'error');
          } finally {
            S.saving = false; updateStatusLine(); drawFinals(); drawAttach();
          }
        };
        saveChain = saveChain.then(run, run);
        return saveChain;
      }
      async function downloadNow() {
        if (!S.bytes) { toast('양식 원본이 없습니다.', 'error'); return; }
        btnDl.disabled = true;
        try {
          const res = await FE.fillTemplate(S.kind, S.bytes, S.mapping, S.values, { photos: await collectPhotos() });
          downloadBytes(res.bytes, `${safeName(S.title)}_${ymd()}.${S.kind}`, FE.mimeOf(S.kind));
          toast(`파일을 만들었습니다(저장되지 않음).${res.notes.length ? ` ${res.notes.join(' ')}` : ''}`, 'info');
        } catch (e) { toast(`파일 만들기 실패: ${e.message || e}`, 'error'); } finally { btnDl.disabled = false; }
      }

      // ---- 최종본 목록 / 첨부 ----
      function drawFinals() {
        finalsBox.innerHTML = '';
        const doc = S.docId ? appState.careerDocuments.find((d) => d.id === S.docId) : null;
        finalsBox.append(el('h3', {}, `최종본 (최대 ${MAX_FINALS}개 보관)`));
        const list = doc ? aliveFinals(doc) : [];
        if (!list.length) { finalsBox.append(el('p', { class: 'text-muted', style: 'font-size:12px' }, '아직 "저장"한 최종본이 없습니다. 저장하면 최종 파일이 만들어져 여기와 첨부파일에 남습니다.')); return; }
        for (const f of list) {
          finalsBox.append(el('div', { class: 'cd-final' }, [
            el('span', {}, `📎 ${f.name}`), el('span', { class: 'text-muted' }, `${window.formatBytes(f.size)} · ${fmtDT(f.created_at)}`),
            el('button', { class: 'nm-btn cd-final-dl', onclick: async (e) => { e.currentTarget.disabled = true; try { downloadBytes(await attachmentBytes(f.attachment_id), f.name, FE.mimeOf(S.kind)); } catch (x) { toast(x.message || '다운로드 실패', 'error'); } e.currentTarget.disabled = false; } }, '⬇ 다운로드'),
            el('button', { class: 'nm-btn nm-btn--danger cd-final-del', onclick: async () => {
              if (!confirmDialog(`최종본 "${f.name}"을 삭제할까요?`)) return;
              await appState.deleteAttachment(f.attachment_id).catch(() => {});
              await appState.updateCareerDocument(S.docId, { finals: list.filter((x) => x.attachment_id !== f.attachment_id) });
              drawFinals(); drawAttach();
            } }, '삭제'),
          ]));
        }
      }
      function drawAttach() {
        attachBox.innerHTML = '';
        if (!S.docId) { attachBox.append(el('p', { class: 'text-muted', style: 'font-size:12px' }, '※ 처음 저장하면 양식 원본이 첨부로 보관되고, 이 자리에서 다른 첨부(공고문 등)도 붙일 수 있습니다.')); return; }
        attachBox.append(el('h3', {}, '첨부파일 (양식 원본 · 최종본 · 기타)'));
        const panel = el('div', {});
        attachBox.append(panel);
        window.renderAttachmentsPanel(panel, TABLE, S.docId);
      }

      // ---- 닫기 / 정리 ----
      function onBeforeUnload(e) { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } }
      window.addEventListener('beforeunload', onBeforeUnload);
      function teardown() {
        clearInterval(autosaveTimer); clearTimeout(previewTimer);
        window.removeEventListener('beforeunload', onBeforeUnload);
        editor = null;
        editorBox.innerHTML = '';
        editorBox.classList.add('hidden');
        listBox.classList.remove('hidden');
        drawList();
      }
      function requestClose() {
        if (!isDirty()) { teardown(); return; }
        openModal({
          title: '저장하지 않은 변경', width: '460px',
          contentBuilder(body, closeModal) {
            body.append(
              el('p', {}, '편집한 내용이 아직 저장되지 않았습니다. 어떻게 할까요?'),
              el('div', { class: 'row', style: 'gap:8px; flex-wrap:wrap; margin-top:12px' }, [
                el('button', { class: 'nm-btn nm-btn--primary cd-close-save', onclick: async () => { closeModal(); await persist({ final: false }); if (!isDirty()) teardown(); } }, '💾 임시저장하고 닫기'),
                el('button', { class: 'nm-btn nm-btn--danger cd-close-discard', onclick: () => { closeModal(); teardown(); } }, '저장하지 않고 닫기'),
                el('button', { class: 'nm-btn cd-close-cancel', onclick: closeModal }, '계속 편집'),
              ]),
            );
          },
        });
      }
      editor = {
        // 화면 이동 등으로 정리될 때: 변경이 있으면 조용히 임시저장
        async destroy() { if (isDirty() && S.title.trim()) { try { await persist({ final: false, silent: true }); } catch (e) { /* noop */ } } clearInterval(autosaveTimer); clearTimeout(previewTimer); window.removeEventListener('beforeunload', onBeforeUnload); },
        onChange() { updateStatusLine(); drawFinals(); },
        isDirty,
      };

      drawBanners(); drawOptions(); drawMatching(); drawFinals(); drawAttach(); updateStatusLine();
      autosaveTimer = setInterval(() => { if (isDirty() && !S.saving && S.title.trim()) persist({ final: false, silent: true }); }, AUTOSAVE_MS);
      schedulePreview(true);
      root.scrollIntoView && root.scrollIntoView({ block: 'start' });
    }

    // ================================================================
    // 화면 갱신/정리
    // ================================================================
    function onChange() {
      if (editor) editor.onChange(); else drawList();
    }
    appState.addEventListener('change', onChange);
    drawList();

    return {
      openNew,
      isEditing: () => !!editor,
      async destroy() {
        appState.removeEventListener('change', onChange);
        if (editor) await editor.destroy();
      },
    };
  }

  window.renderCareerDocuments = renderCareerDocuments;
})();
