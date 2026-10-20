// Health 화면. 체중·운동·수면 등 일반 웰니스 기록, 병원/검진 일정, 내복약 복용 체크(복약 관리)를 한 곳에서 다룬다.
// 복약 기능(v7.19.0)은 "내가 세운 복용 계획을 지키고 있는지"를 확인하는 개인 기록 도구일 뿐이며
// 의학적 조언·진단이 아니다(화면에도 같은 안내를 표시한다). 판정 기준(혈압/혈당/콜레스테롤)과 복용률 계산은
// 모두 js/predict.js의 순수 함수를 쓴다.
// 일반 <script>로 로드된다.
(function () {
  const {
    appState, el, toast, confirmDialog, openModal, todayISO, addDays, aggregateMetricTrend,
    bpStatus, cholesterolStatus, glucoseStatus, BP_RANGES, localDateOf, describeTargetGap,
    parseDoseTimes, doseSlots, parseWeekdays, isScheduledOn, adherenceRate, missedDoses, medDayStatus, currentStreak,
    daysOfSupplyLeft, buildDailyHealthRows, dailyHealthStatus, summarizeDailyRows, adherenceBpHint,
  } = window;

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

  // ---- 대시보드 카드별 목표값(settingsSync로 기기 간 동기화) ----
  const TARGETS_KEY = 'workspace:health:targets';
  function loadTargets() {
    try {
      const o = JSON.parse(window.settingsSync.get(TARGETS_KEY) || '{}');
      return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    } catch { return {}; }
  }
  function saveTarget(key, value) {
    const t = loadTargets();
    if (value == null) delete t[key]; else t[key] = value;
    window.settingsSync.set(TARGETS_KEY, JSON.stringify(t));
  }

  const MED_REMINDER_KEY = 'workspace:health:medReminder';
  const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
  const APPT_TYPES = ['진료', '검진', '검사', '치과', '예방접종', '약 처방', '기타'];
  const CONDITION_EMOJI = { 1: '😣', 2: '😕', 3: '😐', 4: '🙂', 5: '😄' };

  function nowHHMM() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // 0023 미실행(테이블 없음) 같은 흔한 원인을 사용자가 알아보게 풀어 쓴다.
  function errText(e, what) {
    const msg = String(e?.message || e || '');
    if (/health_medications|health_med_logs|schema cache|does not exist|relation/i.test(msg)) {
      return `${what} 실패: 복약 테이블이 없습니다. Supabase SQL Editor에서 supabase/combined/all_migrations_0001_to_0026.sql을 실행해 주세요.`;
    }
    return `${what} 실패: ${msg || '알 수 없는 오류'} (방금 반영한 내용을 취소했습니다)`;
  }

  // 화면을 통째로 다시 그려도 스크롤이 맨 위로 튀지 않게, 스크롤되는 부모를 찾아 위치를 복원한다.
  function scrollParentOf(node) {
    for (let p = node.parentElement; p; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
    }
    return document.scrollingElement || document.documentElement;
  }

  function field(label, node, required) {
    return el('div', { class: 'nm-field' }, [el('label', {}, [required ? el('span', { class: 'req', 'aria-hidden': 'true' }, '*') : null, label]), node]);
  }

  // 정렬 가능한 표 헤더(공통 list UI) — state = { key, dir }
  function sortTh(state, key, label, onChange) {
    const active = state.key === key;
    return el('th', {
      class: active ? 'is-sorted' : '',
      onclick: () => { if (state.key === key) state.dir = state.dir === 'asc' ? 'desc' : 'asc'; else { state.key = key; state.dir = 'asc'; } onChange(); },
    }, [label, active ? el('span', { class: 'sort-arrow' }, state.dir === 'asc' ? '▲' : '▼') : null]);
  }
  function sortRows(rows, state, getters) {
    const get = getters[state.key] || (() => '');
    return rows.slice().sort((a, b) => {
      const x = get(a), y = get(b);
      const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return state.dir === 'asc' ? cmp : -cmp;
    });
  }

  function renderHealth(root) {
    const container = el('div', {});
    root.append(container);
    let weeklyGoal = Number(window.settingsSync.get('workspace:health:weeklyGoal')) || 3;
    let showGuide = false;
    let trendType = 'weight';
    let trendRange = 'week';
    let recordFilter = 'all';
    let recordPage = 1;
    const PAGE_SIZE = 10;

    // 병원/검진 일정 목록 상태
    let selectedAppointments = new Set();
    let apptTab = 'upcoming'; // upcoming | past | all
    let apptQuery = '';
    const apptSort = { key: 'date', dir: 'asc' };
    let apptTableHost = null;

    // 복약 목록 상태
    let selectedMeds = new Set();
    let medQuery = '';
    const medSort = { key: 'name', dir: 'asc' };
    let medTableHost = null;

    // 일별 건강 모니터링
    let dailyDays = 14;
    let moodNote = '';

    // 상단에 항상 보이는 4개 지표(체중/걸음수/수축기·이완기 혈압) 차트 정의.
    // band: 정상 범위 음영 — 혈압 구간은 predict.js의 BP_RANGES(bpStatus 임계값과 동일)를 그대로 쓴다.
    const DASHBOARD_METRICS = [
      { key: 'weight', label: '체중', hue: '#3b82f6', unit: 'kg', targetPlaceholder: '예: 75' },
      { key: 'steps', label: '걸음수', hue: '#16a34a', unit: '걸음', targetPlaceholder: '예: 8000' },
      { key: 'bp_systolic', label: '수축기 혈압', hue: '#dc2626', unit: 'mmHg', targetPlaceholder: '선택', ranges: BP_RANGES.bp_systolic },
      { key: 'bp_diastolic', label: '이완기 혈압', hue: '#d97706', unit: 'mmHg', targetPlaceholder: '선택', ranges: BP_RANGES.bp_diastolic },
    ];
    // 6.1 퀵레인지 버튼 정의 — 각 버튼을 누르면 aggregateMetricTrend(period, periods)로 집계한다.
    // "최근 3년"은 주간으로 집계하면 156구간이나 돼 알아보기 어려우므로 분기(quarter) 단위로 묶는다.
    const DASHBOARD_RANGES = [
      { key: 'raw10', label: '최근 10개' },
      { key: 'week', label: '주간', period: 'week', periods: 8 },
      { key: 'month', label: '월간', period: 'month', periods: 6 },
      { key: 'half', label: '반기', period: 'month', periods: 6 }, // 최근 6개월(월별)
      { key: 'quarter', label: '분기', period: 'quarter', periods: 4 },
      { key: 'year', label: '연간', period: 'quarter', periods: 4 }, // 최근 1년(분기별)
      { key: 'year3', label: '최근3년', period: 'quarter', periods: 12 }, // 최근 3년(분기별)
    ];
    // 카드별로 독립된 퀵레인지 상태를 갖는다(하나를 바꿔도 다른 카드에 영향 없음). 기본값은 "최근 10개"(원자료).
    const dashboardRangeByMetric = { weight: 'raw10', steps: 'raw10', bp_systolic: 'raw10', bp_diastolic: 'raw10' };

    // 6.2: "핵심지표대시보드" 카드들과 아래 "예측·트렌드" 섹션이 동일한 퀵레인지 버튼 UI를 쓰도록 공통 헬퍼로 둔다.
    // rangeKey가 'raw10'이면 집계 없이 최근 10개 원자료를, 그 외에는 DASHBOARD_RANGES에 정의된
    // period/periods로 aggregateMetricTrend를 사용해 집계한 값을 돌려준다.
    // values는 막대 차트용(기록 없는 구간=0), rawValues는 꺾은선용(기록 없는 구간=null → 선이 끊김).
    function computeQuickRangeSeries(rows, rangeKey) {
      const sorted = rows.slice().sort((a, b) => (a.recorded_at || '').localeCompare(b.recorded_at || ''));
      if (rangeKey === 'raw10') {
        const recent = sorted.slice(-10);
        const values = recent.map((r) => r.value);
        return { labels: recent.map((r) => localDateOf(r.recorded_at).slice(5)), values, rawValues: values, hasAny: recent.length > 0 };
      }
      const rangeDef = DASHBOARD_RANGES.find((r) => r.key === rangeKey) || DASHBOARD_RANGES[1];
      const trend = aggregateMetricTrend(rows, rangeDef.period, rangeDef.periods, todayISO());
      return { labels: trend.labels, values: trend.values.map((v) => v ?? 0), rawValues: trend.values, hasAny: trend.values.some((v) => v !== null) };
    }

    // 퀵레인지 버튼 한 줄(현재 선택된 range를 강조 표시)을 만드는 공통 함수.
    function quickRangeButtons(currentRange, onSelect) {
      return el('div', { class: 'row wrap', style: 'gap:4px' },
        DASHBOARD_RANGES.map((r) => el('button', {
          class: `nm-btn ${currentRange === r.key ? 'nm-btn--primary' : ''}`,
          style: 'padding:3px 8px; font-size:11px',
          onclick: () => onSelect(r.key),
        }, r.label))
      );
    }

    function latestByType() {
      const result = {};
      for (const key of Object.keys(METRIC_TYPE_LABEL)) {
        const rows = appState.healthMetrics.filter((m) => m.metric_type === key).sort((a, b) => (b.recorded_at || '').localeCompare(a.recorded_at || ''));
        result[key] = rows[0] ? rows[0].value : null;
      }
      return result;
    }

    function activeMeds() {
      return appState.healthMedications.filter((m) => m.active !== false && !m.deleted_at);
    }

    function draw() {
      const scroller = scrollParentOf(container);
      const scrollTop = scroller ? scroller.scrollTop : 0;
      container.innerHTML = '';
      container.append(
        el('div', { class: 'page-header', style: 'flex-wrap:wrap; gap:10px' }, [
          el('h1', {}, 'Health'),
          el('div', { class: 'row wrap', style: 'gap:8px' }, [
            el('button', { class: 'nm-btn', onclick: () => openAppointmentForm() }, '+ 일정 등록'),
            el('button', { class: 'nm-btn', onclick: () => openMedicationForm() }, '+ 약 등록'),
            el('button', { class: 'nm-btn nm-btn--primary', onclick: () => openMetricForm() }, '+ 기록 추가'),
          ]),
        ])
      );

      // 4대 지표 항상 보이는 미니 대시보드(체중/걸음수/혈압 2종) — 목표선·정상범위 음영 포함.
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

      // 💊 복약 관리 카드
      container.append(medicationCard());

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
              el('div', { style: 'margin-top:4px' }, '· 트렌드: 아래에서 지표와 기간(주간/월간/반기/분기/연간/최근3년)을 고르면, 그 기간 동안의 평균값 변화를 그래프로 보여줍니다. 막대가 비어 있으면 그 기간에 기록이 없었다는 뜻입니다.'),
              el('div', { style: 'margin-top:4px' }, '· 일별 건강 모니터링: 최근 14/30일의 체중·걸음수·혈압·혈당·컨디션과 복약 여부를 하루 한 줄로 묶어 보여주고, 하루 종합 상태(좋음/주의/확인필요)를 표시합니다. 진단이 아니라 "다시 살펴볼 날"을 찾는 용도입니다.'),
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
                window.settingsSync.set('workspace:health:weeklyGoal', String(weeklyGoal));
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

        el('hr', { style: 'margin:14px 0; border:none; border-top:1px solid var(--border)' }),
        dailyMonitoringSection(),
      ]);
      container.append(predictCard);

      // 나이대별 건강 제안
      const tipsCard = ageTipsCard();
      if (tipsCard) container.append(tipsCard);

      // 병원/검진 일정(검색·정렬·첨부·지난 일정 전환)
      container.append(appointmentsCard());

      // 최근 기록(종류 필터 + 페이지네이션)
      container.append(recordListCard());

      if (scroller) scroller.scrollTop = scrollTop;
    }

    // ---- 상단 미니 대시보드(4지표 항상 표시) ----
    // 6.1: 기본값은 "최근 등록된 10개 값"을 원자료 그대로 보여주고(집계/평균 없이), 카드별로
    // 독립된 퀵레인지 버튼(주간/월간/반기/분기/연간/최근3년)을 눌러 그 기간의 집계 그래프로
    // 바꿔볼 수 있다. 버튼을 다시 "최근 10개"로 누르면 원자료로 돌아간다.
    // v7.19.0: 꺾은선 + 목표선(수평 점선) + 혈압 정상 범위 음영(targetLineChart), 카드별 목표값 입력.
    function dashboardSection() {
      const grid = el('div', { class: 'health-dashboard-grid' });
      const targets = loadTargets();
      for (const def of DASHBOARD_METRICS) {
        const rows = appState.healthMetrics.filter((m) => m.metric_type === def.key);
        const sorted = rows.slice().sort((a, b) => (a.recorded_at || '').localeCompare(b.recorded_at || ''));
        const last = sorted[sorted.length - 1];
        const currentRange = dashboardRangeByMetric[def.key] || 'raw10';
        const { labels, rawValues, hasAny } = computeQuickRangeSeries(rows, currentRange);
        const target = typeof targets[def.key] === 'number' ? targets[def.key] : null;
        const bands = def.ranges
          ? [
              { ...def.ranges.normal, label: `정상 ${def.ranges.normal.min}–${def.ranges.normal.max}`, tone: 'normal' },
              { ...def.ranges.caution, label: `주의 ${def.ranges.caution.min}–${def.ranges.caution.max}`, tone: 'caution' },
            ]
          : [];

        const card = el('div', { class: 'nm-card health-dashboard-card', dataset: { metric: def.key } }, [
          el('div', { class: 'row row--between', style: 'align-items:baseline' }, [
            el('strong', { style: 'font-size:13px' }, def.label),
            el('span', { class: 'text-muted', style: 'font-size:12px' }, last ? `${last.value}${last.unit || def.unit}` : '-'),
          ]),
          el('div', { class: 'health-dashboard-card__ranges', style: 'margin-top:6px' },
            [quickRangeButtons(currentRange, (key) => { dashboardRangeByMetric[def.key] = key; draw(); })]
          ),
        ]);
        if (hasAny) {
          // v7.21.0: 공통 차트 킷(호버 크로스헤어/툴팁, 표 보기, PNG/CSV, 전체 화면)을 입힌다.
          const chartBox = el('div', { style: 'margin-top:6px' });
          const svg = window.targetLineChart(labels, rawValues, { target, bands, unit: def.unit === '걸음' ? '' : def.unit, hue: def.hue, title: def.label });
          if (svg && svg.__ck) { svg.__ck.unit = def.unit === '걸음' ? '걸음' : def.unit; svg.__ck.series[0].name = def.label; window.ChartKit.decorate(chartBox, svg, { title: `Health · ${def.label}`, fileBase: `health-${def.key}` }); }
          else chartBox.append(svg);
          card.append(chartBox);
        } else {
          card.append(el('div', { class: 'text-muted', style: 'font-size:12px; padding:14px 0; text-align:center' }, '기록 없음'));
        }

        // 목표값 인라인 편집기 + "목표 대비" 문구
        const gap = last ? describeTargetGap(last.value, target, def.unit === '걸음' ? '걸음' : def.unit, def.ranges ? def.ranges.normal : null) : { text: '' };
        const targetInput = el('input', {
          class: 'nm-input health-target-input', type: 'number', step: 'any', min: '0', placeholder: def.targetPlaceholder,
          value: target != null ? String(target) : '', 'aria-label': `${def.label} 목표값`,
          onchange: (e) => {
            const raw = e.target.value.trim();
            const num = Number(raw);
            if (raw === '') { saveTarget(def.key, null); toast(`${def.label} 목표를 지웠습니다.`, 'success'); }
            else if (!Number.isFinite(num) || num <= 0) { toast('목표는 0보다 큰 숫자로 입력해 주세요.', 'error'); }
            else { saveTarget(def.key, num); toast(`${def.label} 목표를 ${num}${def.unit}로 저장했습니다.`, 'success'); }
            draw();
          },
        });
        card.append(el('div', { class: 'health-target-row' }, [
          el('label', { class: 'text-muted' }, '목표'),
          targetInput,
          el('span', { class: 'text-muted' }, def.unit),
          target != null ? el('button', { class: 'nm-btn nm-btn--icon', title: '목표 지우기', 'aria-label': '목표 지우기', onclick: () => { saveTarget(def.key, null); draw(); } }, '×') : null,
        ]));
        if (gap.text) card.append(el('div', { class: 'health-target-gap', dataset: { role: 'target-gap' } }, gap.text));
        grid.append(card);
      }
      return el('div', { class: 'nm-card', style: 'margin-bottom:16px' }, [
        el('h3', { style: 'margin-bottom:10px' }, '📊 핵심 지표 대시보드'),
        grid,
        el('div', { class: 'text-muted', style: 'font-size:11px; margin-top:8px' }, '꺾은선은 최근 기록, 점선은 내가 정한 목표입니다. 혈압의 초록/주황 음영은 정상·주의 참고 범위(일반 기준)이며 의학적 진단이 아닙니다.'),
      ]);
    }

    // ---- 트렌드 차트 ----
    // 6.2: 위 "핵심지표대시보드" 카드들과 같은 퀵레인지 버튼(주간/월간/반기/분기/연간/최근3년, 독립 상태 trendRange)으로 통일.
    function trendSection() {
      const typeOptions = Object.entries(METRIC_TYPE_LABEL);
      const select = el('select', { class: 'nm-select', style: 'width:auto', onchange: (e) => { trendType = e.target.value; draw(); } });
      for (const [value, label] of typeOptions) select.append(el('option', { value }, label));
      select.value = trendType;

      const rows = appState.healthMetrics.filter((m) => m.metric_type === trendType);
      const { labels, values, hasAny } = computeQuickRangeSeries(rows, trendRange);

      const chartHost = el('div', { style: 'margin-top:10px' });
      if (!hasAny) {
        chartHost.append(el('div', { class: 'empty-state', style: 'padding:20px' }, `${METRIC_TYPE_LABEL[trendType]} 기록이 없어 그래프를 그릴 수 없습니다.`));
      } else {
        // 막대 그래프 사용 — 기록이 없는 구간은 값 0인 선이 아니라 "빈 막대"로 보여야
        // 실제로 낮은 값을 기록한 것처럼 오해하지 않는다.
        {
          const svg = window.simpleBarChart(labels, values);
          if (svg && svg.__ck) { svg.__ck.series[0].name = METRIC_TYPE_LABEL[trendType]; window.ChartKit.decorate(chartHost, svg, { title: `Health · ${METRIC_TYPE_LABEL[trendType]} 트렌드`, fileBase: `health-trend-${trendType}` }); }
          else chartHost.append(svg);
        }
      }

      return el('div', {}, [
        el('div', { class: 'row row--between wrap', style: 'gap:10px' }, [
          el('div', { class: 'row', style: 'gap:8px; align-items:center' }, [el('strong', { style: 'font-size:13px' }, '트렌드 그래프'), select]),
          quickRangeButtons(trendRange, (key) => { trendRange = key; draw(); }),
        ]),
        chartHost,
      ]);
    }

    // ---- 📅 일별 건강 모니터링 (예측·트렌드 안) ----
    function dailyMonitoringSection() {
      const today = todayISO();
      const rows = buildDailyHealthRows(appState.healthMetrics, appState.healthMedications, appState.healthMedLogs, addDays(today, -(dailyDays - 1)), today, today, nowHHMM());
      const last7 = rows.slice(-7);
      const s7 = summarizeDailyRows(last7);
      const sN = summarizeDailyRows(rows);

      const parts = [];
      if (s7.adherence.rate != null) parts.push(`복약 달성 ${s7.adherence.rate}%(${s7.adherence.taken}/${s7.adherence.expected}회)`);
      if (s7.bp.days) parts.push(`혈압 정상 ${s7.bp.normalDays}/${s7.bp.days}일(기록한 날 기준)`);
      if (s7.weightDelta != null) parts.push(`체중 ${s7.weightDelta > 0 ? '+' : ''}${s7.weightDelta}kg`);
      if (s7.goodDays || s7.checkDays) parts.push(`종합 '좋음' ${s7.goodDays}일, '확인필요' ${s7.checkDays}일`);
      const summaryText = parts.length ? `최근 7일 ${parts.join(', ')}.` : '최근 7일 동안 기록이 없습니다. 아래 "오늘 컨디션"이나 "+ 기록 추가"로 시작해 보세요.';
      const periodText = dailyDays > 7 && sN.adherence.rate != null ? `최근 ${dailyDays}일 복약 달성 ${sN.adherence.rate}%(${sN.adherence.taken}/${sN.adherence.expected}회).` : '';

      // 오늘 컨디션 빠른 기록(+ 증상/메모 한 줄) — 기존 'condition'(1~5) 지표로 저장된다.
      const noteInput = el('input', {
        class: 'nm-input', style: 'flex:1; min-width:140px; max-width:260px', placeholder: '증상/메모(선택) 예: 두통, 숙면',
        value: moodNote, oninput: (e) => { moodNote = e.target.value; },
      });
      const moodRow = el('div', { class: 'row wrap health-mood-row' }, [
        el('span', { class: 'text-muted', style: 'font-size:12px' }, '오늘 컨디션'),
        ...[1, 2, 3, 4, 5].map((n) => el('button', {
          class: 'nm-btn health-mood-btn', title: `컨디션 ${n}/5`, 'aria-label': `컨디션 ${n}점`, dataset: { mood: String(n) },
          onclick: () => {
            const p = appState.addHealthMetric({ metric_type: 'condition', value: n, unit: '점(1-5)', note: moodNote.trim() || null, recorded_at: new Date().toISOString() });
            moodNote = '';
            p.then(() => toast(`오늘 컨디션 ${n}/5를 기록했습니다.`, 'success')).catch((e) => toast(errText(e, '컨디션 기록'), 'error'));
          },
        }, CONDITION_EMOJI[n])),
        noteInput,
      ]);

      const rangeBtns = el('div', { class: 'row', style: 'gap:4px' }, [14, 30].map((d) => el('button', {
        class: `nm-btn ${dailyDays === d ? 'nm-btn--primary' : ''}`, style: 'padding:3px 10px; font-size:11px',
        onclick: () => { dailyDays = d; draw(); },
      }, `${d}일`)));

      const table = el('table', { class: 'data-table health-daily-table' });
      table.append(el('thead', {}, [el('tr', {}, ['날짜', '체중', '걸음수', '혈압', '혈당', '컨디션', '복약', '종합'].map((h) => el('th', { style: 'cursor:default' }, h)))]));
      const tbody = el('tbody', {});
      for (const r of rows.slice().reverse()) {
        const st = dailyHealthStatus(r);
        const bp = r.systolic != null && r.diastolic != null ? bpStatus(r.systolic, r.diastolic) : null;
        const glu = glucoseStatus(r.blood_glucose);
        tbody.append(el('tr', { class: r.date === today ? 'is-today' : '', dataset: { date: r.date, level: st.level } }, [
          el('td', {}, [`${r.date.slice(5)} (${window.weekdayLabel(r.date)})`, r.date === today ? el('span', { class: 'nm-badge', style: 'margin-left:4px' }, '오늘') : null]),
          el('td', {}, r.weight != null ? `${r.weight}kg` : '–'),
          el('td', {}, r.steps != null ? Number(r.steps).toLocaleString() : '–'),
          el('td', {}, r.systolic != null && r.diastolic != null ? [`${r.systolic}/${r.diastolic} `, statusBadge(bp)] : (r.systolic != null || r.diastolic != null ? `${r.systolic ?? '?'}/${r.diastolic ?? '?'}` : '–')),
          el('td', {}, r.blood_glucose != null ? [`${r.blood_glucose} `, statusBadge(glu)] : '–'),
          el('td', { title: r.conditionNote || '' }, r.condition != null ? [`${CONDITION_EMOJI[Math.round(r.condition)] || ''} ${r.condition}`, r.conditionNote ? el('div', { class: 'text-muted', style: 'font-size:11px' }, r.conditionNote) : null] : '–'),
          el('td', {}, adherenceCell(r.adherence)),
          el('td', {}, dailyChip(st)),
        ]));
      }
      table.append(tbody);

      const hint = adherenceBpHint(rows);
      return el('div', { class: 'health-daily', dataset: { role: 'daily-monitor' } }, [
        el('div', { class: 'row row--between wrap', style: 'gap:10px; align-items:center' }, [
          el('strong', { style: 'font-size:14px' }, '📅 일별 건강 모니터링'),
          rangeBtns,
        ]),
        el('div', { class: 'health-daily__summary', dataset: { role: 'daily-summary' } }, [summaryText, periodText ? ` ${periodText}` : '']),
        moodRow,
        el('div', { class: 'data-table-wrap health-daily__wrap' }, [table]),
        hint
          ? el('div', { class: 'health-daily__hint', dataset: { role: 'daily-hint' } }, [
              `참고: 복약을 모두 한 날(${hint.adherentDays}일)의 평균 수축기 혈압은 ${hint.adherentAvg}mmHg, 일부 또는 전부 거른 날(${hint.otherDays}일)은 ${hint.otherAvg}mmHg였습니다(차이 ${hint.diff > 0 ? '+' : ''}${hint.diff}). `,
              '같은 날끼리 비교한 것이고 표본이 작아 우연일 수 있으며 다른 요인(수면·식사·스트레스)이 섞여 있습니다.',
            ])
          : null,
        el('div', { class: 'text-muted', style: 'font-size:11px; margin-top:6px' }, '※ 참고용 정보이며 의학적 판단이 아닙니다. 복약·혈압 관련 결정은 반드시 의료진과 상담하세요. 기록이 없는 날은 "정상"이 아니라 "알 수 없음"입니다.'),
      ]);
    }

    function adherenceCell(a) {
      if (!a) return '–';
      if (a.state === 'taken') return el('span', { class: 'med-state med-state--ok' }, `✅ 전부 (${a.taken}/${a.expected || a.taken})`);
      if (a.state === 'partial') return el('span', { class: 'med-state med-state--warn' }, `⚠️ 일부 (${a.taken}/${a.expected})`);
      if (a.state === 'missed') return el('span', { class: 'med-state med-state--bad' }, `❌ 놓침 (0/${a.expected})`);
      return el('span', { class: 'text-muted' }, '⏳ 예정');
    }
    function dailyChip(st) {
      if (st.level === 'none') return el('span', { class: 'text-muted' }, '–');
      const cls = st.level === 'good' ? 'nm-badge--success' : st.level === 'caution' ? 'nm-badge--warning' : 'nm-badge--critical';
      const icon = st.level === 'good' ? '🙂' : st.level === 'caution' ? '⚠️' : '❗';
      return el('span', { class: `nm-badge ${cls}`, title: st.reasons.join(', ') || '특이사항 없음' }, `${icon} ${st.label}`);
    }

    // ---- 💊 복약 관리 ----
    function scheduleText(m) {
      const times = parseDoseTimes(m.dose_times);
      const t = times.length ? times.join(', ') : '시각 미지정';
      if (m.schedule_type === 'every_n_days') return `${Math.max(1, Number(m.interval_days) || 1)}일마다 · ${t}`;
      if (m.schedule_type === 'weekdays') return `${parseWeekdays(m.weekdays).map((d) => WEEKDAY_KO[d]).join('') || '요일 미지정'} · ${t}`;
      return `매일 ${doseSlots(m).length}회 · ${t}`;
    }

    function medicationCard() {
      const today = todayISO();
      const now = nowHHMM();
      const all = appState.healthMedications;
      const meds = activeMeds();
      const logs = appState.healthMedLogs;

      const card = el('div', { class: 'nm-card health-meds', style: 'margin-bottom:16px', dataset: { role: 'med-card' } }, [
        el('div', { class: 'row row--between wrap', style: 'gap:8px' }, [
          el('h3', {}, '💊 복약 관리'),
          el('div', { class: 'row', style: 'gap:6px' }, [
            reminderToggle(),
            el('button', { class: 'nm-btn nm-btn--primary', onclick: () => openMedicationForm() }, '+ 약 등록'),
          ]),
        ]),
        el('div', { class: 'health-med-disclaimer' }, '※ 이 카드는 내가 입력한 복용 계획을 잘 지키고 있는지 확인하는 개인 기록 도구입니다. 의학적 조언·진단이 아니며, 약의 종류·용량·복용 방법은 반드시 의사·약사와 상의하세요. 약 이름 등 민감할 수 있는 정보는 내 계정에만 저장됩니다.'),
      ]);

      if (!all.length) {
        card.append(el('div', { class: 'empty-state', style: 'padding:24px 12px' }, '등록된 약이 없습니다. "+ 약 등록"으로 복용 중인 약과 복용 주기를 입력하면 오늘 체크리스트와 복용률이 표시됩니다.'));
        return card;
      }

      // 재처방(남은 수량) 경고
      const lowSupply = meds
        .map((m) => ({ m, days: daysOfSupplyLeft(m, today) }))
        .filter((x) => x.days != null && x.days <= 7)
        .sort((a, b) => a.days - b.days);
      if (lowSupply.length) {
        card.append(el('div', { class: 'health-med-refill', dataset: { role: 'refill-warning' } },
          `🔔 재처방/구입 확인: ${lowSupply.map((x) => `${x.m.name} ${x.days === 0 ? '소진' : `약 ${x.days}일 남음`}`).join(', ')}`));
      }

      // 1) 오늘 복용 체크리스트
      const items = [];
      for (const med of meds) {
        if (!isScheduledOn(med, today)) continue;
        for (const slot of doseSlots(med)) {
          const log = logs.find((l) => l.medication_id === med.id && l.taken_date === today && (l.slot || '') === slot);
          items.push({ med, slot, log });
        }
      }
      items.sort((a, b) => a.slot.localeCompare(b.slot) || String(a.med.name).localeCompare(String(b.med.name)));
      const doneCount = items.filter((i) => i.log?.status === 'taken').length;
      const checklist = el('div', { class: 'med-checklist', dataset: { role: 'med-checklist' } });
      if (!items.length) checklist.append(el('div', { class: 'text-muted', style: 'font-size:13px' }, '오늘 복용할 약이 없습니다.'));
      for (const it of items) {
        const taken = it.log?.status === 'taken';
        const skipped = it.log?.status === 'skipped';
        const late = !taken && !skipped && it.slot && it.slot <= now;
        checklist.append(el('button', {
          class: `med-dose ${taken ? 'med-dose--taken' : ''} ${late ? 'med-dose--late' : ''} ${skipped ? 'med-dose--skipped' : ''}`,
          dataset: { med: it.med.id, slot: it.slot },
          'aria-pressed': taken ? 'true' : 'false',
          title: taken ? '다시 누르면 체크가 해제됩니다' : '누르면 복용 체크',
          onclick: () => toggleDose(it.med.id, today, it.slot),
        }, [
          el('span', { class: 'med-dose__check' }, taken ? '✓' : skipped ? '–' : ''),
          el('span', { class: 'med-dose__body' }, [
            el('span', { class: 'med-dose__time' }, it.slot || '시간 무관'),
            el('span', { class: 'med-dose__name' }, `${it.med.name}${it.med.dosage ? ' · ' + it.med.dosage : ''}`),
          ]),
          late ? el('span', { class: 'med-dose__late' }, '시간 지남') : null,
        ]));
      }
      card.append(
        el('div', { class: 'row row--between', style: 'margin-top:14px; align-items:baseline' }, [
          el('strong', { style: 'font-size:14px' }, '오늘 복용 체크리스트'),
          el('span', { class: 'text-muted', dataset: { role: 'med-today-count' } }, items.length ? `${doneCount}/${items.length} 완료` : ''),
        ]),
        checklist
      );

      // 2) 복용률 요약(7일/30일, 연속 복용일)
      const sum = (days) => {
        let expected = 0, taken = 0;
        for (const m of meds) {
          const r = adherenceRate(m, logs, addDays(today, -(days - 1)), today, today, now);
          expected += r.expected; taken += r.taken;
        }
        return { expected, taken, rate: expected ? Math.round((taken / expected) * 100) : null };
      };
      const a7 = sum(7), a30 = sum(30);
      const bestStreak = meds.reduce((mx, m) => Math.max(mx, currentStreak(m, logs, today, now)), 0);
      const tile = (label, value, sub, role) => el('div', { class: 'med-tile', dataset: { role } }, [
        el('div', { class: 'med-tile__value' }, value), el('div', { class: 'med-tile__label' }, label), sub ? el('div', { class: 'med-tile__sub' }, sub) : null,
      ]);
      card.append(el('div', { class: 'med-tiles' }, [
        tile('최근 7일 복용률', a7.rate != null ? `${a7.rate}%` : '–', a7.expected ? `${a7.taken}/${a7.expected}회` : '데이터 없음', 'adh-7'),
        tile('최근 30일 복용률', a30.rate != null ? `${a30.rate}%` : '–', a30.expected ? `${a30.taken}/${a30.expected}회` : '데이터 없음', 'adh-30'),
        tile('연속 복용일(최장)', `${bestStreak}일`, '일정이 있는 날을 모두 복용', 'adh-streak'),
      ]));

      // 3) 최근 7일 점 격자(약마다 한 줄)
      const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
      const grid = el('div', { class: 'med-grid', dataset: { role: 'med-grid' } });
      grid.append(el('div', { class: 'med-grid__head' }, [el('span', {}, ''), ...days.map((d) => el('span', { class: d === today ? 'is-today' : '' }, `${d.slice(8)}(${window.weekdayLabel(d)})`))]));
      const GLYPH = { taken: '✓', partial: '½', missed: '×', upcoming: '', none: '·' };
      const STATE_LABEL = { taken: '모두 복용', partial: '일부 복용', missed: '놓침', upcoming: '예정', none: '복용일 아님' };
      for (const med of meds) {
        grid.append(el('div', { class: 'med-grid__row' }, [
          el('span', { class: 'med-grid__name', title: med.name }, med.name),
          ...days.map((d) => {
            const st = medDayStatus(med, logs, d, today, now);
            return el('span', {
              class: `med-dot med-dot--${st.state}`, dataset: { state: st.state, date: d, med: med.id },
              title: `${d} ${STATE_LABEL[st.state]}${st.total ? ` (${st.taken}/${st.total})` : ''}`,
            }, GLYPH[st.state]);
          }),
        ]));
      }
      card.append(
        el('div', { style: 'margin-top:14px' }, [el('strong', { style: 'font-size:14px' }, '최근 7일')]),
        grid,
        el('div', { class: 'med-legend' }, [
          el('span', {}, [el('i', { class: 'med-dot med-dot--taken' }, '✓'), ' 복용']),
          el('span', {}, [el('i', { class: 'med-dot med-dot--partial' }, '½'), ' 일부']),
          el('span', {}, [el('i', { class: 'med-dot med-dot--missed' }, '×'), ' 놓침']),
          el('span', {}, [el('i', { class: 'med-dot med-dot--upcoming' }, ''), ' 예정']),
          el('span', {}, [el('i', { class: 'med-dot med-dot--none' }, '·'), ' 복용일 아님']),
        ])
      );

      // 4) 놓친 복용(최근 7일) — 바로 "지금 체크"로 보충 기록 가능
      const missed = meds
        .flatMap((m) => missedDoses(m, logs, addDays(today, -6), today, today, now).map((d) => ({ ...d, med: m })))
        .sort((a, b) => b.date.localeCompare(a.date) || b.slot.localeCompare(a.slot));
      if (missed.length) {
        const list = el('div', { class: 'med-missed', dataset: { role: 'med-missed' } });
        for (const d of missed.slice(0, 8)) {
          list.append(el('div', { class: 'item-row' }, [
            el('div', { class: 'item-row__main' }, [
              el('div', { class: 'item-row__title' }, `${d.date.slice(5)}(${window.weekdayLabel(d.date)}) ${d.slot || ''} · ${d.med.name}`),
              el('div', { class: 'item-row__meta' }, d.status === 'skipped' ? '건너뜀으로 기록됨' : '기록 없음(미복용으로 계산)'),
            ]),
            el('button', { class: 'nm-btn', title: '실제로 먹었다면 보충 기록', onclick: () => toggleDose(d.med.id, d.date, d.slot) }, '먹었어요'),
          ]));
        }
        card.append(
          el('div', { style: 'margin-top:14px' }, [el('strong', { style: 'font-size:14px' }, `최근 7일 놓친 복용 (${missed.length}회)`)]),
          list
        );
        // 주의: Element.append(null)은 "null" 글자를 붙이므로 조건부 요소는 따로 붙인다.
        if (missed.length > 8) card.append(el('div', { class: 'text-muted', style: 'font-size:12px; margin-top:4px' }, `외 ${missed.length - 8}회`));
      }

      // 5) 약 목록(검색·정렬·일괄 삭제·첨부)
      const searchInput = el('input', {
        class: 'nm-input', style: 'max-width:220px', placeholder: '약 이름/목적 검색', value: medQuery,
        oninput: (e) => { medQuery = e.target.value; drawMedTable(); },
      });
      medTableHost = el('div', {});
      card.append(
        el('div', { class: 'row row--between wrap', style: 'margin-top:16px; gap:8px; align-items:center' }, [
          el('strong', { style: 'font-size:14px' }, `내 약 목록 (${all.length})`),
          searchInput,
        ]),
        medTableHost
      );
      drawMedTable();
      return card;
    }

    function reminderToggle() {
      const on = window.settingsSync.get(MED_REMINDER_KEY) !== '0';
      const perm = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
      return el('button', {
        class: `nm-btn ${on ? 'nm-btn--primary' : ''}`, title: '복용 시각이 지났는데 체크하지 않았으면 이 탭에서 알려줍니다(앱이 열려 있을 때만)', dataset: { role: 'med-reminder-toggle' },
        onclick: async () => {
          const next = !on;
          window.settingsSync.set(MED_REMINDER_KEY, next ? '1' : '0');
          if (next && perm === 'default' && typeof Notification !== 'undefined') {
            try { await Notification.requestPermission(); } catch { /* 권한 요청 불가 — 앱 안 토스트 알림만 사용 */ }
          }
          toast(next ? '복약 시간 알림을 켰습니다(앱이 열려 있을 때 알려줍니다).' : '복약 시간 알림을 껐습니다.', 'success');
          draw();
        },
      }, on ? '🔔 알림 켜짐' : '🔕 알림 꺼짐');
    }

    // 한 번 누르면 즉시 반영(낙관적). 서버 저장 실패 시에만 되돌리고 오류를 알린다. 기다리지 않는다.
    function toggleDose(medId, dateIso, slot) {
      const p = appState.toggleMedDose(medId, dateIso, slot, 'taken');
      if (p && p.catch) p.catch((e) => toast(errText(e, '복용 체크'), 'error'));
    }

    function drawMedTable() {
      if (!medTableHost) return;
      medTableHost.innerHTML = '';
      const today = todayISO();
      const now = nowHHMM();
      const logs = appState.healthMedLogs;
      let rows = appState.healthMedications.slice();
      if (medQuery.trim()) {
        const q = medQuery.trim().toLowerCase();
        rows = rows.filter((m) => (m.name || '').toLowerCase().includes(q) || (m.purpose || '').toLowerCase().includes(q) || (m.dosage || '').toLowerCase().includes(q));
      }
      const rate7 = (m) => adherenceRate(m, logs, addDays(today, -6), today, today, now).rate;
      rows = sortRows(rows, medSort, {
        name: (m) => m.name || '',
        dosage: (m) => m.dosage || '',
        schedule: (m) => scheduleText(m),
        rate7: (m) => rate7(m) ?? -1,
        streak: (m) => currentStreak(m, logs, today, now),
        supply: (m) => daysOfSupplyLeft(m, today) ?? 9999,
        attach: (m) => appState.getAttachments('health_medications', m.id).length,
      });
      selectedMeds = new Set([...selectedMeds].filter((id) => rows.some((r) => r.id === id)));
      const selCount = selectedMeds.size;
      const rerender = () => drawMedTable();

      if (!rows.length) { medTableHost.append(el('div', { class: 'empty-state', style: 'padding:16px' }, '검색 결과가 없습니다.')); return; }

      medTableHost.append(el('div', { class: 'row row--between', style: 'margin:8px 0; align-items:center' }, [
        el('span', { class: 'text-muted' }, ''),
        el('button', {
          class: 'nm-btn nm-btn--danger', disabled: selCount === 0 || undefined,
          onclick: () => {
            if (!confirmDialog(`선택한 약 ${selCount}건을 삭제할까요? (복용 기록은 남지만 목록과 통계에서는 사라집니다)`)) return;
            const ids = [...selectedMeds];
            selectedMeds.clear();
            appState.deleteHealthMedications(ids).then(() => toast(`${ids.length}건 삭제했습니다.`, 'success')).catch((e) => toast(errText(e, '삭제'), 'error'));
          },
        }, `선택 삭제${selCount ? ` (${selCount})` : ''}`),
      ]));

      const allChecked = rows.length > 0 && selCount === rows.length;
      const toggleAll = (e) => { if (e.target.checked) rows.forEach((r) => selectedMeds.add(r.id)); else selectedMeds.clear(); rerender(); };
      const table = el('table', { class: 'data-table health-med-table' });
      table.append(el('thead', {}, [el('tr', {}, [
        el('th', { style: 'cursor:default' }, [el('input', { type: 'checkbox', 'aria-label': '전체 선택', checked: allChecked ? true : undefined, onchange: toggleAll })]),
        el('th', { style: 'cursor:default' }, 'No'),
        sortTh(medSort, 'name', '약 이름', rerender),
        sortTh(medSort, 'dosage', '용량', rerender),
        sortTh(medSort, 'schedule', '복용 주기', rerender),
        sortTh(medSort, 'rate7', '7일 복용률', rerender),
        sortTh(medSort, 'streak', '연속', rerender),
        sortTh(medSort, 'supply', '남은 수량', rerender),
        sortTh(medSort, 'attach', '첨부', rerender),
        el('th', { style: 'cursor:default' }, '작업'),
      ])]));
      const tbody = el('tbody', {});
      rows.forEach((m, idx) => {
        const active = m.active !== false;
        const r7 = rate7(m);
        const supplyDays = daysOfSupplyLeft(m, today);
        const attachCount = appState.getAttachments('health_medications', m.id).length;
        tbody.append(el('tr', { class: active ? '' : 'is-inactive', dataset: { med: m.id } }, [
          el('td', {}, [el('input', { type: 'checkbox', checked: selectedMeds.has(m.id) || undefined, onchange: (e) => { if (e.target.checked) selectedMeds.add(m.id); else selectedMeds.delete(m.id); rerender(); } })]),
          el('td', {}, String(idx + 1)),
          el('td', {}, [
            el('strong', {}, m.name),
            !active ? el('span', { class: 'nm-badge', style: 'margin-left:6px' }, '중단') : null,
            m.purpose ? el('div', { class: 'text-muted', style: 'font-size:12px' }, m.purpose) : null,
          ]),
          el('td', {}, m.dosage ? m.dosage : '–'),
          el('td', {}, [scheduleText(m), el('div', { class: 'text-muted', style: 'font-size:11px' }, `${m.start_date || ''}${m.end_date ? ' ~ ' + m.end_date : ' ~'}`)]),
          el('td', {}, active && r7 != null ? `${r7}%` : '–'),
          el('td', {}, active ? `${currentStreak(m, logs, today, now)}일` : '–'),
          el('td', {}, m.remaining_count != null ? [`${m.remaining_count}`, supplyDays != null ? el('div', { class: supplyDays <= 7 ? 'med-supply-low' : 'text-muted', style: 'font-size:11px' }, supplyDays === 0 ? '소진' : `약 ${supplyDays}일분`) : null] : '–'),
          el('td', {}, attachCount ? el('button', { class: 'nm-btn', style: 'padding:2px 8px', title: '첨부 보기', onclick: () => window.openAttachmentsModal('health_medications', m.id, m.name) }, `📎${attachCount}`) : '-'),
          el('td', {}, [el('div', { class: 'icon-row' }, [
            el('button', { class: 'nm-btn nm-btn--icon', title: '수정(첨부 포함)', onclick: () => openMedicationForm(m) }, '✎'),
            el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: () => removeMedication(m) }, '🗑'),
          ])]),
        ]));
      });
      table.append(tbody);
      medTableHost.append(el('div', { class: 'data-table-wrap' }, [table]));
    }

    function removeMedication(m) {
      if (!confirmDialog(`"${m.name}"을(를) 삭제할까요? (복용 기록은 남지만 목록과 통계에서는 사라집니다)`)) return;
      appState.deleteHealthMedications([m.id]).then(() => toast('삭제했습니다.', 'success')).catch((e) => toast(errText(e, '삭제'), 'error'));
    }

    function openMedicationForm(existing) {
      openModal({
        title: existing ? '약 정보 수정' : '약 등록',
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          const typeSelect = el('select', { class: 'nm-select', name: 'schedule_type' }, [
            el('option', { value: 'daily' }, '매일'),
            el('option', { value: 'every_n_days' }, 'N일마다'),
            el('option', { value: 'weekdays' }, '특정 요일'),
          ]);
          typeSelect.value = existing?.schedule_type || 'daily';
          const intervalInput = el('input', { class: 'nm-input', type: 'number', min: '1', max: '90', name: 'interval_days', value: String(existing?.interval_days || 2), style: 'width:90px' });
          const intervalField = field('며칠마다 복용할까요? (시작일 기준)', intervalInput, true);
          const selectedDays = new Set(parseWeekdays(existing?.weekdays));
          const weekdayBox = el('div', { class: 'row wrap', style: 'gap:6px' }, WEEKDAY_KO.map((lbl, i) => {
            const cb = el('input', { type: 'checkbox', name: 'weekday', value: String(i), checked: selectedDays.has(i) || undefined });
            return el('label', { class: 'med-weekday' }, [cb, lbl]);
          }));
          const weekdayField = field('복용 요일', weekdayBox, true);
          const timesInput = el('input', { class: 'nm-input', name: 'dose_times', placeholder: '예: 08:00, 20:00', value: existing ? (parseDoseTimes(existing.dose_times).join(', ')) : '08:00' });
          const presets = [['아침', '08:00'], ['점심', '12:00'], ['저녁', '19:00'], ['취침 전', '22:00']];
          const presetRow = el('div', { class: 'row wrap', style: 'gap:6px; margin-top:4px' }, presets.map(([lbl, t]) => el('button', {
            type: 'button', class: 'nm-btn', style: 'padding:2px 8px; font-size:11px',
            onclick: () => {
              const cur = parseDoseTimes(timesInput.value);
              const next = cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t];
              timesInput.value = next.sort().join(', ');
            },
          }, `${lbl} ${t}`)));
          function syncType() {
            intervalField.style.display = typeSelect.value === 'every_n_days' ? '' : 'none';
            weekdayField.style.display = typeSelect.value === 'weekdays' ? '' : 'none';
          }
          typeSelect.addEventListener('change', syncType);

          form.append(
            field('약 이름', el('input', { class: 'nm-input', name: 'name', required: true, placeholder: '예: 혈압약', value: existing?.name || '' }), true),
            field('용량(선택)', el('input', { class: 'nm-input', name: 'dosage', placeholder: '예: 5mg 1정', value: existing?.dosage || '' })),
            field('복용 목적(선택)', el('input', { class: 'nm-input', name: 'purpose', placeholder: '예: 혈압 관리', value: existing?.purpose || '' })),
            field('복용 주기', typeSelect, true),
            intervalField,
            weekdayField,
            field('복용 시각(하루 횟수 = 시각 개수, 쉼표로 구분)', el('div', {}, [timesInput, presetRow]), true),
            el('div', { class: 'row', style: 'gap:10px' }, [
              field('복용 시작일', el('input', { class: 'nm-input', type: 'date', name: 'start_date', required: true, value: existing?.start_date || todayISO() }), true),
              field('종료일(선택)', el('input', { class: 'nm-input', type: 'date', name: 'end_date', value: existing?.end_date || '' })),
            ]),
            field('남은 수량(선택, 체크할 때마다 1씩 줄어 재처방 알림에 쓰입니다)', el('input', { class: 'nm-input', type: 'number', min: '0', name: 'remaining_count', value: existing?.remaining_count != null ? String(existing.remaining_count) : '' })),
            field('메모(선택)', el('textarea', { class: 'nm-textarea', name: 'note' }, existing?.note || '')),
            existing
              ? el('label', { class: 'row', style: 'gap:6px; align-items:center; font-size:13px; cursor:pointer' }, [
                  el('input', { type: 'checkbox', name: 'active', checked: existing.active !== false ? true : undefined }),
                  '복용 중 (끄면 체크리스트·통계에서 제외됩니다)',
                ])
              : null
          );
          syncType();
          const submitBtn = el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장');
          form.append(submitBtn);
          const attachHost = el('div', {});
          body.append(form, attachHost);

          function readForm() {
            const fd = new FormData(form);
            const type = fd.get('schedule_type');
            const timesRaw = String(fd.get('dose_times') || '').trim();
            const times = parseDoseTimes(timesRaw);
            if (timesRaw && !times.length) { toast('복용 시각을 08:00 형식으로 입력해 주세요.', 'error'); return null; }
            const wd = [...form.querySelectorAll('input[name=weekday]:checked')].map((c) => Number(c.value));
            if (type === 'weekdays' && !wd.length) { toast('복용 요일을 하나 이상 선택해 주세요.', 'error'); return null; }
            const start = fd.get('start_date');
            const end = fd.get('end_date') || null;
            if (end && end < start) { toast('종료일이 시작일보다 빠릅니다.', 'error'); return null; }
            const remaining = String(fd.get('remaining_count') || '').trim();
            return {
              name: String(fd.get('name') || '').trim(),
              dosage: fd.get('dosage') || null,
              purpose: fd.get('purpose') || null,
              schedule_type: type,
              interval_days: type === 'every_n_days' ? Math.max(1, Number(fd.get('interval_days')) || 1) : 1,
              weekdays: type === 'weekdays' ? wd.sort().join(',') : '',
              dose_times: times.join(','),
              start_date: start,
              end_date: end,
              remaining_count: remaining === '' ? null : Math.max(0, Number(remaining)),
              note: fd.get('note') || null,
            };
          }

          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = readForm();
            if (!data) return;
            if (existing) {
              data.active = form.querySelector('input[name=active]').checked;
              close();
              appState.updateHealthMedication(existing.id, data).then(() => toast('저장했습니다.', 'success')).catch((err) => toast(errText(err, '저장'), 'error'));
              return;
            }
            submitBtn.disabled = true;
            try {
              const row = await appState.addHealthMedication(data);
              toast('약을 등록했습니다. 처방전 사진 등을 첨부할 수 있어요.', 'success');
              Array.from(form.elements).forEach((elm) => { elm.disabled = true; });
              submitBtn.style.display = 'none';
              attachHost.append(
                el('h3', { style: 'margin:16px 0 8px' }, '첨부파일(처방전 사진 등)'),
                el('div', { id: 'new-med-attach-box' }),
                el('button', { class: 'nm-btn nm-btn--primary', type: 'button', style: 'width:100%; margin-top:12px', onclick: close }, '완료')
              );
              window.renderAttachmentsPanel(attachHost.querySelector('#new-med-attach-box'), 'health_medications', row.id);
            } catch (err) {
              submitBtn.disabled = false;
              toast(errText(err, '약 등록'), 'error');
            }
          });

          if (existing) {
            attachHost.append(
              el('h3', { style: 'margin:16px 0 8px' }, '첨부파일(처방전 사진 등)'),
              el('div', { id: 'edit-med-attach-box' })
            );
            window.renderAttachmentsPanel(attachHost.querySelector('#edit-med-attach-box'), 'health_medications', existing.id);
          }
        },
      });
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

    // ---- 병원/검진 일정 (v7.19.0: 검색·정렬·수정·첨부·열람·지난 일정 전환) ----
    function appointmentsCard() {
      const countLabel = (tab) => {
        const today = todayISO();
        const rows = appState.healthAppointments;
        return tab === 'upcoming' ? rows.filter((a) => a.appointment_date >= today).length : tab === 'past' ? rows.filter((a) => a.appointment_date < today).length : rows.length;
      };
      const tabBtn = (key, label) => el('button', {
        class: `quick-tab ${apptTab === key ? 'quick-tab--active' : ''}`, dataset: { apptTab: key },
        onclick: () => { apptTab = key; apptSort.key = 'date'; apptSort.dir = key === 'past' ? 'desc' : 'asc'; selectedAppointments.clear(); draw(); },
      }, `${label} ${countLabel(key)}`);
      const searchInput = el('input', {
        class: 'nm-input', style: 'max-width:240px', placeholder: '검색(제목/장소/유형/메모)', value: apptQuery, dataset: { role: 'appt-search' },
        oninput: (e) => { apptQuery = e.target.value; drawApptTable(); },
      });
      apptTableHost = el('div', {});
      const card = el('div', { class: 'nm-card', style: 'margin: 16px 0', dataset: { role: 'appt-card' } }, [
        el('div', { class: 'row row--between wrap', style: 'gap:8px' }, [
          el('h3', {}, '병원/검진 일정'),
          el('button', { class: 'nm-btn nm-btn--primary', onclick: () => openAppointmentForm() }, '+ 일정 등록'),
        ]),
        el('div', { class: 'row row--between wrap', style: 'gap:8px; margin-top:8px; align-items:center' }, [
          el('div', { class: 'quick-tabs', style: 'margin-bottom:0' }, [tabBtn('upcoming', '다가오는 일정'), tabBtn('past', '지난 일정'), tabBtn('all', '전체')]),
          searchInput,
        ]),
        apptTableHost,
      ]);
      drawApptTable();
      return card;
    }

    function filteredAppointments() {
      const today = todayISO();
      let rows = appState.healthAppointments.slice();
      if (apptTab === 'upcoming') rows = rows.filter((a) => a.appointment_date >= today);
      else if (apptTab === 'past') rows = rows.filter((a) => a.appointment_date < today);
      if (apptQuery.trim()) {
        const q = apptQuery.trim().toLowerCase();
        rows = rows.filter((a) => [a.title, a.location, a.appt_type, a.memo].some((v) => (v || '').toLowerCase().includes(q)));
      }
      return sortRows(rows, apptSort, {
        date: (a) => `${a.appointment_date || ''} ${a.appointment_time || ''}`,
        title: (a) => a.title || '',
        type: (a) => a.appt_type || '',
        location: (a) => a.location || '',
        attach: (a) => appState.getAttachments('health_appointments', a.id).length,
        linked: (a) => (a.schedule_id ? 1 : 0),
      });
    }

    function drawApptTable() {
      if (!apptTableHost) return;
      apptTableHost.innerHTML = '';
      const rows = filteredAppointments();
      selectedAppointments = new Set([...selectedAppointments].filter((id) => rows.some((a) => a.id === id)));
      const selCount = selectedAppointments.size;
      const rerender = () => drawApptTable();
      if (!rows.length) {
        apptTableHost.append(el('div', { class: 'empty-state' }, apptQuery.trim() ? '검색 결과가 없습니다.' : apptTab === 'past' ? '지난 일정이 없습니다.' : apptTab === 'upcoming' ? '예정된 일정이 없습니다. (지난 일정은 위 탭에서 볼 수 있어요)' : '등록된 일정이 없습니다.'));
        return;
      }
      apptTableHost.append(el('div', { class: 'row row--between', style: 'margin:8px 0; align-items:center' }, [
        el('span', { class: 'text-muted' }, `${rows.length}건`),
        el('button', {
          class: 'nm-btn nm-btn--danger', disabled: selCount === 0 || undefined,
          onclick: () => {
            if (!confirmDialog(`선택한 ${selCount}건을 삭제할까요? 연동된 일정도 함께 삭제됩니다.`)) return;
            const ids = [...selectedAppointments];
            selectedAppointments.clear();
            appState.deleteHealthAppointments(ids).then(() => toast(`${ids.length}건 삭제했습니다.`, 'success')).catch((e) => toast(`삭제 실패: ${e.message || e}`, 'error'));
          },
        }, `선택 삭제${selCount ? ` (${selCount})` : ''}`),
      ]));
      const allChecked = selCount === rows.length;
      const table = el('table', { class: 'data-table health-appt-table' });
      table.append(el('thead', {}, [el('tr', {}, [
        el('th', { style: 'cursor:default' }, [el('input', { type: 'checkbox', 'aria-label': '전체 선택', checked: allChecked ? true : undefined, onchange: (e) => { if (e.target.checked) rows.forEach((a) => selectedAppointments.add(a.id)); else selectedAppointments.clear(); rerender(); } })]),
        el('th', { style: 'cursor:default' }, 'No'),
        sortTh(apptSort, 'date', '날짜', rerender),
        sortTh(apptSort, 'title', '제목', rerender),
        sortTh(apptSort, 'type', '유형', rerender),
        sortTh(apptSort, 'location', '장소', rerender),
        sortTh(apptSort, 'attach', '첨부', rerender),
        sortTh(apptSort, 'linked', '일정 연동', rerender),
        el('th', { style: 'cursor:default' }, '작업'),
      ])]));
      const tbody = el('tbody', {});
      const today = todayISO();
      rows.forEach((a, idx) => {
        const attachCount = appState.getAttachments('health_appointments', a.id).length;
        tbody.append(el('tr', { class: a.appointment_date < today ? 'is-past' : '', dataset: { appt: a.id } }, [
          el('td', {}, [el('input', { type: 'checkbox', checked: selectedAppointments.has(a.id) || undefined, onchange: (e) => { if (e.target.checked) selectedAppointments.add(a.id); else selectedAppointments.delete(a.id); rerender(); } })]),
          el('td', {}, String(idx + 1)),
          el('td', {}, `${a.appointment_date}${a.appointment_time ? ' ' + a.appointment_time.slice(0, 5) : ''}`),
          el('td', { style: 'cursor:pointer', onclick: () => openAppointmentView(a) }, [
            el('strong', {}, a.title),
            a.memo ? el('div', { class: 'text-muted', style: 'font-size:12px; max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap' }, a.memo) : null,
          ]),
          el('td', {}, a.appt_type ? el('span', { class: 'nm-badge' }, a.appt_type) : '–'),
          el('td', {}, a.location ? a.location : '–'),
          el('td', {}, attachCount ? el('span', { class: 'nm-badge nm-badge--info', title: '첨부파일 수', dataset: { role: 'attach-count' } }, `📎${attachCount}`) : '-'),
          el('td', {}, a.schedule_id ? el('span', { class: 'nm-badge nm-badge--info', title: '일정 메뉴에도 자동으로 반영됩니다' }, '🗓️ 연동') : '–'),
          el('td', {}, [el('div', { class: 'icon-row' }, [
            el('button', { class: 'nm-btn nm-btn--icon', title: '열람', onclick: () => openAppointmentView(a) }, '👁'),
            el('button', { class: 'nm-btn nm-btn--icon', title: '수정', onclick: () => openAppointmentForm(a) }, '✎'),
            el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: () => removeAppointment(a) }, '🗑'),
          ])]),
        ]));
      });
      table.append(tbody);
      apptTableHost.append(el('div', { class: 'data-table-wrap' }, [table]));
    }

    // 열람(읽기 전용) 모달 — Knowledge와 같은 방식: 이미지는 <img>, PDF는 sandbox <iframe>으로 미리보기.
    function openAppointmentView(a) {
      openModal({
        title: '병원/검진 일정 열람',
        contentBuilder(body) {
          body.append(el('h2', { style: 'margin:0 0 6px; font-size:18px' }, a.title));
          const meta = [
            ['날짜', `${a.appointment_date}${a.appointment_time ? ' ' + a.appointment_time.slice(0, 5) : ''}`],
            a.appt_type ? ['유형', a.appt_type] : null,
            a.location ? ['장소', a.location] : null,
            a.schedule_id ? ['일정 연동', '일정 메뉴에 함께 등록됨'] : null,
          ].filter(Boolean);
          body.append(el('div', { class: 'stack', style: 'gap:4px; font-size:13px' }, meta.map(([k, v]) => el('div', {}, [el('span', { class: 'text-muted' }, `${k}: `), v]))));
          if (a.memo) body.append(el('div', { class: 'text-muted', style: 'white-space:pre-wrap; margin-top:12px; font-size:14px; line-height:1.6' }, a.memo));
          const attachments = appState.getAttachments('health_appointments', a.id);
          if (attachments.length) {
            body.append(el('h3', { style: 'margin:16px 0 8px; font-size:14px' }, '첨부파일 미리보기'));
            const box = el('div', { class: 'stack', style: 'gap:10px' });
            body.append(box);
            window.renderAttachmentPreviews(box, 'health_appointments', a.id);
          }
          const attachBox = el('div', { style: 'margin-top:16px' });
          body.append(el('h3', { style: 'margin:0 0 6px; font-size:14px' }, '첨부파일 관리(추가/삭제)'), attachBox);
          window.renderAttachmentsPanel(attachBox, 'health_appointments', a.id);
        },
      });
    }

    function removeAppointment(a) {
      if (!confirmDialog(`"${a.title}" 일정을 삭제할까요? 연동된 일정도 함께 삭제됩니다.`)) return;
      appState.deleteHealthAppointment(a.id).then(() => toast('삭제했습니다.', 'success')).catch((e) => toast(`삭제 실패: ${e.message || e}`, 'error'));
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
          el('div', { class: 'item-row', dataset: { metric: m.id } }, [
            el('div', { class: 'item-row__main' }, [
              el('div', { class: 'item-row__title' }, `${METRIC_TYPE_LABEL[m.metric_type] || m.metric_type}: ${m.value}${m.unit || ''}`),
              el('div', { class: 'item-row__meta' }, `${localDateOf(m.recorded_at)}${m.note ? ' · ' + m.note : ''}${m._pending ? ' · 저장 중…' : ''}`),
            ]),
            m._pending ? null : el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: () => removeMetric(m) }, '🗑'),
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

    function removeMetric(m) {
      if (!confirmDialog('이 기록을 삭제할까요?')) return;
      appState.deleteHealthMetric(m.id).then(() => toast('삭제했습니다.', 'success')).catch((e) => toast(`삭제 실패: ${e.message || e}`, 'error'));
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
          form.addEventListener('submit', (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const metricType = fd.get('metric_type');
            const metricDate = fd.get('date') || todayISO();
            const recordedAt = new Date(`${metricDate}T${new Date().toTimeString().slice(0, 8)}`).toISOString();
            const note = fd.get('note') || null;

            let pending;
            if (metricType === 'blood_pressure') {
              const sys = Number(bpSysInput.value);
              const dia = Number(bpDiaInput.value);
              if (!sys || !dia) {
                toast('수축기/이완기 혈압을 모두 입력해주세요.', 'error');
                return;
              }
              // 수축기+이완기를 한 번의 insert로 보낸다(낙관적: 목록·그래프에는 즉시 나타난다).
              pending = appState.addHealthMetrics([
                { metric_type: 'bp_systolic', value: sys, unit: 'mmHg', note, recorded_at: recordedAt },
                { metric_type: 'bp_diastolic', value: dia, unit: 'mmHg', note, recorded_at: recordedAt },
              ]);
            } else {
              pending = appState.addHealthMetric({
                metric_type: metricType,
                value: Number(fd.get('value')),
                unit: fd.get('unit') || null,
                note,
                recorded_at: recordedAt,
              });
            }
            // 서버 응답을 기다리지 않고 바로 닫는다. 실패하면 임시로 보여준 기록을 되돌리고 알려준다.
            close();
            pending
              .then(() => {
                toast('기록을 저장했습니다.', 'success');
                if (metricType === 'exercise' && metricDate === todayISO()) return suggestChallengeCheckin();
                return null;
              })
              .catch((err) => toast(`기록을 저장하지 못했습니다: ${err.message || err} (화면에 임시로 보이던 기록을 취소했습니다. 다시 입력해 주세요)`, 'error'));
          });
          body.append(form);
        },
      });
    }

    // 병원/검진 일정 등록·수정 공용 폼. existing이 있으면 값을 채워 수정(연동된 일정도 함께 갱신).
    function openAppointmentForm(existing) {
      openModal({
        title: existing ? '병원/검진 일정 수정' : '병원/검진 일정 등록',
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          const typeSelect = el('select', { class: 'nm-select', name: 'appt_type' }, [el('option', { value: '' }, '(선택 안 함)'), ...APPT_TYPES.map((t) => el('option', { value: t }, t))]);
          typeSelect.value = existing?.appt_type || '';
          if (existing?.appt_type && !APPT_TYPES.includes(existing.appt_type)) { typeSelect.append(el('option', { value: existing.appt_type }, existing.appt_type)); typeSelect.value = existing.appt_type; }
          form.append(
            field('제목', el('input', { class: 'nm-input', name: 'title', required: true, placeholder: '예: 정기 검진', value: existing?.title || '' }), true),
            field('날짜', el('input', { class: 'nm-input', type: 'date', name: 'appointment_date', required: true, value: existing?.appointment_date || todayISO() }), true),
            field('시간(선택)', el('input', { class: 'nm-input', type: 'time', name: 'appointment_time', value: existing?.appointment_time ? existing.appointment_time.slice(0, 5) : '' })),
            field('유형(선택)', typeSelect),
            field('장소(선택)', el('input', { class: 'nm-input', name: 'location', value: existing?.location || '' })),
            field('메모(선택)', el('textarea', { class: 'nm-textarea', name: 'memo' }, existing?.memo || ''))
          );
          form.append(el('p', { class: 'text-muted', style: 'font-size:12px' }, existing && existing.schedule_id
            ? '저장하면 "일정" 메뉴에 연동된 일정(제목·날짜·시간·장소)도 함께 수정됩니다.'
            : '저장하면 "일정" 메뉴에도 자동으로 함께 등록됩니다.'));
          const submitBtn = el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장');
          form.append(submitBtn);
          // 신규 등록 직후 바로 첨부(진료의뢰서 등)할 수 있도록 저장되면 폼 자리에 첨부 패널을 보여준다.
          // 수정할 때는 이미 저장된 레코드이므로 처음부터 첨부 패널을 함께 보여준다.
          const attachHost = el('div', {});
          body.append(form, attachHost);
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const data = {
              title: String(fd.get('title') || '').trim(),
              appointment_date: fd.get('appointment_date'),
              appointment_time: fd.get('appointment_time') || null,
              appt_type: fd.get('appt_type') || null,
              location: fd.get('location') || null,
              memo: fd.get('memo') || null,
            };
            if (existing) {
              close();
              appState.updateHealthAppointment(existing.id, data)
                .then(() => toast(appState.schemaWarning ? `저장했습니다. (${appState.schemaWarning})` : '저장했습니다.', 'success'))
                .catch((err) => toast(`저장 실패: ${err.message || err} (변경을 취소했습니다)`, 'error'));
              return;
            }
            submitBtn.disabled = true;
            try {
              const row = await appState.addHealthAppointment(data);
              toast('일정을 저장했습니다. (일정 메뉴에도 추가됨) 이제 파일을 첨부할 수 있어요.', 'success');
              Array.from(form.elements).forEach((elm) => { elm.disabled = true; });
              submitBtn.style.display = 'none';
              attachHost.append(
                el('h3', { style: 'margin:16px 0 8px' }, '첨부파일'),
                el('div', { id: 'new-appt-attach-box' }),
                el('button', { class: 'nm-btn nm-btn--primary', type: 'button', style: 'width:100%; margin-top:12px', onclick: close }, '완료')
              );
              window.renderAttachmentsPanel(attachHost.querySelector('#new-appt-attach-box'), 'health_appointments', row.id);
            } catch (err) {
              submitBtn.disabled = false;
              toast(`일정 저장 실패: ${err.message || err}`, 'error');
            }
          });
          if (existing) {
            attachHost.append(
              el('h3', { style: 'margin:16px 0 8px' }, '첨부파일'),
              el('div', { id: 'edit-appt-attach-box' })
            );
            window.renderAttachmentsPanel(attachHost.querySelector('#edit-appt-attach-box'), 'health_appointments', existing.id);
          }
        },
      });
    }

    draw();
    appState.addEventListener('change', draw);
    return () => appState.removeEventListener('change', draw);
  }

  window.renderHealth = renderHealth;
})();
