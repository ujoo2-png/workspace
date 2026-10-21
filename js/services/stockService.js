// 증권 시세 서비스 (v7.25.0) — 여러 증권 API 공급자를 지원한다.
//
// 지원 공급자(provider):
//   · 'kis'    : 한국투자증권(KIS) 개발자 API(공식, 키 필요). 국내/해외 현재가 + 일봉 차트.
//   · 'custom' : 사용자가 직접 등록하는 "아무 HTTP JSON API". URL 템플릿 + 응답 필드 경로만 지정하면
//                어떤 증권사/개인 API든 연결할 수 있다(코드 수정 불필요). 프록시(/api/stock-proxy)를 거친다.
//   · 'none'   : 외부 연동 없이 수동 입력만(기본값).
//
// 정직한 안내:
//   · 네이버 금융은 공식 시세 API가 없다. api.finance.naver.com 등은 비공식 크롤링 엔드포인트로
//     CORS를 막아두었고 약관상 보장이 없다 → 이 앱은 기본 제공하지 않는다. 필요하면 'custom'으로 직접 등록할 수 있다.
//   · 야후 파이낸스(query1.finance.yahoo.com)는 키 없이 쓸 수 있는 비공식 JSON이지만 약관·차단 리스크가 있다.
//     역시 'custom'으로 등록하도록 안내한다(기본 내장하지 않음).
//
// 키/설정은 브라우저(localStorage)에만 저장하고, 실제 호출은 서버 프록시를 거친다(토큰 발급·CORS 우회).
// 일반 <script>로 로드된다.
(function () {
  const PROVIDER_STORAGE = 'workspace:stocks:provider';
  const KEY_STORAGE = 'workspace:stocks:kisAppKey';
  const SECRET_STORAGE = 'workspace:stocks:kisAppSecret';
  const ENV_STORAGE = 'workspace:stocks:kisEnv';
  const CUSTOM_STORAGE = 'workspace:stocks:customProvider'; // JSON: {name, priceUrl, nameUrl, headers, paths:{price,changeRate,name}, currency}
  const CACHE_PREFIX = 'workspace:stocksQuote:';
  const CACHE_TTL_MS = 1000 * 60; // 1분 — 같은 종목을 짧은 시간에 반복 조회하지 않도록.

  const get = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const set = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* 무시 */ } };
  const getJson = (k) => { try { return JSON.parse(get(k)) || null; } catch { return null; } };

  // ── KIS 자격증명 ──────────────────────────────────────────────────────────
  const getKisAppKey = () => get(KEY_STORAGE);
  const getKisAppSecret = () => get(SECRET_STORAGE);
  const getKisEnv = () => get(ENV_STORAGE) || 'real';
  function setKisCredentials({ appkey, appsecret, env }) {
    set(KEY_STORAGE, (appkey || '').trim());
    set(SECRET_STORAGE, (appsecret || '').trim());
    set(ENV_STORAGE, env === 'mock' ? 'mock' : 'real');
  }
  const hasKisKey = () => !!(getKisAppKey() && getKisAppSecret());

  // ── 공급자 선택 ───────────────────────────────────────────────────────────
  const getProvider = () => get(PROVIDER_STORAGE) || 'kis';
  const setProvider = (p) => set(PROVIDER_STORAGE, ['kis', 'custom', 'none'].includes(p) ? p : 'kis');
  const getCustomProvider = () => getJson(CUSTOM_STORAGE);
  function setCustomProvider(cfg) {
    if (!cfg) { set(CUSTOM_STORAGE, ''); return; }
    set(CUSTOM_STORAGE, JSON.stringify({
      name: (cfg.name || '커스텀 API').trim(),
      priceUrl: (cfg.priceUrl || '').trim(),
      nameUrl: (cfg.nameUrl || '').trim(),
      // v7.25.0: 오늘의 시황(지수)용 URL(선택).
      indicesUrl: (cfg.indicesUrl || '').trim(),
      headers: cfg.headers && typeof cfg.headers === 'object' ? cfg.headers : {},
      paths: cfg.paths && typeof cfg.paths === 'object' ? cfg.paths : { price: 'price', changeRate: 'changeRate', name: 'name' },
      currency: cfg.currency === 'USD' ? 'USD' : 'KRW',
    }));
  }
  const hasCustomProvider = () => { const c = getCustomProvider(); return !!(c && c.priceUrl); };

  /** 현재 공급자가 시세 조회에 쓸 준비가 되었는지. */
  function hasQuoteProvider() {
    const p = getProvider();
    if (p === 'custom') return hasCustomProvider();
    if (p === 'kis') return hasKisKey();
    return false;
  }
  const providerLabel = () => {
    const p = getProvider();
    if (p === 'custom') return getCustomProvider()?.name || '커스텀 API';
    if (p === 'kis') return '한국투자증권(KIS)';
    return '수동 입력';
  };

  function cacheGet(key) {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      const { savedAt, price } = JSON.parse(raw);
      return Date.now() - savedAt > CACHE_TTL_MS ? null : price;
    } catch { return null; }
  }
  function cacheSet(key, price) {
    try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ savedAt: Date.now(), price })); } catch {}
  }
  function cacheClear() {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
    } catch {}
  }

  // ── KIS 구현 ──────────────────────────────────────────────────────────────
  // 국내: /uapi/domestic-stock/v1/quotations/inquire-price (tr_id: FHKST01010100)
  // 해외: /uapi/overseas-price/v1/quotations/price        (tr_id: HHDFS00000300)
  const MARKET_CODE = { KRX: 'J', US: 'NAS' }; // KIS 거래소 코드(국내 J=KRX, 해외 기본 나스닥)

  async function callKis(path, trId, params) {
    const res = await fetch(
      `/api/kis-proxy?path=${encodeURIComponent(path)}&tr_id=${encodeURIComponent(trId)}&params=${encodeURIComponent(JSON.stringify(params))}`,
      { headers: { 'x-kis-appkey': getKisAppKey(), 'x-kis-appsecret': getKisAppSecret(), 'x-kis-env': getKisEnv() }, signal: AbortSignal.timeout(12000) }
    );
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`시세 응답을 읽지 못했습니다(HTTP ${res.status})`); }
    if (!res.ok) throw new Error(data.error || data.msg1 || `시세 조회 실패(HTTP ${res.status})`);
    if (data.rt_cd && data.rt_cd !== '0') throw new Error(data.msg1 || '시세 조회가 거부되었습니다.');
    return data;
  }

  /** 국내주식 현재가. */
  async function fetchDomesticPrice(symbol) {
    const data = await callKis('/uapi/domestic-stock/v1/quotations/inquire-price', 'FHKST01010100', { fid_cond_mrkt_div_code: 'J', fid_input_iscd: symbol });
    const o = data.output || {};
    const price = Number(String(o.stck_prpr || '').replace(/,/g, ''));
    return { symbol, price, name: o.hts_kor_isnm || '', changeRate: Number(o.prdy_ctrt || 0) || null, currency: 'KRW' };
  }

  /** 해외주식 현재가. */
  async function fetchOverseasPrice(symbol, market = 'US') {
    const data = await callKis('/uapi/overseas-price/v1/quotations/price', 'HHDFS00000300', { AUTH: '', EXCD: MARKET_CODE[market] || 'NAS', SYMB: symbol });
    const o = data.output || {};
    const price = Number(String(o.last || '').replace(/,/g, ''));
    return { symbol, price, name: o.name || '', changeRate: Number(o.rate || 0) || null, currency: 'USD' };
  }

  /** KIS 일별 시세(일봉) — 최근 종가 배열. 차트에 쓴다. */
  async function fetchDailyChartKis(symbol, { market = 'KRX', days = 90 } = {}) {
    const today = new Date();
    const from = new Date(today.getTime() - Math.min(Math.max(days, 5), 365) * 86400000);
    const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
    const data = await callKis('/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice', 'FHKST03010100', {
      fid_cond_mrkt_div_code: 'J', fid_input_iscd: symbol, fid_input_date_1: fmt(from), fid_input_date_2: fmt(today),
      fid_period_div_code: 'D', fid_org_adj_prc: '0',
    });
    const rows = (data.output2 || []).map((r) => ({ date: r.stck_bsop_date, close: Number(r.stck_clpr), high: Number(r.stck_hgpr), low: Number(r.stck_lwpr), vol: Number(r.acml_vol) }))
      .filter((r) => r.date && Number.isFinite(r.close))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!rows.length) throw new Error('일봉 데이터를 받지 못했습니다.');
    return { symbol, name: '', market, currency: 'KRW', rows: rows.map((r) => ({ date: `${r.date.slice(0, 4)}-${r.date.slice(4, 6)}-${r.date.slice(6, 8)}`, v: r.close })), raw: rows };
  }

  // ── 커스텀 구현 ───────────────────────────────────────────────────────────
  // URL 템플릿의 {symbol} 을 종목코드로 치환하고, 프록시를 통해 호출한 뒤,
  // paths(JSON 경로, 예: "data.close" 또는 "result[0].price")로 값을 꺼낸다.
  function pick(obj, path) {
    if (!path) return undefined;
    return String(path).split('.').reduce((o, seg) => {
      if (o === null || o === undefined) return undefined;
      const m = seg.match(/^([^\[]*)\[(\d+)\]$/); // 예: rows[0]
      if (m) { const base = m[1] ? o[m[1]] : o; return base ? base[Number(m[2])] : undefined; }
      return o[seg];
    }, obj);
  }
  function fillUrl(tpl, symbol, market) {
    return String(tpl || '').replace(/\{symbol\}/g, encodeURIComponent(symbol)).replace(/\{market\}/g, encodeURIComponent(market || 'KRX'));
  }
  async function fetchCustomPrice(symbol, market = 'KRX') {
    const cfg = getCustomProvider();
    if (!cfg || !cfg.priceUrl) throw new Error('커스텀 증권 API가 등록되지 않았습니다.');
    const res = await fetch('/api/stock-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: fillUrl(cfg.priceUrl, symbol, market), headers: cfg.headers || {} }),
      signal: AbortSignal.timeout(12000),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`커스텀 응답을 읽지 못했습니다(HTTP ${res.status})`); }
    if (!res.ok) throw new Error(data.error || `커스텀 조회 실패(HTTP ${res.status})`);
    const paths = cfg.paths || {};
    const price = Number(String(pick(data, paths.price)).replace(/,/g, ''));
    if (!Number.isFinite(price)) throw new Error(`가격 필드(${paths.price})를 숫자로 읽지 못했습니다. 응답 구조를 확인하세요.`);
    const cr = Number(String(pick(data, paths.changeRate)).replace(/[,%]/g, ''));
    return { symbol, price, name: String(pick(data, paths.name) || ''), changeRate: Number.isFinite(cr) ? cr : null, currency: cfg.currency || 'KRW' };
  }
  async function lookupNameCustom(symbol, market = 'KRX') {
    const cfg = getCustomProvider();
    if (!cfg || !cfg.nameUrl) return '';
    try {
      const res = await fetch('/api/stock-proxy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: fillUrl(cfg.nameUrl, symbol, market), headers: cfg.headers || {} }), signal: AbortSignal.timeout(10000) });
      const data = await res.json();
      return String(pick(data, (cfg.paths || {}).name) || '');
    } catch { return ''; }
  }

  // ── 공급자 무관 진입점 ────────────────────────────────────────────────────
  /** 단일 종목 현재가(현재 선택된 공급자 사용). */
  async function fetchPrice(symbol, market = 'KRX') {
    const p = getProvider();
    if (p === 'custom') return fetchCustomPrice(symbol, market);
    if (p === 'kis') return market === 'US' ? fetchOverseasPrice(symbol, market) : fetchDomesticPrice(symbol);
    throw new Error('시세 공급자가 설정되지 않았습니다.');
  }

  /**
   * 보유/관심 종목 배열의 현재가 맵을 만든다. { 'KRX:005930': 72000, ... }
   * 공급자가 준비되지 않으면 조용히 건너뛴다 — 화면은 "미평가"로 표시한다.
   * 실패한 종목은 errors에 담아 호출부가 토스트로 알린다.
   */
  async function fetchPrices(holdings, { force = false } = {}) {
    const out = {};
    const errors = [];
    if (!hasQuoteProvider()) return { prices: out, errors: [{ symbol: '*', message: `${providerLabel()} 시세 정보가 등록되지 않았습니다(설정 → 연동).` }] };
    for (const h of holdings || []) {
      if (!h.symbol) continue;
      const key = `${h.market || 'KRX'}:${h.symbol}`;
      if (!force) {
        const cached = cacheGet(key);
        if (cached !== null) { out[key] = cached; continue; }
      }
      try {
        const r = await fetchPrice(h.symbol, h.market || 'KRX');
        if (Number.isFinite(r.price) && r.price > 0) { out[key] = r.price; cacheSet(key, r.price); }
        else errors.push({ symbol: h.symbol, message: '현재가를 받지 못했습니다.' });
      } catch (e) {
        errors.push({ symbol: h.symbol, message: e.message || String(e) });
      }
    }
    return { prices: out, errors };
  }

  /** 종목명 자동 채움(현재 공급자). */
  async function lookupName(symbol, market = 'KRX') {
    const p = getProvider();
    try {
      if (p === 'custom') return await lookupNameCustom(symbol, market);
      if (p === 'kis') return (await (market === 'US' ? fetchOverseasPrice(symbol, market) : fetchDomesticPrice(symbol))).name || '';
    } catch { /* 무시 */ }
    return '';
  }

  /** 일봉 차트(현재 공급자). KIS만 공식 지원 — 커스텀은 미지원(빈 배열). */
  async function fetchDailyChart(symbol, opts = {}) {
    const p = getProvider();
    if (p === 'kis') return fetchDailyChartKis(symbol, opts);
    throw new Error('일봉 차트는 현재 한국투자증권(KIS) 공급자에서만 지원합니다.');
  }

  /** 연결 테스트 — 설정 화면의 "연결 테스트" 버튼이 쓴다. */
  async function testConnection() {
    const p = getProvider();
    if (p === 'custom') {
      const r = await fetchCustomPrice('005930', 'KRX');
      return `커스텀 API 응답 OK — 005930 현재가 ${r.price}${r.name ? ` (${r.name})` : ''}`;
    }
    if (p === 'kis') {
      const r = await fetchDomesticPrice('005930');
      return `KIS 응답 OK — 삼성전자 현재가 ${r.price}원`;
    }
    throw new Error('공급자가 설정되지 않았습니다.');
  }

  Object.assign(window, {
    // KIS 자격증명(기존 API 유지 — 설정 화면 호환)
    getKisAppKey, getKisAppSecret, getKisEnv, setKisCredentials, hasKisKey,
    // 공급자 선택
    getStockProvider: getProvider, setStockProvider: setProvider,
    getCustomProvider, setCustomProvider, hasCustomProvider, hasQuoteProvider, stockProviderLabel: providerLabel,
    // 시세
    fetchStockPrice: fetchPrice, fetchPrices, fetchKisPrices: fetchPrices, lookupStockName: lookupName,
    fetchDomesticPrice, fetchOverseasPrice, fetchDailyChart, testStockConnection: testConnection, clearStockQuoteCache: cacheClear,
    KIS_KEY_STORAGES: { KEY_STORAGE, SECRET_STORAGE, ENV_STORAGE },
    STOCK_STORAGES: { PROVIDER_STORAGE, CUSTOM_STORAGE },
  });
})();
