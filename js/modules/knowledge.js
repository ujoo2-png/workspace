// Knowledge 화면. 스크랩한 링크/문서와 메모를 태그로 분류해 모아두는 개인 지식 저장소.
// doc_type으로 "링크/문서"와 "메모"를 구분해서 보여주고, 파일 첨부(📎)도 지원한다.
// 현재는 다른 메뉴와 자동으로 연동되지 않는 "독립된 개인 저장소"다(등록한 자료가 다른 화면에
// 자동으로 노출되지는 않는다) — 목록/검색/태그/열람으로 다시 찾아보는 용도.
// 일반 <script>로 로드된다.
(function () {
  const { appState, el, escapeHtml, toast, confirmDialog, openModal, todayISO } = window;

  const TYPE_LABEL = { link: '🔗 링크/문서', memo: '📝 메모' };

  function renderKnowledge(root) {
    const container = el('div', {});
    root.append(container);
    let query = '';
    let tagFilter = 'all';
    let typeFilter = 'all'; // all | link | memo
    let selected = new Set();
    let sortKey = 'created_at';
    let sortDir = 'desc';

    function draw() {
      container.innerHTML = '';
      container.append(
        el('div', { class: 'page-header' }, [
          el('h1', {}, 'Knowledge'),
          el('div', { class: 'row', style: 'gap:8px' }, [
            el('button', { class: 'nm-btn', onclick: () => openDocForm(null, 'memo') }, '+ 메모'),
            el('button', { class: 'nm-btn nm-btn--primary', onclick: () => openDocForm(null, 'link') }, '+ 링크/문서 등록'),
          ]),
        ])
      );

      container.append(
        el('div', { class: 'nm-card', style: 'margin-bottom:14px; font-size:12px' }, [
          el('span', { class: 'text-muted' }, 'ℹ️ Knowledge는 현재 독립된 개인 지식 저장소입니다. 등록한 자료는 다른 메뉴에 자동으로 연동되지 않으며, 이 화면의 검색/태그/열람 기능으로 다시 찾아볼 수 있습니다.'),
        ])
      );

      const rows0 = appState.knowledgeDocs.filter((d) => d.status !== 'archived');
      const allTags = Array.from(new Set(rows0.flatMap((d) => (d.tags || [])))).sort();

      container.append(
        el('div', { class: 'quick-tabs' }, [
          typeTabBtn('all', '전체'),
          typeTabBtn('link', TYPE_LABEL.link),
          typeTabBtn('memo', TYPE_LABEL.memo),
        ])
      );

      const searchInput = el('input', {
        class: 'nm-input knowledge-search-input',
        style: 'max-width:240px',
        placeholder: '검색(제목/메모)',
        value: query,
        oninput: (e) => {
          const pos = e.target.selectionStart;
          query = e.target.value;
          draw();
          // draw()가 container.innerHTML = ''로 전체를 다시 그리며 입력창도 새로 생기기 때문에,
          // 포커스/커서 위치를 잃어 "한 글자만 입력되는 것처럼" 보이는 문제가 있었다.
          // 새로 만들어진 입력창을 다시 찾아 포커스와 커서 위치를 복원한다.
          const next = container.querySelector('.knowledge-search-input');
          if (next) {
            next.focus();
            try { next.setSelectionRange(pos, pos); } catch (e2) { /* 일부 input type은 지원 안 함 — 무시 */ }
          }
        },
      });

      container.append(
        el('div', { class: 'row wrap', style: 'gap:8px; margin-bottom:14px' }, [
          searchInput,
          tagBtn('all', '전체 태그'),
          ...allTags.map((t) => tagBtn(t, `#${t}`)),
        ])
      );

      let rows = rows0;
      if (typeFilter !== 'all') rows = rows.filter((d) => (d.doc_type || 'link') === typeFilter);
      if (tagFilter !== 'all') rows = rows.filter((d) => (d.tags || []).includes(tagFilter));
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        rows = rows.filter((d) => (d.title || '').toLowerCase().includes(q) || (d.memo || '').toLowerCase().includes(q));
      }
      rows = sortKnowledgeRows(rows, sortKey, sortDir);

      if (!rows.length) {
        container.append(el('div', { class: 'empty-state' }, '저장된 문서/링크/메모가 없습니다. 나중에 다시 볼 자료나 생각을 기록해보세요.'));
        return;
      }

      selected = new Set([...selected].filter((id) => rows.some((r) => r.id === id)));
      const selCount = selected.size;
      container.append(
        el('div', { class: 'row row--between', style: 'margin-bottom:8px; align-items:center' }, [
          el('label', { class: 'row', style: 'gap:6px; align-items:center; cursor:pointer; font-size:13px' }, [
            el('input', {
              type: 'checkbox',
              checked: rows.length > 0 && selCount === rows.length ? true : undefined,
              onchange: (e) => {
                if (e.target.checked) rows.forEach((r) => selected.add(r.id));
                else selected.clear();
                draw();
              },
            }),
            el('span', { class: 'text-muted' }, '전체선택'),
          ]),
          el('button', {
            class: 'nm-btn nm-btn--danger',
            disabled: selCount === 0 || undefined,
            onclick: async () => {
              if (!confirmDialog(`선택한 ${selCount}건을 삭제할까요?`)) return;
              const ids = [...selected];
              selected.clear();
              await appState.deleteKnowledgeDocsBulk(ids);
              toast(`${ids.length}건 삭제했습니다.`, 'success');
            },
          }, `선택 삭제${selCount ? ` (${selCount})` : ''}`),
        ])
      );

      const tableWrap = el('div', { class: 'data-table-wrap' });
      const table = el('table', { class: 'data-table' });
      table.append(
        el('colgroup', {}, [
          el('col', { style: 'width:34px' }),
          el('col', { style: 'width:40px' }),
          el('col', { style: 'width:34%' }),
          el('col', { style: 'width:10%' }),
          el('col', { style: 'width:24%' }),
          el('col', { style: 'width:8%' }),
          el('col', { style: 'width:150px' }),
        ])
      );
      table.append(
        el('thead', {}, [
          el('tr', {}, [
            el('th', {}, [
              el('input', {
                type: 'checkbox',
                checked: rows.length > 0 && selCount === rows.length ? true : undefined,
                onchange: (e) => {
                  if (e.target.checked) rows.forEach((r) => selected.add(r.id));
                  else selected.clear();
                  draw();
                },
              }),
            ]),
            el('th', {}, 'No'),
            sortTh('title', '제목'),
            sortTh('doc_type', '종류'),
            el('th', {}, '태그'),
            sortTh('attach', '첨부'),
            el('th', {}, '작업'),
          ]),
        ])
      );
      const tbody = el('tbody', {});
      rows.forEach((d, idx) => {
        const attachCount = appState.getAttachments('knowledge_docs', d.id).length;
        tbody.append(
          el('tr', {}, [
            el('td', {}, [
              el('input', {
                type: 'checkbox',
                checked: selected.has(d.id) || undefined,
                onchange: (e) => { if (e.target.checked) selected.add(d.id); else selected.delete(d.id); draw(); },
              }),
            ]),
            el('td', {}, String(idx + 1)),
            el('td', { style: 'cursor:pointer', onclick: () => openViewModal(d) }, [
              el('strong', {}, escapeHtml(d.title)),
              d.memo ? el('div', { class: 'text-muted', style: 'font-size:12px; margin-top:2px; max-width:360px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap' }, escapeHtml(d.memo)) : null,
            ]),
            el('td', {}, el('span', { class: 'nm-badge' }, TYPE_LABEL[d.doc_type || 'link'])),
            el('td', {}, (d.tags || []).length ? el('div', { class: 'row wrap', style: 'gap:4px' }, d.tags.map((t) => el('span', { class: 'nm-badge' }, `#${t}`))) : '-'),
            el('td', {}, attachCount ? `📎${attachCount}` : '-'),
            el('td', {}, [
              el('div', { class: 'icon-row' }, [
                el('button', { class: 'nm-btn nm-btn--icon', title: '열람', onclick: () => openViewModal(d) }, '👁'),
                el('button', { class: 'nm-btn nm-btn--icon', title: '수정', onclick: () => openDocForm(d) }, '✎'),
                el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: () => remove(d) }, '🗑'),
              ]),
            ]),
          ])
        );
      });
      table.append(tbody);
      tableWrap.append(table);
      container.append(tableWrap);
    }

    // 5.1 공통 list UI — 컬럼 헤더를 눌러 정렬(오름/내림 토글), 활성 컬럼엔 ▲/▼ 표시.
    function sortTh(key, label) {
      const active = sortKey === key;
      return el(
        'th',
        { class: active ? 'is-sorted' : '', onclick: () => { if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc'; else { sortKey = key; sortDir = 'asc'; } draw(); } },
        [label, active ? el('span', { class: 'sort-arrow' }, sortDir === 'asc' ? '▲' : '▼') : null]
      );
    }

    function sortKnowledgeRows(rows, key, dir) {
      const sorted = rows.slice().sort((a, b) => {
        let cmp;
        if (key === 'attach') cmp = appState.getAttachments('knowledge_docs', a.id).length - appState.getAttachments('knowledge_docs', b.id).length;
        else if (key === 'doc_type') cmp = (a.doc_type || 'link').localeCompare(b.doc_type || 'link');
        else if (key === 'title') cmp = (a.title || '').localeCompare(b.title || '');
        else cmp = (a.created_at || '').localeCompare(b.created_at || '');
        return dir === 'asc' ? cmp : -cmp;
      });
      return sorted;
    }

    function typeTabBtn(key, label) {
      const active = typeFilter === key;
      return el('button', { class: `quick-tab ${active ? 'quick-tab--active' : ''}`, onclick: () => { typeFilter = key; draw(); } }, label);
    }

    function tagBtn(key, label) {
      const active = tagFilter === key;
      return el('button', { class: `nm-btn ${active ? 'nm-btn--primary' : ''}`, onclick: () => { tagFilter = key; draw(); } }, label);
    }

    async function remove(d) {
      if (!confirmDialog(`"${d.title}"을(를) 삭제할까요?`)) return;
      await appState.deleteKnowledgeDoc(d.id);
      toast('삭제했습니다.', 'success');
    }

    // 열람(읽기 전용) 모달 — 1.1: 첨부파일을 목록으로만 보여주던 것을 실제로 "미리보기"하도록
    // 바꿨다. 이미지는 <img>로, PDF는 <iframe>으로 모달 안에서 바로 보여주고, 그 외 파일은
    // 기존처럼 다운로드 링크만 보여준다. 링크형(URL) 문서는 외부 사이트라 iframe으로 끼워넣으면
    // X-Frame-Options 등으로 대부분 막히므로 iframe 시도 대신 "새 탭에서 열기" 버튼을 크고
    // 눈에 띄게 둬서 그게 사실상의 "미리보기" 동작이 되도록 안내한다.
    function openViewModal(d) {
      openModal({
        title: `${TYPE_LABEL[d.doc_type || 'link']} 열람`,
        contentBuilder(body) {
          body.append(el('h2', { style: 'margin:0 0 6px; font-size:18px' }, escapeHtml(d.title)));
          if (d.url) {
            body.append(
              el('div', { style: 'margin:8px 0 4px' }, [
                el('a', {
                  href: d.url, target: '_blank', rel: 'noopener',
                  class: 'nm-btn nm-btn--primary', style: 'display:inline-flex',
                }, '🔗 새 탭에서 열기'),
              ]),
              el('div', { class: 'text-muted', style: 'word-break:break-all; font-size:12px; margin-top:4px' }, d.url)
            );
          }
          if (d.memo) {
            body.append(el('div', { class: 'text-muted', style: 'white-space:pre-wrap; margin-top:12px; font-size:14px; line-height:1.6' }, escapeHtml(d.memo)));
          }
          if ((d.tags || []).length) {
            body.append(el('div', { class: 'row wrap', style: 'gap:4px; margin-top:12px' }, d.tags.map((t) => el('span', { class: 'nm-badge' }, `#${t}`))));
          }
          const attachments = appState.getAttachments('knowledge_docs', d.id);
          if (attachments.length) {
            body.append(el('h3', { style: 'margin:16px 0 8px; font-size:14px' }, '첨부파일 미리보기'));
            const previewBox = el('div', { class: 'stack', style: 'gap:10px' });
            body.append(previewBox);
            window.renderAttachmentPreviews(previewBox, 'knowledge_docs', d.id);
          }
          const attachBox = el('div', { style: 'margin-top:16px' });
          body.append(el('h3', { style: 'margin:0 0 6px; font-size:14px' }, '첨부파일 관리(추가/삭제)'), attachBox);
          window.renderAttachmentsPanel(attachBox, 'knowledge_docs', d.id);
        },
      });
    }

    function openDocForm(existing, defaultType) {
      const isMemo = (existing?.doc_type || defaultType) === 'memo';
      openModal({
        title: existing ? (isMemo ? '메모 수정' : '문서 수정') : (isMemo ? '메모 등록' : '문서/링크 등록'),
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          const urlInput = el('input', { class: 'nm-input', type: 'url', name: 'url', placeholder: 'https://...', value: existing?.url || '' });
          const urlField = field('URL(선택)', urlInput);
          // v7.21.0: 같은 링크가 이미 있으면 저장 전에 알려 준다(막지는 않음 — 의도적 중복도 가능)
          const dupWarn = el('div', { class: 'nm-field__hint', role: 'status', hidden: true, style: 'color:var(--color-warning, #b45309)' });
          urlField.append(dupWarn);
          const checkDup = () => {
            const dup = window.findDuplicateUrl(urlInput.value, appState.knowledgeDocs, existing?.id);
            dupWarn.hidden = !dup;
            if (dup) dupWarn.textContent = `⚠️ 이미 등록된 링크입니다: "${dup.title}"`;
          };
          urlInput.addEventListener('input', checkDup);
          urlInput.addEventListener('change', checkDup);
          if (isMemo) urlField.style.display = 'none';
          form.append(
            field('제목', el('input', { class: 'nm-input', name: 'title', required: true, value: existing?.title || '', placeholder: isMemo ? '메모 제목' : '제목' })),
            urlField,
            field('태그(쉼표로 구분, 선택)', el('input', { class: 'nm-input', name: 'tags', placeholder: '예: 업무, 참고자료', value: (existing?.tags || []).join(', ') })),
            field(isMemo ? '내용' : '메모(선택)', el('textarea', { class: 'nm-textarea', name: 'memo', style: isMemo ? 'min-height:140px' : '' }, existing?.memo || ''))
          );
          const submitBtn = el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장');
          form.append(submitBtn);
          // 신규 등록 직후 바로 파일을 첨부할 수 있도록(다시 열 필요 없이), 저장되면 폼 자리에 첨부 패널을 보여준다.
          const attachHost = el('div', {});
          body.append(form, attachHost);
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const tags = String(fd.get('tags') || '')
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean);
            const data = {
              title: fd.get('title'),
              doc_type: isMemo ? 'memo' : 'link',
              url: isMemo ? null : fd.get('url') || null,
              tags,
              memo: fd.get('memo') || null,
            };
            if (existing) {
              await appState.updateKnowledgeDoc(existing.id, data);
              toast('저장했습니다.', 'success');
              close();
            } else {
              const row = await appState.addKnowledgeDoc(data);
              toast('등록했습니다. 이제 파일을 첨부할 수 있어요.', 'success');
              Array.from(form.elements).forEach((elm) => { elm.disabled = true; });
              submitBtn.style.display = 'none';
              attachHost.append(
                el('h3', { style: 'margin:16px 0 8px' }, '첨부파일'),
                el('div', { id: 'new-knowledge-attach-box' }),
                el('button', { class: 'nm-btn nm-btn--primary', style: 'width:100%; margin-top:12px', onclick: close }, '완료')
              );
              window.renderAttachmentsPanel(attachHost.querySelector('#new-knowledge-attach-box'), 'knowledge_docs', row.id);
            }
          });
        },
      });
    }

    function field(label, node) {
      return el('div', { class: 'nm-field' }, [el('label', {}, label), node]);
    }

    draw();
    appState.addEventListener('change', draw);
    return () => appState.removeEventListener('change', draw);
  }

  window.renderKnowledge = renderKnowledge;
})();
