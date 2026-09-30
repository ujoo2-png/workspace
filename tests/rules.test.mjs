import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// js/*.js는 이제 ES 모듈이 아니라 일반 <script>(globalThis.X 전역 등록) 방식이므로,
// Node에서는 파일을 읽어 그대로 평가해 전역에 등록한 뒤 사용한다. (의존성 순서대로 로드)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadGlobalScript(relPath) {
  const code = fs.readFileSync(path.join(__dirname, relPath), 'utf8');
  (0, eval)(code);
}
loadGlobalScript('../js/utils/date.js');
loadGlobalScript('../js/predict.js');
loadGlobalScript('../js/rules.js');
const { runAutomationRules } = globalThis;

const CFG = { deadlineWarningDays: 7, scheduleReminderDays: 3 };

test('마감 D-7 이내 프로젝트에 대해 알림을 생성한다', () => {
  const projects = [
    { id: 'p1', name: 'QMS 마이그레이션', status: 'in_progress', deadline: '2026-09-12' },
  ];
  const notices = runAutomationRules({ projects, schedules: [] }, CFG, '2026-09-08');
  const hit = notices.find((n) => n.type === 'deadline' && n.relatedId === 'p1');
  assert.ok(hit, 'D-4 알림이 있어야 한다');
  assert.match(hit.title, /D-4/);
});

test('마감이 지난 진행중 프로젝트는 overdue_project로 표시한다', () => {
  const projects = [{ id: 'p2', name: '지연 프로젝트', status: 'in_progress', deadline: '2026-09-01' }];
  const notices = runAutomationRules({ projects, schedules: [] }, CFG, '2026-09-08');
  const hit = notices.find((n) => n.type === 'overdue_project');
  assert.ok(hit);
  assert.equal(hit.severity, 'critical');
});

test('완료된 프로젝트는 마감 규칙에서 제외한다', () => {
  const projects = [{ id: 'p3', name: '완료됨', status: 'done', deadline: '2026-09-01' }];
  const notices = runAutomationRules({ projects, schedules: [] }, CFG, '2026-09-08');
  assert.equal(notices.filter((n) => n.relatedId === 'p3').length, 0);
});

test('14일 이상 진행률 업데이트가 없으면 stale_project 알림을 만든다', () => {
  const projects = [
    { id: 'p4', name: '방치된 과제', status: 'in_progress', created_at: '2026-08-01T00:00:00Z', lastProgressAt: '2026-08-10T00:00:00Z' },
  ];
  const notices = runAutomationRules({ projects, schedules: [] }, CFG, '2026-09-08');
  const hit = notices.find((n) => n.type === 'stale_project');
  assert.ok(hit);
});

test('지난 날짜의 미완료 일정에 대해 overdue_schedule 알림을 만든다', () => {
  const schedules = [{ id: 's1', title: '보고서 제출', date: '2026-09-01', done: false }];
  const notices = runAutomationRules({ projects: [], schedules }, CFG, '2026-09-08');
  const hit = notices.find((n) => n.type === 'overdue_schedule');
  assert.ok(hit);
});

test('완료 처리된 지난 일정은 알림을 만들지 않는다', () => {
  const schedules = [{ id: 's2', title: '완료된 일', date: '2026-09-01', done: true }];
  const notices = runAutomationRules({ projects: [], schedules }, CFG, '2026-09-08');
  assert.equal(notices.filter((n) => n.relatedId === 's2').length, 0);
});

test('동일 입력으로 두 번 실행해도 dedupeKey가 같아 중복 저장을 막을 수 있다', () => {
  const projects = [{ id: 'p1', name: 'QMS', status: 'in_progress', deadline: '2026-09-12' }];
  const first = runAutomationRules({ projects, schedules: [] }, CFG, '2026-09-08');
  const second = runAutomationRules({ projects, schedules: [] }, CFG, '2026-09-08');
  assert.equal(first[0].dedupeKey, second[0].dedupeKey);
});

test('차량 보험 만료가 30일 이내면 알림을 만든다', () => {
  const vehicles = [{ id: 'v1', name: '아반떼', insurance_expiry: '2026-09-20' }];
  const notices = runAutomationRules({ projects: [], schedules: [], vehicles }, CFG, '2026-09-08');
  const hit = notices.find((n) => n.type === 'vehicle_insurance_expiry');
  assert.ok(hit);
  assert.match(hit.title, /D-12/);
});

test('차량 등록 만료가 30일보다 많이 남으면 알림을 만들지 않는다', () => {
  const vehicles = [{ id: 'v2', name: '소나타', registration_expiry: '2027-01-01' }];
  const notices = runAutomationRules({ projects: [], schedules: [], vehicles }, CFG, '2026-09-08');
  assert.equal(notices.filter((n) => n.type === 'vehicle_registration_expiry').length, 0);
});

test('챌린지가 3일 이상 연속 기록 중 오늘 체크인을 안 하면 위험 알림을 만든다', () => {
  const challenges = [
    { id: 'c1', title: '매일 운동', status: 'active', checkins: [{ checkin_date: '2026-09-06' }, { checkin_date: '2026-09-07' }, { checkin_date: '2026-09-05' }] },
  ];
  const notices = runAutomationRules({ projects: [], schedules: [], challenges }, CFG, '2026-09-08');
  const hit = notices.find((n) => n.type === 'challenge_at_risk');
  assert.ok(hit);
});

test('enabledRules에서 규칙을 꺼두면 알림이 생기지 않는다', () => {
  const projects = [{ id: 'p1', name: 'QMS', status: 'in_progress', deadline: '2026-09-12' }];
  const notices = runAutomationRules({ projects, schedules: [] }, CFG, '2026-09-08', { deadline: { enabled: false } });
  assert.equal(notices.filter((n) => n.type === 'deadline').length, 0);
});

test('문화생활 관람 예정일이 내일이면 D-1 알림을 만든다', () => {
  const playlistItems = [{ id: 'pl1', title: '테스트 영화', status: 'to_watch', event_date: '2026-09-09' }];
  const notices = runAutomationRules({ projects: [], schedules: [], playlistItems }, CFG, '2026-09-08');
  const hit = notices.find((n) => n.type === 'playlist_reminder');
  assert.ok(hit, 'D-1 알림이 있어야 한다');
  assert.match(hit.title, /D-1/);
});

test('완료(watched) 상태의 문화생활 항목은 알림을 만들지 않는다', () => {
  const playlistItems = [{ id: 'pl2', title: '본 영화', status: 'watched', event_date: '2026-09-09' }];
  const notices = runAutomationRules({ projects: [], schedules: [], playlistItems }, CFG, '2026-09-08');
  assert.equal(notices.filter((n) => n.type === 'playlist_reminder').length, 0);
});

test('enabledRules의 params로 임계값을 바꿀 수 있다', () => {
  const vehicles = [{ id: 'v3', name: '테스트카', insurance_expiry: '2026-10-01' }]; // D-23
  const withDefault = runAutomationRules({ projects: [], schedules: [], vehicles }, CFG, '2026-09-08');
  assert.equal(withDefault.filter((n) => n.type === 'vehicle_insurance_expiry').length, 1); // 기본 30일 이내라 감지됨
  const withNarrow = runAutomationRules({ projects: [], schedules: [], vehicles }, CFG, '2026-09-08', {
    vehicle_insurance_expiry: { enabled: true, params: { days: 10 } },
  });
  assert.equal(withNarrow.filter((n) => n.type === 'vehicle_insurance_expiry').length, 0); // 10일 이내로 좁히면 감지 안 됨
});
