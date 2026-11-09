import { serve, launch, login } from './harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// v7.36.0 E2E — 로컬 모드 복사본에서 실행(make-local-copy.sh 참고)
const [root, port] = process.argv.slice(2);
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'v736-shots'); fs.mkdirSync(SHOTS, { recursive: true });
const server = await serve(root, Number(port)); const browser = await launch(); const base = `http://localhost:${port}`;
const errors = []; let fails = 0; const expect = (n, c, d = '') => { if (!c) fails++; console.log(c ? 'ok  ' : 'FAIL', n, c ? '' : d); };
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } }); const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept());
await page.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
const RSS = `<rss><channel><item><title>스마트팜 보조금 안내</title><link>https://ok.example/1</link><pubDate>Mon, 09 Nov 2026 03:00:00 +0900</pubDate></item></channel></rss>`;
await page.route('**/api/custom-proxy**', (r) => {
  const u = decodeURIComponent(new URL(r.request().url()).searchParams.get('url') || '');
  if (!u) return r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"url 필요"}' });
  if (u.includes('ok.example')) return r.fulfill({ status: 200, contentType: 'application/xml', body: RSS });
  if (u.includes('html.example')) return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head><link rel="alternate" type="application/rss+xml" href="/rss.xml"></head></html>' });
  return r.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"HTTP 403"}' });
});
await page.route('**/api/market-proxy**', (r) => r.fulfill({ status: 400, contentType: 'application/json', body: '{}' }));
await page.route('**/api/dart-proxy**', (r) => r.fulfill({ status: 404, contentType: 'text/html', body: 'nf' }));
await page.route('https://api.rss2json.com/**', (r) => r.fulfill({ status: 422, body: '{}' }));
await page.route('https://api.allorigins.win/**', (r) => r.fulfill({ status: 500, body: '' }));
await login(page, base);
const shot = (n) => page.screenshot({ path: path.join(SHOTS, n) });

// ===== 1) 홈 관제 =====
await page.evaluate(() => window.navigate('/')); await page.waitForSelector('.monitor-card');
await page.waitForFunction(() => /연결 관제/.test(document.querySelector('.monitor-card').textContent), null, { timeout: 15000 });
let txt = await page.textContent('.monitor-card');
expect('홈 관제 한 줄 보고(DART 프록시 404 → 문제)', /문제 1/.test(txt), txt);
await page.click('.monitor-card button:has-text("연결 관제")'); await page.waitForTimeout(200);
txt = await page.textContent('.monitor-card');
expect('펼치면 항목별(서버 프록시/DB)', /DART 프록시/.test(txt) && /배포에 포함되지 않았습니다/.test(txt) && /로컬 모드/.test(txt), txt);
await shot('01-home-monitor.png');

