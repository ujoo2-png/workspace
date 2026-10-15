// Vercel 서버리스 함수 — Refero(디자인 레퍼런스) 원격 MCP 서버(https://api.refero.design/mcp) 호출 전용 프록시 (v7.26.0).
// 브라우저에서 바로 부르면 CORS로 막힐 수 있고, 토큰을 화면 코드에 박아 둘 수 없어서 서버리스 함수가 대신 전달한다.
// 보안: ① 대상 주소는 코드에 고정(임의 URL 불가 → SSRF 없음) ② 토큰은 요청 헤더(x-refero-token)로만 받아 그대로 전달하고
//       저장/로그하지 않는다 ③ POST만 허용 ④ 본문 크기·도구 이름·시간(20초) 제한.
// 동작: MCP(Streamable HTTP)는 initialize → notifications/initialized → tools/list | tools/call 순서라 한 번의 호출 안에서 모두 처리한다.
const UPSTREAM = 'https://api.refero.design/mcp';
const PROTOCOL = '2025-06-18';

function parseBody(text, contentType, id) {
  if (/text\/event-stream/i.test(contentType || '')) {
    let found = null;
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
      if (!data) continue;
      try { const j = JSON.parse(data); if (j.id === id || found === null) found = j; } catch { /* 무시 */ }
    }
    return found;
  }
  try { return JSON.parse(text); } catch { return null; }
}

async function rpc(token, payload, session) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${token}`,
    'MCP-Protocol-Version': PROTOCOL,
  };
  if (session) headers['Mcp-Session-Id'] = session;
  const res = await fetch(UPSTREAM, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  return { status: res.status, session: res.headers.get('mcp-session-id') || session, json: payload.id !== undefined ? parseBody(text, res.headers.get('content-type'), payload.id) : null, raw: text };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 허용됩니다.' }); return; }
  const token = String(req.headers['x-refero-token'] || '').trim();
  if (token.length < 8 || token.length > 4096) { res.status(400).json({ error: 'Refero 토큰이 필요합니다.' }); return; }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || !['tools', 'call'].includes(body.action)) { res.status(400).json({ error: 'action은 tools 또는 call 이어야 합니다.' }); return; }
  if (JSON.stringify(body).length > 20000) { res.status(413).json({ error: '요청이 너무 큽니다.' }); return; }
  if (body.action === 'call' && !/^[A-Za-z0-9_.\-]{1,80}$/.test(String(body.name || ''))) { res.status(400).json({ error: '도구 이름이 올바르지 않습니다.' }); return; }
  try {
    const init = await rpc(token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'workspace-app', version: '7.26' } } });
    if (init.status === 401 || init.status === 403) { res.status(401).json({ error: '토큰이 올바르지 않거나 만료되었습니다(Refero 유료 플랜 토큰이 필요해요).' }); return; }
    if (init.status >= 400 || !init.json || init.json.error) { res.status(502).json({ error: `Refero 연결 실패(${init.status}): ${(init.json && init.json.error && init.json.error.message) || init.raw.slice(0, 160)}` }); return; }
    await rpc(token, { jsonrpc: '2.0', method: 'notifications/initialized' }, init.session).catch(() => {});
    const call = body.action === 'tools'
      ? { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }
      : { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: body.name, arguments: body.args && typeof body.args === 'object' ? body.args : {} } };
    const r = await rpc(token, call, init.session);
    if (r.status === 429) { res.status(429).json({ error: 'Refero 사용 한도(월 호출 수)를 넘었어요.' }); return; }
    if (r.status >= 400 || !r.json) { res.status(502).json({ error: `Refero 응답 오류(${r.status})` }); return; }
    if (r.json.error) { res.status(200).json({ ok: false, error: r.json.error.message || 'Refero 오류' }); return; }
    res.status(200).json({ ok: true, result: r.json.result });
  } catch (e) {
    res.status(502).json({ error: e && e.name === 'TimeoutError' ? 'Refero 응답 시간이 초과되었습니다.' : 'Refero 서버에 연결하지 못했습니다.' });
  }
};
