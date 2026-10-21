import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// v7.24.0 순수 함수 테스트.
// js/*.js는 일반 <script>(globalThis.X 전역 등록) 방식이므로 파일을 읽어 평가한다.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadGlobalScript(relPath) {
  const code = fs.readFileSync(path.join(__dirname, relPath), 'utf8');
  (0, eval)(code);
}
loadGlobalScript('../js/utils/date.js');
const { shiftYear, addDays } = globalThis;

test('shiftYear: 같은 월·일을 유지하며 연도를 올린다', () => {
  assert.equal(shiftYear('2024-03-01', 1), '2025-03-01');
  assert.equal(shiftYear('2024-03-01', 3), '2027-03-01');
  assert.equal(shiftYear('2024-12-31', 1), '2025-12-31');
});

test('shiftYear: years=0이면 그대로', () => {
  assert.equal(shiftYear('2024-06-15', 0), '2024-06-15');
});

test('shiftYear: 평년 2/29는 다음 연도 2/28로 보정한다', () => {
  // 2024는 윤년, 2025는 평년 → 2/29가 없으므로 2/28.
  assert.equal(shiftYear('2024-02-29', 1), '2025-02-28');
  // 2028은 다시 윤년이므로 2/29 유지.
  assert.equal(shiftYear('2024-02-29', 4), '2028-02-29');
});

test('shiftYear: 365일 더하기와 달리 윤년에도 날짜가 어긋나지 않는다', () => {
  // 2024년은 윤년(366일)이라 2024-03-01에 365일을 더하면 2025-02-28로 하루 밀린다.
  assert.notEqual(addDays('2024-01-01', 365), '2025-01-01');
  assert.equal(addDays('2024-01-01', 365), '2024-12-31');
  // shiftYear는 연도만 올려 정확히 같은 월·일을 유지한다.
  assert.equal(shiftYear('2024-01-01', 1), '2025-01-01');
  assert.equal(shiftYear('2024-03-01', 1), '2025-03-01');
});

test('shiftYear: 여러 해를 한 번에 올린다', () => {
  assert.equal(shiftYear('2024-01-31', 5), '2029-01-31');
  assert.equal(shiftYear('2024-04-30', 10), '2034-04-30');
});

test('shiftYear: 빈 값은 그대로 반환한다', () => {
  assert.equal(shiftYear(null, 1), null);
  assert.equal(shiftYear('', 1), '');
});
