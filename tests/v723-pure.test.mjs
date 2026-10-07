import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// v7.23.0 순수 로직: 기간 일정·달력 막대 배치·구분 이모지, 프로젝트 복사 계획, 브리핑 마법사(검색 주소/양식 파싱/마크다운).
// TZ=Asia/Seoul / UTC / America/Los_Angeles 모두 같은 결과여야 한다.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function load(rel) { (0, eval)(fs.readFileSync(path.join(__dirname, rel), 'utf8')); }
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
for (const f of ['utils/date', 'predict', 'wbs', 'services/feedService', 'utils/briefingMd']) load(`../js/${f}.js`);
const g = globalThis;

// ---------------- 기간 일정 ----------------
test('scheduleEnd/Span: 종료일이 없거나 시작일 이하이면 하루 일정', () => {
  assert.equal(g.scheduleEnd({ date: '2026-10-07' }), '2026-10-07');
  assert.equal(g.scheduleEnd({ date: '2026-10-07', end_date: '2026-10-05' }), '2026-10-07');
  assert.equal(g.isMultiDaySchedule({ date: '2026-10-07', end_date: '2026-10-07' }), false);
  assert.equal(g.scheduleSpanDays({ date: '2026-10-07', end_date: '2026-10-09' }), 3);
  assert.equal(g.scheduleSpanDays({ date: '2026-12-30', end_date: '2027-01-02' }), 4); // 연도 경계
  assert.equal(g.scheduleSpanDays({ date: '2028-02-28', end_date: '2028-03-01' }), 3); // 윤년
});
test('scheduleCoversDate / schedulePosition', () => {
  const s = { date: '2026-10-07', end_date: '2026-10-09' };
  assert.equal(g.scheduleCoversDate(s, '2026-10-06'), false);
  assert.deepEqual(['07', '08', '09', '10'].map((d) => g.schedulePosition(s, `2026-10-${d}`)), ['start', 'mid', 'end', null]);
  assert.equal(g.schedulePosition({ date: '2026-10-07' }, '2026-10-07'), 'single');
});
test('scheduleRangeLabel', () => {
  assert.equal(g.scheduleRangeLabel({ date: '2026-10-07' }), '10/7(수)');
  assert.equal(g.scheduleRangeLabel({ date: '2026-10-07', end_date: '2026-10-09' }), '10/7(수) ~ 10/9(금) · 3일간');
});
test('validateScheduleRange', () => {
  assert.equal(g.validateScheduleRange('2026-10-07', ''), null);
  assert.equal(g.validateScheduleRange('2026-10-07', '2026-10-07'), null);
  assert.match(g.validateScheduleRange('2026-10-07', '2026-10-06'), /빠를 수 없/);
  assert.match(g.validateScheduleRange('2026-10-07', '2028-10-07'), /최대/);
  assert.match(g.validateScheduleRange('2026-10-07', '2026-13-40'), /형식/);
});
test('buildCalendarLanes: 기간 일정은 모든 날짜 칸에서 같은 줄에 놓이고 하루 일정은 빈 줄을 채운다', () => {
  const long = { id: 'L', title: '출장', date: '2026-10-06', end_date: '2026-10-09' };
  const a = { id: 'A', title: '회의', date: '2026-10-05' };
  const b = { id: 'B', title: '점심', date: '2026-10-07' };
  const c = { id: 'C', title: '세미나', date: '2026-10-08', end_date: '2026-10-10' };
  const r = g.buildCalendarLanes([b, c, a, long], '2026-10-04', '2026-10-17');
  const laneOf = (d, id) => r[d].findIndex((x) => x && x.s.id === id);
  const lanes = ['06', '07', '08', '09'].map((d) => laneOf(`2026-10-${d}`, 'L'));
  assert.equal(new Set(lanes).size, 1, '출장이 모든 날 같은 줄');
  assert.equal(r['2026-10-07'].find((x) => x && x.s.id === 'B').pos, 'single');
  assert.equal(r['2026-10-06'].find((x) => x && x.s.id === 'L').pos, 'start');
  assert.equal(r['2026-10-09'].find((x) => x && x.s.id === 'L').pos, 'end');
  // 겹치는 두 기간 일정은 서로 다른 줄
  assert.notEqual(laneOf('2026-10-08', 'L'), laneOf('2026-10-08', 'C'));
  // 같은 줄에 두 일정이 겹치지 않는다
  for (const d of Object.keys(r)) { const ids = r[d].filter(Boolean).map((x) => x.s.id); assert.equal(new Set(ids).size, ids.length); }
});
test('buildCalendarLanes: 격자 밖에서 시작/끝나는 일정도 잘라서 표시하되 위치(pos)는 실제 기준', () => {
  const s = { id: 'X', title: '연수', date: '2026-09-28', end_date: '2026-10-06' };
  const r = g.buildCalendarLanes([s], '2026-10-01', '2026-10-31');
  assert.equal(r['2026-10-01'][0].pos, 'mid');
  assert.equal(r['2026-10-06'][0].pos, 'end');
  assert.equal(r['2026-10-07'], undefined);
  assert.deepEqual(g.buildCalendarLanes([{ id: 'Y', date: '2026-11-05' }], '2026-10-01', '2026-10-31'), {});
});
test('구분 이모지: 5개 구분 모두 있고 알 수 없는 값은 기타', () => {
  for (const c of g.SCHEDULE_CATEGORIES) assert.ok(g.scheduleCategoryEmoji(c));
  assert.equal(g.scheduleCategoryEmoji('???'), g.scheduleCategoryEmoji('기타'));
});
test('"N일 후" 자식 일정: 기간(종료일)도 같은 길이로 따라간다', () => {
  const parent = { id: 'P', title: '출장', date: '2026-10-07', end_date: '2026-10-09', repeat_offsets: [7], category: '업무' };
  const plan = g.planScheduleChildren(parent, []);
  assert.equal(plan.create[0].date, '2026-10-14');
  assert.equal(plan.create[0].end_date, '2026-10-16');
  const one = g.planScheduleChildren({ ...parent, end_date: null }, []);
  assert.equal(one.create[0].end_date, null);
});

