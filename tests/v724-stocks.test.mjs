import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// v7.24.0: 증권 손익 계산 순수 함수 테스트.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
globalThis.window = globalThis;
(0, eval)(fs.readFileSync(path.join(__dirname, '../js/utils/stockCalc.js'), 'utf8'));
const { evaluateHolding, evaluatePortfolio, evaluateByAccount, formatPnl, formatPnlRate, pnlClass, recomputeFromTrades, priceAlerts, evaluateRealized, sumDividends } = globalThis.StockCalc;

test('evaluateHolding: 이익 종목의 평가·손익·수익률', () => {
  const r = evaluateHolding({ quantity: 10, avg_price: 1000 }, 1200);
  assert.equal(r.cost, 10000);
  assert.equal(r.marketValue, 12000);
  assert.equal(r.pnl, 2000);
  assert.equal(r.pnlRate, 20);
  assert.equal(r.evaluated, true);
});

test('evaluateHolding: 손실 종목', () => {
  const r = evaluateHolding({ quantity: 10, avg_price: 1000 }, 900);
  assert.equal(r.pnl, -1000);
  assert.equal(r.pnlRate, -10);
});

test('evaluateHolding: 시세가 없으면 미평가(null)로 둔다', () => {
  const r = evaluateHolding({ quantity: 10, avg_price: 1000 }, null);
  assert.equal(r.cost, 10000);
  assert.equal(r.marketValue, null);
  assert.equal(r.pnl, null);
  assert.equal(r.evaluated, false);
});

test('evaluateHolding: 평단 0이면 수익률은 null', () => {
  const r = evaluateHolding({ quantity: 10, avg_price: 0 }, 1000);
  assert.equal(r.pnlRate, null);
});

test('evaluatePortfolio: 여러 종목 합계 + 미평가 제외', () => {
  const holdings = [
    { market: 'KRX', symbol: 'A', quantity: 10, avg_price: 1000 }, // 평가됨
    { market: 'KRX', symbol: 'B', quantity: 5, avg_price: 2000 },  // 평가됨
    { market: 'US', symbol: 'C', quantity: 1, avg_price: 100 },    // 시세 없음 → 제외
  ];
  const prices = { 'KRX:A': 1200, 'KRX:B': 1800 };
  const r = evaluatePortfolio(holdings, prices);
  assert.equal(r.count, 3);
  assert.equal(r.evaluatedCount, 2);
  // 평가된 것만: 매입 10000+10000=20000, 평가 12000+9000=21000
  assert.equal(r.totalCost, 20000 + 100);
  assert.equal(r.totalValue, 21000);
  assert.equal(r.totalPnl, 1000);
  assert.equal(r.totalPnlRate, 5);
});

test('evaluatePortfolio: 평가 가능한 종목이 없으면 totalValue=null', () => {
  const r = evaluatePortfolio([{ market: 'KRX', symbol: 'A', quantity: 1, avg_price: 100 }], {});
  assert.equal(r.totalValue, null);
  assert.equal(r.evaluatedCount, 0);
});

test('evaluateByAccount: 계좌별 그룹 합계', () => {
  const holdings = [
    { account_id: 'a1', market: 'KRX', symbol: 'A', quantity: 1, avg_price: 1000 },
    { account_id: 'a1', market: 'KRX', symbol: 'B', quantity: 1, avg_price: 1000 },
    { account_id: 'a2', market: 'KRX', symbol: 'C', quantity: 2, avg_price: 500 },
  ];
  const groups = evaluateByAccount(holdings, { 'KRX:A': 1100, 'KRX:B': 900, 'KRX:C': 600 });
  assert.equal(groups.length, 2);
  const a1 = groups.find((g) => g.accountId === 'a1');
  assert.equal(a1.holdings.length, 2);
  assert.equal(a1.summary.totalPnl, 0); // +100 -100
});

test('formatPnl: 부호 표시', () => {
  assert.equal(formatPnl(12300), '+12,300');
  assert.equal(formatPnl(-4500), '-4,500');
  assert.equal(formatPnl(0), '0');
});

test('formatPnlRate: 소수점 2자리 + null 처리', () => {
  assert.equal(formatPnlRate(3.421), '+3.42%');
  assert.equal(formatPnlRate(-1.2), '-1.20%');
  assert.equal(formatPnlRate(null), '—');
});

test('pnlClass: gain/loss/flat', () => {
  assert.equal(pnlClass(1), 'gain');
  assert.equal(pnlClass(-1), 'loss');
  assert.equal(pnlClass(0), 'flat');
});

test('recomputeFromTrades: 매수 누적 후 이동평균', () => {
  const r = recomputeFromTrades([
    { side: 'buy', quantity: 10, price: 1000, traded_at: '2026-01-01' },
    { side: 'buy', quantity: 10, price: 2000, traded_at: '2026-02-01' },
  ]);
  assert.equal(r.quantity, 20);
  assert.equal(r.avg_price, 1500);
});

