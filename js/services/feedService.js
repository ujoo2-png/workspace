// 관심주제 브리핑용 RSS 수집 서비스.
// 실제 운영(Supabase 모드)에서는 개발계획서대로 pg_cron → Edge Function이 서버에서
// 수집하지만, 이 앱은 서버 함수 없이도 바로 써볼 수 있도록 브라우저에서 공개 CORS
// 프록시(rss2json.com)를 통해 RSS를 직접 가져오는 방식을 쓴다. 키가 필요 없고,
// 실패해도(네트워크 차단 등) 조용히 에러를 던져 호출부에서 토스트로만 알린다.
// 일반 <script>로 로드된다.
(function () {
  // ---- RSS/Atom 수집 (v7.24.0 개편) ----
  // 기존에는 무료 공개 프록시(rss2json.com) 하나에만 의존했다. 그런데:
  //   · rss2json은 etnews 등 일부 피드에서 HTTP 500("This feed is being processed")을 반환하고,
  //     하루 호출 한도가 있어 전체 수집이 실패하기 일쑤였다.
  //   · 폴백으로 쓰던 corsproxy.io는 2024년부터 API 키를 요구(HTTP 401)해 사실상 죽었다.
  // 그래서 "같은 출처(Vercel) 서버리스 프록시(/api/custom-proxy)로 원본 XML을 받아 직접 파싱"하는
  // 경로를 1순위로 두고, 그게 없는 환경(로컬 file:// 등)에서만 공개 프록시로 폴백한다.
  // XML 파싱은 DOMParser 대신 js/utils/xmlTree.js의 무손실 파서를 쓴다(Node 테스트에서도 동작).
  const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const decodeXml = (s) => (window.XmlTree ? window.XmlTree.decode(s) : String(s || ''));

  /** 같은 출처 프록시로 원본 XML 텍스트를 받는다. 프록시가 없으면(404) null. */
  async function fetchViaOwnProxy(url) {
    const res = await fetch(`/api/custom-proxy?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(12000) });
    if (res.status === 404) return null; // 로컬 데모 등 프록시 미배포 환경
    if (!res.ok) throw new Error(`프록시 응답 오류(HTTP ${res.status})`);
    return await res.text();
  }

  /** 공개 프록시(rss2json)로 JSON을 받는다. 자체 프록시가 없는 환경의 폴백. */
  async function fetchViaRss2Json(url) {
    const res = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`RSS 변환 서버 오류(HTTP ${res.status})`);
    const data = await res.json();
    if (data.status !== 'ok') throw new Error(data.message || '피드 형식을 읽을 수 없습니다.');
    return (data.items || []).map((it) => ({
      title: it.title || '(제목 없음)',
      link: it.link,
      publishedAt: it.pubDate || null,
      summary: stripTags(it.description).slice(0, 300),
    }));
  }

  /** RSS 2.0(<item>) / Atom(<entry>) XML을 {title,link,publishedAt,summary}[] 로 파싱한다. */
  function parseFeedXml(xml) {
    const XT = window.XmlTree;
    if (!XT) throw new Error('XML 파서를 불러오지 못했습니다.');
    const root = XT.parse(String(xml || ''));
    const text = (node, name) => { const c = XT.firstChild(node, name); return c ? XT.textOf(c).trim() : ''; };
    const linkOf = (node) => {
      const direct = text(node, 'link');
      if (direct) return direct;
      // Atom: <link href="..."/> — rel="alternate"를 우선한다.
      const links = XT.childEls(node, 'link');
      const alt = links.find((l) => (XT.getAttr(l, 'rel') || 'alternate') === 'alternate') || links[0];
      return alt ? XT.getAttr(alt, 'href') || '' : '';
    };
    const nodes = [...XT.descendants(root, 'item'), ...XT.descendants(root, 'entry')];
    const items = [];
    for (const node of nodes) {
      const title = decodeXml(text(node, 'title')) || '(제목 없음)';
      const link = linkOf(node);
      if (!link) continue;
      // RSS는 pubDate, Atom은 published/updated.
      const publishedAt = text(node, 'pubDate') || text(node, 'published') || text(node, 'updated') || text(node, 'dc:date') || null;
      // RSS는 description, Atom은 summary/content.
      const raw = text(node, 'description') || text(node, 'summary') || text(node, 'content') || text(node, 'content:encoded') || '';
      items.push({ title, link, publishedAt, summary: stripTags(decodeXml(raw)).slice(0, 300) });
    }
    return items;
  }

  async function fetchFeedItems(feedUrl) {
    const attemptErrors = [];
    // 1) 자체 프록시 + 직접 XML 파싱 (가장 안정적)
    try {
      const xml = await fetchViaOwnProxy(feedUrl);
      if (xml === null) throw Object.assign(new Error('프록시 미배포'), { noProxy: true });
      const items = parseFeedXml(xml);
      if (!items.length) throw new Error('피드에서 항목을 찾지 못했습니다.');
      return items;
    } catch (e) {
      attemptErrors.push(`자체 프록시: ${e.message}`);
      // 프록시 자체가 없는 환경이면 공개 프록시로 넘어간다. 그 밖의 오류(파싱 실패 등)도
      // 공개 프록시가 성공할 수 있으므로 계속 시도한다.
    }
    // 2) 공개 변환 서비스(rss2json) 폴백
    try {
      return await fetchViaRss2Json(feedUrl);
    } catch (e) {
      attemptErrors.push(`RSS 변환 서비스: ${e.message}`);
    }
    throw new Error(attemptErrors.join(' / '));
  }

  // 포함 키워드 중 하나라도 매치 + 제외 키워드는 전부 없어야 함. 포함 키워드가 없으면 전부 통과.
  function itemMatchesTopic(item, topic) {
    const text = `${item.title} ${item.summary}`.toLowerCase();
    const include = (topic.include_keywords || []).filter(Boolean);
    const exclude = (topic.exclude_keywords || []).filter(Boolean);
    if (exclude.some((k) => text.includes(k.toLowerCase()))) return false;
    if (!include.length) return true;
    return include.some((k) => text.includes(k.toLowerCase()));
  }

  // 제목+링크 정규화 해시 — briefing_items.item_hash 로 (user_id, item_hash) 중복 방지에 사용.
  function simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h << 5) - h + str.charCodeAt(i);
      h |= 0;
    }
    return String(h >>> 0);
  }

  // ---- 피드 소스 건강 상태 (v7.24.0, 아이디어 5) ----
  // "마지막 수집일"이 생겼으니, 오래 실패한 소스를 사용자에게 먼저 알려준다.
  // 순수 함수라 테스트할 수 있고, 브리핑 화면과 홈 카드가 함께 쓴다.
  /** @returns {{level:'error'|'empty'|'stale'|'ok', days:number|null, reason:string}} */
  function sourceHealth(source, { now = new Date(), staleDays = 7 } = {}) {
    const s = source || {};
    const lastAt = s.last_run_at ? new Date(s.last_run_at) : null;
    const validLast = lastAt && !Number.isNaN(lastAt.getTime()) ? lastAt : null;
    const days = validLast ? Math.floor((now.getTime() - validLast.getTime()) / 86400000) : null;
    if (!validLast) return { level: 'stale', days: null, reason: '아직 한 번도 수집하지 않았습니다' };
    if (s.last_result === 'error') return { level: 'error', days, reason: `${days}일 전 마지막 수집이 실패했습니다` };
    if (s.last_result === 'empty') return { level: 'empty', days, reason: `${days}일 전 수집에서 새 항목을 찾지 못했습니다` };
    if (days >= staleDays) return { level: 'stale', days, reason: `${days}일째 수집하지 않았습니다` };
    return { level: 'ok', days, reason: '정상' };
  }

  /** 경고가 필요한 소스인지(정상이 아닌 경우). */
  function isStaleSource(source, staleDays = 7) {
    return sourceHealth(source, { staleDays }).level !== 'ok';
  }

  /** 경고 사유 문장. */
  function staleReason(source, staleDays = 7) {
    return sourceHealth(source, { staleDays }).reason;
  }

  // 마크다운 텍스트(붙여넣기/업로드)에서 링크가 있는 항목만 추출한다. RSS가 없는 사이트의 글
  // 목록을 마크다운으로 정리해두고 그 안에서 관심주제와 맞는 링크만 브리핑으로 가져오고 싶을 때 쓴다.
  // fetchFeedItems()와 동일한 { title, link, publishedAt, summary } 형태를 반환해
  // collectBriefingItems()의 주제 매칭/중복 제거 로직을 그대로 재사용할 수 있게 한다.
  //
  // v7.24.0 개편: 예전 구현은 "한 줄 안의 [제목](http…)"만 잡아서, 실제로 흔한
  //   · 제목이 여러 줄에 걸친 링크      [제목\n계속](url)
  //   · 참조형 링크                    [제목][1]  …  [1]: https://…
  //   · bare URL                       https://example.com/a
  //   · HTML 앵커                      <a href="https://…">제목</a>
  //   · 여는 괄호 앞뒤 공백            [제목]( https://… )
  //   · 제목 안의 대괄호               [2024 [특집] 기사](url)
  // 같은 입력을 조용히 0건으로 버렸다. 이제 (1) 참조 정의를 먼저 모아 두고, (2) 전체 텍스트를
  // 한 번에 스캔하며 위 형태를 모두 인식한다. 중복 링크는 한 번만 담는다.
  function parseMarkdownLinks(markdownText) {
    const text = String(markdownText || '');
    // (1) 참조형 링크 정의 수집: [라벨]: https://url  ("라벨"은 대소문자 무시)
    const refs = new Map();
    for (const m of text.matchAll(/^[ \t]*\[([^\]]+)\]:[ \t]*<?(https?:\/\/[^\s>]+)>?/gm)) {
      refs.set(m[1].trim().toLowerCase(), m[2].trim());
    }

    const items = [];
    const seen = new Set();
    const push = (title, link, context) => {
      const cleanLink = String(link || '').trim().replace(/[.,;:)\]]+$/, ''); // 문장부호로 끝나는 URL 정리
      const cleanTitle = stripTags(decodeXml(title)).replace(/\s+/g, ' ').trim();
      if (!cleanLink || !/^https?:\/\//i.test(cleanLink) || !cleanTitle) return;
      if (seen.has(cleanLink)) return;
      seen.add(cleanLink);
      items.push({ title: cleanTitle, link: cleanLink, publishedAt: null, summary: stripTags(context).slice(0, 300) || null });
    };

    // 줄 앞뒤 문맥(summary)을 얻기 위해 각 매치가 속한 줄을 찾는다.
    const lineAt = (index) => {
      const start = text.lastIndexOf('\n', index) + 1;
      const end = text.indexOf('\n', index);
      return text.slice(start, end === -1 ? text.length : end).replace(/\[([^\]]+)\]\([^)]*\)/g, '').trim();
    };

    // (2a) 인라인 링크: [제목](url) — 제목/URL 안의 대괄호·괄호·줄바꿈까지 허용.
    //      제목은 "대괄호 중첩"을 고려해 여는 '['부터 짝이 맞는 ']'까지 찾는다.
    const inlineRe = /\[([^\]\n]*(?:\[[^\]\n]*\][^\]\n]*)*)\]\(\s*<?(https?:\/\/[^\s)>]+)>?\s*\)/g;
    for (const m of text.matchAll(inlineRe)) push(m[1], m[2], lineAt(m.index));

    // (2b) 참조형 링크: [제목][라벨] 또는 [라벨][] (라벨 생략 시 제목을 라벨로).
    for (const m of text.matchAll(/\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
      const label = (m[2] || m[1]).trim().toLowerCase();
      const url = refs.get(label);
      if (url) push(m[1], url, lineAt(m.index));
    }

    // (2c) HTML 앵커: <a href="url" …>제목</a>
    for (const m of text.matchAll(/<a\b[^>]*\bhref\s*=\s*["']?(https?:\/\/[^\s"'>]+)["']?[^>]*>([\s\S]*?)<\/a>/gi)) {
      push(m[2], m[1], lineAt(m.index));
    }

    // (2d) bare URL: 마크다운 링크 문법 없이 http(s) 주소만 있는 줄. 제목은 그 줄의 나머지 텍스트,
    //      없으면 도메인/경로의 마지막 조각을 쓴다.
    for (const m of text.matchAll(/(?<![(\[<"'])\b(https?:\/\/[^\s<>"'\])]+)/g)) {
      const raw = m[0];
      const rest = lineAt(m.index).replace(raw, '').trim();
      let title = rest;
      if (!title) {
        try {
          const u = new URL(raw);
          const seg = decodeURIComponent(u.pathname).split('/').filter(Boolean).pop() || u.hostname;
          title = seg.replace(/[-_]+/g, ' ').replace(/\.(html?|php|aspx?)$/i, '').trim() || u.hostname;
        } catch { title = raw; }
      }
      push(title, raw, rest);
    }

    return items;
  }


  // ---- 간편 브리핑 설정(v7.23.0): 주제 → 사이트 → 검색어 → 우선 검색어 → 제거할 단어 ----
  const MAX_TOPIC_FEEDS = 12; // 주제 하나가 한 번에 만드는 검색 주소 상한(무료 RSS 변환 서비스 호출량 보호)
  /** 줄바꿈/쉼표/세미콜론으로 나눠 공백 제거·중복 제거. */
  function splitList(text) {
    const seen = new Set();
    const out = [];
    for (const t of String(Array.isArray(text) ? text.join('\n') : text || '').split(/[\n,;]+/)) {
      const v = t.trim();
      if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); }
    }
    return out;
  }
  /**
   * 사이트 입력("etnews.com", "https://www.hankyung.com/economy", "https://x.com/feed.xml")을 정리한다.
   * RSS/Atom 주소로 보이면 isFeed=true(그대로 구독), 아니면 사이트 도메인 검색(site:)에 쓴다.
   * @returns {{input:string, host:string, url:string, isFeed:boolean}|null}
   */
  function parseSiteInput(input) {
    const raw = String(input || '').trim();
    if (!raw) return null;
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let u;
    try { u = new URL(withProto); } catch { return null; }
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null;
    const isFeed = /(^|[\/.])(rss|feed|atom)([\/.?]|$)|\.xml($|\?)/i.test(u.pathname + u.search);
    return { input: raw, host: u.hostname.replace(/^www\./i, ''), url: u.href, isFeed };
  }
  const quoteTerm = (t) => (/\s/.test(t) ? `"${t}"` : t);
  /** Google 뉴스 RSS 검색 주소. 사이트(host)를 주면 그 사이트 글만, 제거 단어는 -단어로 뺀다. */
  function googleNewsFeedUrl(query, host, excludes = []) {
    const q = [quoteTerm(String(query).trim()), host ? `site:${host}` : '', ...(excludes || []).map((x) => `-${quoteTerm(String(x).trim())}`)].filter(Boolean).join(' ');
    return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`;
  }
  /**
   * 주제 설정으로 "실제로 가져올 주소 목록"을 만든다. 주제 이름은 검색어가 없을 때만 검색어가 된다.
   *  - 사이트가 RSS 주소면 그대로 구독(kind 'feed')
   *  - 그 밖의 사이트/검색어 조합은 Google 뉴스 검색 RSS(kind 'news')
   * @returns {{label:string, url:string, kind:'feed'|'news'}[]}
   */
  function buildTopicFeeds(topic, { maxFeeds = MAX_TOPIC_FEEDS } = {}) {
    const terms = splitList(topic.search_terms);
    const excludes = splitList(topic.exclude_keywords);
    const sites = splitList(topic.site_urls).map(parseSiteInput).filter(Boolean);
    const feeds = [];
    const seen = new Set();
    const push = (f) => { if (!seen.has(f.url) && feeds.length < maxFeeds) { seen.add(f.url); feeds.push(f); } };
    for (const site of sites.filter((x) => x.isFeed)) push({ label: `${site.host} (RSS)`, url: site.url, kind: 'feed' });
    const searchSites = sites.filter((x) => !x.isFeed);
    const queryTerms = terms.length ? terms : (topic.name ? [String(topic.name).trim()] : []);
    for (const term of queryTerms) {
      if (searchSites.length) for (const site of searchSites) push({ label: `${term} · ${site.host}`, url: googleNewsFeedUrl(term, site.host, excludes), kind: 'news' });
      else push({ label: `${term} · 전체 뉴스`, url: googleNewsFeedUrl(term, null, excludes), kind: 'news' });
    }
    return feeds;
  }
  /** 제목/요약에 제거 단어가 들어 있으면 true. */
  function itemHasExcluded(item, topic) {
    const text = `${item.title || ''} ${item.summary || ''}`.toLowerCase();
    return splitList(topic.exclude_keywords).some((k) => text.includes(k.toLowerCase()));
  }
  /** 우선 검색어와 맞는 단어 목록(없으면 []). */
  function priorityHits(item, topic) {
    const text = `${item.title || ''} ${item.summary || ''}`.toLowerCase();
    return splitList(topic && topic.priority_keywords).filter((k) => text.includes(k.toLowerCase()));
  }
  /** Google 뉴스 제목 "기사 제목 - 매체명"에서 매체명을, 아니면 링크 도메인을 출처로 쓴다. */
  function deriveSourceLabel(item) {
    const m = String(item.title || '').match(/\s[-–—]\s([^-–—]{2,30})$/);
    if (m && /news\.google\./.test(String(item.link || ''))) return m[1].trim();
    try { return new URL(item.link).hostname.replace(/^www\./, ''); } catch { return ''; }
  }
  /**
   * 한 번에 붙여넣는 간단 양식을 읽는다.
   *   주제: 스마트팜 / 사이트: etnews.com, hankyung.com / 검색어: 스마트팜 정책 / 우선: 보조금 / 제외: 광고, 채용
   * 라벨은 한글·영문 모두 허용하고, 값은 쉼표나 줄바꿈으로 여러 개 입력할 수 있다.
   */
  function parseBriefingSpec(text) {
    const LABELS = { name: ['주제', '관심주제', '이름', 'topic', 'name'], site_urls: ['사이트', '사이트url', 'url', '주소', 'site', 'sites'], search_terms: ['검색어', '특정검색어', '키워드', 'search', 'keyword'], priority_keywords: ['우선', '우선검색어', 'priority'], exclude_keywords: ['제외', '제거', '제거할단어', '제외어', 'exclude'] };
    const keyOf = (label) => { const n = label.replace(/\s+/g, '').toLowerCase(); return Object.keys(LABELS).find((k) => LABELS[k].includes(n)) || null; };
    const out = { name: '', site_urls: [], search_terms: [], priority_keywords: [], exclude_keywords: [] };
    let cur = null;
    for (const line of String(text || '').split(/\r?\n/)) {
      const m = line.match(/^\s*[-*]?\s*([^:：]{1,12})\s*[:：]\s*(.*)$/);
      const k = m ? keyOf(m[1]) : null;
      if (k) { cur = k; const v = m[2]; if (k === 'name') out.name = v.trim(); else out[k].push(...splitList(v)); continue; }
      if (m && !m[2].startsWith('//')) { cur = null; continue; } // 모르는 "라벨: 값" 줄은 무시(https:// 같은 주소 줄은 이어진 값으로 취급)
      if (cur && line.trim() && cur !== 'name') out[cur].push(...splitList(line));
    }
    for (const k of ['site_urls', 'search_terms', 'priority_keywords', 'exclude_keywords']) out[k] = splitList(out[k]);
    return out;
  }
  /** parseBriefingSpec의 반대: 주제 설정을 같은 양식 텍스트로. */
  function briefingSpecToText(t) {
    const j = (a) => splitList(a).join(', ');
    return [`주제: ${t.name || ''}`, `사이트: ${j(t.site_urls)}`, `검색어: ${j(t.search_terms)}`, `우선: ${j(t.priority_keywords)}`, `제외: ${j(t.exclude_keywords)}`].join('\n');
  }

  function parseKeywords(text) {
    return (text || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  Object.assign(window, { MAX_TOPIC_FEEDS, splitList, parseSiteInput, googleNewsFeedUrl, buildTopicFeeds, itemHasExcluded, priorityHits, deriveSourceLabel, parseBriefingSpec, briefingSpecToText });
  window.fetchFeedItems = fetchFeedItems;
  window.itemMatchesTopic = itemMatchesTopic;
  window.simpleHash = simpleHash;
  window.sourceHealth = sourceHealth;
  window.isStaleSource = isStaleSource;
  window.staleReason = staleReason;
  window.parseKeywords = parseKeywords;
  window.parseMarkdownLinks = parseMarkdownLinks;
  window.parseFeedXml = parseFeedXml;
})();
