import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// v7.20.0 WBS/간트 순수 로직: 트리·번호·롤업·임계 경로(순환 가드)·이동·개요 파싱·기존 중분류 이전·드래그·기준선·레이아웃.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function load(rel) { (0, eval)(fs.readFileSync(path.join(__dirname, rel), 'utf8')); }
globalThis.window = globalThis;
load('../js/utils/date.js');
load('../js/predict.js');
load('../js/wbs.js');
const W = globalThis.WBS;

const n = (id, o = {}) => ({ id, project_id: 'P', name: id, seq: 0, parent_id: null, status: 'todo', progress: 0, ...o });
const names = (tree) => tree.order.map((r) => `${r.number}:${r.node.id}`);

test('buildTree: 번호 1, 1.1, 1.1.1 / 깊이로 대중소 레벨 / seq 순서', () => {
  const rows = [n('b', { seq: 1 }), n('a', { seq: 0 }), n('a2', { parent_id: 'a', seq: 1 }), n('a1', { parent_id: 'a', seq: 0 }), n('a1x', { parent_id: 'a1' })];
  const t = W.buildTree(rows);
  assert.deepEqual(names(t), ['1:a', '1.1:a1', '1.1.1:a1x', '1.2:a2', '2:b']);
  assert.deepEqual(t.order.map((r) => W.levelLabel(r.depth)), ['대', '중', '소', '중', '대']);
  assert.equal(t.order[0].hasChildren, true);
  assert.equal(t.order[2].hasChildren, false);
});

test('buildTree: 부모가 없는 행은 최상위, parent_id 순환(손상 데이터)은 끊어 모든 행이 한 번씩 나온다', () => {
  const orphan = W.buildTree([n('x', { parent_id: 'ghost' })]);
  assert.deepEqual(names(orphan), ['1:x']);
  const cyc = W.buildTree([n('a', { parent_id: 'b' }), n('b', { parent_id: 'a' }), n('s', { parent_id: 's' })]);
  assert.equal(cyc.order.length, 3);
  assert.equal(new Set(cyc.order.map((r) => r.node.id)).size, 3);
});

test('visibleRows: 접은 노드의 자손은 숨긴다(여러 단계)', () => {
  const t = W.buildTree([n('a'), n('a1', { parent_id: 'a' }), n('a1x', { parent_id: 'a1' }), n('b')]);
  assert.deepEqual(W.visibleRows(t, new Set(['a'])).map((r) => r.node.id), ['a', 'b']);
  assert.deepEqual(W.visibleRows(t, new Set(['a1'])).map((r) => r.node.id), ['a', 'a1', 'b']);
});

test('rollupProgress: 기간 가중 평균(긴 작업이 더 크게 반영)', () => {
  assert.equal(W.rollupProgress([{ progress: 100, duration: 1 }, { progress: 0, duration: 9 }]), 10);
  assert.equal(W.rollupProgress([{ progress: 50, duration: 5 }, { progress: 100, duration: 5 }]), 75);
  assert.equal(W.rollupProgress([]), 0);
  assert.equal(W.rollupProgress([{ progress: 40, duration: 0 }, { progress: 60, duration: 0 }]), 50); // 가중치 0이면 단순 평균
  assert.equal(W.rollupProgress([{ progress: 150, duration: 1 }]), 100); // 범위 보정
});

test('rollupDates: 가장 이른 시작 ~ 가장 늦은 종료, 날짜 없으면 null', () => {
  assert.deepEqual(W.rollupDates([{ start: '2026-10-05', end: '2026-10-09' }, { start: '2026-10-01', end: '2026-10-03' }]), { start: '2026-10-01', end: '2026-10-09' });
  assert.deepEqual(W.rollupDates([{}, {}]), { start: null, end: null });
  assert.deepEqual(W.rollupDates([{ start: '2026-10-05', end: null }, { start: null, end: '2026-10-20' }]), { start: '2026-10-05', end: '2026-10-20' });
});

