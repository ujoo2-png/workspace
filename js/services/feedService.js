// 관심주제 브리핑용 RSS 수집 서비스.
// 실제 운영(Supabase 모드)에서는 개발계획서대로 pg_cron → Edge Function이 서버에서
// 수집하지만, 이 앱은 서버 함수 없이도 바로 써볼 수 있도록 브라우저에서 공개 CORS
// 프록시(rss2json.com)를 통해 RSS를 직접 가져오는 방식을 쓴다. 키가 필요 없고,
// 실패해도(네트워크 차단 등) 조용히 에러를 던져 호출부에서 토스트로만 알린다.
// 일반 <script>로 로드된다.
(function () {
  async function fetchFeedItems(feedUrl) {
    const api = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}`;
    const res = await fetch(api, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error('피드 서버 응답 오류');
    const data = await res.json();
    if (data.status !== 'ok') throw new Error(data.message || '피드 형식을 읽을 수 없습니다.');
    return (data.items || []).map((it) => ({
      title: it.title || '(제목 없음)',
      link: it.link,
      publishedAt: it.pubDate || null,
      summary: (it.description || '').replace(/<[^>]+>/g, '').slice(0, 300),
    }));
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

  // 마크다운 텍스트(붙여넣기/업로드)에서 링크가 있는 항목만 추출한다. RSS가 없는 사이트의 글
  // 목록을 마크다운으로 정리해두고 그 안에서 관심주제와 맞는 링크만 브리핑으로 가져오고 싶을 때 쓴다.
  // fetchFeedItems()와 동일한 { title, link, publishedAt, summary } 형태를 반환해
  // collectBriefingItems()의 주제 매칭/중복 제거 로직을 그대로 재사용할 수 있게 한다.
  function parseMarkdownLinks(markdownText) {
    const items = [];
    const lines = (markdownText || '').split(/\r?\n/);
    for (const line of lines) {
      // 매 줄마다 새 정규식 인스턴스를 만든다. 하나의 전역(global) 정규식 객체를 exec()과
      // replace() 양쪽에서 같이 쓰면 lastIndex 상태가 서로 꼬여 무한 루프에 빠질 수 있다
      // (실제로 발생했던 버그 — replace() 호출이 exec()의 lastIndex를 되돌려 같은 매치를 반복 탐지).
      const scanRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
      const matches = [...line.matchAll(scanRe)];
      if (!matches.length) continue;
      const strippedLine = line.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '').replace(/[#*_`>-]/g, '').trim();
      for (const m of matches) {
        const title = m[1].trim();
        const link = m[2].trim();
        if (!title || !link) continue;
        items.push({ title, link, publishedAt: null, summary: strippedLine.slice(0, 300) || null });
      }
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
  window.parseKeywords = parseKeywords;
  window.parseMarkdownLinks = parseMarkdownLinks;
})();
