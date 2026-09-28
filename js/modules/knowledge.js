// Knowledge 화면. 스크랩한 링크·메모·문서를 태그로 분류해 모아두는 개인 지식 저장소.
// (개발계획서 v3.2 §추가 메뉴: Knowledge — 파일 업로드/전문 검색 없이, 제목·URL·메모·태그만 다루는 단순화 버전)
// 일반 <script>로 로드된다.
(function () {
  const { appState, el, escapeHtml, toast, confirmDialog, openModal, todayISO } = window;

  function renderKnowledge(root) {
    const container = el('div', {});
    root.append(container);
    let query = '';
    let tagFilter = 'all';

    function draw() {
      container.innerHTML = '';
      container.append(
        el('div', { class: 'page-header' }, [
          el('h1', {}, 'Knowledge'),
          el('button', { class: 'nm-btn nm-btn--primary', onclick: () => openDocForm() }, '+ 등록'),
        ])
      );

      const rows0 = appState.knowledgeDocs.filter((d) => d.status !== 'archived');
      const allTags = Array.from(new Set(rows0.flatMap((d) => (d.tags || [])))).sort();

      container.append(
        el('div', { class: 'row wrap', style: 'gap:8px; margin-bottom:14px' }, [
          el('input', {
            class: 'nm-input',
            style: 'max-width:240px',
            placeholder: '검색(제목/메모)',
            value: query,
            oninput: (e) => { query = e.target.value; draw(); },
          }),
          tagBtn('all', '전체'),
          ...allTags.map((t) => tagBtn(t, `#${t}`)),
        ])
      );

      let rows = rows0;
      if (tagFilter !== 'all') rows = rows.filter((d) => (d.tags || []).includes(tagFilter));
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        rows = rows.filter((d) => (d.title || '').toLowerCase().includes(q) || (d.memo || '').toLowerCase().includes(q));
      }
      rows = rows.slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

      if (!rows.length) {
        container.append(el('div', { class: 'empty-state' }, '저장된 문서/링크가 없습니다. 나중에 다시 볼 자료를 등록해보세요.'));
        return;
      }

      const grid = el('div', { class: 'grid-3' });
      for (const d of rows) {
        grid.append(
          el('div', { class: 'nm-card' }, [
            el('div', { style: 'font-weight:700; margin-bottom:2px' }, escapeHtml(d.title)),
            d.url ? el('a', { href: d.url, target: '_blank', rel: 'noopener', class: 'text-muted', style: 'font-size:12px; word-break:break-all' }, d.url) : null,
            d.memo ? el('div', { class: 'text-muted', style: 'font-size:13px; margin-top:6px; white-space:pre-wrap' }, escapeHtml(d.memo)) : null,
            (d.tags || []).length
              ? el('div', { class: 'row wrap', style: 'gap:4px; margin-top:8px' }, d.tags.map((t) => el('span', { class: 'nm-badge' }, `#${t}`)))
              : null,
            el('div', { class: 'row', style: 'margin-top:10px; gap:6px; justify-content:flex-end' }, [
              el('button', { class: 'nm-btn nm-btn--icon', title: '수정', onclick: () => openDocForm(d) }, '✎'),
              el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: () => remove(d) }, '🗑'),
            ]),
          ])
        );
      }
      container.append(grid);
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

    function openDocForm(existing) {
      openModal({
        title: existing ? '문서 수정' : '문서/링크 등록',
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          form.append(
            field('제목', el('input', { class: 'nm-input', name: 'title', required: true, value: existing?.title || '' })),
            field('URL(선택)', el('input', { class: 'nm-input', type: 'url', name: 'url', placeholder: 'https://...', value: existing?.url || '' })),
            field('태그(쉼표로 구분, 선택)', el('input', { class: 'nm-input', name: 'tags', placeholder: '예: 업무, 참고자료', value: (existing?.tags || []).join(', ') })),
            field('메모(선택)', el('textarea', { class: 'nm-textarea', name: 'memo' }, existing?.memo || ''))
          );
          form.append(el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장'));
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const tags = String(fd.get('tags') || '')
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean);
            const data = {
              title: fd.get('title'),
              url: fd.get('url') || null,
              tags,
              memo: fd.get('memo') || null,
            };
            if (existing) await appState.updateKnowledgeDoc(existing.id, data);
            else await appState.addKnowledgeDoc(data);
            toast('저장했습니다.', 'success');
            close();
          });
          body.append(form);
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