test('computeRollup: 부모는 자식에서 기간/진행률을 계산, status=done 리프는 100%, 마일스톤은 기간 0', () => {
  const rows = [
    n('root'),
    n('t1', { parent_id: 'root', start_date: '2026-10-01', target_date: '2026-10-10', progress: 50, seq: 0 }), // 10일 50%
    n('t2', { parent_id: 'root', start_date: '2026-10-11', target_date: '2026-10-20', status: 'done', seq: 1 }), // 10일 done
    n('m', { parent_id: 'root', start_date: '2026-10-25', is_milestone: true, seq: 2 }),
  ];
  const r = W.computeRollup(W.buildTree(rows));
  assert.deepEqual([r.get('root').start, r.get('root').end], ['2026-10-01', '2026-10-25']);
  assert.equal(r.get('root').progress, 75); // (50*10 + 100*10 + 0*0)/20
  assert.equal(r.get('t2').progress, 100);
  assert.equal(r.get('m').duration, 0);
  assert.equal(r.get('m').milestone, true);
  assert.equal(r.get('root').isLeaf, false);
});

test('effectiveStatus', () => {
  assert.equal(W.effectiveStatus({ progress: 100, end: '2026-01-01' }, '2026-10-07'), 'done');
  assert.equal(W.effectiveStatus({ progress: 10, end: '2026-10-01' }, '2026-10-07'), 'overdue');
  assert.equal(W.effectiveStatus({ progress: 10, end: '2026-10-30', start: '2026-10-01' }, '2026-10-07'), 'in_progress');
  assert.equal(W.effectiveStatus({ progress: 0, start: '2026-11-01', end: '2026-11-05' }, '2026-10-07'), 'todo');
});

// ---------------- 임계 경로 ----------------
const task = (id, s, e, deps = [], o = {}) => n(id, { start_date: s, target_date: e, depends_on: deps, ...o });

test('criticalPath: 선후 사슬 A→B→C 는 모두 임계, 병렬의 짧은 D는 여유가 있다', () => {
  const rows = [
    task('A', '2026-10-01', '2026-10-05'), // 5일
    task('B', '2026-10-06', '2026-10-10', ['A']), // 5일
    task('C', '2026-10-11', '2026-10-15', ['B']), // 5일 → 끝 10/15
    task('D', '2026-10-01', '2026-10-03'), // 독립, 3일 → 여유 있음
  ];
  const cp = W.criticalPath(rows);
  assert.deepEqual([...cp.critical].sort(), ['A', 'B', 'C']);
  assert.equal(cp.slack.get('D') > 0, true);
  assert.equal(cp.slack.get('C'), 0);
  assert.deepEqual(cp.cycles, []);
});

test('criticalPath: 두 갈래 중 긴 쪽만 임계(여유 = 두 경로 길이 차)', () => {
  const rows = [
    task('S', '2026-10-01', '2026-10-01'),
    task('L', '2026-10-02', '2026-10-11', ['S']), // 10일
    task('Sh', '2026-10-02', '2026-10-04', ['S']), // 3일
    task('E', '2026-10-12', '2026-10-12', ['L', 'Sh']),
  ];
  const cp = W.criticalPath(rows);
  assert.deepEqual([...cp.critical].sort(), ['E', 'L', 'S']);
  assert.equal(cp.slack.get('Sh'), 7);
});

test('criticalPath: 의존 때문에 계획보다 늦어지는 경우 순방향 계산에 반영 + 위반 목록', () => {
  const rows = [
    task('A', '2026-10-01', '2026-10-10'), // 10일
    task('B', '2026-10-05', '2026-10-07', ['A']), // 계획은 A가 끝나기 전에 시작(위반)
  ];
  const cp = W.criticalPath(rows);
  assert.equal(cp.es.get('B') - cp.es.get('A'), 10); // B는 A 끝(10일 뒤) 이후에만 시작 가능
  assert.deepEqual(cp.violations, [{ from: 'A', to: 'B', type: 'FS' }]);
});

test('criticalPath: SS / FF / SF 의존 유형', () => {
  const ss = W.criticalPath([task('A', '2026-10-01', '2026-10-10'), task('B', '2026-10-01', '2026-10-03', ['A:SS'])]);
  assert.equal(ss.violations.length, 0);
  assert.equal(ss.es.get('B'), ss.es.get('A'));
  const ff = W.criticalPath([task('A', '2026-10-01', '2026-10-10'), task('B', '2026-10-08', '2026-10-10', ['A:FF'])]);
  assert.equal(ff.violations.length, 0);
  const ffBad = W.criticalPath([task('A', '2026-10-01', '2026-10-10'), task('B', '2026-10-01', '2026-10-05', ['A:FF'])]);
  assert.equal(ffBad.violations.length, 1);
  const sf = W.criticalPath([task('A', '2026-10-05', '2026-10-10'), task('B', '2026-10-01', '2026-10-06', ['A:SF'])]);
  assert.equal(sf.violations.length, 0);
});

