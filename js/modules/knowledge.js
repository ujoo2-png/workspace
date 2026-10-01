// Knowledge 화면. 스크랩한 링크/문서와 메모를 태그로 분류해 모아두는 개인 지식 저장소.
// doc_type으로 "링크/문서"와 "메모"를 구분해서 보여주고, 파일 첨부(📎)도 지원한다.
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

      const rows0 = appState.knowledgeDocs.filter((d) => d.status !== 'archived');
      const allTags = Array.from(new Set(rows0.flatMap((d) => (d.tags || [])))).sort();

      container.append(
        el('div', { class: 'quick-tabs' }, [
          typeTabBtn('all', '전체'),
          typeTabBtn('link', TYPE_LABEL.link),
          typeTabBtn('memo', TYPE_LABEL.memo),
        ])
      );

      container.append(
        el('div', { class: 'row wrap', style: 'gap:8px; margin-bottom:14px' }, [
          el('input', {
            class: 'nm-input',
            style: 'max-width:240px',
            placeholder: '검색(제목/메모)',
            value: query,
            oninput: (e) => { query = e.target.value; draw(); },
          }),
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
      rows = rows.slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

      if (!rows.length) {
        container.append(el('div', { class: 'empty-state' }, '저장된 문서/링크/메모가 없습니다. 나중에 다시 볼 자료나 생각을 기록해보세요.'));
        return;
      }

      const grid = el('div', { class: 'grid-3' });
      for (const d of rows) {
        const attachCount = appState.getAttachments('knowledge_docs', d.id).length;
        grid.append(
          el('div', { class: 'nm-card' }, [
            el('div', { class: 'row row--between', style: 'align-items:flex-start' }, [
              el('div', { style: 'font-weight:700; margin-bottom:2px' }, escapeHtml(d.title)),
              el('span', { class: 'nm-badge' }, TYPE_LABEL[d.doc_type || 'link']),
            ]),
            d.url ? el('a', { href: d.url, target: '_blank', rel: 'noopener', class: 'text-muted', style: 'font-size:12px; word-break:break-all' }, d.url) : null,
            d.memo ? el('div', { class: 'text-muted', style: 'font-size:13px; margin-top:6px; white-space:pre-wrap' }, escapeHtml(d.memo)) : null,
            (d.tags || []).length
              ? el('div', { class: 'row wrap', style: 'gap:4px; margin-top:8px' }, d.tags.map((t) => el('span', { class: 'nm-badge' }, `#${t}`)))
              : null,
            el('div', { class: 'row', style: 'margin-top:10px; gap:6px; justify-content:flex-end' }, [
              el('button', {
                class: 'nm-btn nm-btn--icon', title: '첨부파일' + (attachCount ? ` (${attachCount})` : ''),
                onclick: () => window.openAttachmentsModal('knowledge_docs', d.id, d.title),
              }, attachCount ? `📎${attachCount}` : '📎'),
              el('button', { class: 'nm-btn nm-btn--icon', title: '수정', onclick: () => openDocForm(d) }, '✎'),
              el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: () => remove(d) }, '🗑'),
            ]),
          ])
        );
      }
      container.append(grid);
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

    function openDocForm(existing, defaultType) {
      const isMemo = (existing?.doc_type || defaultType) === 'memo';
      openModal({
        title: existing ? (isMemo ? '메모 수정' : '문서 수정') : (isMemo ? '메모 등록' : '문서/링크 등록'),
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          const urlField = field('URL(선택)', el('input', { class: 'nm-input', type: 'url', name: 'url', placeholder: 'https://...', value: existing?.url || '' }));
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
