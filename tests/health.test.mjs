import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// predict.js / analytics.js는 일반 <script>(전역 등록)라 Node에서는 읽어서 평가한다.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
globalThis.window = globalThis;
function load(rel) { (0, eval)(fs.readFileSync(path.join(__dirname, rel), 'utf8')); }
load('../js/utils/date.js');
load('../js/predict.js');
load('../js/modules/analytics.js'); // 로드 시 DOM을 만지지 않는다(순수 함수 computeTargetLineGeometry만 사용)
const G = globalThis;

// 2026-10-01(목) ~ 2026-10-07(수). 10-05는 월요일.
const daily = (extra = {}) => ({ id: 'm1', schedule_type: 'daily', dose_times: '08:00', start_date: '2026-10-01', end_date: null, active: true, ...extra });
const log = (date, slot = '08:00', status = 'taken', med = 'm1') => ({ medication_id: med, taken_date: date, slot, status });

// ---------------------------------------------------------------- 기준치 / 일관성
test('BP_RANGES(대시보드 음영)는 bpStatus 임계값과 일치한다', () => {
  const { bp_systolic: s, bp_diastolic: d } = G.BP_RANGES;
  // 수축기: 정상 상한 119 → 120부터 주의, 139까지 주의, 140부터 높음
  assert.equal(G.bpStatus(s.normal.max, 70).level, 'success');
  assert.equal(G.bpStatus(s.normal.max + 1, 70).level, 'warning');
  assert.equal(G.bpStatus(s.caution.max, 70).level, 'warning');
  assert.equal(G.bpStatus(s.caution.max + 1, 70).level, 'critical');
  assert.equal(s.caution.min, s.normal.max + 1);
  // 이완기: 정상 상한 79 → 80부터 주의, 89까지 주의, 90부터 높음
  assert.equal(G.bpStatus(110, d.normal.max).level, 'success');
  assert.equal(G.bpStatus(110, d.normal.max + 1).level, 'warning');
  assert.equal(G.bpStatus(110, d.caution.max).level, 'warning');
  assert.equal(G.bpStatus(110, d.caution.max + 1).level, 'critical');
  assert.equal(d.caution.min, d.normal.max + 1);
  assert.equal(s.normal.min, 90);
  assert.equal(d.normal.min, 60);
});

test('glucoseStatus / cholesterolStatus 경계값', () => {
  assert.equal(G.glucoseStatus(99).level, 'success');
  assert.equal(G.glucoseStatus(100).level, 'warning');
  assert.equal(G.glucoseStatus(126).level, 'critical');
  assert.equal(G.glucoseStatus(null), null);
  assert.equal(G.cholesterolStatus('total_cholesterol', 199).level, 'success');
  assert.equal(G.cholesterolStatus('total_cholesterol', 240).level, 'critical');
  assert.equal(G.cholesterolStatus('hdl', 39).level, 'critical');
  assert.equal(G.cholesterolStatus('nope', 1), null);
});

test('localDateOf: 로컬 날짜 기준(YYYY-MM-DD는 그대로, 로컬 시각 문자열은 같은 날짜)', () => {
  assert.equal(G.localDateOf('2026-10-03'), '2026-10-03');
  assert.equal(G.localDateOf('2026-10-03T00:30:00'), '2026-10-03'); // 타임존 표기 없는 로컬 시각
  const d = new Date(2026, 9, 3, 7, 0, 0); // 로컬 2026-10-03 07:00
  assert.equal(G.localDateOf(d.toISOString()), '2026-10-03'); // UTC 문자열이어도 로컬 날짜로 되돌린다
  assert.equal(G.localDateOf(''), '');
});

// ---------------------------------------------------------------- 복용 일정
test('parseDoseTimes / parseWeekdays / doseSlots', () => {
  assert.deepEqual(G.parseDoseTimes('20:00, 8:05 ,08:05,99:00,abc'), ['08:05', '20:00']);
  assert.deepEqual(G.parseDoseTimes(''), []);
  assert.deepEqual(G.parseDoseTimes(null), []);
  assert.deepEqual(G.parseWeekdays('5,1,1,9,x,0'), [0, 1, 5]);
  assert.deepEqual(G.doseSlots({ dose_times: '' }), ['']);
  assert.deepEqual(G.doseSlots({ dose_times: '12:00,08:00' }), ['08:00', '12:00']);
});

