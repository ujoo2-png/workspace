// 계층형(layered) 그래프 배치 + 직각 연결선 (v7.32.0)
// 원본 규칙: 직각 꺾임만, 라벨 마스크, 같은 변의 연결점 분산, 겹침 없는 평행선, 노드 뒤로 지나가지 않기(더미 노드로 우회).
(function (root) {
  'use strict';
  const C = root.DiagramCore;
  const { r1, up4, tw, txt, pathEl, boxEl, nodeSize, maskedLabel, E } = C;

  /** 노드 수 상한(상세 수준). 초과분은 "…외 N개" 한 노드로 합친다. */
  function capGraph(nodes, edges, max) {
    if (nodes.length <= max) return { nodes, edges, merged: 0 };
    const deg = {};
    for (const e of edges) { deg[e.from] = (deg[e.from] || 0) + 1; deg[e.to] = (deg[e.to] || 0) + 1; }
    const score = (n) => (n.kind === 'focal' || n.focal ? 1000 : 0) + (deg[n.id] || 0) * 10 - nodes.indexOf(n) * 0.01;
    const keep = [...nodes].sort((a, b) => score(b) - score(a)).slice(0, max - 1);
    const keepIds = new Set(keep.map((n) => n.id));
    const rest = nodes.filter((n) => !keepIds.has(n.id));
    const more = { id: '__more', label: `…외 ${rest.length}개`, sub: rest.slice(0, 3).map((n) => n.label || n.id).join(', '), kind: 'optional' };
    const outNodes = nodes.filter((n) => keepIds.has(n.id)).concat([more]);
    const seen = new Set(); const outEdges = [];
    for (const e of edges) {
      const f = keepIds.has(e.from) ? e.from : '__more', t = keepIds.has(e.to) ? e.to : '__more';
      if (f === t) continue;
      const k = `${f}>${t}`; if (seen.has(k)) continue; seen.add(k);
      outEdges.push({ ...e, from: f, to: t });
    }
    return { nodes: outNodes, edges: outEdges, merged: rest.length };
  }

  function layout(nodes, edges, o = {}) {
    const dir = o.dir === 'TB' ? 'TB' : 'LR';
    const idx = new Map(nodes.map((n, i) => [n.id, i]));
    const E2 = edges.filter((e) => idx.has(e.from) && idx.has(e.to) && e.from !== e.to);
    // 1) 순환 끊기(DFS 역방향 간선 뒤집기)
    const out = new Map(nodes.map((n) => [n.id, []]));
    for (const e of E2) out.get(e.from).push(e);
    const state = new Map(); const rev = new Set();
    const dfs = (u) => { state.set(u, 1); for (const e of out.get(u)) { const s = state.get(e.to); if (s === 1) rev.add(e); else if (!s) dfs(e.to); } state.set(u, 2); };
    for (const n of nodes) if (!state.get(n.id)) dfs(n.id);
    const dag = E2.map((e) => ({ e, a: rev.has(e) ? e.to : e.from, b: rev.has(e) ? e.from : e.to, rev: rev.has(e) }));
    // 2) 순위(최장 경로). rank가 지정된 노드는 고정
    const rank = new Map();
    const fixed = new Set(nodes.filter((n) => Number.isFinite(n.rank)).map((n) => n.id));
    for (const n of nodes) if (fixed.has(n.id)) rank.set(n.id, n.rank);
    const preds = new Map(nodes.map((n) => [n.id, []]));
    for (const d of dag) preds.get(d.b).push(d.a);
    const memo = new Map();
    const rk = (id, guard = 0) => {
      if (rank.has(id)) return rank.get(id);
      if (memo.has(id)) return memo.get(id);
      if (guard > 200) return 0;
      let r = 0; for (const p of preds.get(id)) r = Math.max(r, rk(p, guard + 1) + 1);
      memo.set(id, r); return r;
    };
    for (const n of nodes) rank.set(n.id, rk(n.id));
    // 고정 순위 때문에 역행/동일 순위가 된 간선은 후속 처리에서 lateral/back으로 취급
    const maxRank = Math.max(0, ...rank.values());
    // 3) 더미 노드로 긴 간선 분할
    const L = nodes.map((n) => ({ id: n.id, real: true, n, r: rank.get(n.id), m: dir === 'LR' ? n.w : n.h, c: dir === 'LR' ? n.h : n.w }));
    const byId = new Map(L.map((x) => [x.id, x]));
    const chains = [];
    let dn = 0;
    for (const d of dag) {
      const ra = rank.get(d.a), rb = rank.get(d.b);
      if (rb <= ra) { chains.push({ e: d.e, rev: d.rev, ids: [d.a, d.b], lateral: true }); continue; }
      const ids = [d.a];
      for (let r = ra + 1; r < rb; r++) { const id = `__d${dn++}`; const x = { id, real: false, r, m: 0, c: 10 }; L.push(x); byId.set(id, x); ids.push(id); }
      ids.push(d.b);
      chains.push({ e: d.e, rev: d.rev, ids });
    }
    // 4) 순서 정하기(바리센터)
    const cols = []; for (let r = 0; r <= maxRank; r++) cols.push([]);
    for (const x of L) cols[x.r].push(x);
    const nb = new Map(L.map((x) => [x.id, { up: [], down: [] }]));
    for (const ch of chains) { if (ch.lateral) continue; for (let i = 0; i < ch.ids.length - 1; i++) { nb.get(ch.ids[i]).down.push(ch.ids[i + 1]); nb.get(ch.ids[i + 1]).up.push(ch.ids[i]); } }
    const pos = new Map(); const reindex = () => cols.forEach((col) => col.forEach((x, i) => pos.set(x.id, i)));
    reindex();
    const bary = (x, side) => { const ns = nb.get(x.id)[side]; if (!ns.length) return pos.get(x.id); return ns.reduce((s, id) => s + pos.get(id), 0) / ns.length; };
    for (let it = 0; it < 4; it++) {
      for (let r = 1; r <= maxRank; r++) { cols[r] = cols[r].map((x, i) => ({ x, k: bary(x, 'up'), i })).sort((a, b) => a.k - b.k || a.i - b.i).map((v) => v.x); reindex(); }
      for (let r = maxRank - 1; r >= 0; r--) { cols[r] = cols[r].map((x, i) => ({ x, k: bary(x, 'down'), i })).sort((a, b) => a.k - b.k || a.i - b.i).map((v) => v.x); reindex(); }
    }
    // 같은 그룹은 인접하도록 안정 정렬(그룹 상자가 겹치지 않게)
    if (nodes.some((n) => n.group)) {
      const gOrder = new Map(); for (const n of nodes) if (n.group && !gOrder.has(n.group)) gOrder.set(n.group, gOrder.size);
      for (let r = 0; r <= maxRank; r++) {
        const avg = new Map();
        cols[r].forEach((x, i) => { const g = x.real ? x.n.group : null; if (g) { const a = avg.get(g) || { s: 0, n: 0 }; a.s += i; a.n++; avg.set(g, a); } });
        cols[r] = cols[r].map((x, i) => ({ x, i, k: x.real && x.n.group ? avg.get(x.n.group).s / avg.get(x.n.group).n : i })).sort((a, b) => a.k - b.k || a.i - b.i).map((v) => v.x);
      }
      reindex();
    }
    // 5) 교차축 좌표
    const sep = o.nodeSep || 28;
    const cpos = new Map();
    for (const col of cols) { let y = 0; for (const x of col) { cpos.set(x.id, y + x.c / 2); y += x.c + (x.real ? sep : 12); } }
    const pull = (col, side) => {
      let prevEnd = -Infinity;
      for (const x of col) {
        const ns = nb.get(x.id)[side];
        const want = ns.length ? ns.reduce((s, id) => s + cpos.get(id), 0) / ns.length : cpos.get(x.id);
        const minC = prevEnd === -Infinity ? -Infinity : prevEnd + (x.real ? sep : 12) + x.c / 2;
        const c = Math.max(minC, want);
        cpos.set(x.id, c); prevEnd = c + x.c / 2;
      }
    };
    for (let it = 0; it < 6; it++) {
      for (let r = 1; r <= maxRank; r++) pull(cols[r], 'up');
      for (let r = maxRank - 1; r >= 0; r--) pull(cols[r], 'down');
    }
    // 위쪽에서 눌린 노드를 다시 위로 밀기(역방향 패스로 음수 간격 방지)
    for (let r = 0; r <= maxRank; r++) { const col = cols[r]; for (let i = col.length - 2; i >= 0; i--) { const a = col[i], b = col[i + 1]; const maxC = cpos.get(b.id) - b.c / 2 - (a.real ? sep : 12) - a.c / 2; if (cpos.get(a.id) > maxC) cpos.set(a.id, maxC); } }
    // 6) 주축 좌표 + 간격 폭(라벨/평행선 수에 비례)
    const gapNeed = new Array(maxRank + 1).fill(0);
    const gapLabelW = new Array(maxRank + 1).fill(0);
    for (const ch of chains) {
      if (ch.lateral) continue;
      for (let i = 0; i < ch.ids.length - 1; i++) { const r = byId.get(ch.ids[i]).r; gapNeed[r]++; }
      if (ch.e.label) { const r = byId.get(ch.ids[ch.ids.length - 2]).r; gapLabelW[r] = Math.max(gapLabelW[r], ch.e.label.length ? tw(String(ch.e.label).toUpperCase(), 8, true, 0.06) + 12 : 0); }
    }
    const rankSize = cols.map((col) => Math.max(0, ...col.map((x) => x.m)));
    const mstart = []; let mcur = 0;
    for (let r = 0; r <= maxRank; r++) {
      mstart.push(mcur);
      const baseGap = dir === 'LR' ? 72 : 56;
      const labelNeed = dir === 'LR' ? 24 + gapNeed[r] * 8 + gapLabelW[r] + 16 : 28 + (gapLabelW[r] ? 16 : 0);
      mcur += rankSize[r] + (r < maxRank ? Math.max(baseGap, 28 + gapNeed[r] * 10, labelNeed) : 0);
    }
    const mpos = new Map(); // 중심
    for (const x of L) {
      const r = x.r;
      mpos.set(x.id, x.real ? mstart[r] + (rankSize[r] - x.m) / 2 + x.m / 2 : mstart[r] + rankSize[r] / 2);
    }
    // 7) 연결점 분산
    const attach = new Map(); // `${id}|out` → [{key, other}]
    const reg = (id, side, key, otherC) => { const k = `${id}|${side}`; if (!attach.has(k)) attach.set(k, []); attach.get(k).push({ key, otherC }); };
    chains.forEach((ch, ci) => {
      if (ch.lateral) return;
      for (let i = 0; i < ch.ids.length - 1; i++) {
        reg(ch.ids[i], 'out', `${ci}:${i}`, cpos.get(ch.ids[i + 1]));
        reg(ch.ids[i + 1], 'in', `${ci}:${i}`, cpos.get(ch.ids[i]));
      }
    });
    const off = new Map();
    for (const [k, list] of attach) {
      const id = k.split('|')[0]; const x = byId.get(id);
      list.sort((a, b) => a.otherC - b.otherC);
      const N = list.length;
      list.forEach((it, j) => {
        if (!x.real || N === 1) { off.set(`${k}:${it.key}`, 0); return; }
        const span = Math.max(x.c - 16, 0);
        const step = Math.min(span / (N - 1 || 1), 16);
        off.set(`${k}:${it.key}`, (j - (N - 1) / 2) * step);
      });
    }
    // 8) 경로 만들기
    const gapLanes = Array.from({ length: maxRank + 1 }, () => []);
    const hops = [];
    chains.forEach((ch, ci) => {
      if (ch.lateral) return;
      for (let i = 0; i < ch.ids.length - 1; i++) {
        const a = byId.get(ch.ids[i]), b = byId.get(ch.ids[i + 1]);
        const ya = cpos.get(a.id) + (off.get(`${a.id}|out:${ci}:${i}`) || 0);
        const yb = cpos.get(b.id) + (off.get(`${b.id}|in:${ci}:${i}`) || 0);
        hops.push({ ci, i, a, b, ya, yb, r: a.r });
      }
    });
    // 간격별 수직 구간 차선 배정(겹치지 않게)
    for (const h of hops) {
      if (Math.abs(h.ya - h.yb) < 0.5) { h.lane = -1; continue; }
      const lo = Math.min(h.ya, h.yb) - 6, hi = Math.max(h.ya, h.yb) + 6;
      const lanes = gapLanes[h.r];
      let li = 0; for (; li < lanes.length; li++) if (!lanes[li].some(([a, b]) => !(hi < a || lo > b))) break;
      if (!lanes[li]) lanes[li] = [];
      lanes[li].push([lo, hi]); h.lane = li;
    }
    const gapStartOf = (r) => mstart[r] + rankSize[r];
    const hopPts = new Map();
    for (const h of hops) {
      const dm = (x, offc) => (x.real && x.n.shape === 'diamond' && x.c > 0 ? (x.m / 2) * (Math.min(Math.abs(offc), x.c / 2) / (x.c / 2)) : 0);
      const aEnd = h.a.real ? mpos.get(h.a.id) + h.a.m / 2 - dm(h.a, h.ya - cpos.get(h.a.id)) : mpos.get(h.a.id);
      const bStart = h.b.real ? mpos.get(h.b.id) - h.b.m / 2 + dm(h.b, h.yb - cpos.get(h.b.id)) : mpos.get(h.b.id);
      const gs = gapStartOf(h.r);
      const pts = [[aEnd, h.ya]];
      if (h.lane >= 0) { const xm = gs + 20 + h.lane * 12; pts.push([xm, h.ya], [xm, h.yb]); }
      pts.push([bStart, h.yb]);
      hopPts.set(`${h.ci}:${h.i}`, pts);
    }
    const edgesOut = chains.map((ch, ci) => {
      let pts = [];
      if (ch.lateral) {
        const a = byId.get(ch.ids[0]), b = byId.get(ch.ids[1]);
        const m1 = mpos.get(a.id), c1 = cpos.get(a.id), c2 = cpos.get(b.id);
        const sgn = c2 >= c1 ? 1 : -1;
        pts = [[m1, c1 + sgn * a.c / 2], [m1, c2 - sgn * b.c / 2]];
      } else {
        for (let i = 0; i < ch.ids.length - 1; i++) { const hp = hopPts.get(`${ci}:${i}`); pts = pts.concat(i === 0 ? hp : hp.slice(1)); }
      }
      if (ch.rev) pts = pts.slice().reverse();
      return { e: ch.e, pts, lateral: !!ch.lateral, rev: ch.rev, srcRank: rank.get(ch.rev ? ch.e.to : ch.e.from), dstRank: rank.get(ch.rev ? ch.e.from : ch.e.to) };
    });
    // 9) 화면 좌표로 변환
    const f = dir === 'LR' ? (m, c) => [m, c] : (m, c) => [c, m];
    const placed = nodes.map((n) => { const x = byId.get(n.id); const [cx, cy] = f(mpos.get(n.id), cpos.get(n.id)); return { ...n, x: cx - n.w / 2, y: cy - n.h / 2, rank: x.r }; });
    const edgesScreen = edgesOut.map((e) => ({ ...e, pts: e.pts.map(([m, c]) => f(m, c)) }));
    return { nodes: placed, edges: edgesScreen, dir, mstart, rankSize, maxRank };
  }

  /** 간선 그리기(라벨 제외) + 라벨 좌표 계산. */
  function drawEdges(ctx, edges, dir) {
    let body = ''; let labels = '';
    for (const ed of edges) {
      const e = ed.e;
      const kind = e.kind || 'plain';
      body += ctx.anim(`e${ed.dstRank}`, pathEl(ctx, ed.pts, { kind, dashed: !!e.dashed, arrow: e.arrow !== false, marker: e.marker, startMarker: e.startMarker }));
      ctx.counts.edges++;
      if (kind === 'accent') ctx.counts.accent += 0; // 선의 강조는 노드 강조와 별도 집계하지 않음
      if (e.label) {
        // 가장 긴 직선 구간을 찾아 그 옆에 마스크 라벨을 둔다.
        let best = null;
        for (let i = 0; i < ed.pts.length - 1; i++) {
          const [x1, y1] = ed.pts[i], [x2, y2] = ed.pts[i + 1];
          const len = Math.abs(x2 - x1) + Math.abs(y2 - y1);
          if (!best || len > best.len + 0.1 || (i === ed.pts.length - 2 && len >= best.len - 0.1)) best = { x1, y1, x2, y2, len, horiz: Math.abs(y2 - y1) < 0.5 };
        }
        if (best) {
          const lw = tw(String(e.label).toUpperCase(), 8, true, 0.06) + 8;
          const wide = [...String(e.label)].some((c) => C.isWide(c.codePointAt(0)));
          const w2 = wide ? tw(e.label, 12) + 8 : lw;
          if (best.horiz) {
            const cx = (best.x1 + best.x2) / 2 + (best.x2 > best.x1 ? 4 : -4); labels += maskedLabel(ctx, cx, best.y1 - (wide ? 12 : 10), e.label);
          } else {
            const cx = best.x1 + 8 + w2 / 2; labels += maskedLabel(ctx, cx, (best.y1 + best.y2) / 2, e.label);
          }
        }
      }
    }
    return { body, labels };
  }

  /** 그룹(영역) 상자. */
  function drawGroups(ctx, placed, groups) {
    const t = ctx.tok; const byG = new Map();
    for (const n of placed) if (n.group) { if (!byG.has(n.group)) byG.set(n.group, []); byG.get(n.group).push(n); }
    let s = ''; const boxes = [];
    for (const [g, list] of byG) {
      const x1 = Math.min(...list.map((n) => n.x)) - 18, y1 = Math.min(...list.map((n) => n.y)) - 30;
      const x2 = Math.max(...list.map((n) => n.x + n.w)) + 18, y2 = Math.max(...list.map((n) => n.y + n.h)) + 18;
      const label = (groups || []).find((x) => x.id === g)?.label || g;
      s += `<rect x="${r1(x1)}" y="${r1(y1)}" width="${r1(x2 - x1)}" height="${r1(y2 - y1)}" rx="8" fill="${t.paper2}" fill-opacity="0.55" stroke="${t.ruleSolid}" stroke-width="1" stroke-dasharray="4,4"/>` +
        txt(ctx, x1 + 12, y1 + 16, label, { size: 9, mono: true, fill: t.soft, weight: 500, upper: true, track: 0.14 });
      boxes.push([x1, y1, x2, y2]);
    }
    return { svg: s, boxes };
  }

  const KIND_SHAPE = { store: 'cyl', decision: 'diamond', terminal: 'pill', start: 'pill', end: 'pill' };
  /** 일반 그래프 렌더(architecture/flowchart/state/dependency/…): data → res */
  function renderGraph(data, ctx, o = {}) {
    const S = ctx.S;
    const max = C.DETAIL[S.detail].max;
    let nodes = (data.nodes || []).map((n) => ({ ...n }));
    let edges = (data.edges || []).map((e) => ({ ...e }));
    const warnings = [];
    const cap = capGraph(nodes, edges, max);
    if (cap.merged) warnings.push(`상세 수준(${C.DETAIL[S.detail].label})에 맞춰 ${cap.merged}개 노드를 "…외 ${cap.merged}개"로 합쳤습니다. '충실'로 바꾸면 모두 표시됩니다.`);
    nodes = cap.nodes; edges = cap.edges;
    // 크기
    for (const n of nodes) {
      const sz = o.sizeNode ? o.sizeNode(ctx, n) : nodeSize(ctx, n, { minW: o.minW, minH: o.minH, maxW: o.maxW });
      if (n.kind === 'decision' || n.shape === 'diamond') { n.w = up4(Math.max(sz.w, 112) + 24); n.h = up4(Math.max(sz.h, 48) + 20); }
      else if (n.kind === 'start' || n.kind === 'end' || n.kind === 'terminal') { n.w = Math.max(sz.w, 88); n.h = 36; }
      else { n.w = sz.w; n.h = sz.h; }
      n.lines = sz.lines;
      n.shape = n.shape || KIND_SHAPE[n.kind] || 'rect';
    }
    const dirSetting = S.direction === 'auto' ? (o.dir || data.direction || 'LR') : S.direction;
    const lay = layout(nodes, edges, { dir: dirSetting, nodeSep: o.nodeSep });
    const grp = drawGroups(ctx, lay.nodes, data.groups);
    const ed = drawEdges(ctx, lay.edges, lay.dir);
    let nodeSvg = '';
    for (const n of lay.nodes) {
      ctx.counts.nodes++;
      const markFocal = n.focal ? { ...n, kind: 'focal' } : n;
      const inner = o.drawNode ? o.drawNode(ctx, markFocal) : boxEl(ctx, { x: n.x, y: n.y, w: n.w, h: n.h, name: n.label || n.id, lines: n.lines, sub: n.sub, tag: n.tag, kind: markFocal.kind, shape: n.shape });
      nodeSvg += ctx.anim(`n${n.rank}`, inner);
      ctx.blocks.push({ id: n.id, label: n.label || n.id, kind: n.kind || 'normal', group: n.group || null, rank: n.rank });
      ctx.table.push({ 구분: '노드', 이름: n.label || n.id, 설명: n.sub || '', 그룹: n.group || '' });
    }
    for (const e of edges) ctx.table.push({ 구분: '연결', 이름: `${(nodes.find((n) => n.id === e.from) || {}).label || e.from} → ${(nodes.find((n) => n.id === e.to) || {}).label || e.to}`, 설명: e.label || '', 그룹: '' });
    // 경계
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (x, y) => { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; };
    for (const n of lay.nodes) { grow(n.x - 8, n.y - 10); grow(n.x + n.w + 8, n.y + n.h + 8); }
    for (const b of grp.boxes) { grow(b[0], b[1]); grow(b[2], b[3]); }
    for (const e of lay.edges) for (const [x, y] of e.pts) grow(x, y);
    // 열 머리글(IT 현황·메달리온 등): 내용 위쪽에 둔다.
    let heads = '';
    const cols = data.columns || null;
    if (cols && lay.dir === 'LR' && Number.isFinite(minY)) {
      const hy = minY - 22;
      cols.forEach((c, r) => {
        if (r > lay.maxRank) return;
        const x = lay.mstart[r];
        heads += txt(ctx, x, hy, c, { size: 9, mono: true, fill: ctx.tok.soft, weight: 500, upper: true, track: 0.14 });
        heads += `<line x1="${r1(x)}" x2="${r1(x + lay.rankSize[r])}" y1="${hy + 8}" y2="${hy + 8}" stroke="${ctx.tok.ruleSolid}" stroke-width="1"/>`;
      });
      grow(minX, hy - 12);
    }
    if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 200; maxY = 80; }
    const w = maxX - minX, h = maxY - minY;
    const body = `<g transform="translate(${r1(-minX)},${r1(-minY)})">${grp.svg}${heads}${ed.body}${nodeSvg}${ed.labels}</g>`;
    const legend = [];
    const kinds = new Set(lay.nodes.map((n) => n.kind || 'normal'));
    if (kinds.has('focal') || lay.nodes.some((n) => n.focal)) legend.push({ label: '초점', fill: ctx.tok.accentTint, color: ctx.tok.accent });
    if (kinds.has('store')) legend.push({ label: '저장소', fill: ctx.tok.paper2, color: ctx.tok.ink });
    if (kinds.has('external')) legend.push({ label: '외부', color: ctx.tok.soft, dashed: true });
    if (kinds.has('optional')) legend.push({ label: '선택/축약', color: ctx.tok.ink, dashed: true });
    if (edges.some((e) => e.dashed)) legend.push({ type: 'line', label: '비동기/반환', dashed: true });
    if (edges.some((e) => e.kind === 'link')) legend.push({ type: 'line', label: 'API/외부 호출', color: ctx.tok.link });
    if (edges.some((e) => e.kind === 'accent')) legend.push({ type: 'line', label: '핵심 경로', color: ctx.tok.accent });
    return { w, h, body, legend, warnings };
  }

  root.DiagramGraph = { capGraph, layout, drawEdges, drawGroups, renderGraph };
  if (typeof module !== 'undefined') module.exports = root.DiagramGraph;
})(typeof window !== 'undefined' ? window : globalThis);
