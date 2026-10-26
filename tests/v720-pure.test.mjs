import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// v7.20.0 순수 로직: "N일 후" 반복 날짜 계산 · 구분/검색 · D-day · 챌린지 주간 알약.
// TZ=Asia/Seoul / UTC / America/Los_Angeles 에서 모두 같은 결과여야 한다(ISO 날짜 문자열만 다루므로 시간대·서머타임 영향 없음).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function load(rel) { (0, eval)(fs.readFileSync(path.join(__dirname, rel), 'utf8')); }
globalThis.window = globalThis;
load('../js/utils/date.js');
load('../js/predict.js');
const g = globalThis;

// ---------------- 날짜 계산 ----------------
test('shiftIso: 월말·연말·윤년을 달력대로 넘긴다', () => {
  assert.equal(g.shiftIso('2026-01-31', 1), '2026-02-01');
  assert.equal(g.shiftIso('2026-12-28', 5), '2027-01-02');
  assert.equal(g.shiftIso('2028-02-25', 5), '2028-03-01'); // 2028 윤년: 2/29 존재
  assert.equal(g.shiftIso('2027-02-25', 5), '2027-03-02'); // 평년
  assert.equal(g.shiftIso('2028-02-28', 1), '2028-02-29');
  assert.equal(g.shiftIso('2026-03-01', -1), '2026-02-28');
  assert.equal(g.shiftIso('2026-10-07', 365), '2027-10-07');
  assert.equal(g.shiftIso('2028-01-01', 365), '2028-12-31'); // 윤년 365일 후는 12/31
});

test('shiftIso/isoDiff: 서머타임 경계(미국 3/8·11/1, 한국 없음)를 넘어도 하루가 밀리지 않는다', () => {
  assert.equal(g.shiftIso('2026-03-07', 1), '2026-03-08');
  assert.equal(g.shiftIso('2026-03-08', 1), '2026-03-09');
  assert.equal(g.shiftIso('2026-10-31', 2), '2026-11-02');
  assert.equal(g.isoDiff('2026-03-01', '2026-04-01'), 31);
  assert.equal(g.isoDiff('2026-10-25', '2026-11-02'), 8);
});

test('isoWeekday: 1=월 … 7=일', () => {
  assert.equal(g.isoWeekday('2026-10-05'), 1); // 월
  assert.equal(g.isoWeekday('2026-10-07'), 3); // 수
  assert.equal(g.isoWeekday('2026-10-11'), 7); // 일
  assert.equal(g.isoWeekday('1970-01-01'), 4); // 목
});

test('isValidIso', () => {
  assert.equal(g.isValidIso('2028-02-29'), true);
  assert.equal(g.isValidIso('2027-02-29'), false);
  assert.equal(g.isValidIso('2026-13-01'), false);
  assert.equal(g.isValidIso(''), false);
});

// ---------------- "N일 후" 입력 파싱 ----------------
test('parseOffsets: "5, 7" / "5일 후 and 7일 후" / 배열', () => {
  assert.deepEqual(g.parseOffsets('5, 7').offsets, [5, 7]);
  assert.deepEqual(g.parseOffsets('5일 후 and 7일 후').offsets, [5, 7]);
  assert.deepEqual(g.parseOffsets([7, '5', 5]).offsets, [5, 7]); // 중복 제거 + 정렬
  assert.deepEqual(g.parseOffsets('').offsets, []);
  assert.deepEqual(g.parseOffsets(null).offsets, []);
});

test('parseOffsets: 범위(±1~365)·소수·0은 invalid, 60개 초과는 잘라낸다', () => {
  const r = g.parseOffsets('0, 366, 1.5, 3');
  assert.deepEqual(r.offsets, [3]);
  assert.deepEqual(r.invalid.sort(), ['0', '1.5', '366'].sort());
  assert.deepEqual(g.parseOffsets('365').offsets, [365]);
  const many = g.parseOffsets(Array.from({ length: 70 }, (_, i) => i + 1).join(','));
  assert.equal(many.offsets.length, 60);
  assert.equal(many.truncated, true);
  assert.deepEqual(many.offsets.slice(0, 3), [1, 2, 3]);
});