test('expectedDoses: 매일 1회 — 시작일 이전/오늘 이후(미래)는 제외', () => {
  const med = daily();
  assert.equal(G.expectedDoses(med, '2026-09-20', '2026-10-31', '2026-10-05').length, 5); // 10-01~10-05
  assert.deepEqual(G.expectedDoses(med, '2026-10-04', '2026-10-06', '2026-10-05').map((d) => d.date), ['2026-10-04', '2026-10-05']);
  assert.equal(G.expectedDoses(med, '2026-10-06', '2026-10-09', '2026-10-05').length, 0); // 전부 미래
  assert.equal(G.expectedDoses(med, '2026-09-01', '2026-09-30', '2026-10-05').length, 0); // 시작 전
});

test('expectedDoses: 하루 여러 번 — 오늘은 nowHHMM 이후 슬롯을 제외', () => {
  const med = daily({ dose_times: '08:00,13:00,20:00' });
  assert.equal(G.expectedDoses(med, '2026-10-04', '2026-10-05', '2026-10-05').length, 6);
  const noon = G.expectedDoses(med, '2026-10-04', '2026-10-05', '2026-10-05', '12:00');
  assert.equal(noon.length, 4); // 10-04 3회 + 오늘 08:00
  assert.deepEqual(noon.filter((d) => d.date === '2026-10-05').map((d) => d.slot), ['08:00']);
});

test('expectedDoses: N일마다는 시작일 기준으로 센다', () => {
  const med = daily({ schedule_type: 'every_n_days', interval_days: 3 }); // 10-01, 10-04, 10-07
  assert.deepEqual(G.expectedDoses(med, '2026-10-01', '2026-10-08', '2026-10-08').map((d) => d.date), ['2026-10-01', '2026-10-04', '2026-10-07']);
  // 구간 시작이 시작일 이후여도 주기는 시작일 기준
  assert.deepEqual(G.expectedDoses(med, '2026-10-02', '2026-10-08', '2026-10-08').map((d) => d.date), ['2026-10-04', '2026-10-07']);
  // interval이 비정상이면 매일로 취급
  assert.equal(G.expectedDoses(daily({ schedule_type: 'every_n_days', interval_days: 0 }), '2026-10-01', '2026-10-03', '2026-10-03').length, 3);
});

test('expectedDoses: 특정 요일(월·수·금)과 요일 없음', () => {
  const med = daily({ schedule_type: 'weekdays', weekdays: '1,3,5', start_date: '2026-09-28' }); // 9-28은 월요일
  // 9-28(월) 9-30(수) 10-02(금) 10-05(월) 10-07(수)
  assert.deepEqual(G.expectedDoses(med, '2026-09-28', '2026-10-07', '2026-10-07').map((d) => d.date), ['2026-09-28', '2026-09-30', '2026-10-02', '2026-10-05', '2026-10-07']);
  assert.equal(G.expectedDoses(daily({ schedule_type: 'weekdays', weekdays: '' }), '2026-10-01', '2026-10-07', '2026-10-07').length, 0);
});

test('expectedDoses: end_date 이후는 제외(종료일 당일은 포함)', () => {
  const med = daily({ end_date: '2026-10-03' });
  assert.deepEqual(G.expectedDoses(med, '2026-10-01', '2026-10-07', '2026-10-07').map((d) => d.date), ['2026-10-01', '2026-10-02', '2026-10-03']);
  assert.equal(G.isScheduledOn(med, '2026-10-04'), false);
  assert.equal(G.isScheduledOn(med, '2026-10-03'), true);
});

test('시각 없이(slot "") 하루 1회로 입력한 약도 계산된다', () => {
  const med = daily({ dose_times: '' });
  assert.equal(G.expectedDoses(med, '2026-10-01', '2026-10-03', '2026-10-03', '07:00').length, 3); // slot ''은 "아직 안 옴"으로 제외하지 않는다
  assert.equal(G.adherenceRate(med, [log('2026-10-01', ''), log('2026-10-02', '')], '2026-10-01', '2026-10-03', '2026-10-03').taken, 2);
});

