// Vercel 서버리스 함수 — OpenDART(전자공시) 읽기 전용 프록시 (v7.33.0).
//
// korean-dart-mcp(npm)는 PC에서 실행하는 MCP(stdio) 서버라 웹앱에 직접 붙일 수 없다. 그 패키지가 감싸는 것과 같은
// OpenDART 공개 API(https://opendart.fss.or.kr)를 여기서 직접 호출한다. API 키는 설정에서 입력하며 요청 헤더(x-dart-key)로만
// 전달되고, 서버에 저장·로그하지 않는다. 호스트는 opendart.fss.or.kr 하나로 고정(SSRF 방지), GET 전용.
//
// op=corp&stock_code=005930                         → { corp_code, corp_name }   (corpCode.zip을 받아 메모리에 캐시)
// op=disclosures&codes=005930,000660&days=30         → 종목별 최근 공시 목록
// op=company&stock_code=005930                      → 기업개황
// op=fin&stock_code=005930&year=2025&reprt=11011     → 주요 재무(매출·영업이익·순이익·자산·부채·자본)
// op=ping                                            → 키 확인(삼성전자 개황 조회)
const zlib = require('node:zlib');
const BASE = 'https://opendart.fss.or.kr/api/';
const TIMEOUT_MS = 12000;
const MAX_CODES = 30;
let corpCache = null; // { at, byStock: Map(stock_code → {corp_code, corp_name}) }
const CORP_TTL_MS = 12 * 3600 * 1000;

// corpCode.xml zip(단일 파일)에서 XML 텍스트를 꺼낸다 — 중앙 디렉터리를 읽어 크기를 얻는다(데이터 설명자가 있어도 안전).
function unzipFirst(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('zip 형식이 아닙니다(키가 올바른지 확인하세요).');
  const cdOff = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cdOff) !== 0x02014b50) throw new Error('zip 중앙 디렉터리를 읽지 못했습니다.');
  const method = buf.readUInt16LE(cdOff + 10); const csize = buf.readUInt32LE(cdOff + 20); const lho = buf.readUInt32LE(cdOff + 42);
  const nameLen = buf.readUInt16LE(lho + 26); const extraLen = buf.readUInt16LE(lho + 28); const start = lho + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + csize);
  return method === 0 ? data : zlib.inflateRawSync(data);
}
function parseCorpXml(xml) {
  const map = new Map(); const re = /<list>([\s\S]*?)<\/list>/g; let m;
  while ((m = re.exec(xml))) { const b = m[1]; const sc = (b.match(/<stock_code>\s*([^<\s]*)\s*<\/stock_code>/) || [])[1]; if (!sc) continue;
    map.set(sc, { corp_code: (b.match(/<corp_code>\s*(\d+)\s*<\/corp_code>/) || [])[1], corp_name: ((b.match(/<corp_name>([^<]*)<\/corp_name>/) || [])[1] || '').trim() }); }
  return map;
}
async function dartFetch(path, params, key, asBuffer) {
  const u = new URL(BASE + path); for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, String(v)); u.searchParams.set('crtfc_key', key);
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try { const r = await fetch(u.toString(), { redirect: 'error', signal: ctrl.signal, headers: { 'User-Agent': 'WorkspaceApp/7.33' } }); if (!r.ok) throw new Error(`OpenDART HTTP ${r.status}`); return asBuffer ? Buffer.from(await r.arrayBuffer()) : await r.json(); }
  finally { clearTimeout(t); }
}
async function corpOf(stockCode, key) {
  if (!corpCache || Date.now() - corpCache.at > CORP_TTL_MS) {
    const buf = await dartFetch('corpCode.xml', {}, key, true);
    if (buf.length < 100 || buf[0] !== 0x50) { let msg = 'corpCode를 받지 못했습니다.'; try { const j = JSON.parse(buf.toString('utf8')); msg = `${j.message || msg} (status ${j.status})`; } catch {} throw new Error(msg); }
    corpCache = { at: Date.now(), byStock: parseCorpXml(unzipFirst(buf).toString('utf8')) };
  }
  return corpCache.byStock.get(stockCode) || null;
}
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const okCode = (s) => /^\d{6}$/.test(String(s || ''));

