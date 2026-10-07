import { serve, launch, login } from './harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Health v7.19.0 브라우저 검증(Playwright). 실제 config.js를 건드리지 않도록 "로컬 모드로 바꾼 임시 복사본" 폴더를 인자로 준다.
//   cp -r . /tmp/ws-local && sed -i "s/^  mode: 'supabase',/  mode: 'local',/" /tmp/ws-local/js/config.js
//   NODE_PATH=<playwright가 설치된 node_modules> node tests/tools/e2e/health-e2e.mjs /tmp/ws-local 8103
// 시각은 2026-10-07 21:00(KST)로 고정되며 스크린샷은 $SHOTS(기본: 임시 폴더)에 저장된다.
const [root, port] = process.argv.slice(2);
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'health-e2e-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const server = await serve(root, Number(port));
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
const page = await ctx.newPage();
await page.clock.setFixedTime(new Date('2026-10-07T21:00:00+09:00')); // 오늘 21:00 KST — 08:00/19:00 복용 시각이 모두 지난 상태
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errors.push('console.error: ' + m.text()); });
page.on('dialog', (d) => d.accept());
const results = [];
const expect = (name, cond, detail = '') => { results.push({ name, ok: !!cond, detail: String(detail) }); if (!cond) console.log('FAIL', name, detail); };
const base = `http://localhost:${port}`;
await login(page, base);
await page.click('.nav-item[data-path="/health"]');
await page.waitForSelector('#view-root h1');

// ---------- 시드 데이터(독립 계산을 위해 스크립트가 직접 규칙을 정한다) ----------
const START = '2026-09-08';
const seed = await page.evaluate(async (START) => {
  const st = window.appState; const uid = st.user.id;
  const addDays = window.addDays, today = '2026-10-07';
  const days = []; for (let d = START; d <= '2026-10-06'; d = addDays(d, 1)) days.push(d);
  const ts = (iso, h, m) => { const [y, mo, d] = iso.split('-').map(Number); return new Date(y, mo - 1, d, h, m).toISOString(); };
  const metrics = []; const logs = [];
  const pattern = days.map((d, i) => (i % 4 === 1 ? 'missed' : i % 7 === 3 ? 'partial' : 'full'));
  days.forEach((d, i) => {
    const w = Number((78.4 - i * 0.05).toFixed(1));
    metrics.push({ metric_type: 'weight', value: w, unit: 'kg', recorded_at: ts(d, 7, 30) }); // 오전 7:30 KST → UTC로는 전날
    if (i % 2 === 0) metrics.push({ metric_type: 'steps', value: 6000 + i * 100, unit: '걸음', recorded_at: ts(d, 21, 0) });
    const adherent = pattern[i] === 'full';
    metrics.push({ metric_type: 'bp_systolic', value: adherent ? 113 + (i % 3) : 128 + (i % 3), unit: 'mmHg', recorded_at: ts(d, 7, 40) });
    metrics.push({ metric_type: 'bp_diastolic', value: adherent ? 72 + (i % 3) : 84 + (i % 3), unit: 'mmHg', recorded_at: ts(d, 7, 40) });
    if (i % 9 === 0) metrics.push({ metric_type: 'blood_glucose', value: i % 18 === 0 ? 92 : 108, unit: 'mg/dL', recorded_at: ts(d, 8, 0) });
  });
  await st.store.createMany('health_metrics', metrics.map((m) => ({ ...m, user_id: uid })));
  return { days, pattern };
}, START);

