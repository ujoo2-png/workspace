// 문화생활(PlayList) 화면. 영화·음악·연극·음악회 등 볼/들을 것과 다녀온 것을 기록한다.
// DB 설계상 content_types는 별도 lookup 테이블이지만, 이 MVP에서는 고정 목록으로 단순화했다.
// 일반 <script>로 로드된다.
(function () {
  const { appState, el, escapeHtml, toast, confirmDialog, openModal, todayISO } = window;

  const TYPE_LABEL = { movie: '영화', music: '음악', theater: '연극', concert: '음악회', musical: '뮤지컬', exhibition: '전시', book: '책', etc: '기타' };
  const STATUS_LABEL = { to_watch: '예정', watched: '완료', in_progress: '진행 중', abandoned: '중단' };
  window.PLAYLIST_TYPE_LABEL = TYPE_LABEL;

  function renderPlaylist(root) {
    const container = el('div', {});
    root.append(container);
    let filter = 'all'; // all | to_watch | watched
    let trending = { loading: false, items: null }; // null = 아직 로드 전

    async function loadTrending() {
      if (!window.getTmdbApiKey || !window.getTmdbApiKey()) {
        trending = { loading: false, items: [] };
        draw();
        return;
      }
      trending = { loading: true, items: null };
      draw();
      const items = await window.fetchTrendingMovies();
      trending = { loading: false, items };
      draw();
    }

    function draw() {
      container.innerHTML = '';
      container.append(
        el('div', { class: 'page-header' }, [
          el('h1', {}, '문화생활'),
          el('button', { class: 'nm-btn nm-btn--primary', onclick: () => openItemForm() }, '+ 등록'),
        ])
      );

      container.append(trendingSection());

      container.append(
        el('div', { class: 'row wrap', style: 'margin-bottom:14px' }, [
          filterBtn('all', '전체'),
          filterBtn('to_watch', '예정'),
          filterBtn('watched', '완료'),
        ])
      );

      let rows = appState.playlistItems.filter((p) => !p.deleted_at);
      if (filter !== 'all') rows = rows.filter((p) => p.status === filter);
      rows = rows.slice().sort((a, b) => (b.event_date || b.created_at || '').localeCompare(a.event_date || a.created_at || ''));

      if (!rows.length) {
        container.append(el('div', { class: 'empty-state' }, '기록된 문화생활이 없습니다. 보고 싶은 영화나 다녀온 공연을 등록해보세요.'));
        return;
      }

      const grid = el('div', { class: 'grid-3' });
      for (const p of rows) {
        const mapUrl = p.venue_name ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.venue_name)}` : null;
        grid.append(
          el('div', { class: 'nm-card' }, [
            p.poster_url
              ? el('img', { src: p.poster_url, alt: '', style: 'width:100%; max-height:180px; object-fit:cover; border-radius:10px; margin-bottom:8px', onerror: "this.style.display='none'" })
              : null,
            el('div', { class: 'row row--between' }, [
              el('span', { class: 'nm-badge' }, TYPE_LABEL[p.content_type] || p.content_type),
              el('span', { class: 'nm-badge' }, STATUS_LABEL[p.status] || p.status),
            ]),
            el('div', { style: 'font-weight:700; margin:8px 0 2px' }, escapeHtml(p.title)),
            p.creator ? el('div', { class: 'text-muted', style: 'font-size:12px' }, escapeHtml(p.creator)) : null,
            p.event_date ? el('div', { class: 'text-muted', style: 'font-size:12px; margin-top:4px' }, `${p.event_date}${p.event_time ? ' ' + p.event_time : ''}`) : null,
            p.venue_name
              ? el('div', { class: 'text-muted', style: 'font-size:12px; margin-top:2px' }, [
                  escapeHtml(p.venue_name) + ' · ',
                  el('a', { href: mapUrl, target: '_blank', rel: 'noopener' }, '지도에서 보기'),
                ])
              : null,
            p.rating ? el('div', { style: 'margin-top:6px' }, '⭐'.repeat(Math.round(p.rating))) : null,
            p.review ? el('div', { class: 'text-muted', style: 'margin-top:6px; font-size:12px' }, escapeHtml(p.review)) : null,
            el('div', { class: 'row', style: 'margin-top:10px; gap:6px; justify-content:flex-end' }, [
              p.event_date && p.status === 'to_watch'
                ? el('button', { class: 'nm-btn nm-btn--icon', title: '캘린더에 추가', onclick: () => addToSchedule(p) }, '🗓️')
                : null,
              el('button', { class: 'nm-btn nm-btn--icon', title: '수정', onclick: () => openItemForm(p) }, '✎'),
              el('button', { class: 'nm-btn nm-btn--icon', title: '첨부파일', onclick: () => window.openAttachmentsModal('playlist_items', p.id, p.title) }, '📎'),
              el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: () => remove(p) }, '🗑'),
            ]),
          ])
        );
      }
      container.append(grid);
    }

    // "이번 주 인기 영화"(TMDB 연동). 설정 화면에서 API 키를 입력해야 보인다.
    function trendingSection() {
      if (!window.getTmdbApiKey || !window.getTmdbApiKey()) {
        return el('div', { class: 'nm-card', style: 'margin-bottom:16px' }, [
          el('div', { class: 'row row--between' }, [
            el('strong', { style: 'font-size:13px' }, '🎬 이번 주 인기 영화'),
            el('button', { class: 'nm-btn', onclick: () => window.navigate('/settings') }, 'API 키 설정하기'),
          ]),
          el('p', { class: 'text-muted', style: 'font-size:12px; margin-top:6px' }, '설정 화면에서 TMDB API 키를 입력하면 실시간 인기 영화를 볼 수 있습니다.'),
        ]);
      }
      if (trending.items === null) {
        loadTrending();
        return el('div', { class: 'nm-card', style: 'margin-bottom:16px' }, [el('div', { class: 'text-muted' }, '이번 주 인기 영화를 불러오는 중…')]);
      }
      if (!trending.items.length) {
        return el('div', { class: 'nm-card', style: 'margin-bottom:16px' }, [
          el('div', { class: 'row row--between' }, [
            el('strong', { style: 'font-size:13px' }, '🎬 이번 주 인기 영화'),
            el('button', { class: 'nm-btn nm-btn--icon', title: '다시 시도', onclick: loadTrending }, '↻'),
          ]),
          el('p', { class: 'text-muted', style: 'font-size:12px; margin-top:6px' }, '불러오지 못했습니다. 설정 화면에서 API 키를 확인해 주세요.'),
        ]);
      }
      return el('div', { class: 'nm-card', style: 'margin-bottom:16px' }, [
        el('div', { class: 'row row--between' }, [
          el('strong', { style: 'font-size:13px' }, '🎬 이번 주 인기 영화(TMDB)'),
          el('button', { class: 'nm-btn nm-btn--icon', title: '새로고침', onclick: loadTrending }, '↻'),
        ]),
        el(
          'div',
          { class: 'trending-row' },
          trending.items.map((m) =>
            el('div', { class: 'trending-item' }, [
              m.poster_url ? el('img', { src: m.poster_url, alt: '', class: 'trending-item__poster' }) : el('div', { class: 'trending-item__poster trending-item__poster--empty' }),
              el('div', { class: 'trending-item__title', title: m.title }, escapeHtml(m.title)),
              el('div', { class: 'text-muted', style: 'font-size:11px' }, `⭐ ${m.rating?.toFixed(1) ?? '-'} · ${(m.release_date || '').slice(0, 4)}`),
              el('button', {
                class: 'nm-btn nm-btn--icon',
                title: '내 목록에 추가',
                onclick: async () => {
                  await appState.addPlaylistItem({ content_type: 'movie', title: m.title, poster_url: m.poster_url, review: m.overview || null, status: 'to_watch' });
                  toast('내 목록에 추가했습니다.', 'success');
                },
              }, '+ 추가'),
            ])
          )
        ),
      ]);
    }

    function filterBtn(key, label) {
      const active = filter === key;
      return el('button', { class: `nm-btn ${active ? 'nm-btn--primary' : ''}`, onclick: () => { filter = key; draw(); } }, label);
    }

    async function addToSchedule(p) {
      try {
        await appState.addPlaylistToSchedule(p);
        toast('일정에 추가했습니다.', 'success');
      } catch (e) {
        toast(e.message, 'error');
      }
    }

    async function remove(p) {
      if (!confirmDialog(`"${p.title}"을(를) 삭제할까요?`)) return;
      await appState.deletePlaylistItem(p.id);
      toast('삭제했습니다.', 'success');
    }

    function openItemForm(existing) {
      openModal({
        title: existing ? '문화생활 수정' : '문화생활 등록',
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          form.append(
            field('종류', typeSelect(existing?.content_type)),
            field('제목', el('input', { class: 'nm-input', name: 'title', required: true, value: existing?.title || '' })),
            field('감독/아티스트/작가(선택)', el('input', { class: 'nm-input', name: 'creator', value: existing?.creator || '' })),
            field('상태', statusSelect(existing?.status)),
            field('관람/관람예정일(선택)', el('input', { class: 'nm-input', type: 'date', name: 'event_date', value: existing?.event_date || '' })),
            field('시간(선택)', el('input', { class: 'nm-input', type: 'time', name: 'event_time', value: existing?.event_time || '' })),
            field('장소(선택)', el('input', { class: 'nm-input', name: 'venue_name', value: existing?.venue_name || '' })),
            field('포스터 이미지 URL(선택)', el('input', { class: 'nm-input', type: 'url', name: 'poster_url', placeholder: 'https://...', value: existing?.poster_url || '' })),
            field('별점(1-5, 선택)', el('input', { class: 'nm-input', type: 'number', min: '1', max: '5', name: 'rating', value: existing?.rating || '' })),
            field('한줄평(선택)', el('textarea', { class: 'nm-textarea', name: 'review' }, existing?.review || ''))
          );
          form.append(el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장'));
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const data = {
              content_type: fd.get('content_type'),
              title: fd.get('title'),
              creator: fd.get('creator') || null,
              status: fd.get('status'),
              event_date: fd.get('event_date') || null,
              event_time: fd.get('event_time') || null,
              venue_name: fd.get('venue_name') || null,
              poster_url: fd.get('poster_url') || null,
              rating: fd.get('rating') ? Number(fd.get('rating')) : null,
              review: fd.get('review') || null,
            };
            if (existing) await appState.updatePlaylistItem(existing.id, data);
            else await appState.addPlaylistItem(data);
            toast('저장했습니다.', 'success');
            close();
          });
          body.append(form);
        },
      });
    }

    function typeSelect(selected = 'movie') {
      const select = el('select', { class: 'nm-select', name: 'content_type' });
      for (const [value, label] of Object.entries(TYPE_LABEL)) select.append(el('option', { value, selected: value === selected || undefined }, label));
      return select;
    }

    function statusSelect(selected = 'to_watch') {
      const select = el('select', { class: 'nm-select', name: 'status' });
      for (const [value, label] of Object.entries(STATUS_LABEL)) select.append(el('option', { value, selected: value === selected || undefined }, label));
      return select;
    }

    function field(label, node) {
      return el('div', { class: 'nm-field' }, [el('label', {}, label), node]);
    }

    draw();
    appState.addEventListener('change', draw);
    return () => appState.removeEventListener('change', draw);
  }

  window.renderPlaylist = renderPlaylist;
})();
