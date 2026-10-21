// Vercel 서버리스 함수 — 임의의 증권 시세 API용 범용 JSON 프록시 (v7.25.0).
//
// 왜 필요한가:
//   대부분의 증권 시세 API(비공식 포함)는 CORS 헤더를 주지 않아 브라우저에서 직접 호출할 수 없다.
//   이 함수가 서버에서 대신 호출해 JSON을 그대로 돌려준다.
//
// 안전장치(필수):
//   · 외부에서 임의 URL을 열어주는 프록시는 SSRF/open-proxy 위험이 있다. 그래서
//     - https/http만 허용, 사설/루프백/메타데이터 IP·호스트는 차단,
//     - 응답 크기 상한(약 1MB), 타임아웃(8초),
//     - GET만 허용, 허용 헤더만 전달(민감 헤더는 차단).
//   · 사용자가 직접 등록한 "본인 계정의" API 호출 용도임을 전제로 한다.
//
// 사용법:
//   POST /api/stock-proxy  { "url": "https://api.example.com/quote?code=005930", "headers": {"Authorization":"Bearer ..."} }
//   → API의 JSON 응답을 그대로 반환.

const MAX_BYTES = 1024 * 1024; // 1MB
const TIMEOUT_MS = 8000;

// 차단: 사설/루프백/링크로컬 대역과 클라우드 메타데이터 호스트.
function isBlockedHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === 'metadata.google.internal') return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === '0.0.0.0' || h === '::1' || h === '[::1]') return true;
  return false;
}

// 전달 가능한 헤더만 허용(프록시가 인증 헤더를 임의로 흘리지 않도록).
const BLOCKED_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'cookie', 'set-cookie']);

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 지원합니다.' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { res.status(400).json({ error: 'JSON 본문이 필요합니다.' }); return; } }
  const target = body && body.url;
  if (!target || typeof target !== 'string') { res.status(400).json({ error: 'url이 필요합니다.' }); return; }

  let u;
  try { u = new URL(target); } catch { res.status(400).json({ error: '올바른 URL 형식이 아닙니다.' }); return; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') { res.status(400).json({ error: 'http(s) URL만 허용됩니다.' }); return; }
  if (isBlockedHost(u.hostname)) { res.status(400).json({ error: '허용되지 않는 호스트입니다.' }); return; }

  const headers = { Accept: 'application/json' };
  const extra = (body.headers && typeof body.headers === 'object') ? body.headers : {};
  for (const [k, v] of Object.entries(extra)) {
    if (BLOCKED_HEADERS.has(String(k).toLowerCase())) continue;
    if (v === null || v === undefined) continue;
    headers[String(k)] = String(v);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(u.toString(), { method: 'GET', headers, signal: ctrl.signal, redirect: 'follow' });
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > MAX_BYTES) { res.status(413).json({ error: '응답이 너무 큽니다(1MB 초과).' }); return; }
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
    // 시세는 짧게 캐시(30초).
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    res.send(buf.toString('utf8'));
  } catch (e) {
    res.status(502).json({ error: e.name === 'AbortError' ? '요청 시간이 초과되었습니다.' : (e.message || '대상 서버에 연결하지 못했습니다.') });
  } finally {
    clearTimeout(timer);
  }
};
