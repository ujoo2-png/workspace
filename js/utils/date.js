// 날짜 관련 순수 함수 모음. 테스트 가능하도록 부작용 없이 작성.
// 일반 <script>로 로드되므로 globalThis.* 전역 함수로 등록한다.
// globalThis를 쓰면 브라우저(window)와 Node(단위 테스트) 양쪽에서 동일하게 동작한다.
(function () {
  function todayISO(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function addDays(iso, days) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return todayISO(d);
  }

  // 날짜 문자열(YYYY-MM-DD) 사이의 정수 일수 차이 (b - a)
  function diffDays(aISO, bISO) {
    const a = new Date(aISO + 'T00:00:00');
    const b = new Date(bISO + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  }

  function isPast(iso, todayIso = todayISO()) {
    return diffDays(todayIso, iso) < 0;
  }

  function isWithin(iso, days, todayIso = todayISO()) {
    const d = diffDays(todayIso, iso);
    return d >= 0 && d <= days;
  }

  function weekdayIndex(iso) {
    return new Date(iso + 'T00:00:00').getDay(); // 0=일 ... 6=토
  }

  const WEEKDAY_LABEL_KO = ['일', '월', '화', '수', '목', '금', '토'];
  function weekdayLabel(iso) {
    return WEEKDAY_LABEL_KO[weekdayIndex(iso)];
  }

  function formatKoreanDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${y}.${m}.${d} (${weekdayLabel(iso)})`;
  }

  globalThis.todayISO = todayISO;
  globalThis.addDays = addDays;
  globalThis.diffDays = diffDays;
  globalThis.isPast = isPast;
  globalThis.isWithin = isWithin;
  globalThis.weekdayIndex = weekdayIndex;
  globalThis.weekdayLabel = weekdayLabel;
  globalThis.formatKoreanDate = formatKoreanDate;
})();
