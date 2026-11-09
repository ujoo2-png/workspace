import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const d = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
globalThis.localStorage = (() => { const m = {}; return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; })();
const CC = require('../js/utils/customColumns.js');
require('../js/utils/careerLogic.js');
require('../js/utils/xmlTree.js');
require('../js/services/formTemplate.js'); const FT = globalThis.FormTemplate;
const read = (p) => fs.readFileSync(path.join(d, '..', p), 'utf8');

test('컬럼 이름 검사: 같은 이름/동의어=차단, 부분 겹침=경고, 새 이름=통과', () => {
  const b = FT.builtinTerms('education');
  assert.equal(CC.checkLabel('education', '학교명', b, {}).level, 'block');      // 기존 필드
  assert.equal(CC.checkLabel('education', '졸업구분', b, {}).level, 'block');    // 동의어
  assert.equal(CC.checkLabel('education', '학위구분', b, {}).level, 'warn');     // '학위/전공'과 겹침
  assert.equal(CC.checkLabel('education', '소재지', b, {}).level, 'ok');
  assert.equal(CC.checkLabel('education', '  ', b, {}).level, 'block');
  const map = { education: [{ id: 'cab12', label: '소재지', type: 'text' }] };
  assert.equal(CC.checkLabel('education', '소재지', b, map).level, 'block');     // 사용자 컬럼 중복
  assert.equal(CC.checkLabel('certifications', '소재지', FT.builtinTerms('certifications'), map).level, 'ok'); // 다른 카테고리는 허용
  assert.equal(CC.checkLabel('experiences', '직위', FT.builtinTerms('experiences'), {}).level, 'ok');
  assert.equal(CC.checkLabel('certifications', '등급', FT.builtinTerms('certifications'), {}).level, 'ok');
});
test('최대 5개·id 재사용 금지·숨김 컬럼은 active에서 제외', () => {
  const map = { awards: [] };
  const ids = new Set();
  for (let i = 0; i < 40; i++) { const id = CC.newId(map); assert.ok(!ids.has(id)); ids.add(id); map.awards.push({ id, label: 'x' + i, type: 'text', archived: true }); }
  assert.equal(CC.active('awards', map).length, 0); assert.equal(CC.archived('awards', map).length, 40);
  assert.equal(CC.MAX, 5);
});
test('extra 병합: 다른 컬럼 값 보존, 빈 값은 삭제, 숫자 변환', () => {
  const defs = [{ id: 'aaa1', type: 'text' }, { id: 'bbb2', type: 'number' }];
  const patch = CC.toExtra(defs, { aaa1: ' 서울 ', bbb2: '1,200' });
  assert.deepEqual(patch, { aaa1: '서울', bbb2: 1200 });
  assert.deepEqual(CC.mergeExtra({ zzz9: 'keep', aaa1: 'old' }, patch), { zzz9: 'keep', aaa1: '서울', bbb2: 1200 });
  assert.deepEqual(CC.mergeExtra({ aaa1: 'x', zzz9: 'k' }, CC.toExtra(defs, { aaa1: '' })), { zzz9: 'k' });
  assert.deepEqual(CC.withoutKey({ a: 1, b: 2 }, 'a'), { b: 2 });
  assert.equal(CC.toExtra(defs, { bbb2: 'abc' }).bbb2, null);
});
test('빈 값 점검', () => {
  const m = CC.missing([{ id: 1, extra: { a: 'x' } }, { id: 2, extra: {} }, { id: 3, deleted_at: 'x' }], [{ id: 'a' }]);
  assert.deepEqual(m.map((x) => x.rec.id), [2]);
});
test('양식 엔진: 사용자 컬럼이 머리글 자동 인식·값 채우기에 반영된다', () => {
  const map = { education: [{ id: 'cab12', label: '소재지', type: 'text', aliases: ['학교소재지'] }], certifications: [{ id: 'cde34', label: '등급', type: 'text' }] };
  FT.registerCustom(Object.fromEntries(FT.CAT_KEYS.map((k) => [k, CC.defs(k, map)])));
  const hit = FT.lookupLabel('소재지'); assert.ok(hit && hit.entry.cat === 'education' && hit.entry.byCat.education === 'x_cab12' && hit.entry.fallback.role === 'org'); // 역할 단어를 사용자 컬럼이 우선
  assert.ok(FT.lookupLabel('학교 소재지'));
  const ds = FT.buildDataset({ career: { education: [{ id: 'e1', school_name: 'A대', extra: { cab12: '서울' }, graduation_date: '2020-02-01' }], certifications: [{ id: 'c1', cert_name: '정보처리', extra: { cde34: '기사' } }] }, todayIso: '2026-11-09' });
  assert.equal(FT.resolveSource(ds, 'education.latest.x_cab12'), '서울');
  assert.equal(FT.resolveSource(ds, 'certifications.1.x_cde34'), '기사');
  assert.equal(FT.resolveSource(ds, 'education.latest.x_zzzz'), ''); // 삭제/숨김 컬럼 → 빈 값, 오류 없음
  assert.ok(FT.repeatSourceOptions('education').some((o) => o.value === 'x_cab12'));
  // 숨김 처리하면 선택지·사전에서 빠진다
  map.education[0].archived = true;
  FT.registerCustom(Object.fromEntries(FT.CAT_KEYS.map((k) => [k, CC.defs(k, map)])));
  assert.equal(FT.lookupLabel('소재지').entry.role, 'org'); assert.ok(!FT.repeatSourceOptions('education').some((o) => o.value === 'x_cab12'));
  FT.registerCustom({});
});
test('양식 분석: 연결 못 한 표 머리글이 unmatched로 나온다', () => {
  assert.match(read('js/services/formTemplate.js'), /unmatched: hdr\.unknown/);
});
test('코드 점검: 폼/목록/검색/정렬/양식/state 연동', () => {
  const c = read('js/modules/career.js');
  for (const re of [/function effective\(/, /openColumnManager/, /data\.extra = window\.CareerCols\.toExtra/, /cv\(r, f\)/, /cv\(a, key\)/, /datalist/]) assert.match(c, re);
  const st = read('js/state.js'); assert.match(st, /mergeExtra\(base, p\.extra\)/); assert.match(st, /purgeCareerExtraKey/); assert.match(st, /0033/);
  assert.match(read('supabase/migrations/0033_career_custom_columns.sql'), /career_photos\s+add column if not exists extra jsonb/);
  assert.match(read('js/services/settingsSync.js'), /workspace:career:customCols/);
  assert.match(read('js/modules/careerDocs.js'), /createColumnFor/);
});

// ── 양식 왕복(엔진 전체): 사용자 컬럼이 표 열로 채워지고, 연결 못 한 열은 제안 목록으로 나온다 ──
import * as F from './helpers/formFixtures.mjs';
const libs = F.loadLibs();
const skip = libs ? false : '벤더 라이브러리 없음';
test('xlsx 왕복: 소재지(사용자 컬럼) 열이 채워지고 "지역"(미등록)은 unmatched로 제안', { skip }, async () => {
  globalThis.JSZip = libs.JSZip; globalThis.ExcelJS = libs.ExcelJS;
  const { FT: FT2, FE } = F.loadAppScripts();
  const wb = new libs.ExcelJS.Workbook(); const ws = wb.addWorksheet('이력서');
  ws.addRow(['학력']); ws.addRow(['학교명', '전공', '소재지', '졸업일', '지역']);
  for (let i = 0; i < 3; i++) { const r = ws.addRow(['', '', '', '', '']); r.eachCell({ includeEmpty: true }, (c) => { c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }; }); }
  ws.getRow(2).eachCell((c) => { c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }; });
  const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
  const map = { education: [{ id: 'cab12', label: '소재지', type: 'text' }] };
  FT2.registerCustom(Object.fromEntries(FT2.CAT_KEYS.map((k) => [k, CC.defs(k, map)])));
  const { analysis } = await FE.analyzeTemplate(bytes, 'xlsx');
  const rep = analysis.repeats.find((r) => r.category === 'education');
  assert.ok(rep, '학력 표 인식'); assert.ok(rep.cols.some((c) => c.source === 'x_cab12'), '소재지 열 → 사용자 컬럼');
  assert.deepEqual(rep.unmatched, ['지역']);
  const OPTS = { dateFormat: 'YYYY-MM-DD', order: 'asc', addRows: true };
  const ds = FT2.buildDataset({ career: { education: [{ id: 'e1', school_name: 'A대', degree: '컴공', graduation_date: '2020-02-20', extra: { cab12: '서울' } }] }, todayIso: '2026-11-09' });
  const values = FT2.buildInitialValues(analysis, ds, OPTS);
  const out = await FE.fillTemplate('xlsx', bytes, { version: 1, kind: 'xlsx', fields: analysis.fields, repeats: analysis.repeats, options: OPTS, warnings: [] }, values, { dataset: ds });
  const wb2 = new libs.ExcelJS.Workbook(); await wb2.xlsx.load(out.bytes);
  const row = wb2.getWorksheet('이력서').getRow(3);
  assert.equal(row.getCell(1).value, 'A대'); assert.equal(row.getCell(3).value, '서울');
  FT2.registerCustom({});
});
