import { serve, launch, login } from './harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// 필수 입력 별(*) 검증: 주요 등록 모달의 모든 [required] 컨트롤이 "라벨 왼쪽 빨간 *"를 가지는지, 범례가 있는지 확인한다.
//   NODE_PATH=<playwright node_modules> node tests/tools/e2e/required-stars-e2e.mjs /tmp/ws-local 8304
const [root, port] = process.argv.slice(2);
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'stars-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const server = await serve(root, Number(port));
const browser = await launch();
const base = `http://localhost:${port}`;
const errors = []; let fails = 0;
const expect = (name, cond, detail = '') => { if (!cond) fails++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : detail); };
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('dialog', (d) => d.accept());
await page.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await login(page, base);

// 열려 있는 모달/폼의 [required] 컨트롤 검사. 반환: {total, bad:[desc], legend}
const inspect = () => page.evaluate(() => {
  const root = document.querySelector('.nm-modal') || document;
  const ctrls = [...root.querySelectorAll('[required]')].filter((c) => c.type !== 'hidden' && c.offsetParent !== null);
  const bad = [];
  for (const c of ctrls) {
    const box = c.closest('.nm-field, .lfg');
    const lab = box && [...box.children].find((x) => x.tagName === 'LABEL');
    const star = lab && lab.querySelector(':scope > .req');
    const first = lab && lab.firstChild === star; // 라벨 텍스트보다 앞(왼쪽)
    const red = star && getComputedStyle(star).color;
    const isRed = red && (() => { const m = red.match(/\d+/g).map(Number); return m[0] > 150 && m[1] < 90 && m[2] < 90; })();
    if (!star || !first || !isRed) bad.push(`${c.name || c.id || c.tagName}: star=${!!star} left=${!!first} red=${red}`);
  }
  return { total: ctrls.length, bad, legend: !!root.querySelector('.req-legend'), aria: ctrls.every((c) => c.getAttribute('aria-required') === 'true') };
});
const closeAll = () => page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));

const PAGES = ['/schedule', '/projects', '/challenges', '/briefing', '/playlist', '/vehicles', '/health', '/devlog', '/knowledge', '/career', '/automation', '/integrations', '/programs', '/settings'];
let seen = 0;
const TABS = { '/briefing': [/관심주제/, /피드 소스/], '/career': [/학력/, /자격증/, /교육이수/, /가입단체/, /포상/, /경력/] };
async function scan(p) {
  const n = await page.locator('#view-root button').evaluateAll((bs) => bs.map((b, i) => ({ i, t: b.textContent.trim() })).filter((x) => /^(\+|＋)|등록|추가|새 /.test(x.t) && x.t.length < 20));
  for (const b of n) {
    await page.locator('#view-root button').nth(b.i).click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(200);
    if (!(await page.locator('.nm-modal').count())) continue;
    const r = await inspect();
    if (r.total) { seen++; expect(`${p} "${b.t}": 필수 ${r.total}개 모두 왼쪽 빨간 별 + 범례 + aria`, !r.bad.length && r.legend && r.aria, JSON.stringify(r)); await page.screenshot({ path: path.join(SHOTS, `star-${p.slice(1)}-${seen}.png`) }); }
    await closeAll(); await page.waitForTimeout(100);
  }
}
for (const p of PAGES) {
  const nav = page.locator(`.nav-item[data-path="${p}"]`);
  if (!(await nav.count())) { console.log('skip (no nav)', p); continue; }
  await nav.click(); await page.waitForTimeout(350); await closeAll();
  await scan(p);
  for (const re of TABS[p] || []) {
    const tab = page.locator('#view-root button', { hasText: re }).first();
    if (await tab.count()) { await tab.click().catch(() => {}); await page.waitForTimeout(250); await scan(p); }
  }
}
for (const t of ['+ API 등록', '비밀번호 변경']) {
  await page.click('.nav-item[data-path="/settings"]'); await page.waitForTimeout(300); await closeAll();
  await page.locator('#view-root button', { hasText: t }).first().click(); await page.waitForTimeout(300);
  const r = await inspect(); seen++;
  expect(`/settings "${t}": 필수 ${r.total}개 별 + 범례`, r.total >= 2 && !r.bad.length && r.legend && r.aria, JSON.stringify(r));
  await closeAll();
}
expect('필수 항목이 있는 모달을 8개 이상 검사', seen >= 8, String(seen));
expect('페이지 오류 없음', !errors.length, errors.join('\n'));
await browser.close(); server.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL OK'); process.exit(fails ? 1 : 0);
