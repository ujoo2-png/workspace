import { serve, launch, login } from './harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// v7.37.0 E2E — 로컬 모드 복사본에서 실행(make-local-copy.sh 참고)
const [root, port] = process.argv.slice(2);
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'v737-shots'); fs.mkdirSync(SHOTS, { recursive: true });
const server = await serve(root, Number(port)); const browser = await launch(); const base = `http://localhost:${port}`;
const errors = []; let fails = 0; const expect = (n, c, d = '') => { if (!c) fails++; console.log(c ? 'ok  ' : 'FAIL', n, c ? '' : d); };
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } }); const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept());
await page.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await page.route('**/api/*proxy**', (r) => r.fulfill({ status: 400, contentType: 'application/json', body: '{}' }));
// 가짜 MoneyPrinterTurbo 서버(127.0.0.1:8080) — CORS 허용 + 작업 진행
let polls = 0; let posted = null;
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
await page.route('http://127.0.0.1:8080/**', async (r) => {
  const req = r.request(); const u = new URL(req.url());
  if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
  if (u.pathname === '/ping') return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '"pong"' });
  if (u.pathname === '/api/v1/tasks') return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"status":200,"data":{"tasks":[],"total":0}}' });
  if (u.pathname === '/api/v1/videos' && req.method() === 'POST') { posted = JSON.parse(req.postData() || '{}'); return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"status":200,"data":{"task_id":"t-1"}}' }); }
  if (u.pathname === '/api/v1/tasks/t-1') { polls++; const done = polls >= 2; return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ status: 200, data: done ? { state: 1, progress: 100, videos: ['/tasks/t-1/final-1.mp4'] } : { state: 4, progress: 40 } }) }); }
  if (u.pathname.startsWith('/tasks/')) return r.fulfill({ status: 200, headers: cors, contentType: 'video/mp4', body: '' });
  return r.fulfill({ status: 404, headers: cors, body: '' });
});
await login(page, base);
const shot = (n) => page.screenshot({ path: path.join(SHOTS, n), fullPage: true });
const closeModals = () => page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));

