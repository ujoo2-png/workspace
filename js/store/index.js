// 설정(CONFIG.mode)에 따라 LocalStore 또는 SupabaseStore 싱글턴을 돌려준다.
// 일반 <script>로 로드되며 js/config.js, js/store/localStore.js, js/store/supabaseStore.js가
// 먼저 로드되어 있어야 한다(window.CONFIG / window.LocalStore / window.SupabaseStore).
(function () {
  let _store = null;

  function getStore() {
    if (_store) return _store;
    const CONFIG = window.CONFIG;
    if (CONFIG.mode === 'supabase') {
      _store = new window.SupabaseStore({ url: CONFIG.supabaseUrl, anonKey: CONFIG.supabaseAnonKey });
    } else {
      _store = new window.LocalStore();
    }
    return _store;
  }

  window.getStore = getStore;
})();
