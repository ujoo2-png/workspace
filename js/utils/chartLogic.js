// 차트 공통 순수 로직(v7.21.0) — DOM/네트워크 없음, Node 테스트 대상.
//   · 날짜 버킷(월/주/일)·드릴다운·집계·빠른 범위·필터 컨텍스트(pub/sub)·CSV·Power BI용 tidy(long) 행
//   · 리포트 지표 카탈로그(REPORT_METRICS): appState 모양의 객체를 받아 차트 데이터를 만든다
(function () {
  const pad = (n) => String(n).padStart(2, '0');
  const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const parse = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const fromMs = (ms) => { const d = new Date(ms); return isoOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); };
  const addDaysIso = (iso, n) => fromMs(parse(iso) + n * 86400000);
  const diffDaysIso = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  /** ISO 시각/날짜를 "로컬 날짜" YYYY-MM-DD로(타임존 안전: 날짜만 있으면 그대로). */
  function localDate(value) {
    const s = String(value || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s.slice(0, 10);
    return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  const LEVELS = ['month', 'week', 'day'];
  const finerLevel = (lv) => LEVELS[LEVELS.indexOf(lv) + 1] || null;
  const coarserLevel = (lv) => LEVELS[LEVELS.indexOf(lv) - 1] || null;

  /** 월요일 시작 주의 시작일. */
  function weekStart(iso) {
    const dow = (new Date(parse(iso)).getUTCDay() + 6) % 7; // 월=0
    return addDaysIso(iso, -dow);
  }
  function bucketKey(iso, level) {
    if (level === 'month') return iso.slice(0, 7);
    if (level === 'week') return weekStart(iso);
    return iso;
  }
  /** 버킷 키 → {from,to}(양끝 포함). */
  function bucketRange(key, level) {
    if (level === 'month') {
      const [y, m] = key.split('-').map(Number);
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return { from: `${key}-01`, to: `${key}-${pad(last)}` };
    }
    if (level === 'week') return { from: key, to: addDaysIso(key, 6) };
    return { from: key, to: key };
  }
  function bucketLabel(key, level) {
    if (level === 'month') return key.slice(2).replace('-', '.');
    if (level === 'week') return `${key.slice(5).replace('-', '/')}~`;
    return key.slice(5).replace('-', '/');
  }
  /** 보이는 기간 길이에 맞는 기본 단위: 200일 초과 월, 60일 초과 주, 그 이하 일. */
  function autoLevel(from, to) {
    const span = diffDaysIso(from, to) + 1;
    return span > 200 ? 'month' : span > 60 ? 'week' : 'day';
  }

  /** 한 버킷의 집계값. agg: avg/sum/last/max/min/count */
  function reduce(values, agg) {
    const v = values.filter(isNum);
    if (agg === 'count') return values.length;
    if (!v.length) return null;
    if (agg === 'sum') return Number(v.reduce((a, b) => a + b, 0).toFixed(6));
    if (agg === 'max') return Math.max(...v);
    if (agg === 'min') return Math.min(...v);
    if (agg === 'last') return v[v.length - 1];
    return Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(4));
  }

  /** rows [{date, v}] → 날짜 오름차순 버킷 [{key, value, n}]. range가 있으면 그 기간만. */
  function aggregate(rows, { level = 'day', agg = 'avg', range = null } = {}) {
    const sorted = rows.filter((r) => r && r.date).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const groups = new Map();
    for (const r of sorted) {
      if (range && ((range.from && r.date < range.from) || (range.to && r.date > range.to))) continue;
      const k = bucketKey(r.date, level);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r.v);
    }
    return [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([key, vals]) => ({ key, value: reduce(vals, agg), n: vals.length }));
  }

  /** 여러 시리즈에 공통 x축(버킷 키 합집합, 정렬)을 만들고 시리즈별 값 배열(없으면 null)로 맞춘다. */
  function alignSeries(seriesList, opts) {
    const per = seriesList.map((s) => new Map(aggregate(s.rows, { ...opts, agg: s.agg || opts.agg }).map((b) => [b.key, b.value])));
    const keys = [...new Set(per.flatMap((m) => [...m.keys()]))].sort();
    return { keys, values: per.map((m) => keys.map((k) => (m.has(k) ? m.get(k) : null))) };
  }

  /** 빠른 기간 → {from,to}|null(전체). today는 YYYY-MM-DD. */
  function quickRange(key, today) {
    const days = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 }[key];
    if (!days) return null;
    return { from: addDaysIso(today, -(days - 1)), to: today };
  }


  /**
   * KPI 카드용: 현재 기간 vs 바로 앞의 같은 길이 기간. range가 없으면(전체) 오늘 포함 최근 30일.
   * 반환 {cur, prev, delta, pct, from, to, prevFrom, prevTo} — 값이 없으면 cur/prev는 null, delta/pct도 null(0으로 위장하지 않음).
   */
  function kpiDelta(rows, { range = null, agg = 'avg', today } = {}) {
    const to = (range && range.to) || today;
    const from = (range && range.from) || addDaysIso(to, -29);
    const len = diffDaysIso(from, to) + 1;
    const prevTo = addDaysIso(from, -1), prevFrom = addDaysIso(prevTo, -(len - 1));
    const pick = (a, b) => rows.filter((r) => r && r.date && r.date >= a && r.date <= b).map((r) => r.v);
    const cur = reduce(pick(from, to), agg), prev = reduce(pick(prevFrom, prevTo), agg);
    const both = isNum(cur) && isNum(prev);
    const delta = both ? Number((cur - prev).toFixed(4)) : null;
    const pct = both && prev !== 0 ? Number(((cur - prev) / Math.abs(prev) * 100).toFixed(1)) : null;
    return { cur, prev, delta, pct, from, to, prevFrom, prevTo };
  }

  /** 같은 페이지의 차트들이 공유하는 필터 컨텍스트(작은 pub/sub). */
  function createFilterContext() {
    const subs = new Set();
    const state = { range: null, quick: 'all', categories: new Set() };
    const api = {
      state,
      subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
      _emit() { for (const fn of [...subs]) fn(api.snapshot()); },
      snapshot() { return { range: state.range ? { ...state.range } : null, quick: state.quick, categories: [...state.categories] }; },
      setRange(range, quick = 'custom') { state.range = range; state.quick = quick; api._emit(); },
      toggleCategory(c) { if (state.categories.has(c)) state.categories.delete(c); else state.categories.add(c); api._emit(); },
      clearCategories() { state.categories.clear(); api._emit(); },
      reset() { state.range = null; state.quick = 'all'; state.categories.clear(); api._emit(); },
    };
    return api;
  }

  /** 선택된 카테고리와 겹치는 시리즈 키가 하나라도 있으면 그 시리즈만, 아니면(해당 없음) 전부. */
  function applyCategoryFilter(keys, categories) {
    if (!categories || !categories.length) return keys.slice();
    const hit = keys.filter((k) => categories.includes(k));
    return hit.length ? hit : keys.slice();
  }

  function csvCell(v) {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  /** headers + 2차원 rows → CSV 문자열(Excel/Power BI가 한글을 읽도록 호출부에서 BOM을 붙인다). */
  function toCsv(headers, rows) {
    return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  }

  /** 차트 데이터(labels + series) → 표/CSV용 행. */
  function tableFromSeries(labels, series, unit = '') {
    return { headers: ['구간', ...series.map((s) => (unit ? `${s.name} (${unit})` : s.name))], rows: labels.map((l, i) => [l, ...series.map((s) => (s.values[i] ?? ''))]) };
  }

  // ---------------------------------------------------------------
  // 리포트 지표 카탈로그 — 사용자가 타일로 고르는 지표. state는 appState 모양(테스트에서는 가짜 객체).
  //   time 모드: series [{key, rows:[{date,v}], agg}]  /  category 모드: items [{label, value}]
  // ---------------------------------------------------------------
  const healthRows = (st, type) => (st.healthMetrics || []).filter((m) => m.metric_type === type).map((m) => ({ date: localDate(m.recorded_at), v: Number(m.value) }));
  const METRICS = [
    { id: 'health.weight', domain: 'Health', label: '체중', unit: 'kg', mode: 'time', agg: 'avg', types: ['line', 'area', 'bar'], series: (st) => [{ key: '체중', rows: healthRows(st, 'weight') }] },
    { id: 'health.steps', domain: 'Health', label: '걸음수', unit: '걸음', mode: 'time', agg: 'sum', types: ['bar', 'line', 'area'], series: (st) => [{ key: '걸음수', rows: healthRows(st, 'steps') }] },
    { id: 'health.bp', domain: 'Health', label: '혈압(수축기·이완기)', unit: 'mmHg', mode: 'time', agg: 'avg', types: ['line', 'area', 'bar'], series: (st) => [{ key: '수축기', rows: healthRows(st, 'bp_systolic') }, { key: '이완기', rows: healthRows(st, 'bp_diastolic') }] },
    { id: 'health.glucose', domain: 'Health', label: '혈당', unit: 'mg/dL', mode: 'time', agg: 'avg', types: ['line', 'area', 'bar'], series: (st) => [{ key: '혈당', rows: healthRows(st, 'blood_glucose') }] },
    { id: 'schedule.count', domain: 'Schedule', label: '일정 수(구분별)', unit: '건', mode: 'time', agg: 'sum', types: ['bar', 'line', 'area'], series: (st) => {
      const by = new Map();
      for (const s of st.schedules || []) { const k = s.category || '기타'; if (!by.has(k)) by.set(k, []); by.get(k).push({ date: s.date, v: 1 }); }
      return [...by.entries()].map(([key, rows]) => ({ key, rows }));
    } },
    { id: 'schedule.done', domain: 'Schedule', label: '완료한 일정', unit: '건', mode: 'time', agg: 'sum', types: ['bar', 'line', 'area'], series: (st) => [{ key: '완료', rows: (st.schedules || []).filter((s) => s.done).map((s) => ({ date: s.date, v: 1 })) }] },
    { id: 'project.status', domain: 'Projects', label: '프로젝트 상태 분포', unit: '개', mode: 'category', types: ['bar', 'donut'], items: (st) => {
      const L = { planned: '계획', in_progress: '진행 중', completed: '완료', done: '완료', paused: '보류' };
      const c = {};
      for (const p of st.projects || []) { const k = L[p.status] || p.status; c[k] = (c[k] || 0) + 1; }
      return Object.entries(c).map(([label, value]) => ({ label, value }));
    } },
    { id: 'notification.severity', domain: 'Schedule', label: '알림 심각도 분포', unit: '건', mode: 'category', types: ['bar', 'donut'], items: (st) => {
      const L2 = { info: '정보', warning: '경고', critical: '긴급' };
      return Object.keys(L2).map((k) => ({ label: L2[k], value: (st.notifications || []).filter((n) => n.severity === k).length }));
    } },
    { id: 'tags.distribution', domain: 'Projects', label: '태그 분포(상위 8개)', unit: '건', mode: 'category', types: ['bar', 'donut'], items: (st) => {
      const c = {};
      for (const t of [...(st.schedules || []), ...(st.projects || []), ...(st.devlogs || []), ...(st.knowledgeDocs || [])].flatMap((x) => x.tags || [])) c[t] = (c[t] || 0) + 1;
      return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label: `#${label}`, value }));
    } },
    { id: 'challenge.checkins', domain: 'Challenges', label: '챌린지 체크인', unit: '회', mode: 'time', agg: 'sum', types: ['bar', 'line', 'area'], series: (st) => [{ key: '체크인', rows: Object.values(st.checkinsByChallenge || {}).flat().map((c) => ({ date: c.checkin_date, v: 1 })) }] },
    { id: 'vehicle.fuelCost', domain: 'Vehicles', label: '주유 금액', unit: '원', mode: 'time', agg: 'sum', types: ['bar', 'line', 'area'], series: (st) => [{ key: '주유 금액', rows: Object.values(st.fuelLogsByVehicle || {}).flat().filter((f) => isNum(Number(f.cost)) && f.cost !== null).map((f) => ({ date: f.logged_at, v: Number(f.cost) })) }] },
    { id: 'vehicle.odometer', domain: 'Vehicles', label: '주행거리(계기판)', unit: 'km', mode: 'time', agg: 'max', types: ['line', 'area', 'bar'], series: (st) => [{ key: '주행거리', rows: Object.values(st.odometerLogsByVehicle || {}).flat().map((o) => ({ date: o.logged_at, v: Number(o.odometer) })) }] },
  ];
  const metricById = (id) => METRICS.find((m) => m.id === id) || null;

  /** Power BI/Excel용 tidy(long) 행: [date, domain, metric, series, value, unit]. 도메인별로 CSV 하나. */
  const TIDY_HEADERS = ['date', 'domain', 'metric', 'series', 'value', 'unit'];
  function tidyRowsForMetric(metric, st) {
    const out = [];
    if (metric.mode === 'time') {
      for (const s of metric.series(st)) for (const r of s.rows) if (r.date && isNum(r.v)) out.push([r.date, metric.domain, metric.label, s.key, r.v, metric.unit]);
    } else {
      // 분포형은 날짜가 없다 → 내보내는 날짜(스냅샷)로 기록한다
      const snap = localDate(new Date().toISOString());
      for (const it of metric.items(st)) out.push([snap, metric.domain, metric.label, it.label, it.value, metric.unit]);
    }
    return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }
  function tidyCsvByDomain(st) {
    const byDomain = {};
    for (const m of METRICS) (byDomain[m.domain] = byDomain[m.domain] || []).push(...tidyRowsForMetric(m, st));
    const files = {};
    for (const [d, rows] of Object.entries(byDomain)) if (rows.length) files[d.toLowerCase()] = toCsv(TIDY_HEADERS, rows);
    return files;
  }

  /** 리포트 타일 설정 검증/정리: [{id, metric, type}] — 알 수 없는 지표/차트 종류는 버리거나 기본으로 */
  const DEFAULT_TILES = [
    { id: 'default-schedule-done', metric: 'schedule.done', type: 'bar' },
    { id: 'default-project-status', metric: 'project.status', type: 'bar' },
    { id: 'default-challenge-checkins', metric: 'challenge.checkins', type: 'line' },
    { id: 'default-notification', metric: 'notification.severity', type: 'bar' },
    { id: 'default-tags', metric: 'tags.distribution', type: 'bar' },
    { id: 'default-weight', metric: 'health.weight', type: 'line' },
  ];
  function sanitizeTiles(raw) {
    let list = raw;
    if (typeof raw === 'string') { try { list = JSON.parse(raw); } catch { list = []; } }
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const t of list) {
      const m = t && metricById(t.metric);
      if (!m) continue;
      out.push({ id: String(t.id || `${t.metric}-${out.length}`), metric: m.id, type: m.types.includes(t.type) ? t.type : m.types[0] });
      if (out.length >= 12) break;
    }
    return out;
  }

  window.ChartLogic = { kpiDelta, localDate, LEVELS, finerLevel, coarserLevel, weekStart, bucketKey, bucketRange, bucketLabel, autoLevel, reduce, aggregate, alignSeries, quickRange, createFilterContext, applyCategoryFilter, toCsv, tableFromSeries, METRICS, metricById, TIDY_HEADERS, tidyRowsForMetric, tidyCsvByDomain, sanitizeTiles, DEFAULT_TILES, addDaysIso, diffDaysIso };
})();
