import { serve, launch, login } from './harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadLibs, buildResumeXlsx } from '../../helpers/formFixtures.mjs';
// v7.35.0 E2E — 로컬 모드 복사본에서 실행(make-local-copy.sh 참고)
const [root, port] = process.argv.slice(2);
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'v735-shots'); fs.mkdirSync(SHOTS, { recursive: true });
const libs = loadLibs();
const wb = new libs.ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await buildResumeXlsx(libs.ExcelJS)));
const ws = wb.getWorksheet('이력서');
// 학력 표에 양식 전용 열("지역")을 하나 더 붙인다 — 아직 이 열을 받을 컬럼이 없는 상태에서 문서를 만든다.
ws.getCell('G9').value = '지역'; ws.getCell('G9').font = { bold: true }; ws.getCell('G9').border = ws.getCell('F9').border; ws.getCell('G9').fill = ws.getCell('F9').fill;
for (const r of [10, 11, 12]) ws.getCell(`G${r}`).border = ws.getCell(`F${r}`).border;
const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
const payload = { name: 'resume-loc.xlsx', mimeType: 'application/octet-stream', buffer: xlsx };

const server = await serve(root, Number(port)); const browser = await launch(); const base = `http://localhost:${port}`;
const errors = []; let fails = 0; const expect = (n, c, d = '') => { if (!c) fails++; console.log(c ? 'ok  ' : 'FAIL', n, c ? '' : d); };
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true }); const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept());
await page.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await login(page, base);
const toasts = () => page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));
const killModals = () => page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));
const shot = (n) => page.screenshot({ path: path.join(SHOTS, n) });

// ================= 2) 컬럼 선택 목록 =================
await page.evaluate(() => window.navigate('/career')); await page.waitForSelector('.quick-tabs');
await page.evaluate(async () => { const s = window.appState; await s.addCareerRecord('experiences', { company_name: '알파', department_position: '개발', start_date: '2020-01-01', end_date: '2022-01-01' }); });
await page.click('[data-tab="experiences"]'); await page.waitForSelector('.career-colmgr-btn');
await page.click('.career-colmgr-btn'); await page.waitForSelector('.nm-modal');
await page.fill('.nm-modal input[placeholder*="새 컬럼"]', '직책구분');
await page.fill('.career-newcol-options', '사원, 대리, 과장, 차장, 부장, 선임, 책임, 수석');
await page.click('.nm-modal button:text-is("추가")'); await page.waitForTimeout(300);
let defs = await page.evaluate(() => window.CareerCols.active('experiences'));
expect('목록을 입력하면 종류가 자동으로 "선택"이 된다', defs.length === 1 && defs[0].type === 'select' && defs[0].options.length === 8, JSON.stringify(defs));
// 텍스트 컬럼 → 목록 입력으로 선택형 전환
await page.fill('.nm-modal input[placeholder*="새 컬럼"]', '급여형태'); await page.click('.nm-modal button:text-is("추가")'); await page.waitForTimeout(300);
const second = page.locator('.nm-modal .nm-card', { has: page.locator('input[value="급여형태"]') });
await second.locator('.career-col-options').fill('정규직; 계약직, 파견'); await second.locator('.career-col-options').dispatchEvent('change'); await page.waitForTimeout(300);
defs = await page.evaluate(() => window.CareerCols.active('experiences'));
expect('기존 텍스트 컬럼에 목록을 넣으면 선택형으로 전환', defs.find((d) => d.label === '급여형태').type === 'select' && defs.find((d) => d.label === '급여형태').options.join() === '정규직,계약직,파견', JSON.stringify(defs));
await shot('01-colmgr-options.png');
// 선택형만 만들고 목록 비우면 막는다
await page.selectOption('.nm-modal select.nm-select >> nth=-1', 'select').catch(() => {});
await killModals();
// 등록 폼에서 목록으로 고르기
await page.click('button:has-text("+ 경력 추가")'); await page.waitForSelector('.nm-modal form');
const opts = await page.locator('.nm-modal form .nm-field:has(label:text-is("직책구분")) select option').allInnerTexts();
expect('등록 폼에서 목록(+선택 안 함)이 드롭다운으로 나온다', opts.length === 9 && opts.includes('수석') && opts[0].includes('선택 안 함'), opts.join());
await page.fill('.nm-modal input[name=company_name]', '베타'); await page.fill('.nm-modal input[name=department_position]', '리드'); await page.fill('.nm-modal input[name=start_date]', '2022-02-01');
await page.selectOption('.nm-modal form .nm-field:has(label:text-is("직책구분")) select', '과장');
await shot('02-record-form-select.png');

