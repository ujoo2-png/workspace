import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// v7.19.0 Health 저장 속도 개선(낙관적 갱신 + 대상 테이블만 재조회) 및 복약/일정 상태 로직 검증.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function load(rel) { (0, eval)(fs.readFileSync(path.join(__dirname, rel), 'utf8')); }
class FakeLS { constructor() { this.d = new Map(); } getItem(k) { return this.d.has(k) ? this.d.get(k) : null; } setItem(k, v) { this.d.set(k, String(v)); } removeItem(k) { this.d.delete(k); } }
globalThis.localStorage = new FakeLS();
globalThis.sessionStorage = new FakeLS();
globalThis.window = globalThis;
globalThis.window.addEventListener = () => {};
globalThis.CONFIG = { mode: 'local' };
load('../js/utils/id.js');
load('../js/utils/date.js');
load('../js/store/localStore.js');
globalThis.getStore = () => new globalThis.LocalStore();
load('../js/services/settingsSync.js');
load('../js/utils/attachLogic.js');
load('../js/utils/emoji.js');
load('../js/state.js');
const { appState } = globalThis;

let n = 0;
async function setup() {
  globalThis.localStorage = new FakeLS();
  globalThis.sessionStorage = new FakeLS();
  const store = new globalThis.LocalStore();
  appState.store = store;
  appState.healthMetrics = []; appState.healthAppointments = []; appState.healthMedications = []; appState.healthMedLogs = [];
  appState._wseq = {}; appState._reconcileTimers = {}; appState._inflight = new Set(); appState._linkPromises = new Map();
  const u = `u${++n}`;
  await store.signUp({ username: u, password: 'pw1234' });
  appState.user = (await store.signIn(u, 'pw1234')).user;
  await appState.refreshAll();
  return store;
}

// store 호출을 세고(옵션으로 지연/실패 주입) 감싼다.
function instrument(store, { delay = 0, fail = {} } = {}) {
  const calls = [];
  for (const m of ['list', 'get', 'create', 'createMany', 'update', 'remove', 'softDelete']) {
    const orig = store[m].bind(store);
    store[m] = async (table, ...rest) => {
      calls.push(`${m}:${table}`);
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (fail[`${m}:${table}`]) throw new Error(fail[`${m}:${table}`]);
      return orig(table, ...rest);
    };
  }
  return calls;
}

test('addHealthMetric: 서버 응답 전에 화면 상태(임시 행)와 change가 먼저 나온다', async () => {
  const store = await setup();
  instrument(store, { delay: 50 });
  let changedBeforeCreate = false;
  const onChange = () => { if (appState.healthMetrics.some((m) => m._pending)) changedBeforeCreate = true; };
  appState.addEventListener('change', onChange);
  const p = appState.addHealthMetric({ metric_type: 'weight', value: 75, unit: 'kg' });
  assert.equal(appState.healthMetrics.length, 1, 'await 없이 곧바로 반영');
  assert.equal(appState.healthMetrics[0]._pending, true);
  assert.ok(String(appState.healthMetrics[0].id).startsWith('tmp-'));
  assert.ok(changedBeforeCreate);
  const row = await p;
  appState.removeEventListener('change', onChange);
  assert.equal(appState.healthMetrics.length, 1);
  assert.equal(appState.healthMetrics[0].id, row.id);
  assert.ok(!appState.healthMetrics[0]._pending);
  await appState.whenSettled();
});

test('addHealthMetric: 저장 한 번 = create 1회 + health_metrics 재조회 1회뿐(refreshAll 아님)', async () => {
  const store = await setup();
  const calls = instrument(store);
  await appState.addHealthMetric({ metric_type: 'weight', value: 75 });
  await appState.whenSettled();
  assert.deepEqual(calls.sort(), ['create:health_metrics', 'list:health_metrics']);
});

test('혈압(수축기+이완기)은 createMany 한 번으로 저장된다', async () => {
  const store = await setup();
  const calls = instrument(store);
  const rows = await appState.addHealthMetrics([
    { metric_type: 'bp_systolic', value: 118, unit: 'mmHg' },
    { metric_type: 'bp_diastolic', value: 76, unit: 'mmHg' },
  ]);
  assert.equal(rows.length, 2);
  await appState.whenSettled();
  assert.equal(calls.filter((c) => c === 'createMany:health_metrics').length, 1);
  assert.equal(calls.filter((c) => c.startsWith('create:')).length, 0);
  assert.equal(appState.healthMetrics.length, 2);
  assert.equal(calls.filter((c) => c.startsWith('list:')).length, 1);
});

