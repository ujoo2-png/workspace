import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 경력 기간 합집합, 자격증 만료, 경력기술서 문안 — TZ와 무관해야 한다.
const dir = path.dirname(fileURLToPath(import.meta.url));
globalThis.window = globalThis;
(0, eval)(fs.readFileSync(path.join(dir, '../js/utils/careerLogic.js'), 'utf8'));
const CL = globalThis.CareerLogic;

test('totalExperience: 겹치는 기간은 한 번만 센다', () => {
  const r = CL.totalExperience([
    { start_date: '2020-01-01', end_date: '2020-12-31' },
    { start_date: '2020-06-01', end_date: '2021-06-30' },
  ], '2026-10-07');
  assert.equal(r.text, '1년 6개월');
});
test('totalExperience: 퇴사일 없으면 오늘까지, 시작일 없는 항목 제외', () => {
  const r = CL.totalExperience([{ start_date: '2025-10-01', end_date: null }, { end_date: '2020-01-01' }], '2026-10-07');
  assert.match(r.text, /^1년/);
  assert.equal(CL.totalExperience([], '2026-10-07').text.length > 0, true);
});
test('certExpiryStatus / expiryLabel', () => {
  assert.equal(CL.certExpiryStatus({}, '2026-10-07').state, 'none');
  assert.equal(CL.certExpiryStatus({ expiry_date: '2026-10-01' }, '2026-10-07').state, 'expired');
  const soon = CL.certExpiryStatus({ expiry_date: '2026-11-01' }, '2026-10-07');
  assert.equal(soon.state, 'soon'); assert.equal(soon.days, 25);
  assert.equal(CL.certExpiryStatus({ expiry_date: '2030-01-01' }, '2026-10-07').state, 'ok');
  assert.equal(CL.expiryLabel(soon), '만료 25일 전');
  assert.match(CL.expiryLabel({ state: 'expired', days: -6 }), /6일 지남/);
});
test('periodText: 진행 중 표기와 형식', () => {
  assert.equal(CL.periodText('2020-03-02', null, 'YYYY-MM-DD'), '2020-03-02 ~ 현재');
  assert.equal(CL.periodText('2020-03-02', '2021-01-01', 'YYYY.MM.DD'), '2020.03.02 ~ 2021.01.01');
});
test('careerNarrative: 총 경력 줄과 회사명 포함, 빈 목록은 빈 문자열', () => {
  const t = CL.careerNarrative([{ company_name: '알파', start_date: '2014-03-03', end_date: '2018-02-28', note: '개발' }], { todayIso: '2026-10-07' });
  assert.match(t, /총 경력/); assert.match(t, /알파/);
  assert.equal(CL.careerNarrative([], { todayIso: '2026-10-07' }), '');
});
