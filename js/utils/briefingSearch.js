// 브리핑 목록 검색/필터 (v7.35.0). 순수 함수 — DOM/네트워크 없음(Node 테스트 대상).
//   · parseNaturalQuery: "지난주 스마트팜 안 읽은 뉴스" 같은 문장에서 기간·읽음·피드·주제·키워드를 뽑는다(규칙 기반, AI 아님).
//   · filterBriefingItems: 구조화된 조건(+자연어 해석 결과)으로 항목을 거르고 정렬한다.
// 일반 <script>로 로드되며 window에 붙인다.
(function () {
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
  const lower = (s) => String(s == null ? '' : s).toLowerCase();

  // 자연어에서 "검색어가 아닌" 군말. 너무 공격적으로 지우지 않도록 단어 단위로만 제거한다.
  const STOP = new Set(['뉴스', '기사', '글', '글들', '소식', '보여줘', '보여주세요', '찾아줘', '찾아줘요', '찾아', '검색', '알려줘', '알려주세요', '관련', '관한', '대한', '좀', '것', '거', '중', '중에서', '에서', '만', '들', '목록', '리스트', '해줘', '주세요', '있는', '된', '나온']);
  const DAYS_KO = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9, 십: 10 };

  /**
   * @param {string} q
   * @param {{now?:Date, sources?:object[], topics?:object[]}} ctx
   * @returns {{text:string[], exclude:string[], from:string|null, to:string|null, read:'all'|'unread'|'read', priority:boolean, sourceId:string, topicId:string, scope:''|'title'|'content', chips:string[]}}
   */
  function parseNaturalQuery(q, ctx = {}) {
    const now = ctx.now || new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const out = { text: [], exclude: [], from: null, to: null, read: 'all', priority: false, sourceId: '', topicId: '', scope: '', chips: [] };
    let s = String(q || '').trim();
    if (!s) return out;
    const chip = (t) => out.chips.push(t);
    const setRange = (a, b, label) => { out.from = ymd(a); out.to = ymd(b); chip(`📅 ${label}`); };
    const cut = (re, fn) => { const m = re.exec(s); if (!m) return false; s = (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)); fn(m); return true; };

    // 1) 필드 지정: 제목:xxx / 내용:xxx / 피드:xxx / 주제:xxx  (따옴표 "..." 허용)
    const fieldRe = /(제목|내용|피드|소스|주제)\s*[:：]\s*(?:"([^"]+)"|(\S+))/g;
    const fields = [];
    s = s.replace(fieldRe, (m, k, a, b) => { fields.push([k, (a || b || '').trim()]); return ' '; });
    for (const [k, v] of fields) {
      if (!v) continue;
      if (k === '제목') { out.text.push(v); out.scope = out.scope === 'content' ? '' : 'title'; chip(`제목: ${v}`); }
      else if (k === '내용') { out.text.push(v); out.scope = out.scope === 'title' ? '' : 'content'; chip(`내용: ${v}`); }
      else if (k === '주제') { const t = (ctx.topics || []).find((x) => lower(x.name).includes(lower(v))); if (t) { out.topicId = t.id; chip(`#${t.name}`); } else out.text.push(v); }
      else { const f = (ctx.sources || []).find((x) => lower(x.name).includes(lower(v))); if (f) { out.sourceId = f.id; chip(`피드: ${f.name}`); } else out.text.push(v); }
    }

    // 2) 기간 표현
    let matchedDate = false;
    matchedDate = cut(/오늘/, () => setRange(today, today, '오늘')) || matchedDate;
    if (!matchedDate) matchedDate = cut(/어제/, () => setRange(addDays(today, -1), addDays(today, -1), '어제'));
    if (!matchedDate) matchedDate = cut(/(그저께|그제|엊그제)/, () => setRange(addDays(today, -2), addDays(today, -2), '그저께'));
    if (!matchedDate) matchedDate = cut(/지난\s*주|저번\s*주|전주/, () => { const dow = (today.getDay() + 6) % 7; const mon = addDays(today, -dow - 7); setRange(mon, addDays(mon, 6), '지난주'); });
    if (!matchedDate) matchedDate = cut(/이번\s*주/, () => { const dow = (today.getDay() + 6) % 7; const mon = addDays(today, -dow); setRange(mon, today, '이번 주'); });
    if (!matchedDate) matchedDate = cut(/지난\s*달|저번\s*달|전월/, () => { const a = new Date(today.getFullYear(), today.getMonth() - 1, 1); setRange(a, new Date(today.getFullYear(), today.getMonth(), 0), '지난달'); });
    if (!matchedDate) matchedDate = cut(/이번\s*달|금월/, () => setRange(new Date(today.getFullYear(), today.getMonth(), 1), today, '이번 달'));
    if (!matchedDate) matchedDate = cut(/올해|금년/, () => setRange(new Date(today.getFullYear(), 0, 1), today, '올해'));
    if (!matchedDate) matchedDate = cut(/최근\s*(\d+)\s*(일|주|개월|달)|(\d+)\s*(일|주|개월|달)\s*(?:이내|안|동안|간|전부터)/, (m) => {
      const n = Number(m[1] || m[3]); const u = m[2] || m[4];
      const days = u === '일' ? n : u === '주' ? n * 7 : n * 30;
      setRange(addDays(today, -days), today, `최근 ${n}${u}`);
    });
    if (!matchedDate) matchedDate = cut(/최근\s*(일주일|한\s*주|1주일|한달|한\s*달|일개월)/, (m) => {
      const week = /주/.test(m[1]); setRange(addDays(today, week ? -7 : -30), today, week ? '최근 1주일' : '최근 1개월');
    });
    if (!matchedDate) matchedDate = cut(/최근|요즘|근래/, () => setRange(addDays(today, -7), today, '최근 7일'));
    // 명시 날짜: 2026-11-09 / 2026.11.09 / 11월 9일 / 11/9 (단일일)
    if (!matchedDate) matchedDate = cut(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/, (m) => { const d = new Date(+m[1], +m[2] - 1, +m[3]); setRange(d, d, `${ymd(d)}`); });
    if (!matchedDate) matchedDate = cut(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/, (m) => { const d = new Date(today.getFullYear(), +m[1] - 1, +m[2]); setRange(d, d, `${m[1]}월 ${m[2]}일`); });

    // 3) 읽음 / 우선
    if (cut(/안\s*읽은|읽지\s*않은|미확인|새\s*글/, () => { out.read = 'unread'; chip('📬 안 읽음'); })) { /* done */ }
    else if (cut(/읽은\s*것|읽은\s*글|읽은\s*기사|이미\s*읽은/, () => { out.read = 'read'; chip('📭 읽음'); })) { /* done */ }
    cut(/(?:^|\s)(?:우선|중요|⭐)(?=\s|$)|⭐/, () => { out.priority = true; chip('⭐ 우선만'); });

    // 4) 피드/주제 이름이 문장에 그대로 들어 있으면 조건으로 승격(긴 이름 먼저)
    const byLen = (a, b) => String(b.name).length - String(a.name).length;
    if (!out.sourceId) for (const src of (ctx.sources || []).slice().sort(byLen)) {
      const nm = String(src.name || '').trim();
      if (nm.length >= 2 && lower(s).includes(lower(nm))) { out.sourceId = src.id; s = s.replace(new RegExp(nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' '); chip(`피드: ${nm}`); break; }
    }
    // (주제 이름은 조건으로 승격하지 않는다: 검색어로 남겨 두면 제목·요약·주제명 어디든 걸리고, 정확히 주제로 거르려면 "주제:이름" 또는 주제 선택 상자를 쓴다.)

    // 5) 남은 말 → 키워드. "구문", -제외어, 군말 제거
    const phrases = [];
    s = s.replace(/"([^"]+)"/g, (m, p) => { phrases.push(p.trim()); return ' '; });
    for (const tok of s.split(/\s+/).filter(Boolean)) {
      if (/^-[^\s-]/.test(tok)) { out.exclude.push(tok.slice(1)); continue; }
      const bare = tok.replace(/(을|를|이|가|은|는|의|에|에서|도|만|로|으로)$/, (m) => (tok.length - m.length >= 2 ? '' : m));
      if (STOP.has(tok) || STOP.has(bare)) continue;
      out.text.push(tok);
    }
    out.text.push(...phrases.filter(Boolean));
    out.text = out.text.filter(Boolean);
    if (out.exclude.length) chip(`제외: ${out.exclude.join(', ')}`);
    return out;
  }

  const itemDate = (it, field) => {
    const raw = field === 'collected' ? (it.created_at || it.published_at) : (it.published_at || it.created_at);
    const t = Date.parse(raw || '');
    return Number.isNaN(t) ? null : new Date(t);
  };

  /**
   * @param {object[]} items briefing_items
   * @param {{text?:string[], exclude?:string[], scope?:string, from?:string, to?:string, dateField?:'published'|'collected', sourceId?:string, topicId?:string, read?:string, priority?:boolean, sort?:string}} f
   * @param {{sources?:object[], topics?:object[], priorityFn?:(item:object, topic:object|null)=>string[]}} ctx
   * sourceId: '' 전체 | 'topic' 주제 간편검색으로 모은 것(source_id 없음) | 'md' 마크다운 소스 전체 | 소스 id
   */
  function filterBriefingItems(items, f = {}, ctx = {}) {
    const sources = ctx.sources || []; const topics = ctx.topics || [];
    const srcById = new Map(sources.map((s) => [s.id, s])); const topicById = new Map(topics.map((t) => [t.id, t]));
    const terms = (f.text || []).map(lower).filter(Boolean);
    const excl = (f.exclude || []).map(lower).filter(Boolean);
    const scope = f.scope || 'all';
    const field = f.dateField || 'published';
    const prio = (it) => (ctx.priorityFn ? ctx.priorityFn(it, topicById.get(it.topic_id) || null) : []);
    const rows = (items || []).filter((it) => {
      if (!it) return false;
      if (f.read === 'unread' && it.is_read) return false;
      if (f.read === 'read' && !it.is_read) return false;
      if (f.topicId && it.topic_id !== f.topicId) return false;
      if (f.sourceId) {
        if (f.sourceId === 'topic') { if (it.source_id) return false; }
        else if (f.sourceId === 'md') { const s = srcById.get(it.source_id); if (!s || s.type !== 'markdown') return false; }
        else if (f.sourceId === 'rss') { const s = srcById.get(it.source_id); if (!s || s.type === 'markdown') return false; }
        else if (it.source_id !== f.sourceId) return false;
      }
      if (f.from || f.to) {
        const d = itemDate(it, field);
        if (!d) return false;
        const k = ymd(d);
        if (f.from && k < f.from) return false;
        if (f.to && k > f.to) return false;
      }
      if (f.priority && !prio(it).length) return false;
      if (terms.length || excl.length) {
        const title = lower(it.title); const body = lower(it.summary);
        const src = srcById.get(it.source_id); const tp = topicById.get(it.topic_id);
        const hay = scope === 'title' ? title : scope === 'content' ? body : `${title} ${body} ${lower(src && src.name)} ${lower(tp && tp.name)}`;
        if (terms.some((t) => !hay.includes(t))) return false; // 모든 검색어(AND)
        if (excl.some((t) => hay.includes(t))) return false;
      }
      return true;
    });
    const ts = (it) => { const d = itemDate(it, field); return d ? d.getTime() : 0; };
    const sort = f.sort || 'recent';
    if (sort === 'old') rows.sort((a, b) => ts(a) - ts(b));
    else if (sort === 'title') rows.sort((a, b) => String(a.title).localeCompare(String(b.title), 'ko'));
    else if (sort === 'priority') rows.sort((a, b) => (prio(b).length - prio(a).length) || (ts(b) - ts(a)));
    else rows.sort((a, b) => ts(b) - ts(a));
    return rows;
  }

  /** 수동 조건과 자연어 해석 결과를 합친다: 수동으로 지정한 값이 있으면 그것이 우선. */
  function mergeFilters(manual, parsed) {
    const m = manual || {}; const p = parsed || {};
    return {
      text: [...(m.text || []), ...(p.text || [])],
      exclude: [...(m.exclude || []), ...(p.exclude || [])],
      scope: m.scope && m.scope !== 'all' ? m.scope : (p.scope || 'all'),
      from: m.from || p.from || '', to: m.to || p.to || '',
      dateField: m.dateField || 'published',
      sourceId: m.sourceId || p.sourceId || '', topicId: m.topicId || p.topicId || '',
      read: m.read && m.read !== 'all' ? m.read : (p.read || 'all'),
      priority: !!(m.priority || p.priority),
      sort: m.sort || 'recent',
    };
  }

  window.parseNaturalQuery = parseNaturalQuery;
  window.filterBriefingItems = filterBriefingItems;
  window.mergeBriefingFilters = mergeFilters;
})();
