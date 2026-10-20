// 증권 시세 서비스 (v7.24.0) — 한국투자증권(KIS) 개발자 API에서 현재가를 받아온다.
// 앱키/시크릿은 브라우저(localStorage)에만 저장하고, 실제 호출은 서버 프록시(/api/kis-proxy)를
// 거친다(토큰 발급·CORS 우회). 설정 화면에서 키를 등록하지 않으면 시세 기능은 "수동 입력"으로만 동작한다.
// 일반 <script>로 로드된다.
(function () {
  const KEY_STORAGE = 'workspace:stocks:kisAppKey';
  const SECRET_STORAGE = 'workspace:stocks:kisAppSecret';
  const ENV_STORAGE = 'workspace:stocks:kisEnv';
  const CACHE_PREFIX = 'workspace:stocksQuote:';
  const CACHE_TTL_MS = 1000 * 60; // 1분 — 같은 종목을 짧은 시간에 반복 조회하지 않도록.

  const get = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const set = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* 무시 */ } };

  const getKisAppKey = () => get(KEY_STORAGE);
  const getKisAppSecret = () => get(SECRET_STORAGE);
  const getKisEnv = () => get(ENV_STORAGE) || 'real';
  function setKisCredentials({ appkey, appsecret, env }) {
    set(KEY_STORAGE, (appkey || '').trim());
    set(SECRET_STORAGE, (appsecret || '').trim());
    set(ENV_STORAGE, env === 'mock' ? 'mock' : 'real');
  }
  const hasKisKey = () => !!(getKisAppKey() && getKisAppSecret());

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

  // ── KIS 국내/해외 현재가 조회 ──────────────────────────────────────────────
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

  /**
   * 보유 종목 배열의 현재가 맵을 만든다. { 'KRX:005930': 72000, ... }
   * 키가 없으면(미등록) 조용히 건너뛴다 — 화면은 "미평가"로 표시한다.
   * 실패한 종목은 errors에 담아 호출부가 토스트로 알린다.
   */
  async function fetchPrices(holdings, { force = false } = {}) {
    const out = {};
    const errors = [];
    if (!hasKisKey()) return { prices: out, errors: [{ symbol: '*', message: '한국투자증권 API 키가 등록되지 않았습니다.' }] };
    for (const h of holdings || []) {
      if (!h.symbol) continue;
      const key = `${h.market || 'KRX'}:${h.symbol}`;
      if (!force) {
        const cached = cacheGet(key);
        if (cached !== null) { out[key] = cached; continue; }
      }
      try {
        const r = h.market === 'US' ? await fetchOverseasPrice(h.symbol, h.market) : await fetchDomesticPrice(h.symbol);
        if (Number.isFinite(r.price) && r.price > 0) { out[key] = r.price; cacheSet(key, r.price); }
        else errors.push({ symbol: h.symbol, message: '현재가를 받지 못했습니다.' });
      } catch (e) {
        errors.push({ symbol: h.symbol, message: e.message || String(e) });
      }
    }
    return { prices: out, errors };
  }

  // 종목명 자동 채움용(국내) — 시세 조회와 같은 엔드포인트를 재사용한다.
  async function lookupName(symbol, market = 'KRX') {
    try {
      const r = market === 'US' ? await fetchOverseasPrice(symbol, market) : await fetchDomesticPrice(symbol);
      return r.name || '';
    } catch { return ''; }
  }

  Object.assign(window, {
    getKisAppKey, getKisAppSecret, getKisEnv, setKisCredentials, hasKisKey,
    fetchKisPrices: fetchPrices, fetchDomesticPrice, fetchOverseasPrice, lookupStockName: lookupName,
    KIS_KEY_STORAGES: { KEY_STORAGE, SECRET_STORAGE, ENV_STORAGE },
  });
})();
