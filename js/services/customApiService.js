// 사용자가 직접 등록하는 커스텀 API 연동. 공공데이터포털처럼 미리 정해진 몇 개 서비스가 아니라,
// 이름/요청 URL/키/연결할 메뉴를 사용자가 직접 입력해 등록한다. 응답을 의미 있게 가공하는 것은
// API마다 달라 일반화할 수 없으므로, 이 기능은 등록한 API의 원본 응답(JSON이면 예쁘게, 아니면
// 텍스트로)을 해당 메뉴 화면 하단에 카드로 보여주는 데 집중한다.
// 일반 <script>로 로드되며 js/modules/*, js/router.js보다 먼저 로드되어야 한다.
(function () {
  const LIST_STORAGE = 'workspace:customApis';
  const CACHE_PREFIX = 'workspace:customApiCache:';
  const CACHE_TTL_MS = 1000 * 60 * 10; // 10분 — 등록한 API를 너무 자주 두드리지 않도록

  function listCustomApis() {
    try {
      const raw = JSON.parse(window.settingsSync.get(LIST_STORAGE) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  function saveCustomApis(list) {
    window.settingsSync.set(LIST_STORAGE, JSON.stringify(list));
  }

  function upsertCustomApi(entry) {
    const list = listCustomApis();
    const idx = list.findIndex((a) => a.id === entry.id);
    if (idx === -1) list.push(entry);
    else list[idx] = entry;
    saveCustomApis(list);
    return entry;
  }

  function deleteCustomApi(id) {
    saveCustomApis(listCustomApis().filter((a) => a.id !== id));
    try { localStorage.removeItem(CACHE_PREFIX + id); } catch {}
  }

  function customApisForMenu(path) {
    return listCustomApis().filter((a) => a.enabled !== false && Array.isArray(a.menus) && a.menus.includes(path));
  }

  function cacheGet(id) {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + id);
      if (!raw) return null;
      const { savedAt, data } = JSON.parse(raw);
      if (Date.now() - savedAt > CACHE_TTL_MS) return null;
      return data;
    } catch {
      return null;
    }
  }
  function cacheSet(id, data) {
    try { localStorage.setItem(CACHE_PREFIX + id, JSON.stringify({ savedAt: Date.now(), data })); } catch {}
  }

  // {key} 플레이스홀더를 실제 키 값으로 치환한다. 키가 없는 API(공개 API)는 그냥 그대로 쓴다.
  function resolveUrl(api) {
    if (!api.urlTemplate) return '';
    return api.keyValue ? api.urlTemplate.replaceAll('{key}', encodeURIComponent(api.keyValue)) : api.urlTemplate;
  }

  // 커스텀 API는 도메인이 제각각이라 CORS 여부를 미리 알 수 없다. 그래서 항상 같은 출처의
  // 범용 프록시(/api/custom-proxy?url=...)를 먼저 시도하고, 프록시가 없는 환경(로컬 데모 등)
  // 에서는 직접 호출로 폴백한다 — 오피넷/KOPIS에서 쓴 것과 같은 패턴을 범용화한 것이다.
  async function fetchCustomApi(api, { force = false } = {}) {
    if (!force) {
      const cached = cacheGet(api.id);
      if (cached) return cached;
    }
    const targetUrl = resolveUrl(api);
    if (!targetUrl) throw new Error('요청 URL이 비어 있습니다.');

    let text = null;
    let viaProxy = false;
    try {
      const proxyRes = await fetch(`/api/custom-proxy?url=${encodeURIComponent(targetUrl)}`);
      if (proxyRes.ok) {
        text = await proxyRes.text();
        viaProxy = true;
      } else if (proxyRes.status !== 404) {
        const errText = await proxyRes.text().catch(() => '');
        throw new Error(`요청이 실패했습니다(HTTP ${proxyRes.status})${errText ? ': ' + errText.slice(0, 200) : ''}`);
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('요청이 실패했습니다')) throw e;
      // 프록시가 없는 환경 — 아래에서 직접 호출로 폴백
    }

    if (text === null) {
      try {
        const res = await fetch(targetUrl);
        if (!res.ok) throw new Error(`요청이 실패했습니다(HTTP ${res.status}).`);
        text = await res.text();
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('요청이 실패했습니다')) throw e;
        throw new Error('연결하지 못했습니다. 브라우저가 CORS 정책으로 직접 호출을 막았을 가능성이 높습니다. Vercel에 재배포하면 포함된 /api/custom-proxy.js 프록시를 통해 자동으로 우회합니다.');
      }
    }

    let parsed;
    let kind;
    try {
      parsed = JSON.parse(text);
      kind = 'json';
    } catch {
      parsed = text;
      kind = 'text';
    }
    const result = { kind, data: parsed, fetchedAt: new Date().toISOString(), viaProxy };
    cacheSet(api.id, result);
    return result;
  }

  window.listCustomApis = listCustomApis;
  window.upsertCustomApi = upsertCustomApi;
  window.deleteCustomApi = deleteCustomApi;
  window.customApisForMenu = customApisForMenu;
  window.fetchCustomApi = fetchCustomApi;
})();
