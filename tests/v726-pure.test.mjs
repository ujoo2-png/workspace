import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// v7.26.0: WBS 끌어서 이동(moveTo) / 일부 단계 복사 묶음(planStageClip) / 붙여넣기 옵션(applyClipOptions).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function load(rel) { (0, eval)(fs.readFileSync(path.join(__dirname, rel), 'utf8')); }
globalThis.window = globalThis;
load('../js/utils/date.js'); load('../js/predict.js'); load('../js/wbs.js');
const W = globalThis.WBS;
const n = (id, o = {}) => ({ id, project_id: 'P', name: id, seq: 0, parent_id: null, status: 'todo', progress: 0, ...o });
const order = (rows) => W.buildTree(rows).order.map((r) => `${r.number}:${r.node.id}`);
const apply = (rows, patches) => rows.map((r) => { const p = patches.find((x) => x.id === r.id); return p ? { ...r, ...p.patch } : r; });
const base = () => [n('a', { seq: 0 }), n('a1', { parent_id: 'a', seq: 0 }), n('a2', { parent_id: 'a', seq: 1 }), n('b', { seq: 1 }), n('c', { seq: 2 })];

test('moveTo: 앞/뒤/하위로 이동하면 번호가 그대로 재배열된다', () => {
  let r = W.moveTo(base(), 'c', 'a', 'before');
  assert.deepEqual(order(apply(base(), r.patches)), ['1:c', '2:a', '2.1:a1', '2.2:a2', '3:b']);
  r = W.moveTo(base(), 'a1', 'a2', 'after');
  assert.deepEqual(order(apply(base(), r.patches)), ['1:a', '1.1:a2', '1.2:a1', '2:b', '3:c']);
  r = W.moveTo(base(), 'c', 'a1', 'inside');
  assert.deepEqual(order(apply(base(), r.patches)), ['1:a', '1.1:a1', '1.1.1:c', '1.2:a2', '2:b']);
  r = W.moveTo(base(), 'a2', 'c', 'after'); // 중분류 → 대분류로(단계 변경)
  assert.deepEqual(order(apply(base(), r.patches)), ['1:a', '1.1:a1', '2:b', '3:c', '4:a2']);
});
test('moveTo: 자기 자신/자기 하위/최대 깊이/변화 없음', () => {
  assert.equal(W.moveTo(base(), 'a', 'a', 'inside').reason, 'self');
  assert.equal(W.moveTo(base(), 'a', 'a1', 'before').reason, 'self');
  const deep = [n('x'), n('x1', { parent_id: 'x' }), n('x2', { parent_id: 'x1' }), n('x3', { parent_id: 'x2' }), n('y', { seq: 1 })];
  assert.equal(W.moveTo(deep, 'x', 'y', 'inside').reason, 'max_depth');
  const noop = W.moveTo(base(), 'b', 'a', 'after');
  assert.deepEqual(noop.patches, []);
});
test('planStageClip: 부모+자식을 함께 골라도 중복 없이, 하위 포함, 선택 밖 선행 작업은 제거', () => {
  const rows = [n('a'), n('a1', { parent_id: 'a', depends_on: ['b1:FS', 'a2'] }), n('a2', { parent_id: 'a', seq: 1 }), n('b', { seq: 1 }), n('b1', { parent_id: 'b' })];
  const clip = W.planStageClip(rows, ['a', 'a1']);
  assert.deepEqual(clip.items.map((x) => [x.key, x.depth, x.parentKey]), [['a', 0, null], ['a1', 1, 'a'], ['a2', 1, 'a']]);
  assert.deepEqual(clip.items[1].deps.map((d) => d.key), ['a2']);
  assert.equal(clip.height, 2);
  const part = W.planStageClip(rows, ['a2', 'b']);
  assert.deepEqual(part.items.map((x) => [x.key, x.depth]), [['a2', 0], ['b', 0], ['b1', 1]]);
});
test('applyClipOptions: 날짜 비움/이동/유지 + 진행률 초기화', () => {
  const items = [{ key: 'a', parentKey: null, depth: 0, deps: [], fields: { name: 'a', start_date: '2026-10-05', target_date: '2026-10-10', status: 'done', progress: 100, actual_start_date: '2026-10-05', actual_completion_date: '2026-10-09' } }];
  let r = W.applyClipOptions(items);
  assert.deepEqual([r.items[0].fields.start_date, r.items[0].fields.status, r.items[0].fields.actual_completion_date], [null, 'todo', null]);
  r = W.applyClipOptions(items, { dateMode: 'shift', shiftBase: '2026-11-01', resetProgress: false });
  assert.deepEqual([r.items[0].fields.start_date, r.items[0].fields.target_date, r.shiftDays, r.items[0].fields.progress], ['2026-11-01', '2026-11-06', 27, 100]);
  r = W.applyClipOptions(items, { dateMode: 'keep' });
  assert.equal(r.items[0].fields.target_date, '2026-10-10');
});
