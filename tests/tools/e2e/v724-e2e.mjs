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

// 4b) v7.25 벤토: 한 줄 브리핑 / 카드 숨기기 저장 / 빠른 일정 추가
await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForSelector('.bento');
expect('한 줄 브리핑', (await page.locator('.bento-brief').count()) === 1 && /✨/.test(await page.locator('.bento-brief').innerText()));
await page.click('.bento-edit');
expect('편집 모드 카드 막대', (await page.locator('.bento-editbar').count()) >= 6);
await page.click('[data-bento="bento-dday"] [data-act=toggle]');
await page.click('.bento-edit:has-text("완료")');
expect('D-day 카드 숨김', (await page.locator('[data-bento="bento-dday"]').count()) === 0);
await page.reload({ waitUntil: 'load' }); await page.waitForSelector('.bento');
expect('숨김 상태 유지', (await page.locator('[data-bento="bento-dday"]').count()) === 0);
await page.keyboard.press('Control+k'); await page.waitForSelector('.quickfind-list');
await page.fill('.nm-modal input.nm-input', '+내일 오후 3시 치과');
expect('새 일정 항목', /일정 추가: 치과/.test(await page.locator('.quickfind-list').innerText()));
await page.keyboard.press('Enter'); await page.waitForTimeout(500);
const added = await page.evaluate(() => window.appState.schedules.find((x) => x.title === '치과'));
expect('일정 생성(15:00)', !!added && String(added.time).startsWith('15:00'), JSON.stringify(added));

// 4c) v7.25.1: 사이드바+상단바 동시 / 더보기 없이 전체 메뉴 / 날씨 카드 클릭 → 주간예보
const b = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
b.on('pageerror', (e) => errors.push('both pageerror: ' + e.message));
await b.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await login(b, base, { nav: 'both', home: 'bento' });
await b.waitForSelector('.bento');
expect('사이드바 + 상단바 동시', (await b.locator('.sidebar').count()) === 1 && (await b.locator('.applebar').count()) === 1);
expect('더보기 버튼 없음', (await b.locator('.applebar__more').count()) === 0);
const vis = await b.locator('.applebar__list .applebar__link').evaluateAll((ns) => ns.filter((n) => n.getBoundingClientRect().width > 0).length);
expect('상단 메뉴 16개 모두 표시', vis === 16, String(vis));
await b.screenshot({ path: path.join(SHOTS, 'both-desktop.png') });
await b.click('[data-bento="bento-weather"]'); await b.waitForTimeout(500);
expect('날씨 카드 → 주간예보 모달', (await b.locator('.nm-modal').count()) >= 1 && /주간예보/.test(await b.locator('.nm-modal').first().innerText()));
expect('설정으로 이동하지 않음', !/settings/.test(await b.evaluate(() => location.hash)));

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
