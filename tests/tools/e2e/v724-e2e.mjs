import { serve, launch, login } from './harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// v7.25.2: 클래식(v7.23) 홈 + 사이드바 복원 확인, 빠른 일정 추가(Ctrl/⌘+K), 통합 "며칠 전/후" 필드, 가로 주간예보.
const [root, port] = process.argv.slice(2);
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'v724-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const server = await serve(root, Number(port));
const browser = await launch();
const base = `http://localhost:${port}`;
const errors = []; let fails = 0;
const expect = (name, cond, detail = '') => { if (!cond) fails++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : detail); };
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept());
const days = Array.from({ length: 7 }, (_, i) => `2026-10-${String(7 + i).padStart(2, '0')}`);
await page.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
  utc_offset_seconds: 32400, current: { temperature_2m: 18, weather_code: 0 },
  daily: { time: days, temperature_2m_max: days.map(() => 22), temperature_2m_min: days.map(() => 12), weather_code: days.map(() => 1), precipitation_probability_max: days.map(() => 30), precipitation_sum: days.map(() => 0) },
  hourly: { time: [], weather_code: [], precipitation_probability: [], precipitation: [] } }) }));
await page.clock.setFixedTime(new Date('2026-10-07T12:00:00+09:00'));
await login(page, base);

expect('사이드바 있음', (await page.locator('.sidebar').count()) === 1);
expect('상단 navbar 없음', (await page.locator('.applebar').count()) === 0);
expect('벤토 없음(클래식 홈)', (await page.locator('.bento').count()) === 0 && (await page.locator('.kpi-card').count()) >= 3);
await page.screenshot({ path: path.join(SHOTS, 'home-classic.png') });

// 날씨 카드 → 주간예보(가로)
const wcard = page.locator('.weather-card, [data-weather-city], .wx-card').first();
if (await wcard.count()) {
  await wcard.click(); await page.waitForSelector('.wx-week', { timeout: 4000 }).catch(() => {});
  expect('주간예보 가로 스트립', (await page.locator('.wx-week .wx-day').count()) === 7);
  await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));
}

// 빠른 일정 추가
await page.keyboard.press('Control+k'); await page.waitForSelector('.quickfind-list');
await page.fill('.nm-modal input.nm-input', '+내일 오후 3시 치과');
expect('새 일정 항목', /일정 추가: 치과/.test(await page.locator('.quickfind-list').innerText()));
await page.keyboard.press('Enter'); await page.waitForTimeout(500);
const added = await page.evaluate(() => window.appState.schedules.find((x) => x.title === '치과'));
expect('일정 생성(15:00)', !!added && String(added.time).startsWith('15:00'), JSON.stringify(added));
expect('🔍 버튼', (await page.locator('.topbar button[aria-label="빠른 이동 검색"]').count()) === 1);

// 통합 며칠 전/후
await page.click('.nav-item[data-path="/schedule"]'); await page.waitForTimeout(300);
await page.click('button:has-text("+ 일정 등록")'); await page.waitForSelector('.nm-modal form');
const t = await page.locator('.nm-modal').innerText();
expect('며칠 전/후 통합 안내', /전\/후|전·후|며칠 전/.test(t));
expect('옛 반복 필드 제거', (await page.locator('.nm-modal [name=repeat_kind]').count()) === 0);
await page.keyboard.press('Escape');

expect('콘솔 오류 없음', errors.length === 0, errors.join('\n'));
await browser.close(); server.close?.();
console.log(fails ? `${fails} FAIL` : 'ALL OK');
process.exit(fails ? 1 : 0);
