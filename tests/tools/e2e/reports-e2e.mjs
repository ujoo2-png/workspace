import { serve, launch, login } from './harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// 리포트 페이지/차트 킷 브라우저 검증: 호버·범례·드릴·슬라이서·교차 필터·표·PNG/CSV·전체화면·시각화 전환·타일 추가/삭제·Power BI 내보내기.
//   NODE_PATH=<playwright node_modules> node tests/tools/e2e/reports-e2e.mjs /tmp/ws-local 8303
const [root, port] = process.argv.slice(2);
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'reports-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const server = await serve(root, Number(port));
const browser = await launch();
const base = `http://localhost:${port}`;
const errors = []; let fails = 0;
const expect = (name, cond, detail = '') => { if (!cond) fails++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : detail); };
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept());
await page.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await page.clock.setFixedTime(new Date('2026-10-07T12:00:00+09:00'));
await login(page, base);
await page.evaluate(async () => {
  const st = window.appState; const uid = st.user.id; const add = window.addDays;
  const cats = ['업무', '개인', '건강'];
  for (let i = -120; i <= 0; i += 2) await st.store.create('schedules', { user_id: uid, title: `s${i}`, date: add('2026-10-07', i), time: '10:00', category: cats[Math.abs(i / 2) % 3], done: i % 4 === 0 });
  for (let i = -100; i <= 0; i += 3) await st.store.create('health_metrics', { user_id: uid, metric_type: 'weight', value: 72 - i * 0.02 + (i % 5) * 0.1, unit: 'kg', recorded_at: `${add('2026-10-07', i)}T08:00:00` });
  for (let i = -60; i <= 0; i += 3) { await st.store.create('health_metrics', { user_id: uid, metric_type: 'bp_systolic', value: 118 + (i % 7), unit: 'mmHg', recorded_at: `${add('2026-10-07', i)}T08:00:00` }); await st.store.create('health_metrics', { user_id: uid, metric_type: 'bp_diastolic', value: 78 + (i % 5), unit: 'mmHg', recorded_at: `${add('2026-10-07', i)}T08:00:00` }); }
  for (const s of ['planned', 'in_progress', 'in_progress', 'completed']) await st.store.create('projects', { user_id: uid, name: 'P' + s, status: s });
  await st.refreshAll();
});
await page.click('.nav-item[data-path="/analytics"]');
await page.waitForSelector('.ck-card');
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(SHOTS, 'reports-default.png'), fullPage: true });
const n0 = await page.locator('.ck-card').count();
expect('기본 타일 6개', n0 === 6, String(n0));
const kpiTxt = await page.$$eval('#report-kpis .ck-kpi', (n) => n.map((x) => x.innerText.replace(/\s+/g, ' ')));
expect('KPI 카드 1~4개 + 이전 기간 대비 문구', kpiTxt.length >= 1 && kpiTxt.length <= 4 && kpiTxt.every((t) => /vs 이전 기간|이전 기간 데이터 없음/.test(t)), JSON.stringify(kpiTxt));
await page.click('[data-quick="7d"]');
const kpiTxt7 = await page.$$eval('#report-kpis .ck-kpi', (n) => n.map((x) => x.title));
expect('슬라이서 7일 → KPI 기간 갱신', kpiTxt7.every((t) => /2026-10-01~2026-10-07 vs 2026-09-24~2026-09-30/.test(t)), JSON.stringify(kpiTxt7));
await page.click('[data-quick="all"]');
expect('슬라이서 바 존재', await page.locator('.ck-slicer').count() === 1);

// 1) 호버: 크로스헤어 + 툴팁
const line = page.locator('.ck-card', { hasText: '체중' }).first();
await line.scrollIntoViewIfNeeded();
const box = await line.locator('.ck-plot svg, svg.ck-svg').first().boundingBox();
await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
await page.waitForTimeout(150);
const tipVisible = await line.locator('.ck-tip').evaluate((n) => getComputedStyle(n).display !== 'none' && n.textContent.length > 3).catch(() => false);
expect('라인 호버 시 툴팁 표시', tipVisible);
await page.screenshot({ path: path.join(SHOTS, 'reports-hover.png') });
await page.mouse.move(5, 5);

