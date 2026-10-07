import { serve, launch, login } from './harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// 홈 시계 카드 날씨 테마 브라우저 검증(Playwright). 로컬 모드 임시 복사본 폴더와 포트를 인자로 준다.
//   NODE_PATH=<playwright가 설치된 node_modules> node tests/tools/e2e/home-weather-e2e.mjs /tmp/ws-local 8301
// Open-Meteo는 page.route로 가짜 응답을 준다(실제 네트워크 사용 안 함). 스크린샷은 $SHOTS(기본 임시 폴더)에 저장.
const [root, port] = process.argv.slice(2);
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'home-weather-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const server = await serve(root, Number(port));
const browser = await launch();
const base = `http://localhost:${port}`;
const results = []; const errors = [];
const expect = (name, cond, detail = '') => { results.push({ name, ok: !!cond }); console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : detail); };

// 시나리오: 오늘(2026-10-07, KST) 시간별 슬롯 생성
function bundle(spec) {
  const days = Array.from({ length: 7 }, (_, i) => `2026-10-${String(7 + i).padStart(2, '0')}`);
  const hours = []; const code = []; const pop = []; const precip = [];
  for (const d of days) for (let h = 0; h < 24; h++) {
    hours.push(`${d}T${String(h).padStart(2, '0')}:00`);
    const f = d === days[0] ? spec.slot(h) : { code: 3, pop: 10, precip: 0 };
    code.push(f.code); pop.push(f.pop); precip.push(f.precip);
  }
  return {
    utc_offset_seconds: 32400, current: { temperature_2m: spec.temp ?? 17.4, weather_code: spec.slot(12).code },
    daily: { time: days, temperature_2m_max: days.map(() => 21), temperature_2m_min: days.map(() => 12), weather_code: days.map((d, i) => (i ? 3 : spec.dayCode)), precipitation_probability_max: days.map((d, i) => (i ? 10 : spec.dayPop)), precipitation_sum: days.map(() => 0) },
    hourly: { time: hours, weather_code: code, precipitation_probability: pop, precipitation: precip },
  };
}
const SC = {
  rainAm: { at: '09:00', dayCode: 63, dayPop: 70, slot: (h) => (h >= 6 && h < 12 ? { code: 63, pop: 70, precip: 0.8 } : { code: 3, pop: 20, precip: 0 }), expect: /인천 · 오전 비 · 강수확률 70%/, wx: 'rain' },
  snow: { at: '14:00', dayCode: 73, dayPop: 80, slot: () => ({ code: 73, pop: 80, precip: 1.2 }), expect: /오후 눈 · 강수확률 80%/, wx: 'snow' },
  clearDay: { at: '10:00', dayCode: 0, dayPop: 0, slot: () => ({ code: 0, pop: 0, precip: 0 }), expect: /오전 맑음/, wx: 'clear' },
  cloudy: { at: '14:00', dayCode: 3, dayPop: 20, slot: () => ({ code: 3, pop: 20, precip: 0 }), expect: /오후 흐림/, wx: 'cloudy' },
  clearNight: { at: '22:00', dayCode: 0, dayPop: 0, slot: () => ({ code: 0, pop: 0, precip: 0 }), expect: /밤 맑음/, wx: 'clear' },
  thunder: { at: '15:00', dayCode: 95, dayPop: 90, slot: () => ({ code: 95, pop: 90, precip: 6 }), expect: /뇌우 · 강수확률 90%/, wx: 'thunder' },
  fog: { at: '08:00', dayCode: 45, dayPop: 5, slot: () => ({ code: 45, pop: 5, precip: 0 }), expect: /오전 안개/, wx: 'fog' },
  evening: { at: '17:30', dayCode: 0, dayPop: 0, slot: () => ({ code: 0, pop: 0, precip: 0 }), expect: /저녁 맑음/, wx: 'clear' },
};

async function openHome(name, opts = {}) {
  const spec = SC[name];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: opts.reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
  const hits = [];
  await page.route('**/api.open-meteo.com/**', (r) => { hits.push(r.request().url()); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bundle(spec)) }); });
  await page.clock.setFixedTime(new Date(`2026-10-07T${spec.at}:00+09:00`));
  await login(page, base);
  await page.evaluate(() => {
    window.settingsSync.set('workspace:weatherCities', JSON.stringify([{ name: '인천', lat: 37.4563, lon: 126.7052 }, { name: '부산', lat: 35.1796, lon: 129.0756 }]));
    window.settingsSync.set('workspace:clockTimezones', JSON.stringify([{ id: 'Asia/Seoul', label: '대한민국' }, { id: 'America/New_York', label: '뉴욕' }]));
  });
  await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.startsWith('workspace:wx:')).forEach((k) => localStorage.removeItem(k)); });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.clock-card');
  await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));
  await page.waitForSelector('.wx-cell--on [data-wx-caption]', { timeout: 8000 });
  return { page, ctx, hits };
}

