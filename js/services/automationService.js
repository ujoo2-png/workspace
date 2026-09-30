// 저장소(store)와 규칙 엔진(rules.js)을 잇는 서비스.
// "재실행해도 중복 알림 생성 금지" 원칙을 dedupe_key unique 제약(로컬은 애플리케이션 레벨,
// Supabase는 DB unique 제약)으로 지킨다.
// 일반 <script>로 로드되며 js/rules.js, js/config.js, js/utils/date.js가 먼저 로드되어 있어야 한다.
(function () {
  const { runAutomationRules, todayISO } = window;

  /**
   * 규칙을 실행하고, 아직 생성되지 않은 알림만 notifications 테이블에 추가한다.
   * @param {object} data projects, schedules, vehicles(선택), challenges(선택, checkins 포함)
   * @param {object|null} enabledRules Automation 화면에서 저장한 사용자별 on/off·파라미터
   * @returns {object[]} 이번 실행에서 새로 생성된 알림들
   */
  async function runAndPersistAutomation(store, userId, { projects, schedules, vehicles = [], challenges = [], playlistItems = [] }, enabledRules = null) {
    const CONFIG = window.CONFIG;
    const candidates = runAutomationRules({ projects, schedules, vehicles, challenges, playlistItems }, CONFIG.automation, todayISO(), enabledRules);
    const existing = await store.list('notifications', { where: { user_id: userId } }).catch(() => []);
    const existingKeys = new Set(existing.map((n) => n.dedupe_key));

    const created = [];
    for (const c of candidates) {
      if (existingKeys.has(c.dedupeKey)) continue;
      const row = await store.create('notifications', {
        user_id: userId,
        type: c.type,
        severity: c.severity,
        title: c.title,
        message: c.message,
        related_table: c.relatedTable,
        related_id: c.relatedId,
        dedupe_key: c.dedupeKey,
        is_read: false,
      });
      created.push(row);
      await store
        .create('automation_logs', {
          user_id: userId,
          rule_type: c.type,
          dedupe_key: c.dedupeKey,
          result: 'created',
        })
        .catch(() => {}); // 로컬 모드에서 테이블이 없어도 앱이 죽지 않게 방어
    }
    return created;
  }

  window.runAndPersistAutomation = runAndPersistAutomation;
})();
