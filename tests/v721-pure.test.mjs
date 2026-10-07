import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// v7.21.0 순수 로직: 프로그램 URL/아이콘, 첨부 용량, 날씨 테마, 차트 로직(버킷/집계/필터/tidy CSV), 홈 모션 계산.
// TZ=Asia/Seoul / UTC / America/Los_Angeles 모두에서 같은 결과여야 한다.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function load(rel) { (0, eval)(fs.readFileSync(path.join(__dirname, rel), 'utf8')); }
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
for (const f of ['utils/programLogic', 'utils/emoji', 'utils/attachLogic', 'services/weatherTheme', 'utils/chartLogic', 'components/homeFx', 'utils/briefingMd']) load(`../js/${f}.js`);
const g = globalThis;

// ---------------- 프로그램 URL ----------------
test('normalizeProgramUrl: 스킴 없는 주소에 https://를 붙이고 위험한 스킴은 거부한다', () => {
  assert.equal(g.normalizeProgramUrl('example.com/w').url, 'https://example.com/w');
  assert.equal(g.normalizeProgramUrl('  https://a.dev/x ').url, 'https://a.dev/x');
  assert.equal(g.normalizeProgramUrl('localhost:3000').ok, true);
  for (const bad of ['', 'ftp://a.com', 'javascript:alert(1)', 'intent://x', 'abc']) assert.equal(g.normalizeProgramUrl(bad).ok, false, bad);
});
test('validateProgramInput: 위젯 유형도 URL만 맞으면 통과, 필드별 오류 반환', () => {
  assert.equal(g.validateProgramInput({ name: 'w', url: 'w.vercel.app', program_type: 'widget' }).ok, true);
  const r = g.validateProgramInput({ name: ' ', url: '', program_type: 'x' });
  assert.deepEqual(Object.keys(r.errors).sort(), ['name', 'program_type', 'url']);
});
test('deployedBadge: 오늘/N일/개월/오래됨', () => {
  const T = '2026-10-07';
  assert.equal(g.deployedBadge({ vercel: { date: T } }, T).text, '오늘 배포');
  assert.equal(g.deployedBadge({ github: { date: '2026-10-04' } }, T).text, '3일 전 배포');
  assert.equal(g.deployedBadge({ vercel: { date: '2026-04-01' } }, T).stale, true);
  assert.equal(g.deployedBadge({}, T), null);
});

// ---------------- 이모지 ----------------
test('normalizeEmoji: ZWJ/변형선택자/국기를 한 글자로 세고 일반 문자는 버린다', () => {
  assert.equal(g.normalizeEmoji('🖥️'), '🖥️');
  assert.equal(g.normalizeEmoji('🖥️📱'), '🖥️📱');
  assert.equal(g.normalizeEmoji('👨‍👩‍👧x🚀'), '👨‍👩‍👧🚀');
  assert.equal(g.normalizeEmoji('🇰🇷🚀🌐', 2), '🇰🇷🚀');
  assert.equal(g.normalizeEmoji('abc'), '');
});
test('programIcon: 저장 아이콘 → 유형별 기본값', () => {
  assert.equal(g.programIcon({ icon: '🚀', program_type: 'web' }), '🚀');
  assert.equal(g.programIcon({ icon: '', program_type: 'widget' }), '🧩');
  assert.equal(g.programIcon({ icon: 'zz', program_type: 'mobile' }), '📱');
  assert.equal(g.programIcon({}), '🌐');
  for (const grp of g.EMOJI_GROUPS) assert.equal(grp.items.length, 16);
});

