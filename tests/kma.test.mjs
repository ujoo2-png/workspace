import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// js/services/kmaService.js는 일반 <script>(globalThis.X 전역 등록) 방식이라, Node에서는
// 파일을 읽어 평가(eval)해 전역에 등록한 뒤 순수 함수만 테스트한다(네트워크 호출 함수는
// window.fetch/window.getPublicDataKey에 의존하므로 브라우저 전용이라 여기서는 테스트하지 않는다).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadGlobalScript(relPath) {
  const code = fs.readFileSync(path.join(__dirname, relPath), 'utf8');
  (0, eval)(code);
}
loadGlobalScript('../js/services/kmaService.js');
const { dfsXyConv, parseVilageFcst, parseMidForecast } = globalThis;

test('dfsXyConv: 서울시청 좌표는 공식 문서의 격자(60,127) 근방으로 변환된다', () => {
  const { nx, ny } = dfsXyConv(37.5665, 126.978);
  assert.equal(nx, 60);
  assert.equal(ny, 127);
});

test('dfsXyConv: 부산 좌표는 서울과 다른 격자로 변환된다(회귀 방지용 스모크 테스트)', () => {
  const seoul = dfsXyConv(37.5665, 126.978);
  const busan = dfsXyConv(35.1796, 129.0756);
  assert.notDeepEqual(seoul, busan);
  assert.ok(Number.isInteger(busan.nx) && Number.isInteger(busan.ny));
});

test('parseVilageFcst: TMP/POP/TMN/TMX 등 카테고리를 날짜별로 묶는다', () => {
  const items = [
    { category: 'TMN', fcstDate: '20261002', fcstTime: '0600', fcstValue: '12' },
    { category: 'TMX', fcstDate: '20261002', fcstTime: '1500', fcstValue: '22' },
    { category: 'TMP', fcstDate: '20261002', fcstTime: '0900', fcstValue: '15' },
    { category: 'POP', fcstDate: '20261002', fcstTime: '0900', fcstValue: '30' },
    { category: 'PTY', fcstDate: '20261002', fcstTime: '0900', fcstValue: '0' },
    { category: 'SKY', fcstDate: '20261002', fcstTime: '0900', fcstValue: '1' },
    { category: 'TMP', fcstDate: '20261003', fcstTime: '0900', fcstValue: '16' },
    { category: 'POP', fcstDate: '20261003', fcstTime: '0900', fcstValue: '70' },
  ];
  const days = parseVilageFcst(items);
  assert.equal(days.length, 2);
  assert.equal(days[0].date, '2026-10-02');
  assert.equal(days[0].tmin, 12);
  assert.equal(days[0].tmax, 22);
  assert.equal(days[0].pop, 30);
  assert.equal(days[0].hourly[0].temp, 15);
  assert.equal(days[1].date, '2026-10-03');
  assert.equal(days[1].pop, 70);
});

test('parseVilageFcst: 빈 배열이면 빈 배열을 반환한다', () => {
  assert.deepEqual(parseVilageFcst([]), []);
  assert.deepEqual(parseVilageFcst(null), []);
});

test('parseMidForecast: 3일 뒤(offset=3)부터 10일 뒤까지 날짜를 만들고 AM/PM 강수확률을 읽는다', () => {
  const landItem = { wf3Am: '구름많음', wf3Pm: '비', rnSt3Am: '20', rnSt3Pm: '60', wf10: '맑음', rnSt10: '10' };
  const taItem = { taMin3: '10', taMax3: '19', taMin10: '8', taMax10: '17' };
  const days = parseMidForecast(landItem, taItem, '20261002');
  assert.equal(days.length, 8); // offset 3..10
  assert.equal(days[0].date, '2026-10-05'); // base + 3일
  assert.equal(days[0].min, 10);
  assert.equal(days[0].max, 19);
  assert.equal(days[0].am.text, '구름많음');
  assert.equal(days[0].pm.rainPct, 60);
  assert.equal(days[0].pop, 60);
  const last = days[days.length - 1]; // offset 10 — AM/PM 구분 없음
  assert.equal(last.date, '2026-10-12');
  assert.equal(last.am, null);
  assert.equal(last.pm.text, '맑음');
  assert.equal(last.min, 8);
  assert.equal(last.max, 17);
});
