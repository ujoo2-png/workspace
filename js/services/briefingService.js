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
      const raw = localStorage.getItem(WEATHER_CITIES_KEY);
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
    localStorage.setItem(WEATHER_CITIES_KEY, JSON.stringify(trimmed));
    return trimmed;
  }

  // 등록된 지역 전체의 날씨를 병렬로 가져온다(개별 실패는 해당 지역만 null로 처리).
  async function fetchWeatherForCities(cities = getWeatherCities()) {
    return Promise.all(cities.map((city) => fetchWeatherSafe(city)));
  }

  // Open-Meteo(키 불필요)로 간단한 현재 날씨를 가져온다. 실패해도 브리핑 전체는 계속 표시되어야 한다.
  async function fetchWeatherSafe(city = getWeatherCities()[0]) {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&current=temperature_2m,weather_code`;
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return null;
      const data = await res.json();
      return {
        city: city.name,
        temp: data?.current?.temperature_2m ?? null,
        code: data?.current?.weather_code ?? null,
        updatedAt: new Date().toISOString(),
      };
    } catch {
      return null; // 네트워크 차단 환경에서도 앱이 멈추지 않도록 조용히 실패
    }
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
})();
