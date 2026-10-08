import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// settingsSync.js는 일반 <script>(전역 등록) 방식이라 파일을 읽어 그대로 평가한다.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
class FakeLocalStorage {
  constructor() { this._data = new Map(); }
  getItem(k) { return this._data.has(k) ? this._data.get(k) : null; }
  setItem(k, v) { this._data.set(k, String(v)); }
  removeItem(k) { this._data.delete(k); }
}
globalThis.localStorage = new FakeLocalStorage();
globalThis.window = globalThis;
globalThis.window.addEventListener = () => {};
globalThis.CONFIG = { mode: 'local' };
(0, eval)(fs.readFileSync(path.join(__dirname, '../js/services/settingsSync.js'), 'utf8'));
const { decideLoad, mergeSettings, shouldDiscardLocal, shouldReload, createBatcher, SYNCED_KEYS } = globalThis.SettingsSyncLogic;

const K = { cities: 'workspace:weatherCities', theme: 'workspace:theme', tmdb: 'workspace:tmdbApiKey' };

test('동기화 키 목록: 요청된 14개 + v7.19.0 Health 2개(목표값·복약 알림) + v7.24.0 화면 구성 2개(navStyle·homeStyle)를 모두 포함하고 캐시/상태/세션 키는 없다', () => {
  assert.equal(SYNCED_KEYS.length, 24);
  assert.ok(SYNCED_KEYS.includes('workspace:health:targets') && SYNCED_KEYS.includes('workspace:health:medReminder'));
  for (const k of ['workspace:weatherCities', 'workspace:customApis', 'workspace:publicData:dataGoKrKey', 'workspace:publicData:kopisKey',
    'workspace:publicData:opinetKey', 'workspace:publicData:enabled', 'workspace:tmdbApiKey', 'workspace:homeWidgetOrder',
    'workspace:clockTimezones', 'workspace:sidebarCollapsed', 'workspace:theme', 'workspace:schedule:hideDone',
    'workspace:health:weeklyGoal', 'workspace:recentlyViewed']) assert.ok(SYNCED_KEYS.includes(k), k);
  for (const k of SYNCED_KEYS) {
    assert.ok(!/cache|status|auth:|lastActive|settingsSync/i.test(k), k);
  }
});

test('decideLoad: 원격 행이 없으면(null) 로컬 값을 전부 올려 시드한다', () => {
  const r = decideLoad({ remote: null, local: { [K.cities]: '[1]', [K.theme]: 'dark' } });
  assert.equal(r.mode, 'seed');
  assert.deepEqual(r.push, { [K.cities]: '[1]', [K.theme]: 'dark' });
  assert.deepEqual(r.applyLocal, {});
});

test('decideLoad: 원격 행이 비어 있어도({}) 시드한다. 로컬도 비어 있으면 아무 일 없음', () => {
  assert.equal(decideLoad({ remote: {}, local: { [K.theme]: 'light' } }).mode, 'seed');
  const none = decideLoad({ remote: {}, local: {} });
  assert.deepEqual(none.push, {});
  assert.deepEqual(none.applyLocal, {});
});

test('decideLoad: 원격에 값이 있으면 원격이 이긴다(로컬을 덮어쓰고 올리지 않는다)', () => {
  const r = decideLoad({ remote: { [K.theme]: 'dark', [K.cities]: '[2]' }, local: { [K.theme]: 'light', [K.cities]: '[2]' } });
  assert.equal(r.mode, 'pull');
  assert.deepEqual(r.applyLocal, { [K.theme]: 'dark' }); // 같은 값은 적용 대상이 아님
  assert.deepEqual(r.push, {});
});

test('decideLoad: 원격에 없는 키만 로컬에 있으면 그 키는 채워 올린다(원격 값은 유지)', () => {
  const r = decideLoad({ remote: { [K.theme]: 'dark' }, local: { [K.theme]: 'light', [K.tmdb]: 'abc' } });
  assert.deepEqual(r.applyLocal, { [K.theme]: 'dark' });
  assert.deepEqual(r.push, { [K.tmdb]: 'abc' });
});

test('decideLoad: 로컬에 없는 값은 원격 값으로 채운다. 빈 문자열("")도 유효한 값이다', () => {
  const r = decideLoad({ remote: { [K.tmdb]: '', [K.cities]: '[3]' }, local: { [K.tmdb]: 'old' } });
  assert.deepEqual(r.applyLocal, { [K.tmdb]: '', [K.cities]: '[3]' });
});

