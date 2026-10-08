// 앱 부트스트랩. 일반 <script>로 로드되며, index.html에서 이 파일이 이전의 모든
// js/*.js 뒤에 로드되어 window.* 전역들(appState, getStore, renderHome 등)이
// 이미 준비되어 있어야 한다. (ES 모듈을 쓰지 않는 이유: file:// 프로토콜에서
// <script type="module">은 CORS로 막혀 화면이 아예 뜨지 않기 때문 — QMS 프로젝트와
// 동일한 "일반 스크립트 + window.X 전역 등록" 방식을 따른다.)
(function () {
  const NAV_ITEMS = [
    { path: '/home', label: '홈', icon: '🏠' },
    { path: '/schedule', label: '일정', icon: '🗓️' },
    { path: '/projects', label: '프로젝트', icon: '📁' },
    { path: '/challenges', label: '챌린저', icon: '🏆' },
    { path: '/briefing', label: '관심주제', icon: '📰' },
    { path: '/playlist', label: '문화생활', icon: '🎬' },
    { path: '/vehicles', label: '차량관리', icon: '🚗' },
    { path: '/health', label: 'Health', icon: '💪' },
    { path: '/devlog', label: 'Devlog', icon: '🛠️' },
    { path: '/knowledge', label: 'Knowledge', icon: '📓' },
    { path: '/career', label: '이력/경력', icon: '📋' },
    { path: '/automation', label: 'Automation', icon: '🤖' },
    { path: '/integrations', label: 'Integrations', icon: '🔗' },
    { path: '/analytics', label: '리포트', icon: '📊' },
    { path: '/programs', label: '프로그램', icon: '🧩' },
    { path: '/settings', label: '설정', icon: '⚙️' },
  ];

  // 설정 화면의 "커스텀 API 관리"가 메뉴 체크박스 목록을 만들 때 재사용한다.
  window.NAV_ITEMS = NAV_ITEMS;

  // 내비게이션 스타일(기본: 상단바). 설정 화면에서 바꾸고 새로고침하면 적용된다.
  // 'both'(기본: 좌측 사이드바 + 상단바) | 'top'(상단바만) | 'side'(사이드바만)
  window.getNavStyle = () => { const v = window.settingsSync.get('workspace:navStyle'); return v === 'side' || v === 'top' ? v : 'both'; };

  window.applyTheme(window.settingsSync.get('workspace:theme') || 'auto');

  // 다른 기기에서 바꾼 설정이 로그인/새로고침 직후 원격에서 내려오면(settingsSync.load) 테마와
  // 사이드바 접힘 상태는 다시 그릴 필요 없이 바로 반영한다. 나머지(날씨 지역·위젯 순서 등)는
  // refreshAll()이 끝에서 내보내는 'change' 이벤트로 각 화면이 다시 그려지며 반영된다.
  window.settingsSync.onChange((keys) => {
    if (keys.includes('workspace:theme')) window.applyTheme(window.settingsSync.get('workspace:theme') || 'auto');
    if (keys.includes('workspace:sidebarCollapsed')) applySidebarCollapsed(window.settingsSync.get('workspace:sidebarCollapsed') === '1');
  });

  const app = document.getElementById('app');

  async function boot() {
    const store = window.getStore();
    const session = await store.getSession().catch(() => null);
    if (session?.pending) {
      // Supabase 세션은 있지만 아직 관리자 승인 전(회원가입 직후 등) — 앱에 들어가지 못하게
      // 막고, 승인 대기 화면을 보여준다. 승인 전에는 데이터에 접근시키지 않는다.
      // 남아있는 세션은 정리해서(로그아웃) 다음에도 같은 안내를 명확히 볼 수 있게 한다.
      await store.signOut().catch(() => {});
      showAuth({ pendingMessage: '아직 관리자 승인 대기 중입니다. 승인 후 다시 로그인해 주세요.' });
    } else if (session?.user) {
      await enterApp(session.user, { showBriefing: true });
    } else {
      showAuth();
    }
  }

  function showAuth({ pendingMessage } = {}) {
    app.innerHTML = '';
    const root = window.el('div', { id: 'auth-root' });
    app.append(root);
    window.renderAuthScreen(root, async (user) => {
      await enterApp(user, { showBriefing: true });
    });
    if (pendingMessage) window.toast(pendingMessage, 'error');
  }

  async function enterApp(user, { showBriefing }) {
    const appState = window.appState;
    appState.user = user;
    buildShell();
    await appState.refreshAll();

    let newAlerts = [];
    try {
      newAlerts = await appState.runAutomationNow();
    } catch (e) {
      console.warn('자동화 규칙 실행 실패(계속 진행):', e);
    }

    registerRoutes();
    window.startRouter();
    if (window.startMedReminder) window.startMedReminder(); // 복약 시간 알림(앱이 열려 있을 때만)
    updateNavBadge();
    appState.addEventListener('change', updateNavBadge);

    // 개인정보 보호를 위한 자동 로그아웃(세션 만료). 조작 없이 설정된 시간이 지나면 로그아웃한다.
    window.startSessionGuard(async () => {
      await window.getStore().signOut();
      window.toast('보안을 위해 자동 로그아웃되었습니다. 다시 로그인해 주세요.', 'error');
      location.hash = '';
      location.reload();
    });

    if (showBriefing) {
      const weather = await window.fetchWeatherSafe(window.getWeatherCities()[0]);
      const briefing = window.buildLoginBriefing({
        user,
        schedules: appState.schedules,
        projects: appState.projects,
        progressByProject: appState.progressByProject,
        newAlerts,
        weather,
      });
      window.showLoginBriefing(briefing);
    }
  }

  const SIDEBAR_COLLAPSED_KEY = 'workspace:sidebarCollapsed';
  let shellEl = null;
  let expandBtnEl = null;

  function applySidebarCollapsed(collapsed) {
    if (shellEl) shellEl.classList.toggle('app-shell--collapsed', collapsed);
    if (expandBtnEl) expandBtnEl.style.display = collapsed ? '' : 'none';
  }

  function buildShell() {
    const el = window.el;
    const appState = window.appState;
    app.innerHTML = '';
    const collapsed = window.settingsSync.get(SIDEBAR_COLLAPSED_KEY) === '1';
    const shell = el('div', { class: `app-shell ${collapsed ? 'app-shell--collapsed' : ''}` });

    // 좌측 상단 "나만의 Work Space" 클릭 시 어느 화면에서든 홈으로 이동.
    const brand = el('div', { class: 'brand', onclick: () => window.navigate('/home') }, [
      el('div', { class: 'brand__logo' }, '⌂'),
      el('div', {}, [el('div', { class: 'brand__title' }, '나만의 Work Space'), el('div', { class: 'brand__subtitle' }, window.CONFIG.version)]),
    ]);

    // v7.24.0: 내비게이션 스타일 — 'top'(Apple 스타일 상단바, 기본) | 'side'(기존 사이드바)
    const navStyle = window.getNavStyle();
    if (navStyle === 'top') { buildTopShell(); return; }
    document.body.classList.remove('nav-top');
    document.body.classList.toggle('nav-both', navStyle === 'both');
    const sidebar = el('aside', { class: 'sidebar' }, [
      el('div', { class: 'row row--between' }, [
        brand,
        el('button', { class: 'nm-btn nm-btn--icon sidebar-toggle sidebar-toggle--inline', title: '사이드바 숨기기', onclick: toggleSidebar }, '«'),
      ]),
      el(
        'ul',
        { class: 'nav-list' },
        NAV_ITEMS.map((item) =>
          el(
            'li',
            { class: 'nav-item', dataset: { path: item.path }, onclick: () => window.navigate(item.path) },
            [el('span', {}, item.icon), el('span', {}, item.label), el('span', { class: 'nav-item__badge hidden', dataset: { role: 'nav-badge', path: item.path } }, '0')]
          )
        )
      ),
      el('div', { class: 'sidebar-footer' }, [el('div', { class: 'user-chip' }, [el('span', {}, '👤'), el('span', {}, appState.user?.email || '')])]),
    ]);

    // 사이드바를 숨겼을 때 다시 펼치는 버튼(화면 좌상단 고정).
    const expandBtn = el('button', { class: 'nm-btn nm-btn--icon sidebar-toggle', title: '사이드바 펼치기', onclick: toggleSidebar }, '»');
    expandBtn.style.display = collapsed ? '' : 'none';

    const topbar = el('div', { class: 'topbar' }, [
      el('div', {}),
      el('div', { class: 'topbar__right' }, [
        el('span', { class: 'topbar__user' }, appState.user?.name || appState.user?.email || ''),
        el('button', { class: 'nm-btn nm-btn--danger', title: '로그아웃', onclick: logout }, '🚪 로그아웃'),
      ]),
    ]);
    const main = el('main', { class: 'main' }, [topbar, el('div', { id: 'view-root' })]);
    shell.append(sidebar, main);
    if (navStyle === 'both') app.append(makeApplebar());
    app.append(expandBtn, shell);
    shellEl = shell;
    expandBtnEl = expandBtn;

    async function logout() {
      if (!window.confirmDialog('로그아웃 하시겠습니까?')) return;
      await window.getStore().signOut();
      location.hash = '';
      location.reload();
    }

    function toggleSidebar() {
      const nowCollapsed = !shell.classList.contains('app-shell--collapsed');
      shell.classList.toggle('app-shell--collapsed', nowCollapsed);
      expandBtn.style.display = nowCollapsed ? '' : 'none';
      window.settingsSync.set(SIDEBAR_COLLAPSED_KEY, nowCollapsed ? '1' : '0');
    }
  }

  // ---- Apple 스타일 상단 navbar (v7.24.0) ----
  // 반투명 유리(backdrop blur) 고정 바 · 가운데 주요 메뉴 · "더보기" 패널(전체 메뉴 격자) · 오른쪽 검색(⌘K)/알림/사용자 메뉴.
  // 좁은 화면에서는 메뉴 버튼으로 전체 화면 목록이 열린다. 라우터는 .nav-item[data-path]의 active만 토글하므로 같은 클래스를 쓴다.
  const PRIMARY_NAV = ['/home', '/schedule', '/projects', '/challenges', '/health', '/knowledge', '/career'];
  function makeApplebar() {
    const el = window.el;
    const appState = window.appState;
    const go = (path) => { closeAll(); window.navigate(path); };
    const byPath = (p) => NAV_ITEMS.find((i) => i.path === p);
    const link = (item) => el('li', { class: 'nav-item applebar__link', dataset: { path: item.path }, onclick: () => go(item.path) }, [
      el('span', { class: 'applebar__icon', 'aria-hidden': 'true' }, item.icon), el('span', {}, item.label),
      el('span', { class: 'nav-item__badge hidden', dataset: { role: 'nav-badge', path: item.path } }, '0'),
    ]);

    const userPanel = el('div', { class: 'applebar__panel applebar__panel--user', role: 'menu', hidden: true }, [
      el('div', { class: 'applebar__user-name' }, appState.user?.name || appState.user?.email || ''),
      el('div', { class: 'text-muted', style: 'font-size:11px; margin-bottom:8px' }, window.CONFIG.version),
      el('button', { type: 'button', class: 'applebar__menu-item nav-item', dataset: { path: '/settings' }, role: 'menuitem', onclick: () => go('/settings') }, '⚙️ 설정'),
      el('button', { type: 'button', class: 'applebar__menu-item', role: 'menuitem', onclick: () => { closeAll(); logout(); } }, '🚪 로그아웃'),
    ]);
    const initial = (appState.user?.name || appState.user?.email || '?').trim().charAt(0).toUpperCase();
    const userBtn = el('button', { type: 'button', class: 'applebar__avatar', title: appState.user?.email || '', 'aria-haspopup': 'true', 'aria-expanded': 'false', onclick: (e) => { e.stopPropagation(); togglePanel(userPanel, userBtn); } }, initial);
    const searchBtn = el('button', { type: 'button', class: 'applebar__icon-btn', title: '빠른 이동 검색 (Ctrl/⌘ + K)', 'aria-label': '빠른 이동 검색', onclick: () => { closeAll(); openQuickFind(); } }, '🔍');
    const bellBtn = el('button', { type: 'button', class: 'applebar__icon-btn', title: '알림(홈에서 확인)', 'aria-label': '알림', onclick: () => go('/home') }, ['🔔', el('span', { class: 'applebar__bell-badge hidden', dataset: { role: 'bell-badge' } }, '0')]);
    const burger = el('button', { type: 'button', class: 'applebar__burger', 'aria-label': '메뉴 열기', 'aria-expanded': 'false', onclick: (e) => { e.stopPropagation(); const open = !header.classList.contains('applebar--open'); header.classList.toggle('applebar--open', open); burger.setAttribute('aria-expanded', String(open)); document.body.classList.toggle('applebar-lock', open); } }, [el('span', {}), el('span', {})]);

    const header = el('header', { class: 'applebar', role: 'banner' }, [
      el('div', { class: 'applebar__inner' }, [
        el('div', { class: 'applebar__brand', title: '홈으로', onclick: () => go('/home') }, [el('span', { class: 'applebar__logo' }, '⌂'), el('span', { class: 'applebar__brand-text' }, 'Work Space')]),
        el('nav', { class: 'applebar__nav', 'aria-label': '주요 메뉴' }, [
          el('ul', { class: 'applebar__list' }, NAV_ITEMS.map(link)), // v7.25.1: '더보기' 없이 모든 메뉴를 바로 보여준다
        ]),
        el('div', { class: 'applebar__actions' }, [searchBtn, bellBtn, el('div', { class: 'applebar__user-wrap' }, [userBtn, userPanel]), burger]),
      ]),
      // 좁은 화면용 전체 메뉴(햄버거)
      el('div', { class: 'applebar__sheet' }, [el('ul', { class: 'applebar__sheet-list' }, NAV_ITEMS.map(link))]),
    ]);

    function closeAll() {
      for (const [panel, btn] of [[userPanel, userBtn]]) { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
      header.classList.remove('applebar--open'); burger.setAttribute('aria-expanded', 'false'); document.body.classList.remove('applebar-lock');
    }
    function togglePanel(panel, btn) {
      const open = panel.hidden;
      closeAll();
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    }
    document.addEventListener('click', (e) => { if (!header.contains(e.target)) closeAll(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
    window.addEventListener('scroll', () => header.classList.toggle('applebar--scrolled', window.scrollY > 4), { passive: true });

    async function logout() {
      if (!window.confirmDialog('로그아웃 하시겠습니까?')) return;
      await window.getStore().signOut();
      location.hash = '';
      location.reload();
    }
    return header;
  }

  function buildTopShell() {
    const el = window.el;
    document.body.classList.add('nav-top');
    document.body.classList.remove('nav-both');
    const header = makeApplebar();
    const main = el('main', { class: 'main' }, [el('div', { id: 'view-root' })]);
    const shell = el('div', { class: 'app-shell app-shell--top' }, [main]);
    app.innerHTML = '';
    app.append(header, shell);
    shellEl = shell;
    expandBtnEl = null;
  }

  // ---- 빠른 이동 검색(Ctrl/⌘+K): 메뉴 + 일정/프로젝트/Knowledge 제목 ----
  function openQuickFind() {
    const el = window.el;
    const appState = window.appState;
    window.openModal({
      title: '빠른 이동',
      width: '560px',
      contentBuilder(body, close) {
        const input = el('input', { class: 'nm-input', placeholder: '메뉴·일정·프로젝트 검색  ·  "+내일 3시 회의"로 일정 바로 추가', autofocus: true, 'aria-label': '빠른 이동 검색' });
        const list = el('div', { class: 'quickfind-list', role: 'listbox' });
        const entries = () => [
          ...NAV_ITEMS.map((i) => ({ kind: '메뉴', label: `${i.icon} ${i.label}`, hay: i.label, go: () => window.navigate(i.path) })),
          ...appState.schedules.filter((x) => !x.done).slice(0, 300).map((x) => ({ kind: '일정', label: `🗓️ ${x.title}`, sub: x.date, hay: `${x.title} ${x.place || ''}`, go: () => window.navigate('/schedule') })),
          ...appState.projects.filter((x) => !x.deleted_at).map((x) => ({ kind: '프로젝트', label: `📁 ${x.name}`, hay: x.name, go: () => window.navigate('/projects') })),
          ...(appState.knowledgeDocs || []).slice(0, 300).map((x) => ({ kind: 'Knowledge', label: `📓 ${x.title}`, hay: `${x.title} ${(x.tags || []).join(' ')}`, go: () => window.navigate('/knowledge') })),
        ];
        let active = 0; let shown = [];
        function render() {
          const raw = input.value.trim();
          const q = raw.toLowerCase();
          shown = entries().filter((e) => !q || e.hay.toLowerCase().includes(q)).slice(0, 12);
          // v7.25.0: "+내일 오후 3시 회의" / "일정 모레 14:30 병원" → 바로 일정 등록
          if (/^[+＋]|^일정\s/.test(raw) && window.parseQuickSchedule) {
            const p = window.parseQuickSchedule(raw, window.todayISO());
            if (p) shown = [{ kind: '새 일정', label: `➕ 일정 추가: ${p.title}`, sub: `${p.date}${p.time ? ` ${p.time}` : ''}`, go: async () => { try { await appState.addSchedule({ title: p.title, date: p.date, time: p.time || null }); window.toast(`일정을 추가했어요 (${p.date}${p.time ? ` ${p.time}` : ''})`, 'success'); } catch (err) { window.toast(err.message || '일정 추가 실패', 'error'); } } }, ...shown].slice(0, 12);
          }
          active = Math.min(active, Math.max(0, shown.length - 1));
          list.replaceChildren(...(shown.length ? shown.map((e, i) => el('button', { type: 'button', role: 'option', class: `quickfind-item ${i === active ? 'is-active' : ''}`, onclick: () => { close(); e.go(); } }, [el('span', {}, e.label), el('span', { class: 'text-muted' }, [e.sub ? `${e.sub} · ` : '', e.kind])])) : [el('div', { class: 'text-muted', style: 'padding:10px' }, '결과가 없습니다.')]));
        }
        input.addEventListener('input', () => { active = 0; render(); });
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'ArrowDown') { ev.preventDefault(); active = Math.min(shown.length - 1, active + 1); render(); }
          else if (ev.key === 'ArrowUp') { ev.preventDefault(); active = Math.max(0, active - 1); render(); }
          else if (ev.key === 'Enter' && shown[active]) { ev.preventDefault(); close(); shown[active].go(); }
        });
        body.append(input, list);
        render();
        setTimeout(() => input.focus(), 30);
      },
    });
  }
  window.openQuickFind = openQuickFind;
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && document.querySelector('#view-root')) { e.preventDefault(); openQuickFind(); }
  });

  function updateNavBadge() {
    const unread = window.appState.notifications.filter((n) => !n.is_read).length;
    for (const badge of document.querySelectorAll('[data-role="nav-badge"][data-path="/home"], [data-role="bell-badge"]')) {
      badge.textContent = String(unread);
      badge.classList.toggle('hidden', unread === 0);
    }
  }

  function registerRoutes() {
    window.registerRoute('/home', window.renderHomeRoute);
    window.registerRoute('/schedule', window.renderSchedule);
    window.registerRoute('/projects', window.renderProjects);
    window.registerRoute('/challenges', window.renderChallenges);
    window.registerRoute('/briefing', window.renderBriefing);
    window.registerRoute('/playlist', window.renderPlaylist);
    window.registerRoute('/vehicles', window.renderVehicles);
    window.registerRoute('/health', window.renderHealth);
    window.registerRoute('/devlog', window.renderDevlog);
    window.registerRoute('/knowledge', window.renderKnowledge);
    window.registerRoute('/career', window.renderCareer);
    window.registerRoute('/automation', window.renderAutomation);
    window.registerRoute('/integrations', window.renderIntegrations);
    window.registerRoute('/analytics', window.renderAnalytics);
    window.registerRoute('/programs', window.renderPrograms);
    window.registerRoute('/settings', window.renderSettings);
  }

  // 벤치마킹 기능: Gmail/GitHub/Notion류 앱처럼 "/" 키로 현재 화면의 검색창에 바로 포커스한다.
  // 입력 중인 다른 필드에서는 동작하지 않도록(텍스트에 "/"를 치고 싶을 때) 막는다.
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
    const searchInput = document.querySelector('#view-root input[placeholder*="검색"]');
    if (searchInput) {
      e.preventDefault();
      searchInput.focus();
    }
  });

  boot();
})();