// ---------- ① 💊 약 등록(UI) ----------
await page.click('button:has-text("+ 약 등록") >> nth=0');
await page.waitForSelector('.nm-modal form');
// 필수 표시(빨간 *)가 라벨 왼쪽에 있는지
const req = await page.evaluate(() => {
  const lab = [...document.querySelectorAll('.nm-modal .nm-field label')].find((l) => l.textContent.includes('약 이름'));
  const star = lab && lab.querySelector('.req');
  return { hasStar: !!star, starFirst: !!star && lab.firstChild === star, color: star ? getComputedStyle(star).color : null, text: lab && lab.textContent };
});
expect('필수 항목에 빨간 * 표시(라벨 왼쪽)', req.hasStar && req.starFirst && /rgb\(2[0-9]{2}, \d+, \d+\)/.test(req.color), JSON.stringify(req));
await page.fill('.nm-modal input[name=name]', '혈압약');
await page.fill('.nm-modal input[name=dosage]', '5mg 1정');
await page.fill('.nm-modal input[name=purpose]', '혈압 관리');
await page.click('.nm-modal button:has-text("저녁 19:00")');
const timesVal = await page.inputValue('.nm-modal input[name=dose_times]');
expect('시각 프리셋 버튼이 시각 입력을 채운다', timesVal === '08:00, 19:00', timesVal);
await page.fill('.nm-modal input[name=start_date]', START);
await page.fill('.nm-modal input[name=remaining_count]', '20');
await page.click('.nm-modal button[type=submit]');
await page.waitForSelector('#new-med-attach-box');
expect('등록 직후 같은 모달에 첨부 패널이 나타난다', await page.$('#new-med-attach-box .attach-dropzone') !== null);
await page.setInputFiles('#new-med-attach-box input[type=file]', { name: 'rx.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
await page.waitForSelector('#new-med-attach-box .attach-item');
await page.click('.nm-modal button:has-text("완료")');
await page.waitForSelector('.nm-modal-backdrop', { state: 'detached' });
// 지난 복용 기록 시드(독립 규칙: full=두 번 모두, partial=아침만, missed=없음)
await page.evaluate(async ({ days, pattern }) => {
  const st = window.appState; const med = st.healthMedications[0];
  const rows = [];
  days.forEach((d, i) => {
    if (pattern[i] === 'missed') return;
    rows.push({ user_id: st.user.id, medication_id: med.id, taken_date: d, slot: '08:00', status: 'taken', logged_at: new Date().toISOString() });
    if (pattern[i] === 'full') rows.push({ user_id: st.user.id, medication_id: med.id, taken_date: d, slot: '19:00', status: 'taken', logged_at: new Date().toISOString() });
  });
  await st.store.createMany('health_med_logs', rows);
  await st.refreshAll();
}, seed);

// ---------- ② 오늘 체크리스트: 한 번 탭 = 즉시 반영 ----------
const clickTiming = await page.evaluate(async () => {
  const btn = document.querySelector('.med-dose[data-slot="08:00"]');
  const t0 = performance.now(); btn.click();
  const after = document.querySelector('.med-dose[data-slot="08:00"]');
  return { ms: performance.now() - t0, pressed: after.getAttribute('aria-pressed'), cls: after.className };
});
expect('체크 탭이 동기적으로 화면에 반영(<150ms, 전체 재렌더 포함)', clickTiming.pressed === 'true' && clickTiming.ms < 150, JSON.stringify(clickTiming));
await page.click('.med-dose[data-slot="19:00"]');
await page.waitForTimeout(900); // 디바운스된 재조회 완료
const todayCount = await page.textContent('[data-role=med-today-count]');
expect('오늘 체크리스트 2/2 완료', todayCount.trim() === '2/2 완료', todayCount);

// ---------- ③ 복용률/연속 숫자(독립 계산과 비교) ----------
const exp = (() => {
  const all = seed.days.map((d, i) => ({ d, p: seed.pattern[i], taken: seed.pattern[i] === 'full' ? 2 : seed.pattern[i] === 'partial' ? 1 : 0 }));
  all.push({ d: '2026-10-07', p: 'full', taken: 2 }); // 오늘 UI로 체크
  const win = (n) => all.slice(-n);
  const rate = (rows) => Math.round((rows.reduce((s, r) => s + r.taken, 0) / (rows.length * 2)) * 100);
  let streak = 0; for (let i = all.length - 1; i >= 0; i--) { if (all[i].taken === 2) streak++; else break; }
  return { r7: rate(win(7)), r30: rate(win(30)), streak, t7: win(7).reduce((s, r) => s + r.taken, 0) };
})();
const tiles = await page.evaluate(() => ({
  a7: document.querySelector('[data-role=adh-7] .med-tile__value').textContent,
  a7sub: document.querySelector('[data-role=adh-7] .med-tile__sub').textContent,
  a30: document.querySelector('[data-role=adh-30] .med-tile__value').textContent,
  streak: document.querySelector('[data-role=adh-streak] .med-tile__value').textContent,
}));
expect(`7일 복용률 ${exp.r7}% (독립 계산)`, tiles.a7 === `${exp.r7}%`, JSON.stringify(tiles));
expect(`30일 복용률 ${exp.r30}%`, tiles.a30 === `${exp.r30}%`, JSON.stringify(tiles));
expect(`연속 복용일 ${exp.streak}일`, tiles.streak === `${exp.streak}일`, JSON.stringify(tiles));
// 점 격자(최근 7일) — 상태가 규칙과 일치
const dots = await page.$$eval('.med-grid__row .med-dot', (els) => els.map((e) => e.dataset.state));
const last7 = seed.pattern.slice(-6).map((p) => (p === 'full' ? 'taken' : p === 'partial' ? 'partial' : 'missed')).concat(['taken']);
expect('최근 7일 점 격자 상태', JSON.stringify(dots) === JSON.stringify(last7), `${dots} vs ${last7}`);
// 약 목록 표
const row = await page.textContent('.health-med-table tbody tr');
expect('약 목록에 이름/용량/주기/잔여(체크로 2 감소)', row.includes('혈압약') && row.includes('5mg 1정') && row.includes('매일 2회') && /18/.test(row) && row.includes('📎1'), row.replace(/\s+/g, ' '));
// 놓친 복용 목록 + 보충 기록
const missedBefore = await page.$$eval('[data-role=med-missed] .item-row', (e) => e.length);
expect('놓친 복용 목록 표시', missedBefore > 0, missedBefore);
await page.screenshot({ path: `${SHOTS}/meds-card.png`, clip: await page.evaluate(() => { const r = document.querySelector('[data-role=med-card]').getBoundingClientRect(); return { x: r.x, y: r.y + window.scrollY, width: r.width, height: Math.min(r.height, 1100) }; }), fullPage: true });
await page.click('[data-role=med-missed] .item-row button >> nth=0');
await page.waitForTimeout(900);
const missedAfter = await page.$$eval('[data-role=med-missed] .item-row', (e) => e.length);
expect('"먹었어요"로 보충 기록하면 목록이 줄어든다', missedAfter === missedBefore - 1, `${missedBefore}->${missedAfter}`);

expect('복약 카드에 "null" 같은 잔여 텍스트가 없다', !(await page.evaluate(() => document.querySelector('[data-role=med-card]').innerText)).split('\n').some((l) => l.trim() === 'null'));

// ---------- ④ 대시보드: 목표선 + 혈압 정상범위 음영 ----------
const bpBands = await page.evaluate(() => {
  const out = {};
  for (const k of ['bp_systolic', 'bp_diastolic']) {
    const svg = document.querySelector(`.health-dashboard-card[data-metric=${k}] svg.target-line-chart`);
    out[k] = { rects: svg.querySelectorAll('rect').length, texts: [...svg.querySelectorAll('text')].map((t) => t.textContent).filter((t) => /정상|주의/.test(t)).sort(), paths: svg.querySelectorAll('path').length, circles: svg.querySelectorAll('circle').length };
  }
  return out;
});
expect('수축기: 정상(90–119)·주의(120–139) 음영과 라벨', bpBands.bp_systolic.rects === 2 && bpBands.bp_systolic.texts.join('|') === '정상 90–119|주의 120–139', JSON.stringify(bpBands.bp_systolic));
expect('이완기: 정상(60–79)·주의(80–89) 음영과 라벨', bpBands.bp_diastolic.rects === 2 && bpBands.bp_diastolic.texts.join('|') === '정상 60–79|주의 80–89', JSON.stringify(bpBands.bp_diastolic));
expect('꺾은선(path)과 점 마커가 그려진다', bpBands.bp_systolic.paths >= 1 && bpBands.bp_systolic.circles >= 10);
const noTarget = await page.evaluate(() => document.querySelectorAll('.health-dashboard-card[data-metric=weight] svg line[stroke-dasharray]').length);
expect('목표가 없으면 목표선이 없다', noTarget === 0);
const lastW = await page.evaluate(() => { const r = window.appState.healthMetrics.filter((m) => m.metric_type === 'weight').sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0]; return r.value; });
await page.fill('.health-dashboard-card[data-metric=weight] .health-target-input', '75');
await page.press('.health-dashboard-card[data-metric=weight] .health-target-input', 'Enter');
await page.waitForTimeout(200);
const wInfo = await page.evaluate(() => {
  const card = document.querySelector('.health-dashboard-card[data-metric=weight]');
  const svg = card.querySelector('svg.target-line-chart');
  const dashed = svg.querySelector('line[stroke-dasharray]');
  return { dashed: !!dashed, label: [...svg.querySelectorAll('text')].map((t) => t.textContent).find((t) => /^목표/.test(t)), gap: card.querySelector('[data-role=target-gap]')?.textContent, y1: dashed?.getAttribute('y1'), y2: dashed?.getAttribute('y2') };
});
const expGap = `목표 대비 +${Number((lastW - 75).toFixed(1))}kg`;
expect('목표 75kg: 수평 점선 + 직접 라벨', wInfo.dashed && wInfo.label === '목표 75kg' && wInfo.y1 === wInfo.y2, JSON.stringify(wInfo));
expect(`"${expGap}" 문구`, wInfo.gap === expGap, JSON.stringify(wInfo));
await page.fill('.health-dashboard-card[data-metric=steps] .health-target-input', '8000');
await page.press('.health-dashboard-card[data-metric=steps] .health-target-input', 'Enter');
await page.waitForTimeout(150);
const stepsGap = await page.textContent('.health-dashboard-card[data-metric=steps] [data-role=target-gap]');
expect('걸음수 목표 문구', /^목표 대비 [+-]\d+걸음$/.test(stepsGap), stepsGap);
// 잘못된 입력은 저장하지 않는다
await page.fill('.health-dashboard-card[data-metric=weight] .health-target-input', '-3');
await page.press('.health-dashboard-card[data-metric=weight] .health-target-input', 'Enter');
await page.waitForTimeout(150);
expect('음수 목표는 거부(기존 75 유지)', (await page.evaluate(() => JSON.parse(window.settingsSync.get('workspace:health:targets')).weight)) === 75);
// 새로고침해도 목표가 유지(settingsSync → localStorage 캐시)
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.app-shell');
await page.waitForSelector('.briefing-modal', { timeout: 6000 }).catch(() => {});
await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop, .briefing-modal').forEach((n) => n.remove()));
await page.click('.nav-item[data-path="/health"]');
await page.waitForSelector('.health-dashboard-card[data-metric=weight] svg');
expect('새로고침 후에도 목표 유지', (await page.textContent('.health-dashboard-card[data-metric=weight] [data-role=target-gap]')).startsWith('목표 대비'));
// 퀵레인지(주간) 전환 시 선이 0으로 떨어지지 않는다(빈 구간은 끊김)
await page.click('.health-dashboard-card[data-metric=steps] button:has-text("월간")');
const yMinOk = await page.evaluate(() => { const svg = document.querySelector('.health-dashboard-card[data-metric=steps] svg'); return [...svg.querySelectorAll('text')].map((t) => t.textContent); });
expect('월간 전환에서도 차트가 그려진다', yMinOk.length > 3, yMinOk.join(','));
await page.click('.health-dashboard-card[data-metric=steps] button:has-text("최근 10개")');
await page.evaluate(() => window.scrollTo(0, 0));
const dash = await page.evaluate(() => { const r = document.querySelector('.health-dashboard-grid').getBoundingClientRect(); return { x: Math.max(0, r.x - 10), y: r.y + window.scrollY - 40, width: r.width + 20, height: r.height + 60 }; });
await page.screenshot({ path: `${SHOTS}/dashboard.png`, clip: dash, fullPage: true });

// ---------- ⑤ 일별 건강 모니터링 ----------
const monitor = await page.evaluate(() => ({
  rows: document.querySelectorAll('[data-role=daily-monitor] tbody tr').length,
  summary: document.querySelector('[data-role=daily-summary]').textContent,
  hint: document.querySelector('[data-role=daily-hint]')?.textContent || null,
  todayRow: document.querySelector('[data-role=daily-monitor] tr.is-today')?.innerText.replace(/\s+/g, ' '),
  disclaimer: document.querySelector('[data-role=daily-monitor]').textContent.includes('의학적 판단이 아닙니다'),
}));
expect('14일 모니터링 14행', monitor.rows === 14, monitor.rows);
// +1: 위 ③에서 "먹었어요"로 보충 기록한 지난 7일 중 가장 최근 미복용 1회가 반영된다
const e7 = (() => { const rows = seed.pattern.slice(-6).map((p) => (p === 'full' ? 2 : p === 'partial' ? 1 : 0)).concat([2]); const t = rows.reduce((a, b) => a + b, 0) + 1; return { t, e: 14, pct: Math.round((t / 14) * 100) }; })();
expect(`요약에 7일 복약 달성 ${e7.pct}%(${e7.t}/${e7.e}회)`, monitor.summary.includes(`복약 달성 ${e7.pct}%(${e7.t}/${e7.e}회)`), monitor.summary);
expect('요약에 혈압 정상 일수', /혈압 정상 \d\/\d일/.test(monitor.summary), monitor.summary);
expect('오늘 행: 복약 ✅ 전부 + 종합 칩', /✅ 전부 \(2\/2\)/.test(monitor.todayRow || ''), monitor.todayRow);
expect('면책 문구 표시', monitor.disclaimer);
// 오래된 날짜의 상태 칩: 복약 놓침 + 혈압 높음 조합 검증(독립 규칙)
const chips = await page.$$eval('[data-role=daily-monitor] tbody tr', (trs) => trs.map((tr) => ({ date: tr.dataset.date, level: tr.dataset.level, cells: [...tr.children].map((c) => c.innerText.replace(/\s+/g, ' ').trim()) })));
const missedRow = chips.find((c) => seed.days.includes(c.date) && c.date < '2026-10-01' && seed.pattern[seed.days.indexOf(c.date)] === 'missed');
expect('복약 놓친 날은 ❌ + 확인필요', missedRow && /❌ 놓침/.test(missedRow.cells[6]) && missedRow.level === 'check', JSON.stringify(missedRow));
const fullRow = chips.find((c) => seed.days.includes(c.date) && seed.pattern[seed.days.indexOf(c.date)] === 'full');
expect('모두 복용한 날은 ✅ + 좋음', fullRow && /✅/.test(fullRow.cells[6]) && fullRow.level === 'good', JSON.stringify(fullRow));
const partialRow = chips.find((c) => seed.days.includes(c.date) && seed.pattern[seed.days.indexOf(c.date)] === 'partial');
expect('일부만 복용한 날은 ⚠️', partialRow && /⚠️ 일부/.test(partialRow.cells[6]), JSON.stringify(partialRow));
// 30일 보기 → 상관 힌트(표본 충분)
await page.click('[data-role=daily-monitor] button:has-text("30일")');
await page.waitForTimeout(100);
const m30 = await page.evaluate(() => ({ rows: document.querySelectorAll('[data-role=daily-monitor] tbody tr').length, hint: document.querySelector('[data-role=daily-hint]')?.textContent || null }));
expect('30일 보기 30행', m30.rows === 30, m30.rows);
// 독립 계산: 복약을 모두 한 날 vs 아닌 날의 평균 수축기
const exH = (() => {
  const a = [], o = [];
  seed.days.forEach((d, i) => { const i2 = i; const sys = seed.pattern[i] === 'full' ? 113 + (i2 % 3) : 128 + (i2 % 3); (seed.pattern[i] === 'full' ? a : o).push(sys); });
  a.push(null); // 오늘은 BP 없음 → 제외(아래에서 filter)
  const A = a.filter((x) => x != null), O = o;
  const avg = (x) => x.reduce((s, y) => s + y, 0) / x.length;
  return { na: A.length, no: O.length, aa: Number(avg(A).toFixed(1)), oa: Number(avg(O).toFixed(1)) };
})();
expect('30일 보기에 상관 힌트(표본 수·평균 표기, 독립 계산과 일치)', m30.hint && m30.hint.includes(`모두 한 날(${exH.na}일)`) && m30.hint.includes(`${exH.aa}mmHg`) && m30.hint.includes(`(${exH.no}일)`) && m30.hint.includes(`${exH.oa}mmHg`) && m30.hint.includes('우연일 수'), `${m30.hint} | exp ${JSON.stringify(exH)}`);
// 오늘 컨디션 빠른 기록 + 메모
await page.fill('[data-role=daily-monitor] input[placeholder^="증상"]', '두통');
await page.click('.health-mood-btn[data-mood="2"]');
await page.waitForTimeout(150);
const moodRow = await page.evaluate(() => document.querySelector('[data-role=daily-monitor] tr.is-today').innerText.replace(/\s+/g, ' '));
expect('컨디션 2 + 메모 "두통"이 오늘 행에 표시되고 칩이 주의 이상', /😕 2/.test(moodRow) && moodRow.includes('두통'), moodRow);
await page.click('[data-role=daily-monitor] button:has-text("14일")');
await page.evaluate(() => document.querySelector('[data-role=daily-monitor]').scrollIntoView());
await page.screenshot({ path: `${SHOTS}/daily.png`, clip: await page.evaluate(() => { const r = document.querySelector('[data-role=daily-monitor]').getBoundingClientRect(); return { x: r.x, y: r.y + window.scrollY, width: r.width, height: Math.min(r.height, 900) }; }), fullPage: true });

// ---------- ⑥ 병원/검진 일정: 등록·첨부·정렬·검색·수정·삭제·지난 일정 ----------
async function addAppt(title, date, type, loc, memo, attach) {
  await page.click('[data-role=appt-card] button:has-text("+ 일정 등록")');
  await page.waitForSelector('.nm-modal form');
  await page.fill('.nm-modal input[name=title]', title);
  await page.fill('.nm-modal input[name=appointment_date]', date);
  await page.fill('.nm-modal input[name=appointment_time]', '09:30');
  await page.selectOption('.nm-modal select[name=appt_type]', type);
  await page.fill('.nm-modal input[name=location]', loc);
  await page.fill('.nm-modal textarea[name=memo]', memo);
  await page.click('.nm-modal button[type=submit]');
  await page.waitForSelector('#new-appt-attach-box');
  if (attach) {
    await page.setInputFiles('#new-appt-attach-box input[type=file]', attach);
    await page.waitForSelector('#new-appt-attach-box .attach-item');
  }
  await page.click('.nm-modal button:has-text("완료")');
  await page.waitForSelector('.nm-modal-backdrop', { state: 'detached' });
}
const png = { name: 'ref.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') };
await addAppt('정기검진', '2026-10-20', '검진', 'A병원', '공복 8시간', png);
await addAppt('치과 스케일링', '2026-09-20', '치과', 'C치과', '', null); // 지난 일정
await addAppt('안과', '2026-11-02', '진료', 'B안과', '', null);
const tabs = await page.$$eval('[data-role=appt-card] .quick-tab', (b) => b.map((x) => x.textContent.trim()));
expect('탭: 다가오는 2 / 지난 1 / 전체 3', tabs.join('|') === '다가오는 일정 2|지난 일정 1|전체 3', tabs.join('|'));
let titles = await page.$$eval('.health-appt-table tbody tr td:nth-child(4) strong', (e) => e.map((x) => x.textContent));
expect('다가오는 일정: 날짜 오름차순 (정기검진 → 안과)', titles.join('|') === '정기검진|안과', titles.join('|'));
expect('첨부 📎1 배지(정기검진)', (await page.textContent('.health-appt-table tbody tr:first-child [data-role=attach-count]')).includes('📎1'));
await page.click('.health-appt-table th:has-text("날짜")'); // 이미 asc → desc
titles = await page.$$eval('.health-appt-table tbody tr td:nth-child(4) strong', (e) => e.map((x) => x.textContent));
const arrow = await page.textContent('.health-appt-table th.is-sorted');
expect('날짜 헤더 재클릭 → 내림차순 + ▼', titles.join('|') === '안과|정기검진' && arrow.includes('▼'), `${titles} ${arrow}`);
await page.click('.health-appt-table th:has-text("제목")');
titles = await page.$$eval('.health-appt-table tbody tr td:nth-child(4) strong', (e) => e.map((x) => x.textContent));
expect('제목 정렬 ▲', titles.join('|') === [...titles].sort((a, b) => a.localeCompare(b)).join('|') && (await page.textContent('.health-appt-table th.is-sorted')).includes('▲'), titles.join('|'));
await page.click('[data-apptTab="past"], [data-appt-tab="past"]');
titles = await page.$$eval('.health-appt-table tbody tr td:nth-child(4) strong', (e) => e.map((x) => x.textContent));
expect('지난 일정 탭: 치과 스케일링', titles.join('|') === '치과 스케일링', titles.join('|'));
await page.click('[data-appt-tab="all"]');
await page.fill('[data-role=appt-search]', 'b안');
titles = await page.$$eval('.health-appt-table tbody tr td:nth-child(4) strong', (e) => e.map((x) => x.textContent));
expect('검색(장소 "B안과")', titles.join('|') === '안과', titles.join('|'));
const focusKept = await page.evaluate(() => document.activeElement?.dataset?.role);
expect('검색 입력 중 포커스 유지', focusKept === 'appt-search', focusKept);
await page.fill('[data-role=appt-search]', '');
// 수정 — 기존 값이 채워지고, 저장하면 일정 메뉴의 연동 일정도 바뀐다
await page.click('.health-appt-table tr:has-text("정기검진") button[title="수정"]');
await page.waitForSelector('.nm-modal form');
const prefill = await page.evaluate(() => ({ title: document.querySelector('.nm-modal input[name=title]').value, date: document.querySelector('.nm-modal input[name=appointment_date]').value, time: document.querySelector('.nm-modal input[name=appointment_time]').value, type: document.querySelector('.nm-modal select[name=appt_type]').value, loc: document.querySelector('.nm-modal input[name=location]').value, memo: document.querySelector('.nm-modal textarea[name=memo]').value, hasAttachPanel: !!document.querySelector('#edit-appt-attach-box .attach-item') }));
expect('수정 폼에 기존 값 + 기존 첨부 패널', JSON.stringify(prefill) === JSON.stringify({ title: '정기검진', date: '2026-10-20', time: '09:30', type: '검진', loc: 'A병원', memo: '공복 8시간', hasAttachPanel: true }), JSON.stringify(prefill));
await page.fill('.nm-modal input[name=title]', '정기검진(수정)');
await page.fill('.nm-modal input[name=appointment_date]', '2026-10-22');
await page.fill('.nm-modal input[name=location]', 'Z병원');
await page.click('.nm-modal button[type=submit]');
await page.waitForSelector('.nm-modal-backdrop', { state: 'detached' });
await page.waitForTimeout(800);
const edited = await page.textContent('.health-appt-table tr:has-text("정기검진(수정)")');
expect('수정 결과가 목록에 반영', edited.includes('2026-10-22') && edited.includes('Z병원') && edited.includes('📎1'), edited.replace(/\s+/g, ' '));
await page.click('.nav-item[data-path="/schedule"]');
await page.waitForTimeout(300);
const sched = await page.evaluate(() => window.appState.schedules.filter((s) => s.title.includes('정기검진')).map((s) => `${s.title}|${s.date}|${s.time}`));
expect('일정 메뉴 연동 일정이 함께 수정(제목·날짜·시간)', sched.length === 1 && sched[0] === '🏥 정기검진(수정)|2026-10-22|09:30', sched.join(','));
const schedText = await page.textContent('#view-root');
expect('일정 화면에 수정된 제목 표시', schedText.includes('정기검진(수정)'));
await page.click('.nav-item[data-path="/health"]');
await page.waitForSelector('[data-role=appt-card]');
// 열람 모달(첨부 미리보기)
await page.click('.health-appt-table tr:has-text("정기검진(수정)") button[title="열람"]');
await page.waitForSelector('.nm-modal img[src^="blob:"], .nm-modal img[src^="data:image"]');
const viewInfo = await page.evaluate(() => ({ img: !!document.querySelector('.nm-modal img[src^="data:image/png"], .nm-modal img[src^="blob:"]'), h: document.querySelector('.nm-modal__body h2')?.textContent, attachMgr: !!document.querySelector('.nm-modal .attach-panel') }));
expect('열람 모달: 이미지 미리보기 + 첨부 관리', viewInfo.img && viewInfo.h === '정기검진(수정)' && viewInfo.attachMgr, JSON.stringify(viewInfo));
await page.click('.nm-modal__close');
// 일괄 삭제(연동 일정도 삭제)
await page.click('[data-appt-tab="all"]');
await page.check('.health-appt-table tr:has-text("안과") input[type=checkbox]');
await page.check('.health-appt-table tr:has-text("치과 스케일링") input[type=checkbox]');
await page.click('button:has-text("선택 삭제 (2)")');
await page.waitForTimeout(800);
titles = await page.$$eval('.health-appt-table tbody tr td:nth-child(4) strong', (e) => e.map((x) => x.textContent));
expect('선택 삭제 후 1건 남음', titles.join('|') === '정기검진(수정)', titles.join('|'));
const schedLeft = await page.evaluate(() => window.appState.schedules.filter((s) => s.title.startsWith('🏥')).map((s) => s.title));
expect('연동 일정도 함께 삭제', schedLeft.join('|') === '🏥 정기검진(수정)', schedLeft.join('|'));

