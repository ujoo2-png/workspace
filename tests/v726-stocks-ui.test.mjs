import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// v7.26.0: 증권 화면 개선 + 커스텀 API 연결 상태/간편 등록 + 환율 소스 선택 회귀 테스트.
//
// 실제로 겪은 문제(사용자 요청 6건):
//   1) 보유 주식 대시보드(총액·총수익률)가 사라진 듯 보였다 → 총자산 카드로 강조해 복원
//   2) 커스텀 API 관리에 연결 상태(연결/미연결/불안정/오류) 표기가 없었다
//   3) 증권 카드 순서가 시황 → 총자산 → 증권사별 이어야 한다
//   4) 증권사별 보유 현황이 표(grid)라 복잡했다 → list 형태로 개선
//   5) 커스텀 JSON API 등록이 복잡했다 → 프리셋 + 자동 감지 추가
//   6) 커스텀 API 관리에 한국수출입은행 환율 API를 등록해도 증권 화면과 연결되지 않았다 → 환율 소스 선택
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

class FakeLocalStorage {
  constructor() { this._data = new Map(); }
  getItem(k) { return this._data.has(k) ? this._data.get(k) : null; }
  setItem(k, v) { this._data.set(k, String(v)); }
  removeItem(k) { this._data.delete(k); }
  clear() { this._data.clear(); }
}

// ── stocks.js (3·4·1: 카드 순서·list UI·총자산 강조) ──────────────────────────
test('증권 카드 순서: 시황 → 총자산 → 증권사별 보유 현황', () => {
  const src = read('js/modules/stocks.js');
  const iMarket = src.indexOf('buildMarketCard()');
  const iAsset = src.indexOf('buildAssetCard(');
  const iBroker = src.indexOf("'증권사별 보유 현황'");
  assert.ok(iMarket > -1 && iAsset > -1 && iBroker > -1, '카드 빌더를 찾지 못했습니다');
  assert.ok(iMarket < iAsset, '시황 카드가 총자산 카드보다 먼저 와야 합니다');
  assert.ok(iAsset < iBroker, '총자산 카드가 증권사별 현황보다 먼저 와야 합니다');
});

test('총자산 카드: 총자산 강조 + 기존 지표(매입금액·평가손익·수익률·실현손익·배당) 유지', () => {
  const src = read('js/modules/stocks.js');
  assert.match(src, /asset-card__value/, '총자산(평가금액)을 크게 보여주는 요소가 없습니다');
  assert.match(src, /총자산\(평가금액\)/);
  for (const label of ['총 매입금액', '평가손익', '수익률', '실현손익', '누적 수수료', '배당 합계']) {
    assert.ok(src.includes(label), `총자산 카드에 "${label}" 지표가 없습니다`);
  }
});

test('증권사별 보유 현황: list 형태(broker-head + holding-item)로 렌더한다', () => {
  const src = read('js/modules/stocks.js');
  assert.match(src, /class: 'broker-head'/);
  assert.match(src, /class: 'holding-item'/);
  assert.match(src, /class: 'holding-list'/);
  // 옛 표(grid) 방식이 남아있으면 실패.
  assert.ok(!src.includes('stock-holdings'), '옛 표(stock-holdings) 방식이 남아 있습니다');
  assert.ok(!src.includes('holdingHeader'), '옛 holdingHeader가 남아 있습니다');
});

// ── customApiService.js (2: 연결 상태) ───────────────────────────────────────
test('커스텀 API 연결 상태: 4가지 상태(연결/불안정/오류/미연결)를 지원한다', () => {
  const src = read('js/services/customApiService.js');
  for (const s of ['connected', 'unstable', 'error', 'unset']) assert.ok(src.includes(s), `${s} 상태가 없습니다`);
  for (const label of ['연결', '불안정', '오류', '미연결']) assert.ok(src.includes(label), `${label} 라벨이 없습니다`);
  assert.match(src, /window\.testCustomApi\s*=/);
  assert.match(src, /window\.getCustomApiStatus\s*=/);
});

