import { serve, launch, login } from './harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadLibs, loadAppScripts, buildResumeXlsx, buildDocx, makePng, sampleCareer, sampleBasic } from '../../helpers/formFixtures.mjs';
// 이력/경력 양식 문서(v7.22.0) E2E — 로컬 모드 복사본에서 실행:
//   tests/tools/e2e/make-local-copy.sh <repo> /tmp/ws-local && NODE_PATH=<playwright node_modules> node tests/tools/e2e/career-docs-e2e.mjs /tmp/ws-local 8330
const [root, port] = process.argv.slice(2);
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'career-docs-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const libs = loadLibs();
globalThis.JSZip = libs.JSZip; globalThis.ExcelJS = libs.ExcelJS;
const { XT, FT, FE } = loadAppScripts();
const FIX = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-fixtures-'));
const xlsxPath = path.join(FIX, '이력서양식.xlsx');
const docxPath = path.join(FIX, '이력서양식.docx');
fs.writeFileSync(xlsxPath, await buildResumeXlsx(libs.ExcelJS));
fs.writeFileSync(docxPath, await buildDocx(libs.JSZip));
fs.writeFileSync(path.join(FIX, '구형양식.doc'), Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3]));
fs.writeFileSync(path.join(FIX, '스캔.pdf'), '%PDF-1.4 fake');
fs.writeFileSync(path.join(FIX, '가짜.docx'), 'not a zip');
fs.writeFileSync(path.join(FIX, '암호.xlsx'), Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]));
// Playwright가 한글 파일 경로를 setInputFiles에 넘기면(로케일 문제) change 이벤트가 안 오므로, 한글 이름은 버퍼 페이로드로 올린다.
const payload = (p, name) => ({ name: name || path.basename(p), mimeType: 'application/octet-stream', buffer: fs.readFileSync(p) });
const pngPath = path.join(FIX, 'photo.png');
fs.writeFileSync(pngPath, makePng(30, 40));

const server = await serve(root, Number(port));
const browser = await launch();
const base = `http://localhost:${port}`;
const errors = []; let fails = 0;
const expect = (name, cond, detail = '') => { if (!cond) fails++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : detail); };
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
const page = await ctx.newPage();
const requests = [];
page.on('request', (r) => requests.push(r.url()));
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept());
// 헤드리스 Chromium(로케일 C)은 한글 다운로드 이름을 "download"로 바꿔 버려서, 앱이 지정한 a[download] 이름을 직접 기록해 검증한다.
await page.addInitScript(() => { const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) (window.__dl = window.__dl || []).push(this.download); return orig.apply(this, arguments); }; });
const lastDl = () => page.evaluate(() => (window.__dl || []).slice(-1)[0]);
await page.route('**/api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await page.clock.setFixedTime(new Date('2026-10-07T12:00:00+09:00'));
await login(page, base);
const toasts = () => page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent));
const shot = (n) => page.screenshot({ path: path.join(SHOTS, n), fullPage: false });