test('criticalPath: 의존 순환은 가드(무한루프 없이 cycles로 보고, 나머지는 계산)', () => {
  const rows = [
    task('A', '2026-10-01', '2026-10-05', ['B']),
    task('B', '2026-10-06', '2026-10-10', ['A']),
    task('X', '2026-10-01', '2026-10-20'),
  ];
  const cp = W.criticalPath(rows);
  assert.deepEqual(cp.cycles.sort(), ['A', 'B']);
  assert.deepEqual([...cp.critical], ['X']);
  const selfDep = W.criticalPath([task('A', '2026-10-01', '2026-10-05', ['A'])]);
  assert.deepEqual(selfDep.cycles, []); // 자기 자신 의존은 무시
  assert.deepEqual([...selfDep.critical], ['A']);
});

test('criticalPath: 부모(요약)는 계산에서 제외, 날짜 없는 항목 무시, 빈 입력', () => {
  const rows = [n('P1'), task('A', '2026-10-01', '2026-10-05', [], { parent_id: 'P1' }), n('nodate')];
  const cp = W.criticalPath(rows);
  assert.deepEqual([...cp.critical], ['A']);
  assert.equal(cp.slack.has('P1'), false);
  assert.equal(cp.slack.has('nodate'), false);
  const empty = W.criticalPath([]);
  assert.equal(empty.projectEnd, null);
});

test('criticalPath: 마일스톤(기간 0)이 끝에 있으면 임계 사슬에 포함', () => {
  const rows = [task('A', '2026-10-01', '2026-10-05'), n('M', { start_date: '2026-10-06', is_milestone: true, depends_on: ['A'] })];
  const cp = W.criticalPath(rows);
  assert.deepEqual([...cp.critical].sort(), ['A', 'M']);
});

test('wouldCreateCycle: 직접/간접 순환과 자기 자신', () => {
  const rows = [n('A'), n('B', { depends_on: ['A'] }), n('C', { depends_on: ['B'] })];
  assert.equal(W.wouldCreateCycle(rows, 'A', 'C'), true); // A가 C에 의존 → A→...→C→B→A 순환
  assert.equal(W.wouldCreateCycle(rows, 'A', 'A'), true);
  assert.equal(W.wouldCreateCycle(rows, 'C', 'A'), false); // C가 A에 의존(이미 간접으로 그렇다)
  assert.equal(W.wouldCreateCycle(rows, 'B', 'C'), true);
});

test('parseDep/formatDep', () => {
  assert.deepEqual(W.parseDep('abc'), { id: 'abc', type: 'FS' });
  assert.deepEqual(W.parseDep('abc:SS'), { id: 'abc', type: 'SS' });
  assert.deepEqual(W.parseDep('abc:XX'), { id: 'abc:XX', type: 'FS' });
  assert.equal(W.formatDep('abc'), 'abc');
  assert.equal(W.formatDep('abc', 'FF'), 'abc:FF');
});

// ---------------- 이동 ----------------
const apply = (rows, patches) => rows.map((r) => { const p = patches.find((x) => x.id === r.id); return p ? { ...r, ...p.patch } : r; });
const shape = (rows) => names(W.buildTree(rows));

test('moveNode up/down: 같은 부모 안에서 순서만 바꾼다, 가장자리는 불가', () => {
  const rows = [n('a', { seq: 0 }), n('b', { seq: 1 }), n('c', { seq: 2 })];
  const up = W.moveNode(rows, 'c', 'up');
  assert.equal(up.ok, true);
  assert.deepEqual(shape(apply(rows, up.patches)), ['1:a', '2:c', '3:b']);
  assert.deepEqual(shape(apply(rows, W.moveNode(rows, 'a', 'down').patches)), ['1:b', '2:a', '3:c']);
  assert.deepEqual(W.moveNode(rows, 'a', 'up'), { ok: false, reason: 'edge' });
  assert.equal(W.moveNode(rows, 'c', 'down').ok, false);
});

