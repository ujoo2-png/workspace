// 프로그램(나만의 프로그램 관리) + 즐겨찾기 URL(바로가기) 화면.
// 프로그램은 "개발툴 → 게시(GitHub) → 배포(Vercel) → 저장(Supabase)" 과정을 관리하며,
// 목록은 한눈에 많이 볼 수 있도록 컴팩트한 리스트(테이블) 형태로 보여준다. 상세 파이프라인과
// 관리자 계정은 "상세" 버튼을 눌러 모달에서 확인한다.
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
    let selectedPrograms = new Set();
    let selectedBookmarks = new Set();
    let programQuery = '';
    let bookmarkQuery = '';
    let programSort = { key: 'run_count', dir: 'desc' };
    let bookmarkSort = { key: 'sort_order', dir: 'asc' };

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

    // 5.1 공통 list UI 헬퍼 — 검색창 입력 중 전체 재렌더로 포커스/커서를 잃는 문제(Knowledge/일정
    // 화면에서 고쳤던 것과 동일한 버그)를 막기 위해 다시 그려진 입력창에 포커스/커서를 복원한다.
    function restoreFocus(selector, pos) {
      const next = container.querySelector(selector);
      if (next) {
        next.focus();
        try { next.setSelectionRange(pos, pos); } catch (e) { /* 일부 input type은 미지원 — 무시 */ }
      }
    }

    // 정렬 가능한 컬럼 헤더 — schedule.js와 동일한 패턴(활성 컬럼에 ▲/▼ 표시).
    function sortableTh(label, key, sortState, onClick) {
      const active = sortState.key === key;
      return el('th', { class: active ? 'is-sorted' : '', onclick: () => onClick(key) }, [
        label, active ? el('span', { class: 'sort-arrow' }, sortState.dir === 'asc' ? '▲' : '▼') : null,
      ]);
    }
    function toggleTableSort(sortState, key) {
      if (sortState.key === key) return { key, dir: sortState.dir === 'asc' ? 'desc' : 'asc' };
      return { key, dir: 'asc' };
    }
    function sortTableRows(rows, sortState, accessors) {
      const get = accessors[sortState.key];
      if (!get) return rows;
      return rows.slice().sort((a, b) => {
        const av = get(a);
        const bv = get(b);
        let cmp;
        if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
        else cmp = String(av).localeCompare(String(bv));
        return sortState.dir === 'asc' ? cmp : -cmp;
      });
    }

    // ================= 프로그램(리스트 뷰) =================
    function programsSection() {
      let rows = appState.programs.slice();
      if (programQuery.trim()) {
        const q = programQuery.trim().toLowerCase();
        rows = rows.filter((p) => (p.name || '').toLowerCase().includes(q) || (p.url || '').toLowerCase().includes(q));
      }
      rows = sortTableRows(rows, programSort, {
        name: (r) => (r.name || '').toLowerCase(),
        url: (r) => (r.url || '').toLowerCase(),
        devTool: (r) => (r.pipeline?.dev?.tool || '').toLowerCase(),
        progress: (r) => Object.values(r.pipeline || {}).filter((d) => d && (d.id || d.date)).length,
        run_count: (r) => r.run_count || 0,
      });
      if (!appState.programs.length) {
        return el('div', { class: 'empty-state' }, '직접 만든 웹앱/모바일앱/위젯을 등록하고 개발~배포 과정을 관리해보세요.');
      }
      // 더 이상 존재하지 않는 항목이 선택 상태에 남지 않도록 정리
      selectedPrograms = new Set([...selectedPrograms].filter((id) => rows.some((r) => r.id === id)));

      const wrap = el('div', {});
      wrap.append(
        el('div', { class: 'filter-bar', style: 'margin-bottom:8px' }, [
          el('input', {
            class: 'nm-input program-search-input', style: 'max-width:240px', placeholder: '검색(이름/URL)', value: programQuery,
            oninput: (e) => { const pos = e.target.selectionStart; programQuery = e.target.value; draw(); restoreFocus('.program-search-input', pos); },
          }),
        ])
      );
      wrap.append(bulkBar(rows, selectedPrograms, async (ids) => {
        await appState.deleteProgramsBulk(ids);
        toast(`${ids.length}건 삭제했습니다.`, 'success');
      }));

      if (!rows.length) {
        wrap.append(el('div', { class: 'empty-state' }, '검색 결과가 없습니다.'));
        return wrap;
      }

      const tableWrap = el('div', { class: 'data-table-wrap' });
      const table = el('table', { class: 'data-table' });
      table.append(
        el('colgroup', {}, [
          el('col', { style: 'width:34px' }),
          el('col', { style: 'width:40px' }),
          el('col', { style: 'width:22%' }),
          el('col', { style: 'width:22%' }),
          el('col', { style: 'width:10%' }),
          el('col', { style: 'width:170px' }),
          el('col', { style: 'width:230px' }),
        ])
      );
      table.append(
        el('thead', {}, [
          el('tr', {}, [
            el('th', {}, [selectAllCheckbox(rows, selectedPrograms)]),
            el('th', {}, 'No'),
            sortableTh('이름', 'name', programSort, (k) => { programSort = toggleTableSort(programSort, k); draw(); }),
            sortableTh('URL', 'url', programSort, (k) => { programSort = toggleTableSort(programSort, k); draw(); }),
            sortableTh('개발툴', 'devTool', programSort, (k) => { programSort = toggleTableSort(programSort, k); draw(); }),
            sortableTh('진행현황', 'progress', programSort, (k) => { programSort = toggleTableSort(programSort, k); draw(); }),
            el('th', {}, '작업'),
          ]),
        ])
      );
      const tbody = el('tbody', {});
      rows.forEach((p, idx) => {
        const pipeline = p.pipeline || {};
        const devTool = pipeline.dev?.tool || '-';
        const project = p.project_id ? appState.projects.find((pr) => pr.id === p.project_id) : null;
        tbody.append(
          el('tr', {}, [
            el('td', {}, [rowCheckbox(selectedPrograms, p.id, draw)]),
            el('td', {}, String(idx + 1)),
            el('td', {}, [
              el('div', { style: 'font-weight:700; display:flex; align-items:center; gap:6px' }, [
                el('span', {}, p.icon || '🔗'),
                escapeHtml(p.name),
                el('span', { class: 'nm-badge' }, TYPE_LABEL[p.program_type] || p.program_type || '웹앱'),
              ]),
              project ? el('div', { class: 'text-muted', style: 'font-size:11px; margin-top:2px' }, `📁 ${escapeHtml(project.name)}`) : null,
            ]),
            el('td', { style: 'max-width:220px; overflow:hidden; text-overflow:ellipsis' }, [
              el('a', { href: p.url, target: '_blank', rel: 'noopener', class: 'text-muted', style: 'font-size:12px; word-break:break-all' }, p.url),
            ]),
            el('td', {}, escapeHtml(devTool)),
            el('td', {}, pipelineBadges(pipeline)),
            el('td', {}, [
              el('div', { class: 'icon-row' }, [
                el('span', { class: 'text-muted', style: 'font-size:11px' }, `실행 ${p.run_count || 0}회`),
                el('button', { class: 'nm-btn nm-btn--icon', title: '열기', onclick: () => appState.runProgram(p.id) }, '🔗'),
                el('button', { class: 'nm-btn nm-btn--icon', title: '상세', onclick: () => openDetailModal(p) }, '🔍'),
                el('button', { class: 'nm-btn nm-btn--icon', title: '수정', onclick: () => openProgramForm(p) }, '✎'),
                el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: () => removeProgram(p) }, '🗑'),
              ]),
            ]),
          ])
        );
      });
      table.append(tbody);
      tableWrap.append(table);
      wrap.append(tableWrap);
      return wrap;
    }

    // 파이프라인 4단계를 채워졌는지 여부로 작은 배지 묶음으로 보여준다(상세 버튼에서 전체 확인).
    function pipelineBadges(pipeline) {
      return el('div', { class: 'row', style: 'gap:3px' }, PIPELINE_STAGES.map((stage) => {
        const data = pipeline[stage.key] || {};
        const filled = !!(data.id || data.date);
        return el('span', {
          title: `${stage.label}: ${filled ? '입력됨' : '미입력'}`,
          class: `nm-badge ${filled ? 'nm-badge--success' : ''}`,
          style: 'padding:2px 5px; font-size:11px',
        }, stage.icon);
      }));
    }

    // "상세" — 전체 파이프라인 + 관리자 계정 + 첨부파일을 모달로 보여준다(테이블을 넓히지 않기 위함).
    function openDetailModal(p) {
      openModal({
        title: `${p.icon || '🔗'} ${p.name} — 상세`,
        contentBuilder(body) {
          const pipeline = p.pipeline || {};
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
          body.append(el('div', { class: 'program-flow-wrap' }, [flow]));

          if (p.description) body.append(el('p', { class: 'text-muted', style: 'margin-top:10px' }, escapeHtml(p.description)));

          if (p.admin_id || p.admin_password) {
            const revealed = revealedPasswords.has(p.id);
            const box = el('div', { class: 'program-admin-box' }, [
              el('span', { class: 'text-muted', style: 'font-size:12px' }, '관리자 계정'),
              el('span', { style: 'font-size:13px; font-weight:600' }, p.admin_id || '-'),
              p.admin_password
                ? el('span', { class: 'row', style: 'gap:4px; align-items:center' }, [
                    el('span', { style: 'font-size:13px; font-family:monospace' }, revealed ? p.admin_password : '•'.repeat(Math.min(10, p.admin_password.length || 8))),
                    el('button', {
                      class: 'nm-btn nm-btn--icon', title: revealed ? '숨기기' : '보기',
                      onclick: () => { revealed ? revealedPasswords.delete(p.id) : revealedPasswords.add(p.id); openDetailModal(p); },
                    }, revealed ? '🙈' : '👁️'),
                  ])
                : null,
            ]);
            body.append(box);
          }

          const attachBox = el('div', { style: 'margin-top:12px' });
          body.append(el('h3', { style: 'margin:12px 0 6px; font-size:14px' }, '첨부파일'), attachBox);
          window.renderAttachmentsPanel(attachBox, 'programs', p.id);
        },
      });
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

    // ================= 즐겨찾기 URL(리스트 뷰) =================
    function bookmarksSection() {
      let rows = appState.bookmarks.slice();
      if (bookmarkQuery.trim()) {
        const q = bookmarkQuery.trim().toLowerCase();
        rows = rows.filter((b) => (b.title || '').toLowerCase().includes(q) || (b.url || '').toLowerCase().includes(q));
      }
      rows = sortTableRows(rows, bookmarkSort, {
        title: (r) => (r.title || '').toLowerCase(),
        url: (r) => (r.url || '').toLowerCase(),
        category: (r) => (r.category || '').toLowerCase(),
        sort_order: (r) => r.sort_order || 0,
      });
      const customOrder = bookmarkSort.key === 'sort_order' && bookmarkSort.dir === 'asc';
      if (!appState.bookmarks.length) {
        return el('div', { class: 'empty-state' }, '자주 방문하는 사이트를 즐겨찾기로 등록해보세요. 클릭하면 바로 이동합니다.');
      }
      selectedBookmarks = new Set([...selectedBookmarks].filter((id) => rows.some((r) => r.id === id)));

      const wrap = el('div', {});
      wrap.append(
        el('div', { class: 'filter-bar', style: 'margin-bottom:8px' }, [
          el('input', {
            class: 'nm-input bookmark-search-input', style: 'max-width:240px', placeholder: '검색(제목/URL)', value: bookmarkQuery,
            oninput: (e) => { const pos = e.target.selectionStart; bookmarkQuery = e.target.value; draw(); restoreFocus('.bookmark-search-input', pos); },
          }),
        ])
      );
      wrap.append(bulkBar(rows, selectedBookmarks, async (ids) => {
        await appState.deleteBookmarksBulk(ids);
        toast(`${ids.length}건 삭제했습니다.`, 'success');
      }));
      if (!customOrder) {
        wrap.append(el('p', { class: 'text-muted', style: 'font-size:11px; margin:-4px 0 8px' }, '※ 검색/정렬 중에는 ↑/↓ 순서 변경 버튼이 비활성화됩니다. "작업" 컬럼 정렬을 기본으로 되돌리면 다시 쓸 수 있습니다.'));
      }

      if (!rows.length) {
        wrap.append(el('div', { class: 'empty-state' }, '검색 결과가 없습니다.'));
        return wrap;
      }

      const tableWrap = el('div', { class: 'data-table-wrap' });
      const table = el('table', { class: 'data-table' });
      table.append(
        el('colgroup', {}, [
          el('col', { style: 'width:34px' }),
          el('col', { style: 'width:40px' }),
          el('col', { style: 'width:28%' }),
          el('col', { style: 'width:32%' }),
          el('col', { style: 'width:14%' }),
          el('col', { style: 'width:170px' }),
        ])
      );
      table.append(
        el('thead', {}, [
          el('tr', {}, [
            el('th', {}, [selectAllCheckbox(rows, selectedBookmarks)]),
            el('th', {}, 'No'),
            sortableTh('제목', 'title', bookmarkSort, (k) => { bookmarkSort = toggleTableSort(bookmarkSort, k); draw(); }),
            sortableTh('URL', 'url', bookmarkSort, (k) => { bookmarkSort = toggleTableSort(bookmarkSort, k); draw(); }),
            sortableTh('분류', 'category', bookmarkSort, (k) => { bookmarkSort = toggleTableSort(bookmarkSort, k); draw(); }),
            el('th', { style: 'width:170px' }, '작업'),
          ]),
        ])
      );
      const tbody = el('tbody', {});
      rows.forEach((b, idx) => {
        let hostname = '';
        try { hostname = new URL(b.url).hostname; } catch (e) { /* ignore */ }
        tbody.append(
          el('tr', {}, [
            el('td', {}, [rowCheckbox(selectedBookmarks, b.id, draw)]),
            el('td', {}, String(idx + 1)),
            el('td', { style: 'cursor:pointer', onclick: () => appState.openBookmark(b.id) }, [
              el('span', { style: 'margin-right:6px' }, b.icon || '⭐'),
              el('strong', {}, escapeHtml(b.title)),
            ]),
            el('td', { style: 'max-width:220px; overflow:hidden; text-overflow:ellipsis' }, [
              el('span', { class: 'text-muted', style: 'font-size:12px; word-break:break-all' }, hostname || b.url),
            ]),
            el('td', {}, b.category ? el('span', { class: 'nm-badge' }, escapeHtml(b.category)) : '-'),
            el('td', {}, [
              el('div', { class: 'icon-row' }, [
                el('button', { class: 'nm-btn nm-btn--icon', title: '위로', disabled: !customOrder || idx === 0 || undefined, onclick: () => moveBookmark(rows, idx, -1) }, '↑'),
                el('button', { class: 'nm-btn nm-btn--icon', title: '아래로', disabled: !customOrder || idx === rows.length - 1 || undefined, onclick: () => moveBookmark(rows, idx, 1) }, '↓'),
                el('button', { class: 'nm-btn nm-btn--icon', title: '수정', onclick: () => openBookmarkForm(b) }, '✎'),
                el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: () => removeBookmark(b) }, '🗑'),
              ]),
            ]),
          ])
        );
      });
      table.append(tbody);
      tableWrap.append(table);
      wrap.append(tableWrap);
      return wrap;
    }

    // 전체선택 체크박스 + 선택삭제 버튼 바. 선택된 게 없으면 버튼은 비활성화된다.
    function bulkBar(rows, selectedSet, onBulkDelete) {
      const count = selectedSet.size;
      return el('div', { class: 'row row--between', style: 'margin-bottom:8px; align-items:center' }, [
        el('label', { class: 'row', style: 'gap:6px; align-items:center; cursor:pointer; font-size:13px' }, [
          el('input', {
            type: 'checkbox',
            checked: rows.length > 0 && count === rows.length ? true : undefined,
            onchange: (e) => {
              if (e.target.checked) rows.forEach((r) => selectedSet.add(r.id));
              else selectedSet.clear();
              draw();
            },
          }),
          el('span', { class: 'text-muted' }, '전체선택'),
        ]),
        el('button', {
          class: 'nm-btn nm-btn--danger',
          disabled: count === 0 || undefined,
          onclick: async () => {
            if (!confirmDialog(`선택한 ${count}건을 삭제할까요?`)) return;
            const ids = [...selectedSet];
            selectedSet.clear();
            await onBulkDelete(ids);
          },
        }, `선택 삭제${count ? ` (${count})` : ''}`),
      ]);
    }

    function selectAllCheckbox(rows, selectedSet) {
      const allSelected = rows.length > 0 && selectedSet.size === rows.length;
      return el('input', {
        type: 'checkbox',
        title: '전체선택',
        checked: allSelected || undefined,
        onchange: (e) => {
          if (e.target.checked) rows.forEach((r) => selectedSet.add(r.id));
          else selectedSet.clear();
          draw();
        },
      });
    }

    function rowCheckbox(selectedSet, id, onChange) {
      return el('input', {
        type: 'checkbox',
        checked: selectedSet.has(id) || undefined,
        onchange: (e) => {
          if (e.target.checked) selectedSet.add(id);
          else selectedSet.delete(id);
          onChange();
        },
      });
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
