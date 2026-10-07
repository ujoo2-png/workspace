// 프로젝트 상세의 "WBS(작업 분해) + 간트차트" 카드 (v7.20.0). 일반 <script>로 로드되며 window.wbsCard(project)를 등록한다.
// 순수 계산(트리/번호/롤업/임계 경로/좌표)은 js/wbs.js, 여기서는 그리기와 입력만 한다. 간트는 외부 라이브러리 없이 SVG + HTML.
//
// 구성: ① 도구줄(확대 일/주/월, 임계 경로, 기준선, 오늘, PNG, 인쇄)  ② 빠른 추가(한 줄 입력+Enter, 들여쓴 목록 붙여넣기)
//       ③ 선택한 항목 편집 패널(이름·기간·진행률·마일스톤·선행 작업·메모)  ④ 간트(왼쪽 고정 개요 + 오른쪽 가로 스크롤 SVG)
(function () {
  const { appState, el, toast, confirmDialog, todayISO } = window;
  const W = window.WBS;
  const NS = 'http://www.w3.org/2000/svg';
  const LABEL_W = 300;
  const ZOOMS = [['day', '일'], ['week', '주'], ['month', '월']];
  const STATUS_LABEL = { todo: '대기', in_progress: '진행 중', done: '완료', overdue: '지연' };
  const DEP_LABEL = { FS: '종료→시작 (FS)', SS: '시작→시작 (SS)', FF: '종료→종료 (FF)', SF: '시작→종료 (SF)' };
  const DEP_SHORT = { FS: 'FS', SS: 'SS', FF: 'FF', SF: 'SF' };

  // 뷰 상태(프로젝트별 접힘/선택/스크롤은 화면을 다시 그려도 유지된다). zoom 등은 이 브라우저에만 저장(localStorage).
  const lsGet = (k, d) => { try { return localStorage.getItem(`workspace:wbs:${k}`) ?? d; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(`workspace:wbs:${k}`, v); } catch { /* 무시 */ } };
  const view = {
    zoom: ['day', 'week', 'month'].includes(lsGet('zoom', 'week')) ? lsGet('zoom', 'week') : 'week',
    critical: lsGet('critical', '1') === '1',
    baseline: lsGet('baseline', '1') === '1',
    collapsed: new Map(), selected: new Map(), scroll: new Map(), focusId: null, quickFocus: false, parentFor: new Map(),
  };
  const setOf = (map, pid) => { if (!map.has(pid)) map.set(pid, new Set()); return map.get(pid); };

  // ---------- SVG 도우미 ----------
  function s(tag, attrs = {}, kids = []) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
    for (const c of [].concat(kids)) if (c) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  }
  // 현재 테마의 CSS 변수를 실제 색 값으로 읽는다(PNG/인쇄용 독립 SVG에는 var()가 통하지 않기 때문).
  function readPalette() {
    const cs = getComputedStyle(document.documentElement);
    const g = (n, f) => (cs.getPropertyValue(n).trim() || f);
    return {
      text: g('--text', '#1e2433'), muted: g('--text-muted', '#6b7280'), border: g('--border', '#e4e8f0'), strong: g('--border-strong', '#d3d9e3'),
      surface: g('--surface', '#ffffff'), surface2: g('--surface-2', '#eef1f6'), accent: g('--accent', '#2f6fed'), accentSoft: g('--accent-soft', '#eaf1ff'),
      danger: g('--danger', '#e5484d'), todo: g('--g-todo', '#8a94a6'), prog: g('--g-prog', '#2f6fed'), done: g('--g-done', '#1fa971'), over: g('--g-over', '#e5484d'),
      levels: [g('--g-l1', '#1e3a8a'), g('--g-l2', '#3b6bd6'), g('--g-l3', '#6f94d8'), g('--g-l4', '#93aee0')],
      weekend: g('--g-weekend', 'rgba(120,130,150,0.10)'), milestone: g('--g-milestone', '#f59e0b'), baseline: g('--g-baseline', '#94a3b8'),
    };
  }
  const statusColor = (P, st) => (st === 'done' ? P.done : st === 'overdue' ? P.over : st === 'in_progress' ? P.prog : P.todo);
  const FONT = "Pretendard, 'Apple SD Gothic Neo', 'Malgun Gothic', -apple-system, 'Segoe UI', sans-serif";

  function drawHeader(L, P) {
    const svg = s('svg', { class: 'g2-head-svg', width: L.width, height: L.headerH, role: 'img', 'aria-label': '간트차트 날짜 눈금' });
    svg.append(s('rect', { x: 0, y: 0, width: L.width, height: L.headerH, fill: P.surface2 }));
    svg.append(s('line', { x1: 0, x2: L.width, y1: 22, y2: 22, stroke: P.border }));
    svg.append(s('line', { x1: 0, x2: L.width, y1: L.headerH - 0.5, y2: L.headerH - 0.5, stroke: P.strong }));
    for (const t of L.ticks) {
      svg.append(s('line', { x1: t.x, x2: t.x, y1: t.month ? 0 : 22, y2: L.headerH, stroke: t.major ? P.strong : P.border }));
      if (t.month) svg.append(s('text', { x: t.x + 5, y: 15, 'font-size': 11, 'font-weight': 700, fill: P.text, 'font-family': FONT }, t.month));
      if (L.zoom === 'day') {
        const wd = window.isoWeekday(t.iso);
        svg.append(s('text', { x: t.x + L.px / 2, y: 39, 'text-anchor': 'middle', 'font-size': 11, fill: wd === 7 ? P.danger : P.muted, 'font-family': FONT }, t.label));
      } else {
        svg.append(s('text', { x: t.x + 4, y: 39, 'font-size': 10.5, fill: P.muted, 'font-family': FONT }, t.label));
      }
    }
    svg.append(s('rect', { x: L.todayX - 14, y: 24, width: 28, height: 14, rx: 7, fill: P.danger }));
    svg.append(s('text', { x: L.todayX, y: 34.5, 'text-anchor': 'middle', 'font-size': 9.5, 'font-weight': 700, fill: '#fff', 'font-family': FONT }, '오늘'));
    return svg;
  }

  function tipText(it) {
    const lines = [`${it.number}  ${it.name}  (${it.level})`];
    if (it.hasDates) lines.push(it.kind === 'milestone' ? `마일스톤 ${it.start}` : `${it.start} ~ ${it.end} · ${it.duration}일`);
    else lines.push('일정 미정');
    if (it.kind !== 'milestone') lines.push(`진행률 ${it.progress}% · ${STATUS_LABEL[it.status]}`);
    if (it.critical) lines.push(`임계 경로 (여유 ${it.slack}일)`);
    else if (it.slack !== null && it.isLeaf) lines.push(`여유 ${it.slack}일`);
    if (it.variance) lines.push(`기준선 대비 시작 ${fmtDelta(it.variance.startDelta)} · 종료 ${fmtDelta(it.variance.endDelta)}`);
    return lines;
  }
  const fmtDelta = (d) => (d === 0 ? '±0일' : d > 0 ? `+${d}일(늦음)` : `${d}일(빠름)`);

  // opts: { selectedId, showCritical, ids(true면 data-* 속성/상호작용용 요소 포함) }
  function drawBody(L, P, opts = {}) {
    const H = L.height - L.headerH;
    const svg = s('svg', { class: 'g2-body-svg', width: L.width, height: Math.max(H, 1), role: 'img', 'aria-label': '간트차트 막대' });
    const defs = s('defs');
    for (const [id, color] of [['n', P.muted], ['c', P.danger], ['v', P.danger]]) {
      defs.append(s('marker', { id: `g2-arrow-${id}`, viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, [s('path', { d: 'M0,0 L8,4 L0,8 z', fill: color })]));
    }
    svg.append(defs);
    for (const w of L.weekends) svg.append(s('rect', { x: w.x, y: 0, width: w.w, height: H, fill: P.weekend }));
    for (const t of L.ticks) svg.append(s('line', { x1: t.x, x2: t.x, y1: 0, y2: H, stroke: t.major ? P.strong : P.border, 'stroke-width': 1, opacity: 0.8 }));
    L.items.forEach((it, i) => {
      const y = i * L.rowH;
      if (opts.selectedId === it.id) svg.append(s('rect', { x: 0, y, width: L.width, height: L.rowH, fill: P.accentSoft, opacity: 0.75 }));
      svg.append(s('line', { x1: 0, x2: L.width, y1: y + L.rowH - 0.5, y2: y + L.rowH - 0.5, stroke: P.border }));
    });
    // 의존 화살표(막대 아래에 먼저 그린다)
    for (const d of L.deps) {
      const crit = opts.showCritical && d.critical;
      const color = d.violation ? P.danger : crit ? P.danger : P.muted;
      const pts = d.points.map(([x, y]) => `${x},${y - L.headerH}`).join(' ');
      svg.append(s('polyline', {
        points: pts, fill: 'none', stroke: color, 'stroke-width': crit ? 2 : 1.4, 'stroke-dasharray': d.violation ? '4 3' : null,
        'marker-end': `url(#g2-arrow-${d.violation ? 'v' : crit ? 'c' : 'n'})`, class: 'g2-dep', 'data-from': d.from, 'data-to': d.to,
      }, [s('title', {}, d.violation ? `의존관계 위반: 선행 작업(${DEP_SHORT[d.type]})의 조건을 만족하지 않는 계획 날짜` : `의존관계 ${DEP_SHORT[d.type]}`)]));
    }
    const bars = new Map();
    for (const it of L.items) {
      const y = it.y - L.headerH;
      if (!it.hasDates) {
        svg.append(s('text', { x: Math.max(8, L.todayX + 8), y: y + 21, 'font-size': 11, fill: P.muted, 'font-style': 'italic', 'font-family': FONT }, '일정 미정 — 행을 눌러 날짜를 입력하세요'));
        continue;
      }
      const color = it.kind === 'summary' ? P.levels[it.levelIndex] : statusColor(P, it.status);
      const crit = opts.showCritical && it.critical;
      const g = s('g', { class: `g2-bar g2-bar--${it.kind}`, 'data-bar': '1', 'data-id': it.id });
      if (it.baseline && it.kind !== 'milestone') {
        svg.append(s('rect', { x: it.baseline.x, y: y + 27, width: it.baseline.w, height: 4, rx: 2, fill: P.baseline, opacity: 0.9 }, [s('title', {}, `기준선 ${it.baseline.start} ~ ${it.baseline.end}`)]));
      }
      let track = null, prog = null, pctLabel = null;
      if (it.kind === 'task') {
        track = s('rect', { x: it.x, y: y + 7, width: it.w, height: 18, rx: 5, fill: color, 'fill-opacity': 0.28, stroke: crit ? P.danger : color, 'stroke-width': crit ? 2.5 : 1 });
        prog = s('rect', { x: it.x, y: y + 7, width: Math.max(0, (it.w * it.progress) / 100), height: 18, rx: 5, fill: color });
        g.append(track, prog);
        if (it.progress > 0 || it.w > 44) pctLabel = s('text', { x: it.x + it.w + 6, y: y + 20.5, 'font-size': 10.5, fill: P.muted, 'font-family': FONT }, `${it.progress}%`);
      } else if (it.kind === 'summary') {
        track = s('rect', { x: it.x, y: y + 11, width: it.w, height: 8, fill: color, 'fill-opacity': 0.33 });
        prog = s('rect', { x: it.x, y: y + 11, width: Math.max(0, (it.w * it.progress) / 100), height: 8, fill: color });
        const capL = s('path', { d: `M${it.x},${y + 11} v15 l6,-5 z`, fill: color });
        const capR = s('path', { d: `M${it.x + it.w},${y + 11} v15 l-6,-5 z`, fill: color });
        g.append(track, prog, capL, capR);
        pctLabel = s('text', { x: it.x + it.w + 8, y: y + 20.5, 'font-size': 10.5, 'font-weight': 700, fill: P.muted, 'font-family': FONT }, `${it.progress}%`);
      } else {
        const cx = it.x + L.px / 2, cy = y + 17, r = 8;
        g.append(s('polygon', { points: `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`, fill: it.status === 'done' ? P.done : P.milestone, stroke: crit ? P.danger : P.text, 'stroke-width': crit ? 2.5 : 1 }));
      }
      // 투명 히트 영역(드래그/호버) — 얇은 막대도 잡기 쉽게 세로를 넉넉히
      const hx = it.kind === 'milestone' ? it.x + L.px / 2 - 10 : it.x;
      const hw = it.kind === 'milestone' ? 20 : Math.max(it.w, 8);
      const hit = s('rect', { class: 'g2-hit', x: hx, y: y + 3, width: hw, height: 26, fill: 'transparent' });
      g.append(hit);
      svg.append(g);
      if (pctLabel) svg.append(pctLabel);
      bars.set(it.id, { g, track, prog, hit, item: it, label: pctLabel });
    }
    svg.append(s('line', { x1: L.todayX, x2: L.todayX, y1: 0, y2: H, stroke: P.danger, 'stroke-width': 1.6, 'stroke-dasharray': '5 3', class: 'g2-today' }));
    return { svg, bars };
  }

  // PNG/인쇄용 독립 SVG(왼쪽 개요 + 헤더 + 본문). 색은 모두 실제 값, 글꼴은 시스템 한글 글꼴.
  function buildExportSvg(L, P, collapsedTitle) {
    const head = drawHeader(L, P);
    const { svg: body } = drawBody(L, P, { showCritical: view.critical });
    const total = L.height;
    const root = s('svg', { xmlns: NS, width: LABEL_W + L.width, height: total + 28, viewBox: `0 0 ${LABEL_W + L.width} ${total + 28}`, 'font-family': FONT });
    root.append(s('rect', { x: 0, y: 0, width: LABEL_W + L.width, height: total + 28, fill: P.surface }));
    root.append(s('text', { x: 8, y: 17, 'font-size': 13, 'font-weight': 700, fill: P.text, 'font-family': FONT }, collapsedTitle));
    const g0 = s('g', { transform: 'translate(0,28)' });
    g0.append(s('rect', { x: 0, y: 0, width: LABEL_W, height: L.headerH, fill: P.surface2 }));
    g0.append(s('text', { x: 8, y: 28, 'font-size': 11, 'font-weight': 700, fill: P.muted, 'font-family': FONT }, '작업 (WBS)'));
    L.items.forEach((it, i) => {
      const y = L.headerH + i * L.rowH;
      g0.append(s('line', { x1: 0, x2: LABEL_W, y1: y + L.rowH - 0.5, y2: y + L.rowH - 0.5, stroke: P.border }));
      const x0 = 8 + it.depth * 14;
      g0.append(s('text', { x: x0, y: y + 21, 'font-size': 11, fill: P.muted, 'font-family': FONT }, it.number));
      g0.append(s('circle', { cx: x0 + 34, cy: y + 17, r: 7, fill: P.levels[it.levelIndex] }));
      g0.append(s('text', { x: x0 + 34, y: y + 20.5, 'text-anchor': 'middle', 'font-size': 8.5, 'font-weight': 700, fill: '#fff', 'font-family': FONT }, it.level));
      const name = it.name.length > 22 ? `${it.name.slice(0, 21)}…` : it.name;
      g0.append(s('text', { x: x0 + 46, y: y + 21, 'font-size': 12, 'font-weight': it.hasChildren ? 700 : 400, fill: P.text, 'font-family': FONT }, name));
    });
    const g1 = s('g', { transform: `translate(${LABEL_W},28)` });
    g1.append(head);
    const bodyWrap = s('g', { transform: `translate(0,${L.headerH})` });
    bodyWrap.append(body);
    g1.append(bodyWrap);
    root.append(g0, g1);
    return root;
  }
  function svgToString(svg) {
    return new XMLSerializer().serializeToString(svg);
  }

  async function exportPng(p, L, P) {
    const svg = buildExportSvg(L, P, `${p.name} — WBS / 간트차트 (${todayISO()})`);
    const w = LABEL_W + L.width, h = L.height + 28;
    const scale = Math.max(0.5, Math.min(2, 16000 / w, 16000 / h));
    const img = new Image();
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgToString(svg))}`;
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('이미지를 만들지 못했습니다.')); img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('PNG를 만들지 못했습니다.');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `gantt-${p.name.replace(/[^\w가-힣-]+/g, '_')}-${todayISO()}.png`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function printGantt(p, L, P) {
    const svg = buildExportSvg(L, P, `${p.name} — WBS / 간트차트 (${todayISO()})`);
    const w = window.open('', '_blank');
    if (!w) { toast('팝업이 차단되어 인쇄 창을 열 수 없습니다. 팝업을 허용하거나 PNG로 저장해 주세요.', 'error'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${p.name.replace(/[<>&]/g, '')} 간트차트</title><style>@page{size:landscape;margin:10mm}body{margin:0;font-family:sans-serif}svg{max-width:100%;height:auto}</style></head><body>${svgToString(svg)}<script>window.onload=function(){setTimeout(function(){window.print()},200)}<\/script></body></html>`);
    w.document.close();
  }

  // ---------- 본체 ----------
  function wbsCard(p) {
    const rows = appState.projectStagesByProject[p.id] || [];
    const tree = W.buildTree(rows);
    const collapsed = setOf(view.collapsed, p.id);
    let selectedId = view.selected.get(p.id);
    if (selectedId && !tree.byId.has(selectedId)) { selectedId = null; view.selected.delete(p.id); }
    const todayIso = todayISO();
    const L = W.layoutGantt({ rows, collapsed, zoom: view.zoom, todayIso, showBaseline: view.baseline });
    const roll = W.computeRollup(tree);
    const P = readPalette();
    const numberOf = new Map(tree.order.map((r) => [r.node.id, r.number]));

    const card = el('div', { class: 'nm-card wbs-card', 'data-project': p.id });
    const rerender = () => { const next = wbsCard(p); card.replaceWith(next); };
    const select = (id) => { if (id) view.selected.set(p.id, id); else view.selected.delete(p.id); rerender(); };

    // ----- 요약 수치 -----
    const roots = (tree.children.get(null) || []).map((n) => roll.get(n.id));
    const overall = W.rollupProgress(roots.map((r) => ({ progress: r.progress, duration: r.duration })));
    const leaves = L.items.length ? tree.order.filter((r) => !r.hasChildren) : [];
    const overdue = leaves.filter((r) => W.effectiveStatus(roll.get(r.node.id), todayIso) === 'overdue').length;
    const critCount = L.cp.critical.size;
    const hasDeps = rows.some((r) => (r.depends_on || []).length);

    card.append(el('div', { class: 'row row--between wrap', style: 'margin-bottom:10px; gap:8px' }, [
      el('div', {}, [
        el('h3', { style: 'margin:0' }, '작업 분해(WBS) · 간트차트'),
        el('div', { class: 'text-muted', style: 'font-size:12px; margin-top:2px' }, '줄을 하나 입력하고 Enter — 대/중/소와 번호(1, 1.1, 1.1.1)는 들여쓰기 깊이로 자동으로 정해져요.'),
      ]),
      rows.length ? el('div', { class: 'row wrap', style: 'gap:6px' }, [
        el('span', { class: 'nm-badge', id: 'wbs-overall' }, `전체 진행률 ${overall}%`),
        el('span', { class: 'nm-badge' }, `작업 ${leaves.length}개`),
        overdue ? el('span', { class: 'nm-badge nm-badge--critical' }, `지연 ${overdue}`) : null,
        hasDeps && critCount ? el('span', { class: 'nm-badge nm-badge--warning', title: '여유 0일 — 밀리면 전체 일정이 밀리는 작업' }, `임계 경로 ${critCount}개`) : null,
        L.cp.violations.length ? el('span', { class: 'nm-badge nm-badge--critical', title: '선행 작업 조건을 어기는 계획 날짜' }, `의존 위반 ${L.cp.violations.length}`) : null,
        (() => { const avg = window.computeAvgStageDuration && window.computeAvgStageDuration(); return avg ? el('span', { class: 'nm-badge', title: '완료된 작업들의 시작일~실제완료일(또는 종료일) 평균' }, `📊 평균 작업 소요 ${avg.avg}일(${avg.count}건)`) : null; })(),
        L.cp.cycles.length ? el('span', { class: 'nm-badge nm-badge--critical', title: '서로가 서로를 기다리는 순환 의존' }, `순환 의존 ${L.cp.cycles.length}`) : null,
      ]) : null,
    ]));

    // ----- 도구줄 -----
    const tbtn = (label, onclick, extra = {}) => el('button', { type: 'button', class: `nm-btn wbs-tb ${extra.on ? 'nm-btn--primary' : ''}`, title: extra.title, id: extra.id, 'aria-pressed': extra.on !== undefined ? String(!!extra.on) : undefined, onclick }, label);
    const zoomGroup = el('div', { class: 'wbs-zoom', role: 'group', 'aria-label': '확대' }, ZOOMS.map(([z, label]) => tbtn(label, () => { view.zoom = z; lsSet('zoom', z); rerender(); }, { on: view.zoom === z, id: `wbs-zoom-${z}`, title: `${label} 단위 보기` })));
    card.append(el('div', { class: 'wbs-toolbar' }, [
      zoomGroup,
      tbtn('임계 경로', () => { view.critical = !view.critical; lsSet('critical', view.critical ? '1' : '0'); rerender(); }, { on: view.critical, id: 'wbs-critical', title: '여유가 0일인 작업 사슬을 빨간 윤곽으로 강조(선행 작업을 지정해야 의미가 있어요)' }),
      tbtn('기준선', () => { view.baseline = !view.baseline; lsSet('baseline', view.baseline ? '1' : '0'); rerender(); }, { on: view.baseline, id: 'wbs-baseline', title: '저장해 둔 계획(기준선)을 막대 아래 회색 줄로 비교' }),
      tbtn('⌖ 오늘', () => scrollToToday(), { id: 'wbs-today', title: '오늘 위치로 이동' }),
      tbtn(collapsed.size ? '▾ 모두 펼치기' : '▸ 모두 접기', () => {
        if (collapsed.size) collapsed.clear(); else for (const r of tree.order) if (r.hasChildren) collapsed.add(r.node.id);
        rerender();
      }, { id: 'wbs-collapse-all' }),
      el('span', { class: 'wbs-tb-spacer' }),
      tbtn('📌 기준선 저장', async () => {
        if (!rows.length) return;
        if (!confirmDialog('지금의 시작/종료일을 기준선(계획)으로 저장할까요? 이후 일정이 바뀌면 막대 아래 회색 줄과 비교해 볼 수 있어요. (이전 기준선은 덮어씁니다)')) return;
        try { const n = await appState.snapshotProjectBaseline(p.id); toast(`기준선을 저장했습니다 (${n}개 작업).`, 'success'); } catch (e) { toast(`저장하지 못했습니다: ${e.message || e}`, 'error'); }
      }, { id: 'wbs-save-baseline' }),
      tbtn('🖼 PNG', async () => { try { await exportPng(p, L, P); } catch (e) { toast(`PNG 저장 실패: ${e.message || e}`, 'error'); } }, { id: 'wbs-png', title: '간트차트를 이미지로 저장' }),
      tbtn('🖨 인쇄', () => printGantt(p, L, P), { id: 'wbs-print' }),
    ]));

    // ----- 빠른 추가 -----
    card.append(quickAdd(p, tree, selectedId, collapsed));

    if (!rows.length) {
      card.append(el('div', { class: 'empty-state', id: 'wbs-empty' }, [
        '아직 작업이 없어요. 위 입력창에 첫 줄을 쓰고 Enter를 눌러 보세요.',
        el('div', { class: 'text-muted', style: 'font-size:12px; margin-top:6px; white-space:pre-line' }, '들여쓴 목록을 그대로 붙여넣어도 됩니다.\n예)  기획\n       요구사항 정리\n개발'),
      ]));
      return card;
    }

    // ----- 선택 항목 편집 패널 -----
    card.append(detailPanel(p, tree, roll, L, selectedId, numberOf, rerender, select, collapsed));

    // ----- 간트: 왼쪽 개요(HTML, 고정) + 오른쪽 SVG(가로 스크롤) -----
    const scroller = el('div', { class: 'g2-scroll', tabindex: '0', 'aria-label': '간트차트(좌우로 스크롤)' });
    const inner = el('div', { class: 'g2-inner', style: `grid-template-columns:${LABEL_W}px ${L.width}px` });
    const corner = el('div', { class: 'g2-corner', style: `height:${L.headerH}px` }, [el('span', {}, '작업 (WBS)'), el('span', { class: 'g2-corner__hint' }, '이름 클릭=편집 · Tab 들여쓰기 · Enter 다음 줄')]);
    const headHost = el('div', { class: 'g2-head', style: `height:${L.headerH}px` });
    headHost.append(drawHeader(L, P));
    const left = el('div', { class: 'g2-left' });
    const { svg: bodySvg, bars } = drawBody(L, P, { selectedId, showCritical: view.critical });
    const bodyHost = el('div', { class: 'g2-body' });
    bodyHost.append(bodySvg);
    L.items.forEach((it) => left.append(leftRow(p, tree, it, selectedId, collapsed, rerender, select, rows)));
    inner.append(corner, headHost, left, bodyHost);
    scroller.append(inner);

    const tip = el('div', { class: 'g2-tip', role: 'tooltip' });
    tip.style.display = 'none';
    const wrap = el('div', { class: 'g2-wrap' }, [scroller, tip]);
    card.append(wrap);

    // legend
    card.append(el('div', { class: 'g2-legend' }, [
      legendItem('swatch', P.todo, '대기'), legendItem('swatch', P.prog, '진행 중'), legendItem('swatch', P.done, '완료'), legendItem('swatch', P.over, '지연'),
      legendItem('diamond', P.milestone, '마일스톤'), legendItem('crit', P.danger, '임계 경로'), legendItem('base', P.baseline, '기준선'), legendItem('weekend', P.weekend, '주말'),
      el('span', { class: 'text-muted', style: 'font-size:12px' }, '막대를 끌어 이동 · 양끝을 끌어 기간 조절'),
    ]));

    // 스크롤 위치 유지/오늘로 이동
    function scrollToToday() { scroller.scrollLeft = Math.max(0, L.todayX - scroller.clientWidth / 2 + LABEL_W / 2); }
    scroller.addEventListener('scroll', () => view.scroll.set(p.id, { left: scroller.scrollLeft, top: scroller.scrollTop }));
    queueMicrotask(() => {
      if (!scroller.isConnected) return;
      const sc = view.scroll.get(p.id);
      if (sc) { scroller.scrollLeft = sc.left; scroller.scrollTop = sc.top; } else scrollToToday();
      if (view.focusId) {
        const input = card.querySelector(`.g2-name[data-id="${view.focusId}"]`);
        if (input) { input.focus(); input.select(); view.focusId = null; }
      }
    });

    // 호버 툴팁
    const showTip = (e, it) => {
      tip.replaceChildren(...tipText(it).map((t, i) => el('div', { class: i === 0 ? 'g2-tip__title' : '' }, t)));
      tip.style.display = 'block';
      const box = wrap.getBoundingClientRect();
      tip.style.left = `${Math.min(e.clientX - box.left + 14, box.width - tip.offsetWidth - 6)}px`;
      tip.style.top = `${e.clientY - box.top + 16}px`;
    };
    // 드래그(이동/기간 조절) — 리프 작업과 마일스톤만. 성공을 Playwright로 검증했다.
    let drag = null;
    const itemById = new Map(L.items.map((i) => [i.id, i]));
    const zoneOf = (e, bar) => {
      const r = bar.hit.getBoundingClientRect();
      const x = e.clientX - r.left;
      if (bar.item.kind === 'milestone') return 'move';
      return x <= 7 ? 'start' : x >= r.width - 7 ? 'end' : 'move';
    };
    bodySvg.addEventListener('pointermove', (e) => {
      if (drag) return onDragMove(e);
      const g = e.target.closest && e.target.closest('[data-bar]');
      if (!g) { tip.style.display = 'none'; bodySvg.style.cursor = ''; return; }
      const bar = bars.get(g.dataset.id);
      const draggable = bar.item.isLeaf;
      const z = draggable ? zoneOf(e, bar) : null;
      bodySvg.style.cursor = !draggable ? 'pointer' : z === 'move' ? 'grab' : 'ew-resize';
      showTip(e, bar.item);
    });
    bodySvg.addEventListener('pointerleave', () => { if (!drag) tip.style.display = 'none'; });
    bodySvg.addEventListener('pointerdown', (e) => {
      const g = e.target.closest && e.target.closest('[data-bar]');
      if (!g) {
        // 빈 곳을 누르면 그 줄 선택
        const y = e.clientY - bodySvg.getBoundingClientRect().top;
        const it = L.items[Math.floor(y / L.rowH)];
        if (it) select(it.id);
        return;
      }
      const bar = bars.get(g.dataset.id);
      if (!bar.item.isLeaf) { select(bar.item.id); return; }
      const node = tree.byId.get(bar.item.id);
      drag = { id: bar.item.id, bar, node, mode: zoneOf(e, bar), x0: e.clientX, moved: false, days: 0, pid: e.pointerId };
      try { bodySvg.setPointerCapture(e.pointerId); } catch { /* 무시 */ }
      tip.style.display = 'none';
      e.preventDefault();
    });
    function onDragMove(e) {
      const dx = e.clientX - drag.x0;
      if (Math.abs(dx) > 3) drag.moved = true;
      if (!drag.moved) return;
      const days = Math.round(dx / L.px);
      drag.days = days;
      const d = W.dragDates(drag.node, drag.mode, days);
      if (!d) return;
      const { bar } = drag;
      const X = (iso) => window.isoDiff(L.range.min, iso) * L.px;
      const nx = X(d.start_date), nw = (window.isoDiff(d.start_date, d.target_date) + 1) * L.px;
      if (bar.item.kind === 'milestone') { bar.g.setAttribute('transform', `translate(${nx - bar.item.x},0)`); }
      else {
        bar.track.setAttribute('x', nx); bar.track.setAttribute('width', nw);
        bar.prog.setAttribute('x', nx); bar.prog.setAttribute('width', (nw * bar.item.progress) / 100);
        bar.hit.setAttribute('x', nx); bar.hit.setAttribute('width', Math.max(nw, 8));
        if (bar.label) bar.label.setAttribute('x', nx + nw + 6);
      }
      tip.replaceChildren(el('div', { class: 'g2-tip__title' }, bar.item.name), el('div', {}, `${d.start_date} ~ ${d.target_date} · ${window.isoDiff(d.start_date, d.target_date) + 1}일`));
      tip.style.display = 'block';
      const box = wrap.getBoundingClientRect();
      tip.style.left = `${e.clientX - box.left + 14}px`;
      tip.style.top = `${e.clientY - box.top + 16}px`;
    }
    const endDrag = async (e, cancel) => {
      if (!drag) return;
      const d = drag; drag = null;
      try { bodySvg.releasePointerCapture(d.pid); } catch { /* 무시 */ }
      tip.style.display = 'none';
      if (!d.moved) { select(d.id); return; }
      if (cancel || d.days === 0) { rerender(); return; }
      const dates = W.dragDates(d.node, d.mode, d.days);
      view.selected.set(p.id, d.id);
      try { await appState.updateProjectStage(d.id, dates); } catch (err) { toast(`저장하지 못했습니다: ${err.message || err}`, 'error'); }
    };
    bodySvg.addEventListener('pointerup', (e) => endDrag(e, false));
    bodySvg.addEventListener('pointercancel', (e) => endDrag(e, true));
    return card;
  }

  function legendItem(kind, color, label) {
    const sw = el('span', { class: `g2-sw g2-sw--${kind}`, style: `--c:${color}` });
    return el('span', { class: 'g2-legend__item' }, [sw, label]);
  }

  // ---------- 왼쪽 개요 한 줄 ----------
  function leftRow(p, tree, it, selectedId, collapsed, rerender, select, rows) {
    const node = tree.byId.get(it.id);
    const pending = !!node._pending || String(node.id).startsWith('tmp-');
    const row = el('div', { class: `g2-lrow${selectedId === it.id ? ' g2-lrow--sel' : ''}${it.hasChildren ? ' g2-lrow--parent' : ''}`, 'data-id': it.id, style: `height:${W.ROW_H}px`, onclick: (e) => { if (e.target.closest('button,input')) return; select(it.id); } });
    row.append(el('span', { class: 'g2-indent', style: `width:${it.depth * 14}px` }));
    row.append(it.hasChildren
      ? el('button', { type: 'button', class: 'g2-chev', title: it.collapsed ? '펼치기' : '접기', 'aria-expanded': String(!it.collapsed), 'aria-label': `${it.name} ${it.collapsed ? '펼치기' : '접기'}`, onclick: (e) => { e.stopPropagation(); if (collapsed.has(it.id)) collapsed.delete(it.id); else collapsed.add(it.id); rerender(); } }, it.collapsed ? '▸' : '▾')
      : el('span', { class: 'g2-chev g2-chev--none' }));
    row.append(el('span', { class: 'g2-num' }, it.number));
    row.append(el('span', { class: `g2-lvl g2-lvl--${it.levelIndex}`, title: `${it.level}분류(L${it.depth + 1})` }, it.level));
    const input = el('input', { class: 'g2-name', 'data-id': it.id, value: node.name, disabled: pending ? true : undefined, 'aria-label': `${it.number} 이름`, spellcheck: 'false' });
    let original = node.name;
    input.addEventListener('focus', () => { original = input.value; });
    input.addEventListener('change', async () => {
      const v = input.value.trim();
      if (!v) { input.value = original; return; }
      if (v === original) return;
      try { await appState.updateProjectStage(it.id, { name: v }); } catch (e) { input.value = original; toast(`저장하지 못했습니다: ${e.message || e}`, 'error'); }
    });
    input.addEventListener('keydown', async (e) => {
      if (e.isComposing) return;
      if (e.key === 'Escape') { input.value = original; input.blur(); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = input.value.trim();
        if (v && v !== original) { original = v; await appState.updateProjectStage(it.id, { name: v }).catch(() => {}); }
        await addSiblingAfter(p, node, rows);
        return;
      }
      if (e.key === 'Tab') { e.preventDefault(); view.selected.set(p.id, it.id); view.focusId = it.id; await moveNode(it.id, e.shiftKey ? 'outdent' : 'indent', rows); return; }
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); view.focusId = it.id; await moveNode(it.id, e.key === 'ArrowUp' ? 'up' : 'down', rows); }
    });
    input.addEventListener('focus', () => { if (view.selected.get(p.id) !== it.id) { view.selected.set(p.id, it.id); row.classList.add('g2-lrow--sel'); } });
    row.append(input);
    row.append(el('span', { class: 'g2-pct', title: it.hasChildren ? '하위 작업에서 자동 계산' : '진행률' }, it.kind === 'milestone' ? '◆' : `${it.progress}%`));
    row.append(el('button', { type: 'button', class: 'g2-add', title: '하위 추가', 'aria-label': `${it.name}의 하위 작업 추가`, disabled: pending ? true : undefined, onclick: (e) => { e.stopPropagation(); addChild(p, node, tree, collapsed); } }, '＋'));
    return row;
  }

  async function moveNode(id, action, rows) {
    const r = W.moveNode(rows, id, action);
    if (!r.ok) {
      const msg = { edge: '더 이상 이동할 수 없어요.', no_prev_sibling: '들여쓰려면 바로 위에 같은 단계의 항목이 있어야 해요.', max_depth: `최대 ${W.MAX_WBS_DEPTH}단계(대·중·소·세)까지만 만들 수 있어요.`, already_top: '이미 최상위(대분류)예요.' }[r.reason];
      if (msg) toast(msg, 'info');
      return;
    }
    try { await appState.updateProjectStages(r.patches); } catch (e) { toast(`저장하지 못했습니다: ${e.message || e}`, 'error'); }
  }

  async function addChild(p, parent, tree, collapsed) {
    if (parent) {
      const depth = W.depthOf(tree, parent.id);
      if (depth + 1 >= W.MAX_WBS_DEPTH) { toast(`최대 ${W.MAX_WBS_DEPTH}단계(대·중·소·세)까지만 만들 수 있어요.`, 'info'); return; }
      collapsed.delete(parent.id);
    }
    try {
      const row = await appState.addProjectStage(p.id, { name: '새 작업', parent_id: parent ? parent.id : null });
      view.selected.set(p.id, row.id);
      view.focusId = row.id;
      appState.emit('change', { table: 'project_stages', ui: true });
    } catch (e) { toast(`추가하지 못했습니다: ${e.message || e}`, 'error'); }
  }

  async function addSiblingAfter(p, node, rows) {
    const sibs = rows.filter((r) => (r.parent_id || null) === (node.parent_id || null) && r.project_id === node.project_id);
    const seq = (Number(node.seq) || 0) + 1;
    const bump = sibs.filter((r) => r.id !== node.id && (Number(r.seq) || 0) >= seq).map((r) => ({ id: r.id, patch: { seq: (Number(r.seq) || 0) + 1 } }));
    try {
      if (bump.length) await appState.updateProjectStages(bump);
      const row = await appState.addProjectStage(p.id, { name: '새 작업', parent_id: node.parent_id || null, seq });
      view.selected.set(p.id, row.id);
      view.focusId = row.id;
      appState.emit('change', { table: 'project_stages', ui: true });
    } catch (e) { toast(`추가하지 못했습니다: ${e.message || e}`, 'error'); }
  }

  // ---------- 빠른 추가(한 줄 + Enter, 들여쓴 목록 붙여넣기) ----------
  function quickAdd(p, tree, selectedId, collapsed) {
    const target = selectedId ? tree.byId.get(selectedId) : null;
    const targetDepth = target ? W.depthOf(tree, target.id) : -1;
    const canChild = target && targetDepth + 1 < W.MAX_WBS_DEPTH;
    let asChild = !!(canChild && view.parentFor.get(p.id) !== 'top');
    const ta = el('textarea', { class: 'nm-textarea wbs-quick', id: 'wbs-quick', rows: '1', placeholder: '작업 이름을 입력하고 Enter  (Shift+Enter 줄바꿈 · 들여쓴 목록 붙여넣기 가능)', 'aria-label': '작업 빠른 추가' });
    const where = el('select', { class: 'nm-select wbs-quick-where', id: 'wbs-quick-where', 'aria-label': '추가 위치' }, [
      el('option', { value: 'top', selected: !asChild || undefined }, '최상위(대분류)에'),
      canChild ? el('option', { value: 'child', selected: asChild || undefined }, `"${target.name.length > 14 ? target.name.slice(0, 13) + '…' : target.name}"의 하위에`) : null,
    ]);
    where.addEventListener('change', () => { asChild = where.value === 'child'; view.parentFor.set(p.id, asChild ? 'child' : 'top'); });
    const submit = async () => {
      const text = ta.value;
      if (!text.trim()) return;
      ta.disabled = true;
      try {
        const parentId = asChild && target ? target.id : null;
        if (parentId) collapsed.delete(parentId);
        const n = await appState.addProjectOutline(p.id, parentId, text);
        ta.value = '';
        if (n > 1) toast(`${n}개 항목을 추가했습니다.`, 'success');
        view.quickFocus = true;
      } catch (e) { toast(`추가하지 못했습니다: ${e.message || e}`, 'error'); }
      ta.disabled = false;
      if (view.quickFocus) { appState.emit('change', { table: 'project_stages', ui: true }); }
    };
    ta.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });
    ta.addEventListener('input', () => { ta.rows = Math.min(8, Math.max(1, ta.value.split('\n').length)); });
    queueMicrotask(() => { if (view.quickFocus && ta.isConnected) { ta.focus(); view.quickFocus = false; } });
    return el('div', { class: 'wbs-quickrow' }, [where, ta, el('button', { type: 'button', class: 'nm-btn nm-btn--primary', id: 'wbs-quick-btn', onclick: submit }, '+ 추가')]);
  }

  // ---------- 선택 항목 편집 패널 ----------
  function detailPanel(p, tree, roll, L, selectedId, numberOf, rerender, select, collapsed) {
    const host = el('div', { class: 'wbs-detail', id: 'wbs-detail' });
    const node = selectedId ? tree.byId.get(selectedId) : null;
    if (!node) {
      host.append(el('div', { class: 'text-muted', style: 'font-size:12.5px' }, '줄이나 막대를 누르면 날짜·진행률·선행 작업(의존관계)을 여기서 바로 고칠 수 있어요.'));
      return host;
    }
    const r = roll.get(node.id);
    const isParent = !r.isLeaf;
    const it = L.items.find((x) => x.id === node.id) || { number: numberOf.get(node.id), level: W.levelLabel(W.depthOf(tree, node.id)), slack: null, variance: null };
    const commit = async (patch) => { try { await appState.updateProjectStage(node.id, patch); } catch (e) { toast(`저장하지 못했습니다: ${e.message || e}`, 'error'); rerender(); } };
    const field = (label, input, cls = '') => el('label', { class: `wbs-f ${cls}` }, [el('span', { class: 'wbs-f__l' }, label), input]);
    const date = (name, value, extra = {}) => el('input', { class: 'nm-input', type: 'date', name, value: value || '', ...extra });

    const nameIn = el('input', { class: 'nm-input', id: 'wbs-d-name', value: node.name });
    nameIn.addEventListener('change', () => { const v = nameIn.value.trim(); if (!v) { nameIn.value = node.name; return; } commit({ name: v }); });

    const start = date('start_date', isParent ? r.start : node.start_date, { id: 'wbs-d-start', disabled: isParent || undefined, title: isParent ? '하위 작업에서 자동 계산' : '' });
    const end = date('target_date', isParent ? r.end : node.target_date, { id: 'wbs-d-end', disabled: isParent || undefined, title: isParent ? '하위 작업에서 자동 계산' : '' });
    const applyDates = () => {
      if (isParent) return;
      const s0 = start.value || null; let e0 = end.value || null;
      if (s0 && e0 && e0 < s0) { toast('종료일이 시작일보다 빠를 수 없어요.', 'error'); start.value = node.start_date || ''; end.value = node.target_date || ''; return; }
      commit({ start_date: s0, target_date: node.is_milestone ? s0 : e0 });
    };
    start.addEventListener('change', applyDates);
    end.addEventListener('change', applyDates);

    const prog = el('input', { class: 'nm-input', id: 'wbs-d-progress', type: 'number', min: '0', max: '100', step: '5', value: String(r.progress), disabled: isParent || node.is_milestone || undefined, title: isParent ? '하위 작업의 기간 가중 평균(자동)' : '' });
    prog.addEventListener('change', () => {
      const v = Math.min(100, Math.max(0, Math.round(Number(prog.value) || 0)));
      prog.value = String(v);
      commit({ progress: v, status: W.progressToStatus(v) });
    });
    const mile = el('input', { type: 'checkbox', id: 'wbs-d-milestone', checked: node.is_milestone || undefined, disabled: isParent || undefined });
    mile.addEventListener('change', () => commit(mile.checked ? { is_milestone: true, target_date: node.start_date || node.target_date || null, start_date: node.start_date || node.target_date || null } : { is_milestone: false }));

    const memo = el('input', { class: 'nm-input', id: 'wbs-d-memo', value: node.memo || '', placeholder: '메모(선택)' });
    memo.addEventListener('change', () => commit({ memo: memo.value.trim() || null }));
    const aStart = date('actual_start_date', node.actual_start_date, { id: 'wbs-d-astart' });
    const aEnd = date('actual_completion_date', node.actual_completion_date, { id: 'wbs-d-aend' });
    aStart.addEventListener('change', () => commit({ actual_start_date: aStart.value || null }));
    aEnd.addEventListener('change', () => commit({ actual_completion_date: aEnd.value || null }));

    const info = [`${it.number} · ${it.level}분류(L${W.depthOf(tree, node.id) + 1})`];
    if (isParent) info.push('기간·진행률은 하위 작업에서 자동 계산');
    else if (r.duration) info.push(`기간 ${r.duration}일`);
    if (it.slack !== null && it.slack !== undefined && !isParent) info.push(it.slack === 0 ? '여유 0일(임계)' : `여유 ${it.slack}일`);
    if (it.variance) info.push(`기준선 대비 종료 ${fmtDelta(it.variance.endDelta)}`);

    host.append(
      el('div', { class: 'wbs-detail__title' }, [el('strong', {}, '선택한 항목'), el('span', { class: 'text-muted', style: 'font-size:12px' }, info.join(' · '))]),
      el('div', { class: 'wbs-detail__grid' }, [
        field('이름', nameIn, 'wbs-f--name'),
        field(node.is_milestone ? '날짜' : '시작', start),
        node.is_milestone ? null : field('종료', end),
        field('진행률 %', prog, 'wbs-f--sm'),
        el('label', { class: 'wbs-f wbs-f--check' }, [mile, el('span', {}, '◆ 마일스톤')]),
      ]),
    );

    // 선행 작업(의존관계)
    if (!isParent) {
      const deps = (node.depends_on || []).map(W.parseDep).filter((d) => tree.byId.has(d.id));
      const chips = el('div', { class: 'wbs-deps' });
      for (const d of deps) {
        const t = tree.byId.get(d.id);
        chips.append(el('span', { class: 'wbs-dep-chip' }, [
          `${numberOf.get(d.id)} ${t.name}`, el('em', {}, DEP_SHORT[d.type]),
          el('button', { type: 'button', title: '선행 작업 제거', 'aria-label': `${t.name} 선행 제거`, onclick: () => commit({ depends_on: (node.depends_on || []).filter((x) => W.parseDep(x).id !== d.id) }) }, '×'),
        ]));
      }
      if (!deps.length) chips.append(el('span', { class: 'text-muted', style: 'font-size:12px' }, '선행 작업 없음'));
      const have = new Set(deps.map((d) => d.id));
      const cands = tree.order.filter((x) => !x.hasChildren && x.node.id !== node.id && !have.has(x.node.id) && !W.wouldCreateCycle(tree.order.map((o) => o.node), node.id, x.node.id));
      const sel = el('select', { class: 'nm-select', id: 'wbs-dep-select', 'aria-label': '선행 작업 선택' }, [el('option', { value: '' }, '+ 선행 작업 추가…'), ...cands.map((x) => el('option', { value: x.node.id }, `${x.number} ${x.node.name}`))]);
      const typ = el('select', { class: 'nm-select', id: 'wbs-dep-type', 'aria-label': '의존 유형' }, W.DEP_TYPES.map((t) => el('option', { value: t }, DEP_LABEL[t])));
      sel.addEventListener('change', () => { if (!sel.value) return; commit({ depends_on: [...(node.depends_on || []), W.formatDep(sel.value, typ.value)] }); });
      host.append(el('div', { class: 'wbs-detail__deps' }, [el('span', { class: 'wbs-f__l' }, '선행 작업'), chips, sel, typ]));
    }

    host.append(el('div', { class: 'wbs-detail__grid wbs-detail__grid--2' }, [
      field('메모', memo, 'wbs-f--name'), field('실제 시작', aStart), field('실제 완료', aEnd),
    ]));
    const v = window.varianceBadgeFor ? window.varianceBadgeFor(node.target_date, node.actual_completion_date) : null;
    const acts = el('div', { class: 'row wrap', style: 'gap:6px; margin-top:8px' }, [
      v ? el('span', { class: `nm-badge ${v.cls}` }, v.text) : null,
      el('button', { type: 'button', class: 'nm-btn', onclick: () => addChild(p, node, tree, collapsed) }, '＋ 하위 추가'),
      el('button', { type: 'button', class: 'nm-btn', title: '왼쪽으로(상위 단계로)', onclick: () => moveNode(node.id, 'outdent', tree.order.map((o) => o.node)) }, '⇤ 내어쓰기'),
      el('button', { type: 'button', class: 'nm-btn', title: '오른쪽으로(바로 위 항목의 하위로)', onclick: () => moveNode(node.id, 'indent', tree.order.map((o) => o.node)) }, '⇥ 들여쓰기'),
      el('button', { type: 'button', class: 'nm-btn nm-btn--icon', title: '위로', onclick: () => moveNode(node.id, 'up', tree.order.map((o) => o.node)) }, '↑'),
      el('button', { type: 'button', class: 'nm-btn nm-btn--icon', title: '아래로', onclick: () => moveNode(node.id, 'down', tree.order.map((o) => o.node)) }, '↓'),
      el('button', { type: 'button', class: 'nm-btn nm-btn--icon', title: '첨부파일', onclick: () => window.openAttachmentsModal('project_stages', node.id, node.name) }, '📎'),
      el('button', { type: 'button', class: 'nm-btn nm-btn--icon nm-btn--danger', id: 'wbs-d-delete', title: '삭제', onclick: async () => {
        const n = W.descendantIds(tree, node.id).length;
        if (!confirmDialog(`"${node.name}"${n ? ` 및 하위 ${n}개 항목` : ''}을(를) 삭제할까요?`)) return;
        try { await appState.deleteProjectStage(node.id); view.selected.delete(p.id); toast('삭제했습니다.', 'success'); } catch (e) { toast(`삭제하지 못했습니다: ${e.message || e}`, 'error'); }
      } }, '🗑'),
      el('button', { type: 'button', class: 'nm-btn', onclick: () => select(null) }, '닫기'),
    ]);
    host.append(acts);
    return host;
  }

  window.wbsCard = wbsCard;
})();
