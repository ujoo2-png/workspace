// Vercel 서버리스 함수 — 사용자가 설정 화면에서 등록한 "커스텀 API"용 범용 CORS 우회 프록시.
// 오피넷/KOPIS 전용 프록시와 달리 임의의 외부 URL을 그대로 fetch해서 전달한다.
// 이 프록시는 공개적으로 배포되어 있으므로(로그인 없이도 도달 가능), 사설망/내부망으로의
// 요청을 막는 최소한의 SSRF 방지 규칙을 둔다: https만 허용하고, localhost/사설 IP 대역/클라우드
// 메타데이터 주소는 거부한다.
const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^169\.254\./, // 링크 로컬 + 클라우드 메타데이터(169.254.169.254) 포함
  /^\[?::1\]?$/,
  /^\[?fe80:/i,
  /^\[?fc00:/i,
  /^\[?fd00:/i,
];

module.exports = async function handler(req, res) {
  const target = req.query?.url;
  if (!target || typeof target !== 'string') {
    res.status(400).json({ error: '요청 URL(url)이 필요합니다.' });
    return;
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    res.status(400).json({ error: '올바른 URL이 아닙니다.' });
    return;
  }

  if (parsed.protocol !== 'https:') {
    res.status(400).json({ error: 'https:// URL만 허용됩니다.' });
    return;
  }
  if (BLOCKED_HOSTNAME_PATTERNS.some((re) => re.test(parsed.hostname))) {
    res.status(400).json({ error: '이 주소는 프록시할 수 없습니다.' });
    return;
  }

  try {
    // v7.35.0: 많은 언론사/블로그 RSS가 User-Agent 없는 요청(서버리스 기본값)을 403/406으로 거절한다.
    // 일반 브라우저처럼 보이는 헤더를 보내고, 응답이 없는 서버에 오래 매달리지 않도록 시간 제한(15초)을 둔다.
    const upstream = await fetch(parsed.toString(), {
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WorkSpaceFeedReader/1.0; +https://ejaeyoung.vercel.app) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, text/html;q=0.8, */*;q=0.5',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.7',
      },
    });
    const text = await upstream.text();
    res.status(upstream.status);
    // 응답 Content-Type을 최대한 그대로 전달해, 클라이언트가 JSON인지 아닌지 스스로 판단하게 한다.
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    // 성공 응답만 잠깐 캐시한다. 오류(403/429/5xx 등)를 5분간 캐시하면 서버가 풀려도 계속 실패로 보이기 때문.
    res.setHeader('Cache-Control', upstream.ok ? 's-maxage=300, stale-while-revalidate=600' : 'no-store');
    res.send(text);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    res.status(timedOut ? 504 : 502).json({ error: timedOut ? '대상 서버가 15초 안에 응답하지 않았습니다.' : '대상 서버에 연결하지 못했습니다.' });
  }
};
