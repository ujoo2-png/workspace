import { serve, launch, login } from './harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// v7.23.0: 기간 일정(달력 막대/구분 이모지), 프로젝트 복사, 브리핑 마법사 화면 검증.
//   NODE_PATH=<playwright node_modules> node tests/tools/e2e/v723-e2e.mjs /tmp/ws-local 8323
const [root, port] = process.argv.slice(2);
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'v723-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const server = await serve(root, Number(port));
const browser = await launch();
const base = `http://localhost:${port}`;
const errors = []; let fails = 0;
const expect = (name, cond, detail = '') => { if (!cond) fails++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : detail); };
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1100 } })).newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept());
await page.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
const rssCalls = [];
await page.route('**/api.rss2json.com/**', (r) => {
  const u = decodeURIComponent(new URL(r.request().url()).searchParams.get('rss_url'));
  rssCalls.push(u);
  const q = new URL(u).searchParams.get('q') || '';
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', items: [
    { title: `보조금 확대 발표 - 전자신문`, link: `https://news.google.com/a?${encodeURIComponent(q)}`, pubDate: '2026-10-06 09:00:00', description: '<p>요약 하나</p>' },
    { title: `[광고] 스마트팜 특가 - 어딘가`, link: `https://news.google.com/b?${encodeURIComponent(q)}`, pubDate: '2026-10-06 09:00:00', description: '광고' },
    { title: `일반 기사 - 한경`, link: `https://news.google.com/c?${encodeURIComponent(q)}`, pubDate: '2026-10-05 09:00:00', description: '요약 둘' },
  ] }) });
});
await page.clock.setFixedTime(new Date('2026-10-07T12:00:00+09:00'));
await login(page, base);
const toasts = () => page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent));

// ================= 1) 기간 일정 =================
await page.click('.nav-item[data-path="/schedule"]'); await page.waitForTimeout(300);
await page.click('button:has-text("+ 일정 등록")'); await page.waitForSelector('.nm-modal form');
await page.fill('.nm-modal input[name=title]', '제주 출장');
await page.fill('.nm-modal input[name=date]', '2026-10-07');
expect('종료일 칸 + 안내 문구', (await page.locator('.nm-modal input[name=end_date]').count()) === 1 && /하루 일정/.test(await page.locator('.nm-modal').innerText()));
await page.fill('.nm-modal input[name=end_date]', '2026-10-05');
await page.dispatchEvent('.nm-modal input[name=end_date]', 'input');
expect('종료일이 시작일보다 앞서면 시작일로 맞춤', (await page.inputValue('.nm-modal input[name=end_date]')) === '2026-10-07');
await page.fill('.nm-modal input[name=end_date]', '2026-10-10');
await page.dispatchEvent('.nm-modal input[name=end_date]', 'input');
expect('기간 안내 표시(4일간)', /4일간/.test(await page.locator('.nm-modal').innerText()));
await page.selectOption('.nm-modal select[name=category]', '업무');
await page.click('.nm-modal button[type=submit]'); await page.waitForTimeout(500);
let row = await page.evaluate(() => window.appState.schedules.map((s) => ({ t: s.title, d: s.date, e: s.end_date, c: s.category })));
expect('기간 일정 저장(end_date)', row.length === 1 && row[0].e === '2026-10-10' && row[0].c === '업무', JSON.stringify(row));
await page.click('.nm-modal button:has-text("완료")').catch(() => {});
await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));
// 하루 일정 2개 더(가족/개인) + 같은 주에 겹치는 기간 일정
await page.evaluate(async () => {
  const st = window.appState;
  await st.addSchedule({ title: '가족 식사', date: '2026-10-08', category: '가족', priority: 'medium' });
  await st.addSchedule({ title: '병원', date: '2026-10-07', category: '개인', priority: 'medium' });
  await st.addSchedule({ title: '워크숍', date: '2026-10-09', end_date: '2026-10-12', category: '회사', priority: 'medium' });
});
await page.waitForTimeout(400);
const bars = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.calendar-cell')];
  const out = {};
  for (const c of cells) {
    const day = c.querySelector('.calendar-cell__daynum').textContent;
    if (c.classList.contains('calendar-cell--outside')) continue;
    out[day] = [...c.querySelectorAll('.calendar-cell__item')].map((i) => ({ cls: [...i.classList].filter((x) => x.startsWith('span--') || x.startsWith('cat-item')).join(' '), text: i.textContent.trim(), top: Math.round(i.getBoundingClientRect().top) }));
  }
  return out;
});
const trip = ['7', '8', '9', '10'].map((d) => bars[d].find((x) => /span--(start|mid|end)/.test(x.cls) && /cat-item--work/.test(x.cls)));
expect('출장 막대가 7~10일에 모두 표시(start/mid/mid/end)', trip.every(Boolean) && trip.map((x) => x.cls.match(/span--(\w+)/)[1]).join() === 'start,mid,mid,end', JSON.stringify(trip));
expect('막대는 같은 줄(세로 위치 동일)', new Set(trip.map((x) => x.top)).size === 1, JSON.stringify(trip.map((x) => x.top)));
expect('시작일 칸에만 제목, 중간 칸은 막대만', /제주 출장/.test(trip[0].text) && !/제주 출장/.test(trip[1].text));
expect('구분 이모지 표시(업무 💼)', /💼/.test(trip[0].text));
expect('범례 5개', (await page.locator('.cal-legend .cat-badge').count()) === 5);
await page.screenshot({ path: path.join(SHOTS, 'calendar-multiday.png'), fullPage: false });
const listTxt = await page.locator('.data-table').innerText();
expect('목록: 기간 표기 + 진행 중 배지', /10\/7\(수\) ~ 10\/10\(토\) · 4일간/.test(listTxt) && /진행 중/.test(listTxt), listTxt.slice(0, 400));
// 오늘 퀵탭에 기간 일정 포함
await page.click('.quick-tab:has-text("오늘")'); await page.waitForTimeout(150);
expect('오늘 탭: 진행 중인 기간 일정 포함', /제주 출장/.test(await page.locator('.data-table').innerText()));
// 수정 시 종료일 비우기 → 하루 일정
await page.click('.quick-tab:has-text("전체")');
await page.locator('.data-table tr:has-text("제주 출장") button[title="수정"]').click(); await page.waitForSelector('.nm-modal form');
await page.click('.nm-modal button:has-text("종료일 지우기")');
await page.click('.nm-modal button[type=submit]'); await page.waitForTimeout(400);
const after = await page.evaluate(() => window.appState.schedules.find((s) => s.title === '제주 출장'));
expect('종료일 지우기 → 하루 일정(end_date 비움)', !after.end_date, JSON.stringify(after));
await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));
// 달력 칸 클릭 → 폼 / 구분 칩 이모지
expect('구분 칩에 이모지', /🏢/.test(await page.locator('.cat-filter').innerText()));

