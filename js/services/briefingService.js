// 로그인 시 브리핑 조립. "로그인 시 알람 제공"을 구현하는 핵심 서비스다.
// 일반 <script>로 로드되며 js/utils/date.js, js/predict.js, js/config.js가 먼저 로드되어 있어야 한다.
(function () {
  const { todayISO, diffDays, formatKoreanDate, predictProjectCompletion } = window;

  /**
   * @returns {{
   *   greeting:string, dateLabel:string,
   *   todaySchedules:object[], urgentProjects:object[],
   *   newAlerts:object[], weather: object|null
   * }}
   */
  function buildLoginBriefing({ user, schedules, projects, progressByProject, newAlerts, weather }) {
    const CONFIG = window.CONFIG;
    const today = todayISO();
    const todaySchedules = schedules
      .filter((s) => s.date === today && !s.done)
      .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

    const urgentProjects = projects
      .filter((p) => p.status === 'in_progress' && !p.deleted_at)
      .map((p) => {
        const prediction = predictProjectCompletion(
          progressByProject[p.id] || [],
          today,
          CONFIG.predict.projectMinRecords
        );
        const dDay = p.deadline ? diffDays(today, p.deadline) : null;
        return { ...p, prediction, dDay };
      })
      .filter((p) => (p.dDay !== null && p.dDay <= 7) || p.prediction.confidence !== 'none')
      .sort((a, b) => (a.dDay ?? 999) - (b.dDay ?? 999));

    const hour = new Date().getHours();
    const timeGreeting = hour < 11 ? '좋은 아침이에요' : hour < 18 ? '좋은 오후예요' : '수고 많으셨어요';
    const name = user?.email?.split('@')[0] || '님';

    return {
      greeting: `${timeGreeting}, ${name}`,
      dateLabel: formatKoreanDate(today),
      todaySchedules,
      urgentProjects,
      newAlerts: newAlerts || [],
      weather: weather || null,
    };
  }

  const WEATHER_CITIES_KEY = 'workspace:weatherCities';

  // 등록된 날씨 지역 목록을 반환한다(없으면 기본 3개로 초기화).
  function getWeatherCities() {
    try {
      const raw = window.settingsSync.get(WEATHER_CITIES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
    } catch {
      /* 손상된 값이면 기본값으로 복구 */
    }
    const CONFIG = window.CONFIG;
    return CONFIG.defaultCities.slice(0, CONFIG.weather.defaultMaxCities);
  }

  // 지역 목록 저장(최대 5개, 최소 1개 제한은 호출부인 설정 화면에서도 강제하지만 여기서도 방어한다).
  function setWeatherCities(cities) {
    const CONFIG = window.CONFIG;
    const trimmed = (cities || []).slice(0, CONFIG.weather.maxCities);
    if (trimmed.length < CONFIG.weather.minCities) return getWeatherCities();
    window.settingsSync.set(WEATHER_CITIES_KEY, JSON.stringify(trimmed));
    return trimmed;
  }

  // 등록된 지역 전체의 날씨를 병렬로 가져온다(개별 실패는 해당 지역만 null로 처리).
  async function fetchWeatherForCities(cities = getWeatherCities()) {
    return Promise.all(cities.map((city) => fetchWeatherSafe(city)));
  }

  // ---- Open-Meteo "번들": 현재 + 7일 일별 + 시간별(강수확률/강수량/날씨코드)을 한 번의 요청으로 ----
  // v7.21.0: 홈 날씨 카드(현재), 주간예보(일별), 시계 카드 날씨 테마(시간별)가 모두 이 한 요청을 공유한다.
  // 같은 좌표는 TTL(20분) 안에서 메모리 + localStorage에 캐시하고, 동시에 들어온 요청은 하나로 합친다 → 중복 호출 없음.
  // force=true(새로고침 버튼/카드 클릭)면 캐시를 건너뛴다.
  const BUNDLE_TTL_MS = 20 * 60 * 1000;
  const bundleMem = new Map(); // key -> { at, data }
  const bundleInflight = new Map(); // key -> Promise
  const bundleKey = (city) => `${Number(city.lat).toFixed(2)},${Number(city.lon).toFixed(2)}`;
  function readBundleCache(key) {
    const m = bundleMem.get(key);
    if (m) return m;
    try {
      const raw = localStorage.getItem(`workspace:wx:${key}`);
      if (raw) { const parsed = JSON.parse(raw); if (parsed && parsed.data) { bundleMem.set(key, parsed); return parsed; } }
    } catch { /* 저장소 접근 불가 — 캐시 없이 동작 */ }
    return null;
  }
  async function fetchWeatherBundle(city, { force = false } = {}) {
    const key = bundleKey(city);
    if (!force) {
      const c = readBundleCache(key);
      if (c && Date.now() - c.at < BUNDLE_TTL_MS) return c.data;
      if (bundleInflight.has(key)) return bundleInflight.get(key);
    }
    const p = (async () => {
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}`
          + '&current=temperature_2m,weather_code'
          + '&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,precipitation_sum'
          + '&hourly=weather_code,precipitation_probability,precipitation'
          + '&timezone=auto&forecast_days=7';
        const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
        if (!res.ok) return (readBundleCache(key) || {}).data || null;
        const data = await res.json();
        const entry = { at: Date.now(), data };
        bundleMem.set(key, entry);
        try { localStorage.setItem(`workspace:wx:${key}`, JSON.stringify(entry)); } catch { /* 용량/차단 무시 */ }
        return data;
      } catch {
        return (readBundleCache(key) || {}).data || null; // 네트워크 실패 시 오래된 캐시라도 사용(없으면 null)
      }
    })().finally(() => bundleInflight.delete(key));
    bundleInflight.set(key, p);
    return p;
  }

  // Open-Meteo로 간단한 현재 날씨를 가져온다(번들 공유). 실패해도 브리핑 전체는 계속 표시되어야 한다.
  async function fetchWeatherSafe(city = getWeatherCities()[0], opts) {
    const data = await fetchWeatherBundle(city, opts);
    if (!data || !data.current) return null;
    return {
      city: city.name,
      temp: data.current.temperature_2m ?? null,
      code: data.current.weather_code ?? null,
      updatedAt: new Date().toISOString(),
    };
  }

  // 특정 도시의 "현재 날씨"만 즉시 다시 가져온다(홈 화면 날씨 카드를 클릭했을 때 실시간 동기화용) — 캐시를 건너뛴다.
  async function refreshWeatherForCity(city) {
    return fetchWeatherSafe(city, { force: true });
  }

  // 7일 일별 예보(최고/최저, 날씨코드, 강수확률 pop %, 강수량 precip mm). 번들을 공유한다.
  // (예전에는 daily에 강수 항목이 없어 강수확률이 항상 빠졌었다 — v7.x에서 추가된 항목을 유지한다.)
  async function fetchWeeklyForecast(city) {
    const data = await fetchWeatherBundle(city);
    const daily = data?.daily;
    if (!daily?.time) return null;
    return daily.time.map((date, i) => ({
      date,
      max: daily.temperature_2m_max?.[i] ?? null,
      min: daily.temperature_2m_min?.[i] ?? null,
      code: daily.weather_code?.[i] ?? null,
      pop: daily.precipitation_probability_max?.[i] ?? null,
      precip: daily.precipitation_sum?.[i] ?? null,
    }));
  }

  // 시계 카드 테마용: "도시 현지 기준 오늘"의 예보 하루 + 시간별 슬롯 + 현지 시각.
  // 기상청(KMA) 키/연동이 켜져 있고 단기예보가 있으면 그 시간별(PTY/SKY/POP)을 우선 쓰고, 아니면(또는 실패하면) Open-Meteo 번들로 폴백한다.
  const kmaThemeCache = new Map(); // key -> { at, value }
  async function fetchThemeForecast(city, nowMs = Date.now()) {
    const bundle = await fetchWeatherBundle(city);
    const offset = bundle?.utc_offset_seconds;
    const kmaOn = !!(window.getPublicDataKey && window.getPublicDataKey() && window.getPublicDataEnabled && window.getPublicDataEnabled().kmaForecast);
    if (kmaOn && window.fetchUnifiedWeeklyForecast) {
      const key = bundleKey(city);
      let hit = kmaThemeCache.get(key);
      if (!hit || nowMs - hit.at > BUNDLE_TTL_MS) {
        const r = await window.fetchUnifiedWeeklyForecast(city).catch(() => null);
        hit = { at: nowMs, value: r };
        kmaThemeCache.set(key, hit);
      }
      const r = hit.value;
      if (r && r.source === 'kma' && r.days && r.days.length) {
        const off = offset ?? 9 * 3600;
        const date = window.WEATHER_THEME.cityLocalDate(nowMs, off);
        const day = r.days.find((d) => d.date === date) || r.days[0];
        return { day, hour: window.WEATHER_THEME.cityLocalHour(nowMs, off), source: 'kma', city: city.name };
      }
    }
    if (!bundle || !bundle.daily) return null;
    const off = offset ?? 0;
    const date = window.WEATHER_THEME.cityLocalDate(nowMs, off);
    let i = bundle.daily.time.indexOf(date);
    if (i < 0) i = 0;
    const hourly = [];
    const ht = bundle.hourly?.time || [];
    for (let k = 0; k < ht.length; k++) {
      if (ht[k].slice(0, 10) !== bundle.daily.time[i]) continue;
      hourly.push({
        h: Number(ht[k].slice(11, 13)),
        code: bundle.hourly.weather_code?.[k] ?? null,
        pop: bundle.hourly.precipitation_probability?.[k] ?? null,
        precip: bundle.hourly.precipitation?.[k] ?? null,
      });
    }
    const day = {
      date: bundle.daily.time[i],
      code: bundle.daily.weather_code?.[i] ?? null,
      pop: bundle.daily.precipitation_probability_max?.[i] ?? null,
      precip: bundle.daily.precipitation_sum?.[i] ?? null,
      hourly,
    };
    return { day, hour: window.WEATHER_THEME.cityLocalHour(nowMs, off), source: 'open-meteo', city: city.name };
  }

  function weatherCodeToLabel(code) {
    if (code === null || code === undefined) return '정보 없음';
    if (code === 0) return '맑음';
    if ([1, 2, 3].includes(code)) return '구름 조금';
    if ([45, 48].includes(code)) return '안개';
    if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return '비';
    if ([71, 73, 75, 85, 86].includes(code)) return '눈';
    if ([95, 96, 99].includes(code)) return '뇌우';
    return '흐림';
  }

  window.buildLoginBriefing = buildLoginBriefing;
  window.fetchWeatherSafe = fetchWeatherSafe;
  window.fetchWeatherForCities = fetchWeatherForCities;
  window.getWeatherCities = getWeatherCities;
  window.setWeatherCities = setWeatherCities;
  window.weatherCodeToLabel = weatherCodeToLabel;
  window.refreshWeatherForCity = refreshWeatherForCity;
  window.fetchWeeklyForecast = fetchWeeklyForecast;
  window.fetchWeatherBundle = fetchWeatherBundle;
  window.fetchThemeForecast = fetchThemeForecast;
})();