test('decideLoad: 업로드 대기 중(pending)인 키는 원격으로 덮어쓰지 않는다', () => {
  const r = decideLoad({ remote: { [K.theme]: 'dark' }, local: { [K.theme]: 'light' }, pending: [K.theme] });
  assert.deepEqual(r.applyLocal, {});
  assert.deepEqual(r.push, {});
});

test('decideLoad: 문자열이 아닌 원격 값(손상)과 목록 밖 키는 무시한다', () => {
  const r = decideLoad({ remote: { [K.theme]: 5, 'workspace:other': 'x' }, local: { [K.theme]: 'light' } });
  assert.equal(r.mode, 'seed');
  assert.deepEqual(r.push, { [K.theme]: 'light' });
  assert.deepEqual(decideLoad({ remote: [1, 2], local: {} }).applyLocal, {});
});

test('mergeSettings: 키 단위 병합, null은 삭제, 원본은 변경하지 않는다', () => {
  const remote = { a: '1', b: '2' };
  const out = mergeSettings(remote, { b: '3', c: '4' });
  assert.deepEqual(out, { a: '1', b: '3', c: '4' });
  assert.deepEqual(remote, { a: '1', b: '2' });
  assert.deepEqual(mergeSettings(remote, { a: null }), { b: '2' });
  assert.deepEqual(mergeSettings(null, { a: '1' }), { a: '1' });
});

test('shouldDiscardLocal: 다른 계정 캐시만 버린다(owner 없음=도입 이전 브라우저는 유지)', () => {
  assert.equal(shouldDiscardLocal(null, 'u1'), false);
  assert.equal(shouldDiscardLocal('u1', 'u1'), false);
  assert.equal(shouldDiscardLocal('u1', 'u2'), true);
});

test('shouldReload: 최초/강제는 항상, 이후엔 최소 간격 이후에만', () => {
  assert.equal(shouldReload({ now: 100, last: 0 }), true);
  assert.equal(shouldReload({ now: 1000, last: 500, minMs: 15000 }), false);
  assert.equal(shouldReload({ now: 1000, last: 500, minMs: 15000, force: true }), true);
  assert.equal(shouldReload({ now: 20000, last: 500, minMs: 15000 }), true);
});

function fakeTimers() {
  let id = 0; const timers = new Map();
  return {
    setTimer: (fn, ms) => { timers.set(++id, { fn, ms }); return id; },
    clearTimer: (i) => timers.delete(i),
    fire: () => { const all = [...timers.values()]; timers.clear(); all.forEach((t) => t.fn()); },
    count: () => timers.size,
  };
}

test('createBatcher: 연속 set은 디바운스되어 한 번만 flush하고 같은 키는 마지막 값만 올린다', async () => {
  const t = fakeTimers(); const calls = [];
  const b = createBatcher({ delay: 800, flush: async (p) => { calls.push(p); }, setTimer: t.setTimer, clearTimer: t.clearTimer });
  b.add('a', '1'); b.add('b', '1'); b.add('a', '2');
  assert.equal(t.count(), 1); // 타이머는 재설정되어 하나만 남는다
  assert.equal(calls.length, 0);
  t.fire(); await b.flushNow();
  assert.deepEqual(calls, [{ a: '2', b: '1' }]);
  assert.equal(b.hasPending(), false);
});

test('createBatcher: flush 실패 시 변경분을 되돌려 놓고(더 최신 값은 유지) onError를 부른다', async () => {
  const t = fakeTimers(); let fail = true; const errs = []; const calls = [];
  const b = createBatcher({
    flush: async (p) => { if (fail) { b.add('a', 'newer'); throw new Error('net'); } calls.push(p); },
    onError: (e) => errs.push(e.message), setTimer: t.setTimer, clearTimer: t.clearTimer,
  });
  b.add('a', 'old'); b.add('b', 'x');
  assert.equal(await b.flushNow(), false);
  assert.deepEqual(errs, ['net']);
  assert.deepEqual(b.pendingKeys().sort(), ['a', 'b']);
  fail = false;
  assert.equal(await b.flushNow(), true);
  assert.deepEqual(calls, [{ a: 'newer', b: 'x' }]);
});