// ---------------------------------------------------------------- 복용률 / 연속 / 놓침
test('adherenceRate: taken만 분자, skipped·기록 없음은 미복용, 다른 약의 기록은 무시', () => {
  const med = daily();
  const logs = [log('2026-10-01'), log('2026-10-02'), log('2026-10-03', '08:00', 'skipped'), log('2026-10-04', '08:00', 'taken', 'OTHER')];
  const r = G.adherenceRate(med, logs, '2026-10-01', '2026-10-05', '2026-10-05');
  assert.deepEqual({ e: r.expected, t: r.taken, s: r.skipped, m: r.missed, rate: r.rate }, { e: 5, t: 2, s: 1, m: 2, rate: 40 });
});

test('adherenceRate: 오늘 아직 오지 않은 시각은 분모에서 빼고, 미리 복용했다면 센다', () => {
  const med = daily({ dose_times: '08:00,20:00' });
  const logs = [log('2026-10-05', '08:00')];
  let r = G.adherenceRate(med, logs, '2026-10-05', '2026-10-05', '2026-10-05', '10:00');
  assert.deepEqual([r.expected, r.taken, r.rate], [1, 1, 100]);
  r = G.adherenceRate(med, [...logs, log('2026-10-05', '20:00')], '2026-10-05', '2026-10-05', '2026-10-05', '10:00'); // 20:00을 미리 복용
  assert.deepEqual([r.expected, r.taken, r.rate], [2, 2, 100]);
  r = G.adherenceRate(med, [], '2026-10-05', '2026-10-05', '2026-10-05', '21:00');
  assert.deepEqual([r.expected, r.taken, r.rate], [2, 0, 0]);
});

test('adherenceRate: 복용할 일이 없으면 rate는 null(0%가 아님)', () => {
  const r = G.adherenceRate(daily({ start_date: '2026-10-10' }), [], '2026-10-01', '2026-10-07', '2026-10-07');
  assert.deepEqual([r.expected, r.rate], [0, null]);
});

test('adherenceRate: 격일 약은 일정 있는 날만 분모', () => {
  const med = daily({ schedule_type: 'every_n_days', interval_days: 2 }); // 10-01,03,05,07
  const r = G.adherenceRate(med, [log('2026-10-01'), log('2026-10-03'), log('2026-10-02')], '2026-10-01', '2026-10-07', '2026-10-07');
  assert.deepEqual([r.expected, r.taken, r.rate], [4, 2, 50]); // 10-02는 복용일이 아니므로 무시
});

test('missedDoses: 지났는데 안 먹은 것만, 최근순, status 구분', () => {
  const med = daily({ dose_times: '08:00,20:00' });
  const logs = [log('2026-10-04', '08:00'), log('2026-10-04', '20:00', 'skipped'), log('2026-10-05', '08:00')];
  const m = G.missedDoses(med, logs, '2026-10-04', '2026-10-05', '2026-10-05', '12:00');
  assert.deepEqual(m, [{ date: '2026-10-04', slot: '20:00', status: 'skipped' }]);
  const m2 = G.missedDoses(med, logs, '2026-10-04', '2026-10-05', '2026-10-05', '21:00');
  assert.deepEqual(m2.map((x) => `${x.date} ${x.slot} ${x.status}`), ['2026-10-05 20:00 missed', '2026-10-04 20:00 skipped']);
});

test('medDayStatus: none / upcoming / taken / partial / missed', () => {
  const med = daily({ dose_times: '08:00,20:00' });
  const st = (logs, iso, now) => G.medDayStatus(med, logs, iso, '2026-10-05', now);
  assert.equal(st([], '2026-09-30').state, 'none'); // 시작 전
  assert.equal(st([], '2026-10-06').state, 'upcoming'); // 미래
  assert.equal(st([log('2026-10-04'), log('2026-10-04', '20:00')], '2026-10-04').state, 'taken');
  assert.equal(st([log('2026-10-04')], '2026-10-04').state, 'partial');
  assert.equal(st([], '2026-10-04').state, 'missed');
  assert.equal(st([], '2026-10-05', '07:00').state, 'upcoming'); // 오늘 아직 아무 시각도 안 옴
  const half = st([log('2026-10-05')], '2026-10-05', '10:00'); // 아침 복용, 저녁은 아직
  assert.deepEqual([half.state, half.pending], ['taken', true]);
  assert.equal(st([], '2026-10-05', '09:00').state, 'missed'); // 아침 시각이 지났는데 안 먹음
  assert.equal(G.medDayStatus(daily({ schedule_type: 'weekdays', weekdays: '0' }), [], '2026-10-05', '2026-10-05').state, 'none'); // 월요일은 일요일 약 아님
});