test('연결 상태 저장 키는 기기별이라 settingsSync 동기화 목록에 없어야 한다', () => {
  const sync = read('js/services/settingsSync.js');
  // SYNCED_KEYS 배열에 문자열로 들어가 있으면 안 된다(주석 언급은 무방).
  assert.ok(!/'workspace:customApiStatus/.test(sync), '연결 상태 키가 동기화 목록에 들어가면 안 됩니다');
  assert.ok(sync.includes("'workspace:market:fxSource'"), '환율 출처는 동기화되어야 합니다');
  assert.ok(sync.includes("'workspace:market:fxCustomApiId'"), '선택한 커스텀 API id는 동기화되어야 합니다');
});

// ── settings.js (5: 프리셋·자동 감지) ────────────────────────────────────────
test('커스텀 API 등록: 한국수출입은행 등 프리셋과 자동 감지가 있다', () => {
  const src = read('js/modules/settings.js');
  assert.match(src, /PRESETS/, '프리셋이 없습니다');
  assert.ok(src.includes('한국수출입은행 환율'), '한국수출입은행 프리셋이 없습니다');
  assert.match(src, /function autoDetectPricePaths/);
  assert.match(src, /자동 감지/);
});

test('autoDetectPricePaths: 가격/환율 후보 필드 경로를 찾아낸다', async () => {
  // settings.js 전체를 평가하기는 무거우므로, 함수 본문을 그대로 떼어내 검증한다.
  const src = read('js/modules/settings.js');
  const start = src.indexOf('function autoDetectPricePaths');
  assert.ok(start > -1);
  // 함수 종료(다음 줄의 "function markSupabaseActive")까지.
  const end = src.indexOf('function markSupabaseActive', start);
  const fnSrc = src.slice(start, end);
  const autoDetectPricePaths = (0, eval)(`(${fnSrc.trim()})`);

  // 한국수출입은행 유사 응답
  const exim = { response: { body: { items: { item: [
    { cur_unit: 'USD', cur_nm: '미국 달러', deal_bas_r: '1,350.5' },
  ] } } } };
  const p1 = autoDetectPricePaths(exim);
  assert.ok(p1.some((x) => x.includes('deal_bas_r')), `환율 필드를 찾지 못했습니다: ${p1}`);

  // 일반 시세 응답(중첩 + 배열)
  const quote = { data: { list: [{ close: 71000, name: '삼성전자' }] } };
  const p2 = autoDetectPricePaths(quote);
  assert.ok(p2.some((x) => x.includes('close')), `가격 필드를 찾지 못했습니다: ${p2}`);

  // 후보가 없으면 빈 배열(값을 지어내지 않는다)
  assert.deepEqual(autoDetectPricePaths({ foo: 'bar' }), []);
});

// ── marketService.js (6: 환율 소스 선택) ─────────────────────────────────────
test('marketService: 환율 소스(공공데이터포털/커스텀) 선택을 지원한다', () => {
  const src = read('js/services/marketService.js');
  assert.match(src, /fetchExchangeRatesPublic/);
  assert.match(src, /fetchExchangeRatesCustom/);
  assert.match(src, /window\.getFxSource\s*=|getFxSource,/);
  assert.match(src, /window\.setFxSource|setFxSource,/);
});

test('marketService: 커스텀 소스는 편집 가능한 환율 배열을 관대하게 파싱한다', async () => {
  globalThis.localStorage = new FakeLocalStorage();
  globalThis.window = globalThis;
  globalThis.settingsSync = { get: () => '', set: () => {} };
  globalThis.fetch = async () => { throw new Error('not stubbed'); };
  (0, eval)(read('js/services/marketService.js'));

  globalThis.setFxSource('custom');
  globalThis.setFxCustomApiId('api_exim');
  globalThis.listCustomApis = () => [{ id: 'api_exim', name: '한국수출입은행 환율', urlTemplate: 'https://x', enabled: true }];
  globalThis.fetchCustomApi = async () => ({ kind: 'json', data: { response: { body: { items: { item: [
    { cur_unit: 'USD', cur_nm: '미국 달러', deal_bas_r: '1,350.5' },
    { cur_unit: 'EUR', cur_nm: '유로', deal_bas_r: '1,470.0' },
  ] } } } } });

  const rows = await globalThis.fetchExchangeRates({ date: '20261022' });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].unit, 'USD');
  assert.equal(rows[0].rate, 1350.5);
});

test('marketService: 커스텀 소스인데 API를 고르지 않으면 안내로 거부한다', async () => {
  globalThis.localStorage = new FakeLocalStorage();
  globalThis.setFxSource('custom');
  globalThis.setFxCustomApiId('');
  globalThis.fetchCustomApi = async () => { throw new Error('호출되면 안 됨'); };
  await assert.rejects(() => globalThis.fetchExchangeRates({ date: '20261023' }), /커스텀 API를 설정에서 선택/);
});

// ── CSS (전 항목: 새 클래스 존재) ────────────────────────────────────────────
test('CSS: 새 UI 클래스가 정의되어 있다', () => {
  const stocks = read('css/modules/stocks.css');
  const base = read('css/base.css');
  for (const c of ['.broker-head', '.holding-item', '.holding-list', '.asset-card__value']) {
    assert.ok(stocks.includes(c), `${c} 스타일이 없습니다`);
  }
  for (const c of ['.api-status', '.api-status--ok', '.api-status--warn', '.api-status--err', '.nm-btn--sm']) {
    assert.ok(base.includes(c), `${c} 스타일이 없습니다`);
  }
});
