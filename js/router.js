// 아주 작은 해시 라우터. 일반 <script>로 로드된다.
(function () {
  const routes = new Map();
  let currentUnmount = null;

  function registerRoute(path, renderFn) {
    routes.set(path, renderFn);
  }

  function navigate(path) {
    if (location.hash !== `#${path}`) location.hash = `#${path}`;
    else render();
  }

  function currentPath() {
    const hash = location.hash.replace(/^#/, '');
    return hash || '/home';
  }

  async function render() {
    const path = currentPath();
    const view = routes.get(path) || routes.get('/home');
    const root = document.getElementById('view-root');
    if (!root) return;

    if (typeof currentUnmount === 'function') {
      try {
        currentUnmount();
      } catch (e) {
        console.warn('이전 화면 정리 중 오류', e);
      }
      currentUnmount = null;
    }

    root.innerHTML = '';
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('nav-item--active', n.dataset.path === path));

    const result = await view(root);
    if (typeof result === 'function') currentUnmount = result;
  }

  function startRouter() {
    window.addEventListener('hashchange', render);
    render();
  }

  window.registerRoute = registerRoute;
  window.navigate = navigate;
  window.startRouter = startRouter;
})();