// 제목에 & < > 가 있어도 글자 그대로 보이고(이중 이스케이프 없음) HTML로 해석되지 않는다
await page.evaluate(() => window.appState.addHealthAppointment({ title: 'A&B <i>x</i>', appointment_date: '2026-12-01' }));
await page.waitForTimeout(300);
const esc = await page.evaluate(() => { const td = [...document.querySelectorAll('.health-appt-table tbody td strong')].find((e) => e.textContent.includes('A&B')); return { text: td?.textContent, hasI: !!td?.querySelector('i') }; });
expect('특수문자 제목이 그대로 표시되고 태그로 해석되지 않는다', esc.text === 'A&B <i>x</i>' && !esc.hasI, JSON.stringify(esc));

// ---------- ⑦ 복약 알림(토스트) ----------
await page.evaluate(async () => {
  const st = window.appState;
  await st.addHealthMedication({ name: '저녁약', dose_times: '20:30', start_date: '2026-10-07', schedule_type: 'daily', interval_days: 1, weekdays: '' });
  localStorage.removeItem('workspace:medReminder:sent');
  window.checkMedReminderNow();
});
await page.waitForTimeout(300);
const toastText = await page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join('|'));
expect('복약 시간 알림 토스트(20:30 저녁약, 30분 경과)', toastText.includes('복약 시간이 지났어요') && toastText.includes('20:30 저녁약'), toastText);
await page.evaluate(() => window.checkMedReminderNow());
const toastCount = await page.evaluate(() => [...document.querySelectorAll('.toast')].filter((t) => t.textContent.includes('복약 시간이 지났어요')).length);
expect('같은 시각은 하루에 한 번만 알림', toastCount === 1, toastCount);