// ===== 2) 소스 카드 =====
await page.evaluate(() => window.navigate('/briefing')); await page.waitForSelector('.page-header');
await page.evaluate(async () => {
  const s = window.appState; const uid = s.user.id;
  await s.store.create('briefing_topics', { user_id: uid, name: '스마트팜', include_keywords: ['스마트팜'], exclude_keywords: [], active: true, priority: 5, search_terms: [], priority_keywords: [], site_urls: [] });
  await s.store.create('feed_sources', { user_id: uid, name: '정상RSS', type: 'rss', endpoint: 'https://ok.example/rss', enabled: true });
  await s.store.create('feed_sources', { user_id: uid, name: '막힌곳', type: 'rss', endpoint: 'http://blocked.example/rss', enabled: true });
  await s.store.create('feed_sources', { user_id: uid, name: '게시판주소', type: 'rss', endpoint: 'https://html.example/board', enabled: true });
  await s.refreshAll();
});
await page.click('button:has-text("피드 소스")'); await page.waitForSelector('.source-card');
expect('별도 경고 배너가 없다', (await page.locator('.nm-banner:has-text("확인이 필요한 피드 소스")').count()) === 0);
await page.click('button:has-text("지금 가져오기")'); await page.waitForTimeout(1500);
await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));
await page.click('button:has-text("피드 소스")'); await page.waitForSelector('.source-card');
const blocked = page.locator('.source-card', { hasText: '막힌곳' });
expect('막힌 소스는 카드 안에 원인 표시', /403|접근을 막았습니다/.test(await blocked.locator('.source-card__note').textContent()), await blocked.textContent());
expect('정상 소스에는 진단 노트가 없다', (await page.locator('.source-card', { hasText: '정상RSS' }).locator('.source-card__note').count()) === 0);
expect('수집 이력 표시(7일 성공)', /7일 성공 1\/1/.test(await page.locator('.source-card', { hasText: '정상RSS' }).textContent()));
const saved = await page.evaluate(() => window.appState.briefingItems.length);
expect('정상 소스의 글이 저장됨', saved >= 1, String(saved));
await shot('02-source-cards.png');
// 카드 노트 클릭 → 수정 화면 + 진단 표시
await blocked.locator('.source-card__note-head').click(); await page.waitForSelector('.nm-modal form');
expect('노트 클릭 → 수정 폼(진단 포함)', /접근을 막았습니다|403/.test(await page.textContent('.nm-modal')) && (await page.inputValue('.nm-modal input[name=name]')) === '막힌곳');
await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));
// 게시판 주소 → RSS 주소 찾기
const board = page.locator('.source-card', { hasText: '게시판주소' });
await board.locator('button:has-text("▶")').click(); await page.waitForTimeout(800);
expect('테스트 수집 결과가 카드 안에 표시', (await board.locator('.source-card__test').textContent()).length > 3);
// 테스트 수집은 저장하지 않는다
expect('테스트 수집은 저장하지 않는다', (await page.evaluate(() => window.appState.briefingItems.length)) === saved);
// 소스 종류 API 선택지
await page.click('button:has-text("+ 소스 등록")'); await page.waitForSelector('.nm-modal form');
expect('소스 종류에 공공데이터 API', (await page.locator('.nm-modal select[name=type] option').allInnerTexts()).some((t) => /공공데이터 API/.test(t)));
await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));
// 브리핑 목록: 안 읽음 점 + 검색줄
await page.click('button:has-text("브리핑 목록")'); await page.waitForSelector('.brf-filters');
expect('안 읽음 점 표시', (await page.locator('.unread-dot').count()) >= 1);
await shot('03-items.png');

// ===== 3) 문화생활 포스터 스냅샷 =====
await page.evaluate(() => window.navigate('/playlist')); await page.waitForSelector('.page-header');
await page.click('button:has-text("+ ")'); await page.waitForSelector('.nm-modal form');
expect('스냅샷 붙여넣기 버튼', (await page.locator('.snap-paste').count()) === 1);
await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 400; c.height = 300; const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 400, 300);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const dt = new DataTransfer(); dt.items.add(new File([blob], 'x.png', { type: 'image/png' }));
  document.querySelector('.snap-zone').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});
await page.waitForSelector('.snap-apply', { timeout: 5000 });
const cv = page.locator('.nm-modal canvas').last(); const bb = await cv.boundingBox();
await page.mouse.move(bb.x + 20, bb.y + 20); await page.mouse.down(); await page.mouse.move(bb.x + 150, bb.y + 120, { steps: 5 }); await page.mouse.up();
await shot('04-cropper.png');
await page.click('.snap-apply'); await page.waitForTimeout(400);
const posterVal = await page.inputValue('.nm-modal input[name=poster_url]');
expect('자른 스냅샷이 포스터(JPEG data URL)로 들어간다', /^data:image\/jpeg/.test(posterVal), posterVal.slice(0, 30));
await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));

// ===== 4) 이력 문서 칸막이 =====
await page.evaluate(async () => {
  const s = window.appState; const LIBS = null;
});
expect('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close(); server.close(); console.log(fails ? `FAILED ${fails}` : 'ALL OK'); process.exit(fails ? 1 : 0);