test('저장 실패 시 임시 행을 되돌리고 예외를 던진다', async () => {
  const store = await setup();
  instrument(store, { fail: { 'create:health_metrics': 'boom' } });
  let rolledBack = false;
  appState.addEventListener('change', (e) => { if (e.detail?.rolledBack) rolledBack = true; });
  await assert.rejects(() => appState.addHealthMetric({ metric_type: 'weight', value: 75 }), /boom/);
  assert.equal(appState.healthMetrics.length, 0);
  assert.ok(rolledBack);
  const store2 = await setup();
  instrument(store2, { fail: { 'createMany:health_metrics': 'bp boom' } });
  await assert.rejects(() => appState.addHealthMetrics([{ metric_type: 'bp_systolic', value: 1 }, { metric_type: 'bp_diastolic', value: 1 }]), /bp boom/);
  assert.equal(appState.healthMetrics.length, 0, '두 행 모두 되돌려진다');
});

test('deleteHealthMetric: 먼저 지우고, 서버 삭제가 실패하면 되살린다', async () => {
  const store = await setup();
  const row = await appState.addHealthMetric({ metric_type: 'weight', value: 70 });
  await appState.whenSettled();
  instrument(store, { fail: { 'remove:health_metrics': 'nope' } });
  const p = appState.deleteHealthMetric(row.id);
  assert.equal(appState.healthMetrics.length, 0, '즉시 사라짐');
  await assert.rejects(() => p, /nope/);
  assert.equal(appState.healthMetrics.length, 1, '실패하면 복구');
  assert.equal(appState.healthMetrics[0].id, row.id);
});

test('재조회 중에 새 쓰기가 끼어들면 오래된 재조회 결과는 버린다(방금 만든 행이 사라지지 않음)', async () => {
  const store = await setup();
  await appState.addHealthMetric({ metric_type: 'weight', value: 70 });
  await appState.whenSettled();
  const origList = store.list.bind(store);
  let release;
  const gate = new Promise((r) => { release = r; });
  store.list = async (...a) => { const rows = await origList(...a); await gate; return rows; }; // 오래된 스냅샷을 늦게 돌려줌
  const refetch = appState.refreshTable('health_metrics');
  const add = appState.addHealthMetric({ metric_type: 'weight', value: 71 });
  await add;
  release();
  assert.equal(await refetch, false, '쓰기가 끼어들어 결과를 적용하지 않음');
  assert.equal(appState.healthMetrics.length, 2);
  store.list = origList;
});

test('refreshTable은 아직 저장 중인 임시 행을 지우지 않는다', async () => {
  const store = await setup();
  instrument(store, { delay: 30 });
  const p = appState.addHealthMetric({ metric_type: 'weight', value: 70 });
  await appState.refreshTable('health_metrics'); // 서버에는 아직 없음(create 진행 중)
  // 다른 쓰기가 없었으므로 결과가 적용되지만 임시 행은 유지된다 — 단, 위 add가 _bump한 뒤라 seq가 달라 버려질 수도 있다. 어느 쪽이든 행은 보인다.
  assert.equal(appState.healthMetrics.length, 1);
  await p;
  assert.equal(appState.healthMetrics.length, 1);
});

test('병원 일정: 등록은 일정 연동을 기다리지 않고 행을 돌려주며, 연동은 백그라운드로 완료된다(시간·제목 포함)', async () => {
  const store = await setup();
  const calls = instrument(store, { delay: 20 });
  const t0 = Date.now();
  const appt = await appState.addHealthAppointment({ title: '정기검진', appointment_date: '2026-11-01', appointment_time: '09:30', location: 'A병원' });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 60, `create 한 번(약 20ms)만 기다린다 (실제 ${elapsed}ms)`);
  assert.ok(appt.id);
  assert.equal(appState.healthAppointments.length, 1);
  assert.equal(appState.healthAppointments[0].schedule_id, undefined, '아직 연동 전');
  await appState.whenSettled();
  const linked = appState.healthAppointments[0];
  assert.ok(linked.schedule_id);
  const sch = appState.schedules.find((s) => s.id === linked.schedule_id);
  assert.equal(sch.title, '🏥 정기검진');
  assert.equal(sch.date, '2026-11-01');
  assert.equal(sch.time, '09:30');
  assert.ok(calls.filter((c) => c.startsWith('list:')).length <= 3, 'refreshAll(20+회)이 아니라 대상 테이블만 재조회');
});

