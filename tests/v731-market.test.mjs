import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const d = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const N = require('../js/services/naverService.js');
const FX = require('../js/services/fxService.js');
const proxy = require('../api/market-proxy.js');
globalThis.window = globalThis;
(0, eval)(fs.readFileSync(path.join(d, '../js/components/priceChart.js'), 'utf8'));

test('naver parseQuote: basic 응답(쉼표 문자열)·상승', () => {
  const q = N.parseQuote({ stockName: '삼성전자', closePrice: '72,500', compareToPreviousClosePrice: '1,000', fluctuationsRatio: '1.40', compareToPreviousPrice: { code: '2' } }, { symbol: '005930' });
  assert.equal(q.price, 72500); assert.equal(q.change, 1000); assert.equal(q.changeRate, 1.4); assert.equal(q.prevClose, 71500); assert.equal(q.name, '삼성전자');
});
test('naver parseQuote: 하락(code 5)이면 부호를 음수로', () => {
  const q = N.parseQuote({ stockName: 'X', closePrice: '9,000', compareToPreviousClosePrice: '500', fluctuationsRatio: '5.26', compareToPreviousPrice: { code: '5' } });
  assert.equal(q.change, -500); assert.equal(q.changeRate, -5.26); assert.equal(q.prevClose, 9500);
});
test('naver parseQuote: polling datas[] 모양 / 값 없음은 null', () => {
  const q = N.parseQuote({ datas: [{ itemCode: '005930', stockName: '삼성전자', closePrice: '70,000', compareToPreviousClosePrice: '-300', fluctuationsRatio: '-0.43' }] });
  assert.equal(q.symbol, '005930'); assert.equal(q.change, -300);
  assert.equal(N.parseQuote({}), null); assert.equal(N.parseQuote(null), null); assert.equal(N.parseQuote({ closePrice: '0' }), null);
});
test('naver parseChart: 배열(localDate) 정렬·필터', () => {
  const rows = N.parseChart([{ localDate: '20251003', closePrice: 102 }, { localDate: '20251001', closePrice: 100 }, { localDate: 'bad', closePrice: 1 }, { localDate: '20251002', closePrice: null }]);
  assert.deepEqual(rows.map((r) => [r.date, r.v]), [['2025-10-01', 100], ['2025-10-03', 102]]);
});
test('naver parseChart: siseJson 텍스트', () => {
  const t = `[['날짜','시가','고가','저가','종가','거래량','외국인소진율'],\n["20251001", 99, 105, 98, 100, 1000, 10.1],\n["20251002", 100, 106, 99, 104, 900, 10.2]]`;
  const rows = N.parseChart(t);
  assert.equal(rows.length, 2); assert.equal(rows[1].v, 104); assert.equal(rows[0].date, '2025-10-01');
});
test('overseasCandidates', () => {
  assert.deepEqual(N.overseasCandidates('aapl'), ['AAPL.O', 'AAPL.K', 'AAPL']);
  assert.deepEqual(N.overseasCandidates('KO.N'), ['KO.N']); assert.deepEqual(N.overseasCandidates(''), []);
});
test('fx parseSeries: JPY는 100엔 기준으로 환산', () => {
  const rows = FX.parseSeries({ rates: { '2025-10-02': { KRW: 9.2 }, '2025-10-01': { KRW: 9.0 }, '2025-10-03': {} } }, 'JPY', 100);
  assert.deepEqual(rows.map((r) => r.date), ['2025-10-01', '2025-10-02']); assert.ok(Math.abs(rows[1].v - 920) < 1e-9);
  assert.deepEqual(FX.parseSeries(null, 'USD'), []);
});
test('fx rangeFor: 기간 키별 시작일', () => {
  const now = new Date('2025-10-29T00:00:00Z');
  assert.equal(FX.rangeFor('10d', now).from, '2025-10-19'); assert.equal(FX.rangeFor('1w', now).from, '2025-10-22');
  assert.equal(FX.rangeFor('3m', now).period.label, '분기'); assert.equal(FX.rangeFor('6m', now).period.label, '반기');
  assert.equal(FX.rangeFor('nope', now).period.key, '1m');
});
test('PriceChart.stats', () => {
  const st = window.PriceChart.stats([{ date: 'a', v: 100 }, { date: 'b', v: 120 }, { date: 'c', v: 90 }, { date: 'd', v: 110 }]);
  assert.equal(st.high.v, 120); assert.equal(st.low.v, 90); assert.equal(st.change, 10); assert.equal(st.changeRate, 10); assert.equal(st.avg, 105);
  assert.equal(window.PriceChart.stats([]), null);
});
test('market-proxy: 허용 호스트만, https만', () => {
  assert.ok(proxy.checkUrl('https://m.stock.naver.com/api/stock/005930/basic').url);
  assert.ok(proxy.checkUrl('https://api.frankfurter.app/latest').url);
  for (const bad of ['http://m.stock.naver.com/x', 'https://evil.com/x', 'https://m.stock.naver.com.evil.com/x', 'https://user:pw@m.stock.naver.com/x', 'https://m.stock.naver.com:8443/x', 'https://169.254.169.254/', 'file:///etc/passwd', 'zzz'])
    assert.ok(proxy.checkUrl(bad).error, bad);
});
