// v7.26.0 — Supabase 무료 용량 관리: 한도 정의, 이그레스(전송량) 추정기, 메뉴별 분해 계산, 직접 입력값.
// 일반 <script>(Node 테스트에서는 globalThis). config.js, utils/date.js 뒤, settingsSync.js 뒤에 로드한다.
//
// 측정 방식(정직하게):
//  · DB 크기 / Storage 크기 / 테이블별 크기 / 가입자 수 → 0031 마이그레이션의 app_usage_stats() RPC로 "서버에서 정확히" 읽는다.
//  · 이그레스 → Supabase는 DB로 조회할 방법을 주지 않는다. 이 브라우저가 Supabase에서 받은 응답 크기를 직접 세어(Content-Length, 없으면 본문 크기)
//    테이블/메뉴별로 쌓는 "추정치"다. 다른 기기·다른 브라우저·이미지 태그(<img>)로 받은 용량은 빠진다 → 실제 값은 직접 입력으로 덮어쓸 수 있다.
//  · 로그 수집/조회, Realtime, Edge Function 등 → 서버에 공개된 조회 수단이 없어 직접 입력(Supabase 대시보드 Usage 화면의 값을 옮겨 적기).
(function () {
  const G = globalThis;
  const MB = 1024 * 1024; const GB = 1024 * MB;

  // 무료(Free) 플랜 기본 한도(공식 Billing 문서 기준). 로그 수집/조회는 공개된 무료 한도를 확인하지 못해 비워 두었다(직접 입력).
  const METRICS = [
    { id: 'db', label: '데이터베이스 크기', icon: '🗄️', unit: 'bytes', limit: 500 * MB, source: 'auto', hint: '디스크에 저장된 DB 전체(첨부파일 base64 포함)' },
    { id: 'storage', label: 'Storage 크기', icon: '📦', unit: 'bytes', limit: 1 * GB, source: 'auto', hint: '파일 버킷에 올린 파일 합계(이 앱은 첨부를 DB에 저장하므로 보통 0)' },
    { id: 'egress', label: '이그레스(전송량)', icon: '📡', unit: 'bytes', limit: 5 * GB, source: 'estimate', period: 'month', hint: 'Supabase → 내 기기로 내려받은 데이터 양(월)' },
    { id: 'mau', label: '월간 활성 사용자(MAU)', icon: '👥', unit: 'count', limit: 50000, source: 'auto', hint: '최근 30일 안에 로그인한 사용자 수' },
    { id: 'logIngestion', label: '로그 수집(Log Ingestion)', icon: '📝', unit: 'bytes', limit: null, source: 'manual', hint: 'Supabase 대시보드 Usage → Log Ingestion 값을 입력' },
    { id: 'logQuery', label: '로그 조회(Log Query)', icon: '🔎', unit: 'bytes', limit: null, source: 'manual', hint: 'Supabase 대시보드 Usage → Log Query 값을 입력' },
    { id: 'edge', label: 'Edge Function 호출', icon: '⚡', unit: 'count', limit: 500000, source: 'estimate', period: 'month', hint: '월 호출 수(이 브라우저에서 부른 횟수 추정)' },
    { id: 'realtimeMsgs', label: 'Realtime 메시지', icon: '💬', unit: 'count', limit: 2000000, source: 'manual', hint: '월 메시지 수 — 대시보드 값을 입력' },
    { id: 'realtimePeak', label: 'Realtime 최대 동시 연결', icon: '🔌', unit: 'count', limit: 200, source: 'manual', hint: '동시 연결 최고치 — 대시보드 값을 입력' },
  ];

  // 테이블 → 메뉴(어느 화면에서 쓰는 데이터인지)
  const TABLE_MENU = {
    schedules: '🗓️ 일정', ddays: '🗓️ 일정(D-day)',
    projects: '📁 프로젝트', project_stages: '📁 프로젝트(WBS)', project_progress: '📁 프로젝트',
    challenges: '🏆 챌린저', challenge_checkins: '🏆 챌린저',
    briefing_topics: '📰 관심주제', briefing_items: '📰 관심주제', feed_sources: '📰 관심주제',
    playlist_items: '🎬 문화생활',
    vehicles: '🚗 차량관리', vehicle_fuel_logs: '🚗 차량관리', vehicle_maintenance: '🚗 차량관리', vehicle_odometer_logs: '🚗 차량관리',
    health_metrics: '💪 Health', health_appointments: '💪 Health', health_medications: '💪 Health', health_med_logs: '💪 Health',
    devlogs: '🛠️ Devlog', knowledge_docs: '📓 Knowledge',
    career_awards: '📋 이력/경력', career_basic_info: '📋 이력/경력', career_certifications: '📋 이력/경력', career_education: '📋 이력/경력',
    career_experiences: '📋 이력/경력', career_memberships: '📋 이력/경력', career_photos: '📋 이력/경력', career_trainings: '📋 이력/경력', career_documents: '📋 이력/경력(양식)',
    programs: '🧩 프로그램', bookmarks: '🧩 프로그램(즐겨찾기)',
    automation_rules: '🤖 Automation', automation_logs: '🤖 Automation', integrations: '🔗 Integrations',
    notifications: '🔔 알림(홈)', profiles: '⚙️ 계정/설정', user_settings: '⚙️ 설정',
  };
  // 첨부파일(attachments.owner_table) → 메뉴
  const OWNER_MENU = {
    schedules: '🗓️ 일정', projects: '📁 프로젝트', project_stages: '📁 프로젝트(WBS)', challenges: '🏆 챌린저', playlist_items: '🎬 문화생활', vehicles: '🚗 차량관리',
    vehicle_maintenance: '🚗 차량관리', health_appointments: '💪 Health', knowledge_docs: '📓 Knowledge', devlogs: '🛠️ Devlog', programs: '🧩 프로그램', career_documents: '📋 이력/경력(양식)',
    career_certifications: '📋 이력/경력', career_education: '📋 이력/경력', career_experiences: '📋 이력/경력', career_awards: '📋 이력/경력', career_trainings: '📋 이력/경력', career_memberships: '📋 이력/경력',
  };
  const ROUTE_MENU = {
    '/home': '🏠 홈', '/schedule': '🗓️ 일정', '/projects': '📁 프로젝트', '/challenges': '🏆 챌린저', '/briefing': '📰 관심주제', '/playlist': '🎬 문화생활', '/vehicles': '🚗 차량관리',
    '/health': '💪 Health', '/devlog': '🛠️ Devlog', '/knowledge': '📓 Knowledge', '/career': '📋 이력/경력', '/automation': '🤖 Automation', '/integrations': '🔗 Integrations',
    '/stocks': '📈 증권', '/analytics': '📊 리포트', '/programs': '🧩 프로그램', '/settings': '⚙️ 설정', '/usage': '📊 사용량',
  };
  const menuForTable = (t) => TABLE_MENU[t] || '기타';
  const menuForOwner = (t) => OWNER_MENU[t] || '📎 첨부(기타)';
  const menuForRoute = (hash) => ROUTE_MENU[String(hash || '').replace(/^#/, '').split('?')[0]] || '🏠 홈/기타';

  /** Supabase 요청 URL → { kind, name } (rest/rpc/storage/auth/functions/realtime/other) */
  function classifyUrl(url) {
    let path = '';
    try { path = new URL(url, 'https://x.invalid').pathname; } catch { path = String(url); }
    let m = /\/rest\/v1\/rpc\/([^/?]+)/.exec(path); if (m) return { kind: 'rpc', name: `rpc:${m[1]}` };
    m = /\/rest\/v1\/([^/?]+)/.exec(path); if (m) return { kind: 'rest', name: m[1] };
    if (/\/storage\/v1\//.test(path)) return { kind: 'storage', name: 'storage' };
    if (/\/auth\/v1\//.test(path)) return { kind: 'auth', name: 'auth' };
    m = /\/functions\/v1\/([^/?]+)/.exec(path); if (m) return { kind: 'functions', name: `fn:${m[1]}` };
    return { kind: 'other', name: 'other' };
  }

  // ---- 이그레스 기록(날짜별) ----
  const EGRESS_KEY = 'workspace:usage:egress';
  const KEEP_DAYS = 62;
  let mem = null; let timer = null;
  const dayKey = (d = new Date()) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  function load() {
    if (mem) return mem;
    try { const v = JSON.parse(G.localStorage.getItem(EGRESS_KEY) || 'null'); if (v && v.days) { mem = v; return mem; } } catch { /* 손상 → 새로 */ }
    mem = { v: 1, since: dayKey(), days: {} };
    return mem;
  }
  function flush() {
    timer = null;
    try {
      const d = load();
      const keys = Object.keys(d.days).sort();
      for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete d.days[k];
      G.localStorage.setItem(EGRESS_KEY, JSON.stringify(d));
    } catch { /* 저장소 불가 — 메모리에만 */ }
  }
  /** 응답 하나를 기록한다. menu는 호출 시점 화면(라우트) 기준. */
  function record({ url, bytes, menu, now = new Date() }) {
    if (!(bytes >= 0)) return;
    const c = classifyUrl(url);
    const d = load();
    const day = d.days[dayKey(now)] || (d.days[dayKey(now)] = { b: 0, n: 0, t: {}, m: {}, k: {} });
    day.b += bytes; day.n += 1;
    day.t[c.name] = (day.t[c.name] || 0) + bytes;
    const mn = menu || '🏠 홈/기타';
    day.m[mn] = (day.m[mn] || 0) + bytes;
    day.k[c.kind] = (day.k[c.kind] || 0) + 1;
    if (!timer) timer = setTimeout(flush, 3000);
  }
  /** 기간 합계: ym='YYYY-MM'(해당 월) 또는 days=N(최근 N일, 오늘 포함). */
  function summarize({ ym = null, days = null, now = new Date() } = {}) {
    const d = load();
    const out = { bytes: 0, requests: 0, byTable: {}, byMenu: {}, byKind: {}, byDay: [] };
    const keys = Object.keys(d.days).sort();
    let lo = null;
    if (days) { const x = new Date(now); x.setDate(x.getDate() - (days - 1)); lo = dayKey(x); }
    for (const k of keys) {
      if (ym && !k.startsWith(ym)) continue;
      if (lo && k < lo) continue;
      const v = d.days[k];
      out.bytes += v.b; out.requests += v.n; out.byDay.push([k, v.b]);
      for (const [t, b] of Object.entries(v.t)) out.byTable[t] = (out.byTable[t] || 0) + b;
      for (const [t, b] of Object.entries(v.m)) out.byMenu[t] = (out.byMenu[t] || 0) + b;
      for (const [t, b] of Object.entries(v.k || {})) out.byKind[t] = (out.byKind[t] || 0) + b;
    }
    return out;
  }
  /** 테이블별 전송량을 메뉴로 묶는다(rest 테이블만; rpc/auth/storage는 그 이름 그대로). */
  function egressByTableMenu(byTable) {
    const out = {};
    for (const [name, b] of Object.entries(byTable || {})) {
      const m = name.startsWith('rpc:') ? '🔧 RPC' : name === 'auth' ? '🔐 로그인/인증' : name === 'storage' ? '📦 Storage' : name.startsWith('fn:') ? '⚡ Edge Function' : menuForTable(name);
      out[m] = (out[m] || 0) + b;
    }
    return out;
  }
  /** DB 크기를 메뉴별로(첨부 base64는 attachments 합계 대신 owner_table 메뉴로 나눠 담는다). */
  function dbByMenu(stats) {
    const out = {};
    const add = (m, b) => { out[m] = (out[m] || 0) + b; };
    let attached = 0;
    for (const a of stats.attachments_by_owner || []) { add(`${menuForOwner(a.owner_table)} · 첨부파일`, Number(a.bytes) || 0); attached += Number(a.bytes) || 0; }
    for (const t of stats.tables || []) {
      let b = Number(t.bytes) || 0;
      if (t.name === 'attachments') b = Math.max(0, b - attached); // 테이블 총량에서 첨부 본문 합계를 빼고 나머지(인덱스 등)만 attachments로
      add(menuForTable(t.name), b);
    }
    return out;
  }

  // ---- 직접 입력(Supabase 대시보드 값) ----
  const MANUAL_KEY = 'workspace:usage:manual';
  function getManual() {
    try { const v = JSON.parse(G.settingsSync.get(MANUAL_KEY) || 'null'); if (v && typeof v === 'object') return { values: v.values || {}, limits: v.limits || {} }; } catch { /* 손상 → 비움 */ }
    return { values: {}, limits: {} };
  }
  function setManual(m) { G.settingsSync.set(MANUAL_KEY, JSON.stringify({ values: m.values || {}, limits: m.limits || {} })); }

  const UNIT = { bytes: [['GB', GB], ['MB', MB], ['KB', 1024], ['B', 1]], count: [['', 1]] };
  function fmtValue(v, unit) {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return '-';
    v = Number(v);
    if (unit === 'count') return Math.round(v).toLocaleString('ko-KR');
    for (const [u, f] of UNIT.bytes) if (v >= f || u === 'B') return `${(v / f).toFixed(v / f >= 100 || u === 'B' ? 0 : v / f >= 10 ? 1 : 2)} ${u}`;
    return String(v);
  }
  /** 단위 입력 → 바이트. "1.5GB", "300 MB", "12" (기본 MB) */
  function parseBytes(text, defaultUnit = 'MB') {
    const m = /^\s*([\d.,]+)\s*(gb|g|mb|m|kb|k|b)?\s*$/i.exec(String(text || ''));
    if (!m) return null;
    const n = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(n) || n < 0) return null;
    const u = (m[2] || defaultUnit).toLowerCase()[0];
    return Math.round(n * ({ g: GB, m: MB, k: 1024, b: 1 }[u]));
  }
  const level = (pct) => (pct === null ? 'none' : pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok');

  // ---- fetch 래퍼(앱 전체에서 Supabase로 가는 응답 크기를 센다) ----
  function install() {
    if (typeof G.fetch !== 'function' || G.__usageFetchInstalled || !G.CONFIG || G.CONFIG.mode !== 'supabase') return;
    let host = null;
    try { host = new URL(G.CONFIG.supabaseUrl).host; } catch { return; }
    const orig = G.fetch.bind(G);
    G.__usageFetchInstalled = true;
    G.fetch = async function (input, init) {
      const res = await orig(input, init);
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || String(input);
        if (url.includes(host)) {
          const menu = menuForRoute(G.location && G.location.hash);
          const cl = res.headers.get('content-length');
          if (cl && Number(cl) >= 0) record({ url, bytes: Number(cl), menu });
          else res.clone().arrayBuffer().then((b) => record({ url, bytes: b.byteLength, menu })).catch(() => {});
        }
      } catch { /* 측정 실패는 앱 동작에 영향 없음 */ }
      return res;
    };
  }
  function reset() { mem = { v: 1, since: dayKey(), days: {} }; flush(); }

  G.UsageService = { METRICS, TABLE_MENU, OWNER_MENU, menuForTable, menuForOwner, menuForRoute, classifyUrl, record, summarize, egressByTableMenu, dbByMenu, getManual, setManual, fmtValue, parseBytes, level, install, reset, dayKey, flushNow: flush, _since: () => load().since };
  install();
})();
