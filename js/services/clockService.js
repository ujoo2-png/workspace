// 홈 화면 "여러 도시 시계" 위젯. js/services/briefingService.js의 날씨 지역 관리와 동일한
// 패턴(localStorage에 등록 목록 저장, 기본값 + 프리셋에서 추가)을 시간대에 적용한 것이다.
// 일반 <script>로 로드된다.
(function () {
  const CLOCK_ZONES_KEY = 'workspace:clockTimezones';
  const DEFAULT_ZONE = { id: 'Asia/Seoul', label: '대한민국' };
  const MAX_EXTRA_ZONES = 2; // 기본(대한민국) 1개 + 추가 최대 2개 = 최대 3개

  // 시계 위젯에서 고를 수 있는 프리셋(도시 표기명 + IANA 타임존 ID).
  const CLOCK_ZONE_PRESETS = [
    { id: 'Asia/Seoul', label: '대한민국(서울)' },
    { id: 'America/New_York', label: '뉴욕' },
    { id: 'America/Los_Angeles', label: '로스앤젤레스' },
    { id: 'Europe/London', label: '런던' },
    { id: 'Europe/Paris', label: '파리' },
    { id: 'Asia/Tokyo', label: '도쿄' },
    { id: 'Asia/Shanghai', label: '상하이' },
    { id: 'Asia/Singapore', label: '싱가포르' },
    { id: 'Asia/Dubai', label: '두바이' },
    { id: 'Australia/Sydney', label: '시드니' },
    { id: 'Pacific/Auckland', label: '오클랜드' },
    { id: 'Europe/Berlin', label: '베를린' },
  ];

  // 기본값: 대한민국 1개. 사용자가 설정을 바꾸면 localStorage에 저장되고, 최초 1회만 기본값을 쓴다.
  function getClockZones() {
    try {
      const raw = window.settingsSync.get(CLOCK_ZONES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
    } catch {
      /* 손상된 값이면 기본값으로 복구 */
    }
    return [DEFAULT_ZONE];
  }

  // 대한민국은 항상 포함하고(기본), 추가로 최대 2개까지 허용한다.
  function setClockZones(zones) {
    const rest = (zones || []).filter((z) => z.id !== DEFAULT_ZONE.id).slice(0, MAX_EXTRA_ZONES);
    const trimmed = [DEFAULT_ZONE, ...rest];
    window.settingsSync.set(CLOCK_ZONES_KEY, JSON.stringify(trimmed));
    return trimmed;
  }

  function formatZoneTime(timeZone) {
    try {
      const now = new Date();
      const time = new Intl.DateTimeFormat('ko-KR', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now);
      const date = new Intl.DateTimeFormat('ko-KR', { timeZone, month: 'short', day: 'numeric', weekday: 'short' }).format(now);
      return { time, date };
    } catch {
      return { time: '--:--:--', date: '' };
    }
  }

  // ---- 시계별 "연결 도시"(v7.21.0) — 시계 카드의 날씨 배경/아이콘/강수확률에 쓰는 도시 ----
  // settingsSync로 기기 간 동기화되는 { [시간대 id]: 도시 이름 } 맵. 저장된 값이 없으면:
  //   · 대한민국(기본) 시계 → 등록된 날씨 지역의 첫 번째 도시
  //   · 그 밖 시계 → 같은 이름의 프리셋 도시(예: 뉴욕 시계 → 뉴욕)가 있으면 그 도시, 없으면 첫 번째 날씨 도시
  const CLOCK_CITIES_KEY = 'workspace:clockCities';
  const ZONE_DEFAULT_CITY = { 'America/New_York': '뉴욕', 'Europe/London': '런던', 'Europe/Paris': '파리', 'Asia/Tokyo': '도쿄', 'Asia/Singapore': '싱가포르' };
  function getClockCityMap() {
    try {
      const raw = window.settingsSync.get(CLOCK_CITIES_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  }
  /** 연결 도시로 고를 수 있는 목록: 등록된 날씨 지역 + 프리셋(이름 중복 제거). */
  function clockCityOptions() {
    const seen = new Set();
    const out = [];
    for (const c of [...(window.getWeatherCities ? window.getWeatherCities() : []), ...((window.CONFIG && window.CONFIG.cityPresets) || [])]) {
      if (!c || seen.has(c.name)) continue;
      seen.add(c.name); out.push(c);
    }
    return out;
  }
  function resolveClockCity(zoneId) {
    const options = clockCityOptions();
    const stored = getClockCityMap()[zoneId];
    const hit = stored && options.find((c) => c.name === stored);
    if (hit) return hit;
    const preferred = zoneId !== 'Asia/Seoul' && ZONE_DEFAULT_CITY[zoneId] && options.find((c) => c.name === ZONE_DEFAULT_CITY[zoneId]);
    return preferred || (window.getWeatherCities ? window.getWeatherCities()[0] : options[0]) || null;
  }
  function setClockCity(zoneId, cityName) {
    const map = { ...getClockCityMap() };
    if (cityName) map[zoneId] = cityName; else delete map[zoneId];
    window.settingsSync.set(CLOCK_CITIES_KEY, JSON.stringify(map));
    return map;
  }

  window.clockCityOptions = clockCityOptions;
  window.resolveClockCity = resolveClockCity;
  window.setClockCity = setClockCity;
  window.CLOCK_ZONE_PRESETS = CLOCK_ZONE_PRESETS;
  window.CLOCK_MAX_EXTRA_ZONES = MAX_EXTRA_ZONES;
  window.getClockZones = getClockZones;
  window.setClockZones = setClockZones;
  window.formatZoneTime = formatZoneTime;
})();
