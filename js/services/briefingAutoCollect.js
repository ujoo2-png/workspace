// 브리핑 자동 수집 (v7.24.0, 아이디어 1).
// 지금까지는 "지금 가져오기"를 눌러야만 새 글을 모았다. 이 서비스는 로그인 직후(앱 진입 시)에
// 조용히 한 번 수집하고, 새 항목이 있으면 알림 1건으로 요약해 준다.
//
// 원칙:
//   · 설정에서 끌 수 있다(기본 켜짐). 사용자 설정은 기기 간 동기화된다.
//   · 하루에 한 번만 실행한다(같은 날 다시 로그인해도 반복 수집하지 않음 — 무료 프록시 호출 보호).
//   · 실패해도 앱 진입을 막지 않는다(로그만 남기고 조용히 넘어간다).
//   · 파괴적 동작이 없다: 수집·읽음 처리 외에는 아무것도 하지 않는다.
// 일반 <script>로 로드된다.
(function () {
  const ENABLED_KEY = 'workspace:briefing:autoCollect';
  const LAST_RUN_KEY = 'workspace:briefing:autoCollectLastRun'; // 'YYYY-MM-DD'
  const LAST_COUNT_KEY = 'workspace:briefing:autoCollectLastCount';

  const settingsGet = (k) => (window.settingsSync ? window.settingsSync.get(k) : null);
  const settingsSet = (k, v) => (window.settingsSync ? window.settingsSync.set(k, v) : null);

  /** 자동 수집 사용 여부(기본 켜짐). */
  function isAutoCollectEnabled() {
    const raw = settingsGet(ENABLED_KEY);
    return raw === null || raw === undefined || raw === '' ? true : raw === '1' || raw === 'true';
  }
  function setAutoCollectEnabled(on) { settingsSet(ENABLED_KEY, on ? '1' : '0'); }

  const todayKey = () => new Date().toLocaleDateString('sv-SE');
  function autoCollectedToday() { return settingsGet(LAST_RUN_KEY) === todayKey(); }

  /**
   * 로그인 직후 호출한다. 오늘 아직 안 돌았고 설정이 켜져 있으면 한 번 수집한다.
   * @returns {Promise<{ran:boolean, newCount:number, reason?:string}>}
   */
  async function autoCollectBriefing() {
    if (!isAutoCollectEnabled()) return { ran: false, newCount: 0, reason: 'disabled' };
    const appState = window.appState;
    if (!appState || !appState.user) return { ran: false, newCount: 0, reason: 'no-user' };
    if (autoCollectedToday()) return { ran: false, newCount: 0, reason: 'already-today' };
    // 수집할 소스/주제가 없으면 조용히 넘어간다(빈 상태에서 토스트/알림을 만들지 않음).
    const hasSources = appState.feedSources.some((s) => s.enabled !== false && s.type !== 'crawl' && s.type !== 'api');
    const hasTopics = appState.briefingTopics.some((t) => t.active !== false && ((t.search_terms || []).length || (t.site_urls || []).length));
    if (!hasSources && !hasTopics) return { ran: false, newCount: 0, reason: 'nothing-to-collect' };

    // 실행 시각을 먼저 기록해, 수집이 실패해도 같은 날 재시도 폭주를 막는다.
    settingsSet(LAST_RUN_KEY, todayKey());
    let result;
    try {
      result = await appState.collectBriefingItems();
    } catch (e) {
      console.warn('브리핑 자동 수집 실패:', e);
      return { ran: true, newCount: 0, reason: 'error' };
    }
    const newCount = result?.newCount || 0;
    settingsSet(LAST_COUNT_KEY, String(newCount));
    if (newCount > 0) {
      // 알림 1건으로 요약한다(dedupe_key에 날짜를 넣어 하루에 한 번만 생성).
      try {
        await appState.store.create('notifications', {
          user_id: appState.user.id,
          type: 'briefing_new_items',
          severity: 'info',
          title: `관심주제 새 글 ${newCount}건`,
          message: '브리핑 목록에서 확인해 보세요.',
          related_table: 'briefing_items',
          related_id: null,
          dedupe_key: `briefing_auto_${todayKey()}`,
          is_read: false,
        });
        await appState.refreshAll();
      } catch (e) {
        console.warn('브리핑 알림 생성 실패(무시):', e);
      }
    }
    return { ran: true, newCount, reason: 'ok' };
  }

  Object.assign(window, {
    autoCollectBriefing, isAutoCollectEnabled, setAutoCollectEnabled,
    BRIEFING_AUTO_KEYS: { ENABLED_KEY, LAST_RUN_KEY, LAST_COUNT_KEY },
  });
})();
