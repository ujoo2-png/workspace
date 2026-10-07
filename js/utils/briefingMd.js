// 브리핑 → 마크다운 다이제스트(v7.21.0). 순수 함수(DOM/네트워크 없음, Node 테스트 대상).
// 형식(관심주제 → 헤드라인 → 한 줄 요약 → 링크 → 태그)은 docs/briefing-proposals.md의 제안 1(Matcha식 "하루 한 파일")을 따른다.
(function () {
  const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  // 마크다운 링크 텍스트에서 깨지는 문자만 이스케이프한다.
  const mdText = (s) => String(s || '').replace(/[\[\]]/g, (c) => '\\' + c).replace(/\s+/g, ' ').trim();
  const tagOf = (name) => '#' + String(name || '기타').trim().replace(/\s+/g, '_');

  /**
   * @param {object[]} items briefing_items 행({title, link, summary, topic_id, source_id, published_at, is_read})
   * @param {{topics?:object[], sources?:object[], date?:string, onlyUnread?:boolean, summaryMax?:number}} opts
   */
  function briefingToMarkdown(items, opts = {}) {
    const { topics = [], sources = [], date = '', onlyUnread = false, summaryMax = 120 } = opts;
    const rows = (items || []).filter((i) => i && i.link && (!onlyUnread || !i.is_read));
    const topicName = (id) => (topics.find((t) => t.id === id) || {}).name || null;
    const sourceName = (id) => (sources.find((s) => s.id === id) || {}).name || '';
    const topicOf = (id) => topics.find((t) => t.id === id) || null;
    const hits = (it, t) => (window.priorityHits && t ? window.priorityHits(it, t) : []);
    const srcLabel = (it) => sourceName(it.source_id) || (window.deriveSourceLabel ? window.deriveSourceLabel(it) : '');
    const groups = new Map();
    for (const it of rows) {
      const t = topicOf(it.topic_id);
      const key = (t && t.name) || '기타';
      if (!groups.has(key)) groups.set(key, { topic: t, list: [] });
      groups.get(key).list.push(it);
    }
    // 주제는 우선순위(높은 순), 주제 안에서는 우선 검색어에 맞는 항목을 먼저, 그다음 최신순.
    const ordered = [...groups.entries()].sort((a, b) => ((b[1].topic && b[1].topic.priority) || 0) - ((a[1].topic && a[1].topic.priority) || 0));
    const out = ['---', `date: ${date}`, `items: ${rows.length}`, `topics: [${ordered.map((g) => g[0]).join(', ')}]`, 'type: briefing', '---', '', `# 관심주제 브리핑${date ? ' · ' + date : ''}`, ''];
    if (!rows.length) { out.push('_내보낼 항목이 없습니다._', ''); return out.join('\n'); }
    for (const [name, { topic, list }] of ordered) {
      const sorted = list.slice().sort((a, b) => (hits(b, topic).length ? 1 : 0) - (hits(a, topic).length ? 1 : 0) || String(b.published_at || '').localeCompare(String(a.published_at || '')));
      out.push(`## ${name} (${list.length})`, '');
      if (topic) {
        const j = (v) => (Array.isArray(v) ? v.filter(Boolean).join(', ') : '');
        const cond = [['검색어', j(topic.search_terms)], ['사이트', j(topic.site_urls)], ['⭐ 우선', j(topic.priority_keywords)], ['제외', j(topic.exclude_keywords)]].filter((x) => x[1]).map((x) => `${x[0]}: ${x[1]}`);
        if (cond.length) out.push(`> ${cond.join(' · ')}`, '');
      }
      for (const it of sorted) {
        const h = hits(it, topic);
        const meta = [srcLabel(it), it.published_at ? String(it.published_at).slice(0, 10) : ''].filter(Boolean).join(' · ');
        out.push(`- ${h.length ? '⭐ ' : ''}[${mdText(it.title)}](${it.link})${meta ? ` — ${meta}` : ''}`);
        const sum = clip(it.summary, summaryMax);
        if (sum) out.push(`  - ${sum}`);
        out.push(`  - ${tagOf(name)}${h.length ? ' ' + h.map(tagOf).join(' ') : ''}`);
      }
      out.push('');
    }
    return out.join('\n');
  }
  window.briefingToMarkdown = briefingToMarkdown;
})();