// ---------------- 첨부 ----------------
test('attachmentLimit: Knowledge 10MB, 그 외 4MB, 경계값', () => {
  const MB = 1024 * 1024;
  assert.equal(g.attachmentLimit('knowledge_docs'), 10 * MB);
  assert.equal(g.attachmentLimit('career_items'), 4 * MB);
  assert.equal(g.checkAttachmentSize('knowledge_docs', 10 * MB).ok, true);
  const bad = g.checkAttachmentSize('knowledge_docs', 11 * MB, 'a.pdf');
  assert.equal(bad.ok, false);
  assert.match(bad.message, /11\.0MB/); assert.match(bad.message, /10MB/);
  assert.equal(g.checkAttachmentSize('playlist_items', 5 * MB).ok, false);
  assert.equal(g.attachmentLimitLabel('knowledge_docs'), '최대 10MB');
  assert.equal(g.formatBytes(1536), '1.5KB');
});
test('dataUrlToBlob: base64 복원', async () => {
  const b = g.dataUrlToBlob('data:text/plain;base64,aGVsbG8=');
  assert.equal(b.type, 'text/plain'); assert.equal(await b.text(), 'hello');
});

// ---------------- 날씨 테마 ----------------
const WT = () => g.WEATHER_THEME;
test('weatherTheme: 인천 오전 비 예보 → 비 + 강수확률 캡션', () => {
  const day = { date: '2026-10-07', hourly: Array.from({ length: 24 }, (_, h) => ({ h, code: h >= 6 && h <= 11 ? 63 : 3, pop: h >= 6 && h <= 11 ? 80 : 10, precip: h >= 6 && h <= 11 ? 2 : 0 })) };
  const t = g.weatherTheme(day, 8);
  assert.equal(t.condition, 'rain'); assert.equal(t.part, 'morning');
  assert.match(t.caption, /오전 비 · 강수확률 80%/);
  assert.ok(t.particles && t.particles.type === 'rain');
});
test('weatherTheme: 흐림 + 높은 강수확률은 비로 승격, 낮은 확률은 흐림 유지', () => {
  assert.equal(g.weatherTheme({ code: 3, pop: 75 }, 14).condition, 'rain');
  assert.equal(g.weatherTheme({ code: 3, pop: 20 }, 14).condition, 'cloudy');
  assert.equal(g.weatherTheme(null, 9), null);
});
test('weatherTheme: 시간대 경계와 밤', () => {
  const D = { code: 0 };
  assert.equal(g.weatherTheme(D, 4).part, 'night'); assert.equal(g.weatherTheme(D, 5).part, 'morning');
  assert.equal(g.weatherTheme(D, 12).part, 'afternoon'); assert.equal(g.weatherTheme(D, 17).part, 'evening');
  assert.equal(g.weatherTheme(D, 19).part, 'night'); assert.equal(g.weatherTheme(D, 19).isNight, true);
});
test('weatherTheme: 모든 조건×시간대 팔레트에서 텍스트 대비 4.5:1 이상', () => {
  for (const cond of Object.keys(WT().PALETTES)) for (const part of ['morning', 'afternoon', 'evening', 'night']) {
    const stops = WT().PALETTES[cond][part];
    const hexes = (Array.isArray(stops) ? stops : String(stops).match(/#[0-9a-fA-F]{6}/g));
    const text = WT().pickTextColor(stops);
    assert.ok(text.ratio >= 4.5, `${cond}/${part} ${text.ratio}`);
    assert.ok(hexes && hexes.length >= 2);
  }
});
test('makeParticles: 상한 40, 같은 시드는 같은 배치', () => {
  assert.equal(WT().makeParticles('rain', 500, 3).length, 40);
  assert.deepEqual(WT().makeParticles('snow', 10, 7), WT().makeParticles('snow', 10, 7));
  assert.equal(WT().makeParticles('rain', 0).length, 0);
});
test('cityLocalHour/Date: UTC 오프셋 기준', () => {
  const ms = Date.UTC(2026, 9, 7, 20, 0); // 20:00Z
  assert.equal(WT().cityLocalHour(ms, 32400), 5);
  assert.equal(WT().cityLocalDate(ms, 32400), '2026-10-08');
  assert.equal(WT().cityLocalDate(ms, -25200), '2026-10-07');
});
test('conditionFromKma/Wmo', () => {
  assert.equal(WT().conditionFromKma(1, 1), 'rain'); assert.equal(WT().conditionFromKma(3, 1), 'snow');
  assert.equal(WT().conditionFromKma(0, 4), 'cloudy'); assert.equal(WT().conditionFromWmo(95), 'thunder');
  assert.equal(WT().conditionFromWmo(45), 'fog');
});

// ---------------- 차트 로직 ----------------
const CL = () => g.ChartLogic;
test('버킷: 월/주/일 키, 주는 월요일 시작, 범위', () => {
  assert.equal(CL().bucketKey('2026-10-07', 'month'), '2026-10');
  assert.equal(CL().bucketKey('2026-10-07', 'week'), '2026-10-05'); // 수요일 → 월요일
  assert.equal(CL().bucketKey('2026-10-04', 'week'), '2026-09-28'); // 일요일
  assert.deepEqual(CL().bucketRange('2028-02', 'month'), { from: '2028-02-01', to: '2028-02-29' });
  assert.deepEqual(CL().bucketRange('2026-10-05', 'week'), { from: '2026-10-05', to: '2026-10-11' });
  assert.equal(CL().finerLevel('month'), 'week'); assert.equal(CL().finerLevel('day'), null);
  assert.equal(CL().autoLevel('2026-01-01', '2026-12-31'), 'month');
  assert.equal(CL().autoLevel('2026-09-01', '2026-10-07'), 'day');
});
test('aggregate: avg/sum/max, 범위 필터, null 건너뛰기, 정렬', () => {
  const rows = [{ date: '2026-10-02', v: 4 }, { date: '2026-10-01', v: 2 }, { date: '2026-11-01', v: 10 }, { date: '2026-10-03', v: null }];
  const m = CL().aggregate(rows, { level: 'month', agg: 'avg' });
  assert.deepEqual(m.map((b) => [b.key, b.value]), [['2026-10', 3], ['2026-11', 10]]);
  assert.equal(CL().aggregate(rows, { level: 'month', agg: 'sum' })[0].value, 6);
  assert.equal(CL().aggregate(rows, { level: 'day', range: { from: '2026-10-02', to: '2026-10-31' } }).length, 2);
  assert.equal(CL().reduce([], 'avg'), null);
});
test('alignSeries: 공통 x축, 없는 값은 null', () => {
  const r = CL().alignSeries([{ rows: [{ date: '2026-10-01', v: 1 }] }, { rows: [{ date: '2026-10-02', v: 2 }] }], { level: 'day', agg: 'sum' });
  assert.deepEqual(r.keys, ['2026-10-01', '2026-10-02']);
  assert.deepEqual(r.values, [[1, null], [null, 2]]);
});
test('quickRange: 7일은 오늘 포함 7일', () => {
  assert.deepEqual(CL().quickRange('7d', '2026-10-07'), { from: '2026-10-01', to: '2026-10-07' });
  assert.equal(CL().quickRange('all', '2026-10-07'), null);
});
test('createFilterContext: pub/sub, 카테고리 토글, 해제, reset', () => {
  const ctx = CL().createFilterContext(); const seen = [];
  const off = ctx.subscribe((s) => seen.push(s));
  ctx.setRange({ from: 'a', to: 'b' }, '7d'); ctx.toggleCategory('X'); ctx.toggleCategory('Y'); ctx.toggleCategory('X');
  assert.deepEqual(ctx.snapshot().categories, ['Y']); assert.equal(seen.length, 4);
  off(); ctx.reset(); assert.equal(seen.length, 4); assert.equal(ctx.snapshot().range, null);
});
test('applyCategoryFilter: 겹치면 그 시리즈만, 아니면 전부', () => {
  assert.deepEqual(CL().applyCategoryFilter(['a', 'b'], ['a']), ['a']);
  assert.deepEqual(CL().applyCategoryFilter(['a', 'b'], ['z']), ['a', 'b']);
  assert.deepEqual(CL().applyCategoryFilter(['a', 'b'], []), ['a', 'b']);
});
test('toCsv: 쉼표/따옴표/줄바꿈 이스케이프', () => {
  assert.equal(CL().toCsv(['a', 'b'], [['x,y', 'he said "hi"'], ['l1\nl2', 3]]), 'a,b\r\n"x,y","he said ""hi"""\r\n"l1\nl2",3');
});
const fakeState = () => ({
  healthMetrics: [{ metric_type: 'weight', value: 70.5, recorded_at: '2026-10-01T12:00:00' }, { metric_type: 'bp_systolic', value: 120, recorded_at: '2026-10-01T12:00:00' }],
  schedules: [{ date: '2026-10-02', category: '업무', done: true }, { date: '2026-10-03', category: '개인', done: false }],
  projects: [{ status: 'in_progress' }, { status: 'completed' }, { status: 'completed' }],
  notifications: [{ severity: 'info' }],
});
test('tidyCsvByDomain: 도메인별 long-format, 헤더 고정, 빈 도메인은 파일 없음', () => {
  const files = CL().tidyCsvByDomain(fakeState());
  assert.deepEqual(CL().TIDY_HEADERS, ['date', 'domain', 'metric', 'series', 'value', 'unit']);
  assert.ok(files.health && files.schedule && files.projects);
  assert.ok(!files.vehicles);
  const lines = files.health.split('\r\n');
  assert.equal(lines[0], 'date,domain,metric,series,value,unit');
  assert.ok(lines.includes('2026-10-01,Health,체중,체중,70.5,kg'));
  assert.ok(files.projects.includes('완료,2') || files.projects.includes(',완료,'));
});
test('sanitizeTiles: 알 수 없는 지표 제거, 잘못된 차트 종류는 기본 종류로, 최대 12개', () => {
  const out = CL().sanitizeTiles([{ id: 'a', metric: 'health.weight', type: 'donut' }, { metric: 'nope' }, { metric: 'project.status', type: 'donut' }]);
  assert.equal(out.length, 2); assert.equal(out[0].type, 'line'); assert.equal(out[1].type, 'donut');
  assert.deepEqual(CL().sanitizeTiles('깨진 json'), []);
  assert.equal(CL().sanitizeTiles(Array(30).fill({ metric: 'health.weight' })).length, 12);
  assert.ok(CL().sanitizeTiles(CL().DEFAULT_TILES).length === CL().DEFAULT_TILES.length);
});
test('localDate: 날짜 문자열은 그대로, 시각은 로컬 날짜', () => {
  assert.equal(CL().localDate('2026-10-07'), '2026-10-07');
  assert.equal(CL().localDate('2026-10-07T12:00:00'), '2026-10-07');
});

// ---------------- 홈 모션 계산 ----------------
test('countsByDay/sparkPoints/easeOutCubic', () => {
  assert.deepEqual(g.HomeFx.countsByDay([{ d: '2026-10-01T09:00:00Z' }, { d: '2026-10-01' }, { d: '2026-10-03' }], 'd', ['2026-10-01', '2026-10-02', '2026-10-03']), [2, 0, 1]);
  const flat = g.HomeFx.sparkPoints([5, 5, 5], 100, 26);
  assert.ok(flat.every((p) => p.y === 13));
  const up = g.HomeFx.sparkPoints([0, 10], 100, 26, 3);
  assert.equal(up[0].y, 23); assert.equal(up[1].y, 3);
  assert.equal(g.HomeFx.easeOutCubic(0), 0); assert.equal(g.HomeFx.easeOutCubic(1), 1); assert.equal(g.HomeFx.easeOutCubic(5), 1);
});

// ---------------- 중복 URL ----------------
test('urlKey/findDuplicateUrl: www·스킴·끝 슬래시·해시·추적 파라미터를 무시', () => {
  assert.equal(g.urlKey('https://www.Example.com/a/?utm_source=x#top'), 'example.com/a');
  assert.equal(g.urlKey('example.com/a'), 'example.com/a');
  assert.notEqual(g.urlKey('https://example.com/a?id=1'), g.urlKey('https://example.com/a?id=2'));
  assert.equal(g.urlKey('not a url'), null);
  const docs = [{ id: 1, url: 'http://example.com/a/', title: 'A' }, { id: 2, url: null }, { id: 3, url: 'https://x.dev', deleted_at: '2026-01-01' }];
  assert.equal(g.findDuplicateUrl('https://www.example.com/a?utm_medium=z', docs).title, 'A');
  assert.equal(g.findDuplicateUrl('https://example.com/a', docs, 1), null);
  assert.equal(g.findDuplicateUrl('https://x.dev', docs), null);
});

// ---------------- 브리핑 마크다운 ----------------
test('briefingToMarkdown: 관심주제별 묶음, 링크/요약/태그, 읽은 항목 제외 옵션, 대괄호 이스케이프', () => {
  const topics = [{ id: 't1', name: 'AI 에이전트' }];
  const sources = [{ id: 's1', name: 'GeekNews' }];
  const items = [
    { title: 'A [beta] 출시', link: 'https://a.dev/1', summary: '  한 줄\n요약  ', topic_id: 't1', source_id: 's1', published_at: '2026-10-06T01:00:00Z', is_read: false },
    { title: '읽은 글', link: 'https://a.dev/2', topic_id: null, is_read: true },
    { title: '링크 없음', link: '', topic_id: 't1' },
  ];
  const all = g.briefingToMarkdown(items, { topics, sources, date: '2026-10-07' });
  assert.match(all, /^---\ndate: 2026-10-07\nitems: 2\n/);
  assert.match(all, /## AI 에이전트 \(1\)/);
  assert.match(all, /- \[A \\\[beta\\\] 출시\]\(https:\/\/a\.dev\/1\) — GeekNews · 2026-10-06\n  - 한 줄 요약\n  - #AI_에이전트/);
  assert.match(all, /## 기타 \(1\)/);
  const unread = g.briefingToMarkdown(items, { topics, sources, onlyUnread: true });
  assert.ok(!unread.includes('읽은 글'));
  assert.match(g.briefingToMarkdown([], {}), /내보낼 항목이 없습니다/);
});

test('kpiDelta: 같은 길이의 직전 기간과 비교, 없으면 null(0으로 위장하지 않음)', () => {
  const rows = [{ date: '2026-10-05', v: 10 }, { date: '2026-10-06', v: 20 }, { date: '2026-10-01', v: 5 }, { date: '2026-09-30', v: 5 }];
  const k = g.ChartLogic.kpiDelta(rows, { range: { from: '2026-10-04', to: '2026-10-07' }, agg: 'sum', today: '2026-10-07' });
  assert.equal(k.cur, 30); assert.equal(k.prev, 10); assert.equal(k.delta, 20); assert.equal(k.pct, 200);
  assert.deepEqual([k.prevFrom, k.prevTo], ['2026-09-30', '2026-10-03']);
  const none = g.ChartLogic.kpiDelta([{ date: '2026-10-06', v: 3 }], { range: null, agg: 'avg', today: '2026-10-07' });
  assert.equal(none.cur, 3); assert.equal(none.prev, null); assert.equal(none.delta, null); assert.equal(none.pct, null);
  assert.equal(g.ChartLogic.kpiDelta([{ date: '2026-10-06', v: 0 }, { date: '2026-09-20', v: 0 }], { agg: 'avg', today: '2026-10-07' }).pct, null);
});

test('v7.22 career_documents 첨부 한도는 10MB', () => {
  assert.equal(g.attachmentLimit('career_documents'), 10 * 1024 * 1024);
});
