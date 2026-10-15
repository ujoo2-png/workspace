import { serve, launch, login } from './harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// v7.26.0: 사용량 화면(서버 통계는 가짜 RPC로 대체): 카드/한도 대비 %, 클릭 분해, 직접 입력, 메뉴 노출.
const [root, port] = process.argv.slice(2);
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'v726-usage-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const server = await serve(root, Number(port));
const browser = await launch();
const base = `http://localhost:${port}`;
const errors = []; let fails = 0;
const expect = (name, cond, detail = '') => { if (!cond) fails++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : detail); };
const page = await (await browser.newContext({ viewport: { width: 1300, height: 1000 } })).newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept());
await page.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await login(page, base);
expect('메뉴에 사용량', (await page.locator('.nav-item[data-path="/usage"]').count()) === 1);
// 로컬 모드 화면
await page.click('.nav-item[data-path="/usage"]'); await page.waitForTimeout(400);
expect('로컬 모드 안내', /로컬 모드/.test(await page.locator('#view-root').innerText()));
// 서버 통계를 가짜로 주입하고 supabase 화면으로 전환
await page.evaluate(() => {
  window.CONFIG.mode = 'supabase';
  window.getStore().usageStats = async () => ({
    generated_at: new Date().toISOString(), db_bytes: 420 * 1024 * 1024, storage_bytes: 0, users_total: 2, users_active_30d: 1,
    tables: [{ name: 'attachments', bytes: 300 * 1024 * 1024, my_rows: 12 }, { name: 'schedules', bytes: 5 * 1024 * 1024, my_rows: 300 }, { name: 'projects', bytes: 1024 * 1024, my_rows: 4 }],
    attachments_by_owner: [{ owner_table: 'career_documents', bytes: 250 * 1024 * 1024, files: 5 }, { owner_table: 'projects', bytes: 40 * 1024 * 1024, files: 3 }], storage_buckets: [],
  });
  const U = window.UsageService; const d = new Date();
  U.record({ url: 'https://x/rest/v1/schedules', bytes: 3 * 1024 * 1024, menu: '🏠 홈', now: d });
  U.record({ url: 'https://x/rest/v1/projects', bytes: 1 * 1024 * 1024, menu: '📁 프로젝트', now: d });
  location.hash = '#/home';
});
await page.waitForTimeout(200);
await page.click('.nav-item[data-path="/usage"]'); await page.waitForSelector('.usage-card'); await page.waitForTimeout(500);
expect('카드 9개', (await page.locator('.usage-card').count()) === 9);
const dbTxt = await page.locator('[data-metric=db]').innerText();
expect('DB 420 MB / 500 MB 84%', /420 MB/.test(dbTxt) && /500 MB/.test(dbTxt) && /84%/.test(dbTxt), dbTxt);
expect('84% = 주의', (await page.locator('[data-metric=db] .usage-pill--warn').count()) === 1);
expect('70% 초과 경고 배너', /데이터베이스 크기 84%/.test(await page.locator('#usage-hot').innerText()));
expect('이그레스 4 MB 추정', /4\.00 MB/.test(await page.locator('[data-metric=egress]').innerText()), await page.locator('[data-metric=egress]').innerText());
expect('로그 수집은 한도 미설정', /한도 미설정/.test(await page.locator('[data-metric=logIngestion]').innerText()));
await page.screenshot({ path: path.join(SHOTS, 'usage.png') });
// 클릭 → DB 분해(메뉴별: 이력/경력 첨부가 가장 큼)
await page.click('[data-metric=db]'); await page.waitForSelector('.nm-modal .usage-rows');
const modalTxt = await page.locator('.nm-modal').innerText();
expect('DB 분해: 이력/경력(양식) 첨부 표시', /이력\/경력\(양식\) · 첨부파일/.test(modalTxt) && /일정/.test(modalTxt), modalTxt.slice(0, 300));
await page.screenshot({ path: path.join(SHOTS, 'usage-db-detail.png') });
await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));
// 이그레스 분해
await page.click('[data-metric=egress]'); await page.waitForSelector('.nm-modal .usage-kv');
const eg = await page.locator('.nm-modal').innerText();
expect('이그레스 분해: 메뉴/테이블/오늘', /일정/.test(eg) && /schedules/.test(eg) && /오늘/.test(eg));
await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));
// 직접 입력: 이그레스 실제값 4.5GB
await page.click('[data-metric=egress] .usage-edit'); await page.waitForSelector('#usage-val');
await page.fill('#usage-val', '4.5GB'); await page.click('#usage-save'); await page.waitForTimeout(300);
const egt = await page.locator('[data-metric=egress]').innerText();
expect('직접 입력 4.5GB → 90% 위험', /4\.50 GB/.test(egt) && (await page.locator('[data-metric=egress] .usage-pill--danger').count()) === 1, egt);
expect('직접 입력 저장 + 표시', /직접 입력/.test(egt));
// 한도 직접 입력(로그 조회 2GB) + 값 0.5GB
await page.click('[data-metric=logQuery] .usage-edit'); await page.waitForSelector('#usage-val');
await page.fill('#usage-val', '0.5GB'); await page.fill('#usage-lim', '2GB'); await page.click('#usage-save'); await page.waitForTimeout(300);
expect('로그 조회 0.5GB/2GB 25%', /25%/.test(await page.locator('[data-metric=logQuery]').innerText()), await page.locator('[data-metric=logQuery]').innerText());
expect('설정 동기화 키 저장', (await page.evaluate(() => window.settingsSync.get('workspace:usage:manual'))).includes('logQuery'));
// Refero 카드(프록시는 가짜 응답)
await page.route('**/api/refero', async (r) => {
  const b = JSON.parse(r.request().postData() || '{}'); const tok = r.request().headers()['x-refero-token'];
  if (tok !== 'tok-abcdefgh') return r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: '토큰이 올바르지 않거나 만료되었습니다' }) });
  const result = b.action === 'tools' ? { tools: [{ name: 'search_screens', inputSchema: { properties: { query: {} } } }] } : { content: [{ type: 'text', text: `결과 ${b.args.query} https://example.com/a.png` }] };
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, result }) });
});
await page.evaluate(() => { location.hash = '#/integrations'; }); await page.waitForSelector('#refero-card');
await page.fill('#refero-token', 'bad-token-xx'); await page.click('#refero-save'); await page.click('#refero-test'); await page.waitForTimeout(400);
expect('잘못된 토큰 → 오류 표시', /토큰이 올바르지 않/.test(await page.locator('#refero-status').innerText()));
await page.fill('#refero-token', 'tok-abcdefgh'); await page.click('#refero-save'); await page.click('#refero-test'); await page.waitForTimeout(400);
expect('연결됨 + 도구 목록', /연결됨/.test(await page.locator('#refero-status').innerText()) && /search_screens/.test(await page.locator('#refero-results').innerText()));
await page.fill('#refero-q', '대시보드'); await page.click('#refero-go'); await page.waitForTimeout(500);
expect('검색 결과(이미지/텍스트)', (await page.locator('#refero-results img').count()) === 1 && /결과 대시보드/.test(await page.locator('#refero-results').innerText()));
expect('토큰은 DB 동기화 키가 아님', !(await page.evaluate(() => window.settingsSync.SYNCED_KEYS.includes('workspace:refero:token'))));

expect('콘솔 오류 없음', errors.length === 0, errors.join('\n'));
await browser.close(); server.close?.();
console.log(fails ? `${fails} FAIL` : 'ALL OK');
process.exit(fails ? 1 : 0);
