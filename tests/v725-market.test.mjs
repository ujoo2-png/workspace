import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// v7.25.0: 오늘의 시황·환율 서비스(marketService.js) 테스트.
// 파일은 일반 <script>(전역 등록) 방식이라, 브라우저 전역을 흉내 낸 뒤 그대로 평가한다.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

class FakeLocalStorage {
  constructor() { this._data = new Map(); }
  getItem(k) { return this._data.has(k) ? this._data.get(k) : null; }
  setItem(k, v) { this._data.set(k, String(v)); }
  removeItem(k) { this._data.delete(k); }
  clear() { this._data.clear(); }
}

globalThis.localStorage = new FakeLocalStorage();
globalThis.window = globalThis;
globalThis.settingsSync = { get: () => '', set: () => {} };
// fetch는 호출되지 않도록 기본 스텁(개별 테스트에서 교체).
globalThis.fetch = async () => { throw new Error('fetch not stubbed'); };

(0, eval)(fs.readFileSync(path.join(__dirname, '../js/services/marketService.js'), 'utf8'));

const { orderMajorFx, getFxEnabled, setFxEnabled, fetchExchangeRates, fetchIndices } = globalThis;

test('orderMajorFx: 주요 통화를 먼저, 나머지는 뒤로 정렬한다', () => {
  const rows = [
    { unit: 'CNY', name: '위안', rate: 185 },
    { unit: 'USD', name: '미국 달러', rate: 1350 },
    { unit: 'THB', name: '태국 바트', rate: 38 },
    { unit: 'JPY(100)', name: '일본 엔', rate: 900 },
  ];
  const { majors, rest } = orderMajorFx(rows);
  // MAJOR 순서는 USD → JPY(100) → EUR → CNY → GBP 이므로, 있는 것만 순서대로.
  assert.deepEqual(majors.map((r) => r.unit), ['USD', 'JPY(100)', 'CNY']);
  assert.deepEqual(rest.map((r) => r.unit), ['THB']);
});

test('orderMajorFx: 주요 통화가 없으면 majors는 빈 배열', () => {
  const { majors, rest } = orderMajorFx([{ unit: 'THB', name: '태국 바트', rate: 38 }]);
  assert.equal(majors.length, 0);
  assert.equal(rest.length, 1);
});

test('fxEnabled: 기본값은 켜짐, 토글이 저장된다', () => {
  localStorage.clear();
  assert.equal(getFxEnabled(), true); // 저장값이 없으면 기본 표시
  setFxEnabled(false);
  assert.equal(getFxEnabled(), false);
  setFxEnabled(true);
  assert.equal(getFxEnabled(), true);
});

test('fetchExchangeRates: 공공데이터포털 키가 없으면 안내 메시지로 거부한다', async () => {
  localStorage.clear();
  globalThis.getPublicDataKey = () => '';
  await assert.rejects(() => fetchExchangeRates(), /공공데이터포털 API 키/);
});

test('fetchExchangeRates: 정상 응답을 파싱해 rate(숫자)로 만든다', async () => {
  localStorage.clear();
  globalThis.getPublicDataKey = () => 'TEST_KEY';
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      response: { header: { resultCode: '00' }, body: { items: { item: [
        { cur_unit: 'USD', cur_nm: '미국 달러', deal_bas_r: '1,350.5' },
        { cur_unit: 'JPY(100)', cur_nm: '일본 엔', deal_bas_r: '900.2' },
      ] } } },
    }),
  });
  const rows = await fetchExchangeRates({ date: '20261021' });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].unit, 'USD');
  assert.equal(rows[0].rate, 1350.5);
  assert.equal(rows[1].rate, 900.2);
  // 3시간 캐시: 두 번째 호출은 fetch 없이 같은 값을 돌려준다.
  globalThis.fetch = async () => { throw new Error('캐시가 동작하지 않음'); };
  const again = await fetchExchangeRates({ date: '20261021' });
  assert.equal(again.length, 2);
});

test('fetchExchangeRates: 결과코드가 00이 아니면 오류로 처리한다', async () => {
  localStorage.clear();
  globalThis.getPublicDataKey = () => 'TEST_KEY';
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({ response: { header: { resultCode: '30', resultMsg: '활용신청 미승인' }, body: {} } }),
  });
  await assert.rejects(() => fetchExchangeRates({ date: '20260101' }), /활용신청 미승인/);
});

test('fetchIndices: 공급자가 없으면 값을 지어내지 않고 안내만 한다', async () => {
  localStorage.clear();
  globalThis.getStockProvider = () => 'none';
  await assert.rejects(() => fetchIndices(), /시황\(지수\)/);
});
