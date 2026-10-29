// Vercel 서버리스 함수 — 시세·환율 "읽기 전용" 프록시 (v7.31.0).
//
// 네이버 증권(비공식 JSON)·Frankfurter(ECB 환율)는 브라우저 CORS가 막혀 있거나 보장되지 않아 서버에서 대신 GET 한다.
// 안전장치: ① 허용 호스트 목록(정확히 일치)만 ② https만 ③ 리다이렉트 불허 ④ 1MB·8초 제한 ⑤ GET 전용
//           ⑥ 사용자 키/헤더를 전달하지 않는다(인증이 필요한 호출은 이 프록시를 쓰지 않는다).
// 사용: GET /api/market-proxy?url=<encodeURIComponent(https://m.stock.naver.com/api/stock/005930/basic)>
const ALLOWED_HOSTS = new Set([
  'm.stock.naver.com',
  'api.stock.naver.com',
  'polling.finance.naver.com',
  'fchart.stock.naver.com',
  'api.frankfurter.app',
  'api.frankfurter.dev',
]);
const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 8000;

function checkUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return { error: '올바른 URL 형식이 아닙니다.' }; }
  if (u.protocol !== 'https:') return { error: 'https URL만 허용됩니다.' };
  if (u.username || u.password || u.port) return { error: '허용되지 않는 URL입니다.' };
  if (!ALLOWED_HOSTS.has(u.hostname.toLowerCase())) return { error: '허용되지 않는 호스트입니다.' };
  return { url: u };
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'GET만 지원합니다.' }); return; }
  const raw = req.query && req.query.url;
  if (!raw || typeof raw !== 'string') { res.status(400).json({ error: 'url이 필요합니다.' }); return; }
  const chk = checkUrl(raw);
  if (chk.error) { res.status(400).json({ error: chk.error }); return; }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(chk.url.toString(), {
      method: 'GET', redirect: 'error', signal: ctrl.signal,
      headers: { Accept: 'application/json, text/plain, */*', 'User-Agent': 'Mozilla/5.0 (compatible; WorkspaceApp/7.31)' },
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > MAX_BYTES) { res.status(413).json({ error: '응답이 너무 큽니다(1MB 초과).' }); return; }
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=60'); // 호출 수를 줄이려 짧게 캐시
    res.send(buf.toString('utf8'));
  } catch (e) {
    res.status(502).json({ error: e.name === 'AbortError' ? '요청 시간이 초과되었습니다.' : '대상 서버에 연결하지 못했습니다.' });
  } finally { clearTimeout(timer); }
}
module.exports = handler;
module.exports.checkUrl = checkUrl;
