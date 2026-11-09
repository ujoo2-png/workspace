import { serve, launch, login } from './harness.mjs';
const [root, port] = process.argv.slice(2);
const server = await serve(root, Number(port)); const browser = await launch(); const base = `http://localhost:${port}`;
const errors = []; let fails = 0; const expect = (n, c, d = '') => { if (!c) fails++; console.log(c ? 'ok  ' : 'FAIL', n, c ? '' : d); };
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } }); const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
let lastDialog = ''; let dialogAccept = true;
page.on('dialog', (d) => { lastDialog = d.message(); dialogAccept ? d.accept() : d.dismiss(); });
await page.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await login(page, base);
const toastText = async () => (await page.locator('.toast, .nm-toast').allInnerTexts()).join('|');
await page.evaluate(() => window.navigate('/career')); await page.waitForSelector('.quick-tabs');
await page.click('[data-tab="education"]'); await page.waitForSelector('.career-colmgr-btn');
await page.click('.career-colmgr-btn'); await page.waitForSelector('.nm-modal');
// 추천 + 직접 추가
await page.click('.nm-modal button:has-text("+ 소재지")'); await page.waitForSelector('.nm-modal input[value="소재지"]');
expect('프리셋으로 소재지 추가', (await page.locator('.nm-modal').innerText()).includes('사용 중 1/5'));
// 기존 필드와 같은 이름 → 차단
await page.fill('.nm-modal input[placeholder*="새 컬럼"]', '학교명'); await page.click('.nm-modal button:text-is("추가")'); await page.waitForTimeout(300);
expect('기존 필드 이름은 만들지 않음', (await page.locator('.nm-modal').innerText()).includes('사용 중 1/5') && (await toastText()).includes('이미 기존 필드'), await toastText());
// 부분 겹침(학위구분) → 확인창 거절 시 안 만들어짐, 수락 시 만들어짐
dialogAccept = false; await page.fill('.nm-modal input[placeholder*="새 컬럼"]', '학위구분'); await page.click('.nm-modal button:text-is("추가")'); await page.waitForTimeout(300);
expect('겹침 경고 확인창 → 취소하면 미생성', lastDialog.includes('겹칠 수') && (await page.locator('.nm-modal').innerText()).includes('사용 중 1/5'), lastDialog);
dialogAccept = true; await page.click('.nm-modal button:text-is("추가")'); await page.waitForTimeout(300);
expect('겹침 경고 → 수락하면 생성', (await page.locator('.nm-modal').innerText()).includes('사용 중 2/5'));
// 최대 5개
for (const n of ['학점', '비자', '학과코드']) { await page.fill('.nm-modal input[placeholder*="새 컬럼"]', n); await page.click('.nm-modal button:text-is("추가")'); await page.waitForTimeout(200); }
expect('최대 5개에서 추가 UI가 사라지고 안내', (await page.locator('.nm-modal').innerText()).includes('사용 중 5/5') && (await page.locator('.nm-modal').innerText()).includes('최대 5개를 모두 사용'));
await page.screenshot({ path: '/tmp/e2e-colmgr.png' });
// 하나 숨김 보관 → 자리 생김
await page.locator('.nm-modal button:has-text("숨김 보관")').last().click(); await page.waitForTimeout(300);
expect('숨김 보관 후 4/5 + 보관 목록', (await page.locator('.nm-modal').innerText()).includes('사용 중 4/5') && (await page.locator('.nm-modal').innerText()).includes('숨김 보관 1개'));
await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));