test('moveNode indent: 앞 형제의 마지막 자식이 된다(하위도 같이 이동), 앞 형제 없으면 불가', () => {
  const rows = [n('a', { seq: 0 }), n('a1', { parent_id: 'a', seq: 0 }), n('b', { seq: 1 }), n('b1', { parent_id: 'b', seq: 0 })];
  const r = W.moveNode(rows, 'b', 'indent');
  assert.equal(r.ok, true);
  assert.deepEqual(shape(apply(rows, r.patches)), ['1:a', '1.1:a1', '1.2:b', '1.2.1:b1']);
  assert.deepEqual(W.moveNode(rows, 'a', 'indent'), { ok: false, reason: 'no_prev_sibling' });
});

test('moveNode outdent: 부모 바로 다음 형제가 된다, 최상위는 불가', () => {
  const rows = [n('a', { seq: 0 }), n('a1', { parent_id: 'a', seq: 0 }), n('a2', { parent_id: 'a', seq: 1 }), n('b', { seq: 1 })];
  const r = W.moveNode(rows, 'a1', 'outdent');
  assert.equal(r.ok, true);
  assert.deepEqual(shape(apply(rows, r.patches)), ['1:a', '1.1:a2', '2:a1', '3:b']);
  assert.deepEqual(W.moveNode(rows, 'a', 'outdent'), { ok: false, reason: 'already_top' });
});

test('moveNode indent: 최대 깊이(4단계)를 넘기면 거부', () => {
  const rows = [n('a'), n('b', { parent_id: 'a' }), n('c', { parent_id: 'b' }), n('d', { parent_id: 'c' }), n('x', { seq: 1 }), n('x1', { parent_id: 'x' })];
  // x(+x1 하위)를 d 아래로? x는 a의 형제이므로 indent하면 a의 자식(깊이1), x1은 깊이2 → 허용
  assert.equal(W.moveNode(rows, 'x', 'indent').ok, true);
  // d 밑(깊이3)에 새로 4번째 레벨은 이미 MAX. e를 d의 앞 형제로 두고 d를 indent하면 e 아래 깊이 4 → 거부
  const deep = [n('a'), n('b', { parent_id: 'a' }), n('c', { parent_id: 'b' }), n('e', { parent_id: 'c', seq: 0 }), n('d', { parent_id: 'c', seq: 1 })];
  assert.deepEqual(W.moveNode(deep, 'd', 'indent'), { ok: false, reason: 'max_depth' });
});

// ---------------- 개요 붙여넣기 ----------------
test('parseOutline: 들여쓰기(탭/공백 2칸)·불릿·번호 접두어', () => {
  const text = '기획\n  요구사항 정리\n  일정 수립\n개발\n\t백엔드\n\t\tAPI\n- 배포\n  - 문서';
  assert.deepEqual(W.parseOutline(text), [
    { name: '기획', depth: 0 }, { name: '요구사항 정리', depth: 1 }, { name: '일정 수립', depth: 1 },
    { name: '개발', depth: 0 }, { name: '백엔드', depth: 1 }, { name: 'API', depth: 2 }, { name: '배포', depth: 0 }, { name: '문서', depth: 1 },
  ]);
  assert.deepEqual(W.parseOutline('1. 설계\n1.1 DB\n1.1.1 테이블\n2. 구현').map((x) => x.depth), [0, 1, 2, 0]);
});

test('parseOutline: 깊이는 직전 줄보다 1 넘게 깊어지지 않고 최대 깊이를 넘지 않는다, 빈 줄 무시', () => {
  assert.deepEqual(W.parseOutline('        깊은 시작\n\n    더 깊게').map((x) => x.depth), [0, 1]);
  assert.equal(Math.max(...W.parseOutline('a\n  b\n    c\n      d\n        e\n          f').map((x) => x.depth)), 3);
  assert.deepEqual(W.parseOutline(''), []);
});

test('outlineToRows: 부모 인덱스와 형제 seq(시작 번호 이어붙이기)', () => {
  const rows = W.outlineToRows(W.parseOutline('A\n  A1\n  A2\nB'), 'base', 5);
  assert.deepEqual(rows.map((r) => [r.name, r.parentIndex, r.seq]), [['A', -1, 5], ['A1', 0, 0], ['A2', 0, 1], ['B', -1, 6]]);
  assert.equal(rows[0].parent_id, 'base');
});

