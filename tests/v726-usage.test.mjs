import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// v7.26.0 사용량: URL 분류, 이그레스 기록/집계, 메뉴별 분해, 단위 파싱/표시, 한도 단계.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
globalThis.window = globalThis;
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.CONFIG = { mode: 'local' };
(0, eval)(fs.readFileSync(path.join(__dirname, '../js/services/usageService.js'), 'utf8'));
const U = globalThis.UsageService;
const MB = 1024 * 1024;

test('classifyUrl: rest/rpc/storage/auth/functions', () => {
  assert.deepEqual(U.classifyUrl('https://x.supabase.co/rest/v1/schedules?select=*&user_id=eq.1'), { kind: 'rest', name: 'schedules' });
  assert.deepEqual(U.classifyUrl('https://x.supabase.co/rest/v1/rpc/app_usage_stats'), { kind: 'rpc', name: 'rpc:app_usage_stats' });
  assert.equal(U.classifyUrl('https://x.supabase.co/auth/v1/token?grant_type=refresh_token').kind, 'auth');
  assert.equal(U.classifyUrl('https://x.supabase.co/storage/v1/object/b/f.png').kind, 'storage');
  assert.deepEqual(U.classifyUrl('https://x.supabase.co/functions/v1/kma'), { kind: 'functions', name: 'fn:kma' });
});
test('메뉴 매핑: 테이블/라우트/첨부 owner', () => {
  assert.equal(U.menuForTable('project_stages'), '📁 프로젝트(WBS)');
  assert.equal(U.menuForTable('nope'), '기타');
  assert.equal(U.menuForRoute('#/schedule?x=1'), '🗓️ 일정');
  assert.equal(U.menuForOwner('vehicles'), '🚗 차량관리');
});
test('record/summarize: 월·최근N일 합계와 테이블/메뉴/요청 수', () => {
  const d = (s) => new Date(`${s}T12:00:00`);
  U.record({ url: 'https://x/rest/v1/schedules', bytes: 1000, menu: '🏠 홈', now: d('2026-10-14') });
  U.record({ url: 'https://x/rest/v1/schedules', bytes: 500, menu: '🗓️ 일정', now: d('2026-10-15') });
  U.record({ url: 'https://x/rest/v1/projects', bytes: 2 * MB, menu: '🏠 홈', now: d('2026-10-15') });
  U.record({ url: 'https://x/functions/v1/kma', bytes: 10, menu: '🏠 홈', now: d('2026-10-15') });
  U.record({ url: 'https://x/rest/v1/schedules', bytes: 70, menu: '🏠 홈', now: d('2026-09-30') });
  const m = U.summarize({ ym: '2026-10' });
  assert.equal(m.bytes, 1000 + 500 + 2 * MB + 10);
  assert.equal(m.requests, 4);
  assert.equal(m.byTable.schedules, 1500);
  assert.equal(m.byKind.functions, 1);
  const w = U.summarize({ days: 2, now: d('2026-10-15') });
  assert.equal(w.byDay.length, 2);
  assert.equal(U.summarize({ ym: '2026-09' }).bytes, 70);
  const bm = U.egressByTableMenu(m.byTable);
  assert.equal(bm['🗓️ 일정'], 1500); assert.equal(bm['📁 프로젝트'], 2 * MB); assert.equal(bm['⚡ Edge Function'], 10);
});
test('dbByMenu: 첨부 base64는 붙은 메뉴로, attachments 테이블은 나머지만', () => {
  const r = U.dbByMenu({ tables: [{ name: 'attachments', bytes: 1000 }, { name: 'schedules', bytes: 200 }, { name: 'projects', bytes: 100 }], attachments_by_owner: [{ owner_table: 'projects', bytes: 700 }, { owner_table: 'vehicles', bytes: 100 }] });
  assert.equal(r['📁 프로젝트 · 첨부파일'], 700); assert.equal(r['🚗 차량관리 · 첨부파일'], 100);
  assert.equal(r['기타'], 200 /* attachments 나머지 */);
  assert.equal(r['🗓️ 일정'], 200);
});
test('parseBytes/fmtValue/level', () => {
  assert.equal(U.parseBytes('1.5GB'), 1.5 * 1024 * MB);
  assert.equal(U.parseBytes('300 mb'), 300 * MB);
  assert.equal(U.parseBytes('12'), 12 * MB);
  assert.equal(U.parseBytes('12', 'GB'), 12 * 1024 * MB);
  assert.equal(U.parseBytes('abc'), null);
  assert.equal(U.fmtValue(500 * MB, 'bytes'), '500 MB');
  assert.equal(U.fmtValue(1.25 * 1024 * MB, 'bytes'), '1.25 GB');
  assert.equal(U.fmtValue(50000, 'count'), '50,000');
  assert.deepEqual([U.level(null), U.level(50), U.level(70), U.level(95)], ['none', 'ok', 'warn', 'danger']);
});
test('METRICS: 무료 한도 기본값', () => {
  const g = (id) => U.METRICS.find((m) => m.id === id);
  assert.equal(g('db').limit, 500 * MB); assert.equal(g('storage').limit, 1024 * MB); assert.equal(g('egress').limit, 5 * 1024 * MB);
  assert.equal(g('logIngestion').limit, null);
});

test('fetch 래퍼: Supabase 응답만 세고(Content-Length 우선, 없으면 본문), 다른 호스트는 무시', async () => {
  U.reset();
  globalThis.CONFIG = { mode: 'supabase', supabaseUrl: 'https://abc.supabase.co' };
  globalThis.location = { hash: '#/projects' };
  const mk = (len, body) => ({ headers: { get: (h) => (h === 'content-length' ? len : null) }, clone: () => ({ arrayBuffer: async () => new TextEncoder().encode(body).buffer }) });
  globalThis.fetch = async (url) => (String(url).includes('chunked') ? mk(null, 'hello world') : mk('1234', ''));
  globalThis.__usageFetchInstalled = false;
  U.install();
  await globalThis.fetch('https://abc.supabase.co/rest/v1/projects?select=*');
  await globalThis.fetch('https://abc.supabase.co/rest/v1/schedules?chunked=1');
  await globalThis.fetch('https://api.open-meteo.com/v1/forecast');
  await new Promise((r) => setTimeout(r, 20));
  const m = U.summarize({ ym: U.dayKey().slice(0, 7) });
  assert.equal(m.byTable.projects, 1234); assert.equal(m.byTable.schedules, 11); assert.equal(m.requests, 2);
  assert.equal(m.byMenu['📁 프로젝트'], 1245);
});
