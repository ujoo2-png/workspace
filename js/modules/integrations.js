// Integrations 화면. 외부 서비스 연동 상태를 관리한다.
// 이 MVP 단계에서는 실제 OAuth 연동 없이 "연동 예정/보류" 상태만 기록한다.
// (메일 계정별 수집은 사용자 요청에 따라 고도화 단계로 보류됨 — 여기서 상태만 표시)
// 일반 <script>로 로드된다.
(function () {
  const { appState, el, escapeHtml, toast } = window;

  const PROVIDERS = [
    { key: 'gmail', label: 'Gmail', icon: '📧', note: '메일 계정별 수집 — 고도화 단계에서 진행 예정', available: false },
    { key: 'google_calendar', label: 'Google Calendar', icon: '🗓️', note: '일정 양방향 동기화 — 준비 중', available: false },
    { key: 'notion', label: 'Notion', icon: '📓', note: 'Knowledge 문서 가져오기 — 준비 중', available: false },
    { key: 'slack', label: 'Slack', icon: '💬', note: '알림 전달 — 준비 중', available: false },
  ];

  const STATUS_LABEL = { connected: '연동됨', pending: '연동 예정', disabled: '사용 안 함' };

  function renderIntegrations(root) {
    const container = el('div', {});
    root.append(container);

    function draw() {
      container.innerHTML = '';
      container.append(el('div', { class: 'page-header' }, [el('h1', {}, 'Integrations')]));
      container.append(
        el('p', { class: 'text-muted', style: 'margin-bottom:16px' }, '외부 서비스 연동은 현재 준비 중입니다. 연동 우선순위를 미리 표시해두면 고도화 시 참고합니다.')
      );

      container.append(refCard());
      container.append(openmaicCard());

      const list = el('div', { class: 'item-list' });
      for (const p of PROVIDERS) {
        const stored = appState.integrations.find((i) => i.provider === p.key);
        const status = stored?.status || 'pending';
        list.append(
          el('div', { class: 'item-row' }, [
            el('span', { style: 'font-size:20px' }, p.icon),
            el('div', { class: 'item-row__main' }, [
              el('div', { class: 'item-row__title' }, escapeHtml(p.label)),
              el('div', { class: 'item-row__meta' }, escapeHtml(p.note)),
            ]),
            el('select', {
              class: 'nm-select',
              style: 'width:120px',
              value: status,
              disabled: p.available ? undefined : true,
              onchange: async (e) => {
                await appState.setIntegrationStatus(p.key, e.target.value);
                toast('저장했습니다.', 'success');
              },
            }, Object.entries(STATUS_LABEL).map(([value, label]) => el('option', { value, selected: value === status || undefined }, label))),
          ])
        );
      }
      container.append(el('div', { class: 'nm-card' }, [el('h3', {}, '연동 가능 서비스'), list]));
    }

    draw();
    appState.addEventListener('change', draw);
    return () => appState.removeEventListener('change', draw);
  }

  // ---- 디자인 레퍼런스 카드 (v7.27.0, Refero 대체 · 전부 무료/키 불필요) ----
  function refCard() {
    const R = window.RefService;
    const state = { tab: 'search', src: 'openverse', page: 1, lastQ: '', last: [] };
    const status = el('div', { class: 'text-muted', id: 'ref-status', style: 'font-size:12.5px; min-height:18px; margin-top:8px' });
    const body = el('div', { id: 'ref-body', style: 'margin-top:8px' });
    const setStatus = (t, err) => { status.textContent = t; status.style.color = err ? 'var(--danger)' : ''; };
    const tabs = [['search', '🔎 검색'], ['arena', '🗂 Are.na 채널'], ['gallery', '🧭 갤러리 바로가기'], ['board', '📌 내 보드']];
    const tabRow = el('div', { class: 'row wrap', style: 'gap:6px' });

    function thumb(it, opts = {}) {
      const saved = R.getBoard().some((b) => b.link === it.link || (b.img && b.img === it.thumb));
      const pin = el('button', { type: 'button', class: 'nm-btn ref-pin', title: '내 보드에 저장', 'aria-label': '내 보드에 저장', 'data-pin': it.key || '', onclick: (e) => {
        e.preventDefault();
        try { const r = R.addToBoard({ title: it.title, img: it.thumb, link: it.link, tags: opts.tags || '' }); pin.textContent = '✓'; setStatus(r.added ? '내 보드에 저장했어요.' : '이미 보드에 있어요.'); } catch (er) { setStatus(er.message, true); }
      } }, saved ? '✓' : '📌');
      return el('figure', { class: 'ref-item' }, [
        el('a', { href: it.link, target: '_blank', rel: 'noopener noreferrer', title: it.title }, el('img', { src: it.thumb, alt: it.title, loading: 'lazy', referrerpolicy: 'no-referrer' })),
        pin,
        el('figcaption', {}, [el('span', { class: 'ref-cap' }, it.title), it.by || it.license ? el('span', { class: 'ref-by' }, [it.by, it.license].filter(Boolean).join(' · ')) : null]),
      ]);
    }
    const grid = (items, tags) => el('div', { class: 'ref-grid' }, items.map((it) => thumb(it, { tags })));

    function drawSearch() {
      const q = el('input', { class: 'nm-input', id: 'ref-q', value: state.lastQ, placeholder: '찾을 디자인 (예: dashboard ui, login screen, pricing page)', 'aria-label': '레퍼런스 검색어', style: 'flex:1; min-width:200px' });
      const sel = el('select', { class: 'nm-select', id: 'ref-src', 'aria-label': '검색 소스', onchange: (e) => { state.src = e.target.value; } }, [
        el('option', { value: 'openverse' }, 'Openverse (사진·일러스트)'), el('option', { value: 'commons' }, 'Wikimedia Commons'),
      ]);
      sel.value = state.src;
      const out = el('div', { id: 'ref-results' });
      const more = el('button', { type: 'button', class: 'nm-btn', id: 'ref-more', style: 'display:none; margin-top:8px', onclick: () => run(state.page + 1) }, '더 보기');
      async function run(page) {
        const text = q.value.trim(); if (!text) return;
        if (page === 1) { out.innerHTML = ''; state.lastQ = text; }
        state.page = page; setStatus('검색 중…');
        try {
          const items = await (state.src === 'commons' ? R.searchCommons(text, page) : R.searchOpenverse(text, page));
          if (page === 1 && !items.length) { setStatus('결과가 없어요. 영어 키워드나 갤러리 바로가기를 써 보세요.'); more.style.display = 'none'; return; }
          out.append(grid(items)); setStatus(`"${text}" — ${out.querySelectorAll('.ref-item').length}개`); more.style.display = items.length >= 24 ? '' : 'none';
        } catch (e) { setStatus(`⚠️ ${e.message}`, true); }
      }
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) run(1); });
      body.append(
        el('div', { class: 'row wrap', style: 'gap:6px' }, [q, sel, el('button', { type: 'button', class: 'nm-btn nm-btn--primary', id: 'ref-go', onclick: () => run(1) }, '검색')]),
        el('p', { class: 'text-muted', style: 'font-size:12px; margin:6px 0' }, 'Openverse/Commons는 사진·일러스트 중심이라 앱 화면은 적어요. 실제 서비스 화면은 "갤러리 바로가기"가 더 잘 나와요.'),
        out, more,
      );
    }

    function drawArena() {
      const inp = el('input', { class: 'nm-input', id: 'ref-arena', placeholder: 'Are.na 채널 주소 (예: https://www.are.na/사용자/채널-이름)', 'aria-label': 'Are.na 채널 주소', style: 'flex:1; min-width:240px' });
      const out = el('div', {});
      const go = async () => {
        out.innerHTML = ''; setStatus('불러오는 중…');
        try { const r = await R.arenaChannel(inp.value); setStatus(`"${r.title}" — ${r.items.length}개 (전체 ${r.total}개 중)`); out.append(r.items.length ? grid(r.items, 'arena') : el('div', { class: 'text-muted' }, '이미지가 없는 채널이에요.')); }
        catch (e) { setStatus(`⚠️ ${e.message}`, true); }
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) go(); });
      body.append(
        el('div', { class: 'row wrap', style: 'gap:6px' }, [inp, el('button', { type: 'button', class: 'nm-btn nm-btn--primary', id: 'ref-arena-go', onclick: go }, '불러오기')]),
        el('p', { class: 'text-muted', style: 'font-size:12px; margin:6px 0' }, [
          '디자이너들이 모아 둔 공개 채널을 그대로 볼 수 있어요(로그인·키 불필요). 채널은 ',
          el('a', { href: 'https://www.are.na/search', target: '_blank', rel: 'noopener noreferrer' }, 'are.na'), '에서 "ui", "dashboard" 등으로 찾아 주소를 붙여 넣으세요.',
        ]), out,
      );
    }

    function drawGallery() {
      const q = el('input', { class: 'nm-input', id: 'ref-gq', value: state.lastQ, placeholder: '키워드 (예: dashboard, onboarding, calendar)', 'aria-label': '갤러리 검색어', style: 'flex:1; min-width:200px' });
      const out = el('div', { class: 'ref-links', id: 'ref-glinks' });
      const draw = () => {
        out.innerHTML = ''; const text = q.value.trim(); state.lastQ = text;
        if (!text) { out.append(el('div', { class: 'text-muted' }, '키워드를 입력하면 각 갤러리의 검색 결과 링크가 만들어져요.')); return; }
        R.galleryLinks(text).forEach((g) => out.append(el('a', { class: 'ref-link', href: g.url, target: '_blank', rel: 'noopener noreferrer' }, [el('b', {}, g.name), el('span', { class: 'text-muted' }, g.note)])));
      };
      q.addEventListener('input', draw);
      body.append(el('div', { class: 'row wrap', style: 'gap:6px' }, [q]), el('p', { class: 'text-muted', style: 'font-size:12px; margin:6px 0' }, '각 사이트는 새 탭에서 열려요(이 앱은 키워드만 사용하고 아무것도 보내지 않아요). 마음에 드는 화면은 "내 보드"에 주소로 저장하세요.'), out);
      draw();
    }

    function drawBoard() {
      const all = R.getBoard();
      const tagFilter = state.tag || '';
      const list = tagFilter ? all.filter((b) => b.tags.includes(tagFilter)) : all;
      const url = el('input', { class: 'nm-input', id: 'ref-add-url', placeholder: '저장할 사이트 또는 이미지 주소 (https://…)', 'aria-label': '저장할 주소', style: 'flex:1; min-width:220px' });
      const ttl = el('input', { class: 'nm-input', id: 'ref-add-title', placeholder: '제목(선택)', 'aria-label': '제목', style: 'width:160px' });
      const tag = el('input', { class: 'nm-input', id: 'ref-add-tags', placeholder: '태그(쉼표/공백)', 'aria-label': '태그', style: 'width:150px' });
      const add = () => {
        const u = R.safeUrl(url.value); if (!u) { setStatus('http(s)로 시작하는 주소를 입력해 주세요.', true); return; }
        const isImg = /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i.test(new URL(u).pathname + new URL(u).search);
        try { const r = R.addToBoard({ title: ttl.value, link: u, img: isImg ? u : R.screenshotUrl(u), tags: tag.value }); setStatus(r.added ? '보드에 저장했어요.' : '이미 보드에 있어요.'); redraw(); } catch (e) { setStatus(e.message, true); }
      };
      body.append(el('div', { class: 'row wrap', style: 'gap:6px' }, [url, ttl, tag, el('button', { type: 'button', class: 'nm-btn nm-btn--primary', id: 'ref-add', onclick: add }, '저장')]));
      const tags = [...new Set(all.flatMap((b) => b.tags))];
      if (tags.length) body.append(el('div', { class: 'row wrap', style: 'gap:6px; margin-top:8px' }, [
        el('button', { type: 'button', class: `nm-btn${tagFilter ? '' : ' nm-btn--primary'}`, onclick: () => { state.tag = ''; redraw(); } }, '전체'),
        ...tags.map((t) => el('button', { type: 'button', class: `nm-btn${tagFilter === t ? ' nm-btn--primary' : ''}`, onclick: () => { state.tag = t; redraw(); } }, `#${t}`)),
      ]));
      if (!list.length) { body.append(el('div', { class: 'text-muted', style: 'margin-top:10px' }, all.length ? '이 태그의 항목이 없어요.' : '아직 저장한 레퍼런스가 없어요. 검색 결과의 📌 또는 위 입력칸으로 추가해 보세요.')); return; }
      body.append(el('div', { class: 'ref-grid', style: 'margin-top:10px' }, list.map((b) => {
        const imgSrc = R.safeUrl(b.img);
        const del = el('button', { type: 'button', class: 'nm-btn ref-pin', title: '삭제', 'aria-label': '삭제', 'data-del': b.id, onclick: () => { R.removeFromBoard(b.id); redraw(); } }, '✕');
        const meta = el('input', { class: 'nm-input ref-note', value: [...b.tags.map((t) => `#${t}`), b.note].filter(Boolean).join(' '), placeholder: '#태그 메모', 'aria-label': '태그와 메모', onchange: (e) => {
          const raw = e.target.value; const tg = raw.match(/#[^\s#]+/g) || []; R.updateBoard(b.id, { tags: tg.join(' ').replace(/#/g, ' '), note: raw.replace(/#[^\s#]+/g, '').trim() }); setStatus('저장했어요.');
        } });
        return el('figure', { class: 'ref-item' }, [
          el('a', { href: b.link, target: '_blank', rel: 'noopener noreferrer', title: b.title }, imgSrc ? el('img', { src: imgSrc, alt: b.title, loading: 'lazy', referrerpolicy: 'no-referrer' }) : el('div', { class: 'ref-noimg' }, '🔗')),
          del, el('figcaption', {}, [el('span', { class: 'ref-cap' }, b.title), meta]),
        ]);
      })));
    }

    function redraw() {
      tabRow.innerHTML = '';
      tabs.forEach(([k, label]) => tabRow.append(el('button', { type: 'button', class: `nm-btn${state.tab === k ? ' nm-btn--primary' : ''}`, 'data-tab': k, onclick: () => { state.tab = k; setStatus(''); redraw(); } }, label)));
      body.innerHTML = '';
      ({ search: drawSearch, arena: drawArena, gallery: drawGallery, board: drawBoard })[state.tab]();
    }
    redraw();
    return el('div', { class: 'nm-card', id: 'ref-card', style: 'margin-bottom:16px' }, [
      el('h3', {}, '🎨 디자인 레퍼런스'),
      el('p', { class: 'text-muted', style: 'font-size:12.5px; margin:4px 0 10px' }, '유료 Refero 대신 무료 소스를 모았어요. 로그인·API 키·서버 중계 없이 이 브라우저에서 바로 동작하고, 저장하는 건 주소·메모·태그뿐이에요(기기 간 동기화).'),
      tabRow, body, status,
    ]);
  }

  // ---- OpenMAIC(AI 교실) 바로가기 카드 (v7.28.0) ----
  // OpenMAIC은 Next.js 앱이라 이 앱 안에 넣을 수 없다. 대신 주소(공개 데모 또는 내가 배포한 주소)를 저장해 두고
  // 새 탭으로 열며, 만든 수업 링크를 모아 둔다. 주소·링크만 저장(키/토큰은 저장하지 않음), 기기 간 동기화.
  const MAIC_KEY = 'workspace:openmaic';
  const MAIC_DEFAULT = 'https://open.maic.chat';
  function maicGet() {
    try { const v = JSON.parse(window.settingsSync.get(MAIC_KEY) || 'null') || {}; const R = window.RefService;
      return { url: R.safeUrl(v.url) || MAIC_DEFAULT, links: (Array.isArray(v.links) ? v.links : []).filter((l) => l && l.id && R.safeUrl(l.url)).slice(0, 30) };
    } catch { return { url: MAIC_DEFAULT, links: [] }; }
  }
  function maicSet(m) { window.settingsSync.set(MAIC_KEY, JSON.stringify({ url: m.url, links: m.links.slice(0, 30) })); }
  function openmaicCard() {
    const R = window.RefService;
    const status = el('div', { class: 'text-muted', id: 'maic-status', style: 'font-size:12.5px; min-height:18px; margin-top:6px' });
    const body = el('div', {});
    const say = (t, err) => { status.textContent = t; status.style.color = err ? 'var(--danger)' : ''; };
    function draw() {
      const m = maicGet(); body.innerHTML = '';
      const url = el('input', { class: 'nm-input', id: 'maic-url', value: m.url, 'aria-label': 'OpenMAIC 주소', style: 'flex:1; min-width:220px' });
      body.append(el('div', { class: 'row wrap', style: 'gap:6px' }, [
        url,
        el('button', { type: 'button', class: 'nm-btn', id: 'maic-save', onclick: () => { const u = R.safeUrl(url.value); if (!u) { say('http(s)로 시작하는 주소를 입력해 주세요.', true); return; } maicSet({ ...maicGet(), url: u }); say('주소를 저장했어요.'); draw(); } }, '주소 저장'),
        el('a', { class: 'nm-btn nm-btn--primary', id: 'maic-open', href: m.url, target: '_blank', rel: 'noopener noreferrer' }, 'OpenMAIC 열기 ↗'),
      ]));
      const t = el('input', { class: 'nm-input', id: 'maic-title', placeholder: '수업 이름', 'aria-label': '수업 이름', style: 'width:170px' });
      const u2 = el('input', { class: 'nm-input', id: 'maic-link', placeholder: '만든 수업 링크 (https://…)', 'aria-label': '수업 링크', style: 'flex:1; min-width:200px' });
      body.append(el('div', { class: 'row wrap', style: 'gap:6px; margin-top:10px' }, [t, u2, el('button', { type: 'button', class: 'nm-btn', id: 'maic-add', onclick: () => {
        const lu = R.safeUrl(u2.value); if (!lu) { say('수업 링크는 http(s) 주소여야 해요.', true); return; }
        const cur = maicGet(); if (cur.links.length >= 30) { say('수업 링크는 최대 30개예요.', true); return; }
        if (cur.links.some((l) => l.url === lu)) { say('이미 있는 링크예요.'); return; }
        const title = String(t.value || '').replace(/<[^>]*>/g, '').trim().slice(0, 80) || lu;
        maicSet({ ...cur, links: [{ id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, title, url: lu }, ...cur.links] }); say('저장했어요.'); draw();
      } }, '링크 저장')]));
      if (m.links.length) body.append(el('div', { class: 'stack', style: 'gap:4px; margin-top:8px' }, m.links.map((l) => el('div', { class: 'row', style: 'gap:8px; justify-content:space-between' }, [
        el('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.title),
        el('button', { type: 'button', class: 'nm-btn', 'data-maic-del': l.id, 'aria-label': '삭제', onclick: () => { const c = maicGet(); maicSet({ ...c, links: c.links.filter((x) => x.id !== l.id) }); draw(); } }, '✕'),
      ]))));
      body.append(el('details', { style: 'margin-top:10px; font-size:12.5px' }, [
        el('summary', {}, '무료로 직접 배포하는 방법 (내 주소 만들기)'),
        el('ol', { style: 'margin:6px 0 0 18px; line-height:1.7' }, [
          el('li', {}, ['GitHub에서 ', el('a', { href: 'https://github.com/THU-MAIC/OpenMAIC', target: '_blank', rel: 'noopener noreferrer' }, 'THU-MAIC/OpenMAIC'), '를 Fork (MIT 라이선스).']),
          el('li', {}, 'LLM 키가 하나 필요해요. 무료로 시작하려면 Google AI Studio의 Gemini 무료 키(한도 있음)나, 내 PC의 Ollama(키 불필요)를 쓰세요.'),
          el('li', {}, 'Vercel 무료 플랜에서 Fork를 Import → 환경변수에 키 등록(.env.example 참고, 예: GOOGLE_API_KEY) → Deploy. 또는 PC에서 pnpm install → pnpm dev.'),
          el('li', {}, '생긴 주소를 위 칸에 저장하세요. 키는 이 앱에 넣지 마세요(배포한 서버 환경변수에만).'),
        ]),
      ]));
    }
    draw();
    return el('div', { class: 'nm-card', id: 'maic-card', style: 'margin-bottom:16px' }, [
      el('h3', {}, '🎓 OpenMAIC — AI 교실'),
      el('p', { class: 'text-muted', style: 'font-size:12.5px; margin:4px 0 10px' }, '주제나 문서를 넣으면 AI 선생님·반 친구가 슬라이드·퀴즈·실습으로 수업을 만들어 주는 오픈소스(MIT)예요. 별도 앱이라 이 화면에 넣지 않고 바로가기와 수업 링크 보관함으로 연결했어요.'),
      body, status,
    ]);
  }

  window.renderIntegrations = renderIntegrations;
})();
