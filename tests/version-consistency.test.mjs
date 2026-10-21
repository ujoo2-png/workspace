import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// 버전 표기 불일치 재발 방지 테스트.
//
// 실제로 겪은 문제:
//   - zip 파일명은 v7.25.0 인데, 압축을 풀면 나오는 폴더는 workspace-app-v7.23.0-flat 이었다.
//   - 앱 내부 버전(config.js/README)과 배포 패키지 이름이 서로 달랐다.
//
// 원칙: "하나의 버전"이 아래 3곳에서 모두 같아야 한다.
//   1) js/config.js 의 CONFIG.version
//   2) README.md 제목의 (vX.Y.Z)
//   3) 이 프로젝트가 놓인 폴더명 workspace-app-vX.Y.Z-flat
// (zip 파일명은 폴더명과 같아야 하며, 이 테스트는 폴더 기준으로 검사한다.)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..'); // …/workspace-app-vX.Y.Z-flat

/** 전체에서 "가장 최신 버전"을 나타내는 문자열을 하나로 뽑는다. */
function readConfigVersion() {
  const src = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8');
  const m = src.match(/version:\s*'([^']+)'/);
  assert.ok(m, 'js/config.js 에서 version 을 찾지 못했습니다');
  return m[1];
}

function readReadmeTitleVersion() {
  const first = fs.readFileSync(path.join(root, 'README.md'), 'utf8').split('\n')[0];
  const m = first.match(/\(v[\d.]+\)/);
  assert.ok(m, `README 제목에서 (vX.Y.Z) 를 찾지 못했습니다: "${first}"`);
  return m[0].slice(1, -1); // 괄호 제거
}

function folderVersion() {
  const base = path.basename(root);
  const m = base.match(/^workspace-app-(v[\d.]+)-flat$/);
  assert.ok(m, `폴더명이 workspace-app-vX.Y.Z-flat 형식이 아닙니다: "${base}"`);
  return m[1];
}

test('config.js / README / 폴더명의 버전이 모두 일치한다', () => {
  const fromConfig = readConfigVersion();
  const fromReadme = readReadmeTitleVersion();
  const fromFolder = folderVersion();
  assert.equal(fromConfig, fromFolder, `config.js(${fromConfig}) ≠ 폴더명(${fromFolder})`);
  assert.equal(fromReadme, fromFolder, `README(${fromReadme}) ≠ 폴더명(${fromFolder})`);
});

test('버전 형식은 vX.Y.Z (semver 3자리) 이다', () => {
  assert.match(readConfigVersion(), /^v\d+\.\d+\.\d+$/, '버전은 vX.Y.Z 형식이어야 합니다');
  assert.equal(folderVersion().replace(/^v/, '').split('.').length, 3, '버전은 3자리여야 합니다');
});

test('현재 버전이 과거 최신 이력(v7.25.0)보다 뒤처지지 않는다', () => {
  // 회귀: 폴더명만 옛 버전(v7.23.0)으로 남아 zip 과 어긋나던 일을 막는다.
  const cur = folderVersion();
  const parse = (v) => v.replace(/^v/, '').split('.').map(Number);
  const [a, b, c] = parse(cur);
  const [x, y, z] = parse('v7.25.0');
  const newer = a > x || (a === x && b > y) || (a === x && b === y && c >= z);
  assert.ok(newer, `현재 버전(${cur})이 v7.25.0 보다 낮습니다 — 버전을 올렸는지 확인하세요`);
});

test('index.html / config.js 등 "현재 버전"을 쓰는 곳에 옛 버전이 남아있지 않다', () => {
  // 과거 기능 이력 주석(// v7.24.0: …)은 정상이므로, "현재 버전을 뜻하는" 위치만 본다.
  const cfg = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8');
  const cur = readConfigVersion();
  // config.js 안에는 정확히 현재 버전만 나와야 한다(다른 버전 문자열 금지).
  const versions = [...cfg.matchAll(/v\d+\.\d+\.\d+/g)].map((m) => m[0]);
  for (const v of versions) {
    assert.equal(v, cur, `js/config.js 에 옛 버전 문자열(${v})이 남아 있습니다(현재: ${cur})`);
  }
});
