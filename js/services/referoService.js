// Refero(디자인 레퍼런스 검색) 연결 (v7.26.0). 브라우저 → /api/refero(Vercel 서버리스) → Refero 원격 MCP.
// 토큰은 이 브라우저(localStorage)에만 저장하고 Supabase로 동기화하지 않는다. 호출 때만 헤더로 프록시에 보낸다.
// Refero는 유료 플랜(Pro/Team/Lifetime) 토큰이 필요하다.
(function () {
  const TOKEN_KEY = 'workspace:refero:token';
  const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
  const setToken = (t) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* 무시 */ } };

  async function post(payload) {
    const token = getToken();
    if (!token) throw new Error('Refero 토큰을 먼저 저장해 주세요.');
    let res;
    try { res = await fetch('/api/refero', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-refero-token': token }, body: JSON.stringify(payload) }); }
    catch { throw new Error('프록시(/api/refero)에 연결하지 못했어요. Vercel에 배포된 주소에서만 동작해요(로컬 파일/데모에서는 불가).'); }
    if (res.status === 404) throw new Error('/api/refero가 없어요. api/refero.js를 포함해 Vercel에 다시 배포해 주세요.');
    let j = null; try { j = await res.json(); } catch { /* 무시 */ }
    if (!res.ok || !j) throw new Error((j && j.error) || `Refero 호출 실패(${res.status})`);
    if (j.ok === false) throw new Error(j.error || 'Refero 오류');
    return j.result;
  }
  const listTools = async () => ((await post({ action: 'tools' })) || {}).tools || [];
  const callTool = (name, args) => post({ action: 'call', name, args: args || {} });

  /** 검색 도구 고르기: 이름에 search가 있고 입력 스키마에 query(또는 q/keyword)가 있는 도구를 우선한다. */
  function pickSearchTool(tools) {
    const hasQ = (t) => { const p = (t.inputSchema && t.inputSchema.properties) || {}; return ['query', 'q', 'keyword', 'prompt', 'text'].find((k) => k in p) || null; };
    const scored = (tools || []).map((t) => ({ t, key: hasQ(t), s: (/search/i.test(t.name) ? 2 : 0) + (/screen|design|reference|inspiration/i.test(t.name) ? 1 : 0) })).filter((x) => x.key);
    scored.sort((a, b) => b.s - a.s);
    return scored[0] ? { tool: scored[0].t, key: scored[0].key } : null;
  }
  /** MCP 결과(content[]) → { texts:[], images:[url|dataUrl], links:[url] } */
  function flatten(result) {
    const out = { texts: [], images: [], links: [] };
    for (const c of (result && result.content) || []) {
      if (c.type === 'text' && c.text) {
        out.texts.push(c.text);
        for (const u of c.text.match(/https?:\/\/[^\s)"'<>\]]+/g) || []) { (/\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(u) ? out.images : out.links).push(u); }
      } else if (c.type === 'image' && c.data) out.images.push(`data:${c.mimeType || 'image/png'};base64,${c.data}`);
    }
    out.images = [...new Set(out.images)].slice(0, 24); out.links = [...new Set(out.links)].slice(0, 24);
    return out;
  }
  async function search(query) {
    const tools = await listTools();
    const pick = pickSearchTool(tools);
    if (!pick) throw new Error(`검색 도구를 찾지 못했어요. 사용 가능한 도구: ${tools.map((t) => t.name).join(', ') || '없음'}`);
    const result = await callTool(pick.tool.name, { [pick.key]: query });
    return { tool: pick.tool.name, ...flatten(result) };
  }
  window.ReferoService = { getToken, setToken, listTools, callTool, search, pickSearchTool, flatten };
})();
