// 메뉴별 데이터 → 다이어그램 명세 어댑터 (v7.32.0). DOM 비의존(테스트 가능).
// forMenu(path, state) → [{key,title,type,why,data,sample}]  (데이터가 비어 있으면 sample:true + 유형 샘플)
(function (root) {
  'use strict';
  const C = () => root.DiagramCore;
  const live = (a) => (Array.isArray(a) ? a.filter((x) => x && !x.deleted_at) : []);
  const s10 = (v) => String(v || '').slice(0, 10);
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const cnt = (arr, f) => { const m = new Map(); for (const x of arr) { const k = f(x); if (k == null || k === '') continue; m.set(k, (m.get(k) || 0) + 1); } return m; };
  const top = (m, n = 10) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  const bars = (title, m, unit = '건', n = 10) => { const t = top(m, n); return t.length ? { title, unit, orientation: 'h', items: t.map(([label, value], i) => ({ label: String(label), value, focal: i === 0 })) } : null; };
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const wdOf = (iso) => { const d = new Date(`${s10(iso)}T00:00:00`); return Number.isNaN(d.getTime()) ? null : d.getDay(); };
  const lbl = (s, n = 14) => { s = String(s == null ? '' : s); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
  const P = (key, title, type, data, why) => ({ key, title, type, why: why || '', data: data || null });
  const pt = (o) => Object.assign({}, o);

  const STATUS_KO = { planned: '계획', active: '진행', in_progress: '진행', done: '완료', completed: '완료', paused: '보류', on_hold: '보류', backlog: '대기', wishlist: '찜', watching: '보는 중', watched: '봄', todo: '할 일', ongoing: '진행' };
  const st = (v) => STATUS_KO[v] || String(v || '기타');

  function heat(title, rows, cols, f) { const vals = rows.map(() => cols.map(() => 0)); f(vals); return vals.flat().some((v) => v) ? { title, rows, cols, values: vals } : null; }
  function timelineOf(title, list) { const l = list.filter((e) => e.date).sort((a, b) => String(a.date).localeCompare(String(b.date))); const pick = l.slice(-8); return pick.length ? { title, events: pick.map((e, i) => ({ date: e.date.slice(2).replace(/-/g, '.'), title: lbl(e.title, 16), sub: e.sub ? lbl(e.sub, 18) : undefined, focal: i === pick.length - 1 })) } : null; }

  const BUILD = {
    '/home': (s) => {
      const tabs = [['일정', live(s.schedules).length], ['프로젝트', live(s.projects).length], ['챌린저', live(s.challenges).length], ['문화생활', live(s.playlistItems).length], ['증권', live(s.stockHoldings).length], ['Health', live(s.healthMetrics).length], ['Devlog', live(s.devlogs).length], ['Knowledge', live(s.knowledgeDocs).length], ['프로그램', live(s.programs).length]];
      return [
        P('home-tree', '내 Workspace 구성', 'tree', { root: { label: '나만의 Work Space', focal: true, children: [{ label: '계획', children: [{ label: '일정' }, { label: '프로젝트' }, { label: '챌린저' }] }, { label: '자산·건강', children: [{ label: '증권' }, { label: 'Health' }, { label: '차량' }] }, { label: '정보', children: [{ label: '관심주제' }, { label: 'Knowledge' }, { label: 'Devlog' }] }] } }, '메뉴가 어떻게 묶여 있는지'),
        P('home-bar', '메뉴별 등록 건수', 'bar', { title: '메뉴별 등록 건수', unit: '건', orientation: 'h', items: tabs.filter((t) => t[1] > 0).sort((a, b) => b[1] - a[1]).map((t, i) => ({ label: t[0], value: t[1], focal: i === 0 })) }, '어느 메뉴에 자료가 몰려 있는지'),
        P('home-treemap', '자료 비중', 'treemap', { title: '자료 비중', unit: '건', items: tabs.filter((t) => t[1] > 0).map((t, i) => ({ label: t[0], value: t[1], focal: i === 0 })) }, '전체 중 차지하는 비율'),
      ];
    },
    '/schedule': (s) => { const L = live(s.schedules);
      return [
        P('sch-timeline', '다가오는 일정 타임라인', 'timeline', timelineOf('최근·다가오는 일정', L.map((x) => ({ date: s10(x.date), title: x.title, sub: x.time ? String(x.time).slice(0, 5) : '' }))), '날짜 순서대로 한 줄에'),
        P('sch-heat', '요일×시간대 일정 분포', 'heatmap', heat('요일×시간대 일정 분포', WD, ['오전', '오후', '저녁'], (v) => { for (const x of L) { const d = wdOf(x.date); if (d == null) continue; const h = x.time ? Number(String(x.time).slice(0, 2)) : 9; v[d][h < 12 ? 0 : h < 18 ? 1 : 2]++; } }), '언제 일정이 몰리는지'),
        P('sch-bar', '월별 일정 수', 'bar', bars('월별 일정 수', cnt(L, (x) => s10(x.date).slice(0, 7)), '건', 12), '달별 부하 비교'),
        P('sch-kanban', '완료 / 미완료', 'kanban', L.length ? { title: '일정 상태', columns: [{ label: '남음', cards: L.filter((x) => !x.done).slice(0, 8).map((x) => ({ title: lbl(x.title, 16) })) }, { label: '완료', cards: L.filter((x) => x.done).slice(-8).map((x) => ({ title: lbl(x.title, 16) })) }] } : null, '해야 할 일과 끝낸 일'),
      ]; },
    '/projects': (s) => { const L = live(s.projects); const stages = live(s.projectStages); const byId = new Map(L.map((p) => [p.id, p]));
      const tasks = stages.filter((g) => g.start_date || g.target_date).slice(0, 14).map((g) => ({ label: lbl(g.name, 14), start: s10(g.start_date || g.target_date), end: s10(g.target_date || g.start_date), progress: g.status === 'done' || g.status === 'completed' ? 100 : g.status === 'in_progress' || g.status === 'active' ? 50 : 0, group: lbl((byId.get(g.project_id) || {}).name || '프로젝트', 10) }));
      const col = (k) => L.filter((p) => k.includes(p.status));
      return [
        P('prj-gantt', '프로젝트 단계 간트', 'gantt', tasks.length ? { title: '프로젝트 단계 일정', today: new Date().toISOString().slice(0, 10), tasks } : null, '단계별 기간과 진행'),
        P('prj-kanban', '상태별 보드', 'kanban', L.length ? { title: '프로젝트 상태', columns: [['계획', ['planned', 'backlog', 'todo']], ['진행', ['active', 'in_progress', 'ongoing']], ['보류', ['paused', 'on_hold']], ['완료', ['done', 'completed']]].map(([l, k]) => ({ label: l, cards: col(k).slice(0, 6).map((p) => ({ title: lbl(p.name, 16) })) })) } : null, '지금 어디까지 왔는지'),
        P('prj-tree', '프로젝트 → 단계 분해', 'tree', L.length ? { root: { label: '프로젝트', focal: true, children: L.slice(0, 5).map((p) => ({ label: lbl(p.name, 12), children: stages.filter((g) => g.project_id === p.id).slice(0, 4).map((g) => ({ label: lbl(g.name, 12) })) })) } } : null, 'WBS처럼 쪼개 보기'),
        P('prj-bar', '상태별 프로젝트 수', 'bar', bars('상태별 프로젝트 수', cnt(L, (p) => st(p.status))), '상태 분포'),
      ]; },
    '/challenges': (s) => { const L = live(s.challenges); const ck = live(s.challengeCheckins); const by = cnt(ck, (c) => (L.find((x) => x.id === c.challenge_id) || {}).title);
      return [
        P('chl-bar', '챌린지별 체크인 수', 'bar', bars('챌린지별 체크인 수', by), '꾸준히 하는 것과 놓친 것'),
        P('chl-heat', '요일별 체크인', 'heatmap', heat('요일별 체크인', L.slice(0, 6).map((c) => lbl(c.title, 8)), WD, (v) => { L.slice(0, 6).forEach((c, i) => { for (const k of ck) if (k.challenge_id === c.id) { const d = wdOf(k.checkin_date); if (d != null) v[i][d]++; } }); }), '어느 요일에 잘 지키는지'),
        P('chl-timeline', '챌린지 기간', 'gantt', L.filter((c) => c.start_date && c.end_date).length ? { title: '챌린지 기간', today: new Date().toISOString().slice(0, 10), tasks: L.filter((c) => c.start_date && c.end_date).slice(0, 10).map((c) => ({ label: lbl(c.title, 14), start: s10(c.start_date), end: s10(c.end_date), progress: c.status === 'completed' ? 100 : 40, group: c.category || '챌린지' })) } : null, '기간이 겹치는지'),
      ]; },
    '/briefing': (s) => { const items = live(s.briefingItems); const tp = live(s.briefingTopics); const src = live(s.feedSources); const tn = (id) => (tp.find((t) => t.id === id) || {}).name; const sn = (id) => (src.find((x) => x.id === id) || {}).name;
      const m = new Map(); for (const it of items) { const a = sn(it.source_id), b = tn(it.topic_id); if (a && b) { const k = `${a}\u0000${b}`; m.set(k, (m.get(k) || 0) + 1); } }
      const nodes = new Map(); const links = [...m.entries()].slice(0, 20).map(([k, v]) => { const [a, b] = k.split('\u0000'); nodes.set(`s:${a}`, { id: `s:${a}`, label: lbl(a, 10) }); nodes.set(`t:${b}`, { id: `t:${b}`, label: lbl(b, 10) }); return { from: `s:${a}`, to: `t:${b}`, value: v }; });
      return [
        P('brf-bar', '관심주제별 수집 건수', 'bar', bars('관심주제별 수집 건수', cnt(items, (i) => tn(i.topic_id))), '어떤 주제가 많이 모이는지'),
        P('brf-sankey', '출처 → 주제 흐름', 'sankey', links.length ? { title: '출처 → 주제', unit: '건', nodes: [...nodes.values()], links } : null, '어느 출처가 어느 주제를 채우는지'),
        P('brf-treemap', '주제 비중', 'treemap', (() => { const t = top(cnt(items, (i) => tn(i.topic_id)), 14); return t.length ? { title: '주제 비중', unit: '건', items: t.map(([label, value], i) => ({ label, value, focal: i === 0 })) } : null; })(), '전체 수집 대비 비율'),
        P('brf-line', '일별 수집 추이', 'line', (() => { const m2 = cnt(items, (i) => s10(i.published_at)); const days = [...m2.keys()].sort().slice(-10); return days.length > 1 ? { title: '일별 수집 추이', x: days.map((d) => d.slice(5)), series: [{ name: '수집', values: days.map((d) => m2.get(d)), focal: true }] } : null; })(), '최근 수집량 변화'),
      ]; },
    '/playlist': (s) => { const L = live(s.playlistItems);
      return [
        P('ply-bar', '종류별 건수', 'bar', bars('종류별 건수', cnt(L, (x) => x.content_type)), '영화·책·공연 비중'),
        P('ply-funnel', '찜 → 감상 전환', 'pyramid', (() => { const c = cnt(L, (x) => x.status); const o = ['wishlist', 'watching', 'watched'].map((k) => [st(k), c.get(k) || 0]); return o.some((x) => x[1]) ? { title: '찜 → 감상', mode: 'funnel', levels: o.filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).map((x, i, arr) => ({ label: x[0], value: x[1], focal: i === arr.length - 1 })) } : null; })(), '보고 싶은 것 중 실제로 본 비율'),
        P('ply-timeline', '감상·공연 일정', 'timeline', timelineOf('감상·공연 일정', L.map((x) => ({ date: s10(x.event_date), title: x.title, sub: x.content_type }))), '날짜 순서로'),
        P('ply-heat', '월×종류 분포', 'heatmap', (() => { const kinds = [...new Set(L.map((x) => x.content_type).filter(Boolean))].slice(0, 6); const months = [...new Set(L.map((x) => s10(x.event_date).slice(0, 7)).filter(Boolean))].sort().slice(-8); return heat('월×종류 분포', months, kinds, (v) => { for (const x of L) { const a = months.indexOf(s10(x.event_date).slice(0, 7)), b = kinds.indexOf(x.content_type); if (a >= 0 && b >= 0) v[a][b]++; } }); })(), '언제 무엇을 즐기는지'),
      ]; },
    '/vehicles': (s) => { const V = live(s.vehicles); const M = V.flatMap((v) => live((s.maintenanceByVehicle || {})[v.id]).map((m) => ({ ...m, _v: v.name || v.plate_number }))); const cost = new Map(); for (const m of M) cost.set(m._v, (cost.get(m._v) || 0) + num(m.cost));
      return [
        P('veh-bar', '차량별 정비 비용', 'bar', cost.size ? { title: '차량별 정비 비용', unit: '원', orientation: 'h', items: top(cost).map(([label, value], i) => ({ label, value, focal: i === 0 })) } : null, '어느 차에 돈이 많이 드는지'),
        P('veh-timeline', '정비 이력', 'timeline', timelineOf('정비 이력', M.map((m) => ({ date: s10(m.service_date), title: m.item, sub: m._v }))), '언제 무엇을 했는지'),
        P('veh-line', '월별 정비 비용', 'line', (() => { const m2 = new Map(); for (const m of M) { const k = s10(m.service_date).slice(0, 7); if (k) m2.set(k, (m2.get(k) || 0) + num(m.cost)); } const ks = [...m2.keys()].sort().slice(-10); return ks.length > 1 ? { title: '월별 정비 비용', x: ks.map((k) => k.slice(2)), series: [{ name: '비용', values: ks.map((k) => m2.get(k)), focal: true }] } : null; })(), '비용 추세'),
        P('veh-waterfall', '정비 항목별 누적', 'waterfall', (() => { const by = new Map(); for (const m of M) by.set(m.item, (by.get(m.item) || 0) + num(m.cost)); const t = top(by, 7); return t.length ? { title: '정비 항목별 누적', unit: '원', start: { label: '시작', value: 0 }, steps: t.map(([label, delta]) => ({ label: lbl(label, 6), delta })), endLabel: '합계' } : null; })(), '비용이 어디서 쌓였는지'),
      ]; },
    '/stocks': (s) => { const H = live(s.stockHoldings); const A = live(s.brokerageAccounts); const val = (h) => num(h.quantity) * num(h.avg_price); const an = (id) => (A.find((a) => a.id === id) || {}).name || '계좌';
      const hv = H.map((h) => ({ label: lbl(h.name || h.symbol, 10), value: val(h), acc: an(h.account_id) })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
      const nodes = new Map(); const links = []; for (const h of hv.slice(0, 12)) { nodes.set(`a:${h.acc}`, { id: `a:${h.acc}`, label: lbl(h.acc, 10) }); nodes.set(`h:${h.label}`, { id: `h:${h.label}`, label: h.label }); links.push({ from: `a:${h.acc}`, to: `h:${h.label}`, value: Math.round(h.value / 10000) || 1 }); }
      return [
        P('stk-treemap', '보유 종목 비중(매수금액)', 'treemap', hv.length ? { title: '보유 종목 비중(매수금액 기준)', unit: '원', items: hv.slice(0, 20).map((h, i) => ({ label: h.label, value: h.value, focal: i === 0 })) } : null, '큰 종목이 얼마나 큰지'),
        P('stk-bar', '종목별 매수금액', 'bar', hv.length ? { title: '종목별 매수금액', unit: '원', orientation: 'h', items: hv.slice(0, 12).map((h, i) => ({ label: h.label, value: h.value, focal: i === 0 })) } : null, '순위 비교'),
        P('stk-sankey', '계좌 → 종목 배분', 'sankey', links.length ? { title: '계좌 → 종목 배분(만원)', unit: '만', nodes: [...nodes.values()], links } : null, '어느 증권사에 무엇이 있는지'),
        P('stk-org', '계좌 → 종목 구조', 'tree', A.length ? { root: { label: '내 증권', focal: true, children: A.slice(0, 5).map((a) => ({ label: lbl(a.name, 10), children: H.filter((h) => h.account_id === a.id).slice(0, 4).map((h) => ({ label: lbl(h.name || h.symbol, 10) })) })) } } : null, '계좌별 보유 종목'),
      ]; },
    '/health': (s) => { const M = live(s.healthMetrics); const types = [...new Set(M.map((m) => m.metric_type))]; const first = types[0];
      const ser = (t) => M.filter((m) => m.metric_type === t).sort((a, b) => String(a.recorded_at).localeCompare(String(b.recorded_at))).slice(-12);
      const lineFor = (t) => { const r = ser(t); return r.length > 1 ? { title: `${t} 추이`, x: r.map((m) => s10(m.recorded_at).slice(5)), series: [{ name: t, values: r.map((m) => num(m.value)), focal: true }] } : null; };
      return [
        P('hlt-line', `${first || '지표'} 추이`, 'line', first ? lineFor(first) : null, '최근 변화'),
        P('hlt-bar', '지표별 기록 수', 'bar', bars('지표별 기록 수', cnt(M, (m) => m.metric_type)), '무엇을 자주 기록하는지'),
        P('hlt-heat', '요일×지표 기록', 'heatmap', heat('요일×지표 기록', types.slice(0, 6), WD, (v) => { for (const m of M) { const a = types.slice(0, 6).indexOf(m.metric_type), d = wdOf(m.recorded_at); if (a >= 0 && d != null) v[a][d]++; } }), '기록 습관의 요일 패턴'),
        P('hlt-radar', '지표 기록 균형', 'radar', types.length >= 3 ? { title: '지표 기록 균형', max: Math.max(...types.slice(0, 7).map((t) => M.filter((m) => m.metric_type === t).length)), axes: types.slice(0, 7), series: [{ name: '기록 수', values: types.slice(0, 7).map((t) => M.filter((m) => m.metric_type === t).length), focal: true }] } : null, '균형 있게 챙기는지'),
      ]; },
    '/devlog': (s) => { const L = live(s.devlogs);
      return [
        P('dev-timeline', '개발 일지 타임라인', 'timeline', timelineOf('개발 일지', L.map((x) => ({ date: s10(x.logged_at), title: x.title, sub: x.type }))), '무엇을 언제 했는지'),
        P('dev-bar', '유형별 일지 수', 'bar', bars('유형별 일지 수', cnt(L, (x) => x.type)), '버그/기능/메모 비중'),
        P('dev-heat', '요일별 기록', 'heatmap', heat('요일별 기록', ['기록'], WD, (v) => { for (const x of L) { const d = wdOf(x.logged_at); if (d != null) v[0][d]++; } }), '언제 개발하는지'),
        P('dev-fish', '문제 원인 정리(빈 틀)', 'fishbone', null, '회고용 피시본 — 샘플을 고쳐 쓰세요'),
      ]; },
    '/knowledge': (s) => { const L = live(s.knowledgeDocs); const tags = new Map(); for (const d of L) for (const t of (Array.isArray(d.tags) ? d.tags : String(d.tags || '').split(',')).map((x) => String(x).trim()).filter(Boolean)) tags.set(t, (tags.get(t) || 0) + 1);
      return [
        P('knw-bar', '태그별 문서 수', 'bar', bars('태그별 문서 수', tags), '어떤 주제를 많이 쌓았는지'),
        P('knw-tree', '태그 → 문서', 'tree', tags.size ? { root: { label: 'Knowledge', focal: true, children: top(tags, 5).map(([t]) => ({ label: lbl(t, 10), children: L.filter((d) => String(Array.isArray(d.tags) ? d.tags.join(',') : d.tags || '').includes(t)).slice(0, 3).map((d) => ({ label: lbl(d.title, 12) })) })) } } : null, '주제별로 묶어 보기'),
        P('knw-treemap', '태그 비중', 'treemap', tags.size ? { title: '태그 비중', unit: '건', items: top(tags, 16).map(([label, value], i) => ({ label, value, focal: i === 0 })) } : null, '지식의 분포'),
      ]; },
    '/career': (s) => { const ex = live(s.careerDocuments).filter((x) => x.start_date || x.created_at);
      return [
        P('car-gantt', '경력 기간', 'gantt', ex.length ? { title: '경력 기간', today: new Date().toISOString().slice(0, 10), tasks: ex.slice(0, 12).map((x) => ({ label: lbl(x.company_name || x.title || x.name, 14), start: s10(x.start_date || x.created_at), end: s10(x.end_date || x.updated_at || x.created_at), progress: 100, group: '문서' })) } : null, '언제 어디서 일했는지'),
        P('car-timeline', '경력 타임라인', 'timeline', timelineOf('경력 타임라인', ex.map((x) => ({ date: s10(x.start_date || x.created_at), title: x.company_name || x.title || x.name, sub: x.position || x.kind }))), '이력 흐름'),
        P('car-nested', '역량 범위(빈 틀)', 'nested', null, '경력 → 역량 → 프로젝트 포함 관계'),
      ]; },
    '/automation': (s) => { const R = live(s.automationRules);
      return [
        P('aut-flow', '자동화 규칙 흐름', 'flowchart', R.length ? { title: '자동화 규칙', direction: 'LR', nodes: [{ id: 'ev', label: '데이터 변경', kind: 'start' }, ...R.slice(0, 8).map((r, i) => ({ id: `r${i}`, label: lbl(r.rule_type, 16), kind: r.enabled ? 'default' : 'muted' })), { id: 'out', label: '알림·갱신', kind: 'end' }], edges: [...R.slice(0, 8).map((_, i) => ({ from: 'ev', to: `r${i}` })), ...R.slice(0, 8).map((_, i) => ({ from: `r${i}`, to: 'out' }))] } : null, '규칙이 어떻게 걸려 있는지'),
        P('aut-bar', '켜짐 / 꺼짐', 'bar', bars('규칙 사용 상태', cnt(R, (r) => (r.enabled ? '켜짐' : '꺼짐'))), '활성 규칙 비율'),
        P('aut-seq', '실행 순서(예시)', 'sequence', null, '규칙 실행 순서 예시'),
      ]; },
    '/integrations': (s) => { const L = live(s.integrations);
      return [
        P('int-arch', '연동 구조', 'architecture', L.length ? { title: '연동 구조', direction: 'LR', nodes: [{ id: 'app', label: '나만의 Work Space', kind: 'focal' }, ...L.slice(0, 10).map((x, i) => ({ id: `i${i}`, label: lbl(x.provider, 12), sub: x.status, kind: 'external' }))], edges: L.slice(0, 10).map((_, i) => ({ from: 'app', to: `i${i}` })) } : null, '어디와 연결되어 있는지'),
        P('int-bar', '연동 상태', 'bar', bars('연동 상태', cnt(L, (x) => x.status)), '연결/미연결 현황'),
        P('int-sec', '보안 통제(예시)', 'dp-security-matrix', null, '무엇이 보호되는지 점검'),
      ]; },
    '/analytics': (s) => [
      P('ana-bar', '메뉴별 등록 건수', 'bar', BUILD['/home'](s)[1].data, '전체 자료 규모'),
      P('ana-treemap', '자료 비중', 'treemap', BUILD['/home'](s)[2].data, '비율로 보기'),
      P('ana-layers', '데이터 흐름 층', 'layers', null, '화면 → 상태 → 저장소'),
    ],
    '/usage': () => [
      P('use-layers', '서비스 구성 층', 'layers', null, '어디서 사용량이 발생하는지'),
      P('use-arch', '구조도', 'architecture', null, '브라우저·Vercel·Supabase'),
      P('use-sankey', '자산 배분 흐름(예시)', 'sankey', null, '흐름의 양을 띠 두께로'),
    ],
    '/programs': (s) => { const L = live(s.programs);
      return [
        P('prg-bar', '실행 횟수 상위', 'bar', (() => { const t = L.filter((p) => num(p.run_count) > 0).sort((a, b) => num(b.run_count) - num(a.run_count)).slice(0, 10); return t.length ? { title: '실행 횟수 상위', unit: '회', orientation: 'h', items: t.map((p, i) => ({ label: lbl(p.name, 12), value: num(p.run_count), focal: i === 0 })) } : null; })(), '자주 쓰는 프로그램'),
        P('prg-arch', '프로그램 허브', 'architecture', L.length ? { title: '프로그램 허브', direction: 'LR', nodes: [{ id: 'hub', label: '프로그램', kind: 'focal' }, ...L.slice(0, 10).map((p, i) => ({ id: `p${i}`, label: lbl(p.name, 12), kind: 'external' }))], edges: L.slice(0, 10).map((_, i) => ({ from: 'hub', to: `p${i}` })) } : null, '바로가기를 한눈에'),
        P('prg-treemap', '실행 비중', 'treemap', (() => { const t = L.filter((p) => num(p.run_count) > 0).slice(0, 16); return t.length ? { title: '실행 비중', unit: '회', items: t.map((p, i) => ({ label: lbl(p.name, 10), value: num(p.run_count), focal: i === 0 })) } : null; })(), '비율로'),
      ]; },
    '/settings': () => [P('set-layers', '설정·동기화 층', 'layers', null, '설정이 저장되는 층'), P('set-tree', '설정 구성', 'tree', null, '설정 항목 분류')],
  };

  function forMenu(path, state) {
    const f = BUILD[path]; if (!f) return [];
    let list; try { list = f(state || {}); } catch (e) { list = []; }
    const DC = C();
    return list.map((x) => { const def = DC && DC.BY_ID[x.type]; const sample = !x.data || !!(x.data.items && !x.data.items.length); return { ...x, sample, data: sample ? (def ? pt(def.sample) : null) : x.data, typeKo: def ? def.ko : x.type }; });
  }
  const MENUS = Object.keys(BUILD);
  const api = { forMenu, MENUS };
  root.DiagramAdapters = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
