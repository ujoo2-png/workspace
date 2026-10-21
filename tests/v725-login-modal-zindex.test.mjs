import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// v7.25.0 회귀 테스트: 로그인 전에 개인정보 처리방침 모달이 "보이는가".
//
// 배경(실제 발생한 버그):
//   로그인 화면(.lo)은 화면 전체를 덮는 오버레이로 z-index:9999 를 쓴다.
//   반면 공용 모달(.nm-modal-backdrop)은 z-index:1000 이었다.
//   그래서 로그인 화면에서 "개인정보 처리방침" 링크를 눌러도 모달이 오버레이
//   "뒤"에 숨어 보이지 않다가, 로그인으로 오버레이가 사라진 뒤에야 나타났다.
//
// 해결: 모달/토스트의 z-index 를 로그인 오버레이(9999)보다 위로 올린다.
// 이 테스트는 llm 이 아니라 CSS 값을 직접 읽어 그 불변식을 고정한다(문서 없이도 재발 감지).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const css = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');

/** 특정 선택자 블록에서 "z-index: N" 을 뽑아 숫자로 돌려준다. */
function zIndexOf(source, selector) {
  // 선택자 뒤의 첫 '{' 부터 짝이 맞는 '}' 까지를 블록으로 본다.
  const start = source.indexOf(selector);
  assert.notEqual(start, -1, `선택자를 찾지 못했습니다: ${selector}`);
  const open = source.indexOf('{', start);
  const close = source.indexOf('}', open);
  const block = source.slice(open, close);
  const m = block.match(/z-index\s*:\s*(\d+)/);
  assert.ok(m, `${selector} 블록에 z-index 가 없습니다`);
  return Number(m[1]);
}

const baseCss = css('../css/base.css');
const authCss = css('../css/modules/auth.css');

test('로그인 오버레이(.lo)는 z-index 9999 를 쓴다(전제 확인)', () => {
  assert.equal(zIndexOf(authCss, '.lo {'), 9999);
});

test('개인정보 처리방침 모달(.nm-modal-backdrop)은 로그인 오버레이보다 위에 뜬다', () => {
  const loginZ = zIndexOf(authCss, '.lo {');
  const modalZ = zIndexOf(baseCss, '.nm-modal-backdrop');
  assert.ok(
    modalZ > loginZ,
    `모달 z-index(${modalZ})가 로그인 오버레이(${loginZ})보다 커야 로그인 전에도 보입니다`
  );
});

test('토스트(.toast-host)는 모달보다도 위에 떠서 가려지지 않는다', () => {
  const modalZ = zIndexOf(baseCss, '.nm-modal-backdrop');
  const toastZ = zIndexOf(baseCss, '.toast-host');
  assert.ok(toastZ > modalZ, `토스트 z-index(${toastZ})는 모달(${modalZ})보다 커야 합니다`);
});

test('로그인 화면에 개인정보 처리방침 링크가 클릭 가능한 button 으로 배선돼 있다', () => {
  const authJs = fs.readFileSync(path.join(__dirname, '../js/modules/auth.js'), 'utf8');
  // 로그인 폼 아래 안내 링크가 openPrivacyPolicy 를 호출해야 한다.
  assert.match(authJs, /openPrivacyPolicy\s*\(\s*\)/, '로그인 화면에서 openPrivacyPolicy 호출이 사라졌습니다');
  assert.match(authJs, /lo-policy-link/, '로그인 화면의 정책 링크 클래스가 사라졌습니다');
});

test('privacyPolicy.js 는 모달(openModal)로 문서를 연다(로그인 전에도 동작)', () => {
  const policyJs = fs.readFileSync(path.join(__dirname, '../js/components/privacyPolicy.js'), 'utf8');
  assert.match(policyJs, /openModal\s*\(/, '정책 문서가 모달로 열리지 않습니다');
});
