// 로그인 시 브리핑 모달 렌더러.
// 일반 <script>로 로드되며 js/utils/dom.js, js/components/modal.js, js/services/briefingService.js가
// 먼저 로드되어 있어야 한다.
(function () {
  const { el, escapeHtml, openModal, weatherCodeToLabel } = window;

  const SEVERITY_DOT = { critical: 'briefing-dot--critical', warning: 'briefing-dot--warning', info: '' };

  function showLoginBriefing(briefing) {
    return openModal({
      contentBuilder(body) {
        body.classList.add('briefing-modal');
        body.append(
          el('div', { class: 'briefing-header' }, [
            el('div', {}, [el('h2', {}, briefing.greeting), el('p', { class: 'text-muted' }, briefing.dateLabel)]),
          ])
        );

        if (briefing.weather) {
          body.append(
            el('div', { class: 'briefing-weather' }, [
              el('span', {}, '🌤️'),
              el('span', {}, `${briefing.weather.city} 현재 ${briefing.weather.temp ?? '--'}℃ · ${weatherCodeToLabel(briefing.weather.code)}`),
            ])
          );
        }

        // v7.24.0(아이디어 1): 자동 수집으로 새 글이 들어왔으면 인사말 아래에 한 줄로 강조한다.
        if (typeof briefing.briefingNewCount === 'number' && briefing.briefingNewCount > 0) {
          body.append(
            el('div', { class: 'briefing-weather', style: 'cursor:pointer', onclick: () => { body.closest('.nm-modal-backdrop')?.remove(); window.navigate('/briefing'); } }, [
              el('span', {}, '📰'),
              el('span', {}, `관심주제 새 글 ${briefing.briefingNewCount}건 — 눌러서 브리핑 보기`),
            ])
          );
        }

        // v7.33.0: 미진한 루틴(로그인할 때 한눈에) — 체크하거나 눌러서 상세에서 놓친 날을 보충할 수 있다.
        if (briefing.routines && (briefing.routines.overdue.length || briefing.routines.due.length)) {
          const rt = el('div', { class: 'briefing-section' }, [el('h3', {}, briefing.routines.overdue.length ? `🔁 미진한 루틴 ${briefing.routines.overdue.length}건` : '🔁 오늘 할 루틴')]);
          for (const x of [...briefing.routines.overdue, ...briefing.routines.due].slice(0, 8)) rt.append(window.routineLine(x));
          body.append(rt);
        }

        // v7.33.0: 금요일 주간 요약(새로 만들어졌을 때) — 눌러서 상세
        if (briefing.weekly) {
          body.append(el('div', { class: 'briefing-weather', style: 'cursor:pointer', onclick: () => showWeeklyBriefing(briefing.weekly) }, [
            el('span', {}, '🗓️'),
            el('span', {}, `이번 주 활동 요약이 준비됐어요(${briefing.weekly.content.weekStart.slice(5)} ~ ${briefing.weekly.content.friday.slice(5)}) — 눌러서 보기`),
          ]));
        }

        body.append(section('오늘 일정', briefing.todaySchedules, (s) => `${s.time ? s.time + ' · ' : ''}${escapeHtml(s.title)}`));

        body.append(
          sectionCustom(
            '마감 임박 · 예측',
            briefing.urgentProjects,
            (p) => {
              const dLabel = p.dDay !== null ? `D-${p.dDay}` : '';
              const predictLabel = p.prediction.predictedDate
                ? `예상 완료 ${p.prediction.predictedDate} (신뢰도 ${confLabel(p.prediction.confidence)})`
                : '';
              return el('div', {}, [
                el('div', { class: 'row row--between' }, [
                  el('strong', {}, escapeHtml(p.name)),
                  dLabel ? el('span', { class: 'nm-badge nm-badge--warning' }, dLabel) : null,
                ]),
                predictLabel ? el('div', { class: 'predict-chip' }, predictLabel) : null,
              ]);
            }
          )
        );

        if (briefing.newAlerts.length) {
          const wrap = el('div', { class: 'briefing-section' }, [el('h3', {}, `자동 알림 (${briefing.newAlerts.length}건 새로 생성됨)`)]);
          for (const n of briefing.newAlerts) {
            wrap.append(
              el('div', { class: 'briefing-alert-row' }, [
                el('span', { class: `briefing-dot ${SEVERITY_DOT[n.severity] || ''}` }),
                el('div', {}, [el('div', {}, escapeHtml(n.title)), el('div', { class: 'text-muted' }, escapeHtml(n.message))]),
              ])
            );
          }
          body.append(wrap);
        }

        body.append(el('button', { class: 'nm-btn nm-btn--primary', style: 'width:100%; margin-top:8px', onclick: () => body.closest('.nm-modal-backdrop').remove() }, '확인했어요'));
      },
    });
  }

  const won = (v) => Math.round(Number(v)).toLocaleString('ko-KR') + '원';
  function showWeeklyBriefing(row) {
    const c = row.content || row;
    const stat = (label, value, sub) => el('div', { class: 'nm-card', style: 'padding:10px; text-align:center' }, [
      el('div', { class: 'text-muted', style: 'font-size:12px' }, label), el('div', { style: 'font-size:20px; font-weight:700' }, value), sub ? el('div', { class: 'text-muted', style: 'font-size:11px' }, sub) : null]);
    return openModal({
      title: `🗓️ 주간 활동 요약 · ${c.weekStart} ~ ${c.friday}`,
      width: 560,
      contentBuilder(body) {
        body.append(el('div', { style: 'display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:8px' }, [
          stat('루틴 달성', c.routines.rate === null ? '—' : `${c.routines.rate}%`, `${c.routines.done}/${c.routines.due}`),
          stat('일정 완료', `${c.schedules.done}/${c.schedules.total}`),
          stat('건강 기록', `${c.health.count}건`, `지난주 ${c.health.prev}건`),
          stat('개발 기록', `${c.devlog.count}건`),
          stat('챌린지 체크', `${c.challenge.checkins}회`),
          c.asset ? stat('자산(마감)', won(c.asset.value), c.asset.diff === null ? c.asset.date : `${c.asset.diff >= 0 ? '+' : ''}${won(c.asset.diff)}`) : null,
        ]));
        if (c.notes && c.notes.length) body.append(el('div', { class: 'briefing-section' }, [el('h3', {}, '짚어볼 점'), ...c.notes.map((n) => el('div', { class: 'briefing-alert-row' }, [el('span', { class: 'briefing-dot briefing-dot--warning' }), el('div', {}, n)]))]));
        if (c.routines.items.length) body.append(el('div', { class: 'briefing-section' }, [el('h3', {}, '루틴별 달성(낮은 순)'), ...c.routines.items.map((x) => el('div', { class: 'row row--between', style: 'font-size:13px; padding:2px 0' }, [el('span', {}, x.title), el('span', {}, `${x.done}/${x.due} · ${x.rate}%`)]))]));
        if (c.next.schedules.length || c.next.deadlines.length) {
          body.append(el('div', { class: 'briefing-section' }, [el('h3', {}, '다음 주 예고'),
            ...c.next.schedules.map((x) => el('div', { style: 'font-size:13px' }, `${String(x.date).slice(5)} · ${x.title}`)),
            ...c.next.deadlines.map((x) => el('div', { style: 'font-size:13px' }, `⏰ ${x.name} 마감 ${x.deadline}`))]));
        }
        body.append(el('div', { class: 'text-muted', style: 'font-size:11px; margin-top:8px' }, '앱에 기록된 자료만으로 계산한 요약입니다. 기록하지 않은 활동은 반영되지 않아요.'));
      },
    });
  }

  function showWeeklyList() {
    return openModal({
      title: '🗓️ 주간 브리핑 기록',
      width: 420,
      contentBuilder(body) {
        const list = window.appState.weeklyBriefings || [];
        if (!list.length) body.append(el('div', { class: 'text-muted' }, '아직 없습니다. 금요일 오전 9시 이후 앱을 열면 자동으로 만들어집니다.'));
        for (const r of list) body.append(el('button', { class: 'nm-btn', style: 'display:block; width:100%; margin-bottom:6px; text-align:left', onclick: () => showWeeklyBriefing(r) }, `${r.week_start} 주 요약`));
      },
    });
  }

  function confLabel(c) {
    return { high: '높음', medium: '보통', low: '낮음', none: '-' }[c] || c;
  }

  function section(title, items, lineFn) {
    const wrap = el('div', { class: 'briefing-section' }, [el('h3', {}, title)]);
    if (!items.length) {
      wrap.append(el('div', { class: 'briefing-empty' }, '해당 항목이 없습니다.'));
    } else {
      for (const item of items) wrap.append(el('div', { class: 'briefing-alert-row' }, [el('span', { class: 'briefing-dot' }), el('div', { html: lineFn(item) })]));
    }
    return wrap;
  }

  function sectionCustom(title, items, nodeFn) {
    const wrap = el('div', { class: 'briefing-section' }, [el('h3', {}, title)]);
    if (!items.length) {
      wrap.append(el('div', { class: 'briefing-empty' }, '해당 항목이 없습니다.'));
    } else {
      for (const item of items) wrap.append(el('div', { class: 'briefing-alert-row' }, [el('span', { class: 'briefing-dot briefing-dot--warning' }), nodeFn(item)]));
    }
    return wrap;
  }

  window.showLoginBriefing = showLoginBriefing;
  window.showWeeklyBriefing = showWeeklyBriefing;
  window.showWeeklyList = showWeeklyList;
})();