// 등록: 폼에 사용자 컬럼 표시 + 저장
await page.click('text=+ 학력 추가'); await page.waitForSelector('.nm-modal form');
const labels = await page.locator('.nm-modal form label').allInnerTexts();
expect('폼에 사용자 컬럼이 비고 앞에 표시', labels.includes('소재지') && labels.includes('학위구분') && labels.indexOf('소재지') < labels.indexOf('비고'), labels.join(','));
await page.fill('.nm-modal input[name="school_name"]', '한국대'); 
const nameOf = async (label) => page.locator('.nm-modal form .nm-field', { has: page.locator(`label:text-is("${label}")`) }).locator('input,select').first();
await (await nameOf('소재지')).fill('서울'); await (await nameOf('학점')).fill('4.0');
await page.click('.nm-modal button[type="submit"]'); await page.waitForTimeout(800);
const row = await page.evaluate(() => window.appState.career.education[0]);
expect('extra에 값 저장(컬럼 id 키)', row.extra && Object.values(row.extra).sort().join() === '4.0,서울', JSON.stringify(row.extra));
// 목록 컬럼 + 검색 + 정렬
expect('목록에 소재지 컬럼/값', (await page.locator('table.data-table').innerText()).includes('소재지') && (await page.locator('table.data-table').innerText()).includes('서울'));
await page.fill('.career-search-education', '서울'); await page.waitForTimeout(200);
expect('사용자 컬럼 값으로 검색', (await page.locator('table.data-table tbody tr').count()) === 1);
await page.fill('.career-search-education', '없는값'); await page.waitForTimeout(200);
expect('검색 불일치 → 결과 없음', (await page.locator('text=검색 결과가 없습니다').count()) === 1);
await page.fill('.career-search-education', ''); await page.waitForTimeout(200);
// 수정: 한 컬럼만 바꿔도 다른 컬럼 값 보존
await page.click('table.data-table tbody tr button[title="수정"]'); await page.waitForSelector('.nm-modal form');
await (await nameOf('소재지')).fill('부산'); await page.click('.nm-modal button[type="submit"]'); await page.waitForTimeout(800);
const row2 = await page.evaluate(() => window.appState.career.education[0]);
expect('수정 후 값 병합(학점 보존, 소재지 갱신)', Object.values(row2.extra).sort().join() === '4.0,부산', JSON.stringify(row2.extra));
// 값 비우면 키 삭제
await page.click('table.data-table tbody tr button[title="수정"]'); await page.waitForSelector('.nm-modal form');
await (await nameOf('학점')).fill(''); await page.click('.nm-modal button[type="submit"]'); await page.waitForTimeout(800);
const row3 = await page.evaluate(() => window.appState.career.education[0]);
expect('값을 비우면 해당 키만 삭제', Object.values(row3.extra).join() === '부산', JSON.stringify(row3.extra));
// 열람
await page.click('table.data-table tbody tr button[title="열람"]'); await page.waitForSelector('.nm-modal');
expect('열람에 사용자 컬럼 표시', (await page.locator('.nm-modal').innerText()).includes('부산'));
await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));
// 숨김 → 목록에서 빠지고 데이터 유지 → 복원 → 값 복귀 → 완전삭제 → 값 삭제
await page.click('.career-colmgr-btn'); await page.waitForSelector('.nm-modal');
await page.locator('.nm-modal .nm-card', { has: page.locator('input[value="소재지"]') }).locator('button:has-text("숨김 보관")').click(); await page.waitForTimeout(300);
await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));
expect('숨김 후 목록에서 소재지 사라짐·데이터는 유지', !(await page.locator('table.data-table').innerText()).includes('부산') && Object.values((await page.evaluate(() => window.appState.career.education[0])).extra).includes('부산'));
await page.click('.career-colmgr-btn'); await page.waitForSelector('.nm-modal');
await page.locator('.nm-modal button:text-is("복원")').first().click(); await page.waitForTimeout(300);
await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));
expect('복원하면 값이 다시 보임', (await page.locator('table.data-table').innerText()).includes('부산'));
await page.click('.career-colmgr-btn'); await page.waitForSelector('.nm-modal');
await page.locator('.nm-modal .nm-card', { has: page.locator('input[value="소재지"]') }).locator('button:has-text("숨김 보관")').click(); await page.waitForTimeout(300);
await page.locator('.nm-modal button:text-is("완전 삭제")').first().click(); await page.waitForTimeout(600);
const row4 = await page.evaluate(() => window.appState.career.education[0]);
expect('완전 삭제하면 값도 삭제', !Object.values(row4.extra || {}).includes('부산'), JSON.stringify(row4.extra));
await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));
// 새로고침 후 정의 유지(설정 동기화)
await page.reload({ waitUntil: 'load' }); await page.waitForSelector('.app-shell');
const defs = await page.evaluate(() => window.CareerCols.active('education').map((d) => d.label));
expect('새로고침 후에도 컬럼 정의 유지', defs.includes('학위구분'), defs.join());
// 다른 카테고리(사진)에도 적용 가능
await page.evaluate(() => { document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()); window.navigate('/career'); }); await page.waitForSelector('.quick-tabs');
for (const k of ['certifications', 'trainings', 'memberships', 'awards', 'experiences', 'photos']) { await page.click(`[data-tab="${k}"]`); expect(`${k} 탭에 컬럼 설정 버튼`, (await page.locator('.career-colmgr-btn').count()) === 1); }
expect('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close(); server.close(); console.log(fails ? `FAILED ${fails}` : 'ALL OK'); process.exit(fails ? 1 : 0);
