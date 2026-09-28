import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// js/*.js는 이제 ES 모듈이 아니라 일반 <script>(globalThis.X 전역 등록) 방식이므로,
// Node에서는 파일을 읽어 그대로 평가해 전역에 등록한 뒤 사용한다. (js/utils/date.js가 선행 의존성)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadGlobalScript(relPath) {
  const code = fs.readFileSync(path.join(__dirname, relPath), 'utf8');
  (0, eval)(code);
}
loadGlobalScript('../js/utils/date.js');
loadGlobalScript('../js/predict.js');
const {
  predictProjectCompletion,
  predictScheduleDensity,
  predictNextMaintenance,
  calcFuelEfficiency,
  predictWeeklyExerciseGoal,
  computeChallengeStreak,
} = globalThis;

test('predictProjectCompletion: 기록이 부족하면 예측하지 않는다', () => {
  const r = predictProjectCompletion([{ progress: 10, recorded_at: '2026-09-01' }], '2026-09-10');
  assert.equal(r.predictedDate, null);
  assert.equal(r.confidence, 'none');
  assert.equal(r.reason, 'insufficient_records');
});

test('predictProjectCompletion: 이미 100%면 예측하지 않는다', () => {
  const r = predictProjectCompletion(
    [
      { progress: 50, recorded_at: '2026-09-01' },
      { progress: 100, recorded_at: '2026-09-05' },
    ],
    '2026-09-10'
  );
  assert.equal(r.predictedDate, null);
  assert.equal(r.reason, 'already_complete');
});

test('predictProjectCompletion: 일정한 속도로 진행되면 완료일을 계산한다', () => {
  // 하루 10%씩 증가: 9/1=0, 9/2=10, 9/3=20, 9/4=30 → 남은 70% / 일일 10% = 7일 필요
  const records = [
    { progress: 0, recorded_at: '2026-09-01' },
    { progress: 10, recorded_at: '2026-09-02' },
    { progress: 20, recorded_at: '2026-09-03' },
    { progress: 30, recorded_at: '2026-09-04' },
  ];
  const r = predictProjectCompletion(records, '2026-09-04');
  assert.equal(r.dailyRate, 10);
  assert.equal(r.predictedDate, '2026-09-11'); // 9/4 + 7일
  assert.notEqual(r.confidence, 'none');
});

test('predictProjectCompletion: 진행률이 후퇴/정체면 예측하지 않는다', () => {
  const records = [
    { progress: 30, recorded_at: '2026-09-01' },
    { progress: 20, recorded_at: '2026-09-05' },
  ];
  const r = predictProjectCompletion(records, '2026-09-06');
  assert.equal(r.predictedDate, null);
  assert.equal(r.reason, 'no_progress_or_regressing');
});

test('predictProjectCompletion: 순서가 뒤섞여 들어와도 정렬 후 계산한다', () => {
  const records = [
    { progress: 30, recorded_at: '2026-09-04' },
    { progress: 0, recorded_at: '2026-09-01' },
  ];
  const r = predictProjectCompletion(records, '2026-09-04', 2);
  assert.equal(r.dailyRate, 10);
});

test('predictScheduleDensity: 과거 평균보다 많은 날을 congested로 표시한다', () => {
  const schedules = [];
  // 지난 4주간 매주 같은 요일(월요일 기준일 계산 편의상 특정 날짜로 고정)에 1건씩
  // 2026-09-07(월)을 기준일로 두고, 그 이전 4주 월요일에 1건씩 등록
  const pastMondays = ['2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31'];
  for (const d of pastMondays) schedules.push({ id: d, date: d, title: '정기회의' });
  // 다음 주 월요일(2026-09-07)에는 5건 몰림
  for (let i = 0; i < 5; i++) schedules.push({ id: `busy-${i}`, date: '2026-09-07', title: `일정${i}` });

  const result = predictScheduleDensity(schedules, '2026-09-07', 4);
  const monday = result.find((r) => r.date === '2026-09-07');
  assert.ok(monday, '오늘 날짜가 결과에 포함되어야 한다');
  assert.equal(monday.average, 1);
  assert.equal(monday.count, 5);
  assert.equal(monday.congested, true);
});

