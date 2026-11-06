// v7.33.0 주간 활동 요약 브리핑. 매주 금요일 오전 9시(KST) 이후 처음 앱을 열 때 생성·저장하고 알려 준다.
// (서버 푸시가 아니라 "앱을 연 시점"에 만드는 방식 — 금요일 이후에 열어도 지난 금요일 분을 보충한다.)
// 순수 계산(build/targetWeek)과 저장(ensure)을 분리. 일반 <script> + CommonJS 겸용.
(function () {
  const RC = (typeof window !== 'undefined' && window.RoutineCalc) || (typeof require !== 'undefined' ? require('../utils/routineCalc.js') : null);
  const KST = 9 * 3600 * 1000;
  const iso = (d) => d.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const dow = (s) => { const g = new Date(s + 'T00:00:00Z').getUTCDay(); return g === 0 ? 7 : g; };
  const mondayOf = (s) => addDays(s, -(dow(s) - 1));
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const loc = (v) => (RC ? RC.localDate(v) : String(v || '').slice(0, 10));

  /** 지금 기준으로 "9시가 지난 가장 최근 금요일" 날짜와 그 주 월요일. */
  function targetWeek(now = new Date()) {
    const k = new Date(now.getTime() + KST);
    let d = iso(k);
    const pastNine = k.getUTCHours() >= 9;
    // 가장 가까운 지난(또는 오늘 9시 이후) 금요일
    let back = (dow(d) - 5 + 7) % 7;
    if (back === 0 && !pastNine) back = 7;
    const friday = addDays(d, -back);
    return { friday, weekStart: mondayOf(friday), weekEnd: addDays(mondayOf(friday), 6) };
  }

  /** 금요일 오전 9시 이후이거나(이번 주 금요일), 지난주 분이 비어 있을 때를 판단하기 위한 보조. */
  function shouldGenerate(existingWeekStarts, now = new Date()) {
    const t = targetWeek(now);
    return { due: !existingWeekStarts.includes(t.weekStart), ...t };
  }

  const inRange = (d, a, b) => d >= a && d <= b;

  /** 한 주 요약 내용(JSON 저장용)을 만든다. 상태 객체는 appState 모양. */
  function build(state, { weekStart, friday }) {
    const end = addDays(weekStart, 6);
    const prevStart = addDays(weekStart, -7), prevEnd = addDays(weekStart, -1);
    const days = (a, b, list, key) => list.filter((x) => !x.deleted_at && inRange(loc(x[key]), a, b));
    const sch = (state.schedules || []).filter((s) => !s.deleted_at && inRange(String(s.date).slice(0, 10), weekStart, end));
    const schDone = sch.filter((s) => s.done).length;
    const health = days(weekStart, end, state.healthMetrics || [], 'recorded_at');
    const healthPrev = days(prevStart, prevEnd, state.healthMetrics || [], 'recorded_at');
    const dev = days(weekStart, end, state.devlogs || [], 'logged_at');
    const chk = (state.challengeCheckins || []).filter((c) => inRange(loc(c.checkin_date), weekStart, end));

    // 루틴: 주 안에서 해당 일정 대비 완료율
    const routines = [];
    if (RC) {
      for (const r of (state.routines || []).filter((x) => !x.deleted_at && x.active !== false)) {
        const done = RC.doneSet(r, state.routineLogs || [], state);
        let due = 0, ok = 0;
        if (['daily', 'weekdays', 'monthly'].includes(r.cadence)) {
          for (let d = weekStart; d <= friday; d = addDays(d, 1)) { if (d < String(r.start_date || d).slice(0, 10)) continue; if (RC.isScheduled(r, d)) { due++; if (done.has(d)) ok++; } }
        } else if (r.cadence === 'weekly') {
          due = Math.max(1, Number(r.times_per_week) || 1);
          for (let d = weekStart; d <= end; d = addDays(d, 1)) if (done.has(d)) ok++;
          ok = Math.min(ok, due);
        } else { for (let d = weekStart; d <= friday; d = addDays(d, 1)) if (done.has(d)) ok++; due = Math.max(ok, 1); }
        if (due) routines.push({ title: r.title, due, done: ok, rate: Math.round((ok / due) * 100) });
      }
    }
    routines.sort((a, b) => a.rate - b.rate);
    const rDue = routines.reduce((s, x) => s + x.due, 0), rDone = routines.reduce((s, x) => s + x.done, 0);

    // 자산: 주 마지막 기록 vs 직전 주 마지막 기록
    const snaps = [...(state.assetSnapshots || [])].sort((a, b) => (a.snap_date < b.snap_date ? -1 : 1));
    const lastIn = [...snaps].reverse().find((s) => s.snap_date <= end && s.snap_date >= weekStart);
    const lastPrev = [...snaps].reverse().find((s) => s.snap_date < weekStart);
    const asset = lastIn ? { value: num(lastIn.total_value), date: lastIn.snap_date, diff: lastPrev ? num(lastIn.total_value) - num(lastPrev.total_value) : null, rate: lastPrev && num(lastPrev.total_value) ? ((num(lastIn.total_value) - num(lastPrev.total_value)) / num(lastPrev.total_value)) * 100 : null } : null;

    // 다음 주 예고: 일정 건수 + 2주 내 프로젝트 마감
    const nextStart = addDays(weekStart, 7), nextEnd = addDays(weekStart, 13);
    const nextSch = (state.schedules || []).filter((s) => !s.deleted_at && !s.done && inRange(String(s.date).slice(0, 10), nextStart, nextEnd))
      .sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 5).map((s) => ({ date: s.date, title: s.title }));
    const deadlines = (state.projects || []).filter((p) => !p.deleted_at && p.status === 'in_progress' && p.deadline && p.deadline >= friday && p.deadline <= addDays(friday, 14))
      .map((p) => ({ name: p.name, deadline: p.deadline })).sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 5);

    // 한 줄 코멘트(규칙 기반 — 숫자로만 판단)
    const notes = [];
    if (rDue && rDone / rDue < 0.6) notes.push(`루틴 달성률이 ${Math.round((rDone / rDue) * 100)}%로 낮았어요. 가장 못 한 항목: ${routines[0].title}`);
    else if (rDue && rDone / rDue >= 0.9) notes.push('루틴을 거의 다 지킨 주였어요 👏');
    if (sch.length && schDone < sch.length) notes.push(`완료 처리 안 된 일정 ${sch.length - schDone}건이 있어요.`);
    if (!health.length && healthPrev.length) notes.push('이번 주 건강 기록이 없어요(지난주에는 있었어요).');
    if (asset && asset.rate !== null && Math.abs(asset.rate) >= 3) notes.push(`자산이 지난주 대비 ${asset.rate > 0 ? '+' : ''}${asset.rate.toFixed(1)}% 움직였어요.`);
    if (deadlines.length) notes.push(`2주 내 마감 프로젝트 ${deadlines.length}건(가장 가까운 것: ${deadlines[0].name} ${deadlines[0].deadline}).`);

    return {
      version: 1, weekStart, weekEnd: end, friday,
      schedules: { total: sch.length, done: schDone },
      health: { count: health.length, prev: healthPrev.length },
      devlog: { count: dev.length },
      challenge: { checkins: chk.length },
      routines: { due: rDue, done: rDone, rate: rDue ? Math.round((rDone / rDue) * 100) : null, items: routines.slice(0, 8) },
      asset, next: { schedules: nextSch, deadlines }, notes,
    };
  }

  let running = false;
  /** 앱을 열 때 호출. 새로 만들었으면 그 행을 반환(로그인 팝업에서 보여줌). */
  async function ensure({ now = new Date() } = {}) {
    const st = window.appState;
    if (running || !st || !st.user) return null;
    running = true;
    try {
      const t = shouldGenerate((st.weeklyBriefings || []).map((r) => r.week_start), now);
      if (!t.due) return null;
      const hasAny = (st.schedules || []).length + (st.devlogs || []).length + (st.healthMetrics || []).length + (st.routines || []).length;
      if (!hasAny) return null;
      const content = build(st, t);
      await st.saveWeeklyBriefing(t.weekStart, content);
      return { week_start: t.weekStart, content, isNew: true };
    } catch (e) {
      console.warn('주간 브리핑 생성 건너뜀:', e && e.message);
      return null;
    } finally { running = false; }
  }

  const api = { targetWeek, shouldGenerate, build, ensure };
  if (typeof window !== 'undefined') window.WeeklyBriefing = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