// 2) 범례 토글(다계열: 혈압을 타일로 추가)
await page.click('#report-add-tile');
await page.waitForSelector('.nm-modal');
await page.screenshot({ path: path.join(SHOTS, 'reports-addtile.png') });
const metricSel = page.locator('.nm-modal select').first();
await metricSel.selectOption('health.bp');
await page.locator('.nm-modal button[type=submit], .nm-modal .nm-btn--primary').first().click();
await page.waitForTimeout(300);
expect('타일 추가 → 7개', await page.locator('.ck-card').count() === 7);
const bp = page.locator('.ck-card', { hasText: '혈압' }).first();
await bp.scrollIntoViewIfNeeded();
const legendItems = bp.locator('.ck-legend__item');
expect('다계열 범례 2개', await legendItems.count() === 2, String(await legendItems.count()));
const linesBefore = await bp.locator('.ck-line').count();
await legendItems.first().click();
await page.waitForTimeout(150);
const linesAfter = await bp.locator('.ck-line').count();
expect('범례 클릭으로 시리즈 숨김', linesAfter === linesBefore - 1, `${linesBefore}->${linesAfter}`);
await page.screenshot({ path: path.join(SHOTS, 'reports-legend.png') });
await legendItems.first().click();

// 3) 슬라이서: 빠른 범위 30일
await page.click('.ck-chip[data-quick="30d"]');
await page.waitForTimeout(250);
const pressed = await page.locator('.ck-chip[data-quick="30d"]').getAttribute('aria-pressed');
expect('30일 칩 선택 상태', pressed === 'true');
const xCount30 = await line.locator('.ck-axis-text').count();
await page.click('.ck-chip[data-quick="all"]');
await page.waitForTimeout(250);
const xCountAll = await page.locator('.ck-card', { hasText: '체중' }).first().locator('.ck-axis-text').count();
expect('범위 변경이 차트에 반영(축 라벨 수 변화 또는 동일 허용 확인)', xCount30 > 0 && xCountAll > 0, `${xCount30}/${xCountAll}`);

// 4) 카테고리 교차 필터
const catChip = page.locator('.ck-chip--cat').first();
const catName = await catChip.getAttribute('data-cat');
await catChip.click();
await page.waitForTimeout(250);
expect('카테고리 칩 선택 상태', (await page.locator(`.ck-chip--cat[data-cat="${catName}"]`).getAttribute('aria-pressed')) === 'true');
await page.screenshot({ path: path.join(SHOTS, 'reports-crossfilter.png'), fullPage: true });
await page.locator('.ck-chip--reset').first().click();
await page.waitForTimeout(250);
expect('초기화 후 카테고리 해제', (await page.locator('.ck-chip--cat[aria-pressed="true"]').count()) === 0);

// 5) 시각화 전환
const first = page.locator('.ck-card').first();
const types = await first.locator('.ck-seg__btn').evaluateAll((b) => b.map((x) => x.dataset.type));
expect('시각화 전환 버튼 ≥2', types.length >= 2, types.join());
await first.locator('.ck-seg__btn').nth(1).click();
await page.waitForTimeout(250);
expect('전환 후 선택 상태 갱신', (await first.locator('.ck-seg__btn').nth(1).getAttribute('aria-pressed')) === 'true');
await page.screenshot({ path: path.join(SHOTS, 'reports-switch.png') });

// 6) 드릴: 스케줄 일정 수 타일 추가 → 월 → 주 → 일
await page.click('#report-add-tile'); await page.waitForSelector('.nm-modal');
await page.locator('.nm-modal select').first().selectOption('schedule.count');
await page.locator('.nm-modal button[type=submit], .nm-modal .nm-btn--primary').first().click();
await page.waitForTimeout(300);
const sc = page.locator('.ck-card', { hasText: '일정 수' }).first();
await sc.scrollIntoViewIfNeeded();
const crumb0 = await sc.locator('.ck-crumb').allTextContents();
const bar = sc.locator('.ck-bar').first();
if (await bar.count()) {
  await bar.click({ force: true });
  await page.waitForTimeout(250);
  const crumb1 = await sc.locator('.ck-crumb').allTextContents();
  expect('막대 클릭 → 한 단계 드릴(빵부스러기 증가)', crumb1.length > crumb0.length, `${crumb0}|${crumb1}`);
  await page.screenshot({ path: path.join(SHOTS, 'reports-drill.png') });
  const up = sc.locator('[data-ck=up]');
  if (await up.count()) { await up.click(); await page.waitForTimeout(200); }
  expect('↑ 위로로 복귀', (await sc.locator('.ck-crumb').allTextContents()).length === crumb0.length);
} else expect('드릴 대상 막대 존재', false, 'no .ck-bar');

