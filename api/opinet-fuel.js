// Vercel 서버리스 함수 — 오피넷(한국석유공사) 유가정보 API 프록시.
// 오피넷 avgAllPrice API는 브라우저에서 fetch()로 직접 호출하면 CORS(Access-Control-Allow-Origin
// 미제공)로 막힌다. 서버(이 함수)가 대신 호출하면 서버-서버 통신이라 CORS 제약이 없고,
// 브라우저는 같은 출처(same-origin)인 /api/opinet-fuel만 호출하므로 문제없이 동작한다.
// API 키는 요청자(브라우저)가 쿼리스트링으로 전달한 값을 그대로 전달할 뿐, 이 서버에 저장하지 않는다
// (이 앱은 모든 사용자 설정을 브라우저에만 저장하는 구조를 따른다).
// 프로젝트에 package.json(type:module 설정)이 없는 순수 정적 사이트이므로, Vercel Node.js
// 런타임 기본값인 CommonJS 문법(module.exports)으로 작성한다.
module.exports = async function handler(req, res) {
  const key = req.query?.key;
  if (!key || typeof key !== 'string') {
    res.status(400).json({ error: '오피넷 API 키(key)가 필요합니다.' });
    return;
  }

  const upstreamUrl = `https://www.opinet.co.kr/api/avgAllPrice.do?code=${encodeURIComponent(key)}&out=json`;

  try {
    const upstream = await fetch(upstreamUrl);
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // 캐시 부담을 줄이기 위해 짧게 CDN 캐시(5분)한다 — 유가는 하루 한두 번 갱신되는 수준이라
    // 자주 바뀌지 않는다.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.send(text);
  } catch (e) {
    res.status(502).json({ error: '오피넷 서버에 연결하지 못했습니다.' });
  }
}
