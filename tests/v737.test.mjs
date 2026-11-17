import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const d = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(d, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
globalThis.window = globalThis;
for (const f of ['js/utils/vehicleLogic.js', 'js/utils/promoLogic.js', 'js/utils/briefingSearch.js']) (0, eval)(read(f));
const VL = globalThis.VehicleLogic; const PL = globalThis.PromoLogic;

test('중복 차량 찾기: 공백/하이픈 무시, 번호 없는 차량·삭제 차량 제외', () => {
  const vs = [{ id: 'a', plate_number: '12가 3456' }, { id: 'b', plate_number: '12가-3456' }, { id: 'c', plate_number: '' }, { id: 'd', plate_number: '' }, { id: 'e', plate_number: '99나1111' }, { id: 'f', plate_number: '12가3456', deleted_at: 'x' }];
  const g = VL.findDuplicateGroups(vs);
  assert.equal(g.length, 1); assert.deepEqual(g[0].vehicles.map((v) => v.id), ['a', 'b']);
});

test('병합 계획: 기록 보존·완전 동일 중복만 정리·빈 칸 보완·만료일은 늦은 날짜', () => {
  const P = { id: 'p', name: '아반떼', plate_number: '12가3456', model: null, year: 2021, fuel_type: 'gasoline', insurance_expiry: '2026-12-01', registration_expiry: null, created_at: '2025-01-01' };
  const O = { id: 'o', name: '아반떼 2021', plate_number: '12가 3456', model: 'CN7', year: 2020, fuel_type: 'gasoline', insurance_expiry: '2027-01-15', registration_expiry: '2027-03-01', created_at: '2025-02-01' };
  const data = {
    maint: { p: [{ id: 'm1', service_date: '2026-01-01', item: '엔진오일', odometer: 10000, cost: 80000 }], o: [{ id: 'm2', service_date: '2026-01-01', item: '엔진오일', odometer: 10000, cost: 80000 }, { id: 'm3', service_date: '2026-06-01', item: '타이어', odometer: 20000, cost: 400000 }] },
    fuel: { p: [{ id: 'f1', logged_at: '2026-02-01', odometer: 11000, amount: 40, cost: 70000 }], o: [{ id: 'f2', logged_at: '2026-02-01', odometer: 11000, amount: 40, cost: 70500 }] },
    odo: { p: [], o: [{ id: 'o1', logged_at: '2026-03-01', odometer: 12000 }] },
    attach: { o: [{ id: 'at1' }, { id: 'at2' }] },
  };
  const plan = VL.planMerge(P, [O], data);
  assert.deepEqual(plan.dups.maint, ['m2']);           // 모든 칸 동일 → 정리
  assert.deepEqual(plan.moves.maint, ['m3']);          // 새 기록 → 이동
  assert.deepEqual(plan.moves.fuel, ['f2']);           // 금액만 달라도 보존
  assert.deepEqual(plan.moves.odo, ['o1']);
  assert.deepEqual(plan.moves.attach, ['at1', 'at2']); // 첨부는 전부 이동
  assert.equal(plan.fieldPatch.model, 'CN7');          // 빈 칸 보완
  assert.equal(plan.fieldPatch.registration_expiry, '2027-03-01');
  assert.equal(plan.fieldPatch.insurance_expiry, '2027-01-15'); // 더 늦은 날짜
  assert.equal(plan.fieldPatch.year, undefined);       // 값이 있으면 대표 유지
  assert.ok(plan.conflicts.some((c) => c.field === '이름') && plan.conflicts.some((c) => c.field === '연식'));
  // 어떤 기록도 사라지지 않는다: 이동 + 정리(동일) = 원래 전체
  const total = 1 + 2 + 1 + 1; // 대표 외 기록 수(o): maint 2 + fuel 1 + odo 1 = 4
  assert.equal(plan.moves.maint.length + plan.dups.maint.length + plan.moves.fuel.length + plan.dups.fuel.length + plan.moves.odo.length + plan.dups.odo.length, 4);
  assert.ok(total >= 4);
});

test('대표 카드: 기록 많은 쪽, 같으면 먼저 만든 쪽', () => {
  const a = { id: 'a', created_at: '2025-02-01' }; const b = { id: 'b', created_at: '2025-01-01' };
  assert.equal(VL.pickPrimary([a, b], () => 3).id, 'b');
  assert.equal(VL.pickPrimary([a, b], (x) => (x.id === 'a' ? 5 : 1)).id, 'a');
});

test('차량 그래프: 원자료/집계(last·avg·sum)와 빈 구간 null', () => {
  const odoPoints = [{ date: '2026-10-01', odometer: 10000 }, { date: '2026-10-20', odometer: 10500 }, { date: '2026-11-05', odometer: 11000 }];
  const fuels = [{ logged_at: '2026-10-01', odometer: 10000, amount: 40, cost: 70000 }, { logged_at: '2026-10-20', odometer: 10500, amount: 40, cost: 72000 }, { logged_at: '2026-11-05', odometer: 11000, amount: 50, cost: 90000 }];
  const maints = [{ service_date: '2026-10-15', cost: 80000 }];
  const data = { fuels, maints, odoPoints };
  assert.deepEqual(VL.seriesFor('odo', data).map((p) => p.value), [10000, 10500, 11000]);
  assert.deepEqual(VL.seriesFor('dist', data).map((p) => p.value), [500, 500]);
  assert.deepEqual(VL.seriesFor('odo', { odoPoints: [{ date: '2026-10-01', odometer: 100 }, { date: '2026-10-01', odometer: 120 }] }).map((p) => p.value), [120]); // 같은 날 중복 정리
  assert.deepEqual(VL.seriesFor('eff', data).map((p) => p.value), [12.5, 10]);
  assert.deepEqual(VL.seriesFor('price', data).map((p) => p.value), [1750, 1800, 1800]);
  assert.deepEqual(VL.seriesFor('maintCost', data).map((p) => p.value), [80000]);
  const raw = VL.aggregate(VL.seriesFor('odo', data), 'raw10', 'last', '2026-11-09');
  assert.equal(raw.values.length, 3); assert.equal(raw.labels[0], '10-01');
  const m = VL.aggregate(VL.seriesFor('fuelCost', data), 'month', 'sum', '2026-11-09'); // 최근 6개월
  assert.equal(m.labels.length, 6); assert.equal(m.labels[5], '2026.11');
  assert.equal(m.values[5], 90000); assert.equal(m.values[4], 142000); assert.equal(m.values[0], null);
  const lastm = VL.aggregate(VL.seriesFor('odo', data), 'month', 'last', '2026-11-09'); assert.equal(lastm.values[4], 10500);
  const q = VL.aggregate(VL.seriesFor('price', data), 'quarter', 'avg', '2026-11-09'); assert.equal(q.labels.length, 4);
  assert.equal(VL.aggregate([], 'month', 'sum', '2026-11-09').hasAny, false);
  assert.deepEqual(VL.RANGES.map((r) => r.key), ['raw10', 'week', 'month', 'half', 'quarter', 'year', 'year3']);
});

test('최근 검색어: 최대 10개·중복은 앞으로·삭제', () => {
  let l = [];
  for (let i = 1; i <= 12; i++) l = window.addRecentQuery(l, `검색${i}`);
  assert.equal(l.length, 10); assert.equal(l[0], '검색12'); assert.equal(l[9], '검색3');
  l = window.addRecentQuery(l, '  검색5  '); assert.equal(l[0], '검색5'); assert.equal(l.length, 10);
  l = window.addRecentQuery(l, '검색  5'); assert.equal(l.length, 10);
  assert.equal(window.addRecentQuery(l, '').length, 10);
  l = window.removeRecentQuery(l, '검색12'); assert.ok(!l.includes('검색12')); assert.equal(l.length, 9);
  assert.deepEqual(window.addRecentQuery(['A', 'a'], 'b'), ['b', 'A', 'a'].filter((x, i, a) => a.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i));
});

test('홍보 영상: 주소 정리·본문 구성·응답 해석·연결 판정', () => {
  assert.equal(PL.normalizeBase('127.0.0.1:8080/'), 'http://127.0.0.1:8080');
  assert.equal(PL.normalizeBase('https://my.pc:8443/x/y'), 'https://my.pc:8443');
  assert.equal(PL.normalizeBase('', 'http://a'), 'http://a');
  const body = PL.buildTaskBody({ subject: '스마트팜 앱', script: '한 줄\n두 줄', terms: 'farm, smartphone', aspect: '9:16', voice: 'ko-KR-SunHiNeural-Female', clipSec: 99, count: 9 });
  assert.equal(body.video_aspect, '9:16'); assert.deepEqual(body.video_terms, ['farm', 'smartphone']);
  assert.equal(body.video_clip_duration, 15); assert.equal(body.video_count, 5); assert.equal(body.voice_name, 'ko-KR-SunHiNeural-Female');
  assert.equal(PL.buildTaskBody({ subject: 'x', script: 's', aspect: 'bad' }).video_aspect, '9:16');
  const script = PL.buildScript({ name: '대부도 앱', description: '과수원 센서 데이터를 한곳에서 봅니다.' }, { audience: '과수 농가', features: ['실시간 알림', '모바일 지원'], cta: '링크에서 써 보세요' });
  assert.match(script, /^과수 농가, 아직도/); assert.match(script, /대부도 앱, 한 번에 해결해 드립니다\./); assert.ok(script.split('\n').length >= 5);
  assert.deepEqual(PL.parseTask({ data: { state: 1, progress: 100, videos: ['/tasks/x/final-1.mp4', 'http://h/a.mp4'] } }, 'http://127.0.0.1:8080'), { state: 'done', progress: 100, videos: ['http://127.0.0.1:8080/tasks/x/final-1.mp4', 'http://h/a.mp4'] });
  assert.equal(PL.parseTask({ data: { state: -1 } }, 'x').state, 'failed');
  assert.equal(PL.parseTask({ data: { state: 4, progress: 40 } }, 'x').state, 'running');
  assert.equal(PL.parseTask(null, 'x').state, 'unknown');
  assert.equal(PL.classifyProbe({ cors: { ok: true, status: 200 }, noCors: true }).state, 'ready');
  assert.equal(PL.classifyProbe({ cors: { ok: false, status: 401 }, noCors: true }).state, 'auth');
  assert.equal(PL.classifyProbe({ cors: null, noCors: true }).state, 'cors');
  assert.equal(PL.classifyProbe({ cors: null, noCors: false }).state, 'off');
});

test('배포 점검: 새 스크립트가 index.html에 있고 파일이 존재', () => {
  const html = read('index.html');
  const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]).filter((s) => !/^https?:/.test(s));
  for (const s of srcs) assert.ok(fs.existsSync(path.join(root, s)), `없는 파일: ${s}`);
  for (const f of ['js/utils/vehicleLogic.js', 'js/utils/promoLogic.js', 'js/modules/promoVideo.js']) assert.ok(srcs.includes(f), f);
  assert.ok(srcs.indexOf('js/modules/promoVideo.js') < srcs.indexOf('js/modules/programs.js'));
});