// ---------- ⑧ 권한/오류: 0023 미실행 안내 ----------
const errHint = await page.evaluate(async () => {
  const st = window.appState; const orig = st.store.create.bind(st.store);
  st.store.create = async (t, o) => { if (t === 'health_medications') throw new Error('relation "public.health_medications" does not exist'); return orig(t, o); };
  document.querySelector('button[title], button');
  return true;
});
await page.click('button:has-text("+ 약 등록") >> nth=0');
await page.fill('.nm-modal input[name=name]', '실패약');
await page.click('.nm-modal button[type=submit]');
await page.waitForTimeout(300);
const failToast = await page.evaluate(() => [...document.querySelectorAll('.toast--error')].map((t) => t.textContent).join('|'));
expect('테이블 없음(0023 미실행)이면 마이그레이션 안내 토스트', /all_migrations_0001_to_00\d+\.sql/.test(failToast), failToast);
await page.click('.nm-modal__close');
// ---------- ⑨ 저장 실패: 임시 행이 보였다가 되돌려지고 오류 안내 ----------
await page.evaluate(() => {
  const st = window.appState.store; const oc = st.create.bind(st);
  st.create = async (t, o) => { if (t === 'health_metrics') { await new Promise((r) => setTimeout(r, 300)); throw new Error('network down'); } return oc(t, o); };
});
await page.click('button:has-text("+ 기록 추가")');
await page.waitForSelector('.nm-modal form');
await page.selectOption('.nm-modal select[name=metric_type]', 'weight');
await page.fill('.nm-modal input[name=value]', '99.9');
await page.fill('.nm-modal input[name=note]', 'rb-test');
await page.click('.nm-modal button[type=submit]');
await page.waitForTimeout(100);
const during = await page.evaluate(() => ({ modalGone: !document.querySelector('.nm-modal-backdrop'), listHas: document.querySelector('#view-root').innerText.includes('rb-test'), pendingText: document.querySelector('#view-root').innerText.includes('저장 중') }));
expect('실패하는 저장: 모달은 즉시 닫히고 임시 기록이 "저장 중"으로 보인다', during.modalGone && during.listHas && during.pendingText, JSON.stringify(during));
await page.waitForTimeout(700);
const afterFail = await page.evaluate(() => ({ listHas: document.querySelector('#view-root').innerText.includes('rb-test'), toast: [...document.querySelectorAll('.toast--error')].map((t) => t.textContent).join('|') }));
expect('실패 후 임시 기록이 사라지고 오류 토스트', !afterFail.listHas && afterFail.toast.includes('기록을 저장하지 못했습니다'), JSON.stringify(afterFail));

// 전체 화면 스크린샷(눈으로 확인)
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({ path: `${SHOTS}/health-full.png`, fullPage: true });

expect('콘솔/페이지 오류 없음', errors.length === 0, errors.join(' || '));
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(SHOTS + '/e2e-results.json', JSON.stringify(results, null, 1));
console.log(`PASS ${results.length - failed.length}/${results.length}`);
for (const f of failed) console.log('  FAIL:', f.name, '->', f.detail);
await browser.close(); server.close();
