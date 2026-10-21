// 오늘의 시황 · 환율 서비스 (v7.25.0).
//
// 정직한 안내(가짜 데이터를 만들지 않는다):
//   · 시황(지수): 공식 무료 지수 API 중 키 없이 브라우저에서 바로 쓸 수 있는 것은 사실상 없다.
//     이 앱은 (a) 한국투자증권(KIS) 공급자가 설정되어 있으면 국내업종 현재지수 API로 코스피/코스닥 등을,
//     (b) 그렇지 않으면 사용자가 등록한 커스텀 API(설정 → 증권)로 지수를 받아온다.
//     어느 것도 없으면 "시황을 표시하려면 설정이 필요합니다"라고 안내만 하고, 값을 지어내지 않는다.
//   · 환율: 공공데이터포털의 "한국수출입은행 환율정보" API(무료 키)를 쓴다. 이미 공공데이터포털 키를
//     등록한 사용자는 그대로 동작한다(단, 해당 오픈API 활용신청이 승인되어 있어야 함).
//
// 일반 <script>로 로드된다. stockService.js, publicDataService.js 뒤에 로드되어야 한다.
(function () {
  const CACHE_PREFIX = 'workspace:market:cache:';
  const FX_INDEX_STORAGE = 'workspace:market:fxEnabled';
  const FX_SOURCE_STORAGE = 'workspace:market:fxSource';   // 'public' | 'custom' | 'kis'
  const FX_CUSTOM_ID_STORAGE = 'workspace:market:fxCustomApiId'; // 커스텀 API 관리에 등록한 API id

  const get = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const set = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} };
  const getJson = (k) => { try { return JSON.parse(get(k)) || null; } catch { return null; } };

  const getFxEnabled = () => get(FX_INDEX_STORAGE) !== '0';
  const setFxEnabled = (on) => set(FX_INDEX_STORAGE, on ? '1' : '0');

  // ── 환율 데이터 출처 ───────────────────────────────────────────────────────
  //  · 'public' : 공공데이터포털 "한국수출입은행 환율정보" API(기본, 공공데이터 키 재사용)
  //  · 'custom' : 설정 → 커스텀 API 관리에 등록한 API를 환율 소스로 지정
  //  · 'kis'    : (해당 없음 — 향후 확장 여지)
  // ※ 사용자가 "커스텀 API 관리"에 한국수출입은행 API를 등록해도 기본값은 공공데이터포털이라
  //   증권 화면과 연결되지 않던 문제를 해결하기 위해, 출처를 명시적으로 고를 수 있게 한다.
  const getFxSource = () => { const v = get(FX_SOURCE_STORAGE); return ['public', 'custom'].includes(v) ? v : 'public'; };
  const setFxSource = (s) => set(FX_SOURCE_STORAGE, s === 'custom' ? 'custom' : 'public');
  const getFxCustomApiId = () => get(FX_CUSTOM_ID_STORAGE);
  const setFxCustomApiId = (id) => set(FX_CUSTOM_ID_STORAGE, id || '');

  function cacheGet(key, ttlMs) {
    const box = getJson(CACHE_PREFIX + key);
    if (!box) return null;
    if (ttlMs && Date.now() - box.savedAt > ttlMs) return null;
    return box.data;
  }
  function cacheSet(key, data) { set(CACHE_PREFIX + key, JSON.stringify({ savedAt: Date.now(), data })); }

  const todayCompact = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');

  // ── 환율 ──────────────────────────────────────────────────────────────────
  // 한국수출입은행 "환율정보" (공공데이터포털). searchdate=YYYYMMDD, data=AP01(매매기준율).
  // 응답: [{ result:1, cur_unit:'USD', cur_nm:'미국 달러', deal_bas_r:'1,350.5', ... }]
  async function fetchExchangeRatesPublic({ date } = {}) {
    const key = window.getPublicDataKey && window.getPublicDataKey();
    if (!key) throw new Error('환율을 보려면 설정에서 공공데이터포털 API 키를 등록하고, "한국수출입은행 환율정보" 오픈API를 활용신청하세요.');

    const base = 'https://apis.data.go.kr/B552180/exchRate/exchange';
    const qs = new URLSearchParams({ serviceKey: key, dataType: 'JSON', numOfRows: '100', pageNo: '1', searchdate: date || todayCompact() });

    let res;
    try { res = await fetch(`${base}?${qs.toString()}`); }
    catch { throw new Error('환율 API에 연결하지 못했습니다(네트워크 또는 CORS 문제일 수 있습니다).'); }
    if (!res.ok) throw new Error(`환율 요청이 실패했습니다(HTTP ${res.status}). 활용신청 승인 여부를 확인하세요.`);

    const text = await res.text();
    let items = [];
    try {
      const json = JSON.parse(text);
      const header = json?.response?.header;
      if (header && header.resultCode && header.resultCode !== '00') throw new Error(header.resultMsg || '환율 API 오류');
      const raw = json?.response?.body?.items?.item || json?.response?.body?.items;
      items = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
    } catch (e) {
      if (e instanceof Error && !e.message.includes('JSON')) throw e;
      throw new Error('환율 응답을 해석하지 못했습니다.');
    }

    const rows = items.map((it) => {
      const raw = String(it.deal_bas_r ?? it.dealBasR ?? '').replace(/,/g, '');
      return { unit: it.cur_unit, name: it.cur_nm, rate: Number(raw), date: date || todayCompact() };
    }).filter((r) => Number.isFinite(r.rate));
    if (!rows.length) throw new Error('해당 날짜의 환율 고시가 없습니다(주말·공휴일일 수 있습니다). 다른 날짜로 시도하세요.');
    return rows;
  }

  // 커스텀 API 관리에 등록한 API를 환율 소스로 쓴다.
  // 한국수출입은행 응답(deal_bas_r/cur_unit/cur_nm) 또는 일반적인 {unit/name/rate} 구조를 모두 인식한다.
  async function fetchExchangeRatesCustom() {
    const id = getFxCustomApiId();
    if (!id) throw new Error('환율 소스로 쓸 커스텀 API를 설정에서 선택하세요(설정 → 오늘의 시황 · 환율).');
    const api = (window.listCustomApis ? window.listCustomApis() : []).find((a) => a.id === id);
    if (!api) throw new Error('선택한 커스텀 API를 찾지 못했습니다. 설정에서 다시 선택하세요.');
    const result = await window.fetchCustomApi(api, {});
    const data = result && result.kind === 'json' ? result.data : null;
    if (!data) throw new Error('커스텀 API 응답이 JSON이 아닙니다.');
    // 응답에서 환율 배열을 최대한 관대하게 찾는다.
    const arr = extractFxArray(data);
    if (!arr.length) throw new Error('커스텀 API 응답에서 환율 배열을 찾지 못했습니다(unit/cur_unit + rate/deal_bas_r 필드 필요).');
    const rows = arr.map((it) => {
      const unit = String(it.cur_unit ?? it.unit ?? it.currency ?? it.symbol ?? '').trim();
      const name = it.cur_nm ?? it.name ?? unit;
      const rate = Number(String(it.deal_bas_r ?? it.rate ?? it.price ?? it.value ?? it.baseRate ?? '').replace(/,/g, ''));
      return { unit, name, rate, date: todayCompact() };
    }).filter((r) => r.unit && Number.isFinite(r.rate));
    if (!rows.length) throw new Error('커스텀 API에서 읽은 환율 값이 올바르지 않습니다.');
    return rows;
  }

  /** 응답 JSON 안에서 환율처럼 보이는 배열을 관대하게 찾는다. */
  function extractFxArray(root) {
    if (Array.isArray(root)) return root.filter((x) => x && typeof x === 'object');
    if (!root || typeof root !== 'object') return [];
    const candidates = [
      root?.response?.body?.items?.item, root?.response?.body?.items, root?.items, root?.data, root?.result, root?.list, root?.rows,
    ];
    for (const c of candidates) {
      if (Array.isArray(c) && c.length && typeof c[0] === 'object') return c;
      if (c && typeof c === 'object' && !Array.isArray(c)) { const inner = extractFxArray(c); if (inner.length) return inner; }
    }
    return [];
  }

  /** 환율(현재 소스 기준). */
  async function fetchExchangeRates({ date } = {}) {
    const source = getFxSource();
    const cacheKey = `fx:${source}:${source === 'custom' ? getFxCustomApiId() : 'public'}:${date || 'today'}`;
    const cached = cacheGet(cacheKey, 1000 * 60 * 60 * 3); // 3시간 캐시(환율은 하루 몇 번 고시)
    if (cached) return cached;

    const rows = source === 'custom'
      ? await fetchExchangeRatesCustom()
      : await fetchExchangeRatesPublic({ date });
    cacheSet(cacheKey, rows);
    return rows;
  }

  // 주요 통화만 골라 우선 표시(전체는 '더보기').
  const MAJOR = ['USD', 'JPY(100)', 'EUR', 'CNY', 'GBP'];
  function orderMajor(rows) {
    const majors = MAJOR.map((u) => rows.find((r) => r.unit === u)).filter(Boolean);
    const rest = rows.filter((r) => !majors.includes(r));
    return { majors, rest };
  }

  // ── 시황(지수) ────────────────────────────────────────────────────────────
  // (a) KIS 국내업종 현재지수 — tr_id FHPUP02100000 계열로 코스피/코스닥 등 업종지수를 받는다.
  // (b) 커스텀 API — 사용자가 등록한 URL/경로에서 지수 배열을 받는다.
  const KIS_INDEX = [
    { code: '0001', label: '코스피' },
    { code: '1001', label: '코스닥' },
    { code: '2001', label: '코스피200' },
    { code: '1004', label: 'KRX100' },
  ];

  async function fetchIndicesKis() {
    const out = [];
    for (const ix of KIS_INDEX) {
      try {
        const res = await fetch(
          `/api/kis-proxy?path=${encodeURIComponent('/uapi/domestic-stock/v1/quotations/inquire-index-price')}&tr_id=FHPUP02100000&params=${encodeURIComponent(JSON.stringify({ fid_cond_mrkt_div_code: 'U', fid_input_iscd: ix.code }))}`,
          { headers: { 'x-kis-appkey': window.getKisAppKey(), 'x-kis-appsecret': window.getKisAppSecret(), 'x-kis-env': window.getKisEnv() }, signal: AbortSignal.timeout(12000) }
        );
        const data = await res.json();
        const o = data.output || {};
        const v = Number(String(o.bstp_nmix_prpr || o.bstp_nmix_prdy_clpr || '').replace(/,/g, ''));
        const cr = Number(String(o.bstp_nmix_prdy_ctrt || '').replace(/,/g, ''));
        if (Number.isFinite(v) && v > 0) out.push({ label: ix.label, value: v, changeRate: Number.isFinite(cr) ? cr : null });
      } catch { /* 개별 지수 실패는 건너뛴다 */ }
    }
    return out;
  }

  async function fetchIndicesCustom() {
    const cfg = window.getCustomProvider && window.getCustomProvider();
    const byPath = cfg && cfg.paths && cfg.paths.indices;
    const url = cfg && (cfg.indicesUrl || '');
    if (!url) throw new Error('커스텀 API에 지수 URL이 설정되지 않았습니다.');
    const res = await fetch('/api/stock-proxy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, headers: cfg.headers || {} }), signal: AbortSignal.timeout(12000) });
    const data = await res.json();
    const arr = byPath ? byPath.split('.').reduce((o, s) => (o == null ? o : o[s]), data) : data;
    if (!Array.isArray(arr)) throw new Error('지수 배열을 찾지 못했습니다.');
    return arr.map((it) => ({ label: it.label || it.name, value: Number(String(it.value ?? it.close).replace(/,/g, '')), changeRate: Number(String(it.changeRate ?? it.rate ?? '').replace(/,/g, '')) || null })).filter((r) => r.label && Number.isFinite(r.value));
  }

  /** 오늘의 시황(지수 배열). 공급자 설정에 따라 KIS/커스텀/없음을 판단한다. */
  async function fetchIndices() {
    const cacheKey = 'indices:today';
    const cached = cacheGet(cacheKey, 1000 * 60 * 5); // 5분 캐시(장중에는 자주 바뀜)
    if (cached) return cached;

    const provider = window.getStockProvider ? window.getStockProvider() : 'kis';
    let rows = [];
    if (provider === 'kis' && window.hasKisKey()) rows = await fetchIndicesKis();
    else if (provider === 'custom') rows = await fetchIndicesCustom();

    if (!rows.length) throw new Error('시황(지수)을 표시하려면 설정 → 증권 시세 API에서 KIS 키 또는 커스텀 지수 API를 등록하세요.');
    cacheSet(cacheKey, rows);
    return rows;
  }

  Object.assign(window, {
    fetchExchangeRates, orderMajorFx: orderMajor,
    fetchIndices, getFxEnabled, setFxEnabled,
    getFxSource, setFxSource, getFxCustomApiId, setFxCustomApiId,
    MARKET_STORAGES: { FX_INDEX_STORAGE, FX_SOURCE_STORAGE, FX_CUSTOM_ID_STORAGE },
  });
})();