test('predictScheduleDensity: 평소와 비슷하면 congested가 아니다', () => {
  const schedules = [{ id: '1', date: '2026-09-07', title: '보통날' }];
  const result = predictScheduleDensity(schedules, '2026-09-07', 4);
  const today = result.find((r) => r.date === '2026-09-07');
  assert.equal(today.congested, false);
});

// ---- predictNextMaintenance ----

test('predictNextMaintenance: 정비 기록이 없으면 예측하지 않는다', () => {
  const r = predictNextMaintenance(null, [], '2026-09-10');
  assert.equal(r.predictedDate, null);
  assert.equal(r.basis, 'none');
});

test('predictNextMaintenance: 주행거리 추세가 날짜보다 먼저 도달하면 odometer 기준을 쓴다', () => {
  // 하루 50km씩 주행, 현재 10,000km, 다음 정비 목표 10,300km(6일 뒤 도달) vs 날짜기준 30일 뒤
  const fuelLogs = [
    { logged_at: '2026-09-01', odometer: 9700 },
    { logged_at: '2026-09-06', odometer: 10000 },
  ];
  const r = predictNextMaintenance({ next_due_odometer: 10300, next_due_date: '2026-10-10' }, fuelLogs, '2026-09-06');
  assert.equal(r.basis, 'odometer');
  assert.equal(r.dailyKm, 60);
  assert.equal(r.predictedDate, '2026-09-11'); // 300km 남음 / 60km = 5일 → +5일
});

test('predictNextMaintenance: 주행 데이터가 없으면 등록된 날짜를 그대로 쓴다', () => {
  const r = predictNextMaintenance({ next_due_date: '2026-10-01' }, [], '2026-09-06');
  assert.equal(r.basis, 'date');
  assert.equal(r.predictedDate, '2026-10-01');
});

test('calcFuelEfficiency: 주행거리/주유량으로 평균 연비를 계산한다', () => {
  const fuelLogs = [
    { logged_at: '2026-09-01', odometer: 1000, amount: 0 },
    { logged_at: '2026-09-05', odometer: 1500, amount: 50 }, // 500km / 50L = 10 km/L
  ];
  assert.equal(calcFuelEfficiency(fuelLogs), 10);
});

test('calcFuelEfficiency: 기록이 2건 미만이면 null', () => {
  assert.equal(calcFuelEfficiency([{ logged_at: '2026-09-01', odometer: 100, amount: 5 }]), null);
});

// ---- predictWeeklyExerciseGoal ----

test('predictWeeklyExerciseGoal: 목표를 채우면 100% 이상은 100으로 캡한다', () => {
  const metrics = Array.from({ length: 14 }, (_, i) => ({ recorded_at: `2026-09-${String(i + 1).padStart(2, '0')}` }));
  const r = predictWeeklyExerciseGoal(metrics, 3, '2026-09-14');
  assert.equal(r.probability, 100);
  assert.equal(r.confidence, 'high');
});

test('predictWeeklyExerciseGoal: 기록이 없으면 신뢰도 none, 확률 0', () => {
  const r = predictWeeklyExerciseGoal([], 3, '2026-09-14');
  assert.equal(r.probability, 0);
  assert.equal(r.confidence, 'none');
});

// ---- computeChallengeStreak ----

test('computeChallengeStreak: 오늘까지 연속으로 체크인하면 streak과 checkedToday가 반영된다', () => {
  const checkins = [{ checkin_date: '2026-09-06' }, { checkin_date: '2026-09-07' }, { checkin_date: '2026-09-08' }];
  const r = computeChallengeStreak(checkins, '2026-09-08');
  assert.equal(r.streak, 3);
  assert.equal(r.checkedToday, true);
  assert.equal(r.atRisk, false);
});

test('computeChallengeStreak: 어제까지 이어오다 오늘 체크인 안 하면 위험 표시', () => {
  const checkins = [{ checkin_date: '2026-09-06' }, { checkin_date: '2026-09-07' }];
  const r = computeChallengeStreak(checkins, '2026-09-08');
  assert.equal(r.streak, 2);
  assert.equal(r.checkedToday, false);
  assert.equal(r.atRisk, true);
});

test('computeChallengeStreak: 체크인이 아예 없으면 streak 0, 위험 아님', () => {
  const r = computeChallengeStreak([], '2026-09-08');
  assert.equal(r.streak, 0);
  assert.equal(r.atRisk, false);
});