test('createBatcher: onFlushed는 성공한 키만(그 사이 다시 바뀐 키 제외) 알려준다', async () => {
  const t = fakeTimers(); const flushed = [];
  const b = createBatcher({ flush: async () => { b.add('a', 'again'); }, onFlushed: (k) => flushed.push(k), setTimer: t.setTimer, clearTimer: t.clearTimer });
  b.add('a', '1'); b.add('b', '1');
  await b.flushNow();
  assert.deepEqual(flushed, [['b']]);
});

test('로컬 모드: settingsSync.get/set은 localStorage만 쓰고 네트워크/스토어를 건드리지 않는다', async () => {
  globalThis.getStore = () => { throw new Error('로컬 모드에서 스토어를 호출하면 안 됨'); };
  const s = globalThis.settingsSync;
  s.set(K.theme, 'dark');
  assert.equal(s.get(K.theme), 'dark');
  assert.equal(localStorage.getItem(K.theme), 'dark');
  assert.deepEqual(await s.load('u1'), { changed: [], mode: 'local' });
  s.set('workspace:publicData:status', 'connected'); // 비동기화 키도 그대로 로컬 저장
  assert.equal(s.get('workspace:publicData:status'), 'connected');
});

test('Supabase 모드(가짜 스토어): 시드 → 다른 기기 pull, 테이블 없음 폴백 + 경고 1회', async () => {
  globalThis.CONFIG = { mode: 'supabase' };
  const warns = []; const origWarn = console.warn; console.warn = (...a) => warns.push(a.join(' '));
  let row = null; let failLoad = false; const saves = [];
  globalThis.getStore = () => ({
    loadUserSettings: async () => { if (failLoad) throw new Error('relation "user_settings" does not exist'); return row ? { ...row } : null; },
    saveUserSettings: async (uid, settings) => { saves.push(settings); row = { ...settings }; },
  });
  try {
    const s = globalThis.settingsSync;
    // 기기 1: 로컬에 값 있음, 원격 없음 → 시드
    localStorage.setItem(K.cities, '["서울"]');
    localStorage.setItem(K.theme, 'dark');
    const r1 = await s.load('u1', { force: true });
    assert.equal(r1.mode, 'seed');
    await s.flush();
    assert.equal(row[K.cities], '["서울"]');
    assert.equal(row[K.theme], 'dark');
    // 기기 2: 로컬 비어 있음 → 원격 값 pull + onChange 알림
    for (const k of s.SYNCED_KEYS) localStorage.removeItem(k);
    localStorage.removeItem('workspace:settingsSync:owner');
    s._state.lastLoadAt = 0;
    let notified = null; s.onChange((k) => { notified = k; });
    const r2 = await s.load('u1', { force: true });
    assert.equal(r2.mode, 'pull');
    assert.equal(s.get(K.theme), 'dark');
    assert.equal(s.get(K.cities), '["서울"]');
    assert.deepEqual(notified.sort(), [K.cities, K.theme].sort());
    // 이후 set은 디바운스 후 원격에 병합 저장(다른 키는 유지)
    s.set(K.tmdb, 'KEY');
    await s.flush();
    assert.equal(row[K.tmdb], 'KEY');
    assert.equal(row[K.theme], 'dark');
    // 다른 계정이 같은 브라우저에서 로그인하면 이전 로컬 캐시(API 키 포함)는 올리지 않는다
    row = null; s._state.lastLoadAt = 0;
    const r3 = await s.load('u2', { force: true });
    assert.equal(r3.mode, 'seed');
    assert.deepEqual(r3.changed, []);
    await s.flush();
    assert.equal(row, null, '다른 계정의 설정이 새 계정 행으로 올라가면 안 됨');
    // 테이블이 없으면 던지지 않고 로컬 전용으로 폴백, 경고는 1회만
    s._state.remoteOk = null; s._state.userId = null; s._state.lastLoadAt = 0; failLoad = true;
    const r4 = await s.load('u1', { force: true });
    assert.equal(r4.mode, 'error');
    s.set(K.theme, 'light');
    assert.equal(s.get(K.theme), 'light');
    await s.load('u1', { force: true });
    assert.equal(warns.filter((w) => w.includes('[settingsSync]')).length, 1);
  } finally {
    console.warn = origWarn;
    globalThis.CONFIG = { mode: 'local' };
  }
});