test('currentStreak: 연속 복용일 — 어제까지 + 오늘 완료 시 포함, 끊기면 거기까지', () => {
  const med = daily();
  const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];
  assert.equal(G.currentStreak(med, days.map((d) => log(d)), '2026-10-05'), 4); // 오늘은 아직(끊지 않음, 세지도 않음)
  assert.equal(G.currentStreak(med, [...days, '2026-10-05'].map((d) => log(d)), '2026-10-05'), 5);
  // 10-03 누락 → 10-04만 연속
  assert.equal(G.currentStreak(med, ['2026-10-01', '2026-10-02', '2026-10-04'].map((d) => log(d)), '2026-10-05'), 1);
  assert.equal(G.currentStreak(med, [], '2026-10-05'), 0);
  assert.equal(G.currentStreak(daily({ start_date: '2026-10-10' }), [], '2026-10-05'), 0);
});

test('currentStreak: 격일/요일 약은 일정 없는 날을 건너뛰고, 하루 2회 중 1회만 먹으면 그날이 끊긴다', () => {
  const every2 = daily({ schedule_type: 'every_n_days', interval_days: 2 }); // 10-01,03,05
  assert.equal(G.currentStreak(every2, ['2026-10-01', '2026-10-03', '2026-10-05'].map((d) => log(d)), '2026-10-05'), 3);
  assert.equal(G.currentStreak(every2, ['2026-10-01', '2026-10-05'].map((d) => log(d)), '2026-10-05'), 1);
  const twice = daily({ dose_times: '08:00,20:00' });
  const logs = [log('2026-10-02'), log('2026-10-02', '20:00'), log('2026-10-03'), log('2026-10-04'), log('2026-10-04', '20:00')];
  assert.equal(G.currentStreak(twice, logs, '2026-10-05', '07:00'), 1); // 10-04 완료, 10-03은 한 번만 → 끊김
  // 오늘 아침만 먹고 저녁이 남은 날(pending)은 세지 않는다
  assert.equal(G.currentStreak(twice, [log('2026-10-04'), log('2026-10-04', '20:00'), log('2026-10-05')], '2026-10-05', '10:00'), 1);
});

test('daysOfSupplyLeft: 남은 수량으로 복용 가능 일수(일/격일/하루 여러 번/종료일)', () => {
  const T = '2026-10-05';
  assert.equal(G.daysOfSupplyLeft(daily({ remaining_count: 10 }), T), 10);
  assert.equal(G.daysOfSupplyLeft(daily({ remaining_count: 10, dose_times: '08:00,20:00' }), T), 5);
  assert.equal(G.daysOfSupplyLeft(daily({ remaining_count: 3, schedule_type: 'every_n_days', interval_days: 2, start_date: '2026-10-05' }), T), 5); // 5,7,9일
  assert.equal(G.daysOfSupplyLeft(daily({ remaining_count: 0 }), T), 0);
  assert.equal(G.daysOfSupplyLeft(daily({ remaining_count: null }), T), null);
  assert.equal(G.daysOfSupplyLeft(daily({}), T), null);
  assert.equal(G.daysOfSupplyLeft(daily({ remaining_count: 100, end_date: '2026-10-08' }), T), 4); // 종료일이 먼저 → 충분함
});

test('overdueDosesNow: 지났고 미체크이며 너무 오래되지 않은 시각만', () => {
  const med = daily({ dose_times: '08:00,12:00,20:00' });
  const off = daily({ id: 'm2', active: false });
  const logs = [log('2026-10-05', '08:00')];
  const r = G.overdueDosesNow([med, off], logs, '2026-10-05', '12:30', 0, 60);
  assert.deepEqual(r.map((x) => x.slot), ['12:00']);
  assert.deepEqual(G.overdueDosesNow([med], [], '2026-10-05', '12:30', 0, 60).map((x) => x.slot), ['12:00']); // 08:00은 4시간 지나 제외
  assert.deepEqual(G.overdueDosesNow([med], [], '2026-10-05', '12:05', 10, null).map((x) => x.slot), ['08:00']); // 유예 10분: 12:00은 아직
});

