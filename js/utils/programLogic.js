// 프로그램 메뉴 순수 로직(v7.21.0) — 화면 코드에서 분리해 Node 테스트로 검증한다.
(function () {
  const PROGRAM_TYPES = ['web', 'mobile', 'widget', 'web_mobile'];

  /**
   * 사용자가 입력한 URL을 DB 제약(`^https?://`)에 맞게 정리한다.
   *  - 앞뒤 공백 제거, 스킴이 없으면 https:// 를 붙인다("example.com/w" → "https://example.com/w").
   *  - http/https 외의 스킴(ftp://, javascript:, intent:// …)은 거부한다.
   * @returns {{ok:boolean, url:string, error:string|null}}
   */
  function normalizeProgramUrl(input) {
    const raw = String(input ?? '').trim();
    if (!raw) return { ok: false, url: '', error: 'URL을 입력해 주세요.' };
    let candidate = raw;
    const badScheme = 'http:// 또는 https:// 주소만 사용할 수 있습니다.';
    if (/^https?:\/\//i.test(raw)) candidate = raw;
    else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^(javascript|data|mailto|tel|file|blob|about|intent):/i.test(raw)) return { ok: false, url: raw, error: badScheme };
    else candidate = `https://${raw.replace(/^\/+/, '')}`; // 스킴 없음("example.com/w", "localhost:3000")
    let u;
    try { u = new URL(candidate); } catch { return { ok: false, url: raw, error: 'URL 형식이 올바르지 않습니다. 예: https://my-widget.vercel.app' }; }
    if (!u.hostname || (!u.hostname.includes('.') && u.hostname !== 'localhost' && !/^\[.*\]$/.test(u.hostname))) {
      return { ok: false, url: raw, error: '도메인을 확인해 주세요. 예: https://my-widget.vercel.app' };
    }
    return { ok: true, url: candidate, error: null };
  }

  /** 프로그램 등록/수정 입력 검증. 필드별 오류 메시지를 돌려준다(없으면 errors는 빈 객체). */
  function validateProgramInput({ name, url, program_type }) {
    const errors = {};
    if (!String(name ?? '').trim()) errors.name = '이름을 입력해 주세요.';
    if (!PROGRAM_TYPES.includes(program_type)) errors.program_type = '유형을 선택해 주세요.';
    const u = normalizeProgramUrl(url);
    if (!u.ok) errors.url = u.error;
    return { ok: !Object.keys(errors).length, errors, url: u.ok ? u.url : null };
  }

  /** 마지막 배포일: vercel 작업일 → 없으면 github 작업일. YYYY-MM-DD 또는 null. */
  function lastDeployedDate(pipeline) {
    const p = pipeline || {};
    return (p.vercel && p.vercel.date) || (p.github && p.github.date) || null;
  }
  function daysBetweenISO(a, b) {
    const [y1, m1, d1] = a.split('-').map(Number);
    const [y2, m2, d2] = b.split('-').map(Number);
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
  }
  /** "오늘 배포 / 3일 전 배포 / 2개월 전 배포" 같은 짧은 라벨. 날짜가 없거나 미래면 날짜 그대로. */
  function deployedBadge(pipeline, todayIso) {
    const d = lastDeployedDate(pipeline);
    if (!d) return null;
    const n = daysBetweenISO(d, todayIso);
    if (n < 0) return { text: `배포 예정 ${d}`, days: n, stale: false };
    if (n === 0) return { text: '오늘 배포', days: 0, stale: false };
    if (n < 31) return { text: `${n}일 전 배포`, days: n, stale: false };
    if (n < 365) return { text: `${Math.floor(n / 30)}개월 전 배포`, days: n, stale: n > 180 };
    return { text: `${Math.floor(n / 365)}년 전 배포`, days: n, stale: true };
  }

  /** 중복 판정용 URL 키: 스킴/www/해시/끝 슬래시/utm_*·fbclid 등 추적 파라미터를 무시한다. 잘못된 URL이면 null. */
  function urlKey(input) {
    const raw = String(input ?? '').trim();
    if (!raw) return null;
    let u;
    try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
    if (!u.hostname || !u.hostname.includes('.')) return null;
    const keep = [...u.searchParams.entries()].filter(([k]) => !/^(utm_|fbclid$|gclid$|ref$)/i.test(k)).sort(([a], [b]) => (a < b ? -1 : 1));
    const q = keep.length ? `?${keep.map(([k, v]) => `${k}=${v}`).join('&')}` : '';
    return `${u.hostname.toLowerCase().replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${q}`;
  }
  /** docs 중 같은 링크를 가진 첫 항목(자기 자신 excludeId 제외). */
  function findDuplicateUrl(url, docs, excludeId = null) {
    const key = urlKey(url);
    if (!key) return null;
    return (docs || []).find((d) => d && d.id !== excludeId && !d.deleted_at && urlKey(d.url) === key) || null;
  }

  window.urlKey = urlKey;
  window.findDuplicateUrl = findDuplicateUrl;
  window.normalizeProgramUrl = normalizeProgramUrl;
  window.validateProgramInput = validateProgramInput;
  window.lastDeployedDate = lastDeployedDate;
  window.deployedBadge = deployedBadge;
})();
