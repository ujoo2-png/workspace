// Integrations 화면. 외부 서비스 연동 상태를 관리한다.
// 이 MVP 단계에서는 실제 OAuth 연동 없이 "연동 예정/보류" 상태만 기록한다.
// (메일 계정별 수집은 사용자 요청에 따라 고도화 단계로 보류됨 — 여기서 상태만 표시)
// 일반 <script>로 로드된다.
(function () {
  const { appState, el, escapeHtml, toast } = window;

  const PROVIDERS = [
    { key: 'gmail', label: 'Gmail', icon: '📧', note: '메일 계정별 수집 — 고도화 단계에서 진행 예정', available: false },
    { key: 'google_calendar', label: 'Google Calendar', icon: '🗓️', note: '일정 양방향 동기화 — 준비 중', available: false },
    { key: 'notion', label: 'Notion', icon: '📓', note: 'Knowledge 문서 가져오기 — 준비 중', available: false },
    { key: 'slack', label: 'Slack', icon: '💬', note: '알림 전달 — 준비 중', available: false },
  ];

  const STATUS_LABEL = { connected: '연동됨', pending: '연동 예정', disabled: '사용 안 함' };

  function renderIntegrations(root) {
    const container = el('div', {});
    root.append(container);

    function draw() {
      container.innerHTML = '';
      container.append(el('div', { class: 'page-header' }, [el('h1', {}, 'Integrations')]));
      container.append(
        el('p', { class: 'text-muted', style: 'margin-bottom:16px' }, '외부 서비스 연동은 현재 준비 중입니다. 연동 우선순위를 미리 표시해두면 고도화 시 참고합니다.')
      );

      const list = el('div', { class: 'item-list' });
      for (const p of PROVIDERS) {
        const stored = appState.integrations.find((i) => i.provider === p.key);
        const status = stored?.status || 'pending';
        list.append(
          el('div', { class: 'item-row' }, [
            el('span', { style: 'font-size:20px' }, p.icon),
            el('div', { class: 'item-row__main' }, [
              el('div', { class: 'item-row__title' }, escapeHtml(p.label)),
              el('div', { class: 'item-row__meta' }, escapeHtml(p.note)),
            ]),
            el('select', {
              class: 'nm-select',
              style: 'width:120px',
              value: status,
              disabled: p.available ? undefined : true,
              onchange: async (e) => {
                await appState.setIntegrationStatus(p.key, e.target.value);
                toast('저장했습니다.', 'success');
              },
            }, Object.entries(STATUS_LABEL).map(([value, label]) => el('option', { value, selected: value === status || undefined }, label))),
          ])
        );
      }
      container.append(el('div', { class: 'nm-card' }, [el('h3', {}, '연동 가능 서비스'), list]));
    }

    draw();
    appState.addEventListener('change', draw);
    return () => appState.removeEventListener('change', draw);
  }

  window.renderIntegrations = renderIntegrations;
})();
