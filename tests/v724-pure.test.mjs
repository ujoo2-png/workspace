import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import * as F from './helpers/formFixtures.mjs';

// v7.24.0: 며칠 전/후 통합(음수 오프셋), 시계 도시 연결(LA), 한글(.hwpx) → .docx 변환 다리.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function load(rel) { (0, eval)(fs.readFileSync(path.join(__dirname, rel), 'utf8')); }
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
for (const f of ['utils/date', 'predict', 'config']) load(`../js/${f}.js`);
const g = globalThis;

test('parseOffsets: 전/후/부호, 정렬, 0·범위 밖 거부', () => {
  const r = g.parseOffsets('3일 전, 1일 후, -7, +14, 2전');
  assert.deepEqual(r.offsets, [-7, -3, -2, 1, 14]);
  assert.equal(g.parseOffsets('0').offsets.length, 0);
  assert.equal(g.parseOffsets('400일 후').offsets.length, 0);
});
test('offsetLabel / repeatToOffsets', () => {
  assert.equal(g.offsetLabel(-3), '3일 전'); assert.equal(g.offsetLabel(5), '5일 후');
  assert.deepEqual(g.repeatToOffsets('daily', 4), [1, 2, 3]);
  assert.equal(g.repeatToOffsets('weekly', 3)[1], 14);
});
test('자식 일정 날짜: 음수는 앞날, 양수는 뒷날 (경계/윤년)', () => {
  const p = { id: 'p', title: '시험', date: '2028-03-01', repeat_offsets: [-1, 2] };
  const plan = g.planScheduleChildren(p, []);
  const byOff = Object.fromEntries(plan.create.map((c) => [c.offset_days, c]));
  assert.equal(byOff[-1].date, '2028-02-29');
  assert.equal(byOff[2].date, '2028-03-03');
  assert.match(byOff[-1].title, /1일 전/);
});

test('시계: 모든 프리셋 시간대가 같은 지역 도시에 연결(LA → 로스앤젤레스)', () => {
  load('../js/services/clockService.js');
  const names = new Set(g.CONFIG.cityPresets.map((c) => c.name));
  for (const z of g.CLOCK_ZONE_PRESETS) {
    if (z.id === 'Asia/Seoul') continue;
    assert.ok(g.ZONE_DEFAULT_CITY[z.id], `${z.id} 연결 없음`);
    assert.ok(names.has(g.ZONE_DEFAULT_CITY[z.id]), `${z.id} → ${g.ZONE_DEFAULT_CITY[z.id]} 프리셋 없음`);
  }
  g.settingsSync = { get: () => null, set() {} };
  g.getWeatherCities = () => [g.CONFIG.defaultCities[0]];
  const la = g.resolveClockCity('America/Los_Angeles');
  assert.equal(la.name, '로스앤젤레스');
  assert.ok(la.lat < 40 && la.lon < -100);
});

