import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// state.js/localStore.js는 일반 <script>(전역 등록) 방식이라 Node에서는 파일을 읽어 그대로 평가한다.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadGlobalScript(relPath) {
  const code = fs.readFileSync(path.join(__dirname, relPath), 'utf8');
  (0, eval)(code);
}

class FakeLocalStorage {
  constructor() { this._data = new Map(); }
  getItem(k) { return this._data.has(k) ? this._data.get(k) : null; }
  setItem(k, v) { this._data.set(k, String(v)); }
  removeItem(k) { this._data.delete(k); }
}

globalThis.localStorage = new FakeLocalStorage();
globalThis.sessionStorage = new FakeLocalStorage();
globalThis.window = globalThis;
globalThis.window.addEventListener = () => {};
globalThis.CONFIG = { mode: 'local' };

let uidCounter = 0;
globalThis.uid = () => `id-${++uidCounter}`;

loadGlobalScript('../js/store/localStore.js');
globalThis.getStore = () => new globalThis.LocalStore();
loadGlobalScript('../js/services/settingsSync.js'); // state.js가 window.settingsSync에 의존(index.html 로드 순서와 동일)
loadGlobalScript('../js/state.js');
const { appState } = globalThis;

let testUserCounter = 0;
async function setupUser() {
  globalThis.localStorage = new FakeLocalStorage();
  globalThis.sessionStorage = new FakeLocalStorage();
  appState.store = new globalThis.LocalStore();
  const username = `tester${++testUserCounter}`;
  const result = await appState.store.signUp({ username, password: 'pw1234' });
  assert.equal(result.pending, false);
  const session = await appState.store.signIn(username, 'pw1234');
  appState.user = session.user;
  await appState.refreshAll();
}

test('deleteProgramsBulk는 선택된 여러 프로그램을 모두 삭제한다', async () => {
  await setupUser();
  await appState.addProgram({ name: 'A', url: 'https://a.com' });
  await appState.addProgram({ name: 'B', url: 'https://b.com' });
  await appState.addProgram({ name: 'C', url: 'https://c.com' });
  assert.equal(appState.programs.length, 3);

  const ids = appState.programs.filter((p) => p.name !== 'C').map((p) => p.id);
  await appState.deleteProgramsBulk(ids);

  assert.equal(appState.programs.length, 1);
  assert.equal(appState.programs[0].name, 'C');
});

test('deleteHealthAppointments는 연동된 일정도 함께 삭제하며 여러 건을 한 번에 지운다', async () => {
  await setupUser();
  await appState.addHealthAppointment({ title: '정기검진', appointment_date: '2026-10-05' });
  await appState.addHealthAppointment({ title: '치과', appointment_date: '2026-10-10' });
  assert.equal(appState.healthAppointments.length, 2);
  assert.equal(appState.schedules.filter((s) => s.title.includes('정기검진') || s.title.includes('치과')).length, 2);

  const ids = appState.healthAppointments.map((a) => a.id);
  await appState.deleteHealthAppointments(ids);

  assert.equal(appState.healthAppointments.length, 0);
  assert.equal(appState.schedules.filter((s) => s.title.includes('정기검진') || s.title.includes('치과')).length, 0);
});

test('deleteBookmarksBulk / deleteKnowledgeDocsBulk도 여러 건을 한 번에 지운다', async () => {
  await setupUser();
  await appState.addBookmark({ title: 'B1', url: 'https://b1.com' });
  await appState.addBookmark({ title: 'B2', url: 'https://b2.com' });
  await appState.addKnowledgeDoc({ title: 'K1', doc_type: 'memo', memo: 'x' });
  await appState.addKnowledgeDoc({ title: 'K2', doc_type: 'memo', memo: 'y' });

  await appState.deleteBookmarksBulk(appState.bookmarks.map((b) => b.id));
  assert.equal(appState.bookmarks.length, 0);

  await appState.deleteKnowledgeDocsBulk(appState.knowledgeDocs.map((d) => d.id));
  assert.equal(appState.knowledgeDocs.length, 0);
});

test('Career(이력/경력) 공통 CRUD: 추가 시 sort_order가 자동 부여되고, 수정/삭제/선택삭제가 동작한다', async () => {
  await setupUser();
  const e1 = await appState.addCareerRecord('education', { school_name: 'A고등학교', status: '졸업' });
  const e2 = await appState.addCareerRecord('education', { school_name: 'B대학교', status: '졸업' });
  assert.equal(appState.career.education.length, 2);
  assert.equal(e1.sort_order, 1);
  assert.equal(e2.sort_order, 2);

  await appState.updateCareerRecord('education', e1.id, { status: '휴학' });
  assert.equal(appState.career.education.find((r) => r.id === e1.id).status, '휴학');

  await appState.deleteCareerRecord('education', e1.id);
  assert.equal(appState.career.education.length, 1);
  assert.equal(appState.career.education[0].id, e2.id);

  await appState.addCareerRecord('certifications', { cert_name: '정보처리기사' });
  await appState.addCareerRecord('certifications', { cert_name: 'SQLD' });
  assert.equal(appState.career.certifications.length, 2);
  await appState.deleteCareerRecordsBulk('certifications', appState.career.certifications.map((r) => r.id));
  assert.equal(appState.career.certifications.length, 0);
});

test('reorderCareerRecords는 전달한 순서대로 sort_order를 다시 매긴다(드래그/↑↓ 순서변경의 기반)', async () => {
  await setupUser();
  const a = await appState.addCareerRecord('awards', { award_name: '우수사원상' });
  const b = await appState.addCareerRecord('awards', { award_name: '봉사상' });
  const c = await appState.addCareerRecord('awards', { award_name: '공로상' });
  assert.deepEqual(appState.career.awards.map((r) => r.award_name), ['우수사원상', '봉사상', '공로상']);

  // c를 맨 앞으로 옮기는 상황을 흉내낸다.
  await appState.reorderCareerRecords('awards', [c.id, a.id, b.id]);
  const reordered = appState.career.awards.slice().sort((x, y) => x.sort_order - y.sort_order);
  assert.deepEqual(reordered.map((r) => r.award_name), ['공로상', '우수사원상', '봉사상']);
});

test('_trackRecentlyViewed/getRecentlyViewed는 최근 항목을 중복없이 최신순으로 최대 8개 유지한다', () => {
  globalThis.localStorage.removeItem('workspace:recentlyViewed');
  appState._trackRecentlyViewed('program', 'p1', '프로그램1');
  appState._trackRecentlyViewed('bookmark', 'b1', '북마크1');
  appState._trackRecentlyViewed('program', 'p1', '프로그램1(다시)'); // 같은 항목 다시 보면 맨 앞으로, 중복 없이

  const list = appState.getRecentlyViewed();
  assert.equal(list.length, 2);
  assert.equal(list[0].id, 'p1');
  assert.equal(list[0].label, '프로그램1(다시)');
  assert.equal(list[1].id, 'b1');
});
