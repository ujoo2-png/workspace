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
    let calMonth = todayISO().slice(0, 7); // YYYY-MM
    // 공휴일은 "내 일정"이 아니라 달력의 참고 표시일 뿐이므로, appState.schedules와는 완전히
    // 분리된 로컬 상태로만 들고 있는다(schedules 테이블에는 전혀 쓰지 않는다).
    let holidayMap = {}; // dateIso -> 공휴일명
    let holidaysLoaded = false;

    function draw() {
      container.innerHTML = '';
      container.append(
        el('div', { class: 'page-header' }, [
          el('h1', {}, '일정'),
          el('div', { class: 'row', style: 'gap:8px' }, [
            window.getPublicDataEnabled().holidays
              ? el('button', { class: 'nm-btn', onclick: () => showHolidayList() }, '📅 공휴일 목록(참고용)')
              : null,
            el('button', { class: 'nm-btn nm-btn--primary', onclick: () => openScheduleForm() }, '+ 일정 등록'),
          ]),
        ])
      );

      // 목록과 달력을 함께 보여준다(달력은 등록된 일정 + 공휴일을 날짜에 바로 보여주는 참고용,
      // 아래 목록은 검색·필터·정렬이 가능한 상세 관리용).
      drawCalendar();
      container.append(el('h3', { style: 'margin:20px 0 10px' }, '📋 목록'));

      if (window.getPublicDataEnabled().holidays && !holidaysLoaded) loadHolidaysForCalendar();

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
            class: 'nm-input schedule-search-input',
            style: 'max-width:220px',
            placeholder: '검색(제목/메모)',
            value: query,
            oninput: (e) => {
              const pos = e.target.selectionStart;
              query = e.target.value;
              draw();
              // draw()가 화면 전체(검색창 포함)를 다시 그리면서 포커스/커서를 잃어버려
              // 한 글자만 입력된 것처럼 보이는 문제를 막기 위해, 새로 만들어진 입력창에
              // 포커스와 커서 위치를 복원한다.
              const next = container.querySelector('.schedule-search-input');
              if (next) {
                next.focus();
                try { next.setSelectionRange(pos, pos); } catch (e2) { /* 무시 */ }
              }
            },
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
            el('td', {}, [
              (s.tags || []).length ? el('div', { class: 'row wrap', style: 'gap:4px' }, s.tags.map((t) => el('span', { class: 'nm-badge' }, `#${t}`))) : '-',
              relatedKnowledgeLink(s.tags),
            ]),
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

    function shiftMonth(ym, delta) {
      const [y, m] = ym.split('-').map(Number);
      const d = new Date(y, m - 1 + delta, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }

    // 등록된 일정을 실제 날짜에 표시하는 월간 달력 보기. 날짜 칸의 빈 곳을 누르면 그 날짜로
    // 일정 등록 폼이 뜨고, 개별 일정 칩을 누르면 그 일정 수정 폼이 뜬다.
    function drawCalendar() {
      const today = todayISO();
      container.append(
        el('div', { class: 'row row--between', style: 'margin-bottom:10px' }, [
          el('button', { class: 'nm-btn nm-btn--icon', onclick: () => { calMonth = shiftMonth(calMonth, -1); draw(); } }, '◀'),
          el('strong', { style: 'font-size:15px' }, `${calMonth.slice(0, 4)}년 ${Number(calMonth.slice(5, 7))}월`),
          el('div', { class: 'row', style: 'gap:6px' }, [
            el('button', { class: 'nm-btn', onclick: () => { calMonth = today.slice(0, 7); draw(); } }, '오늘'),
            el('button', { class: 'nm-btn nm-btn--icon', onclick: () => { calMonth = shiftMonth(calMonth, 1); draw(); } }, '▶'),
          ]),
        ])
      );

      const grid = el('div', { class: 'calendar-grid' });
      ['일', '월', '화', '수', '목', '금', '토'].forEach((d) => grid.append(el('div', { class: 'calendar-weekday' }, d)));

      const firstIso = `${calMonth}-01`;
      const firstWeekday = new Date(`${firstIso}T00:00:00`).getDay();
      let cursor = window.addDays(firstIso, -firstWeekday);
      const byDate = {};
      for (const s of appState.schedules) {
        if (!byDate[s.date]) byDate[s.date] = [];
        byDate[s.date].push(s);
      }

      for (let i = 0; i < 42; i++) {
        const iso = cursor;
        const inMonth = iso.slice(0, 7) === calMonth;
        const dayItems = (byDate[iso] || []).slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));
        const cell = el(
          'div',
          {
            class: `calendar-cell ${inMonth ? '' : 'calendar-cell--outside'} ${iso === today ? 'calendar-cell--today' : ''}`,
            onclick: () => openScheduleForm(null, iso),
          },
          [
            el('div', { class: 'row', style: 'gap:4px; align-items:baseline' }, [
              el('div', { class: 'calendar-cell__daynum' }, String(Number(iso.slice(8, 10)))),
              holidayMap[iso] ? el('div', { class: 'calendar-cell__holiday', title: holidayMap[iso] }, escapeHtml(holidayMap[iso])) : null,
            ]),
            ...dayItems.slice(0, 3).map((s) =>
              el(
                'div',
                {
                  class: `calendar-cell__item ${s.done ? 'calendar-cell__item--done' : ''}`,
                  title: s.title,
                  onclick: (e) => { e.stopPropagation(); openScheduleForm(s); },
                },
                escapeHtml(s.title)
              )
            ),
            dayItems.length > 3 ? el('div', { class: 'calendar-cell__more' }, `+${dayItems.length - 3}개`) : null,
          ]
        );
        grid.append(cell);
        cursor = window.addDays(cursor, 1);
      }
      container.append(grid);
    }

    // 태그 기반 Knowledge 연동(1.2) — 일정 태그와 겹치는 Knowledge 자료가 있으면 작게 링크로 보여준다.
    function relatedKnowledgeLink(tags) {
      if (!tags || !tags.length || !appState.knowledgeDocs) return null;
      const matches = appState.knowledgeDocs.filter((d) => d.status !== 'archived' && (d.tags || []).some((t) => tags.includes(t)));
      if (!matches.length) return null;
      return el('div', { class: 'text-muted', style: 'font-size:11px; margin-top:3px' }, [
        '📚 ',
        el('a', { href: '#/knowledge', onclick: (e) => { e.preventDefault(); window.navigate('/knowledge'); } }, `관련 자료 ${matches.length}건`),
      ]);
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

    // 공공데이터포털 특일정보(공휴일) API로 올해·내년 공휴일을 가져와 "달력 참고 표시"로만 쓴다.
    // appState.schedules(내 일정)에는 전혀 쓰지 않는다 — 등록/수정/삭제 대상이 아닌 순수 참고 정보다.
    async function loadHolidaysForCalendar() {
      holidaysLoaded = true; // 실패해도 매 draw()마다 재시도하지 않도록 먼저 표시해둔다.
      if (!window.getPublicDataKey()) return;
      try {
        const year = new Date().getFullYear();
        const [thisYear, nextYear] = await Promise.all([window.fetchHolidays(year), window.fetchHolidays(year + 1)]);
        const map = {};
        for (const h of [...thisYear, ...nextYear]) {
          if (h.isHoliday) map[h.dateIso] = h.name;
        }
        holidayMap = map;
        draw();
      } catch (e) {
        // 달력 참고 표시는 실패해도 조용히 무시한다(버튼으로 다시 시도할 수 있다).
      }
    }

    // "공휴일 목록(참고용)" 버튼 — 목록을 보여줄 뿐, 여기서 어떤 것도 내 일정에 추가하지 않는다.
    async function showHolidayList() {
      if (!window.getPublicDataKey()) {
        toast('설정 화면에서 공공데이터포털 API 키를 먼저 등록해 주세요.', 'error');
        return;
      }
      openModal({
        title: '📅 공휴일 목록(참고용 — 내 일정에는 반영되지 않습니다)',
        async contentBuilder(body) {
          body.append(el('div', { class: 'text-muted' }, '불러오는 중…'));
          try {
            const year = new Date().getFullYear();
            const [thisYear, nextYear] = await Promise.all([window.fetchHolidays(year), window.fetchHolidays(year + 1)]);
            const holidays = [...thisYear, ...nextYear].filter((h) => h.isHoliday).sort((a, b) => a.dateIso.localeCompare(b.dateIso));
            const map = {};
            for (const h of holidays) map[h.dateIso] = h.name;
            holidayMap = map;
            draw();
            body.innerHTML = '';
            if (!holidays.length) {
              body.append(el('div', { class: 'empty-state' }, '표시할 공휴일이 없습니다.'));
              return;
            }
            const list = el('div', { class: 'item-list' });
            for (const h of holidays) {
              list.append(
                el('div', { class: 'item-row' }, [
                  el('div', { class: 'item-row__main' }, [
                    el('div', { class: 'item-row__title' }, escapeHtml(h.name)),
                    el('div', { class: 'text-muted', style: 'font-size:12px' }, formatKoreanDate(h.dateIso)),
                  ]),
                ])
              );
            }
            body.append(list);
          } catch (e) {
            body.innerHTML = '';
            body.append(el('div', { class: 'text-muted', style: 'color:#ef4444' }, `공휴일을 가져오지 못했습니다: ${e.message}`));
          }
        },
      });
    }

    async function remove(s) {
      if (!confirmDialog(`"${s.title}" 일정을 삭제할까요?`)) return;
      await appState.deleteSchedule(s.id);
      toast('일정을 삭제했습니다.', 'success');
    }

    // prefillDate: 달력 보기에서 빈 날짜 칸을 눌렀을 때 그 날짜로 새 일정 폼을 채워준다(existing과는 무관).
    function openScheduleForm(existing, prefillDate) {
      openModal({
        title: existing ? '일정 수정' : '일정 등록',
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          form.append(
            field('제목', el('input', { class: 'nm-input', name: 'title', required: true, value: existing?.title || '' })),
            field('날짜', el('input', { class: 'nm-input', type: 'date', name: 'date', required: true, value: existing?.date || prefillDate || todayISO() })),
            field('시간(선택)', el('input', { class: 'nm-input', type: 'time', name: 'time', value: existing?.time || '' })),
            field('우선순위', prioritySelect(existing?.priority)),
            field('중요 표시(플래그)', flagCheckbox(existing?.flagged)),
            field('연결 프로젝트(선택)', projectSelect(existing?.project_id)),
            field('태그(쉼표로 구분, 선택)', el('input', { class: 'nm-input', name: 'tags', value: (existing?.tags || []).join(', ') })),
            field('메모', el('textarea', { class: 'nm-textarea', name: 'memo' }, existing?.memo || '')),
            existing ? null : repeatField()
          );
          const submitBtn = el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장');
          form.append(submitBtn);
          // 신규 등록(반복 없이 1건만 생성되는 경우) 직후 바로 첨부할 수 있도록, 저장되면
          // 폼 자리에 첨부 패널을 보여준다(Knowledge/문화생활과 동일한 흐름).
          const attachHost = el('div', {});
          body.append(form, attachHost);
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
              toast('일정을 저장했습니다.', 'success');
              close();
              return;
            }
            // 벤치마크: Google Calendar류의 간단 반복 등록 — 반복 규칙 테이블 없이,
            // 등록 시점에 개별 일정 여러 건으로 즉시 생성한다(각 건은 독립적으로 완료/수정 가능).
            const repeat = fd.get('repeat') || 'none';
            const count = Math.min(52, Math.max(1, Number(fd.get('repeat_count')) || 1));
            const stepDays = repeat === 'daily' ? 1 : repeat === 'weekly' ? 7 : repeat === 'monthly' ? 30 : 0;
            if (repeat === 'none' || stepDays === 0) {
              const row = await appState.addSchedule(data);
              toast('일정을 저장했습니다. 이제 파일을 첨부할 수 있어요.', 'success');
              Array.from(form.elements).forEach((elm) => { elm.disabled = true; });
              submitBtn.style.display = 'none';
              attachHost.append(
                el('h3', { style: 'margin:16px 0 8px' }, '첨부파일'),
                el('div', { id: 'new-schedule-attach-box' }),
                el('button', { class: 'nm-btn nm-btn--primary', style: 'width:100%; margin-top:12px', onclick: close }, '완료')
              );
              window.renderAttachmentsPanel(attachHost.querySelector('#new-schedule-attach-box'), 'schedules', row.id);
            } else {
              // 반복 등록은 여러 건이 한 번에 생기므로 특정 한 건에만 첨부하는 것이 의미가
              // 없어 첨부 단계 없이 바로 닫는다(각 일정은 목록의 📎 버튼으로 개별 첨부 가능).
              for (let i = 0; i < count; i++) {
                await appState.addSchedule({ ...data, date: window.addDays(data.date, stepDays * i) });
              }
              toast('일정을 저장했습니다.', 'success');
              close();
            }
          });
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