// ================= 3) 캡처 붙여넣기 (저장 전 첨부 영역) =================
const pasteImage = (selector) => page.evaluate(async (sel) => {
  const c = document.createElement('canvas'); c.width = 20; c.height = 12; c.getContext('2d').fillRect(0, 0, 20, 12);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const dt = new DataTransfer(); dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
  const target = sel ? document.querySelector(sel) : document.body;
  target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, selector);
expect('첨부 영역에 붙여넣기/화면 캡처 버튼', (await page.locator('.nm-modal .attach-paste-btn').count()) === 1 && (await page.locator('.nm-modal .attach-capture-btn').count()) === 1);
await pasteImage(null); await page.waitForTimeout(300); // 입력칸이 아닌 곳에서 Ctrl+V
let pend = await page.locator('.nm-modal .attach-item__name').allInnerTexts();
expect('Ctrl+V 이미지 → "캡처_날짜_시간.png"로 담김', pend.length === 1 && /캡처_\d{8}_\d{6}\.png/.test(pend[0]), pend.join());
await page.focus('.nm-modal input[name=company_name]');
await page.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'hello'); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
expect('글자 붙여넣기는 건드리지 않는다', (await page.locator('.nm-modal .attach-item__name').count()) === 1);
await page.click('.nm-modal button[type=submit]'); await page.waitForTimeout(800);
const savedAtt = await page.evaluate(() => { const r = window.appState.career.experiences.find((x) => x.company_name === '베타'); return { ex: r.extra, n: window.appState.getAttachments('career_experiences', r.id).map((a) => a.name) }; });
expect('저장하면 캡처 이미지가 첨부되고 선택값도 저장', savedAtt.n.length === 1 && /^캡처_/.test(savedAtt.n[0]) && Object.values(savedAtt.ex).includes('과장'), JSON.stringify(savedAtt));
await killModals();
// 저장된 레코드의 첨부 패널(공통 컴포넌트)에서도 붙여넣기
await page.evaluate(() => { const r = window.appState.career.experiences.find((x) => x.company_name === '베타'); window.openAttachmentsModal('career_experiences', r.id, '베타'); });
await page.waitForSelector('.nm-modal .attach-dropzone');
await pasteImage('.nm-modal .attach-dropzone'); await page.waitForTimeout(600);
expect('저장된 레코드 첨부 패널에도 붙여넣기 적용(2개)', (await page.locator('.nm-modal .attach-item').count()) === 2);
await killModals();

