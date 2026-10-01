// Health 화면. 체중·운동·수면 등 일반 웰니스 기록과 병원/검진 등 약속 일정을 관리한다.
// (진단명·복약 등 민감한 의료 정보는 다루지 않는다 — 체중/혈압/혈당/콜레스테롤 등 사용자가
// 직접 측정해 기록하는 일반 웰니스 지표만 다룬다.)
// 일반 <script>로 로드된다.
(function () {
  const { appState, el, escapeHtml, toast, confirmDialog, openModal, todayISO, aggregateMetricTrend } = window;

  // ---- 지표 정의 ----
  // 혈압은 수축기/이완기 두 값이라 'blood_pressure'라는 가상 종류로 입력받아
  // bp_systolic/bp_diastolic 두 개의 실제 기록으로 나눠 저장한다(저장은 state.js의 addHealthMetrics).
  const METRIC_TYPE_LABEL = {
    weight: '체중',
    exercise: '운동',
    sleep: '수면',
    steps: '걸음수',
    condition: '컨디션',
    bp_systolic: '수축기 혈압',
    bp_diastolic: '이완기 혈압',
    pulse: '맥박',
    blood_glucose: '혈당',
    total_cholesterol: '총콜레스테롤',
    triglycerides: '중성지방',
    hdl: 'HDL(좋은 콜레스테롤)',
  };
  const METRIC_UNIT_DEFAULT = {
    weight: 'kg', exercise: '분', sleep: '시간', steps: '걸음', condition: '점(1-5)',
    bp_systolic: 'mmHg', bp_diastolic: 'mmHg', pulse: 'bpm', blood_glucose: 'mg/dL',
    total_cholesterol: 'mg/dL', triglycerides: 'mg/dL', hdl: 'mg/dL',
  };
  const CONFIDENCE_LABEL = { high: '높음', medium: '보통', low: '낮음', none: '데이터 부족' };

  // 기록 추가 폼에서 고를 수 있는 종류 목록(혈압은 가상 항목).
  const FORM_TYPES = [
    ['weight', '체중'], ['exercise', '운동'], ['sleep', '수면'], ['steps', '걸음수'], ['condition', '컨디션'],
    ['blood_pressure', '혈압(수축기/이완기)'], ['pulse', '맥박'], ['blood_glucose', '혈당'],
    ['total_cholesterol', '총콜레스테롤'], ['triglycerides', '중성지방'], ['hdl', 'HDL(좋은 콜레스테롤)'],
  ];

  // KPI 요약 카드 목록. bp는 두 지표를 묶어서 "120/80"처럼 보여주는 합성 카드.
  const KPI_DEFS = [
    { key: 'weight', label: '체중' },
    { key: 'exercise', label: '운동' },
    { key: 'sleep', label: '수면' },
    { key: 'steps', label: '걸음수' },
    { key: 'condition', label: '컨디션' },
    { key: 'bp', label: '혈압', composite: true },
    { key: 'pulse', label: '맥박' },
    { key: 'blood_glucose', label: '혈당' },
    { key: 'total_cholesterol', label: '총콜레스테롤' },
    { key: 'triglycerides', label: '중성지방' },
    { key: 'hdl', label: 'HDL' },
  ];

  // ---- 기준치 판정 (일반적인 건강검진 기준 참고용 — 의학적 진단이 아닙니다) ----
  function cholesterolStatus(type, value) {
    if (value == null || Number.isNaN(value)) return null;
    if (type === 'total_cholesterol') {
      if (value < 200) return { level: 'success', label: '정상' };
      if (value <= 239) return { level: 'warning', label: '경계' };
      return { level: 'critical', label: '높음' };
    }
    if (type === 'triglycerides') {
      if (value < 150) return { level: 'success', label: '정상' };
      if (value <= 199) return { level: 'warning', label: '경계' };
      return { level: 'critical', label: '높음' };
    }
    if (type === 'hdl') {
      // HDL은 높을수록 좋다(다른 지표와 반대 방향).
      if (value >= 60) return { level: 'success', label: '정상(좋음)' };
      if (value >= 40) return { level: 'warning', label: '보통' };
      return { level: 'critical', label: '낮음' };
    }
    return null;
  }

  // 혈압 분류(대한고혈압학회/AHA 참고 — 간단화한 참고용 기준).
  function bpStatus(systolic, diastolic) {
    if (systolic == null || diastolic == null) return null;
    if (systolic >= 180 || diastolic >= 120) return { level: 'critical', label: '고혈압 위기' };
    if (systolic >= 140 || diastolic >= 90) return { level: 'critical', label: '고혈압 2기' };
    if (systolic >= 130 || diastolic >= 80) return { level: 'warning', label: '고혈압 1기' };
    if (systolic >= 120) return { level: 'warning', label: '상승' };
    return { level: 'success', label: '정상' };
  }

  // "고지혈증" 관리항목 — 하나의 숫자가 아니라 총콜레스테롤/중성지방/HDL 세 지표를 종합한
  // 상태 뱃지로 보여준다(요청하신 "고지혈증 항목"은 세 지표의 조합으로 판단하는 것이 의학적으로
  // 자연스러워 이렇게 구성했습니다 — 더 좋은 방식이 있다면 알려주세요).
  function hyperlipidemiaStatus(latest) {
    const tc = latest.total_cholesterol;
    const tg = latest.triglycerides;
    const hdl = latest.hdl;
    if (tc == null && tg == null && hdl == null) return null;
    const risky = (tc != null && tc >= 240) || (tg != null && tg >= 200) || (hdl != null && hdl < 40);
    if (risky) return { level: 'critical', label: '위험' };
    const caution = (tc != null && tc >= 200) || (tg != null && tg >= 150) || (hdl != null && hdl < 60);
    if (caution) return { level: 'warning', label: '주의' };
    return { level: 'success', label: '정상' };
  }

  // ---- 나이대별 건강 제안(삼성헬스류 벤치마킹 — 일반적인 공공 건강검진 권장안이며 의학적 진단이 아닙니다) ----
  function ageHealthTips(age, gender) {
    const tips = [];
    if (age == null) return tips;
    tips.push('연 1회 국가건강검진(일반검진)을 꾸준히 받아보세요.');
    if (age >= 30) tips.push('혈압·혈당·콜레스테롤을 1년에 한 번은 확인해보는 것이 좋습니다.');
    if (age >= 40) {
      tips.push('만 40세부터는 위내시경(2년 주기)과 간암 고위험군 검사 대상이 될 수 있습니다.');
      tips.push('이상지질혈증(고지혈증) 선별검사가 국가건강검진에 포함되는 연령대입니다.');
    }
    if (age >= 50) {
      tips.push('대장암 선별을 위한 분변잠혈검사(매년) 또는 대장내시경(5~10년 주기)을 고려해보세요.');
      tips.push('골밀도 검사(특히 여성)를 고려해볼 시기입니다.');
    }
    if (age >= 60) {
      tips.push('근감소증 예방을 위해 유산소 운동과 함께 근력 운동 비중을 늘려보세요.');
      tips.push('백내장·녹내장 등 안과 정기검진을 권장합니다.');
    }
    if (gender === 'female' && age >= 40) tips.push('유방암 선별을 위한 유방촬영술(2년 주기)을 고려해보세요.');
    if (gender === 'male' && age >= 50) tips.push('전립선 관련 검사를 주치의와 상의해보세요.');
    return tips;
  }

  function calcAge(birthDateIso) {
    if (!birthDateIso) return null;
    const today = new Date();
    const b = new Date(birthDateIso + 'T00:00:00');
    let age = today.getFullYear() - b.getFullYear();
    const beforeBirthday = today.getMonth() < b.getMonth() || (today.getMonth() === b.getMonth() && today.getDate() < b.getDate());
    if (beforeBirthday) age--;
    return age;
  }

  function statusBadge(status) {
    if (!status) return null;
    const cls = status.level === 'success' ? 'nm-badge--success' : status.level === 'warning' ? 'nm-badge--warning' : 'nm-badge--critical';
    return el('span', { class: `nm-badge ${cls}` }, status.label);
  }

  function renderHealth(root) {
    const container = el('div', {});
    root.append(container);
    let weeklyGoal = Number(localStorage.getItem('workspace:health:weeklyGoal')) || 3;
    let showGuide = false;
    let trendType = 'weight';
    let trendPeriod = 'week';
    let recordFilter = 'all';
    let recordPage = 1;
    const PAGE_SIZE = 10;
    let selectedAppointments = new Set();

    // 상단에 항상 보이는 4개 지표(체중/걸음수/수축기·이완기 혈압) 작은 트렌드 차트 정의.
    const DASHBOARD_METRICS = [
      { key: 'weight', label: '체중', hue: '#3b82f6' },
      { key: 'steps', label: '걸음수', hue: '#22c55e' },
      { key: 'bp_systolic', label: '수축기 혈압', hue: '#ef4444' },
      { key: 'bp_diastolic', label: '이완기 혈압', hue: '#f59e0b' },
    ];

    function latestByType() {
      const result = {};
      for (const key of Object.keys(METRIC_TYPE_LABEL)) {
        const rows = appState.healthMetrics.filter((m) => m.metric_type === key).sort((a, b) => (b.recorded_at || '').localeCompare(a.recorded_at || ''));
        result[key] = rows[0] ? rows[0].value : null;
      }
      return result;
    }

    function draw() {
      container.innerHTML = '';
      container.append(
        el('div', { class: 'page-header' }, [
          el('h1', {}, 'Health'),
          el('div', { class: 'row', style: 'gap:8px' }, [
            el('button', { class: 'nm-btn', onclick: () => openAppointmentForm() }, '+ 일정 등록'),
            el('button', { class: 'nm-btn nm-btn--primary', onclick: () => openMetricForm() }, '+ 기록 추가'),
          ]),
        ])
      );

      // 4대 지표 항상 보이는 미니 대시보드(체중/걸음수/혈압 2종) — 아래 "트렌드 그래프"(지표 선택형)와
      // 별개로, 가장 자주 확인하는 지표 4개를 한 화면에서 바로 비교할 수 있게 둔다.
      container.append(dashboardSection());

      const latest = latestByType();

      // 최근 지표 요약 카드
      const summaryGrid = el('div', { class: 'kpi-grid health-kpi-grid' });
      for (const def of KPI_DEFS) {
        if (def.composite) {
          const sys = latest.bp_systolic;
          const dia = latest.bp_diastolic;
          const status = bpStatus(sys, dia);
          summaryGrid.append(
            el('div', { class: 'nm-card kpi-card' }, [
              el('div', { class: 'kpi-card__value' }, sys != null && dia != null ? `${sys}/${dia}` : '-'),
              el('div', { class: 'kpi-card__label' }, `${def.label}(mmHg)`),
              status ? el('div', { style: 'margin-top:4px' }, [statusBadge(status)]) : null,
            ])
          );
          continue;
        }
        const value = latest[def.key];
        const status = ['total_cholesterol', 'triglycerides', 'hdl'].includes(def.key) ? cholesterolStatus(def.key, value) : null;
        summaryGrid.append(
          el('div', { class: 'nm-card kpi-card' }, [
            el('div', { class: 'kpi-card__value' }, value != null ? `${value}${METRIC_UNIT_DEFAULT[def.key] || ''}` : '-'),
            el('div', { class: 'kpi-card__label' }, def.label),
            status ? el('div', { style: 'margin-top:4px' }, [statusBadge(status)]) : null,
          ])
        );
      }
      // 고지혈증 종합 판정 카드(총콜레스테롤/중성지방/HDL 세 지표 종합)
      const lipidStatus = hyperlipidemiaStatus({ total_cholesterol: latest.total_cholesterol, triglycerides: latest.triglycerides, hdl: latest.hdl });
      summaryGrid.append(
        el('div', { class: 'nm-card kpi-card' }, [
          el('div', { class: 'kpi-card__value', style: 'font-size:18px' }, lipidStatus ? '' : '-'),
          lipidStatus ? el('div', { style: 'margin:2px 0' }, [statusBadge(lipidStatus)]) : null,
          el('div', { class: 'kpi-card__label' }, '고지혈증(종합)'),
        ])
      );
      container.append(summaryGrid);

      const today = todayISO();

      // 예측 · 트렌드
      const exerciseMetrics = appState.healthMetrics.filter((m) => m.metric_type === 'exercise');
      const goalPrediction = window.predictWeeklyExerciseGoal(exerciseMetrics, weeklyGoal, today);
      const weightRows = appState.healthMetrics
        .filter((m) => m.metric_type === 'weight')
        .slice()
        .sort((a, b) => (a.recorded_at || '').localeCompare(b.recorded_at || ''));
      const weightDelta = weightRows.length >= 2 ? Number((weightRows[weightRows.length - 1].value - weightRows[0].value).toFixed(1)) : null;

      const predictCard = el('div', { class: 'nm-card', style: 'margin-bottom:16px' }, [
        el('div', { class: 'row row--between', style: 'align-items:flex-start' }, [
          el('h3', {}, '예측 · 트렌드'),
          el('button', { class: 'nm-btn nm-btn--icon', title: '사용법 보기', onclick: () => { showGuide = !showGuide; draw(); } }, 'ⓘ'),
        ]),
        showGuide
          ? el('div', { class: 'health-guide-box text-muted', style: 'font-size:12px; margin-bottom:10px' }, [
              el('div', {}, '· 예측: 최근 14일간의 운동 기록을 바탕으로 이번 주 목표 달성 가능성(%)을 계산합니다. 기록이 많을수록(특히 8회 이상) 신뢰도가 높아집니다.'),
              el('div', { style: 'margin-top:4px' }, '· 트렌드: 아래에서 지표와 기간(주간/월간/분기)을 고르면, 그 기간 동안의 평균값 변화를 그래프로 보여줍니다. 막대가 비어 있으면 그 기간에 기록이 없었다는 뜻입니다.'),
            ])
          : null,
        el('div', { class: 'row row--between wrap', style: 'gap:16px; margin-top:8px' }, [
          el('div', {}, [
            el('div', { class: 'row', style: 'gap:8px; align-items:center' }, [
              el('strong', {}, `주간 운동 목표 달성률: ${goalPrediction.probability}%`),
              el('span', { class: 'nm-badge' }, `신뢰도 ${CONFIDENCE_LABEL[goalPrediction.confidence]}`),
            ]),
            el('div', { class: 'text-muted', style: 'font-size:12px; margin-top:4px' }, `최근 14일 기준 주당 ${goalPrediction.sessionsPerWeek}회 운동 (목표 ${weeklyGoal}회/주)`),
          ]),
          el('div', { class: 'row', style: 'gap:6px; align-items:center' }, [
            el('label', { class: 'text-muted', style: 'font-size:12px' }, '주간 목표(회)'),
            el('input', {
              class: 'nm-input',
              style: 'width:64px',
              type: 'number',
              min: '1',
              value: weeklyGoal,
              onchange: (e) => {
                weeklyGoal = Number(e.target.value) || 3;
                localStorage.setItem('workspace:health:weeklyGoal', String(weeklyGoal));
                draw();
              },
            }),
          ]),
        ]),
        weightDelta !== null
          ? el('div', { class: 'text-muted', style: 'font-size:12px; margin-top:8px' }, `체중 변화(기록 전체 기간): ${weightDelta > 0 ? '+' : ''}${weightDelta}kg`)
          : null,

        el('hr', { style: 'margin:14px 0; border:none; border-top:1px solid var(--border)' }),
        trendSection(),
      ]);
      container.append(predictCard);

      // 나이대별 건강 제안
      const tipsCard = ageTipsCard();
      if (tipsCard) container.append(tipsCard);

      // 다가오는 일정
      const upcoming = appState.healthAppointments.filter((a) => a.appointment_date >= today).sort((a, b) => a.appointment_date.localeCompare(b.appointment_date));
      selectedAppointments = new Set([...selectedAppointments].filter((id) => upcoming.some((a) => a.id === id)));
      const apptCard = el('div', { class: 'nm-card', style: 'margin: 16px 0' }, [el('h3', {}, '다가오는 병원/검진 일정')]);
      if (!upcoming.length) {
        apptCard.append(el('div', { class: 'empty-state' }, '예정된 일정이 없습니다.'));
      } else {
        const selCount = selectedAppointments.size;
        apptCard.append(
          el('div', { class: 'row row--between', style: 'margin:8px 0; align-items:center' }, [
            el('label', { class: 'row', style: 'gap:6px; align-items:center; cursor:pointer; font-size:13px' }, [
              el('input', {
                type: 'checkbox',
                checked: upcoming.length > 0 && selCount === upcoming.length ? true : undefined,
                onchange: (e) => {
                  if (e.target.checked) upcoming.forEach((a) => selectedAppointments.add(a.id));
                  else selectedAppointments.clear();
                  draw();
                },
              }),
              el('span', { class: 'text-muted' }, '전체선택'),
            ]),
            el('button', {
              class: 'nm-btn nm-btn--danger',
              disabled: selCount === 0 || undefined,
              onclick: async () => {
                if (!confirmDialog(`선택한 ${selCount}건을 삭제할까요? 연동된 일정도 함께 삭제됩니다.`)) return;
                const ids = [...selectedAppointments];
                selectedAppointments.clear();
                await appState.deleteHealthAppointments(ids);
                toast(`${ids.length}건 삭제했습니다.`, 'success');
              },
            }, `선택 삭제${selCount ? ` (${selCount})` : ''}`),
          ])
        );
        const list = el('div', { class: 'item-list' });
        for (const a of upcoming) {
          list.append(
            el('div', { class: 'item-row' }, [
              el('input', {
                type: 'checkbox',
                checked: selectedAppointments.has(a.id) || undefined,
                onchange: (e) => { if (e.target.checked) selectedAppointments.add(a.id); else selectedAppointments.delete(a.id); draw(); },
              }),
              el('div', { class: 'item-row__main' }, [
                el('div', { class: 'item-row__title' }, escapeHtml(a.title)),
                el('div', { class: 'item-row__meta' }, `${a.appointment_date}${a.appointment_time ? ' ' + a.appointment_time : ''}${a.location ? ' · ' + escapeHtml(a.location) : ''}`),
              ]),
              a.schedule_id ? el('span', { class: 'nm-badge nm-badge--info', title: '일정 메뉴에도 자동으로 반영됩니다' }, '🗓️ 일정 연동됨') : null,
              el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: () => removeAppointment(a) }, '🗑'),
            ])
          );
        }
        apptCard.append(list);
      }
      container.append(apptCard);

      // 최근 기록(종류 필터 + 페이지네이션)
      container.append(recordListCard());
    }

    // ---- 상단 미니 대시보드(4지표 항상 표시) ----
    function dashboardSection() {
      const grid = el('div', { class: 'health-dashboard-grid' });
      for (const def of DASHBOARD_METRICS) {
        const rows = appState.healthMetrics.filter((m) => m.metric_type === def.key);
        const trend = aggregateMetricTrend(rows, 'week', 8, todayISO());
        const hasAny = trend.values.some((v) => v !== null);
        const last = rows.slice().sort((a, b) => (b.recorded_at || '').localeCompare(a.recorded_at || ''))[0];
        const card = el('div', { class: 'nm-card health-dashboard-card' }, [
          el('div', { class: 'row row--between', style: 'align-items:baseline' }, [
            el('strong', { style: 'font-size:13px' }, def.label),
            el('span', { class: 'text-muted', style: 'font-size:12px' }, last ? `${last.value}${last.unit || ''}` : '-'),
          ]),
        ]);
        if (hasAny) {
          card.append(el('div', { style: 'margin-top:6px' }, [window.simpleLineChart(trend.labels, trend.values.map((v) => v ?? 0), def.hue)]));
        } else {
          card.append(el('div', { class: 'text-muted', style: 'font-size:12px; padding:14px 0; text-align:center' }, '기록 없음'));
        }
        grid.append(card);
      }
      return el('div', { class: 'nm-card', style: 'margin-bottom:16px' }, [
        el('h3', { style: 'margin-bottom:10px' }, '📊 핵심 지표 대시보드'),
        grid,
      ]);
    }

    // ---- 트렌드 차트 ----
    function trendSection() {
      const typeOptions = Object.entries(METRIC_TYPE_LABEL);
      const select = el('select', { class: 'nm-select', style: 'width:auto', onchange: (e) => { trendType = e.target.value; draw(); } });
      for (const [value, label] of typeOptions) select.append(el('option', { value }, label));
      select.value = trendType;

      const periodTabs = el('div', { class: 'row', style: 'gap:6px' }, [
        periodBtn('week', '주간'), periodBtn('month', '월간'), periodBtn('quarter', '분기'),
      ]);

      const rows = appState.healthMetrics.filter((m) => m.metric_type === trendType);
      const periodsCount = trendPeriod === 'week' ? 8 : trendPeriod === 'month' ? 6 : 4;
      const trend = aggregateMetricTrend(rows, trendPeriod, periodsCount, todayISO());
      const hasAny = trend.values.some((v) => v !== null);

      const chartHost = el('div', { style: 'margin-top:10px' });
      if (!hasAny) {
        chartHost.append(el('div', { class: 'empty-state', style: 'padding:20px' }, `${METRIC_TYPE_LABEL[trendType]} 기록이 없어 그래프를 그릴 수 없습니다.`));
      } else {
        // 막대 그래프 사용 — 기록이 없는 구간은 값 0인 선이 아니라 "빈 막대"로 보여야
        // 실제로 낮은 값을 기록한 것처럼 오해하지 않는다.
        chartHost.append(window.simpleBarChart(trend.labels, trend.values.map((v) => v ?? 0)));
      }

      return el('div', {}, [
        el('div', { class: 'row row--between wrap', style: 'gap:10px' }, [
          el('div', { class: 'row', style: 'gap:8px; align-items:center' }, [el('strong', { style: 'font-size:13px' }, '트렌드 그래프'), select]),
          periodTabs,
        ]),
        chartHost,
      ]);
    }

    function periodBtn(key, label) {
      const active = trendPeriod === key;
      return el('button', { class: `nm-btn ${active ? 'nm-btn--primary' : ''}`, style: 'padding:6px 12px; font-size:12px', onclick: () => { trendPeriod = key; draw(); } }, label);
    }

    // ---- 나이대별 건강 제안 ----
    function ageTipsCard() {
      const profile = appState.profile;
      const age = calcAge(profile?.birth_date);
      if (age == null) {
        return el('div', { class: 'nm-card', style: 'margin-bottom:16px' }, [
          el('div', { class: 'row row--between' }, [
            el('h3', {}, '나이대별 건강 제안'),
            el('button', { class: 'nm-btn', onclick: () => window.navigate('/settings') }, '내 정보 입력하기'),
          ]),
          el('p', { class: 'text-muted', style: 'font-size:12px; margin-top:6px' }, '설정 화면에서 생년월일을 입력하면 나이대에 맞는 건강검진 제안을 보여드립니다.'),
        ]);
      }
      const tips = ageHealthTips(age, profile?.gender);
      return el('div', { class: 'nm-card', style: 'margin-bottom:16px' }, [
        el('h3', {}, `나이대별 건강 제안 (만 ${age}세)`),
        el('ul', { class: 'health-tips-list' }, tips.map((t) => el('li', {}, t))),
        el('div', { class: 'text-muted', style: 'font-size:11px; margin-top:6px' }, '※ 일반적인 공공 건강검진 권장 가이드이며 의학적 진단이 아닙니다. 정확한 사항은 의료진과 상담하세요.'),
      ]);
    }

    // ---- 최근 기록(필터 + 페이지네이션) ----
    function recordListCard() {
      let rows = appState.healthMetrics;
      if (recordFilter !== 'all') rows = rows.filter((m) => m.metric_type === recordFilter);
      rows = rows.slice().sort((a, b) => (b.recorded_at || '').localeCompare(a.recorded_at || ''));

      const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
      if (recordPage > totalPages) recordPage = totalPages;
      const pageRows = rows.slice((recordPage - 1) * PAGE_SIZE, recordPage * PAGE_SIZE);

      const filterSelect = el('select', {
        class: 'nm-select', style: 'width:auto',
        onchange: (e) => { recordFilter = e.target.value; recordPage = 1; draw(); },
      });
      filterSelect.append(el('option', { value: 'all' }, '전체 종류'));
      for (const [value, label] of Object.entries(METRIC_TYPE_LABEL)) filterSelect.append(el('option', { value }, label));
      filterSelect.value = recordFilter;

      const card = el('div', { class: 'nm-card' }, [
        el('div', { class: 'row row--between wrap', style: 'gap:8px' }, [
          el('h3', {}, `최근 기록 (총 ${rows.length}건)`),
          filterSelect,
        ]),
      ]);

      if (!rows.length) {
        card.append(el('div', { class: 'empty-state' }, '아직 기록이 없습니다.'));
        return card;
      }

      const list = el('div', { class: 'item-list', style: 'margin-top:8px' });
      for (const m of pageRows) {
        list.append(
          el('div', { class: 'item-row' }, [
            el('div', { class: 'item-row__main' }, [
              el('div', { class: 'item-row__title' }, `${METRIC_TYPE_LABEL[m.metric_type] || m.metric_type}: ${m.value}${m.unit || ''}`),
              el('div', { class: 'item-row__meta' }, `${(m.recorded_at || '').slice(0, 10)}${m.note ? ' · ' + escapeHtml(m.note) : ''}`),
            ]),
            el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: () => removeMetric(m) }, '🗑'),
          ])
        );
      }
      card.append(list);

      if (totalPages > 1) {
        card.append(
          el('div', { class: 'row health-pagenav', style: 'justify-content:center; gap:4px; margin-top:12px' }, [
            el('button', { class: 'nm-btn nm-btn--icon', disabled: recordPage === 1 ? true : undefined, onclick: () => { recordPage = 1; draw(); } }, '«'),
            el('button', { class: 'nm-btn nm-btn--icon', disabled: recordPage === 1 ? true : undefined, onclick: () => { recordPage -= 1; draw(); } }, '‹'),
            el('span', { class: 'text-muted', style: 'font-size:13px; padding:0 8px; align-self:center' }, `${recordPage} / ${totalPages}`),
            el('button', { class: 'nm-btn nm-btn--icon', disabled: recordPage === totalPages ? true : undefined, onclick: () => { recordPage += 1; draw(); } }, '›'),
            el('button', { class: 'nm-btn nm-btn--icon', disabled: recordPage === totalPages ? true : undefined, onclick: () => { recordPage = totalPages; draw(); } }, '»'),
          ])
        );
      }
      return card;
    }

    async function removeMetric(m) {
      if (!confirmDialog('이 기록을 삭제할까요?')) return;
      await appState.deleteHealthMetric(m.id);
      toast('삭제했습니다.', 'success');
    }
    async function removeAppointment(a) {
      if (!confirmDialog(`"${a.title}" 일정을 삭제할까요? 연동된 일정도 함께 삭제됩니다.`)) return;
      await appState.deleteHealthAppointment(a.id);
      toast('삭제했습니다.', 'success');
    }

    // 운동 기록 저장 시, 오늘 이미 체크인하지 않은 "운동" 카테고리 챌린지가 있으면 체크인을 제안한다.
    async function suggestChallengeCheckin() {
      const todayIso = todayISO();
      const candidates = appState.challenges.filter((c) => {
        if (c.status !== 'active' || c.category !== '운동') return false;
        const checkins = appState.checkinsByChallenge[c.id] || [];
        return !checkins.some((r) => r.checkin_date === todayIso);
      });
      if (!candidates.length) return;
      for (const c of candidates) {
        if (confirmDialog(`오늘 운동 기록을 남기셨네요! "${c.title}" 챌린지도 오늘 체크인할까요?`)) {
          await appState.checkinChallenge(c.id, todayIso, 1);
          toast(`"${c.title}" 체크인 완료!`, 'success');
        }
      }
    }

    function openMetricForm() {
      openModal({
        title: '기록 추가',
        contentBuilder(body, close) {
          const typeSelect = el('select', { class: 'nm-select', name: 'metric_type' });
          for (const [value, label] of FORM_TYPES) typeSelect.append(el('option', { value }, label));

          const form = el('form', { class: 'stack' });

          // 혈압(수축기/이완기)과 일반 단일 값 입력을 전환한다.
          const valueInput = el('input', { class: 'nm-input', type: 'number', step: '0.1', name: 'value', required: true });
          const singleValueField = field('값', valueInput);
          const unitInput = el('input', { class: 'nm-input', name: 'unit', value: METRIC_UNIT_DEFAULT.weight });
          const unitField = field('단위', unitInput);

          const bpSysInput = el('input', { class: 'nm-input', type: 'number', name: 'bp_systolic', placeholder: '예: 120' });
          const bpDiaInput = el('input', { class: 'nm-input', type: 'number', name: 'bp_diastolic', placeholder: '예: 80' });
          const bpField = el('div', { class: 'row', style: 'gap:10px; display:none' }, [
            field('수축기(mmHg)', bpSysInput),
            field('이완기(mmHg)', bpDiaInput),
          ]);

          function syncFieldsForType() {
            const isBp = typeSelect.value === 'blood_pressure';
            bpField.style.display = isBp ? 'flex' : 'none';
            singleValueField.style.display = isBp ? 'none' : '';
            unitField.style.display = isBp ? 'none' : '';
            // 숨겨진 필드에 required가 남아있으면 폼 제출(checkValidity)이 막히므로 함께 토글한다.
            valueInput.required = !isBp;
            if (!isBp) unitInput.value = METRIC_UNIT_DEFAULT[typeSelect.value] || '';
          }
          typeSelect.addEventListener('change', syncFieldsForType);

          form.append(
            field('종류', typeSelect),
            bpField,
            singleValueField,
            unitField,
            field('날짜', el('input', { class: 'nm-input', type: 'date', name: 'date', value: todayISO() })),
            field('메모(선택)', el('input', { class: 'nm-input', name: 'note' }))
          );
          syncFieldsForType();
          form.append(el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장'));
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const metricType = fd.get('metric_type');
            const metricDate = fd.get('date') || todayISO();
            const recordedAt = new Date(`${metricDate}T${new Date().toTimeString().slice(0, 8)}`).toISOString();
            const note = fd.get('note') || null;

            if (metricType === 'blood_pressure') {
              const sys = Number(bpSysInput.value);
              const dia = Number(bpDiaInput.value);
              if (!sys || !dia) {
                toast('수축기/이완기 혈압을 모두 입력해주세요.', 'error');
                return;
              }
              await appState.addHealthMetrics([
                { metric_type: 'bp_systolic', value: sys, unit: 'mmHg', note, recorded_at: recordedAt },
                { metric_type: 'bp_diastolic', value: dia, unit: 'mmHg', note, recorded_at: recordedAt },
              ]);
            } else {
              await appState.addHealthMetric({
                metric_type: metricType,
                value: Number(fd.get('value')),
                unit: fd.get('unit') || null,
                note,
                recorded_at: recordedAt,
              });
            }
            toast('기록을 저장했습니다.', 'success');
            close();
            if (metricType === 'exercise' && metricDate === todayISO()) {
              await suggestChallengeCheckin();
            }
          });
          body.append(form);
        },
      });
    }

    function openAppointmentForm() {
      openModal({
        title: '병원/검진 일정 등록',
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          form.append(
            field('제목', el('input', { class: 'nm-input', name: 'title', required: true, placeholder: '예: 정기 검진', value: '' })),
            field('날짜', el('input', { class: 'nm-input', type: 'date', name: 'appointment_date', required: true, value: todayISO() })),
            field('시간(선택)', el('input', { class: 'nm-input', type: 'time', name: 'appointment_time' })),
            field('장소(선택)', el('input', { class: 'nm-input', name: 'location' })),
            field('메모(선택)', el('textarea', { class: 'nm-textarea', name: 'memo' }))
          );
          form.append(el('p', { class: 'text-muted', style: 'font-size:12px' }, '저장하면 "일정" 메뉴에도 자동으로 함께 등록됩니다.'));
          form.append(el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장'));
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            await appState.addHealthAppointment({
              title: fd.get('title'),
              appointment_date: fd.get('appointment_date'),
              appointment_time: fd.get('appointment_time') || null,
              location: fd.get('location') || null,
              memo: fd.get('memo') || null,
            });
            toast('일정을 저장했습니다. (일정 메뉴에도 추가됨)', 'success');
            close();
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

  window.renderHealth = renderHealth;
})();
