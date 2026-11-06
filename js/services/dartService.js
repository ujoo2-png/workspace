// v7.33.0 OpenDART(전자공시) 클라이언트. 브라우저 → /api/dart-proxy(서버리스) → opendart.fss.or.kr.
// korean-dart-mcp는 PC용 MCP(stdio)라 웹앱에 직접 못 붙이므로, 같은 OpenDART 공개 API를 프록시로 호출한다.
// API 키는 설정(settingsSync 'workspace:stocks:dartKey')에 저장하고 요청 헤더(x-dart-key)로만 보낸다.
(function () {
  const KEY = 'workspace:stocks:dartKey';
  const sync = () => (typeof window !== 'undefined' && window.settingsSync) || null;
  const getKey = () => { try { const s = sync(); return String((s ? s.get(KEY) : localStorage.getItem(KEY)) || '').trim(); } catch { return ''; } };
  const setKey = (v) => { try { const s = sync(); const val = String(v || '').trim(); if (s) s.set(KEY, val); else if (val) localStorage.setItem(KEY, val); else localStorage.removeItem(KEY); } catch { /* 저장소 차단 */ } };
  const hasDartKey = () => /^[0-9a-fA-F]{40}$/.test(getKey());

  const TTL = 30 * 60 * 1000;
  const cache = new Map(); // url → { at, data }
  // 종목코드 → corp_code 매핑을 브라우저에 보관해 서버가 3MB짜리 corpCode.zip을 매번 받지 않게 한다(첫 조회만 느림).
  const CORP_KEY = 'workspace:dartCorps';
  const corpMap = () => { try { return JSON.parse(localStorage.getItem(CORP_KEY)) || {}; } catch { return {}; } };
  const rememberCorps = (list) => { try { const m = corpMap(); for (const x of list || []) if (x && x.stock_code && x.corp_code) m[x.stock_code] = { c: x.corp_code, n: x.corp_name || '' }; localStorage.setItem(CORP_KEY, JSON.stringify(m)); } catch { /* 용량 */ } };
  function withHints(params) {
    const codes = new Set(String(params.codes || params.stock_code || '').split(',').filter(Boolean)); if (!codes.size) return params;
    const m = corpMap(); const hint = [...codes].filter((c) => m[c]).map((c) => `${c}:${m[c].c}:${encodeURIComponent(m[c].n || '')}`);
    return hint.length ? { ...params, corps: hint.join(',') } : params;
  }
  async function call(params, { force = false } = {}) {
    params = withHints(params);
    const key = getKey();
    if (!/^[0-9a-fA-F]{40}$/.test(key)) throw new Error('OpenDART API 키가 없습니다(설정 → 증권 시세 API → OpenDART).');
    const qs = new URLSearchParams(params).toString();
    const hit = cache.get(qs);
    if (!force && hit && Date.now() - hit.at < TTL) return hit.data;
    const res = await fetch(`/api/dart-proxy?${qs}`, { headers: { 'x-dart-key': key } });
    let data = null; try { data = await res.json(); } catch { /* JSON 아님 */ }
    if (!res.ok) throw new Error((data && data.error) || `DART 프록시 오류(${res.status})`);
    cache.set(qs, { at: Date.now(), data });
    if (data) { rememberCorps(data.results); if (data.corp) rememberCorps([{ stock_code: params.stock_code, corp_code: data.corp.corp_code, corp_name: data.corp.corp_name }]); if (data.map) rememberCorps(data.map); }
    return data;
  }

  const isKrx = (h) => (h.market || 'KRX') === 'KRX' && /^\d{6}$/.test(String(h.symbol || ''));
  /** 보유 종목(국내)의 최근 공시. 반환: [{stock_code, corp_name, items|error}] */
  async function fetchDisclosures(holdings, { days = 30, force = false } = {}) {
    const codes = [...new Set((holdings || []).filter(isKrx).map((h) => h.symbol))].slice(0, 30);
    if (!codes.length) return [];
    const d = await call({ op: 'disclosures', codes: codes.join(','), days: String(days) }, { force });
    return d.results || [];
  }
  const fetchFinancials = (symbol, year, reprt = '11011', opts) => call({ op: 'fin', stock_code: symbol, ...(year ? { year: String(year) } : {}), reprt }, opts);
  const filingUrl = (rceptNo) => `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(rceptNo)}`;
  async function testDart() {
    const d = await call({ op: 'ping' }, { force: true });
    if (!d.ok) throw new Error(`${d.message || '키 확인 실패'} (${d.status})`);
    return true;
  }
  const searchCorp = (q) => call({ op: 'search', q });
  const insider = (code, days = 365, o) => call({ op: 'insider', stock_code: code, days: String(days) }, o);
  const anomaly = (code, o) => call({ op: 'anomaly', stock_code: code, years: '3' }, o);
  const report = (code, q, o) => call({ op: 'report', stock_code: code, q: q || '' }, o);
  const preset = (name, days = 30, o) => call({ op: 'preset', preset: name, days: String(days) }, o);
  const quality = (codes, o) => call({ op: 'quality', codes: codes.join(',') }, o);
  const PRESET_LIST = [['buyback', '자기주식 취득'], ['buyback_dispose', '자기주식 처분'], ['rights', '유상증자'], ['cb', 'CB·BW·EB 발행'], ['merger', '합병·분할'], ['bonus', '무상증자'], ['capred', '감자'], ['dividend', '배당 결정']];
  const clearDartCache = () => cache.clear();

  const api = { searchCorp, insider, anomaly, report, preset, quality, PRESET_LIST, KEY, getKey, setKey, hasDartKey, fetchDisclosures, fetchFinancials, filingUrl, testDart, clearDartCache, isKrx };
  if (typeof window !== 'undefined') window.DartService = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