// ---------------- 자식 일정 필드 / 계획(멱등) ----------------
const parent = (o = {}) => ({ id: 'P', title: '치과 검진', date: '2026-10-08', time: '09:30', place: '서울치과', category: '개인', priority: 'high', project_id: null, tags: ['건강'], memo: '메모', repeat_offsets: [5, 7], flagged: true, done: true, ...o });

test('childScheduleFields: 제목에 "(N일 후)", 날짜는 부모+N, 완료/플래그는 물려주지 않고 자동 생성 표식이 붙는다', () => {
  const c = g.childScheduleFields(parent(), 5);
  assert.equal(c.title, '치과 검진 (5일 후)');
  assert.equal(c.date, '2026-10-13');
  assert.equal(c.time, '09:30');
  assert.equal(c.place, '서울치과');
  assert.equal(c.category, '개인');
  assert.equal(c.parent_schedule_id, 'P');
  assert.equal(c.offset_days, 5);
  assert.equal(c.is_generated, true);
  assert.equal('done' in c, false);
  assert.equal('flagged' in c, false);
  assert.deepEqual(c.tags, ['건강']);
});

test('planScheduleChildren: 처음엔 offset마다 하나씩 만들고, 같은 입력으로 다시 계획하면 아무것도 안 한다(멱등)', () => {
  const p = parent();
  const first = g.planScheduleChildren(p, []);
  assert.equal(first.create.length, 2);
  assert.deepEqual(first.create.map((c) => c.date), ['2026-10-13', '2026-10-15']);
  assert.deepEqual(first.update, []);
  assert.deepEqual(first.remove, []);
  const kids = first.create.map((c, i) => ({ ...c, id: `c${i}`, created_at: `2026-10-0${i + 1}` }));
  const again = g.planScheduleChildren(p, kids);
  assert.deepEqual(again, { create: [], update: [], remove: [] });
});

test('planScheduleChildren: offsets를 바꾸면 달라진 것만 추가/삭제한다', () => {
  const p = parent();
  const kids = g.planScheduleChildren(p, []).create.map((c, i) => ({ ...c, id: `c${i}`, created_at: `2026-10-0${i + 1}` })); // 5, 7
  const plan = g.planScheduleChildren({ ...p, repeat_offsets: [7, 14] }, kids);
  assert.deepEqual(plan.remove, ['c0']); // 5일 후 삭제
  assert.deepEqual(plan.create.map((c) => c.offset_days), [14]); // 14일 후 추가
  assert.deepEqual(plan.update, []); // 7일 후는 그대로
  const cleared = g.planScheduleChildren({ ...p, repeat_offsets: [] }, kids);
  assert.deepEqual(cleared.remove.sort(), ['c0', 'c1']);
  assert.equal(cleared.create.length, 0);
});

test('planScheduleChildren: 부모의 날짜/제목/장소/구분이 바뀌면 자식 patch로 전파(완료 여부는 건드리지 않음)', () => {
  const p = parent();
  const kids = g.planScheduleChildren(p, []).create.map((c, i) => ({ ...c, id: `c${i}`, done: true, created_at: `2026-10-0${i + 1}` }));
  const moved = g.planScheduleChildren({ ...p, date: '2026-10-31', title: '정기 검진', place: '강남점', category: '가족' }, kids);
  assert.equal(moved.update.length, 2);
  const u5 = moved.update.find((u) => u.id === 'c0').patch;
  assert.equal(u5.date, '2026-11-05'); // 10/31 + 5 = 11/5
  assert.equal(u5.title, '정기 검진 (5일 후)');
  assert.equal(u5.place, '강남점');
  assert.equal(u5.category, '가족');
  assert.equal('done' in u5, false);
  assert.equal(moved.update.find((u) => u.id === 'c1').patch.date, '2026-11-07');
});