for (const name of Object.keys(SC)) {
  const spec = SC[name];
  const { page, ctx, hits } = await openHome(name);
  await page.waitForTimeout(1700); // 크로스페이드/입장 애니메이션 끝
  const info = await page.evaluate(() => {
    const cell = document.querySelector('.wx-cell--on');
    const cap = cell.querySelector('[data-wx-caption]').textContent;
    const cs = getComputedStyle(cell);
    return { cap, wx: cell.dataset.wx, part: cell.dataset.wxPart, color: cs.color, particles: cell.querySelectorAll('.wx-particles i').length, icon: !!cell.querySelector('.wxi svg') };
  });
  expect(`${name}: 캡션 "${info.cap}"`, spec.expect.test(info.cap), info.cap);
  expect(`${name}: data-wx=${spec.wx}`, info.wx === spec.wx, info.wx);
  expect(`${name}: 입자 40개 이하`, info.particles <= 40, info.particles);
  expect(`${name}: 날씨 아이콘 SVG`, info.icon);
  if (['rainAm', 'snow', 'thunder'].includes(name)) expect(`${name}: 입자가 실제로 있음`, info.particles >= 14, info.particles);
  if (['clear', 'clearDay', 'cloudy', 'fog'].includes(name)) expect(`${name}: 입자 없음`, info.particles === 0, info.particles);
  // 같은 좌표(인천)는 번들 1회만 호출(시계 카드 + 날씨 위젯 + 주간 데이터가 공유) — 뉴욕 시계는 서울 연결이라 같은 도시
  const incheon = hits.filter((u) => u.includes('latitude=37.4563')).length;
  expect(`${name}: 인천 Open-Meteo 호출 1회(중복 없음)`, incheon === 1, `${incheon}회`);
  await page.locator('.clock-card').screenshot({ path: path.join(SHOTS, `wx-${name}.png`) });
  if (name === 'rainAm') {
    // 두 번째 시계(뉴욕) 연결 도시: 프리셋에 뉴욕이 있으므로 뉴욕 좌표 호출이 따로 있어야 한다
    await page.screenshot({ path: path.join(SHOTS, 'home-full-rain.png'), fullPage: false });
    const ny = hits.filter((u) => u.includes('latitude=40.7128')).length;
    expect(`rainAm: 뉴욕 시계는 뉴욕 도시에 연결(별도 1회)`, ny === 1, `${ny}회`);
  }
  await ctx.close();
}

// ----- 모션 줄이기: 애니메이션 없음 + 입자 숨김, 아이콘/그라디언트는 그대로 -----
{
  const { page, ctx } = await openHome('rainAm', { reduced: true });
  const r = await page.evaluate(() => {
    const cell = document.querySelector('.wx-cell--on');
    const layer = cell.querySelector('.wx-bg__to');
    const parts = cell.querySelector('.wx-particles');
    const drop = cell.querySelector('.wxi-drop');
    return { layerAnim: getComputedStyle(layer).animationName, partsDisplay: parts ? getComputedStyle(parts).display : 'none', dropAnim: drop ? getComputedStyle(drop).animationName : 'none', hasBg: layer.style.background.includes('linear-gradient') };
  });
  expect('reduced-motion: 배경 애니메이션 없음', r.layerAnim === 'none', r.layerAnim);
  expect('reduced-motion: 입자 숨김', r.partsDisplay === 'none', r.partsDisplay);
  expect('reduced-motion: 아이콘 애니메이션 없음', r.dropAnim === 'none', r.dropAnim);
  expect('reduced-motion: 그라디언트는 그대로', r.hasBg);
  await ctx.close();
}
// ----- 탭 숨김: wx-paused 클래스 -----
{
  const { page, ctx } = await openHome('rainAm');
  const r = await page.evaluate(async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    const paused = document.documentElement.classList.contains('wx-paused');
    const state = getComputedStyle(document.querySelector('.wx-particles i')).animationPlayState;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    return { paused, state, resumed: !document.documentElement.classList.contains('wx-paused') };
  });
  expect('탭 숨김 시 wx-paused + animation-play-state: paused', r.paused && r.state === 'paused' && r.resumed, JSON.stringify(r));
  await ctx.close();
}
// ----- 설정 "애니메이션 효과" 끄기: 입자 숨김, 그라디언트 유지 -----
{
  const { page, ctx } = await openHome('rainAm');
  await page.evaluate(() => window.HomeFx.setAnimationsEnabled(false));
  const r = await page.evaluate(() => ({ off: document.documentElement.classList.contains('fx-off'), parts: getComputedStyle(document.querySelector('.wx-particles')).display, anim: getComputedStyle(document.querySelector('.wx-bg__to')).animationName }));
  expect('애니메이션 효과 끔: fx-off + 입자 숨김 + 애니메이션 없음', r.off && r.parts === 'none' && r.anim === 'none', JSON.stringify(r));
  await ctx.close();
}
await browser.close(); server.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} 통과`);
if (errors.length) { console.log('콘솔/페이지 오류:', errors); }
process.exit(bad.length || errors.length ? 1 : 0);
