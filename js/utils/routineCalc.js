// 루틴(반복 할 일) 계산 — 순수 함수(DOM·네트워크 없음, 단위 테스트 대상). v7.33.0
// 날짜는 'YYYY-MM-DD' 문자열, 요일은 월=1 … 일=7(챌린저 freq_days와 동일).
//
// cadence:
//   daily    매일                      weekdays 지정한 요일마다(weekdays='1,3,5')
//   weekly   주 N회(요일 상관없음)      monthly  매달 시작일의 '일'에
//   interval N일마다(마지막 수행일 기준)
// "미진(overdue)": 정해진 날(daily/weekdays/monthly)을 최근 7일 안에 놓침 · 주 N회가 남은 날수로 달성 불가 · interval을 넘겨 늦음.
(function (root) {
  'use strict';
  const MS = 86400000;
  const toUtc = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const fromUtc = (t) => new Date(t).toISOString().slice(0, 10);
  const addDays = (iso, n) => fromUtc(toUtc(iso) + n * MS);
  const diffDays = (a, b) => Math.round((toUtc(a) - toUtc(b)) / MS); // a - b
  const dow = (iso) => { const d = new Date(toUtc(iso)).getUTCDay(); return d === 0 ? 7 : d; };
  const weekStart = (iso) => addDays(iso, 1 - dow(iso));
  const daysInMonth = (iso) => { const [y, m] = iso.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
  const parseDays = (s) => new Set(String(s || '').split(',').map((x) => Number(x.trim())).filter((n) => n >= 1 && n <= 7));
  // 타임스탬프(UTC ISO)는 사용자의 로컬 날짜로 바꿔 비교한다(한국 오전 기록이 전날로 밀리지 않게).
  const localDate = (v) => {
    const s = String(v || ''); if (!s) return '';
    if (s.length === 10) return s;
    const d = new Date(s); if (Number.isNaN(d.getTime())) return s.slice(0, 10);
    const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  function isScheduled(r, iso) {
    if (iso < String(r.start_date || '0000-00-00').slice(0, 10)) return false;
    switch (r.cadence) {
      case 'daily': return true;
      case 'weekdays': return parseDays(r.weekdays).has(dow(iso));
      case 'monthly': { const sd = Number(String(r.start_date || iso).slice(8, 10)) || 1; return Number(iso.slice(8, 10)) === Math.min(sd, daysInMonth(iso)); }
      default: return false;
    }
  }

  /** 자동 완료: 다른 메뉴의 기록으로 "했다"고 볼 수 있는 날짜 집합. */
  function autoDates(r, state) {
    const out = new Set(); const src = String(r.auto_source || ''); if (!src || !state) return out;
    if (src === 'health' || src.startsWith('health:')) { const t = src.split(':')[1]; for (const m of state.healthMetrics || []) if (!m.deleted_at && (!t || m.metric_type === t)) out.add(localDate(m.recorded_at)); }
    else if (src === 'devlog') { for (const d of state.devlogs || []) if (!d.deleted_at) out.add(localDate(d.logged_at)); }
    else if (src.startsWith('challenge:')) { const id = src.slice(10); for (const c of state.challengeCheckins || []) if (c.challenge_id === id) out.add(localDate(c.checkin_date)); }
    else if (src === 'stocks') { for (const s of state.assetSnapshots || []) out.add(localDate(s.snap_date)); }
    return out;
  }
  function doneSet(r, logs, state) {
    const s = new Set(); for (const l of logs || []) if (l.routine_id === r.id) s.add(localDate(l.log_date));
    for (const d of autoDates(r, state)) s.add(d);
    return s;
  }

  function evaluate(r, done, today) {
    const start = String(r.start_date || today).slice(0, 10);
    const base = { routine: r, dueToday: false, doneToday: done.has(today), overdueCount: 0, missedDates: [], streak: 0, rate30: null, nextDue: null, state: 'ok', note: '' };
    if (r.active === false || r.deleted_at) return { ...base, state: 'paused' };
    if (today < start) return { ...base, state: 'upcoming', nextDue: start };
    if (['daily', 'weekdays', 'monthly'].includes(r.cadence)) {
      const missed = [];
      for (let i = 1; i <= 7; i++) { const d = addDays(today, -i); if (d >= start && isScheduled(r, d) && !done.has(d)) missed.push(d); }
      let streak = 0;
      for (let i = 0; i <= 400; i++) { const d = addDays(today, -i); if (d < start) break; if (!isScheduled(r, d)) continue; if (done.has(d)) streak++; else if (i === 0) continue; else break; }
      let due = 0, ok = 0;
      for (let i = 0; i < 30; i++) { const d = addDays(today, -i); if (d < start || (i === 0 && !done.has(d))) continue; if (isScheduled(r, d)) { due++; if (done.has(d)) ok++; } }
      const dueToday = isScheduled(r, today) && !done.has(today);
      let next = today; for (let i = 0; i < 400 && !(isScheduled(r, next) && (next > today || !done.has(today))); i++) next = addDays(next, 1);
      return { ...base, dueToday, overdueCount: missed.length, missedDates: missed, streak, rate30: due ? Math.round((ok / due) * 100) : null, nextDue: next, state: missed.length ? 'overdue' : dueToday ? 'due' : 'ok' };
    }
    if (r.cadence === 'weekly') {
      const target = Math.max(1, Number(r.times_per_week) || 1); const ws = weekStart(today);
      let doneWeek = 0; for (let i = 0; i <= diffDays(today, ws); i++) if (done.has(addDays(ws, i))) doneWeek++;
      const daysLeft = 7 - (dow(today) - 1); const need = Math.max(0, target - doneWeek);
      const behind = need > daysLeft ? need - daysLeft : 0; const mustToday = need > 0 && need >= daysLeft && !done.has(today);
      let streak = 0; let w = ws;
      if (need === 0) streak++;
      for (let k = 1; k <= 52; k++) { const s = addDays(ws, -7 * k); if (s < weekStart(start)) break; let c = 0; for (let i = 0; i < 7; i++) if (done.has(addDays(s, i))) c++; if (c >= target) streak++; else break; w = s; }
      return { ...base, dueToday: mustToday, overdueCount: behind, streak, nextDue: need > 0 ? today : addDays(ws, 7), state: behind ? 'overdue' : mustToday ? 'due' : 'ok', note: `이번 주 ${doneWeek}/${target}회`, progress: { done: doneWeek, target } };
    }
    // interval
    const n = Math.max(1, Number(r.interval_days) || 1); let last = null;
    for (const d of done) if (d <= today && (!last || d > last)) last = d;
    const nextDue = last ? addDays(last, n) : start; const late = diffDays(today, nextDue);
    let streak = 0; const ds = [...done].filter((d) => d <= today).sort().reverse();
    for (let i = 0; i < ds.length; i++) { if (i === 0) { streak = 1; continue; } if (diffDays(ds[i - 1], ds[i]) <= n) streak++; else break; }
    return { ...base, dueToday: late >= 0 && !done.has(today), overdueCount: late > 0 ? 1 : 0, missedDates: late > 0 ? [nextDue] : [], streak, nextDue, state: late > 0 ? 'overdue' : late === 0 && !done.has(today) ? 'due' : 'ok', note: late > 0 ? `${late}일 늦음` : `다음 ${nextDue}` };
  }

  function summarize(routines, logs, state, today) {
    const items = (routines || []).filter((r) => !r.deleted_at).map((r) => evaluate(r, doneSet(r, logs, state), today));
    const active = items.filter((x) => x.state !== 'paused' && x.state !== 'upcoming');
    const overdue = active.filter((x) => x.overdueCount > 0).sort((a, b) => b.overdueCount - a.overdueCount);
    const due = active.filter((x) => x.dueToday && !x.overdueCount);
    const todayList = active.filter((x) => x.dueToday || x.doneToday || x.overdueCount > 0);
    return { items, active, overdue, due, todayTotal: todayList.length, todayDone: todayList.filter((x) => x.doneToday).length };
  }

  /** 최근 N주 달력용: 날짜별 상태('done'|'missed'|'off'|'future'). */
  function history(r, done, today, weeks = 5) {
    const start = String(r.start_date || today).slice(0, 10); const ws = weekStart(today); const out = [];
    for (let w = weeks - 1; w >= 0; w--) { const row = []; for (let i = 0; i < 7; i++) { const d = addDays(ws, -7 * w + i);
      const st = d > today ? 'future' : done.has(d) ? 'done' : d < start ? 'off' : ['daily', 'weekdays', 'monthly'].includes(r.cadence) ? (isScheduled(r, d) ? (d === today ? 'pending' : 'missed') : 'off') : 'off';
      row.push({ date: d, state: st }); } out.push(row); }
    return out;
  }

  const api = { addDays, diffDays, dow, weekStart, parseDays, localDate, isScheduled, autoDates, doneSet, evaluate, summarize, history };
  root.RoutineCalc = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
