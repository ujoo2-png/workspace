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

      container.append(referoCard());

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

  // ---- Refero(디자인 레퍼런스) 연결 카드 (v7.26.0) ----
  function referoCard() {
    const R = window.ReferoService;
    const status = el('div', { class: 'text-muted', id: 'refero-status', style: 'font-size:12.5px; min-height:18px' });
    const results = el('div', { id: 'refero-results', style: 'margin-top:10px' });
    const tokenIn = el('input', { class: 'nm-input', id: 'refero-token', type: 'password', autocomplete: 'off', placeholder: R.getToken() ? '저장됨 (바꾸려면 새 토큰 입력)' : 'Refero 토큰(Bearer)', 'aria-label': 'Refero 토큰' });
    const setStatus = (t, err) => { status.textContent = t; status.style.color = err ? 'var(--danger)' : ''; };
    const saveBtn = el('button', { type: 'button', class: 'nm-btn', id: 'refero-save', onclick: () => {
      const v = tokenIn.value.trim();
      if (!v) { setStatus('토큰을 입력해 주세요.', true); return; }
      R.setToken(v); tokenIn.value = ''; tokenIn.placeholder = '저장됨 (바꾸려면 새 토큰 입력)'; setStatus('이 브라우저에 저장했어요(서버/DB에는 저장하지 않아요).');
    } }, '저장');
    const delBtn = el('button', { type: 'button', class: 'nm-btn', id: 'refero-del', onclick: () => { R.setToken(''); tokenIn.placeholder = 'Refero 토큰(Bearer)'; setStatus('토큰을 지웠어요.'); results.innerHTML = ''; } }, '지우기');
    const testBtn = el('button', { type: 'button', class: 'nm-btn', id: 'refero-test', onclick: async () => {
      testBtn.disabled = true; setStatus('연결 확인 중…'); results.innerHTML = '';
      try {
        const tools = await R.listTools();
        setStatus(`✅ 연결됨 — 도구 ${tools.length}개`);
        results.append(el('div', { class: 'row wrap', style: 'gap:6px' }, tools.map((t) => el('span', { class: 'nm-badge', title: t.description || '' }, t.name))));
      } catch (e) { setStatus(`⚠️ ${e.message}`, true); }
      testBtn.disabled = false;
    } }, '연결 테스트');
    const q = el('input', { class: 'nm-input', id: 'refero-q', placeholder: '찾을 화면/디자인 (예: 대시보드 사이드바, onboarding, 요금제 페이지)', 'aria-label': 'Refero 검색어', style: 'flex:1; min-width:200px' });
    const go = async () => {
      const text = q.value.trim(); if (!text) return;
      setStatus('검색 중…'); results.innerHTML = '';
      try {
        const r = await R.search(text);
        setStatus(`"${text}" — ${r.tool} 결과`);
        if (r.images.length) results.append(el('div', { class: 'refero-grid' }, r.images.map((u) => el('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, el('img', { src: u, alt: '레퍼런스 이미지', loading: 'lazy', referrerpolicy: 'no-referrer' })))));
        if (r.links.length) results.append(el('div', { class: 'stack', style: 'gap:4px; margin-top:8px; font-size:12.5px' }, r.links.map((u) => el('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, u))));
        if (r.texts.length) results.append(el('pre', { class: 'refero-text' }, r.texts.join('\n\n').slice(0, 6000)));
        if (!r.images.length && !r.links.length && !r.texts.length) results.append(el('div', { class: 'text-muted' }, '결과가 없어요.'));
      } catch (e) { setStatus(`⚠️ ${e.message}`, true); }
    };
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) go(); });
    return el('div', { class: 'nm-card', id: 'refero-card', style: 'margin-bottom:16px' }, [
      el('h3', {}, '🎨 Refero — 디자인 레퍼런스'),
      el('p', { class: 'text-muted', style: 'font-size:12.5px; margin:4px 0 10px' }, [
        'Refero의 실제 서비스/앱 화면 레퍼런스를 여기서 바로 검색해요. Refero 유료 플랜(Pro/Team/Lifetime)의 토큰이 필요하고, Vercel에 배포된 주소에서만 동작해요(/api/refero 프록시 사용). ',
        el('a', { href: 'https://doc.refero.design/mcp/getting-started', target: '_blank', rel: 'noopener noreferrer' }, '설정 방법'),
      ]),
      el('div', { class: 'row wrap', style: 'gap:6px; margin-bottom:8px' }, [tokenIn, saveBtn, testBtn, delBtn]),
      el('div', { class: 'row wrap', style: 'gap:6px' }, [q, el('button', { type: 'button', class: 'nm-btn nm-btn--primary', id: 'refero-go', onclick: go }, '검색')]),
      status, results,
    ]);
  }

  window.renderIntegrations = renderIntegrations;
})();
