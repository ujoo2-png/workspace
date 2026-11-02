// 시간·절차 계열 유형 (v7.32.0): 시퀀스 · 스윔레인 · 타임라인 · 간트 · 칸반 · 여정 · 스토리맵 · 서비스 블루프린트
(function (root) {
  'use strict';
  const C = root.DiagramCore;
  const { r1, up4, tw, txt, txtLines, wrap, ellip, boxEl, nodeSize, pathEl, maskedLabel, roundedPath, E } = C;
  const reg = (d) => C.register(d);
  const FAM = { flow: '흐름·논리', time: '시간·일정', work: '업무·경험' };
  const dayMs = 86400000;
  const pd = (s) => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

  // ── 시퀀스 ────────────────────────────────────────────────────────────
  reg({
    id: 'sequence', ko: '시퀀스', en: 'Sequence', family: FAM.flow, short: '주체 사이 메시지의 시간 순서',
    desc: '위에서 아래로 시간이 흐르며 주체(액터) 사이에 어떤 메시지가 오가는지 보여줍니다. 로그인·결제·API 호출처럼 "누가 누구에게 언제 무엇을"이 중요할 때 씁니다.',
    when: '인증 흐름, API 연동 설명, 장애 재현 순서', tips: '점선 = 응답/반환. 메시지 라벨은 짧게. 주체는 5명 이내.',
    sample: { title: '시세 조회 순서', actors: [{ id: 'u', label: '브라우저' }, { id: 'p', label: 'market-proxy', kind: 'focal' }, { id: 'n', label: '네이버 증권', kind: 'external' }],
      messages: [{ from: 'u', to: 'p', label: 'GET ?url=' }, { from: 'p', to: 'p', label: '허용 호스트 검사' }, { from: 'p', to: 'n', label: 'GET basic' }, { from: 'n', to: 'p', label: 'JSON', dashed: true }, { from: 'p', to: 'u', label: '200 JSON', dashed: true }] },
    budget: { nodes: 6, edges: 12 },
    render(d, ctx) {
      const t = ctx.tok; const actors = (d.actors || []).slice(0, 8); const msgs = d.messages || [];
      const ix = new Map(actors.map((a, i) => [a.id, i]));
      const sizes = actors.map((a) => nodeSize(ctx, a, { minW: 104 }));
      const gap = actors.map(() => 0);
      for (const m of msgs) {
        const a = ix.get(m.from), b = ix.get(m.to); if (a === undefined || b === undefined || a === b) continue;
        const lo = Math.min(a, b), hi = Math.max(a, b); const need = (tw(m.label || '', 9, true, 0.06) + 36) / (hi - lo);
        for (let i = lo; i < hi; i++) gap[i] = Math.max(gap[i], need);
      }
      const cx = []; let x = sizes[0] ? sizes[0].w / 2 : 0;
      actors.forEach((a, i) => { cx.push(x); if (i < actors.length - 1) x += Math.max(sizes[i].w / 2 + sizes[i + 1].w / 2 + 28, gap[i]); });
      const top = 0; const boxH = 48; let y = boxH + 36; const rowH = 44;
      let body = ''; const msgSvg = []; const H = y + msgs.length * rowH + 20;
      actors.forEach((a, i) => {
        ctx.counts.nodes++; ctx.blocks.push({ id: a.id, label: a.label, kind: a.kind || 'normal' }); ctx.table.push({ 구분: '주체', 이름: a.label, 설명: a.sub || '', 순서: '' });
        body += `<line x1="${r1(cx[i])}" x2="${r1(cx[i])}" y1="${boxH}" y2="${H}" stroke="${t.ruleSolid}" stroke-width="1" stroke-dasharray="3,4"/>`;
      });
      actors.forEach((a, i) => { body += ctx.anim('a', boxEl(ctx, { x: cx[i] - sizes[i].w / 2, y: top, w: sizes[i].w, h: boxH, name: a.label, lines: sizes[i].lines, sub: a.sub, kind: a.kind })); });
      msgs.forEach((m, k) => {
        const a = ix.get(m.from), b = ix.get(m.to); if (a === undefined || b === undefined) return;
        ctx.counts.edges++; ctx.table.push({ 구분: '메시지', 이름: `${actors[a].label} → ${actors[b].label}`, 설명: m.label || '', 순서: k + 1 });
        const kind = m.kind || 'plain';
        if (a === b) {
          const x0 = cx[a]; const pts = [[x0, y], [x0 + 36, y], [x0 + 36, y + 18], [x0, y + 18]];
          msgSvg.push(ctx.anim(`m${k}`, pathEl(ctx, pts, { kind, dashed: m.dashed, r: 6 }) + (m.label ? maskedLabel(ctx, x0 + 42 + tw(String(m.label).toUpperCase(), 8, true, 0.06) / 2 + 4, y + 9, m.label) : '')));
          y += rowH; return;
        }
        const y0 = y + 10;
        const pts = [[cx[a], y0], [cx[b], y0]];
        msgSvg.push(ctx.anim(`m${k}`, pathEl(ctx, pts, { kind, dashed: m.dashed }) + (m.label ? maskedLabel(ctx, (cx[a] + cx[b]) / 2, y0 - 12, m.label) : '')));
        y += rowH;
      });
      body += msgSvg.join('');
      const w = cx.length ? cx[cx.length - 1] + sizes[sizes.length - 1].w / 2 : 200;
      const lastLeft = sizes[0] ? sizes[0].w / 2 : 0;
      return { w: Math.max(w, 200), h: H, body, legend: [{ type: 'line', label: '요청' }, { type: 'line', label: '응답/반환', dashed: true }] };
    },
  });

  // ── 스윔레인 ──────────────────────────────────────────────────────────
  reg({
    id: 'swimlane', ko: '스윔레인', en: 'Swimlane', family: FAM.flow, short: '부서·역할 간 인계가 있는 업무',
    desc: '가로 레인(역할/부서)별로 단계를 배치해 "누가 일을 넘기는가"를 드러냅니다. 레인을 넘는 화살표가 곧 인계(handoff) 지점이라, 지연과 책임 공백을 찾기 좋습니다.',
    when: '업무 프로세스 개선, 승인 흐름, 협업 책임 정리', tips: 'steps[].lane = 레인 id, col = 0부터 시작하는 열 번호. 레인은 5개 이내.',
    sample: { title: '구매 승인 흐름', lanes: [{ id: 'a', label: '요청자' }, { id: 'b', label: '팀장' }, { id: 'c', label: '구매팀' }],
      steps: [{ id: '1', lane: 'a', col: 0, label: '요청서 작성' }, { id: '2', lane: 'b', col: 1, label: '검토', kind: 'focal' }, { id: '3', lane: 'c', col: 2, label: '발주' }, { id: '4', lane: 'a', col: 3, label: '수령 확인' }],
      edges: [{ from: '1', to: '2', label: '결재 요청' }, { from: '2', to: '3', label: '승인' }, { from: '3', to: '4', label: '납품', dashed: true }] },
    budget: { nodes: 10, edges: 12 },
    render(d, ctx) {
      const t = ctx.tok; const lanes = (d.lanes || []).slice(0, 6); const steps = d.steps || [];
      const laneIx = new Map(lanes.map((l, i) => [l.id, i]));
      const sz = new Map(steps.map((s) => [s.id, nodeSize(ctx, s, { minW: 112, maxW: 160 })]));
      const colCount = Math.max(1, ...steps.map((s) => (s.col || 0) + 1));
      const colW = Math.max(176, ...[...sz.values()].map((v) => v.w + 64));
      const laneH = Math.max(96, ...[...sz.values()].map((v) => v.h + 44));
      const labelW = Math.max(96, ...lanes.map((l) => tw(l.label, 11) + 36));
      const W = labelW + colCount * colW; const H = lanes.length * laneH;
      let body = '';
      lanes.forEach((l, i) => {
        body += `<rect x="0" y="${i * laneH}" width="${W}" height="${laneH}" fill="${i % 2 ? t.paper2 : t.paper}" fill-opacity="${i % 2 ? 0.4 : 0}" stroke="${t.rule}"/>` +
          `<rect x="0" y="${i * laneH}" width="${labelW}" height="${laneH}" fill="${t.paper2}" stroke="${t.rule}"/>` +
          txt(ctx, 14, i * laneH + laneH / 2 + 4, l.label, { size: 11, weight: 600 });
      });
      const pos = new Map();
      for (const s of steps) {
        const li = laneIx.get(s.lane); if (li === undefined) continue; const z = sz.get(s.id);
        const cxp = labelW + (s.col || 0) * colW + colW / 2, cyp = li * laneH + laneH / 2;
        pos.set(s.id, { x: cxp - z.w / 2, y: cyp - z.h / 2, w: z.w, h: z.h, cx: cxp, cy: cyp });
      }
      let edgeSvg = '', lab = '', k = 0;
      for (const e of d.edges || []) {
        const a = pos.get(e.from), b = pos.get(e.to); if (!a || !b) continue; ctx.counts.edges++;
        let pts;
        if (Math.abs(a.cy - b.cy) < 1) pts = [[a.x + a.w, a.cy], [b.x, b.cy]];
        else if (Math.abs(a.cx - b.cx) < 1) pts = [[a.cx, a.cy < b.cy ? a.y + a.h : a.y], [b.cx, a.cy < b.cy ? b.y : b.y + b.h]];
        else { const xm = a.x + a.w + (b.x - a.x - a.w) / 2 + ((k++ % 3) - 1) * 10; pts = [[a.x + a.w, a.cy], [xm, a.cy], [xm, b.cy], [b.x, b.cy]]; }
        edgeSvg += ctx.anim(`s${(steps.find((s) => s.id === e.to) || {}).col || 0}`, pathEl(ctx, pts, { kind: e.kind, dashed: e.dashed }));
        if (e.label) { const last = pts[pts.length - 1], prev = pts[pts.length - 2]; const horiz = Math.abs(last[1] - prev[1]) < 1; const len = Math.abs(last[0] - prev[0]); lab += horiz && len > tw(e.label, 8, true, 0.06) + 12 ? maskedLabel(ctx, (last[0] + prev[0]) / 2, last[1] - 11, e.label) : maskedLabel(ctx, pts[1][0] + 8 + tw(e.label, 8, true, 0.06) / 2, (pts[1][1] + (pts[2] || pts[1])[1]) / 2, e.label); ctx.table.push({ 구분: '인계', 이름: `${(steps.find((s) => s.id === e.from) || {}).label} → ${(steps.find((s) => s.id === e.to) || {}).label}`, 설명: e.label, 레인: '' }); }
      }
      let nodes = '';
      for (const s of steps) { const p = pos.get(s.id); if (!p) continue; ctx.counts.nodes++; ctx.blocks.push({ id: s.id, label: s.label, lane: s.lane }); ctx.table.push({ 구분: '단계', 이름: s.label, 설명: s.sub || '', 레인: (lanes.find((l) => l.id === s.lane) || {}).label || '' }); nodes += ctx.anim(`s${s.col || 0}`, boxEl(ctx, { x: p.x, y: p.y, w: p.w, h: p.h, name: s.label, lines: sz.get(s.id).lines, sub: s.sub, kind: s.kind, shape: s.shape })); }
      return { w: W, h: H, body: body + edgeSvg + nodes + lab, legend: [{ label: '초점', fill: t.accentTint, color: t.accent }, { type: 'line', label: '인계' }, { type: 'line', label: '비동기', dashed: true }] };
    },
  });

  // ── 타임라인 ──────────────────────────────────────────────────────────
  reg({
    id: 'timeline', ko: '타임라인', en: 'Timeline', family: FAM.time, short: '시간 위의 사건',
    desc: '시간 축 위에 사건을 순서대로 놓아 변화의 흐름을 보여줍니다. 위/아래로 번갈아 배치해 겹침을 피하고, 중요한 사건 1~2개만 강조합니다.',
    when: '제품 연혁, 프로젝트 이력, 사건 경과 보고', tips: 'events[].date는 표시용 문자열(예: 2025-03 또는 Q3). 정렬은 입력 순서 그대로.',
    sample: { title: '앱 버전 이력', events: [{ date: 'v7.24', title: '증권 메뉴', sub: '계좌·종목' }, { date: 'v7.29', title: '뉴스레터', sub: '피드 개선' }, { date: 'v7.30', title: '두 갈래 합치기', focal: true }, { date: 'v7.31', title: '드래그·네이버 시세' }, { date: 'v7.32', title: '다이어그램' }] },
    budget: { nodes: 8, edges: 0 },
    render(d, ctx) {
      const t = ctx.tok; const ev = (d.events || []).slice(0, C.DETAIL[ctx.S.detail].max + 2);
      const cardW = 156; const step = cardW + 16; const W = Math.max(ev.length * step, 360); const axisY = 150;
      let body = `<line x1="0" x2="${W}" y1="${axisY}" y2="${axisY}" stroke="${t.ruleSolid}" stroke-width="1.5"/>`;
      let cards = '';
      let minY = 0, maxY = axisY * 2;
      ev.forEach((e, i) => {
        ctx.counts.nodes++; ctx.blocks.push({ id: String(i), label: e.title, date: e.date }); ctx.table.push({ 구분: '사건', 날짜: e.date, 이름: e.title, 설명: e.sub || '' });
        const cx = i * step + step / 2; const above = i % 2 === 0; const foc = !!e.focal; if (foc) ctx.counts.accent++;
        const lines = wrap(e.title, 12, cardW - 20); const hh = 22 + lines.length * 15 + (e.sub && !ctx.exec ? 14 : 0) + 12;
        const y0 = above ? axisY - 36 - hh : axisY + 36;
        const stroke = foc ? t.accent : t.ink;
        let g = `<line x1="${r1(cx)}" x2="${r1(cx)}" y1="${above ? y0 + hh : axisY}" y2="${above ? axisY : y0}" stroke="${t.ruleSolid}" stroke-width="1"/>` +
          `<circle cx="${r1(cx)}" cy="${axisY}" r="5" fill="${foc ? t.accent : t.paper}" stroke="${stroke}" stroke-width="1.5"/>` +
          `<rect x="${r1(cx - cardW / 2)}" y="${r1(y0)}" width="${cardW}" height="${hh}" rx="6" fill="${foc ? t.accentTint : t.paper}" stroke="${stroke}" stroke-width="${foc ? 1.5 : 1}"/>` +
          txt(ctx, cx - cardW / 2 + 10, y0 + 16, e.date, { size: 9, mono: true, fill: foc ? t.accent : t.soft, weight: 500, upper: true, track: 0.1 }) +
          txtLines(ctx, cx - cardW / 2 + 10, y0 + 33, lines, { size: 12, weight: 600 }) + (e.sub && !ctx.exec ? txt(ctx, cx - cardW / 2 + 10, y0 + 33 + lines.length * 15, ellip(e.sub, 9, cardW - 20, true), { size: 9, mono: true, fill: t.soft }) : '');
        cards += ctx.anim(`t${i}`, g); minY = Math.min(minY, y0); maxY = Math.max(maxY, y0 + hh);
      });
      return { w: W, h: maxY - minY, body: `<g transform="translate(0,${-minY})">${body}${cards}</g>`, legend: [{ label: '핵심 사건', fill: t.accentTint, color: t.accent }] };
    },
  });

  // ── 간트 ──────────────────────────────────────────────────────────────
  reg({
    id: 'gantt', ko: '간트', en: 'Gantt', family: FAM.time, short: '작업 기간과 진행',
    desc: '작업별 시작~종료를 막대로 보여주고 진행률, 오늘 선, 마일스톤을 함께 표시합니다. 일정 겹침과 병목 구간을 한눈에 찾을 수 있습니다.',
    when: '프로젝트 일정, 릴리스 계획, 학습 계획', tips: 'tasks[].start/end = YYYY-MM-DD, progress 0~100, milestone:true면 마름모. today를 주면 오늘 선 표시.',
    sample: { title: '릴리스 일정', today: '2025-10-29', tasks: [
      { label: '설계', start: '2025-10-06', end: '2025-10-14', progress: 100, group: '준비' }, { label: '증권 개편', start: '2025-10-15', end: '2025-10-29', progress: 80, group: '개발', focal: true },
      { label: '다이어그램', start: '2025-10-27', end: '2025-11-12', progress: 20, group: '개발' }, { label: '테스트', start: '2025-11-08', end: '2025-11-18', progress: 0, group: '검증' }, { label: '배포', start: '2025-11-20', end: '2025-11-20', milestone: true, group: '검증' }] },
    budget: { nodes: 14, edges: 0 },
    render(d, ctx) {
      const t = ctx.tok; let tasks = (d.tasks || []).filter((x) => Number.isFinite(pd(x.start)));
      const cap = C.DETAIL[ctx.S.detail].max + 4; const warnings = [];
      if (tasks.length > cap) { warnings.push(`작업 ${tasks.length}개 중 ${cap}개만 표시했습니다(상세 수준 '충실'로 늘릴 수 있음).`); tasks = tasks.slice(0, cap); }
      if (!tasks.length) return { w: 320, h: 80, body: txt(ctx, 0, 40, '표시할 작업이 없습니다.', { size: 12, fill: t.soft }), legend: [], warnings };
      let mn = Math.min(...tasks.map((x) => pd(x.start))), mx = Math.max(...tasks.map((x) => pd(x.end && Number.isFinite(pd(x.end)) ? x.end : x.start)));
      const today = Number.isFinite(pd(d.today)) ? pd(d.today) : NaN; if (Number.isFinite(today)) { mn = Math.min(mn, today); mx = Math.max(mx, today); }
      mn -= dayMs; mx += 2 * dayMs; const span = Math.max(1, (mx - mn) / dayMs);
      const labelW = Math.max(120, Math.min(220, Math.max(...tasks.map((x) => tw(x.label, 12))) + 24)); const plotW = 620; const rowH = 32; const head = 34;
      const X = (ms) => labelW + ((ms - mn) / dayMs / span) * plotW;
      let body = '';
      // 눈금: 기간이 길면 월, 짧으면 주 단위
      const long = span > 75; const ticks = [];
      const dt = new Date(mn);
      if (long) { const c = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1)); while (c.getTime() < mx) { ticks.push(c.getTime()); c.setUTCMonth(c.getUTCMonth() + 1); } }
      else { const c = new Date(mn + ((8 - new Date(mn).getUTCDay()) % 7) * dayMs); while (c.getTime() < mx) { ticks.push(c.getTime()); c.setTime(c.getTime() + 7 * dayMs); } }
      const H = head + tasks.length * rowH + 8;
      for (const tk of ticks) body += `<line x1="${r1(X(tk))}" x2="${r1(X(tk))}" y1="${head - 6}" y2="${H}" stroke="${t.rule}"/>` + txt(ctx, X(tk) + 4, head - 12, long ? iso(tk).slice(0, 7) : iso(tk).slice(5), { size: 9, mono: true, fill: t.soft });
      let bars = ''; let lastGroup = null;
      tasks.forEach((x, i) => {
        const y = head + i * rowH; const s = pd(x.start); const e = Number.isFinite(pd(x.end)) ? pd(x.end) : s;
        ctx.counts.nodes++; if (x.focal) ctx.counts.accent++;
        ctx.blocks.push({ id: String(i), label: x.label, start: x.start, end: x.end || x.start }); ctx.table.push({ 구분: x.milestone ? '마일스톤' : '작업', 이름: x.label, 시작: x.start, 종료: x.end || x.start, 진행: x.progress != null ? `${x.progress}%` : '' });
        let g = txt(ctx, 0, y + 20, ellip(x.label, 12, labelW - 12), { size: 12, weight: x.focal ? 600 : 400 });
        if (x.group && x.group !== lastGroup && !ctx.exec) { g += txt(ctx, 0, y + 6, x.group, { size: 7, mono: true, upper: true, fill: t.soft, track: 0.14 }); }
        lastGroup = x.group;
        const stroke = x.focal ? t.accent : t.ink;
        if (x.milestone) { const cx = X(s) + (plotW / span) / 2; g += `<polygon points="${r1(cx)},${y + 6} ${r1(cx + 9)},${y + 16} ${r1(cx)},${y + 26} ${r1(cx - 9)},${y + 16}" fill="${x.focal ? t.accent : t.ink}"/>`; }
        else {
          const x1 = X(s), w = Math.max(6, X(e + dayMs) - x1); const pr = Math.max(0, Math.min(100, Number(x.progress) || 0));
          g += `<rect x="${r1(x1)}" y="${y + 8}" width="${r1(w)}" height="16" rx="4" fill="${x.focal ? t.accentTint : t.paper2}" stroke="${stroke}" stroke-width="1"/>`;
          if (pr > 0) g += `<rect x="${r1(x1)}" y="${y + 8}" width="${r1(w * pr / 100)}" height="16" rx="4" fill="${x.focal ? t.accent : t.soft}" fill-opacity="0.55"/>`;
          if (x1 + w + 70 < labelW + plotW + 60 && !ctx.exec) g += txt(ctx, x1 + w + 6, y + 20, x.progress != null ? `${pr}%` : '', { size: 9, mono: true, fill: t.soft });
        }
        bars += ctx.anim(`g${i}`, g);
      });
      let todaySvg = '';
      if (Number.isFinite(today)) { const tx = X(today) + (plotW / span) / 2; ctx.counts.accent += 0; todaySvg = `<line x1="${r1(tx)}" x2="${r1(tx)}" y1="${head - 6}" y2="${H}" stroke="${t.accent}" stroke-width="1.5" stroke-dasharray="4,3"/>` + `<rect x="${r1(tx - 20)}" y="${head - 26}" width="40" height="14" rx="2" fill="${t.paper}" stroke="${t.accent}"/>` + txt(ctx, tx, head - 16, '오늘', { size: 9, anchor: 'middle', fill: t.accent, weight: 600 }); }
      return { w: labelW + plotW + 60, h: H, body: body + bars + todaySvg, legend: [{ label: '핵심 작업', fill: t.accentTint, color: t.accent }, { label: '진행률', fill: t.soft, color: t.ink }, { type: 'line', label: '오늘', color: t.accent, dashed: true }], warnings };
    },
  });

  // ── 칸반 ──────────────────────────────────────────────────────────────
  reg({
    id: 'kanban', ko: '칸반', en: 'Kanban', family: FAM.work, short: '상태별 진행 중 작업과 WIP 한도',
    desc: '작업 카드를 상태 열(할 일/진행/완료)로 나눠 보여주고 열마다 WIP(동시 진행) 한도를 표시합니다. 한도를 넘거나 막힌(blocked) 카드를 강조해 병목을 드러냅니다.',
    when: '스프린트 현황, 작업 병목 점검', tips: 'columns[].limit 숫자를 주면 초과 시 강조. cards[].blocked:true면 점선 카드.',
    sample: { title: '이번 주 작업', columns: [{ label: '할 일', cards: [{ title: '환율 차트' }, { title: 'D-day 정리' }] }, { label: '진행', limit: 2, cards: [{ title: '다이어그램 엔진', focal: true }, { title: '드래그 순서' }, { title: '네이버 시세', tag: '검증' }] }, { label: '막힘', cards: [{ title: 'KIS 알림 문의', blocked: true }] }, { label: '완료', cards: [{ title: '증권 합치기' }] }] },
    budget: { nodes: 12, edges: 0 },
    render(d, ctx) {
      const t = ctx.tok; const cols = (d.columns || []).slice(0, 6); const cw = 176; const gap = 16; let maxH = 0; let body = '';
      cols.forEach((c, i) => {
        const x = i * (cw + gap); let y = 40; const cards = c.cards || [];
        const over = c.limit != null && cards.length > c.limit;
        let g = `<rect x="${x}" y="0" width="${cw}" height="30" rx="6" fill="${t.paper2}" stroke="${over ? t.accent : t.rule}" stroke-width="${over ? 1.5 : 1}"/>` + txt(ctx, x + 12, 19, c.label, { size: 12, weight: 600 }) + txt(ctx, x + cw - 12, 19, `${cards.length}${c.limit != null ? ' / ' + c.limit : ''}`, { size: 9, anchor: 'end', mono: true, fill: over ? t.accent : t.soft, weight: over ? 600 : 400 });
        if (over) ctx.counts.accent++;
        cards.forEach((k) => {
          ctx.counts.nodes++; ctx.blocks.push({ id: k.title, label: k.title, column: c.label }); ctx.table.push({ 구분: '카드', 이름: k.title, 열: c.label, 비고: k.blocked ? '막힘' : (k.tag || '') });
          const lines = wrap(k.title, 12, cw - 28); const h = 18 + lines.length * 15 + (k.tag && !ctx.exec ? 14 : 0);
          const foc = !!k.focal; if (foc) ctx.counts.accent++;
          g += `<rect x="${x}" y="${y}" width="${cw}" height="${h}" rx="6" fill="${foc ? t.accentTint : t.paper}" stroke="${foc ? t.accent : t.ink}" stroke-width="${foc ? 1.5 : 1}"${k.blocked ? ' stroke-dasharray="5,4"' : ''}/>` + txtLines(ctx, x + 12, y + 18, lines, { size: 12, weight: 500 }) + (k.tag && !ctx.exec ? txt(ctx, x + 12, y + 18 + lines.length * 15, k.tag, { size: 8, mono: true, upper: true, fill: t.soft, track: 0.1 }) : '') + (k.blocked ? txt(ctx, x + cw - 10, y + 14, '막힘', { size: 9, anchor: 'end', fill: t.accent, weight: 600 }) : '');
          y += h + 10;
        });
        body += ctx.anim(`c${i}`, g); maxH = Math.max(maxH, y);
      });
      return { w: Math.max(1, cols.length) * (cw + gap) - gap, h: Math.max(maxH, 80), body, legend: [{ label: '핵심', fill: t.accentTint, color: t.accent }, { label: '막힘', color: t.ink, dashed: true }] };
    },
  });

  // ── 사용자 여정 ───────────────────────────────────────────────────────
  reg({
    id: 'journey', ko: '사용자 여정', en: 'User journey', family: FAM.work, short: '단계별 행동과 감정 곡선',
    desc: '한 사람이 경험의 각 단계에서 무엇을 하고 어떻게 느끼는지를 감정 곡선과 함께 보여줍니다. 가장 낮은 지점이 개선의 출발점입니다.',
    when: '서비스 경험 개선, 온보딩 점검', tips: 'stages[].score는 -2(나쁨)~+2(좋음). 가장 낮은 단계가 자동으로 강조됩니다.',
    sample: { title: '새 사용자의 첫 사용', persona: '개발자 재영', stages: [{ label: '발견', action: '링크를 열어 본다', score: 1 }, { label: '가입', action: '승인 대기를 기다린다', score: -2 }, { label: '첫 등록', action: '증권 계좌를 입력', score: 0 }, { label: '활용', action: '매일 시세 확인', score: 2 }] },
    budget: { nodes: 8, edges: 0 },
    render(d, ctx) {
      const t = ctx.tok; const st = (d.stages || []).slice(0, 8); const cw = 170; const W = Math.max(1, st.length) * cw;
      const minScore = Math.min(...st.map((s) => Number(s.score) || 0)); let body = '';
      const curveTop = 150, curveH = 90;
      body += txt(ctx, 0, curveTop - 12, '감정', { size: 9, mono: true, upper: true, fill: t.soft, track: 0.14 }) + `<line x1="0" x2="${W}" y1="${curveTop + curveH / 2}" y2="${curveTop + curveH / 2}" stroke="${t.rule}" stroke-dasharray="3,4"/>`;
      const pts = st.map((s, i) => [i * cw + cw / 2, curveTop + curveH / 2 - ((Number(s.score) || 0) / 2) * (curveH / 2 - 6)]);
      if (pts.length > 1) body += `<polyline points="${pts.map((p) => p.map(r1).join(',')).join(' ')}" fill="none" stroke="${t.muted}" stroke-width="1.5"/>`;
      st.forEach((s, i) => {
        ctx.counts.nodes++; ctx.blocks.push({ id: String(i), label: s.label, score: s.score }); ctx.table.push({ 구분: '단계', 이름: s.label, 행동: s.action || '', 감정: s.score });
        const foc = (Number(s.score) || 0) === minScore && st.length > 1; if (foc) ctx.counts.accent++;
        const x = i * cw; const lines = wrap(s.action || '', 11, cw - 28);
        let g = `<rect x="${x + 6}" y="0" width="${cw - 12}" height="30" rx="6" fill="${foc ? t.accentTint : t.paper2}" stroke="${foc ? t.accent : t.rule}" stroke-width="${foc ? 1.5 : 1}"/>` + txt(ctx, x + cw / 2, 19, s.label, { size: 12, weight: 600, anchor: 'middle' }) +
          `<rect x="${x + 6}" y="40" width="${cw - 12}" height="${Math.max(60, lines.length * 14 + 24)}" rx="6" fill="${t.paper}" stroke="${t.ruleSolid}"/>` + txtLines(ctx, x + 18, 62, lines, { size: 11 });
        g += `<circle cx="${r1(pts[i][0])}" cy="${r1(pts[i][1])}" r="6" fill="${foc ? t.accent : t.paper}" stroke="${foc ? t.accent : t.ink}" stroke-width="1.5"/>` + txt(ctx, pts[i][0], curveTop + curveH + 22, String(s.score > 0 ? '+' + s.score : s.score ?? 0), { size: 9, mono: true, anchor: 'middle', fill: foc ? t.accent : t.soft, weight: 500 });
        body += ctx.anim(`j${i}`, g);
      });
      return { w: W, h: curveTop + curveH + 36, body, legend: [{ label: '가장 낮은 지점', fill: t.accentTint, color: t.accent }], };
    },
  });

  // ── 스토리 맵 ─────────────────────────────────────────────────────────
  reg({
    id: 'story-map', ko: '스토리 맵', en: 'Story map', family: FAM.work, short: '사용자 활동 뼈대 + 릴리스 구분',
    desc: '위에는 사용자 활동의 흐름(뼈대), 아래에는 그 활동을 이루는 스토리를 릴리스별로 층을 나눠 보여줍니다. "이번 릴리스에서 어디까지"의 선을 긋는 데 좋습니다.',
    when: '제품 범위 정하기, MVP 분할', tips: 'activities[].stories[].release = 1,2,3… 릴리스 이름은 releases 배열.',
    sample: { title: 'v1 범위', releases: ['MVP', '다음'], activities: [{ label: '등록', stories: [{ title: '계좌 추가', release: 1 }, { title: '엑셀 가져오기', release: 2 }] }, { label: '조회', stories: [{ title: '시세 표시', release: 1, focal: true }, { title: '환율 차트', release: 2 }] }, { label: '알림', stories: [{ title: '목표가 도달', release: 1 }, { title: '푸시', release: 2 }] }] },
    budget: { nodes: 14, edges: 0 },
    render(d, ctx) {
      const t = ctx.tok; const acts = (d.activities || []).slice(0, 6); const rels = d.releases && d.releases.length ? d.releases : ['릴리스 1']; const cw = 168; const gap = 14; let body = '';
      const rowH = (r) => Math.max(1, ...acts.map((a) => (a.stories || []).filter((s) => (s.release || 1) === r + 1).length)) * 44 + 12;
      let y = 46; const left = 0;
      acts.forEach((a, i) => { ctx.counts.nodes++; body += ctx.anim(`a${i}`, `<rect x="${i * (cw + gap)}" y="0" width="${cw}" height="34" rx="6" fill="${t.paper2}" stroke="${t.ink}"/>` + txt(ctx, i * (cw + gap) + cw / 2, 21, a.label, { size: 12, weight: 600, anchor: 'middle' })); });
      const W = Math.max(1, acts.length) * (cw + gap) - gap;
      rels.forEach((rn, r) => {
        const h = rowH(r);
        body += `<line x1="0" x2="${W}" y1="${y - 6}" y2="${y - 6}" stroke="${r === 0 ? t.accent : t.ruleSolid}" stroke-width="${r === 0 ? 1.5 : 1}" stroke-dasharray="${r === 0 ? '' : '4,4'}"/>` + txt(ctx, 0, y + 6, rn, { size: 8, mono: true, upper: true, fill: r === 0 ? t.accent : t.soft, weight: 500, track: 0.14 });
        acts.forEach((a, i) => {
          let yy = y + 14;
          (a.stories || []).filter((s) => (s.release || 1) === r + 1).forEach((s) => {
            ctx.counts.nodes++; if (s.focal) ctx.counts.accent++; ctx.blocks.push({ id: s.title, label: s.title, release: rn }); ctx.table.push({ 구분: '스토리', 이름: s.title, 활동: a.label, 릴리스: rn });
            body += ctx.anim(`r${r}`, `<rect x="${i * (cw + gap)}" y="${yy}" width="${cw}" height="32" rx="5" fill="${s.focal ? t.accentTint : t.paper}" stroke="${s.focal ? t.accent : t.ink}" stroke-width="${s.focal ? 1.5 : 1}"/>` + txt(ctx, i * (cw + gap) + 10, yy + 20, ellip(s.title, 11, cw - 20), { size: 11 }));
            yy += 40;
          });
        });
        y += h + 14;
      });
      return { w: W, h: y, body, legend: [{ label: '핵심 스토리', fill: t.accentTint, color: t.accent }, { type: 'line', label: '릴리스 경계', color: t.accent }] };
    },
  });

  // ── 서비스 블루프린트 ────────────────────────────────────────────────
  reg({
    id: 'service-blueprint', ko: '서비스 블루프린트', en: 'Service blueprint', family: FAM.work, short: '고객 행동 vs 보이지 않는 운영',
    desc: '단계별로 고객이 하는 일, 고객이 보는 응대, 뒤에서 일어나는 운영, 지원 시스템을 층으로 나누고 "가시선(line of visibility)"으로 경계를 긋습니다.',
    when: '서비스 설계, 운영 병목 찾기', tips: 'lanes: customer / front / back / support 배열(단계 수와 같게). focal은 문제 칸.',
    sample: { title: '계정 승인 서비스', stages: ['가입', '검토', '승인'], lanes: { customer: ['가입 신청', '대기', '로그인'], front: ['접수 안내', '', '승인 알림'], back: ['', '관리자 검토', '상태 변경'], support: ['Auth', 'profiles 테이블', 'RLS'] }, focal: { back: 1 } },
    budget: { nodes: 14, edges: 0 },
    render(d, ctx) {
      const t = ctx.tok; const stages = (d.stages || []).slice(0, 6); const cw = 164; const labelW = 96; const rows = [['customer', '고객 행동'], ['front', '프런트스테이지'], ['back', '백스테이지'], ['support', '지원 시스템']]; const rh = 64; let body = '';
      const W = labelW + stages.length * cw;
      stages.forEach((s, i) => { body += txt(ctx, labelW + i * cw + cw / 2, 12, s, { size: 9, anchor: 'middle', mono: true, upper: true, fill: t.soft, weight: 500, track: 0.14 }); });
      rows.forEach(([k, lbl], ri) => {
        const y = 28 + ri * rh;
        body += `<rect x="0" y="${y}" width="${W}" height="${rh}" fill="${ri % 2 ? t.paper2 : t.paper}" fill-opacity="${ri % 2 ? 0.45 : 0}" stroke="${t.rule}"/>` + txt(ctx, 10, y + rh / 2 + 4, lbl, { size: 10, weight: 600, fill: t.muted });
        stages.forEach((_, i) => {
          const v = ((d.lanes || {})[k] || [])[i]; if (!v) return; const foc = d.focal && d.focal[k] === i; if (foc) ctx.counts.accent++; ctx.counts.nodes++;
          ctx.table.push({ 구분: lbl, 단계: stages[i], 내용: v, 비고: foc ? '문제 지점' : '' });
          const lines = wrap(v, 11, cw - 36).slice(0, 2);
          body += ctx.anim(`b${i}`, `<rect x="${labelW + i * cw + 10}" y="${y + 10}" width="${cw - 20}" height="${rh - 20}" rx="5" fill="${foc ? t.accentTint : t.paper}" stroke="${foc ? t.accent : t.ink}" stroke-width="${foc ? 1.5 : 1}"/>` + txtLines(ctx, labelW + i * cw + cw / 2, y + rh / 2 + (lines.length > 1 ? -2 : 4), lines, { size: 11, anchor: 'middle', weight: 500 }));
        });
      });
      const ly = 28 + 2 * rh; body += `<line x1="0" x2="${W}" y1="${ly}" y2="${ly}" stroke="${t.accent}" stroke-width="1.5" stroke-dasharray="6,4"/>` + `<rect x="${W - 112}" y="${ly - 7}" width="104" height="14" rx="2" fill="${t.paper}"/>` + txt(ctx, W - 60, ly + 3, '가시선', { size: 8, anchor: 'middle', mono: true, upper: true, fill: t.accent, track: 0.14 });
      return { w: W, h: 28 + rows.length * rh + 6, body, legend: [{ label: '문제 지점', fill: t.accentTint, color: t.accent }, { type: 'line', label: '가시선(고객이 보는 경계)', color: t.accent, dashed: true }] };
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