// ---------- 등록 데이터 입력 ----------
const career = sampleCareer();
await page.click('.nav-item[data-path="/career"]'); await page.waitForTimeout(300);
expect('첫 화면 로딩에 벤더 라이브러리 요청 없음(지연 로딩)', !requests.some((u) => /vendor\//.test(u)) && !(await page.evaluate(() => !!window.ExcelJS)), requests.filter((u) => /vendor/.test(u)).join());
// 기본정보 — UI로 입력
await page.click('.quick-tab[data-tab=basic]');
await page.waitForSelector('.career-basic__form');
expect('기본정보 화면에 민감정보 안내', /민감한 개인정보/.test(await page.textContent('.career-pii')));
await page.click('.career-basic__save');
expect('성명 없이 저장 → 오류 문구', /성명/.test(await page.textContent('.career-basic__form .cd-error')));
for (const [k, v] of Object.entries(sampleBasic)) {
  const sel = `.career-basic__form [name=${k}]`;
  if (k === 'gender' || k === 'military') await page.selectOption(sel, v); else await page.fill(sel, v);
}
await page.click('.career-basic__save'); await page.waitForTimeout(300);
expect('기본정보 저장됨', (await page.evaluate(() => window.appState.careerBasic && window.appState.careerBasic.name)) === '홍길동');
// 학력 1건은 UI 폼으로, 나머지는 상태 API로
await page.click('.quick-tab[data-tab=education]');
await page.click('button:has-text("+ 학력 추가")'); await page.waitForSelector('.nm-modal form');
await page.fill('.nm-modal input[name=school_name]', career.education[0].school_name);
await page.fill('.nm-modal input[name=degree]', career.education[0].degree);
await page.fill('.nm-modal input[name=admission_date]', career.education[0].admission_date);
await page.fill('.nm-modal input[name=graduation_date]', career.education[0].graduation_date);
await page.click('.nm-modal button[type=submit]'); await page.waitForTimeout(400);
await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));
await page.evaluate(async ({ career }) => {
  const s = window.appState;
  for (const [cat, rows] of Object.entries(career)) {
    if (cat === 'photos' || cat === 'education') continue;
    for (const r of rows) { const { id, sort_order, ...data } = r; await s.addCareerRecord(cat, data); }
  }
  for (const r of career.education.slice(1)) { const { id, sort_order, ...data } = r; await s.addCareerRecord('education', data); }
}, { career });
// 증명사진(이미지 첨부 포함)
const pngB64 = fs.readFileSync(pngPath).toString('base64');
await page.evaluate(async (b64) => {
  const s = window.appState;
  const row = await s.addCareerRecord('photos', { label: '2026 여권용', taken_date: '2026-01-05' });
  const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  await s.addAttachment('career_photos', row.id, new File([u8], 'photo.png', { type: 'image/png' }));
}, pngB64);
expect('등록 데이터 입력 완료(학력3/경력3/자격3/교육2/단체1/포상2/사진1)', await page.evaluate(() => { const c = window.appState.career; return c.education.length === 3 && c.experiences.length === 3 && c.certifications.length === 3 && c.trainings.length === 2 && c.memberships.length === 1 && c.awards.length === 2 && c.photos.length === 1; }));

// ---------- 추가 아이디어: 총 경력 / 경력기술서 / 자격 만료 ----------
await page.click('.quick-tab[data-tab=experiences]');
const totalTxt = await page.textContent('.career-total-exp');
expect('총 경력(겹침 제외) 표시: 2014.03~2023.05(겹침·공백 제외) = 9년 2개월', totalTxt === '9년 2개월', totalTxt);
await page.click('.career-narrative-btn'); await page.waitForSelector('.nm-modal textarea[name=narrative]');
const narr = await page.inputValue('.nm-modal textarea[name=narrative]');
expect('경력기술서 문안에 회사/기간/총경력 포함', /총 경력 9년 2개월/.test(narr) && /\(주\)베타시스템 \| 2018\.03 ~ 2023\.05/.test(narr) && /클라우드 전환 프로젝트 리드/.test(narr), narr.slice(0, 200));
await shot('01-narrative.png');
await page.evaluate(() => document.querySelectorAll('.nm-modal-backdrop').forEach((n) => n.remove()));
await page.click('.quick-tab[data-tab=certifications]');
expect('자격증 만료 임박 알림(SQLD 2026-11-01)', /만료 임박 1건/.test(await page.textContent('.career-extra--cert')) && /만료 25일 전/.test(await page.textContent('.data-table')));

