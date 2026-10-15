import { serve, launch, login } from './harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// v7.26.0: WBS 너비 조절 / 끌어서 순서 변경 / 일부 단계 복사·붙여넣기(같은 프로젝트·다른 프로젝트).
const [root, port] = process.argv.slice(2);
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'v726-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const server = await serve(root, Number(port));
const browser = await launch();
const base = `http://localhost:${port}`;
const errors = []; let fails = 0;
const expect = (name, cond, detail = '') => { if (!cond) fails++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : detail); };
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept());
await page.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await login(page, base);
await page.evaluate(async () => {
  const st = window.appState;
  const p = await st.addProject({ name: '사회복지사', deadline: '2026-12-31', priority: 'high' });
  const q = await st.addProject({ name: '노인복지론', deadline: '2026-12-31', priority: 'high' });
  const t1 = await st.addProjectStage(p.id, { name: '1학기 아주 아주 아주 긴 이름의 대분류 단계입니다 정말로 깁니다' });
  for (let i = 1; i <= 3; i++) await st.addProjectStage(p.id, { name: `${i}강`, parent_id: t1.id, start_date: `2026-03-0${i}`, target_date: `2026-03-0${i}` });
  await st.addProjectStage(p.id, { name: '2학기' });
  window.__ids = { p: p.id, q: q.id };
});
await page.click('.nav-item[data-path="/projects"]'); await page.waitForTimeout(500);
await page.click('.project-list-item:has-text("사회복지사")'); await page.waitForSelector('.wbs-card .g2-lrow');
const names = () => page.locator('.g2-lrow .g2-name').evaluateAll((ns) => ns.map((n) => n.value));
const colW = () => page.evaluate(() => parseInt(getComputedStyle(document.querySelector('.g2-inner')).gridTemplateColumns.split(' ')[0], 10));

// 2.1 너비 조절
const w0 = await colW();
const h = page.locator('.g2-left .g2-resizer'); const hb = await h.boundingBox();
await page.mouse.move(hb.x + 4, hb.y + 20); await page.mouse.down(); await page.mouse.move(hb.x + 4 + 150, hb.y + 20, { steps: 5 }); await page.mouse.up();
const w1 = await colW();
expect('경계선 드래그로 너비 증가', w1 >= w0 + 140, `${w0}→${w1}`);
expect('너비 저장', (await page.evaluate(() => localStorage.getItem('workspace:wbs:labelW'))) === String(w1));
await page.mouse.move(hb.x + 154, hb.y + 20); 
const hb2 = await h.boundingBox();
await page.mouse.move(hb2.x + 4, hb2.y + 20); await page.mouse.down(); await page.mouse.move(hb2.x - 900, hb2.y + 20, { steps: 5 }); await page.mouse.up();
expect('최소 너비 200 제한', (await colW()) === 200, String(await colW()));
await page.locator('.g2-left .g2-resizer').dblclick();
expect('더블클릭=기본 300', (await colW()) === 300);
await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(800); await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove())); await page.waitForSelector('.wbs-card .g2-lrow');

