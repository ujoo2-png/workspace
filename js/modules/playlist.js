// 문화생활(PlayList) 화면. 영화·음악·연극·음악회 등 볼/들을 것과 다녀온 것을 기록한다.
// DB 설계상 content_types는 별도 lookup 테이블이지만, 이 MVP에서는 고정 목록으로 단순화했다.
// 일반 <script>로 로드된다.
(function () {
  const { appState, el, escapeHtml, toast, confirmDialog, openModal, todayISO } = window;

  const TYPE_LABEL = { movie: '영화', music: '음악', theater: '연극', concert: '음악회', musical: '뮤지컬', exhibition: '전시', book: '책', etc: '기타' };
  const TYPE_ICON = { movie: '🎬', music: '🎵', theater: '🎭', concert: '🎼', musical: '🎤', exhibition: '🖼️', book: '📖', etc: '✨' };
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
          el('div', { class: 'row', style: 'gap:8px' }, [
            window.getPublicDataEnabled && window.getPublicDataEnabled().cultureEvents
              ? el('button', { class: 'nm-btn', onclick: () => openCultureSearch() }, '🎭 공연·전시 검색')
              : null,
            el('button', { class: 'nm-btn nm-btn--primary', onclick: () => openItemForm() }, '+ 등록'),
          ]),
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

      const grid = el('div', { class: 'playlist-grid' });
      for (const p of rows) {
        const mapUrl = p.venue_name ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.venue_name)}` : null;
        // poster_url이 비어 있으면, 첨부파일로 올려둔 이미지가 있는지 확인해서 그걸 포스터로 대신 보여준다
        // (예: URL 대신 파일로 포스터 이미지를 첨부해둔 경우에도 카드에 바로 보이도록).
        const attachedImage = appState.getAttachments('playlist_items', p.id).find((a) => (a.mime_type || '').startsWith('image/'));
        // 첨부 이미지 본문은 지연 로딩(v7.21.0) — 캐시에 없으면 백그라운드로 받아 오고 끝나면 다시 그려진다.
        if (!p.poster_url && attachedImage && !appState.peekAttachmentData(attachedImage.id)) appState.prefetchAttachmentData([attachedImage]);
        const posterSrc = p.poster_url || (attachedImage ? appState.peekAttachmentData(attachedImage.id) : null) || null;
        grid.append(
          el('div', { class: 'nm-card playlist-card' }, [
            // 항목(종류)을 카드 맨 위 헤더에 크게 표기 — 상태 배지는 오른쪽에 나란히.
            el('div', { class: 'row row--between playlist-card__header' }, [
              el('span', { class: 'nm-badge playlist-card__type' }, `${TYPE_ICON[p.content_type] || '🎫'} ${TYPE_LABEL[p.content_type] || p.content_type}`),
              el('span', { class: `nm-badge ${p.status === 'watched' ? 'nm-badge--success' : p.status === 'abandoned' ? 'nm-badge--warning' : ''}` }, STATUS_LABEL[p.status] || p.status),
            ]),
            // 포스터 영역은 항상 카드 안에 존재한다 — 실제 포스터가 없으면 종류 아이콘을 큼직하게 보여주는 플레이스홀더.
            el('div', { class: 'playlist-card__poster' }, [
              posterSrc
                ? el('img', { src: posterSrc, alt: '', class: 'playlist-card__poster-img', onerror: "this.parentElement.classList.add('playlist-card__poster--empty'); this.remove();" })
                : el('span', { class: 'playlist-card__poster-icon' }, TYPE_ICON[p.content_type] || '🎫'),
            ]),
            el('div', { class: 'playlist-card__title' }, escapeHtml(p.title)),
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
                  try {
                    await appState.addPlaylistItem({ content_type: 'movie', title: m.title, poster_url: m.poster_url, review: m.overview || null, status: 'to_watch' });
                    toast('내 목록에 추가했습니다.', 'success');
                  } catch (err) {
                    toast(`추가에 실패했습니다: ${err.message || err}`, 'error');
                  }
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

    // KOPIS 장르명을 이 화면의 고정 종류(content_type)로 대략 매핑한다(KOPIS는 공연예술 전문이라
    // "전시"는 다루지 않고, 연극/뮤지컬/음악(서양·국악·대중)/무용/복합 위주다).
    function mapGenreToContentType(genre) {
      if (!genre) return 'etc';
      if (genre.includes('뮤지컬')) return 'musical';
      if (genre.includes('연극')) return 'theater';
      if (genre.includes('음악') || genre.includes('국악')) return 'concert';
      return 'etc';
    }

    // KOPIS(공연예술통합전산망) 공연 검색 — 키워드/기간으로 찾아 결과에서 바로 "+ 추가"할 수 있다.
    function openCultureSearch() {
      openModal({
        title: '🎭 공연·전시 검색(KOPIS)',
        contentBuilder(body) {
          const today = todayISO();
          const in30 = window.addDays ? window.addDays(today, 30) : today;
          const keywordInput = el('input', { class: 'nm-input', placeholder: '공연명 키워드(선택)', style: 'flex:1' });
          const stdateInput = el('input', { class: 'nm-input', type: 'date', value: today, style: 'width:150px' });
          const eddateInput = el('input', { class: 'nm-input', type: 'date', value: in30, style: 'width:150px' });
          const searchBtn = el('button', { class: 'nm-btn nm-btn--primary', type: 'button' }, '검색');
          const resultBox = el('div', { style: 'margin-top:12px' });

          const form = el('div', { class: 'stack' }, [
            el('div', { class: 'row wrap', style: 'gap:8px' }, [keywordInput, stdateInput, eddateInput, searchBtn]),
            resultBox,
          ]);
          body.append(form);

          searchBtn.addEventListener('click', async () => {
            resultBox.innerHTML = '';
            resultBox.append(el('div', { class: 'text-muted' }, '검색 중…'));
            try {
              const stdate = stdateInput.value.replace(/-/g, '');
              const eddate = eddateInput.value.replace(/-/g, '');
              const items = await window.fetchCultureEvents({ keyword: keywordInput.value.trim() || undefined, stdate, eddate, rows: 20 });
              resultBox.innerHTML = '';
              if (!items.length) {
                resultBox.append(el('div', { class: 'text-muted' }, '검색 결과가 없습니다.'));
                return;
              }
              const list = el('div', { class: 'item-list' });
              items.forEach((it) => {
                list.append(
                  el('div', { class: 'item-row' }, [
                    it.poster ? el('img', { src: it.poster, alt: '', style: 'width:36px; height:48px; object-fit:cover; border-radius:4px' }) : null,
                    el('div', { class: 'item-row__main' }, [
                      el('div', { class: 'item-row__title' }, escapeHtml(it.title || '')),
                      el('div', { class: 'text-muted', style: 'font-size:12px' }, `${escapeHtml(it.venue || '')} · ${it.startDate || ''}~${it.endDate || ''}`),
                    ]),
                    el('button', {
                      class: 'nm-btn nm-btn--icon',
                      title: '내 목록에 추가',
                      onclick: async () => {
                        try {
                          await appState.addPlaylistItem({
                            content_type: mapGenreToContentType(it.genre),
                            title: it.title,
                            venue_name: it.venue,
                            event_date: it.startDate || null,
                            poster_url: it.poster || null,
                            status: 'to_watch',
                          });
                          toast('내 목록에 추가했습니다.', 'success');
                        } catch (err) {
                          toast(`추가에 실패했습니다: ${err.message || err}`, 'error');
                        }
                      },
                    }, '+ 추가'),
                  ])
                );
              });
              resultBox.append(list);
            } catch (e) {
              resultBox.innerHTML = '';
              resultBox.append(el('div', { class: 'text-muted', style: 'color:#ef4444' }, `검색에 실패했습니다: ${e.message}`));
            }
          });
        },
      });
    }

    function openItemForm(existing) {
      openModal({
        title: existing ? '문화생활 수정' : '문화생활 등록',
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });

          // 포스터: URL 직접 입력 또는 이미지 파일 업로드 중 하나를 쓸 수 있다(업로드하면 URL 칸에
          // data URL로 채워져 미리보기가 바로 바뀐다 — 별도 파일 저장소 없이도 카드에 바로 반영된다).
          const posterInput = el('input', { class: 'nm-input', type: 'url', name: 'poster_url', placeholder: 'https://...', value: existing?.poster_url || '' });
          const posterPreview = el('img', {
            src: existing?.poster_url || '', alt: '', style: `width:60px; height:84px; object-fit:cover; border-radius:6px; ${existing?.poster_url ? '' : 'display:none'}`,
          });
          posterInput.addEventListener('input', () => {
            posterPreview.src = posterInput.value;
            posterPreview.style.display = posterInput.value ? '' : 'none';
          });
          const posterFileInput = el('input', { type: 'file', accept: 'image/*', class: 'hidden' });
          posterFileInput.addEventListener('change', async () => {
            const file = posterFileInput.files?.[0];
            if (!file) return;
            if (file.size > 4 * 1024 * 1024) { toast('이미지 파일이 너무 큽니다(최대 4MB).', 'error'); return; }
            const dataUrl = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = () => reject(new Error('파일을 읽는 중 오류가 발생했습니다.'));
              reader.readAsDataURL(file);
            });
            posterInput.value = dataUrl;
            posterPreview.src = dataUrl;
            posterPreview.style.display = '';
          });
          const posterField = field('포스터(선택)', el('div', { class: 'row', style: 'gap:8px; align-items:center' }, [
            el('div', { style: 'flex:1' }, [posterInput]),
            el('button', { type: 'button', class: 'nm-btn', onclick: () => posterFileInput.click() }, '📁 파일'),
            posterFileInput,
            posterPreview,
          ]));

          form.append(
            field('종류', typeSelect(existing?.content_type)),
            field('제목', el('input', { class: 'nm-input', name: 'title', required: true, value: existing?.title || '' })),
            field('감독/아티스트/작가(선택)', el('input', { class: 'nm-input', name: 'creator', value: existing?.creator || '' })),
            field('상태', statusSelect(existing?.status)),
            field('관람/관람예정일(선택)', el('input', { class: 'nm-input', type: 'date', name: 'event_date', value: existing?.event_date || '' })),
            field('시간(선택)', el('input', { class: 'nm-input', type: 'time', name: 'event_time', value: existing?.event_time || '' })),
            field('장소(선택)', el('input', { class: 'nm-input', name: 'venue_name', value: existing?.venue_name || '' })),
            posterField,
            field('별점(1-5, 선택)', el('input', { class: 'nm-input', type: 'number', min: '1', max: '5', name: 'rating', value: existing?.rating || '' })),
            field('한줄평(선택)', el('textarea', { class: 'nm-textarea', name: 'review' }, existing?.review || ''))
          );
          const submitBtn = el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장');
          form.append(submitBtn);
          // 등록(신규) 시에도 파일을 바로 첨부할 수 있도록, 저장 직후 폼 자리에 첨부 패널을 보여준다
          // (기존에는 저장→모달 닫힘 이후 다시 열어야만 📎 버튼으로 첨부할 수 있었다).
          const attachHost = el('div', {});
          body.append(form, attachHost);
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
            try {
              if (existing) {
                await appState.updatePlaylistItem(existing.id, data);
                toast('저장했습니다.', 'success');
                close();
              } else {
                const row = await appState.addPlaylistItem(data);
                toast('등록했습니다. 이제 파일을 첨부할 수 있어요.', 'success');
                // 폼 입력을 잠그고 첨부 패널 + 닫기 버튼으로 전환한다(중복 등록 방지).
                Array.from(form.elements).forEach((elm) => { elm.disabled = true; });
                submitBtn.style.display = 'none';
                attachHost.append(
                  el('h3', { style: 'margin:16px 0 8px' }, '첨부파일'),
                  el('div', { id: 'new-item-attach-box' }),
                  el('button', { class: 'nm-btn nm-btn--primary', style: 'width:100%; margin-top:12px', onclick: close }, '완료')
                );
                window.renderAttachmentsPanel(attachHost.querySelector('#new-item-attach-box'), 'playlist_items', row.id);
              }
            } catch (err) {
              toast(`저장에 실패했습니다: ${err.message || err}`, 'error');
            }
          });
          if (existing) {
            attachHost.append(el('h3', { style: 'margin:16px 0 8px' }, '첨부파일'));
            const attachBox = el('div', {});
            attachHost.append(attachBox);
            window.renderAttachmentsPanel(attachBox, 'playlist_items', existing.id);
          }
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