test('planScheduleChildren: 같은 offset의 중복 자식은 하나만 남기고 나머지를 지운다', () => {
  const p = parent({ repeat_offsets: [5] });
  const base = g.childScheduleFields(p, 5);
  const plan = g.planScheduleChildren(p, [{ ...base, id: 'a', created_at: '1' }, { ...base, id: 'b', created_at: '2' }]);
  assert.deepEqual(plan.remove, ['b']);
});

// ---------------- 구분 / 검색 ----------------
test('normalizeScheduleCategory: 알 수 없는 값은 기타', () => {
  assert.equal(g.normalizeScheduleCategory('가족'), '가족');
  assert.equal(g.normalizeScheduleCategory(undefined), '기타');
  assert.equal(g.normalizeScheduleCategory('???'), '기타');
  assert.deepEqual(g.SCHEDULE_CATEGORIES, ['개인', '회사', '가족', '업무', '기타']);
});

test('scheduleMatchesQuery: 제목/메모/장소/구분 라벨/태그에서 찾는다(대소문자 무시)', () => {
  const s = { title: '주간 회의', memo: '분기 계획', place: '본사 3층', category: '회사', tags: ['Sprint'] };
  assert.equal(g.scheduleMatchesQuery(s, '회의'), true);
  assert.equal(g.scheduleMatchesQuery(s, '3층'), true);
  assert.equal(g.scheduleMatchesQuery(s, '회사'), true);
  assert.equal(g.scheduleMatchesQuery(s, 'sprint'), true);
  assert.equal(g.scheduleMatchesQuery(s, '가족'), false);
  assert.equal(g.scheduleMatchesQuery({ title: 'x' }, '기타'), true); // category 없음 = 기타
  assert.equal(g.scheduleMatchesQuery(s, '  '), true);
});

// ---------------- D-day ----------------
test('ddayLabel: 오늘=D-Day, 남음=D-N, 지남=D+N', () => {
  assert.equal(g.ddayLabel('2026-10-07', '2026-10-07'), 'D-Day');
  assert.equal(g.ddayLabel('2026-10-19', '2026-10-07'), 'D-12');
  assert.equal(g.ddayLabel('2026-10-04', '2026-10-07'), 'D+3');
  assert.equal(g.ddayLabel('2026-10-08', '2026-10-07'), 'D-1');
});

test('ddayLabel: 월·연 경계와 윤년의 일수', () => {
  assert.equal(g.ddayLabel('2027-01-01', '2026-12-31'), 'D-1');
  assert.equal(g.ddayLabel('2028-03-01', '2028-02-27'), 'D-3'); // 2/28, 2/29, 3/1
  assert.equal(g.ddayLabel('2027-03-01', '2027-02-27'), 'D-2');
});

test('ddayLabel 매년 반복: 올해 기념일이 아직이면 올해, 지났으면 내년으로 넘어간다', () => {
  assert.equal(g.ddayLabel('2020-12-25', '2026-10-07', true), 'D-79');
  assert.equal(g.ddayLabel('2020-10-07', '2026-10-07', true), 'D-Day');
  assert.equal(g.ddayLabel('2020-10-06', '2026-10-07', true), 'D-364'); // 어제가 기념일 → 내년
  assert.equal(g.ddayLabel('2020-12-31', '2026-12-31', true), 'D-Day');
  assert.equal(g.ddayLabel('2020-12-31', '2027-01-01', true), 'D-364');
});

test('ddayInfo 매년 반복: 몇 주년인지, 목표일이 미래이면 첫 기념일은 목표일 자체', () => {
  const i = g.ddayInfo('2020-12-25', '2026-10-07', true);
  assert.equal(i.date, '2026-12-25');
  assert.equal(i.anniversary, 6);
  const future = g.ddayInfo('2027-05-05', '2026-10-07', true);
  assert.equal(future.date, '2027-05-05');
  assert.equal(future.anniversary, null);
  assert.equal(future.days, 210);
  const past = g.ddayInfo('2026-10-01', '2026-10-07', false);
  assert.equal(past.isPast, true);
  assert.equal(past.days, -6);
});

