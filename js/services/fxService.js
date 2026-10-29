// 환율 시계열 서비스 (v7.31.0) — 키 없이 쓰는 Frankfurter(유럽중앙은행 ECB 참조환율).
//
// 정직한 안내: ECB 참조환율은 하루 1회(영업일) 고시되는 "참고 환율"이며, 은행 고시 매매기준율·실시간 환율과 다르다
//   (보통 몇 원 안팎 차이). 주말·휴일은 값이 없다. 공공데이터 키를 쓰는 기존 방식이 실패할 때의 대체 수단으로 쓴다.
(function () {
  const HOSTS = ['https://api.frankfurter.app', 'https://api.frankfurter.dev/v1'];
  // 기간: 1주 / 10일 / 1개월 / 분기(3개월) / 반기(6개월) / 1년
  const PERIODS = [
    { key: '1w', label: '1주', days: 7 },
    { key: '10d', label: '10일', days: 10 },
    { key: '1m', label: '1개월', days: 30 },
    { key: '3m', label: '분기', days: 91 },
    { key: '6m', label: '반기', days: 182 },
    { key: '1y', label: '1년', days: 365 },
  ];
  // 표시 통화: unit = 앱에서 쓰는 이름, per = 몇 단위당 원화인지(JPY는 100엔)
  const CURRENCIES = [
    { code: 'USD', label: '미국 USD', per: 1 }, { code: 'JPY', label: '일본 JPY(100)', per: 100 },
    { code: 'EUR', label: '유로 EUR', per: 1 }, { code: 'CNY', label: '중국 CNY', per: 1 }, { code: 'GBP', label: '영국 GBP', per: 1 },
  ];
  const iso = (d) => d.toISOString().slice(0, 10);

  function rangeFor(periodKey, now = new Date()) {
    const p = PERIODS.find((x) => x.key === periodKey) || PERIODS[2];
    return { from: iso(new Date(now.getTime() - p.days * 86400000)), to: iso(now), period: p };
  }

  /** Frankfurter 시계열 응답 → [{date, v}] (KRW per `per` units). from=외화, to=KRW 응답. */
  function parseSeries(json, code, per = 1) {
    const rates = json && json.rates;
    if (!rates || typeof rates !== 'object') return [];
    return Object.keys(rates).sort()
      .map((d) => ({ date: d, v: Number(rates[d] && rates[d].KRW) * per }))
      .filter((r) => Number.isFinite(r.v) && r.v > 0);
  }

  async function getJson(path) {
    let lastErr;
    for (const host of HOSTS) {
      const url = host + path;
      for (const mode of ['direct', 'proxy']) {
        try {
          const res = await fetch(mode === 'direct' ? url : `/api/market-proxy?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(10000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return await res.json();
        } catch (e) { lastErr = e; }
      }
    }
    throw new Error(`환율 서버(Frankfurter)에 연결하지 못했습니다${lastErr ? ` — ${lastErr.message}` : ''}.`);
  }

  async function fetchSeries(code, periodKey, now = new Date()) {
    const cur = CURRENCIES.find((c) => c.code === code) || CURRENCIES[0];
    const { from, to } = rangeFor(periodKey, now);
    const j = await getJson(`/${from}..${to}?from=${cur.code}&to=KRW`);
    const rows = parseSeries(j, cur.code, cur.per);
    if (rows.length < 2) throw new Error('해당 기간의 환율 데이터가 부족합니다.');
    return rows;
  }

  /** 주요 통화 현재값 + 전일 대비. [{unit,name,rate,change,changeRate,date}] — 앱 기존 환율 행 모양과 호환. */
  async function fetchOverview(now = new Date()) {
    const out = [];
    for (const c of CURRENCIES) {
      try {
        const rows = await fetchSeries(c.code, '10d', now);
        const last = rows[rows.length - 1], prev = rows[rows.length - 2];
        out.push({ unit: c.per === 100 ? `${c.code}(100)` : c.code, code: c.code, name: c.label, rate: last.v, change: last.v - prev.v, changeRate: ((last.v - prev.v) / prev.v) * 100, date: last.date, src: 'ecb' });
      } catch { /* 개별 통화 실패는 건너뜀 */ }
    }
    if (!out.length) throw new Error('환율을 불러오지 못했습니다(네트워크 또는 Frankfurter 서버 점검).');
    return out;
  }

  const api = { PERIODS, CURRENCIES, rangeFor, parseSeries, fetchSeries, fetchOverview };
  if (typeof window !== 'undefined') window.FxService = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
