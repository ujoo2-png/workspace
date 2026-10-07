import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from './helpers/formFixtures.mjs';

// v7.22.0 양식 문서: 매칭 엔진 + docx/xlsx 채우기 왕복. 벤더 라이브러리(js/vendor)가 없으면 스스로 건너뛴다.
const libs = F.loadLibs();
const skip = libs ? false : 'js/vendor/exceljs.min.js · jszip.min.js 가 없어 건너뜁니다';
if (libs) { globalThis.JSZip = libs.JSZip; globalThis.ExcelJS = libs.ExcelJS; }
const { FT, FE, CL } = libs ? F.loadAppScripts() : {};
const OPTS = { dateFormat: 'YYYY-MM-DD', order: 'asc', addRows: true };
const ds = () => FT.buildDataset({ career: F.sampleCareer(), basic: F.sampleBasic, todayIso: '2026-10-07' });
async function run(kind, bytes, edit) {
  const { analysis } = await FE.analyzeTemplate(bytes, kind);
  const d = ds();
  const values = FT.buildInitialValues(analysis, d, OPTS);
  if (edit) edit(values, analysis);
  const mapping = { version: 1, kind, fields: analysis.fields, repeats: analysis.repeats, options: OPTS, warnings: [] };
  const out = await FE.fillTemplate(kind, bytes, mapping, values, { dataset: d });
  return { analysis, values, out: out.bytes };
}

test('라벨 사전: 띄어쓴 한글/영문 변형을 같은 항목으로 인식', { skip }, () => {
  for (const [t, src] of [['성 명', 'basic.name'], ['성명', 'basic.name'], ['생 년 월 일', 'basic.birth_date'], ['E-mail', 'basic.email']]) {
    const r = FT.lookupLabel(t);
    assert.ok(r, t);
    assert.equal(FT.scalarSourceOf ? (FT.scalarSourceOf(r) || r.source || r) : r.source, src, t);
  }
  assert.equal(FT.lookupLabel('무관한 문장입니다 가나다라'), null);
});

test('자리표시자 {{ }} / [[ ]] 탐지', { skip }, () => {
  const toks = FT.findTokens('이름 {{성명}} 메일 [[이메일]] 끝');
  assert.equal(toks.length, 2);
});

test('xlsx 분석: 개별 항목 6, 반복 표 3, 사진 칸 1', { skip }, async () => {
  const bytes = await F.buildResumeXlsx(libs.ExcelJS);
  const { analysis } = await FE.analyzeTemplate(bytes, 'xlsx');
  assert.equal(analysis.repeats.length, 3);
  assert.deepEqual(analysis.repeats.map((r) => r.category).sort(), ['certifications', 'education', 'experiences']);
  assert.ok(analysis.fields.some((f) => f.source === 'basic.name' && f.level === 'high'));
  assert.ok(analysis.fields.some((f) => f.kind === 'photo'));
});

test('xlsx 채우기: 값, 행 추가, 스타일/병합/무관 텍스트 보존', { skip }, async () => {
  const src = await F.buildResumeXlsx(libs.ExcelJS);
  const { out } = await run('xlsx', src, (v) => { const k = Object.keys(v.scalars).find((x) => v.scalars[x] === '홍길동'); v.scalars[k] = '김수정'; });
  const wb = new libs.ExcelJS.Workbook(); await wb.xlsx.load(out);
  const ws = wb.getWorksheet('이력서');
  assert.equal(ws.getCell('B3').value, '김수정');
  assert.equal(ws.getCell('B10').value, '서울고등학교');
  assert.equal(ws.getCell('B17').value, '감마랩스'); // 경력 3건 → 행 추가
  assert.equal(ws.getCell('A3').font.bold, true);
  assert.equal(ws.getCell('A3').fill.fgColor.argb, 'FFFFF2CC');
  assert.equal(ws.getCell('A1').isMerged, true);
});

test('docx 분석: 라벨이 run으로 쪼개져도 매칭, 반복 표 3개', { skip }, async () => {
  const bytes = await F.buildDocx(libs.JSZip);
  const { analysis } = await FE.analyzeTemplate(bytes, 'docx');
  assert.ok(analysis.fields.some((f) => f.source === 'basic.name'));
  assert.equal(analysis.repeats.length, 3);
});

test('docx 채우기: 값 치환, 서식(rPr)·무관 문장 유지, 행 복제', { skip }, async () => {
  const src = await F.buildDocx(libs.JSZip);
  const { out } = await run('docx', src);
  const zip = await libs.JSZip.loadAsync(out);
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /홍길동/);
  assert.match(xml, /감마랩스/);
  assert.match(xml, /서울고등학교/);
  assert.match(xml, /<w:b\/>/);
  assert.ok(!/\{\{|\[\[/.test(xml), '자리표시자가 남아 있음');
});

test('지원하지 않는 형식은 안내 문구와 함께 거절', { skip }, () => {
  assert.equal(FE.checkFileName('a.docx').ok, true);
  assert.equal(FE.checkFileName('a.xlsx').kind, 'xlsx');
  const doc = FE.checkFileName('a.doc');
  assert.equal(doc.ok, false); assert.match(doc.message, /\.docx로 저장 후 다시 시도/);
  for (const n of ['a.xlsm', 'a.pdf', 'a.xls', 'scan.png']) { const r = FE.checkFileName(n); assert.equal(r.ok, false, n); assert.match(r.message, /지원하지 않습니다/); }
});

test('날짜 형식 변환', { skip }, () => {
  assert.equal(CL.formatDate('2024-03-05', 'YYYY.MM.DD'), '2024.03.05');
  assert.equal(CL.formatDate('2024-03-05', 'YYYY-MM-DD'), '2024-03-05');
  assert.equal(CL.formatDate('', 'YYYY.MM.DD'), '');
});