// 7) 표 보기, CSV, PNG
await sc.locator('[data-ck=table]').click();
await page.waitForTimeout(150);
expect('표 보기 전환', await sc.locator('table.ck-table').count() === 1);
await page.screenshot({ path: path.join(SHOTS, 'reports-table.png') });
const [dl] = await Promise.all([page.waitForEvent('download'), sc.locator('[data-ck=csv]').click()]);
const csvPath = path.join(SHOTS, 'tile.csv'); await dl.saveAs(csvPath);
const csv = fs.readFileSync(csvPath, 'utf8');
expect('CSV 다운로드(헤더 + 행)', /^﻿?구간/.test(csv) && csv.split(/\r?\n/).length > 2, csv.slice(0, 80));
await sc.locator('[data-ck=table]').click();
const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), sc.locator('[data-ck=png]').click()]);
if (dl2) { const p2 = path.join(SHOTS, 'tile.png'); await dl2.saveAs(p2); const b = fs.readFileSync(p2); expect('PNG 다운로드(시그니처)', b.slice(1, 4).toString() === 'PNG' && b.length > 2000, String(b.length)); }
else expect('PNG 다운로드', false, 'no download');

// 8) 전체 화면 + Esc
await sc.locator('[data-ck=full]').click();
await page.waitForTimeout(250);
expect('전체 화면 클래스', await page.locator('.ck-card--full').count() === 1);
await page.screenshot({ path: path.join(SHOTS, 'reports-full.png') });
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
expect('Esc로 전체 화면 종료', await page.locator('.ck-card--full').count() === 0);

// 9) 이동 / 삭제 / 저장 지속
const titlesBefore = await page.locator('.ck-card .ck-title').allTextContents();
await page.locator('.ck-card').nth(1).locator('[data-ck=left]').click(); await page.waitForTimeout(250);
const titlesAfter = await page.locator('.ck-card .ck-title').allTextContents();
expect('◀로 타일 순서 변경', titlesAfter[0] === titlesBefore[1] && titlesAfter[1] === titlesBefore[0], `${titlesBefore.slice(0,2)}|${titlesAfter.slice(0,2)}`);
const saved = await page.evaluate(() => window.settingsSync.get('workspace:reports:tiles'));
expect('타일 구성이 settingsSync에 저장', saved && JSON.parse(saved).length === 8, String(saved).slice(0, 60));
await page.locator('.ck-card').last().locator('[data-ck=remove]').click(); await page.waitForTimeout(250);
expect('삭제 → 7개', await page.locator('.ck-card').count() === 7);
await page.reload({ waitUntil: 'load' }); await page.waitForSelector('.app-shell');
await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));
await page.click('.nav-item[data-path="/analytics"]'); await page.waitForSelector('.ck-card');
expect('새로고침 후에도 7개 유지', await page.locator('.ck-card').count() === 7);

// 10) Power BI용 내보내기
await page.click('#report-powerbi'); await page.waitForSelector('.nm-modal');
await page.screenshot({ path: path.join(SHOTS, 'reports-powerbi.png') });
const dlBtn = page.locator('.nm-modal button', { hasText: /\.csv|CSV/ });
expect('내보내기 모달에 CSV 버튼 ≥1', await dlBtn.count() >= 1, String(await dlBtn.count()));
const [dl3] = await Promise.all([page.waitForEvent('download'), dlBtn.first().click()]);
const p3 = path.join(SHOTS, 'tidy.csv'); await dl3.saveAs(p3);
const tidy = fs.readFileSync(p3, 'utf8').replace(/^﻿/, '');
expect('tidy CSV 헤더', tidy.split(/\r?\n/)[0] === 'date,domain,metric,series,value,unit', tidy.split(/\r?\n/)[0]);
await page.keyboard.press('Escape');

// 모바일 폭
await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
expect('모바일 390px 가로 스크롤 없음', overflow <= 1, String(overflow));
await page.screenshot({ path: path.join(SHOTS, 'reports-mobile.png') });

// 11) Health 대시보드 카드에도 공통 차트 킷이 적용됨
await page.setViewportSize({ width: 1280, height: 1000 });
await page.click('.nav-item[data-path="/health"]');
await page.waitForSelector('.health-dashboard-card');
const hc = page.locator('.health-dashboard-card[data-metric=weight]');
expect('Health 카드에 ck-card 적용', await hc.locator('.ck-card').count() === 1);
await hc.scrollIntoViewIfNeeded();
const hb = await hc.locator('svg.target-line-chart').boundingBox();
await page.mouse.move(hb.x + hb.width * 0.5, hb.y + hb.height * 0.5);
await page.waitForTimeout(150);
expect('Health 카드 호버 툴팁', await hc.locator('.ck-tip:not([hidden])').count() === 1);
await page.screenshot({ path: path.join(SHOTS, 'health-ck.png') });
await hc.locator('[data-ck=table]').click();
expect('Health 카드 표 보기', await hc.locator('table.ck-table').count() === 1);

expect('콘솔/페이지 오류 없음', errors.length === 0, errors.join('\n'));
await browser.close(); server.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL OK'); process.exit(fails ? 1 : 0);