// ================= 2) 프로젝트 복사 =================
await page.evaluate(async () => {
  const st = window.appState;
  const p = await st.addProject({ name: '사회복지사', deadline: '2026-12-31', priority: 'high', tags: ['자격증'], memo: '15강' });
  const term = await st.addProjectStage(p.id, { name: '1학기', start_date: '2026-03-02', target_date: '2026-06-30' });
  const ids = [];
  for (let i = 1; i <= 15; i++) {
    const r = await st.addProjectStage(p.id, { name: `${i}강`, parent_id: term.id, start_date: `2026-03-${String(1 + i).padStart(2, '0')}`, target_date: `2026-03-${String(1 + i).padStart(2, '0')}`, status: i <= 3 ? 'done' : 'todo', progress: i <= 3 ? 100 : 0, depends_on: ids.length ? [ids.at(-1)] : [] });
    ids.push(r.id);
  }
  await st.recordProgress(p.id, 20);
});
await page.click('.nav-item[data-path="/projects"]'); await page.waitForTimeout(500);
await page.click('button[title="복사해서 새 프로젝트 만들기"]'); await page.waitForSelector('.nm-modal form');
expect('복사 폼: 기본 이름 "(복사)"', (await page.inputValue('.nm-modal input[name=name]')) === '사회복지사 (복사)');
await page.screenshot({ path: path.join(SHOTS, 'project-copy-form.png') });
await page.fill('.nm-modal input[name=name]', '노인복지론');
await page.selectOption('.nm-modal select[name=dateMode]', 'shift');
expect('날짜 이동 선택 시 새 시작일 입력 표시', await page.locator('.nm-modal input[name=shiftBase]').isVisible());
await page.fill('.nm-modal input[name=shiftBase]', '2027-03-01');
await page.click('.nm-modal button[type=submit]'); await page.waitForTimeout(900);
const res = await page.evaluate(() => {
  const st = window.appState;
  const src = st.projects.find((p) => p.name === '사회복지사');
  const cp = st.projects.find((p) => p.name === '노인복지론');
  const ss = st.projectStages.filter((s) => s.project_id === cp?.id);
  const byId = new Map(ss.map((s) => [s.id, s]));
  const term = ss.find((s) => s.name === '1학기');
  const lec = ss.filter((s) => /강$/.test(s.name)).sort((a, b) => a.seq - b.seq);
  return {
    copied: !!cp, srcStages: st.projectStages.filter((s) => s.project_id === src.id).length, n: ss.length,
    allUnderTerm: lec.every((s) => s.parent_id === term.id), order: lec.map((s) => s.name).join(','),
    firstStart: term.start_date, l1: lec[0].start_date, l2: lec[1].start_date,
    statuses: [...new Set(ss.map((s) => s.status))].join(), prog: ss.reduce((a, s) => a + (s.progress || 0), 0),
    depsOk: lec.slice(1).every((s, i) => (s.depends_on || []).length === 1 && byId.get(s.depends_on[0])?.name === lec[i].name),
    depsNotSrc: lec.every((s) => (s.depends_on || []).every((d) => byId.has(d))),
    deadline: cp?.deadline, tags: (cp?.tags || []).join(), progress: (st.progressByProject[cp?.id] || []).length, srcProgress: (st.progressByProject[src.id] || []).length,
    srcIntact: st.projectStages.filter((s) => s.project_id === src.id && s.status === 'done').length,
  };
});
expect('복사본 생성 + 항목 16개 복사(원본 유지)', res.copied && res.n === 16 && res.srcStages === 16, JSON.stringify(res));
expect('구조/순서 유지(1~15강이 1학기 하위)', res.allUnderTerm && res.order === Array.from({ length: 15 }, (_, i) => `${i + 1}강`).join(','), JSON.stringify(res));
expect('날짜 이동(1학기 시작 = 새 시작일, 강 간격 유지)', res.firstStart === '2027-03-01' && res.l2 > res.l1, JSON.stringify(res));
expect('상태·진행률 초기화, 원본 완료 3개는 그대로', res.statuses === 'todo' && res.prog === 0 && res.srcIntact === 3, JSON.stringify(res));
expect('의존관계가 새 항목 id로 연결', res.depsOk && res.depsNotSrc, JSON.stringify(res));
expect('태그 복사, 진행률 기록은 복사 안 함', res.tags === '자격증' && res.progress === 0 && res.srcProgress === 1, JSON.stringify(res));
expect('복사 완료 토스트 + 새 프로젝트 선택', (await toasts()).some((t) => /노인복지론.*항목 16개/.test(t)) && /노인복지론/.test(await page.locator('.project-list-item--active').innerText()), JSON.stringify(await toasts()));
await page.screenshot({ path: path.join(SHOTS, 'project-copied.png') });

