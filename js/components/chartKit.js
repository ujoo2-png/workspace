// "Power BI 스타일" 인터랙션 차트 레이어(v7.21.0) — 순수 SVG/HTML, 외부 라이브러리 없음.
// 정직한 안내: 이것은 Microsoft Power BI가 아니다(임베드는 Azure AD/라이선스/토큰 발급 백엔드가 필요 — README 참고).
// 이 앱 안에서 Power BI에서 익숙한 상호작용을 흉내 낸다:
//   크로스헤어+툴팁, 범례 클릭으로 시리즈 켜기/끄기, 클릭 드릴다운(월→주→일), 기간 슬라이서(빠른 범위+범위 슬라이더),
//   카테고리 슬라이서 칩(같은 페이지 차트 교차 필터: 필터 컨텍스트 pub/sub), 표 보기, PNG/CSV 내보내기, 전체 화면(포커스), 시각 전환(막대/꺾은선/영역/도넛).
// 데이터비즈 원칙: 시리즈 색은 고정 순서(검증된 팔레트 8색, 색은 "개체"를 따르고 순위를 따르지 않음), 단일 y축(이중 축 없음), 얇은 마크,
//   범례 항상 표시(2개 이상), 표 보기 제공, 다크 모드는 별도 선택값(css/modules/chartkit.css).
// 일반 <script>로 로드. js/utils/chartLogic.js, js/utils/dom.js가 먼저, js/modules/analytics.js(niceTicks)도 먼저 로드되어야 한다.
(function () {
  const { el } = window;
  const NS = 'http://www.w3.org/2000/svg';
  const L = () => window.ChartLogic;
  const TYPE_LABEL = { bar: '막대', line: '꺾은선', area: '영역', donut: '도넛' };
  const QUICK = [['7d', '7일'], ['30d', '30일'], ['90d', '90일'], ['1y', '1년'], ['all', '전체']];
  const PREF_KEY = 'workspace:charts:prefs';
  let uidSeq = 0;

  const sv = (tag, attrs = {}, text) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, String(v));
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const fmtNum = (v, unit) => (v === null || v === undefined ? '-' : `${Number.isInteger(v) ? v : Number(v.toFixed(2))}${unit ? (unit.length <= 2 ? unit : ` ${unit}`) : ''}`);

  function getPrefs() { try { return JSON.parse(window.settingsSync.get(PREF_KEY) || '{}') || {}; } catch { return {}; } }
  function setPref(id, type) { const p = getPrefs(); p[id] = type; try { window.settingsSync.set(PREF_KEY, JSON.stringify(p)); } catch { /* 무시 */ } }

  // ---------- 다운로드 ----------
  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
  }
  function downloadCsv(name, headers, rows) {
    download(name, new Blob(['﻿' + L().toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' })); // BOM: Excel/Power BI가 한글을 올바르게 읽도록
  }
  // CSS 변수/클래스로 칠해진 SVG를 단독 이미지로 만들려면 계산된 색을 속성으로 박아야 한다(다크 모드 포함).
  function inlineStyles(orig, clone) {
    const o = [orig, ...orig.querySelectorAll('*')]; const c = [clone, ...clone.querySelectorAll('*')];
    o.forEach((node, i) => {
      const cs = getComputedStyle(node); const t = c[i];
      for (const p of ['fill', 'stroke', 'stroke-width', 'opacity', 'font-size', 'font-weight', 'stroke-dasharray']) {
        const v = cs.getPropertyValue(p);
        if (v && v !== 'none' || p === 'fill' || p === 'stroke') t.setAttribute(p, v);
      }
      if (node.tagName === 'text') t.setAttribute('font-family', 'sans-serif');
      t.removeAttribute('style'); t.removeAttribute('class');
    });
  }
  async function exportPng(svg, title, fileName) {
    const clone = svg.cloneNode(true);
    inlineStyles(svg, clone);
    const vb = svg.viewBox.baseVal; const w = vb.width || 640; const h = vb.height || 280;
    clone.setAttribute('xmlns', NS); clone.setAttribute('width', w); clone.setAttribute('height', h); clone.removeAttribute('style');
    const bg = getComputedStyle(svg.closest('.ck-card') || document.body).backgroundColor;
    const img = new Image();
    const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('이미지를 만들지 못했습니다.')); img.src = src; });
    const S = 2; const top = title ? 30 : 0;
    const cv = document.createElement('canvas'); cv.width = w * S; cv.height = (h + top) * S;
    const ctx = cv.getContext('2d'); ctx.scale(S, S);
    ctx.fillStyle = bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#ffffff'; ctx.fillRect(0, 0, w, h + top);
    if (title) { ctx.fillStyle = getComputedStyle(svg).color || '#1e293b'; ctx.font = '700 15px sans-serif'; ctx.fillText(title, 12, 20); }
    ctx.drawImage(img, 0, top, w, h);
    await new Promise((res) => cv.toBlob((b) => { if (b) download(fileName, b); res(); }, 'image/png'));
  }

  // ---------- 툴바(표 보기/PNG/CSV/전체 화면) 공통 ----------
  function toolButton(label, title, onclick, extra = {}) {
    return el('button', { type: 'button', class: 'ck-btn', title, 'aria-label': title, onclick, ...extra }, label);
  }
  function setFull(card, on) {
    card.classList.toggle('ck-card--full', on);
    document.documentElement.classList.toggle('ck-has-full', !!document.querySelector('.ck-card--full'));
    const b = card.querySelector('[data-ck=full]');
    if (b) { b.setAttribute('aria-pressed', String(on)); b.textContent = on ? '✕ 닫기' : '⛶ 전체 화면'; }
    card.dispatchEvent(new CustomEvent('ck-resize'));
  }
  if (!window.__ckEscBound && typeof document !== 'undefined') {
    window.__ckEscBound = true;
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const f = document.querySelector('.ck-card--full');
      if (f) { e.stopPropagation(); setFull(f, false); }
    }, true);
  }
  function tableNode(headers, rows) {
    const t = el('table', { class: 'ck-table' }, [
      el('thead', {}, [el('tr', {}, headers.map((h) => el('th', {}, h)))]),
      el('tbody', {}, rows.map((r) => el('tr', {}, r.map((c, i) => el(i ? 'td' : 'th', { scope: i ? undefined : 'row' }, c === null || c === undefined || c === '' ? '-' : String(c)))))),
    ]);
    return el('div', { class: 'ck-table-wrap' }, [t]);
  }

  // ---------- 호버(크로스헤어 + 툴팁) ----------
  // plotBox: svg 안 호버 영역 / xs: 각 인덱스의 x(viewBox 좌표) / tipRows(i) → [{name,color,text}] / head(i)
  function attachHover(svg, wrap, { xs, plot, head, tipRows, onClick }) {
    const tip = el('div', { class: 'ck-tip', role: 'status', hidden: true });
    wrap.append(tip);
    const cross = sv('line', { class: 'ck-cross', y1: plot.t, y2: plot.b, visibility: 'hidden' });
    svg.append(cross);
    const vbW = () => svg.viewBox.baseVal.width || 640;
    let cur = -1; let downX = null;
    function idxAt(clientX) {
      const r = svg.getBoundingClientRect();
      const vx = ((clientX - r.left) / r.width) * vbW();
      let best = 0; let bd = Infinity;
      xs.forEach((x, i) => { const d = Math.abs(x - vx); if (d < bd) { bd = d; best = i; } });
      return best;
    }
    function show(i, clientX, clientY) {
      cur = i;
      cross.setAttribute('x1', xs[i]); cross.setAttribute('x2', xs[i]); cross.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.replaceChildren(el('div', { class: 'ck-tip__head' }, head(i)), ...tipRows(i).map((r) => el('div', { class: 'ck-tip__row' }, [el('i', { class: 'ck-swatch', style: `background:${r.color}` }), el('span', { class: 'ck-tip__name' }, r.name), el('b', {}, r.text)])));
      const wr = wrap.getBoundingClientRect();
      const px = clientX - wr.left; const flip = px > wr.width * 0.6;
      tip.style.left = `${flip ? px - tip.offsetWidth - 14 : px + 14}px`;
      tip.style.top = `${Math.max(4, Math.min(clientY - wr.top - 10, wr.height - tip.offsetHeight - 4))}px`;
      svg.dispatchEvent(new CustomEvent('ck-hover', { detail: { index: i } }));
    }
    function hide() { cur = -1; tip.hidden = true; cross.setAttribute('visibility', 'hidden'); }
    svg.addEventListener('pointermove', (e) => show(idxAt(e.clientX), e.clientX, e.clientY));
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('pointerdown', (e) => { downX = e.clientX; });
    svg.addEventListener('pointerup', (e) => { if (onClick && downX !== null && Math.abs(e.clientX - downX) < 6) onClick(idxAt(e.clientX)); downX = null; });
    // 키보드: 포커스 후 ←/→로 구간 이동(툴팁 표시), Enter로 드릴/선택
    svg.setAttribute('tabindex', '0');
    svg.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Enter') return;
      e.preventDefault();
      if (e.key === 'Enter') { if (onClick && cur >= 0) onClick(cur); return; }
      const n = xs.length; const next = cur < 0 ? (e.key === 'ArrowRight' ? 0 : n - 1) : Math.min(n - 1, Math.max(0, cur + (e.key === 'ArrowRight' ? 1 : -1)));
      const r = svg.getBoundingClientRect();
      show(next, r.left + (xs[next] / vbW()) * r.width, r.top + r.height / 2);
    });
    return { hide, tip, cross };
  }

  // ---------- 기존 SVG 차트에 인터랙션만 입히기(Health 카드 등) ----------
  // svg.__ck = { labels, series:[{name,color,values}], xs, plot, unit, title } (analytics.js 차트들이 채운다)
  function decorate(host, svg, { title = '', fileBase = 'chart', extraTools = [] } = {}) {
    const meta = svg && svg.__ck;
    if (!meta) return host;
    const wrap = el('div', { class: 'ck-plot' }, [svg]);
    const tools = el('div', { class: 'ck-tools ck-tools--mini' });
    const card = el('div', { class: 'ck-card ck-card--mini' }, [tools, wrap]);
    const tbl = tableFromMeta(meta);
    let tableOn = false; let tableHost = null;
    tools.append(
      toolButton('표', '표 보기/차트 보기', () => {
        tableOn = !tableOn;
        if (tableOn) { tableHost = tableNode(tbl.headers, tbl.rows); wrap.hidden = true; card.append(tableHost); } else { if (tableHost) tableHost.remove(); wrap.hidden = false; }
        tools.querySelector('[data-ck=table]').setAttribute('aria-pressed', String(tableOn));
      }, { 'data-ck': 'table', 'aria-pressed': 'false' }),
      toolButton('PNG', '이미지(PNG)로 저장', () => exportPng(svg, title, `${fileBase}.png`).catch((e) => window.toast(e.message, 'error')), { 'data-ck': 'png' }),
      toolButton('CSV', 'CSV로 저장', () => downloadCsv(`${fileBase}.csv`, tbl.headers, tbl.rows), { 'data-ck': 'csv' }),
      toolButton('⛶', '전체 화면', () => setFull(card, !card.classList.contains('ck-card--full')), { 'data-ck': 'full', 'aria-pressed': 'false' }),
      ...extraTools
    );
    attachHover(svg, wrap, {
      xs: meta.xs, plot: meta.plot,
      head: (i) => meta.labels[i],
      tipRows: (i) => meta.series.map((s) => ({ name: s.name, color: s.color, text: fmtNum(s.values[i], meta.unit) })),
    });
    host.append(card);
    return host;
  }
  function tableFromMeta(meta) { return L().tableFromSeries(meta.labels, meta.series, meta.unit); }

  // ---------- 슬라이서 바(기간 + 카테고리 칩), 필터 컨텍스트 공유 ----------
  function slicerBar(ctx, { minDate, maxDate, categories = [], today }) {
    const bar = el('div', { class: 'ck-slicer', role: 'group', 'aria-label': '필터' });
    const quick = el('div', { class: 'ck-quick', role: 'group', 'aria-label': '기간' });
    const brush = el('div', { class: 'ck-brush' });
    const span = minDate && maxDate ? Math.max(1, L().diffDaysIso(minDate, maxDate)) : 0;
    const lo = el('input', { type: 'range', min: 0, max: span, value: 0, 'aria-label': '시작일', class: 'ck-range' });
    const hi = el('input', { type: 'range', min: 0, max: span, value: span, 'aria-label': '종료일', class: 'ck-range' });
    const lab = el('span', { class: 'ck-brush__label' }, minDate && maxDate ? `${minDate} ~ ${maxDate}` : '데이터 없음');
    function applyBrush() {
      let a = Number(lo.value); let b = Number(hi.value);
      if (a > b) [a, b] = [b, a];
      const from = L().addDaysIso(minDate, a); const to = L().addDaysIso(minDate, b);
      lab.textContent = `${from} ~ ${to}`;
      ctx.setRange(a === 0 && b === span ? null : { from, to }, 'custom');
    }
    lo.addEventListener('input', applyBrush); hi.addEventListener('input', applyBrush);
    brush.append(lo, hi, lab);
    if (!span) { lo.disabled = true; hi.disabled = true; }
    for (const [key, label] of QUICK) {
      quick.append(el('button', { type: 'button', class: 'ck-chip', 'data-quick': key, 'aria-pressed': String(key === 'all'), onclick: () => ctx.setRange(L().quickRange(key, today), key) }, label));
    }
    const chips = el('div', { class: 'ck-chips', role: 'group', 'aria-label': '카테고리' });
    for (const c of categories) chips.append(el('button', { type: 'button', class: 'ck-chip ck-chip--cat', 'data-cat': c, 'aria-pressed': 'false', onclick: () => ctx.toggleCategory(c) }, c));
    const reset = el('button', { type: 'button', class: 'ck-chip ck-chip--reset', onclick: () => { lo.value = 0; hi.value = span; if (span) lab.textContent = `${minDate} ~ ${maxDate}`; ctx.reset(); } }, '필터 초기화');
    bar.append(quick, brush, chips, reset);
    ctx.subscribe((snap) => {
      quick.querySelectorAll('[data-quick]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.quick === snap.quick)));
      chips.querySelectorAll('[data-cat]').forEach((b) => b.setAttribute('aria-pressed', String(snap.categories.includes(b.dataset.cat))));
      if (snap.range && minDate) { lo.value = Math.max(0, L().diffDaysIso(minDate, snap.range.from)); hi.value = Math.min(span, L().diffDaysIso(minDate, snap.range.to)); lab.textContent = `${snap.range.from} ~ ${snap.range.to}`; }
      else if (minDate) { lo.value = 0; hi.value = span; lab.textContent = `${minDate} ~ ${maxDate}`; }
    });
    return bar;
  }

  // ---------- 본체: 인터랙티브 차트 카드 ----------
  /**
   * spec: { id, title, unit, mode:'time'|'category', types:['bar','line','area','donut'], defaultType,
   *   time: { series:[{key, rows:[{date,v}], agg?}], agg:'avg'|'sum'|… }   (mode 'time')
   *   category: { items:[{label,value}] }                                 (mode 'category')
   *   ctx: 필터 컨텍스트(생략 가능), onRemove?: fn, today?: 'YYYY-MM-DD' }
   * 반환: 카드 노드(node.__ck = { destroy, getView })
   */
  function create(spec) {
    const ctx = spec.ctx || L().createFilterContext();
    const types = spec.types && spec.types.length ? spec.types : ['bar'];
    const prefs = getPrefs();
    const state = { type: types.includes(prefs[spec.id]) ? prefs[spec.id] : (types.includes(spec.defaultType) ? spec.defaultType : types[0]), hidden: new Set(), drill: [], table: false };
    const isTime = spec.mode === 'time';
    const keys = isTime ? spec.time.series.map((s) => s.key) : [];
    const colorOf = (i) => `var(--ck-${(i % 8) + 1})`;
    const card = el('div', { class: 'ck-card', 'data-chart-id': spec.id });
    const head = el('div', { class: 'ck-head' });
    const titleEl = el('h3', { class: 'ck-title' }, spec.title);
    const typeSwitch = el('div', { class: 'ck-seg', role: 'group', 'aria-label': '시각 전환' });
    const tools = el('div', { class: 'ck-tools' });
    const crumbs = el('div', { class: 'ck-crumbs' });
    const legend = el('div', { class: 'ck-legend', role: 'group', 'aria-label': '범례' });
    const plotWrap = el('div', { class: 'ck-plot' });
    const tableHost = el('div', { class: 'ck-tablehost', hidden: true });
    const foot = el('div', { class: 'ck-foot text-muted' });
    head.append(titleEl, typeSwitch, tools);
    card.append(head, crumbs, legend, plotWrap, tableHost, foot);
    let view = null; let svgNow = null;

    function effectiveRange() {
      const g = ctx.state.range; const d = state.drill.length ? L().bucketRange(state.drill[state.drill.length - 1].key, state.drill[state.drill.length - 1].level) : null;
      if (g && d) return { from: g.from > d.from ? g.from : d.from, to: g.to < d.to ? g.to : d.to };
      return g || d;
    }
    function dataSpan() {
      let min = null; let max = null;
      for (const s of spec.time.series) for (const r of s.rows) { if (!r.date) continue; if (!min || r.date < min) min = r.date; if (!max || r.date > max) max = r.date; }
      return { min, max };
    }
    function compute() {
      if (!isTime) {
        const items = (spec.category.items || []).filter((i) => i.value !== null);
        return { labels: items.map((i) => i.label), series: [{ name: spec.title, color: colorOf(0), values: items.map((i) => i.value), key: spec.title }], level: null, items, canDrill: false, empty: !items.length };
      }
      const range = effectiveRange();
      const span = dataSpan();
      const from = range ? range.from : span.min; const to = range ? range.to : span.max;
      if (!from || !to) return { labels: [], series: [], level: 'day', empty: true, canDrill: false };
      const level = state.drill.length ? L().finerLevel(state.drill[state.drill.length - 1].level) || 'day' : L().autoLevel(from, to);
      const visibleKeys = L().applyCategoryFilter(keys, ctx.state.categories.size ? [...ctx.state.categories] : []);
      const list = spec.time.series.map((s, i) => ({ s, i })).filter(({ s }) => visibleKeys.includes(s.key));
      const al = L().alignSeries(list.map(({ s }) => ({ rows: s.rows, agg: s.agg })), { level, agg: spec.time.agg || 'avg', range: { from, to } });
      const series = list.map(({ s, i }, k) => ({ name: s.key, color: colorOf(i), values: al.values[k], key: s.key, hidden: state.hidden.has(s.key) }));
      return { labels: al.keys.map((k) => L().bucketLabel(k, level)), rawKeys: al.keys, series, level, canDrill: !!L().finerLevel(level), empty: !al.keys.length };
    }

    function drawSvg(v, full) {
      const W = 640; const H = full ? 440 : 270;
      const plot = { l: 46, r: W - 14, t: 14, b: H - 30 };
      const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', class: 'ck-svg' });
      svg.setAttribute('aria-label', `${spec.title}: ${v.labels.length}개 구간, ${v.series.filter((s) => !s.hidden).map((s) => s.name).join('·')}`);
      svg.append(sv('title', {}, `${spec.title} (${TYPE_LABEL[state.type]})`));
      const shown = v.series.filter((s) => !s.hidden);
      const unit = spec.unit || '';
      if (state.type === 'donut' && !isTime) {
        const total = v.series[0].values.reduce((a, b) => a + (b || 0), 0) || 1;
        const cx = W / 2; const cy = H / 2; const R = Math.min(plot.b - plot.t, 240) / 2; const r0 = R * 0.58;
        let a0 = -Math.PI / 2;
        v.labels.forEach((lb, i) => {
          const val = v.series[0].values[i] || 0; const a1 = a0 + (val / total) * Math.PI * 2;
          const pt = (a, r) => `${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`;
          const large = a1 - a0 > Math.PI ? 1 : 0;
          const d = val / total >= 0.9999 ? `M${pt(a0, R)} A${R},${R} 0 1 1 ${pt(a0 + Math.PI, R)} A${R},${R} 0 1 1 ${pt(a0, R)} M${pt(a0, r0)} A${r0},${r0} 0 1 0 ${pt(a0 + Math.PI, r0)} A${r0},${r0} 0 1 0 ${pt(a0, r0)}` : `M${pt(a0, R)} A${R},${R} 0 ${large} 1 ${pt(a1, R)} L${pt(a1, r0)} A${r0},${r0} 0 ${large} 0 ${pt(a0, r0)} Z`;
          const sel = ctx.state.categories.has(lb);
          const dim = ctx.state.categories.size && !sel;
          const path = sv('path', { d, class: `ck-slice ${dim ? 'is-dim' : ''}`, 'data-label': lb, fill: colorOf(i), 'fill-rule': 'evenodd' });
          path.append(sv('title', {}, `${lb}: ${fmtNum(val, unit)} (${Math.round((val / total) * 100)}%)`));
          path.addEventListener('click', () => ctx.toggleCategory(lb));
          svg.append(path); a0 = a1;
        });
        svg.append(sv('text', { x: cx, y: cy - 2, 'text-anchor': 'middle', class: 'ck-donut-total' }, fmtNum(total, '')), sv('text', { x: cx, y: cy + 16, 'text-anchor': 'middle', class: 'ck-axis-text' }, '합계'));
        return { svg, xs: [], plot };
      }
      // 축 범위(단일 y축)
      const vals = shown.flatMap((s) => s.values.filter((x) => x !== null && x !== undefined));
      let lo = vals.length ? Math.min(...vals) : 0; let hi = vals.length ? Math.max(...vals) : 1;
      if (state.type !== 'line' || lo > 0 && lo / (hi || 1) < 0.5) lo = Math.min(0, lo);
      if (hi === lo) hi = lo + 1;
      const pad = (hi - lo) * 0.08; if (state.type === 'line' && lo !== 0) lo -= pad; hi += pad;
      let ticks = window.niceTicks(lo, hi, 4);
      if (vals.length && vals.every((x) => Number.isInteger(x))) { const it = ticks.filter((t) => Number.isInteger(t)); if (it.length >= 2) ticks = it; } // 건수·개수는 소수 눈금(0.5)을 쓰지 않는다
      const yOf = (x) => plot.t + (plot.b - plot.t) * (1 - (x - lo) / (hi - lo));
      for (const t of ticks) {
        svg.append(sv('line', { x1: plot.l, x2: plot.r, y1: yOf(t), y2: yOf(t), class: 'ck-grid' }));
        svg.append(sv('text', { x: plot.l - 6, y: yOf(t) + 3, 'text-anchor': 'end', class: 'ck-axis-text' }, Number.isInteger(t) ? t : t.toFixed(1)));
      }
      const n = v.labels.length;
      const slot = (plot.r - plot.l) / Math.max(1, n);
      const xs = v.labels.map((_, i) => (state.type === 'bar' ? plot.l + slot * (i + 0.5) : (n <= 1 ? (plot.l + plot.r) / 2 : plot.l + ((plot.r - plot.l) * i) / (n - 1))));
      const every = Math.max(1, Math.ceil(n / (full ? 12 : 7)));
      v.labels.forEach((lb, i) => { if (i % every === 0) svg.append(sv('text', { x: xs[i], y: plot.b + 16, 'text-anchor': 'middle', class: 'ck-axis-text' }, lb)); });
      svg.append(sv('line', { x1: plot.l, x2: plot.r, y1: yOf(Math.max(lo, 0)), y2: yOf(Math.max(lo, 0)), class: 'ck-axis' }));
      if (state.type === 'bar') {
        const k = Math.max(1, shown.length); const bw = Math.min(30, (slot * 0.72) / k);
        shown.forEach((s, si) => s.values.forEach((val, i) => {
          if (val === null || val === undefined) return;
          const x = xs[i] - (bw * k) / 2 + si * bw; const y0 = yOf(Math.max(lo, 0)); const y1 = yOf(val);
          const top = Math.min(y0, y1); const h = Math.max(1, Math.abs(y0 - y1));
          svg.append(sv('rect', { x: x + 1, y: top, width: Math.max(2, bw - 2), height: h, rx: 3, fill: s.color, class: 'ck-bar' }));
        }));
      } else {
        shown.forEach((s) => {
          const segs = []; let cur = null;
          s.values.forEach((val, i) => { if (val === null || val === undefined) { cur = null; } else { if (!cur) { cur = []; segs.push(cur); } cur.push([xs[i], yOf(val)]); } });
          for (const sg of segs) {
            const d = sg.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
            if (state.type === 'area' && sg.length > 1) svg.append(sv('path', { d: `${d} L${sg[sg.length - 1][0].toFixed(1)},${yOf(Math.max(lo, 0))} L${sg[0][0].toFixed(1)},${yOf(Math.max(lo, 0))} Z`, fill: s.color, class: 'ck-area' }));
            if (sg.length > 1) svg.append(sv('path', { d, fill: 'none', stroke: s.color, class: 'ck-line' }));
          }
          s.values.forEach((val, i) => { if (val !== null && val !== undefined && (n <= 40 || i === n - 1)) svg.append(sv('circle', { cx: xs[i], cy: yOf(val), r: 3.5, fill: s.color, class: 'ck-dot' })); });
        });
      }
      return { svg, xs, plot };
    }

    function render() {
      view = compute();
      const full = card.classList.contains('ck-card--full');
      // 타입 스위처
      typeSwitch.replaceChildren(...types.map((t) => el('button', { type: 'button', class: 'ck-seg__btn', 'data-type': t, 'aria-pressed': String(t === state.type), onclick: () => { state.type = t; setPref(spec.id, t); render(); } }, TYPE_LABEL[t])));
      // 브레드크럼(드릴)
      crumbs.replaceChildren();
      crumbs.hidden = !isTime;
      if (isTime) {
        const parts = [el('button', { type: 'button', class: 'ck-crumb', onclick: () => { state.drill = []; render(); } }, '전체')];
        state.drill.forEach((d, i) => parts.push(el('span', { class: 'ck-crumb-sep' }, '›'), el('button', { type: 'button', class: 'ck-crumb', onclick: () => { state.drill = state.drill.slice(0, i + 1); render(); } }, L().bucketLabel(d.key, d.level))));
        crumbs.append(...parts);
        if (state.drill.length) crumbs.append(el('button', { type: 'button', class: 'ck-btn', 'data-ck': 'up', onclick: () => { state.drill.pop(); render(); } }, '↑ 위로'));
        else if (view.canDrill) crumbs.append(el('span', { class: 'ck-hint' }, `막대/점을 클릭하면 ${L().finerLevel(view.level) === 'week' ? '주' : '일'} 단위로 내려갑니다`));
        crumbs.append(el('span', { class: 'ck-level', 'data-level': view.level }, { month: '월 단위', week: '주 단위', day: '일 단위' }[view.level] || ''));
      }
      // 범례(2개 이상 시리즈, 클릭으로 켜기/끄기) / 도넛은 슬라이스 범례
      legend.replaceChildren();
      if (state.type === 'donut' && !isTime) {
        view.labels.forEach((lb, i) => legend.append(el('button', { type: 'button', class: 'ck-legend__item', 'aria-pressed': String(!ctx.state.categories.size || ctx.state.categories.has(lb)), onclick: () => ctx.toggleCategory(lb) }, [el('i', { class: 'ck-swatch', style: `background:${colorOf(i)}` }), `${lb} ${fmtNum(view.series[0].values[i], '')}`])));
      } else if (isTime && view.series.length > 1) {
        for (const s of view.series) legend.append(el('button', { type: 'button', class: `ck-legend__item ${s.hidden ? 'is-off' : ''}`, 'data-series': s.name, 'aria-pressed': String(!s.hidden), title: '클릭하면 이 시리즈를 켜고 끕니다', onclick: () => { if (state.hidden.has(s.name)) state.hidden.delete(s.name); else state.hidden.add(s.name); render(); } }, [el('i', { class: 'ck-swatch', style: `background:${s.color}` }), s.name]));
      }
      legend.hidden = !legend.childNodes.length;
      // 본문
      plotWrap.replaceChildren();
      const tbl = L().tableFromSeries(view.labels, view.series.filter((s) => !s.hidden), spec.unit);
      if (view.empty) {
        plotWrap.append(el('div', { class: 'ck-empty' }, '표시할 데이터가 없습니다(기간·카테고리 필터를 확인하세요).'));
        svgNow = null;
      } else {
        const { svg, xs, plot } = drawSvg(view, full);
        svgNow = svg;
        plotWrap.append(svg);
        if (xs.length) {
          attachHover(svg, plotWrap, {
            xs, plot, head: (i) => (isTime ? `${view.rawKeys[i]}${view.level !== 'day' ? ` (${{ month: '월', week: '주' }[view.level]})` : ''}` : view.labels[i]),
            tipRows: (i) => view.series.filter((s) => !s.hidden).map((s) => ({ name: s.name, color: s.color, text: fmtNum(s.values[i], spec.unit) })),
            onClick: (i) => {
              if (isTime && view.canDrill) { state.drill.push({ key: view.rawKeys[i], level: view.level }); render(); }
              else if (!isTime) ctx.toggleCategory(view.labels[i]);
            },
          });
        }
        svg.__ck = { labels: view.labels, series: view.series, xs, plot, unit: spec.unit, title: spec.title };
      }
      // 표 보기
      tableHost.hidden = !state.table; plotWrap.hidden = state.table;
      tableHost.replaceChildren(...(state.table && !view.empty ? [tableNode(tbl.headers, tbl.rows)] : []));
      // 툴바
      const fileBase = `${spec.id}-${(window.todayISO ? window.todayISO() : 'chart')}`;
      tools.replaceChildren(
        toolButton('표 보기', '표 보기/차트 보기', () => { state.table = !state.table; render(); }, { 'data-ck': 'table', 'aria-pressed': String(state.table) }),
        toolButton('PNG', '이미지(PNG)로 저장', () => { if (svgNow) exportPng(svgNow, spec.title, `${fileBase}.png`).catch((e) => window.toast(e.message, 'error')); }, { 'data-ck': 'png' }),
        toolButton('CSV', 'CSV로 저장', () => downloadCsv(`${fileBase}.csv`, tbl.headers, tbl.rows), { 'data-ck': 'csv' }),
        toolButton(full ? '✕ 닫기' : '⛶ 전체 화면', '전체 화면(포커스) 보기', () => setFull(card, !card.classList.contains('ck-card--full')), { 'data-ck': 'full', 'aria-pressed': String(full) }),
        ...(spec.onRemove ? [toolButton('🗑', '이 타일 삭제', spec.onRemove, { 'data-ck': 'remove' })] : [])
      );
      foot.textContent = isTime ? `${view.labels.length}개 구간 · 필터: ${ctx.state.range ? `${ctx.state.range.from} ~ ${ctx.state.range.to}` : '전체 기간'}${ctx.state.categories.size ? ` · 카테고리 ${[...ctx.state.categories].join(', ')}` : ''}` : '';
    }

    const unsub = ctx.subscribe(() => { state.drill = state.drill; render(); });
    card.addEventListener('ck-resize', render);
    render();
    card.__ck = { destroy: unsub, getView: () => view, state };
    return card;
  }

  /** 시계열 데이터의 최소/최대 날짜(슬라이서 범위용). */
  function dateSpanOf(specs) {
    let min = null; let max = null;
    for (const sp of specs) if (sp.mode === 'time') for (const s of sp.time.series) for (const r of s.rows) { if (!r.date) continue; if (!min || r.date < min) min = r.date; if (!max || r.date > max) max = r.date; }
    return { min, max };
  }

  window.ChartKit = { create, decorate, slicerBar, attachHover, exportPng, downloadCsv, tableNode, dateSpanOf, TYPE_LABEL };
})();