// ---------------------------------------------------------------- 일별 모니터링
const metric = (type, value, date, time = '12:00:00', extra = {}) => ({ metric_type: type, value, recorded_at: `${date}T${time}`, ...extra });

test('buildDailyHealthRows: 하루의 마지막 기록, 운동은 합계, 복약은 활성 약 합산', () => {
  const metrics = [
    metric('weight', 76, '2026-10-04', '07:00:00'), metric('weight', 75.5, '2026-10-04', '21:00:00'),
    metric('exercise', 30, '2026-10-04'), metric('exercise', 20, '2026-10-04', '18:00:00'),
    metric('bp_systolic', 118, '2026-10-05'), metric('bp_diastolic', 76, '2026-10-05'),
    metric('condition', 2, '2026-10-05', '09:00:00', { note: '두통' }),
  ];
  const meds = [daily({ id: 'a' }), daily({ id: 'b', dose_times: '08:00,20:00' }), daily({ id: 'c', active: false })];
  const logs = [log('2026-10-04', '08:00', 'taken', 'a'), log('2026-10-04', '08:00', 'taken', 'b'), log('2026-10-04', '20:00', 'taken', 'b')];
  const rows = G.buildDailyHealthRows(metrics, meds, logs, '2026-10-03', '2026-10-05', '2026-10-05', '09:30');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.date), ['2026-10-03', '2026-10-04', '2026-10-05']);
  assert.equal(rows[1].weight, 75.5);
  assert.equal(rows[1].exercise, 50);
  assert.deepEqual([rows[2].systolic, rows[2].diastolic, rows[2].condition, rows[2].conditionNote], [118, 76, 2, '두통']);
  assert.deepEqual(rows[0].adherence, { expected: 3, taken: 0, state: 'missed', pending: false }); // a 1회 + b 2회
  assert.deepEqual(rows[1].adherence, { expected: 3, taken: 3, state: 'taken', pending: false });
  assert.equal(rows[2].adherence.state, 'missed'); // 오늘 09:30 — a·b 모두 08:00을 안 먹었고 b의 20:00만 아직 시각 전
});

test('buildDailyHealthRows: 오늘 지난 시각을 안 먹었으면 missed, 복용 일정이 아예 없으면 adherence=null', () => {
  const meds = [daily({ id: 'a' })];
  const rows = G.buildDailyHealthRows([], meds, [], '2026-10-05', '2026-10-05', '2026-10-05', '09:30');
  assert.equal(rows[0].adherence.state, 'missed');
  const none = G.buildDailyHealthRows([], [], [], '2026-10-04', '2026-10-05', '2026-10-05');
  assert.equal(none[0].adherence, null);
  assert.equal(G.dailyHealthStatus(none[0]).level, 'none');
});

test('dailyHealthStatus: 혈압·혈당·복약·컨디션을 합쳐 좋음/주의/확인필요', () => {
  const ok = { adherence: { expected: 2, taken: 2, state: 'taken' } };
  assert.equal(G.dailyHealthStatus({ systolic: 115, diastolic: 75, ...ok }).level, 'good');
  assert.equal(G.dailyHealthStatus({ systolic: 135, diastolic: 82, ...ok }).level, 'caution');
  assert.equal(G.dailyHealthStatus({ systolic: 150, diastolic: 95, ...ok }).level, 'check');
  assert.equal(G.dailyHealthStatus({ systolic: 115, diastolic: 75, adherence: { expected: 2, taken: 1, state: 'partial' } }).level, 'caution');
  assert.equal(G.dailyHealthStatus({ systolic: 115, diastolic: 75, adherence: { expected: 2, taken: 0, state: 'missed' } }).level, 'check');
  assert.equal(G.dailyHealthStatus({ blood_glucose: 110 }).level, 'caution');
  assert.equal(G.dailyHealthStatus({ blood_glucose: 130 }).level, 'check');
  assert.equal(G.dailyHealthStatus({ condition: 2 }).level, 'caution');
  assert.equal(G.dailyHealthStatus({ condition: 4, weight: 70 }).level, 'good');
  assert.equal(G.dailyHealthStatus({ adherence: { expected: 0, taken: 0, state: 'upcoming' } }).level, 'none'); // 아직 오지 않은 복약만 있는 날은 판단하지 않는다
  const worst = G.dailyHealthStatus({ systolic: 150, diastolic: 95, condition: 1, adherence: { expected: 1, taken: 0, state: 'missed' } });
  assert.equal(worst.level, 'check');
  assert.ok(worst.reasons.length >= 3);
  assert.equal(G.dailyHealthStatus({ steps: 3000 }).level, 'good'); // 걸음수만 있는 날: 판정 기준이 없으므로 나쁘다고 하지 않는다
});

