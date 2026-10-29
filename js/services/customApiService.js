// 사용자가 직접 등록하는 커스텀 API 연동. 공공데이터포털처럼 미리 정해진 몇 개 서비스가 아니라,
// 이름/요청 URL/키/연결할 메뉴를 사용자가 직접 입력해 등록한다. 응답을 의미 있게 가공하는 것은
// API마다 달라 일반화할 수 없으므로, 이 기능은 등록한 API의 원본 응답(JSON이면 예쁘게, 아니면
// 텍스트로)을 해당 메뉴 화면 하단에 카드로 보여주는 데 집중한다.
// 일반 <script>로 로드되며 js/modules/*, js/router.js보다 먼저 로드되어야 한다.
(function () {
  const LIST_STORAGE = 'workspace:customApis';
  const CACHE_PREFIX = 'workspace:customApiCache:';
  const STATUS_PREFIX = 'workspace:customApiStatus:'; // id → { state, at, message, ms }
  const CACHE_TTL_MS = 1000 * 60 * 10; // 10분 — 등록한 API를 너무 자주 두드리지 않도록

  // ── 연결 상태(연결/미연결/불안정/오류) ──────────────────────────────────────
  //  · unset    미연결 : 아직 한 번도 호출해 보지 않았거나 키/URL이 비어 있음
  //  · connected 연결  : 최근 호출이 정상(연속 실패 없음)
  //  · unstable 불안정 : 한 번 실패했지만 이전에 성공한 적이 있음(일시적 오류 의심)
  //  · error    오류    : 연속 실패(설정/키/URL 문제 가능성)
  function getCustomApiStatus(id) {
    try {
      const raw = window.settingsSync.get(STATUS_PREFIX + id);
      if (raw) return JSON.parse(raw);
    } catch {}
    return { state: 'unset', at: null, message: '' };
  }
  function setCustomApiStatus(id, patch) {
    const prev = getCustomApiStatus(id);
    const next = { ...prev, ...patch, at: new Date().toISOString() };
    next.failStreak = patch.ok ? 0 : (prev.failStreak || 0) + 1;
    if (patch.ok) next.everOk = true;
    try { window.settingsSync.set(STATUS_PREFIX + id, JSON.stringify(next)); } catch {}
    return next;
  }
  /** 상태 라벨/색상(UI 공용). */
  const STATUS_META = {
    connected: { label: '연결', cls: 'ok' },
    unstable: { label: '불안정', cls: 'warn' },
    error: { label: '오류', cls: 'err' },
    unset: { label: '미연결', cls: 'muted' },
  };

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
    if (!api.urlTemplate) { setCustomApiStatus(api.id, { ok: false, message: '요청 URL이 비어 있습니다.' }); throw new Error('요청 URL이 비어 있습니다.'); }
    if (!force) {
      const cached = cacheGet(api.id);
      if (cached) return cached;
    }
    const targetUrl = resolveUrl(api);
    if (!targetUrl) { setCustomApiStatus(api.id, { ok: false, message: '요청 URL이 비어 있습니다.' }); throw new Error('요청 URL이 비어 있습니다.'); }

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
      if (e instanceof Error && e.message.startsWith('요청이 실패했습니다')) { setCustomApiStatus(api.id, { ok: false, message: e.message }); throw e; }
      // 프록시가 없는 환경 — 아래에서 직접 호출로 폴백
    }

    if (text === null) {
      try {
        const res = await fetch(targetUrl);
        if (!res.ok) throw new Error(`요청이 실패했습니다(HTTP ${res.status}).`);
        text = await res.text();
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('요청이 실패했습니다')) { setCustomApiStatus(api.id, { ok: false, message: e.message }); throw e; }
        const msg = '연결하지 못했습니다. 브라우저가 CORS 정책으로 직접 호출을 막았을 가능성이 높습니다. Vercel에 재배포하면 포함된 /api/custom-proxy.js 프록시를 통해 자동으로 우회합니다.';
        setCustomApiStatus(api.id, { ok: false, message: msg });
        throw new Error(msg);
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
    // 응답이 왔더라도 내용이 비어 있으면 '불안정'으로 본다(값이 없는 응답은 사실상 실패).
    const hasBody = kind === 'json' ? (parsed && (Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length)) : String(parsed || '').trim().length;
    setCustomApiStatus(api.id, { ok: !!hasBody, message: hasBody ? '' : '응답은 왔지만 내용이 비어 있습니다.' });
    return result;
  }

  /** 연결 테스트: 강제로 한 번 호출하고 상태를 갱신해 반환한다. */
  async function testCustomApi(api) {
    const started = Date.now();
    try {
      const res = await fetchCustomApi(api, { force: true });
      const ms = Date.now() - started;
      const st = setCustomApiStatus(api.id, { ok: true, message: '', ms });
      return { ok: true, ms, kind: res.kind, status: st };
    } catch (e) {
      const ms = Date.now() - started;
      const st = setCustomApiStatus(api.id, { ok: false, message: e.message, ms });
      return { ok: false, ms, message: e.message, status: st };
    }
  }

  window.listCustomApis = listCustomApis;
  window.upsertCustomApi = upsertCustomApi;
  window.deleteCustomApi = deleteCustomApi;
  window.customApisForMenu = customApisForMenu;
  window.fetchCustomApi = fetchCustomApi;
  window.testCustomApi = testCustomApi;
  window.getCustomApiStatus = getCustomApiStatus;
  window.setCustomApiStatus = setCustomApiStatus;
  window.CUSTOM_API_STATUS_META = STATUS_META;
})();
