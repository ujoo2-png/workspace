// 차량관리 순수 로직 (v7.37.0) — 화면/DB 없이 Node 테스트가 가능하도록 분리했다.
//  ① 동일 차량번호 중복 카드 찾기 + 안전한 병합 계획(planMerge): 아무 기록도 지우지 않고, "완전히 같은 기록"만 하나로 정리한다.
//  ② 차량 그래프 데이터(seriesFor)와 health 핵심 지표 대시보드와 같은 기간 버튼(RANGES) 집계(aggregate).
// 일반 <script>, window.VehicleLogic.
(function () {
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDaysIso = (s, n) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return iso(d); };

  // ---------- ① 중복 차량 ----------
  /** 공백·하이픈·점을 없애고 소문자로: "12가 3456" == "12가-3456". 비어 있으면 '' (번호 없는 차량은 중복 판정 안 함). */
  function normPlate(p) { return String(p == null ? '' : p).replace(/[\s\-·.]/g, '').toLowerCase(); }

  /** 삭제되지 않은 차량을 번호로 묶어 2대 이상인 그룹만 돌려준다. → [{plate, vehicles:[...]}] */
  function findDuplicateGroups(vehicles) {
    const map = new Map();
    for (const v of vehicles || []) {
      if (v.deleted_at) continue;
      const k = normPlate(v.plate_number);
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(v);
    }
    return [...map.entries()].filter(([, a]) => a.length > 1).map(([plate, vs]) => ({ plate, vehicles: vs }));
  }

  const keyOf = (parts) => parts.map((x) => (x == null ? '' : String(x).trim())).join('|');
  const MAINT_KEY = (m) => keyOf([m.service_date, m.item, m.odometer, m.cost, m.next_due_date, m.next_due_odometer, m.shop_name, m.memo]);
  const FUEL_KEY = (f) => keyOf([f.logged_at, f.odometer, f.amount, f.cost]);
  const ODO_KEY = (o) => keyOf([o.logged_at, o.odometer]);

  /** 대표 카드 고르기: 기록이 가장 많은 카드, 같으면 먼저 만든 카드. */
  function pickPrimary(group, countOf) {
    return group.slice().sort((a, b) => (countOf(b) - countOf(a)) || String(a.created_at || '').localeCompare(String(b.created_at || '')))[0];
  }

  const empty = (v) => v == null || v === '';
  /**
   * 병합 계획. 실행은 호출하는 쪽(state)이 한다.
   * @param {object} primary 대표 차량
   * @param {object[]} others 합쳐질 차량들
   * @param {{maint:Object, fuel:Object, odo:Object, attach:Object}} data  vehicleId → 행 배열 (attach: 차량 id → 첨부 메타 배열)
   * @returns {{fieldPatch:object, conflicts:object[], moves:{maint:string[],fuel:string[],odo:string[],attach:string[]}, dups:{maint:string[],fuel:string[],odo:string[]}, counts:object}}
   *  - fieldPatch: 대표 카드의 빈 칸만 보완(값이 있으면 그대로). 만료일은 서로 다르면 더 늦은 날짜.
   *  - conflicts: 값이 서로 달라 대표 값을 유지한 항목(사용자에게 보여 준다).
   *  - moves: 대표 차량으로 옮길 기록 id. dups: "모든 칸이 같은" 중복이라 정리할 기록 id(옮기지 않고 삭제).
   */
  function planMerge(primary, others, data) {
    const fieldPatch = {};
    const conflicts = [];
    const cur = { ...primary };
    const FIELDS = [['name', '이름'], ['model', '모델'], ['year', '연식'], ['insurance_expiry', '보험 만료일'], ['registration_expiry', '등록/검사 만료일'], ['fuel_type', '연료']];
    for (const o of others) {
      for (const [f, label] of FIELDS) {
        const a = cur[f]; const b = o[f];
        if (empty(b)) continue;
        if (empty(a)) { fieldPatch[f] = b; cur[f] = b; continue; }
        if (String(a) === String(b)) continue;
        if (f === 'insurance_expiry' || f === 'registration_expiry') { if (String(b) > String(a)) { fieldPatch[f] = b; cur[f] = b; conflicts.push({ field: label, kept: b, dropped: a, note: '더 늦은 날짜로 갱신' }); } else conflicts.push({ field: label, kept: a, dropped: b, note: '더 늦은 날짜 유지' }); continue; }
        conflicts.push({ field: label, kept: a, dropped: b, note: '대표 카드 값 유지' });
      }
    }
    const moves = { maint: [], fuel: [], odo: [], attach: [] };
    const dups = { maint: [], fuel: [], odo: [] };
    const seen = { maint: new Set(), fuel: new Set(), odo: new Set() };
    const cfg = { maint: MAINT_KEY, fuel: FUEL_KEY, odo: ODO_KEY };
    for (const kind of ['maint', 'fuel', 'odo']) for (const r of (data[kind] && data[kind][primary.id]) || []) seen[kind].add(cfg[kind](r));
    for (const o of others) {
      for (const kind of ['maint', 'fuel', 'odo']) {
        for (const r of (data[kind] && data[kind][o.id]) || []) {
          const k = cfg[kind](r);
          if (seen[kind].has(k)) dups[kind].push(r.id); else { seen[kind].add(k); moves[kind].push(r.id); }
        }
      }
      // 첨부파일은 이름이 같아도 지우지 않고 전부 옮긴다(영수증·증권 원본 보존).
      for (const a of (data.attach && data.attach[o.id]) || []) moves.attach.push(a.id);
    }
    const counts = { move: moves.maint.length + moves.fuel.length + moves.odo.length, attach: moves.attach.length, dup: dups.maint.length + dups.fuel.length + dups.odo.length };
    return { fieldPatch, conflicts, moves, dups, counts };
  }

  // ---------- ② 그래프 ----------
  // health 핵심 지표 대시보드와 같은 버튼 구성(최근 10개 + 주간/월간/반기/분기/연간/최근3년).
  const RANGES = [
    { key: 'raw10', label: '최근 10개' },
    { key: 'week', label: '주간', period: 'week', periods: 8 },
    { key: 'month', label: '월간', period: 'month', periods: 6 },
    { key: 'half', label: '반기', period: 'month', periods: 6 },
    { key: 'quarter', label: '분기', period: 'quarter', periods: 4 },
    { key: 'year', label: '연간', period: 'quarter', periods: 4 },
    { key: 'year3', label: '최근3년', period: 'quarter', periods: 12 },
  ];

  /** 그래프 종류별 원자료 [{date, value}] (날짜 오름차순). */
  const METRICS = [
    { key: 'odo', label: '주행거리', unit: 'km', hue: '#3b82f6', mode: 'last' },
    { key: 'eff', label: '구간 연비', unit: 'km/L', hue: '#16a34a', mode: 'avg' },
    { key: 'price', label: '주유 단가', unit: '원/L', hue: '#d97706', mode: 'avg' },
    { key: 'fuelCost', label: '주유·충전 비용', unit: '원', hue: '#dc2626', mode: 'sum' },
    { key: 'maintCost', label: '정비 비용', unit: '원', hue: '#8b5cf6', mode: 'sum' },
    { key: 'dist', label: '주행량', unit: 'km', hue: '#0ea5e9', mode: 'sum' },
  ];
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  function seriesFor(kind, { fuels = [], maints = [], odoPoints = [] } = {}) {
    const num = (x) => typeof x === 'number' && Number.isFinite(x);
    if (kind === 'odo') {
      // 같은 날 주유·정비·주행 기록이 겹치면 가장 큰 값 하나만 쓴다(그래프에 같은 날짜가 중복되지 않게).
      const byDay = new Map();
      for (const p of odoPoints) if (p.date && num(p.odometer)) byDay.set(p.date, Math.max(byDay.get(p.date) || 0, p.odometer));
      return [...byDay.entries()].map(([date, value]) => ({ date, value })).sort(byDate);
    }
    if (kind === 'dist') {
      const pts = seriesFor('odo', { odoPoints }).map((x) => ({ date: x.date, odometer: x.value }));
      const out = [];
      for (let i = 1; i < pts.length; i++) { const d = pts[i].odometer - pts[i - 1].odometer; if (d > 0) out.push({ date: pts[i].date, value: d }); }
      return out;
    }
    const fs = fuels.filter((f) => f.logged_at).slice().sort((a, b) => (a.logged_at < b.logged_at ? -1 : 1));
    if (kind === 'eff') {
      const c = fs.filter((f) => num(f.odometer)); const out = [];
      for (let i = 1; i < c.length; i++) { const km = c[i].odometer - c[i - 1].odometer; if (km > 0 && num(c[i].amount) && c[i].amount > 0) out.push({ date: c[i].logged_at, value: Number((km / c[i].amount).toFixed(1)) }); }
      return out;
    }
    if (kind === 'price') return fs.filter((f) => num(f.amount) && f.amount > 0 && num(f.cost) && f.cost > 0).map((f) => ({ date: f.logged_at, value: Math.round(f.cost / f.amount) }));
    if (kind === 'fuelCost') return fs.filter((f) => num(f.cost) && f.cost > 0).map((f) => ({ date: f.logged_at, value: f.cost }));
    if (kind === 'maintCost') return maints.filter((m) => m.service_date && num(m.cost) && m.cost > 0).map((m) => ({ date: m.service_date, value: m.cost })).sort(byDate);
    return [];
  }

  /** 기간 구간(버킷) 만들기 — predict.js aggregateMetricTrend와 같은 경계(주=최근 7일씩, 월/분기=달력). */
  function buckets(period, periods, today) {
    const base = new Date(`${today}T00:00:00`); const out = [];
    for (let i = periods - 1; i >= 0; i--) {
      if (period === 'month') {
        const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
        out.push({ start: iso(d), end: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)), label: `${d.getFullYear()}.${pad(d.getMonth() + 1)}` });
      } else if (period === 'quarter') {
        const t = base.getFullYear() * 4 + Math.floor(base.getMonth() / 3) - i; const y = Math.floor(t / 4); const q = ((t % 4) + 4) % 4;
        out.push({ start: iso(new Date(y, q * 3, 1)), end: iso(new Date(y, q * 3 + 3, 0)), label: `${y} Q${q + 1}` });
      } else {
        const end = addDaysIso(today, -7 * i); const start = addDaysIso(end, -6);
        out.push({ start, end, label: start.slice(5) });
      }
    }
    return out;
  }

  /**
   * @param {{date:string,value:number}[]} points 원자료(오름차순)
   * @param {string} rangeKey RANGES의 key
   * @param {'last'|'avg'|'sum'} mode 구간 안 값을 합치는 방법(주행거리=마지막 값, 연비·단가=평균, 비용·주행량=합계)
   * @returns {{labels:string[], values:(number|null)[], hasAny:boolean}} values의 null = 그 구간 기록 없음(꺾은선이 끊김)
   */
  function aggregate(points, rangeKey, mode, today) {
    const pts = (points || []).slice().sort(byDate);
    if (rangeKey === 'raw10') {
      const r = pts.slice(-10);
      return { labels: r.map((p) => p.date.slice(5)), values: r.map((p) => p.value), hasAny: r.length > 0 };
    }
    const def = RANGES.find((r) => r.key === rangeKey) || RANGES[1];
    const bs = buckets(def.period, def.periods, today);
    const values = bs.map((b) => {
      const inb = pts.filter((p) => p.date >= b.start && p.date <= b.end);
      if (!inb.length) return null;
      if (mode === 'last') return inb[inb.length - 1].value;
      const sum = inb.reduce((s, p) => s + p.value, 0);
      return mode === 'sum' ? Math.round(sum * 10) / 10 : Number((sum / inb.length).toFixed(1));
    });
    return { labels: bs.map((b) => b.label), values, hasAny: values.some((v) => v !== null) };
  }

  window.VehicleLogic = { normPlate, findDuplicateGroups, pickPrimary, planMerge, RANGES, METRICS, seriesFor, aggregate, buckets };
})();
