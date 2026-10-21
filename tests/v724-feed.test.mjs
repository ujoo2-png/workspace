import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// v7.24.0: 브리핑 수집 개편(feedService) 순수 함수 테스트.
// js/*.js는 일반 <script>(globalThis.X 전역 등록) 방식이므로 파일을 읽어 평가한다.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadGlobalScript(relPath) {
  const code = fs.readFileSync(path.join(__dirname, relPath), 'utf8');
  (0, eval)(code);
}
// feedService는 window.XmlTree(parseFeedXml)·window.parseMarkdownLinks를 쓴다.
globalThis.window = globalThis;
loadGlobalScript('../js/utils/xmlTree.js');
loadGlobalScript('../js/services/feedService.js');
const { parseMarkdownLinks, parseFeedXml, sourceHealth, isStaleSource } = globalThis;

test('parseMarkdownLinks: 표준 인라인 링크', () => {
  const r = parseMarkdownLinks('- [기사 제목](https://example.com/a) 설명');
  assert.equal(r.length, 1);
  assert.equal(r[0].title, '기사 제목');
  assert.equal(r[0].link, 'https://example.com/a');
});

test('parseMarkdownLinks: 제목이 여러 줄에 걸쳐도 인식한다 (예전엔 0건)', () => {
  const r = parseMarkdownLinks('[긴 제목입니다](https://example.com/a)');
  assert.equal(r.length, 1);
  assert.equal(r[0].title, '긴 제목입니다');
});

test('parseMarkdownLinks: 참조형 링크를 인식한다 (예전엔 0건)', () => {
  const r = parseMarkdownLinks('[기사][1]\n\n[1]: https://example.com/a');
  assert.equal(r.length, 1);
  assert.equal(r[0].title, '기사');
  assert.equal(r[0].link, 'https://example.com/a');
});

test('parseMarkdownLinks: HTML 앵커를 인식한다 (예전엔 0건)', () => {
  const r = parseMarkdownLinks('<a href="https://example.com/a">기사 제목</a>');
  assert.equal(r.length, 1);
  assert.equal(r[0].title, '기사 제목');
});

test('parseMarkdownLinks: bare URL을 인식한다 (예전엔 0건)', () => {
  const r = parseMarkdownLinks('https://example.com/news/hello-world');
  assert.equal(r.length, 1);
  assert.equal(r[0].link, 'https://example.com/news/hello-world');
  assert.ok(r[0].title.length > 0); // 경로에서 제목 자동 생성
});

test('parseMarkdownLinks: URL 앞뒤 공백/괄호 표기를 관대하게 처리한다', () => {
  assert.equal(parseMarkdownLinks('[기사]( https://example.com/a )').length, 1);
  assert.equal(parseMarkdownLinks('[기사](<https://example.com/a>)').length, 1);
});

test('parseMarkdownLinks: 제목 안의 대괄호를 처리한다 (예전엔 0건)', () => {
  const r = parseMarkdownLinks('[2024 [특집] 기사](https://example.com/a)');
  assert.equal(r.length, 1);
  assert.equal(r[0].title, '2024 [특집] 기사');
});

test('parseMarkdownLinks: 같은 링크는 한 번만 담는다', () => {
  const r = parseMarkdownLinks('[A](https://example.com/a)\n[A again](https://example.com/a)');
  assert.equal(r.length, 1);
});

test('parseMarkdownLinks: 링크가 없으면 빈 배열', () => {
  assert.deepEqual(parseMarkdownLinks('그냥 텍스트입니다. 링크 없음.'), []);
});

test('parseFeedXml: RSS 2.0(item/pubDate/description)', () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
    <item><title>첫 기사</title><link>https://a.com/1</link>
      <pubDate>Mon, 20 Oct 2026 09:00:00 GMT</pubDate>
      <description><![CDATA[<p>요약 <b>텍스트</b></p>]]></description></item>
    <item><title>둘째</title><link>https://a.com/2</link></item>
  </channel></rss>`;
  const items = parseFeedXml(xml);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, '첫 기사');
  assert.equal(items[0].link, 'https://a.com/1');
  assert.match(items[0].summary, /요약/);
  assert.ok(!items[0].summary.includes('<p>')); // 태그 제거 확인
});

test('parseFeedXml: Atom(entry/link href/published/summary)', () => {
  const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
    <entry><title>Atom 글</title><link href="https://b.com/x"/>
      <published>2026-10-20T09:00:00Z</published>
      <summary>요약입니다</summary></entry>
  </feed>`;
  const items = parseFeedXml(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Atom 글');
  assert.equal(items[0].link, 'https://b.com/x');
  assert.equal(items[0].publishedAt, '2026-10-20T09:00:00Z');
});

test('parseFeedXml: 엔티티(&amp;)를 해제한다', () => {
  const xml = `<rss><channel><item><title>A &amp; B</title><link>https://a.com/1</link></item></channel></rss>`;
  assert.equal(parseFeedXml(xml)[0].title, 'A & B');
});

test('parseFeedXml: link가 없는 항목은 건너뛴다', () => {
  const xml = `<rss><channel><item><title>링크없음</title></item></channel></rss>`;
  assert.equal(parseFeedXml(xml).length, 0);
});

// ---- v7.24.0(아이디어 5): 피드 소스 건강 상태 ----
const NOW = new Date('2026-10-20T12:00:00Z');
test('sourceHealth: 아직 수집한 적 없으면 stale(경고)', () => {
  const r = sourceHealth({ last_run_at: null });
  assert.equal(r.level, 'stale');
  assert.equal(isStaleSource({ last_run_at: null }), true);
});

test('sourceHealth: 마지막 수집이 오류면 error', () => {
  const r = sourceHealth({ last_run_at: '2026-10-19T00:00:00Z', last_result: 'error' }, { now: NOW });
  assert.equal(r.level, 'error');
  assert.equal(r.days, 1);
});

test('sourceHealth: 마지막 수집 0건이면 empty', () => {
  const r = sourceHealth({ last_run_at: '2026-10-18T00:00:00Z', last_result: 'empty' }, { now: NOW });
  assert.equal(r.level, 'empty');
});

test('sourceHealth: 성공했지만 오래됐으면 stale', () => {
  const r = sourceHealth({ last_run_at: '2026-10-01T00:00:00Z', last_result: 'success' }, { now: NOW, staleDays: 7 });
  assert.equal(r.level, 'stale');
  assert.equal(isStaleSource({ last_run_at: '2026-10-01T00:00:00Z', last_result: 'success' }, 7), true);
});

test('sourceHealth: 최근 성공이면 ok(경고 아님)', () => {
  const r = sourceHealth({ last_run_at: '2026-10-19T00:00:00Z', last_result: 'success' }, { now: NOW });
  assert.equal(r.level, 'ok');
  assert.equal(isStaleSource({ last_run_at: '2026-10-19T00:00:00Z', last_result: 'success' }, 7), false);
});
