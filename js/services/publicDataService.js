// 공공데이터포털(data.go.kr) 연동 — 1차 구현: 특일정보(공휴일) API + 오피넷(한국석유공사) 유가정보 API.
// 두 API는 서로 다른 키 체계를 쓴다(공공데이터포털 발급키 vs 오피넷 전용 발급키이므로 각각 저장한다.
// 서버 프록시 없이 브라우저에서 직접 호출하며, CORS/네트워크 실패 시 명확한 에러 메시지로 안내한다.
// 일반 <script>로 로드되며 js/modules/*보다 먼저 로드되어야 한다.
(function () {
  const KEY_STORAGE = 'workspace:publicData:dataGoKrKey';
  const OPINET_KEY_STORAGE = 'workspace:publicData:opinetKey';
  const KOPIS_KEY_STORAGE = 'workspace:publicData:kopisKey';
  const ENABLED_STORAGE = 'workspace:publicData:enabled'; // {holidays:bool, fuelPrice:bool, cultureEvents:bool}
  const STATUS_STORAGE = 'workspace:publicData:status'; // connected|error|unset (공휴일 API 기준)
  const CACHE_PREFIX = 'workspace:publicData:cache:';
  const ENABLED_DEFAULTS = { holidays: true, fuelPrice: true, cultureEvents: true };

  function getPublicDataKey() { return localStorage.getItem(KEY_STORAGE) || ''; }
  function setPublicDataKey(key) { localStorage.setItem(KEY_STORAGE, key || ''); }
  function getOpinetKey() { return localStorage.getItem(OPINET_KEY_STORAGE) || ''; }
  function setOpinetKey(key) { localStorage.setItem(OPINET_KEY_STORAGE, key || ''); }
  function getKopisKey() { return localStorage.getItem(KOPIS_KEY_STORAGE) || ''; }
  function setKopisKey(key) { localStorage.setItem(KOPIS_KEY_STORAGE, key || ''); }

  function getPublicDataEnabled() {
    try {
      return { ...ENABLED_DEFAULTS, ...JSON.parse(localStorage.getItem(ENABLED_STORAGE) || '{}') };
    } catch {
      return { ...ENABLED_DEFAULTS };
    }
  }
  function setPublicDataEnabled(next) {
    localStorage.setItem(ENABLED_STORAGE, JSON.stringify(next));
  }

  function getPublicDataStatus() {
    if (!getPublicDataKey()) return 'unset';
    return localStorage.getItem(STATUS_STORAGE) || 'unset';
  }
  function setPublicDataStatus(s) {
    localStorage.setItem(STATUS_STORAGE, s);
  }

  function cacheGet(key, ttlMs) {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      const { savedAt, data } = JSON.parse(raw);
      if (ttlMs && Date.now() - savedAt > ttlMs) return null;
      return data;
    } catch {
      return null;
    }
  }
  function cacheSet(key, data) {
    try {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ savedAt: Date.now(), data }));
    } catch {
      /* 저장 공간 부족 등은 무시(캐시는 있으면 좋은 정도) */
    }
  }

  // XML 응답(일부 공공데이터 API는 _type=json을 줘도 오류 시 XML로 응답한다)에서 <item>...</item>
  // 블록만 아주 단순히 뽑아낸다. 정식 XML 파서를 쓰지 않는 이유: 이 앱은 라이브러리 없이 CDN
  // 스크립트만으로 동작해야 하고, 이 API의 item 구조는 태그가 얕아 정규식으로 충분하다.
  function parseSimpleXmlItems(xmlText) {
    const items = [];
    const itemRe = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = itemRe.exec(xmlText))) {
      const block = m[1];
      const row = {};
      const fieldRe = /<(\w+)>([^<]*)<\/\1>/g;
      let fm;
      while ((fm = fieldRe.exec(block))) row[fm[1]] = fm[2];
      items.push(row);
    }
    return items;
  }

  // 특일정보(공휴일) — 한국천문연구원 특일 정보 서비스(getRestDeInfo).
  // https://www.data.go.kr/data/15012690/openapi.do 에서 "활용신청" 후 발급받은 키를 사용한다.
  // 반환: [{ date: 'YYYYMMDD', dateIso: 'YYYY-MM-DD', name, isHoliday }]
  async function fetchHolidays(year) {
    const cacheKey = `holidays:${year}`;
    const cached = cacheGet(cacheKey, 1000 * 60 * 60 * 24 * 30); // 공휴일은 자주 바뀌지 않으므로 30일 캐시
    if (cached) return cached;

    const key = getPublicDataKey();
    if (!key) throw new Error('설정 화면에서 공공데이터포털 API 키를 먼저 등록해 주세요.');

    const base = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo';
    const url = `${base}?serviceKey=${encodeURIComponent(key)}&solYear=${year}&numOfRows=100&_type=json`;

    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      setPublicDataStatus('error');
      throw new Error('공공데이터포털에 연결하지 못했습니다(네트워크 또는 CORS 문제일 수 있습니다).');
    }
    if (!res.ok) {
      setPublicDataStatus('error');
      throw new Error(`공휴일 API 요청이 실패했습니다(HTTP ${res.status}). 서비스 키 승인 상태를 확인해 주세요.`);
    }

    const text = await res.text();
    let rawItems = [];
    try {
      const json = JSON.parse(text);
      const header = json?.response?.header;
      if (header && header.resultCode && header.resultCode !== '00') {
        throw new Error(header.resultMsg || 'API 오류가 발생했습니다.');
      }
      const raw = json?.response?.body?.items?.item;
      rawItems = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
    } catch (jsonErr) {
      // JSON 파싱 실패 시 XML 응답으로 간주하고 재시도한다(에러 코드/메시지도 이 안에서 함께 처리).
      if (/<resultCode>/.test(text)) {
        const codeMatch = text.match(/<resultCode>([^<]*)<\/resultCode>/);
        const msgMatch = text.match(/<resultMsg>([^<]*)<\/resultMsg>/);
        if (codeMatch && codeMatch[1] !== '00') {
          setPublicDataStatus('error');
          throw new Error((msgMatch && msgMatch[1]) || 'API 오류가 발생했습니다.');
        }
      }
      rawItems = parseSimpleXmlItems(text);
    }

    const holidays = rawItems.map((it) => {
      const raw = String(it.locdate);
      return {
        date: raw,
        dateIso: raw.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
        name: it.dateName,
        isHoliday: it.isHoliday === 'Y' || it.isHoliday === undefined,
      };
    });
    setPublicDataStatus('connected');
    cacheSet(cacheKey, holidays);
    return holidays;
  }

  // 여러 공공/공사 API가 브라우저 직접 호출 시 CORS로 막히는 공통 패턴을 하나로 묶은 헬퍼.
  // 1) 같은 출처의 서버리스 프록시(/api/...)가 있으면 우선 사용하고, 2) 프록시가 없는 환경
  // (로컬 데모 등)에서는 직접 호출을 시도한 뒤, 그마저 실패하면 CORS 가능성을 알리는 에러를 던진다.
  async function fetchTextViaProxyOrDirect({ proxyUrl, directUrl, serviceName, proxyHint }) {
    let proxyTried = false;
    try {
      const proxyRes = await fetch(proxyUrl);
      proxyTried = true;
      if (proxyRes.ok) return await proxyRes.text();
      if (proxyRes.status !== 404) {
        const text = await proxyRes.text().catch(() => '');
        throw new Error(`${serviceName} 요청이 실패했습니다(HTTP ${proxyRes.status})${text ? ': ' + text.slice(0, 200) : ''}`);
      }
      // 404면 프록시 자체가 배포되어 있지 않은 것으로 보고 직접 호출로 폴백한다.
    } catch (e) {
      if (proxyTried && e instanceof Error && e.message.includes('요청이 실패했습니다')) throw e;
      // 프록시가 없는 환경(네트워크 오류/404) — 직접 호출로 폴백
    }

    try {
      const res = await fetch(directUrl);
      if (!res.ok) throw new Error(`${serviceName} 요청이 실패했습니다(HTTP ${res.status}).`);
      return await res.text();
    } catch (e) {
      if (e instanceof Error && e.message.includes('요청이 실패했습니다')) throw e;
      throw new Error(`${serviceName}에 연결하지 못했습니다. 브라우저가 CORS 정책으로 직접 호출을 막았을 가능성이 높습니다(개발자 도구 Console에 "CORS" 관련 오류가 보이면 확정입니다). ${proxyHint}`);
    }
  }

  // 오피넷(한국석유공사) 전국 평균 유가 — avgAllPrice API. 공공데이터포털과 별개로 오피넷에서
  // 자체 발급하는 키가 필요하다(https://www.opinet.co.kr/user/custapi/custApiInfo.do).
  // 반환: [{ productCode, productName, price, diff }]
  const OIL_PRODUCT_LABEL = { B027: '휘발유', D047: '경유', B034: '고급휘발유', C004: 'LPG(부탄)' };

  async function fetchFuelPrice() {
    const cacheKey = 'fuelPrice:avgAll';
    const cached = cacheGet(cacheKey, 1000 * 60 * 60 * 6); // 6시간 캐시(유가는 자주 갱신되지 않음)
    if (cached) return cached;

    const key = getOpinetKey();
    if (!key) throw new Error('설정 화면에서 오피넷 API 키를 먼저 등록해 주세요.');

    // 파라미터명은 code(인증키)이며, "certkey"가 아니다 — 오피넷 자체 문서 페이지의 표기와 달리
    // 실제 avgAllPrice.do 엔드포인트는 code로만 인증을 통과시킨다(실제 호출로 확인됨).
    const text = await fetchTextViaProxyOrDirect({
      proxyUrl: `/api/opinet-fuel?key=${encodeURIComponent(key)}`,
      directUrl: `https://www.opinet.co.kr/api/avgAllPrice.do?code=${encodeURIComponent(key)}&out=json`,
      serviceName: '유가정보',
      proxyHint: '이 경우 Vercel 배포에 포함된 /api/opinet-fuel.js 서버리스 프록시를 통해야 하며, 이 zip에 이미 포함되어 있으니 재배포 후 다시 시도해 주세요.',
    });
    const json = JSON.parse(text);
    const rows = json?.RESULT?.OIL || [];
    const result = rows.map((r) => ({
      productCode: r.PRODCD,
      productName: OIL_PRODUCT_LABEL[r.PRODCD] || r.PRODCD,
      price: Number(r.PRICE),
      diff: Number(r.DIFF),
    }));
    cacheSet(cacheKey, result);
    return result;
  }

  // 공연전시정보(KOPIS, 공연예술통합전산망) — 공연목록 조회(pblprfr) API.
  // https://kopis.or.kr/por/cs/openapi/openApiInfo.do 에서 발급받은 서비스키를 사용한다.
  // 이 API도 오피넷과 마찬가지로 브라우저 직접 호출 시 CORS로 막힐 가능성이 높아 프록시를 우선 쓴다.
  // 반환: [{ id, title, startDate, endDate, venue, area, genre, poster, state }]
  function toIso(yyyymmdd) {
    return String(yyyymmdd || '').replace(/(\d{4})\.?(\d{2})\.?(\d{2})/, '$1-$2-$3');
  }

  async function fetchCultureEvents({ keyword, stdate, eddate, rows: rowLimit = 20 } = {}) {
    const key = getKopisKey();
    if (!key) throw new Error('설정 화면에서 KOPIS(공연전시정보) API 키를 먼저 등록해 주세요.');
    if (!stdate || !eddate) throw new Error('조회 시작일/종료일을 입력해 주세요.');

    const qs = new URLSearchParams({ service: key, stdate, eddate, cpage: '1', rows: String(rowLimit) });
    if (keyword) qs.set('shprfnm', keyword);
    const path = `openApi/restful/pblprfr?${qs.toString()}`;

    const text = await fetchTextViaProxyOrDirect({
      proxyUrl: `/api/kopis-culture?${qs.toString()}`,
      directUrl: `https://www.kopis.or.kr/${path}`,
      serviceName: '공연전시정보',
      proxyHint: '이 경우 Vercel 배포에 포함된 /api/kopis-culture.js 서버리스 프록시를 통해야 하며, 이 zip에 이미 포함되어 있으니 재배포 후 다시 시도해 주세요.',
    });

    const codeMatch = text.match(/<returncode>([^<]*)<\/returncode>/);
    if (codeMatch && codeMatch[1] && codeMatch[1] !== '00' && !/<db>/.test(text)) {
      const msgMatch = text.match(/<errmsg>([^<]*)<\/errmsg>/);
      throw new Error((msgMatch && msgMatch[1]) || 'KOPIS API 오류가 발생했습니다. 서비스 키를 확인해 주세요.');
    }

    const items = [];
    const dbRe = /<db>([\s\S]*?)<\/db>/g;
    let m;
    while ((m = dbRe.exec(text))) {
      const block = m[1];
      const get = (tag) => (block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1];
      items.push({
        id: get('mt20id'),
        title: get('prfnm'),
        startDate: toIso(get('prfpdfrom')),
        endDate: toIso(get('prfpdto')),
        venue: get('fcltynm'),
        area: get('area'),
        genre: get('genrenm'),
        poster: get('poster'),
        state: get('prfstate'),
      });
    }
    return items;
  }

  window.getPublicDataKey = getPublicDataKey;
  window.setPublicDataKey = setPublicDataKey;
  window.getOpinetKey = getOpinetKey;
  window.setOpinetKey = setOpinetKey;
  window.getKopisKey = getKopisKey;
  window.setKopisKey = setKopisKey;
  window.getPublicDataEnabled = getPublicDataEnabled;
  window.setPublicDataEnabled = setPublicDataEnabled;
  window.getPublicDataStatus = getPublicDataStatus;
  window.fetchHolidays = fetchHolidays;
  window.fetchFuelPrice = fetchFuelPrice;
  window.fetchCultureEvents = fetchCultureEvents;
})();
