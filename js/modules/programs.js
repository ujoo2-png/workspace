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

  // ---- 관리자 비밀번호 암호화(잠금 암호) 공통 헬퍼 ----
  // 잠금 암호(passphrase)는 절대 저장/전송하지 않는다 — 이 변수는 "같은 세션 동안 매번
  // 다시 입력하지 않게" 메모리에만 잠시 두는 편의용 캐시이며, 새로고침하면 사라진다.
  let cachedPassphrase = null;

  // 잠금 암호 입력 모달. X/ESC/바깥 클릭으로 닫으면 null(취소)로 resolve한다.
  function askPassphrase(message) {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (value) => { if (!settled) { settled = true; resolve(value); } };
      openModal({
        title: '🔒 잠금 암호 입력',
        contentBuilder(body, closeModal) {
          const form = el('form', { class: 'stack' });
          const input = el('input', { class: 'nm-input', type: 'password', name: 'passphrase', autofocus: true });
          form.append(
            el('p', { class: 'text-muted', style: 'font-size:12px' }, message),
            el('div', { class: 'nm-field' }, [el('label', {}, '잠금 암호'), input])
          );
          form.append(el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '확인'));
          form.addEventListener('submit', (e) => {
            e.preventDefault();
            settle(input.value || null);
            closeModal();
          });
          body.append(form);
          setTimeout(() => input.focus(), 0);
          const backdrop = body.closest('.nm-modal-backdrop');
          const observer = new MutationObserver(() => {
            if (backdrop && !document.body.contains(backdrop)) {
              observer.disconnect();
              settle(null);
            }
          });
          observer.observe(document.body, { childList: true });
        },
      });
    });
  }

  // 캐시된 암호가 있으면 다시 묻지 않고 재사용한다("세션당 한 번"). forceAsk=true면 캐시를
  // 무시하고 항상 새로 묻는다(캐시된 암호가 틀린 것으로 판명된 경우 등).
  async function getPassphrase(message, { forceAsk = false } = {}) {
    if (!forceAsk && cachedPassphrase) return cachedPassphrase;
    const pass = await askPassphrase(message);
    if (pass) cachedPassphrase = pass;
    return pass;
  }

  function renderPrograms(root) {
    const container = el('div', {});
    root.append(container);
    let tab = 'programs'; // 'programs' | 'bookmarks'
    const revealedValues = new Map(); // program.id -> 복호화(또는 과거 평문) 된 값
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

    // ---- 상태 점(best-effort, 참고용) ----
    // 브라우저는 다른 사이트의 응답 상태코드를 CORS 때문에 읽을 수 없다. 그래서 `mode:'no-cors'` GET이
    // "응답이 돌아왔는지(네트워크 도달 여부)"만 확인하며, 404/500이어도 초록으로 보일 수 있다. 라벨에 그렇게 적는다.
    // 자동으로 요청을 보내지 않고 사용자가 "상태 확인"을 눌렀을 때만 보낸다(개인 URL을 몰래 호출하지 않기 위함).
    const pingResults = window.__programPing || (window.__programPing = new Map()); // id -> {state, at, ms}
    async function pingOne(p) {
      pingResults.set(p.id, { state: 'checking', at: Date.now() });
      let state = 'unknown'; let ms = null;
      try {
        if (location.protocol === 'https:' && /^http:\/\//i.test(p.url)) throw Object.assign(new Error('mixed'), { mixed: true });
        const t0 = performance.now();
        await fetch(p.url, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(6000) });
        ms = Math.round(performance.now() - t0);
        state = 'up';
      } catch (e) {
        state = e && e.mixed ? 'unknown' : 'down';
      }
      pingResults.set(p.id, { state, at: Date.now(), ms });
    }
    async function pingAll(rows) {
      await Promise.all(rows.map(pingOne).map((pr) => pr.then(() => draw())));
      draw();
    }
    function healthDot(p) {
      const r = pingResults.get(p.id);
      const state = r ? r.state : 'none';
      const label = { none: '아직 확인 안 함(🩺 상태 확인)', checking: '확인 중…', up: `응답함${r && r.ms != null ? ` (${r.ms}ms)` : ''} — 상태코드는 확인할 수 없는 참고용`, down: '응답 없음(주소 오류·서버 중지·CORS/네트워크 차단일 수 있음)', unknown: 'https 페이지에서 http 주소는 확인할 수 없습니다' }[state];
      return el('span', { class: `health-dot health-dot--${state === 'up' ? 'up' : state === 'down' ? 'down' : state === 'unknown' ? 'unknown' : 'none'}`, role: 'img', 'aria-label': label, title: label, 'data-ping': state });
    }
    function deployBadge(p) {
      const b = window.deployedBadge(p.pipeline, todayISO());
      if (!b) return null;
      return el('div', { style: 'margin-top:2px' }, [el('span', { class: `nm-badge ${b.stale ? 'nm-badge--warning' : 'nm-badge--success'}`, style: 'font-size:11px; padding:1px 8px', title: `마지막 배포일: ${window.lastDeployedDate(p.pipeline)}` }, `🚀 ${b.text}`)]);
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
          el('button', {
            class: 'nm-btn', id: 'program-ping-all',
            title: '각 프로그램 URL이 응답하는지 확인합니다(브라우저 제약상 상태코드는 볼 수 없는 "응답 여부"만 확인 — 참고용)',
            onclick: () => pingAll(rows),
          }, '🩺 상태 확인'),
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
                el('span', { class: 'program-icon', 'data-program-icon': p.id }, window.programIcon(p)),
                escapeHtml(p.name),
                el('span', { class: 'nm-badge' }, TYPE_LABEL[p.program_type] || p.program_type || '웹앱'),
              ]),
              deployBadge(p),
              project ? el('div', { class: 'text-muted', style: 'font-size:11px; margin-top:2px' }, `📁 ${escapeHtml(project.name)}`) : null,
            ]),
            el('td', { style: 'max-width:220px; overflow:hidden; text-overflow:ellipsis' }, [
              healthDot(p),
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
    function openDetailModal(p, closePrev) {
      if (closePrev) closePrev();
      const closeThis = openModal({
        title: `${window.programIcon(p)} ${p.name} — 상세`,
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
            const encrypted = p.admin_password && window.secretCrypto.isEncryptedSecret(p.admin_password);
            const revealedValue = revealedValues.get(p.id);
            const revealed = revealedValue !== undefined;
            const box = el('div', { class: 'program-admin-box' }, [
              el('span', { class: 'text-muted', style: 'font-size:12px' }, '관리자 계정'),
              el('span', { style: 'font-size:13px; font-weight:600' }, p.admin_id || '-'),
              p.admin_password
                ? el('span', { class: 'row', style: 'gap:4px; align-items:center' }, [
                    el('span', { style: 'font-size:13px; font-family:monospace' },
                      revealed ? revealedValue : '•'.repeat(Math.min(10, p.admin_password.length || 8))),
                    el('button', {
                      class: 'nm-btn nm-btn--icon', title: revealed ? '숨기기' : '보기',
                      onclick: async () => {
                        if (revealed) { revealedValues.delete(p.id); openDetailModal(p, closeThis); return; }
                        if (!encrypted) {
                          // 암호화 이전에 저장된 과거 평문 값 — 잠금 암호 없이 그대로 보여준다.
                          revealedValues.set(p.id, p.admin_password);
                          openDetailModal(p, closeThis);
                          return;
                        }
                        let pass = await getPassphrase('이 비밀번호를 암호화할 때 사용한 잠금 암호를 입력하세요.');
                        if (!pass) return;
                        try {
                          const plain = await window.secretCrypto.decryptSecret(p.admin_password, pass);
                          revealedValues.set(p.id, plain);
                          openDetailModal(p, closeThis);
                        } catch (e) {
                          cachedPassphrase = null;
                          toast(e.message || '복호화에 실패했습니다.', 'error');
                        }
                      },
                    }, revealed ? '🙈' : '👁️'),
                  ])
                : null,
              p.admin_password && !encrypted
                ? el('span', { class: 'nm-badge nm-badge--warning', title: '암호화 이전(과거)에 저장된 값입니다. 한 번 다시 저장하면 암호화됩니다.' }, '⚠️ 평문(미암호화)')
                : null,
            ]);
            body.append(box);
          }

          const attachBox = el('div', { style: 'margin-top:12px' });
          body.append(el('h3', { style: 'margin:12px 0 6px; font-size:14px' }, '첨부파일'), attachBox);
          window.renderAttachmentsPanel(attachBox, 'programs', p.id);
        },
      });
      return closeThis;
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
          const form = el('form', { class: 'stack', novalidate: true });

          const typeSelect = el('select', { class: 'nm-select', name: 'program_type', required: true });
          for (const [value, label] of Object.entries(TYPE_LABEL)) typeSelect.append(el('option', { value }, label));
          typeSelect.value = existing?.program_type || 'web';

          const projectSelect = el('select', { class: 'nm-select', name: 'project_id' }, [
            el('option', { value: '' }, '연결 안 함'),
            ...appState.projects.map((pr) => el('option', { value: pr.id }, pr.name)),
          ]);
          projectSelect.value = existing?.project_id || '';

          // 원인(v7.21.0 수정): 예전 URL 칸은 type="url"+required라 "example.com/widget"처럼 스킴 없이 적으면
          // 브라우저 기본 검증이 막았고, 막혔다는 안내도 작은 말풍선뿐이었다. 또 저장 실패(DB 제약 등)는 예외가 삼켜져
          // 아무 반응이 없었다. 이제는 스킴이 없으면 https://를 붙여 주고, 오류는 칸 아래에 문장으로 보여 주며 포커스를 옮긴다.
          const nameInput = el('input', { class: 'nm-input', name: 'name', required: true, value: existing?.name || '', autocomplete: 'off' });
          const urlInput = el('input', { class: 'nm-input', type: 'text', inputmode: 'url', name: 'url', required: true, placeholder: 'https://…', value: existing?.url || '', autocomplete: 'off', spellcheck: 'false' });
          const nameErr = el('div', { class: 'field-error', role: 'alert', hidden: true });
          const urlErr = el('div', { class: 'field-error', role: 'alert', hidden: true });
          const URL_HINTS = {
            web: '웹앱이 열리는 주소. 예: https://my-app.vercel.app',
            mobile: '앱 소개/배포(스토어·TestFlight·APK 다운로드) 페이지 주소',
            widget: '위젯이 호스팅된 주소(배포 URL 또는 위젯을 보여주는 페이지). 예: https://my-widget.vercel.app',
            web_mobile: '웹 버전 주소. 예: https://my-app.vercel.app',
          };
          const urlHint = el('div', { class: 'nm-field__hint text-muted', id: 'program-url-hint' }, URL_HINTS[typeSelect.value]);
          const picker = window.createEmojiPicker({ value: existing?.icon || '', name: 'icon', getFallback: () => window.PROGRAM_TYPE_ICON[typeSelect.value] });
          typeSelect.addEventListener('change', () => { urlHint.textContent = URL_HINTS[typeSelect.value]; picker.refresh(); });
          function setErr(input, box, msg) {
            box.hidden = !msg; box.textContent = msg || '';
            if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
          }
          nameInput.addEventListener('input', () => setErr(nameInput, nameErr, ''));
          urlInput.addEventListener('input', () => setErr(urlInput, urlErr, ''));

          form.append(
            field('이름', nameInput), nameErr,
            field('유형', typeSelect),
            field('URL', urlInput), urlHint, urlErr,
            field('아이콘(이모지, 선택)', picker.node),
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
          // 보안 주의: 기존 저장 값(암호문 또는 과거 평문)은 이 입력창에 절대 채워 넣지 않는다 —
          // 비워두면 "변경 없음(기존 값 유지)"로 처리하고, 값을 입력해야만 새로 암호화해 저장한다.
          const hasExistingPw = !!existing?.admin_password;
          const adminPwInput = el('input', {
            class: 'nm-input', type: 'password', name: 'admin_password', autocomplete: 'new-password',
            placeholder: hasExistingPw ? '변경하려면 입력 (비워두면 기존 값 유지)' : '',
          });
          const togglePwBtn = el('button', {
            type: 'button', class: 'nm-btn nm-btn--icon',
            onclick: () => {
              const show = adminPwInput.type === 'password';
              adminPwInput.type = show ? 'text' : 'password';
              togglePwBtn.textContent = show ? '🙈' : '👁️';
            },
          }, '👁️');
          const clearPwCheckbox = hasExistingPw
            ? el('input', { type: 'checkbox', name: 'clear_admin_password' })
            : null;
          form.append(el('h3', { style: 'margin:10px 0 2px; font-size:14px' }, '관리자 계정(선택)'));
          form.append(
            el('div', { class: 'row wrap', style: 'gap:8px' }, [
              el('div', { style: 'flex:1; min-width:140px' }, [field('관리자 ID', el('input', { class: 'nm-input', name: 'admin_id', value: existing?.admin_id || '' }))]),
              el('div', { style: 'flex:1; min-width:140px' }, [field('비밀번호', el('div', { class: 'row', style: 'gap:6px' }, [adminPwInput, togglePwBtn]))]),
            ])
          );
          if (clearPwCheckbox) {
            form.append(
              el('label', { class: 'row', style: 'gap:6px; align-items:center; font-size:12px' }, [
                clearPwCheckbox, el('span', { class: 'text-muted' }, '저장된 비밀번호 삭제'),
              ])
            );
          }
          form.append(el('p', { class: 'text-muted', style: 'font-size:11px' },
            '🔒 입력하신 비밀번호는 저장 시 잠금 암호로 암호화되어 저장됩니다(AES-GCM). ' +
            '잠금 암호는 서버에 저장되지 않으며, 잊으면 저장된 값을 복구할 수 없습니다.'));

          const submitBtn = el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장');
          form.append(submitBtn);
          // 신규 등록 직후 바로 첨부할 수 있도록(기존엔 "상세" 모달에서만 가능했음), 저장되면
          // 폼 자리에 첨부 패널을 보여준다.
          const attachHost = el('div', {});
          body.append(form, attachHost);
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const check = window.validateProgramInput({ name: nameInput.value, url: urlInput.value, program_type: typeSelect.value });
            setErr(nameInput, nameErr, check.errors.name);
            setErr(urlInput, urlErr, check.errors.url);
            if (!check.ok) { (check.errors.name ? nameInput : urlInput).focus(); return; }
            urlInput.value = check.url; // 스킴을 붙여 준 값으로 보여 준다
            const fd = new FormData(form);
            const newPipeline = {};
            for (const stage of PIPELINE_STAGES) {
              const s = stageInputs[stage.key];
              const entry = { id: s.idInput.value || null, date: s.dateInput.value || null };
              if (s.toolInput) entry.tool = s.toolInput.value || null;
              if (entry.id || entry.date || entry.tool) newPipeline[stage.key] = entry;
            }

            // 비밀번호 처리: 비워두면 기존 값 유지, 체크박스로 삭제, 입력하면 새로 암호화.
            let adminPassword = existing?.admin_password ?? null;
            if (clearPwCheckbox && clearPwCheckbox.checked) {
              adminPassword = null;
            } else if (adminPwInput.value) {
              const pass = await getPassphrase('이 비밀번호를 암호화할 잠금 암호를 입력하세요(이 암호는 저장되지 않습니다).');
              if (!pass) {
                toast('잠금 암호를 입력하지 않아 저장이 취소되었습니다.', 'error');
                return;
              }
              try {
                adminPassword = await window.secretCrypto.encryptSecret(adminPwInput.value, pass);
              } catch (err) {
                toast('비밀번호 암호화에 실패했습니다: ' + (err.message || err), 'error');
                return;
              }
            }

            const data = {
              name: String(fd.get('name')).trim(),
              program_type: fd.get('program_type'),
              url: check.url,
              icon: window.normalizeEmoji(fd.get('icon'), 2) || null,
              project_id: fd.get('project_id') || null,
              description: fd.get('description') || null,
              pipeline: newPipeline,
              admin_id: fd.get('admin_id') || null,
              admin_password: adminPassword,
            };
            submitBtn.disabled = true;
            try {
              if (existing) {
                await appState.updateProgram(existing.id, data);
                toast('저장했습니다.', 'success');
                close();
              } else {
              const row = await appState.addProgram(data);
              toast('저장했습니다. 이제 파일을 첨부할 수 있어요.', 'success');
              Array.from(form.elements).forEach((elm) => { elm.disabled = true; });
              submitBtn.style.display = 'none';
              attachHost.append(
                el('h3', { style: 'margin:16px 0 8px' }, '첨부파일'),
                el('div', { id: 'new-program-attach-box' }),
                el('button', { class: 'nm-btn nm-btn--primary', style: 'width:100%; margin-top:12px', onclick: close }, '완료')
              );
              window.renderAttachmentsPanel(attachHost.querySelector('#new-program-attach-box'), 'programs', row.id);
              }
            } catch (err) {
              // 저장 실패를 삼키지 않는다 — DB 제약/네트워크 오류를 사용자가 읽을 수 있는 문장으로 보여 준다.
              const msg = String(err && err.message || err);
              if (/programs_url_check|check constraint|violates check/i.test(msg)) { setErr(urlInput, urlErr, 'URL은 http:// 또는 https://로 시작해야 합니다.'); urlInput.focus(); }
              toast(`저장하지 못했습니다: ${msg}`, 'error');
              submitBtn.disabled = false;
            }
          });
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
          const bmPicker = window.createEmojiPicker({ value: existing?.icon || '', name: 'icon', getFallback: () => '⭐' });
          form.append(
            field('제목', el('input', { class: 'nm-input', name: 'title', required: true, value: existing?.title || '' })),
            field('URL', el('input', { class: 'nm-input', type: 'url', name: 'url', required: true, placeholder: 'https://…', value: existing?.url || '' })),
            field('아이콘(이모지, 선택 — 비우면 ⭐ 기본 아이콘)', bmPicker.node),
            field('분류(선택)', el('input', { class: 'nm-input', name: 'category', placeholder: '예: 업무, 참고', value: existing?.category || '' }))
          );
          form.append(el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장'));
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const data = {
              title: fd.get('title'),
              url: fd.get('url'),
              icon: window.normalizeEmoji(fd.get('icon'), 2) || null,
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
