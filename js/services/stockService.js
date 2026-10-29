// 증권 시세 서비스 (v7.25.0) — 여러 증권 API 공급자를 지원한다.
//
// 지원 공급자(provider):
//   · 'naver'  : (v7.31.0, 기본값) 네이버 증권 비공식 JSON — 키·토큰이 필요 없어 카톡 알림이 오지 않는다. 조회 전용.
//   · 'kis'    : 한국투자증권(KIS) 개발자 API(공식, 키 필요). 국내/해외 현재가 + 일봉 차트.
//   · 'custom' : 사용자가 직접 등록하는 "아무 HTTP JSON API". URL 템플릿 + 응답 필드 경로만 지정하면
//                어떤 증권사/개인 API든 연결할 수 있다(코드 수정 불필요). 프록시(/api/stock-proxy)를 거친다.
//   · 'none'   : 외부 연동 없이 수동 입력만(기본값).
//
// 정직한 안내:
//   · 네이버 증권은 공식 시세 API가 없다. 'naver' 공급자는 네이버 모바일 증권이 쓰는 비공식 주소를 서버 프록시
//     (/api/market-proxy, 허용 호스트 고정)로 읽기만 한다. 주소가 바뀌면 동작이 멈출 수 있고 약관상 보장이 없다.
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
  const getProvider = () => get(PROVIDER_STORAGE) || 'naver'; // v7.31.0: 기본 네이버(KIS는 조회마다 카톡 알림이 와서)
  const setProvider = (p) => set(PROVIDER_STORAGE, ['naver', 'kis', 'custom', 'none'].includes(p) ? p : 'naver');
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
    if (p === 'naver') return true;
    return false;
  }
  const providerLabel = () => {
    const p = getProvider();
    if (p === 'custom') return getCustomProvider()?.name || '커스텀 API';
    if (p === 'kis') return '한국투자증권(KIS)';
    if (p === 'naver') return '네이버 증권(비공식)';
    return '수동 입력';
  };

  function cacheGet(key) {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      const { savedAt, price, quote } = JSON.parse(raw);
      if (Date.now() - savedAt > CACHE_TTL_MS) return null;
      return quote || { price };
    } catch { return null; }
  }
  function cacheSet(key, quote) {
    try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ savedAt: Date.now(), price: quote.price, quote })); } catch {}
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

  // v7.31.0: 서버리스는 콜드스타트마다 토큰을 새로 발급해 KIS가 매번 카톡 알림을 보냈다 → 발급받은 토큰을 이 브라우저에 보관했다가
  //          재사용한다(KIS 토큰 유효 24시간, 여기선 20시간만 사용). 만료/거부되면 한 번만 새로 받는다.
  const TOKEN_STORAGE = 'workspace:stocks:kisToken';
  const TOKEN_TTL_MS = 20 * 3600 * 1000;
  function readToken() {
    const t = getJson(TOKEN_STORAGE);
    if (!t || !t.token || Date.now() - t.at > TOKEN_TTL_MS || t.key !== getKisAppKey() || t.env !== getKisEnv()) return '';
    return t.token;
  }
  const saveToken = (token) => set(TOKEN_STORAGE, token ? JSON.stringify({ token, at: Date.now(), key: getKisAppKey(), env: getKisEnv() }) : '');

  async function callKis(path, trId, params, retried = false) {
    const cached = readToken();
    const res = await fetch(
      `/api/kis-proxy?path=${encodeURIComponent(path)}&tr_id=${encodeURIComponent(trId)}&params=${encodeURIComponent(JSON.stringify(params))}`,
      { headers: { 'x-kis-appkey': getKisAppKey(), 'x-kis-appsecret': getKisAppSecret(), 'x-kis-env': getKisEnv(), ...(cached ? { 'x-kis-token': cached } : {}) }, signal: AbortSignal.timeout(12000) }
    );
    const issued = res.headers.get('x-kis-token');
    if (issued) saveToken(issued);
    const text = await res.text();
    if (cached && !retried && (res.status === 401 || /EGW00(121|123)/.test(text))) { saveToken(''); return callKis(path, trId, params, true); }
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
    if (p === 'naver') return window.NaverService.fetchQuote(symbol, market);
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
    const quotes = {};
    const errors = [];
    if (!hasQuoteProvider()) return { prices: out, quotes, errors: [{ symbol: '*', message: `${providerLabel()} 시세 정보가 등록되지 않았습니다(설정 → 연동).` }] };
    const todo = [];
    const seen = new Set();
    for (const h of holdings || []) {
      if (!h.symbol) continue;
      const key = `${h.market || 'KRX'}:${h.symbol}`;
      if (seen.has(key)) continue; // 같은 종목이 여러 계좌에 있어도 한 번만 조회
      seen.add(key);
      if (!force) {
        const cached = cacheGet(key);
        if (cached) { out[key] = cached.price; quotes[key] = cached; continue; }
      }
      todo.push({ h, key });
    }
    // 네이버는 키가 없어 가볍게 병렬(4개씩), KIS/커스텀은 호출 제한을 고려해 순차.
    const width = getProvider() === 'naver' ? 4 : 1;
    for (let i = 0; i < todo.length; i += width) {
      await Promise.all(todo.slice(i, i + width).map(async ({ h, key }) => {
        try {
          const r = await fetchPrice(h.symbol, h.market || 'KRX');
          if (Number.isFinite(r.price) && r.price > 0) { out[key] = r.price; quotes[key] = { ...r, at: Date.now() }; cacheSet(key, quotes[key]); }
          else errors.push({ symbol: h.symbol, message: '현재가를 받지 못했습니다.' });
        } catch (e) {
          errors.push({ symbol: h.symbol, message: e.message || String(e) });
        }
      }));
    }
    return { prices: out, quotes, errors };
  }

  /** 종목명 자동 채움(현재 공급자). */
  async function lookupName(symbol, market = 'KRX') {
    const p = getProvider();
    try {
      if (p === 'naver') return (await window.NaverService.fetchQuote(symbol, market)).name || '';
      if (p === 'custom') return await lookupNameCustom(symbol, market);
      if (p === 'kis') return (await (market === 'US' ? fetchOverseasPrice(symbol, market) : fetchDomesticPrice(symbol))).name || '';
    } catch { /* 무시 */ }
    return '';
  }

  /** 일봉 차트(현재 공급자). KIS만 공식 지원 — 커스텀은 미지원(빈 배열). */
  async function fetchDailyChart(symbol, opts = {}) {
    const p = getProvider();
    if (p === 'naver') return { symbol, rows: await window.NaverService.fetchChart(symbol, opts.market || 'KRX', opts.days || 120) };
    if (p === 'kis' && (opts.market || 'KRX') === 'KRX') return fetchDailyChartKis(symbol, opts);
    throw new Error('일봉 차트는 네이버 증권 또는 한국투자증권(국내)에서 지원합니다.');
  }

  /** 연결 테스트 — 설정 화면의 "연결 테스트" 버튼이 쓴다. */
  async function testConnection() {
    const p = getProvider();
    if (p === 'naver') {
      const r = await window.NaverService.fetchQuote('005930', 'KRX');
      return `네이버 증권 응답 OK — ${r.name || '삼성전자'} 현재가 ${r.price}원 (비공식 주소: 변경되면 실패할 수 있음)`;
    }
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
