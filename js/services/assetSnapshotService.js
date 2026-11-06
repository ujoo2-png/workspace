// v7.33.0 일별 마감 자산 누적. 순수 계산(날짜 규칙·합계·백필)과 저장(ensure)을 분리해 테스트할 수 있게 한다.
// 일반 <script> + CommonJS 겸용. 저장은 appState.saveAssetSnapshot(하루 1행, 같은 날이면 갱신).
(function () {
  const CLOSE_MIN = 15 * 60 + 40; // KST 15:40 이후면 오늘 종가 확정으로 본다
  const kst = (d) => new Date(d.getTime() + 9 * 3600 * 1000); // getUTC* 로 KST 값을 읽는다
  const iso = (k) => k.toISOString().slice(0, 10);
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

  function prevWeekday(k) {
    const d = new Date(k.getTime());
    do { d.setUTCDate(d.getUTCDate() - 1); } while ([0, 6].includes(d.getUTCDay()));
    return d;
  }
  function lastWeekdayOnOrBefore(k) {
    const d = new Date(k.getTime());
    while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() - 1);
    return d;
  }

  /**
   * 지금 시각 기준으로 "실시간 시세를 종가로 기록해도 되는" 날짜를 정한다.
   * 평일 15:40 이후 → 오늘, 주말 → 직전 금요일(시세가 곧 금요일 종가), 평일 장중/장전 → null(라이브 기록 불가).
   */
  function liveCloseDate(now = new Date()) {
    const k = kst(now);
    const dow = k.getUTCDay();
    const min = k.getUTCHours() * 60 + k.getUTCMinutes();
    if (dow === 0 || dow === 6) return iso(lastWeekdayOnOrBefore(k));
    if (min >= CLOSE_MIN) return iso(k);
    return null;
  }

  /** 백필 대상 평일 날짜들(오래된 순). 장 마감 전이면 오늘은 제외. */
  function recentWeekdays(now = new Date(), count = 14) {
    const k = kst(now);
    const min = k.getUTCHours() * 60 + k.getUTCMinutes();
    let d = lastWeekdayOnOrBefore(k);
    const dow = k.getUTCDay();
    if (dow >= 1 && dow <= 5 && min < CLOSE_MIN) d = prevWeekday(k);
    const out = [];
    while (out.length < count) { out.push(iso(d)); d = prevWeekday(d); }
    return out.reverse();
  }

  const isUsd = (h) => h.currency === 'USD' || h.market === 'US';

  /** 현재가 맵으로 원화 환산 총 평가금액을 계산한다. 시세가 없는 종목은 평가에서 제외(evaluated 수로 알 수 있음). */
  function buildSnapshot(holdings, prices, usdKrw, date, source = 'live') {
    let totalValue = 0, totalCost = 0, evaluated = 0;
    const detail = [];
    for (const h of holdings) {
      const fx = isUsd(h) ? (usdKrw || 0) : 1;
      const qty = num(h.quantity);
      const cost = qty * num(h.avg_price) * fx;
      const key = `${h.market || 'KRX'}:${h.symbol}`;
      const p = prices[key];
      const hasPrice = p !== undefined && p !== null && Number.isFinite(Number(p)) && fx > 0;
      totalCost += isUsd(h) && !fx ? 0 : cost;
      if (hasPrice) { const mv = qty * Number(p) * fx; totalValue += mv; evaluated++; detail.push({ s: h.symbol, n: h.name || '', q: qty, p: Number(p), v: Math.round(mv) }); }
    }
    return {
      snap_date: date, total_value: Math.round(totalValue), total_cost: Math.round(totalCost),
      holdings_count: holdings.length, evaluated_count: evaluated,
      usd_krw: usdKrw || null, source, detail,
    };
  }

  /** 일봉 종가로 과거 날짜 합계를 추정한다(현재 보유수량 기준 → source='backfill'). */
  function backfillSnapshots(holdings, charts, usdKrw, dates, existingDates = new Set()) {
    const out = [];
    for (const date of dates) {
      if (existingDates.has(date)) continue;
      const prices = {};
      for (const h of holdings) {
        const key = `${h.market || 'KRX'}:${h.symbol}`;
        const rows = charts[key] || [];
        let close = null;
        for (const r of rows) { if (r.date <= date) close = r.v; else break; }
        if (close !== null) prices[key] = close;
      }
      const s = buildSnapshot(holdings, prices, usdKrw, date, 'backfill');
      if (s.evaluated_count > 0) out.push(s);
    }
    return out;
  }

  /** 전일 대비 변화. snaps는 날짜 오름차순. */
  function dayChange(snaps) {
    if (!snaps || snaps.length < 2) return null;
    const a = snaps[snaps.length - 1], b = snaps[snaps.length - 2];
    const diff = num(a.total_value) - num(b.total_value);
    return { diff, rate: num(b.total_value) ? (diff / num(b.total_value)) * 100 : null, from: b.snap_date, to: a.snap_date };
  }

  let running = false;
  /**
   * 열 때마다 호출해도 안전하다. 라이브 가격 가능 시점이면 오늘(또는 직전 금요일) 종가를 기록하고,
   * 비어 있는 최근 평일은 일봉으로 보충한다. 실패는 조용히 무시(다음에 다시 시도).
   */
  async function ensure({ prices, now = new Date(), backfill = true } = {}) {
    if (running) return { skipped: 'running' };
    const st = window.appState;
    if (!st || !st.user) return { skipped: 'nouser' };
    const holdings = (st.stockHoldings || []).filter((h) => !h.deleted_at && h.symbol);
    if (!holdings.length) return { skipped: 'noholdings' };
    running = true;
    const saved = [];
    try {
      const exist = new Map((st.assetSnapshots || []).map((r) => [r.snap_date, r]));
      let usdKrw = null;
      if (holdings.some(isUsd) && window.FxService) {
        try { usdKrw = (await window.FxService.fetchOverview()).find((c) => c.code === 'USD')?.rate || null; } catch { /* 환율 없으면 해외 종목은 제외 */ }
      }
      const liveDate = liveCloseDate(now);
      let px = prices;
      if (liveDate && (!px || !Object.keys(px).length) && window.hasQuoteProvider && window.hasQuoteProvider()) {
        try { px = (await window.fetchPrices(holdings, {})).prices; } catch { px = null; }
      }
      if (liveDate && px && Object.keys(px).length) {
        const snap = buildSnapshot(holdings, px, usdKrw, liveDate, 'live');
        const prev = exist.get(liveDate);
        // 이미 같은 날 라이브 기록이 있으면 평가 종목 수가 더 많을 때만 갱신
        if (snap.evaluated_count > 0 && (!prev || prev.source !== 'live' || snap.evaluated_count >= num(prev.evaluated_count))) {
          await st.saveAssetSnapshot(snap); saved.push(snap);
          exist.set(liveDate, snap);
        }
      }
      if (backfill && window.hasQuoteProvider && window.hasQuoteProvider() && window.fetchDailyChart) {
        const dates = recentWeekdays(now, 14).filter((d) => !exist.has(d));
        if (dates.length) {
          const charts = {};
          await Promise.all(holdings.map(async (h) => {
            try { const r = await window.fetchDailyChart(h.symbol, { market: h.market || 'KRX', days: 40 }); charts[`${h.market || 'KRX'}:${h.symbol}`] = r.rows || []; } catch { /* 종목 하나 실패는 건너뜀 */ }
          }));
          for (const s of backfillSnapshots(holdings, charts, usdKrw, dates, new Set(exist.keys()))) {
            // 보충분은 평가된 종목 수가 전체의 절반 이상일 때만 저장(들쭉날쭉한 값 방지)
            if (s.evaluated_count * 2 < holdings.length) continue;
            await st.saveAssetSnapshot(s); saved.push(s);
          }
        }
      }
      return { saved };
    } catch (e) {
      return { error: e && e.message };
    } finally { running = false; }
  }

  const api = { liveCloseDate, recentWeekdays, buildSnapshot, backfillSnapshots, dayChange, ensure };
  if (typeof window !== 'undefined') window.AssetSnapshot = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
