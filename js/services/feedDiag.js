// 피드/API 소스 관제 (v7.36.0) — 개발계획서 7장 "소스 모니터링"을 이 앱 구조에 맞춰 구현한다.
//   · 소스별 수집 이력(최근 20회)을 settingsSync('workspace:feed:diag')에 남긴다 → 7일 성공률 / 평균 응답시간 / 신선도.
//   · enabled(사용자 제어)와 상태 배지(시스템 판단)를 분리한다. 연결 실패(error)와 '연결은 되나 0건'(empty)을 구분한다.
//   · diagnose(): 오류 문구를 "무엇이 문제이고 어떻게 고칠지"로 바꿔 소스 카드 안에 보여 준다(규칙 기반 — AI 아님).
//   · adaptApiItems(): 공공데이터포털류 JSON/XML 응답에서 제목·링크·날짜·마감일을 뽑아 브리핑 항목으로 바꾼다.
// 일반 <script>, window.FeedDiag. 순수 로직 + settingsSync 읽기/쓰기만 사용(테스트 가능).
(function () {
  const KEY = 'workspace:feed:diag';
  const MAX_RUNS = 20;
  const DAY = 86400000;

  // ---------- 저장소 ----------
  function store() { return window.settingsSync || null; }
  function load() {
    try { const s = store(); const raw = s && s.get(KEY); const o = raw ? JSON.parse(raw) : {}; return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; }
  }
  function save(map) { try { const s = store(); if (s) s.set(KEY, JSON.stringify(map)); } catch (e) { /* 저장 실패는 수집을 막지 않는다 */ } }
  /** entry: {at, result:'success'|'error'|'empty', n, added, ms, error, attempts, newest, skipped, dup, failed} */
  function record(id, entry) {
    if (!id) return;
    const map = load();
    const arr = Array.isArray(map[id]) ? map[id] : [];
    arr.push({ at: new Date().toISOString(), ...entry });
    map[id] = arr.slice(-MAX_RUNS);
    save(map);
  }
  function history(id) { const a = load()[id]; return Array.isArray(a) ? a : []; }
  function prune(validIds) { const map = load(); let ch = false; for (const k of Object.keys(map)) if (!validIds.includes(k)) { delete map[k]; ch = true; } if (ch) save(map); }

  // ---------- 상태 계산 ----------
  /**
   * @returns {{state:'off'|'unrun'|'ok'|'unstable'|'error'|'empty'|'stale', label:string, cls:string, rate:{ok:number,total:number}|null, avgMs:number|null, last:object|null, newestAgeDays:number|null}}
   */
  function summary(source, hist, now) {
    const t = now || Date.now();
    const runs = hist || history(source.id);
    const last = runs[runs.length - 1] || null;
    const recent = runs.filter((r) => t - Date.parse(r.at) < 7 * DAY);
    const okN = recent.filter((r) => r.result === 'success').length;
    const rate = recent.length ? { ok: okN, total: recent.length } : null;
    const ms = recent.map((r) => r.ms).filter((x) => Number.isFinite(x));
    const avgMs = ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null;
    let newestAgeDays = null;
    if (last && last.newest) { const n = Date.parse(last.newest); if (!Number.isNaN(n)) newestAgeDays = Math.floor((t - n) / DAY); }
    const base = { rate, avgMs, last, newestAgeDays };
    // 이력이 없으면 DB에 남은 마지막 결과(last_result)로 대신한다.
    const lastResult = last ? last.result : (source.last_run_at ? source.last_result : null);
    if (source.enabled === false) return { state: 'off', label: '꺼짐', cls: '', ...base };
    if (!lastResult) return { state: 'unrun', label: '미실행', cls: '', ...base };
    if (lastResult === 'error' || lastResult === 'timeout') {
      // 직전 회차가 성공이었다면 일시 장애일 수 있어 '불안정', 연속 실패면 '오류'.
      const prevOk = runs.length > 1 && runs[runs.length - 2].result === 'success';
      return { state: prevOk ? 'unstable' : 'error', label: prevOk ? '불안정' : '오류', cls: prevOk ? 'nm-badge--warning' : 'nm-badge--danger', ...base };
    }
    if (lastResult === 'empty') {
      const lastThree = runs.slice(-3);
      const threeEmpty = lastThree.length === 3 && lastThree.every((r) => r.result === 'empty');
      return { state: 'empty', label: threeEmpty ? '0건 반복' : '불안정(0건)', cls: 'nm-badge--warning', ...base };
    }
    // 정상 응답이어도 최신 글이 너무 오래됐으면 "조용한 장애"(개발계획서 7장 신선도 검증)
    if (newestAgeDays !== null && newestAgeDays > 45) return { state: 'stale', label: `오래된 글(${newestAgeDays}일 전)`, cls: 'nm-badge--warning', ...base };
    return { state: 'ok', label: '정상', cls: 'nm-badge--success', ...base };
  }
  const needsAttention = (st) => ['error', 'unstable', 'empty', 'stale'].includes(st.state);

  // ---------- 진단 ----------
  /**
   * 오류 문구 + 소스 정보 → 사람이 읽을 원인/조치. fixes[]: {id, label, ...payload}. UI가 id로 동작을 연결한다.
   *  id: 'https' 주소를 https로 / 'discover' RSS 주소 찾기 / 'edit' 수정으로 이동 / 'md' 마크다운으로 붙여넣기 안내 /
   *      'kstartup' K-Startup 추천 URL 적용 / 'topic' 관심주제 키워드 점검 / 'retry' 다시 시도
   */
  function diagnose(source, entry) {
    const msg = String((entry && (entry.error || '')) || '');
    const out = { headline: '', why: '', tips: [], fixes: [] };
    const url = String(source.endpoint || '');
    const isApi = source.type === 'api';
    const has = (re) => re.test(msg);
    if (!entry) { out.headline = '아직 수집한 적이 없습니다'; out.why = '[테스트 수집]으로 이 소스가 바로 열리는지 확인해 보세요.'; out.fixes.push({ id: 'retry', label: '🔍 테스트 수집' }); return out; }
    if (isApi) {
      if (has(/등록된 API.*찾을 수 없|customapi/i)) { out.headline = '연결된 커스텀 API가 없습니다'; out.why = '설정 → 커스텀 API에서 지운 API를 가리키고 있습니다.'; out.fixes.push({ id: 'edit', label: '✎ API 다시 선택' }); return out; }
      if (has(/HTTP 400|HTTP 401|HTTP 403|SERVICE_KEY|serviceKey|인증/i)) {
        out.headline = 'API 요청이 거절되었습니다(주소 또는 인증키 문제)';
        out.why = '공공데이터포털 API는 "서비스 주소 + 오퍼레이션 경로 + 인증키"가 모두 맞아야 합니다. 서비스 이름까지만 있거나 {key}가 빠지면 400이 납니다.';
        out.tips.push('설정 → 커스텀 API의 요청 URL에 인증키 자리 {key}가 있고, 키가 입력되어 있는지 확인하세요.');
        out.tips.push('활용신청 승인 직후에는 반영까지 1~2시간 걸릴 수 있습니다. 403이면 해당 API의 "활용신청" 승인 여부를 확인하세요.');
      } else if (has(/내용이 비어|empty|0건/i)) { out.headline = 'API는 열렸지만 목록을 찾지 못했습니다'; out.why = '응답 구조가 달라 제목/링크 항목을 못 읽었을 수 있습니다. [테스트 수집]에서 응답의 첫 항목 필드 이름을 확인하세요.'; }
      else { out.headline = 'API 호출에 실패했습니다'; out.why = msg.slice(0, 200); }
      if (/kisedKstartupService01/i.test(url + msg) || /kisedKstartupService01/i.test(JSON.stringify(entry))) out.fixes.push({ id: 'kstartup', label: '✨ K-Startup 사업공고 추천 URL 적용' });
      out.fixes.push({ id: 'edit', label: '✎ 수정으로 이동' }, { id: 'retry', label: '🔄 다시 시도' });
      return out;
    }
    // RSS / 마크다운
    if (source.type === 'markdown') {
      out.headline = '마크다운에서 링크를 찾지 못했습니다';
      out.why = msg || '본문에 [제목](https://주소) 형식 또는 http(s) 주소가 없습니다.';
      out.fixes.push({ id: 'edit', label: '✎ 본문 수정으로 이동' });
      return out;
    }
    if (entry.result === 'empty' || has(/항목을 찾지 못/)) {
      if (has(/웹페이지|HTML/)) { out.headline = 'RSS가 아니라 일반 웹페이지 주소입니다'; out.why = '게시판/사이트 주소를 넣으면 RSS로 읽을 수 없습니다. 사이트가 RSS를 제공하면 그 주소를 찾아 드립니다.'; out.fixes.push({ id: 'discover', label: '🔎 RSS 주소 찾기' }); }
      else { out.headline = '연결은 되지만 글이 0건입니다'; out.why = 'RSS 주소가 맞는지, 사이트가 비어 있지 않은지 확인하세요. 주소를 브라우저로 열어 XML이 보이면 정상입니다.'; out.fixes.push({ id: 'discover', label: '🔎 RSS 주소 찾기' }); }
      out.fixes.push({ id: 'edit', label: '✎ 수정으로 이동' });
      return out;
    }
    if (has(/웹페이지|HTML/)) { out.headline = 'RSS가 아니라 일반 웹페이지 주소입니다'; out.why = '게시판/메인 주소가 아니라 "RSS 주소"를 넣어야 합니다.'; out.fixes.push({ id: 'discover', label: '🔎 RSS 주소 찾기' }, { id: 'edit', label: '✎ 수정으로 이동' }); return out; }
    if (has(/HTTP 403|HTTP 401|HTTP 406|HTTP 429/)) { out.headline = '사이트가 서버의 접근을 막았습니다(HTTP 403/429)'; out.why = '일부 언론사·기관은 해외/클라우드 서버의 자동 접속을 차단합니다. 브라우저에서는 열려도 이 앱의 서버 프록시는 막힐 수 있습니다.'; out.tips.push('같은 사이트의 다른 RSS 주소(분야별 주소)를 시도하거나, 기사 목록을 복사해 "마크다운 붙여넣기" 소스로 등록하세요.'); out.fixes.push({ id: 'discover', label: '🔎 다른 RSS 주소 찾기' }, { id: 'md', label: '📝 마크다운으로 등록하는 법' }, { id: 'edit', label: '✎ 수정으로 이동' }); return out; }
    if (has(/HTTP 404|HTTP 410/)) { out.headline = '주소가 없어졌거나 오타입니다(HTTP 404)'; out.why = 'RSS 주소가 바뀌었거나 폐지되었을 수 있습니다.'; out.fixes.push({ id: 'discover', label: '🔎 RSS 주소 찾기' }, { id: 'edit', label: '✎ 수정으로 이동' }); return out; }
    if (has(/HTTP 400.*(https|http)|이 주소는 프록시할 수 없습니다/)) { out.headline = '이 주소는 서버 프록시가 허용하지 않습니다'; out.why = msg.slice(0, 160); out.fixes.push({ id: 'edit', label: '✎ 수정으로 이동' }); return out; }
    if (has(/시간|timeout|Timeout|504|응답하지 않/)) { out.headline = '사이트가 제때 응답하지 않았습니다'; out.why = '일시적일 수 있습니다. 다시 시도해 보고, 반복되면 다른 RSS 주소를 쓰세요.'; out.fixes.push({ id: 'retry', label: '🔄 다시 시도' }, { id: 'edit', label: '✎ 수정으로 이동' }); return out; }
    if (has(/저장 실패/)) { out.headline = '가져오기는 됐지만 저장에 실패했습니다'; out.why = msg.slice(0, 200); out.tips.push('Supabase 테이블/제약 문제일 수 있습니다. 괄호 안 메시지를 알려 주세요.'); out.fixes.push({ id: 'retry', label: '🔄 다시 시도' }); return out; }
    if (entry.skipped && entry.n && entry.skipped >= entry.n && !entry.added) { out.headline = '글은 가져왔지만 관심주제와 맞지 않아 모두 제외되었습니다'; out.why = '관심주제의 포함 키워드가 좁거나 제외 키워드가 넓을 수 있습니다.'; out.fixes.push({ id: 'topic', label: '🏷 관심주제 키워드 점검' }); return out; }
    out.headline = '수집에 실패했습니다'; out.why = msg.slice(0, 220) || '원인을 알 수 없습니다.';
    if (/^http:\/\//i.test(url)) out.fixes.push({ id: 'https', label: '🔒 https 주소로 바꿔 보기' });
    out.fixes.push({ id: 'discover', label: '🔎 RSS 주소 찾기' }, { id: 'retry', label: '🔄 다시 시도' }, { id: 'edit', label: '✎ 수정으로 이동' });
    return out;
  }

  // ---------- API 응답 → 브리핑 항목 ----------
  const TITLE_KEYS = ['biz_pbanc_nm', 'pblancNm', 'pbanc_nm', 'title', 'subject', 'bbsSj', 'nttSj', 'sj', 'name', 'bsnsNm', '제목'];
  const LINK_KEYS = ['detl_pg_url', 'pblancUrl', 'link', 'url', 'linkUrl', 'detailUrl', 'originalUrl', 'dtlUrl', 'bsnsDtlUrl'];
  const SUMMARY_KEYS = ['pbanc_ctnt', 'bsnsSumryCn', 'description', 'summary', 'content', 'cn', 'ctnt', 'sumry'];
  const DATE_KEYS = ['pbanc_rcpt_bgng_dt', 'reqstBeginEndDe', 'pubDate', 'regDt', 'creatPnttm', 'rgsDt', 'date', 'ntceBgnDt'];
  const DEADLINE_KEYS = ['pbanc_rcpt_end_dt', 'reqstEndDe', 'deadline', 'endDt', 'ntceEndDt', 'rcptEndDt'];
  const stripTags = (s) => String(s == null ? '' : s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, ' ').replace(/\s+/g, ' ').trim();
  const pick = (o, keys) => { for (const k of keys) { const v = o[k]; if (v != null && String(v).trim() !== '') return String(v).trim(); } return ''; };

  /** 날짜 문자열("20261015", "2026-10-15", "2026.10.15 ~ 2026.11.01")에서 첫/마지막 날짜를 YYYY-MM-DD로. */
  function ymdAll(v) {
    const out = []; const re = /(\d{4})[.\-/]?(\d{2})[.\-/]?(\d{2})/g; let m;
    const s = String(v == null ? '' : v);
    while ((m = re.exec(s))) { const mo = +m[2], d = +m[3]; if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) out.push(`${m[1]}-${m[2]}-${m[3]}`); }
    return out;
  }
  /** 응답(JSON 객체/배열 또는 XML 문자열)에서 "객체 배열"을 찾는다. */
  function findRecords(data) {
    if (typeof data === 'string') return xmlRecords(data);
    let best = null;
    (function walk(n, depth) {
      if (depth > 6 || n == null) return;
      if (Array.isArray(n)) { if (n.length && n.every((x) => x && typeof x === 'object' && !Array.isArray(x))) { if (!best || n.length > best.length) best = n; } n.forEach((x) => walk(x, depth + 1)); return; }
      if (typeof n === 'object') Object.values(n).forEach((x) => walk(x, depth + 1));
    })(data, 0);
    return best || [];
  }
  function xmlRecords(xml) {
    const XT = window.XmlTree; if (!XT) return [];
    let root; try { root = XT.parse(xml); } catch (e) { return []; }
    const items = XT.descendants(root, 'item');
    const rows = items.length ? items : XT.descendants(root, 'row');
    return rows.map((n) => { const o = {}; for (const c of XT.childEls(n)) o[c.name] = XT.textOf(c).trim(); return o; });
  }
  /**
   * @returns {{items:{title,link,publishedAt,summary}[], sampleKeys:string[], total:number}}
   */
  function adaptApiItems(data, opts = {}) {
    const recs = findRecords(data);
    const sampleKeys = recs[0] ? Object.keys(recs[0]).slice(0, 40) : [];
    const items = [];
    for (const r of recs) {
      let title = stripTags(pick(r, TITLE_KEYS));
      if (!title) { // 이름 규칙으로 가장 그럴듯한 문자열 필드
        const k = Object.keys(r).find((x) => /(^|_)(nm|title|subject|sj)$/i.test(x) && typeof r[x] === 'string');
        if (k) title = stripTags(r[k]);
      }
      let link = pick(r, LINK_KEYS);
      if (!/^https?:\/\//i.test(link)) {
        const k = Object.keys(r).find((x) => /url|link/i.test(x) && /^https?:\/\//i.test(String(r[x])));
        link = k ? String(r[k]) : '';
      }
      if (!link && r.pbanc_sn && opts.kstartup !== false) link = `https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?schM=view&pbancSn=${encodeURIComponent(r.pbanc_sn)}`;
      if (!title || !/^https?:\/\//i.test(link)) continue;
      const dates = ymdAll(pick(r, DATE_KEYS));
      const published = dates[0] || null;
      // 기업마당처럼 "시작 ~ 끝" 한 칸이면 끝 날짜가 마감.
      const deadline = ymdAll(pick(r, DEADLINE_KEYS)).slice(-1)[0] || (dates.length > 1 ? dates[dates.length - 1] : null);
      const body = stripTags(pick(r, SUMMARY_KEYS)).slice(0, 240);
      const summary = `${deadline ? `마감 ${deadline}` : ''}${deadline && body ? ' · ' : ''}${body}`.slice(0, 300);
      items.push({ title: title.slice(0, 300), link, publishedAt: published ? `${published}T00:00:00+09:00` : null, summary });
    }
    return { items, sampleKeys, total: recs.length };
  }
  /** 요약에 "마감 YYYY-MM-DD"가 있으면 남은 일수를 돌려준다(없으면 null). 개발계획서 6-1 "마감임박" 표시용. */
  function deadlineInDays(summary, now) {
    const m = /마감\s*(\d{4}-\d{2}-\d{2})/.exec(String(summary || ''));
    if (!m) return null;
    const t = now ? new Date(now) : new Date();
    const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    const d = new Date(`${m[1]}T00:00:00`);
    return Math.round((d - today) / DAY);
  }
  /** K-Startup 사업공고 추천 요청 URL({key}는 설정 화면에서 입력한 인증키로 치환됨). */
  const KSTARTUP_URL = 'https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01?serviceKey={key}&page=1&perPage=50&returnType=json';

  window.FeedDiag = { KEY, load, record, history, prune, summary, needsAttention, diagnose, adaptApiItems, findRecords, deadlineInDays, ymdAll, KSTARTUP_URL };
})();
