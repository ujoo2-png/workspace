// 루틴(반복 할 일) 트래킹 — /routines 화면 + 홈 위젯 + 로그인 팝업이 함께 쓰는 UI (v7.33.0)
// 계산은 js/utils/routineCalc.js(순수 함수). 다른 메뉴의 기록(Health·Devlog·챌린지·증권 스냅샷)으로 자동 완료할 수도 있다.
(function () {
  const { appState, el, toast, openModal, confirmDialog, todayISO } = window;
  const RC = window.RoutineCalc;
  const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
  const CADENCE_LABEL = { daily: '매일', weekdays: '요일 지정', weekly: '주 N회', monthly: '매월', interval: 'N일마다' };
  const STATE_BADGE = { overdue: ['미진', 'nm-badge--danger'], due: ['오늘', 'nm-badge--warning'], ok: ['정상', 'nm-badge--success'], paused: ['중지', ''], upcoming: ['예정', ''] };
  const TEMPLATES = [
    { title: '건강 지표 기록(몸무게·혈압 등)', category: 'Health', cadence: 'daily', auto_source: 'health' },
    { title: '개발 일지(Devlog) 쓰기', category: '개발', cadence: 'weekly', times_per_week: 3, auto_source: 'devlog' },
    { title: '운동', category: 'Health', cadence: 'weekly', times_per_week: 3 },
    { title: '증권 마감 자산 확인', category: '증권', cadence: 'weekdays', weekdays: '1,2,3,4,5', auto_source: 'stocks' },
    { title: '주간 회고', category: '정리', cadence: 'weekdays', weekdays: '5' },
    { title: '차량 점검(타이어·오일)', category: '차량', cadence: 'interval', interval_days: 30 },
  ];

  function cadenceText(r) {
    if (r.cadence === 'weekdays') return `매주 ${[...RC.parseDays(r.weekdays)].sort().map((d) => DAYS[d - 1]).join('·') || '—'}`;
    if (r.cadence === 'weekly') return `주 ${r.times_per_week || 1}회`;
    if (r.cadence === 'interval') return `${r.interval_days || 1}일마다`;
    if (r.cadence === 'monthly') return `매월 ${Number(String(r.start_date || '').slice(8, 10)) || 1}일`;
    return '매일';
  }
  const autoText = (src) => !src ? '' : src === 'health' ? '자동: Health 기록' : src.startsWith('health:') ? `자동: Health ${src.slice(7)}` : src === 'devlog' ? '자동: Devlog 작성' : src === 'stocks' ? '자동: 증권 스냅샷' : src.startsWith('challenge:') ? '자동: 챌린지 체크인' : '';
  const summary = () => RC.summarize(appState.routines, appState.routineLogs, appState, todayISO());
  const evalOne = (id) => summary().items.find((x) => x.routine.id === id);

  async function toggleToday(id, done, date) {
    try { await appState.setRoutineDone(id, date || todayISO(), done); } catch (e) { toast(e.message || String(e), 'error'); }
  }

  // ── 한 줄 항목(체크 + 제목 + 상태) — 화면/홈/팝업 공용 ───────────────────
  function routineLine(x, { onChange } = {}) {
    const r = x.routine; const [lab, cls] = STATE_BADGE[x.state] || ['', ''];
    const manualToday = appState.routineLogs.some((l) => l.routine_id === r.id && l.log_date === todayISO());
    const auto = x.doneToday && !manualToday;
    const cb = el('input', { type: 'checkbox', checked: x.doneToday || undefined, disabled: auto || undefined, title: auto ? '다른 메뉴의 기록으로 자동 완료됨' : '오늘 했어요', onchange: async (e) => { await toggleToday(r.id, e.target.checked); if (onChange) onChange(); } });
    return el('div', { class: `rt-line rt-line--${x.state}` }, [
      cb,
      el('button', { type: 'button', class: 'rt-line__title', onclick: () => openRoutineDetail(r.id) }, r.title),
      el('span', { class: 'rt-line__meta' }, x.overdueCount && x.missedDates.length > 1 ? `${x.overdueCount}번 놓침` : x.note || (x.streak > 1 ? `🔥 ${x.streak}` : '')),
      lab ? el('span', { class: `nm-badge ${cls}` }, lab) : null,
    ]);
  }
  window.routineLine = routineLine;

  // ── 상세 모달: 최근 5주 달력(눌러서 과거 날짜 체크) + 통계 + 수정/중지/삭제 ──
  function openRoutineDetail(id) {
    openModal({ title: '루틴 상세', width: '560px', contentBuilder(body, close) {
      const host = el('div', {}); body.append(host);
      function paint() {
        const r = appState.routines.find((x) => x.id === id); if (!r) { close(); return; }
        const today = todayISO(); const done = RC.doneSet(r, appState.routineLogs, appState); const ev = RC.evaluate(r, done, today);
        const manual = new Set(appState.routineLogs.filter((l) => l.routine_id === id).map((l) => l.log_date));
        const grid = el('div', { class: 'rt-hist' }, [
          ...DAYS.map((d) => el('span', { class: 'rt-hist__h' }, d)),
          ...RC.history(r, done, today, 5).flat().map((c) => el('button', { type: 'button', class: `rt-cell rt-cell--${c.state}${c.date === today ? ' rt-cell--today' : ''}`, disabled: c.state === 'future' || undefined, title: `${c.date} ${c.state === 'done' ? (manual.has(c.date) ? '완료(눌러서 취소)' : '자동 완료') : '눌러서 완료 표시'}`,
            onclick: async () => { if (c.state === 'done' && !manual.has(c.date)) return; await toggleToday(id, c.state !== 'done', c.date); paint(); } }, c.date.slice(8))),
        ]);
        host.replaceChildren(
          el('h3', { style: 'margin:0 0 4px' }, r.title),
          el('div', { class: 'text-muted', style: 'font-size:12px; margin-bottom:10px' }, [cadenceText(r), r.category ? ` · ${r.category}` : '', autoText(r.auto_source) ? ` · ${autoText(r.auto_source)}` : '', ` · ${r.start_date}부터`].join('')),
          el('div', { class: 'rt-stats' }, [
            stat('연속', ev.streak ? `${ev.streak}${r.cadence === 'weekly' ? '주' : r.cadence === 'interval' ? '회' : '회'}` : '—'),
            stat('최근 30일', ev.rate30 === null ? '—' : `${ev.rate30}%`),
            stat('상태', (STATE_BADGE[ev.state] || ['—'])[0]),
            stat('다음', ev.nextDue || '—'),
          ]),
          ev.note ? el('div', { class: 'text-muted', style: 'font-size:12px; margin:6px 0' }, ev.note) : null,
          ev.missedDates.length && r.cadence !== 'interval' ? el('div', { class: 'nm-banner nm-banner--warning', style: 'margin:8px 0' }, `놓친 날: ${ev.missedDates.slice().reverse().join(', ')} — 아래 달력에서 눌러 "했어요"로 바꿀 수 있어요.`) : null,
          grid,
          r.note ? el('p', { class: 'text-muted', style: 'font-size:12px' }, r.note) : null,
          el('div', { class: 'row', style: 'gap:8px; margin-top:12px; flex-wrap:wrap' }, [
            el('button', { class: 'nm-btn nm-btn--primary', onclick: async () => { await toggleToday(id, !ev.doneToday); paint(); } }, ev.doneToday ? '오늘 완료 취소' : '오늘 했어요'),
            el('button', { class: 'nm-btn', onclick: () => { close(); openRoutineForm(r); } }, '수정'),
            el('button', { class: 'nm-btn', onclick: async () => { await appState.updateRoutine(id, { active: r.active === false }); paint(); } }, r.active === false ? '다시 시작' : '일시중지'),
            el('button', { class: 'nm-btn nm-btn--danger', onclick: async () => { if (await confirmDialog(`"${r.title}" 루틴을 삭제할까요? (수행 기록도 함께 사라집니다)`)) { await appState.deleteRoutine(id); close(); } } }, '삭제'),
          ])
        );
      }
      const stat = (l, v) => el('div', { class: 'rt-stat' }, [el('span', { class: 'text-muted' }, l), el('b', {}, v)]);
      paint();
    } });
  }
  window.openRoutineDetail = openRoutineDetail;

  // ── 등록/수정 폼 ───────────────────────────────────────────────────────
  function openRoutineForm(existing, preset) {
    const base = existing || preset || {};
    openModal({ title: existing ? '루틴 수정' : '루틴 추가', width: '520px', contentBuilder(body, close) {
      const f = (label, node) => el('div', { class: 'nm-field' }, [el('label', {}, label), node]);
      const title = el('input', { class: 'nm-input', name: 'title', required: true, value: base.title || '', placeholder: '예: 몸무게 기록, 영어 30분' });
      const cat = el('input', { class: 'nm-input', name: 'category', value: base.category || '', placeholder: '선택 — 예: Health' });
      const cad = el('select', { class: 'nm-select' }, Object.entries(CADENCE_LABEL).map(([v, t]) => el('option', { value: v, selected: (base.cadence || 'daily') === v || undefined }, t)));
      const days = RC.parseDays(base.weekdays);
      const dayBox = el('div', { class: 'row wrap', style: 'gap:6px' }, DAYS.map((d, i) => el('label', { class: 'freq-day' }, [el('input', { type: 'checkbox', value: String(i + 1), checked: days.has(i + 1) || undefined }), el('span', {}, d)])));
      const times = el('input', { class: 'nm-input', type: 'number', min: 1, max: 7, value: base.times_per_week || 3, style: 'width:90px' });
      const interval = el('input', { class: 'nm-input', type: 'number', min: 1, max: 365, value: base.interval_days || 7, style: 'width:90px' });
      const start = el('input', { class: 'nm-input', type: 'date', value: base.start_date || todayISO() });
      const challenges = appState.challenges.filter((c) => !c.deleted_at);
      const auto = el('select', { class: 'nm-select' }, [
        ['', '직접 체크(기본)'], ['health', 'Health에 기록하면 자동 완료'], ['devlog', 'Devlog를 쓰면 자동 완료'], ['stocks', '증권 일별 자산이 기록되면 자동 완료'],
        ...challenges.map((c) => [`challenge:${c.id}`, `챌린지 "${c.title}" 체크인하면 자동 완료`]),
      ].map(([v, t]) => el('option', { value: v, selected: (base.auto_source || '') === v || undefined }, t)));
      const note = el('textarea', { class: 'nm-textarea', rows: 2 }, base.note || '');
      const dayRow = f('요일', dayBox), timesRow = f('주 몇 회', times), intRow = f('몇 일마다(마지막 수행일 기준)', interval);
      const sync = () => { dayRow.style.display = cad.value === 'weekdays' ? '' : 'none'; timesRow.style.display = cad.value === 'weekly' ? '' : 'none'; intRow.style.display = cad.value === 'interval' ? '' : 'none'; };
      cad.addEventListener('change', sync); sync();
      const form = el('form', { class: 'stack' }, [f('이름', title), f('분류(선택)', cat), f('주기', cad), dayRow, timesRow, intRow, f(cad.value === 'monthly' ? '시작일(이 날짜의 "일"에 반복)' : '시작일', start), f('자동 완료(내 개입 줄이기)', auto), f('메모(선택)', note)]);
      form.append(el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장'));
      body.append(form);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const wd = [...dayBox.querySelectorAll('input:checked')].map((i) => i.value).sort().join(',');
        if (cad.value === 'weekdays' && !wd) { toast('요일을 하나 이상 고르세요.', 'error'); return; }
        const data = { title: title.value.trim(), category: cat.value.trim() || null, cadence: cad.value, weekdays: cad.value === 'weekdays' ? wd : '', times_per_week: cad.value === 'weekly' ? Math.min(7, Math.max(1, Number(times.value) || 1)) : null, interval_days: cad.value === 'interval' ? Math.max(1, Number(interval.value) || 1) : null, start_date: start.value || todayISO(), auto_source: auto.value || null, note: note.value.trim() || null };
        if (!data.title) return;
        try { if (existing) await appState.updateRoutine(existing.id, data); else await appState.addRoutine(data); toast('저장했습니다.', 'success'); close(); }
        catch (err) { toast(err.message || String(err), 'error'); }
      });
    } });
  }
  window.openRoutineForm = openRoutineForm;

  // ── /routines 화면 ─────────────────────────────────────────────────────
  function renderRoutines(root) {
    const container = el('div', {}); root.append(container);
    function draw() {
      container.innerHTML = '';
      const S = summary();
      container.append(el('div', { class: 'page-header' }, [el('h1', {}, '루틴'), el('div', { class: 'row', style: 'gap:8px' }, [el('button', { class: 'nm-btn', onclick: () => window.showWeeklyList() }, '🗓️ 주간 브리핑'), el('button', { class: 'nm-btn nm-btn--primary', onclick: () => openRoutineForm() }, '+ 루틴 추가')])]));
      if (!appState.routines.length) {
        container.append(el('div', { class: 'nm-card' }, [
          el('p', {}, '매일·주기적으로 해야 하는 일을 등록하면, 놓친 것만 로그인할 때 알려 드립니다. 아래 추천을 눌러 시작해 보세요.'),
          el('div', { class: 'row wrap', style: 'gap:8px' }, TEMPLATES.map((t) => el('button', { class: 'nm-btn', onclick: () => openRoutineForm(null, t) }, `+ ${t.title}`))),
        ]));
        return;
      }
      container.append(el('div', { class: 'rt-top' }, [
        topTile('오늘 진행', `${S.todayDone}/${S.todayTotal}`, ''), topTile('미진 루틴', String(S.overdue.length), S.overdue.length ? 'bad' : 'good'), topTile('활성 루틴', String(S.active.length), ''),
        topTile('최장 연속', String(Math.max(0, ...S.active.map((x) => x.streak))), ''),
      ]));
      const sec = (title, list, empty) => { if (!list.length && !empty) return; container.append(el('div', { class: 'section-title', style: 'margin:12px 0 4px' }, title)); const box = el('div', { class: 'nm-card rt-list' }); if (!list.length) box.append(el('div', { class: 'text-muted', style: 'font-size:13px' }, empty)); list.forEach((x) => box.append(routineLine(x))); container.append(box); };
      sec('⚠️ 미진 — 놓친 루틴', S.overdue);
      sec('📌 오늘 할 일', S.due, S.overdue.length ? '' : '오늘 남은 루틴이 없어요 🎉');
      sec('✅ 그 외 진행 중', S.active.filter((x) => !S.overdue.includes(x) && !S.due.includes(x)));
      sec('⏸ 중지/예정', S.items.filter((x) => x.state === 'paused' || x.state === 'upcoming'));
      container.append(el('div', { class: 'row wrap', style: 'gap:8px; margin-top:14px' }, [el('span', { class: 'text-muted', style: 'font-size:12px' }, '추천 추가:'), ...TEMPLATES.filter((t) => !appState.routines.some((r) => r.title === t.title)).map((t) => el('button', { class: 'nm-btn nm-btn--sm', onclick: () => openRoutineForm(null, t) }, `+ ${t.title}`))]));
    }
    const topTile = (l, v, c) => el('div', { class: `rt-tile ${c ? 'rt-tile--' + c : ''}` }, [el('span', { class: 'text-muted' }, l), el('b', {}, v)]);
    draw();
    const onChange = (e) => { const t = e.detail && e.detail.table; if (!t || ['routines', 'routine_logs', 'stock_asset_snapshots'].includes(t)) draw(); };
    appState.addEventListener('change', onChange);
    return () => appState.removeEventListener('change', onChange);
  }
  window.renderRoutines = renderRoutines;
  window.routineSummary = summary;
  window.routineEval = evalOne;
})();
