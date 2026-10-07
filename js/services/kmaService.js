// 기상청(KMA) 공공데이터포털 연동 — 단기예보(getVilageFcst, 1~3일) + 중기예보
// (getMidLandFcst 육상예보 + getMidTa 기온예보, 3~10일)를 합쳐 "주간(7일 이상) 예보"를
// 만든다. 공공데이터포털 서비스 키는 설정 화면의 "공공데이터포털 연동"에서 등록한 키를
// 그대로 재사용한다(특일정보/기상특보/EV충전소와 같은 데이터포털 계정 키 — 실제로는
// KMA API들을 각각 별도로 "활용신청"해야 승인된다).
//
// 격자 변환(위경도 → KMA 격자 nx/ny)은 기상청이 공개한 표준 Lambert Conformal Conic
// 변환식을 그대로 구현한 것이다(순수 함수 — 단위 테스트 가능).
//
// 키가 없거나 요청이 실패하면(네트워크 오류, 아직 승인되지 않은 API 등) 예외를 던지지 않고
// 항상 null을 반환한다 — 호출부(fetchUnifiedWeeklyForecast)가 Open-Meteo로 조용히
// 대체(fallback)할 수 있도록 하기 위함이다.
// 일반 <script>로 로드되며 js/services/publicDataService.js, js/services/briefingService.js
// (Open-Meteo fallback)가 먼저 로드되어 있어야 한다.
(function () {
  // ---- 1. 위경도 → KMA 격자(nx, ny) 변환 (기상청 공개 공식, LCC 투영) ----
  function dfsXyConv(lat, lon) {
    const RE = 6371.00877; // 지구 반경(km)
    const GRID = 5.0; // 격자 간격(km)
    const SLAT1 = 30.0, SLAT2 = 60.0; // 표준위도
    const OLON = 126.0, OLAT = 38.0; // 기준점 경도/위도
    const XO = 43, YO = 136; // 기준점 X,Y 좌표
    const DEGRAD = Math.PI / 180.0;

    const re = RE / GRID;
    const slat1 = SLAT1 * DEGRAD;
    const slat2 = SLAT2 * DEGRAD;
    const olon = OLON * DEGRAD;
    const olat = OLAT * DEGRAD;

    let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
    sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
    let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
    sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
    let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
    ro = (re * sf) / Math.pow(ro, sn);

    const ra0 = Math.tan(Math.PI * 0.25 + (lat * DEGRAD) * 0.5);
    const ra = (re * sf) / Math.pow(ra0, sn);
    let theta = lon * DEGRAD - olon;
    if (theta > Math.PI) theta -= 2.0 * Math.PI;
    if (theta < -Math.PI) theta += 2.0 * Math.PI;
    theta *= sn;

    const nx = Math.floor(ra * Math.sin(theta) + XO + 0.5);
    const ny = Math.floor(ro - ra * Math.cos(theta) + YO + 0.5);
    return { nx, ny };
  }

  // ---- 2. 중기예보 지역코드(regId) — 설정 화면의 지역 프리셋 중 국내 도시만 매핑 ----
  // ※ 공공데이터포털에 공개된 "중기예보구역코드" 표를 참고해 등록했으나, 지자체 통합/행정구역
  //   개편으로 코드가 바뀔 수 있어 100% 확신할 수 없는 항목은 주석으로 표시했다. 확인이 어려운
  //   지역은 regId를 두지 않고, 그 지역은 항상 Open-Meteo로 대체(fallback)되도록 했다.
  const REGION_CODES = {
    서울: '11B10101',
    인천: '11B20201',
    수원: '11B20601', // 경기도(남부) 기준 — 수원시 단독 코드가 아닌 광역 코드일 수 있음
    춘천: '11D10301', // 강원도 영서 기준
    대전: '11C20401',
    대구: '11H10701',
    광주: '11F20501',
    부산: '11H20201',
    울산: '11H20101',
    제주: '11G00201',
  };

  function getRegionCode(cityName) {
    return REGION_CODES[cityName] || null;
  }

  // ---- 3. base_date/base_time 계산 ----
  function pad2(n) { return String(n).padStart(2, '0'); }
  function fmtDate(d) { return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`; }

  // 단기예보(getVilageFcst)는 하루 8번(02,05,08,11,14,17,20,23시) 발표되고, 발표 후 약
  // 10~40분 뒤에야 API에 반영되므로 45분의 안전 여유를 두고 "가장 최근에 확실히 발표된" 시각을 고른다.
  function latestVilageBase(now = new Date()) {
    const ANNOUNCE_HOURS = [2, 5, 8, 11, 14, 17, 20, 23];
    const bufferMinutes = 45;
    const safe = new Date(now.getTime() - bufferMinutes * 60000);
    let candidate = null;
    for (const h of ANNOUNCE_HOURS) {
      const t = new Date(safe);
      t.setHours(h, 0, 0, 0);
      if (t <= safe) candidate = t;
    }
    if (!candidate) {
      // 자정 직후(02시 이전)면 전날 23시 발표분을 쓴다.
      candidate = new Date(safe);
      candidate.setDate(candidate.getDate() - 1);
      candidate.setHours(23, 0, 0, 0);
    }
    return { base_date: fmtDate(candidate), base_time: `${pad2(candidate.getHours())}00` };
  }

  // 중기예보(getMidLandFcst/getMidTa)는 하루 2번(06, 18시) 발표되고 약 30~40분 뒤 반영된다.
  function latestMidTmFc(now = new Date()) {
    const bufferMinutes = 40;
    const safe = new Date(now.getTime() - bufferMinutes * 60000);
    const hours = safe.getHours();
    const candidate = new Date(safe);
    if (hours >= 18) candidate.setHours(18, 0, 0, 0);
    else if (hours >= 6) candidate.setHours(6, 0, 0, 0);
    else {
      candidate.setDate(candidate.getDate() - 1);
      candidate.setHours(18, 0, 0, 0);
    }
    return `${fmtDate(candidate)}${pad2(candidate.getHours())}00`;
  }

  // ---- 4. 단기예보 응답 파싱(순수 함수) ----
  // items: [{category, fcstDate, fcstTime, fcstValue}] (response.body.items.item)
  // 반환: 날짜별로 묶은 { date, tmin, tmax, hourly:[{time,temp,pop,pty,sky}] } 최대 3일치, 날짜 오름차순.
  function parseVilageFcst(items) {
    const byDate = new Map();
    for (const it of items || []) {
      const date = it.fcstDate;
      if (!byDate.has(date)) byDate.set(date, { date, tmin: null, tmax: null, byTime: new Map() });
      const bucket = byDate.get(date);
      if (it.category === 'TMN') { bucket.tmin = Number(it.fcstValue); continue; }
      if (it.category === 'TMX') { bucket.tmax = Number(it.fcstValue); continue; }
      if (!bucket.byTime.has(it.fcstTime)) bucket.byTime.set(it.fcstTime, { time: it.fcstTime });
      const slot = bucket.byTime.get(it.fcstTime);
      if (it.category === 'TMP') slot.temp = Number(it.fcstValue);
      if (it.category === 'POP') slot.pop = Number(it.fcstValue);
      if (it.category === 'PTY') slot.pty = Number(it.fcstValue);
      if (it.category === 'SKY') slot.sky = Number(it.fcstValue);
      if (it.category === 'PCP') slot.pcp = it.fcstValue;
    }
    const dates = Array.from(byDate.keys()).sort();
    return dates.map((date) => {
      const b = byDate.get(date);
      const hourly = Array.from(b.byTime.values()).sort((a, c) => a.time.localeCompare(c.time));
      const temps = hourly.map((h) => h.temp).filter((v) => typeof v === 'number');
      return {
        date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
        tmin: b.tmin !== null ? b.tmin : (temps.length ? Math.min(...temps) : null),
        tmax: b.tmax !== null ? b.tmax : (temps.length ? Math.max(...temps) : null),
        pop: hourly.length ? Math.max(...hourly.map((h) => h.pop || 0)) : null,
        hourly,
      };
    });
  }

  // PTY(강수형태) 코드를 간단한 한글 라벨로.
  function ptyLabel(pty) {
    return { 0: '', 1: '비', 2: '비/눈', 3: '눈', 4: '소나기', 5: '빗방울', 6: '빗방울눈날림', 7: '눈날림' }[pty] || '';
  }
  // SKY(하늘상태) 코드를 간단한 한글 라벨로.
  function skyLabel(sky) {
    return { 1: '맑음', 3: '구름많음', 4: '흐림' }[sky] || '';
  }

  // ---- 5. 중기예보(육상+기온) 응답 파싱(순수 함수) ----
  // landItem: getMidLandFcst의 item[0] (필드: wf3Am/wf3Pm...wf10, rnSt3Am/rnSt3Pm...rnSt10)
  // taItem: getMidTa의 item[0] (필드: taMin3/taMax3 ... taMin10/taMax10)
  // baseDate: 발표 기준일(YYYYMMDD) — 상대 day offset(3~10)을 실제 날짜로 바꾸는 데 사용.
  // 반환: 4~10일차(단기예보와 겹치지 않는 구간) 배열.
  function parseMidForecast(landItem, taItem, baseDate) {
    const base = new Date(`${baseDate.slice(0, 4)}-${baseDate.slice(4, 6)}-${baseDate.slice(6, 8)}T00:00:00`);
    const days = [];
    for (let offset = 3; offset <= 10; offset++) {
      const d = new Date(base);
      d.setDate(d.getDate() + offset);
      const dateStr = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      const hasAmPm = offset <= 7; // 8~10일차는 오전/오후 구분 없이 하루 통합값만 제공됨
      const am = hasAmPm
        ? { rainPct: numOrNull(landItem?.[`rnSt${offset}Am`]), text: landItem?.[`wf${offset}Am`] || null }
        : null;
      const pm = hasAmPm
        ? { rainPct: numOrNull(landItem?.[`rnSt${offset}Pm`]), text: landItem?.[`wf${offset}Pm`] || null }
        : { rainPct: numOrNull(landItem?.[`rnSt${offset}`]), text: landItem?.[`wf${offset}`] || null };
      days.push({
        date: dateStr,
        max: numOrNull(taItem?.[`taMax${offset}`]),
        min: numOrNull(taItem?.[`taMin${offset}`]),
        am,
        pm,
        pop: Math.max(am?.rainPct || 0, pm?.rainPct || 0) || null,
      });
    }
    return days;
  }
  function numOrNull(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // ---- 6. 실제 네트워크 호출 ----
  const KMA_BASE = 'https://apis.data.go.kr/1360000';

  async function kmaGet(path, params) {
    const key = window.getPublicDataKey ? window.getPublicDataKey() : '';
    if (!key) return null;
    const qs = new URLSearchParams({ serviceKey: key, dataType: 'JSON', numOfRows: '1000', pageNo: '1', ...params });
    const url = `${KMA_BASE}/${path}?${qs.toString()}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) return null;
      const data = await res.json();
      const header = data?.response?.header;
      if (header && header.resultCode !== '00') return null; // 미승인/키오류 등
      return data?.response?.body?.items?.item || null;
    } catch {
      return null; // 네트워크 오류 등은 조용히 실패 → 호출부가 Open-Meteo로 대체
    }
  }

  async function fetchKmaShortTerm(lat, lon) {
    const { nx, ny } = dfsXyConv(lat, lon);
    const { base_date, base_time } = latestVilageBase();
    const items = await kmaGet('VilageFcstInfoService_2.0/getVilageFcst', { base_date, base_time, nx, ny });
    if (!items || !items.length) return null;
    return parseVilageFcst(items).slice(0, 3); // 1~3일 상세
  }

  async function fetchKmaMidTerm(regId) {
    const tmFc = latestMidTmFc();
    const [landItems, taItems] = await Promise.all([
      kmaGet('MidFcstInfoService/getMidLandFcst', { regId, tmFc }),
      kmaGet('MidFcstInfoService/getMidTa', { regId, tmFc }),
    ]);
    if (!landItems || !landItems.length || !taItems || !taItems.length) return null;
    return parseMidForecast(landItems[0], taItems[0], tmFc.slice(0, 8));
  }

  // ---- 7. 통합 주간예보 — 단기(1~3일, 상세) + 중기(4~10일, AM/PM 강수확률) ----
  // 항상 { days, source, note } 형태로 반환한다. source: 'kma' | 'open-meteo'.
  // KMA 키가 없거나, 이 도시의 지역코드를 모르거나, 요청이 실패하면 Open-Meteo로 조용히 대체한다.
  async function fetchUnifiedWeeklyForecast(city) {
    const key = window.getPublicDataKey ? window.getPublicDataKey() : '';
    const enabled = window.getPublicDataEnabled ? window.getPublicDataEnabled().kmaForecast : false;
    const regId = getRegionCode(city.name);

    if (key && enabled && regId) {
      try {
        const [shortTerm, midTerm] = await Promise.all([fetchKmaShortTerm(city.lat, city.lon), fetchKmaMidTerm(regId)]);
        if (shortTerm && shortTerm.length && midTerm && midTerm.length) {
          const days = [
            ...shortTerm.map((d) => ({
              date: d.date,
              max: d.tmax,
              min: d.tmin,
              pop: d.pop,
              code: null,
              // v7.21.0: 시계 카드 날씨 테마가 "오전/오후" 구간별 강수를 판단하도록 시간별 슬롯(KST 시)을 함께 돌려준다.
              hourly: (d.hourly || []).map((h) => ({ h: Number(String(h.time).slice(0, 2)), pty: h.pty ?? null, sky: h.sky ?? null, pop: h.pop ?? null, precip: null })),
              detail: `${skyLabel(d.hourly?.[Math.floor(d.hourly.length / 2)]?.sky)}${ptyLabel(d.hourly?.[Math.floor(d.hourly.length / 2)]?.pty) ? ' · ' + ptyLabel(d.hourly[Math.floor(d.hourly.length / 2)].pty) : ''}`,
            })),
            ...midTerm.map((d) => ({
              date: d.date,
              max: d.max,
              min: d.min,
              pop: d.pop,
              code: null,
              detail: [d.am?.text, d.pm?.text].filter(Boolean).join(' / '),
            })),
          ];
          return { days, source: 'kma', note: null };
        }
      } catch {
        /* 아래 fallback으로 진행 */
      }
    }

    // ---- Fallback: Open-Meteo(기존 구현) ----
    const days = await window.fetchWeeklyForecast(city);
    let note = null;
    if (!key) note = '기상청 API 키가 설정되지 않아 Open-Meteo 데이터를 사용 중입니다.';
    else if (!enabled) note = '기상청 연동이 꺼져 있어 Open-Meteo 데이터를 사용 중입니다.';
    else if (!regId) note = `${city.name}은(는) 기상청 중기예보 지역코드가 등록되지 않아 Open-Meteo 데이터를 사용 중입니다.`;
    else note = '기상청 데이터를 가져오지 못해 Open-Meteo 데이터를 사용 중입니다.';
    return { days: days || [], source: 'open-meteo', note };
  }

  // globalThis를 쓰면 브라우저(window)와 Node(단위 테스트, js/predict.js와 동일한 방식) 양쪽에서
  // 동일하게 동작한다 — fetch 관련 함수는 브라우저에서만 호출되지만, 격자변환/파싱 순수 함수는
  // Node 테스트에서도 바로 쓸 수 있다.
  globalThis.dfsXyConv = dfsXyConv;
  globalThis.getKmaRegionCode = getRegionCode;
  globalThis.KMA_REGION_CODES = REGION_CODES;
  globalThis.parseVilageFcst = parseVilageFcst;
  globalThis.parseMidForecast = parseMidForecast;
  globalThis.ptyLabel = ptyLabel;
  globalThis.skyLabel = skyLabel;
  globalThis.fetchUnifiedWeeklyForecast = fetchUnifiedWeeklyForecast;
})();
