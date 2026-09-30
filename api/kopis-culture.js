// Vercel 서버리스 함수 — KOPIS(공연예술통합전산망) 공연목록 조회(pblprfr) API 프록시.
// 오피넷과 마찬가지로 브라우저에서 직접 fetch()하면 CORS로 막힐 가능성이 높은 API라, 이 함수가
// 서버 쪽에서 대신 호출해 그대로 전달한다(서버-서버 호출은 CORS 제약이 없다).
// 쿼리스트링을 그대로 KOPIS에 전달할 뿐 이 서버에는 아무 것도 저장하지 않는다.
module.exports = async function handler(req, res) {
  const params = new URLSearchParams(req.query || {});
  if (!params.get('service')) {
    res.status(400).json({ error: 'KOPIS 서비스 키(service)가 필요합니다.' });
    return;
  }

  const upstreamUrl = `https://www.kopis.or.kr/openApi/restful/pblprfr?${params.toString()}`;

  try {
    const upstream = await fetch(upstreamUrl);
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    res.send(text);
  } catch (e) {
    res.status(502).json({ error: 'KOPIS 서버에 연결하지 못했습니다.' });
  }
};
