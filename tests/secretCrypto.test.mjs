import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// js/utils/secretCrypto.js는 일반 <script>(globalThis 전역 등록) 방식이므로 Node에서는
// 파일을 읽어 그대로 평가해 전역에 등록한 뒤 사용한다. Node 22는 globalThis.crypto.subtle을
// 기본 제공하므로 브라우저와 동일한 Web Crypto API로 동작을 검증할 수 있다.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadGlobalScript(relPath) {
  const code = fs.readFileSync(path.join(__dirname, relPath), 'utf8');
  (0, eval)(code);
}
globalThis.window = globalThis;
loadGlobalScript('../js/utils/secretCrypto.js');
const { encryptSecret, decryptSecret, isEncryptedSecret } = globalThis.secretCrypto;

test('isEncryptedSecret: 접두사로 암호화 여부를 구분한다(기존 평문 값과의 호환성)', () => {
  assert.equal(isEncryptedSecret('plain-old-password'), false);
  assert.equal(isEncryptedSecret(''), false);
  assert.equal(isEncryptedSecret(null), false);
  assert.equal(isEncryptedSecret(undefined), false);
});

test('encryptSecret → decryptSecret 왕복: 같은 passphrase면 원문을 그대로 복원한다', async () => {
  const plaintext = 'my-admin-p@ssw0rd!';
  const encrypted = await encryptSecret(plaintext, 'correct horse battery staple');
  assert.equal(isEncryptedSecret(encrypted), true);
  assert.notEqual(encrypted, plaintext);
  assert.equal(encrypted.includes(plaintext), false);
  const decrypted = await decryptSecret(encrypted, 'correct horse battery staple');
  assert.equal(decrypted, plaintext);
});

test('encryptSecret: 같은 입력도 호출마다 다른 salt/iv로 서로 다른 암호문을 만든다', async () => {
  const a = await encryptSecret('hello', 'pw');
  const b = await encryptSecret('hello', 'pw');
  assert.notEqual(a, b);
});

test('decryptSecret: 잘못된 passphrase는 예외를 던지고 평문을 복원하지 못한다', async () => {
  const encrypted = await encryptSecret('secret-value', 'right-passphrase');
  await assert.rejects(() => decryptSecret(encrypted, 'wrong-passphrase'));
});

test('decryptSecret: 암호화되지 않은(평문) 값을 넘기면 예외를 던진다', async () => {
  await assert.rejects(() => decryptSecret('plain-old-password', 'any'));
});

test('encryptSecret: 빈 값/null은 암호화하지 않고 그대로 반환한다', async () => {
  assert.equal(await encryptSecret('', 'pw'), '');
  assert.equal(await encryptSecret(null, 'pw'), null);
});
