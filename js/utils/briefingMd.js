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
    const groups = new Map();
    for (const it of rows) {
      const key = topicName(it.topic_id) || '기타';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    }
    const out = ['---', `date: ${date}`, `items: ${rows.length}`, `topics: [${[...groups.keys()].join(', ')}]`, 'type: briefing', '---', '', `# 관심주제 브리핑${date ? ' · ' + date : ''}`, ''];
    if (!rows.length) { out.push('_내보낼 항목이 없습니다._', ''); return out.join('\n'); }
    for (const [name, list] of groups) {
      out.push(`## ${name} (${list.length})`, '');
      for (const it of list) {
        const meta = [sourceName(it.source_id), it.published_at ? String(it.published_at).slice(0, 10) : ''].filter(Boolean).join(' · ');
        out.push(`- [${mdText(it.title)}](${it.link})${meta ? ` — ${meta}` : ''}`);
        const sum = clip(it.summary, summaryMax);
        if (sum) out.push(`  - ${sum}`);
        out.push(`  - ${tagOf(name)}`);
      }
      out.push('');
    }
    return out.join('\n');
  }
  window.briefingToMarkdown = briefingToMarkdown;
})();
