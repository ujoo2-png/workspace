// 홈 화면. 일반 <script>로 로드되며 js/state.js, js/utils/dom.js, js/utils/date.js,
// js/predict.js, js/config.js, js/router.js가 먼저 로드되어야 한다.
(function () {
  const { appState, el, escapeHtml, todayISO, diffDays, weekdayLabel, predictScheduleDensity, predictProjectCompletion, navigate } = window;

  // 알림의 related_table(js/rules.js가 채움)을 눌렀을 때 이동할 메뉴로 매핑한다.
  const NOTI_TARGET = { projects: '/projects', schedules: '/schedule', vehicles: '/vehicles', challenges: '/challenges', playlist_items: '/playlist' };

  // 홈 화면 위젯을 드래그로 순서를 바꿀 수 있게 한다. 순서는 localStorage에 저장해두고
  // 다음 방문 때도 유지한다. 새 버전에서 위젯이 추가되면 저장된 순서 뒤에 이어 붙인다.
  const WIDGET_ORDER_KEY = 'workspace:homeWidgetOrder';
  const WIDGET_LABELS = {
    clock: '🕒 시계', kpi: '📌 요약 지표', weather: '☀️ 날씨', alert: '⚠️ 기상특보', summary: '📅 이번 주 활동 요약',
    density: '📊 일정 밀집도 예측', urgent: '⏰ 마감 임박 프로젝트', noti: '🔔 자동 알림', shortcuts: '⭐ 즐겨찾기 바로가기',
    recent: '🕘 최근 본 항목', knowledge: '📚 최근 Knowledge',
  };
  const WIDGET_KEYS = Object.keys(WIDGET_LABELS);

  function getHomeWidgetOrder() {
    try {
      const raw = localStorage.getItem(WIDGET_ORDER_KEY);
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
    localStorage.setItem(WIDGET_ORDER_KEY, JSON.stringify(order));
  }

  function renderHome(root) {
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
    let clockCells = [];
    function clockCard() {
      const zones = window.getClockZones();
      clockCells = [];
      const card = el('div', { class: 'nm-card clock-card', style: 'margin-bottom:16px' }, [
        el('div', { class: 'row row--between' }, [
          el('h3', {}, '🕒 시계'),
          el('button', { class: 'nm-btn nm-btn--icon', title: '시계 설정(최대 3개 지역)', onclick: openClockSettings }, '⚙️'),
        ]),
      ]);
      const grid = el('div', { class: 'clock-grid', style: 'margin-top:8px' });
      for (const z of zones) {
        const { time, date } = window.formatZoneTime(z.id);
        const timeEl = el('div', { style: 'font-size:22px; font-weight:800; font-variant-numeric:tabular-nums' }, time);
        const dateEl = el('div', { class: 'text-muted', style: 'font-size:11px' }, date);
        clockCells.push({ zone: z, timeEl, dateEl });
        grid.append(
          el('div', { class: 'clock-grid__cell' }, [
            el('div', { class: 'text-muted', style: 'font-size:12px' }, z.label),
            timeEl,
            dateEl,
          ])
        );
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
                  el('div', { class: 'item-row__main' }, [el('div', { class: 'item-row__title' }, z.label)]),
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
      window.openModal({
        title: `☀️ ${city.name} 주간예보`,
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
            body.append(
              el('div', {}, [el('strong', { style: 'font-size:13px' }, '최고/최저기온(℃)')]),
              el('div', { style: 'margin-top:6px' }, [window.simpleLineChart(labels, days.map((d) => d.max ?? 0), '#ef4444')]),
              el('div', { style: 'margin-top:4px' }, [window.simpleLineChart(labels, days.map((d) => d.min ?? 0), '#3b82f6')])
            );
            if (days.some((d) => d.pop !== null && d.pop !== undefined)) {
              body.append(
                el('div', { style: 'margin-top:14px' }, [el('strong', { style: 'font-size:13px' }, '강수확률(%)')]),
                el('div', { style: 'margin-top:6px' }, [window.simpleBarChart(labels, days.map((d) => d.pop ?? 0))])
              );
            }
            const list = el('div', { class: 'item-list', style: 'margin-top:14px' });
            for (const d of days) {
              list.append(
                el('div', { class: 'item-row' }, [
                  el('div', { class: 'item-row__main' }, [
                    el('div', { class: 'item-row__title' }, d.date),
                    el('div', { class: 'item-row__meta' }, d.detail || window.weatherCodeToLabel(d.code)),
                  ]),
                  el('div', { class: 'row', style: 'gap:8px; align-items:center' }, [
                    d.pop !== null && d.pop !== undefined ? el('span', { class: 'nm-badge', title: '강수확률' }, `☔ ${d.pop}%`) : null,
                    d.precip !== null && d.precip !== undefined && d.precip > 0 ? el('span', { class: 'nm-badge', title: '강수량' }, `💧 ${d.precip}mm`) : null,
                    el('span', { style: 'font-weight:700' }, `${d.min ?? '-'}° / ${d.max ?? '-'}°`),
                  ]),
                ])
              );
            }
            body.append(list);
          });
        },
      });
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

    function draw() {
      container.innerHTML = '';
      const CONFIG = window.CONFIG;
      const today = todayISO();
      const todaySchedules = appState.schedules.filter((s) => s.date === today);
      const dueProjects = appState.projects.filter(
        (p) => p.status === 'in_progress' && p.deadline && diffDays(today, p.deadline) <= 7 && diffDays(today, p.deadline) >= 0
      );
      const unread = appState.notifications.filter((n) => !n.is_read);

      container.append(
        el('div', { class: 'page-header' }, [
          el('h1', {}, '홈'),
          el('button', { class: 'nm-btn nm-btn--primary', onclick: () => navigate('/schedule') }, '+ 빠른 등록'),
        ])
      );

      container.append(integrationStatusBar());

      const widgets = {};
      widgets.clock = clockCard();

      widgets.kpi = el('div', { class: 'kpi-grid' }, [
        kpi(todaySchedules.length, '오늘 일정', () => navigate('/schedule')),
        kpi(dueProjects.length, 'D-7 이내 마감', () => navigate('/projects')),
        kpi(unread.length, '안 읽은 알림', () => document.getElementById('home-noti-card')?.scrollIntoView({ behavior: 'smooth' })),
        kpi(appState.projects.filter((p) => p.status === 'in_progress').length, '진행 중 프로젝트', () => navigate('/projects')),
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
        weatherCard.append(el('div', { class: 'text-muted', style: 'margin-top:4px' }, '날씨 정보를 불러오는 중…'));
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
        el('div', { class: 'kpi-grid', style: 'margin-top:8px' }, [
          kpi(weekly.doneSchedules, '완료한 일정', () => navigate('/schedule')),
          kpi(weekly.exerciseSessions, '운동 기록', () => navigate('/health')),
          kpi(weekly.checkins, '챌린지 체크인', () => navigate('/challenges')),
          kpi(weekly.weightDelta !== null ? `${weekly.weightDelta > 0 ? '+' : ''}${weekly.weightDelta}kg` : '-', '체중 변화', () => navigate('/health')),
        ]),
      ]);
      widgets.summary = summaryCard;

      // 다음 7일 일정 밀집도 예측 (칸을 누르면 해당 날짜의 일정 화면으로 이동)
      const density = predictScheduleDensity(appState.schedules, today, 4);
      const densityCard = el('div', { class: 'nm-card', style: 'margin-bottom:16px' }, [
        el('h3', {}, '다음 7일 일정 밀집도 예측'),
        el('p', { class: 'text-muted' }, '최근 4주 요일별 평균과 비교해 몰리는 날을 미리 보여줍니다. 칸을 누르면 일정 화면으로 이동합니다.'),
      ]);
      const row = el('div', { class: 'density-row' });
      for (const d of density) {
        row.append(
          el('div', { class: `density-cell ${d.congested ? 'density-cell--congested' : ''}`, style: 'cursor:pointer', onclick: () => navigate('/schedule') }, [
            el('div', { class: 'density-cell__day' }, weekdayLabel(d.date)),
            el('div', { class: 'density-cell__count' }, String(d.count)),
            el('div', { class: 'text-muted', style: 'font-size:10px' }, `평균 ${d.average}`),
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
            }, item.label)
          );
        }
        recentCard.append(list);
        widgets.recent = recentCard;
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
      for (const key of order) {
        if (widgets[key]) container.append(makeDraggableWidget(key, widgets[key]));
      }
    }

    // 위젯을 드래그로 순서를 바꿀 수 있게 감싼다. 순서는 즉시 저장되고 다시 그려진다.
    function makeDraggableWidget(key, node) {
      const wrapper = el('div', { class: 'home-widget', draggable: 'true' }, [
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
        draw();
      });
      return wrapper;
    }

    draw();
    loadWeather();
    loadWeatherAlerts();
    checkSupabaseConnection();
    clockTimer = setInterval(tickClocks, 1000);
    appState.addEventListener('change', draw);
    return () => {
      appState.removeEventListener('change', draw);
      if (clockTimer) clearInterval(clockTimer);
    };
  }

  function kpi(value, label, onClick) {
    return el(
      'div',
      { class: 'nm-card kpi-card', style: onClick ? 'cursor:pointer' : '', onclick: onClick || undefined, title: onClick ? `${label} 화면으로 이동` : undefined },
      [el('div', { class: 'kpi-card__value' }, String(value)), el('div', { class: 'kpi-card__label' }, label)]
    );
  }

  function confLabel(c) {
    return { high: '높음', medium: '보통', low: '낮음', none: '-' }[c] || c;
  }

  window.renderHome = renderHome;
})();