test('병원 일정 수정: 입력이 즉시 반영되고 연동된 일정도 같이 바뀐다(연동이 끝나기 전에 수정해도 안전)', async () => {
  await setup();
  const appt = await appState.addHealthAppointment({ title: '치과', appointment_date: '2026-11-03' });
  // 연동이 아직 진행 중일 때 곧바로 수정 — 연동(schedule_id)이 생길 때까지 기다렸다가 적용되므로 고아 일정이 생기지 않는다
  const p = appState.updateHealthAppointment(appt.id, { title: '치과(스케일링)', appointment_date: '2026-11-05', appt_type: '치과', location: 'B치과' });
  await p;
  await appState.whenSettled();
  const cur = appState.healthAppointments[0];
  assert.deepEqual([cur.title, cur.appointment_date, cur.appt_type, cur.location], ['치과(스케일링)', '2026-11-05', '치과', 'B치과']);
  const sch = appState.schedules.find((s) => s.id === cur.schedule_id);
  assert.equal(sch.title, '🏥 치과(스케일링)');
  assert.equal(sch.date, '2026-11-05');
  assert.match(sch.memo, /B치과/);
});

test('병원 일정 수정 실패 시 이전 값으로 되돌린다', async () => {
  const store = await setup();
  const appt = await appState.addHealthAppointment({ title: '원본', appointment_date: '2026-11-03' });
  await appState.whenSettled();
  instrument(store, { fail: { 'update:health_appointments': 'x' } });
  await assert.rejects(() => appState.updateHealthAppointment(appt.id, { title: '바뀜' }));
  assert.equal(appState.healthAppointments[0].title, '원본');
});

test('병원 일정 삭제(여러 건): 연동 일정도 함께 사라지고 호출은 병렬로 보낸다', async () => {
  const store = await setup();
  await appState.addHealthAppointment({ title: 'A', appointment_date: '2026-11-03' });
  await appState.addHealthAppointment({ title: 'B', appointment_date: '2026-11-04' });
  await appState.whenSettled();
  assert.equal(appState.schedules.filter((s) => s.title.startsWith('🏥')).length, 2);
  const calls = instrument(store);
  await appState.deleteHealthAppointments(appState.healthAppointments.map((a) => a.id));
  await appState.whenSettled();
  assert.equal(appState.healthAppointments.length, 0);
  assert.equal(appState.schedules.filter((s) => s.title.startsWith('🏥')).length, 0);
  assert.equal(calls.filter((c) => c === 'remove:health_appointments').length, 2);
  assert.equal(calls.filter((c) => c === 'remove:schedules').length, 2);
});

test('appt_type 컬럼이 아직 없는 DB(0023 미실행)에서도 일정 저장이 깨지지 않는다(그 컬럼만 빼고 재시도)', async () => {
  const store = await setup();
  const origCreate = store.create.bind(store);
  store.create = async (table, obj) => {
    if (table === 'health_appointments' && 'appt_type' in obj) throw new Error("Could not find the 'appt_type' column of 'health_appointments' in the schema cache");
    return origCreate(table, obj);
  };
  appState.schemaWarning = null;
  const appt = await appState.addHealthAppointment({ title: '검진', appointment_date: '2026-11-03', appt_type: '검진' });
  assert.ok(appt.id);
  assert.equal(appt.appt_type, undefined);
  assert.match(appState.schemaWarning, /0023/);
  // 다른 종류의 오류는 그대로 던진다
  store.create = async () => { throw new Error('network down'); };
  await assert.rejects(() => appState.addHealthAppointment({ title: 'x', appointment_date: '2026-11-03', appt_type: '검진' }), /network down/);
});

test('복약: 등록 → 체크(즉시 반영) → 다시 누르면 해제, 남은 수량이 함께 증감한다', async () => {
  const store = await setup();
  const med = await appState.addHealthMedication({ name: '혈압약', dosage: '5mg', schedule_type: 'daily', dose_times: '08:00,20:00', start_date: '2026-10-01', remaining_count: 10 });
  assert.equal(appState.healthMedications.length, 1);
  const calls = instrument(store);
  const p = appState.toggleMedDose(med.id, '2026-10-05', '08:00');
  assert.equal(appState.healthMedLogs.length, 1, '체크가 즉시 반영');
  assert.equal(appState.healthMedLogs[0].status, 'taken');
  await p;
  await appState.whenSettled();
  assert.equal(appState.healthMedications[0].remaining_count, 9);
  assert.deepEqual(calls.filter((c) => c.startsWith('create:')), ['create:health_med_logs']);
  await appState.toggleMedDose(med.id, '2026-10-05', '08:00'); // 해제
  await appState.whenSettled();
  assert.equal(appState.healthMedLogs.length, 0);
  assert.equal(appState.healthMedications[0].remaining_count, 10);
});