test('ddayLabel 윤일(2/29) 기념일: 평년엔 2/28, 윤년엔 2/29', () => {
  assert.equal(g.ddayInfo('2024-02-29', '2027-02-20', true).date, '2027-02-28');
  assert.equal(g.ddayLabel('2024-02-29', '2027-02-20', true), 'D-8');
  assert.equal(g.ddayLabel('2024-02-29', '2027-02-28', true), 'D-Day');
  assert.equal(g.ddayInfo('2024-02-29', '2027-03-01', true).date, '2028-02-29'); // 2/28이 지났으니 다음은 2028 윤년 2/29
  assert.equal(g.ddayLabel('2024-02-29', '2028-02-29', true), 'D-Day');
  assert.equal(g.ddayInfo('2024-02-29', '2028-02-10', true).anniversary, 4);
});

test('sortDdays: 가까운 순(오늘 포함) → 지난 것은 최근에 지난 순으로 뒤에', () => {
  const rows = [
    { id: 'a', target_date: '2026-10-01' }, // D+6
    { id: 'b', target_date: '2026-10-20' }, // D-13
    { id: 'c', target_date: '2026-10-07' }, // D-Day
    { id: 'd', target_date: '2026-09-01' }, // D+36
    { id: 'e', target_date: '2026-10-10' }, // D-3
  ];
  assert.deepEqual(g.sortDdays(rows, '2026-10-07').map((r) => r.id), ['c', 'e', 'b', 'a', 'd']);
});

test('MAX_DDAYS는 5', () => assert.equal(g.MAX_DDAYS, 5));

// ---------------- 주간 알약 ----------------
const ch = (o = {}) => ({ id: 'c1', start_date: '2026-09-01', end_date: null, freq_type: 'daily', ...o });
const ck = (...dates) => dates.map((d) => ({ checkin_date: d }));
const states = (w) => w.cells.map((c) => c.state);

