import { serve, launch, login } from './harness.mjs';
// 홈 애니메이션 성능 측정: Long Task 개수/최대, rAF 프레임 간격(평균/p95/최대, 16.7ms 초과 비율), 입장~안정 구간 + 1초 유휴 구간.
//   NODE_PATH=<playwright node_modules> node tests/tools/e2e/measure-home-jank.mjs /tmp/ws-local 8320
const [root, port] = process.argv.slice(2);
const server = await serve(root, Number(port));
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await page.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"utc_offset_seconds":32400,"current":{"temperature_2m":17,"weather_code":63},"daily":{"time":["2026-10-07"],"weather_code":[63],"precipitation_probability_max":[70]},"hourly":{"time":["2026-10-07T09:00"],"weather_code":[63],"precipitation_probability":[70],"precipitation":[0.8]}}' }));
await login(page, `http://localhost:${port}`);
await page.evaluate(async () => { const st = window.appState; for (let i = 0; i < 5; i++) await st.store.create('schedules', { user_id: st.user.id, title: 's' + i, date: new Date().toLocaleDateString('sv-SE'), time: '10:00', category: '개인' }); });
await page.evaluate(() => {
  window.__lt = []; window.__fr = [];
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ entryTypes: ['longtask'] });
  let last = performance.now(); (function loop(t) { window.__fr.push(t - last); last = t; requestAnimationFrame(loop); })(last);
});
const stats = (a) => { const s = a.slice().sort((x, y) => x - y); return { n: s.length, avg: +(s.reduce((x, y) => x + y, 0) / (s.length || 1)).toFixed(1), p95: +(s[Math.floor(s.length * 0.95)] || 0).toFixed(1), max: +(s[s.length - 1] || 0).toFixed(1), over20: +(s.filter((x) => x > 20).length / (s.length || 1) * 100).toFixed(1) }; };
const collect = () => page.evaluate(() => { const r = { lt: window.__lt.slice(), fr: window.__fr.slice(1) }; window.__lt.length = 0; window.__fr.length = 0; return r; });
await page.evaluate(() => { location.hash = '#/home'; }); await page.reload({ waitUntil: 'load' });
await page.evaluate(() => { window.__lt = []; window.__fr = []; new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ entryTypes: ['longtask'] }); let last = performance.now(); (function loop(t) { window.__fr.push(t - last); last = t; requestAnimationFrame(loop); })(last); });
await page.waitForTimeout(2500);
const enter = await collect();
await page.waitForTimeout(2000);
const idle = await collect();
console.log(JSON.stringify({ 'enter_2.5s': { frames: stats(enter.fr), longTasks: { n: enter.lt.length, max: Math.max(0, ...enter.lt) } }, 'idle_2s': { frames: stats(idle.fr), longTasks: { n: idle.lt.length, max: Math.max(0, ...idle.lt) } } }, null, 1));
await browser.close(); server.close();