// ================= 3) 브리핑 마법사 =================
await page.click('.nav-item[data-path="/briefing"]'); await page.waitForTimeout(400);
await page.click('button:has-text("🪄 마법사")'); await page.waitForSelector('.nm-modal .wizard-progress');
expect('마법사 1단계: 주제 입력', await page.locator('.nm-modal input').first().isVisible());
await page.click('.nm-modal [data-wizard-next]'); await page.waitForTimeout(100);
expect('주제 비우면 다음으로 못 감', /주제 이름/.test((await toasts()).join()));
await page.fill('.nm-modal input', '스마트팜');
await page.click('.nm-modal [data-wizard-next]');
await page.fill('.nm-modal textarea', 'etnews.com\nhttps://www.hankyung.com\nhttps://blog.example.com/feed.xml');
await page.click('.nm-modal [data-wizard-next]');
await page.fill('.nm-modal textarea', '스마트팜 정책');
await page.click('.nm-modal [data-wizard-next]');
await page.fill('.nm-modal textarea', '보조금');
await page.click('.nm-modal [data-wizard-next]');
await page.fill('.nm-modal textarea', '광고');
await page.click('.nm-modal [data-wizard-next]');
const prev = await page.locator('.nm-modal').innerText();
expect('미리보기: 검색 주소 3개(RSS 1 + 사이트 검색 2) + 마크다운 틀', (await page.locator('.wizard-feeds li').count()) === 3 && /## 스마트팜/.test(prev) && /⭐ 우선: 보조금/.test(prev), prev.slice(0, 500));
await page.screenshot({ path: path.join(SHOTS, 'wizard-preview.png') });
await page.click('.nm-modal button:has-text("저장하고 지금 가져오기")'); await page.waitForTimeout(1500);
const saved = await page.evaluate(() => window.appState.briefingTopics.map((t) => ({ n: t.name, s: t.site_urls, q: t.search_terms, p: t.priority_keywords, x: t.exclude_keywords })));
expect('주제 저장(사이트/검색어/우선/제외)', saved.length === 1 && saved[0].s.length === 3 && saved[0].q[0] === '스마트팜 정책' && saved[0].p[0] === '보조금' && saved[0].x[0] === '광고', JSON.stringify(saved));
expect('3개 주소에서 수집(RSS 직접 + site: 검색 2)', rssCalls.length === 3 && rssCalls.some((u) => u === 'https://blog.example.com/feed.xml') && rssCalls.filter((u) => /news\.google\.com/.test(u)).length === 2, JSON.stringify(rssCalls));
const items = await page.evaluate(() => window.appState.briefingItems.map((i) => i.title));
expect('제거 단어([광고]) 글은 저장 안 됨, 나머지는 중복 없이 저장', !items.some((t) => /광고/.test(t)) && items.length >= 2, JSON.stringify(items));
const listHtml = await page.locator('.item-list').innerText();
expect('목록: ⭐ 우선 배지 + 우선 항목이 맨 위', /⭐ 우선/.test(listHtml) && listHtml.indexOf('보조금') < listHtml.indexOf('일반 기사'), listHtml.slice(0, 300));
await page.screenshot({ path: path.join(SHOTS, 'briefing-list.png') });
const md = await page.evaluate(() => window.briefingToMarkdown(window.appState.briefingItems, { topics: window.appState.briefingTopics, sources: window.appState.feedSources, date: '2026-10-07' }));
expect('마크다운: 조건 요약 + ⭐ + 출처(매체명)', /> 검색어: 스마트팜 정책/.test(md) && /- ⭐ \[보조금 확대 발표/.test(md) && /— 전자신문/.test(md), md);
// 한 번에 입력 → 수정
await page.click('.tab-btn, button:has-text("관심주제")').catch(() => {});
await page.locator('button:has-text("관심주제 (")').click(); await page.waitForTimeout(200);
await page.locator('.item-row button[title="수정"]').click(); await page.waitForSelector('.nm-modal .wizard-progress');
expect('수정 시 기존 값이 채워짐', (await page.inputValue('.nm-modal input')) === '스마트팜');
await page.click('.nm-modal button:has-text("한 번에 입력하기")');
const ta = await page.inputValue('.nm-modal textarea');
expect('한 번에 입력 양식에 현재 값 표시', /주제: 스마트팜/.test(ta) && /제외: 광고/.test(ta), ta);
await page.fill('.nm-modal textarea', '주제: 스마트팜\n사이트: etnews.com\n검색어: 정밀농업\n우선: 신기술\n제외: 광고, 채용');
await page.click('.nm-modal button:has-text("미리보기")');
await page.click('.nm-modal button:has-text("저장")'); await page.waitForTimeout(500);
const edited = await page.evaluate(() => { const t = window.appState.briefingTopics[0]; return { s: t.site_urls, q: t.search_terms, p: t.priority_keywords, x: t.exclude_keywords }; });
expect('한 번에 입력으로 수정 저장', JSON.stringify(edited) === JSON.stringify({ s: ['etnews.com'], q: ['정밀농업'], p: ['신기술'], x: ['광고', '채용'] }), JSON.stringify(edited));
expect('잘못된 사이트 주소는 저장 거부', await (async () => {
  await page.locator('.item-row button[title="수정"]').click(); await page.waitForSelector('.nm-modal .wizard-progress');
  await page.click('.nm-modal button:has-text("한 번에 입력하기")');
  await page.fill('.nm-modal textarea', '주제: A\n사이트: javascript:alert(1)');
  await page.click('.nm-modal button:has-text("미리보기")');
  await page.click('.nm-modal button:has-text("저장")'); await page.waitForTimeout(300);
  return (await toasts()).some((t) => /사이트 주소를 읽을 수 없어요/.test(t)) && (await page.evaluate(() => window.appState.briefingTopics[0].name)) === '스마트팜';
})());
await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));

// 모바일 폭에서 달력 가로 스크롤 없음
await page.setViewportSize({ width: 390, height: 800 });
await page.click('.nav-item[data-path="/schedule"]').catch(async () => { await page.evaluate(() => window.navigate('/schedule')); });
await page.waitForTimeout(400);
expect('모바일: 가로 스크롤 없음', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await page.evaluate(() => { const W = window.innerWidth; return document.documentElement.scrollWidth + ' ' + [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > W + 1 && !e.closest('.sidebar,.nav-list,nav,.data-table-wrap')).slice(0, 5).map((e) => e.tagName + '.' + e.className).join(' | '); }));
await page.screenshot({ path: path.join(SHOTS, 'calendar-mobile.png') });

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
console.log(fails ? `${fails} FAILED` : 'ALL OK', 'shots:', SHOTS);
await browser.close(); server.close();
process.exit(fails || errors.length ? 1 : 0);
