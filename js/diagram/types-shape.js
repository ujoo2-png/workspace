// 구조·도형 계열 유형 (v7.32.0): 트리 · 조직도 · 중첩 · 레이어 · 루프 · 피시본 · 워들리 · 분해(등각) · 평면(등각) · 보안 매트릭스
(function (root) {
  'use strict';
  const C = root.DiagramCore;
  const { r1, tw, txt, ellip, clamp, mix } = C;
  const reg = (d) => C.register(d);
  const FAM = { struct: '구조·계층', flow: '순환·인과', strat: '전략·보안' };
  const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const box = (ctx, x, y, w, h, label, o = {}) => { const t = ctx.tok; const foc = !!o.focal; if (foc) ctx.counts.accent++; ctx.counts.nodes++;
    return `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${o.rx ?? 6}" fill="${foc ? t.accentTint : (o.fill || t.paper)}" stroke="${foc ? t.accent : (o.stroke || t.ink)}" stroke-width="${foc ? 1.5 : 1}"/>` +
      txt(ctx, x + w / 2, y + h / 2 + (o.sub ? -2 : 4), ellip(label, o.size || 12, w - 12), { size: o.size || 12, anchor: 'middle', weight: 600, fill: foc ? t.accent : t.ink }) +
      (o.sub ? txt(ctx, x + w / 2, y + h / 2 + 12, ellip(o.sub, 9, w - 12), { size: 9, anchor: 'middle', mono: true, fill: t.soft }) : ''); };
  const ortho = (t, x1, y1, x2, y2) => { const my = (y1 + y2) / 2; return `<path d="M${r1(x1)},${r1(y1)} V${r1(my)} H${r1(x2)} V${r1(y2)}" fill="none" stroke="${t.muted}" stroke-width="1.2"/>`; };

  // 트리 / 조직도 공통 레이아웃
  function layoutTree(root0, ctx, bw, bh, gx, gy) {
    let leaf = 0; const nodes = []; const edges = [];
    (function walk(n, depth, parent) { n._d = depth; const kids = (n.children || []); kids.forEach((k) => walk(k, depth + 1, n));
      if (!kids.length) { n._x = leaf++; } else { n._x = (kids[0]._x + kids[kids.length - 1]._x) / 2; }
      nodes.push(n); if (parent) edges.push([parent, n]); })(root0, 0, null);
    const maxD = Math.max(...nodes.map((n) => n._d)); const lw = Math.max(1, leaf);
    return { nodes, edges, W: lw * (bw + gx) - gx, H: (maxD + 1) * (bh + gy) - gy, X: (n) => n._x * (bw + gx), Y: (n) => n._d * (bh + gy) };
  }
  function treeRender(d, ctx, org) {
    const t = ctx.tok; const bw = org ? 132 : 128, bh = org ? 52 : 34; const L = layoutTree(d.root || { label: '루트' }, ctx, bw, bh, 18, org ? 36 : 28); let b = '';
    L.edges.forEach(([p, c]) => { ctx.counts.edges++; b += ortho(t, L.X(p) + bw / 2, L.Y(p) + bh, L.X(c) + bw / 2, L.Y(c)); });
    L.nodes.forEach((n, i) => { ctx.table.push({ 항목: n.label, 상위: '', 설명: n.sub || '' }); ctx.blocks.push({ id: n.label, label: n.label }); b += ctx.anim(`n${n._d}`, box(ctx, L.X(n), L.Y(n), bw, bh, n.label, { focal: n.focal, sub: org ? n.sub : '', rx: org ? 6 : 4 })); });
    L.edges.forEach(([p, c]) => { const row = ctx.table.find((r) => r.항목 === c.label); if (row) row.상위 = p.label; });
    return { w: Math.max(L.W, bw), h: L.H, body: b, legend: [] };
  }
  reg({ id: 'tree', ko: '트리', en: 'Tree', family: FAM.struct, short: '분류·폴더 같은 계층 분해',
    desc: '하나의 뿌리에서 가지가 갈라지는 계층 구조입니다. 프로젝트 → 단계 → 작업, 카테고리 분류, 폴더 구조를 보여줄 때 씁니다.',
    when: '프로젝트 분해, 분류 체계', tips: 'root.children을 재귀로 중첩. 한 레벨에 7개 이하가 읽기 좋습니다.',
    sample: { root: { label: '나만의 Work Space', focal: true, children: [{ label: '일정', children: [{ label: '캘린더' }, { label: 'D-day' }] }, { label: '자산', children: [{ label: '증권' }, { label: '환율' }] }, { label: '정보', children: [{ label: '브리핑' }, { label: '지식' }] }] } },
    budget: { nodes: 14, edges: 13 }, render: (d, c) => treeRender(d, c, false) });
  reg({ id: 'org-chart', ko: '조직도', en: 'Org chart', family: FAM.struct, short: '보고 라인 · 역할 구성',
    desc: '사람·역할 간 보고 체계를 위에서 아래로 보여줍니다. 각 칸에 직함(sub)을 함께 적을 수 있습니다.',
    when: '팀 구성, 역할 분담, 의사결정 라인', tips: 'root.children 재귀. node.sub에 직함/역할.',
    sample: { root: { label: '나', sub: '오너', focal: true, children: [{ label: 'Claude', sub: '개발 보조', children: [{ label: '엔진', sub: '다이어그램' }, { label: 'UI', sub: '스튜디오' }] }, { label: 'Supabase', sub: '데이터' }, { label: 'Vercel', sub: '배포' }] } },
    budget: { nodes: 12, edges: 11 }, render: (d, c) => treeRender(d, c, true) });

  // 중첩
  reg({ id: 'nested', ko: '중첩(포함)', en: 'Nested', family: FAM.struct, short: '상자 안의 상자로 포함 관계',
    desc: '큰 범위 안에 작은 범위가 들어 있는 포함 관계를 겹겹의 상자로 보여줍니다. 시스템 경계, 신뢰 영역, 범위 설정에 좋습니다.',
    when: '경계·영역 설명, 범위 정의', tips: 'root.children 재귀(3단계 이내 권장). 가장 안쪽에 focal.',
    sample: { root: { label: '인터넷', children: [{ label: 'Vercel', children: [{ label: '정적 파일' }, { label: 'API 프록시', focal: true }] }, { label: 'Supabase', children: [{ label: 'DB + RLS' }, { label: 'Auth' }] }] } },
    budget: { nodes: 9, edges: 0 },
    render(d, ctx) { const t = ctx.tok; let b = '';
      const meas = (n) => { const k = (n.children || []).map(meas); if (!k.length) { n._w = Math.max(110, tw(n.label, 12) + 28); n._h = 36; return n; }
        n._cw = k.reduce((s, c) => s + c._w, 0) + (k.length - 1) * 12; n._ch = Math.max(...k.map((c) => c._h)); n._w = Math.max(n._cw + 24, tw(n.label, 12) + 28); n._h = n._ch + 48; return n; };
      const r0 = meas(d.root || { label: '루트' });
      const draw = (n, x, y, depth) => { const foc = !!n.focal; ctx.counts.nodes++; if (foc) ctx.counts.accent++; ctx.table.push({ 단계: depth, 항목: n.label }); ctx.blocks.push({ id: n.label, label: n.label });
        const kids = n.children || [];
        b += ctx.anim(`d${depth}`, `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(n._w)}" height="${r1(n._h)}" rx="${kids.length ? 10 : 6}" fill="${foc ? t.accentTint : kids.length ? mix(t.paper, t.paper2, depth % 2 ? 0.8 : 0.4) : t.paper}" stroke="${foc ? t.accent : t.ink}" stroke-width="${foc ? 1.5 : 1}" ${kids.length ? 'stroke-dasharray="' + (depth ? '5,3' : '0') + '"' : ''}/>` + txt(ctx, kids.length ? x + 12 : x + n._w / 2, y + (kids.length ? 18 : n._h / 2 + 4), n.label, { size: kids.length ? 10 : 12, mono: !!kids.length, upper: !!kids.length, track: kids.length ? 0.1 : 0, anchor: kids.length ? 'start' : 'middle', weight: 600, fill: foc ? t.accent : kids.length ? t.soft : t.ink }));
        let cx = x + (n._w - (n._cw || 0)) / 2; for (const k of kids) { draw(k, cx, y + 30 + (n._ch - k._h) / 2, depth + 1); cx += k._w + 12; } };
      draw(r0, 0, 0, 0); return { w: r0._w, h: r0._h, body: b, legend: [] }; } });

  // 레이어
  reg({ id: 'layers', ko: '레이어(층)', en: 'Layer stack', family: FAM.struct, short: '쌓인 층 구조',
    desc: '위에서 아래로 쌓인 계층(표현→로직→데이터 등)을 가로 띠로 보여줍니다. 각 층 안에 구성요소를 칩으로 나열합니다.',
    when: '아키텍처 스택, 프로토콜 계층', tips: 'layers[].label/items[]. 위가 사용자에 가까운 층.',
    sample: { layers: [{ label: '화면', items: ['index.html', '모듈 18개', '다이어그램'] }, { label: '상태·동기화', items: ['AppState', 'settingsSync'] }, { label: '저장소', items: ['LocalStore', 'SupabaseStore', 'RLS'], focal: true }, { label: '외부 API', items: ['KIS', '네이버', 'Frankfurter'] }] },
    budget: { nodes: 14, edges: 0 },
    render(d, ctx) { const t = ctx.tok; const ls = (d.layers || []).slice(0, 7); const W = 640; let b = ''; const lh = 64;
      ls.forEach((l, i) => { const foc = !!l.focal; if (foc) ctx.counts.accent++; ctx.counts.nodes++; ctx.table.push({ 층: l.label, 구성: (l.items || []).join(', ') }); ctx.blocks.push({ id: l.label, label: l.label });
        let g = `<rect x="0" y="${i * (lh + 8)}" width="${W}" height="${lh}" rx="6" fill="${foc ? t.accentTint : t.paper2}" stroke="${foc ? t.accent : t.ruleSolid}"/>` + txt(ctx, 14, i * (lh + 8) + 20, l.label, { size: 10, mono: true, upper: true, track: 0.12, fill: foc ? t.accent : t.soft, weight: 600 });
        let x = 14; (l.items || []).forEach((it) => { const w = tw(it, 11) + 20; g += `<rect x="${x}" y="${i * (lh + 8) + 30}" width="${w}" height="24" rx="4" fill="${t.paper}" stroke="${t.ink}"/>` + txt(ctx, x + w / 2, i * (lh + 8) + 46, it, { size: 11, anchor: 'middle' }); x += w + 8; });
        b += ctx.anim(`l${i}`, g); });
      return { w: W, h: ls.length * (lh + 8) - 8, body: b, legend: [] }; } });

  // 루프
  reg({ id: 'loop', ko: '순환 루프', en: 'Loop / cycle', family: FAM.flow, short: '되먹임 · 반복 사이클',
    desc: '단계가 원형으로 이어져 다시 처음으로 돌아오는 반복 구조입니다. 강화/균형 루프(R/B) 표시로 되먹임 성격을 알립니다.',
    when: '습관 루프, 개발 사이클, 되먹임', tips: 'steps[] 3~8개. loopType: "R"(강화)|"B"(균형).',
    sample: { loopType: 'R', steps: [{ label: '조사' }, { label: '구현', focal: true }, { label: '테스트' }, { label: '전달' }, { label: '피드백' }] },
    budget: { nodes: 8, edges: 8 },
    render(d, ctx) { const t = ctx.tok; const st = (d.steps || []).slice(0, 8); const n = Math.max(3, st.length); const R = 130, cx = 210, cy = 175; let b = ''; const P = (i) => { const a = -Math.PI / 2 + (i / n) * Math.PI * 2; return [cx + Math.cos(a) * R, cy + Math.sin(a) * R, a]; };
      for (let i = 0; i < st.length; i++) { const [x1, y1, a1] = P(i), [x2, y2, a2] = P((i + 1) % n); const aa = a1 + 0.38, bb = (i + 1 === n ? a2 + Math.PI * 2 : a2) - 0.38; ctx.counts.edges++;
        const sx = cx + Math.cos(aa) * R, sy = cy + Math.sin(aa) * R, ex = cx + Math.cos(bb) * R, ey = cy + Math.sin(bb) * R;
        b += `<path d="M${r1(sx)},${r1(sy)} A${R},${R} 0 0 1 ${r1(ex)},${r1(ey)}" fill="none" stroke="${t.muted}" stroke-width="1.5"/><polygon points="${(() => { const ang = bb + Math.PI / 2; const ax = ex, ay = ey; return [[ax, ay], [ax - Math.cos(ang) * 9 + Math.cos(bb) * 4, ay - Math.sin(ang) * 9 + Math.sin(bb) * 4], [ax - Math.cos(ang) * 9 - Math.cos(bb) * 4, ay - Math.sin(ang) * 9 - Math.sin(bb) * 4]].map((p) => p.map(r1).join(',')).join(' '); })()}" fill="${t.muted}"/>`; }
      st.forEach((s, i) => { const [x, y] = P(i); const w = Math.max(70, tw(s.label, 12) + 24); ctx.table.push({ 순서: i + 1, 단계: s.label }); ctx.blocks.push({ id: s.label, label: s.label }); b += ctx.anim(`s${i}`, box(ctx, x - w / 2, y - 16, w, 32, s.label, { focal: s.focal, rx: 16 })); });
      b += `<circle cx="${cx}" cy="${cy}" r="20" fill="${t.paper}" stroke="${t.ruleSolid}"/>` + txt(ctx, cx, cy + 5, d.loopType === 'B' ? 'B' : 'R', { size: 15, mono: true, anchor: 'middle', weight: 700, fill: t.accent });
      return { w: 420, h: 350, body: b, legend: [{ label: d.loopType === 'B' ? 'B = 균형 루프' : 'R = 강화 루프', fill: t.paper, color: t.accent }] }; } });

  // 피시본
  reg({ id: 'fishbone', ko: '피시본(원인-결과)', en: 'Fishbone', family: FAM.flow, short: '결과의 원인을 범주별로 추적',
    desc: '문제(머리)를 향해 범주별 원인 가지가 뻗는 생선뼈 구조입니다. 원인 분석·회고에서 빠뜨린 원인을 찾을 때 씁니다.',
    when: '장애/지연 원인 분석, 회고', tips: 'effect, categories[].label/causes[]. 범주는 4~6개.',
    sample: { effect: '일정 지연', categories: [{ label: '사람', causes: ['과부하', '요구 변경'] }, { label: '도구', causes: ['환경 제약', 'API 지연'], focal: true }, { label: '절차', causes: ['테스트 누락'] }, { label: '자료', causes: ['명세 부족', '데이터 오류'] }] },
    budget: { nodes: 14, edges: 0 },
    render(d, ctx) { const t = ctx.tok; const cats = (d.categories || []).slice(0, 6); const W = 700, H = 320, my = H / 2; const hw = Math.max(90, tw(d.effect || '', 13) + 28); let b = '';
      b += `<line x1="0" y1="${my}" x2="${W - hw}" y2="${my}" stroke="${t.ink}" stroke-width="2"/>` + box(ctx, W - hw, my - 24, hw, 48, d.effect || '결과', { focal: true });
      const per = Math.ceil(cats.length / 2); const colW = (W - hw - 40) / Math.max(1, per);
      cats.forEach((c, i) => { const top = i % 2 === 0; const col = Math.floor(i / 2); const bx = 40 + (col + 0.9) * colW; const ex = bx - 60; const ty = top ? 20 : H - 20; const foc = !!c.focal; if (foc) ctx.counts.accent++; ctx.counts.nodes++;
        ctx.table.push({ 범주: c.label, 원인: (c.causes || []).join(', ') }); ctx.blocks.push({ id: c.label, label: c.label });
        let g = `<line x1="${r1(ex)}" y1="${ty}" x2="${r1(bx)}" y2="${my}" stroke="${foc ? t.accent : t.muted}" stroke-width="1.5"/>` + txt(ctx, ex, top ? 12 : H - 2 + 4, c.label, { size: 11, mono: true, upper: true, track: 0.1, anchor: 'middle', weight: 600, fill: foc ? t.accent : t.ink });
        (c.causes || []).slice(0, 5).forEach((cs, k) => { const f = (k + 1) / ((c.causes || []).length + 1); const px = ex + (bx - ex) * f, py = ty + (my - ty) * f; ctx.counts.nodes++; g += `<line x1="${r1(px - 28)}" y1="${r1(py)}" x2="${r1(px)}" y2="${r1(py)}" stroke="${t.muted}"/>` + txt(ctx, px - 32, py + 4, ellip(cs, 11, 110), { size: 11, anchor: 'end' }); });
        b += ctx.anim(`c${i}`, g); });
      return { w: W, h: H, body: b, legend: [] }; } });

  // 워들리
  reg({ id: 'wardley', ko: '워들리 맵', en: 'Wardley map', family: FAM.strat, short: '가치사슬 × 진화 단계',
    desc: '세로축은 사용자에게 가까운 정도(가치사슬), 가로축은 성숙도(발상→맞춤→제품→유틸리티)로 구성요소를 배치해 어디에 투자하고 어디서 사 쓸지 판단합니다.',
    when: '자체 개발 vs 구매 판단, 기술 전략', tips: 'items[].x(0~100 진화) y(0~100 가치사슬) links[]=[from,to].',
    sample: { items: [{ id: 'u', label: '내 대시보드', x: 70, y: 92 }, { id: 'd', label: '다이어그램 엔진', x: 25, y: 62, focal: true }, { id: 'a', label: 'AppState', x: 55, y: 55 }, { id: 'db', label: 'Supabase', x: 85, y: 25 }, { id: 'h', label: '호스팅', x: 92, y: 10 }], links: [['u', 'd'], ['u', 'a'], ['a', 'db'], ['db', 'h']] },
    budget: { nodes: 12, edges: 14 },
    render(d, ctx) { const t = ctx.tok; const W = 560, H = 340, L = 30; let b = ''; const stages = ['발상', '맞춤 개발', '제품', '유틸리티'];
      stages.forEach((s, i) => { b += `<line x1="${L + (W / 4) * i}" y1="0" x2="${L + (W / 4) * i}" y2="${H}" stroke="${t.rule}" stroke-dasharray="3,3"/>` + txt(ctx, L + (W / 4) * i + W / 8, H + 18, s, { size: 10, mono: true, upper: true, anchor: 'middle', track: 0.1, fill: t.soft }); });
      b += `<rect x="${L}" y="0" width="${W}" height="${H}" fill="none" stroke="${t.ruleSolid}"/>` + txt(ctx, L - 6, 10, '사용자 ↑', { size: 9, mono: true, anchor: 'end', fill: t.soft }) + txt(ctx, L - 6, H, '기반', { size: 9, mono: true, anchor: 'end', fill: t.soft });
      const P = {}; (d.items || []).slice(0, 14).forEach((i) => { P[i.id] = [L + (clamp(N(i.x), 2, 98) / 100) * W, H - (clamp(N(i.y), 2, 98) / 100) * H]; });
      (d.links || []).forEach(([a, c]) => { if (P[a] && P[c]) { ctx.counts.edges++; b += `<line x1="${r1(P[a][0])}" y1="${r1(P[a][1])}" x2="${r1(P[c][0])}" y2="${r1(P[c][1])}" stroke="${t.muted}" stroke-width="1.2"/>`; } });
      (d.items || []).slice(0, 14).forEach((i, k) => { const [x, y] = P[i.id]; const foc = !!i.focal; if (foc) ctx.counts.accent++; ctx.counts.nodes++; ctx.table.push({ 구성요소: i.label, 진화: i.x, 가치사슬: i.y }); ctx.blocks.push({ id: i.id, label: i.label });
        b += ctx.anim(`w${k}`, `<circle cx="${r1(x)}" cy="${r1(y)}" r="7" fill="${foc ? t.accent : t.paper}" stroke="${foc ? t.accent : t.ink}" stroke-width="1.5"/>` + txt(ctx, x + 12, y + 4, i.label, { size: 11, fill: foc ? t.accent : t.ink, weight: foc ? 600 : 400 })); });
      return { w: W + L + 20, h: H + 30, body: b, legend: [] }; } });

  // 등각 공통
  const iso = (x, y, z) => [(x - y) * 0.866, (x + y) * 0.5 - z];
  function isoBlock(ctx, cx, cy, w, dpt, h, label, o = {}) { const t = ctx.tok; const foc = !!o.focal; if (foc) ctx.counts.accent++; ctx.counts.nodes++;
    const p = (x, y, z) => { const q = iso(x, y, z); return [cx + q[0], cy + q[1]]; }; const pts = (a) => a.map((q) => q.map(r1).join(',')).join(' ');
    const top = foc ? t.accentTint : mix(t.paper, t.paper2, 0.3), left = foc ? mix(t.accentTint, t.accent, 0.25) : t.paper2, right = foc ? mix(t.accentTint, t.accent, 0.4) : mix(t.paper2, t.ink, 0.1); const st = foc ? t.accent : t.ink;
    return `<polygon points="${pts([p(0, 0, h), p(w, 0, h), p(w, dpt, h), p(0, dpt, h)])}" fill="${top}" stroke="${st}"/><polygon points="${pts([p(0, dpt, h), p(w, dpt, h), p(w, dpt, 0), p(0, dpt, 0)])}" fill="${left}" stroke="${st}"/><polygon points="${pts([p(w, 0, h), p(w, dpt, h), p(w, dpt, 0), p(w, 0, 0)])}" fill="${right}" stroke="${st}"/>` +
      txt(ctx, p(w / 2, dpt / 2, h)[0], p(w / 2, dpt / 2, h)[1] + 4, ellip(label, 11, 110), { size: 11, anchor: 'middle', weight: 600, fill: foc ? t.accent : t.ink }); }
  reg({ id: 'exploded', ko: '분해도(등각)', en: 'Exploded view', family: FAM.strat, short: '층을 띄워 쌓은 등각 분해도',
    desc: '시스템을 층별로 위아래로 띄워 보여주는 등각(isometric) 분해도입니다. 어떤 층이 어떻게 겹쳐 있는지 직관적으로 보여줍니다.',
    when: '제품·시스템 구성 소개, 레이어 설명', tips: 'parts[] 위→아래 순서, 3~6개. focal 1개.',
    sample: { parts: [{ label: '화면' }, { label: '앱 로직' }, { label: '동기화', focal: true }, { label: '데이터' }] },
    budget: { nodes: 6, edges: 0 },
    render(d, ctx) { const t = ctx.tok; const ps = (d.parts || []).slice(0, 6); const gap = 84; let b = ''; const cx = 230, base = 40;
      ps.forEach((p, i) => { const cy = base + i * gap; ctx.table.push({ 층: i + 1, 이름: p.label }); ctx.blocks.push({ id: p.label, label: p.label });
        if (i) b += `<line x1="${cx}" y1="${cy - gap + 40}" x2="${cx}" y2="${cy - 4}" stroke="${t.muted}" stroke-dasharray="3,3"/>`;
        b += ctx.anim(`p${i}`, isoBlock(ctx, cx, cy, 120, 120, 14, p.label, { focal: p.focal })); });
      return { w: 460, h: base + ps.length * gap + 90, body: b, legend: [] }; } });
  reg({ id: 'axonometric-plan', ko: '축측 평면도', en: 'Axonometric plan', family: FAM.strat, short: '공간·영역 배치를 등각으로',
    desc: '영역(방·구역·서비스)을 격자에 올려 입체감 있게 보여주는 등각 평면도입니다. 무엇이 어디에 놓였는지, 크기 비율은 어떤지 보여줍니다.',
    when: '구역 배치, 인프라 영역, 공간 구성', tips: 'zones[].label/col/row/w/d (격자 단위). 겹치지 않게 배치.',
    sample: { zones: [{ label: '프론트', col: 0, row: 0, w: 2, d: 1 }, { label: 'API', col: 0, row: 1, w: 1, d: 1, focal: true }, { label: 'DB', col: 1, row: 1, w: 1, d: 1 }, { label: '외부', col: 2, row: 0, w: 1, d: 2 }] },
    budget: { nodes: 8, edges: 0 },
    render(d, ctx) { const zs = (d.zones || []).slice(0, 10); const U = 80; let b = ''; const cx = 300, cy = 40;
      zs.slice().sort((a, c) => (a.col + a.row) - (c.col + c.row)).forEach((z, i) => { ctx.table.push({ 구역: z.label, 위치: `${z.col},${z.row}`, 크기: `${z.w}×${z.d}` }); ctx.blocks.push({ id: z.label, label: z.label });
        const o = iso(N(z.col) * U, N(z.row) * U, 0); b += ctx.anim(`z${i}`, isoBlock(ctx, cx + o[0], cy + o[1], N(z.w || 1) * U - 6, N(z.d || 1) * U - 6, 10, z.label, { focal: z.focal })); });
      const maxc = Math.max(...zs.map((z) => N(z.col) + N(z.w || 1))), maxr = Math.max(...zs.map((z) => N(z.row) + N(z.d || 1)));
      return { w: 600, h: (maxc + maxr) * U * 0.5 + 100, body: b, legend: [] }; } });

  // 보안 매트릭스
  reg({ id: 'dp-security-matrix', ko: '보안 매트릭스', en: 'Security matrix', family: FAM.strat, short: '데이터 등급 × 통제 수단 표',
    desc: '데이터(또는 자산) 등급별로 어떤 보호 통제를 적용하는지 표로 보여줍니다. ●=적용, ◐=부분, ○=미적용 표기로 빈틈이 한눈에 보입니다.',
    when: '개인정보 보호 점검, 접근 통제 현황', tips: 'rows(등급/자산), cols(통제), cells[행][열]: 2=적용,1=부분,0=없음.',
    sample: { rows: ['계좌번호', '보유 종목', '일정', '북마크'], cols: ['암호화/마스킹', 'RLS', '로그인 필요', '내보내기 제외'], cells: [[2, 2, 2, 2], [1, 2, 2, 0], [0, 2, 2, 0], [0, 2, 2, 0]] },
    budget: { nodes: 20, edges: 0 },
    render(d, ctx) { const t = ctx.tok; const rows = (d.rows || []).slice(0, 12), cols = (d.cols || []).slice(0, 8); const lw = Math.max(90, ...rows.map((r) => tw(r, 12))) + 16; const cw = Math.max(86, ...cols.map((c) => tw(c, 11) + 14)); const rh = 36; let b = '';
      cols.forEach((c, j) => { b += txt(ctx, lw + j * cw + cw / 2, 14, c, { size: 11, anchor: 'middle', fill: t.muted }); });
      rows.forEach((r, i) => { b += txt(ctx, 0, 34 + i * rh + rh / 2 + 4, r, { size: 12, weight: 600 }) + `<line x1="0" x2="${lw + cols.length * cw}" y1="${28 + i * rh}" y2="${28 + i * rh}" stroke="${t.rule}"/>`; const rec = { 항목: r };
        cols.forEach((c, j) => { const v = N(((d.cells || [])[i] || [])[j]); rec[c] = ['미적용', '부분', '적용'][v] || '-'; ctx.counts.nodes++; const x = lw + j * cw + cw / 2, y = 28 + i * rh + rh / 2;
          const g = v === 2 ? `<circle cx="${x}" cy="${y}" r="7" fill="${t.ink}"/>` : v === 1 ? `<circle cx="${x}" cy="${y}" r="7" fill="${t.paper}" stroke="${t.ink}" stroke-width="1.5"/><path d="M${x},${y - 7} A7,7 0 0 1 ${x},${y + 7} Z" fill="${t.ink}"/>` : `<circle cx="${x}" cy="${y}" r="7" fill="none" stroke="${v === 0 ? t.accent : t.muted}" stroke-width="1.5"/>`;
          b += ctx.anim(`r${i}`, g); }); ctx.table.push(rec); ctx.blocks.push({ id: r, label: r }); });
      ctx.counts.accent = rows.reduce((s, _, i) => s + cols.filter((_, j) => N(((d.cells || [])[i] || [])[j]) === 0).length, 0) > 0 ? 1 : 0;
      return { w: lw + cols.length * cw, h: 28 + rows.length * rh + 6, body: b, legend: [{ label: '● 적용', fill: t.ink, color: t.ink }, { label: '◐ 부분', fill: t.paper, color: t.ink }, { label: '○ 미적용(빨강 테두리)', fill: t.paper, color: t.accent }] }; } });
})(typeof window !== 'undefined' ? window : globalThis);
