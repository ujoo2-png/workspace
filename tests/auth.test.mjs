import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// localStore.js는 일반 <script>(전역 등록) 방식이라 Node에서는 파일을 읽어 그대로 평가한다.
// localStorage/crypto는 Node 22의 전역(globalThis.crypto)과 아래 최소 폴리필로 대체한다.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadGlobalScript(relPath) {
  const code = fs.readFileSync(path.join(__dirname, relPath), 'utf8');
  (0, eval)(code);
}

// 아주 단순한 localStorage 폴리필 (Node 테스트 환경용)
class FakeLocalStorage {
  constructor() { this._data = new Map(); }
  getItem(k) { return this._data.has(k) ? this._data.get(k) : null; }
  setItem(k, v) { this._data.set(k, String(v)); }
  removeItem(k) { this._data.delete(k); }
}
globalThis.localStorage = new FakeLocalStorage();
  globalThis.sessionStorage = new FakeLocalStorage();
globalThis.window = globalThis; // localStore.js는 window.addEventListener를 호출한다
globalThis.window.addEventListener = () => {};

let uidCounter = 0;
globalThis.uid = () => `id-${++uidCounter}`;

loadGlobalScript('../js/store/localStore.js');
const { LocalStore } = globalThis;

test('첫 번째 가입자는 즉시 관리자(admin)로 승인된다', async () => {
  globalThis.localStorage = new FakeLocalStorage();
  globalThis.sessionStorage = new FakeLocalStorage();
  const store = new LocalStore();
  const result = await store.signUp({ username: 'alice', password: 'pw1234', name: '앨리스' });
  assert.equal(result.pending, false);

  const session = await store.signIn('alice', 'pw1234');
  assert.equal(session.user.role, 'admin');
  assert.equal(session.user.name, '앨리스');
});

test('두 번째 이후 가입자는 승인 대기 상태이며 승인 전에는 로그인할 수 없다', async () => {
  globalThis.localStorage = new FakeLocalStorage();
  globalThis.sessionStorage = new FakeLocalStorage();
  const store = new LocalStore();
  await store.signUp({ username: 'alice', password: 'pw1234' });
  const result = await store.signUp({ username: 'bob', password: 'pw5678' });
  assert.equal(result.pending, true);

  await assert.rejects(() => store.signIn('bob', 'pw5678'), /승인 대기/);

  const pending = await store.listPendingUsers();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].username, 'bob');
  // 비밀번호 해시/salt는 노출되지 않아야 한다
  assert.equal(pending[0].passwordHash, undefined);
  assert.equal(pending[0].salt, undefined);

  await store.approveUser(pending[0].id);
  const session = await store.signIn('bob', 'pw5678');
  assert.equal(session.user.role, 'user');
});

test('거절된 사용자는 로그인할 수 없다', async () => {
  globalThis.localStorage = new FakeLocalStorage();
  globalThis.sessionStorage = new FakeLocalStorage();
  const store = new LocalStore();
  await store.signUp({ username: 'alice', password: 'pw1234' });
  await store.signUp({ username: 'carol', password: 'pw0000' });
  const pending = await store.listPendingUsers();
  await store.rejectUser(pending[0].id);
  await assert.rejects(() => store.signIn('carol', 'pw0000'), /거절/);
});

test('틀린 비밀번호로는 로그인할 수 없다', async () => {
  globalThis.localStorage = new FakeLocalStorage();
  globalThis.sessionStorage = new FakeLocalStorage();
  const store = new LocalStore();
  await store.signUp({ username: 'alice', password: 'pw1234' });
  await assert.rejects(() => store.signIn('alice', 'wrong-pw'), /아이디 또는 비밀번호/);
});

test('본인이 현재 비밀번호를 알고 있으면 비밀번호를 변경할 수 있다', async () => {
  globalThis.localStorage = new FakeLocalStorage();
  globalThis.sessionStorage = new FakeLocalStorage();
  const store = new LocalStore();
  await store.signUp({ username: 'alice', password: 'pw1234' });
  const session = await store.signIn('alice', 'pw1234');
  await store.changePassword(session.user.id, 'pw1234', 'newpw99');
  await assert.rejects(() => store.signIn('alice', 'pw1234'), /올바르지 않습니다/);
  const session2 = await store.signIn('alice', 'newpw99');
  assert.equal(session2.user.username ?? session2.user.email, 'alice');
});

test('현재 비밀번호가 틀리면 비밀번호를 바꿀 수 없다', async () => {
  globalThis.localStorage = new FakeLocalStorage();
  globalThis.sessionStorage = new FakeLocalStorage();
  const store = new LocalStore();
  await store.signUp({ username: 'alice', password: 'pw1234' });
  const session = await store.signIn('alice', 'pw1234');
  await assert.rejects(() => store.changePassword(session.user.id, 'wrong', 'newpw99'), /현재 비밀번호/);
});

test('관리자는 다른 사용자의 비밀번호를 새로 지정할 수 있다(비밀번호 분실 대응)', async () => {
  globalThis.localStorage = new FakeLocalStorage();
  globalThis.sessionStorage = new FakeLocalStorage();
  const store = new LocalStore();
  await store.signUp({ username: 'alice', password: 'pw1234' });
  await store.signUp({ username: 'bob', password: 'pw5678' });
  const pending = await store.listPendingUsers();
  await store.approveUser(pending[0].id);
  await store.adminResetPassword(pending[0].id, 'resetpw1');
  await assert.rejects(() => store.signIn('bob', 'pw5678'), /올바르지 않습니다/);
  const session = await store.signIn('bob', 'resetpw1');
  assert.equal(session.user.role, 'user');
});

test('중복된 아이디로는 가입할 수 없다', async () => {
  globalThis.localStorage = new FakeLocalStorage();
  globalThis.sessionStorage = new FakeLocalStorage();
  const store = new LocalStore();
  await store.signUp({ username: 'alice', password: 'pw1234' });
  await assert.rejects(() => store.signUp({ username: 'alice', password: 'pw9999' }), /이미 사용 중/);
});

test('"로그인 상태 유지"를 체크하지 않으면 세션이 sessionStorage에만 저장된다', async () => {
  globalThis.localStorage = new FakeLocalStorage();
  globalThis.sessionStorage = new FakeLocalStorage();
  const store = new LocalStore();
  await store.signUp({ username: 'alice', password: 'pw1234' });
  await store.signIn('alice', 'pw1234', false);
  assert.equal(globalThis.localStorage.getItem('workspace:auth:v1'), null);
  assert.notEqual(globalThis.sessionStorage.getItem('workspace:auth:v1'), null);
  const session = await store.getSession();
  assert.equal(session.user.email, 'alice');
});

test('"로그인 상태 유지"를 체크하면 세션이 localStorage에 저장되어 재방문 후에도 유지된다', async () => {
  globalThis.localStorage = new FakeLocalStorage();
  globalThis.sessionStorage = new FakeLocalStorage();
  const store = new LocalStore();
  await store.signUp({ username: 'alice', password: 'pw1234' });
  await store.signIn('alice', 'pw1234', true);
  assert.notEqual(globalThis.localStorage.getItem('workspace:auth:v1'), null);
  // 새 브라우저 세션을 흉내내기 위해 sessionStorage만 비운다(탭/브라우저 재시작 시나리오).
  globalThis.sessionStorage = new FakeLocalStorage();
  const store2 = new LocalStore();
  const session = await store2.getSession();
  assert.equal(session.user.email, 'alice');
});
