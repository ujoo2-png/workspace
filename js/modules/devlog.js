// Devlog 화면. 개발/개선 작업 기록을 남기고 프로젝트와 연결한다(개발계획서 3장 "Devlog" 메뉴).
// GitHub 이슈 연동: 실제 OAuth/API 연동(이슈 자동 동기화) 대신, 이슈 URL을 기록해두면
// "owner/repo#번호" 형태의 배지로 파싱해 보여주고 클릭 시 바로 이동할 수 있게 하는 가벼운 버전으로 구현했다.
// 일반 <script>로 로드된다.
(function () {
  const { appState, el, escapeHtml, toast, confirmDialog, openModal, todayISO } = window;

  const TYPE_LABEL = { feature: '기능 추가', fix: '버그 수정', refactor: '리팩터링', docs: '문서', chore: '기타' };

  // https://github.com/owner/repo/issues/123 (또는 /pull/123) → "owner/repo#123" 배지 텍스트로 변환.
  function parseGithubIssueUrl(url) {
    if (!url) return null;
    const m = String(url).match(/github\.com\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)/i);
    if (!m) return null;
    return { label: `${m[1]}/${m[2]}#${m[3]}`, isPr: /\/pull\//i.test(url) };
  }

  function renderDevlog(root) {
    const container = el('div', {});
    root.append(container);
    let projectFilter = 'all';
    let tagFilter = 'all';

    function draw() {
      container.innerHTML = '';
      container.append(
        el('div', { class: 'page-header' }, [
          el('h1', {}, 'Devlog'),
          el('button', { class: 'nm-btn nm-btn--primary', onclick: () => openLogForm() }, '+ 기록'),
        ])
      );

      const rows0 = appState.devlogs.filter((d) => !d.deleted_at);
      const allTags = Array.from(new Set(rows0.flatMap((d) => d.tags || []))).sort();
      const projectOptions = appState.projects.filter((p) => !p.deleted_at);

      container.append(
        el('div', { class: 'row wrap', style: 'gap:8px; margin-bottom:14px' }, [
          projectSelectFilter(projectOptions),
          tagBtn('all', '태그 전체'),
          ...allTags.map((t) => tagBtn(t, `#${t}`)),
        ])
      );

      let rows = rows0;
      if (projectFilter !== 'all') rows = rows.filter((d) => d.project_id === projectFilter);
      if (tagFilter !== 'all') rows = rows.filter((d) => (d.tags || []).includes(tagFilter));
      rows = rows.slice().sort((a, b) => (b.logged_at || b.created_at || '').localeCompare(a.logged_at || a.created_at || ''));

      if (!rows.length) {
        container.append(el('div', { class: 'empty-state' }, '기록된 개발 로그가 없습니다. 오늘 한 작업을 남겨보세요.'));
        return;
      }

      const list = el('div', { class: 'item-list' });
      for (const d of rows) {
        const project = appState.projects.find((p) => p.id === d.project_id);
        const issue = parseGithubIssueUrl(d.issue_url);
        list.append(
          el('div', { class: 'item-row', style: 'align-items:flex-start' }, [
            el('span', { class: 'nm-badge' }, TYPE_LABEL[d.type] || d.type),
            el('div', { class: 'item-row__main' }, [
              el('div', { class: 'item-row__title' }, escapeHtml(d.title)),
              el('div', { class: 'item-row__meta' }, [
                `${d.logged_at || (d.created_at || '').slice(0, 10)}`,
                project ? ` · 📁 ${escapeHtml(project.name)}` : '',
              ].join('')),
              d.content ? el('div', { class: 'text-muted', style: 'font-size:13px; margin-top:4px; white-space:pre-wrap' }, escapeHtml(d.content)) : null,
              d.issue_url
                ? el('a', { href: d.issue_url, target: '_blank', rel: 'noopener', class: 'nm-badge', style: 'margin-top:6px; display:inline-block; text-decoration:none' },
                    issue ? `${issue.isPr ? '🔀' : '🐙'} ${issue.label}` : '🔗 이슈 링크')
                : null,
              (d.tags || []).length
                ? el('div', { class: 'row wrap', style: 'gap:4px; margin-top:6px' }, d.tags.map((t) => el('span', { class: 'nm-badge' }, `#${t}`)))
                : null,
            ]),
            el('div', { class: 'icon-row' }, [
              el('button', { class: 'nm-btn nm-btn--icon', title: '수정', onclick: () => openLogForm(d) }, '✎'),
              el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: () => remove(d) }, '🗑'),
            ]),
          ])
        );
      }
      container.append(el('div', { class: 'nm-card' }, [list]));
    }

    function projectSelectFilter(projects) {
      const select = el(
        'select',
        {
          class: 'nm-select',
          style: 'width:180px',
          onchange: (e) => { projectFilter = e.target.value; draw(); },
        },
        [
          el('option', { value: 'all', selected: projectFilter === 'all' || undefined }, '프로젝트 전체'),
          ...projects.map((p) => el('option', { value: p.id, selected: p.id === projectFilter || undefined }, p.name)),
        ]
      );
      return select;
    }

    function tagBtn(key, label) {
      const active = tagFilter === key;
      return el('button', { class: `nm-btn ${active ? 'nm-btn--primary' : ''}`, onclick: () => { tagFilter = key; draw(); } }, label);
    }

    async function remove(d) {
      if (!confirmDialog(`"${d.title}" 기록을 삭제할까요?`)) return;
      await appState.deleteDevlog(d.id);
      toast('삭제했습니다.', 'success');
    }

    function openLogForm(existing) {
      openModal({
        title: existing ? '기록 수정' : '개발 기록 추가',
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          form.append(
            field('제목', el('input', { class: 'nm-input', name: 'title', required: true, value: existing?.title || '' })),
            field('종류', typeSelect(existing?.type)),
            field('날짜', el('input', { class: 'nm-input', type: 'date', name: 'logged_at', value: existing?.logged_at || todayISO() })),
            field('연결 프로젝트(선택)', projectSelect(existing?.project_id)),
            field('태그(쉼표로 구분, 선택)', el('input', { class: 'nm-input', name: 'tags', value: (existing?.tags || []).join(', ') })),
            field('GitHub 이슈/PR 링크(선택)', el('input', { class: 'nm-input', type: 'url', name: 'issue_url', placeholder: 'https://github.com/owner/repo/issues/123', value: existing?.issue_url || '' })),
            field('내용', el('textarea', { class: 'nm-textarea', name: 'content', rows: 5 }, existing?.content || ''))
          );
          form.append(el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장'));
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const tags = String(fd.get('tags') || '').split(',').map((t) => t.trim()).filter(Boolean);
            const data = {
              title: fd.get('title'),
              type: fd.get('type'),
              logged_at: fd.get('logged_at') || todayISO(),
              project_id: fd.get('project_id') || null,
              tags,
              issue_url: fd.get('issue_url') || null,
              content: fd.get('content') || null,
            };
            if (existing) await appState.updateDevlog(existing.id, data);
            else await appState.addDevlog(data);
            toast('저장했습니다.', 'success');
            close();
          });
          body.append(form);
        },
      });
    }

    function typeSelect(selected = 'feature') {
      const select = el('select', { class: 'nm-select', name: 'type' });
      for (const [value, label] of Object.entries(TYPE_LABEL)) select.append(el('option', { value, selected: value === selected || undefined }, label));
      return select;
    }

    function projectSelect(selected) {
      const select = el('select', { class: 'nm-select', name: 'project_id' }, [el('option', { value: '' }, '(연결 안 함)')]);
      for (const p of appState.projects.filter((p) => !p.deleted_at)) {
        select.append(el('option', { value: p.id, selected: p.id === selected || undefined }, p.name));
      }
      return select;
    }

    function field(label, node) {
      return el('div', { class: 'nm-field' }, [el('label', {}, label), node]);
    }

    draw();
    appState.addEventListener('change', draw);
    return () => appState.removeEventListener('change', draw);
  }

  window.renderDevlog = renderDevlog;
})();
