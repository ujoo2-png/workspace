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
    { path: '/automation', label: 'Automation', icon: '🤖' },
    { path: '/integrations', label: 'Integrations', icon: '🔗' },
    { path: '/analytics', label: 'Analytics', icon: '📊' },
    { path: '/programs', label: '프로그램', icon: '🧩' },
    { path: '/settings', label: '설정', icon: '⚙️' },
  ];

  window.applyTheme(localStorage.getItem('workspace:theme') || 'auto');

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

  function buildShell() {
    const el = window.el;
    const appState = window.appState;
    app.innerHTML = '';
    const collapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
    const shell = el('div', { class: `app-shell ${collapsed ? 'app-shell--collapsed' : ''}` });

    // 좌측 상단 "나만의 Work Space" 클릭 시 어느 화면에서든 홈으로 이동.
    const brand = el('div', { class: 'brand', onclick: () => window.navigate('/home') }, [
      el('div', { class: 'brand__logo' }, '⌂'),
      el('div', {}, [el('div', { class: 'brand__title' }, '나만의 Work Space'), el('div', { class: 'brand__subtitle' }, window.CONFIG.version)]),
    ]);

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
    app.append(expandBtn, shell);

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
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, nowCollapsed ? '1' : '0');
    }
  }

  function updateNavBadge() {
    const unread = window.appState.notifications.filter((n) => !n.is_read).length;
    const badge = document.querySelector('[data-role="nav-badge"][data-path="/home"]');
    if (!badge) return;
    badge.textContent = String(unread);
    badge.classList.toggle('hidden', unread === 0);
  }

  function registerRoutes() {
    window.registerRoute('/home', window.renderHome);
    window.registerRoute('/schedule', window.renderSchedule);
    window.registerRoute('/projects', window.renderProjects);
    window.registerRoute('/challenges', window.renderChallenges);
    window.registerRoute('/briefing', window.renderBriefing);
    window.registerRoute('/playlist', window.renderPlaylist);
    window.registerRoute('/vehicles', window.renderVehicles);
    window.registerRoute('/health', window.renderHealth);
    window.registerRoute('/devlog', window.renderDevlog);
    window.registerRoute('/knowledge', window.renderKnowledge);
    window.registerRoute('/automation', window.renderAutomation);
    window.registerRoute('/integrations', window.renderIntegrations);
    window.registerRoute('/analytics', window.renderAnalytics);
    window.registerRoute('/programs', window.renderPrograms);
    window.registerRoute('/settings', window.renderSettings);
  }

  boot();
})();