test('recomputeFromTrades: 매도 시 수량 감소·평단 유지', () => {
  const r = recomputeFromTrades([
    { side: 'buy', quantity: 10, price: 1000, traded_at: '2026-01-01' },
    { side: 'sell', quantity: 4, price: 1500, traded_at: '2026-02-01' },
  ]);
  assert.equal(r.quantity, 6);
  assert.equal(r.avg_price, 1000); // 평단은 그대로
});

test('recomputeFromTrades: 전량 매도하면 0으로 초기화', () => {
  const r = recomputeFromTrades([
    { side: 'buy', quantity: 5, price: 1000, traded_at: '2026-01-01' },
    { side: 'sell', quantity: 5, price: 1200, traded_at: '2026-02-01' },
  ]);
  assert.equal(r.quantity, 0);
  assert.equal(r.avg_price, 0);
});

test('recomputeFromTrades: 수수료는 매수 원가에 포함', () => {
  const r = recomputeFromTrades([{ side: 'buy', quantity: 10, price: 1000, fee: 500, traded_at: '2026-01-01' }]);
  assert.equal(r.totalCost, 10500);
  assert.equal(r.avg_price, 1050);
});

// ---- v7.24.0(아이디어 3): 목표가/손절가 도달 알림 ----
test('priceAlerts: 목표가 도달 시 target 알림', () => {
  const r = priceAlerts([{ market: 'KRX', symbol: '005930', name: '삼성전자', target_price: 80000 }], { 'KRX:005930': 81000 });
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, 'target');
  assert.equal(r[0].threshold, 80000);
});

test('priceAlerts: 손절가 도달 시 stop 알림', () => {
  const r = priceAlerts([{ market: 'KRX', symbol: '005930', stop_price: 60000 }], { 'KRX:005930': 59000 });
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, 'stop');
});

test('priceAlerts: 미도달이면 알림 없음', () => {
  const r = priceAlerts([{ market: 'KRX', symbol: '005930', target_price: 90000, stop_price: 50000 }], { 'KRX:005930': 70000 });
  assert.equal(r.length, 0);
});

test('priceAlerts: 시세가 없으면 알림에서 건너뜀', () => {
  const r = priceAlerts([{ market: 'KRX', symbol: '005930', target_price: 100 }], {});
  assert.equal(r.length, 0);
});

test('priceAlerts: 목표가·손절가가 둘 다 지정되지 않으면 무시', () => {
  const r = priceAlerts([{ market: 'KRX', symbol: '005930' }], { 'KRX:005930': 70000 });
  assert.equal(r.length, 0);
});

// ---- v7.24.0(아이디어 4): 실현손익·배당 ----
test('evaluateRealized: 매도 1건의 실현손익(이동평균 원가)', () => {
  const r = evaluateRealized([
    { side: 'buy', quantity: 10, price: 1000, traded_at: '2026-01-01' },
    { side: 'sell', quantity: 10, price: 1500, traded_at: '2026-02-01' },
  ]);
  assert.equal(r.realizedPnl, 5000); // (1500-1000)*10
  assert.equal(r.sellCount, 1);
});

test('evaluateRealized: 수수료를 실현손익에서 차감', () => {
  const r = evaluateRealized([
    { side: 'buy', quantity: 10, price: 1000, traded_at: '2026-01-01' },
    { side: 'sell', quantity: 10, price: 1500, fee: 300, traded_at: '2026-02-01' },
  ]);
  assert.equal(r.realizedPnl, 4700);
  assert.equal(r.totalFee, 300);
});

test('evaluateRealized: 여러 매수 후 부분 매도 시 이동평균 원가', () => {
  const r = evaluateRealized([
    { side: 'buy', quantity: 10, price: 1000, traded_at: '2026-01-01' },
    { side: 'buy', quantity: 10, price: 2000, traded_at: '2026-02-01' },
    { side: 'sell', quantity: 10, price: 2000, traded_at: '2026-03-01' },
  ]);
  assert.equal(r.realizedPnl, 5000); // 평단 1500 → (2000-1500)*10
});

test('sumDividends: 통화별 합산과 세금 합계', () => {
  const r = sumDividends([
    { amount: 12000, tax: 2000, currency: 'KRW' },
    { amount: 8000, tax: 1300, currency: 'KRW' },
    { amount: 5.5, tax: 0.8, currency: 'USD' },
  ]);
  assert.equal(r.byCurrency.KRW, 20000);
  assert.equal(r.byCurrency.USD, 5.5);
  assert.equal(r.totalTax, 3300.8);
  assert.equal(r.count, 3);
});
