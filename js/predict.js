// 예측(Predictive) 로직. 외부 API 없이 클라이언트에서 즉시 계산되는 단순 통계다.
// 개발계획서 4.4장의 "진행률 증분 ÷ 기록 간 경과일" 방식을 그대로 구현한다.
// 일반 <script>로 로드되며 js/utils/date.js가 먼저 로드되어 globalThis.diffDays 등이 있어야 한다.
// globalThis를 쓰면 브라우저(window)와 Node(단위 테스트) 양쪽에서 동일하게 동작한다.
(function () {
  const { diffDays, addDays, weekdayIndex, todayISO } = globalThis;

  /**
   * 프로젝트 진행률 기록으로 완료 예상일을 계산한다.
   * @param {{progress:number, recorded_at:string}[]} records 시간순 정렬 불필요(내부에서 정렬)
   * @param {string} todayIso 기준일 (YYYY-MM-DD)
   * @param {number} minRecords 최소 기록 수 (기본 2)
   * @returns {{predictedDate:string|null, dailyRate:number|null, confidence:'none'|'low'|'medium'|'high', reason?:string}}
   */
  function predictProjectCompletion(records, todayIso = todayISO(), minRecords = 2) {
    const clean = (records || [])
      .filter((r) => r && typeof r.progress === 'number' && r.recorded_at)
      .slice()
      .sort((a, b) => (a.recorded_at < b.recorded_at ? -1 : 1));

    if (clean.length < minRecords) {
      return { predictedDate: null, dailyRate: null, confidence: 'none', reason: 'insufficient_records' };
    }

    const latest = clean[clean.length - 1];
    if (latest.progress >= 100) {
      return { predictedDate: null, dailyRate: null, confidence: 'none', reason: 'already_complete' };
    }

    const rates = [];
    for (let i = 1; i < clean.length; i++) {
      const days = diffDays(clean[i - 1].recorded_at, clean[i].recorded_at);
      if (days <= 0) continue; // 같은 날 여러 번 기록된 경우 등은 제외
      const delta = clean[i].progress - clean[i - 1].progress;
      rates.push(delta / days);
    }

    if (rates.length === 0) {
      return { predictedDate: null, dailyRate: null, confidence: 'none', reason: 'no_valid_interval' };
    }

    const avgRate = rates.reduce((s, r) => s + r, 0) / rates.length;

    if (avgRate <= 0) {
      return { predictedDate: null, dailyRate: avgRate, confidence: 'none', reason: 'no_progress_or_regressing' };
    }

    const remaining = 100 - latest.progress;
    const daysNeeded = Math.ceil(remaining / avgRate);
    const predictedDate = addDays(todayIso, daysNeeded);

    // 신뢰도: 기록 수가 많을수록, 변화율의 편차가 작을수록 높다.
    const mean = avgRate;
    const variance = rates.reduce((s, r) => s + (r - mean) ** 2, 0) / rates.length;
    const stdDev = Math.sqrt(variance);
    const cv = mean !== 0 ? stdDev / Math.abs(mean) : Infinity; // 변동계수

    let confidence = 'low';
    if (clean.length >= 6 && cv < 0.6) confidence = 'high';
    else if (clean.length >= 3 && cv < 1.2) confidence = 'medium';

    return { predictedDate, dailyRate: avgRate, confidence };
  }

  /**
   * 요일별 과거 평균 일정 수 대비 다음 7일의 예상 밀집도를 계산한다.
   * @param {{date:string}[]} allSchedules 과거+미래 일정 전체 (완료 여부 무관)
   * @param {string} todayIso
   * @param {number} lookbackWeeks 과거 몇 주를 기준으로 평균을 낼지
   * @returns {{date:string, weekday:number, count:number, average:number, congested:boolean}[]}
   */
  function predictScheduleDensity(allSchedules, todayIso = todayISO(), lookbackWeeks = 4) {
    const lookbackStart = addDays(todayIso, -7 * lookbackWeeks);

    // 요일별 과거 발생 횟수 집계 (오늘 이전 데이터만)
    const pastByWeekday = Array.from({ length: 7 }, () => 0);
    for (const s of allSchedules) {
      if (!s?.date) continue;
      if (s.date >= lookbackStart && s.date < todayIso) {
        pastByWeekday[weekdayIndex(s.date)] += 1;
      }
    }
    const averageByWeekday = pastByWeekday.map((count) => count / lookbackWeeks);

    // 다음 7일 실제 등록된 일정 수
    const futureCountByDate = new Map();
    for (const s of allSchedules) {
      if (!s?.date) continue;
      if (s.date >= todayIso && s.date <= addDays(todayIso, 6)) {
        futureCountByDate.set(s.date, (futureCountByDate.get(s.date) || 0) + 1);
      }
    }

    const result = [];
    for (let i = 0; i <= 6; i++) {
      const date = addDays(todayIso, i);
      const wd = weekdayIndex(date);
      const avg = averageByWeekday[wd];
      const count = futureCountByDate.get(date) || 0;
      // 평균이 0에 가까우면(데이터 부족) 절대 기준(3건 이상)으로 보정
      const threshold = avg > 0.5 ? avg * 1.5 : 3;
      result.push({ date, weekday: wd, count, average: Number(avg.toFixed(2)), congested: count >= threshold && count > 0 });
    }
    return result;
  }

  /**
   * 차량 다음 정비 예상 시기: 주행거리 기준과 기간 기준 중 먼저 도달하는 쪽(개발계획서 8.3).
   * 주행거리 증가율은 주유/충전 기록(odometer)의 최근 추세로 추정한다.
   * @param {{next_due_date?:string, next_due_odometer?:number}} lastMaintenance 가장 최근 정비 기록(등록된 다음 예정 포함)
   * @param {{logged_at:string, odometer:number}[]} fuelLogs 주유 기록(시간순 정렬 불필요)
   * @param {string} todayIso
   * @returns {{predictedDate:string|null, basis:'odometer'|'date'|'none', dailyKm:number|null, reason?:string}}
   */
  function predictNextMaintenance(lastMaintenance, fuelLogs = [], todayIso = todayISO()) {
    if (!lastMaintenance) return { predictedDate: null, basis: 'none', dailyKm: null, reason: 'no_maintenance_record' };

    const clean = (fuelLogs || [])
      .filter((r) => r && typeof r.odometer === 'number' && r.logged_at)
      .slice()
      .sort((a, b) => (a.logged_at < b.logged_at ? -1 : 1));

    let dailyKm = null;
    if (clean.length >= 2) {
      const first = clean[0];
      const last = clean[clean.length - 1];
      const days = diffDays(first.logged_at, last.logged_at);
      if (days > 0 && last.odometer > first.odometer) {
        dailyKm = (last.odometer - first.odometer) / days;
      }
    }

    let dateFromOdometer = null;
    if (dailyKm && lastMaintenance.next_due_odometer && clean.length) {
      const latestOdo = clean[clean.length - 1].odometer;
      const remainingKm = lastMaintenance.next_due_odometer - latestOdo;
      if (remainingKm <= 0) dateFromOdometer = todayIso; // 이미 도달
      else dateFromOdometer = addDays(todayIso, Math.ceil(remainingKm / dailyKm));
    }

    const dateFromSchedule = lastMaintenance.next_due_date || null;

    if (!dateFromOdometer && !dateFromSchedule) {
      return { predictedDate: null, basis: 'none', dailyKm, reason: 'insufficient_data' };
    }
    if (dateFromOdometer && dateFromSchedule) {
      return dateFromOdometer <= dateFromSchedule
        ? { predictedDate: dateFromOdometer, basis: 'odometer', dailyKm }
        : { predictedDate: dateFromSchedule, basis: 'date', dailyKm };
    }
    return dateFromOdometer
      ? { predictedDate: dateFromOdometer, basis: 'odometer', dailyKm }
      : { predictedDate: dateFromSchedule, basis: 'date', dailyKm };
  }

  /**
   * 최근 주유 기록으로 평균 연비 추이(주행거리/주유량)를 계산한다.
   * @param {{logged_at:string, odometer:number, amount:number}[]} fuelLogs
   * @returns {number|null} km/단위(L 또는 kWh)
   */
  function calcFuelEfficiency(fuelLogs = []) {
    // 기준(baseline) 주행거리만 기록하고 주유량은 0/미기재인 첫 기록도 허용한다 —
    // 연비는 "그 다음 주유"까지 달린 거리 ÷ 그 다음 주유량으로 계산하므로 첫 기록의
    // amount는 계산에 쓰이지 않는다.
    const clean = (fuelLogs || [])
      .filter((r) => r && typeof r.odometer === 'number')
      .slice()
      .sort((a, b) => (a.logged_at < b.logged_at ? -1 : 1));
    if (clean.length < 2) return null;
    let totalKm = 0;
    let totalAmount = 0;
    for (let i = 1; i < clean.length; i++) {
      const km = clean[i].odometer - clean[i - 1].odometer;
      const amount = clean[i].amount;
      if (km > 0 && typeof amount === 'number' && amount > 0) {
        totalKm += km;
        totalAmount += amount;
      }
    }
    if (totalAmount <= 0) return null;
    return Number((totalKm / totalAmount).toFixed(1));
  }

  /**
   * Health 주간 목표 달성 확률: 최근 14일 운동 빈도를 챌린저 예측과 동일한
   * "속도 추세 → 목표 대비 비율" 방식으로 계산한다(개발계획서 8.3).
   * @param {{recorded_at:string}[]} exerciseMetrics metric_type='exercise'인 기록들
   * @param {number} weeklyGoal 주간 목표 횟수
   * @param {string} todayIso
   * @returns {{probability:number, sessionsPerWeek:number, confidence:'none'|'low'|'medium'|'high'}}
   */
  function predictWeeklyExerciseGoal(exerciseMetrics, weeklyGoal = 3, todayIso = todayISO()) {
    const since = addDays(todayIso, -13); // 최근 14일(오늘 포함)
    const recent = (exerciseMetrics || []).filter((m) => localDateOf(m.recorded_at) >= since); // 로컬 날짜 기준(v7.19.0)
    const sessionsPerWeek = (recent.length / 14) * 7;
    const probability = weeklyGoal > 0 ? Math.min(100, Math.round((sessionsPerWeek / weeklyGoal) * 100)) : 0;
    let confidence = 'low';
    if (recent.length >= 8) confidence = 'high';
    else if (recent.length >= 4) confidence = 'medium';
    else if (recent.length === 0) confidence = 'none';
    return { probability, sessionsPerWeek: Number(sessionsPerWeek.toFixed(1)), confidence };
  }

  /**
   * 챌린지 연속 체크인일(streak)과 "오늘 아직 체크인 안 해서 스트릭이 끊길 위험" 여부.
   * @param {{checkin_date:string}[]} checkins
   * @param {string} todayIso
   * @returns {{streak:number, atRisk:boolean, checkedToday:boolean}}
   */
  function computeChallengeStreak(checkins, todayIso = todayISO()) {
    const dates = new Set((checkins || []).map((c) => c.checkin_date));
    const checkedToday = dates.has(todayIso);
    let streak = 0;
    let cursor = checkedToday ? todayIso : addDays(todayIso, -1);
    while (dates.has(cursor)) {
      streak++;
      cursor = addDays(cursor, -1);
    }
    // 어제까지는 이어오다가 오늘 아직 체크인을 안 한 상태 = 위험
    const atRisk = !checkedToday && streak > 0;
    return { streak, atRisk, checkedToday };
  }

  /**
   * 연속 미달성일(missStreak) — 오늘을 포함해 체크인이 없는 날이 며칠째 이어지는지.
   * 오늘 체크인했다면 0을 반환한다(챌린저 화면의 "화남" 이모지 판단에 사용).
   * @param {{checkin_date:string}[]} checkins
   * @param {string} todayIso
   * @returns {number}
   */
  function computeMissStreak(checkins, todayIso = todayISO()) {
    const dates = new Set((checkins || []).map((c) => c.checkin_date));
    if (dates.has(todayIso)) return 0;
    let miss = 0;
    let cursor = todayIso;
    while (!dates.has(cursor) && miss < 365) {
      miss++;
      cursor = addDays(cursor, -1);
    }
    return miss;
  }

  /**
   * Health 기록(metrics)을 주간/월간/분기 단위로 묶어 평균값 추이를 계산한다.
   * 그래프(막대/선) 그리기 전용 — 각 구간에 기록이 하나도 없으면 value는 null이다.
   * @param {{value:number, recorded_at:string}[]} metrics 같은 metric_type으로 미리 걸러서 넘긴다
   * @param {'week'|'month'|'quarter'} period
   * @param {number} periods 보여줄 구간 수(최근 n개, 오늘이 포함된 구간이 마지막)
   * @param {string} todayIso
   * @returns {{labels:string[], values:(number|null)[], counts:number[]}}
   */
  function aggregateMetricTrend(metrics, period = 'week', periods = 8, todayIso = todayISO()) {
    const buckets = [];
    const base = new Date(todayIso + 'T00:00:00');

    for (let i = periods - 1; i >= 0; i--) {
      let start, end, label;
      if (period === 'month') {
        const y = base.getFullYear();
        const m = base.getMonth() - i;
        const d = new Date(y, m, 1);
        start = todayISO(d);
        end = todayISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
        label = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
      } else if (period === 'quarter') {
        const totalQuarter = base.getFullYear() * 4 + Math.floor(base.getMonth() / 3) - i;
        const y = Math.floor(totalQuarter / 4);
        const q = ((totalQuarter % 4) + 4) % 4;
        const startMonth = q * 3;
        const d = new Date(y, startMonth, 1);
        start = todayISO(d);
        end = todayISO(new Date(y, startMonth + 3, 0));
        label = `${y} Q${q + 1}`;
      } else {
        // week: 오늘을 포함한 7일 단위로 과거로 거슬러 올라간다(ISO 주 경계가 아니라 "최근 n*7일"을 n구간으로 나눈 방식).
        end = addDays(todayIso, -7 * i);
        start = addDays(end, -6);
        label = start.slice(5); // MM-DD
      }
      buckets.push({ start, end, label });
    }

    const labels = buckets.map((b) => b.label);
    const values = buckets.map((b) => {
      const rows = (metrics || []).filter((m) => {
        const d = localDateOf(m.recorded_at);
        return d >= b.start && d <= b.end && typeof m.value === 'number';
      });
      if (!rows.length) return null;
      const avg = rows.reduce((s, r) => s + r.value, 0) / rows.length;
      return Number(avg.toFixed(1));
    });
    const counts = buckets.map(
      (b) => (metrics || []).filter((m) => { const d = localDateOf(m.recorded_at); return d >= b.start && d <= b.end; }).length
    );
    return { labels, values, counts };
  }

  // =====================================================================
  // Health 기준치 판정 (v7.19.0: health.js에서 이곳으로 옮겨 Node 단위 테스트가 가능해졌다.
  // 일반적인 건강검진 기준을 참고한 간단화한 값이며 의학적 진단이 아니다.)
  // =====================================================================
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

  // 혈당(mg/dL). 공복/식후를 구분해 기록하지 않으므로 공복 기준(100/126)을 "참고용"으로만 쓴다.
  function glucoseStatus(value) {
    if (value == null || Number.isNaN(value)) return null;
    if (value < 100) return { level: 'success', label: '정상' };
    if (value < 126) return { level: 'warning', label: '경계' };
    return { level: 'critical', label: '높음' };
  }

  // 대시보드 차트의 "정상 범위 음영"에 쓰는 혈압 구간. bpStatus의 임계값과 반드시 일치해야 하며
  // (tests/health.test.mjs가 두 값이 어긋나면 실패하도록 검증한다) 한쪽만 바꾸면 안 된다.
  //   수축기: 90–119 정상, 120–139 주의(상승/1기)  /  이완기: 60–79 정상, 80–89 주의(1기)
  const BP_RANGES = {
    bp_systolic: { normal: { min: 90, max: 119 }, caution: { min: 120, max: 139 } },
    bp_diastolic: { normal: { min: 60, max: 79 }, caution: { min: 80, max: 89 } },
  };

  // 기록 시각(ISO 문자열)을 "사용자 로컬 날짜"로 바꾼다. YYYY-MM-DD(10자)는 그대로 돌려준다.
  // (UTC 문자열을 slice(0,10)하면 한국 시간 오전 9시 이전 기록이 전날로 잡힌다.)
  function localDateOf(ts) {
    if (!ts) return '';
    if (typeof ts === 'string' && ts.length === 10) return ts;
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return String(ts).slice(0, 10);
    return todayISO(d);
  }

  // =====================================================================
  // 복약 관리 — 복용 일정 / 복용률 / 연속 복용일 (순수 함수)
  // med: { id, schedule_type:'daily'|'every_n_days'|'weekdays', interval_days, weekdays:'1,3,5',
  //        dose_times:'08:00,20:00', start_date, end_date|null, active }
  // log: { medication_id, taken_date, slot:'HH:MM'|'', status:'taken'|'skipped'|'missed' }
  // "기록이 없는 지난 복용 시각"은 놓친 것으로 계산한다. 미래 날짜, 그리고 (nowHHMM을 주면) 오늘 아직
  // 오지 않은 시각은 "예정(upcoming)"이라 분모에 넣지 않는다. 먼저 복용해 둔 예정 시각은 복용으로 센다.
  // =====================================================================
  const pad2 = (n) => String(n).padStart(2, '0');

  /** '08:00, 20:00' → ['08:00','20:00'] (유효하지 않은 값 제거, 중복 제거, 시각순 정렬) */
  function parseDoseTimes(str) {
    const out = [];
    for (const raw of String(str == null ? '' : str).split(/[,\s]+/)) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
      if (!m) continue;
      const h = Number(m[1]);
      const mi = Number(m[2]);
      if (h > 23 || mi > 59) continue;
      out.push(`${pad2(h)}:${pad2(mi)}`);
    }
    return Array.from(new Set(out)).sort();
  }

  /** 하루 복용 시각 목록. 시각을 안 적었으면 시각 없는 1회(slot '')로 본다. */
  function doseSlots(med) {
    const t = parseDoseTimes(med && med.dose_times);
    return t.length ? t : [''];
  }

  /** '1,3,5' → [1,3,5] (0=일 … 6=토) */
  function parseWeekdays(str) {
    const arr = Array.isArray(str) ? str : String(str == null ? '' : str).split(/[,\s]+/);
    return Array.from(new Set(arr.filter((x) => x !== '' && x != null).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))).sort();
  }

  /** 그 날짜에 복용 일정이 있는가(시작/종료일, 주기 규칙만 본다 — active 여부는 호출부에서 거른다). */
  function isScheduledOn(med, iso) {
    if (!med || !med.start_date || !iso) return false;
    if (iso < med.start_date) return false;
    if (med.end_date && iso > med.end_date) return false;
    const type = med.schedule_type || 'daily';
    if (type === 'every_n_days') {
      const n = Math.max(1, Math.floor(Number(med.interval_days) || 1));
      return diffDays(med.start_date, iso) % n === 0;
    }
    if (type === 'weekdays') return parseWeekdays(med.weekdays).includes(weekdayIndex(iso));
    return true;
  }

  /**
   * [fromIso, toIso] 구간에서 복용했어야 하는 (날짜, 시각) 목록. 미래 날짜는 제외한다.
   * nowHHMM을 주면 오늘 그 시각 이후의 슬롯(아직 오지 않음)도 제외한다.
   * @returns {{date:string, slot:string}[]}
   */
  function expectedDoses(med, fromIso, toIso, todayIso = todayISO(), nowHHMM = null) {
    if (!med || !med.start_date) return [];
    let from = fromIso > med.start_date ? fromIso : med.start_date;
    let to = toIso < todayIso ? toIso : todayIso;
    if (med.end_date && med.end_date < to) to = med.end_date;
    if (from > to) return [];
    const slots = doseSlots(med);
    const out = [];
    for (let d = from, guard = 0; d <= to && guard < 3700; d = addDays(d, 1), guard++) {
      if (!isScheduledOn(med, d)) continue;
      for (const slot of slots) {
        if (nowHHMM && d === todayIso && slot && slot > nowHHMM) continue;
        out.push({ date: d, slot });
      }
    }
    return out;
  }

  function logIndex(med, logs) {
    const map = new Map();
    for (const l of logs || []) {
      if (!l) continue;
      if (med && med.id != null && l.medication_id !== med.id) continue;
      map.set(`${l.taken_date}|${l.slot || ''}`, l.status || 'taken');
    }
    return map;
  }

  /**
   * 복용률. 분모 = 이미 지났거나 이미 복용한 복용 시각 수, 분자 = 복용(taken)한 수.
   * skipped(건너뜀)·missed(놓침)·기록 없음은 모두 미복용이다.
   * @returns {{expected:number, taken:number, skipped:number, missed:number, rate:number|null}}
   */
  function adherenceRate(med, logs, fromIso, toIso, todayIso = todayISO(), nowHHMM = null) {
    const idx = logIndex(med, logs);
    const key = (d) => `${d.date}|${d.slot}`;
    const counted = new Map(); // key -> status
    for (const d of expectedDoses(med, fromIso, toIso, todayIso, nowHHMM)) counted.set(key(d), idx.get(key(d)) || null);
    // 아직 오지 않은 예정 시각을 미리 복용했다면 그것도 센다.
    for (const d of expectedDoses(med, fromIso, toIso, todayIso, null)) {
      if (!counted.has(key(d)) && idx.get(key(d)) === 'taken') counted.set(key(d), 'taken');
    }
    let taken = 0, skipped = 0;
    for (const st of counted.values()) {
      if (st === 'taken') taken++;
      else if (st === 'skipped') skipped++;
    }
    const expected = counted.size;
    return { expected, taken, skipped, missed: expected - taken - skipped, rate: expected ? Math.round((taken / expected) * 100) : null };
  }

  /** 지났는데 복용하지 않은 (날짜, 시각) 목록(최근 날짜 먼저). status: 'skipped' | 'missed' */
  function missedDoses(med, logs, fromIso, toIso, todayIso = todayISO(), nowHHMM = null) {
    const idx = logIndex(med, logs);
    return expectedDoses(med, fromIso, toIso, todayIso, nowHHMM)
      .filter((d) => idx.get(`${d.date}|${d.slot}`) !== 'taken')
      .map((d) => ({ ...d, status: idx.get(`${d.date}|${d.slot}`) === 'skipped' ? 'skipped' : 'missed' }))
      .reverse();
  }

  /**
   * 하루 상태: none(복용 일정 없음) | upcoming(아직 복용할 시각 전) | taken(전부 복용) |
   * partial(지난 시각 중 일부만 복용) | missed(지난 시각을 하나도 복용하지 않음). pending=true면 오늘 아직 오지 않은 복용 시각이 남아 있다
   * (지난 시각을 모두 복용했다면 pending이어도 taken으로 본다).
   */
  function medDayStatus(med, logs, iso, todayIso = todayISO(), nowHHMM = null) {
    if (!isScheduledOn(med, iso)) return { state: 'none', expected: 0, taken: 0, total: 0, pending: false };
    const slots = doseSlots(med);
    const total = slots.length;
    if (iso > todayIso) return { state: 'upcoming', expected: 0, taken: 0, total, pending: true };
    const idx = logIndex(med, logs);
    const isToday = iso === todayIso;
    let taken = 0, due = 0, pending = false;
    for (const slot of slots) {
      const isTaken = idx.get(`${iso}|${slot}`) === 'taken';
      const notYet = isToday && nowHHMM && slot && slot > nowHHMM;
      if (isTaken) taken++;
      if (!notYet || isTaken) due++;
      if (notYet && !isTaken) pending = true;
    }
    let state;
    if (taken >= total) state = 'taken';
    else if (due === taken) state = taken > 0 ? 'taken' : 'upcoming'; // 지난 시각은 모두 복용, 나머지는 아직 시각 전
    else state = taken > 0 ? 'partial' : 'missed';
    return { state, expected: due, taken, total, pending };
  }

  /**
   * 현재 연속 복용일 — 복용 일정이 있는 날을 하루도 거르지 않고 모두 복용한 날의 연속 수.
   * 일정이 없는 날(격일/요일 약)은 건너뛰고 끊지 않는다. 오늘은 전부 복용했으면 포함하고,
   * 아직 못 했어도(하루가 안 끝났으므로) 연속을 끊지 않는다 — 챌린지 streak와 같은 규칙.
   */
  function currentStreak(med, logs, todayIso = todayISO(), nowHHMM = null) {
    if (!med || !med.start_date) return 0;
    let streak = 0;
    const today = medDayStatus(med, logs, todayIso, todayIso, nowHHMM);
    if (today.state === 'taken' && !today.pending) streak++;
    let cursor = addDays(todayIso, -1);
    for (let i = 0; i < 400 && cursor >= med.start_date; i++) {
      const st = medDayStatus(med, logs, cursor, todayIso, nowHHMM).state;
      if (st === 'taken') streak++;
      else if (st !== 'none') break;
      cursor = addDays(cursor, -1);
    }
    return streak;
  }

  /** 남은 수량으로 계산한 복용 가능 일수(재처방 알림용). 수량 미입력/일정 없음이면 null. */
  function daysOfSupplyLeft(med, todayIso = todayISO()) {
    if (!med || med.remaining_count == null || med.remaining_count === '') return null;
    const remaining = Number(med.remaining_count);
    if (!Number.isFinite(remaining)) return null;
    if (remaining <= 0) return 0;
    const perDay = doseSlots(med).length; // 복용 일정이 있는 날의 하루 소모량(1회 1정 가정)
    let left = remaining;
    for (let i = 0; i < 400; i++) {
      const d = addDays(todayIso, i);
      if (med.end_date && d > med.end_date) return i; // 종료일까지는 충분하다
      if (d < med.start_date || !isScheduledOn(med, d)) continue;
      left -= perDay;
      if (left <= 0) return i + 1;
    }
    return 400;
  }

  /** 오늘 복용 시각이 지났는데 아직 체크하지 않은 약(복약 알림용). */
  function overdueDosesNow(meds, logs, todayIso, nowHHMM, graceMin = 0, maxLateMin = null) {
    const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
    const out = [];
    for (const med of meds || []) {
      if (med.active === false) continue;
      const idx = logIndex(med, logs);
      if (!isScheduledOn(med, todayIso)) continue;
      for (const slot of doseSlots(med)) {
        if (!slot) continue;
        const late = toMin(nowHHMM) - toMin(slot);
        if (late < Math.max(0, graceMin)) continue; // 아직 시각 전(또는 유예 시간 이내)
        if (maxLateMin != null && late > maxLateMin) continue; // 너무 오래 지난 시각은 알리지 않는다
        if (idx.get(`${todayIso}|${slot}`)) continue;
        out.push({ med, slot });
      }
    }
    return out;
  }

  // =====================================================================
  // 일별 건강 모니터링 — 하루 단위 행 만들기 / 상태 칩 / 요약 / (조심스러운) 상관 힌트
  // =====================================================================
  const DAILY_LAST_WINS = ['weight', 'steps', 'bp_systolic', 'bp_diastolic', 'pulse', 'sleep', 'condition', 'blood_glucose', 'total_cholesterol', 'triglycerides', 'hdl'];

  /**
   * [fromIso, toIso] 각 날짜마다 지표값(하루 중 마지막 기록, 운동은 합계)과 그날 복약 상태를 한 행으로 묶는다.
   * 복약 상태는 활성(active !== false)인 약 전체를 합산한다. 복용 일정이 있는 약이 없으면 adherence는 null.
   * @returns {object[]} 오래된 날짜 → 최근 날짜 순
   */
  function buildDailyHealthRows(metrics, meds, logs, fromIso, toIso, todayIso = todayISO(), nowHHMM = null) {
    const byDay = new Map();
    for (const m of metrics || []) {
      if (!m || typeof m.value !== 'number') continue;
      const d = localDateOf(m.recorded_at);
      if (d < fromIso || d > toIso) continue;
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(m);
    }
    const activeMeds = (meds || []).filter((m) => m && m.active !== false && !m.deleted_at);
    const rows = [];
    for (let d = fromIso, guard = 0; d <= toIso && guard < 800; d = addDays(d, 1), guard++) {
      const row = { date: d, adherence: null };
      const dayMetrics = (byDay.get(d) || []).slice().sort((a, b) => String(a.recorded_at).localeCompare(String(b.recorded_at)));
      for (const key of DAILY_LAST_WINS) {
        const rowsOfType = dayMetrics.filter((m) => m.metric_type === key);
        if (rowsOfType.length) row[key] = rowsOfType[rowsOfType.length - 1].value;
      }
      const ex = dayMetrics.filter((m) => m.metric_type === 'exercise');
      if (ex.length) row.exercise = ex.reduce((s, m) => s + m.value, 0);
      const noted = dayMetrics.filter((m) => m.metric_type === 'condition' && m.note);
      if (noted.length) row.conditionNote = noted[noted.length - 1].note;
      row.systolic = row.bp_systolic;
      row.diastolic = row.bp_diastolic;

      let expected = 0, taken = 0, anyScheduled = false, anyPartialOrMissed = false, allTaken = true, pending = false;
      for (const med of activeMeds) {
        const st = medDayStatus(med, logs, d, todayIso, nowHHMM);
        if (st.state === 'none') continue;
        anyScheduled = true;
        expected += st.expected;
        taken += st.taken;
        if (st.pending) pending = true;
        if (st.state !== 'taken') { allTaken = false; if (st.state === 'partial' || st.state === 'missed') anyPartialOrMissed = true; }
      }
      if (anyScheduled) {
        let state;
        if (allTaken) state = 'taken';
        else if (!anyPartialOrMissed) state = 'upcoming';
        else state = taken > 0 ? 'partial' : 'missed';
        row.adherence = { expected, taken, state, pending };
      }
      rows.push(row);
    }
    return rows;
  }

  /**
   * 하루 종합 상태 칩. 혈압·혈당·지질 판정(bpStatus 등)과 복약, 낮은 컨디션을 합쳐
   * good(좋음) / caution(주의) / check(확인필요) / none(기록 없음) 중 하나로 낸다. 진단이 아니라 "다시 살펴볼 날" 표시다.
   * @returns {{level:'good'|'caution'|'check'|'none', label:string, reasons:string[]}}
   */
  function dailyHealthStatus(day) {
    const reasons = [];
    let sev = 0; // 0 좋음, 1 주의, 2 확인필요
    let hasData = false;
    const bump = (level, reason) => { sev = Math.max(sev, level); reasons.push(reason); };
    const fromStatus = (st, name) => {
      if (!st) return;
      hasData = true;
      if (st.level === 'critical') bump(2, `${name} ${st.label}`);
      else if (st.level === 'warning') bump(1, `${name} ${st.label}`);
    };
    const sys = day.systolic != null ? day.systolic : day.bp_systolic;
    const dia = day.diastolic != null ? day.diastolic : day.bp_diastolic;
    fromStatus(bpStatus(sys, dia), '혈압');
    fromStatus(glucoseStatus(day.blood_glucose), '혈당');
    fromStatus(cholesterolStatus('total_cholesterol', day.total_cholesterol), '총콜레스테롤');
    fromStatus(cholesterolStatus('triglycerides', day.triglycerides), '중성지방');
    fromStatus(cholesterolStatus('hdl', day.hdl), 'HDL');
    if (day.condition != null) {
      hasData = true;
      if (day.condition <= 2) bump(1, `컨디션 낮음(${day.condition}/5)`);
    }
    for (const k of ['weight', 'steps', 'sleep', 'pulse', 'exercise']) if (day[k] != null) hasData = true;
    const a = day.adherence;
    if (a && a.expected > 0) {
      hasData = true;
      if (a.state === 'missed') bump(2, '복약 놓침');
      else if (a.state === 'partial') bump(1, '복약 일부 놓침');
    } else if (a && a.state === 'taken') {
      hasData = true;
    }
    if (!hasData) return { level: 'none', label: '기록 없음', reasons: [] };
    if (sev >= 2) return { level: 'check', label: '확인필요', reasons };
    if (sev === 1) return { level: 'caution', label: '주의', reasons };
    return { level: 'good', label: '좋음', reasons };
  }

  /**
   * 최근 구간 요약 숫자들. 문장 조립은 화면(health.js)이 한다.
   * @returns {{days:number, adherence:{expected:number,taken:number,rate:number|null}, bp:{days:number, normalDays:number}, weightDelta:number|null, goodDays:number, checkDays:number}}
   */
  function summarizeDailyRows(rows) {
    let expected = 0, taken = 0, bpDays = 0, bpNormal = 0, goodDays = 0, checkDays = 0;
    let firstW = null, lastW = null;
    for (const r of rows) {
      if (r.adherence && r.adherence.expected > 0) { expected += r.adherence.expected; taken += r.adherence.taken; }
      const st = bpStatus(r.systolic, r.diastolic);
      if (st) { bpDays++; if (st.level === 'success') bpNormal++; }
      const ds = dailyHealthStatus(r);
      if (ds.level === 'good') goodDays++;
      if (ds.level === 'check') checkDays++;
      if (r.weight != null) { if (firstW == null) firstW = r.weight; lastW = r.weight; }
    }
    return {
      days: rows.length,
      adherence: { expected, taken, rate: expected ? Math.round((taken / expected) * 100) : null },
      bp: { days: bpDays, normalDays: bpNormal },
      weightDelta: firstW != null && lastW != null && rows.filter((r) => r.weight != null).length >= 2 ? Number((lastW - firstW).toFixed(1)) : null,
      goodDays,
      checkDays,
    };
  }

  /**
   * 복약과 혈압의 "같은 날" 비교 힌트. 오해를 막기 위해 매우 보수적으로 낸다:
   * 복약을 모두 한 날과 그렇지 않은 날 각각 혈압 기록이 minDays일 이상이고, 수축기 평균 차이가 minDiff(mmHg) 이상일 때만 반환.
   * 그 외에는 null(힌트 없음). 인과관계가 아니며 표본이 작아 우연일 수 있다 — 화면에서 표본 수와 면책 문구를 함께 보여준다.
   * @returns {{adherentDays:number, otherDays:number, adherentAvg:number, otherAvg:number, diff:number}|null}
   */
  function adherenceBpHint(rows, minDays = 5, minDiff = 5) {
    const a = [], o = [];
    for (const r of rows) {
      if (r.systolic == null || !r.adherence || !(r.adherence.expected > 0)) continue;
      if (r.adherence.state === 'taken') a.push(r.systolic);
      else if (r.adherence.state === 'partial' || r.adherence.state === 'missed') o.push(r.systolic);
    }
    if (a.length < minDays || o.length < minDays) return null;
    const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const aa = avg(a), oa = avg(o);
    if (Math.abs(aa - oa) < minDiff) return null;
    return { adherentDays: a.length, otherDays: o.length, adherentAvg: Number(aa.toFixed(1)), otherAvg: Number(oa.toFixed(1)), diff: Number((oa - aa).toFixed(1)) };
  }

  /**
   * 대시보드 카드의 "목표 대비" 문구. 목표가 있으면 "목표 대비 +2.3kg", 정상 범위(band)가 있으면
   * "정상 범위(90–119) 안" 또는 "정상 범위 상한 대비 +4mmHg"처럼 사실만 서술한다(좋다/나쁘다 판단은 하지 않는다).
   * @returns {{text:string, delta:number|null, inBand:boolean|null}}
   */
  function describeTargetGap(value, target, unit = '', band = null) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return { text: '', delta: null, inBand: null };
    const fmt = (n) => String(Number(Math.abs(n).toFixed(1)));
    const sign = (n) => (n > 0 ? '+' : n < 0 ? '-' : '');
    const parts = [];
    let delta = null, inBand = null;
    if (typeof target === 'number' && Number.isFinite(target)) {
      delta = Number((value - target).toFixed(1));
      parts.push(delta === 0 ? `목표와 같음(${fmt(target)}${unit})` : `목표 대비 ${sign(delta)}${fmt(delta)}${unit}`);
    }
    if (band && typeof band.min === 'number' && typeof band.max === 'number') {
      if (value > band.max) { inBand = false; parts.push(`정상 범위(${band.min}–${band.max}) 상한 대비 +${fmt(value - band.max)}${unit}`); }
      else if (value < band.min) { inBand = false; parts.push(`정상 범위(${band.min}–${band.max}) 하한 대비 -${fmt(band.min - value)}${unit}`); }
      else { inBand = true; parts.push(`정상 범위(${band.min}–${band.max}) 안`); }
    }
    return { text: parts.join(' · '), delta, inBand };
  }

  // =====================================================================
  // v7.20.0 — 일정(구분/장소/"N일 후" 반복) · D-day · 챌린지 주간 알약(요일 칩)
  // 모두 "ISO 날짜 문자열(YYYY-MM-DD)"만 다룬다. Date.UTC 기반 일수 계산이라 실행 환경의 시간대(TZ)나
  // 서머타임에 영향받지 않는다(한국 시간 오전 기록이 하루 밀리던 예전 버그와 같은 종류의 문제를 피하기 위함).
  // =====================================================================
  function isoDayNum(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return NaN;
    return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000);
  }
  function dayNumIso(n) {
    const d = new Date(n * 86400000);
    return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  /** iso 날짜에서 n일 뒤(음수면 앞)의 ISO 날짜. 월말·윤년·연말을 달력대로 넘긴다. */
  function shiftIso(iso, n) { return dayNumIso(isoDayNum(iso) + n); }
  /** b - a (일). */
  function isoDiff(a, b) { return isoDayNum(b) - isoDayNum(a); }
  /** ISO 요일: 1=월 … 7=일 (1970-01-01은 목요일). */
  function isoWeekday(iso) { return ((((isoDayNum(iso) + 3) % 7) + 7) % 7) + 1; }
  function isLeapYear(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function isValidIso(iso) { return /^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')) && dayNumIso(isoDayNum(iso)) === iso; }

  // ---- 일정: 구분(category) ----
  const SCHEDULE_CATEGORIES = ['개인', '회사', '가족', '업무', '기타'];
  const DEFAULT_SCHEDULE_CATEGORY = '기타';
  function normalizeScheduleCategory(c) { return SCHEDULE_CATEGORIES.includes(c) ? c : DEFAULT_SCHEDULE_CATEGORY; }
  /** 검색어 q가 일정의 제목/메모/장소/구분(라벨)/태그 중 하나라도 포함하는지. */
  function scheduleMatchesQuery(s, q) {
    const needle = String(q || '').trim().toLowerCase();
    if (!needle) return true;
    const hay = [s.title, s.memo, s.place, normalizeScheduleCategory(s.category), ...(s.tags || [])];
    return hay.some((v) => String(v || '').toLowerCase().includes(needle));
  }


  // ---- 일정: 기간(시작일~종료일) + 구분 이모지 + 달력 막대 배치 (v7.23.0) ----
  const SCHEDULE_CATEGORY_EMOJI = { 개인: '🧑', 회사: '🏢', 가족: '👪', 업무: '💼', 기타: '📌' };
  function scheduleCategoryEmoji(c) { return SCHEDULE_CATEGORY_EMOJI[normalizeScheduleCategory(c)]; }
  const MAX_SCHEDULE_SPAN_DAYS = 366;
  /** 종료일(없거나 시작일 이하이면 시작일 = 하루 일정). */
  function scheduleEnd(s) { return s && s.end_date && s.end_date > s.date ? s.end_date : s && s.date; }
  function isMultiDaySchedule(s) { return !!s && scheduleEnd(s) !== s.date; }
  /** 기간 일수(양 끝 포함). 하루 일정 = 1. */
  function scheduleSpanDays(s) { return isoDiff(s.date, scheduleEnd(s)) + 1; }
  function scheduleCoversDate(s, iso) { return !!s && iso >= s.date && iso <= scheduleEnd(s); }
  /** 그 날짜에서 막대의 위치: single | start | mid | end (기간 밖이면 null). */
  function schedulePosition(s, iso) {
    if (!scheduleCoversDate(s, iso)) return null;
    if (!isMultiDaySchedule(s)) return 'single';
    if (iso === s.date) return 'start';
    if (iso === scheduleEnd(s)) return 'end';
    return 'mid';
  }
  /** 사람이 읽는 기간 표기: "10/7(수)" 또는 "10/7(수) ~ 10/9(금) · 3일간" */
  function scheduleRangeLabel(s) {
    const fmt = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}(${['월', '화', '수', '목', '금', '토', '일'][isoWeekday(iso) - 1]})`;
    if (!isMultiDaySchedule(s)) return fmt(s.date);
    return `${fmt(s.date)} ~ ${fmt(scheduleEnd(s))} · ${scheduleSpanDays(s)}일간`;
  }
  /** 입력값 검증: 종료일이 시작일보다 앞서거나 너무 길면 이유를 돌려준다(정상이면 null). */
  function validateScheduleRange(date, endDate) {
    if (!endDate) return null;
    if (!isValidIso(endDate)) return '종료일 형식이 올바르지 않습니다.';
    if (endDate < date) return '종료일은 시작일보다 빠를 수 없어요.';
    if (isoDiff(date, endDate) + 1 > MAX_SCHEDULE_SPAN_DAYS) return `기간은 최대 ${MAX_SCHEDULE_SPAN_DAYS}일까지 등록할 수 있어요.`;
    return null;
  }
  /**
   * 달력 격자(gridStart~gridEnd)에 일정을 "줄(lane)"에 맞춰 배치한다. 기간 일정은 모든 날짜 칸에서 같은 줄에 놓여 막대가 이어진다.
   * @returns {Object<string,Array<{s:object,pos:string}|null>>} 날짜 → 줄 번호 순서의 배열(빈 줄은 null)
   */
  function buildCalendarLanes(schedules, gridStart, gridEnd) {
    const items = (schedules || []).filter((s) => s && s.date && scheduleEnd(s) >= gridStart && s.date <= gridEnd)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
        || scheduleSpanDays(b) - scheduleSpanDays(a)
        || String(a.time || '').localeCompare(String(b.time || ''))
        || String(a.id || a.title).localeCompare(String(b.id || b.title)));
    const lanes = []; // lane -> Set(iso)
    const byDate = {};
    for (const s of items) {
      const from = s.date < gridStart ? gridStart : s.date;
      const to = scheduleEnd(s) > gridEnd ? gridEnd : scheduleEnd(s);
      const days = [];
      for (let d = from; d <= to; d = shiftIso(d, 1)) days.push(d);
      let lane = lanes.findIndex((set) => days.every((d) => !set.has(d)));
      if (lane < 0) { lane = lanes.length; lanes.push(new Set()); }
      for (const d of days) {
        lanes[lane].add(d);
        if (!byDate[d]) byDate[d] = [];
        byDate[d][lane] = { s, pos: schedulePosition(s, d) };
      }
    }
    for (const d of Object.keys(byDate)) for (let i = 0; i < byDate[d].length; i++) if (!byDate[d][i]) byDate[d][i] = null;
    return byDate;
  }

  // ---- 일정: "N일 후" 반복/알림 ----
  const MAX_REPEAT_OFFSETS = 10;
  const MAX_OFFSET_DAYS = 365;
  /**
   * 사용자가 입력한 문자열("5, 7", "5일 후 and 7일 후") 또는 배열에서 "N일 후" 값 목록을 뽑는다.
   * 1~365의 정수만 받고, 중복은 합치며 오름차순으로 정렬하고 최대 10개까지만 남긴다.
   * @returns {{offsets:number[], invalid:string[], truncated:boolean}}
   */
  function parseOffsets(input) {
    const tokens = Array.isArray(input) ? input.map(String) : (String(input || '').match(/\d+(?:\.\d+)?/g) || []);
    const set = new Set();
    const invalid = [];
    for (const t of tokens) {
      const n = Number(t);
      if (!Number.isInteger(n) || n < 1 || n > MAX_OFFSET_DAYS) invalid.push(String(t));
      else set.add(n);
    }
    let offsets = Array.from(set).sort((a, b) => a - b);
    const truncated = offsets.length > MAX_REPEAT_OFFSETS;
    if (truncated) offsets = offsets.slice(0, MAX_REPEAT_OFFSETS);
    return { offsets, invalid, truncated };
  }
  function offsetDate(baseIso, n) { return shiftIso(baseIso, n); }
  function childScheduleTitle(title, n) { return `${title} (${n}일 후)`; }
  const SCHEDULE_SYNC_FIELDS = ['title', 'date', 'end_date', 'time', 'place', 'category', 'priority', 'project_id', 'tags', 'memo'];

  /** 부모 일정에서 "N일 후" 자식 일정 한 건의 필드를 만든다(완료 여부·중요 표시는 물려주지 않는다). */
  function childScheduleFields(parent, n) {
    return {
      title: childScheduleTitle(parent.title, n),
      date: offsetDate(parent.date, n),
      end_date: parent.end_date && parent.end_date > parent.date ? offsetDate(parent.end_date, n) : null,
      time: parent.time || null,
      place: parent.place || null,
      category: normalizeScheduleCategory(parent.category),
      priority: parent.priority || 'medium',
      project_id: parent.project_id || null,
      tags: (parent.tags || []).slice(),
      memo: parent.memo || null,
      parent_schedule_id: parent.id,
      offset_days: n,
      is_generated: true,
    };
  }
  function sameFieldValue(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a || []) === JSON.stringify(b || []);
    return (a ?? null) === (b ?? null) || (a === '' && b == null) || (a == null && b === '');
  }
  /**
   * 부모의 repeat_offsets와 현재 자식 목록을 비교해 "달라진 것만" 만들/고칠/지울 목록을 낸다(멱등).
   * 같은 값으로 다시 호출하면 {create:[], update:[], remove:[]}가 나온다.
   * @param {object} parent 필수: id,title,date,repeat_offsets
   * @param {object[]} children parent_schedule_id === parent.id 인 행들(offset_days 보유)
   */
  function planScheduleChildren(parent, children) {
    const { offsets } = parseOffsets(parent.repeat_offsets || []);
    const keep = new Map(); // offset -> child
    const remove = [];
    const sorted = (children || []).slice().sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id)));
    for (const c of sorted) {
      if (offsets.includes(c.offset_days) && !keep.has(c.offset_days)) keep.set(c.offset_days, c);
      else remove.push(c.id);
    }
    const create = [];
    const update = [];
    for (const n of offsets) {
      const want = childScheduleFields(parent, n);
      const cur = keep.get(n);
      if (!cur) { create.push(want); continue; }
      const patch = {};
      for (const f of SCHEDULE_SYNC_FIELDS) if (!sameFieldValue(cur[f], want[f])) patch[f] = want[f];
      if (Object.keys(patch).length) update.push({ id: cur.id, patch });
    }
    return { create, update, remove };
  }

  // ---- D-day ----
  const MAX_DDAYS = 5;
  /**
   * D-day 계산. 오늘이면 "D-Day", 남았으면 "D-12", 지났으면 "D+3".
   * repeatYearly(매년 반복, 기념일)이면 올해(또는 내년)의 가장 가까운 기념일 기준이고, 기념일 당일이 지나면 곧바로 다음 해로 넘어간다.
   * 윤일(2월 29일) 기념일은 평년에는 2월 28일에 맞춘다. 목표일이 미래이면 반복이어도 첫 기념일은 목표일 자체다.
   * @returns {{days:number, text:string, date:string, isToday:boolean, isPast:boolean, anniversary:number|null}}
   */
  function ddayInfo(targetIso, todayIso, repeatYearly = false) {
    let occ = targetIso;
    let anniversary = null;
    if (repeatYearly) {
      const [ty, tm, td] = String(targetIso).split('-').map(Number);
      const cy = Number(String(todayIso).slice(0, 4));
      const occFor = (y) => (tm === 2 && td === 29 && !isLeapYear(y)
        ? `${String(y).padStart(4, '0')}-02-28`
        : `${String(y).padStart(4, '0')}-${String(tm).padStart(2, '0')}-${String(td).padStart(2, '0')}`);
      let y = Math.max(cy, ty);
      let c = occFor(y);
      if (c < todayIso) { y += 1; c = occFor(y); }
      occ = c;
      anniversary = y - ty > 0 ? y - ty : null;
    }
    const days = isoDiff(todayIso, occ);
    const text = days === 0 ? 'D-Day' : days > 0 ? `D-${days}` : `D+${-days}`;
    return { days, text, date: occ, isToday: days === 0, isPast: days < 0, anniversary };
  }
  function ddayLabel(targetIso, todayIso, repeatYearly = false) { return ddayInfo(targetIso, todayIso, repeatYearly).text; }
  /** D-day 목록을 "가장 가까운 순"으로: 오늘/남은 날 오름차순 → 이미 지난(D+N) 것은 뒤로. */
  function sortDdays(rows, todayIso) {
    return (rows || []).slice().sort((a, b) => {
      const da = ddayInfo(a.target_date, todayIso, !!a.repeat_yearly).days;
      const db = ddayInfo(b.target_date, todayIso, !!b.repeat_yearly).days;
      const ka = da >= 0 ? 0 : 1; const kb = db >= 0 ? 0 : 1;
      return ka - kb || (ka === 0 ? da - db : db - da);
    });
  }

  // ---- 챌린지: 이번 주(월~일) 알약 7칸 ----
  const WEEK_LABELS_KO = ['월', '화', '수', '목', '금', '토', '일'];
  const FREQ_LABEL = { daily: '매일', weekdays: '요일 지정', times_per_week: '주 N회' };
  /** '1,3,5'(1=월…7=일) → Set<number> */
  function parseFreqDays(csv) {
    const out = new Set();
    for (const t of String(csv || '').split(',')) { const n = Number(t.trim()); if (Number.isInteger(n) && n >= 1 && n <= 7) out.add(n); }
    return out;
  }
  /**
   * 이번 주(월요일 시작) 7칸의 상태.
   *  - done: 그날 체크인함(밝은 채움 ✓)            - missed: 지난 날인데 해야 했는데 안 함(붉은 계열 ✕)
   *  - today: 오늘, 아직 안 함(강조 윤곽)             - future: 아직 오지 않은 날(흐린 중립)
   *  - rest: 이 챌린지가 쉬는 날(요일 지정에서 빠진 요일, 주 N회의 지난 미체크 날) — 빨강으로 보이지 않는다
   *  - inactive: 시작일 이전 / 종료일 이후(해당 없음)
   * canToggle: 오늘 또는 지난 날이면서 기간 안(또는 이미 체크된 날)이라 눌러서 체크/해제할 수 있는지.
   * @returns {{weekStart:string, weekEnd:string, cells:{date:string,label:string,state:string,canToggle:boolean,isToday:boolean}[], doneCount:number, targetCount:number, missedCount:number, pct:number}}
   */
  function weekPills(challenge, checkins, todayIso) {
    const weekStart = shiftIso(todayIso, -(isoWeekday(todayIso) - 1));
    const doneDates = new Set((checkins || []).map((c) => c.checkin_date));
    const start = (challenge && challenge.start_date) || null;
    const end = (challenge && challenge.end_date) || null;
    const freq = (challenge && challenge.freq_type) || 'daily';
    const days = parseFreqDays(challenge && challenge.freq_days);
    const cells = [];
    let doneCount = 0, missedCount = 0, activeDays = 0, scheduledDays = 0;
    for (let i = 0; i < 7; i++) {
      const date = shiftIso(weekStart, i);
      const inRange = (!start || date >= start) && (!end || date <= end);
      const isDone = doneDates.has(date);
      const restDay = freq === 'weekdays' && !days.has(i + 1);
      let state;
      if (isDone) state = 'done';
      else if (!inRange) state = 'inactive';
      else if (restDay) state = 'rest';
      else if (date > todayIso) state = 'future';
      else if (date === todayIso) state = 'today';
      else state = freq === 'times_per_week' ? 'rest' : 'missed';
      if (isDone) doneCount++;
      if (state === 'missed') missedCount++;
      if (inRange) { activeDays++; if (!restDay) scheduledDays++; }
      cells.push({ date, label: WEEK_LABELS_KO[i], state, isToday: date === todayIso, canToggle: date <= todayIso && (inRange || isDone) });
    }
    let targetCount;
    if (freq === 'times_per_week') targetCount = Math.min(Math.max(1, Number(challenge.freq_times) || 1), activeDays);
    else targetCount = scheduledDays;
    const pct = targetCount > 0 ? Math.min(100, Math.round((doneCount / targetCount) * 100)) : 0;
    return { weekStart, weekEnd: shiftIso(weekStart, 6), cells, doneCount, targetCount, missedCount, pct };
  }

  globalThis.isoDayNum = isoDayNum;
  globalThis.shiftIso = shiftIso;
  globalThis.isoDiff = isoDiff;
  globalThis.isoWeekday = isoWeekday;
  globalThis.isLeapYear = isLeapYear;
  globalThis.isValidIso = isValidIso;
  globalThis.SCHEDULE_CATEGORIES = SCHEDULE_CATEGORIES;
  globalThis.normalizeScheduleCategory = normalizeScheduleCategory;
  globalThis.scheduleMatchesQuery = scheduleMatchesQuery;
  globalThis.SCHEDULE_CATEGORY_EMOJI = SCHEDULE_CATEGORY_EMOJI;
  globalThis.scheduleCategoryEmoji = scheduleCategoryEmoji;
  globalThis.scheduleEnd = scheduleEnd;
  globalThis.isMultiDaySchedule = isMultiDaySchedule;
  globalThis.scheduleSpanDays = scheduleSpanDays;
  globalThis.scheduleCoversDate = scheduleCoversDate;
  globalThis.schedulePosition = schedulePosition;
  globalThis.scheduleRangeLabel = scheduleRangeLabel;
  globalThis.validateScheduleRange = validateScheduleRange;
  globalThis.buildCalendarLanes = buildCalendarLanes;
  globalThis.MAX_REPEAT_OFFSETS = MAX_REPEAT_OFFSETS;
  globalThis.MAX_OFFSET_DAYS = MAX_OFFSET_DAYS;
  globalThis.parseOffsets = parseOffsets;
  globalThis.offsetDate = offsetDate;
  globalThis.childScheduleTitle = childScheduleTitle;
  globalThis.childScheduleFields = childScheduleFields;
  globalThis.planScheduleChildren = planScheduleChildren;
  globalThis.SCHEDULE_SYNC_FIELDS = SCHEDULE_SYNC_FIELDS;
  globalThis.MAX_DDAYS = MAX_DDAYS;
  globalThis.ddayInfo = ddayInfo;
  globalThis.ddayLabel = ddayLabel;
  globalThis.sortDdays = sortDdays;
  globalThis.FREQ_LABEL = FREQ_LABEL;
  globalThis.parseFreqDays = parseFreqDays;
  globalThis.weekPills = weekPills;
  globalThis.predictProjectCompletion = predictProjectCompletion;
  globalThis.predictScheduleDensity = predictScheduleDensity;
  globalThis.predictNextMaintenance = predictNextMaintenance;
  globalThis.calcFuelEfficiency = calcFuelEfficiency;
  globalThis.predictWeeklyExerciseGoal = predictWeeklyExerciseGoal;
  globalThis.computeChallengeStreak = computeChallengeStreak;
  globalThis.computeMissStreak = computeMissStreak;
  globalThis.aggregateMetricTrend = aggregateMetricTrend;
  globalThis.cholesterolStatus = cholesterolStatus;
  globalThis.bpStatus = bpStatus;
  globalThis.glucoseStatus = glucoseStatus;
  globalThis.BP_RANGES = BP_RANGES;
  globalThis.localDateOf = localDateOf;
  globalThis.parseDoseTimes = parseDoseTimes;
  globalThis.doseSlots = doseSlots;
  globalThis.parseWeekdays = parseWeekdays;
  globalThis.isScheduledOn = isScheduledOn;
  globalThis.expectedDoses = expectedDoses;
  globalThis.adherenceRate = adherenceRate;
  globalThis.missedDoses = missedDoses;
  globalThis.medDayStatus = medDayStatus;
  globalThis.currentStreak = currentStreak;
  globalThis.daysOfSupplyLeft = daysOfSupplyLeft;
  globalThis.overdueDosesNow = overdueDosesNow;
  globalThis.buildDailyHealthRows = buildDailyHealthRows;
  globalThis.dailyHealthStatus = dailyHealthStatus;
  globalThis.summarizeDailyRows = summarizeDailyRows;
  globalThis.adherenceBpHint = adherenceBpHint;
  globalThis.describeTargetGap = describeTargetGap;
})();
