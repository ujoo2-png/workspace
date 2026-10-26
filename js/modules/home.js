// 홈 화면. 일반 <script>로 로드되며 js/state.js, js/utils/dom.js, js/utils/date.js,
// js/predict.js, js/config.js, js/router.js가 먼저 로드되어야 한다.
(function () {
  const { appState, el, escapeHtml, todayISO, diffDays, weekdayLabel, predictScheduleDensity, predictProjectCompletion, navigate } = window;

  // 알림의 related_table(js/rules.js가 채움)을 눌렀을 때 이동할 메뉴로 매핑한다.
  const NOTI_TARGET = { projects: '/projects', schedules: '/schedule', vehicles: '/vehicles', challenges: '/challenges', playlist_items: '/playlist' };

  // 홈 화면 위젯을 드래그로 순서를 바꿀 수 있게 한다. 순서는 settingsSync(localStorage 캐시 + Supabase)에 저장해두고
  // 다음 방문 때도 유지한다. 새 버전에서 위젯이 추가되면 저장된 순서 뒤에 이어 붙인다.
  const WIDGET_ORDER_KEY = 'workspace:homeWidgetOrder';
  const WIDGET_LABELS = {
    clock: '🕒 시계', kpi: '📌 요약 지표', weather: '☀️ 날씨', alert: '⚠️ 기상특보', summary: '📅 이번 주 활동 요약',
    density: '📊 일정 밀집도 예측', urgent: '⏰ 마감 임박 프로젝트', noti: '🔔 자동 알림', shortcuts: '⭐ 즐겨찾기 바로가기',
    recent: '🕘 최근 본 항목', programs: '🧩 내 프로그램', knowledge: '📚 최근 Knowledge', dday: '📆 D-day',
  };
  const WIDGET_KEYS = Object.keys(WIDGET_LABELS);
  // 시계 셀별로 "직전에 보여 준 테마"를 기억해 홈이 다시 그려져도 배경이 끊기지 않고 크로스페이드되게 한다.
  const wxShown = new Map(); // zoneId -> theme

  function getHomeWidgetOrder() {
    try {
      const raw = window.settingsSync.get(WIDGET_ORDER_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) {
          const known = parsed.filter((k) => WIDGET_KEYS.includes(k));
          const missing = WIDGET_KEYS.filter((k) => !known.includes(k));
          return [...known, ...missing];
        }
      }
    } catch { /* 손상된 값이면 기본 순서로 복구 */ }
    return WIDGET_KEYS.slice();
  }

  function setHomeWidgetOrder(order) {
    window.settingsSync.set(WIDGET_ORDER_KEY, JSON.stringify(order));
  }

  function renderHome(root) {
    kpiLast.clear(); // 홈에 들어올 때마다 숫자가 0부터 올라가도록
    const container = el('div', {});
    root.append(container);
    let weatherState = { loading: true, data: null };
    const weatherAlertsOn = !!(window.getPublicDataEnabled && window.getPublicDataEnabled().weatherAlerts && window.getPublicDataKey && window.getPublicDataKey());
    let alertState = { loading: weatherAlertsOn, items: weatherAlertsOn ? null : [] };
    let clockTimer = null;
    let supabaseStatus = { checked: false, ok: null };

    // 기상특보(공공데이터포털, 같은 키를 특일정보와 공유) — 설정에서 켰고 키가 있을 때만 불러온다.
    // weatherState/loadWeather()와 동일한 패턴: draw() 도중이 아니라 렌더 함수 정의가 끝난 뒤
    // 한 번만 호출한다(draw() 안에서 호출하면 container를 이중으로 채우는 중첩 렌더 버그가 생긴다).
    async function loadWeatherAlerts() {
      if (!weatherAlertsOn) return;
      try {
        const items = await window.fetchWeatherAlerts();
        alertState = { loading: false, items };
      } catch (e) {
        alertState = { loading: false, items: [], error: e.message };
      }
      draw();
    }

    async function checkSupabaseConnection() {
      const CONFIG = window.CONFIG;
      if (CONFIG.mode !== 'supabase') { supabaseStatus = { checked: true, ok: null }; draw(); return; }
      try {
        await window.getStore().getSession();
        supabaseStatus = { checked: true, ok: true };
        if (window.markSupabaseActive) window.markSupabaseActive();
      } catch {
        supabaseStatus = { checked: true, ok: false };
      }
      draw();
    }

    // 대한민국(기본) + 최대 2개까지 추가 가능한 여러 도시 시계. 매초 텍스트만 갱신하고
    // (홈 화면 전체를 매초 다시 그리지 않도록) 셀 DOM 참조를 클로저에 보관해 재사용한다.
    // v7.21.0: 각 시계 셀은 "연결 도시"의 날씨(배경 그라디언트/애니메이션 아이콘/입자/"인천 · 오전 비 · 강수확률 70%")를 보여 준다.
    let clockCells = [];
    const clockWx = new Map(); // zoneId -> { city, theme, loading, failed }
    function wxLineContent(z) {
      const st = clockWx.get(z.id);
      if (!st || st.loading) return [el('span', { class: 'skel wx-skel', 'aria-label': '날씨 불러오는 중' })];
      if (!st.theme) return [el('span', { class: 'text-muted wx-line__text', style: 'font-size:11px' }, st.city ? `${st.city.name} · 날씨 정보 없음` : '연결 도시 없음')];
      return [
        window.WeatherFx.weatherIcon(st.theme.condition, st.theme.isNight, 28, window.WeatherFx.toneOf(st.theme)),
        el('span', { class: 'wx-line__text', 'data-wx-caption': '' }, `${st.city.name} · ${st.theme.caption}`),
      ];
    }
    function clockCard() {
      const zones = window.getClockZones();
      clockCells = [];
      const card = el('div', { class: 'nm-card clock-card', style: 'margin-bottom:16px' }, [
        el('div', { class: 'row row--between' }, [
          el('h3', {}, '🕒 시계'),
          el('button', { class: 'nm-btn nm-btn--icon', title: '시계 설정(지역·연결 도시)', onclick: openClockSettings }, '⚙️'),
        ]),
      ]);
      const grid = el('div', { class: 'clock-grid', style: 'margin-top:8px' });
      for (const z of zones) {
        const { time, date } = window.formatZoneTime(z.id);
        const timeEl = el('div', { style: 'font-size:22px; font-weight:800; font-variant-numeric:tabular-nums' }, time);
        const dateEl = el('div', { class: 'text-muted', style: 'font-size:11px' }, date);
        const lineEl = el('div', { class: 'wx-line' }, wxLineContent(z));
        const layers = window.WeatherFx.createLayers();
        const cell = el('div', { class: 'clock-grid__cell wx-cell', 'data-zone': z.id }, [
          layers.bg, layers.fx,
          el('div', { class: 'wx-content' }, [
            el('div', { class: 'text-muted', style: 'font-size:12px' }, z.label),
            timeEl,
            dateEl,
            lineEl,
          ]),
        ]);
        // 마우스 위치에 따라 해/구름이 아주 조금 따라 움직이는 패럴랙스(transform 계열 translate만)
        cell.addEventListener('pointermove', (e) => {
          if (!window.HomeFx.motionOn()) return;
          const r = cell.getBoundingClientRect();
          cell.style.setProperty('--px', `${(((e.clientX - r.left) / r.width) - 0.5) * 10}px`);
          cell.style.setProperty('--py', `${(((e.clientY - r.top) / r.height) - 0.5) * 6}px`);
        });
        cell.addEventListener('pointerleave', () => { cell.style.setProperty('--px', '0px'); cell.style.setProperty('--py', '0px'); });
        clockCells.push({ zone: z, timeEl, dateEl, lineEl, cell });
        grid.append(cell);
        const st = clockWx.get(z.id);
        if (st && st.theme) window.WeatherFx.applyTheme(cell, st.theme, wxShown.get(z.id) || null, z.id);
      }
      card.append(grid);
      return card;
    }

    function tickClocks() {
      for (const { zone, timeEl, dateEl } of clockCells) {
        const { time, date } = window.formatZoneTime(zone.id);
        timeEl.textContent = time;
        dateEl.textContent = date;
      }
      const hc = container.querySelector('[data-hero-clock]');
      if (hc) hc.textContent = window.formatZoneTime('Asia/Seoul').time;
    }

    // 연결 도시의 예보를 가져와(번들 캐시 공유 — 날씨 위젯과 중복 호출 없음) 셀을 제자리에서 갱신한다(홈 전체를 다시 그리지 않는다).
    async function loadClockWeather() {
      const zones = window.getClockZones();
      let anyLoading = false;
      for (const z of zones) {
        const city = window.resolveClockCity(z.id);
        const prev = clockWx.get(z.id);
        const sameCity = prev && prev.city && city && prev.city.name === city.name;
        if (!sameCity || !prev.theme) { clockWx.set(z.id, { city, theme: prev ? prev.theme : null, loading: true }); anyLoading = true; }
      }
      if (anyLoading) paintClockWeather();
      await Promise.all(zones.map(async (z) => {
        const city = window.resolveClockCity(z.id);
        if (!city) { clockWx.set(z.id, { city: null, theme: null, loading: false }); return; }
        const r = await window.fetchThemeForecast(city).catch(() => null);
        const theme = r ? window.weatherTheme(r.day, r.hour) : null;
        clockWx.set(z.id, { city, theme, loading: false, source: r ? r.source : null });
      }));
      paintClockWeather();
    }
    function paintClockWeather() {
      for (const c of clockCells) {
        const st = clockWx.get(c.zone.id);
        c.lineEl.replaceChildren(...wxLineContent(c.zone));
        if (st && st.theme) {
          window.WeatherFx.applyTheme(c.cell, st.theme, wxShown.get(c.zone.id) || null, c.zone.id);
          wxShown.set(c.zone.id, st.theme);
          c.cell.title = `${st.city.name} 날씨(${st.source === 'kma' ? '기상청' : 'Open-Meteo'}) · ${st.theme.caption}`;
        } else if (st) {
          window.WeatherFx.applyTheme(c.cell, null, null);
          wxShown.delete(c.zone.id);
        }
      }
    }

    function openClockSettings() {
      window.openModal({
        title: '시계 설정',
        contentBuilder(body, close) {
          let zones = window.getClockZones();
          const wrap = el('div', { class: 'stack' });
          function renderList() {
            wrap.innerHTML = '';
            const list = el('div', { class: 'item-list' });
            zones.forEach((z, idx) => {
              list.append(
                el('div', { class: 'item-row' }, [
                  el('div', { class: 'item-row__main' }, [
                    el('div', { class: 'item-row__title' }, z.label),
                    el('label', { class: 'row', style: 'gap:6px; align-items:center; font-size:12px; margin-top:4px' }, [
                      el('span', { class: 'text-muted' }, '연결 도시(날씨)'),
                      (() => {
                        const cur = window.resolveClockCity(z.id);
                        const sel = el('select', { class: 'nm-select clock-city-select', 'data-zone': z.id, style: 'max-width:160px; padding:4px 8px' },
                          window.clockCityOptions().map((c) => el('option', { value: c.name }, c.name)));
                        if (cur) sel.value = cur.name;
                        sel.addEventListener('change', () => { window.setClockCity(z.id, sel.value); loadClockWeather(); });
                        return sel;
                      })(),
                    ]),
                  ]),
                  idx === 0
                    ? el('span', { class: 'nm-badge' }, '기본')
                    : el('button', {
                        class: 'nm-btn nm-btn--icon nm-btn--danger',
                        title: '삭제',
                        onclick: () => { zones = window.setClockZones(zones.filter((x) => x.id !== z.id)); renderList(); draw(); },
                      }, '🗑'),
                ])
              );
            });
            wrap.append(list);
            const remaining = window.CLOCK_ZONE_PRESETS.filter((p) => !zones.some((z) => z.id === p.id));
            if (zones.length - 1 < window.CLOCK_MAX_EXTRA_ZONES && remaining.length) {
              const select = el('select', { class: 'nm-select' }, remaining.map((p) => el('option', { value: p.id }, p.label)));
              wrap.append(
                el('div', { class: 'row', style: 'gap:8px; margin-top:8px' }, [
                  select,
                  el('button', {
                    class: 'nm-btn nm-btn--primary',
                    onclick: () => {
                      const picked = remaining.find((p) => p.id === select.value);
                      if (!picked) return;
                      zones = window.setClockZones([...zones, picked]);
                      renderList();
                      draw();
                    },
                  }, '+ 추가'),
                ])
              );
            } else if (zones.length - 1 >= window.CLOCK_MAX_EXTRA_ZONES) {
              wrap.append(el('p', { class: 'text-muted', style: 'font-size:12px; margin-top:6px' }, `기본(대한민국) 포함 최대 3개까지 등록할 수 있습니다.`));
            }
          }
          renderList();
          body.append(wrap);
        },
      });
    }

    async function loadWeather() {
      const cities = window.getWeatherCities();
      const results = await window.fetchWeatherForCities(cities);
      weatherState = { loading: false, data: results };
      draw();
    }

    // 날씨 카드를 클릭하면 (1) 그 지역만 즉시 다시 가져와 실시간 동기화하고,
    // (2) 7일 주간예보를 모달로 보여준다(Open-Meteo의 daily 옵션 사용).
    async function openWeatherDetail(city, idx) {
      window.refreshWeatherForCity(city).then((fresh) => {
        if (!fresh) return;
        if (!weatherState.data) weatherState.data = [];
        weatherState.data[idx] = fresh;
        draw();
      });
      showForecastModal(city);
    }

    // 대시보드 상단 연동 상태 배지. 현재는 문화생활(TMDB) API 연결 상태를 보여주며,
    // 향후 다른 외부 연동이 추가되면 여기에 함께 나열한다.
    function integrationStatusBar() {
      const STATUS_LABEL = { connected: '✅ 문화생활 API 연결됨', error: '⚠️ 문화생활 API 연결 오류', unset: '⚪ 문화생활 API 미설정' };
      const status = window.getTmdbStatus ? window.getTmdbStatus() : 'unset';
      const CONFIG = window.CONFIG;
      const dbLabel = CONFIG.mode === 'supabase'
        ? (!supabaseStatus.checked ? '🟡 Supabase 확인 중…' : supabaseStatus.ok ? '✅ Supabase 연결됨' : '⚠️ Supabase 연결 오류')
        : '⚪ 로컬 모드(이 브라우저에만 저장)';
      return el('div', { class: 'row wrap', style: 'gap:8px; margin-bottom:16px' }, [
        el('button', {
          class: `nm-badge ${CONFIG.mode === 'supabase' && supabaseStatus.checked && !supabaseStatus.ok ? 'nm-badge--warning' : ''}`,
          style: 'border:none; cursor:pointer',
          title: '설정 화면에서 데이터 모드를 확인할 수 있습니다.',
          onclick: () => navigate('/settings'),
        }, dbLabel),
        el('button', {
          class: `nm-badge ${status === 'error' ? 'nm-badge--warning' : ''}`,
          style: 'border:none; cursor:pointer',
          title: '설정 화면에서 API 키를 관리할 수 있습니다.',
          onclick: () => navigate('/settings'),
        }, STATUS_LABEL[status] || STATUS_LABEL.unset),
      ]);
    }

    // 입장 애니메이션은 "처음 몇 초"만: 그 사이 데이터가 도착해 홈이 다시 그려져도 애니메이션이 처음부터 다시 시작(깜빡임)하지 않고
    // 경과 시간만큼 건너뛴 채 이어서 재생된다. 이후의 다시 그리기(알림 읽음 등)에는 입장 효과가 없다.
    let enterStart = null;
    const kpiPrev = new Map(); // 라벨 -> 마지막으로 표시한 숫자(변할 때만 count-up)
    function draw() {
      window.HomeFx.applyFxClass();
      container.innerHTML = '';
      const CONFIG = window.CONFIG;
      if (enterStart === null) enterStart = performance.now();
      const enterElapsed = performance.now() - enterStart;
      const entering = window.HomeFx.motionOn() && enterElapsed < 1400;
      container.classList.toggle('fx-enter', entering);
      drawEntering = entering;
      container.style.setProperty('--enter-skip', `${Number.isFinite(enterElapsed) ? Math.round(enterElapsed) : 0}ms`);
      const today = todayISO();
      const todaySchedules = appState.schedules.filter((s) => window.scheduleCoversDate(s, today));
      const dueProjects = appState.projects.filter(
        (p) => p.status === 'in_progress' && p.deadline && diffDays(today, p.deadline) <= 7 && diffDays(today, p.deadline) >= 0
      );
      const unread = appState.notifications.filter((n) => !n.is_read);

      container.append(
        el('div', { class: 'page-header' }, [
          el('h1', {}, '홈'),
          el('div', { class: 'row', style: 'gap:8px' }, [
            el('button', { class: 'nm-btn', id: 'home-presentation-btn', title: '전체 화면 자동 순환 대시보드(Esc로 종료)', onclick: openPresentation }, '🖥 프레젠테이션'),
            el('button', { class: 'nm-btn nm-btn--primary', onclick: () => navigate('/schedule') }, '+ 빠른 등록'),
          ]),
        ])
      );

      container.append(heroCard());
      container.append(integrationStatusBar());

      const widgets = {};
      widgets.clock = clockCard();

      // KPI: 숫자 count-up + 최근/향후 7일 스파크라인(오늘 일정·마감·알림) + 진행 링(진행 중 프로젝트 평균 진행률)
      const lastDays = Array.from({ length: 7 }, (_, i) => window.addDays(today, i - 6));
      const nextDays = Array.from({ length: 7 }, (_, i) => window.addDays(today, i));
      const activeProjects = appState.projects.filter((p) => p.status === 'in_progress');
      const avgProgress = activeProjects.length ? Math.round(activeProjects.reduce((sum, p) => { const rows = (appState.progressByProject[p.id] || []).slice().sort((a, b) => (a.recorded_at < b.recorded_at ? -1 : 1)); return sum + (rows.length ? Number(rows[rows.length - 1].progress) || 0 : 0); }, 0) / activeProjects.length) : 0;
      widgets.kpi = el('div', { class: 'kpi-grid' }, [
        kpi(todaySchedules.length, '오늘 일정', () => navigate('/schedule'), { spark: window.HomeFx.countsByDay(appState.schedules, 'date', lastDays), sparkTitle: '최근 7일 일정 수' }),
        kpi(dueProjects.length, 'D-7 이내 마감', () => navigate('/projects'), { spark: window.HomeFx.countsByDay(appState.projects.filter((p) => p.status === 'in_progress'), 'deadline', nextDays), sparkTitle: '앞으로 7일 마감 수' }),
        kpi(unread.length, '안 읽은 알림', () => document.getElementById('home-noti-card')?.scrollIntoView({ behavior: 'smooth' }), { spark: window.HomeFx.countsByDay(appState.notifications, 'created_at', lastDays), sparkTitle: '최근 7일 알림 수' }),
        kpi(activeProjects.length, '진행 중 프로젝트', () => navigate('/projects'), { ring: avgProgress, ringTitle: `평균 진행률 ${avgProgress}%` }),
      ]);

      // 오늘의 날씨 (등록된 지역, 기본 3 / 최대 5 — 관리는 설정 화면에서)
      const weatherCard = el('div', { class: 'nm-card weather-card', style: 'margin-bottom:16px' }, [
        el('div', { class: 'row row--between' }, [
          el('h3', {}, '오늘의 날씨'),
          el('div', { class: 'row', style: 'gap:4px' }, [
            el('button', { class: 'nm-btn nm-btn--icon', title: '지역 관리', onclick: () => navigate('/settings') }, '📍'),
            el('button', { class: 'nm-btn nm-btn--icon', title: '새로고침', onclick: () => { weatherState = { loading: true, data: null }; draw(); loadWeather(); } }, '🔄'),
          ]),
        ]),
      ]);
      if (weatherState.loading) {
        weatherCard.append(el('div', { class: 'weather-grid', style: 'margin-top:8px', role: 'status', 'aria-label': '날씨 정보를 불러오는 중' },
          Array.from({ length: Math.min(3, window.getWeatherCities().length) }, () => el('div', { class: 'weather-grid__cell' }, [el('div', { class: 'skel', style: 'height:12px; width:40%' }), el('div', { class: 'skel', style: 'height:22px; width:70%; margin-top:8px' })]))));
      } else {
        const cities = window.getWeatherCities();
        const grid = el('div', { class: 'weather-grid', style: 'margin-top:8px' });
        cities.forEach((city, i) => {
          const w = weatherState.data?.[i];
          grid.append(
            el('div', {
              class: 'weather-grid__cell',
              style: 'cursor:pointer',
              title: '클릭하면 실시간으로 다시 가져오고 주간예보를 볼 수 있습니다.',
              onclick: () => openWeatherDetail(city, i),
            }, [
              el('div', { class: 'text-muted', style: 'font-size:12px' }, city.name),
              w
                ? el('div', { class: 'row', style: 'gap:8px; align-items:center; margin-top:2px' }, [
                    el('span', { style: 'font-size:22px' }, '🌤️'),
                    el('div', {}, [
                      el('div', { style: 'font-size:18px; font-weight:700' }, `${w.temp ?? '--'}℃`),
                      el('div', { class: 'text-muted', style: 'font-size:11px' }, window.weatherCodeToLabel(w.code)),
                    ]),
                  ])
                : el('div', { class: 'text-muted', style: 'font-size:12px; margin-top:4px' }, '정보 없음'),
            ])
          );
        });
        weatherCard.append(grid);
      }
      widgets.weather = weatherCard;

      // 기상특보(공공데이터포털) — 켜져 있고 활성 특보가 있을 때만 위젯을 보여준다(없으면 렌더 생략).
      if (weatherAlertsOn) {
        if (alertState.loading) {
          widgets.alert = el('div', { class: 'nm-card', style: 'margin-bottom:16px' }, [
            el('h3', {}, '⚠️ 기상특보'),
            el('div', { class: 'text-muted' }, '확인하는 중…'),
          ]);
        } else if (alertState.items && alertState.items.length) {
          const list = el('div', { class: 'item-list' });
          for (const a of alertState.items) {
            list.append(
              el('div', { class: 'item-row' }, [
                el('span', { class: 'nm-badge nm-badge--warning' }, ' '),
                el('div', { class: 'item-row__main' }, [
                  el('div', { class: 'item-row__title' }, escapeHtml(a.title || '특보')),
                  el('div', { class: 'item-row__meta' }, `발표 ${a.issuedAt || '-'}${a.effectiveAt ? ' · 발효 ' + a.effectiveAt : ''}`),
                ]),
              ])
            );
          }
          widgets.alert = el('div', { class: 'nm-card', style: 'margin-bottom:16px' }, [
            el('h3', {}, '⚠️ 기상특보'),
            list,
          ]);
        }
        // 특보가 없거나 에러면 위젯 자체를 표시하지 않는다(평소엔 조용히 있는 게 맞는 정보).
      }

      // 이번 주 활동 요약 (프로젝트/일정/챌린저/Health 통합) — 각 지표를 누르면 해당 메뉴로 이동
      const weekly = appState.getWeeklyActivitySummary();
      const summaryCard = el('div', { class: 'nm-card', style: 'margin-bottom:16px' }, [
        el('h3', {}, '이번 주 활동 요약'),
        el('div', { class: 'kpi-grid', style: 'margin-top:8px; grid-template-columns:repeat(auto-fit,minmax(150px,1fr))' }, [
          kpi(weekly.doneSchedules, '완료한 일정', () => navigate('/schedule')),
          kpi(weekly.exerciseSessions, '운동 기록', () => navigate('/health')),
          kpi(weekly.checkins, '챌린지 체크인', () => navigate('/challenges')),
          kpi(weekly.weightDelta !== null ? weekly.weightDelta : '-', '체중 변화', () => navigate('/health'), weekly.weightDelta !== null ? { decimals: 1, signed: true, suffix: 'kg' } : {}),
          // 가장 가까운 D-day(없으면 칸 자체를 빼서 기존 4칸 모양을 유지)
          weekly.nextDday ? kpi(weekly.nextDday.text, `${weekly.nextDday.emoji ? weekly.nextDday.emoji + ' ' : ''}${weekly.nextDday.title}`, () => navigate('/challenges')) : null,
        ].filter(Boolean)),
      ]);
      widgets.summary = summaryCard;

      // D-day 위젯(챌린저 메뉴의 D-day 최대 5개를 홈에서도 한눈에). 카드를 누르면 챌린저 화면으로 이동한다.
      if ((appState.ddays || []).length) {
        const ddayList = el('div', { class: 'row wrap', style: 'gap:8px; margin-top:8px' });
        for (const d of window.sortDdays(appState.ddays, today)) {
          const info = window.ddayInfo(d.target_date, today, !!d.repeat_yearly);
          ddayList.append(el('button', {
            class: 'nm-btn home-dday', style: `border-left:4px solid ${d.color || 'var(--accent)'}`, 'data-dday-id': d.id,
            title: `${window.formatKoreanDate(info.date)}${d.repeat_yearly ? ' · 매년 반복' : ''}`,
            onclick: () => navigate('/challenges'),
          }, [`${d.emoji || '🎯'} ${d.title} `, el('strong', { style: info.isPast ? 'opacity:.6' : '' }, info.text)]));
        }
        widgets.dday = el('div', { class: 'nm-card', style: 'margin-bottom:16px' }, [
          el('div', { class: 'row row--between' }, [el('h3', {}, '📆 D-day'), el('button', { class: 'nm-btn nm-btn--icon', title: '챌린저에서 관리', onclick: () => navigate('/challenges') }, '→')]),
          ddayList,
        ]);
      }

      // 다음 7일 일정 밀집도 예측 (칸을 누르면 해당 날짜의 일정 화면으로 이동)
      const density = predictScheduleDensity(appState.schedules, today, 4);
      const densityCard = el('div', { class: 'nm-card', style: 'margin-bottom:16px' }, [
        el('h3', {}, '다음 7일 일정 밀집도 예측'),
        el('p', { class: 'text-muted' }, '최근 4주 요일별 평균과 비교해 몰리는 날을 미리 보여줍니다. 칸을 누르면 일정 화면으로 이동합니다.'),
      ]);
      const maxDensity = Math.max(1, ...density.map((x) => x.count));
      const row = el('div', { class: 'density-row' });
      for (const d of density) {
        row.append(
          el('div', { class: `density-cell ${d.congested ? 'density-cell--congested' : ''}`, style: 'cursor:pointer', onclick: () => navigate('/schedule') }, [
            el('div', { class: 'density-cell__day' }, weekdayLabel(d.date)),
            el('div', { class: 'density-cell__count' }, String(d.count)),
            el('div', { class: 'text-muted', style: 'font-size:10px' }, `평균 ${d.average}`),
            window.HomeFx.bar(maxDensity ? d.count / maxDensity : 0, drawEntering),
          ])
        );
      }
      densityCard.append(row);
      widgets.density = densityCard;

      // 마감 임박 + 완료 예측 (행을 누르면 프로젝트 화면으로 이동)
      const urgentCard = el('div', { class: 'nm-card', style: 'margin-bottom:16px' }, [el('h3', {}, '마감 임박 프로젝트')]);
      if (!dueProjects.length) {
        urgentCard.append(el('div', { class: 'empty-state' }, '마감이 임박한 프로젝트가 없습니다.'));
      } else {
        const list = el('div', { class: 'item-list' });
        for (const p of dueProjects) {
          const prediction = predictProjectCompletion(appState.progressByProject[p.id] || [], today, CONFIG.predict.projectMinRecords);
          const dDay = diffDays(today, p.deadline);
          list.append(
            el('div', { class: 'item-row', style: 'cursor:pointer', onclick: () => navigate('/projects') }, [
              el('div', { class: 'item-row__main' }, [
                el('div', { class: 'item-row__title' }, escapeHtml(p.name)),
                el(
                  'div',
                  { class: 'item-row__meta' },
                  prediction.predictedDate ? `예상 완료 ${prediction.predictedDate} · 신뢰도 ${confLabel(prediction.confidence)}` : '예측 데이터 부족'
                ),
              ]),
              el('span', { class: `nm-badge ${dDay <= 2 ? 'nm-badge--critical' : 'nm-badge--warning'}` }, `D-${dDay}`),
            ])
          );
        }
        urgentCard.append(list);
      }
      widgets.urgent = urgentCard;

      // 자동 알림 (제목을 누르면 관련 화면으로 이동하도록 related_table을 매핑)
      const notiCard = el('div', { class: 'nm-card', id: 'home-noti-card' }, [el('h3', {}, '자동 알림')]);
      if (!appState.notifications.length) {
        notiCard.append(el('div', { class: 'empty-state' }, '아직 생성된 알림이 없습니다.'));
      } else {
        const list = el('div', { class: 'item-list' });
        for (const n of appState.notifications.slice(0, 8)) {
          const target = NOTI_TARGET[n.related_table] || null;
          list.append(
            el('div', { class: 'item-row', style: target ? 'cursor:pointer' : '', onclick: target ? () => navigate(target) : undefined }, [
              el('span', { class: `nm-badge nm-badge--${n.severity === 'critical' ? 'critical' : n.severity === 'warning' ? 'warning' : 'info'}` }, ' '),
              el('div', { class: 'item-row__main' }, [
                el('div', { class: 'item-row__title' }, escapeHtml(n.title)),
                el('div', { class: 'item-row__meta' }, escapeHtml(n.message)),
              ]),
              !n.is_read
                ? el('button', {
                    class: 'nm-btn nm-btn--icon',
                    title: '읽음 처리',
                    onclick: (e) => { e.stopPropagation(); appState.markNotificationRead(n.id); },
                  }, '✓')
                : null,
            ])
          );
        }
        notiCard.append(list);
      }
      widgets.noti = notiCard;

      // 프로그램 메뉴의 즐겨찾기 URL을 홈에서 바로 열 수 있게(메뉴 간 연동).
      const topBookmarks = appState.bookmarks.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).slice(0, 6);
      const shortcutsCard = el('div', { class: 'nm-card', style: 'margin-bottom:16px' }, [
        el('div', { class: 'row row--between' }, [
          el('h3', {}, '즐겨찾기 바로가기'),
          el('button', { class: 'nm-btn nm-btn--icon', title: '프로그램 화면에서 관리', onclick: () => navigate('/programs') }, '⚙️'),
        ]),
      ]);
      if (!topBookmarks.length) {
        shortcutsCard.append(
          el('div', { class: 'text-muted', style: 'font-size:13px; margin-top:6px' }, [
            '아직 등록된 즐겨찾기가 없습니다. ',
            el('a', { href: '#/programs', onclick: (e) => { e.preventDefault(); navigate('/programs'); } }, '프로그램 화면'),
            '에서 자주 쓰는 링크를 등록해보세요.',
          ])
        );
      } else {
        shortcutsCard.append(
          el('div', { class: 'row wrap', style: 'gap:8px; margin-top:8px' }, topBookmarks.map((b) => el('button', {
            class: 'nm-btn', onclick: () => appState.openBookmark(b.id),
          }, `${b.icon || '⭐'} ${escapeHtml(b.title)}`)))
        );
      }
      widgets.shortcuts = shortcutsCard;

      // 최근 본 항목(벤치마킹 기능) — 최근 연 프로그램/즐겨찾기를 한 번에 다시 열 수 있게 한다.
      const recentItems = appState.getRecentlyViewed();
      if (recentItems.length) {
        const recentCard = el('div', { class: 'nm-card', style: 'margin-bottom:16px' }, [el('h3', {}, '🕘 최근 본 항목')]);
        const list = el('div', { class: 'row wrap', style: 'gap:8px; margin-top:8px' });
        for (const item of recentItems) {
          list.append(
            el('button', {
              class: 'nm-btn',
              onclick: () => {
                if (item.type === 'program') appState.runProgram(item.id);
                else if (item.type === 'bookmark') appState.openBookmark(item.id);
              },
            }, recentLabel(item))
          );
        }
        recentCard.append(list);
        widgets.recent = recentCard;
      }

      // 내 프로그램 바로 실행(v7.21.0): 프로그램 메뉴에서 저장한 아이콘(없으면 유형별 기본 아이콘)을 그대로 보여 준다.
      const topPrograms = appState.programs.slice().sort((a, b) => (b.run_count || 0) - (a.run_count || 0)).slice(0, 8);
      if (topPrograms.length) {
        widgets.programs = el('div', { class: 'nm-card', style: 'margin-bottom:16px' }, [
          el('div', { class: 'row row--between' }, [
            el('h3', {}, '🧩 내 프로그램'),
            el('button', { class: 'nm-btn nm-btn--icon', title: '프로그램 화면에서 관리', onclick: () => navigate('/programs') }, '⚙️'),
          ]),
          el('div', { class: 'row wrap', style: 'gap:8px; margin-top:8px' }, topPrograms.map((p) => el('button', {
            class: 'nm-btn home-program', 'data-program-id': p.id, title: `${p.name} 열기`, onclick: () => appState.runProgram(p.id),
          }, [el('span', { class: 'program-icon' }, window.programIcon(p)), ` ${p.name}`]))),
        ]);
      }

      // Knowledge 최근 등록 5건(1.2 — 지금까지 다른 메뉴와 전혀 연동되지 않던 Knowledge를
      // 홈 화면에서도 한눈에 볼 수 있게 한다). 클릭하면 Knowledge 화면으로 이동한다.
      const recentKnowledge = (appState.knowledgeDocs || [])
        .filter((d) => d.status !== 'archived')
        .slice()
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
        .slice(0, 5);
      if (recentKnowledge.length) {
        const kList = el('div', { class: 'item-list' });
        for (const d of recentKnowledge) {
          kList.append(
            el('div', { class: 'item-row', style: 'cursor:pointer', onclick: () => navigate('/knowledge') }, [
              el('span', { class: 'nm-badge' }, d.doc_type === 'memo' ? '📝' : '🔗'),
              el('div', { class: 'item-row__main' }, [
                el('div', { class: 'item-row__title' }, escapeHtml(d.title)),
                el('div', { class: 'item-row__meta' }, (d.tags || []).length ? d.tags.map((t) => `#${t}`).join(' ') : (d.created_at || '').slice(0, 10)),
              ]),
            ])
          );
        }
        widgets.knowledge = el('div', { class: 'nm-card', style: 'margin-bottom:16px' }, [
          el('div', { class: 'row row--between' }, [el('h3', {}, '📚 최근 Knowledge'), el('button', { class: 'nm-btn nm-btn--icon', title: 'Knowledge 화면으로', onclick: () => navigate('/knowledge') }, '→')]),
          kList,
        ]);
      }

      const order = getHomeWidgetOrder();
      let wi = 0;
      for (const key of order) {
        if (!widgets[key]) continue;
        const w = makeDraggableWidget(key, widgets[key]);
        w.style.setProperty('--i', String(wi++));
        container.append(w);
      }
    }

    function recentLabel(item) {
      if (item.type === 'program') {
        const p = appState.programs.find((x) => x.id === item.id);
        if (p) return `${window.programIcon(p)} ${p.name}`; // 아이콘을 나중에 바꿔도 최신 값으로
      }
      return item.label;
    }

    // ---- 인사 헤더(시간대 테마) ----
    function heroCard() {
      const hour = new Date().getHours();
      const part = window.WEATHER_THEME.dayPartOf(hour);
      const stops = window.WEATHER_THEME.PALETTES.clear[part];
      const text = window.WEATHER_THEME.pickTextColor(stops);
      const greet = hour < 5 ? '늦은 시간이에요' : hour < 11 ? '좋은 아침이에요' : hour < 18 ? '좋은 오후예요' : '수고 많으셨어요';
      const name = appState.user?.name || appState.user?.email?.split('@')[0] || '';
      const today = todayISO();
      const left = appState.schedules.filter((s) => window.scheduleCoversDate(s, today) && !s.done).length;
      return el('div', {
        class: 'home-hero', 'data-part': part, style: `background:${window.WeatherFx.gradientCss(stops)}; color:${text.color}; --i:0`,
      }, [
        el('div', {}, [
          el('p', { class: 'home-hero__greet' }, `${greet}${name ? `, ${name}` : ''}`),
          el('div', { class: 'home-hero__sub' }, `${window.formatKoreanDate(today)} · ${left ? `남은 일정 ${left}건` : '오늘 남은 일정이 없어요'}`),
        ]),
        el('div', { class: 'home-hero__clock', 'data-hero-clock': '', 'aria-label': '현재 시각' }, window.formatZoneTime('Asia/Seoul').time),
      ]);
    }

    // ---- 프레젠테이션 모드(월 디스플레이) ----
    function openPresentation() {
      const today = todayISO();
      const slides = [];
      slides.push({
        id: 'clock', title: '시계 · 날씨',
        render(n) {
          n.append(el('h2', {}, '🕒 지금'));
          const grid = el('div', { class: 'pres__clocks' });
          for (const z of window.getClockZones()) {
            const st = clockWx.get(z.id);
            const layers = window.WeatherFx.createLayers();
            const cell = el('div', { class: 'pres__clock wx-cell', 'data-zone': z.id }, [layers.bg, layers.fx, el('div', { class: 'wx-content' }, [
              el('div', { class: 'pres__label' }, z.label),
              el('div', { class: 'pres__time', 'data-pres-time': z.id }, window.formatZoneTime(z.id).time),
              el('div', { class: 'pres__label' }, window.formatZoneTime(z.id).date),
              el('div', { class: 'wx-line' }, st && st.theme ? [window.WeatherFx.weatherIcon(st.theme.condition, st.theme.isNight, 34, window.WeatherFx.toneOf(st.theme)), el('span', { class: 'wx-line__text' }, `${st.city.name} · ${st.theme.caption}`)] : []),
            ])]);
            grid.append(cell);
            if (st && st.theme) window.WeatherFx.applyTheme(cell, st.theme, null, `pres-${z.id}`);
          }
          n.append(grid);
        },
        tick(n) { n.querySelectorAll('[data-pres-time]').forEach((t) => { t.textContent = window.formatZoneTime(t.dataset.presTime).time; }); },
      });
      slides.push({
        id: 'kpi', title: '요약 지표',
        render(n) {
          const todayList = appState.schedules.filter((s) => window.scheduleCoversDate(s, today));
          const due = appState.projects.filter((p) => p.status === 'in_progress' && p.deadline && diffDays(today, p.deadline) <= 7 && diffDays(today, p.deadline) >= 0);
          const unreadN = appState.notifications.filter((x) => !x.is_read).length;
          const active = appState.projects.filter((p) => p.status === 'in_progress').length;
          n.append(el('h2', {}, '📌 오늘의 숫자'));
          const box = el('div', { class: 'pres__kpis' });
          for (const [v, label] of [[todayList.length, '오늘 일정'], [due.length, 'D-7 이내 마감'], [unreadN, '안 읽은 알림'], [active, '진행 중 프로젝트']]) {
            const b = el('b', {}, '0');
            box.append(el('div', { class: 'pres__kpi' }, [b, el('span', {}, label)]));
            window.HomeFx.countUp(b, v, { duration: 1100 });
          }
          n.append(box);
        },
      });
      slides.push({
        id: 'today', title: '오늘 일정',
        render(n) {
          n.append(el('h2', {}, `📅 오늘 일정 · ${window.formatKoreanDate(today)}`));
          const list = appState.schedules.filter((s) => window.scheduleCoversDate(s, today)).sort((a, b) => (a.time || '').localeCompare(b.time || '')).slice(0, 7);
          if (!list.length) { n.append(el('div', { class: 'pres__empty' }, '오늘 등록된 일정이 없습니다.')); return; }
          n.append(el('div', { class: 'pres__list' }, list.map((s) => el('div', {}, [el('time', {}, s.time ? s.time.slice(0, 5) : '종일'), el('span', { style: s.done ? 'text-decoration:line-through; opacity:.6' : '' }, s.title)]))));
        },
      });
      if ((appState.ddays || []).length) {
        slides.push({
          id: 'dday', title: 'D-day',
          render(n) {
            n.append(el('h2', {}, '📆 D-day'));
            const box = el('div', { class: 'pres__dday' });
            for (const d of window.sortDdays(appState.ddays, today).slice(0, 4)) {
              const info = window.ddayInfo(d.target_date, today, !!d.repeat_yearly);
              box.append(el('div', {}, [el('b', {}, info.text), `${d.emoji || '🎯'} ${d.title}`]));
            }
            n.append(box);
          },
        });
      }
      slides.push({
        id: 'week', title: '이번 주',
        render(n) {
          const w = appState.getWeeklyActivitySummary();
          n.append(el('h2', {}, '🗓 이번 주 활동'));
          const box = el('div', { class: 'pres__kpis' });
          for (const [v, label] of [[w.doneSchedules, '완료한 일정'], [w.exerciseSessions, '운동 기록'], [w.checkins, '챌린지 체크인']]) {
            const b = el('b', {}, '0');
            box.append(el('div', { class: 'pres__kpi' }, [b, el('span', {}, label)]));
            window.HomeFx.countUp(b, v, { duration: 1000 });
          }
          n.append(box);
        },
      });
      const btn = container.querySelector('#home-presentation-btn');
      if (btn) btn.setAttribute('aria-pressed', 'true');
      window.HomeFx.startPresentation({ slides, onExit: () => { const b = container.querySelector('#home-presentation-btn'); if (b) b.setAttribute('aria-pressed', 'false'); } });
    }

    // 위젯을 드래그로 순서를 바꿀 수 있게 감싼다. 순서는 즉시 저장되고 다시 그려진다.
    function makeDraggableWidget(key, node) {
      const wrapper = el('div', { class: 'home-widget', draggable: 'true', 'data-flip-key': key, 'data-widget-key': key }, [
        el('span', { class: 'home-widget__handle', title: '드래그해서 위젯 순서 바꾸기' }, '⠿'),
        node,
      ]);
      wrapper.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', key);
        e.dataTransfer.effectAllowed = 'move';
        wrapper.classList.add('home-widget--dragging');
      });
      wrapper.addEventListener('dragend', () => wrapper.classList.remove('home-widget--dragging'));
      wrapper.addEventListener('dragover', (e) => {
        e.preventDefault();
        wrapper.classList.add('home-widget--dragover');
      });
      wrapper.addEventListener('dragleave', () => wrapper.classList.remove('home-widget--dragover'));
      wrapper.addEventListener('drop', (e) => {
        e.preventDefault();
        wrapper.classList.remove('home-widget--dragover');
        const draggedKey = e.dataTransfer.getData('text/plain');
        if (!draggedKey || draggedKey === key) return;
        const order = getHomeWidgetOrder();
        const from = order.indexOf(draggedKey);
        const to = order.indexOf(key);
        if (from === -1 || to === -1) return;
        order.splice(from, 1);
        order.splice(to, 0, draggedKey);
        setHomeWidgetOrder(order);
        // FLIP: 다시 그리기 전/후 위치 차이를 transform 애니메이션으로 메워 부드럽게 재정렬한다(입장 효과는 건너뜀).
        container.classList.remove('fx-enter');
        enterStart = -Infinity; // 재정렬 중 다시 그려져도 입장 애니메이션이 재생되지 않게
        window.HomeFx.flip(container, () => { draw(); container.classList.remove('fx-enter'); });
      });
      return wrapper;
    }

    draw();
    loadWeather();
    loadClockWeather();
    loadWeatherAlerts();
    checkSupabaseConnection();
    clockTimer = setInterval(tickClocks, 1000);
    // 1분마다 시간대(오전→오후→저녁→밤)가 바뀌었는지 다시 계산한다(예보는 캐시 TTL 20분 안에서는 네트워크 요청 없음).
    const wxTimer = setInterval(() => { if (!document.hidden) loadClockWeather(); }, 60000);
    appState.addEventListener('change', draw);
    return () => {
      appState.removeEventListener('change', draw);
      if (clockTimer) clearInterval(clockTimer);
      clearInterval(wxTimer);
    };
  }

  // 주간예보 모달(클래식 홈·벤토 홈 공용)
  function showForecastModal(city) {
  window.openModal({
    title: `☀️ ${city.name} 주간예보`,
    width: '760px',
    contentBuilder(body) {
      body.append(el('div', { class: 'text-muted' }, '불러오는 중…'));
      // 기상청(KMA) 키가 설정되어 있으면 단기(1~3일 상세)+중기(4~10일 강수확률)를 합친
      // 기상청 데이터를, 아니면(또는 실패하면) 기존 Open-Meteo 7일 예보를 그대로 보여준다.
      const loader = window.fetchUnifiedWeeklyForecast ? window.fetchUnifiedWeeklyForecast(city) : window.fetchWeeklyForecast(city).then((days) => ({ days, source: 'open-meteo', note: null }));
      loader.then(({ days, source, note }) => {
        body.innerHTML = '';
        if (!days || !days.length) {
          body.append(el('div', { class: 'text-muted' }, '예보를 가져오지 못했습니다.'));
          return;
        }
        if (note) {
          body.append(el('div', { class: 'nm-card', style: 'font-size:12px; margin-bottom:10px; padding:8px 10px' }, [
            el('span', { class: 'text-muted' }, `ℹ️ ${note}`),
          ]));
        } else if (source === 'kma') {
          body.append(el('div', { class: 'text-muted', style: 'font-size:11px; margin-bottom:10px' }, '출처: 기상청(단기 1~3일 + 중기 4~10일)'));
        }
        const labels = days.map((d) => d.date.slice(5));
        // 가로 방향 주간예보: 요일별 카드를 한 줄로(좁은 화면에서는 옆으로 밀어서 보기).
        const todayIso = todayISO();
        const WD = ['월', '화', '수', '목', '금', '토', '일'];
        const emojiOf = (d) => {
          const label = d.detail || window.weatherCodeToLabel(d.code);
          if (/눈/.test(label)) return '❄️';
          if (/뇌우|천둥/.test(label)) return '⛈️';
          if (/비|소나기/.test(label)) return '🌧️';
          if (/안개/.test(label)) return '🌫️';
          if (/맑/.test(label)) return '☀️';
          if (/구름|흐/.test(label)) return /조금/.test(label) ? '🌤️' : '☁️';
          return '🌡️';
        };
        const strip = el('div', { class: 'wx-week', role: 'list', 'aria-label': '주간예보' });
        for (const d of days) {
          const wd = WD[window.isoWeekday(d.date) - 1];
          strip.append(el('div', { class: `wx-day ${d.date === todayIso ? 'wx-day--today' : ''}`, role: 'listitem' }, [
            el('div', { class: 'wx-day__wd' }, d.date === todayIso ? '오늘' : wd),
            el('div', { class: 'wx-day__date' }, d.date.slice(5).replace('-', '/')),
            el('div', { class: 'wx-day__icon', 'aria-hidden': 'true' }, emojiOf(d)),
            el('div', { class: 'wx-day__desc' }, d.detail || window.weatherCodeToLabel(d.code)),
            el('div', { class: 'wx-day__temp' }, [el('b', {}, `${d.max ?? '-'}°`), el('span', { class: 'text-muted' }, ` / ${d.min ?? '-'}°`)]),
            d.pop !== null && d.pop !== undefined ? el('div', { class: 'wx-day__pop', title: '강수확률' }, `☔ ${d.pop}%`) : null,
            d.precip !== null && d.precip !== undefined && d.precip > 0 ? el('div', { class: 'wx-day__precip', title: '강수량' }, `💧 ${d.precip}mm`) : null,
          ]));
        }
        body.append(strip);
        body.append(
          el('div', { style: 'margin-top:14px' }, [el('strong', { style: 'font-size:13px' }, '최고/최저기온(℃)')]),
          el('div', { style: 'margin-top:6px' }, [window.simpleLineChart(labels, days.map((d) => d.max ?? 0), '#ef4444')]),
          el('div', { style: 'margin-top:4px' }, [window.simpleLineChart(labels, days.map((d) => d.min ?? 0), '#3b82f6')])
        );
        if (days.some((d) => d.pop !== null && d.pop !== undefined)) {
          body.append(
            el('div', { style: 'margin-top:14px' }, [el('strong', { style: 'font-size:13px' }, '강수확률(%)')]),
            el('div', { style: 'margin-top:6px' }, [window.simpleBarChart(labels, days.map((d) => d.pop ?? 0))])
          );
        }
      });
    },
  });
  }
  window.showForecastModal = showForecastModal;

  // KPI 카드. opts: spark(7개 값), ring(0~100), decimals/signed/suffix(숫자 표시 형식). 숫자는 값이 바뀔 때만 count-up한다.
  const kpiLast = new Map();
  let drawEntering = false;
  function kpi(value, label, onClick, opts = {}) {
    const numeric = typeof value === 'number' && Number.isFinite(value);
    const fmt = (n) => `${opts.signed && n > 0 ? '+' : ''}${(opts.decimals ? n.toFixed(opts.decimals) : String(Math.round(n)))}${opts.suffix || ''}`;
    const valueEl = el('div', { class: 'kpi-card__value', 'data-kpi-value': String(value) }, numeric ? fmt(value) : String(value));
    if (numeric) {
      // 마지막으로 "실제로 화면에 보인" 값부터 이어서 올라간다 — 숫자가 올라가는 도중 홈이 다시 그려져도 0부터 다시 시작하지 않는다.
      const prev = kpiLast.has(label) ? kpiLast.get(label) : 0;
      const rec = (n) => { if (valueEl.isConnected) kpiLast.set(label, n); return fmt(n); };
      if (!window.HomeFx.motionOn()) {
        // 애니메이션 효과를 끈 상태: 이전 값(0)을 잠깐 보여주지 않고 처음부터 최종값을 그린다.
        kpiLast.set(label, value);
      } else if (prev !== value) { valueEl.textContent = fmt(prev); requestAnimationFrame(() => window.HomeFx.countUp(valueEl, value, { from: prev, format: rec })); }
    }
    const kids = [];
    if (typeof opts.ring === 'number') {
      kids.push(window.HomeFx.ring(opts.ring, valueEl, drawEntering));
    } else {
      kids.push(valueEl);
    }
    kids.push(el('div', { class: 'kpi-card__label' }, label));
    if (opts.spark) { const sp = window.HomeFx.sparkline(opts.spark); const t = document.createElementNS('http://www.w3.org/2000/svg', 'title'); t.textContent = `${opts.sparkTitle || '추이'}: ${opts.spark.join(', ')}`; sp.prepend(t); sp.removeAttribute('aria-hidden'); sp.setAttribute('role', 'img'); kids.push(sp); }
    return el(
      'div',
      { class: 'nm-card kpi-card', style: onClick ? 'cursor:pointer' : '', onclick: onClick || undefined, title: onClick ? `${label} 화면으로 이동${opts.ringTitle ? ` · ${opts.ringTitle}` : ''}` : undefined },
      kids
    );
  }

  function confLabel(c) {
    return { high: '높음', medium: '보통', low: '낮음', none: '-' }[c] || c;
  }

  window.renderHome = renderHome;
})();
