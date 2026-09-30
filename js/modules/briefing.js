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
          el(
            'button',
            { class: 'nm-btn nm-btn--primary', onclick: collectNow, disabled: collecting || undefined },
            collecting ? '수집 중…' : '🔄 지금 가져오기'
          ),
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
      if (!appState.feedSources.length) {
        toast('먼저 피드 소스를 등록해주세요.', 'error');
        tab = 'sources';
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
      const rows = appState.briefingItems.slice();
      if (!rows.length) {
        container.append(el('div', { class: 'empty-state' }, '아직 수집된 항목이 없습니다. 관심주제·피드 소스를 등록한 뒤 "지금 가져오기"를 눌러보세요.'));
        return;
      }
      const list = el('div', { class: 'item-list' });
      for (const item of rows) {
        const topic = appState.briefingTopics.find((t) => t.id === item.topic_id);
        const source = appState.feedSources.find((s) => s.id === item.source_id);
        list.append(
          el('div', { class: `item-row ${item.is_read ? 'item-row--done' : ''}` }, [
            el('div', { class: 'item-row__main' }, [
              el('div', { class: 'item-row__title' }, [
                el('a', { href: item.link, target: '_blank', rel: 'noopener', onclick: () => !item.is_read && appState.markBriefingItemRead(item.id) }, escapeHtml(item.title)),
              ]),
              el(
                'div',
                { class: 'item-row__meta' },
                `${topic ? '#' + escapeHtml(topic.name) + ' · ' : ''}${source ? escapeHtml(source.name) : ''}${item.published_at ? ' · ' + new Date(item.published_at).toLocaleDateString('ko-KR') : ''}`
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
      container.append(el('button', { class: 'nm-btn nm-btn--primary', style: 'margin-bottom:12px', onclick: () => openTopicForm() }, '+ 관심주제 등록'));
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
              el('div', { class: 'item-row__meta' }, `포함: ${(t.include_keywords || []).join(', ') || '(전체)'}${t.exclude_keywords?.length ? ' · 제외: ' + t.exclude_keywords.join(', ') : ''}`),
            ]),
            el('button', { class: 'nm-btn nm-btn--icon', title: '수정', onclick: () => openTopicForm(t) }, '✎'),
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

    function openTopicForm(existing) {
      openModal({
        title: existing ? '관심주제 수정' : '관심주제 등록',
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          form.append(
            field('주제 이름', el('input', { class: 'nm-input', name: 'name', required: true, placeholder: '예: 스마트팜, AI 정책', value: existing?.name || '' })),
            field('포함 키워드(쉼표로 구분, 비우면 전체 통과)', el('input', { class: 'nm-input', name: 'include', value: (existing?.include_keywords || []).join(', ') })),
            field('제외 키워드(쉼표로 구분, 선택)', el('input', { class: 'nm-input', name: 'exclude', value: (existing?.exclude_keywords || []).join(', ') })),
            field('우선순위(1-10, 높을수록 우선)', el('input', { class: 'nm-input', type: 'number', min: '1', max: '10', name: 'priority', value: existing?.priority ?? 5 })),
            field(
              '활성 상태',
              (() => {
                const sel = el('select', { class: 'nm-select', name: 'active' });
                sel.append(el('option', { value: 'true', selected: existing?.active !== false || undefined }, '활성'));
                sel.append(el('option', { value: 'false', selected: existing?.active === false || undefined }, '비활성'));
                return sel;
              })()
            )
          );
          form.append(el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장'));
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const data = {
              name: fd.get('name'),
              include_keywords: parseKeywords(fd.get('include')),
              exclude_keywords: parseKeywords(fd.get('exclude')),
              priority: Number(fd.get('priority')) || 5,
              active: fd.get('active') === 'true',
            };
            try {
              if (existing) await appState.updateBriefingTopic(existing.id, data);
              else await appState.addBriefingTopic(data);
              toast('저장했습니다.', 'success');
              close();
            } catch (err) {
              toast(err.message, 'error');
            }
          });
          body.append(form);
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
