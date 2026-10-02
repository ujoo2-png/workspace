// 프로그램(관리자 계정) 등 민감한 값을 "클라이언트에서만" 암호화하기 위한 순수 함수 모듈.
// Web Crypto API(AES-GCM 256 + PBKDF2)를 사용하며, 서버(Supabase)에는 암호문만 전달되고
// 사용자가 입력한 잠금 암호(passphrase)는 어디에도 저장·전송하지 않는다(메모리에서만 사용).
// 일반 <script>로 로드되며(ES 모듈 아님), Node(단위 테스트)와 브라우저 양쪽에서
// globalThis.crypto.subtle을 그대로 사용할 수 있으므로 동일하게 동작한다.
(function () {
  const PREFIX = 'wsenc1:'; // 포맷 버전 식별자. 값이 이 접두사로 시작하면 "암호화된 값"으로 간주한다.
  const PBKDF2_ITERATIONS = 150000;
  const SALT_BYTES = 16;
  const IV_BYTES = 12; // AES-GCM 권장 IV 길이

  function toB64(bufOrView) {
    const bytes = bufOrView instanceof Uint8Array ? bufOrView : new Uint8Array(bufOrView);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  function fromB64(b64) {
    const s = atob(b64);
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes;
  }

  // 값이 이 모듈로 암호화된 값인지(= v.s./현재는 과거 평문 값과 구분하기 위함) 확인한다.
  function isEncryptedSecret(value) {
    return typeof value === 'string' && value.startsWith(PREFIX);
  }

  async function deriveKey(passphrase, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  // plaintext를 passphrase로 암호화해 "wsenc1:<salt>.<iv>.<ciphertext>"(모두 base64) 문자열로 반환한다.
  // salt/iv는 비밀이 아니므로 암호문과 함께 저장해도 안전하다(표준 관행). passphrase 자체는
  // 리턴값에 포함되지 않으며 이 함수 호출이 끝나면 호출부 외에는 남지 않는다.
  async function encryptSecret(plaintext, passphrase) {
    if (!passphrase) throw new Error('잠금 암호(passphrase)가 필요합니다.');
    if (plaintext === null || plaintext === undefined || plaintext === '') return plaintext;
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const key = await deriveKey(passphrase, salt);
    const enc = new TextEncoder();
    const ciphertextBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(String(plaintext)));
    return `${PREFIX}${toB64(salt)}.${toB64(iv)}.${toB64(ciphertextBuf)}`;
  }

  // encryptSecret()이 만든 문자열을 같은 passphrase로 복호화한다. passphrase가 틀렸거나
  // 값이 손상된 경우 AES-GCM의 인증 태그 검증이 실패하며 예외를 던진다(평문 노출 없음).
  async function decryptSecret(encoded, passphrase) {
    if (!isEncryptedSecret(encoded)) throw new Error('암호화된 값이 아닙니다.');
    if (!passphrase) throw new Error('잠금 암호(passphrase)가 필요합니다.');
    const rest = encoded.slice(PREFIX.length);
    const parts = rest.split('.');
    if (parts.length !== 3) throw new Error('손상된 데이터입니다.');
    const [saltB64, ivB64, ctB64] = parts;
    try {
      const salt = fromB64(saltB64);
      const iv = fromB64(ivB64);
      const ciphertext = fromB64(ctB64);
      const key = await deriveKey(passphrase, salt);
      const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
      return new TextDecoder().decode(plainBuf);
    } catch (e) {
      throw new Error('잠금 암호가 올바르지 않거나 데이터가 손상되었습니다.');
    }
  }

  window.secretCrypto = { encryptSecret, decryptSecret, isEncryptedSecret, ENC_PREFIX: PREFIX };
})();
