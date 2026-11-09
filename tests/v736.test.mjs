import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const d = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(d, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const load = (p) => (0, eval)(read(p));
class FakeLS { constructor() { this._d = new Map(); } getItem(k) { return this._d.has(k) ? this._d.get(k) : null; } setItem(k, v) { this._d.set(k, String(v)); } removeItem(k) { this._d.delete(k); } }
globalThis.localStorage = new FakeLS(); globalThis.sessionStorage = new FakeLS();
globalThis.window = globalThis; globalThis.window.addEventListener = () => {};
const mem = new Map();
globalThis.settingsSync = { get: (k) => mem.get(k) || '', set: (k, v) => mem.set(k, v) };
for (const f of ['js/utils/xmlTree.js', 'js/services/feedService.js', 'js/services/feedDiag.js', 'js/services/connectionMonitor.js', 'js/components/snapshot.js']) load(f);
const FD = globalThis.FeedDiag;
const { createRequire: cr } = await import('node:module');
const req = cr(import.meta.url);

test('custom-proxy: 사설/내부 IP 차단', () => {
  const { isPrivateIp } = req('../api/custom-proxy.js');
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.16.0.1', '169.254.169.254', '::1', 'fd00::1', '0.0.0.0']) assert.equal(isPrivateIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '211.1.2.3']) assert.equal(isPrivateIp(ip), false, ip);
});

test('discoverFeedLinks: link rel=alternate 우선, 관례 경로는 후보로', () => {
  const html = '<head><link rel="alternate" type="application/rss+xml" href="/rss/all.xml"><link rel="stylesheet" href="a.css"></head>';
  const r = globalThis.discoverFeedLinks(html, 'https://news.example.com/board/1');
  assert.deepEqual(r.found, ['https://news.example.com/rss/all.xml']);
  assert.ok(r.guesses.includes('https://news.example.com/feed'));
});

test('adaptApiItems: K-Startup JSON / 공공데이터 XML에서 제목·링크·마감 추출', () => {
  const json = { data: [{ pbanc_sn: 1234, biz_pbanc_nm: '2026 예비창업패키지', pbanc_rcpt_bgng_dt: '20261101', pbanc_rcpt_end_dt: '20261120', pbanc_ctnt: '<p>스마트팜 창업</p>' }, { biz_pbanc_nm: '링크없음' }] };
  const r = FD.adaptApiItems(json);
  assert.equal(r.items.length, 1);
  assert.match(r.items[0].link, /pbancSn=1234/);
  assert.equal(r.items[0].publishedAt, '2026-11-01T00:00:00+09:00');
  assert.match(r.items[0].summary, /^마감 2026-11-20 · 스마트팜 창업/);
  const xml = '<response><body><items><item><pblancNm>기업마당 지원</pblancNm><pblancUrl>https://bizinfo.go.kr/x</pblancUrl><reqstBeginEndDe>20261001 ~ 20261015</reqstBeginEndDe></item></items></body></response>';
  const x = FD.adaptApiItems(xml);
  assert.equal(x.items.length, 1); assert.equal(x.items[0].title, '기업마당 지원');
  assert.match(x.items[0].summary, /마감 2026-10-15/);
  assert.equal(FD.adaptApiItems({ a: 1 }).items.length, 0);
});

test('deadlineInDays: 마감임박 계산', () => {
  assert.equal(FD.deadlineInDays('마감 2026-11-12 · x', new Date(2026, 10, 9)), 3);
  assert.equal(FD.deadlineInDays('설명만', new Date()), null);
});

test('FeedDiag: 이력 기록·상태 판정(오류/불안정/0건/정상/꺼짐)', () => {
  const s = { id: 's1', enabled: true, type: 'rss', endpoint: 'http://a.com/rss' };
  assert.equal(FD.summary(s, []).state, 'unrun');
  const now = Date.parse('2026-11-09T00:00:00Z');
  const at = (d) => new Date(now - d * 86400000).toISOString();
  assert.equal(FD.summary(s, [{ at: at(0), result: 'error', error: 'x' }], now).state, 'error');
  assert.equal(FD.summary(s, [{ at: at(1), result: 'success', n: 3 }, { at: at(0), result: 'error' }], now).state, 'unstable');
  assert.equal(FD.summary(s, [{ at: at(0), result: 'empty', n: 0 }], now).state, 'empty');
  const ok = FD.summary(s, [{ at: at(0), result: 'success', n: 3, ms: 1000, newest: at(1) }, { at: at(2), result: 'success', n: 3, ms: 3000 }], now);
  assert.equal(ok.state, 'ok'); assert.deepEqual(ok.rate, { ok: 2, total: 2 }); assert.equal(ok.avgMs, 2000);
  assert.equal(FD.summary(s, [{ at: at(0), result: 'success', n: 3, newest: at(60) }], now).state, 'stale');
  assert.equal(FD.summary({ ...s, enabled: false }, [], now).state, 'off');
  FD.record('s1', { result: 'success', n: 1 }); FD.record('s1', { result: 'error', error: 'e' });
  assert.equal(FD.history('s1').length, 2);
  for (let i = 0; i < 30; i++) FD.record('s1', { result: 'success' });
  assert.equal(FD.history('s1').length, 20);
  FD.prune([]); assert.equal(FD.history('s1').length, 0);
});

test('FeedDiag.diagnose: 원인별 조치 버튼', () => {
  const rss = { type: 'rss', endpoint: 'http://rss.etnews.com/03.xml' };
  assert.ok(FD.diagnose(rss, { result: 'error', error: '이 주소는 RSS가 아니라 웹페이지입니다' }).fixes.some((f) => f.id === 'discover'));
  assert.ok(FD.diagnose(rss, { result: 'error', error: '프록시 응답 오류(HTTP 403)' }).fixes.some((f) => f.id === 'md'));
  assert.ok(FD.diagnose(rss, { result: 'error', error: '알 수 없음' }).fixes.some((f) => f.id === 'https'));
  const api = { type: 'api', endpoint: 'x' };
  const g = FD.diagnose(api, { result: 'error', error: 'HTTP 400 kisedKstartupService01' });
  assert.ok(g.fixes.some((f) => f.id === 'kstartup') && g.fixes.some((f) => f.id === 'edit'));
  assert.ok(FD.diagnose({ type: 'markdown', endpoint: 'x' }, { result: 'error', error: '링크를 찾지 못했습니다' }).fixes.some((f) => f.id === 'edit'));
  assert.ok(FD.KSTARTUP_URL.includes('{key}'));
});

test('ConnectionMonitor.classifyProxy / summarize', () => {
  const C = globalThis.ConnectionMonitor;
  assert.equal(C.classifyProxy(404, 50).state, 'error');
  assert.equal(C.classifyProxy(502, 50).state, 'error');
  assert.equal(C.classifyProxy(400, 80).state, 'ok');
  assert.equal(C.classifyProxy(405, 5000).state, 'warn');
  assert.equal(C.classifyProxy(0, 1).state, 'error');
  assert.equal(C.summarize([{ state: 'ok' }, { state: 'warn' }]).worst, 'warn');
  assert.equal(C.summarize([{ state: 'ok' }, { state: 'off' }]).worst, 'ok');
});

test('스냅샷 자르기: cropRect 보정 / fitSize', () => {
  assert.deepEqual(globalThis.cropRect({ x: 50, y: 60 }, { x: 10, y: 20 }, 100, 100), { x: 10, y: 20, w: 40, h: 40 });
  assert.deepEqual(globalThis.cropRect({ x: -5, y: -5 }, { x: 500, y: 500 }, 100, 80), { x: 0, y: 0, w: 100, h: 80 });
  assert.deepEqual(globalThis.fitSize(1200, 1800, 600, 900), { w: 600, h: 900 });
  assert.deepEqual(globalThis.fitSize(300, 400, 600, 900), { w: 300, h: 400 });
});

test('배포 점검: index.html 스크립트 목록이 실제 파일과 일치하고 새 파일이 포함됨', () => {
  const html = read('index.html');
  const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]).filter((s) => !/^https?:/.test(s));
  for (const s of srcs) assert.ok(fs.existsSync(path.join(root, s)), `없는 파일: ${s}`);
  for (const f of ['js/services/feedDiag.js', 'js/services/connectionMonitor.js', 'js/components/snapshot.js', 'js/utils/briefingSearch.js']) assert.ok(srcs.includes(f), f);
  assert.ok(html.indexOf('feedDiag.js') > html.indexOf('feedService.js'));
  assert.match(html, /deploy-check-banner/);
});

test('careerDocs: 칸막이·자동 반영 코드가 들어 있다', () => {
  const c = read('js/modules/careerDocs.js');
  assert.match(c, /cd-split/); assert.match(c, /silentSync/);
  assert.match(read('css/modules/career.css'), /--cd-right-w/);
});