// ---------------- 기존 중분류 이전 ----------------
test('planLegacyStageMigration: group_name별 그룹 부모 1개 + 단계 연결, 원본 보존, 재실행 시 변화 없음', () => {
  const rows = [
    n('s1', { group_name: '1학기', seq: 0 }), n('s2', { group_name: '1학기', seq: 1 }), n('s3', { group_name: '2학기', seq: 2 }), n('s4', { seq: 3 }),
    n('t1', { project_id: 'Q', group_name: '1학기', seq: 0 }),
  ];
  const plan = W.planLegacyStageMigration(rows);
  assert.equal(plan.create.length, 3); // P|1학기, P|2학기, Q|1학기
  assert.deepEqual(plan.create.map((c) => c.key).sort(), ['P|1학기', 'P|2학기', 'Q|1학기']);
  assert.equal(plan.link.length, 4); // s4(그룹 없음)는 그대로
  assert.deepEqual(plan.link.map((l) => l.id).sort(), ['s1', 's2', 's3', 't1']);
  // 적용 후 다시 계획 → 아무 것도 없음
  const idByKey = new Map(plan.create.map((c, i) => [c.key, `g${i}`]));
  const next = rows.map((r) => { const l = plan.link.find((x) => x.id === r.id); return l ? { ...r, parent_id: idByKey.get(l.parentKey) } : r; })
    .concat(plan.create.map((c) => ({ id: idByKey.get(c.key), project_id: c.project_id, name: c.name, seq: c.seq, group_name: c.name, legacy_group: true, parent_id: null })));
  assert.deepEqual(W.planLegacyStageMigration(next), { create: [], link: [] });
  assert.equal(next.find((r) => r.id === 's1').group_name, '1학기'); // 원본 group_name 보존
  // 이전 후 트리: 그룹(대) → 단계(중)
  const t = W.buildTree(next.filter((r) => r.project_id === 'P'));
  assert.deepEqual(t.order.filter((r) => r.depth === 0).map((r) => r.node.name).sort(), ['1학기', '2학기', 's4']);
});

test('planLegacyStageMigration: 이미 있는 그룹 부모가 있으면 새로 만들지 않고 연결만', () => {
  const rows = [n('g', { legacy_group: true, group_name: '1학기', name: '1학기' }), n('s1', { group_name: '1학기' })];
  assert.deepEqual(W.planLegacyStageMigration(rows), { create: [], link: [{ id: 's1', parent_id: 'g' }] });
});

// ---------------- 드래그 / 기준선 ----------------
test('dragDates: 이동/시작·끝 조절, 시작>종료가 되지 않게, 마일스톤은 이동만', () => {
  const node = { start_date: '2026-10-10', target_date: '2026-10-15' };
  assert.deepEqual(W.dragDates(node, 'move', 3), { start_date: '2026-10-13', target_date: '2026-10-18' });
  assert.deepEqual(W.dragDates(node, 'move', -12), { start_date: '2026-09-28', target_date: '2026-10-03' });
  assert.deepEqual(W.dragDates(node, 'end', 4), { start_date: '2026-10-10', target_date: '2026-10-19' });
  assert.deepEqual(W.dragDates(node, 'end', -20), { start_date: '2026-10-10', target_date: '2026-10-10' });
  assert.deepEqual(W.dragDates(node, 'start', -2), { start_date: '2026-10-08', target_date: '2026-10-15' });
  assert.deepEqual(W.dragDates(node, 'start', 30), { start_date: '2026-10-15', target_date: '2026-10-15' });
  assert.deepEqual(W.dragDates({ start_date: '2026-10-10', is_milestone: true }, 'end', 5), { start_date: '2026-10-15', target_date: '2026-10-15' });
  assert.equal(W.dragDates({}, 'move', 1), null);
  assert.deepEqual(W.dragDates({ start_date: '2026-02-27', target_date: '2026-02-28' }, 'move', 2), { start_date: '2026-03-01', target_date: '2026-03-02' });
});