test('summarizeDailyRows: 복약 합산, 혈압 정상일, 체중 변화', () => {
  const rows = [
    { date: 'a', systolic: 115, diastolic: 75, weight: 76, adherence: { expected: 2, taken: 2, state: 'taken' } },
    { date: 'b', systolic: 135, diastolic: 85, weight: 75.6, adherence: { expected: 2, taken: 1, state: 'partial' } },
    { date: 'c', adherence: { expected: 2, taken: 2, state: 'taken' } },
    { date: 'd' },
  ];
  const s = G.summarizeDailyRows(rows);
  assert.deepEqual(s.adherence, { expected: 6, taken: 5, rate: 83 });
  assert.deepEqual(s.bp, { days: 2, normalDays: 1 });
  assert.equal(s.weightDelta, -0.4);
  assert.equal(s.days, 4);
  assert.equal(G.summarizeDailyRows([{ date: 'x' }]).adherence.rate, null);
});

test('adherenceBpHint: 표본/차이가 충분할 때만(과장 방지)', () => {
  const mk = (n, sys, state) => Array.from({ length: n }, () => ({ systolic: sys, adherence: { expected: 1, taken: state === 'taken' ? 1 : 0, state } }));
  assert.equal(G.adherenceBpHint([...mk(4, 115, 'taken'), ...mk(6, 130, 'missed')]), null); // 복용한 날 4일 < 5
  assert.equal(G.adherenceBpHint([...mk(6, 118, 'taken'), ...mk(6, 121, 'partial')]), null); // 차이 3 < 5
  const h = G.adherenceBpHint([...mk(6, 115, 'taken'), ...mk(5, 130, 'missed')]);
  assert.deepEqual(h, { adherentDays: 6, otherDays: 5, adherentAvg: 115, otherAvg: 130, diff: 15 });
  // 혈압 기록이 없는 날/복약 일정 없는 날은 표본에서 제외
  assert.equal(G.adherenceBpHint([...mk(6, 115, 'taken'), ...Array.from({ length: 9 }, () => ({ adherence: { expected: 1, taken: 0, state: 'missed' } }))]), null);
  assert.equal(G.adherenceBpHint([...mk(6, 115, 'taken'), ...Array.from({ length: 9 }, () => ({ systolic: 150, adherence: null }))]), null);
});

test('describeTargetGap: 목표 대비 / 정상 범위 문구', () => {
  assert.equal(G.describeTargetGap(77.3, 75, 'kg').text, '목표 대비 +2.3kg');
  assert.equal(G.describeTargetGap(74.2, 75, 'kg').text, '목표 대비 -0.8kg');
  assert.equal(G.describeTargetGap(75, 75, 'kg').text, '목표와 같음(75kg)');
  assert.equal(G.describeTargetGap(7000, 8000, '걸음').text, '목표 대비 -1000걸음');
  assert.equal(G.describeTargetGap(80, null, 'kg').text, '');
  assert.equal(G.describeTargetGap(null, 75, 'kg').text, '');
  const band = { min: 90, max: 119 };
  assert.equal(G.describeTargetGap(110, null, 'mmHg', band).text, '정상 범위(90–119) 안');
  assert.equal(G.describeTargetGap(124, null, 'mmHg', band).text, '정상 범위(90–119) 상한 대비 +5mmHg');
  assert.equal(G.describeTargetGap(85, null, 'mmHg', band).text, '정상 범위(90–119) 하한 대비 -5mmHg');
  assert.equal(G.describeTargetGap(124, 120, 'mmHg', band).text, '목표 대비 +4mmHg · 정상 범위(90–119) 상한 대비 +5mmHg');
  assert.equal(G.describeTargetGap(110, null, 'mmHg', band).inBand, true);
});

