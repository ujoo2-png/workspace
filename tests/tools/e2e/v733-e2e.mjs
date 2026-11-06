import { serve, launch, login } from './harness.mjs';
// v7.33.0: 등록 팝업(처음부터 첨부) · 루틴 · 로그인 미진 팝업 · 자산 추이 · 주간 브리핑 · 공급자 설정 유지 · DART 설정.
const [root, port] = process.argv.slice(2);
const server = await serve(root, Number(port)); const browser = await launch(); const base = `http://localhost:${port}`;
const errors = []; let fails = 0;
const expect = (n, c, d = '') => { if (!c) fails++; console.log(c ? 'ok  ' : 'FAIL', n, c ? '' : d); };
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } }); const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource|ERR_/.test(m.text())) errors.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept());
await page.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await page.route('**/fonts.googleapis.com/**', (r) => r.abort());
await login(page, base);

// 1) 신규 등록 팝업에 처음부터 첨부 영역 + 저장 시 함께 첨부
await page.evaluate(() => window.navigate('/devlog')); await page.waitForSelector('.page-header');
await page.click('text=+ 기록'); await page.waitForSelector('.nm-modal');
expect('Devlog 신규 팝업에 첨부 영역이 처음부터 보임', (await page.locator('.nm-modal .attach-panel--pending').count()) === 1);
await page.fill('.nm-modal input[name="title"]', '첨부 테스트');
await page.setInputFiles('.nm-modal input[type="file"]', { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
await page.click('.nm-modal button[type="submit"]'); await page.waitForTimeout(800);
const att = await page.evaluate(() => Object.values(window.appState.attachmentsByOwner).flat().length);
expect('저장하면 담은 파일이 함께 첨부됨', att === 1, String(att));
await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));

// 2) 루틴 등록 + 미진 판정 + 로그인 팝업
await page.evaluate(() => window.navigate('/routines')); await page.waitForSelector('.page-header');
await page.click('text=+ 루틴 추가'); await page.waitForSelector('.nm-modal');
await page.fill('.nm-modal input[name="title"]', '영어 30분');
await page.evaluate(() => { const d = new Date(Date.now() - 4 * 86400000); document.querySelector('.nm-modal input[type="date"]').value = d.toISOString().slice(0, 10); });
await page.click('.nm-modal button[type="submit"]'); await page.waitForTimeout(600);
const sum = await page.evaluate(() => { const s = window.routineSummary(); return { overdue: s.overdue.length, n: window.appState.routines.length }; });
expect('루틴 저장·미진 감지(4일 전 시작, 기록 없음)', sum.n === 1 && sum.overdue === 1, JSON.stringify(sum));
expect('루틴 화면에 항목 표시', (await page.locator('.rt-line').count()) >= 1);
await page.screenshot({ path: '/tmp/e2e-routines.png' });
await page.reload({ waitUntil: 'load' }); await page.waitForSelector('.briefing-modal', { timeout: 8000 });
expect('로그인 팝업에 미진한 루틴 섹션', (await page.locator('.briefing-modal').innerText()).includes('미진한 루틴'));
await page.screenshot({ path: '/tmp/e2e-login.png' });
await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));
// 홈 위젯 → 상세
await page.evaluate(() => window.navigate('/')); await page.waitForTimeout(600);
expect('홈에 루틴 위젯', (await page.locator('text=🔁').count()) >= 1);

// 3) 증권 자산 추이 카드 (스냅샷 직접 주입)
await page.evaluate(async () => {
  const s = window.appState; const a = await s.addBrokerageAccount({ broker: 'KB증권', currency: 'KRW' });
  await s.addStockHolding({ account_id: a.id || s.brokerageAccounts[0].id, market: 'KRX', symbol: '005930', name: '삼성전자', quantity: 10, avg_price: 70000, currency: 'KRW' });
  const d = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  await s.saveAssetSnapshot({ snap_date: d(3), total_value: 700000, total_cost: 700000, holdings_count: 1, evaluated_count: 1, source: 'live', detail: [] });
  await s.saveAssetSnapshot({ snap_date: d(2), total_value: 730000, total_cost: 700000, holdings_count: 1, evaluated_count: 1, source: 'backfill', detail: [] });
  await s.saveAssetSnapshot({ snap_date: d(1), total_value: 720000, total_cost: 700000, holdings_count: 1, evaluated_count: 1, source: 'live', detail: [] });
});
await page.evaluate(() => window.navigate('/stocks')); await page.waitForSelector('.asset-card', { timeout: 6000 });
const t = await page.locator('.asset-trend', { hasText: '자산 추이' }).first().innerText();
expect('자산 추이 카드·전일대비', t.includes('자산 추이') && t.includes('전일 대비') && t.includes('-10,000원'), t.slice(0, 160));
expect('추정(backfill) 표시', t.includes('추정'));
await page.screenshot({ path: '/tmp/e2e-trend.png' });

// 4) 주간 브리핑 모달
await page.evaluate(() => { window.appState.weeklyBriefings = [{ week_start: '2026-11-02', content: window.WeeklyBriefing.build(window.appState, { weekStart: '2026-11-02', friday: '2026-11-06' }) }]; window.navigate('/routines'); });
await page.waitForSelector('.page-header'); await page.click('text=🗓️ 주간 브리핑'); await page.waitForSelector('.nm-modal');
await page.click('.nm-modal button:has-text("주 요약")'); await page.waitForTimeout(300);
expect('주간 요약 모달', (await page.locator('.nm-modal').last().innerText()).includes('루틴 달성'));
await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));

// 5) 공급자 설정이 새로고침(로그인) 후에도 유지 + DART 키 UI
await page.evaluate(() => window.navigate('/settings')); await page.waitForSelector('text=증권 시세 API');
await page.evaluate(() => { window.setStockProvider('naver'); });
await page.reload({ waitUntil: 'load' }); await page.waitForSelector('.app-shell');
const prov = await page.evaluate(() => window.getStockProvider ? window.getStockProvider() : null);
expect('공급자 naver가 새로고침 후에도 유지', prov === 'naver', String(prov));
const dk = await page.evaluate(() => { window.DartService.setKey('a'.repeat(40)); return [window.DartService.hasDartKey(), window.settingsSync.get('workspace:stocks:dartKey').length]; });
expect('DART 키가 settingsSync에 저장', dk[0] === true && dk[1] === 40, JSON.stringify(dk));

expect('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close(); server.close();
console.log(fails ? `FAILED ${fails}` : 'ALL OK'); process.exit(fails ? 1 : 0);
