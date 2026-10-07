import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// settings.js는 일반 <script>(전역 등록) 방식이라 Node에서는 필요한 전역을 최소한으로
// 스텁해둔 뒤 파일을 읽어 그대로 평가한다(state.test.mjs와 동일한 방식).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadGlobalScript(relPath) {
  const code = fs.readFileSync(path.join(__dirname, relPath), 'utf8');
  (0, eval)(code);
}

globalThis.window = globalThis;
globalThis.window.addEventListener = () => {};
globalThis.CONFIG = { mode: 'local' };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.appState = { user: { id: 'u1' } };
globalThis.el = () => ({});
globalThis.toast = () => {};
globalThis.confirmDialog = () => true;
globalThis.openModal = () => {};
globalThis.getStore = () => ({});

loadGlobalScript('../js/modules/settings.js');
const { sanitizeImportRecord, remapForeignId, isValidImportPayload, countImportRecords } = globalThis.__importExport;

test('sanitizeImportRecord는 시스템 필드(id/생성·수정일/삭제일/user_id)를 제거한다', () => {
  const record = { id: 'old-1', created_at: 'a', updated_at: 'b', deleted_at: null, user_id: 'old-user', title: '제목', date: '2026-01-01' };
  const cleaned = sanitizeImportRecord(record);
  assert.deepEqual(cleaned, { title: '제목', date: '2026-01-01' });
});

test('sanitizeImportRecord는 extraOmitKeys로 지정한 필드도 함께 제거한다', () => {
  const record = { id: 'a1', title: '정기검진', appointment_date: '2026-10-05', schedule_id: 'old-sched-1' };
  const cleaned = sanitizeImportRecord(record, ['schedule_id']);
  assert.deepEqual(cleaned, { title: '정기검진', appointment_date: '2026-10-05' });
});

test('sanitizeImportRecord는 원본 객체를 변경하지 않는다', () => {
  const record = { id: 'x', name: 'a' };
  sanitizeImportRecord(record);
  assert.equal(record.id, 'x');
});

test('remapForeignId는 매핑된 새 id를 반환한다', () => {
  const idMap = { 'old-challenge-1': 'new-challenge-9' };
  assert.equal(remapForeignId('old-challenge-1', idMap), 'new-challenge-9');
});

test('remapForeignId는 매핑되지 않은(부모 생성 실패/누락) id에 대해 null을 반환한다', () => {
  const idMap = { 'old-challenge-1': 'new-challenge-9' };
  assert.equal(remapForeignId('old-challenge-404', idMap), null);
  assert.equal(remapForeignId(null, idMap), null);
  assert.equal(remapForeignId(undefined, idMap), null);
});

test('isValidImportPayload는 알려진 백업 키가 하나라도 있으면 true를 반환한다', () => {
  assert.equal(isValidImportPayload({ exportedAt: '2026-01-01', schedules: [] }), true);
  assert.equal(isValidImportPayload({ projects: [] }), true);
});

test('isValidImportPayload는 형식이 다른 값(배열/문자열/무관한 객체)에 대해 false를 반환한다', () => {
  assert.equal(isValidImportPayload(null), false);
  assert.equal(isValidImportPayload([]), false);
  assert.equal(isValidImportPayload('not json'), false);
  assert.equal(isValidImportPayload({ foo: 'bar', count: 3 }), false);
});

test('countImportRecords는 평탄한 배열과 그룹(By별) 구조를 모두 합산한다', () => {
  const payload = {
    exportedAt: '2026-01-01',
    schedules: [{ id: '1' }, { id: '2' }],
    projects: [{ id: '3' }],
    challenges: [{ id: 'c1' }],
    checkinsByChallenge: { c1: [{ id: 'k1' }, { id: 'k2' }] },
    vehicles: [{ id: 'v1' }],
    maintenanceByVehicle: { v1: [{ id: 'm1' }] },
    fuelLogsByVehicle: { v1: [] },
  };
  // schedules(2) + projects(1) + challenges(1) + checkins(2) + vehicles(1) + maintenance(1) + fuel(0) = 8
  assert.equal(countImportRecords(payload), 8);
});

test('countImportRecords는 빈 백업에 대해 0을 반환한다', () => {
  assert.equal(countImportRecords({ exportedAt: '2026-01-01' }), 0);
});

test('splitScheduleImport: 장소/구분/N일 후 필드는 보존하고 부모 먼저, 고아 자식은 독립 일정으로', () => {
  const { splitScheduleImport } = globalThis.__importExport;
  const rows = [
    { id: 'c1', title: '검진 (5일 후)', parent_schedule_id: 'p1', offset_days: 5, is_generated: true, place: '서울치과', category: '개인' },
    { id: 'p1', title: '검진', place: '서울치과', category: '개인', repeat_offsets: [5, 7] },
    { id: 'o1', title: '고아', parent_schedule_id: 'gone', offset_days: 3, is_generated: true, category: '업무' },
  ];
  const { first, second } = splitScheduleImport(rows);
  assert.deepEqual(first.map((r) => r.id), ['p1', 'o1']);
  assert.deepEqual(second.map((r) => r.id), ['c1']);
  const p = first.find((r) => r.id === 'p1');
  assert.equal(p.place, '서울치과');
  assert.equal(p.category, '개인');
  assert.deepEqual(p.repeat_offsets, [5, 7]);
  const orphan = first.find((r) => r.id === 'o1');
  assert.equal(orphan.parent_schedule_id, null);
  assert.equal(orphan.is_generated, false);
  assert.equal(orphan.category, '업무');
  assert.equal(second[0].offset_days, 5);
  assert.equal(second[0].place, '서울치과');
});

test('v7.22 기본정보: 비어 있는 필드만 가져오기로 채운다', () => {
  const { mergeBasicInfoForImport } = globalThis.__importExport;
  const patch = mergeBasicInfoForImport({ name: '홍길동', phone: '' }, { name: '다른이름', phone: '010-1', email: 'a@b.c' });
  assert.equal(patch.name, undefined);
  assert.equal(patch.phone, '010-1');
  assert.equal(patch.email, 'a@b.c');
});