test('weekPills: 주는 월요일에 시작한다(수요일 기준 월~일 7칸, 날짜 연속)', () => {
  const w = g.weekPills(ch(), [], '2026-10-07'); // 수
  assert.equal(w.weekStart, '2026-10-05');
  assert.equal(w.weekEnd, '2026-10-11');
  assert.deepEqual(w.cells.map((c) => c.label), ['월', '화', '수', '목', '금', '토', '일']);
  assert.deepEqual(w.cells.map((c) => c.date), ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
});

test('weekPills: 일요일/월요일 경계 — 일요일엔 그 주의 월요일, 월요일엔 오늘이 첫 칸', () => {
  assert.equal(g.weekPills(ch(), [], '2026-10-11').weekStart, '2026-10-05'); // 일
  assert.equal(g.weekPills(ch(), [], '2026-10-12').weekStart, '2026-10-12'); // 다음 월
  const mon = g.weekPills(ch(), [], '2026-10-12');
  assert.deepEqual(states(mon), ['today', 'future', 'future', 'future', 'future', 'future', 'future']);
});

test('weekPills: 매일 챌린지 — 달성=done, 지난 미달성=missed, 오늘 미완료=today, 미래=future', () => {
  const w = g.weekPills(ch(), ck('2026-10-05', '2026-10-07'), '2026-10-08'); // 목요일 기준
  assert.deepEqual(states(w), ['done', 'missed', 'done', 'today', 'future', 'future', 'future']);
  assert.equal(w.doneCount, 2);
  assert.equal(w.targetCount, 7);
  assert.equal(w.missedCount, 1);
  assert.equal(w.pct, 29);
});

test('weekPills: 오늘 체크인했으면 today가 아니라 done', () => {
  const w = g.weekPills(ch(), ck('2026-10-08'), '2026-10-08');
  assert.equal(w.cells[3].state, 'done');
  assert.equal(w.cells[3].isToday, true);
});

test('weekPills: 주 중간에 시작한 챌린지는 시작 전 날짜가 inactive(빨강 아님), 목표 칸 수도 줄어든다', () => {
  const w = g.weekPills(ch({ start_date: '2026-10-07' }), ck('2026-10-07'), '2026-10-09'); // 수 시작, 금 기준
  assert.deepEqual(states(w), ['inactive', 'inactive', 'done', 'missed', 'today', 'future', 'future']);
  assert.equal(w.targetCount, 5);
  assert.equal(w.cells[0].canToggle, false);
  assert.equal(w.cells[2].canToggle, true);
});

test('weekPills: 종료일 이후 날짜는 inactive', () => {
  const w = g.weekPills(ch({ end_date: '2026-10-07' }), [], '2026-10-09');
  assert.deepEqual(states(w), ['missed', 'missed', 'missed', 'inactive', 'inactive', 'inactive', 'inactive']);
  assert.equal(w.targetCount, 3);
});

test('weekPills: 요일 지정(월·수·금) — 쉬는 요일은 지난 날이어도 missed가 아니라 rest', () => {
  const w = g.weekPills(ch({ freq_type: 'weekdays', freq_days: '1,3,5' }), ck('2026-10-05'), '2026-10-09'); // 금 기준
  assert.deepEqual(states(w), ['done', 'rest', 'missed', 'rest', 'today', 'rest', 'rest']);
  assert.equal(w.targetCount, 3);
  assert.equal(w.doneCount, 1);
  assert.equal(w.pct, 33);
});

test('weekPills: 요일 지정에서 쉬는 날에 체크인했어도 done으로 표시되고 누르면 해제할 수 있다', () => {
  const w = g.weekPills(ch({ freq_type: 'weekdays', freq_days: '1,3,5' }), ck('2026-10-06'), '2026-10-09');
  assert.equal(w.cells[1].state, 'done');
  assert.equal(w.cells[1].canToggle, true);
});

test('weekPills: 주 N회 — 지난 미체크 날은 빨강이 아니라 rest, 목표는 N', () => {
  const w = g.weekPills(ch({ freq_type: 'times_per_week', freq_times: 3 }), ck('2026-10-06'), '2026-10-09');
  assert.deepEqual(states(w), ['rest', 'done', 'rest', 'rest', 'today', 'future', 'future']);
  assert.equal(w.targetCount, 3);
  assert.equal(w.pct, 33);
  const full = g.weekPills(ch({ freq_type: 'times_per_week', freq_times: 2 }), ck('2026-10-05', '2026-10-06', '2026-10-07'), '2026-10-09');
  assert.equal(full.pct, 100); // 초과 달성도 100%로 상한
});

test('weekPills: 미래 날짜는 눌러도 체크할 수 없다(canToggle=false), 오늘과 지난 날은 가능', () => {
  const w = g.weekPills(ch(), [], '2026-10-07');
  assert.deepEqual(w.cells.map((c) => c.canToggle), [true, true, true, false, false, false, false]);
});

test('weekPills: 체크인 배열이 비어 있거나 undefined여도 동작', () => {
  assert.equal(g.weekPills(ch(), undefined, '2026-10-07').doneCount, 0);
  assert.equal(g.weekPills({}, [], '2026-10-07').cells.length, 7);
});

test('weekPills: 연말→연초 주(2026-12-28 ~ 2027-01-03)', () => {
  const w = g.weekPills(ch(), ck('2026-12-31', '2027-01-01'), '2027-01-02');
  assert.equal(w.weekStart, '2026-12-28');
  assert.equal(w.cells[6].date, '2027-01-03');
  assert.equal(w.cells[3].state, 'done');
  assert.equal(w.cells[4].state, 'done');
});

test('parseFreqDays', () => {
  assert.deepEqual([...g.parseFreqDays('1, 3,7,9,x')].sort(), [1, 3, 7]);
  assert.equal(g.parseFreqDays('').size, 0);
});
