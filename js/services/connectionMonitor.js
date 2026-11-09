// 연결 관제 (v7.36.0) — 로그인 시 한 번(그리고 [다시 점검] 때) api / 서버 프록시 / DB / 외부 서비스 상태를 모아 홈에 간단히 보고한다.
// 원칙: ① 유료·쿼터가 있는 외부 API를 일부러 두드리지 않는다(저장된 연결 상태와 키 유무를 읽는다)
//       ② 우리 서버리스 프록시(/api/*)는 인자 없이 가볍게 호출해 "배포되어 살아 있는지"만 본다
//       ③ 결과는 5분 캐시 — 홈을 다시 열 때마다 재점검하지 않는다.
// 일반 <script>, window.ConnectionMonitor. 순수 판정(classifyProxy/summarize)은 테스트 가능.
(function () {
  const TTL = 5 * 60 * 1000;
  let cache = null; // {at, items}
  let running = null;

  /** 인자 없이 호출한 프록시의 응답 → 상태. 404=미배포, 5xx=서버 오류, 그 외(400/405 포함)=함수가 살아 있음. */
  function classifyProxy(status, ms) {
    if (status === 404) return { state: 'error', msg: '배포에 포함되지 않았습니다(404) — api 폴더를 올렸는지 확인하세요' };
    if (status >= 500) return { state: 'error', msg: `서버 오류(HTTP ${status})` };
    if (status === 0) return { state: 'error', msg: '응답 없음(네트워크)' };
    return { state: ms > 4000 ? 'warn' : 'ok', msg: ms > 4000 ? `느림(${(ms / 1000).toFixed(1)}초)` : `정상(${ms}ms)` };
  }
  function summarize(items) {
    const c = { ok: 0, warn: 0, error: 0, off: 0 };
    for (const i of items) c[i.state] = (c[i.state] || 0) + 1;
    const worst = c.error ? 'error' : c.warn ? 'warn' : 'ok';
    return { ...c, worst, total: items.length };
  }

  async function pingProxy(path) {
    const t0 = Date.now();
    try {
      const res = await fetch(path, { signal: AbortSignal.timeout(6000) });
      return classifyProxy(res.status, Date.now() - t0);
    } catch (e) { return classifyProxy(0, Date.now() - t0); }
  }
  const has = (k) => { try { return !!(window.settingsSync && window.settingsSync.get(k)); } catch (e) { return false; } };

  async function run({ force = false } = {}) {
    if (!force && cache && Date.now() - cache.at < TTL) return cache;
    if (running) return running;
    running = (async () => {
      const items = [];
      const add = (group, name, state, msg, fix) => items.push({ group, name, state, msg, fix: fix || null });
      const CONFIG = window.CONFIG || {};
      // 1) DB
      if (CONFIG.mode === 'supabase') {
        const t0 = Date.now();
        try { await Promise.race([window.getStore().getSession(), new Promise((_, rej) => setTimeout(() => rej(new Error('시간 초과')), 6000))]); add('DB', 'Supabase', 'ok', `연결됨(${Date.now() - t0}ms)`); }
        catch (e) { add('DB', 'Supabase', 'error', `연결 오류: ${e.message || e}`, '/settings'); }
      } else add('DB', '로컬 모드', 'warn', '이 브라우저에만 저장됩니다', '/settings');
      // 2) 서버리스 프록시(우리 서버)
      const proxies = [['custom-proxy', '피드·커스텀 API 프록시'], ['market-proxy', '시세·환율 프록시'], ['dart-proxy', 'DART 프록시']];
      const res = await Promise.all(proxies.map(([p]) => pingProxy(`/api/${p}`)));
      proxies.forEach(([p, label], i) => add('서버', label, res[i].state, res[i].msg, res[i].state === 'error' ? '/settings' : null));
      // 3) 외부 서비스 — 키 유무 + 저장된 마지막 연결 상태(호출 없음)
      const KEYS = [['공공데이터포털 키', 'workspace:publicData:dataGoKrKey'], ['DART 키', 'workspace:stocks:dartKey']];
      for (const [name, k] of KEYS) add('외부', name, has(k) ? 'ok' : 'off', has(k) ? '입력됨' : '미설정', has(k) ? null : '/settings');
      try {
        const ts = window.getTmdbStatus ? window.getTmdbStatus() : 'unset';
        add('외부', '문화생활(TMDB) API', ts === 'connected' ? 'ok' : ts === 'error' ? 'error' : 'off', ts === 'connected' ? '연결됨' : ts === 'error' ? '연결 오류' : '미설정', ts === 'connected' ? null : '/settings');
      } catch (e) { /* 무시 */ }
      // 4) 커스텀 API(저장된 상태)
      try {
        const apis = (window.listCustomApis && window.listCustomApis()) || [];
        for (const a of apis) {
          const st = window.getCustomApiStatus(a.id);
          const map = { connected: 'ok', unstable: 'warn', error: 'error', unset: 'off' };
          add('API', a.name || a.id, map[st.state] || 'off', st.state === 'unset' ? '아직 호출한 적 없음' : (st.message || (window.CUSTOM_API_STATUS_META[st.state] || {}).label || ''), '/settings');
        }
      } catch (e) { /* 무시 */ }
      // 5) 피드 소스 건강도(이력 기반)
      try {
        const FD = window.FeedDiag; const srcs = ((window.appState && window.appState.feedSources) || []).filter((s) => s.enabled !== false);
        if (FD && srcs.length) {
          const sums = srcs.map((s) => ({ s, st: FD.summary(s) }));
          const bad = sums.filter((x) => FD.needsAttention(x.st));
          add('피드', `피드·API 소스 ${srcs.length}개`, bad.length ? (bad.length === srcs.length ? 'error' : 'warn') : 'ok', bad.length ? `${bad.length}개 확인 필요: ${bad.slice(0, 3).map((x) => x.s.name).join(', ')}${bad.length > 3 ? '…' : ''}` : '모두 정상(또는 미실행)', '/briefing');
        }
      } catch (e) { /* 무시 */ }
      cache = { at: Date.now(), items, summary: summarize(items) };
      return cache;
    })();
    try { return await running; } finally { running = null; }
  }
  const last = () => cache;
  window.ConnectionMonitor = { run, last, classifyProxy, summarize, TTL };
})();
