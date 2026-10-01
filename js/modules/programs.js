// 프로그램(나만의 프로그램 관리) + 즐겨찾기 URL(바로가기) 화면.
// 프로그램은 "개발툴 → 게시(GitHub) → 배포(Vercel) → 저장(Supabase)" 과정을 가로 플로우로 보여준다.
// 일반 <script>로 로드된다.
(function () {
  const { appState, el, escapeHtml, toast, confirmDialog, openModal, todayISO } = window;

  const TYPE_LABEL = { web: '웹앱', mobile: '모바일앱', widget: '위젯', web_mobile: '웹+모바일' };
  const DEV_TOOLS = ['Claude', 'OpenCode', 'Vibe-X', 'Cursor'];
  const PIPELINE_STAGES = [
    { key: 'dev', icon: '🧑‍💻', label: '개발툴', hasTool: true },
    { key: 'github', icon: '🐙', label: '게시(GitHub)' },
    { key: 'vercel', icon: '▲', label: '배포(Vercel)' },
    { key: 'supabase', icon: '🗄️', label: '저장(Supabase)' },
  ];

  function renderPrograms(root) {
    const container = el('div', {});
    root.append(container);
    let tab = 'programs'; // 'programs' | 'bookmarks'
    const revealedPasswords = new Set();

    function draw() {
      container.innerHTML = '';
      container.append(
        el('div', { class: 'page-header' }, [
          el('h1', {}, '프로그램'),
          el('div', { class: 'row', style: 'gap:8px' }, [
            tab === 'programs'
              ? el('button', { class: 'nm-btn nm-btn--primary', onclick: () => openProgramForm() }, '+ 프로그램 등록')
              : el('button', { class: 'nm-btn nm-btn--primary', onclick: () => openBookmarkForm() }, '+ 즐겨찾기 등록'),
          ]),
        ])
      );

      container.append(
        el('div', { class: 'quick-tabs' }, [
          tabBtn('programs', '🧩 내 프로그램'),
          tabBtn('bookmarks', '⭐ 즐겨찾기 URL'),
        ])
      );

      if (tab === 'programs') container.append(programsSection());
      else container.append(bookmarksSection());
    }

    function tabBtn(key, label) {
      const active = tab === key;
      return el('button', { class: `quick-tab ${active ? 'quick-tab--active' : ''}`, onclick: () => { tab = key; draw(); } }, label);
    }

    // ================= 프로그램 =================
    function programsSection() {
      const rows = appState.programs.slice().sort((a, b) => (b.run_count || 0) - (a.run_count || 0));
      if (!rows.length) {
        return el('div', { class: 'empty-state' }, '직접 만든 웹앱/모바일앱/위젯을 등록하고 개발~배포 과정을 관리해보세요.');
      }
      const stack = el('div', { class: 'stack' });
      for (const p of rows) stack.append(programCard(p));
      return stack;
    }

    function programCard(p) {
      const project = p.project_id ? appState.projects.find((pr) => pr.id === p.project_id) : null;
      const pipeline = p.pipeline || {};

      const header = el('div', { class: 'row row--between wrap', style: 'gap:10px' }, [
        el('div', { class: 'row', style: 'gap:10px; align-items:center' }, [
          el('span', { style: 'font-size:24px' }, p.icon || '🔗'),
          el('div', {}, [
            el('div', { style: 'font-weight:700; font-size:15px' }, [
              escapeHtml(p.name),
              el('span', { class: 'nm-badge', style: 'margin-left:8px' }, TYPE_LABEL[p.program_type] || p.program_type || '웹앱'),
            ]),
            el('div', { class: 'row', style: 'gap:8px; margin-top:2px' }, [
              el('a', { href: p.url, target: '_blank', rel: 'noopener', class: 'text-muted', style: 'font-size:12px; word-break:break-all' }, p.url),
              project ? el('span', { class: 'nm-badge nm-badge--info', title: '연결된 프로젝트' }, `📁 ${escapeHtml(project.name)}`) : null,
            ]),
          ]),
        ]),
        el('div', { class: 'row', style: 'gap:6px' }, [
          el('span', { class: 'text-muted', style: 'font-size:11px; align-self:center' }, `실행 ${p.run_count || 0}회`),
          el('button', { class: 'nm-btn nm-btn--primary', onclick: () => appState.runProgram(p.id) }, '열기'),
          el('button', { class: 'nm-btn nm-btn--icon', title: '첨부파일', onclick: () => window.openAttachmentsModal('programs', p.id, p.name) }, '📎'),
          el('button', { class: 'nm-btn nm-btn--icon', title: '수정', onclick: () => openProgramForm(p) }, '✎'),
          el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: () => removeProgram(p) }, '🗑'),
        ]),
      ]);

      const flow = el('div', { class: 'program-flow' });
      PIPELINE_STAGES.forEach((stage, idx) => {
        const data = pipeline[stage.key] || {};
        const filled = data.id || data.date;
        flow.append(
          el('div', { class: `program-flow__stage ${filled ? '' : 'program-flow__stage--empty'}` }, [
            el('div', { class: 'program-flow__icon' }, stage.icon),
            el('div', { class: 'program-flow__label' }, stage.label),
            stage.hasTool && data.tool ? el('div', { class: 'program-flow__detail' }, escapeHtml(data.tool)) : null,
            data.id ? el('div', { class: 'program-flow__detail' }, `ID: ${escapeHtml(data.id)}`) : null,
            data.date ? el('div', { class: 'program-flow__detail text-muted' }, data.date) : null,
            !filled ? el('div', { class: 'program-flow__detail text-muted' }, '미입력') : null,
          ])
        );
        if (idx < PIPELINE_STAGES.length - 1) flow.append(el('div', { class: 'program-flow__arrow' }, '→'));
      });

      const card = el('div', { class: 'nm-card' }, [header, el('div', { class: 'program-flow-wrap' }, [flow])]);

      if (p.admin_id || p.admin_password) {
        const revealed = revealedPasswords.has(p.id);
        card.append(
          el('div', { class: 'program-admin-box' }, [
            el('span', { class: 'text-muted', style: 'font-size:12px' }, '관리자 계정'),
            el('span', { style: 'font-size:13px; font-weight:600' }, p.admin_id || '-'),
            p.admin_password
              ? el('span', { class: 'row', style: 'gap:4px; align-items:center' }, [
                  el('span', { style: 'font-size:13px; font-family:monospace' }, revealed ? p.admin_password : '•'.repeat(Math.min(10, p.admin_password.length || 8))),
                  el('button', {
                    class: 'nm-btn nm-btn--icon', title: revealed ? '숨기기' : '보기',
                    onclick: () => { revealed ? revealedPasswords.delete(p.id) : revealedPasswords.add(p.id); draw(); },
                  }, revealed ? '🙈' : '👁️'),
                ])
              : null,
          ])
        );
      }

      return card;
    }

    async function removeProgram(p) {
      if (!confirmDialog(`"${p.name}"을(를) 목록에서 삭제할까요?`)) return;
      await appState.deleteProgram(p.id);
      toast('삭제했습니다.', 'success');
    }

    function openProgramForm(existing) {
      openModal({
        title: existing ? '프로그램 수정' : '프로그램 등록',
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });

          const typeSelect = el('select', { class: 'nm-select', name: 'program_type' });
          for (const [value, label] of Object.entries(TYPE_LABEL)) typeSelect.append(el('option', { value }, label));
          typeSelect.value = existing?.program_type || 'web';

          const projectSelect = el('select', { class: 'nm-select', name: 'project_id' }, [
            el('option', { value: '' }, '연결 안 함'),
            ...appState.projects.map((pr) => el('option', { value: pr.id }, pr.name)),
          ]);
          projectSelect.value = existing?.project_id || '';

          form.append(
            field('이름', el('input', { class: 'nm-input', name: 'name', required: true, value: existing?.name || '' })),
            field('유형', typeSelect),
            field('URL', el('input', { class: 'nm-input', type: 'url', name: 'url', required: true, placeholder: 'https://…', value: existing?.url || '' })),
            field('아이콘(이모지, 선택)', el('input', { class: 'nm-input', name: 'icon', maxlength: '2', value: existing?.icon || '' })),
            field('연결된 프로젝트(선택)', projectSelect),
            field('설명(선택)', el('textarea', { class: 'nm-textarea', name: 'description' }, existing?.description || ''))
          );

          // ---- 개발~배포 파이프라인 ----
          const pipeline = existing?.pipeline || {};
          const stageInputs = {};
          const devToolList = el('datalist', { id: 'dev-tool-options' }, DEV_TOOLS.map((t) => el('option', { value: t })));
          form.append(devToolList);
          form.append(el('h3', { style: 'margin:10px 0 2px; font-size:14px' }, '개발 · 배포 파이프라인'));
          for (const stage of PIPELINE_STAGES) {
            const d = pipeline[stage.key] || {};
            const idInput = el('input', { class: 'nm-input', placeholder: 'ID / 계정 / 프로젝트명', value: d.id || '' });
            const dateInput = el('input', { class: 'nm-input', type: 'date', value: d.date || '' });
            const toolInput = stage.hasTool
              ? el('input', { class: 'nm-input', list: 'dev-tool-options', placeholder: '예: Claude', value: d.tool || '' })
              : null;
            stageInputs[stage.key] = { idInput, dateInput, toolInput };
            const rowFields = [
              stage.hasTool ? field('툴', toolInput) : null,
              field('ID', idInput),
              field('작업일', dateInput),
            ].filter(Boolean);
            form.append(
              el('div', { class: 'program-stage-field' }, [
                el('div', { style: 'font-weight:600; font-size:13px; margin-bottom:4px' }, `${stage.icon} ${stage.label}`),
                el('div', { class: 'row wrap', style: 'gap:8px' }, rowFields.map((f) => el('div', { style: 'flex:1; min-width:120px' }, [f]))),
              ])
            );
          }

          // ---- 관리자 계정 ----
          const adminPwInput = el('input', { class: 'nm-input', type: 'password', name: 'admin_password', value: existing?.admin_password || '', autocomplete: 'new-password' });
          const togglePwBtn = el('button', {
            type: 'button', class: 'nm-btn nm-btn--icon',
            onclick: () => {
              const show = adminPwInput.type === 'password';
              adminPwInput.type = show ? 'text' : 'password';
              togglePwBtn.textContent = show ? '🙈' : '👁️';
            },
          }, '👁️');
          form.append(el('h3', { style: 'margin:10px 0 2px; font-size:14px' }, '관리자 계정(선택)'));
          form.append(
            el('div', { class: 'row wrap', style: 'gap:8px' }, [
              el('div', { style: 'flex:1; min-width:140px' }, [field('관리자 ID', el('input', { class: 'nm-input', name: 'admin_id', value: existing?.admin_id || '' }))]),
              el('div', { style: 'flex:1; min-width:140px' }, [field('비밀번호', el('div', { class: 'row', style: 'gap:6px' }, [adminPwInput, togglePwBtn]))]),
            ])
          );
          form.append(el('p', { class: 'text-muted', style: 'font-size:11px' }, '※ 암호화 없이 저장됩니다. 중요한 계정은 별도 비밀번호 관리자 사용을 권장합니다.'));

          form.append(el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장'));
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const newPipeline = {};
            for (const stage of PIPELINE_STAGES) {
              const s = stageInputs[stage.key];
              const entry = { id: s.idInput.value || null, date: s.dateInput.value || null };
              if (s.toolInput) entry.tool = s.toolInput.value || null;
              if (entry.id || entry.date || entry.tool) newPipeline[stage.key] = entry;
            }
            const data = {
              name: fd.get('name'),
              program_type: fd.get('program_type'),
              url: fd.get('url'),
              icon: fd.get('icon') || null,
              project_id: fd.get('project_id') || null,
              description: fd.get('description') || null,
              pipeline: newPipeline,
              admin_id: fd.get('admin_id') || null,
              admin_password: adminPwInput.value || null,
            };
            if (existing) await appState.updateProgram(existing.id, data);
            else await appState.addProgram(data);
            toast('저장했습니다.', 'success');
            close();
          });
          body.append(form);
        },
      });
    }

    // ================= 즐겨찾기 URL =================
    function bookmarksSection() {
      const rows = appState.bookmarks.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      if (!rows.length) {
        return el('div', { class: 'empty-state' }, '자주 방문하는 사이트를 즐겨찾기로 등록해보세요. 클릭하면 바로 이동합니다.');
      }
      const grid = el('div', { class: 'grid-3' });
      rows.forEach((b, idx) => {
        let hostname = '';
        try { hostname = new URL(b.url).hostname; } catch (e) { /* ignore */ }
        const favicon = hostname ? `https://www.google.com/s2/favicons?domain=${hostname}&sz=64` : null;
        grid.append(
          el('div', { class: 'nm-card bookmark-card', onclick: () => appState.openBookmark(b.id) }, [
            el('div', { class: 'row', style: 'justify-content:center; margin-bottom:8px; position:relative; height:28px' }, [
              // 파비콘을 우선 시도하고, 못 불러오면(네트워크 차단 등) 뒤에 깔린 기본 별 아이콘이 그대로 보인다.
              el('span', { style: 'font-size:28px; position:absolute' }, b.icon || '⭐'),
              !b.icon && favicon
                ? el('img', { src: favicon, alt: '', style: 'width:28px; height:28px; position:relative; background:var(--surface)', onerror: 'this.remove()' })
                : null,
            ]),
            el('div', { style: 'font-weight:700; text-align:center; margin-bottom:2px' }, escapeHtml(b.title)),
            el('div', { class: 'text-muted', style: 'font-size:11px; text-align:center; word-break:break-all' }, hostname || b.url),
            b.category ? el('div', { style: 'text-align:center; margin-top:6px' }, [el('span', { class: 'nm-badge' }, escapeHtml(b.category))]) : null,
            el('div', { class: 'row', style: 'justify-content:center; gap:8px; margin-top:10px' }, [
              el('button', {
                class: 'nm-btn nm-btn--icon', title: '위로', disabled: idx === 0 || undefined,
                onclick: (e) => { e.stopPropagation(); moveBookmark(rows, idx, -1); },
              }, '↑'),
              el('button', {
                class: 'nm-btn nm-btn--icon', title: '아래로', disabled: idx === rows.length - 1 || undefined,
                onclick: (e) => { e.stopPropagation(); moveBookmark(rows, idx, 1); },
              }, '↓'),
              el('button', { class: 'nm-btn nm-btn--icon', title: '수정', onclick: (e) => { e.stopPropagation(); openBookmarkForm(b); } }, '✎'),
              el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: (e) => { e.stopPropagation(); removeBookmark(b); } }, '🗑'),
            ]),
          ])
        );
      });
      return grid;
    }

    async function moveBookmark(rows, idx, dir) {
      const next = rows.slice();
      const swapWith = idx + dir;
      if (swapWith < 0 || swapWith >= next.length) return;
      [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
      await appState.reorderBookmarks(next.map((b) => b.id));
    }

    async function removeBookmark(b) {
      if (!confirmDialog(`"${b.title}"을(를) 삭제할까요?`)) return;
      await appState.deleteBookmark(b.id);
      toast('삭제했습니다.', 'success');
    }

    function openBookmarkForm(existing) {
      openModal({
        title: existing ? '즐겨찾기 수정' : '즐겨찾기 등록',
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          form.append(
            field('제목', el('input', { class: 'nm-input', name: 'title', required: true, value: existing?.title || '' })),
            field('URL', el('input', { class: 'nm-input', type: 'url', name: 'url', required: true, placeholder: 'https://…', value: existing?.url || '' })),
            field('아이콘(이모지, 선택 — 비우면 자동으로 파비콘을 보여줍니다)', el('input', { class: 'nm-input', name: 'icon', maxlength: '2', value: existing?.icon || '' })),
            field('분류(선택)', el('input', { class: 'nm-input', name: 'category', placeholder: '예: 업무, 참고', value: existing?.category || '' }))
          );
          form.append(el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장'));
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const data = {
              title: fd.get('title'),
              url: fd.get('url'),
              icon: fd.get('icon') || null,
              category: fd.get('category') || null,
            };
            if (existing) await appState.updateBookmark(existing.id, data);
            else await appState.addBookmark(data);
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

  window.renderPrograms = renderPrograms;
})();
