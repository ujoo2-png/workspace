import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const d = path.dirname(fileURLToPath(import.meta.url));
globalThis.window = globalThis;
for (const f of ['core', 'graph', 'types-graph', 'types-time', 'types-chart', 'types-shape', 'adapters', 'importers']) (0, eval)(fs.readFileSync(path.join(d, '../js/diagram', f + '.js'), 'utf8'));
const C = globalThis.DiagramCore, AD = globalThis.DiagramAdapters, IM = globalThis.DiagramImport;

test('45개 유형이 등록되고 설명·샘플이 있다', () => {
  assert.equal(C.TYPES.length, 45);
  assert.equal(new Set(C.TYPES.map((t) => t.id)).size, 45);
  for (const t of C.TYPES) for (const k of ['ko', 'en', 'family', 'short', 'desc', 'when', 'tips']) assert.ok(t[k], `${t.id}.${k}`);
});
const checkSvg = (id, res) => {
  assert.ok(!/NaN|undefined|Infinity/.test(res.svg), `${id}: NaN/undefined`);
  assert.match(res.svg, /role="img"/, id);
  assert.match(res.svg, /<title id=/, id);
  assert.ok((res.svg.match(/<svg/g) || []).length === 1, id);
  const open = (res.svg.match(/<(g|text|defs|style)\b/g) || []).length, close = (res.svg.match(/<\/(g|text|defs|style)>/g) || []).length;
  assert.equal(open, close, `${id}: 태그 짝`);
};
test('모든 유형이 샘플로 오류 없이 그려진다(경고 없음)', () => {
  for (const t of C.TYPES) { const r = C.render(t.id, t.sample, {}); checkSvg(t.id, r); assert.deepEqual(r.warnings, [], `${t.id}: ${r.warnings}`); assert.ok(r.W > 100 && r.H > 50); }
});
test('설정 조합(스킨·레이아웃·크기·상세도·대상·글꼴·움직임·손그림)이 전 유형에서 동작', () => {
  const variants = [{ skin: 'dark' }, { skin: 'terminal' }, { skin: 'auto' }, { layout: 'full' }, { size: 'slide-16x9' }, { size: 'print-a4-landscape' }, { size: 'fit' }, { detail: 'simplified' }, { detail: 'faithful' }, { audience: 'executive' }, { audience: 'engineer' }, { fontSource: 'system' }, { sketchy: true }, { motion: 'reveal' }, { motion: 'step' }, { motion: 'loop' }, { direction: 'LR' }, { direction: 'TB' }, { legend: false, annotations: false, icons: false, tableView: false }];
  for (const v of variants) for (const t of C.TYPES) { const r = C.render(t.id, t.sample, v); checkSvg(t.id + JSON.stringify(v), r); }
  for (const p of Object.keys(C.PRESETS)) { const r = C.render('architecture', C.BY_ID.architecture.sample, { size: p }); assert.ok(r.W > 0); }
});
test('내보내기: svg/html/sidecar', () => {
  const r = C.render('bar', C.BY_ID.bar.sample, { motion: 'step', layout: 'full' });
  assert.match(C.svgFile(r), /^<svg/); assert.match(C.htmlDoc(r), /<!doctype html>/);
  const j = JSON.parse(C.sidecar(r)); assert.equal(j.type, 'bar'); assert.ok(j.blocks.length);
  const sys = C.htmlDoc(C.render('bar', C.BY_ID.bar.sample, { fontSource: 'system' })); assert.ok(!/fonts\.googleapis/.test(sys));
});
test('접근성: title/desc, 표로 보기, 움직임 정적 대체', () => {
  const r = C.render('flowchart', C.BY_ID.flowchart.sample, {}); assert.match(r.svg, /aria-labelledby="[^"]+-title [^"]+-desc"/);
  assert.ok(r.table.length > 0); assert.match(C.fragment(r), /표로 보기/);
  assert.match(C.fragment(C.render('bar', C.BY_ID.bar.sample, { motion: 'reveal' })), /prefers-reduced-motion/);
});
test('사용자 팔레트: 대비 부족 경고, 잘못된 색은 무시', () => {
  const bad = C.render('bar', C.BY_ID.bar.sample, { palette: { ink: '#eeeeee' } }); assert.ok(bad.warnings.some((w) => /대비/.test(w)));
  const ok = C.render('bar', C.BY_ID.bar.sample, { palette: { accent: 'zzz' } }); assert.equal(ok.tok.accent, C.SKINS.light.accent);
});
test('복잡도 예산: 노드가 많으면 경고', () => {
  const nodes = Array.from({ length: 20 }, (_, i) => ({ id: 'n' + i, label: 'N' + i })); const edges = nodes.slice(1).map((n, i) => ({ from: 'n' + i, to: n.id }));
  assert.ok(C.render('flowchart', { nodes, edges }, {}).warnings.length > 0);
});
test('그래프 엣지는 직각(수평/수직) 선분으로만 이뤄진다', () => {
  const r = C.render('architecture', C.BY_ID.architecture.sample, {});
  for (const m of r.svg.matchAll(/<path d="(M[^"]+)"[^>]*fill="none"/g)) { const cmds = m[1].match(/[MLHVQAC]/g) || []; assert.ok(!cmds.includes('C'), '곡선 베지어 금지(둥근 모서리는 Q/A)'); }
});
test('한글/긴 라벨·빈 데이터도 깨지지 않는다', () => {
  for (const t of C.TYPES) { try { const r = C.render(t.id, {}, {}); assert.ok(r.svg); } catch (e) { assert.fail(`${t.id}: 빈 데이터 ${e.message}`); } }
  const r = C.render('bar', { items: [{ label: '아주아주아주아주아주 긴 한글 라벨입니다 정말로', value: 1 }] }, {}); checkSvg('long', r);
});
test('어댑터: 모든 메뉴가 유효한 유형·데이터를 돌려주고 렌더된다(빈 상태→샘플)', () => {
  assert.ok(AD.MENUS.length >= 17);
  for (const m of AD.MENUS) { const list = AD.forMenu(m, {}); assert.ok(list.length >= 2, m); for (const it of list) { assert.ok(C.BY_ID[it.type], `${m}:${it.type}`); assert.equal(typeof it.sample, 'boolean'); checkSvg(m + it.key, C.render(it.type, it.data, {})); } }
});
test('어댑터: 실제 데이터로 내 데이터 다이어그램이 만들어진다', () => {
  const st = {
    schedules: [{ id: 1, title: '회의', date: '2026-11-03', time: '10:00' }, { id: 2, title: '운동', date: '2026-11-04', time: '19:00', done: true }],
    stockHoldings: [{ id: 'h1', account_id: 'a1', symbol: '005930', name: '삼성전자', quantity: 10, avg_price: 70000 }, { id: 'h2', account_id: 'a1', symbol: '000660', name: 'SK하이닉스', quantity: 5, avg_price: 170000 }],
    brokerageAccounts: [{ id: 'a1', name: 'KB증권' }],
    projects: [{ id: 'p', name: '앱', status: 'active' }], projectStages: [{ project_id: 'p', name: '설계', start_date: '2026-11-01', target_date: '2026-11-10', status: 'done' }],
  };
  const sch = AD.forMenu('/schedule', st); assert.equal(sch.find((x) => x.type === 'timeline').sample, false);
  const stk = AD.forMenu('/stocks', st); const tm = stk.find((x) => x.type === 'treemap'); assert.equal(tm.sample, false); assert.equal(tm.data.items[0].label, 'SK하이닉스');
  assert.equal(stk.find((x) => x.type === 'sankey').sample, false);
  assert.equal(AD.forMenu('/projects', st).find((x) => x.type === 'gantt').sample, false);
  for (const m of ['/schedule', '/stocks', '/projects']) for (const it of AD.forMenu(m, st)) checkSvg(it.key, C.render(it.type, it.data, {}));
});
test('가져오기: Mermaid(flowchart/sequence)·draw.io·Excalidraw', () => {
  const f = IM.importAny('graph TD\nA[시작] --> B{분기}\nB -->|예| C[끝]'); assert.equal(f.type, 'flowchart'); assert.equal(f.data.nodes.length, 3); assert.equal(f.data.edges.length, 2); assert.equal(f.data.nodes[1].kind, 'decision');
  const s = IM.importAny('sequenceDiagram\nA->>B: hi\nB-->>A: ok'); assert.equal(s.type, 'sequence'); assert.equal(s.data.messages.length, 2);
  const x = IM.importAny('<mxGraphModel><root><mxCell id="1" value="A" vertex="1"/><mxCell id="2" value="B" vertex="1"/><mxCell id="3" edge="1" source="1" target="2"/></root></mxGraphModel>'); assert.equal(x.kind, 'drawio'); assert.equal(x.data.edges.length, 1);
  const e = IM.importAny(JSON.stringify({ elements: [{ id: 'r1', type: 'rectangle' }, { id: 't1', type: 'text', containerId: 'r1', text: '가' }, { id: 'r2', type: 'ellipse' }, { id: 'a', type: 'arrow', startBinding: { elementId: 'r1' }, endBinding: { elementId: 'r2' } }] })); assert.equal(e.kind, 'excalidraw'); assert.equal(e.data.nodes[0].label, '가'); assert.equal(e.data.edges.length, 1);
  for (const r of [f, s, x, e]) { checkSvg('imp', C.render(r.type, r.data, {})); assert.ok(r.ledger.length); }
  assert.ok(IM.importAny('foo bar').ledger.some((l) => l.level === 'lost'));
});
