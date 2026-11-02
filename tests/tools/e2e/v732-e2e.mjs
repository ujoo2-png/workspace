import { serve, launch, login } from './harness.mjs';
// v7.32.0: 다이어그램 스튜디오(/diagrams), 메뉴별 📐 버튼, 설정 저장, 가져오기, 내보내기.
const [root, port] = process.argv.slice(2);
const server = await serve(root, Number(port)); const browser = await launch(); const base = `http://localhost:${port}`;
const errors = []; let fails = 0;
const expect = (n, c, d = '') => { if (!c) fails++; console.log(c ? 'ok  ' : 'FAIL', n, c ? '' : d); };
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true }); const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource|ERR_/.test(m.text())) errors.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept());
await page.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await page.route('**/fonts.googleapis.com/**', (r) => r.abort());
await login(page, base);
await page.evaluate(async () => { const s = window.appState; const a = await s.addBrokerageAccount({ broker: 'KB증권', currency: 'KRW' }); await s.addStockHolding({ account_id: a.id || s.brokerageAccounts[0].id, market: 'KRX', symbol: '005930', name: '삼성전자', quantity: 10, avg_price: 70000, currency: 'KRW' }); });

// 1) 사이드바 + 스튜디오
expect('사이드바에 다이어그램 메뉴', (await page.locator('.nav-item[data-path="/diagrams"]').count()) === 1);
await page.click('.nav-item[data-path="/diagrams"]'); await page.waitForSelector('.dg-card2', { timeout: 5000 });
expect('카드 45개', (await page.locator('.dg-card2').count()) === 45, String(await page.locator('.dg-card2').count()));
expect('썸네일 SVG 45개', (await page.locator('.dg-card2__thumb svg').count()) === 45);
expect('스튜디오 화면엔 📐 메뉴 버튼 없음', (await page.locator('#view-root [data-dg-btn]').count()) === 0);
await page.screenshot({ path: '/tmp/e2e-studio.png' });
// 필터·검색
await page.click('.dg-filter button:nth-child(2)'); const n2 = await page.locator('.dg-card2').count(); expect('가족 필터', n2 > 0 && n2 < 45, String(n2));
await page.click('.dg-filter button:nth-child(1)'); await page.fill('.dg-filter input', '생키'); await page.waitForTimeout(200); expect('검색', (await page.locator('.dg-card2').count()) === 1);
await page.fill('.dg-filter input', '');
// 2) 샘플 보기
await page.locator('.dg-card2 .nm-btn--primary').first().click(); await page.waitForSelector('.dg-stage svg', { timeout: 5000 });
expect('샘플 모달에 SVG', (await page.locator('.dg-stage svg').count()) === 1);
expect('설명 표시', /언제 쓰나/.test(await page.locator('.dg-meta').innerText()));
// 내보내기
for (const [lab, ext] of [['SVG', 'svg'], ['HTML', 'html'], ['JSON', 'json'], ['PNG', 'png']]) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.locator('.dg-exp button', { hasText: lab }).first().click()]);
  expect(`내보내기 ${lab}`, !!dl && dl.suggestedFilename().endsWith('.' + ext), dl ? dl.suggestedFilename() : 'no download');
}
// 데이터 편집
await page.locator('.dg-det summary', { hasText: '데이터' }).click();
const val = await page.locator('.dg-edit').inputValue(); const j = JSON.parse(val); j.title = '내가 고친 제목'; await page.fill('.dg-edit', JSON.stringify(j)); await page.click('text=데이터 적용'); await page.waitForTimeout(200);
expect('데이터 편집 반영', /내가 고친 제목/.test(await page.locator('.dg-stage').innerText()));
// 설정 변경 → 저장
await page.locator('.dg-det summary', { hasText: '설정' }).last().click();
const sk = page.locator('.nm-modal .dg-sethost select').first(); await sk.selectOption('dark'); await page.waitForTimeout(250);
const saved = await page.evaluate(() => JSON.parse(window.settingsSync.get('workspace:diagram:settings') || '{}'));
expect('설정 저장(skin=dark)', saved.skin === 'dark', JSON.stringify(saved));
expect('다크 스킨 반영', /#14161c|#1c1f27|#0f|rgb\(|#[0-2]/i.test(await page.locator('.dg-stage svg').innerHTML().then((h) => h.slice(0, 2000))));
await page.locator('.nm-modal .dg-sethost select').nth(1).selectOption('full'); await page.waitForTimeout(200);
expect('풀 레이아웃(요약 카드)', (await page.locator('.dg-cards').count()) === 1);
// 프로필 저장
await page.fill('.nm-modal .dg-set__prof input', '발표용'); await page.locator('.nm-modal .dg-set__prof button', { hasText: '현재 설정 저장' }).click(); await page.waitForTimeout(200);
expect('프로필 저장', await page.evaluate(() => !!JSON.parse(window.settingsSync.get('workspace:diagram:profiles') || '{}')['발표용']));
await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));
// 3) 내 데이터로
await page.waitForTimeout(200);
const mine = page.locator('.dg-card2', { hasText: '트리맵' }).locator('button', { hasText: '내 데이터로' }); expect('트리맵 내 데이터로 활성', !(await mine.isDisabled()));
await mine.click(); await page.waitForSelector('.dg-stage svg'); expect('내 데이터 트리맵에 삼성전자', /삼성전자/.test(await page.locator('.dg-stage').innerText()));
await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));
// 4) 가져오기
await page.click('text=가져오기'); await page.fill('.nm-modal textarea', 'flowchart LR\nA[시작] --> B{맞나?}\nB -->|예| C[끝]'); await page.click('.nm-modal >> text=그리기'); await page.waitForSelector('.nm-modal .dg-stage svg', { timeout: 5000 });
expect('Mermaid 가져오기', /맞나/.test(await page.locator('.nm-modal .dg-stage').innerText()) && /옮겼습니다/.test(await page.locator('.nm-modal').innerText()));
await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));
// 5) 모든 메뉴의 📐 버튼
const paths = await page.evaluate(() => window.NAV_ITEMS.map((n) => n.path).filter((p) => !['/diagrams'].includes(p)));
const missing = [];
for (const p of paths) {
  await page.click(`.nav-item[data-path="${p}"]`); await page.waitForTimeout(450);
  await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));
  const b = page.locator('#view-root [data-dg-btn]'); const c = await b.count(); if (c !== 1) { missing.push(`${p}:${c}`); continue; }
  await b.click(); const ok = await page.waitForSelector('.nm-modal .dg-stage svg, .nm-modal .dg-note', { timeout: 4000 }).then(() => true).catch(() => false);
  if (!ok) missing.push(`${p}:modal`);
  await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));
}
expect('모든 메뉴 📐 버튼·모달 동작', missing.length === 0, missing.join(','));
// 증권 모달에 내 데이터
await page.click('.nav-item[data-path="/stocks"]'); await page.waitForTimeout(500); await page.click('#view-root [data-dg-btn]'); await page.waitForSelector('.nm-modal .dg-stage svg');
expect('증권 모달: 내 종목 반영', /삼성전자/.test(await page.locator('.nm-modal .dg-stage').innerText()));
await page.screenshot({ path: '/tmp/e2e-stocks-modal.png' });
expect('콘솔 오류 없음', errors.length === 0, errors.join('\n'));
await browser.close(); server.close(); console.log(fails ? `FAIL ${fails}` : 'ALL PASS'); process.exit(fails ? 1 : 0);
