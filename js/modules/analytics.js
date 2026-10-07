// Analytics 화면. 주요 지표를 간단한 막대/선 차트로 보여준다.
// 외부 차트 라이브러리 없이 인라인 SVG로 그린다(빌드 스텝 없는 vanilla 구조 유지).
// 단일 지표(수량)를 카테고리별로 보여주는 차트이므로 단색(single-hue) + 직접 라벨 방식을 쓰고,
// 축은 하나만 사용하며(이중 y축 금지), 얇은 막대/선 + 둥근 끝(4px) + 값 직접 표기로 그린다.
// 일반 <script>로 로드된다.
(function () {
  const { appState, el, todayISO, addDays } = window;

  const HUE = '#3b82f6'; // 단일 지표용 시퀀셜 기본 색상(카테고리 식별용 아님)
  const AXIS_COLOR = '#94a3b8';

  // ===================================================================
  // 📊 리포트(v7.21.0): "Power BI 스타일" 인터랙티브 차트 + 사용자가 구성하는 타일 대시보드.
  //  · 상단 슬라이서(기간 빠른 범위 + 범위 슬라이더 + 카테고리 칩)가 모든 타일을 교차 필터링(js/utils/chartLogic.js 필터 컨텍스트)
  //  · 타일은 Health/Schedule/Projects/Challenges/Vehicles 지표를 골라 차트 종류와 함께 추가, workspace:reports:tiles에 settingsSync로 저장
  //  · 진짜 Power BI와의 다리: "Power BI용 내보내기"(tidy long-format CSV 도메인별) — README의 불러오기 안내 참고
  // ===================================================================
  const TILES_KEY = 'workspace:reports:tiles';
  function loadTiles() {
    let raw = null;
    try { raw = window.settingsSync.get(TILES_KEY); } catch { /* 무시 */ }
    if (raw === null || raw === undefined || raw === '') return window.ChartLogic.DEFAULT_TILES.map((t) => ({ ...t }));
    return window.ChartLogic.sanitizeTiles(raw);
  }
  function saveTiles(tiles) {
    try { window.settingsSync.set(TILES_KEY, JSON.stringify(tiles)); } catch { /* 무시 */ }
  }

  function specForTile(tile, st, ctx, extra) {
    const m = window.ChartLogic.metricById(tile.metric);
    const base = { id: tile.id, title: `${m.domain} · ${m.label}`, unit: m.unit, mode: m.mode, types: m.types, defaultType: tile.type, ctx, ...extra };
    if (m.mode === 'time') base.time = { series: m.series(st), agg: m.agg };
    else base.category = { items: m.items(st) };
    return base;
  }

  function renderAnalytics(root) {
    const container = el('div', {});
    root.append(container);
    const today = todayISO();
    const ctx = window.ChartLogic.createFilterContext();
    let tiles = loadTiles();
    let cards = [];

    function stateForCharts() {
      return {
        healthMetrics: appState.healthMetrics, schedules: appState.schedules, projects: appState.projects, notifications: appState.notifications,
        checkinsByChallenge: appState.checkinsByChallenge, fuelLogsByVehicle: appState.fuelLogsByVehicle, odometerLogsByVehicle: appState.odometerLogsByVehicle,
        devlogs: appState.devlogs, knowledgeDocs: appState.knowledgeDocs,
      };
    }

    // 슬라이서/타일을 만들 때만 전체를 다시 그린다. 필터가 바뀌면 각 카드가 스스로 갱신(ctx 구독)하므로 appState 변화 때만 draw.
    function draw() {
      cards.forEach((c) => c.__ck && c.__ck.destroy && c.__ck.destroy());
      cards = [];
      container.innerHTML = '';
      const st = stateForCharts();
      container.append(el('div', { class: 'page-header' }, [
        el('h1', {}, '📊 리포트'),
        el('div', { class: 'row', style: 'gap:8px; flex-wrap:wrap' }, [
          el('button', { class: 'nm-btn', id: 'report-add-tile', onclick: () => openTileForm() }, '＋ 타일 추가'),
          el('button', { class: 'nm-btn', id: 'report-powerbi', title: 'Power BI Desktop/Excel에서 바로 불러올 수 있는 CSV', onclick: () => openPowerBiExport(st) }, '📤 Power BI용 내보내기'),
        ]),
      ]));

      const specs = tiles.map((t) => specForTile(t, st, ctx, {}));
      const span = window.ChartKit.dateSpanOf(specs);
      const catSet = new Set();
      for (const sp of specs) if (sp.mode === 'time' && sp.time.series.length > 1) sp.time.series.forEach((s) => catSet.add(s.key));
      for (const sp of specs) if (sp.mode === 'category') sp.category.items.forEach((i) => catSet.add(i.label));
      container.append(window.ChartKit.slicerBar(ctx, { minDate: span.min, maxDate: span.max, categories: [...catSet].slice(0, 14), today }));

      // KPI 카드(Power BI의 "카드" 시각): 시간형 지표 최대 4개, 현재 기간 vs 바로 앞 같은 길이 기간. 슬라이서(기간)가 바뀌면 함께 갱신.
      const kpiTiles = tiles.map((t) => window.ChartLogic.metricById(t.metric)).filter((m) => m && m.mode === 'time').slice(0, 4);
      if (kpiTiles.length) {
        const kpiRow = el('div', { class: 'ck-kpis', id: 'report-kpis', role: 'group', 'aria-label': '핵심 지표(이전 기간 대비)' });
        const paintKpis = (snap) => {
          kpiRow.replaceChildren(...kpiTiles.map((m) => {
            const series = m.series(st);
            const rows = series.flatMap((s) => s.rows);
            const k = window.ChartLogic.kpiDelta(rows, { range: snap && snap.range, agg: m.agg === 'max' ? 'max' : m.agg, today });
            const fmt = (v) => (v === null ? '-' : `${Number.isInteger(v) ? v : Number(v.toFixed(1))}`);
            const up = k.delta !== null && k.delta > 0, down = k.delta !== null && k.delta < 0;
            const deltaText = k.delta === null ? '이전 기간 데이터 없음' : `${up ? '▲' : down ? '▼' : '＝'} ${fmt(Math.abs(k.delta))}${m.unit}${k.pct !== null ? ` (${k.pct > 0 ? '+' : ''}${k.pct}%)` : ''} vs 이전 기간`;
            return el('div', { class: 'ck-kpi', 'data-kpi': m.id, title: `${k.from}~${k.to} vs ${k.prevFrom}~${k.prevTo}` }, [
              el('div', { class: 'ck-kpi__label' }, `${m.domain} · ${m.label}`),
              el('div', { class: 'ck-kpi__value' }, `${fmt(k.cur)}`, el('span', { class: 'ck-kpi__unit' }, k.cur === null ? '' : ` ${m.unit}`)),
              el('div', { class: `ck-kpi__delta ${up ? 'is-up' : down ? 'is-down' : ''}` }, deltaText),
            ]);
          }));
        };
        paintKpis(ctx.snapshot());
        const unsub = ctx.subscribe(paintKpis);
        cards.push({ __ck: { destroy: unsub } });
        container.append(kpiRow);
      }
      if (!tiles.length) {
        container.append(el('div', { class: 'empty-state' }, [
          '타일이 없습니다. ', el('button', { class: 'nm-btn nm-btn--primary', onclick: () => { tiles = window.ChartLogic.DEFAULT_TILES.map((t) => ({ ...t })); saveTiles(tiles); draw(); } }, '기본 타일 불러오기'),
        ]));
      }
      const grid = el('div', { class: 'ck-grid-2', id: 'report-grid' });
      tiles.forEach((t, i) => {
        const card = window.ChartKit.create({
          ...specForTile(t, st, ctx, {}),
          onRemove: () => { if (!window.confirmDialog('이 타일을 삭제할까요?')) return; tiles = tiles.filter((x) => x.id !== t.id); saveTiles(tiles); draw(); },
        });
        const move = (d) => { const j = i + d; if (j < 0 || j >= tiles.length) return; const next = tiles.slice(); [next[i], next[j]] = [next[j], next[i]]; tiles = next; saveTiles(tiles); draw(); };
        const tools = card.querySelector('.ck-tools');
        if (tools) { tools.append(el('button', { type: 'button', class: 'ck-btn', title: '앞으로', 'data-ck': 'left', onclick: () => move(-1), disabled: i === 0 || undefined }, '◀'), el('button', { type: 'button', class: 'ck-btn', title: '뒤로', 'data-ck': 'right', onclick: () => move(1), disabled: i === tiles.length - 1 || undefined }, '▶')); }
        cards.push(card);
        grid.append(card);
      });
      container.append(grid);
      container.append(el('p', { class: 'text-muted', style: 'font-size:11px; margin-top:12px' }, [
        '이 화면은 Microsoft Power BI가 아니라, 이 앱 안에서 Power BI와 비슷하게 동작하는(크로스헤어·드릴다운·슬라이서·교차 필터) 자체 차트입니다. 진짜 Power BI에서 분석하려면 ',
        el('strong', {}, '📤 Power BI용 내보내기'), '를 쓰세요. ',
        el('button', { class: 'nm-btn', style: 'font-size:11px; padding:2px 8px', onclick: () => { if (window.confirmDialog('타일을 기본 구성으로 되돌릴까요?')) { tiles = window.ChartLogic.DEFAULT_TILES.map((t) => ({ ...t })); saveTiles(tiles); draw(); } } }, '기본 구성으로 되돌리기'),
      ]));
    }

    function openTileForm() {
      window.openModal({
        title: '리포트 타일 추가',
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          const metricSel = el('select', { class: 'nm-select', name: 'metric', required: true });
          const byDomain = {};
          for (const m of window.ChartLogic.METRICS) (byDomain[m.domain] = byDomain[m.domain] || []).push(m);
          for (const [d, list] of Object.entries(byDomain)) metricSel.append(el('optgroup', { label: d }, list.map((m) => el('option', { value: m.id }, `${m.label} (${m.unit})`))));
          const typeSel = el('select', { class: 'nm-select', name: 'type' });
          function syncTypes() {
            const m = window.ChartLogic.metricById(metricSel.value);
            typeSel.replaceChildren(...m.types.map((t) => el('option', { value: t }, window.ChartKit.TYPE_LABEL[t])));
          }
          metricSel.addEventListener('change', syncTypes); syncTypes();
          form.append(window.nmField('지표', metricSel, { required: true }), window.nmField('차트 종류', typeSel, { hint: '추가한 뒤에도 카드의 [막대/꺾은선/영역/도넛] 버튼으로 바꿀 수 있습니다.' }),
            el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '추가'));
          form.addEventListener('submit', (e) => {
            e.preventDefault();
            if (tiles.length >= 12) { window.toast('타일은 최대 12개까지 추가할 수 있습니다.', 'error'); return; }
            tiles = [...tiles, { id: `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`, metric: metricSel.value, type: typeSel.value }];
            saveTiles(tiles); close(); draw();
            window.toast('타일을 추가했습니다.', 'success');
          });
          body.append(form);
        },
      });
    }

    function openPowerBiExport(st) {
      window.openModal({
        title: '📤 Power BI용 내보내기',
        width: '560px',
        contentBuilder(body, close) {
          const files = window.ChartLogic.tidyCsvByDomain(st);
          const names = Object.keys(files);
          body.append(
            el('p', { class: 'text-muted', style: 'font-size:13px' }, '도메인별 "tidy(long) 형식" CSV입니다. 열: date, domain, metric, series, value, unit — 날짜 열이 있어 Power BI에서 바로 시계열/슬라이서를 만들 수 있습니다.'),
            el('div', { class: 'nm-card', style: 'padding:10px 12px; font-size:12px; border-color:var(--warning)' }, '⚠️ Health 등 개인 건강 정보가 포함될 수 있습니다. 내려받은 파일은 본인 PC에만 보관하세요. ("웹에 게시" 같은 공개 공유 기능에 올리지 마세요.)')
          );
          if (!names.length) { body.append(el('div', { class: 'empty-state' }, '내보낼 데이터가 아직 없습니다.')); return; }
          const list = el('div', { class: 'item-list', style: 'margin-top:10px' });
          for (const n of names) {
            const lines = files[n].split('\r\n').length - 1;
            list.append(el('div', { class: 'item-row' }, [
              el('div', { class: 'item-row__main' }, [el('div', { class: 'item-row__title' }, `${n}.csv`), el('div', { class: 'item-row__meta' }, `${lines}행`)]),
              el('button', { class: 'nm-btn', 'data-export': n, onclick: () => window.ChartKit.downloadCsv(`workspace-${n}-${todayISO()}.csv`, ...splitCsv(files[n])) }, '내려받기'),
            ]));
          }
          body.append(list, el('div', { class: 'row', style: 'gap:8px; margin-top:10px' }, [
            el('button', { class: 'nm-btn nm-btn--primary', id: 'export-all-one', onclick: () => {
              const all = window.ChartLogic.toCsv(window.ChartLogic.TIDY_HEADERS, names.flatMap((n) => splitCsv(files[n])[1]));
              window.ChartKit.downloadCsv(`workspace-all-${todayISO()}.csv`, ...splitCsv(all));
            } }, '전체를 CSV 1개로'),
            el('button', { class: 'nm-btn', id: 'export-json', onclick: () => {
              const rows = names.flatMap((n) => splitCsv(files[n])[1]).map((r) => Object.fromEntries(window.ChartLogic.TIDY_HEADERS.map((h, i) => [h, r[i]])));
              const a = document.createElement('a'); const url = URL.createObjectURL(new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' }));
              a.href = url; a.download = `workspace-tidy-${todayISO()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
            } }, 'JSON으로'),
          ]));
          body.append(el('details', { style: 'margin-top:12px; font-size:12px' }, [
            el('summary', { style: 'cursor:pointer; font-weight:700' }, 'Power BI Desktop에서 불러오는 방법'),
            el('ol', { style: 'margin:6px 0 0 18px; line-height:1.7' }, [
              el('li', {}, '홈 → 데이터 가져오기 → 텍스트/CSV → 내려받은 파일 선택(인코딩 UTF-8) → 로드'),
              el('li', {}, '여러 도메인을 한 번에: 모든 CSV를 한 폴더에 두고 데이터 가져오기 → 폴더 → "결합 및 변환"'),
              el('li', {}, 'date 열을 "날짜" 형식으로, value를 "10진수"로 지정 → 값 필드에 value, 축에 date, 범례에 series 또는 metric'),
              el('li', {}, '새로 내려받은 CSV로 덮어쓴 뒤 "새로 고침"을 누르면 갱신됩니다.'),
            ]),
          ]));
        },
      });
    }
    function splitCsv(csv) {
      const rows = csv.split('\r\n').map((line) => { const out = []; let cur = ''; let q = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; });
      return [rows[0], rows.slice(1)];
    }

    draw();
    const onChange = () => draw();
    appState.addEventListener('change', onChange);
    return () => { appState.removeEventListener('change', onChange); cards.forEach((c) => c.__ck && c.__ck.destroy && c.__ck.destroy()); };
  }

  // 얇은 세로 막대 + 4px 둥근 상단 + 직접 라벨. 단일 지표이므로 범례 없음.
  function barChart(labels, values, hue = HUE) {
    const W = 320;
    const H = 160;
    const padL = 8;
    const padB = 22;
    const padT = 18;
    const max = Math.max(1, ...values);
    const n = values.length;
    const slot = (W - padL * 2) / n;
    const barW = Math.min(28, slot * 0.5);
    const svg = svgEl(W, H);
    svg.__ck = { labels, series: [{ name: '값', color: hue, values }], xs: values.map((_, i) => padL + slot * i + slot / 2), plot: { t: padT, b: H - padB }, unit: '', title: '' };

    // 축선(recessive)
    svg.append(lineEl(padL, H - padB, W - padL, H - padB, AXIS_COLOR, 1));

    values.forEach((v, i) => {
      const x = padL + slot * i + (slot - barW) / 2;
      const barH = max > 0 ? ((H - padB - padT) * v) / max : 0;
      const y = H - padB - barH;
      svg.append(rectEl(x, y, barW, Math.max(barH, 1), hue, 4));
      svg.append(textEl(x + barW / 2, y - 4, String(v), { fontSize: 11, fill: '#1e293b', anchor: 'middle' }));
      svg.append(textEl(x + barW / 2, H - padB + 14, labels[i], { fontSize: 10, fill: AXIS_COLOR, anchor: 'middle' }));
    });
    return svg;
  }

  // 얇은 선(2px) + 마커(>=8px 히트영역 대응은 생략, 값이 적어 직접 라벨만) + 축 하나.
  function lineChart(labels, values, hue = HUE) {
    const W = 320;
    const H = 160;
    const padL = 8;
    const padB = 22;
    const padT = 18;
    const max = Math.max(1, ...values);
    const n = values.length;
    const stepX = (W - padL * 2) / Math.max(1, n - 1);
    const svg = svgEl(W, H);
    svg.__ck = { labels, series: [{ name: '값', color: hue, values }], xs: values.map((_, i) => padL + stepX * i), plot: { t: padT, b: H - padB }, unit: '', title: '' };
    svg.append(lineEl(padL, H - padB, W - padL, H - padB, AXIS_COLOR, 1));

    const points = values.map((v, i) => {
      const x = padL + stepX * i;
      const y = H - padB - (max > 0 ? ((H - padB - padT) * v) / max : 0);
      return [x, y];
    });
    const pathD = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathD);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', hue);
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);

    points.forEach(([x, y], i) => {
      svg.append(circleEl(x, y, 3, hue));
      if (i === points.length - 1 || i === 0 || values[i] === max) {
        svg.append(textEl(x, y - 8, String(values[i]), { fontSize: 10, fill: '#1e293b', anchor: 'middle' }));
      }
      if (i % Math.ceil(n / 6 || 1) === 0) {
        svg.append(textEl(x, H - padB + 14, labels[i], { fontSize: 9, fill: AXIS_COLOR, anchor: 'middle' }));
      }
    });
    return svg;
  }

  function svgEl(w, h) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', String(h));
    svg.setAttribute('role', 'img');
    return svg;
  }
  function lineEl(x1, y1, x2, y2, stroke, width) {
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    l.setAttribute('stroke', stroke); l.setAttribute('stroke-width', width);
    return l;
  }
  function rectEl(x, y, w, h, fill, rx) {
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', w); r.setAttribute('height', h);
    r.setAttribute('fill', fill); r.setAttribute('rx', rx);
    return r;
  }
  function circleEl(cx, cy, r, fill) {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r); c.setAttribute('fill', fill);
    return c;
  }
  function textEl(x, y, text, { fontSize = 10, fill = '#1e293b', anchor = 'start' } = {}) {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', x); t.setAttribute('y', y);
    t.setAttribute('font-size', String(fontSize));
    t.setAttribute('fill', fill);
    t.setAttribute('text-anchor', anchor);
    t.textContent = text;
    return t;
  }

  // =====================================================================
  // targetLineChart (v7.19.0) — "최근 기록(꺾은선) + 목표(수평 직선) + 정상 범위(음영)" 합성 차트.
  // 단일 지표·단일 y축(이중 축 금지). 기록 없는 구간(null)은 선을 끊는 "빈 구간"으로 둔다(0으로 그리지 않음).
  // 스케일/경로 계산은 DOM과 무관한 순수 함수(computeTargetLineGeometry)로 분리해 Node 단위 테스트가 가능하다.
  // =====================================================================
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  /** [min,max]를 count개 안팎의 "보기 좋은" 눈금으로 나눈다(1·2·5 × 10^n 간격). */
  function niceTicks(min, max, count = 4) {
    const span = max - min;
    if (!(span > 0)) return [min];
    const raw = span / Math.max(1, count);
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / pow;
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
    const ticks = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
    return ticks;
  }

  /**
   * @param {(number|null)[]} values 기록값(null=기록 없음)
   * @param {{target?:number|null, bands?:{min:number,max:number,label?:string,tone?:string}[], W?:number,H?:number, padL?:number,padR?:number,padT?:number,padB?:number}} opts
   * @returns {null | {W,H,plot:{l,r,t,b}, yMin:number, yMax:number, ticks:{v:number,y:number}[],
   *   points:({x:number,y:number,v:number,i:number}|null)[], segments:{idx:number[], d:string}[],
   *   targetY:number|null, bands:{y1:number,y2:number,min:number,max:number,label?:string,tone?:string}[]}}
   *   y축은 기록값 + 목표 + 모든 음영 범위를 포함하도록(위아래 10% 여유) 잡는다. 포함할 값이 하나도 없으면 null.
   */
  function computeTargetLineGeometry(values, opts = {}) {
    const { target = null, bands = [], W = 360, H = 190, padL = 38, padR = 12, padT = 14, padB = 26 } = opts;
    const cand = (values || []).filter(isNum);
    if (isNum(target)) cand.push(target);
    const validBands = (bands || []).filter((b) => b && isNum(b.min) && isNum(b.max) && b.max >= b.min);
    for (const b of validBands) cand.push(b.min, b.max);
    if (!cand.length) return null;
    let lo = Math.min(...cand);
    let hi = Math.max(...cand);
    const span = hi - lo || Math.max(1, Math.abs(hi) * 0.1);
    const pad = span * 0.1;
    const yMin = lo - pad;
    const yMax = hi + pad;
    const plot = { l: padL, r: W - padR, t: padT, b: H - padB };
    const plotW = plot.r - plot.l;
    const plotH = plot.b - plot.t;
    const y = (v) => plot.t + plotH * (1 - (v - yMin) / (yMax - yMin));
    const n = (values || []).length;
    const x = (i) => (n <= 1 ? plot.l + plotW / 2 : plot.l + (plotW * i) / (n - 1));
    const points = (values || []).map((v, i) => (isNum(v) ? { x: x(i), y: y(v), v, i } : null));
    // 연속된 값끼리만 선을 잇는다(null에서 끊음). 값이 하나뿐인 구간도 점으로 남는다.
    const segments = [];
    let cur = null;
    points.forEach((p) => {
      if (p) {
        if (!cur) { cur = { idx: [], pts: [] }; segments.push(cur); }
        cur.idx.push(p.i);
        cur.pts.push(p);
      } else cur = null;
    });
    const fmt = (v) => v.toFixed(1);
    const segOut = segments.map((sg) => ({ idx: sg.idx, d: sg.pts.map((p, k) => `${k === 0 ? 'M' : 'L'}${fmt(p.x)},${fmt(p.y)}`).join(' ') }));
    return {
      W, H, plot, yMin, yMax,
      ticks: niceTicks(yMin, yMax, 4).map((v) => ({ v, y: y(v) })),
      points,
      segments: segOut,
      targetY: isNum(target) ? y(target) : null,
      bands: validBands.map((b) => ({ ...b, y1: y(b.max), y2: y(b.min) })),
    };
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function svgNode(tag, attrs = {}, text) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    if (text !== undefined) n.textContent = text;
    return n;
  }

  /**
   * 목표선 + (선택) 정상 범위 음영이 있는 꺾은선 차트.
   * @param {string[]} labels x축 라벨(값과 같은 길이)
   * @param {(number|null)[]} values 기록값(null=빈 구간)
   * @param {{target?:number|null, band?:object, bands?:object[], unit?:string, hue?:string, targetLabel?:string, title?:string}} opts
   *   band = {min,max,label,tone:'normal'|'caution'} — 여러 개는 bands로. tone에 따라 초록/호박 계열의 옅은 음영+라벨(색만으로 구분하지 않음).
   */
  function targetLineChart(labels, values, opts = {}) {
    const { target = null, unit = '', hue = HUE, title = '' } = opts;
    const bands = (opts.bands || (opts.band ? [opts.band] : [])).slice();
    // 목표/음영 라벨은 그래프 오른쪽 여백(거터)에 직접 단다 — 선·점·최근값 라벨과 겹치지 않게 하려는 것.
    const needGutter = isNum(target) || bands.some((b) => b && b.label);
    const geo = computeTargetLineGeometry(values, { target, bands, padR: needGutter ? 66 : 12 });
    const W = geo ? geo.W : 360;
    const H = geo ? geo.H : 190;
    const svg = svgNode('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', class: 'target-line-chart', style: 'width:100%;height:auto;max-height:260px' });
    const summary = `${title || '추이'}: ${values.filter(isNum).length}개 기록${isNum(target) ? `, 목표 ${target}${unit}` : ''}`;
    svg.setAttribute('aria-label', summary);
    svg.append(svgNode('title', {}, summary));
    if (!geo) return svg;
    {
      // ChartKit.decorate가 쓰는 메타(크로스헤어 위치 = 각 인덱스의 x, 표/CSV용 값)
      const n0 = labels.length; const pl = geo.plot;
      svg.__ck = { labels, series: [{ name: title || '값', color: hue, values }], xs: labels.map((_, i) => (n0 <= 1 ? (pl.l + pl.r) / 2 : pl.l + ((pl.r - pl.l) * i) / (n0 - 1))), plot: { t: pl.t, b: pl.b }, unit: unit === '걸음' ? '' : unit, title };
    }

    const TEXT = 'fill:var(--text, #1e293b)';
    const MUTED = 'fill:var(--text-muted, #64748b)';
    const SURFACE = 'var(--surface, #fff)';
    const { plot } = geo;

    const gutter = []; // 오른쪽 여백에 쓸 직접 라벨 {y, text, kind}
    // 1) 정상/주의 범위 음영(가장 뒤) — 라벨을 함께 달아 색에만 의존하지 않는다.
    for (const b of geo.bands) {
      const caution = b.tone === 'caution';
      const top = Math.max(plot.t, b.y1);
      const bottom = Math.min(plot.b, b.y2);
      if (bottom <= top) continue;
      svg.append(svgNode('rect', { x: plot.l, y: top, width: plot.r - plot.l, height: bottom - top, style: `fill:${caution ? '#f59e0b' : '#22c55e'};opacity:${caution ? 0.1 : 0.16}` }));
      if (b.label) gutter.push({ y: (top + bottom) / 2 + 3, text: b.label, kind: 'band' });
    }
    // 2) 눈금 + 얇은 가로 기준선(눈에 덜 띄게)
    for (const t of geo.ticks) {
      svg.append(svgNode('line', { x1: plot.l, x2: plot.r, y1: t.y, y2: t.y, style: 'stroke:var(--border, #e2e8f0)', 'stroke-width': 1, opacity: 0.7 }));
      svg.append(svgNode('text', { x: plot.l - 5, y: t.y + 3, 'text-anchor': 'end', 'font-size': 9, style: MUTED }, Number.isInteger(t.v) ? t.v : t.v.toFixed(1)));
    }
    // 3) 목표선 — 수평 직선(점선) + 직접 라벨
    if (geo.targetY !== null) {
      svg.append(svgNode('line', { x1: plot.l, x2: plot.r, y1: geo.targetY, y2: geo.targetY, style: 'stroke:var(--text, #1e293b)', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
      gutter.push({ y: geo.targetY + 3, text: opts.targetLabel || `목표 ${target}${unit}`, kind: 'target' });
    }
    // 거터 라벨끼리 겹치면 위에서부터 11px 간격으로 밀어 낸다.
    gutter.sort((a, b) => a.y - b.y);
    for (let i = 1; i < gutter.length; i++) if (gutter[i].y - gutter[i - 1].y < 11) gutter[i].y = gutter[i - 1].y + 11;
    for (const g of gutter) {
      svg.append(svgNode('text', {
        x: plot.r + 6, y: g.y, 'text-anchor': 'start', 'font-size': g.kind === 'target' ? 10 : 9, 'font-weight': g.kind === 'target' ? 700 : 400,
        style: g.kind === 'target' ? TEXT : MUTED, class: g.kind === 'target' ? 'tlc-target-label' : 'tlc-band-label',
      }, g.text));
    }
    // 4) x축 라벨(최대 6개)
    const n = labels.length;
    const every = Math.max(1, Math.ceil(n / 6));
    labels.forEach((lb, i) => {
      if (i !== n - 1 && (i % every !== 0 || n - 1 - i < every)) return; // 마지막 라벨과 너무 가까운 라벨은 생략
      const px = n <= 1 ? (plot.l + plot.r) / 2 : plot.l + ((plot.r - plot.l) * i) / (n - 1);
      svg.append(svgNode('text', { x: px, y: plot.b + 15, 'text-anchor': i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle', 'font-size': 9, style: MUTED }, lb));
    });
    // 5) 꺾은선(2px) — 빈 구간에서 끊김
    for (const sg of geo.segments) {
      if (sg.idx.length < 2) continue;
      svg.append(svgNode('path', { d: sg.d, fill: 'none', stroke: hue, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    }
    // 6) 점 마커(표면색 링으로 겹침 분리) + 넓은 투명 히트 영역과 툴팁(<title>)
    const lastIdx = (() => { for (let i = geo.points.length - 1; i >= 0; i--) if (geo.points[i]) return i; return -1; })();
    geo.points.forEach((p, i) => {
      if (!p) return;
      const g = svgNode('g', {});
      g.append(svgNode('title', {}, `${labels[i]}: ${p.v}${unit}${isNum(target) ? ` (목표 대비 ${p.v - target >= 0 ? '+' : ''}${Number((p.v - target).toFixed(1))}${unit})` : ''}`));
      g.append(svgNode('circle', { cx: p.x, cy: p.y, r: 10, fill: 'transparent' }));
      g.append(svgNode('circle', { cx: p.x, cy: p.y, r: 3.5, fill: hue, style: `stroke:${SURFACE}`, 'stroke-width': 2 }));
      svg.append(g);
    });
    // 7) 최근값 직접 라벨(첫/마지막 값만 — 모든 점에 숫자를 달지 않는다)
    if (lastIdx >= 0) {
      const p = geo.points[lastIdx];
      const nearTop = p.y - plot.t < 16;
      svg.append(svgNode('text', {
        x: Math.min(p.x, plot.r - 12), y: nearTop ? p.y + 16 : p.y - 8, 'text-anchor': 'middle', 'font-size': 10, 'font-weight': 700,
        style: `${TEXT};paint-order:stroke;stroke:${SURFACE};stroke-width:3px`,
      }, `${p.v}${unit}`));
    }
    return svg;
  }

  window.renderAnalytics = renderAnalytics;
  // 다른 화면(차량관리의 주행거리·연비 추이 등)에서도 같은 인라인 SVG 차트를 재사용할 수 있게
  // 공개한다. 색상만 바꿔 쓸 수 있게 hue 인자를 추가로 받는다(기본은 이 화면과 동일한 파랑).
  window.simpleBarChart = function (labels, values, hue) { return barChart(labels, values, hue); };
  window.simpleLineChart = function (labels, values, hue) { return lineChart(labels, values, hue); };
  window.targetLineChart = targetLineChart;
  window.computeTargetLineGeometry = computeTargetLineGeometry;
  window.niceTicks = niceTicks;
})();
