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
globalThis.CONFIG = { mode: 'local' };
let n = 0; globalThis.uid = () => `id-${++n}`;
for (const f of ['js/utils/xmlTree.js', 'js/utils/careerLogic.js', 'js/utils/customColumns.js', 'js/services/formTemplate.js', 'js/services/feedService.js', 'js/utils/briefingSearch.js', 'js/utils/attachLogic.js', 'js/store/localStore.js']) load(f);
globalThis.getStore = () => new globalThis.LocalStore();
load('js/services/settingsSync.js'); load('js/state.js');
const FT = globalThis.FormTemplate; const CC = globalThis.CareerCols;

// ---------- 1) 발행일 정규화 (briefing_items 400 원인) ----------
test('normalizeFeedDate: RSS 날짜 형식을 ISO로, 읽을 수 없으면 null', () => {
  const N = globalThis.normalizeFeedDate;
  assert.equal(N('Mon, 09 Nov 2026 03:00:00 +0900'), '2026-11-08T18:00:00.000Z');
  assert.equal(N('Mon, 09 Nov 2026 03:00:00 KST'), '2026-11-08T18:00:00.000Z');
  assert.equal(N('Mon, 09 Nov 2026 03:00:00 GMT'), '2026-11-09T03:00:00.000Z');
  assert.equal(N('2026.11.09 14:30'), '2026-11-09T05:30:00.000Z');
  assert.equal(N('2026-11-09 14:30:00'), '2026-11-09T05:30:00.000Z');
  assert.equal(N('2026-11-09T14:30:00+09:00'), '2026-11-09T05:30:00.000Z');
  assert.equal(N('어제 오후'), null);
  assert.equal(N(''), null); assert.equal(N(null), null);
  assert.equal(N('Thu, 01 Jan 1970 00:00:00 GMT'), null);
});
test('parseFeedXml: 발행일이 ISO로 나오고, http가 아닌 링크는 거른다', () => {
  const xml = `<rss><channel>
    <item><title>가</title><link>https://a.com/1</link><pubDate>Mon, 09 Nov 2026 03:00:00 KST</pubDate></item>
    <item><title>나</title><link>/relative</link></item>
    <item><title>다</title><link>https://a.com/3</link><pubDate>엉터리</pubDate></item></channel></rss>`;
  const r = globalThis.parseFeedXml(xml);
  assert.equal(r.length, 2);
  assert.equal(r[0].publishedAt, '2026-11-08T18:00:00.000Z');
  assert.equal(r[1].publishedAt, null);
});

// ---------- 2) 수집: 한 건 실패해도 계속 + 소스별 report ----------
test('collectBriefingItems: 저장 한 건이 실패해도 나머지를 저장하고 report에 사유를 남긴다', async () => {
  globalThis.localStorage = new FakeLS(); globalThis.sessionStorage = new FakeLS();
  const { appState } = globalThis;
  appState.store = new globalThis.LocalStore();
  const s = await appState.store.signUp({ username: 'feeduser', password: 'pw1234' });
  const session = await appState.store.signIn('feeduser', 'pw1234'); appState.user = session.user;
  await appState.refreshAll();
  await appState.store.create('feed_sources', { user_id: appState.user.id, name: 'A사', type: 'rss', endpoint: 'https://a.example/rss', enabled: true });
  await appState.store.create('feed_sources', { user_id: appState.user.id, name: 'B사', type: 'rss', endpoint: 'https://b.example/rss', enabled: true });
  await appState.refreshAll();
  globalThis.fetchFeedItems = async (url) => {
    if (url.includes('b.example')) throw new Error('프록시 응답 오류(HTTP 403)');
    return [{ title: '정상1', link: 'https://a.example/1', publishedAt: '2026-11-09T01:00:00.000Z', summary: '' },
      { title: 'BAD', link: 'https://a.example/2', publishedAt: null, summary: '' },
      { title: '정상3', link: 'https://a.example/3', publishedAt: null, summary: '' }];
  };
  const realCreate = appState.store.create.bind(appState.store);
  appState.store.create = async (table, row) => { if (table === 'briefing_items' && row.title === 'BAD') throw new Error('invalid input syntax (HTTP 400)'); return realCreate(table, row); };
  const r = await appState.collectBriefingItems();
  assert.equal(r.newCount, 2);
  const a = r.report.find((x) => x.name === 'A사'); const b = r.report.find((x) => x.name === 'B사');
  assert.equal(a.added, 2); assert.equal(a.failed, 1); assert.match(a.firstFailure, /400/);
  assert.match(b.error, /403/);
  assert.ok(r.errors.some((e) => e.includes('A사') && e.includes('저장 실패')));
  // 같은 항목 재수집 → 중복으로 센다
  appState.store.create = realCreate;
  const r2 = await appState.collectBriefingItems();
  assert.equal(r2.report.find((x) => x.name === 'A사').dup, 2);
});

