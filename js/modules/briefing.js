// 관심주제 브리핑 화면. 주제(키워드)와 RSS 피드 소스를 등록해두면 "지금 가져오기"로
// 새 글을 모아 보여준다. 실 서비스(Supabase 모드)에서는 pg_cron + Edge Function이 매일
// 자동 수집하지만(개발계획서 9장), 이 MVP는 브라우저에서 직접 수집하는 수동 트리거로 대체했다.
// 일반 <script>로 로드된다.
(function () {
  const { appState, el, escapeHtml, toast, confirmDialog, openModal, parseKeywords } = window;

  function renderBriefing(root) {
    const container = el('div', {});
    root.append(container);
    let tab = 'items'; // items | topics | sources
    let collecting = false;

    function draw() {
      container.innerHTML = '';
      container.append(
        el('div', { class: 'page-header' }, [
          el('h1', {}, '관심주제 브리핑'),
          el('div', { class: 'row', style: 'gap:8px' }, [
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
          tabBtn('items', '브리핑 목록'),
          tabBtn('topics', `관심주제 (${appState.briefingTopics.length}/10)`),
          tabBtn('sources', '피드 소스'),
        ])
      );

      if (tab === 'items') drawItems();
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
        if (result.errors.length) {
          toast(`${result.newCount}건 새로 수집, 일부 소스 실패: ${result.errors[0]}`, 'error');
        } else {
          toast(`${result.newCount}건을 새로 수집했습니다. (전체 ${result.fetchedCount}건 확인)`, 'success');
        }
      } catch (e) {
        toast(e.message || '수집 중 오류가 발생했습니다.', 'error');
      } finally {
        collecting = false;
        draw();
      }
    }

    function drawItems() {
      const topicById = (id) => appState.briefingTopics.find((t) => t.id === id);
      const hitsOf = (it) => window.priorityHits(it, topicById(it.topic_id));
      const rows = appState.briefingItems.slice().sort((a, b) => (hitsOf(b).length ? 1 : 0) - (hitsOf(a).length ? 1 : 0));
      if (!rows.length) {
        container.append(el('div', { class: 'empty-state' }, '아직 수집된 항목이 없습니다. 관심주제·피드 소스를 등록한 뒤 "지금 가져오기"를 눌러보세요.'));
        return;
      }
      const buildMd = (onlyUnread) => window.briefingToMarkdown(rows, { topics: appState.briefingTopics, sources: appState.feedSources, date: new Date().toLocaleDateString('sv-SE'), onlyUnread });
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
      const list = el('div', { class: 'item-list' });
      for (const item of rows) {
        const topic = appState.briefingTopics.find((t) => t.id === item.topic_id);
        const source = appState.feedSources.find((s) => s.id === item.source_id);
        list.append(
          el('div', { class: `item-row ${item.is_read ? 'item-row--done' : ''}` }, [
            el('div', { class: 'item-row__main' }, [
              el('div', { class: 'item-row__title' }, [
                hitsOf(item).length ? el('span', { class: 'nm-badge nm-badge--warning', title: `우선 검색어: ${hitsOf(item).join(', ')}`, style: 'margin-right:6px' }, '⭐ 우선') : null,
                el('a', { href: item.link, target: '_blank', rel: 'noopener', onclick: () => !item.is_read && appState.markBriefingItemRead(item.id) }, escapeHtml(item.title)),
              ]),
              el(
                'div',
                { class: 'item-row__meta' },
                `${topic ? '#' + escapeHtml(topic.name) + ' · ' : ''}${source ? escapeHtml(source.name) : escapeHtml(window.deriveSourceLabel(item))}${item.published_at ? ' · ' + new Date(item.published_at).toLocaleDateString('ko-KR') : ''}`
              ),
              item.summary ? el('div', { class: 'text-muted', style: 'font-size:12px; margin-top:4px' }, escapeHtml(item.summary)) : null,
            ]),
            !item.is_read ? el('button', { class: 'nm-btn nm-btn--icon', title: '읽음 처리', onclick: () => appState.markBriefingItemRead(item.id) }, '✓') : null,
            el('button', { class: 'nm-btn nm-btn--icon', title: 'Knowledge에 스크랩', onclick: () => scrapToKnowledge(item, topic) }, '📌'),
            el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: () => appState.deleteBriefingItem(item.id) }, '🗑'),
          ])
        );
      }
      container.append(list);
    }

    function drawTopics() {
      container.append(el('button', { class: 'nm-btn nm-btn--primary', style: 'margin-bottom:12px', onclick: () => openTopicWizard() }, '🪄 관심주제 마법사로 등록'));
      const rows = appState.briefingTopics;
      if (!rows.length) {
        container.append(el('div', { class: 'empty-state' }, '등록된 관심주제가 없습니다. (최대 10개)'));
        return;
      }
      const list = el('div', { class: 'item-list' });
      for (const t of rows) {
        list.append(
          el('div', { class: 'item-row' }, [
            el('div', { class: 'item-row__main' }, [
              el('div', { class: 'item-row__title' }, `${escapeHtml(t.name)} ${t.active === false ? '(비활성)' : ''}`),
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
    }

    function drawSources() {
      container.append(el('button', { class: 'nm-btn nm-btn--primary', style: 'margin-bottom:12px', onclick: () => openSourceForm() }, '+ 피드 소스 등록'));
      const rows = appState.feedSources;
      if (!rows.length) {
        container.append(el('div', { class: 'empty-state' }, '등록된 피드 소스가 없습니다. RSS 주소를 등록해보세요. (예: 각 언론사/블로그의 RSS 주소)'));
        return;
      }
      const list = el('div', { class: 'item-list' });
      for (const s of rows) {
        // 소스 관제: 사용자 제어(활성/비활성)와 시스템 판단(정상/불안정/오류/미실행)을 분리해서 보여준다.
        const status = !s.last_run_at ? { label: '미실행', cls: '' } : s.last_result === 'success' ? { label: '정상', cls: 'nm-badge--success' } : s.last_result === 'empty' ? { label: '불안정(0건)', cls: 'nm-badge--warning' } : { label: '오류', cls: 'nm-badge--critical' };
        const endpointPreview = s.type === 'markdown' ? `마크다운 텍스트 (${(s.endpoint || '').length.toLocaleString()}자)` : (s.endpoint || '');
        list.append(
          el('div', { class: 'item-row' }, [
            el('div', { class: 'item-row__main' }, [
              el('div', { class: 'row wrap', style: 'gap:6px; align-items:center' }, [
                el('div', { class: 'item-row__title' }, `${escapeHtml(s.name)} ${s.enabled === false ? '(비활성)' : ''}`),
                el('span', { class: 'nm-badge' }, s.type === 'markdown' ? '마크다운' : 'RSS'),
                el('span', { class: `nm-badge ${status.cls}` }, status.label),
              ]),
              el('div', { class: 'item-row__meta' }, `${escapeHtml(endpointPreview)}${s.last_run_at ? ' · 마지막 수집 ' + s.last_run_at.slice(0, 16).replace('T', ' ') : ''}`),
            ]),
            el('button', { class: 'nm-btn nm-btn--icon', title: '수정', onclick: () => openSourceForm(s) }, '✎'),
            el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: () => removeSource(s) }, '🗑'),
          ])
        );
      }
      container.append(list);
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

    function openSourceForm(existing) {
      openModal({
        title: existing ? '피드 소스 수정' : '피드 소스 등록',
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          const isMarkdown = existing?.type === 'markdown';
          const typeSelect = el('select', { class: 'nm-select', name: 'type' }, [
            el('option', { value: 'rss', selected: !isMarkdown || undefined }, 'RSS 피드(주소)'),
            el('option', { value: 'markdown', selected: isMarkdown || undefined }, '마크다운 붙여넣기'),
          ]);
          const rssField = field('RSS 주소', el('input', { class: 'nm-input', type: 'url', name: 'endpoint_rss', placeholder: 'https://example.com/rss', value: !isMarkdown ? existing?.endpoint || '' : '' }));
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
          function syncVisibility() {
            rssField.style.display = typeSelect.value === 'markdown' ? 'none' : '';
            mdField.style.display = typeSelect.value === 'markdown' ? '' : 'none';
          }
          typeSelect.addEventListener('change', syncVisibility);
          form.append(
            field('이름', el('input', { class: 'nm-input', name: 'name', required: true, placeholder: '예: OO 블로그', value: existing?.name || '' })),
            field('소스 종류', typeSelect),
            rssField,
            mdField,
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
            const endpoint = type === 'markdown' ? fd.get('endpoint_md') : fd.get('endpoint_rss');
            if (!endpoint || !String(endpoint).trim()) {
              toast(type === 'markdown' ? '마크다운 본문을 입력해주세요.' : 'RSS 주소를 입력해주세요.', 'error');
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
