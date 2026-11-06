import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const d = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
const RC = require('../js/utils/routineCalc.js');
const A = require('../js/services/assetSnapshotService.js');
const W = require('../js/services/weeklyBriefing.js');
const dart = require('../api/dart-proxy.js');
const read = (p) => fs.readFileSync(path.join(d, '..', p), 'utf8');

// ── routineCalc ─────────────────────────────────────
const daily = { id: 'a', title: '운동', cadence: 'daily', start_date: '2026-11-01', active: true };
test('routine daily: 어제 누락 → overdue, 연속일수 계산', () => {
  const done = new Set(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
  const e = RC.evaluate(daily, done, '2026-11-06');
  assert.equal(e.state, 'overdue'); assert.deepEqual(e.missedDates, ['2026-11-05']); assert.equal(e.dueToday, true); assert.equal(e.streak, 0);
});
test('routine daily: 오늘만 안 했으면 due(미진 아님)', () => {
  const done = new Set(['2026-11-05', '2026-11-04', '2026-11-03', '2026-11-02', '2026-11-01']);
  const e = RC.evaluate(daily, done, '2026-11-06');
  assert.equal(e.state, 'due'); assert.equal(e.overdueCount, 0); assert.equal(e.streak, 5);
});
test('routine weekly: 주 3회 목표, 금요일 0회면 오늘 필수·토요일이면 미진', () => {
  const r = { id: 'w', cadence: 'weekly', times_per_week: 3, start_date: '2026-10-01', active: true };
  assert.equal(RC.evaluate(r, new Set(), '2026-11-06').state, 'due');     // 금: 남은 3일에 3회 → 오늘 꼭 해야 함
  assert.equal(RC.evaluate(r, new Set(), '2026-11-07').state, 'overdue'); // 토: 남은 2일에 3회 → 이미 못 채움
});
test('routine interval: N일마다, 기한 지나면 늦음', () => {
  const r = { id: 'i', cadence: 'interval', interval_days: 7, start_date: '2026-10-01', active: true };
  const e = RC.evaluate(r, new Set(['2026-10-25']), '2026-11-06');
  assert.equal(e.state, 'overdue'); assert.equal(e.nextDue, '2026-11-01');
});
test('routine: 시작 전/일시정지는 미진으로 세지 않는다', () => {
  assert.equal(RC.evaluate({ ...daily, start_date: '2026-12-01' }, new Set(), '2026-11-06').state, 'upcoming');
  assert.equal(RC.evaluate({ ...daily, active: false }, new Set(), '2026-11-06').state, 'paused');
});
test('routine auto_source: 건강 기록이 있으면 자동 완료로 본다', () => {
  const r = { ...daily, auto_source: 'health' };
  const done = RC.doneSet(r, [], { healthMetrics: [{ recorded_at: '2026-11-05', metric_type: 'weight' }] });
  assert.ok(done.has('2026-11-05'));
});

// ── 자산 스냅샷 ─────────────────────────────────────
test('assetSnapshot.liveCloseDate: 장중=null, 마감 후=오늘, 주말=금요일', () => {
  assert.equal(A.liveCloseDate(new Date('2026-11-06T01:00:00Z')), null);       // 금 10:00 KST
  assert.equal(A.liveCloseDate(new Date('2026-11-06T07:00:00Z')), '2026-11-06'); // 금 16:00
  assert.equal(A.liveCloseDate(new Date('2026-11-08T03:00:00Z')), '2026-11-06'); // 일
});
test('assetSnapshot.recentWeekdays: 평일만, 장 마감 전이면 오늘 제외', () => {
  assert.deepEqual(A.recentWeekdays(new Date('2026-11-09T01:00:00Z'), 3), ['2026-11-04', '2026-11-05', '2026-11-06']);
  assert.deepEqual(A.recentWeekdays(new Date('2026-11-09T08:00:00Z'), 3), ['2026-11-05', '2026-11-06', '2026-11-09']);
});
test('assetSnapshot.buildSnapshot: 해외는 환율 곱, 시세 없는 종목 제외', () => {
  const hs = [{ symbol: '005930', market: 'KRX', quantity: 10, avg_price: 70000, currency: 'KRW' }, { symbol: 'AAPL', market: 'US', quantity: 2, avg_price: 100, currency: 'USD' }, { symbol: '000660', market: 'KRX', quantity: 1, avg_price: 1 }];
  const s = A.buildSnapshot(hs, { 'KRX:005930': 80000, 'US:AAPL': 200 }, 1400, '2026-11-06');
  assert.equal(s.total_value, 800000 + 2 * 200 * 1400); assert.equal(s.evaluated_count, 2); assert.equal(s.holdings_count, 3);
});
test('assetSnapshot.backfill: 직전 종가 사용, 이미 있는 날은 건너뜀', () => {
  const hs = [{ symbol: '005930', market: 'KRX', quantity: 10, avg_price: 1 }];
  const charts = { 'KRX:005930': [{ date: '2026-11-03', v: 100 }, { date: '2026-11-05', v: 110 }] };
  const out = A.backfillSnapshots(hs, charts, null, ['2026-11-04', '2026-11-05', '2026-11-06'], new Set(['2026-11-05']));
  assert.deepEqual(out.map((x) => [x.snap_date, x.total_value, x.source]), [['2026-11-04', 1000, 'backfill'], ['2026-11-06', 1100, 'backfill']]);
});
test('assetSnapshot.dayChange', () => {
  const c = A.dayChange([{ snap_date: 'a', total_value: 100 }, { snap_date: 'b', total_value: 110 }]);
  assert.equal(c.diff, 10); assert.equal(Math.round(c.rate), 10); assert.equal(A.dayChange([{}]), null);
});

// ── 주간 브리핑 ─────────────────────────────────────
test('weekly.targetWeek: 금요일 9시 전에는 지난주, 이후엔 이번 주', () => {
  assert.equal(W.targetWeek(new Date('2026-11-05T23:30:00Z')).friday, '2026-10-30'); // 금 08:30 KST
  assert.equal(W.targetWeek(new Date('2026-11-06T00:00:00Z')).friday, '2026-11-06'); // 금 09:00 KST
  assert.equal(W.targetWeek(new Date('2026-11-10T03:00:00Z')).friday, '2026-11-06'); // 화
});
test('weekly.shouldGenerate: 이미 있으면 due=false', () => {
  assert.equal(W.shouldGenerate(['2026-11-02'], new Date('2026-11-07T03:00:00Z')).due, false);
  assert.equal(W.shouldGenerate([], new Date('2026-11-07T03:00:00Z')).due, true);
});
test('weekly.build: 루틴·일정·자산 요약', () => {
  const t = W.targetWeek(new Date('2026-11-06T01:00:00Z'));
  const st = { schedules: [{ date: '2026-11-03', done: true }, { date: '2026-11-04', done: false }, { date: '2026-11-12', title: '다음주' }], routines: [daily], routineLogs: [{ routine_id: 'a', log_date: '2026-11-03' }],
    assetSnapshots: [{ snap_date: '2026-10-30', total_value: 1000 }, { snap_date: '2026-11-06', total_value: 1100 }], projects: [{ name: 'P', status: 'in_progress', deadline: '2026-11-10' }] };
  const c = W.build(st, t);
  assert.equal(c.schedules.total, 2); assert.equal(c.schedules.done, 1);
  assert.equal(c.routines.due, 5); assert.equal(c.routines.done, 1);
  assert.equal(c.asset.diff, 100); assert.equal(c.next.schedules.length, 1); assert.equal(c.next.deadlines.length, 1);
  assert.ok(c.notes.some((n) => n.includes('루틴')));
});

// ── DART 프록시 ─────────────────────────────────────
test('dart-proxy: corpCode XML 파싱(상장 종목만)', () => {
  const m = dart._test.parseCorpXml('<result><list><corp_code>00126380</corp_code><corp_name>삼성전자</corp_name><stock_code>005930</stock_code></list><list><corp_code>1</corp_code><corp_name>비상장</corp_name><stock_code> </stock_code></list></result>');
  assert.equal(m.size, 1); assert.equal(m.get('005930').corp_code, '00126380');
});
test('dart-proxy: 키 없으면 401, POST는 405', async () => {
  const mk = () => { const r = { code: 0, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, end() { return r; } }; return r; };
  let r = mk(); await dart({ method: 'GET', headers: {}, query: { op: 'ping' } }, r); assert.equal(r.code, 401);
  r = mk(); await dart({ method: 'POST', headers: {}, query: {} }, r); assert.equal(r.code, 405);
});

// ── 설정 영속(공급자가 로그인 후 되돌아가던 버그) ──────────────
test('stockService/marketService: 설정을 settingsSync로 저장한다(직접 localStorage만 쓰지 않음)', () => {
  for (const f of ['js/services/stockService.js', 'js/services/marketService.js']) {
    const src = read(f);
    assert.match(src, /settingsSync/, f);
  }
  assert.match(read('js/services/settingsSync.js'), /workspace:stocks:dartKey/);
});
test('팝업 간소화: 모든 등록 팝업이 처음부터 첨부 영역을 쓴다', () => {
  for (const m of ['challenges', 'health', 'career', 'devlog', 'playlist', 'knowledge', 'projects', 'programs', 'vehicles', 'schedule']) {
    assert.match(read(`js/modules/${m}.js`), /createPendingAttachments/, m);
  }
});
test('index.html에 v7.33 스크립트가 모두 있다', () => {
  const h = read('index.html');
  for (const s of ['routineCalc', 'routines', 'assetSnapshotService', 'dartService', 'weeklyBriefing']) assert.ok(h.includes(s + '.js'), s);
});

// ── v7.33.1 DART 확장 ───────────────────────────────
test('dart-proxy: 내부자·리스크·우량도·섹션 순수 함수', () => {
  const t = dart._test;
  const ins = t.summarizeInsider(Array.from({ length: 6 }, (_, i) => ({ rcept_dt: new Date().toISOString().slice(0, 10).replace(/-/g, ''), sp_stock_lmp_irds_cnt: String(100 + i) })).concat([{ rcept_dt: new Date().toISOString().slice(0, 10).replace(/-/g, ''), sp_stock_lmp_irds_cnt: '-3' }]), 365);
  assert.equal(ins.verdict, 'strong_buy_cluster'); assert.equal(ins.sell, 1);
  const a = t.scoreAnomaly(Array.from({ length: 20 }, (_, i) => ({ report_nm: i < 8 ? '[기재정정]사업보고서' : '주요사항보고서(유상증자결정)' })));
  assert.ok(a.score >= 40 && ['warning', 'red_flag'].includes(a.verdict));
  assert.equal(t.scoreAnomaly([{ report_nm: '[기재정정]x' }]).score, 0); // 표본이 작으면 정정비율 가점 없음
  const mk = (yr, ni, eq, debt, rev, op) => ({ status: '000', list: [['IS', '매출액', rev], ['IS', '영업이익', op], ['IS', '당기순이익', ni], ['BS', '자산총계', eq + debt], ['BS', '부채총계', debt], ['BS', '자본총계', eq]].map(([sj, nm, v]) => ({ sj_div: sj, account_nm: nm, fs_div: 'CFS', thstrm_amount: String(v), frmtrm_amount: String(v * 0.9), bfefrmtrm_amount: String(v * 0.8) })) });
  const q = t.qualityOf([[2025, mk(2025, 20, 100, 50, 1000, 150)], [2022, mk(2022, 10, 80, 40, 600, 60)]]);
  assert.equal(q.metrics.n, 5); assert.ok(q.metrics.avgRoe > 0 && q.metrics.debtRatio === 50);
  const ranked = t.rankQuality([{ stock_code: 'A', corp_name: 'A', ...q }, { stock_code: 'B', corp_name: 'B', metrics: { ...q.metrics, avgRoe: 1, debtRatio: 300, opm: 1, cagr: -3, profitYears: 2, n: 5 } }]);
  assert.equal(ranked[0].stock_code, 'A'); assert.equal(ranked[0].passed, 5);
  const sec = t.extractSections('<TITLE>위험관리</TITLE><P>' + '환율'.repeat(40) + '</P>', '위험'); assert.equal(sec.sections[0].title, '위험관리');
});
test('dart-proxy: 프리셋 정규식이 공시 제목을 구분', () => {
  const P = dart._test.PRESETS;
  assert.ok(P.buyback.re.test('주요사항보고서(자기주식취득결정)')); assert.ok(!P.buyback.re.test('자기주식처분결정'));
  assert.ok(P.cb.re.test('전환사채권발행결정')); assert.ok(P.rights.re.test('유상증자결정'));
});
test('playlist: 인기영화 로딩 중 재진입 방지(무한 재귀 수정)', () => {
  assert.match(read('js/modules/playlist.js'), /if \(!trending\.loading\) loadTrending\(\)/);
});
test('dartService: corp_code 캐시 힌트를 요청에 붙인다', () => {
  const store = {}; globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  globalThis.settingsSync = { get: (k) => store[k] ?? '', set: (k, v) => { store[k] = v; } };
  delete require.cache[require.resolve('../js/services/dartService.js')]; const D = require('../js/services/dartService.js');
  D.setKey('a'.repeat(40)); store['workspace:dartCorps'] = JSON.stringify({ '005930': { c: '00126380', n: '삼성전자' } });
  let url = ''; globalThis.fetch = async (u) => { url = u; return { ok: true, json: async () => ({ results: [{ stock_code: '000660', corp_code: '00164779', corp_name: 'SK하이닉스', items: [] }] }) }; };
  return D.fetchDisclosures([{ symbol: '005930', market: 'KRX' }, { symbol: '000660', market: 'KRX' }]).then(() => {
    assert.match(url, /corps=005930%3A00126380/); assert.ok(JSON.parse(store['workspace:dartCorps'])['000660']);
  });
});
