// 일정 관리 화면. QMS 문의현황류 화면을 참고해 테이블 UI로 구성했다.
// No, 플래그(중요 표시), 우선순위, D-day, 컬럼 정렬, 검색+퀵필터, 완료 숨기기 토글을 지원한다.
// 일반 <script>로 로드된다.
(function () {
  const { appState, el, escapeHtml, toast, confirmDialog, openModal, formatKoreanDate, todayISO, diffDays } = window;

  const PRIORITY_LABEL = { high: '높음', medium: '보통', low: '낮음' };
  const HIDE_DONE_KEY = 'workspace:schedule:hideDone';

  function renderSchedule(root) {
    const container = el('div', {});
    root.append(container);
    let quickTab = 'all'; // all | today | week | overdue | done
    let tagFilter = 'all';
    let query = '';
    let hideDone = localStorage.getItem(HIDE_DONE_KEY) !== '0'; // 기본값: 숨김
    let sortKey = 'date';
    let sortDir = 'asc';

    function draw() {
      container.innerHTML = '';
      container.append(
        el('div', { class: 'page-header' }, [
          el('h1', {}, '일정'),
          el('div', { class: 'row', style: 'gap:8px' }, [
            window.getPublicDataEnabled().holidays
              ? el('button', { class: 'nm-btn', onclick: () => importHolidays() }, '📅 공휴일 가져오기')
              : null,
            el('button', { class: 'nm-btn nm-btn--primary', onclick: () => openScheduleForm() }, '+ 일정 등록'),
          ]),
        ])
      );

      const today = todayISO();
      const weekEnd = window.addDays(today, 6);
      const base = appState.schedules;
      const counts = {
        all: base.length,
        today: base.filter((s) => s.date === today && !s.done).length,
        week: base.filter((s) => s.date >= today && s.date <= weekEnd && !s.done).length,
        overdue: base.filter((s) => !s.done && s.date < today).length,
        done: base.filter((s) => s.done).length,
      };

      container.append(
        el('div', { class: 'quick-tabs' }, [
          quickTabBtn('all', '전체', counts.all),
          quickTabBtn('today', '오늘', counts.today),
          quickTabBtn('week', '이번 주', counts.week),
          quickTabBtn('overdue', '기한 초과', counts.overdue),
          quickTabBtn('done', '완료', counts.done),
        ])
      );

      const allTags = Array.from(new Set(base.flatMap((s) => s.tags || []))).sort();
      container.append(
        el('div', { class: 'filter-bar' }, [
          el('input', {
            class: 'nm-input',
            style: 'max-width:220px',
            placeholder: '검색(제목/메모)',
            value: query,
            oninput: (e) => { query = e.target.value; draw(); },
          }),
          allTags.length
            ? el(
                'select',
                { class: 'nm-select', style: 'width:140px', onchange: (e) => { tagFilter = e.target.value; draw(); } },
                [el('option', { value: 'all' }, '태그 전체'), ...allTags.map((t) => el('option', { value: t, selected: t === tagFilter || undefined }, `#${t}`))]
              )
            : null,
          el('button', { class: 'nm-btn', onclick: () => { query = ''; tagFilter = 'all'; quickTab = 'all'; draw(); } }, '초기화'),
          el('div', { class: 'row', style: 'margin-left:auto; gap:8px' }, [
            el('span', { class: 'text-muted' }, '완료 일정 숨기기'),
            el('button', {
              class: `nm-toggle ${hideDone ? 'nm-toggle--on' : ''}`,
              onclick: () => { hideDone = !hideDone; localStorage.setItem(HIDE_DONE_KEY, hideDone ? '1' : '0'); draw(); },
            }),
          ]),
        ])
      );

      let rows = base.slice();
      if (quickTab === 'today') rows = rows.filter((s) => s.date === today);
      else if (quickTab === 'week') rows = rows.filter((s) => s.date >= today && s.date <= weekEnd);
      else if (quickTab === 'overdue') rows = rows.filter((s) => !s.done && s.date < today);
      else if (quickTab === 'done') rows = rows.filter((s) => s.done);
      else if (hideDone) rows = rows.filter((s) => !s.done);

      if (tagFilter !== 'all') rows = rows.filter((s) => (s.tags || []).includes(tagFilter));
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        rows = rows.filter((s) => (s.title || '').toLowerCase().includes(q) || (s.memo || '').toLowerCase().includes(q));
      }

      rows = sortRows(rows, sortKey, sortDir, today);

      if (!rows.length) {
        container.append(el('div', { class: 'empty-state' }, '표시할 일정이 없습니다.'));
        return;
      }

      const wrap = el('div', { class: 'data-table-wrap' });
      const table = el('table', { class: 'data-table' });
      table.append(
        el('thead', {}, [
          el('tr', {}, [
            el('th', { style: 'width:44px' }, 'No'),
            el('th', { style: 'width:36px' }, '깃발'),
            th('priority', '우선순위'),
            th('title', '제목'),
            th('date', '날짜'),
            th('dday', 'D-day'),
            el('th', {}, '프로젝트'),
            el('th', {}, '태그'),
            el('th', { style: 'width:110px' }, '완료/작업'),
          ]),
        ])
      );

      const tbody = el('tbody', {});
      rows.forEach((s, idx) => {
        const project = appState.projects.find((p) => p.id === s.project_id);
        const dDay = diffDays(today, s.date);
        tbody.append(
          el('tr', { class: s.done ? 'is-done' : '' }, [
            el('td', {}, String(idx + 1)),
            el('td', {}, [
              el('button', {
                class: `flag-btn ${s.flagged ? 'flag-btn--on' : 'flag-btn--off'}`,
                title: s.flagged ? '중요 해제' : '중요 표시',
                onclick: () => appState.updateSchedule(s.id, { flagged: !s.flagged }),
              }, '🚩'),
            ]),
            el('td', {}, [
              el('span', { class: `priority-dot priority-dot--${s.priority || 'medium'}` }),
              PRIORITY_LABEL[s.priority] || PRIORITY_LABEL.medium,
            ]),
            el('td', {}, [
              el('div', { style: 'font-weight:700' }, escapeHtml(s.title)),
              s.memo ? el('div', { class: 'text-muted', style: 'font-size:12px' }, escapeHtml(s.memo)) : null,
            ]),
            el('td', {}, `${formatKoreanDate(s.date)}${s.time ? ' ' + s.time : ''}`),
            el('td', {}, ddayChip(dDay, s.done)),
            el('td', {}, project ? escapeHtml(project.name) : '-'),
            el('td', {}, (s.tags || []).length ? el('div', { class: 'row wrap', style: 'gap:4px' }, s.tags.map((t) => el('span', { class: 'nm-badge' }, `#${t}`))) : '-'),
            el('td', {}, [
              el('div', { class: 'icon-row' }, [
                el('button', {
                  class: 'nm-btn nm-btn--icon',
                  title: s.done ? '완료 취소' : '완료 처리',
                  onclick: () => appState.updateSchedule(s.id, { done: !s.done }),
                }, s.done ? '↺' : '✓'),
                el('button', { class: 'nm-btn nm-btn--icon', title: '수정', onclick: () => openScheduleForm(s) }, '✎'),
                el('button', {
                  class: 'nm-btn nm-btn--icon',
                  title: '첨부파일',
                  onclick: () => window.openAttachmentsModal('schedules', s.id, s.title),
                }, '📎'),
                el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: () => remove(s) }, '🗑'),
              ]),
            ]),
          ])
        );
      });
      table.append(tbody);
      wrap.append(table);
      container.append(wrap);

      function th(key, label) {
        const active = sortKey === key;
        return el(
          'th',
          { class: active ? 'is-sorted' : '', onclick: () => { toggleSort(key); draw(); } },
          [label, active ? el('span', { class: 'sort-arrow' }, sortDir === 'asc' ? '▲' : '▼') : null]
        );
      }
    }

    function toggleSort(key) {
      if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortKey = key; sortDir = 'asc'; }
    }

    function ddayChip(dDay, done) {
      if (done) return el('span', { class: 'dday-chip dday-chip--normal' }, '완료');
      const label = dDay === 0 ? 'D-day' : dDay > 0 ? `D-${dDay}` : `D+${-dDay}`;
      const cls = dDay < 0 ? 'dday-chip--overdue' : dDay <= 3 ? 'dday-chip--soon' : 'dday-chip--normal';
      return el('span', { class: `dday-chip ${cls}` }, label);
    }

    function quickTabBtn(key, label, count) {
      const active = quickTab === key;
      return el(
        'button',
        { class: `quick-tab ${active ? 'quick-tab--active' : ''}`, onclick: () => { quickTab = key; draw(); } },
        [label, count ? el('span', { class: 'quick-tab__count' }, String(count)) : null]
      );
    }

    // 공공데이터포털 특일정보(공휴일) API로 올해·내년 공휴일을 가져와 일정에 등록한다.
    // 이미 등록된 날짜(#공휴일 태그 기준)는 건너뛴다.
    async function importHolidays() {
      if (!window.getPublicDataKey()) {
        toast('설정 화면에서 공공데이터포털 API 키를 먼저 등록해 주세요.', 'error');
        return;
      }
      try {
        const year = new Date().getFullYear();
        const [thisYear, nextYear] = await Promise.all([window.fetchHolidays(year), window.fetchHolidays(year + 1)]);
        const holidays = [...thisYear, ...nextYear].filter((h) => h.isHoliday);
        const existingDates = new Set(appState.schedules.filter((s) => (s.tags || []).includes('공휴일')).map((s) => s.date));
        let added = 0;
        for (const h of holidays) {
          if (existingDates.has(h.dateIso)) continue;
          await appState.addSchedule({ title: h.name, date: h.dateIso, priority: 'low', tags: ['공휴일'], memo: null });
          existingDates.add(h.dateIso);
          added++;
        }
        toast(added ? `공휴일 ${added}건을 일정에 추가했습니다.` : '이미 모든 공휴일이 등록되어 있습니다.', 'success');
      } catch (e) {
        toast('공휴일을 가져오지 못했습니다: ' + e.message, 'error');
      }
    }

    async function remove(s) {
      if (!confirmDialog(`"${s.title}" 일정을 삭제할까요?`)) return;
      await appState.deleteSchedule(s.id);
      toast('일정을 삭제했습니다.', 'success');
    }

    function openScheduleForm(existing) {
      openModal({
        title: existing ? '일정 수정' : '일정 등록',
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          form.append(
            field('제목', el('input', { class: 'nm-input', name: 'title', required: true, value: existing?.title || '' })),
            field('날짜', el('input', { class: 'nm-input', type: 'date', name: 'date', required: true, value: existing?.date || todayISO() })),
            field('시간(선택)', el('input', { class: 'nm-input', type: 'time', name: 'time', value: existing?.time || '' })),
            field('우선순위', prioritySelect(existing?.priority)),
            field('중요 표시(플래그)', flagCheckbox(existing?.flagged)),
            field('연결 프로젝트(선택)', projectSelect(existing?.project_id)),
            field('태그(쉼표로 구분, 선택)', el('input', { class: 'nm-input', name: 'tags', value: (existing?.tags || []).join(', ') })),
            field('메모', el('textarea', { class: 'nm-textarea', name: 'memo' }, existing?.memo || '')),
            existing ? null : repeatField()
          );
          form.append(el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장'));
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const tags = String(fd.get('tags') || '').split(',').map((t) => t.trim()).filter(Boolean);
            const data = {
              title: fd.get('title'),
              date: fd.get('date'),
              time: fd.get('time') || null,
              priority: fd.get('priority') || 'medium',
              flagged: fd.get('flagged') === 'on',
              project_id: fd.get('project_id') || null,
              tags,
              memo: fd.get('memo') || null,
            };
            if (existing) {
              await appState.updateSchedule(existing.id, data);
            } else {
              // 벤치마크: Google Calendar류의 간단 반복 등록 — 반복 규칙 테이블 없이,
              // 등록 시점에 개별 일정 여러 건으로 즉시 생성한다(각 건은 독립적으로 완료/수정 가능).
              const repeat = fd.get('repeat') || 'none';
              const count = Math.min(52, Math.max(1, Number(fd.get('repeat_count')) || 1));
              const stepDays = repeat === 'daily' ? 1 : repeat === 'weekly' ? 7 : repeat === 'monthly' ? 30 : 0;
              if (repeat === 'none' || stepDays === 0) {
                await appState.addSchedule(data);
              } else {
                for (let i = 0; i < count; i++) {
                  await appState.addSchedule({ ...data, date: window.addDays(data.date, stepDays * i) });
                }
              }
            }
            toast('일정을 저장했습니다.', 'success');
            close();
          });
          body.append(form);
        },
      });
    }

    function flagCheckbox(checked) {
      return el('label', { class: 'row', style: 'gap:8px; cursor:pointer' }, [
        el('input', { type: 'checkbox', name: 'flagged', checked: checked || undefined }),
        el('span', { class: 'text-muted' }, '중요 일정으로 표시(🚩)'),
      ]);
    }

    function prioritySelect(selected = 'medium') {
      const select = el('select', { class: 'nm-select', name: 'priority' });
      for (const [value, label] of Object.entries(PRIORITY_LABEL)) select.append(el('option', { value, selected: value === selected || undefined }, label));
      return select;
    }

    function repeatField() {
      const repeatSelect = el('select', { class: 'nm-select', name: 'repeat' }, [
        el('option', { value: 'none' }, '반복 안 함'),
        el('option', { value: 'daily' }, '매일'),
        el('option', { value: 'weekly' }, '매주'),
        el('option', { value: 'monthly' }, '매월(30일 간격)'),
      ]);
      const countInput = el('input', { class: 'nm-input', type: 'number', name: 'repeat_count', min: '1', max: '52', value: '1', style: 'width:80px' });
      return el('div', { class: 'nm-field' }, [
        el('label', {}, '반복(선택)'),
        el('div', { class: 'row', style: 'gap:8px; align-items:center' }, [repeatSelect, el('span', { class: 'text-muted', style: 'font-size:12px' }, '× 횟수'), countInput]),
      ]);
    }

    function projectSelect(selectedId) {
      const select = el('select', { class: 'nm-select', name: 'project_id' }, [el('option', { value: '' }, '연결 안 함')]);
      for (const p of appState.projects.filter((p) => p.status !== 'done')) {
        select.append(el('option', { value: p.id, selected: p.id === selectedId || undefined }, p.name));
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

  const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
  function sortRows(rows, key, dir, today) {
    const sorted = rows.slice().sort((a, b) => {
      let cmp = 0;
      if (key === 'date') cmp = (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''));
      else if (key === 'priority') cmp = (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1);
      else if (key === 'dday') cmp = diffDays(today, a.date) - diffDays(today, b.date);
      else if (key === 'title') cmp = (a.title || '').localeCompare(b.title || '');
      return dir === 'asc' ? cmp : -cmp;
    });
    // 플래그(중요) 표시된 일정은 정렬 결과 안에서도 항상 위로 끌어올린다.
    return sorted.slice().sort((a, b) => (b.flagged ? 1 : 0) - (a.flagged ? 1 : 0));
  }

  window.renderSchedule = renderSchedule;
})();
