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

  function parseKeywords(text) {
    return (text || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  window.fetchFeedItems = fetchFeedItems;
  window.itemMatchesTopic = itemMatchesTopic;
  window.simpleHash = simpleHash;
  window.parseKeywords = parseKeywords;
  window.parseMarkdownLinks = parseMarkdownLinks;
})();
