import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// Supabase SQL(마이그레이션/통합본)의 재실행 안전성·문법 불변식 검사.
//
// 실제로 겪은 오류 두 가지를 고정한다:
//  1) ERROR 42710: policy "..." already exists — create policy/trigger 에 drop-if-exists 누락.
//  2) ERROR 42601: syntax error at or near "select" — do $$ ... $$ 안에서 같은 $$ 태그를
//     또 써서 바깥 블록이 조기에 닫히던 문제(달러 태그 중첩). ★ 이번 수정.
//
// DB 없이(순수 문자열 검사) 돌아가므로 CI/로컬 어디서나 실행된다.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const MIGRATIONS = fs
  .readdirSync(path.join(root, 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .map((f) => path.join('supabase/migrations', f));
const COMBINED = 'supabase/combined/all_migrations_0001_to_0031.sql';

/** 소스에서 `$$` 토큰의 위치(인덱스)를 전부 수집한다. */
function dollarTagPositions(src) {
  const positions = [];
  const re = /\$\$/g;
  let m;
  while ((m = re.exec(src)) !== null) positions.push(m.index);
  return positions;
}

test('모든 SQL 파일에서 $$ 달러 태그가 짝을 이룬다(홀수면 블록이 깨진 것)', () => {
  for (const rel of [...MIGRATIONS, COMBINED]) {
    const n = dollarTagPositions(read(rel)).length;
    assert.equal(n % 2, 0, `${rel}: $$ 태그가 홀수(${n})개 — do 블록이 닫히지 않았을 수 있음`);
  }
});

test('do $$ ... $$ 블록 안에서 같은 $$ 태그를 다시 쓰지 않는다(달러 태그 중첩 금지)', () => {
  for (const rel of [...MIGRATIONS, COMBINED]) {
    const src = read(rel);
    const pos = dollarTagPositions(src);
    for (let i = 0; i < pos.length; i += 2) {
      const inner = src.slice(pos[i] + 2, pos[i + 1]);
      const line = src.slice(0, pos[i]).split('\n').length;
      assert.ok(
        !inner.includes('$$'),
        `${rel}:${line} — do $$ 블록 안에 $$ 가 또 있어 바깥 블록이 조기 종료됩니다(42601). ` +
          `안쪽 문자열은 $cron$ 처럼 다른 태그를 쓰세요.`
      );
    }
  }
});

test('pg_cron 스케줄 SQL은 $cron$ 태그로 감싼다(중첩 회피의 실제 해법)', () => {
  const src = read('supabase/migrations/0006_cron.sql');
  assert.match(src, /cron\.schedule\(/, 'cron.schedule 호출이 사라졌습니다');
  assert.match(src, /\$cron\$select run_daily_automation\(7\)\$cron\$/, 'pg_cron SQL 문자열이 $cron$ 태그가 아닙니다');
  assert.ok(!/perform cron\.schedule\([\s\S]*?\$\$select/.test(src), 'cron.schedule 인자에 $$ 문자열이 남아 있습니다');
});

test("create policy/trigger 바로 앞(같은 파일)에 'drop ... if exists' 가 있다(42710 재발 방지)", () => {
  for (const rel of [...MIGRATIONS, COMBINED]) {
    const src = read(rel);
    // create policy <name> on <table> 들을 찾아, 그 이름에 대한 drop policy if exists 가
    // 그보다 앞쪽(같은 파일)에 있는지 본다.
    const policies = [...src.matchAll(/create policy\s+"?([\w]+)"?\s+on\s+([\w.]+)/gi)];
    for (const [, name, table] of policies) {
      const dropRe = new RegExp(`drop policy if exists\\s+"?${name}"?\\s+on\\s+${table}`, 'i');
      assert.ok(dropRe.test(src), `${rel}: create policy "${name}" on ${table} 앞에 drop policy if exists 누락`);
    }
  }
});

test('create table/index 는 if not exists 로 만든다(재실행 안전)', () => {
  for (const rel of [COMBINED]) {
    const src = read(rel);
    const badTables = [...src.matchAll(/create table\s+(?!if not exists)/gi)].length;
    const badIdx = [...src.matchAll(/create\s+(?:unique\s+)?index\s+(?!if not exists)/gi)].length;
    assert.equal(badTables, 0, `${rel}: create table without if not exists ${badTables}개`);
    assert.equal(badIdx, 0, `${rel}: create index without if not exists ${badIdx}개`);
  }
});

test('통합본은 마이그레이션 0001~0029 를 모두 포함한다', () => {
  const combined = read(COMBINED);
  for (let i = 1; i <= 29; i++) {
    const tag = String(i).padStart(4, '0');
    assert.match(
      combined,
      new RegExp(`${tag}_`),
      `통합본에 ${tag}_ 마이그레이션이 포함되지 않았습니다`
    );
  }
});
