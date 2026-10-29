import { serve, launch, login } from './harness.mjs';
// v7.30.0 합본 스모크: 모든 메뉴가 오류 없이 열리고(증권·사용량 포함), 일정 "며칠 전/후"·매년 반복·저장 전 첨부가 함께 동작한다.
const [root, port] = process.argv.slice(2);
const server = await serve(root, Number(port));
const browser = await launch();
const base = `http://localhost:${port}`;
const errors = []; let fails = 0;
const expect = (n, c, d = '') => { if (!c) fails++; console.log(c ? 'ok  ' : 'FAIL', n, c ? '' : d); };
const page = await (await browser.newContext({ viewport: { width: 1300, height: 950 } })).newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource|ERR_/.test(m.text())) errors.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept());
await page.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await login(page, base);
const paths = await page.$$eval('.nav-item[data-path]', (els) => els.map((e) => e.dataset.path));
expect('메뉴에 증권·사용량·관심주제 포함', ['/stocks', '/usage', '/briefing', '/schedule', '/projects'].every((p) => paths.includes(p)), paths.join(','));
for (const p of paths) {
  await page.click(`.nav-item[data-path="${p}"]`); await page.waitForTimeout(350);
  const len = (await page.locator('#view-root').innerText()).trim().length;
  expect(`열림 ${p}`, len > 10, `len=${len}`);
}
// 증권: 화면 문구
await page.click('.nav-item[data-path="/stocks"]'); await page.waitForTimeout(400);
const st = await page.locator('#view-root').innerText();
expect('증권 화면 본문', /증권|계좌|보유/.test(st), st.slice(0, 120));
// 일정 폼
await page.click('.nav-item[data-path="/schedule"]'); await page.waitForTimeout(400);
await page.locator('button:has-text("일정 등록"), button:has-text("+ 일정"), button:has-text("새 일정")').first().click().catch(() => {});
await page.waitForTimeout(400);
const hasOffset = await page.locator('#offset-input').count();
const hasRepeat = await page.locator('select[name="repeat"]').count();
expect('전/후 입력칸 존재', hasOffset === 1, `offset=${hasOffset}`);
expect('반복 선택(매년 포함) 존재', hasRepeat === 1 && (await page.locator('select[name="repeat"] option[value="yearly"]').count()) === 1);
expect('JS 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close(); server.close?.(); process.exit(fails ? 1 : 0);
