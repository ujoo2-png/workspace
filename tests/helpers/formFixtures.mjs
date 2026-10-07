// 양식 문서 테스트용 픽스처 생성기 — 벤더링된 ExcelJS/JSZip(js/vendor)로 .xlsx/.docx 샘플을 즉석에서 만든다.
// 라이브러리가 없으면 loadLibs()가 null을 돌려주고 테스트는 스스로 건너뛴다.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadLibs() {
  try {
    const JSZip = require(path.join(root, 'js/vendor/jszip.min.js'));
    const ExcelJS = require(path.join(root, 'js/vendor/exceljs.min.js'));
    return { JSZip, ExcelJS };
  } catch (e) {
    return null;
  }
}

export function loadAppScripts() {
  globalThis.window = globalThis;
  for (const rel of ['js/utils/xmlTree.js', 'js/utils/careerLogic.js', 'js/services/formTemplate.js', 'js/services/formEngine.js']) {
    (0, eval)(fs.readFileSync(path.join(root, rel), 'utf8'));
  }
  return { XT: globalThis.XmlTree, CL: globalThis.CareerLogic, FT: globalThis.FormTemplate, FE: globalThis.FormEngine };
}

// 1x1 보다 큰 실제 PNG(30x40) — 사진 삽입 테스트용
export function makePng(w = 30, h = 40) {
  const zlib = require('node:zlib');
  const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 60 + x * 4; raw[o + 1] = 120; raw[o + 2] = 200 - y * 3; } }
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

const thin = { style: 'thin', color: { argb: 'FF444444' } };
const box = { top: thin, left: thin, bottom: thin, right: thin };