test('snapshotBaseline: 날짜 있는 리프만 현재 날짜를 기준선으로, baselineVariance', () => {
  const rows = [n('p'), task('a', '2026-10-01', '2026-10-05', [], { parent_id: 'p' }), n('nodate', { parent_id: 'p' }), n('m', { start_date: '2026-10-09', is_milestone: true, parent_id: 'p' })];
  const snap = W.snapshotBaseline(rows);
  assert.deepEqual(snap.map((s) => s.id).sort(), ['a', 'm']);
  assert.deepEqual(snap.find((s) => s.id === 'a').patch, { baseline_start: '2026-10-01', baseline_end: '2026-10-05' });
  assert.deepEqual(W.baselineVariance('2026-10-01', '2026-10-05', '2026-10-03', '2026-10-09'), { startDelta: 2, endDelta: 4 });
  assert.equal(W.baselineVariance(null, null, '2026-10-03', '2026-10-09'), null);
});

// ---------------- 레이아웃 ----------------
test('layoutGantt: 막대 좌표(일수×px), 마일스톤/요약, 접힌 행 제외, 오늘선, 주말, 의존 화살표', () => {
  const rows = [
    n('P', { seq: 0 }),
    task('A', '2026-10-05', '2026-10-09', [], { parent_id: 'P', seq: 0 }),
    task('B', '2026-10-12', '2026-10-14', ['A'], { parent_id: 'P', seq: 1 }),
    n('M', { parent_id: 'P', seq: 2, start_date: '2026-10-15', is_milestone: true, depends_on: ['B'] }),
  ];
  const L = W.layoutGantt({ rows, collapsed: new Set(), zoom: 'day', todayIso: '2026-10-07' });
  assert.equal(L.px, W.ZOOM_PX.day);
  assert.equal(L.items.length, 4);
  const [p, a, b, m] = L.items;
  assert.equal(p.kind, 'summary');
  assert.equal(a.kind, 'task');
  assert.equal(m.kind, 'milestone');
  assert.equal(a.w, 5 * L.px); // 10/5~10/9 = 5일
  assert.equal(b.x - a.x, 7 * L.px); // 10/12 - 10/5
  assert.equal(L.todayX, a.x + 2 * L.px + L.px / 2); // 10/7 칸의 가운데
  assert.equal(L.items[1].y, W.HEADER_H + W.ROW_H);
  assert.equal(L.deps.length, 2);
  assert.equal(L.deps[0].type, 'FS');
  assert.equal(L.deps[0].violation, false);
  assert.equal(L.weekends.length > 0, true);
  const collapsed = W.layoutGantt({ rows, collapsed: new Set(['P']), zoom: 'week', todayIso: '2026-10-07' });
  assert.equal(collapsed.items.length, 1);
  assert.equal(collapsed.deps.length, 0); // 숨겨진 행끼리의 화살표는 그리지 않음
  const month = W.layoutGantt({ rows, zoom: 'month', todayIso: '2026-10-07' });
  assert.equal(month.weekends.length, 0);
  assert.equal(month.width < L.width, true);
});

test('layoutGantt: 날짜 없는 행은 막대 없이 한 줄만, 기준선·위반 표시', () => {
  const rows = [
    task('A', '2026-10-01', '2026-10-10', [], { baseline_start: '2026-10-01', baseline_end: '2026-10-05' }),
    task('B', '2026-10-05', '2026-10-07', ['A']), // 위반
    n('nodate'),
  ];
  const L = W.layoutGantt({ rows, zoom: 'week', todayIso: '2026-10-07' });
  assert.equal(L.items.find((i) => i.id === 'nodate').hasDates, false);
  assert.equal(L.items.find((i) => i.id === 'nodate').x, null);
  assert.equal(L.items.find((i) => i.id === 'A').baseline.w, 5 * L.px);
  assert.equal(L.items.find((i) => i.id === 'A').variance.endDelta, 5);
  assert.equal(L.deps[0].violation, true);
});

test('ganttRange/ganttTicks: 모든 날짜+오늘을 포함하고 최소 4주', () => {
  const r = W.ganttRange(['2026-10-05', null, '2026-10-09'], '2026-10-07', 'week');
  assert.equal(r.min <= '2026-10-05', true);
  assert.equal(r.days >= 29, true);
  const wk = W.ganttTicks('2026-10-01', '2026-11-15', 'week');
  assert.equal(wk.every((t) => globalThis.isoWeekday(t.iso) === 1), true);
  const mo = W.ganttTicks('2026-10-01', '2027-02-15', 'month');
  assert.deepEqual(mo.map((t) => t.label), ['10월', '11월', '12월', '1월', '2월']);
  assert.equal(mo.find((t) => t.label === '1월').major, true);
});
