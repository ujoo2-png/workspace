import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const d = path.dirname(fileURLToPath(import.meta.url));
globalThis.window = globalThis;
(0, eval)(fs.readFileSync(path.join(d, '../js/services/feedService.js'), 'utf8'));
(0, eval)(fs.readFileSync(path.join(d, '../js/utils/newsletter.js'), 'utf8'));

test('decodeEntities: 따옴표·nbsp·숫자 엔티티', () => {
  assert.equal(decodeEntities('&quot;A&quot; &amp; B&nbsp;C &#39;d&#x27;'), '"A" & B C \'d\'');
  assert.equal(decodeEntities('&unknown;'), '&unknown;');
});
test('cleanSummary: 제목 반복은 비우고 태그는 제거', () => {
  assert.equal(cleanSummary('수출 규제 강화 - 한국경제', '수출 규제 강화&nbsp;&nbsp;한국경제'), '');
  assert.equal(cleanSummary('제목', '<p>본문 <b>내용</b></p>'), '본문 내용');
});
test('parseRssXml: RSS2 + CDATA + Atom', () => {
  const r = parseRssXml('<rss><channel><item><title><![CDATA[A &amp; B]]></title><link>https://x.com/a?x=1&amp;y=2</link><pubDate>Wed, 14 Oct 2026 01:00:00 GMT</pubDate><description>설명</description></item></channel></rss>');
  assert.equal(r.length, 1); assert.equal(r[0].title, 'A & B'); assert.equal(r[0].link, 'https://x.com/a?x=1&y=2');
  const a = parseRssXml('<feed><entry><title>T</title><link href="https://y.com/p"/><updated>2026-10-14</updated></entry></feed>');
  assert.equal(a[0].link, 'https://y.com/p');
  assert.equal(parseRssXml('<item><title>x</title><link>javascript:alert(1)</link></item>').length, 0);
});
test('newsletter: 모델·HTML 이스케이프·정렬', () => {
  const now = new Date('2026-10-15T06:00:00Z');
  const topics = [{ id: 't1', name: '무역', priority: 3 }, { id: 't2', name: 'AI', priority: 1 }];
  const items = [
    { id: 1, topic_id: 't1', title: '<img onerror=x> 수출', link: 'https://a.com/1', published_at: '2026-10-15T01:00:00Z', summary: '요약' },
    { id: 2, topic_id: 't2', title: 'AI 소식', link: 'https://a.com/2', published_at: '2026-10-14T20:00:00Z' },
    { id: 3, topic_id: 't2', title: '중복', link: 'https://a.com/2', published_at: '2026-10-14T21:00:00Z' },
    { id: 4, topic_id: 't2', title: '옛 기사', link: 'https://a.com/4', published_at: '2026-09-01T00:00:00Z' },
  ];
  const m = buildNewsletterModel(items, { topics, now, schedules: [{ date: '2026-10-16', title: '회의' }, { date: '2026-10-01', title: '지남' }] });
  assert.equal(m.sections[0].name, '무역');
  assert.equal(m.kpis[0].value, 2);
  assert.equal(m.upcoming.length, 1);
  const h = newsletterToHtml(m);
  assert.ok(!h.includes('<img'));
  assert.ok(h.includes('&lt;img'));
  assert.ok(h.includes('오늘의 핵심'));
});
test('newsletter: 위험 링크는 # 처리', () => {
  const m = buildNewsletterModel([{ id: 1, title: 't', link: 'javascript:alert(1)', published_at: new Date().toISOString() }]);
  assert.ok(!newsletterToHtml(m).includes('javascript:'));
});
