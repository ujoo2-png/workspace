// 실제 브라우저에서 "저장 버튼 → 모달 닫힘 → 목록에 보임"까지의 시간과 store 호출 수를 신/구 버전에서 같은 방식으로 잰다.
// 로컬 스토어의 모든 호출에 가짜 네트워크 지연(기본 120ms)을 넣어 Supabase 왕복을 흉내 낸다.
import { serve, launch, login } from './harness.mjs';
const [root, port, label, lat = '120'] = process.argv.slice(2);
const server = await serve(root, Number(port));
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
await login(page, `http://localhost:${port}`);
await page.evaluate((lat) => {
  const s = window.appState.store;
  window.__calls = [];
  for (const m of ['list', 'get', 'create', 'createMany', 'update', 'remove', 'softDelete']) {
    if (!s[m]) continue;
    const o = s[m].bind(s);
    s[m] = async (t, ...r) => { window.__calls.push(`${m}:${t}`); await new Promise((res) => setTimeout(res, Number(lat))); return o(t, ...r); };
  }
}, lat);
await page.click('.nav-item[data-path="/health"]');
await page.waitForSelector('#view-root h1');

async function measure(name, fillFn, visibleText) {
  await page.evaluate(() => { window.__calls.length = 0; });
  await page.click('button:has-text("+ 기록 추가")');
  await page.waitForSelector('.nm-modal form');
  await fillFn();
  const t = await page.evaluate(async (visibleText) => {
    const form = document.querySelector('.nm-modal form');
    const t0 = performance.now();
    form.requestSubmit();
    let modalGone = null, visible = null;
    while (performance.now() - t0 < 5000 && (modalGone === null || visible === null)) {
      if (modalGone === null && !document.querySelector('.nm-modal-backdrop')) modalGone = performance.now() - t0;
      if (visible === null && document.querySelector('#view-root').innerText.includes(visibleText)) visible = performance.now() - t0;
      await new Promise((r) => requestAnimationFrame(r));
    }
    return { modalGoneMs: Math.round(modalGone), listVisibleMs: Math.round(visible) };
  }, visibleText);
  await page.waitForTimeout(2500); // 백그라운드 작업이 끝나도록
  const calls = await page.evaluate(() => window.__calls.slice());
  return { name, ...t, storeCalls: calls.length, listCalls: calls.filter((c) => c.startsWith('list:')).length };
}
const out = [];
out.push(await measure('체중 저장', async () => {
  await page.selectOption('.nm-modal select[name=metric_type]', 'weight');
  await page.fill('.nm-modal input[name=value]', '75.5');
  await page.fill('.nm-modal input[name=note]', 'm-weight');
}, 'm-weight'));
out.push(await measure('혈압 저장', async () => {
  await page.selectOption('.nm-modal select[name=metric_type]', 'blood_pressure');
  await page.fill('.nm-modal input[name=bp_systolic]', '121');
  await page.fill('.nm-modal input[name=bp_diastolic]', '79');
  await page.fill('.nm-modal input[name=note]', 'm-bp');
}, 'm-bp'));
console.log(JSON.stringify({ label, latencyMs: Number(lat), results: out, consoleErrors: errors }, null, 1));
await browser.close(); server.close();
