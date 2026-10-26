// 일정 관리 화면. QMS 문의현황류 화면을 참고해 테이블 UI로 구성했다.
// No, 플래그(중요 표시), 우선순위, D-day, 컬럼 정렬, 검색+퀵필터, 완료 숨기기 토글을 지원한다.
// 일반 <script>로 로드된다.
(function () {
  const { appState, el, escapeHtml, toast, confirmDialog, openModal, formatKoreanDate, todayISO, diffDays } = window;

  const PRIORITY_LABEL = { high: '높음', medium: '보통', low: '낮음' };
  // 구분(category) — 색 + 글자(점+라벨)로 함께 표시해 색에만 의존하지 않는다. 색은 css/modules/schedule.css의 --cat-* 토큰.
  const CATEGORIES = window.SCHEDULE_CATEGORIES;
  const CAT_KEY = { 개인: 'personal', 회사: 'company', 가족: 'family', 업무: 'work', 기타: 'etc' };
  const catKey = (c) => CAT_KEY[window.normalizeScheduleCategory(c)];
  function catBadge(c) {
    const label = window.normalizeScheduleCategory(c);
    return el('span', { class: `cat-badge cat-badge--${CAT_KEY[label]}` }, [el('span', { class: 'cat-emoji', 'aria-hidden': 'true' }, window.scheduleCategoryEmoji(label)), label]);
  }
  // "N일 후" 빠른 추가 버튼에 쓰는 값(직접 입력도 가능)
  const OFFSET_PRESETS_BEFORE = [-14, -7, -3, -1];
  const OFFSET_PRESETS_AFTER = [1, 3, 5, 7, 14, 30];
  const HIDE_DONE_KEY = 'workspace:schedule:hideDone';

  function renderSchedule(root) {
    const container = el('div', {});
    root.append(container);
    let quickTab = 'all'; // all | today | week | overdue | done
    let tagFilter = 'all';
    let catFilter = 'all'; // 구분 필터: all | 개인 | 회사 | 가족 | 업무 | 기타
    let query = '';
    let hideDone = window.settingsSync.get(HIDE_DONE_KEY) !== '0'; // 기본값: 숨김
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
        today: base.filter((s) => window.scheduleCoversDate(s, today) && !s.done).length,
        week: base.filter((s) => window.scheduleEnd(s) >= today && s.date <= weekEnd && !s.done).length,
        overdue: base.filter((s) => !s.done && window.scheduleEnd(s) < today).length,
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

      // 구분 필터 칩 + 범례(칩이 곧 범례다: 색 점 + 글자 + 건수)
      container.append(
        el('div', { class: 'cat-filter', role: 'group', 'aria-label': '구분 필터' }, [
          catChip('all', '전체', base.length),
          ...CATEGORIES.map((c) => catChip(c, c, base.filter((s) => window.normalizeScheduleCategory(s.category) === c).length)),
        ])
      );

      const allTags = Array.from(new Set(base.flatMap((s) => s.tags || []))).sort();
      container.append(
        el('div', { class: 'filter-bar' }, [
          el('input', {
            class: 'nm-input schedule-search-input',
            style: 'max-width:220px',
            placeholder: '검색(제목/메모/장소/구분)',
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
          el('button', { class: 'nm-btn', onclick: () => { query = ''; tagFilter = 'all'; catFilter = 'all'; quickTab = 'all'; draw(); } }, '초기화'),
          el('div', { class: 'row', style: 'margin-left:auto; gap:8px' }, [
            el('span', { class: 'text-muted' }, '완료 일정 숨기기'),
            el('button', {
              class: `nm-toggle ${hideDone ? 'nm-toggle--on' : ''}`,
              onclick: () => { hideDone = !hideDone; window.settingsSync.set(HIDE_DONE_KEY, hideDone ? '1' : '0'); draw(); },
            }),
          ]),
        ])
      );

      let rows = base.slice();
      if (quickTab === 'today') rows = rows.filter((s) => window.scheduleCoversDate(s, today));
      else if (quickTab === 'week') rows = rows.filter((s) => window.scheduleEnd(s) >= today && s.date <= weekEnd);
      else if (quickTab === 'overdue') rows = rows.filter((s) => !s.done && window.scheduleEnd(s) < today);
      else if (quickTab === 'done') rows = rows.filter((s) => s.done);
      else if (hideDone) rows = rows.filter((s) => !s.done);

      if (tagFilter !== 'all') rows = rows.filter((s) => (s.tags || []).includes(tagFilter));
      if (catFilter !== 'all') rows = rows.filter((s) => window.normalizeScheduleCategory(s.category) === catFilter);
      if (query.trim()) rows = rows.filter((s) => window.scheduleMatchesQuery(s, query));

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
            th('category', '구분'),
            th('title', '제목'),
            th('place', '장소'),
            th('date', '날짜(기간)'),
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
        const dDay = diffDays(today, window.scheduleEnd(s) < today ? window.scheduleEnd(s) : s.date > today ? s.date : today);
        const ongoing = window.isMultiDaySchedule(s) && window.scheduleCoversDate(s, today);
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
            el('td', {}, catBadge(s.category)),
            el('td', {}, [
              el('div', { style: 'font-weight:700' }, s.title),
              repeatBadge(s),
              s.memo ? el('div', { class: 'text-muted', style: 'font-size:12px' }, s.memo) : null,
            ]),
            el('td', {}, s.place ? el('span', { class: 'place-text', title: s.place }, `📍 ${s.place}`) : '-'),
            el('td', {}, window.isMultiDaySchedule(s)
              ? el('div', {}, [el('div', {}, window.scheduleRangeLabel(s)), s.time ? el('div', { class: 'text-muted', style: 'font-size:12px' }, `시작 ${s.time}`) : null])
              : `${formatKoreanDate(s.date)}${s.time ? ' ' + s.time : ''}`),
            el('td', {}, ongoing && !s.done ? el('span', { class: 'dday-chip dday-chip--soon', title: `종료까지 ${diffDays(today, window.scheduleEnd(s))}일` }, `진행 중 · 종료 D-${diffDays(today, window.scheduleEnd(s))}`) : ddayChip(dDay, s.done)),
            el('td', {}, project ? project.name : '-'),
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
                s.parent_schedule_id
                  ? el('button', { class: 'nm-btn nm-btn--icon', title: '부모와 연결 끊기(독립 일정으로)', onclick: () => detach(s) }, '⛓')
                  : null,
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
      const gridEnd = window.addDays(cursor, 41);
      const visible = appState.schedules.filter((s) => catFilter === 'all' || window.normalizeScheduleCategory(s.category) === catFilter);
      const lanesByDate = window.buildCalendarLanes(visible, cursor, gridEnd);
      const MAX_LANES = 3;

      for (let i = 0; i < 42; i++) {
        const iso = cursor;
        const inMonth = iso.slice(0, 7) === calMonth;
        const lanes = lanesByDate[iso] || [];
        const shown = lanes.slice(0, MAX_LANES);
        const hidden = lanes.slice(MAX_LANES).filter(Boolean).length;
        const isWeekStart = new Date(`${iso}T00:00:00`).getDay() === 0;
        const cell = el(
          'div',
          {
            class: `calendar-cell ${inMonth ? '' : 'calendar-cell--outside'} ${iso === today ? 'calendar-cell--today' : ''}`,
            onclick: () => openScheduleForm(null, iso),
          },
          [
            el('div', { class: 'row', style: 'gap:4px; align-items:baseline' }, [
              el('div', { class: 'calendar-cell__daynum' }, String(Number(iso.slice(8, 10)))),
              holidayMap[iso] ? el('div', { class: 'calendar-cell__holiday', title: holidayMap[iso] }, holidayMap[iso]) : null,
            ]),
            ...shown.map((slot) => {
              if (!slot) return el('div', { class: 'calendar-cell__item calendar-cell__item--empty', 'aria-hidden': 'true' }, '\u00a0');
              const { s, pos } = slot;
              // 기간 막대: 시작일·주(일요일)의 첫 칸에만 제목을 쓰고, 이어지는 칸은 색 막대만 이어 붙인다.
              const showTitle = pos === 'single' || pos === 'start' || isWeekStart;
              const dow = new Date(`${iso}T00:00:00`).getDay();
              const emoji = window.scheduleCategoryEmoji(s.category);
              return el(
                'div',
                {
                  class: `calendar-cell__item cat-item--${catKey(s.category)} span--${pos} ${dow === 0 ? 'span--rowstart' : ''} ${dow === 6 ? 'span--rowend' : ''} ${s.done ? 'calendar-cell__item--done' : ''}`,
                  title: `${emoji} [${window.normalizeScheduleCategory(s.category)}] ${s.title} · ${window.scheduleRangeLabel(s)}${s.time ? ' · ' + s.time : ''}${s.place ? ' · 📍' + s.place : ''}${s.offset_days ? ' · ' + window.offsetLabel(s.offset_days) : ''}`,
                  onclick: (e) => { e.stopPropagation(); openScheduleForm(s); },
                },
                showTitle ? [el('span', { class: 'cat-emoji', 'aria-hidden': 'true' }, emoji), s.parent_schedule_id ? '↳ ' : '', s.title] : '\u00a0'
              );
            }),
            hidden ? el('div', { class: 'calendar-cell__more' }, `+${hidden}개`) : null,
          ]
        );
        grid.append(cell);
        cursor = window.addDays(cursor, 1);
      }
      container.append(grid);
      container.append(el('div', { class: 'cal-legend', 'aria-label': '구분 범례' }, window.SCHEDULE_CATEGORIES.map((c) => el('span', { class: `cat-badge cat-badge--${CAT_KEY[c]}` }, [el('span', { class: 'cat-emoji', 'aria-hidden': 'true' }, window.scheduleCategoryEmoji(c)), c]))));
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
                    el('div', { class: 'item-row__title' }, h.name),
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

    // 부모 일정이면 "🔁 +5·+7일", 자동 생성된 자식이면 "↳ 5일 후" 표식.
    function repeatBadge(s) {
      if (s.parent_schedule_id) {
        const parent = appState.schedules.find((x) => x.id === s.parent_schedule_id);
        return el('div', { class: 'repeat-badge', title: parent ? `"${parent.title}" 일정에서 ${s.offset_days ? window.offsetLabel(s.offset_days) : ''} 날짜로 자동 생성됨` : '자동 생성된 일정' }, `↳ ${s.offset_days ? window.offsetLabel(s.offset_days) : '?'} 일정${parent ? ` · 원본: ${parent.title}` : ''}`);
      }
      const offs = s.repeat_offsets || [];
      if (offs.length) {
        const shown = offs.slice(0, 4).map((n) => (n < 0 ? String(n) : `+${n}`)).join(' · ');
        return el('div', { class: 'repeat-badge repeat-badge--parent', title: `이 일정을 기준으로 ${offs.map(window.offsetLabel).join(', ')} 일정이 자동 생성되어 있습니다` }, `🔁 ${shown}${offs.length > 4 ? ` 외 ${offs.length - 4}건` : ''}일`);
      }
      return null;
    }

    function catChip(key, label, count) {
      const active = catFilter === key;
      return el('button', {
        type: 'button',
        class: `cat-chip ${key === 'all' ? '' : `cat-chip--${CAT_KEY[key]}`} ${active ? 'cat-chip--active' : ''}`,
        'aria-pressed': active ? 'true' : 'false',
        onclick: () => { catFilter = key; draw(); },
      }, [key === 'all' ? null : el('span', { class: 'cat-emoji', 'aria-hidden': 'true' }, window.scheduleCategoryEmoji(key)), label, el('span', { class: 'cat-chip__count' }, String(count))]);
    }

    async function detach(s) {
      if (!confirmDialog(`"${s.title}"을(를) 원본 일정과의 연결을 끊고 독립 일정으로 만들까요?\n(이후 원본을 수정해도 이 일정은 바뀌지 않습니다.)`)) return;
      try {
        await appState.detachSchedule(s.id);
        toast('독립 일정으로 바꿨습니다.', 'success');
      } catch (e) { toast(`실패했습니다: ${e.message || e}`, 'error'); }
    }

    // 삭제: 자식("N일 후" 일정)이 있으면 함께 지울지 묻는다(모두 삭제 / 이 일정만 삭제하고 자식은 독립 일정으로 유지 / 취소).
    async function remove(s) {
      const kids = appState.schedules.filter((x) => x.parent_schedule_id === s.id);
      if (!kids.length) {
        if (!confirmDialog(`"${s.title}" 일정을 삭제할까요?`)) return;
        try { await appState.deleteSchedule(s.id); toast('일정을 삭제했습니다.', 'success'); } catch (e) { toast(`삭제하지 못했습니다: ${e.message || e}`, 'error'); }
        return;
      }
      openModal({
        title: '연결된 "N일 후" 일정이 있습니다',
        contentBuilder(body, close) {
          const run = async (deleteChildren) => {
            close();
            try {
              await appState.deleteSchedule(s.id, { deleteChildren });
              toast(deleteChildren ? `일정과 연결된 ${kids.length}건을 삭제했습니다.` : `일정을 삭제했습니다. 연결된 ${kids.length}건은 독립 일정으로 남았습니다.`, 'success');
            } catch (e) { toast(`삭제하지 못했습니다: ${e.message || e}`, 'error'); }
          };
          body.append(
            el('p', {}, `"${s.title}"에서 자동 생성된 일정이 ${kids.length}건 있습니다 (${kids.map((k) => window.offsetLabel(k.offset_days)).join(', ')}).`),
            el('div', { class: 'stack' }, [
              el('button', { class: 'nm-btn nm-btn--danger', id: 'del-all', onclick: () => run(true) }, `모두 삭제 (이 일정 + ${kids.length}건)`),
              el('button', { class: 'nm-btn', id: 'del-parent-only', onclick: () => run(false) }, `이 일정만 삭제 (${kids.length}건은 독립 일정으로 유지)`),
              el('button', { class: 'nm-btn', onclick: close }, '취소'),
            ])
          );
        },
      });
    }

    // 필수 입력은 라벨 왼쪽에 빨간 * (css .nm-field .req)
    function field(label, node, required = false) {
      return el('div', { class: 'nm-field' }, [el('label', {}, [required ? el('span', { class: 'req', 'aria-hidden': 'true' }, '*') : null, label]), node]);
    }

    function categorySelect(selected) {
      const select = el('select', { class: 'nm-select', name: 'category' });
      for (const c of CATEGORIES) select.append(el('option', { value: c, selected: c === window.normalizeScheduleCategory(selected) || undefined }, `${window.scheduleCategoryEmoji(c)} ${c}`));
      return select;
    }

    // 통합 "반복·알림" 입력(v7.24.0): 기준 일정의 며칠 전/후에 일정을 자동으로 만든다.
    //  · 칩 목록("3일 전", "5일 후") · 직접 입력("3일 전, 5일 후, +7, -1") · 빠른 추가(전/후 버튼)
    //  · "반복 채우기": 매일/매주/매월 × 횟수 → 같은 칩 목록에 채워 넣는다(예전의 별도 "반복" 기능을 이 입력으로 합쳤다).
    // getBaseDate()로 현재 시작일을 읽어 "→ 10/5(월), 10/12(월)에도 일정이 만들어집니다" 미리보기를 보여준다. ±1~365일, 최대 60개.
    function offsetsField(initial, getBaseDate, getChildCount) {
      let offsets = window.parseOffsets(initial || []).offsets;
      const chips = el('div', { class: 'offset-chips' });
      const preview = el('div', { class: 'text-muted offset-preview' });
      const msg = el('div', { class: 'offset-msg' });
      const input = el('input', { class: 'nm-input', id: 'offset-input', placeholder: '예: 3일 전, 5일 후, +7, -1', style: 'flex:1; min-width:120px', 'aria-label': '며칠 전/후 직접 입력' });
      const hidden = el('input', { type: 'hidden', name: 'repeat_offsets' });
      function setOffsets(list, notice) {
        const r = window.parseOffsets(list);
        offsets = r.offsets;
        const notes = [];
        if (r.invalid.length) notes.push(`±1~${window.MAX_OFFSET_DAYS}일만 가능해요: ${r.invalid.join(', ')} 제외`);
        if (r.truncated) notes.push(`최대 ${window.MAX_REPEAT_OFFSETS}개까지만 저장돼요`);
        msg.textContent = notice || notes.join(' · ');
        render();
      }
      function render() {
        hidden.value = JSON.stringify(offsets);
        chips.innerHTML = '';
        for (const n of offsets) {
          const label = window.offsetLabel(n);
          chips.append(el('span', { class: `offset-chip ${n < 0 ? 'offset-chip--before' : ''}` }, [label, el('button', { type: 'button', class: 'offset-chip__x', title: `${label} 제거`, 'aria-label': `${label} 제거`, onclick: () => setOffsets(offsets.filter((x) => x !== n)) }, '×')]));
        }
        if (!offsets.length) chips.append(el('span', { class: 'text-muted', style: 'font-size:12px' }, '없음 — 아래에서 추가하세요'));
        const base = getBaseDate();
        const fmt = (n) => { const d = window.shiftIso(base, n); return `${d.slice(5).replace('-', '/')}(${window.weekdayLabel(d)})`; };
        preview.textContent = offsets.length && base
          ? `→ ${offsets.length > 8 ? `${offsets.slice(0, 8).map(fmt).join(', ')} 외 ${offsets.length - 8}건` : offsets.map(fmt).join(', ')} 에도 일정이 만들어집니다`
          : '';
        if (getChildCount() && !offsets.length) preview.textContent = `저장하면 연결된 자동 생성 일정 ${getChildCount()}건이 삭제됩니다`;
      }
      const addFromInput = () => {
        if (!input.value.trim()) return;
        setOffsets([...offsets, ...window.parseOffsets(input.value).offsets], null);
        const r = window.parseOffsets(input.value);
        if (r.invalid.length) msg.textContent = `±1~${window.MAX_OFFSET_DAYS}일만 가능해요: ${r.invalid.join(', ')} 제외`;
        input.value = '';
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addFromInput(); } });
      input.addEventListener('blur', addFromInput);
      const presetBtn = (n) => el('button', { type: 'button', class: `nm-btn offset-preset ${n < 0 ? 'offset-preset--before' : ''}`, onclick: () => setOffsets([...offsets, n]) }, n < 0 ? `${-n}일 전` : `+${n}일`);
      const presets = el('div', { class: 'row wrap', style: 'gap:6px' }, [...OFFSET_PRESETS_BEFORE.map(presetBtn), ...OFFSET_PRESETS_AFTER.map(presetBtn)]);
      // 반복 채우기: 매일/매주/매월 × 횟수(원본 포함) → 칩으로 변환
      const kindSel = el('select', { class: 'nm-select', style: 'width:auto', 'aria-label': '반복 주기' }, [
        el('option', { value: 'daily' }, '매일'), el('option', { value: 'weekly', selected: true }, '매주'), el('option', { value: 'monthly' }, '매월(30일 간격)'),
      ]);
      const countInput = el('input', { class: 'nm-input', type: 'number', min: '2', max: String(window.MAX_REPEAT_OFFSETS + 1), value: '4', style: 'width:72px', 'aria-label': '반복 횟수(원본 포함)' });
      const fillBtn = el('button', { type: 'button', class: 'nm-btn', onclick: () => {
        const list = window.repeatToOffsets(kindSel.value, countInput.value);
        if (!list.length) { msg.textContent = '횟수는 2 이상으로 입력해 주세요.'; return; }
        setOffsets([...offsets, ...list], `${kindSel.selectedOptions[0].textContent.replace(/\(.*\)/, '')} ${countInput.value}회 반복으로 ${list.length}건을 채웠어요.`);
      } }, '반복 채우기');
      const repeatRow = el('div', { class: 'row wrap', style: 'gap:6px; align-items:center; margin-top:2px' }, [el('span', { class: 'text-muted', style: 'font-size:12px' }, '반복으로 채우기'), kindSel, countInput, el('span', { class: 'text-muted', style: 'font-size:12px' }, '회(원본 포함)'), fillBtn]);
      const wrap = el('div', { class: 'nm-field', id: 'offsets-field' }, [
        el('label', {}, '반복·알림 — 며칠 전/후에도 일정 만들기 (선택)'),
        chips,
        el('div', { class: 'row', style: 'gap:6px; margin-top:4px' }, [input, el('button', { type: 'button', class: 'nm-btn', onclick: addFromInput }, '추가')]),
        presets,
        repeatRow,
        msg,
        preview,
        hidden,
      ]);
      render();
      wrap.refresh = render;
      wrap.setDisabled = () => {};
      return wrap;
    }

    // prefillDate: 달력 보기에서 빈 날짜 칸을 눌렀을 때 그 날짜로 새 일정 폼을 채워준다(existing과는 무관).
    function openScheduleForm(existing, prefillDate) {
      const isChild = !!existing?.parent_schedule_id;
      const parent = isChild ? appState.schedules.find((x) => x.id === existing.parent_schedule_id) : null;
      const childCount = existing && !isChild ? appState.schedules.filter((x) => x.parent_schedule_id === existing.id).length : 0;
      openModal({
        title: existing ? '일정 수정' : '일정 등록',
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          const dateInput = el('input', { class: 'nm-input', type: 'date', name: 'date', required: true, value: existing?.date || prefillDate || todayISO() });
          const endInput = el('input', { class: 'nm-input', type: 'date', name: 'end_date', value: existing?.end_date || '', min: dateInput.value });
          const endInfo = el('div', { class: 'text-muted', style: 'font-size:12px; margin-top:4px' });
          const refreshEnd = () => {
            endInput.min = dateInput.value;
            if (endInput.value && endInput.value < dateInput.value) endInput.value = dateInput.value;
            const err = window.validateScheduleRange(dateInput.value, endInput.value);
            endInfo.textContent = err || (endInput.value && endInput.value > dateInput.value ? `📆 ${window.scheduleRangeLabel({ date: dateInput.value, end_date: endInput.value })}` : '비워 두면 하루 일정이에요.');
          };
          const endClear = el('button', { type: 'button', class: 'nm-btn', style: 'padding:4px 10px', onclick: () => { endInput.value = ''; refreshEnd(); } }, '종료일 지우기');
          const endWrap = el('div', {}, [el('div', { class: 'row', style: 'gap:8px' }, [endInput, endClear]), endInfo]);
          dateInput.addEventListener('input', refreshEnd);
          endInput.addEventListener('input', refreshEnd);
          refreshEnd();
          let offsetsNode = null;
          if (isChild) {
            form.append(el('div', { class: 'link-banner' }, [
              el('div', {}, `↳ "${parent ? parent.title : '원본 일정'}"에서 ${window.offsetLabel(existing.offset_days)} 날짜로 자동 생성된 일정입니다.`),
              el('label', { class: 'row', style: 'gap:8px; margin-top:6px; cursor:pointer' }, [
                el('input', { type: 'checkbox', name: 'detach', checked: true }),
                el('span', {}, '부모와 연결을 끊고 독립 일정으로 수정'),
              ]),
              el('div', { class: 'text-muted', style: 'font-size:12px' }, '체크를 끄면 원본이 바뀔 때 이 일정도 같이 바뀌므로 여기서는 수정할 수 없습니다.'),
            ]));
          }
          form.append(
            field('제목', el('input', { class: 'nm-input', name: 'title', required: true, value: existing?.title || '' }), true),
            field('시작일', dateInput, true),
            field('종료일(선택 — 여러 날에 걸친 일정이면 입력)', endWrap),
            field('시간(선택)', el('input', { class: 'nm-input', type: 'time', name: 'time', value: existing?.time || '' })),
            field('구분', categorySelect(existing?.category)),
            field('장소(선택)', el('input', { class: 'nm-input', name: 'place', placeholder: '예: 본사 3층 회의실', value: existing?.place || '' })),
            field('우선순위', prioritySelect(existing?.priority)),
            field('중요 표시(플래그)', flagCheckbox(existing?.flagged)),
            field('연결 프로젝트(선택)', projectSelect(existing?.project_id)),
            field('태그(쉼표로 구분, 선택)', el('input', { class: 'nm-input', name: 'tags', value: (existing?.tags || []).join(', ') })),
            field('메모', el('textarea', { class: 'nm-textarea', name: 'memo' }, existing?.memo || ''))
          );
          if (!isChild) {
            offsetsNode = offsetsField(existing?.repeat_offsets, () => dateInput.value, () => childCount);
            dateInput.addEventListener('input', () => offsetsNode.refresh());
            form.append(offsetsNode);
            if (childCount) form.append(el('div', { class: 'text-muted', style: 'font-size:12px' }, `이 일정을 수정하면 연결된 자동 생성 일정 ${childCount}건의 제목/날짜/시간/장소/구분도 함께 바뀝니다(완료 여부는 그대로).`));
          }
          const submitBtn = el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장');
          form.append(submitBtn);
          // 신규 등록(반복 없이 1건만 생성되는 경우) 직후 바로 첨부할 수 있도록, 저장되면
          // 폼 자리에 첨부 패널을 보여준다(Knowledge/문화생활과 동일한 흐름).
          const attachHost = el('div', {});
          body.append(form, attachHost);
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            if (isChild && fd.get('detach') !== 'on') { toast('변경 사항이 없습니다.', 'info'); close(); return; }
            const tags = String(fd.get('tags') || '').split(',').map((t) => t.trim()).filter(Boolean);
            const data = {
              title: fd.get('title'),
              date: fd.get('date'),
              end_date: fd.get('end_date') && fd.get('end_date') > fd.get('date') ? fd.get('end_date') : null,
              time: fd.get('time') || null,
              category: window.normalizeScheduleCategory(fd.get('category')),
              place: (fd.get('place') || '').trim() || null,
              priority: fd.get('priority') || 'medium',
              flagged: fd.get('flagged') === 'on',
              project_id: fd.get('project_id') || null,
              tags,
              memo: fd.get('memo') || null,
            };
            if (!isChild) data.repeat_offsets = window.parseOffsets(fd.get('repeat_offsets') ? JSON.parse(fd.get('repeat_offsets')) : []).offsets;
            const rangeErr = window.validateScheduleRange(fd.get('date'), fd.get('end_date'));
            if (rangeErr) { toast(rangeErr, 'error'); return; }
            const warn = () => { const w = appState.schemaWarning; appState.schemaWarning = null; return w; };
            try {
              if (existing) {
                if (isChild) Object.assign(data, { parent_schedule_id: null, is_generated: false, offset_days: null });
                appState.schemaWarning = null;
                await appState.updateSchedule(existing.id, data);
                const w = warn();
                toast(w ? `저장했습니다. (${w})` : isChild ? '독립 일정으로 저장했습니다.' : '일정을 저장했습니다.', 'success');
                close();
                return;
              }
              // 반복(매일/매주/매월)과 "N일 전/후"는 하나의 입력("반복·알림")으로 통합되었다 — 기준 일정 1건 + 연결된 자동 생성 일정들.
              appState.schemaWarning = null;
              const row = await appState.addSchedule(data);
              const n = (data.repeat_offsets || []).length;
              const w = warn();
              toast(w ? `저장했습니다. (${w})` : n ? `저장했습니다. 연결된 일정 ${n}건도 만들었어요. 이제 파일을 첨부할 수 있어요.` : '일정을 저장했습니다. 이제 파일을 첨부할 수 있어요.', 'success');
              Array.from(form.elements).forEach((elm) => { elm.disabled = true; });
              submitBtn.style.display = 'none';
              attachHost.append(
                el('h3', { style: 'margin:16px 0 8px' }, '첨부파일'),
                el('div', { id: 'new-schedule-attach-box' }),
                el('button', { class: 'nm-btn nm-btn--primary', style: 'width:100%; margin-top:12px', onclick: close }, '완료')
              );
              window.renderAttachmentsPanel(attachHost.querySelector('#new-schedule-attach-box'), 'schedules', row.id);
            } catch (err) {
              toast(`저장하지 못했습니다: ${err.message || err}`, 'error');
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

    function projectSelect(selectedId) {
      const select = el('select', { class: 'nm-select', name: 'project_id' }, [el('option', { value: '' }, '연결 안 함')]);
      for (const p of appState.projects.filter((p) => p.status !== 'done')) {
        select.append(el('option', { value: p.id, selected: p.id === selectedId || undefined }, p.name));
      }
      return select;
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
      else if (key === 'category') cmp = window.SCHEDULE_CATEGORIES.indexOf(window.normalizeScheduleCategory(a.category)) - window.SCHEDULE_CATEGORIES.indexOf(window.normalizeScheduleCategory(b.category));
      else if (key === 'place') {
        // 장소가 비어 있는 일정은 정렬 방향과 상관없이 항상 뒤로 보낸다.
        if (!a.place !== !b.place) return a.place ? -1 : 1;
        cmp = (a.place || '').localeCompare(b.place || '', 'ko');
      }
      return dir === 'asc' ? cmp : -cmp;
    });
    // 플래그(중요) 표시된 일정은 정렬 결과 안에서도 항상 위로 끌어올린다.
    return sorted.slice().sort((a, b) => (b.flagged ? 1 : 0) - (a.flagged ? 1 : 0));
  }

  window.renderSchedule = renderSchedule;
})();
