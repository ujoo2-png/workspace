// Health 저장 한 번당 store 호출 수/체감 지연을 재는 도구. v7.18.0(기준선)과 현재 코드를 같은 방식으로 비교한다.
//   node tests/tools/measure-save-calls.mjs <js디렉터리> [지연ms=80]
// 예) node tests/tools/measure-save-calls.mjs ./js            (현재)
//     node tests/tools/measure-save-calls.mjs /path/to/v7.18.0/js   (이전 버전 소스를 풀어 둔 곳)
// 각 store 호출(list/create/createMany/update/remove/get)에 가짜 네트워크 지연을 넣고 호출 횟수를 센다.
// ⚠️ 지연 모델은 "호출마다 고정 지연, 병렬 호출은 제한 없이 동시에"라서 refreshAll의 실제 비용(요청 수십 개의
//    브라우저 연결 제한, 첨부파일 base64 본문 전송량)은 오히려 낮게 잡힌다. 호출 횟수가 더 믿을 만한 지표다.
import path from 'node:path';
import fs from 'node:fs';

const jsDir = path.resolve(process.argv[2] || './js');
const LAT = Number(process.argv[3] || 80);
class FakeLS { constructor() { this.d = new Map(); } getItem(k) { return this.d.has(k) ? this.d.get(k) : null; } setItem(k, v) { this.d.set(k, String(v)); } removeItem(k) { this.d.delete(k); } }
globalThis.localStorage = new FakeLS();
globalThis.sessionStorage = new FakeLS();
globalThis.window = globalThis;
globalThis.window.addEventListener = () => {};
globalThis.CONFIG = { mode: 'local' };
const load = (rel) => (0, eval)(fs.readFileSync(path.join(jsDir, rel), 'utf8'));
for (const f of ['utils/id.js', 'utils/date.js', 'store/localStore.js']) load(f);
globalThis.getStore = () => new globalThis.LocalStore();
for (const f of ['services/settingsSync.js', 'state.js']) load(f);

const store = new globalThis.LocalStore();
const calls = { list: 0, get: 0, create: 0, createMany: 0, update: 0, remove: 0, softDelete: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const m of Object.keys(calls)) {
  const orig = store[m] ? store[m].bind(store) : null;
  if (!orig) continue;
  store[m] = async (...a) => { calls[m]++; await sleep(LAT); return orig(...a); };
}
const { appState } = globalThis;
appState.store = store;
const username = 'measure';
await store.signUp({ username, password: 'pw1234' });
const session = await store.signIn(username, 'pw1234');
appState.user = session.user;
await appState.refreshAll();
const reset = () => { for (const k of Object.keys(calls)) calls[k] = 0; };
const total = () => Object.values(calls).reduce((a, b) => a + b, 0);

async function scenario(name, fn) {
  reset();
  const t0 = performance.now();
  let tUi = null;
  const onChange = () => { if (tUi === null) tUi = performance.now() - t0; };
  appState.addEventListener('change', onChange);
  const ret = await fn();
  const tReturn = performance.now() - t0;
  if (appState.whenSettled) await appState.whenSettled();
  const tSettled = performance.now() - t0;
  appState.removeEventListener('change', onChange);
  return { scenario: name, storeCalls: total(), breakdown: { ...calls }, firstChangeMs: tUi === null ? null : Math.round(tUi), awaitReturnMs: Math.round(tReturn), allSettledMs: Math.round(tSettled), _ret: ret ? true : false };
}

const out = [];
const rec = new Date().toISOString();
out.push(await scenario('체중 1건 저장', () => appState.addHealthMetric({ metric_type: 'weight', value: 75.2, unit: 'kg', recorded_at: rec })));
out.push(await scenario('혈압(수축기+이완기 2행) 저장', () => appState.addHealthMetrics([
  { metric_type: 'bp_systolic', value: 118, unit: 'mmHg', recorded_at: rec },
  { metric_type: 'bp_diastolic', value: 76, unit: 'mmHg', recorded_at: rec },
])));
out.push(await scenario('병원 일정 등록(일정 메뉴 연동 포함)', () => appState.addHealthAppointment({ title: '정기검진', appointment_date: '2026-11-01', location: 'A병원' })));
const appt = appState.healthAppointments[0];
out.push(await scenario('병원 일정 수정(연동 일정 동기화)', () => appState.updateHealthAppointment(appt.id, { title: '정기검진(수정)', appointment_date: '2026-11-02' })));
out.push(await scenario('병원 일정 삭제(연동 일정 포함)', () => appState.deleteHealthAppointments([appt.id])));
console.log(JSON.stringify({ jsDir, latencyMs: LAT, results: out.map(({ _ret, ...r }) => r) }, null, 1));
