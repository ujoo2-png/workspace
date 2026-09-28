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
    const recent = (exerciseMetrics || []).filter((m) => (m.recorded_at || '').slice(0, 10) >= since);
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

  globalThis.predictProjectCompletion = predictProjectCompletion;
  globalThis.predictScheduleDensity = predictScheduleDensity;
  globalThis.predictNextMaintenance = predictNextMaintenance;
  globalThis.calcFuelEfficiency = calcFuelEfficiency;
  globalThis.predictWeeklyExerciseGoal = predictWeeklyExerciseGoal;
  globalThis.computeChallengeStreak = computeChallengeStreak;
  globalThis.computeMissStreak = computeMissStreak;
})();