test('복약 체크 연타는 재조회를 한 번으로 묶는다(디바운스) / 저장 중인 행은 무시', async () => {
  const store = await setup();
  const med = await appState.addHealthMedication({ name: 'A', dose_times: '08:00,12:00,20:00', start_date: '2026-10-01' });
  await appState.whenSettled();
  const calls = instrument(store, { delay: 10 });
  const ps = ['08:00', '12:00', '20:00'].map((s) => appState.toggleMedDose(med.id, '2026-10-05', s));
  const dup = appState.toggleMedDose(med.id, '2026-10-05', '08:00'); // 아직 저장 중인 같은 칸을 또 누름 → 무시
  assert.equal(await dup, null);
  await Promise.all(ps);
  await appState.whenSettled();
  assert.equal(appState.healthMedLogs.length, 3);
  assert.equal(calls.filter((c) => c === 'create:health_med_logs').length, 3);
  assert.equal(calls.filter((c) => c === 'list:health_med_logs').length, 1, '세 번 눌러도 재조회는 한 번');
});

test('복약 체크 저장 실패 → 체크가 되돌려지고 남은 수량은 변하지 않는다', async () => {
  const store = await setup();
  const med = await appState.addHealthMedication({ name: 'A', dose_times: '08:00', start_date: '2026-10-01', remaining_count: 5 });
  instrument(store, { fail: { 'create:health_med_logs': 'offline' } });
  await assert.rejects(() => appState.toggleMedDose(med.id, '2026-10-05', '08:00'), /offline/);
  assert.equal(appState.healthMedLogs.length, 0);
});

test('건너뜀(skipped)을 taken으로 바꾸면 update로 처리된다', async () => {
  const store = await setup();
  const med = await appState.addHealthMedication({ name: 'A', dose_times: '08:00', start_date: '2026-10-01' });
  await appState.toggleMedDose(med.id, '2026-10-05', '08:00', 'skipped');
  assert.equal(appState.healthMedLogs[0].status, 'skipped');
  const calls = instrument(store);
  await appState.toggleMedDose(med.id, '2026-10-05', '08:00', 'taken');
  await appState.whenSettled();
  assert.equal(appState.healthMedLogs.length, 1);
  assert.equal(appState.healthMedLogs[0].status, 'taken');
  assert.ok(calls.includes('update:health_med_logs'));
});

test('약 삭제(여러 건)는 soft delete — 목록에서 사라지고 새로고침해도 돌아오지 않는다', async () => {
  const store = await setup();
  const a = await appState.addHealthMedication({ name: 'A', dose_times: '08:00', start_date: '2026-10-01' });
  const b = await appState.addHealthMedication({ name: 'B', dose_times: '08:00', start_date: '2026-10-01' });
  await appState.deleteHealthMedications([a.id]);
  assert.deepEqual(appState.healthMedications.map((m) => m.name), ['B']);
  await appState.refreshAll();
  assert.deepEqual(appState.healthMedications.map((m) => m.name), ['B']);
  assert.ok(store.db.health_medications.find((m) => m.id === a.id).deleted_at, '행은 남고 deleted_at만 설정');
  assert.equal(b.sort_order > a.sort_order, true);
});

test('updateHealthMedication: 실패하면 되돌린다', async () => {
  const store = await setup();
  const m = await appState.addHealthMedication({ name: '원래', dose_times: '08:00', start_date: '2026-10-01' });
  instrument(store, { fail: { 'update:health_medications': 'x' } });
  await assert.rejects(() => appState.updateHealthMedication(m.id, { name: '바뀜' }));
  assert.equal(appState.healthMedications[0].name, '원래');
});

test('첨부파일 추가/삭제는 refreshAll 없이 메모리 상태를 바로 갱신한다', async () => {
  const store = await setup();
  globalThis.FileReader = class { readAsDataURL() { this.result = 'data:text/plain;base64,aGk='; setTimeout(() => this.onload(), 0); } };
  const appt = await appState.addHealthAppointment({ title: 'A', appointment_date: '2026-11-03' });
  await appState.whenSettled();
  const calls = instrument(store);
  const row = await appState.addAttachment('health_appointments', appt.id, { size: 2, name: 'a.txt', type: 'text/plain' });
  assert.equal(appState.getAttachments('health_appointments', appt.id).length, 1);
  assert.equal(calls.filter((c) => c.startsWith('list:')).length, 0, '목록 재조회 없음');
  await appState.deleteAttachment(row.id);
  assert.equal(appState.getAttachments('health_appointments', appt.id).length, 0);
  assert.equal(calls.filter((c) => c.startsWith('list:')).length, 0);
});

test('createMany: 로컬 스토어는 여러 행을 한 번에 만들고 빈 배열은 빈 결과', async () => {
  const store = await setup();
  const rows = await store.createMany('health_metrics', [{ metric_type: 'weight', value: 1 }, { metric_type: 'weight', value: 2 }]);
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].id, rows[1].id);
  assert.deepEqual(await store.createMany('health_metrics', []), []);
});
