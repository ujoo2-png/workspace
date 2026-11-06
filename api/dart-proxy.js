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
// op=search&q=삼성 · corps · insider · anomaly · report · preset · quality  (v7.33.1: korean-dart-mcp의 기능을 OpenDART로 재구현)
// op=ping                                            → 키 확인(삼성전자 개황 조회)
const zlib = require('node:zlib');
const BASE = 'https://opendart.fss.or.kr/api/';
const TIMEOUT_MS = 15000;
const CORP_TIMEOUT_MS = 45000; // corpCode.zip(약 3MB)는 느릴 수 있다 — vercel.json에서 함수 시간을 60초로 늘렸다.
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
async function dartFetch(path, params, key, asBuffer, timeoutMs = TIMEOUT_MS) {
  const u = new URL(BASE + path); for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, String(v)); u.searchParams.set('crtfc_key', key);
  const ctrl = new AbortController(); let t = setTimeout(() => ctrl.abort(), timeoutMs); const started = Date.now();
  try {
    const r = await fetch(u.toString(), { redirect: 'error', signal: ctrl.signal, headers: { 'User-Agent': 'WorkspaceApp/7.33' } });
    if (!r.ok) throw new Error(`OpenDART HTTP ${r.status}`);
    if (!asBuffer) return await r.json();
    // 큰 파일은 "데이터가 오는 동안"은 기다린다(청크가 올 때마다 타이머를 갱신, 전체는 52초 상한).
    const chunks = []; const reader = r.body.getReader();
    for (;;) {
      clearTimeout(t); t = setTimeout(() => ctrl.abort(), Math.min(20000, Math.max(3000, 52000 - (Date.now() - started))));
      const { done, value } = await reader.read(); if (done) break; chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } catch (e) {
    if (e && (e.name === 'AbortError' || /aborted/i.test(String(e.message)))) throw new Error(`OpenDART 응답 지연(${Math.round((Date.now() - started) / 1000)}초 후 중단: ${path}). 잠시 후 다시 시도하세요.`);
    throw e;
  } finally { clearTimeout(t); }
}
async function loadCorps(key) {
  if (!corpCache || Date.now() - corpCache.at > CORP_TTL_MS) {
    const buf = await dartFetch('corpCode.xml', {}, key, true, CORP_TIMEOUT_MS);
    if (buf.length < 100 || buf[0] !== 0x50) { let msg = 'corpCode를 받지 못했습니다.'; try { const j = JSON.parse(buf.toString('utf8')); msg = `${j.message || msg} (status ${j.status})`; } catch {} throw new Error(msg); }
    corpCache = { at: Date.now(), byStock: parseCorpXml(unzipFirst(buf).toString('utf8')) };
  }
  return corpCache;
}
async function corpOf(stockCode, key, hints) {
  const h = hints && hints.get(stockCode); if (h) return h;
  return (await loadCorps(key)).byStock.get(stockCode) || null;
}

