// 네이버 증권 시세 서비스 (v7.31.0) — 조회 전용(주문 없음).
//
// 정직한 안내: 네이버 증권은 "공식 API"가 없다. 아래 주소는 네이버 모바일 증권 화면이 쓰는 비공식 JSON이라
//   예고 없이 바뀌거나 막힐 수 있다. 브라우저 CORS 때문에 서버 프록시(/api/market-proxy, 허용 호스트 고정)를 거친다.
//   KIS처럼 키·토큰이 필요 없어 "조회할 때마다 카톡 알림"이 오지 않는다.
// 파서는 순수 함수(네트워크 없음)라 테스트할 수 있고, 응답 모양이 조금 달라도 읽도록 관대하게 만들었다.
(function () {
  const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(/[,%\s+]/g, '').replace(/^−/, '-'));
    return Number.isFinite(n) ? n : null;
  };

  /** 종목 한 건 → {symbol,name,price,change,changeRate,prevClose,currency,state}. 모양이 다른 두 응답을 모두 읽는다. */
  function parseQuote(json, { symbol = '', currency = 'KRW' } = {}) {
    const o = Array.isArray(json?.datas) ? json.datas[0] : Array.isArray(json) ? json[0] : json;
    if (!o || typeof o !== 'object') return null;
    const price = num(o.closePrice ?? o.nowVal ?? o.now ?? o.price);
    if (price === null || price <= 0) return null;
    let change = num(o.compareToPreviousClosePrice ?? o.cv);
    let rate = num(o.fluctuationsRatio ?? o.cr);
    // 하락이면 부호가 값에 없고 compareToPreviousPrice.code(5=하락,4=하한)로만 오는 경우가 있다.
    const code = String(o.compareToPreviousPrice?.code ?? o.compareToPreviousPrice?.name ?? '');
    const down = /^(4|5)$|FALL|DOWN|LOWER/i.test(code);
    if (down) { if (change !== null) change = -Math.abs(change); if (rate !== null) rate = -Math.abs(rate); }
    const prev = change !== null ? price - change : null;
    return {
      symbol: String(o.itemCode ?? o.symbolCode ?? symbol),
      name: String(o.stockName ?? o.itemName ?? o.name ?? ''),
      price, change, changeRate: rate, prevClose: prev, currency,
      state: String(o.marketStatus ?? ''),
      high: num(o.highPrice), low: num(o.lowPrice), open: num(o.openPrice), volume: num(o.accumulatedTradingVolume),
    };
  }

  /** 지수(KOSPI 등) basic 응답 → {label,value,changeRate}. */
  function parseIndex(json, label) {
    const q = parseQuote(json);
    return q ? { label, value: q.price, changeRate: q.changeRate } : null;
  }

  /** 일봉 → [{date:'YYYY-MM-DD', v, o,h,l}]. api.stock.naver.com 배열 / fchart siseJson 텍스트 모두 지원. */
  function parseChart(input) {
    let rows = [];
    if (typeof input === 'string') {
      // siseJson: 작은따옴표/줄바꿈이 섞인 JS 배열 문자열. 행마다 ["20250102", 시가, 고가, 저가, 종가, 거래량, 외인소진율]
      const re = /\[\s*"?'?(\d{8})'?"?\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/g;
      let m;
      while ((m = re.exec(input))) rows.push({ d: m[1], o: +m[2], h: +m[3], l: +m[4], c: +m[5] });
    } else {
      const arr = Array.isArray(input) ? input : Array.isArray(input?.priceInfos) ? input.priceInfos : Array.isArray(input?.priceInfo) ? input.priceInfo : [];
      rows = arr.map((r) => ({ d: String(r.localDate ?? r.localTradedAt ?? r.date ?? '').slice(0, 8), o: num(r.openPrice), h: num(r.highPrice), l: num(r.lowPrice), c: num(r.closePrice) }));
    }
    return rows
      .filter((r) => /^\d{8}$/.test(r.d) && Number.isFinite(r.c) && r.c > 0)
      .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))
      .map((r) => ({ date: `${r.d.slice(0, 4)}-${r.d.slice(4, 6)}-${r.d.slice(6, 8)}`, v: r.c, o: r.o, h: r.h, l: r.l }));
  }

  /** 해외 종목 → 네이버 reuters 코드 후보. 이미 'AAPL.O' 형태면 그대로. */
  function overseasCandidates(symbol) {
    const s = String(symbol || '').trim().toUpperCase();
    if (!s) return [];
    if (/\.[A-Z]{1,2}$/.test(s)) return [s];
    return [`${s}.O`, `${s}.K`, `${s}`]; // O=나스닥, K=NYSE(American 등), 코드만(지수·ETF)
  }

  const periodStart = (days, now = new Date()) => {
    const d = new Date(now.getTime() - days * 86400000);
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  };

  // ── 네트워크 ────────────────────────────────────────────────────────────
  async function viaProxy(url, { json = true, timeout = 10000 } = {}) {
    let res;
    try { res = await fetch(`/api/market-proxy?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(timeout) }); }
    catch { throw new Error('시세 서버(프록시)에 연결하지 못했습니다. 배포 상태·네트워크를 확인하세요.'); }
    const text = await res.text();
    if (!res.ok) {
      let msg = '';
      try { msg = JSON.parse(text).error || ''; } catch { /* 무시 */ }
      throw new Error(msg || `네이버 증권 응답 오류(HTTP ${res.status}). 비공식 주소가 바뀌었을 수 있습니다.`);
    }
    if (!json) return text;
    try { return JSON.parse(text); } catch { throw new Error('네이버 증권 응답을 읽지 못했습니다(형식 변경 가능성).'); }
  }

  async function fetchQuote(symbol, market = 'KRX') {
    if (market === 'US') {
      let lastErr;
      for (const code of overseasCandidates(symbol)) {
        try {
          const j = await viaProxy(`https://api.stock.naver.com/stock/${encodeURIComponent(code)}/basic`);
          const q = parseQuote(j, { symbol, currency: 'USD' });
          if (q) return { ...q, symbol, naverCode: code };
        } catch (e) { lastErr = e; }
      }
      throw lastErr || new Error(`${symbol} 해외 시세를 찾지 못했습니다(종목코드 확인: 예 AAPL 또는 AAPL.O).`);
    }
    const j = await viaProxy(`https://m.stock.naver.com/api/stock/${encodeURIComponent(symbol)}/basic`);
    const q = parseQuote(j, { symbol, currency: 'KRW' });
    if (!q) throw new Error(`${symbol} 시세를 읽지 못했습니다(종목코드 확인).`);
    return { ...q, symbol };
  }

  async function fetchChart(symbol, market = 'KRX', days = 120) {
    const end = periodStart(0), start = periodStart(days);
    if (market === 'US') {
      for (const code of overseasCandidates(symbol)) {
        try {
          const j = await viaProxy(`https://api.stock.naver.com/chart/foreign/item/${encodeURIComponent(code)}/day?startDateTime=${start}0000&endDateTime=${end}2359`);
          const rows = parseChart(j);
          if (rows.length) return rows;
        } catch { /* 다음 후보 */ }
      }
      throw new Error('해외 종목 차트를 받지 못했습니다.');
    }
    try {
      const j = await viaProxy(`https://api.stock.naver.com/chart/domestic/item/${encodeURIComponent(symbol)}/day?startDateTime=${start}0000&endDateTime=${end}2359`);
      const rows = parseChart(j);
      if (rows.length) return rows;
    } catch { /* 폴백으로 */ }
    const t = await viaProxy(`https://fchart.stock.naver.com/siseJson.nhn?symbol=${encodeURIComponent(symbol)}&requestType=1&startTime=${start}&endTime=${end}&timeframe=day`, { json: false });
    const rows = parseChart(t);
    if (!rows.length) throw new Error('차트 데이터를 받지 못했습니다.');
    return rows;
  }

  const INDEX_CODES = [
    { code: 'KOSPI', label: '코스피' }, { code: 'KOSDAQ', label: '코스닥' },
  ];
  async function fetchIndices() {
    const out = [];
    for (const ix of INDEX_CODES) {
      try { const r = parseIndex(await viaProxy(`https://m.stock.naver.com/api/index/${ix.code}/basic`), ix.label); if (r) out.push(r); } catch { /* 개별 실패 건너뜀 */ }
    }
    return out;
  }

  const api = { num, parseQuote, parseIndex, parseChart, overseasCandidates, fetchQuote, fetchChart, fetchIndices };
  if (typeof window !== 'undefined') window.NaverService = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
