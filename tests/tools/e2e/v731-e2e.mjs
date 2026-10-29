import { serve, launch, login } from './harness.mjs';
// v7.31.0: 드래그 순서변경(프로그램·증권·브리핑), 네이버 시세(가짜 응답), 보유종목 클릭 상세, 환율 기간 차트.
const [root, port] = process.argv.slice(2);
const server = await serve(root, Number(port));
const browser = await launch();
const base = `http://localhost:${port}`;
const errors = []; let fails = 0;
const expect = (n, c, d = '') => { if (!c) fails++; console.log(c ? 'ok  ' : 'FAIL', n, c ? '' : d); };
const page = await (await browser.newContext({ viewport: { width: 1300, height: 1000 } })).newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource|ERR_/.test(m.text())) errors.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept());
await page.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
const days = (n) => Array.from({ length: n }, (_, i) => { const d = new Date(Date.now() - (n - i) * 86400000); return d.toISOString().slice(0, 10); });
await page.route('**/api/market-proxy**', (r) => {
  const u = decodeURIComponent(new URL(r.request().url()).searchParams.get('url') || '');
  const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (/\/api\/stock\/005930\/basic/.test(u)) return json({ stockName: '삼성전자', closePrice: '72,500', compareToPreviousClosePrice: '1,000', fluctuationsRatio: '1.40', compareToPreviousPrice: { code: '2' } });
  if (/\/api\/stock\/000660\/basic/.test(u)) return json({ stockName: 'SK하이닉스', closePrice: '180,000', compareToPreviousClosePrice: '2,000', fluctuationsRatio: '1.10', compareToPreviousPrice: { code: '5' } });
  if (/api\/index\/KOSPI/.test(u)) return json({ closePrice: '2,650.10', compareToPreviousClosePrice: '10', fluctuationsRatio: '0.40', compareToPreviousPrice: { code: '2' } });
  if (/api\/index\/KOSDAQ/.test(u)) return json({ closePrice: '850.00', compareToPreviousClosePrice: '3', fluctuationsRatio: '0.30', compareToPreviousPrice: { code: '5' } });
  if (/chart\/domestic\/item/.test(u)) return json(days(200).map((d, i) => ({ localDate: d.replace(/-/g, ''), closePrice: 60000 + i * 60 })));
  if (/frankfurter/.test(u)) {
    const m = u.match(/from=(\w+)/); const base = { USD: 1400, JPY: 9.3, EUR: 1600, CNY: 195, GBP: 1850 }[m ? m[1] : 'USD'];
    const rg = u.match(/\/(\d{4}-\d{2}-\d{2})\.\./); const rates = {}; days(40).filter((d) => !rg || d >= rg[1]).forEach((d, i) => { rates[d] = { KRW: base + i * (base / 1000) }; });
    return json({ base: m ? m[1] : 'USD', rates });
  }
  return r.fulfill({ status: 404, body: '{}' });
});
await page.route('**/api.frankfurter.app/**', (r) => r.abort()); // 직접 호출 실패 → 프록시 폴백 경로 검증
await login(page, base);