// ---------- 3) 브리핑 검색 ----------
const NOW = new Date(2026, 10, 9, 14, 0, 0); // 2026-11-09 (월)
test('자연어 해석: 지난주·안 읽은·키워드', () => {
  const p = globalThis.parseNaturalQuery('지난주 스마트팜 안 읽은 뉴스', { now: NOW });
  assert.equal(p.from, '2026-11-02'); assert.equal(p.to, '2026-11-08');
  assert.equal(p.read, 'unread'); assert.deepEqual(p.text, ['스마트팜']);
});
test('자연어 해석: 최근 N일 · 어제 · 제목:/내용: · 제외어 · 구문', () => {
  const P = (q, c) => globalThis.parseNaturalQuery(q, { now: NOW, ...c });
  assert.equal(P('최근 3일 보조금').from, '2026-11-06');
  assert.equal(P('어제').from, '2026-11-08');
  const t = P('제목:보조금 내용:"정밀 농업" -광고');
  assert.deepEqual(t.text, ['보조금', '정밀 농업']); assert.deepEqual(t.exclude, ['광고']);
  assert.equal(P('이번 달').from, '2026-11-01');
  assert.equal(P('11월 3일').from, '2026-11-03');
});
test('자연어 해석: 피드 이름은 조건으로 승격, 주제 이름은 검색어로 남고 주제:로 지정', () => {
  const sources = [{ id: 's1', name: '전자신문', type: 'rss' }]; const topics = [{ id: 't1', name: '스마트팜' }];
  const p = globalThis.parseNaturalQuery('전자신문 스마트팜 반도체', { now: NOW, sources, topics });
  assert.equal(p.sourceId, 's1'); assert.equal(p.topicId, ''); assert.deepEqual(p.text, ['스마트팜', '반도체']);
  assert.equal(globalThis.parseNaturalQuery('주제:스마트팜', { now: NOW, sources, topics }).topicId, 't1');
});
test('필터: 범위·기간·피드구분·읽음·정렬', () => {
  const F = globalThis.filterBriefingItems;
  const sources = [{ id: 's1', name: 'RSS1', type: 'rss' }, { id: 's2', name: 'MD1', type: 'markdown' }];
  const items = [
    { id: 1, title: '스마트팜 보조금', summary: '정책', link: 'x', source_id: 's1', published_at: '2026-11-09T12:00:00Z', is_read: false },
    { id: 2, title: '반도체', summary: '스마트팜 언급', link: 'x', source_id: 's2', published_at: '2026-11-03T12:00:00Z', is_read: true },
    { id: 3, title: '검색 수집 글', summary: '', link: 'x', source_id: null, published_at: null, created_at: '2026-11-08T12:00:00Z', is_read: false },
  ];
  const ctx = { sources, topics: [] };
  assert.deepEqual(F(items, { text: ['스마트팜'], scope: 'title' }, ctx).map((i) => i.id), [1]);
  assert.deepEqual(F(items, { text: ['스마트팜'], scope: 'content' }, ctx).map((i) => i.id), [2]);
  assert.deepEqual(F(items, { text: ['스마트팜'] }, ctx).map((i) => i.id).sort(), [1, 2]);
  assert.deepEqual(F(items, { from: '2026-11-08', to: '2026-11-09' }, ctx).map((i) => i.id), [1, 3]); // 발행일 없으면 수집일로
  assert.deepEqual(F(items, { sourceId: 'md' }, ctx).map((i) => i.id), [2]);
  assert.deepEqual(F(items, { sourceId: 'topic' }, ctx).map((i) => i.id), [3]);
  assert.deepEqual(F(items, { sourceId: 'rss' }, ctx).map((i) => i.id), [1]);
  assert.deepEqual(F(items, { read: 'unread', sort: 'old' }, ctx).map((i) => i.id), [3, 1]);
  assert.deepEqual(F(items, { exclude: ['반도체'] }, ctx).map((i) => i.id).sort(), [1, 3]);
});

// ---------- 4) 선택 목록 입력 ----------
test('parseOptions: 쉼표·세미콜론·줄바꿈 구분, 공백/중복 제거', () => {
  assert.deepEqual(CC.parseOptions('사원, 대리, 과장, 차장, 부장, 선임, 책임, 수석'), ['사원', '대리', '과장', '차장', '부장', '선임', '책임', '수석']);
  assert.deepEqual(CC.parseOptions('가;나\n다 | 가,, 나'), ['가', '나', '다']);
  assert.deepEqual(CC.parseOptions(''), []);
  assert.equal(CC.clean({ id: 'abc1', label: '직위', type: 'select', options: ['사원', '사원', ' 대리 '] }).options.length, 2);
});

