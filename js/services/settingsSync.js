// 기기 간 설정 동기화(v7.18.0). 같은 계정으로 PC 두 대에서 로그인해도 동일한 화면이 나오도록,
// 지금까지 각 브라우저의 localStorage에만 있던 "설정성" 값들을 Supabase `user_settings.settings`
// (jsonb, 사용자당 1행, RLS: user_id = auth.uid())에 함께 저장한다.
//
// 구조: localStorage = 빠른 로컬 캐시(동기 get/set 그대로 유지), Supabase = 기기 간 공유 원본.
//   - set(key, value): 로컬에 즉시 저장 + (Supabase 모드면) 800ms 디바운스 후 해당 키만 병합 upsert.
//   - load(userId): 로그인/refreshAll 시 원격 행을 읽어 로컬 캐시를 덮어쓴다(원격 우선).
//       원격 행이 없거나 비어 있으면 이 기기의 로컬 값을 1회 올려 "시드"한다 → 먼저 로그인한
//       기기의 설정이 클라우드의 기준이 된다. 원격에 없는 키만 로컬에 있으면 그 키도 채워 올린다.
//   - 로컬 모드(CONFIG.mode !== 'supabase')에서는 네트워크 없이 localStorage만 쓴다.
//   - 원격 읽기 실패(예: 0022 마이그레이션 미실행으로 테이블 없음)는 경고를 1회 남기고
//     localStorage만 쓰는 상태로 조용히 내려간다.
// 동기화하지 않는 것(기기별 캐시/상태/세션): customApiCache:*, publicData:cache:*, publicData:status,
// tmdbStatus, auth:remember, supabase:lastActive — 이 파일의 SYNCED_KEYS에 없으면 로컬 전용이다.
// 일반 <script>로 로드되며 js/store/index.js 뒤, js/state.js 앞에서 로드되어야 한다.
(function () {
  const SYNCED_KEYS = [
    'workspace:weatherCities',
    'workspace:customApis', // 주의: 항목 안에 keyValue(API 키)가 들어 있다
    'workspace:publicData:dataGoKrKey',
    'workspace:publicData:kopisKey',
    'workspace:publicData:opinetKey',
    'workspace:publicData:enabled',
    'workspace:tmdbApiKey',
    'workspace:homeWidgetOrder',
    'workspace:clockTimezones',
    'workspace:sidebarCollapsed',
    'workspace:navStyle', // v7.24.0 — 내비게이션 스타일 'top'(기본)/'side'
    'workspace:homeStyle', 'workspace:bentoLayout', // v7.24.0 — 홈 화면 스타일 'classic'/'bento'
    'workspace:theme',
    'workspace:schedule:hideDone',
    'workspace:health:weeklyGoal',
    'workspace:health:targets', // v7.19.0 — 대시보드 카드별 목표값 JSON {weight,steps,bp_systolic,bp_diastolic}
    'workspace:health:medReminder', // v7.19.0 — 복약 시간 알림 on/off ('1'/'0')
    'workspace:recentlyViewed',
    'workspace:clockCities', // v7.21.0 — 시계별 연결 도시 JSON {시간대id: 도시이름}
    'workspace:animations', // v7.21.0 — 홈 애니메이션 효과 on/off ('1'/'0', 기본 '1')
    'workspace:briefing:template', // v7.21.0 — 브리핑 Markdown 템플릿(summary/checklist/top3)
    'workspace:reports:tiles', // v7.21.0 — 리포트 페이지 사용자 구성 타일 JSON
    'workspace:charts:prefs', // v7.21.0 — 차트별 보기 방식(막대/꺾은선/영역) 선택 JSON
  ];
  const SYNCED_SET = new Set(SYNCED_KEYS);
  const DEBOUNCE_MS = 800;
  const MIN_RELOAD_INTERVAL_MS = 15000; // refreshAll은 데이터 변경마다 불리므로 원격 재조회를 솎아낸다
  const OWNER_KEY = 'workspace:settingsSync:owner'; // 로컬 캐시가 누구 것인지(동기화 대상 아님)
  const DIRTY_KEY = 'workspace:settingsSync:dirty'; // 아직 올리지 못한 키 목록(동기화 대상 아님)

  // ------------------------------------------------------------------
  // 순수 로직(단위 테스트 대상) — window/localStorage/네트워크에 의존하지 않는다.
  // ------------------------------------------------------------------
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  // 원격 행과 로컬 캐시를 비교해 "로컬에 덮어쓸 값"과 "원격에 올릴 값"을 정한다.
  //  remote : 원격 settings 객체, 행이 없으면 null
  //  local  : { key: string|null } 로컬 캐시 스냅샷
  //  pending: 아직 원격에 못 올린 로컬 변경 키들 — 이 키는 로컬이 더 최신이므로 덮어쓰지 않는다
  // mode: 'seed'(원격에 유효한 값이 하나도 없음 → 로컬을 올려 시드) | 'pull'(원격 우선)
  function decideLoad({ remote, local, keys = SYNCED_KEYS, pending = [] }) {
    const remoteObj = remote && typeof remote === 'object' && !Array.isArray(remote) ? remote : {};
    const pend = new Set(pending);
    const applyLocal = {};
    const push = {};
    let remoteCount = 0;
    for (const k of keys) {
      const remoteHas = has(remoteObj, k) && typeof remoteObj[k] === 'string';
      const localHas = typeof local[k] === 'string';
      if (remoteHas) remoteCount += 1;
      if (pend.has(k)) continue; // 이미 업로드 대기 중
      if (remoteHas) {
        if (!localHas || local[k] !== remoteObj[k]) applyLocal[k] = remoteObj[k];
      } else if (localHas) {
        push[k] = local[k];
      }
    }
    return { applyLocal, push, mode: remoteCount === 0 ? 'seed' : 'pull' };
  }

  // 원격 settings에 변경분(patch)을 키 단위로 병합한다. 값이 null이면 해당 키를 지운다.
  function mergeSettings(remote, patch) {
    const base = remote && typeof remote === 'object' && !Array.isArray(remote) ? { ...remote } : {};
    for (const [k, v] of Object.entries(patch || {})) {
      if (v === null || v === undefined) delete base[k];
      else base[k] = v;
    }
    return base;
  }

  // 이 브라우저의 로컬 캐시가 "다른 계정"의 것이면 버려야 한다(공용 PC에서 이전 사용자의
  // API 키가 새 사용자의 클라우드로 올라가는 것을 막는다). owner 기록이 없으면(동기화 도입
  // 이전부터 쓰던 브라우저) 현재 사용자의 것으로 간주해 그대로 시드에 쓴다.
  function shouldDiscardLocal(owner, userId) {
    return !!owner && !!userId && owner !== userId;
  }

  // 원격 재조회 간격 제한. 최초(last 없음)·강제(force)는 항상 조회한다.
  function shouldReload({ now, last, minMs = MIN_RELOAD_INTERVAL_MS, force = false }) {
    if (force || !last) return true;
    return now - last >= minMs;
  }

  // 디바운스 + 키 단위 병합 배치. 같은 키를 여러 번 set하면 마지막 값만 올라간다.
  // flush(patch)가 던지면 patch를 다시 대기열에 넣는다(더 최신 값이 있으면 그것을 유지).
  function createBatcher({ delay = DEBOUNCE_MS, flush, onError, onFlushed, setTimer = setTimeout, clearTimer = clearTimeout }) {
    let pending = {};
    let timer = null;
    let inflight = null;

    function schedule() {
      if (timer) clearTimer(timer);
      timer = setTimer(() => { timer = null; flushNow(); }, delay);
    }
    function add(key, value) {
      pending[key] = value;
      schedule();
    }
    async function flushNow() {
      if (timer) { clearTimer(timer); timer = null; }
      if (inflight) await inflight;
      const keys = Object.keys(pending);
      if (!keys.length) return true;
      const patch = pending;
      pending = {};
      inflight = (async () => {
        try {
          await flush(patch);
          if (onFlushed) onFlushed(Object.keys(patch).filter((k) => !has(pending, k)));
          return true;
        } catch (e) {
          for (const k of Object.keys(patch)) if (!has(pending, k)) pending[k] = patch[k];
          if (onError) onError(e);
          return false;
        }
      })();
      const ok = await inflight;
      inflight = null;
      return ok;
    }
    return {
      add,
      flushNow,
      pendingKeys: () => Object.keys(pending),
      hasPending: () => Object.keys(pending).length > 0 || !!inflight,
    };
  }

  window.SettingsSyncLogic = { SYNCED_KEYS, decideLoad, mergeSettings, shouldDiscardLocal, shouldReload, createBatcher };

  // ------------------------------------------------------------------
  // 런타임(브라우저) 부분
  // ------------------------------------------------------------------
  const state = {
    userId: null,
    remoteOk: null, // null=미확인, true=원격 사용 가능, false=원격 사용 불가(로컬 전용으로 동작)
    lastLoadAt: 0,
    warned: false,
    listeners: new Set(),
  };

  function lsGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function lsSet(key, value) { try { localStorage.setItem(key, value); } catch { /* 저장소 사용 불가여도 앱은 동작 */ } }
  function lsRemove(key) { try { localStorage.removeItem(key); } catch { /* 무시 */ } }

  function isSupabaseMode() { return window.CONFIG?.mode === 'supabase'; }
  function remoteActive() { return isSupabaseMode() && !!state.userId && state.remoteOk !== false; }

  function warnOnce(e) {
    if (state.warned) return;
    state.warned = true;
    console.warn('[settingsSync] 설정을 Supabase와 동기화하지 못해 이 브라우저(localStorage)에만 저장합니다. ' +
      'user_settings 테이블이 없다면 supabase/migrations/0022_user_settings.sql을 실행하세요.', e?.message || e);
  }

  function readDirty() {
    try {
      const arr = JSON.parse(lsGet(DIRTY_KEY) || '[]');
      return Array.isArray(arr) ? arr.filter((k) => SYNCED_SET.has(k)) : [];
    } catch { return []; }
  }
  function writeDirty(arr) {
    if (arr.length) lsSet(DIRTY_KEY, JSON.stringify(arr)); else lsRemove(DIRTY_KEY);
  }
  function markDirty(key) {
    const d = readDirty();
    if (!d.includes(key)) { d.push(key); writeDirty(d); }
  }

  // read-merge-write: 다른 기기가 방금 바꾼 다른 키를 덮어쓰지 않도록, 올리기 직전에 현재
  // 원격 값을 읽어 이번 변경분만 병합해 upsert한다.
  async function flushToRemote(patch) {
    const store = window.getStore();
    const current = await store.loadUserSettings();
    await store.saveUserSettings(state.userId, mergeSettings(current, patch));
  }

  const batcher = createBatcher({
    flush: flushToRemote,
    onError: warnOnce,
    onFlushed: (keys) => writeDirty(readDirty().filter((k) => !keys.includes(k))),
  });

  function get(key) {
    return lsGet(key);
  }

  // value는 문자열(기존 localStorage.setItem과 동일). 같은 값이면 아무 일도 하지 않는다.
  function set(key, value) {
    const next = String(value);
    const prev = lsGet(key);
    lsSet(key, next);
    if (!SYNCED_SET.has(key) || prev === next || !remoteActive()) return;
    markDirty(key);
    batcher.add(key, next);
  }

  function snapshotLocal() {
    const out = {};
    for (const k of SYNCED_KEYS) out[k] = lsGet(k);
    return out;
  }

  function notify(changedKeys) {
    for (const cb of state.listeners) {
      try { cb(changedKeys); } catch (e) { console.error(e); }
    }
  }

  // 로그인/refreshAll에서 호출. 실패해도 절대 던지지 않는다. 반환: { changed: string[], mode }
  async function load(userId, { force = false } = {}) {
    if (!isSupabaseMode() || !userId) return { changed: [], mode: 'local' };
    const userChanged = state.userId !== userId;
    state.userId = userId;
    if (state.remoteOk === false) return { changed: [], mode: 'disabled' };
    if (!shouldReload({ now: Date.now(), last: state.lastLoadAt, force: force || userChanged })) {
      return { changed: [], mode: 'skipped' };
    }
    try {
      const store = window.getStore();
      if (typeof store.loadUserSettings !== 'function') throw new Error('store has no loadUserSettings');
      const remote = await store.loadUserSettings();

      // 다른 계정이 쓰던 브라우저면 로컬 캐시를 비운 뒤 시작한다.
      const owner = lsGet(OWNER_KEY);
      if (shouldDiscardLocal(owner, userId)) {
        for (const k of SYNCED_KEYS) lsRemove(k);
        writeDirty([]);
      }
      lsSet(OWNER_KEY, userId);

      const local = snapshotLocal();
      const dirty = readDirty();
      const pending = Array.from(new Set([...batcher.pendingKeys(), ...dirty]));
      const { applyLocal, push, mode } = decideLoad({ remote, local, pending });

      const changed = Object.keys(applyLocal);
      for (const k of changed) lsSet(k, applyLocal[k]);

      // 이전 세션에서 못 올린 변경(탭을 일찍 닫은 경우 등)은 로컬 값을 다시 올린다.
      for (const k of dirty) if (typeof local[k] === 'string') batcher.add(k, local[k]);
      for (const [k, v] of Object.entries(push)) { markDirty(k); batcher.add(k, v); }

      state.remoteOk = true;
      state.lastLoadAt = Date.now();
      if (changed.length) notify(changed);
      if (batcher.hasPending()) batcher.flushNow(); // 기다리지 않는다(첫 화면을 막지 않음)
      return { changed, mode };
    } catch (e) {
      state.remoteOk = false;
      warnOnce(e);
      return { changed: [], mode: 'error' };
    }
  }

  // 변경 알림 구독(테마/사이드바처럼 화면을 다시 그리지 않고 즉시 반영해야 하는 값용).
  function onChange(cb) {
    state.listeners.add(cb);
    return () => state.listeners.delete(cb);
  }

  // 탭을 닫기 직전 대기 중인 변경을 올려 본다(best-effort). 못 올려도 dirty 표시가 남아
  // 다음에 열 때 다시 올라간다.
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', () => { if (batcher.hasPending()) batcher.flushNow(); });
  }

  window.settingsSync = {
    SYNCED_KEYS,
    get,
    set,
    load,
    onChange,
    flush: () => batcher.flushNow(),
    _state: state,
  };
})();
