// 그래프 계열 유형 (v7.32.0): 아키텍처 · 델타 · IT현황 · 순서도 · 상태 · ER · UML · DB · 의존성 · 배포 · 데이터흐름 · DP통합 · 하이레벨 · 프로세스 · 메달리온
(function (root) {
  'use strict';
  const C = root.DiagramCore, G = root.DiagramGraph;
  const { r1, up4, tw, txt, E } = C;

  // 표 모양 노드(ER·DB·UML) ──────────────────────────────────────────
  function tableSize(ctx, n) {
    const rows = n.rows || [];
    const attrs = n.attrs || []; const ops = n.ops || [];
    const nameW = tw(n.label || n.id, 12) + 28;
    let rowW = 0;
    for (const r of rows) rowW = Math.max(rowW, tw(r.n, 11) + tw(r.t || '', 9, true) + 44);
    for (const a of attrs.concat(ops)) rowW = Math.max(rowW, tw(a, 10, true) + 24);
    const w = Math.max(140, up4(Math.max(nameW, rowW)));
    const lines = rows.length + attrs.length + ops.length;
    const sep = (attrs.length && ops.length) ? 6 : 0;
    const h = 28 + Math.max(1, lines) * 18 + 8 + sep;
    return { w, h, lines: [n.label || n.id] };
  }
  function drawTable(ctx, n) {
    const t = ctx.tok; const focal = n.kind === 'focal';
    if (focal) ctx.counts.accent++;
    const stroke = focal ? t.accent : t.ink;
    let s = `<rect x="${r1(n.x)}" y="${r1(n.y)}" width="${n.w}" height="${n.h}" rx="6" fill="${t.paper}"/>` +
      `<rect x="${r1(n.x)}" y="${r1(n.y)}" width="${n.w}" height="${n.h}" rx="6" fill="${focal ? t.accentTint : 'none'}" stroke="${stroke}" stroke-width="${focal ? 1.5 : 1}"/>` +
      `<path d="M${r1(n.x)},${r1(n.y + 28)} v-22 a6,6 0 0 1 6,-6 h${n.w - 12} a6,6 0 0 1 6,6 v22 Z" fill="${t.paper2}" stroke="${stroke}" stroke-width="${focal ? 1.5 : 1}"/>` +
      txt(ctx, n.x + 12, n.y + 18, ctx.exec ? n.label : n.label, { size: 12, weight: 600 });
    if (n.tag) s += txt(ctx, n.x + n.w - 10, n.y + 17, String(n.tag), { size: 7, anchor: 'end', mono: true, upper: true, track: 0.12, fill: focal ? t.accent : t.soft, weight: 500 });
    let y = n.y + 28 + 6;
    for (const r of n.rows || []) {
      y += 13;
      s += txt(ctx, n.x + 12, y, r.n, { size: 11, weight: r.f ? 600 : 400 });
      if (r.f) s += txt(ctx, n.x + n.w - 12 - (r.t ? tw(r.t, 9, true) + 8 : 0), y, r.f, { size: 7, anchor: 'end', mono: true, fill: r.f === 'PK' ? t.accent : t.link, weight: 600 });
      if (r.t) s += txt(ctx, n.x + n.w - 12, y, r.t, { size: 9, anchor: 'end', mono: true, fill: t.soft });
      y += 5;
    }
    for (const a of n.attrs || []) { y += 13; s += txt(ctx, n.x + 12, y, a, { size: 10, mono: true }); y += 5; }
    if ((n.attrs || []).length && (n.ops || []).length) { s += `<line x1="${r1(n.x)}" x2="${r1(n.x + n.w)}" y1="${r1(y + 3)}" y2="${r1(y + 3)}" stroke="${stroke}" stroke-width="1"/>`; y += 6; }
    for (const a of n.ops || []) { y += 13; s += txt(ctx, n.x + 12, y, a, { size: 10, mono: true }); y += 5; }
    return s;
  }
  const tableOpts = { sizeNode: tableSize, drawNode: drawTable, nodeSep: 32, dir: 'LR' };

  function cycleEdges(nodes, edges) {
    const out = new Map(nodes.map((n) => [n.id, []])); for (const e of edges) if (out.has(e.from)) out[e.from] = null, out.get(e.from).push(e);
    const st = new Map(); const bad = new Set();
    const dfs = (u) => { st.set(u, 1); for (const e of out.get(u) || []) { const s = st.get(e.to); if (s === 1) bad.add(e); else if (!s && out.has(e.to)) dfs(e.to); } st.set(u, 2); };
    for (const n of nodes) if (!st.get(n.id)) dfs(n.id);
    return bad;
  }

  const FAM = { arch: '구조·시스템', flow: '흐름·논리', data: '데이터·플랫폼' };
  const reg = (d) => C.register(d);

  reg({
    id: 'architecture', ko: '아키텍처', en: 'Architecture', family: FAM.arch, short: '구성요소와 연결을 한 장면으로',
    desc: '시스템의 구성요소와 그 사이의 연결을 한 시점의 스냅샷으로 보여줍니다. 프런트·API·DB·외부 서비스가 어떻게 이어지는지 설명할 때 가장 먼저 쓰는 기본 다이어그램입니다.',
    when: '서비스 구조 설명, 신규 팀원 온보딩, 장애 원인 위치 파악', tips: '노드는 9개 이내, 초점(강조색)은 1~2개. 실선=동기 호출, 점선=비동기/반환, 파란선=외부 API.',
    sample: { title: '나만의 Work Space 구조', direction: 'LR', nodes: [
      { id: 'u', label: '브라우저', sub: 'HTML/JS', kind: 'external' }, { id: 'v', label: 'Vercel', sub: '정적 배포 + /api', tag: 'edge' },
      { id: 'fn', label: '서버리스 함수', sub: '/api/market-proxy', kind: 'focal' }, { id: 'sb', label: 'Supabase', sub: 'Postgres + RLS', kind: 'store' },
      { id: 'nv', label: '네이버 증권', sub: '비공식 JSON', kind: 'external' }, { id: 'fx', label: 'Frankfurter', sub: 'ECB 환율', kind: 'external' }],
      edges: [{ from: 'u', to: 'v', label: 'https' }, { from: 'u', to: 'sb', label: '로그인 사용자', kind: 'link' }, { from: 'v', to: 'fn' }, { from: 'fn', to: 'nv', label: 'GET', kind: 'link' }, { from: 'fn', to: 'fx', kind: 'link' }, { from: 'sb', to: 'u', dashed: true, label: 'RLS' }] },
    render: (d, ctx) => G.renderGraph(d, ctx, { dir: 'LR' }),
  });

  reg({
    id: 'architecture-delta', ko: '아키텍처 델타', en: 'Architecture delta', family: FAM.arch, short: '이전/이후 구조 변화와 변경 목록',
    desc: '같은 시스템의 "이전"과 "이후" 토폴로지를 나란히 놓고, 추가(강조)·삭제(점선)·변경을 표시한 뒤 아래에 변경 목록을 붙입니다. 속성만 바뀌면 표가 낫고, 구조가 바뀔 때 씁니다.',
    when: '마이그레이션 제안, 리팩터링 전후, 릴리스 노트', tips: 'change: added | removed | changed 로 표시. 양쪽 노드 id를 같게 하면 비교가 쉽습니다.',
    sample: { title: '시세 공급자 교체 (KIS → 네이버)', before: [
      { id: 'app', label: '앱' }, { id: 'kis', label: 'KIS API', sub: '토큰 발급', change: 'removed' }, { id: 'px', label: 'kis-proxy', change: 'removed' }],
      beforeEdges: [{ from: 'app', to: 'px' }, { from: 'px', to: 'kis', label: 'OAuth' }],
      after: [{ id: 'app', label: '앱' }, { id: 'mp', label: 'market-proxy', change: 'added', sub: '허용 호스트 고정' }, { id: 'nv', label: '네이버 증권', change: 'added', sub: '키 불필요' }],
      afterEdges: [{ from: 'app', to: 'mp' }, { from: 'mp', to: 'nv', label: 'GET' }],
      changes: ['KIS 토큰 발급 경로 제거 → 카톡 알림 중단', 'market-proxy 추가(허용 호스트만)', '네이버 비공식 주소 의존 — 변경 시 중단 가능'] },
    render(d, ctx) {
      const mk = (nodes, edges, tag) => G.renderGraph({ nodes: nodes.map((n) => ({ ...n, kind: n.change === 'added' ? 'focal' : n.change === 'removed' ? 'external' : n.change === 'changed' ? 'optional' : n.kind })), edges, direction: 'LR' }, ctx, { dir: 'LR', minW: 96 });
      const a = mk(d.before || [], d.beforeEdges || [], 'before'); const b = mk(d.after || [], d.afterEdges || [], 'after');
      const gap = 56; const w = a.w + gap + b.w; const h = Math.max(a.h, b.h) + 40;
      const t = ctx.tok;
      const head = (x, s) => txt(ctx, x, 12, s, { size: 9, mono: true, fill: t.soft, weight: 500, upper: true, track: 0.18 }) + `<line x1="${x}" x2="${x + (x ? b.w : a.w)}" y1="20" y2="20" stroke="${t.ruleSolid}"/>`;
      const ch = (d.changes || []).slice(0, 6);
      const ledgerY = h + 12;
      const ledger = ch.length ? txt(ctx, 0, ledgerY, '변경 목록', { size: 9, mono: true, fill: t.soft, weight: 500, upper: true, track: 0.18 }) + ch.map((c, i) => txt(ctx, 0, ledgerY + 20 + i * 20, `${i + 1}.  ${c}`, { size: 12 })).join('') : '';
      ch.forEach((c) => ctx.table.push({ 구분: '변경', 이름: c, 설명: '', 그룹: '' }));
      const body = head(0, 'BEFORE') + head(a.w + gap, 'AFTER') + `<g transform="translate(0,34)">${a.body}</g><g transform="translate(${a.w + gap},34)">${b.body}</g>${ledger}`;
      const lg = a.legend.concat(b.legend).filter((x, i, arr) => arr.findIndex((y) => y.label === x.label) === i);
      return { w, h: ledgerY + 20 + ch.length * 20, body, legend: lg, warnings: a.warnings.concat(b.warnings) };
    },
    budget: { nodes: 14, edges: 14 },
  });

  reg({
    id: 'it-state', ko: 'IT 현황', en: 'IT current state', family: FAM.arch, short: '단계/부서별 기존 시스템 지형',
    desc: '도입 전(AS-IS) IT 지형을 단계나 부서 열로 나누어 보여줍니다. 시스템이 어느 단계에 쓰이고 무엇과 수작업으로 이어지는지 드러내 개선 전 "현재 상태"를 합의할 때 씁니다.',
    when: '디지털 전환 진단, 레거시 정리, 업무 흐름 점검', tips: 'columns로 단계를 정하고 각 노드의 rank(0부터)로 열을 지정. 수작업 연결은 dashed.',
    sample: { title: '업무 도구 현황 (AS-IS)', columns: ['수집', '정리', '활용'], nodes: [
      { id: 'a', label: '이메일', sub: '계정 3개', rank: 0, kind: 'external' }, { id: 'b', label: '엑셀', sub: '수기 정리', rank: 1 }, { id: 'c', label: '메모 앱', rank: 1, kind: 'optional' },
      { id: 'd', label: '캘린더', rank: 2, kind: 'focal', sub: '일정 흩어짐' }, { id: 'e', label: '증권사 앱', sub: '4곳', rank: 0, kind: 'external' }],
      edges: [{ from: 'a', to: 'b', label: '복붙', dashed: true }, { from: 'e', to: 'b', dashed: true, label: '수기' }, { from: 'b', to: 'd' }, { from: 'c', to: 'd', dashed: true }] },
    render: (d, ctx) => G.renderGraph(d, ctx, { dir: 'LR' }),
  });

  reg({
    id: 'flowchart', ko: '순서도', en: 'Flowchart', family: FAM.flow, short: '판단과 분기가 있는 논리',
    desc: '시작에서 끝까지 조건 분기(마름모)를 따라가는 의사결정 흐름입니다. "예/아니오" 분기가 핵심일 때 쓰고, 단순 직선 절차라면 목록이 더 낫습니다.',
    when: '장애 대응 절차, 승인 규칙, 알고리즘 설명', tips: 'kind: start/end(알약), decision(마름모). 분기 라벨은 14자 이내.',
    sample: { title: '목표가 도달 알림 판단', direction: 'TB', nodes: [
      { id: 's', label: '시세 조회', kind: 'start' }, { id: 'd1', label: '현재가 ≥ 목표가?', kind: 'decision' }, { id: 'd2', label: '현재가 ≤ 손절가?', kind: 'decision' },
      { id: 'a1', label: '🎯 목표 알림', kind: 'focal' }, { id: 'a2', label: '🛑 손절 알림' }, { id: 'e', label: '대기', kind: 'end' }],
      edges: [{ from: 's', to: 'd1' }, { from: 'd1', to: 'a1', label: '예' }, { from: 'd1', to: 'd2', label: '아니오' }, { from: 'd2', to: 'a2', label: '예' }, { from: 'd2', to: 'e', label: '아니오' }, { from: 'a1', to: 'e', dashed: true }, { from: 'a2', to: 'e', dashed: true }] },
    render: (d, ctx) => G.renderGraph(d, ctx, { dir: 'TB' }),
  });

  reg({
    id: 'state', ko: '상태 머신', en: 'State machine', family: FAM.flow, short: '상태·전이·조건',
    desc: '하나의 대상이 가질 수 있는 상태와 상태 사이의 전이(조건/이벤트)를 보여줍니다. 주문·결제·승인처럼 "지금 어떤 상태인가"가 중요한 대상에 맞습니다.',
    when: '승인 워크플로, 계정 상태, 작업 생애주기', tips: '시작/종료는 알약, 전이 라벨은 이벤트(조건). 불가능한 전이는 그리지 않는 것이 핵심.',
    sample: { title: '가입 승인 상태', nodes: [
      { id: 's', label: '가입', kind: 'start' }, { id: 'p', label: 'pending', sub: '승인 대기' }, { id: 'a', label: 'approved', sub: '로그인 가능', kind: 'focal' }, { id: 'r', label: 'rejected', sub: '거절됨', kind: 'external' }],
      edges: [{ from: 's', to: 'p' }, { from: 'p', to: 'a', label: '관리자 승인' }, { from: 'p', to: 'r', label: '거절' }, { from: 'r', to: 'p', label: '재신청', dashed: true }] },
    render: (d, ctx) => G.renderGraph(d, ctx, { dir: 'LR' }),
  });

  reg({
    id: 'er', ko: 'ER / 데이터 모델', en: 'ER diagram', family: FAM.data, short: '엔터티·필드·관계',
    desc: '엔터티(테이블)와 필드, 그 사이의 관계(1:N 등)를 보여주는 논리 모델입니다. 물리 타입보다 "무엇이 무엇과 연결되는가"에 집중합니다.',
    when: '요구사항 정리, 도메인 설계, DB 설계 전 합의', tips: 'rows: [{n:필드, t:타입, f:PK|FK}]. 관계 라벨에 카디널리티(1:N)를 적습니다.',
    sample: { title: '증권 데이터 모델', nodes: [
      { id: 'acc', label: 'brokerage_accounts', tag: '계좌', rows: [{ n: 'id', t: 'uuid', f: 'PK' }, { n: 'broker', t: 'text' }, { n: 'currency', t: 'text' }] },
      { id: 'hold', label: 'stock_holdings', kind: 'focal', rows: [{ n: 'id', t: 'uuid', f: 'PK' }, { n: 'account_id', t: 'uuid', f: 'FK' }, { n: 'symbol', t: 'text' }, { n: 'quantity', t: 'numeric' }] },
      { id: 'tr', label: 'stock_trades', rows: [{ n: 'id', t: 'uuid', f: 'PK' }, { n: 'holding_id', t: 'uuid', f: 'FK' }, { n: 'side', t: 'text' }] },
      { id: 'dv', label: 'stock_dividends', rows: [{ n: 'id', t: 'uuid', f: 'PK' }, { n: 'holding_id', t: 'uuid', f: 'FK' }, { n: 'amount', t: 'numeric' }] }],
      edges: [{ from: 'acc', to: 'hold', label: '1:N', arrow: false }, { from: 'hold', to: 'tr', label: '1:N', arrow: false }, { from: 'hold', to: 'dv', label: '1:N', arrow: false }] },
    budget: { nodes: 8, edges: 10 },
    render: (d, ctx) => G.renderGraph(d, ctx, tableOpts),
  });

  reg({
    id: 'db-schema', ko: 'DB 스키마', en: 'Database schema', family: FAM.data, short: '물리 테이블·타입·제약',
    desc: '실제 테이블의 컬럼, SQL 타입, 제약(PK/FK/UNIQUE), 인덱스까지 담는 물리 모델입니다. ER이 개념이라면 이쪽은 구현 직전의 청사진입니다.',
    when: '마이그레이션 리뷰, RLS 정책 설계, 쿼리 최적화 논의', tips: 'f에 PK/FK/UQ. 타입은 SQL 표기 그대로(uuid, timestamptz).',
    sample: { title: 'schedules / projects', nodes: [
      { id: 'p', label: 'projects', tag: 'table', rows: [{ n: 'id', t: 'uuid', f: 'PK' }, { n: 'user_id', t: 'uuid', f: 'FK' }, { n: 'name', t: 'text' }, { n: 'deadline', t: 'date' }, { n: 'deleted_at', t: 'timestamptz' }] },
      { id: 's', label: 'schedules', kind: 'focal', tag: 'table', rows: [{ n: 'id', t: 'uuid', f: 'PK' }, { n: 'project_id', t: 'uuid', f: 'FK' }, { n: 'title', t: 'text' }, { n: 'date', t: 'date' }, { n: 'done', t: 'boolean' }] },
      { id: 'st', label: 'project_stages', rows: [{ n: 'id', t: 'uuid', f: 'PK' }, { n: 'project_id', t: 'uuid', f: 'FK' }, { n: 'seq', t: 'int' }] }],
      edges: [{ from: 'p', to: 's', label: 'project_id' }, { from: 'p', to: 'st', label: 'project_id' }] },
    budget: { nodes: 8, edges: 10 },
    render: (d, ctx) => G.renderGraph(d, ctx, tableOpts),
  });

  reg({
    id: 'uml-class', ko: 'UML 클래스', en: 'UML class', family: FAM.data, short: '클래스·속성·상속·합성',
    desc: '클래스의 속성/메서드와 상속·합성·연관 관계를 보여줍니다. 속이 빈 삼각형은 상속, 속이 찬 마름모는 합성입니다.',
    when: '객체 설계 리뷰, 라이브러리 구조 문서화', tips: 'attrs / ops 배열. edge.marker: "tri"(상속) | "dia"(합성) — 시작/끝은 from→to.',
    sample: { title: '저장소 계층', nodes: [
      { id: 'st', label: 'Store', tag: 'interface', ops: ['list(table, opts)', 'create(table, row)', 'update(table, id, patch)'] },
      { id: 'ls', label: 'LocalStore', attrs: ['db: localStorage'], ops: ['list()', 'create()'] },
      { id: 'ss', label: 'SupabaseStore', kind: 'focal', attrs: ['client', 'rls: true'], ops: ['list()', 'create()'] },
      { id: 'as', label: 'AppState', attrs: ['store: Store'], ops: ['refreshAll()'] }],
      edges: [{ from: 'ls', to: 'st', marker: 'tri', label: '구현' }, { from: 'ss', to: 'st', marker: 'tri', label: '구현' }, { from: 'as', to: 'st', label: '사용', dashed: true }] },
    budget: { nodes: 8, edges: 10 },
    render: (d, ctx) => G.renderGraph(d, ctx, { ...tableOpts, dir: 'LR' }),
  });

  reg({
    id: 'dependency', ko: '의존성 그래프', en: 'Dependency graph', family: FAM.arch, short: '무엇이 무엇에 의존하나(순환 포함)',
    desc: '모듈/패키지/서비스가 서로 무엇에 의존하는지 팬인·순환까지 보여줍니다. 트리로는 표현되지 않는 "여러 곳에서 같은 것을 쓰는" 관계를 드러냅니다. 순환 의존은 자동으로 강조됩니다.',
    when: '모듈 정리, 빌드 순서, 순환 의존 탐지', tips: 'from이 to에 의존. 순환 간선은 강조색 점선으로 자동 표시.',
    sample: { title: '스크립트 로드 의존성', nodes: [
      { id: 'dom', label: 'dom.js' }, { id: 'st', label: 'state.js', kind: 'focal' }, { id: 'ss', label: 'settingsSync.js' }, { id: 'ro', label: 'reorder.js' }, { id: 'mod', label: 'modules/*.js' }, { id: 'ap', label: 'app.js' }],
      edges: [{ from: 'st', to: 'dom' }, { from: 'ss', to: 'st' }, { from: 'ro', to: 'ss' }, { from: 'mod', to: 'ro' }, { from: 'mod', to: 'st' }, { from: 'ap', to: 'mod' }, { from: 'st', to: 'ss', dashed: true }] },
    render(d, ctx) {
      const bad = cycleEdges(d.nodes || [], d.edges || []);
      const edges = (d.edges || []).map((e) => ({ ...e, kind: bad.has(e) ? 'accent' : e.kind, dashed: bad.has(e) ? true : e.dashed }));
      const res = G.renderGraph({ ...d, edges }, ctx, { dir: 'LR' });
      if (bad.size) res.legend.push({ type: 'line', label: '순환 의존', color: ctx.tok.accent, dashed: true });
      if (bad.size) ctx.notes.push(`순환 의존 ${bad.size}건 발견`);
      return res;
    },
  });

  reg({
    id: 'deployment', ko: '배포 구성', en: 'Deployment', family: FAM.arch, short: '어디서 무엇이 실행되나',
    desc: '존(리전)·호스트·산출물(컨테이너/함수)이 어디에서 실행되는지 보여줍니다. group에 호스트/영역 이름을 주면 점선 상자로 묶입니다.',
    when: '인프라 설계, 배포 리뷰, 장애 영향 범위', tips: 'node.group = 호스트/영역. sub에 포트나 버전.',
    sample: { title: '배포 위치', groups: [{ id: 'vc', label: 'Vercel (Edge)' }, { id: 'sup', label: 'Supabase (Seoul)' }], nodes: [
      { id: 'web', label: '정적 페이지', sub: 'index.html', group: 'vc' }, { id: 'fn', label: 'API 함수', sub: 'node 22', group: 'vc', kind: 'focal' },
      { id: 'db', label: 'Postgres', sub: ':5432 RLS', group: 'sup', kind: 'store' }, { id: 'au', label: 'Auth', sub: 'GoTrue', group: 'sup' }],
      edges: [{ from: 'web', to: 'au', label: 'JWT', kind: 'link' }, { from: 'web', to: 'db', label: 'REST', kind: 'link' }, { from: 'web', to: 'fn' }] },
    render: (d, ctx) => G.renderGraph(d, ctx, { dir: 'LR', nodeSep: 40 }),
  });

  reg({
    id: 'data-flow', ko: '데이터 흐름', en: 'Data flow', family: FAM.data, short: '역할별 데이터 이동·병목',
    desc: '데이터가 누구에게서 어디로 어떤 형태로 흘러가는지 단계별로 보여줍니다. 한곳으로 몰리는 병목(팬인)이나 비정형 입력이 정형 산출물로 바뀌는 지점을 강조하기 좋습니다.',
    when: 'ETL/수집 파이프라인, 입력→저장 과정, 병목 설명', tips: 'tag에 역할(수집/가공/저장). 병목 노드를 focal로.',
    sample: { title: '관심주제 수집 흐름', nodes: [
      { id: 'rss', label: 'RSS 피드', sub: '10개 소스', kind: 'external' }, { id: 'md', label: '마크다운', sub: '뉴스레터', kind: 'external' },
      { id: 'q', label: '수집 큐', tag: '병목', kind: 'focal', sub: '키워드 필터' }, { id: 'it', label: 'briefing_items', kind: 'store', sub: '중복 제거' }, { id: 'ui', label: '관심주제 화면' }],
      edges: [{ from: 'rss', to: 'q', label: 'fetch' }, { from: 'md', to: 'q' }, { from: 'q', to: 'it', label: 'hash' }, { from: 'it', to: 'ui' }] },
    render: (d, ctx) => G.renderGraph(d, ctx, { dir: 'LR' }),
  });

  reg({
    id: 'dp-integration', ko: '데이터 플랫폼 연동', en: 'DP integration', family: FAM.data, short: '소스 → 코어 → 소비자',
    desc: '데이터 플랫폼의 연동 토폴로지: 왼쪽 소스, 가운데 코어, 오른쪽 소비자. rank 0/1/2로 열을 정하고 열 이름을 columns에 적습니다.',
    when: '데이터 플랫폼 소개, 연동 현황 점검', tips: 'columns: ["소스","코어","소비자"] / node.rank 0..2',
    sample: { title: '데이터 연동 지도', columns: ['소스', '코어', '소비자'], nodes: [
      { id: 'a', label: '네이버 증권', rank: 0, kind: 'external' }, { id: 'b', label: 'Frankfurter', rank: 0, kind: 'external' }, { id: 'c', label: '공공데이터', rank: 0, kind: 'external' },
      { id: 'core', label: 'market-proxy', rank: 1, kind: 'focal', sub: '허용 호스트' }, { id: 'd', label: '증권 화면', rank: 2 }, { id: 'e', label: '홈 위젯', rank: 2 }],
      edges: [{ from: 'a', to: 'core' }, { from: 'b', to: 'core' }, { from: 'c', to: 'core', dashed: true }, { from: 'core', to: 'd' }, { from: 'core', to: 'e' }] },
    render: (d, ctx) => G.renderGraph(d, ctx, { dir: 'LR' }),
  });

  reg({
    id: 'high-level', ko: '하이레벨 스택', en: 'High-level', family: FAM.arch, short: '전체 스택을 한 눈에',
    desc: '데이터/서비스 스택 전체를 구역(group)별로 묶어 큰 그림만 보여줍니다. 세부 연결은 줄이고 "무엇이 어디에 있나"에 집중합니다.',
    when: '제안서 첫 장, 임원 보고, 로드맵 배경', tips: 'group으로 구역을 묶고 노드는 구역당 2~3개.',
    sample: { title: '전체 스택', groups: [{ id: 'f', label: '프런트' }, { id: 'b', label: '백엔드' }], nodes: [
      { id: 'ui', label: '화면 18개', group: 'f' }, { id: 'ch', label: '차트·모달', group: 'f' }, { id: 'api', label: '서버리스', group: 'b' }, { id: 'db', label: 'Postgres', group: 'b', kind: 'store' }],
      edges: [{ from: 'ui', to: 'api' }, { from: 'api', to: 'db' }, { from: 'ch', to: 'ui', dashed: true }] },
    render: (d, ctx) => G.renderGraph(d, ctx, { dir: 'LR', nodeSep: 36 }),
  });

  reg({
    id: 'process', ko: '프로세스', en: 'Process', family: FAM.flow, short: '여러 주체의 순차 절차와 산출물',
    desc: '여러 주체가 순서대로 일을 넘기는 절차를 보여줍니다. 각 단계에 주체(tag)와 산출물을 적어 "누가 무엇을 넘기나"를 분명히 합니다.',
    when: '업무 프로세스 정리, 운영 절차서', tips: 'tag에 주체, label에 행동, edge 라벨에 넘기는 산출물.',
    sample: { title: '배포 절차', nodes: [
      { id: '1', label: '코드 수정', tag: '개발', rank: 0 }, { id: '2', label: 'zip 3분할', tag: '개발', rank: 1 }, { id: '3', label: 'GitHub 업로드', tag: '운영', rank: 2 },
      { id: '4', label: 'Vercel 배포', tag: '자동', rank: 3, kind: 'focal' }, { id: '5', label: '확인', tag: '운영', rank: 4 }],
      edges: [{ from: '1', to: '2', label: '완성본' }, { from: '2', to: '3', label: 'zip' }, { from: '3', to: '4', label: 'push' }, { from: '4', to: '5', label: 'URL' }] },
    render: (d, ctx) => G.renderGraph(d, ctx, { dir: 'LR' }),
  });

  reg({
    id: 'medallion', ko: '메달리온 계층', en: 'Medallion', family: FAM.data, short: 'Bronze/Silver/Gold 품질 단계',
    desc: '원천 데이터가 Bronze(원본) → Silver(정제) → Gold(활용)로 품질을 높여 가는 다단계 저장 구조와 단계별 접근 정책을 보여줍니다.',
    when: '데이터 레이크 설계, 품질 등급 설명', tips: 'rank 0/1/2 = bronze/silver/gold. sub에 접근 정책.',
    sample: { title: '메달리온 구조', columns: ['Bronze', 'Silver', 'Gold'], nodes: [
      { id: 'raw', label: 'raw_items', sub: '원본 보관', rank: 0, kind: 'store' }, { id: 'cl', label: 'briefing_items', sub: '중복 제거', rank: 1, kind: 'store' },
      { id: 'gd', label: '뉴스레터', sub: '요약·집계', rank: 2, kind: 'focal' }, { id: 'sec', label: '읽기 전용', sub: 'RLS: 본인만', rank: 2, kind: 'security' }],
      edges: [{ from: 'raw', to: 'cl', label: '정제' }, { from: 'cl', to: 'gd', label: '집계' }, { from: 'cl', to: 'sec', dashed: true }] },
    render: (d, ctx) => G.renderGraph(d, ctx, { dir: 'LR' }),
  });
})(typeof window !== 'undefined' ? window : globalThis);
