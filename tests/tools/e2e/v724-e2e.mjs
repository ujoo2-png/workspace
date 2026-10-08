import { serve, launch, login } from './harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// v7.24.0: 상단 애플 스타일 navbar, 벤토 홈, 통합 "며칠 전/후" 필드 검증.
const [root, port] = process.argv.slice(2);
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'v724-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const server = await serve(root, Number(port));
const browser = await launch();
const base = `http://localhost:${port}`;
const errors = []; let fails = 0;
const expect = (name, cond, detail = '') => { if (!cond) fails++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : detail); };
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept());
await page.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await page.clock.setFixedTime(new Date('2026-10-07T12:00:00+09:00'));
await login(page, base, { nav: 'top', home: 'bento' });

// 1) 상단 navbar + 벤토 홈
expect('applebar 존재', (await page.locator('.applebar').count()) === 1);
expect('사이드바 없음', (await page.locator('.sidebar').count()) === 0);
await page.waitForSelector('.bento');
expect('벤토 타일 6개 이상', (await page.locator('.bento-tile').count()) >= 6);
await page.screenshot({ path: path.join(SHOTS, 'bento-desktop.png') });

// 2) 빠른 찾기
await page.keyboard.press('Control+k'); await page.waitForTimeout(200);
expect('빠른 찾기 열림', (await page.locator('.quickfind-list').count()) >= 1);
await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));

// 3) 라우팅(상단 메뉴)
await page.evaluate(() => { location.hash = '#/schedule'; }); await page.waitForTimeout(400);
expect('일정 화면', /schedule/.test(await page.evaluate(() => location.hash)));

// 4) 통합 필드: 전/후
await page.click('button:has-text("+ 일정 등록")'); await page.waitForSelector('.nm-modal form');
await page.fill('.nm-modal input[name=title]', '시험');
await page.fill('.nm-modal input[name=date]', '2026-10-20');
const modalText = await page.locator('.nm-modal').innerText();
expect('며칠 전/후 통합 안내', /전\/후|전·후|며칠 전/.test(modalText));
expect('옛 반복 필드 제거', (await page.locator('.nm-modal [name=repeat_kind]').count()) === 0);
await page.screenshot({ path: path.join(SHOTS, 'schedule-offsets.png') });
await page.keyboard.press('Escape');

// 5) 모바일
const m = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
m.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message));
await m.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await login(m, base, { nav: 'top', home: 'bento' });
await m.waitForSelector('.bento');
expect('모바일 가로 스크롤 없음', await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await m.screenshot({ path: path.join(SHOTS, 'bento-mobile.png') });

expect('콘솔 오류 없음', errors.length === 0, errors.join('\n'));
await browser.close(); server.close?.();
console.log(fails ? `${fails} FAIL` : 'ALL OK');
process.exit(fails ? 1 : 0);