// ===== 1) 차량: 중복 카드 병합 + 3열 그래프 =====
const today = new Date(); const iso = (d) => d.toLocaleDateString('sv-SE'); const dAgo = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return iso(d); };
await page.evaluate(async ({ d0, d1, d2, d3 }) => {
  const s = window.appState; const uid = s.user.id;
  const a = await s.store.create('vehicles', { user_id: uid, name: '아반떼', plate_number: '12가3456', year: 2021, fuel_type: 'gasoline', insurance_expiry: '2027-01-01' });
  const b = await s.store.create('vehicles', { user_id: uid, name: '아반떼 CN7', plate_number: '12가 3456', model: 'CN7', fuel_type: 'gasoline', registration_expiry: '2027-05-01' });
  const same = { service_date: d3, item: '엔진오일', odometer: 10000, cost: 80000 };
  await s.store.create('vehicle_maintenance', { vehicle_id: a.id, ...same });
  await s.store.create('vehicle_maintenance', { vehicle_id: b.id, ...same }); // 완전 동일 → 정리
  await s.store.create('vehicle_maintenance', { vehicle_id: b.id, service_date: d2, item: '타이어', odometer: 11000, cost: 400000 });
  await s.store.create('vehicle_fuel_logs', { vehicle_id: a.id, logged_at: d3, odometer: 10000, amount: 40, cost: 70000 });
  await s.store.create('vehicle_fuel_logs', { vehicle_id: b.id, logged_at: d2, odometer: 10500, amount: 40, cost: 72000 });
  await s.store.create('vehicle_fuel_logs', { vehicle_id: b.id, logged_at: d1, odometer: 11000, amount: 45, cost: 81000 });
  await s.store.create('vehicle_odometer_logs', { vehicle_id: b.id, logged_at: d0, odometer: 11300 });
  await s.refreshAll();
}, { d0: dAgo(1), d1: dAgo(5), d2: dAgo(10), d3: dAgo(20) });
await page.evaluate(() => window.navigate('/vehicles')); await page.waitForSelector('.vehicle-dup-banner');
expect('중복 안내 배너', /12가3456 카드가 2개/.test(await page.textContent('.vehicle-dup-banner')));
expect('합치기 전 카드 2개', (await page.locator('.nm-card[data-rid]').count()) === 2);
await page.click('.vehicle-dup-banner button'); await page.waitForSelector('.nm-modal');
const mtxt = await page.textContent('.nm-modal');
expect('미리보기: 기록이 많은 카드가 대표 → 옮길 기록 1건 / 중복 1건 정리', /옮길 기록 1건/.test(mtxt) && /중복 기록 1건/.test(mtxt), mtxt.replace(/\s+/g, ' ').slice(0, 400));
await shot('01-merge-preview.png');
await page.click('.nm-modal button:has-text("합치기")'); await page.waitForTimeout(800); await closeModals();
const after = await page.evaluate(() => { const s = window.appState; const live = s.vehicles.filter((v) => !v.deleted_at); const v = live[0]; return { n: live.length, name: v && v.name, model: v && v.model, ins: v && v.insurance_expiry, reg: v && v.registration_expiry, maint: (s.maintenanceByVehicle[v.id] || []).length, fuel: (s.fuelLogsByVehicle[v.id] || []).length, odo: (s.odometerLogsByVehicle[v.id] || []).length }; });
expect('카드가 1개로 합쳐짐', after.n === 1, JSON.stringify(after));
expect('정비 2건(동일 1건만 정리) · 주유 3건 · 주행 1건 보존', after.maint === 2 && after.fuel === 3 && after.odo === 1, JSON.stringify(after));
expect('빈 칸 보완(모델·등록 만료일), 기존 값 유지(보험)', after.model === 'CN7' && after.reg === '2027-05-01' && after.ins === '2027-01-01', JSON.stringify(after));
await page.waitForSelector('.vehicle-chart-grid');
expect('배너가 사라짐', (await page.locator('.vehicle-dup-banner').count()) === 0);
const cols = await page.evaluate(() => getComputedStyle(document.querySelector('.vehicle-chart-grid')).gridTemplateColumns.split(' ').length);
expect('그래프 그리드가 가로 3열', cols === 3, String(cols));
expect('지표 카드 6개', (await page.locator('.vehicle-chart-card').count()) === 6);
expect('차트 킷 적용(툴바/차트)', (await page.locator('.vehicle-chart-card .ck-card, .vehicle-chart-card svg').count()) >= 4);
await page.click('.vehicle-chart-card[data-metric="fuelCost"] button:has-text("월간")'); await page.waitForTimeout(300);
expect('카드별 기간 버튼이 독립 동작', (await page.locator('.vehicle-chart-card[data-metric="fuelCost"] .nm-btn--primary:has-text("월간")').count()) === 1 && (await page.locator('.vehicle-chart-card[data-metric="odo"] .nm-btn--primary:has-text("최근 10개")').count()) === 1);
await shot('02-vehicle-dashboard.png');
await page.click('button:has-text("+ 차량 등록")'); await page.waitForSelector('.nm-modal form');
await page.fill('.nm-modal input[name=name]', '또 아반떼'); await page.fill('.nm-modal input[name=plate_number]', '12가-3456'); await page.click('.nm-modal button[type=submit]'); await page.waitForTimeout(400);
expect('같은 번호 신규 등록은 막힘', (await page.evaluate(() => window.appState.vehicles.filter((v) => !v.deleted_at).length)) === 1);
await closeModals();