// ---------- 5) 양식 문서 최신 업데이트 ----------
function mkEdu(id, school, extra) { return { id, school_name: school, degree: '', admission_date: '2010-03-01', graduation_date: `20${10 + Number(id.slice(-1))}-02-28`, extra: extra || {} }; }
function setup(records) {
  CC.save({ education: [{ id: 'loc1', label: '소재지', type: 'text', options: [], list: true, aliases: [], archived: false }] });
  FT.registerCustom({ education: CC.defs('education') });
  const ds = FT.buildDataset({ career: { education: records }, basic: { name: '홍길동' }, todayIso: '2026-11-09', order: 'asc' });
  const mapping = {
    fields: [{ id: 'l:0:0:0', kind: 'scalar', label: '최종학교', source: 'education.latest.school_name' }],
    repeats: [{ id: 'r:0:2', kind: 'repeat', category: 'education', title: '학력', cols: [{ c: 0, label: '번호', source: 'seq' }, { c: 1, label: '학교', source: 'school_name' }, { c: 2, label: '소재지', source: 'x_loc1' }] }],
  };
  return { ds, mapping };
}
const OPT = { dateFormat: 'YYYY.MM.DD', order: 'asc', addRows: true };
test('업데이트: 손대지 않은 값은 갱신되고, 새 기록은 행으로 추가된다', () => {
  const a = setup([mkEdu('e1', 'A대', { loc1: '서울' })]);
  const init = FT.buildInitialValues(a.mapping, a.ds, OPT); init.sync = FT.makeBaseline(init, 's0');
  assert.equal(init.repeats['r:0:2'][0].cells[2], '서울');
  // 데이터 변경: 소재지 수정 + 학력 추가
  const b = setup([mkEdu('e1', 'A대', { loc1: '부산' }), mkEdu('e2', 'B대', { loc1: '대구' })]);
  const r = FT.refreshValues({ mapping: a.mapping, values: init, ds: b.ds, options: OPT, sig: 's1', oldMapping: a.mapping });
  assert.equal(r.conflicts.length, 0);
  const rows = r.values.repeats['r:0:2'];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].cells[2], '부산'); assert.equal(rows[1].cells[1], 'B대'); assert.equal(rows[1].cells[0], '2');
  assert.equal(r.values.scalars['l:0:0:0'], 'B대');
  assert.equal(r.values.sync.sig, 's1');
});
test('업데이트: 직접 고친 값은 충돌로 분류(자동 덮어쓰기 없음), 데이터가 안 바뀌었으면 조용히 유지', () => {
  const a = setup([mkEdu('e1', 'A대', { loc1: '서울' })]);
  const init = FT.buildInitialValues(a.mapping, a.ds, OPT); init.sync = FT.makeBaseline(init, 's0');
  init.repeats['r:0:2'][0].cells[2] = '서울특별시'; // 사용자가 직접 수정
  init.scalars['l:0:0:0'] = '내가 쓴 학교';
  // (1) 데이터 그대로 → 충돌 없음, 값 유지
  const same = FT.refreshValues({ mapping: a.mapping, values: JSON.parse(JSON.stringify(init)), ds: a.ds, options: OPT, sig: 's0', oldMapping: a.mapping });
  assert.equal(same.conflicts.length, 0); assert.equal(same.values.repeats['r:0:2'][0].cells[2], '서울특별시'); assert.equal(same.values.scalars['l:0:0:0'], '내가 쓴 학교');
  // (2) 데이터가 바뀜 → 충돌 2건, 값은 그대로
  const b = setup([mkEdu('e1', 'A대학교', { loc1: '인천' })]);
  const r = FT.refreshValues({ mapping: a.mapping, values: JSON.parse(JSON.stringify(init)), ds: b.ds, options: OPT, sig: 's1', oldMapping: a.mapping });
  assert.equal(r.conflicts.length, 2);
  assert.equal(r.values.repeats['r:0:2'][0].cells[2], '서울특별시');
  // 충돌 해결: 최신으로
  for (const c of r.conflicts) FT.applyConflict(r.values, c);
  assert.equal(r.values.repeats['r:0:2'][0].cells[2], '인천'); assert.equal(r.values.scalars['l:0:0:0'], 'A대학교');
});
test('업데이트: 사용자가 뺀 행은 되살리지 않고, 삭제된 기록의 손대지 않은 행은 정리', () => {
  const a = setup([mkEdu('e1', 'A대', {}), mkEdu('e2', 'B대', {}), mkEdu('e3', 'C대', {})]);
  const init = FT.buildInitialValues(a.mapping, a.ds, OPT); init.sync = FT.makeBaseline(init, 's0');
  init.repeats['r:0:2'] = init.repeats['r:0:2'].filter((r) => r.src !== 'e2'); // 사용자가 B대 행을 뺌
  const b = setup([mkEdu('e1', 'A대', {}), mkEdu('e2', 'B대', {})]); // C대 기록 삭제
  const r = FT.refreshValues({ mapping: a.mapping, values: init, ds: b.ds, options: OPT, sig: 's1', oldMapping: a.mapping });
  const srcs = r.values.repeats['r:0:2'].map((x) => x.src);
  assert.deepEqual(srcs, ['e1']);
});
test('업데이트: 양식에서 새로 맞춰진 컬럼(mergeMapping)이 반영된다', () => {
  const a = setup([mkEdu('e1', 'A대', { loc1: '서울' })]);
  const oldM = JSON.parse(JSON.stringify(a.mapping));
  oldM.repeats[0].cols[2].source = 'none'; // 컬럼을 만들기 전에는 '소재지' 열이 미매칭이었음
  const init = FT.buildInitialValues(oldM, a.ds, OPT); init.sync = FT.makeBaseline(init, 's0');
  assert.equal(init.repeats['r:0:2'][0].cells[2], '');
  const merged = FT.mergeMapping(oldM, { fields: a.mapping.fields, repeats: a.mapping.repeats });
  assert.equal(merged.added.cols.length, 1);
  const newM = { ...oldM, fields: merged.fields, repeats: merged.repeats };
  const r = FT.refreshValues({ mapping: newM, values: init, ds: a.ds, options: OPT, sig: 's1', oldMapping: oldM });
  assert.equal(r.values.repeats['r:0:2'][0].cells[2], '서울'); assert.equal(r.conflicts.length, 0);
});
test('dataSignature: 등록 데이터가 바뀌면 지문이 달라진다', () => {
  const a = setup([mkEdu('e1', 'A대', { loc1: '서울' })]); const b = setup([mkEdu('e1', 'A대', { loc1: '부산' })]);
  assert.notEqual(FT.dataSignature(a.ds, CC.load()), FT.dataSignature(b.ds, CC.load()));
  assert.equal(FT.dataSignature(a.ds, CC.load()), FT.dataSignature(setup([mkEdu('e1', 'A대', { loc1: '서울' })]).ds, CC.load()));
});

