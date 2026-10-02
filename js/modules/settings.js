// 설정 화면. 일반 <script>로 로드된다.
(function () {
  const { appState, el, toast, confirmDialog, openModal } = window;

  const CSV_EXPORTS = {
    schedules: { label: '일정', sensitive: false, columns: [
      { key: 'title', label: '제목' }, { key: 'date', label: '날짜' }, { key: 'time', label: '시간' },
      { key: 'done', label: '완료' }, { key: 'tags', label: '태그' }, { key: 'memo', label: '메모' },
    ] },
    projects: { label: '프로젝트', sensitive: false, columns: [
      { key: 'name', label: '이름' }, { key: 'status', label: '상태' }, { key: 'priority', label: '우선순위' },
      { key: 'deadline', label: '마감일' }, { key: 'tags', label: '태그' }, { key: 'memo', label: '메모' },
    ] },
    vehicles: { label: '차량관리', sensitive: false, columns: [
      { key: 'name', label: '이름' }, { key: 'plate_number', label: '번호판' }, { key: 'model', label: '모델' },
      { key: 'insurance_expiry', label: '보험만료일' }, { key: 'registration_expiry', label: '등록만료일' },
    ] },
    healthMetrics: { label: 'Health 기록', sensitive: true, columns: [
      { key: 'metric_type', label: '종류' }, { key: 'value', label: '값' }, { key: 'unit', label: '단위' },
      { key: 'recorded_at', label: '기록일시' }, { key: 'note', label: '메모' },
    ] },
    devlogs: { label: 'Devlog', sensitive: false, columns: [
      { key: 'title', label: '제목' }, { key: 'type', label: '종류' }, { key: 'logged_at', label: '날짜' }, { key: 'tags', label: '태그' }, { key: 'issue_url', label: 'GitHub 이슈' },
    ] },
    playlistItems: { label: '문화생활', sensitive: false, columns: [
      { key: 'title', label: '제목' }, { key: 'content_type', label: '종류' }, { key: 'status', label: '상태' },
      { key: 'event_date', label: '날짜' }, { key: 'venue_name', label: '장소' }, { key: 'rating', label: '별점' }, { key: 'review', label: '한줄평' },
    ] },
    knowledgeDocs: { label: 'Knowledge', sensitive: false, columns: [
      { key: 'title', label: '제목' }, { key: 'url', label: 'URL' }, { key: 'tags', label: '태그' },
    ] },
    programs: { label: '프로그램', sensitive: false, columns: [
      { key: 'name', label: '이름' }, { key: 'program_type', label: '유형' }, { key: 'url', label: 'URL' }, { key: 'run_count', label: '실행횟수' },
    ] },
    bookmarks: { label: '즐겨찾기', sensitive: false, columns: [
      { key: 'title', label: '제목' }, { key: 'url', label: 'URL' }, { key: 'category', label: '분류' },
    ] },
  };

  // ---- Supabase 7일 유지 기능 ----
  // Supabase 무료(Free) 티어는 7일간 아무 요청이 없으면 프로젝트가 일시 중지(pause)된다.
  // 이 앱은 순수 클라이언트 전용(서버 cron 없음)이라 "브라우저가 꺼져 있어도" 깨우는 건
  // 원천적으로 불가능하다 — 그래서 정직하게 (1) 마지막으로 Supabase 요청이 성공한 시각을
  // 기록해 보여주고, (2) 5일이 지나면 경고 배지로 알리고 수동으로 "지금 확인"할 수 있게 하고,
  // (3) 브라우저 탭이 열려 있는 동안만 24시간마다 best-effort로 자동 핑을 보낸다.
  const SUPABASE_ACTIVE_KEY = 'workspace:supabase:lastActive';
  function markSupabaseActive() {
    try { localStorage.setItem(SUPABASE_ACTIVE_KEY, new Date().toISOString()); } catch { /* 무시 */ }
  }
  function getSupabaseLastActive() {
    try { return localStorage.getItem(SUPABASE_ACTIVE_KEY); } catch { return null; }
  }
  window.markSupabaseActive = markSupabaseActive;
  window.getSupabaseLastActive = getSupabaseLastActive;
  let supabaseKeepAliveTimer = null;
  function startSupabaseKeepAliveTimer() {
    if (supabaseKeepAliveTimer || window.CONFIG.mode !== 'supabase') return;
    supabaseKeepAliveTimer = setInterval(async () => {
      try {
        await window.getStore().list('bookmarks', { where: { user_id: appState.user?.id } });
        markSupabaseActive();
      } catch { /* 네트워크 오류 등은 조용히 무시 — 다음 주기에 다시 시도 */ }
    }, 24 * 60 * 60 * 1000); // 24시간마다 — 탭이 열려 있는 동안만 동작한다.
  }
  if (window.CONFIG && window.CONFIG.mode === 'supabase') startSupabaseKeepAliveTimer();

  function renderSettings(root) {
    const container = el('div', {});
    root.append(container);

    const theme = localStorage.getItem('workspace:theme') || 'auto';
    const CONFIG = window.CONFIG;
    let weatherCities = window.getWeatherCities();

    container.append(
      el('div', { class: 'page-header' }, [el('h1', {}, '설정')]),
      el('div', { class: 'stack' }, [
        el('div', { class: 'nm-card' }, [
          el('h3', {}, '계정 · 보안'),
          el('p', { class: 'text-muted' }, `로그인 계정: ${appState.user?.email || '-'}`),
          el('p', { class: 'text-muted' }, `데이터 모드: ${CONFIG.mode === 'local' ? '로컬(local) — 이 브라우저에만 저장' : 'Supabase(아이디/비밀번호 로그인)'}`),
          el('p', { class: 'text-muted' }, `권한: ${appState.user?.role === 'admin' ? '관리자' : '일반 사용자'}`),
          el('p', { class: 'text-muted' }, `자동 로그아웃: 조작 없이 ${CONFIG.sessionIdleTimeoutMinutes}분이 지나면 개인정보 보호를 위해 자동 로그아웃됩니다.`),
          el('div', { class: 'row', style: 'gap:8px' }, [
            el('button', { class: 'nm-btn', onclick: () => openChangePasswordModal() }, '비밀번호 변경'),
            el('button', { class: 'nm-btn nm-btn--danger', onclick: signOut }, '로그아웃'),
          ]),
        ]),
        myProfileCard(),
        weatherCard(),
        tmdbCard(),
        publicDataCard(),
        CONFIG.mode === 'supabase' ? supabaseKeepAliveCard() : supabaseLocalModePlaceholderCard(),
        customApiCard(),
        ...(appState.user?.role === 'admin' ? [userManagementCard()] : []),
        el('div', { class: 'nm-card' }, [
          el('h3', {}, '테마'),
          el('p', { class: 'text-muted' }, '시스템 설정을 따르거나 직접 라이트/다크를 선택할 수 있습니다.'),
          el('div', { class: 'row', style: 'gap:8px' }, [
            themeBtn('auto', '시스템', theme),
            themeBtn('light', '라이트', theme),
            themeBtn('dark', '다크', theme),
          ]),
        ]),
        el('div', { class: 'nm-card' }, [
          el('h3', {}, '데이터 내보내기'),
          el('p', { class: 'text-muted' }, '전체 백업(JSON)이나 항목별 CSV로 내보낼 수 있습니다. Health 등 민감한 데이터는 내보내기 전에 한 번 더 확인합니다.'),
          el('div', { class: 'row wrap', style: 'gap:8px; margin-bottom:10px' }, [
            el('button', { class: 'nm-btn nm-btn--primary', onclick: exportData }, '전체 백업(JSON)'),
          ]),
          el('div', { class: 'row wrap', style: 'gap:8px' }, Object.entries(CSV_EXPORTS).map(([key, spec]) =>
            el('button', { class: 'nm-btn', onclick: () => exportCsv(key, spec) }, `${spec.label} CSV`)
          )),
          importDataSection(),
        ]),
        el('div', { class: 'nm-card' }, [
          el('h3', {}, '앱 정보'),
          el('p', { class: 'text-muted' }, `버전: ${CONFIG.version}`),
          el('p', { class: 'text-muted', style: 'font-size:12px' }, '개인 참고용 기록 도구이며 의료 정보 시스템이 아닙니다. Health 기록은 진단·복약 등 민감 의료정보가 아닌 체중/운동/수면 등 일반 웰니스 지표만 다룹니다.'),
        ]),
      ])
    );

    // 내 정보(나이/성별/혈액형/키) — Health 화면의 "나이대별 건강 제안"에 사용된다.
    // 모두 선택 입력이며, 민감한 진단/복약 정보가 아니라 사용자가 공개적으로 알려주는
    // 기본 신상 정보 수준이다.
    function myProfileCard() {
      const p = appState.profile || {};
      const GENDER_LABEL = { male: '남성', female: '여성', other: '기타' };
      const card = el('div', { class: 'nm-card' }, [
        el('h3', {}, '내 정보'),
        el('p', { class: 'text-muted' }, '생년월일을 입력하면 Health 화면에서 나이대에 맞는 건강검진 제안을 받을 수 있습니다. 모두 선택 입력입니다.'),
      ]);

      const birthInput = el('input', { class: 'nm-input', type: 'date', value: p.birth_date || '' });
      const genderSelect = el('select', { class: 'nm-select' }, [
        el('option', { value: '' }, '선택 안 함'),
        el('option', { value: 'male' }, '남성'),
        el('option', { value: 'female' }, '여성'),
        el('option', { value: 'other' }, '기타'),
      ]);
      genderSelect.value = p.gender || '';
      const bloodSelect = el('select', { class: 'nm-select' }, [
        el('option', { value: '' }, '선택 안 함'),
        ...['A', 'B', 'O', 'AB'].map((v) => el('option', { value: v }, `${v}형`)),
      ]);
      bloodSelect.value = p.blood_type || '';
      const heightInput = el('input', { class: 'nm-input', type: 'number', step: '0.1', min: '0', value: p.height_cm || '' });

      const grid = el('div', { class: 'row wrap', style: 'gap:12px; margin-top:10px' }, [
        el('div', { style: 'min-width:160px' }, [el('label', { class: 'text-muted', style: 'font-size:13px; font-weight:600' }, '생년월일'), birthInput]),
        el('div', { style: 'min-width:140px' }, [el('label', { class: 'text-muted', style: 'font-size:13px; font-weight:600' }, '성별'), genderSelect]),
        el('div', { style: 'min-width:120px' }, [el('label', { class: 'text-muted', style: 'font-size:13px; font-weight:600' }, '혈액형'), bloodSelect]),
        el('div', { style: 'min-width:120px' }, [el('label', { class: 'text-muted', style: 'font-size:13px; font-weight:600' }, '키(cm)'), heightInput]),
      ]);
      card.append(grid);

      card.append(
        el('button', {
          class: 'nm-btn nm-btn--primary', style: 'margin-top:12px',
          onclick: async () => {
            try {
              await appState.updateMyProfile({
                birth_date: birthInput.value || null,
                gender: genderSelect.value || null,
                blood_type: bloodSelect.value || null,
                height_cm: heightInput.value ? Number(heightInput.value) : null,
              });
              toast('내 정보를 저장했습니다.', 'success');
            } catch (e) {
              toast('저장에 실패했습니다: ' + (e.message || e), 'error');
            }
          },
        }, '저장')
      );

      if (p.birth_date) {
        card.append(
          el('p', { class: 'text-muted', style: 'font-size:12px; margin-top:8px' },
            `현재 등록된 정보: ${p.birth_date}생${p.gender ? ' · ' + GENDER_LABEL[p.gender] : ''}${p.blood_type ? ' · ' + p.blood_type + '형' : ''}${p.height_cm ? ' · ' + p.height_cm + 'cm' : ''}`)
        );
      }
      return card;
    }

    function weatherCard() {
      const card = el('div', { class: 'nm-card' }, [
        el('h3', {}, '날씨 지역 관리'),
        el('p', { class: 'text-muted' }, `홈 화면에 표시할 지역을 관리합니다(최소 ${CONFIG.weather.minCities}개, 최대 ${CONFIG.weather.maxCities}개).`),
      ]);
      const list = el('div', { class: 'item-list', style: 'margin:10px 0' });
      weatherCities.forEach((city, idx) => {
        list.append(
          el('div', { class: 'item-row' }, [
            el('span', { class: 'text-muted', style: 'font-size:12px; width:16px' }, String(idx + 1)),
            el('div', { class: 'item-row__main' }, [el('div', { class: 'item-row__title' }, city.name)]),
            el('div', { class: 'icon-row' }, [
              el('button', {
                class: 'nm-btn nm-btn--icon',
                title: '위로(우선순위 올리기)',
                disabled: idx === 0 || undefined,
                onclick: () => {
                  const next = weatherCities.slice();
                  [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                  weatherCities = window.setWeatherCities(next);
                  renderSettings(rerenderTarget());
                },
              }, '↑'),
              el('button', {
                class: 'nm-btn nm-btn--icon',
                title: '아래로',
                disabled: idx === weatherCities.length - 1 || undefined,
                onclick: () => {
                  const next = weatherCities.slice();
                  [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
                  weatherCities = window.setWeatherCities(next);
                  renderSettings(rerenderTarget());
                },
              }, '↓'),
              el('button', {
                class: 'nm-btn nm-btn--icon nm-btn--danger',
                title: '삭제',
                disabled: weatherCities.length <= CONFIG.weather.minCities || undefined,
                onclick: () => {
                  weatherCities = window.setWeatherCities(weatherCities.filter((c) => c.name !== city.name));
                  toast('저장했습니다.', 'success');
                  renderSettings(rerenderTarget());
                },
              }, '🗑'),
            ]),
          ])
        );
      });
      card.append(list);
      card.append(el('p', { class: 'text-muted', style: 'font-size:12px' }, '맨 위 지역이 홈 화면과 로그인 브리핑에서 가장 먼저 표시됩니다.'));

      const remaining = CONFIG.cityPresets.filter((p) => !weatherCities.some((c) => c.name === p.name));
      if (weatherCities.length < CONFIG.weather.maxCities && remaining.length) {
        const select = el('select', { class: 'nm-select', style: 'width:160px' }, remaining.map((p) => el('option', { value: p.name }, p.name)));
        card.append(
          el('div', { class: 'row', style: 'gap:8px' }, [
            select,
            el('button', {
              class: 'nm-btn',
              onclick: () => {
                const picked = remaining.find((p) => p.name === select.value);
                if (!picked) return;
                weatherCities = window.setWeatherCities([...weatherCities, picked]);
                toast('지역을 추가했습니다.', 'success');
                renderSettings(rerenderTarget());
              },
            }, '+ 지역 추가'),
          ])
        );
      } else if (weatherCities.length >= CONFIG.weather.maxCities) {
        card.append(el('p', { class: 'text-muted', style: 'font-size:12px' }, `최대 ${CONFIG.weather.maxCities}개까지 등록할 수 있습니다.`));
      }
      return card;
    }

    // Supabase 무료 티어는 7일간 요청이 없으면 프로젝트가 일시중지된다 — 완전한 서버리스
    // keep-alive는 불가능하므로, 마지막 활동 확인 시각 + 수동 확인 버튼으로 정직하게 돕는다.
    function supabaseKeepAliveCard() {
      const last = getSupabaseLastActive();
      const lastDate = last ? new Date(last) : null;
      const daysSince = lastDate ? (Date.now() - lastDate.getTime()) / 86400000 : null;
      const warn = daysSince !== null && daysSince >= 5;
      const statusLine = lastDate
        ? `${lastDate.toLocaleString('ko-KR')} (${daysSince.toFixed(1)}일 전)`
        : '아직 확인된 기록이 없습니다.';
      const checkBtn = el('button', {
        class: 'nm-btn nm-btn--primary',
        onclick: async () => {
          checkBtn.disabled = true;
          checkBtn.textContent = '확인 중…';
          try {
            await window.getStore().list('bookmarks', { where: { user_id: appState.user?.id } });
            markSupabaseActive();
            toast('Supabase 활동을 확인했습니다.', 'success');
          } catch (e) {
            toast('확인에 실패했습니다: ' + (e.message || e), 'error');
          }
          renderSettings(rerenderTarget());
        },
      }, '지금 확인');
      return el('div', { class: 'nm-card' }, [
        el('div', { class: 'row row--between' }, [
          el('h3', {}, 'Supabase 7일 유지'),
          warn ? el('span', { class: 'nm-badge nm-badge--warning' }, '⚠️ 5일 이상 경과') : el('span', { class: 'nm-badge nm-badge--success' }, '정상'),
        ]),
        el('p', { class: 'text-muted', style: 'font-size:12px' },
          'Supabase 무료(Free) 티어 프로젝트는 7일간 아무 요청이 없으면 자동으로 일시중지됩니다. ' +
          '이 앱은 순수 클라이언트 전용(서버 cron 없음)이라 브라우저가 꺼져 있을 때 깨우는 것은 ' +
          '기술적으로 불가능합니다 — 아래는 "마지막으로 Supabase 요청이 성공한 시각"을 기록해 미리 알려주는 보조 기능입니다.'),
        el('p', { style: 'margin-top:8px' }, [el('strong', {}, '마지막 확인 활동: '), statusLine]),
        el('div', { class: 'row', style: 'gap:8px; margin-top:8px' }, [checkBtn]),
        el('p', { class: 'text-muted', style: 'font-size:11px; margin-top:8px' },
          '※ 브라우저가 열려있는 동안만 작동하는 보조 기능으로, 24시간마다 자동으로 한 번씩 가볍게 핑을 보냅니다. ' +
          '7일 이상 접속하지 않으면 여전히 프로젝트가 일시중지될 수 있으니, 장기간 쓰지 않을 때는 가끔 접속해 확인해 주세요.'),
      ]);
    }

    // 로컬(local) 모드에서는 "Supabase 7일 유지" 카드 자체가 숨겨져 있어 사용자 입장에서는
    // 설명 없이 사라진 것처럼 보일 수 있다. 실제로는 의도한 동작(연결된 Supabase가 없으니
    // 유지할 것도 없다)이지만, 그 이유를 화면에서 바로 알 수 있도록 안내 카드를 대신 보여준다.
    function supabaseLocalModePlaceholderCard() {
      return el('div', { class: 'nm-card' }, [
        el('div', { class: 'row row--between' }, [
          el('h3', {}, 'Supabase 7일 유지'),
          el('span', { class: 'nm-badge' }, '로컬 모드'),
        ]),
        el('p', { class: 'text-muted', style: 'font-size:12px' },
          'Supabase 7일 유지 기능은 "Supabase 연동 모드"에서만 표시됩니다. 현재 이 앱은 ' +
          '"로컬(local) 모드"로 실행 중이라(이 브라우저에만 데이터가 저장되고 Supabase에 연결되어 ' +
          '있지 않습니다) 유지할 Supabase 연결이 없어 카드가 나타나지 않는 것이 정상입니다.'),
        el('p', { class: 'text-muted', style: 'font-size:11px; margin-top:8px' },
          'Supabase를 직접 연결해 쓰고 싶다면 js/config.js의 CONFIG.mode 값을 \'supabase\'로 바꾸고 ' +
          'supabaseUrl/supabaseAnonKey를 채운 뒤 다시 배포하면, 이 자리에 실제 "Supabase 7일 유지" ' +
          '카드가 나타납니다.'),
      ]);
    }

    // 문화생활 화면의 "이번 주 인기 영화" 연동에 쓸 TMDB API 키. 대시보드 상단 상태 배지가
    // 여기서 저장한 연결 상태(workspace:tmdbStatus)를 그대로 보여준다.
    function tmdbCard() {
      const STATUS_LABEL = { connected: '✅ 연결됨', error: '⚠️ 연결 오류', unset: '미설정' };
      const keyInput = el('input', { class: 'nm-input', type: 'password', name: 'tmdb_key', placeholder: 'TMDB API 키(v3 auth)', value: window.getTmdbApiKey() });
      const statusBadge = el('span', { class: 'nm-badge' }, STATUS_LABEL[window.getTmdbStatus()]);
      const testBtn = el('button', {
        class: 'nm-btn',
        type: 'button',
        onclick: async () => {
          window.setTmdbApiKey(keyInput.value.trim());
          if (!keyInput.value.trim()) {
            statusBadge.textContent = STATUS_LABEL.unset;
            toast('API 키를 삭제했습니다.', 'info');
            return;
          }
          testBtn.disabled = true;
          testBtn.textContent = '확인 중…';
          const ok = await window.testTmdbConnection(keyInput.value.trim());
          statusBadge.textContent = STATUS_LABEL[ok ? 'connected' : 'error'];
          toast(ok ? 'TMDB에 연결되었습니다.' : '연결에 실패했습니다. 키를 확인해 주세요.', ok ? 'success' : 'error');
          testBtn.disabled = false;
          testBtn.textContent = '저장 및 연결 테스트';
        },
      }, '저장 및 연결 테스트');

      return el('div', { class: 'nm-card' }, [
        el('div', { class: 'row row--between' }, [el('h3', {}, '문화생활 · 인기 영화 연동(TMDB)'), statusBadge]),
        el('p', { class: 'text-muted', style: 'font-size:12px' }, 'themoviedb.org에서 무료로 발급받은 API 키를 입력하면 문화생활 화면에서 이번 주 인기 영화를 볼 수 있습니다. 연결 상태는 대시보드 상단에도 표시됩니다.'),
        el('div', { class: 'row', style: 'gap:8px' }, [keyInput, testBtn]),
      ]);
    }

    // 공공데이터포털(data.go.kr) + 오피넷 연동 — 1차: 특일정보(공휴일), 오피넷 유가정보.
    // 두 서비스는 발급 키 체계가 다르므로 입력칸을 분리한다.
    function publicDataCard() {
      const STATUS_LABEL = { connected: '✅ 연결됨', error: '⚠️ 연결 오류', unset: '미설정' };
      const enabled = window.getPublicDataEnabled();

      const dataGoKrInput = el('input', { class: 'nm-input', type: 'password', name: 'datagokr_key', placeholder: '공공데이터포털 서비스 키', value: window.getPublicDataKey() });
      const dataGoKrStatus = el('span', { class: 'nm-badge' }, STATUS_LABEL[window.getPublicDataStatus()]);
      const holidayToggle = el('label', { class: 'row', style: 'gap:8px; cursor:pointer; align-items:center' }, [
        el('input', { type: 'checkbox', name: 'holidays', checked: enabled.holidays || undefined }),
        el('span', { class: 'text-muted' }, '특일정보(공휴일) 연동 사용 · 일정 화면에서 "공휴일 가져오기"로 불러옵니다'),
      ]);
      const weatherAlertToggle = el('label', { class: 'row', style: 'gap:8px; cursor:pointer; align-items:center' }, [
        el('input', { type: 'checkbox', name: 'weatherAlerts', checked: enabled.weatherAlerts || undefined }),
        el('span', { class: 'text-muted' }, '기상특보 연동 사용(같은 키) · 홈 화면에 활성 특보를 보여줍니다'),
      ]);
      const evChargerToggle = el('label', { class: 'row', style: 'gap:8px; cursor:pointer; align-items:center' }, [
        el('input', { type: 'checkbox', name: 'evChargers', checked: enabled.evChargers || undefined }),
        el('span', { class: 'text-muted' }, '전기차충전소 연동 사용(같은 키) · 전기차 차량관리 화면에서 주변 충전소를 찾습니다'),
      ]);
      const kmaToggle = el('label', { class: 'row', style: 'gap:8px; cursor:pointer; align-items:center' }, [
        el('input', { type: 'checkbox', name: 'kmaForecast', checked: enabled.kmaForecast || undefined }),
        el('span', { class: 'text-muted' }, '기상청(KMA) 주간예보 연동 사용(같은 키) · 홈 화면의 날씨 주간예보에서 강수확률 등 상세 정보를 보여줍니다(서울/부산/제주 등 국내 프리셋 도시만 지원, 키가 없거나 실패하면 자동으로 Open-Meteo로 대체됩니다)'),
      ]);
      const saveHolidayBtn = el('button', {
        class: 'nm-btn',
        type: 'button',
        onclick: async () => {
          window.setPublicDataKey(dataGoKrInput.value.trim());
          window.setPublicDataEnabled({
            ...window.getPublicDataEnabled(),
            holidays: holidayToggle.querySelector('input').checked,
            weatherAlerts: weatherAlertToggle.querySelector('input').checked,
            evChargers: evChargerToggle.querySelector('input').checked,
            kmaForecast: kmaToggle.querySelector('input').checked,
          });
          if (!dataGoKrInput.value.trim()) {
            dataGoKrStatus.textContent = STATUS_LABEL.unset;
            toast('공공데이터포털 키를 삭제했습니다.', 'info');
            return;
          }
          saveHolidayBtn.disabled = true;
          saveHolidayBtn.textContent = '확인 중…';
          try {
            await window.fetchHolidays(new Date().getFullYear());
            dataGoKrStatus.textContent = STATUS_LABEL.connected;
            toast('공공데이터포털(특일정보)에 연결되었습니다.', 'success');
          } catch (e) {
            dataGoKrStatus.textContent = STATUS_LABEL.error;
            toast('연결에 실패했습니다: ' + e.message, 'error');
          }
          saveHolidayBtn.disabled = false;
          saveHolidayBtn.textContent = '저장 및 연결 테스트';
        },
      }, '저장 및 연결 테스트');

      const opinetInput = el('input', { class: 'nm-input', type: 'password', name: 'opinet_key', placeholder: '오피넷 API 키', value: window.getOpinetKey() });
      const fuelToggle = el('label', { class: 'row', style: 'gap:8px; cursor:pointer; align-items:center' }, [
        el('input', { type: 'checkbox', name: 'fuelPrice', checked: enabled.fuelPrice || undefined }),
        el('span', { class: 'text-muted' }, '오피넷 유가정보 연동 사용 · 차량관리 화면에서 전국 평균 유가와 비교합니다'),
      ]);
      const saveFuelBtn = el('button', {
        class: 'nm-btn',
        type: 'button',
        onclick: async () => {
          window.setOpinetKey(opinetInput.value.trim());
          window.setPublicDataEnabled({ ...window.getPublicDataEnabled(), fuelPrice: fuelToggle.querySelector('input').checked });
          if (!opinetInput.value.trim()) {
            toast('오피넷 키를 삭제했습니다.', 'info');
            return;
          }
          saveFuelBtn.disabled = true;
          saveFuelBtn.textContent = '확인 중…';
          try {
            await window.fetchFuelPrice();
            toast('오피넷 유가정보에 연결되었습니다.', 'success');
          } catch (e) {
            toast('연결에 실패했습니다: ' + e.message, 'error');
          }
          saveFuelBtn.disabled = false;
          saveFuelBtn.textContent = '저장 및 연결 테스트';
        },
      }, '저장 및 연결 테스트');

      const kopisInput = el('input', { class: 'nm-input', type: 'password', name: 'kopis_key', placeholder: 'KOPIS 서비스 키', value: window.getKopisKey() });
      const kopisToggle = el('label', { class: 'row', style: 'gap:8px; cursor:pointer; align-items:center' }, [
        el('input', { type: 'checkbox', name: 'cultureEvents', checked: enabled.cultureEvents || undefined }),
        el('span', { class: 'text-muted' }, 'KOPIS 공연전시정보 연동 사용 · 문화생활 화면에서 "공연·전시 검색"으로 찾아 바로 등록합니다'),
      ]);
      const saveKopisBtn = el('button', {
        class: 'nm-btn',
        type: 'button',
        onclick: async () => {
          window.setKopisKey(kopisInput.value.trim());
          window.setPublicDataEnabled({ ...window.getPublicDataEnabled(), cultureEvents: kopisToggle.querySelector('input').checked });
          if (!kopisInput.value.trim()) {
            toast('KOPIS 키를 삭제했습니다.', 'info');
            return;
          }
          saveKopisBtn.disabled = true;
          saveKopisBtn.textContent = '확인 중…';
          try {
            const today = new Date();
            const stdate = today.toISOString().slice(0, 10).replace(/-/g, '');
            const later = new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
            await window.fetchCultureEvents({ stdate, eddate: later, rows: 1 });
            toast('KOPIS 공연전시정보에 연결되었습니다.', 'success');
          } catch (e) {
            toast('연결에 실패했습니다: ' + e.message, 'error');
          }
          saveKopisBtn.disabled = false;
          saveKopisBtn.textContent = '저장 및 연결 테스트';
        },
      }, '저장 및 연결 테스트');

      return el('div', { class: 'nm-card' }, [
        el('h3', {}, '공공데이터포털 연동'),
        el('p', { class: 'text-muted', style: 'font-size:12px' }, '공공데이터포털·오피넷·KOPIS에서 무료로 발급받은 서비스 키를 등록하면 공휴일 자동 등록, 전국 평균 유가 비교, 공연·전시 검색 기능을 쓸 수 있습니다. 키는 이 브라우저에만 저장됩니다.'),
        el('div', { style: 'margin-top:12px' }, [
          el('div', { class: 'row row--between' }, [el('strong', { style: 'font-size:13px' }, '특일정보(공휴일)'), dataGoKrStatus]),
          el('p', { class: 'text-muted', style: 'font-size:11px' }, [
            '활용신청: ',
            el('a', { href: 'https://www.data.go.kr/data/15012690/openapi.do', target: '_blank', rel: 'noopener' }, 'data.go.kr 특일 정보'),
          ]),
          el('div', { class: 'row', style: 'gap:8px; margin:6px 0' }, [dataGoKrInput, saveHolidayBtn]),
          holidayToggle,
          el('p', { class: 'text-muted', style: 'font-size:11px; margin-top:6px' }, '아래 두 서비스도 같은 공공데이터포털 키를 쓰지만, data.go.kr에서 각각 별도로 "활용신청"해야 승인됩니다.'),
          weatherAlertToggle,
          evChargerToggle,
          kmaToggle,
        ]),
        el('div', { style: 'margin-top:16px; padding-top:12px; border-top:1px solid var(--border)' }, [
          el('strong', { style: 'font-size:13px' }, '오피넷 유가정보'),
          el('p', { class: 'text-muted', style: 'font-size:11px' }, [
            '활용신청: ',
            el('a', { href: 'https://www.opinet.co.kr/user/custapi/custApiInfo.do', target: '_blank', rel: 'noopener' }, 'opinet.co.kr Open API'),
          ]),
          el('div', { class: 'row', style: 'gap:8px; margin:6px 0' }, [opinetInput, saveFuelBtn]),
          fuelToggle,
        ]),
        el('div', { style: 'margin-top:16px; padding-top:12px; border-top:1px solid var(--border)' }, [
          el('strong', { style: 'font-size:13px' }, 'KOPIS 공연전시정보'),
          el('p', { class: 'text-muted', style: 'font-size:11px' }, [
            '활용신청: ',
            el('a', { href: 'https://kopis.or.kr/por/cs/openapi/openApiInfo.do?menuId=MNU_00074', target: '_blank', rel: 'noopener' }, 'kopis.or.kr Open API'),
          ]),
          el('div', { class: 'row', style: 'gap:8px; margin:6px 0' }, [kopisInput, saveKopisBtn]),
          kopisToggle,
        ]),
      ]);
    }

    // 커스텀 API 관리 — 공공데이터포털처럼 미리 정해둔 서비스가 아니라, 사용자가 이름/요청
    // URL/키를 직접 입력해 등록하고 원하는 메뉴에 체크박스로 연결한다. 연결된 메뉴 화면 하단에
    // 그 API의 원본 응답을 보여주는 카드가 자동으로 나타난다(js/router.js가 처리).
    function customApiCard() {
      const card = el('div', { class: 'nm-card' }, [
        el('div', { class: 'row row--between' }, [
          el('h3', {}, '커스텀 API 관리'),
          el('button', { class: 'nm-btn nm-btn--primary', onclick: () => openCustomApiForm() }, '+ API 등록'),
        ]),
        el('p', { class: 'text-muted', style: 'font-size:12px' }, '이름·요청 URL·키를 직접 등록하고, 연결할 메뉴를 체크하면 그 화면 하단에 원본 응답을 보여주는 카드가 자동으로 생깁니다. 요청 URL에 API 키를 넣을 자리는 {key}로 표시하세요(예: https://api.example.com/data?serviceKey={key}&type=json).'),
      ]);
      const list = el('div', { class: 'item-list', style: 'margin-top:10px' });
      card.append(list);
      renderList();

      function renderList() {
        list.innerHTML = '';
        const apis = window.listCustomApis();
        if (!apis.length) {
          list.append(el('p', { class: 'text-muted', style: 'font-size:13px' }, '등록된 커스텀 API가 없습니다.'));
          return;
        }
        for (const api of apis) {
          const menuLabels = (api.menus || [])
            .map((path) => (window.NAV_ITEMS || []).find((n) => n.path === path)?.label || path)
            .join(', ');
          list.append(
            el('div', { class: 'item-row' }, [
              el('div', { class: 'item-row__main' }, [
                el('div', { class: 'item-row__title' }, escapeHtml(api.name)),
                el('div', { class: 'text-muted', style: 'font-size:12px' }, `연결: ${menuLabels || '없음'}`),
              ]),
              el('div', { class: 'row', style: 'gap:6px; align-items:center' }, [
                el('button', {
                  class: `nm-toggle ${api.enabled !== false ? 'nm-toggle--on' : ''}`,
                  title: api.enabled !== false ? '사용 중(눌러서 끄기)' : '꺼짐(눌러서 켜기)',
                  onclick: () => {
                    window.upsertCustomApi({ ...api, enabled: api.enabled === false });
                    renderList();
                  },
                }),
                el('button', { class: 'nm-btn nm-btn--icon', title: '수정', onclick: () => openCustomApiForm(api) }, '✎'),
                el('button', {
                  class: 'nm-btn nm-btn--icon nm-btn--danger',
                  title: '삭제',
                  onclick: () => {
                    if (!confirmDialog(`"${api.name}"을(를) 삭제할까요?`)) return;
                    window.deleteCustomApi(api.id);
                    renderList();
                  },
                }, '🗑'),
              ]),
            ])
          );
        }
      }

      function openCustomApiForm(existing) {
        openModal({
          title: existing ? 'API 수정' : 'API 등록',
          contentBuilder(body, close) {
            const nameInput = el('input', { class: 'nm-input', name: 'name', required: true, value: existing?.name || '' });
            const urlInput = el('input', { class: 'nm-input', name: 'url', required: true, placeholder: 'https://api.example.com/data?serviceKey={key}&type=json', value: existing?.urlTemplate || '' });
            const keyInput = el('input', { class: 'nm-input', type: 'password', name: 'key', placeholder: '키가 필요 없는 공개 API면 비워두세요', value: existing?.keyValue || '' });
            const enabledCheckbox = el('input', { type: 'checkbox', name: 'enabled', checked: existing ? existing.enabled !== false : true });
            const menuChecks = (window.NAV_ITEMS || []).map((item) =>
              el('label', { class: 'row', style: 'gap:6px; align-items:center; font-size:13px' }, [
                el('input', { type: 'checkbox', name: 'menu', value: item.path, checked: (existing?.menus || []).includes(item.path) || undefined }),
                el('span', {}, `${item.icon} ${item.label}`),
              ])
            );
            const form = el('form', { class: 'stack' }, [
              el('div', { class: 'nm-field' }, [el('label', {}, '이름'), nameInput]),
              el('div', { class: 'nm-field' }, [el('label', {}, '요청 URL(전체, {key}로 키 위치 표시)'), urlInput]),
              el('div', { class: 'nm-field' }, [el('label', {}, 'API 키(선택)'), keyInput]),
              el('label', { class: 'row', style: 'gap:8px; cursor:pointer; align-items:center' }, [enabledCheckbox, el('span', { class: 'text-muted' }, '사용함')]),
              el('div', { class: 'nm-field' }, [
                el('label', {}, '연결할 메뉴(체크한 화면 하단에 카드가 나타납니다)'),
                el('div', { class: 'row wrap', style: 'gap:10px; max-height:180px; overflow-y:auto; padding:4px 0' }, menuChecks),
              ]),
              el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장'),
            ]);
            form.addEventListener('submit', (e) => {
              e.preventDefault();
              const menus = menuChecks
                .map((label) => label.querySelector('input'))
                .filter((cb) => cb.checked)
                .map((cb) => cb.value);
              window.upsertCustomApi({
                id: existing?.id || `api_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                name: nameInput.value.trim() || '이름 없는 API',
                urlTemplate: urlInput.value.trim(),
                keyValue: keyInput.value.trim(),
                enabled: enabledCheckbox.checked,
                menus,
              });
              toast('저장했습니다.', 'success');
              renderList();
              close();
            });
            body.append(form);
          },
        });
      }

      return card;
    }

    // 관리자 전용: 회원가입 승인 대기 목록 + 전체 사용자 목록(QMS 스타일 승인 관리).
    function userManagementCard() {
      const card = el('div', { class: 'nm-card' }, [
        el('h3', {}, '사용자 관리'),
        el('p', { class: 'text-muted' }, '새로 가입한 사용자는 아래에서 승인해야 로그인할 수 있습니다.'),
      ]);
      const body = el('div', { style: 'margin-top:10px' }, [el('p', { class: 'text-muted' }, '불러오는 중…')]);
      card.append(body);

      const store = window.getStore();
      Promise.all([store.listPendingUsers(), store.listAllUsers()])
        .then(([pending, all]) => {
          body.innerHTML = '';
          body.append(pendingSection(pending), allUsersSection(all));
        })
        .catch((err) => {
          body.innerHTML = '';
          body.append(el('p', { class: 'text-muted' }, `사용자 목록을 불러오지 못했습니다: ${err.message || err}`));
        });

      function pendingSection(pending) {
        if (!pending.length) {
          return el('p', { class: 'text-muted', style: 'font-size:13px' }, '승인 대기 중인 사용자가 없습니다.');
        }
        const list = el('div', { class: 'item-list' });
        pending.forEach((u) => {
          list.append(
            el('div', { class: 'item-row' }, [
              el('div', { class: 'item-row__main' }, [
                el('div', { class: 'item-row__title' }, u.name || u.username),
                el('div', { class: 'text-muted', style: 'font-size:12px' }, u.username),
              ]),
              el('div', { class: 'row', style: 'gap:6px' }, [
                el('button', {
                  class: 'nm-btn nm-btn--primary',
                  onclick: async () => {
                    await store.approveUser(u.id);
                    toast(`${u.name || u.username}님을 승인했습니다.`, 'success');
                    renderSettings(rerenderTarget());
                  },
                }, '승인'),
                el('button', {
                  class: 'nm-btn nm-btn--danger',
                  onclick: async () => {
                    if (!confirmDialog(`${u.name || u.username}님의 가입을 거절하시겠습니까?`)) return;
                    await store.rejectUser(u.id);
                    toast('가입을 거절했습니다.', 'success');
                    renderSettings(rerenderTarget());
                  },
                }, '거절'),
              ]),
            ])
          );
        });
        return el('div', {}, [el('h4', { style: 'font-size:13px; margin:10px 0 4px' }, `승인 대기 (${pending.length})`), list]);
      }

      function allUsersSection(all) {
        const list = el('div', { class: 'item-list' });
        all.forEach((u) => {
          const statusLabel = { approved: '승인됨', pending: '대기중', rejected: '거절됨' }[u.status] || u.status;
          list.append(
            el('div', { class: 'item-row' }, [
              el('div', { class: 'item-row__main' }, [
                el('div', { class: 'item-row__title' }, `${u.name || u.username} ${u.role === 'admin' ? '· 관리자' : ''}`),
                el('div', { class: 'text-muted', style: 'font-size:12px' }, `${u.username} · ${statusLabel}`),
              ]),
              el('div', { class: 'row', style: 'gap:6px' }, [
                CONFIG.mode === 'local' && u.id !== appState.user?.id
                  ? el('button', {
                      class: 'nm-btn',
                      title: '비밀번호를 잊은 사용자를 위해 관리자가 새 비밀번호로 재설정합니다.',
                      onclick: () => openAdminResetPasswordModal(u),
                    }, '비밀번호 재설정')
                  : null,
                u.status === 'approved' && u.role !== 'admin'
                  ? el('button', {
                      class: 'nm-btn nm-btn--danger',
                      onclick: async () => {
                        if (!confirmDialog(`${u.name || u.username}님의 승인을 취소(거절 처리)하시겠습니까?`)) return;
                        await store.rejectUser(u.id);
                        toast('승인을 취소했습니다.', 'success');
                        renderSettings(rerenderTarget());
                      },
                    }, '승인 취소')
                  : null,
              ]),
            ])
          );
        });
        return el('div', {}, [el('h4', { style: 'font-size:13px; margin:14px 0 4px' }, `전체 사용자 (${all.length})`), list]);
      }

      // 로컬 모드 전용: 관리자가 다른 사용자의 비밀번호를 새로 지정한다(비밀번호를 잊었을 때 대응).
      // Supabase 모드는 service_role 키가 필요한 관리자 API라 클라이언트에서는 지원하지 않는다
      // (본인이 "비밀번호를 잊으셨나요?"로 재설정 메일을 받아야 한다).
      function openAdminResetPasswordModal(u) {
        openModal({
          title: `${u.name || u.username}님 비밀번호 재설정`,
          contentBuilder(body, close) {
            const newInput = el('input', { class: 'nm-input', type: 'password', name: 'new', required: true, minlength: '4', autocomplete: 'new-password' });
            const confirmInput = el('input', { class: 'nm-input', type: 'password', name: 'confirm', required: true, autocomplete: 'new-password' });
            const errMsg = el('p', { class: 'text-muted', style: 'color:#ef4444; font-size:13px; display:none' });
            const form = el('form', { class: 'stack' }, [
              el('p', { class: 'text-muted', style: 'font-size:12px' }, `${u.username}님에게 전달할 새 비밀번호를 지정합니다. 다음 로그인 시 이 비밀번호를 사용합니다.`),
              el('div', { class: 'nm-field' }, [el('label', {}, '새 비밀번호(4자 이상)'), newInput]),
              el('div', { class: 'nm-field' }, [el('label', {}, '새 비밀번호 확인'), confirmInput]),
              errMsg,
              el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '재설정'),
            ]);
            form.addEventListener('submit', async (e) => {
              e.preventDefault();
              errMsg.style.display = 'none';
              if (newInput.value !== confirmInput.value) {
                errMsg.textContent = '새 비밀번호가 일치하지 않습니다.';
                errMsg.style.display = 'block';
                return;
              }
              try {
                await store.adminResetPassword(u.id, newInput.value);
                toast(`${u.name || u.username}님의 비밀번호를 재설정했습니다.`, 'success');
                close();
              } catch (err) {
                errMsg.textContent = err.message || '비밀번호 재설정에 실패했습니다.';
                errMsg.style.display = 'block';
              }
            });
            body.append(form);
          },
        });
      }

      return card;
    }

    function exportCsv(key, spec) {
      const rows = appState[key] || [];
      if (spec.sensitive && !confirmDialog(`${spec.label}에는 민감할 수 있는 개인 기록이 포함됩니다. 내보내시겠습니까?`)) return;
      window.downloadCsv(`${key}-${new Date().toISOString().slice(0, 10)}.csv`, rows, spec.columns);
      toast('CSV로 내보냈습니다.', 'success');
    }

    function themeBtn(value, label) {
      const active = theme === value;
      return el(
        'button',
        {
          class: `nm-btn ${active ? 'nm-btn--primary' : ''}`,
          onclick: () => {
            localStorage.setItem('workspace:theme', value);
            applyTheme(value);
            renderSettings(rerenderTarget());
          },
        },
        label
      );
    }

    function rerenderTarget() {
      container.innerHTML = '';
      return container;
    }

    async function signOut() {
      await window.getStore().signOut();
      location.hash = '';
      location.reload();
    }

    // 로그인 상태에서 본인이 현재 비밀번호를 알고 있을 때 바꾸는 흐름(로컬/Supabase 공통).
    function openChangePasswordModal() {
      openModal({
        title: '비밀번호 변경',
        contentBuilder(body, close) {
          const currentInput = el('input', { class: 'nm-input', type: 'password', name: 'current', required: true, autocomplete: 'current-password' });
          const newInput = el('input', { class: 'nm-input', type: 'password', name: 'new', required: true, minlength: CONFIG.mode === 'local' ? '4' : '6', autocomplete: 'new-password' });
          const confirmInput = el('input', { class: 'nm-input', type: 'password', name: 'confirm', required: true, autocomplete: 'new-password' });
          const errMsg = el('p', { class: 'text-muted', style: 'color:#ef4444; font-size:13px; display:none' });
          const form = el('form', { class: 'stack' }, [
            el('div', { class: 'nm-field' }, [el('label', {}, '현재 비밀번호'), currentInput]),
            el('div', { class: 'nm-field' }, [el('label', {}, `새 비밀번호(${CONFIG.mode === 'local' ? '4' : '6'}자 이상)`), newInput]),
            el('div', { class: 'nm-field' }, [el('label', {}, '새 비밀번호 확인'), confirmInput]),
            errMsg,
            el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '변경'),
          ]);
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            errMsg.style.display = 'none';
            if (newInput.value !== confirmInput.value) {
              errMsg.textContent = '새 비밀번호가 일치하지 않습니다.';
              errMsg.style.display = 'block';
              return;
            }
            try {
              const store = window.getStore();
              if (CONFIG.mode === 'local') {
                await store.changePassword(appState.user.id, currentInput.value, newInput.value);
              } else {
                await store.changePassword(currentInput.value, newInput.value);
              }
              toast('비밀번호를 변경했습니다.', 'success');
              close();
            } catch (err) {
              errMsg.textContent = err.message || '비밀번호 변경에 실패했습니다.';
              errMsg.style.display = 'block';
            }
          });
          body.append(form);
        },
      });
    }

    // 📥 데이터 가져오기 UI — "데이터 내보내기" 카드 하단에 붙는 가져오기 섹션.
    // 숨겨진 파일 input을 버튼 클릭으로 열고, 선택한 파일을 importData()로 넘긴다.
    function importDataSection() {
      const fileInput = el('input', {
        type: 'file',
        accept: 'application/json',
        style: 'display:none',
        onchange: async (e) => {
          const file = e.target.files && e.target.files[0];
          e.target.value = '';
          if (!file) return;
          await importData(file);
        },
      });
      const importBtn = el('button', {
        class: 'nm-btn',
        type: 'button',
        onclick: () => fileInput.click(),
      }, '📥 데이터 가져오기');
      return el('div', { style: 'margin-top:16px; padding-top:12px; border-top:1px solid var(--border)' }, [
        el('strong', { style: 'font-size:13px' }, '📥 데이터 가져오기'),
        el('p', { class: 'text-muted', style: 'font-size:11px' },
          '다른 계정/모드에서 내보낸 백업(JSON) 파일을 현재 로그인한 계정으로 가져옵니다. ' +
          '기존 데이터는 삭제되지 않고 추가됩니다.'),
        el('div', { class: 'row', style: 'gap:8px; margin-top:6px' }, [importBtn, fileInput]),
      ]);
    }

    function exportData() {
      const payload = {
        exportedAt: new Date().toISOString(),
        schedules: appState.schedules,
        projects: appState.projects,
        // admin_password는 암호화된 값(wsenc1:...)이면 그대로 포함하고(잠금 암호 없이는
        // 어차피 읽을 수 없으므로 안전), 암호화 이전에 저장된 과거 평문 값은 백업 파일이
        // 다운로드 폴더에 그대로 남는 것을 막기 위해 내보내기에서 제외한다.
        programs: appState.programs.map((p) => (
          p.admin_password && !window.secretCrypto.isEncryptedSecret(p.admin_password)
            ? { ...p, admin_password: null }
            : p
        )),
        notifications: appState.notifications,
        challenges: appState.challenges,
        checkinsByChallenge: appState.checkinsByChallenge,
        vehicles: appState.vehicles,
        maintenanceByVehicle: appState.maintenanceByVehicle,
        fuelLogsByVehicle: appState.fuelLogsByVehicle,
        healthMetrics: appState.healthMetrics,
        healthAppointments: appState.healthAppointments,
        playlistItems: appState.playlistItems,
        devlogs: appState.devlogs,
        knowledgeDocs: appState.knowledgeDocs,
        briefingTopics: appState.briefingTopics,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `workspace-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('내보내기가 완료되었습니다.', 'success');
    }
  }

  // ---- 📥 데이터 가져오기 (전체 백업 JSON → 현재 로그인한 계정/모드에 추가) ----
  // exportData()가 만드는 백업 파일을 다시 읽어 레코드를 하나씩 생성한다. 로컬 모드와
  // Supabase 모드 모두에서 동작해야 하므로 appState의 addX() 래퍼(모드마다 매번 refreshAll을
  // 호출해 느림) 대신 window.getStore().create(table, obj)를 직접 사용하고, 끝에 한 번만
  // refreshAll()을 호출한다.
  const IMPORT_FLAT_TABLES = {
    schedules: 'schedules',
    projects: 'projects',
    programs: 'programs',
    notifications: 'notifications',
    healthMetrics: 'health_metrics',
    healthAppointments: 'health_appointments',
    playlistItems: 'playlist_items',
    devlogs: 'devlogs',
    knowledgeDocs: 'knowledge_docs',
    briefingTopics: 'briefing_topics',
  };
  const IMPORT_LABELS = {
    schedules: '일정', projects: '프로젝트', programs: '프로그램', notifications: '알림',
    challenges: '챌린지', checkinsByChallenge: '챌린지 체크인', vehicles: '차량',
    maintenanceByVehicle: '정비기록', fuelLogsByVehicle: '주유기록', healthMetrics: 'Health 기록',
    healthAppointments: '병원/검진 일정', playlistItems: '문화생활', devlogs: 'Devlog',
    knowledgeDocs: 'Knowledge', briefingTopics: '관심주제',
  };
  // 새로 생성될 때 스토어가 직접 채워야 하는 필드. 옛 id를 그대로 밀어넣으면
  // localStore.create()는 `{ id: uid(), ...obj }` 순서상 obj.id가 그걸 덮어써 버리고
  // (= 새 id가 아예 생성되지 않고), supabaseStore는 이미 쓰인 PK라 충돌할 수 있다.
  // user_id/created_at/updated_at/deleted_at도 가져오는 시점에 새로 채워져야 하는 값이다.
  const IMPORT_RESERVED_FIELDS = ['id', 'created_at', 'updated_at', 'deleted_at', 'user_id'];

  // 레코드에서 시스템 필드(+ 호출부가 지정한 추가 필드)를 제거한 새 객체를 반환하는 순수 함수.
  function sanitizeImportRecord(record, extraOmitKeys = []) {
    const omit = new Set([...IMPORT_RESERVED_FIELDS, ...extraOmitKeys]);
    const out = {};
    for (const [k, v] of Object.entries(record || {})) {
      if (!omit.has(k)) out[k] = v;
    }
    return out;
  }

  // 옛(백업 당시) 부모 id를, 이번 가져오기에서 새로 생성된 id로 바꿔주는 순수 함수.
  // 그 부모 자체가 생성에 실패했거나 백업에 없었다면 null을 반환한다(자식은 건너뛴다).
  function remapForeignId(oldId, idMap) {
    if (oldId === null || oldId === undefined || !idMap) return null;
    const mapped = idMap[oldId];
    return mapped === undefined ? null : mapped;
  }

  // 업로드된 JSON이 이 앱의 백업 파일 형태인지 최소한으로 검증하는 순수 함수.
  function isValidImportPayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    const KNOWN_KEYS = Object.keys(IMPORT_LABELS).concat('exportedAt');
    return KNOWN_KEYS.some((k) => k in payload);
  }

  // 가져올 전체 레코드 수를 세는 순수 함수(확인 다이얼로그에 보여줄 용도).
  function countImportRecords(payload) {
    let n = 0;
    for (const cat of Object.keys(IMPORT_FLAT_TABLES)) {
      if (Array.isArray(payload[cat])) n += payload[cat].length;
    }
    if (Array.isArray(payload.challenges)) n += payload.challenges.length;
    if (Array.isArray(payload.vehicles)) n += payload.vehicles.length;
    for (const key of ['checkinsByChallenge', 'maintenanceByVehicle', 'fuelLogsByVehicle']) {
      const grouped = payload[key];
      if (grouped && typeof grouped === 'object') {
        for (const rows of Object.values(grouped)) {
          if (Array.isArray(rows)) n += rows.length;
        }
      }
    }
    return n;
  }

  async function importData(file) {
    let payload;
    try {
      const text = await file.text();
      payload = JSON.parse(text);
    } catch (e) {
      toast('올바른 JSON 파일이 아닙니다: ' + (e.message || e), 'error');
      return;
    }
    if (!isValidImportPayload(payload)) {
      toast('백업 파일 형식이 올바르지 않습니다(이 앱에서 내보낸 백업 JSON인지 확인해 주세요).', 'error');
      return;
    }

    const total = countImportRecords(payload);
    if (!total) {
      toast('가져올 데이터가 없는 백업 파일입니다.', 'info');
      return;
    }
    if (!confirmDialog(`백업 파일에서 총 ${total}건을 현재 계정으로 가져옵니다. 기존 데이터는 지워지지 않고 추가만 됩니다. 계속할까요?`)) {
      return;
    }

    const store = window.getStore();
    const uid = appState.user.id;
    const summary = {}; // category -> { ok, fail }
    const failDetails = [];
    function record(cat, ok, reason) {
      if (!summary[cat]) summary[cat] = { ok: 0, fail: 0 };
      if (ok) summary[cat].ok++;
      else {
        summary[cat].fail++;
        if (reason) failDetails.push(`${IMPORT_LABELS[cat] || cat}: ${reason}`);
      }
    }

    // 1) 독립적인(부모-자식 관계가 없는) 카테고리
    for (const [cat, table] of Object.entries(IMPORT_FLAT_TABLES)) {
      const rows = payload[cat];
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        try {
          // health_appointments.schedule_id는 가져오기 당시 함께 만든 옛 일정을 가리키던 값이라
          // 그대로 두면 엉뚱한(또는 존재하지 않는) 일정을 가리키게 된다 — 연결 없이 가져온다.
          const extraOmit = cat === 'healthAppointments' ? ['schedule_id'] : [];
          const clean = sanitizeImportRecord(row, extraOmit);
          await store.create(table, { ...clean, user_id: uid });
          record(cat, true);
        } catch (e) {
          record(cat, false, e.message || String(e));
        }
      }
    }

    // 2) 챌린지 → 체크인 (옛 챌린지 id를 새 id로 매핑해야 체크인이 올바른 챌린지에 붙는다)
    const challengeIdMap = {};
    if (Array.isArray(payload.challenges)) {
      for (const ch of payload.challenges) {
        try {
          const clean = sanitizeImportRecord(ch);
          const created = await store.create('challenges', { ...clean, user_id: uid });
          challengeIdMap[ch.id] = created.id;
          record('challenges', true);
        } catch (e) {
          record('challenges', false, e.message || String(e));
        }
      }
    }
    if (payload.checkinsByChallenge && typeof payload.checkinsByChallenge === 'object') {
      for (const [oldChallengeId, checkins] of Object.entries(payload.checkinsByChallenge)) {
        const newChallengeId = remapForeignId(oldChallengeId, challengeIdMap);
        for (const c of checkins || []) {
          if (!newChallengeId) {
            record('checkinsByChallenge', false, `연결된 챌린지(이전 id: ${oldChallengeId})를 가져오지 못해 건너뜀`);
            continue;
          }
          try {
            const clean = sanitizeImportRecord(c, ['challenge_id']);
            await store.create('challenge_checkins', { ...clean, challenge_id: newChallengeId });
            record('checkinsByChallenge', true);
          } catch (e) {
            record('checkinsByChallenge', false, e.message || String(e));
          }
        }
      }
    }

    // 3) 차량 → 정비기록/주유기록 (옛 차량 id를 새 id로 매핑)
    const vehicleIdMap = {};
    if (Array.isArray(payload.vehicles)) {
      for (const v of payload.vehicles) {
        try {
          const clean = sanitizeImportRecord(v);
          const created = await store.create('vehicles', { ...clean, user_id: uid });
          vehicleIdMap[v.id] = created.id;
          record('vehicles', true);
        } catch (e) {
          record('vehicles', false, e.message || String(e));
        }
      }
    }
    for (const [cat, table] of [['maintenanceByVehicle', 'vehicle_maintenance'], ['fuelLogsByVehicle', 'vehicle_fuel_logs']]) {
      const grouped = payload[cat];
      if (!grouped || typeof grouped !== 'object') continue;
      for (const [oldVehicleId, rows] of Object.entries(grouped)) {
        const newVehicleId = remapForeignId(oldVehicleId, vehicleIdMap);
        for (const r of rows || []) {
          if (!newVehicleId) {
            record(cat, false, `연결된 차량(이전 id: ${oldVehicleId})을 가져오지 못해 건너뜀`);
            continue;
          }
          try {
            const clean = sanitizeImportRecord(r, ['vehicle_id']);
            await store.create(table, { ...clean, vehicle_id: newVehicleId });
            record(cat, true);
          } catch (e) {
            record(cat, false, e.message || String(e));
          }
        }
      }
    }

    await appState.refreshAll();

    const totalOk = Object.values(summary).reduce((s, v) => s + v.ok, 0);
    const totalFail = Object.values(summary).reduce((s, v) => s + v.fail, 0);
    const breakdown = Object.entries(summary)
      .filter(([, v]) => v.ok || v.fail)
      .map(([cat, v]) => `${IMPORT_LABELS[cat] || cat} ${v.ok}건${v.fail ? ` (실패 ${v.fail}건)` : ''}`)
      .join(', ');
    if (totalFail) {
      console.warn('[데이터 가져오기] 실패 상세:', failDetails);
      toast(`가져오기 완료: 총 ${totalOk}건 성공, ${totalFail}건 실패 — ${breakdown}`, 'error');
    } else {
      toast(`가져오기 완료: 총 ${totalOk}건을 가져왔습니다 (${breakdown})`, 'success');
    }
  }

  // 순수 로직은 Node 유닛테스트(tests/importExport.test.mjs)에서 직접 검증할 수 있도록 노출한다.
  window.__importExport = { sanitizeImportRecord, remapForeignId, isValidImportPayload, countImportRecords };

  function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === 'light') root.setAttribute('data-theme', 'light');
    else if (theme === 'dark') root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
  }

  window.renderSettings = renderSettings;
  window.applyTheme = applyTheme;
})();
