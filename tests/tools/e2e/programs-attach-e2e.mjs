import { serve, launch, login } from './harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// 프로그램(위젯 등록/아이콘/상태 점/배포 배지), 첨부 용량(Knowledge 10MB/그 외 4MB, 지연 로딩), Knowledge 중복 URL 경고 검증.
//   NODE_PATH=<playwright node_modules> node tests/tools/e2e/programs-attach-e2e.mjs /tmp/ws-local 8307
const [root, port] = process.argv.slice(2);
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'prog-attach-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const server = await serve(root, Number(port));
const browser = await launch();
const base = `http://localhost:${port}`;
const errors = []; let fails = 0;
const expect = (name, cond, detail = '') => { if (!cond) fails++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : detail); };
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept());
await page.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await page.route('https://example.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: 'ok' }));
await page.clock.setFixedTime(new Date('2026-10-07T12:00:00+09:00'));
await login(page, base);
const closeAll = () => page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));
const toasts = () => page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent));

// ================= 프로그램 =================
await page.click('.nav-item[data-path="/programs"]'); await page.waitForTimeout(300);
await page.click('button:has-text("+ 프로그램 등록")'); await page.waitForSelector('.nm-modal form');
await page.selectOption('.nm-modal select[name=program_type]', 'widget');
await page.fill('.nm-modal input[name=name]', '내 위젯');
// URL 비움 → 인라인 오류, 저장되지 않음
await page.click('.nm-modal button[type=submit]'); await page.waitForTimeout(200);
const errTxt = await page.locator('.nm-modal .field-error:not([hidden])').allTextContents();
expect('URL 비움 → 인라인 오류 표시(저장 안 됨)', errTxt.some((t) => /URL/.test(t)) && (await page.evaluate(() => window.appState.programs.length)) === 0, JSON.stringify(errTxt));
await page.screenshot({ path: path.join(SHOTS, 'prog-error.png') });
// 스킴 없는 URL + 이모지 입력 → 저장
await page.fill('.nm-modal input[name=url]', 'example.com/w');
await page.fill('.nm-modal input[name=icon]', '🖥️📱');
expect('이모지 직접 입력이 깨지지 않음(🖥️📱 유지)', (await page.inputValue('.nm-modal input[name=icon]')) === '🖥️📱');
await page.click('.nm-modal .emoji-picker__toggle');
const cells = await page.locator('.emoji-picker__cell').count();
const tabs = await page.locator('.emoji-picker__tab').count();
expect('이모지 선택기: 5개 카테고리 × 16개', tabs === 5 && cells === 16, `${tabs}/${cells}`);
await page.screenshot({ path: path.join(SHOTS, 'prog-picker.png') });
await page.locator('.emoji-picker__cell').nth(2).click();
const picked = await page.inputValue('.nm-modal input[name=icon]');
expect('선택기로 고르면 입력칸에 반영', picked === '🧩', picked);
await page.click('.nm-modal .emoji-picker__reset');
expect('초기화 → 입력칸 비움', (await page.inputValue('.nm-modal input[name=icon]')) === '');
await page.locator('.emoji-picker__cell').first().click().catch(() => {});
await page.fill('.nm-modal input[name=icon]', '🚀');
await page.click('.nm-modal button[type=submit]'); await page.waitForTimeout(400);
const saved = await page.evaluate(() => window.appState.programs.map((p) => ({ n: p.name, u: p.url, t: p.program_type, i: p.icon })));
expect('위젯 등록 성공: 스킴 자동 보정 + 유형/아이콘 저장', saved.length === 1 && saved[0].u === 'https://example.com/w' && saved[0].t === 'widget' && saved[0].i === '🚀', JSON.stringify(saved));
expect('저장 후 첨부 패널 표시(완료로 닫기)', (await page.locator('#new-program-attach-box').count()) === 1);
await page.click('.nm-modal button:has-text("완료")');
await page.waitForTimeout(200);
// 목록 아이콘 + 유형 기본값
await page.evaluate(async () => { const st = window.appState; await st.store.create('programs', { user_id: st.user.id, name: '기본아이콘위젯', url: 'https://w2.dev', program_type: 'widget', pipeline: { vercel: { date: '2026-10-05' } } }); await st.store.create('programs', { user_id: st.user.id, name: '모바일앱', url: 'https://m.dev', program_type: 'mobile', icon: '' }); await st.refreshAll(); });
await page.click('.nav-item[data-path="/home"]'); await page.waitForTimeout(300);
await page.click('.nav-item[data-path="/programs"]'); await page.waitForTimeout(400);
const icons = await page.evaluate(() => [...document.querySelectorAll('[data-program-icon]')].map((n) => n.textContent));
expect('목록 아이콘: 🚀(지정), 🧩(위젯 기본), 📱(모바일 기본)', icons.includes('🚀') && icons.includes('🧩') && icons.includes('📱'), JSON.stringify(icons));
const badge = await page.locator('.nm-badge', { hasText: '일 전 배포' }).count();
expect('마지막 배포 배지(2일 전 배포)', badge >= 1 && (await page.locator('text=2일 전 배포').count()) >= 1);
await page.click('#program-ping-all'); await page.waitForTimeout(800);
const dots = await page.evaluate(() => [...document.querySelectorAll('.health-dot')].map((d) => d.className));
expect('상태 확인 후 점 표시(응답함/실패 중 하나로 갱신)', dots.length >= 3 && dots.every((c) => !/--none/.test(c)), JSON.stringify(dots));
await page.screenshot({ path: path.join(SHOTS, 'prog-list.png') });
// 수정 폼에서 기존 아이콘 유지
await page.locator('tr', { hasText: '내 위젯' }).locator('button[title="수정"]').first().click(); await page.waitForSelector('.nm-modal form');
expect('수정 폼에 기존 아이콘 값', (await page.inputValue('.nm-modal input[name=icon]')) === '🚀');
await closeAll();
// 홈 위젯
await page.click('.nav-item[data-path="/home"]'); await page.waitForTimeout(500);
const homeIcons = await page.evaluate(() => [...document.querySelectorAll('.program-icon')].map((n) => n.textContent));
expect('홈 프로그램 위젯에 아이콘 표시', homeIcons.length >= 1, JSON.stringify(homeIcons));
// CSV 내보내기/가져오기 왕복(JSON 백업으로 아이콘 보존)
const rt = await page.evaluate(async () => {
  const st = window.appState; const src = st.programs.find((p) => p.name === '내 위젯');
  const { id, created_at, updated_at, user_id, ...rest } = src;
  const rec = window.sanitizeImportRecord ? window.sanitizeImportRecord({ ...src }) : rest;
  return { icon: rec.icon, type: rec.program_type };
});
expect('가져오기 정리 후에도 icon/program_type 유지', rt.icon === '🚀' && rt.type === 'widget', JSON.stringify(rt));
const csvHeader = await page.evaluate(() => (window.__lastCsv || ''));

