// 복약 시간 알림(v7.19.0). 앱(탭)이 열려 있는 동안 1분마다 확인해, 오늘 복용 시각이 지났는데 체크하지 않은 약이
// 있으면 토스트(그리고 브라우저 알림 권한이 허용돼 있으면 시스템 알림)로 한 번만 알려준다.
//  - 앱을 닫아 두면 알림이 오지 않는다(서버 푸시가 아니라 이 탭 안의 타이머다).
//  - 같은 (날짜, 약, 시각)은 하루에 한 번만 알린다(기기 로컬 localStorage에 기록 — 동기화하지 않음).
//  - 로그인 직후 오래전에 지난 시각까지 몰아서 알리지 않도록, 시각이 지난 지 60분 이내인 것만 알린다.
//  - 설정 on/off는 Health 복약 카드의 "🔔 알림" 버튼(workspace:health:medReminder, 기기 간 동기화).
// 일반 <script>로 로드되며 js/predict.js, js/state.js가 먼저 로드되어야 한다.
(function () {
  const REMINDER_KEY = 'workspace:health:medReminder';
  const SENT_KEY = 'workspace:medReminder:sent';
  const MAX_LATE_MIN = 60;
  let timer = null;

  function loadSent(today) {
    try {
      const o = JSON.parse(localStorage.getItem(SENT_KEY) || '{}');
      return o.date === today ? new Set(o.keys || []) : new Set();
    } catch { return new Set(); }
  }
  function saveSent(today, set) {
    try { localStorage.setItem(SENT_KEY, JSON.stringify({ date: today, keys: [...set] })); } catch { /* 저장 불가여도 알림 동작엔 영향 없음 */ }
  }

  function check() {
    const appState = window.appState;
    if (!appState?.user) return;
    if (window.settingsSync.get(REMINDER_KEY) === '0') return;
    const d = new Date();
    const today = window.todayISO(d);
    const now = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const due = window.overdueDosesNow(appState.healthMedications, appState.healthMedLogs, today, now, 0, MAX_LATE_MIN);
    if (!due.length) return;
    const sent = loadSent(today);
    const fresh = due.filter((x) => !sent.has(`${x.med.id}|${x.slot}`));
    if (!fresh.length) return;
    for (const x of fresh) sent.add(`${x.med.id}|${x.slot}`);
    saveSent(today, sent);
    const text = fresh.map((x) => `${x.slot} ${x.med.name}`).join(', ');
    window.toast(`💊 복약 시간이 지났어요: ${text}`, 'info');
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('복약 시간', { body: text });
      }
    } catch { /* 일부 환경(모바일 등)은 new Notification이 막혀 있다 — 토스트만 사용 */ }
  }

  function startMedReminder() {
    if (timer) return;
    check();
    timer = setInterval(check, 60 * 1000);
  }
  function stopMedReminder() { clearInterval(timer); timer = null; }

  window.startMedReminder = startMedReminder;
  window.stopMedReminder = stopMedReminder;
  window.checkMedReminderNow = check; // 테스트/수동 확인용
})();