// ---------- 양식 문서 탭 ----------
await page.click('.quick-tab[data-tab=docs]');
await page.waitForSelector('.cd-help', { timeout: 15000 });
expect('양식 문서 탭을 열 때 라이브러리 로딩(ExcelJS/JSZip)', await page.evaluate(() => !!window.ExcelJS && !!window.JSZip && !!window.FormEngine));
expect('벤더 파일이 이 서버에서만 로딩됨', requests.filter((u) => /vendor\//.test(u)).every((u) => u.startsWith(base)), requests.filter((u) => /vendor/.test(u)).join());
expect('빈 목록 안내', /아직 만든 양식 문서가 없습니다/.test(await page.textContent('.cd-host')));
await shot('02-docs-empty.png');

// 새 문서: 지원하지 않는 형식들
await page.click('button:has-text("+ 새 양식 문서")'); await page.waitForSelector('#cd-file-input', { state: 'attached' });
const uploadError = async (file) => { await page.setInputFiles('#cd-file-input', payload(file)); await page.waitForTimeout(400); return page.textContent('.nm-modal .cd-error'); };
let e1 = await uploadError(path.join(FIX, '구형양식.doc'));
expect('.doc → "이 형식은 지원하지 않습니다: .doc → .docx로 저장 후 다시 시도"', /이 형식은 지원하지 않습니다: \.doc → \.docx로 저장 후 다시 시도/.test(e1), e1);
expect('PDF 거부', /지원하지 않습니다: \.pdf/.test(await uploadError(path.join(FIX, '스캔.pdf'))));
expect('손상 파일(.docx) 거부', /열 수 없습니다/.test(await uploadError(path.join(FIX, '가짜.docx'))));
expect('암호 걸린 파일 안내', /암호가 걸렸거나/.test(await uploadError(path.join(FIX, '암호.xlsx'))));
await shot('03-unsupported.png');

// ===== XLSX 양식 =====
await page.fill('.nm-modal input[name=doc-title]', '○○회사 이력서(엑셀)');
await page.setInputFiles('#cd-file-input', payload(xlsxPath));
await page.waitForSelector('.cd-editor', { timeout: 15000 }).catch(async (e) => { console.log('MODAL ERR:', await page.textContent('.nm-modal .cd-error').catch(() => 'n/a')); throw e; });
await page.waitForSelector('.cd-sheet table', { timeout: 15000 });
const valOf = async (label) => page.inputValue(`.cd-fields tr:has(strong:text-is("${label}")) .cd-val`);
expect('XLSX 자동 매칭: 성명=홍길동', (await valOf('성 명')) === '홍길동');
expect('XLSX 자동 매칭: 생년월일(YYYY-MM-DD)', (await valOf('생 년 월 일')) === '1990-05-17');
expect('XLSX 자동 매칭: 연락처/이메일/주소', (await valOf('연락처')) === '010-1234-5678' && (await valOf('E-mail')) === 'gildong@example.com' && (await valOf('주 소')) === '서울특별시 중구 세종대로 110');
const repCards = await page.locator('.cd-rep').count();
expect('XLSX 반복 표 3개(학력/경력/자격)', repCards === 3, String(repCards));
const eduRows = await page.locator('.cd-rep:has-text("학력 표") tbody tr').count();
expect('학력 3행(오래된 순)', eduRows === 3 && (await page.inputValue('.cd-rep:has-text("학력 표") tbody tr:first-child td:nth-child(3) input')) === '서울고등학교');
expect('경력 3건 → 양식 빈 행 2 → 행 자동 추가 안내', /양식 빈 행 2개 · 입력 3건 → 저장 시 1행 자동 추가/.test(await page.textContent('.cd-rep:has-text("경력 표") .cd-rep__cap')));
const um = await page.textContent('.cd-unmatched');
expect('매칭되지 않은 항목: 교육이수/가입단체/포상/요약(총 경력)', /교육이수 2건/.test(um) && /가입단체 1건/.test(um) && /포상 2건/.test(um) && /총 경력/.test(um), um);
expect('미리보기에 채운 값(홍길동) 표시 + 강조', (await page.locator('.cd-sheet td.fd-hl', { hasText: '홍길동' }).count()) >= 1);
expect('미리보기는 근사치라고 표시', /근사치/.test(await page.textContent('.cd-preview__head')));
await shot('04-xlsx-editor-top.png');
await page.locator('.cd-rep').first().scrollIntoViewIfNeeded();
await shot('05-xlsx-editor-repeats.png');

// 날짜 형식 변경 → 값 갱신(손대지 않은 값만)
await page.selectOption('.cd-opt-date', 'YYYY년 M월 D일'); await page.waitForTimeout(300);
expect('날짜 형식 변경: 생년월일 → 1990년 5월 17일', (await valOf('생 년 월 일')) === '1990년 5월 17일');
expect('날짜 형식 변경: 학력 기간 셀', (await page.inputValue('.cd-rep:has-text("학력 표") tbody tr:first-child td:nth-child(2) input')).startsWith('2005년 3월 2일 ~ 2008년 2월 15일'));
await page.selectOption('.cd-opt-date', 'YYYY.MM.DD'); await page.waitForTimeout(200);
// 값 편집
await page.fill('.cd-fields tr:has(strong:text-is("성 명")) .cd-val', '홍길동(수정본)');
await page.waitForTimeout(700);
expect('편집 후 미리보기 반영', (await page.locator('.cd-sheet', { hasText: '홍길동(수정본)' }).count()) === 1);
expect('저장하지 않은 변경 표시', /저장하지 않은 변경/.test(await page.textContent('.cd-statusline')));
// 사진 선택 확인
const photoSel = await page.inputValue('.cd-photo-sel');
expect('증명사진 자동 선택', !!photoSel);
await page.waitForSelector('.cd-photo-thumb img');
// 임시저장 → 목록 → 다시 열기
await page.click('.cd-save-draft'); await page.waitForTimeout(800);
expect('임시저장 토스트', (await toasts()).some((t) => /임시저장했습니다/.test(t)));
expect('임시저장 직후 상태 배지', /임시저장/.test(await page.textContent('.cd-top-meta .cd-badge')));
await page.click('.cd-back'); await page.waitForSelector('.cd-table');
expect('목록에 임시저장 행', /임시저장/.test(await page.textContent('.cd-table tbody tr:first-child')) && /○○회사 이력서\(엑셀\)/.test(await page.textContent('.cd-table tbody tr:first-child')));
await shot('06-list-after-draft.png');
await page.click('.cd-table tbody tr:first-child .cd-act-edit'); await page.waitForSelector('.cd-editor');
await page.waitForTimeout(500);
expect('다시 열기: 편집한 값 유지(홍길동(수정본))', (await valOf('성 명')) === '홍길동(수정본)');
// 닫을 때 변경 확인 모달
await page.fill('.cd-fields tr:has(strong:text-is("주 소")) .cd-val', '부산광역시 해운대구 1');
await page.click('.cd-back'); await page.waitForSelector('.cd-close-cancel');
expect('저장하지 않은 변경 → 3지선다 모달', (await page.locator('.cd-close-save').count()) === 1 && (await page.locator('.cd-close-discard').count()) === 1);
await shot('07-close-confirm.png');
await page.click('.cd-close-cancel');
expect('계속 편집 → 편집 화면 유지', (await page.locator('.cd-editor').count()) === 1);
// 저장(최종본) + 다운로드
const dlPromise = page.waitForEvent('download', { timeout: 20000 });
await page.click('.cd-save-final');
const dl = await dlPromise;
const xlsxOut = path.join(FIX, 'out.xlsx');
await dl.saveAs(xlsxOut);
expect('최종본 파일명 규칙(최종_<제목>_<날짜>.xlsx)', /^최종_○○회사 이력서\(엑셀\)_20261007\.xlsx$/.test(await lastDl()), await lastDl());
await page.waitForTimeout(800);
expect('저장완료 배지 + 최종본 목록 1개', /저장완료/.test(await page.textContent('.cd-top-meta .cd-badge')) && (await page.locator('.cd-final').count()) === 1);
expect('최종본이 attachments(owner_table=career_documents)에 저장됨', await page.evaluate(() => window.appState.getAttachments('career_documents', window.appState.careerDocuments[0].id).some((a) => /^최종_/.test(a.name))));
expect('양식 원본도 첨부로 보관됨', await page.evaluate(() => { const d = window.appState.careerDocuments[0]; return window.appState.getAttachments('career_documents', d.id).some((a) => a.id === d.template_attachment_id && a.name === '이력서양식.xlsx'); }));
// 최종 파일 재파싱
{
  const wb = new libs.ExcelJS.Workbook(); await wb.xlsx.load(fs.readFileSync(xlsxOut));
  const ws = wb.getWorksheet('이력서');
  expect('최종 xlsx: 편집한 값(성명) 들어감', ws.getCell('B3').value === '홍길동(수정본)', String(ws.getCell('B3').value));
  expect('최종 xlsx: 주소 편집값', ws.getCell('B5').value === '부산광역시 해운대구 1');
  expect('최종 xlsx: 학력/경력 표 채움 + 행 추가 후 자격 표 이동', ws.getCell('B10').value === '서울고등학교' && ws.getCell('B15').value === '(주)알파소프트' && ws.getCell('B17').value === '감마랩스' && ws.getCell('A18').value === '자격사항' && ws.getCell('B19').value === '자격증명' && String(ws.getCell('B20').value) === '운전면허 1종', [ws.getCell('B10').value, ws.getCell('B15').value, ws.getCell('B17').value, ws.getCell('A18').value, ws.getCell('B20').value, ws.getCell('B21').value].join('|'));
  expect('최종 xlsx: 사진 이미지 삽입', ws.getImages().length === 1);
  expect('최종 xlsx: 라벨 스타일 유지(A3 굵게+노란 배경)', ws.getCell('A3').font.bold === true && ws.getCell('A3').fill.fgColor.argb === 'FFFFF2CC');
  expect('최종 xlsx: 병합 유지(B3:C3, A1:G1)', ws.model.merges.includes('B3:C3') && ws.model.merges.includes('A1:G1'));
  expect('최종 xlsx: 무관한 텍스트 보존', ws.getCell('A1').value === '이  력  서' && /사실과 다름이 없습니다/.test(String(ws.getCell('A25').value || ws.getCell('A24').value)));
}
await shot('08-xlsx-saved.png');
// 목록에서 다운로드(최종본)
await page.click('.cd-back'); await page.waitForSelector('.cd-table');
expect('목록 상태 저장완료', /저장완료/.test(await page.textContent('.cd-table tbody tr:first-child')));
const dl2P = page.waitForEvent('download'); await page.click('.cd-table tbody tr:first-child .cd-act-download'); const dl2 = await dl2P;
expect('목록 ⬇ → 최종본 다운로드', /^최종_/.test(await lastDl()) && dl2 !== null, await lastDl());

// ===== DOCX 양식 =====
await page.click('button:has-text("+ 새 양식 문서")'); await page.waitForSelector('#cd-file-input', { state: 'attached' });
expect('양식 보관함에 이전 양식 노출', (await page.locator('.cd-lib-item').count()) === 1);
await page.fill('.nm-modal input[name=doc-title]', '△△기관 이력서(워드)');
await page.setInputFiles('#cd-file-input', payload(docxPath));
await page.waitForSelector('.cd-editor .cd-sheet--docx', { timeout: 15000 });
expect('DOCX 자동 매칭: 성명(run이 글자 단위로 쪼개진 라벨)=홍길동', (await valOf('성명')) === '홍길동');
expect('DOCX 자리표시자 {{이메일}}/[[전화번호]] (run 분할) 감지', (await page.locator('.cd-fields .cd-tag').count()) === 2);
expect('DOCX 인라인 빈칸(병역/국적)', (await valOf('병역')) === '군필' && (await valOf('국적')) === '대한민국');
expect('DOCX 반복 표 3개', (await page.locator('.cd-rep').count()) === 3);
expect('DOCX 사진 칸 감지', (await page.locator('.cd-photo-row').count()) === 1);
await shot('09-docx-editor-top.png');
await page.fill('.cd-fields tr:has(strong:text-is("성명")) .cd-val', '홍길동 DOCX');
// 표 편집: 학력 첫 행 학교명 수정 + 행 삭제 + 순서 변경
await page.fill('.cd-rep:has-text("학력 표") tbody tr:first-child td:nth-child(3) input', '서울고등학교(수정)');
await page.click('.cd-rep:has-text("자격증 표") tbody tr:last-child button[title="이 행 빼기"]');
expect('행 빼면 매칭되지 않은 항목에 나타남', /자격증 1건/.test(await page.textContent('.cd-unmatched')));
await page.click('.cd-rep:has-text("자격증 표") .cd-um-add, .cd-unmatched .cd-um-add >> nth=0').catch(() => {});
await page.waitForTimeout(600);
await page.locator('.cd-rep:has-text("경력 표")').scrollIntoViewIfNeeded();
await shot('10-docx-editor-repeats.png');
const dlD = page.waitForEvent('download'); await page.click('.cd-save-final'); const dd = await dlD;
const docxOut = path.join(FIX, 'out.docx'); await dd.saveAs(docxOut);
{
  const zip = await libs.JSZip.loadAsync(fs.readFileSync(docxOut));
  const xml = await zip.file('word/document.xml').async('string');
  const text = XT.textOf(XT.parse(xml));
  expect('최종 docx: 편집한 성명', text.includes('홍길동 DOCX'));
  expect('최종 docx: 편집한 학교명', text.includes('서울고등학교(수정)'));
  expect('최종 docx: 자리표시자 제거 및 값 치환', !text.includes('{{') && !text.includes('[[') && text.includes('gildong@example.com') && text.includes('010-1234-5678'));
  expect('최종 docx: 경력 3건(행 복제)', text.includes('(주)알파소프트') && text.includes('(주)베타시스템') && text.includes('감마랩스'));
  expect('최종 docx: 무관한 문장 유지', text.includes('※ 이 문장은 그대로 남아야 합니다.'));
  expect('최종 docx: 라벨 run 서식(굵게/색) 유지', /<w:rPr><w:rFonts w:ascii="Malgun Gothic"[^>]*\/><w:b\/><w:color w:val="1F3864"\/><w:sz w:val="20"\/><\/w:rPr><w:t xml:space="preserve">성<\/w:t>/.test(xml));
  expect('최종 docx: 값 글꼴(Batang) 적용', /<w:rFonts w:ascii="Batang"[^>]*\/><w:sz w:val="22"\/><\/w:rPr><w:t xml:space="preserve">홍길동 DOCX<\/w:t>/.test(xml));
  expect('최종 docx: 사진 관계/미디어/콘텐츠타입', !!zip.file(/word\/media\/formphoto_1\.png/)[0] && /formphoto_1\.png/.test(await zip.file('word/_rels/document.xml.rels').async('string')) && /Extension="png"/.test(await zip.file('[Content_Types].xml').async('string')) && /<w:drawing>/.test(xml));
}
await page.waitForTimeout(600);

// ---------- 목록 기능 ----------
await page.click('.cd-back'); await page.waitForSelector('.cd-table');
expect('목록 2건', (await page.locator('.cd-table tbody tr').count()) === 2);
await page.fill('.cd-search', '워드'); await page.waitForTimeout(200);
expect('검색: 제목 "워드" → 1건', (await page.locator('.cd-table tbody tr').count()) === 1);
await page.fill('.cd-search', ''); await page.waitForTimeout(200);
await page.selectOption('.cd-status-filter', 'draft'); await page.waitForTimeout(200);
expect('상태 필터 임시저장 → 0건', (await page.locator('.cd-table tbody tr').count()) === 0 || /결과가 없습니다/.test(await page.textContent('.cd-host')));
await page.selectOption('.cd-status-filter', 'saved'); await page.waitForTimeout(200);
expect('상태 필터 저장완료 → 2건', (await page.locator('.cd-table tbody tr').count()) === 2);
await page.selectOption('.cd-status-filter', 'all'); await page.waitForTimeout(200);
await page.click('.cd-table th:has-text("제목")'); await page.waitForTimeout(200);
const titlesAsc = await page.locator('.cd-table tbody tr td:nth-child(3)').allTextContents();
await page.click('.cd-table th:has-text("제목")'); await page.waitForTimeout(200);
const titlesDesc = await page.locator('.cd-table tbody tr td:nth-child(3)').allTextContents();
expect('제목 정렬 오름/내림', titlesAsc.join('|') === [...titlesDesc].reverse().join('|') && titlesAsc.join('|') !== titlesDesc.join('|'), `${titlesAsc}/${titlesDesc}`);
// 복제
await page.click('.cd-table tbody tr:first-child .cd-act-dup'); await page.waitForTimeout(900);
expect('복제 → 3건, 새 임시저장 "(복사본)"', (await page.locator('.cd-table tbody tr').count()) === 3 && (await page.locator('.cd-table tbody tr', { hasText: '(복사본)' }).count()) === 1);
const dupInfo = await page.evaluate(() => { const d = window.appState.careerDocuments.find((x) => /\(복사본\)/.test(x.title)); const a = window.appState.getAttachments('career_documents', d.id); return { status: d.status, finals: d.finals.length, att: a.length, tpl: !!d.template_attachment_id && a.some((x) => x.id === d.template_attachment_id) }; });
expect('복제본: 임시저장·최종본 없음·양식 원본 첨부 복사', dupInfo.status === 'draft' && dupInfo.finals === 0 && dupInfo.att === 1 && dupInfo.tpl, JSON.stringify(dupInfo));
await shot('11-list-3docs.png');
// 복제본 열어 다른 값으로 → 임시저장 다운로드(최종본 없음)
const dl3P = page.waitForEvent('download'); await page.click('.cd-table tbody tr:has-text("(복사본)") .cd-act-download'); const dl3 = await dl3P;
expect('최종본 없는 문서의 ⬇ → 임시 파일 생성', /^임시_/.test(await lastDl()) && dl3 !== null, await lastDl());
// 개별 삭제 → 첨부 함께 삭제
const beforeAtt = await page.evaluate(() => window.appState.attachmentsByOwner && Object.keys(window.appState.attachmentsByOwner).filter((k) => k.startsWith('career_documents:')).length);
await page.click('.cd-table tbody tr:has-text("(복사본)") .cd-act-delete'); await page.waitForTimeout(800);
const afterAtt = await page.evaluate(() => Object.entries(window.appState.attachmentsByOwner).filter(([k, v]) => k.startsWith('career_documents:') && v.length).length);
expect('개별 삭제 → 2건, 첨부도 삭제', (await page.locator('.cd-table tbody tr').count()) === 2 && afterAtt === beforeAtt - 1, `${beforeAtt}->${afterAtt}`);
// 선택 삭제
await page.click('.cd-table thead input[type=checkbox]'); await page.waitForTimeout(200);
expect('선택 삭제 버튼 건수 표시', /\(2\)/.test(await page.textContent('.cd-bulk-delete')));
await page.click('.cd-bulk-delete'); await page.waitForTimeout(1000);
expect('선택 삭제 → 빈 목록 + 모든 첨부 삭제', (await page.locator('.cd-table').count()) === 0 && (await page.evaluate(() => Object.entries(window.appState.attachmentsByOwner).filter(([k, v]) => k.startsWith('career_documents:') && v.length).length)) === 0);

// ---------- 자동저장 / 화면 이동 시 임시저장 ----------
await page.click('button:has-text("+ 새 양식 문서")'); await page.waitForSelector('#cd-file-input', { state: 'attached' });
await page.fill('.nm-modal input[name=doc-title]', '자동저장 테스트');
await page.setInputFiles('#cd-file-input', payload(docxPath));
await page.waitForSelector('.cd-editor');
expect('새 문서는 편집 전엔 DB에 행이 없음', (await page.evaluate(() => window.appState.careerDocuments.length)) === 0);
await page.fill('.cd-fields tr:has(strong:text-is("성명")) .cd-val', '자동저장 값');
await page.waitForFunction(() => window.appState.careerDocuments.length === 1, null, { timeout: 30000 });
expect('20초 자동 임시저장으로 문서 생성', await page.evaluate(() => window.appState.careerDocuments[0].status === 'draft' && window.appState.careerDocuments[0].field_values.scalars && Object.values(window.appState.careerDocuments[0].field_values.scalars).includes('자동저장 값')));
await page.fill('.cd-fields tr:has(strong:text-is("성명")) .cd-val', '화면이동 값');
await page.click('.nav-item[data-path="/home"]'); await page.waitForTimeout(1200);
expect('화면 이동 시 변경이 조용히 임시저장됨', await page.evaluate(() => Object.values(window.appState.careerDocuments[0].field_values.scalars).includes('화면이동 값')));
await page.click('.nav-item[data-path="/career"]'); await page.click('.quick-tab[data-tab=docs]'); await page.waitForSelector('.cd-table');
await page.click('.cd-table tbody tr:first-child .cd-act-edit'); await page.waitForSelector('.cd-editor'); await page.waitForTimeout(400);
expect('다시 들어오면 값 유지', (await valOf('성명')) === '화면이동 값');
// 임시저장 후 저장 상태가 draft → 최종 저장 후 편집(임시저장) → draft로 돌아감
await page.click('.cd-save-final').catch(() => {});
await page.waitForTimeout(100);

console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'no console errors');
console.log(`screenshots: ${SHOTS}`);
await browser.close(); server.close();
if (fails || errors.length) { console.log(`FAILED: ${fails} failures, ${errors.length} console errors`); process.exit(1); }
console.log('ALL PASSED');
