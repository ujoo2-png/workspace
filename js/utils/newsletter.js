// 일일 브리핑 뉴스레터(v7.29.0). 순수 함수 — DOM/네트워크 없음(Node 테스트 대상).
// 수집된 항목을 규칙으로 정리한다(AI 요약 아님): 제목·링크·매체·날짜·우선 키워드만 사용.
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeHref = (u) => { try { const x = new URL(String(u || '')); return /^https?:$/.test(x.protocol) ? x.href : '#'; } catch { return '#'; } };
  const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const ts = (it) => { const t = Date.parse(it.published_at || ''); return Number.isNaN(t) ? 0 : t; };
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  function dateLabel(d) { return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`; }

  /**
   * @param {object[]} items briefing_items
   * @param {{topics?:object[], sources?:object[], schedules?:object[], now?:Date, hours?:number, perTopic?:number}} o
   * hours: 최근 N시간 항목만(기본 48). 없으면 가장 최근 항목으로 대체.
   */
  function buildNewsletterModel(items, o = {}) {
    const { topics = [], sources = [], schedules = [], now = new Date(), hours = 48, perTopic = 5 } = o;
    const hitsFn = (it, t) => (window.priorityHits && t ? window.priorityHits(it, t) : []);
    const srcOf = (it) => (sources.find((s) => s.id === it.source_id) || {}).name || (window.deriveSourceLabel ? window.deriveSourceLabel(it) : '');
    let rows = (items || []).filter((i) => i && i.link && i.title);
    const cutoff = now.getTime() - hours * 3600e3;
    const recent = rows.filter((i) => ts(i) >= cutoff);
    rows = recent.length ? recent : rows.slice().sort((a, b) => ts(b) - ts(a)).slice(0, 30);
    const seen = new Set();
    const norm = rows.map((it) => {
      const t = topics.find((x) => x.id === it.topic_id) || null;
      return { it, topic: t, hits: hitsFn(it, t), src: srcOf(it) };
    }).filter((r) => { const k = r.it.link; if (seen.has(k)) return false; seen.add(k); return true; });
    const order = (a, b) => (b.hits.length - a.hits.length) || (ts(b.it) - ts(a.it));
    const groups = new Map();
    for (const r of norm) {
      const name = (r.topic && r.topic.name) || '기타';
      if (!groups.has(name)) groups.set(name, { name, priority: (r.topic && r.topic.priority) || 0, list: [] });
      groups.get(name).list.push(r);
    }
    const sections = [...groups.values()].sort((a, b) => b.priority - a.priority || b.list.length - a.list.length)
      .map((g) => ({ name: g.name, total: g.list.length, items: g.list.sort(order).slice(0, perTopic).map((r) => ({ title: r.it.title, link: r.it.link, summary: clip(r.it.summary, 140), source: r.src, date: r.it.published_at || '', hits: r.hits })) }));
    const all = norm.slice().sort(order);
    const lead = all[0] ? { title: all[0].it.title, link: all[0].it.link, topic: (all[0].topic && all[0].topic.name) || '기타', source: all[0].src, summary: clip(all[0].it.summary, 200) } : null;
    const today = now.toLocaleDateString('sv-SE');
    const upcoming = (schedules || []).filter((s) => s && !s.done && s.date && s.date >= today).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''))).slice(0, 6)
      .map((s) => ({ date: s.date, time: s.time || '', title: s.title || '' }));
    const prio = norm.filter((r) => r.hits.length).length;
    return {
      date: dateLabel(now), lead,
      kpis: [{ label: '전체 항목', value: norm.length }, { label: '관심주제', value: sections.length }, { label: '⭐ 우선', value: prio }, { label: '안 읽음', value: norm.filter((r) => !r.it.is_read).length }],
      core: sections.filter((s) => s.items.length).map((s) => ({ topic: s.name, headline: s.items[0].title, link: s.items[0].link, count: s.total })),
      sections, upcoming,
    };
  }

  function newsletterToHtml(m) {
    const a = (u, t) => `<a href="${esc(safeHref(u))}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>`;
    const out = [`<article class="nl">`, `<header class="nl-mast"><div class="nl-brand">나만의 Work Space</div><div class="nl-date">${esc(m.date)}</div><h1>일일 브리핑</h1></header>`];
    if (m.lead) out.push(`<section class="nl-lead"><span class="nl-tag">${esc(m.lead.topic)}</span><h2>${a(m.lead.link, m.lead.title)}</h2>${m.lead.summary ? `<p>${esc(m.lead.summary)}</p>` : ''}<small>${esc(m.lead.source)}</small></section>`);
    out.push(`<section class="nl-kpis">${m.kpis.map((k) => `<div class="nl-kpi"><b>${esc(k.value)}</b><span>${esc(k.label)}</span></div>`).join('')}</section>`);
    if (m.core.length) out.push(`<section><h3>오늘의 핵심</h3><table class="nl-core"><thead><tr><th>구분</th><th>핵심 기사</th><th>건수</th></tr></thead><tbody>${m.core.map((c) => `<tr><td><span class="nl-tag">${esc(c.topic)}</span></td><td>${a(c.link, c.headline)}</td><td>${esc(c.count)}</td></tr>`).join('')}</tbody></table></section>`);
    for (const s of m.sections) {
      out.push(`<section class="nl-sec"><h3>${esc(s.name)} <small>${esc(s.total)}건</small></h3><div class="nl-cards">${s.items.map((i) => `<div class="nl-card">${i.hits.length ? '<span class="nl-star">⭐ 우선</span>' : ''}<h4>${a(i.link, i.title)}</h4>${i.summary ? `<p>${esc(i.summary)}</p>` : ''}<small>${esc(i.source)}${i.date ? ' · ' + esc(new Date(i.date).toLocaleDateString('ko-KR')) : ''}</small></div>`).join('')}</div></section>`);
    }
    if (m.upcoming.length) out.push(`<section><h3>다가오는 내 일정</h3><ul class="nl-sched">${m.upcoming.map((s) => `<li><b>${esc(s.date)}${s.time ? ' ' + esc(s.time) : ''}</b> ${esc(s.title)}</li>`).join('')}</ul></section>`);
    out.push(`<footer class="nl-foot">수집된 기사 제목·링크를 규칙으로 정리한 자동 브리핑입니다. 내용은 원문에서 확인하세요.</footer></article>`);
    return out.join('');
  }
  window.buildNewsletterModel = buildNewsletterModel;
  window.newsletterToHtml = newsletterToHtml;
})();
