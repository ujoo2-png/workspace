// v7.27.0 디자인 레퍼런스(RefService) — 가짜 fetch/settingsSync로 검증
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mem = {};
globalThis.settingsSync = { get: (k) => (k in mem ? mem[k] : null), set: (k, v) => { mem[k] = v; } };
let lastUrl = '', reply = { ok: true, status: 200, json: async () => ({}) };
globalThis.fetch = async (u) => { lastUrl = String(u); return reply; };
(0, eval)(fs.readFileSync(path.join(__dirname, '../js/services/refService.js'), 'utf8') + '\n;globalThis.RefService=globalThis.RefService||window.RefService;');
const R = globalThis.RefService;
const ok = (j) => { reply = { ok: true, status: 200, json: async () => j }; };

test('safeUrl: http(s)만 허용', () => {
  assert.equal(R.safeUrl('javascript:alert(1)'), ''); assert.equal(R.safeUrl('data:text/html,x'), '');
  assert.equal(R.safeUrl('ftp://a.b/c'), ''); assert.equal(R.safeUrl('not a url'), '');
  assert.equal(R.safeUrl('https://a.b/c d'), 'https://a.b/c%20d');
});
test('Openverse 파싱 + 위험 URL 항목 제외', async () => {
  ok({ results: [
    { id: 'a', title: 'Dash <b>UI</b>', thumbnail: 'https://t/1.jpg', foreign_landing_url: 'https://l/1', creator: 'kim', license: 'by' },
    { id: 'b', title: 'bad', thumbnail: 'javascript:alert(1)' },
  ] });
  const r = await R.searchOpenverse('dash board', 2);
  assert.match(lastUrl, /api\.openverse\.org\/v1\/images\/\?q=dash%20board&page_size=24&page=2/);
  assert.equal(r.length, 1); assert.equal(r[0].title, 'Dash UI'); assert.equal(r[0].license, 'CC BY'); assert.equal(r[0].link, 'https://l/1');
});
test('Commons 파싱(순서·확장 메타)', async () => {
  ok({ query: { pages: {
    2: { pageid: 2, index: 2, title: 'File:B.png', imageinfo: [{ thumburl: 'https://c/b.png', descriptionurl: 'https://c/B' }] },
    1: { pageid: 1, index: 1, title: 'File:A.png', imageinfo: [{ thumburl: 'https://c/a.png', descriptionurl: 'https://c/A', extmetadata: { Artist: { value: '<a>lee</a>' }, LicenseShortName: { value: 'CC0' } } }] },
    3: { pageid: 3, index: 3, title: 'File:C.png' },
  } } });
  const r = await R.searchCommons('ui');
  assert.match(lastUrl, /origin=\*/); assert.deepEqual(r.map((x) => x.title), ['A.png', 'B.png']); assert.equal(r[0].by, 'lee'); assert.equal(r[0].license, 'CC0');
});
test('Are.na: 슬러그 파싱·검증·이미지 블록만', async () => {
  assert.equal(R.parseArenaSlug('https://www.are.na/kim/ui-refs'), 'ui-refs'); assert.equal(R.parseArenaSlug('ui-refs'), 'ui-refs');
  assert.equal(R.parseArenaSlug('https://evil.com/kim/x'), ''); assert.equal(R.parseArenaSlug('a/b?x=1'), ''); assert.equal(R.parseArenaSlug(''), '');
  await assert.rejects(() => R.arenaChannel('https://evil.com/x/y'), /올바르지/);
  ok({ title: 'UI', length: 5, contents: [{ id: 1, title: 'x', image: { display: { url: 'https://a/1.jpg' } }, source: { url: 'https://site/1' }, user: { username: 'kim' } }, { id: 2, class: 'Text' }] });
  const r = await R.arenaChannel('https://www.are.na/kim/ui-refs');
  assert.match(lastUrl, /api\.are\.na\/v2\/channels\/ui-refs\/contents/); assert.equal(r.items.length, 1); assert.equal(r.total, 5); assert.equal(r.items[0].link, 'https://site/1');
});
test('HTTP 오류 메시지', async () => {
  reply = { ok: false, status: 429, json: async () => ({}) }; await assert.rejects(() => R.searchOpenverse('x'), /너무 많아요/);
  reply = { ok: false, status: 404, json: async () => ({}) }; await assert.rejects(() => R.arenaChannel('nope'), /찾을 수 없어요/);
});
test('갤러리 링크: 키워드 인코딩, site: 검색', () => {
  assert.deepEqual(R.galleryLinks('  '), []);
  const l = R.galleryLinks('로그인 화면'); const dr = l.find((x) => x.id === 'dribbble'); const mb = l.find((x) => x.id === 'mobbin');
  assert.equal(dr.url, 'https://dribbble.com/search/' + encodeURIComponent('로그인 화면'));
  assert.match(mb.url, /google\.com\/search\?q=.*site%3Amobbin\.com/); assert.ok(l.every((x) => /^https:\/\//.test(x.url)));
});
test('보드: 추가/중복/태그/수정/삭제/상한/위험 URL', () => {
  assert.throws(() => R.addToBoard({ link: 'javascript:1' }), /http/);
  const a = R.addToBoard({ title: '<i>A</i>', link: 'https://a.com/', img: R.screenshotUrl('https://a.com/'), tags: '#ui, 대시보드 ui' });
  assert.ok(a.added); assert.equal(a.item.title, 'A'); assert.deepEqual(a.item.tags, ['ui', '대시보드']);
  assert.equal(R.addToBoard({ link: 'https://a.com/' }).added, false);
  R.updateBoard(a.item.id, { note: '메모', tags: 'x y' }); assert.deepEqual(R.getBoard()[0].tags, ['x', 'y']); assert.equal(R.getBoard()[0].note, '메모');
  R.removeFromBoard(a.item.id); assert.equal(R.getBoard().length, 0);
  for (let i = 0; i < R.MAX_BOARD; i++) R.addToBoard({ link: `https://s.com/${i}` });
  assert.throws(() => R.addToBoard({ link: 'https://s.com/over' }), /최대/);
  mem[R.BOARD_KEY] = '{bad'; assert.deepEqual(R.getBoard(), []);
  mem[R.BOARD_KEY] = JSON.stringify([{ id: 'z', link: 'javascript:1' }, { id: 'y', link: 'https://ok.com' }]); assert.equal(R.getBoard().length, 1);
});