// ===== 2) 브리핑: 조회 버튼 + 최근 검색어 =====
await page.evaluate(async () => {
  const s = window.appState; const uid = s.user.id;
  const t = await s.store.create('briefing_topics', { user_id: uid, name: '스마트팜', include_keywords: ['스마트팜'], exclude_keywords: [], active: true, priority: 5, search_terms: [], priority_keywords: [], site_urls: [] });
  const src = await s.store.create('feed_sources', { user_id: uid, name: 'RSS', type: 'rss', endpoint: 'https://x.example/rss', enabled: true });
  const mk = (i, title) => s.store.create('briefing_items', { user_id: uid, topic_id: t.id, source_id: src.id, title, link: `https://x.example/${i}`, summary: '', item_hash: 'h' + i, published_at: new Date().toISOString(), is_read: false });
  await mk(1, '스마트팜 보조금 안내'); await mk(2, '기타 소식'); await s.refreshAll();
});
await page.evaluate(() => window.navigate('/briefing')); await page.waitForSelector('.page-header');
await page.click('button:has-text("브리핑 목록")'); await page.waitForSelector('.brf-go');
const before = await page.locator('.item-row').count();
await page.fill('.brf-q', '보조금'); await page.waitForTimeout(600);
expect('입력만으로는 조회되지 않는다', (await page.locator('.item-row').count()) === before);
await page.click('.brf-go'); await page.waitForTimeout(400);
expect('[조회]를 누르면 필터가 적용됨', (await page.locator('.item-row').count()) === 1);
expect('최근 검색어 칩 생성', (await page.locator('.brf-recent__chip').count()) === 1);
for (const q of ['검색2', '검색3', '검색4', '검색5', '검색6', '검색7', '검색8', '검색9', '검색10', '검색11', '검색12']) { await page.fill('.brf-q', q); await page.press('.brf-q', 'Enter'); await page.waitForTimeout(80); }
expect('최근 검색어는 최대 10개', (await page.locator('.brf-recent__chip').count()) === 10);
expect('가장 최근 검색어가 맨 앞', (await page.locator('.brf-recent__txt').first().textContent()) === '검색12');
await page.locator('.brf-recent__chip', { hasText: '검색11' }).locator('.brf-recent__x').click(); await page.waitForTimeout(200);
expect('× 로 검색어 삭제', (await page.locator('.brf-recent__chip').count()) === 9 && (await page.locator('.brf-recent__chip', { hasText: '검색11' }).count()) === 0);
await shot('03-briefing-search.png');

// ===== 3) 프로그램 > 홍보 영상 =====
await page.evaluate(async () => { const s = window.appState; await s.store.create('programs', { user_id: s.user.id, name: '대부도 스마트팜', url: 'https://daebudo.example', description: '과수원 센서 데이터를 한곳에서 확인합니다.' }); await s.refreshAll(); });
await page.evaluate(() => window.navigate('/programs')); await page.waitForSelector('.quick-tabs');
await page.click('.quick-tab:has-text("홍보 영상")'); await page.waitForSelector('.promo-make');
await page.selectOption('.promo-prog', { label: '대부도 스마트팜' });
expect('프로그램 선택 → 주제 자동 입력', (await page.inputValue('.promo-subject')) === '대부도 스마트팜');
await page.fill('.promo-aud', '과수 농가'); await page.fill('.promo-feat', '실시간 알림, 모바일 지원');
await page.click('.promo-draft');
const scr = await page.inputValue('.promo-script');
expect('대본 초안 생성(여러 줄)', scr.split('\n').length >= 5 && /대부도 스마트팜/.test(scr), scr);
await page.click('.promo-check'); await page.waitForFunction(() => document.querySelector('.promo-status').dataset.state, null, { timeout: 8000 });
expect('연결 확인: 사용 가능', (await page.getAttribute('.promo-status', 'data-state')) === 'ready', await page.textContent('.promo-status'));
await page.click('.promo-make'); await page.waitForSelector('.promo-job');
expect('요청 본문: 주제·키워드·세로·한국어 음성', posted && posted.video_subject === '대부도 스마트팜' && posted.video_aspect === '9:16' && Array.isArray(posted.video_terms) && /ko-KR/.test(posted.voice_name || ''), JSON.stringify(posted));
await page.waitForSelector('.promo-job--done video', { timeout: 15000 });
expect('완료되면 영상이 표시됨', /127\.0\.0\.1:8080\/tasks\/t-1\/final-1\.mp4/.test(await page.getAttribute('.promo-job--done video', 'src')));
await shot('04-promo.png');
await page.fill('.promo-api', 'http://127.0.0.1:9'); await page.click('.promo-check');
await page.waitForFunction(() => /응답이 없습니다|CORS|허용/.test(document.querySelector('.promo-status').textContent), null, { timeout: 12000 });
expect('서버가 꺼져 있으면 원인을 안내', /응답이 없습니다|CORS|허용/.test(await page.textContent('.promo-status')));
expect('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close(); server.close(); console.log(fails ? `FAILED ${fails}` : 'ALL OK'); process.exit(fails ? 1 : 0);
