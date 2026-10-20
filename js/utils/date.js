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

  // "매년 반복"용: 같은 월·일을 유지한 채 연도만 n년 올린다.
  // 365일 더하기와 달리 윤년/월말에 어긋나지 않는다. 예) 2024-03-01 → 2025-03-01.
  // 윤년 2/29처럼 대상 연도에 같은 날짜가 없으면 그 달의 마지막 날(2/28)로 보정한다.
  function shiftYear(iso, years) {
    if (!iso) return iso;
    const [y, m, day] = iso.split('-').map(Number);
    const targetYear = y + (years || 0);
    const lastDay = new Date(targetYear, m, 0).getDate(); // m월의 마지막 날 (1-based m 그대로 사용)
    const d = Math.min(day, lastDay);
    const pad = (n) => String(n).padStart(2, '0');
    return `${targetYear}-${pad(m)}-${pad(d)}`;
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
  globalThis.shiftYear = shiftYear;
  globalThis.diffDays = diffDays;
  globalThis.isPast = isPast;
  globalThis.isWithin = isWithin;
  globalThis.weekdayIndex = weekdayIndex;
  globalThis.weekdayLabel = weekdayLabel;
  globalThis.formatKoreanDate = formatKoreanDate;
})();