// ================= 1) 양식 문서 최신 업데이트 =================
await page.evaluate(async () => { const s = window.appState; await s.addCareerRecord('education', { school_name: '한국대학교', degree: '컴퓨터공학', admission_date: '2010-03-01', graduation_date: '2014-02-20', status: '졸업' }); });
await page.click('[data-tab="docs"]'); await page.waitForSelector('.cd-help', { timeout: 15000 });
await page.click('button:has-text("+ 새 양식 문서")'); await page.waitForSelector('#cd-file-input', { state: 'attached' });
await page.fill('.nm-modal input[name=doc-title]', '업데이트 테스트');
await page.setInputFiles('#cd-file-input', payload);
await page.waitForSelector('.cd-editor', { timeout: 15000 }); await page.waitForSelector('.cd-sheet table', { timeout: 15000 });
// v7.36.0: 칸막이로 미리보기 너비 조절
{
  const w0 = (await page.locator('.cd-right').boundingBox()).width; const sp = await page.locator('.cd-split').boundingBox();
  await page.mouse.move(sp.x + 6, sp.y + 40); await page.mouse.down(); await page.mouse.move(sp.x - 194, sp.y + 40, { steps: 6 }); await page.mouse.up();
  const w1 = (await page.locator('.cd-right').boundingBox()).width;
  expect('칸막이를 왼쪽으로 끌면 미리보기가 넓어진다', w1 > w0 + 120, `${w0} -> ${w1}`);
  const stored = await page.evaluate(() => localStorage.getItem('workspace:cd:previewW'));
  expect('너비가 기억된다', Number(stored) > 0, String(stored));
  await page.locator('.cd-split').dblclick(); const w2 = (await page.locator('.cd-right').boundingBox()).width;
  expect('더블클릭하면 기본 너비로', Math.abs(w2 - w0) < 40, `${w2} vs ${w0}`);
}
const banner = await page.textContent('.cd-editor .cd-banners, .cd-editor').catch(() => '');
expect('양식에 있는데 연결 칸이 없는 "지역" 열 → 컬럼 만들기 제안', (await page.locator('button:has-text("컬럼 만들기")').count()) >= 1);
await page.click('button:has-text("\\"지역\\" 컬럼 만들기")').catch(async () => { await page.locator('button:has-text("컬럼 만들기")').first().click(); });
await page.waitForTimeout(500);
await page.click('.cd-save-draft'); await page.waitForTimeout(700);
// 새로 만든 컬럼에 값을 입력 — 문서는 아직 모른다
await page.click('.cd-back'); await page.waitForTimeout(300);
await page.click('[data-tab="education"]'); await page.waitForSelector('table.data-table');
await page.click('table.data-table tbody tr button[title="수정"]'); await page.waitForSelector('.nm-modal form');
await page.locator('.nm-modal form .nm-field', { has: page.locator('label:text-is("지역")') }).locator('input').fill('서울');
await page.click('.nm-modal button[type=submit]'); await page.waitForTimeout(800); await killModals();
await page.click('[data-tab="docs"]'); await page.waitForSelector('.cd-table');
expect('등록 데이터가 바뀌면 목록에 "데이터 변경됨" 표시', (await page.locator('.cd-stale-badge').count()) === 1);
await shot('03-docs-stale.png');
// 목록에서 원클릭 업데이트
await page.click('.cd-act-refresh'); await page.waitForTimeout(1200);
expect('목록 원클릭 업데이트 완료 토스트', /최신으로 업데이트|이미 최신/.test(await toasts()), await toasts());
expect('업데이트 후 표시가 사라진다', (await page.locator('.cd-stale-badge').count()) === 0);
await page.click('.cd-table tbody tr td:nth-child(3)'); await page.waitForSelector('.cd-editor');
await page.waitForSelector('.cd-rep');
const cellsText = await page.locator('.cd-rep:has-text("학력 표") tbody tr:first-child input').evaluateAll((els) => els.map((e) => e.value));
expect('문서의 학력 표 "지역" 칸에 서울이 채워짐', cellsText.includes('서울'), cellsText.join('|'));
// 편집기 안에서: 직접 고친 값 + 데이터 변경 → 충돌 확인
const loc = page.locator('.cd-rep:has-text("학력 표") tbody tr:first-child input').filter({ hasNot: page.locator('x') });
const idx = cellsText.indexOf('서울');
await page.locator('.cd-rep:has-text("학력 표") tbody tr:first-child input').nth(idx).fill('서울특별시(내가 수정)');
await page.click('.cd-save-draft'); await page.waitForTimeout(700);
await page.evaluate(async () => { const s = window.appState; const r = s.career.education[0]; await s.updateCareerRecord('education', r.id, { extra: { ...(r.extra || {}), ...Object.fromEntries(Object.keys(r.extra || {}).map((k) => [k, '부산'])) } }); });
await page.waitForTimeout(500);
expect('편집 중 문서에 "등록 데이터가 바뀌었습니다" 배너', (await page.locator('.cd-stale').count()) === 1, '');
await page.click('.cd-refresh'); await page.waitForSelector('.cd-conflict', { timeout: 5000 });
expect('직접 고친 값과 충돌 → 확인 창', /서울특별시\(내가 수정\)/.test(await page.textContent('.cd-conflicts')) && /부산/.test(await page.textContent('.cd-conflicts')));
await shot('04-conflict.png');
await page.click('.cd-conflict-keep'); await page.waitForTimeout(300);
let after = await page.locator('.cd-rep:has-text("학력 표") tbody tr:first-child input').evaluateAll((els) => els.map((e) => e.value));
expect('"내 값 유지"를 고르면 그대로', after.includes('서울특별시(내가 수정)'), after.join('|'));
await page.click('.cd-refresh'); await page.waitForTimeout(800);
expect('다시 눌러도 같은 충돌을 반복하지 않음(이미 확인한 데이터)', (await page.locator('.cd-conflict').count()) === 0, await toasts());
// 최신으로 덮어쓰기 경로
await page.evaluate(async () => { const s = window.appState; const r = s.career.education[0]; await s.updateCareerRecord('education', r.id, { extra: Object.fromEntries(Object.keys(r.extra || {}).map((k) => [k, '대전'])) }); });
await page.click('.cd-refresh'); await page.waitForSelector('.cd-conflict', { timeout: 5000 });
await page.click('.cd-conflict-all'); await page.waitForTimeout(300);
after = await page.locator('.cd-rep:has-text("학력 표") tbody tr:first-child input').evaluateAll((els) => els.map((e) => e.value));
expect('"모두 최신으로" → 대전', after.includes('대전'), after.join('|'));
await shot('05-after-refresh.png');
await page.click('.cd-save-draft'); await page.waitForTimeout(500); await page.click('.cd-back'); await page.waitForTimeout(300);