// ---------------- 프로젝트 복사 ----------------
function sampleProject() {
  const P = { id: 'p1', name: '사회복지사', status: 'in_progress', priority: 'high', tags: ['자격증'], memo: '메모', deadline: '2026-12-31', actual_completion_date: '2026-12-30' };
  const stages = [
    { id: 's0', project_id: 'p1', name: '1학기', seq: 0, parent_id: null, start_date: '2026-03-02', target_date: '2026-06-30', status: 'done', progress: 100, actual_completion_date: '2026-06-29', baseline_start: '2026-03-02', baseline_end: '2026-06-30' },
    { id: 's1', project_id: 'p1', name: '1강', seq: 0, parent_id: 's0', start_date: '2026-03-02', target_date: '2026-03-08', status: 'done', progress: 100 },
    { id: 's2', project_id: 'p1', name: '2강', seq: 1, parent_id: 's0', start_date: '2026-03-09', target_date: '2026-03-15', status: 'in_progress', progress: 40, depends_on: ['s1', 's9', 's1:SS'] },
    { id: 'o1', project_id: 'other', name: '남의 프로젝트 항목', seq: 0 },
  ];
  return { P, stages };
}
test('planProjectCopy: 이름·구조·순서를 복사하고 다른 프로젝트 항목은 제외', () => {
  const { P, stages } = sampleProject();
  const r = g.WBS.planProjectCopy(P, stages, { name: '노인복지론' });
  assert.equal(r.project.name, '노인복지론');
  assert.deepEqual(r.project.tags, ['자격증']);
  assert.equal(r.project.actual_completion_date, null);
  assert.equal(r.stages.length, 3);
  assert.deepEqual(r.stages.map((x) => [x.fields.name, x.depth, x.parentKey]), [['1학기', 0, null], ['1강', 1, 's0'], ['2강', 1, 's0']]);
  assert.ok(!r.stages.some((x) => x.key === 'o1'));
});
test('planProjectCopy: 기본값은 날짜 비움 + 상태/진행률/실적/기준선 초기화', () => {
  const { P, stages } = sampleProject();
  const r = g.WBS.planProjectCopy(P, stages, { name: 'x' });
  assert.equal(r.project.deadline, null);
  for (const st of r.stages) {
    assert.equal(st.fields.start_date, null); assert.equal(st.fields.target_date, null);
    assert.equal(st.fields.status, 'todo'); assert.equal(st.fields.progress, 0);
    assert.equal(st.fields.actual_completion_date, null); assert.equal(st.fields.baseline_start, null);
  }
});
test('planProjectCopy: 이름이 비면 "(복사)"가 붙고, 항목 제외 옵션', () => {
  const { P, stages } = sampleProject();
  const r = g.WBS.planProjectCopy(P, stages, { name: '  ', includeStages: false });
  assert.equal(r.project.name, '사회복지사 (복사)');
  assert.equal(r.stages.length, 0);
});
test('planProjectCopy: 날짜 이동은 간격을 유지하고, 날짜 유지/진행 유지도 가능', () => {
  const { P, stages } = sampleProject();
  const sh = g.WBS.planProjectCopy(P, stages, { dateMode: 'shift', shiftBase: '2027-03-01' });
  assert.equal(sh.shiftDays, 364);
  const f = (n) => sh.stages.find((x) => x.fields.name === n).fields;
  assert.equal(f('1학기').start_date, '2027-03-01');
  assert.equal(g.isoDiff(f('1강').start_date, f('2강').start_date), 7); // 간격 유지
  assert.equal(sh.project.deadline, g.shiftIso('2026-12-31', 364));
  const keep = g.WBS.planProjectCopy(P, stages, { dateMode: 'keep', resetProgress: false });
  assert.equal(keep.project.deadline, '2026-12-31');
  assert.equal(keep.stages[2].fields.progress, 40);
  assert.equal(keep.stages[2].fields.status, 'in_progress');
});
test('planProjectCopy: 의존관계는 같은 프로젝트 안의 것만, 유형 유지', () => {
  const { P, stages } = sampleProject();
  const r = g.WBS.planProjectCopy(P, stages, {});
  assert.deepEqual(r.stages.find((x) => x.key === 's2').deps, [{ key: 's1', type: 'FS' }, { key: 's1', type: 'SS' }]);
});

