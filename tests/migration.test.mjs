import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// 이전 버전(로그인 기능 추가 전) 사용자의 브라우저에 남아있던 localStorage 데이터를 흉내내
// (users 배열이 아예 없는 상태) 새 로그인 코드가 깨지지 않는지 검증한다.
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
globalThis.window = globalThis;
globalThis.window.addEventListener = () => {};
let uidCounter = 0;
globalThis.uid = () => `id-${++uidCounter}`;

loadGlobalScript('../js/store/localStore.js');
const { LocalStore } = globalThis;

test('users 배열이 없는 옛 데이터를 불러와도 회원가입/로그인이 정상 동작한다', async () => {
  const oldSchemaDb = {
    // 로그인 기능(users 배열) 추가 이전 버전의 실제 저장 형태를 흉내낸다.
    profiles: [{ id: 'old-1', email: 'old@example.com', created_at: '2026-08-01T00:00:00.000Z' }],
    schedules: [{ id: 's1', title: '기존 일정' }],
    projects: [],
  };
  globalThis.localStorage = new FakeLocalStorage();
  globalThis.localStorage.setItem('workspace:v1', JSON.stringify(oldSchemaDb));

  const store = new LocalStore();
  // 기존 데이터(profiles/schedules)는 그대로 보존되어야 한다.
  assert.equal(store.db.profiles.length, 1);
  assert.equal(store.db.schedules.length, 1);
  // users는 없었지만 빈 배열로 채워져 있어야 한다.
  assert.deepEqual(store.db.users, []);

  // 이제 회원가입/로그인이 "Cannot read properties of undefined (reading 'find')" 없이 동작해야 한다.
  const result = await store.signUp({ username: 'newadmin', password: 'pw1234' });
  assert.equal(result.pending, false);
  const session = await store.signIn('newadmin', 'pw1234');
  assert.equal(session.user.role, 'admin');

  // 기존 데이터는 여전히 남아있어야 한다(로그인 시 새 사용자의 profiles 행이 하나 추가되므로 2개).
  const saved = JSON.parse(globalThis.localStorage.getItem('workspace:v1'));
  assert.equal(saved.schedules.length, 1);
  assert.equal(saved.profiles.length, 2);
  assert.ok(saved.profiles.some((p) => p.email === 'old@example.com'));
});
