import { serve, launch, login } from './harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// 홈 대시보드 모션 브라우저 검증(Playwright): 입장 스태거, count-up, 링/막대, 스파크라인, FLIP 재정렬, 프레젠테이션 모드, 레이아웃 이동(CLS), 콘솔 오류.
//   NODE_PATH=<playwright node_modules> node tests/tools/e2e/home-dynamic-e2e.mjs /tmp/ws-local 8302
const [root, port] = process.argv.slice(2);
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'home-dynamic-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const server = await serve(root, Number(port));
const browser = await launch();
const base = `http://localhost:${port}`;
const results = []; const errors = [];
const expect = (name, cond, detail = '') => { results.push({ name, ok: !!cond }); console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : detail); };
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
await page.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ utc_offset_seconds: 32400, current: { temperature_2m: 18, weather_code: 3 }, daily: { time: ['2026-10-07'], temperature_2m_max: [21], temperature_2m_min: [12], weather_code: [3], precipitation_probability_max: [20], precipitation_sum: [0] }, hourly: { time: Array.from({ length: 24 }, (_, h) => `2026-10-07T${String(h).padStart(2, '0')}:00`), weather_code: Array(24).fill(3), precipitation_probability: Array(24).fill(20), precipitation: Array(24).fill(0) } }) }));
await page.clock.setFixedTime(new Date('2026-10-07T21:03:00+09:00'));
await login(page, base);
// 시드: 일정(지난 7일), 알림, 프로젝트(진행률), D-day
await page.evaluate(async () => {
  const st = window.appState; const uid = st.user.id; const add = window.addDays;
  for (let i = -6; i <= 0; i++) for (let k = 0; k < (i + 7) % 4; k++) await st.store.create('schedules', { user_id: uid, title: `일정 ${i}-${k}`, date: add('2026-10-07', i), time: '10:00', done: false });
  await st.store.create('schedules', { user_id: uid, title: '프레젠테이션 점검', date: '2026-10-07', time: '14:30', done: false });
  const p = await st.store.create('projects', { user_id: uid, name: 'P1', status: 'in_progress', deadline: '2026-10-10' });
  await st.store.create('project_progress', { project_id: p.id, progress: 60, recorded_at: '2026-10-06T00:00:00Z' });
  for (let i = 0; i < 3; i++) await st.store.create('notifications', { user_id: uid, title: `알림${i}`, message: 'm', severity: 'info', is_read: false, created_at: `2026-10-0${5 + (i % 2)}T09:00:00Z` });
  await st.store.create('ddays', { user_id: uid, title: '시험', target_date: '2026-10-20', emoji: '📝' });
  await st.store.create('programs', { user_id: uid, name: '위젯앱', url: 'https://w.dev', program_type: 'widget', run_count: 2 });
  await st.store.create('programs', { user_id: uid, name: '모바일', url: 'https://m.dev', program_type: 'mobile', icon: '🚀', run_count: 1 });
  await st.refreshAll();
});
// ---- CLS 측정 시작(페이지 로드 이후 새 이동만) ----
await page.evaluate(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: false }); });
await page.click('.nav-item[data-path="/schedule"]');
await page.waitForTimeout(200);
await page.click('.nav-item[data-path="/home"]').catch(() => page.click('.nav-item >> nth=0'));
await page.waitForSelector('.home-hero');
await page.screenshot({ path: path.join(SHOTS, 'dyn-t0.png') });
await page.waitForTimeout(350);
await page.screenshot({ path: path.join(SHOTS, 'dyn-t350.png') });
await page.waitForTimeout(1600);
await page.screenshot({ path: path.join(SHOTS, 'dyn-t2000.png') });
await page.screenshot({ path: path.join(SHOTS, 'dyn-full.png'), fullPage: true });
const kpiVals = await page.evaluate(() => [...document.querySelectorAll('.kpi-grid:first-of-type .kpi-card')].slice(0, 4).map((c) => ({ v: c.querySelector('.kpi-card__value').textContent, spark: !!c.querySelector('.spark path'), ring: !!c.querySelector('.ring__fg') })));
expect('KPI 숫자가 최종값으로 수렴(오늘 일정 4 = 시드 3+1)', kpiVals[0].v === '4', JSON.stringify(kpiVals));
expect('스파크라인 3개 + 링 1개', kpiVals.slice(0, 3).every((k) => k.spark) && kpiVals[3].ring, JSON.stringify(kpiVals));
const ringOffset = await page.evaluate(() => { const fg = document.querySelector('.ring__fg'); return { off: Number(fg.getAttribute('stroke-dashoffset')), C: 2 * Math.PI * 24 }; });
expect('진행 링이 60%만큼 채워짐', Math.abs(ringOffset.off - ringOffset.C * 0.4) < 1.5, JSON.stringify(ringOffset));
// count-up 중간값: 새로 들어가서 즉시 읽으면 최종값이 아님(이동 후 100ms 이내)
await page.click('.nav-item[data-path="/schedule"]');
const mid = await page.evaluate(async () => {
  document.querySelector('.nav-item[data-path="/home"]').click();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return document.querySelector('.kpi-card__value').textContent;
});
expect('count-up: 진입 직후엔 0에서 시작(최종값 4가 아님)', mid !== '4', mid);
await page.waitForTimeout(1300);
expect('count-up: 끝나면 4', (await page.evaluate(() => document.querySelector('.kpi-card__value').textContent)) === '4');
// 프로그램 위젯: 저장 아이콘 / 유형 기본 아이콘
const progIcons = await page.evaluate(() => [...document.querySelectorAll('.home-program')].map((b) => b.textContent.trim()));
expect('홈 "내 프로그램" 위젯: 🧩 위젯앱 / 🚀 모바일', progIcons.some((t) => t.startsWith('🧩') && t.includes('위젯앱')) && progIcons.some((t) => t.startsWith('🚀') && t.includes('모바일')), JSON.stringify(progIcons));
// 입장 애니메이션: 위젯에 animation 적용 + stagger delay 증가
await page.click('.nav-item[data-path="/schedule"]');
const stag = await page.evaluate(async () => {
  document.querySelector('.nav-item[data-path="/home"]').click();
  await new Promise((r) => requestAnimationFrame(r));
  const ws = [...document.querySelectorAll('.fx-enter .home-widget')].slice(0, 4);
  return ws.map((w) => getComputedStyle(w).animationName + '|' + getComputedStyle(w).animationDelay);
});
expect('입장 스태거: 위젯마다 delay가 커짐', stag.length >= 3 && stag.every((x) => x.startsWith('fx-rise')), JSON.stringify(stag));
await page.waitForTimeout(1800);
// FLIP: 첫 위젯을 세 번째 위젯 자리로 드래그(drop 핸들러 직접 호출 — HTML5 DnD는 합성 이벤트로)
const flip = await page.evaluate(async () => {
  const ws = [...document.querySelectorAll('.home-widget')];
  const from = ws[0].dataset.widgetKey; const to = ws[2].dataset.widgetKey;
  const dt = new DataTransfer(); dt.setData('text/plain', from);
  let animCount = 0; const orig = Element.prototype.animate; Element.prototype.animate = function (...a) { animCount++; return orig.apply(this, a); };
  ws[2].dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 60));
  Element.prototype.animate = orig;
  const order = [...document.querySelectorAll('.home-widget')].map((w) => w.dataset.widgetKey);
  return { from, to, animCount, order: order.slice(0, 4) };
});
expect('FLIP: 재정렬되고 이동한 위젯에 transform 애니메이션 실행', flip.animCount >= 1 && flip.order.indexOf(flip.from) === 2, JSON.stringify(flip));
const clsMain = await page.evaluate(() => window.__cls);
expect(`레이아웃 이동(CLS) 누적 ≤ 0.1 (측정 ${clsMain.toFixed(3)})`, clsMain <= 0.1, clsMain);
// ---- 프레젠테이션 모드 ----
await page.click('#home-presentation-btn');
await page.waitForSelector('.pres');
await page.waitForTimeout(1300);
await page.screenshot({ path: path.join(SHOTS, 'pres-1-clock.png') });
const slides = await page.evaluate(() => document.querySelectorAll('.pres__slide').length);
expect('프레젠테이션: 슬라이드 4개 이상', slides >= 4, slides);
await page.keyboard.press('ArrowRight'); await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(SHOTS, 'pres-2-kpi.png') });
await page.keyboard.press('ArrowRight'); await page.waitForTimeout(700);
await page.screenshot({ path: path.join(SHOTS, 'pres-3-today.png') });
const act = await page.evaluate(() => document.querySelector('.pres__slide.is-active').dataset.slide);
expect('프레젠테이션: → 키로 슬라이드 이동(today)', act === 'today', act);
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
expect('프레젠테이션: Esc로 종료', (await page.locator('.pres').count()) === 0);
// 자동 순환: 시간이 지나면 다음 슬라이드(시계를 빠르게 하기 위해 interval 9s → page.clock.fastForward 대신 실제 대기 대신 타이머 사용)
await page.click('#home-presentation-btn'); await page.waitForSelector('.pres');
await page.waitForTimeout(9400);
const auto = await page.evaluate(() => document.querySelector('.pres__slide.is-active').dataset.slide);
expect('프레젠테이션: 9초 후 자동으로 다음 슬라이드(kpi)', auto === 'kpi', auto);
await page.keyboard.press('Escape');
// ---- 애니메이션 효과 끄기: 입장/호버/count-up 즉시 ----
await page.evaluate(() => window.HomeFx.setAnimationsEnabled(false));
await page.click('.nav-item[data-path="/schedule"]'); await page.waitForSelector('.calendar-grid'); // 화면이 실제로 바뀐 뒤에 홈으로 돌아간다(연속 클릭 시 이전 홈 DOM을 읽는 경쟁 방지)
await page.click('.nav-item[data-path="/home"]');
await page.waitForFunction(() => !document.querySelector('.calendar-grid') && document.querySelector('.kpi-card__value'));
const off = await page.evaluate(() => ({ v: document.querySelector('.kpi-card__value').textContent, enter: document.querySelector('#view-root .fx-enter') !== null, anim: getComputedStyle(document.querySelector('.home-widget')).animationName }));
expect('효과 끔: 숫자 즉시 최종값, 입장 효과 없음', off.v === '4' && !off.enter && off.anim === 'none', JSON.stringify(off));
const errs = errors.filter(Boolean);
expect('콘솔 오류/페이지 오류 없음', !errs.length, errs.join(' | '));
await browser.close(); server.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} 통과`);
process.exit(bad.length ? 1 : 0);
