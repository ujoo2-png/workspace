// Vercel 서버리스 함수 — 한국투자증권(KIS) 개발자 API 프록시 (v7.24.0).
// 왜 프록시가 필요한가:
//   1) KIS API는 CORS 헤더를 주지 않아 브라우저에서 직접 호출할 수 없다.
//   2) KIS는 호출마다 OAuth 접근토큰이 필요한데, 토큰은 약 24시간 유효하고 재발급이 잦으면
//      제한을 받는다. 그래서 토큰 발급/캐시를 서버(이 함수)에서 처리한다.
//   3) appsecret을 브라우저에 두면 노출되므로, 토큰 교환은 서버에서만 수행한다.
// 앱키/시크릿은 요청(브라우저)이 헤더로 전달한 값을 그대로 쓰고 이 서버에 저장하지 않는다
// (이 앱은 모든 사용자 설정을 브라우저에만 저장하는 구조를 따른다).
//
// 사용법:
//   GET /api/kis?path=/uapi/domestic-stock/v1/quotations/inquire-price&tr_id=FHKST01010100
//       &params=<encodeURIComponent(JSON)>
//   헤더: x-kis-appkey, x-kis-appsecret, x-kis-env(mock|real)
// 실제 KIS 엔드포인트/tr_id 조합은 클라이언트가 지정하고, 이 프록시는 "토큰 부착 + 전달"만 한다.
const KIS_HOST = { real: 'https://openapi.koreainvestment.com:9443', mock: 'https://openapivts.koreainvestment.com:29443' };

// 토큰 캐시 (웜 인스턴스 기준). 키 = env|appkey.
const tokenCache = new Map();
const TOKEN_TTL_MS = 1000 * 60 * 60 * 6; // 6시간 (KIS 실제 만료는 24시간이지만 안전하게 짧게)

async function getAccessToken(env, appkey, appsecret) {
  const cacheKey = `${env}|${appkey}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() - cached.at < TOKEN_TTL_MS) return cached.token;

  const host = KIS_HOST[env] || KIS_HOST.real;
  const res = await fetch(`${host}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey, appsecret }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.message || `토큰 발급 실패(HTTP ${res.status})`);
  }
  tokenCache.set(cacheKey, { token: data.access_token, at: Date.now() });
  return data.access_token;
}

module.exports = async function handler(req, res) {
  const appkey = req.headers['x-kis-appkey'];
  const appsecret = req.headers['x-kis-appsecret'];
  const env = req.headers['x-kis-env'] === 'mock' ? 'mock' : 'real';
  const path = req.query?.path;
  const trId = req.query?.tr_id;

  if (!appkey || !appsecret) { res.status(400).json({ error: 'KIS 앱키(appkey)와 시크릿(appsecret)이 필요합니다.' }); return; }
  if (!path || typeof path !== 'string' || !path.startsWith('/uapi/')) { res.status(400).json({ error: '올바른 KIS API 경로(path)가 필요합니다.' }); return; }

  let params = {};
  if (req.query?.params) {
    try { params = JSON.parse(req.query.params); } catch { res.status(400).json({ error: 'params는 JSON 형식이어야 합니다.' }); return; }
  }

  try {
    const token = await getAccessToken(env, appkey, appsecret);
    const host = KIS_HOST[env];
    const url = new URL(host + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

    const upstream = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        authorization: `Bearer ${token}`,
        appkey,
        appsecret,
        ...(trId ? { tr_id: String(trId) } : {}),
        custtype: 'P',
      },
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // 시세는 짧게 캐시(30초) — 같은 화면을 여러 번 새로고침해도 KIS 호출을 아끼기 위함.
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    res.send(text);
  } catch (e) {
    res.status(502).json({ error: e.message || '한국투자증권 서버에 연결하지 못했습니다.' });
  }
}
