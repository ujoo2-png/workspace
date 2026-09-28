// 세션 만료(자동 로그아웃) 가드. 개인정보(Health/차량/일정 등)를 다루는 앱이므로
// 로그인 후 일정 시간 조작이 없으면 자동으로 로그아웃시킨다(개발계획서 5장 "계정" 보안 통제).
// 일반 <script>로 로드되며 js/config.js가 먼저 로드되어 있어야 한다.
(function () {
  let timer = null;
  let warnTimer = null;
  let active = false;

  const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];

  function startSessionGuard(onExpire) {
    const minutes = window.CONFIG.sessionIdleTimeoutMinutes;
    if (!minutes || minutes <= 0) return; // 0이면 비활성화
    if (active) stopSessionGuard();
    active = true;
    const reset = () => scheduleTimers(minutes, onExpire);
    ACTIVITY_EVENTS.forEach((evt) => document.addEventListener(evt, reset, { passive: true }));
    reset();
    // 이벤트 해제용으로 보관
    startSessionGuard._reset = reset;
  }

  function scheduleTimers(minutes, onExpire) {
    clearTimeout(timer);
    clearTimeout(warnTimer);
    // 만료 1분 전에 토스트로 미리 안내(개인정보 보호 목적의 자동 로그아웃임을 알림).
    const warnMs = Math.max(0, (minutes - 1) * 60 * 1000);
    warnTimer = setTimeout(() => {
      window.toast?.('1분 후 자동 로그아웃됩니다(보안을 위한 세션 만료).');
    }, warnMs);
    timer = setTimeout(() => {
      stopSessionGuard();
      onExpire();
    }, minutes * 60 * 1000);
  }

  function stopSessionGuard() {
    clearTimeout(timer);
    clearTimeout(warnTimer);
    if (startSessionGuard._reset) {
      ACTIVITY_EVENTS.forEach((evt) => document.removeEventListener(evt, startSessionGuard._reset));
    }
    active = false;
  }

  window.startSessionGuard = startSessionGuard;
  window.stopSessionGuard = stopSessionGuard;
})();