const libs = F.loadLibs();
const skip = libs ? false : 'vendor libs 없음';
if (libs) { globalThis.JSZip = libs.JSZip; globalThis.ExcelJS = libs.ExcelJS; }
async function makeHwpx() {
  const z = new libs.JSZip();
  z.file('mimetype', 'application/hwp+zip');
  const hp = 'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"';
  const cell = (c, r, text, cs = 1, rs = 1) => `<hp:tc><hp:subList><hp:p><hp:run><hp:t>${text}</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="${c}" rowAddr="${r}"/><hp:cellSpan colSpan="${cs}" rowSpan="${rs}"/></hp:tc>`;
  z.file('Contents/section0.xml', `<?xml version="1.0"?><hs:sec xmlns:hs="x" ${hp}><hp:p><hp:run><hp:t>이 력 서</hp:t></hp:run></hp:p><hp:p><hp:run><hp:tbl><hp:tr>${cell(0, 0, '성 명')}${cell(1, 0, '')}${cell(2, 0, '사진', 1, 2)}</hp:tr><hp:tr>${cell(0, 1, '생년월일')}${cell(1, 1, '')}</hp:tr></hp:tbl></hp:run></hp:p></hs:sec>`);
  return z.generateAsync({ type: 'uint8array' });
}
test('hwpx → docx: 표/병합/글자 보존, 기존 엔진으로 분석·채우기', { skip }, async () => {
  const { FT, FE } = F.loadAppScripts();
  load('../js/services/hwpxBridge.js');
  assert.deepEqual([FE.checkFileName('양식.hwpx').ok, FE.checkFileName('양식.hwpx').convert], [true, 'hwpx']);
  assert.equal(FE.checkFileName('옛날.hwp').ok, false);
  const { bytes, stats } = await g.HwpBridge.hwpxToDocx(await makeHwpx());
  assert.equal(stats.tables, 1);
  const { analysis } = await FE.analyzeTemplate(bytes, 'docx');
  const keys = analysis.fields.map((f) => f.source).filter(Boolean);
  assert.ok(keys.includes('basic.name'), JSON.stringify(keys));
  assert.ok(keys.includes('basic.birth_date'));
  const OPTS = { dateFormat: 'YYYY-MM-DD', order: 'asc', addRows: true };
  const ds = FT.buildDataset({ career: F.sampleCareer(), basic: F.sampleBasic, todayIso: '2026-10-07' });
  const values = FT.buildInitialValues(analysis, ds, OPTS);
  const mapping = { version: 1, kind: 'docx', fields: analysis.fields, repeats: analysis.repeats, options: OPTS, warnings: [] };
  const out = await FE.fillTemplate('docx', bytes, mapping, values, { dataset: ds });
  const xml = await (await libs.JSZip.loadAsync(out.bytes)).file('word/document.xml').async('string');
  assert.ok(xml.includes(F.sampleBasic.name), '이름이 채워져야 함');
});
test('hwpx: 구형 .hwp 바이트와 손상 파일은 친절한 오류', { skip }, async () => {
  load('../js/services/hwpxBridge.js');
  await assert.rejects(g.HwpBridge.hwpxToDocx(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2])), /hwpx/);
  await assert.rejects(g.HwpBridge.hwpxToDocx(new Uint8Array([1, 2, 3, 4, 5])), /열 수 없습니다/);
});

test('hwpx 되쓰기: 채운 docx → 원본 hwpx의 같은 칸에 글자 기록(구조 유지)', { skip }, async () => {
  const { FT, FE } = F.loadAppScripts();
  load('../js/services/hwpxBridge.js');
  const src = await makeHwpx();
  const { bytes } = await g.HwpBridge.hwpxToDocx(src);
  const { analysis } = await FE.analyzeTemplate(bytes, 'docx');
  const OPTS = { dateFormat: 'YYYY-MM-DD', order: 'asc', addRows: true };
  const ds = FT.buildDataset({ career: F.sampleCareer(), basic: F.sampleBasic, todayIso: '2026-10-07' });
  const values = FT.buildInitialValues(analysis, ds, OPTS);
  const mapping = { version: 1, kind: 'docx', fields: analysis.fields, repeats: analysis.repeats, options: OPTS, warnings: [] };
  const filled = await FE.fillTemplate('docx', bytes, mapping, values, { dataset: ds });
  const out = await g.HwpBridge.docxToHwpx(filled.bytes);
  assert.ok(out.changed >= 2, `changed=${out.changed}`);
  const z = await libs.JSZip.loadAsync(out.bytes);
  const xml = await z.file('Contents/section0.xml').async('string');
  assert.ok(xml.includes(F.sampleBasic.name), '이름');
  assert.ok(xml.includes('<hp:cellSpan colSpan="1" rowSpan="2"/>'), '병합 정보 유지');
  assert.ok(xml.includes('성 명') && xml.includes('이 력 서'));
  assert.equal(await z.file('mimetype').async('string'), 'application/hwp+zip');
  await assert.rejects(g.HwpBridge.docxToHwpx(bytes.length ? (await (async () => { const zz = await libs.JSZip.loadAsync(bytes); zz.remove('hwpx/original.hwpx'); return zz.generateAsync({ type: 'uint8array' }); })()) : bytes), /원본/);
});
test('parseQuickSchedule: 날짜·시간 표현 분리', () => {
  const t = '2026-10-08'; // 목요일
  assert.deepEqual(g.parseQuickSchedule('+내일 오후 3시 팀 회의', t), { title: '팀 회의', date: '2026-10-09', time: '15:00' });
  assert.deepEqual(g.parseQuickSchedule('일정 모레 14:30 병원', t), { title: '병원', date: '2026-10-10', time: '14:30' });
  assert.equal(g.parseQuickSchedule('다음주 금요일 발표', t).date, '2026-10-16');
  assert.equal(g.parseQuickSchedule('10/20 시험', t).date, '2026-10-20');
  assert.equal(g.parseQuickSchedule('1/5 새해', t).date, '2027-01-05');
  assert.equal(g.parseQuickSchedule('+', t), null);
});
