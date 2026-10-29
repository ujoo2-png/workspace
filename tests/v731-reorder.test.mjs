import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const d = path.dirname(fileURLToPath(import.meta.url));
globalThis.window = globalThis;
(0, eval)(fs.readFileSync(path.join(d, '../js/utils/reorder.js'), 'utf8'));
const { sortByOrder, moveId } = globalThis.Reorder;

test('sortByOrder: 저장된 순서대로, 새 항목은 뒤에(원래 순서 유지)', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  assert.deepEqual(sortByOrder(rows, ['c', 'a']).map((r) => r.id), ['c', 'a', 'b', 'd']);
  assert.deepEqual(sortByOrder(rows, []).map((r) => r.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(sortByOrder(rows, ['x', 'd', 'b']).map((r) => r.id), ['d', 'b', 'a', 'c']);
});
test('sortByOrder: 원본 배열을 바꾸지 않고 숫자/문자 id를 같게 본다', () => {
  const rows = [{ id: 1 }, { id: 2 }];
  const out = sortByOrder(rows, ['2', '1']);
  assert.deepEqual(out.map((r) => r.id), [2, 1]);
  assert.deepEqual(rows.map((r) => r.id), [1, 2]);
});
test('moveId: 앞/뒤로 이동, 없는 id는 그대로', () => {
  assert.deepEqual(moveId(['a', 'b', 'c'], 'a', 'c', true), ['b', 'c', 'a']);
  assert.deepEqual(moveId(['a', 'b', 'c'], 'c', 'a', false), ['c', 'a', 'b']);
  assert.deepEqual(moveId(['a', 'b', 'c'], 'z', 'a'), ['a', 'b', 'c']);
  assert.deepEqual(moveId(['a', 'b', 'c'], 'b', 'b'), ['a', 'b', 'c']);
});
test('저장/복원: setOrder → getOrder → sort, reset', () => {
  const mem = {}; globalThis.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  const R = globalThis.Reorder;
  R.setOrder('t', ['b', 'a']);
  assert.deepEqual(R.getOrder('t'), ['b', 'a']);
  assert.deepEqual(R.sort('t', [{ id: 'a' }, { id: 'b' }]).map((r) => r.id), ['b', 'a']);
  R.reset('t');
  assert.deepEqual(R.getOrder('t'), []);
});