// ---------------------------------------------------------------
// XLSX 이력서 양식: 병합 셀 + 스타일 + 반복 표 3개(학력/경력/자격) + 사진 칸 + 인라인 빈칸
// ---------------------------------------------------------------
export async function buildResumeXlsx(ExcelJS, { pad = false } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('이력서');
  [14, 12, 12, 16, 14, 18, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const label = (addr, text) => { const c = ws.getCell(addr); c.value = text; c.font = { name: 'Malgun Gothic', bold: true, size: 10, color: { argb: 'FF1F3864' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }; c.border = box; c.alignment = { horizontal: 'center', vertical: 'middle' }; };
  const blank = (addr) => { const c = ws.getCell(addr); c.border = box; c.font = { name: 'Malgun Gothic', size: 11, color: { argb: 'FF000000' } }; c.alignment = { vertical: 'middle' }; };
  ws.mergeCells('A1:G1'); ws.getCell('A1').value = '이  력  서'; ws.getCell('A1').font = { name: 'Malgun Gothic', bold: true, size: 20 }; ws.getCell('A1').alignment = { horizontal: 'center' };
  ws.getRow(1).height = 36;
  label('A3', '성 명'); ws.mergeCells('B3:C3'); blank('B3'); label('D3', '생 년 월 일'); ws.mergeCells('E3:F3'); blank('E3');
  label('A4', '연락처'); ws.mergeCells('B4:C4'); blank('B4'); label('D4', 'E-mail'); ws.mergeCells('E4:F4'); blank('E4');
  label('A5', '주 소'); ws.mergeCells('B5:F5'); blank('B5');
  ws.mergeCells('G3:G5'); label('G3', '사진(3x4)'); ws.getRow(3).height = 30; ws.getRow(4).height = 30; ws.getRow(5).height = 30;
  const title = (row, text) => { ws.mergeCells(`A${row}:G${row}`); const c = ws.getCell(`A${row}`); c.value = text; c.font = { name: 'Malgun Gothic', bold: true, size: 12 }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E2F3' } }; };
  const header = (row, cols) => { for (const [addr, text] of cols) label(`${addr}${row}`, text); };
  const body = (row, mergeSpec) => { for (const col of 'ABCDEFG') blank(`${col}${row}`); for (const m of mergeSpec) ws.mergeCells(`${m}${row}:${m.replace(/[A-Z]+/, (x) => String.fromCharCode(x.charCodeAt(0) + 1))}${row}`); };
  title(8, '학력사항');
  header(9, [['A', '기간'], ['B', '학교명'], ['D', '전공'], ['E', '졸업구분'], ['F', '비고']]); ws.mergeCells('B9:C9');
  for (const r of [10, 11, 12]) body(r, ['B']);
  title(13, '경력사항');
  header(14, [['A', '기간'], ['B', '회사명'], ['D', '직위'], ['E', '담당업무']]); ws.mergeCells('B14:C14'); ws.mergeCells('E14:F14');
  for (const r of [15, 16]) body(r, ['B', 'E']);
  title(17, '자격사항');
  header(18, [['A', '취득일'], ['B', '자격증명'], ['D', '발급기관']]); ws.mergeCells('B18:C18');
  for (const r of [19, 20]) body(r, ['B']);
  ws.getCell('A22').value = '작성일 : ________'; ws.getCell('A22').font = { name: 'Malgun Gothic', size: 10, italic: true };
  ws.getCell('A23').value = '※ 위 내용은 사실과 다름이 없습니다.'; ws.getCell('A23').font = { bold: true, color: { argb: 'FFC00000' } };
  if (pad) for (let r = 24; r < 40; r++) body(r, []);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------
// DOCX 이력서 양식(직접 XML): run 쪼개짐, 표 병합(gridSpan/vMerge), 인라인 빈칸, 토큰, 반복 표 3개
// ---------------------------------------------------------------
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const rpr = '<w:rPr><w:rFonts w:ascii="Malgun Gothic" w:eastAsia="Malgun Gothic" w:hAnsi="Malgun Gothic"/><w:b/><w:color w:val="1F3864"/><w:sz w:val="20"/></w:rPr>';
const rprVal = '<w:rPr><w:rFonts w:ascii="Batang" w:eastAsia="Batang" w:hAnsi="Batang"/><w:sz w:val="22"/></w:rPr>';
// 라벨을 글자 단위로 쪼갠 run들(실제 Word에서 흔함)
const splitRuns = (text, pr = rpr) => [...text].map((ch) => `<w:r>${pr}<w:t xml:space="preserve">${esc(ch)}</w:t></w:r>`).join('');
const para = (inner, ppr = '') => `<w:p>${ppr}${inner}</w:p>`;
const cell = (inner, { w = 1800, span = 0, vm = '', shade = '' } = {}) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${span ? `<w:gridSpan w:val="${span}"/>` : ''}${vm === 'restart' ? '<w:vMerge w:val="restart"/>' : vm === 'cont' ? '<w:vMerge/>' : ''}${shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : ''}</w:tcPr>${inner}</w:tc>`;
const lab = (text, o = {}) => cell(para(splitRuns(text), '<w:pPr><w:jc w:val="center"/></w:pPr>'), { shade: 'FFF2CC', ...o });
const emptyVal = (o = {}) => cell(para('', `<w:pPr><w:rPr><w:rFonts w:ascii="Batang" w:eastAsia="Batang" w:hAnsi="Batang"/><w:sz w:val="22"/></w:rPr></w:pPr>`), o);
const emptyValRun = (o = {}) => cell(para(`<w:r>${rprVal}<w:t></w:t></w:r>`), o);
const tbl = (rows, grid) => `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="444444"/><w:left w:val="single" w:sz="4" w:space="0" w:color="444444"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="444444"/><w:right w:val="single" w:sz="4" w:space="0" w:color="444444"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="444444"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="444444"/></w:tblBorders></w:tblPr><w:tblGrid>${grid.map((g) => `<w:gridCol w:w="${g}"/>`).join('')}</w:tblGrid>${rows.map((r) => `<w:tr>${r}</w:tr>`).join('')}</w:tbl>`;

export function resumeDocumentXml({ headerLabels = true } = {}) {
  const body = [];
  body.push(para(`<w:r><w:rPr><w:b/><w:sz w:val="40"/></w:rPr><w:t>이  력  서</w:t></w:r>`, '<w:pPr><w:jc w:val="center"/></w:pPr>'));
  // 인적사항 표: 5열(라벨,값,라벨,값,사진) — 사진 열은 3행 세로 병합
  body.push(tbl([
    lab('성명', { w: 1500 }) + emptyVal({ w: 2200 }) + lab('생 년 월 일', { w: 1500 }) + emptyValRun({ w: 2200 }) + cell(para(splitRuns('사진'), '<w:pPr><w:jc w:val="center"/></w:pPr>'), { w: 1800, vm: 'restart' }),
    lab('연락처', { w: 1500 }) + emptyVal({ w: 2200 }) + lab('E-mail', { w: 1500 }) + emptyVal({ w: 2200 }) + cell(para(''), { w: 1800, vm: 'cont' }),
    lab('주 소', { w: 1500 }) + emptyVal({ w: 5900, span: 3 }) + cell(para(''), { w: 1800, vm: 'cont' }),
  ], [1500, 2200, 1500, 2200, 1800]));
  body.push(para(''));
  body.push(para(`<w:r>${rprVal}<w:t xml:space="preserve">병역 : </w:t></w:r><w:r>${rprVal}<w:t>________</w:t></w:r><w:r>${rprVal}<w:t xml:space="preserve">   국적 : ________</w:t></w:r>`));
  body.push(para(`<w:r>${rprVal}<w:t xml:space="preserve">보내는 사람 이메일: </w:t></w:r><w:r>${rprVal}<w:t>{{</w:t></w:r><w:r>${rprVal}<w:t>이</w:t></w:r><w:r>${rprVal}<w:t>메일}}</w:t></w:r><w:r><w:t xml:space="preserve"> / 휴대폰 </w:t></w:r><w:r><w:t>[[전화번호]]</w:t></w:r>`));
  body.push(para(`<w:r><w:rPr><w:b/></w:rPr><w:t>학력사항</w:t></w:r>`));
  const hdr = (labels, widths) => labels.map((l, i) => lab(l, { w: widths[i] })).join('');
  const w4 = [1900, 2700, 2300, 1500];
  body.push(tbl([hdr(['기 간', '학교명', '전공', '졸업구분'], w4), emptyVal({ w: w4[0] }) + emptyVal({ w: w4[1] }) + emptyVal({ w: w4[2] }) + emptyValRun({ w: w4[3] }), emptyVal({ w: w4[0] }) + emptyVal({ w: w4[1] }) + emptyVal({ w: w4[2] }) + emptyValRun({ w: w4[3] })], w4));
  body.push(para(''));
  body.push(para(`<w:r><w:rPr><w:b/></w:rPr><w:t>경력사항</w:t></w:r>`));
  body.push(tbl([hdr(['기간', '회사명', '직위', '담당업무'], w4), emptyVal({ w: w4[0] }) + emptyVal({ w: w4[1] }) + emptyVal({ w: w4[2] }) + emptyVal({ w: w4[3] })], w4));
  body.push(para(''));
  body.push(para(`<w:r><w:rPr><w:b/></w:rPr><w:t>자격사항</w:t></w:r>`));
  const w3 = [2200, 3600, 2600];
  body.push(tbl([hdr(['취득일', '자격증명', '발급기관'], w3), emptyVal({ w: w3[0] }) + emptyVal({ w: w3[1] }) + emptyVal({ w: w3[2] }), emptyVal({ w: w3[0] }) + emptyVal({ w: w3[1] }) + emptyVal({ w: w3[2] })], w3));
  body.push(para(`<w:r><w:t xml:space="preserve">※ 이 문장은 그대로 남아야 합니다.</w:t></w:r>`));
  void headerLabels;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1000" w:bottom="1440" w:left="1000" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

export async function buildDocx(JSZip, documentXml = resumeDocumentXml(), extraFiles = {}) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
  zip.file('word/document.xml', documentXml);
  for (const [k, v] of Object.entries(extraFiles)) zip.file(k, v);
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
}

// 샘플 등록 데이터(학력 3 / 경력 3(겹침 포함) / 자격 3 / 교육 2 / 단체 1 / 포상 2)
export function sampleCareer() {
  const mk = (cat, rows) => rows.map((r, i) => ({ id: `${cat}-${i + 1}`, sort_order: i + 1, ...r }));
  return {
    education: mk('edu', [
      { school_name: '서울고등학교', degree: '인문계', admission_date: '2005-03-02', graduation_date: '2008-02-15', status: '졸업' },
      { school_name: '한국대학교', degree: '컴퓨터공학', admission_date: '2008-03-03', graduation_date: '2014-02-20', status: '졸업' },
      { school_name: '미래대학원', degree: '소프트웨어공학 석사', admission_date: '2020-03-02', graduation_date: null, status: '재학' },
    ]),
    certifications: mk('cert', [
      { cert_name: '정보처리기사', issuing_org: '한국산업인력공단', acquired_date: '2013-11-22', cert_number: 'A-123', expiry_date: null },
      { cert_name: 'SQLD', issuing_org: '한국데이터산업진흥원', acquired_date: '2016-06-10', expiry_date: '2026-11-01' },
      { cert_name: '운전면허 1종', issuing_org: '경찰청', acquired_date: '2010-04-01' },
    ]),
    trainings: mk('trn', [{ training_name: '클라우드 아키텍처 과정', institution: '한국IT교육원', start_date: '2021-05-03', end_date: '2021-05-07', hours: 40 }, { training_name: '보안 교육', institution: '사내', start_date: '2022-01-10', end_date: '2022-01-10', hours: 8 }]),
    memberships: mk('mem', [{ org_name: '한국개발자협회', role: '회원', join_date: '2015-01-01', leave_date: null }]),
    awards: mk('awd', [{ award_name: '우수사원상', awarding_body: '(주)알파', award_date: '2018-12-20' }, { award_name: '공로상', awarding_body: '(주)베타', award_date: '2022-12-30' }]),
    experiences: mk('exp', [
      { company_name: '(주)알파소프트', department_position: '개발팀 사원', employment_type: '정규직', start_date: '2014-03-03', end_date: '2018-02-28', note: '웹 서비스 개발\nDB 설계' },
      { company_name: '(주)베타시스템', department_position: '플랫폼팀 대리', employment_type: '정규직', start_date: '2018-03-02', end_date: '2023-05-31', note: '클라우드 전환 프로젝트 리드' },
      { company_name: '감마랩스', department_position: '프리랜서 개발자', employment_type: '프리랜서', start_date: '2022-01-01', end_date: '2022-12-31', note: '겸직 외주 개발' },
    ]),
    photos: [{ id: 'photo-1', label: '2026 여권용', taken_date: '2026-01-05' }],
  };
}
export const sampleBasic = { name: '홍길동', name_en: 'Gildong Hong', birth_date: '1990-05-17', gender: '남', phone: '010-1234-5678', email: 'gildong@example.com', address: '서울특별시 중구 세종대로 110', military: '군필', nationality: '대한민국' };
