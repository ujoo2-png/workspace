// v7.24.0 — "Coterie" 스타일 벤토(bento) 홈. 일반 <script>. home.js 다음에 로드한다.
// 설정 "홈 화면 스타일"이 bento(기본)이면 이 화면을, classic이면 기존 renderHome을 보여 준다.
(function () {
  const { appState, el, todayISO, diffDays, navigate } = window;

  window.getHomeStyle = function () {
    try { return window.settingsSync.get('workspace:homeStyle') === 'classic' ? 'classic' : 'bento'; } catch { return 'bento'; }
  };

  const emojiOf = (label) => {
    if (/눈/.test(label)) return '❄️';
    if (/뇌우|천둥/.test(label)) return '⛈️';
    if (/비|소나기/.test(label)) return '🌧️';
    if (/안개/.test(label)) return '🌫️';
    if (/맑/.test(label)) return '☀️';
    if (/구름|흐/.test(label)) return /조금/.test(label) ? '🌤️' : '☁️';
    return '🌡️';
  };

  const tile = (cls, kids, onClick, title) => el('section', {
    class: `bento-tile ${cls}`, onclick: onClick || undefined, title: title || undefined,
    style: onClick ? 'cursor:pointer' : '', 'data-bento': cls.split(' ')[0],
  }, kids);
  const head = (t, sub) => el('div', { class: 'bento-head' }, [el('span', { class: 'bento-head__t' }, t), sub ? el('span', { class: 'bento-head__s' }, sub) : null]);

  function renderHomeBento(root) {
    const wrap = el('div', { class: 'bento', 'data-home-style': 'bento' });
    root.append(wrap);
    let weather = null;
    let timer = null;

    function clockText(tz) {
      const now = new Date();
      return {
        time: new Intl.DateTimeFormat('ko-KR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now),
        date: new Intl.DateTimeFormat('ko-KR', { timeZone: tz, month: 'long', day: 'numeric', weekday: 'short' }).format(now),
      };
    }

    function draw() {
      wrap.innerHTML = '';
      const today = todayISO();
      const hour = new Date().getHours();
      const hello = hour < 11 ? '좋은 아침이에요' : hour < 18 ? '좋은 오후예요' : '수고 많으셨어요';
      const name = appState.user?.name || appState.user?.email?.split('@')[0] || '';
      const todays = appState.schedules.filter((s) => window.scheduleCoversDate(s, today)).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
      const left = todays.filter((s) => !s.done).length;
      const unread = appState.notifications.filter((n) => !n.is_read).length;
      const active = appState.projects.filter((p) => p.status === 'in_progress' && !p.deleted_at);
      const due = active.filter((p) => p.deadline && diffDays(today, p.deadline) >= 0 && diffDays(today, p.deadline) <= 7);
      const lastProg = (p) => { const r = (appState.progressByProject[p.id] || []).slice().sort((a, b) => (a.recorded_at < b.recorded_at ? -1 : 1)); return r.length ? Number(r[r.length - 1].progress) || 0 : 0; };

      // 1) 인사 + 시계 (큰 타일)
      const zones = window.getClockZones();
      const z0 = zones[0];
      const ct = clockText(z0.id);
      wrap.append(tile('bento-hero', [
        el('div', { class: 'bento-hero__hello' }, `${hello}${name ? `, ${name}` : ''}`),
        el('div', { class: 'bento-hero__time', 'data-bento-clock': z0.id }, ct.time),
        el('div', { class: 'bento-hero__date', 'data-bento-date': z0.id }, `${z0.label} · ${ct.date}`),
        el('div', { class: 'bento-hero__chips' }, [
          el('span', { class: 'bento-chip' }, `오늘 남은 일정 ${left}`),
          el('span', { class: 'bento-chip' }, `D-7 마감 ${due.length}`),
          el('span', { class: 'bento-chip' }, `알림 ${unread}`),
        ]),
      ]));

      // 2) 날씨
      const w = weather && weather[0];
      wrap.append(tile('bento-weather', [
        head('날씨', w ? w.city : ''),
        w ? el('div', { class: 'bento-weather__main' }, [
          el('span', { class: 'bento-weather__icon' }, emojiOf(window.weatherCodeToLabel(w.code))),
          el('span', { class: 'bento-weather__temp' }, w.temp === null ? '-' : `${Math.round(w.temp)}°`),
        ]) : el('div', { class: 'text-muted' }, weather === null ? '불러오는 중…' : '날씨 정보 없음'),
        w ? el('div', { class: 'bento-sub' }, window.weatherCodeToLabel(w.code)) : null,
      ], () => navigate('/settings'), '날씨 지역은 설정에서 바꿀 수 있어요'));

      // 3) 다른 시계(있을 때)
      if (zones.length > 1) {
        wrap.append(tile('bento-worldclock', [
          head('세계 시계'),
          ...zones.slice(1).map((z) => { const t = clockText(z.id); return el('div', { class: 'bento-wc' }, [
            el('span', {}, z.label), el('b', { 'data-bento-clock': z.id }, t.time)]); }),
        ]));
      }

      // 4) 오늘 일정
      wrap.append(tile('bento-today', [
        head('오늘 일정', `${todays.length}건`),
        todays.length
          ? el('ul', { class: 'bento-list' }, todays.slice(0, 5).map((s) => el('li', { class: s.done ? 'is-done' : '' }, [
            el('span', { class: 'bento-list__time' }, s.time || '종일'), el('span', {}, `${window.scheduleCategoryEmoji ? window.scheduleCategoryEmoji(s.category) : ''} ${s.title}`)])))
          : el('div', { class: 'text-muted' }, '오늘은 일정이 없어요'),
      ], () => navigate('/schedule')));

      // 5) 진행 중 프로젝트
      wrap.append(tile('bento-projects', [
        head('진행 중 프로젝트', `${active.length}개`),
        active.length
          ? el('div', { class: 'bento-bars' }, active.slice(0, 4).map((p) => { const v = Math.round(lastProg(p)); return el('div', { class: 'bento-bar' }, [
            el('div', { class: 'bento-bar__l' }, [el('span', {}, p.name || p.title || '프로젝트'), el('b', {}, `${v}%`)]),
            el('div', { class: 'bento-bar__t' }, el('div', { class: 'bento-bar__f', style: `width:${Math.min(100, v)}%` }))]); }))
          : el('div', { class: 'text-muted' }, '진행 중인 프로젝트가 없어요'),
      ], () => navigate('/projects')));

      // 6) 알림 KPI
      wrap.append(tile('bento-kpi', [head('안 읽은 알림'), el('div', { class: 'bento-kpi__v' }, String(unread))], () => { if (window.openNotifications) window.openNotifications(); else navigate('/home'); }));

      // 7) D-day
      const dd = (appState.ddays || []).length ? window.sortDdays(appState.ddays, today).slice(0, 3) : [];
      wrap.append(tile('bento-dday', [
        head('D-day'),
        dd.length ? el('ul', { class: 'bento-list' }, dd.map((d) => { const n = diffDays(today, d.target_date); return el('li', {}, [
          el('span', { class: 'bento-list__time' }, n === 0 ? 'D-Day' : n > 0 ? `D-${n}` : `D+${-n}`), el('span', {}, d.title || d.name || '')]); }))
          : el('div', { class: 'text-muted' }, '등록된 D-day가 없어요'),
      ]));

      // 8) 바로가기 (자주 쓰는 프로그램/즐겨찾기)
      const progs = appState.programs.slice().sort((a, b) => (b.run_count || 0) - (a.run_count || 0)).slice(0, 6);
      const marks = appState.bookmarks.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).slice(0, 6);
      wrap.append(tile('bento-links', [
        head('바로가기'),
        el('div', { class: 'bento-pills' }, [
          ...marks.map((b) => el('button', { class: 'bento-pill', onclick: (e) => { e.stopPropagation(); appState.openBookmark(b.id); } }, `⭐ ${b.name || b.title || b.url}`)),
          ...progs.map((p) => el('button', { class: 'bento-pill', onclick: (e) => { e.stopPropagation(); appState.runProgram(p.id); } }, `🧩 ${p.name}`)),
          !marks.length && !progs.length ? el('span', { class: 'text-muted' }, '프로그램/즐겨찾기를 등록하면 여기에 나와요') : null,
        ]),
      ]));
    }

    function tick() {
      for (const n of wrap.querySelectorAll('[data-bento-clock]')) n.textContent = clockText(n.getAttribute('data-bento-clock')).time;
    }

    draw();
    window.fetchWeatherForCities().then((r) => { weather = r.filter(Boolean); draw(); }).catch(() => { weather = []; draw(); });
    timer = setInterval(tick, 1000);
    appState.addEventListener('change', draw);
    return () => { appState.removeEventListener('change', draw); clearInterval(timer); };
  }

  window.renderHomeBento = renderHomeBento;
  window.renderHomeRoute = function (root) {
    return window.getHomeStyle() === 'classic' ? window.renderHome(root) : renderHomeBento(root);
  };
})();
