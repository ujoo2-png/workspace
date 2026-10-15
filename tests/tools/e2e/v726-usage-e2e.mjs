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
// 디자인 레퍼런스 카드(v7.27.0, 외부 API는 가짜 응답)
await page.route('https://api.openverse.org/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ results: [{ id: 'o1', title: 'Dash UI', thumbnail: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', foreign_landing_url: 'https://example.com/o1', creator: 'kim', license: 'by' }, { id: 'o2', title: 'Dash2', thumbnail: 'https://example.com/t2.png', foreign_landing_url: 'https://example.com/o2' }] }) }));
await page.route('https://example.com/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') }));
await page.route('https://image.thum.io/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') }));
await page.evaluate(() => { location.hash = '#/integrations'; }); await page.waitForSelector('#ref-card');
expect('Refero 토큰 입력칸 없음(키 불필요)', (await page.locator('#refero-token').count()) === 0);
await page.fill('#ref-q', 'dashboard'); await page.click('#ref-go'); await page.waitForSelector('#ref-results .ref-item');
expect('Openverse 결과(data: 썸네일은 제외돼 1개)', (await page.locator('#ref-results .ref-item').count()) === 1, String(await page.locator('#ref-results .ref-item').count()));
await page.click('#ref-results .ref-item .ref-pin'); await page.waitForTimeout(200);
expect('📌 저장 → 보드 동기화 키', (await page.evaluate(() => window.settingsSync.get('workspace:refboard'))).includes('Dash2'));
await page.click('[data-tab=gallery]'); await page.fill('#ref-gq', '로그인');
expect('갤러리 링크 12개, 모두 https·새 탭', (await page.locator('#ref-glinks a').count()) === 12 && (await page.locator('#ref-glinks a[target=_blank][rel*=noopener]').count()) === 12);
await page.click('[data-tab=board]'); await page.waitForSelector('#ref-add-url');
await page.fill('#ref-add-url', 'javascript:alert(1)'); await page.click('#ref-add');
expect('위험 주소 거부', /http/.test(await page.locator('#ref-status').innerText()));
await page.fill('#ref-add-url', 'https://example.com/site'); await page.fill('#ref-add-tags', 'saas ui'); await page.click('#ref-add'); await page.waitForTimeout(200);
expect('보드에 2개(검색 저장 + 직접 추가)', (await page.locator('#ref-body .ref-item').count()) === 2);
await page.click('#ref-body [data-del]'); await page.waitForTimeout(150);
expect('삭제 후 1개', (await page.locator('#ref-body .ref-item').count()) === 1);
expect('Are.na 탭 UI', (await page.click('[data-tab=arena]'), (await page.locator('#ref-arena').count()) === 1));

// OpenMAIC 카드(v7.28.0)
await page.click('[data-tab=board]').catch(() => {});
await page.waitForSelector('#maic-card');
expect('OpenMAIC 기본 주소 + 새 탭 링크', /^https:\/\/open\.maic\.chat\/?$/.test(await page.getAttribute('#maic-open', 'href')) && (await page.getAttribute('#maic-open', 'target')) === '_blank');
await page.fill('#maic-url', 'javascript:alert(1)'); await page.click('#maic-save');
expect('위험 주소 거부', /http/.test(await page.locator('#maic-status').innerText()));
await page.fill('#maic-url', 'https://my-maic.vercel.app'); await page.click('#maic-save');
expect('내 주소로 변경', /^https:\/\/my-maic\.vercel\.app\/?$/.test(await page.getAttribute('#maic-open', 'href')));
await page.fill('#maic-title', '<b>물리</b> 1강'); await page.fill('#maic-link', 'https://my-maic.vercel.app/classroom/abc'); await page.click('#maic-add');
expect('수업 링크 저장(태그 제거)', /물리 1강/.test(await page.locator('#maic-card').innerText()) && !/<b>/.test(await page.locator('#maic-card').innerText()));
await page.click('[data-maic-del]'); await page.waitForTimeout(150);
expect('수업 링크 삭제', !/물리 1강/.test(await page.locator('#maic-card').innerText()));
expect('동기화 키 저장(키/토큰 없음)', (await page.evaluate(() => window.settingsSync.get('workspace:openmaic'))).includes('my-maic'));

expect('콘솔 오류 없음', errors.length === 0, errors.join('\n'));
await browser.close(); server.close?.();
console.log(fails ? `${fails} FAIL` : 'ALL OK');
process.exit(fails ? 1 : 0);