const num = (v) => { const n = Number(String(v == null ? '' : v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };

// ── 내부자(임원·주요주주) 매수/매도 집계 ──
function summarizeInsider(list, days) {
  const cut = ymd(new Date(Date.now() - days * 86400000)); let buy = 0, sell = 0, buyShares = 0, sellShares = 0; const recent = [];
  for (const x of list) {
    const d = String(x.rcept_dt || '').replace(/-/g, ''); if (d < cut) continue;
    const delta = num(x.sp_stock_lmp_irds_cnt); if (delta === null || delta === 0) continue;
    if (delta > 0) { buy++; buyShares += delta; } else { sell++; sellShares += -delta; }
    recent.push({ date: d, who: x.repror, position: x.isu_exctv_ofcps, delta, after: num(x.sp_stock_lmp_cnt), rcept_no: x.rcept_no });
  }
  recent.sort((a, b) => (a.date < b.date ? 1 : -1));
  const tot = buy + sell; let verdict = 'insufficient', label = '자료 부족';
  if (tot >= 3) { const r = buy / tot; if (r >= 0.8 && buy >= 5) { verdict = 'strong_buy_cluster'; label = '매수 우위(강)'; } else if (r >= 0.6) { verdict = 'buy_cluster'; label = '매수 우위'; } else if (r <= 0.2 && sell >= 5) { verdict = 'strong_sell_cluster'; label = '매도 우위(강)'; } else if (r <= 0.4) { verdict = 'sell_cluster'; label = '매도 우위'; } else { verdict = 'mixed'; label = '혼조'; } }
  return { days, buy, sell, buyShares, sellShares, verdict, label, recent: recent.slice(0, 15) };
}

// ── 공시 기반 리스크 점수(0~100). 규칙을 그대로 공개한다 — 회계감사 결과가 아니라 "공시 제목 패턴" 지표다. ──
function scoreAnomaly(list) {
  const total = list.length; const titles = list.map((x) => x.report_nm || '');
  const cnt = (re) => titles.filter((t) => re.test(t)).length;
  const corr = cnt(/정정/); const corrRate = total ? corr / total : 0;
  const flags = [
    { key: 'corr', label: '정정공시 비율', value: `${(corrRate * 100).toFixed(1)}% (${corr}/${total})`, pts: total < 10 ? 0 : corrRate > 0.3 ? 40 : corrRate > 0.2 ? 28 : corrRate > 0.12 ? 15 : 0 },
    { key: 'audit', label: '감사·검토 관련 정정/의견', value: `${cnt(/(감사|검토).*(정정|의견)|의견거절|한정|부적정/)}건`, pts: Math.min(25, cnt(/(감사|검토).*(정정|의견)|의견거절|한정|부적정/) * 12) },
    { key: 'unfaithful', label: '불성실공시·횡령·배임·조회공시', value: `${cnt(/불성실|횡령|배임|조회공시|투자주의|투자경고/)}건`, pts: Math.min(25, cnt(/불성실|횡령|배임|조회공시|투자주의|투자경고/) * 10) },
    { key: 'status', label: '관리종목·거래정지·상장폐지·회생', value: `${cnt(/관리종목|거래정지|상장폐지|회생|파산|부도/)}건`, pts: Math.min(30, cnt(/관리종목|거래정지|상장폐지|회생|파산|부도/) * 15) },
    { key: 'dilution', label: '유상증자·CB·BW·EB 발행 결정', value: `${cnt(/유상증자결정|전환사채권발행결정|신주인수권부사채권발행결정|교환사채권발행결정/)}건`, pts: Math.min(15, cnt(/유상증자결정|전환사채권발행결정|신주인수권부사채권발행결정|교환사채권발행결정/) * 5) },
    { key: 'lawsuit', label: '소송 등의 제기·판결', value: `${cnt(/소송/)}건`, pts: Math.min(10, cnt(/소송/) * 3) },
  ];
  const score = Math.min(100, flags.reduce((s, f) => s + f.pts, 0));
  const verdict = score < 20 ? 'clean' : score < 40 ? 'watch' : score < 60 ? 'warning' : 'red_flag';
  return { total, score, verdict, label: { clean: '양호', watch: '주의 관찰', warning: '경고', red_flag: '위험' }[verdict], flags };
}

// ── document.xml(zip) 텍스트 ──
function zipEntries(buf) {
  let eocd = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('zip 형식이 아닙니다.');
  const n = buf.readUInt16LE(eocd + 10); let off = buf.readUInt32LE(eocd + 16); const out = [];
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10), csize = buf.readUInt32LE(off + 20), usize = buf.readUInt32LE(off + 24), nl = buf.readUInt16LE(off + 28), el = buf.readUInt16LE(off + 30), cl = buf.readUInt16LE(off + 32), lho = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nl).toString('utf8'); out.push({ name, method, csize, usize, lho }); off += 46 + nl + el + cl;
  }
  return out;
}
function biggestEntry(buf) {
  const es = zipEntries(buf).sort((a, b) => b.usize - a.usize); const e = es[0]; if (!e) throw new Error('빈 zip');
  const nameLen = buf.readUInt16LE(e.lho + 26), extraLen = buf.readUInt16LE(e.lho + 28), st = e.lho + 30 + nameLen + extraLen; const data = buf.subarray(st, st + e.csize);
  const raw = e.method === 0 ? data : zlib.inflateRawSync(data);
  return raw.toString('utf8');
}
const decodeEnt = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
function xmlToText(xml) {
  return decodeEnt(xml.replace(/<TITLE[^>]*>/g, '\n\n## ').replace(/<\/TITLE>/g, '\n').replace(/<\/(P|TR|TABLE|SECTION-\d|LIBRARY)>/g, '\n').replace(/<\/(TD|TH)>/g, ' | ').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
}
// 제목(##) 목차 + 키워드가 들어간 제목의 본문(최대 6,000자) 또는 키워드 주변 발췌
function extractSections(xml, kw) {
  const text = xmlToText(xml); const parts = text.split(/\n## /).map((s, i) => (i === 0 ? s : s)); const secs = [];
  for (const p of parts.slice(1)) { const nl = p.indexOf('\n'); secs.push({ title: p.slice(0, nl < 0 ? p.length : nl).trim(), body: nl < 0 ? '' : p.slice(nl + 1).trim() }); }
  const outline = secs.map((s) => s.title).filter((t) => t && t.length < 80).slice(0, 80);
  const KEYS = { '위험': /위험|리스크|우발|소송/, '사업': /사업의 (개요|내용)|주요 (제품|서비스)|사업 내용/, '재무': /재무|손익|자본/ };
  const re = KEYS[kw] || (kw ? new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null);
  let picks = [];
  if (re) picks = secs.filter((s) => re.test(s.title) && s.body.length > 40).slice(0, 4).map((s) => ({ title: s.title, text: s.body.slice(0, 6000), truncated: s.body.length > 6000 }));
  if (re && !picks.length) { const m = []; const rx = new RegExp(re.source, 'gi'); let r; while ((r = rx.exec(text)) && m.length < 8) { m.push(text.slice(Math.max(0, r.index - 150), r.index + 350).replace(/\s+/g, ' ')); rx.lastIndex = r.index + 400; } picks = m.map((t, i) => ({ title: `"${kw}" 주변 발췌 ${i + 1}`, text: t })); }
  return { chars: text.length, outline, sections: picks };
}

// ── 스크리닝 프리셋 ──
const PRESETS = {
  buyback: { label: '자기주식 취득 결정', ty: 'B', re: /자기주식\s*취득\s*결정|자기주식취득결정/, hint: '주가 부양·주주환원 신호로 해석되는 경우가 많습니다.' },
  buyback_dispose: { label: '자기주식 처분 결정', ty: 'B', re: /자기주식\s*처분\s*결정/, hint: '처분은 매도 물량이 될 수 있어 목적(임직원 보상/매각)을 확인하세요.' },
  rights: { label: '유상증자 결정', ty: 'B', re: /유상증자\s*결정/, hint: '신주 발행은 지분 희석 요인입니다. 자금 용도를 확인하세요.' },
  cb: { label: 'CB·BW·EB 발행 결정', ty: 'B', re: /전환사채권발행결정|신주인수권부사채권발행결정|교환사채권발행결정/, hint: '전환 시 희석, 리픽싱 조건을 확인하세요.' },
  merger: { label: '합병·분할 결정', ty: 'B', re: /합병\s*결정|분할\s*결정|분할합병\s*결정/, hint: '비율·일정에 따라 주가 영향이 큽니다.' },
  bonus: { label: '무상증자 결정', ty: 'B', re: /무상증자\s*결정/, hint: '권리락 일정을 확인하세요.' },
  capred: { label: '감자 결정', ty: 'B', re: /감자\s*결정/, hint: '무상감자는 재무 악화 신호일 수 있습니다.' },
  dividend: { label: '현금·현물배당 결정', ty: 'I', re: /현금.{0,6}배당\s*결정|현물배당\s*결정/, hint: '배당기준일과 배당금을 확인하세요.' },
};

// ── 우량도 지표 ──
function qualityOf(pairs) {
  const years = {}; const pick = (list, nm, div) => (list || []).find((x) => x.account_nm === nm && (div ? x.sj_div === div : true));
  for (const [yr, j] of pairs) {
    if (!j || j.status !== '000') continue;
    const L = (j.list || []); const cfs = L.some((x) => x.fs_div === 'CFS') ? L.filter((x) => x.fs_div === 'CFS') : L;
    const get = (nm, div) => pick(cfs, nm, div); const slots = [['thstrm_amount', yr], ['frmtrm_amount', yr - 1], ['bfefrmtrm_amount', yr - 2]];
    for (const [f, y] of slots) {
      const o = years[y] || (years[y] = {});
      const rev = get('매출액', 'IS') || get('수익(매출액)', 'IS') || get('영업수익', 'IS'); const op = get('영업이익', 'IS'); const ni = get('당기순이익', 'IS') || get('당기순이익(손실)', 'IS');
      const asset = get('자산총계', 'BS'), debt = get('부채총계', 'BS'), eq = get('자본총계', 'BS');
      if (rev && o.rev == null) o.rev = num(rev[f]); if (op && o.op == null) o.op = num(op[f]); if (ni && o.ni == null) o.ni = num(ni[f]);
      if (asset && o.asset == null) o.asset = num(asset[f]); if (debt && o.debt == null) o.debt = num(debt[f]); if (eq && o.eq == null) o.eq = num(eq[f]);
    }
  }
  const ys = Object.keys(years).map(Number).sort((a, b) => a - b).filter((y) => years[y].eq != null && years[y].ni != null).slice(-5);
  if (ys.length < 2) return { error: '재무 자료가 부족합니다(비상장/신규상장/공시 지연).' };
  const roe = ys.map((y) => (years[y].eq > 0 ? (years[y].ni / years[y].eq) * 100 : null)).filter((v) => v !== null);
  const avgRoe = roe.length ? roe.reduce((a, b) => a + b, 0) / roe.length : null;
  const last = years[ys[ys.length - 1]]; const debtRatio = last.eq > 0 && last.debt != null ? (last.debt / last.eq) * 100 : null;
  const opm = last.rev > 0 && last.op != null ? (last.op / last.rev) * 100 : null;
  const first = years[ys[0]]; const cagr = first.rev > 0 && last.rev > 0 ? (Math.pow(last.rev / first.rev, 1 / (ys.length - 1)) - 1) * 100 : null;
  const profitYears = ys.filter((y) => years[y].ni > 0).length;
  return { years: ys, metrics: { avgRoe, debtRatio, opm, cagr, profitYears, n: ys.length, lastRev: last.rev, lastNi: last.ni } };
}
function rankQuality(rows) {
  const ok = rows.filter((r) => r.metrics);
  const rankBy = (key, asc) => { const s = [...ok].sort((a, b) => { const x = a.metrics[key], y = b.metrics[key]; if (x == null) return 1; if (y == null) return -1; return asc ? x - y : y - x; }); s.forEach((r, i) => { (r.ranks || (r.ranks = {}))[key] = i + 1; }); };
  rankBy('avgRoe'); rankBy('debtRatio', true); rankBy('opm'); rankBy('cagr'); rankBy('profitYears');
  for (const r of ok) { const m = r.metrics; r.checks = [m.avgRoe != null && m.avgRoe >= 10, m.debtRatio != null && m.debtRatio <= 100, m.opm != null && m.opm >= 10, m.cagr != null && m.cagr >= 5, m.profitYears === m.n]; r.passed = r.checks.filter(Boolean).length; r.rankSum = Object.values(r.ranks).reduce((a, b) => a + b, 0); }
  ok.sort((a, b) => a.rankSum - b.rankSum);
  return [...ok, ...rows.filter((r) => !r.metrics)];
}

const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const okCode = (s) => /^\d{6}$/.test(String(s || ''));

async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'GET만 지원합니다.' }); return; }
  const key = String(req.headers['x-dart-key'] || '').trim();
  if (!/^[0-9a-fA-F]{40}$/.test(key)) { res.status(401).json({ error: 'OpenDART API 키(40자리)가 필요합니다. 설정 → 증권 시세 API에서 입력하세요.' }); return; }
  const q = req.query || {}; const op = String(q.op || '');
  // corps=005930:00126380:삼성전자,... — 클라이언트가 캐시한 매핑을 주면 corpCode.zip을 받지 않는다.
  const hints = new Map(); for (const t of String(q.corps || '').split(',')) { const [sc, cc, ...nm] = t.split(':'); if (okCode(sc) && /^\d{8}$/.test(cc || '')) hints.set(sc, { corp_code: cc, corp_name: decodeURIComponent(nm.join(':') || '') }); }
  try {
    if (op === 'ping') { const j = await dartFetch('company.json', { corp_code: '00126380' }, key); let corpSec = null, corpError = null; if (q.warm === '1') { const t0 = Date.now(); try { await loadCorps(key); corpSec = Math.round((Date.now() - t0) / 100) / 10; } catch (e) { corpError = String(e.message || e).slice(0, 160); } } res.status(200).json({ ok: j.status === '000', status: j.status, message: j.message, corpSec, corpError }); return; }
    if (op === 'corp') { if (!okCode(q.stock_code)) { res.status(400).json({ error: '종목코드 6자리가 필요합니다.' }); return; } const c = await corpOf(q.stock_code, key, hints); res.status(200).json(c || { error: 'DART에 등록되지 않은 종목입니다.' }); return; }
    if (op === 'company' || op === 'fin') {
      if (!okCode(q.stock_code)) { res.status(400).json({ error: '종목코드 6자리가 필요합니다.' }); return; }
      const c = await corpOf(q.stock_code, key, hints); if (!c) { res.status(404).json({ error: 'DART에 등록되지 않은 종목입니다.' }); return; }
      if (op === 'company') { const j = await dartFetch('company.json', { corp_code: c.corp_code }, key); res.status(200).json({ corp: c, data: j }); return; }
      const year = /^\d{4}$/.test(String(q.year)) ? q.year : String(new Date().getFullYear() - 1); const reprt = ['11011', '11012', '11013', '11014'].includes(String(q.reprt)) ? q.reprt : '11011';
      const j = await dartFetch('fnlttSinglAcnt.json', { corp_code: c.corp_code, bsns_year: year, reprt_code: reprt }, key);
      res.status(200).json({ corp: c, year, reprt, status: j.status, message: j.message, list: (j.list || []).filter((x) => x.fs_div === 'CFS' || !(j.list || []).some((y) => y.fs_div === 'CFS')).map((x) => ({ account: x.account_nm, current: x.thstrm_amount, prev: x.frmtrm_amount, fs: x.fs_div })) });
      return;
    }
    if (op === 'disclosures') {
      const codes = String(q.codes || '').split(',').map((s) => s.trim()).filter(okCode).slice(0, MAX_CODES); if (!codes.length) { res.status(400).json({ error: 'codes(종목코드 6자리, 쉼표 구분)가 필요합니다.' }); return; }
      const days = Math.min(180, Math.max(1, Number(q.days) || 30)); const end = new Date(); const bgn = new Date(Date.now() - days * 86400000); const out = [];
      await Promise.all(codes.map(async (code) => {
        const c = await corpOf(code, key, hints); if (!c) { out.push({ stock_code: code, error: 'DART 미등록' }); return; }
        const j = await dartFetch('list.json', { corp_code: c.corp_code, bgn_de: ymd(bgn), end_de: ymd(end), page_count: 20 }, key);
        if (j.status === '013') { out.push({ stock_code: code, corp_name: c.corp_name, corp_code: c.corp_code, items: [] }); return; } // 조회된 데이터 없음
        if (j.status !== '000') { out.push({ stock_code: code, corp_name: c.corp_name, corp_code: c.corp_code, error: `${j.message} (${j.status})` }); return; } // 020 = 사용한도 초과
        out.push({ stock_code: code, corp_name: c.corp_name, corp_code: c.corp_code, items: (j.list || []).map((x) => ({ rcept_no: x.rcept_no, title: x.report_nm, date: x.rcept_dt, filer: x.flr_nm, remark: x.rm })) });
      }));
      res.status(200).json({ results: out }); return;
    }
    if (op === 'corps') { // 종목코드 → corp_code 매핑(클라이언트 캐시용)
      const codes = String(q.codes || '').split(',').map((s) => s.trim()).filter(okCode).slice(0, 60); const cs = await loadCorps(key);
      res.status(200).json({ map: codes.map((c) => { const x = cs.byStock.get(c); return x ? { stock_code: c, ...x } : { stock_code: c, error: '미등록' }; }) }); return;
    }
    if (op === 'search') { // 상장사 이름/코드 검색
      const term = String(q.q || '').trim().toLowerCase(); if (term.length < 1) { res.status(400).json({ error: '검색어가 필요합니다.' }); return; }
      const cs = await loadCorps(key); const hit = [];
      for (const [sc, v] of cs.byStock) { const nm = (v.corp_name || '').toLowerCase(); if (sc === term || nm.includes(term)) hit.push({ stock_code: sc, corp_code: v.corp_code, corp_name: v.corp_name, exact: nm === term || sc === term, starts: nm.startsWith(term) }); }
      hit.sort((a, b) => (b.exact - a.exact) || (b.starts - a.starts) || a.corp_name.length - b.corp_name.length);
      res.status(200).json({ results: hit.slice(0, 20), total: hit.length }); return;
    }
    if (op === 'insider') { // 임원·주요주주 소유보고 → 매수/매도 집계
      if (!okCode(q.stock_code)) { res.status(400).json({ error: '종목코드 6자리가 필요합니다.' }); return; }
      const c = await corpOf(q.stock_code, key, hints); if (!c) { res.status(404).json({ error: 'DART에 등록되지 않은 종목입니다.' }); return; }
      const j = await dartFetch('elestock.json', { corp_code: c.corp_code }, key);
      if (j.status === '013') { res.status(200).json({ corp: c, ...summarizeInsider([], Number(q.days) || 365) }); return; }
      if (j.status !== '000') { res.status(200).json({ corp: c, error: `${j.message} (${j.status})` }); return; }
      res.status(200).json({ corp: c, ...summarizeInsider(j.list || [], Math.min(1095, Number(q.days) || 365)) }); return;
    }
    if (op === 'anomaly') { // 공시 기반 회계·공시 리스크 점수
      if (!okCode(q.stock_code)) { res.status(400).json({ error: '종목코드 6자리가 필요합니다.' }); return; }
      const c = await corpOf(q.stock_code, key, hints); if (!c) { res.status(404).json({ error: 'DART에 등록되지 않은 종목입니다.' }); return; }
      const years = Math.min(3, Math.max(1, Number(q.years) || 3)); const end = new Date(); const bgn = new Date(Date.now() - years * 365 * 86400000); const all = [];
      for (let page = 1; page <= 6; page++) {
        const j = await dartFetch('list.json', { corp_code: c.corp_code, bgn_de: ymd(bgn), end_de: ymd(end), page_count: 100, page_no: page }, key);
        if (j.status !== '000') { if (page === 1 && j.status !== '013') { res.status(200).json({ corp: c, error: `${j.message} (${j.status})` }); return; } break; }
        all.push(...(j.list || [])); if (page >= Number(j.total_page || 1)) break;
      }
      res.status(200).json({ corp: c, years, ...scoreAnomaly(all) }); return;
    }
    if (op === 'report') { // 사업보고서 섹션 추출(요약은 하지 않고 원문 발췌)
      let rcept = String(q.rcept_no || '');
      let corp = null;
      if (!/^\d{14}$/.test(rcept)) {
        if (!okCode(q.stock_code)) { res.status(400).json({ error: 'rcept_no 또는 종목코드가 필요합니다.' }); return; }
        corp = await corpOf(q.stock_code, key, hints); if (!corp) { res.status(404).json({ error: 'DART에 등록되지 않은 종목입니다.' }); return; }
        const j = await dartFetch('list.json', { corp_code: corp.corp_code, bgn_de: ymd(new Date(Date.now() - 3 * 365 * 86400000)), end_de: ymd(new Date()), pblntf_detail_ty: 'A001', page_count: 10 }, key);
        const first = (j.list || []).find((x) => !/정정/.test(x.report_nm)) || (j.list || [])[0];
        if (!first) { res.status(200).json({ corp, error: '최근 3년 사업보고서가 없습니다.' }); return; }
        rcept = first.rcept_no; var title = first.report_nm;
      }
      const buf = await dartFetch('document.xml', { rcept_no: rcept }, key, true, CORP_TIMEOUT_MS);
      if (buf[0] !== 0x50) { let m = '원문을 받지 못했습니다.'; try { const jj = JSON.parse(buf.toString('utf8')); m = `${jj.message || m} (${jj.status})`; } catch {} res.status(200).json({ corp, error: m }); return; }
      const text = biggestEntry(buf);
      res.status(200).json({ corp, rcept_no: rcept, title: title || '', ...extractSections(text, String(q.q || '')) }); return;
    }
    if (op === 'preset') { // 시장 전체 공시 스크리닝(자기주식 취득, 유상증자·CB, 합병·분할 …)
      const p = PRESETS[String(q.preset || '')]; if (!p) { res.status(400).json({ error: 'preset은 ' + Object.keys(PRESETS).join('|') + ' 중 하나입니다.' }); return; }
      const days = Math.min(90, Math.max(1, Number(q.days) || 30)); const end = new Date(); const bgn = new Date(Date.now() - days * 86400000); const rows = [];
      const first = await dartFetch('list.json', { bgn_de: ymd(bgn), end_de: ymd(end), pblntf_ty: p.ty, page_count: 100, page_no: 1 }, key);
      if (first.status === '013') { res.status(200).json({ preset: q.preset, label: p.label, days, items: [], scanned: 0 }); return; }
      if (first.status !== '000') { res.status(200).json({ error: `${first.message} (${first.status})` }); return; }
      rows.push(...(first.list || [])); const total = Math.min(Number(first.total_page || 1), 20);
      for (let pg = 2; pg <= total; pg += 5) {
        const batch = []; for (let k = pg; k < Math.min(total + 1, pg + 5); k++) batch.push(dartFetch('list.json', { bgn_de: ymd(bgn), end_de: ymd(end), pblntf_ty: p.ty, page_count: 100, page_no: k }, key).catch(() => ({ list: [] })));
        for (const r of await Promise.all(batch)) rows.push(...(r.list || []));
      }
      const items = rows.filter((x) => x.stock_code && p.re.test(x.report_nm)).map((x) => ({ rcept_no: x.rcept_no, stock_code: x.stock_code, corp_name: x.corp_name, title: x.report_nm, date: x.rcept_dt })).sort((a, b) => (a.date < b.date ? 1 : -1));
      res.status(200).json({ preset: q.preset, label: p.label, hint: p.hint, days, scanned: rows.length, truncated: Number(first.total_page || 1) > total, items: items.slice(0, 200) }); return;
    }
    if (op === 'quality') { // 우량도 비교(최대 5종목): 5개 지표 순위
      const codes = String(q.codes || '').split(',').map((s) => s.trim()).filter(okCode).slice(0, 5); if (codes.length < 1) { res.status(400).json({ error: 'codes(종목코드, 쉼표 구분)가 필요합니다.' }); return; }
      const y = new Date().getFullYear() - 1; const rows = [];
      await Promise.all(codes.map(async (code) => {
        const c = await corpOf(code, key, hints); if (!c) { rows.push({ stock_code: code, error: 'DART 미등록' }); return; }
        try {
          const [a, b] = await Promise.all([y, y - 3].map((yr) => dartFetch('fnlttSinglAcnt.json', { corp_code: c.corp_code, bsns_year: String(yr), reprt_code: '11011' }, key)));
          rows.push({ stock_code: code, corp_name: c.corp_name, corp_code: c.corp_code, ...qualityOf([[y, a], [y - 3, b]]) });
        } catch (e) { rows.push({ stock_code: code, corp_name: c.corp_name, error: String(e.message || e).slice(0, 80) }); }
      }));
      res.status(200).json({ results: rankQuality(rows) }); return;
    }
    res.status(400).json({ error: 'op가 올바르지 않습니다.' });
  } catch (e) { res.status(502).json({ error: String((e && e.message) || e).slice(0, 200) }); }
}
module.exports = handler;
module.exports._test = { unzipFirst, parseCorpXml, summarizeInsider, scoreAnomaly, extractSections, qualityOf, rankQuality, PRESETS, zipEntries };