// ---------- 6) 캡처 붙여넣기 ----------
test('캡처 파일명·클립보드 이미지 추출', () => {
  assert.equal(globalThis.captureFileName(new Date(2026, 10, 9, 14, 29, 30), 'image/png'), '캡처_20261109_142930.png');
  assert.equal(globalThis.captureFileName(new Date(2026, 10, 9, 14, 29, 30), 'image/jpeg', 1), '캡처_20261109_142930_2.jpg');
  const png = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
  const items = [{ kind: 'string', type: 'text/plain', getAsFile: () => null }, { kind: 'file', type: 'image/png', getAsFile: () => png }, { kind: 'file', type: 'application/pdf', getAsFile: () => png }];
  const imgs = globalThis.imageFilesFromItems(items);
  assert.equal(imgs.length, 1);
  const files = globalThis.namedCaptureFiles(imgs, new Date(2026, 10, 9, 1, 2, 3));
  assert.equal(files[0].name, '캡처_20261109_010203.png'); assert.equal(files[0].type, 'image/png');
});

// ---------- 7) 코드 연결 ----------
test('화면/서버 코드가 새 기능에 연결되어 있다', () => {
  const docs = read('js/modules/careerDocs.js');
  assert.match(docs, /cd-refresh/); assert.match(docs, /cd-act-refresh/); assert.match(docs, /cd-stale-badge/); assert.match(docs, /FT\.refreshValues/);
  const att = read('js/components/attachments.js');
  assert.equal((att.match(/= attachCaptureTools\(container/g) || []).length, 2); // 저장된 레코드용 + 저장 전(pending)용
  assert.match(att, /getDisplayMedia/); assert.match(att, /clipboard\.read/);
  const br = read('js/modules/briefing.js');
  assert.match(br, /openCollectReport/); assert.match(br, /parseNaturalQuery/);
  const proxy = read('api/custom-proxy.js');
  assert.match(proxy, /User-Agent/); assert.match(proxy, /no-store/);
  assert.match(read('index.html'), /briefingSearch\.js/);
  const cl = read('js/modules/career.js');
  assert.match(cl, /career-newcol-options/); assert.match(cl, /career-col-options/);
});