// ================= 첨부 용량 =================
// 로컬 모드 localStorage(~5MB) 한계를 피하려고 attachments 테이블만 메모리 저장소로 교체한다(검증 대상은 UI/용량 검사/지연 로딩).
await page.evaluate(() => {
  const st = window.appState; const mem = new Map(); let seq = 0; const o = { create: st.store.create.bind(st.store), get: st.store.get.bind(st.store), remove: st.store.remove.bind(st.store), list: st.store.list.bind(st.store) };
  window.__mem = mem; window.__listCols = [];
  st.store.create = async (t, obj, opts) => { if (t !== 'attachments') return o.create(t, obj, opts); const row = { ...obj, id: `att${++seq}`, created_at: new Date().toISOString() }; mem.set(row.id, row); const { data, ...meta } = row; return opts && opts.columns ? meta : row; };
  st.store.get = async (t, id) => (t === 'attachments' ? mem.get(id) || null : o.get(t, id));
  st.store.remove = async (t, id) => (t === 'attachments' ? mem.delete(id) : o.remove(t, id));
  st.store.list = async (t, opts) => { if (t === 'attachments') { window.__listCols.push(opts && opts.columns); return [...mem.values()].map(({ data, ...m }) => m); } return o.list(t, opts); };
});
const bigPdf = (mb) => ({ name: `big-${mb}.pdf`, mimeType: 'application/pdf', buffer: Buffer.alloc(Math.round(mb * 1024 * 1024), 0x25) });
await page.click('.nav-item[data-path="/knowledge"]'); await page.waitForTimeout(300);
await page.click('button:has-text("+ 링크/문서 등록")'); await page.waitForSelector('.nm-modal form');
await page.fill('.nm-modal input[name=title]', '큰 파일 문서');
await page.fill('.nm-modal input[name=url]', 'https://example.com/doc');
await page.click('.nm-modal button[type=submit]');
await page.waitForSelector('#new-knowledge-attach-box .attach-limit-note');
expect('Knowledge 힌트: 파일당 최대 10MB', (await page.textContent('#new-knowledge-attach-box .attach-limit-note')).includes('10MB'));
await page.setInputFiles('#new-knowledge-attach-box input[type=file]', bigPdf(11)); await page.waitForTimeout(800);
const t11 = (await toasts()).join('|');
expect('11MB는 거절 + 파일 크기/제한이 적힌 토스트', /11\.0MB/.test(t11) && /10MB/.test(t11), t11);
expect('11MB는 저장소로 보내지 않음', (await page.evaluate(() => window.__mem.size)) === 0);
await page.screenshot({ path: path.join(SHOTS, 'attach-11mb.png') });
await page.setInputFiles('#new-knowledge-attach-box input[type=file]', bigPdf(9)); await page.waitForTimeout(2500);
const mem9 = await page.evaluate(() => [...window.__mem.values()].map((r) => ({ size: r.size, len: r.data.length })));
expect('9MB는 저장(Data URL 약 12MB)', mem9.length === 1 && mem9[0].size === 9 * 1024 * 1024 && mem9[0].len > 11.9 * 1024 * 1024, JSON.stringify(mem9));
expect('목록에 파일 이름/크기 표시', (await page.locator('#new-knowledge-attach-box .attach-item').count()) === 1);
await page.screenshot({ path: path.join(SHOTS, 'attach-9mb.png') });
await page.click('.nm-modal button:has-text("완료")');
// refreshAll은 본문(data)을 내려받지 않는다
await page.evaluate(async () => { window.__listCols = []; await window.appState.refreshAll(); });
const cols = await page.evaluate(() => window.__listCols);
expect('refreshAll: attachments를 메타 컬럼만 조회(data 제외)', cols.length >= 1 && cols.every((c) => typeof c === 'string' && !c.split(',').includes('data') && c.split(',').includes('id')), JSON.stringify(cols));
const hasData = await page.evaluate(() => Object.values(window.appState.attachmentsByOwner).flat().some((a) => 'data' in a));
expect('메모리 상태의 첨부 행에 data 없음', !hasData);
// 열람 모달에서 지연 로딩: 본문은 열 때 getAttachmentData로 가져온다
await page.evaluate(() => { window.appState._attachCache = new Map(); window.appState._attachChars = 0; window.__gets = 0; const g = window.appState.store.get; window.appState.store.get = async (...a) => { if (a[0] === 'attachments') window.__gets++; return g(...a); }; });
await page.locator('tr, .data-table tbody tr', { hasText: '큰 파일 문서' }).first().locator('button[title="열람"]').click();
await page.waitForSelector('.nm-modal .attach-preview'); await page.waitForTimeout(2500);
const gets = await page.evaluate(() => window.__gets);
expect('열람 모달을 열 때 본문 1회 지연 로딩', gets === 1, String(gets));
await page.screenshot({ path: path.join(SHOTS, 'attach-view.png') });
await closeAll();
// 4MB 유지: 이력/경력(증명사진)은 5MB 거절
await page.click('.nav-item[data-path="/career"]'); await page.waitForTimeout(300);
const lim = await page.evaluate(() => ({ k: window.attachmentLimit('knowledge_docs'), c: window.attachmentLimit('career_photos'), x: window.attachmentLimit('anything') }));
expect('소유 테이블별 제한: knowledge 10MB, 그 외 4MB', lim.k === 10485760 && lim.c === 4194304 && lim.x === 4194304, JSON.stringify(lim));
const r5 = await page.evaluate(async () => { try { await window.appState.addAttachment('career_photos', 'x', new File([new Uint8Array(5 * 1024 * 1024)], 'p.png', { type: 'image/png' })); return 'accepted'; } catch (e) { return e.message; } });
expect('4MB 메뉴에서 5MB는 거절', /5\.0MB/.test(r5) && /4MB/.test(r5), r5);

// ================= Knowledge 중복 URL 경고 =================
await page.click('.nav-item[data-path="/knowledge"]'); await page.waitForTimeout(300);
await page.click('button:has-text("+ 링크/문서 등록")'); await page.waitForSelector('.nm-modal form');
await page.fill('.nm-modal input[name=url]', 'https://www.example.com/doc/?utm_source=news');
await page.dispatchEvent('.nm-modal input[name=url]', 'input');
const dup = await page.locator('.nm-modal [role=status]:not([hidden])').allTextContents();
expect('중복 URL 경고(추적 파라미터/www 무시)', dup.some((t) => t.includes('큰 파일 문서')), JSON.stringify(dup));
await page.screenshot({ path: path.join(SHOTS, 'knowledge-dup.png') });
await page.fill('.nm-modal input[name=url]', 'https://another.example.org/x'); await page.dispatchEvent('.nm-modal input[name=url]', 'input');
expect('다른 URL이면 경고 숨김', (await page.locator('.nm-modal [role=status]:not([hidden])').count()) === 0);

expect('콘솔/페이지 오류 없음', !errors.length, errors.join('\n'));
await browser.close(); server.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL OK'); process.exit(fails ? 1 : 0);
