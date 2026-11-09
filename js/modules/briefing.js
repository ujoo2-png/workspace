// 관심주제 브리핑 화면. 주제(키워드)와 RSS 피드 소스를 등록해두면 "지금 가져오기"로
// 새 글을 모아 보여준다. 실 서비스(Supabase 모드)에서는 pg_cron + Edge Function이 매일
// 자동 수집하지만(개발계획서 9장), 이 MVP는 브라우저에서 직접 수집하는 수동 트리거로 대체했다.
// 일반 <script>로 로드된다.
(function () {
  const { appState, el, escapeHtml, toast, confirmDialog, openModal, parseKeywords, nmField, todayISO } = window;

  function renderBriefing(root) {
    const container = el('div', {});
    root.append(container);
    let tab = 'news'; // news | items | topics | sources
    let collecting = false;
    let lastReport = null; // 가장 최근 수집 결과(소스별) — [수집 결과] 버튼으로 다시 볼 수 있다
    // 브리핑 목록 일괄 선택 상태(v7.24.0). 항목 id 집합으로 관리해 화면을 다시 그려도 유지된다.
    const selectedIds = new Set();
    // v7.35.0 브리핑 목록 검색 조건(화면을 다시 그려도 유지)
    const flt = { q: '', scope: 'all', from: '', to: '', dateField: 'published', sourceId: '', topicId: '', read: 'all', priority: false, sort: 'priority', focusSearch: false };

    function draw() {
      container.innerHTML = '';
      container.append(
        el('div', { class: 'page-header' }, [
          el('h1', {}, '관심주제 브리핑'),
          el('div', { class: 'row', style: 'gap:8px' }, [
            lastReport ? el('button', { class: 'nm-btn brf-report-btn', title: '소스별로 몇 건을 가져와 몇 건을 저장했는지, 안 된 이유를 봅니다', onclick: () => openCollectReport(lastReport) }, '📋 수집 결과') : null,
            el('button', { class: 'nm-btn', onclick: () => openTopicWizard() }, '🪄 마법사'),
          el(
            'button',
            { class: 'nm-btn nm-btn--primary', onclick: collectNow, disabled: collecting || undefined },
            collecting ? '수집 중…' : '🔄 지금 가져오기'
          ),
          ]),
        ])
      );

      container.append(
        el('div', { class: 'row wrap', style: 'margin-bottom:14px' }, [
          tabBtn('news', '📰 뉴스레터'),
          tabBtn('items', '브리핑 목록'),
          tabBtn('topics', `관심주제 (${appState.briefingTopics.length}/10)`),
          tabBtn('sources', '피드 소스'),
        ])
      );

      if (tab === 'news') drawNews();
      else if (tab === 'items') drawItems();
      else if (tab === 'topics') drawTopics();
      else drawSources();
    }

    function tabBtn(key, label) {
      const active = tab === key;
      return el('button', { class: `nm-btn ${active ? 'nm-btn--primary' : ''}`, onclick: () => { tab = key; draw(); } }, label);
    }

    async function collectNow() {
      if (!appState.feedSources.length && !appState.briefingTopics.some((t) => t.active !== false && ((t.search_terms || []).length || (t.site_urls || []).length))) {
        toast('먼저 관심주제 마법사로 주제를 등록하거나 피드 소스를 등록해주세요.', 'error');
        tab = 'topics';
        draw();
        return;
      }
      collecting = true;
      draw();
      try {
        const result = await appState.collectBriefingItems();
        lastReport = result;
        if (result.errors.length) {
          toast(`${result.newCount}건 새로 수집, 일부 소스 문제 ${result.errors.length}건 — [수집 결과]에서 원인을 확인하세요.`, 'error');
        } else {
          toast(`${result.newCount}건을 새로 수집했습니다. (전체 ${result.fetchedCount}건 확인)`, 'success');
        }
        // 새로 저장된 게 없거나 문제가 있으면 이유를 바로 보여 준다(예전에는 토스트 한 줄이라 원인을 알 수 없었다).
        if (result.errors.length || !result.newCount) openCollectReport(result);
      } catch (e) {
        toast(e.message || '수집 중 오류가 발생했습니다.', 'error');
      } finally {
        collecting = false;
        draw();
      }
    }

    // v7.35.0: 소스별 수집 결과 — "왜 안 들어왔는지"를 사용자가 직접 볼 수 있게 한다.
    function openCollectReport(result) {
      const reasons = (r) => {
        if (r.error) return `❌ ${r.error}`;
        const bits = [];
        if (r.failed) bits.push(`⚠ 저장 실패 ${r.failed}건${r.firstFailure ? ` (${r.firstFailure})` : ''}`);
        if (r.skippedTopic) bits.push(`관심주제와 안 맞아 제외 ${r.skippedTopic}건`);
        if (r.dup) bits.push(`이미 있음 ${r.dup}건`);
        if (!r.fetched) bits.push('가져온 글 0건');
        return bits.join(' · ') || '정상';
      };
      openModal({
        title: '📋 수집 결과', width: '760px',
        contentBuilder(body) {
          const rep = result.report || [];
          body.append(el('p', { class: 'text-muted', style: 'font-size:13px' }, `새로 저장 ${result.newCount}건 · 확인한 글 ${result.fetchedCount}건 · 소스 ${rep.length}곳`));
          if (!rep.length) { body.append(el('div', { class: 'empty-state' }, '수집할 소스가 없습니다.')); return; }
          const table = el('table', { class: 'data-table brf-report' });
          table.append(el('thead', {}, el('tr', {}, ['소스', '종류', '가져옴', '새로 저장', '결과/원인'].map((h) => el('th', {}, h)))));
          const tb = el('tbody', {});
          for (const r of rep) tb.append(el('tr', { class: r.error || r.failed ? 'brf-report--bad' : '' }, [
            el('td', {}, r.name), el('td', {}, { md: '📝 마크다운', feed: '📡 RSS', topic: '🔎 주제 검색' }[r.kind] || r.kind),
            el('td', {}, String(r.fetched)), el('td', {}, String(r.added)), el('td', { style: 'font-size:12px' }, reasons(r)),
          ]));
          table.append(tb);
          body.append(el('div', { class: 'data-table-wrap' }, table));
          const tips = [];
          if (rep.some((r) => r.skippedTopic && !r.added)) tips.push('관심주제의 "포함 키워드"가 좁으면 대부분 제외됩니다. 주제의 포함 키워드를 줄이거나 비워 보세요.');
          if (rep.some((r) => r.error && /HTTP 4\d\d|프록시|403/.test(r.error))) tips.push('사이트가 접근을 막은 경우입니다(403 등). 다른 RSS 주소를 쓰거나 마크다운 소스로 붙여넣어 보세요.');
          if (rep.some((r) => r.failed)) tips.push('저장 실패가 있으면 Supabase 테이블/제약 문제일 수 있습니다. 위 괄호의 메시지를 알려 주세요.');
          if (tips.length) body.append(el('ul', { class: 'text-muted', style: 'font-size:12px; margin-top:8px' }, tips.map((t) => el('li', {}, t))));
        },
      });
    }

    function drawNews() {
      const model = window.buildNewsletterModel(appState.briefingItems, { topics: appState.briefingTopics, sources: appState.feedSources, schedules: appState.schedules });
      const html = window.newsletterToHtml(model);
      if (!appState.briefingItems.length) {
        container.append(el('div', { class: 'empty-state' }, '아직 수집된 항목이 없습니다. 관심주제를 등록하고 "지금 가져오기"를 누르면 뉴스레터가 만들어집니다.'));
        return;
      }
      container.append(el('div', { class: 'row wrap', style: 'margin-bottom:10px; gap:8px' }, [
        el('button', { class: 'nm-btn', onclick: () => window.print() }, '🖨 인쇄/PDF'),
        el('button', { class: 'nm-btn', onclick: async () => {
          let css = ''; try { css = await (await fetch('css/modules/newsletter.css')).text(); } catch { /* 스타일 없이 저장 */ }
          const doc = `<!doctype html><meta charset="utf-8"><title>일일 브리핑</title><style>body{font-family:sans-serif;background:#f4f4f4;padding:16px;color:#14213D}.nl{background:#fff}${css}</style>${html}`;
          const a = el('a', { href: URL.createObjectURL(new Blob([doc], { type: 'text/html;charset=utf-8' })), download: `briefing-${new Date().toLocaleDateString('sv-SE')}.html` });
          document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        } }, '⬇ HTML 저장'),
      ]));
      container.append(el('div', { html }));
    }

    // ---- v7.35.0 브리핑 목록 검색 ----
    // 자연어 한 줄("지난주 스마트팜 안 읽은 뉴스") + 세부 조건(범위·날짜·피드·주제·읽음·우선·정렬). 규칙 기반이라 AI가 아니며,
    // 어떻게 해석했는지 칩으로 그대로 보여준다. 내용 검색은 수집 때 저장한 요약(최대 300자)만 대상이다.
    function drawItemFilters(parsed, shown) {
      const redraw = () => draw();
      const q = el('input', { class: 'nm-input brf-q', type: 'search', value: flt.q, placeholder: '검색: 예) 지난주 스마트팜 안 읽은 뉴스 · 제목:보조금 · "정밀 농업" -광고', style: 'flex:1 1 320px; min-width:220px' });
      let timer = null;
      q.addEventListener('input', () => { flt.q = q.value; flt.focusSearch = true; clearTimeout(timer); timer = setTimeout(redraw, 250); });
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); flt.q = q.value; flt.focusSearch = true; redraw(); } });
      const sel = (cls, key, opts, title) => el('select', { class: `nm-select ${cls}`, title, style: 'width:auto', onchange: (e) => { flt[key] = e.target.value; redraw(); } },
        opts.map(([v, l]) => el('option', { value: v, selected: flt[key] === v || undefined }, l)));
      const feedOpts = [['', '피드: 전체'], ['topic', '🔎 주제 검색(마법사)'], ['rss', '📡 RSS 전체'], ['md', '📝 마크다운 전체'], ['api', '🏛 공공 API 전체'],
        ...appState.feedSources.map((s) => [s.id, `${s.type === 'markdown' ? '📝' : s.type === 'api' ? '🏛' : '📡'} ${s.name}`])];
      const topicOpts = [['', '주제: 전체'], ...appState.briefingTopics.map((t) => [t.id, `#${t.name}`])];
      const date = (key, label) => el('label', { class: 'row', style: 'gap:4px; align-items:center; font-size:12px' }, [label, el('input', { class: `nm-input brf-${key}`, type: 'date', value: flt[key], style: 'width:auto', onchange: (e) => { flt[key] = e.target.value; redraw(); } })]);
      const active = flt.q || flt.from || flt.to || flt.sourceId || flt.topicId || flt.read !== 'all' || flt.priority || flt.scope !== 'all';
      container.append(el('div', { class: 'nm-card brf-filters', style: 'padding:10px; margin-bottom:10px' }, [
        el('div', { class: 'row wrap', style: 'gap:8px; align-items:center' }, [
          q,
          sel('brf-scope', 'scope', [['all', '범위: 제목+요약'], ['title', '제목만'], ['content', '내용(요약)만']], '검색할 곳'),
        ]),
        el('div', { class: 'row wrap', style: 'gap:8px; align-items:center; margin-top:8px' }, [
          sel('brf-datefield', 'dateField', [['published', '날짜 기준: 발행일'], ['collected', '날짜 기준: 수집일']], '기간 조건에 쓸 날짜'),
          date('from', '부터'), date('to', '까지'),
          sel('brf-feed', 'sourceId', feedOpts, '피드 구분'),
          sel('brf-topic', 'topicId', topicOpts, '관심주제'),
          sel('brf-read', 'read', [['all', '읽음: 전체'], ['unread', '안 읽음'], ['read', '읽음']], '읽음 상태'),
          el('label', { class: 'row', style: 'gap:4px; align-items:center; font-size:12px' }, [el('input', { class: 'brf-prio', type: 'checkbox', checked: flt.priority || undefined, onchange: (e) => { flt.priority = e.target.checked; redraw(); } }), '⭐ 우선만']),
          sel('brf-sort', 'sort', [['priority', '정렬: 우선→최신'], ['recent', '최신순'], ['old', '오래된순'], ['title', '제목순']], '정렬'),
          active ? el('button', { class: 'nm-btn brf-reset', onclick: () => { Object.assign(flt, { q: '', scope: 'all', from: '', to: '', dateField: 'published', sourceId: '', topicId: '', read: 'all', priority: false, sort: 'priority' }); redraw(); } }, '초기화') : null,
        ]),
        el('div', { class: 'text-muted brf-summary', style: 'font-size:12px; margin-top:6px' }, [
          `${shown}건 / 전체 ${appState.briefingItems.length}건`,
          parsed.chips.length ? ` · 이렇게 이해했어요: ${parsed.chips.join(' · ')}` : '',
          parsed.text.length ? ` · 검색어: ${parsed.text.map((t) => `"${t}"`).join(' + ')}` : '',
        ]),
      ]));
      if (flt.focusSearch) { flt.focusSearch = false; q.focus(); try { q.setSelectionRange(q.value.length, q.value.length); } catch (e) { /* noop */ } }
    }

    function drawItems() {
      const topicById = (id) => appState.briefingTopics.find((t) => t.id === id);
      const hitsOf = (it) => window.priorityHits(it, topicById(it.topic_id));
      if (!appState.briefingItems.length) {
        container.append(el('div', { class: 'empty-state' }, '아직 수집된 항목이 없습니다. 관심주제·피드 소스를 등록한 뒤 "지금 가져오기"를 눌러보세요.'));
        return;
      }
      // 검색 모듈(js/utils/briefingSearch.js)이 배포에서 빠졌어도 목록 자체는 보이게 한다(검색만 비활성).
      const searchOk = ['parseNaturalQuery', 'filterBriefingItems', 'mergeBriefingFilters'].every((k) => typeof window[k] === 'function');
      if (!searchOk) container.append(el('div', { class: 'nm-banner nm-banner--warning', style: 'margin-bottom:10px' }, '⚠ 검색 모듈(js/utils/briefingSearch.js)을 불러오지 못했습니다. 배포에서 파일이 빠졌습니다 — 목록만 표시합니다.'));
      const ctx = { sources: appState.feedSources, topics: appState.briefingTopics, priorityFn: (it, t) => window.priorityHits(it, t) };
      const parsed = searchOk ? window.parseNaturalQuery(flt.q, ctx) : { text: [], exclude: [], chips: [] };
      const eff = searchOk ? window.mergeBriefingFilters({ ...flt, text: [], exclude: [] }, parsed) : null;
      const rows = searchOk ? window.filterBriefingItems(appState.briefingItems, eff, ctx) : appState.briefingItems.slice();
      if (searchOk) drawItemFilters(parsed, rows.length);
      if (!rows.length) {
        container.append(el('div', { class: 'empty-state' }, '조건에 맞는 항목이 없습니다. 검색어를 줄이거나 [초기화]를 눌러 보세요.'));
        return;
      }
      const buildMd = (onlyUnread) => window.briefingToMarkdown(rows, { topics: appState.briefingTopics, sources: appState.feedSources, date: new Date().toLocaleDateString('sv-SE'), onlyUnread });
      // 선택 상태는 id 집합으로 관리한다(화면을 다시 그려도 유지). 현재 목록에 없는 id는 자동 정리된다.
      const visibleIds = new Set(rows.map((r) => r.id));
      for (const id of [...selectedIds]) if (!visibleIds.has(id)) selectedIds.delete(id);
      const selectedRows = () => rows.filter((r) => selectedIds.has(r.id));

      container.append(el('div', { class: 'row wrap', style: 'margin-bottom:10px; gap:8px' }, [
        el('button', { class: 'nm-btn', title: '안 읽은 항목을 관심주제별 마크다운으로 복사', onclick: async () => {
          try { await navigator.clipboard.writeText(buildMd(true)); toast('안 읽은 항목을 마크다운으로 복사했습니다.', 'success'); }
          catch { toast('복사하지 못했습니다. ".md 저장"을 사용해 주세요.', 'error'); }
        } }, '📋 마크다운 복사'),
        el('button', { class: 'nm-btn', title: '전체 목록을 .md 파일로 저장', onclick: () => {
          const a = el('a', { href: URL.createObjectURL(new Blob([buildMd(false)], { type: 'text/markdown;charset=utf-8' })), download: `briefing-${new Date().toLocaleDateString('sv-SE')}.md` });
          document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        } }, '⬇ .md 저장'),
      ]));

      // 선택 도구모음 — 하나라도 선택하면 나타난다. 일괄 읽음/선택 Knowledge 스크랩/일괄 삭제를 제공한다.
      const toolbar = el('div', { class: 'row wrap', style: 'margin-bottom:10px; gap:8px; align-items:center' });
      function refreshToolbar() {
        toolbar.innerHTML = '';
        const picked = selectedRows();
        if (!picked.length) return;
        toolbar.append(
          el('span', { class: 'text-muted', style: 'font-size:13px' }, `${picked.length}개 선택됨`),
          el('button', { class: 'nm-btn', title: '선택한 항목을 읽음 처리', onclick: async () => {
            await bulkAction(picked, (it) => appState.markBriefingItemRead(it.id));
            toast(`${picked.length}개를 읽음 처리했습니다.`, 'success');
          } }, '✓ 읽음 처리'),
          el('button', { class: 'nm-btn', title: '선택한 항목을 Knowledge 문서로 한꺼번에 스크랩', onclick: async () => {
            await bulkScrapToKnowledge(picked);
          } }, '📌 Knowledge로'),
          el('button', { class: 'nm-btn nm-btn--danger', title: '선택한 항목을 삭제', onclick: async () => {
            if (!confirmDialog(`선택한 ${picked.length}개 항목을 삭제할까요?`)) return;
            await bulkAction(picked, (it) => appState.deleteBriefingItem(it.id));
            toast(`${picked.length}개를 삭제했습니다.`, 'success');
          } }, '🗑 선택 삭제'),
          el('button', { class: 'nm-btn', title: '선택 해제', onclick: () => { selectedIds.clear(); draw(); } }, '선택 해제'),
        );
      }

      // 개별 일괄 처리는 refreshAll()이 매 건마다 화면을 다시 그리므로(그리고 그 과정에서
      // selectedIds가 정리되므로) 순차 처리 후 마지막에 한 번 더 그린다.
      async function bulkAction(picked, fn) {
        const ids = picked.map((p) => p.id);
        for (const it of picked) await fn(it);
        for (const id of ids) selectedIds.delete(id);
        draw();
      }
      async function bulkScrapToKnowledge(picked) {
        let ok = 0;
        for (const it of picked) {
          const topic = topicById(it.topic_id);
          try {
            await appState.addKnowledgeDoc({ title: it.title, url: it.link, tags: topic ? [topic.name] : [], memo: it.summary || null });
            ok++;
          } catch (e) {
            toast(`"${it.title}" 스크랩 실패: ${e.message || e}`, 'error');
          }
        }
        for (const it of picked) selectedIds.delete(it.id);
        toast(`${ok}개를 Knowledge에 스크랩했습니다.`, 'success');
        draw();
      }

      // 전체 선택 체크박스(헤더) + 개별 선택 체크박스.
      const allChecked = rows.length > 0 && selectedIds.size === rows.length;
      const headCheck = el('input', { type: 'checkbox', checked: allChecked || undefined, title: '전체 선택' });
      headCheck.addEventListener('change', () => {
        if (headCheck.checked) for (const r of rows) selectedIds.add(r.id);
        else selectedIds.clear();
        draw();
      });
      container.append(el('div', { class: 'row', style: 'gap:8px; align-items:center; margin-bottom:6px' }, [headCheck, el('span', { class: 'text-muted', style: 'font-size:12px' }, '전체 선택')]));
      container.append(toolbar);
      refreshToolbar();

      const list = el('div', { class: 'item-list' });
      for (const item of rows) {
        const topic = appState.briefingTopics.find((t) => t.id === item.topic_id);
        const source = appState.feedSources.find((s) => s.id === item.source_id);
        const check = el('input', { type: 'checkbox', checked: selectedIds.has(item.id) || undefined, title: '선택' });
        check.addEventListener('change', () => {
          if (check.checked) selectedIds.add(item.id);
          else selectedIds.delete(item.id);
          refreshToolbar();
          // 전체 선택 체크박스 상태도 함께 갱신한다.
          headCheck.checked = selectedIds.size === rows.length && rows.length > 0;
        });
        list.append(
          el('div', { class: `item-row ${item.is_read ? 'item-row--done' : 'item-row--unread'}` }, [
            el('div', { style: 'display:flex; align-items:center; padding-right:8px' }, check),
            el('div', { class: 'item-row__main' }, [
              el('div', { class: 'item-row__title' }, [
                !item.is_read ? el('span', { class: 'unread-dot', title: '안 읽음' }) : null,
                (() => { const dd = window.FeedDiag ? window.FeedDiag.deadlineInDays(item.summary) : null; return dd !== null && dd >= 0 && dd <= 3 ? el('span', { class: 'nm-badge nm-badge--danger', style: 'margin-right:6px' }, dd === 0 ? '오늘 마감' : `D-${dd}`) : null; })(),
                hitsOf(item).length ? el('span', { class: 'nm-badge nm-badge--warning', title: `우선 검색어: ${hitsOf(item).join(', ')}`, style: 'margin-right:6px' }, '⭐ 우선') : null,
                el('a', { href: item.link, target: '_blank', rel: 'noopener', onclick: () => !item.is_read && appState.markBriefingItemRead(item.id) }, item.title),
              ]),
              el(
                'div',
                { class: 'item-row__meta' },
                `${source && source.type === 'api' ? '🏛 ' : source && source.type === 'markdown' ? '📝 ' : '📡 '}${topic ? '#' + topic.name + ' · ' : ''}${source ? source.name : window.deriveSourceLabel(item)}${item.published_at ? ' · ' + new Date(item.published_at).toLocaleDateString('ko-KR') : ''}`
              ),
              item.summary ? el('div', { class: 'text-muted', style: 'font-size:12px; margin-top:4px' }, item.summary) : null,
            ]),
            !item.is_read ? el('button', { class: 'nm-btn nm-btn--icon', title: '읽음 처리', onclick: () => appState.markBriefingItemRead(item.id) }, '✓') : null,
            el('button', { class: 'nm-btn nm-btn--icon', title: 'Knowledge에 스크랩', onclick: () => scrapToKnowledge(item, topic) }, '📌'),
            // v7.24.0(아이디어 2): 기사에서 바로 "일정 잡기" / "프로젝트 참고자료로 붙이기".
            el('button', { class: 'nm-btn nm-btn--icon', title: '일정으로 만들기', onclick: () => openItemToSchedule(item, topic) }, '📅'),
            el('button', { class: 'nm-btn nm-btn--icon', title: '프로젝트에 참고자료로 붙이기', onclick: () => openItemToProject(item, topic) }, '📁'),
            el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: () => appState.deleteBriefingItem(item.id) }, '🗑'),
          ])
        );
      }
      container.append(list);
    }

    // 브리핑 항목 → 일정 만들기 (아이디어 2). 제목·날짜·시간·메모를 기본값으로 채워 주고,
    // 저장하면 원문 링크를 메모에 남긴다. 저장 후 "읽음 처리"까지 해 목록을 깔끔하게 유지한다.
    function openItemToSchedule(item, topic) {
      openModal({
        title: '브리핑 항목 → 일정',
        width: '460px',
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          form.append(
            nmField('제목', el('input', { class: 'nm-input', name: 'title', required: true, value: item.title })),
            nmField('날짜', el('input', { class: 'nm-input', name: 'date', type: 'date', required: true, value: todayISO() })),
            nmField('시간 (선택)', el('input', { class: 'nm-input', name: 'time', type: 'time' })),
            nmField('분류', (() => {
              const sel = el('select', { class: 'nm-select', name: 'category' });
              for (const [v, l] of [['personal', '개인'], ['work', '회사'], ['family', '가족'], ['task', '업무'], ['etc', '기타']]) sel.append(el('option', { value: v, selected: v === 'personal' || undefined }, l));
              return sel;
            })()),
            nmField('메모', el('textarea', { class: 'nm-textarea', name: 'memo', rows: 3 }, `${topic ? '#' + topic.name + '\n' : ''}${item.link}`)),
            el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '일정 등록')
          );
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            try {
              await appState.addSchedule({
                title: String(fd.get('title')).trim(),
                date: fd.get('date'),
                time: fd.get('time') || null,
                category: fd.get('category'),
                memo: fd.get('memo') || null,
                source: 'briefing',
              });
              if (!item.is_read) await appState.markBriefingItemRead(item.id);
              toast('일정으로 등록했습니다.', 'success');
              close();
            } catch (err) { toast(`등록 실패: ${err.message || err}`, 'error'); }
          });
          body.append(form);
        },
      });
    }

    // 브리핑 항목 → 프로젝트 참고자료 (아이디어 2). 프로젝트의 knowledge를 직접 건드리지 않고,
    // Knowledge 문서로 저장하면서 프로젝트 이름을 태그로 붙인다(프로젝트 상세의 태그 기반 연동이 잡아낸다).
    function openItemToProject(item, topic) {
      const projects = appState.projects.filter((p) => !p.deleted_at);
      if (!projects.length) { toast('등록된 프로젝트가 없습니다. 먼저 프로젝트를 만들어 주세요.', 'error'); return; }
      openModal({
        title: '브리핑 항목 → 프로젝트 참고자료',
        width: '460px',
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          const sel = el('select', { class: 'nm-select', name: 'project_id', required: true });
          for (const p of projects) sel.append(el('option', { value: p.id }, p.name));
          form.append(
            nmField('프로젝트', sel),
            nmField('자료 제목', el('input', { class: 'nm-input', name: 'title', required: true, value: item.title })),
            el('p', { class: 'text-muted', style: 'font-size:12px' }, 'Knowledge 문서로 저장하고 선택한 프로젝트 이름을 태그로 붙입니다. 프로젝트 상세의 "관련 자료"에 나타납니다.'),
            el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '참고자료로 추가')
          );
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const project = projects.find((p) => p.id === fd.get('project_id'));
            const tags = [project.name];
            if (topic) tags.push(topic.name);
            try {
              await appState.addKnowledgeDoc({ title: String(fd.get('title')).trim(), url: item.link, tags, memo: item.summary || null });
              if (!item.is_read) await appState.markBriefingItemRead(item.id);
              toast(`"${project.name}" 참고자료로 추가했습니다.`, 'success');
              close();
            } catch (err) { toast(`추가 실패: ${err.message || err}`, 'error'); }
          });
          body.append(form);
        },
      });
    }

    function drawTopics() {
      container.append(el('button', { class: 'nm-btn nm-btn--primary', style: 'margin-bottom:12px', onclick: () => openTopicWizard() }, '🪄 관심주제 마법사로 등록'));
      const rows = window.Reorder.sort('briefingTopics', appState.briefingTopics); // v7.31.0: ⠿ 손잡이로 끌어 순서 변경
      if (!rows.length) {
        container.append(el('div', { class: 'empty-state' }, '등록된 관심주제가 없습니다. (최대 10개)'));
        return;
      }
      const list = el('div', { class: 'item-list' });
      for (const t of rows) {
        list.append(
          el('div', { class: 'item-row', 'data-rid': t.id }, [
            window.Reorder.grip(),
            el('div', { class: 'item-row__main' }, [
              el('div', { class: 'item-row__title' }, `${t.name} ${t.active === false ? '(비활성)' : ''}`),
              el('div', { class: 'item-row__meta' }, [
                (t.site_urls || []).length ? `사이트: ${t.site_urls.join(', ')}` : '',
                (t.search_terms || []).length ? `검색어: ${t.search_terms.join(', ')}` : '',
                (t.priority_keywords || []).length ? `⭐ 우선: ${t.priority_keywords.join(', ')}` : '',
                (t.include_keywords || []).length ? `포함: ${t.include_keywords.join(', ')}` : '',
                t.exclude_keywords?.length ? `제외: ${t.exclude_keywords.join(', ')}` : '',
              ].filter(Boolean).join(' · ') || '(주제 이름으로 검색)'),
            ]),
            el('button', { class: 'nm-btn nm-btn--icon', title: '수정', onclick: () => openTopicWizard(t) }, '✎'),
            el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: () => removeTopic(t) }, '🗑'),
          ])
        );
      }
      container.append(list);
      window.Reorder.enable(list, 'briefingTopics');
    }

    // v7.36.0: 소스 카드 — 연결 문제는 "카드 안"에 원인·조치·수정 바로가기로 보여 준다(별도 경고 배너 없음).
    const openFlags = new Set(); // 상세 펼침 상태
    function drawSources() {
      const FD = window.FeedDiag;
      container.append(el('div', { class: 'row wrap', style: 'gap:8px; margin-bottom:12px' }, [
        el('button', { class: 'nm-btn nm-btn--primary', onclick: () => openSourceForm() }, '+ 소스 등록'),
        el('button', { class: 'nm-btn', title: '켜진 소스를 모두 저장 없이 시험합니다', onclick: testAll }, '🔍 전체 테스트'),
      ]));
      const rows = window.Reorder.sort('feedSources', appState.feedSources);
      if (!rows.length) {
        container.append(el('div', { class: 'empty-state' }, '등록된 소스가 없습니다. RSS 주소·마크다운·공공데이터 API를 등록해 보세요.'));
        return;
      }
      if (FD) FD.prune(appState.feedSources.map((x) => x.id));
      const fmt = (v) => (v ? String(v).slice(0, 16).replace('T', ' ') : '—');
      const typeLabel = (t) => (t === 'markdown' ? '마크다운' : t === 'api' ? 'API' : 'RSS');
      const grid = el('div', { class: 'source-cards' });
      for (const s of rows) {
        const st = FD ? FD.summary(s) : { state: 'unrun', label: '미실행', cls: '' };
        const last = st.last;
        const bad = FD && FD.needsAttention(st);
        const card = el('div', { class: `source-card ${bad ? 'is-bad' : ''}`, 'data-rid': s.id });
        const testOut = el('div', { class: 'source-card__test', style: 'display:none' });
        const head = el('div', { class: 'source-card__head' }, [
          window.Reorder.grip(),
          el('div', { class: 'source-card__name', title: s.name }, s.name),
          el('span', { class: 'nm-badge' }, typeLabel(s.type)),
          el('span', { class: `nm-badge ${st.cls}` }, st.label),
          el('span', { style: 'flex:1' }),
          el('button', { class: 'nm-btn nm-btn--icon', title: '테스트 수집(저장 안 함)', onclick: () => runTest(s, testOut) }, '▶'),
          el('button', { class: 'nm-btn nm-btn--icon', title: '켜기/끄기', onclick: async () => { await appState.updateFeedSource(s.id, { enabled: s.enabled === false }); } }, s.enabled === false ? '⏻' : '⏸'),
          el('button', { class: 'nm-btn nm-btn--icon', title: '수정', onclick: () => openSourceForm(s) }, '✎'),
          el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: () => removeSource(s) }, '🗑'),
        ]);
        const bits = [];
        bits.push(`마지막 수집 ${fmt(last ? last.at : s.last_run_at)}`);
        if (st.rate) bits.push(`7일 성공 ${st.rate.ok}/${st.rate.total}`);
        if (st.avgMs != null) bits.push(`평균 ${(st.avgMs / 1000).toFixed(1)}초`);
        if (st.newestAgeDays != null) bits.push(`최신 글 ${st.newestAgeDays <= 0 ? '오늘' : `${st.newestAgeDays}일 전`}`);
        if (last && last.added != null && !last.test) bits.push(`새로 저장 ${last.added}건`);
        card.append(head, el('div', { class: 'source-card__meta' }, bits.join(' · ')));
        if (s.type !== 'markdown') {
          const apiName = s.type === 'api' ? ((window.listCustomApis && window.listCustomApis().find((a) => a.id === s.endpoint)) || {}).name : null;
          card.append(el('div', { class: 'source-card__url' }, s.type === 'api' ? `API: ${apiName || '(삭제된 API)'}` : (s.endpoint || '—')));
        }
        // 카드 안 진단 — 문제가 있을 때만.
        if (bad) {
          const dg = FD.diagnose(s, last || { result: s.last_result, error: s.last_result === 'error' ? '' : '' });
          const note = el('div', { class: 'source-card__note' });
          const noteHead = el('button', { type: 'button', class: 'source-card__note-head', title: '클릭하면 이 소스의 수정 화면으로 이동합니다', onclick: () => openSourceForm(s, { note: dg }) }, [
            el('strong', {}, `⚠ ${dg.headline || '확인이 필요합니다'}`),
            el('span', { class: 'text-muted' }, ' — 눌러서 수정하기 ›'),
          ]);
          note.append(noteHead);
          if (dg.why) note.append(el('div', { class: 'source-card__why' }, dg.why));
          for (const t of dg.tips || []) note.append(el('div', { class: 'source-card__why' }, `· ${t}`));
          if (dg.fixes.length) note.append(el('div', { class: 'row wrap', style: 'gap:6px; margin-top:6px' }, dg.fixes.map((f) => el('button', { type: 'button', class: 'nm-btn nm-btn--sm', onclick: () => runFix(s, f, testOut, dg) }, f.label))));
          card.append(note);
        } else if (st.state === 'unrun' && s.enabled !== false) {
          card.append(el('div', { class: 'source-card__meta' }, '아직 수집 전입니다. ▶ 로 먼저 시험해 보세요.'));
        }
        if (testRes.has(s.id)) showTest(testOut, testRes.get(s.id));
        card.append(testOut);
        grid.append(card);
      }
      container.append(grid);
      window.Reorder.enable(grid, 'feedSources');
    }

    const testRes = new Map(); // 소스 id → 마지막 테스트 결과(카드를 다시 그려도 유지)
    function showTest(out, r) {
      out.style.display = ''; out.innerHTML = '';
      if (r.ok) {
        out.append(el('div', {}, `✅ 연결 성공 · ${r.n}건 · ${(r.ms / 1000).toFixed(1)}초 · 관심주제에 맞는 새 글 ${r.newMatch}건(이미 저장 ${r.dup}건)`));
        for (const it of r.sample) out.append(el('div', { class: 'text-muted', style: 'font-size:12px; word-break:break-all' }, `· ${it.title}`));
        if (!r.n) out.append(el('div', {}, '⚠ 열리지만 글이 0건입니다.'));
        else if (!r.newMatch && !r.dup) out.append(el('div', {}, '⚠ 가져온 글이 모두 관심주제와 맞지 않습니다 → 🏷 관심주제 키워드를 점검하세요.'));
      } else {
        out.append(el('div', {}, `❌ ${r.error}`));
        for (const a of (r.attempts || [])) out.append(el('div', { class: 'text-muted', style: 'font-size:12px' }, `· ${a.via}: ${String(a.msg || '').slice(0, 100)}`));
      }
    }
    async function runTest(s, out) {
      out.style.display = ''; out.textContent = '시험 중…';
      const r = await appState.testFeedSource(s);
      testRes.set(s.id, r);
      appState.dispatchEvent(new Event('change')); // 카드 상태 배지·이력을 새로 그린다(결과는 testRes에서 복원)
    }
    async function testAll() {
      const list = appState.feedSources.filter((x) => x.enabled !== false && x.type !== 'crawl');
      toast(`${list.length}개 소스를 시험합니다…`);
      for (let i = 0; i < list.length; i += 3) await Promise.all(list.slice(i, i + 3).map((x) => appState.testFeedSource(x)));
      appState.dispatchEvent(new Event('change'));
      toast('시험을 마쳤습니다. 카드에서 결과를 확인하세요.', 'success');
    }
    // 카드 안 조치 버튼
    async function runFix(s, f, out, dg) {
      if (f.id === 'edit') return openSourceForm(s, { note: dg });
      if (f.id === 'retry') return runTest(s, out);
      if (f.id === 'topic') { tab = 'topics'; draw(); return; }
      if (f.id === 'https') {
        await appState.updateFeedSource(s.id, { endpoint: String(s.endpoint).replace(/^http:/i, 'https:') });
        const fresh = appState.feedSources.find((x) => x.id === s.id) || s;
        toast('https 주소로 바꿨습니다. 시험합니다…'); return runTest(fresh, out);
      }
      if (f.id === 'md') {
        return openModal({ title: '마크다운으로 등록하는 법', contentBuilder(body) { body.append(el('div', { class: 'stack', style: 'gap:8px; font-size:13px' }, [
          el('div', {}, '사이트가 자동 접속을 막으면 브라우저에서 기사 목록 페이지를 열어 제목과 주소를 복사해 붙여넣는 방법이 있습니다.'),
          el('pre', { class: 'wizard-md' }, '- [기사 제목](https://example.com/article1)\n- [다른 기사](https://example.com/article2)'),
          el('div', { class: 'text-muted' }, '소스 등록 → 종류: 마크다운 붙여넣기. 링크가 관심주제와 맞는 것만 브리핑에 들어갑니다.'),
        ])); } });
      }
      if (f.id === 'kstartup') {
        const apis = (window.listCustomApis && window.listCustomApis()) || [];
        const api = apis.find((a) => a.id === s.endpoint);
        if (!api) return toast('연결된 API를 찾을 수 없습니다. 수정에서 다시 선택하세요.', 'error');
        window.upsertCustomApi({ ...api, urlTemplate: window.FeedDiag.KSTARTUP_URL });
        toast('K-Startup 사업공고 URL로 바꿨습니다. 시험합니다…', 'success');
        return runTest(s, out);
      }
      if (f.id === 'discover') {
        out.style.display = ''; out.textContent = 'RSS 주소를 찾는 중… (최대 20초)';
        const r = await window.discoverFeedsFor(s.endpoint);
        out.innerHTML = '';
        if (!r.verified.length) { out.append(el('div', {}, '열리는 RSS 주소를 찾지 못했습니다. 사이트가 RSS를 제공하지 않으면 📝 마크다운 방식이 대안입니다.')); r.unverified.forEach((u) => out.append(el('div', { class: 'text-muted', style: 'font-size:12px' }, `· 시도: ${u}`))); return; }
        out.append(el('div', {}, '✅ 열리는 RSS 주소를 찾았습니다. 눌러서 교체하세요:'));
        for (const v of r.verified) out.append(el('button', { type: 'button', class: 'nm-btn nm-btn--sm', style: 'margin:3px 4px 0 0', onclick: async () => { await appState.updateFeedSource(s.id, { endpoint: v.url }); toast('주소를 교체했습니다.', 'success'); } }, `${v.url} (${v.n}건)`));
      }
    }

    // 개발계획서 9.2 "항목 스크랩 클릭 → Knowledge" 연동: 원문 링크·요약을 문서로 저장하고 주제 태그를 상속한다.
    async function scrapToKnowledge(item, topic) {
      await appState.addKnowledgeDoc({
        title: item.title,
        url: item.link,
        tags: topic ? [topic.name] : [],
        memo: item.summary || null,
      });
      toast('Knowledge에 스크랩했습니다.', 'success');
    }

    async function removeTopic(t) {
      if (!confirmDialog(`"${t.name}" 관심주제를 삭제할까요?`)) return;
      await appState.deleteBriefingTopic(t.id);
      toast('삭제했습니다.', 'success');
    }
    async function removeSource(s) {
      if (!confirmDialog(`"${s.name}" 피드 소스를 삭제할까요?`)) return;
      await appState.deleteFeedSource(s.id);
      toast('삭제했습니다.', 'success');
    }

    // ---- 간편 설정 마법사: 주제 → 사이트 → 검색어 → 우선 검색어 → 제거할 단어 → 미리보기(마크다운) ----
    const WIZARD_STEPS = [
      { key: 'name', title: '① 어떤 주제를 볼까요?', help: '브리핑 제목이 됩니다.', placeholder: '예: 스마트팜', single: true },
      { key: 'site_urls', title: '② 찾아볼 사이트 (선택)', help: '한 줄에 하나. 사이트 주소를 넣으면 그 사이트 글만 검색해요. RSS 주소(…/rss, …/feed.xml)는 그대로 구독합니다. 비우면 전체 뉴스에서 찾아요.', placeholder: 'etnews.com\nhttps://www.hankyung.com\nhttps://blog.example.com/feed.xml' },
      { key: 'search_terms', title: '③ 특정 검색어 (선택)', help: '한 줄에 하나(띄어쓰기는 한 구문으로 검색). 비우면 주제 이름으로 검색해요.', placeholder: '스마트팜 정책\n정밀농업' },
      { key: 'priority_keywords', title: '④ 우선 검색어 (선택)', help: '이 단어가 들어간 글은 ⭐ 표시와 함께 맨 위에 모아 보여줘요.', placeholder: '보조금\n신기술' },
      { key: 'exclude_keywords', title: '⑤ 제거할 단어 (선택)', help: '이 단어가 들어간 글은 검색에서 빼요.', placeholder: '광고\n채용' },
    ];
    function openTopicWizard(existing) {
      openModal({
        title: existing ? '관심주제 수정 (마법사)' : '관심주제 마법사',
        contentBuilder(body, close) {
          const v = {
            name: existing?.name || '',
            site_urls: (existing?.site_urls || []).join('\n'),
            search_terms: (existing?.search_terms || []).join('\n'),
            priority_keywords: (existing?.priority_keywords || []).join('\n'),
            exclude_keywords: (existing?.exclude_keywords || []).join('\n'),
          };
          let step = 0;
          let quick = false;
          let priority = existing?.priority ?? 5;
          let active = existing?.active !== false;
          const spec = () => ({ ...v, site_urls: window.splitList(v.site_urls), search_terms: window.splitList(v.search_terms), priority_keywords: window.splitList(v.priority_keywords), exclude_keywords: window.splitList(v.exclude_keywords) });
          const host = el('div', { class: 'stack' });
          body.append(host);

          function previewMd() {
            const t = spec();
            const feeds = window.buildTopicFeeds({ ...t, name: t.name || '(주제)' });
            const j = (a) => a.join(', ');
            const lines = ['---', 'type: briefing', `topics: [${t.name || '(주제)'}]`, '---', '', `## ${t.name || '(주제)'}`, ''];
            const cond = [['검색어', j(t.search_terms)], ['사이트', j(t.site_urls)], ['⭐ 우선', j(t.priority_keywords)], ['제외', j(t.exclude_keywords)]].filter((x) => x[1]).map((x) => `${x[0]}: ${x[1]}`);
            if (cond.length) lines.push(`> ${cond.join(' · ')}`, '');
            lines.push(`- ${t.priority_keywords.length ? '⭐ ' : ''}[검색 결과 제목이 여기에 들어갑니다](https://…) — 매체명 · 날짜`, '  - 요약 한 줄', `  - #${(t.name || '주제').replace(/\s+/g, '_')}`);
            return { md: lines.join('\n'), feeds };
          }

          function renderStep() {
            host.innerHTML = '';
            if (quick) return renderQuick();
            const total = WIZARD_STEPS.length + 1;
            host.append(el('div', { class: 'wizard-progress', 'aria-label': `${step + 1}/${total} 단계` }, Array.from({ length: total }, (_, i) => el('span', { class: `wizard-dot ${i === step ? 'is-current' : i < step ? 'is-done' : ''}` }))));
            if (step < WIZARD_STEPS.length) {
              const st = WIZARD_STEPS[step];
              const input = st.single
                ? el('input', { class: 'nm-input', value: v[st.key], placeholder: st.placeholder, autofocus: true })
                : el('textarea', { class: 'nm-textarea', rows: 5, placeholder: st.placeholder }, v[st.key]);
              input.addEventListener('input', () => {
                v[st.key] = input.value;
                // 입력이 있으면 "건너뛰기"가 "다음"으로 바뀐다.
                const nb = host.querySelector('[data-wizard-next]');
                if (nb && !st.single) nb.textContent = input.value.trim() ? '다음 →' : '건너뛰기 →';
              });
              input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && st.single) { e.preventDefault(); go(1); } });
              host.append(el('h3', { style: 'margin:4px 0' }, st.title), el('div', { class: 'text-muted', style: 'font-size:13px' }, st.help), input);
              if (step === 0) host.append(el('button', { type: 'button', class: 'nm-btn', style: 'align-self:flex-start', onclick: () => { quick = true; renderStep(); } }, '📝 한 번에 입력하기'));
              if (existing && step === 2 && (existing.include_keywords || []).length) host.append(el('div', { class: 'text-muted', style: 'font-size:12px' }, `기존 포함 키워드(${existing.include_keywords.join(', ')})는 그대로 유지돼요.`));
            } else {
              const { md, feeds } = previewMd();
              host.append(
                el('h3', { style: 'margin:4px 0' }, '⑥ 미리보기'),
                el('div', { class: 'text-muted', style: 'font-size:13px' }, '저장하면 아래 주소에서 글을 가져와 이런 마크다운 문서를 만들어요.'),
                feeds.length
                  ? el('ul', { class: 'wizard-feeds' }, feeds.map((f) => el('li', {}, [el('span', { class: 'nm-badge' }, f.kind === 'feed' ? 'RSS' : '검색'), ' ', f.label])))
                  : el('div', { class: 'text-muted' }, '주제 이름이나 검색어를 입력해 주세요.'),
                el('pre', { class: 'wizard-md' }, md),
                el('div', { class: 'row wrap', style: 'gap:12px' }, [
                  el('label', { class: 'row', style: 'gap:6px' }, ['우선순위(1~10)', (() => { const n = el('input', { class: 'nm-input', type: 'number', min: '1', max: '10', value: String(priority), style: 'width:70px' }); n.addEventListener('input', () => { priority = Number(n.value) || 5; }); return n; })()]),
                  el('label', { class: 'row', style: 'gap:6px; cursor:pointer' }, [(() => { const c = el('input', { type: 'checkbox', checked: active || undefined }); c.addEventListener('change', () => { active = c.checked; }); return c; })(), '활성']),
                ])
              );
            }
            const last = step === WIZARD_STEPS.length;
            host.append(el('div', { class: 'row', style: 'gap:8px; justify-content:flex-end; margin-top:8px' }, [
              step > 0 ? el('button', { type: 'button', class: 'nm-btn', onclick: () => go(-1) }, '← 이전') : null,
              !last ? el('button', { type: 'button', class: 'nm-btn nm-btn--primary', 'data-wizard-next': '', onclick: () => go(1) }, step === 0 || WIZARD_STEPS[step].single ? '다음 →' : (v[WIZARD_STEPS[step].key].trim() ? '다음 →' : '건너뛰기 →')) : null,
              last ? el('button', { type: 'button', class: 'nm-btn', onclick: () => save(false) }, '저장') : null,
              last ? el('button', { type: 'button', class: 'nm-btn nm-btn--primary', onclick: () => save(true) }, '저장하고 지금 가져오기') : null,
            ]));
          }
          function renderQuick() {
            const ta = el('textarea', { class: 'nm-textarea', rows: 9 }, window.briefingSpecToText({ ...spec(), name: v.name }));
            host.append(
              el('h3', { style: 'margin:4px 0' }, '📝 한 번에 입력'),
              el('div', { class: 'text-muted', style: 'font-size:13px' }, '"항목: 값" 형식으로 적으면 돼요. 값은 쉼표로 여러 개 입력할 수 있고, 안 쓰는 항목은 지워도 됩니다.'),
              ta,
              el('div', { class: 'row', style: 'gap:8px; justify-content:flex-end' }, [
                el('button', { type: 'button', class: 'nm-btn', onclick: () => { quick = false; renderStep(); } }, '← 단계별 입력'),
                el('button', { type: 'button', class: 'nm-btn nm-btn--primary', onclick: () => {
                  const p = window.parseBriefingSpec(ta.value);
                  v.name = p.name; v.site_urls = p.site_urls.join('\n'); v.search_terms = p.search_terms.join('\n'); v.priority_keywords = p.priority_keywords.join('\n'); v.exclude_keywords = p.exclude_keywords.join('\n');
                  quick = false; step = WIZARD_STEPS.length; renderStep();
                } }, '미리보기 →'),
              ])
            );
          }
          function go(d) {
            if (d > 0 && step === 0 && !v.name.trim()) { toast('주제 이름을 입력해 주세요.', 'error'); return; }
            step = Math.max(0, Math.min(WIZARD_STEPS.length, step + d));
            renderStep();
          }
          async function save(thenCollect) {
            const t = spec();
            if (!t.name.trim()) { toast('주제 이름을 입력해 주세요.', 'error'); step = 0; renderStep(); return; }
            const bad = t.site_urls.filter((x) => !window.parseSiteInput(x));
            if (bad.length) { toast(`사이트 주소를 읽을 수 없어요: ${bad[0]}`, 'error'); step = 1; renderStep(); return; }
            const data = { name: t.name.trim(), site_urls: t.site_urls, search_terms: t.search_terms, priority_keywords: t.priority_keywords, exclude_keywords: t.exclude_keywords, priority, active };
            try {
              if (existing) await appState.updateBriefingTopic(existing.id, data);
              else await appState.addBriefingTopic(data);
              toast('저장했습니다.', 'success');
              close();
              if (thenCollect) { tab = 'items'; await collectNow(); }
            } catch (err) {
              toast(err.message, 'error');
            }
          }
          renderStep();
        },
      });
    }

    function openSourceForm(existing, opts = {}) {
      openModal({
        title: existing ? '피드 소스 수정' : '피드 소스 등록',
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          const isMarkdown = existing?.type === 'markdown';
          const isApi = existing?.type === 'api';
          const apiList = (window.listCustomApis && window.listCustomApis()) || [];
          // 카드의 "수정 의견"을 그대로 가져와 맨 위에 보여 준다.
          if (opts.note && (opts.note.headline || opts.note.why)) {
            const nb = el('div', { class: 'source-card__note', style: 'margin-bottom:4px' }, [el('strong', {}, `⚠ ${opts.note.headline}`), opts.note.why ? el('div', { class: 'source-card__why' }, opts.note.why) : null, ...(opts.note.tips || []).map((t) => el('div', { class: 'source-card__why' }, `· ${t}`))]);
            body.append(nb);
          }
          const typeSelect = el('select', { class: 'nm-select', name: 'type' }, [
            el('option', { value: 'rss', selected: !isMarkdown || undefined }, 'RSS 피드(주소)'),
            el('option', { value: 'markdown', selected: isMarkdown || undefined }, '마크다운 붙여넣기'),
            el('option', { value: 'api', selected: isApi || undefined }, '공공데이터 API(설정의 커스텀 API)'),
          ]);
          if (isApi) typeSelect.value = 'api'; else if (!isMarkdown) typeSelect.value = 'rss';
          const apiSel = el('select', { class: 'nm-select', name: 'endpoint_api' }, [el('option', { value: '' }, apiList.length ? '— API 선택 —' : '(설정 → 커스텀 API에 먼저 등록하세요)'), ...apiList.map((a) => el('option', { value: a.id, selected: (existing?.endpoint === a.id) || undefined }, a.name || a.id))]);
          const apiField = field('연결할 API (K-Startup·기업마당 등 공고 목록을 주는 API)', apiSel);
          const rssField = field('RSS 주소', el('input', { class: 'nm-input', type: 'url', name: 'endpoint_rss', placeholder: 'https://example.com/rss', value: !isMarkdown ? existing?.endpoint || '' : '' }));
          const rssMsg = el('div', { class: 'text-muted', style: 'font-size:12px; word-break:break-all' });
          rssField.append(el('div', { class: 'row wrap', style: 'gap:6px; margin-top:6px' }, [
            el('button', { type: 'button', class: 'nm-btn nm-btn--sm', onclick: async () => {
              const u = rssField.querySelector('input').value.trim(); if (!u) return toast('주소를 먼저 입력하세요.', 'error');
              rssMsg.textContent = '확인 중… (최대 20초)';
              try { const items = await window.fetchFeedItems(u); rssMsg.textContent = `✅ 열립니다 — 글 ${items.length}건. 첫 글: ${items[0] ? items[0].title : '(없음)'}`; return; } catch (e) { rssMsg.textContent = `❌ ${e.message} — RSS 주소를 찾아봅니다…`; }
              const r = await window.discoverFeedsFor(u);
              rssMsg.innerHTML = '';
              if (!r.verified.length) { rssMsg.textContent = '열리는 RSS 주소를 찾지 못했습니다. 마크다운 붙여넣기를 사용해 보세요.'; return; }
              rssMsg.append('찾은 RSS(눌러서 적용): ');
              r.verified.forEach((v) => rssMsg.append(el('button', { type: 'button', class: 'nm-btn nm-btn--sm', style: 'margin:2px', onclick: () => { rssField.querySelector('input').value = v.url; rssMsg.textContent = `적용: ${v.url}`; } }, `${v.url} (${v.n}건)`)));
            } }, '🔍 연결 확인 · RSS 주소 찾기'),
          ]), rssMsg);
          const mdTextarea = el('textarea', { class: 'nm-textarea', name: 'endpoint_md', rows: 8, placeholder: '- [기사 제목](https://example.com/article) 한줄 설명' }, isMarkdown ? existing?.endpoint || '' : '');
          const mdFileInput = el('input', { class: 'nm-input', type: 'file', accept: '.md,.markdown,text/markdown,text/plain' });
          mdFileInput.addEventListener('change', () => {
            const file = mdFileInput.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => { mdTextarea.value = String(reader.result || ''); toast(`"${file.name}" 내용을 불러왔습니다.`, 'success'); };
            reader.onerror = () => toast('파일을 읽는 중 오류가 발생했습니다.', 'error');
            reader.readAsText(file);
          });
          const mdField = field(
            '마크다운 본문(붙여넣기 또는 .md 파일 업로드 — 예: "- [기사 제목](https://example.com/article) 설명…" 형식의 링크가 포함된 텍스트에서, 관심주제와 맞는 링크만 자동으로 브리핑에 추가합니다)',
            el('div', { class: 'stack', style: 'gap:8px' }, [mdFileInput, mdTextarea])
          );
          // v7.24.0: 저장하기 전에 "이 본문에서 링크를 몇 개나 찾는지" 바로 확인할 수 있게 한다.
          // 예전에는 저장 후 수집해봐야 0건인지 알 수 없어 원인을 찾기 어려웠다.
          const mdPreview = el('div', { class: 'text-muted', style: 'font-size:12px; white-space:pre-wrap; word-break:break-all' });
          const mdPreviewBtn = el('button', {
            type: 'button', class: 'nm-btn',
            onclick: () => {
              const items = window.parseMarkdownLinks(mdTextarea.value) || [];
              if (!items.length) {
                mdPreview.textContent = '⚠ 이 본문에서 링크를 찾지 못했습니다. "[제목](https://주소)" 형식이거나 http(s) 주소가 있는지 확인하세요.';
                return;
              }
              const head = items.slice(0, 5).map((it) => `· ${it.title} → ${it.link}`).join('\n');
              mdPreview.textContent = `✅ 링크 ${items.length}개를 찾았습니다:\n${head}${items.length > 5 ? `\n… 외 ${items.length - 5}개` : ''}`;
            },
          }, '🔍 링크 미리보기');
          mdField.append(el('div', { class: 'stack', style: 'gap:6px' }, [mdPreviewBtn, mdPreview]));
          function syncVisibility() {
            rssField.style.display = typeSelect.value === 'rss' ? '' : 'none';
            mdField.style.display = typeSelect.value === 'markdown' ? '' : 'none';
            apiField.style.display = typeSelect.value === 'api' ? '' : 'none';
          }
          typeSelect.addEventListener('change', syncVisibility);
          form.append(
            field('이름', el('input', { class: 'nm-input', name: 'name', required: true, placeholder: '예: OO 블로그', value: existing?.name || '' })),
            field('소스 종류', typeSelect),
            rssField,
            mdField,
            apiField,
            field(
              '활성 상태',
              (() => {
                const sel = el('select', { class: 'nm-select', name: 'enabled' });
                sel.append(el('option', { value: 'true', selected: existing?.enabled !== false || undefined }, '활성'));
                sel.append(el('option', { value: 'false', selected: existing?.enabled === false || undefined }, '비활성'));
                return sel;
              })()
            )
          );
          syncVisibility();
          form.append(el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장'));
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const type = fd.get('type');
            const endpoint = type === 'markdown' ? fd.get('endpoint_md') : type === 'api' ? fd.get('endpoint_api') : fd.get('endpoint_rss');
            if (!endpoint || !String(endpoint).trim()) {
              toast(type === 'markdown' ? '마크다운 본문을 입력해주세요.' : type === 'api' ? 'API를 선택해주세요.' : 'RSS 주소를 입력해주세요.', 'error');
              return;
            }
            const data = { name: fd.get('name'), type, endpoint, enabled: fd.get('enabled') === 'true' };
            try {
              if (existing) await appState.updateFeedSource(existing.id, data);
              else await appState.addFeedSource(data);
              toast('저장했습니다. "지금 가져오기"를 누르면 이 소스에서도 항목을 찾습니다.', 'success');
              close();
            } catch (err) {
              toast(`저장에 실패했습니다: ${err.message || err}`, 'error');
            }
          });
          body.append(form);
        },
      });
    }

    function field(label, node) {
      return el('div', { class: 'nm-field' }, [el('label', {}, label), node]);
    }

    draw();
    appState.addEventListener('change', draw);
    return () => appState.removeEventListener('change', draw);
  }

  window.renderBriefing = renderBriefing;
})();