// ── 1) 증권: 계좌 2개·종목 2개 시드 ──
await page.click('.nav-item[data-path="/stocks"]'); await page.waitForTimeout(500);
await page.evaluate(async () => {
  const s = window.appState;
  const a1 = await s.addBrokerageAccount({ broker: 'KB증권', currency: 'KRW' });
  const a2 = await s.addBrokerageAccount({ broker: 'SK증권', currency: 'KRW' });
  await s.addStockHolding({ account_id: a1.id || s.brokerageAccounts[0].id, market: 'KRX', symbol: '005930', name: '삼성전자', quantity: 10, avg_price: 70000, target_price: 90000, stop_price: 60000, currency: 'KRW' });
  await s.addStockHolding({ account_id: a1.id || s.brokerageAccounts[0].id, market: 'KRX', symbol: '000660', name: 'SK하이닉스', quantity: 5, avg_price: 170000, currency: 'KRW' });
});
await page.waitForTimeout(1800);
const txt = await page.locator('#view-root').innerText();
expect('네이버 시세 반영(현재가 72,500)', /72,500/.test(txt), txt.slice(0, 300));
expect('공급자 표시 네이버', /네이버 증권/.test(txt));
expect('지수 표시(코스피)', /코스피/.test(txt) && /2,650/.test(txt));
expect('전일대비 표시', /오늘 ▲1\.40%/.test(txt) && /오늘 ▼1\.10%/.test(txt), (txt.match(/오늘[^\n]*/g) || []).join('/') + ' ' + (txt.match(/현재가[^\n]*/g) || []).join('/'));
// ── 2) 환율 차트 ──
expect('환율 타일 표시', (await page.locator('.fx-tile').count()) >= 3, String(await page.locator('.fx-tile').count()));
await page.waitForSelector('.market-card .pchart__svg', { timeout: 5000 }).catch(() => {});
expect('환율 차트 SVG', (await page.locator('.market-card .pchart__svg').count()) === 1);
const before = await page.locator('.market-card .pchart__line').getAttribute('points');
await page.click('.period-tabs [data-period="1w"]'); await page.waitForTimeout(500);
const after = await page.locator('.market-card .pchart__line').getAttribute('points');
expect('기간 변경 시 차트 갱신', before !== after);
for (const k of ['10d', '3m', '6m', '1y']) { await page.click(`.period-tabs [data-period="${k}"]`); await page.waitForTimeout(250); }
expect('분기·반기·1년 탭 동작(차트 유지)', (await page.locator('.market-card .pchart__svg').count()) === 1);
await page.click('.fx-tile[data-fx="JPY"]'); await page.waitForTimeout(400);
expect('통화 전환(JPY)', /JPY|일본/.test(await page.locator('.market-card').innerText()));
await page.locator('.market-card .pchart__svg').hover({ position: { x: 200, y: 80 } });
expect('차트 툴팁', !(await page.locator('.market-card .pchart__tip').isHidden()));
// ── 3) 종목 클릭 → 상세 ──
await page.locator('.holding-item', { hasText: '삼성전자' }).locator('.holding-item__name').click();
await page.waitForSelector('.quote-head__price', { timeout: 5000 });
await page.waitForSelector('.nm-modal .pchart__svg, .modal .pchart__svg, .pchart__svg >> nth=1', { timeout: 5000 }).catch(() => {});
const modalText = await page.locator('.quote-head').innerText();
expect('상세: 현재가·전일대비', /72,500/.test(modalText) && /1,000/.test(modalText), modalText);
const gridText = await page.locator('.quote-grid').innerText();
expect('상세: 평단·평가손익', /70,000/.test(gridText) && /평가손익/.test(gridText), gridText);
await page.waitForFunction(() => document.querySelectorAll('.pchart__ref').length >= 3, null, { timeout: 5000 }).catch(() => {});
expect('상세: 평단·목표·손절선', (await page.locator('.pchart__ref').count()) >= 3, String(await page.locator('.pchart__ref').count()));
expect('상세: 네이버 링크', (await page.locator('a[href*="m.stock.naver.com/domestic/stock/005930"]').count()) === 1);
await page.click('[data-days="30"]'); await page.waitForTimeout(200);
expect('상세: 기간 탭', (await page.locator('[data-days="30"][aria-pressed="true"]').count()) === 1);
await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));
// ── 4) 증권사 카드 드래그: KB증권 → SK증권 아래 ──
const names = () => page.$$eval('.broker-card .broker-head__name', (e) => e.map((x) => x.innerText.replace(/⠿/, '').trim()));
expect('초기 순서 KB, SK', JSON.stringify(await names()) === JSON.stringify(['KB증권', 'SK증권']), JSON.stringify(await names()));
const g = await page.locator('.broker-card').first().locator('.rd-grip').first().boundingBox();
const t = await page.locator('.broker-card').nth(1).boundingBox();
await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down();
await page.mouse.move(g.x + 5, g.y + 40, { steps: 5 });
await page.mouse.move(g.x + 5, t.y + t.height - 4, { steps: 12 });
await page.mouse.up(); await page.waitForTimeout(500);
expect('드래그 후 SK, KB', JSON.stringify(await names()) === JSON.stringify(['SK증권', 'KB증권']), JSON.stringify(await names()));
await page.reload({ waitUntil: 'load' }); await page.waitForSelector('.app-shell');
await page.waitForTimeout(600); await page.keyboard.press('Escape').catch(() => {}); await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));
await page.click('.nav-item[data-path="/stocks"]'); await page.waitForTimeout(900);
expect('새로고침 후에도 순서 유지', JSON.stringify(await names()) === JSON.stringify(['SK증권', 'KB증권']), JSON.stringify(await names()));
// 종목 순서(키보드 ↓)
const sym = () => page.$$eval('.holding-item .holding-item__name', (e) => e.map((x) => x.innerText.replace(/⠿/, '').split('\n')[0].trim()));
const s0 = await sym();
await page.locator('.holding-item').first().locator('.rd-grip').focus(); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300);
const s1 = await sym();
expect('종목 ↓ 키로 순서 변경', s0[0] === s1[1] && s0[1] === s1[0], JSON.stringify([s0, s1]));
// ── 5) 브리핑 관심주제 순서 ──
await page.click('.nav-item[data-path="/briefing"]'); await page.waitForTimeout(500);
await page.evaluate(() => { const s = window.appState; s.briefingTopics = [{ id: 't1', name: '반도체', active: true }, { id: 't2', name: '환율', active: true }, { id: 't3', name: '부동산', active: true }]; s.dispatchEvent(new Event('change')); });
await page.locator('[data-tab="topics"], button:has-text("관심주제")').first().click().catch(() => {});
await page.waitForTimeout(500);
const tn = () => page.$$eval('.item-row .item-row__title', (e) => e.map((x) => x.innerText.trim()));
const t0 = await tn();
expect('관심주제 목록 표시', t0.length === 3, JSON.stringify(t0));
if (t0.length === 3) {
  await page.locator('.item-row').nth(2).locator('.rd-grip').focus(); await page.keyboard.press('ArrowUp'); await page.waitForTimeout(300);
  const t1 = await tn();
  expect('관심주제 ↑ 이동', t1[1].startsWith('부동산'), JSON.stringify(t1));
}
expect('JS 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close(); server.close?.(); process.exit(fails ? 1 : 0);