// ---------------------------------------------------------------- targetLineChart 스케일/경로
test('niceTicks: 1·2·5 간격 눈금', () => {
  assert.deepEqual(G.niceTicks(70, 80, 5), [70, 72, 74, 76, 78, 80]);
  assert.deepEqual(G.niceTicks(0, 1, 4), [0, 0.5, 1]);
  assert.deepEqual(G.niceTicks(0, 1, 10), [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]); // 부동소수 오차 없이
  assert.deepEqual(G.niceTicks(5, 5, 4), [5]);
});

test('computeTargetLineGeometry: y축이 값+목표+음영 범위를 모두 포함하고 위가 큰 값', () => {
  const g = G.computeTargetLineGeometry([78, 77, 76.5], { target: 75 });
  assert.ok(g.yMin < 75 && g.yMax > 78);
  assert.ok(g.targetY > g.points[2].y, '목표(75)는 마지막 값(76.5)보다 아래(= y가 더 큼)'); // SVG y는 아래로 증가
  assert.ok(g.points[0].y < g.points[2].y, '78이 76.5보다 위');
  assert.ok(g.targetY <= g.plot.b && g.targetY >= g.plot.t);
  const bp = G.computeTargetLineGeometry([112, 118], { bands: [{ min: 90, max: 119, tone: 'normal' }, { min: 120, max: 139, tone: 'caution' }] });
  assert.ok(bp.yMin < 90 && bp.yMax > 139);
  assert.equal(bp.bands.length, 2);
  assert.ok(bp.bands[0].y1 > bp.bands[1].y1, '정상 범위(낮은 값)가 주의 범위보다 아래에 그려진다');
  for (const b of bp.bands) { assert.ok(b.y1 <= b.y2); assert.ok(b.y1 >= bp.plot.t - 1e-9 && b.y2 <= bp.plot.b + 1e-9); }
  assert.ok(bp.ticks.every((t) => t.y >= bp.plot.t - 1e-9 && t.y <= bp.plot.b + 1e-9));
});

test('computeTargetLineGeometry: null은 선을 끊고(0으로 그리지 않음) 점 하나뿐인 구간도 유지', () => {
  const g = G.computeTargetLineGeometry([70, null, 72, 73, null, 75], {});
  assert.equal(g.points[1], null);
  assert.deepEqual(g.segments.map((s) => s.idx), [[0], [2, 3], [5]]);
  assert.match(g.segments[1].d, /^M[\d.]+,[\d.]+ L[\d.]+,[\d.]+$/);
  assert.ok(g.yMin > 0, 'null을 0으로 보지 않아 y축이 0까지 내려가지 않는다');
});

test('computeTargetLineGeometry: 값 하나/같은 값/빈 입력/목표만', () => {
  const one = G.computeTargetLineGeometry([75], { target: 75 });
  assert.equal(one.points[0].x, (one.plot.l + one.plot.r) / 2);
  assert.ok(Number.isFinite(one.targetY) && Number.isFinite(one.points[0].y));
  assert.equal(G.computeTargetLineGeometry([], {}), null);
  assert.equal(G.computeTargetLineGeometry([null, null], {}), null);
  const onlyTarget = G.computeTargetLineGeometry([null], { target: 75 });
  assert.ok(onlyTarget && onlyTarget.targetY !== null);
  assert.equal(G.computeTargetLineGeometry([1, 2], { target: 'x' }).targetY, null); // 숫자가 아닌 목표는 무시
  const flat = G.computeTargetLineGeometry([5, 5, 5], {});
  assert.ok(flat.yMax > flat.yMin);
  assert.deepEqual(flat.segments[0].idx, [0, 1, 2]);
});

test('aggregateMetricTrend / predictWeeklyExerciseGoal: 이른 아침(UTC로는 전날) 기록도 로컬 날짜 기준으로 센다', () => {
  const early = new Date(2026, 9, 3, 7, 0, 0).toISOString(); // 로컬 2026-10-03 07:00 (KST라면 UTC로는 10-02)
  const trend = G.aggregateMetricTrend([{ value: 75, recorded_at: early }], 'week', 1, '2026-10-03');
  assert.deepEqual(trend.values, [75]);
  assert.equal(trend.counts[0], 1);
  assert.equal(G.predictWeeklyExerciseGoal([{ recorded_at: early }], 3, '2026-10-03').sessionsPerWeek, 0.5); // 14일 중 1회 → 주당 0.5회
});
