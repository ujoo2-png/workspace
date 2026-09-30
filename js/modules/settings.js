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
  };

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
        weatherCard(),
        tmdbCard(),
        publicDataCard(),
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
        ]),
        el('div', { class: 'nm-card' }, [
          el('h3', {}, '앱 정보'),
          el('p', { class: 'text-muted' }, `버전: ${CONFIG.version}`),
          el('p', { class: 'text-muted', style: 'font-size:12px' }, '개인 참고용 기록 도구이며 의료 정보 시스템이 아닙니다. Health 기록은 진단·복약 등 민감 의료정보가 아닌 체중/운동/수면 등 일반 웰니스 지표만 다룹니다.'),
        ]),
      ])
    );

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
      const saveHolidayBtn = el('button', {
        class: 'nm-btn',
        type: 'button',
        onclick: async () => {
          window.setPublicDataKey(dataGoKrInput.value.trim());
          window.setPublicDataEnabled({ ...window.getPublicDataEnabled(), holidays: holidayToggle.querySelector('input').checked });
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

      return el('div', { class: 'nm-card' }, [
        el('h3', {}, '공공데이터포털 연동'),
        el('p', { class: 'text-muted', style: 'font-size:12px' }, '공공데이터포털·오피넷에서 무료로 발급받은 서비스 키를 등록하면 공휴일 자동 등록, 전국 평균 유가 비교 기능을 쓸 수 있습니다. 키는 이 브라우저에만 저장됩니다.'),
        el('div', { style: 'margin-top:12px' }, [
          el('div', { class: 'row row--between' }, [el('strong', { style: 'font-size:13px' }, '특일정보(공휴일)'), dataGoKrStatus]),
          el('p', { class: 'text-muted', style: 'font-size:11px' }, [
            '활용신청: ',
            el('a', { href: 'https://www.data.go.kr/data/15012690/openapi.do', target: '_blank', rel: 'noopener' }, 'data.go.kr 특일 정보'),
          ]),
          el('div', { class: 'row', style: 'gap:8px; margin:6px 0' }, [dataGoKrInput, saveHolidayBtn]),
          holidayToggle,
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
      ]);
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

    function exportData() {
      const payload = {
        exportedAt: new Date().toISOString(),
        schedules: appState.schedules,
        projects: appState.projects,
        programs: appState.programs,
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

  function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === 'light') root.setAttribute('data-theme', 'light');
    else if (theme === 'dark') root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
  }

  window.renderSettings = renderSettings;
  window.applyTheme = applyTheme;
})();
