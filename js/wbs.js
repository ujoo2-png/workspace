// 프로젝트 WBS(작업 분해 구조) · 간트차트용 순수 로직 (v7.20.0).
// 일반 <script>로 로드되며 js/predict.js(shiftIso/isoDiff)가 먼저 로드되어 있어야 한다. 화면 코드는 js/modules/projects.js.
//
// 적용한 PM(프로젝트 관리) 개념과 이유 — 자세한 설명은 README "v7.20.0":
//  - WBS: 큰 일을 "대 → 중 → 소"로 계층 분해하고 깊이로 레벨(대/중/소/세)과 번호(1, 1.1, 1.1.1)를 자동 부여한다.
//    (분류를 따로 "입력"하지 않고 트리 구조 자체가 분류가 되게 하는 것이 입력을 편하게 하는 핵심.)
//  - 롤업(summary task): 부모의 기간/진행률은 입력하지 않고 자식에서 계산한다(기간 가중 평균) — 이중 입력과 불일치를 없앤다.
//  - 의존관계 4종 FS/SS/FF/SF, 마일스톤(기간 0), 임계 경로(CPM: 여유 0인 작업 사슬), 기준선(baseline) 대 실제.
(function () {
  const { shiftIso, isoDiff } = globalThis;

  const LEVEL_LABELS = ['대', '중', '소', '세'];
  const MAX_WBS_DEPTH = 4; // 대·중·소·세
  const levelLabel = (depth) => LEVEL_LABELS[Math.min(depth, LEVEL_LABELS.length - 1)];

  const seqOf = (n) => Number(n.seq) || 0;
  const cmpSibling = (a, b) => seqOf(a) - seqOf(b) || String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id));

  /**
   * 행 목록 → 트리. parent_id가 없거나 가리키는 행이 없으면 최상위(대)로 본다. parent_id 순환(손상 데이터)은 끊어 최상위로 올린다.
   * @returns {{byId:Map, children:Map<string|null, object[]>, order:{node:object, depth:number, number:string, hasChildren:boolean, parentId:string|null}[], parentOf:Map}}
   */
  function buildTree(rows) {
    const byId = new Map((rows || []).map((r) => [r.id, r]));
    const parentOf = new Map();
    const children = new Map();
    const push = (k, n) => { if (!children.has(k)) children.set(k, []); children.get(k).push(n); };
    for (const r of byId.values()) {
      const p = r.parent_id && r.parent_id !== r.id && byId.has(r.parent_id) ? r.parent_id : null;
      parentOf.set(r.id, p);
    }
    // 순환 끊기: 조상 사슬을 따라가다 자기 자신을 만나면 그 노드를 최상위로.
    for (const id of byId.keys()) {
      const seen = new Set([id]);
      let cur = parentOf.get(id);
      while (cur) {
        if (seen.has(cur)) { parentOf.set(id, null); break; }
        seen.add(cur);
        cur = parentOf.get(cur);
      }
    }
    for (const r of byId.values()) push(parentOf.get(r.id), r);
    for (const list of children.values()) list.sort(cmpSibling);
    const order = [];
    const walk = (parentId, depth, prefix) => {
      (children.get(parentId) || []).forEach((node, i) => {
        const number = prefix ? `${prefix}.${i + 1}` : String(i + 1);
        order.push({ node, depth, number, hasChildren: (children.get(node.id) || []).length > 0, parentId });
        walk(node.id, depth + 1, number);
      });
    };
    walk(null, 0, '');
    return { byId, children, order, parentOf };
  }

  /** 접힌(collapsed) 노드의 자손을 뺀 보이는 행. */
  function visibleRows(tree, collapsed) {
    const hidden = new Set();
    const out = [];
    for (const row of tree.order) {
      if (row.parentId && (collapsed.has(row.parentId) || hidden.has(row.parentId))) { hidden.add(row.node.id); continue; }
      out.push(row);
    }
    return out;
  }
  function descendantIds(tree, id) {
    const out = [];
    const walk = (pid) => { for (const c of tree.children.get(pid) || []) { out.push(c.id); walk(c.id); } };
    walk(id);
    return out;
  }
  function subtreeHeight(tree, id) {
    const kids = tree.children.get(id) || [];
    return kids.length ? 1 + Math.max(...kids.map((k) => subtreeHeight(tree, k.id))) : 0;
  }
  function depthOf(tree, id) {
    let d = 0, cur = tree.parentOf.get(id);
    while (cur) { d++; cur = tree.parentOf.get(cur); }
    return d;
  }

  // ---- 롤업 ----
  const durationDays = (start, end) => (start && end ? Math.max(1, isoDiff(start, end) + 1) : 1);
  /** 자식 목록의 시작/종료: 가장 이른 시작 ~ 가장 늦은 종료. 날짜 있는 자식이 없으면 null. */
  function rollupDates(items) {
    let start = null, end = null;
    for (const it of items) {
      if (it.start && (!start || it.start < start)) start = it.start;
      if (it.end && (!end || it.end > end)) end = it.end;
    }
    return { start, end };
  }
  /** 자식 진행률(0~100)을 "기간(일수)"으로 가중 평균. 가중치가 전부 0이면 단순 평균. 결과는 정수로 반올림. */
  function rollupProgress(items) {
    if (!items.length) return 0;
    let wsum = 0, psum = 0;
    for (const it of items) {
      const w = Math.max(0, Number(it.duration) || 0);
      const p = Math.min(100, Math.max(0, Number(it.progress) || 0));
      wsum += w; psum += w * p;
    }
    if (wsum === 0) return Math.round(items.reduce((s, it) => s + Math.min(100, Math.max(0, Number(it.progress) || 0)), 0) / items.length);
    return Math.round(psum / wsum);
  }
  const leafProgress = (n) => (n.status === 'done' ? 100 : Math.min(100, Math.max(0, Number(n.progress) || 0)));

  /**
   * 모든 노드의 "유효 값"(리프는 자기 값, 부모는 자식 롤업).
   * @returns {Map<string,{start:string|null,end:string|null,progress:number,duration:number,isLeaf:boolean,milestone:boolean}>}
   */
  function computeRollup(tree) {
    const out = new Map();
    const calc = (node) => {
      const kids = tree.children.get(node.id) || [];
      if (!kids.length) {
        const start = node.start_date || node.target_date || null;
        const end = node.target_date || node.start_date || null;
        const milestone = !!node.is_milestone;
        const r = { start, end: milestone ? start : end, progress: leafProgress(node), duration: milestone ? 0 : durationDays(start, end), isLeaf: true, milestone };
        out.set(node.id, r);
        return r;
      }
      const rs = kids.map(calc);
      const { start, end } = rollupDates(rs);
      const r = { start, end, progress: rollupProgress(rs), duration: durationDays(start, end), isLeaf: false, milestone: false };
      out.set(node.id, r);
      return r;
    };
    for (const root of tree.children.get(null) || []) calc(root);
    return out;
  }

  /** 표시용 상태: done / overdue / in_progress / todo (롤업 값 기준). */
  function effectiveStatus(r, todayIso) {
    if (r.progress >= 100) return 'done';
    if (r.end && r.end < todayIso) return 'overdue';
    if (r.progress > 0 || (r.start && r.start <= todayIso)) return 'in_progress';
    return 'todo';
  }
  const progressToStatus = (p) => (p >= 100 ? 'done' : p > 0 ? 'in_progress' : 'todo');

  // ---- 의존관계 ----
  const DEP_TYPES = ['FS', 'SS', 'FF', 'SF'];
  /** 'uuid' 또는 'uuid:SS' → {id,type}. */
  function parseDep(s) {
    const str = String(s || '');
    const i = str.lastIndexOf(':');
    if (i > 0 && DEP_TYPES.includes(str.slice(i + 1))) return { id: str.slice(0, i), type: str.slice(i + 1) };
    return { id: str, type: 'FS' };
  }
  const formatDep = (id, type = 'FS') => (type === 'FS' ? id : `${id}:${type}`);

  /**
   * 임계 경로(CPM). 리프 작업/마일스톤 중 날짜가 있는 것만 대상(부모 요약행은 제외).
   * 시간축은 날짜(일 인덱스, 종료일 미포함)이며 작업은 "자기 계획 시작일 이전에는 시작 못 함"을 하한으로 둔다.
   * 순방향으로 ES/EF, 역방향으로 LS/LF, 여유(slack) = LS - ES. 여유 0 → 임계. 의존관계 순환은 가드한다(해당 노드는 계산에서 제외하고 cycles로 보고).
   * @returns {{critical:Set<string>, slack:Map<string,number>, es:Map, ef:Map, projectEnd:number|null, cycles:string[], violations:{from:string,to:string,type:string}[], baseDate:string|null}}
   */
  function criticalPath(rows) {
    const tree = buildTree(rows);
    const nodes = [];
    for (const r of tree.order) {
      if (r.hasChildren) continue;
      const n = r.node;
      const s = n.start_date || n.target_date, e = n.target_date || n.start_date;
      if (s) nodes.push({ id: n.id, s, e, milestone: !!n.is_milestone, deps: n.depends_on || [] });
    }
    const empty = { critical: new Set(), slack: new Map(), es: new Map(), ef: new Map(), projectEnd: null, cycles: [], violations: [], baseDate: null };
    if (!nodes.length) return empty;
    const baseDate = nodes.reduce((m, n) => (n.s < m ? n.s : m), nodes[0].s);
    const idx = (iso) => isoDiff(baseDate, iso);
    const info = new Map();
    for (const n of nodes) {
      const d = n.milestone ? 0 : Math.max(1, isoDiff(n.s, n.e) + 1);
      info.set(n.id, { id: n.id, s0: idx(n.s), d, preds: [], succs: [] });
    }
    for (const n of nodes) {
      for (const raw of n.deps) {
        const { id: pid, type } = parseDep(raw);
        if (pid === n.id || !info.has(pid)) continue;
        info.get(n.id).preds.push({ id: pid, type });
        info.get(pid).succs.push({ id: n.id, type });
      }
    }
    // 위상 정렬(Kahn)
    const indeg = new Map();
    for (const v of info.values()) indeg.set(v.id, v.preds.length);
    const queue = [...info.values()].filter((v) => v.preds.length === 0).map((v) => v.id);
    const topo = [];
    while (queue.length) {
      const id = queue.shift();
      topo.push(id);
      for (const s of info.get(id).succs) {
        indeg.set(s.id, indeg.get(s.id) - 1);
        if (indeg.get(s.id) === 0) queue.push(s.id);
      }
    }
    const done = new Set(topo);
    const cycles = [...info.keys()].filter((id) => !done.has(id));
    const es = new Map(), ef = new Map();
    const reqStart = (type, pred, d) => {
      const pes = es.get(pred.id), pef = ef.get(pred.id);
      if (type === 'FS') return pef;
      if (type === 'SS') return pes;
      if (type === 'FF') return pef - d;
      return pes - d; // SF
    };
    for (const id of topo) {
      const v = info.get(id);
      let start = v.s0;
      for (const p of v.preds) if (done.has(p.id)) start = Math.max(start, reqStart(p.type, p, v.d));
      es.set(id, start); ef.set(id, start + v.d);
    }
    let projectEnd = null;
    for (const id of topo) projectEnd = projectEnd === null ? ef.get(id) : Math.max(projectEnd, ef.get(id));
    const ls = new Map(), lf = new Map(), slack = new Map(), critical = new Set();
    for (const id of [...topo].reverse()) {
      const v = info.get(id);
      let finish = projectEnd;
      for (const s of v.succs) {
        if (!done.has(s.id)) continue;
        const sv = info.get(s.id);
        let bound;
        if (s.type === 'FS') bound = ls.get(s.id);
        else if (s.type === 'SS') bound = ls.get(s.id) + v.d;
        else if (s.type === 'FF') bound = lf.get(s.id);
        else bound = lf.get(s.id) + v.d; // SF
        void sv;
        finish = Math.min(finish, bound);
      }
      lf.set(id, finish); ls.set(id, finish - v.d);
      const sl = ls.get(id) - es.get(id);
      slack.set(id, sl);
      if (sl <= 0) critical.add(id);
    }
    // 계획 날짜가 의존관계를 어기는 경우(예: 선행이 끝나기 전에 후행 시작)
    const violations = [];
    for (const v of info.values()) {
      for (const p of v.preds) {
        const pv = info.get(p.id);
        const pS = pv.s0, pF = pv.s0 + pv.d, S = v.s0, F = v.s0 + v.d;
        const ok = p.type === 'FS' ? S >= pF : p.type === 'SS' ? S >= pS : p.type === 'FF' ? F >= pF : F >= pS;
        if (!ok) violations.push({ from: p.id, to: v.id, type: p.type });
      }
    }
    return { critical, slack, es, ef, projectEnd, cycles, violations, baseDate };
  }

  /** succId가 predId에 의존하도록 추가하면 순환이 생기는지(UI가 거부할 때 사용). */
  function wouldCreateCycle(rows, succId, predId) {
    if (succId === predId) return true;
    const byId = new Map(rows.map((r) => [r.id, r]));
    // pred가 (이미) succ에 의존하고 있는지 = succ에서 후행 방향으로 pred에 도달 가능한지? → pred의 선행 사슬에 succ가 있으면 순환
    const seen = new Set();
    const stack = [predId];
    while (stack.length) {
      const id = stack.pop();
      if (id === succId) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const d of byId.get(id)?.depends_on || []) stack.push(parseDep(d).id);
    }
    return false;
  }

  // ---- 이동(위/아래/들여쓰기/내어쓰기) ----
  /**
   * 노드 이동에 필요한 변경(patch) 목록. 불가능하면 {ok:false, reason}.
   * action: 'up' | 'down' | 'indent'(앞 형제의 마지막 자식으로) | 'outdent'(부모 바로 다음 형제로)
   * @returns {{ok:true, patches:{id:string, patch:{parent_id?:string|null, seq:number}}[]}|{ok:false, reason:string}}
   */
  function moveNode(rows, id, action) {
    const tree = buildTree(rows);
    const node = tree.byId.get(id);
    if (!node) return { ok: false, reason: 'not_found' };
    const parentId = tree.parentOf.get(id);
    const sibs = (tree.children.get(parentId) || []).map((n) => n.id);
    const i = sibs.indexOf(id);
    const patches = [];
    const renumber = (parent, ids) => {
      ids.forEach((sid, seq) => {
        const cur = tree.byId.get(sid);
        const curParent = tree.parentOf.get(sid) ?? null;
        const patch = {};
        if (seqOf(cur) !== seq) patch.seq = seq;
        if (curParent !== parent) patch.parent_id = parent;
        if (Object.keys(patch).length) patches.push({ id: sid, patch: { seq, ...patch } });
      });
    };
    if (action === 'up' || action === 'down') {
      const j = action === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= sibs.length) return { ok: false, reason: 'edge' };
      const next = sibs.slice();
      [next[i], next[j]] = [next[j], next[i]];
      renumber(parentId, next);
      return { ok: true, patches };
    }
    if (action === 'indent') {
      if (i <= 0) return { ok: false, reason: 'no_prev_sibling' };
      const newParent = sibs[i - 1];
      if (depthOf(tree, newParent) + 1 + subtreeHeight(tree, id) + 1 > MAX_WBS_DEPTH) return { ok: false, reason: 'max_depth' };
      const newSibs = (tree.children.get(newParent) || []).map((n) => n.id);
      renumber(parentId, sibs.filter((s) => s !== id));
      patches.push({ id, patch: { parent_id: newParent, seq: newSibs.length } });
      return { ok: true, patches: dedupePatches(patches) };
    }
    if (action === 'outdent') {
      if (!parentId) return { ok: false, reason: 'already_top' };
      const gp = tree.parentOf.get(parentId) ?? null;
      const gSibs = (tree.children.get(gp) || []).map((n) => n.id);
      const at = gSibs.indexOf(parentId);
      const next = gSibs.slice(); next.splice(at + 1, 0, id);
      renumber(parentId, sibs.filter((s) => s !== id));
      // 새 형제 목록 재번호 + 이동 노드 parent 변경
      next.forEach((sid, seq) => {
        const cur = tree.byId.get(sid);
        const patch = {};
        if (seqOf(cur) !== seq) patch.seq = seq;
        if (sid === id) patch.parent_id = gp;
        if (Object.keys(patch).length) patches.push({ id: sid, patch: { seq, ...patch } });
      });
      return { ok: true, patches: dedupePatches(patches) };
    }
    return { ok: false, reason: 'bad_action' };
  }
  function dedupePatches(list) {
    const m = new Map();
    for (const p of list) m.set(p.id, { id: p.id, patch: { ...(m.get(p.id)?.patch || {}), ...p.patch } });
    return [...m.values()];
  }

  // ---- 빠른 입력(붙여넣기 개요) ----
  /**
   * 여러 줄 텍스트 → [{name, depth}]. 들여쓰기(탭 1칸=한 단계, 공백 2칸=한 단계), "-"/"*"/"•" 불릿, "1." "1.2.3" 번호 접두어를 인식한다.
   * 번호 접두어만 있고 들여쓰기가 없으면 번호의 점 개수로 깊이를 정한다. 깊이는 직전 줄보다 1 넘게 깊어질 수 없고 maxDepth-1을 넘지 않는다.
   */
  function parseOutline(text, maxDepth = MAX_WBS_DEPTH) {
    const items = [];
    let prev = -1;
    for (const rawLine of String(text || '').split(/\r?\n/)) {
      if (!rawLine.trim()) continue;
      const lead = /^[ \t]*/.exec(rawLine)[0];
      let depth = 0;
      for (const ch of lead) depth += ch === '\t' ? 2 : 1;
      depth = Math.floor(depth / 2);
      let line = rawLine.trim();
      line = line.replace(/^[-*•·]+\s+/, '');
      const num = /^(\d+(?:\.\d+)*)[.)]?\s+/.exec(line);
      if (num) {
        if (depth === 0) depth = num[1].split('.').length - 1;
        line = line.slice(num[0].length);
      }
      line = line.trim();
      if (!line) continue;
      depth = Math.min(depth, prev + 1, maxDepth - 1);
      if (items.length === 0) depth = 0;
      items.push({ name: line, depth });
      prev = depth;
    }
    return items;
  }
  /** parseOutline 결과 → 만들 행 목록. baseParentId 아래에 이어 붙이고, 각 행의 부모는 parentIndex(앞선 항목의 인덱스, -1이면 baseParentId). */
  function outlineToRows(items, baseParentId, startSeq = 0) {
    const out = [];
    const lastAtDepth = [];
    const seqAt = new Map();
    items.forEach((it, i) => {
      const parentIndex = it.depth === 0 ? -1 : lastAtDepth[it.depth - 1];
      const key = parentIndex === -1 ? 'base' : parentIndex;
      const seq = seqAt.has(key) ? seqAt.get(key) + 1 : (parentIndex === -1 ? startSeq : 0);
      seqAt.set(key, seq);
      lastAtDepth[it.depth] = i;
      lastAtDepth.length = it.depth + 1;
      out.push({ name: it.name, depth: it.depth, parentIndex, seq, parent_id: parentIndex === -1 ? baseParentId || null : null });
    });
    return out;
  }

  // ---- 기존 중분류(group_name) → 트리 이동 계획(0024 SQL과 같은 규칙) ----
  /**
   * 예전 구조(프로젝트=대, group_name=중, 단계=소)의 행을 트리로 옮기는 계획. group_name이 있고 parent_id가 없는 행마다
   * 같은 프로젝트·같은 이름의 "그룹 부모"(legacy_group=true)를 만들거나(없을 때만) 찾아서 연결한다. 이미 옮겨진 행은 건드리지 않아 멱등이다.
   * 원본 group_name 값은 지우지 않는다(손실 없음).
   * @returns {{create:{key:string, project_id:string, name:string, seq:number}[], link:{id:string, parentKey?:string, parent_id?:string}[]}}
   */
  function planLegacyStageMigration(rows) {
    const existing = new Map();
    for (const r of rows) if (r.legacy_group && !r.parent_id) existing.set(`${r.project_id}|${r.group_name || r.name}`, r.id);
    const create = [];
    const link = [];
    const createdKeys = new Set();
    const ordered = rows.slice().sort(cmpSibling);
    for (const r of ordered) {
      if (r.parent_id || r.legacy_group) continue;
      const g = (r.group_name || '').trim();
      if (!g) continue;
      const key = `${r.project_id}|${g}`;
      if (existing.has(key)) { link.push({ id: r.id, parent_id: existing.get(key) }); continue; }
      if (!createdKeys.has(key)) {
        createdKeys.add(key);
        create.push({ key, project_id: r.project_id, name: g, seq: seqOf(r) }); // 그룹의 첫 단계 위치에 그룹이 오도록(기존 표시 순서 유지)
      }
      link.push({ id: r.id, parentKey: key });
    }
    return { create, link };
  }

  // ---- 막대 드래그/크기조절 ----
  /** mode: 'move'(통째로) | 'start'(왼쪽 끝) | 'end'(오른쪽 끝). 시작 > 종료가 되지 않게 하고, 마일스톤은 이동만 한다. */
  function dragDates(node, mode, deltaDays) {
    const s0 = node.start_date || node.target_date, e0 = node.target_date || node.start_date;
    if (!s0 || !e0) return null;
    if (node.is_milestone || mode === 'move') return { start_date: shiftIso(s0, deltaDays), target_date: shiftIso(e0, deltaDays) };
    if (mode === 'start') { let s = shiftIso(s0, deltaDays); if (s > e0) s = e0; return { start_date: s, target_date: e0 }; }
    let e = shiftIso(e0, deltaDays); if (e < s0) e = s0;
    return { start_date: s0, target_date: e };
  }

  // ---- 기준선(baseline) ----
  /** 현재 날짜를 기준선으로 저장하는 patch 목록(리프 중 날짜가 있는 것). */
  function snapshotBaseline(rows) {
    const tree = buildTree(rows);
    return tree.order.filter((r) => !r.hasChildren && (r.node.start_date || r.node.target_date)).map((r) => ({
      id: r.node.id,
      patch: { baseline_start: r.node.start_date || r.node.target_date, baseline_end: r.node.target_date || r.node.start_date },
    }));
  }
  /** 기준선 대비 일수 차이(+: 늦어짐). 기준선 없으면 null. */
  function baselineVariance(baseStart, baseEnd, start, end) {
    if (!baseStart || !baseEnd || !start || !end) return null;
    return { startDelta: isoDiff(baseStart, start), endDelta: isoDiff(baseEnd, end) };
  }

  // ---- 간트 시간축 ----
  const ZOOM_PX = { day: 30, week: 11, month: 3.6 };
  /** 표시 범위: 모든 날짜(+오늘) 앞뒤로 약간의 여유. 날짜가 없으면 오늘 기준 한 달. */
  function ganttRange(dates, todayIso, zoom = 'week') {
    const ds = dates.filter(Boolean).concat([todayIso]);
    let min = ds.reduce((a, b) => (a < b ? a : b));
    let max = ds.reduce((a, b) => (a > b ? a : b));
    const pad = zoom === 'day' ? 2 : zoom === 'week' ? 7 : 20;
    min = shiftIso(min, -pad); max = shiftIso(max, pad);
    if (isoDiff(min, max) < 28) max = shiftIso(min, 28);
    return { min, max, days: isoDiff(min, max) + 1 };
  }
  /** 눈금: day=매일(월 첫날 강조), week=매주 월요일, month=매월 1일. */
  function ganttTicks(min, max, zoom) {
    const ticks = [];
    const total = isoDiff(min, max);
    for (let i = 0; i <= total; i++) {
      const iso = shiftIso(min, i);
      const dom = Number(iso.slice(8, 10));
      const wd = globalThis.isoWeekday(iso);
      if (zoom === 'day') ticks.push({ i, iso, label: String(dom), major: dom === 1 || i === 0, month: dom === 1 || i === 0 ? `${iso.slice(0, 4)}.${iso.slice(5, 7)}` : null });
      else if (zoom === 'week' && wd === 1) ticks.push({ i, iso, label: `${Number(iso.slice(5, 7))}/${dom}`, major: dom <= 7, month: dom <= 7 || ticks.length === 0 ? `${iso.slice(0, 4)}.${iso.slice(5, 7)}` : null });
      else if (zoom === 'month' && dom === 1) ticks.push({ i, iso, label: `${Number(iso.slice(5, 7))}월`, major: iso.slice(5, 7) === '01', month: iso.slice(5, 7) === '01' ? iso.slice(0, 4) : null });
    }
    return ticks;
  }


  // ---- 간트 레이아웃(순수: 숫자/좌표만 계산, 그리기는 js/modules/projects.js) ----
  const ROW_H = 34;
  const HEADER_H = 46;
  /**
   * 간트차트 좌표 계산. 보이는(접히지 않은) 행만 한 줄씩 배치하고, 막대/마일스톤/요약바/기준선/의존 화살표 경로/오늘선/주말 칸을 만든다.
   * @param {{rows:object[], collapsed:Set<string>, zoom:'day'|'week'|'month', todayIso:string, showBaseline?:boolean, showCritical?:boolean}} o
   */
  function layoutGantt({ rows, collapsed = new Set(), zoom = 'week', todayIso, showBaseline = true }) {
    const tree = buildTree(rows);
    const roll = computeRollup(tree);
    const cp = criticalPath(rows);
    const px = ZOOM_PX[zoom] || ZOOM_PX.week;
    const dates = [];
    for (const r of rows) dates.push(r.start_date, r.target_date, r.baseline_start, r.baseline_end);
    const range = ganttRange(dates, todayIso, zoom);
    const X = (iso) => isoDiff(range.min, iso) * px;
    const vis = visibleRows(tree, collapsed);
    const items = [];
    const rowOfId = new Map();
    vis.forEach((v, i) => {
      const n = v.node, r = roll.get(n.id);
      const y = HEADER_H + i * ROW_H;
      const hasDates = !!(r.start && r.end);
      const kind = !r.isLeaf ? 'summary' : r.milestone ? 'milestone' : 'task';
      const x = hasDates ? X(r.start) : null;
      const w = hasDates ? Math.max(kind === 'milestone' ? 0 : 5, (isoDiff(r.start, r.end) + 1) * px) : null;
      const baseline = showBaseline && n.baseline_start && n.baseline_end ? { x: X(n.baseline_start), w: Math.max(4, (isoDiff(n.baseline_start, n.baseline_end) + 1) * px), start: n.baseline_start, end: n.baseline_end } : null;
      const item = {
        id: n.id, row: i, y, number: v.number, depth: v.depth, level: levelLabel(v.depth), levelIndex: Math.min(v.depth, 3), name: n.name,
        hasChildren: v.hasChildren, collapsed: collapsed.has(n.id), kind, hasDates,
        x, w, start: r.start, end: r.end, duration: r.duration, progress: r.progress,
        status: effectiveStatus(r, todayIso), critical: cp.critical.has(n.id) && r.isLeaf, slack: cp.slack.has(n.id) ? cp.slack.get(n.id) : null,
        baseline, variance: baselineVariance(n.baseline_start, n.baseline_end, r.start, r.end), isLeaf: r.isLeaf, parentId: v.parentId,
      };
      items.push(item);
      rowOfId.set(n.id, item);
    });
    // 의존 화살표: 선행(pred) → 후행(succ). 출발점은 FS/FF면 선행의 오른쪽 끝, SS/SF면 왼쪽 끝. 도착점은 FS/SS면 후행의 왼쪽, FF/SF면 오른쪽.
    const violations = new Set(cp.violations.map((v) => `${v.from}>${v.to}>${v.type}`));
    const deps = [];
    for (const succ of items) {
      const node = tree.byId.get(succ.id);
      if (!succ.hasDates || !succ.isLeaf) continue;
      for (const raw of node.depends_on || []) {
        const { id: pid, type } = parseDep(raw);
        const pred = rowOfId.get(pid);
        if (!pred || !pred.hasDates || !pred.isLeaf || pred.id === succ.id) continue;
        const predRight = pred.kind === 'milestone' ? pred.x + px / 2 + 7 : pred.x + pred.w;
        const predLeft = pred.kind === 'milestone' ? pred.x + px / 2 - 7 : pred.x;
        const succRight = succ.kind === 'milestone' ? succ.x + px / 2 + 7 : succ.x + succ.w;
        const succLeft = succ.kind === 'milestone' ? succ.x + px / 2 - 7 : succ.x;
        const fromFinish = type === 'FS' || type === 'FF';
        const toStart = type === 'FS' || type === 'SS';
        const x1 = fromFinish ? predRight : predLeft;
        const x2 = toStart ? succLeft : succRight;
        const y1 = pred.y + ROW_H / 2, y2 = succ.y + ROW_H / 2;
        const dx1 = fromFinish ? 9 : -9, dx2 = toStart ? -9 : 9;
        const ym = y2 > y1 ? y1 + ROW_H / 2 : y2 < y1 ? y1 - ROW_H / 2 : y1;
        const pts = y1 === y2
          ? [[x1, y1], [x2, y2]]
          : [[x1, y1], [x1 + dx1, y1], [x1 + dx1, ym], [x2 + dx2, ym], [x2 + dx2, y2], [x2, y2]];
        deps.push({ from: pred.id, to: succ.id, type, points: pts, violation: violations.has(`${pred.id}>${succ.id}>${type}`), critical: pred.critical && succ.critical });
      }
    }
    const ticks = ganttTicks(range.min, range.max, zoom).map((t) => ({ ...t, x: t.i * px }));
    const weekends = [];
    if (zoom !== 'month') {
      for (let i = 0; i < range.days; i++) {
        const wd = globalThis.isoWeekday(shiftIso(range.min, i));
        if (wd >= 6) weekends.push({ x: i * px, w: px, sunday: wd === 7 });
      }
    }
    return {
      range, px, zoom, rowH: ROW_H, headerH: HEADER_H, width: Math.ceil(range.days * px), height: HEADER_H + items.length * ROW_H,
      items, deps, ticks, weekends, todayX: X(todayIso) + px / 2, cp,
    };
  }


  // ---- 프로젝트 복사 (v7.23.0) ----
  /**
   * 프로젝트와 그 WBS 항목을 새 프로젝트로 복사할 "계획"을 만든다(순수 함수 — 저장은 AppState.copyProject가 한다).
   * 예) "사회복지사" 1~15강 → "노인복지론" 프로젝트로 복사해 재사용.
   * @param {object} project 원본 프로젝트
   * @param {object[]} stages 원본 프로젝트의 project_stages 행들
   * @param {{name?:string, includeStages?:boolean, resetProgress?:boolean, dateMode?:'clear'|'keep'|'shift', shiftBase?:string}} opts
   *   dateMode: clear=날짜 비움(기본), keep=그대로, shift=가장 이른 시작일이 shiftBase가 되도록 모든 날짜를 같은 일수만큼 이동
   * @returns {{project:object, stages:{key:string, parentKey:string|null, depth:number, fields:object, deps:{key:string,type:string}[]}[], shiftDays:number|null}}
   */
  function planProjectCopy(project, stages, opts = {}) {
    const { includeStages = true, resetProgress = true, dateMode = 'clear', shiftBase = null } = opts;
    const mine = (stages || []).filter((r) => r.project_id === project.id);
    const dates = [project.deadline, ...mine.flatMap((r) => [r.start_date, r.target_date])].filter(Boolean).sort();
    let shiftDays = null;
    if (dateMode === 'shift' && shiftBase && dates.length) shiftDays = globalThis.isoDiff(dates[0], shiftBase);
    const mapDate = (d) => {
      if (!d || dateMode === 'clear') return null;
      if (dateMode === 'shift' && shiftDays !== null) return globalThis.shiftIso(d, shiftDays);
      return d;
    };
    const name = String(opts.name || '').trim() || `${project.name} (복사)`;
    const proj = {
      name,
      status: 'in_progress',
      priority: project.priority || 'medium',
      tags: (project.tags || []).slice(),
      memo: project.memo || null,
      deadline: mapDate(project.deadline),
      actual_completion_date: null,
    };
    const out = [];
    if (includeStages && mine.length) {
      const tree = buildTree(mine);
      const idSet = new Set(mine.map((r) => r.id));
      for (const row of tree.order) {
        const r = row.node;
        const fields = {
          name: r.name,
          seq: Number(r.seq) || 0,
          start_date: mapDate(r.start_date),
          target_date: mapDate(r.target_date),
          is_milestone: !!r.is_milestone,
          memo: r.memo || null,
          status: resetProgress ? 'todo' : (r.status || 'todo'),
          progress: resetProgress ? 0 : (Number(r.progress) || 0),
          actual_start_date: resetProgress ? null : mapDate(r.actual_start_date),
          actual_completion_date: resetProgress ? null : mapDate(r.actual_completion_date),
          baseline_start: null,
          baseline_end: null,
        };
        const deps = (r.depends_on || []).map(parseDep).filter((d) => idSet.has(d.id)).map((d) => ({ key: d.id, type: d.type }));
        out.push({ key: r.id, parentKey: row.parentId, depth: row.depth, fields, deps });
      }
    }
    return { project: proj, stages: out, shiftDays };
  }

  globalThis.WBS = {
    LEVEL_LABELS, MAX_WBS_DEPTH, levelLabel, buildTree, visibleRows, descendantIds, subtreeHeight, depthOf,
    durationDays, rollupDates, rollupProgress, computeRollup, effectiveStatus, progressToStatus, leafProgress,
    DEP_TYPES, parseDep, formatDep, criticalPath, wouldCreateCycle, moveNode, parseOutline, outlineToRows,
    planLegacyStageMigration, planProjectCopy, dragDates, snapshotBaseline, baselineVariance, ZOOM_PX, ganttRange, ganttTicks, layoutGantt, ROW_H, HEADER_H,
  };
})();
