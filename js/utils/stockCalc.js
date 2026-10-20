// 증권 손익 계산 순수 함수 모음 (v7.24.0). 테스트 가능하도록 부작용 없이 작성한다.
// 시세는 서버(KIS API)에서 받아오고, 여기서는 "숫자만" 다룬다 — 평가금액/손익/수익률/비중 계산.
// 일반 <script>로 로드되므로 globalThis.* 전역 함수로 등록한다(브라우저·Node 동일).
(function () {
  const num = (v) => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[,\s]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };

  /**
   * 보유 종목 한 건의 평가 결과를 계산한다.
   * @param {{quantity:number, avg_price:number}} h 보유 정보
   * @param {number|null} price 현재가(주당). 없으면(null) 손익은 계산하지 않는다(0 처리, evaluated=false).
   * @returns {{cost:number, marketValue:number|null, pnl:number|null, pnlRate:number|null, evaluated:boolean}}
   */
  function evaluateHolding(h, price) {
    const qty = num(h && h.quantity);
    const avg = num(h && h.avg_price);
    const cost = qty * avg;
    if (price === null || price === undefined || !Number.isFinite(Number(price))) {
      return { cost, marketValue: null, pnl: null, pnlRate: null, evaluated: false };
    }
    const p = num(price);
    const marketValue = qty * p;
    const pnl = marketValue - cost;
    const pnlRate = cost > 0 ? (pnl / cost) * 100 : null;
    return { cost, marketValue, pnl, pnlRate, evaluated: true };
  }

  /**
   * 여러 보유 종목(가격 맵 포함)의 포트폴리오 합계를 계산한다.
   * @param {Array} holdings
   * @param {Object} priceByKey  { 'KRX:005930': 72000, ... } — 없으면 미평가로 집계
   * @returns {{totalCost:number, totalValue:number, totalPnl:number, totalPnlRate:number|null, evaluatedCount:number, count:number, bySymbol:Array}}
   */
  function evaluatePortfolio(holdings, priceByKey = {}) {
    const list = Array.isArray(holdings) ? holdings : [];
    let totalCost = 0;
    let totalValue = 0;
    let evaluatedCount = 0;
    const bySymbol = [];
    for (const h of list) {
      const key = `${h.market || 'KRX'}:${h.symbol}`;
      const price = Object.prototype.hasOwnProperty.call(priceByKey, key) ? priceByKey[key] : null;
      const ev = evaluateHolding(h, price);
      totalCost += ev.cost;
      if (ev.evaluated) { totalValue += ev.marketValue; evaluatedCount++; }
      bySymbol.push({ key, holding: h, ...ev });
    }
    // 미평가 종목이 있으면 평가액은 "평가된 것만"의 합이라, 총손익은 평가된 종목 기준으로만 낸다.
    const evaluatedCost = bySymbol.filter((x) => x.evaluated).reduce((s, x) => s + x.cost, 0);
    const totalPnl = evaluatedCount ? totalValue - evaluatedCost : 0;
    const totalPnlRate = evaluatedCost > 0 ? (totalPnl / evaluatedCost) * 100 : null;
    return {
      totalCost, totalValue: evaluatedCount ? totalValue : null, totalPnl, totalPnlRate,
      evaluatedCount, count: list.length, bySymbol,
    };
  }

  /** 계좌별로 보유 종목을 묶고, 각 그룹의 합계를 계산한다. */
  function evaluateByAccount(holdings, priceByKey = {}) {
    const groups = new Map();
    for (const h of Array.isArray(holdings) ? holdings : []) {
      const id = h.account_id || '__none__';
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(h);
    }
    return [...groups.entries()].map(([accountId, list]) => ({
      accountId, holdings: list, summary: evaluatePortfolio(list, priceByKey),
    }));
  }

  const fmt = (v, digits = 0) => Number(v || 0).toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

  /** 손익 부호에 따른 표시 문자열. 예) +12,300 / -4,500 / 0 */
  function formatPnl(v) {
    const n = num(v);
    const sign = n > 0 ? '+' : '';
    return `${sign}${fmt(n)}`;
  }

  /** 수익률 표시. 예) +3.42% / -1.20% / — */
  function formatPnlRate(v) {
    if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
    const n = Number(v);
    return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
  }

  /** 손익 클래스(색상용). gain/loss/flat */
  function pnlClass(v) {
    const n = num(v);
    if (n > 0) return 'gain';
    if (n < 0) return 'loss';
    return 'flat';
  }

  /** 체결 기록에서 보유 수량·평균단가를 재계산한다(이동평균법). 매도 시 평단은 유지, 수량만 감소. */
  function recomputeFromTrades(trades) {
    let qty = 0;
    let cost = 0; // 총 매입원가
    const sorted = (Array.isArray(trades) ? trades.slice() : []).sort((a, b) => String(a.traded_at || '').localeCompare(String(b.traded_at || '')));
    for (const t of sorted) {
      const q = num(t.quantity);
      const p = num(t.price);
      const fee = num(t.fee);
      if (t.side === 'sell') {
        const avg = qty > 0 ? cost / qty : 0;
        cost -= avg * q; // 매도분은 평단 기준으로 원가 차감
        qty -= q;
        if (qty <= 0) { qty = 0; cost = 0; }
      } else {
        cost += q * p + fee;
        qty += q;
      }
    }
    const avg_price = qty > 0 ? cost / qty : 0;
    return { quantity: qty, avg_price, totalCost: cost };
  }

  // ---- 목표가/손절가 알림 (v7.24.0, 아이디어 3) ----
  /**
   * 보유 종목과 현재가로 "도달한 알림"을 계산한다(부작용 없음).
   * target_price 이상이면 target, stop_price 이하이면 stop. 둘 다 지정됐고 둘 다 도달하는
   * 극단적 경우는 목표가를 우선한다(사용자가 기대한 방향).
   * @returns {{key:string, symbol:string, name:string, kind:'target'|'stop', price:number, threshold:number}[]}
   */
  function priceAlerts(holdings, priceByKey = {}) {
    const out = [];
    for (const h of Array.isArray(holdings) ? holdings : []) {
      const key = `${h.market || 'KRX'}:${h.symbol}`;
      if (!Object.prototype.hasOwnProperty.call(priceByKey, key)) continue;
      const price = num(priceByKey[key]);
      if (!Number.isFinite(price) || price <= 0) continue;
      const target = h.target_price === null || h.target_price === undefined || h.target_price === '' ? null : num(h.target_price);
      const stop = h.stop_price === null || h.stop_price === undefined || h.stop_price === '' ? null : num(h.stop_price);
      const name = h.name || h.symbol;
      if (target !== null && target > 0 && price >= target) out.push({ key, symbol: h.symbol, name, kind: 'target', price, threshold: target });
      else if (stop !== null && stop > 0 && price <= stop) out.push({ key, symbol: h.symbol, name, kind: 'stop', price, threshold: stop });
    }
    return out;
  }

  // ---- 실현손익 (v7.24.0, 아이디어 4) ----
  /**
   * 매도 기록에서 실현손익을 계산한다(이동평균법). 매수 누적 평단으로 매도 원가를 차감하고,
   * 매도금액 - 매도원가 - 수수료를 실현손익으로 본다.
   * @returns {{realizedPnl:number, realizedCost:number, sellCount:number, totalFee:number, totalBuyAmount:number}}
   */
  function evaluateRealized(trades) {
    let qty = 0;
    let cost = 0;
    let realizedPnl = 0;
    let realizedCost = 0;
    let sellCount = 0;
    let totalFee = 0;
    let totalBuyAmount = 0;
    const sorted = (Array.isArray(trades) ? trades.slice() : []).sort((a, b) => String(a.traded_at || '').localeCompare(String(b.traded_at || '')));
    for (const t of sorted) {
      const q = num(t.quantity);
      const p = num(t.price);
      const fee = num(t.fee);
      totalFee += fee;
      if (t.side === 'sell') {
        const avg = qty > 0 ? cost / qty : 0;
        const sellCost = avg * q;
        realizedPnl += q * p - sellCost - fee;
        realizedCost += sellCost;
        cost -= sellCost;
        qty -= q;
        sellCount++;
        if (qty <= 0) { qty = 0; cost = 0; }
      } else {
        cost += q * p + fee;
        totalBuyAmount += q * p;
        qty += q;
      }
    }
    return { realizedPnl, realizedCost, sellCount, totalFee, totalBuyAmount };
  }

  /** 배당 합계(세후 amount 기준). 통화가 섞이면 currency별로 나눠 합산한다. */
  function sumDividends(dividends) {
    const byCurrency = {};
    let count = 0;
    let totalTax = 0;
    for (const d of Array.isArray(dividends) ? dividends : []) {
      const cur = d.currency || 'KRW';
      byCurrency[cur] = (byCurrency[cur] || 0) + num(d.amount);
      totalTax += num(d.tax);
      count++;
    }
    return { byCurrency, totalTax, count };
  }

  const api = { evaluateHolding, evaluatePortfolio, evaluateByAccount, formatPnl, formatPnlRate, pnlClass, recomputeFromTrades, priceAlerts, evaluateRealized, sumDividends, toNumber: num };
  globalThis.StockCalc = api;
  if (typeof window !== 'undefined') window.StockCalc = api;
})();