async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'GET만 지원합니다.' }); return; }
  const key = String(req.headers['x-dart-key'] || '').trim();
  if (!/^[0-9a-fA-F]{40}$/.test(key)) { res.status(401).json({ error: 'OpenDART API 키(40자리)가 필요합니다. 설정 → 증권 시세 API에서 입력하세요.' }); return; }
  const q = req.query || {}; const op = String(q.op || '');
  try {
    if (op === 'ping') { const j = await dartFetch('company.json', { corp_code: '00126380' }, key); res.status(200).json({ ok: j.status === '000', status: j.status, message: j.message }); return; }
    if (op === 'corp') { if (!okCode(q.stock_code)) { res.status(400).json({ error: '종목코드 6자리가 필요합니다.' }); return; } const c = await corpOf(q.stock_code, key); res.status(200).json(c || { error: 'DART에 등록되지 않은 종목입니다.' }); return; }
    if (op === 'company' || op === 'fin') {
      if (!okCode(q.stock_code)) { res.status(400).json({ error: '종목코드 6자리가 필요합니다.' }); return; }
      const c = await corpOf(q.stock_code, key); if (!c) { res.status(404).json({ error: 'DART에 등록되지 않은 종목입니다.' }); return; }
      if (op === 'company') { const j = await dartFetch('company.json', { corp_code: c.corp_code }, key); res.status(200).json({ corp: c, data: j }); return; }
      const year = /^\d{4}$/.test(String(q.year)) ? q.year : String(new Date().getFullYear() - 1); const reprt = ['11011', '11012', '11013', '11014'].includes(String(q.reprt)) ? q.reprt : '11011';
      const j = await dartFetch('fnlttSinglAcnt.json', { corp_code: c.corp_code, bsns_year: year, reprt_code: reprt }, key);
      res.status(200).json({ corp: c, year, reprt, status: j.status, message: j.message, list: (j.list || []).filter((x) => x.fs_div === 'CFS' || !(j.list || []).some((y) => y.fs_div === 'CFS')).map((x) => ({ account: x.account_nm, current: x.thstrm_amount, prev: x.frmtrm_amount, fs: x.fs_div })) });
      return;
    }
    if (op === 'disclosures') {
      const codes = String(q.codes || '').split(',').map((s) => s.trim()).filter(okCode).slice(0, MAX_CODES); if (!codes.length) { res.status(400).json({ error: 'codes(종목코드 6자리, 쉼표 구분)가 필요합니다.' }); return; }
      const days = Math.min(180, Math.max(1, Number(q.days) || 30)); const end = new Date(); const bgn = new Date(Date.now() - days * 86400000); const out = [];
      for (const code of codes) {
        const c = await corpOf(code, key); if (!c) { out.push({ stock_code: code, error: 'DART 미등록' }); continue; }
        const j = await dartFetch('list.json', { corp_code: c.corp_code, bgn_de: ymd(bgn), end_de: ymd(end), page_count: 20 }, key);
        if (j.status === '013') { out.push({ stock_code: code, corp_name: c.corp_name, items: [] }); continue; } // 조회된 데이터 없음
        if (j.status !== '000') { out.push({ stock_code: code, corp_name: c.corp_name, error: `${j.message} (${j.status})` }); if (j.status === '020') break; continue; } // 020 = 사용한도 초과
        out.push({ stock_code: code, corp_name: c.corp_name, items: (j.list || []).map((x) => ({ rcept_no: x.rcept_no, title: x.report_nm, date: x.rcept_dt, filer: x.flr_nm, remark: x.rm })) });
      }
      res.status(200).json({ results: out }); return;
    }
    res.status(400).json({ error: 'op는 ping|corp|company|fin|disclosures 중 하나입니다.' });
  } catch (e) { res.status(502).json({ error: String((e && e.message) || e).slice(0, 200) }); }
}
module.exports = handler;
module.exports._test = { unzipFirst, parseCorpXml };
