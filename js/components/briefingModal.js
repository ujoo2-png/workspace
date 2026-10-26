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
})();
