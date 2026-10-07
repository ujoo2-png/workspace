// 이력/경력 순수 로직 (v7.22.0) — 부작용 없는 함수만 둔다(Node 단위 테스트 대상).
//   · 날짜 표기 5종(양식 문서의 "날짜 형식" 선택) + 기간 문구
//   · 총 경력 기간(겹치는 기간은 구간 합집합으로 한 번만 계산)
//   · 자격증 유효기간 상태(만료/임박)
//   · 경력기술서 자동 문안
// 일반 <script>로 로드되면 window.CareerLogic로 등록된다.
(function () {
  const DATE_FORMATS = [
    { id: 'YYYY-MM-DD', label: '2026-03-05', sample: '2026-03-05' },
    { id: 'YYYY.MM.DD', label: '2026.03.05', sample: '2026.03.05' },
    { id: 'YYYY년 M월 D일', label: '2026년 3월 5일', sample: '2026년 3월 5일' },
    { id: 'YYYY.MM', label: '2026.03 (연월만)', sample: '2026.03' },
    { id: 'YYYY-MM', label: '2026-03 (연월만)', sample: '2026-03' },
  ];
  const DEFAULT_DATE_FORMAT = 'YYYY-MM-DD';

  function parseISO(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return null;
    const y = +m[1];
    const mo = +m[2];
    const d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { y, m: mo, d };
  }

  function formatDate(iso, fmt = DEFAULT_DATE_FORMAT) {
    const p = parseISO(iso);
    if (!p) return '';
    const mm = String(p.m).padStart(2, '0');
    const dd = String(p.d).padStart(2, '0');
    switch (fmt) {
      case 'YYYY.MM.DD': return `${p.y}.${mm}.${dd}`;
      case 'YYYY년 M월 D일': return `${p.y}년 ${p.m}월 ${p.d}일`;
      case 'YYYY.MM': return `${p.y}.${mm}`;
      case 'YYYY-MM': return `${p.y}-${mm}`;
      default: return `${p.y}-${mm}-${dd}`;
    }
  }

  /** "2020.03.02 ~ 2023.05.31" — 종료일이 없으면 openLabel(기본 '현재'). 시작도 종료도 없으면 ''. */
  function periodText(start, end, fmt = DEFAULT_DATE_FORMAT, openLabel = '현재') {
    const a = formatDate(start, fmt);
    const b = formatDate(end, fmt);
    if (!a && !b) return '';
    if (a && !b) return openLabel ? `${a} ~ ${openLabel}` : `${a} ~`;
    if (!a && b) return `~ ${b}`;
    return `${a} ~ ${b}`;
  }

  // ---- 총 경력 기간 ----
  const DAY = 86400000;
  const utcDay = (p) => Date.UTC(p.y, p.m - 1, p.d);
  function addMonthsClamped(ms, n) {
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + n;
    const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return Date.UTC(y, m, Math.min(d.getUTCDate(), dim));
  }

  /**
   * 경력 목록의 총 기간. 겹치는/맞닿은 기간은 합집합으로 한 번만 센다(예: 겸직·이직 직후 날짜 중복).
   * 각 합쳐진 구간은 [시작, 종료] 양끝 포함으로 보고 달력상 개월 수 + 남은 일수로 계산하며,
   * 남은 일수는 모두 모아 30일 = 1개월로 환산한다(나머지 일수는 버림).
   * 퇴사일이 없으면 todayIso까지(재직중). 시작일이 없거나 종료<시작인 항목은 제외한다.
   */
  function totalExperience(experiences, todayIso) {
    const today = parseISO(todayIso);
    const spans = [];
    for (const e of experiences || []) {
      const s = parseISO(e.start_date);
      if (!s) continue;
      const en = parseISO(e.end_date) || today;
      if (!en) continue;
      const a = utcDay(s);
      const b = utcDay(en);
      if (b < a) continue;
      spans.push([a, b]);
    }
    spans.sort((x, y) => x[0] - y[0]);
    const merged = [];
    for (const sp of spans) {
      const last = merged[merged.length - 1];
      if (last && sp[0] <= last[1] + DAY) last[1] = Math.max(last[1], sp[1]);
      else merged.push(sp.slice());
    }
    let months = 0;
    let days = 0;
    for (const [a, b] of merged) {
      const t = b + DAY; // 종료일 다음날(배타)
      const da = new Date(a);
      const dt = new Date(t);
      let mo = (dt.getUTCFullYear() - da.getUTCFullYear()) * 12 + (dt.getUTCMonth() - da.getUTCMonth());
      if (dt.getUTCDate() < da.getUTCDate()) mo -= 1;
      const anchor = addMonthsClamped(a, mo);
      months += mo;
      days += Math.round((t - anchor) / DAY);
    }
    months += Math.floor(days / 30);
    const remDays = days % 30;
    const years = Math.floor(months / 12);
    const remMonths = months % 12;
    return {
      months, years, remMonths, remDays, intervals: merged.length, count: spans.length,
      text: durationText(months),
    };
  }
  function durationText(months) {
    if (!months || months < 1) return '1개월 미만';
    const y = Math.floor(months / 12);
    const m = months % 12;
    if (y && m) return `${y}년 ${m}개월`;
    if (y) return `${y}년`;
    return `${m}개월`;
  }
  /** 단일 경력 항목의 기간("3년 2개월"). 종료일 없으면 오늘까지. */
  function itemDuration(rec, todayIso) {
    return totalExperience([rec], todayIso).text;
  }

  // ---- 자격증 유효기간 ----
  /** state: 'none'(유효기간 없음) | 'expired' | 'soon'(warnDays 이내) | 'ok'. days = 오늘→만료일 일수(음수면 지남). */
  function certExpiryStatus(cert, todayIso, warnDays = 90) {
    const e = parseISO(cert && cert.expiry_date);
    const t = parseISO(todayIso);
    if (!e || !t) return { state: 'none', days: null };
    const days = Math.round((utcDay(e) - utcDay(t)) / DAY);
    if (days < 0) return { state: 'expired', days };
    if (days <= warnDays) return { state: 'soon', days };
    return { state: 'ok', days };
  }
  function expiryLabel(st) {
    if (st.state === 'expired') return `만료됨 (${-st.days}일 지남)`;
    if (st.state === 'soon') return st.days === 0 ? '오늘 만료' : `만료 ${st.days}일 전`;
    return '';
  }

  // ---- 경력기술서 자동 문안 ----
  /** 경력 항목들로 경력기술서 초안 텍스트를 만든다(사용자가 이어서 편집). order: 'asc'(과거→현재) | 'desc'. */
  function careerNarrative(experiences, { order = 'desc', fmt = 'YYYY.MM', todayIso } = {}) {
    const list = sortByDate(experiences, 'start_date', order);
    if (!list.length) return '';
    const total = totalExperience(list, todayIso);
    const lines = [`총 경력 ${total.text} (겹치는 기간은 한 번만 계산)`, ''];
    list.forEach((e, i) => {
      const period = periodText(e.start_date, e.end_date, fmt, '현재');
      const dur = e.start_date ? itemDuration(e, todayIso) : '';
      lines.push(`${i + 1}. ${e.company_name}${period ? ` | ${period}` : ''}${dur ? ` (${dur})` : ''}`);
      const meta = [e.department_position, e.employment_type].filter(Boolean).join(' · ');
      if (meta) lines.push(`   - 소속/직책: ${meta}`);
      if (e.note && String(e.note).trim()) {
        String(e.note).trim().split(/\r?\n/).forEach((ln) => lines.push(`   - ${ln.replace(/^[-•·\s]+/, '')}`));
      }
      lines.push('');
    });
    return lines.join('\n').trim();
  }

  /** key 날짜 기준 정렬. 날짜 없는 항목은 방향과 무관하게 맨 뒤(등록 순서 유지). */
  function sortByDate(rows, key, order = 'asc', fallbackKey) {
    const keyOf = (r) => (r[key] || (fallbackKey ? r[fallbackKey] : '') || '');
    const dated = [];
    const undated = [];
    (rows || []).forEach((r, i) => (keyOf(r) ? dated : undated).push({ r, i }));
    dated.sort((a, b) => {
      const c = String(keyOf(a.r)).localeCompare(String(keyOf(b.r)));
      return (order === 'desc' ? -c : c) || a.i - b.i;
    });
    undated.sort((a, b) => (a.r.sort_order || 0) - (b.r.sort_order || 0) || a.i - b.i);
    return dated.concat(undated).map((x) => x.r);
  }

  const api = { DATE_FORMATS, DEFAULT_DATE_FORMAT, parseISO, formatDate, periodText, totalExperience, durationText, itemDuration, certExpiryStatus, expiryLabel, careerNarrative, sortByDate };
  globalThis.CareerLogic = api;
  if (typeof window !== 'undefined') window.CareerLogic = api;
})();