// ================= 4) 브리핑 =================
await page.evaluate(() => window.navigate('/briefing')); await page.waitForSelector('.page-header');
await page.evaluate(async () => {
  const s = window.appState; const uid = s.user.id; const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
  const t1 = await s.store.create('briefing_topics', { user_id: uid, name: '스마트팜', include_keywords: [], exclude_keywords: [], active: true, priority: 5, search_terms: [], priority_keywords: ['보조금'], site_urls: [] });
  const f1 = await s.store.create('feed_sources', { user_id: uid, name: '전자신문', type: 'rss', endpoint: 'https://a.example/rss', enabled: true });
  await s.store.create('feed_sources', { user_id: uid, name: '막힌사이트', type: 'rss', endpoint: 'https://b.example/rss', enabled: true });
  const f2 = await s.store.create('feed_sources', { user_id: uid, name: '내 메모', type: 'markdown', endpoint: '[x](https://m.example/1)', enabled: true });
  const mk = (title, summary, source_id, published_at, is_read, h) => s.store.create('briefing_items', { user_id: uid, topic_id: t1.id, source_id, title, link: `https://x.example/${h}`, summary, published_at, item_hash: h, is_read });
  await mk('스마트팜 보조금 확대', '정부가 지원', f1.id, day(1), false, 'h1');
  await mk('반도체 소식', '스마트팜 무관', f1.id, day(10), true, 'h2');
  await mk('마크다운 글', '메모에서', f2.id, day(2), false, 'h3');
  await mk('검색으로 모은 글', '', null, day(0.2), false, 'h4');
  await s.refreshAll();
});
await page.click('button:has-text("브리핑 목록")'); await page.waitForSelector('.brf-filters');
const shown = async () => (await page.locator('.item-row').count());
expect('필터 없이 4건', (await shown()) === 4, String(await shown()));
await page.fill('.brf-q', '제목:보조금'); await page.waitForTimeout(500);
expect('제목 검색', (await shown()) === 1);
await page.fill('.brf-q', '내용:스마트팜'); await page.waitForTimeout(500);
expect('내용(요약) 검색', (await shown()) === 1 && /반도체/.test(await page.textContent('.item-list')));
await page.fill('.brf-q', '최근 3일 안 읽은 스마트팜'); await page.waitForTimeout(500);
const sum = await page.textContent('.brf-summary');
expect('자연어: 기간·안 읽음·키워드를 이해하고 칩으로 보여줌', /최근 3일/.test(sum) && /안 읽음/.test(sum) && /"스마트팜"/.test(sum) && (await shown()) === 3, sum);
await shot('06-briefing-search.png');
await page.click('.brf-reset'); await page.waitForTimeout(300);
await page.selectOption('.brf-feed', 'md'); await page.waitForTimeout(300);
expect('피드 구분: 마크다운만', (await shown()) === 1 && /마크다운 글/.test(await page.textContent('.item-list')));
await page.selectOption('.brf-feed', 'topic'); await page.waitForTimeout(300);
expect('피드 구분: 주제 검색(마법사)로 모은 글만', (await shown()) === 1 && /검색으로 모은/.test(await page.textContent('.item-list')));
await page.click('.brf-reset'); await page.fill('.brf-from', new Date(Date.now() - 3 * 86400000).toLocaleDateString('sv-SE')); await page.dispatchEvent('.brf-from', 'change'); await page.waitForTimeout(300);
expect('날짜 조건(부터)', (await shown()) === 3, String(await shown()));
await page.click('.brf-reset'); await page.check('.brf-prio'); await page.waitForTimeout(300);
expect('⭐ 우선만', (await shown()) === 1);
await page.click('.brf-reset'); await page.fill('.brf-q', '없는말없는말'); await page.waitForTimeout(500);
expect('결과 없음 안내', /조건에 맞는 항목이 없습니다/.test(await page.textContent('.page-header ~ *, body')));
await page.click('.brf-reset'); await page.waitForTimeout(200);
// 수집 결과 창: 가져오기 함수를 흉내 내서(네트워크 없음) 한 곳은 성공, 한 곳은 403
await page.evaluate(() => { window.fetchFeedItems = async (url) => { if (url.includes('a.example')) return [{ title: '새 기사 1', link: 'https://n.example/1', publishedAt: 'Mon, 09 Nov 2026 03:00:00 KST', summary: '' }, { title: '새 기사 2', link: 'https://n.example/2', publishedAt: '날짜아님', summary: '' }]; throw new Error('프록시 응답 오류(HTTP 403)'); }; });
await page.click('button:has-text("지금 가져오기")'); await page.waitForSelector('.brf-report', { timeout: 8000 });
const rep = await page.textContent('.brf-report');
expect('수집 결과: 소스별 새로 저장 수와 실패 원인', /전자신문/.test(rep) && /HTTP 403/.test(rep) && /2/.test(rep), rep);
const dates = await page.evaluate(() => window.appState.briefingItems.filter((i) => /^새 기사/.test(i.title)).map((i) => i.published_at));
expect('저장된 발행일은 ISO 또는 null', dates.length === 2 && dates.every((d) => d === null || /^\d{4}-\d\d-\d\dT/.test(d)), JSON.stringify(dates));
await shot('07-collect-report.png');
await killModals();
await page.click('button:has-text("📰 뉴스레터")'); await page.waitForTimeout(300);
expect('뉴스레터 탭 표시', (await page.locator('.nl').count()) === 1);

expect('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
await browser.close(); server.close(); console.log(fails ? `FAILED ${fails}` : 'ALL OK'); process.exit(fails ? 1 : 0);