// ---------------- 브리핑 마법사 ----------------
test('splitList: 줄바꿈/쉼표 구분, 공백·중복 제거', () => {
  assert.deepEqual(g.splitList(' a, b\nA ;c,, '), ['a', 'b', 'c']);
  assert.deepEqual(g.splitList(null), []);
  assert.deepEqual(g.splitList(['x', 'y,z']), ['x', 'y', 'z']);
});
test('parseSiteInput: 도메인/URL/RSS 구분, 위험한 입력 거부', () => {
  assert.deepEqual(g.parseSiteInput('etnews.com'), { input: 'etnews.com', host: 'etnews.com', url: 'https://etnews.com/', isFeed: false });
  assert.equal(g.parseSiteInput('https://www.hankyung.com/economy').host, 'hankyung.com');
  assert.equal(g.parseSiteInput('https://blog.example.com/feed.xml').isFeed, true);
  assert.equal(g.parseSiteInput('https://x.com/rss').isFeed, true);
  assert.equal(g.parseSiteInput('https://x.com/news/feedback').isFeed, false);
  for (const bad of ['', 'javascript:alert(1)', 'not a url', 'ftp://a.com', 'localhost']) assert.equal(g.parseSiteInput(bad), null, bad);
});
test('buildTopicFeeds: 사이트×검색어 조합, RSS는 그대로, 제외어는 -단어, 검색어 없으면 주제 이름', () => {
  const f = g.buildTopicFeeds({ name: '스마트팜', site_urls: ['etnews.com', 'https://blog.example.com/feed.xml'], search_terms: ['스마트팜 정책'], exclude_keywords: ['광고'] });
  assert.equal(f[0].kind, 'feed'); assert.equal(f[0].url, 'https://blog.example.com/feed.xml');
  assert.equal(f.length, 2);
  const q = decodeURIComponent(new URL(f[1].url).searchParams.get('q'));
  assert.equal(q, '"스마트팜 정책" site:etnews.com -광고');
  const byName = g.buildTopicFeeds({ name: 'AI' });
  assert.equal(decodeURIComponent(new URL(byName[0].url).searchParams.get('q')), 'AI');
  assert.equal(g.buildTopicFeeds({ name: '' }).length, 0);
});
test('buildTopicFeeds: 상한(12개)과 중복 제거', () => {
  const sites = Array.from({ length: 5 }, (_, i) => `s${i}.com`);
  const terms = ['a', 'b', 'c', 'd'];
  assert.equal(g.buildTopicFeeds({ name: 'x', site_urls: sites, search_terms: terms }).length, 12);
  assert.equal(g.buildTopicFeeds({ name: 'x', search_terms: ['a', 'A', 'a'] }).length, 1);
});
test('itemHasExcluded / priorityHits / deriveSourceLabel', () => {
  const t = { exclude_keywords: ['광고'], priority_keywords: ['보조금', '신기술'] };
  assert.equal(g.itemHasExcluded({ title: '[광고] 팜', summary: '' }, t), true);
  assert.equal(g.itemHasExcluded({ title: '스마트팜', summary: '좋은 광고 아님' }, t), true);
  assert.equal(g.itemHasExcluded({ title: '스마트팜', summary: '' }, t), false);
  assert.deepEqual(g.priorityHits({ title: '신기술 보조금 확대', summary: '' }, t), ['보조금', '신기술']);
  assert.deepEqual(g.priorityHits({ title: 'x' }, null), []);
  assert.equal(g.deriveSourceLabel({ title: '정책 발표 - 전자신문', link: 'https://news.google.com/rss/articles/x' }), '전자신문');
  assert.equal(g.deriveSourceLabel({ title: 'a - b', link: 'https://www.etnews.com/1' }), 'etnews.com');
});
test('parseBriefingSpec / briefingSpecToText: 양식 왕복', () => {
  const spec = g.parseBriefingSpec('주제: 스마트팜\n사이트: etnews.com, hankyung.com\n검색어: 스마트팜 정책\n우선: 보조금\n제외: 광고, 채용\n');
  assert.deepEqual(spec, { name: '스마트팜', site_urls: ['etnews.com', 'hankyung.com'], search_terms: ['스마트팜 정책'], priority_keywords: ['보조금'], exclude_keywords: ['광고', '채용'] });
  assert.deepEqual(g.parseBriefingSpec(g.briefingSpecToText(spec)), spec);
  // 영문 라벨, 목록 기호, 값이 다음 줄로 이어짐, 모르는 라벨은 무시
  const s2 = g.parseBriefingSpec('- topic: AI\n- site: a.com\n  b.com\n모름: 무시\n- exclude: x');
  assert.equal(s2.name, 'AI'); assert.deepEqual(s2.site_urls, ['a.com', 'b.com']); assert.deepEqual(s2.exclude_keywords, ['x']);
  assert.equal(g.parseBriefingSpec('').name, '');
});
test('briefingToMarkdown: 우선 항목 ⭐ 먼저, 검색 조건 요약, 우선순위 높은 주제 먼저, 출처 폴백', () => {
  const topics = [{ id: 't1', name: '스마트팜', priority: 3, priority_keywords: ['보조금'], search_terms: ['스마트팜'], site_urls: ['etnews.com'], exclude_keywords: ['광고'] }, { id: 't2', name: 'AI', priority: 9 }];
  const items = [
    { title: '일반 기사 - 전자신문', link: 'https://news.google.com/a', topic_id: 't1', published_at: '2026-10-06T00:00:00Z' },
    { title: '보조금 확대 - 한경', link: 'https://news.google.com/b', topic_id: 't1', published_at: '2026-10-01T00:00:00Z' },
    { title: 'AI 소식', link: 'https://www.openai.com/x', topic_id: 't2' },
  ];
  const md = g.briefingToMarkdown(items, { topics, date: '2026-10-07' });
  assert.ok(md.indexOf('## AI') < md.indexOf('## 스마트팜'), '우선순위 높은 주제가 먼저');
  assert.ok(md.indexOf('⭐ [보조금 확대') < md.indexOf('[일반 기사'), '우선 항목이 먼저');
  assert.match(md, /> 검색어: 스마트팜 · 사이트: etnews.com · ⭐ 우선: 보조금 · 제외: 광고/);
  assert.match(md, /— 한경 · 2026-10-01/);
  assert.match(md, /— openai.com/);
  assert.match(md, /#보조금/);
});
test('parseBriefingSpec: 다음 줄의 https:// 주소는 이어진 값', () => {
  const s = g.parseBriefingSpec('사이트: a.com\nhttps://b.com/feed.xml\n검색어: x');
  assert.deepEqual(s.site_urls, ['a.com', 'https://b.com/feed.xml']);
  assert.deepEqual(s.search_terms, ['x']);
});