// 2.2 드래그 순서 변경: 3강을 1강 앞으로
expect('초기 순서', JSON.stringify(await names()).includes('"1강","2강","3강"'), JSON.stringify(await names()));
const grip3 = page.locator('.g2-lrow:has(input[value="3강"]) .g2-grip');
const row1 = page.locator('.g2-lrow:has(input[value="1강"])');
const rb = await row1.boundingBox();
await grip3.dragTo(row1, { targetPosition: { x: 80, y: 3 } });
await page.waitForTimeout(500);
let nm = await names();
expect('3강이 1강 앞으로', nm.indexOf('3강') < nm.indexOf('1강') && nm.indexOf('1강') < nm.indexOf('2강'), JSON.stringify(nm));
// 2학기를 1학기의 하위로(가운데)
await page.locator('.g2-lrow:has(input[value="2학기"]) .g2-grip').dragTo(page.locator('.g2-lrow:has(input[value^="1학기"])'), { targetPosition: { x: 80, y: 15 } });
await page.waitForTimeout(500);
const lv = await page.evaluate(() => { const st = window.appState.projectStages; const t = st.find((x) => x.name === '2학기'); const par = st.find((x) => x.id === t.parent_id); return par && par.name.slice(0, 3); });
expect('가운데에 놓으면 하위로', lv === '1학기', String(lv));
// v7.28.1: 대/중/소 배지를 잡고 끌어도 순서 변경 + 조절선이 항상 보임
await page.locator('.g2-lrow:has(input[value="1강"]) .g2-lvl').dragTo(page.locator('.g2-lrow:has(input[value="2강"])'), { targetPosition: { x: 80, y: 30 } });
await page.waitForTimeout(500);
nm = await names();
expect('배지를 끌어도 1강이 2강 뒤로', nm.indexOf('1강') > nm.indexOf('2강'), JSON.stringify(nm));
expect('조절선 안내와 ⋮ 표시', (await page.locator('#wbs-tip').count()) === 1 && (await page.evaluate(() => getComputedStyle(document.querySelector('.g2-corner .g2-resizer'), '::before').content)).includes('⋮'));
await page.screenshot({ path: path.join(SHOTS, 'wbs-drag.png') });

// 2.3 일부 복사/붙여넣기
await page.locator('.g2-lrow:has(input[value="1강"]) .g2-chk').check();
await page.locator('.g2-lrow:has(input[value="2강"]) .g2-chk').check();
await page.click('#wbs-copy'); await page.waitForTimeout(300);
expect('복사 토스트 + 붙여넣기 개수', /\(2\)/.test(await page.locator('#wbs-paste').innerText()), await page.locator('#wbs-paste').innerText());
await page.click('#wbs-paste'); await page.waitForSelector('#wbs-paste-go');
await page.selectOption('#wbs-paste-where', 'top');
await page.click('#wbs-paste-go'); await page.waitForTimeout(600);
const cnt = await page.evaluate(() => ({ a: window.appState.projectStages.filter((x) => x.project_id === window.appState.projects.find((p) => p.name === '사회복지사').id && x.name === '1강' && !x.parent_id).length }));
expect('같은 프로젝트 최상위에 붙여넣기', cnt.a === 1, JSON.stringify(cnt));
// 다른 프로젝트로 붙여넣기
await page.click('.project-list-item:has-text("노인복지론")'); await page.waitForSelector('#wbs-paste');
await page.click('#wbs-paste'); await page.waitForSelector('#wbs-paste-go'); await page.click('#wbs-paste-go'); await page.waitForTimeout(600);
const q = await page.evaluate(() => window.appState.projectStages.filter((x) => x.project_id === window.appState.projects.find((p) => p.name === '노인복지론').id).map((x) => x.name).sort());
expect('다른 프로젝트에 붙여넣기', JSON.stringify(q) === JSON.stringify(['1강', '2강']), JSON.stringify(q));
// 전체 복사(아무것도 선택 안 함 → 전체)
await page.click('.project-list-item:has-text("사회복지사")'); await page.waitForSelector('#wbs-copy');
await page.check('#wbs-check-all'); await page.waitForTimeout(200);
await page.click('#wbs-copy'); await page.waitForTimeout(200);
const clipN = await page.evaluate(() => JSON.parse(localStorage.getItem('workspace:wbs:clip')).items.length);
const total = await page.evaluate(() => window.appState.projectStages.filter((x) => x.project_id === window.appState.projects.find((p) => p.name === '사회복지사').id).length);
expect('전체 선택 후 복사 = 전체 WBS', clipN === total, `${clipN}/${total}`);

expect('콘솔 오류 없음', errors.length === 0, errors.join('\n'));
await browser.close(); server.close?.();
console.log(fails ? `${fails} FAIL` : 'ALL OK');
process.exit(fails ? 1 : 0);
